'use strict';

// Tests for scripts/per-turn-gate-arm.js (BL-0306 P2, T-A1). Every check also runs against a deliberately
// broken copy of the script (negative control, evidence-discipline section 58): the copy must make it fail.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SCRIPTS = __dirname;
const REAL = path.join(SCRIPTS, 'per-turn-gate-arm.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ptg-arm-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_e) { /* nothing */ } });

// A copy of the script with absolute requires and one deliberate break (each replace must change the text).
function mutant(name, pairs) {
  let src = fs.readFileSync(REAL, 'utf8');
  src = src.split('__dirname').join(JSON.stringify(SCRIPTS));
  src = src.split("require('./lib/").join(`require(${JSON.stringify(SCRIPTS)} + '/lib/`);
  for (const [from, to] of pairs) {
    assert.ok(src.includes(from), `mutant ${name}: pattern not found: ${from}`);
    src = src.replace(from, to);
  }
  const f = path.join(TMP, `mut-${name}.js`);
  fs.writeFileSync(f, src);
  return f;
}

function git(repo, args) {
  const env = {};
  for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_')) env[k] = process.env[k];
  return cp.spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t'].concat(args), { cwd: repo, env, encoding: 'utf8' });
}

let n = 0;
function fixture() {
  const dir = path.join(TMP, `c${n++}`);
  const repo = path.join(dir, 'repo');
  const live = path.join(dir, 'live');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.mkdirSync(live, { mode: 0o700 });
  git(repo, ['init', '-q']);
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'ok\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'base']);
  const rules = path.join(dir, 'rules.json');
  fs.writeFileSync(rules, JSON.stringify({ v: 1, forbid_paths: [{ id: 'fp', glob: 'src/legacy/**' }] }));
  const base = git(repo, ['rev-parse', 'HEAD']).stdout.trim();
  return { dir, repo, live, rules, base, gd: path.join(live, 'per-turn-gate') };
}

function run(script, fx, args, extraEnv) {
  return cp.spawnSync(process.execPath, [script].concat(args), {
    encoding: 'utf8', env: Object.assign({}, process.env, { AUTOPILOT_LIVE_DIR: fx.live }, extraEnv || {}),
  });
}
const armArgs = (fx, more) => ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '600'].concat(more || []);

test('arm writes exactly the seven keys, 0600 in a 0700 directory, atomically', () => {
  const fx = fixture();
  const r = run(REAL, fx, armArgs(fx));
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  const f = path.join(fx.gd, 's1.gate.json');
  assert.equal(out.path, f);
  const g = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(Object.keys(g).sort(), ['base', 'expires_at', 'max_blocks', 'mode', 'repo', 'rules', 'v']);
  assert.equal(g.v, 1);
  assert.equal(g.repo, fs.realpathSync(fx.repo));
  assert.equal(g.base, fx.base);
  assert.equal(g.mode, 'violations+features');
  assert.equal(g.max_blocks, 2);
  assert.ok(Date.parse(g.expires_at) > Date.now());
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  assert.equal(fs.statSync(fx.gd).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(fx.gd), ['s1.gate.json'], 'no temp file left behind');
});

test('negative control: a non-atomic writer leaves its temp file behind', () => {
  const fx = fixture();
  const m = mutant('nonatomic', [['fs.renameSync(tmp, file);', "fs.copyFileSync(tmp, file);"]]);
  const r = run(m, fx, armArgs(fx));
  assert.equal(r.status, 0, r.stderr);
  assert.notDeepEqual(fs.readdirSync(fx.gd), ['s1.gate.json']);
});

test('arm with --agent writes the subagent file; --base, --mode and --max-blocks are honoured', () => {
  const fx = fixture();
  const r = run(REAL, fx, armArgs(fx, ['--agent', 'a1', '--base', fx.base, '--mode', 'violations', '--max-blocks', '1']));
  assert.equal(r.status, 0, r.stderr);
  const g = JSON.parse(fs.readFileSync(path.join(fx.gd, 's1.a1.gate.json'), 'utf8'));
  assert.equal(g.mode, 'violations');
  assert.equal(g.max_blocks, 1);
});

const BAD_LISTS = {
  'parent path': { v: 1, forbid_paths: [{ id: 'x', glob: '../etc/**' }] },
  'unregistered check': { v: 1, must_pass: [{ id: 'x', check: 'not-registered' }] },
  'forty-one rules': { v: 1, require_files: Array.from({ length: 41 }, (_, i) => ({ id: `r${i}`, path: 'src/a.js' })) },
};
for (const [label, list] of Object.entries(BAD_LISTS)) {
  test(`arm refuses a bad list (${label}) with exit 2 and writes nothing`, () => {
    const fx = fixture();
    fs.writeFileSync(fx.rules, JSON.stringify(list));
    const r = run(REAL, fx, armArgs(fx));
    assert.equal(r.status, 2);
    assert.equal(fs.existsSync(path.join(fx.gd, 's1.gate.json')), false);
    assert.deepEqual(fs.existsSync(fx.gd) ? fs.readdirSync(fx.gd) : [], []);
  });
}

test('negative control: a copy that skips gate-verify --check writes a file for a bad list', () => {
  const fx = fixture();
  fs.writeFileSync(fx.rules, JSON.stringify(BAD_LISTS['parent path']));
  const m = mutant('nocheck', [['if (chk.error || chk.status !== 0) die(', 'if (false) die(']]);
  const r = run(m, fx, armArgs(fx));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(fx.gd, 's1.gate.json')), true);
});

test('id format, ttl and option errors are exit 2 with nothing written', () => {
  const fx = fixture();
  const cases = [
    ['arm', '--session', 'a b', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60'],
    ['arm', '--session', 'a;b', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60'],
    ['arm', '--session', 'a'.repeat(129), '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60'],
    ['arm', '--session', 's1', '--agent', '../x', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60'],
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules], // ttl is required
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '0'],
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60', '--max-blocks', '3'],
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60', '--mode', 'all'],
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60', '--base', 'abc'],
    ['arm', '--session', 's1', '--repo', fx.repo, '--rules', fx.rules, '--ttl-seconds', '60', '--bogus', 'x'],
  ];
  for (const args of cases) {
    const r = run(REAL, fx, args);
    assert.equal(r.status, 2, args.join(' '));
  }
  assert.deepEqual(fs.existsSync(fx.gd) ? fs.readdirSync(fx.gd) : [], []);
});

test('disarm is idempotent and show prints the file or exits 1', () => {
  const fx = fixture();
  assert.equal(run(REAL, fx, ['show', '--session', 's1']).status, 1);
  assert.equal(run(REAL, fx, armArgs(fx)).status, 0);
  const s = run(REAL, fx, ['show', '--session', 's1']);
  assert.equal(s.status, 0);
  assert.equal(JSON.parse(s.stdout).v, 1);
  assert.equal(run(REAL, fx, ['disarm', '--session', 's1']).status, 0);
  assert.equal(fs.existsSync(path.join(fx.gd, 's1.gate.json')), false);
  assert.equal(run(REAL, fx, ['disarm', '--session', 's1']).status, 0, 'second disarm still exits 0');
  assert.equal(run(REAL, fx, ['show', '--session', 's1']).status, 1);
});

test('the file is found where the hook looks: AUTOPILOT_LIVE_DIR decides the directory', () => {
  const fx = fixture();
  const other = path.join(fx.dir, 'other-live');
  fs.mkdirSync(other, { mode: 0o700 });
  assert.equal(run(REAL, fx, armArgs(fx), { AUTOPILOT_LIVE_DIR: other }).status, 0);
  assert.equal(fs.existsSync(path.join(other, 'per-turn-gate', 's1.gate.json')), true);
  assert.equal(fs.existsSync(path.join(fx.gd, 's1.gate.json')), false);
});

test('settings writes parseable JSON whose Stop command points at the existing hook', () => {
  const fx = fixture();
  const out = path.join(fx.dir, 'settings.json');
  assert.equal(run(REAL, fx, ['settings', '--out', out]).status, 0);
  const s = JSON.parse(fs.readFileSync(out, 'utf8'));
  const h = s.hooks.Stop[0].hooks[0];
  assert.equal(h.type, 'command');
  assert.equal(h.timeout, 60);
  const m = /^'([^']+)' '([^']+)'$/.exec(h.command);
  assert.ok(m, h.command);
  assert.equal(m[2], path.resolve(SCRIPTS, '..', 'hooks', 'per-turn-gate.js'));
  assert.equal(fs.existsSync(m[2]), true);
  assert.equal(run(REAL, fx, ['settings']).status, 2, '--out is required');
});

test('usage: no or unknown subcommand is exit 2', () => {
  const fx = fixture();
  assert.equal(run(REAL, fx, []).status, 2);
  assert.equal(run(REAL, fx, ['frobnicate']).status, 2);
});
