// advisory-sink (P7a advisory bridge): knob precedence and the row contract.
// Run: node --test hooks/advisory-sink.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LIB = path.join(__dirname, '_shared', 'advisory-sink.js');

// The lib reads os.homedir() and process.env, so each case runs in a child with a pinned HOME and live dir.
function run(expr, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'advsink-home-'));
  const live = path.join(home, 'live');
  if (env.__config) {
    fs.mkdirSync(path.join(home, '.autopilot'), { recursive: true });
    fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify(env.__config));
  }
  const { __config, ...rest } = env;
  const r = spawnSync(process.execPath, ['-e', `const s=require(${JSON.stringify(LIB)}); process.stdout.write(JSON.stringify(${expr}))`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, AUTOPILOT_LIVE_DIR: live, ...rest },
  });
  return { out: r.stdout ? JSON.parse(r.stdout) : null, live, home, status: r.status };
}

test('advisoryMode: default is sink', () => {
  assert.strictEqual(run("s.advisoryMode('cost_tracker')").out, 'sink');
});

test('advisoryMode: per-hook env beats global env beats config', () => {
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { AUTOPILOT_ADVISORY_BRIDGE_COST_TRACKER: 'inject' }).out, 'inject');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { AUTOPILOT_ADVISORY_BRIDGE: 'inject' }).out, 'inject');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { AUTOPILOT_ADVISORY_BRIDGE: 'inject', AUTOPILOT_ADVISORY_BRIDGE_COST_TRACKER: 'sink' }).out, 'sink');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { __config: { advisory_bridge: { mode: 'inject' } }, AUTOPILOT_ADVISORY_BRIDGE: 'sink' }).out, 'sink');
});

test('advisoryMode: config per-hook key and mode; garbage ignored', () => {
  assert.strictEqual(run("s.advisoryMode('version_drift')", { __config: { advisory_bridge: { version_drift: 'inject' } } }).out, 'inject');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { __config: { advisory_bridge: { version_drift: 'inject' } } }).out, 'sink');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { __config: { advisory_bridge: { mode: 'inject' } } }).out, 'inject');
  assert.strictEqual(run("s.advisoryMode('cost_tracker')", { __config: { advisory_bridge: { mode: 'banana' } } }).out, 'sink');
});

test('writeAdvisory: row shape, sanitised file name, empty sid or text refused', () => {
  const r = run("[s.writeAdvisory({sid:'a/b c',kind:'k',severity:'warn',text:'T'}), s.writeAdvisory({sid:'',kind:'k',text:'T'}), s.writeAdvisory({sid:'x',kind:'k',text:''})]");
  assert.deepStrictEqual(r.out, [true, false, false]);
  const rows = fs.readFileSync(path.join(r.live, 'advisories', 'a_b_c.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['at', 'id', 'kind', 'severity', 'text']);
  assert.strictEqual(rows[0].text, 'T');
  assert.strictEqual(rows[0].severity, 'warn');
});
