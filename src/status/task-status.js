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
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  normalizeCampaignArtifactReference,
  replayCampaignEvents,
  CampaignStateError,
} = require('../engine/implementation-campaign');
const {
  validateFinalPanelReceipt,
} = require('../engine/campaign-composition');

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
  'merge_execution',
  'merge_provenance',
]);
const INPUT_KEY_SET = new Set(INPUT_KEYS);

const ADAPTER_KEYS = Object.freeze([
  'resolveRepoIdentity',
  'inspectLifecycleReceipt',
  'resolveCampaignBinding',
  'resolveRef',
  'isAncestor',
  'treeForCommit',
  'inspectMergeProvenance',
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
  'contract',
  'events',
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
const RECEIPT_STATUS_EVENT = new Map([
  ['ready', CAMPAIGN_EVENTS.TERMINAL_READY],
  ['follow_up', CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP],
]);

const TERMINAL_RECEIPT_KEYS = Object.freeze([
  'schema_version',
  'artifact_type',
  'status',
  'candidate_tree_sha',
  'verification_receipt_digest',
  'repair_generations',
  'sealed_min_panel_size',
  'final_panel_count',
  'final_panel_seat_receipts',
  'follow_up',
  'rejected_findings',
  'unresolved_final_findings',
  'lifecycle_receipt_ref',
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
      || !isCanonicalTimestamp(verificationReceipt.started_at)
      || !isCanonicalTimestamp(verificationReceipt.ended_at)
      || Date.parse(verificationReceipt.ended_at)
        < Date.parse(verificationReceipt.started_at)) {
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
      || !Number.isSafeInteger(terminalReceipt.sealed_min_panel_size)
      || terminalReceipt.sealed_min_panel_size < 1
      || !Number.isSafeInteger(terminalReceipt.final_panel_count)
      || !Array.isArray(terminalReceipt.final_panel_seat_receipts)
      || !Array.isArray(terminalReceipt.follow_up)
      || !Array.isArray(terminalReceipt.rejected_findings)
      || !Array.isArray(terminalReceipt.unresolved_final_findings)
      || !(
        terminalReceipt.lifecycle_receipt_ref === 'unknown'
        || (
          isPlainObject(terminalReceipt.lifecycle_receipt_ref)
          && hasExactKeySet(
            terminalReceipt.lifecycle_receipt_ref,
            ['path', 'root_run_id', 'receipt_digest'],
          )
          && typeof terminalReceipt.lifecycle_receipt_ref.path === 'string'
          && terminalReceipt.lifecycle_receipt_ref.path.length > 0
          && typeof terminalReceipt.lifecycle_receipt_ref.root_run_id === 'string'
          && terminalReceipt.lifecycle_receipt_ref.root_run_id.length > 0
          && isSha256(terminalReceipt.lifecycle_receipt_ref.receipt_digest)
        )
      )
      || !Array.isArray(terminalReceipt.trace)
      || !terminalReceipt.trace.every((item) => typeof item === 'string' && item.length > 0)) {
    return { ok: false, reason: 'campaign_terminal_receipt_invalid' };
  }
  const finalPanel = validateFinalPanelReceipt({
    reviewed: true,
    sealed_min_panel_size: terminalReceipt.sealed_min_panel_size,
    final_panel_count: terminalReceipt.final_panel_count,
    final_panel_seat_receipts: terminalReceipt.final_panel_seat_receipts,
  }, terminalReceipt.sealed_min_panel_size);
  if (finalPanel.passed !== true) {
    return { ok: false, reason: `campaign_${finalPanel.reason}` };
  }
  const findingShapeValid = (item, classification) => {
    const baseKeys = [
      'id', 'claim', 'severity', 'source', 'evidence', 'adjudication_authority',
    ];
    if (!isPlainObject(item)
        || typeof item.id !== 'string' || item.id.length === 0
        || typeof item.claim !== 'string' || item.claim.length === 0
        || !new Set(['🔴', '🟠', '🟡', '🔵']).has(item.severity)
        || typeof item.source !== 'string' || item.source.length === 0
        || !hasExactKeySet(item.evidence, ['classification', 'digest'])
        || !new Set(['actionable', 'refuted']).has(item.evidence.classification)
        || !isSha256(item.evidence.digest)
        || !hasExactKeySet(
          item.adjudication_authority,
          ['authority', 'actor_id', 'review_digest'],
        )
        || !new Set(['depth-0', 'deterministic-policy'])
          .has(item.adjudication_authority.authority)
        || typeof item.adjudication_authority.actor_id !== 'string'
        || item.adjudication_authority.actor_id.length === 0
        || !isSha256(item.adjudication_authority.review_digest)) {
      return false;
    }
    if (classification === 'follow_up') {
      return hasExactKeySet(item, [...baseKeys, 'disposition'])
        && item.evidence.classification === 'actionable'
        && hasExactKeySet(item.disposition, [
        'disposition', 'context', 'trigger', 'proposed_backlog_title',
      ])
        && item.disposition.disposition === 'follow-up'
        && ['context', 'trigger', 'proposed_backlog_title'].every(
          (key) => typeof item.disposition[key] === 'string'
            && item.disposition[key].length > 0,
      );
    }
    if (classification === 'must_fix_now') {
      return hasExactKeySet(item, [...baseKeys, 'disposition'])
        && item.evidence.classification === 'actionable'
        && isPlainObject(item.disposition)
        && item.disposition.disposition === 'must-fix-now'
        && Object.keys(item.disposition).every((key) => (
          new Set([
            'disposition', 'acceptance_id', 'rubric_id', 'task_surface', 'deferral_harm',
          ]).has(key)
        ))
        && ['acceptance_id', 'deferral_harm'].every((key) => (
          typeof item.disposition[key] === 'string'
          && item.disposition[key].trim().length > 0
        ))
        && ['rubric_id', 'task_surface'].every((key) => (
          item.disposition[key] === undefined
          || (typeof item.disposition[key] === 'string'
            && item.disposition[key].trim().length > 0)
        ));
    }
    if (item.evidence.classification === 'refuted') {
      return hasExactKeySet(item, baseKeys);
    }
    return hasExactKeySet(item, [...baseKeys, 'disposition'])
      && isPlainObject(item.disposition)
      && item.disposition.disposition === 'reject-out-of-scope'
      && hasExactKeySet(item.disposition, ['disposition', 'rationale'])
      && typeof item.disposition.rationale === 'string'
      && item.disposition.rationale.trim().length > 0;
  };
  if (!terminalReceipt.follow_up.every((item) => findingShapeValid(item, 'follow_up'))
      || !terminalReceipt.unresolved_final_findings.every(
        (item) => findingShapeValid(item, 'must_fix_now'),
      )
      || !terminalReceipt.rejected_findings.every(
        (item) => findingShapeValid(item, 'rejected'),
      )) {
    return { ok: false, reason: 'campaign_terminal_findings_invalid' };
  }
  const retainedCount = terminalReceipt.follow_up.length
    + terminalReceipt.unresolved_final_findings.length;
  if ((terminalReceipt.status === 'ready' && retainedCount !== 0)
      || (terminalReceipt.status === 'follow_up' && retainedCount === 0)) {
    return { ok: false, reason: 'campaign_terminal_status_semantics_invalid' };
  }
  const expectedDigest = campaignReceiptBodyDigest(terminalReceipt);
  if (!expectedDigest || terminalReceipt.receipt_digest !== expectedDigest) {
    return { ok: false, reason: 'campaign_terminal_digest_mismatch' };
  }
  return { ok: true };
}

function validateTerminalEvent(events, terminalReceipt) {
  const terminalEvent = events[events.length - 1];
  const expectedType = RECEIPT_STATUS_EVENT.get(terminalReceipt.status);
  const payloadKeys = terminalReceipt.status === 'follow_up'
    ? [
      'registry_complete', 'registry_digest', 'convergence_digest',
      'follow_up_digest', 'lifecycle_receipt_ref', 'reason',
    ]
    : [
      'registry_complete', 'registry_digest', 'convergence_digest',
      'lifecycle_receipt_ref', 'reason',
    ];
  if (!isPlainObject(terminalEvent)
      || terminalEvent.event_type !== expectedType
      || terminalEvent.output_artifact_digest !== terminalReceipt.receipt_digest
      || !hasExactKeySet(terminalEvent.payload, payloadKeys)
      || terminalEvent.payload.registry_complete !== true
      || canonicalDigest(terminalEvent.payload.lifecycle_receipt_ref)
        !== canonicalDigest(terminalReceipt.lifecycle_receipt_ref)
      || !isSha256(terminalEvent.payload.registry_digest)
      || !isSha256(terminalEvent.payload.convergence_digest)
      || typeof terminalEvent.payload.reason !== 'string'
      || terminalEvent.payload.reason.trim().length === 0) {
    return { ok: false, reason: 'campaign_terminal_event_mismatch' };
  }
  if (terminalReceipt.status === 'follow_up'
      && terminalEvent.payload.follow_up_digest
        !== canonicalDigest({
          follow_up: terminalReceipt.follow_up,
          unresolved_final_findings: terminalReceipt.unresolved_final_findings,
        })) {
    return { ok: false, reason: 'campaign_terminal_follow_up_digest_mismatch' };
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

  const minimumTerminalEvents = 5 + (5 * state.generation);
  if (state.usage.repair_generations !== state.generation
      || state.generation > state.limits.max_repair_generations
      || state.usage.elapsed_wall_seconds > state.limits.max_wall_seconds
      || state.usage.changed_files > state.limits.max_changed_files
      || state.usage.churn > state.limits.max_churn
      || state.event_count < minimumTerminalEvents) {
    return { ok: false, reason: 'campaign_state_impossible' };
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
    contract,
    events,
    state,
    terminal_receipt: terminalReceipt,
    verification_receipt: verificationReceipt,
    candidate,
  } = entry;

  if (!isPlainObject(contract) || !Array.isArray(events)) {
    return campaignInvalid(null, 'campaign_replay_evidence_missing');
  }
  const stateOk = validateDurableCampaignState(state);
  if (!stateOk.ok) {
    return campaignInvalid(null, 'campaign_state_identity_invalid');
  }
  const campaignId = state.campaign_id;

  const contractDigest = canonicalDigest(contract);
  if (contractDigest !== state.contract_digest) {
    return campaignInvalid(campaignId, 'campaign_contract_digest_mismatch');
  }
  try {
    const initial = createCampaignState({
      contract,
      contractDigest,
      repoIdentity: state.repo_identity,
      startedAt: state.started_at,
    });
    const replayed = replayCampaignEvents(initial, events);
    if (canonicalDigest(replayed) !== canonicalDigest(state)) {
      return campaignInvalid(campaignId, 'campaign_state_replay_mismatch');
    }
  } catch (error) {
    if (error instanceof CampaignStateError || error instanceof TypeError) {
      return campaignInvalid(campaignId, 'campaign_state_replay_invalid');
    }
    throw error;
  }

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
  const terminalEventOk = validateTerminalEvent(events, terminalReceipt);
  if (!terminalEventOk.ok) {
    return campaignInvalid(campaignId, terminalEventOk.reason);
  }

  const verificationOk = validateVerificationReceipt(verificationReceipt, campaignId);
  if (!verificationOk.ok) {
    return campaignInvalid(campaignId, verificationOk.reason);
  }
  const verticalEvents = events.filter(
    (event) => event && event.event_type === CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
  );
  const terminalVerificationEvent = verticalEvents[verticalEvents.length - 1];
  if (!terminalVerificationEvent
      || terminalVerificationEvent.output_artifact_digest
        !== verificationReceipt.receipt_digest
      || !isPlainObject(terminalVerificationEvent.payload)
      || terminalVerificationEvent.payload.evidence_digest
        !== verificationReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_verification_ledger_mismatch');
  }

  if (terminalReceipt.verification_receipt_digest !== verificationReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_verification_binding_mismatch');
  }
  if (state.last_output_artifact_digest !== terminalReceipt.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_terminal_state_binding_mismatch');
  }
  if (terminalReceipt.repair_generations !== state.generation) {
    return campaignInvalid(campaignId, 'campaign_terminal_generation_mismatch');
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
  if (verificationReceipt.writer_fence_digest
      !== normalizedCandidate.writer_fence.receipt_digest) {
    return campaignInvalid(campaignId, 'campaign_writer_fence_digest_mismatch');
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
    acceptance_id: finding.disposition.acceptance_id,
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
  if (matched.campaign_contract_digest !== item.state.contract_digest
      || matched.base_sha !== item.candidate.base) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_binding_authority_mismatch',
      },
    };
  }
  const claimAcceptanceIds = Array.isArray(matched.acceptance_ids)
    ? new Set(matched.acceptance_ids)
    : new Set();
  if (item.blockers.some((blocker) => (
    blocker.kind === 'unresolved_final_finding'
    && !claimAcceptanceIds.has(blocker.acceptance_id)
  ))) {
    return {
      ...item,
      valid: false,
      accepted: false,
      terminal: false,
      binding: null,
      evidence: {
        ...item.evidence,
        status: 'invalid',
        reason: 'campaign_finding_acceptance_unbound',
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
      provided_campaign_ids: [...providedMissionIds].sort(),
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

function resolveCandidateTree(adapters, candidate, gitContext) {
  if (!candidate || !isGitOid(candidate.commit) || !isGitOid(candidate.tree_sha)) {
    return { ok: false, reason: 'candidate_identity_missing' };
  }
  const tree = safeCall(
    adapters.treeForCommit,
    [{ ...gitContext, commit: candidate.commit }],
    'treeForCommit',
  );
  if (!tree.ok) {
    return { ok: false, reason: tree.error };
  }
  if (tree.value !== candidate.tree_sha) {
    return { ok: false, reason: 'candidate_commit_tree_mismatch' };
  }
  return { ok: true, commit: candidate.commit, tree_sha: candidate.tree_sha, base: candidate.base };
}

function validateMergeProvenance(value, adapters, gitContext, candidate) {
  if (!isPlainObject(value)
      || !hasExactKeySet(value, ['root_run_id', 'work_order_id'])
      || typeof value.root_run_id !== 'string' || value.root_run_id.length === 0
      || typeof value.work_order_id !== 'string' || value.work_order_id.length === 0
      || !candidate.ok || !isGitOid(candidate.base) || !isGitOid(candidate.commit)) {
    return { ok: false, evidence: { status: 'invalid', reason: 'merge_provenance_shape_invalid' } };
  }
  const inspected = safeCall(adapters.inspectMergeProvenance, [{
    ...gitContext,
    rootRunId: value.root_run_id,
    workOrderId: value.work_order_id,
    baseSha: candidate.base,
    headSha: candidate.commit,
  }], 'inspectMergeProvenance');
  if (!inspected.ok || !isPlainObject(inspected.value) || inspected.value.ok !== true) {
    return { ok: false, evidence: { status: 'invalid', reason: inspected.error || 'merge_provenance_rejected' } };
  }
  return { ok: true, evidence: { status: 'valid', reason: null, provenance_source: inspected.value.provenance_source } };
}

function collectCandidate(campaignResult, adapters, gitContext) {
  if (!campaignResult.coverageExact || !campaignResult.all_valid) {
    return { ok: false, reason: 'campaign_coverage_incomplete' };
  }
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

  return resolveCandidateTree(adapters, first, gitContext);
}

function containsCandidate(adapters, candidateCommit, refSha, gitContext) {
  if (!refSha || !candidateCommit) return null;
  if (refSha === candidateCommit) return true;
  const anc = safeCall(
    adapters.isAncestor,
    [{ ...gitContext, ancestor: candidateCommit, descendant: refSha }],
    'isAncestor',
  );
  if (!anc.ok) return null;
  if (anc.value === true) return true;
  if (anc.value === false) return false;
  return null;
}

function computeIntegration(integration, adapters, candidateResult, gitContext) {
  const targetRef = integration.target_ref;
  const consumerRef = integration.consumer_ref;
  const remoteRef = integration.remote_ref;
  const pushRequired = integration.push_required === true;
  const requiredConsumerUpdate = integration.required_consumer_update === true;
  if (!gitContext
      || typeof gitContext.repo !== 'string'
      || gitContext.repo.length === 0
      || typeof gitContext.repo_identity !== 'string'
      || gitContext.repo_identity.length === 0) {
    return {
      product_merged: null,
      consumer_updated: null,
      pushed: null,
      integration_target: {
        ref: typeof targetRef === 'string' ? targetRef : null,
        observed_sha: null,
      },
      evidence: emptyIntegrationEvidence(
        'unknown',
        'repo_identity_unavailable',
        integration,
      ),
    };
  }

  const targetResolved = typeof targetRef === 'string' && targetRef.length > 0
    ? safeCall(adapters.resolveRef, [{ ...gitContext, ref: targetRef }], 'resolveRef')
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
    ? containsCandidate(adapters, candidateCommit, targetSha, gitContext)
    : null;

  let consumerSha = null;
  let consumerUpdated = null;
  if (typeof consumerRef === 'string' && consumerRef.length > 0) {
    const resolved = safeCall(
      adapters.resolveRef,
      [{ ...gitContext, ref: consumerRef }],
      'resolveRef',
    );
    consumerSha = resolved.ok && isGitOid(resolved.value) ? resolved.value : null;
    consumerUpdated = consumerSha && targetSha
      ? containsCandidate(adapters, targetSha, consumerSha, gitContext)
      : null;
  }

  let remoteSha = null;
  let pushed = null;
  if (typeof remoteRef === 'string' && remoteRef.length > 0) {
    const resolved = safeCall(
      adapters.resolveRef,
      [{ ...gitContext, ref: remoteRef }],
      'resolveRef',
    );
    remoteSha = resolved.ok && isGitOid(resolved.value) ? resolved.value : null;
    pushed = remoteSha && targetSha
      ? containsCandidate(adapters, targetSha, remoteSha, gitContext)
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
  if (campaignResult.all_valid) {
    for (const item of campaignResult.items) {
      blockers.push(...item.blockers);
      deferredCount += item.deferred_count;
    }
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

function validateMergePreflight(value) {
  if (value === null) {
    return {
      valid: false,
      safe: false,
      evidence: {
        status: 'unknown',
        reason: 'merge_preflight_unknown',
        manifest_seal: null,
        preflight_status: null,
      },
    };
  }
  const keys = [
    'schema_version',
    'artifact_type',
    'manifest_seal',
    'status',
    'can_merge',
    'edges',
    'blockers',
    'receipt_digest',
  ];
  const optionalKeys = ['proposed_preservation_paths', 'dirty_inventory'];
  const allowedKeys = new Set([...keys, ...optionalKeys]);
  if (!isPlainObject(value)
      || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
      || Object.keys(value).some((key) => !allowedKeys.has(key))
      || value.schema_version !== 1
      || value.artifact_type !== 'merge_intent_preflight'
      || !isSha256(value.manifest_seal)
      || !['safe', 'overlapping', 'ambiguous', 'blocked'].includes(value.status)
      || typeof value.can_merge !== 'boolean'
      || !Array.isArray(value.edges)
      || !Array.isArray(value.blockers)
      || !isSha256(value.receipt_digest)) {
    return {
      valid: false,
      safe: false,
      evidence: {
        status: 'invalid',
        reason: 'merge_preflight_shape_invalid',
        manifest_seal: null,
        preflight_status: null,
      },
    };
  }
  const { receipt_digest: ignored, ...body } = value;
  if (canonicalDigest(body) !== value.receipt_digest) {
    return {
      valid: false,
      safe: false,
      evidence: {
        status: 'invalid',
        reason: 'merge_preflight_digest_invalid',
        manifest_seal: value.manifest_seal,
        preflight_status: value.status,
      },
    };
  }
  const safe = value.status === 'safe'
    && value.can_merge === true
    && value.edges.length > 0
    && value.edges.every((edge) => isPlainObject(edge) && edge.status === 'safe')
    && value.blockers.length === 0;
  if (value.can_merge !== (value.status === 'safe')) {
    return {
      valid: false,
      safe: false,
      evidence: {
        status: 'invalid',
        reason: 'merge_preflight_verdict_inconsistent',
        manifest_seal: value.manifest_seal,
        preflight_status: value.status,
      },
    };
  }
  return {
    valid: true,
    safe,
    raw_edges: value.edges,
    evidence: {
      status: 'valid',
      reason: safe ? null : `merge_preflight_${value.status}`,
      manifest_seal: value.manifest_seal,
      preflight_status: value.status,
    },
  };
}

function validateMergeExecution(value, rootRunId, preflight) {
  const unknown = (reason, status = 'unknown') => ({
    valid: false,
    complete: false,
    evidence: {
      status,
      reason,
      receipt_digest: null,
      execution_status: null,
      edge_count: null,
    },
  });
  if (value === null) return unknown('merge_execution_unknown');
  if (!isPlainObject(value)
      || !hasExactKeySet(value, [
        'schema_version', 'artifact_type', 'manifest_seal', 'root_run_id',
        'status', 'halt_reason', 'halt_edge', 'edges', 'receipt_digest',
      ])
      || value.schema_version !== 1
      || value.artifact_type !== 'merge_execution_receipt'
      || !isSha256(value.receipt_digest)
      || !isSha256(value.manifest_seal)
      || value.root_run_id !== rootRunId
      || !['complete', 'halted'].includes(value.status)
      || !Array.isArray(value.edges)) {
    return unknown('merge_execution_shape_invalid', 'invalid');
  }
  const { receipt_digest: ignored, ...body } = value;
  if (canonicalDigest(body) !== value.receipt_digest) {
    return unknown('merge_execution_digest_invalid', 'invalid');
  }
  if (!preflight.valid || value.manifest_seal !== preflight.evidence.manifest_seal) {
    return unknown('merge_execution_manifest_mismatch', 'invalid');
  }
  const preflightEdgeCount = Array.isArray(preflight.raw_edges)
    ? preflight.raw_edges.length
    : null;
  const edgesValid = preflightEdgeCount !== null
    && value.edges.length === preflightEdgeCount
    && value.edges.every((edge, index) => {
      const declared = preflight.raw_edges[index];
      if (!isPlainObject(edge)
          || !isPlainObject(declared)
          || !hasExactKeySet(edge, [
            'sequence', 'source_ref', 'target_ref', 'mode', 'status',
            'source_validation', 'target_validation', 'before_sha', 'after_sha',
            'merge_commit', 'conflicts', 'error', 'preservation', 'edge_receipt_digest',
          ])
          || edge.sequence !== index + 1
          || edge.source_ref !== declared.source_ref
          || edge.target_ref !== declared.target_ref
          || edge.mode !== declared.mode
          || edge.status !== 'executed'
          || !['no-ff', 'ff-only'].includes(edge.mode)
          || !isPlainObject(edge.source_validation)
          || !hasExactKeySet(edge.source_validation, [
            'ref', 'expected_sha', 'actual_sha', 'from_edge',
          ])
          || edge.source_validation.ref !== edge.source_ref
          || !isGitOid(edge.source_validation.expected_sha)
          || !isGitOid(edge.source_validation.actual_sha)
          || edge.source_validation.expected_sha !== edge.source_validation.actual_sha
          || !isPlainObject(edge.target_validation)
          || !hasExactKeySet(edge.target_validation, [
            'ref', 'expected_sha', 'actual_sha', 'from_edge',
          ])
          || edge.target_validation.ref !== edge.target_ref
          || !isGitOid(edge.target_validation.expected_sha)
          || !isGitOid(edge.target_validation.actual_sha)
          || edge.target_validation.expected_sha !== edge.target_validation.actual_sha
          || edge.target_validation.actual_sha !== edge.before_sha
          || !isGitOid(edge.before_sha)
          || !isGitOid(edge.after_sha)
          || (edge.mode === 'no-ff' && edge.merge_commit !== edge.after_sha)
          || (edge.mode === 'ff-only' && edge.merge_commit !== null)
          || !Array.isArray(edge.conflicts)
          || edge.conflicts.length !== 0
          || edge.error !== null
          || !isPlainObject(edge.preservation)
          || !hasExactKeySet(edge.preservation, [
            'approved_paths', 'protected_paths', 'action', 'restored', 'verification',
          ])
          || edge.preservation.restored !== true
          || edge.preservation.verification !== 'exact'
          || !isSha256(edge.edge_receipt_digest)) {
        return false;
      }
      const { edge_receipt_digest: edgeDigest, ...edgeBody } = edge;
      return canonicalDigest(edgeBody) === edgeDigest;
    });
  const complete = value.status === 'complete'
    && value.halt_reason === null
    && value.halt_edge === null
    && edgesValid;
  return {
    valid: true,
    complete,
    evidence: {
      status: 'valid',
      reason: complete ? null : 'merge_execution_incomplete',
      receipt_digest: value.receipt_digest,
      execution_status: value.status,
      edge_count: value.edges.length,
    },
  };
}

function computePredicates({
  missionResult,
  campaignResult,
  acceptance,
  lifecycle,
  integration,
  integrationInput,
  mergePreflight,
  mergeExecution,
  mergeProvenance,
  adapters,
  gitContext,
  candidateResult,
  rootRunId,
}) {
  const failed = [];
  const preflight = validateMergePreflight(mergePreflight);
  const execution = validateMergeExecution(mergeExecution, rootRunId, preflight);
  const provenance = validateMergeProvenance(mergeProvenance, adapters, gitContext, candidateResult);

  if (!preflight.valid) {
    pushFailed(failed, 'merge_preflight_unknown');
  } else if (!preflight.safe && !execution.complete) {
    pushFailed(failed, 'merge_preflight_not_safe');
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

  if (!execution.valid) {
    pushFailed(
      failed,
      preflight.valid && execution.evidence.reason === 'merge_execution_unknown'
        ? 'merge_execution_unknown'
        : 'merge_edges_unknown',
    );
  } else if (!execution.complete) {
    pushFailed(failed, 'merge_edges_incomplete');
  }

  if (!provenance.ok) pushFailed(failed, 'merge_provenance_invalid');

  const canMerge = preflight.safe
    && acceptance.acceptance_verdict === 'accepted'
    && acceptance.accepted_blockers.length === 0
    && provenance.ok;
  return {
    can_merge: canMerge,
    can_close: failed.length === 0,
    failed_predicates: failed,
    merge_preflight: preflight,
    merge_execution: execution,
    merge_provenance: provenance,
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
  if (!isCanonicalTimestamp(input.observed_at)) {
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

  if (input.merge_preflight !== null && !isPlainObject(input.merge_preflight)) {
    throw new TaskStatusError('merge_preflight must be an object or null', 'TASK_STATUS_SHAPE');
  }
  if (input.merge_execution !== null && !isPlainObject(input.merge_execution)) {
    throw new TaskStatusError('merge_execution must be an object or null', 'TASK_STATUS_SHAPE');
  }
  if (input.merge_provenance !== null && !isPlainObject(input.merge_provenance)) {
    throw new TaskStatusError('merge_provenance must be an object or null', 'TASK_STATUS_SHAPE');
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
  const gitContext = {
    repo: input.repo,
    repo_identity: expectedRepoIdentity,
  };
  const candidateResult = collectCandidate(campaignResult, adapters, gitContext);
  const integration = computeIntegration(
    input.integration,
    adapters,
    candidateResult,
    gitContext,
  );
  const acceptance = computeAcceptance(missionResult, campaignResult);
  const predicates = computePredicates({
    missionResult,
    campaignResult,
    acceptance,
    lifecycle,
    integration,
    integrationInput: input.integration,
    mergePreflight: input.merge_preflight,
    mergeExecution: input.merge_execution,
    mergeProvenance: input.merge_provenance,
    rootRunId: input.root_run_id,
    adapters,
    gitContext,
    candidateResult,
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
        ...predicates.merge_preflight.evidence,
      },
      merge_execution: {
        ...predicates.merge_execution.evidence,
      },
      merge_provenance: {
        ...predicates.merge_provenance.evidence,
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
