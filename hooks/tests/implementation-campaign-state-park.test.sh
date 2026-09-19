#!/usr/bin/env bash
# Plan C — park names repair-round cost; resume that cannot fit is refused.
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
  canonicalDigest,
  createCampaignState,
  estimateRepairRoundSeconds,
  reduceCampaignState,
  replayCampaignEvents,
} = require(path.join(root, 'src', 'engine'));

const D = 'a'.repeat(64);
const contract = {
  ticket: 'park-c',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 7200,
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
    campaign_id: initial().campaign_id,
    contract_digest: D,
    generation,
    idempotency_key: overrides.key || `event-${sequence}`,
    input_artifact_digest: overrides.input || D,
    output_artifact_digest: overrides.output || D,
    timestamp: overrides.timestamp
      || `2026-07-26T00:00:${String(Math.min(sequence, 59)).padStart(2, '0')}.000Z`,
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

const present = estimateRepairRoundSeconds([
  { event_type: E.IMPLEMENTATION_STARTED, generation: 0, timestamp: '2026-07-26T00:00:00.000Z' },
  {
    event_type: E.IMPLEMENTATION_COMPLETED,
    generation: 0,
    timestamp: '2026-07-26T01:00:00.000Z',
    payload: { wall_secs: 3600 },
  },
  { event_type: E.VERTICAL_VERIFIED, generation: 0, timestamp: '2026-07-26T01:21:00.000Z' },
  { event_type: E.REVIEW_COMPLETED, generation: 0, timestamp: '2026-07-26T01:30:00.000Z' },
]);
assert.strictEqual(present.repair_round_estimate_seconds, 5400);
// RED at 56e2c097: TypeError: estimateRepairRoundSeconds is not a function
assert.strictEqual(present.implement_seconds, 3600);
assert.strictEqual(present.verify_seconds, 1260);
assert.strictEqual(present.review_seconds, 540);
console.log('estimate_present=true');

const missing = estimateRepairRoundSeconds([
  { event_type: E.IMPLEMENTATION_STARTED, generation: 0 },
]);
assert.strictEqual(missing.repair_round_estimate_seconds, null);
assert.strictEqual(missing.implement_seconds, null);
console.log('estimate_missing_null=true');

const engineRows = estimateRepairRoundSeconds([
  { unit: 'dispatch_implementation', round: 1, wall_secs: 3600 },
  {
    unit: 'verify_round',
    round: 1,
    started_at: '2026-07-26T01:00:00.000Z',
    ended_at: '2026-07-26T01:21:00.000Z',
  },
  {
    unit: 'dispatch_review',
    round: 1,
    started_at: '2026-07-26T01:21:00.000Z',
    ended_at: '2026-07-26T01:30:00.000Z',
  },
]);
assert.strictEqual(engineRows.repair_round_estimate_seconds, 5400);
console.log('estimate_engine_rows=true');

function isoAt(seconds) {
  return new Date(Date.parse('2026-07-26T00:00:00.000Z') + seconds * 1000).toISOString();
}
const id = initial().campaign_id;
sequence = 0;
function ev(type, gen, payload, elapsed, extra = {}) {
  return event(type, gen, payload, {
    elapsed,
    timestamp: isoAt(elapsed),
    input: extra.input,
    output: extra.output,
    stage: extra.stage,
    key: extra.key,
  });
}
let state = initial();
const started = ev(E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true }, 1, {
  input: D,
  output: canonicalDigest({ k: 'started' }),
  stage: 'campaign-implementation:0',
});
state = reduceCampaignState(state, started);
const completed = ev(E.IMPLEMENTATION_COMPLETED, 0, {
  scope_check_passed: true,
  scope_check_digest: 'b'.repeat(64),
}, 3601, {
  input: state.last_output_artifact_digest,
  output: canonicalDigest({ k: 'completed' }),
  stage: 'campaign-implementation:0',
});
state = reduceCampaignState(state, completed);
const verified = ev(E.VERTICAL_VERIFIED, 0, {
  passed: true,
  evidence_digest: 'c'.repeat(64),
}, 4861, {
  input: state.last_output_artifact_digest,
  output: canonicalDigest({ k: 'verified' }),
});
state = reduceCampaignState(state, verified);
const reviewed = ev(E.REVIEW_COMPLETED, 0, { review_digest: 'd'.repeat(64) }, 5401, {
  input: state.last_output_artifact_digest,
  output: canonicalDigest({ k: 'reviewed' }),
});
state = reduceCampaignState(state, reviewed);
assert.strictEqual(state.phase, S.ADJUDICATING);

const oldPark = ev(E.AWAITING_DISPOSITION, 0, {
  reason: 'missing disposition authority',
  findings_digest: 'e'.repeat(64),
  candidate_ref: '3'.repeat(40),
}, 5435, {
  input: state.last_output_artifact_digest,
  output: canonicalDigest({ k: 'wait-old' }),
  key: 'awaiting-old',
});
const oldParked = reduceCampaignState(state, oldPark);
assert.strictEqual(oldParked.phase, S.AWAITING_DISPOSITION);
// RED at 56e2c097: awaiting_disposition keys=['reason','findings_digest','candidate_ref']
// (no wall_seconds_remaining / repair_round_estimate_seconds / repair_round_fits).
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(oldParked.awaiting_disposition, 'wall_seconds_remaining'),
  false,
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(oldParked.awaiting_disposition, 'repair_round_estimate_seconds'),
  false,
);
assert.strictEqual(
  Object.prototype.hasOwnProperty.call(oldParked.awaiting_disposition, 'repair_round_fits'),
  false,
);
console.log('old_journal_no_estimate_fields=true');

const replayed = replayCampaignEvents(initial(), [
  started, completed, verified, reviewed, oldPark,
]);
assert.deepStrictEqual(replayed, oldParked);
console.log('old_journal_replay_identical=true');

const newPark = ev(E.AWAITING_DISPOSITION, 0, {
  reason: 'missing disposition authority',
  findings_digest: 'e'.repeat(64),
  candidate_ref: '3'.repeat(40),
  wall_seconds_remaining: 1765,
  repair_round_estimate_seconds: 5400,
  repair_round_fits: false,
}, 5435, {
  input: state.last_output_artifact_digest,
  output: canonicalDigest({ k: 'wait-new' }),
  key: 'awaiting-new',
});
const parked = reduceCampaignState(state, newPark);
assert.strictEqual(parked.phase, S.AWAITING_DISPOSITION);
assert.strictEqual(parked.awaiting_disposition.wall_seconds_remaining, 1765);
assert.strictEqual(parked.awaiting_disposition.repair_round_estimate_seconds, 5400);
assert.strictEqual(parked.awaiting_disposition.repair_round_fits, false);
console.log('park_payload_preserved=true');
console.log(`campaign_id=${id}`);
NODE
)"
assert_exit_code "$?" "0" "pure park estimate/reducer cases: $PURE_OUT"
assert_contains "$PURE_OUT" "estimate_present=true" "estimate from round-1 rows"
assert_contains "$PURE_OUT" "estimate_missing_null=true" "missing rows yield null"
assert_contains "$PURE_OUT" "estimate_engine_rows=true" "engine ledger rows sum"
assert_contains "$PURE_OUT" "old_journal_no_estimate_fields=true" "pre-v2.36.71 park has no estimate fields"
assert_contains "$PURE_OUT" "old_journal_replay_identical=true" "old journal replay is identical"
assert_contains "$PURE_OUT" "park_payload_preserved=true" "new park fields preserved in awaiting_disposition"

# Durable intake: 5435/7200 park, repair-authorising resume refused, stay parked.
SBX="$TEST_TMP/park-c-repo"
mkdir -p "$SBX/src" "$SBX/.claude"
git -C "$SBX" init -q
git -C "$SBX" config user.email park@example.com
git -C "$SBX" config user.name park
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow
printf '.autopilot/\n' > "$SBX/.gitignore"
printf 'base\n' > "$SBX/src/value.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm "base"
BASE="$(git -C "$SBX" rev-parse HEAD)"
WT="$TEST_TMP/park-c-wt"
git -C "$SBX" worktree add -q -b impl/park-c "$WT" "$BASE"
printf 'c0\n' > "$WT/src/value.txt"
git -C "$WT" add .
git -C "$WT" commit -qm "c0"
C0="$(git -C "$WT" rev-parse HEAD)"
C0_TREE="$(git -C "$WT" rev-parse HEAD^{tree})"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
COMMON="$(realpath "$SBX/$COMMON_RAW")"
CONTRACT="$TEST_TMP/park-c-campaign.json"
SEAL="$TEST_TMP/park-c-campaign.seal.json"
PROMPT="$TEST_TMP/park-c-prompt.txt"
printf 'park-c repair reserve\n' > "$PROMPT"
node - "$CONTRACT" "$COMMON" "$BASE" <<'NODE'
const fs = require('fs');
const [target, commonDir, base] = process.argv.slice(2);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  ticket: 'park-c',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/park-c',
  vertical_acceptance: ['park names repair round cost'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 7200,
  verify_cmd: 'true',
  rubric_ids: ['PARK-C1'],
}, null, 2)}\n`);
NODE
SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --out "$SEAL" 2>&1)"
assert_exit_code "$?" "0" "park-c fixture seals: $SEAL_OUT"

INTAKE_OUT="$(node - "$REPO_ROOT" "$SBX" "$WT" "$CONTRACT" "$SEAL" "$PROMPT" "$BASE" "$C0" "$C0_TREE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [
  root, repo, worktree, contractPath, sealPath, promptFile, base, c0, c0Tree,
] = process.argv.slice(2);
const {
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  appendCampaignEvent,
  canonicalDigest,
  createWriterFence,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const { worktreeInstanceId } = require(path.join(root, 'src', 'engine', 'repair-lineage-cleanup'));
const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const iso = (secs) => new Date(Date.parse('2026-07-26T00:00:00.000Z') + secs * 1000).toISOString();
const lineageBody = (campaignId) => ({
  lineage_id: campaignId,
  branch: 'impl/park-c',
  worktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: worktreeInstanceId(worktree),
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: 0,
  inherited_churn: 0,
  delta_churn: 1,
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
  accepted_invariant_ids: [`acceptance:${'c'.repeat(64)}`],
  accepted_invariants: ['preserve durable invariant'],
  accepted_invariants_source_commit: c0,
  accepted_invariants_digest: canonicalDigest({
    schema: 1,
    assertions: ['preserve durable invariant'],
    source_commit: c0,
  }),
  prior_review_finding_ids: [],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/value.txt'],
  repair_scope_seal: null,
});
let control = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/park-c', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: iso(0),
}, adapters);
assert.strictEqual(control.status, 'admitted', JSON.stringify(control.rejection || control));
const campaignId = control.campaign_id;
const fence = createWriterFence({
  campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: c0,
  candidateTreeSha: c0Tree,
  implementationResult: {
    status: 'committed',
    implementation: { commit: c0 },
    implementationResult: { error: null, signal: null, status: 0 },
  },
});
const gitCandidate = {
  kind: 'git_candidate',
  commit: c0,
  tree_sha: c0Tree,
  branch: 'impl/park-c',
  base,
  writer_fence: fence,
  repair_lineage: lineageBody(campaignId),
};
const step = (eventType, generation, stageIdentity, payload, observedAt, extra = {}) => {
  const appended = appendCampaignEvent({
    repo,
    campaignControl: control,
    observedAt,
    eventType,
    generation,
    stageIdentity,
    payload,
    artifactReference: extra.artifactReference,
    usage: extra.usage,
  });
  control = { ...control, initial_state: appended.state };
  return appended;
};
step(CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED, 0, 'campaign-implementation', {
  sealed_contract: true,
}, iso(1));
step(CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED, 0, 'campaign-implementation', {
  scope_check_passed: true,
  scope_check_digest: 'b'.repeat(64),
}, iso(3601), { artifactReference: gitCandidate });
const verifyDigest = 'c'.repeat(64);
step(CAMPAIGN_EVENTS.VERTICAL_VERIFIED, 0, 'campaign-verification:0', {
  passed: true,
  evidence_digest: verifyDigest,
}, iso(4861), {
  artifactReference: { kind: 'verification_receipt', digest: verifyDigest },
});
const reviewDigest = 'd'.repeat(64);
step(CAMPAIGN_EVENTS.REVIEW_COMPLETED, 0, 'campaign-review:0', {
  review_digest: reviewDigest,
}, iso(5401), {
  artifactReference: { kind: 'product_review', digest: reviewDigest },
});
const findingsDigest = canonicalDigest([{ id: 'park-c-1' }]);
step(CAMPAIGN_EVENTS.AWAITING_DISPOSITION, 0, 'campaign-adjudication:0', {
  reason: 'missing disposition authority',
  findings_digest: findingsDigest,
  candidate_ref: c0,
  wall_seconds_remaining: 1765,
  repair_round_estimate_seconds: 5400,
  repair_round_fits: false,
}, iso(5435));
const ledgerPath = control.generation_claim.ledger;
const projection = projectCampaign(loadRows(ledgerPath), campaignId);
assert.strictEqual(projection.state.phase, CAMPAIGN_STATES.AWAITING_DISPOSITION);
assert.strictEqual(projection.awaiting_disposition.repair_round_fits, false);
assert.strictEqual(projection.awaiting_disposition.repair_round_estimate_seconds, 5400);
assert.strictEqual(projection.awaiting_disposition.wall_seconds_remaining, 1765);
fs.copyFileSync(ledgerPath, `${ledgerPath}.park.bak`);
console.log(`campaign_id=${campaignId}`);
console.log(`contract_digest=${control.contract_digest}`);
console.log(`review_digest=${reviewDigest}`);
console.log(`ledger=${ledgerPath}`);
console.log('parked=true');
NODE
)"
assert_exit_code "$?" "0" "park-c journals AWAITING_DISPOSITION: $INTAKE_OUT"
assert_contains "$INTAKE_OUT" "parked=true" "park payload preserved on inspect projection"
CAMPAIGN_ID="$(printf '%s\n' "$INTAKE_OUT" | sed -n 's/^campaign_id=//p')"
CONTRACT_DIGEST="$(printf '%s\n' "$INTAKE_OUT" | sed -n 's/^contract_digest=//p')"
REVIEW_DIGEST="$(printf '%s\n' "$INTAKE_OUT" | sed -n 's/^review_digest=//p')"
LEDGER="$(printf '%s\n' "$INTAKE_OUT" | sed -n 's/^ledger=//p')"

RESUME_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" "$BASE" "$CAMPAIGN_ID" \
  "$CONTRACT_DIGEST" "$REVIEW_DIGEST" "$LEDGER" "$C0" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [
  root, repo, contractPath, sealPath, promptFile, base, campaignId,
  contractDigest, reviewDigest, ledgerPath, c0,
] = process.argv.slice(2);
const { CAMPAIGN_STATES, runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const iso = (secs) => new Date(Date.parse('2026-07-26T00:00:00.000Z') + secs * 1000).toISOString();
const leaseBefore = loadRows(ledgerPath).filter(
  (row) => row.kind === 'stage' && row.run_id === campaignId && row.stage === 'campaign',
).length;
const authority = {
  schema_version: 1,
  artifact_type: 'campaign_disposition_authority',
  authority: 'depth-0',
  actor_id: 'operator',
  campaign_id: campaignId,
  contract_digest: contractDigest,
  reviews: [{
    review_digest: reviewDigest,
    decisions: [{
      finding_id: 'park-c-1',
      evidence: {
        kind: 'trace',
        trace_chain: ['contract.vertical_acceptance[0]'],
        confirmed_by: 'operator',
      },
      disposition: {
        disposition: 'must-fix-now',
        acceptance_id: 'vertical_acceptance[0]',
        deferral_harm: 'unfixed acceptance remains',
      },
    }],
  }],
};
const repairResume = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/park-c', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: iso(5435),
  resume: true,
  campaignDispositionAuthority: authority,
}, adapters);
assert.strictEqual(repairResume.status, 'blocked', JSON.stringify(repairResume));
assert.strictEqual(
  repairResume.rejection.code,
  'campaign_wall_budget_insufficient_for_repair',
);
assert.strictEqual(
  repairResume.rejection.reason,
  'remaining 1765 s < repair round estimate 5400 s (implement 3600 + verify 1260 + review 540), shortfall 3635 s',
);
const after = projectCampaign(loadRows(ledgerPath), campaignId);
assert.strictEqual(after.state.phase, CAMPAIGN_STATES.AWAITING_DISPOSITION);
const eventTypes = loadRows(ledgerPath)
  .filter((row) => row.op === 'campaign_event' && row.run_id === campaignId)
  .map((row) => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return payload && payload.event && payload.event.event_type;
  });
assert.ok(!eventTypes.includes('terminal_stop'), String(eventTypes));
assert.ok(!eventTypes.includes('mutation_failed'), String(eventTypes));
const leaseAfter = loadRows(ledgerPath).filter(
  (row) => row.kind === 'stage' && row.run_id === campaignId && row.stage === 'campaign',
).length;
assert.strictEqual(leaseAfter, leaseBefore);
fs.copyFileSync(`${ledgerPath}.park.bak`, ledgerPath);
const stopAuthority = {
  ...authority,
  reviews: [{
    review_digest: reviewDigest,
    decisions: [{
      finding_id: 'park-c-1',
      evidence: {
        kind: 'trace',
        trace_chain: ['contract.vertical_acceptance[0]'],
        confirmed_by: 'operator',
      },
      disposition: {
        disposition: 'follow-up',
        context: 'defer',
        trigger: 'later',
        proposed_backlog_title: 'Follow up park-c',
      },
    }],
  }],
};
const nonRepair = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/park-c', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: iso(5435),
  resume: true,
  campaignDispositionAuthority: stopAuthority,
}, adapters);
assert.strictEqual(nonRepair.status, 'admitted', JSON.stringify(nonRepair.rejection || nonRepair));
fs.copyFileSync(`${ledgerPath}.park.bak`, ledgerPath);
const fitResume = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/park-c', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: iso(5435),
  resume: true,
  campaignDispositionAuthority: authority,
  repairRoundEstimateSeconds: 100,
}, adapters);
assert.strictEqual(fitResume.status, 'admitted', JSON.stringify(fitResume.rejection || fitResume));
console.log('repair_resume_refused=true');
console.log('non_repair_resume_admitted=true');
console.log('fitting_estimate_resume_admitted=true');
NODE
)"
assert_exit_code "$?" "0" "park-c intake resume cases: $RESUME_OUT"
assert_contains "$RESUME_OUT" "repair_resume_refused=true" "repair-authorising resume refused"
assert_contains "$RESUME_OUT" "non_repair_resume_admitted=true" "non-repair disposition still resumes"
assert_contains "$RESUME_OUT" "fitting_estimate_resume_admitted=true" "fitting estimate still resumes"

finalize_test
