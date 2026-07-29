'use strict';
// P3.7 U5 installed activation contract.
// Freezes six distinct root-provisioned identities (Kernel + five P3.6 roles),
// the one fixed reversible probe, and explicit refusal of Engine sink / acceptance.
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
// Fixed reversible probe surface — must stay byte-equal to
// supervised-owner-kernel-probe-effect.js PROBE_EFFECT_* constants.
// The contract intentionally does NOT require that module: loading it pulls the
// full Owner Kernel + profile catalog graph, which is not part of the
// installed ABI surface. The effect module remains hash-pinned in the snapshot
// for the runner path; install-time ABI evaluation only needs these literals.
const PROBE_EFFECT_CATALOG_ID = 'owner-kernel-probe-toggle-v1';
const PROBE_EFFECT_OPERATION = 'owner_kernel_probe_toggle';
const PROBE_EFFECT_TOOL_CLASS = 'supervised_probe';
const PROBE_EFFECT_TARGET = 'owner-kernel-private-probe-sentinel';
const PROBE_EFFECT_RECEIPT_ROOT = '/var/lib/autopilot-production/owner-kernel-probe';
const PROBE_EFFECT_CATALOG_ENTRY = Object.freeze({
  id: PROBE_EFFECT_CATALOG_ID,
  operation: PROBE_EFFECT_OPERATION,
  tool_class: PROBE_EFFECT_TOOL_CLASS,
  action_class: 'reversible',
  command_required: false,
  requires_mediator: true,
  requires_challenge: false,
});
const INSTALLED_SCHEMA_VERSION = 1;
const INSTALLED_PROTOCOL_VERSION = 1;
const INSTALLED_PROFILE_VERSION = 1;
const INSTALLED_KIND = 'p37_installed_semantic_probe_contract';
const INSTALLED_BINDING_KIND = 'p37_installed_state_binding';
const INSTALLED_PROFILE_KIND = 'p37_installed_probe_profile';
const MAX_INSTALLED_FRAME_BYTES = 524288;
const MAX_MESSAGE_LIFETIME_MILLISECONDS = 60 * 1000;
const MAX_FUTURE_SKEW_MILLISECONDS = 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SERVICE_ROLES = Object.freeze([
  'kernel',
  'worker',
  'broker',
  'receipt_verifier',
  'witness',
  'coordinator',
]);
const SERVICE_IDENTITIES = Object.freeze({
  kernel: 'autopilot-p37i-kernel',
  worker: 'autopilot-p37i-worker',
  broker: 'autopilot-p37i-broker',
  receipt_verifier: 'autopilot-p37i-receipt-verifier',
  witness: 'autopilot-p37i-witness',
  coordinator: 'autopilot-p37i-coordinator',
});
const FIXED_PROBE = Object.freeze({
  catalog_id: PROBE_EFFECT_CATALOG_ID,
  operation: PROBE_EFFECT_OPERATION,
  tool_class: PROBE_EFFECT_TOOL_CLASS,
  target: PROBE_EFFECT_TARGET,
  receipt_root_prefix: PROBE_EFFECT_RECEIPT_ROOT,
  catalog_entry: PROBE_EFFECT_CATALOG_ENTRY,
});
const AUTHORITY_DISCLOSURE = Object.freeze({
  owner_kernel_authority: 'active',
  effect_authority: 'reversible_probe_only',
  broker_authority: 'probe_only',
  acceptance: 'not_available',
  engine_sink: 'disabled',
  acceptance_transaction: 'disabled',
});
const CRASH_OUTCOMES = Object.freeze([
  'completed',
  'failed',
  'unknown',
  'recovery_required',
]);
const KERNEL_OPERATIONS = Object.freeze([
  'run_probe',
  'capability_probe',
  'semantic_append',
  'semantic_readback',
]);
const BROKER_OPERATIONS = Object.freeze([
  'execute_probe',
  'cancel_probe',
  'mint_permit',
  'postclaim_authorize',
]);
const RECEIPT_VERIFIER_OPERATIONS = Object.freeze([
  'verify_effect',
  'verify_cancellation',
  'verify_receipt',
  // Post-verification semantic witness path (append only after effect verify).
  'semantic_append',
  'semantic_readback',
]);
const WITNESS_OPERATIONS = Object.freeze([
  'appendIfHead',
  'appendBatchIfHead',
  'getHead',
  'readback',
]);
const COORDINATOR_OPERATIONS = Object.freeze([
  'prepare',
  'cancel',
  'resolve',
]);
const FORBIDDEN_OPERATIONS = Object.freeze([
  'accept',
  'commit',
  'engine_dispatch',
  'implementation_dispatch',
  'arbitrary_execute',
]);
const INSTALLED_ENDPOINTS = Object.freeze([
  Object.freeze({
    endpoint_id: 'kernel_broker',
    sender_role: 'kernel',
    recipient_role: 'broker',
    operations: BROKER_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'kernel_receipt_verifier',
    sender_role: 'kernel',
    recipient_role: 'receipt_verifier',
    operations: RECEIPT_VERIFIER_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'receipt_verifier_witness',
    sender_role: 'receipt_verifier',
    recipient_role: 'witness',
    operations: WITNESS_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'coordinator_witness',
    sender_role: 'coordinator',
    recipient_role: 'witness',
    operations: Object.freeze(['getHead', 'readback']),
  }),
  Object.freeze({
    endpoint_id: 'receipt_verifier_coordinator',
    sender_role: 'receipt_verifier',
    recipient_role: 'coordinator',
    operations: COORDINATOR_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'worker_broker',
    sender_role: 'worker',
    recipient_role: 'broker',
    operations: Object.freeze(['mint_permit', 'postclaim_authorize', 'execute_probe', 'cancel_probe']),
  }),
]);
const SERVICE_BINDING_FIELDS = Object.freeze([
  'role',
  'identity',
  'uid',
  'gid',
  'attestation_hash',
  'cgroup_binding_hash',
]);
const INSTALLED_BINDING_FIELDS = Object.freeze([
  'schema_version',
  'kind',
  'install_binding_hash',
  'run_binding_hash',
  'installed_abi_hash',
  'durable_abi_hash',
  'cohort_id',
  'generation',
  'service_bindings',
  'snapshot_hash',
]);
const INSTALLED_ENVELOPE_FIELDS = Object.freeze([
  'schema_version',
  'protocol_version',
  'endpoint_id',
  'request_id',
  'operation',
  'sender_role',
  'sender_identity',
  'sender_attestation_hash',
  'sender_cgroup_binding_hash',
  'recipient_role',
  'recipient_identity',
  'recipient_attestation_hash',
  'recipient_cgroup_binding_hash',
  'install_binding_hash',
  'run_binding_hash',
  'installed_abi_hash',
  'cohort_id',
  'generation',
  'issued_at_ms',
  'expires_at_ms',
  'nonce_hash',
  'authentication_proof_hash',
  'payload_hash',
]);
const CALLER_CONTROLLED_KEYS = Object.freeze([
  'command',
  'path',
  'tool',
  'target',
  'catalog_row',
  'receipt_root',
  'uid',
  'gid',
  'unit',
  'cgroup',
  'identity',
  'service_identity',
  'executable',
  'argv',
  'shell',
  'cwd',
]);
function installedError(message, code = 'INVALID_INSTALLED_CONTRACT') {
  throw new OwnerKernelError(message, code);}
function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    installedError(`${label} must be a plain object`);}
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    installedError(`${label} must be a plain object`);}
  return value;}
function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    installedError(`${label} has an unexpected key set`);}
  return value;}
function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    installedError(`${label} must be a bounded protocol token`);}
  return value;}
function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    installedError(`${label} must be a lowercase SHA-256 digest`);}
  return value;}
function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    installedError(`${label} must be a positive safe integer`);}
  return value;}
function requireNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    installedError(`${label} must be a nonnegative safe integer`);}
  return value;}
function rejectCallerControlledFields(value, label, { topLevelOnly = true } = {}) {
  // Caller-controlled surfaces are rejected at the public option boundary.
  // Nested host-frozen bindings legitimately contain uid/gid/identity fields
  // that the root installer provisioned; those are not caller inputs.
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (CALLER_CONTROLLED_KEYS.includes(key)) {
      installedError(
        `${label} forbids caller-controlled field "${key}"`,
        'CALLER_CONTROLLED_FIELD_FORBIDDEN',);}}
  if (topLevelOnly) return;
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      rejectCallerControlledFields(nested, label, { topLevelOnly: true });}}}
function normalizeServiceBindings(raw) {
  const value = assertExactKeys(raw, new Set(SERVICE_ROLES), 'installed service bindings');
  const seen = new Map();
  const normalized = {};
  for (const role of SERVICE_ROLES) {
    const entry = assertExactKeys(value[role], new Set(SERVICE_BINDING_FIELDS), `installed ${role} binding`);
    if (entry.role !== role) installedError(`installed ${role} binding role is invalid`);
    const normalizedEntry = {
      role,
      identity: requireToken(entry.identity, `installed ${role} identity`),
      uid: requirePositiveInteger(entry.uid, `installed ${role} uid`),
      gid: requirePositiveInteger(entry.gid, `installed ${role} gid`),
      attestation_hash: requireSha256(entry.attestation_hash, `installed ${role} attestation_hash`),
      cgroup_binding_hash: requireSha256(entry.cgroup_binding_hash, `installed ${role} cgroup_binding_hash`),};
    for (const [field, item] of Object.entries(normalizedEntry)) {
      if (field === 'role') continue;
      const key = `${field}:${item}`;
      if (seen.has(key)) installedError(`installed ${role} ${field} duplicates ${seen.get(key)}`);
      seen.set(key, role);}
    normalized[role] = normalizedEntry;}
  return cloneCanonical(normalized);}
function getInstalledEndpoint(endpointId) {
  const endpoint = INSTALLED_ENDPOINTS.find((item) => item.endpoint_id === endpointId);
  if (!endpoint) installedError('installed endpoint is not part of the frozen topology');
  return endpoint;}
function getSupervisedOwnerKernelInstalledAbi() {
  return cloneCanonical({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: INSTALLED_KIND,
    protocol_version: INSTALLED_PROTOCOL_VERSION,
    profile_version: INSTALLED_PROFILE_VERSION,
    max_frame_bytes: MAX_INSTALLED_FRAME_BYTES,
    max_message_lifetime_milliseconds: MAX_MESSAGE_LIFETIME_MILLISECONDS,
    max_future_skew_milliseconds: MAX_FUTURE_SKEW_MILLISECONDS,
    service_roles: SERVICE_ROLES,
    service_identities: SERVICE_IDENTITIES,
    endpoints: INSTALLED_ENDPOINTS,
    binding_fields: INSTALLED_BINDING_FIELDS,
    envelope_fields: INSTALLED_ENVELOPE_FIELDS,
    kernel_operations: KERNEL_OPERATIONS,
    broker_operations: BROKER_OPERATIONS,
    receipt_verifier_operations: RECEIPT_VERIFIER_OPERATIONS,
    witness_operations: WITNESS_OPERATIONS,
    coordinator_operations: COORDINATOR_OPERATIONS,
    forbidden_operations: FORBIDDEN_OPERATIONS,
    fixed_probe: FIXED_PROBE,
    authority: AUTHORITY_DISCLOSURE,
    crash_outcomes: CRASH_OUTCOMES,
    effect_replay: 'never',
    caller_controlled_fields: 'forbidden',
  });}
function getSupervisedOwnerKernelInstalledAbiHash() {
  return sha256(canonicalJson(getSupervisedOwnerKernelInstalledAbi()));}
function normalizeInstalledBinding(raw) {
  const value = assertExactKeys(raw, new Set(INSTALLED_BINDING_FIELDS), 'installed binding');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION || value.kind !== INSTALLED_BINDING_KIND) {
    installedError('installed binding has an unsupported schema or kind');}
  const abiHash = getSupervisedOwnerKernelInstalledAbiHash();
  if (value.installed_abi_hash !== abiHash) {
    installedError('installed binding does not match the installed ABI');}
  return cloneCanonical({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: INSTALLED_BINDING_KIND,
    install_binding_hash: requireSha256(value.install_binding_hash, 'installed install_binding_hash'),
    run_binding_hash: requireSha256(value.run_binding_hash, 'installed run_binding_hash'),
    installed_abi_hash: abiHash,
    durable_abi_hash: requireSha256(value.durable_abi_hash, 'installed durable_abi_hash'),
    cohort_id: requireToken(value.cohort_id, 'installed cohort_id'),
    generation: requirePositiveInteger(value.generation, 'installed generation'),
    service_bindings: normalizeServiceBindings(value.service_bindings),
    snapshot_hash: requireSha256(value.snapshot_hash, 'installed snapshot_hash'),
  });}
function normalizeInstalledEnvelope(bindingRaw, raw, { now = () => Date.now() } = {}) {
  const binding = normalizeInstalledBinding(bindingRaw);
  const value = assertExactKeys(raw, new Set(INSTALLED_ENVELOPE_FIELDS), 'installed envelope');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION
    || value.protocol_version !== INSTALLED_PROTOCOL_VERSION) {
    installedError('installed envelope has an unsupported schema or protocol');}
  const endpoint = getInstalledEndpoint(requireToken(value.endpoint_id, 'installed endpoint_id'));
  const operation = requireToken(value.operation, 'installed operation');
  if (FORBIDDEN_OPERATIONS.includes(operation)) {
    installedError('installed operation is forbidden in U5', 'OPERATION_FORBIDDEN');}
  if (!endpoint.operations.includes(operation)) {
    installedError('installed endpoint does not allow this operation');}
  if (value.sender_role !== endpoint.sender_role || value.recipient_role !== endpoint.recipient_role) {
    installedError('installed envelope does not use the frozen role route');}
  const sender = binding.service_bindings[endpoint.sender_role];
  const recipient = binding.service_bindings[endpoint.recipient_role];
  if (value.sender_identity !== sender.identity
    || value.sender_attestation_hash !== sender.attestation_hash
    || value.sender_cgroup_binding_hash !== sender.cgroup_binding_hash
    || value.recipient_identity !== recipient.identity
    || value.recipient_attestation_hash !== recipient.attestation_hash
    || value.recipient_cgroup_binding_hash !== recipient.cgroup_binding_hash
    || value.install_binding_hash !== binding.install_binding_hash
    || value.run_binding_hash !== binding.run_binding_hash
    || value.installed_abi_hash !== binding.installed_abi_hash
    || value.cohort_id !== binding.cohort_id
    || value.generation !== binding.generation) {
    installedError('installed envelope does not match the frozen cohort binding');}
  const issuedAt = requirePositiveInteger(value.issued_at_ms, 'installed issued_at_ms');
  const expiresAt = requirePositiveInteger(value.expires_at_ms, 'installed expires_at_ms');
  const observedNow = requirePositiveInteger(now(), 'installed clock');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_MESSAGE_LIFETIME_MILLISECONDS
    || issuedAt > observedNow + MAX_FUTURE_SKEW_MILLISECONDS || expiresAt <= observedNow) {
    installedError('installed envelope is outside its clock window', 'INSTALLED_ENVELOPE_EXPIRED');}
  return cloneCanonical({
    ...value,
    request_id: requireToken(value.request_id, 'installed request_id'),
    operation,
    nonce_hash: requireSha256(value.nonce_hash, 'installed nonce_hash'),
    authentication_proof_hash: requireSha256(
      value.authentication_proof_hash,
      'installed authentication_proof_hash',
    ),
    payload_hash: requireSha256(value.payload_hash, 'installed payload_hash'),
  });}
function normalizeCrashOutcome(raw) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'outcome',
    'effect_replayed',
    'request_id',
    'reason_code',
    'audit_hash',
  ]), 'installed crash outcome');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION
    || value.kind !== 'p37_installed_crash_outcome') {
    installedError('installed crash outcome has an unsupported schema or kind');}
  if (!CRASH_OUTCOMES.includes(value.outcome)) {
    installedError('installed crash outcome is not an allowed terminal state');}
  if (value.effect_replayed !== false) {
    installedError('installed crash recovery must never replay an effect', 'EFFECT_REPLAY_FORBIDDEN');}
  if (value.outcome === 'completed' || value.outcome === 'failed') {
    // deterministic terminal outcomes remain allowed without recovery
  } else if (value.outcome !== 'unknown' && value.outcome !== 'recovery_required') {
    installedError('installed crash outcome is invalid');}
  return cloneCanonical({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: 'p37_installed_crash_outcome',
    outcome: value.outcome,
    effect_replayed: false,
    request_id: requireToken(value.request_id, 'installed crash request_id'),
    reason_code: requireToken(value.reason_code, 'installed crash reason_code'),
    audit_hash: requireSha256(value.audit_hash, 'installed crash audit_hash'),
  });}
function compileInstalledProfile(options = {}) {
  const input = assertPlainObject(options, 'compileInstalledProfile options');
  rejectCallerControlledFields(input, 'compileInstalledProfile options');
  if (input.engine_sink != null && input.engine_sink !== 'disabled') {
    installedError('U5 keeps the installed Engine sink disabled', 'ENGINE_SINK_DISABLED');}
  if (input.acceptance != null && input.acceptance !== 'not_available') {
    installedError('U5 keeps acceptance unavailable', 'ACCEPTANCE_DISABLED');}
  if (input.operation != null && input.operation !== FIXED_PROBE.operation
    && input.operation !== FIXED_PROBE.catalog_id
    && input.operation !== 'run_probe') {
    installedError('U5 only permits the fixed reversible probe operation', 'OPERATION_FORBIDDEN');}
  const binding = normalizeInstalledBinding(input.binding);
  const profile = {
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: INSTALLED_PROFILE_KIND,
    profile_version: INSTALLED_PROFILE_VERSION,
    installed_abi_hash: getSupervisedOwnerKernelInstalledAbiHash(),
    binding,
    fixed_probe: cloneCanonical(FIXED_PROBE),
    authority: cloneCanonical(AUTHORITY_DISCLOSURE),
    allowed_operation: 'run_probe',
    catalog_id: FIXED_PROBE.catalog_id,};
  profile.profile_hash = sha256(canonicalJson(profile));
  return Object.freeze(cloneCanonical(profile));}
function normalizeInstalledProfile(raw) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'profile_version',
    'installed_abi_hash',
    'binding',
    'fixed_probe',
    'authority',
    'allowed_operation',
    'catalog_id',
    'profile_hash',
  ]), 'installed profile');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION
    || value.kind !== INSTALLED_PROFILE_KIND
    || value.profile_version !== INSTALLED_PROFILE_VERSION) {
    installedError('installed profile schema, kind, or version is unsupported');}
  if (value.installed_abi_hash !== getSupervisedOwnerKernelInstalledAbiHash()) {
    installedError('installed profile does not match the installed ABI');}
  if (value.allowed_operation !== 'run_probe'
    || value.catalog_id !== FIXED_PROBE.catalog_id
    || canonicalJson(value.fixed_probe) !== canonicalJson(FIXED_PROBE)
    || canonicalJson(value.authority) !== canonicalJson(AUTHORITY_DISCLOSURE)) {
    installedError('installed profile must freeze the U5 probe-only authority surface');}
  const binding = normalizeInstalledBinding(value.binding);
  const material = {
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: INSTALLED_PROFILE_KIND,
    profile_version: INSTALLED_PROFILE_VERSION,
    installed_abi_hash: getSupervisedOwnerKernelInstalledAbiHash(),
    binding,
    fixed_probe: cloneCanonical(FIXED_PROBE),
    authority: cloneCanonical(AUTHORITY_DISCLOSURE),
    allowed_operation: 'run_probe',
    catalog_id: FIXED_PROBE.catalog_id,};
  material.profile_hash = sha256(canonicalJson(material));
  if (value.profile_hash !== material.profile_hash
    || canonicalJson(value) !== canonicalJson(material)) {
    installedError('installed profile is not canonical or its hash is invalid');}
  return cloneCanonical(material);}
function normalizeInstalledResult(raw) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'status',
    'outcome',
    'profile_hash',
    'install_binding_hash',
    'run_binding_hash',
    'cohort_id',
    'generation',
    'probe_catalog_id',
    'effect_replayed',
    'sentinel_restored',
    'authority',
    'audit_hash',
    'result_hash',
  ]), 'installed result');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION
    || value.kind !== 'p37_installed_run_probe_result') {
    installedError('installed result has an unsupported schema or kind');}
  if (!['completed', 'failed', 'unknown', 'recovery_required'].includes(value.outcome)) {
    installedError('installed result outcome is invalid');}
  if (value.effect_replayed !== false) {
    installedError('installed result must never claim effect replay', 'EFFECT_REPLAY_FORBIDDEN');}
  if (value.probe_catalog_id !== FIXED_PROBE.catalog_id) {
    installedError('installed result must bind the fixed probe catalog id');}
  if (canonicalJson(value.authority) !== canonicalJson(AUTHORITY_DISCLOSURE)) {
    installedError('installed result authority disclosure is invalid');}
  if (value.authority.engine_sink !== 'disabled'
    || value.authority.acceptance !== 'not_available'
    || value.authority.acceptance_transaction !== 'disabled') {
    installedError('installed result must keep Engine sink and acceptance disabled');}
  const material = {
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: 'p37_installed_run_probe_result',
    status: requireToken(value.status, 'installed result status'),
    outcome: value.outcome,
    profile_hash: requireSha256(value.profile_hash, 'installed result profile_hash'),
    install_binding_hash: requireSha256(value.install_binding_hash, 'installed result install_binding_hash'),
    run_binding_hash: requireSha256(value.run_binding_hash, 'installed result run_binding_hash'),
    cohort_id: requireToken(value.cohort_id, 'installed result cohort_id'),
    generation: requirePositiveInteger(value.generation, 'installed result generation'),
    probe_catalog_id: FIXED_PROBE.catalog_id,
    effect_replayed: false,
    sentinel_restored: value.sentinel_restored === true,
    authority: cloneCanonical(AUTHORITY_DISCLOSURE),
    audit_hash: requireSha256(value.audit_hash, 'installed result audit_hash'),};
  material.result_hash = sha256(canonicalJson(material));
  if (value.result_hash !== material.result_hash) {
    installedError('installed result_hash is invalid');}
  return cloneCanonical({ ...material, result_hash: material.result_hash });}
function createInstalledCrashOutcome({
  outcome,
  requestId,
  reasonCode,
  auditMaterial,
}) {
  if (outcome === 'completed' || outcome === 'failed') {
    // allowed explicit terminal states
  } else if (outcome !== 'unknown' && outcome !== 'recovery_required') {
    installedError('crash outcome must be completed, failed, unknown, or recovery_required');}
  return normalizeCrashOutcome({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: 'p37_installed_crash_outcome',
    outcome,
    effect_replayed: false,
    request_id: requestId,
    reason_code: reasonCode,
    audit_hash: sha256(canonicalJson(auditMaterial || { request_id: requestId, reason_code: reasonCode })),
  });}
module.exports = {
  AUTHORITY_DISCLOSURE,
  BROKER_OPERATIONS,
  CALLER_CONTROLLED_KEYS,
  COORDINATOR_OPERATIONS,
  CRASH_OUTCOMES,
  FIXED_PROBE,
  FORBIDDEN_OPERATIONS,
  INSTALLED_BINDING_KIND,
  INSTALLED_ENDPOINTS,
  INSTALLED_KIND,
  INSTALLED_PROFILE_KIND,
  INSTALLED_PROFILE_VERSION,
  INSTALLED_PROTOCOL_VERSION,
  INSTALLED_SCHEMA_VERSION,
  KERNEL_OPERATIONS,
  MAX_FUTURE_SKEW_MILLISECONDS,
  MAX_INSTALLED_FRAME_BYTES,
  MAX_MESSAGE_LIFETIME_MILLISECONDS,
  RECEIPT_VERIFIER_OPERATIONS,
  SERVICE_IDENTITIES,
  SERVICE_ROLES,
  WITNESS_OPERATIONS,
  compileInstalledProfile,
  createInstalledCrashOutcome,
  getInstalledEndpoint,
  getSupervisedOwnerKernelInstalledAbi,
  getSupervisedOwnerKernelInstalledAbiHash,
  normalizeCrashOutcome,
  normalizeInstalledBinding,
  normalizeInstalledEnvelope,
  normalizeInstalledProfile,
  normalizeInstalledResult,
  rejectCallerControlledFields,};
