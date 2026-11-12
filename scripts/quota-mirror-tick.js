#!/usr/bin/env node
'use strict';

// scripts/quota-mirror-tick.js — one pass of the fleet.quota/1 mirror producer (PM 01M7876Z, PM 01M788HW).
// Autopilot owns the mirror; codeforge only reads it. A systemd --user timer calls this.
// Nothing here is a resident process.
//
//   node scripts/quota-mirror-tick.js [--steps id,id] [--out-dir DIR]
//
// Steps, in order, each with its own timeout. One failure never stops the others.
// --steps runs only the named step ids, still in this order. An unknown id exits 2 and runs nothing.
// Exit 0 when at least one producer exited 0; exit 1 only when every producer failed;
// exit 2 on usage. Producers are usage-probe, sync-statusline, sync-provider minimax
// and sync-provider glm. The smoke check runs after them and prints its own line.
// It does not count toward that exit: a live dir left valid by an earlier tick must
// not hide a tick where every producer failed.
// --out-dir is an already-existing shared directory (not a tmpfs live dir). Provider steps
// write fleet.quota/1 rows under <dir>/quota and the smoke step runs against <dir>.
// usage-probe and sync-statusline keep writing the live dir.
// After the producers, runs scripts/g40-real-data/check.sh against the resolved live dir
// (AUTOPILOT_LIVE_DIR, else the live-state-dir.js chain) and prints that verdict on its own line.
// Then appends one idle line per Claude alias that has just become idle (BL-0372 task 4): the
// merged mirror shows rolling_5h absent or its resets_at already in the past, and accounts-audit.jsonl
// has no attempt for that alias in the last 5.5 h. The line is <live_dir>/quota/idle-alias.jsonl.
// One summary line per step. Child stdout and stderr are discarded, so a credential a child
// printed is never read back and never printed. This process opens no credential file.
//
// QUOTA_MIRROR_BIN (tests only) is a directory of executables named after each step id.
// They receive the same argv the real command would, after the script path.
//
// Node >= 20.10, built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLiveDir } = require('./lib/live-state-dir');
const { ensurePrivateDir } = require('./lib/runtime-paths');
const audit = require('./lib/account-audit');
const mirrors = require('./lib/quota-mirror-dirs');

const STEP_TIMEOUT_MS = Object.freeze({
  'usage-probe': 90000,
  'sync-statusline': 20000,
  'sync-provider-minimax': 25000,
  // HTTP 10s plus the glm first-used watch, which sends with a 30s timeout per recipient.
  'sync-provider-glm': 90000,
  smoke: 60000,
});

const STEPS = Object.freeze([
  'usage-probe',
  'sync-statusline',
  'sync-provider-minimax',
  'sync-provider-glm',
  'smoke',
]);

const IDLE_MS = 5.5 * 3600 * 1000;

function usage() {
  process.stdout.write(
    'usage: node scripts/quota-mirror-tick.js [--steps id,id] [--out-dir DIR]\n' +
    'One pass: usage-probe --due, sync-statusline, sync-provider minimax, sync-provider glm,\n' +
    'then scripts/g40-real-data/check.sh <live_dir>. Exit 1 only when every producer failed.\n' +
    '--steps runs only those step ids (an unknown id exits 2). --out-dir writes provider rows\n' +
    'under <dir>/quota and points the smoke check at <dir>.\n'
  );
}

function producer(id, outDir) {
  const node = process.execPath;
  const account = path.join(__dirname, 'claude-account.js');
  const sync = path.join(__dirname, 'quota-provider-sync.js');
  switch (id) {
    case 'usage-probe':
      return { file: node, args: [account, 'usage-probe', '--due'] };
    case 'sync-statusline':
      return { file: node, args: [account, 'sync-statusline'] };
    case 'sync-provider-minimax': {
      const args = [sync, 'sync-provider', '--provider', 'minimax'];
      if (outDir) args.push('--out-dir', outDir);
      return { file: node, args };
    }
    case 'sync-provider-glm': {
      const args = [sync, 'sync-provider', '--provider', 'glm'];
      if (outDir) args.push('--out-dir', outDir);
      return { file: node, args };
    }
    default:
      return null;
  }
}

function stubArgs(id, liveDir, outDir) {
  switch (id) {
    case 'usage-probe':
      return ['--due'];
    case 'sync-statusline':
      return [];
    case 'sync-provider-minimax':
      return outDir ? ['--provider', 'minimax', '--out-dir', outDir] : ['--provider', 'minimax'];
    case 'sync-provider-glm':
      return outDir ? ['--provider', 'glm', '--out-dir', outDir] : ['--provider', 'glm'];
    case 'smoke':
      return [outDir || liveDir];
    default:
      return [];
  }
}

function classify(spawned) {
  if (spawned.error && spawned.error.code === 'ENOENT') return { ok: false, detail: 'missing' };
  if (spawned.error && spawned.error.code === 'ETIMEDOUT') return { ok: false, detail: 'timeout' };
  if (spawned.status === 0) return { ok: true, detail: '' };
  if (typeof spawned.status === 'number') return { ok: false, detail: `exit=${spawned.status}` };
  if (spawned.signal) return { ok: false, detail: 'timeout' };
  return { ok: false, detail: 'fail' };
}

function spawnStep(file, args, timeoutMs) {
  return spawnSync(file, args, {
    timeout: timeoutMs,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
}

function runStep(id, outDir) {
  const timeoutMs = STEP_TIMEOUT_MS[id];
  const bin = process.env.QUOTA_MIRROR_BIN;
  if (id === 'smoke') {
    let liveDir = outDir;
    if (!liveDir) {
      try {
        liveDir = resolveLiveDir({ env: process.env, warn: () => {} }).base;
      } catch (_) {
        return { id, ok: false, detail: 'live_dir_refused' };
      }
    }
    if (bin) return { id, ...classify(spawnStep(path.join(bin, id), stubArgs(id, liveDir, outDir), timeoutMs)) };
    const check = path.join(__dirname, 'g40-real-data', 'check.sh');
    return { id, ...classify(spawnStep('bash', [check, liveDir], timeoutMs)) };
  }
  if (bin) return { id, ...classify(spawnStep(path.join(bin, id), stubArgs(id, null, outDir), timeoutMs)) };
  const cmd = producer(id, outDir);
  return { id, ...classify(spawnStep(cmd.file, cmd.args, timeoutMs)) };
}

function summary(result) {
  if (result.ok) return `quota-mirror-tick: ${result.id} ok`;
  return `quota-mirror-tick: ${result.id} fail ${result.detail}`;
}

// Same file claude-account.js writes: AUTOPILOT_STATE_DIR, else auditPath (XDG_STATE_HOME or ~/.local/state).
function auditFileOf(env, home) {
  const e = env || process.env;
  if (typeof e.AUTOPILOT_STATE_DIR === 'string' && e.AUTOPILOT_STATE_DIR !== '') {
    return path.join(e.AUTOPILOT_STATE_DIR, 'accounts-audit.jsonl');
  }
  return audit.auditPath(e, home || os.homedir());
}

function fiveHourState(record, nowS) {
  const windows = record && Array.isArray(record.windows) ? record.windows : [];
  const w = windows.find((x) => x && x.kind === 'rolling_5h');
  if (!w) return 'absent';
  if (typeof w.resets_at === 'number' && w.resets_at < nowS) return 'reset';
  return null;
}

function lastIdleLabels(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { labels: new Map() };
    return { error: true };
  }
  const labels = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let j;
    try { j = JSON.parse(line); } catch (_) { continue; }
    if (!j || typeof j.alias !== 'string') continue;
    if (j.five_hour !== 'absent' && j.five_hour !== 'reset') continue;
    labels.set(j.alias, j.five_hour);
  }
  return { labels };
}

// One line per alias per transition into absent or reset. A repeat of the same label does not append.
// opts: { liveDir, env, home, auditFile, nowMs }. Never throws. Does not read a token.
function appendIdleAliases(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  const nowS = Math.floor(nowMs / 1000);
  let liveDir = o.liveDir;
  if (typeof liveDir !== 'string' || liveDir === '') {
    try { liveDir = resolveLiveDir({ env, warn: () => {} }).base; } catch (_) { return { appended: [] }; }
  }
  const home = o.home || os.homedir();
  const auditFile = o.auditFile || auditFileOf(env, home);
  let auditRes;
  try { auditRes = audit.readAudit(auditFile); } catch (_) { return { appended: [] }; }
  if (!auditRes || auditRes.refused) return { appended: [] };
  const attempts = Array.isArray(auditRes.records) ? auditRes.records : [];
  let merged;
  try { merged = mirrors.readMerged({ liveDir, env, home, provider: 'claude' }); } catch (_) { return { appended: [] }; }
  const idleFile = path.join(liveDir, 'quota', 'idle-alias.jsonl');
  const prior = lastIdleLabels(idleFile);
  if (prior.error) return { appended: [] };
  const cutoff = nowMs - IDLE_MS;
  const appended = [];
  for (const item of merged.records) {
    const record = item && item.record;
    if (!record || record.provider !== 'claude') continue;
    const state = fiveHourState(record, nowS);
    if (state === null) continue;
    const recent = attempts.some((r) => r && r.alias === record.alias && r.attempt >= 1 && typeof r.ts === 'number' && r.ts >= cutoff);
    if (recent) continue;
    if (prior.labels.get(record.alias) === state) continue;
    appended.push({ alias: record.alias, observed_at: nowS, five_hour: state });
  }
  if (appended.length === 0) return { appended };
  const made = ensurePrivateDir(path.join(liveDir, 'quota'));
  if (!made.ok) return { appended: [] };
  const body = appended.map((row) => `${JSON.stringify(row)}\n`).join('');
  let fd;
  try {
    fd = fs.openSync(idleFile, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    if (!fs.fstatSync(fd).isFile()) return { appended: [] };
    fs.fchmodSync(fd, 0o600);
    fs.writeSync(fd, body);
  } catch (_) {
    return { appended: [] };
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
  return { appended };
}

function run(opts) {
  const o = opts || {};
  const steps = Array.isArray(o.steps) ? STEPS.filter((id) => o.steps.includes(id)) : STEPS;
  const outDir = o.outDir || null;
  const results = [];
  for (const step of steps) {
    results.push(runStep(step, outDir));
  }
  let ok = 0;
  let producers = 0;
  for (const result of results) {
    process.stdout.write(`${summary(result)}\n`);
    // Smoke is a post-step check of the live dir. It is printed above and is not
    // a producer, so it is neither a success nor a failure for the exit.
    if (result.id === 'smoke') continue;
    producers += 1;
    if (result.ok) ok += 1;
  }
  process.stdout.write(`quota-mirror-tick: ${ok}/${producers} ok\n`);
  try { appendIdleAliases({ env: process.env, nowMs: o.nowMs }); } catch (_) { /* idle never changes the producer exit */ }
  if (producers > 0 && ok === 0) return 1;
  return 0;
}

function parseArgs(argv) {
  const out = { steps: null, outDir: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--steps') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: 'steps' };
      i += 1;
      const ids = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (ids.length === 0) return { error: 'steps' };
      for (const id of ids) if (!STEPS.includes(id)) return { error: 'unknown_step', id };
      out.steps = ids;
      continue;
    }
    if (a === '--out-dir') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: 'out_dir' };
      i += 1;
      out.outDir = v;
      continue;
    }
    return { error: 'unknown' };
  }
  return out;
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    usage();
    return 0;
  }
  if (parsed.error) {
    if (parsed.error === 'unknown_step') process.stderr.write(`quota-mirror-tick: unknown step ${parsed.id}\n`);
    else if (parsed.error === 'steps') process.stderr.write('quota-mirror-tick: --steps needs a comma-separated list of step ids\n');
    else if (parsed.error === 'out_dir') process.stderr.write('quota-mirror-tick: --out-dir needs a directory\n');
    else process.stderr.write('quota-mirror-tick: unknown argument\n');
    return 2;
  }
  let outDir = null;
  if (parsed.outDir) {
    const problem = mirrors.sharedOutDirProblem(parsed.outDir);
    if (problem) {
      process.stderr.write(`quota-mirror-tick: out_dir_refused:${problem}\n`);
      return 2;
    }
    outDir = path.resolve(parsed.outDir);
  }
  return run({ steps: parsed.steps, outDir });
}

module.exports = { appendIdleAliases, STEPS };

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
