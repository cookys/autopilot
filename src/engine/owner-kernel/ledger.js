'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const {
  assertSynchronousCoordinatorVerification,
  normalizeAcceptanceAuthority,
  normalizeAcceptanceAuthorityHeader,
} = require('./acceptance');
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
const {
  createSemanticAuthorityHeader,
  normalizeSemanticAuthorityHeader,
} = require('./semantic-authority');
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
      ...(Object.prototype.hasOwnProperty.call(policy, 'red_lines')
        ? { red_lines: policy.red_lines }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'assurance_profile')
        ? { assurance_profile: policy.assurance_profile }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'guidance_profile')
        ? { guidance_profile: policy.guidance_profile }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'topology_preference')
        ? { topology_preference: policy.topology_preference }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(policy, 'data_egress')
        ? { data_egress: policy.data_egress }
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
  const p2Fields = ['action_catalog', 'max_recover_cycles', 'max_delegate_per_decision'];
  const p3Fields = ['red_lines', 'assurance_profile'];
  const p4Fields = ['guidance_profile', 'topology_preference', 'data_egress'];
  const hasAll = (fields) => fields.every((field) => Object.prototype.hasOwnProperty.call(policy, field));
  const hasAny = (fields) => fields.some((field) => Object.prototype.hasOwnProperty.call(policy, field));
  const hasP2Shape = hasAll(p2Fields);
  const hasP3Shape = hasAll(p3Fields);
  const hasP4Shape = hasAll(p4Fields);
  if (hasAny(p2Fields) && !hasP2Shape) {
    ledgerError('header.policy has a partial P2 action/recovery field set');
  }
  if (hasAny(p3Fields) && !hasP3Shape) {
    ledgerError('header.policy has a partial P3 governance field set');
  }
  if (hasAny(p4Fields) && !hasP4Shape) {
    ledgerError('header.policy has a partial P4 execution-profile field set');
  }
  if (hasP4Shape && !hasP3Shape) {
    ledgerError('header.policy cannot include P4 execution-profile fields without P3 governance fields');
  }

  const expectedPolicy = cloneCanonical(resolved.policy);
  if (!hasP2Shape) {
    // P1 headers predate both the P2 action/recovery controls and the P3
    // governance controls. Do not permit a mixed historical/current shape.
    if (hasP3Shape) ledgerError('legacy header.policy cannot include P3 governance fields');
    for (const field of [...p2Fields, ...p3Fields, ...p4Fields]) delete expectedPolicy[field];
  } else if (!hasP3Shape) {
    // P2 headers are otherwise canonical, but predate these two P3 fields.
    for (const field of [...p3Fields, ...p4Fields]) delete expectedPolicy[field];
  } else if (!hasP4Shape) {
    for (const field of p4Fields) delete expectedPolicy[field];
  }
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

function assertAcceptanceHeaderIndependence(authority, acceptanceAuthority) {
  if (acceptanceAuthority === null) return;
  const bindings = [
    { role: 'acceptance coordinator', binding: acceptanceAuthority.binding },
    { role: 'witness', binding: acceptanceAuthority.witness_binding },
  ];
  if (authority !== null) {
    bindings.push(
      { role: 'host capability verifier', binding: authority.host_capability_verifier_binding },
      { role: 'executor', binding: authority.executor_binding },
      { role: 'receipt verifier', binding: authority.receipt_verifier_binding },
      ...(authority.host_capability.broker === null ? [] : [{ role: 'broker', binding: authority.host_capability.broker }]),
    );
  }
  try {
    assertIndependentAuthorityBindings(bindings, { label: 'ledger acceptance coordinator binding' });
  } catch (error) {
    ledgerError(error.message);
  }
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
  acceptanceAuthority = null,
  semanticAuthority = null,
  witness = null,
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
  const normalizedAcceptanceAuthority = normalizeAcceptanceAuthorityHeader(acceptanceAuthority);
  const normalizedSemanticAuthority = semanticAuthority === null
    ? null
    : createSemanticAuthorityHeader(semanticAuthority, witness);
  if (normalizedSemanticAuthority !== null
    && (normalizedSemanticAuthority.route.run_id !== runId
      || normalizedSemanticAuthority.route.policy_hash !== policyHash
      || normalizedSemanticAuthority.route.contract_hash !== contractHash)) {
    ledgerError('semantic authority route does not match the frozen run, policy, and contract');
  }
  const actionCatalog = Array.isArray(normalizedPolicy.policy.action_catalog)
    ? normalizedPolicy.policy.action_catalog
    : [];
  if (actionCatalog.length > 0 && normalizedAuthority === null) {
    ledgerError('a non-empty action catalog requires a ledger authority');
  }
  if (actionCatalog.length === 0 && normalizedAuthority !== null) {
    ledgerError('a ledger authority is not allowed when the action catalog is empty');
  }
  if (actionCatalog.some((entry) => entry.requires_challenge)
    && normalizedContract.contract.schema_version !== 2) {
    ledgerError('challenge-required catalog actions require a schema_version 2 acceptance protocol');
  }
  if (normalizedContract.contract.schema_version === 2 && normalizedAcceptanceAuthority === null) {
    ledgerError('a schema_version 2 acceptance contract requires an acceptance authority');
  }
  if (normalizedContract.contract.schema_version === 1 && normalizedAcceptanceAuthority !== null) {
    ledgerError('an acceptance authority is only allowed for a schema_version 2 acceptance contract');
  }
  if (normalizedAuthority !== null && normalizedAcceptanceAuthority !== null
    && normalizedAuthority.witness_binding_hash !== normalizedAcceptanceAuthority.witness_binding_hash) {
    ledgerError('action and acceptance authorities must bind the same witness identity and attestation');
  }
  const authorityWitnessHashes = [
    normalizedAuthority && normalizedAuthority.witness_binding_hash,
    normalizedAcceptanceAuthority && normalizedAcceptanceAuthority.witness_binding_hash,
    normalizedSemanticAuthority && normalizedSemanticAuthority.witness_binding_hash,
  ].filter(Boolean);
  if (new Set(authorityWitnessHashes).size > 1) {
    ledgerError('semantic, action, and acceptance authorities must bind the same witness identity');
  }
  if (normalizedSemanticAuthority !== null
    && (actionCatalog.length !== 0
      || normalizedAuthority !== null
      || normalizedAcceptanceAuthority !== null
      || normalizedContract.contract.schema_version !== 1)) {
    ledgerError('semantic-only authority requires an empty catalog, schema_version 1 contract, and no effect or acceptance authority');
  }
  assertAcceptanceHeaderIndependence(normalizedAuthority, normalizedAcceptanceAuthority);
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
    ...(normalizedAcceptanceAuthority === null ? {} : {
      acceptance_authority: normalizedAcceptanceAuthority,
      acceptance_authority_hash: sha256(canonicalJson(normalizedAcceptanceAuthority)),
    }),
    ...(normalizedSemanticAuthority === null ? {} : {
      semantic_authority: normalizedSemanticAuthority,
      semantic_authority_hash: sha256(canonicalJson(normalizedSemanticAuthority)),
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
    'acceptance_authority',
    'acceptance_authority_hash',
    'semantic_authority',
    'semantic_authority_hash',
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
  const acceptanceAuthority = normalizeAcceptanceAuthorityHeader(header.acceptance_authority);
  const semanticAuthority = normalizeSemanticAuthorityHeader(header.semantic_authority);
  const actionCatalog = Array.isArray(policy.policy.action_catalog) ? policy.policy.action_catalog : [];
  if (actionCatalog.length > 0 && authority === null) {
    ledgerError('a non-empty action catalog requires a ledger authority');
  }
  if (actionCatalog.length === 0 && authority !== null) {
    ledgerError('a ledger authority is not allowed when the action catalog is empty');
  }
  if (contract.contract.schema_version === 2 && acceptanceAuthority === null) {
    ledgerError('a schema_version 2 acceptance contract requires an acceptance authority');
  }
  if (contract.contract.schema_version === 1 && acceptanceAuthority !== null) {
    ledgerError('an acceptance authority is only allowed for a schema_version 2 acceptance contract');
  }
  if (authority !== null && acceptanceAuthority !== null
    && authority.witness_binding_hash !== acceptanceAuthority.witness_binding_hash) {
    ledgerError('action and acceptance authorities must bind the same witness identity and attestation');
  }
  const authorityWitnessHashes = [
    authority && authority.witness_binding_hash,
    acceptanceAuthority && acceptanceAuthority.witness_binding_hash,
    semanticAuthority && semanticAuthority.witness_binding_hash,
  ].filter(Boolean);
  if (new Set(authorityWitnessHashes).size > 1) {
    ledgerError('semantic, action, and acceptance authorities must bind the same witness identity');
  }
  if (semanticAuthority !== null
    && (semanticAuthority.route.run_id !== header.run_id
      || semanticAuthority.route.policy_hash !== header.policy_hash
      || semanticAuthority.route.contract_hash !== header.contract_hash)) {
    ledgerError('semantic authority route does not match the frozen run, policy, and contract');
  }
  if (semanticAuthority !== null
    && (actionCatalog.length !== 0
      || authority !== null
      || acceptanceAuthority !== null
      || contract.contract.schema_version !== 1)) {
    ledgerError('semantic-only authority requires an empty catalog, schema_version 1 contract, and no effect or acceptance authority');
  }
  assertAcceptanceHeaderIndependence(authority, acceptanceAuthority);
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
  if (acceptanceAuthority === null) {
    if (Object.prototype.hasOwnProperty.call(header, 'acceptance_authority_hash')) {
      ledgerError('ledger header acceptance_authority_hash must be omitted when acceptance authority is absent');
    }
  } else {
    const acceptanceAuthorityHash = sha256(canonicalJson(acceptanceAuthority));
    if (!Object.prototype.hasOwnProperty.call(header, 'acceptance_authority_hash')
      || header.acceptance_authority_hash !== acceptanceAuthorityHash) {
      ledgerError('ledger header acceptance_authority_hash does not match acceptance_authority');
    }
  }
  if (semanticAuthority === null) {
    if (Object.prototype.hasOwnProperty.call(header, 'semantic_authority_hash')) {
      ledgerError('ledger header semantic_authority_hash must be omitted when semantic authority is absent');
    }
  } else {
    const semanticAuthorityHash = sha256(canonicalJson(semanticAuthority));
    if (!Object.prototype.hasOwnProperty.call(header, 'semantic_authority_hash')
      || header.semantic_authority_hash !== semanticAuthorityHash) {
      ledgerError('ledger header semantic_authority_hash does not match semantic_authority');
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
    acceptanceAuthority,
    semanticAuthority,
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

function verifyLedger(ledger, {
  witness,
  requireWitness = false,
  acceptanceAuthority = null,
  allowTestAcceptanceCoordinator = false,
  allowWitnessAheadForPendingAttempt = false,
  allowUnverifiedAcceptanceProof = false,
} = {}) {
  const { header, policy, contract } = validateLedgerHeader(ledger.header);
  if (!Array.isArray(ledger.events)) ledgerError('ledger.events must be an array');
  if (requireWitness && !witness) {
    throw new OwnerKernelError('external witness adapter is required to verify this ledger', 'WITNESS_REQUIRED');
  }
  if ((header.authority || header.acceptance_authority || header.semantic_authority) && witness) {
    let witnessBinding;
    try {
      witnessBinding = normalizeWitnessBinding(witness);
    } catch (error) {
      ledgerError(`authority ledger witness binding is invalid: ${error.message}`);
    }
    const witnessBindingHash = sha256(canonicalJson(witnessBinding));
    if (header.authority && witnessBindingHash !== header.authority.witness_binding_hash) {
      ledgerError('verification witness does not exactly match the intake-frozen authority binding');
    }
    if (header.acceptance_authority
      && witnessBindingHash !== header.acceptance_authority.witness_binding_hash) {
      ledgerError('verification witness does not exactly match the intake-frozen acceptance authority binding');
    }
    if (header.semantic_authority
      && witnessBindingHash !== header.semantic_authority.witness_binding_hash) {
      ledgerError('verification witness does not exactly match the intake-frozen semantic authority binding');
    }
  }
  let verifiedAcceptanceAuthority = null;
  if (acceptanceAuthority !== null && acceptanceAuthority !== undefined) {
    try {
      verifiedAcceptanceAuthority = normalizeAcceptanceAuthority(acceptanceAuthority, {
        allowTestCoordinator: allowTestAcceptanceCoordinator,
      });
    } catch (error) {
      ledgerError(`verification acceptance coordinator is invalid: ${error.message}`);
    }
    if (!header.acceptance_authority
      || verifiedAcceptanceAuthority.binding_hash !== header.acceptance_authority.binding_hash) {
      ledgerError('verification acceptance coordinator does not exactly match the intake-frozen binding');
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
  if (state.status === 'accept') {
    ledgerError('ledger ends with an incomplete serializable acceptance batch');
  }
  const requiresCoordinatorVerification = Boolean(header.acceptance_authority
    && ledger.events.some((event) => event.type === 'acceptance' || event.type === 'acceptance_resolution'));
  const acceptanceProofVerified = !requiresCoordinatorVerification
    || Boolean(witness && verifiedAcceptanceAuthority);
  if (requiresCoordinatorVerification && !witness && !allowUnverifiedAcceptanceProof) {
    ledgerError('serializable acceptance proof verification requires the authoritative witness adapter');
  }
  if (requiresCoordinatorVerification && !verifiedAcceptanceAuthority && !allowUnverifiedAcceptanceProof) {
    ledgerError('serializable acceptance proof verification requires the intake-frozen acceptance coordinator');
  }
  if ((header.authority || header.acceptance_authority || header.semantic_authority) && witness) {
    if (typeof witness.getHead !== 'function') {
      ledgerError('authority verification requires witness.getHead() readback');
    }
    const authoritativeHead = witness.getHead();
    const mayBeAhead = allowWitnessAheadForPendingAttempt
      && authoritativeHead !== state.witness_head
      && (
        (header.acceptance_authority
          && state.acceptance_attempt
          && state.acceptance_attempt.status === 'pending')
        || (header.authority
          && Object.values(state.action_claims || {}).some((claim) => claim.outcome === null))
      );
    if (authoritativeHead !== state.witness_head && !mayBeAhead) {
      ledgerError('ledger is not the complete authoritative witness stream');
    }
  }
  if (header.acceptance_authority && witness) {
    if (typeof witness.getHead !== 'function') {
      ledgerError('serializable acceptance verification requires witness.getHead() readback');
    }
    if (typeof witness.verifyBatch !== 'function') {
      ledgerError('serializable acceptance verification requires witness.verifyBatch()');
    }
    for (let index = 0; index < ledger.events.length; index += 1) {
      if (ledger.events[index].type !== 'acceptance') continue;
      const complete = ledger.events[index + 1];
      if (!complete || complete.type !== 'complete'
        || !witness.verifyBatch([ledger.events[index].witness, complete.witness])) {
        ledgerError('serializable acceptance terminal receipts are not one verified atomic witness batch');
      }
      if (!verifiedAcceptanceAuthority) continue;
      const commitment = ledger.events[index].witness.coordinator_commitment;
      let commitmentVerified;
      try {
        commitmentVerified = assertSynchronousCoordinatorVerification(verifiedAcceptanceAuthority.verifyCommit({
          run_id: header.run_id,
          coordinator_binding_hash: header.acceptance_authority.binding_hash,
          attempt_id: ledger.events[index].payload.attempt_id,
          attempt_hash: ledger.events[index].payload.attempt_hash,
          transaction_id: ledger.events[index].payload.transaction_id,
          fence: ledger.events[index].payload.fence,
          expected_event_head: ledger.events[index].payload.evaluated_event_head,
          expected_witness_head: ledger.events[index].payload.evaluated_witness_head,
          expected_intent_id: ledger.events[index].payload.intent_id,
          snapshot_hash: ledger.events[index].payload.snapshot_hash,
          snapshot_at: ledger.events[index].payload.snapshot_at,
          batch: {
            batch_id: ledger.events[index].witness.batch_id,
            batch_commitment: ledger.events[index].witness.batch_commitment,
            expected_witness_head: ledger.events[index].witness.previous_witness_head,
            events: [ledger.events[index], complete].map((event) => ({
              sequence: event.sequence,
              event_hash: event.event_hash,
              type: event.type,
            })),
          },
          disposition: 'accepted',
          coordinator_commitment: commitment,
          receipts: [ledger.events[index].witness, complete.witness],
        }), 'acceptance coordinator verifyCommit()');
      } catch (error) {
        ledgerError(`serializable acceptance coordinator commit verification failed: ${error.message}`);
      }
      if (commitmentVerified !== true && (!commitmentVerified || commitmentVerified.ok !== true)) {
        ledgerError('serializable acceptance coordinator commit commitment did not verify');
      }
    }
    for (const event of ledger.events) {
      if (event.type !== 'acceptance_resolution') continue;
      if (!verifiedAcceptanceAuthority) continue;
      let resolutionVerified;
      try {
        resolutionVerified = assertSynchronousCoordinatorVerification(verifiedAcceptanceAuthority.verifyResolution({
          run_id: header.run_id,
          coordinator_binding_hash: header.acceptance_authority.binding_hash,
          attempt_id: event.payload.attempt_id,
          attempt_hash: event.payload.attempt_hash,
          disposition: event.payload.disposition,
          coordinator_resolution: event.payload.coordinator_resolution,
        }), 'acceptance coordinator verifyResolution()');
      } catch (error) {
        ledgerError(`serializable acceptance coordinator resolution verification failed: ${error.message}`);
      }
      if (resolutionVerified !== true && (!resolutionVerified || resolutionVerified.ok !== true)) {
        ledgerError('serializable acceptance coordinator resolution commitment did not verify');
      }
    }
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
    acceptance_proof_verified: acceptanceProofVerified,
    acceptance_proof_unverified: requiresCoordinatorVerification && !acceptanceProofVerified,
    witness_prefix_ahead: Boolean(header.acceptance_authority && witness
      && allowWitnessAheadForPendingAttempt
      && state.acceptance_attempt && state.acceptance_attempt.status === 'pending'
      && witness.getHead() !== state.witness_head),
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
