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
const D = 'a'.repeat(64);
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
  finalPanel: () => ({
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: '[]',
    review_digest: '7'.repeat(64),
  }),
});
assert.strictEqual(composition.status, 'ready');
assert.strictEqual(implementationCalls, 0);
assert(composition.trace.includes('resume_adopt_candidate'));

const observedAt = '2026-07-27T00:00:20.000Z';
const status = projectCampaignStatus({
  state: {
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
  },
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
  ...{
    state: {
      ...status,
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
    },
    latest_lease: { state: 'dead' },
  },
}, [
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-a', state: 'dead' },
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-b', state: 'dead' },
  { kind: 'stage', run_id: authority.campaign_id, stage: 'leaf-a', state: 'verified' },
], observedAt);
assert.strictEqual(reopenedLeafStatus.leaf_runs.latest_stage, 'leaf-a');

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
printf '%s\n' '{"mission_convergence":{"enforcement_mode":"shadow"}}' \
  > "$SBX/.claude/owner-kernel-governance.json"
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
  scope: 'focused',
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
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
let implementationCalls = 0;
const findings = JSON.stringify([{
  finding_id: 'icc-p3-note',
  claim: 'fixture note is outside the frozen acceptance',
  severity: '🔵',
  source: 'fixture',
}]);
const focusedDigest = canonicalDigest({
  verdict: 'SHIP-AS-IS',
  findings,
  scope: 'focused',
  tree_sha: tree,
});
if (focusedDigest !== durableReviewDigest) {
  throw new Error('fixture focused review digest drifted across processes');
}
const finalDigest = canonicalDigest({
  verdict: 'SHIP-AS-IS',
  findings,
  scope: 'final',
  tree_sha: tree,
});
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
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('resume must not repeat implementation');
  },
  reviewDispatcher() {
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
  gitWorktreeRemove() {
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
console.log(`durable_phase=${result.campaign_control.initial_state
  ? result.campaign_control.initial_state.phase
  : 'missing'}`);
console.log(`completion=${result.campaign_control.completion
  ? result.campaign_control.completion.status
  : 'missing'}`);
if (result.status !== 'converged') console.log(`blocked_result=${JSON.stringify(result)}`);
NODE
)"
assert_exit_code "$?" "0" "second campaign process resumes from durable Git truth"
assert_contains "$RESUME_OUT" "resume_status=converged" \
  "resumed campaign converges from the committed checkpoint"
assert_contains "$RESUME_OUT" "implementation_calls=0" \
  "resumed campaign does not repeat implementation"
assert_contains "$RESUME_OUT" "durable_phase=TERMINAL_READY" \
  "resumed campaign journals its terminal reducer state"
assert_contains "$RESUME_OUT" "completion=completed" \
  "terminal campaign closes its durable generation lease"

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
