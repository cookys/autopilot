'use strict';

const path = require('path');

const {
  OwnerKernel,
  OwnerKernelError,
  canonicalJson,
  cloneCanonical,
  freezeAcceptanceContract,
  normalizeSemanticRoute,
  resolveGovernancePolicy,
  semanticRouteHash,
  sha256,
} = require('./owner-kernel');
const { normalizeDurableBinding } = require('./supervised-production-substrate-durable-contract');
const {
  assertSemanticRouteFresh,
  compileSemanticWitnessRoute,
  createSemanticWitnessAdapter,
  throwAfterWitnessTeardown,
} = require('./supervised-owner-kernel-semantic-witness');

const PROBE_EFFECT_PROFILE_VERSION = 1;
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

const PROFILE_KEYS = new Set([
  'schema_version',
  'kind',
  'profile_version',
  'route',
  'route_hash',
  'policy_hash',
  'contract_hash',
  'catalog_entry',
  'action',
  'action_hash',
  'receipt_root',
  'capability_probed_at',
  'capability_expires_at',
  'owner_kernel_authority',
  'effect_authority',
  'broker_authority',
  'acceptance',
  'profile_hash',
]);

function probeError(message, code = 'INVALID_PROBE_EFFECT_PROFILE') {
  throw new OwnerKernelError(message, code);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    probeError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) probeError(`${label} has unsupported key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) probeError(`${label} is missing ${key}`);
  }
  return value;
}

function requireIso(value, label) {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    probeError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function normalizeReceiptRoot(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    probeError('probe effect receipt_root must be an absolute path');
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '/') {
    probeError('probe effect receipt_root must be a canonical non-root absolute path');
  }
  return normalized;
}

function receiptRootForRoute(route) {
  return `${PROBE_EFFECT_RECEIPT_ROOT}/${route.run_id}`;
}

function fixedAction() {
  return cloneCanonical({
    operation: PROBE_EFFECT_OPERATION,
    tool_class: PROBE_EFFECT_TOOL_CLASS,
    targets: [PROBE_EFFECT_TARGET],
  });
}

function normalizeProbeEffectProfile(raw) {
  const value = assertExactKeys(raw, PROFILE_KEYS, 'probe effect profile');
  if (value.schema_version !== 1 || value.kind !== 'p37_probe_effect_profile'
    || value.profile_version !== PROBE_EFFECT_PROFILE_VERSION) {
    probeError('probe effect profile schema, kind, or version is unsupported');
  }
  const route = normalizeSemanticRoute(value.route);
  const routeHash = semanticRouteHash(route);
  if (value.route_hash !== routeHash || value.policy_hash !== route.policy_hash
    || value.contract_hash !== route.contract_hash) {
    probeError('probe effect profile does not bind its semantic route');
  }
  if (canonicalJson(value.catalog_entry) !== canonicalJson(PROBE_EFFECT_CATALOG_ENTRY)
    || canonicalJson(value.action) !== canonicalJson(fixedAction())) {
    probeError('probe effect profile must use the one fixed catalog action');
  }
  const actionHash = sha256(canonicalJson(value.action));
  if (value.action_hash !== actionHash) probeError('probe effect profile action_hash is invalid');
  const probedAt = requireIso(value.capability_probed_at, 'probe effect capability_probed_at');
  const expiresAt = requireIso(value.capability_expires_at, 'probe effect capability_expires_at');
  if (Date.parse(expiresAt) <= Date.parse(probedAt)
    || Date.parse(expiresAt) - Date.parse(probedAt) > 3600000) {
    probeError('probe effect capability window must be positive and at most one hour');
  }
  if (value.owner_kernel_authority !== 'active'
    || value.effect_authority !== 'reversible_probe_only'
    || value.broker_authority !== 'probe_only'
    || value.acceptance !== 'not_available') {
    probeError('probe effect profile authority status is invalid');
  }
  const normalized = {
    schema_version: 1,
    kind: 'p37_probe_effect_profile',
    profile_version: PROBE_EFFECT_PROFILE_VERSION,
    route,
    route_hash: routeHash,
    policy_hash: route.policy_hash,
    contract_hash: route.contract_hash,
    catalog_entry: cloneCanonical(PROBE_EFFECT_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: actionHash,
    receipt_root: normalizeReceiptRoot(value.receipt_root),
    capability_probed_at: probedAt,
    capability_expires_at: expiresAt,
    owner_kernel_authority: 'active',
    effect_authority: 'reversible_probe_only',
    broker_authority: 'probe_only',
    acceptance: 'not_available',
  };
  normalized.profile_hash = sha256(canonicalJson(normalized));
  if (normalized.receipt_root !== receiptRootForRoute(route)) {
    probeError('probe effect receipt_root is not the fixed host-owned per-run path');
  }
  if (value.profile_hash !== normalized.profile_hash
    || canonicalJson(value) !== canonicalJson(normalized)) {
    probeError('probe effect profile is not canonical or its hash is invalid');
  }
  return cloneCanonical(normalized);
}

function compileProbeEffectProfile(options = {}) {
  const route = compileSemanticWitnessRoute(options);
  const policy = resolveGovernancePolicy(options.governanceConfig, {
    modeOverride: options.modeOverride,
  });
  const contract = freezeAcceptanceContract(options.acceptanceContract);
  if (policy.policy.action_catalog.length !== 1
    || canonicalJson(policy.policy.action_catalog[0]) !== canonicalJson(PROBE_EFFECT_CATALOG_ENTRY)) {
    probeError('probe effect requires exactly the fixed reversible probe catalog row');
  }
  if (contract.contract.schema_version !== 1) {
    probeError('probe effect requires schema_version 1 while acceptance remains unavailable');
  }
  const profile = {
    schema_version: 1,
    kind: 'p37_probe_effect_profile',
    profile_version: PROBE_EFFECT_PROFILE_VERSION,
    route,
    route_hash: semanticRouteHash(route),
    policy_hash: policy.policy_hash,
    contract_hash: contract.contract_hash,
    catalog_entry: cloneCanonical(PROBE_EFFECT_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: sha256(canonicalJson(fixedAction())),
    receipt_root: receiptRootForRoute(route),
    capability_probed_at: requireIso(options.capabilityProbedAt, 'probe effect capabilityProbedAt'),
    capability_expires_at: requireIso(options.capabilityExpiresAt, 'probe effect capabilityExpiresAt'),
    owner_kernel_authority: 'active',
    effect_authority: 'reversible_probe_only',
    broker_authority: 'probe_only',
    acceptance: 'not_available',
  };
  profile.profile_hash = sha256(canonicalJson(profile));
  return Object.freeze(normalizeProbeEffectProfile(profile));
}

function serializableRequest(request) {
  assertObject(request, 'probe effect host request');
  const value = { ...request };
  delete value.abort_signal;
  return cloneCanonical(value);
}

function normalizeHostResponse(raw, { profile, operation, requestHash }) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'profile_hash',
    'route_hash',
    'operation',
    'request_hash',
    'response',
    'response_hash',
  ]), 'probe effect host response');
  if (value.schema_version !== 1 || value.kind !== 'p37_probe_effect_host_response'
    || value.profile_hash !== profile.profile_hash || value.route_hash !== profile.route_hash
    || value.operation !== operation || value.request_hash !== requestHash) {
    probeError('probe effect host response does not bind the exact profile and request', 'PROBE_EFFECT_REJECTED');
  }
  assertObject(value.response, 'probe effect host response payload');
  if (value.response_hash !== sha256(canonicalJson(value.response))) {
    probeError('probe effect host response hash is invalid', 'PROBE_EFFECT_REJECTED');
  }
  return cloneCanonical(value.response);
}

function createProbeEffectActionAuthority({
  profile: rawProfile,
  durableBinding: rawDurableBinding,
  invoke,
}) {
  if (typeof invoke !== 'function') probeError('probe effect action authority requires invoke()');
  const profile = normalizeProbeEffectProfile(rawProfile);
  const binding = normalizeDurableBinding(rawDurableBinding);
  const route = profile.route;
  if (route.p36_install_binding_hash !== binding.install_binding_hash
    || route.p36_run_binding_hash !== binding.run_binding_hash
    || route.durable_abi_hash !== binding.durable_abi_hash
    || canonicalJson(route.worker_binding) !== canonicalJson(binding.service_bindings.worker)
    || canonicalJson(route.broker_binding) !== canonicalJson(binding.service_bindings.broker)
    || canonicalJson(route.coordinator_binding) !== canonicalJson(binding.service_bindings.coordinator)
    || canonicalJson(route.receipt_verifier_binding)
      !== canonicalJson(binding.service_bindings.receipt_verifier)
    || canonicalJson(route.witness_binding) !== canonicalJson(binding.service_bindings.witness)) {
    probeError('probe effect profile does not match the durable service cohort');
  }

  function call(operation, request, recipientRole, { synchronous = false } = {}) {
    const payload = serializableRequest(request);
    const requestHash = sha256(canonicalJson(payload));
    const message = cloneCanonical({
      schema_version: 1,
      kind: 'p37_probe_effect_host_request',
      profile_hash: profile.profile_hash,
      route_hash: profile.route_hash,
      operation,
      sender: route.kernel_binding,
      recipient: recipientRole === 'kernel'
        ? route.kernel_binding
        : binding.service_bindings[recipientRole],
      request_hash: requestHash,
      request: payload,
    });
    const result = invoke(message);
    if (result && typeof result.then === 'function') {
      if (synchronous) {
        probeError('host capability probes must complete synchronously', 'PROBE_EFFECT_UNAVAILABLE');
      }
      return result.then((value) => normalizeHostResponse(value, { profile, operation, requestHash }));
    }
    return normalizeHostResponse(result, { profile, operation, requestHash });
  }

  const broker = binding.service_bindings.broker;
  const verifier = binding.service_bindings.receipt_verifier;
  const worker = binding.service_bindings.worker;
  const kernel = route.kernel_binding;
  return Object.freeze({
    host_capability: {
      schema_version: 1,
      tier: 'partial',
      probe_id: `p37-probe-${profile.profile_hash}`,
      probed_at: profile.capability_probed_at,
      expires_at: profile.capability_expires_at,
      preventive_action_ids: [],
      audited_action_ids: [PROBE_EFFECT_CATALOG_ID],
      mediated_action_ids: [PROBE_EFFECT_CATALOG_ID],
      broker: {
        kind: 'external-broker',
        identity: broker.identity,
        worker_uid: worker.uid,
        broker_uid: broker.uid,
        receipt_root: profile.receipt_root,
        permit_revocation: true,
        attestation_hash: broker.attestation_hash,
        protocol_version: 1,
      },
    },
    host_capability_verifier: {
      identity: kernel.identity,
      trustTier: 'external',
      attestation_hash: kernel.attestation_hash,
      probe(request) {
        return call(`capability:${request.operation}`, request, 'kernel', { synchronous: true });
      },
    },
    receipt_verifier: {
      identity: verifier.identity,
      trustTier: 'external',
      attestation_hash: verifier.attestation_hash,
      verify(request) {
        return call(
          request.operation === 'verify_cancellation' ? 'verify_cancellation' : 'verify_effect',
          request,
          'receipt_verifier',
        );
      },
    },
    executor: {
      identity: worker.identity,
      trustTier: 'external',
      attestation_hash: worker.attestation_hash,
      worker_uid: worker.uid,
      broker: {
        identity: broker.identity,
        broker_uid: broker.uid,
        receipt_root: profile.receipt_root,
        attestation_hash: broker.attestation_hash,
        protocol_version: 1,
        execute(request) {
          return call('execute_probe', request, 'broker');
        },
        cancel(request) {
          return call('cancel_probe', request, 'broker');
        },
      },
    },
  });
}

function resolveProfile(options) {
  return options.profile
    ? normalizeProbeEffectProfile(options.profile)
    : compileProbeEffectProfile(options);
}

function sessionModeOverride(options) {
  const nested = options.kernelOptions && options.kernelOptions.modeOverride;
  if (options.modeOverride !== undefined && nested !== undefined
    && options.modeOverride !== nested) {
    probeError('probe session has conflicting mode overrides');
  }
  return options.modeOverride === undefined ? nested : options.modeOverride;
}

function assertProfileInputs(profile, options, modeOverride) {
  const policy = resolveGovernancePolicy(options.governanceConfig, { modeOverride });
  const contract = freezeAcceptanceContract(options.acceptanceContract);
  if (profile.policy_hash !== policy.policy_hash
    || profile.contract_hash !== contract.contract_hash) {
    probeError('probe profile does not match the session policy and acceptance contract');
  }
}

function createProbeEffectSession(options = {}) {
  const modeOverride = sessionModeOverride(options);
  const profile = resolveProfile({ ...options, modeOverride });
  assertProfileInputs(profile, options, modeOverride);
  assertSemanticRouteFresh(profile.route, options.kernelOptions && options.kernelOptions.clock);
  const witness = createSemanticWitnessAdapter({
    route: profile.route,
    durableBinding: options.durableBinding,
    invoke: options.witnessInvoke,
    requestIdFactory: options.requestIdFactory,
  });
  let actionAuthority;
  let started;
  try {
    actionAuthority = createProbeEffectActionAuthority({
      profile,
      durableBinding: options.durableBinding,
      invoke: options.effectInvoke,
    });
    started = OwnerKernel.start({
      ...options.kernelOptions,
      runId: profile.route.run_id,
      governanceConfig: options.governanceConfig,
      modeOverride,
      acceptanceContract: options.acceptanceContract,
      witness,
      actionAuthority,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  let closed = false;
  return {
    ...started,
    profile,
    action: fixedAction(),
    authority: {
      owner_kernel_authority: 'active',
      effect_authority: 'reversible_probe_only',
      broker_authority: 'probe_only',
      acceptance: 'not_available',
    },
    teardown() {
      if (closed) return false;
      started.kernel.stopBlockedTimeoutMonitor();
      witness.teardown();
      closed = true;
      return true;
    },
  };
}

function resumeProbeEffectSession(options = {}) {
  const modeOverride = sessionModeOverride(options);
  const profile = resolveProfile({ ...options, modeOverride });
  if (!options.ledger || !options.ledger.header
    || options.ledger.header.run_id !== profile.route.run_id
    || options.ledger.header.policy_hash !== profile.policy_hash
    || options.ledger.header.contract_hash !== profile.contract_hash
    || !options.ledger.header.authority
    || !options.ledger.header.authority.host_capability
    || options.ledger.header.authority.host_capability.probe_id
      !== `p37-probe-${profile.profile_hash}`) {
    probeError('probe profile does not exactly match the ledger-frozen authority');
  }
  const witness = createSemanticWitnessAdapter({
    route: profile.route,
    durableBinding: options.durableBinding,
    invoke: options.witnessInvoke,
    requestIdFactory: options.requestIdFactory,
  });
  let actionAuthority;
  let resumed;
  try {
    actionAuthority = createProbeEffectActionAuthority({
      profile,
      durableBinding: options.durableBinding,
      invoke: options.effectInvoke,
    });
    resumed = OwnerKernel.resume({
      ...options.kernelOptions,
      ledger: options.ledger,
      witness,
      actionAuthority,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  let closed = false;
  return {
    ...resumed,
    profile,
    action: fixedAction(),
    authority: {
      owner_kernel_authority: 'active',
      effect_authority: 'reversible_probe_only',
      broker_authority: 'probe_only',
      acceptance: 'not_available',
    },
    teardown() {
      if (closed) return false;
      resumed.kernel.stopBlockedTimeoutMonitor();
      witness.teardown();
      closed = true;
      return true;
    },
  };
}

module.exports = {
  PROBE_EFFECT_CATALOG_ENTRY,
  PROBE_EFFECT_CATALOG_ID,
  PROBE_EFFECT_OPERATION,
  PROBE_EFFECT_PROFILE_VERSION,
  PROBE_EFFECT_RECEIPT_ROOT,
  PROBE_EFFECT_TARGET,
  PROBE_EFFECT_TOOL_CLASS,
  compileProbeEffectProfile,
  createProbeEffectActionAuthority,
  createProbeEffectSession,
  normalizeProbeEffectProfile,
  resumeProbeEffectSession,
};
