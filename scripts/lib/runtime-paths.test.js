'use strict';
// runtime-paths.test.js -- trust rules of scripts/lib/runtime-paths.js (BL-0336 U1, plan F1/F6).
//
// Every fixture lives under a mktemp directory; nothing here touches /tmp/autopilot-dispatch-runs or chmods a
// real shared directory. "Owned by somebody else" cannot be made by switching uid, so the tests wrap the real fs:
// the wrapper reports a different uid/gid/mode for chosen paths through lstatSync/statSync (see `overlay`), and the
// module under test receives that wrapper as `deps.fs`. The module also accepts `deps.uid`, `deps.gid`, `deps.home`.
// RUNTIME_PATHS_MODULE points the same tests at a mutated copy (runtime-paths.neg.test.js: negative controls).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MODULE = process.env.RUNTIME_PATHS_MODULE || path.join(__dirname, 'runtime-paths.js');
const rp = require(MODULE);
const ME = process.getuid();
const MYGID = process.getgid();
const OTHER = ME === 12345 ? 12346 : 12345;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rtp-'));
  fs.chmodSync(root, 0o700);
  return fs.realpathSync(root);
}

// fs wrapper: stat results of `over[path]` ({uid,gid,mode}) are reported instead of the real values; every
// mkdir/chmod is recorded in `calls`.
function overlay(over = {}) {
  const calls = { mkdir: [], chmod: [] };
  const patch = (p, st) => {
    const o = over[p];
    if (!o) return st;
    const view = Object.create(st);
    for (const k of Object.keys(o)) Object.defineProperty(view, k, { value: o[k] });
    return view;
  };
  const wrapped = Object.assign(Object.create(fs), {
    lstatSync: (p) => patch(p, fs.lstatSync(p)),
    statSync: (p) => patch(p, fs.statSync(p)),
    mkdirSync: (p, o) => { calls.mkdir.push(p); return fs.mkdirSync(p, o); },
    chmodSync: (p, m) => { calls.chmod.push(p); return fs.chmodSync(p, m); },
  });
  return { fs: wrapped, calls };
}
const modeOf = (p) => fs.statSync(p).mode & 0o7777;
const depsFor = (extra = {}) => ({ home: '/nonexistent-home', ...extra });

test('runsDir precedence: AUTOPILOT_DISPATCH_RUNS_DIR, then TMPDIR, then /tmp', () => {
  assert.strictEqual(rp.runsDir({ AUTOPILOT_DISPATCH_RUNS_DIR: '/x/y', TMPDIR: '/t' }), '/x/y');
  assert.strictEqual(rp.runsDir({ TMPDIR: '/t' }), path.join('/t', rp.RUNS_DIR_NAME));
  assert.strictEqual(rp.runsDir({}), path.join('/tmp', rp.RUNS_DIR_NAME));
});

test('leaf symlink is refused', () => {
  const root = fixture();
  const real = path.join(root, 'real');
  fs.mkdirSync(real, { mode: 0o700 });
  const leaf = path.join(root, 'runs');
  fs.symlinkSync(real, leaf);
  // home = the fixture: a link below the home directory is followable, so only the leaf rule can refuse it
  const r = rp.ensurePrivateDir(leaf, { home: root });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /symbolic link/);
  assert.match(r.reason, new RegExp(leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('symlink in a middle layer outside the home directory is refused', () => {
  const root = fixture();
  const real = path.join(root, 'real');
  fs.mkdirSync(real, { mode: 0o700 });
  fs.symlinkSync(real, path.join(root, 'link'));
  const r = rp.ensurePrivateDir(path.join(root, 'link', 'runs'), depsFor());
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /symbolic link/);
  assert.strictEqual(fs.existsSync(path.join(real, 'runs')), false, 'nothing may be created through the link');
});

test('symlink below the home directory is followed when the target is ours', () => {
  const root = fixture();
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  fs.symlinkSync(data, path.join(home, '.autopilot'));
  const r = rp.ensurePrivateDir(path.join(home, '.autopilot', 'review', 'live'), { home });
  assert.strictEqual(r.ok, true, r.reason);
  assert.ok(fs.existsSync(path.join(data, 'review', 'live')));
});

test('symlink below the home directory is refused when its target is not ours', () => {
  const root = fixture();
  const home = path.join(root, 'home');
  const data = path.join(root, 'data');
  fs.mkdirSync(home, { mode: 0o700 });
  fs.mkdirSync(data, { mode: 0o700 });
  fs.symlinkSync(data, path.join(home, '.autopilot'));
  const o = overlay({ [data]: { uid: OTHER } });
  const r = rp.ensurePrivateDir(path.join(home, '.autopilot', 'x'), { home, fs: o.fs });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not a directory owned by this user/);
});

test('a middle layer owned by another user is refused even when it is not writable', () => {
  const root = fixture();
  const mid = path.join(root, 'mid');
  fs.mkdirSync(mid, { mode: 0o755 });
  const o = overlay({ [mid]: { uid: OTHER } });
  const r = rp.ensurePrivateDir(path.join(mid, 'runs'), depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, new RegExp(`uid ${OTHER}`));
  assert.ok(r.reason.includes(mid), 'reason names the path');
  assert.deepStrictEqual(o.calls.mkdir, []);
});

test('a world-writable parent without the sticky bit is refused', () => {
  const root = fixture();
  const shared = path.join(root, 'shared');
  fs.mkdirSync(shared);
  fs.chmodSync(shared, 0o777);
  const r = rp.ensurePrivateDir(path.join(shared, 'runs'), depsFor());
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /writable by other users/);
  assert.strictEqual(fs.existsSync(path.join(shared, 'runs')), false);
  // root-owned with the sticky bit (a /tmp-like shared root) is accepted
  fs.chmodSync(shared, 0o1777);
  const o = overlay({ [shared]: { uid: 0 } });
  const ok = rp.ensurePrivateDir(path.join(shared, 'runs'), depsFor({ fs: o.fs }));
  assert.strictEqual(ok.ok, true, ok.reason);
  assert.strictEqual(modeOf(path.join(shared, 'runs')), 0o700);
});

test('a leaf that was once writable by others is refused and not chmod-ed', () => {
  const root = fixture();
  const leaf = path.join(root, 'runs');
  fs.mkdirSync(leaf);
  fs.chmodSync(leaf, 0o777);
  const o = overlay();
  const r = rp.ensurePrivateDir(leaf, depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /writable by other users/);
  assert.strictEqual(modeOf(leaf), 0o777, 'mode untouched');
  assert.deepStrictEqual(o.calls.chmod, []);
});

test('a leaf owned by another user is refused', () => {
  const root = fixture();
  const leaf = path.join(root, 'runs');
  fs.mkdirSync(leaf, { mode: 0o700 });
  const o = overlay({ [leaf]: { uid: OTHER } });
  const r = rp.ensurePrivateDir(leaf, depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, new RegExp(`uid ${OTHER}`));
});

test('an own 0755 leaf is tightened to 0700', () => {
  const root = fixture();
  const leaf = path.join(root, 'runs');
  fs.mkdirSync(leaf);
  fs.chmodSync(leaf, 0o755);
  const r = rp.ensurePrivateDir(leaf, depsFor());
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(modeOf(leaf), 0o700);
});

test('missing layers are created one at a time with mode 0700', () => {
  const root = fixture();
  const leaf = path.join(root, 'a', 'b', 'c', 'runs');
  const o = overlay();
  const r = rp.ensurePrivateDir(leaf, depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, true, r.reason);
  for (const p of ['a', 'a/b', 'a/b/c', 'a/b/c/runs']) assert.strictEqual(modeOf(path.join(root, p)), 0o700, p);
  assert.strictEqual(o.calls.mkdir.length, 4);
});

test('a shared system root is never chmod-ed; only the private subdirectory is made', () => {
  const root = fixture();
  const shared = path.join(root, 'shared');
  fs.mkdirSync(shared);
  fs.chmodSync(shared, 0o1777);
  const o = overlay({ [shared]: { uid: 0 } });
  const r = rp.ensureRunsDir({ TMPDIR: shared }, depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(modeOf(shared), 0o1777);
  assert.deepStrictEqual(o.calls.chmod, []);
  assert.strictEqual(modeOf(r.path), 0o700);
});

test('evaluate* is pure: no mkdir, no chmod', () => {
  const root = fixture();
  const o = overlay();
  const a = rp.evaluateRunsDir({ TMPDIR: path.join(root, 'nope') }, depsFor({ fs: o.fs }));
  assert.strictEqual(a.decision, 'create');
  assert.ok(a.would_create.length >= 2);
  const leaf = path.join(root, 'tight');
  fs.mkdirSync(leaf);
  fs.chmodSync(leaf, 0o755);
  const b = rp.evaluatePrivateDir(leaf, depsFor({ fs: o.fs }));
  assert.strictEqual(b.decision, 'tighten');
  const c = rp.evaluateTmpdir({ TMPDIR: path.join(root, 'nope2') }, depsFor({ fs: o.fs }));
  assert.strictEqual(c.decision, 'create');
  assert.deepStrictEqual(o.calls, { mkdir: [], chmod: [] });
  assert.strictEqual(fs.existsSync(path.join(root, 'nope')), false);
  assert.strictEqual(modeOf(leaf), 0o755);
});

test('ensureTmpdir: an existing empty TMPDIR is accepted and left alone', () => {
  const root = fixture();
  const t = path.join(root, 'tmp');
  fs.mkdirSync(t);
  fs.chmodSync(t, 0o755);
  const r = rp.ensureTmpdir({ TMPDIR: t }, depsFor());
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(modeOf(t), 0o755, 'an existing TMPDIR is checked, never modified');
});

test('ensureTmpdir: a TMPDIR that does not exist is created (0700), including missing parents', () => {
  const root = fixture();
  const t = path.join(root, 'x', 'y', 'tmp');
  const r = rp.ensureTmpdir({ TMPDIR: t }, depsFor());
  assert.strictEqual(r.ok, true, r.reason);
  assert.strictEqual(modeOf(t), 0o700);
});

test('ensureTmpdir: an existing TMPDIR of another user is refused unless it is a root-owned sticky root', () => {
  const root = fixture();
  const t = path.join(root, 'tmp');
  fs.mkdirSync(t);
  const o = overlay({ [t]: { uid: OTHER } });
  const bad = rp.ensureTmpdir({ TMPDIR: t }, depsFor({ fs: o.fs }));
  assert.strictEqual(bad.ok, false);
  assert.match(bad.reason, new RegExp(`uid ${OTHER}`));
  fs.chmodSync(t, 0o1777);
  const o2 = overlay({ [t]: { uid: 0 } });
  assert.strictEqual(rp.ensureTmpdir({ TMPDIR: t }, depsFor({ fs: o2.fs })).ok, true);
});

test('ensureTmpdir: TMPDIR that is a file is refused with a reason', () => {
  const root = fixture();
  const t = path.join(root, 'file');
  fs.writeFileSync(t, 'x');
  const r = rp.ensureTmpdir({ TMPDIR: t }, depsFor());
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /not a directory/);
});

test('CLI: runs-dir --ensure prints the path (exit 0); a refusal prints the reason on stderr (exit 1)', () => {
  const root = fixture();
  const cli = (env) => spawnSync(process.execPath, [MODULE, 'runs-dir', '--ensure'], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const good = cli({ TMPDIR: path.join(root, 'fresh') });
  assert.strictEqual(good.status, 0, good.stderr);
  assert.strictEqual(good.stdout.trim(), path.join(root, 'fresh', rp.RUNS_DIR_NAME));
  assert.strictEqual(modeOf(good.stdout.trim()), 0o700);
  const bad = path.join(root, 'bad');
  fs.mkdirSync(bad);
  fs.chmodSync(bad, 0o777);
  const refused = cli({ AUTOPILOT_DISPATCH_RUNS_DIR: bad });
  assert.strictEqual(refused.status, 1);
  assert.strictEqual(refused.stdout, '');
  assert.match(refused.stderr, /writable by other users/);
  assert.strictEqual(modeOf(bad), 0o777);
});

test('gid rule: g+w with our own primary group does not count as other users', () => {
  const root = fixture();
  const mid = path.join(root, 'mid');
  fs.mkdirSync(mid);
  fs.chmodSync(mid, 0o775);
  assert.strictEqual(rp.ensurePrivateDir(path.join(mid, 'runs'), depsFor()).ok, true);
  const mid2 = path.join(root, 'mid2');
  fs.mkdirSync(mid2);
  fs.chmodSync(mid2, 0o775);
  const o = overlay({ [mid2]: { gid: MYGID + 1 } });
  const r = rp.ensurePrivateDir(path.join(mid2, 'runs'), depsFor({ fs: o.fs }));
  assert.strictEqual(r.ok, false);
});
