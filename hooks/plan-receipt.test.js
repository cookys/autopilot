'use strict';

/**
 * plan-receipt.test.js
 *
 * (a) goes red if the hook's finish-triage spawn is removed: a Plan/Phase task
 * with accept=true leaves the triage log empty.
 * (b) accept=false, and a task with no Plan/Phase line, spawn nothing.
 * (c) a failing finish-triage still exits 0 and appends exactly one audit line.
 *
 * Sandbox: HOME and XDG_STATE_HOME point at the temp dir. Git config is isolated
 * (GIT_CONFIG_GLOBAL=/dev/null, GIT_CONFIG_NOSYSTEM=1) even though this file
 * does not create a repo.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, 'plan-receipt.js');
const TASK = '01M88T3C4H0M9SMGP7WX0T2708';
const OLD_SHA = '1111111111111111111111111111111111111111';
const NEW_SHA = '2222222222222222222222222222222222222222';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-receipt-'));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  const fleet = path.join(root, 'fleet');
  const triage = path.join(root, 'triage.js');
  const taskFile = path.join(root, 'task.json');
  const triageLog = path.join(root, 'triage.log');
  const audit = path.join(state, 'autopilot', 'plan-receipt-audit.jsonl');
  fs.writeFileSync(fleet, `#!/bin/sh
printf '%s\\n' "$*" >> "$TRIAGE_FLEET_LOG"
if [ "$1" = task ] && [ "$2" = show ]; then cat "$TASK_JSON"; exit 0; fi
# refuse a second accept
if [ "$1" = task ] && [ "$2" = accept ]; then echo second-accept >> "$TRIAGE_FLEET_LOG"; exit 9; fi
exit 0
`);
  fs.chmodSync(fleet, 0o755);
  fs.writeFileSync(triage, `'use strict';
const fs = require('fs');
const fail = process.env.TRIAGE_FAIL === '1';
fs.appendFileSync(process.env.TRIAGE_LOG, process.argv.slice(2).join(' ') + '\\n');
process.exit(fail ? 1 : 0);
`);
  const env = {
    ...process.env,
    HOME: home,
    XDG_STATE_HOME: state,
    PLAN_RECEIPT_AUDIT: audit,
    FINISH_TRIAGE_FLEET_BIN: fleet,
    PLAN_RECEIPT_TRIAGE_JS: triage,
    TRIAGE_LOG: triageLog,
    TRIAGE_FLEET_LOG: path.join(root, 'fleet.log'),
    TASK_JSON: taskFile,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    TRIAGE_FAIL: '0',
  };
  return { root, env, triageLog, audit, taskFile, fleetLog: env.TRIAGE_FLEET_LOG };
}

function writeTask(box, task) {
  fs.writeFileSync(box.taskFile, JSON.stringify(task));
}

function run(box, input) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: box.env,
    cwd: box.root,
  });
}

function payload(accept, extra = {}) {
  return {
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__fleet__task_accept',
    cwd: extra.cwd,
    tool_input: { task_id: TASK, accept, note: 'ok' },
    tool_response: { ok: true },
    ...extra,
  };
}

const planTask = {
  title: 'Plan: plans/p.md Phase: P1',
  body: '',
  status: 'accepted',
  comments: [{ text: `earlier ${OLD_SHA}` }],
  result_text: `merged ${NEW_SHA}`,
};

test('a: Plan/Phase + accept=true runs finish-triage with the sha from the last evidence piece', () => {
  const box = sandbox();
  writeTask(box, planTask);
  const res = run(box, payload(true, { cwd: box.root }));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  const log = fs.readFileSync(box.triageLog, 'utf8').trim();
  assert.equal(log, `--task ${TASK} --sha ${NEW_SHA} --accept --repo ${box.root}`);
  assert.equal(fs.existsSync(box.audit), false);
  const fleetLog = fs.readFileSync(box.fleetLog, 'utf8');
  assert.match(fleetLog, new RegExp(`task show ${TASK} --json`));
  assert.doesNotMatch(fleetLog, /task accept/);
});

test('b: accept=false and a task without Plan/Phase run nothing', () => {
  const box = sandbox();
  writeTask(box, planTask);
  const denied = run(box, payload(false));
  assert.equal(denied.status, 0);
  assert.equal(fs.existsSync(box.triageLog), false);

  writeTask(box, { title: 'plain chore', body: 'no markers', comments: [{ text: NEW_SHA }], result_text: NEW_SHA });
  const plain = run(box, payload(true));
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout, '');
  assert.equal(fs.existsSync(box.triageLog), false);
  assert.equal(fs.existsSync(box.audit), false);
});

test('c: failing finish-triage exits 0 and writes exactly one audit line', () => {
  const box = sandbox();
  box.env.TRIAGE_FAIL = '1';
  writeTask(box, planTask);
  const res = run(box, payload(true, { cwd: box.root }));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  const lines = fs.readFileSync(box.audit, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.task, TASK);
  assert.equal(row.reason, 'finish_triage');
});
