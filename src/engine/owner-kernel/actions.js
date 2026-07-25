'use strict';

const path = require('path');

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');

const ACTION_CLASS_RANK = Object.freeze({
  read_only: 1,
  reversible: 2,
  external: 3,
  irreversible: 4,
});
const ACTION_CLASSES = new Set(Object.keys(ACTION_CLASS_RANK));
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_EXECUTION_PERMIT_SECONDS = 300;
const MAX_BROKER_AUTHORIZATION_LENGTH = 8192;
const CANCELLATION_STATES = new Set(['revoked', 'not_started', 'completed', 'unknown']);

function actionError(message, code = 'INVALID_ACTION_AUTHORITY') {
  throw new OwnerKernelError(message, code);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    actionError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    actionError(`${label} must be a plain data object`);
  }
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) actionError(`${label} has unsupported key "${key}"`);
  }
}

function requireOwnProperties(value, properties, label) {
  for (const property of properties) {
    if (!Object.prototype.hasOwnProperty.call(value, property)) {
      actionError(`${label} is missing required property "${property}"`);
    }
  }
}

function assertIndependentAuthorityBindings(bindings, {
  label = 'action authority',
  code = 'ACTION_AUTHORITY_INDEPENDENCE_REQUIRED',
} = {}) {
  const identities = new Map();
  const attestations = new Map();
  for (const { role, binding } of bindings) {
    if (identities.has(binding.identity)) {
      actionError(
        `${label} requires independently identified ${role} and ${identities.get(binding.identity)}`,
        code,
      );
    }
    identities.set(binding.identity, role);
    if (attestations.has(binding.attestation_hash)) {
      actionError(
        `${label} requires independently attested ${role} and ${attestations.get(binding.attestation_hash)}`,
        code,
      );
    }
    attestations.set(binding.attestation_hash, role);
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    actionError(`${label} must match ${TOKEN_PATTERN}`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    actionError(`${label} must be a positive integer`);
  }
  return value;
}

function requireActionClass(value, label) {
  if (typeof value !== 'string' || !ACTION_CLASSES.has(value)) {
    actionError(`${label} must be one of ${Array.from(ACTION_CLASSES).join(', ')}`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    actionError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function requireOpaqueAuthorization(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0
    || value.length > MAX_BROKER_AUTHORIZATION_LENGTH) {
    actionError(`${label} must be a non-empty opaque authorization string no longer than ${MAX_BROKER_AUTHORIZATION_LENGTH} characters`, 'HOST_CAPABILITY_BLOCKED');
  }
  return value;
}

function normalizeStringSet(raw, label, { allowEmpty = true, token = true } = {}) {
  if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0)) {
    actionError(`${label} must be ${allowEmpty ? 'an array' : 'a non-empty array'}`);
  }
  const values = raw.map((value, index) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      actionError(`${label}[${index}] must be a non-empty string`);
    }
    if (token) requireToken(value, `${label}[${index}]`);
    return value;
  });
  const sorted = Array.from(new Set(values)).sort();
  if (sorted.length !== values.length) actionError(`${label} must not contain duplicates`);
  return sorted;
}

function normalizeEnumeratedTargets(raw, label) {
  const targets = normalizeStringSet(raw, label, { allowEmpty: false, token: false });
  for (const target of targets) {
    if (target.includes('*') || target.includes('?')) {
      actionError(`${label} must be an exact enumerable target set; wildcard patterns are unsupported`, 'ACTION_CLASSIFICATION_BLOCKED');
    }
  }
  return targets;
}

function normalizeActionCatalog(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) actionError('governance.action_catalog must be an array');
  const ids = new Set();
  const operations = new Set();
  const normalized = raw.map((item, index) => {
    const value = requireObject(item, `governance.action_catalog[${index}]`);
    rejectUnknownKeys(value, new Set([
      'id',
      'operation',
      'tool_class',
      'action_class',
      'command_required',
      'requires_mediator',
      'requires_challenge',
    ]), `governance.action_catalog[${index}]`);
    const entry = {
      id: requireToken(value.id, `governance.action_catalog[${index}].id`),
      operation: requireToken(value.operation, `governance.action_catalog[${index}].operation`),
      tool_class: requireToken(value.tool_class, `governance.action_catalog[${index}].tool_class`),
      action_class: requireActionClass(value.action_class, `governance.action_catalog[${index}].action_class`),
      command_required: value.command_required === true,
      requires_mediator: value.requires_mediator === true,
      requires_challenge: value.requires_challenge === true,
    };
    if (value.command_required !== undefined && typeof value.command_required !== 'boolean') {
      actionError(`governance.action_catalog[${index}].command_required must be boolean`);
    }
    if (value.requires_mediator !== undefined && typeof value.requires_mediator !== 'boolean') {
      actionError(`governance.action_catalog[${index}].requires_mediator must be boolean`);
    }
    if (value.requires_challenge !== undefined && typeof value.requires_challenge !== 'boolean') {
      actionError(`governance.action_catalog[${index}].requires_challenge must be boolean`);
    }
    if (ids.has(entry.id)) actionError(`governance.action_catalog has duplicate id "${entry.id}"`);
    const operationKey = `${entry.operation}\u0000${entry.tool_class}`;
    if (operations.has(operationKey)) {
      actionError(`governance.action_catalog has duplicate operation/tool_class "${entry.operation}/${entry.tool_class}"`);
    }
    ids.add(entry.id);
    operations.add(operationKey);
    return entry;
  });
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function findCatalogEntry(policy, operation, toolClass) {
  const catalog = Array.isArray(policy.action_catalog) ? policy.action_catalog : [];
  return catalog.find((entry) => entry.operation === operation && entry.tool_class === toolClass) || null;
}

function normalizeActionDescriptor(policy, raw, { declaredActionClass = null } = {}) {
  const value = requireObject(raw, 'action descriptor');
  rejectUnknownKeys(value, new Set(['operation', 'tool_class', 'command', 'targets']), 'action descriptor');
  const operation = requireToken(value.operation, 'action descriptor.operation');
  const toolClass = requireToken(value.tool_class, 'action descriptor.tool_class');
  const catalog = findCatalogEntry(policy, operation, toolClass);
  if (!catalog) {
    actionError('action descriptor is not classified by the frozen action catalog', 'ACTION_CLASSIFICATION_BLOCKED');
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    actionError('action descriptor.targets must be a non-empty enumerable array', 'ACTION_CLASSIFICATION_BLOCKED');
  }
  const targets = normalizeEnumeratedTargets(value.targets, 'action descriptor.targets');
  if (value.command !== undefined && (typeof value.command !== 'string' || value.command.trim().length === 0)) {
    actionError('action descriptor.command must be a non-empty string when present');
  }
  if (catalog.command_required && value.command === undefined) {
    actionError('action descriptor.command is required by the frozen action catalog', 'ACTION_CLASSIFICATION_BLOCKED');
  }
  const declared = declaredActionClass === null || declaredActionClass === undefined
    ? catalog.action_class
    : requireActionClass(declaredActionClass, 'declared action class');
  if (ACTION_CLASS_RANK[declared] < ACTION_CLASS_RANK[catalog.action_class]) {
    actionError('owner-declared action class cannot lower the frozen catalog risk class', 'ACTION_CLASS_DOWNGRADE');
  }
  const descriptor = {
    catalog_id: catalog.id,
    operation,
    tool_class: toolClass,
    action_class: declared,
    targets,
    target_set_hash: sha256(canonicalJson(targets)),
    ...(value.command === undefined ? {} : { command_hash: sha256(value.command) }),
  };
  return normalizeFrozenActionDescriptor(policy, descriptor);
}

function normalizeFrozenActionDescriptor(policy, raw) {
  const value = requireObject(raw, 'frozen action descriptor');
  rejectUnknownKeys(value, new Set([
    'catalog_id',
    'operation',
    'tool_class',
    'action_class',
    'targets',
    'target_set_hash',
    'command_hash',
  ]), 'frozen action descriptor');
  const operation = requireToken(value.operation, 'frozen action descriptor.operation');
  const toolClass = requireToken(value.tool_class, 'frozen action descriptor.tool_class');
  const catalog = findCatalogEntry(policy, operation, toolClass);
  if (!catalog || value.catalog_id !== catalog.id) {
    actionError('frozen action descriptor does not match the frozen action catalog', 'ACTION_CLASSIFICATION_BLOCKED');
  }
  const actionClass = requireActionClass(value.action_class, 'frozen action descriptor.action_class');
  if (ACTION_CLASS_RANK[actionClass] < ACTION_CLASS_RANK[catalog.action_class]) {
    actionError('frozen action descriptor cannot lower the frozen catalog risk class', 'ACTION_CLASS_DOWNGRADE');
  }
  const targets = normalizeEnumeratedTargets(value.targets, 'frozen action descriptor.targets');
  if (canonicalJson(targets) !== canonicalJson(value.targets)) {
    actionError('frozen action descriptor.targets must be canonically sorted');
  }
  const targetSetHash = sha256(canonicalJson(targets));
  if (value.target_set_hash !== targetSetHash) {
    actionError('frozen action descriptor.target_set_hash does not match targets');
  }
  if (catalog.command_required && !isSha256(value.command_hash)) {
    actionError('frozen action descriptor.command_hash is required by the frozen action catalog');
  }
  if (value.command_hash !== undefined && !isSha256(value.command_hash)) {
    actionError('frozen action descriptor.command_hash must be a SHA-256 digest when present');
  }
  return cloneCanonical({
    catalog_id: catalog.id,
    operation,
    tool_class: toolClass,
    action_class: actionClass,
    targets,
    target_set_hash: targetSetHash,
    ...(value.command_hash === undefined ? {} : { command_hash: value.command_hash.toLowerCase() }),
  });
}

function actionDescriptorHash(descriptor) {
  return sha256(canonicalJson(descriptor));
}

function actionMatchesDescriptor(policy, expectedDescriptor, observedAction) {
  const observed = normalizeActionDescriptor(policy, observedAction, {
    declaredActionClass: expectedDescriptor.action_class,
  });
  return canonicalJson(observed) === canonicalJson(expectedDescriptor);
}

function normalizeBroker(raw) {
  if (raw === null || raw === undefined) return null;
  const value = requireObject(raw, 'host capability broker');
  rejectUnknownKeys(value, new Set([
    'kind',
    'identity',
    'worker_uid',
    'broker_uid',
    'receipt_root',
    'permit_revocation',
    'attestation_hash',
    'protocol_version',
  ]), 'host capability broker');
  requireOwnProperties(value, [
    'kind',
    'identity',
    'worker_uid',
    'broker_uid',
    'receipt_root',
    'permit_revocation',
    'attestation_hash',
    'protocol_version',
  ], 'host capability broker');
  if (value.kind !== 'external-broker') {
    actionError('host capability broker.kind must be external-broker');
  }
  if (!Number.isInteger(value.worker_uid) || !Number.isInteger(value.broker_uid)
    || value.worker_uid < 0 || value.broker_uid < 0 || value.worker_uid === value.broker_uid) {
    actionError('host capability broker must use distinct non-negative worker_uid and broker_uid');
  }
  if (typeof value.receipt_root !== 'string' || value.receipt_root.length === 0 || !value.receipt_root.startsWith('/')) {
    actionError('host capability broker.receipt_root must be an absolute non-empty path');
  }
  const receiptRoot = path.posix.normalize(value.receipt_root);
  if (receiptRoot !== value.receipt_root || receiptRoot === '/') {
    actionError('host capability broker.receipt_root must be a canonical non-root absolute path');
  }
  if (value.permit_revocation !== true) {
    actionError('host capability broker.permit_revocation must be true for an enforceable broker route', 'HOST_CAPABILITY_BLOCKED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('host capability broker.attestation_hash must be a SHA-256 digest', 'HOST_CAPABILITY_BLOCKED');
  }
  if (value.protocol_version !== 1) {
    actionError('host capability broker.protocol_version must equal 1', 'HOST_CAPABILITY_BLOCKED');
  }
  return {
    kind: 'external-broker',
    identity: requireToken(value.identity, 'host capability broker.identity'),
    worker_uid: value.worker_uid,
    broker_uid: value.broker_uid,
    receipt_root: receiptRoot,
    permit_revocation: true,
    attestation_hash: value.attestation_hash.toLowerCase(),
    protocol_version: 1,
  };
}

function normalizeHostCapability(raw) {
  const value = requireObject(raw, 'host capability');
  rejectUnknownKeys(value, new Set([
    'schema_version',
    'tier',
    'probe_id',
    'probed_at',
    'expires_at',
    'preventive_action_ids',
    'audited_action_ids',
    'mediated_action_ids',
    'broker',
  ]), 'host capability');
  requireOwnProperties(value, [
    'schema_version',
    'tier',
    'probe_id',
    'probed_at',
    'expires_at',
  ], 'host capability');
  if (value.schema_version !== 1) actionError('host capability.schema_version must equal 1');
  if (!['full', 'partial', 'none'].includes(value.tier)) {
    actionError('host capability.tier must be full, partial, or none');
  }
  const normalized = {
    schema_version: 1,
    tier: value.tier,
    probe_id: requireToken(value.probe_id, 'host capability.probe_id'),
    probed_at: requireIsoTimestamp(value.probed_at, 'host capability.probed_at'),
    expires_at: requireIsoTimestamp(value.expires_at, 'host capability.expires_at'),
    preventive_action_ids: normalizeStringSet(value.preventive_action_ids || [], 'host capability.preventive_action_ids'),
    audited_action_ids: normalizeStringSet(value.audited_action_ids || [], 'host capability.audited_action_ids'),
    mediated_action_ids: normalizeStringSet(value.mediated_action_ids || [], 'host capability.mediated_action_ids'),
    broker: normalizeBroker(value.broker),
  };
  if (new Date(normalized.expires_at).getTime() <= new Date(normalized.probed_at).getTime()) {
    actionError('host capability.expires_at must be later than probed_at');
  }
  if (normalized.tier === 'none' && (
    normalized.preventive_action_ids.length > 0
    || normalized.audited_action_ids.length > 0
    || normalized.mediated_action_ids.length > 0
    || normalized.broker !== null
  )) {
    actionError('none-tier host capability cannot advertise preventive, audit, or broker controls');
  }
  if (normalized.mediated_action_ids.length > 0 && normalized.broker === null) {
    actionError('mediated action IDs require an external broker descriptor');
  }
  return cloneCanonical(normalized);
}

function normalizeExecutionPermit(raw, {
  runId,
  witnessStreamId,
  witnessBindingHash,
  authorityHash,
  claimId,
  preActionWitnessHead,
  hostCapabilityHash,
  actionDescriptorHash,
  executorBindingHash,
  audienceIdentity,
  hostCapabilityVerifierBinding,
  now,
} = {}) {
  const value = requireObject(raw, 'host execution permit');
  rejectUnknownKeys(value, new Set([
    'permit_id',
    'run_id',
    'witness_stream_id',
    'witness_binding_hash',
    'authority_hash',
    'claim_id',
    'pre_action_witness_head',
    'host_capability_hash',
    'action_descriptor_hash',
    'executor_binding_hash',
    'audience_identity',
    'expires_at',
    'attestation_hash',
    'issuer',
    'issuer_attestation_hash',
    'preclaim_authorization',
  ]), 'host execution permit');
  requireOwnProperties(value, [
    'permit_id',
    'run_id',
    'witness_stream_id',
    'witness_binding_hash',
    'authority_hash',
    'claim_id',
    'pre_action_witness_head',
    'host_capability_hash',
    'action_descriptor_hash',
    'executor_binding_hash',
    'audience_identity',
    'expires_at',
    'attestation_hash',
    'issuer',
    'issuer_attestation_hash',
    'preclaim_authorization',
  ], 'host execution permit');
  if (value.run_id !== runId || value.witness_stream_id !== witnessStreamId
    || value.witness_binding_hash !== witnessBindingHash
    || value.authority_hash !== authorityHash || value.claim_id !== claimId
    || value.pre_action_witness_head !== preActionWitnessHead
    || value.host_capability_hash !== hostCapabilityHash
    || value.action_descriptor_hash !== actionDescriptorHash
    || value.executor_binding_hash !== executorBindingHash
    || value.audience_identity !== audienceIdentity) {
    actionError('host execution permit is not bound to the active run, witness, authority, claim, capability, action, executor, and audience', 'HOST_CAPABILITY_BLOCKED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('host execution permit.attestation_hash must be a SHA-256 digest', 'HOST_CAPABILITY_BLOCKED');
  }
  const verifierBinding = normalizeFrozenHostCapabilityVerifierBinding(hostCapabilityVerifierBinding);
  if (value.issuer !== verifierBinding.identity
    || value.issuer_attestation_hash !== verifierBinding.attestation_hash) {
    actionError('host execution permit issuer must exactly match the intake-frozen host capability verifier', 'HOST_CAPABILITY_BLOCKED');
  }
  const expiresAt = requireIsoTimestamp(value.expires_at, 'host execution permit.expires_at');
  const nowMillis = new Date(now).getTime();
  const expiresMillis = new Date(expiresAt).getTime();
  if (expiresMillis <= nowMillis || expiresMillis > nowMillis + (MAX_EXECUTION_PERMIT_SECONDS * 1000)) {
    actionError(`host execution permit must expire within ${MAX_EXECUTION_PERMIT_SECONDS} seconds`, 'HOST_CAPABILITY_BLOCKED');
  }
  return cloneCanonical({
    permit_id: requireToken(value.permit_id, 'host execution permit.permit_id'),
    run_id: runId,
    witness_stream_id: witnessStreamId,
    witness_binding_hash: witnessBindingHash,
    authority_hash: authorityHash,
    claim_id: claimId,
    pre_action_witness_head: preActionWitnessHead,
    host_capability_hash: hostCapabilityHash,
    action_descriptor_hash: actionDescriptorHash,
    executor_binding_hash: executorBindingHash,
    audience_identity: audienceIdentity,
    expires_at: expiresAt,
    attestation_hash: value.attestation_hash.toLowerCase(),
    issuer: verifierBinding.identity,
    issuer_attestation_hash: verifierBinding.attestation_hash,
    preclaim_authorization: requireOpaqueAuthorization(value.preclaim_authorization, 'host execution permit.preclaim_authorization'),
  });
}

function normalizeExecutionAuthorization(raw, {
  runId,
  witnessStreamId,
  witnessBindingHash,
  authorityHash,
  claimId,
  claimEventHash,
  claimWitnessHead,
  claimEmittedAt,
  executionPermit,
  executionPermitHash,
  hostCapabilityHash,
  actionDescriptorHash,
  executorBindingHash,
  audienceIdentity,
  hostCapabilityVerifierBinding,
  now,
} = {}) {
  const value = requireObject(raw, 'host execution authorization');
  rejectUnknownKeys(value, new Set([
    'authorization_id',
    'run_id',
    'witness_stream_id',
    'witness_binding_hash',
    'authority_hash',
    'claim_id',
    'claim_event_hash',
    'claim_witness_head',
    'claim_emitted_at',
    'execution_permit_id',
    'execution_permit_hash',
    'host_capability_hash',
    'action_descriptor_hash',
    'executor_binding_hash',
    'audience_identity',
    'issued_at',
    'expires_at',
    'attestation_hash',
    'issuer',
    'issuer_attestation_hash',
    'authorization',
  ]), 'host execution authorization');
  requireOwnProperties(value, [
    'authorization_id',
    'run_id',
    'witness_stream_id',
    'witness_binding_hash',
    'authority_hash',
    'claim_id',
    'claim_event_hash',
    'claim_witness_head',
    'claim_emitted_at',
    'execution_permit_id',
    'execution_permit_hash',
    'host_capability_hash',
    'action_descriptor_hash',
    'executor_binding_hash',
    'audience_identity',
    'issued_at',
    'expires_at',
    'attestation_hash',
    'issuer',
    'issuer_attestation_hash',
    'authorization',
  ], 'host execution authorization');
  if (value.run_id !== runId || value.witness_stream_id !== witnessStreamId
    || value.witness_binding_hash !== witnessBindingHash
    || value.authority_hash !== authorityHash || value.claim_id !== claimId
    || value.claim_event_hash !== claimEventHash || value.claim_witness_head !== claimWitnessHead
    || value.claim_emitted_at !== claimEmittedAt
    || value.execution_permit_id !== executionPermit.permit_id
    || value.execution_permit_hash !== executionPermitHash
    || value.host_capability_hash !== hostCapabilityHash
    || value.action_descriptor_hash !== actionDescriptorHash
    || value.executor_binding_hash !== executorBindingHash
    || value.audience_identity !== audienceIdentity) {
    actionError('host execution authorization is not bound to the exact witnessed claim and preclaim permit', 'HOST_CAPABILITY_BLOCKED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('host execution authorization.attestation_hash must be a SHA-256 digest', 'HOST_CAPABILITY_BLOCKED');
  }
  const verifierBinding = normalizeFrozenHostCapabilityVerifierBinding(hostCapabilityVerifierBinding);
  if (value.issuer !== verifierBinding.identity
    || value.issuer_attestation_hash !== verifierBinding.attestation_hash) {
    actionError('host execution authorization issuer must exactly match the intake-frozen host capability verifier', 'HOST_CAPABILITY_BLOCKED');
  }
  const expiresAt = requireIsoTimestamp(value.expires_at, 'host execution authorization.expires_at');
  const issuedAt = requireIsoTimestamp(value.issued_at, 'host execution authorization.issued_at');
  if (new Date(issuedAt).getTime() < new Date(claimEmittedAt).getTime()
    || new Date(issuedAt).getTime() >= new Date(expiresAt).getTime()) {
    actionError('host execution authorization.issued_at must be earlier than expires_at', 'HOST_CAPABILITY_BLOCKED');
  }
  const nowMillis = new Date(now).getTime();
  const issuedMillis = new Date(issuedAt).getTime();
  const expiresMillis = new Date(expiresAt).getTime();
  const permitExpiresMillis = new Date(executionPermit.expires_at).getTime();
  if (issuedMillis > nowMillis || expiresMillis <= nowMillis || expiresMillis > permitExpiresMillis) {
    actionError('host execution authorization must be live and cannot outlive its preclaim permit', 'HOST_CAPABILITY_BLOCKED');
  }
  return cloneCanonical({
    authorization_id: requireToken(value.authorization_id, 'host execution authorization.authorization_id'),
    run_id: runId,
    witness_stream_id: witnessStreamId,
    witness_binding_hash: witnessBindingHash,
    authority_hash: authorityHash,
    claim_id: claimId,
    claim_event_hash: claimEventHash,
    claim_witness_head: claimWitnessHead,
    claim_emitted_at: claimEmittedAt,
    execution_permit_id: executionPermit.permit_id,
    execution_permit_hash: executionPermitHash,
    host_capability_hash: hostCapabilityHash,
    action_descriptor_hash: actionDescriptorHash,
    executor_binding_hash: executorBindingHash,
    audience_identity: audienceIdentity,
    issued_at: issuedAt,
    expires_at: expiresAt,
    attestation_hash: value.attestation_hash.toLowerCase(),
    issuer: verifierBinding.identity,
    issuer_attestation_hash: verifierBinding.attestation_hash,
    authorization: requireOpaqueAuthorization(value.authorization, 'host execution authorization.authorization'),
  });
}

function validateHostCapabilityCoverage(policy, capability, now = new Date()) {
  const catalog = Array.isArray(policy.action_catalog) ? policy.action_catalog : [];
  if (capability.tier === 'none') {
    actionError('none-tier hosts cannot activate autonomous Owner Kernel action authority', 'HOST_CAPABILITY_BLOCKED');
  }
  if (new Date(capability.expires_at).getTime() <= new Date(now).getTime()) {
    actionError('host capability evidence has expired', 'HOST_CAPABILITY_BLOCKED');
  }
  const knownActionIds = new Set(catalog.map((entry) => entry.id));
  for (const actionId of [
    ...capability.preventive_action_ids,
    ...capability.audited_action_ids,
    ...capability.mediated_action_ids,
  ]) {
    if (!knownActionIds.has(actionId)) {
      actionError(`host capability references unknown frozen action ID ${actionId}`, 'HOST_CAPABILITY_BLOCKED');
    }
  }
  for (const entry of catalog) {
    const preventive = capability.preventive_action_ids.includes(entry.id)
      && capability.audited_action_ids.includes(entry.id);
    const mediated = capability.mediated_action_ids.includes(entry.id)
      && capability.broker !== null;
    // Mediation is an explicit catalog constraint, not a red-line-only default.
    // A reversible action can still require a broker-only boundary.
    if (entry.requires_mediator && !mediated) {
      actionError(`action catalog entry ${entry.id} requires an enforceable mediator-only path`, 'HOST_CAPABILITY_BLOCKED');
    }
    if (ACTION_CLASS_RANK[entry.action_class] < ACTION_CLASS_RANK.external) continue;
    if (capability.tier === 'full' && !preventive) {
      actionError(`full-tier host capability lacks complete preventive/audit coverage for ${entry.id}`, 'HOST_CAPABILITY_BLOCKED');
    }
    if (capability.tier === 'partial' && !preventive && !mediated) {
      actionError(`partial-tier host capability lacks enforceable coverage for ${entry.id}`, 'HOST_CAPABILITY_BLOCKED');
    }
  }
  return true;
}

function normalizeExecutorBrokerBinding(raw, expectedBroker, {
  allowExecute = false,
  requireExecute = false,
  allowCancel = false,
  requireCancel = false,
} = {}) {
  if (expectedBroker === null) {
    if (raw !== null && raw !== undefined) {
      actionError('action authority executor.broker is not allowed without a mediated broker capability');
    }
    return null;
  }
  const value = requireObject(raw, 'action authority executor.broker');
  rejectUnknownKeys(value, new Set([
    'identity',
    'broker_uid',
    'receipt_root',
    'attestation_hash',
    'protocol_version',
    ...(allowExecute ? ['execute'] : []),
    ...(allowCancel ? ['cancel'] : []),
  ]), 'action authority executor.broker');
  requireOwnProperties(value, [
    'identity',
    'broker_uid',
    'receipt_root',
    'attestation_hash',
    'protocol_version',
    ...(requireExecute ? ['execute'] : []),
    ...(requireCancel ? ['cancel'] : []),
  ], 'action authority executor.broker');
  if (value.identity !== expectedBroker.identity || value.broker_uid !== expectedBroker.broker_uid
    || value.receipt_root !== expectedBroker.receipt_root
    || value.attestation_hash !== expectedBroker.attestation_hash
    || value.protocol_version !== expectedBroker.protocol_version) {
    actionError('action authority executor.broker must exactly bind the frozen external broker', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (requireExecute && typeof value.execute !== 'function') {
    actionError('action authority executor.broker requires execute()', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (requireCancel && typeof value.cancel !== 'function') {
    actionError('action authority executor.broker requires cancel()', 'ACTION_EXECUTOR_REQUIRED');
  }
  return cloneCanonical({
    identity: expectedBroker.identity,
    broker_uid: expectedBroker.broker_uid,
    receipt_root: expectedBroker.receipt_root,
    attestation_hash: expectedBroker.attestation_hash,
    protocol_version: expectedBroker.protocol_version,
  });
}

function normalizeFrozenExecutorBinding(raw, expectedBroker) {
  const value = requireObject(raw, 'frozen executor binding');
  rejectUnknownKeys(value, new Set([
    'identity',
    'trust_tier',
    'attestation_hash',
    'worker_uid',
    'broker',
  ]), 'frozen executor binding');
  requireOwnProperties(value, [
    'identity',
    'trust_tier',
    'attestation_hash',
    'broker',
    ...(expectedBroker === null ? [] : ['worker_uid']),
  ], 'frozen executor binding');
  if (value.trust_tier !== 'external' && value.trust_tier !== 'test') {
    actionError('frozen executor binding.trust_tier must be external or test', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('frozen executor binding.attestation_hash must be a SHA-256 digest', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (expectedBroker !== null
    && (!Number.isInteger(value.worker_uid) || value.worker_uid < 0 || value.worker_uid !== expectedBroker.worker_uid)) {
    actionError('frozen executor binding.worker_uid must match the broker-separated worker UID', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (expectedBroker === null && Object.prototype.hasOwnProperty.call(value, 'worker_uid')) {
    actionError('frozen executor binding.worker_uid is only allowed with a broker-separated capability', 'ACTION_EXECUTOR_REQUIRED');
  }
  return cloneCanonical({
    identity: requireToken(value.identity, 'frozen executor binding.identity'),
    trust_tier: value.trust_tier,
    attestation_hash: value.attestation_hash.toLowerCase(),
    ...(expectedBroker === null ? {} : { worker_uid: expectedBroker.worker_uid }),
    broker: normalizeExecutorBrokerBinding(value.broker, expectedBroker),
  });
}

function normalizeHostCapabilityVerifier(raw, { allowTestExecutor = false } = {}) {
  const value = requireObject(raw, 'action authority host_capability_verifier');
  rejectUnknownKeys(value, new Set([
    'identity',
    'trustTier',
    'attestation_hash',
    'probe',
  ]), 'action authority host_capability_verifier');
  requireOwnProperties(value, ['identity', 'trustTier', 'attestation_hash', 'probe'], 'action authority host_capability_verifier');
  const trustTier = value.trustTier;
  if (trustTier !== 'external' && !(allowTestExecutor && trustTier === 'test')) {
    actionError('action host_capability_verifier must be external; test verifiers require explicit allowTestActionExecutor', 'HOST_CAPABILITY_BLOCKED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('action host_capability_verifier.attestation_hash must be a SHA-256 digest', 'HOST_CAPABILITY_BLOCKED');
  }
  if (typeof value.probe !== 'function') {
    actionError('action host_capability_verifier requires probe()', 'HOST_CAPABILITY_BLOCKED');
  }
  const binding = cloneCanonical({
    identity: requireToken(value.identity, 'action host_capability_verifier.identity'),
    trust_tier: trustTier,
    attestation_hash: value.attestation_hash.toLowerCase(),
  });
  return {
    binding,
    binding_hash: sha256(canonicalJson(binding)),
    probe: value.probe,
  };
}

function normalizeFrozenHostCapabilityVerifierBinding(raw) {
  const value = requireObject(raw, 'frozen host capability verifier binding');
  rejectUnknownKeys(value, new Set(['identity', 'trust_tier', 'attestation_hash']), 'frozen host capability verifier binding');
  requireOwnProperties(value, ['identity', 'trust_tier', 'attestation_hash'], 'frozen host capability verifier binding');
  if (value.trust_tier !== 'external' && value.trust_tier !== 'test') {
    actionError('frozen host capability verifier binding.trust_tier must be external or test', 'HOST_CAPABILITY_BLOCKED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('frozen host capability verifier binding.attestation_hash must be a SHA-256 digest', 'HOST_CAPABILITY_BLOCKED');
  }
  return cloneCanonical({
    identity: requireToken(value.identity, 'frozen host capability verifier binding.identity'),
    trust_tier: value.trust_tier,
    attestation_hash: value.attestation_hash.toLowerCase(),
  });
}

function normalizeReceiptVerifier(raw, { allowTestExecutor = false } = {}) {
  const value = requireObject(raw, 'action authority receipt_verifier');
  rejectUnknownKeys(value, new Set([
    'identity',
    'trustTier',
    'attestation_hash',
    'verify',
  ]), 'action authority receipt_verifier');
  requireOwnProperties(value, ['identity', 'trustTier', 'attestation_hash', 'verify'], 'action authority receipt_verifier');
  const trustTier = value.trustTier;
  if (trustTier !== 'external' && !(allowTestExecutor && trustTier === 'test')) {
    actionError('action receipt_verifier must be external; test verifiers require explicit allowTestActionExecutor', 'ACTION_RECEIPT_VERIFIER_REQUIRED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('action receipt_verifier.attestation_hash must be a SHA-256 digest', 'ACTION_RECEIPT_VERIFIER_REQUIRED');
  }
  if (typeof value.verify !== 'function') {
    actionError('action receipt_verifier requires verify()', 'ACTION_RECEIPT_VERIFIER_REQUIRED');
  }
  const binding = cloneCanonical({
    identity: requireToken(value.identity, 'action receipt_verifier.identity'),
    trust_tier: trustTier,
    attestation_hash: value.attestation_hash.toLowerCase(),
  });
  return {
    binding,
    binding_hash: sha256(canonicalJson(binding)),
    verify: value.verify,
  };
}

function normalizeFrozenReceiptVerifierBinding(raw) {
  const value = requireObject(raw, 'frozen receipt verifier binding');
  rejectUnknownKeys(value, new Set(['identity', 'trust_tier', 'attestation_hash']), 'frozen receipt verifier binding');
  requireOwnProperties(value, ['identity', 'trust_tier', 'attestation_hash'], 'frozen receipt verifier binding');
  if (value.trust_tier !== 'external' && value.trust_tier !== 'test') {
    actionError('frozen receipt verifier binding.trust_tier must be external or test', 'ACTION_RECEIPT_VERIFIER_REQUIRED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('frozen receipt verifier binding.attestation_hash must be a SHA-256 digest', 'ACTION_RECEIPT_VERIFIER_REQUIRED');
  }
  return cloneCanonical({
    identity: requireToken(value.identity, 'frozen receipt verifier binding.identity'),
    trust_tier: value.trust_tier,
    attestation_hash: value.attestation_hash.toLowerCase(),
  });
}

function normalizeActionAuthority(policy, raw, { allowTestExecutor = false, now = new Date() } = {}) {
  const value = requireObject(raw, 'action authority');
  rejectUnknownKeys(value, new Set([
    'host_capability',
    'host_capability_verifier',
    'receipt_verifier',
    'executor',
  ]), 'action authority');
  requireOwnProperties(value, [
    'host_capability',
    'host_capability_verifier',
    'receipt_verifier',
    'executor',
  ], 'action authority');
  if (!Array.isArray(policy.action_catalog) || policy.action_catalog.length === 0) {
    actionError('action authority requires a non-empty frozen action catalog', 'ACTION_CLASSIFICATION_BLOCKED');
  }
  const capability = normalizeHostCapability(value.host_capability);
  validateHostCapabilityCoverage(policy, capability, now);
  const hostCapabilityVerifier = normalizeHostCapabilityVerifier(value.host_capability_verifier, { allowTestExecutor });
  const receiptVerifier = normalizeReceiptVerifier(value.receipt_verifier, { allowTestExecutor });
  const executor = requireObject(value.executor, 'action authority executor');
  rejectUnknownKeys(executor, new Set([
    'identity',
    'trustTier',
    'attestation_hash',
    'worker_uid',
    'broker',
    'execute',
    'cancel',
  ]), 'action authority executor');
  const brokered = capability.broker !== null;
  requireOwnProperties(executor, [
    'identity',
    'trustTier',
    'attestation_hash',
    ...(brokered ? ['worker_uid', 'broker'] : ['execute', 'cancel']),
  ], 'action authority executor');
  const trustTier = executor.trustTier;
  if (trustTier !== 'external' && !(allowTestExecutor && trustTier === 'test')) {
    actionError('action authority executor must be external; test executors require explicit allowTestExecutor', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (!brokered && typeof executor.execute !== 'function') {
    actionError('action authority without a broker requires executor.execute()', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (!brokered && typeof executor.cancel !== 'function') {
    actionError('action authority without a broker requires executor.cancel()', 'ACTION_EXECUTOR_REQUIRED');
  }
  if (brokered && executor.execute !== undefined) {
    actionError('brokered action authority must not expose executor.execute(); use executor.broker.execute()', 'ACTION_EXECUTOR_REQUIRED');
  }
  const executorBinding = {
    identity: requireToken(executor.identity, 'action authority executor.identity'),
    trust_tier: trustTier,
    attestation_hash: (() => {
      if (!isSha256(executor.attestation_hash)) {
        actionError('action authority executor.attestation_hash must be a SHA-256 digest', 'ACTION_EXECUTOR_REQUIRED');
      }
      return executor.attestation_hash.toLowerCase();
    })(),
    ...(brokered ? (() => {
      if (!Number.isInteger(executor.worker_uid) || executor.worker_uid < 0
        || executor.worker_uid !== capability.broker.worker_uid) {
        actionError('action authority executor.worker_uid must match the broker-separated worker UID', 'ACTION_EXECUTOR_REQUIRED');
      }
      return { worker_uid: capability.broker.worker_uid };
    })() : {}),
    broker: normalizeExecutorBrokerBinding(
      executor.broker === undefined ? null : executor.broker,
      capability.broker,
      {
        allowExecute: brokered,
        requireExecute: brokered,
        allowCancel: brokered,
        requireCancel: brokered,
      },
    ),
  };
  const normalizedBinding = normalizeFrozenExecutorBinding(executorBinding, capability.broker);
  assertIndependentAuthorityBindings([
    { role: 'host capability verifier', binding: hostCapabilityVerifier.binding },
    { role: 'executor', binding: normalizedBinding },
    { role: 'receipt verifier', binding: receiptVerifier.binding },
    ...(capability.broker === null ? [] : [{ role: 'broker', binding: capability.broker }]),
  ], { label: 'action authority' });
  return {
    capability,
    capability_hash: sha256(canonicalJson(capability)),
    host_capability_verifier_binding: hostCapabilityVerifier.binding,
    host_capability_verifier_binding_hash: hostCapabilityVerifier.binding_hash,
    executor_binding: normalizedBinding,
    executor_binding_hash: sha256(canonicalJson(normalizedBinding)),
    receipt_verifier_binding: receiptVerifier.binding,
    receipt_verifier_binding_hash: receiptVerifier.binding_hash,
    host_capability_probe: hostCapabilityVerifier.probe,
    receipt_verifier: receiptVerifier.verify,
    executor: {
      ...normalizedBinding,
      ...(brokered
        ? {
          broker: {
            ...normalizedBinding.broker,
            execute: executor.broker.execute,
            cancel: executor.broker.cancel,
          },
        }
        : {
          execute: executor.execute,
          cancel: executor.cancel,
        }),
    },
  };
}

function normalizeReceiptReference(raw, label = 'action receipt') {
  const value = requireObject(raw, label);
  rejectUnknownKeys(value, new Set(['uri', 'sha256']), label);
  requireOwnProperties(value, ['uri', 'sha256'], label);
  if (typeof value.uri !== 'string' || value.uri.length === 0) {
    actionError(`${label}.uri must be a non-empty string`);
  }
  if (!isSha256(value.sha256)) actionError(`${label}.sha256 must be a SHA-256 digest`);
  return {
    uri: value.uri,
    sha256: value.sha256.toLowerCase(),
  };
}

function receiptIsWithinBrokerRoot(receipt, broker) {
  if (broker === null) return true;
  let parsed;
  try {
    parsed = new URL(receipt.uri);
  } catch (_error) {
    return false;
  }
  if (parsed.protocol !== 'file:' || parsed.host !== '') return false;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch (_error) {
    return false;
  }
  const normalizedPath = path.posix.normalize(decodedPath);
  return normalizedPath.startsWith(`${broker.receipt_root}/`);
}

function normalizeBrokerReceipt(raw, broker, label) {
  if (broker === null) {
    if (raw !== null && raw !== undefined) actionError(`${label}.broker is not allowed for an unmediated action`);
    return null;
  }
  const value = requireObject(raw, `${label}.broker`);
  rejectUnknownKeys(value, new Set(['identity', 'broker_uid']), `${label}.broker`);
  requireOwnProperties(value, ['identity', 'broker_uid'], `${label}.broker`);
  if (value.identity !== broker.identity || value.broker_uid !== broker.broker_uid) {
    actionError(`${label}.broker does not match the frozen external broker`, 'ACTION_RECONCILIATION_FAILED');
  }
  return { identity: broker.identity, broker_uid: broker.broker_uid };
}

function normalizeActionExecutionResult(_policy, _expectedDescriptor, raw, {
  broker = null,
  executionPermitHash,
  executionAuthorizationHash,
  authorizationId,
  claimEventHash,
  claimWitnessHead,
  authorizationIssuedAt,
  authorizationExpiresAt,
  boundaryAttestationHash,
  now,
} = {}) {
  const value = requireObject(raw, 'action executor result');
  rejectUnknownKeys(value, new Set([
    'receipt',
    'broker',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'claim_event_hash',
    'claim_witness_head',
    'permit_state',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
  ]), 'action executor result');
  requireOwnProperties(value, [
    'receipt',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'claim_event_hash',
    'claim_witness_head',
    'permit_state',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
  ], 'action executor result');
  if (!isSha256(executionPermitHash) || value.execution_permit_hash !== executionPermitHash) {
    actionError('action executor result does not bind the active host execution permit', 'ACTION_RECONCILIATION_FAILED');
  }
  if (!isSha256(executionAuthorizationHash) || value.execution_authorization_hash !== executionAuthorizationHash
    || value.authorization_id !== authorizationId || value.claim_event_hash !== claimEventHash
    || value.claim_witness_head !== claimWitnessHead) {
    actionError('action executor result does not bind the exact witnessed claim and one-shot execution authorization', 'ACTION_RECONCILIATION_FAILED');
  }
  if (value.permit_state !== 'consumed') {
    actionError('action executor result must attest that the broker/executor atomically consumed the execution authorization', 'ACTION_RECONCILIATION_FAILED');
  }
  const effectAt = requireIsoTimestamp(value.effect_at, 'action executor result.effect_at');
  const reconciledAt = requireIsoTimestamp(now, 'action executor result reconciliation time');
  if (new Date(effectAt).getTime() < new Date(authorizationIssuedAt).getTime()
    || new Date(effectAt).getTime() >= new Date(authorizationExpiresAt).getTime()
    || new Date(effectAt).getTime() > new Date(reconciledAt).getTime()) {
    actionError('action executor result records a side effect outside the execution authorization validity window', 'ACTION_RECONCILIATION_FAILED');
  }
  if (!isSha256(boundaryAttestationHash) || value.boundary_attestation_hash !== boundaryAttestationHash) {
    actionError('action executor result does not bind the intake-frozen broker/executor attestation', 'ACTION_RECONCILIATION_FAILED');
  }
  const receipt = normalizeReceiptReference(value.receipt, 'action executor result.receipt');
  const brokerReceipt = normalizeBrokerReceipt(value.broker === undefined ? null : value.broker, broker, 'action executor result');
  if (!receiptIsWithinBrokerRoot(receipt, broker)) {
    actionError('action executor receipt must live beneath the frozen broker receipt root', 'ACTION_RECONCILIATION_FAILED');
  }
  return cloneCanonical({
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    execution_permit_hash: executionPermitHash,
    execution_authorization_hash: executionAuthorizationHash,
    authorization_id: authorizationId,
    claim_event_hash: claimEventHash,
    claim_witness_head: claimWitnessHead,
    permit_state: 'consumed',
    boundary_effect_id: requireToken(value.boundary_effect_id, 'action executor result.boundary_effect_id'),
    boundary_state_version: requirePositiveInteger(value.boundary_state_version, 'action executor result.boundary_state_version'),
    boundary_attestation_hash: boundaryAttestationHash,
    effect_at: effectAt,
  });
}

function normalizeActionCancellationResult(raw, {
  broker = null,
  runId,
  claimId,
  executionPermitId,
  executionPermitHash,
  executionAuthorizationHash,
  authorizationId,
  cancellationRequestHash,
  boundaryAttestationHash,
  authorizationIssuedAt = null,
  authorizationExpiresAt = null,
  now,
} = {}) {
  const value = requireObject(raw, 'action cancellation acknowledgement');
  rejectUnknownKeys(value, new Set([
    'ok',
    'run_id',
    'claim_id',
    'execution_permit_id',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'cancellation_request_hash',
    'state',
    'receipt',
    'broker',
    'boundary_effect_id',
    'boundary_state_version',
    'attestation_hash',
    'received_at',
    'effect_at',
  ]), 'action cancellation acknowledgement');
  requireOwnProperties(value, [
    'ok',
    'run_id',
    'claim_id',
    'execution_permit_id',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'cancellation_request_hash',
    'state',
    'receipt',
    'boundary_effect_id',
    'boundary_state_version',
    'attestation_hash',
    'received_at',
    'effect_at',
  ], 'action cancellation acknowledgement');
  if (value.ok !== true || value.run_id !== runId || value.claim_id !== claimId
    || value.execution_permit_id !== executionPermitId
    || value.execution_permit_hash !== executionPermitHash
    || value.execution_authorization_hash !== executionAuthorizationHash
    || value.authorization_id !== authorizationId
    || value.cancellation_request_hash !== cancellationRequestHash) {
    actionError('action cancellation acknowledgement is not bound to the active run, claim, authorization, and cancellation request', 'ACTION_RECONCILIATION_FAILED');
  }
  if (!CANCELLATION_STATES.has(value.state)) {
    actionError('action cancellation acknowledgement.state is invalid', 'ACTION_RECONCILIATION_FAILED');
  }
  if (!isSha256(value.attestation_hash)) {
    actionError('action cancellation acknowledgement.attestation_hash must be a SHA-256 digest', 'ACTION_RECONCILIATION_FAILED');
  }
  if (!isSha256(boundaryAttestationHash) || value.attestation_hash !== boundaryAttestationHash) {
    actionError('action cancellation acknowledgement does not bind the intake-frozen broker/executor attestation', 'ACTION_RECONCILIATION_FAILED');
  }
  const receipt = normalizeReceiptReference(value.receipt, 'action cancellation acknowledgement.receipt');
  if (!receiptIsWithinBrokerRoot(receipt, broker)) {
    actionError('action cancellation acknowledgement receipt must live beneath the frozen broker receipt root', 'ACTION_RECONCILIATION_FAILED');
  }
  const brokerReceipt = normalizeBrokerReceipt(
    value.broker === undefined ? null : value.broker,
    broker,
    'action cancellation acknowledgement',
  );
  const boundaryEffectId = value.boundary_effect_id === null || value.boundary_effect_id === undefined
    ? null
    : requireToken(value.boundary_effect_id, 'action cancellation acknowledgement.boundary_effect_id');
  if (value.state === 'completed' && boundaryEffectId === null) {
    actionError('completed cancellation acknowledgements require boundary_effect_id', 'ACTION_RECONCILIATION_FAILED');
  }
  const effectAt = value.effect_at === null
    ? null
    : requireIsoTimestamp(value.effect_at, 'action cancellation acknowledgement.effect_at');
  if (value.state === 'completed') {
    if (!isSha256(executionAuthorizationHash) || typeof authorizationId !== 'string'
      || authorizationId.length === 0 || authorizationIssuedAt === null || authorizationExpiresAt === null) {
      actionError('completed cancellation acknowledgements require a post-claim execution authorization', 'ACTION_RECONCILIATION_FAILED');
    }
    const issuedAt = requireIsoTimestamp(
      authorizationIssuedAt,
      'action cancellation acknowledgement authorization issued_at',
    );
    const expiresAt = requireIsoTimestamp(
      authorizationExpiresAt,
      'action cancellation acknowledgement authorization expires_at',
    );
    const reconciledAt = requireIsoTimestamp(now, 'action cancellation acknowledgement reconciliation time');
    if (effectAt === null || new Date(effectAt).getTime() < new Date(issuedAt).getTime()
      || new Date(effectAt).getTime() >= new Date(expiresAt).getTime()
      || new Date(effectAt).getTime() > new Date(reconciledAt).getTime()) {
      actionError('completed cancellation acknowledgement records an effect outside the execution authorization validity window', 'ACTION_RECONCILIATION_FAILED');
    }
  } else if (effectAt !== null) {
    actionError('non-completed cancellation acknowledgements must not claim an effect timestamp', 'ACTION_RECONCILIATION_FAILED');
  }
  return cloneCanonical({
    request_hash: cancellationRequestHash,
    state: value.state,
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: requirePositiveInteger(
      value.boundary_state_version,
      'action cancellation acknowledgement.boundary_state_version',
    ),
    attestation_hash: value.attestation_hash.toLowerCase(),
    received_at: requireIsoTimestamp(value.received_at, 'action cancellation acknowledgement.received_at'),
    effect_at: effectAt,
  });
}

function normalizeVerifiedActionOutcome(policy, expectedDescriptor, raw, {
  runId,
  claimId,
  executorBindingHash,
  executionPermitHash,
  executionAuthorizationHash,
  authorizationId,
  claimEventHash,
  claimWitnessHead,
  receipt,
  broker = null,
  boundaryAttestationHash,
  now,
} = {}) {
  const value = requireObject(raw, 'action receipt verifier result');
  rejectUnknownKeys(value, new Set([
    'ok',
    'run_id',
    'claim_id',
    'executor_binding_hash',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'claim_event_hash',
    'claim_witness_head',
    'permit_state',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
    'status',
    'receipt',
    'broker',
    'observed_action',
    'error_code',
  ]), 'action receipt verifier result');
  requireOwnProperties(value, [
    'ok',
    'run_id',
    'claim_id',
    'executor_binding_hash',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'claim_event_hash',
    'claim_witness_head',
    'permit_state',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
    'status',
    'receipt',
  ], 'action receipt verifier result');
  if (value.ok !== true || value.run_id !== runId || value.claim_id !== claimId
    || value.executor_binding_hash !== executorBindingHash) {
    actionError('action receipt verifier result is not bound to the active run, claim, and executor', 'ACTION_RECEIPT_UNVERIFIED');
  }
  if (!isSha256(executionPermitHash) || value.execution_permit_hash !== executionPermitHash) {
    actionError('action receipt verifier result does not bind the active host execution permit', 'ACTION_RECEIPT_UNVERIFIED');
  }
  if (!isSha256(executionAuthorizationHash) || value.execution_authorization_hash !== executionAuthorizationHash
    || value.authorization_id !== authorizationId || value.claim_event_hash !== claimEventHash
    || value.claim_witness_head !== claimWitnessHead || value.permit_state !== 'consumed') {
    actionError('action receipt verifier result does not bind the exact witnessed claim and atomically consumed execution authorization', 'ACTION_RECEIPT_UNVERIFIED');
  }
  if (value.status !== 'succeeded' && value.status !== 'failed') {
    actionError('action receipt verifier result.status must be succeeded or failed', 'ACTION_OUTCOME_INVALID');
  }
  const verifiedReceipt = normalizeReceiptReference(value.receipt, 'action receipt verifier result.receipt');
  if (canonicalJson(verifiedReceipt) !== canonicalJson(receipt.receipt_ref)) {
    actionError('action receipt verifier result does not bind the executor receipt', 'ACTION_RECEIPT_UNVERIFIED');
  }
  const brokerReceipt = normalizeBrokerReceipt(
    value.broker === undefined ? null : value.broker,
    broker,
    'action receipt verifier result',
  );
  if (canonicalJson(brokerReceipt) !== canonicalJson(receipt.broker_receipt)) {
    actionError('action receipt verifier result does not bind the executor broker receipt', 'ACTION_RECEIPT_UNVERIFIED');
  }
  const effectAt = requireIsoTimestamp(value.effect_at, 'action receipt verifier result.effect_at');
  const reconciledAt = requireIsoTimestamp(now, 'action receipt verifier result reconciliation time');
  if (effectAt !== receipt.effect_at
    || value.boundary_effect_id !== receipt.boundary_effect_id
    || value.boundary_state_version !== receipt.boundary_state_version
    || value.boundary_attestation_hash !== receipt.boundary_attestation_hash
    || value.boundary_attestation_hash !== boundaryAttestationHash
    || new Date(effectAt).getTime() > new Date(reconciledAt).getTime()) {
    actionError('action receipt verifier result does not bind the executor boundary effect record', 'ACTION_RECEIPT_UNVERIFIED');
  }
  let observedDescriptor = null;
  if (value.observed_action !== null && value.observed_action !== undefined) {
    observedDescriptor = normalizeActionDescriptor(policy, value.observed_action, {
      declaredActionClass: expectedDescriptor.action_class,
    });
    if (canonicalJson(observedDescriptor) !== canonicalJson(expectedDescriptor)) {
      actionError('verified receipt does not reconcile to the authorized action descriptor', 'ACTION_RECONCILIATION_FAILED');
    }
  } else if (value.status === 'succeeded') {
    actionError('successful verified outcomes require observed_action', 'ACTION_RECONCILIATION_FAILED');
  }
  if (value.error_code !== undefined && value.error_code !== null) {
    requireToken(value.error_code, 'action receipt verifier result.error_code');
  }
  return cloneCanonical({
    outcome: value.status,
    receipt_ref: verifiedReceipt,
    broker_receipt: brokerReceipt,
    executor_binding_hash: executorBindingHash,
    execution_permit_hash: executionPermitHash,
    execution_authorization_hash: executionAuthorizationHash,
    authorization_id: authorizationId,
    claim_event_hash: claimEventHash,
    claim_witness_head: claimWitnessHead,
    permit_state: 'consumed',
    boundary_effect_id: receipt.boundary_effect_id,
    boundary_state_version: receipt.boundary_state_version,
    boundary_attestation_hash: boundaryAttestationHash,
    effect_at: effectAt,
    observed_action_descriptor_hash: observedDescriptor === null
      ? null
      : actionDescriptorHash(observedDescriptor),
    ...(value.error_code === undefined || value.error_code === null ? {} : { error_code: value.error_code }),
  });
}

module.exports = {
  ACTION_CLASS_RANK,
  assertIndependentAuthorityBindings,
  actionDescriptorHash,
  actionMatchesDescriptor,
  findCatalogEntry,
  normalizeActionCancellationResult,
  normalizeActionExecutionResult,
  normalizeActionAuthority,
  normalizeActionCatalog,
  normalizeActionDescriptor,
  normalizeFrozenActionDescriptor,
  normalizeFrozenExecutorBinding,
  normalizeFrozenHostCapabilityVerifierBinding,
  normalizeFrozenReceiptVerifierBinding,
  normalizeExecutionAuthorization,
  normalizeExecutionPermit,
  normalizeHostCapability,
  normalizeVerifiedActionOutcome,
  receiptIsWithinBrokerRoot,
  validateHostCapabilityCoverage,
};
