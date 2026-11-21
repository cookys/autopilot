/**
 * scripts/session-mode-expiry-sweep.test.js — `session-mode.js set` sweeps the marker dir it writes into:
 * best-effort removal of markers whose `expires_at` is MORE than 24 h in the past (they cannot change anything
 * any published snapshot shows, and the live mod re-stat'ed every listed marker on every poll — on real hosts
 * 2,615 never-cleaned files), or, when `expires_at` is missing/unparsable, of markers whose mtime is older than
 * 7 days. At most 500 removals per write; only files ending in `.json`; never the marker being written; every
 * error is ignored (the next write retries). Removal is fs.unlinkSync on a path built from that directory's own
 * readdir. Fleet-Task 01M7YHMENXK58FK99D5544R28T.
 * Run: node --test scripts/session-mode-expiry-sweep.test.js
 * Isolation: HOME, AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_LIVE_DIR, XDG_RUNTIME_DIR and the fixture repo live
 * under mkdtemp dirs; watcher autostart is off. The real ~/.autopilot is never read or written.
 */
'use strict';

require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SM = path.join(__dirname, 'session-mode.js');
const H = 3600 * 1000;

function mk() {
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-'));
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-xdg-'));
  fs.mkdirSync(path.join(T, 'h'), { mode: 0o700 });
  const modes = path.join(T, 'm');
  fs.mkdirSync(modes);
  const repo = path.join(T, 'repo');
  fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(T, 'h'),
    AUTOPILOT_SESSION_MODE_DIR: modes,
    AUTOPILOT_LIVE_DIR: path.join(T, 'live'),
    AUTOPILOT_DISPATCH_RUNS_DIR: path.join(T, 'dispatch'),
    XDG_RUNTIME_DIR: xdg,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    CLAUDE_CODE_SESSION_ID: 'snew',
  };
  return {
    T, xdg, modes, env,
    set: () => spawnSync(process.execPath, [SM, 'set'], { cwd: repo, env, encoding: 'utf8', timeout: 60000 }),
    marker: (sid, body) => fs.writeFileSync(path.join(modes, `${sid}.json`), JSON.stringify(body)),
    cleanup: () => {
      fs.rmSync(T, { recursive: true, force: true });
      fs.rmSync(xdg, { recursive: true, force: true });
    },
  };
}
const oldMarker = (t, sid, hoursPast = 48) => t.marker(sid, {
  session_id: sid, level: null, started_at: new Date(Date.now() - (hoursPast + 24) * H).toISOString(),
  expires_at: new Date(Date.now() - hoursPast * H).toISOString(),
});

test('set removes the 3 markers expired more than 24 h, keeps the live one and writes the new one', () => {
  const t = mk();
  try {
    oldMarker(t, 'old1', 25);
    oldMarker(t, 'old2', 48);
    oldMarker(t, 'old3', 72);
    t.marker('live', { session_id: 'live', level: null, expires_at: new Date(Date.now() + 6 * H).toISOString() });
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(t.modes, 'snew.json')), 'the new marker is written');
    assert.ok(fs.existsSync(path.join(t.modes, 'live.json')), 'the live marker is kept');
    for (const sid of ['old1', 'old2', 'old3']) assert.ok(!fs.existsSync(path.join(t.modes, `${sid}.json`)), `${sid} removed`);
  } finally { t.cleanup(); }
});

test('set keeps a marker that expired less than 24 h ago', () => {
  const t = mk();
  try {
    oldMarker(t, 'recent', 1); // expired 1 h ago: within the 24 h grace
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(t.modes, 'recent.json')));
  } finally { t.cleanup(); }
});

test('set never removes the marker it writes even when that file is an old expired one', () => {
  const t = mk();
  try {
    oldMarker(t, 'snew', 96); // the session\'s own stale marker: replaced by set, not unlinked by the sweep
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    const m = JSON.parse(fs.readFileSync(path.join(t.modes, 'snew.json'), 'utf8'));
    assert.strictEqual(m.session_id, 'snew');
    assert.ok(Date.parse(m.expires_at) > Date.now(), 'the fresh marker is in place');
  } finally { t.cleanup(); }
});

test('set only ever touches .json names: a .lock, a .tmp and a .txt sit untouched', () => {
  const t = mk();
  try {
    fs.writeFileSync(path.join(t.modes, 's1.lock'), 'lock\n');
    fs.writeFileSync(path.join(t.modes, 's2.json.tmp-4242'), '{}');
    fs.writeFileSync(path.join(t.modes, 'notes.txt'), 'hi\n');
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    for (const f of ['s1.lock', 's2.json.tmp-4242', 'notes.txt']) assert.ok(fs.existsSync(path.join(t.modes, f)), `${f} untouched`);
  } finally { t.cleanup(); }
});

test('a missing or unparsable expires_at falls back to the mtime rule (7 days)', () => {
  const t = mk();
  try {
    t.marker('noexp-old', { session_id: 'noexp-old', level: null });
    const old = new Date(Date.now() - 8 * 24 * H);
    fs.utimesSync(path.join(t.modes, 'noexp-old.json'), old.getTime() / 1000, old.getTime() / 1000);
    t.marker('noexp-fresh', { session_id: 'noexp-fresh', level: null });
    t.marker('garbage-old', { session_id: 'garbage-old', level: null, expires_at: 'garbage' });
    fs.utimesSync(path.join(t.modes, 'garbage-old.json'), old.getTime() / 1000, old.getTime() / 1000);
    t.marker('garbage-fresh', { session_id: 'garbage-fresh', level: null, expires_at: 'garbage' });
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(t.modes, 'noexp-old.json')), 'no expires_at + 8-day mtime: removed');
    assert.ok(fs.existsSync(path.join(t.modes, 'noexp-fresh.json')), 'no expires_at + fresh mtime: kept');
    assert.ok(!fs.existsSync(path.join(t.modes, 'garbage-old.json')), 'unparsable + 8-day mtime: removed');
    assert.ok(fs.existsSync(path.join(t.modes, 'garbage-fresh.json')), 'unparsable + fresh mtime: kept');
  } finally { t.cleanup(); }
});

test('the sweep removes at most 500 markers per write; the rest wait for the next write', () => {
  const t = mk();
  try {
    for (let i = 0; i < 502; i += 1) oldMarker(t, `x${String(i).padStart(4, '0')}`, 48);
    const r = t.set();
    assert.strictEqual(r.status, 0, r.stderr);
    const left = fs.readdirSync(t.modes).filter((f) => /^x\d{4}\.json$/.test(f));
    assert.strictEqual(left.length, 2, `500 of the 502 removed, 2 remain (left: ${left.join(', ')})`);
  } finally { t.cleanup(); }
});
