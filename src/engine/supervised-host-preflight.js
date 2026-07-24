'use strict';

// P3.4a describes a Linux cross-UID mechanism probe. It intentionally contains no
// OwnerKernel construction, action authority, broker execution, or acceptance.

const fs = require('fs');
const path = require('path');
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');

const SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION = 1;
const SUPERVISED_HOST_PROTOCOL_VERSION = 1;
const SYSTEMD_WORKER_IDENTITY = 'nobody';
const SYSTEMD_WORKER_UID = 65534;
const SYSTEMD_WORKER_GID = 65534;
const SYSTEMD_SLICE = 'system.slice';
const RUNTIME_PARENT = '/run/autopilot-supervisor';
const SOCKET_DIRECTORY = 'socket';
const SOCKET_FILENAME = 'worker.sock';
const STATE_DIRECTORY = 'state';
const MAX_FRAME_BYTES = 4096;
const REQUEST_TIMEOUT_MILLISECONDS = 5000;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SERVICE_UNIT_PATTERN = /^autopilot-p34-[A-Za-z0-9_-]{1,96}\.service$/;
const SYSTEMD_PROPERTIES = Object.freeze([
  'NoNewPrivileges=yes',
  'PrivateNetwork=yes',
  'PrivateTmp=yes',
  'ProtectSystem=strict',
  'ProtectHome=tmpfs',
  'ProtectProc=invisible',
  'RestrictNamespaces=yes',
  'RestrictSUIDSGID=yes',
  'CapabilityBoundingSet=',
  'CollectMode=inactive-or-failed',
]);

function preflightError(message, code = 'INVALID_SUPERVISED_HOST_PREFLIGHT') {
  return new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw preflightError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw preflightError(`${label} must be a plain object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw preflightError(`${label} has unsupported key "${key}"`);
    }
  }
}

function requireOwnKeys(value, keys, label) {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw preflightError(`${label} is missing ${key}`);
    }
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw preflightError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw preflightError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireNonce(value, label) {
  return requireToken(value, label);
}

function requireUid(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) {
    throw preflightError(`${label} must be a non-negative POSIX UID/GID integer`);
  }
  return value;
}

function requireAbsoluteCanonicalPath(value, label) {
  if (typeof value !== 'string' || !path.posix.isAbsolute(value)) {
    throw preflightError(`${label} must be an absolute POSIX path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '/') {
    throw preflightError(`${label} must be a canonical non-root POSIX path`);
  }
  return normalized;
}

function requireRuntimeRoot(value, serviceUnit) {
  const runtimeRoot = requireAbsoluteCanonicalPath(value, 'runtime_root');
  if (path.posix.dirname(runtimeRoot) !== RUNTIME_PARENT
    || path.posix.basename(runtimeRoot) !== serviceUnit) {
    throw preflightError(`runtime_root must equal ${RUNTIME_PARENT}/${serviceUnit}`);
  }
  return runtimeRoot;
}

function normalizePrincipal(raw, label) {
  const value = assertPlainObject(raw, label);
  assertOnlyKeys(value, new Set(['identity', 'uid', 'gid']), label);
  requireOwnKeys(value, ['identity', 'uid', 'gid'], label);
  return {
    identity: requireToken(value.identity, `${label}.identity`),
    uid: requireUid(value.uid, `${label}.uid`),
    gid: requireUid(value.gid, `${label}.gid`),
  };
}

function normalizeInput(raw) {
  const value = assertPlainObject(raw, 'supervised host preflight input');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'run_id',
    'invocation_id',
    'plan_hash',
    'nonce_hash',
    'service_unit',
    'broker',
    'worker',
    'runtime_root',
    'helper_path',
    'python_path',
    'systemd_run_path',
  ]), 'supervised host preflight input');
  requireOwnKeys(value, [
    'schema_version',
    'run_id',
    'invocation_id',
    'plan_hash',
    'nonce_hash',
    'service_unit',
    'broker',
    'worker',
    'runtime_root',
    'helper_path',
    'python_path',
    'systemd_run_path',
  ], 'supervised host preflight input');
  if (value.schema_version !== SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION) {
    throw preflightError(
      `supervised host preflight input.schema_version must equal ${SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION}`,
    );
  }
  const serviceUnit = requireToken(value.service_unit, 'service_unit');
  if (!SERVICE_UNIT_PATTERN.test(serviceUnit)) {
    throw preflightError('service_unit must be an autopilot-p34-*.service unit name');
  }
  const broker = normalizePrincipal(value.broker, 'broker');
  const worker = normalizePrincipal(value.worker, 'worker');
  if (broker.uid === 0 || broker.gid === 0) {
    throw preflightError(
      'broker must use an unprivileged non-root UID and GID identity',
      'SUPERVISED_HOST_BROKER_UNPRIVILEGED_REQUIRED',
    );
  }
  if (worker.identity !== SYSTEMD_WORKER_IDENTITY
    || worker.uid !== SYSTEMD_WORKER_UID
    || worker.gid !== SYSTEMD_WORKER_GID) {
    throw preflightError(
      `worker must be the frozen ${SYSTEMD_WORKER_IDENTITY}:${SYSTEMD_WORKER_GID} identity`,
      'SUPERVISED_HOST_WORKER_IDENTITY_REQUIRED',
    );
  }
  if (broker.uid === worker.uid || broker.gid === worker.gid) {
    throw preflightError(
      'broker and worker must use distinct UID and GID identities',
      'SUPERVISED_HOST_CROSS_UID_REQUIRED',
    );
  }
  const runtimeRoot = requireRuntimeRoot(value.runtime_root, serviceUnit);
  const helperPath = requireAbsoluteCanonicalPath(value.helper_path, 'helper_path');
  const pythonPath = requireAbsoluteCanonicalPath(value.python_path, 'python_path');
  const systemdRunPath = requireAbsoluteCanonicalPath(value.systemd_run_path, 'systemd_run_path');
  return {
    schema_version: SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION,
    run_id: requireToken(value.run_id, 'run_id'),
    invocation_id: requireToken(value.invocation_id, 'invocation_id'),
    plan_hash: requireSha256(value.plan_hash, 'plan_hash'),
    nonce_hash: requireSha256(value.nonce_hash, 'nonce_hash'),
    service_unit: serviceUnit,
    broker,
    worker,
    runtime_root: runtimeRoot,
    socket_path: `${runtimeRoot}/${SOCKET_DIRECTORY}/${SOCKET_FILENAME}`,
    state_root: `${runtimeRoot}/${STATE_DIRECTORY}`,
    worker_cgroup_path: `/${SYSTEMD_SLICE}/${serviceUnit}`,
    helper_path: helperPath,
    python_path: pythonPath,
    systemd_run_path: systemdRunPath,
  };
}

function compileNormalizedInput(input) {
  const binding = {
    schema_version: SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION,
    protocol_version: SUPERVISED_HOST_PROTOCOL_VERSION,
    run_id: input.run_id,
    invocation_id: input.invocation_id,
    plan_hash: input.plan_hash,
    nonce_hash: input.nonce_hash,
    service_unit: input.service_unit,
    broker: input.broker,
    worker: input.worker,
    runtime_root: input.runtime_root,
    socket_path: input.socket_path,
    state_root: input.state_root,
    worker_cgroup_path: input.worker_cgroup_path,
    helper_path: input.helper_path,
    python_path: input.python_path,
    systemd_run_path: input.systemd_run_path,
    systemd_properties: SYSTEMD_PROPERTIES,
  };
  return cloneCanonical({
    ...binding,
    binding_hash: sha256(canonicalJson(binding)),
    status: 'preflight_only',
    owner_kernel_authority: 'none',
    acceptance: 'not_available',
    protocol: {
      operation: 'p34_hello',
      max_frame_bytes: MAX_FRAME_BYTES,
      request_timeout_milliseconds: REQUEST_TIMEOUT_MILLISECONDS,
      peer_credentials: 'linux_so_peercred_exact_uid_gid_and_cgroup_path',
      request_lifecycle: 'single_use',
      unknown_operations: 'rejected',
    },
  });
}

function compileSupervisedHostPreflight(raw) {
  return compileNormalizedInput(normalizeInput(raw));
}

function verifySupervisedHostPreflight(plan, raw) {
  const actual = canonicalJson(assertPlainObject(plan, 'supervised host preflight plan'));
  const expected = canonicalJson(compileSupervisedHostPreflight(raw));
  if (actual !== expected) {
    throw preflightError('supervised host preflight plan does not match frozen input');
  }
  return cloneCanonical({
    verified: true,
    binding_hash: plan.binding_hash,
    status: plan.status,
    owner_kernel_authority: plan.owner_kernel_authority,
    acceptance: plan.acceptance,
  });
}

const COMPILED_PREFLIGHT_KEYS = new Set([
  'schema_version',
  'protocol_version',
  'run_id',
  'invocation_id',
  'plan_hash',
  'nonce_hash',
  'service_unit',
  'broker',
  'worker',
  'runtime_root',
  'socket_path',
  'state_root',
  'worker_cgroup_path',
  'helper_path',
  'python_path',
  'systemd_run_path',
  'systemd_properties',
  'binding_hash',
  'status',
  'owner_kernel_authority',
  'acceptance',
  'protocol',
]);

function rawInputFromCompiledPlan(plan) {
  const value = assertPlainObject(plan, 'supervised host preflight plan');
  assertOnlyKeys(value, COMPILED_PREFLIGHT_KEYS, 'supervised host preflight plan');
  requireOwnKeys(value, [
    'schema_version',
    'protocol_version',
    'run_id',
    'invocation_id',
    'plan_hash',
    'nonce_hash',
    'service_unit',
    'broker',
    'worker',
    'runtime_root',
    'socket_path',
    'state_root',
    'worker_cgroup_path',
    'helper_path',
    'python_path',
    'systemd_run_path',
    'systemd_properties',
    'binding_hash',
    'status',
    'owner_kernel_authority',
    'acceptance',
    'protocol',
  ], 'supervised host preflight plan');
  return {
    schema_version: value.schema_version,
    run_id: value.run_id,
    invocation_id: value.invocation_id,
    plan_hash: value.plan_hash,
    nonce_hash: value.nonce_hash,
    service_unit: value.service_unit,
    broker: value.broker,
    worker: value.worker,
    runtime_root: value.runtime_root,
    helper_path: value.helper_path,
    python_path: value.python_path,
    systemd_run_path: value.systemd_run_path,
  };
}

function requireVerifiedPreflightPlan(plan) {
  const raw = rawInputFromCompiledPlan(plan);
  verifySupervisedHostPreflight(plan, raw);
  return compileSupervisedHostPreflight(raw);
}

function modeIsPrivate(stat) {
  return (stat.mode & 0o022) === 0;
}

function pathComponents(absolutePath) {
  const parts = absolutePath.split('/').filter(Boolean);
  const components = ['/'];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    components.push(current);
  }
  return components;
}

function requireRootOwnedPath(absolutePath, label, {
  lstatSync = fs.lstatSync,
  realpathSync = fs.realpathSync,
  requireExecutable = false,
  requireDirectory = false,
} = {}) {
  const requested = requireAbsoluteCanonicalPath(absolutePath, label);
  let resolved;
  try {
    resolved = path.posix.normalize(realpathSync(requested));
  } catch (error) {
    throw preflightError(`${label} cannot be resolved: ${error.message}`, 'SUPERVISED_HOST_PATH_UNTRUSTED');
  }
  if (resolved !== requested) {
    throw preflightError(
      `${label} must not resolve through a symlink`,
      'SUPERVISED_HOST_PATH_UNTRUSTED',
    );
  }
  for (const component of pathComponents(requested)) {
    let stat;
    try {
      stat = lstatSync(component);
    } catch (error) {
      throw preflightError(`${label} has unreadable ancestor ${component}: ${error.message}`, 'SUPERVISED_HOST_PATH_UNTRUSTED');
    }
    if (stat.isSymbolicLink() || stat.uid !== 0 || !modeIsPrivate(stat)) {
      throw preflightError(`${label} has an untrusted ancestor ${component}`, 'SUPERVISED_HOST_PATH_UNTRUSTED');
    }
  }
  const finalStat = lstatSync(requested);
  if (requireDirectory && !finalStat.isDirectory()) {
    throw preflightError(`${label} must resolve to a directory`, 'SUPERVISED_HOST_PATH_UNTRUSTED');
  }
  if (requireExecutable && (!finalStat.isFile() || (finalStat.mode & 0o111) === 0)) {
    throw preflightError(`${label} must resolve to an executable regular file`, 'SUPERVISED_HOST_PATH_UNTRUSTED');
  }
  return requested;
}

function preflightSupervisedHostRuntime(plan, {
  platform = process.platform,
  getuid = process.getuid,
  lstatSync = fs.lstatSync,
  realpathSync = fs.realpathSync,
} = {}) {
  const normalizedPlan = requireVerifiedPreflightPlan(plan);
  if (platform !== 'linux') {
    throw preflightError('supervised host preflight requires Linux', 'SUPERVISED_HOST_LINUX_REQUIRED');
  }
  if (typeof getuid !== 'function' || getuid() !== 0) {
    throw preflightError('supervised host live launcher requires root', 'SUPERVISED_HOST_ROOT_REQUIRED');
  }
  const helperPath = requireRootOwnedPath(normalizedPlan.helper_path, 'helper_path', {
    lstatSync,
    realpathSync,
    requireExecutable: true,
  });
  const pythonPath = requireRootOwnedPath(normalizedPlan.python_path, 'python_path', {
    lstatSync,
    realpathSync,
    requireExecutable: true,
  });
  const systemdRunPath = requireRootOwnedPath(normalizedPlan.systemd_run_path, 'systemd_run_path', {
    lstatSync,
    realpathSync,
    requireExecutable: true,
  });
  requireRootOwnedPath(RUNTIME_PARENT, 'runtime parent', {
    lstatSync,
    realpathSync,
    requireDirectory: true,
  });
  return cloneCanonical({
    ready_to_launch: true,
    helper_path: helperPath,
    python_path: pythonPath,
    systemd_run_path: systemdRunPath,
    binding_hash: requireSha256(normalizedPlan.binding_hash, 'preflight plan binding_hash'),
    status: 'preflight_only',
    owner_kernel_authority: 'none',
    acceptance: 'not_available',
  });
}

function buildSupervisedHostSystemdArgs(plan) {
  const normalized = requireVerifiedPreflightPlan(plan);
  requireToken(normalized.service_unit, 'preflight plan service_unit');
  const worker = normalizePrincipal(normalized.worker, 'preflight plan worker');
  if (worker.identity !== SYSTEMD_WORKER_IDENTITY
    || worker.uid !== SYSTEMD_WORKER_UID
    || worker.gid !== SYSTEMD_WORKER_GID) {
    throw preflightError('preflight plan worker does not match the frozen systemd worker identity');
  }
  return Object.freeze([
    '--wait',
    '--pipe',
    '--quiet',
    // Keep unit retention deterministic across systemd versions and failed probes.
    '--collect',
    `--unit=${normalized.service_unit}`,
    `--slice=${SYSTEMD_SLICE}`,
    `--uid=${SYSTEMD_WORKER_IDENTITY}`,
    '--gid=nogroup',
    ...SYSTEMD_PROPERTIES.map((property) => `--property=${property}`),
  ]);
}

function buildSupervisedHostGatewayArgs(plan) {
  const normalized = requireVerifiedPreflightPlan(plan);
  return Object.freeze([
    normalized.python_path,
    '-I',
    normalized.helper_path,
    'serve',
    '--socket', normalized.socket_path,
    '--expected-uid', String(normalized.worker.uid),
    '--expected-gid', String(normalized.worker.gid),
    '--expected-cgroup-path', normalized.worker_cgroup_path,
    '--broker-uid', String(normalized.broker.uid),
    '--broker-gid', String(normalized.broker.gid),
    '--socket-gid', String(normalized.worker.gid),
    '--run-id', normalized.run_id,
    '--invocation-id', normalized.invocation_id,
    '--plan-hash', normalized.plan_hash,
    '--nonce-hash', normalized.nonce_hash,
    '--binding-hash', normalized.binding_hash,
    '--timeout-seconds', String(REQUEST_TIMEOUT_MILLISECONDS / 1000),
  ]);
}

function buildSupervisedHostWorkerArgs(plan, nonce) {
  const normalized = requireVerifiedPreflightPlan(plan);
  const normalizedNonce = requireNonce(nonce, 'nonce');
  if (sha256(normalizedNonce) !== normalized.nonce_hash) {
    throw preflightError(
      'worker nonce does not match the frozen preflight nonce hash',
      'SUPERVISED_HOST_NONCE_BINDING_FAILED',
    );
  }
  return Object.freeze([
    normalized.python_path,
    '-I',
    normalized.helper_path,
    'client',
    '--socket', normalized.socket_path,
    '--expected-server-uid', String(normalized.broker.uid),
    '--expected-server-gid', String(normalized.broker.gid),
    '--expected-socket-gid', String(normalized.worker.gid),
    '--binding-hash', normalized.binding_hash,
    '--run-id', normalized.run_id,
    '--invocation-id', normalized.invocation_id,
    '--plan-hash', normalized.plan_hash,
    '--nonce', normalizedNonce,
    '--timeout-seconds', String(REQUEST_TIMEOUT_MILLISECONDS / 1000),
  ]);
}

module.exports = {
  MAX_FRAME_BYTES,
  REQUEST_TIMEOUT_MILLISECONDS,
  RUNTIME_PARENT,
  SOCKET_DIRECTORY,
  SOCKET_FILENAME,
  STATE_DIRECTORY,
  SUPERVISED_HOST_PREFLIGHT_SCHEMA_VERSION,
  SUPERVISED_HOST_PROTOCOL_VERSION,
  SUPERVISED_HOST_SYSTEMD_PROPERTIES: SYSTEMD_PROPERTIES,
  SYSTEMD_WORKER_GID,
  SYSTEMD_WORKER_IDENTITY,
  SYSTEMD_WORKER_UID,
  SYSTEMD_SLICE,
  buildSupervisedHostGatewayArgs,
  buildSupervisedHostSystemdArgs,
  buildSupervisedHostWorkerArgs,
  compileSupervisedHostPreflight,
  preflightSupervisedHostRuntime,
  verifySupervisedHostPreflight,
};
