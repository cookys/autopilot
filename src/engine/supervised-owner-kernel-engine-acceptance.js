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

const ENGINE_ACCEPTANCE_PROFILE_VERSION = 1;
const ENGINE_IMPLEMENTATION_CATALOG_ID = 'engine-implementation-dispatch-v1';
const ENGINE_IMPLEMENTATION_OPERATION = 'engine_implementation_dispatch';
const ENGINE_IMPLEMENTATION_TOOL_CLASS = 'model_runner';
const ENGINE_IMPLEMENTATION_TARGET = 'autopilot-engine:implementation-dispatch';
const ENGINE_IMPLEMENTATION_RECEIPT_ROOT = '/var/lib/autopilot-production/engine-implementation';

const ENGINE_IMPLEMENTATION_CATALOG_ENTRY = Object.freeze({
  id: ENGINE_IMPLEMENTATION_CATALOG_ID,
  operation: ENGINE_IMPLEMENTATION_OPERATION,
  tool_class: ENGINE_IMPLEMENTATION_TOOL_CLASS,
  action_class: 'external',
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
  'sink_id',
  'sink_inventory_hash',
  'receipt_root',
  'capability_probed_at',
  'capability_expires_at',
  'owner_kernel_authority',
  'effect_authority',
  'broker_authority',
  'acceptance',
  'profile_hash',
]);

function engineError(message, code = 'INVALID_ENGINE_ACCEPTANCE_PROFILE') {
  throw new OwnerKernelError(message, code);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    engineError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) engineError(`${label} has unsupported key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) engineError(`${label} is missing ${key}`);
  }
  return value;
}

function requireIso(value, label) {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    engineError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function fixedAction() {
  return cloneCanonical({
    operation: ENGINE_IMPLEMENTATION_OPERATION,
    tool_class: ENGINE_IMPLEMENTATION_TOOL_CLASS,
    targets: [ENGINE_IMPLEMENTATION_TARGET],
  });
}

function receiptRootForRoute(route) {
  return `${ENGINE_IMPLEMENTATION_RECEIPT_ROOT}/${route.run_id}`;
}

function normalizeEngineAcceptanceProfile(raw) {
  const value = assertExactKeys(raw, PROFILE_KEYS, 'Engine acceptance profile');
  if (value.schema_version !== 1 || value.kind !== 'p37_engine_acceptance_profile'
    || value.profile_version !== ENGINE_ACCEPTANCE_PROFILE_VERSION) {
    engineError('Engine acceptance profile schema, kind, or version is unsupported');
  }
  const route = normalizeSemanticRoute(value.route);
  const routeHash = semanticRouteHash(route);
  if (value.route_hash !== routeHash || value.policy_hash !== route.policy_hash
    || value.contract_hash !== route.contract_hash) {
    engineError('Engine acceptance profile does not bind its semantic route');
  }
  if (canonicalJson(value.catalog_entry) !== canonicalJson(ENGINE_IMPLEMENTATION_CATALOG_ENTRY)
    || canonicalJson(value.action) !== canonicalJson(fixedAction())) {
    engineError('Engine acceptance profile must use the one fixed implementation sink action');
  }
  const actionHash = sha256(canonicalJson(value.action));
  const probedAt = requireIso(value.capability_probed_at, 'Engine capability_probed_at');
  const expiresAt = requireIso(value.capability_expires_at, 'Engine capability_expires_at');
  if (value.action_hash !== actionHash
    || value.sink_id !== 'implementation-dispatch'
    || value.sink_inventory_hash !== sha256(canonicalJson(require('./supervised-engine-bridge-contract')
      .getAutopilotEngineControlSinkInventory()))
    || value.receipt_root !== receiptRootForRoute(route)
    || Date.parse(expiresAt) <= Date.parse(probedAt)
    || Date.parse(expiresAt) - Date.parse(probedAt) > 3600000) {
    engineError('Engine acceptance profile fixed sink or capability binding is invalid');
  }
  if (value.owner_kernel_authority !== 'active'
    || value.effect_authority !== 'engine_implementation_only'
    || value.broker_authority !== 'implementation_only'
    || value.acceptance !== 'coordinator_v2') {
    engineError('Engine acceptance profile authority status is invalid');
  }
  const normalized = {
    schema_version: 1,
    kind: 'p37_engine_acceptance_profile',
    profile_version: ENGINE_ACCEPTANCE_PROFILE_VERSION,
    route,
    route_hash: routeHash,
    policy_hash: route.policy_hash,
    contract_hash: route.contract_hash,
    catalog_entry: cloneCanonical(ENGINE_IMPLEMENTATION_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: actionHash,
    sink_id: 'implementation-dispatch',
    sink_inventory_hash: value.sink_inventory_hash,
    receipt_root: receiptRootForRoute(route),
    capability_probed_at: probedAt,
    capability_expires_at: expiresAt,
    owner_kernel_authority: 'active',
    effect_authority: 'engine_implementation_only',
    broker_authority: 'implementation_only',
    acceptance: 'coordinator_v2',
  };
  normalized.profile_hash = sha256(canonicalJson(normalized));
  if (value.profile_hash !== normalized.profile_hash
    || canonicalJson(value) !== canonicalJson(normalized)) {
    engineError('Engine acceptance profile is not canonical or its hash is invalid');
  }
  return cloneCanonical(normalized);
}

function compileEngineAcceptanceProfile(options = {}) {
  const route = compileSemanticWitnessRoute(options);
  const policy = resolveGovernancePolicy(options.governanceConfig, {
    modeOverride: options.modeOverride,
  });
  const contract = freezeAcceptanceContract(options.acceptanceContract);
  if (policy.policy.action_catalog.length !== 1
    || canonicalJson(policy.policy.action_catalog[0])
      !== canonicalJson(ENGINE_IMPLEMENTATION_CATALOG_ENTRY)) {
    engineError('Engine acceptance requires exactly the fixed implementation-dispatch catalog row');
  }
  if (contract.contract.schema_version !== 2) {
    engineError('Engine acceptance requires a schema_version 2 acceptance contract');
  }
  const { getAutopilotEngineControlSinkInventory } = require('./supervised-engine-bridge-contract');
  const profile = {
    schema_version: 1,
    kind: 'p37_engine_acceptance_profile',
    profile_version: ENGINE_ACCEPTANCE_PROFILE_VERSION,
    route,
    route_hash: semanticRouteHash(route),
    policy_hash: policy.policy_hash,
    contract_hash: contract.contract_hash,
    catalog_entry: cloneCanonical(ENGINE_IMPLEMENTATION_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: sha256(canonicalJson(fixedAction())),
    sink_id: 'implementation-dispatch',
    sink_inventory_hash: sha256(canonicalJson(getAutopilotEngineControlSinkInventory())),
    receipt_root: receiptRootForRoute(route),
    capability_probed_at: requireIso(options.capabilityProbedAt, 'Engine capabilityProbedAt'),
    capability_expires_at: requireIso(options.capabilityExpiresAt, 'Engine capabilityExpiresAt'),
    owner_kernel_authority: 'active',
    effect_authority: 'engine_implementation_only',
    broker_authority: 'implementation_only',
    acceptance: 'coordinator_v2',
  };
  profile.profile_hash = sha256(canonicalJson(profile));
  return Object.freeze(normalizeEngineAcceptanceProfile(profile));
}

function serializableRequest(request) {
  assertObject(request, 'Engine host request');
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
  ]), 'Engine host response');
  if (value.schema_version !== 1 || value.kind !== 'p37_engine_host_response'
    || value.profile_hash !== profile.profile_hash || value.route_hash !== profile.route_hash
    || value.operation !== operation || value.request_hash !== requestHash
    || value.response_hash !== sha256(canonicalJson(value.response))) {
    engineError('Engine host response does not bind the exact profile and request', 'ENGINE_SINK_REJECTED');
  }
  return cloneCanonical(value.response);
}

function hostCaller(profile, invoke) {
  if (typeof invoke !== 'function') engineError('Engine profile requires a host invoke()');
  return function call(operation, request, recipient, { synchronous = false } = {}) {
    const payload = serializableRequest(request);
    const requestHash = sha256(canonicalJson(payload));
    const message = cloneCanonical({
      schema_version: 1,
      kind: 'p37_engine_host_request',
      profile_hash: profile.profile_hash,
      route_hash: profile.route_hash,
      operation,
      sender: profile.route.kernel_binding,
      recipient,
      request_hash: requestHash,
      request: payload,
    });
    const result = invoke(message);
    if (result && typeof result.then === 'function') {
      if (synchronous) engineError(`${operation} must be synchronous`, 'ENGINE_SINK_UNAVAILABLE');
      return result.then((value) => normalizeHostResponse(value, { profile, operation, requestHash }));
    }
    return normalizeHostResponse(result, { profile, operation, requestHash });
  };
}

function assertProfileCohort(profile, binding) {
  const route = profile.route;
  if (route.p36_install_binding_hash !== binding.install_binding_hash
    || route.p36_run_binding_hash !== binding.run_binding_hash
    || route.durable_abi_hash !== binding.durable_abi_hash
    || canonicalJson(route.worker_binding) !== canonicalJson(binding.service_bindings.worker)
    || canonicalJson(route.broker_binding) !== canonicalJson(binding.service_bindings.broker)
    || canonicalJson(route.receipt_verifier_binding)
      !== canonicalJson(binding.service_bindings.receipt_verifier)
    || canonicalJson(route.witness_binding) !== canonicalJson(binding.service_bindings.witness)
    || canonicalJson(route.coordinator_binding) !== canonicalJson(binding.service_bindings.coordinator)) {
    engineError('Engine acceptance profile does not match the durable service cohort');
  }
}

function createEngineActionAuthority({
  profile: rawProfile,
  durableBinding: rawDurableBinding,
  invoke,
}) {
  const profile = normalizeEngineAcceptanceProfile(rawProfile);
  const binding = normalizeDurableBinding(rawDurableBinding);
  assertProfileCohort(profile, binding);
  const call = hostCaller(profile, invoke);
  const { kernel_binding: kernel, worker_binding: worker, broker_binding: broker } = profile.route;
  const verifier = profile.route.receipt_verifier_binding;
  return Object.freeze({
    host_capability: {
      schema_version: 1,
      tier: 'partial',
      probe_id: `p37-engine-${profile.profile_hash}`,
      probed_at: profile.capability_probed_at,
      expires_at: profile.capability_expires_at,
      preventive_action_ids: [],
      audited_action_ids: [ENGINE_IMPLEMENTATION_CATALOG_ID],
      mediated_action_ids: [ENGINE_IMPLEMENTATION_CATALOG_ID],
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
        return call(`capability:${request.operation}`, request, kernel, { synchronous: true });
      },
    },
    receipt_verifier: {
      identity: verifier.identity,
      trustTier: 'external',
      attestation_hash: verifier.attestation_hash,
      verify(request) {
        return call(
          request.operation === 'verify_cancellation' ? 'verify_cancellation' : 'verify_engine_dispatch',
          request,
          verifier,
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
          return call('execute_engine_dispatch', request, broker);
        },
        cancel(request) {
          return call('cancel_engine_dispatch', request, broker);
        },
      },
    },
  });
}

function createEngineAcceptanceCoordinator({
  profile: rawProfile,
  durableBinding: rawDurableBinding,
  witness,
  invoke,
}) {
  const profile = normalizeEngineAcceptanceProfile(rawProfile);
  const binding = normalizeDurableBinding(rawDurableBinding);
  assertProfileCohort(profile, binding);
  if (!witness || typeof witness.appendBatchIfHead !== 'function'
    || typeof witness.verifyBatch !== 'function') {
    engineError('Engine acceptance coordinator requires the semantic atomic witness');
  }
  const coordinator = profile.route.coordinator_binding;
  const call = hostCaller(profile, invoke);
  const recipient = coordinator;
  return Object.freeze({
    identity: coordinator.identity,
    trustTier: 'external',
    attestation_hash: coordinator.attestation_hash,
    protocol_version: 2,
    acquire(request) {
      return call('coordinator_acquire', request, recipient);
    },
    async commit(request) {
      const prepared = await call('coordinator_prepare_commit', request, recipient);
      if (!prepared || prepared.disposition !== 'prepared'
        || !prepared.coordinator_commitment
        || typeof prepared.coordinator_commitment !== 'object') {
        engineError('acceptance coordinator did not prepare one immutable commit', 'ACCEPTANCE_COORDINATOR_REJECTED');
      }
      const appended = await witness.appendBatchIfHead({
        ...request.batch,
        coordinator_commitment: prepared.coordinator_commitment,
      });
      const response = {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        transaction_id: request.transaction_id,
        fence: request.fence,
        disposition: 'accepted',
        lease_released: true,
        coordinator_commitment: cloneCanonical(prepared.coordinator_commitment),
        event_records: cloneCanonical(request.provisional_events),
        receipts: cloneCanonical(appended.receipts),
      };
      const resolveRecordedCommit = async () => {
        let resolved;
        try {
          resolved = await call('coordinator_resolve', {
            run_id: request.run_id,
            policy_hash: request.policy_hash,
            contract_hash: request.contract_hash,
            coordinator_binding_hash: request.coordinator_binding_hash,
            attempt_id: request.attempt_id,
            attempt_hash: request.attempt_hash,
            transaction_id: request.transaction_id,
            fence: request.fence,
            expected_event_head: request.expected_event_head,
            expected_witness_head: request.expected_witness_head,
            batch_id: request.batch.batch_id,
            coordinator_commitment: cloneCanonical(prepared.coordinator_commitment),
            reason: 'resolve_after_record_commit',
          }, recipient);
        } catch (_error) {
          return null;
        }
        return canonicalJson(resolved) === canonicalJson(response) ? resolved : null;
      };
      let recorded;
      try {
        recorded = await call('coordinator_record_commit', response, recipient);
      } catch (_error) {
        const resolved = await resolveRecordedCommit();
        if (resolved !== null) return resolved;
        engineError(
          'acceptance coordinator could not resolve the committed batch after its record response was lost',
          'ACCEPTANCE_COORDINATOR_REJECTED',
        );
      }
      if (!recorded || recorded.recorded !== true) {
        const resolved = await resolveRecordedCommit();
        if (resolved !== null) return resolved;
        engineError(
          'acceptance coordinator did not durably record or exactly resolve the committed batch',
          'ACCEPTANCE_COORDINATOR_REJECTED',
        );
      }
      return response;
    },
    requestAbort(request) {
      return call('coordinator_request_abort', request, recipient);
    },
    cancel(request) {
      return call('coordinator_cancel', request, recipient);
    },
    resolveAttempt(request) {
      return call('coordinator_resolve', request, recipient);
    },
    verifyCommit(request) {
      const response = call('coordinator_verify_commit', request, recipient, { synchronous: true });
      return Boolean(response && response.verified === true);
    },
    verifyResolution(request) {
      const response = call('coordinator_verify_resolution', request, recipient, { synchronous: true });
      return Boolean(response && response.verified === true);
    },
    release(request) {
      return call('coordinator_release', request, recipient);
    },
  });
}

function resolveProfile(options) {
  return options.profile
    ? normalizeEngineAcceptanceProfile(options.profile)
    : compileEngineAcceptanceProfile(options);
}

function sessionModeOverride(options) {
  const nested = options.kernelOptions && options.kernelOptions.modeOverride;
  if (options.modeOverride !== undefined && nested !== undefined
    && options.modeOverride !== nested) {
    engineError('Engine acceptance session has conflicting mode overrides');
  }
  return options.modeOverride === undefined ? nested : options.modeOverride;
}

function assertProfileInputs(profile, options, modeOverride) {
  const policy = resolveGovernancePolicy(options.governanceConfig, { modeOverride });
  const contract = freezeAcceptanceContract(options.acceptanceContract);
  if (profile.policy_hash !== policy.policy_hash
    || profile.contract_hash !== contract.contract_hash) {
    engineError('Engine acceptance profile does not match the session policy and contract');
  }
}

function createEngineAcceptanceSession(options = {}) {
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
  let acceptanceAuthority;
  let started;
  try {
    actionAuthority = createEngineActionAuthority({
      profile,
      durableBinding: options.durableBinding,
      invoke: options.engineInvoke,
    });
    acceptanceAuthority = createEngineAcceptanceCoordinator({
      profile,
      durableBinding: options.durableBinding,
      witness,
      invoke: options.coordinatorInvoke,
    });
    started = OwnerKernel.start({
      ...options.kernelOptions,
      runId: profile.route.run_id,
      governanceConfig: options.governanceConfig,
      modeOverride,
      acceptanceContract: options.acceptanceContract,
      witness,
      actionAuthority,
      acceptanceAuthority,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  let closed = false;
  return {
    ...started,
    profile,
    action: fixedAction(),
    witness,
    action_authority: actionAuthority,
    acceptance_authority: acceptanceAuthority,
    authority: {
      owner_kernel_authority: 'active',
      effect_authority: 'engine_implementation_only',
      broker_authority: 'implementation_only',
      acceptance: 'coordinator_v2',
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

module.exports = {
  ENGINE_ACCEPTANCE_PROFILE_VERSION,
  ENGINE_IMPLEMENTATION_CATALOG_ENTRY,
  ENGINE_IMPLEMENTATION_CATALOG_ID,
  ENGINE_IMPLEMENTATION_OPERATION,
  ENGINE_IMPLEMENTATION_RECEIPT_ROOT,
  ENGINE_IMPLEMENTATION_TARGET,
  ENGINE_IMPLEMENTATION_TOOL_CLASS,
  compileEngineAcceptanceProfile,
  createEngineAcceptanceCoordinator,
  createEngineAcceptanceSession,
  createEngineActionAuthority,
  normalizeEngineAcceptanceProfile,
};
