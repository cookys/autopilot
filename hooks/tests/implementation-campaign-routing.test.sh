#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP/runner-transport-envelope.json" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const transportFixturePath = process.argv[3];
const {
  createRunnerTransportEnvelope,
} = require(path.join(root, 'src', 'transport', 'runner-envelope'));
const {
  compileCampaignDispositionPolicy,
  compileCampaignDispositionProvider,
  normalizeCampaignArtifactReference,
  normalizeProductReviewFindings,
  projectCampaignStatus,
  runCampaignComposition,
} = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const D = 'a'.repeat(64);
function finalPanelReceipt() {
  const seat = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_final_panel_seat',
    seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: 'SHIP-AS-IS', review_digest: '7'.repeat(64), reason: null,
  };
  seat.receipt_digest = canonicalDigest(seat);
  return {
    reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: '7'.repeat(64),
    sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat],
  };
}
const transport = createRunnerTransportEnvelope({
  runner: 'fixture',
  model: 'fixture-model',
  operation: 'review',
  argv: ['--diff-file', '/private/diff'],
  cwd: '/private/repo',
  child: {
    status: 0,
    signal: null,
    error: null,
    stdout: '{"verdict":"SHIP-AS-IS"}\n',
    stderr: '',
  },
  privateRawReference: {
    kind: 'private-file',
    locator: '/private/raw.log',
  },
});
assert.strictEqual(transport.artifact_type, 'runner_transport_envelope');
assert.strictEqual(transport.outcome.classification, 'success');
assert.strictEqual(transport.request_binding.runner, 'fixture');
assert.strictEqual(transport.private_raw_reference.kind, 'private-file');
assert(!JSON.stringify(transport).includes('SHIP-AS-IS'));
assert(!Object.prototype.hasOwnProperty.call(transport, 'verdict'));
fs.writeFileSync(
  transportFixturePath,
  `${JSON.stringify(transport, null, 2)}\n`,
);
assert.throws(() => normalizeCampaignArtifactReference({
  kind: 'product_review',
  digest: D,
  raw: 'must-not-enter-ledger',
}), /unknown field/i);

const normalized = normalizeProductReviewFindings([
  '🟠 [icc-p3-001] durable resume repeats implementation',
  '🔵 [icc-p3-002] status wording could be clearer',
].join('\n'));
assert.strictEqual(normalized.status, 'normalized');
assert.strictEqual(normalized.findings.length, 2);
assert.strictEqual(normalized.findings[0].finding_id, 'icc-p3-001');
const namedSeverity = normalizeProductReviewFindings(
  'Major [icc-p3-003] committed repair branch must remain resumable',
);
assert.strictEqual(namedSeverity.status, 'normalized');
assert.strictEqual(namedSeverity.findings[0].severity, '🟠');
assert.strictEqual(
  normalizeProductReviewFindings('🔴 Minor [mismatch] contradictory severity').status,
  'invalid',
);
assert.strictEqual(normalizeProductReviewFindings('ambiguous prose').status, 'invalid');
assert.strictEqual(normalizeProductReviewFindings('').status, 'invalid');

// P0 contract bridge: dispatch-review emits exact sentinel findings:"none" for clean
// SHIP-AS-IS reviews. Only that trimmed, case-insensitive word normalizes to [].
const cleanNone = normalizeProductReviewFindings('none');
assert.strictEqual(cleanNone.status, 'normalized');
assert.deepStrictEqual(cleanNone.findings, []);
assert.strictEqual(cleanNone.canonical, '[]');
assert.strictEqual(normalizeProductReviewFindings('NONE').status, 'normalized');
assert.deepStrictEqual(normalizeProductReviewFindings('NONE').findings, []);
assert.strictEqual(normalizeProductReviewFindings('  none  ').status, 'normalized');
assert.deepStrictEqual(normalizeProductReviewFindings('  none  ').findings, []);
assert.strictEqual(normalizeProductReviewFindings('no findings').status, 'invalid');
assert.strictEqual(normalizeProductReviewFindings('none found').status, 'invalid');
assert.strictEqual(normalizeProductReviewFindings('looks good').status, 'invalid');
// Classification retained in claim under normalizer severity/id grammar.
const mustFixLine = normalizeProductReviewFindings(
  '🟠 [stable-id-001] MUST-FIX parser accepts unsafe input; impact=RCE path; fix=reject non-ASCII',
);
assert.strictEqual(mustFixLine.status, 'normalized');
assert.strictEqual(mustFixLine.findings[0].finding_id, 'stable-id-001');
assert.match(mustFixLine.findings[0].claim, /^MUST-FIX /);
const cutLine = normalizeProductReviewFindings(
  '🔵 [stable-id-002] CUT/FOLLOW-UP nicer logging is optional and excluded from this version',
);
assert.strictEqual(cutLine.status, 'normalized');
assert.match(cutLine.findings[0].claim, /^CUT\/FOLLOW-UP /);
// Bare classification without severity/[id] remains invalid (dispatcher contract mismatch).
assert.strictEqual(
  normalizeProductReviewFindings('MUST-FIX parser accepts unsafe input').status,
  'invalid',
);

const authority = {
  schema_version: 1,
  artifact_type: 'campaign_disposition_authority',
  authority: 'depth-0',
  actor_id: 'owner/root',
  campaign_id: `campaign-v1-${'b'.repeat(64)}`,
  contract_digest: D,
  reviews: [{
    review_digest: 'c'.repeat(64),
    decisions: [{
      finding_id: 'icc-p3-001',
      evidence: {
        kind: 'trace',
        trace_chain: ['test:resume-replayed-implementation'],
        confirmed_by: 'owner/root',
      },
      disposition: {
        disposition: 'must-fix-now',
        acceptance_id: 'ICC-P3-RESUME',
        deferral_harm: 'duplicate mutations violate campaign authority',
      },
    }],
  }],
};
assert.throws(() => compileCampaignDispositionProvider({
  ...authority,
  authority: 'deterministic-policy',
}), /explicit policy rail/i);
const provider = compileCampaignDispositionProvider(authority);
const bound = provider({
  review: {
    findings: JSON.stringify([{
      finding_id: 'icc-p3-001',
      claim: 'durable resume repeats implementation',
      severity: '🟠',
      source: 'fixture',
    }]),
    review_digest: 'c'.repeat(64),
  },
  campaignId: authority.campaign_id,
  contractDigest: D,
});
assert.strictEqual(bound.review_digest, 'c'.repeat(64));
assert.strictEqual(bound.decisions.length, 1);
assert.throws(() => provider({
  review: {
    findings: JSON.stringify([{
      finding_id: 'icc-p3-001',
      claim: 'durable resume repeats implementation',
      severity: '🟠',
      source: 'fixture',
    }]),
    review_digest: 'd'.repeat(64),
  },
  campaignId: authority.campaign_id,
  contractDigest: D,
}), /review digest is stale/i);
assert.throws(() => provider({
  review: {
    findings: JSON.stringify([]),
    review_digest: 'd'.repeat(64),
  },
  campaignId: authority.campaign_id,
  contractDigest: 'e'.repeat(64),
}), /contract digest/i);
const denyNonempty = compileCampaignDispositionPolicy('deny-nonempty');
assert.strictEqual(denyNonempty({ review: { findings: '' } }), null);
assert.throws(() => denyNonempty({
  review: {
    findings: JSON.stringify([{
      finding_id: 'icc-p3-001',
      claim: 'must not self-authorize',
      severity: '🟠',
      source: 'fixture',
    }]),
  },
}), /refuses reviewer-authored/i);
const acceptanceBound = compileCampaignDispositionPolicy('acceptance-bound');
const policyReview = (claim) => ({
  review_digest: 'f'.repeat(64),
  findings: JSON.stringify([{
    finding_id: 'icc-p3-policy',
    claim,
    severity: '🟠',
    source: 'fixture',
  }]),
});
const policyContract = (criterion) => ({ vertical_acceptance: [criterion] });
const policyDisposition = (claim, criterion) => acceptanceBound({
  review: policyReview(claim),
  contract: policyContract(criterion),
}).decisions[0].disposition.disposition;
assert.strictEqual(
  policyDisposition('  Authenticated   Device Publication ', 'authenticated device publication'),
  'must-fix-now',
);
assert.throws(
  () => policyDisposition('auth', 'must reject unauthenticated publication'),
  /explicit depth-0 authority/,
);
assert.throws(
  () => policyDisposition(
    'authenticated device publication subsystem',
    'authenticated device publication',
  ),
  /explicit depth-0 authority/,
);
assert.throws(
  () => policyDisposition(
    'authenticated device publication',
    'must reject authenticated device publication',
  ),
  /explicit depth-0 authority/,
);
assert.throws(() => acceptanceBound({
  review: policyReview('   '),
  contract: policyContract('authenticated device publication'),
}), /has no claim/);

let implementationCalls = 0;
const candidate = {
  committed: true,
  commit: '1'.repeat(40),
  tree_sha: '2'.repeat(40),
  branch: 'feat/resume',
  writer_fence: { receipt_digest: '3'.repeat(64) },
};
const composition = runCampaignComposition({
  maxRepairGenerations: 1,
  minPanelSize: 1,
  resume: {
    phase: 'VERTICAL_VERIFICATION',
    repair_generation: 0,
    candidate,
  },
}, {
  preflight: () => ({ passed: true }),
  implement: () => {
    implementationCalls += 1;
    return candidate;
  },
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '4'.repeat(64) }),
  review: () => ({
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: '[]',
    review_digest: '5'.repeat(64),
  }),
  adjudicate: () => ({
    registry_complete: true,
    repair_gate_passed: true,
    registry_digest: '6'.repeat(64),
    must_fix_now: [],
    follow_up: [],
    rejected: [],
  }),
  convergence: () => ({ passed: true }),
  finalPanel: () => finalPanelReceipt(),
});
assert.strictEqual(composition.status, 'ready');
assert.strictEqual(implementationCalls, 0);
assert(composition.trace.includes('resume_adopt_candidate'));

const observedAt = '2026-07-27T00:00:20.000Z';
const campaignState = {
  campaign_id: authority.campaign_id,
  ticket: '057',
  profile: 'poc',
  phase: 'VERTICAL_VERIFICATION',
  generation: 0,
  limits: {
    max_repair_generations: 2,
    max_wall_seconds: 120,
    max_changed_files: 10,
    baseline_churn: 10,
    max_churn: 30,
  },
  usage: {
    repair_generations: 0,
    elapsed_wall_seconds: 10,
    changed_files: 2,
    churn: 12,
  },
  started_at: '2026-07-27T00:00:00.000Z',
  last_output_artifact_digest: D,
  terminal_reason: null,
};
const status = projectCampaignStatus({
  state: campaignState,
  latest_lease: {
    state: 'dead',
  },
}, [], observedAt);
assert.strictEqual(status.activity, 'dead');
assert.strictEqual(status.repair_generations_remaining, 2);
assert.strictEqual(status.wall_seconds_remaining, 100);
assert.deepStrictEqual(status.growth, { files: 2, churn: 12, ratio: 1.2 });
assert.strictEqual(status.last_artifact, D);
assert(!Object.prototype.hasOwnProperty.call(status, 'can_merge'));
assert(!Object.prototype.hasOwnProperty.call(status, 'can_close'));
const reopenedLeafStatus = projectCampaignStatus({
  state: campaignState,
  latest_lease: { state: 'dead' },
}, [
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-a', state: 'dead' },
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-b', state: 'dead' },
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-a', state: 'verified' },
], observedAt);
assert.strictEqual(reopenedLeafStatus.leaf_runs.latest_stage, 'leaf-a');
const failedLeafStatus = projectCampaignStatus({
  state: { ...campaignState, phase: 'TERMINAL_READY' },
  latest_lease: { state: 'quarantined' },
}, [
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-dead', state: 'leased' },
  {
    kind: 'stage',
    run_id: authority.campaign_id,
    stage: 'leaf-quarantined',
    state: 'quarantined',
  },
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-green', state: 'verified' },
], observedAt, {
  processLiveness: () => 'dead',
});
assert.strictEqual(failedLeafStatus.activity, 'dead');
assert.strictEqual(failedLeafStatus.leaf_runs.completed, 1);
assert.strictEqual(failedLeafStatus.leaf_runs.dead, 2);
assert.strictEqual(failedLeafStatus.leaf_runs.unknown, 0);

console.log('transport_envelope_mechanical=true');
console.log('product_review_normalizer_bounded=true');
console.log('disposition_authority_bound=true');
console.log('resume_skips_implementation=true');
console.log('campaign_status_raw=true');
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "ICC P3 routing contract process exits zero"
for key in transport_envelope_mechanical product_review_normalizer_bounded \
  disposition_authority_bound resume_skips_implementation campaign_status_raw; do
  assert_contains "$OUT" "$key=true" "ICC P3 proves $key"
done
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/runner-transport-envelope.schema.json" \
  --document "$TEST_TMP/runner-transport-envelope.json" >/dev/null
assert_exit_code "$?" "0" "shared runner transport envelope matches its closed schema"

SBX="$TEST_TMP/resume-repo"
mkdir -p "$SBX/.claude" "$SBX/src"
git -C "$SBX" init -q
git -C "$SBX" config user.email "campaign-p3@example.invalid"
git -C "$SBX" config user.name "Campaign P3 Test"
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow
printf 'base\n' > "$SBX/src/value.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm "base"
BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
git -C "$SBX" checkout -qb impl/p3-resume
printf 'candidate\n' > "$SBX/src/value.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm "candidate"
CANDIDATE_SHA="$(git -C "$SBX" rev-parse HEAD)"
CANDIDATE_TREE="$(git -C "$SBX" rev-parse HEAD^{tree})"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
COMMON_DIR="$(realpath "$SBX/$COMMON_RAW")"
CONTRACT="$TEST_TMP/resume-campaign.json"
SEAL="$TEST_TMP/resume-campaign.seal.json"
PROMPT="$TEST_TMP/resume-prompt.txt"
printf 'resume without duplicate implementation\n' > "$PROMPT"
node - "$CONTRACT" "$COMMON_DIR" "$BASE_SHA" <<'NODE'
const fs = require('fs');
const [target, commonDir, base] = process.argv.slice(2);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  ticket: 'icc-p3-resume',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/p3-resume',
  vertical_acceptance: ['resume verifies the committed candidate'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['ICC-P3-RESUME1'],
}, null, 2)}\n`);
NODE
SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --out "$SEAL" 2>&1)"
SEAL_EXIT=$?
assert_exit_code "$SEAL_EXIT" "0" "P3 resume fixture campaign seals: $SEAL_OUT"

BAD_AUTHORITY="$TEST_TMP/bad-authority.json"
printf '%s\n' '{"artifact_type":"reviewer-self-authorization"}' > "$BAD_AUTHORITY"
BAD_AUTH_OUT="$(node "$REPO_ROOT/bin/autopilot.js" engine implement-review \
  --campaign-contract "$CONTRACT" \
  --campaign-seal "$SEAL" \
  --campaign-disposition-authority "$BAD_AUTHORITY" \
  --prompt-file "$PROMPT" \
  --branch impl/p3-resume \
  --base "$BASE_SHA" \
  --cwd "$SBX" 2>&1)"
assert_exit_code "$?" "1" "malformed disposition authority fails before engine dispatch"
assert_contains "$BAD_AUTH_OUT" '"phase":"campaign_disposition_authority"' \
  "CLI reports a distinct pre-spend disposition-authority failure"

FIRST_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CANDIDATE_SHA" "$CANDIDATE_TREE" <<'NODE'
'use strict';
const path = require('path');
const [
  root,
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  candidate,
  tree,
] = process.argv.slice(2);
const {
  CAMPAIGN_EVENTS,
  appendCampaignEvent,
  canonicalDigest,
  createWriterFence,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const {
  loadRows,
  projectCampaign,
} = require(path.join(root, 'src', 'campaign', 'cli'));
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
let control = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  branch: 'impl/p3-resume',
  base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-07-27T00:00:00.000Z',
}, adapters);
const writerFence = createWriterFence({
  campaignId: control.campaign_id,
  stageIdentity: 'campaign-implementation',
  candidateCommit: candidate,
  candidateTreeSha: tree,
  implementationResult: {
    status: 'committed',
    implementation: { commit: candidate },
    implementationResult: {
      error: null,
      signal: null,
      status: 0,
    },
  },
});
const repairLineage = {
  lineage_id: control.campaign_id,
  branch: 'impl/p3-resume',
  worktree: repo,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: 'b'.repeat(64),
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: 0,
  inherited_churn: 0,
  delta_churn: 2,
  retention_owner: control.campaign_id,
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
  accepted_invariants_source_commit: candidate,
  accepted_invariants_digest: canonicalDigest({
    schema: 1,
    assertions: ['preserve durable invariant'],
    source_commit: candidate,
  }),
  prior_review_finding_ids: [],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/example.js'],
  repair_scope_seal: null,
};
let appended = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-27T00:00:01.000Z',
  eventType: CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { sealed_contract: true },
});
control = { ...control, initial_state: appended.state };
appended = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-27T00:00:02.000Z',
  eventType: CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  usage: { changed_files: 1, churn: 2 },
  payload: {
    scope_check_passed: true,
    scope_check_digest: 'd'.repeat(64),
  },
  artifactReference: {
    kind: 'git_candidate',
    commit: candidate,
    tree_sha: tree,
    branch: 'impl/p3-resume',
    base,
    writer_fence: writerFence,
    repair_lineage: repairLineage,
  },
});
control = { ...control, initial_state: appended.state };
appended = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-27T00:00:02.100Z',
  eventType: CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
  generation: 0,
  stageIdentity: 'campaign-verification:0',
  payload: {
    passed: true,
    evidence_digest: 'e'.repeat(64),
  },
  artifactReference: {
    kind: 'verification_receipt',
    digest: 'e'.repeat(64),
  },
});
control = { ...control, initial_state: appended.state };
const findings = JSON.stringify([{
  finding_id: 'icc-p3-note',
  claim: 'fixture note is outside the frozen acceptance',
  severity: '🔵',
  source: 'fixture',
}]);
const reviewDigest = canonicalDigest({
  verdict: 'SHIP-AS-IS',
  findings,
  scope: 'full_diff',
  tree_sha: tree,
});
appended = appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-07-27T00:00:02.200Z',
  eventType: CAMPAIGN_EVENTS.REVIEW_COMPLETED,
  generation: 0,
  stageIdentity: 'campaign-review:0',
  payload: { review_digest: reviewDigest },
  artifactReference: {
    kind: 'product_review',
    digest: reviewDigest,
    repair_lineage: {
      ...repairLineage,
      prior_review_finding_ids: ['icc-p3-note'],
    },
  },
});
console.log(`campaign_id=${control.campaign_id}`);
console.log(`checkpoint_phase=${appended.state.phase}`);
console.log(`review_digest=${reviewDigest}`);
console.log(`last_reference=${projectCampaign(
  loadRows(control.generation_claim.ledger),
  control.campaign_id,
).last_artifact_reference.kind}`);
NODE
)"
assert_exit_code "$?" "0" "first campaign process journals its committed candidate"
assert_contains "$FIRST_OUT" "checkpoint_phase=ADJUDICATING" \
  "candidate and exact focused-review digest are durable before process exit"
assert_contains "$FIRST_OUT" "last_reference=product_review" \
  "ledger projection retains the focused-review artifact reference"
CAMPAIGN_ID="$(printf '%s\n' "$FIRST_OUT" | sed -n 's/^campaign_id=//p')"
assert_neq "$CAMPAIGN_ID" "" "first campaign process emits durable campaign identity"
REVIEW_DIGEST="$(printf '%s\n' "$FIRST_OUT" | sed -n 's/^review_digest=//p')"
assert_neq "$REVIEW_DIGEST" "" "first campaign process emits its bound review digest"

# Managed resume is the only terminal replay path. It must reject any mismatch
# between the durable candidate and current immutable Git truth before adopting
# the candidate or dispatching another implementation.
resume_intake_probe() {
  node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" "$BASE_SHA" <<'NODE'
'use strict';
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const result = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  branch: 'impl/p3-resume',
  base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-07-27T00:00:02.400Z',
  resume: true,
}, {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
console.log(`status=${result.status}`);
console.log(`code=${result.rejection ? result.rejection.code : 'none'}`);
NODE
}

git -C "$SBX" update-ref refs/heads/impl/p3-resume "$BASE_SHA"
BRANCH_DRIFT_OUT="$(resume_intake_probe)"
assert_contains "$BRANCH_DRIFT_OUT" "status=blocked" \
  "managed resume rejects branch-tip drift"
assert_contains "$BRANCH_DRIFT_OUT" "code=campaign_resume_git_drift" \
  "branch-tip drift fails at exact Git-truth reconciliation"
git -C "$SBX" update-ref refs/heads/impl/p3-resume "$CANDIDATE_SHA"

BASE_TREE="$(git -C "$SBX" rev-parse "$BASE_SHA^{tree}")"
TREE_REPLACEMENT="$(printf 'tree drift replacement\n' \
  | git -C "$SBX" commit-tree "$BASE_TREE" -p "$BASE_SHA")"
git -C "$SBX" replace "$CANDIDATE_SHA" "$TREE_REPLACEMENT"
TREE_DRIFT_OUT="$(resume_intake_probe)"
assert_contains "$TREE_DRIFT_OUT" "status=blocked" \
  "managed resume rejects candidate-tree drift"
assert_contains "$TREE_DRIFT_OUT" "code=campaign_resume_git_drift" \
  "tree drift fails at exact Git-truth reconciliation"
git -C "$SBX" replace -d "$CANDIDATE_SHA" >/dev/null

OFF_BASE="$(printf 'off-base root\n' | git -C "$SBX" commit-tree "$BASE_TREE")"
BASE_DRIFT_REPLACEMENT="$(printf 'base ancestry drift replacement\n' \
  | git -C "$SBX" commit-tree "$CANDIDATE_TREE" -p "$OFF_BASE")"
git -C "$SBX" replace "$CANDIDATE_SHA" "$BASE_DRIFT_REPLACEMENT"
BASE_DRIFT_OUT="$(resume_intake_probe)"
assert_contains "$BASE_DRIFT_OUT" "status=blocked" \
  "managed resume rejects base-ancestry drift"
assert_contains "$BASE_DRIFT_OUT" "code=campaign_resume_git_drift" \
  "base ancestry drift fails at exact Git-truth reconciliation"
git -C "$SBX" replace -d "$CANDIDATE_SHA" >/dev/null

PRE_RESUME_OUT="$(node - "$REPO_ROOT" "$SBX" "$CAMPAIGN_ID" <<'NODE'
const path = require('path');
const [root, repo, campaignId] = process.argv.slice(2);
const { runCampaignCli } = require(path.join(root, 'src', 'campaign', 'cli'));
process.exitCode = runCampaignCli([
  'resume',
  '--campaign-id', campaignId,
], {
  cwd: repo,
  now: () => '2026-07-27T00:00:02.500Z',
});
NODE
)"
assert_exit_code "$?" "0" "campaign resume command recognizes the adjudication checkpoint"
assert_contains "$PRE_RESUME_OUT" '"status":"resumable"' \
  "campaign resume reports the bound adjudication checkpoint as resumable"

RESUME_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CANDIDATE_SHA" "$CANDIDATE_TREE" "$CAMPAIGN_ID" "$REVIEW_DIGEST" <<'NODE'
'use strict';
const path = require('path');
const [
  root,
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  candidate,
  tree,
  campaignId,
  durableReviewDigest,
] = process.argv.slice(2);
const {
  AutopilotEngine,
  canonicalDigest,
  compileCampaignDispositionProvider,
  repairLineageCleanupId,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'gpt-5.6',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 3,
  required_review_families: 2,
  cross_family_required: true,
  qc_panel_seats_complete: true,
  qc_panel_seats: [
    { role: 'qc', runner: 'fixture-a', model: 'gpt-5.5', effort: 'high', endpoint: null, family: 'openai' },
    { role: 'qc', runner: 'fixture-b', model: 'claude-opus', effort: 'high', endpoint: null, family: 'anthropic' },
    { role: 'qc', runner: 'fixture-c', model: 'grok-4.5', effort: 'high', endpoint: null, family: 'xai' },
  ],
  fallback_ladder: [
    { runner: 'fixture-a', model: 'gpt-5.5', effort: 'high', family: 'openai' },
    { runner: 'fixture-b', model: 'claude-opus', effort: 'high', family: 'anthropic' },
    { runner: 'fixture-c', model: 'grok-4.5', effort: 'high', family: 'xai' },
  ],
};
let implementationCalls = 0;
let reviewCalls = 0;
let intakeAcceptedInvariants = [];
const findings = JSON.stringify([{
  finding_id: 'icc-p3-note',
  claim: 'fixture note is outside the frozen acceptance',
  severity: '🔵',
  source: 'fixture',
}]);
const focusedDigest = canonicalDigest({
  verdict: 'SHIP-AS-IS',
  findings,
  scope: 'full_diff',
  tree_sha: tree,
});
if (focusedDigest !== durableReviewDigest) {
  throw new Error('fixture focused review digest drifted across processes');
}
const finalSeatDigest = canonicalDigest({
  verdict: 'SHIP-AS-IS',
  findings,
  scope: 'final',
  tree_sha: tree,
});
const finalDigest = canonicalDigest([finalSeatDigest, finalSeatDigest, finalSeatDigest]);
const decision = {
  finding_id: 'icc-p3-note',
  evidence: {
    kind: 'trace',
    trace_chain: ['fixture:outside-frozen-acceptance'],
    confirmed_by: 'owner/root',
  },
  disposition: {
    disposition: 'reject-out-of-scope',
    rationale: 'does not protect the frozen vertical acceptance',
  },
};
const cleanupActions = [];
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-27T00:00:03.000Z',
  campaignDispositionProvider: compileCampaignDispositionProvider({
    schema_version: 1,
    artifact_type: 'campaign_disposition_authority',
    authority: 'depth-0',
    actor_id: 'owner/root',
    campaign_id: campaignId,
    contract_digest: JSON.parse(require('fs').readFileSync(
      sealPath,
      'utf8',
    )).contract_sha256,
    reviews: [
      { review_digest: focusedDigest, decisions: [decision] },
      { review_digest: finalDigest, decisions: [decision] },
    ],
  }),
  campaignIntake(input) {
    const control = runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
    intakeAcceptedInvariants = [
      ...(control.generation_claim.resume_candidate.repair_lineage.accepted_invariants || []),
    ];
    return control;
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('resume must not repeat implementation');
  },
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'fixture',
        model: 'fixture-reviewer',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings,
        raw_log: null,
        error: null,
      },
    };
  },
  diffProvider() {
    return promptFile;
  },
  gitWorktreeAdd() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      worktree: repo,
      parent: null,
      commit: candidate,
      observed_commit: candidate,
      observed_tree_sha: tree,
      detached: true,
    };
  },
  gitWorktreeRemove(input) {
    if (input.expectedRootRunId) {
      cleanupActions.push('remove');
      if (input.expectedBranch !== 'impl/p3-resume'
          || input.expectedTip !== candidate
          || input.expectedRootRunId !== campaignId
          || input.expectedRetentionOwner !== campaignId
          || input.expectedRetentionReason !== 'implementation-campaign-repair-lineage') {
        throw new Error('cleanup did not receive exact retained worktree authority');
      }
    }
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
  repairLineageCleanupTransaction({ cleanupId, record }) {
    cleanupActions.push('remove');
    if (record.branch !== 'impl/p3-resume'
        || record.expected_tip !== candidate
        || record.lineage_id !== campaignId
        || record.retention_owner !== campaignId
        || record.retention_reason !== 'implementation-campaign-repair-lineage') {
      throw new Error('cleanup transaction did not receive exact retained worktree authority');
    }
    const journal = require('path').join(
      repo,
      '.git',
      'autopilot',
      'repair-lineage-cleanup.jsonl',
    );
    require('fs').mkdirSync(require('path').dirname(journal), { recursive: true });
    const rows = ['intent', 'removed_clean'].map((action) => {
      const row = {
        schema: 1,
        cleanup_id: cleanupId,
        action,
        ...record,
      };
      row.record_digest = canonicalDigest(row);
      return JSON.stringify(row);
    });
    require('fs').appendFileSync(journal, `${rows.join('\n')}\n`);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
  verifyCommandRunner({ verifyCmd }) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      executed_argv: ['/bin/sh', '-c', verifyCmd],
    };
  },
});
const result = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/p3-resume',
  base,
  roster,
  campaignContract: contractPath,
  campaignSeal: sealPath,
  resume: true,
  verificationEnv: {
    PATH: process.env.PATH || '',
    CI: 'p3-resume',
  },
  verificationEnvAllowlist: ['CI'],
});
console.log(`resume_status=${result.status}`);
console.log(`resume_phase=${result.phase}`);
console.log(`implementation_calls=${implementationCalls}`);
console.log(`review_calls=${reviewCalls}`);
console.log(`durable_phase=${result.campaign_control.initial_state
  ? result.campaign_control.initial_state.phase
  : 'missing'}`);
console.log(`completion=${result.campaign_control.completion
  ? result.campaign_control.completion.status
  : 'missing'}`);
console.log(`resumed_prior_findings=${
  result.repair_lineage.prior_review_finding_ids.join(',')
}`);
console.log(`resumed_delta_churn=${result.repair_lineage.delta_churn}`);
console.log(`resumed_input_bytes=${result.repair_lineage.new_input_bytes}`);
console.log(`resumed_input_tokens=${result.repair_lineage.new_input_tokens}`);
console.log(`resumed_accepted_invariants=${
  result.repair_lineage.accepted_invariants.join(',')
}`);
console.log(`intake_accepted_invariants=${intakeAcceptedInvariants.join(',')}`);
console.log(`resumed_invariant_source=${
  result.repair_lineage.accepted_invariants_source_commit
}`);
console.log(`cleanup_identity_shared=${
  result.repair_lineage.cleanup_receipt_id === repairLineageCleanupId({
    lineageId: result.repair_lineage.lineage_id,
    branch: result.repair_lineage.branch,
    worktree: result.repair_lineage.worktree,
    expectedTip: candidate,
    cleanupEpoch: result.repair_lineage.cleanup_epoch,
    worktreeInstanceId: result.repair_lineage.worktree_instance_id,
  })
}`);
const cleanupRows = require('fs').readFileSync(
  require('path').join(repo, '.git', 'autopilot', 'repair-lineage-cleanup.jsonl'),
  'utf8',
).trim().split('\n').map((line) => JSON.parse(line))
  .filter((row) => row.cleanup_id === result.repair_lineage.cleanup_receipt_id);
console.log(`cleanup_transaction=${
  [cleanupRows[0].action, ...cleanupActions, cleanupRows[1].action].join(',')
}`);
if (result.status !== 'converged') console.log(`blocked_result=${JSON.stringify(result)}`);
NODE
)"
assert_exit_code "$?" "0" "second campaign process resumes from durable Git truth"
assert_contains "$RESUME_OUT" "resume_status=converged" \
  "resumed campaign converges from the committed checkpoint"
assert_contains "$RESUME_OUT" "implementation_calls=0" \
  "resumed campaign does not repeat implementation"
assert_contains "$RESUME_OUT" "review_calls=4" \
  "focused review stays single-seat while terminal QC fans out to all three sealed seats"
assert_contains "$RESUME_OUT" "durable_phase=TERMINAL_READY" \
  "resumed campaign journals its terminal reducer state"
assert_contains "$RESUME_OUT" "completion=completed" \
  "terminal campaign closes its durable generation lease"
assert_contains "$RESUME_OUT" "resumed_prior_findings=icc-p3-note" \
  "resume rehydrates the durable finding lineage, not only Git resources"
assert_contains "$RESUME_OUT" "resumed_delta_churn=2" \
  "resume rehydrates cumulative repair churn"
assert_contains "$RESUME_OUT" "resumed_input_bytes=17" \
  "resume rehydrates cumulative repair input bytes"
assert_contains "$RESUME_OUT" "resumed_input_tokens=23" \
  "resume rehydrates cumulative provider token usage"
assert_contains "$RESUME_OUT" "intake_accepted_invariants=preserve durable invariant" \
  "intake rehydrates accepted invariant assertions after compaction"
assert_contains "$RESUME_OUT" \
  "resumed_accepted_invariants=resume verifies the committed candidate" \
  "post-resume GREEN verification refreshes the durable invariant assertions"
assert_contains "$RESUME_OUT" "resumed_invariant_source=$CANDIDATE_SHA" \
  "resume rehydrates the accepted invariant source commit"
assert_contains "$RESUME_OUT" "cleanup_transaction=intent,remove,removed_clean" \
  "terminal cleanup journals intent and result around exact-identity removal"
assert_contains "$RESUME_OUT" "cleanup_identity_shared=true" \
  "terminal writer and durable recovery share the complete cleanup identity"

STATUS_OUT="$(node - "$REPO_ROOT" "$SBX" "$CAMPAIGN_ID" <<'NODE'
const path = require('path');
const [root, repo, campaignId] = process.argv.slice(2);
const { runCampaignCli } = require(path.join(root, 'src', 'campaign', 'cli'));
process.exitCode = runCampaignCli([
  'status',
  '--campaign-id', campaignId,
], {
  cwd: repo,
  now: () => '2026-07-27T00:00:04.000Z',
});
NODE
)"
assert_exit_code "$?" "0" "third process reads campaign status from the canonical ledger"
assert_contains "$STATUS_OUT" '"activity":"completed"' \
  "campaign status reports the closed durable campaign as completed"
assert_contains "$STATUS_OUT" '"phase":"TERMINAL_READY"' \
  "campaign status preserves the terminal reducer phase"
assert_contains "$STATUS_OUT" '"lifecycle_receipt_ref":"unknown"' \
  "campaign status does not invent a downstream lifecycle receipt"
assert_not_contains "$STATUS_OUT" '"can_merge"' \
  "raw campaign status does not infer merge authority"
assert_not_contains "$STATUS_OUT" '"can_close"' \
  "raw campaign status does not infer close authority"

ROUTING="$(sed -n '1,240p' \
  "$REPO_ROOT/skills/l5/SKILL.md" \
  "$REPO_ROOT/skills/l6/SKILL.md" \
  "$REPO_ROOT/skills/ceo-agent/SKILL.md" \
  "$REPO_ROOT/skills/dev-flow/SKILL.md")"
assert_contains "$ROUTING" "engine implement-review --campaign-contract" \
  "mutating lifecycle skills name the canonical campaign entry"

finalize_test
