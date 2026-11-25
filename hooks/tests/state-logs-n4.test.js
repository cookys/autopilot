'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SUBAGENT_BUDGET = path.join(REPO_ROOT, 'hooks/subagent-budget.js');
const DISPATCH_GUARD = path.join(REPO_ROOT, 'hooks/dispatch-model-guard.js');
const FIXTURE = path.join(REPO_ROOT, 'hooks/tests/lib/subagent-budget-fixture.js');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runHook(script, payload, env) {
  return spawnSync(process.execPath, [script], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('subagent-budget writes ticket-usage.jsonl to AUTOPILOT_STATE_DIR with model, subagent_type, role', () => {
  const tmp = mkTmp('n4-budget-state-');
  const home = path.join(tmp, 'home');
  const runtime = path.join(tmp, 'runtime');
  const state = path.join(tmp, 'state');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  fs.mkdirSync(proj, { recursive: true });

  const sid = 'sess-n4-1';
  const ticket = '01ZZZZZZZZZZZZZZZZZZZZZZZZ';
  const now = Date.now();
  const r = spawnSync(process.execPath, [
    FIXTURE,
    proj,
    sid,
    String(now),
    JSON.stringify([{ id: 'a1', brief: [`Lane: test-lane`, `Fleet-Task: ${ticket}`], turns: 1 }]),
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);

  const payload = {
    session_id: sid,
    transcript_path: path.join(proj, `${sid}.jsonl`),
    tool_name: 'Agent',
    tool_input: {
      model: 'sonnet',
      subagent_type: 'general-purpose',
      prompt: `Engine: sonnet | Role: implementer | Lane: test-lane\nFleet-Task: ${ticket}\nbody`,
    },
  };

  const res = runHook(SUBAGENT_BUDGET, payload, {
    HOME: home,
    XDG_RUNTIME_DIR: runtime,
    AUTOPILOT_STATE_DIR: state,
    AUTOPILOT_HOOK_SUBAGENT_BUDGET: '1',
  });
  assert.equal(res.status, 0, res.stderr);

  const newLedger = path.join(state, 'subagent-budget', 'ticket-usage.jsonl');
  const oldLedger = path.join(runtime, 'autopilot', 'subagent-budget', 'ticket-usage.jsonl');
  assert.equal(fs.existsSync(newLedger), true, 'expected ticket-usage.jsonl in AUTOPILOT_STATE_DIR');
  assert.equal(fs.existsSync(oldLedger), false, 'expected no ticket-usage.jsonl in XDG_RUNTIME_DIR');

  const lines = fs.readFileSync(newLedger, 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.model, 'sonnet');
  assert.equal(row.subagent_type, 'general-purpose');
  assert.equal(row.role, 'implementer');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('dispatch-model-guard shadow log writes to AUTOPILOT_STATE_DIR and XDG_STATE_HOME fallback', () => {
  const tmp = mkTmp('n4-guard-state-');
  const home = path.join(tmp, 'home');
  const runtime = path.join(tmp, 'runtime');
  const state = path.join(tmp, 'state');
  const xdgState = path.join(tmp, 'xdg-state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });

  const payload = {
    session_id: 'sess-n4-guard',
    cwd: tmp,
    tool_name: 'Agent',
    tool_input: {
      model: 'sonnet',
      subagent_type: 'general-purpose',
      prompt: 'Engine: sonnet\nRole: stats\nLane: test-lane\nFleet-Task: 01M7ZDSR7X7C6GVSB6T3Q6YC3G\nbody',
    },
  };

  const res1 = runHook(DISPATCH_GUARD, payload, {
    HOME: home,
    XDG_RUNTIME_DIR: runtime,
    AUTOPILOT_STATE_DIR: state,
    AUTOPILOT_MECHANICAL_REROUTE: 'shadow',
    AUTOPILOT_SEAT_ROLE: 'lead',
    AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind',
  });
  assert.equal(res1.status, 0, res1.stderr);

  const shadow1 = path.join(state, 'mechanical-reroute-shadow.jsonl');
  const oldShadow = path.join(runtime, `autopilot-${process.getuid()}`, 'mechanical-reroute-shadow.jsonl');
  assert.equal(fs.existsSync(shadow1), true, 'expected shadow log in AUTOPILOT_STATE_DIR');
  assert.equal(fs.existsSync(oldShadow), false, 'expected no shadow log in XDG_RUNTIME_DIR');
  const row = JSON.parse(fs.readFileSync(shadow1, 'utf8').trim().split('\n')[0]);
  assert.equal(row.model, 'sonnet');
  assert.equal(row.subagent_type, 'general-purpose');
  assert.equal(row.role, 'stats');

  const res2 = runHook(DISPATCH_GUARD, payload, {
    HOME: home,
    XDG_RUNTIME_DIR: runtime,
    AUTOPILOT_STATE_DIR: '',
    XDG_STATE_HOME: xdgState,
    AUTOPILOT_MECHANICAL_REROUTE: 'shadow',
    AUTOPILOT_SEAT_ROLE: 'lead',
    AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind',
  });
  assert.equal(res2.status, 0, res2.stderr);
  assert.equal(fs.existsSync(path.join(xdgState, 'autopilot', 'mechanical-reroute-shadow.jsonl')), true);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('fail-open when state dir is unwritable', () => {
  const tmp = mkTmp('n4-ro-');
  const home = path.join(tmp, 'home');
  const runtime = path.join(tmp, 'runtime');
  const roState = path.join(tmp, 'ro-state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  fs.writeFileSync(roState, 'not-a-directory');

  const res = runHook(DISPATCH_GUARD, {
    session_id: 'sess-ro',
    cwd: tmp,
    tool_name: 'Agent',
    tool_input: {
      model: 'sonnet',
      subagent_type: 'general-purpose',
      prompt: 'Engine: sonnet\nRole: stats\nLane: test-lane\nFleet-Task: 01M7ZDSR7X7C6GVSB6T3Q6YC3G\nbody',
    },
  }, {
    HOME: home,
    XDG_RUNTIME_DIR: runtime,
    AUTOPILOT_STATE_DIR: roState,
    AUTOPILOT_MECHANICAL_REROUTE: 'shadow',
    AUTOPILOT_SEAT_ROLE: 'lead',
    AUTOPILOT_DISPATCH_MODEL_GUARD_MODE: 'remind',
  });
  assert.equal(res.status, 0, res.stderr);

  fs.rmSync(tmp, { recursive: true, force: true });
});
