'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'end-hook-'));
process.env.HOME = home;
const dir = path.join(home, 'markers'); fs.mkdirSync(dir);
const env = { PATH: process.env.PATH, HOME: home, AUTOPILOT_SESSION_MODE_DIR: dir };
const hook = path.join(__dirname, 'session-mode-end.js');
const file = sid => path.join(dir, `${sid}.json`);
const write = (sid, extra = {}) => fs.writeFileSync(file(sid), JSON.stringify({ session_id: sid, level: null, expires_at: new Date(Date.now() + 86400000).toISOString(), stage: 'verify', root_run_id: 'root', ...extra }));
const run = (input, extra = {}) => spawnSync(process.execPath, [hook], { input, env: { ...env, ...extra }, encoding: 'utf8' });
const payload = sid => JSON.stringify({ session_id: sid, reason: 'clear' });
test('SessionEnd hook deletes only the payload session marker', () => {
  for (const sid of ['one', 'two', 'three']) write(sid);
  assert.equal(run(payload('two')).status, 0);
  assert.deepEqual(['one', 'two', 'three'].map(s => fs.existsSync(file(s))), [true, false, true]);
});
test('cleanup knob disables hook', () => {
  write('disabled'); assert.equal(run(payload('disabled'), { AUTOPILOT_SESSION_END_CLEANUP: '0' }).status, 0);
  assert.equal(fs.existsSync(file('disabled')), true);
});
test('bad JSON fails open', () => {
  write('bad'); assert.equal(run('{').status, 0); assert.equal(fs.existsSync(file('bad')), true);
});
test('reason=clear deletes the plain marker', () => {
  write('clearplain'); assert.equal(run(payload('clearplain')).status, 0); assert.equal(fs.existsSync(file('clearplain')), false);
});
test('reason=clear clamps the l3–l6 marker', () => {
  write('clearmode', { level: 'l5' }); const before = Date.now();
  assert.equal(run(payload('clearmode')).status, 0);
  const m = JSON.parse(fs.readFileSync(file('clearmode')));
  assert.ok(Date.parse(m.expires_at) <= Date.now() + 1200000 && Date.parse(m.expires_at) >= before);
  assert.deepEqual([m.level, m.stage, m.root_run_id], ['l5', 'verify', 'root']);
});
test('SessionEnd hook is registered in manifest and default-on profile', () => {
  const manifest = require('./hooks.json');
  assert.ok(manifest.hooks.SessionEnd.some(entry => entry.hooks.some(h => h.command.includes('/session-mode-end.js'))));
  const profile = require('../profiles/hook-classes.json');
  assert.ok(JSON.stringify(profile).includes('"stem":"session-mode-end","class":"invariant_effect"'));
});
