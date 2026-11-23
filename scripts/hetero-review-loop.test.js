'use strict';

require('./lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const LOOP_SCRIPT = path.join(__dirname, 'hetero-review-loop.js');

function withTempRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hetero-loop-sf-'));
  const run = (cmd, args) => {
    const res = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`${cmd} ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
    }
    return res.stdout.trim();
  };
  try {
    run('git', ['init']);
    run('git', ['config', 'user.email', 'test@example.com']);
    run('git', ['config', 'user.name', 'Test User']);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'v1\n');
    run('git', ['add', 'file.txt']);
    run('git', ['commit', '-m', 'base']);
    const baseSha = run('git', ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'file.txt'), 'v2\n');
    run('git', ['add', 'file.txt']);
    run('git', ['commit', '-m', 'head']);

    const ledgerDir = path.join(dir, '.ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });

    const dispatchStub = path.join(dir, 'dispatch-stub.sh');
    fs.writeFileSync(dispatchStub, [
      '#!/usr/bin/env bash',
      'echo \'{"status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"checked"}\'',
      '',
    ].join('\n'));
    fs.chmodSync(dispatchStub, 0o755);

    return fn({ dir, baseSha, ledgerDir, dispatchStub });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCollect({ dir, baseSha, ledgerDir, dispatchStub, phase, extraArgs = [] }) {
  return spawnSync(
    process.execPath,
    [
      LOOP_SCRIPT,
      'collect',
      '--phase', phase,
      '--generation', '1',
      '--branch', 'HEAD',
      '--phase-base', baseSha,
      '--repo-root', dir,
      '--ledger-dir', ledgerDir,
      '--implementer-engine', 'claude-sonnet-4-6',
      '--fleet-task', '01M80G8NR1KYG7ZVK5KJA80YX3',
      ...extraArgs,
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        AUTOPILOT_DISPATCH_REVIEW_SCRIPT: dispatchStub,
      },
    },
  );
}

test('(a) --seats with two seats of one family is refused with same_family_vote, exit 2, and nothing dispatched', () => {
  withTempRepo((ctx) => {
    const res = runCollect({
      ...ctx,
      phase: 'p-a',
      extraArgs: ['--seats', 'gpt-5.6-sol/max@codex,gpt-5.4/high@codex'],
    });
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, /same_family_vote/);
    assert.equal(fs.existsSync(path.join(ctx.ledgerDir, 'review-p-a', 'g1')), false);
  });
});

test('(b) resolver qc-panel branch with two seats of one family is refused with same_family_vote and exit 2', () => {
  withTempRepo((ctx) => {
    const scriptsDir = path.join(ctx.dir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    const resolverStub = path.join(scriptsDir, 'resolve-qc-gate.sh');
    fs.writeFileSync(resolverStub, [
      '#!/usr/bin/env bash',
      'cat <<\'JSON\'',
      '{"qc_panel_seats_complete":true,"qc_panel_seats":[{"runner":"codex","model":"gpt-5.6-sol","effort":"max"},{"runner":"codex","model":"gpt-5.4","effort":"high"}]}',
      'JSON',
      '',
    ].join('\n'));
    fs.chmodSync(resolverStub, 0o755);

    const res = runCollect({ ...ctx, phase: 'p-b' });
    assert.equal(res.status, 2, `expected exit 2, got ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, /same_family_vote/);
    assert.equal(fs.existsSync(path.join(ctx.ledgerDir, 'review-p-b', 'g1')), false);
  });
});

test('(c) mixed-family panel via --seats is accepted', () => {
  withTempRepo((ctx) => {
    const res = runCollect({
      ...ctx,
      phase: 'p-c',
      extraArgs: ['--seats', 'gpt-5.6-sol/max@codex,grok-4.7/high@grok'],
    });
    assert.notEqual(res.status, 2, `did not expect exit 2 same_family_vote refusal: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /same_family_vote/);
  });
});

test('(d) --allow-same-family lets same-family --seats through with stderr warning', () => {
  withTempRepo((ctx) => {
    const res = runCollect({
      ...ctx,
      phase: 'p-d',
      extraArgs: ['--seats', 'gpt-5.6-sol/max@codex,gpt-5.4/high@codex', '--allow-same-family'],
    });
    assert.notEqual(res.status, 2, `did not expect exit 2 same_family_vote refusal: ${res.stderr}`);
    assert.match(res.stderr, /hetero-review-loop: warning: same_family_vote:/);
  });
});
