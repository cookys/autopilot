#!/usr/bin/env node
'use strict';
// run-p2-batch-loop.js - keeps a run-p2-batch.js batch going across auth pauses (BL-0055 P2-3).
//
//   node run-p2-batch-loop.js --manifest M --run-dir D --clone C [--credentials-source F] [--wrapper W]
//        [--poll-s 60] [--fresh-min 30] [--min-window-s 600] [--max-restarts 20]
//
// Runs the wrapper. Exit 7 (an id paused at its probe) writes a line to <run-dir>/loop.status, then every --poll-s seconds reads
// claudeAiOauth.expiresAt of the credential source and, once it is at least --fresh-min minutes ahead (the main CLI refreshed
// it), runs the wrapper again from the paused id (--first). It stops when the window (window.start + window_s) has less than
// --min-window-s left, after --max-restarts restarts, or on any exit code other than 0 or 7. It never refreshes a token and
// never touches a credential file: it only reads the expiry. Start it with the real HOME (see run-p2-batch.js).
// Exit code: the last wrapper exit code, or 9 when it stopped for the window or the restart limit.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const o = { 'poll-s': 60, 'fresh-min': 30, 'min-window-s': 600, 'max-restarts': 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unknown argument ${a}`);
    o[a.slice(2)] = argv[++i];
  }
  for (const k of ['manifest', 'run-dir', 'clone']) if (!o[k]) throw new Error(`--${k} is required`);
  return o;
}

const sleep = (s) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Math.round(s * 1000))); };

function main(argv) {
  const o = parseArgs(argv);
  const wrapper = path.resolve(o.wrapper || path.join(__dirname, 'run-p2-batch.js'));
  const w = require(wrapper);
  const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));
  const runDir = path.resolve(o['run-dir']);
  fs.mkdirSync(runDir, { recursive: true });
  const order = w.makeOrder(manifest.seed, manifest.n_per_arm);
  const status = (text) => fs.writeFileSync(path.join(runDir, 'loop.status'), `${new Date().toISOString()} ${text}\n`);
  const windowLeftS = () => {
    try { return manifest.window_s - (Date.now() - Number(fs.readFileSync(path.join(runDir, 'window.start'), 'utf8'))) / 1000; } catch (_e) { return manifest.window_s; }
  };
  const credFile = o['credentials-source'] ? path.resolve(o['credentials-source']) : path.join(process.env.HOME || '', '.claude', '.credentials.json');
  let restarts = 0;
  for (;;) {
    // The paused id is the first one with no run output yet.
    const next = order.findIndex((x) => !fs.existsSync(path.join(runDir, 'runs', x.id))) + 1;
    const args = [wrapper, '--run', '--manifest', o.manifest, '--run-dir', runDir, '--clone', o.clone];
    if (next > 1) args.push('--first', String(next));
    if (o['credentials-source']) args.push('--credentials-source', credFile);
    status(`running restarts=${restarts} first=${next || 1}`);
    const r = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
    const rc = r.status === null ? 130 : r.status;
    if (rc !== 7) { status(`ended rc=${rc} restarts=${restarts}`); return rc; }
    status(`paused rc=7 restarts=${restarts} waiting for a fresh credential source`);
    if (restarts >= Number(o['max-restarts'])) { status(`stopped restart_limit restarts=${restarts}`); return 9; }
    for (;;) {
      if (windowLeftS() < Number(o['min-window-s'])) { status(`stopped window_exhausted left_s=${Math.floor(windowLeftS())}`); return 9; }
      const exp = w.credExpiresAt(credFile);
      if (exp === null || exp - Date.now() >= Number(o['fresh-min']) * 60000) break;
      sleep(Number(o['poll-s']));
    }
    // At least one poll interval passes between a pause and its restart, even when the source is already fresh.
    sleep(Number(o['poll-s']));
    if (windowLeftS() < Number(o['min-window-s'])) { status(`stopped window_exhausted left_s=${Math.floor(windowLeftS())}`); return 9; }
    restarts++;
  }
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 2; }
}
