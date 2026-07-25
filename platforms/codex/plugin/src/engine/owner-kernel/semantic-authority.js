'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const { normalizeWitnessBinding } = require('./witness');

const SEMANTIC_AUTHORITY_SCHEMA_VERSION = 1;
const SEMANTIC_WITNESS_ROUTE_VERSION = 1;

const SERVICE_BINDING_KEYS = new Set([
  'role',
  'identity',
  'uid',
  'gid',
  'attestation_hash',
  'cgroup_binding_hash',
]);

const ROUTE_KEYS = new Set([
  'schema_version',
  'kind',
  'route_version',
  'run_id',
  'invocation_id',
  'handoff_id',
  'handoff_hash',
  'handoff_issued_at_ms',
  'handoff_expires_at_ms',
  'handoff_claimed_at_ms',
  'descriptor_binding_hash',
  'workspace_ticket_hash',
  'workspace_root_hash',
  'immutable_base',
  'policy_hash',
  'contract_hash',
  'p36_install_binding_hash',
  'p36_run_binding_hash',
  'p36_contract_plan_hash',
  'substrate_plan_hash',
  'durable_abi_hash',
  'cohort_id',
  'generation',
  'kernel_binding',
  'worker_binding',
  'broker_binding',
  'receipt_verifier_binding',
  'witness_binding',
  'coordinator_binding',
  'owner_kernel_authority',
  'effect_authority',
  'broker_authority',
  'acceptance',
]);

function semanticError(message) {
  throw new OwnerKernelError(message, 'INVALID_SEMANTIC_AUTHORITY');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    semanticError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) semanticError(`${label} has unsupported key "${key}"`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) semanticError(`${label} is missing ${key}`);
  }
  return value;
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    semanticError(`${label} is invalid`);
  }
  return value;
}

function requireSha256(value, label) {
  if (!isSha256(value)) semanticError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function requireEpochMilliseconds(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    semanticError(`${label} is invalid`);
  }
  return value;
}

function normalizeServiceBinding(raw, expectedRole, label) {
  const value = assertExactKeys(assertPlainObject(raw, label), SERVICE_BINDING_KEYS, label);
  if (value.role !== expectedRole) semanticError(`${label}.role must equal ${expectedRole}`);
  if (!Number.isSafeInteger(value.uid) || value.uid < 0
    || !Number.isSafeInteger(value.gid) || value.gid < 0) {
    semanticError(`${label} uid/gid are invalid`);
  }
  return {
    role: expectedRole,
    identity: requireToken(value.identity, `${label}.identity`),
    uid: value.uid,
    gid: value.gid,
    attestation_hash: requireSha256(value.attestation_hash, `${label}.attestation_hash`),
    cgroup_binding_hash: requireSha256(value.cgroup_binding_hash, `${label}.cgroup_binding_hash`),
  };
}

function normalizeSemanticRoute(raw) {
  const value = assertExactKeys(assertPlainObject(raw, 'semantic route'), ROUTE_KEYS, 'semantic route');
  if (value.schema_version !== SEMANTIC_AUTHORITY_SCHEMA_VERSION
    || value.kind !== 'p37_semantic_witness_route'
    || value.route_version !== SEMANTIC_WITNESS_ROUTE_VERSION) {
    semanticError('semantic route schema, kind, or version is unsupported');
  }
  if (typeof value.immutable_base !== 'string' || !/^[0-9a-f]{40,64}$/.test(value.immutable_base)) {
    semanticError('semantic route immutable_base is invalid');
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) {
    semanticError('semantic route generation is invalid');
  }
  if (value.owner_kernel_authority !== 'semantic_only'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available') {
    semanticError('semantic route authority status is invalid');
  }
  const normalized = {
    schema_version: SEMANTIC_AUTHORITY_SCHEMA_VERSION,
    kind: 'p37_semantic_witness_route',
    route_version: SEMANTIC_WITNESS_ROUTE_VERSION,
    run_id: requireToken(value.run_id, 'semantic route run_id'),
    invocation_id: requireToken(value.invocation_id, 'semantic route invocation_id'),
    handoff_id: requireToken(value.handoff_id, 'semantic route handoff_id'),
    handoff_hash: requireSha256(value.handoff_hash, 'semantic route handoff_hash'),
    handoff_issued_at_ms: requireEpochMilliseconds(
      value.handoff_issued_at_ms,
      'semantic route handoff_issued_at_ms',
    ),
    handoff_expires_at_ms: requireEpochMilliseconds(
      value.handoff_expires_at_ms,
      'semantic route handoff_expires_at_ms',
    ),
    handoff_claimed_at_ms: requireEpochMilliseconds(
      value.handoff_claimed_at_ms,
      'semantic route handoff_claimed_at_ms',
    ),
    descriptor_binding_hash: requireSha256(
      value.descriptor_binding_hash,
      'semantic route descriptor_binding_hash',
    ),
    workspace_ticket_hash: requireSha256(
      value.workspace_ticket_hash,
      'semantic route workspace_ticket_hash',
    ),
    workspace_root_hash: requireSha256(value.workspace_root_hash, 'semantic route workspace_root_hash'),
    immutable_base: value.immutable_base,
    policy_hash: requireSha256(value.policy_hash, 'semantic route policy_hash'),
    contract_hash: requireSha256(value.contract_hash, 'semantic route contract_hash'),
    p36_install_binding_hash: requireSha256(
      value.p36_install_binding_hash,
      'semantic route P3.6 install binding hash',
    ),
    p36_run_binding_hash: requireSha256(
      value.p36_run_binding_hash,
      'semantic route P3.6 run binding hash',
    ),
    p36_contract_plan_hash: requireSha256(
      value.p36_contract_plan_hash,
      'semantic route P3.6 contract plan hash',
    ),
    substrate_plan_hash: requireSha256(value.substrate_plan_hash, 'semantic route substrate plan hash'),
    durable_abi_hash: requireSha256(value.durable_abi_hash, 'semantic route durable ABI hash'),
    cohort_id: requireToken(value.cohort_id, 'semantic route cohort_id'),
    generation: value.generation,
    kernel_binding: normalizeServiceBinding(value.kernel_binding, 'kernel', 'semantic route kernel binding'),
    worker_binding: normalizeServiceBinding(value.worker_binding, 'worker', 'semantic route worker binding'),
    broker_binding: normalizeServiceBinding(value.broker_binding, 'broker', 'semantic route broker binding'),
    receipt_verifier_binding: normalizeServiceBinding(
      value.receipt_verifier_binding,
      'receipt_verifier',
      'semantic route receipt verifier binding',
    ),
    witness_binding: normalizeServiceBinding(
      value.witness_binding,
      'witness',
      'semantic route witness binding',
    ),
    coordinator_binding: normalizeServiceBinding(
      value.coordinator_binding,
      'coordinator',
      'semantic route coordinator binding',
    ),
    owner_kernel_authority: 'semantic_only',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
  };
  if (normalized.handoff_expires_at_ms <= normalized.handoff_issued_at_ms
    || normalized.handoff_expires_at_ms - normalized.handoff_issued_at_ms > 60000
    || normalized.handoff_claimed_at_ms < normalized.handoff_issued_at_ms
    || normalized.handoff_claimed_at_ms > normalized.handoff_expires_at_ms) {
    semanticError('semantic route handoff activation times are inconsistent');
  }
  const identities = [
    normalized.kernel_binding.identity,
    normalized.worker_binding.identity,
    normalized.broker_binding.identity,
    normalized.receipt_verifier_binding.identity,
    normalized.witness_binding.identity,
    normalized.coordinator_binding.identity,
  ];
  if (new Set(identities).size !== identities.length) {
    semanticError('semantic route roles must have distinct identities');
  }
  return cloneCanonical(normalized);
}

function semanticRouteHash(route) {
  return sha256(canonicalJson(normalizeSemanticRoute(route)));
}

function createSemanticAuthorityHeader(routeRaw, witness) {
  const route = normalizeSemanticRoute(routeRaw);
  const witnessBinding = normalizeWitnessBinding(witness);
  if (witnessBinding.identity !== route.witness_binding.identity
    || witnessBinding.attestation_hash !== route.witness_binding.attestation_hash) {
    semanticError('semantic route witness does not match the installed witness binding');
  }
  const routeHash = semanticRouteHash(route);
  return cloneCanonical({
    schema_version: SEMANTIC_AUTHORITY_SCHEMA_VERSION,
    route_version: SEMANTIC_WITNESS_ROUTE_VERSION,
    route,
    route_hash: routeHash,
    witness_binding: witnessBinding,
    witness_binding_hash: sha256(canonicalJson(witnessBinding)),
  });
}

function normalizeSemanticAuthorityHeader(raw) {
  if (raw === undefined || raw === null) return null;
  const value = assertExactKeys(
    assertPlainObject(raw, 'semantic authority'),
    new Set([
      'schema_version',
      'route_version',
      'route',
      'route_hash',
      'witness_binding',
      'witness_binding_hash',
    ]),
    'semantic authority',
  );
  if (value.schema_version !== SEMANTIC_AUTHORITY_SCHEMA_VERSION
    || value.route_version !== SEMANTIC_WITNESS_ROUTE_VERSION) {
    semanticError('semantic authority schema or route version is unsupported');
  }
  const route = normalizeSemanticRoute(value.route);
  const routeHash = semanticRouteHash(route);
  if (value.route_hash !== routeHash) semanticError('semantic authority route_hash does not match route');
  const witnessBinding = normalizeWitnessBinding(value.witness_binding);
  if (witnessBinding.identity !== route.witness_binding.identity
    || witnessBinding.attestation_hash !== route.witness_binding.attestation_hash) {
    semanticError('semantic authority witness binding does not match route');
  }
  const witnessBindingHash = sha256(canonicalJson(witnessBinding));
  if (value.witness_binding_hash !== witnessBindingHash) {
    semanticError('semantic authority witness_binding_hash does not match witness binding');
  }
  const normalized = {
    schema_version: SEMANTIC_AUTHORITY_SCHEMA_VERSION,
    route_version: SEMANTIC_WITNESS_ROUTE_VERSION,
    route,
    route_hash: routeHash,
    witness_binding: witnessBinding,
    witness_binding_hash: witnessBindingHash,
  };
  if (canonicalJson(value) !== canonicalJson(normalized)) semanticError('semantic authority is not canonical');
  return cloneCanonical(normalized);
}

module.exports = {
  SEMANTIC_AUTHORITY_SCHEMA_VERSION,
  SEMANTIC_WITNESS_ROUTE_VERSION,
  createSemanticAuthorityHeader,
  normalizeSemanticAuthorityHeader,
  normalizeSemanticRoute,
  semanticRouteHash,
};
