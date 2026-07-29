'use strict';

const {
  OwnerKernel,
  OwnerKernelError,
  canonicalJson,
  cloneCanonical,
  deriveDisclosure,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
  sha256,
  verifyLedger,
} = require('./owner-kernel');
const {
  ENGINE_IMPLEMENTATION_CATALOG_ENTRY,
  ENGINE_IMPLEMENTATION_CATALOG_ID,
  ENGINE_IMPLEMENTATION_OPERATION,
  ENGINE_IMPLEMENTATION_RECEIPT_ROOT,
  ENGINE_IMPLEMENTATION_TARGET,
  ENGINE_IMPLEMENTATION_TOOL_CLASS,
  compileEngineAcceptanceProfile,
  createEngineAcceptanceSession,
  createEngineActionAuthority,
  createEngineAcceptanceCoordinator,
  normalizeEngineAcceptanceProfile,
} = require('./supervised-owner-kernel-engine-acceptance');
const {
  compileSemanticWitnessRoute,
  createSemanticWitnessAdapter,
  throwAfterWitnessTeardown,
} = require('./supervised-owner-kernel-semantic-witness');
const {
  normalizeDurableBinding,
} = require('./supervised-production-substrate-durable-contract');
const {
  normalizeInstalledBinding,
  rejectCallerControlledFields,
  SERVICE_ROLES,
} = require('./supervised-owner-kernel-installed-contract');
const { durableBindingFromInstalled } = require('./supervised-owner-kernel-installed-runner');
const { getAutopilotEngineControlSinkInventory } = require('./supervised-engine-bridge-contract');

const INSTALLED_ENGINE_SCHEMA_VERSION = 1;
const INSTALLED_ENGINE_PROFILE_VERSION = 1;
const INSTALLED_ENGINE_PROFILE_KIND = 'p37_installed_engine_profile';
const INSTALLED_ENGINE_SESSION_KIND = 'p37_installed_engine_session';
const INSTALLED_ENGINE_RESULT_KIND = 'p37_installed_engine_result';
const INSTALLED_ENGINE_ABORT_KIND = 'p37_installed_engine_action_abort';
const INSTALLED_ENGINE_SINK_ID = ENGINE_IMPLEMENTATION_CATALOG_ID;
const INTERNAL_ENGINE_CONTROL_SINK_ID = 'implementation-dispatch';

const INSTALLED_ENGINE_ACTION_IDENTITY = Object.freeze({
  catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
  operation: ENGINE_IMPLEMENTATION_OPERATION,
  tool_class: ENGINE_IMPLEMENTATION_TOOL_CLASS,
  target: ENGINE_IMPLEMENTATION_TARGET,
});

const INSTALLED_ENGINE_AUTHORITY = Object.freeze({
  owner_kernel_authority: 'active',
  effect_authority: 'engine_implementation_only',
  broker_authority: 'implementation_only',
  acceptance: 'coordinator_v2',
  engine_sink: INSTALLED_ENGINE_SINK_ID,
  acceptance_transaction: 'coordinator_v2_atomic',
  alias_retirement_eligible: false,
});

const FORBIDDEN_ENGINE_SINK_IDS = Object.freeze([
  'campaign-intake',
  'campaign-admission-release',
  'campaign-dispatch',
  'campaign-verification',
  'campaign-adjudication',
  'review-dispatch',
  'explore-dispatch',
  'author-dispatch',
  'arbitrary_execute',
  'implementation-dispatch-alternate',
  'implementation-dispatch',
  'engine_implementation_dispatch',
]);

const PROFILE_KEYS = new Set([
  'schema_version',
  'kind',
  'profile_version',
  'installed_binding',
  'installed_binding_hash',
  'engine_profile',
  'engine_profile_hash',
  'sink_id',
  'catalog_entry',
  'action',
  'action_hash',
  'authority',
  'action_identity',
  'profile_hash',
]);

const RESULT_KEYS = new Set([
  'schema_version',
  'kind',
  'status',
  'outcome',
  'profile_hash',
  'sink_id',
  'action_identity',
  'engine_observation',
  'accepted',
  'terminal_batch',
  'authority',
  'disclosure',
  'disclosure_hash',
  'ledger',
  'ledger_head',
  'delivered_manifest_head',
  'candidate_set_hash',
  'acceptance_event_hash',
  'complete_event_hash',
  'result_hash',
]);

// Only createInstalledEngineSession / resumeInstalledEngineSession may register
// intake-frozen witness and coordinator instances for accepted-result replay.
const INTAKE_FROZEN_WITNESSES = new WeakSet();
const INTAKE_FROZEN_COORDINATORS = new WeakSet();

function installedEngineError(message, code = 'INVALID_INSTALLED_ENGINE') {
  throw new OwnerKernelError(message, code);
}

function registerIntakeFrozenAuthorities(witness, acceptanceAuthority) {
  if (witness && typeof witness === 'object') {
    INTAKE_FROZEN_WITNESSES.add(witness);
  }
  if (acceptanceAuthority && typeof acceptanceAuthority === 'object') {
    INTAKE_FROZEN_COORDINATORS.add(acceptanceAuthority);
  }
}

function assertIntakeFrozenInstalledVerifiers(witness, acceptanceAuthority) {
  if (!witness || !INTAKE_FROZEN_WITNESSES.has(witness)) {
    installedEngineError(
      'accepted:true result rejects caller-supplied duck-typed witness substitutes; '
      + 'only intake-frozen installed witness instances can verify accepted replay',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  if (!acceptanceAuthority || !INTAKE_FROZEN_COORDINATORS.has(acceptanceAuthority)) {
    installedEngineError(
      'accepted:true result rejects caller-supplied duck-typed coordinator substitutes; '
      + 'only intake-frozen installed acceptance coordinator instances can verify accepted replay',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    installedEngineError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) installedEngineError(`${label} has unsupported key "${key}"`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      installedEngineError(`${label} is missing ${key}`);
    }
  }
  return value;
}

function requireIso(value, label) {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    installedEngineError(`${label} must be a UTC ISO-8601 timestamp`);
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

function fixedActionHash() {
  return sha256(canonicalJson(fixedAction()));
}

function assertSingleCatalog(policy) {
  if (!policy || !Array.isArray(policy.policy.action_catalog)
    || policy.policy.action_catalog.length !== 1
    || canonicalJson(policy.policy.action_catalog[0])
      !== canonicalJson(ENGINE_IMPLEMENTATION_CATALOG_ENTRY)) {
    installedEngineError(
      'installed Engine requires exactly the frozen engine-implementation-dispatch-v1 catalog row',
      'ENGINE_SINK_REJECTED',
    );
  }
}

function assertCallerFacingSinkId(sinkId, label = 'sink_id') {
  if (sinkId == null) return;
  if (sinkId !== INSTALLED_ENGINE_SINK_ID) {
    installedEngineError(
      `caller-facing ${label} must be exactly "${INSTALLED_ENGINE_SINK_ID}"; `
      + `aliases and control-plane ids cannot authorize (got "${sinkId}")`,
      'ENGINE_SINK_REJECTED',
    );
  }
}

function assertNotCallerSubstitutedSink(options = {}) {
  assertObject(options, 'installed Engine options');
  rejectCallerControlledFields(options, 'installed Engine options');
  assertCallerFacingSinkId(options.sink_id, 'sink_id');
  if (options.catalog_id != null && options.catalog_id !== ENGINE_IMPLEMENTATION_CATALOG_ID) {
    installedEngineError(
      'caller cannot substitute the installed Engine catalog id',
      'ENGINE_SINK_REJECTED',
    );
  }
  if (options.operation != null && options.operation !== ENGINE_IMPLEMENTATION_OPERATION) {
    installedEngineError(
      'caller cannot substitute the installed Engine operation; operation aliases are not admitted',
      'ENGINE_SINK_REJECTED',
    );
  }
  if (options.action != null
    && canonicalJson(options.action) !== canonicalJson(fixedAction())) {
    installedEngineError(
      'caller cannot substitute the installed Engine action descriptor',
      'ENGINE_SINK_REJECTED',
    );
  }
  if (options.targets != null) {
    installedEngineError(
      'caller cannot supply Engine targets; the installed sink is fixed',
      'ENGINE_SINK_REJECTED',
    );
  }
  if (options.command != null || options.path != null || options.tool != null
    || options.receipt_root != null || options.receiptRoot != null) {
    installedEngineError(
      'caller cannot supply command/path/tool/receipt_root on the installed Engine route',
      'ENGINE_SINK_REJECTED',
    );
  }
  for (const forbidden of FORBIDDEN_ENGINE_SINK_IDS) {
    if (options.sink_id === forbidden || options.catalog_id === forbidden
      || options.operation === forbidden) {
      installedEngineError(
        `installed Engine rejects foreign sink "${forbidden}"`,
        'ENGINE_SINK_REJECTED',
      );
    }
  }
}

function assertInventoryDoesNotAuthorizeOtherSinks() {
  const inventory = getAutopilotEngineControlSinkInventory();
  if (!Array.isArray(inventory) || inventory.length === 0) {
    installedEngineError('AutopilotEngine sink inventory is missing', 'ENGINE_SINK_REJECTED');
  }
  return inventory;
}

function installedCoreMatchesDurable(binding, durable) {
  if (durable.install_binding_hash !== binding.install_binding_hash
    || durable.run_binding_hash !== binding.run_binding_hash
    || durable.durable_abi_hash !== binding.durable_abi_hash
    || durable.cohort_id !== binding.cohort_id
    || durable.generation !== binding.generation) {
    return false;
  }
  for (const role of ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']) {
    if (canonicalJson(durable.service_bindings[role])
      !== canonicalJson(binding.service_bindings[role])) {
      return false;
    }
  }
  return true;
}

function durableAndKernelFromInstalled(installedBinding, options = {}) {
  const binding = normalizeInstalledBinding(installedBinding);
  if (SERVICE_ROLES.length !== 6 || !binding.service_bindings.kernel) {
    installedEngineError('installed Engine requires the six-role installed binding');
  }
  const installedDefaults = durableBindingFromInstalled(binding);
  const kernelBinding = cloneCanonical(binding.service_bindings.kernel);
  // Caller options.durableBinding / verifiedHandoff / handoffClaim / runBinding /
  // substratePlan are NOT derivation inputs. Only routeInputs-bound materials may
  // authorize the route-verified durable; otherwise the installed defaults clone
  // is returned unmodified.
  const routeInputs = options.routeInputs && typeof options.routeInputs === 'object'
    ? options.routeInputs
    : {};
  const routeDurableRaw = routeInputs.durableBinding != null
    ? routeInputs.durableBinding
    : null;
  const handoff = routeInputs.verifiedHandoff || null;
  const claim = routeInputs.handoffClaim || null;
  const runBinding = routeInputs.runBinding || null;
  const substratePlan = routeInputs.substratePlan || null;

  if (routeDurableRaw == null) {
    return {
      installedBinding: binding,
      durableBinding: cloneCanonical(installedDefaults),
      kernelBinding: cloneCanonical(kernelBinding),
    };
  }

  let durable;
  try {
    durable = normalizeDurableBinding(routeDurableRaw);
  } catch (error) {
    installedEngineError(
      `route durable binding failed canonical normalization: ${error.message}`,
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  if (!installedCoreMatchesDurable(binding, durable)) {
    installedEngineError(
      'route durable binding mismatches installed core install/run/cohort/services',
      'INSTALLED_BINDING_MISMATCH',
    );
  }

  if (handoff && claim && runBinding && substratePlan) {
    try {
      compileSemanticWitnessRoute({
        verifiedHandoff: handoff,
        handoffClaim: claim,
        runBinding,
        durableBinding: durable,
        substratePlan,
        governanceConfig: options.governanceConfig || routeInputs.governanceConfig,
        acceptanceContract: options.acceptanceContract || routeInputs.acceptanceContract,
        modeOverride: options.modeOverride !== undefined
          ? options.modeOverride
          : routeInputs.modeOverride,
        kernelBinding: options.kernelBinding || routeInputs.kernelBinding || kernelBinding,
      });
    } catch (error) {
      installedEngineError(
        `canonical installed/route verifier rejected durable materials: ${error.message}`,
        'INSTALLED_BINDING_MISMATCH',
      );
    }
    // Return the route-verifier clone unmodified — never options.durableBinding.
    return {
      installedBinding: binding,
      durableBinding: cloneCanonical(durable),
      kernelBinding: cloneCanonical(kernelBinding),
    };
  }

  if (canonicalJson(durable) !== canonicalJson(installedDefaults)) {
    installedEngineError(
      'route durable binding must exact-match installed-derived state without complete route materials',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  return {
    installedBinding: binding,
    durableBinding: cloneCanonical(installedDefaults),
    kernelBinding: cloneCanonical(kernelBinding),
  };
}

function assertDurableAuthorityMatchesInstalled(caller, derivedDurable) {
  assertObject(caller, 'caller durableBinding');
  const derivedKeys = Object.keys(derivedDurable).sort();
  const callerKeys = Object.keys(caller).sort();
  if (canonicalJson(derivedKeys) !== canonicalJson(callerKeys)) {
    const missing = derivedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(caller, key));
    const extra = callerKeys.filter((key) => !Object.prototype.hasOwnProperty.call(derivedDurable, key));
    installedEngineError(
      `caller-provided durable binding key set mismatches installed-derived state`
      + (missing.length ? `; missing ${missing.join(',')}` : '')
      + (extra.length ? `; extra ${extra.join(',')}` : ''),
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  for (const key of derivedKeys) {
    if (canonicalJson(caller[key]) !== canonicalJson(derivedDurable[key])) {
      installedEngineError(
        `caller durable binding field "${key}" mismatches installed-derived state`,
        'INSTALLED_BINDING_MISMATCH',
      );
    }
  }
}

function assertKernelAuthorityMatchesInstalled(caller, derivedKernel) {
  assertObject(caller, 'caller kernelBinding');
  const derivedKeys = Object.keys(derivedKernel).sort();
  const callerKeys = Object.keys(caller).sort();
  if (canonicalJson(derivedKeys) !== canonicalJson(callerKeys)) {
    installedEngineError(
      'caller-provided kernel binding key set mismatches installed-derived state',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  for (const key of derivedKeys) {
    if (canonicalJson(caller[key]) !== canonicalJson(derivedKernel[key])) {
      installedEngineError(
        `caller-provided kernel binding field "${key}" does not match installed state`,
        'INSTALLED_BINDING_MISMATCH',
      );
    }
  }
}

function resolveInstalledDurableBinding(options, derivedDurable) {
  let caller = null;
  if (Object.prototype.hasOwnProperty.call(options, 'durableBinding')
    && options.durableBinding != null) {
    caller = options.durableBinding;
  } else if (options.routeInputs && options.routeInputs.durableBinding != null) {
    caller = options.routeInputs.durableBinding;
  }
  if (caller) {
    assertDurableAuthorityMatchesInstalled(caller, derivedDurable);
  }
  return cloneCanonical(derivedDurable);
}

function resolveInstalledKernelBinding(options, derivedKernel) {
  if (Object.prototype.hasOwnProperty.call(options, 'kernelBinding')
    && options.kernelBinding != null) {
    assertKernelAuthorityMatchesInstalled(options.kernelBinding, derivedKernel);
  } else if (options.routeInputs && options.routeInputs.kernelBinding != null) {
    assertKernelAuthorityMatchesInstalled(options.routeInputs.kernelBinding, derivedKernel);
  }
  return cloneCanonical(derivedKernel);
}

function assertEngineRouteMatchesInstalled(engineProfile, durableBinding, kernelBinding) {
  const route = engineProfile.route;
  if (route.p36_install_binding_hash !== durableBinding.install_binding_hash
    || route.p36_run_binding_hash !== durableBinding.run_binding_hash
    || route.durable_abi_hash !== durableBinding.durable_abi_hash) {
    installedEngineError(
      'installed durable/route hash mismatch: engine profile route does not match installed binding',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  if (canonicalJson(route.kernel_binding) !== canonicalJson(kernelBinding)) {
    installedEngineError(
      'installed kernel/route hash mismatch: engine profile kernel does not match installed binding',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  for (const role of ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']) {
    const routeKey = `${role}_binding`;
    if (canonicalJson(route[routeKey]) !== canonicalJson(durableBinding.service_bindings[role])) {
      installedEngineError(
        `installed service/route hash mismatch for ${role}`,
        'INSTALLED_BINDING_MISMATCH',
      );
    }
  }
}

function compileInstalledEngineProfile(options = {}) {
  assertNotCallerSubstitutedSink(options);
  assertInventoryDoesNotAuthorizeOtherSinks();
  const derived = durableAndKernelFromInstalled(
    options.binding || options.installedBinding,
    options,
  );
  const installedBinding = derived.installedBinding;
  const durableBinding = resolveInstalledDurableBinding(options, derived.durableBinding);
  const kernelBinding = resolveInstalledKernelBinding(options, derived.kernelBinding);
  const modeOverride = options.modeOverride;
  const policy = resolveGovernancePolicy(options.governanceConfig, { modeOverride });
  assertSingleCatalog(policy);
  const contract = freezeAcceptanceContract(options.acceptanceContract);
  if (contract.contract.schema_version !== 2) {
    installedEngineError('installed Engine requires a schema_version 2 acceptance contract');
  }
  const engineProfile = compileEngineAcceptanceProfile({
    ...options.routeInputs,
    verifiedHandoff: options.verifiedHandoff || (options.routeInputs && options.routeInputs.verifiedHandoff),
    handoffClaim: options.handoffClaim || (options.routeInputs && options.routeInputs.handoffClaim),
    runBinding: options.runBinding || (options.routeInputs && options.routeInputs.runBinding),
    durableBinding,
    substratePlan: options.substratePlan || (options.routeInputs && options.routeInputs.substratePlan),
    governanceConfig: options.governanceConfig,
    acceptanceContract: options.acceptanceContract,
    kernelBinding,
    modeOverride,
    capabilityProbedAt: requireIso(options.capabilityProbedAt, 'capabilityProbedAt'),
    capabilityExpiresAt: requireIso(options.capabilityExpiresAt, 'capabilityExpiresAt'),
  });
  if (engineProfile.sink_id !== INTERNAL_ENGINE_CONTROL_SINK_ID
    || engineProfile.catalog_entry.id !== ENGINE_IMPLEMENTATION_CATALOG_ID
    || engineProfile.acceptance !== 'coordinator_v2'
    || engineProfile.effect_authority !== 'engine_implementation_only') {
    installedEngineError('engine acceptance profile is not the fixed installed sink');
  }
  assertEngineRouteMatchesInstalled(engineProfile, durableBinding, kernelBinding);
  const material = {
    schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
    kind: INSTALLED_ENGINE_PROFILE_KIND,
    profile_version: INSTALLED_ENGINE_PROFILE_VERSION,
    installed_binding: installedBinding,
    installed_binding_hash: sha256(canonicalJson(installedBinding)),
    engine_profile: engineProfile,
    engine_profile_hash: engineProfile.profile_hash,
    sink_id: INSTALLED_ENGINE_SINK_ID,
    catalog_entry: cloneCanonical(ENGINE_IMPLEMENTATION_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: fixedActionHash(),
    authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
    action_identity: cloneCanonical(INSTALLED_ENGINE_ACTION_IDENTITY),
  };
  material.profile_hash = sha256(canonicalJson(material));
  return Object.freeze(cloneCanonical(material));
}

function normalizeInstalledEngineProfile(raw) {
  const value = assertExactKeys(raw, PROFILE_KEYS, 'installed Engine profile');
  if (value.schema_version !== INSTALLED_ENGINE_SCHEMA_VERSION
    || value.kind !== INSTALLED_ENGINE_PROFILE_KIND
    || value.profile_version !== INSTALLED_ENGINE_PROFILE_VERSION) {
    installedEngineError('installed Engine profile schema/kind/version is unsupported');
  }
  if (value.sink_id !== INSTALLED_ENGINE_SINK_ID
    || canonicalJson(value.catalog_entry) !== canonicalJson(ENGINE_IMPLEMENTATION_CATALOG_ENTRY)
    || canonicalJson(value.action) !== canonicalJson(fixedAction())
    || value.action_hash !== fixedActionHash()
    || canonicalJson(value.authority) !== canonicalJson(INSTALLED_ENGINE_AUTHORITY)
    || canonicalJson(value.action_identity) !== canonicalJson(INSTALLED_ENGINE_ACTION_IDENTITY)) {
    installedEngineError('installed Engine profile must freeze the single implementation sink');
  }
  const installedBinding = normalizeInstalledBinding(value.installed_binding);
  const engineProfile = normalizeEngineAcceptanceProfile(value.engine_profile);
  if (value.installed_binding_hash !== sha256(canonicalJson(installedBinding))
    || value.engine_profile_hash !== engineProfile.profile_hash) {
    installedEngineError('installed Engine profile binding hashes are invalid');
  }
  const derived = durableAndKernelFromInstalled(installedBinding);
  if (engineProfile.route.p36_install_binding_hash !== derived.durableBinding.install_binding_hash
    || engineProfile.route.p36_run_binding_hash !== derived.durableBinding.run_binding_hash
    || engineProfile.route.durable_abi_hash !== derived.durableBinding.durable_abi_hash) {
    installedEngineError(
      'installed Engine profile route hashes do not match installed-derived durable binding',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  for (const role of ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']) {
    if (canonicalJson(engineProfile.route[`${role}_binding`])
      !== canonicalJson(derived.durableBinding.service_bindings[role])) {
      installedEngineError(
        `installed Engine profile route service ${role} does not match installed state`,
        'INSTALLED_BINDING_MISMATCH',
      );
    }
  }
  if (canonicalJson(engineProfile.route.kernel_binding) !== canonicalJson(derived.kernelBinding)) {
    installedEngineError(
      'installed Engine profile route kernel does not match installed state',
      'INSTALLED_BINDING_MISMATCH',
    );
  }
  const material = {
    schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
    kind: INSTALLED_ENGINE_PROFILE_KIND,
    profile_version: INSTALLED_ENGINE_PROFILE_VERSION,
    installed_binding: installedBinding,
    installed_binding_hash: sha256(canonicalJson(installedBinding)),
    engine_profile: engineProfile,
    engine_profile_hash: engineProfile.profile_hash,
    sink_id: INSTALLED_ENGINE_SINK_ID,
    catalog_entry: cloneCanonical(ENGINE_IMPLEMENTATION_CATALOG_ENTRY),
    action: fixedAction(),
    action_hash: fixedActionHash(),
    authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
    action_identity: cloneCanonical(INSTALLED_ENGINE_ACTION_IDENTITY),
  };
  material.profile_hash = sha256(canonicalJson(material));
  if (value.profile_hash !== material.profile_hash
    || canonicalJson(value) !== canonicalJson(material)) {
    installedEngineError('installed Engine profile is not canonical or its hash is invalid');
  }
  return cloneCanonical(material);
}

function sessionModeOverride(options) {
  const nested = options.kernelOptions && options.kernelOptions.modeOverride;
  if (options.modeOverride !== undefined && nested !== undefined
    && options.modeOverride !== nested) {
    installedEngineError('installed Engine session has conflicting mode overrides');
  }
  return options.modeOverride === undefined ? nested : options.modeOverride;
}

function createActionIdentityTracker() {
  let active = null;
  let persistedAbort = null;
  return {
    begin(decisionId, actionHash) {
      if (active && !active.terminal) {
        installedEngineError(
          'begin must not replace an authorized or open action identity; second identity rejected',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (active && active.terminal && active.status === 'accepted') {
        installedEngineError(
          'begin refuses a second identity after terminal acceptance',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (active && active.terminal && active.status === 'aborted') {
        installedEngineError(
          'begin refuses a second identity after persisted abort',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      active = {
        decision_id: decisionId,
        action_hash: actionHash,
        catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
        status: 'authorized',
        terminal: false,
        engine_observation: null,
        claim_id: null,
      };
      return cloneCanonical(active);
    },
    adopt(identity) {
      active = cloneCanonical(identity);
      if (identity.status === 'aborted' && identity.persisted_abort) {
        persistedAbort = cloneCanonical(identity.persisted_abort);
      }
      return cloneCanonical(active);
    },
    markDispatched(claimId, engineObservation) {
      if (!active || active.terminal) {
        installedEngineError('no open installed Engine action identity to dispatch');
      }
      if (active.status === 'dispatched' && active.claim_id && active.claim_id !== claimId) {
        installedEngineError(
          'installed Engine action identity drift on redispatch attempt',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      active.status = 'dispatched';
      active.claim_id = claimId;
      active.engine_observation = engineObservation
        ? cloneCanonical(engineObservation)
        : active.engine_observation;
      return cloneCanonical(active);
    },
    markAborted(reason, ledgerHead) {
      if (!active) return null;
      active.status = 'aborted';
      active.terminal = true;
      active.abort_reason = reason || 'aborted';
      const abortMaterial = {
        schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
        kind: INSTALLED_ENGINE_ABORT_KIND,
        decision_id: active.decision_id,
        action_hash: active.action_hash,
        catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
        status: 'aborted',
        abort_reason: active.abort_reason,
        ledger_head: ledgerHead || null,
        claim_id: active.claim_id || null,
      };
      abortMaterial.abort_hash = sha256(canonicalJson(abortMaterial));
      persistedAbort = cloneCanonical(abortMaterial);
      active.persisted_abort = cloneCanonical(persistedAbort);
      return cloneCanonical(active);
    },
    markAccepted() {
      if (!active) {
        installedEngineError('cannot accept without an installed Engine action identity');
      }
      active.status = 'accepted';
      active.terminal = true;
      return cloneCanonical(active);
    },
    current() {
      return active ? cloneCanonical(active) : null;
    },
    getPersistedAbort() {
      return persistedAbort ? cloneCanonical(persistedAbort) : null;
    },
    setPersistedAbort(record) {
      persistedAbort = record ? cloneCanonical(record) : null;
    },
    assertNotInferredFromEngineTerminal(engineStatus) {
      if (engineStatus === 'committed' || engineStatus === 'converged') {
        if (!active || active.status !== 'accepted') {
          return false;
        }
      }
      return active ? active.status === 'accepted' : false;
    },
  };
}

function normalizePersistedAbort(raw) {
  const value = assertObject(raw, 'persistedAbort');
  if (value.schema_version !== INSTALLED_ENGINE_SCHEMA_VERSION
    || value.kind !== INSTALLED_ENGINE_ABORT_KIND
    || value.status !== 'aborted'
    || value.catalog_id !== ENGINE_IMPLEMENTATION_CATALOG_ID
    || value.action_hash !== fixedActionHash()
    || typeof value.decision_id !== 'string'
    || typeof value.abort_reason !== 'string'
    || typeof value.abort_hash !== 'string') {
    installedEngineError('persisted abort record is invalid', 'ENGINE_ABORT_INVALID');
  }
  const material = {
    schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
    kind: INSTALLED_ENGINE_ABORT_KIND,
    decision_id: value.decision_id,
    action_hash: value.action_hash,
    catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
    status: 'aborted',
    abort_reason: value.abort_reason,
    ledger_head: value.ledger_head || null,
    claim_id: value.claim_id || null,
  };
  material.abort_hash = sha256(canonicalJson(material));
  if (value.abort_hash !== material.abort_hash) {
    installedEngineError('persisted abort abort_hash is invalid', 'ENGINE_ABORT_INVALID');
  }
  return cloneCanonical(material);
}

function fixedFrozenActionDescriptor() {
  const targets = [ENGINE_IMPLEMENTATION_TARGET];
  return cloneCanonical({
    catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
    operation: ENGINE_IMPLEMENTATION_OPERATION,
    tool_class: ENGINE_IMPLEMENTATION_TOOL_CLASS,
    action_class: 'external',
    targets,
    target_set_hash: sha256(canonicalJson(targets)),
  });
}

function isExactFixedActionDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) return false;
  return canonicalJson(descriptor) === canonicalJson(fixedFrozenActionDescriptor());
}

function reconstructActionIdentityFromLedger(ledger, persistedAbort = null) {
  assertObject(ledger, 'ledger');
  if (!Array.isArray(ledger.events)) {
    installedEngineError('resume requires a witnessed ledger with events');
  }
  if (persistedAbort != null) {
    normalizePersistedAbort(persistedAbort);
  }

  const fixedHash = fixedActionHash();
  const fixedNormalized = fixedFrozenActionDescriptor();
  const fixedNormalizedHash = sha256(canonicalJson(fixedNormalized));
  let decisionId = null;
  let actionHash = null;
  let claimId = null;
  let status = null;
  let terminal = false;
  let engineObservation = null;
  let abortReason = null;
  let decisionCount = 0;
  let claimCount = 0;
  let acceptanceCount = 0;
  let completeCount = 0;
  let abortCount = 0;

  for (const event of ledger.events) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'decision') {
      const payload = event.payload && typeof event.payload === 'object'
        ? event.payload
        : null;
      const descriptor = payload ? payload.action_descriptor : null;
      const witnessedHash = payload ? payload.action_descriptor_hash : null;
      if (!payload
        || payload.action_class !== 'external'
        || !isExactFixedActionDescriptor(descriptor)) {
        installedEngineError(
          'ledger reconstruction rejects foreign or non-canonical decision descriptors',
          'ENGINE_SINK_REJECTED',
        );
      }
      if (typeof witnessedHash !== 'string'
        || witnessedHash !== sha256(canonicalJson(descriptor))
        || witnessedHash !== fixedNormalizedHash) {
        installedEngineError(
          'ledger reconstruction requires witnessed action_descriptor_hash matching the exact fixed descriptor',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      decisionCount += 1;
      if (decisionCount > 1) {
        installedEngineError(
          'ledger reconstruction rejects duplicate or replaced installed action identities',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (typeof payload.decision_id !== 'string' || !payload.decision_id) {
        installedEngineError(
          'ledger reconstruction rejects a decision without a non-empty decision_id',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      decisionId = payload.decision_id;
      actionHash = fixedHash;
      status = 'authorized';
      terminal = false;
      claimId = null;
    }
    if (event.type === 'evidence'
      && event.payload
      && event.payload.evidence_kind === 'action_claim') {
      if (!decisionId || event.payload.decision_id !== decisionId) {
        installedEngineError(
          'ledger reconstruction rejects unlinked or foreign action claim',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      claimCount += 1;
      if (claimCount > 1) {
        installedEngineError(
          'ledger reconstruction rejects duplicate claim identity for the fixed action',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (typeof event.payload.claim_id !== 'string' || !event.payload.claim_id) {
        installedEngineError(
          'ledger reconstruction rejects a claim without a non-empty claim_id',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      claimId = event.payload.claim_id;
      if (!terminal) status = 'dispatched';
    }
    if (event.type === 'evidence'
      && event.payload
      && event.payload.evidence_kind === 'action_outcome'
      && decisionId
      && event.payload.decision_id === decisionId) {
      engineObservation = {
        engine_status_is_not_acceptance: true,
        outcome: event.payload.outcome || null,
      };
    }
    if (event.type === 'acceptance') {
      if (!decisionId || claimCount !== 1 || !claimId) {
        installedEngineError(
          'ledger reconstruction rejects unlinked acceptance without exact decision/claim linkage',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      acceptanceCount += 1;
      if (acceptanceCount > 1) {
        installedEngineError(
          'ledger reconstruction rejects duplicate acceptance terminal events',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (abortCount > 0) {
        installedEngineError(
          'ledger reconstruction rejects acceptance after abort terminal identity',
          'ENGINE_ABORT_INVALID',
        );
      }
      status = 'accepted';
      terminal = true;
    }
    if (event.type === 'complete') {
      if (!decisionId || acceptanceCount !== 1 || claimCount !== 1 || !claimId) {
        installedEngineError(
          'ledger reconstruction rejects unlinked complete without decision/claim/acceptance linkage',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      completeCount += 1;
      if (completeCount > 1) {
        installedEngineError(
          'ledger reconstruction rejects duplicate complete terminal events',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      if (status !== 'accepted') {
        installedEngineError(
          'ledger reconstruction rejects complete without a preceding acceptance',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
    }
    if (event.type === 'abort' || event.type === 'abort_request') {
      if (!decisionId) {
        installedEngineError(
          'ledger reconstruction rejects unlinked abort without a decision identity',
          'ENGINE_ABORT_INVALID',
        );
      }
      if (status === 'accepted' || acceptanceCount > 0 || completeCount > 0) {
        installedEngineError(
          'ledger reconstruction rejects abort after accepted terminal identity',
          'ENGINE_ABORT_INVALID',
        );
      }
      abortCount += 1;
      if (abortCount > 1) {
        installedEngineError(
          'ledger reconstruction rejects duplicate abort terminal events',
          'ENGINE_REDISPATCH_FORBIDDEN',
        );
      }
      status = 'aborted';
      terminal = true;
      abortReason = (event.payload && event.payload.reason) || 'aborted';
    }
  }

  if (persistedAbort != null) {
    const abort = normalizePersistedAbort(persistedAbort);
    if (!decisionId || status !== 'aborted' || !terminal) {
      installedEngineError(
        'caller-supplied abort side record cannot authorize abort without a witnessed ledger abort',
        'ENGINE_ABORT_INVALID',
      );
    }
    if (abort.decision_id !== decisionId
      || abort.action_hash !== fixedHash) {
      installedEngineError(
        'caller-supplied abort side record does not match witnessed ledger identity',
        'ENGINE_ABORT_INVALID',
      );
    }
  }

  if (!decisionId) return null;
  if (decisionCount !== 1 || actionHash !== fixedHash) {
    installedEngineError(
      'ledger reconstruction requires exactly one canonical fixed action and action hash',
      'ENGINE_REDISPATCH_FORBIDDEN',
    );
  }
  const terminalPaths = [
    acceptanceCount > 0 ? 'accepted' : null,
    abortCount > 0 ? 'aborted' : null,
  ].filter(Boolean);
  if (terminalPaths.length > 1) {
    installedEngineError(
      'ledger reconstruction rejects multiple terminal paths for one action identity',
      'ENGINE_REDISPATCH_FORBIDDEN',
    );
  }
  if (status === 'accepted') {
    if (claimCount !== 1 || !claimId) {
      installedEngineError(
        'ledger reconstruction of accepted identity requires exactly one linked claim',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (acceptanceCount !== 1) {
      installedEngineError(
        'ledger reconstruction of accepted identity requires exactly one acceptance',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (completeCount !== 1) {
      installedEngineError(
        'ledger reconstruction of accepted identity requires completeCount === 1',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (abortCount !== 0) {
      installedEngineError(
        'ledger reconstruction of accepted identity rejects any abort events',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
  }
  if (status === 'aborted') {
    if (abortCount !== 1) {
      installedEngineError(
        'ledger reconstruction of aborted identity requires exactly one abort',
        'ENGINE_ABORT_INVALID',
      );
    }
    if (acceptanceCount !== 0 || completeCount !== 0) {
      installedEngineError(
        'ledger reconstruction of aborted identity rejects acceptance/complete events',
        'ENGINE_ABORT_INVALID',
      );
    }
  }
  if (claimCount > 1) {
    installedEngineError(
      'ledger reconstruction rejects duplicate claims',
      'ENGINE_REDISPATCH_FORBIDDEN',
    );
  }
  if (status == null) {
    installedEngineError(
      'ledger reconstruction rejects missing action status (no defaulted identity)',
      'ENGINE_REDISPATCH_FORBIDDEN',
    );
  }
  return cloneCanonical({
    decision_id: decisionId,
    action_hash: fixedHash,
    catalog_id: ENGINE_IMPLEMENTATION_CATALOG_ID,
    status,
    terminal,
    engine_observation: engineObservation,
    claim_id: claimId,
    abort_reason: abortReason,
  });
}

function wrapSession(session, profile, tracker) {
  const originalExecute = session.kernel.executeAuthorizedAction.bind(session.kernel);
  const originalAccept = session.kernel.accept.bind(session.kernel);
  const originalMint = session.kernel.mintActionDecision.bind(session.kernel);

  session.kernel.mintActionDecision = function mintActionDecision(request) {
    if (request && request.actionClass === 'external' && request.actionDescriptor) {
      if (canonicalJson(request.actionDescriptor) !== canonicalJson(fixedAction())) {
        installedEngineError(
          'installed Engine rejects mint of a non-implementation action',
          'ENGINE_SINK_REJECTED',
        );
      }
    }
    const open = tracker.current();
    if (open && !open.terminal) {
      installedEngineError(
        'begin must not replace an authorized identity; second identity rejected',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (open && open.terminal) {
      installedEngineError(
        'restart/resume must reject a second identity after terminal action',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    const decision = originalMint(request);
    if (decision && decision.payload && decision.payload.decision_id) {
      tracker.begin(decision.payload.decision_id, fixedActionHash());
    }
    return decision;
  };

  session.kernel.executeAuthorizedAction = async function executeAuthorizedAction(request) {
    if (request && request.action
      && canonicalJson(request.action) !== canonicalJson(fixedAction())) {
      installedEngineError(
        'installed Engine rejects execute of a substituted action',
        'ENGINE_SINK_REJECTED',
      );
    }
    const open = tracker.current();
    if (open && open.terminal) {
      installedEngineError(
        'installed Engine refuses redispatch after terminal action identity',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (open && open.status === 'dispatched' && !open.terminal) {
      installedEngineError(
        'installed Engine refuses redispatch of an open action identity',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (open && open.status === 'aborted') {
      installedEngineError(
        'installed Engine refuses redispatch of an aborted action identity',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    const result = await originalExecute(request);
    const claimId = result && result.outcome && result.outcome.payload
      ? (result.outcome.payload.claim_id || result.outcome.payload.boundary_effect_id || null)
      : null;
    tracker.markDispatched(claimId || `claim:${request.decisionId}`, {
      engine_status_is_not_acceptance: true,
    });
    return result;
  };

  session.kernel.accept = async function accept(request) {
    const accepted = await originalAccept(request);
    if (accepted && accepted.accepted === true) {
      tracker.markAccepted();
    }
    return accepted;
  };

  return {
    kind: INSTALLED_ENGINE_SESSION_KIND,
    schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
    profile,
    ...session,
    authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
    action: fixedAction(),
    action_identity: cloneCanonical(INSTALLED_ENGINE_ACTION_IDENTITY),
    sink_id: INSTALLED_ENGINE_SINK_ID,
    action_tracker: tracker,
    getActionIdentity() {
      return tracker.current();
    },
    getPersistedAbort() {
      return tracker.getPersistedAbort();
    },
    abortAction(reason) {
      const abortReason = reason || 'aborted';
      const abortEvent = session.kernel.userAbort({
        signed: true,
        payload: { reason: abortReason },
      });
      const ledger = session.kernel.getLedger();
      const head = ledger.events.length > 0
        ? ledger.events[ledger.events.length - 1].event_hash
        : (abortEvent && abortEvent.event_hash) || null;
      const kernelState = session.kernel.getState();
      if (kernelState.status !== 'complete'
        || (kernelState.terminal_reason !== 'user_abort'
          && kernelState.terminal_reason !== 'timeout_abort')) {
        installedEngineError(
          'abortAction must leave Kernel state terminal after witnessed abort',
          'ENGINE_ABORT_INVALID',
        );
      }
      return tracker.markAborted(abortReason, head);
    },
    engineTerminalIsAcceptance(engineStatus) {
      return tracker.assertNotInferredFromEngineTerminal(engineStatus);
    },
    disclosure() {
      return session.kernel.disclosure();
    },
  };
}

function createInstalledEngineSession(options = {}) {
  assertNotCallerSubstitutedSink(options);
  const modeOverride = sessionModeOverride(options);
  const derived = durableAndKernelFromInstalled(
    options.binding || options.installedBinding,
    options,
  );
  const installedBinding = derived.installedBinding;
  const durableBinding = resolveInstalledDurableBinding(options, derived.durableBinding);
  const kernelBinding = resolveInstalledKernelBinding(options, derived.kernelBinding);
  const profile = options.profile
    ? normalizeInstalledEngineProfile(options.profile)
    : compileInstalledEngineProfile({
      ...options,
      binding: installedBinding,
      durableBinding,
      kernelBinding,
      modeOverride,
    });
  if (profile.installed_binding_hash !== sha256(canonicalJson(installedBinding))) {
    installedEngineError('installed Engine session binding does not match profile');
  }
  assertEngineRouteMatchesInstalled(
    profile.engine_profile,
    durableBinding,
    kernelBinding,
  );
  const tracker = createActionIdentityTracker();
  let session;
  try {
    session = createEngineAcceptanceSession({
      profile: profile.engine_profile,
      durableBinding,
      governanceConfig: options.governanceConfig,
      acceptanceContract: options.acceptanceContract,
      modeOverride,
      witnessInvoke: options.witnessInvoke,
      engineInvoke: options.engineInvoke,
      coordinatorInvoke: options.coordinatorInvoke,
      requestIdFactory: options.requestIdFactory,
      kernelOptions: options.kernelOptions,
    });
  } catch (error) {
    throw error;
  }
  registerIntakeFrozenAuthorities(session.witness, session.acceptance_authority);
  return Object.freeze(wrapSession(session, profile, tracker));
}

function resumeInstalledEngineSession(options = {}) {
  assertNotCallerSubstitutedSink(options);
  if (!options.ledger) {
    installedEngineError('resumeInstalledEngineSession requires the witnessed ledger');
  }
  const modeOverride = sessionModeOverride(options);
  const derived = durableAndKernelFromInstalled(
    options.binding || options.installedBinding,
    options,
  );
  const installedBinding = derived.installedBinding;
  const durableBinding = resolveInstalledDurableBinding(options, derived.durableBinding);
  const kernelBinding = resolveInstalledKernelBinding(options, derived.kernelBinding);
  const profile = options.profile
    ? normalizeInstalledEngineProfile(options.profile)
    : compileInstalledEngineProfile({
      ...options,
      binding: installedBinding,
      durableBinding,
      kernelBinding,
      modeOverride,
    });
  assertEngineRouteMatchesInstalled(profile.engine_profile, durableBinding, kernelBinding);
  const tracker = createActionIdentityTracker();

  const reconstructed = reconstructActionIdentityFromLedger(
    options.ledger,
    options.persistedAbort || null,
  );
  if (options.priorActionIdentity) {
    const prior = assertObject(options.priorActionIdentity, 'priorActionIdentity');
    if (typeof prior.decision_id !== 'string' || !prior.decision_id
      || typeof prior.action_hash !== 'string' || !prior.action_hash
      || typeof prior.status !== 'string' || !prior.status
      || typeof prior.catalog_id !== 'string' || !prior.catalog_id) {
      installedEngineError(
        'resume rejects prior identity with missing or defaulted identity fields',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (prior.catalog_id !== ENGINE_IMPLEMENTATION_CATALOG_ID) {
      installedEngineError(
        'resume refuses to adopt a foreign action identity',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (!reconstructed) {
      installedEngineError(
        'resume cannot authorize an action identity that is absent from the witnessed ledger',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    const priorClaim = Object.prototype.hasOwnProperty.call(prior, 'claim_id')
      ? prior.claim_id
      : undefined;
    const reconstructedClaim = reconstructed.claim_id || null;
    if (priorClaim === undefined) {
      installedEngineError(
        'resume rejects prior identity with missing claim_id field (null is allowed; absent is not)',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
    if (prior.decision_id !== reconstructed.decision_id
      || prior.action_hash !== reconstructed.action_hash
      || priorClaim !== reconstructedClaim
      || prior.status !== reconstructed.status
      || prior.catalog_id !== reconstructed.catalog_id) {
      installedEngineError(
        'resume rejects prior identity that does not match witnessed decision, action, claim, and status',
        'ENGINE_REDISPATCH_FORBIDDEN',
      );
    }
  }
  if (reconstructed) {
    tracker.adopt(reconstructed);
    if (reconstructed.status === 'aborted') {
      const ledger = options.ledger;
      const head = Array.isArray(ledger.events) && ledger.events.length > 0
        ? ledger.events[ledger.events.length - 1].event_hash
        : null;
      tracker.markAborted(reconstructed.abort_reason || 'aborted', head);
    }
  }

  const witness = createSemanticWitnessAdapter({
    route: profile.engine_profile.route,
    durableBinding,
    invoke: options.witnessInvoke,
    requestIdFactory: options.requestIdFactory,
  });
  let actionAuthority;
  let acceptanceAuthority;
  let resumed;
  try {
    actionAuthority = createEngineActionAuthority({
      profile: profile.engine_profile,
      durableBinding,
      invoke: options.engineInvoke,
    });
    acceptanceAuthority = createEngineAcceptanceCoordinator({
      profile: profile.engine_profile,
      durableBinding,
      witness,
      invoke: options.coordinatorInvoke,
    });
    resumed = OwnerKernel.resume({
      ...options.kernelOptions,
      ledger: options.ledger,
      witness,
      actionAuthority,
      acceptanceAuthority,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  const session = {
    ...resumed,
    profile: profile.engine_profile,
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
      resumed.kernel.stopBlockedTimeoutMonitor();
      witness.teardown();
      return true;
    },
  };
  registerIntakeFrozenAuthorities(witness, acceptanceAuthority);
  return Object.freeze(wrapSession(session, profile, tracker));
}

function verifyAcceptedLedgerCanonical(ledger, {
  witness = null,
  acceptanceAuthority = null,
} = {}) {
  assertObject(ledger, 'ledger');
  if (!Array.isArray(ledger.events) || ledger.events.length < 2) {
    installedEngineError(
      'accepted:true result requires witnessed ledger with acceptance+complete events',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  assertIntakeFrozenInstalledVerifiers(witness, acceptanceAuthority);
  if (typeof witness.getHead !== 'function'
    || typeof witness.verifyBatch !== 'function') {
    installedEngineError(
      'accepted:true result requires the authoritative witness adapter for strict replay',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  if (typeof acceptanceAuthority.verifyCommit !== 'function'
    || typeof acceptanceAuthority.verifyResolution !== 'function') {
    installedEngineError(
      'accepted:true result requires the intake-frozen acceptance coordinator for strict replay',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  let verified;
  try {
    verified = verifyLedger(ledger, {
      witness,
      requireWitness: true,
      acceptanceAuthority,
    });
  } catch (error) {
    installedEngineError(
      `accepted:true result failed canonical ledger verification: ${error.message}`,
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  if (!verified
    || verified.state.status !== 'complete'
    || verified.state.terminal_reason !== 'accepted'
    || !verified.state.acceptance
    || verified.acceptance_proof_verified !== true) {
    installedEngineError(
      'accepted:true result canonical replay must end complete/accepted with verified acceptance proof',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  return verified;
}

function deriveAcceptedFieldsFromVerifiedReplay(ledger, verified) {
  const events = ledger.events;
  const pairIndexes = [];
  for (let index = 0; index < events.length - 1; index += 1) {
    if (events[index] && events[index].type === 'acceptance'
      && events[index + 1] && events[index + 1].type === 'complete') {
      pairIndexes.push(index);
    }
  }
  if (pairIndexes.length !== 1) {
    installedEngineError(
      'accepted:true result requires exactly one adjacent acceptance+complete pair after verification',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const acceptance = events[pairIndexes[0]];
  const complete = events[pairIndexes[0] + 1];
  if (complete.event_hash !== verified.state.event_head) {
    installedEngineError(
      'accepted:true result ledger_head must be the verified complete event head',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const acceptanceState = verified.state.acceptance;
  const candidateSetHash = acceptanceState.candidate_set_hash
    || (acceptance.payload && acceptance.payload.candidate_set_hash)
    || null;
  const deliveredManifestHead = candidateSetHash;
  if (typeof candidateSetHash !== 'string' || !candidateSetHash) {
    installedEngineError(
      'accepted:true result requires verified acceptance candidate/delivered heads',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const reconstructed = reconstructActionIdentityFromLedger(ledger, null);
  if (!reconstructed
    || reconstructed.status !== 'accepted'
    || reconstructed.terminal !== true
    || reconstructed.catalog_id !== ENGINE_IMPLEMENTATION_CATALOG_ID
    || typeof reconstructed.decision_id !== 'string'
    || !reconstructed.decision_id
    || typeof reconstructed.claim_id !== 'string'
    || !reconstructed.claim_id
    || reconstructed.action_hash !== fixedActionHash()) {
    installedEngineError(
      'accepted:true result ledger replay must yield exactly one accepted fixed-sink identity',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const disclosure = deriveDisclosure(verified.state);
  const actionIdentity = {
    decision_id: reconstructed.decision_id,
    action_hash: reconstructed.action_hash,
    claim_id: reconstructed.claim_id,
    catalog_id: reconstructed.catalog_id,
    status: 'accepted',
    terminal: true,
  };
  // Engine observation is derived from verified action-outcome replay only —
  // never caller-supplied Engine terminal labels such as "committed".
  if (!reconstructed.engine_observation
    || typeof reconstructed.engine_observation !== 'object') {
    installedEngineError(
      'accepted:true result requires engine_observation derived from verified action-outcome replay',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const engineObservation = cloneCanonical(reconstructed.engine_observation);
  return {
    verified,
    reconstructed,
    status: verified.state.status,
    outcome: 'accepted',
    terminal_batch: 'atomic',
    engine_observation: engineObservation,
    disclosure,
    disclosure_hash: sha256(canonicalJson(disclosure)),
    acceptance_event_hash: acceptance.event_hash,
    complete_event_hash: complete.event_hash,
    ledger_head: verified.state.event_head,
    delivered_manifest_head: deliveredManifestHead,
    candidate_set_hash: candidateSetHash,
    action_identity: actionIdentity,
  };
}

function assertAcceptedResultMaterial(value, options = {}) {
  if (value.accepted !== true) return;
  if (!value.ledger || typeof value.ledger !== 'object' || !Array.isArray(value.ledger.events)) {
    installedEngineError(
      'accepted:true result requires the witnessed ledger; literal hashes alone cannot authorize',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  if ((value.engine_observation === 'committed' || value.engine_observation === 'converged')
    && value.terminal_batch !== 'atomic') {
    installedEngineError(
      'installed Engine result cannot accept from Engine terminal without atomic batch',
      'ACCEPTANCE_INFERRED_FROM_ENGINE',
    );
  }
  if (value.terminal_batch !== 'atomic') {
    installedEngineError(
      'accepted:true result requires atomic witnessed acceptance+complete batch',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  const verified = verifyAcceptedLedgerCanonical(value.ledger, {
    witness: options.witness,
    acceptanceAuthority: options.acceptanceAuthority,
  });
  const derived = deriveAcceptedFieldsFromVerifiedReplay(value.ledger, verified);
  if (value.status !== derived.status) {
    installedEngineError(
      'accepted:true result status must equal verified ledger status; caller status injection rejected',
    );
  }
  if (value.outcome !== derived.outcome) {
    installedEngineError(
      'accepted:true result outcome must equal verified outcome; caller outcome injection rejected',
    );
  }
  if (value.terminal_batch !== derived.terminal_batch) {
    installedEngineError(
      'accepted:true result terminal_batch must equal verified atomic batch; caller injection rejected',
      'ACCEPTANCE_BATCH_REQUIRED',
    );
  }
  if (canonicalJson(value.engine_observation) !== canonicalJson(derived.engine_observation)) {
    installedEngineError(
      'accepted:true result engine_observation must equal observation derived from verified '
      + 'action-outcome replay; caller observation injection rejected',
    );
  }
  if (!value.action_identity || typeof value.action_identity !== 'object') {
    installedEngineError('accepted:true result requires accepted action identity');
  }
  if (canonicalJson(value.action_identity) !== canonicalJson(derived.action_identity)) {
    installedEngineError(
      'accepted:true result action identity must exactly equal ledger-replayed accepted identity',
    );
  }
  if (value.ledger_head !== derived.ledger_head) {
    installedEngineError('accepted:true result ledger_head does not match verified ledger');
  }
  if (value.delivered_manifest_head !== derived.delivered_manifest_head) {
    installedEngineError(
      'accepted:true result delivered_manifest_head does not match verified acceptance',
    );
  }
  if (value.candidate_set_hash !== derived.candidate_set_hash) {
    installedEngineError(
      'accepted:true result candidate_set_hash does not match verified acceptance',
    );
  }
  if (value.acceptance_event_hash !== derived.acceptance_event_hash) {
    installedEngineError(
      'accepted:true result acceptance_event_hash does not match verified acceptance',
    );
  }
  if (value.complete_event_hash !== derived.complete_event_hash) {
    installedEngineError(
      'accepted:true result complete_event_hash does not match verified complete',
    );
  }
  if (canonicalJson(value.disclosure) !== canonicalJson(derived.disclosure)) {
    installedEngineError(
      'accepted:true result disclosure must equal disclosure reconstructed from verified ledger replay',
    );
  }
  if (value.disclosure_hash !== derived.disclosure_hash) {
    installedEngineError(
      'accepted:true result disclosure_hash must equal the verified reconstructed disclosure hash',
    );
  }
  return derived;
}

function normalizeInstalledEngineResult(raw, options = {}) {
  const value = assertExactKeys(raw, RESULT_KEYS, 'installed Engine result');
  if (value.schema_version !== INSTALLED_ENGINE_SCHEMA_VERSION
    || value.kind !== INSTALLED_ENGINE_RESULT_KIND) {
    installedEngineError('installed Engine result has unsupported schema or kind');
  }
  if (value.sink_id !== INSTALLED_ENGINE_SINK_ID) {
    installedEngineError('installed Engine result must bind the fixed sink');
  }
  if (canonicalJson(value.authority) !== canonicalJson(INSTALLED_ENGINE_AUTHORITY)) {
    installedEngineError('installed Engine result authority disclosure is invalid');
  }
  let derivedAccepted = null;
  if (value.accepted === true) {
    derivedAccepted = assertAcceptedResultMaterial(value, options);
  }
  const material = value.accepted === true
    ? {
      schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
      kind: INSTALLED_ENGINE_RESULT_KIND,
      status: derivedAccepted.status,
      outcome: derivedAccepted.outcome,
      profile_hash: value.profile_hash,
      sink_id: INSTALLED_ENGINE_SINK_ID,
      action_identity: cloneCanonical(derivedAccepted.action_identity),
      engine_observation: cloneCanonical(derivedAccepted.engine_observation),
      accepted: true,
      terminal_batch: derivedAccepted.terminal_batch,
      authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
      disclosure: cloneCanonical(derivedAccepted.disclosure),
      disclosure_hash: derivedAccepted.disclosure_hash,
      ledger: cloneCanonical(value.ledger),
      ledger_head: derivedAccepted.ledger_head,
      delivered_manifest_head: derivedAccepted.delivered_manifest_head,
      candidate_set_hash: derivedAccepted.candidate_set_hash,
      acceptance_event_hash: derivedAccepted.acceptance_event_hash,
      complete_event_hash: derivedAccepted.complete_event_hash,
    }
    : {
      schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
      kind: INSTALLED_ENGINE_RESULT_KIND,
      status: value.status,
      outcome: value.outcome,
      profile_hash: value.profile_hash,
      sink_id: INSTALLED_ENGINE_SINK_ID,
      action_identity: cloneCanonical(value.action_identity),
      engine_observation: value.engine_observation,
      accepted: false,
      terminal_batch: value.terminal_batch,
      authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
      disclosure: cloneCanonical(value.disclosure),
      disclosure_hash: value.disclosure_hash,
      ledger: value.ledger == null ? null : cloneCanonical(value.ledger),
      ledger_head: value.ledger_head,
      delivered_manifest_head: value.delivered_manifest_head,
      candidate_set_hash: value.candidate_set_hash,
      acceptance_event_hash: value.acceptance_event_hash,
      complete_event_hash: value.complete_event_hash,
    };
  material.result_hash = sha256(canonicalJson(material));
  if (value.result_hash !== material.result_hash) {
    installedEngineError('installed Engine result_hash is invalid');
  }
  return cloneCanonical(material);
}

function buildInstalledEngineResult({
  profile,
  status,
  outcome,
  engineObservation,
  accepted,
  terminalBatch,
  disclosure,
  ledgerHead,
  actionIdentity,
  deliveredManifestHead,
  candidateSetHash,
  acceptanceEventHash,
  completeEventHash,
  ledger,
  witness = null,
  acceptanceAuthority = null,
}) {
  let resolvedDisclosure = disclosure || null;
  let resolvedLedgerHead = ledgerHead || null;
  let resolvedAcceptanceHash = acceptanceEventHash || null;
  let resolvedCompleteHash = completeEventHash || null;
  let resolvedManifestHead = deliveredManifestHead || null;
  let resolvedCandidate = candidateSetHash || null;
  let resolvedIdentity = actionIdentity || null;
  let resolvedLedger = ledger || null;
  let resolvedStatus = status;
  let resolvedOutcome = outcome;
  let resolvedTerminalBatch = terminalBatch || null;

  let resolvedEngineObservation = engineObservation == null ? null : engineObservation;

  if (accepted === true) {
    if (!resolvedLedger || !Array.isArray(resolvedLedger.events)) {
      installedEngineError(
        'accepted:true result requires the witnessed ledger',
        'ACCEPTANCE_BATCH_REQUIRED',
      );
    }
    if ((engineObservation === 'committed' || engineObservation === 'converged')
      && terminalBatch != null && terminalBatch !== 'atomic') {
      installedEngineError(
        'installed Engine result cannot accept from Engine terminal without atomic batch',
        'ACCEPTANCE_INFERRED_FROM_ENGINE',
      );
    }
    const verified = verifyAcceptedLedgerCanonical(resolvedLedger, {
      witness,
      acceptanceAuthority,
    });
    const derived = deriveAcceptedFieldsFromVerifiedReplay(resolvedLedger, verified);
    // Every supplied field must exact-match verified replay; no silent rewrite.
    if (status != null && status !== derived.status) {
      installedEngineError(
        'accepted:true result rejects caller status injection; status must exact-match verified replay',
      );
    }
    if (outcome != null && outcome !== derived.outcome) {
      installedEngineError(
        'accepted:true result rejects caller outcome injection; outcome must exact-match verified replay',
      );
    }
    if (terminalBatch != null && terminalBatch !== derived.terminal_batch) {
      installedEngineError(
        'accepted:true result rejects caller terminal_batch injection',
        'ACCEPTANCE_BATCH_REQUIRED',
      );
    }
    if (resolvedLedgerHead != null && resolvedLedgerHead !== derived.ledger_head) {
      installedEngineError('caller ledger_head does not match verified ledger');
    }
    if (resolvedAcceptanceHash != null
      && resolvedAcceptanceHash !== derived.acceptance_event_hash) {
      installedEngineError('caller acceptance_event_hash does not match verified ledger');
    }
    if (resolvedCompleteHash != null
      && resolvedCompleteHash !== derived.complete_event_hash) {
      installedEngineError('caller complete_event_hash does not match verified ledger');
    }
    if (resolvedManifestHead != null
      && resolvedManifestHead !== derived.delivered_manifest_head) {
      installedEngineError('caller delivered_manifest_head does not match verified ledger');
    }
    if (resolvedCandidate != null
      && resolvedCandidate !== derived.candidate_set_hash) {
      installedEngineError('caller candidate_set_hash does not match verified ledger');
    }
    if (resolvedIdentity != null) {
      if (canonicalJson(resolvedIdentity) !== canonicalJson(derived.action_identity)) {
        installedEngineError(
          'caller action identity must exactly equal ledger-replayed accepted identity',
        );
      }
    }
    if (resolvedDisclosure != null
      && canonicalJson(resolvedDisclosure) !== canonicalJson(derived.disclosure)) {
      installedEngineError(
        'caller disclosure does not match disclosure reconstructed from verified ledger replay',
      );
    }
    if (engineObservation != null
      && canonicalJson(engineObservation) !== canonicalJson(derived.engine_observation)) {
      installedEngineError(
        'caller engineObservation must exact-match observation derived from verified '
        + 'action-outcome replay; caller observation injection rejected',
      );
    }
    resolvedLedgerHead = derived.ledger_head;
    resolvedAcceptanceHash = derived.acceptance_event_hash;
    resolvedCompleteHash = derived.complete_event_hash;
    resolvedManifestHead = derived.delivered_manifest_head;
    resolvedCandidate = derived.candidate_set_hash;
    resolvedIdentity = derived.action_identity;
    resolvedDisclosure = derived.disclosure;
    resolvedStatus = derived.status;
    resolvedOutcome = derived.outcome;
    resolvedTerminalBatch = derived.terminal_batch;
    resolvedEngineObservation = derived.engine_observation;
  } else if (resolvedLedger && Array.isArray(resolvedLedger.events)) {
    const events = resolvedLedger.events;
    if (!resolvedLedgerHead && events.length > 0) {
      resolvedLedgerHead = events[events.length - 1].event_hash;
    }
  }

  const material = {
    schema_version: INSTALLED_ENGINE_SCHEMA_VERSION,
    kind: INSTALLED_ENGINE_RESULT_KIND,
    status: resolvedStatus,
    outcome: resolvedOutcome,
    profile_hash: profile.profile_hash,
    sink_id: INSTALLED_ENGINE_SINK_ID,
    action_identity: cloneCanonical(resolvedIdentity || INSTALLED_ENGINE_ACTION_IDENTITY),
    engine_observation: resolvedEngineObservation == null
      ? null
      : cloneCanonical(resolvedEngineObservation),
    accepted: accepted === true,
    terminal_batch: resolvedTerminalBatch,
    authority: cloneCanonical(INSTALLED_ENGINE_AUTHORITY),
    disclosure: cloneCanonical(resolvedDisclosure || {}),
    disclosure_hash: sha256(canonicalJson(resolvedDisclosure || {})),
    ledger: resolvedLedger == null ? null : cloneCanonical(resolvedLedger),
    ledger_head: resolvedLedgerHead,
    delivered_manifest_head: resolvedManifestHead,
    candidate_set_hash: resolvedCandidate,
    acceptance_event_hash: resolvedAcceptanceHash,
    complete_event_hash: resolvedCompleteHash,
  };
  material.result_hash = sha256(canonicalJson(material));
  return normalizeInstalledEngineResult(material, { witness, acceptanceAuthority });
}

function rejectForeignEngineSink(sinkId) {
  if (sinkId !== INSTALLED_ENGINE_SINK_ID) {
    installedEngineError(
      `installed Engine rejects sink "${sinkId}"`,
      'ENGINE_SINK_REJECTED',
    );
  }
  return true;
}

module.exports = {
  ENGINE_IMPLEMENTATION_CATALOG_ENTRY,
  ENGINE_IMPLEMENTATION_CATALOG_ID,
  ENGINE_IMPLEMENTATION_OPERATION,
  ENGINE_IMPLEMENTATION_RECEIPT_ROOT,
  ENGINE_IMPLEMENTATION_TARGET,
  ENGINE_IMPLEMENTATION_TOOL_CLASS,
  FORBIDDEN_ENGINE_SINK_IDS,
  INSTALLED_ENGINE_ACTION_IDENTITY,
  INSTALLED_ENGINE_ABORT_KIND,
  INSTALLED_ENGINE_AUTHORITY,
  INSTALLED_ENGINE_PROFILE_KIND,
  INSTALLED_ENGINE_PROFILE_VERSION,
  INSTALLED_ENGINE_RESULT_KIND,
  INSTALLED_ENGINE_SCHEMA_VERSION,
  INSTALLED_ENGINE_SESSION_KIND,
  INSTALLED_ENGINE_SINK_ID,
  INTERNAL_ENGINE_CONTROL_SINK_ID,
  buildInstalledEngineResult,
  compileInstalledEngineProfile,
  createInstalledEngineSession,
  durableBindingFromInstalled,
  fixedAction,
  normalizeInstalledEngineProfile,
  normalizeInstalledEngineResult,
  normalizePersistedAbort,
  reconstructActionIdentityFromLedger,
  rejectForeignEngineSink,
  resumeInstalledEngineSession,
};
