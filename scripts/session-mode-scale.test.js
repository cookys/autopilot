'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'session-scale-'));
process.env.HOME = home;
process.env.AUTOPILOT_SESSION_ID = 'own';
process.env.AUTOPILOT_LIVE_DIR = path.join(home, 'live');
const mode = require('./session-mode');
const now = Date.now();
let n = 0;
function fixture(groups) {
  const dir = path.join(home, `fixture-${n++}`); fs.mkdirSync(dir);
  for (const [count, age, level, campaign] of groups) for (let i = 0; i < count; i++) {
    const sid = `s${age}-${level}-${campaign}-${i}`;
    fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify({ session_id: sid, level, campaign_roots: campaign ? ['run'] : [], expires_at: new Date(now - age).toISOString() }));
  }
  fs.writeFileSync(path.join(dir, 'own.json'), JSON.stringify({ session_id: 'own', level: 'l5', stage: 'verify', root_run_id: 'root', expires_at: new Date(now + 86400000).toISOString() }));
  return dir;
}
const groups = [[2000, 25*3600000, null, false], [2000, 3600000, null, false], [500, 3600000, 'l5', true], [500, 25*3600000, 'l3', false]];
function sweep(dir, args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'session-mode.js'), 'sweep', ...args], { env: { PATH: process.env.PATH, HOME: home, AUTOPILOT_SESSION_MODE_DIR: dir, AUTOPILOT_SESSION_ID: 'own' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
test('reader-side unlink removes expired marker', () => {
  const dir = fixture([[1, 3600000, null, false]]); const file = path.join(dir, 's3600000-null-false-0.json');
  assert.equal(mode.unlinkIfStillExpired(file, now, 0), true); assert.equal(fs.existsSync(file), false);
});
test('hot path operations remain constant with 5000 expired markers', () => {
  function measure(dir) {
    process.env.AUTOPILOT_SESSION_MODE_DIR = dir;
    const own = path.join(dir, 'own.json');
    fs.writeFileSync(own, JSON.stringify({ session_id: 'own', level: 'l5', root_run_id: 'root', expires_at: new Date(now - 1000).toISOString() }));
    const live = path.join(home, 'live'); fs.mkdirSync(path.join(live, 'turn'), { recursive: true });
    fs.writeFileSync(path.join(live, 'turn', 'own.json'), JSON.stringify({ since: new Date(now).toISOString() }));
    const counts = { readFileSync: 0, readdirSync: 0, statSync: 0, existsSync: 0, turn: 0 };
    const originals = {};
    for (const key of ['readFileSync', 'readdirSync', 'statSync', 'existsSync']) {
      originals[key] = fs[key]; fs[key] = function(p, ...args) {
        if (typeof p === 'string') { const resolved = path.resolve(p); if (resolved === dir || resolved.startsWith(dir + path.sep)) counts[key]++; else if (key === 'readFileSync' && resolved === path.join(live, 'turn', 'own.json')) counts.turn++; }
        return originals[key].call(this, p, ...args);
      };
    }
    const start = performance.now();
    try { mode.readSessionRecord('own'); mode.readMarker(); mode.readSessionRoot('own', { liveBase: live }); }
    finally { for (const key of Object.keys(originals)) fs[key] = originals[key]; }
    assert.ok(performance.now() - start < 200);
    return counts;
  }
  const small = measure(fixture([[5, 3600000, null, false]]));
  const large = measure(fixture(groups));
  assert.deepEqual(large, small);
  assert.ok(large.readFileSync <= 3 && large.turn <= 1 && large.readdirSync === 0 && large.statSync <= 2 && large.existsSync <= 2);
});
test('resume refresh stays under 200ms median with 5000 residual markers', () => {
  const timings = [];
  for (let i = 0; i < 6; i++) {
    const dir = fixture(groups);
    const sid = `resume${i}`; fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify({ session_id: sid, level: 'l5', expires_at: new Date(now + 1200000).toISOString() }));
    const start = performance.now(); assert.equal(mode.ensurePlainMarker({ sessionId: sid, dir, now }), 'kept'); const elapsed = performance.now() - start;
    if (i) timings.push(elapsed);
  }
  timings.sort((a,b) => a-b); assert.ok(timings[2] < 200, `median ${timings[2]}ms`);
});
test('bounded and unlimited sweeps converge with correct grace', () => {
  const dir = fixture(groups);
  for (let i = 1; i <= 10; i++) assert.deepEqual(sweep(dir, ['--max', '500', '--grace-ms', '0']), { removed: 500, remaining: 5000 - i*500 });
  assert.deepEqual(fs.readdirSync(dir), ['own.json']);
  const defaults = fixture([[2000, 25*3600000, null, false]]);
  assert.deepEqual(sweep(defaults, []), { removed: 500, remaining: 1500 }); assert.equal(fs.readdirSync(defaults).length, 1501);
  const recent = fixture([[2000, 3600000, null, false]]);
  assert.deepEqual(sweep(recent, []), { removed: 0, remaining: 0 }); assert.equal(fs.readdirSync(recent).length, 2001);
  const unlimited = fixture(groups);
  assert.deepEqual(sweep(unlimited, ['--max', '0', '--grace-ms', '0']), { removed: 5000, remaining: 0 }); assert.deepEqual(fs.readdirSync(unlimited), ['own.json']);
});
