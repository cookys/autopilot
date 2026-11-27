'use strict';

/**
 * work-order-adopt.test.js — unit + integration suite for scripts/work-order-adopt.js (P3).
 *
 * Stubs FLEET_BIN in isolated temp directories (never calls the real fleet CLI) and uses
 * isolated AUTOPILOT_SESSION_MODE_DIR + scratch git repos via scripts/lib/test-git-env.js.
 *
 * Negative controls:
 *   - `session-mode.js set --fleet-task <id>` with a title containing no Size stores
 *     `wo_state: "unresolved"` and `wo_size: null` (never `resolved`).
 *   - Title without SizeTag on `work-order-adopt.js` MUST return exit 2, write
 *     `wo_state: "unresolved"` (with no stale stage/size), emit one stderr line, and NEVER
 *     advance `stage` or emit `[stage:...]` progress.
 *   - Inherited `AUTOPILOT_PARENT_SESSION_ID` without `--session-id` MUST refuse with exit 3
 *     before touching any marker file.
 */

require('./lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ADOPT_SCRIPT = path.resolve(__dirname, 'work-order-adopt.js');
const SESSION_MODE_SCRIPT = path.resolve(__dirname, 'session-mode.js');
const STAGE_ADVANCE_SCRIPT = path.resolve(__dirname, 'stage-advance.js');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-adopt-test-'));
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
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@example.invalid'], { stdio: 'ignore' });
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
const logFile = process.env.TEST_FLEET_LOG;
if (logFile) {
  fs.appendFileSync(logFile, JSON.stringify(args) + '\\n');
}
const mode = process.env.TEST_FLEET_MODE || 'ok';
if (mode === 'exit3') {
  process.stderr.write('courier unreachable\\n');
  process.exit(3);
}
if (mode === 'sleep') {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  process.exit(0);
}
if (args[0] === 'task' && args[1] === 'show') {
  const id = args[2];
  const db = JSON.parse(fs.readFileSync(process.env.TEST_FLEET_TASKS, 'utf8'));
  if (!Object.prototype.hasOwnProperty.call(db, id)) {
    process.stderr.write('task not found: ' + id + '\\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(db[id]) + '\\n');
  process.exit(0);
}
if (args[0] === 'task' && args[1] === 'update') {
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

  function buildEnv(extra = {}) {
    const env = { ...process.env };
    delete env.AUTOPILOT_TOKEN_SEAT;
    delete env.AUTOPILOT_SESSION_ID;
    delete env.AUTOPILOT_PARENT_SESSION_ID;
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
      ...extra,
    });
    return env;
  }

  function runAdopt(argv, envExtra = {}) {
    return spawnSync(process.execPath, [ADOPT_SCRIPT, ...argv], {
      cwd: repo,
      env: buildEnv(envExtra),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function runSessionMode(argv, envExtra = {}) {
    return spawnSync(process.execPath, [SESSION_MODE_SCRIPT, ...argv], {
      cwd: repo,
      env: buildEnv(envExtra),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  function readMarker(sid) {
    const p = path.join(markerDir, `${sid}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
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

  function cleanup() {
    fs.rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    repo,
    markerDir,
    setTasks,
    clearFleetLog,
    buildEnv,
    runAdopt,
    runSessionMode,
    readMarker,
    readFleetCalls,
    cleanup,
  };
}

test('fixture [M] task writes wo_size=M, fleet_task_id, entry stage=plan, wo_state=resolved in ONE fleet task show call (plus [bug S] and [!L])', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7TASKM00000000000000001': {
        id: '01M7TASKM00000000000000001',
        title: '[M] Build automatic work order adoption\nPlan: plan-first',
      },
      '01M7TASKBUGS00000000000002': {
        id: '01M7TASKBUGS00000000000002',
        title: '[bug S] Fix null pointer on empty input',
      },
      '01M7TASKURGL00000000000003': {
        id: '01M7TASKURGL00000000000003',
        title: '[!L] Restore broken deployment pipeline\nPlan: plan-first',
      },
    });

    sbx.clearFleetLog();
    const rM = sbx.runAdopt(['--task', '01M7TASKM00000000000000001', '--session-id', 'sid-m']);
    assert.equal(rM.status, 0, `stderr: ${rM.stderr}`);
    const showCallsM = sbx.readFleetCalls().filter((c) => c[0] === 'task' && c[1] === 'show');
    assert.equal(showCallsM.length, 1, 'adopt must invoke `fleet task show` strictly once (no second fetch in session-mode)');
    const mMarker = sbx.readMarker('sid-m');
    assert.ok(mMarker);
    assert.equal(mMarker.fleet_task_id, '01M7TASKM00000000000000001');
    assert.equal(mMarker.wo_task, '01M7TASKM00000000000000001');
    assert.equal(mMarker.wo_size, 'M');
    assert.equal(mMarker.size, 'M');
    assert.equal(mMarker.bug, false);
    assert.equal(mMarker.urgent, false);
    assert.equal(mMarker.wo_plan, 'plan-first');
    assert.equal(mMarker.wo_state, 'resolved');
    assert.equal(mMarker.stage, 'plan');

    const rBug = sbx.runAdopt(['--task', '01M7TASKBUGS00000000000002', '--session-id', 'sid-bug']);
    assert.equal(rBug.status, 0, `stderr: ${rBug.stderr}`);
    const bugMarker = sbx.readMarker('sid-bug');
    assert.equal(bugMarker.wo_size, 'S');
    assert.equal(bugMarker.size, 'S');
    assert.equal(bugMarker.bug, true);
    assert.equal(bugMarker.urgent, false);
    assert.equal(bugMarker.wo_state, 'resolved');
    assert.equal(bugMarker.stage, 'diagnose');

    const rUrg = sbx.runAdopt(['--task', '01M7TASKURGL00000000000003', '--session-id', 'sid-urg']);
    assert.equal(rUrg.status, 0, `stderr: ${rUrg.stderr}`);
    const urgMarker = sbx.readMarker('sid-urg');
    assert.equal(urgMarker.wo_size, 'L');
    assert.equal(urgMarker.size, 'L');
    assert.equal(urgMarker.bug, false);
    assert.equal(urgMarker.urgent, true);
    assert.equal(urgMarker.wo_state, 'resolved');
    assert.equal(urgMarker.stage, 'intent');
  } finally {
    sbx.cleanup();
  }
});

test('second task with a different id goes through --new-task and clears prior task walk state', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7FIRST00000000000000001': {
        id: '01M7FIRST00000000000000001',
        title: '[bug L] Investigate multi-module failure\nPlan: plan-first',
      },
      '01M7SECOND0000000000000002': {
        id: '01M7SECOND0000000000000002',
        title: '[S] Small follow-up cleanup',
      },
    });

    const r1 = sbx.runAdopt(['--task', '01M7FIRST00000000000000001', '--session-id', 'sid-lane']);
    assert.equal(r1.status, 0, `r1 stderr: ${r1.stderr}`);

    // Move first task forward to `proposal` so we can verify --new-task clears prior walk state.
    const adv = spawnSync(
      process.execPath,
      [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-lane', '--to', 'proposal'],
      { cwd: sbx.repo, env: sbx.buildEnv(), encoding: 'utf8' },
    );
    assert.equal(adv.status, 0, `stage-advance stderr: ${adv.stderr}`);
    const before = sbx.readMarker('sid-lane');
    assert.equal(before.stage, 'proposal');
    assert.equal(before.size, 'L');
    assert.equal(before.bug, true);

    // Adopting a smaller S non-bug task with a different fleet_task_id MUST pass via --new-task (without --new-task, L -> S would fail).
    const r2 = sbx.runAdopt(['--task', '01M7SECOND0000000000000002', '--session-id', 'sid-lane']);
    assert.equal(r2.status, 0, `r2 stderr: ${r2.stderr}`);
    const after = sbx.readMarker('sid-lane');
    assert.equal(after.fleet_task_id, '01M7SECOND0000000000000002');
    assert.equal(after.wo_task, '01M7SECOND0000000000000002');
    assert.equal(after.wo_size, 'S');
    assert.equal(after.size, 'S');
    assert.equal(after.bug, false);
    assert.equal(after.urgent, false);
    assert.equal(after.wo_state, 'resolved');
    assert.equal(after.stage, 'implement');
    assert.ok(Number.isInteger(after.task_seq) && after.task_seq >= 2, `expected task_seq >= 2, got ${after.task_seq}`);
  } finally {
    sbx.cleanup();
  }
});

test('local-task marker (size=M, stage=implement, no fleet_task_id) then [S] fleet task passes --new-task -> size S, stage implement; unresolved clears stale stage/size', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7FROMLOCAL0000000000001': {
        id: '01M7FROMLOCAL0000000000001',
        title: '[S] Small fleet follow-up after local task',
      },
      '01M7FROMLOCALUNRES00000002': {
        id: '01M7FROMLOCALUNRES00000002',
        title: 'Unresolved fleet task without bracket size',
      },
    });

    // 1) Local task: size=M, stage=implement, no fleet_task_id -> adopt [S] fleet task
    const initLocal = sbx.runSessionMode(['set', '--size', 'M', '--session-id', 'sid-local']);
    assert.equal(initLocal.status, 0, `session-mode init stderr: ${initLocal.stderr}`);
    const advPlan = spawnSync(
      process.execPath,
      [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local', '--to', 'plan'],
      { cwd: sbx.repo, env: sbx.buildEnv(), encoding: 'utf8' },
    );
    assert.equal(advPlan.status, 0, `stage-advance plan stderr: ${advPlan.stderr}`);
    const advReview = spawnSync(
      process.execPath,
      [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local', '--to', 'plan-review'],
      { cwd: sbx.repo, env: sbx.buildEnv(), encoding: 'utf8' },
    );
    assert.equal(advReview.status, 0, `stage-advance plan-review stderr: ${advReview.stderr}`);
    const advImpl = spawnSync(
      process.execPath,
      [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local', '--to', 'implement', '--unit', 'phase:1/1:local'],
      { cwd: sbx.repo, env: sbx.buildEnv(), encoding: 'utf8' },
    );
    assert.equal(advImpl.status, 0, `stage-advance implement stderr: ${advImpl.stderr}`);

    const localBefore = sbx.readMarker('sid-local');
    assert.equal(localBefore.size, 'M');
    assert.equal(localBefore.stage, 'implement');
    assert.equal(localBefore.fleet_task_id, undefined);

    const rAdoptS = sbx.runAdopt(['--task', '01M7FROMLOCAL0000000000001', '--session-id', 'sid-local']);
    assert.equal(rAdoptS.status, 0, `adopt [S] stderr: ${rAdoptS.stderr}`);
    const afterS = sbx.readMarker('sid-local');
    assert.equal(afterS.fleet_task_id, '01M7FROMLOCAL0000000000001');
    assert.equal(afterS.wo_task, '01M7FROMLOCAL0000000000001');
    assert.equal(afterS.size, 'S');
    assert.equal(afterS.wo_size, 'S');
    assert.equal(afterS.wo_state, 'resolved');
    assert.equal(afterS.stage, 'implement');
    assert.equal(afterS.unit, undefined, 'prior local unit must be cleared by --new-task');
    assert.ok(Number.isInteger(afterS.task_seq) && afterS.task_seq >= 2);

    // 2) Same rule for writeUnresolvedMarker: local task (size=M, stage=implement, no fleet_task_id) -> unresolved fleet task leaves NO stale stage or size
    assert.equal(sbx.runSessionMode(['set', '--size', 'M', '--session-id', 'sid-local-unres']).status, 0);
    assert.equal(
      spawnSync(process.execPath, [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local-unres', '--to', 'plan'], {
        cwd: sbx.repo,
        env: sbx.buildEnv(),
        encoding: 'utf8',
      }).status,
      0,
    );
    assert.equal(
      spawnSync(process.execPath, [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local-unres', '--to', 'plan-review'], {
        cwd: sbx.repo,
        env: sbx.buildEnv(),
        encoding: 'utf8',
      }).status,
      0,
    );
    assert.equal(
      spawnSync(process.execPath, [STAGE_ADVANCE_SCRIPT, '--session-id', 'sid-local-unres', '--to', 'implement'], {
        cwd: sbx.repo,
        env: sbx.buildEnv(),
        encoding: 'utf8',
      }).status,
      0,
    );

    const rUnres = sbx.runAdopt(['--task', '01M7FROMLOCALUNRES00000002', '--session-id', 'sid-local-unres']);
    assert.equal(rUnres.status, 2);
    const afterUnres = sbx.readMarker('sid-local-unres');
    assert.equal(afterUnres.wo_state, 'unresolved');
    assert.equal(afterUnres.wo_size, null);
    assert.equal(afterUnres.stage, undefined, 'no stale stage left in unresolved marker');
    assert.equal(afterUnres.size, undefined, 'no stale size left in unresolved marker');
    assert.ok(Number.isInteger(afterUnres.task_seq) && afterUnres.task_seq >= 2);
  } finally {
    sbx.cleanup();
  }
});

test('title SizeTag governs size conflict; body is read only for Plan: (title [M] + body Size: S -> resolved M)', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7BODYSIZE00000000000001': {
        id: '01M7BODYSIZE00000000000001',
        title: '[M] Refactor work-order parser',
        body: 'Size: S\nPlan: plan-first',
      },
      '01M7TITLECONFLICT000000002': {
        id: '01M7TITLECONFLICT000000002',
        title: '[S] [M] Conflicting title tags',
        body: 'Plan: plan-first',
      },
    });

    const rOk = sbx.runAdopt(['--task', '01M7BODYSIZE00000000000001', '--session-id', 'sid-body-size']);
    assert.equal(rOk.status, 0, `stderr: ${rOk.stderr}`);
    const mOk = sbx.readMarker('sid-body-size');
    assert.equal(mOk.wo_state, 'resolved');
    assert.equal(mOk.wo_size, 'M');
    assert.equal(mOk.size, 'M');
    assert.equal(mOk.wo_plan, 'plan-first');
    assert.equal(mOk.stage, 'plan');

    const rConflict = sbx.runAdopt(['--task', '01M7TITLECONFLICT000000002', '--session-id', 'sid-title-conflict']);
    assert.equal(rConflict.status, 2);
    const mConflict = sbx.readMarker('sid-title-conflict');
    assert.equal(mConflict.wo_state, 'unresolved');
    assert.equal(mConflict.wo_size, null);
    assert.equal(mConflict.stage, undefined);
  } finally {
    sbx.cleanup();
  }
});

test('negative control: session-mode.js set --fleet-task with a title lacking any size stores wo_state=unresolved (never resolved with wo_size=null)', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7SMNOSIZE00000000000001': {
        id: '01M7SMNOSIZE00000000000001',
        title: 'Investigate intermittent timeout in worker pool\nPlan: plan-first',
      },
    });

    const res = sbx.runSessionMode([
      'set',
      '--fleet-task',
      '01M7SMNOSIZE00000000000001',
      '--session-id',
      'sid-sm-nosize',
    ]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const marker = sbx.readMarker('sid-sm-nosize');
    assert.ok(marker);
    assert.equal(marker.fleet_task_id, '01M7SMNOSIZE00000000000001');
    assert.equal(marker.wo_task, '01M7SMNOSIZE00000000000001');
    assert.equal(marker.wo_size, null);
    assert.equal(marker.wo_state, 'unresolved');
  } finally {
    sbx.cleanup();
  }
});

test('negative control: title without SizeTag writes wo_state=unresolved, prints one stderr line, exits 2, does not call stage-advance', () => {
  const sbx = makeSandbox();
  try {
    sbx.setTasks({
      '01M7NOSIZE0000000000000001': {
        id: '01M7NOSIZE0000000000000001',
        title: 'Investigate intermittent timeout in worker pool',
      },
    });

    const res = sbx.runAdopt(['--task', '01M7NOSIZE0000000000000001', '--session-id', 'sid-nosize']);
    assert.equal(res.status, 2);
    const stderrLines = res.stderr.split('\n').filter((l) => l.length > 0);
    assert.equal(stderrLines.length, 1, `expected exactly 1 stderr line, got: ${JSON.stringify(stderrLines)}`);

    const marker = sbx.readMarker('sid-nosize');
    assert.ok(marker, 'expected unresolved marker to be written');
    assert.equal(marker.fleet_task_id, '01M7NOSIZE0000000000000001');
    assert.equal(marker.wo_task, '01M7NOSIZE0000000000000001');
    assert.equal(marker.wo_size, null);
    assert.equal(marker.wo_state, 'unresolved');
    assert.equal(marker.stage, undefined, 'stage-advance must NOT have been called');

    const calls = sbx.readFleetCalls();
    const stageUpdates = calls.filter((c) => c[0] === 'task' && c[1] === 'update');
    assert.equal(stageUpdates.length, 0, 'stage-advance progress must NOT be emitted');
  } finally {
    sbx.cleanup();
  }
});

test('degrade & warn: stub exits 3 or sleeps past 1.5s timeout -> exit 0, one warning line, marker unchanged', () => {
  const sbx = makeSandbox();
  try {
    // 1) No prior marker + stub exits 3 -> exit 0, marker remains absent
    const rExit3Absent = sbx.runAdopt(
      ['--task', '01M7UNREACHABLE00000000001', '--session-id', 'sid-deg'],
      { TEST_FLEET_MODE: 'exit3' },
    );
    assert.equal(rExit3Absent.status, 0);
    const warnLines1 = rExit3Absent.stderr.split('\n').filter(Boolean);
    assert.equal(warnLines1.length, 1, `expected 1 warning line, got: ${JSON.stringify(warnLines1)}`);
    assert.equal(sbx.readMarker('sid-deg'), null);

    // 2) Seed a valid marker, then stub sleeps past 1.5s timeout -> exit 0, marker bytes unchanged
    sbx.setTasks({
      '01M7SEED000000000000000001': {
        id: '01M7SEED000000000000000001',
        title: '[S] Seeded task',
      },
    });
    const rSeed = sbx.runAdopt(['--task', '01M7SEED000000000000000001', '--session-id', 'sid-seeded']);
    assert.equal(rSeed.status, 0);
    const markerPath = path.join(sbx.markerDir, 'sid-seeded.json');
    const snapshotBefore = fs.readFileSync(markerPath, 'utf8');

    const t0 = Date.now();
    const rTimeout = sbx.runAdopt(
      ['--task', '01M7TIMEOUT000000000000002', '--session-id', 'sid-seeded'],
      { TEST_FLEET_MODE: 'sleep' },
    );
    const elapsedMs = Date.now() - t0;
    assert.equal(rTimeout.status, 0);
    assert.ok(elapsedMs < 2900, `expected 1.5s timeout to cut off 3s sleep; took ${elapsedMs}ms`);
    const warnLines2 = rTimeout.stderr.split('\n').filter(Boolean);
    assert.equal(warnLines2.length, 1, `expected 1 warning line on timeout, got: ${JSON.stringify(warnLines2)}`);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), snapshotBefore, 'marker must remain byte-identical');
  } finally {
    sbx.cleanup();
  }
});

test('negative control: refuses inherited parent session id without explicit --session-id (exit 3)', () => {
  const sbx = makeSandbox();
  try {
    const res = sbx.runAdopt(['--task', '01M7PARENT0000000000000001'], {
      AUTOPILOT_PARENT_SESSION_ID: 'parent-sid',
      AUTOPILOT_SESSION_ID: 'parent-sid',
    });
    assert.equal(res.status, 3);
    assert.equal(sbx.readMarker('parent-sid'), null);
  } finally {
    sbx.cleanup();
  }
});
