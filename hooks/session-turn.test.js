/**
 * Tests for the session turn-state file <live>/turn/<sid>.json — mods P1W TURN (writer hosted in
 * hooks/awaiting-owner.js; UserPromptSubmit reaches it through hooks/advisory-relay.js).
 * Black-box: spawns the real hook scripts against a /dev/shm live dir and a temp HOME (real stores untouched).
 *
 * RED record (before the writer existed, 2026-10-05): see $P/run-w/land/turn-red.txt.
 * Run: node --test hooks/session-turn.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.env.TURN_HOOKS_ROOT || path.join(__dirname, '..');
const ATTN = path.join(ROOT, 'hooks', 'awaiting-owner.js');
const RELAY = path.join(ROOT, 'hooks', 'advisory-relay.js');
const SID = 'turn-sid-0001';

function mkEnv(extra = {}) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  const live = fs.mkdtempSync(path.join(base, 'turn-live-'));
  fs.chmodSync(live, 0o700);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'turn-home-'));
  return {
    live,
    home,
    env: {
      ...process.env, HOME: home, AUTOPILOT_LIVE_DIR: live,
      AUTOPILOT_SESSION_MODE_DIR: path.join(home, 'session-mode'), AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', ...extra,
    },
  };
}
function run(hook, payload, env) {
  const r = spawnSync('node', [hook], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, `hook must exit 0, got ${r.status}: ${r.stderr}`);
  return r;
}
const ev = (name, over = {}) => ({ session_id: SID, hook_event_name: name, cwd: '/nonexistent/turn-cwd', ...over });
const turnFile = (live, sid = SID) => path.join(live, 'turn', `${sid}.json`);
const readJ = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

test('UserPromptSubmit (via the advisory-relay host) writes an active turn with the full shape', () => {
  const { live, env } = mkEnv();
  const before = Date.now();
  run(RELAY, ev('UserPromptSubmit', { prompt: 'go' }), env);
  const t = readJ(turnFile(live));
  assert.strictEqual(t.schema, 'autopilot.session-turn/1');
  assert.strictEqual(t.session_id, SID);
  assert.strictEqual(t.state, 'active');
  assert.ok(Date.parse(t.since) >= before - 1000 && Date.parse(t.since) <= Date.now() + 1000, 'since is now');
  assert.ok(Object.prototype.hasOwnProperty.call(t, 'project_key'));
  assert.ok(Object.prototype.hasOwnProperty.call(t, 'root_run_id'));
  assert.strictEqual(t.project_key, null);
  assert.strictEqual(t.root_run_id, null);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(turnFile(live))), [`${SID}.json`], 'no tmp residue');
});

test('UserPromptSubmit standalone host (awaiting-owner.js) writes the same file', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), env);
  assert.strictEqual(readJ(turnFile(live)).state, 'active');
});

test('root_run_id comes from this session\'s own marker, project_key from the autostart cache', () => {
  const { live, home, env } = mkEnv();
  fs.mkdirSync(path.join(home, 'session-mode'), { recursive: true });
  fs.writeFileSync(path.join(home, 'session-mode', `${SID}.json`), JSON.stringify({ root_run_id: 'root-xyz', project_key: 'aaaabbbbccccdddd', expires_at: new Date(Date.now() + 3600e3).toISOString() }));
  const cwd = '/nonexistent/turn-cwd';
  const h = require('crypto').createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(live, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(live, 'autostart', `${h}.json`), JSON.stringify({ cwd, project_key: '0123456789abcdef' }));
  run(ATTN, ev('UserPromptSubmit', { cwd }), env);
  const t = readJ(turnFile(live));
  assert.strictEqual(t.root_run_id, 'root-xyz');
  assert.strictEqual(t.project_key, '0123456789abcdef');
});

test('Stop sets state ended with a fresh since, keeping the scope fields', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), env);
  const first = readJ(turnFile(live));
  fs.writeFileSync(turnFile(live), JSON.stringify({ ...first, project_key: 'kkkkkkkkkkkkkkkk', root_run_id: 'r1', since: '2020-01-01T00:00:00.000Z' }));
  run(ATTN, ev('Stop'), env);
  const t = readJ(turnFile(live));
  assert.strictEqual(t.state, 'ended');
  assert.ok(Date.parse(t.since) > Date.parse('2021-01-01'), 'since = now');
  assert.strictEqual(t.project_key, 'kkkkkkkkkkkkkkkk');
  assert.strictEqual(t.root_run_id, 'r1');
  assert.strictEqual(t.session_id, SID);
});

test('Stop with no prior turn file still records ended', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('Stop'), env);
  assert.strictEqual(readJ(turnFile(live)).state, 'ended');
});

test('a new UserPromptSubmit after Stop is active again', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), env);
  run(ATTN, ev('Stop'), env);
  run(ATTN, ev('UserPromptSubmit'), env);
  assert.strictEqual(readJ(turnFile(live)).state, 'active');
});

test('SessionEnd removes the file; a missing file is fine', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), env);
  run(ATTN, ev('SessionEnd'), env);
  assert.ok(!fs.existsSync(turnFile(live)));
  run(ATTN, ev('SessionEnd'), env);
});

test('subagent payloads (agent_id) never touch the turn file', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit', { agent_id: 'sub-1' }), env);
  assert.ok(!fs.existsSync(turnFile(live)), 'subagent UPS creates nothing');
  run(ATTN, ev('UserPromptSubmit'), env);
  const before = fs.readFileSync(turnFile(live), 'utf8');
  sleep(15);
  run(ATTN, ev('Stop', { agent_id: 'sub-1' }), env);
  assert.strictEqual(fs.readFileSync(turnFile(live), 'utf8'), before, 'subagent Stop leaves it active');
  run(ATTN, ev('SessionEnd', { agent_id: 'sub-1' }), env);
  assert.strictEqual(fs.readFileSync(turnFile(live), 'utf8'), before, 'subagent SessionEnd leaves it');
});

test('AUTOPILOT_AWAITING_OWNER=off writes nothing and removes nothing', () => {
  const { live, env } = mkEnv({ AUTOPILOT_AWAITING_OWNER: 'off' });
  run(ATTN, ev('UserPromptSubmit'), env);
  run(RELAY, ev('UserPromptSubmit'), env);
  assert.ok(!fs.existsSync(path.join(live, 'turn')), 'no turn dir');
  const e2 = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), e2.env);
  const pre = fs.readFileSync(turnFile(e2.live), 'utf8');
  run(ATTN, ev('Stop'), { ...e2.env, AUTOPILOT_AWAITING_OWNER: 'off' });
  run(ATTN, ev('SessionEnd'), { ...e2.env, AUTOPILOT_AWAITING_OWNER: 'off' });
  assert.strictEqual(fs.readFileSync(turnFile(e2.live), 'utf8'), pre);
});

test('no session_id / garbage stdin: nothing written, exit 0', () => {
  const { live, env } = mkEnv();
  run(ATTN, { hook_event_name: 'UserPromptSubmit' }, env);
  const r = spawnSync('node', [ATTN], { input: 'not json', encoding: 'utf8', env });
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(live, 'turn')));
});

test('turn and attention are independent: Stop ends attention AND marks the turn ended; another session is untouched', () => {
  const { live, env } = mkEnv();
  run(ATTN, ev('UserPromptSubmit'), env);
  run(ATTN, ev('UserPromptSubmit', { session_id: 'other-sid' }), env);
  run(ATTN, ev('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'ls' } }), env);
  assert.ok(fs.existsSync(path.join(live, 'attention', `${SID}.json`)));
  assert.strictEqual(readJ(turnFile(live)).state, 'active', 'a permission request does not end the turn');
  run(ATTN, ev('Stop'), env);
  assert.ok(!fs.existsSync(path.join(live, 'attention', `${SID}.json`)));
  assert.strictEqual(readJ(turnFile(live)).state, 'ended');
  assert.strictEqual(readJ(turnFile(live, 'other-sid')).state, 'active');
});

test('hooks.json keeps awaiting-owner on UserPromptSubmit-host / Stop / SessionEnd (no new hook entry for the turn file)', () => {
  const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const has = (e) => JSON.stringify(h[e] || []).includes('hooks/awaiting-owner.js');
  assert.ok(has('Stop') && has('SessionEnd'));
  assert.ok(JSON.stringify(h.UserPromptSubmit).includes('hooks/advisory-relay.js'));
  assert.ok(!JSON.stringify(h).includes('session-turn'), 'no separate turn hook');
});
