'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { evaluateAccept, extractReceipt } = require('../finish-triage.js');

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function createSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-triage-accept-'));
  const repoDir = path.join(dir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });

  execFileSync('git', ['-C', repoDir, 'init'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });

  fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\n', 'utf8');
  execFileSync('git', ['-C', repoDir, 'add', 'README.md'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoDir, 'commit', '-m', 'init'], { stdio: 'ignore' });

  const sha = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sha16 = sha.slice(0, 16);

  // Create valid Used: command artifact
  const usedFile = path.join(dir, 'used-cmd.log');
  const outputBlock = `line 1\nverified sha=${sha16}\nline 3`;
  const outSha = sha256Hex(outputBlock);
  fs.writeFileSync(
    usedFile,
    `cmd: echo ok\nrc=0\nout-sha256: ${outSha}\n${outputBlock}\n`,
    'utf8'
  );

  // Create fake fleet binary
  const fleetBin = path.join(dir, 'fake-fleet');
  const taskJsonPath = path.join(dir, 'task.json');
  fs.writeFileSync(
    fleetBin,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'task' && args[1] === 'show') {
  process.stdout.write(fs.readFileSync(${JSON.stringify(taskJsonPath)}, 'utf8'));
  process.exit(0);
}
process.exit(1);
`,
    { mode: 0o755 }
  );

  return {
    dir,
    repoDir,
    sha,
    sha16,
    usedFile,
    fleetBin,
    taskJsonPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('merged + live/pinned + complete receipt -> complete', (t) => {
  const sb = createSandbox();
  t.after(() => sb.cleanup());

  const result = evaluateAccept({
    task: 'TASK-001',
    sha: sb.sha,
    repo: sb.repoDir,
    target: 'prod-pane',
    testCount: 12,
    taskObj: {
      comments: [
        {
          text: [
            `Pinned: prod-host ${sb.sha16}`,
            `Used: command ${sb.usedFile}`,
          ].join('\n'),
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.completed, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.waiting_on, null);
  assert.equal(result.receipt.complete, true);
  assert.equal(result.receipt.commit, sb.sha);
  assert.equal(result.receipt.target, 'prod-pane');
  assert.equal(result.receipt.test_count, 12);
  assert.deepEqual(result.receipt.missing_fields, []);
  assert.equal(result.rows.merged.ok, true);
  assert.equal(result.rows.merged.status, 'merged');
  assert.equal(result.rows.live.ok, true);
  assert.equal(result.rows.live.status, 'live');
});

test('codeforge pane replay: merged but not live/pinned -> incomplete with waiting_on', (t) => {
  const sb = createSandbox();
  t.after(() => sb.cleanup());

  const result = evaluateAccept({
    task: 'TASK-CODEFORGE-1',
    sha: sb.sha,
    repo: sb.repoDir,
    target: 'codeforge-pane',
    testCount: 8,
    taskObj: {
      comments: [
        {
          text: `Used: command ${sb.usedFile}`,
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.completed, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.waiting_on, 'live_pin');
  assert.equal(result.rows.merged.ok, true);
  assert.equal(result.rows.merged.status, 'merged');
  assert.equal(result.rows.live.ok, false);
  assert.equal(result.rows.live.status, 'not_live');
});

test('missing commit / target / test_count -> incomplete_receipt', (t) => {
  const sb = createSandbox();
  t.after(() => sb.cleanup());

  const missingCommit = extractReceipt('Target: codeforge\nTests: 5\n', {});
  assert.equal(missingCommit.complete, false);
  assert.ok(missingCommit.missing_fields.includes('commit'));

  const missingTarget = extractReceipt(`Commit: ${sb.sha}\nTests: 5\n`, { commit: sb.sha });
  assert.equal(missingTarget.complete, false);
  assert.ok(missingTarget.missing_fields.includes('target'));

  const missingTests = extractReceipt(`Commit: ${sb.sha}\nTarget: codeforge\n`, {
    commit: sb.sha,
    target: 'codeforge',
  });
  assert.equal(missingTests.complete, false);
  assert.ok(missingTests.missing_fields.includes('test_count'));

  const acceptMissing = evaluateAccept({
    task: 'TASK-002',
    sha: sb.sha,
    repo: sb.repoDir,
    taskObj: {
      comments: [{ text: `Pinned: prod-host ${sb.sha16}\nUsed: command ${sb.usedFile}` }],
    },
  });
  assert.equal(acceptMissing.ok, false);
  assert.equal(acceptMissing.status, 'incomplete_receipt');
  assert.equal(acceptMissing.waiting_on, 'receipt');
  assert.equal(acceptMissing.receipt.complete, false);
});

test('planSnapshot placeholder interface supplies target and test_count', (t) => {
  const sb = createSandbox();
  t.after(() => sb.cleanup());

  const result = evaluateAccept({
    task: 'TASK-003',
    sha: sb.sha,
    repo: sb.repoDir,
    readPlanSnapshot: () => ({ target: 'snapshot-pane', test_count: 19 }),
    taskObj: {
      comments: [{ text: `Pinned: prod-host ${sb.sha16}\nUsed: command ${sb.usedFile}` }],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.plan_snapshot.loaded, true);
  assert.equal(result.receipt.target, 'snapshot-pane');
  assert.equal(result.receipt.test_count, 19);
});

test('CLI --accept --json works with fake fleet binary', (t) => {
  const sb = createSandbox();
  t.after(() => sb.cleanup());

  fs.writeFileSync(
    sb.taskJsonPath,
    JSON.stringify({
      id: 'TASK-CLI-1',
      comments: [{ text: `Pinned: prod-host ${sb.sha16}\nUsed: command ${sb.usedFile}` }],
    }),
    'utf8'
  );

  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, '..', 'finish-triage.js'),
      '--accept',
      '--task',
      'TASK-CLI-1',
      '--sha',
      sb.sha,
      '--repo',
      sb.repoDir,
      '--target',
      'cli-pane',
      '--test-count',
      '4',
      '--json',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, FINISH_TRIAGE_FLEET_BIN: sb.fleetBin },
    }
  );

  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status, 'complete');
  assert.equal(parsed.rows.merged.ok, true);
  assert.equal(parsed.rows.live.ok, true);
});
