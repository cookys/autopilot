#!/usr/bin/env node
/**
 * context-land-gate — Stop hook (default-on).
 *
 * hooks/context-budget.js records the first T2 / T3 land-checklist fire per tier in the per-session
 * state file (`landFire.<tier> = {at, blocks, done}`). This hook compares that fire time with the mtime
 * of the session's handoff file and:
 *   - handoff older than the fire (or missing): PM first attempts a scripted snapshot; otherwise blocks
 *     the stop, reason = run /handoff. At most 2 blocks
 *     per tier fire; the 3rd stop is allowed and one audit line is appended to the state (`landAudit`).
 *   - handoff written after the fire: the first Stop after it blocks once more:
 *     - PM seat (`pm--claude`) or unresolvable fleet seat: tells the model to relay one copyable line to the
 *       operator (`read <path> 接續`, plugin can be updated and the session restarted).
 *     - Any other resolved fleet seat: dispatches one ops task to hangar (`fleet dispatch`) — or to
 *       `ops--claude` when the seat itself is `hangar--claude` — and tells the model not to relay to the
 *       operator; falls back to the operator relay if dispatch fails.
 *     Every later stop is allowed.
 * Handoff file candidates: the path the checklist names ($XDG_RUNTIME_DIR/autopilot/handoff/<sid>.md, else
 * <live base>/handoff/<sid>.md) and the skill's manual route (scripts/resolve-repo-placement.js handoff --route manual).
 * Skips: context_budget mode off, subagent payloads (agent_id), no state file, no fire recorded.
 * Fail-open: any error exits 0 with no decision.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readContextBudget } = require('../scripts/lib/config-path.js');
const { resolveLiveDir } = require('../scripts/lib/live-state-dir.js');
const { ownerAddress } = require('../scripts/lib/fleet-task.js');
const { resolveFleetSeat } = require('./_shared/fleet-seat.js');
const { lockStateFile, sessionIdOf, stateDirOf, sessionHandoffPath } = require('./context-budget-lib.js');
const { gateHint } = require('./lib/gate-hint.js');

const MAX_BLOCKS = 2;
const TIERS = ['t3', 't2']; // highest first
const DEFAULT_HANGAR_ADDRESS = 'cookys/openclaw/hangar--claude';
const DEFAULT_OPS_ADDRESS = 'cookys/openclaw/ops--claude';
const DISPATCH_TIMEOUT_MS = 20000;

function mtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return null; }
}

function candidatePaths(sid, cwd) {
  const out = [sessionHandoffPath(sid)];
  try {
    const { handoffPath } = require('../scripts/resolve-repo-placement.js');
    const manual = handoffPath(cwd, 'manual');
    if (manual) out.push(manual);
  } catch { /* no repo: only the session path */ }
  return out;
}

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: 'block', reason })}\n`);
}

function parseTaskId(stdout) {
  const raw = String(stdout || '').trim();
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    const id = (j && (j.id || j.task_id || (j.task && j.task.id))) || '';
    if (typeof id === 'string' && id.trim()) return id.trim();
  } catch { /* not JSON */ }
  const m = raw.match(/\b(01[0-9A-Z]{24})\b/);
  return m ? m[1] : '';
}

function dispatchHangarRestart(sid, landed) {
  const selfAddr = ownerAddress() || String(process.env.AUTOPILOT_FLEET_ADDRESS || '').replace(/@.*$/, '').trim() || '未知';
  const member = selfAddr.includes('/') ? selfAddr.slice(selfAddr.lastIndexOf('/') + 1) : selfAddr;
  const isHangarSelf = member === 'hangar--claude';
  const target = isHangarSelf
    ? (process.env.AUTOPILOT_OPS_ADDRESS || DEFAULT_OPS_ADDRESS)
    : (process.env.AUTOPILOT_HANGAR_ADDRESS || DEFAULT_HANGAR_ADDRESS);
  const targetLabel = isHangarSelf ? 'ops' : 'hangar';
  const text = `席位 ${selfAddr}（session ${sid}）已完成 handoff（${landed}）。plugin 可以更新、session 可以重啟；重啟後請對該席貼：read ${landed} 接續`;
  const env = { ...process.env };
  delete env.FLEET_AS_CLI;
  delete env.FLEET_FYI;
  const r = spawnSync(
    require('../scripts/lib/fleet-task.js').bin(process.env),
    ['dispatch', target, '--size', 'XS', '--kind', 'ops', '--class', 'chat', '--priority', 'P3', '--priority-reason', 'seat restart request', text],
    { encoding: 'utf8', timeout: DISPATCH_TIMEOUT_MS, env }
  );
  if (r.error) {
    return { ok: false, targetLabel, error: r.error.code === 'ENOENT' ? 'no fleet binary' : r.error.message };
  }
  if (r.status !== 0) {
    const firstErr = String(r.stderr || '').trim().split('\n')[0] || 'no output';
    return { ok: false, targetLabel, error: `fleet dispatch exit ${r.status}: ${firstErr}` };
  }
  return { ok: true, targetLabel, taskId: parseTaskId(r.stdout) };
}

function main() {
  const cfg = readContextBudget();
  if (cfg.mode === 'off') return;
  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return; }
  if (!payload || payload.agent_id) return;

  const sid = sessionIdOf(payload);
  const live = resolveLiveDir();
  const stateFile = path.join(stateDirOf(live.base), `${sid}.json`);
  if (!fs.existsSync(stateFile)) return;

  const release = lockStateFile(stateFile);
  try {
    let st;
    try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return; }
    const fires = st && st.landFire;
    if (!fires || typeof fires !== 'object') return;
    const pending = TIERS.filter((t) => fires[t] && fires[t].done !== true);
    if (pending.length === 0) return;

    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const paths = candidatePaths(sid, cwd);
    const newestFireAt = Math.max(...pending.map((t) => fires[t].at));
    let landed = null;
    for (const p of paths) {
      const m = mtimeMs(p);
      if (m !== null && m >= newestFireAt) { landed = p; break; }
    }

    const hardBlock = cfg.t2HardBlock === true && Object.hasOwn(cfg.t2PctBySeat || {}, resolveFleetSeat(payload));
    if (landed) {
      for (const t of pending) fires[t].done = true;
      fs.writeFileSync(stateFile, JSON.stringify(st));
      const seat = resolveFleetSeat(payload);
      const operatorMsg = `handoff 已寫好。請把下面這行原樣轉給操作員，並告訴他：plugin 可以更新、session 可以重啟了。\nread ${landed} 接續`;
      const operatorHint = gateHint('把上面一行原樣轉給操作員，然後再結束 turn', 'autopilot:handoff');
      if (seat && seat !== 'pm') {
        const res = dispatchHangarRestart(sid, landed);
        if (res.ok) {
          const taskLabel = res.taskId ? `task ${res.taskId}` : 'task';
          block(`handoff 已寫好，已自動派單給 ${res.targetLabel} 重啟（${taskLabel}），你不必再通知任何人，可以結束 turn。`);
          return;
        }
        block(`${operatorMsg}\n（自動派單給 ${res.targetLabel || 'hangar'} 失敗：${res.error}）${operatorHint}`);
        return;
      }
      block(operatorMsg + operatorHint);
      return;
    }

    if (resolveFleetSeat(payload) === 'pm') {
      const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/pm-handoff-write.js'), '--sid', sid],
        { encoding: 'utf8', timeout: 30000 });
      if (!result.error && result.status === 0 && String(result.stdout || '').trim()) {
        for (const t of pending) fires[t].done = true;
        fs.writeFileSync(stateFile, JSON.stringify(st));
        block(`handoff 已由腳本寫好（${result.stdout.trim()}），auto-clear 會接手；不必再轉告操作員。`);
        return;
      }
    }

    const top = pending[0];
    const f = fires[top];
    const sessionPath = paths[0];
    if (hardBlock) {
      f.blocks = (f.blocks || 0) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(st));
      block(`Context ${top.toUpperCase()} 已觸發，但 handoff 檔還沒寫（或比觸發時間舊）。請先寫完 handoff 到 ${sessionPath} 才能結束；此席位沒有擋停次數上限。（第 ${f.blocks} 次擋停）`
        + gateHint('先回答落地清單並執行 /handoff（handoff 要新於觸發時間）', 'autopilot:handoff'));
      return;
    }
    if ((f.blocks || 0) < MAX_BLOCKS) {
      f.blocks = (f.blocks || 0) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(st));
      block(`Context ${top.toUpperCase()} 已觸發，但 handoff 檔還沒寫（或比觸發時間舊）。先回答落地清單、把沒寫回 repo 的東西落地，再執行 /handoff（autopilot:handoff skill），handoff 寫到 ${sessionPath}。（第 ${f.blocks}/${MAX_BLOCKS} 次擋停）`
        + gateHint('先回答落地清單並執行 /handoff（handoff 要新於觸發時間），再結束 turn', 'autopilot:handoff'));
      return;
    }
    for (const t of pending) fires[t].done = true;
    if (!Array.isArray(st.landAudit)) st.landAudit = [];
    st.landAudit.push(`${new Date().toISOString()} context-land-gate gave up: ${pending.join('+')} fired, no handoff newer than the fire after ${MAX_BLOCKS} blocks`);
    fs.writeFileSync(stateFile, JSON.stringify(st));
  } finally {
    if (release) { try { release(); } catch { /* ignore */ } }
  }
}

try { main(); } catch (e) {
  try { process.stderr.write(`context-land-gate error (fail-open): ${e.message}\n`); } catch { /* ignore */ }
}
process.exit(0);
