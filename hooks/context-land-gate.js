#!/usr/bin/env node
/**
 * context-land-gate — Stop hook (default-on).
 *
 * hooks/context-budget.js records the first T2 / T3 land-checklist fire per tier in the per-session
 * state file (`landFire.<tier> = {at, blocks, done}`). This hook compares that fire time with the mtime
 * of the session's handoff file and:
 *   - handoff older than the fire (or missing): blocks the stop, reason = run /handoff. At most 2 blocks
 *     per tier fire; the 3rd stop is allowed and one audit line is appended to the state (`landAudit`).
 *   - handoff written after the fire: the first Stop after it blocks once more with a reason that tells the
 *     model to relay one copyable line to the operator (`read <path> 接續`, plugin can be updated and the
 *     session restarted); every later stop is allowed.
 * Handoff file candidates: the path the checklist names ($XDG_RUNTIME_DIR/autopilot/handoff/<sid>.md, else
 * <live base>/handoff/<sid>.md) and the skill's manual route (scripts/resolve-repo-placement.js handoff --route manual).
 * Skips: context_budget mode off, subagent payloads (agent_id), no state file, no fire recorded.
 * Fail-open: any error exits 0 with no decision.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { readContextBudget } = require('../scripts/lib/config-path.js');
const { resolveLiveDir } = require('../scripts/lib/live-state-dir.js');
const { lockStateFile, sessionIdOf, stateDirOf, sessionHandoffPath } = require('./context-budget-lib.js');

const MAX_BLOCKS = 2;
const TIERS = ['t3', 't2']; // highest first

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

    if (landed) {
      for (const t of pending) fires[t].done = true;
      fs.writeFileSync(stateFile, JSON.stringify(st));
      block(`handoff 已寫好。請把下面這行原樣轉給操作員，並告訴他：plugin 可以更新、session 可以重啟了。\nread ${landed} 接續`);
      return;
    }

    const top = pending[0];
    const f = fires[top];
    const sessionPath = paths[0];
    if ((f.blocks || 0) < MAX_BLOCKS) {
      f.blocks = (f.blocks || 0) + 1;
      fs.writeFileSync(stateFile, JSON.stringify(st));
      block(`Context ${top.toUpperCase()} 已觸發，但 handoff 檔還沒寫（或比觸發時間舊）。先回答落地清單、把沒寫回 repo 的東西落地，再執行 /handoff（autopilot:handoff skill），handoff 寫到 ${sessionPath}。（第 ${f.blocks}/${MAX_BLOCKS} 次擋停）`);
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
