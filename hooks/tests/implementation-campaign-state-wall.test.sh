#!/usr/bin/env bash
# RED at 2042c2b1: wall block on the failure receipt is ignored by the reducer
# (digest binding only); a MUTATION_FAILED with a wall receipt must still bind
# the controller's own digest, and a wrong digest is still refused.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

PURE_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const {
  CAMPAIGN_EVENTS: E,
  CAMPAIGN_STATES: S,
  CampaignStateError,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  reduceCampaignState,
} = require(path.join(root, 'src', 'engine'));

const D = 'a'.repeat(64);
const contract = {
  ticket: 'icc-wall',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 2,
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
    campaign_id: campaignIdFor('git-common-dir:/fixture', 'icc-wall', D),
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
function expectCode(code, fn) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof CampaignStateError);
    assert.strictEqual(error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}

const mutationStart = event(
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: true },
  { key: 'mutation-start', stage: 'owned-stage', elapsed: 0, timestamp: '2026-07-26T00:00:00.000Z' },
);
const mutationLeased = reduceCampaignState(initial(), mutationStart);
const wallReceipt = {
  schema_version: 1,
  artifact_type: 'implementation_campaign_failure',
  campaign_id: mutationLeased.campaign_id,
  contract_digest: D,
  generation: 0,
  phase: 'campaign_wall_budget',
  reason: 'campaign wall budget exhausted before verify',
  possibly_effectful: true,
  observed_at: '2026-07-26T00:00:30.000Z',
  wall: {
    max_wall_seconds: 2,
    elapsed_wall_seconds: 30,
    stage: 'verify',
  },
};
const failureDigest = canonicalDigest(wallReceipt);
const mutationFailure = event(
  E.MUTATION_FAILED,
  0,
  {
    reason: 'campaign wall budget exhausted before verify',
    failure_receipt_digest: failureDigest,
    possibly_effectful: true,
  },
  {
    key: 'wall-mutation-failed',
    stage: 'owned-stage',
    elapsed: 30,
    timestamp: '2026-07-26T00:00:30.000Z',
    output: canonicalDigest({ kind: 'campaign_terminal', digest: failureDigest }),
  },
);
const mutationStopped = reduceCampaignState(mutationLeased, mutationFailure);
assert.strictEqual(mutationStopped.phase, S.TERMINAL_STOP);
assert.strictEqual(mutationStopped.live_lease, null);
console.log('wall_receipt_accepted=true');

expectCode('MUTATION_FAILURE_EVIDENCE_REQUIRED', () => reduceCampaignState(
  mutationLeased,
  {
    ...mutationFailure,
    idempotency_key: 'wall-wrong-digest',
    output_artifact_digest: canonicalDigest({
      kind: 'campaign_terminal',
      digest: 'c'.repeat(64),
    }),
  },
));
console.log('wall_wrong_digest_refused=true');
NODE
)"
assert_eq "0" "$?" "wall MUTATION_FAILED reducer process exits 0"
assert_contains "$PURE_OUT" "wall_receipt_accepted=true" \
  "MUTATION_FAILED whose receipt carries wall is accepted with the controller digest"
assert_contains "$PURE_OUT" "wall_wrong_digest_refused=true" \
  "wrong digest is still refused"

finalize_test
