/**
 * Tests for mods P1W GATEFIX2. Run: node --test hooks/watch-gatefix2.test.js
 *   A. a plain session root with no dispatch gets its job page (model.json, phase from the in-progress task) and its sources
 *      sidecar from the watcher; once the marker is gone and the retention window passed the live files go, the durable page stays.
 *   B. an Escape interrupt (transcript row) ends the turn as published in <live>/turn-effective/<sid>.json; the hook's
 *      turn file is never rewritten by the watcher; UPS writes transcript_path.
 * Black-box on /dev/shm fixtures and a temp HOME; real stores untouched.
 *
 * RED record (before the change, 2026-10-05): see $P/run-w/land/gatefix2-red.txt.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { createWatcher } = require(path.join(ROOT, 'src', 'status', 'runs-watch'));
const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key'));
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');

const bases = [];
function fx(name) {
  const base = fs.mkdtempSync(path.join('/dev/shm', `gf2-${name}-`));
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
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
  };
  const sc = scopeFromCwd(repo);
  return { base, repo, home, markers, live, env, key: sc.project_key, identity: sc.repo_identity, outRoot: path.join(base, 'review') };
}
test.after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString();
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const WINDOW_S = 30;

function mkWatcher(f, over = {}) {
  const clock = { t: Date.now() };
  const w = createWatcher({ key: f.key, env: { ...f.env }, cwd: f.repo, collect: () => [], now: () => clock.t, interval: 1, idleExitS: WINDOW_S, enrichCap: 8, render: { outRoot: f.outRoot }, ...over });
  return { w, clock, tick(dtS = 1) { clock.t += dtS * 1000; return w.tick(); } };
}
function modelsOf(outRoot) {
  const models = {};
  const walk = (d) => { for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) { const p = path.join(d, n); if (n === 'model.json') models[path.basename(path.dirname(path.dirname(p)))] = readJson(p); else if (fs.statSync(p).isDirectory()) walk(p); } };
  walk(outRoot);
  return models;
}

// ------------------------------------------------------------------ A. plain root, no dispatch

function plainFixture(f, root) {
  const now = Date.now();
  const m = { session_id: 'sess-a', level: null, repo_root: f.repo, started_at: iso(now), expires_at: iso(now + 36e5), repo_identity: f.identity, project_key: f.key, root_run_id: root };
  fs.writeFileSync(path.join(f.markers, 'sess-a.json'), `${JSON.stringify(m)}\n`);
  fs.mkdirSync(path.join(f.live, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'tasks', 'sess-a.json'), JSON.stringify({ schema: 'autopilot.session-tasks/1', session_id: 'sess-a', project_key: f.key, updated_at: iso(now), first_created_at: iso(now), tasks: [{ id: '1', subject: 'write the thing', status: 'in_progress' }] }));
  return m;
}
const sourcesFile = (f, root) => path.join(f.live, 'runs', 'sources', `${f.key}--${root}.json`);

test('A: a plain marker root with an in-progress task and NO runs gets a job page (phase from the task) and a sources sidecar', () => {
  const f = fx('a');
  plainFixture(f, 'job-plain-1');
  const x = mkWatcher(f);
  x.tick(); x.tick(6);
  const models = modelsOf(f.outRoot);
  assert.ok(models['job-plain-1'], 'job page model.json of the plain root');
  assert.strictEqual(models['job-plain-1'].phase.source, 'task');
  assert.ok(fs.existsSync(sourcesFile(f, 'job-plain-1')), 'sources sidecar of the plain root');
  assert.strictEqual(models.unbound, undefined, 'no unbound page is invented');
});

test('A: marker expired + retention window passed -> live files removed, the durable review page stays; it is not re-created', () => {
  const f = fx('a2');
  const m = plainFixture(f, 'job-plain-2');
  const x = mkWatcher(f);
  x.tick(); x.tick(6);
  assert.ok(fs.existsSync(sourcesFile(f, 'job-plain-2')));
  m.expires_at = iso(Date.now() - 1000);
  fs.writeFileSync(path.join(f.markers, 'sess-a.json'), JSON.stringify(m));
  fs.rmSync(path.join(f.live, 'tasks', 'sess-a.json'));
  x.tick(WINDOW_S - 5);
  x.tick(10);
  assert.strictEqual(fs.existsSync(sourcesFile(f, 'job-plain-2')), false, 'sources sidecar gone');
  assert.strictEqual(fs.existsSync(path.join(f.live, 'runs', `${f.key}--job-plain-2.json`)), false, 'envelope gone');
  assert.ok(modelsOf(f.outRoot)['job-plain-2'], 'durable review page stays');
  x.tick(8); x.tick(8);
  assert.strictEqual(fs.existsSync(sourcesFile(f, 'job-plain-2')), false, 'not re-created by later ticks');
});

// ------------------------------------------------------------------ B. interrupted turn

const SID = 'gf2-sid-0001';
function hookEnv(f) { return { ...process.env, ...f.env, AUTOPILOT_AWAITING_OWNER: '' }; }
function ups(f, over = {}) {
  const r = spawnSync('node', [ATTN], { input: JSON.stringify({ session_id: SID, hook_event_name: 'UserPromptSubmit', cwd: f.repo, ...over }), encoding: 'utf8', env: hookEnv(f) });
  assert.strictEqual(r.status, 0, r.stderr);
}
const turnPath = (f) => path.join(f.live, 'turn', `${SID}.json`);
const effPath = (f) => path.join(f.live, 'turn-effective', `${SID}.json`);
const row = (type, ts, extra = {}) => JSON.stringify({ type, timestamp: iso(ts), ...extra });
const interruptRow = (ts) => row('user', ts, { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] }, interruptedMessageId: 'msg_01' });
const asstRow = (ts) => row('assistant', ts, { message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] } });
const promptRow = (ts) => row('user', ts, { message: { role: 'user', content: 'go' } });
function activeTurn(f, transcriptLines, sinceMsAgo = 60000) {
  const tp = path.join(f.base, 'transcript.jsonl');
  if (transcriptLines !== null) fs.writeFileSync(tp, transcriptLines.join('\n') + '\n');
  fs.mkdirSync(path.join(f.live, 'turn'), { recursive: true });
  const since = Date.now() - sinceMsAgo;
  fs.writeFileSync(turnPath(f), JSON.stringify({ schema: 'autopilot.session-turn/1', session_id: SID, state: 'active', since: iso(since), project_key: f.key, root_run_id: null, transcript_path: tp }));
  return { tp, since };
}

test('B: the UserPromptSubmit writer stores transcript_path in the turn file (absent when the payload has none)', () => {
  const f = fx('b0');
  ups(f, { transcript_path: '/some/where/t.jsonl' });
  assert.strictEqual(readJson(turnPath(f)).transcript_path, '/some/where/t.jsonl');
  ups(f);
  assert.ok(!('transcript_path' in readJson(turnPath(f))) || readJson(turnPath(f)).transcript_path === null);
});

test('B: transcript whose last row is the interrupt row -> effective ended published; the hook\'s turn file is byte-identical', () => {
  const f = fx('b1');
  const t = Date.now();
  activeTurn(f, [promptRow(t - 50000), asstRow(t - 40000), interruptRow(t - 30000), row('file-history-snapshot', t - 29000)]);
  const before = fs.readFileSync(turnPath(f), 'utf8');
  const x = mkWatcher(f);
  x.tick();
  const eff = readJson(effPath(f));
  assert.strictEqual(eff.schema, 'autopilot.session-turn-effective/1');
  assert.strictEqual(eff.state, 'ended');
  assert.strictEqual(eff.reason, 'interrupted');
  assert.strictEqual(eff.turn_since, readJson(turnPath(f)).since);
  assert.strictEqual(fs.readFileSync(turnPath(f), 'utf8'), before, 'single writer: the watcher never rewrites turn/<sid>.json');
});

test('B: a normal assistant row after the interrupt (the user typed again) -> not ended; and the stale effective file is removed', () => {
  const f = fx('b2');
  const t = Date.now();
  const { tp } = activeTurn(f, [promptRow(t - 50000), interruptRow(t - 30000)]);
  const x = mkWatcher(f);
  x.tick();
  assert.ok(fs.existsSync(effPath(f)));
  fs.appendFileSync(tp, [promptRow(t - 20000), asstRow(t - 10000)].join('\n') + '\n');
  x.tick();
  assert.strictEqual(fs.existsSync(effPath(f)), false);
});

test('B: a new UserPromptSubmit (new since) beats a leftover effective-ended file; watcher then removes it', () => {
  const f = fx('b3');
  const t = Date.now();
  activeTurn(f, [promptRow(t - 50000), interruptRow(t - 30000)]);
  const x = mkWatcher(f);
  x.tick();
  const old = readJson(effPath(f));
  ups(f, { transcript_path: path.join(f.base, 'transcript.jsonl') });
  const now = readJson(turnPath(f));
  assert.strictEqual(now.state, 'active');
  assert.notStrictEqual(now.since, old.turn_since, 'the new turn has its own since (readers compare it)');
  x.tick();
  assert.strictEqual(fs.existsSync(effPath(f)), false, 'the interrupt row is older than the new turn -> nothing effective');
});

test('B: no transcript_path / missing / malformed transcript / interrupt older than since -> unchanged (fail-safe active)', () => {
  const t = Date.now();
  const cases = {
    'no path': (f) => { activeTurn(f, [interruptRow(t - 1000)]); const j = readJson(turnPath(f)); delete j.transcript_path; fs.writeFileSync(turnPath(f), JSON.stringify(j)); },
    'missing file': (f) => { activeTurn(f, null); },
    'garbage tail': (f) => { activeTurn(f, [promptRow(t - 5000), interruptRow(t - 4000), '{"type":"user", broken']); },
    'partial last row': (f) => { const a = activeTurn(f, [interruptRow(t - 4000)]); fs.appendFileSync(a.tp, '{"type":"assistant","time'); },
    'older than since': (f) => { activeTurn(f, [promptRow(t - 90000), interruptRow(t - 80000)], 60000); },
    'non-jsonl path': (f) => { const a = activeTurn(f, [interruptRow(t - 1000)]); const j = readJson(turnPath(f)); j.transcript_path = a.tp.replace(/\.jsonl$/, '.txt'); fs.copyFileSync(a.tp, j.transcript_path); fs.writeFileSync(turnPath(f), JSON.stringify(j)); },
    'ended turn': (f) => { activeTurn(f, [interruptRow(t - 1000)]); const j = readJson(turnPath(f)); j.state = 'ended'; fs.writeFileSync(turnPath(f), JSON.stringify(j)); },
    'foreign project': (f) => { activeTurn(f, [interruptRow(t - 1000)]); const j = readJson(turnPath(f)); j.project_key = 'ffffffffffffffff'; fs.writeFileSync(turnPath(f), JSON.stringify(j)); },
  };
  for (const [name, setup] of Object.entries(cases)) {
    const f = fx('b4');
    setup(f);
    const x = mkWatcher(f);
    x.tick();
    assert.strictEqual(fs.existsSync(effPath(f)), false, `${name}: no effective file`);
  }
});

test('B: a large transcript is tailed (8 KB), not read whole; the interrupt row at the end is still found', () => {
  const f = fx('b5');
  const t = Date.now();
  const filler = asstRow(t - 100000).replace('"working"', JSON.stringify('x'.repeat(900)));
  const lines = [];
  for (let i = 0; i < 4000; i++) lines.push(filler); // ~3.6 MB
  lines.push(interruptRow(t - 30000));
  const a = activeTurn(f, lines);
  assert.ok(fs.statSync(a.tp).size > 3e6);
  const reads = [];
  const realRead = fs.readSync;
  fs.readSync = function (fd, buf, ...rest) { reads.push(buf.length); return realRead.call(this, fd, buf, ...rest); };
  try { mkWatcher(f).tick(); } finally { fs.readSync = realRead; }
  assert.ok(fs.existsSync(effPath(f)), 'found in the tail');
  assert.ok(reads.length > 0 && reads.every((n) => n <= 8192), `transcript read only in <= 8 KB buffers (saw ${Math.max(...reads)})`);
});
