/**
 * Tests for mods P1W FOREMAN2 commit 2: <live>/attention/<sid>.json keeps ONE ENTRY PER PENDING DIALOG (additive field `pending`), so a
 * subagent's dialog survives the main thread's Stop and another agent's same-tool PostToolUse (gate run l4f-done-b2).
 * Run: node --test hooks/attention-pending.test.js
 *
 * Source: Claude Code 2.1.289 builds the base hook input of every event (PermissionRequest and PostToolUse included) with
 * `agent_id: toolUseContext?.agentId` (grep -ao `permission_mode:r,agent_id:s?.agentId`), so a PermissionRequest raised inside a subagent
 * carries agent_id like its PostToolUse does; no `turn`-based fallback is used.
 *
 * RED record (before the change): $P/run-w/land/foreman3-red-attention.txt (1 pass, 9 fail).
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
const SID = 'attn-pending-sess-1';
const dirs = [];
function mk(extra = {}) {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'apend-live-')); fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'apend-home-'));
  dirs.push(live, home);
  return { live, env: { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra } };
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
function send(a, payload) {
  const r = spawnSync('node', [ATTN], { input: JSON.stringify({ session_id: SID, cwd: os.tmpdir(), ...payload }), encoding: 'utf8', env: a.env });
  assert.strictEqual(r.status, 0, `exit 0 expected: ${r.stderr}`);
}
const file = (a) => path.join(a.live, 'attention', `${SID}.json`);
const read = (a) => (fs.existsSync(file(a)) ? JSON.parse(fs.readFileSync(file(a), 'utf8')) : null);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const perm = (agent, tool, input, extra) => ({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: input, ...(agent ? { agent_id: agent } : {}), ...extra });
const post = (agent, tool, input) => ({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: input, tool_response: {}, ...(agent ? { agent_id: agent } : {}) });
const ev = (name, extra) => ({ hook_event_name: name, ...extra });
const ids = (j) => j.pending.map((e) => `${e.agent_id}|${e.tool_name}`);

test('PermissionRequest writes a pending entry and keeps the top-level fields (compat shape)', () => {
  const a = mk();
  send(a, perm(null, 'Bash', { command: 'ls' }));
  const j = read(a);
  assert.strictEqual(j.schema, 'autopilot.attention/1');
  assert.strictEqual(j.kind, 'permission');
  assert.strictEqual(j.tool_name, 'Bash');
  assert.strictEqual(j.summary, 'Bash: ls');
  assert.strictEqual(j.pending.length, 1);
  const e = j.pending[0];
  assert.strictEqual(e.agent_id, null);
  assert.strictEqual(e.tool_name, 'Bash');
  assert.match(e.input_digest, /^[0-9a-f]{16}$/);
  assert.strictEqual(e.kind, 'permission');
  assert.strictEqual(e.summary, 'Bash: ls');
  assert.strictEqual(e.since, j.since);
});

test('the same dialog again refreshes updated_at and keeps since / one entry; a subagent dialog is a second entry', () => {
  const a = mk();
  send(a, perm(null, 'Bash', { command: 'ls' }));
  const first = read(a);
  sleep(30);
  send(a, perm(null, 'Bash', { command: 'ls' }));
  const again = read(a);
  assert.strictEqual(again.pending.length, 1);
  assert.strictEqual(again.pending[0].since, first.pending[0].since);
  assert.ok(Date.parse(again.updated_at) > Date.parse(first.updated_at));
  send(a, perm('ag1', 'Bash', { command: 'ls' }));
  assert.deepStrictEqual(ids(read(a)), ['null|Bash', 'ag1|Bash'], 'same tool + same input of another agent is its own entry');
});

test('two agents with the same tool_name: one agent PostToolUse leaves the other agent entry', () => {
  const a = mk();
  send(a, perm('ag1', 'Bash', { command: 'a' }));
  sleep(5);
  send(a, perm('ag2', 'Bash', { command: 'b' }));
  send(a, post('ag2', 'Bash', { command: 'b' }));
  assert.deepStrictEqual(ids(read(a)), ['ag1|Bash']);
  send(a, post(null, 'Bash', { command: 'a' })); // main thread's own PostToolUse is not ag1's
  assert.deepStrictEqual(ids(read(a)), ['ag1|Bash']);
  send(a, post('ag1', 'Bash', { command: 'a' }));
  assert.strictEqual(read(a), null, 'file removed when nothing is pending');
});

test('main Stop and UserPromptSubmit remove only main-thread entries (and idle); a subagent entry survives', () => {
  for (const name of ['Stop', 'UserPromptSubmit']) {
    const a = mk();
    send(a, perm(null, 'Edit', { file_path: '/x' }));
    send(a, perm('ag1', 'Bash', { command: 'rm x' }));
    send(a, ev(name, {}));
    const j = read(a);
    assert.deepStrictEqual(ids(j), ['ag1|Bash'], name);
    assert.strictEqual(j.tool_name, 'Bash', 'top-level follows the remaining entry');
    assert.strictEqual(j.kind, 'permission');
  }
  const b = mk();
  send(b, perm('ag1', 'Bash', { command: 'x' }));
  send(b, ev('Notification', { notification_type: 'permission_prompt' }));
  send(b, ev('SessionEnd', {}));
  assert.strictEqual(read(b), null, 'SessionEnd removes all');
});

test('SubagentStop(agent_id) clears only that agent entries; a SubagentStop of an unknown agent changes nothing', () => {
  const a = mk();
  send(a, perm(null, 'Edit', { file_path: '/x' }));
  send(a, perm('ag1', 'Bash', { command: '1' }));
  send(a, perm('ag2', 'Bash', { command: '2' }));
  send(a, ev('SubagentStop', { agent_id: 'ag1', agent_type: 'general-purpose', stop_hook_active: false }));
  assert.deepStrictEqual(ids(read(a)), ['null|Edit', 'ag2|Bash']);
  send(a, ev('SubagentStop', { agent_id: 'nope', stop_hook_active: false }));
  assert.deepStrictEqual(ids(read(a)), ['null|Edit', 'ag2|Bash']);
  send(a, ev('SubagentStop', { agent_id: 'ag2', stop_hook_active: false }));
  assert.deepStrictEqual(ids(read(a)), ['null|Edit']);
  const b = mk({ AUTOPILOT_AWAITING_OWNER: 'off' });
  send(b, ev('SubagentStop', { agent_id: 'ag1' }));
  assert.ok(!fs.existsSync(file(b)));
});

test('an amended input (Tab-to-amend) falls back to the OLDEST same-(agent, tool) entry, never another agent', () => {
  const a = mk();
  send(a, perm('ag1', 'Bash', { command: 'first' }));
  sleep(5);
  send(a, perm('ag1', 'Bash', { command: 'second' }));
  sleep(5);
  send(a, perm('ag2', 'Bash', { command: 'other' }));
  send(a, post('ag1', 'Bash', { command: 'first --amended' }));
  const j = read(a);
  assert.deepStrictEqual(j.pending.map((e) => `${e.agent_id}|${e.summary}`), ['ag1|Bash: second', 'ag2|Bash: other']);
  send(a, post('ag3', 'Bash', { command: 'zzz' }));
  assert.strictEqual(read(a).pending.length, 2, 'an agent with no entry removes nothing');
});

test('top-level kind/tool_name/summary/since = the OLDEST permission/question entry; idle only when none exists', () => {
  const a = mk();
  send(a, ev('Notification', { notification_type: 'idle_prompt' }));
  assert.strictEqual(read(a).kind, 'idle');
  send(a, perm('ag1', 'AskUserQuestion', { questions: [{ question: 'Which?' }] }));
  sleep(5);
  send(a, perm(null, 'Bash', { command: 'ls' }));
  const j = read(a);
  assert.strictEqual(j.kind, 'question');
  assert.strictEqual(j.tool_name, 'AskUserQuestion');
  assert.strictEqual(j.summary, 'Which?');
  assert.strictEqual(j.since, j.pending.find((e) => e.agent_id === 'ag1').since);
  assert.ok(!j.pending.some((e) => e.kind === 'idle'), 'a real prompt replaces idle');
  send(a, ev('Notification', { notification_type: 'idle_prompt' }));
  assert.strictEqual(read(a).kind, 'question', 'idle never overrides');
  send(a, post('ag1', 'AskUserQuestion', { questions: [{ question: 'Which?' }] }));
  assert.strictEqual(read(a).kind, 'permission');
  assert.strictEqual(read(a).tool_name, 'Bash');
});

test('Notification permission_prompt heartbeats an existing file only; it never creates one', () => {
  const a = mk();
  send(a, ev('Notification', { notification_type: 'permission_prompt' }));
  assert.strictEqual(read(a), null);
  send(a, perm('ag1', 'Bash', { command: 'ls' }));
  const t0 = read(a).updated_at;
  sleep(30);
  send(a, ev('Notification', { notification_type: 'permission_prompt' }));
  assert.ok(Date.parse(read(a).updated_at) > Date.parse(t0));
  assert.strictEqual(read(a).pending.length, 1);
});

test('an old-shape file (no pending) is read as one main-thread entry and upgraded in place', () => {
  const a = mk();
  fs.mkdirSync(path.dirname(file(a)), { recursive: true });
  const since = new Date(Date.now() - 60000).toISOString();
  fs.writeFileSync(file(a), JSON.stringify({ schema: 'autopilot.attention/1', session_id: SID, project_key: null, kind: 'permission', tool_name: 'Bash', summary: 'Bash: old', since, updated_at: since }));
  send(a, perm('ag1', 'Edit', { file_path: '/y' }));
  const j = read(a);
  assert.deepStrictEqual(ids(j), ['null|Bash', 'ag1|Edit']);
  assert.strictEqual(j.pending[0].since, since);
  assert.strictEqual(j.pending[0].summary, 'Bash: old');
  assert.strictEqual(j.since, since, 'top-level = the oldest entry');
  // and an old-shape file ends through the main thread's PostToolUse of the same tool (digest unknown -> oldest same (agent, tool))
  const b = mk();
  fs.mkdirSync(path.dirname(file(b)), { recursive: true });
  fs.writeFileSync(file(b), JSON.stringify({ schema: 'autopilot.attention/1', session_id: SID, project_key: null, kind: 'permission', tool_name: 'Bash', summary: 'Bash: old', since, updated_at: since }));
  send(b, post(null, 'Bash', { command: 'old' }));
  assert.strictEqual(read(b), null);
});

test('knob AUTOPILOT_AWAITING_OWNER=off writes nothing', () => {
  const a = mk({ AUTOPILOT_AWAITING_OWNER: 'off' });
  send(a, perm('ag1', 'Bash', { command: 'ls' }));
  assert.ok(!fs.existsSync(path.join(a.live, 'attention')));
});
