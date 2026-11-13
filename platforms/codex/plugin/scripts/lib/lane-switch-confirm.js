#!/usr/bin/env node
'use strict';
/**
 * lane-switch-confirm.js — P2 step 8 (project/plans/2026-11-10-profile-switch.md).
 *
 * After a lane switch, poll the ledger hooks/cost-tracker.js appends:
 *   path.join(metricsDirOf(), 'costs.jsonl')
 * which is <target profile>/metrics/costs.jsonl.
 * The writer does not consult AUTOPILOT_COSTS_FILE, so this reader does not either.
 * The target profile comes from --profile, or from the lane manifest when that
 * flag is omitted. home is ~/.claude; any other name is ~/.claude-profiles/<name>.
 * The caller's CLAUDE_CONFIG_DIR is not consulted.
 *
 * confirmSwitch(opts, deps) waits for the first row of this session whose ts is
 * strictly newer than the switch (`opts.since`). The wait ends 30 min after the
 * next turn: `opts.turnAt` when the caller knows it, otherwise deps.now() at
 * entry (step 8 runs at that turn, not at the switch). The row's account must
 * equal the target alias. The alias is an input already produced by
 * scripts/lib/account-alias.js; this module does not compute one and does not
 * open .claude.json or any credentials file.
 *
 *   { ok: true, account }
 *   { ok: false, reason: 'mismatch' | 'no_row_in_window', report, ... }
 *
 * `report` is one Traditional Chinese line for the caller to send to the PM.
 * This module never sends. External commands are not run; a future one must go
 * through deps.run. Clock and wait are deps.now / deps.sleep. File IO is deps.fs
 * (defaults to fs). Tests pass stubs.
 *
 * CLI: node scripts/lib/lane-switch-confirm.js --lane L --since <iso> --alias A [--profile P]
 * Exit: 0 confirmed, 1 mismatch or no row in the window, 2 usage.
 * Node >= 20.10, built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readManifest } = require('./lane-manifest');
const { metricsDirOf } = require('./config-path');

const CONFIRM_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 2000;
const ALIAS_RE = /^[a-z0-9-]{1,24}$/;
const LANE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SESSION_RE = /^[^@\s]{1,128}$/;
const REFUSED_BASENAMES = new Set(['.credentials.json', '.claude.json', 'credentials.json']);

const HELP = [
  '用法：node scripts/lib/lane-switch-confirm.js --lane L --since <iso> --alias A [--profile P]',
  '切換之後確認：讀目標 profile 的 metrics/costs.jsonl，找這個 session 比 --since 新的第一列。',
  '帳本路徑由 --profile 決定；省略時用車道紀錄的 profile。home 讀 ~/.claude/metrics/costs.jsonl，其他 profile 讀 ~/.claude-profiles/<profile>/metrics/costs.jsonl。',
  '等待上限是下一輪起 30 分鐘（此命令啟動的時刻當下一輪；--since 是切換時間）。',
  'account 必須等於 --alias。失敗時 JSON 含一行 report，不送信。',
  '結束碼：0 確認，1 不符或窗內無列，2 用法錯誤。',
].join('\n') + '\n';

function fail(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  const n = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n)) throw fail('clock_invalid');
  return n;
}

// Asia/Taipei is UTC+8 with no DST. Operator-facing times are Taipei.
function taipei(ms) {
  const d = new Date(ms + 8 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} 台北時間`;
}

function publicAccount(v) {
  return typeof v === 'string' && ALIAS_RE.test(v) ? v : null;
}

function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function laneBase(opts, deps, home) {
  return opts.baseDir || deps.baseDir || process.env.AUTOPILOT_LANE_BASE_DIR || path.join(home, '.config', 'autopilot');
}

function readLane(opts, deps, home) {
  let rec;
  try {
    rec = readManifest(laneBase(opts, deps, home), opts.lane);
  } catch (e) {
    throw fail(e.message === 'lane_invalid' ? 'lane_invalid' : 'manifest_unreadable');
  }
  return rec;
}

// Target profile: --profile / opts.profile wins; otherwise the lane manifest.
// home has no CLAUDE_CONFIG_DIR (metricsDirOf then uses ~/.claude). Any other
// name is ~/.claude-profiles/<profile>. The caller's env is not read.
function resolveProfile(opts, deps, home) {
  if (typeof opts.profile === 'string' && opts.profile) {
    if (!PROFILE_RE.test(opts.profile)) throw fail('profile_invalid');
    return opts.profile;
  }
  const rec = readLane(opts, deps, home);
  if (!rec || typeof rec.profile !== 'string' || !rec.profile) throw fail('profile_unknown');
  return rec.profile;
}

function costsPath(opts, deps) {
  if (opts.costsFile) return opts.costsFile;
  if (deps.costsFile) return deps.costsFile;
  const home = deps.home || os.homedir();
  const profile = resolveProfile(opts, deps, home);
  const dir = profile === 'home' ? undefined : path.join(home, '.claude-profiles', profile);
  const env = {};
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  return path.join(metricsDirOf({ env, home }), 'costs.jsonl');
}

function assertCostsPath(file) {
  if (REFUSED_BASENAMES.has(path.basename(file))) throw fail('costs_path_refused');
}

function resolveSession(opts, deps) {
  if (opts.session != null) return opts.session;
  const home = deps.home || os.homedir();
  const rec = readLane(opts, deps, home);
  if (!rec || !rec.session_id) throw fail('session_unknown');
  return rec.session_id;
}

function readCosts(file, fsImpl) {
  try {
    return fsImpl.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) return '';
    throw e;
  }
}

// First row of this session inside (since, deadline], in timestamp order.
function selectRow(text, session, sinceMs, deadlineMs) {
  let best = null;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row || typeof row !== 'object' || row.session !== session) continue;
    const ts = typeof row.ts === 'string' ? Date.parse(row.ts) : NaN;
    if (!Number.isFinite(ts)) continue;
    if (!(ts > sinceMs)) continue; // gate: newer than the switch
    if (ts > deadlineMs) continue;
    if (!best || ts < best.ts || (ts === best.ts && i < best.index)) best = { row, ts, index: i };
  }
  return best ? best.row : null;
}

function reportMismatch(lane, session, shown, alias) {
  return `[換訂閱確認] lane=${lane} session=${session} 切換後第一筆 costs 列的 account 是 ${shown}，與目標別名 ${alias} 不符，請 PM 處理。`;
}

function reportNoRow(lane, session, sinceMs) {
  return `[換訂閱確認] lane=${lane} session=${session} 自 ${taipei(sinceMs)} 的下一輪起 30 分鐘內沒有新的 costs 列，請 PM 處理。`;
}

function confirmSwitch(opts, deps) {
  const o = opts || {};
  const d = deps || {};
  if (!LANE_RE.test(String(o.lane || ''))) throw fail('lane_invalid');
  if (typeof o.since !== 'string' || !ISO_RE.test(o.since) || !Number.isFinite(Date.parse(o.since))) throw fail('since_invalid');
  if (typeof o.alias !== 'string' || !ALIAS_RE.test(o.alias)) throw fail('alias_invalid');
  if (o.turnAt != null && (typeof o.turnAt !== 'string' || !ISO_RE.test(o.turnAt) || !Number.isFinite(Date.parse(o.turnAt)))) throw fail('turn_invalid');
  const session = resolveSession(o, d);
  if (typeof session !== 'string' || !SESSION_RE.test(session)) throw fail('session_invalid');
  const file = costsPath(o, d);
  assertCostsPath(file);
  const sinceMs = Date.parse(o.since);
  const nowFn = d.now || (() => Date.now());
  const sleep = d.sleep || defaultSleep;
  const fsImpl = d.fs || fs;
  const interval = Number.isFinite(d.intervalMs) && d.intervalMs > 0 ? d.intervalMs : DEFAULT_INTERVAL_MS;
  const started = toMs(nowFn());
  const turnMs = o.turnAt != null ? Date.parse(o.turnAt) : started;
  const deadline = turnMs + CONFIRM_WINDOW_MS;

  for (;;) {
    const row = selectRow(readCosts(file, fsImpl), session, sinceMs, deadline);
    if (row) {
      const account = publicAccount(row.account);
      if (account === o.alias) return { ok: true, account };
      return {
        ok: false,
        reason: 'mismatch',
        account,
        expected: o.alias,
        report: reportMismatch(o.lane, session, account || '（非別名）', o.alias),
      };
    }
    const now = toMs(nowFn());
    if (now >= deadline) {
      return { ok: false, reason: 'no_row_in_window', report: reportNoRow(o.lane, session, sinceMs) };
    }
    const before = now;
    sleep(Math.min(interval, deadline - now));
    if (toMs(nowFn()) <= before) throw fail('clock_stuck');
  }
}

function parse(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--lane' || a === '--since' || a === '--alias' || a === '--profile') {
      if (i + 1 >= argv.length || String(argv[i + 1]).startsWith('--')) return { error: `${a} 需要值` };
      o[a.slice(2)] = argv[++i];
    } else if (a.startsWith('--')) return { error: `不明的參數 ${a}` };
    else return { error: '不明的參數' };
  }
  return o;
}

function main(argv, deps) {
  const d = deps || {};
  const out = d.out || ((s) => process.stdout.write(s));
  const err = d.err || ((s) => process.stderr.write(s));
  const o = parse(argv);
  if (o.error) { err(`lane-switch-confirm: ${o.error}\n`); return 2; }
  if (o.help) { out(HELP); return 0; }
  if (!o.lane || !o.since || !o.alias) { err('lane-switch-confirm: 需要 --lane、--since、--alias\n'); return 2; }
  try {
    const result = confirmSwitch({
      lane: o.lane,
      since: o.since,
      alias: o.alias,
      profile: o.profile,
      baseDir: d.baseDir,
      costsFile: d.costsFile,
    }, d);
    out(JSON.stringify(result) + '\n');
    return result.ok ? 0 : 1;
  } catch (e) {
    const code = (e && e.code) || 'error';
    err(`lane-switch-confirm: ${code}\n`);
    return code === 'alias_invalid' || code === 'since_invalid' || code === 'lane_invalid'
      || code === 'session_unknown' || code === 'session_invalid' || code === 'manifest_unreadable'
      || code === 'turn_invalid' || code === 'costs_path_refused'
      || code === 'profile_invalid' || code === 'profile_unknown'
      ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { CONFIRM_WINDOW_MS, confirmSwitch, main, parse, HELP };
