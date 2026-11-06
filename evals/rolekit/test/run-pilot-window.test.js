'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { ROOT, tmp, rm } = require('./helpers.js');

const WINDOW = path.join(ROOT, 'run-pilot-window.js');

// A shim for claude-account.js with a one-key "registry" (the default alias, starting as "prev"): `run --pin-default` writes the
// default to --stdout, `set-default X` backs up and mutates it and prints the restore line like the real subcommand, `set-default --restore B`
// puts the backup back. SHIM_OPEN picks how the FIRST set-default misbehaves: ok | fail-after-mutate | hang-after-print | hang-before-print
// (mutates, prints nothing, hangs) | no-print | fail-no-mutate. Only set-default calls are logged.
function shims(d, { restoreRc = 0 } = {}) {
  const log = path.join(d, 'calls.log');
  const state = path.join(d, 'registry.json');
  fs.writeFileSync(state, JSON.stringify({ default: 'prev' }));
  const acct = path.join(d, 'account-shim.js');
  fs.writeFileSync(acct, `const fs=require('fs');const a=process.argv.slice(2);const ST=${JSON.stringify(state)};const LOG=${JSON.stringify(log)};
const get=()=>JSON.parse(fs.readFileSync(ST,'utf8')).default;const put=(x)=>fs.writeFileSync(ST,JSON.stringify({default:x}));
const calls=()=>fs.existsSync(LOG)?fs.readFileSync(LOG,'utf8').trim().split('\\n').filter((l)=>/set-default [^-]/.test(l)).length:0;
if(a[0]==='run'){fs.writeFileSync(a[a.indexOf('--stdout')+1],get());process.exit(0);}
if(a[0]==='set-default'&&a[1]==='--restore'){fs.appendFileSync(LOG,'account set-default --restore '+a[2]+'\\n');if(${restoreRc})process.exit(${restoreRc});put(JSON.parse(fs.readFileSync(a[2],'utf8')).default);process.exit(0);}
if(a[0]==='set-default'){const first=calls()===0;fs.appendFileSync(LOG,'account set-default '+a[1]+'\\n');const mode=first?(process.env.SHIM_OPEN||'ok'):'ok';
  if(mode==='fail-no-mutate')process.exit(2);
  const bak=ST+'.bak';fs.writeFileSync(bak,JSON.stringify({default:get()}));put(a[1]);
  if(mode==='hang-before-print'){setInterval(()=>{},1000);return;}
  if(mode!=='no-print')console.log('backup written; restore with: set-default --restore '+bak);
  if(mode==='hang-after-print'){setInterval(()=>{},1000);return;}
  if(mode==='fail-after-mutate')process.exit(2);
  process.exit(0);}
process.exit(64);`);
  const runner = path.join(d, 'runner-shim.js');
  fs.writeFileSync(runner, `const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'runner '+process.argv.slice(2).join(' ')+'\\n');
const m=process.env.SHIM_MODE||'ok';
if(m==='ok')process.exit(0);
if(m==='fail')process.exit(3);
fs.writeFileSync(${JSON.stringify(path.join(d, 'started'))},'1');setInterval(()=>{},1000);process.on('SIGTERM',()=>process.exit(143));`);
  return { log, acct, runner, current: () => JSON.parse(fs.readFileSync(state, 'utf8')).default, lines: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []) };
}
const args = (sh) => [WINDOW, '--pilot-alias', 'pilot', '--account-js', sh.acct, '--runner', sh.runner, '--', '--out', '/x'];
const run = (sh, env = {}, extra = []) => cp.spawnSync('node', [...args(sh), ...extra], { encoding: 'utf8', input: '', env: { ...process.env, ...env } });
const RESTORE = (d) => `account set-default --restore ${path.join(d, 'registry.json.bak')}`;

test('window: success: set-default, the runner with --account, then restore; exit 0', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(sh.lines(), ['account set-default pilot', 'runner --account pilot --out /x', RESTORE(d)]);
    assert.strictEqual(sh.current(), 'prev');
  } finally { rm(d); }
});

test('window: the runner fails: the restore still runs and the runner exit code is kept', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh, { SHIM_MODE: 'fail' });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(sh.lines()[2], RESTORE(d)); assert.strictEqual(sh.current(), 'prev');
  } finally { rm(d); }
});

test('window: SIGTERM during the run: the runner is stopped, the restore runs, exit 143', async () => {
  const d = tmp();
  try {
    const sh = shims(d);
    const child = cp.spawn('node', args(sh), { env: { ...process.env, SHIM_MODE: 'hang' }, stdio: 'ignore' });
    const code = new Promise((res) => child.on('exit', (c, s) => res(c === null ? `sig:${s}` : c)));
    for (let i = 0; i < 200 && !fs.existsSync(path.join(d, 'started')); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.ok(fs.existsSync(path.join(d, 'started')), 'runner shim started');
    child.kill('SIGTERM');
    assert.strictEqual(await code, 143);
    assert.strictEqual(sh.lines()[sh.lines().length - 1], RESTORE(d)); assert.strictEqual(sh.current(), 'prev');
  } finally { rm(d); }
});

test('window: set-default mutates, then exits non-zero: the printed backup is restored, the runner never starts, exit 2', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh, { SHIM_OPEN: 'fail-after-mutate' });
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(sh.lines(), ['account set-default pilot', RESTORE(d)]);
    assert.strictEqual(sh.current(), 'prev');
  } finally { rm(d); }
});

test('window: SIGTERM to the process group while set-default has mutated and printed: restored from the printed backup, exit 143', async () => {
  const d = tmp();
  try {
    const sh = shims(d);
    const child = cp.spawn('node', args(sh), { env: { ...process.env, SHIM_OPEN: 'hang-after-print' }, stdio: 'ignore', detached: true });
    const code = new Promise((res) => child.on('exit', (c, s) => res(c === null ? `sig:${s}` : c)));
    for (let i = 0; i < 200 && sh.current() !== 'pilot'; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(sh.current(), 'pilot', 'the open mutated the registry');
    await new Promise((r) => setTimeout(r, 300)); // let the shim print and start hanging
    process.kill(-child.pid, 'SIGTERM');
    assert.strictEqual(await code, 143);
    assert.strictEqual(sh.current(), 'prev');
    assert.ok(!sh.lines().some((l) => l.startsWith('runner')));
  } finally { rm(d); }
});

test('window: the interruption comes before any backup line was printed: the recorded previous default is set back', async () => {
  const d = tmp();
  try {
    const sh = shims(d);
    const child = cp.spawn('node', args(sh), { env: { ...process.env, SHIM_OPEN: 'hang-before-print' }, stdio: 'ignore', detached: true });
    const code = new Promise((res) => child.on('exit', (c, s) => res(c === null ? `sig:${s}` : c)));
    for (let i = 0; i < 200 && sh.current() !== 'pilot'; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(sh.current(), 'pilot');
    await new Promise((r) => setTimeout(r, 300));
    process.kill(-child.pid, 'SIGTERM');
    assert.strictEqual(await code, 143);
    assert.strictEqual(sh.current(), 'prev');
    assert.deepStrictEqual(sh.lines(), ['account set-default pilot', 'account set-default prev']);
  } finally { rm(d); }
});

test('window: set-default succeeds but prints no restore line: the previous default is set back and the runner never starts', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh, { SHIM_OPEN: 'no-print' });
    assert.strictEqual(r.status, 2);
    assert.strictEqual(sh.current(), 'prev');
    assert.ok(!sh.lines().some((l) => l.startsWith('runner')));
  } finally { rm(d); }
});

test('window: set-default fails without changing anything: no second set-default, exit 2', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh, { SHIM_OPEN: 'fail-no-mutate' });
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(sh.lines(), ['account set-default pilot']);
    assert.strictEqual(sh.current(), 'prev');
  } finally { rm(d); }
});

test('window: a failing restore is loud: exit 9 with the manual command', () => {
  const d = tmp();
  try {
    const sh = shims(d, { restoreRc: 5 }); const r = run(sh);
    assert.strictEqual(r.status, 9);
    assert.match(r.stderr, /RESTORE FAILED.*set-default --restore /);
  } finally { rm(d); }
});

test('window: --account after -- is refused (the window supplies it)', () => {
  const d = tmp();
  try {
    const sh = shims(d); const r = run(sh, {}, ['--account', 'other']);
    assert.strictEqual(r.status, 2);
    assert.deepStrictEqual(sh.lines(), []);
  } finally { rm(d); }
});
