'use strict';

const crypto = require('crypto');
const path = require('path');
const { isImmutableGitSha } = require('../lib/common');

const CAMPAIGN_SCHEMA_VERSION = 1;
const CAMPAIGN_STATES = Object.freeze({
  PREPARED: 'PREPARED',
  IMPLEMENTING: 'IMPLEMENTING',
  VERTICAL_VERIFICATION: 'VERTICAL_VERIFICATION',
  REVIEWING: 'REVIEWING',
  ADJUDICATING: 'ADJUDICATING',
  AWAITING_DISPOSITION: 'AWAITING_DISPOSITION',
  REPAIRING: 'REPAIRING',
  TERMINAL_READY: 'TERMINAL_READY',
  TERMINAL_FOLLOW_UP: 'TERMINAL_FOLLOW_UP',
  TERMINAL_STOP: 'TERMINAL_STOP',
  BOUNDARY_REJECTED: 'BOUNDARY_REJECTED',
  AWAITING_CONVERGENCE_ADJUDICATION: 'AWAITING_CONVERGENCE_ADJUDICATION',
});
const CAMPAIGN_EVENTS = Object.freeze({
  IMPLEMENTATION_STARTED: 'implementation_started',
  IMPLEMENTATION_COMPLETED: 'implementation_completed',
  MUTATION_FAILED: 'mutation_failed',
  BOUNDARY_REJECTED: 'boundary_rejected',
  VERTICAL_VERIFIED: 'vertical_verified',
  REVIEW_COMPLETED: 'review_completed',
  AWAITING_DISPOSITION: 'awaiting_disposition',
  DISPOSITION_RESUMED: 'disposition_resumed',
  REPAIR_AUTHORIZED: 'repair_authorized',
  REPAIR_STARTED: 'repair_started',
  REPAIR_COMPLETED: 'repair_completed',
  AWAITING_CONVERGENCE: 'awaiting_convergence_adjudication',
  TERMINAL_READY: 'terminal_ready',
  TERMINAL_FOLLOW_UP: 'terminal_follow_up',
  TERMINAL_STOP: 'terminal_stop',
  RESUMED: 'resumed',
});
const TERMINAL_STATES = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
  CAMPAIGN_STATES.TERMINAL_STOP,
  CAMPAIGN_STATES.BOUNDARY_REJECTED,
  CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION,
]);
// Non-success but durable/resumable — not unknown, not mutation_failed fabrication.
const NON_SUCCESS_DURABLE_STATES = new Set([
  CAMPAIGN_STATES.BOUNDARY_REJECTED,
  CAMPAIGN_STATES.AWAITING_DISPOSITION,
  CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION,
]);
const MUTATION_START_EVENTS = new Set([
  CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  CAMPAIGN_EVENTS.REPAIR_STARTED,
]);
const EVENT_KEYS = new Set([
  'schema_version',
  'event_type',
  'campaign_id',
  'contract_digest',
  'generation',
  'idempotency_key',
  'input_artifact_digest',
  'output_artifact_digest',
  'timestamp',
  'stage_identity',
  'usage',
  'payload',
]);
const USAGE_KEYS = new Set([
  'repair_generations',
  'elapsed_wall_seconds',
  'changed_files',
  'churn',
]);
const CAMPAIGN_STATE_KEYS = new Set([
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
const LIMIT_KEYS = new Set([
  'max_repair_generations',
  'max_wall_seconds',
  'max_changed_files',
  'baseline_churn',
  'max_churn',
]);
const CAMPAIGN_PROFILES = new Set([
  'spike',
  'poc',
  'internal-pilot',
  'production',
]);
const EVENT_PAYLOAD_KEYS = Object.freeze({
  [CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED]: ['sealed_contract'],
  [CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED]: [
    'scope_check_passed',
    'scope_check_digest',
  ],
  [CAMPAIGN_EVENTS.MUTATION_FAILED]: [
    'reason',
    'failure_receipt_digest',
    'possibly_effectful',
  ],
  [CAMPAIGN_EVENTS.BOUNDARY_REJECTED]: [
    'reason',
    'boundary_reason',
    'candidate_ref',
    'boundary_receipt_digest',
  ],
  [CAMPAIGN_EVENTS.VERTICAL_VERIFIED]: ['passed', 'evidence_digest'],
  [CAMPAIGN_EVENTS.REVIEW_COMPLETED]: ['review_digest'],
  [CAMPAIGN_EVENTS.AWAITING_DISPOSITION]: [
    'reason',
    'findings_digest',
    'candidate_ref',
  ],
  [CAMPAIGN_EVENTS.DISPOSITION_RESUMED]: [
    'registry_complete',
    'registry_digest',
  ],
  [CAMPAIGN_EVENTS.REPAIR_AUTHORIZED]: [
    'registry_complete',
    'registry_digest',
    'repair_gate_passed',
    'repair_gate_digest',
  ],
  [CAMPAIGN_EVENTS.AWAITING_CONVERGENCE]: [
    'reason',
    'exceeded_axes',
    'budget_receipt_digest',
  ],
  [CAMPAIGN_EVENTS.REPAIR_STARTED]: ['sealed_contract'],
  [CAMPAIGN_EVENTS.REPAIR_COMPLETED]: [
    'scope_check_passed',
    'scope_check_digest',
  ],
  [CAMPAIGN_EVENTS.TERMINAL_READY]: [
    'reason',
    'registry_complete',
    'registry_digest',
    'convergence_digest',
    'lifecycle_receipt_ref',
  ],
  [CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP]: [
    'reason',
    'registry_complete',
    'registry_digest',
    'convergence_digest',
    'follow_up_digest',
    'lifecycle_receipt_ref',
  ],
  [CAMPAIGN_EVENTS.TERMINAL_STOP]: ['reason', 'stop_receipt_digest'],
  [CAMPAIGN_EVENTS.RESUMED]: [],
});

class CampaignStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampaignStateError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CampaignStateError(code, message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function repairLineageCleanupId({
  lineageId,
  branch,
  worktree,
  expectedTip,
  cleanupEpoch,
  worktreeInstanceId,
}) {
  return canonicalDigest({
    schema: 1,
    lineage_id: lineageId,
    branch,
    worktree,
    expected_tip: expectedTip,
    cleanup_epoch: cleanupEpoch,
    worktree_instance_id: worktreeInstanceId,
  });
}

function normalizeCampaignArtifactReference(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    fail('INVALID_ARTIFACT_REFERENCE', 'campaign artifact reference must be a named object');
  }
  const digestKinds = new Set([
    'verification_receipt',
    'product_review',
    'finding_registry',
    'campaign_terminal',
  ]);
  if (digestKinds.has(value.kind)) {
    const hasRepairLineage = new Set(['product_review', 'campaign_terminal']).has(value.kind)
      && Object.prototype.hasOwnProperty.call(value, 'repair_lineage');
    assertExactKeys(
      value,
      new Set(['kind', 'digest', ...(hasRepairLineage ? ['repair_lineage'] : [])]),
      'campaign artifact reference',
    );
    if (!isSha256(value.digest)) {
      fail('INVALID_ARTIFACT_REFERENCE', 'campaign artifact digest is invalid');
    }
    if (hasRepairLineage) {
      validateRepairLineage(
        value.repair_lineage,
        value.repair_lineage.lineage_id,
        value.repair_lineage.branch,
      );
    }
    return { ...value };
  }
  if (value.kind !== 'git_candidate') {
    fail('INVALID_ARTIFACT_REFERENCE', `unsupported campaign artifact kind "${value.kind}"`);
  }
  const hasDigestChain = Object.prototype.hasOwnProperty.call(
    value,
    'campaign_contract_sha256',
  ) || Object.prototype.hasOwnProperty.call(value, 'unit_contract_sha256');
  const candidateKeys = new Set([
    'kind',
    'commit',
    'tree_sha',
    'branch',
    'base',
    'writer_fence',
    'repair_lineage',
    ...(hasDigestChain ? ['campaign_contract_sha256', 'unit_contract_sha256'] : []),
  ]);
  assertExactKeys(
    value,
    candidateKeys,
    'campaign git candidate reference',
  );
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.commit)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.tree_sha)
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.base)
      || typeof value.branch !== 'string'
      || value.branch.length === 0
      || !isPlainObject(value.writer_fence)
      || !isPlainObject(value.repair_lineage)) {
    fail('INVALID_ARTIFACT_REFERENCE', 'campaign Git candidate identity is invalid');
  }
  const fence = value.writer_fence;
  const lineage = value.repair_lineage;
  validateRepairLineage(lineage, fence.campaign_id, value.branch);
  const fenceHasDigestChain = Object.prototype.hasOwnProperty.call(
    fence,
    'campaign_contract_sha256',
  ) || Object.prototype.hasOwnProperty.call(fence, 'unit_contract_sha256');
  assertExactKeys(fence, new Set([
    'schema_version',
    'artifact_type',
    'campaign_id',
    'stage_identity',
    'candidate_commit',
    'candidate_tree_sha',
    'status',
    'evidence_mode',
    'closure_evidence_digest',
    'receipt_digest',
    ...(fenceHasDigestChain ? [
      'campaign_contract_sha256',
      'unit_contract_sha256',
    ] : []),
  ]), 'campaign writer fence reference');
  const { receipt_digest: receiptDigest, ...fenceBody } = fence;
  if (fence.schema_version !== 1
      || fence.artifact_type !== 'implementation_campaign_writer_fence'
      || !/^campaign-v[12]-[0-9a-f]{64}$/.test(fence.campaign_id)
      || typeof fence.stage_identity !== 'string'
      || fence.stage_identity.length === 0
      || fence.candidate_commit !== value.commit
      || fence.candidate_tree_sha !== value.tree_sha
      || fence.status !== 'closed'
      || !new Set(['dispatch_exit', 'terminal_ledger']).has(fence.evidence_mode)
      || !isSha256(fence.closure_evidence_digest)
      || !isSha256(receiptDigest)
      || hasDigestChain !== fenceHasDigestChain
      || (hasDigestChain
        && (!isSha256(value.campaign_contract_sha256)
          || !isSha256(value.unit_contract_sha256)
          || fence.campaign_contract_sha256 !== value.campaign_contract_sha256
          || fence.unit_contract_sha256 !== value.unit_contract_sha256))
      || canonicalDigest(fenceBody) !== receiptDigest) {
    fail('INVALID_ARTIFACT_REFERENCE', 'campaign writer fence reference is invalid');
  }
  return JSON.parse(JSON.stringify(value));
}

function validateRepairLineage(lineage, campaignId, branch) {
  assertExactKeys(lineage, new Set([
    'lineage_id',
    'branch',
    'worktree',
    'provider_session_id',
    'provider_session_reused',
    'provider_session_non_reuse_reason',
    'worktree_reused',
    'worktree_instance_id',
    'cleanup_epoch',
    'cleanup_receipt_id',
    'generation',
    'inherited_churn',
    'delta_churn',
    'retention_owner',
    'retention_reason',
    'retention_expires_at',
    'terminal_worktree_disposition',
    'transcript_reused',
    'transcript_source_digest',
    'review_input_mode',
    'new_input_bytes',
    'new_input_tokens',
    'input_token_measurement',
    'finding_occurrences',
    'accepted_invariant_ids',
    'accepted_invariants',
    'accepted_invariants_source_commit',
    'accepted_invariants_digest',
    'prior_review_finding_ids',
    'previous_repair_finding_count',
    'non_reduction_rounds',
    'repair_scope_paths',
    'repair_scope_seal',
  ]), 'campaign repair lineage reference');
  const findingIds = new Set();
  const findingOccurrencesValid = Array.isArray(lineage.finding_occurrences)
    && lineage.finding_occurrences.every((item) => {
      if (!isPlainObject(item)
          || Object.keys(item).sort().join(',') !== 'finding_id,occurrences'
          || typeof item.finding_id !== 'string'
          || item.finding_id.length === 0
          || !Number.isSafeInteger(item.occurrences)
          || item.occurrences < 1
          || findingIds.has(item.finding_id)) return false;
      findingIds.add(item.finding_id);
      return true;
    });
  const validFindingIdList = (items) => Array.isArray(items)
    && items.every((item, index) => typeof item === 'string'
      && item.length > 0
      && (index === 0 || items[index - 1] < item));
  if (lineage.lineage_id !== campaignId
      || lineage.branch !== branch
      || (lineage.worktree === null
        ? lineage.terminal_worktree_disposition !== 'not_created_failed_dispatch'
        : (typeof lineage.worktree !== 'string' || !path.isAbsolute(lineage.worktree)))
      || (lineage.provider_session_id !== null
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          lineage.provider_session_id,
        ))
      || typeof lineage.provider_session_reused !== 'boolean'
      || (lineage.provider_session_non_reuse_reason !== null
        && (typeof lineage.provider_session_non_reuse_reason !== 'string'
          || lineage.provider_session_non_reuse_reason.length === 0))
      || typeof lineage.worktree_reused !== 'boolean'
      || (lineage.worktree === null
        ? lineage.worktree_instance_id !== null
        : !isSha256(lineage.worktree_instance_id))
      || !Number.isSafeInteger(lineage.cleanup_epoch)
      || lineage.cleanup_epoch < 0
      || (lineage.cleanup_epoch === 0
        && (lineage.worktree !== null
          || lineage.terminal_worktree_disposition !== 'not_created_failed_dispatch'))
      || (lineage.cleanup_receipt_id !== null
        && !isSha256(lineage.cleanup_receipt_id))
      || ((lineage.terminal_worktree_disposition === 'removed_clean')
        !== (lineage.cleanup_receipt_id !== null))
      || !Number.isSafeInteger(lineage.generation)
      || lineage.generation < 0
      || !Number.isSafeInteger(lineage.inherited_churn)
      || lineage.inherited_churn < 0
      || !Number.isSafeInteger(lineage.delta_churn)
      || lineage.delta_churn < 0
      || lineage.retention_owner !== campaignId
      || lineage.retention_reason !== 'implementation-campaign-repair-lineage'
      || !Number.isSafeInteger(lineage.retention_expires_at)
      || lineage.retention_expires_at <= 0
      || !new Set([
        'active',
        'retained_failed_dispatch',
        'not_created_failed_dispatch',
        'blocked_cleanup_journal',
        'blocked_dirty_or_unverifiable',
        'removed_clean',
      ]).has(lineage.terminal_worktree_disposition)
      || typeof lineage.transcript_reused !== 'boolean'
      || !isSha256(lineage.transcript_source_digest)
      || !new Set(['full_diff_generation', 'focused_delta_round']).has(
        lineage.review_input_mode,
      )
      || !Number.isSafeInteger(lineage.new_input_bytes)
      || lineage.new_input_bytes < 0
      || (lineage.new_input_tokens !== null
        && (!Number.isSafeInteger(lineage.new_input_tokens)
          || lineage.new_input_tokens < 0))
      || !new Set(['unavailable', 'provider_reported']).has(
        lineage.input_token_measurement,
      )
      || !findingOccurrencesValid
      || !validFindingIdList(lineage.accepted_invariant_ids)
      || !Array.isArray(lineage.accepted_invariants)
      || lineage.accepted_invariants.some((item) => typeof item !== 'string'
        || item.length === 0)
      || (lineage.accepted_invariants_source_commit !== null
        && !isImmutableGitSha(lineage.accepted_invariants_source_commit))
      || (lineage.accepted_invariants_digest !== null
        && !isSha256(lineage.accepted_invariants_digest))
      || ((lineage.accepted_invariants.length === 0)
        !== (lineage.accepted_invariants_source_commit === null))
      || ((lineage.accepted_invariants.length === 0)
        !== (lineage.accepted_invariants_digest === null))
      || (lineage.accepted_invariants.length > 0
        && canonicalDigest({
          schema: 1,
          assertions: lineage.accepted_invariants,
          source_commit: lineage.accepted_invariants_source_commit,
        }) !== lineage.accepted_invariants_digest)
      || !validFindingIdList(lineage.prior_review_finding_ids)
      || (lineage.previous_repair_finding_count !== null
        && (!Number.isSafeInteger(lineage.previous_repair_finding_count)
          || lineage.previous_repair_finding_count < 0))
      || !Number.isSafeInteger(lineage.non_reduction_rounds)
      || lineage.non_reduction_rounds < 0
      || !Array.isArray(lineage.repair_scope_paths)
      || lineage.repair_scope_paths.some((item, index) => typeof item !== 'string'
        || item.length === 0
        || path.isAbsolute(item)
        || item.split('/').includes('..')
        || (index > 0 && lineage.repair_scope_paths[index - 1] >= item))
      || (lineage.repair_scope_seal !== null
        && (!isPlainObject(lineage.repair_scope_seal)
          || lineage.repair_scope_seal.schema !== 1
          || !isSha256(lineage.repair_scope_seal.seal_digest)
          || !isImmutableGitSha(lineage.repair_scope_seal.source_commit)
          || !validFindingIdList(lineage.repair_scope_seal.finding_ids)
          || !Array.isArray(lineage.repair_scope_seal.allowed_paths)
          || lineage.repair_scope_seal.allowed_paths.join('\0')
            !== lineage.repair_scope_paths.join('\0')
          || canonicalDigest({
            schema: lineage.repair_scope_seal.schema,
            finding_ids: lineage.repair_scope_seal.finding_ids,
            allowed_paths: lineage.repair_scope_seal.allowed_paths,
            source_commit: lineage.repair_scope_seal.source_commit,
          }) !== lineage.repair_scope_seal.seal_digest))) {
    fail('INVALID_ARTIFACT_REFERENCE', 'campaign repair lineage identity is invalid');
  }
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value)) fail('INVALID_SHAPE', `${label} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${label} has unknown field "${key}"`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail('MISSING_FIELD', `${label} is missing "${key}"`);
    }
  }
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_TIMESTAMP', `${label} must be an ISO-8601 timestamp`);
  }
  const parsed = new Date(value);
  if (parsed.toISOString() !== value) {
    fail('INVALID_TIMESTAMP', `${label} must be canonical UTC ISO-8601`);
  }
  return parsed.getTime();
}

function campaignIdFor(repoIdentity, ticket, contractDigest) {
  if (typeof repoIdentity !== 'string' || repoIdentity.length === 0) {
    fail('INVALID_CAMPAIGN_IDENTITY', 'repo identity is required');
  }
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(ticket)) {
    fail('INVALID_CAMPAIGN_IDENTITY', 'ticket must match [A-Za-z0-9._-]{1,128}');
  }
  if (!isSha256(contractDigest)) {
    fail('INVALID_CAMPAIGN_IDENTITY', 'contract digest must be a lowercase SHA-256 digest');
  }
  return `campaign-v1-${sha256(`${repoIdentity}\0${ticket}\0${contractDigest}`)}`;
}

function normalizeLimits(contract) {
  const required = [
    'max_repair_generations',
    'max_wall_seconds',
    'max_changed_files',
    'baseline_churn',
    'max_extra_churn',
  ];
  for (const key of required) {
    if (!Number.isSafeInteger(contract[key]) || contract[key] < 0) {
      fail('INVALID_LIMITS', `contract.${key} must be a non-negative safe integer`);
    }
  }
  return {
    max_repair_generations: contract.max_repair_generations,
    max_wall_seconds: contract.max_wall_seconds,
    max_changed_files: contract.max_changed_files,
    baseline_churn: contract.baseline_churn,
    max_churn: contract.baseline_churn + contract.max_extra_churn,
  };
}

function createCampaignState({
  contract,
  contractDigest,
  repoIdentity,
  startedAt,
}) {
  if (!isPlainObject(contract)) fail('INVALID_CONTRACT', 'contract must be a plain object');
  if (!isSha256(contractDigest)) {
    fail('INVALID_CONTRACT_DIGEST', 'contractDigest must be a lowercase SHA-256 digest');
  }
  const startedAtMs = parseTimestamp(startedAt, 'startedAt');
  const campaignId = campaignIdFor(repoIdentity, contract.ticket, contractDigest);
  return {
    schema_version: CAMPAIGN_SCHEMA_VERSION,
    campaign_id: campaignId,
    contract_digest: contractDigest,
    repo_identity: repoIdentity,
    ticket: contract.ticket,
    profile: contract.profile,
    phase: CAMPAIGN_STATES.PREPARED,
    generation: 0,
    limits: normalizeLimits(contract),
    usage: {
      repair_generations: 0,
      elapsed_wall_seconds: 0,
      changed_files: 0,
      churn: 0,
    },
    started_at: new Date(startedAtMs).toISOString(),
    last_event_at: new Date(startedAtMs).toISOString(),
    live_lease: null,
    idempotency_records: [],
    event_count: 0,
    last_input_artifact_digest: contractDigest,
    last_output_artifact_digest: contractDigest,
    terminal_reason: null,
  };
}

function validateInitialCampaignState(state) {
  assertExactKeys(state, CAMPAIGN_STATE_KEYS, 'initial campaign state');
  if (state.schema_version !== CAMPAIGN_SCHEMA_VERSION) {
    fail('SCHEMA_VERSION', 'initial campaign state schema_version must equal 1');
  }
  if (typeof state.campaign_id !== 'string'
      || !/^campaign-v1-[0-9a-f]{64}$/.test(state.campaign_id)
      || !isSha256(state.contract_digest)) {
    fail('INVALID_STATE_IDENTITY', 'initial campaign identity is invalid');
  }
  if (typeof state.repo_identity !== 'string' || state.repo_identity.length === 0
      || typeof state.ticket !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(state.ticket)
      || !CAMPAIGN_PROFILES.has(state.profile)) {
    fail('INVALID_STATE_IDENTITY', 'initial campaign contract identity is invalid');
  }
  if (state.campaign_id !== campaignIdFor(
    state.repo_identity,
    state.ticket,
    state.contract_digest,
  )) {
    fail('INVALID_STATE_IDENTITY', 'initial campaign id does not match its contract identity');
  }
  if (state.phase !== CAMPAIGN_STATES.PREPARED || state.generation !== 0) {
    fail('INVALID_INITIAL_PHASE', 'initial campaign must be PREPARED at generation zero');
  }
  assertExactKeys(state.limits, LIMIT_KEYS, 'initial campaign limits');
  for (const key of LIMIT_KEYS) {
    if (!Number.isSafeInteger(state.limits[key]) || state.limits[key] < 0) {
      fail('INVALID_LIMITS', `initial campaign limits.${key} must be a non-negative safe integer`);
    }
  }
  assertExactKeys(state.usage, USAGE_KEYS, 'initial campaign usage');
  if (Object.values(state.usage).some((value) => value !== 0)) {
    fail('INVALID_INITIAL_USAGE', 'initial campaign usage must start at zero');
  }
  parseTimestamp(state.started_at, 'initial campaign started_at');
  parseTimestamp(state.last_event_at, 'initial campaign last_event_at');
  if (state.started_at !== state.last_event_at) {
    fail('INVALID_INITIAL_TIME', 'initial campaign clock must start at one durable timestamp');
  }
  if (state.live_lease !== null
      || !Array.isArray(state.idempotency_records)
      || state.idempotency_records.length !== 0
      || state.event_count !== 0
      || state.last_input_artifact_digest !== state.contract_digest
      || state.last_output_artifact_digest !== state.contract_digest
      || state.terminal_reason !== null) {
    fail('INVALID_INITIAL_STATE', 'initial campaign state contains projected or unbound data');
  }
  return true;
}

function validateUsage(state, event, expectedGeneration, options = {}) {
  assertExactKeys(event.usage, USAGE_KEYS, 'event.usage');
  for (const key of USAGE_KEYS) {
    if (!Number.isSafeInteger(event.usage[key]) || event.usage[key] < 0) {
      fail('INVALID_USAGE', `event.usage.${key} must be a non-negative safe integer`);
    }
  }
  const eventMs = parseTimestamp(event.timestamp, 'event.timestamp');
  const startedMs = parseTimestamp(state.started_at, 'state.started_at');
  const lastMs = parseTimestamp(state.last_event_at, 'state.last_event_at');
  if (eventMs < lastMs) fail('TIME_RESET', 'event timestamp precedes durable campaign time');
  const elapsed = Math.floor((eventMs - startedMs) / 1000);
  if (event.usage.elapsed_wall_seconds !== elapsed) {
    fail('WALL_CLOCK_RESET', 'elapsed wall time must equal the durable campaign clock');
  }
  for (const key of ['elapsed_wall_seconds', 'changed_files', 'churn']) {
    if (event.usage[key] < state.usage[key]) {
      fail('BUDGET_RESET', `event.usage.${key} cannot decrease on resume or transition`);
    }
  }
  if (event.usage.repair_generations !== expectedGeneration) {
    fail('GENERATION_RESET', 'repair generation usage must equal the durable generation');
  }
  if (!options.allowBudgetOverrun
      && event.usage.elapsed_wall_seconds > state.limits.max_wall_seconds) {
    fail('WALL_BUDGET_EXCEEDED', 'campaign wall-clock ceiling exceeded');
  }
  if (!options.allowBudgetOverrun
      && event.usage.changed_files > state.limits.max_changed_files) {
    fail('FILE_BUDGET_EXCEEDED', 'campaign changed-file ceiling exceeded');
  }
  if (!options.allowBudgetOverrun && event.usage.churn > state.limits.max_churn) {
    fail('CHURN_BUDGET_EXCEEDED', 'campaign churn ceiling exceeded');
  }
}

function validateCommonEvent(state, event) {
  assertExactKeys(event, EVENT_KEYS, 'event');
  if (event.schema_version !== CAMPAIGN_SCHEMA_VERSION) {
    fail('SCHEMA_VERSION', 'event.schema_version must equal 1');
  }
  if (!Object.values(CAMPAIGN_EVENTS).includes(event.event_type)) {
    fail('UNKNOWN_EVENT', `unsupported campaign event "${event.event_type}"`);
  }
  if (event.campaign_id !== state.campaign_id) {
    fail('CAMPAIGN_MISMATCH', 'event campaign_id does not match durable campaign');
  }
  if (event.contract_digest !== state.contract_digest) {
    fail('CONTRACT_DRIFT', 'event contract digest does not match sealed campaign');
  }
  if (typeof event.idempotency_key !== 'string'
      || !/^[A-Za-z0-9._:-]{1,256}$/.test(event.idempotency_key)) {
    fail('INVALID_IDEMPOTENCY_KEY', 'event idempotency key is invalid');
  }
  if (!isSha256(event.input_artifact_digest) || !isSha256(event.output_artifact_digest)) {
    fail('INVALID_ARTIFACT_DIGEST', 'event artifact bindings must be lowercase SHA-256 digests');
  }
  if (typeof event.stage_identity !== 'string'
      || !/^[A-Za-z0-9._:-]{1,256}$/.test(event.stage_identity)) {
    fail('INVALID_STAGE_IDENTITY', 'event stage identity is invalid');
  }
  if (!isPlainObject(event.payload)) fail('INVALID_PAYLOAD', 'event.payload must be an object');

  const existing = state.idempotency_records.find(
    (record) => record.key === event.idempotency_key,
  );
  const eventDigest = canonicalDigest(event);
  if (existing) {
    if (existing.event_digest !== eventDigest) {
      fail('IDEMPOTENCY_CONFLICT', 'idempotency key was already bound to another event');
    }
    return { duplicate: true, eventDigest };
  }
  return { duplicate: false, eventDigest };
}

function requireLease(state, event) {
  if (!state.live_lease) fail('LEASE_MISSING', 'mutation completion requires a live lease');
  if (state.live_lease.stage_identity !== event.stage_identity
      || state.live_lease.generation !== event.generation) {
    fail('LEASE_FENCED', 'mutation writer does not own the durable campaign lease');
  }
}

function acquireLease(state, event) {
  if (state.live_lease) fail('LIVE_LEASE_CONFLICT', 'campaign generation already has a live lease');
  if (event.payload.sealed_contract !== true) {
    fail('UNSEALED_MUTATION', 'mutation cannot start without a sealed contract');
  }
  state.live_lease = {
    stage_identity: event.stage_identity,
    generation: event.generation,
    acquired_at: event.timestamp,
  };
}

function requireScopeCheck(event) {
  if (event.payload.scope_check_passed !== true
      || !isSha256(event.payload.scope_check_digest)) {
    fail('SCOPE_CHECK_REQUIRED', 'post-mutation progress requires check-repair-scope PASS');
  }
}

function validateLifecycleReceiptReference(value, campaignId) {
  if (value === 'unknown') return;
  if (!isPlainObject(value)
      || Object.keys(value).length !== 3
      || typeof value.path !== 'string'
      || value.path.length === 0
      || value.root_run_id !== campaignId
      || !isSha256(value.receipt_digest)) {
    fail(
      'INVALID_LIFECYCLE_RECEIPT_REF',
      'terminal lifecycle receipt reference must be exact or unknown',
    );
  }
}

function reduceCampaignState(currentState, event) {
  if (!isPlainObject(currentState)) fail('INVALID_STATE', 'campaign state must be an object');
  const common = validateCommonEvent(currentState, event);
  if (common.duplicate) return currentState;
  const payloadKeys = new Set(EVENT_PAYLOAD_KEYS[event.event_type]);
  const terminalEvent = new Set([
    CAMPAIGN_EVENTS.TERMINAL_READY,
    CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP,
  ]).has(event.event_type);
  assertExactKeys(event.payload, payloadKeys, `${event.event_type}.payload`);
  if (terminalEvent) {
    validateLifecycleReceiptReference(event.payload.lifecycle_receipt_ref, event.campaign_id);
  }
  if (TERMINAL_STATES.has(currentState.phase)) {
    fail('TERMINAL_CAMPAIGN', 'terminal campaign cannot accept another event');
  }
  if (event.input_artifact_digest !== currentState.last_output_artifact_digest) {
    fail('ARTIFACT_CHAIN_BROKEN', 'event input artifact must match the prior output artifact');
  }

  const next = JSON.parse(JSON.stringify(currentState));
  const isRepairAuthorization = event.event_type === CAMPAIGN_EVENTS.REPAIR_AUTHORIZED;
  const expectedGeneration = isRepairAuthorization
    ? currentState.generation + 1
    : currentState.generation;
  if (event.generation !== expectedGeneration) {
    fail('GENERATION_MISMATCH', `event generation must equal ${expectedGeneration}`);
  }
  validateUsage(currentState, event, expectedGeneration, {
    allowBudgetOverrun: new Set([
      CAMPAIGN_EVENTS.MUTATION_FAILED,
      CAMPAIGN_EVENTS.TERMINAL_STOP,
      CAMPAIGN_EVENTS.BOUNDARY_REJECTED,
      CAMPAIGN_EVENTS.AWAITING_CONVERGENCE,
    ]).has(event.event_type),
  });
  if (MUTATION_START_EVENTS.has(event.event_type)
      && event.usage.elapsed_wall_seconds >= currentState.limits.max_wall_seconds) {
    fail('WALL_BUDGET_EXHAUSTED', 'mutation cannot start without remaining wall-clock budget');
  }

  if (event.event_type === CAMPAIGN_EVENTS.RESUMED) {
    if (currentState.live_lease) {
      fail('LIVE_LEASE_CONFLICT', 'resume cannot replace a live lease owner');
    }
    if (event.output_artifact_digest !== currentState.last_output_artifact_digest) {
      fail('RESUME_ARTIFACT_DRIFT', 'resume cannot replace the durable output artifact');
    }
    if (event.usage.changed_files !== currentState.usage.changed_files
        || event.usage.churn !== currentState.usage.churn) {
      fail('RESUME_GROWTH_DRIFT', 'resume cannot change durable file or churn usage');
    }
  } else if (currentState.phase === CAMPAIGN_STATES.PREPARED
      && event.event_type === CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED) {
    acquireLease(next, event);
    next.phase = CAMPAIGN_STATES.IMPLEMENTING;
  } else if (currentState.phase === CAMPAIGN_STATES.IMPLEMENTING
      && event.event_type === CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED) {
    requireLease(currentState, event);
    requireScopeCheck(event);
    next.live_lease = null;
    next.phase = CAMPAIGN_STATES.VERTICAL_VERIFICATION;
  } else if (new Set([
    CAMPAIGN_STATES.IMPLEMENTING,
    CAMPAIGN_STATES.REPAIRING,
  ]).has(currentState.phase)
      && event.event_type === CAMPAIGN_EVENTS.MUTATION_FAILED) {
    requireLease(currentState, event);
    if (event.payload.possibly_effectful !== true
        || !isSha256(event.payload.failure_receipt_digest)
        || event.output_artifact_digest !== canonicalDigest({
          kind: 'campaign_terminal',
          digest: event.payload.failure_receipt_digest,
        })
        || typeof event.payload.reason !== 'string'
        || event.payload.reason.trim() === '') {
      fail(
        'MUTATION_FAILURE_EVIDENCE_REQUIRED',
        'mutation failure requires possibly-effectful digest-bound failure evidence',
      );
    }
    next.live_lease = null;
    next.phase = CAMPAIGN_STATES.TERMINAL_STOP;
  } else if (new Set([
    CAMPAIGN_STATES.IMPLEMENTING,
    CAMPAIGN_STATES.REPAIRING,
  ]).has(currentState.phase)
      && event.event_type === CAMPAIGN_EVENTS.BOUNDARY_REJECTED) {
    // First-class non-success: preserve candidate_ref + boundary reason; never
    // collapse to unknown status or fabricated mutation-failure evidence.
    requireLease(currentState, event);
    if (typeof event.payload.reason !== 'string' || event.payload.reason.trim() === ''
        || typeof event.payload.boundary_reason !== 'string'
        || event.payload.boundary_reason.trim() === ''
        || !isSha256(event.payload.boundary_receipt_digest)
        || event.output_artifact_digest !== canonicalDigest({
          kind: 'campaign_boundary_rejected',
          digest: event.payload.boundary_receipt_digest,
        })) {
      fail(
        'BOUNDARY_EVIDENCE_REQUIRED',
        'boundary_rejected requires digest-bound boundary evidence and reason',
      );
    }
    // candidate_ref may be null only when no commit was produced; if present must be sha-like
    if (event.payload.candidate_ref !== null
        && (typeof event.payload.candidate_ref !== 'string'
          || event.payload.candidate_ref.length < 7)) {
      fail('BOUNDARY_CANDIDATE_REQUIRED', 'boundary_rejected candidate_ref is invalid');
    }
    next.live_lease = null;
    next.phase = CAMPAIGN_STATES.BOUNDARY_REJECTED;
    next.boundary_rejected = {
      reason: event.payload.boundary_reason,
      candidate_ref: event.payload.candidate_ref,
      receipt_digest: event.payload.boundary_receipt_digest,
    };
  } else if (currentState.phase === CAMPAIGN_STATES.VERTICAL_VERIFICATION
      && event.event_type === CAMPAIGN_EVENTS.VERTICAL_VERIFIED) {
    if (event.payload.passed !== true || !isSha256(event.payload.evidence_digest)) {
      fail('VERTICAL_EVIDENCE_REQUIRED', 'review requires passing digest-bound vertical evidence');
    }
    next.phase = CAMPAIGN_STATES.REVIEWING;
  } else if (currentState.phase === CAMPAIGN_STATES.REVIEWING
      && event.event_type === CAMPAIGN_EVENTS.REVIEW_COMPLETED) {
    if (!isSha256(event.payload.review_digest)) {
      fail('REVIEW_EVIDENCE_REQUIRED', 'review completion requires a review artifact digest');
    }
    next.phase = CAMPAIGN_STATES.ADJUDICATING;
  } else if (currentState.phase === CAMPAIGN_STATES.ADJUDICATING
      && event.event_type === CAMPAIGN_EVENTS.AWAITING_DISPOSITION) {
    if (typeof event.payload.reason !== 'string' || event.payload.reason.trim() === ''
        || !isSha256(event.payload.findings_digest)) {
      fail(
        'DISPOSITION_WAIT_EVIDENCE_REQUIRED',
        'awaiting_disposition requires findings digest and reason',
      );
    }
    next.phase = CAMPAIGN_STATES.AWAITING_DISPOSITION;
    next.awaiting_disposition = {
      reason: event.payload.reason,
      findings_digest: event.payload.findings_digest,
      candidate_ref: event.payload.candidate_ref || null,
    };
  } else if (currentState.phase === CAMPAIGN_STATES.AWAITING_DISPOSITION
      && event.event_type === CAMPAIGN_EVENTS.DISPOSITION_RESUMED) {
    if (event.payload.registry_complete !== true
        || !isSha256(event.payload.registry_digest)) {
      fail('REGISTRY_INCOMPLETE', 'disposition resume requires complete registry');
    }
    next.phase = CAMPAIGN_STATES.ADJUDICATING;
    next.awaiting_disposition = null;
  } else if (new Set([
    CAMPAIGN_STATES.ADJUDICATING,
    CAMPAIGN_STATES.VERTICAL_VERIFICATION,
  ]).has(currentState.phase)
      && event.event_type === CAMPAIGN_EVENTS.REPAIR_AUTHORIZED) {
    if (event.payload.registry_complete !== true
        || !isSha256(event.payload.registry_digest)) {
      fail('REGISTRY_INCOMPLETE', 'repair requires registry-wide finding completeness');
    }
    if (event.payload.repair_gate_passed !== true
        || !isSha256(event.payload.repair_gate_digest)) {
      fail('REPAIR_GATE_REQUIRED', 'repair requires a passing repair-gate receipt');
    }
    if (expectedGeneration > currentState.limits.max_repair_generations) {
      fail('REPAIR_BUDGET_EXCEEDED', 'repair generation ceiling exceeded');
    }
    next.generation = expectedGeneration;
    next.phase = CAMPAIGN_STATES.REPAIRING;
  } else if (currentState.phase === CAMPAIGN_STATES.REPAIRING
      && event.event_type === CAMPAIGN_EVENTS.REPAIR_STARTED) {
    acquireLease(next, event);
  } else if (currentState.phase === CAMPAIGN_STATES.REPAIRING
      && event.event_type === CAMPAIGN_EVENTS.REPAIR_COMPLETED) {
    requireLease(currentState, event);
    requireScopeCheck(event);
    next.live_lease = null;
    next.phase = CAMPAIGN_STATES.VERTICAL_VERIFICATION;
  } else if (currentState.phase === CAMPAIGN_STATES.ADJUDICATING
      && event.event_type === CAMPAIGN_EVENTS.TERMINAL_READY) {
    if (event.payload.registry_complete !== true
        || !isSha256(event.payload.registry_digest)) {
      fail('REGISTRY_INCOMPLETE', 'ready terminal requires registry-wide completeness');
    }
    if (!isSha256(event.payload.convergence_digest)) {
      fail('CONVERGENCE_EVIDENCE_REQUIRED', 'ready terminal requires convergence evidence');
    }
    next.phase = CAMPAIGN_STATES.TERMINAL_READY;
  } else if (currentState.phase === CAMPAIGN_STATES.ADJUDICATING
      && event.event_type === CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP) {
    if (event.payload.registry_complete !== true
        || !isSha256(event.payload.registry_digest)) {
      fail('REGISTRY_INCOMPLETE', 'follow-up terminal requires registry-wide completeness');
    }
    if (!isSha256(event.payload.convergence_digest)
        || !isSha256(event.payload.follow_up_digest)) {
      fail(
        'CONVERGENCE_EVIDENCE_REQUIRED',
        'follow-up terminal requires convergence and follow-up evidence',
      );
    }
    next.phase = CAMPAIGN_STATES.TERMINAL_FOLLOW_UP;
  } else if (event.event_type === CAMPAIGN_EVENTS.AWAITING_CONVERGENCE
      && currentState.live_lease === null
      && !TERMINAL_STATES.has(currentState.phase)) {
    if (typeof event.payload.reason !== 'string' || event.payload.reason.trim() === ''
        || !Array.isArray(event.payload.exceeded_axes)
        || event.payload.exceeded_axes.length === 0
        || !isSha256(event.payload.budget_receipt_digest)) {
      fail(
        'CONVERGENCE_BUDGET_EVIDENCE_REQUIRED',
        'awaiting_convergence_adjudication requires exceeded axes and budget receipt',
      );
    }
    next.phase = CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION;
    next.convergence_budget = {
      exceeded_axes: [...event.payload.exceeded_axes].sort(),
      budget_receipt_digest: event.payload.budget_receipt_digest,
    };
  } else if (event.event_type === CAMPAIGN_EVENTS.TERMINAL_STOP
      && currentState.live_lease === null) {
    if (!isSha256(event.payload.stop_receipt_digest)) {
      fail('STOP_EVIDENCE_REQUIRED', 'stop terminal requires a stop receipt digest');
    }
    next.phase = CAMPAIGN_STATES.TERMINAL_STOP;
  } else {
    fail(
      'INVALID_TRANSITION',
      `cannot apply ${event.event_type} while campaign is ${currentState.phase}`,
    );
  }

  if (TERMINAL_STATES.has(next.phase)
      || next.phase === CAMPAIGN_STATES.AWAITING_DISPOSITION) {
    const reason = event.payload.reason;
    if (typeof reason !== 'string' || reason.trim() === '') {
      fail('TERMINAL_REASON_REQUIRED', 'terminal/durable-wait campaign event requires a reason');
    }
    if (TERMINAL_STATES.has(next.phase)) {
      next.terminal_reason = reason;
    }
  }
  next.usage = { ...event.usage };
  next.last_event_at = event.timestamp;
  next.last_input_artifact_digest = event.input_artifact_digest;
  next.last_output_artifact_digest = event.output_artifact_digest;
  next.event_count += 1;
  next.idempotency_records.push({
    key: event.idempotency_key,
    event_digest: common.eventDigest,
  });
  return next;
}

function replayCampaignEvents(initialState, events) {
  if (!Array.isArray(events)) fail('INVALID_EVENTS', 'events must be an array');
  return events.reduce((state, event) => reduceCampaignState(state, event), initialState);
}

module.exports = {
  CAMPAIGN_EVENTS,
  CAMPAIGN_SCHEMA_VERSION,
  CAMPAIGN_STATES,
  NON_SUCCESS_DURABLE_STATES,
  CampaignStateError,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  normalizeCampaignArtifactReference,
  repairLineageCleanupId,
  reduceCampaignState,
  replayCampaignEvents,
  validateInitialCampaignState,
};
