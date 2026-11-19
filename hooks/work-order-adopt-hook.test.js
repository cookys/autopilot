'use strict';

/**
 * work-order-adopt-hook.test.js — PostToolUse hook suite for hooks/work-order-adopt-hook.js.
 *
 * Covers:
 *   - opt-in off -> no adopt call, marker untouched, stdout empty, exit 0 (negative control);
 *   - mcp__fleet__task_progress with same id as marker.fleet_task_id -> no adopt call;
 *   - mcp__fleet__task_progress with new id -> exactly one adopt call, marker updated, stdout empty, exit 0;
 *   - Bash `fleet task progress <id>` with new id -> one adopt call, marker updated, stdout empty, exit 0;
 *   - unresolved task (exit 2 inside work-order-adopt.js) -> hook still exits 0 with empty stdout.
 */

require('../scripts/lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const HOOK_SCRIPT = path.resolve(__dirname, 'work-order-adopt-hook.js');

function makeHookSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-adopt-hook-test-'));
  const repo = path.join(root, 'repo');
  const markerDir = path.join(root, 'markers');
  const binDir = path.join(root, 'bin');
  const fleetLog = path.join(root, 'fleet-calls.jsonl');
  const tasksFile = path.join(root, 'tasks.json');
  const configPath = path.join(root, 'config.json');

  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(configPath, '{}\n');
  fs.writeFileSync(tasksFile, '{}\n');

  execFileSync('git', ['-C', repo, 'init', '-b', 'develop'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(repo, 'README.md'), 'seed\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'commit', '-m', 'seed'], { stdio: 'ignore' });

  const fleetStub = path.join(binDir, 'fleet-stub');
  fs.writeFileSync(
    fleetStub,
    `#!${process.execPath}
'use strict';
const fs = require('fs');
const args = process.argv.slice(2);
if (process.env.TEST_FLEET_LOG) {
  fs.appendFileSync(process.env.TEST_FLEET_LOG, JSON.stringify(args) + '\\n');
}
if (args[0] === 'task' && args[1] === 'show') {
  const db = JSON.parse(fs.readFileSync(process.env.TEST_FLEET_TASKS, 'utf8'));
  const item = db[args[2]];
  if (!item) process.exit(2);
  process.stdout.write(JSON.stringify(item) + '\\n');
  process.exit(0);
}
process.exit(0);
`,
    { mode: 0o755 },
  );

  function setTasks(map) {
    fs.writeFileSync(tasksFile, `${JSON.stringify(map, null, 2)}\n`);
  }

  function clearFleetLog() {
    fs.rmSync(fleetLog, { force: true });
  }

  function readFleetCalls() {
    if (!fs.existsSync(fleetLog)) return [];
    return fs
      .readFileSync(fleetLog, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function readMarker(sid) {
    const p = path.join(markerDir, `${sid}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }

  function runHook(payload, envExtra = {}) {
    const env = { ...process.env };
    delete env.AUTOPILOT_TOKEN_SEAT;
    delete env.AUTOPILOT_SESSION_ID;
    delete env.AUTOPILOT_PARENT_SESSION_ID;
    delete env.AUTOPILOT_HOOK_WORK_ORDER_ADOPT;
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDE_SESSION_ID;
    delete env.CODEX_THREAD_ID;
    Object.assign(env, {
      FLEET_BIN: fleetStub,
      TEST_FLEET_LOG: fleetLog,
      TEST_FLEET_TASKS: tasksFile,
      AUTOPILOT_SESSION_MODE_DIR: markerDir,
      AUTOPILOT_CONFIG_FILE: configPath,
      AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
      ...envExtra,
    });
    return spawnSync(process.execPath, [HOOK_SCRIPT], {
      cwd: repo,
      env,
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      encoding: 'utf8',
    });
  }

  function cleanup() {
    fs.rmSync(root, { recursive: true, force: true });
  }

  return {
    repo,
    markerDir,
    configPath,
    setTasks,
    clearFleetLog,
    readFleetCalls,
    readMarker,
    runHook,
    cleanup,
  };
}

test('negative control: opt-in off does nothing and spawns zero fleet calls', () => {
  const sbx = makeHookSandbox();
  try {
    sbx.setTasks({
      '01M7HOOK000000000000000001': {
        id: '01M7HOOK000000000000000001',
        title: '[S] Hook task one',
      },
    });

    const res = sbx.runHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sid-opt-off',
      cwd: sbx.repo,
      tool_name: 'mcp__fleet__task_progress',
      tool_input: { task_id: '01M7HOOK000000000000000001', status: 'working' },
    });

    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
    assert.equal(sbx.readMarker('sid-opt-off'), null);
    assert.equal(sbx.readFleetCalls().length, 0);
  } finally {
    sbx.cleanup();
  }
});

test('mcp__fleet__task_progress: new id triggers one adopt call; same id triggers zero adopt calls', () => {
  const sbx = makeHookSandbox();
  try {
    sbx.setTasks({
      '01M7HOOK000000000000000001': {
        id: '01M7HOOK000000000000000001',
        title: '[M] Implement stage adopt\nPlan: plan-first',
      },
    });

    // First progress on new id -> adopts once
    const r1 = sbx.runHook(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sid-mcp',
        cwd: sbx.repo,
        tool_name: 'mcp__fleet__task_progress',
        tool_input: { task_id: '01M7HOOK000000000000000001', note: 'starting' },
      },
      { AUTOPILOT_HOOK_WORK_ORDER_ADOPT: '1' },
    );
    assert.equal(r1.status, 0);
    assert.equal(r1.stdout, '');
    const m1 = sbx.readMarker('sid-mcp');
    assert.ok(m1);
    assert.equal(m1.fleet_task_id, '01M7HOOK000000000000000001');
    assert.equal(m1.wo_size, 'M');
    assert.equal(m1.stage, 'plan');
    const showCalls1 = sbx.readFleetCalls().filter((c) => c[0] === 'task' && c[1] === 'show');
    assert.ok(showCalls1.length >= 1, 'adopt must have queried fleet task show');

    // Second progress with the SAME task id -> NO adopt call at all
    sbx.clearFleetLog();
    const r2 = sbx.runHook(
      {
        hook_event_name: 'PostToolUse',
        session_id: 'sid-mcp',
        cwd: sbx.repo,
        tool_name: 'mcp__fleet__task_progress',
        tool_input: { task_id: '01M7HOOK000000000000000001', note: 'still working' },
      },
      { AUTOPILOT_HOOK_WORK_ORDER_ADOPT: '1' },
    );
    assert.equal(r2.status, 0);
    assert.equal(r2.stdout, '');
    assert.equal(sbx.readFleetCalls().length, 0, 'same task_id must not invoke work-order-adopt');
  } finally {
    sbx.cleanup();
  }
});

test('Bash `fleet task progress <id>` adopts a new task and never blocks even on unresolved tasks', () => {
  const sbx = makeHookSandbox();
  try {
    sbx.setTasks({
      '01M7BASH000000000000000001': {
        id: '01M7BASH000000000000000001',
        title: '[bug S] Fix bash progress match',
      },
      '01M7BASHNOSIZE000000000002': {
        id: '01M7BASHNOSIZE000000000002',
        title: 'Task without any bracketed size',
      },
    });
    fs.writeFileSync(sbx.configPath, JSON.stringify({ hooks: { 'work-order-adopt': true } }));

    const rBash = sbx.runHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sid-bash',
      cwd: sbx.repo,
      tool_name: 'Bash',
      tool_input: { command: 'cd /tmp && fleet task progress 01M7BASH000000000000000001 working "claiming"' },
    });
    assert.equal(rBash.status, 0);
    assert.equal(rBash.stdout, '');
    const m = sbx.readMarker('sid-bash');
    assert.ok(m);
    assert.equal(m.fleet_task_id, '01M7BASH000000000000000001');
    assert.equal(m.size, 'S');
    assert.equal(m.bug, true);
    assert.equal(m.stage, 'diagnose');

    // Unresolved task causes work-order-adopt.js to exit 2, yet hook MUST still exit 0 with empty stdout
    const rUnres = sbx.runHook({
      hook_event_name: 'PostToolUse',
      session_id: 'sid-bash',
      cwd: sbx.repo,
      tool_name: 'Bash',
      tool_input: { command: 'fleet task progress 01M7BASHNOSIZE000000000002 working' },
    });
    assert.equal(rUnres.status, 0);
    assert.equal(rUnres.stdout, '');
    const mUnres = sbx.readMarker('sid-bash');
    assert.equal(mUnres.fleet_task_id, '01M7BASHNOSIZE000000000002');
    assert.equal(mUnres.wo_state, 'unresolved');
  } finally {
    sbx.cleanup();
  }
});
