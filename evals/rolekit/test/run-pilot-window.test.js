'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, tmp, rm } = require('./helpers.js');

const WINDOW = path.join(ROOT, 'run-pilot-window.js');

// A shim for claude-account.js (records every call, prints the restore line like the real set-default) and a shim runner.
function shims(d, { setDefaultRc = 0, printRestore = true, restoreRc = 0 } = {}) {
  const log = path.join(d, 'calls.log');
  const acct = path.join(d, 'account-shim.js');
  fs.writeFileSync(acct, `const fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},'account '+a.join(' ')+'\\n');
if(a[0]==='set-default'&&a[1]==='--restore'){process.exit(${restoreRc});}
if(a[0]==='set-default'){${printRestore ? "console.log('backup written; restore with: set-default --restore /fake/registry.json.bak-1');" : ''}process.exit(${setDefaultRc});}
process.exit(64);`);
  const runner = path.join(d, 'runner-shim.js');
  fs.writeFileSync(runner, `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'runner '+process.argv.slice(2).join(' ')+'\\n');
const m=process.env.SHIM_MODE||'ok';
if(m==='ok')process.exit(0);
if(m==='fail')process.exit(3);
fs.writeFileSync(${JSON.stringify(path.join(d, 'started'))},'1');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(143));`);
  return { log, acct, runner, lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}
const run = (d, sh, mode, extra = []) => cp.spawnSync('node', [WINDOW, '--pilot-alias', 'pilot', '--account-js', sh.acct, '--runner', sh.runner, '--', '--out', '/x', ...extra],
  { encoding: 'utf8', input: '', env: { ...process.env, SHIM_MODE: mode } });

test('window: success: set-default, the runner with --account, then restore; exit 0', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(d, sh, 'ok');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(sh.lines(), ['account set-default pilot', 'runner --account pilot --out /x', 'account set-default --restore /fake/registry.json.bak-1']);
  } finally { rm(d); }
});

test('window: the runner fails: the restore still runs and the runner exit code is kept', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(d, sh, 'fail');
    assert.strictEqual(r.status, 3);
    assert.strictEqual(sh.lines()[2], 'account set-default --restore /fake/registry.json.bak-1');
  } finally { rm(d); }
});

test('window: SIGTERM during the run: the runner is stopped, the restore runs, exit 143', async () => {
  const d = tmp();
  try {
    const sh = shims(d);
    const child = cp.spawn('node', [WINDOW, '--pilot-alias', 'pilot', '--account-js', sh.acct, '--runner', sh.runner, '--', '--out', '/x'], { env: { ...process.env, SHIM_MODE: 'hang' }, stdio: 'ignore' });
    const code = new Promise((res) => child.on('exit', (c, s) => res(c === null ? `sig:${s}` : c)));
    for (let i = 0; i < 200 && !fs.existsSync(path.join(d, 'started')); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(d, 'started')), 'runner shim started');
    child.kill('SIGTERM');
    assert.strictEqual(await code, 143);
    assert.strictEqual(sh.lines()[sh.lines().length - 1], 'account set-default --restore /fake/registry.json.bak-1');
  } finally { rm(d); }
});

test('window: set-default fails: the runner never starts and nothing is restored; no restore line printed: refuses to run', () => {
  const d = tmp();
  try {
    const bad = shims(d, { setDefaultRc: 2 }); const r1 = run(d, bad, 'ok');
    assert.strictEqual(r1.status, 2);
    assert.deepStrictEqual(bad.lines(), ['account set-default pilot']);
    fs.rmSync(path.join(d, 'calls.log'));
    const noLine = shims(d, { printRestore: false }); const r2 = run(d, noLine, 'ok');
    assert.strictEqual(r2.status, 2); assert.match(r2.stderr, /printed no "set-default --restore/);
    assert.ok(!noLine.lines().some((l) => l.startsWith('runner')));
  } finally { rm(d); }
});

test('window: a failing restore is loud: exit 9 with the manual command', () => {
  const d = tmp();
  try {
    const sh = shims(d, { restoreRc: 5 }); const r = run(d, sh, 'ok');
    assert.strictEqual(r.status, 9);
    assert.match(r.stderr, /RESTORE FAILED.*set-default --restore \/fake\/registry\.json\.bak-1/);
  } finally { rm(d); }
});

test('window: --account after -- is refused (the window supplies it)', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(d, sh, 'ok', ['--account', 'other']);
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(sh.lines(), []);
  } finally { rm(d); }
});
