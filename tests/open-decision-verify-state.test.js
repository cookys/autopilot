'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'open-decision.js');
const { triage } = require(path.join(REPO_ROOT, 'scripts', 'card-triage.js'));

function setupSandbox(fleetConfig = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-verify-state-'));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  const fleetBin = path.join(dir, 'fake-fleet');
  const stateFile = path.join(dir, 'fleet-state.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });

  const initialState = {
    whoami: 'ns/courier/requester-1',
    verifyExit: 0,
    sendExit: 0,
    sendStdout: null,
    seq: 0,
    ...fleetConfig,
  };
  fs.writeFileSync(stateFile, JSON.stringify(initialState));

  fs.writeFileSync(
    fleetBin,
    `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const state = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
const [cmd, to, text] = process.argv.slice(2);
if (cmd === 'whoami') {
  process.stdout.write(state.whoami + '\\n');
  process.exit(0);
}
if (cmd === 'verify') {
  if (state.verifyExit !== 0) {
    process.stderr.write('simulated verify failure\\n');
    process.exit(state.verifyExit);
  }
  process.stdout.write(JSON.stringify({ ok: true }) + '\\n');
  process.exit(0);
}
if (cmd === 'send') {
  if (state.sendStdout !== null && state.sendStdout !== undefined) {
    process.stdout.write(state.sendStdout + '\\n');
    process.exit(state.sendExit || 0);
  }
  if (state.sendExit !== 0) {
    process.stderr.write('simulated send failure\\n');
    process.exit(state.sendExit);
  }
  state.seq += 1;
  fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(state));
  process.stdout.write(JSON.stringify({ ok: true, message_id: 'msg-' + state.seq, to, text }) + '\\n');
  process.exit(0);
}
process.exit(2);
`,
    { mode: 0o755 }
  );

  const env = {
    ...process.env,
    HOME: home,
    FLEET_BIN: fleetBin,
    AUTOPILOT_FLEET_BIN: fleetBin,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_CARD_NOTIFY: 'off',
    CLAUDE_CODE_SESSION_ID: '',
    AUTOPILOT_SESSION_ID: '',
    AUTOPILOT_ROOT_RUN_ID: '',
  };

  return { dir, home, repo, env, stateFile };
}

function runCli(args, { repo, env }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: repo,
    encoding: 'utf8',
    env,
  });
}

function readCards(repo, env) {
  const r = runCli(['show', '--all', '--json', '--cwd', repo], { repo, env });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).decisions;
}

function scopeFileOf(repo) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repo, encoding: 'utf8' }).trim();
  const absCommon = path.resolve(repo, common);
  const decDir = path.join(absCommon, 'autopilot', 'decisions');
  const files = fs.readdirSync(decDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'expected scope file in ' + decDir);
  return path.join(decDir, files[0]);
}

const VERIFY_FAILED_CASES = [
  // The `verify` subcommand exit codes (7/9/10/11/12/13) are covered by hooks/tests/open-decision-verify.test.sh; deliverAnswer only calls `send`.
  {
    name: 'send returns {ok:false}',
    fleetConfig: { sendStdout: JSON.stringify({ ok: false, error: 'courier_unreachable' }), sendExit: 0 },
  },
  {
    name: 'send returns {ok:true} without message_id',
    fleetConfig: { sendStdout: JSON.stringify({ ok: true }), sendExit: 0 },
  },
  {
    name: 'send returns non-JSON output',
    fleetConfig: { sendStdout: 'not-json-output', sendExit: 0 },
  },
];

VERIFY_FAILED_CASES.forEach((tc, idx) => {
  test(`T5b (1) verify_failed state machine: ${tc.name}`, () => {
    const { dir, repo, env } = setupSandbox(tc.fleetConfig);
    try {
      const openRes = runCli([
        'open',
        '--cwd', repo,
        '--category', 'goal',
        '--title', `核實失敗 ${idx + 1}？`,
        '--question', `第 ${idx + 1} 組核實失敗是否仍待處理？`,
        '--option', '繼續::照計畫',
        '--option', '暫停::先停',
        '--recommendation', '繼續',
        '--not-authorized', 'goal-change:need owner',
        '--executor', 'ns/courier/exec-1',
        '--json',
      ], { repo, env });
      assert.ok(openRes.status === 0 || openRes.status === 5, openRes.stderr);
      const cardId = JSON.parse(openRes.stdout).id;
      assert.match(cardId, /^d-[0-9a-f]{8}$/);

      const { deliverAnswer } = require(SCRIPT);
      process.env.FLEET_BIN = env.FLEET_BIN;
      process.env.AUTOPILOT_FLEET_BIN = env.AUTOPILOT_FLEET_BIN;

      const scopeFile = scopeFileOf(repo);
      deliverAnswer(scopeFile, cardId, {
        answer_id: 'ans-1',
        answer: { option: '繼續', free_text: null },
      });

      const afterFirst = readCards(repo, env).find((c) => c.id === cardId);
      assert.equal(afterFirst.status, 'pending_dispatch');
      assert.notEqual(afterFirst.status, 'closed');
      assert.ok(afterFirst.dispatch_error, 'dispatch_error should be written');
      assert.equal(afterFirst.dispatch_attempts, 1);

      deliverAnswer(scopeFile, cardId, {
        answer_id: 'ans-1',
        answer: { option: '繼續', free_text: null },
      });

      const afterSecond = readCards(repo, env).find((c) => c.id === cardId);
      assert.equal(afterSecond.status, 'pending_dispatch');
      assert.notEqual(afterSecond.status, 'closed');
      assert.ok(afterSecond.dispatch_error, 'dispatch_error should remain set');
      assert.equal(afterSecond.dispatch_attempts, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const REASK_FIXTURES = [
  {
    category: 'authority',
    question: '是否授權合併 PR #101？',
    executor: 'ns/courier/pm-1',
    answer: 'yes',
  },
  {
    category: 'goal',
    question: '是否延後 M2 上線日？',
    executor: 'ns/courier/pm-2',
    answer: 'no',
  },
  {
    category: 'money',
    question: '是否加購測試叢集配額？',
    executor: 'ns/courier/ops-1',
    answer: 'yes',
  },
  {
    category: 'presence',
    question: '是否對外發布 119 分型公告？',
    executor: 'ns/courier/comms-1',
    answer: 'no',
  },
];

for (let i = 0; i < REASK_FIXTURES.length; i += 1) {
  const fx = REASK_FIXTURES[i];
  test(`T5b (2) re-ask guard #${i + 1}: closed card refuses reopen with exit 15`, () => {
    const { dir, repo, env } = setupSandbox();
    try {
      const openArgs = [
        'open',
        '--cwd', repo,
        '--category', fx.category,
        '--title', fx.question,
        '--question', fx.question,
        '--option', 'yes::同意',
        '--option', 'no::拒絕',
        '--recommendation', fx.answer,
        '--not-authorized', 'goal-change:owner only',
        '--executor', fx.executor,
        ...(['identity', 'presence'].includes(fx.category) ? ['--operator-step-none', 'test fixture: the card only asks for a yes or no'] : []),
        '--json',
      ];
      const r1 = runCli(openArgs, { repo, env });
      assert.equal(r1.status, 0, r1.stderr);
      const cardId = JSON.parse(r1.stdout).id;

      const rc = runCli(['close', '--id', cardId, '--answer', fx.answer, '--cwd', repo], { repo, env });
      assert.equal(rc.status, 0, rc.stderr);

      const rd = runCli(['close', '--id', cardId, '--dispatched', `task-${i + 1}`, '--cwd', repo], { repo, env });
      assert.equal(rd.status, 0, rd.stderr);

      const countBefore = readCards(repo, env).length;

      const r2 = runCli(openArgs, { repo, env });
      assert.equal(r2.status, 15, `expected exit 15, got ${r2.status}: ${r2.stderr}`);
      assert.equal(readCards(repo, env).length, countBefore, 'must not write a new card');

      const parsed = JSON.parse(r2.stdout);
      assert.equal(parsed.id, cardId);
      assert.equal(parsed.status, 'closed');
      assert.equal(parsed.answer, fx.answer);
      assert.ok(r2.stderr.includes(fx.answer), 'stderr should include original answer');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('T5b (3) visibility incident: two not_shown occurrences and independent delivery/visibility', () => {
  const openCard = {
    id: 'd-vis00001',
    status: 'open',
    cwd: '/tmp/repo-a',
  };

  const first = triage({ card: openCard, visibleIds: ['d-other001'] });
  const second = triage({ card: openCard, visibleIds: [] });

  assert.equal(first.visibility, 'not_shown');
  assert.equal(first.delivery, 'n/a');
  assert.equal(first.ok, false);

  assert.equal(second.visibility, 'not_shown');
  assert.equal(second.delivery, 'n/a');
  assert.equal(second.ok, false);

  const visibleButFailedDelivery = triage({
    card: { ...openCard, dispatch_error: 'verify_failed: exit 7' },
    visibleIds: ['d-vis00001'],
  });
  assert.equal(visibleButFailedDelivery.visibility, 'visible');
  assert.equal(visibleButFailedDelivery.delivery, 'dispatch_failed');
  assert.equal(visibleButFailedDelivery.ok, false);

  const bothBroken = triage({
    card: { ...openCard, dispatch_error: 'courier_unreachable' },
    visibleIds: [],
  });
  assert.equal(bothBroken.visibility, 'not_shown');
  assert.equal(bothBroken.delivery, 'dispatch_failed');
  assert.equal(bothBroken.ok, false);
});
