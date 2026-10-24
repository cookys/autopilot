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
// --min-window-s left (checked before the first start too; a fresh batch has no window.start yet, so its window is whole), after
// --max-restarts restarts, or on any exit code other than 0 or 7. It never refreshes a token and never touches a credential
// file: it only reads the expiry. Start it with the real HOME (see run-p2-batch.js).
// Lifecycle: the FIRST TERM or INT is a safe pause: the launcher writes <run-dir>/stop.request, tells the wrapper (which only raises a
// flag), waits while the running id finishes and the next id pauses with reason operator_stop, writes the status `stopped_by_operator`
// and exits 0; the batch resumes later (the next start clears the request). A SECOND signal kills the wrapper's whole process
// group at once (status `aborted`; such a batch cannot be audited) and exits 128+n. The wrapper gets --parent-pid, so after a SIGKILL
// of the launcher it pauses before its next id with reason parent_gone. The running wrapper's pid is in <run-dir>/loop.wrapper.pid.
// Exit code: the last wrapper exit code, 9 when it stopped for the window or the restart limit, 0 after a safe stop, 128+n after a hard one.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

const wait = (s) => new Promise((r) => setTimeout(r, Math.max(1, Math.round(s * 1000))));

async function main(argv) {
  const o = parseArgs(argv);
  const wrapper = path.resolve(o.wrapper || path.join(__dirname, 'run-p2-batch.js'));
  const w = require(wrapper);
  const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));
  const runDir = path.resolve(o['run-dir']);
  fs.mkdirSync(runDir, { recursive: true });
  const order = w.makeOrder(manifest.seed, manifest.n_per_arm);
  const status = (text) => fs.writeFileSync(path.join(runDir, 'loop.status'), `${new Date().toISOString()} ${text}\n`);
  if (!(typeof manifest.window_s === 'number' && Number.isFinite(manifest.window_s) && manifest.window_s > 0)) throw new Error('window_s of the manifest is not a positive number');
  // Seconds left of the window. No window.start yet (a fresh batch) -> the whole window; a window.start that is not a positive number -> 0 (stop).
  const windowLeftS = () => {
    let raw; try { raw = fs.readFileSync(path.join(runDir, 'window.start'), 'utf8'); } catch (_e) { return manifest.window_s; }
    const w0 = Number(raw);
    if (!Number.isFinite(w0) || w0 <= 0) return 0;
    return manifest.window_s - (Date.now() - w0) / 1000;
  };
  const credFile = o['credentials-source'] ? path.resolve(o['credentials-source']) : path.join(process.env.HOME || '', '.claude', '.credentials.json');
  const stopFile = path.join(runDir, 'stop.request');
  fs.rmSync(stopFile, { force: true });
  let child = null, signalled = 0, signals = 0, hard = false;
  for (const [name, num] of [['SIGTERM', 15], ['SIGINT', 2], ['SIGHUP', 1]]) {
    process.on(name, () => {
      signals++; signalled = num;
      if (signals === 1) { try { fs.writeFileSync(stopFile, `${new Date().toISOString()} ${name}\n`); } catch (_e) { /* status shows it */ } if (child) { try { process.kill(child.pid, name); } catch (_e) { /* gone */ } } } else { hard = true; if (child) { try { process.kill(-child.pid, 'SIGKILL'); } catch (_e) { /* gone */ } } }
    });
  }
  let restarts = 0;
  for (;;) {
    if (windowLeftS() < Number(o['min-window-s'])) { status(`stopped window_exhausted left_s=${Math.floor(windowLeftS())}`); return 9; }
    // The paused id is the first one with no run output yet.
    const next = order.findIndex((x) => !fs.existsSync(path.join(runDir, 'runs', x.id))) + 1;
    const args = [wrapper, '--run', '--manifest', o.manifest, '--run-dir', runDir, '--clone', o.clone, '--parent-pid', String(process.pid)];
    if (next > 1) args.push('--first', String(next));
    if (o['credentials-source']) args.push('--credentials-source', credFile);
    status(`running restarts=${restarts} first=${next || 1}`);
    const env = w.scrubEnv(process.env); // no CLAUDE*, ANTHROPIC* or XDG home reaches the wrapper's claude children
    child = spawn(process.execPath, args, { stdio: 'inherit', env, detached: true }); // own process group, so the hard stop reaches the wrapper's children too
    fs.writeFileSync(path.join(runDir, 'loop.wrapper.pid'), `${child.pid}\n`);
    const rc = await new Promise((res) => child.on('exit', (code, sig) => res(code === null ? 128 + (sig === 'SIGTERM' ? 15 : 9) : code)));
    child = null;
    if (hard) { status(`aborted hard stop signal=${signalled} wrapper_rc=${rc}: the batch cannot be audited`); return 128 + signalled; }
    if (signalled || fs.existsSync(stopFile)) { status(`stopped_by_operator wrapper_rc=${rc} restarts=${restarts}`); return rc === 0 || rc === 7 ? 0 : rc; }
    if (rc !== 7) { status(`ended rc=${rc} restarts=${restarts}`); return rc; }
    status(`paused rc=7 restarts=${restarts} waiting for a fresh credential source`);
    if (restarts >= Number(o['max-restarts'])) { status(`stopped restart_limit restarts=${restarts}`); return 9; }
    for (;;) {
      if (signalled || fs.existsSync(stopFile)) { status(`stopped_by_operator restarts=${restarts}`); return 0; }
      if (windowLeftS() < Number(o['min-window-s'])) { status(`stopped window_exhausted left_s=${Math.floor(windowLeftS())}`); return 9; }
      const exp = w.credExpiresAt(credFile);
      if (exp === null || exp - Date.now() >= Number(o['fresh-min']) * 60000) break;
      await wait(Number(o['poll-s']));
    }
    // At least one poll interval passes between a pause and its restart, even when the source is already fresh.
    await wait(Number(o['poll-s']));
    if (signalled || fs.existsSync(stopFile)) { status(`stopped_by_operator restarts=${restarts}`); return 0; }
    restarts++;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (e) => { process.stderr.write(`${e.message}\n`); process.exitCode = 2; });
}
