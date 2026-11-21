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
const { sourceFingerprint, readLiveMarkers } = require('../src/status/runs-watch');

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
