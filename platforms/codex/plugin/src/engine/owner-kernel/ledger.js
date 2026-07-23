'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const {
  assertIndependentAuthorityBindings,
  normalizeFrozenExecutorBinding,
  normalizeFrozenHostCapabilityVerifierBinding,
  normalizeFrozenReceiptVerifierBinding,
  normalizeHostCapability,
  validateHostCapabilityCoverage,
} = require('./actions');
const { OwnerKernelError } = require('./errors');
const { verifyEvent } = require('./events');
const { freezeAcceptanceContract, resolveGovernancePolicy } = require('./policy');
const { makeInitialState, applyEvent, stateProjection } = require('./state');
const { normalizeWitnessBinding } = require('./witness');

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
      ...(Object.prototype.hasOwnProperty.call(policy, 'action_catalog')
        ? { action_catalog: policy.action_catalog }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'max_recover_cycles')
        ? { max_recover_cycles: policy.max_recover_cycles }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'max_delegate_per_decision')
        ? { max_delegate_per_decision: policy.max_delegate_per_decision }
        : {}),
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
  const legacyPolicy = !Object.prototype.hasOwnProperty.call(policy, 'action_catalog')
    && !Object.prototype.hasOwnProperty.call(policy, 'max_recover_cycles')
    && !Object.prototype.hasOwnProperty.call(policy, 'max_delegate_per_decision');
  const expectedPolicy = legacyPolicy
    ? (() => {
      const copy = cloneCanonical(resolved.policy);
      delete copy.action_catalog;
      delete copy.max_recover_cycles;
      delete copy.max_delegate_per_decision;
      return copy;
    })()
    : resolved.policy;
  if (policy.mode_source !== expectedPolicy.mode_source
    || canonicalJson(policy) !== canonicalJson(expectedPolicy)) {
    ledgerError('header.policy is not the canonical resolved policy');
  }
  const normalizedPolicy = cloneCanonical(policy);
  return {
    policy: normalizedPolicy,
    policy_hash: sha256(canonicalJson(normalizedPolicy)),
  };
}

function normalizeAuthorityHeader(raw) {
  if (raw === undefined || raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) ledgerError('ledger authority must be an object');
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    ledgerError('ledger authority must be a plain data object');
  }
  const allowed = new Set([
    'schema_version',
    'host_capability',
    'host_capability_hash',
    'host_capability_verifier_binding',
    'host_capability_verifier_binding_hash',
    'executor_binding',
    'executor_binding_hash',
    'receipt_verifier_binding',
    'receipt_verifier_binding_hash',
    'witness_binding',
    'witness_binding_hash',
    'intake_observation_hash',
    'intake_probe_nonce_commitment',
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) ledgerError(`ledger authority has unsupported key "${key}"`);
  }
  if (raw.schema_version !== 1) ledgerError('ledger authority.schema_version must equal 1');
  const capability = normalizeHostCapability(raw.host_capability);
  const capabilityHash = sha256(canonicalJson(capability));
  if (raw.host_capability_hash !== capabilityHash) {
    ledgerError('ledger authority host_capability_hash does not match host_capability');
  }
  let hostCapabilityVerifierBinding;
  try {
    hostCapabilityVerifierBinding = normalizeFrozenHostCapabilityVerifierBinding(raw.host_capability_verifier_binding);
  } catch (error) {
    ledgerError(`ledger authority host capability verifier binding is invalid: ${error.message}`);
  }
  const hostCapabilityVerifierBindingHash = sha256(canonicalJson(hostCapabilityVerifierBinding));
  if (raw.host_capability_verifier_binding_hash !== hostCapabilityVerifierBindingHash) {
    ledgerError('ledger authority host_capability_verifier_binding_hash does not match host_capability_verifier_binding');
  }
  let executorBinding;
  try {
    executorBinding = normalizeFrozenExecutorBinding(raw.executor_binding, capability.broker);
  } catch (error) {
    ledgerError(`ledger authority executor binding is invalid: ${error.message}`);
  }
  const executorBindingHash = sha256(canonicalJson(executorBinding));
  if (raw.executor_binding_hash !== executorBindingHash) {
    ledgerError('ledger authority executor_binding_hash does not match executor_binding');
  }
  let receiptVerifierBinding;
  try {
    receiptVerifierBinding = normalizeFrozenReceiptVerifierBinding(raw.receipt_verifier_binding);
  } catch (error) {
    ledgerError(`ledger authority receipt verifier binding is invalid: ${error.message}`);
  }
  const receiptVerifierBindingHash = sha256(canonicalJson(receiptVerifierBinding));
  if (raw.receipt_verifier_binding_hash !== receiptVerifierBindingHash) {
    ledgerError('ledger authority receipt_verifier_binding_hash does not match receipt_verifier_binding');
  }
  let witnessBinding;
  try {
    witnessBinding = normalizeWitnessBinding(raw.witness_binding);
  } catch (error) {
    ledgerError(`ledger authority witness binding is invalid: ${error.message}`);
  }
  const witnessBindingHash = sha256(canonicalJson(witnessBinding));
  if (raw.witness_binding_hash !== witnessBindingHash) {
    ledgerError('ledger authority witness_binding_hash does not match witness_binding');
  }
  try {
    assertIndependentAuthorityBindings([
      { role: 'host capability verifier', binding: hostCapabilityVerifierBinding },
      { role: 'executor', binding: executorBinding },
      { role: 'receipt verifier', binding: receiptVerifierBinding },
      { role: 'witness', binding: witnessBinding },
      ...(capability.broker === null ? [] : [{ role: 'broker', binding: capability.broker }]),
    ], { label: 'ledger authority' });
  } catch (error) {
    ledgerError(error.message);
  }
  if (!isSha256(raw.intake_observation_hash)) {
    ledgerError('ledger authority intake_observation_hash must be a SHA-256 digest');
  }
  if (!isSha256(raw.intake_probe_nonce_commitment)) {
    ledgerError('ledger authority intake_probe_nonce_commitment must be a SHA-256 digest');
  }
  const normalized = {
    schema_version: 1,
    host_capability: capability,
    host_capability_hash: capabilityHash,
    host_capability_verifier_binding: hostCapabilityVerifierBinding,
    host_capability_verifier_binding_hash: hostCapabilityVerifierBindingHash,
    executor_binding: executorBinding,
    executor_binding_hash: executorBindingHash,
    receipt_verifier_binding: receiptVerifierBinding,
    receipt_verifier_binding_hash: receiptVerifierBindingHash,
    witness_binding: witnessBinding,
    witness_binding_hash: witnessBindingHash,
    intake_observation_hash: raw.intake_observation_hash.toLowerCase(),
    intake_probe_nonce_commitment: raw.intake_probe_nonce_commitment.toLowerCase(),
  };
  if (canonicalJson(raw) !== canonicalJson(normalized)) {
    ledgerError('ledger authority is not canonical');
  }
  return cloneCanonical(normalized);
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
  authority = null,
}) {
  validateRunId(runId);
  if (typeof witnessStreamId !== 'string' || witnessStreamId.length === 0) {
    ledgerError('witnessStreamId must be a non-empty string');
  }
  if (!isSha256(capabilityNonceCommitment)) ledgerError('capabilityNonceCommitment must be a SHA-256 digest');
  validateCreatedAt(createdAt);
  const normalizedPolicy = normalizeFrozenPolicy(policy);
  const normalizedContract = freezeAcceptanceContract(contract);
  const normalizedAuthority = normalizeAuthorityHeader(authority);
  const actionCatalog = Array.isArray(normalizedPolicy.policy.action_catalog)
    ? normalizedPolicy.policy.action_catalog
    : [];
  if (actionCatalog.length > 0 && normalizedAuthority === null) {
    ledgerError('a non-empty action catalog requires a ledger authority');
  }
  if (actionCatalog.length === 0 && normalizedAuthority !== null) {
    ledgerError('a ledger authority is not allowed when the action catalog is empty');
  }
  if (normalizedAuthority !== null) {
    try {
      validateHostCapabilityCoverage(normalizedPolicy.policy, normalizedAuthority.host_capability, new Date(createdAt));
    } catch (error) {
      ledgerError(`ledger authority host capability coverage is invalid: ${error.message}`);
    }
  }
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
    ...(normalizedAuthority === null ? {} : {
      authority: normalizedAuthority,
      authority_hash: sha256(canonicalJson(normalizedAuthority)),
    }),
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
    'authority',
    'authority_hash',
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
  if (Object.prototype.hasOwnProperty.call(header, 'authority') && header.authority === null) {
    ledgerError('ledger header authority must be omitted when action authority is absent');
  }
  const authority = normalizeAuthorityHeader(header.authority);
  const actionCatalog = Array.isArray(policy.policy.action_catalog) ? policy.policy.action_catalog : [];
  if (actionCatalog.length > 0 && authority === null) {
    ledgerError('a non-empty action catalog requires a ledger authority');
  }
  if (actionCatalog.length === 0 && authority !== null) {
    ledgerError('a ledger authority is not allowed when the action catalog is empty');
  }
  if (authority === null) {
    if (Object.prototype.hasOwnProperty.call(header, 'authority_hash')) {
      ledgerError('ledger header authority_hash must be omitted when action authority is absent');
    }
  } else {
    const authorityHash = sha256(canonicalJson(authority));
    if (!Object.prototype.hasOwnProperty.call(header, 'authority_hash')
      || header.authority_hash !== authorityHash) {
      ledgerError('ledger header authority_hash does not match authority');
    }
    try {
      validateHostCapabilityCoverage(policy.policy, authority.host_capability, new Date(header.created_at));
    } catch (error) {
      ledgerError(`ledger authority host capability coverage is invalid: ${error.message}`);
    }
  }
  if (header.policy_hash !== policy.policy_hash || header.contract_hash !== contract.contract_hash) {
    ledgerError('ledger header policy or contract hash does not match frozen data');
  }
  return {
    header: cloneCanonical(header),
    policy: policy.policy,
    contract: contract.contract,
    authority,
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
  if (header.authority && witness) {
    let witnessBinding;
    try {
      witnessBinding = normalizeWitnessBinding(witness);
    } catch (error) {
      ledgerError(`authority ledger witness binding is invalid: ${error.message}`);
    }
    if (sha256(canonicalJson(witnessBinding)) !== header.authority.witness_binding_hash) {
      ledgerError('verification witness does not exactly match the intake-frozen authority binding');
    }
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
