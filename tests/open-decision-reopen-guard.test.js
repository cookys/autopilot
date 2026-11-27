#!/usr/bin/env node
'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'open-decision.js');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'od-reopen-guard-'));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  return { root, home, repo };
}

function runCli(args, { cwd, home }) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
      AUTOPILOT_CARD_NOTIFY: 'off',
      CLAUDE_CODE_SESSION_ID: '',
      AUTOPILOT_SESSION_ID: '',
      AUTOPILOT_ROOT_RUN_ID: '',
    },
  });
}

function openCard(sb, extraArgs = []) {
  return runCli([
    'open',
    '--category', 'authority',
    '--title', '要改授權嗎？',
    '--question', '要改授權嗎？',
    '--option', 'yes::同意',
    '--option', 'no::拒絕',
    '--recommendation', 'yes',
    '--not-authorized', 'goal-change:owner only',
    '--executor', 'ns/courier/pm',
    '--cwd', sb.repo,
    '--json',
    ...extraArgs,
  ], sb);
}

// 1. Closed card reopened with same question -> refused (exit 15) with id, status, answer, closed_at
{
  const sb = makeSandbox();
  try {
    const r1 = openCard(sb);
    assert.strictEqual(r1.status, 0, `expected initial open 0, got ${r1.status}: ${r1.stderr}`);
    const opened = JSON.parse(r1.stdout);

    const rc = runCli(['close', '--id', opened.id, '--answer', 'yes', '--cwd', sb.repo], sb);
    assert.strictEqual(rc.status, 0, `close failed: ${rc.stderr}`);

    // pending_dispatch is also an answered state -> must be refused
    const rPending = openCard(sb);
    assert.strictEqual(rPending.status, 15, `expected exit 15 for pending_dispatch, got ${rPending.status}`);
    const jPending = JSON.parse(rPending.stdout);
    assert.strictEqual(jPending.id, opened.id);
    assert.strictEqual(jPending.status, 'pending_dispatch');
    assert.strictEqual(jPending.answer, 'yes');

    // Transition to closed
    const rd = runCli(['close', '--id', opened.id, '--dispatched', 'task-123', '--cwd', sb.repo], sb);
    assert.strictEqual(rd.status, 0, `dispatched close failed: ${rd.stderr}`);

    // Reopen with different whitespace/punctuation -> same normalized fingerprint -> refused
    const r2 = runCli([
      'open',
      '--category', 'authority',
      '--title', '  要改授權嗎?? ',
      '--question', '要改授權嗎？',
      '--option', 'yes::同意',
      '--option', 'no::拒絕',
      '--recommendation', 'yes',
      '--not-authorized', 'goal-change:owner only',
      '--executor', 'ns/courier/pm',
      '--cwd', sb.repo,
      '--json',
    ], sb);
    assert.strictEqual(r2.status, 15, `expected exit 15 for closed card, got ${r2.status}: ${r2.stderr}`);
    assert.ok(r2.stderr.includes(opened.id), 'stderr should include original id');
    assert.ok(r2.stderr.includes('yes'), 'stderr should include original answer');
    const j2 = JSON.parse(r2.stdout);
    assert.strictEqual(j2.ok, false);
    assert.strictEqual(j2.error, 'answered_duplicate');
    assert.strictEqual(j2.id, opened.id);
    assert.strictEqual(j2.status, 'closed');
    assert.strictEqual(j2.answer, 'yes');
    assert.ok(j2.closed_at, 'JSON output should include closed_at');

    // 2. Different category or different executor -> NOT blocked
    const rDiffCat = runCli([
      'open',
      '--category', 'goal',
      '--title', '要改授權嗎？',
      '--question', '要改授權嗎？',
      '--option', 'yes::同意',
      '--option', 'no::拒絕',
      '--recommendation', 'yes',
      '--not-authorized', 'goal-change:owner only',
      '--executor', 'ns/courier/pm',
      '--cwd', sb.repo,
      '--json',
    ], sb);
    assert.strictEqual(rDiffCat.status, 0, `different category should not be blocked: ${rDiffCat.stderr}`);

    const rDiffExec = runCli([
      'open',
      '--category', 'authority',
      '--title', '要改授權嗎？',
      '--question', '要改授權嗎？',
      '--option', 'yes::同意',
      '--option', 'no::拒絕',
      '--recommendation', 'yes',
      '--not-authorized', 'goal-change:owner only',
      '--executor', 'ns/courier/other',
      '--cwd', sb.repo,
      '--json',
    ], sb);
    assert.strictEqual(rDiffExec.status, 0, `different executor should not be blocked: ${rDiffExec.stderr}`);

    // 3. Negative control: --not-duplicate-of <answered-id> must NOT bypass answered-card guard
    const rBypass = openCard(sb, ['--not-duplicate-of', opened.id, '--not-duplicate-reason', 'trying to bypass']);
    assert.strictEqual(rBypass.status, 15, `--not-duplicate-of must not bypass answered-card guard, got ${rBypass.status}`);

    // 4. --supersede without reason or with wrong id -> refused
    const rNoReason = openCard(sb, ['--supersede', opened.id]);
    assert.notStrictEqual(rNoReason.status, 0, '--supersede without reason must fail');

    const rBlankReason = openCard(sb, ['--supersede', opened.id, '--supersede-reason', '   ']);
    assert.notStrictEqual(rBlankReason.status, 0, '--supersede with blank reason must fail');

    const rWrongId = openCard(sb, ['--supersede', 'd-00000000', '--supersede-reason', 'wrong id']);
    assert.strictEqual(rWrongId.status, 15, '--supersede with wrong id must still be refused');

  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

// 5. --supersede with matching id and non-empty reason -> allowed (own sandbox: no other live same-title cards)
{
  const sb = makeSandbox();
  try {
    const r1 = openCard(sb);
    assert.strictEqual(r1.status, 0, `initial open: ${r1.stderr}`);
    const opened = JSON.parse(r1.stdout);
    const rc = runCli(['close', '--id', opened.id, '--answer', 'yes', '--cwd', sb.repo], sb);
    assert.strictEqual(rc.status, 0, `close failed: ${rc.stderr}`);
    const rSupersede = openCard(sb, ['--supersede', opened.id, '--supersede-reason', 'scope changed']);
    assert.strictEqual(rSupersede.status, 0, `--supersede with valid id and reason should succeed: ${rSupersede.stderr}`);
    const jSup = JSON.parse(rSupersede.stdout);
    const showSup = runCli(['show', '--id', jSup.id, '--json', '--cwd', sb.repo], sb);
    assert.strictEqual(showSup.status, 0);
    const cardSup = JSON.parse(showSup.stdout).decisions[0];
    assert.strictEqual(cardSup.supersedes, opened.id);
    assert.strictEqual(cardSup.supersede_reason, 'scope changed');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

console.log('open-decision-reopen-guard.test.js: all assertions passed');
