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
const composition = runCampaignComposition({ promptBytes: 0, maxRepairGenerations: 1,
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

# Disposition resume must rebind the findings the AWAITING_DISPOSITION wait
# persisted (2026-09-14 dogfood, mission-3b68ecb09a61): the durable snapshot was
# `[]` because the AUTHORITY_REQUIRED fallback read review.findings — a JSON
# string — through Array.isArray, and the resume binder then handed the array
# to a provider that only reads the string. Both halves are exercised here with
# the engine-shaped adjudicate adapter (provider + real adjudicator).
DISPOSITION_RESUME_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const { runCampaignComposition } = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const { adjudicateCampaignReview } = require(path.join(root, 'src', 'engine', 'campaign-adjudication'));
const {
  compileCampaignDispositionProvider,
} = require(path.join(root, 'src', 'engine', 'campaign-disposition-authority'));

const D = 'a'.repeat(64);
const CAMPAIGN_ID = `campaign-v1-${'b'.repeat(64)}`;
const REVIEW_DIGEST = 'c'.repeat(64);
const finalPanel = () => {
  const seat = {
    schema_version: 1, artifact_type: 'implementation_campaign_final_panel_seat', seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: 'SHIP-AS-IS', review_digest: '7'.repeat(64), reason: null,
  };
  seat.receipt_digest = canonicalDigest(seat);
  return {
    reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: '7'.repeat(64),
    sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat],
  };
};
const candidate = {
  committed: true, commit: '1'.repeat(40), tree_sha: '2'.repeat(40),
  branch: 'feat/disposition-resume', writer_fence: { receipt_digest: '3'.repeat(64) },
};
const rawFinding = {
  finding_id: 'icc-dr-001',
  claim: 'MUST-FIX disposition resume drops the persisted findings',
  severity: '🟠',
  source: 'fixture',
};
// Exactly what the engine's adjudicate adapter does: provider may throw →
// registry incomplete with the provider's message; otherwise real adjudicator.
const engineAdjudicate = (provider) => ({ review }) => {
  let dispositionAuthority = null;
  if (provider) {
    try {
      dispositionAuthority = provider({ review, campaignId: CAMPAIGN_ID, contractDigest: D });
    } catch (error) {
      return {
        registry_complete: false, repair_gate_passed: false, reason: error.message,
        must_fix_now: [], follow_up: [], rejected: [],
      };
    }
  }
  return adjudicateCampaignReview({
    review, convergenceVerdict: 'SHIP-AS-IS', dispositionAuthority,
    now: '2026-09-14T00:00:00.000Z',
  });
};
const adapters = (provider, sink) => ({
  preflight: () => ({ passed: true }),
  implement: () => candidate,
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '4'.repeat(64) }),
  review: () => ({
    reviewed: true, success: true, verdict: 'FIX-THEN-SHIP',
    findings: JSON.stringify([rawFinding]), review_digest: REVIEW_DIGEST,
  }),
  adjudicate: engineAdjudicate(provider),
  convergence: () => ({ passed: true }),
  finalPanel,
  onControllerUpdate: (controller) => sink.controllers.push(JSON.parse(JSON.stringify(controller))),
  onCampaignEvent: (event) => sink.events.push(event.event_type),
});
const authority = {
  schema_version: 1, artifact_type: 'campaign_disposition_authority', authority: 'depth-0',
  actor_id: 'owner/root', campaign_id: CAMPAIGN_ID, contract_digest: D,
  reviews: [{
    review_digest: REVIEW_DIGEST,
    decisions: [{
      finding_id: rawFinding.finding_id,
      evidence: { kind: 'trace', trace_chain: ['test:disposition-resume'], confirmed_by: 'owner/root' },
      disposition: {
        disposition: 'must-fix-now', acceptance_id: 'ICC-DR', deferral_harm: 'stranded campaign',
      },
    }],
  }],
};
const provider = compileCampaignDispositionProvider(authority);
const resumeFrom = (controller, findings) => ({
  phase: controller.phase,
  repair_generation: 0,
  candidate: controller.candidate,
  controller,
  verification: controller.verification_receipt,
  review: controller.review_payload,
  findings,
  full_diff_barriers: controller.full_diff_barriers,
});

// (1) Fresh run, no authority → durable wait persists the RAW finding objects.
const first = { controllers: [], events: [] };
const wait = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  adapters(null, first),
);
assert.strictEqual(wait.status, 'awaiting_disposition');
assert.deepStrictEqual(first.events, ['AWAITING_DISPOSITION']);
const persisted = first.controllers.at(-1);
assert.strictEqual(persisted.phase, 'awaiting_disposition');
assert.deepStrictEqual(persisted.findings_snapshot, [rawFinding]);
assert.deepStrictEqual(persisted.unresolved_findings, [rawFinding]);
assert.strictEqual(typeof persisted.review_payload.findings, 'string');
console.log('awaiting_disposition_snapshot_nonempty=true');

// (2) Resume with a valid depth-0 authority, rebinding the persisted snapshot
// the way autopilot-engine does (findings_snapshot || unresolved_findings).
const second = { controllers: [], events: [] };
const resumed = runCampaignComposition({
  promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1,
  controller: persisted,
  resume: resumeFrom(persisted, persisted.findings_snapshot || persisted.unresolved_findings),
}, adapters(provider, second));
assert.notStrictEqual(resumed.phase, 'disposition_resume', resumed.reason);
assert.strictEqual(second.events[0], 'DISPOSITION_RESUMED');
assert(resumed.trace.includes('resume_disposition_only'));
assert(resumed.trace.indexOf('repair') > resumed.trace.indexOf('adjudicate'),
  'must-fix-now disposition proceeds into repair');
console.log('disposition_resume_rebinds_snapshot=true');

// (3) Controllers persisted before this fix carry `findings_snapshot: []`; the
// review_payload findings string is still authoritative and must not be erased.
const legacy = { ...persisted, findings_snapshot: [], unresolved_findings: [] };
const third = { controllers: [], events: [] };
const legacyResumed = runCampaignComposition({
  promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1,
  controller: legacy,
  resume: resumeFrom(legacy, legacy.findings_snapshot),
}, adapters(provider, third));
assert.notStrictEqual(legacyResumed.phase, 'disposition_resume', legacyResumed.reason);
assert.strictEqual(third.events[0], 'DISPOSITION_RESUMED');
console.log('legacy_empty_snapshot_resumes=true');
NODE
)"
assert_exit_code "$?" "0" "disposition resume process exits zero: $DISPOSITION_RESUME_OUT"
for key in awaiting_disposition_snapshot_nonempty disposition_resume_rebinds_snapshot \
  legacy_empty_snapshot_resumes; do
  assert_contains "$DISPOSITION_RESUME_OUT" "$key=true" "disposition resume proves $key"
done

# A reviewer no_verdict (format/transport fault) is a GATE fault on a sealed,
# verified candidate. It used to be a terminal block — the engine then released
# the Mission claim and `--resume` met "claim is released or terminal"
# (2026-09-14 dogfood, MiniMax no_verdict). Now it is a resumable durable wait
# checkpointed at VERTICAL_VERIFICATION; the resume re-runs the review seat and
# never re-dispatches the implementer.
NO_VERDICT_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const { runCampaignComposition } = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));

const finalPanel = () => {
  const seat = {
    schema_version: 1, artifact_type: 'implementation_campaign_final_panel_seat', seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: 'SHIP-AS-IS', review_digest: '7'.repeat(64), reason: null,
  };
  seat.receipt_digest = canonicalDigest(seat);
  return {
    reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: '7'.repeat(64),
    sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat],
  };
};
const candidate = {
  committed: true, commit: '1'.repeat(40), tree_sha: '2'.repeat(40),
  branch: 'feat/no-verdict', writer_fence: { receipt_digest: '3'.repeat(64) },
};
const cleanAdjudication = () => ({
  registry_complete: true, repair_gate_passed: true, registry_digest: '6'.repeat(64),
  must_fix_now: [], follow_up: [], rejected: [],
});
const build = (reviewImpl, sink) => ({
  preflight: () => ({ passed: true }),
  implement: () => { sink.implementCalls += 1; return candidate; },
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '4'.repeat(64) }),
  review: () => { sink.reviewCalls += 1; return reviewImpl(); },
  adjudicate: cleanAdjudication,
  convergence: () => ({ passed: true }),
  finalPanel,
  onControllerUpdate: (controller) => sink.controllers.push(JSON.parse(JSON.stringify(controller))),
  onCampaignEvent: (event) => sink.events.push(event.event_type),
});
const resumeFrom = (controller) => ({
  phase: controller.phase,
  repair_generation: 0,
  candidate: controller.candidate,
  controller,
  verification: controller.verification_receipt,
  review: controller.review_payload,
  findings: null,
  full_diff_barriers: controller.full_diff_barriers,
});
// performReview wraps reviewDiff()'s return as `raw`; reviewDiff collapses every
// non-reviewed dispatch to status:'blocked', phase:'dispatch_review' and keeps
// the dispatcher's parsed status only at raw.reviewResult.result.status.
const dispatchRaw = (result, extra = {}) => ({
  status: 'blocked',
  phase: 'dispatch_review',
  reason: 'review dispatch result status',
  reviewResult: { error: null, signal: null, status: 0, parseError: null, result, ...extra },
});
const withNoVerdict = (raw, phase) => () => ({
  reviewed: false,
  phase,
  reason: 'review status no_verdict',
  raw,
});

// (1) transport-shaped no_verdict → durable, resumable, checkpointed.
const first = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const wait = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  build(withNoVerdict(dispatchRaw({ status: 'no_verdict' }), undefined), first),
);
assert.strictEqual(wait.status, 'blocked');
assert.strictEqual(wait.phase, 'full_diff_review');
assert.strictEqual(wait.code, 'review_no_verdict');
assert.strictEqual(wait.durable_wait, true);
assert.strictEqual(wait.terminalize, false);
assert.strictEqual(wait.resumable, true);
const checkpoint = first.controllers.at(-1);
assert.strictEqual(checkpoint.phase, 'VERTICAL_VERIFICATION');
assert.strictEqual(checkpoint.next_action, 'retry_full_diff_review');
assert.strictEqual(checkpoint.candidate.commit, candidate.commit);
assert.strictEqual(checkpoint.candidate.committed, true);
assert.strictEqual(checkpoint.verification_receipt.receipt_digest, '4'.repeat(64));
console.log('no_verdict_is_durable_wait=true');

// (2) resume from that checkpoint: the seat is re-run, the implementer is not.
const second = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const resumed = runCampaignComposition({
  promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1,
  controller: checkpoint,
  resume: resumeFrom(checkpoint),
}, build(() => ({
  reviewed: true, success: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: '5'.repeat(64),
}), second));
assert.strictEqual(resumed.status, 'ready', resumed.reason);
assert.strictEqual(second.implementCalls, 0, 'resume must not re-dispatch the implementer');
assert.strictEqual(second.reviewCalls, 1, 'resume re-runs exactly one review seat');
assert(resumed.trace.includes('resume_adopt_candidate'));
console.log('no_verdict_resume_reruns_seat=true');

// (3) findings that fail normalization are the same gate fault.
const third = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const parserWait = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  build(withNoVerdict({ status: 'reviewed', review: { findings: 'prose' } }, 'product_review_normalization'), third),
);
assert.strictEqual(parserWait.durable_wait, true);
assert.strictEqual(parserWait.phase, 'product_review_normalization');
assert.strictEqual(third.controllers.at(-1).phase, 'VERTICAL_VERIFICATION');
console.log('parser_fault_is_durable_wait=true');

// (4) a reviewer precondition (qualification) fault is NOT the candidate's
// gate to retry — it stays a terminal block, exactly as before.
const fourth = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const terminal = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  build(withNoVerdict(dispatchRaw({ status: 'precondition_failed' }), undefined), fourth),
);
assert.strictEqual(terminal.status, 'blocked');
assert.notStrictEqual(terminal.durable_wait, true);
assert.notStrictEqual(fourth.controllers.at(-1).next_action, 'retry_full_diff_review');
console.log('precondition_fault_stays_terminal=true');

// (5) a pre-dispatch block (reviewer qualification) never reaches the
// dispatcher — no reviewResult at all — and stays terminal.
const fifth = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const preDispatch = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  build(withNoVerdict({ status: 'blocked', phase: 'reviewer_qualification', reason: 'unqualified' }, undefined), fifth),
);
assert.strictEqual(preDispatch.status, 'blocked');
assert.notStrictEqual(preDispatch.durable_wait, true);
console.log('pre_dispatch_block_stays_terminal=true');

// (6) transport fault (no parsed result) is a gate fault too.
const sixth = { controllers: [], events: [], implementCalls: 0, reviewCalls: 0 };
const transport = runCampaignComposition(
  { promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1 },
  build(withNoVerdict(dispatchRaw(null, { status: 1, error: new Error('ECONNRESET') }), undefined), sixth),
);
assert.strictEqual(transport.durable_wait, true);
assert.strictEqual(sixth.controllers.at(-1).next_action, 'retry_full_diff_review');
console.log('transport_fault_is_durable_wait=true');
NODE
)"
assert_exit_code "$?" "0" "reviewer no_verdict process exits zero: $NO_VERDICT_OUT"
for key in no_verdict_is_durable_wait no_verdict_resume_reruns_seat \
  parser_fault_is_durable_wait precondition_fault_stays_terminal \
  pre_dispatch_block_stays_terminal transport_fault_is_durable_wait; do
  assert_contains "$NO_VERDICT_OUT" "$key=true" "reviewer no_verdict proves $key"
done

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
CANDIDATE_WORKTREE="$TEST_TMP/resume-candidate-worktree"
# Keep the controller checkout at the frozen base; the candidate is owned by a
# separate registered worktree, as it is in the production campaign topology.
git -C "$SBX" worktree add -q -b impl/p3-resume "$CANDIDATE_WORKTREE" "$BASE_SHA"
printf 'candidate\n' > "$CANDIDATE_WORKTREE/src/value.txt"
git -C "$CANDIDATE_WORKTREE" add .
git -C "$CANDIDATE_WORKTREE" commit -qm "candidate"
CANDIDATE_SHA="$(git -C "$CANDIDATE_WORKTREE" rev-parse HEAD)"
CANDIDATE_TREE="$(git -C "$CANDIDATE_WORKTREE" rev-parse HEAD^{tree})"
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
BAD_AUTH_OUT="$(env -u AUTOPILOT_LEVEL node "$REPO_ROOT/bin/autopilot.js" engine implement-review \
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

FIRST_OUT="$(node - "$REPO_ROOT" "$SBX" "$CANDIDATE_WORKTREE" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CANDIDATE_SHA" "$CANDIDATE_TREE" <<'NODE'
'use strict';
const path = require('path');
const [
  root,
  repo,
  candidateWorktree,
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
  worktreeInstanceId,
} = require(path.join(root, 'src', 'engine', 'repair-lineage-cleanup'));
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
  worktree: candidateWorktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: worktreeInstanceId(candidateWorktree),
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

RESUME_OUT="$(node - "$REPO_ROOT" "$SBX" "$CANDIDATE_WORKTREE" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CANDIDATE_SHA" "$CANDIDATE_TREE" "$CAMPAIGN_ID" "$REVIEW_DIGEST" <<'NODE'
'use strict';
const path = require('path');
const [
  root,
  repo,
  candidateWorktree,
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
      worktree: candidateWorktree,
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
    if (record.branch !== 'impl/p3-resume'
        || record.worktree !== candidateWorktree
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
    const makeRow = (action) => {
      const row = {
        schema: 1,
        cleanup_id: cleanupId,
        action,
        ...record,
      };
      row.record_digest = canonicalDigest(row);
      return JSON.stringify(row);
    };
    require('fs').appendFileSync(journal, `${makeRow('intent')}\n`);
    require('child_process').execFileSync(
      'git',
      ['-C', repo, 'worktree', 'remove', record.worktree],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    cleanupActions.push('remove');
    require('fs').appendFileSync(journal, `${makeRow('removed_clean')}\n`);
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
if (result.status !== 'converged') {
  throw new Error(`managed resume blocked: ${JSON.stringify(result)}`);
}
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

# Durable-wait resume candidate shape + pre-claim drift (T1–T6).
# RED at base 1ea8825b: Expected values to be strictly equal: + undefined !== C0
#   (generation_claim.resume_candidate.scope_implementation_sha)
# RED at base 1ea8825b: Expected values to be strictly equal: + admitted !== blocked
#   (durable-wait git drift still admitted; missionClaim spy count 1 not 0)
# RED at base 1ea8825b: implementation_sha must be an immutable full 40-hex commit object ID
#   (engine resume returns at the scope contract before campaignScopeChecker is called)
# T5/T6 (preservation, green at base): unbound-candidate admits without resume_candidate;
#   existing P3 ADJUDICATING assertions above are unchanged.
DISP_SBX="$TEST_TMP/disp-resume-repo"
mkdir -p "$DISP_SBX/.claude" "$DISP_SBX/src"
git -C "$DISP_SBX" init -q
git -C "$DISP_SBX" config user.email "disp-resume@example.invalid"
git -C "$DISP_SBX" config user.name "Disp Resume Test"
write_mission_governance "$DISP_SBX/.claude/owner-kernel-governance.json" shadow
printf 'base\n' > "$DISP_SBX/src/value.txt"
git -C "$DISP_SBX" add .
git -C "$DISP_SBX" commit -qm "base"
DISP_BASE="$(git -C "$DISP_SBX" rev-parse HEAD)"
DISP_WT="$TEST_TMP/disp-resume-worktree"
git -C "$DISP_SBX" worktree add -q -b impl/disp-resume "$DISP_WT" "$DISP_BASE"
printf 'c0\n' > "$DISP_WT/src/value.txt"
git -C "$DISP_WT" add .
git -C "$DISP_WT" commit -qm "c0"
C0="$(git -C "$DISP_WT" rev-parse HEAD)"
C0_TREE="$(git -C "$DISP_WT" rev-parse HEAD^{tree})"
printf 'c1\n' > "$DISP_WT/src/value.txt"
git -C "$DISP_WT" add .
git -C "$DISP_WT" commit -qm "c1"
C1="$(git -C "$DISP_WT" rev-parse HEAD)"
C1_TREE="$(git -C "$DISP_WT" rev-parse HEAD^{tree})"
assert_neq "$C0" "$C1" "fixture C0 and C1 are distinct commits"
DISP_COMMON_RAW="$(git -C "$DISP_SBX" rev-parse --git-common-dir)"
DISP_COMMON="$(realpath "$DISP_SBX/$DISP_COMMON_RAW")"
DISP_CONTRACT="$TEST_TMP/disp-resume-campaign.json"
DISP_SEAL="$TEST_TMP/disp-resume-campaign.seal.json"
DISP_PROMPT="$TEST_TMP/disp-resume-prompt.txt"
printf 'durable-wait resume binds scope_implementation_sha\n' > "$DISP_PROMPT"
node - "$DISP_CONTRACT" "$DISP_COMMON" "$DISP_BASE" <<'NODE'
const fs = require('fs');
const [target, commonDir, base] = process.argv.slice(2);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  ticket: 'icc-disp-resume',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/disp-resume',
  vertical_acceptance: ['durable wait resume binds scope sha'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['ICC-DISP-RESUME1'],
}, null, 2)}\n`);
NODE
DISP_SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$DISP_CONTRACT" --repo "$DISP_SBX" --mission-mode shadow --out "$DISP_SEAL" 2>&1)"
assert_exit_code "$?" "0" "durable-wait resume fixture seals: $DISP_SEAL_OUT"

DISP_INTAKE_OUT="$(node - "$REPO_ROOT" "$DISP_SBX" "$DISP_WT" "$DISP_CONTRACT" "$DISP_SEAL" \
  "$DISP_PROMPT" "$DISP_BASE" "$C0" "$C0_TREE" "$C1" "$C1_TREE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [
  root, repo, worktree, contractPath, sealPath, promptFile,
  base, c0, c0Tree, c1, c1Tree,
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
const lineageBody = (campaignId, commit) => ({
  lineage_id: campaignId,
  branch: 'impl/disp-resume',
  worktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: worktreeInstanceId(worktree),
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: commit === c0 ? 0 : 1,
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
  accepted_invariant_ids: [`acceptance:${'c'.repeat(64)}`],
  accepted_invariants: ['preserve durable invariant'],
  accepted_invariants_source_commit: commit,
  accepted_invariants_digest: canonicalDigest({
    schema: 1,
    assertions: ['preserve durable invariant'],
    source_commit: commit,
  }),
  prior_review_finding_ids: commit === c0 ? [] : ['icc-disp-001'],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/value.txt'],
  repair_scope_seal: null,
});
const fenceFor = (campaignId, commit, tree) => createWriterFence({
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
let control = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/disp-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T00:00:00.000Z',
}, adapters);
const campaignId = control.campaign_id;
const gitCandidate = (commit, tree) => ({
  kind: 'git_candidate',
  commit,
  tree_sha: tree,
  branch: 'impl/disp-resume',
  base,
  writer_fence: fenceFor(campaignId, commit, tree),
  repair_lineage: lineageBody(campaignId, commit),
});
const step = (eventType, generation, stageIdentity, payload, extra = {}) => {
  const appended = appendCampaignEvent({
    repo,
    campaignControl: control,
    observedAt: extra.observedAt || `2026-09-16T00:00:0${generation}.000Z`,
    eventType,
    generation,
    stageIdentity,
    usage: extra.usage,
    payload,
    artifactReference: extra.artifactReference,
  });
  control = { ...control, initial_state: appended.state };
  return appended;
};
step(CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED, 0, 'campaign-mutation:0', { sealed_contract: true });
step(CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED, 0, 'campaign-mutation:0', {
  scope_check_passed: true, scope_check_digest: 'd'.repeat(64),
}, { artifactReference: gitCandidate(c0, c0Tree), usage: { changed_files: 1, churn: 2 } });
step(CAMPAIGN_EVENTS.VERTICAL_VERIFIED, 0, 'campaign-verification:0', {
  passed: true, evidence_digest: 'e'.repeat(64),
}, { artifactReference: { kind: 'verification_receipt', digest: 'e'.repeat(64) } });
const finding = {
  finding_id: 'icc-disp-001',
  claim: 'MUST-FIX src/value.txt must keep the repair path',
  severity: '🟠',
  source: 'fixture',
};
const findingsJson = JSON.stringify([finding]);
const reviewDigest = canonicalDigest({
  verdict: 'FIX-THEN-SHIP', findings: findingsJson, scope: 'full_diff', tree_sha: c0Tree,
});
step(CAMPAIGN_EVENTS.REVIEW_COMPLETED, 0, 'campaign-review:0', {
  review_digest: reviewDigest,
}, {
  artifactReference: {
    kind: 'product_review',
    digest: reviewDigest,
    repair_lineage: lineageBody(campaignId, c0),
  },
});
const registryDigest = '1'.repeat(64);
step(CAMPAIGN_EVENTS.REPAIR_AUTHORIZED, 1, 'campaign-repair-authorization:1', {
  registry_complete: true,
  registry_digest: registryDigest,
  repair_gate_passed: true,
  repair_gate_digest: '2'.repeat(64),
}, { artifactReference: { kind: 'finding_registry', digest: registryDigest } });
step(CAMPAIGN_EVENTS.REPAIR_STARTED, 1, 'campaign-mutation:1', { sealed_contract: true });
step(CAMPAIGN_EVENTS.REPAIR_COMPLETED, 1, 'campaign-mutation:1', {
  scope_check_passed: true, scope_check_digest: 'd'.repeat(64),
}, { artifactReference: gitCandidate(c1, c1Tree), usage: { changed_files: 1, churn: 4 } });
step(CAMPAIGN_EVENTS.VERTICAL_VERIFIED, 1, 'campaign-verification:1', {
  passed: true, evidence_digest: 'e'.repeat(64),
}, { artifactReference: { kind: 'verification_receipt', digest: 'e'.repeat(64) } });
const reviewDigest1 = canonicalDigest({
  verdict: 'FIX-THEN-SHIP', findings: findingsJson, scope: 'full_diff', tree_sha: c1Tree,
});
step(CAMPAIGN_EVENTS.REVIEW_COMPLETED, 1, 'campaign-review:1', {
  review_digest: reviewDigest1,
}, {
  artifactReference: {
    kind: 'product_review',
    digest: reviewDigest1,
    repair_lineage: lineageBody(campaignId, c1),
  },
});
const findingsDigest = canonicalDigest([finding]);
step(CAMPAIGN_EVENTS.AWAITING_DISPOSITION, 1, 'campaign-adjudication:1', {
  reason: 'disposition authority required',
  findings_digest: findingsDigest,
  candidate_ref: c1,
});
const ledgerPath = control.generation_claim.ledger;
const projection = projectCampaign(loadRows(ledgerPath), campaignId);
assert.strictEqual(projection.initial_candidate_reference.commit, c0);
assert.strictEqual(projection.candidate_reference.commit, c1);
assert.notStrictEqual(c0, c1);
assert.strictEqual(projection.state.phase, CAMPAIGN_STATES.AWAITING_DISPOSITION);
assert.strictEqual(projection.awaiting_disposition.candidate_ref, c1);
fs.copyFileSync(ledgerPath, `${ledgerPath}.awaiting.bak`);
console.log(`c0=${c0}`);
console.log(`c1=${c1}`);
console.log(`review_digest=${reviewDigest1}`);
console.log(`campaign_id=${campaignId}`);
console.log('t_journal=true');
NODE
)"
assert_exit_code "$?" "0" "durable-wait fixture journals AWAITING_DISPOSITION: $DISP_INTAKE_OUT"
assert_contains "$DISP_INTAKE_OUT" "t_journal=true" "fixture parked at AWAITING_DISPOSITION"

DISP_CAMPAIGN_ID="$(printf '%s\n' "$DISP_INTAKE_OUT" | sed -n 's/^campaign_id=//p')"
DISP_REVIEW_DIGEST="$(printf '%s\n' "$DISP_INTAKE_OUT" | sed -n 's/^review_digest=//p')"
DISP_C0="$(printf '%s\n' "$DISP_INTAKE_OUT" | sed -n 's/^c0=//p')"
DISP_C1="$(printf '%s\n' "$DISP_INTAKE_OUT" | sed -n 's/^c1=//p')"
assert_neq "$DISP_CAMPAIGN_ID" "" "fixture emits campaign id"
assert_neq "$DISP_REVIEW_DIGEST" "" "fixture emits review digest"
assert_eq "$DISP_C0" "$C0" "journal C0 matches git C0"
assert_eq "$DISP_C1" "$C1" "journal C1 matches git C1"

DISP_RESUME_OUT="$(node - "$REPO_ROOT" "$DISP_SBX" "$DISP_WT" "$DISP_CONTRACT" "$DISP_SEAL" \
  "$DISP_PROMPT" "$DISP_BASE" "$C0" "$C1" "$C1_TREE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [
  root, repo, worktree, contractPath, sealPath, promptFile, base, c0, c1, c1Tree,
] = process.argv.slice(2);
const { CAMPAIGN_STATES, runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
const { campaignIdFor } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const { canonicalRepoIdentity } = require(path.join(root, 'scripts', 'implementation-campaign-check'));
const digest = require('crypto').createHash('sha256')
  .update(fs.readFileSync(contractPath)).digest('hex');
const campaignId = campaignIdFor(canonicalRepoIdentity(repo), 'icc-disp-resume', digest);
const identity = canonicalRepoIdentity(repo);
const ledgerPath = path.join(
  identity.slice('git-common-dir:'.length),
  'autopilot',
  'implementation-campaign.jsonl',
);
const restoreLedger = () => fs.copyFileSync(`${ledgerPath}.awaiting.bak`, ledgerPath);
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const resumeAdapters = (missionSpy) => ({
  ...adapters,
  ...(missionSpy ? {
    missionClaim: missionSpy,
    releaseMission: () => ({ owner: 'mission_release', status: 'released' }),
  } : {}),
});
const runResume = (extraAdapters = {}) => runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/disp-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T00:00:05.000Z',
  resume: true,
}, resumeAdapters(extraAdapters.missionClaim));
function spyClaim() {
  const spy = { count: 0 };
  spy.fn = () => {
    spy.count += 1;
    return { owner: 'mission', status: 'unknown', enforcement: 'shadow', reason: 'spy' };
  };
  return spy;
}
const git = (args) => spawnSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

restoreLedger();
const projection = projectCampaign(loadRows(ledgerPath), campaignId);
const admitted = runResume();
assert.strictEqual(admitted.status, 'admitted', JSON.stringify(admitted.rejection || admitted));
assert.strictEqual(
  admitted.generation_claim.resume_durable_wait.phase,
  CAMPAIGN_STATES.AWAITING_DISPOSITION,
);
const rc = admitted.generation_claim.resume_candidate;
assert.strictEqual(rc.committed, true);
assert.strictEqual(rc.commit, c1);
assert.strictEqual(rc.tree_sha, c1Tree);
assert.strictEqual(rc.scope_implementation_sha, c0);
assert.notStrictEqual(rc.scope_implementation_sha, c1);
const ref = projection.candidate_reference;
assert.deepStrictEqual(rc.branch, ref.branch);
assert.deepStrictEqual(rc.writer_fence, ref.writer_fence);
assert.deepStrictEqual(rc.repair_lineage, ref.repair_lineage);
const expectedKeys = [
  'branch', 'commit', 'committed', 'repair_lineage',
  'scope_implementation_sha', 'tree_sha', 'writer_fence',
];
if (ref.campaign_contract_sha256) {
  expectedKeys.push('campaign_contract_sha256', 'unit_contract_sha256');
}
assert.deepStrictEqual(Object.keys(rc).sort(), expectedKeys.sort());
assert.strictEqual(Object.prototype.hasOwnProperty.call(rc, 'kind'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(rc, 'base'), false);
console.log('t1_t2_admitted=true');

restoreLedger();
{
  const moved = spawnSync('git', ['-C', worktree, 'reset', '--hard', base], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.strictEqual(moved.status, 0, moved.stderr);
  const spy = spyClaim();
  const out = runResume({ missionClaim: spy.fn });
  spawnSync('git', ['-C', worktree, 'reset', '--hard', c1], { stdio: 'ignore' });
  assert.strictEqual(out.status, 'blocked', JSON.stringify(out.rejection || out));
  assert.strictEqual(out.rejection.code, 'campaign_resume_git_drift');
  assert.strictEqual(spy.count, 0);
}

function probeChild() {
  const src = path.join(root, 'src', 'engine');
  const script = `
    'use strict';
    const { runCampaignIntake } = require(${JSON.stringify(src)});
    let spy = 0;
    const out = runCampaignIntake({
      repo: ${JSON.stringify(repo)},
      contractPath: ${JSON.stringify(contractPath)},
      sealPath: ${JSON.stringify(sealPath)},
      promptFile: ${JSON.stringify(promptFile)},
      branch: 'impl/disp-resume',
      base: ${JSON.stringify(base)},
      roster: { implementer_engine: 'fixture-implementer' },
      observedAt: '2026-09-16T00:00:05.000Z',
      resume: true,
    }, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      missionClaim: () => {
        spy += 1;
        return { owner: 'mission', status: 'unknown', enforcement: 'shadow', reason: 'spy' };
      },
      releaseMission: () => ({ owner: 'mission_release', status: 'released' }),
    });
    process.stdout.write(JSON.stringify({
      status: out.status,
      code: out.rejection && out.rejection.code,
      reason: out.rejection && out.rejection.reason,
      spy,
    }));
  `;
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_COMMON_DIR;
  delete env.GIT_NO_REPLACE_OBJECTS;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}
const bashGit = (cmdline) => spawnSync('bash', ['-lc', cmdline], { encoding: 'utf8' });

restoreLedger();
const baseTree = git(['rev-parse', `${base}^{tree}`]).stdout.trim();
assert.notStrictEqual(c1Tree, baseTree, 'c1 tree must differ from base tree');
const treeReplacement = bashGit(
  `printf 'tree drift replacement\\n' | git -C ${JSON.stringify(repo)} commit-tree ${baseTree} -p ${base}`,
).stdout.trim();
assert.ok(/^[0-9a-f]{40}$/.test(treeReplacement), `treeReplacement=${treeReplacement}`);
assert.strictEqual(bashGit(`git -C ${JSON.stringify(repo)} replace ${c1} ${treeReplacement}`).status, 0);
assert.strictEqual(git(['rev-parse', `${c1}^{tree}`]).stdout.trim(), baseTree);
{
  const out = probeChild();
  assert.strictEqual(out.status, 'blocked', JSON.stringify(out));
  assert.strictEqual(out.code, 'campaign_resume_git_drift');
  assert.strictEqual(out.spy, 0);
}
bashGit(`git -C ${JSON.stringify(repo)} replace -d ${c1}`);

restoreLedger();
const offBase = bashGit(
  `printf 'off-base root\\n' | git -C ${JSON.stringify(repo)} commit-tree ${baseTree}`,
).stdout.trim();
const baseDrift = bashGit(
  `printf 'base ancestry drift replacement\\n' | git -C ${JSON.stringify(repo)} commit-tree ${c1Tree} -p ${offBase}`,
).stdout.trim();
assert.ok(/^[0-9a-f]{40}$/.test(baseDrift), `baseDrift=${baseDrift}`);
assert.strictEqual(bashGit(`git -C ${JSON.stringify(repo)} replace ${c1} ${baseDrift}`).status, 0);
{
  const out = probeChild();
  assert.strictEqual(out.status, 'blocked', JSON.stringify(out));
  assert.strictEqual(out.code, 'campaign_resume_git_drift');
  assert.strictEqual(out.spy, 0);
}
bashGit(`git -C ${JSON.stringify(repo)} replace -d ${c1}`);

restoreLedger();
{
  const raw = fs.readFileSync(ledgerPath, 'utf8');
  const lines = raw.split('\n');
  let mutatedCount = 0;
  const mutated = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const row = JSON.parse(line);
      if (typeof row.payload !== 'string') return line;
      const payload = JSON.parse(row.payload);
      const ref = payload && payload.artifact_reference;
      if (ref && ref.kind === 'git_candidate' && ref.commit === c1 && ref.writer_fence) {
        // Corrupt the writer-fence digest itself (not a sibling field): the
        // artifact digest is recomputed so only the fence validation can trip.
        ref.writer_fence.receipt_digest = 'f'.repeat(64);
        payload.artifact_reference = ref;
        if (payload.event && typeof payload.event === 'object') {
          payload.event.output_artifact_digest = canonicalDigest(ref);
        }
        row.payload = JSON.stringify(payload);
        mutatedCount += 1;
      }
      return JSON.stringify(row);
    } catch (_e) { /* keep */ }
    return line;
  });
  assert.ok(mutatedCount > 0, `malformed fence mutations=${mutatedCount}`);
  fs.writeFileSync(ledgerPath, mutated.join('\n'));
  const out = probeChild();
  assert.strictEqual(out.status, 'blocked', JSON.stringify(out));
  assert.strictEqual(out.code, 'campaign_resume_candidate_invalid', JSON.stringify(out));
  assert.strictEqual(out.spy, 0);
}
restoreLedger();
console.log('t3_preclaim_drift=true');
NODE
)"
assert_exit_code "$?" "0" "T1–T3 durable-wait intake: $DISP_RESUME_OUT"
assert_contains "$DISP_RESUME_OUT" "t1_t2_admitted=true" "T1/T2 admitted normalized resume_candidate"
assert_contains "$DISP_RESUME_OUT" "t3_preclaim_drift=true" "T3 pre-claim drift refused"

DISP_ENGINE_OUT="$(
  DISP_C0="$DISP_C0" DISP_C1="$DISP_C1" DISP_BASE_SHA="$DISP_BASE" \
  node - "$REPO_ROOT" "$DISP_SBX" "$DISP_WT" "$DISP_CONTRACT" "$DISP_SEAL" \
  "$DISP_PROMPT" "$DISP_CAMPAIGN_ID" "$DISP_REVIEW_DIGEST" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [
  root, repo, worktree, contractPath, sealPath, promptFile,
  campaignId, durableReviewDigest,
] = process.argv.slice(2);
const c0 = process.env.DISP_C0;
const c1 = process.env.DISP_C1;
const base = process.env.DISP_BASE_SHA;
const c1Tree = spawnSync('git', ['-C', repo, 'rev-parse', `${c1}^{tree}`], {
  encoding: 'utf8',
}).stdout.trim();
spawnSync('git', ['-C', repo, 'replace', '-d', c1], { stdio: 'ignore' });
spawnSync('git', ['-C', worktree, 'reset', '--hard', c1], { stdio: 'ignore' });
{
  const common = spawnSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).stdout.trim();
  const ledger = path.join(path.resolve(repo, common), 'autopilot', 'implementation-campaign.jsonl');
  if (fs.existsSync(`${ledger}.awaiting.bak`)) {
    fs.copyFileSync(`${ledger}.awaiting.bak`, ledger);
  }
}
const {
  AutopilotEngine,
  canonicalDigest,
  compileCampaignDispositionProvider,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const finding = {
  finding_id: 'icc-disp-001',
  claim: 'MUST-FIX src/value.txt must keep the repair path',
  severity: '🟠',
  source: 'fixture',
};
const findings = JSON.stringify([finding]);
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
const seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
const decision = {
  finding_id: 'icc-disp-001',
  evidence: {
    kind: 'trace',
    trace_chain: ['fixture:must-fix-now'],
    confirmed_by: 'owner/root',
  },
  disposition: {
    disposition: 'must-fix-now',
    acceptance_id: 'ICC-DISP',
    deferral_harm: 'stranded campaign',
  },
};
const contracts = [];
let adjudicateCalls = 0;
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-09-16T00:00:05.000Z',
  campaignDispositionProvider: compileCampaignDispositionProvider({
    schema_version: 1,
    artifact_type: 'campaign_disposition_authority',
    authority: 'depth-0',
    actor_id: 'owner/root',
    campaign_id: campaignId,
    contract_digest: seal.contract_sha256,
    reviews: [{ review_digest: durableReviewDigest, decisions: [decision] }],
  }),
  campaignAdjudicator() {
    adjudicateCalls += 1;
    const retained = {
      id: 'icc-disp-001',
      claim: 'MUST-FIX src/value.txt must keep the repair path',
      severity: '🟠',
      source: 'fixture',
      evidence: { digest: 'b'.repeat(64), classification: 'actionable' },
      adjudication_authority: {
        authority: 'depth-0',
        actor_id: 'owner/root',
        review_digest: durableReviewDigest,
      },
      disposition: {
        disposition: 'must-fix-now',
        acceptance_id: 'ICC-DISP',
        deferral_harm: 'stranded campaign',
      },
    };
    return {
      registry_complete: true,
      repair_gate_passed: true,
      registry_digest: '1'.repeat(64),
      must_fix_now: adjudicateCalls === 1 ? [retained] : [],
      follow_up: [],
      rejected: [],
    };
  },
  campaignScopeChecker({ session }) {
    contracts.push(session && session.contract);
    return {
      passed: true,
      verdict: 'PASS',
      changed_files: ['src/value.txt'],
      total_churn: 1,
      receipt_digest: 'a'.repeat(64),
    };
  },
  campaignRepairChangedPaths() {
    return { status: 'ok', paths: ['src/value.txt'] };
  },
  campaignIntake(input) {
    const control = runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
    if (control.status !== 'admitted' || !control.generation_claim) {
      throw new Error(`intake blocked: ${JSON.stringify(control.rejection || control)}`);
    }
    control.generation_claim.resume_verification = {
      passed: true,
      receipt_digest: 'e'.repeat(64),
    };
    control.generation_claim.resume_review = {
      reviewed: true,
      verdict: 'FIX-THEN-SHIP',
      findings,
      review_digest: durableReviewDigest,
      review_input_mode: 'full_diff_generation',
    };
    control.generation_claim.resume_findings = [finding];
    control.generation_claim.resume_phase = 'AWAITING_DISPOSITION';
    control.generation_claim.resume_full_diff_barriers = {
      0: {
        kind: 'full_diff_review',
        success: true,
        review_digest: durableReviewDigest,
        candidate_ref: c1,
      },
      1: {
        kind: 'full_diff_review',
        success: true,
        review_digest: durableReviewDigest,
        candidate_ref: c1,
      },
    };
    return control;
  },
  implementationDispatcher() {
    spawnSync('git', ['-C', worktree, 'config', 'user.email', 'disp@example.invalid'], { stdio: 'ignore' });
    spawnSync('git', ['-C', worktree, 'config', 'user.name', 'disp'], { stdio: 'ignore' });
    const reset = spawnSync('git', ['reset', '--hard', c1], { cwd: worktree, encoding: 'utf8' });
    assert.strictEqual(reset.status, 0, reset.stderr);
    fs.writeFileSync(path.join(worktree, 'src/value.txt'), 'c2\n');
    spawnSync('git', ['add', 'src/value.txt'], { cwd: worktree, stdio: 'ignore' });
    const committed = spawnSync('git', ['commit', '-qm', 'c2'], { cwd: worktree, encoding: 'utf8' });
    assert.strictEqual(committed.status, 0, committed.stderr);
    spawnSync('git', ['add', 'src/value.txt'], { cwd: worktree, stdio: 'ignore' });
    spawnSync('git', ['commit', '-qm', 'c2'], { cwd: worktree, stdio: 'ignore' });
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: worktree, encoding: 'utf8',
    }).stdout.trim();
    const tree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], {
      cwd: worktree, encoding: 'utf8',
    }).stdout.trim();
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        commit,
        tree_sha: tree,
        branch: 'impl/disp-resume',
        worktree,
        worktree_reused: true,
        files_changed: 1,
        insertions: 1,
        deletions: 1,
        runner: 'fixture',
        model: 'gpt-5.6',
      },
    };
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
        findings: '[]',
        raw_log: null,
        error: null,
      },
    };
  },
  diffProvider() { return promptFile; },
  gitWorktreeAdd() {
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '',
      worktree, parent: null, commit: c1, observed_commit: c1,
      observed_tree_sha: c1Tree, detached: false,
    };
  },
  gitWorktreeRemove() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  repairLineageCleanupTransaction() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  verifyCommandRunner({ verifyCmd }) {
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '',
      executed_argv: ['/bin/sh', '-c', verifyCmd],
    };
  },
});
const result = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/disp-resume',
  base,
  roster,
  campaignContract: contractPath,
  campaignSeal: sealPath,
  resume: true,
  verificationEnv: { PATH: process.env.PATH || '', CI: 'disp-resume' },
  verificationEnvAllowlist: ['CI'],
});
assert.ok(contracts.length >= 1, `spy calls=${contracts.length} result=${JSON.stringify({
  status: result.status, phase: result.phase, reason: result.reason,
})}`);
for (const contract of contracts) {
  assert.strictEqual(contract.base_sha, base);
  assert.strictEqual(contract.implementation_sha, c0);
  assert.notStrictEqual(contract.implementation_sha, c1);
  assert.notStrictEqual(contract.implementation_sha, undefined);
}
const c2 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).stdout.trim();
const parent = spawnSync('git', ['rev-parse', 'HEAD^'], { cwd: worktree, encoding: 'utf8' }).stdout.trim();
assert.strictEqual(parent, c1, JSON.stringify({
  parent, c1, c0, c2, status: result.status, phase: result.phase, reason: result.reason,
}));
assert.notStrictEqual(c2, c1);
const forbidden = new Set(['campaign_scope_session', 'scope_check']);
assert.ok(!forbidden.has(result.phase), `phase=${result.phase} reason=${result.reason}`);
const events = [];
try {
  const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
  const common = spawnSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).stdout.trim();
  const ledger = path.join(path.resolve(repo, common), 'autopilot', 'implementation-campaign.jsonl');
  const proj = projectCampaign(loadRows(ledger), campaignId);
  events.push(proj.state.phase);
} catch (_e) { /* ignore */ }
const trace = (result.campaign_receipt && result.campaign_receipt.trace) || [];
const joined = `${JSON.stringify(result)}\n${trace.join(',')}`;
assert.ok(
  joined.includes('DISPOSITION_RESUMED')
    || joined.includes('disposition_resumed')
    || joined.includes('resume_disposition_only')
    || (result.campaign_receipt && Array.isArray(result.campaign_receipt.trace)
      && result.campaign_receipt.trace.includes('repair')),
  `missing disposition/repair progress: status=${result.status} phase=${result.phase} reason=${result.reason}`,
);
console.log(`engine_status=${result.status}`);
console.log(`engine_phase=${result.phase}`);
console.log(`spy_calls=${contracts.length}`);
console.log(`c2=${c2}`);
console.log('t4_engine_scope=true');
NODE
)"
assert_exit_code "$?" "0" "T4 engine scope check: $DISP_ENGINE_OUT"
assert_contains "$DISP_ENGINE_OUT" "t4_engine_scope=true" "T4 engine spy recorded C0 implementation_sha"

T5_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const tmp = process.argv[3];
const {
  CAMPAIGN_EVENTS,
  appendCampaignEvent,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const repo = path.join(tmp, 'unbound-resume-repo');
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
const git = (args, cwd = repo) => spawnSync('git', ['-C', cwd, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
git(['init', '-q']);
git(['config', 'user.email', 'unbound@example.invalid']);
git(['config', 'user.name', 'Unbound']);
const govSrc = path.join(root, '.claude', 'owner-kernel-governance.json');
const gov = JSON.parse(fs.readFileSync(govSrc, 'utf8'));
gov.mission_convergence = {
  schema_version: 1,
  enforcement_mode: 'shadow',
  max_campaigns: 8,
  max_wall_seconds: 7200,
  max_tool_calls: 1000,
  max_engine_attempts: 100,
  max_external_wait_seconds: 600,
  max_canonical_changed_files: 100,
  max_output_bytes: 1000000,
  max_deliverables: 8,
  max_parallel: 3,
  max_batches: 4,
  max_graph_depth: 4,
  max_gate_attempts: 16,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(
  path.join(repo, '.claude', 'owner-kernel-governance.json'),
  `${JSON.stringify(gov, null, 2)}\n`,
);
fs.writeFileSync(path.join(repo, 'src/value.txt'), 'base\n');
git(['add', '.']);
git(['commit', '-qm', 'base']);
const base = git(['rev-parse', 'HEAD']).stdout.trim();
git(['checkout', '-qb', 'impl/unbound-resume']);
const commonDir = fs.realpathSync(path.resolve(repo, git(['rev-parse', '--git-common-dir']).stdout.trim()));
const contractPath = path.join(tmp, 'unbound-campaign.json');
const sealPath = path.join(tmp, 'unbound-campaign.seal.json');
const promptFile = path.join(tmp, 'unbound-prompt.txt');
fs.writeFileSync(promptFile, 'unbound\n');
fs.writeFileSync(contractPath, `${JSON.stringify({
  schema_version: 1,
  ticket: 'icc-unbound-resume',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/unbound-resume',
  vertical_acceptance: ['unbound preserved'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'true',
  rubric_ids: ['ICC-UNBOUND1'],
}, null, 2)}\n`);
const seal = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
], { encoding: 'utf8' });
assert.strictEqual(seal.status, 0, seal.stderr || seal.stdout);
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
let control = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/unbound-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T03:00:00.000Z',
}, adapters);
assert.strictEqual(control.status, 'admitted', JSON.stringify(control.rejection || control));
control = { ...control, initial_state: appendCampaignEvent({
  repo, campaignControl: control, observedAt: '2026-09-16T03:00:01.000Z',
  eventType: CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED, generation: 0,
  stageIdentity: 'campaign-mutation:0', payload: { sealed_contract: true },
}).state };
const digest = 'b'.repeat(64);
control = { ...control, initial_state: appendCampaignEvent({
  repo, campaignControl: control, observedAt: '2026-09-16T03:00:02.000Z',
  eventType: CAMPAIGN_EVENTS.BOUNDARY_REJECTED, generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: {
    reason: 'no commit produced',
    boundary_reason: 'scope_or_budget_boundary',
    candidate_ref: 'unbound-candidate',
    boundary_receipt_digest: digest,
  },
  artifactReference: { kind: 'campaign_boundary_rejected', digest },
}).state };
console.log(`t5_repo=${repo}`);
console.log(`t5_contract=${contractPath}`);
console.log(`t5_seal=${sealPath}`);
console.log(`t5_prompt=${promptFile}`);
console.log(`t5_base=${base}`);
console.log('t5_journal=true');
NODE
)"
assert_exit_code "$?" "0" "T5 unbound journal: $T5_OUT"
assert_contains "$T5_OUT" "t5_journal=true" "T5 BOUNDARY_REJECTED journaled"
T5_REPO="$(printf '%s\n' "$T5_OUT" | sed -n 's/^t5_repo=//p')"
T5_CONTRACT="$(printf '%s\n' "$T5_OUT" | sed -n 's/^t5_contract=//p')"
T5_SEAL="$(printf '%s\n' "$T5_OUT" | sed -n 's/^t5_seal=//p')"
T5_PROMPT="$(printf '%s\n' "$T5_OUT" | sed -n 's/^t5_prompt=//p')"
T5_BASE="$(printf '%s\n' "$T5_OUT" | sed -n 's/^t5_base=//p')"
T5_RESUME="$(node - "$REPO_ROOT" "$T5_REPO" "$T5_CONTRACT" "$T5_SEAL" "$T5_PROMPT" "$T5_BASE" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const resumed = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/unbound-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T03:00:03.000Z',
  resume: true,
}, adapters);
assert.strictEqual(resumed.status, 'admitted', JSON.stringify(resumed.rejection || resumed));
const wait = resumed.generation_claim.resume_durable_wait;
assert.strictEqual(wait.candidate_ref, 'unbound-candidate');
assert.ok(
  resumed.generation_claim.resume_candidate == null,
  `resume_candidate=${JSON.stringify(resumed.generation_claim.resume_candidate)}`,
);
console.log('t5_unbound_preserved=true');
NODE
)"
assert_exit_code "$?" "0" "T5 unbound preservation: $T5_RESUME"
assert_contains "$T5_RESUME" "t5_unbound_preserved=true" \
  "T5 BOUNDARY_REJECTED unbound-candidate still admits without resume_candidate"

ROUTING="$(sed -n '1,240p' \
  "$REPO_ROOT/skills/l5/SKILL.md" \
  "$REPO_ROOT/skills/l6/SKILL.md" \
  "$REPO_ROOT/skills/ceo-agent/SKILL.md" \
  "$REPO_ROOT/skills/dev-flow/SKILL.md")"
assert_contains "$ROUTING" "engine implement-review --campaign-contract" \
  "mutating lifecycle skills name the canonical campaign entry"

finalize_test
