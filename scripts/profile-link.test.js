'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run } = require('./profile-link.js');

const SCRIPT = path.join(__dirname, 'profile-link.js');
const SENT = 'SENTINEL-DO-NOT-TOUCH';

function mkHome(opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plink-'));
  const c = path.join(home, '.claude');
  fs.mkdirSync(c);
  for (const f of ['settings.json', 'CLAUDE.md', '.credentials.json']) fs.writeFileSync(path.join(c, f), f === '.credentials.json' ? SENT : `c:${f}`);
  fs.writeFileSync(path.join(home, '.claude.json'), SENT);
  for (const d of (opts.dirs || ['skills', 'hooks'])) fs.mkdirSync(path.join(c, d));
  return home;
}
const pdir = (h, p = 'sub') => path.join(h, '.claude-profiles', p);
function cap(argv, home) {
  const o = [], e = [];
  const rc = run(argv, { home, out: (s) => o.push(s), err: (s) => e.push(s) });
  return { rc, out: o.join('\n'), err: e.join('\n') };
}
function tree(root) {
  const res = {};
  (function walk(d) {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n), st = fs.lstatSync(p);
      const rel = path.relative(root, p);
      if (st.isSymbolicLink()) res[rel] = 'L:' + fs.readlinkSync(p);
      else if (st.isDirectory()) { res[rel] = 'D'; walk(p); } else res[rel] = 'F:' + fs.readFileSync(p, 'utf8');
    }
  })(root);
  return res;
}

test('apply makes expected links; rollback restores (empty home, dir created)', () => {
  const h = mkHome();
  const before = tree(h);
  const r = cap(['apply', '--profile', 'sub'], h);
  assert.strictEqual(r.rc, 0, r.err);
  for (const n of ['settings.json', 'CLAUDE.md', 'skills', 'hooks']) assert.strictEqual(fs.readlinkSync(path.join(pdir(h), n)), path.join(h, '.claude', n));
  for (const n of ['plugins', 'agents', 'commands', '.claude.json', '.credentials.json', 'metrics', 'projects']) assert.ok(!fs.existsSync(path.join(pdir(h), n)), n);
  assert.match(cap(['status', '--profile', 'sub'], h).out, /settings\.json ->.*可解析/);
  assert.strictEqual(cap(['rollback', '--profile', 'sub'], h).rc, 0);
  assert.ok(fs.existsSync(pdir(h)) && fs.readdirSync(pdir(h)).length === 0, 'empty dir stays, manifest gone');
  const after = tree(h);
  delete after[path.join('.claude-profiles')]; delete after[path.join('.claude-profiles', 'sub')];
  assert.deepStrictEqual(after, before);
});

test('partly linked and prior manifest: rollback returns the pre-apply state', () => {
  const h = mkHome();
  assert.strictEqual(cap(['apply', '--profile', 'sub', '--entries', 'settings.json'], h).rc, 0);
  const before = tree(h);
  assert.strictEqual(cap(['apply', '--profile', 'sub'], h).rc, 0);
  assert.ok(fs.lstatSync(path.join(pdir(h), 'skills')).isSymbolicLink());
  assert.strictEqual(cap(['rollback', '--profile', 'sub'], h).rc, 0);
  assert.deepStrictEqual(tree(h), before);
  const m = JSON.parse(fs.readFileSync(path.join(pdir(h), '.profile-links.json'), 'utf8'));
  assert.strictEqual(m.runs.length, 1);
  assert.strictEqual(m.runs[0].dir_created, true);
});

test('NC: non-link settings.json is refused and untouched', () => {
  const h = mkHome();
  fs.mkdirSync(pdir(h), { recursive: true });
  fs.writeFileSync(path.join(pdir(h), 'settings.json'), 'mine');
  const before = tree(h);
  const r = cap(['apply', '--profile', 'sub'], h);
  assert.strictEqual(r.rc, 1);
  assert.match(r.err, /快照/);
  assert.deepStrictEqual(tree(h), before, 'nothing created, nothing changed');
});

test('NC: --adopt is a usage error', () => {
  const h = mkHome();
  const r = spawnSync(process.execPath, [SCRIPT, 'apply', '--profile', 'sub', '--adopt'], { env: { ...process.env, HOME: h }, encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.ok(!fs.existsSync(pdir(h)));
});

test('NC: link list with login files or private dirs is refused', () => {
  const h = mkHome();
  for (const n of ['.claude.json', '.credentials.json', 'metrics', 'projects']) {
    const r = cap(['apply', '--profile', 'sub', '--entries', `settings.json,${n}`], h);
    assert.strictEqual(r.rc, 1, n);
    assert.ok(!fs.existsSync(pdir(h)), 'nothing created for ' + n);
  }
  assert.strictEqual(cap(['apply', '--profile', 'sub', '--entries', 'bogus'], h).rc, 2);
});

test('NC: login files untouched; fs spy sees no .credentials.json/.claude.json access, no write-open on targets, no rmdir/rm', () => {
  const h = mkHome();
  const calls = [];
  const orig = {};
  const spy = (name, fn) => { orig[name] = fs[name]; fs[name] = function (...a) { calls.push([name, ...a]); return orig[name].apply(this, a); }; };
  for (const n of ['openSync', 'readFileSync', 'writeFileSync', 'copyFileSync', 'rmdirSync', 'rmSync', 'rmdir', 'rm', 'createReadStream', 'createWriteStream', 'readFile', 'writeFile', 'open', 'truncateSync']) spy(n, null);
  try {
    cap(['apply', '--profile', 'sub'], h);
    cap(['status', '--profile', 'sub'], h);
    cap(['rollback', '--profile', 'sub'], h);
  } finally { for (const n of Object.keys(orig)) fs[n] = orig[n]; }
  const strs = calls.map((c) => c.slice(1).filter((x) => typeof x === 'string').join('|'));
  assert.ok(!strs.some((s) => /\.credentials\.json|\.claude\.json/.test(s.replace(/\.profile-links\.json/g, ''))), 'no login file access');
  const names = calls.map((c) => c[0]);
  assert.ok(!names.some((n) => /^(rmdir|rm)(Sync)?$/.test(n)), 'no rmdir/rm');
  const tgt = path.join(h, '.claude') + path.sep;
  assert.ok(!calls.some((c) => c[0] !== 'readFileSync' && c.slice(1).some((x) => typeof x === 'string' && x.startsWith(tgt))), 'no write/open of any target');
  assert.strictEqual(fs.readFileSync(path.join(h, '.claude', '.credentials.json'), 'utf8'), SENT);
  assert.strictEqual(fs.readFileSync(path.join(h, '.claude.json'), 'utf8'), SENT);
});

test('NC: link retargeted after apply is skipped and reported by rollback', () => {
  const h = mkHome();
  cap(['apply', '--profile', 'sub'], h);
  const l = path.join(pdir(h), 'skills');
  fs.unlinkSync(l); fs.symlinkSync('/elsewhere', l);
  fs.unlinkSync(path.join(pdir(h), 'hooks')); fs.writeFileSync(path.join(pdir(h), 'hooks'), 'real file now');
  const r = cap(['rollback', '--profile', 'sub'], h);
  assert.strictEqual(r.rc, 1);
  assert.match(r.out, /略過 skills/);
  assert.match(r.out, /略過 hooks/);
  assert.strictEqual(fs.readlinkSync(l), '/elsewhere');
  assert.strictEqual(fs.readFileSync(path.join(pdir(h), 'hooks'), 'utf8'), 'real file now');
  assert.ok(!fs.existsSync(path.join(pdir(h), 'settings.json')), 'matching links still removed');
});

test('apply is idempotent and does not relink an existing different link', () => {
  const h = mkHome();
  cap(['apply', '--profile', 'sub'], h);
  const l = path.join(pdir(h), 'skills');
  fs.unlinkSync(l); fs.symlinkSync('/elsewhere', l);
  const r = cap(['apply', '--profile', 'sub'], h);
  assert.strictEqual(r.rc, 0);
  assert.match(r.out, /不重連/);
  assert.strictEqual(fs.readlinkSync(l), '/elsewhere');
});

// profsw-fix1 finding 4
test('status reports a chained broken symlink as 失效', () => {
  const h = mkHome();
  fs.rmSync(path.join(h, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(path.join(h, 'nowhere'), path.join(h, '.claude', 'skills'));
  assert.strictEqual(cap(['apply', '--profile', 'sub', '--entries', 'skills'], h).rc, 0);
  assert.match(cap(['status', '--profile', 'sub'], h).out, /skills ->.*失效/);
});
test('apply with duplicate --entries links once and records the run', () => {
  const h = mkHome();
  const r = cap(['apply', '--profile', 'sub', '--entries', 'settings.json,settings.json'], h);
  assert.strictEqual(r.rc, 0, r.err);
  assert.ok(fs.existsSync(path.join(pdir(h), '.profile-links.json')));
  assert.strictEqual(cap(['rollback', '--profile', 'sub'], h).rc, 0);
  assert.ok(!fs.existsSync(path.join(pdir(h), 'settings.json')));
});
