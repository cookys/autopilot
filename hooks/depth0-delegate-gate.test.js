/**
 * Tests for depth0-delegate-gate.js (PreToolUse WebFetch|WebSearch|Read|Grep|Glob|Bash|
 * Agent|Task|Skill, default-on, v2.36.1 P3). Black-box: spawns the real hook.
 *
 * Run: node --test hooks/depth0-delegate-gate.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, 'depth0-delegate-gate.js');

function shmTmp(prefix) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}

function runHook(stdinObj, env) {
  return spawnSync('node', [HOOK], {
    input: typeof stdinObj === 'string' ? stdinObj : JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function freshEnv(extra = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'd0gate-home-'));
  const liveDir = shmTmp('d0gate-live-');
  return {
    HOME: home,
    AUTOPILOT_LIVE_DIR: liveDir,
    ...extra,
  };
}

function payload(tool, extra = {}) {
  return { tool_name: tool, session_id: 'd0-test-session', tool_input: {}, hook_event_name: 'PreToolUse', ...extra };
}

function bashPayload(cmd, extra = {}) {
  return payload('Bash', { tool_input: { command: cmd }, ...extra });
}

function writeLiveMain(base, sid, obj) {
  const dir = path.join(base, 'context');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sid}.json`), JSON.stringify(obj));
}

function liveMainFixture(overrides = {}) {
  return {
    schema_version: 1,
    session_id: 'd0-test-session',
    written_at: new Date().toISOString(),
    cc_version: '2.1.260',
    model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' },
    context_window: {
      context_window_size: 1_000_000, used_percentage: 1, total_input_tokens: 1000,
      current_usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 },
    },
    ...overrides,
  };
}

function readState(liveDir, sid) {
  return JSON.parse(fs.readFileSync(path.join(liveDir, 'depth0-gate', `${sid}.json`), 'utf8'));
}

// ---- basic no-op / skip behavior ----

test('subagent fire (agent_id present) is silent regardless of tool or count', () => {
  const env = freshEnv();
  for (let i = 0; i < 12; i += 1) {
    const r = runHook(payload('Read', { agent_id: 'sub-1' }), env);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
    assert.strictEqual(r.stderr.trim(), '');
  }
});

test('garbage stdin ⇒ fail-open exit 0', () => {
  const r = runHook('not json{{{', freshEnv());
  assert.strictEqual(r.status, 0);
});

test('off mode ⇒ silent, no state written', () => {
  const env = freshEnv({ AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: 'off' });
  for (let i = 0; i < 10; i += 1) {
    const r = runHook(payload('Read'), env);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim(), '');
  }
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate')), 'off mode must not write state');
});

test('an unrelated tool (Edit) is a no-op: counter untouched', () => {
  const env = freshEnv();
  for (let i = 0; i < 7; i += 1) runHook(payload('Read'), env);
  const before = readState(env.AUTOPILOT_LIVE_DIR, 'd0-test-session').reads;
  const r = runHook(payload('Edit', { tool_input: { file_path: 'x.js' } }), env);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr.trim(), '');
  const after = readState(env.AUTOPILOT_LIVE_DIR, 'd0-test-session').reads;
  assert.strictEqual(after, before, 'Edit must not touch the read counter');
});

// ---- below threshold silent ----

test('below threshold: silent for each of Read/Grep/Glob/WebFetch/WebSearch', () => {
  const env = freshEnv();
  for (const tool of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']) {
    const r = runHook(payload(tool), env);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim(), '', `${tool} below threshold must be silent`);
  }
});

// ---- threshold nudge + refire cadence ----

test('threshold nudge fires at 8 and refires every 8 after, silent in between', () => {
  const env = freshEnv();
  for (let i = 1; i <= 24; i += 1) {
    const r = runHook(payload('Read'), env);
    assert.strictEqual(r.status, 0);
    if (i % 8 === 0) {
      assert.match(r.stderr, /depth0-delegate-gate: \d+ consecutive read-class calls at depth-0/);
      assert.match(r.stderr, new RegExp(`^depth0-delegate-gate: ${i} consecutive`));
    } else {
      assert.strictEqual(r.stderr.trim(), '', `call ${i} must be silent`);
    }
  }
});

// ---- reset on Agent/Task/Skill ----

for (const resetTool of ['Agent', 'Task', 'Skill']) {
  test(`${resetTool} resets the counter to 0`, () => {
    const env = freshEnv();
    for (let i = 0; i < 7; i += 1) runHook(payload('Read'), env);
    assert.strictEqual(readState(env.AUTOPILOT_LIVE_DIR, 'd0-test-session').reads, 7);
    const r = runHook(payload(resetTool, { tool_input: {} }), env);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stderr.trim(), '');
    assert.strictEqual(readState(env.AUTOPILOT_LIVE_DIR, 'd0-test-session').reads, 0);
    // and the next 7 reads stay silent again (post-reset)
    for (let i = 0; i < 7; i += 1) {
      const rr = runHook(payload('Read'), env);
      assert.strictEqual(rr.stderr.trim(), '');
    }
    const nudge = runHook(payload('Read'), env);
    assert.match(nudge.stderr, /8 consecutive/);
  });
}

// ---- Bash read-class classification ----

test('Bash grep/rg/find/cat/sed -n/head/tail count as read-class', () => {
  const env = freshEnv();
  const cmds = ['grep -R foo .', 'rg foo', 'find . -name "*.js"', 'cat README.md', 'sed -n 1,5p file', 'head -n 5 file', 'tail -n 5 file'];
  for (const cmd of cmds) runHook(bashPayload(cmd), env);
  assert.strictEqual(readState(env.AUTOPILOT_LIVE_DIR, 'd0-test-session').reads, cmds.length);
});

test('Bash npm test does not count', () => {
  const env = freshEnv();
  const r = runHook(bashPayload('npm test'), env);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate', 'd0-test-session.json')),
    'a non-read-class Bash must not even create state');
});

test('heredoc body containing grep is data, not counted', () => {
  const env = freshEnv();
  // The literal command does not start with a read-class prefix; a heredoc BODY happens to
  // mention grep, which the executable-text lexer strips as data before the prefix check.
  const cmd = "npm test <<'EOF'\ngrep pattern in the body, not executed\nEOF";
  const r = runHook(bashPayload(cmd), env);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate', 'd0-test-session.json')),
    'heredoc-body grep must not count as a read-class Bash call');
});

test('a comment containing a read-class word is data, not counted', () => {
  const env = freshEnv();
  const r = runHook(bashPayload('npm test # grep this later'), env);
  assert.strictEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate', 'd0-test-session.json')));
});

// ---- block mode ----

function blockEnv(extra = {}) {
  return freshEnv({ AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: 'block', ...extra });
}

for (const modelId of ['claude-fable-5-1', 'CLAUDE-FABLE-5-1', 'claude-opus-4-8[1m]']) {
  test(`block mode denies at 2x threshold with a fresh guarded model id "${modelId}"`, () => {
    const env = blockEnv();
    writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture({ model: { id: modelId, display_name: 'x' } }));
    let lastDenyIdx = -1;
    for (let i = 1; i <= 16; i += 1) {
      const r = runHook(payload('Read'), env);
      assert.strictEqual(r.status, 0, 'deny is still exit 0 on stdin');
      if (i >= 16) {
        assert.match(r.stdout, /"permissionDecision":"deny"/, `call ${i} at/after 2x threshold must deny`);
        lastDenyIdx = i;
      }
    }
    assert.strictEqual(lastDenyIdx, 16);
    // and it keeps denying past 2x threshold, not just once
    const again = runHook(payload('Read'), env);
    assert.match(again.stdout, /"permissionDecision":"deny"/);
  });
}

for (const modelId of ['claude-sonnet-5', 'fable-ish', 'claude-fable']) {
  test(`block mode does NOT deny for non-guarded/malformed model id "${modelId}"`, () => {
    const env = blockEnv();
    writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture({ model: { id: modelId, display_name: 'x' } }));
    let r;
    for (let i = 1; i <= 16; i += 1) r = runHook(payload('Read'), env);
    assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
    assert.match(r.stderr, /16 consecutive/, 'still nudges via stderr in block mode');
  });
}

test('block mode: malformed model id (does not match grammar) never blocks', () => {
  const env = blockEnv();
  writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture({ model: { id: 'not-a-real-id', display_name: 'x' } }));
  let r;
  for (let i = 1; i <= 16; i += 1) r = runHook(payload('Read'), env);
  assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
});

test('block mode: stale live file (>120s) never blocks', () => {
  const env = blockEnv();
  writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture({
    written_at: new Date(Date.now() - 121_000).toISOString(),
  }));
  let r;
  for (let i = 1; i <= 16; i += 1) r = runHook(payload('Read'), env);
  assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
});

test('block mode: absent live file never blocks, only warns', () => {
  const env = blockEnv();
  let r;
  for (let i = 1; i <= 16; i += 1) r = runHook(payload('Read'), env);
  assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
  assert.match(r.stderr, /16 consecutive/);
});

test('warn mode never blocks even with a fresh guarded model far past 2x threshold', () => {
  const env = freshEnv({ AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE: 'warn' });
  writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture());
  let r;
  for (let i = 1; i <= 20; i += 1) r = runHook(payload('Read'), env);
  assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
});

test('below-2x-threshold reads with a fresh guarded model in block mode only warn, never deny', () => {
  const env = blockEnv();
  writeLiveMain(env.AUTOPILOT_LIVE_DIR, 'd0-test-session', liveMainFixture());
  let r;
  for (let i = 1; i <= 8; i += 1) r = runHook(payload('Read'), env);
  assert.doesNotMatch(r.stdout, /"permissionDecision":"deny"/);
  assert.match(r.stderr, /8 consecutive/);
});

// ---- state location ----

test('state file lands under the resolved live-dir base at depth0-gate/<sid>.json', () => {
  const env = freshEnv();
  runHook(payload('Read'), env);
  const expected = path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate', 'd0-test-session.json');
  assert.ok(fs.existsSync(expected), `expected state at ${expected}`);
});

test('AUTOPILOT_DEPTH0_GATE_DIR overrides the state directory', () => {
  const env = freshEnv();
  const override = fs.mkdtempSync(path.join(os.tmpdir(), 'd0gate-override-'));
  runHook(payload('Read'), { ...env, AUTOPILOT_DEPTH0_GATE_DIR: override });
  assert.ok(fs.existsSync(path.join(override, 'd0-test-session.json')));
  assert.ok(!fs.existsSync(path.join(env.AUTOPILOT_LIVE_DIR, 'depth0-gate', 'd0-test-session.json')));
});
