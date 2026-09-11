/**
 * Tests for run-approval-gate.js (PreToolUse|PostToolUse Task|Agent, wired default-on,
 * INERT until run_approval.mode=ask-once). Black-box: spawns the real hook.
 *
 * The property under test is "asked exactly once per run": PreToolUse asks and records a
 * `pending`, PostToolUse promotes it to `approved`, and every later dispatch in that run is
 * silent. A test that only checked the ask would pass against a hook that asks forever; a
 * test that only checked the receipt would pass against one that mints approval from a
 * PostToolUse it never asked for (the knob-flip case below).
 *
 * Run: node --test hooks/run-approval-gate.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'run-approval-gate.js');
const SID = 'run-approval-test-session';

function freshEnv(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'runappr-home-'));
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  const live = fs.mkdtempSync(path.join(base, 'runappr-live-'));
  return {
    HOME: home,
    CLAUDE_SESSION_ID: SID,
    AUTOPILOT_SESSION_ID: SID,
    AUTOPILOT_SESSION_MODE_DIR: path.join(home, 'session-mode'),
    AUTOPILOT_RUN_APPROVAL_DIR: path.join(live, 'run-approval'),
    // Do not inherit a real developer machine's knob into the fixture.
    AUTOPILOT_RUN_APPROVAL_MODE: '',
    ...extra,
  };
}

function writeMarker(env, { level = 'l5', startedAt = '2026-09-08T00:00:00.000Z', ttlMs = 3600_000 } = {}) {
  fs.mkdirSync(env.AUTOPILOT_SESSION_MODE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(env.AUTOPILOT_SESSION_MODE_DIR, `${SID}.json`),
    JSON.stringify({
      session_id: SID,
      level,
      repo_root: '/tmp/repo',
      started_at: startedAt,
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    }),
  );
}

function run(event, payloadObj, env) {
  return spawnSync('node', [HOOK, event], {
    input: JSON.stringify(payloadObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function payload(tool = 'Task', extra = {}) {
  return { tool_name: tool, session_id: SID, tool_input: {}, ...extra };
}

const asks = (r) => /"permissionDecision":"ask"/.test(r.stdout || '');

test('default (no knob) is inert even on a live run', () => {
  const env = freshEnv();
  writeMarker(env);
  const r = run('PreToolUse', payload(), env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'unconfigured gate must emit nothing');
});

test('unrecognised mode falls back to inert, never to gating', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'yolo' });
  writeMarker(env);
  assert.ok(!asks(run('PreToolUse', payload(), env)), 'garbage mode must not start gating');
});

test('ask-once + live run + depth-0 Task asks', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  const r = run('PreToolUse', payload(), env);
  assert.equal(r.status, 0);
  assert.ok(asks(r), 'first dispatch of a run must ask');
  assert.match(r.stdout, /THE WHOLE RUN/, 'the reason must say what approval covers');
  assert.match(r.stdout, /red lines/, 'the reason must name what still stops the run');
});

test('Agent is gated the same as Task', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  assert.ok(asks(run('PreToolUse', payload('Agent'), env)));
});

test('a subagent fire is never asked (agent_id present)', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  assert.ok(!asks(run('PreToolUse', payload('Task', { agent_id: 'a1' }), env)), 'depth-1+ must be inert');
  // Presence, not truthiness — an empty agent_id still marks a subagent.
  assert.ok(!asks(run('PreToolUse', payload('Task', { agent_id: '' }), env)), 'empty agent_id is still a subagent');
});

test('no marker / expired marker / non-run level are all inert', () => {
  const noMarker = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  assert.ok(!asks(run('PreToolUse', payload(), noMarker)), 'a plain session is not a run');

  const expired = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(expired, { ttlMs: -1000 });
  assert.ok(!asks(run('PreToolUse', payload(), expired)), 'expired marker ⇒ inert (fail-open)');

  const wrongLevel = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(wrongLevel, { level: 'l2' });
  assert.ok(!asks(run('PreToolUse', payload(), wrongLevel)), 'a non-front-door level is not a run');
});

test('a tool outside Task|Agent is inert', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  assert.ok(!asks(run('PreToolUse', payload('Bash'), env)));
});

test('asked ONCE: the PostToolUse receipt silences the rest of the run', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);

  assert.ok(asks(run('PreToolUse', payload(), env)), 'first dispatch asks');
  // The ask left a pending; the call then executed and PostToolUse promoted it.
  const post = run('PostToolUse', payload(), env);
  assert.equal(post.status, 0);
  assert.equal(post.stdout.trim(), '', 'the receipt half never emits a decision');

  for (let i = 0; i < 3; i += 1) {
    assert.ok(!asks(run('PreToolUse', payload(), env)), `dispatch ${i + 2} must not ask again`);
  }
});

test('a denied ask leaves no receipt, so the gate still asks', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  assert.ok(asks(run('PreToolUse', payload(), env)));
  // No PostToolUse fires when the human denies — the tool never ran.
  assert.ok(asks(run('PreToolUse', payload(), env)), 'denial must not be mistaken for approval');
});

test('the NEXT run in the same session asks again', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env, { startedAt: '2026-09-08T00:00:00.000Z' });
  run('PreToolUse', payload(), env);
  run('PostToolUse', payload(), env);
  assert.ok(!asks(run('PreToolUse', payload(), env)), 'still inside the approved run');

  // A second front-door command re-runs `session-mode.js set` ⇒ a new started_at.
  writeMarker(env, { startedAt: '2026-09-08T09:00:00.000Z' });
  assert.ok(asks(run('PreToolUse', payload(), env)), 'a new run must be approved on its own');
});

test('PostToolUse without a matching ask leaves NO receipt', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  // No PreToolUse ran for this run: the gate never asked, so nothing may be recorded.
  const post = run('PostToolUse', payload(), env);
  assert.equal(post.status, 0);
  assert.ok(asks(run('PreToolUse', payload(), env)), 'a bare PostToolUse must not mint approval');
});

test('the knob flipping mid-call does not mint a phantom approval', () => {
  // The round-end persist question turns the knob ON. A Task already in flight then has
  // its Pre (knob off ⇒ inert, no pending) and its Post (knob on) straddle the change.
  const env = freshEnv();
  writeMarker(env);
  run('PreToolUse', payload(), env); // knob off: inert, no pending written
  const on = { ...env, AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' };
  run('PostToolUse', payload(), on); // knob on, but no pending exists
  assert.ok(asks(run('PreToolUse', payload(), on)), 'the next dispatch must still ask');
});

test('a parallel first batch leaves ONE pending, and all of them ask', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  const results = [0, 1, 2, 3].map(() => run('PreToolUse', payload(), env));
  assert.ok(results.every(asks), 'every call in the batch needs its own decision');
  const st = JSON.parse(fs.readFileSync(path.join(env.AUTOPILOT_RUN_APPROVAL_DIR, `${SID}.json`), 'utf8'));
  assert.ok(st.pending_at, 'batch leaves a pending');
  assert.ok(!st.approved_at, 'asking is not approving');
});

test('a corrupt payload or state file fails open, never gates', () => {
  const env = freshEnv({ AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' });
  writeMarker(env);
  const r = spawnSync('node', [HOOK, 'PreToolUse'], {
    input: 'not json',
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');

  fs.mkdirSync(env.AUTOPILOT_RUN_APPROVAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.AUTOPILOT_RUN_APPROVAL_DIR, `${SID}.json`), '{{{');
  assert.ok(asks(run('PreToolUse', payload(), env)), 'corrupt receipt ⇒ ask again (never assume approved)');
});
