'use strict';

// Pure LSM P1 task-status aggregation.
// Read-only: consumes real Mission / ICC / WLB evidence + injected adapters.
// Sole owner of task-level can_merge / can_close predicates. Never mutates
// refs, worktrees, or finish markers. Never trusts schema-only terminal flags
// or invented fixture digests.

const {
  validateMissionState,
  stateHash,
  sha256,
  TERMINAL_STATES: MISSION_TERMINAL_STATES,
  MissionReducerError,
} = require('../mission/interface');
const {
  CAMPAIGN_STATES,
  campaignIdFor,
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
  'resolveRepoIdentity',
  'inspectLifecycleReceipt',
  'resolveCampaignBinding',
  'resolveRef',
  'isAncestor',
  'treeForCommit',
]);
const ADAPTER_KEY_SET = new Set(ADAPTER_KEYS);

const MISSION_INPUT_KEYS = Object.freeze(['state', 'terminal_receipt']);
const MISSION_INPUT_KEY_SET = new Set(MISSION_INPUT_KEYS);
const MISSION_TERMINAL_RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'mission_terminal',
  'state_digest',
  'terminal_digest',
  'residue',
  'residue_digest',
  'receipt_digest',
]);

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

const TERMINAL_RECEIPT_STATUS = new Set(['ready', 'follow_up']);
const CAMPAIGN_PROFILES = new Set(['spike', 'poc', 'internal-pilot', 'production']);

const CAMPAIGN_STATE_KEYS = Object.freeze([
  'schema_version',
  'campaign_id',
  'contract_digest',
  'repo_identity',
  'ticket',
  'profile',
  'phase',
  'generation',
  'limits',
  'usage',
  'started_at',
  'last_event_at',
  'live_lease',
  'idempotency_records',
  'event_count',
  'last_input_artifact_digest',
  'last_output_artifact_digest',
  'terminal_reason',
]);

const CAMPAIGN_LIMIT_KEYS = Object.freeze([
  'max_repair_generations',
  'max_wall_seconds',
  'max_changed_files',
  'baseline_churn',
  'max_churn',
]);

const CAMPAIGN_USAGE_KEYS = Object.freeze([
  'repair_generations',
  'elapsed_wall_seconds',
  'changed_files',
  'churn',
]);

const CAMPAIGN_IDEMPOTENCY_KEYS = Object.freeze(['key', 'event_digest']);

const PHASE_RECEIPT_STATUS = new Map([
  [CAMPAIGN_STATES.TERMINAL_READY, 'ready'],
  [CAMPAIGN_STATES.TERMINAL_FOLLOW_UP, 'follow_up'],
]);

const TERMINAL_RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'status',
  'candidate_tree_sha',
  'verification_receipt_digest',
  'repair_generations',
  'final_panel_count',
  'follow_up',
  'rejected_findings',
  'unresolved_final_findings',
  'trace',
  'receipt_digest',
]);

const VERIFICATION_RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'campaign_id',
  'tree_sha',
  'argv_hash',
  'env_fingerprint',
  'request_digest',
  'verdict',
  'exit_status',
  'writer_lease_closed',
  'detached_checkout',
  'runner_argv_attested',
  'writer_fence_digest',
  'checkout_attestation_digest',
  'stdout_digest',
  'stderr_digest',
  'started_at',
  'ended_at',
  'receipt_digest',
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

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function hasExactKeySet(value, keys) {
  if (!isPlainObject(value)) return false;
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size) return false;
  for (const key of actual) {
    if (!expected.has(key)) return false;
  }
  return true;
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
    state: null,
    evidence: emptyMissionEvidence('invalid', reason),
  };
}

function resolveRepoIdentityValue(adapters, repo) {
  const resolved = safeCall(adapters.resolveRepoIdentity, [repo], 'resolveRepoIdentity');
  if (!resolved.ok) return { ok: false, reason: resolved.error };
  if (typeof resolved.value !== 'string' || resolved.value.length === 0) {
    return { ok: false, reason: 'repo_identity_adapter_malformed' };
  }
  return { ok: true, value: resolved.value };
}

function validateMissionBundle(mission, rootRunId, expectedRepoIdentity) {
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
  if (!expectedRepoIdentity || state.repo_identity !== expectedRepoIdentity) {
    return missionInvalid('mission_repo_identity_mismatch');
  }
  if (!MISSION_TERMINAL_STATES.has(state.state) || !isPlainObject(state.terminal)) {
    return missionInvalid('mission_not_terminal');
  }
  if (!hasExactKeySet(terminalReceipt, MISSION_TERMINAL_RECEIPT_KEYS)) {
    return missionInvalid('mission_terminal_receipt_missing');
  }

  // Actual buildMissionTerminalReceipt shape — no fixture state/root/repo fields.
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

  if (!isPlainObject(terminalReceipt.residue)
      || typeof terminalReceipt.residue_digest !== 'string'
      || !isSha256(terminalReceipt.residue_digest)
      || terminalReceipt.residue.residue_digest !== terminalReceipt.residue_digest) {
    return missionInvalid('mission_residue_invalid');
  }
  const residueContent = Object.fromEntries(
    Object.entries(terminalReceipt.residue).filter(([key]) => key !== 'residue_digest'),
  );
  if (sha256(residueContent) !== terminalReceipt.residue_digest) {
    return missionInvalid('mission_residue_digest_mismatch');
  }

  const expectedReceiptDigest = missionReceiptBodyDigest(terminalReceipt);
  if (!expectedReceiptDigest || terminalReceipt.receipt_digest !== expectedReceiptDigest) {
    return missionInvalid('mission_receipt_digest_mismatch');
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
    state,
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
    binding: null,
    blockers: [],
    deferred_count: 0,
    evidence: emptyCampaignItemEvidence('invalid', reason, campaignId),
  };
}

function validateVerificationReceipt(verificationReceipt, campaignId) {
  if (!hasExactKeySet(verificationReceipt, VERIFICATION_RECEIPT_KEYS)) {
    return { ok: false, reason: 'campaign_verification_shape_invalid' };
  }
  if (verificationReceipt.schema_version !== 1
      || verificationReceipt.artifact_type !== 'implementation_campaign_verification'
      || verificationReceipt.campaign_id !== campaignId
      || !isGitOid(verificationReceipt.tree_sha)
      || !isSha256(verificationReceipt.argv_hash)
      || !isSha256(verificationReceipt.env_fingerprint)
      || !isSha256(verificationReceipt.request_digest)
      || verificationReceipt.verdict !== 'GREEN'
      || verificationReceipt.exit_status !== 0
      || verificationReceipt.writer_lease_closed !== true
      || verificationReceipt.detached_checkout !== true
      || verificationReceipt.runner_argv_attested !== true
      || !isSha256(verificationReceipt.writer_fence_digest)
      || !isSha256(verificationReceipt.checkout_attestation_digest)
      || !isSha256(verificationReceipt.stdout_digest)
      || !isSha256(verificationReceipt.stderr_digest)
      || typeof verificationReceipt.started_at !== 'string'
      || typeof verificationReceipt.ended_at !== 'string'
      || !Number.isFinite(Date.parse(verificationReceipt.started_at))
      || !Number.isFinite(Date.parse(verificationReceipt.ended_at))) {
    return { ok: false, reason: 'campaign_verification_not_green' };
  }
  const expectedDigest = campaignReceiptBodyDigest(verificationReceipt);
  if (!expectedDigest || verificationReceipt.receipt_digest !== expectedDigest) {
    return { ok: false, reason: 'campaign_verification_digest_mismatch' };
  }
  return { ok: true };
}

function validateTerminalReceipt(terminalReceipt) {
  if (!hasExactKeySet(terminalReceipt, TERMINAL_RECEIPT_KEYS)) {
    return { ok: false, reason: 'campaign_terminal_receipt_invalid' };
  }
  if (terminalReceipt.schema_version !== 1
      || terminalReceipt.artifact_type !== 'implementation_campaign_terminal'
      || !TERMINAL_RECEIPT_STATUS.has(terminalReceipt.status)
      || !isGitOid(terminalReceipt.candidate_tree_sha)
      || !isSha256(terminalReceipt.verification_receipt_digest)
      || !Number.isSafeInteger(terminalReceipt.repair_generations)
      || terminalReceipt.repair_generations < 0
      || terminalReceipt.final_panel_count !== 1
      || !Array.isArray(terminalReceipt.follow_up)
      || !Array.isArray(terminalReceipt.rejected_findings)
      || !Array.isArray(terminalReceipt.unresolved_final_findings)
      || !Array.isArray(terminalReceipt.trace)
      || !terminalReceipt.trace.every((item) => typeof item === 'string' && item.length > 0)) {
    return { ok: false, reason: 'campaign_terminal_receipt_invalid' };
  }
  const expectedDigest = campaignReceiptBodyDigest(terminalReceipt);
  if (!expectedDigest || terminalReceipt.receipt_digest !== expectedDigest) {
    return { ok: false, reason: 'campaign_terminal_digest_mismatch' };
  }
  return { ok: true };
}

function validateDurableCampaignState(state) {
  if (!hasExactKeySet(state, CAMPAIGN_STATE_KEYS)
      || state.schema_version !== 1
      || !/^campaign-v1-[0-9a-f]{64}$/.test(state.campaign_id)
      || !isSha256(state.contract_digest)
      || typeof state.repo_identity !== 'string'
      || state.repo_identity.length === 0
      || typeof state.ticket !== 'string'
      || !/^[A-Za-z0-9._-]{1,128}$/.test(state.ticket)
      || !CAMPAIGN_PROFILES.has(state.profile)
      || !CAMPAIGN_TERMINAL_PHASES.has(state.phase)
      || !Number.isSafeInteger(state.generation)
      || state.generation < 0
      || !hasExactKeySet(state.limits, CAMPAIGN_LIMIT_KEYS)
      || Object.values(state.limits).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
      || !hasExactKeySet(state.usage, CAMPAIGN_USAGE_KEYS)
      || Object.values(state.usage).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
      || !isCanonicalTimestamp(state.started_at)
      || !isCanonicalTimestamp(state.last_event_at)
      || Date.parse(state.last_event_at) < Date.parse(state.started_at)
      || state.live_lease !== null
      || !Array.isArray(state.idempotency_records)
      || !state.idempotency_records.every((record) => (
        hasExactKeySet(record, CAMPAIGN_IDEMPOTENCY_KEYS)
        && typeof record.key === 'string'
        && /^[A-Za-z0-9._:-]{1,256}$/.test(record.key)
        && isSha256(record.event_digest)
      ))
      || new Set(state.idempotency_records.map((record) => record.key)).size
        !== state.idempotency_records.length
      || !Number.isSafeInteger(state.event_count)
      || state.event_count < 1
      || state.event_count !== state.idempotency_records.length
      || !isSha256(state.last_input_artifact_digest)
      || !isSha256(state.last_output_artifact_digest)
      || typeof state.terminal_reason !== 'string'
      || state.terminal_reason.trim().length === 0) {
    return { ok: false, reason: 'campaign_state_invalid' };
  }

  if (state.campaign_id !== campaignIdFor(
    state.repo_identity,
    state.ticket,
    state.contract_digest,
  )) {
    return { ok: false, reason: 'campaign_state_identity_invalid' };
  }

  return { ok: true };
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

  const stateOk = validateDurableCampaignState(state);
  if (!stateOk.ok) {
    return campaignInvalid(null, 'campaign_state_identity_invalid');
  }
  const campaignId = state.campaign_id;

  if (typeof state.repo_identity !== 'string'
      || state.repo_identity.length === 0
      || !expectedRepoIdentity
      || state.repo_identity !== expectedRepoIdentity) {
    return campaignInvalid(campaignId, 'campaign_repo_identity_mismatch');
  }

  const terminalOk = validateTerminalReceipt(terminalReceipt);
  if (!terminalOk.ok) {
    return campaignInvalid(campaignId, terminalOk.reason);
  }

  const verificationOk = validateVerificationReceipt(verificationReceipt, campaignId);
  if (!verificationOk.ok) {
    return campaignInvalid(campaignId, verificationOk.reason);
  }

  if (terminalReceipt.verification_receipt_digest !== verificationReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_verification_binding_mismatch');
  }
  if (state.last_output_artifact_digest !== terminalReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_terminal_state_binding_mismatch');
  }
  if (PHASE_RECEIPT_STATUS.get(state.phase) !== terminalReceipt.status) {
    return campaignInvalid(campaignId, 'campaign_terminal_status_mismatch');
  }
  if (terminalReceipt.candidate_tree_sha !== verificationReceipt.tree_sha) {
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

  const unresolved = terminalReceipt.unresolved_final_findings;
  const followUp = terminalReceipt.follow_up;

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

  const accepted = ACCEPTANCE_PHASES.has(state.phase) && blockers.length === 0;

  return {
    valid: true,
    accepted,
    terminal: true,
    campaign_id: campaignId,
    candidate: normalizedCandidate,
    state,
    binding: null,
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

function nonreleasedClaims(claims) {
  const out = [];
  if (!claims || typeof claims !== 'object') return out;
  for (const claim of Object.values(claims)) {
    if (!claim || typeof claim !== 'object') continue;
    if (claim.released === true) continue;
    if (typeof claim.claim_id !== 'string' || claim.claim_id.length === 0) continue;
    if (typeof claim.campaign_id !== 'string' || claim.campaign_id.length === 0) continue;
    if (typeof claim.binding_digest !== 'string' || !isSha256(claim.binding_digest)) continue;
    out.push(claim);
  }
  return out;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function bindCampaignEntry(item, missionResult, adapters) {
  if (!item.valid) return item;
  if (!missionResult.valid || !missionResult.state) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'mission_invalid_skips_binding',
      },
    };
  }

  const bindingCall = safeCall(
    adapters.resolveCampaignBinding,
    [{
      missionState: missionResult.state,
      campaignState: item.state,
      candidate: item.candidate,
    }],
    'resolveCampaignBinding',
  );

  if (!bindingCall.ok) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: bindingCall.error,
      },
    };
  }

  const binding = bindingCall.value;
  if (!isPlainObject(binding) || typeof binding.status !== 'string') {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_binding_malformed',
      },
    };
  }

  if (binding.status !== 'valid') {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: binding.status === 'unknown' ? 'unknown' : 'invalid',
        reason: 'campaign_binding_not_valid',
      },
    };
  }

  if (typeof binding.claim_id !== 'string' || binding.claim_id.length === 0
      || typeof binding.mission_campaign_id !== 'string' || binding.mission_campaign_id.length === 0
      || typeof binding.icc_campaign_id !== 'string' || binding.icc_campaign_id.length === 0
      || typeof binding.binding_digest !== 'string' || !isSha256(binding.binding_digest)) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_binding_fields_invalid',
      },
    };
  }

  if (binding.icc_campaign_id !== item.campaign_id) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_binding_icc_mismatch',
      },
    };
  }

  const claims = nonreleasedClaims(missionResult.claims);
  const matched = claims.find((claim) => (
    claim.claim_id === binding.claim_id
    && claim.campaign_id === binding.mission_campaign_id
    && claim.binding_digest === binding.binding_digest
  ));
  if (!matched) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_binding_claim_unmapped',
      },
    };
  }

  return {
    ...item,
    binding: {
      claim_id: binding.claim_id,
      mission_campaign_id: binding.mission_campaign_id,
      icc_campaign_id: binding.icc_campaign_id,
      binding_digest: binding.binding_digest,
    },
  };
}

function validateCampaigns(campaigns, missionResult, adapters) {
  if (!Array.isArray(campaigns)) {
    throw new TaskStatusError('campaigns must be an array', 'TASK_STATUS_SHAPE');
  }

  const expectedRepoIdentity = missionResult.valid ? missionResult.repo_identity : null;
  let items = campaigns.map((entry, index) => (
    validateCampaignEntry(entry, index, expectedRepoIdentity)
  ));

  items = items.map((item) => bindCampaignEntry(item, missionResult, adapters));

  const providedIccIds = new Set();
  const providedMissionIds = new Set();
  const providedClaimIds = new Set();
  let hasDuplicate = false;
  let hasUnmapped = false;

  for (const item of items) {
    if (!item.valid || !item.binding) {
      hasUnmapped = true;
      continue;
    }
    if (providedIccIds.has(item.binding.icc_campaign_id)
        || providedMissionIds.has(item.binding.mission_campaign_id)
        || providedClaimIds.has(item.binding.claim_id)) {
      hasDuplicate = true;
    }
    providedIccIds.add(item.binding.icc_campaign_id);
    providedMissionIds.add(item.binding.mission_campaign_id);
    providedClaimIds.add(item.binding.claim_id);
  }

  const requiredClaims = missionResult.valid
    ? nonreleasedClaims(missionResult.claims)
    : [];
  const requiredMissionIds = new Set(requiredClaims.map((claim) => claim.campaign_id));
  const requiredClaimIds = new Set(requiredClaims.map((claim) => claim.claim_id));

  let coverageExact = false;
  let coverageReason = null;
  if (!missionResult.valid) {
    coverageReason = 'mission_invalid_skips_coverage';
  } else if (hasDuplicate) {
    coverageReason = 'duplicate_campaign_bindings';
  } else if (hasUnmapped || items.some((item) => !item.valid || !item.binding)) {
    coverageReason = 'campaign_binding_unmapped';
  } else if (!setsEqual(providedMissionIds, requiredMissionIds)
      || !setsEqual(providedClaimIds, requiredClaimIds)) {
    const missing = [...requiredMissionIds].some((id) => !providedMissionIds.has(id))
      || [...requiredClaimIds].some((id) => !providedClaimIds.has(id));
    coverageReason = missing ? 'campaign_coverage_missing' : 'campaign_coverage_extra';
  } else {
    coverageExact = true;
  }

  const allValid = items.every((item) => item.valid && item.binding);
  // Vacuous: zero campaigns with exact empty coverage is fully terminal.
  const allTerminal = items.every((item) => item.terminal === true);
  const allAccepted = items.every((item) => item.accepted === true);

  // Missing/duplicate/unmapped coverage => campaigns_terminal unknown (null).
  let campaignsTerminal = null;
  if (missionResult.valid && coverageExact && allValid) {
    campaignsTerminal = allTerminal;
  }

  return {
    items,
    coverageExact,
    coverageReason,
    campaigns_terminal: campaignsTerminal,
    all_accepted: coverageExact && allValid && allAccepted,
    all_valid: coverageExact && allValid,
    evidence: {
      status: coverageExact && allValid ? 'valid' : (missionResult.valid ? 'invalid' : 'unknown'),
      reason: coverageReason || (allValid ? null : 'campaign_entry_invalid'),
      coverage_exact: coverageExact,
      provided_campaign_ids: [...providedIccIds].sort(),
      required_campaign_ids: [...requiredMissionIds].sort(),
      campaigns: items.map((item) => item.evidence),
    },
  };
}

function validateLifecycle(input, adapters) {
  const pathValue = input.lifecycle_receipt_path;

  if (pathValue !== null && pathValue !== undefined && typeof pathValue !== 'string') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence('invalid', 'lifecycle_receipt_path_invalid'),
    };
  }

  // Canonical lifecycle inspector is the sole authority for residue counts.
  // Never read receipt files, never expect result.receipt, never invent zeros.
  if (pathValue === null || pathValue === undefined || pathValue.length === 0) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence('missing', 'lifecycle_receipt_missing'),
    };
  }

  const inspect = safeCall(
    adapters.inspectLifecycleReceipt,
    [{
      repo: input.repo,
      rootRunId: input.root_run_id,
      receipt: pathValue,
    }],
    'inspectLifecycleReceipt',
  );

  if (!inspect.ok) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence('invalid', inspect.error),
    };
  }

  const result = inspect.value;
  if (!isPlainObject(result) || typeof result.status !== 'string') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: emptyLifecycleEvidence('invalid', 'lifecycle_inspect_shape_invalid'),
    };
  }

  if (result.status === 'missing') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('missing', 'lifecycle_receipt_missing'),
        inspect_status: result.status,
      },
    };
  }

  if (result.status === 'stale') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('stale', 'lifecycle_receipt_stale'),
        inspect_status: result.status,
        receipt_digest: isSha256(result.receipt_digest) ? result.receipt_digest : null,
      },
    };
  }

  if (result.status !== 'valid') {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_receipt_not_valid'),
        inspect_status: result.status,
        receipt_digest: isSha256(result.receipt_digest) ? result.receipt_digest : null,
      },
    };
  }

  // Trust only returned inspector fields + matching digest. Missing counts => null.
  if (!hasExactKeySet(result, [
    'status',
    'zero_residue',
    'receipt_digest',
    'active_owned_worktrees',
    'active_owned_branches',
  ])
      || typeof result.zero_residue !== 'boolean'
      || !isSha256(result.receipt_digest)
      || !Number.isInteger(result.active_owned_worktrees)
      || result.active_owned_worktrees < 0
      || !Number.isInteger(result.active_owned_branches)
      || result.active_owned_branches < 0
      || result.zero_residue !== (
        result.active_owned_worktrees === 0 && result.active_owned_branches === 0
      )) {
    return {
      zero_residue: null,
      active_owned_worktrees: null,
      active_owned_branches: null,
      evidence: {
        ...emptyLifecycleEvidence('invalid', 'lifecycle_residue_fields_invalid'),
        inspect_status: result.status,
        receipt_digest: isSha256(result.receipt_digest) ? result.receipt_digest : null,
      },
    };
  }

  return {
    zero_residue: result.zero_residue,
    active_owned_worktrees: result.active_owned_worktrees,
    active_owned_branches: result.active_owned_branches,
    evidence: {
      status: 'valid',
      reason: null,
      receipt_digest: result.receipt_digest,
      inspect_status: result.status,
      zero_residue: result.zero_residue,
      owned_worktrees: result.active_owned_worktrees,
      owned_branches: result.active_owned_branches,
      active_owned_branches: result.active_owned_branches,
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
  if (anc.value === true) return true;
  if (anc.value === false) return false;
  return null;
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

  let consumerSha = null;
  let consumerUpdated = null;
  if (typeof consumerRef === 'string' && consumerRef.length > 0) {
    const resolved = safeCall(adapters.resolveRef, [consumerRef], 'resolveRef');
    consumerSha = resolved.ok && isGitOid(resolved.value) ? resolved.value : null;
    consumerUpdated = consumerSha && targetSha
      ? containsCandidate(adapters, targetSha, consumerSha)
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

  // merge_preflight:null means can_merge=false (required merge edges unknown).
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

  // can_merge is always false in P1 when merge_preflight is null.
  // can_close requires every closeout operand true; merge_edges_unknown keeps
  // it false under a null preflight.
  return {
    can_merge: false,
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

  // resolveRepoIdentity is the sole repo-identity authority — never path concat.
  const repoIdentityResult = resolveRepoIdentityValue(adapters, input.repo);
  const expectedRepoIdentity = repoIdentityResult.ok ? repoIdentityResult.value : null;

  const missionResult = repoIdentityResult.ok
    ? validateMissionBundle(input.mission, input.root_run_id, expectedRepoIdentity)
    : missionInvalid(repoIdentityResult.reason || 'repo_identity_unavailable');

  const campaignResult = validateCampaigns(input.campaigns, missionResult, adapters);
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
  } else if (expectedRepoIdentity) {
    repoIdentity = expectedRepoIdentity;
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
