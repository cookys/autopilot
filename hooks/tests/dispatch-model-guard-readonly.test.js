'use strict';
// M4 (fleet-routing-mechanization): Role is read-only but subagent_type is general-purpose.
// shadow (default) = allow + log; enforce = deny naming the type to use. Sandbox HOME, no real fleet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOKS = path.resolve(__dirname, '..');
const GUARD = path.join(HOOKS, 'dispatch-model-guard.js');
const BUDGET = path.join(HOOKS, 'subagent-budget.js');
const TASK = '01M8F0D8E9F7K4GPR06452VPZJ';

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dmg-ro-'));
  const env = { ...process.env, HOME: home, XDG_STATE_HOME: path.join(home, 'state'),
    XDG_RUNTIME_DIR: path.join(home, 'run'), AUTOPILOT_STATE_DIR: path.join(home, 'astate'),
    AUTOPILOT_HOOK_LOG: path.join(home, 'hook-log.jsonl'), AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind',
    AUTOPILOT_PACE_FILE: path.join(home, 'no-pace.json') };
  for (const k of ['AUTOPILOT_SEAT_ROLE', 'AUTOPILOT_READONLY_ROLE_GUARD', 'AUTOPILOT_MECHANICAL_REROUTE',
    'FLEET_ADDRESS', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_SESSION_ID']) delete env[k];
  fs.mkdirSync(path.join(home, 'astate'), { recursive: true });
  // stub fleet: every task is open; never touches a real courier
  const stub = path.join(home, 'fleet');
  fs.writeFileSync(stub, "#!/bin/sh\necho '{\"status\":\"in_progress\"}'\n", { mode: 0o755 });
  env.FLEET_BIN = stub;
  return { home, env };
}
function run(hook, env, toolInput, cwd) {
  const r = spawnSync('node', [hook], { input: JSON.stringify({ tool_name: 'Agent', hook_event_name: 'PreToolUse', cwd, tool_input: toolInput }), env, encoding: 'utf8' });
  let out = null; try { out = JSON.parse(r.stdout.trim()); } catch { /* none */ }
  return { r, out, decision: out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision };
}
const brief = (role) => `Engine: sonnet\nRole: ${role}\nLane: ro-test\nFleet-Task: ${TASK}\nread things`;
const call = (role, type = 'general-purpose') => ({ subagent_type: type, model: 'sonnet', prompt: brief(role) });
const hookLog = (home) => {
  const f = path.join(home, 'hook-log.jsonl');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

test('shadow (default): allows, logs a warn row to the shared hook log', () => {
  const { home, env } = sandbox();
  const x = run(GUARD, env, call('reviewer'), home);
  assert.strictEqual(x.decision, undefined);
  const rows = hookLog(home).filter((l) => l.rule === 'readonly-role-general-purpose');
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].decision, rows[0].intercepted], ['warn', false]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('enforce: denies read-only Role on general-purpose and names the type to use', () => {
  const { home, env } = sandbox();
  const x = run(GUARD, { ...env, AUTOPILOT_READONLY_ROLE_GUARD: 'enforce' }, call('researcher'), home);
  assert.strictEqual(x.decision, 'deny');
  const reason = x.out.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /subagent_type: Explore/);
  assert.match(reason, /修正：/);
  assert.match(reason, /參閱：hooks\/README\.md/);
  assert.deepStrictEqual(hookLog(home).map((l) => [l.decision, l.intercepted]), [['block', true]]);
  fs.rmSync(home, { recursive: true, force: true });
});

test('negative control: write role and read-only agent types are not denied in enforce', () => {
  const { home, env } = sandbox();
  const e = { ...env, AUTOPILOT_READONLY_ROLE_GUARD: 'enforce' };
  assert.notStrictEqual(run(GUARD, e, call('implementer'), home).decision, 'deny');
  for (const t of ['probe', 'autopilot:hands', 'test-runner', 'autopilot:transcript-digest']) {
    assert.notStrictEqual(run(GUARD, e, call('reviewer', t), home).decision, 'deny', t);
  }
  fs.rmSync(home, { recursive: true, force: true });
});

test('mechanicalReroute wins: PM seat + Role: stats is denied by the reroute, not the readonly guard', () => {
  const { home, env } = sandbox();
  const e = { ...env, AUTOPILOT_READONLY_ROLE_GUARD: 'enforce', AUTOPILOT_SEAT_ROLE: 'pm', AUTOPILOT_MECHANICAL_REROUTE: 'enforce' };
  const x = run(GUARD, e, call('stats'), home);
  assert.strictEqual(x.decision, 'deny');
  assert.match(x.out.hookSpecificOutput.permissionDecisionReason, /機械性工作轉派阻擋/);
  // no reroute (non pm/lead seat): mechanical-owned role is logged, never denied here
  const y = run(GUARD, { ...env, AUTOPILOT_READONLY_ROLE_GUARD: 'enforce' }, call('stats'), home);
  assert.notStrictEqual(y.decision, 'deny');
  fs.rmSync(home, { recursive: true, force: true });
});

test('off: no log row', () => {
  const { home, env } = sandbox();
  run(GUARD, { ...env, AUTOPILOT_READONLY_ROLE_GUARD: 'off' }, call('reviewer'), home);
  assert.strictEqual(hookLog(home).length, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('read-only agent types pass the PM Fleet-Task gate without a task id', () => {
  const { home, env } = sandbox();
  const e = { ...env, AUTOPILOT_SEAT_ROLE: 'pm' };
  const ti = { subagent_type: 'autopilot:probe', model: 'haiku', prompt: 'Engine: haiku\nRole: probe\nlook' };
  assert.notStrictEqual(run(GUARD, e, ti, home).decision, 'deny');
  const ti2 = { ...ti, subagent_type: 'general-purpose' };
  assert.strictEqual(run(GUARD, e, ti2, home).decision, 'deny');
  fs.rmSync(home, { recursive: true, force: true });
});

test('subagent-budget: Lane-less Engine brief on a read-only type is exempt from lane_missing', () => {
  const { home, env } = sandbox();
  const b = `Engine: haiku\nFleet-Task: ${TASK}\nlook`;
  const ok = run(BUDGET, env, { subagent_type: 'probe', model: 'haiku', prompt: b }, home);
  assert.ok(!/lane_missing|valid "Lane:"/.test(ok.r.stdout + ok.r.stderr), ok.r.stdout);
  const bad = run(BUDGET, env, { subagent_type: 'general-purpose', model: 'haiku', prompt: b }, home);
  assert.match(bad.r.stdout + bad.r.stderr, /Lane:/);
  fs.rmSync(home, { recursive: true, force: true });
});
