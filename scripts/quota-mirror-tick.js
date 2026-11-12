#!/usr/bin/env node
'use strict';

// scripts/quota-mirror-tick.js — one pass of the fleet.quota/1 mirror producer (PM 01M7876Z).
// Autopilot owns the mirror; codeforge only reads it. A systemd --user timer calls this.
// Nothing here is a resident process.
//
//   node scripts/quota-mirror-tick.js
//
// Steps, in order, each with its own timeout. One failure never stops the others.
// Exit 0 when at least one producer exited 0; exit 1 only when every producer failed;
// exit 2 on usage. Producers are usage-probe, sync-statusline, sync-provider minimax
// and sync-provider glm. The smoke check runs after them and prints its own line.
// It does not count toward that exit: a live dir left valid by an earlier tick must
// not hide a tick where every producer failed.
// After the producers, runs scripts/g40-real-data/check.sh against the resolved live dir
// (AUTOPILOT_LIVE_DIR, else the live-state-dir.js chain) and prints that verdict on its own line.
// One summary line per step. Child stdout and stderr are discarded, so a credential a child
// printed is never read back and never printed. This process opens no credential file.
//
// QUOTA_MIRROR_BIN (tests only) is a directory of executables named after each step id.
// They receive the same argv the real command would, after the script path.
//
// Node >= 20.10, built-ins only.

const path = require('path');
const { spawnSync } = require('child_process');
const { resolveLiveDir } = require('./lib/live-state-dir');

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

function usage() {
  process.stdout.write(
    'usage: node scripts/quota-mirror-tick.js\n' +
    'One pass: usage-probe --due, sync-statusline, sync-provider minimax, sync-provider glm,\n' +
    'then scripts/g40-real-data/check.sh <live_dir>. Exit 1 only when every producer failed.\n'
  );
}

function producer(id) {
  const node = process.execPath;
  const account = path.join(__dirname, 'claude-account.js');
  const sync = path.join(__dirname, 'quota-provider-sync.js');
  switch (id) {
    case 'usage-probe':
      return { file: node, args: [account, 'usage-probe', '--due'] };
    case 'sync-statusline':
      return { file: node, args: [account, 'sync-statusline'] };
    case 'sync-provider-minimax':
      return { file: node, args: [sync, 'sync-provider', '--provider', 'minimax'] };
    case 'sync-provider-glm':
      return { file: node, args: [sync, 'sync-provider', '--provider', 'glm'] };
    default:
      return null;
  }
}

function stubArgs(id, liveDir) {
  switch (id) {
    case 'usage-probe':
      return ['--due'];
    case 'sync-statusline':
      return [];
    case 'sync-provider-minimax':
      return ['--provider', 'minimax'];
    case 'sync-provider-glm':
      return ['--provider', 'glm'];
    case 'smoke':
      return [liveDir];
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

function runStep(id) {
  const timeoutMs = STEP_TIMEOUT_MS[id];
  const bin = process.env.QUOTA_MIRROR_BIN;
  if (id === 'smoke') {
    let liveDir;
    try {
      liveDir = resolveLiveDir({ env: process.env, warn: () => {} }).base;
    } catch (_) {
      return { id, ok: false, detail: 'live_dir_refused' };
    }
    if (bin) return { id, ...classify(spawnStep(path.join(bin, id), stubArgs(id, liveDir), timeoutMs)) };
    const check = path.join(__dirname, 'g40-real-data', 'check.sh');
    return { id, ...classify(spawnStep('bash', [check, liveDir], timeoutMs)) };
  }
  if (bin) return { id, ...classify(spawnStep(path.join(bin, id), stubArgs(id), timeoutMs)) };
  const cmd = producer(id);
  return { id, ...classify(spawnStep(cmd.file, cmd.args, timeoutMs)) };
}

function summary(result) {
  if (result.ok) return `quota-mirror-tick: ${result.id} ok`;
  return `quota-mirror-tick: ${result.id} fail ${result.detail}`;
}

function run() {
  const results = [];
  for (const step of STEPS) {
    results.push(runStep(step));
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
  if (producers > 0 && ok === 0) return 1;
  return 0;
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return 0;
  }
  if (argv.length > 0) {
    process.stderr.write('quota-mirror-tick: unknown argument\n');
    return 2;
  }
  return run();
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
