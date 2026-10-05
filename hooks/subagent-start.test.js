/**
 * Tests for mods P1W FOREMAN2 start signal: a SubagentStart payload writes <live>/agents/<sid>/<agent_id>.json (last_tool_at = now,
 * last_tool_name null, agent_type, no ended_at) so a foreman whose first tool call runs for minutes is visible from its start.
 * Run: node --test hooks/subagent-start.test.js
 *
 * Source (Claude Code 2.1.289 binary, grep -ao): `hook_event_name:R("SubagentStart"),agent_id:o(),agent_type:o()` on top of the base
 * hook input (session_id, transcript_path, cwd, ...). Host: hooks/awaiting-owner.js (one more hooks.json entry, no new stem).
 *
 * RED record (before the change): $P/run-w/land/foreman3-red-start.txt (2 pass, 4 fail: no SubagentStart handler or wiring).
 */
'use strict';

const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');
const AUDIT = path.join(ROOT, 'hooks', 'audit-log.js');
const HOOKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
const SID = 'sub-start-session-1';
const dirs = [];
function mk(extra = {}) {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'sstart-live-')); fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sstart-home-'));
  dirs.push(live, home);
  return { live, env: { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra } };
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
function run(script, payload, env) {
  const r = spawnSync('node', [script], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit 0 expected: ${r.stderr}`);
  return r;
}
const start = (over = {}) => ({ session_id: SID, transcript_path: '/x/t.jsonl', cwd: os.tmpdir(), hook_event_name: 'SubagentStart', agent_id: 'agent-f1', agent_type: 'general-purpose', ...over });
const stop = (over = {}) => ({ session_id: SID, cwd: os.tmpdir(), hook_event_name: 'SubagentStop', stop_hook_active: false, agent_id: 'agent-f1', agent_type: 'general-purpose', ...over });
const post = (over = {}) => ({ session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: 'ls' }, tool_response: {}, agent_id: 'agent-f1', agent_type: 'general-purpose', ...over });
const adir = (live) => path.join(live, 'agents', SID);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('wiring: hooks.json has a SubagentStart entry hosted by awaiting-owner.js (no new hook file)', () => {
  const g = HOOKS.SubagentStart;
  assert.ok(Array.isArray(g) && g.length === 1, 'one SubagentStart group');
  assert.deepStrictEqual(g[0].hooks.map((h) => h.command), ['node ${CLAUDE_PLUGIN_ROOT}/hooks/awaiting-owner.js']);
});

test('SubagentStart creates the stamp: last_tool_at now, last_tool_name null, agent_type, no ended_at', () => {
  const a = mk();
  const t0 = Date.now();
  run(ATTN, start(), a.env);
  const j = readJ(path.join(adir(a.live), 'agent-f1.json'));
  assert.strictEqual(j.schema, 'autopilot.agent-activity/1');
  assert.strictEqual(j.session_id, SID);
  assert.strictEqual(j.agent_id, 'agent-f1');
  assert.strictEqual(j.agent_type, 'general-purpose');
  assert.strictEqual(j.last_tool_name, null);
  assert.ok(Date.parse(j.last_tool_at) >= t0 - 1000 && Date.parse(j.last_tool_at) <= Date.now() + 1000);
  assert.strictEqual('ended_at' in j, false);
  assert.deepStrictEqual(fs.readdirSync(adir(a.live)), ['agent-f1.json'], 'no tmp residue');
});

test('SubagentStart clears a prior ended_at (the one legitimate resurrection); a later PostToolUse then keeps it cleared', () => {
  const a = mk();
  run(ATTN, stop(), a.env);
  assert.ok(readJ(path.join(adir(a.live), 'agent-f1.json')).ended_at);
  run(ATTN, start(), a.env);
  assert.strictEqual('ended_at' in readJ(path.join(adir(a.live), 'agent-f1.json')), false);
  run(AUDIT, post({ tool_name: 'Read' }), a.env);
  const j = readJ(path.join(adir(a.live), 'agent-f1.json'));
  assert.strictEqual(j.last_tool_name, 'Read');
  assert.strictEqual('ended_at' in j, false);
});

test('a late PostToolUse stamp still never resurrects an ended agent (existing rule, SubagentStart is the only path)', () => {
  const a = mk();
  run(ATTN, stop(), a.env);
  run(AUDIT, post(), a.env);
  assert.ok(readJ(path.join(adir(a.live), 'agent-f1.json')).ended_at);
});

test('SubagentStart does not touch the attention or turn files', () => {
  const a = mk();
  run(ATTN, start(), a.env);
  assert.ok(!fs.existsSync(path.join(a.live, 'attention')));
  assert.ok(!fs.existsSync(path.join(a.live, 'turn')));
});

test('no agent_id or no session_id -> no write; knob AUTOPILOT_AGENT_ACTIVITY=off -> no write', () => {
  const a = mk();
  run(ATTN, start({ agent_id: undefined }), a.env);
  run(ATTN, start({ agent_id: '' }), a.env);
  run(ATTN, start({ session_id: undefined }), a.env);
  assert.ok(!fs.existsSync(path.join(a.live, 'agents')));
  const b = mk({ AUTOPILOT_AGENT_ACTIVITY: 'off' });
  run(ATTN, start(), b.env);
  assert.ok(!fs.existsSync(path.join(b.live, 'agents')));
});
