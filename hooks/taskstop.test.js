/**
 * Tests for mods P1W TASKSTOP: a successful PostToolUse of TaskStop {task_id} ends <live>/agents/<sid>/<task_id>.json
 * (SubagentStop never fires for a stopped background agent; gate run l4g). Never creates a file (a shell task id has no stamp).
 * Run: node --test hooks/taskstop.test.js
 * Host: hooks/audit-log.js (PostToolUse, matcher ".*", no tool_name filter) -> awaiting-owner handle().
 *
 * RED record (before the change): see $P/run-w/land/taskstop-red.txt (the ended/not-ended assertions fail; the no-op cases pass).
 */
'use strict';

const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const AUDIT = path.join(__dirname, 'audit-log.js');
const SID = 'taskstop-session-1';
const dirs = [];
function mk(extra = {}) {
  const live = fs.mkdtempSync(path.join('/dev/shm', 'tst-live-')); fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tst-home-'));
  dirs.push(live, home);
  return { live, env: { ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra } };
}
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });
function run(payload, env) {
  const r = spawnSync('node', [AUDIT], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `exit 0 expected: ${r.stderr}`);
  return r;
}
const post = (over = {}) => ({ session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Read', cwd: os.tmpdir(), tool_input: {}, tool_response: {}, agent_id: 'aaa111', agent_type: 'general-purpose', ...over });
const stopCall = (taskId, over = {}) => ({ session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'TaskStop', cwd: os.tmpdir(), tool_input: { task_id: taskId }, tool_response: {}, ...over });
const adir = (live, sid = SID) => path.join(live, 'agents', sid);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const listing = (live, sid = SID) => (fs.existsSync(adir(live, sid)) ? fs.readdirSync(adir(live, sid)).sort() : []);

test('TaskStop of a stamped agent sets ended_at and keeps the stamp fields', () => {
  const a = mk();
  run(post(), a.env);
  const before = readJ(path.join(adir(a.live), 'aaa111.json'));
  run(stopCall('aaa111'), a.env);
  const j = readJ(path.join(adir(a.live), 'aaa111.json'));
  assert.ok(Number.isFinite(Date.parse(j.ended_at)), 'ended_at is an ISO time');
  assert.strictEqual(j.last_tool_at, before.last_tool_at);
  assert.strictEqual(j.last_tool_name, 'Read');
  assert.strictEqual(j.agent_type, 'general-purpose');
  assert.deepStrictEqual(listing(a.live), ['aaa111.json'], 'no tmp residue');
});

test('TaskStop of an unknown id (a shell task) creates no file', () => {
  const a = mk();
  run(stopCall('be67q70p8'), a.env);
  assert.deepStrictEqual(listing(a.live), []);
  run(post(), a.env);
  run(stopCall('be67q70p8'), a.env);
  assert.deepStrictEqual(listing(a.live), ['aaa111.json'], 'only the real stamp exists');
  assert.strictEqual(readJ(path.join(adir(a.live), 'aaa111.json')).ended_at, undefined, 'a different id ends nothing');
});

test('an already-ended agent keeps its ended_at', () => {
  const a = mk();
  run(post(), a.env);
  run(stopCall('aaa111'), a.env);
  const first = readJ(path.join(adir(a.live), 'aaa111.json')).ended_at;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  run(stopCall('aaa111'), a.env);
  assert.strictEqual(readJ(path.join(adir(a.live), 'aaa111.json')).ended_at, first);
});

test('unsafe or non-string task_id ends nothing and creates nothing', () => {
  const a = mk();
  run(post({ agent_id: '___x' }), a.env); // what sanitize("../x") would collide with
  for (const bad of ['../x', '', 42, null, ['aaa111'], { a: 1 }, 'a'.repeat(65), 'a b']) run(stopCall(bad), a.env);
  assert.deepStrictEqual(listing(a.live), ['___x.json']);
  assert.strictEqual(readJ(path.join(adir(a.live), '___x.json')).ended_at, undefined);
  run({ ...stopCall('aaa111'), tool_input: undefined }, a.env);
  run({ ...stopCall('aaa111'), tool_input: 'x' }, a.env);
  assert.deepStrictEqual(listing(a.live), ['___x.json']);
});

test("another session's agent with the same id is untouched", () => {
  const a = mk();
  run(post({ session_id: 'other-session' }), a.env);
  run(post(), a.env);
  run(stopCall('aaa111'), a.env);
  assert.ok(readJ(path.join(adir(a.live), 'aaa111.json')).ended_at);
  assert.strictEqual(readJ(path.join(adir(a.live, 'other-session'), 'aaa111.json')).ended_at, undefined);
});

test('knob AUTOPILOT_AGENT_ACTIVITY=off: nothing ended', () => {
  const a = mk();
  run(post(), a.env);
  run(stopCall('aaa111'), { ...a.env, AUTOPILOT_AGENT_ACTIVITY: 'off' });
  assert.strictEqual(readJ(path.join(adir(a.live), 'aaa111.json')).ended_at, undefined);
});

test('a later PostToolUse stamp of a TaskStop-ended agent does not resurrect it', () => {
  const a = mk();
  run(post(), a.env);
  run(stopCall('aaa111'), a.env);
  const first = readJ(path.join(adir(a.live), 'aaa111.json')).ended_at;
  run(post({ tool_name: 'Grep' }), a.env);
  const j = readJ(path.join(adir(a.live), 'aaa111.json'));
  assert.strictEqual(j.ended_at, first);
  assert.strictEqual(j.last_tool_name, 'Grep');
});

test('other tools carrying a task_id do not end anything', () => {
  const a = mk();
  run(post(), a.env);
  run(stopCall('aaa111', { tool_name: 'TaskOutput' }), a.env);
  assert.strictEqual(readJ(path.join(adir(a.live), 'aaa111.json')).ended_at, undefined);
});
