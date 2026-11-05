#!/usr/bin/env node
'use strict';
// run-pilot-window.js -- runs the pilot inside a "default account window" and always puts the previous default back.
//   node evals/rolekit/run-pilot-window.js --pilot-alias <alias> [--account-js <path>] [--runner <path>] -- <run-pilot.js args without --account>
// 0. records the current host default alias (resolved by claude-account.js itself: `run --pin-default` with a tiny non-claude child);
// 1. `claude-account.js set-default <alias>` (backs up registry.json and prints the restore command `set-default --restore <backup>`);
// 2. runs `node run-pilot.js --account <alias> ...` with inherited stdio;
// 3. in a finally path that also covers SIGINT / SIGTERM / SIGHUP and a failing run: `claude-account.js set-default --restore <backup>`.
// The open step is covered too: signal handlers are installed before set-default is spawned, and the backup line is parsed from its output
// whatever its exit status. If set-default failed, was killed (e.g. by a process-group SIGTERM) or printed no backup line, the wrapper
// does not trust "nothing changed": with a backup line it restores from it; without one it re-resolves the default and, when it is no longer
// the recorded previous alias, runs `set-default <previous alias>`. (That fallback puts the default back, not necessarily every
// priority number byte for byte; the printed backup is the exact path and is always preferred.)
// The window exists because the rails dispatch every claude-native call as the host default alias (`run --pin-default`): while it is open,
// ALL claude-native rail work on this host (dispatch-review.sh, dispatch-author.sh, dispatch-hetero.sh, by anyone) uses the pilot account.
// Exit code: the runner's code; 128+signal when interrupted; 9 when a restore failed (the manual command is printed);
// 2 when the window could not be opened (anything it changed was put back first).
// --account-js and --runner are test seams (a shim recording calls); the defaults are the real scripts.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const SIGNALS = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };

function parse(argv) {
  const o = { accountJs: path.join(REPO, 'scripts/claude-account.js'), runner: path.join(__dirname, 'run-pilot.js'), rest: [] };
  const i = argv.indexOf('--');
  const head = i < 0 ? argv : argv.slice(0, i);
  o.rest = i < 0 ? [] : argv.slice(i + 1);
  for (let k = 0; k < head.length; k += 2) {
    const f = head[k]; const v = head[k + 1];
    if (v === undefined) throw new Error(`${f} needs a value`);
    if (f === '--pilot-alias') o.alias = v; else if (f === '--account-js') o.accountJs = v; else if (f === '--runner') o.runner = v; else throw new Error(`unknown option ${f}`);
  }
  if (!o.alias || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(o.alias)) throw new Error('--pilot-alias <alias> is required');
  if (o.rest.includes('--account')) throw new Error('do not pass --account after --: the window supplies it');
  return o;
}

// The host default alias as claude-account.js resolves it (the same probe run-pilot.js uses); null when it cannot be resolved.
function currentDefault(accountJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-window-'));
  const f = path.join(dir, 'alias.txt');
  try {
    const r = cp.spawnSync('node', [accountJs, 'run', '--pin-default', '--purpose', 'author', '--stdout', f, '--', '/bin/sh', '-c', 'printf %s "$AUTOPILOT_ACCOUNT"'], { encoding: 'utf8', input: '' });
    if (r.status !== 0) return null;
    return fs.readFileSync(f, 'utf8').trim() || null;
  } catch (e) { return null; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(`run-pilot-window: ${e.message}`); return 2; }
  let signalled = null; let child = null;
  for (const s of Object.keys(SIGNALS)) { // before anything is spawned: a signal during set-default is acted on once it returns
    process.on(s, () => { signalled = s; if (child && child.exitCode === null && child.signalCode === null) child.kill(s); });
  }
  const previous = currentDefault(o.accountJs);
  if (!previous) { console.error('run-pilot-window: cannot resolve the current host default alias (claude-account.js run --pin-default failed); refusing to open the window because the previous default could not be put back'); return 2; }

  const accountCall = (args) => cp.spawnSync('node', [o.accountJs, ...args], { encoding: 'utf8', input: '' });
  const restoreFromBackup = (backup) => {
    const r = accountCall(['set-default', '--restore', backup]);
    if (r.status !== 0) { console.error(`run-pilot-window: RESTORE FAILED (rc ${r.status}). Run by hand: node ${o.accountJs} set-default --restore ${backup}\n${(r.stderr || '').trim()}`); return 9; }
    return 0;
  };
  const restoreToPrevious = () => {
    const now = currentDefault(o.accountJs);
    if (now === previous) return 0; // nothing to put back
    const r = accountCall(['set-default', previous]);
    if (r.status !== 0) { console.error(`run-pilot-window: RESTORE FAILED (rc ${r.status}). The default may still be "${now}"; set it back by hand: node ${o.accountJs} set-default ${previous}\n${(r.stderr || '').trim()}`); return 9; }
    return 0;
  };

  const open = accountCall(['set-default', o.alias]);
  const m = `${open.stdout || ''}\n${open.stderr || ''}`.match(/set-default --restore (\S+)/);
  const backup = m ? m[1] : null;
  // The handlers above only run once the event loop turns, so a signal that killed the set-default child (a process-group signal) is read from its result.
  const openSignal = signalled || (open.signal && SIGNALS[open.signal] ? open.signal : null);
  const cleanOpen = open.status === 0 && !openSignal && backup;
  if (!cleanOpen) { // failed, killed, interrupted, or printed no backup line: whatever it changed is put back before anything else
    const rc = backup ? restoreFromBackup(backup) : restoreToPrevious();
    const why = openSignal ? `interrupted by ${openSignal}` : open.status !== 0 ? `set-default ${o.alias} failed (rc ${open.status})` : 'set-default printed no "set-default --restore <backup>" line';
    console.error(`run-pilot-window: window not opened: ${why}; the previous default "${previous}" was ${rc === 0 ? 'put back' : 'NOT confirmed back'}`);
    return rc !== 0 ? rc : openSignal ? 128 + SIGNALS[openSignal] : 2;
  }

  let restored = false;
  const restore = () => { if (restored) return 0; restored = true; return restoreFromBackup(backup); };
  return new Promise((resolve) => {
    let finished = false;
    const done = (code) => {
      if (finished) return; finished = true;
      const rc = restore();
      resolve(rc !== 0 ? rc : signalled ? 128 + SIGNALS[signalled] : code);
    };
    child = cp.spawn('node', [o.runner, '--account', o.alias, ...o.rest], { stdio: 'inherit' });
    child.on('error', (e) => { console.error(`run-pilot-window: could not start the runner: ${e.message}`); done(1); });
    child.on('exit', (code, sig) => done(sig ? 128 + (SIGNALS[sig] || 15) : code === null ? 1 : code));
  });
}

Promise.resolve(main()).then((code) => process.exit(code));
