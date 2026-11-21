/**
 * scripts/runs-watch-sources.test.js — the sourceFingerprint (the published envelope's `sources`) lists in its
 * marker group only the LIVE markers of this project: `expires_at` in the future, or no parsable `expires_at`
 * and an mtime within one marker TTL (24 h). An expired marker cannot change anything the snapshot shows, and
 * every listed file is re-stat'ed by the live mod (mods/live judgeByChange) on every poll — on real hosts
 * ~/.autopilot/session-mode/ had accumulated 2,615 never-cleaned files, so an all-markers list cost a running
 * seat 468-765 statx/s. Companions of this change: mods/live memoizes a fresh verdict per envelope (re-checks
 * the group dirs' mtimes only), and scripts/session-mode.js sweeps long-expired markers when it writes one.
 * Run: node --test scripts/runs-watch-sources.test.js
 * Isolation: everything under mkdtemp dirs; the real ~/.autopilot is never read or written.
 */
'use strict';

require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sourceFingerprint, readLiveMarkers, createWatcher } = require('../src/status/runs-watch');
const { spawnSync } = require('child_process');
const { scopeFromCwd } = require('../src/status/project-key');

const H = 3600 * 1000;
const NOW = Date.parse('2026-11-21T12:00:00.000Z');
const KEY = 'a1b2c3d4e5f60718';
const IDENT = 'git-common-dir:/srv/repo/.git';
const iso = (ms) => new Date(ms).toISOString();

function mk() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rws-'));
  const markers = path.join(base, 'markers');
  const manifests = path.join(base, 'manifests');
  fs.mkdirSync(markers);
  fs.mkdirSync(manifests);
  const env = { AUTOPILOT_SESSION_MODE_DIR: markers, AUTOPILOT_DISPATCH_RUNS_DIR: manifests };
  return {
    base, markers, env,
    w: (name, m) => fs.writeFileSync(path.join(markers, name), JSON.stringify(m)),
    mtime: (name, ms) => fs.utimesSync(path.join(markers, name), ms / 1000, ms / 1000),
    fp: (over = {}) => sourceFingerprint({
      env, key: KEY, identity: IDENT, rows: [], dirs: { manifest: 1000, marker: 1000 }, startMs: NOW, ...over,
    }),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}
const markerFilesOfFp = (t) => t.fp().find((g) => g.role === 'marker').files.map((f) => path.basename(f.path)).sort();

test('sourceFingerprint: the marker group lists the live marker, not the expired one or another project\'s', () => {
  const t = mk();
  try {
    t.w('live.json', { session_id: 'live', project_key: KEY, expires_at: iso(NOW + H) });
    t.w('expired.json', { session_id: 'expired', project_key: KEY, expires_at: iso(NOW - H) });
    t.w('theirs.json', { session_id: 'theirs', project_key: 'ffffffffffffffff', expires_at: iso(NOW + H) });
    assert.deepStrictEqual(markerFilesOfFp(t), ['live.json']);
  } finally { t.cleanup(); }
});

test('sourceFingerprint: expires_at exactly at now is expired (the marker is not listed)', () => {
  const t = mk();
  try {
    t.w('now.json', { session_id: 'now', project_key: KEY, expires_at: iso(NOW) });
    t.w('in-a-second.json', { session_id: 'x', project_key: KEY, expires_at: iso(NOW + 1) });
    assert.deepStrictEqual(markerFilesOfFp(t), ['in-a-second.json']);
  } finally { t.cleanup(); }
});

test('sourceFingerprint: no expires_at — listed while the mtime is within one marker TTL, dropped after', () => {
  const t = mk();
  try {
    t.w('fresh-noexp.json', { session_id: 'f', project_key: KEY });
    t.mtime('fresh-noexp.json', NOW - H);
    t.w('old-noexp.json', { session_id: 'o', project_key: KEY });
    t.mtime('old-noexp.json', NOW - 24 * H - 1000);
    assert.deepStrictEqual(markerFilesOfFp(t), ['fresh-noexp.json']);
    // the same file, aged past the TTL: gone from the list
    t.mtime('fresh-noexp.json', NOW - 24 * H - 1000);
    assert.deepStrictEqual(markerFilesOfFp(t), []);
  } finally { t.cleanup(); }
});

test('sourceFingerprint: an unparsable expires_at falls back to the mtime rule like a missing one', () => {
  const t = mk();
  try {
    t.w('garbage-fresh.json', { session_id: 'g', project_key: KEY, expires_at: 'garbage' });
    t.mtime('garbage-fresh.json', NOW - H);
    t.w('garbage-old.json', { session_id: 'g2', project_key: KEY, expires_at: 'garbage' });
    t.mtime('garbage-old.json', NOW - 24 * H - 1000);
    assert.deepStrictEqual(markerFilesOfFp(t), ['garbage-fresh.json']);
  } finally { t.cleanup(); }
});

test('readLiveMarkers: the same live-only rule, and an unreadable marker is not ours', () => {
  const t = mk();
  try {
    t.w('live.json', { session_id: 'live', project_key: KEY, expires_at: iso(NOW + H) });
    t.w('unreadable.json', '{not json');
    assert.deepStrictEqual(readLiveMarkers(t.markers, KEY, NOW).paths.map((p) => path.basename(p)), ['live.json']);
  } finally { t.cleanup(); }
});

test('runs-watch with 5000 expired markers', () => {
  const t = mk();
  const oldHome = process.env.HOME;
  process.env.HOME = t.base;
  const repo = path.join(t.base, 'repo');
  fs.mkdirSync(repo);
  assert.equal(spawnSync('git', ['init', '-q', repo]).status, 0);
  const scope = scopeFromCwd(repo);
  const env = { ...t.env, PATH: process.env.PATH, HOME: t.base, AUTOPILOT_LIVE_DIR: path.join(t.base, 'live'), AUTOPILOT_COSTS_FILE: path.join(t.base, 'costs'), AUTOPILOT_PLAN_REVIEW_STATE_DIR: path.join(t.base, 'plan-review') };
  const watcher = createWatcher({ key: scope.project_key, env, cwd: repo, collect: () => [], now: () => NOW, render: { outRoot: path.join(t.base, 'render') }, codeFingerprint: { changed: () => false } });
  const write = (name, expires, extra = {}) => t.w(`${name}.json`, { session_id: name, project_key: scope.project_key, expires_at: iso(expires), ...extra });
  for (let i = 0; i < 2000; i++) write(`old-${i}`, NOW - 26 * H);
  for (let i = 0; i < 2000; i++) write(`hour-${i}`, NOW - H);
  for (let i = 0; i < 500; i++) write(`campaign-${i}`, NOW - H, { level: 'l5', campaign_roots: ['root'] });
  for (let i = 0; i < 500; i++) write(`l3-${i}`, NOW - 26 * H, { level: 'l3' });
  for (let i = 0; i < 3; i++) write(`live-${i}`, NOW + H, { root_run_id: 'root' });
  const originalRead = fs.readFileSync;
  const originalReaddir = fs.readdirSync;
  const originalParse = JSON.parse;
  let counts;
  const inside = (file) => typeof file === 'string' && (path.resolve(file) === path.resolve(t.markers) || path.resolve(file).startsWith(path.resolve(t.markers) + path.sep));
  fs.readFileSync = function (file, ...args) { if (inside(file)) counts.read++; return originalRead.call(this, file, ...args); };
  fs.readdirSync = function (file, ...args) { if (inside(file)) counts.readdir++; return originalReaddir.call(this, file, ...args); };
  JSON.parse = function (...args) { counts.parse++; return originalParse.apply(this, args); };
  const tick = () => { counts = { read: 0, readdir: 0, parse: 0 }; const result = watcher.tick(); assert.equal(result.error, undefined); return { ...counts }; };
  try {
    const first = tick();
    const firstRemaining = originalReaddir(t.markers).length;
    for (let i = 0; i < 100; i++) write(`recent-${i}`, NOW - 1000);
    const second = tick();
    const secondRemaining = originalReaddir(t.markers).length;
    assert.equal(secondRemaining, 3, 'second tick removes every expired marker');
    const clean = tick();
    assert.ok(clean.read <= 3 + 5, `clean tick reads ${clean.read}`);
    assert.equal(clean.readdir, 1);
    assert.ok(clean.parse <= 3 + 5, `clean tick parses ${clean.parse}`);
    assert.ok(second.read <= 203 + 5, `second tick reads ${second.read}`);
    assert.equal(firstRemaining, 3, 'first tick removes every expired marker');
    assert.ok(first.read <= 10003 + 5, `first tick reads ${first.read}`);
  } finally {
    fs.readFileSync = originalRead;
    fs.readdirSync = originalReaddir;
    JSON.parse = originalParse;
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    t.cleanup();
  }
});
