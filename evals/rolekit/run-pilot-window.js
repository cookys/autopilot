#!/usr/bin/env node
'use strict';
// run-pilot-window.js -- runs the pilot inside a "default account window" and always puts the previous default back.
//   node evals/rolekit/run-pilot-window.js --pilot-alias <alias> [--account-js <path>] [--runner <path>] -- <run-pilot.js args without --account>
// 1. `claude-account.js set-default <alias>` (backs up registry.json and prints the restore command `set-default --restore <backup>`);
// 2. runs `node run-pilot.js --account <alias> <args>` with inherited stdio;
// 3. in a finally path that also covers SIGINT / SIGTERM / SIGHUP and a failing run: `claude-account.js set-default --restore <backup>`.
// The window exists because the rails dispatch every claude-native call as the host default alias (`run --pin-default`): while it is open,
// ALL claude-native rail work on this host (dispatch-review.sh, dispatch-author.sh, dispatch-hetero.sh, by anyone) uses the pilot account.
// Exit code: the runner's code; 128+signal when interrupted; 9 when the restore itself failed (the manual command is printed);
// 2 when the window could not be opened (nothing changed, or the restore command could not be read: then the printed text says so).
// --account-js and --runner are test seams (a shim recording calls); the defaults are the real scripts.
const cp = require('child_process');
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

function main() {
  let o;
  try { o = parse(process.argv.slice(2)); } catch (e) { console.error(`run-pilot-window: ${e.message}`); return 2; }
  let signalled = null; let child = null;
  for (const s of Object.keys(SIGNALS)) { // registered before the window opens: a signal during set-default is handled once it returns
    process.on(s, () => { signalled = s; if (child && child.exitCode === null && child.signalCode === null) child.kill(s); });
  }
  const open = cp.spawnSync('node', [o.accountJs, 'set-default', o.alias], { encoding: 'utf8', input: '' });
  const text = `${open.stdout || ''}\n${open.stderr || ''}`;
  if (open.status !== 0) { console.error(`run-pilot-window: set-default ${o.alias} failed (rc ${open.status}); nothing was changed\n${text.trim()}`); return 2; }
  const m = text.match(/set-default --restore (\S+)/);
  if (!m) { console.error(`run-pilot-window: set-default succeeded but printed no "set-default --restore <backup>" line; refusing to run. Look for the registry.json backup next to the registry before doing anything else.\n${text.trim()}`); return 2; }
  const backup = m[1];
  let restored = false;
  const restore = () => {
    if (restored) return 0;
    restored = true;
    const r = cp.spawnSync('node', [o.accountJs, 'set-default', '--restore', backup], { encoding: 'utf8', input: '' });
    if (r.status !== 0) { console.error(`run-pilot-window: RESTORE FAILED (rc ${r.status}). Run by hand: node ${o.accountJs} set-default --restore ${backup}\n${(r.stderr || '').trim()}`); return 9; }
    return 0;
  };
  return new Promise((resolve) => {
    if (signalled) { const rc = restore(); resolve(rc !== 0 ? rc : 128 + SIGNALS[signalled]); return; }
    child = cp.spawn('node', [o.runner, '--account', o.alias, ...o.rest], { stdio: 'inherit' });
    child.on('error', (e) => { console.error(`run-pilot-window: could not start the runner: ${e.message}`); done(1); });
    child.on('exit', (code, sig) => done(sig ? 128 + (SIGNALS[sig] || 15) : code === null ? 1 : code));
    let finished = false;
    function done(code) {
      if (finished) return; finished = true;
      const rc = restore();
      resolve(rc !== 0 ? rc : signalled ? 128 + SIGNALS[signalled] : code);
    }
  });
}

Promise.resolve(main()).then((code) => process.exit(code));
