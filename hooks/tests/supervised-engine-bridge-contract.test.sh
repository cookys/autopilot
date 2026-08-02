#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const engine = require(path.join(root, 'src', 'engine'));
const {
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS,
  ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
  TRUSTED_INTAKE_VERIFICATION_PATH,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbiHash,
  validateAutopilotEngineControlSinkInventory,
  verifySupervisedEngineBridgeContract,
} = require(path.join(root, 'src', 'engine', 'supervised-engine-bridge-contract'));
const {
  canonicalJson,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
  sha256,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const hash = (value) => sha256(value);

const EXPECTED_ACTION_CATALOG_REQUIREMENTS = {
  'campaign-intake': {
    operation: 'engine_campaign_intake',
    tool_class: 'campaign_control',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'campaign-admission-release': {
    operation: 'engine_campaign_admission_release',
    tool_class: 'campaign_control',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'campaign-event-append': {
    operation: 'engine_campaign_event_append',
    tool_class: 'campaign_control',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'campaign-admission-complete': {
    operation: 'engine_campaign_admission_complete',
    tool_class: 'campaign_control',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'campaign-post-commit-checkpoint': {
    operation: 'engine_campaign_post_commit_checkpoint',
    tool_class: 'campaign_control',
    minimum_action_class: 'irreversible',
    requires_mediator: true,
  },
  'mission-terminal-reconcile': {
    operation: 'engine_mission_terminal_reconcile',
    tool_class: 'mission_control',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'review-dispatch': {
    operation: 'engine_review_dispatch',
    tool_class: 'model_runner',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'implementation-dispatch': {
    operation: 'engine_implementation_dispatch',
    tool_class: 'model_runner',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'diff-provenance': {
    operation: 'engine_diff_materialization',
    tool_class: 'filesystem_git',
    minimum_action_class: 'reversible',
    requires_mediator: true,
  },
  'repair-prompt-write': {
    operation: 'engine_repair_prompt_write',
    tool_class: 'filesystem',
    minimum_action_class: 'reversible',
    requires_mediator: true,
  },
  'verification-execution': {
    operation: 'engine_verification_command',
    tool_class: 'shell',
    minimum_action_class: 'external',
    requires_mediator: true,
    command_required: true,
  },
  'verify-worktree-add': {
    operation: 'engine_verify_worktree_add',
    tool_class: 'git',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'verify-worktree-remove': {
    operation: 'engine_verify_worktree_remove',
    tool_class: 'git',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'repair-lineage-cleanup': {
    operation: 'engine_repair_lineage_cleanup',
    tool_class: 'git',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
  'verify-worktree-cleanup': {
    operation: 'engine_verify_worktree_cleanup',
    tool_class: 'filesystem',
    minimum_action_class: 'irreversible',
    requires_mediator: true,
  },
  'branch-force': {
    operation: 'engine_branch_force',
    tool_class: 'git',
    minimum_action_class: 'external',
    requires_mediator: true,
  },
};

const EXPECTED_CONTROL_SINKS = [
  ['campaign-intake', 'campaignIntake', 'campaign_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['campaign-admission-release', 'campaignAdmissionReleaser', 'campaign_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['campaign-event-append', 'campaignEventAppender', 'campaign_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['campaign-admission-complete', 'campaignAdmissionCompleter', 'campaign_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['campaign-composition', 'campaignComposer', 'campaign_control', [], false],
  ['campaign-adjudication', 'campaignAdjudicator', 'campaign_control', [], false],
  ['campaign-disposition', 'campaignDispositionProvider', 'campaign_control', [], false],
  ['campaign-scope-check', 'campaignScopeChecker', 'campaign_control', [], false],
  ['campaign-repair-changed-paths', 'campaignRepairChangedPaths', 'campaign_control', [], false],
  ['campaign-tree-resolve', 'campaignTreeResolver', 'campaign_control', [], false],
  ['campaign-lifecycle-inspect', 'campaignLifecycleInspector', 'campaign_control', [], false],
  ['campaign-post-commit-checkpoint', 'campaignPostCommitCheckpoint', 'campaign_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['review-loop-resolution', 'reviewLoopResolver', 'policy_read', [], false],
  ['review-dispatch', 'reviewDispatcher', 'challenge_dispatch', ['mintActionDecision', 'executeAuthorizedAction', 'delegate', 'recordChallenge'], true],
  ['review-post-provider-hook', 'reviewPostProviderHook', 'fault_injection', [], false],
  ['implementation-dispatch', 'implementationDispatcher', 'worker_dispatch', ['mintActionDecision', 'executeAuthorizedAction', 'delegate'], true],
  ['diff-provenance', 'diffProvider', 'filesystem_mutation', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
  ['repair-prompt-write', 'repairPromptWriter', 'filesystem_mutation', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['verification-execution', 'verifyCommandRunner', 'command_execution', ['mintActionDecision', 'executeAuthorizedAction', 'recordVerification'], true],
  ['verify-worktree-add', 'gitWorktreeAdd', 'worktree_mutation', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['verify-worktree-remove', 'gitWorktreeRemove', 'worktree_mutation', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['repair-lineage-cleanup', 'repairLineageCleanupTransaction', 'worktree_mutation', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['verify-worktree-cleanup', 'verifyWorktreeCleanup', 'filesystem_deletion', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['branch-force', 'gitBranchForce', 'branch_mutation', ['mintActionDecision', 'executeAuthorizedAction'], true],
  ['resume-inspection', 'gitResumeInspect', 'resume_read', ['resume'], false],
  ['diff-risk-classification', 'classifyDiffRisk', 'policy_read', [], false],
  ['lifecycle-observation', 'lifecycleObserver', 'non_authoritative_observation', [], false],
  ['mission-adapter-factory', 'missionAdapterFactory', 'mission_control', [], false],
  ['mission-terminal-reconcile', 'missionTerminalReconciler', 'mission_control', ['mintActionDecision', 'executeAuthorizedAction', 'recordEvidence'], true],
];

function attestation(identity) {
  return {
    issuer: 'test',
    uri: `test://${identity}`,
    sha256: hash(identity),
    issued_at: '2026-07-23T00:00:00.000Z',
    expires_at: '2027-07-23T00:00:00.000Z',
  };
}

function roster(identity, role) {
  return {
    identity,
    model_alias: identity,
    model_version: '1',
    family: 'test',
    runner: 'test',
    role,
    attestation: attestation(identity),
  };
}

function actionCatalog() {
  return AUTOPILOT_ENGINE_CONTROL_SINKS
    .filter((sink) => sink.requires_action_catalog_binding)
    .map((sink) => ({
      id: sink.id,
      operation: EXPECTED_ACTION_CATALOG_REQUIREMENTS[sink.id].operation,
      tool_class: EXPECTED_ACTION_CATALOG_REQUIREMENTS[sink.id].tool_class,
      action_class: EXPECTED_ACTION_CATALOG_REQUIREMENTS[sink.id].minimum_action_class,
      command_required: EXPECTED_ACTION_CATALOG_REQUIREMENTS[sink.id].command_required === true,
      requires_mediator: EXPECTED_ACTION_CATALOG_REQUIREMENTS[sink.id].requires_mediator === true,
      requires_challenge: false,
    }));
}

function governanceConfig() {
  return {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led',
      owner_roster: [roster('owner-a', 'owner')],
      challenger_roster: [roster('challenger-a', 'challenger')],
      trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 },
        reversible: { requires_approval: false, max_uses: 1 },
        external: { requires_approval: true, max_uses: 1 },
        irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: 100,
      max_blocked_duration_seconds: 86400,
      action_catalog: actionCatalog(),
    },
  };
}

function acceptanceContract() {
  return {
    schema_version: 2,
    contract_id: 'supervised-engine-bridge-contract',
    artifacts: [{ id: 'source', target: 'src/engine/autopilot-engine.js' }],
    legs: [{
      id: 'verification',
      kind: 'executable',
      command: 'bash hooks/tests/autopilot-engine.test.sh',
      artifact_ids: ['source'],
    }],
  };
}

function bindings() {
  return Object.fromEntries(getRequiredActionCatalogBindingIds().map((id) => [id, id]));
}

function input(overrides = {}) {
  return {
    ownerRunId: 'owner-run-p33',
    engineRunId: 'engine-run-p33',
    invocationId: 'invocation-p33',
    governanceConfig: governanceConfig(),
    acceptanceContract: acceptanceContract(),
    immutableBase: 'a'.repeat(40),
    workspaceRoot: path.join(root, 'test-workspace'),
    prompt: 'private prompt body must never enter the bridge contract',
    branch: 'feat/private-branch-name',
    verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
    actionCatalogBindings: bindings(),
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function trustedIntakeBinding(value) {
  const resolvedPolicy = resolveGovernancePolicy(value.governanceConfig);
  const frozenContract = freezeAcceptanceContract(value.acceptanceContract);
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    owner_run_id: value.ownerRunId,
    engine_run_id: value.engineRunId,
    invocation_id: value.invocationId,
    policy_hash: resolvedPolicy.policy_hash,
    contract_hash: frozenContract.contract_hash,
    immutable_base: value.immutableBase,
    workspace_root_hash: hash(path.resolve(value.workspaceRoot)),
    prompt_hash: hash(value.prompt),
    branch_hash: hash(value.branch),
    verify_command_hash: value.verifyCommand === null ? null : hash(value.verifyCommand),
    sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())),
    bridge_abi_hash: getSupervisedEngineBridgeAbiHash(),
  };
}

const baselineInput = input();
const baselineTrustedIntakeBinding = trustedIntakeBinding(baselineInput);
const baselineTrustedIntakeEnvelope = Object.freeze({ fixture: 'host-pinned-intake-p33' });
const baselineTrustedIntakeAuthority = Object.freeze({
  issuer: 'test-host',
  key_id: 'test-host-key',
  attestation_hash: hash('test-host-attestation'),
});
let verifierContext = null;
const baselineTrustedIntakeVerifier = (envelope, context) => {
  verifierContext = context;
  if (envelope !== baselineTrustedIntakeEnvelope) return { ok: false };
  return {
    ok: true,
    verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
    issuer: baselineTrustedIntakeAuthority.issuer,
    key_id: baselineTrustedIntakeAuthority.key_id,
    attestation_hash: baselineTrustedIntakeAuthority.attestation_hash,
    envelope_hash: hash('host-pinned-intake-p33'),
    binding: baselineTrustedIntakeBinding,
    binding_hash: hash(canonicalJson(baselineTrustedIntakeBinding)),
    plan_hash: hash(canonicalJson(plan)),
  };
};
const verificationOptions = {
  trustedIntakeVerifier: baselineTrustedIntakeVerifier,
  trustedIntakeAuthority: baselineTrustedIntakeAuthority,
};
const plan = compileSupervisedEngineBridgeContract(baselineInput);
assert.equal(plan.schema_version, ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION);
assert.equal(plan.bridge_status, 'contract_only');
assert.equal(plan.owner_kernel_authority, 'none');
assert.equal(plan.acceptance, 'not_available');
assert.equal(plan.owner_run_id, 'owner-run-p33');
assert.equal(plan.engine_run_id, 'engine-run-p33');
assert.equal(plan.invocation_id, 'invocation-p33');
assert.equal(plan.immutable_base, 'a'.repeat(40));
assert.equal(plan.inputs.workspace_root_hash, hash(path.resolve(baselineInput.workspaceRoot)));
assert.equal(plan.inputs.prompt_hash, hash(baselineInput.prompt));
assert.equal(plan.inputs.branch_hash, hash(baselineInput.branch));
assert.equal(plan.inputs.verify_command_hash, hash(baselineInput.verifyCommand));
assert.equal(plan.intake_binding_hash, hash(canonicalJson(baselineTrustedIntakeBinding)));
assert.equal(plan.sink_inventory_hash, baselineTrustedIntakeBinding.sink_inventory_hash);
assert.equal(plan.bridge_abi_hash, baselineTrustedIntakeBinding.bridge_abi_hash);
assert.equal(plan.sink_mappings.length, AUTOPILOT_ENGINE_CONTROL_SINKS.length);
assert.deepEqual(
  plan.sink_mappings.map((mapping) => mapping.sink_id),
  AUTOPILOT_ENGINE_CONTROL_SINKS.map((sink) => sink.id),
);
assert.deepEqual(plan.required_action_catalog_bindings, getRequiredActionCatalogBindingIds());
assert.equal(plan.terminal_mapping.engine_converged, 'not_accepted');
assert.equal(plan.terminal_mapping.accept_requires, 'independent_coordinator_and_final_manifest');
assert.equal(plan.challenge_mapping.ordinary_review, 'not_challenge');
assert.equal(plan.challenge_mapping.required_condition, 'qualified_independent_hash_bound');
const verificationReceipt = verifySupervisedEngineBridgeContract(
  plan,
  baselineInput,
  baselineTrustedIntakeEnvelope,
  verificationOptions,
);
assert.equal(verificationReceipt.verified, true);
assert.equal(verificationReceipt.verification_path, TRUSTED_INTAKE_VERIFICATION_PATH);
assert.equal(verificationReceipt.issuer, 'test-host');
assert.equal(verificationReceipt.key_id, 'test-host-key');
assert.equal(verificationReceipt.plan_hash, hash(canonicalJson(plan)));
assert.deepEqual(verifierContext, {
  schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  intake_binding_hash: plan.intake_binding_hash,
  sink_inventory_hash: plan.sink_inventory_hash,
  bridge_abi_hash: plan.bridge_abi_hash,
  plan_hash: hash(canonicalJson(plan)),
  owner_run_id: baselineInput.ownerRunId,
  engine_run_id: baselineInput.engineRunId,
  invocation_id: baselineInput.invocationId,
});

for (const mapping of plan.sink_mappings.filter((item) => item.action_catalog_binding)) {
  assert.equal(mapping.kernel_destinations.includes('mintActionDecision'), true);
  assert.equal(mapping.kernel_destinations.includes('executeAuthorizedAction'), true);
  assert.match(mapping.action_catalog_binding.catalog_entry_hash, /^[0-9a-f]{64}$/);
  assert.match(mapping.action_catalog_binding.action_catalog_requirement_hash, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(mapping.action_catalog_binding, 'operation'), false);
  assert.equal(Object.hasOwn(mapping.action_catalog_binding, 'tool_class'), false);
}

const serialized = JSON.stringify(plan);
assert.equal(serialized.includes(baselineInput.workspaceRoot), false);
assert.equal(serialized.includes(baselineInput.prompt), false);
assert.equal(serialized.includes(baselineInput.branch), false);
assert.equal(serialized.includes(baselineInput.verifyCommand), false);
assert.equal(serialized.includes('acceptanceContract'), false);
assert.equal(serialized.includes('governanceConfig'), false);

const resolvedPolicy = resolveGovernancePolicy(baselineInput.governanceConfig);
const frozenContract = freezeAcceptanceContract(baselineInput.acceptanceContract);
assert.equal(plan.policy_hash, resolvedPolicy.policy_hash);
assert.equal(plan.contract_hash, frozenContract.contract_hash);

assert.deepEqual(
  AUTOPILOT_ENGINE_CONTROL_SINKS.map((sink) => [
    sink.id,
    sink.seam,
    sink.kind,
    [...sink.kernel_destinations],
    sink.requires_action_catalog_binding,
  ]),
  EXPECTED_CONTROL_SINKS,
);
assert.deepEqual(
  Object.fromEntries(
    AUTOPILOT_ENGINE_CONTROL_SINKS
      .filter((sink) => sink.action_catalog_requirement)
      .map((sink) => [sink.id, sink.action_catalog_requirement]),
  ),
  EXPECTED_ACTION_CATALOG_REQUIREMENTS,
);
assert.deepEqual([...AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS].sort(), [
  'clock',
  'cwd',
  'missionCampaignAdapterOptions',
  'missionCampaignGrant',
  'missionCampaignStore',
  'missionPreparedReceipt',
  'missionPreparedReceiptPath',
  'missionStatePath',
  'providerReadinessAuthority',
  'qualificationProvider',
].sort());
assert.equal(validateAutopilotEngineControlSinkInventory(getAutopilotEngineControlSinkInventory()), true);
const duplicateSinkInventory = getAutopilotEngineControlSinkInventory();
duplicateSinkInventory[1] = { ...duplicateSinkInventory[0] };
assert.throws(() => validateAutopilotEngineControlSinkInventory(duplicateSinkInventory), /duplicate id/i);
const unsupportedDestinationInventory = getAutopilotEngineControlSinkInventory();
unsupportedDestinationInventory[0].kernel_destinations = ['accept'];
assert.throws(() => validateAutopilotEngineControlSinkInventory(unsupportedDestinationInventory), /unsupported Kernel destination/i);
const duplicateDestinationInventory = getAutopilotEngineControlSinkInventory();
duplicateDestinationInventory[0].kernel_destinations = ['resume', 'resume'];
assert.throws(() => validateAutopilotEngineControlSinkInventory(duplicateDestinationInventory), /duplicate Kernel destination/i);
const truncatedInventory = getAutopilotEngineControlSinkInventory().slice(1);
assert.throws(() => validateAutopilotEngineControlSinkInventory(truncatedInventory), /missing or has an unexpected required sink/i);
const nonActionAuthorityInventory = getAutopilotEngineControlSinkInventory();
const nonActionIndex = nonActionAuthorityInventory.findIndex(
  (sink) => sink.requires_action_catalog_binding === false,
);
nonActionAuthorityInventory[nonActionIndex].kernel_destinations = ['mintActionDecision'];
assert.throws(() => validateAutopilotEngineControlSinkInventory(nonActionAuthorityInventory), /cannot route through/i);

const requiredSeams = new Set(AUTOPILOT_ENGINE_CONTROL_SINKS.map((sink) => sink.seam));
assert.equal(requiredSeams.size, AUTOPILOT_ENGINE_CONTROL_SINKS.length);
assert.deepEqual(engine.AUTOPILOT_ENGINE_CONTROL_SINKS, AUTOPILOT_ENGINE_CONTROL_SINKS);

const engineSource = fs.readFileSync(path.join(root, 'src', 'engine', 'autopilot-engine.js'), 'utf8');
const constructorStart = engineSource.indexOf('  constructor(options = {}) {');
const constructorEnd = engineSource.indexOf('\n\n  ledgerEntry(', constructorStart);
assert.notEqual(constructorStart, -1);
assert.notEqual(constructorEnd, -1);
const constructorBody = engineSource.slice(constructorStart, constructorEnd);
const directOptionKeys = Array.from(
  constructorBody.matchAll(/\boptions\.([A-Za-z0-9_]+)\b/g),
  (match) => match[1],
);
const destructuredOptionKeys = Array.from(
  constructorBody.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*options\b/g),
  (match) => match[1].split(',').map((part) => part.trim().split(/[:=]/)[0].trim()),
).flat().filter(Boolean);
assert.doesNotMatch(constructorBody, /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*options\s*;/);
assert.doesNotMatch(constructorBody, /\.\.\.\s*options\b/);
const constructorOptionKeys = new Set([...directOptionKeys, ...destructuredOptionKeys]);
const expectedConstructorOptionKeys = new Set([
  ...requiredSeams,
  ...AUTOPILOT_ENGINE_RUNTIME_CONTEXT_OPTION_KEYS,
]);
assert.deepEqual([...constructorOptionKeys].sort(), [...expectedConstructorOptionKeys].sort());

const defaultWorktreeAddStart = engineSource.indexOf('function defaultGitWorktreeAdd(');
const defaultWorktreeRemoveStart = engineSource.indexOf('function defaultGitWorktreeRemove(');
const defaultCleanupStart = engineSource.indexOf('function defaultVerifyWorktreeCleanup(');
assert.notEqual(defaultWorktreeAddStart, -1);
assert.notEqual(defaultWorktreeRemoveStart, -1);
assert.notEqual(defaultCleanupStart, -1);
assert.doesNotMatch(
  engineSource.slice(defaultWorktreeAddStart, defaultWorktreeRemoveStart),
  /\bfs\.rmSync\b/,
);
assert.doesNotMatch(
  engineSource.slice(defaultWorktreeRemoveStart, defaultCleanupStart),
  /\bfs\.rmSync\b/,
);

const unknownBinding = input();
unknownBinding.actionCatalogBindings.extra = 'extra';
assert.throws(() => compileSupervisedEngineBridgeContract(unknownBinding), /unsupported sink/i);

const missingBinding = input();
delete missingBinding.actionCatalogBindings[getRequiredActionCatalogBindingIds()[0]];
assert.throws(() => compileSupervisedEngineBridgeContract(missingBinding), /missing action catalog binding/i);

const badCatalogBinding = input();
badCatalogBinding.actionCatalogBindings[getRequiredActionCatalogBindingIds()[0]] = 'missing-catalog-entry';
assert.throws(() => compileSupervisedEngineBridgeContract(badCatalogBinding), /not present in frozen policy/i);

const firstRequiredSink = AUTOPILOT_ENGINE_CONTROL_SINKS.find((sink) => sink.requires_action_catalog_binding);
const firstCatalogEntry = (value) => value.governanceConfig.governance.action_catalog
  .find((entry) => entry.id === firstRequiredSink.id);

const unmediatedBinding = input();
firstCatalogEntry(unmediatedBinding).requires_mediator = false;
assert.throws(() => compileSupervisedEngineBridgeContract(unmediatedBinding), /requires a mediated/i);

const downgradedBinding = input();
firstCatalogEntry(downgradedBinding).action_class = 'read_only';
assert.throws(() => compileSupervisedEngineBridgeContract(downgradedBinding), /cannot lower/i);

const unrelatedBinding = input();
firstCatalogEntry(unrelatedBinding).operation = 'unrelated_operation';
assert.throws(() => compileSupervisedEngineBridgeContract(unrelatedBinding), /must bind/i);

const commandlessBinding = input();
const verificationSink = AUTOPILOT_ENGINE_CONTROL_SINKS.find((sink) => sink.id === 'verification-execution');
const verificationEntry = commandlessBinding.governanceConfig.governance.action_catalog
  .find((entry) => entry.id === verificationSink.id);
verificationEntry.command_required = false;
assert.throws(() => compileSupervisedEngineBridgeContract(commandlessBinding), /command-bound/i);

const reusedBinding = input();
const secondRequiredSink = AUTOPILOT_ENGINE_CONTROL_SINKS
  .filter((sink) => sink.requires_action_catalog_binding)[1];
reusedBinding.actionCatalogBindings[secondRequiredSink.id] = firstRequiredSink.id;
assert.throws(() => compileSupervisedEngineBridgeContract(reusedBinding), /distinct frozen policy entry/i);

const newlyMediatedSinkIds = [
  'campaign-event-append',
  'campaign-admission-complete',
  'campaign-post-commit-checkpoint',
  'mission-terminal-reconcile',
];
for (const sinkId of newlyMediatedSinkIds) {
  const sink = AUTOPILOT_ENGINE_CONTROL_SINKS.find((item) => item.id === sinkId);
  assert.ok(sink && sink.requires_action_catalog_binding);

  const missing = input();
  delete missing.actionCatalogBindings[sinkId];
  assert.throws(
    () => compileSupervisedEngineBridgeContract(missing),
    /missing action catalog binding/i,
  );

  const unmediated = input();
  unmediated.governanceConfig.governance.action_catalog
    .find((entry) => entry.id === sinkId).requires_mediator = false;
  assert.throws(
    () => compileSupervisedEngineBridgeContract(unmediated),
    /requires a mediated/i,
  );

  const downgraded = input();
  downgraded.governanceConfig.governance.action_catalog
    .find((entry) => entry.id === sinkId).action_class = sinkId === 'campaign-post-commit-checkpoint'
      ? 'external'
      : 'read_only';
  assert.throws(
    () => compileSupervisedEngineBridgeContract(downgraded),
    /cannot lower/i,
  );

  for (const destination of ['mintActionDecision', 'executeAuthorizedAction']) {
    const missingDestination = getAutopilotEngineControlSinkInventory();
    const target = missingDestination.find((item) => item.id === sinkId);
    target.kernel_destinations = target.kernel_destinations
      .filter((item) => item !== destination);
    assert.throws(
      () => validateAutopilotEngineControlSinkInventory(missingDestination),
      new RegExp(`must route through ${destination}`, 'i'),
    );
  }

  const reused = input();
  reused.actionCatalogBindings[sinkId] = firstRequiredSink.id;
  assert.throws(
    () => compileSupervisedEngineBridgeContract(reused),
    /distinct frozen policy entry/i,
  );
}

const nonV2 = input({ acceptanceContract: {
  schema_version: 1,
  contract_id: 'v1-not-enough',
  legs: [{ id: 'x', kind: 'executable', command: 'true', artifact_hashes: [hash('x')] }],
} });
assert.throws(() => compileSupervisedEngineBridgeContract(nonV2), /schema_version 2/i);

const unknownInput = input();
unknownInput.actionDescriptors = [{ targets: ['*'] }];
assert.throws(() => compileSupervisedEngineBridgeContract(unknownInput), /unsupported key/i);

const wildcardContract = input();
wildcardContract.acceptanceContract.artifacts[0].target = 'src/*.js';
assert.throws(() => compileSupervisedEngineBridgeContract(wildcardContract), /wildcard/i);

const relativeWorkspace = input({ workspaceRoot: 'relative-workspace' });
assert.throws(() => compileSupervisedEngineBridgeContract(relativeWorkspace), /absolute path/i);

const planMutationCases = [
  ['policy', (value) => { value.governanceConfig.governance.red_lines = ['deploy']; }],
  ['contract', (value) => { value.acceptanceContract.legs[0].command = 'false'; }],
  ['prompt', (value) => { value.prompt = 'different prompt'; }],
  ['branch', (value) => { value.branch = 'feat/different'; }],
  ['verify command', (value) => { value.verifyCommand = 'false'; }],
  ['base', (value) => { value.immutableBase = 'b'.repeat(40); }],
  ['workspace root', (value) => { value.workspaceRoot = path.join(root, 'other-workspace'); }],
];
for (const [label, mutate] of planMutationCases) {
  const mutated = clone(input());
  mutate(mutated);
  assert.throws(
    () => verifySupervisedEngineBridgeContract(
      plan,
      mutated,
      baselineTrustedIntakeEnvelope,
      verificationOptions,
    ),
    /does not match/i,
    label,
  );
}

const tamperedPlan = clone(plan);
tamperedPlan.acceptance = 'accepted';
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    tamperedPlan,
    baselineInput,
    baselineTrustedIntakeEnvelope,
    verificationOptions,
  ),
  /does not match/i,
);

assert.throws(
  () => verifySupervisedEngineBridgeContract(plan, baselineInput, baselineTrustedIntakeEnvelope),
  /verification options|trustedIntakeVerifier/i,
);
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    plan,
    baselineInput,
    baselineTrustedIntakeEnvelope,
    { trustedIntakeVerifier: baselineTrustedIntakeVerifier },
  ),
  /trusted.*authority/i,
);
const attackerAuthorityVerifier = (envelope, context) => ({
  ...baselineTrustedIntakeVerifier(envelope, context),
  issuer: 'attacker-host',
  key_id: 'attacker-key',
  attestation_hash: hash('attacker-attestation'),
});
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    plan,
    baselineInput,
    baselineTrustedIntakeEnvelope,
    { ...verificationOptions, trustedIntakeVerifier: attackerAuthorityVerifier },
  ),
  /host-pinned authority/i,
);
const mappingDriftBinding = {
  ...baselineTrustedIntakeBinding,
  sink_inventory_hash: hash('different-sink-inventory'),
  bridge_abi_hash: hash('different-bridge-abi'),
};
const mappingDriftVerifier = (envelope, context) => ({
  ...baselineTrustedIntakeVerifier(envelope, context),
  binding: mappingDriftBinding,
  binding_hash: hash(canonicalJson(mappingDriftBinding)),
});
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    plan,
    baselineInput,
    baselineTrustedIntakeEnvelope,
    { ...verificationOptions, trustedIntakeVerifier: mappingDriftVerifier },
  ),
  /trusted intake binding/i,
);
const planDriftVerifier = (envelope, context) => ({
  ...baselineTrustedIntakeVerifier(envelope, context),
  plan_hash: hash('different-compiled-plan'),
});
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    plan,
    baselineInput,
    baselineTrustedIntakeEnvelope,
    { ...verificationOptions, trustedIntakeVerifier: planDriftVerifier },
  ),
  /compiled plan/i,
);
const selfConsistentMutation = input({ branch: 'feat/self-consistent-but-untrusted' });
const selfConsistentPlan = compileSupervisedEngineBridgeContract(selfConsistentMutation);
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    selfConsistentPlan,
    selfConsistentMutation,
    baselineTrustedIntakeEnvelope,
    verificationOptions,
  ),
  /trusted intake binding/i,
);

const v2WorkspaceBinding = {
  registrationId: 'p35d-workspace-main',
  workspaceRootHash: hash('p35d-root-held-workspace'),
  descriptorBindingHash: hash('p35d-root-held-descriptor'),
  ticketHash: hash('p35d-root-issued-ticket'),
};
const v2Input = {
  schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
  ownerRunId: 'owner-run-p35d',
  engineRunId: 'engine-run-p35d',
  invocationId: 'invocation-p35d',
  governanceConfig: governanceConfig(),
  acceptanceContract: acceptanceContract(),
  immutableBase: 'b'.repeat(40),
  workspaceBinding: v2WorkspaceBinding,
  prompt: 'v2 owner prompt remains hash-only',
  branch: 'feat/p35d-path-free',
  verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
  actionCatalogBindings: bindings(),
};
const v2Plan = compileSupervisedEngineBridgeContract(v2Input);
const v2TrustedIntakeBinding = {
  schema_version: ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
  owner_run_id: v2Input.ownerRunId,
  engine_run_id: v2Input.engineRunId,
  invocation_id: v2Input.invocationId,
  policy_hash: resolveGovernancePolicy(v2Input.governanceConfig).policy_hash,
  contract_hash: freezeAcceptanceContract(v2Input.acceptanceContract).contract_hash,
  immutable_base: v2Input.immutableBase,
  workspace_registration_id: v2WorkspaceBinding.registrationId,
  workspace_root_hash: v2WorkspaceBinding.workspaceRootHash,
  workspace_descriptor_binding_hash: v2WorkspaceBinding.descriptorBindingHash,
  workspace_ticket_hash: v2WorkspaceBinding.ticketHash,
  prompt_hash: hash(v2Input.prompt),
  branch_hash: hash(v2Input.branch),
  verify_command_hash: hash(v2Input.verifyCommand),
  sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())),
  bridge_abi_hash: getSupervisedEngineBridgeAbiHash(ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION),
};
const v2PlanHash = hash(canonicalJson(v2Plan));
let v2VerifierContext = null;
const v2Authority = {
  issuer: 'test-host-v2',
  key_id: 'test-host-v2-key',
  attestation_hash: hash('test-host-v2-attestation'),
};
const v2Receipt = verifySupervisedEngineBridgeContract(
  v2Plan,
  v2Input,
  { fixture: 'host-pinned-intake-p35d' },
  {
    trustedIntakeVerifier: (_envelope, context) => {
      v2VerifierContext = context;
      return {
        ok: true,
        verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
        issuer: v2Authority.issuer,
        key_id: v2Authority.key_id,
        attestation_hash: v2Authority.attestation_hash,
        envelope_hash: hash('host-pinned-intake-p35d'),
        binding: v2TrustedIntakeBinding,
        binding_hash: hash(canonicalJson(v2TrustedIntakeBinding)),
        plan_hash: v2PlanHash,
      };
    },
    trustedIntakeAuthority: v2Authority,
  },
);
assert.equal(v2Plan.schema_version, ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION);
assert.equal(v2Plan.inputs.workspace_registration_id, v2WorkspaceBinding.registrationId);
assert.equal(v2Plan.inputs.workspace_ticket_hash, v2WorkspaceBinding.ticketHash);
assert.equal(v2Plan.inputs.workspace_descriptor_binding_hash, v2WorkspaceBinding.descriptorBindingHash);
assert.equal(JSON.stringify(v2Plan).includes('workspaceRoot'), false);
assert.equal(JSON.stringify(v2Plan).includes('/private/raw-path'), false);
assert.equal(v2Receipt.verified, true);
assert.equal(v2VerifierContext.schema_version, ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION);
assert.throws(
  () => compileSupervisedEngineBridgeContract({ ...v2Input, workspaceRoot: '/private/raw-path' }),
  /unsupported key/i,
);
assert.throws(
  () => compileSupervisedEngineBridgeContract({ ...v2Input, schema_version: 1 }),
  /must omit schema_version|schema_version 2/i,
);
for (const [label, mutate] of [
  ['registration', (value) => { value.workspaceBinding.registrationId = 'p35d-other'; }],
  ['workspace hash', (value) => { value.workspaceBinding.workspaceRootHash = hash('other-root'); }],
  ['descriptor', (value) => { value.workspaceBinding.descriptorBindingHash = hash('other-descriptor'); }],
  ['ticket', (value) => { value.workspaceBinding.ticketHash = hash('other-ticket'); }],
  ['base', (value) => { value.immutableBase = 'c'.repeat(40); }],
]) {
  const mutated = clone(v2Input);
  mutate(mutated);
  assert.throws(
    () => verifySupervisedEngineBridgeContract(
      v2Plan,
      mutated,
      { fixture: 'host-pinned-intake-p35d' },
      {
        trustedIntakeVerifier: () => ({
          ok: true,
          verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
          issuer: v2Authority.issuer,
          key_id: v2Authority.key_id,
          attestation_hash: v2Authority.attestation_hash,
          envelope_hash: hash('host-pinned-intake-p35d'),
          binding: v2TrustedIntakeBinding,
          binding_hash: hash(canonicalJson(v2TrustedIntakeBinding)),
          plan_hash: v2PlanHash,
        }),
        trustedIntakeAuthority: v2Authority,
      },
    ),
    /does not match/i,
    label,
  );
}
assert.throws(
  () => verifySupervisedEngineBridgeContract(
    v2Plan,
    v2Input,
    baselineTrustedIntakeEnvelope,
    verificationOptions,
  ),
  /trusted intake binding|host-pinned authority/i,
);

console.log(`sink_inventory=${AUTOPILOT_ENGINE_CONTROL_SINKS.length}`);
console.log(`action_catalog_bindings=${getRequiredActionCatalogBindingIds().length}`);
console.log('sensitive_inputs_omitted=true');
console.log('contract_only=true');
console.log('mutation_rejected=true');
console.log('host_intake_verifier_required=true');
console.log('workspace_binding=true');
console.log('mediated_mapping=true');
console.log('host_mapping_pinned=true');
console.log('host_authority_pinned=true');
console.log('descriptor_bound_v2_is_path_free_and_cross_version_closed=true');
NODE
)"
NODE_STATUS=$?

assert_eq "$NODE_STATUS" "0" "supervised engine bridge contract node fixture exits successfully"
assert_contains "$OUT" "sink_inventory=29" "all injected engine control sinks are covered"
assert_contains "$OUT" "action_catalog_bindings=16" "every mutable sink requires a frozen catalog binding"
assert_contains "$OUT" "sensitive_inputs_omitted=true" "compiled contract contains hashes rather than raw sensitive inputs"
assert_contains "$OUT" "contract_only=true" "bridge remains explicitly non-authoritative"
assert_contains "$OUT" "mutation_rejected=true" "frozen inputs and compiled contract tampering fail closed"
assert_contains "$OUT" "host_intake_verifier_required=true" "verification requires a host trusted-intake verifier"
assert_contains "$OUT" "workspace_binding=true" "workspace substitution is bound by hash"
assert_contains "$OUT" "mediated_mapping=true" "mutable sinks require mediated P2 action mappings"
assert_contains "$OUT" "host_mapping_pinned=true" "host verification pins the static bridge mapping and compiled plan"
assert_contains "$OUT" "host_authority_pinned=true" "host verification pins the configured intake authority"
assert_contains "$OUT" "descriptor_bound_v2_is_path_free_and_cross_version_closed=true" "v2 binds the root ticket and rejects raw-path or cross-version input"

finalize_test
