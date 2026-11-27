'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findSameFamilyVote, planSeatFamily } = require('../scripts/lib/review-family-gate');
const { checkSameFamilySeats } = require('../scripts/review-jury');

test('planSeatFamily + findSameFamilyVote refuses two openai/codex seats and accepts mixed', () => {
  const dupSeats = [
    { id: 'gpt1', runner: 'codex', model: 'gpt-6-astra' },
    { id: 'gpt2', runner: 'codex', model: 'gpt-5.6-sol' },
  ];
  const collision = findSameFamilyVote(dupSeats, planSeatFamily);
  assert.ok(collision);
  assert.equal(collision.family, 'openai');
  assert.equal(collision.first.id, 'gpt1');
  assert.equal(collision.second.id, 'gpt2');

  const mixedSeats = [
    { id: 'gpt1', runner: 'codex', model: 'gpt-6-astra' },
    { id: 'grok1', runner: 'grok', model: 'grok-4.7' },
  ];
  assert.equal(findSameFamilyVote(mixedSeats, planSeatFamily), null);
});

test('review-jury checkSameFamilySeats refuses duplicate family and warns with allowSameFamily', () => {
  const table = {
    gpt1: { family: 'openai' },
    gpt2: { family: 'openai' },
    grok1: { family: 'xai' },
  };
  assert.doesNotThrow(() => checkSameFamilySeats(['gpt1', 'grok1'], table, false));

  let stderr = '';
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
  try {
    assert.doesNotThrow(() => checkSameFamilySeats(['gpt1', 'gpt2'], table, true));
    assert.match(stderr, /review-jury: warning: same_family_vote: gpt1 and gpt2 \(openai\)/);
  } finally {
    process.stderr.write = origWrite;
  }
});

test('dispatch-plan-review CLI refuses same-family pair before dispatch and warns with --allow-same-family', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'same-family-dpr-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: tmp });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    const planPath = path.join(tmp, 'plan.md');
    const rubricPath = path.join(tmp, 'rubric.md');
    const manifestPath = path.join(tmp, 'manifest.json');
    const stateDir = path.join(tmp, 'state');
    fs.writeFileSync(planPath, '# Plan\n\nSome plan content.\n');
    fs.writeFileSync(rubricPath, '- R1: [clarity] Plan is clear.\n');
    const makeManifest = (seats) => ({
      schema_version: 1,
      artifact_type: 'plan_review_manifest',
      logical_plan_id: 'plan-same-family-test',
      minimum_distinct_families: 1,
      max_attempts_per_seat: 2,
      seats,
    });
    const dupSeats = [
      {
        id: 'gpt',
        runner: 'codex',
        model: 'gpt-6-astra',
        effort: 'low',
        endpoint: 'default',
        role: 'chair',
        family: 'openai',
        readiness_status: 'ready',
        qualification_status: 'qualified',
        required: true,
        excluded_families: [],
        fallbacks: [],
      },
      {
        id: 'gpt2',
        runner: 'codex',
        model: 'gpt-5.6-sol',
        effort: 'low',
        endpoint: 'default',
        role: 'deep',
        family: 'openai',
        readiness_status: 'ready',
        qualification_status: 'qualified',
        required: true,
        excluded_families: [],
        fallbacks: [],
      },
    ];
    fs.writeFileSync(manifestPath, JSON.stringify(makeManifest(dupSeats), null, 2));
    spawnSync('git', ['add', '.'], { cwd: tmp });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: tmp });

    const script = path.resolve(__dirname, '../scripts/dispatch-plan-review.js');
    const baseArgs = [
      script,
      '--repo-root', tmp,
      '--plan-file', planPath,
      '--rubric-file', rubricPath,
      '--manifest-file', manifestPath,
      '--ticket', 't1',
      '--session-id', 's1',
      '--generation', '1',
      '--state-dir', stateDir,
      '--allow-unregistered',
      '--no-topology-fallbacks',
    ];
    const refused = spawnSync(process.execPath, baseArgs, { encoding: 'utf8' });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /same_family_vote: gpt and gpt2 \(openai\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
