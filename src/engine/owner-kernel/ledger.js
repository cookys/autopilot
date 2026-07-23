'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const { verifyEvent } = require('./events');
const { freezeAcceptanceContract, resolveGovernancePolicy } = require('./policy');
const { makeInitialState, applyEvent, stateProjection } = require('./state');

const HEADER_RECORD_TYPE = 'owner_kernel_header';
const LEDGER_SCHEMA_VERSION = 1;

function ledgerError(message) {
  throw new OwnerKernelError(message, 'INVALID_OWNER_LEDGER');
}

function validateRunId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value)) {
    ledgerError('run_id must match [A-Za-z0-9._-]{1,128}');
  }
  return value;
}

function validateCreatedAt(value) {
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    ledgerError('created_at must be a UTC ISO-8601 timestamp');
  }
  return value;
}

function normalizeFrozenPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) ledgerError('header.policy must be an object');
  const defaultMode = policy.project_default_mode;
  const mode = policy.mode;
  if (typeof defaultMode !== 'string' || typeof mode !== 'string') {
    ledgerError('header.policy must contain project_default_mode and mode');
  }
  if (policy.mode_source !== 'project-default' && policy.mode_source !== 'run-override') {
    ledgerError('header.policy must contain a valid mode_source');
  }
  const input = {
    schema_version: 1,
    governance: {
      default_mode: defaultMode,
      owner_roster: policy.owner_roster,
      challenger_roster: policy.challenger_roster,
      trusted_runner_roster: policy.trusted_runner_roster,
      approval_policy: policy.approval_policy,
      capability_ttl_seconds: policy.capability_ttl_seconds,
      checkpoint_interval_closed_events: policy.checkpoint_interval_closed_events,
      max_blocked_duration_seconds: policy.max_blocked_duration_seconds,
    },
  };
  let resolved;
  try {
    resolved = resolveGovernancePolicy(
      input,
      policy.mode_source === 'run-override' ? { modeOverride: mode } : {},
    );
  } catch (error) {
    ledgerError(`header.policy is invalid: ${error.message}`);
  }
  if (policy.mode_source !== resolved.policy.mode_source
    || canonicalJson(policy) !== canonicalJson(resolved.policy)) {
    ledgerError('header.policy is not the canonical resolved policy');
  }
  return resolved;
}

function createLedgerHeader({
  runId,
  policy,
  policyHash,
  contract,
  contractHash,
  witnessStreamId,
  capabilityNonceCommitment,
  createdAt,
}) {
  validateRunId(runId);
  if (typeof witnessStreamId !== 'string' || witnessStreamId.length === 0) {
    ledgerError('witnessStreamId must be a non-empty string');
  }
  if (!isSha256(capabilityNonceCommitment)) ledgerError('capabilityNonceCommitment must be a SHA-256 digest');
  validateCreatedAt(createdAt);
  const normalizedPolicy = normalizeFrozenPolicy(policy);
  const normalizedContract = freezeAcceptanceContract(contract);
  if (normalizedPolicy.policy_hash !== policyHash) ledgerError('policyHash does not match canonical policy');
  if (normalizedContract.contract_hash !== contractHash) ledgerError('contractHash does not match canonical acceptance contract');
  return cloneCanonical({
    record_type: HEADER_RECORD_TYPE,
    schema_version: LEDGER_SCHEMA_VERSION,
    run_id: runId,
    created_at: createdAt,
    policy: normalizedPolicy.policy,
    policy_hash: normalizedPolicy.policy_hash,
    acceptance_contract: normalizedContract.contract,
    contract_hash: normalizedContract.contract_hash,
    witness_stream_id: witnessStreamId,
    capability_nonce_commitment: capabilityNonceCommitment.toLowerCase(),
  });
}

function validateLedgerHeader(header) {
  if (!header || typeof header !== 'object' || Array.isArray(header)) ledgerError('ledger header must be an object');
  const allowed = new Set([
    'record_type',
    'schema_version',
    'run_id',
    'created_at',
    'policy',
    'policy_hash',
    'acceptance_contract',
    'contract_hash',
    'witness_stream_id',
    'capability_nonce_commitment',
  ]);
  for (const key of Object.keys(header)) {
    if (!allowed.has(key)) ledgerError(`ledger header has unsupported key "${key}"`);
  }
  if (header.record_type !== HEADER_RECORD_TYPE || header.schema_version !== LEDGER_SCHEMA_VERSION) {
    ledgerError('ledger header record_type or schema_version is invalid');
  }
  validateRunId(header.run_id);
  validateCreatedAt(header.created_at);
  if (typeof header.witness_stream_id !== 'string' || header.witness_stream_id.length === 0) {
    ledgerError('ledger header witness_stream_id is invalid');
  }
  if (!isSha256(header.capability_nonce_commitment)) ledgerError('ledger header capability_nonce_commitment is invalid');
  const policy = normalizeFrozenPolicy(header.policy);
  const contract = freezeAcceptanceContract(header.acceptance_contract);
  if (header.policy_hash !== policy.policy_hash || header.contract_hash !== contract.contract_hash) {
    ledgerError('ledger header policy or contract hash does not match frozen data');
  }
  return {
    header: cloneCanonical(header),
    policy: policy.policy,
    contract: contract.contract,
  };
}

function serializeLedger(ledger) {
  if (!ledger || typeof ledger !== 'object' || !Array.isArray(ledger.events)) {
    ledgerError('ledger must contain header and events');
  }
  validateLedgerHeader(ledger.header);
  return [ledger.header, ...ledger.events].map((record) => canonicalJson(record)).join('\n').concat('\n');
}

function parseLedgerJsonl(source) {
  if (typeof source !== 'string') ledgerError('ledger JSONL source must be a string');
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) ledgerError('ledger JSONL must contain a header');
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch (_error) {
    ledgerError('ledger header is not valid JSON');
  }
  const events = lines.slice(1).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (_error) {
      ledgerError(`ledger event line ${index + 2} is not valid JSON`);
    }
  });
  return { header, events };
}

function verifyLedger(ledger, { witness, requireWitness = false } = {}) {
  const { header, policy, contract } = validateLedgerHeader(ledger.header);
  if (!Array.isArray(ledger.events)) ledgerError('ledger.events must be an array');
  if (requireWitness && !witness) {
    throw new OwnerKernelError('external witness adapter is required to verify this ledger', 'WITNESS_REQUIRED');
  }
  let state = makeInitialState(header);
  for (const event of ledger.events) {
    verifyEvent(event, {
      header: { ...header, event_count: state.sequence },
      previousEventHash: state.event_head,
      previousWitnessHead: state.witness_head,
      witness,
    });
    state = applyEvent(state, event, policy);
  }
  return {
    header,
    policy,
    contract,
    state,
    state_projection: stateProjection(state),
    state_projection_hash: sha256(canonicalJson(stateProjection(state))),
    event_count: ledger.events.length,
    witness_verified: Boolean(witness),
  };
}

function replayFromLatestCheckpoint(ledger, verified = null) {
  const verification = verified || verifyLedger(ledger);
  const checkpointIndex = ledger.events.reduce((latest, event, index) => (
    event.type === 'checkpoint' ? index : latest
  ), -1);
  if (checkpointIndex < 0) {
    return {
      state: cloneCanonical(verification.state),
      checkpoint_sequence: null,
      replayed_event_count: ledger.events.length,
    };
  }
  const checkpoint = ledger.events[checkpointIndex];
  let state = cloneCanonical(checkpoint.payload.state_projection);
  state = applyEvent(state, checkpoint, verification.policy);
  for (const event of ledger.events.slice(checkpointIndex + 1)) {
    state = applyEvent(state, event, verification.policy);
  }
  if (canonicalJson(stateProjection(state)) !== canonicalJson(verification.state_projection)) {
    ledgerError('checkpoint resume projection diverges from full raw replay');
  }
  return {
    state,
    checkpoint_sequence: checkpoint.sequence,
    replayed_event_count: ledger.events.length - checkpointIndex - 1,
  };
}

module.exports = {
  HEADER_RECORD_TYPE,
  LEDGER_SCHEMA_VERSION,
  createLedgerHeader,
  parseLedgerJsonl,
  replayFromLatestCheckpoint,
  serializeLedger,
  validateLedgerHeader,
  verifyLedger,
};
