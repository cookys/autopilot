/**
 * Tests for mods P1W WATCHVER repair: an update that installs into a NEW plugin directory (the marketplace path
 * ~/.claude/plugins/cache/autopilot/autopilot/<version>/) never touches the old watcher's files, so its own code fingerprint cannot
 * see it. The watcher records its plugin root (realpath) + version in the envelope writer block (`writer.plugin_root`,
 * `writer.plugin_version`); the autostart hook (SessionStart full path, UserPromptSubmit fast path) compares that with its own and
 * replaces a mismatching watcher: verify the pid is a live `status runs --watch --project <key>` whose argv root is the recorded
 * root, SIGTERM it, wait (<= 2 s) for it to go, then start the current one. Run: node --test hooks/watch-update-replace.test.js
 *
 *   old watcher from root A (a copy of the tree, version 0.0.1-old) + hook from root B (this tree) -> old pid terminated, new watcher
 *   started from B, lock held by the new pid, envelope names B; same root + version -> nothing happens (same pid, no signal);
 *   a pid whose cmdline is unrelated (pid reuse), a decoy whose argv names no / another root than the record -> never signalled.
 * Isolation: HOME / AUTOPILOT_LIVE_DIR (/dev/shm) / marker dir / costs / dispatch dir under mkdtemp; every process this run starts
 * is killed by pid (environ AUTOPILOT_LIVE_DIR scan) in teardown.
 *
 * RED record (before the change): see $P/run-w/land/foreman-red-replace.txt.
 */
'use strict';

const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const HOOK = path.join(REPO, 'hooks', 'runs-watch-autostart.js');
const { scopeFromCwd } = require(path.join(REPO, 'src', 'status', 'project-key'));
const RUN = crypto.randomBytes(4).toString('hex');
const created = [];
const children = [];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitFor = (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return true; sleep(100); } return cond(); };
const state = (pid) => { try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0]; } catch (_e) { return 'gone'; } };
const alive = (pid) => !['Z', 'gone'].includes(state(pid));

function fx() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `wur-${RUN}-`));
  const live = fs.mkdtempSync(path.join('/dev/shm', `wur-live-${RUN}-`)); fs.chmodSync(live, 0o700);
  created.push(base, live);
  const repo = path.join(base, 'repo'); fs.mkdirSync(repo);
  spawnSync('git', ['-C', repo, 'init', '-q']);
  spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'i']);
  for (const d of ['home', 'markers', 'runs', 'xdg']) fs.mkdirSync(path.join(base, d));
  fs.chmodSync(path.join(base, 'xdg'), 0o700);
  const env = {
    PATH: process.env.PATH, LANG: 'C', HOME: path.join(base, 'home'), XDG_RUNTIME_DIR: path.join(base, 'xdg'), CLAUDE_CONFIG_DIR: path.join(base, 'home', '.claude'),
    AUTOPILOT_LIVE_DIR: live, AUTOPILOT_SESSION_MODE_DIR: path.join(base, 'markers'), AUTOPILOT_COSTS_FILE: path.join(base, 'c.jsonl'),
    AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'), AUTOPILOT_RUNS_WATCH_AUTOSTART: '1', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '1',
  };
  const key = scopeFromCwd(repo).project_key;
  return { base, live, repo, env, key, envFile: path.join(live, 'runs', `${key}.json`), lock: path.join(live, 'runs', `${key}.lock`) };
}
const writerOf = (f) => { try { return JSON.parse(fs.readFileSync(f.envFile, 'utf8')).writer; } catch (_e) { return null; } };
const lockHeld = (f) => spawnSync('flock', ['-n', f.lock, 'true']).status === 1;

function copyTree(version) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), `wur-old-${RUN}-`)); created.push(copy);
  for (const d of ['src', 'scripts', 'bin', 'schemas', 'profiles', '.claude-plugin', 'hooks', 'references', 'package.json']) {
    const from = path.join(REPO, d);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(copy, d), { recursive: true });
  }
  const pj = path.join(copy, '.claude-plugin', 'plugin.json');
  fs.writeFileSync(pj, JSON.stringify({ ...JSON.parse(fs.readFileSync(pj, 'utf8')), version }));
  return copy;
}
function startWatcherFrom(root, f) {
  const child = spawn('node', [path.join(root, 'bin', 'autopilot.js'), 'status', 'runs', '--watch', '--project', f.key, '--interval', '1', '--idle-exit', '3600'], { cwd: f.repo, env: f.env, stdio: 'ignore', detached: true });
  children.push(child.pid);
  assert.ok(waitFor(() => { const w = writerOf(f); return w && w.pid; }, 45000), 'the watcher published its writer block');
  return writerOf(f);
}
function runHook(f, event = 'SessionStart', extra = {}) {
  const t = Date.now();
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 'wur-sess', hook_event_name: event, cwd: f.repo, ...extra }), encoding: 'utf8', env: f.env, timeout: 15000 });
  assert.strictEqual(r.status, 0, r.stderr);
  return { ms: Date.now() - t, stderr: r.stderr };
}
function killAll() {
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let env = '';
    try { env = fs.readFileSync(`/proc/${name}/environ`, 'utf8'); } catch (_e) { continue; }
    if (env.includes(`AUTOPILOT_LIVE_DIR=/dev/shm/wur-live-${RUN}-`)) { try { process.kill(Number(name), 'SIGKILL'); } catch (_e) { /* gone */ } }
  }
  for (const pid of children.splice(0)) { try { process.kill(-pid, 'SIGKILL'); } catch (_e) { /* gone */ } try { process.kill(pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
  sleep(100);
  while (created.length) fs.rmSync(created.pop(), { recursive: true, force: true });
}
afterEach(killAll);

test('the watcher records plugin_root (realpath) and plugin_version in the envelope writer block', () => {
  const f = fx();
  const A = copyTree('0.0.1-old');
  const w = startWatcherFrom(A, f);
  assert.strictEqual(w.plugin_root, fs.realpathSync(A));
  assert.strictEqual(w.plugin_version, '0.0.1-old');
});

test('old watcher from root A v1, hook from root B -> old terminated, new one started from B, lock held by the new pid', () => {
  const f = fx();
  const A = copyTree('0.0.1-old');
  const old = startWatcherFrom(A, f);
  assert.ok(lockHeld(f));
  const r = runHook(f, 'SessionStart');
  assert.ok(r.ms < 12000, `within the hook budget (${r.ms} ms)`);
  assert.ok(!alive(old.pid), 'the old watcher was terminated');
  assert.ok(waitFor(() => { const w = writerOf(f); return w && w.pid !== old.pid && alive(w.pid); }, 45000), 'a new watcher published');
  const nw = writerOf(f);
  assert.strictEqual(nw.plugin_root, fs.realpathSync(REPO));
  assert.strictEqual(nw.plugin_version, JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  assert.ok(lockHeld(f), 'the lock is held');
  const holder = fs.readlinkSync(`/proc/${nw.pid}/fd/9`);
  assert.strictEqual(holder, f.lock, 'the new pid holds the project lock on fd 9');
});

test('the UserPromptSubmit fast path replaces it too (cache present, watcher alive but from an old root)', () => {
  const f = fx();
  const A = copyTree('0.0.1-old');
  startWatcherFrom(A, f);
  const old = writerOf(f);
  // seed the per-cwd cache the way the full path would (so the zero-spawn fast path is the one that sees the old watcher)
  const h = crypto.createHash('sha1').update(f.repo).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(f.live, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'autostart', `${h}.json`), JSON.stringify({ cwd: f.repo, project_key: f.key, repo_identity: scopeFromCwd(f.repo).repo_identity, repo_root: f.repo }));
  runHook(f, 'UserPromptSubmit');
  assert.ok(!alive(old.pid), 'the old watcher was terminated');
  assert.ok(waitFor(() => { const w = writerOf(f); return w && w.pid !== old.pid && alive(w.pid) && w.plugin_root === fs.realpathSync(REPO); }, 45000));
});

test('same root + version: nothing happens (same pid, still the lock holder, no signal)', () => {
  const f = fx();
  const first = startWatcherFrom(REPO, f); // the watcher runs from THIS tree: the hook below is the same root + version
  assert.strictEqual(first.plugin_root, fs.realpathSync(REPO));
  runHook(f, 'SessionStart');
  runHook(f, 'UserPromptSubmit');
  sleep(500);
  assert.strictEqual(writerOf(f).pid, first.pid);
  assert.ok(alive(first.pid));
  assert.ok(lockHeld(f));
});

test('same root but another recorded version -> replaced (an in-place update the old process never noticed)', () => {
  const f = fx();
  const first = startWatcherFrom(REPO, f);
  const env = JSON.parse(fs.readFileSync(f.envFile, 'utf8'));
  env.writer.plugin_version = '0.0.0-older';
  fs.writeFileSync(f.envFile, JSON.stringify(env));
  runHook(f, 'SessionStart');
  assert.ok(!alive(first.pid), 'a different version than ours: replaced');
  assert.ok(waitFor(() => { const w = writerOf(f); return w && w.pid !== first.pid && alive(w.pid) && w.plugin_version !== '0.0.0-older'; }, 45000));
});

test('legacy writer block (no plugin_root): argv root equal to ours is current; another root is replaced', () => {
  const f = fx();
  const A = copyTree('0.0.1-old');
  const old = startWatcherFrom(A, f);
  // strip the record: a watcher of an older plugin never wrote it
  const env = JSON.parse(fs.readFileSync(f.envFile, 'utf8'));
  delete env.writer.plugin_root; delete env.writer.plugin_version;
  fs.writeFileSync(f.envFile, JSON.stringify(env));
  runHook(f, 'SessionStart');
  assert.ok(!alive(old.pid), 'argv root A != B: replaced');
});

function decoy(f, argvExtra) {
  const child = spawn('node', ['-e', 'setTimeout(()=>{},60000)', ...argvExtra], { cwd: f.repo, env: f.env, stdio: 'ignore', detached: true });
  children.push(child.pid);
  return child.pid;
}
const writeEnv = (f, writer) => { fs.mkdirSync(path.dirname(f.envFile), { recursive: true }); fs.writeFileSync(f.envFile, JSON.stringify({ schema: 'autopilot.runs-live/1', scope: { project_key: f.key, repo_identity: null, root_run_id: null }, published_at: new Date().toISOString(), observed_at: null, valid_for_s: 180, writer, runs: [], counts: { confirmed_live: 0, exited: 0, unknown: 0 } })); };

test('a recycled pid (unrelated cmdline) named by the envelope is never signalled', () => {
  const f = fx();
  const pid = decoy(f, ['unrelated', 'process']);
  writeEnv(f, { pid, session_id: null, started_at: new Date().toISOString(), plugin_root: '/old/root', plugin_version: '0.0.1' });
  runHook(f, 'SessionStart');
  sleep(300);
  assert.ok(alive(pid), 'an unrelated process survives');
});

test('a decoy whose argv looks like a watcher but names no root, or another root than the record, is never signalled', () => {
  const f = fx();
  const p1 = decoy(f, ['status', 'runs', '--watch', '--project', f.key]);
  writeEnv(f, { pid: p1, session_id: null, started_at: new Date().toISOString(), plugin_root: '/old/root', plugin_version: '0.0.1' });
  runHook(f, 'SessionStart');
  sleep(300);
  assert.ok(alive(p1), 'argv names no plugin root: left alone');
  const f2 = fx();
  const p2 = decoy(f2, [path.join('/some/other/root', 'bin', 'autopilot.js'), 'status', 'runs', '--watch', '--project', f2.key]);
  writeEnv(f2, { pid: p2, session_id: null, started_at: new Date().toISOString(), plugin_root: '/old/root', plugin_version: '0.0.1' });
  runHook(f2, 'SessionStart');
  sleep(300);
  assert.ok(alive(p2), 'argv root disagrees with the recorded root: left alone');
});

test('legacy writer block whose argv names no root cannot be judged: treated as current (fast path: no spawn, nothing signalled)', () => {
  const f = fx();
  const pid = decoy(f, ['status', 'runs', '--watch', '--project', f.key]);
  writeEnv(f, { pid, session_id: null, started_at: new Date().toISOString() }); // no plugin_root / plugin_version
  const h = crypto.createHash('sha1').update(f.repo).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(f.live, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'autostart', `${h}.json`), JSON.stringify({ cwd: f.repo, project_key: f.key, repo_identity: null, repo_root: f.repo }));
  fs.writeFileSync(require(path.join(REPO, 'src', 'status', 'live-pointer')).pointerPath(f.env), '{}'); // the fast path also wants the pointer present
  runHook(f, 'UserPromptSubmit');
  sleep(1500);
  assert.ok(alive(pid));
  assert.strictEqual(writerOf(f).pid, pid, 'no new watcher was started');
  assert.ok(!lockHeld(f));
});
