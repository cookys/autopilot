/**
 * Tests for plain sessions getting a job root (mods P1W PLAINROOT, plan R5.7). Run: node --test hooks/plain-session-root.test.js
 *
 * Contract under test
 *   - `session-mode.js set` without --level (plain) and the SessionStart ensure assign root_run_id with the SAME rule as
 *     `set --level` (explicit --root-run-id > AUTOPILOT_ROOT_RUN_ID > minted `job-<ts>-<rand>`), through one shared helper.
 *   - ensure NEVER overwrites: compact / resume / startup keep the marker bytes and so the same root; an EXPIRED marker is
 *     replaced by a plain one with a NEW root.
 *   - `session-mode.js root` prints the plain root; `open-decision.js open` without --root-run-id defaults to it.
 *   - watcher: a plain session root is a scope like any other (envelope + decisions sidecar). A root is dropped (and its
 *     live files removed: envelope, .decisions.json, .foreman.json, sources/<scope>.json, the review/<key>/live copy)
 *     once it has had no unexpired marker, no live run, no open decision file and no tasks/attention update for the idle
 *     window (ROOT_RETENTION_S = the idle-exit window). Review pages are not touched.
 *   - the planned / phase inputs of a session belong to its marker root scope, not the unbound scope.
 *   - volume: 5 plain sessions -> exactly 5 root scopes; all markers expired past the window -> 0 root live files.
 * Isolation: HOME, AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_LIVE_DIR (under /dev/shm), XDG_RUNTIME_DIR all temp;
 * AUTOPILOT_RUNS_WATCH_AUTOSTART=0 except where the hook is driven. Real stores are checked for no trace.
 *
 * RED (before implementation, 2026-10-05, 16 tests): 3 pass / 13 fail (the 2 verify-and-pin input cases and the review-pages case pass by construction; run-w/plainroot/red.txt).
 * GREEN: 16 pass / 0 fail. 21 mutation controls, each RED then reverted (run-w/plainroot/mut-*.txt).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'session-mode.js');
const OPEN_DECISION = path.join(ROOT, 'scripts', 'open-decision.js');
const AUTOSTART = path.join(__dirname, 'runs-watch-autostart.js');
const { createWatcher, unexpiredMarkers } = require(path.join(ROOT, 'src', 'status', 'runs-watch'));
const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key'));
const { readWatchInputs } = require(path.join(ROOT, 'src', 'status', 'watch-inputs'));

const bases = [];
function fx(name = 'plain') {
  const base = fs.mkdtempSync(path.join('/dev/shm', `spr-${name}-`));
  bases.push(base);
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  const markers = path.join(home, '.autopilot', 'session-mode');
  const live = path.join(base, 'live');
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(markers, { recursive: true });
  fs.mkdirSync(live, { recursive: true, mode: 0o700 });
  for (const args of [['init', '-q', '-b', 'develop'], ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']]) {
    assert.strictEqual(spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).status, 0);
  }
  const env = {
    PATH: process.env.PATH, LANG: 'C', HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    XDG_RUNTIME_DIR: path.join(base, 'xdg'), AUTOPILOT_LIVE_DIR: live, AUTOPILOT_SESSION_MODE_DIR: markers,
    AUTOPILOT_COSTS_FILE: path.join(base, 'costs.jsonl'), AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'),
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', AUTOPILOT_SESSION_ID: 'spr-session',
  };
  const sc = scopeFromCwd(repo);
  return { base, repo, home, markers, live, env, key: sc.project_key, identity: sc.repo_identity, marker: (sid = 'spr-session') => path.join(markers, `${sid}.json`) };
}
test.after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

const cli = (f, args, extraEnv = {}) => spawnSync('node', [CLI, ...args], { env: { ...f.env, ...extraEnv }, cwd: f.repo, encoding: 'utf8' });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const iso = (ms) => new Date(ms).toISOString();
const JOB = /^job-\d+-[0-9a-f]{8}$/;
function optIn(f) {
  fs.mkdirSync(path.join(f.repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.claude', 'dispatch-config.md'), '# cfg\n');
}
function startHook(f, source, extraEnv = {}, sid = 'spr-session') {
  return spawnSync('node', [AUTOSTART], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', session_id: sid, cwd: f.repo, source }), encoding: 'utf8',
    env: { ...f.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '', AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S: '1', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '1', ...extraEnv },
  });
}
function writeMarker(f, sid, over = {}) {
  const now = Date.now();
  const m = { session_id: sid, level: null, repo_root: f.repo, started_at: iso(now), expires_at: iso(now + 36e5), repo_identity: f.identity, project_key: f.key, root_run_id: null, ...over };
  fs.writeFileSync(f.marker(sid), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}
const expire = (f, sid) => { const m = readJson(f.marker(sid)); m.expires_at = iso(Date.now() - 1000); fs.writeFileSync(f.marker(sid), JSON.stringify(m)); };

// ---------------------------------------------------------------- 1. mint

test('mint: bare `set` mints a job root; explicit --root-run-id beats AUTOPILOT_ROOT_RUN_ID beats minting', () => {
  const f = fx();
  assert.strictEqual(cli(f, ['set', '--repo-root', f.repo]).status, 0);
  assert.match(readJson(f.marker()).root_run_id, JOB);
  assert.strictEqual(readJson(f.marker()).level, null);
  cli(f, ['set', '--repo-root', f.repo], { AUTOPILOT_ROOT_RUN_ID: 'job-from-env' });
  assert.strictEqual(readJson(f.marker()).root_run_id, 'job-from-env');
  cli(f, ['set', '--root-run-id', 'job-explicit', '--repo-root', f.repo], { AUTOPILOT_ROOT_RUN_ID: 'job-from-env' });
  assert.strictEqual(readJson(f.marker()).root_run_id, 'job-explicit');
  cli(f, ['set', '--level', 'none', '--repo-root', f.repo]);
  assert.match(readJson(f.marker()).root_run_id, JOB, '--level none is the same plain path');
});

test('mint: one shared helper decides the root for set --level, plain set and ensure (source pin)', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  assert.strictEqual((src.match(/randomBytes\(4\)/g) || []).length, 1, 'the job-<ts>-<rand> minting exists exactly once');
  assert.match(src, /function resolveJobRoot\(/);
  assert.ok(require(CLI).resolveJobRoot, 'exported');
  const r = require(CLI).resolveJobRoot({ explicit: '', now: 1700000000000, env: {} });
  assert.match(r, /^job-1700000000-[0-9a-f]{8}$/);
  assert.strictEqual(require(CLI).resolveJobRoot({ explicit: 'x', now: 1, env: { AUTOPILOT_ROOT_RUN_ID: 'e' } }), 'x');
  assert.strictEqual(require(CLI).resolveJobRoot({ explicit: '', now: 1, env: { AUTOPILOT_ROOT_RUN_ID: 'e' } }), 'e');
});

test('mint: ensure creates a plain marker with a minted root (env root honoured); startup/compact/resume keep bytes and the same root', () => {
  const f = fx(); optIn(f);
  assert.strictEqual(startHook(f, 'startup').status, 0);
  const first = fs.readFileSync(f.marker(), 'utf8');
  const m = JSON.parse(first);
  assert.strictEqual(m.level, null);
  assert.match(m.root_run_id, JOB);
  for (const src of ['compact', 'resume', 'startup', 'clear']) {
    assert.strictEqual(startHook(f, src).status, 0);
    assert.strictEqual(fs.readFileSync(f.marker(), 'utf8'), first, `${src} kept the marker bytes`);
  }
  const g = fx('env'); optIn(g);
  startHook(g, 'startup', { AUTOPILOT_ROOT_RUN_ID: 'job-campaign-7' });
  assert.strictEqual(readJson(g.marker()).root_run_id, 'job-campaign-7');
});

test('mint: an expired marker is replaced by a plain one with a NEW root; an l5 marker is never touched', () => {
  const f = fx(); optIn(f);
  startHook(f, 'startup');
  const oldRoot = readJson(f.marker()).root_run_id;
  expire(f, 'spr-session');
  assert.strictEqual(startHook(f, 'startup').status, 0);
  const m = readJson(f.marker());
  assert.strictEqual(m.level, null);
  assert.match(m.root_run_id, JOB);
  assert.notStrictEqual(m.root_run_id, oldRoot, 'a new session record = a new job root');
  writeMarker(f, 'spr-l5', { level: 'l5', root_run_id: 'job-l5-root' });
  const before = fs.readFileSync(f.marker('spr-l5'), 'utf8');
  startHook(f, 'compact', {}, 'spr-l5');
  assert.strictEqual(fs.readFileSync(f.marker('spr-l5'), 'utf8'), before);
});

// ---------------------------------------------------------------- 2. read back

test('read back: `session-mode.js root` prints the plain marker root', () => {
  const f = fx();
  cli(f, ['set', '--repo-root', f.repo]);
  const root = readJson(f.marker()).root_run_id;
  assert.match(root, JOB);
  assert.strictEqual(cli(f, ['root']).stdout.trim(), root);
});

test('read back: open-decision defaults to this session\'s plain marker root; no marker -> the unbound scope; explicit wins', () => {
  const f = fx();
  const od = (args) => spawnSync('node', [OPEN_DECISION, ...args, '--cwd', f.repo], { env: f.env, cwd: f.repo, encoding: 'utf8' });
  const dir = path.join(f.repo, '.git', 'autopilot', 'decisions');
  let r = od(['open', '--question', 'unbound?']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(fs.readdirSync(dir), [`${f.key}.json`]);
  od(['close']);
  cli(f, ['set', '--repo-root', f.repo]);
  const root = readJson(f.marker()).root_run_id;
  r = od(['open', '--question', 'rooted?']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(fs.readdirSync(dir), [`${f.key}--${root}.json`]);
  assert.strictEqual(readJson(path.join(dir, `${f.key}--${root}.json`)).root_run_id, root);
  assert.strictEqual(od(['show']).status, 0);
  r = od(['open', '--question', 'explicit?', '--root-run-id', 'job-other']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, `${f.key}--job-other.json`)));
  expire(f, 'spr-session');
  od(['close', '--root-run-id', 'job-other']);
  od(['close', '--root-run-id', root]);
  r = od(['open', '--question', 'after expiry']);
  assert.deepStrictEqual(fs.readdirSync(dir), [`${f.key}.json`], 'an expired marker no longer scopes the decision');
});

// ---------------------------------------------------------------- 3. watcher scopes + retention

const WINDOW_S = 30;
function mkWatcher(f, collect = () => [], t0 = Date.now()) {
  const clock = { t: t0 };
  const w = createWatcher({ key: f.key, env: { ...f.env }, cwd: f.repo, collect: () => collect(clock), now: () => clock.t, interval: 1, idleExitS: WINDOW_S });
  return { w, clock, tick(dtS = 1) { clock.t += dtS * 1000; return w.tick(); } };
}
const scopeFiles = (f) => {
  const out = [];
  const runs = path.join(f.live, 'runs');
  for (const n of fs.existsSync(runs) ? fs.readdirSync(runs) : []) if (n.includes('--') && n.startsWith(f.key)) out.push(n);
  const src = path.join(runs, 'sources');
  for (const n of fs.existsSync(src) ? fs.readdirSync(src) : []) if (n.includes('--')) out.push(`sources/${n}`);
  const ssd = path.join(f.home, '.autopilot', 'review', f.key, 'live');
  for (const n of fs.existsSync(ssd) ? fs.readdirSync(ssd) : []) if (n.includes('--')) out.push(`ssd/${n}`);
  return out.sort();
};
const envelopeOf = (f, root) => path.join(f.live, 'runs', `${f.key}--${root}.json`);

test('retention: a plain session root is a scope while its marker lives, and its files are dropped one idle window after the marker expires', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r1' });
  const x = mkWatcher(f);
  x.tick();
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r1')), 'envelope of the plain root');
  assert.ok(fs.existsSync(path.join(f.live, 'runs', `${f.key}--job-r1.decisions.json`)), 'decisions sidecar of the plain root');
  const ssdCopy = path.join(f.home, '.autopilot', 'review', f.key, 'live', `runs.${f.key}--job-r1.json`);
  assert.ok(fs.existsSync(ssdCopy));
  fs.mkdirSync(path.join(f.live, 'runs', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'runs', 'sources', `${f.key}--job-r1.json`), '{}');
  fs.writeFileSync(path.join(f.live, 'runs', `${f.key}--job-r1.foreman.json`), '{}');
  x.tick(WINDOW_S * 3); x.tick(WINDOW_S * 3);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r1')), 'an unexpired marker keeps its root far beyond the window');
  expire(f, 'a');
  x.tick(WINDOW_S - 5);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r1')), 'kept inside the window');
  x.tick(10);
  assert.deepStrictEqual(scopeFiles(f), [], 'every live file of the root is gone after the window');
  assert.strictEqual(x.w.state.roots.has('job-r1'), false);
  x.tick(5); x.tick(5);
  assert.deepStrictEqual(scopeFiles(f), [], 'not re-created by later ticks');
});

test('retention: review pages under <autopilot_home>/review are durable and never touched', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r2' });
  const page = path.join(f.home, '.autopilot', 'review', 'reports', '2026-10-05', 'job-r2');
  fs.mkdirSync(page, { recursive: true });
  fs.writeFileSync(path.join(page, 'index.html'), '<html></html>');
  const x = mkWatcher(f);
  x.tick(); expire(f, 'a'); x.tick(WINDOW_S + 1);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r2')));
  assert.ok(fs.existsSync(path.join(page, 'index.html')));
});

test('retention: a live (not exited) run keeps the root; once the run exits it is dropped after the window; never drops a root with a live run', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r3' });
  const row = (exited) => ({ run_id: 'r1', role: 'hand', runner: 'claude', model: 's', started_at: iso(Date.now() - 6e4), ended_at: exited ? iso(Date.now()) : null, parent_run_id: null, root_run_id: 'job-r3', depth: 1, manifest: null, project: f.identity, source: { manifest: null, status_probe: null, exit_file: null }, fact_at: iso(Date.now()), observed_at: iso(Date.now()), probe_age_s: null, rc: null, final_status: exited ? 'done' : null, elapsed_s: 5, alive: exited ? false : null, phase: exited ? 'exited' : 'running' });
  let exited = false;
  const x = mkWatcher(f, () => [row(exited)]);
  x.tick(); expire(f, 'a');
  x.tick(WINDOW_S * 3);
  x.tick(WINDOW_S * 3);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r3')), 'live run: kept far beyond the window');
  exited = true;
  x.tick(5);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r3')), 'just exited: the window starts now');
  x.tick(WINDOW_S + 1);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r3')), 'exited and idle: dropped');
  x.tick(5);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r3')), 'exited rows do not resurrect it');
});

test('retention: an open decision file keeps the root; closing it starts the window', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r4' });
  const dec = path.join(f.repo, '.git', 'autopilot', 'decisions');
  fs.mkdirSync(dec, { recursive: true });
  const file = path.join(dec, `${f.key}--job-r4.json`);
  fs.writeFileSync(file, JSON.stringify({ schema: 'autopilot.decision/1', question: 'q?', options: null, context: null, not_authorized: null, root_run_id: 'job-r4', repo_identity: f.identity, project_key: f.key, opened_at: iso(Date.now()), opened_by_session: 'a' }));
  const x = mkWatcher(f);
  x.tick(); expire(f, 'a');
  x.tick(WINDOW_S * 2); x.tick(WINDOW_S * 2);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r4')), 'open decision: kept');
  fs.unlinkSync(file);
  x.tick(5);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r4')));
  x.tick(WINDOW_S + 1);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r4')));
});

test('retention: a recent tasks / attention update of that session keeps the root; a stale one does not', () => {
  const f = fx();
  writeMarker(f, 'sess-t', { root_run_id: 'job-r5' });
  const x = mkWatcher(f);
  x.tick(); expire(f, 'sess-t');
  const touch = (sub, schema) => {
    fs.mkdirSync(path.join(f.live, sub), { recursive: true });
    fs.writeFileSync(path.join(f.live, sub, 'sess-t.json'), JSON.stringify({ schema, session_id: 'sess-t', project_key: f.key, updated_at: iso(x.clock.t), tasks: [] }));
  };
  for (const [sub, schema] of [['tasks', 'autopilot.session-tasks/1'], ['attention', 'autopilot.attention/1']]) {
    touch(sub, schema);
    x.tick(WINDOW_S - 5); touch(sub, schema);
    x.tick(WINDOW_S - 5);
    assert.ok(fs.existsSync(envelopeOf(f, 'job-r5')), `${sub} update inside the window keeps the root`);
    fs.rmSync(path.join(f.live, sub, 'sess-t.json'));
  }
  x.tick(WINDOW_S + 1);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r5')), 'no update for a window: dropped');
});

test('retention: negative control — another project\'s marker root is not a scope here and its files are not deleted', () => {
  const f = fx();
  writeMarker(f, 'mine', { root_run_id: 'job-mine' });
  writeMarker(f, 'theirs', { root_run_id: 'job-theirs', project_key: 'ffffffffffffffff' });
  const foreign = path.join(f.live, 'runs', 'ffffffffffffffff--job-theirs.json');
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, '{"keep":true}');
  const x = mkWatcher(f);
  x.tick();
  assert.ok(fs.existsSync(envelopeOf(f, 'job-mine')));
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-theirs')), 'foreign root is not a scope of this watcher');
  expire(f, 'mine');
  x.tick(WINDOW_S + 1);
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-mine')));
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '{"keep":true}');
});

test('retention after a restart: a watcher B drops the orphan files of a root watcher A left behind; another project\'s envelope and a live-run root are kept', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r8' });
  const A = mkWatcher(f);
  A.tick();
  const side = { decisions: path.join(f.live, 'runs', `${f.key}--job-r8.decisions.json`) };
  fs.writeFileSync(path.join(f.live, 'runs', `${f.key}--job-r8.foreman.json`), '{}');
  fs.mkdirSync(path.join(f.live, 'runs', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'runs', 'sources', `${f.key}--job-r8.json`), '{}');
  assert.ok(fs.existsSync(side.decisions));
  expire(f, 'a');
  // watcher A is gone (never ticks again). A root that still has a live run, and a foreign project's envelope:
  const foreign = path.join(f.live, 'runs', 'ffffffffffffffff--job-r8.json');
  fs.writeFileSync(foreign, '{"keep":true}');
  const live = { run_id: 'r1', role: 'hand', runner: 'claude', model: 's', started_at: iso(Date.now() - 6e4), ended_at: null, parent_run_id: null, root_run_id: 'job-r9', depth: 1, manifest: null, project: f.identity, source: { manifest: null, status_probe: null, exit_file: null }, fact_at: iso(Date.now()), observed_at: iso(Date.now()), probe_age_s: null, rc: null, final_status: null, elapsed_s: 5, alive: null };
  fs.writeFileSync(envelopeOf(f, 'job-r9'), '{}');
  const B = mkWatcher(f, () => [live], Date.now() + 3600e3);
  B.tick();
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r8')), 'inside the first window of B the orphan is kept');
  B.tick(WINDOW_S - 5);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r8')));
  B.tick(10);
  assert.deepStrictEqual(scopeFiles(f).filter((n) => n.includes('job-r8') && !n.startsWith('ffff')), [], 'orphan envelope, decisions, foreman, sources and ssd copy are gone');
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '{"keep":true}', 'another project\'s envelope untouched');
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r9')), 'a root with a live run is kept');
  B.tick(WINDOW_S * 3);
  assert.ok(fs.existsSync(envelopeOf(f, 'job-r9')));
});

test('retention: droppedRoots forgets a root that no longer appears in rows, markers or on disk', () => {
  const f = fx();
  writeMarker(f, 'a', { root_run_id: 'job-r10' });
  const x = mkWatcher(f);
  x.tick(); expire(f, 'a');
  x.tick(WINDOW_S + 1);
  assert.strictEqual(x.w.state.droppedRoots.has('job-r10'), true, 'just dropped');
  x.tick(2);
  assert.strictEqual(x.w.state.droppedRoots.has('job-r10'), false, 'files gone, no rows, no marker: forgotten');
  assert.ok(!fs.existsSync(envelopeOf(f, 'job-r10')));
});

// ---------------------------------------------------------------- 4. scope assignment of session inputs

test('inputs: with a root on the plain marker the session tasks and phase belong to its root scope, not the unbound scope', () => {
  const f = fx();
  const now = Date.now();
  writeMarker(f, 'sess-i', { root_run_id: 'job-r6', phase: '實作 W1', phase_set_at: iso(now) });
  fs.mkdirSync(path.join(f.live, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'tasks', 'sess-i.json'), JSON.stringify({ schema: 'autopilot.session-tasks/1', session_id: 'sess-i', project_key: f.key, updated_at: iso(now), first_created_at: iso(now), tasks: [{ id: '1', subject: 'do it', status: 'pending' }] }));
  const markers = unexpiredMarkers(f.env, f.key, now);
  const read = (root) => readWatchInputs({ env: f.env, key: f.key, identity: f.identity, root, nowMs: now, liveBase: f.live, autopilotHome: path.join(f.home, '.autopilot'), markers, progressReceipt: null });
  const rooted = read('job-r6').assemble;
  assert.deepStrictEqual(rooted.planned.value.map((t) => t.title), ['do it']);
  assert.strictEqual(rooted.markerPhase.phase, '實作 W1');
  const unbound = read(null).assemble;
  assert.strictEqual(unbound.planned, null, 'the unbound scope does not carry it');
  assert.strictEqual(unbound.markerPhase, null);
});

test('inputs (tick level): a job page of the plain root carries the session phase; the unbound page does not', () => {
  const f = fx();
  const outRoot = path.join(f.base, 'review');
  writeMarker(f, 'sess-p', { root_run_id: 'job-r7', phase: 'review', phase_set_at: iso(Date.now()) });
  const row = (root) => {
    const mf = path.join(f.base, `row-${root || 'u'}.manifest.json`);
    fs.writeFileSync(mf, JSON.stringify({ run_id: `r-${root || 'u'}`, root_run_id: root }));
    return { run_id: `r-${root || 'u'}`, role: 'hand', runner: 'claude', model: 's', started_at: iso(Date.now() - 6e4), ended_at: null, parent_run_id: null, root_run_id: root, depth: 1, manifest: mf, project: f.identity, source: { manifest: mf, status_probe: null, exit_file: path.join(f.base, `r-${root || 'u'}.exit`) }, fact_at: iso(Date.now()), observed_at: iso(Date.now()), probe_age_s: null, rc: null, final_status: null, elapsed_s: 5, alive: null };
  };
  let t = Date.now();
  const w = createWatcher({ key: f.key, env: { ...f.env }, cwd: f.repo, collect: () => [row('job-r7'), row(null)], now: () => t, interval: 10, enrichCap: 8, render: { outRoot } });
  w.tick(); t += 6000; w.tick();
  const models = {};
  const walk = (d) => { for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) { const p = path.join(d, n); if (n === 'model.json') models[path.basename(path.dirname(path.dirname(p)))] = readJson(p); else if (fs.statSync(p).isDirectory()) walk(p); } };
  walk(outRoot);
  assert.ok(models['job-r7'], 'the rooted job page exists');
  assert.strictEqual(models['job-r7'].phase.source, 'session');
  assert.strictEqual(models['job-r7'].phase.label, 'review');
  assert.ok(models.unbound, 'the unbound page exists');
  assert.strictEqual(models.unbound.phase, null);
});

// ---------------------------------------------------------------- 6. volume

test('volume: 5 plain sessions in one repo -> exactly 5 root scopes; all expired past the window -> 0 root live files', () => {
  const f = fx();
  const roots = new Set();
  for (let i = 0; i < 5; i += 1) {
    const r = cli(f, ['set', '--repo-root', f.repo], { AUTOPILOT_SESSION_ID: `vol-${i}` });
    assert.strictEqual(r.status, 0, r.stderr);
    roots.add(readJson(f.marker(`vol-${i}`)).root_run_id);
  }
  assert.strictEqual(roots.size, 5, 'five distinct roots');
  const x = mkWatcher(f);
  x.tick();
  const envelopes = scopeFiles(f).filter((n) => /^[0-9a-f]{16}--job-[^.]*\.json$/.test(n));
  assert.strictEqual(envelopes.length, 5, 'exactly 5 root envelopes');
  assert.deepStrictEqual(new Set(envelopes.map((n) => n.replace(`${f.key}--`, '').replace('.json', ''))), roots);
  for (let i = 0; i < 5; i += 1) expire(f, `vol-${i}`);
  x.tick(WINDOW_S - 5);
  assert.strictEqual(scopeFiles(f).filter((n) => /\.json$/.test(n) && !n.includes('.')).length, 0);
  x.tick(10);
  assert.deepStrictEqual(scopeFiles(f), [], '0 root live files left');
  assert.ok(fs.existsSync(path.join(f.live, 'runs', `${f.key}.json`)), 'the project scope stays');
});

test('negative control: nothing of this suite leaked into the real ~/.autopilot or /run/user autopilot', () => {
  const hits = [];
  for (const t of [path.join(os.homedir(), '.autopilot'), `/run/user/${process.getuid()}/autopilot`]) {
    const walk = (p, d) => {
      let st; try { st = fs.lstatSync(p); } catch (_e) { return; }
      if (/spr-|job-r[1-7]\b|vol-\d/.test(path.basename(p))) hits.push(p);
      if (st.isDirectory() && d < 4) for (const n of fs.readdirSync(p)) walk(path.join(p, n), d + 1);
    };
    walk(t, 0);
  }
  assert.deepStrictEqual(hits, []);
});
