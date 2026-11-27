'use strict';

/**
 * plan-receipt.test.js
 *
 * Case "a" goes red if the hook's action is removed (no finish-triage run, no
 * comment). Every fleet call goes to a stub; no real task is touched.
 *
 * Sandbox: HOME and XDG_STATE_HOME point at the temp dir. Git config is isolated
 * (GIT_CONFIG_GLOBAL=/dev/null, GIT_CONFIG_NOSYSTEM=1) with a local identity.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { TIMEOUTS_MS } = require('./plan-receipt');

const HOOK = path.resolve(__dirname, 'plan-receipt.js');
const TASK = '01M88T3C4H0M9SMGP7WX0T2708';
const BOGUS = 'abcdef012';
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function gitIn(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...GIT_ENV },
  }).trim();
}

function makeRepo(dir, subjects) {
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'config', 'user.name', 'test');
  gitIn(dir, 'config', 'user.email', 'test@example.invalid');
  return subjects.map((s) => {
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', `${path.basename(dir)} ${s}`);
    return gitIn(dir, 'rev-parse', 'HEAD');
  });
}

// projects/pm (the hook cwd, holds `local`) and projects/code (holds old, new).
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-receipt-'));
  const home = path.join(root, 'home');
  const state = path.join(root, 'state');
  fs.mkdirSync(home);
  fs.mkdirSync(state);
  const pm = path.join(root, 'projects', 'pm');
  const code = path.join(root, 'projects', 'code');
  const [local] = makeRepo(pm, ['local']);
  const [older, newer] = makeRepo(code, ['older', 'newer']);
  const fleet = path.join(root, 'fleet');
  const triage = path.join(root, 'triage.js');
  const taskFile = path.join(root, 'task.json');
  const triageLog = path.join(root, 'triage.log');
  const commentLog = path.join(root, 'comment.log');
  const fleetLog = path.join(root, 'fleet.log');
  const audit = path.join(state, 'autopilot', 'plan-receipt-audit.jsonl');
  fs.writeFileSync(fleet, `#!/bin/sh
printf '%s %s %s\\n' "$1" "$2" "$3" >> "$FLEET_LOG"
if [ "$2" = show ]; then cat "$TASK_JSON"; exit 0; fi
if [ "$2" = comment ]; then printf '%s\\n' "$4" >> "$COMMENT_LOG"; exit "\${COMMENT_RC:-0}"; fi
exit 9
`);
  fs.chmodSync(fleet, 0o755);
  fs.writeFileSync(triage, `'use strict';
const fs = require('fs');
fs.appendFileSync(process.env.TRIAGE_LOG, process.argv.slice(2).join(' ') + '\\n');
process.stdout.write(process.env.TRIAGE_OUT);
process.exit(Number(process.env.TRIAGE_RC));
`);
  const env = {
    ...process.env,
    ...GIT_ENV,
    HOME: home,
    XDG_STATE_HOME: state,
    PLAN_RECEIPT_AUDIT: audit,
    FINISH_TRIAGE_FLEET_BIN: fleet,
    PLAN_RECEIPT_TRIAGE_JS: triage,
    TRIAGE_LOG: triageLog,
    TRIAGE_RC: '0',
    TRIAGE_OUT: JSON.stringify({
      status: 'complete',
      waiting_on: null,
      receipt: { test_count: 4, target: 'e2e' },
      rows: { merged: { ok: true }, live: { ok: true } },
      cells: { used: { ok: true } },
    }),
    COMMENT_LOG: commentLog,
    FLEET_LOG: fleetLog,
    TASK_JSON: taskFile,
  };
  return {
    root, env, pm, code, local, older, newer, triageLog, commentLog, fleetLog, audit, taskFile,
  };
}

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '');
const short = (sha) => sha.slice(0, 9);

function planTask(extra) {
  return { title: 'Plan: plans/p.md Phase: P1', comments: [], journal: [], ...extra };
}

function run(box, task, { accept = true, cwd = box.pm } = {}) {
  fs.writeFileSync(box.taskFile, JSON.stringify(task));
  for (const f of [box.triageLog, box.commentLog, box.fleetLog, box.audit]) fs.rmSync(f, { force: true });
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'mcp__fleet__task_accept',
      cwd,
      tool_input: { task_id: TASK, accept, note: 'ok' },
      tool_response: { ok: true },
    }),
    encoding: 'utf8',
    env: box.env,
    cwd: box.root,
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
}

function assertTriaged(box, sha, repo) {
  assert.equal(read(box.triageLog), `--task ${TASK} --sha ${sha} --accept --repo ${repo} --json`);
}

function assertAudit(box, reason) {
  const lines = read(box.audit).split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]);
  assert.equal(row.task, TASK);
  assert.equal(row.reason, reason);
}

test('a: a 9-char sha resolves in a sibling repo and one receipt comment is posted', () => {
  const box = sandbox();
  run(box, planTask({ result: `merge ${short(box.newer)}`, progress: `merge ${short(box.newer)}` }));
  assertTriaged(box, box.newer, box.code);
  assert.equal(read(box.commentLog), 'receipt (finish-triage): status=complete waiting_on=none '
    + `commit=${box.newer} merged=PASS live=PASS used=PASS test_count=4 target=e2e`);
  assert.equal(read(box.audit), '');
  assert.doesNotMatch(read(box.fleetLog), /task accept/);
});

test('a: the cwd repo is searched before the siblings', () => {
  const box = sandbox();
  run(box, planTask({ result: `merge ${short(box.local)}` }));
  assertTriaged(box, box.local, box.pm);
});

test('evidence is ordered by time; pieces without a resolvable sha are skipped', () => {
  const box = sandbox();
  const at = (ms) => new Date(ms).toISOString();
  const task = (commentAt) => planTask({
    result: `merge ${short(box.older)}`,
    journal: [{ kind: 'result', at_ms: 2000, text: `merge ${short(box.older)}` }],
    comments: [{ at: at(commentAt), text: `fixed in ${short(box.newer)}` }],
  });
  run(box, task(3000));
  assertTriaged(box, box.newer, box.code);
  run(box, task(1000));
  assertTriaged(box, box.older, box.code);

  run(box, planTask({
    journal: [{ kind: 'progress', at_ms: 1000, text: `merge ${short(box.newer)}` }],
    comments: [{ at: at(5000), text: `no commit here, only ${BOGUS} and msg 5e9df2dd` }],
  }));
  assertTriaged(box, box.newer, box.code);
});

test('within a piece the last resolvable sha wins', () => {
  const box = sandbox();
  run(box, planTask({ result: `merge ${short(box.older)}, then ${short(box.newer)}, log ${BOGUS}` }));
  assertTriaged(box, box.newer, box.code);
});

test('b: accept=false and a task without Plan/Phase run nothing', () => {
  const box = sandbox();
  run(box, planTask({ result: box.newer }), { accept: false });
  assert.equal(read(box.fleetLog), '');
  assert.equal(read(box.triageLog), '');

  run(box, { title: 'plain chore', result: box.newer });
  assert.equal(read(box.triageLog), '');
  assert.equal(read(box.commentLog), '');
  assert.equal(read(box.audit), '');
});

test('no resolvable sha (the title sha is never read) writes one audit line', () => {
  const box = sandbox();
  run(box, planTask({
    title: `Plan: plans/p.md@${short(box.newer)} Phase: P1`,
    result: `done, see ${BOGUS}`,
  }));
  assert.equal(read(box.triageLog), '');
  assert.equal(read(box.commentLog), '');
  assertAudit(box, 'no_sha');
});

test('exit 1 with a result is a receipt, not a failure', () => {
  const box = sandbox();
  box.env.TRIAGE_RC = '1';
  box.env.TRIAGE_OUT = JSON.stringify({
    status: 'incomplete', waiting_on: 'live_pin', rows: { merged: { ok: true }, live: { ok: false } },
  });
  run(box, planTask({ result: box.newer }));
  assert.equal(read(box.commentLog), 'receipt (finish-triage): status=incomplete waiting_on=live_pin '
    + `commit=${box.newer} merged=PASS live=FAIL used=FAIL test_count=none target=none`);
  assert.equal(read(box.audit), '');
});

test('c: no parseable result writes exactly one audit line and no comment', () => {
  const box = sandbox();
  box.env.TRIAGE_RC = '1';
  box.env.TRIAGE_OUT = 'Error: boom';
  run(box, planTask({ result: box.newer }));
  assert.equal(read(box.commentLog), '');
  assertAudit(box, 'finish_triage');
});

test('c: a failing comment writes exactly one audit line', () => {
  const box = sandbox();
  box.env.COMMENT_RC = '3';
  run(box, planTask({ result: box.newer }));
  assertAudit(box, 'fleet_comment');
});

test('an oversized receipt is cut to 4000 bytes', () => {
  const box = sandbox();
  box.env.TRIAGE_OUT = JSON.stringify({ status: 'complete', receipt: { target: '標'.repeat(3000) } });
  run(box, planTask({ result: box.newer }));
  const text = read(box.commentLog);
  assert.ok(Buffer.byteLength(text) <= 4000);
  assert.doesNotMatch(text, /�/);
});

test('the real finish-triage produces a posted receipt', () => {
  const box = sandbox();
  delete box.env.PLAN_RECEIPT_TRIAGE_JS;
  run(box, planTask({ result: `merge ${short(box.newer)}\nTarget: e2e\nTests: 4` }));
  assert.equal(read(box.commentLog), 'receipt (finish-triage): status=incomplete waiting_on=live_pin '
    + `commit=${box.newer} merged=PASS live=FAIL used=FAIL test_count=4 target=e2e`);
  assert.equal(read(box.audit), '');
});

test('child timeouts fit inside the hooks.json timeout', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'));
  const entry = config.hooks.PostToolUse.flatMap((m) => m.hooks)
    .find((h) => h.command.includes('plan-receipt.js'));
  const children = Object.values(TIMEOUTS_MS).reduce((a, b) => a + b, 0);
  assert.ok(children + 3000 <= entry.timeout * 1000, `${children}ms vs ${entry.timeout}s`);
});
