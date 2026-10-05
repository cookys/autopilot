/**
 * Tests for mods P1W FOREMAN end signal: a SubagentStop payload marks <live>/agents/<sid>/<agent_id>.json `ended_at`.
 * Run: node --test hooks/subagent-stop.test.js
 *
 * Source of the event (Claude Code 2.1.289 types shipped with the plugin-authoring skill, claude-code.d.ts):
 *   type SubagentStopHookInput = BaseHookInput & { hook_event_name: 'SubagentStop'; stop_hook_active: boolean; agent_id: string;
 *     agent_transcript_path: string; agent_type: string; last_assistant_message?: string; ... }   (BaseHookInput: session_id, transcript_path, cwd, ...)
 * The payloads below replay that shape. Host: hooks/awaiting-owner.js (already wired for 6 other events) gets one more hooks.json
 * entry, so no new hook stem / count. Black-box on /dev/shm live dirs and a temp HOME.
 *
 * RED record (before the change): see $P/run-w/land/foreman-red.txt.
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
const SID = 'sub-stop-session-1';
const dirs = [];
function mk(extra = {}) {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'sst-live-')); fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sst-home-'));
  dirs.push(live, home);
  return { live, env: { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra } };
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
function run(script, payload, env) {
  const r = spawnSync('node', [script], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit 0 expected: ${r.stderr}`);
  return r;
}
const stop = (over = {}) => ({
  session_id: SID, transcript_path: '/x/t.jsonl', cwd: os.tmpdir(), hook_event_name: 'SubagentStop', stop_hook_active: false,
  agent_id: 'agent-f1', agent_transcript_path: '/x/agent.jsonl', agent_type: 'general-purpose', last_assistant_message: 'done', ...over,
});
const post = (over = {}) => ({ session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', cwd: os.tmpdir(), tool_input: { command: 'ls' }, tool_response: {}, agent_id: 'agent-f1', agent_type: 'general-purpose', ...over });
const adir = (live) => path.join(live, 'agents', SID);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('wiring: hooks.json has a SubagentStop entry hosted by awaiting-owner.js (no new hook file)', () => {
  const g = HOOKS.SubagentStop;
  assert.ok(Array.isArray(g) && g.length === 1, 'one SubagentStop group');
  assert.deepStrictEqual(g[0].hooks.map((h) => h.command), ['node ${CLAUDE_PLUGIN_ROOT}/hooks/awaiting-owner.js']);
});

test('SubagentStop after tool calls: the stamp keeps its fields and gains ended_at', () => {
  const a = mk();
  run(AUDIT, post({ tool_name: 'Grep' }), a.env);
  const before = readJ(path.join(adir(a.live), 'agent-f1.json'));
  assert.strictEqual(before.ended_at, undefined);
  run(ATTN, stop(), a.env);
  const j = readJ(path.join(adir(a.live), 'agent-f1.json'));
  assert.strictEqual(j.schema, 'autopilot.agent-activity/1');
  assert.strictEqual(j.last_tool_at, before.last_tool_at, 'last_tool_at is not moved by the stop');
  assert.strictEqual(j.last_tool_name, 'Grep');
  assert.strictEqual(j.agent_type, 'general-purpose');
  assert.ok(Number.isFinite(Date.parse(j.ended_at)), 'ended_at is an ISO time');
  assert.deepStrictEqual(fs.readdirSync(adir(a.live)), ['agent-f1.json'], 'no tmp residue');
});

test('SubagentStop for an agent that never made a tool call creates the file with ended_at', () => {
  const a = mk();
  run(ATTN, stop({ agent_id: 'agent-quiet' }), a.env);
  const j = readJ(path.join(adir(a.live), 'agent-quiet.json'));
  assert.strictEqual(j.agent_id, 'agent-quiet');
  assert.strictEqual(j.session_id, SID);
  assert.ok(Date.parse(j.ended_at) > 0 && Date.parse(j.last_tool_at) > 0);
});

test('a late PostToolUse stamp never resurrects an ended agent; a second stop does not move ended_at', () => {
  const a = mk();
  run(ATTN, stop(), a.env);
  const first = readJ(path.join(adir(a.live), 'agent-f1.json')).ended_at;
  run(AUDIT, post({ tool_name: 'Read' }), a.env);
  const j = readJ(path.join(adir(a.live), 'agent-f1.json'));
  assert.strictEqual(j.ended_at, first, 'the stamp keeps ended_at');
  assert.strictEqual(j.last_tool_name, 'Read', 'the stamp still refreshes the tool fields');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  run(ATTN, stop(), a.env);
  assert.strictEqual(readJ(path.join(adir(a.live), 'agent-f1.json')).ended_at, first);
});

test('other agents and other sessions are untouched', () => {
  const a = mk();
  run(AUDIT, post({ agent_id: 'agent-f2' }), a.env);
  run(AUDIT, post({ agent_id: 'agent-f1', session_id: 'other-session-2' }), a.env);
  run(ATTN, stop(), a.env);
  assert.strictEqual(readJ(path.join(adir(a.live), 'agent-f2.json')).ended_at, undefined);
  assert.strictEqual(readJ(path.join(a.live, 'agents', 'other-session-2', 'agent-f1.json')).ended_at, undefined);
});

test('no agent_id or no session_id -> no write; knob AUTOPILOT_AGENT_ACTIVITY=off -> no write', () => {
  const a = mk();
  run(ATTN, stop({ agent_id: undefined }), a.env);
  run(ATTN, stop({ agent_id: '' }), a.env);
  run(ATTN, stop({ session_id: undefined }), a.env);
  assert.ok(!fs.existsSync(path.join(a.live, 'agents')));
  const b = mk({ AUTOPILOT_AGENT_ACTIVITY: 'off' });
  run(ATTN, stop(), b.env);
  assert.ok(!fs.existsSync(path.join(b.live, 'agents')));
});

test('a subagent stop does not touch the main thread: turn file and attention file stay as they were', () => {
  const a = mk();
  fs.mkdirSync(path.join(a.live, 'turn'), { recursive: true });
  fs.mkdirSync(path.join(a.live, 'attention'), { recursive: true });
  const turn = JSON.stringify({ schema: 'autopilot.session-turn/1', session_id: SID, state: 'active', since: new Date().toISOString(), project_key: null, root_run_id: null });
  const attn = JSON.stringify({ schema: 'autopilot.attention/1', session_id: SID, project_key: null, kind: 'permission', tool_name: 'Bash', summary: 'Bash: ls', since: new Date().toISOString(), updated_at: new Date().toISOString() });
  fs.writeFileSync(path.join(a.live, 'turn', `${SID}.json`), turn);
  fs.writeFileSync(path.join(a.live, 'attention', `${SID}.json`), attn);
  run(ATTN, stop(), a.env);
  assert.strictEqual(fs.readFileSync(path.join(a.live, 'turn', `${SID}.json`), 'utf8'), turn);
  assert.strictEqual(fs.readFileSync(path.join(a.live, 'attention', `${SID}.json`), 'utf8'), attn);
});

test('SessionEnd still removes the whole agents/<sid> dir (ended files included)', () => {
  const a = mk();
  run(ATTN, stop(), a.env);
  run(ATTN, { session_id: SID, hook_event_name: 'SessionEnd', cwd: os.tmpdir() }, a.env);
  assert.ok(!fs.existsSync(adir(a.live)));
});
