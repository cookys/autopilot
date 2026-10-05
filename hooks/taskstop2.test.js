/**
 * Tests for mods P1W TASKSTOP2: a successful PostToolUse of TaskStop {task_id} also removes every attention pending[] entry whose
 * agent_id equals task_id (the killed tool never reaches PostToolUse and TaskStop fires no SubagentStop; gate run l4h).
 * Run: node --test hooks/taskstop2.test.js
 * Host: hooks/audit-log.js (PostToolUse) -> awaiting-owner handle(); seeding via awaiting-owner.js PermissionRequest.
 *
 * RED record (before the change): $P/run-w/land/taskstop2-red.txt (4 pass / 3 fail: entries removal, last-entry file removal, AGENT_ACTIVITY-off independence).
 */
'use strict';

const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ATTN = path.join(__dirname, 'awaiting-owner.js');
const AUDIT = path.join(__dirname, 'audit-log.js');
const SID = 'taskstop2-session-1';
const dirs = [];
function mk(extra = {}) {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'ts2-live-')); fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ts2-home-'));
  dirs.push(live, home);
  return { live, env: { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra } };
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
function send(script, a, payload, env) {
  const r = spawnSync('node', [script], { input: JSON.stringify({ session_id: SID, cwd: os.tmpdir(), ...payload }), encoding: 'utf8', env: env || a.env });
  assert.strictEqual(r.status, 0, `exit 0 expected: ${r.stderr}`);
}
const perm = (agent, tool, input) => ({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input, ...(agent ? { agent_id: agent } : {}) });
const stop = (taskId) => ({ hook_event_name: 'PostToolUse', tool_name: 'TaskStop', tool_input: { task_id: taskId }, tool_response: {} });
const file = (a) => path.join(a.live, 'attention', `${SID}.json`);
const read = (a) => (fs.existsSync(file(a)) ? JSON.parse(fs.readFileSync(file(a), 'utf8')) : null);
const ids = (j) => j.pending.map((e) => `${e.agent_id}|${e.tool_name}`);
function seed(a) {
  send(ATTN, a, perm('aaa111', 'Bash', { command: 'gate-wait.sh' }));
  send(ATTN, a, perm('aaa111', 'Edit', { file_path: '/x' }));
  send(ATTN, a, perm('bbb222', 'Bash', { command: 'ls' }));
  send(ATTN, a, perm(null, 'Write', { file_path: '/y' }));
}

test('TaskStop removes that agent\'s entries and leaves another agent\'s and the main thread\'s', () => {
  const a = mk();
  seed(a);
  assert.strictEqual(read(a).pending.length, 4);
  send(AUDIT, a, stop('aaa111'));
  const j = read(a);
  assert.deepStrictEqual(ids(j).sort(), ['bbb222|Bash', 'null|Write']);
  assert.ok(j.pending.every((e) => e.agent_id !== 'aaa111'));
  assert.ok(['bbb222', null].includes(j.pending.find((e) => e.tool_name === j.tool_name).agent_id), 'top-level recomputed from survivors');
});

test('TaskStop of a shell id leaves everything', () => {
  const a = mk();
  seed(a);
  send(AUDIT, a, stop('be67q70p8'));
  assert.strictEqual(read(a).pending.length, 4);
});

test('removing the last entry removes the file; works with no stamp file for the id', () => {
  const a = mk();
  send(ATTN, a, perm('aaa111', 'Bash', { command: 'x' }));
  assert.ok(read(a));
  assert.ok(!fs.existsSync(path.join(a.live, 'agents', SID, 'aaa111.json')), 'no stamp exists');
  send(AUDIT, a, stop('aaa111'));
  assert.strictEqual(read(a), null);
});

test('unsafe or non-string task_id removes nothing', () => {
  const a = mk();
  send(ATTN, a, perm('../x', 'Bash', { command: 'x' }));
  send(ATTN, a, perm('aaa111', 'Bash', { command: 'y' }));
  for (const bad of ['../x', '', 42, null, ['aaa111'], 'a b', 'a'.repeat(65)]) send(AUDIT, a, stop(bad));
  assert.strictEqual(read(a).pending.length, 2);
});

test('other tools carrying a task_id remove nothing', () => {
  const a = mk();
  seed(a);
  send(AUDIT, a, { ...stop('aaa111'), tool_name: 'TaskOutput' });
  assert.strictEqual(read(a).pending.length, 4);
});

test('knob AUTOPILOT_AWAITING_OWNER=off: untouched', () => {
  const a = mk();
  seed(a);
  send(AUDIT, a, stop('aaa111'), { ...a.env, AUTOPILOT_AWAITING_OWNER: 'off' });
  assert.strictEqual(read(a).pending.length, 4);
});

test('knob AUTOPILOT_AGENT_ACTIVITY=off does not block the attention removal', () => {
  const a = mk();
  seed(a);
  send(AUDIT, a, stop('aaa111'), { ...a.env, AUTOPILOT_AGENT_ACTIVITY: 'off' });
  assert.strictEqual(read(a).pending.length, 2);
});
