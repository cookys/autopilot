/**
 * cfgfix: the band's "enabled" for a live-state writer follows the writer's REAL off switch.
 * A config.json entry the writer never reads ({"<ENV>":"off"}, {"hooks":{"<stem>":false}}) must not flip it to off.
 * Run: node --test hooks/sources-manifest-knobs.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSourcesManifest } = require('../src/status/sources-manifest.js');

const ROOT = path.join(__dirname, '..');
const made = [];
process.on('exit', () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function manifest(config, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'srcman-'));
  made.push(home);
  if (config !== undefined) fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  return buildSourcesManifest({ pluginRoot: ROOT, env, autopilotHome: home, scope: {} }).sources;
}
const on = (s, k) => `${s[k].installed}/${s[k].enabled}`;

test('config entries the hooks never read do not turn a source off', () => {
  const s = manifest({
    AUTOPILOT_SESSION_TASKS: 'off', AUTOPILOT_AWAITING_OWNER: false, AUTOPILOT_TASK_STATUS_INPUT: 'off',
    hooks: { 'session-tasks': false, 'awaiting-owner': false, 'context-budget': false },
  });
  assert.strictEqual(on(s, 'tasks'), 'true/true');
  assert.strictEqual(on(s, 'attention'), 'true/true');
  assert.strictEqual(on(s, 'turn'), 'true/true');
  assert.strictEqual(on(s, 'task_status_input'), 'true/true');
  assert.strictEqual(on(s, 'context'), 'true/true');
});

test('the real switches still turn a source off (negative control for the test above)', () => {
  assert.strictEqual(on(manifest({}, { AUTOPILOT_SESSION_TASKS: 'Off' }), 'tasks'), 'true/false');
  assert.strictEqual(on(manifest({}, { AUTOPILOT_AWAITING_OWNER: 'no' }), 'attention'), 'true/false');
  assert.strictEqual(on(manifest({}, { AUTOPILOT_TASK_STATUS_INPUT: '0' }), 'task_status_input'), 'true/false');
  assert.strictEqual(on(manifest({ context_budget: { live_write: false } }), 'context'), 'true/false');
  assert.strictEqual(on(manifest({ context_budget: { mode: 'off' } }), 'context'), 'true/false');
  assert.strictEqual(on(manifest({}, { AUTOPILOT_CONTEXT_BUDGET_MODE: 'off' }), 'context'), 'true/false');
  assert.strictEqual(on(manifest({}, { AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE: 'off' }), 'context'), 'true/false');
  // the engine only honours exactly '0'
  assert.strictEqual(on(manifest({}, { AUTOPILOT_TASK_STATUS_INPUT: 'off' }), 'task_status_input'), 'true/true');
});
