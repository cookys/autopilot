'use strict';

// Pure LSM P1 task-status aggregation.
// Read-only: consumes Mission / ICC / WLB evidence + injected git adapters.
// Sole owner of task-level can_merge / can_close predicates. Never mutates
// refs, worktrees, or finish markers. Never trusts schema-only terminal flags.

const fs = require('fs');
const {
  validateMissionState,
  stateHash,
  sha256,
  TERMINAL_STATES: MISSION_TERMINAL_STATES,
  MissionReducerError,
} = require('../mission/interface');
const {
  CAMPAIGN_STATES,
  canonicalDigest,
  normalizeCampaignArtifactReference,
  CampaignStateError,
} = require('../engine/implementation-campaign');

const SCHEMA_VERSION = 1;
const ARTIFACT_TYPE = 'task_status_receipt';

const INPUT_KEYS = Object.freeze([
  'repo',
  'root_run_id',
  'observed_at',
  'goal',
  'phase',
  'mission',
  'campaigns',
  'lifecycle_receipt_path',
  'integration',
  'merge_preflight',
]);
const INPUT_KEY_SET = new Set(INPUT_KEYS);

const ADAPTER_KEYS = Object.freeze([
  'inspectLifecycleReceipt',
  'resolveRef',
  'isAncestor',
  'treeForCommit',
]);
const ADAPTER_KEY_SET = new Set(ADAPTER_KEYS);

const MISSION_INPUT_KEYS = Object.freeze(['state', 'terminal_receipt']);
const MISSION_INPUT_KEY_SET = new Set(MISSION_INPUT_KEYS);

const CAMPAIGN_INPUT_KEYS = Object.freeze([
  'state',
  'terminal_receipt',
  'verification_receipt',
  'candidate',
]);
const CAMPAIGN_INPUT_KEY_SET = new Set(CAMPAIGN_INPUT_KEYS);

const INTEGRATION_KEYS = Object.freeze([
  'target_ref',
  'consumer_ref',
  'remote_ref',
  'push_required',
  'required_consumer_update',
]);
const INTEGRATION_KEY_SET = new Set(INTEGRATION_KEYS);

const CAMPAIGN_TERMINAL_PHASES = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
  CAMPAIGN_STATES.TERMINAL_STOP,
]);

const ACCEPTANCE_PHASES = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
]);

class TaskStatusError extends Error {
  constructor(message, code = 'TASK_STATUS_INVALID') {
    super(message);
    this.name = 'TaskStatusError';
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) {
    throw new TaskStatusError(`${label} must be a plain object`, 'TASK_STATUS_SHAPE');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TaskStatusError(
        `${label} has unknown field "${key}"`,
        'TASK_STATUS_UNKNOWN_FIELD',
      );
    }
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TaskStatusError(
        `${label} is missing "${key}"`,
        'TASK_STATUS_MISSING_FIELD',
      );
    }
  }
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isGitOid(value) {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function missionReceiptBodyDigest(receipt) {
  if (!isPlainObject(receipt) || typeof receipt.receipt_digest !== 'string') return null;
  const { receipt_digest: _ignored, ...body } = receipt;
  return sha256(body);
}

function campaignReceiptBodyDigest(receipt) {
  if (!isPlainObject(receipt) || typeof receipt.receipt_digest !== 'string') return null;
  const { receipt_digest: _ignored, ...body } = receipt;
  return canonicalDigest(body);
}

function safeCall(fn, args, label) {
  try {
    return { ok: true, value: fn(...args) };
  } catch (_error) {
    return { ok: false, error: `${label}_failed` };
  }
}

function emptyMissionEvidence(status, reason) {
  return {
    status,
    reason,
    state: null,
    state_digest: null,
    receipt_digest: null,
    terminal_digest: null,
  };
}

function emptyCampaignItemEvidence(status, reason, campaignId) {
  return {
    status,
    reason,
    campaign_id: campaignId,
    phase: null,
    terminal_status: null,
    verification_receipt_digest: null,
    terminal_receipt_digest: null,
    unresolved_count: null,
    follow_up_count: null,
    candidate_commit: null,
    candidate_tree_sha: null,
  };
}

function emptyLifecycleEvidence(status, reason) {
  return {
    status,
    reason,
    receipt_digest: null,
    inspect_status: null,
    zero_residue: null,
    owned_worktrees: null,
    owned_branches: null,
    active_owned_branches: null,
  };
}

function emptyIntegrationEvidence(status, reason, integration) {
  return {
    status,
    reason,
    target_ref: integration && typeof integration.target_ref === 'string'
      ? integration.target_ref
      : null,
    target_sha: null,
    consumer_ref: integration && typeof integration.consumer_ref === 'string'
      ? integration.consumer_ref
      : null,
    consumer_sha: null,
    remote_ref: integration && typeof integration.remote_ref === 'string'
      ? integration.remote_ref
      : null,
    remote_sha: null,
    push_required: integration ? integration.push_required === true : false,
    required_consumer_update: integration
      ? integration.required_consumer_update === true
      : false,
    candidate_commit: null,
  };
}

function readLifecycleReceiptFile(pathValue) {
  if (pathValue === null || pathValue === undefined) {
    return { status: 'missing', receipt: null, reason: 'lifecycle_receipt_missing' };
  }
  if (typeof pathValue !== 'string' || pathValue.length === 0) {
    return { status: 'invalid', receipt: null, reason: 'lifecycle_receipt_path_invalid' };
  }
  try {
    if (!fs.existsSync(pathValue)) {
      return { status: 'missing', receipt: null, reason: 'lifecycle_receipt_missing' };
    }
    const raw = fs.readFileSync(pathValue, 'utf8');
    const receipt = JSON.parse(raw);
    if (!isPlainObject(receipt)) {
      return { status: 'invalid', receipt: null, reason: 'lifecycle_receipt_not_object' };
    }
    return { status: 'loaded', receipt, reason: null };
  } catch (_error) {
    return { status: 'invalid', receipt: null, reason: 'lifecycle_receipt_unreadable' };
  }
}

function missionInvalid(reason) {
  return {
    valid: false,
    mission_terminal: null,
    state_name: null,
    state_digest: null,
    receipt_digest: null,
    repo_identity: null,
    complete: false,
    blockers: [],
    claims: {},
    evidence: emptyMissionEvidence('invalid', reason),
  };
}

function validateMissionBundle(mission, rootRunId) {
  if (!isPlainObject(mission)) {
    return missionInvalid('mission_input_not_object');
  }
  assertExactKeys(mission, MISSION_INPUT_KEY_SET, 'mission');

  const { state, terminal_receipt: terminalReceipt } = mission;
  try {
    validateMissionState(state);
  } catch (error) {
    if (error instanceof MissionReducerError || error instanceof TypeError) {
      return missionInvalid('mission_state_invalid');
    }
    throw error;
  }

  if (state.root_run_id !== rootRunId) {
    return missionInvalid('mission_root_run_id_mismatch');
  }
  if (typeof state.repo_identity !== 'string' || state.repo_identity.length === 0) {
    return missionInvalid('mission_repo_identity_missing');
  }
  if (!MISSION_TERMINAL_STATES.has(state.state) || !isPlainObject(state.terminal)) {
    return missionInvalid('mission_not_terminal');
  }
  if (!isPlainObject(terminalReceipt)) {
    return missionInvalid('mission_terminal_receipt_missing');
  }

  // Actual content-bound buildMissionTerminalReceipt shape (not the broader
  // historical JSON schema that also allows can_close on the mission receipt).
  if (terminalReceipt.schema_version !== 1
      || terminalReceipt.artifact_type !== 'mission_terminal_receipt'
      || terminalReceipt.mission_terminal !== true) {
    return missionInvalid('mission_terminal_receipt_artifact_invalid');
  }

  const expectedStateDigest = stateHash(state);
  if (terminalReceipt.state_digest !== expectedStateDigest) {
    return missionInvalid('mission_state_digest_mismatch');
  }

  const expectedTerminalDigest = sha256(state.terminal);
  if (terminalReceipt.terminal_digest !== expectedTerminalDigest) {
    return missionInvalid('mission_terminal_digest_mismatch');
  }

  const expectedReceiptDigest = missionReceiptBodyDigest(terminalReceipt);
  if (!expectedReceiptDigest || terminalReceipt.receipt_digest !== expectedReceiptDigest) {
    return missionInvalid('mission_receipt_digest_mismatch');
  }

  if (!isPlainObject(terminalReceipt.residue)
      || typeof terminalReceipt.residue_digest !== 'string'
      || !isSha256(terminalReceipt.residue_digest)
      || !isPlainObject(terminalReceipt.residue)
      || terminalReceipt.residue.residue_digest !== terminalReceipt.residue_digest) {
    return missionInvalid('mission_residue_invalid');
  }
  const residueContent = Object.fromEntries(
    Object.entries(terminalReceipt.residue).filter(([key]) => key !== 'residue_digest'),
  );
  if (sha256(residueContent) !== terminalReceipt.residue_digest) {
    return missionInvalid('mission_residue_digest_mismatch');
  }

  // Refuse mission receipts that smuggle task can_close authority.
  if (Object.prototype.hasOwnProperty.call(terminalReceipt, 'can_close')) {
    return missionInvalid('mission_receipt_claims_can_close');
  }

  const blockers = [];
  if (state.state === 'BLOCKED' || state.state === 'ABORTED') {
    blockers.push({
      kind: 'mission_terminal_state',
      subject: state.mission_lineage_id || 'mission',
      reason: `mission_state_${String(state.state).toLowerCase()}`,
    });
  }

  return {
    valid: true,
    mission_terminal: true,
    state_name: state.state,
    state_digest: expectedStateDigest,
    receipt_digest: terminalReceipt.receipt_digest,
    repo_identity: state.repo_identity,
    complete: state.state === 'COMPLETE',
    blockers,
    claims: state.claims && typeof state.claims === 'object' ? state.claims : {},
    evidence: {
      status: 'valid',
      reason: null,
      state: state.state,
      state_digest: expectedStateDigest,
      receipt_digest: terminalReceipt.receipt_digest,
      terminal_digest: expectedTerminalDigest,
    },
  };
}

function campaignInvalid(campaignId, reason) {
  return {
    valid: false,
    accepted: false,
    terminal: false,
    campaign_id: campaignId,
    candidate: null,
    blockers: [],
    deferred_count: 0,
    evidence: emptyCampaignItemEvidence('invalid', reason, campaignId),
  };
}

function validateCampaignEntry(entry, index, expectedRepoIdentity) {
  if (!isPlainObject(entry)) {
    return campaignInvalid(null, 'campaign_entry_not_object');
  }
  assertExactKeys(entry, CAMPAIGN_INPUT_KEY_SET, `campaigns[${index}]`);

  const {
    state,
    terminal_receipt: terminalReceipt,
    verification_receipt: verificationReceipt,
    candidate,
  } = entry;

  if (!isPlainObject(state)
      || typeof state.campaign_id !== 'string'
      || state.campaign_id.length === 0) {
    return campaignInvalid(null, 'campaign_state_identity_invalid');
  }
  const campaignId = state.campaign_id;

  if (typeof state.repo_identity === 'string'
      && expectedRepoIdentity
      && state.repo_identity !== expectedRepoIdentity) {
    return campaignInvalid(campaignId, 'campaign_repo_identity_mismatch');
  }

  if (typeof state.phase !== 'string' || !CAMPAIGN_TERMINAL_PHASES.has(state.phase)) {
    return campaignInvalid(campaignId, 'campaign_not_terminal');
  }

  if (!isPlainObject(terminalReceipt)
      || terminalReceipt.schema_version !== 1
      || terminalReceipt.artifact_type !== 'implementation_campaign_terminal'
      || !new Set(['ready', 'follow_up']).has(terminalReceipt.status)) {
    return campaignInvalid(campaignId, 'campaign_terminal_receipt_invalid');
  }

  const expectedTerminalDigest = campaignReceiptBodyDigest(terminalReceipt);
  if (!expectedTerminalDigest || terminalReceipt.receipt_digest !== expectedTerminalDigest) {
    return campaignInvalid(campaignId, 'campaign_terminal_digest_mismatch');
  }

  if (!isPlainObject(verificationReceipt)
      || verificationReceipt.schema_version !== 1
      || verificationReceipt.artifact_type !== 'implementation_campaign_verification'
      || verificationReceipt.verdict !== 'GREEN'
      || verificationReceipt.exit_status !== 0) {
    return campaignInvalid(campaignId, 'campaign_verification_not_green');
  }

  const expectedVerificationDigest = campaignReceiptBodyDigest(verificationReceipt);
  if (!expectedVerificationDigest
      || verificationReceipt.receipt_digest !== expectedVerificationDigest) {
    return campaignInvalid(campaignId, 'campaign_verification_digest_mismatch');
  }

  if (verificationReceipt.campaign_id !== campaignId) {
    return campaignInvalid(campaignId, 'campaign_verification_campaign_mismatch');
  }
  if (terminalReceipt.verification_receipt_digest !== verificationReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_verification_binding_mismatch');
  }
  if (!isGitOid(terminalReceipt.candidate_tree_sha)
      || terminalReceipt.candidate_tree_sha !== verificationReceipt.tree_sha) {
    return campaignInvalid(campaignId, 'campaign_tree_binding_mismatch');
  }

  let normalizedCandidate;
  try {
    normalizedCandidate = normalizeCampaignArtifactReference(candidate);
  } catch (error) {
    if (error instanceof CampaignStateError || error instanceof TypeError) {
      return campaignInvalid(campaignId, 'campaign_candidate_invalid');
    }
    throw error;
  }
  if (!normalizedCandidate || normalizedCandidate.kind !== 'git_candidate') {
    return campaignInvalid(campaignId, 'campaign_candidate_not_git_candidate');
  }
  if (normalizedCandidate.tree_sha !== terminalReceipt.candidate_tree_sha
      || normalizedCandidate.tree_sha !== verificationReceipt.tree_sha) {
    return campaignInvalid(campaignId, 'campaign_candidate_tree_mismatch');
  }
  if (normalizedCandidate.writer_fence.campaign_id !== campaignId) {
    return campaignInvalid(campaignId, 'campaign_writer_fence_campaign_mismatch');
  }

  const unresolved = Array.isArray(terminalReceipt.unresolved_final_findings)
    ? terminalReceipt.unresolved_final_findings
    : null;
  const followUp = Array.isArray(terminalReceipt.follow_up)
    ? terminalReceipt.follow_up
    : null;
  if (unresolved === null || followUp === null) {
    return campaignInvalid(campaignId, 'campaign_findings_shape_invalid');
  }

  const blockers = unresolved.map((finding, findingIndex) => ({
    kind: 'unresolved_final_finding',
    subject: (finding && typeof finding.id === 'string' && finding.id.length > 0)
      ? finding.id
      : `${campaignId}:finding:${findingIndex}`,
    reason: (finding && typeof finding.claim === 'string' && finding.claim.length > 0)
      ? finding.claim
      : 'unresolved_final_finding',
  }));

  if (state.phase === CAMPAIGN_STATES.TERMINAL_STOP) {
    blockers.push({
      kind: 'campaign_terminal_stop',
      subject: campaignId,
      reason: 'campaign_terminal_stop',
    });
  }

  const accepted = ACCEPTANCE_PHASES.has(state.phase)
    && blockers.length === 0;

  return {
    valid: true,
    accepted,
    terminal: true,
    campaign_id: campaignId,
    candidate: normalizedCandidate,
    blockers,
    deferred_count: followUp.length,
    evidence: {
      status: 'valid',
      reason: null,
      campaign_id: campaignId,
      phase: state.phase,
      terminal_status: terminalReceipt.status,
      verification_receipt_digest: verificationReceipt.receipt_digest,
      terminal_receipt_digest: terminalReceipt.receipt_digest,
      unresolved_count: unresolved.length,
      follow_up_count: followUp.length,
      candidate_commit: normalizedCandidate.commit,
      candidate_tree_sha: normalizedCandidate.tree_sha,
    },
  };
}

function nonreleasedCampaignIds(claims) {
  const ids = new Set();
  if (!claims || typeof claims !== 'object') return ids;
  for (const claim of Object.values(claims)) {
    if (!claim || typeof claim !== 'object') continue;
    if (claim.released === true) continue;
    if (typeof claim.campaign_id === 'string' && claim.campaign_id.length > 0) {
      ids.add(claim.campaign_id);
    }
  }
  return ids;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function validateCampaigns(campaigns, missionResult) {
  if (!Array.isArray(campaigns)) {
    throw new TaskStatusError('campaigns must be an array', 'TASK_STATUS_SHAPE');
  }

  const expectedRepoIdentity = missionResult.valid ? missionResult.repo_identity : null;
  const items = campaigns.map((entry, index) => (
    validateCampaignEntry(entry, index, expectedRepoIdentity)
  ));

  const providedIds = new Set();
  let hasDuplicate = false;
  for (const item of items) {
    if (!item.campaign_id) continue;
    if (providedIds.has(item.campaign_id)) hasDuplicate = true;
    providedIds.add(item.campaign_id);
  }

  const requiredIds = missionResult.valid
    ? nonreleasedCampaignIds(missionResult.claims)
    : new Set();

  const coverageExact = missionResult.valid
    && !hasDuplicate
    && setsEqual(providedIds, requiredIds);

  let coverageReason = null;
  if (!missionResult.valid) coverageReason = 'mission_invalid_skips_coverage';
  else if (hasDuplicate) coverageReason = 'duplicate_campaign_ids';
  else if (!coverageExact) {
    const missing = [...requiredIds].some((id) => !providedIds.has(id));
    coverageReason = missing ? 'campaign_coverage_missing' : 'campaign_coverage_extra';
  }

  const allValid = items.every((item) => item.valid);
  const allTerminal = items.every((item) => item.terminal === true);
  const allAccepted = items.every((item) => item.accepted === true);

  let campaignsTerminal = null;
  if (missionResult.valid && coverageExact && allValid) {
    campaignsTerminal = allTerminal;
  } else if (missionResult.valid && allValid && !coverageExact) {
    campaignsTerminal = false;
  } else if (missionResult.valid && items.some((item) => item.valid && !item.terminal)) {
    campaignsTerminal = false;
  }

  return {
    items,
    coverageExact,
    coverageReason,
    campaigns_terminal: campaignsTerminal,
    all_accepted: coverageExact && allValid && allAccepted,
    all_valid: coverageExact && allValid,
    evidence: {
      status: coverageExact && allValid ? 'valid' : 'invalid',
      reason: coverageReason || (allValid ? null : 'campaign_entry_invalid'),
      coverage_exact: coverageExact,
      provided_campaign_ids: [...providedIds].sort(),
      required_campaign_ids: [...requiredIds].sort(),
      campaigns: items.map((item) => item.evidence),
    },
  };
}

function validateLifecycle(input, adapters) {
  const loaded = readLifecycleReceiptFile(input.lifecycle_receipt_path);
  if (loaded.status !== 'loaded') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence(loaded.status, loaded.reason),
    };
  }

  const receipt = loaded.receipt;
  if (receipt.schema_version !== 1
      || receipt.artifact_type !== 'lifecycle_residue_receipt'
      || typeof receipt.receipt_digest !== 'string') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence('invalid', 'lifecycle_receipt_shape_invalid'),
    };
  }

  if (typeof receipt.root_run_id === 'string'
      && receipt.root_run_id !== input.root_run_id) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_root_run_id_mismatch'),
        receipt_digest: receipt.receipt_digest,
      },
    };
  }

  const inspect = safeCall(
    adapters.inspectLifecycleReceipt,
    [{
      repo: input.repo,
      rootRunId: input.root_run_id,
      receipt: input.lifecycle_receipt_path,
    }],
    'inspectLifecycleReceipt',
  );

  if (!inspect.ok) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', inspect.error),
        receipt_digest: receipt.receipt_digest,
      },
    };
  }

  const result = inspect.value;
  if (!isPlainObject(result) || typeof result.status !== 'string') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_inspect_shape_invalid'),
        receipt_digest: receipt.receipt_digest,
      },
    };
  }

  if (result.status !== 'valid') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        status: result.status === 'stale' ? 'stale' : 'invalid',
        reason: result.status === 'stale'
          ? 'lifecycle_receipt_stale'
          : 'lifecycle_receipt_not_valid',
        receipt_digest: receipt.receipt_digest,
        inspect_status: result.status,
        zero_residue: null,
        owned_worktrees: null,
        owned_branches: null,
        active_owned_branches: null,
      },
    };
  }

  if (result.receipt_digest !== receipt.receipt_digest) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_receipt_digest_mismatch'),
        receipt_digest: receipt.receipt_digest,
        inspect_status: result.status,
      },
    };
  }

  if (typeof result.zero_residue !== 'boolean'
      || !Array.isArray(receipt.owned_worktrees)
      || !Array.isArray(receipt.branches)) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_residue_fields_invalid'),
        receipt_digest: receipt.receipt_digest,
        inspect_status: result.status,
      },
    };
  }

  const activeOwnedBranches = receipt.branches.filter(
    (branch) => branch && branch.disposition !== 'reaped',
  ).length;

  return {
    zero_residue: result.zero_residue,
    active_owned_worktrees: receipt.owned_worktrees.length,
    active_owned_branches: activeOwnedBranches,
    evidence: {
      status: 'valid',
      reason: null,
      receipt_digest: receipt.receipt_digest,
      inspect_status: result.status,
      zero_residue: result.zero_residue,
      owned_worktrees: receipt.owned_worktrees.length,
      owned_branches: receipt.branches.length,
      active_owned_branches: activeOwnedBranches,
    },
  };
}

function resolveCandidateTree(adapters, candidate) {
  if (!candidate || !isGitOid(candidate.commit) || !isGitOid(candidate.tree_sha)) {
    return { ok: false, reason: 'candidate_identity_missing' };
  }
  const tree = safeCall(adapters.treeForCommit, [candidate.commit], 'treeForCommit');
  if (!tree.ok) {
    return { ok: false, reason: tree.error };
  }
  if (tree.value !== candidate.tree_sha) {
    return { ok: false, reason: 'candidate_commit_tree_mismatch' };
  }
  return { ok: true, commit: candidate.commit, tree_sha: candidate.tree_sha };
}

function collectCandidate(campaignResult, adapters) {
  const validCandidates = campaignResult.items
    .filter((item) => item.valid && item.candidate)
    .map((item) => item.candidate);

  if (validCandidates.length === 0) {
    return { ok: false, reason: 'no_valid_candidate' };
  }

  const first = validCandidates[0];
  for (const candidate of validCandidates) {
    if (candidate.commit !== first.commit || candidate.tree_sha !== first.tree_sha) {
      return { ok: false, reason: 'candidate_conflict' };
    }
  }

  return resolveCandidateTree(adapters, first);
}

function containsCandidate(adapters, candidateCommit, refSha) {
  if (!refSha || !candidateCommit) return null;
  if (refSha === candidateCommit) return true;
  const anc = safeCall(
    adapters.isAncestor,
    [candidateCommit, refSha],
    'isAncestor',
  );
  if (!anc.ok) return null;
  return anc.value === true;
}

function computeIntegration(integration, adapters, candidateResult) {
  const targetRef = integration.target_ref;
  const consumerRef = integration.consumer_ref;
  const remoteRef = integration.remote_ref;
  const pushRequired = integration.push_required === true;
  const requiredConsumerUpdate = integration.required_consumer_update === true;

  const targetResolved = typeof targetRef === 'string' && targetRef.length > 0
    ? safeCall(adapters.resolveRef, [targetRef], 'resolveRef')
    : { ok: false, error: 'target_ref_missing' };
  const targetSha = targetResolved.ok && isGitOid(targetResolved.value)
    ? targetResolved.value
    : null;

  const integrationTarget = {
    ref: typeof targetRef === 'string' ? targetRef : null,
    observed_sha: targetSha,
  };

  if (!candidateResult.ok) {
    return {
      product_merged: null,
      consumer_updated: null,
      pushed: null,
      integration_target: integrationTarget,
      evidence: {
        ...emptyIntegrationEvidence('unknown', candidateResult.reason, integration),
        target_sha: targetSha,
      },
    };
  }

  const candidateCommit = candidateResult.commit;
  const productMerged = targetSha
    ? containsCandidate(adapters, candidateCommit, targetSha)
    : null;

  // Absent authoritative refs stay null (unknown) — never invent policy success.
  let consumerSha = null;
  let consumerUpdated = null;
  if (typeof consumerRef === 'string' && consumerRef.length > 0) {
    const resolved = safeCall(adapters.resolveRef, [consumerRef], 'resolveRef');
    consumerSha = resolved.ok && isGitOid(resolved.value) ? resolved.value : null;
    consumerUpdated = consumerSha
      ? containsCandidate(adapters, candidateCommit, consumerSha)
      : null;
  }

  let remoteSha = null;
  let pushed = null;
  if (typeof remoteRef === 'string' && remoteRef.length > 0) {
    const resolved = safeCall(adapters.resolveRef, [remoteRef], 'resolveRef');
    remoteSha = resolved.ok && isGitOid(resolved.value) ? resolved.value : null;
    pushed = remoteSha
      ? containsCandidate(adapters, candidateCommit, remoteSha)
      : null;
  }

  // Integration evidence is unknown only when a required fact lacks authority.
  const requiredUnknown = productMerged === null
    || (requiredConsumerUpdate && consumerUpdated === null)
    || (pushRequired && pushed === null);

  return {
    product_merged: productMerged,
    consumer_updated: consumerUpdated,
    pushed,
    integration_target: integrationTarget,
    evidence: {
      status: requiredUnknown ? 'unknown' : 'valid',
      reason: requiredUnknown ? 'integration_evidence_incomplete' : null,
      target_ref: integrationTarget.ref,
      target_sha: targetSha,
      consumer_ref: typeof consumerRef === 'string' ? consumerRef : null,
      consumer_sha: consumerSha,
      remote_ref: typeof remoteRef === 'string' ? remoteRef : null,
      remote_sha: remoteSha,
      push_required: pushRequired,
      required_consumer_update: requiredConsumerUpdate,
      candidate_commit: candidateCommit,
    },
  };
}

function computeAcceptance(missionResult, campaignResult) {
  const blockers = [];
  let deferredCount = 0;

  if (missionResult.valid) blockers.push(...missionResult.blockers);
  for (const item of campaignResult.items) {
    blockers.push(...item.blockers);
    deferredCount += item.deferred_count;
  }

  if (!missionResult.valid || !campaignResult.all_valid) {
    return {
      acceptance_verdict: 'unknown',
      accepted_blockers: blockers,
      deferred_count: deferredCount,
    };
  }

  if (blockers.length > 0 || !campaignResult.all_accepted || !missionResult.complete) {
    return {
      acceptance_verdict: 'rejected',
      accepted_blockers: blockers,
      deferred_count: deferredCount,
    };
  }

  return {
    acceptance_verdict: 'accepted',
    accepted_blockers: blockers,
    deferred_count: deferredCount,
  };
}

function pushFailed(failed, code) {
  if (!failed.includes(code)) failed.push(code);
}

function computePredicates({
  missionResult,
  campaignResult,
  acceptance,
  lifecycle,
  integration,
  integrationInput,
  mergePreflight,
}) {
  const failed = [];

  // can_merge: P1 has no sealed merge preflight.
  if (mergePreflight === null) {
    pushFailed(failed, 'merge_preflight_unknown');
  } else {
    pushFailed(failed, 'merge_preflight_unsupported_in_p1');
  }

  // can_close operands — every false/unknown listed; never short-circuit omit.
  if (!missionResult.valid || missionResult.mission_terminal !== true) {
    pushFailed(failed, 'mission_terminal_unknown');
  } else if (!missionResult.complete) {
    pushFailed(failed, 'mission_not_complete');
  }

  if (campaignResult.campaigns_terminal !== true) {
    pushFailed(
      failed,
      campaignResult.campaigns_terminal === null
        ? 'campaigns_terminal_unknown'
        : 'campaigns_not_terminal',
    );
  }

  if (acceptance.acceptance_verdict !== 'accepted') {
    pushFailed(
      failed,
      acceptance.acceptance_verdict === 'unknown'
        ? 'acceptance_unknown'
        : 'acceptance_not_accepted',
    );
  }

  if (!Array.isArray(acceptance.accepted_blockers)
      || acceptance.accepted_blockers.length > 0) {
    pushFailed(failed, 'accepted_blockers_present');
  }

  if (integration.product_merged !== true) {
    pushFailed(
      failed,
      integration.product_merged === null
        ? 'product_merged_unknown'
        : 'product_merged_false',
    );
  }

  if (integrationInput.required_consumer_update === true) {
    if (integration.consumer_updated !== true) {
      pushFailed(
        failed,
        integration.consumer_updated === null
          ? 'consumer_updated_unknown'
          : 'consumer_updated_false',
      );
    }
  }

  if (integrationInput.push_required === true) {
    if (integration.pushed !== true) {
      pushFailed(
        failed,
        integration.pushed === null
          ? 'pushed_unknown'
          : 'pushed_false',
      );
    }
  }

  if (lifecycle.zero_residue !== true) {
    pushFailed(
      failed,
      lifecycle.zero_residue === null
        ? 'zero_residue_unknown'
        : 'zero_residue_false',
    );
  }

  if (mergePreflight === null) {
    pushFailed(failed, 'merge_edges_unknown');
  }

  return {
    can_merge: false,
    // P1 cannot satisfy merge_preflight / merge_edges, so can_close is always
    // false when merge_preflight is null. Still emit the full failed list.
    can_close: failed.length === 0,
    failed_predicates: failed,
  };
}

function buildTaskStatus(input, adapters) {
  if (!isPlainObject(input)) {
    throw new TaskStatusError('input must be a plain object', 'TASK_STATUS_SHAPE');
  }
  assertExactKeys(input, INPUT_KEY_SET, 'input');

  if (!isPlainObject(adapters)) {
    throw new TaskStatusError('adapters must be a plain object', 'TASK_STATUS_SHAPE');
  }
  assertExactKeys(adapters, ADAPTER_KEY_SET, 'adapters');
  for (const key of ADAPTER_KEYS) {
    if (typeof adapters[key] !== 'function') {
      throw new TaskStatusError(
        `adapters.${key} must be a function`,
        'TASK_STATUS_ADAPTER_TYPE',
      );
    }
  }

  if (typeof input.repo !== 'string' || input.repo.length === 0) {
    throw new TaskStatusError('input.repo must be a non-empty string', 'TASK_STATUS_SHAPE');
  }
  if (typeof input.root_run_id !== 'string' || input.root_run_id.length === 0) {
    throw new TaskStatusError(
      'input.root_run_id must be a non-empty string',
      'TASK_STATUS_SHAPE',
    );
  }
  if (typeof input.observed_at !== 'string' || !Number.isFinite(Date.parse(input.observed_at))) {
    throw new TaskStatusError(
      'input.observed_at must be an ISO-8601 timestamp',
      'TASK_STATUS_SHAPE',
    );
  }
  if (typeof input.goal !== 'string') {
    throw new TaskStatusError('input.goal must be a string', 'TASK_STATUS_SHAPE');
  }
  if (typeof input.phase !== 'string') {
    throw new TaskStatusError('input.phase must be a string', 'TASK_STATUS_SHAPE');
  }

  assertExactKeys(input.integration, INTEGRATION_KEY_SET, 'integration');
  if (typeof input.integration.push_required !== 'boolean'
      || typeof input.integration.required_consumer_update !== 'boolean') {
    throw new TaskStatusError(
      'integration push_required/required_consumer_update must be boolean',
      'TASK_STATUS_SHAPE',
    );
  }
  for (const refKey of ['target_ref', 'consumer_ref', 'remote_ref']) {
    const value = input.integration[refKey];
    if (value !== null && typeof value !== 'string') {
      throw new TaskStatusError(
        `integration.${refKey} must be a string or null`,
        'TASK_STATUS_SHAPE',
      );
    }
  }

  if (input.merge_preflight !== null) {
    throw new TaskStatusError(
      'merge_preflight must be null in LSM P1',
      'TASK_STATUS_SHAPE',
    );
  }

  if (input.lifecycle_receipt_path !== null
      && typeof input.lifecycle_receipt_path !== 'string') {
    throw new TaskStatusError(
      'lifecycle_receipt_path must be a string or null',
      'TASK_STATUS_SHAPE',
    );
  }

  const missionResult = validateMissionBundle(input.mission, input.root_run_id);
  const campaignResult = validateCampaigns(input.campaigns, missionResult);
  const lifecycle = validateLifecycle(input, adapters);
  const candidateResult = collectCandidate(campaignResult, adapters);
  const integration = computeIntegration(input.integration, adapters, candidateResult);
  const acceptance = computeAcceptance(missionResult, campaignResult);
  const predicates = computePredicates({
    missionResult,
    campaignResult,
    acceptance,
    lifecycle,
    integration,
    integrationInput: input.integration,
    mergePreflight: input.merge_preflight,
  });

  let repoIdentity = 'unknown';
  if (missionResult.valid) {
    repoIdentity = missionResult.repo_identity;
  } else if (isPlainObject(input.mission)
      && isPlainObject(input.mission.state)
      && typeof input.mission.state.repo_identity === 'string'
      && input.mission.state.repo_identity.length > 0) {
    repoIdentity = input.mission.state.repo_identity;
  }

  const body = {
    schema_version: SCHEMA_VERSION,
    artifact_type: ARTIFACT_TYPE,
    issued_at: input.observed_at,
    repo_identity: repoIdentity,
    root_run_id: input.root_run_id,
    goal: input.goal,
    phase: input.phase,
    candidate_commit: candidateResult.ok ? candidateResult.commit : null,
    candidate_tree_sha: candidateResult.ok ? candidateResult.tree_sha : null,
    acceptance_verdict: acceptance.acceptance_verdict,
    accepted_blockers: acceptance.accepted_blockers.map((blocker) => ({
      kind: String(blocker.kind),
      subject: String(blocker.subject),
      reason: String(blocker.reason),
    })),
    deferred_count: acceptance.deferred_count,
    active_owned_worktrees: lifecycle.active_owned_worktrees,
    active_owned_branches: lifecycle.active_owned_branches,
    integration_target: {
      ref: integration.integration_target.ref,
      observed_sha: integration.integration_target.observed_sha,
    },
    product_merged: integration.product_merged,
    consumer_updated: integration.consumer_updated,
    pushed: integration.pushed,
    zero_residue: lifecycle.zero_residue,
    mission_terminal: missionResult.mission_terminal,
    campaigns_terminal: campaignResult.campaigns_terminal,
    evidence: {
      mission: missionResult.evidence,
      campaigns: campaignResult.evidence,
      lifecycle: lifecycle.evidence,
      integration: integration.evidence,
      merge_preflight: {
        status: 'unknown',
        reason: 'merge_preflight_unknown',
      },
    },
    can_merge: predicates.can_merge,
    can_close: predicates.can_close,
    failed_predicates: predicates.failed_predicates,
  };

  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

module.exports = {
  TaskStatusError,
  buildTaskStatus,
  SCHEMA_VERSION,
  ARTIFACT_TYPE,
};
