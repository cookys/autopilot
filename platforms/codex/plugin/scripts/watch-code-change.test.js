/**
 * Tests for mods P1W WATCHVER: a watcher must not outlive a plugin update.
 * Run: node --test scripts/watch-code-change.test.js
 *   - src/status/code-fingerprint.js: unchanged -> false; a module edited -> true; plugin.json edited -> true; touched only
 *     (mtime moves, bytes equal) -> false; a file gone / a new src/status module -> true; a flaky listing -> false (fail-open).
 *   - createWatcher().tick(): an injected fingerprint saying "changed" returns { exit: 'code_changed' }, logs `code changed, exiting`
 *     and does NOT keep publishing; unchanged keeps ticking. With the real fingerprint over a temp code root: edit -> exit within ONE tick.
 *   - the runWriter wiring (real process): see hooks/tests/runs-watch.test.sh + this file's "process" case: a real watcher over a
 *     copied code tree exits cleanly (lock free) after its code changes.
 * Isolation: HOME / AUTOPILOT_LIVE_DIR / marker dir / costs under mkdtemp (/dev/shm for live); nothing touches the real stores.
 *
 * RED record (before the change): see $P/run-w/land/foreman-red.txt.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createWatcher } = require('../src/status/runs-watch');
const { scopeFromCwd } = require('../src/status/project-key');

let createCodeFingerprint = null;
try { ({ createCodeFingerprint } = require('../src/status/code-fingerprint')); } catch (_e) { /* RED: module absent */ }

const bases = [];
test.after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

function codeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-code-'));
  bases.push(root);
  fs.mkdirSync(path.join(root, 'src', 'status'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'status', 'a.js'), '// a\n');
  fs.writeFileSync(path.join(root, 'src', 'status', 'b.js'), '// b\n');
  fs.writeFileSync(path.join(root, 'scripts', 'render-review-page.js'), '// r\n');
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'live-state-dir.js'), '// l\n');
  fs.writeFileSync(path.join(root, '.claude-plugin', 'plugin.json'), '{"version":"1.0.0"}\n');
  return root;
}
const edit = (root, rel, text) => { fs.writeFileSync(path.join(root, rel), text); const t = new Date(Date.now() + 2000); fs.utimesSync(path.join(root, rel), t, t); };

test('fingerprint: nothing changed -> false, every time', () => {
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  assert.equal(fp.changed(), false);
  assert.equal(fp.changed(), false);
});

test('fingerprint: an edited src/status module -> true', () => {
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  edit(root, 'src/status/b.js', '// b changed\n');
  assert.equal(fp.changed(), true);
});

test('fingerprint: a plugin.json (version) edit -> true; render-review-page.js edit -> true', () => {
  const r1 = codeRoot();
  const f1 = createCodeFingerprint({ root: r1 });
  edit(r1, '.claude-plugin/plugin.json', '{"version":"1.0.1"}\n');
  assert.equal(f1.changed(), true);
  const r2 = codeRoot();
  const f2 = createCodeFingerprint({ root: r2 });
  edit(r2, 'scripts/render-review-page.js', '// r2\n');
  assert.equal(f2.changed(), true);
});

test('fingerprint: a bare touch (mtime moves, bytes equal) is not a change', () => {
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(root, 'src', 'status', 'a.js'), t, t);
  assert.equal(fp.changed(), false);
  assert.equal(fp.changed(), false);
});

test('fingerprint: a file removed, or a new src/status module added -> true', () => {
  const r1 = codeRoot();
  const f1 = createCodeFingerprint({ root: r1 });
  fs.rmSync(path.join(r1, 'src', 'status', 'a.js'));
  assert.equal(f1.changed(), true);
  const r2 = codeRoot();
  const f2 = createCodeFingerprint({ root: r2 });
  fs.writeFileSync(path.join(r2, 'src', 'status', 'c.js'), '// c\n');
  assert.equal(f2.changed(), true);
});

test('fingerprint: hashes only when the stat signature moved (a quiet tick reads no file contents)', () => {
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  const orig = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function patched(...a) { reads += 1; return orig.apply(this, a); };
  try { fp.changed(); fp.changed(); } finally { fs.readFileSync = orig; }
  assert.equal(reads, 0);
});

test('fingerprint: an unreadable src/status listing is no change (fail-open)', () => {
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  fs.rmSync(path.join(root, 'src'), { recursive: true, force: true });
  assert.equal(fp.changed(), false);
});

function fx() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-w-'));
  const live = fs.mkdtempSync(path.join('/dev/shm', 'wcc-live-')); fs.chmodSync(live, 0o700);
  bases.push(base, live);
  const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q']);
  spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'i']);
  const home = path.join(base, 'home'); fs.mkdirSync(home);
  const env = { PATH: process.env.PATH, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_SESSION_MODE_DIR: path.join(base, 'markers'), AUTOPILOT_COSTS_FILE: path.join(base, 'c.jsonl'), AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs') };
  fs.mkdirSync(env.AUTOPILOT_SESSION_MODE_DIR); fs.mkdirSync(env.AUTOPILOT_DISPATCH_RUNS_DIR);
  const key = scopeFromCwd(repo).project_key;
  return { base, live, repo, env, key, home };
}
const { pointerPath } = require('../src/status/live-pointer');
const logOf = (f) => { try { return fs.readFileSync(path.join(path.dirname(pointerPath(f.env)), 'review', f.key, 'live', 'watcher.log'), 'utf8'); } catch (_e) { return ''; } };

test('watcher tick: unchanged code keeps ticking; changed code returns exit code_changed, logs the reason, publishes nothing more', () => {
  const f = fx();
  let changed = false;
  const w = createWatcher({ key: f.key, env: f.env, cwd: f.repo, collect: () => [], interval: 1, codeFingerprint: { changed: () => changed } });
  w.start();
  const r1 = w.tick();
  assert.equal(r1.exit, undefined);
  const env1 = fs.readFileSync(path.join(f.live, 'runs', `${f.key}.json`), 'utf8');
  changed = true;
  const r2 = w.tick();
  assert.equal(r2.exit, 'code_changed');
  assert.match(logOf(f), /code changed, exiting/);
  assert.equal(fs.readFileSync(path.join(f.live, 'runs', `${f.key}.json`), 'utf8'), env1, 'the exiting tick publishes nothing');
});

test('watcher tick with the real fingerprint over a temp code root: an edit exits within ONE tick', () => {
  const f = fx();
  const root = codeRoot();
  const fp = createCodeFingerprint({ root });
  const w = createWatcher({ key: f.key, env: f.env, cwd: f.repo, collect: () => [], interval: 1, codeFingerprint: fp });
  w.start();
  assert.equal(w.tick().exit, undefined);
  edit(root, 'src/status/a.js', '// a v2\n');
  assert.equal(w.tick().exit, 'code_changed');
});

test('process: a real watcher exits cleanly and frees its lock after its code changes; the lock is then takeable', () => {
  const f = fx();
  const { spawn } = require('child_process');
  // The watcher fingerprints the tree it runs from, so run the real CLI from a COPY of the code and edit the copy (the "update").
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'wcc-copy-')); bases.push(copy);
  const REPO = path.join(__dirname, '..');
  for (const d of ['src', 'scripts', 'bin', 'schemas', 'profiles', '.claude-plugin', 'hooks', 'references', 'package.json']) {
    const from = path.join(REPO, d);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(copy, d), { recursive: true });
  }
  const bin = path.join(copy, 'bin', 'autopilot.js');
  const lock = path.join(f.live, 'runs', `${f.key}.lock`);
  const child = spawn('node', [bin, 'status', 'runs', '--watch', '--project', f.key, '--interval', '1', '--idle-exit', '3600'], { cwd: f.repo, env: f.env, stdio: 'ignore', detached: true });
  const waitFor = (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } return cond(); };
  // the sync wait loop never lets node reap the child, so "exited" = gone or a zombie (state Z in /proc/<pid>/stat)
  const state = () => { try { return fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1][0]; } catch (_e) { return 'gone'; } };
  const alive = () => !['Z', 'gone'].includes(state());
  try {
    assert.ok(waitFor(() => fs.existsSync(path.join(f.live, 'runs', `${f.key}.json`)), 15000), 'the watcher published');
    assert.ok(alive(), 'running before the edit');
    fs.appendFileSync(path.join(copy, 'src', 'status', 'foreman-activity.js'), '\n// updated by the plugin update\n');
    assert.ok(waitFor(() => !alive(), 20000), 'exited after the edit');
    assert.match(logOf(f), /code changed, exiting/);
    const r = spawnSync('flock', ['-n', lock, 'true']);
    assert.equal(r.status, 0, 'the lock is free');
  } finally { try { process.kill(-child.pid, 'SIGKILL'); } catch (_e) { /* gone */ } try { process.kill(child.pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
});
