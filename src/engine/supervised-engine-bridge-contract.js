'use strict';

// P3.3 freezes a future supervised Engine-to-Kernel mapping. It deliberately
// does not start a Kernel, issue an action permit, execute a sink, or accept a
// result. A later cross-UID host must consume this contract before activation.

const path = require('path');
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { ACTION_CLASS_RANK } = require('./owner-kernel/actions');
const { OwnerKernelError } = require('./owner-kernel/errors');
const {
  freezeAcceptanceContract,
  resolveGovernancePolicy,
} = require('./owner-kernel/policy');

const ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION = 1;
const ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION = 2;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS = Object.freeze(['clock', 'cwd']);
const TRUSTED_INTAKE_VERIFICATION_PATH = 'host_pinned_authenticated_intake';
const P2_ACTION_AUTHORITY_DESTINATIONS = Object.freeze([
  'mintActionDecision',
  'executeAuthorizedAction',
]);
const PERMITTED_KERNEL_DESTINATIONS = Object.freeze([
  ...P2_ACTION_AUTHORITY_DESTINATIONS,
  'delegate',
  'recordChallenge',
  'recordEvidence',
  'recordVerification',
  'resume',
]);
const CONTROL_SINK_KEYS = new Set([
  'id',
  'seam',
  'kind',
  'kernel_destinations',
  'requires_action_catalog_binding',
  'action_catalog_requirement',
]);
const ACTION_CATALOG_REQUIREMENT_KEYS = new Set([
  'operation',
  'tool_class',
  'minimum_action_class',
  'requires_mediator',
  'command_required',
]);
const REQUIRED_CONTROL_SINK_REGISTRY = Object.freeze({
  'campaign-intake': Object.freeze({ seam: 'campaignIntake', requires_action_catalog_binding: true }),
  'campaign-admission-release': Object.freeze({ seam: 'campaignAdmissionReleaser', requires_action_catalog_binding: true }),
  'review-loop-resolution': Object.freeze({ seam: 'reviewLoopResolver', requires_action_catalog_binding: false }),
  'review-dispatch': Object.freeze({ seam: 'reviewDispatcher', requires_action_catalog_binding: true }),
  'implementation-dispatch': Object.freeze({ seam: 'implementationDispatcher', requires_action_catalog_binding: true }),
  'diff-provenance': Object.freeze({ seam: 'diffProvider', requires_action_catalog_binding: true }),
  'repair-prompt-write': Object.freeze({ seam: 'repairPromptWriter', requires_action_catalog_binding: true }),
  'verification-execution': Object.freeze({ seam: 'verifyCommandRunner', requires_action_catalog_binding: true }),
  'verify-worktree-add': Object.freeze({ seam: 'gitWorktreeAdd', requires_action_catalog_binding: true }),
  'verify-worktree-remove': Object.freeze({ seam: 'gitWorktreeRemove', requires_action_catalog_binding: true }),
  'verify-worktree-cleanup': Object.freeze({ seam: 'verifyWorktreeCleanup', requires_action_catalog_binding: true }),
  'branch-force': Object.freeze({ seam: 'gitBranchForce', requires_action_catalog_binding: true }),
  'resume-inspection': Object.freeze({ seam: 'gitResumeInspect', requires_action_catalog_binding: false }),
  'diff-risk-classification': Object.freeze({ seam: 'classifyDiffRisk', requires_action_catalog_binding: false }),
  'lifecycle-observation': Object.freeze({ seam: 'lifecycleObserver', requires_action_catalog_binding: false }),
});

function freezeEntries(entries) {
  return Object.freeze(entries.map((entry) => {
    const frozen = {
      ...entry,
      kernel_destinations: Object.freeze([...entry.kernel_destinations]),
    };
    if (entry.action_catalog_requirement) {
      frozen.action_catalog_requirement = Object.freeze({ ...entry.action_catalog_requirement });
    }
    return Object.freeze(frozen);
  }));
}

// This inventory is intentionally tied to the dependency-injection seams in
// AutopilotEngine. The focused test reads that constructor and fails when a new
// callable seam is added without a corresponding supervised mapping.
const AUTOPILOT_ENGINE_CONTROL_SINKS = freezeEntries([
  {
    id: 'campaign-intake',
    seam: 'campaignIntake',
    kind: 'campaign_control',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'recordEvidence',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_campaign_intake',
      tool_class: 'campaign_control',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'campaign-admission-release',
    seam: 'campaignAdmissionReleaser',
    kind: 'campaign_control',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'recordEvidence',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_campaign_admission_release',
      tool_class: 'campaign_control',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'review-loop-resolution',
    seam: 'reviewLoopResolver',
    kind: 'policy_read',
    kernel_destinations: [],
    requires_action_catalog_binding: false,
  },
  {
    id: 'review-dispatch',
    seam: 'reviewDispatcher',
    kind: 'challenge_dispatch',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'delegate',
      'recordChallenge',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_review_dispatch',
      tool_class: 'model_runner',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'implementation-dispatch',
    seam: 'implementationDispatcher',
    kind: 'worker_dispatch',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'delegate',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_implementation_dispatch',
      tool_class: 'model_runner',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'diff-provenance',
    seam: 'diffProvider',
    kind: 'filesystem_mutation',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'recordEvidence',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_diff_materialization',
      tool_class: 'filesystem_git',
      minimum_action_class: 'reversible',
      requires_mediator: true,
    },
  },
  {
    id: 'repair-prompt-write',
    seam: 'repairPromptWriter',
    kind: 'filesystem_mutation',
    kernel_destinations: [...P2_ACTION_AUTHORITY_DESTINATIONS],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_repair_prompt_write',
      tool_class: 'filesystem',
      minimum_action_class: 'reversible',
      requires_mediator: true,
    },
  },
  {
    id: 'verification-execution',
    seam: 'verifyCommandRunner',
    kind: 'command_execution',
    kernel_destinations: [
      ...P2_ACTION_AUTHORITY_DESTINATIONS,
      'recordVerification',
    ],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_verification_command',
      tool_class: 'shell',
      minimum_action_class: 'external',
      requires_mediator: true,
      command_required: true,
    },
  },
  {
    id: 'verify-worktree-add',
    seam: 'gitWorktreeAdd',
    kind: 'worktree_mutation',
    kernel_destinations: [...P2_ACTION_AUTHORITY_DESTINATIONS],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_verify_worktree_add',
      tool_class: 'git',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'verify-worktree-remove',
    seam: 'gitWorktreeRemove',
    kind: 'worktree_mutation',
    kernel_destinations: [...P2_ACTION_AUTHORITY_DESTINATIONS],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_verify_worktree_remove',
      tool_class: 'git',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'verify-worktree-cleanup',
    seam: 'verifyWorktreeCleanup',
    kind: 'filesystem_deletion',
    kernel_destinations: [...P2_ACTION_AUTHORITY_DESTINATIONS],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_verify_worktree_cleanup',
      tool_class: 'filesystem',
      minimum_action_class: 'irreversible',
      requires_mediator: true,
    },
  },
  {
    id: 'branch-force',
    seam: 'gitBranchForce',
    kind: 'branch_mutation',
    kernel_destinations: [...P2_ACTION_AUTHORITY_DESTINATIONS],
    requires_action_catalog_binding: true,
    action_catalog_requirement: {
      operation: 'engine_branch_force',
      tool_class: 'git',
      minimum_action_class: 'external',
      requires_mediator: true,
    },
  },
  {
    id: 'resume-inspection',
    seam: 'gitResumeInspect',
    kind: 'resume_read',
    kernel_destinations: ['resume'],
    requires_action_catalog_binding: false,
  },
  {
    id: 'diff-risk-classification',
    seam: 'classifyDiffRisk',
    kind: 'policy_read',
    kernel_destinations: [],
    requires_action_catalog_binding: false,
  },
  {
    id: 'lifecycle-observation',
    seam: 'lifecycleObserver',
    kind: 'non_authoritative_observation',
    kernel_destinations: [],
    requires_action_catalog_binding: false,
  },
]);

const REQUIRED_RUNTIME_STAGES = Object.freeze([
  Object.freeze({ id: 'intake', kernel_destination: 'start' }),
  Object.freeze({ id: 'audit-reconciliation', kernel_destination: 'recordAuditReconciliation' }),
  Object.freeze({ id: 'user-abort', kernel_destination: 'userAbort' }),
  Object.freeze({ id: 'resume', kernel_destination: 'resume' }),
  Object.freeze({ id: 'final-manifest', kernel_destination: 'accept' }),
]);
const BRIDGE_METADATA = Object.freeze({
  bridge_status: 'contract_only',
  owner_kernel_authority: 'none',
  acceptance: 'not_available',
});
const CHALLENGE_MAPPING = Object.freeze({
  ordinary_review: 'not_challenge',
  required_condition: 'qualified_independent_hash_bound',
});
const TERMINAL_MAPPING = Object.freeze({
  engine_converged: 'not_accepted',
  engine_blocked: 'not_accepted',
  engine_non_converged: 'not_accepted',
  accept_requires: 'independent_coordinator_and_final_manifest',
});

function contractError(message, code = 'INVALID_SUPERVISED_ENGINE_BRIDGE_CONTRACT') {
  return new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw contractError(`${label} must be a plain object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw contractError(`${label} has unsupported key "${key}"`);
    }
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw contractError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireText(value, label, { allowNull = false } = {}) {
  if (allowNull && value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError(`${label} must be a non-empty string${allowNull ? ' or null' : ''}`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw contractError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireImmutableBase(value) {
  if (typeof value !== 'string' || !GIT_SHA_PATTERN.test(value)) {
    throw contractError('immutableBase must be a lowercase full 40-character Git SHA');
  }
  return value;
}

function normalizeWorkspaceRoot(value) {
  const root = requireText(value, 'workspaceRoot');
  if (!path.isAbsolute(root)) {
    throw contractError('workspaceRoot must be an absolute path');
  }
  return path.resolve(root);
}

function validateAutopilotEngineControlSinkInventory(sinks) {
  if (!Array.isArray(sinks) || sinks.length === 0) {
    throw contractError('AutopilotEngine control sink inventory must be a non-empty array');
  }
  const requiredIds = Object.keys(REQUIRED_CONTROL_SINK_REGISTRY);
  if (sinks.length !== requiredIds.length) {
    throw contractError('AutopilotEngine control sink inventory is missing or has an unexpected required sink');
  }
  const ids = new Set();
  const seams = new Set();
  const permittedDestinations = new Set(PERMITTED_KERNEL_DESTINATIONS);
  for (const sink of sinks) {
    const value = assertPlainObject(sink, 'AutopilotEngine control sink');
    assertOnlyKeys(value, CONTROL_SINK_KEYS, 'AutopilotEngine control sink');
    const id = requireToken(value.id, 'AutopilotEngine control sink id');
    const seam = requireToken(value.seam, `AutopilotEngine control sink ${id} seam`);
    requireToken(value.kind, `AutopilotEngine control sink ${id} kind`);
    const expectedSink = REQUIRED_CONTROL_SINK_REGISTRY[id];
    if (!expectedSink) {
      throw contractError(`AutopilotEngine control sink inventory has unsupported sink ${id}`);
    }
    if (seam !== expectedSink.seam) {
      throw contractError(`AutopilotEngine control sink ${id} must use seam ${expectedSink.seam}`);
    }
    if (ids.has(id)) {
      throw contractError(`AutopilotEngine control sink inventory has duplicate id ${id}`);
    }
    if (seams.has(seam)) {
      throw contractError(`AutopilotEngine control sink inventory has duplicate seam ${seam}`);
    }
    ids.add(id);
    seams.add(seam);
    if (!Array.isArray(value.kernel_destinations)) {
      throw contractError(`AutopilotEngine control sink ${id} kernel_destinations must be an array`);
    }
    const destinations = new Set();
    for (const destination of value.kernel_destinations) {
      const normalizedDestination = requireToken(
        destination,
        `AutopilotEngine control sink ${id} kernel destination`,
      );
      if (!permittedDestinations.has(normalizedDestination)) {
        throw contractError(
          `AutopilotEngine control sink ${id} has unsupported Kernel destination ${normalizedDestination}`,
        );
      }
      if (destinations.has(normalizedDestination)) {
        throw contractError(`AutopilotEngine control sink ${id} has duplicate Kernel destination ${normalizedDestination}`);
      }
      destinations.add(normalizedDestination);
    }
    if (typeof value.requires_action_catalog_binding !== 'boolean') {
      throw contractError(`AutopilotEngine control sink ${id} requires_action_catalog_binding must be boolean`);
    }
    if (value.requires_action_catalog_binding !== expectedSink.requires_action_catalog_binding) {
      throw contractError(`AutopilotEngine control sink ${id} has an invalid action catalog binding state`);
    }
    if (!value.requires_action_catalog_binding) {
      if (Object.prototype.hasOwnProperty.call(value, 'action_catalog_requirement')) {
        throw contractError(`AutopilotEngine control sink ${id} cannot declare an action catalog requirement`);
      }
      for (const destination of P2_ACTION_AUTHORITY_DESTINATIONS) {
        if (destinations.has(destination)) {
          throw contractError(`AutopilotEngine control sink ${id} cannot route through ${destination}`);
        }
      }
      continue;
    }
    for (const destination of P2_ACTION_AUTHORITY_DESTINATIONS) {
      if (!destinations.has(destination)) {
        throw contractError(`AutopilotEngine control sink ${id} must route through ${destination}`);
      }
    }
    const requirement = assertPlainObject(
      value.action_catalog_requirement,
      `AutopilotEngine control sink ${id} action catalog requirement`,
    );
    assertOnlyKeys(requirement, ACTION_CATALOG_REQUIREMENT_KEYS, `AutopilotEngine control sink ${id} action catalog requirement`);
    requireToken(requirement.operation, `AutopilotEngine control sink ${id} action operation`);
    requireToken(requirement.tool_class, `AutopilotEngine control sink ${id} action tool class`);
    if (!Object.prototype.hasOwnProperty.call(ACTION_CLASS_RANK, requirement.minimum_action_class)) {
      throw contractError(`AutopilotEngine control sink ${id} has an invalid action class`);
    }
    if (requirement.requires_mediator !== true) {
      throw contractError(`AutopilotEngine control sink ${id} must require mediation`);
    }
    if (Object.prototype.hasOwnProperty.call(requirement, 'command_required')
      && typeof requirement.command_required !== 'boolean') {
      throw contractError(`AutopilotEngine control sink ${id} command_required must be boolean`);
    }
  }
  return true;
}

validateAutopilotEngineControlSinkInventory(AUTOPILOT_ENGINE_CONTROL_SINKS);

function requiredActionSinks() {
  return AUTOPILOT_ENGINE_CONTROL_SINKS.filter((sink) => sink.requires_action_catalog_binding);
}

function getRequiredActionCatalogBindingIds() {
  return requiredActionSinks().map((sink) => sink.id);
}

function getAutopilotEngineControlSinkInventory() {
  return cloneCanonical(AUTOPILOT_ENGINE_CONTROL_SINKS);
}

function requireBridgeSchemaVersion(value, label) {
  if (value !== ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION
    && value !== ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) {
    throw contractError(`${label} has an unsupported schema_version`);
  }
  return value;
}

function getSupervisedEngineBridgeAbi(schemaVersion = ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION) {
  requireBridgeSchemaVersion(schemaVersion, 'supervised engine bridge ABI');
  return cloneCanonical({
    schema_version: schemaVersion,
    ...BRIDGE_METADATA,
    sink_inventory: getAutopilotEngineControlSinkInventory(),
    required_runtime_stages: REQUIRED_RUNTIME_STAGES,
    challenge_mapping: CHALLENGE_MAPPING,
    terminal_mapping: TERMINAL_MAPPING,
  });
}

function getSupervisedEngineBridgeAbiHash(schemaVersion = ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION) {
  return sha256(canonicalJson(getSupervisedEngineBridgeAbi(schemaVersion)));
}

function requireActionCatalogRequirement(sink) {
  const requirement = sink.action_catalog_requirement;
  if (!requirement || typeof requirement !== 'object') {
    throw contractError(`internal bridge inventory is missing an action catalog requirement for ${sink.id}`);
  }
  if (!ACTION_CLASS_RANK[requirement.minimum_action_class]) {
    throw contractError(`internal bridge inventory has an invalid action class for ${sink.id}`);
  }
  return requirement;
}

function normalizeActionCatalogBindings(raw, policy) {
  const value = assertPlainObject(raw, 'actionCatalogBindings');
  const required = requiredActionSinks();
  const expectedIds = new Set(required.map((sink) => sink.id));
  for (const id of Object.keys(value)) {
    if (!expectedIds.has(id)) {
      throw contractError(`actionCatalogBindings has unsupported sink "${id}"`);
    }
  }
  const catalog = Array.isArray(policy.action_catalog) ? policy.action_catalog : [];
  const boundCatalogIds = new Set();
  return required.map((sink) => {
    const requirement = requireActionCatalogRequirement(sink);
    if (!Object.prototype.hasOwnProperty.call(value, sink.id)) {
      throw contractError(`actionCatalogBindings is missing action catalog binding for ${sink.id}`);
    }
    const catalogId = requireToken(value[sink.id], `actionCatalogBindings.${sink.id}`);
    const entry = catalog.find((candidate) => candidate.id === catalogId);
    if (!entry) {
      throw contractError(
        `action catalog binding for ${sink.id} is not present in frozen policy`,
        'ACTION_CLASSIFICATION_BLOCKED',
      );
    }
    if (boundCatalogIds.has(entry.id)) {
      throw contractError(
        `action catalog binding for ${sink.id} must use a distinct frozen policy entry`,
        'ACTION_CLASSIFICATION_BLOCKED',
      );
    }
    if (entry.operation !== requirement.operation || entry.tool_class !== requirement.tool_class) {
      throw contractError(
        `action catalog binding for ${sink.id} must bind ${requirement.operation}/${requirement.tool_class}`,
        'ACTION_CLASSIFICATION_BLOCKED',
      );
    }
    if (ACTION_CLASS_RANK[entry.action_class] < ACTION_CLASS_RANK[requirement.minimum_action_class]) {
      throw contractError(
        `action catalog binding for ${sink.id} cannot lower the ${requirement.minimum_action_class} risk floor`,
        'ACTION_CLASS_DOWNGRADE',
      );
    }
    if (requirement.requires_mediator && entry.requires_mediator !== true) {
      throw contractError(
        `action catalog binding for ${sink.id} requires a mediated frozen policy entry`,
        'HOST_CAPABILITY_BLOCKED',
      );
    }
    if (requirement.command_required && entry.command_required !== true) {
      throw contractError(
        `action catalog binding for ${sink.id} requires a command-bound frozen policy entry`,
        'ACTION_CLASSIFICATION_BLOCKED',
      );
    }
    boundCatalogIds.add(entry.id);
    return {
      sink_id: sink.id,
      catalog_id: entry.id,
      catalog_entry_hash: sha256(canonicalJson(entry)),
      action_catalog_requirement_hash: sha256(canonicalJson(requirement)),
      runtime_descriptor_required: true,
      runtime_targets: 'finite_exact_non_wildcard',
    };
  });
}

function normalizeInputV1(raw) {
  const value = assertPlainObject(raw, 'supervised engine bridge contract input');
  assertOnlyKeys(value, new Set([
    'ownerRunId',
    'engineRunId',
    'invocationId',
    'governanceConfig',
    'modeOverride',
    'acceptanceContract',
    'immutableBase',
    'workspaceRoot',
    'prompt',
    'branch',
    'verifyCommand',
    'actionCatalogBindings',
  ]), 'supervised engine bridge contract input');

  for (const key of [
    'ownerRunId',
    'engineRunId',
    'invocationId',
    'governanceConfig',
    'acceptanceContract',
    'immutableBase',
    'workspaceRoot',
    'prompt',
    'branch',
    'verifyCommand',
    'actionCatalogBindings',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw contractError(`supervised engine bridge contract input is missing ${key}`);
    }
  }

  const modeOverride = Object.prototype.hasOwnProperty.call(value, 'modeOverride')
    ? value.modeOverride
    : undefined;
  if (modeOverride !== undefined && modeOverride !== null) requireToken(modeOverride, 'modeOverride');
  const resolvedPolicy = resolveGovernancePolicy(value.governanceConfig, { modeOverride });
  const frozenContract = freezeAcceptanceContract(value.acceptanceContract);
  if (frozenContract.contract.schema_version !== 2) {
    throw contractError(
      'a supervised engine bridge contract requires acceptanceContract.schema_version 2',
      'ACCEPTANCE_CONTRACT_V2_REQUIRED',
    );
  }
  const actionBindings = normalizeActionCatalogBindings(value.actionCatalogBindings, resolvedPolicy.policy);
  const ownerRunId = requireToken(value.ownerRunId, 'ownerRunId');
  const engineRunId = requireToken(value.engineRunId, 'engineRunId');
  const invocationId = requireToken(value.invocationId, 'invocationId');
  const immutableBase = requireImmutableBase(value.immutableBase);
  const workspaceRootHash = sha256(normalizeWorkspaceRoot(value.workspaceRoot));
  const promptHash = sha256(requireText(value.prompt, 'prompt'));
  const branchHash = sha256(requireText(value.branch, 'branch'));
  const verifyCommand = requireText(value.verifyCommand, 'verifyCommand', { allowNull: true });
  const verifyCommandHash = verifyCommand === null ? null : sha256(verifyCommand);
  const sinkInventoryHash = sha256(canonicalJson(getAutopilotEngineControlSinkInventory()));
  const bridgeAbiHash = getSupervisedEngineBridgeAbiHash();
  const trustedIntakeBinding = {
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    owner_run_id: ownerRunId,
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    policy_hash: resolvedPolicy.policy_hash,
    contract_hash: frozenContract.contract_hash,
    immutable_base: immutableBase,
    workspace_root_hash: workspaceRootHash,
    prompt_hash: promptHash,
    branch_hash: branchHash,
    verify_command_hash: verifyCommandHash,
    sink_inventory_hash: sinkInventoryHash,
    bridge_abi_hash: bridgeAbiHash,
  };
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    owner_run_id: ownerRunId,
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    policy_hash: resolvedPolicy.policy_hash,
    contract_hash: frozenContract.contract_hash,
    immutable_base: immutableBase,
    workspace_root_hash: workspaceRootHash,
    prompt_hash: promptHash,
    branch_hash: branchHash,
    verify_command_hash: verifyCommandHash,
    sink_inventory_hash: sinkInventoryHash,
    bridge_abi_hash: bridgeAbiHash,
    action_bindings: actionBindings,
    trusted_intake_binding: trustedIntakeBinding,
  };
}

function normalizeWorkspaceBindingV2(raw) {
  const value = assertPlainObject(raw, 'supervised engine bridge v2 workspaceBinding');
  assertOnlyKeys(value, new Set([
    'registrationId',
    'workspaceRootHash',
    'descriptorBindingHash',
    'ticketHash',
  ]), 'supervised engine bridge v2 workspaceBinding');
  for (const key of ['registrationId', 'workspaceRootHash', 'descriptorBindingHash', 'ticketHash']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw contractError(`supervised engine bridge v2 workspaceBinding is missing ${key}`);
    }
  }
  return {
    registration_id: requireToken(value.registrationId, 'workspaceBinding.registrationId'),
    workspace_root_hash: requireSha256(value.workspaceRootHash, 'workspaceBinding.workspaceRootHash'),
    descriptor_binding_hash: requireSha256(value.descriptorBindingHash, 'workspaceBinding.descriptorBindingHash'),
    ticket_hash: requireSha256(value.ticketHash, 'workspaceBinding.ticketHash'),
  };
}

function normalizeInputV2(raw) {
  const value = assertPlainObject(raw, 'supervised engine bridge v2 contract input');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'ownerRunId',
    'engineRunId',
    'invocationId',
    'governanceConfig',
    'modeOverride',
    'acceptanceContract',
    'immutableBase',
    'workspaceBinding',
    'prompt',
    'branch',
    'verifyCommand',
    'actionCatalogBindings',
  ]), 'supervised engine bridge v2 contract input');
  if (value.schema_version !== ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) {
    throw contractError(`supervised engine bridge v2 contract input.schema_version must equal ${ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION}`);
  }
  for (const key of [
    'ownerRunId',
    'engineRunId',
    'invocationId',
    'governanceConfig',
    'acceptanceContract',
    'immutableBase',
    'workspaceBinding',
    'prompt',
    'branch',
    'verifyCommand',
    'actionCatalogBindings',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw contractError(`supervised engine bridge v2 contract input is missing ${key}`);
    }
  }
  const modeOverride = Object.prototype.hasOwnProperty.call(value, 'modeOverride')
    ? value.modeOverride
    : undefined;
  if (modeOverride !== undefined && modeOverride !== null) requireToken(modeOverride, 'modeOverride');
  const resolvedPolicy = resolveGovernancePolicy(value.governanceConfig, { modeOverride });
  const frozenContract = freezeAcceptanceContract(value.acceptanceContract);
  if (frozenContract.contract.schema_version !== 2) {
    throw contractError(
      'a supervised engine bridge v2 contract requires acceptanceContract.schema_version 2',
      'ACCEPTANCE_CONTRACT_V2_REQUIRED',
    );
  }
  const actionBindings = normalizeActionCatalogBindings(value.actionCatalogBindings, resolvedPolicy.policy);
  const ownerRunId = requireToken(value.ownerRunId, 'ownerRunId');
  const engineRunId = requireToken(value.engineRunId, 'engineRunId');
  const invocationId = requireToken(value.invocationId, 'invocationId');
  const immutableBase = requireImmutableBase(value.immutableBase);
  const workspaceBinding = normalizeWorkspaceBindingV2(value.workspaceBinding);
  const promptHash = sha256(requireText(value.prompt, 'prompt'));
  const branchHash = sha256(requireText(value.branch, 'branch'));
  const verifyCommand = requireText(value.verifyCommand, 'verifyCommand', { allowNull: true });
  const verifyCommandHash = verifyCommand === null ? null : sha256(verifyCommand);
  const sinkInventoryHash = sha256(canonicalJson(getAutopilotEngineControlSinkInventory()));
  const bridgeAbiHash = getSupervisedEngineBridgeAbiHash(ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION);
  const trustedIntakeBinding = {
    schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
    owner_run_id: ownerRunId,
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    policy_hash: resolvedPolicy.policy_hash,
    contract_hash: frozenContract.contract_hash,
    immutable_base: immutableBase,
    workspace_registration_id: workspaceBinding.registration_id,
    workspace_root_hash: workspaceBinding.workspace_root_hash,
    workspace_descriptor_binding_hash: workspaceBinding.descriptor_binding_hash,
    workspace_ticket_hash: workspaceBinding.ticket_hash,
    prompt_hash: promptHash,
    branch_hash: branchHash,
    verify_command_hash: verifyCommandHash,
    sink_inventory_hash: sinkInventoryHash,
    bridge_abi_hash: bridgeAbiHash,
  };
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
    owner_run_id: ownerRunId,
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    policy_hash: resolvedPolicy.policy_hash,
    contract_hash: frozenContract.contract_hash,
    immutable_base: immutableBase,
    workspace_binding: workspaceBinding,
    prompt_hash: promptHash,
    branch_hash: branchHash,
    verify_command_hash: verifyCommandHash,
    sink_inventory_hash: sinkInventoryHash,
    bridge_abi_hash: bridgeAbiHash,
    action_bindings: actionBindings,
    trusted_intake_binding: trustedIntakeBinding,
  };
}

function normalizeInput(raw) {
  const value = assertPlainObject(raw, 'supervised engine bridge contract input');
  if (Object.prototype.hasOwnProperty.call(value, 'schema_version')) {
    if (value.schema_version === ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) return normalizeInputV2(value);
    throw contractError('supervised engine bridge contract v1 input must omit schema_version; v2 must use schema_version 2');
  }
  return normalizeInputV1(value);
}

function buildSinkMappings(actionBindings) {
  const bindings = new Map(actionBindings.map((binding) => [binding.sink_id, binding]));
  return AUTOPILOT_ENGINE_CONTROL_SINKS.map((sink) => ({
    sink_id: sink.id,
    seam: sink.seam,
    kind: sink.kind,
    kernel_destinations: [...sink.kernel_destinations],
    ...(sink.requires_action_catalog_binding
      ? { action_catalog_binding: cloneCanonical(bindings.get(sink.id)) }
      : {}),
    ...(sink.id === 'review-dispatch'
      ? { challenge_condition: 'qualified_independent_hash_bound' }
      : {}),
    ...(sink.id === 'lifecycle-observation'
      ? { authority: 'none', acceptance: 'not_available' }
      : {}),
  }));
}

function compileNormalizedInputV1(input) {
  return cloneCanonical({
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    ...BRIDGE_METADATA,
    owner_run_id: input.owner_run_id,
    engine_run_id: input.engine_run_id,
    invocation_id: input.invocation_id,
    policy_hash: input.policy_hash,
    contract_hash: input.contract_hash,
    immutable_base: input.immutable_base,
    inputs: {
      workspace_root_hash: input.workspace_root_hash,
      prompt_hash: input.prompt_hash,
      branch_hash: input.branch_hash,
      verify_command_hash: input.verify_command_hash,
    },
    intake_binding_hash: sha256(canonicalJson(input.trusted_intake_binding)),
    sink_inventory_hash: input.sink_inventory_hash,
    bridge_abi_hash: input.bridge_abi_hash,
    sink_mappings: buildSinkMappings(input.action_bindings),
    required_action_catalog_bindings: getRequiredActionCatalogBindingIds(),
    required_runtime_stages: cloneCanonical(REQUIRED_RUNTIME_STAGES),
    challenge_mapping: CHALLENGE_MAPPING,
    terminal_mapping: TERMINAL_MAPPING,
  });
}

function compileNormalizedInputV2(input) {
  return cloneCanonical({
    schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
    ...BRIDGE_METADATA,
    owner_run_id: input.owner_run_id,
    engine_run_id: input.engine_run_id,
    invocation_id: input.invocation_id,
    policy_hash: input.policy_hash,
    contract_hash: input.contract_hash,
    immutable_base: input.immutable_base,
    inputs: {
      workspace_registration_id: input.workspace_binding.registration_id,
      workspace_root_hash: input.workspace_binding.workspace_root_hash,
      workspace_descriptor_binding_hash: input.workspace_binding.descriptor_binding_hash,
      workspace_ticket_hash: input.workspace_binding.ticket_hash,
      prompt_hash: input.prompt_hash,
      branch_hash: input.branch_hash,
      verify_command_hash: input.verify_command_hash,
    },
    intake_binding_hash: sha256(canonicalJson(input.trusted_intake_binding)),
    sink_inventory_hash: input.sink_inventory_hash,
    bridge_abi_hash: input.bridge_abi_hash,
    sink_mappings: buildSinkMappings(input.action_bindings),
    required_action_catalog_bindings: getRequiredActionCatalogBindingIds(),
    required_runtime_stages: cloneCanonical(REQUIRED_RUNTIME_STAGES),
    challenge_mapping: CHALLENGE_MAPPING,
    terminal_mapping: TERMINAL_MAPPING,
  });
}

function compileNormalizedInput(input) {
  if (input.schema_version === ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) {
    return compileNormalizedInputV2(input);
  }
  return compileNormalizedInputV1(input);
}

function compileSupervisedEngineBridgeContract(raw) {
  return compileNormalizedInput(normalizeInput(raw));
}

function normalizeTrustedIntakeV1(raw) {
  const value = assertPlainObject(raw, 'trusted supervised engine bridge intake');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'owner_run_id',
    'engine_run_id',
    'invocation_id',
    'policy_hash',
    'contract_hash',
    'immutable_base',
    'workspace_root_hash',
    'prompt_hash',
    'branch_hash',
    'verify_command_hash',
    'sink_inventory_hash',
    'bridge_abi_hash',
  ]), 'trusted supervised engine bridge intake');
  if (value.schema_version !== ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION) {
    throw contractError(`trusted supervised engine bridge intake.schema_version must equal ${ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION}`);
  }
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    owner_run_id: requireToken(value.owner_run_id, 'trusted intake owner_run_id'),
    engine_run_id: requireToken(value.engine_run_id, 'trusted intake engine_run_id'),
    invocation_id: requireToken(value.invocation_id, 'trusted intake invocation_id'),
    policy_hash: requireSha256(value.policy_hash, 'trusted intake policy_hash'),
    contract_hash: requireSha256(value.contract_hash, 'trusted intake contract_hash'),
    immutable_base: requireImmutableBase(value.immutable_base),
    workspace_root_hash: requireSha256(value.workspace_root_hash, 'trusted intake workspace_root_hash'),
    prompt_hash: requireSha256(value.prompt_hash, 'trusted intake prompt_hash'),
    branch_hash: requireSha256(value.branch_hash, 'trusted intake branch_hash'),
    verify_command_hash: value.verify_command_hash === null
      ? null
      : requireSha256(value.verify_command_hash, 'trusted intake verify_command_hash'),
    sink_inventory_hash: requireSha256(value.sink_inventory_hash, 'trusted intake sink_inventory_hash'),
    bridge_abi_hash: requireSha256(value.bridge_abi_hash, 'trusted intake bridge_abi_hash'),
  };
}

function normalizeTrustedIntakeV2(raw) {
  const value = assertPlainObject(raw, 'trusted supervised engine bridge v2 intake');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'owner_run_id',
    'engine_run_id',
    'invocation_id',
    'policy_hash',
    'contract_hash',
    'immutable_base',
    'workspace_registration_id',
    'workspace_root_hash',
    'workspace_descriptor_binding_hash',
    'workspace_ticket_hash',
    'prompt_hash',
    'branch_hash',
    'verify_command_hash',
    'sink_inventory_hash',
    'bridge_abi_hash',
  ]), 'trusted supervised engine bridge v2 intake');
  if (value.schema_version !== ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) {
    throw contractError(`trusted supervised engine bridge v2 intake.schema_version must equal ${ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION}`);
  }
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
    owner_run_id: requireToken(value.owner_run_id, 'trusted v2 intake owner_run_id'),
    engine_run_id: requireToken(value.engine_run_id, 'trusted v2 intake engine_run_id'),
    invocation_id: requireToken(value.invocation_id, 'trusted v2 intake invocation_id'),
    policy_hash: requireSha256(value.policy_hash, 'trusted v2 intake policy_hash'),
    contract_hash: requireSha256(value.contract_hash, 'trusted v2 intake contract_hash'),
    immutable_base: requireImmutableBase(value.immutable_base),
    workspace_registration_id: requireToken(value.workspace_registration_id, 'trusted v2 intake workspace_registration_id'),
    workspace_root_hash: requireSha256(value.workspace_root_hash, 'trusted v2 intake workspace_root_hash'),
    workspace_descriptor_binding_hash: requireSha256(
      value.workspace_descriptor_binding_hash,
      'trusted v2 intake workspace_descriptor_binding_hash',
    ),
    workspace_ticket_hash: requireSha256(value.workspace_ticket_hash, 'trusted v2 intake workspace_ticket_hash'),
    prompt_hash: requireSha256(value.prompt_hash, 'trusted v2 intake prompt_hash'),
    branch_hash: requireSha256(value.branch_hash, 'trusted v2 intake branch_hash'),
    verify_command_hash: value.verify_command_hash === null
      ? null
      : requireSha256(value.verify_command_hash, 'trusted v2 intake verify_command_hash'),
    sink_inventory_hash: requireSha256(value.sink_inventory_hash, 'trusted v2 intake sink_inventory_hash'),
    bridge_abi_hash: requireSha256(value.bridge_abi_hash, 'trusted v2 intake bridge_abi_hash'),
  };
}

function normalizeTrustedIntake(raw) {
  const value = assertPlainObject(raw, 'trusted supervised engine bridge intake');
  if (value.schema_version === ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) return normalizeTrustedIntakeV2(value);
  return normalizeTrustedIntakeV1(value);
}

function normalizeTrustedIntakeVerification(raw) {
  const value = assertPlainObject(raw, 'trusted supervised engine bridge intake verification');
  assertOnlyKeys(value, new Set([
    'ok',
    'verification_path',
    'issuer',
    'key_id',
    'attestation_hash',
    'envelope_hash',
    'binding',
    'binding_hash',
    'plan_hash',
  ]), 'trusted supervised engine bridge intake verification');
  if (value.ok !== true) {
    throw contractError('trusted supervised engine bridge intake verifier did not authenticate the envelope');
  }
  if (value.verification_path !== TRUSTED_INTAKE_VERIFICATION_PATH) {
    throw contractError(`trusted supervised engine bridge intake verification_path must equal ${TRUSTED_INTAKE_VERIFICATION_PATH}`);
  }
  const binding = normalizeTrustedIntake(value.binding);
  const bindingHash = requireSha256(value.binding_hash, 'trusted intake verification binding_hash');
  if (bindingHash !== sha256(canonicalJson(binding))) {
    throw contractError('trusted intake verification binding_hash does not match binding');
  }
  return {
    binding,
    issuer: requireToken(value.issuer, 'trusted intake verification issuer'),
    key_id: requireToken(value.key_id, 'trusted intake verification key_id'),
    attestation_hash: requireSha256(value.attestation_hash, 'trusted intake verification attestation_hash'),
    envelope_hash: requireSha256(value.envelope_hash, 'trusted intake verification envelope_hash'),
    plan_hash: requireSha256(value.plan_hash, 'trusted intake verification plan_hash'),
  };
}

function requireTrustedIntakeVerifier(options) {
  const value = assertPlainObject(options, 'supervised engine bridge verification options');
  assertOnlyKeys(value, new Set(['trustedIntakeVerifier', 'trustedIntakeAuthority']), 'supervised engine bridge verification options');
  if (typeof value.trustedIntakeVerifier !== 'function') {
    throw contractError('supervised engine bridge verification requires a trustedIntakeVerifier host adapter');
  }
  const authority = assertPlainObject(value.trustedIntakeAuthority, 'trusted supervised engine bridge intake authority');
  assertOnlyKeys(authority, new Set(['issuer', 'key_id', 'attestation_hash']), 'trusted supervised engine bridge intake authority');
  return {
    trustedIntakeVerifier: value.trustedIntakeVerifier,
    authority: {
      issuer: requireToken(authority.issuer, 'trusted intake authority issuer'),
      key_id: requireToken(authority.key_id, 'trusted intake authority key_id'),
      attestation_hash: requireSha256(authority.attestation_hash, 'trusted intake authority attestation_hash'),
    },
  };
}

function verifySupervisedEngineBridgeContract(plan, raw, trustedIntakeEnvelope, options) {
  const input = normalizeInput(raw);
  const actual = canonicalJson(assertPlainObject(plan, 'supervised engine bridge contract'));
  const expectedPlan = compileNormalizedInput(input);
  const expected = canonicalJson(expectedPlan);
  if (actual !== expected) {
    throw contractError('supervised engine bridge contract does not match its frozen inputs');
  }
  const { trustedIntakeVerifier, authority } = requireTrustedIntakeVerifier(options);
  const expectedPlanHash = sha256(expected);
  let verification;
  try {
    verification = trustedIntakeVerifier(trustedIntakeEnvelope, {
      schema_version: input.schema_version,
      intake_binding_hash: expectedPlan.intake_binding_hash,
      sink_inventory_hash: expectedPlan.sink_inventory_hash,
      bridge_abi_hash: expectedPlan.bridge_abi_hash,
      plan_hash: expectedPlanHash,
      owner_run_id: input.owner_run_id,
      engine_run_id: input.engine_run_id,
      invocation_id: input.invocation_id,
    });
  } catch (error) {
    throw contractError(`trusted supervised engine bridge intake verifier failed: ${error.message || String(error)}`);
  }
  const trusted = normalizeTrustedIntakeVerification(verification);
  if (canonicalJson(trusted.binding) !== canonicalJson(input.trusted_intake_binding)) {
    throw contractError('supervised engine bridge contract does not match its trusted intake binding');
  }
  if (trusted.plan_hash !== expectedPlanHash) {
    throw contractError('trusted supervised engine bridge intake verification does not match the compiled plan');
  }
  if (trusted.issuer !== authority.issuer
    || trusted.key_id !== authority.key_id
    || trusted.attestation_hash !== authority.attestation_hash) {
    throw contractError('trusted supervised engine bridge intake verification does not match the host-pinned authority');
  }
  return cloneCanonical({
    verified: true,
    intake_binding_hash: expectedPlan.intake_binding_hash,
    sink_inventory_hash: expectedPlan.sink_inventory_hash,
    bridge_abi_hash: expectedPlan.bridge_abi_hash,
    plan_hash: expectedPlanHash,
    verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
    issuer: trusted.issuer,
    key_id: trusted.key_id,
    attestation_hash: trusted.attestation_hash,
    envelope_hash: trusted.envelope_hash,
  });
}

module.exports = {
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS,
  ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
  TRUSTED_INTAKE_VERIFICATION_PATH,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbi,
  getSupervisedEngineBridgeAbiHash,
  normalizeSupervisedEngineTrustedIntakeBinding: normalizeTrustedIntake,
  validateAutopilotEngineControlSinkInventory,
  verifySupervisedEngineBridgeContract,
};
