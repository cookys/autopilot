'use strict';

// P3.5b records that an already authenticated Engine bridge plan was observed.
// It never starts the live Engine, invokes a Kernel, or mediates an effect.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');

const SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION = 1;
const BRIDGE_V1_SCHEMA_VERSION = 1;
const BRIDGE_V2_SCHEMA_VERSION = 2;
const SHADOW_ENGINE_STATE_DIRECTORY = 'shadow-engine';
const SHADOW_INTAKE_RECORDED = 'shadow_intake_recorded';
const SHADOW_INTAKE_RECOVERY_REQUIRED = 'shadow_intake_recovery_required';
const MAX_STATE_BYTES = 128 * 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STATE_NAME_PATTERN = /^([0-9a-f]{64})\.(pending|recorded|recovery-required)\.json$/;
const TEMPORARY_NAME_PATTERN = /^\.([0-9a-f]{64})\.(pending|recorded|recovery-required)\.json\.pending-([0-9a-f]{32})$/;

class SupervisedShadowEngineConsumerError extends Error {
  constructor(message, code = 'SUPERVISED_SHADOW_ENGINE_INVALID') {
    super(message);
    this.name = 'SupervisedShadowEngineConsumerError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new SupervisedShadowEngineConsumerError(message, code);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  requirePlainObject(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an unexpected key set`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  requirePlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unsupported key ${key}`);
  }
  return value;
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    fail(`${label} must be a bounded token`);
  }
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a bounded integer`);
  }
  return value;
}

function requireNullableDigest(value, label) {
  return value === null ? null : requireDigest(value, label);
}

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value || value === '/') {
    fail(`${label} must be a canonical non-root absolute path`);
  }
  return value;
}

function requirePrivateDirectory(directory, label, { create = false } = {}) {
  const target = requireAbsolutePath(directory, label);
  if (create) {
    try {
      fs.mkdirSync(target, { mode: 0o700 });
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
  }
  let initial;
  try {
    initial = fs.lstatSync(target);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (expectedUid === null
    || initial.isSymbolicLink()
    || !initial.isDirectory()
    || initial.uid !== expectedUid
    || (initial.mode & 0o777) !== 0o700) {
    fail(`${label} does not have the expected identity and mode`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== initial.dev
      || opened.ino !== initial.ino
      || !opened.isDirectory()
      || opened.uid !== expectedUid
      || (opened.mode & 0o777) !== 0o700) {
      fail(`${label} changed while being opened`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
    }
    return Object.freeze({
      descriptor,
      logical_path: target,
      proc_path: `/proc/self/fd/${descriptor}`,
    });
  } catch (error) {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    if (error instanceof SupervisedShadowEngineConsumerError) throw error;
    fail(`${label} cannot be opened safely: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
}

function closeDirectory(directory) {
  if (directory && Number.isInteger(directory.descriptor)) fs.closeSync(directory.descriptor);
}

function statePath(directory, filename) {
  return `${directory.proc_path}/${filename}`;
}

function assertPrivateStateFileStat(stat, label, { allowEmpty = false } = {}) {
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (expectedUid === null
    || stat.isSymbolicLink()
    || !stat.isFile()
    || stat.uid !== expectedUid
    || stat.nlink !== 1
    || (stat.mode & 0o777) !== 0o600
    || (!allowEmpty && stat.size <= 0)
    || stat.size > MAX_STATE_BYTES) {
    fail(`${label} does not have the expected identity, mode, or size`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
}

function readPrivateCanonicalState(directory, filename, label) {
  const filePath = statePath(directory, filename);
  let initial;
  try {
    initial = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail(`${label} cannot be inspected: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
  assertPrivateStateFileStat(initial, label);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== initial.dev
      || opened.ino !== initial.ino
      || opened.size !== initial.size) {
      fail(`${label} changed while being opened`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
    }
    assertPrivateStateFileStat(opened, label);
    const content = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < content.length) {
      const read = fs.readSync(descriptor, content, offset, content.length - offset, null);
      if (read <= 0) fail(`${label} ended before its stated size`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
      offset += read;
    }
    const final = fs.fstatSync(descriptor);
    if (final.dev !== opened.dev || final.ino !== opened.ino || final.size !== opened.size) {
      fail(`${label} changed while being read`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
    }
    let text;
    let value;
    try {
      text = content.toString('utf8');
      value = JSON.parse(text);
    } catch (_error) {
      fail(`${label} is not valid UTF-8 JSON`, 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
    }
    if (canonicalJson(value) !== text) {
      fail(`${label} is not canonical JSON`, 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
    }
    return value;
  } catch (error) {
    if (error instanceof SupervisedShadowEngineConsumerError) throw error;
    fail(`${label} cannot be read safely: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeAll(descriptor, content, label) {
  let offset = 0;
  while (offset < content.length) {
    const written = fs.writeSync(descriptor, content, offset, content.length - offset, null);
    if (written <= 0) fail(`${label} write was short`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
    offset += written;
  }
}

function fsyncDirectory(directory, label) {
  try {
    fs.fsyncSync(directory.descriptor);
  } catch (error) {
    fail(`${label} cannot be persisted: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
  }
}

function randomTemporaryName(filename) {
  return `.${filename}.pending-${crypto.randomBytes(16).toString('hex')}`;
}

function writeExclusiveState(directory, filename, value, label) {
  const content = Buffer.from(canonicalJson(value), 'utf8');
  if (content.length === 0 || content.length > MAX_STATE_BYTES) {
    fail(`${label} exceeds the fixed state byte limit`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
  }
  const temporaryName = randomTemporaryName(filename);
  const temporaryPath = statePath(directory, temporaryName);
  const destinationPath = statePath(directory, filename);
  let descriptor;
  let temporaryExists = false;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    temporaryExists = true;
    fs.fchmodSync(descriptor, 0o600);
    assertPrivateStateFileStat(fs.fstatSync(descriptor), `${label} temporary`, { allowEmpty: true });
    writeAll(descriptor, content, label);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, destinationPath);
    fs.unlinkSync(temporaryPath);
    temporaryExists = false;
    fsyncDirectory(directory, label);
  } catch (error) {
    if (error instanceof SupervisedShadowEngineConsumerError) throw error;
    if (error && error.code === 'EEXIST') {
      fail(`${label} already exists`, 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
    }
    fail(`${label} could not be published: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryExists) {
      removePrivateTemporaryFile(directory, temporaryName, filename, `${label} temporary`);
    }
  }
}

function removePrivateStateFile(directory, filename, label) {
  const value = readPrivateCanonicalState(directory, filename, label);
  if (value === null) return;
  try {
    fs.unlinkSync(statePath(directory, filename));
    fsyncDirectory(directory, label);
  } catch (error) {
    fail(`${label} cannot be removed: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
  }
}

function removePrivateTemporaryFile(directory, filename, targetName, label) {
  const filePath = statePath(directory, filename);
  let initial;
  try {
    initial = fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    fail(`${label} cannot be inspected: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (expectedUid === null
    || initial.isSymbolicLink()
    || !initial.isFile()
    || initial.uid !== expectedUid
    || (initial.mode & 0o777) !== 0o600
    || initial.nlink < 1
    || initial.nlink > 2
    || initial.size > MAX_STATE_BYTES) {
    fail(`${label} does not have the expected identity, mode, or size`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
  }
  if (initial.nlink === 2) {
    let target;
    try {
      target = fs.lstatSync(statePath(directory, targetName));
    } catch (error) {
      fail(`${label} has an unexpected second link: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
    }
    if (target.isSymbolicLink()
      || !target.isFile()
      || target.uid !== expectedUid
      || (target.mode & 0o777) !== 0o600
      || target.nlink !== 2
      || target.dev !== initial.dev
      || target.ino !== initial.ino) {
      fail(`${label} second link is not its expected published state`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
    }
  }
  try {
    fs.unlinkSync(filePath);
    fsyncDirectory(directory, label);
  } catch (error) {
    fail(`${label} cannot be removed: ${error.message}`, 'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED');
  }
}

function normalizePlan(raw) {
  const value = requirePlainObject(raw, 'compiled supervised Engine bridge plan');
  const bridgeSchemaVersion = value.schema_version;
  if (bridgeSchemaVersion !== BRIDGE_V1_SCHEMA_VERSION && bridgeSchemaVersion !== BRIDGE_V2_SCHEMA_VERSION) {
    fail('compiled supervised Engine bridge plan schema is unsupported');
  }
  const inputs = requireExactKeys(value.inputs, new Set(
    bridgeSchemaVersion === BRIDGE_V2_SCHEMA_VERSION
      ? [
        'workspace_registration_id',
        'workspace_root_hash',
        'workspace_descriptor_binding_hash',
        'workspace_ticket_hash',
        'prompt_hash',
        'branch_hash',
        'verify_command_hash',
      ]
      : [
        'workspace_root_hash',
        'prompt_hash',
        'branch_hash',
        'verify_command_hash',
      ],
  ), 'compiled supervised Engine bridge plan.inputs');
  return {
    schema_version: bridgeSchemaVersion,
    plan_hash: sha256(canonicalJson(value)),
    owner_run_id: requireToken(value.owner_run_id, 'compiled supervised Engine bridge plan.owner_run_id'),
    engine_run_id: requireToken(value.engine_run_id, 'compiled supervised Engine bridge plan.engine_run_id'),
    invocation_id: requireToken(value.invocation_id, 'compiled supervised Engine bridge plan.invocation_id'),
    policy_hash: requireDigest(value.policy_hash, 'compiled supervised Engine bridge plan.policy_hash'),
    contract_hash: requireDigest(value.contract_hash, 'compiled supervised Engine bridge plan.contract_hash'),
    immutable_base: requireToken(value.immutable_base, 'compiled supervised Engine bridge plan.immutable_base'),
    workspace_root_hash: requireDigest(inputs.workspace_root_hash, 'compiled supervised Engine bridge plan.workspace_root_hash'),
    prompt_hash: requireDigest(inputs.prompt_hash, 'compiled supervised Engine bridge plan.prompt_hash'),
    branch_hash: requireDigest(inputs.branch_hash, 'compiled supervised Engine bridge plan.branch_hash'),
    verify_command_hash: requireNullableDigest(inputs.verify_command_hash, 'compiled supervised Engine bridge plan.verify_command_hash'),
    intake_binding_hash: requireDigest(value.intake_binding_hash, 'compiled supervised Engine bridge plan.intake_binding_hash'),
    sink_inventory_hash: requireDigest(value.sink_inventory_hash, 'compiled supervised Engine bridge plan.sink_inventory_hash'),
    bridge_abi_hash: requireDigest(value.bridge_abi_hash, 'compiled supervised Engine bridge plan.bridge_abi_hash'),
  };
}

function normalizeAuthenticatedReceipt(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version',
    'status',
    'owner_kernel_authority',
    'acceptance',
    'verification_path',
    'issuer',
    'key_id',
    'attestation_hash',
    'signing_key_id',
    'keyring_epoch',
    'envelope_hash',
    'binding_hash',
    'plan_hash',
    'install_binding_hash',
    'session_id',
    'session_challenge_hash',
    'verified_at_ms',
    'replay_status',
  ]), 'authenticated supervised intake receipt');
  if ((value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION
      && value.schema_version !== BRIDGE_V2_SCHEMA_VERSION)
    || value.status !== 'verified_intake'
    || value.owner_kernel_authority !== 'none'
    || value.acceptance !== 'not_available'
    || value.verification_path !== 'host_pinned_authenticated_intake'
    || (value.replay_status !== 'new' && value.replay_status !== 'idempotent')) {
    fail('authenticated supervised intake receipt has an invalid non-authoritative status');
  }
  return {
    issuer: requireToken(value.issuer, 'authenticated supervised intake receipt.issuer'),
    key_id: requireToken(value.key_id, 'authenticated supervised intake receipt.key_id'),
    signing_key_id: requireToken(value.signing_key_id, 'authenticated supervised intake receipt.signing_key_id'),
    keyring_epoch: requireSafeInteger(value.keyring_epoch, 'authenticated supervised intake receipt.keyring_epoch', 1),
    attestation_hash: requireDigest(value.attestation_hash, 'authenticated supervised intake receipt.attestation_hash'),
    envelope_hash: requireDigest(value.envelope_hash, 'authenticated supervised intake receipt.envelope_hash'),
    binding_hash: requireDigest(value.binding_hash, 'authenticated supervised intake receipt.binding_hash'),
    plan_hash: requireDigest(value.plan_hash, 'authenticated supervised intake receipt.plan_hash'),
    install_binding_hash: requireDigest(value.install_binding_hash, 'authenticated supervised intake receipt.install_binding_hash'),
    verified_at_ms: requireSafeInteger(value.verified_at_ms, 'authenticated supervised intake receipt.verified_at_ms', 1),
  };
}

function normalizeBridgeReceipt(raw) {
  const value = requireExactKeys(raw, new Set([
    'verified',
    'intake_binding_hash',
    'sink_inventory_hash',
    'bridge_abi_hash',
    'plan_hash',
    'verification_path',
    'issuer',
    'key_id',
    'attestation_hash',
    'envelope_hash',
  ]), 'supervised Engine bridge receipt');
  if (value.verified !== true || value.verification_path !== 'host_pinned_authenticated_intake') {
    fail('supervised Engine bridge receipt is not verified');
  }
  return {
    intake_binding_hash: requireDigest(value.intake_binding_hash, 'supervised Engine bridge receipt.intake_binding_hash'),
    sink_inventory_hash: requireDigest(value.sink_inventory_hash, 'supervised Engine bridge receipt.sink_inventory_hash'),
    bridge_abi_hash: requireDigest(value.bridge_abi_hash, 'supervised Engine bridge receipt.bridge_abi_hash'),
    plan_hash: requireDigest(value.plan_hash, 'supervised Engine bridge receipt.plan_hash'),
    issuer: requireToken(value.issuer, 'supervised Engine bridge receipt.issuer'),
    key_id: requireToken(value.key_id, 'supervised Engine bridge receipt.key_id'),
    attestation_hash: requireDigest(value.attestation_hash, 'supervised Engine bridge receipt.attestation_hash'),
    envelope_hash: requireDigest(value.envelope_hash, 'supervised Engine bridge receipt.envelope_hash'),
  };
}

function buildVerifiedIntakeCapsule(raw) {
  const value = requireExactKeys(raw, new Set([
    'plan',
    'authenticatedReceipt',
    'bridgeReceipt',
    'installBindingHash',
  ]), 'verified supervised shadow intake capsule input');
  const plan = normalizePlan(value.plan);
  const authenticated = normalizeAuthenticatedReceipt(value.authenticatedReceipt);
  const authenticatedSchemaVersion = value.authenticatedReceipt.schema_version;
  const bridge = normalizeBridgeReceipt(value.bridgeReceipt);
  const installBindingHash = requireDigest(value.installBindingHash, 'verified supervised shadow intake installBindingHash');
  if (plan.plan_hash !== bridge.plan_hash || authenticated.plan_hash !== plan.plan_hash
    || authenticatedSchemaVersion !== plan.schema_version
    || authenticated.binding_hash !== plan.intake_binding_hash
    || bridge.intake_binding_hash !== plan.intake_binding_hash
    || bridge.sink_inventory_hash !== plan.sink_inventory_hash
    || bridge.bridge_abi_hash !== plan.bridge_abi_hash
    || authenticated.install_binding_hash !== installBindingHash
    || authenticated.issuer !== bridge.issuer
    || authenticated.key_id !== bridge.key_id
    || authenticated.attestation_hash !== bridge.attestation_hash
    || authenticated.envelope_hash !== bridge.envelope_hash) {
    fail('verified supervised shadow intake receipts do not match the compiled bridge plan', 'SUPERVISED_SHADOW_ENGINE_BINDING_MISMATCH');
  }
  const provenance = {
    issuer: authenticated.issuer,
    key_id: authenticated.key_id,
    signing_key_id: authenticated.signing_key_id,
    keyring_epoch: authenticated.keyring_epoch,
    attestation_hash: authenticated.attestation_hash,
    envelope_hash: authenticated.envelope_hash,
    install_binding_hash: installBindingHash,
    verified_at_ms: authenticated.verified_at_ms,
  };
  const bridgeBinding = {
    plan_hash: plan.plan_hash,
    intake_binding_hash: plan.intake_binding_hash,
    sink_inventory_hash: plan.sink_inventory_hash,
    bridge_abi_hash: plan.bridge_abi_hash,
  };
  const engine = {
    owner_run_id: plan.owner_run_id,
    engine_run_id: plan.engine_run_id,
    invocation_id: plan.invocation_id,
    policy_hash: plan.policy_hash,
    contract_hash: plan.contract_hash,
    immutable_base: plan.immutable_base,
    workspace_root_hash: plan.workspace_root_hash,
    prompt_hash: plan.prompt_hash,
    branch_hash: plan.branch_hash,
    verify_command_hash: plan.verify_command_hash,
  };
  return cloneCanonical({
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    kind: 'verified_supervised_engine_shadow_intake',
    provenance,
    bridge: bridgeBinding,
    engine,
    intake_evidence_hash: sha256(canonicalJson({ authenticated, bridge })),
  });
}

function normalizeCapsule(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'provenance',
    'bridge',
    'engine',
    'intake_evidence_hash',
  ]), 'verified supervised shadow intake capsule');
  if (value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION
    || value.kind !== 'verified_supervised_engine_shadow_intake') {
    fail('verified supervised shadow intake capsule schema is unsupported');
  }
  const provenance = requireExactKeys(value.provenance, new Set([
    'issuer', 'key_id', 'signing_key_id', 'keyring_epoch', 'attestation_hash',
    'envelope_hash', 'install_binding_hash', 'verified_at_ms',
  ]), 'verified supervised shadow intake capsule.provenance');
  const bridge = requireExactKeys(value.bridge, new Set([
    'plan_hash', 'intake_binding_hash', 'sink_inventory_hash', 'bridge_abi_hash',
  ]), 'verified supervised shadow intake capsule.bridge');
  const engine = requireExactKeys(value.engine, new Set([
    'owner_run_id', 'engine_run_id', 'invocation_id', 'policy_hash', 'contract_hash',
    'immutable_base', 'workspace_root_hash', 'prompt_hash', 'branch_hash', 'verify_command_hash',
  ]), 'verified supervised shadow intake capsule.engine');
  return cloneCanonical({
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    kind: 'verified_supervised_engine_shadow_intake',
    provenance: {
      issuer: requireToken(provenance.issuer, 'verified supervised shadow intake capsule.provenance.issuer'),
      key_id: requireToken(provenance.key_id, 'verified supervised shadow intake capsule.provenance.key_id'),
      signing_key_id: requireToken(provenance.signing_key_id, 'verified supervised shadow intake capsule.provenance.signing_key_id'),
      keyring_epoch: requireSafeInteger(provenance.keyring_epoch, 'verified supervised shadow intake capsule.provenance.keyring_epoch', 1),
      attestation_hash: requireDigest(provenance.attestation_hash, 'verified supervised shadow intake capsule.provenance.attestation_hash'),
      envelope_hash: requireDigest(provenance.envelope_hash, 'verified supervised shadow intake capsule.provenance.envelope_hash'),
      install_binding_hash: requireDigest(provenance.install_binding_hash, 'verified supervised shadow intake capsule.provenance.install_binding_hash'),
      verified_at_ms: requireSafeInteger(provenance.verified_at_ms, 'verified supervised shadow intake capsule.provenance.verified_at_ms', 1),
    },
    bridge: {
      plan_hash: requireDigest(bridge.plan_hash, 'verified supervised shadow intake capsule.bridge.plan_hash'),
      intake_binding_hash: requireDigest(bridge.intake_binding_hash, 'verified supervised shadow intake capsule.bridge.intake_binding_hash'),
      sink_inventory_hash: requireDigest(bridge.sink_inventory_hash, 'verified supervised shadow intake capsule.bridge.sink_inventory_hash'),
      bridge_abi_hash: requireDigest(bridge.bridge_abi_hash, 'verified supervised shadow intake capsule.bridge.bridge_abi_hash'),
    },
    engine: {
      owner_run_id: requireToken(engine.owner_run_id, 'verified supervised shadow intake capsule.engine.owner_run_id'),
      engine_run_id: requireToken(engine.engine_run_id, 'verified supervised shadow intake capsule.engine.engine_run_id'),
      invocation_id: requireToken(engine.invocation_id, 'verified supervised shadow intake capsule.engine.invocation_id'),
      policy_hash: requireDigest(engine.policy_hash, 'verified supervised shadow intake capsule.engine.policy_hash'),
      contract_hash: requireDigest(engine.contract_hash, 'verified supervised shadow intake capsule.engine.contract_hash'),
      immutable_base: requireToken(engine.immutable_base, 'verified supervised shadow intake capsule.engine.immutable_base'),
      workspace_root_hash: requireDigest(engine.workspace_root_hash, 'verified supervised shadow intake capsule.engine.workspace_root_hash'),
      prompt_hash: requireDigest(engine.prompt_hash, 'verified supervised shadow intake capsule.engine.prompt_hash'),
      branch_hash: requireDigest(engine.branch_hash, 'verified supervised shadow intake capsule.engine.branch_hash'),
      verify_command_hash: requireNullableDigest(engine.verify_command_hash, 'verified supervised shadow intake capsule.engine.verify_command_hash'),
    },
    intake_evidence_hash: requireDigest(value.intake_evidence_hash, 'verified supervised shadow intake capsule.intake_evidence_hash'),
  });
}

function intakeIdForCapsule(capsule) {
  return sha256(canonicalJson({
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    install_binding_hash: capsule.provenance.install_binding_hash,
    envelope_hash: capsule.provenance.envelope_hash,
    plan_hash: capsule.bridge.plan_hash,
    intake_binding_hash: capsule.bridge.intake_binding_hash,
    owner_run_id: capsule.engine.owner_run_id,
    engine_run_id: capsule.engine.engine_run_id,
    invocation_id: capsule.engine.invocation_id,
  }));
}

function recordForCapsule(capsule) {
  const normalized = normalizeCapsule(capsule);
  const intakeId = intakeIdForCapsule(normalized);
  const record = {
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    status: SHADOW_INTAKE_RECORDED,
    intake_id: intakeId,
    capsule_hash: sha256(canonicalJson(normalized)),
    intake_evidence_hash: normalized.intake_evidence_hash,
    engine: {
      status: 'not_started',
      dispatch_authority: 'not_available',
    },
    owner_kernel_authority: 'none',
    legacy_execution_authority: 'unchanged',
    effect_authority: 'none',
    broker_authority: 'not_available',
    witness_assurance: 'local_verifier_state_not_independent_witness',
    acceptance: 'not_available',
    alias_retirement_eligible: false,
  };
  return cloneCanonical({
    ...record,
    record_hash: sha256(canonicalJson(record)),
  });
}

function normalizeRecord(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version', 'status', 'intake_id', 'capsule_hash', 'intake_evidence_hash',
    'engine', 'owner_kernel_authority', 'legacy_execution_authority', 'effect_authority',
    'broker_authority', 'witness_assurance', 'acceptance', 'alias_retirement_eligible', 'record_hash',
  ]), 'supervised shadow intake record');
  const engine = requireExactKeys(value.engine, new Set(['status', 'dispatch_authority']), 'supervised shadow intake record.engine');
  const unsigned = { ...value };
  delete unsigned.record_hash;
  if (value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION
    || value.status !== SHADOW_INTAKE_RECORDED
    || value.engine.status !== 'not_started'
    || engine.dispatch_authority !== 'not_available'
    || value.owner_kernel_authority !== 'none'
    || value.legacy_execution_authority !== 'unchanged'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'not_available'
    || value.witness_assurance !== 'local_verifier_state_not_independent_witness'
    || value.acceptance !== 'not_available'
    || value.alias_retirement_eligible !== false
    || !isSha256(value.intake_id)
    || !isSha256(value.capsule_hash)
    || !isSha256(value.intake_evidence_hash)
    || !isSha256(value.record_hash)
    || sha256(canonicalJson(unsigned)) !== value.record_hash) {
    fail('supervised shadow intake record is invalid or corrupt', 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
  }
  return cloneCanonical(value);
}

function pendingStateFor(capsule, record) {
  return {
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    state: 'pending',
    intake_id: record.intake_id,
    capsule,
    capsule_hash: record.capsule_hash,
    record,
    record_hash: record.record_hash,
  };
}

function normalizePendingState(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version', 'state', 'intake_id', 'capsule', 'capsule_hash', 'record', 'record_hash',
  ]), 'supervised shadow pending state');
  if (value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION || value.state !== 'pending') {
    fail('supervised shadow pending state has an unsupported schema', 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
  }
  const capsule = normalizeCapsule(value.capsule);
  const record = normalizeRecord(value.record);
  const expected = recordForCapsule(capsule);
  if (!isSha256(value.intake_id)
    || !isSha256(value.capsule_hash)
    || !isSha256(value.record_hash)
    || value.intake_id !== expected.intake_id
    || value.capsule_hash !== expected.capsule_hash
    || value.record_hash !== expected.record_hash
    || canonicalJson(record) !== canonicalJson(expected)) {
    fail('supervised shadow pending state does not bind its capsule and record', 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
  }
  return cloneCanonical({
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    state: 'pending',
    intake_id: value.intake_id,
    capsule,
    capsule_hash: value.capsule_hash,
    record,
    record_hash: value.record_hash,
  });
}

function recordedStateFor(capsule, record) {
  return {
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    state: 'recorded',
    intake_id: record.intake_id,
    capsule,
    capsule_hash: record.capsule_hash,
    record,
    record_hash: record.record_hash,
  };
}

function normalizeRecordedState(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version', 'state', 'intake_id', 'capsule', 'capsule_hash', 'record', 'record_hash',
  ]), 'supervised shadow recorded state');
  if (value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION || value.state !== 'recorded') {
    fail('supervised shadow recorded state has an unsupported schema', 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
  }
  const pending = normalizePendingState({ ...value, state: 'pending' });
  return cloneCanonical({ ...pending, state: 'recorded' });
}

function recoveryStateFor(pending) {
  return {
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    state: 'recovery_required',
    intake_id: pending.intake_id,
    capsule_hash: pending.capsule_hash,
    record_hash: pending.record_hash,
    reason: 'pending_shadow_record_after_restart',
  };
}

function normalizeRecoveryState(raw) {
  const value = requireExactKeys(raw, new Set([
    'schema_version', 'state', 'intake_id', 'capsule_hash', 'record_hash', 'reason',
  ]), 'supervised shadow recovery state');
  if (value.schema_version !== SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION
    || value.state !== 'recovery_required'
    || value.reason !== 'pending_shadow_record_after_restart'
    || !isSha256(value.intake_id)
    || !isSha256(value.capsule_hash)
    || !isSha256(value.record_hash)) {
    fail('supervised shadow recovery state is invalid or corrupt', 'SUPERVISED_SHADOW_ENGINE_STATE_CORRUPT');
  }
  return cloneCanonical(value);
}

function stateFilename(intakeId, state) {
  if (!isSha256(intakeId)) fail('shadow intake ID must be a SHA-256 digest');
  if (state !== 'pending' && state !== 'recorded' && state !== 'recovery-required') {
    fail('shadow intake state filename is unsupported');
  }
  return `${intakeId}.${state}.json`;
}

function compactSummary(record, idempotent) {
  return cloneCanonical({
    schema_version: SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
    status: SHADOW_INTAKE_RECORDED,
    intake_id: record.intake_id,
    record_hash: record.record_hash,
    idempotent,
    disclosure: {
      engine: cloneCanonical(record.engine),
      owner_kernel_authority: record.owner_kernel_authority,
      legacy_execution_authority: record.legacy_execution_authority,
      effect_authority: record.effect_authority,
      broker_authority: record.broker_authority,
      witness_assurance: record.witness_assurance,
      acceptance: record.acceptance,
      alias_retirement_eligible: record.alias_retirement_eligible,
    },
  });
}

class FileShadowEngineConsumer {
  constructor(options = {}) {
    const value = assertOnlyKeys(options, new Set(['state_directory', 'after_pending_persisted']), 'shadow Engine consumer options');
    if (!Object.prototype.hasOwnProperty.call(value, 'state_directory')) {
      fail('shadow Engine consumer options require state_directory');
    }
    if (typeof value.after_pending_persisted !== 'undefined' && typeof value.after_pending_persisted !== 'function') {
      fail('shadow Engine consumer after_pending_persisted must be a function');
    }
    this.root = requirePrivateDirectory(value.state_directory, 'shadow Engine state root');
    try {
      this.directory = requirePrivateDirectory(
        path.join(this.root.logical_path, SHADOW_ENGINE_STATE_DIRECTORY),
        'shadow Engine state directory',
        { create: true },
      );
    } catch (error) {
      closeDirectory(this.root);
      throw error;
    }
    this.afterPendingPersisted = value.after_pending_persisted || null;
  }

  close() {
    closeDirectory(this.directory);
    closeDirectory(this.root);
    this.directory = null;
    this.root = null;
  }

  ensureOpen() {
    if (!this.directory || !this.root) fail('shadow Engine consumer is closed', 'SUPERVISED_SHADOW_ENGINE_STATE_CLOSED');
  }

  inspectStates(intakeId) {
    const pending = readPrivateCanonicalState(this.directory, stateFilename(intakeId, 'pending'), 'shadow pending state');
    const recorded = readPrivateCanonicalState(this.directory, stateFilename(intakeId, 'recorded'), 'shadow recorded state');
    const recovery = readPrivateCanonicalState(this.directory, stateFilename(intakeId, 'recovery-required'), 'shadow recovery state');
    const present = [pending, recorded, recovery].filter((value) => value !== null);
    if (present.length > 1) {
      fail('shadow intake has conflicting durable states', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
    }
    if (pending !== null) return { state: 'pending', value: normalizePendingState(pending) };
    if (recorded !== null) return { state: 'recorded', value: normalizeRecordedState(recorded) };
    if (recovery !== null) return { state: 'recovery_required', value: normalizeRecoveryState(recovery) };
    return { state: 'absent', value: null };
  }

  cleanupTemporaryFiles() {
    const entries = fs.readdirSync(this.directory.proc_path, { withFileTypes: true });
    for (const entry of entries) {
      const match = TEMPORARY_NAME_PATTERN.exec(entry.name);
      if (!match) continue;
      // A power loss may leave a partial write here. It was never linked to a
      // published state name, so strict identity is enough to remove it.
      removePrivateTemporaryFile(
        this.directory,
        entry.name,
        stateFilename(match[1], match[2]),
        'shadow state temporary',
      );
    }
  }

  recoverPending() {
    this.ensureOpen();
    this.cleanupTemporaryFiles();
    const entries = fs.readdirSync(this.directory.proc_path, { withFileTypes: true });
    const pendingIds = [];
    const recordedById = new Map();
    const recoveryById = new Map();
    for (const entry of entries) {
      const match = STATE_NAME_PATTERN.exec(entry.name);
      if (!match) {
        fail(`shadow Engine state directory contains an unexpected entry ${entry.name}`, 'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE');
      }
      if (match[2] === 'pending') pendingIds.push(match[1]);
      else if (match[2] === 'recorded') {
        recordedById.set(match[1], normalizeRecordedState(readPrivateCanonicalState(this.directory, entry.name, 'shadow recorded state')));
      } else {
        recoveryById.set(match[1], normalizeRecoveryState(readPrivateCanonicalState(this.directory, entry.name, 'shadow recovery state')));
      }
    }
    for (const intakeId of recordedById.keys()) {
      if (recoveryById.has(intakeId)) {
        fail('shadow intake has conflicting recorded and recovery states', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
      }
    }
    let recovered = 0;
    for (const intakeId of pendingIds) {
      const pendingName = stateFilename(intakeId, 'pending');
      const pending = normalizePendingState(readPrivateCanonicalState(this.directory, pendingName, 'shadow pending state'));
      const recorded = recordedById.get(intakeId);
      if (recorded) {
        if (recorded.capsule_hash !== pending.capsule_hash
          || recorded.record_hash !== pending.record_hash
          || canonicalJson(recorded.record) !== canonicalJson(pending.record)) {
          fail('shadow intake has conflicting pending and recorded states', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
        }
        removePrivateStateFile(this.directory, pendingName, 'shadow pending state');
        continue;
      }
      const recovery = recoveryById.get(intakeId);
      if (recovery) {
        if (recovery.capsule_hash !== pending.capsule_hash || recovery.record_hash !== pending.record_hash) {
          fail('shadow intake has conflicting pending and recovery states', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
        }
        removePrivateStateFile(this.directory, pendingName, 'shadow pending state');
        continue;
      }
      const recoveryName = stateFilename(intakeId, 'recovery-required');
      writeExclusiveState(this.directory, recoveryName, recoveryStateFor(pending), 'shadow recovery state');
      removePrivateStateFile(this.directory, pendingName, 'shadow pending state');
      recovered += 1;
    }
    return recovered;
  }

  consumeVerifiedIntake(rawCapsule) {
    this.ensureOpen();
    const capsule = normalizeCapsule(rawCapsule);
    const record = recordForCapsule(capsule);
    const state = this.inspectStates(record.intake_id);
    if (state.state === 'recorded') {
      if (state.value.capsule_hash !== record.capsule_hash
        || state.value.record_hash !== record.record_hash
        || canonicalJson(state.value.record) !== canonicalJson(record)) {
        fail('shadow intake ID conflicts with an existing record', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
      }
      return compactSummary(record, true);
    }
    if (state.state === 'pending' || state.state === 'recovery_required') {
      if (state.value.capsule_hash !== record.capsule_hash) {
        fail('shadow intake ID conflicts with interrupted state', 'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT');
      }
      fail('shadow intake requires explicit recovery and cannot be promoted automatically', 'SUPERVISED_SHADOW_ENGINE_RECOVERY_REQUIRED');
    }
    const pendingName = stateFilename(record.intake_id, 'pending');
    writeExclusiveState(this.directory, pendingName, pendingStateFor(capsule, record), 'shadow pending state');
    if (this.afterPendingPersisted) this.afterPendingPersisted(cloneCanonical(record));
    const recordedName = stateFilename(record.intake_id, 'recorded');
    writeExclusiveState(this.directory, recordedName, recordedStateFor(capsule, record), 'shadow recorded state');
    removePrivateStateFile(this.directory, pendingName, 'shadow pending state');
    return compactSummary(record, false);
  }
}

function createFileShadowEngineConsumer(options) {
  return new FileShadowEngineConsumer(options);
}

module.exports = {
  FileShadowEngineConsumer,
  SHADOW_ENGINE_CONSUMER_SCHEMA_VERSION,
  SHADOW_ENGINE_STATE_DIRECTORY,
  SHADOW_INTAKE_RECORDED,
  SHADOW_INTAKE_RECOVERY_REQUIRED,
  SupervisedShadowEngineConsumerError,
  buildVerifiedIntakeCapsule,
  createFileShadowEngineConsumer,
  recordForCapsule,
};
