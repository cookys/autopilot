#!/usr/bin/env bash
# RED at base 14168cad: UNKNOWN_FIELD git_candidate on BOUNDARY_REJECTED payload.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

PURE_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const testTmp = process.argv[3];
const {
  CAMPAIGN_EVENTS: E,
  CAMPAIGN_STATES: S,
  CampaignStateError,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  reduceCampaignState,
  normalizeCampaignArtifactReference,
} = require(path.join(root, 'src', 'engine'));
const { createWriterFence } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));
const { appendCampaignEvent } = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const campaignCli = require(path.join(root, 'src', 'campaign', 'cli'));

const D = 'a'.repeat(64);
const contract = {
  ticket: 'icc-boundary-resume',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 120,
  max_changed_files: 4,
  baseline_churn: 10,
  max_extra_churn: 5,
};
const initial = () => createCampaignState({
  contract,
  contractDigest: D,
  repoIdentity: 'git-common-dir:/fixture',
  startedAt: '2026-07-26T00:00:00.000Z',
});
let sequence = 0;
function event(type, generation, payload = {}, overrides = {}) {
  sequence += 1;
  const elapsed = overrides.elapsed === undefined ? sequence : overrides.elapsed;
  return {
    schema_version: 1,
    event_type: type,
    campaign_id: campaignIdFor('git-common-dir:/fixture', 'icc-boundary-resume', D),
    contract_digest: D,
    generation,
    idempotency_key: overrides.key || `event-${sequence}`,
    input_artifact_digest: overrides.input || D,
    output_artifact_digest: overrides.output || D,
    timestamp: overrides.timestamp
      || `2026-07-26T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    stage_identity: overrides.stage || `stage-${generation}`,
    usage: {
      repair_generations: generation,
      elapsed_wall_seconds: elapsed,
      changed_files: overrides.changed === undefined ? 0 : overrides.changed,
      churn: overrides.churn === undefined ? 0 : overrides.churn,
    },
    payload,
  };
}

const repo = path.join(testTmp, 'state-repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
execFileSync('git', ['-C', repo, 'init', '-q']);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'state@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'State']);
fs.writeFileSync(path.join(repo, 'src', 'seed.txt'), 'seed\n');
execFileSync('git', ['-C', repo, 'add', 'src/seed.txt']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
const base = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const commonRaw = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
const commonDir = fs.realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw));
const branch = 'impl/state-boundary';
const worktree = path.join(testTmp, 'state-wt');
execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', branch, worktree, base]);
fs.writeFileSync(path.join(worktree, 'src', 'out.txt'), 'ok\n');
execFileSync('git', ['-C', worktree, 'add', 'src/out.txt']);
execFileSync('git', ['-C', worktree, 'commit', '-qm', 'cand']);
const commit = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();

const ledgerContract = campaignLedgerContract({
  repoIdentity: `git-common-dir:${commonDir}`,
  ticket: 'state-boundary-resume',
  baseSha: base,
  branch,
});
const opened = openCampaignLedger({
  root,
  repo,
  ledger: path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'),
  contract: ledgerContract,
  startedAt: '2026-07-26T00:00:00.000Z',
});
const campaignId = opened.campaignId;
const instanceId = require('crypto').createHash('sha256').update(worktree).digest('hex');
const lineage = {
  lineage_id: campaignId,
  branch,
  worktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: instanceId,
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: 0,
  inherited_churn: 0,
  delta_churn: 2,
  retention_owner: campaignId,
  retention_reason: 'implementation-campaign-repair-lineage',
  retention_expires_at: 2000000000,
  terminal_worktree_disposition: 'active',
  transcript_reused: false,
  transcript_source_digest: 'a'.repeat(64),
  review_input_mode: 'full_diff_generation',
  new_input_bytes: 17,
  new_input_tokens: 23,
  input_token_measurement: 'provider_reported',
  finding_occurrences: [],
  accepted_invariant_ids: [],
  accepted_invariants: [],
  accepted_invariants_source_commit: null,
  accepted_invariants_digest: null,
  prior_review_finding_ids: [],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/out.txt'],
  repair_scope_seal: null,
};
const fence = createWriterFence({
  campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: commit,
  candidateTreeSha: tree,
  implementationResult: {
    status: 'committed',
    implementation: { commit },
    implementationResult: { error: null, signal: null, status: 0 },
  },
});
const gitCandidate = normalizeCampaignArtifactReference({
  kind: 'git_candidate',
  commit,
  tree_sha: tree,
  branch,
  base,
  writer_fence: fence,
  repair_lineage: lineage,
});

let control = opened.control;
const started = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-26T00:00:01.000Z',
  eventType: E.IMPLEMENTATION_STARTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { sealed_contract: true },
});
control = { ...control, initial_state: started.state };
const brDigest = '9'.repeat(64);
const rejected = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-26T00:00:02.000Z',
  eventType: E.BOUNDARY_REJECTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: {
    reason: 'scope boundary',
    boundary_reason: 'unauthorized_output_path: docs/leak.md',
    candidate_ref: commit,
    boundary_receipt_digest: brDigest,
    git_candidate: gitCandidate,
  },
  artifactReference: {
    kind: 'campaign_boundary_rejected',
    digest: brDigest,
  },
});
assert.strictEqual(rejected.state.phase, S.BOUNDARY_REJECTED);
const projection = campaignCli.projectCampaign(
  campaignCli.loadRows(opened.ledger),
  campaignId,
);
assert.ok(projection.candidate_reference);
assert.strictEqual(projection.candidate_reference.kind, 'git_candidate');
assert.strictEqual(projection.candidate_reference.commit, commit);
console.log('candidate_survives_replay=true');

let refusedCode = null;
try {
  reduceCampaignState(started.state, {
    ...rejected.event,
    idempotency_key: `${rejected.event.idempotency_key}:bad-digest`,
    output_artifact_digest: canonicalDigest({
      kind: 'campaign_boundary_rejected',
      digest: canonicalDigest({ tampered: true }),
    }),
  });
} catch (error) {
  refusedCode = error instanceof CampaignStateError ? error.code : String(error);
}
assert.strictEqual(refusedCode, 'BOUNDARY_EVIDENCE_REQUIRED');
console.log(`wrong_digest=${refusedCode}`);

const reducerOnly = initial();
const startedOnly = reduceCampaignState(reducerOnly, event(
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: true },
  { input: D, output: canonicalDigest({ k: 'started' }), stage: 'campaign-mutation:0' },
));
const brOnly = 'b'.repeat(64);
const withCandidate = reduceCampaignState(startedOnly, event(
  E.BOUNDARY_REJECTED,
  0,
  {
    reason: 'scope boundary',
    boundary_reason: 'changed path violates scope',
    candidate_ref: commit,
    boundary_receipt_digest: brOnly,
    git_candidate: gitCandidate,
  },
  {
    input: startedOnly.last_output_artifact_digest,
    output: canonicalDigest({ kind: 'campaign_boundary_rejected', digest: brOnly }),
    stage: 'campaign-mutation:0',
  },
));
assert.strictEqual(withCandidate.phase, S.BOUNDARY_REJECTED);
console.log('reducer_accepts_git_candidate=true');

const reviewing = reduceCampaignState(withCandidate, event(
  E.VERTICAL_VERIFIED,
  0,
  { passed: true, evidence_digest: D },
  {
    input: withCandidate.last_output_artifact_digest,
    output: canonicalDigest({ k: 'vertical' }),
    stage: 'campaign-verification:0',
  },
));
assert.strictEqual(reviewing.phase, S.REVIEWING);
console.log('boundary_vertical_verified=REVIEWING');

let preparedRefuse = null;
try {
  reduceCampaignState(reducerOnly, event(
    E.VERTICAL_VERIFIED,
    0,
    { passed: true, evidence_digest: D },
    { input: reducerOnly.last_output_artifact_digest, output: canonicalDigest({ k: 'vv-p' }) },
  ));
} catch (error) {
  preparedRefuse = error instanceof CampaignStateError ? error.code : String(error);
}
assert.strictEqual(preparedRefuse, 'INVALID_TRANSITION');
let implementingRefuse = null;
try {
  reduceCampaignState(startedOnly, event(
    E.VERTICAL_VERIFIED,
    0,
    { passed: true, evidence_digest: D },
    { input: startedOnly.last_output_artifact_digest, output: canonicalDigest({ k: 'vv-i' }) },
  ));
} catch (error) {
  implementingRefuse = error instanceof CampaignStateError ? error.code : String(error);
}
assert.strictEqual(implementingRefuse, 'INVALID_TRANSITION');
console.log(`vertical_verified_refusals=${preparedRefuse},${implementingRefuse}`);
NODE
)"
PURE_EXIT=$?
echo "$PURE_OUT"
assert_exit_code "$PURE_EXIT" "0" "boundary reducer pin suite exits zero"
assert_contains "$PURE_OUT" "candidate_survives_replay=true" \
  "BOUNDARY_REJECTED git_candidate survives journal replay"
assert_contains "$PURE_OUT" "wrong_digest=BOUNDARY_EVIDENCE_REQUIRED" \
  "wrong boundary digest is still refused"
assert_contains "$PURE_OUT" "reducer_accepts_git_candidate=true" \
  "reducer accepts BOUNDARY_REJECTED with git_candidate"
assert_contains "$PURE_OUT" "boundary_vertical_verified=REVIEWING" \
  "BOUNDARY_REJECTED + vertical_verified advances to REVIEWING"
assert_contains "$PURE_OUT" "vertical_verified_refusals=INVALID_TRANSITION,INVALID_TRANSITION" \
  "vertical_verified from PREPARED and IMPLEMENTING is still refused"
