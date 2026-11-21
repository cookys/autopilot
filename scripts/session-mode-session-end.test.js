'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'session-end-test-'));
process.env.HOME = home;
process.env.AUTOPILOT_SESSION_MODE_DIR = path.join(home, 'markers');
fs.mkdirSync(process.env.AUTOPILOT_SESSION_MODE_DIR);
const { unlinkIfStillExpired } = require('./session-mode');

test('locked recheck reports no removal for a live marker', () => {
  const file = path.join(process.env.AUTOPILOT_SESSION_MODE_DIR, 'live.json');
  fs.writeFileSync(file, JSON.stringify({ expires_at: new Date(Date.now() + 3600000).toISOString() }));
  assert.equal(unlinkIfStillExpired(file, Date.now(), 0), false);
  assert.equal(fs.existsSync(file), true);
});

const { endSession, ensurePlainMarker, sweepExpiredMarkers } = require('./session-mode');
const dir = process.env.AUTOPILOT_SESSION_MODE_DIR;
const now = Date.now();
const marker = (sid, extra = {}) => ({ session_id: sid, level: null, expires_at: new Date(now + 86400000).toISOString(), stage: 'implement', root_run_id: 'root', ...extra });
function put(sid, data = marker(sid)) { const file = path.join(dir, `${sid}.json`); fs.writeFileSync(file, JSON.stringify(data)); return file; }
function get(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

test('endSession removes a plain marker and is idempotent', () => {
  const file = put('plain');
  assert.equal(endSession('plain', { dir, now }), 'removed');
  assert.equal(fs.existsSync(file), false);
  assert.equal(endSession('plain', { dir, now }), 'absent');
});
test('endSession keeps a live campaign marker', () => {
  const file = put('campaign', marker('campaign', { level: 'l5', campaign_roots: ['run'] }));
  assert.equal(endSession('campaign', { dir, now }), 'kept_campaign');
  assert.equal(fs.existsSync(file), true);
});
test('endSession clamps a mode marker without changing identity', () => {
  const file = put('mode', marker('mode', { level: 'l5' }));
  assert.equal(endSession('mode', { dir, now }), 'clamped');
  const m = get(file);
  assert.equal(Date.parse(m.expires_at), now + 1200000);
  assert.deepEqual([m.level, m.stage, m.root_run_id], ['l5', 'implement', 'root']);
});
test('endSession refuses parent and mismatched markers', () => {
  const parent = put('parent');
  assert.equal(endSession('parent', { dir, now, parentSessionId: 'parent' }), 'refused_parent');
  assert.equal(fs.existsSync(parent), true);
  const mismatch = put('mismatch', marker('other'));
  assert.equal(endSession('mismatch', { dir, now }), 'mismatch');
  assert.equal(fs.existsSync(mismatch), true);
});
test('expired campaign is removed before retention', () => {
  const file = put('expired-campaign', marker('expired-campaign', { level: 'l5', campaign_roots: ['run'], expires_at: new Date(now - 1000).toISOString() }));
  assert.equal(endSession('expired-campaign', { dir, now }), 'removed');
  assert.equal(fs.existsSync(file), false);
});
test('resume refreshes a clamped l5 marker', () => {
  const file = put('resume', marker('resume', { level: 'l5' }));
  assert.equal(endSession('resume', { dir, now }), 'clamped');
  const resume = now + 19 * 60000;
  assert.equal(ensurePlainMarker({ sessionId: 'resume', dir, now: resume }), 'kept');
  const m = get(file);
  assert.equal(Date.parse(m.expires_at), resume + 86400000);
  assert.deepEqual([m.level, m.stage, m.root_run_id], ['l5', 'implement', 'root']);
  sweepExpiredMarkers(dir, null, now + 21 * 60000, { max: 0, graceMs: 0 });
  assert.equal(fs.existsSync(file), true);
});
test('expired marker recheck preserves concurrent replacement and does not count it', () => {
  const file = put('race', marker('race', { expires_at: new Date(now - 1000).toISOString() }));
  const replacement = marker('race', { level: 'l5' });
  const original = fs.readFileSync;
  let probes = 0;
  fs.readFileSync = function(p, ...args) {
    const result = original.call(this, p, ...args);
    if (p === file && ++probes === 1) {
      const tmp = `${file}.replacement`;
      fs.writeFileSync(tmp, JSON.stringify(replacement));
      fs.renameSync(tmp, file);
    }
    return result;
  };
  let result;
  try { result = sweepExpiredMarkers(dir, null, now, { max: 0, graceMs: 0 }); }
  finally { fs.readFileSync = original; }
  assert.equal(result.removed, 0);
  assert.deepEqual(get(file), replacement);
});
test('abnormal end residue is removed by sweep', () => {
  const file = put('killed', marker('killed', { expires_at: new Date(now - 1000).toISOString() }));
  sweepExpiredMarkers(dir, null, now, { max: 0, graceMs: 0 });
  assert.equal(fs.existsSync(file), false);
});
