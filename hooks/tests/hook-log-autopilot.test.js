'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { logDecision } = require('../_shared/hook-log');
const HOOKS = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-log-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(hook, payload, logFile, home = fs.mkdtempSync(path.join(tmp, 'home-'))) {
  const env = { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: path.join(home, 'live') };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.XDG_STATE_HOME;
  if (logFile) env.AUTOPILOT_HOOK_LOG = logFile; else delete env.AUTOPILOT_HOOK_LOG;
  return spawnSync('node', [path.join(HOOKS, hook)], { input: JSON.stringify(payload), env, encoding: 'utf8' });
}
const workOrder = { tool_name: 'mcp__fleet__send', tool_input: { to: 'a/b/c', content: '請做 X 然後回報' } };
const fact = { tool_name: 'mcp__fleet__send', tool_input: { to: 'a/b/c', content: 'fyi 純資訊', fyi: true } };
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('logDecision writes one line with hook, rule, decision, intercepted, at', () => {
  const f = path.join(tmp, 'a.jsonl');
  logDecision({ hook: 'depth0-delegate-gate', rule: 'r', decision: 'warn', intercepted: false }, { path: f });
  const [row] = lines(f);
  assert.deepStrictEqual(Object.keys(row).sort(), ['at', 'decision', 'hook', 'intercepted', 'rule']);
  assert.strictEqual(row.intercepted, false);
  assert.ok(!Number.isNaN(Date.parse(row.at)));
});

test('rejects unregistered hook and bad decision', () => {
  const f = path.join(tmp, 'b.jsonl');
  assert.throws(() => logDecision({ hook: 'nope', rule: 'r', decision: 'allow', intercepted: false }, { path: f }), /not registered/);
  assert.throws(() => logDecision({ hook: 'depth0-delegate-gate', rule: 'r', decision: 'maybe', intercepted: false }, { path: f }), /decision/);
});

test('negative control: unwritable path makes logDecision throw', () => {
  assert.throws(() => logDecision({ hook: 'depth0-delegate-gate', rule: 'r', decision: 'allow', intercepted: false },
    { path: path.join(tmp, 'no-such-dir', 'x.jsonl') }));
});

test('fleet-send-work-order-guard logs block with intercepted=true', () => {
  const f = path.join(tmp, 'fleet.jsonl');
  const r = run('fleet-send-work-order-guard.js', workOrder, f);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /deny/);
  const [row] = lines(f);
  assert.strictEqual(row.hook, 'fleet-send-work-order-guard');
  assert.strictEqual(row.rule, 'send-work-order');
  assert.strictEqual(row.decision, 'block');
  assert.strictEqual(row.intercepted, true);
});

test('fleet-send-work-order-guard logs allow with intercepted=false', () => {
  const f = path.join(tmp, 'fleet-allow.jsonl');
  const r = run('fleet-send-work-order-guard.js', fact, f);
  assert.strictEqual(r.status, 0);
  const [row] = lines(f);
  assert.strictEqual(row.decision, 'allow');
  assert.strictEqual(row.intercepted, false);
});

test('fleet guard exits non-zero when the log path is unwritable (never silent)', () => {
  const r = run('fleet-send-work-order-guard.js', workOrder, path.join(tmp, 'missing', 'x.jsonl'));
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /hook-log: cannot record/);
});

test('default-on: no env at all appends one line under the sandbox HOME state dir', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-default-'));
  const file = path.join(home, '.local', 'state', 'autopilot', 'hook-log.jsonl');
  assert.ok(!fs.existsSync(file));
  const r = run('fleet-send-work-order-guard.js', workOrder, null, home);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /deny/);
  assert.strictEqual(lines(file).length, 1);
  run('fleet-send-work-order-guard.js', fact, null, home);
  assert.strictEqual(lines(file).length, 2);
});

test('default path honours XDG_STATE_HOME', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-xdg-'));
  const xdg = path.join(home, 'xdg');
  const r = spawnSync('node', [path.join(HOOKS, 'fleet-send-work-order-guard.js')], {
    input: JSON.stringify(fact), encoding: 'utf8',
    env: { ...process.env, HOME: home, XDG_STATE_HOME: xdg, AUTOPILOT_HOOK_LOG: '' },
  });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(lines(path.join(xdg, 'autopilot', 'hook-log.jsonl')).length, 1);
});

test('AUTOPILOT_HOOK_LOG=off writes nothing', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-off-'));
  const r = run('fleet-send-work-order-guard.js', workOrder, 'off', home);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(home, '.local')));
});

test('negative control: default path that cannot be created exits non-zero', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'home-ro-'));
  fs.writeFileSync(path.join(home, '.local'), 'a file, so .local/state cannot be created');
  const r = run('fleet-send-work-order-guard.js', workOrder, null, home);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /hook-log: cannot record/);
});

test('depth0 gate logs decisions, and fails loudly on unwritable path', () => {
  const payload = { tool_name: 'Bash', tool_input: { command: 'while true; do :; done' } };
  const f = path.join(tmp, 'd0.jsonl');
  const r = run('depth0-delegate-gate.js', payload, f);
  assert.strictEqual(r.status, 0);
  const rows = lines(f);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((x) => x.hook === 'depth0-delegate-gate' && ['warn', 'block', 'allow'].includes(x.decision)));
  const bad = run('depth0-delegate-gate.js', payload, path.join(tmp, 'missing', 'x.jsonl'));
  assert.notStrictEqual(bad.status, 0);
});
