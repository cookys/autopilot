/**
 * Tests for the watcher publishing the campaign roots a session marker names (mods P1W SCOPE, gate run l5g).
 * Run: node --test hooks/runs-watch-campaign-roots.test.js
 *
 * Contract under test
 *   - every unexpired marker's `campaign_roots` (additive field written by `session-mode.js bind-campaign-root`) is a
 *     root scope exactly like its `root_run_id`: its envelope + decisions sidecar are published and kept while the
 *     marker lives, even when no run row names that root (the campaign is terminal, or has not started a run yet).
 *   - once the marker expires the campaign root is dropped after the idle window, like any other root.
 *   - negative controls: another project's marker names roots -> not published here; a marker without campaign_roots adds
 *     nothing; a non-string or non-array value is ignored; an unsafe id still gets only a sanitised file name.
 * Isolation: HOME, AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_LIVE_DIR (under /dev/shm), XDG_RUNTIME_DIR all temp.
 *
 * RED (before the change): 4 tests, 1 pass (the negative case, vacuous) / 3 fail: run-w/land/scope-watch-red.txt. GREEN: 4 / 4. Mutation controls: run-w/land/scope-mut-watch-*.txt.
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

const bases = [];
function fx(name = 'cr') {
  const base = fs.mkdtempSync(path.join('/dev/shm', `rwcr-${name}-`));
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
  return { base, repo, home, markers, live, env, key: sc.project_key, identity: sc.repo_identity };
}
test.after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

const iso = (ms) => new Date(ms).toISOString();
function writeMarker(f, sid, over = {}) {
  const now = Date.now();
  const m = { session_id: sid, level: 'l5', repo_root: f.repo, started_at: iso(now), expires_at: iso(now + 36e5), repo_identity: f.identity, project_key: f.key, root_run_id: 'job-1', ...over };
  fs.writeFileSync(path.join(f.markers, `${sid}.json`), JSON.stringify(m));
}
const expire = (f, sid) => {
  const file = path.join(f.markers, `${sid}.json`);
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.expires_at = iso(Date.now() - 1000);
  fs.writeFileSync(file, JSON.stringify(m));
};
const WINDOW_S = 30;
function mkWatcher(f, collect = () => []) {
  const clock = { t: Date.now() };
  const w = createWatcher({ key: f.key, env: { ...f.env }, cwd: f.repo, collect: () => collect(clock), now: () => clock.t, interval: 1, idleExitS: WINDOW_S });
  return { w, clock, tick(dtS = 1) { clock.t += dtS * 1000; return w.tick(); } };
}
const envelopeOf = (f, root) => path.join(f.live, 'runs', `${f.key}--${root}.json`);
const sidecarOf = (f, root) => path.join(f.live, 'runs', `${f.key}--${root}.decisions.json`);
const scopedFiles = (f) => (fs.existsSync(path.join(f.live, 'runs')) ? fs.readdirSync(path.join(f.live, 'runs')).filter((n) => n.startsWith(`${f.key}--`)).sort() : []);

test('a campaign root named by an unexpired marker is published and kept with no run row at all', () => {
  const f = fx();
  writeMarker(f, 'a', { campaign_roots: ['mission-m1'] });
  const x = mkWatcher(f);
  x.tick();
  assert.ok(fs.existsSync(envelopeOf(f, 'job-1')), 'the marker root envelope');
  assert.ok(fs.existsSync(envelopeOf(f, 'mission-m1')), 'the campaign root envelope');
  assert.ok(fs.existsSync(sidecarOf(f, 'mission-m1')), 'the campaign root decisions sidecar');
  assert.strictEqual(JSON.parse(fs.readFileSync(envelopeOf(f, 'mission-m1'), 'utf8')).scope.root_run_id, 'mission-m1');
  x.tick(WINDOW_S * 3); x.tick(WINDOW_S * 3);
  assert.ok(fs.existsSync(envelopeOf(f, 'mission-m1')), 'kept far beyond the idle window while the marker lives');
});

test('once the marker expires the campaign root is dropped after the idle window', () => {
  const f = fx();
  writeMarker(f, 'a', { campaign_roots: ['mission-m1'] });
  const x = mkWatcher(f);
  x.tick();
  expire(f, 'a');
  x.tick(WINDOW_S - 5);
  assert.ok(fs.existsSync(envelopeOf(f, 'mission-m1')), 'kept inside the window');
  x.tick(10);
  assert.deepStrictEqual(scopedFiles(f), [], 'every scoped live file is gone');
});

test('several campaign roots are all published', () => {
  const f = fx();
  writeMarker(f, 'a', { campaign_roots: ['mission-m1', 'mission-m2'] });
  const x = mkWatcher(f);
  x.tick();
  for (const r of ['mission-m1', 'mission-m2']) assert.ok(fs.existsSync(envelopeOf(f, r)), r);
});

test('negative: another project\'s marker, a marker without campaign_roots, and malformed values add no scope', () => {
  const f = fx();
  writeMarker(f, 'other', { project_key: 'ffffffffffffffff', campaign_roots: ['mission-foreign'] });
  writeMarker(f, 'plain', { root_run_id: 'job-2' });
  writeMarker(f, 'junk1', { root_run_id: 'job-3', campaign_roots: 'mission-notarray' });
  writeMarker(f, 'junk2', { root_run_id: 'job-4', campaign_roots: [42, null, '', { a: 1 }] });
  writeMarker(f, 'junk3', { root_run_id: 'job-5', campaign_roots: ['../x', 'a b', 'x/y', 'y'.repeat(129)] });
  const x = mkWatcher(f);
  x.tick();
  assert.deepStrictEqual(scopedFiles(f).filter((n) => !n.includes('decisions')), ['job-2', 'job-3', 'job-4', 'job-5'].map((r) => `${f.key}--${r}.json`));
  assert.ok(!fs.existsSync(envelopeOf(f, 'mission-foreign')));
  assert.ok(!fs.existsSync(envelopeOf(f, 'mission-notarray')));
});

// ---- SCOPE2 (gate run l5h): the campaign's ICC id is a root scope of its own, and the frozen progress receipt lives under it ----
// l5h shape: marker.campaign_roots = [mission root, ICC id]; work-orders/<ICC id>/<node>-a1.json holds the receipt (its own
// root_run_id = the ICC id, project_id = the mission root); the mission root has NO receipts. The watcher must publish BOTH
// envelopes and a job model for the ICC root that carries the frozen progress, and none for the mission root.
// Verification of existing behaviour (the watcher reads work-orders/<root>/ for every published root): green before and after the
// SCOPE2 engine change; mutation control: run-w/land/scope2-mut-watch-*.txt.
const ICC = 'campaign-v1-' + '3d'.repeat(32);
function jobModelOf(outRoot, job) {
  for (const d of fs.existsSync(outRoot) ? fs.readdirSync(outRoot) : []) {
    const file = path.join(outRoot, d, job, 'current', 'model.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return null;
}
test('SCOPE2: the ICC campaign id is published as a root and its work-order receipt becomes that root\'s frozen progress', () => {
  const f = fx('icc');
  writeMarker(f, 'a', { campaign_roots: ['mission-m1', ICC] });
  const common = f.identity.replace(/^git-common-dir:/, '');
  const woDir = path.join(common, 'autopilot', 'work-orders', ICC);
  fs.mkdirSync(woDir, { recursive: true });
  const receipt = { schema_version: 1, artifact_type: 'controller_progress_receipt', project_id: 'mission-m1', deliverable_id: 'd1', generation: 0, active_process: null,
    completed_deliverables: ['d1'], remaining_deliverables: [], deliverable_count: 1, frozen_denominator_digest: 'c'.repeat(64), blocked_reason: null, eta_basis: 'frozen_graph_remaining',
    gate_state: { entries: [] }, resource_debt_state: { open: [], released: [] }, phase: 'DONE', work_order_id: 'wo', root_run_id: ICC, issued_at: '2026-10-05T14:58:58.451Z', digest: 'e'.repeat(64) };
  fs.writeFileSync(path.join(woDir, 'gate-a1.json'), JSON.stringify({ artifact_type: 'work_order', root_run_id: ICC, attempt: 1, controller: { progress_receipts: [receipt] } }));
  const outRoot = path.join(f.base, 'review-out');
  const clock = { t: Date.now() };
  const w = createWatcher({ key: f.key, env: { ...f.env }, cwd: f.repo, collect: () => [], now: () => clock.t, interval: 10, enrichCap: 8, idleExitS: WINDOW_S, render: { outRoot } });
  for (const dt of [10, 6, 10, 10]) { clock.t += dt * 1000; w.tick(); }
  assert.ok(fs.existsSync(envelopeOf(f, ICC)), 'the ICC root envelope is published');
  assert.ok(fs.existsSync(envelopeOf(f, 'mission-m1')), 'the mission root envelope is published');
  const icc = jobModelOf(outRoot, ICC);
  assert.ok(icc, 'a job model exists for the ICC root');
  assert.ok(icc.progress && icc.progress.frozen === true && icc.progress.done === 1 && icc.progress.total === 1, 'frozen progress 1/1 from work-orders/<ICC id>: ' + JSON.stringify(icc.progress));
  const mission = jobModelOf(outRoot, 'mission-m1');
  assert.ok(mission && !(mission.progress && mission.progress.frozen), 'the mission root (no receipts) carries no frozen progress');
});
