#!/usr/bin/env bash
# Production-chain behavior for two controller outcomes that must survive the
# dispatch parser and AutopilotEngine adapter before campaign composition sees
# them. Each scenario owns a separate Git repo so a durable boundary wait cannot
# contaminate the zero-effect precondition scenario.

TEST_NAME="controller-boundary-budget-bridge"
. "$(dirname "$0")/lib.sh"

BRIDGE_OUT="$(
  node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [root, testTmp] = process.argv.slice(2);
const {
  AutopilotEngine,
  campaignIdFor,
  createCampaignState,
} = require(path.join(root, 'src', 'engine'));
const {
  parseImplementationOutput,
} = require(path.join(root, 'src', 'runners', 'implementer'));

const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: [{
    role: 'qc',
    runner: 'fixture',
    model: 'fixture-reviewer',
    effort: 'high',
    endpoint: null,
    family: 'fixture',
  }],
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 2,
  loop_convergence_verdict: 'SHIP-AS-IS',
  cross_family_required: false,
};

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture(name) {
  const repo = path.join(testTmp, name, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'controller-bridge@example.invalid']);
  git(repo, ['config', 'user.name', 'Controller Bridge Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), `${name}\n`);
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '-qm', 'fixture']);

  const base = git(repo, ['rev-parse', 'HEAD']);
  const commonRaw = git(repo, ['rev-parse', '--git-common-dir']);
  const commonDir = fs.realpathSync(
    path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw),
  );
  const ticket = `controller-${name}`;
  const branch = `impl/${name}`;
  const contract = {
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${commonDir}`,
    base_sha: base,
    branch,
    vertical_acceptance: ['production outcome reaches campaign composition'],
    allowed_path_prefixes: ['src/'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 1,
    max_wall_seconds: 120,
    verify_cmd: 'node fixture.js',
    rubric_ids: ['C1'],
  };
  const contractPath = path.join(testTmp, name, 'campaign.json');
  const sealPath = path.join(testTmp, name, 'campaign.seal.json');
  const promptFile = path.join(testTmp, name, 'prompt.txt');
  const contractBytes = `${JSON.stringify(contract, null, 2)}\n`;
  fs.writeFileSync(contractPath, contractBytes);
  fs.writeFileSync(sealPath, '{}\n');
  fs.writeFileSync(promptFile, 'bounded implementation\n');

  const contractDigest = crypto.createHash('sha256').update(contractBytes).digest('hex');
  const campaignId = campaignIdFor(contract.repo_identity, ticket, contractDigest);
  const initialState = createCampaignState({
    contract,
    contractDigest,
    repoIdentity: contract.repo_identity,
    startedAt: '2026-07-30T00:00:00.000Z',
  });
  const campaignControl = {
    status: 'admitted',
    campaign_id: campaignId,
    contract_digest: contractDigest,
    contract,
    contract_path: contractPath,
    seal_path: sealPath,
    initial_state: initialState,
    generation_claim: {
      ledger: path.join(repo, '.autopilot', 'identity-ledger.jsonl'),
      generation: 1,
      nonce: `${name}-nonce`,
      stage_identity: `run-ledger:1:${name}-nonce`,
      durable_journal: false,
    },
    full_enforcement: false,
    shadow_axes: ['mission'],
    steps: [],
  };
  return {
    repo,
    base,
    branch,
    contractPath,
    sealPath,
    promptFile,
    campaignControl,
  };
}

function transport(value, exitStatus) {
  const stdout = `${JSON.stringify(value)}\n`;
  return {
    error: null,
    status: exitStatus,
    signal: null,
    stdout,
    stderr: '',
    parseError: null,
    result: parseImplementationOutput(stdout),
  };
}

function runScenario(fx, value, exitStatus) {
  const engine = new AutopilotEngine({
    cwd: fx.repo,
    clock: () => '2026-07-30T00:00:01.000Z',
    campaignIntake() {
      return fx.campaignControl;
    },
    campaignAdmissionReleaser() {
      return { status: 'released' };
    },
    implementationDispatcher() {
      return transport(value, exitStatus);
    },
  });
  return engine.runImplementationReviewLoop({
    promptFile: fx.promptFile,
    branch: fx.branch,
    base: fx.base,
    roster,
    campaignContract: fx.contractPath,
    campaignSeal: fx.sealPath,
  });
}

const resource = fixture('resource-budget');
const resourceResult = runScenario(resource, {
  status: 'precondition_failed',
  runner: 'fixture',
  model: 'fixture-implementer',
  branch: resource.branch,
  base: resource.base,
  commit: null,
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  worktree: null,
  agent_log: null,
  error: 'resource_budget exhausted',
  dispatcher_called: false,
  model_calls: 0,
  mutation_attempts: 0,
  gate_attempts: 0,
  resources_created: 0,
  zero_diff_receipt_digest: null,
  resource_budget: {
    resource: 'leaf_worktrees',
    root_run_id: resource.campaignControl.campaign_id,
    count: 4,
    limit: 4,
  },
}, 2);

if (!resourceResult.campaign_control
    || !resourceResult.campaign_control.controller) {
  throw new Error(`resource scenario did not reach controller accounting: ${
    JSON.stringify(resourceResult)
  }`);
}
assert.strictEqual(resourceResult.status, 'blocked');
assert.strictEqual(resourceResult.implementation.dispatcher_called, false);
assert.strictEqual(resourceResult.implementation.model_calls, 0);
assert.strictEqual(
  resourceResult.campaign_control.controller.repair_budget_usage.model_calls,
  0,
);
console.log('resource_status=blocked');
console.log('resource_dispatcher=false');
console.log('resource_model_calls=0');
console.log('resource_campaign_usage=0');

const boundary = fixture('boundary');
const boundaryResult = runScenario(boundary, {
  status: 'boundary_rejected',
  runner: 'fixture',
  model: 'fixture-implementer',
  branch: boundary.branch,
  base: boundary.base,
  commit: boundary.base,
  files_changed: 1,
  insertions: 1,
  deletions: 0,
  worktree: boundary.repo,
  agent_log: null,
  error: 'boundary_rejected: changed path violates scope',
  containment: 'plain',
  contained: true,
  boundary_code: 'scope_or_budget_boundary',
  boundary_reason: 'boundary_rejected: changed path violates scope',
  candidate_ref: boundary.base,
  possibly_effectful: true,
  mutation_failed: false,
  unknown_status: false,
  dispatcher_called: true,
  model_calls: 1,
  mutation_attempts: 1,
  gate_attempts: 1,
  resources_created: 1,
}, 1);

assert.strictEqual(boundaryResult.status, 'blocked');
assert.strictEqual(boundaryResult.phase, 'boundary_rejected');
assert.strictEqual(boundaryResult.durable_wait, true);
assert.strictEqual(boundaryResult.campaign_receipt.status, 'boundary_rejected');
assert.strictEqual(boundaryResult.campaign_receipt.candidate_ref, boundary.base);
assert.strictEqual(boundaryResult.campaign_receipt.mutation_failed, false);
assert.strictEqual(boundaryResult.campaign_receipt.unknown_status, false);
console.log('boundary_status=blocked');
console.log('boundary_phase=boundary_rejected');
console.log('boundary_wait=true');
console.log('boundary_receipt=boundary_rejected');
console.log(`boundary_candidate=${boundary.base}`);
NODE
)"
BRIDGE_EXIT=$?

assert_exit_code "$BRIDGE_EXIT" "0" "isolated production bridge scenarios exit zero"
assert_contains "$BRIDGE_OUT" "resource_dispatcher=false" \
  "worktree high-water preserves never-dispatched authority"
assert_contains "$BRIDGE_OUT" "resource_model_calls=0" \
  "worktree high-water preserves zero model calls"
assert_contains "$BRIDGE_OUT" "resource_campaign_usage=0" \
  "campaign accounting does not charge a pre-spend high-water rejection"
assert_contains "$BRIDGE_OUT" "boundary_phase=boundary_rejected" \
  "managed composition preserves the first-class boundary phase"
assert_contains "$BRIDGE_OUT" "boundary_wait=true" \
  "boundary rejection remains a durable resumable wait"
assert_contains "$BRIDGE_OUT" "boundary_receipt=boundary_rejected" \
  "campaign receipt preserves boundary outcome identity"

finalize_test
