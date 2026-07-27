#!/usr/bin/env bash
# LSM P1 real-artifact oracle. Every Mission and ICC artifact is produced by
# the canonical reducer/builders; WLB evidence uses the canonical inspector's
# exact return shape.
. "$(dirname "$0")/lib.sh"

OUT_FILE="$TEST_TMP/status-task.out"
node - "$REPO_ROOT" >"$OUT_FILE" <<'NODE'
'use strict';

const path = require('path');
const root = process.argv[2];
const mission = require(path.join(root, 'src/engine/mission-convergence'));
const icc = require(path.join(root, 'src/engine/implementation-campaign'));
const campaignVerification = require(path.join(root, 'src/engine/campaign-verification'));
const { runCampaignComposition } = require(path.join(root, 'src/engine/campaign-composition'));
const { buildTaskStatus } = require(path.join(root, 'src/status/task-status'));

const results = [];
function check(id, condition) {
  results.push({ id, pass: condition === true });
}
function group(id, fn) {
  try {
    fn();
  } catch (error) {
    results.push({ id, pass: false, detail: `${error.code || error.name}: ${error.message}` });
  }
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function redigest(body) {
  const { receipt_digest: ignored, ...material } = body;
  return { ...material, receipt_digest: icc.canonicalDigest(material) };
}

const ROOT_RUN_ID = 'root-run-lsm-p1';
const REPO = '/tmp/lsm-p1-real-repo';
const REPO_IDENTITY = 'git-common-dir:/tmp/lsm-p1-real-repo/.git';
const OBSERVED_AT = '2026-07-28T00:00:00.000Z';
const CANDIDATE_COMMIT = '1'.repeat(40);
const CANDIDATE_TREE = '2'.repeat(40);
const TARGET_SHA = '3'.repeat(40);
const CONSUMER_SHA = '4'.repeat(40);
const REMOTE_SHA = '5'.repeat(40);
const TARGET_REF = 'refs/heads/develop';
const CONSUMER_REF = 'refs/heads/consumer';
const REMOTE_REF = 'refs/remotes/origin/develop';

function missionContract() {
  const policyHash = mission.sha256('lsm-policy');
  const authorityId = mission.sha256('lsm-authority');
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: `mission-v1-${mission.sha256('lsm-contract')}`,
    repo_identity: REPO_IDENTITY,
    mission_lineage_id: `lineage-v1-${mission.sha256('lsm-lineage')}`,
    task_authority_id: authorityId,
    policy_hash: policyHash,
    enforcement_mode: 'shadow',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: Object.fromEntries(mission.SUPPORTED_AXES.map((axis) => [axis, {
      authorized_ceiling: axis === 'output_bytes' ? 4096 : 1000,
      reserved_active: 0,
      durable_consumed: 0,
      known: true,
      enforced: true,
    }])),
    grant_contract: {
      idempotency_key_required: true,
      single_use: true,
      expiry_seconds: 3600,
      bindings: [
        'mission_lineage_id',
        'task_authority_id',
        'campaign_id',
        'campaign_contract_digest',
        'base_sha',
        'acceptance_ids',
      ],
    },
    control_contract: {
      actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
      allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
      ceiling_loosen_authority: 'authenticated_user',
    },
    lineage_binding: {
      task_authority_id: authorityId,
      root_run_id: ROOT_RUN_ID,
      policy_hash: policyHash,
      successor_inherits_durable_consumed: true,
    },
  };
}

function reservation(state, toolCalls) {
  return {
    per_axis: mission.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: state.axes[axis].authorized_ceiling,
      reserved_active: axis === 'tool_calls' ? toolCalls : (axis === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axis].durable_consumed,
      known: true,
    })),
  };
}

function buildMissionBundle({ campaignCount = 1 } = {}) {
  let state = mission.createMissionState(missionContract());
  const claims = [];
  for (let index = 0; index < campaignCount; index += 1) {
    const claimed = mission.reduceMissionState(state, {
      event_type: 'grant_claimed',
      sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: {
        idempotency_key: `lsm-claim-${index}`,
        mission_lineage_id: state.mission_lineage_id,
        task_authority_id: state.task_authority_id,
        campaign_id: `mission-campaign-v2-${index}`,
        campaign_contract_digest: icc.canonicalDigest(campaignContract()),
        base_sha: '0'.repeat(40),
        acceptance_ids: [`acceptance-${index}`],
        reservation: reservation(state, 5),
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    state = claimed.state;
    state = mission.reduceMissionState(state, {
      event_type: 'acceptance_satisfied',
      sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: { acceptance_hash: mission.sha256(`acceptance-${index}`) },
    }).state;
    state = mission.reduceMissionState(state, {
      event_type: 'reconciliation',
      sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: {
        claim_id: claimed.receipt.claim_id,
        actual_usage: reservation(state, 5),
      },
    }).state;
    claims.push(state.claims[claimed.receipt.claim_id]);
  }
  state = mission.reduceMissionState(state, {
    event_type: 'closure_evaluated',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { ratio: 0.9, other_axes_below_ratio: false, unknown_required_axis: false },
  }).state;
  const residueBody = { lifecycle_residue: [] };
  const residue = { ...residueBody, residue_digest: mission.sha256(residueBody) };
  return {
    state,
    claim: claims[0],
    claims,
    terminal_receipt: mission.buildMissionTerminalReceipt(state, residue),
  };
}

function buildBlockedMissionBundle() {
  const contract = missionContract();
  contract.enforcement_mode = 'enforce';
  let state = mission.createMissionState(contract);
  const over = reservation(state, state.axes.tool_calls.authorized_ceiling + 1);
  state = mission.reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: 'lsm-over-budget',
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'blocked-campaign',
      campaign_contract_digest: state.policy_hash,
      base_sha: '0'.repeat(40),
      acceptance_ids: ['acceptance-1'],
      reservation: over,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  }).state;
  const residueBody = { lifecycle_residue: [] };
  const residue = { ...residueBody, residue_digest: mission.sha256(residueBody) };
  return {
    state,
    terminal_receipt: mission.buildMissionTerminalReceipt(state, residue),
  };
}

function campaignContract(ticket = 'lsm-p1') {
  return {
    ticket,
    profile: 'poc',
    max_repair_generations: 2,
    max_wall_seconds: 600,
    max_changed_files: 10,
    baseline_churn: 100,
    max_extra_churn: 50,
  };
}

function retainedFinding(item, disposition) {
  return {
    id: item.id,
    claim: item.claim,
    severity: '🟠',
    source: 'lsm-real-oracle',
    evidence: {
      classification: 'actionable',
      digest: mission.sha256(item),
    },
    adjudication_authority: {
      authority: 'depth-0',
      actor_id: 'lsm-owner',
      review_digest: mission.sha256('review'),
    },
    disposition,
  };
}

function buildCampaignBundle({
  status = 'ready',
  followUp = [],
  unresolved = [],
  ticket = 'lsm-p1',
} = {}) {
  const contract = campaignContract(ticket);
  const contractDigest = icc.canonicalDigest(contract);
  let state = icc.createCampaignState({
    contract,
    contractDigest,
    repoIdentity: REPO_IDENTITY,
    startedAt: '2026-07-27T00:00:00.000Z',
  });
  const events = [];
  const writerFence = campaignVerification.createWriterFence({
    campaignId: state.campaign_id,
    stageIdentity: 'lsm-implementer',
    candidateCommit: CANDIDATE_COMMIT,
    candidateTreeSha: CANDIDATE_TREE,
    implementationResult: {
      status: 'committed',
      implementation: { commit: CANDIDATE_COMMIT },
      implementationResult: { status: 0, signal: null, error: null },
    },
  });
  const candidate = icc.normalizeCampaignArtifactReference({
    kind: 'git_candidate',
    commit: CANDIDATE_COMMIT,
    tree_sha: CANDIDATE_TREE,
    branch: 'feat/lsm-p1',
    base: '0'.repeat(40),
    writer_fence: writerFence,
  });
  const verifyCommand = 'node real-lsm-oracle.js';
  const request = campaignVerification.createVerificationRequest({
    treeSha: CANDIDATE_TREE,
    verifyCmd: verifyCommand,
    env: { PATH: '/usr/bin', CI: '1' },
    envAllowlist: ['CI'],
  });
  const checkoutAttestation = campaignVerification.createDetachedCheckoutAttestation({
    candidateCommit: CANDIDATE_COMMIT,
    candidateTreeSha: CANDIDATE_TREE,
    worktreeResult: {
      error: null,
      signal: null,
      status: 0,
      detached: true,
      commit: CANDIDATE_COMMIT,
      observed_commit: CANDIDATE_COMMIT,
      observed_tree_sha: CANDIDATE_TREE,
      worktree: '/tmp/lsm-real-oracle-worktree',
    },
  });
  const verification = campaignVerification.createVerificationReceipt({
    campaignId: state.campaign_id,
    request,
    exitStatus: 0,
    startedAt: '2026-07-27T00:00:02.000Z',
    endedAt: '2026-07-27T00:00:03.000Z',
    writerFence,
    checkoutAttestation,
    executedArgv: campaignVerification.verificationArgv(verifyCommand),
    stdout: 'ok\n',
  });
  const retainedFollowUp = followUp.map((item) => retainedFinding(item, {
    disposition: 'follow-up',
    context: 'LSM deferred work',
    trigger: 'next phase',
    proposed_backlog_title: item.claim,
  }));
  const retainedUnresolved = unresolved.map((item) => retainedFinding(item, {
    disposition: 'must-fix-now',
    acceptance_id: 'acceptance-0',
    deferral_harm: 'blocks the frozen LSM P1 acceptance contract',
  }));
  const compositionCandidate = { ...candidate, committed: true };
  const terminal = runCampaignComposition({ maxRepairGenerations: 0 }, {
    preflight: () => ({ passed: true }),
    implement: () => compositionCandidate,
    scopeCheck: () => ({ passed: true }),
    verify: () => ({ ...verification, passed: true }),
    review: () => ({
      reviewed: true,
      verdict: 'SHIP-AS-IS',
      findings: '[]',
      review_digest: mission.sha256('review'),
    }),
    adjudicate: ({ final }) => ({
      registry_complete: true,
      repair_gate_passed: true,
      registry_digest: mission.sha256(final ? 'final-registry' : 'registry'),
      must_fix_now: final ? retainedUnresolved : [],
      follow_up: final ? retainedFollowUp : [],
      rejected: [],
    }),
    convergence: () => ({ passed: true }),
    finalPanel: () => ({
      reviewed: true,
      verdict: 'SHIP-AS-IS',
      findings: '[]',
      review_digest: mission.sha256('final-review'),
    }),
  });
  const event = (eventType, output, payload, second) => ({
    schema_version: 1,
    event_type: eventType,
    campaign_id: state.campaign_id,
    contract_digest: state.contract_digest,
    generation: 0,
    idempotency_key: `lsm:${eventType}`,
    input_artifact_digest: state.last_output_artifact_digest,
    output_artifact_digest: output,
    timestamp: `2026-07-27T00:00:0${second}.000Z`,
    stage_identity: 'lsm-implementer',
    usage: {
      repair_generations: 0,
      elapsed_wall_seconds: second,
      changed_files: second === 1 ? 0 : 1,
      churn: second === 1 ? 0 : 2,
    },
    payload,
  });
  const applyEvent = (eventType, output, payload, second) => {
    const nextEvent = event(eventType, output, payload, second);
    events.push(nextEvent);
    state = icc.reduceCampaignState(state, nextEvent);
  };
  applyEvent(
    icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
    mission.sha256('implementation-started'),
    { sealed_contract: true },
    1,
  );
  applyEvent(
    icc.CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED,
    mission.sha256('implementation-completed'),
    { scope_check_passed: true, scope_check_digest: mission.sha256('scope') },
    2,
  );
  applyEvent(
    icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
    verification.receipt_digest,
    { passed: true, evidence_digest: verification.receipt_digest },
    3,
  );
  applyEvent(
    icc.CAMPAIGN_EVENTS.REVIEW_COMPLETED,
    mission.sha256('review-completed'),
    { review_digest: mission.sha256('review') },
    4,
  );
  const terminalEvent = status === 'ready'
    ? icc.CAMPAIGN_EVENTS.TERMINAL_READY
    : (status === 'follow_up'
      ? icc.CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP
      : icc.CAMPAIGN_EVENTS.TERMINAL_STOP);
  const terminalPayload = status === 'stop'
    ? {
      reason: 'canonical stop',
      stop_receipt_digest: mission.sha256('stop-receipt'),
    }
    : {
      registry_complete: true,
      registry_digest: mission.sha256('registry'),
      convergence_digest: mission.sha256('convergence'),
      reason: 'canonical terminal',
    };
  if (status === 'follow_up') {
    terminalPayload.follow_up_digest = mission.sha256(terminal.follow_up);
  }
  applyEvent(
    terminalEvent,
    terminal.receipt_digest,
    terminalPayload,
    5,
  );
  return {
    contract,
    events,
    state,
    terminal_receipt: terminal,
    verification_receipt: verification,
    candidate,
  };
}

const missionBundle = buildMissionBundle();
const campaignBundle = buildCampaignBundle();

function makeInput(overrides = {}) {
  return {
    repo: REPO,
    root_run_id: ROOT_RUN_ID,
    observed_at: OBSERVED_AT,
    goal: 'Verify LSM P1',
    phase: 'phase-16',
    mission: {
      state: missionBundle.state,
      terminal_receipt: missionBundle.terminal_receipt,
    },
    campaigns: [campaignBundle],
    lifecycle_receipt_path: '/tmp/canonical-lifecycle-receipt.json',
    integration: {
      target_ref: TARGET_REF,
      consumer_ref: CONSUMER_REF,
      remote_ref: REMOTE_REF,
      push_required: true,
      required_consumer_update: true,
    },
    merge_preflight: null,
    ...overrides,
  };
}

function makeAdapters(overrides = {}) {
  return {
    resolveRepoIdentity: () => REPO_IDENTITY,
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      zero_residue: true,
      receipt_digest: mission.sha256('canonical-lifecycle-receipt'),
      active_owned_worktrees: 0,
      active_owned_branches: 0,
    }),
    resolveCampaignBinding: ({ missionState, campaignState }) => {
      const claim = Object.values(missionState.claims).find((item) => item.released !== true);
      return {
        status: 'valid',
        claim_id: claim.claim_id,
        mission_campaign_id: claim.campaign_id,
        icc_campaign_id: campaignState.campaign_id,
        binding_digest: claim.binding_digest,
      };
    },
    resolveRef: ({ ref }) => ({
      [TARGET_REF]: TARGET_SHA,
      [CONSUMER_REF]: CONSUMER_SHA,
      [REMOTE_REF]: REMOTE_SHA,
    })[ref] || null,
    isAncestor: ({ ancestor, descendant }) => (
      (ancestor === CANDIDATE_COMMIT && descendant === TARGET_SHA)
      || (ancestor === TARGET_SHA && descendant === CONSUMER_SHA)
      || (ancestor === TARGET_SHA && descendant === REMOTE_SHA)
    ),
    treeForCommit: ({ commit }) => commit === CANDIDATE_COMMIT ? CANDIDATE_TREE : null,
    ...overrides,
  };
}

function replayCampaignBundle(bundle) {
  const contractDigest = icc.canonicalDigest(bundle.contract);
  return icc.replayCampaignEvents(icc.createCampaignState({
    contract: bundle.contract,
    contractDigest,
    repoIdentity: REPO_IDENTITY,
    startedAt: bundle.state.started_at,
  }), bundle.events);
}

function rebindTerminalLedger(bundle) {
  bundle.events[bundle.events.length - 1].output_artifact_digest
    = bundle.terminal_receipt.receipt_digest;
  bundle.state = replayCampaignBundle(bundle);
}

function rebindVerificationLedger(bundle) {
  const verticalIndex = bundle.events.findLastIndex(
    (event) => event.event_type === icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
  );
  bundle.events[verticalIndex].output_artifact_digest
    = bundle.verification_receipt.receipt_digest;
  bundle.events[verticalIndex].payload.evidence_digest
    = bundle.verification_receipt.receipt_digest;
  bundle.events[verticalIndex + 1].input_artifact_digest
    = bundle.verification_receipt.receipt_digest;
  bundle.terminal_receipt = redigest({
    ...bundle.terminal_receipt,
    verification_receipt_digest: bundle.verification_receipt.receipt_digest,
  });
  rebindTerminalLedger(bundle);
}

group('canonical-green', () => {
  const receipt = buildTaskStatus(makeInput(), makeAdapters());
  check('real-mission-terminal', receipt.mission_terminal === true);
  check('real-campaign-terminal', receipt.campaigns_terminal === true);
  check('real-campaign-accepted', receipt.acceptance_verdict === 'accepted');
  check('product-merged-candidate-to-target', receipt.product_merged === true);
  check('consumer-updated-target-to-consumer', receipt.consumer_updated === true);
  check('pushed-target-to-remote', receipt.pushed === true);
  check('canonical-lifecycle-zero', receipt.zero_residue === true);
  check('p1-can-merge-false', receipt.can_merge === false);
  check('p1-can-close-false', receipt.can_close === false);
  check('p1-merge-preflight-unknown', receipt.failed_predicates.includes('merge_preflight_unknown'));
  check('p1-merge-edges-unknown', receipt.failed_predicates.includes('merge_edges_unknown'));
  const { receipt_digest: receiptDigest, ...receiptBody } = receipt;
  check('receipt-digest-canonical',
    receiptDigest === icc.canonicalDigest(receiptBody));
  check('coverage-evidence-uses-one-namespace',
    JSON.stringify(receipt.evidence.campaigns.provided_campaign_ids)
      === JSON.stringify(receipt.evidence.campaigns.required_campaign_ids));
});

group('durable-state-authority', () => {
  const contractDrift = clone(campaignBundle);
  contractDrift.contract.max_wall_seconds += 1;
  const contractDriftResult = buildTaskStatus(
    makeInput({ campaigns: [contractDrift] }),
    makeAdapters(),
  );
  check('icc-contract-state-digest-drift-rejected',
    contractDriftResult.acceptance_verdict === 'unknown');

  const ledgerDrift = clone(campaignBundle);
  ledgerDrift.events[0].output_artifact_digest = mission.sha256('ledger-drift');
  const ledgerDriftResult = buildTaskStatus(
    makeInput({ campaigns: [ledgerDrift] }),
    makeAdapters(),
  );
  check('icc-event-ledger-replay-drift-rejected',
    ledgerDriftResult.acceptance_verdict === 'unknown');

  const extra = clone(campaignBundle);
  extra.state.untrusted = true;
  const extraResult = buildTaskStatus(makeInput({ campaigns: [extra] }), makeAdapters());
  check('icc-state-extra-key-rejected', extraResult.acceptance_verdict === 'unknown');

  const rebound = clone(campaignBundle);
  rebound.state.last_output_artifact_digest = mission.sha256('substituted-terminal');
  const reboundResult = buildTaskStatus(makeInput({ campaigns: [rebound] }), makeAdapters());
  check('icc-state-tamper-without-ledger-rejected',
    reboundResult.acceptance_verdict === 'unknown');

  const mismatched = clone(campaignBundle);
  mismatched.terminal_receipt = redigest({
    ...mismatched.terminal_receipt,
    status: 'follow_up',
  });
  rebindTerminalLedger(mismatched);
  const mismatchResult = buildTaskStatus(makeInput({ campaigns: [mismatched] }), makeAdapters());
  check('icc-phase-terminal-status-mismatch-rejected', mismatchResult.acceptance_verdict === 'unknown');

  const verificationSwap = clone(campaignBundle);
  verificationSwap.verification_receipt.receipt_digest = mission.sha256('forged-verification');
  const verificationResult = buildTaskStatus(
    makeInput({ campaigns: [verificationSwap] }),
    makeAdapters(),
  );
  check('icc-verification-substitution-rejected', verificationResult.acceptance_verdict === 'unknown');

  const fenceSwap = clone(campaignBundle);
  fenceSwap.verification_receipt = redigest({
    ...fenceSwap.verification_receipt,
    writer_fence_digest: mission.sha256('other-writer-fence'),
  });
  rebindVerificationLedger(fenceSwap);
  const fenceResult = buildTaskStatus(
    makeInput({ campaigns: [fenceSwap] }),
    makeAdapters(),
  );
  check('icc-writer-fence-substitution-rejected',
    fenceResult.acceptance_verdict === 'unknown');

  const coherentVerificationSwap = clone(campaignBundle);
  coherentVerificationSwap.verification_receipt = redigest({
    ...coherentVerificationSwap.verification_receipt,
    stdout_digest: mission.sha256('coherent-substitute'),
  });
  coherentVerificationSwap.terminal_receipt = redigest({
    ...coherentVerificationSwap.terminal_receipt,
    verification_receipt_digest:
      coherentVerificationSwap.verification_receipt.receipt_digest,
  });
  coherentVerificationSwap.events[coherentVerificationSwap.events.length - 1]
    .output_artifact_digest = coherentVerificationSwap.terminal_receipt.receipt_digest;
  coherentVerificationSwap.state = replayCampaignBundle(coherentVerificationSwap);
  const coherentVerificationResult = buildTaskStatus(
    makeInput({ campaigns: [coherentVerificationSwap] }),
    makeAdapters(),
  );
  check('icc-ledger-verification-substitution-rejected',
    coherentVerificationResult.acceptance_verdict === 'unknown');

  const reversedTime = clone(campaignBundle);
  reversedTime.verification_receipt = redigest({
    ...reversedTime.verification_receipt,
    started_at: '2026-07-27T00:00:04.000Z',
    ended_at: '2026-07-27T00:00:03.000Z',
  });
  rebindVerificationLedger(reversedTime);
  const reversedTimeResult = buildTaskStatus(
    makeInput({ campaigns: [reversedTime] }),
    makeAdapters(),
  );
  check('icc-verification-time-order-rejected',
    reversedTimeResult.acceptance_verdict === 'unknown');

  const malformedTime = clone(campaignBundle);
  malformedTime.state.started_at = 'not-a-timestamp';
  const malformedTimeResult = buildTaskStatus(
    makeInput({ campaigns: [malformedTime] }),
    makeAdapters(),
  );
  check('icc-malformed-time-fails-closed', malformedTimeResult.acceptance_verdict === 'unknown');

  const terminalDigestSwap = clone(campaignBundle);
  terminalDigestSwap.terminal_receipt.receipt_digest = mission.sha256('forged-terminal');
  const terminalDigestResult = buildTaskStatus(
    makeInput({ campaigns: [terminalDigestSwap] }),
    makeAdapters(),
  );
  check('icc-terminal-receipt-digest-substitution-rejected',
    terminalDigestResult.acceptance_verdict === 'unknown');

  const malformedFinding = clone(campaignBundle);
  malformedFinding.terminal_receipt = redigest({
    ...malformedFinding.terminal_receipt,
    status: 'follow_up',
    follow_up: [null],
  });
  rebindTerminalLedger(malformedFinding);
  const malformedFindingResult = buildTaskStatus(
    makeInput({ campaigns: [malformedFinding] }),
    makeAdapters(),
  );
  check('icc-malformed-terminal-finding-rejected',
    malformedFindingResult.acceptance_verdict === 'unknown');

  const malformedMustFix = buildCampaignBundle({
    status: 'follow_up',
    unresolved: [{ id: 'malformed-must-fix', claim: 'must bind frozen acceptance' }],
  });
  malformedMustFix.terminal_receipt
    .unresolved_final_findings[0].disposition.acceptance_id = 42;
  malformedMustFix.terminal_receipt = redigest(malformedMustFix.terminal_receipt);
  rebindTerminalLedger(malformedMustFix);
  const malformedMustFixResult = buildTaskStatus(
    makeInput({ campaigns: [malformedMustFix] }),
    makeAdapters(),
  );
  check('icc-malformed-must-fix-disposition-rejected',
    malformedMustFixResult.acceptance_verdict === 'unknown');

  const foreignAcceptance = buildCampaignBundle({
    status: 'follow_up',
    unresolved: [{ id: 'foreign-acceptance', claim: 'must bind the matched Mission claim' }],
  });
  foreignAcceptance.terminal_receipt
    .unresolved_final_findings[0].disposition.acceptance_id = 'acceptance-from-other-claim';
  foreignAcceptance.terminal_receipt = redigest(foreignAcceptance.terminal_receipt);
  rebindTerminalLedger(foreignAcceptance);
  const foreignAcceptanceResult = buildTaskStatus(
    makeInput({ campaigns: [foreignAcceptance] }),
    makeAdapters(),
  );
  check('icc-must-fix-acceptance-binding-rejected',
    foreignAcceptanceResult.acceptance_verdict === 'unknown');

  const refutedFollowUp = clone(campaignBundle);
  const invalidFollowUp = retainedFinding(
    { id: 'refuted-follow-up', claim: 'must not defer refuted evidence' },
    {
      disposition: 'follow-up',
      context: 'invalid',
      trigger: 'never',
      proposed_backlog_title: 'invalid',
    },
  );
  invalidFollowUp.evidence.classification = 'refuted';
  refutedFollowUp.terminal_receipt = redigest({
    ...refutedFollowUp.terminal_receipt,
    status: 'follow_up',
    follow_up: [invalidFollowUp],
  });
  rebindTerminalLedger(refutedFollowUp);
  const refutedFollowUpResult = buildTaskStatus(
    makeInput({ campaigns: [refutedFollowUp] }),
    makeAdapters(),
  );
  check('icc-refuted-follow-up-rejected',
    refutedFollowUpResult.acceptance_verdict === 'unknown');

  const canonicalRefuted = clone(campaignBundle);
  const rejectedFinding = retainedFinding(
    { id: 'canonical-refuted', claim: 'disproved by canonical evidence' },
    null,
  );
  rejectedFinding.evidence.classification = 'refuted';
  delete rejectedFinding.disposition;
  canonicalRefuted.terminal_receipt = redigest({
    ...canonicalRefuted.terminal_receipt,
    rejected_findings: [rejectedFinding],
  });
  rebindTerminalLedger(canonicalRefuted);
  const canonicalRefutedResult = buildTaskStatus(
    makeInput({ campaigns: [canonicalRefuted] }),
    makeAdapters(),
  );
  check('icc-canonical-refuted-finding-accepted',
    canonicalRefutedResult.acceptance_verdict === 'accepted');

  const readyWithFollowUp = clone(campaignBundle);
  const impossibleReadyFollowUp = retainedFinding(
    { id: 'ready-follow-up', claim: 'ready cannot retain deferred work' },
    {
      disposition: 'follow-up',
      context: 'contradictory ready receipt',
      trigger: 'never',
      proposed_backlog_title: 'must be rejected',
    },
  );
  readyWithFollowUp.terminal_receipt = redigest({
    ...readyWithFollowUp.terminal_receipt,
    follow_up: [impossibleReadyFollowUp],
  });
  rebindTerminalLedger(readyWithFollowUp);
  const readyWithFollowUpResult = buildTaskStatus(
    makeInput({ campaigns: [readyWithFollowUp] }),
    makeAdapters(),
  );
  check('icc-ready-with-follow-up-rejected',
    readyWithFollowUpResult.acceptance_verdict === 'unknown');

  const followUpDigestDrift = buildCampaignBundle({
    status: 'follow_up',
    followUp: [{ id: 'digest-drift', claim: 'terminal ledger must bind retained follow-up' }],
  });
  followUpDigestDrift.events[followUpDigestDrift.events.length - 1]
    .payload.follow_up_digest = mission.sha256('other-follow-up-set');
  followUpDigestDrift.state = replayCampaignBundle(followUpDigestDrift);
  const followUpDigestDriftResult = buildTaskStatus(
    makeInput({ campaigns: [followUpDigestDrift] }),
    makeAdapters(),
  );
  check('icc-terminal-follow-up-digest-drift-rejected',
    followUpDigestDriftResult.acceptance_verdict === 'unknown');

  const overBudget = clone(campaignBundle);
  overBudget.state.usage.changed_files = overBudget.state.limits.max_changed_files + 1;
  const overBudgetResult = buildTaskStatus(
    makeInput({ campaigns: [overBudget] }),
    makeAdapters(),
  );
  check('icc-impossible-usage-rejected', overBudgetResult.acceptance_verdict === 'unknown');

  const generationDrift = clone(campaignBundle);
  generationDrift.state.generation = 1;
  const generationResult = buildTaskStatus(
    makeInput({ campaigns: [generationDrift] }),
    makeAdapters(),
  );
  check('icc-generation-usage-drift-rejected',
    generationResult.acceptance_verdict === 'unknown');

  const truncated = clone(campaignBundle);
  truncated.state.idempotency_records = truncated.state.idempotency_records.slice(0, 1);
  truncated.state.event_count = 1;
  const truncatedResult = buildTaskStatus(
    makeInput({ campaigns: [truncated] }),
    makeAdapters(),
  );
  check('icc-truncated-terminal-history-rejected',
    truncatedResult.acceptance_verdict === 'unknown');

  const repairCountDrift = clone(campaignBundle);
  repairCountDrift.terminal_receipt = redigest({
    ...repairCountDrift.terminal_receipt,
    repair_generations: 1,
  });
  rebindTerminalLedger(repairCountDrift);
  const repairCountResult = buildTaskStatus(
    makeInput({ campaigns: [repairCountDrift] }),
    makeAdapters(),
  );
  check('icc-terminal-repair-count-drift-rejected',
    repairCountResult.acceptance_verdict === 'unknown');

  const repairLimit = clone(campaignBundle);
  repairLimit.state.limits.max_repair_generations = 0;
  repairLimit.state.generation = 1;
  repairLimit.state.usage.repair_generations = 1;
  repairLimit.terminal_receipt = redigest({
    ...repairLimit.terminal_receipt,
    repair_generations: 1,
  });
  repairLimit.state.last_output_artifact_digest = repairLimit.terminal_receipt.receipt_digest;
  while (repairLimit.state.idempotency_records.length < 10) {
    const index = repairLimit.state.idempotency_records.length;
    repairLimit.state.idempotency_records.push({
      key: `padded-${index}`,
      event_digest: mission.sha256(`padded-${index}`),
    });
  }
  repairLimit.state.event_count = repairLimit.state.idempotency_records.length;
  const repairLimitResult = buildTaskStatus(
    makeInput({ campaigns: [repairLimit] }),
    makeAdapters(),
  );
  check('icc-repair-limit-exceeded-rejected',
    repairLimitResult.acceptance_verdict === 'unknown');
});

group('mission-campaign-authorization', () => {
  const wrongContract = buildCampaignBundle({ ticket: 'other-ticket' });
  const wrongContractResult = buildTaskStatus(
    makeInput({ campaigns: [wrongContract] }),
    makeAdapters(),
  );
  check('mission-campaign-contract-mismatch-rejected',
    wrongContractResult.acceptance_verdict === 'unknown');

  const wrongBase = clone(campaignBundle);
  wrongBase.candidate.base = '6'.repeat(40);
  const wrongBaseResult = buildTaskStatus(
    makeInput({ campaigns: [wrongBase] }),
    makeAdapters(),
  );
  check('mission-campaign-base-mismatch-rejected',
    wrongBaseResult.acceptance_verdict === 'unknown');

  const twoClaims = buildMissionBundle({ campaignCount: 2 });
  const partial = buildTaskStatus(makeInput({
    mission: {
      state: twoClaims.state,
      terminal_receipt: twoClaims.terminal_receipt,
    },
    campaigns: [campaignBundle],
  }), makeAdapters());
  check('partial-coverage-candidate-hidden', partial.candidate_commit === null);
  check('partial-coverage-integration-unknown',
    partial.product_merged === null && partial.pushed === null);

  const partialFollowUp = buildCampaignBundle({
    status: 'follow_up',
    followUp: [{ id: 'partial-deferred', claim: 'requires exact sibling coverage' }],
  });
  const partialFollowUpResult = buildTaskStatus(makeInput({
    mission: {
      state: twoClaims.state,
      terminal_receipt: twoClaims.terminal_receipt,
    },
    campaigns: [partialFollowUp],
  }), makeAdapters());
  check('partial-coverage-deferred-not-aggregated',
    partialFollowUpResult.deferred_count === 0);

  const unboundFollowUp = buildCampaignBundle({
    status: 'follow_up',
    followUp: [{ id: 'unbound-deferred', claim: 'must not influence task status' }],
  });
  const unboundResult = buildTaskStatus(
    makeInput({ campaigns: [unboundFollowUp] }),
    makeAdapters({ resolveCampaignBinding: () => ({ status: 'unknown' }) }),
  );
  check('unbound-campaign-deferred-not-aggregated',
    unboundResult.acceptance_verdict === 'unknown'
      && unboundResult.deferred_count === 0
      && unboundResult.accepted_blockers.length === 0);
});

group('lifecycle-authority', () => {
  const falseClean = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      zero_residue: true,
      receipt_digest: mission.sha256('false-clean'),
      active_owned_worktrees: 1,
      active_owned_branches: 0,
    }),
  }));
  check('lifecycle-contradictory-false-clean-unknown', falseClean.zero_residue === null);
  check('lifecycle-contradictory-counts-hidden', falseClean.active_owned_worktrees === null);

  const falseDirty = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      zero_residue: false,
      receipt_digest: mission.sha256('false-dirty'),
      active_owned_worktrees: 0,
      active_owned_branches: 0,
    }),
  }));
  check('lifecycle-contradictory-false-dirty-unknown', falseDirty.zero_residue === null);

  const smuggled = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({
      status: 'valid',
      zero_residue: true,
      receipt_digest: mission.sha256('smuggled'),
      active_owned_worktrees: 0,
      active_owned_branches: 0,
      receipt: { zero_residue: true },
    }),
  }));
  check('lifecycle-noncanonical-result-rejected', smuggled.zero_residue === null);
});

group('integration-authority', () => {
  const gitQueries = [];
  buildTaskStatus(makeInput(), makeAdapters({
    resolveRef: (query) => {
      gitQueries.push(query);
      return ({
        [TARGET_REF]: TARGET_SHA,
        [CONSUMER_REF]: CONSUMER_SHA,
        [REMOTE_REF]: REMOTE_SHA,
      })[query.ref] || null;
    },
    isAncestor: (query) => {
      gitQueries.push(query);
      return (query.ancestor === CANDIDATE_COMMIT && query.descendant === TARGET_SHA)
        || (query.ancestor === TARGET_SHA && query.descendant === CONSUMER_SHA)
        || (query.ancestor === TARGET_SHA && query.descendant === REMOTE_SHA);
    },
    treeForCommit: (query) => {
      gitQueries.push(query);
      return query.commit === CANDIDATE_COMMIT ? CANDIDATE_TREE : null;
    },
  }));
  check('git-adapters-receive-repo-context', gitQueries.length > 0
    && gitQueries.every((query) => (
      query.repo === REPO && query.repo_identity === REPO_IDENTITY
    )));

  const candidateShortcutOnly = buildTaskStatus(makeInput(), makeAdapters({
    isAncestor: ({ ancestor, descendant }) => (
      (ancestor === CANDIDATE_COMMIT && descendant === TARGET_SHA)
      || (ancestor === CANDIDATE_COMMIT && descendant === CONSUMER_SHA)
      || (ancestor === CANDIDATE_COMMIT && descendant === REMOTE_SHA)
    ),
  }));
  check('consumer-does-not-use-candidate-shortcut', candidateShortcutOnly.consumer_updated === false);
  check('push-does-not-use-candidate-shortcut', candidateShortcutOnly.pushed === false);

  const targetConsumerUnknown = buildTaskStatus(makeInput(), makeAdapters({
    isAncestor: ({ ancestor, descendant }) => {
      if (ancestor === TARGET_SHA && descendant === CONSUMER_SHA) return null;
      return (ancestor === CANDIDATE_COMMIT && descendant === TARGET_SHA)
        || (ancestor === TARGET_SHA && descendant === REMOTE_SHA);
    },
  }));
  check('consumer-unknown-preserved', targetConsumerUnknown.consumer_updated === null);

  const targetRemoteUnknown = buildTaskStatus(makeInput(), makeAdapters({
    isAncestor: ({ ancestor, descendant }) => {
      if (ancestor === TARGET_SHA && descendant === REMOTE_SHA) return null;
      return (ancestor === CANDIDATE_COMMIT && descendant === TARGET_SHA)
        || (ancestor === TARGET_SHA && descendant === CONSUMER_SHA);
    },
  }));
  check('push-unknown-preserved', targetRemoteUnknown.pushed === null);
});

group('artifact-substitution', () => {
  const missionSwap = clone(missionBundle);
  missionSwap.terminal_receipt.state_digest = mission.sha256('another-state');
  missionSwap.terminal_receipt = {
    ...missionSwap.terminal_receipt,
    receipt_digest: mission.sha256({
      ...missionSwap.terminal_receipt,
      receipt_digest: undefined,
    }),
  };
  const result = buildTaskStatus(makeInput({
    mission: {
      state: missionSwap.state,
      terminal_receipt: missionSwap.terminal_receipt,
    },
  }), makeAdapters());
  check('mission-state-receipt-substitution-rejected', result.mission_terminal === null);

  const missionAuthority = clone(missionBundle);
  missionAuthority.terminal_receipt.can_close = true;
  const authorityResult = buildTaskStatus(makeInput({
    mission: {
      state: missionAuthority.state,
      terminal_receipt: missionAuthority.terminal_receipt,
    },
  }), makeAdapters());
  check('mission-extra-authority-field-rejected', authorityResult.mission_terminal === null);

  const treeSwap = clone(campaignBundle);
  treeSwap.candidate.tree_sha = '9'.repeat(40);
  const treeResult = buildTaskStatus(makeInput({ campaigns: [treeSwap] }), makeAdapters());
  check('candidate-tree-substitution-rejected', treeResult.acceptance_verdict === 'unknown');
});

group('terminal-semantics', () => {
  const blocked = buildBlockedMissionBundle();
  const blockedResult = buildTaskStatus(makeInput({
    mission: { state: blocked.state, terminal_receipt: blocked.terminal_receipt },
    campaigns: [],
  }), makeAdapters());
  check('real-blocked-mission-terminal', blockedResult.mission_terminal === true);
  check('real-blocked-mission-rejected', blockedResult.acceptance_verdict === 'rejected');
  check('real-blocked-mission-cannot-close', blockedResult.can_close === false);

  const followUp = buildCampaignBundle({
    status: 'follow_up',
    followUp: [{ id: 'fu-1', claim: 'document later' }],
  });
  const followResult = buildTaskStatus(makeInput({ campaigns: [followUp] }), makeAdapters());
  check('real-follow-up-campaign-accepted', followResult.acceptance_verdict === 'accepted');
  check('real-follow-up-deferred-retained', followResult.deferred_count === 1);

  const unresolved = buildCampaignBundle({
    status: 'follow_up',
    unresolved: [{ id: 'finding-1', claim: 'must fix' }],
  });
  const unresolvedResult = buildTaskStatus(
    makeInput({ campaigns: [unresolved] }),
    makeAdapters(),
  );
  check('real-unresolved-campaign-rejected', unresolvedResult.acceptance_verdict === 'rejected');
  check('real-unresolved-blocker-retained', unresolvedResult.accepted_blockers.length === 1);

  const stopped = buildCampaignBundle({ status: 'stop' });
  const stoppedResult = buildTaskStatus(makeInput({ campaigns: [stopped] }), makeAdapters());
  check('terminal-stop-without-canonical-receipt-status-unknown',
    stoppedResult.acceptance_verdict === 'unknown');

  const omitted = buildTaskStatus(makeInput({ campaigns: [] }), makeAdapters());
  check('omitted-sibling-coverage-unknown', omitted.campaigns_terminal === null);
  check('omitted-sibling-not-accepted', omitted.acceptance_verdict === 'unknown');

});

group('missing-and-invalid-evidence', () => {
  const missing = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'missing' }),
  }));
  check('lifecycle-missing-is-unknown', missing.zero_residue === null);

  const stale = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'stale', drift: ['observed_head'] }),
  }));
  check('lifecycle-stale-is-unknown', stale.zero_residue === null);

  const invalid = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'valid', zero_residue: true }),
  }));
  check('lifecycle-invalid-shape-is-unknown', invalid.zero_residue === null);

  const noRef = buildTaskStatus(makeInput(), makeAdapters({ resolveRef: () => null }));
  check('missing-integration-ref-is-unknown', noRef.product_merged === null);

  let unboundGitCalls = 0;
  const noRepoIdentity = buildTaskStatus(makeInput(), makeAdapters({
    resolveRepoIdentity: () => null,
    resolveRef: () => { unboundGitCalls += 1; return TARGET_SHA; },
    isAncestor: () => { unboundGitCalls += 1; return true; },
    treeForCommit: () => { unboundGitCalls += 1; return CANDIDATE_TREE; },
  }));
  check('unresolved-repo-identity-skips-git-adapters',
    unboundGitCalls === 0
      && noRepoIdentity.product_merged === null
      && noRepoIdentity.consumer_updated === null
      && noRepoIdentity.pushed === null);

  const wrongTree = buildTaskStatus(makeInput(), makeAdapters({
    treeForCommit: () => '8'.repeat(40),
  }));
  check('candidate-commit-tree-mismatch-is-unknown', wrongTree.product_merged === null);
});

group('receipt-and-fail-closed', () => {
  const first = buildTaskStatus(makeInput(), makeAdapters());
  const second = buildTaskStatus(makeInput(), makeAdapters());
  check('deterministic-receipt-digest', first.receipt_digest === second.receipt_digest);
  const changed = buildTaskStatus(makeInput(), makeAdapters({
    isAncestor: () => false,
  }));
  check('receipt-digest-sensitive-to-facts', first.receipt_digest !== changed.receipt_digest);

  let unknownInputRejected = false;
  try {
    buildTaskStatus({ ...makeInput(), attacker_field: true }, makeAdapters());
  } catch (error) {
    unknownInputRejected = error.code === 'TASK_STATUS_UNKNOWN_FIELD';
  }
  check('unknown-input-field-rejected', unknownInputRejected);

  let noncanonicalTimeRejected = false;
  try {
    buildTaskStatus(makeInput({ observed_at: 'July 27, 2026 00:00:00 UTC' }), makeAdapters());
  } catch (_error) {
    noncanonicalTimeRejected = true;
  }
  check('noncanonical-observed-time-rejected', noncanonicalTimeRejected);

  const allUnknown = buildTaskStatus(makeInput(), makeAdapters({
    inspectLifecycleReceipt: () => ({ status: 'missing' }),
    resolveRef: () => null,
    treeForCommit: () => null,
    resolveCampaignBinding: () => ({ status: 'unknown' }),
  }));
  const required = [
    'merge_preflight_unknown',
    'campaigns_terminal_unknown',
    'acceptance_unknown',
    'product_merged_unknown',
    'consumer_updated_unknown',
    'pushed_unknown',
    'zero_residue_unknown',
    'merge_edges_unknown',
  ];
  check('failed-predicates-complete', required.every(
    (predicate) => allUnknown.failed_predicates.includes(predicate),
  ));
});

for (const result of results) {
  process.stdout.write(`${result.id}\t${result.pass ? 'PASS' : 'FAIL'}${result.detail ? `\t${result.detail}` : ''}\n`);
}
if (results.some((result) => !result.pass)) process.exitCode = 1;
NODE
NODE_EXIT=$?

cat "$OUT_FILE"
assert_exit_code "$NODE_EXIT" "0" "LSM P1 real-artifact oracle passes"
assert_not_contains "$(cat "$OUT_FILE")" $'\tFAIL' "every named LSM P1 invariant passes"
assert_contains "$(cat "$OUT_FILE")" $'p1-can-close-false\tPASS' \
  "P1 never claims closeout while merge preflight is unknown"
assert_contains "$(cat "$OUT_FILE")" $'icc-state-tamper-without-ledger-rejected\tPASS' \
  "durable ICC state is bound to replayed evidence"
assert_contains "$(cat "$OUT_FILE")" $'lifecycle-contradictory-false-clean-unknown\tPASS' \
  "contradictory lifecycle evidence fails unknown"

finalize_test
