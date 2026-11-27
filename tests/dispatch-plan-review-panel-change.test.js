#!/usr/bin/env node
'use strict';
require('../scripts/lib/test-git-env'); // fixture repos must not run the account's global git config

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'dispatch-plan-review.js');

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-panel-change-'));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  const stateDir = path.join(root, 'state');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const planPath = path.join(repo, 'plan.md');
  const rubricPath = path.join(repo, 'rubric.md');
  fs.writeFileSync(planPath, '# Test Plan\n\n## Scope\nImplement panel change.\n');
  fs.writeFileSync(rubricPath, '# Rubric\n\n- R1: [correctness] Verify behavior.\n');

  const git = (...a) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');

  return { root, home, repo, stateDir, planPath, rubricPath };
}

function makeManifest(seats) {
  return {
    schema_version: 1,
    artifact_type: 'plan_review_manifest',
    logical_plan_id: 'plan-panel-change-test',
    minimum_distinct_families: 1,
    max_attempts_per_seat: 2,
    seats,
  };
}

let responseCounter = 0;
// The response seam reads each entry from a file, so write every JSON string to one.
function seamFiles(sandbox, sequence) {
  const out = {};
  for (const [seat, entries] of Object.entries(sequence)) {
    out[seat] = entries.map((text) => {
      responseCounter += 1;
      const file = path.join(sandbox.root, `resp-${responseCounter}.json`);
      fs.writeFileSync(file, text);
      return file;
    });
  }
  return out;
}

function runDispatch(sandbox, args, sequence) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: sandbox.home,
      AUTOPILOT_PLAN_REVIEW_STATE_DIR: sandbox.stateDir,
      AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS: '1',
      AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE: JSON.stringify(seamFiles(sandbox, sequence)),
    },
  });
}

const singleSeat = [
  {
    id: 'codex-sol',
    role: 'reviewer',
    endpoint: 'default',
    readiness_status: 'ready',
    qualification_status: 'qualified',
    runner: 'codex',
    model: 'gpt-5.4',
    family: 'openai',
    effort: 'medium',
    required: true,
    excluded_families: [],
    fallbacks: [],
  },
];

const threeSeats = [
  ...singleSeat,
  {
    id: 'agy-1',
    role: 'reviewer',
    endpoint: 'default',
    readiness_status: 'ready',
    qualification_status: 'qualified',
    runner: 'agy',
    model: 'gemini-3.1-pro',
    family: 'google',
    effort: 'medium',
    required: false,
    excluded_families: [],
    fallbacks: [],
  },
  {
    id: 'fable-1',
    role: 'reviewer',
    endpoint: 'default',
    readiness_status: 'ready',
    qualification_status: 'qualified',
    runner: 'grok',
    model: 'grok-4',
    family: 'xai',
    effort: 'medium',
    required: false,
    excluded_families: [],
    fallbacks: [],
  },
];

const blockerFinding = {
  rubric_id: 'R1',
  class: 'decision-now',
  severity: 'blocking',
  affected_surface: 'plan.md',
  claim: 'Needs fix before gen 2',
  evidence: 'Missing detail',
  evidence_reference: 'plan.md:1',
  repair: 'Add detail',
  blocks_next_slice_or_immediate_integrity: true,
  cannot_defer_to_spike: true,
  failure_scenario: 'Fails on gen 2',
};

function setupGen1(sandbox) {
  const m1Path = path.join(sandbox.repo, 'manifest-g1.json');
  fs.writeFileSync(m1Path, JSON.stringify(makeManifest(singleSeat), null, 2));

  const res = runDispatch(
    sandbox,
    [
      '--repo-root', sandbox.repo,
      '--plan-file', 'plan.md',
      '--rubric-file', sandbox.rubricPath,
      '--manifest-file', m1Path,
      '--ticket', 'T-PANEL-1',
      '--session-id', 'sess-1',
      '--generation', '1',
      '--allow-unregistered',
      '--no-topology-fallbacks',
    ],
    {
      'codex-sol': [
        JSON.stringify({ verdict: 'CONDITIONAL', findings: [blockerFinding] }),
      ],
    },
  );
  assert.equal(res.status, 0, `gen1 failed: ${res.stderr}`);
  const artifact = JSON.parse(res.stdout);
  const fingerprint = artifact.findings[0].fingerprint;
  const dispPath = path.join(sandbox.repo, 'disposition.json');
  fs.writeFileSync(dispPath, JSON.stringify({
    schema_version: 1,
    logical_plan_id: 'plan-panel-change-test',
    generation: 1,
    findings: [
      { fingerprint, disposition: 'accepted_blocker', rationale: 'fix in gen 2' },
    ],
  }, null, 2));
  return { dispPath };
}

// (a) Gen 1 single-seat sealed, Gen 2 three-seat without --panel-change -> exit 3
{
  const sb = makeSandbox();
  try {
    const { dispPath } = setupGen1(sb);
    const m2Path = path.join(sb.repo, 'manifest-g2.json');
    fs.writeFileSync(m2Path, JSON.stringify(makeManifest(threeSeats), null, 2));

    const res = runDispatch(
      sb,
      [
        '--repo-root', sb.repo,
        '--plan-file', 'plan.md',
        '--rubric-file', sb.rubricPath,
        '--manifest-file', m2Path,
        '--disposition-file', dispPath,
        '--ticket', 'T-PANEL-1',
        '--session-id', 'sess-1',
        '--generation', '2',
        '--allow-unregistered',
        '--no-topology-fallbacks',
      ],
      {
        'codex-sol': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'agy-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'fable-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
      },
    );
    assert.equal(res.status, 3, `expected exit 3, got ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, /drifted/);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

// (b) With --panel-change "operator switched to three-vote" -> succeeds and records panel_change
{
  const sb = makeSandbox();
  try {
    const { dispPath } = setupGen1(sb);
    const m2Path = path.join(sb.repo, 'manifest-g2.json');
    fs.writeFileSync(m2Path, JSON.stringify(makeManifest(threeSeats), null, 2));

    const res = runDispatch(
      sb,
      [
        '--repo-root', sb.repo,
        '--plan-file', 'plan.md',
        '--rubric-file', sb.rubricPath,
        '--manifest-file', m2Path,
        '--disposition-file', dispPath,
        '--ticket', 'T-PANEL-1',
        '--session-id', 'sess-1',
        '--generation', '2',
        '--allow-unregistered',
        '--no-topology-fallbacks',
        '--panel-change', 'operator switched to three-vote',
      ],
      {
        'codex-sol': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'agy-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'fable-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
      },
    );
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
    const artifact = JSON.parse(res.stdout);
    assert.ok(artifact.panel_change, 'artifact should include panel_change');
    assert.equal(artifact.panel_change.reason, 'operator switched to three-vote');
    assert.deepEqual(artifact.panel_change.previous_panel, ['codex-sol']);
    assert.deepEqual(artifact.panel_change.new_panel, ['codex-sol', 'agy-1', 'fable-1']);
    assert.equal(artifact.panel_change.generation, 2);
    assert.ok(typeof artifact.panel_change.at === 'string' && artifact.panel_change.at.length > 0);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

// (c) With --panel-change but rubric text modified -> still exit 3
{
  const sb = makeSandbox();
  try {
    const { dispPath } = setupGen1(sb);
    const m2Path = path.join(sb.repo, 'manifest-g2.json');
    fs.writeFileSync(m2Path, JSON.stringify(makeManifest(threeSeats), null, 2));
    fs.writeFileSync(sb.rubricPath, '# Rubric\n\n- R1: [correctness] Modified rubric text.\n');

    const res = runDispatch(
      sb,
      [
        '--repo-root', sb.repo,
        '--plan-file', 'plan.md',
        '--rubric-file', sb.rubricPath,
        '--manifest-file', m2Path,
        '--disposition-file', dispPath,
        '--ticket', 'T-PANEL-1',
        '--session-id', 'sess-1',
        '--generation', '2',
        '--allow-unregistered',
        '--no-topology-fallbacks',
        '--panel-change', 'operator switched to three-vote',
      ],
      {
        'codex-sol': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'agy-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
        'fable-1': [JSON.stringify({ verdict: 'READY', findings: [] })],
      },
    );
    assert.equal(res.status, 3, `expected exit 3 on rubric drift, got ${res.status}: ${res.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

// (d) --panel-change "" -> CliError (exit 2)
{
  const sb = makeSandbox();
  try {
    const m1Path = path.join(sb.repo, 'manifest-g1.json');
    fs.writeFileSync(m1Path, JSON.stringify(makeManifest(singleSeat), null, 2));

    const res = runDispatch(
      sb,
      [
        '--repo-root', sb.repo,
        '--plan-file', 'plan.md',
        '--rubric-file', sb.rubricPath,
        '--manifest-file', m1Path,
        '--ticket', 'T-PANEL-1',
        '--session-id', 'sess-1',
        '--generation', '1',
        '--allow-unregistered',
        '--no-topology-fallbacks',
        '--panel-change', '',
      ],
      {},
    );
    assert.equal(res.status, 2, `expected exit 2 for empty --panel-change, got ${res.status}: ${res.stderr}`);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
}

console.log('dispatch-plan-review-panel-change.test.js: all 4 cases passed');
