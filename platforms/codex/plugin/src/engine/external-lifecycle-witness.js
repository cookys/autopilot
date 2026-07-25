'use strict';

// This module is deliberately limited to P3.1 lifecycle observation. It is
// not an Owner Kernel authority, action broker, acceptance coordinator, or an
// authenticated user/owner channel.

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');

const EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION = 1;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const HEX_SECRET_PATTERN = /^[0-9a-f]{64}$/i;
const CLIENT_METHODS = new Set(['open', 'append_if_head', 'close', 'get_head']);
const MUTATING_METHODS = new Set(['open', 'append_if_head', 'close']);
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 1_000;
const DEFAULT_MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
const MAX_SOCKET_PATH_LENGTH = 100;
const MAX_SOCKET_FILENAME_LENGTH = 72;
const MAX_MESSAGE_BYTES = 128 * 1024;
const FLOCK_PATH = '/usr/bin/flock';
const LEASE_READY_TIMEOUT_MS = 2_000;
const RESPONSE_DRAIN_TIMEOUT_MS = 100;

function witnessError(message, code = 'INVALID_EXTERNAL_LIFECYCLE_WITNESS') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw witnessError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw witnessError(`${label} must be a plain object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw witnessError(`${label} has unsupported key "${key}"`);
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw witnessError(`${label} must match ${TOKEN_PATTERN}`);
  }
  return value;
}

function requireSha256(value, label) {
  if (!isSha256(value)) throw witnessError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function requireHexSecret(value, label) {
  if (typeof value !== 'string' || !HEX_SECRET_PATTERN.test(value)) {
    throw witnessError(`${label} must be a 32-byte hexadecimal secret`);
  }
  return value.toLowerCase();
}

function requireTimeout(value, label) {
  if (!Number.isInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw witnessError(`${label} must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function requireMaxJournalBytes(value) {
  if (!Number.isInteger(value) || value < 1_024 || value > MAX_JOURNAL_BYTES) {
    throw witnessError(`maxJournalBytes must be an integer between 1024 and ${MAX_JOURNAL_BYTES}`);
  }
  return value;
}

function requireAbsolutePath(value, label, { maxLength = null } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\u0000')
    || !path.isAbsolute(value) || path.normalize(value) !== value || value === path.parse(value).root) {
    throw witnessError(`${label} must be a canonical non-root absolute path`);
  }
  if (maxLength !== null && value.length > maxLength) {
    throw witnessError(`${label} exceeds the Unix-domain socket path limit`);
  }
  return value;
}

function requireSocketPath(value, label) {
  const socketPath = requireAbsolutePath(value, label, { maxLength: MAX_SOCKET_PATH_LENGTH });
  if (path.basename(socketPath).length > MAX_SOCKET_FILENAME_LENGTH) {
    throw witnessError(`${label} filename exceeds the pinned Unix-domain socket path limit`);
  }
  return socketPath;
}

function normalizeDaemonConfig(raw) {
  const value = assertPlainObject(raw, 'external lifecycle witness daemon config');
  assertOnlyKeys(value, new Set([
    'socketPath',
    'journalPath',
    'clientKey',
    'identity',
    'attestationHash',
    'requestTimeoutMs',
    'maxJournalBytes',
  ]), 'external lifecycle witness daemon config');
  const socketPath = requireSocketPath(value.socketPath, 'socketPath');
  const journalPath = requireAbsolutePath(value.journalPath, 'journalPath');
  if (new Set([socketPath, journalPath, `${socketPath}.lock`, `${journalPath}.lock`]).size !== 4) {
    throw witnessError('socketPath, journalPath, and their lease paths must be distinct');
  }
  return Object.freeze({
    socket_path: socketPath,
    journal_path: journalPath,
    client_key: requireHexSecret(value.clientKey, 'clientKey'),
    identity: requireToken(value.identity, 'identity'),
    attestation_hash: requireSha256(value.attestationHash, 'attestationHash'),
    request_timeout_ms: requireTimeout(
      value.requestTimeoutMs === undefined ? DEFAULT_TIMEOUT_MS : value.requestTimeoutMs,
      'requestTimeoutMs',
    ),
    max_journal_bytes: requireMaxJournalBytes(
      value.maxJournalBytes === undefined ? DEFAULT_MAX_JOURNAL_BYTES : value.maxJournalBytes,
    ),
  });
}

function normalizeClientConfig(raw) {
  const value = assertPlainObject(raw, 'external lifecycle witness client config');
  assertOnlyKeys(value, new Set([
    'socketPath',
    'clientKey',
    'timeoutMs',
  ]), 'external lifecycle witness client config');
  return Object.freeze({
    socket_path: requireSocketPath(value.socketPath, 'socketPath'),
    client_key: requireHexSecret(value.clientKey, 'clientKey'),
    timeout_ms: requireTimeout(
      value.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : value.timeoutMs,
      'timeoutMs',
    ),
  });
}

function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function mac(clientKey, direction, payload) {
  return crypto.createHmac('sha256', Buffer.from(clientKey, 'hex'))
    .update(direction, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJson(payload), 'utf8')
    .digest('hex');
}

function requestAuthenticationPayload(request) {
  return {
    protocol_version: request.protocol_version,
    request_id: request.request_id,
    method: request.method,
    request: request.request,
  };
}

function responseAuthenticationPayload(response) {
  return {
    protocol_version: response.protocol_version,
    request_id: response.request_id,
    ok: response.ok,
    ...(response.ok ? { response: response.response } : { error: response.error }),
  };
}

function streamHash(engineRunId, invocationId) {
  return sha256(canonicalJson({ engine_run_id: engineRunId, invocation_id: invocationId }));
}

function observationHead({ method, stream_hash: streamHashValue, sequence, previous_observation_head: previousHead, content_hash: contentHash, identity_hash: identityHash, attestation_hash: attestationHash }) {
  return sha256(canonicalJson({
    protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
    method,
    stream_hash: streamHashValue,
    sequence,
    previous_observation_head: previousHead,
    content_hash: contentHash,
    identity_hash: identityHash,
    attestation_hash: attestationHash,
  }));
}

function normalizeRequestEnvelope(raw) {
  const value = assertPlainObject(raw, 'witness request');
  assertOnlyKeys(value, new Set([
    'protocol_version',
    'request_id',
    'method',
    'request',
    'auth_tag',
  ]), 'witness request');
  if (value.protocol_version !== EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION) {
    throw witnessError('witness request protocol_version is unsupported');
  }
  const requestId = requireSha256(value.request_id, 'witness request.request_id');
  if (typeof value.method !== 'string' || !CLIENT_METHODS.has(value.method)) {
    throw witnessError('witness request.method is unsupported');
  }
  const request = assertPlainObject(value.request, 'witness request.request');
  const authTag = requireSha256(value.auth_tag, 'witness request.auth_tag');
  const expectedRequestId = sha256(canonicalJson({ method: value.method, request }));
  if (requestId !== expectedRequestId) {
    throw witnessError('witness request.request_id does not bind method and request');
  }
  return {
    protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
    request_id: requestId,
    method: value.method,
    request,
    auth_tag: authTag,
  };
}

function requireStreamBindings(value, label) {
  const engineRunId = requireToken(value.engine_run_id, `${label}.engine_run_id`);
  const invocationId = requireToken(value.invocation_id, `${label}.invocation_id`);
  return {
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    stream_hash: streamHash(engineRunId, invocationId),
  };
}

function normalizeOpenRequest(raw) {
  const value = assertPlainObject(raw, 'open request');
  assertOnlyKeys(value, new Set([
    'engine_run_id',
    'invocation_id',
    'envelope',
    'envelope_hash',
  ]), 'open request');
  const bindings = requireStreamBindings(value, 'open request');
  const envelope = assertPlainObject(value.envelope, 'open request.envelope');
  const envelopeHash = requireSha256(value.envelope_hash, 'open request.envelope_hash');
  if (sha256(canonicalJson(envelope)) !== envelopeHash) {
    throw witnessError('open request.envelope_hash does not match envelope');
  }
  return { ...bindings, envelope_hash: envelopeHash };
}

function normalizeAppendRequest(raw) {
  const value = assertPlainObject(raw, 'append_if_head request');
  assertOnlyKeys(value, new Set([
    'engine_run_id',
    'invocation_id',
    'sequence',
    'expected_observation_head',
    'record',
    'record_hash',
  ]), 'append_if_head request');
  const bindings = requireStreamBindings(value, 'append_if_head request');
  if (!Number.isInteger(value.sequence) || value.sequence < 1) {
    throw witnessError('append_if_head request.sequence must be a positive integer');
  }
  const expectedHead = requireSha256(value.expected_observation_head, 'append_if_head request.expected_observation_head');
  const record = assertPlainObject(value.record, 'append_if_head request.record');
  const recordHash = requireSha256(value.record_hash, 'append_if_head request.record_hash');
  if (sha256(canonicalJson(record)) !== recordHash) {
    throw witnessError('append_if_head request.record_hash does not match record');
  }
  return {
    ...bindings,
    sequence: value.sequence,
    expected_observation_head: expectedHead,
    record_hash: recordHash,
  };
}

function normalizeCloseRequest(raw) {
  const value = assertPlainObject(raw, 'close request');
  assertOnlyKeys(value, new Set([
    'engine_run_id',
    'invocation_id',
    'sequence',
    'expected_observation_head',
    'terminal',
    'terminal_hash',
  ]), 'close request');
  const bindings = requireStreamBindings(value, 'close request');
  if (!Number.isInteger(value.sequence) || value.sequence < 1) {
    throw witnessError('close request.sequence must be a positive integer');
  }
  const expectedHead = requireSha256(value.expected_observation_head, 'close request.expected_observation_head');
  const terminal = assertPlainObject(value.terminal, 'close request.terminal');
  const terminalHash = requireSha256(value.terminal_hash, 'close request.terminal_hash');
  if (sha256(canonicalJson(terminal)) !== terminalHash) {
    throw witnessError('close request.terminal_hash does not match terminal');
  }
  return {
    ...bindings,
    sequence: value.sequence,
    expected_observation_head: expectedHead,
    terminal_hash: terminalHash,
  };
}

function normalizeGetHeadRequest(raw) {
  const value = assertPlainObject(raw, 'get_head request');
  assertOnlyKeys(value, new Set(['engine_run_id', 'invocation_id']), 'get_head request');
  return requireStreamBindings(value, 'get_head request');
}

function responseFromRecord(method, rawRequest, record) {
  const bindings = requireStreamBindings(rawRequest, `${method} response request`);
  if (bindings.stream_hash !== record.stream_hash) {
    throw witnessError('stored receipt stream does not match request', 'EXTERNAL_WITNESS_CORRUPT');
  }
  if (method === 'open') {
    return {
      engine_run_id: bindings.engine_run_id,
      invocation_id: bindings.invocation_id,
      envelope_hash: record.envelope_hash,
      observation_head: record.observation_head,
    };
  }
  if (method === 'append_if_head') {
    return {
      engine_run_id: bindings.engine_run_id,
      invocation_id: bindings.invocation_id,
      sequence: record.sequence,
      previous_observation_head: record.previous_observation_head,
      record_hash: record.content_hash,
      observation_head: record.observation_head,
    };
  }
  return {
    engine_run_id: bindings.engine_run_id,
    invocation_id: bindings.invocation_id,
    sequence: record.sequence,
    previous_observation_head: record.previous_observation_head,
    terminal_hash: record.content_hash,
    observation_head: record.observation_head,
  };
}

function requireLinuxWitnessRuntime() {
  if (process.platform !== 'linux' || typeof process.getuid !== 'function') {
    throw witnessError('external lifecycle witness daemon requires Linux uid and descriptor support', 'EXTERNAL_WITNESS_UNSUPPORTED_HOST');
  }
  try {
    fs.accessSync(FLOCK_PATH, fs.constants.X_OK);
    fs.accessSync('/proc/self/fd', fs.constants.R_OK | fs.constants.X_OK);
  } catch (_error) {
    throw witnessError('external lifecycle witness daemon requires /usr/bin/flock and /proc/self/fd', 'EXTERNAL_WITNESS_UNSUPPORTED_HOST');
  }
}

function filesystemUnsafe(message) {
  return witnessError(message, 'EXTERNAL_WITNESS_FILESYSTEM_UNSAFE');
}

function assertTrustedDirectoryStat(stat, label, { requireDaemonOwner = false, requirePrivate = false } = {}) {
  const daemonUid = process.getuid();
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw filesystemUnsafe(`${label} must be a real directory`);
  }
  if (stat.uid !== 0 && stat.uid !== daemonUid) {
    throw filesystemUnsafe(`${label} must be owned by root or the daemon uid`);
  }
  if (requireDaemonOwner && stat.uid !== daemonUid) {
    throw filesystemUnsafe(`${label} must be owned by the daemon uid`);
  }
  if ((stat.mode & 0o022) !== 0) {
    throw filesystemUnsafe(`${label} must not be group/world writable`);
  }
  if (requirePrivate && (stat.mode & 0o077) !== 0) {
    throw filesystemUnsafe(`${label} must not be group/world accessible`);
  }
}

function pathSegments(directoryPath) {
  const root = path.parse(directoryPath).root;
  return directoryPath.slice(root.length).split(path.sep).filter(Boolean);
}

function fsyncDirectoryPath(directoryPath) {
  let fd;
  let failure = null;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    fs.fsyncSync(fd);
  } catch (error) {
    failure = error;
  }
  if (fd !== undefined) {
    try {
      fs.closeSync(fd);
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure) throw failure;
}

function openTrustedDirectory(directoryPath, label, { create = false, requirePrivate = false } = {}) {
  requireLinuxWitnessRuntime();
  const root = path.parse(directoryPath).root;
  let current = root;
  assertTrustedDirectoryStat(fs.lstatSync(root), `${label} root`);
  const segments = pathSegments(directoryPath);
  for (let index = 0; index < segments.length; index += 1) {
    const next = path.join(current, segments[index]);
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch (error) {
      if (!error || error.code !== 'ENOENT' || !create) {
        throw filesystemUnsafe(`${label} contains a missing or unreadable ancestor`);
      }
      try {
        fs.mkdirSync(next, { mode: 0o700 });
        stat = fs.lstatSync(next);
      } catch (_error) {
        throw filesystemUnsafe(`${label} could not create a private directory`);
      }
    }
    assertTrustedDirectoryStat(stat, `${label} ancestor`, {
      requireDaemonOwner: index === segments.length - 1,
      requirePrivate: requirePrivate && index === segments.length - 1,
    });
    if (create) {
      // Re-persist existing entries too: a prior interrupted startup may have
      // created this directory immediately before its parent fsync failed.
      try {
        fsyncDirectoryPath(next);
        fsyncDirectoryPath(current);
      } catch (_error) {
        throw filesystemUnsafe(`${label} directory ancestry could not be persisted`);
      }
    }
    current = next;
  }
  let fd;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    assertTrustedDirectoryStat(fs.fstatSync(fd), label, { requireDaemonOwner: true, requirePrivate });
    return Object.freeze({
      fd,
      logical_path: directoryPath,
      proc_path: `/proc/self/fd/${fd}`,
    });
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_closeError) {}
    }
    if (error && error.code === 'EXTERNAL_WITNESS_FILESYSTEM_UNSAFE') throw error;
    throw filesystemUnsafe(`${label} could not be pinned`);
  }
}

function closeDirectoryHandle(directory) {
  if (!directory) return;
  fs.closeSync(directory.fd);
}

function fileInDirectory(directory, fileName) {
  return `${directory.proc_path}/${fileName}`;
}

function lstatIfExists(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertPrivateRegularFileStat(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw filesystemUnsafe(`${label} must be a regular non-symlink file`);
  }
  if (stat.uid !== process.getuid()) {
    throw filesystemUnsafe(`${label} must be owned by the daemon uid`);
  }
  if ((stat.mode & 0o077) !== 0) {
    throw filesystemUnsafe(`${label} must not be group/world accessible`);
  }
}

function ensurePrivateLeaseFile(directory, fileName, label) {
  const filePath = fileInDirectory(directory, fileName);
  const existing = lstatIfExists(filePath);
  if (existing) assertPrivateRegularFileStat(existing, label);
  let fd;
  try {
    fd = fs.openSync(filePath, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
    assertPrivateRegularFileStat(fs.fstatSync(fd), label);
    if (!existing) {
      fs.fchmodSync(fd, 0o600);
      fs.fsyncSync(fd);
      fs.fsyncSync(directory.fd);
    }
    return fd;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_closeError) {}
    }
    if (error && error.code === 'EXTERNAL_WITNESS_FILESYSTEM_UNSAFE') throw error;
    throw filesystemUnsafe(`${label} could not be opened safely`);
  }
}

function secureJournalFile(directory, fileName) {
  const stat = lstatIfExists(fileInDirectory(directory, fileName));
  if (stat) assertPrivateRegularFileStat(stat, 'journalPath');
  return stat;
}

function fsyncDirectoryHandle(directory) {
  fs.fsyncSync(directory.fd);
}

function journalHash(record) {
  const { journal_hash: _journalHash, ...unsigned } = record;
  return sha256(canonicalJson(unsigned));
}

function makeJournalHeader(config) {
  const record = {
    schema_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
    record_type: 'external_lifecycle_witness_header',
    identity_hash: sha256(config.identity),
    attestation_hash: config.attestation_hash,
    protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
    previous_journal_head: null,
  };
  return { ...record, journal_hash: journalHash(record) };
}

function isJournalHeader(record) {
  return record && record.record_type === 'external_lifecycle_witness_header';
}

function validateJournalHeader(record, config) {
  const value = assertPlainObject(record, 'external witness journal header');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'record_type',
    'identity_hash',
    'attestation_hash',
    'protocol_version',
    'previous_journal_head',
    'journal_hash',
  ]), 'external witness journal header');
  if (value.schema_version !== EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION
    || value.record_type !== 'external_lifecycle_witness_header'
    || value.protocol_version !== EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION
    || value.previous_journal_head !== null
    || requireSha256(value.identity_hash, 'external witness journal header.identity_hash') !== sha256(config.identity)
    || requireSha256(value.attestation_hash, 'external witness journal header.attestation_hash') !== config.attestation_hash
    || requireSha256(value.journal_hash, 'external witness journal header.journal_hash') !== journalHash(value)) {
    throw witnessError('external witness journal header is invalid or belongs to a different daemon binding', 'EXTERNAL_WITNESS_CORRUPT');
  }
}

function normalizeJournalMutation(raw) {
  const value = assertPlainObject(raw, 'external witness journal record');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'record_type',
    'method',
    'request_id',
    'request_hash',
    'stream_hash',
    'sequence',
    'previous_observation_head',
    'content_hash',
    'envelope_hash',
    'observation_head',
    'closed',
    'previous_journal_head',
    'journal_hash',
  ]), 'external witness journal record');
  if (value.schema_version !== EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION
    || value.record_type !== 'external_lifecycle_witness_receipt'
    || !MUTATING_METHODS.has(value.method)
    || !isSha256(value.request_id)
    || !isSha256(value.request_hash)
    || !isSha256(value.stream_hash)
    || !Number.isInteger(value.sequence)
    || value.sequence < 0
    || !isSha256(value.content_hash)
    || !isSha256(value.observation_head)
    || (value.previous_observation_head !== null && !isSha256(value.previous_observation_head))
    || (value.previous_journal_head !== null && !isSha256(value.previous_journal_head))
    || typeof value.closed !== 'boolean'
    || !isSha256(value.journal_hash)) {
    throw witnessError('external witness journal record has invalid fields', 'EXTERNAL_WITNESS_CORRUPT');
  }
  if (value.method === 'open') {
    if (value.sequence !== 0 || value.previous_observation_head !== null || value.closed !== false
      || !isSha256(value.envelope_hash)) {
      throw witnessError('external witness open journal record is invalid', 'EXTERNAL_WITNESS_CORRUPT');
    }
  } else if (value.method === 'append_if_head') {
    if (value.sequence < 1 || !isSha256(value.previous_observation_head) || value.closed !== false
      || Object.prototype.hasOwnProperty.call(value, 'envelope_hash')) {
      throw witnessError('external witness append journal record is invalid', 'EXTERNAL_WITNESS_CORRUPT');
    }
  } else if (value.sequence < 1 || !isSha256(value.previous_observation_head) || value.closed !== true
    || Object.prototype.hasOwnProperty.call(value, 'envelope_hash')) {
    throw witnessError('external witness close journal record is invalid', 'EXTERNAL_WITNESS_CORRUPT');
  }
  if (journalHash(value) !== value.journal_hash.toLowerCase()) {
    throw witnessError('external witness journal record hash does not match content', 'EXTERNAL_WITNESS_CORRUPT');
  }
  return cloneCanonical(value);
}

class ExternalLifecycleWitnessDaemon {
  constructor(config) {
    this.config = normalizeDaemonConfig(config);
    this.identityHash = sha256(this.config.identity);
    this.server = null;
    this.journalHead = null;
    this.streams = new Map();
    this.requests = new Map();
    this.journalDirectory = null;
    this.socketDirectory = null;
    this.journalName = path.basename(this.config.journal_path);
    this.socketName = path.basename(this.config.socket_path);
    this.leases = [];
    this.leaseHealthy = true;
    this.journalHealthy = true;
    this.connections = new Set();
    this.lifecycleState = 'idle';
    this.startPromise = null;
    this.stopPromise = null;
    this.stopRequested = false;
  }

  resetReplayState() {
    this.journalHead = null;
    this.streams = new Map();
    this.requests = new Map();
    this.journalHealthy = true;
  }

  openRuntimeDirectories() {
    this.journalDirectory = openTrustedDirectory(path.dirname(this.config.journal_path), 'journal directory', { create: true });
    try {
      this.socketDirectory = openTrustedDirectory(path.dirname(this.config.socket_path), 'socket directory', {
        create: true,
        requirePrivate: true,
      });
    } catch (error) {
      try { closeDirectoryHandle(this.journalDirectory); } catch (_closeError) {}
      this.journalDirectory = null;
      throw error;
    }
  }

  closeRuntimeDirectories() {
    let closeError = null;
    for (const property of ['socketDirectory', 'journalDirectory']) {
      const directory = this[property];
      this[property] = null;
      if (!directory) continue;
      try {
        closeDirectoryHandle(directory);
      } catch (error) {
        if (!closeError) closeError = error;
      }
    }
    if (closeError) throw closeError;
  }

  journalFilePath() {
    return fileInDirectory(this.journalDirectory, this.journalName);
  }

  socketFilePath() {
    return fileInDirectory(this.socketDirectory, this.socketName);
  }

  leaseSpecs() {
    return [
      {
        kind: 'journal',
        directory: this.journalDirectory,
        file_name: `${this.journalName}.lock`,
        logical_path: `${this.config.journal_path}.lock`,
      },
      {
        kind: 'socket',
        directory: this.socketDirectory,
        file_name: `${this.socketName}.lock`,
        logical_path: `${this.config.socket_path}.lock`,
      },
    ].sort((left, right) => left.logical_path.localeCompare(right.logical_path));
  }

  waitForLeaseReady(child, label) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        child.stdout.off('data', onStdout);
        child.stderr.off('data', onStderr);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_error) {}
        fail(witnessError(`${label} lease did not become ready`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE'));
      }, LEASE_READY_TIMEOUT_MS);
      const onStdout = (chunk) => {
        stdout += chunk;
        const newline = stdout.indexOf('\n');
        if (newline < 0) return;
        try {
          const ready = JSON.parse(stdout.slice(0, newline));
          if (ready && ready.status === 'lease_ready' && ready.parent_pid === process.pid) {
            succeed();
            return;
          }
        } catch (_error) {}
        fail(witnessError(`${label} lease returned an invalid readiness signal`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE'));
      };
      const onStderr = (chunk) => { stderr += chunk; };
      const onError = () => fail(witnessError(`${label} lease could not start`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE'));
      const onExit = (code) => {
        const errorCode = code === 75 ? 'EXTERNAL_WITNESS_LEASE_HELD' : 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE';
        fail(witnessError(`${label} lease exited before readiness${stderr ? `: ${stderr.trim()}` : ''}`, errorCode));
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', onStdout);
      child.stderr.on('data', onStderr);
      child.once('error', onError);
      child.once('exit', onExit);
    });
  }

  async acquireLease(spec) {
    const lockFd = ensurePrivateLeaseFile(spec.directory, spec.file_name, `${spec.kind} lease`);
    let child;
    try {
      child = childProcess.spawn(FLOCK_PATH, [
        '-n',
        '-E',
        '75',
        '-F',
        '/proc/self/fd/3',
        process.execPath,
        __filename,
        '--hold-lease',
        String(process.pid),
      ], {
        cwd: path.dirname(__filename),
        env: { PATH: process.env.PATH || '/usr/bin:/bin' },
        // The holder reads this pipe until EOF. If this daemon is killed, the
        // kernel closes the write end and the flock holder releases its lease.
        stdio: ['pipe', 'pipe', 'pipe', lockFd],
      });
    } catch (error) {
      try { fs.closeSync(lockFd); } catch (_closeError) {}
      throw witnessError(`${spec.kind} lease could not start`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE');
    }
    try {
      fs.closeSync(lockFd);
    } catch (_error) {
      try { child.kill('SIGKILL'); } catch (_killError) {}
      throw witnessError(`${spec.kind} lease descriptor could not close`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE');
    }
    const lease = {
      ...spec,
      child,
      ready: false,
      releasing: false,
      exited: false,
    };
    child.on('exit', () => {
      lease.exited = true;
      if (lease.ready && !lease.releasing && this.lifecycleState !== 'idle') {
        this.leaseHealthy = false;
        this.journalHealthy = false;
      }
    });
    child.on('error', () => {
      if (lease.ready && !lease.releasing && this.lifecycleState !== 'idle') {
        this.leaseHealthy = false;
        this.journalHealthy = false;
      }
    });
    try {
      await this.waitForLeaseReady(child, spec.kind);
      if (lease.exited) {
        throw witnessError(`${spec.kind} lease exited after readiness`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE');
      }
      lease.ready = true;
      this.leases.push(lease);
    } catch (error) {
      lease.releasing = true;
      try { child.kill('SIGKILL'); } catch (_killError) {}
      throw error;
    }
  }

  async acquireLeases() {
    try {
      for (const spec of this.leaseSpecs()) await this.acquireLease(spec);
    } catch (error) {
      try { await this.releaseLeases(); } catch (_releaseError) {}
      throw error;
    }
  }

  releaseLease(lease) {
    if (lease.exited || lease.child.exitCode !== null || lease.child.signalCode !== null) {
      return Promise.resolve();
    }
    lease.releasing = true;
    return new Promise((resolve, reject) => {
      let settled = false;
      let stopTimer = null;
      let forceTimer = null;
      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        if (stopTimer) clearTimeout(stopTimer);
        if (forceTimer) clearTimeout(forceTimer);
        lease.child.off('exit', onExit);
        lease.child.stdin.off('error', onStdinError);
        if (error) reject(error);
        else resolve();
      };
      const onExit = () => {
        finish();
      };
      const onStdinError = () => {
        try { lease.child.kill('SIGTERM'); } catch (_error) {}
      };
      stopTimer = setTimeout(() => {
        try { lease.child.kill('SIGKILL'); } catch (_error) {}
        forceTimer = setTimeout(() => {
          if (!lease.exited) {
            finish(witnessError(`${lease.kind} lease would not stop`, 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE'));
          }
        }, LEASE_READY_TIMEOUT_MS);
      }, LEASE_READY_TIMEOUT_MS);
      lease.child.once('exit', onExit);
      lease.child.stdin.once('error', onStdinError);
      try {
        lease.child.stdin.end();
      } catch (_error) {
        onStdinError();
      }
    });
  }

  async releaseLeases() {
    const leases = this.leases.splice(0).reverse();
    let releaseError = null;
    for (const lease of leases) {
      try {
        await this.releaseLease(lease);
      } catch (error) {
        if (!releaseError) releaseError = error;
      }
    }
    if (releaseError) throw releaseError;
  }

  hasHealthyLeases() {
    return this.leaseHealthy && this.leases.length === 2 && this.leases.every((lease) => lease.ready && !lease.exited);
  }

  failJournal(error) {
    this.journalHealthy = false;
    if (error && typeof error.code === 'string' && error.code.startsWith('EXTERNAL_WITNESS_')) {
      throw error;
    }
    throw witnessError('external witness journal write failed', 'EXTERNAL_WITNESS_JOURNAL_WRITE_FAILED');
  }

  appendJournal(record) {
    if (!this.hasHealthyLeases()) {
      throw witnessError('external witness cannot mutate without healthy leases', 'EXTERNAL_WITNESS_LEASE_UNHEALTHY');
    }
    if (!this.journalHealthy) {
      throw witnessError('external witness journal is no longer writable', 'EXTERNAL_WITNESS_JOURNAL_UNHEALTHY');
    }
    const line = `${canonicalJson(record)}\n`;
    const bytes = Buffer.from(line, 'utf8');
    const journalPath = this.journalFilePath();
    let fd;
    let failure = null;
    try {
      const current = secureJournalFile(this.journalDirectory, this.journalName);
      const currentSize = current ? current.size : 0;
      if (currentSize + bytes.length > this.config.max_journal_bytes) {
        throw witnessError('external witness journal has reached its configured maximum size', 'EXTERNAL_WITNESS_JOURNAL_FULL');
      }
      fd = fs.openSync(
        journalPath,
        fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
        0o600,
      );
      assertPrivateRegularFileStat(fs.fstatSync(fd), 'journalPath');
      fs.fchmodSync(fd, 0o600);
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(fd, bytes, offset, bytes.length - offset, null);
        if (!Number.isInteger(written) || written <= 0) {
          throw witnessError('external witness journal write did not make progress', 'EXTERNAL_WITNESS_JOURNAL_WRITE_FAILED');
        }
        offset += written;
      }
      fs.fsyncSync(fd);
      fsyncDirectoryHandle(this.journalDirectory);
    } catch (error) {
      failure = error;
    }
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (error) {
        if (!failure) failure = error;
      }
    }
    if (failure) {
      if (failure && failure.code === 'EXTERNAL_WITNESS_JOURNAL_FULL') throw failure;
      this.failJournal(failure);
    }
  }

  applyMutation(record) {
    const normalized = normalizeJournalMutation(record);
    if (normalized.previous_journal_head !== this.journalHead) {
      throw witnessError('external witness journal chain head is stale', 'EXTERNAL_WITNESS_CORRUPT');
    }
    if (this.requests.has(normalized.request_id)) {
      throw witnessError('external witness journal repeats a request id', 'EXTERNAL_WITNESS_CORRUPT');
    }
    const expectedObservationHead = observationHead({
      method: normalized.method,
      stream_hash: normalized.stream_hash,
      sequence: normalized.sequence,
      previous_observation_head: normalized.previous_observation_head,
      content_hash: normalized.content_hash,
      identity_hash: this.identityHash,
      attestation_hash: this.config.attestation_hash,
    });
    if (normalized.observation_head !== expectedObservationHead) {
      throw witnessError('external witness journal observation head does not match receipt content', 'EXTERNAL_WITNESS_CORRUPT');
    }
    const stream = this.streams.get(normalized.stream_hash);
    if (normalized.method === 'open') {
      if (stream) throw witnessError('external witness journal opens a stream twice', 'EXTERNAL_WITNESS_CORRUPT');
      this.streams.set(normalized.stream_hash, {
        envelope_hash: normalized.envelope_hash,
        observation_head: normalized.observation_head,
        sequence: 0,
        closed: false,
      });
    } else {
      if (!stream || stream.closed || stream.sequence + 1 !== normalized.sequence
        || stream.observation_head !== normalized.previous_observation_head) {
        throw witnessError('external witness journal stream transition is invalid', 'EXTERNAL_WITNESS_CORRUPT');
      }
      stream.observation_head = normalized.observation_head;
      stream.sequence = normalized.sequence;
      stream.closed = normalized.closed;
    }
    this.requests.set(normalized.request_id, {
      request_hash: normalized.request_hash,
      record: normalized,
    });
    this.journalHead = normalized.journal_hash;
  }

  loadJournal() {
    this.resetReplayState();
    const journalPath = this.journalFilePath();
    const stat = secureJournalFile(this.journalDirectory, this.journalName);
    if (!stat || stat.size === 0) {
      const header = makeJournalHeader(this.config);
      this.appendJournal(header);
      this.journalHead = header.journal_hash;
      return;
    }
    if (stat.size > this.config.max_journal_bytes) {
      throw witnessError('external witness journal exceeds configured maximum size', 'EXTERNAL_WITNESS_CORRUPT');
    }
    const journal = fs.readFileSync(journalPath, 'utf8');
    if (!journal.endsWith('\n')) {
      throw witnessError('external witness journal has a non-terminated final record', 'EXTERNAL_WITNESS_CORRUPT');
    }
    const lines = journal.slice(0, -1).split('\n');
    if (lines.length === 0) throw witnessError('external witness journal has no header', 'EXTERNAL_WITNESS_CORRUPT');
    let header;
    try {
      header = JSON.parse(lines[0]);
    } catch (_error) {
      throw witnessError('external witness journal header is not JSON', 'EXTERNAL_WITNESS_CORRUPT');
    }
    validateJournalHeader(header, this.config);
    this.journalHead = header.journal_hash;
    for (const line of lines.slice(1)) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (_error) {
        throw witnessError('external witness journal contains invalid JSON', 'EXTERNAL_WITNESS_CORRUPT');
      }
      this.applyMutation(record);
    }
  }

  prepareMutation(method, rawRequest, requestId, requestHash) {
    if (method === 'open') {
      const request = normalizeOpenRequest(rawRequest);
      const existing = this.streams.get(request.stream_hash);
      if (existing) {
        throw witnessError('external witness stream already exists', 'EXTERNAL_WITNESS_STREAM_EXISTS');
      }
      const nextHead = observationHead({
        method,
        stream_hash: request.stream_hash,
        sequence: 0,
        previous_observation_head: null,
        content_hash: request.envelope_hash,
        identity_hash: this.identityHash,
        attestation_hash: this.config.attestation_hash,
      });
      const record = {
        schema_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
        record_type: 'external_lifecycle_witness_receipt',
        method,
        request_id: requestId,
        request_hash: requestHash,
        stream_hash: request.stream_hash,
        sequence: 0,
        previous_observation_head: null,
        content_hash: request.envelope_hash,
        envelope_hash: request.envelope_hash,
        observation_head: nextHead,
        closed: false,
        previous_journal_head: this.journalHead,
      };
      record.journal_hash = journalHash(record);
      return { record, response: responseFromRecord(method, rawRequest, record) };
    }

    const request = method === 'append_if_head'
      ? normalizeAppendRequest(rawRequest)
      : normalizeCloseRequest(rawRequest);
    const stream = this.streams.get(request.stream_hash);
    if (!stream || stream.closed) {
      throw witnessError('external witness stream is unavailable', 'EXTERNAL_WITNESS_STREAM_UNAVAILABLE');
    }
    if (stream.sequence + 1 !== request.sequence || stream.observation_head !== request.expected_observation_head) {
      throw witnessError('external witness compare-and-append head is stale', 'EXTERNAL_WITNESS_HEAD_STALE');
    }
    const contentHash = method === 'append_if_head' ? request.record_hash : request.terminal_hash;
    const nextHead = observationHead({
      method,
      stream_hash: request.stream_hash,
      sequence: request.sequence,
      previous_observation_head: request.expected_observation_head,
      content_hash: contentHash,
      identity_hash: this.identityHash,
      attestation_hash: this.config.attestation_hash,
    });
    const record = {
      schema_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
      record_type: 'external_lifecycle_witness_receipt',
      method,
      request_id: requestId,
      request_hash: requestHash,
      stream_hash: request.stream_hash,
      sequence: request.sequence,
      previous_observation_head: request.expected_observation_head,
      content_hash: contentHash,
      observation_head: nextHead,
      closed: method === 'close',
      previous_journal_head: this.journalHead,
    };
    record.journal_hash = journalHash(record);
    return { record, response: responseFromRecord(method, rawRequest, record) };
  }

  executeRequest(envelope) {
    if (!this.hasHealthyLeases()) {
      throw witnessError('external witness lease is no longer healthy', 'EXTERNAL_WITNESS_LEASE_UNHEALTHY');
    }
    if (!this.journalHealthy) {
      throw witnessError('external witness journal is no longer writable', 'EXTERNAL_WITNESS_JOURNAL_UNHEALTHY');
    }
    const request = normalizeRequestEnvelope(envelope);
    const expectedTag = mac(this.config.client_key, 'request', requestAuthenticationPayload(request));
    if (!secureEqual(request.auth_tag, expectedTag)) {
      throw witnessError('external witness request authentication failed', 'EXTERNAL_WITNESS_AUTH_FAILED');
    }
    const requestHash = sha256(canonicalJson({ method: request.method, request: request.request }));
    if (request.method === 'get_head') {
      const bindings = normalizeGetHeadRequest(request.request);
      const stream = this.streams.get(bindings.stream_hash);
      if (!stream) throw witnessError('external witness stream is unavailable', 'EXTERNAL_WITNESS_STREAM_UNAVAILABLE');
      return {
        engine_run_id: bindings.engine_run_id,
        invocation_id: bindings.invocation_id,
        sequence: stream.sequence,
        observation_head: stream.observation_head,
        closed: stream.closed,
      };
    }
    const duplicate = this.requests.get(request.request_id);
    if (duplicate) {
      if (duplicate.request_hash !== requestHash) {
        throw witnessError('external witness request id conflicts with a prior request', 'EXTERNAL_WITNESS_REQUEST_CONFLICT');
      }
      return responseFromRecord(request.method, request.request, duplicate.record);
    }
    const mutation = this.prepareMutation(request.method, request.request, request.request_id, requestHash);
    this.appendJournal(mutation.record);
    try {
      this.applyMutation(mutation.record);
    } catch (error) {
      // The durable receipt is already committed. Never continue from an
      // in-memory head that may no longer represent the journal tail.
      this.journalHealthy = false;
      throw error;
    }
    return mutation.response;
  }

  responseEnvelope(requestId, ok, body) {
    const envelope = {
      protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
      request_id: requestId,
      ok,
      ...(ok ? { response: cloneCanonical(body) } : { error: body }),
    };
    return {
      ...envelope,
      auth_tag: mac(this.config.client_key, 'response', responseAuthenticationPayload(envelope)),
    };
  }

  handleSocket(socket) {
    this.connections.add(socket);
    let body = '';
    let complete = false;
    let drainTimer = null;
    const deadlineTimer = setTimeout(() => finish(null, false, 'request_deadline_exceeded'), this.config.request_timeout_ms);
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      if (drainTimer) clearTimeout(drainTimer);
      this.connections.delete(socket);
    };
    const finish = (requestId, ok, payload) => {
      if (complete) return;
      complete = true;
      clearTimeout(deadlineTimer);
      try {
        socket.end(`${canonicalJson(this.responseEnvelope(requestId, ok, payload))}\n`);
        // A hostile peer may keep its read half open after a response. The
        // server owns one request per connection, so never retain it forever.
        drainTimer = setTimeout(() => socket.destroy(), RESPONSE_DRAIN_TIMEOUT_MS);
      } catch (_error) {
        socket.destroy();
      }
    };
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (complete) return;
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_MESSAGE_BYTES) finish(null, false, 'request_too_large');
    });
    socket.on('end', () => {
      if (complete) return;
      let envelope;
      let requestId = null;
      try {
        envelope = JSON.parse(body);
        requestId = envelope && typeof envelope.request_id === 'string' && isSha256(envelope.request_id)
          ? envelope.request_id.toLowerCase()
          : null;
        finish(requestId, true, this.executeRequest(envelope));
      } catch (error) {
        finish(requestId, false, error && typeof error.code === 'string' ? error.code : 'request_rejected');
      }
    });
    socket.on('error', () => {});
    socket.once('close', cleanup);
  }

  removeStaleSocket() {
    const socketPath = this.socketFilePath();
    const stat = lstatIfExists(socketPath);
    if (!stat) return;
    if (!stat.isSocket() || stat.isSymbolicLink()
      || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
      throw filesystemUnsafe('socketPath exists but is not a private daemon-owned socket');
    }
    fs.unlinkSync(socketPath);
    fsyncDirectoryHandle(this.socketDirectory);
  }

  async closeServer() {
    const server = this.server;
    this.server = null;
    for (const socket of this.connections) socket.destroy();
    if (!server || !server.listening) return;
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  start() {
    if (this.lifecycleState !== 'idle') {
      throw witnessError('external lifecycle witness daemon is already starting or running');
    }
    this.lifecycleState = 'starting';
    this.stopRequested = false;
    this.leaseHealthy = true;
    const work = this.startInternal();
    let trackedStart;
    trackedStart = work.finally(() => {
      if (this.startPromise === trackedStart) this.startPromise = null;
    });
    this.startPromise = trackedStart;
    return trackedStart;
  }

  async startInternal() {
    try {
      requireLinuxWitnessRuntime();
      this.openRuntimeDirectories();
      await this.acquireLeases();
      if (this.stopRequested) {
        throw witnessError('external lifecycle witness start was cancelled', 'EXTERNAL_WITNESS_START_CANCELLED');
      }
      this.loadJournal();
      if (!this.hasHealthyLeases()) {
        throw witnessError('external lifecycle witness lease ended during start', 'EXTERNAL_WITNESS_LEASE_UNHEALTHY');
      }
      if (this.stopRequested) {
        throw witnessError('external lifecycle witness start was cancelled', 'EXTERNAL_WITNESS_START_CANCELLED');
      }
      this.removeStaleSocket();
      this.server = net.createServer((socket) => this.handleSocket(socket));
      this.server.on('error', () => {
        this.leaseHealthy = false;
        this.journalHealthy = false;
      });
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.socketFilePath(), () => {
          this.server.off('error', reject);
          resolve();
        });
      });
      fs.chmodSync(this.socketFilePath(), 0o600);
      const socketStat = fs.lstatSync(this.socketFilePath());
      if (!socketStat.isSocket() || socketStat.isSymbolicLink()
        || socketStat.uid !== process.getuid() || (socketStat.mode & 0o077) !== 0) {
        throw filesystemUnsafe('daemon socket did not receive private daemon-owned permissions');
      }
      if (this.stopRequested) {
        throw witnessError('external lifecycle witness start was cancelled', 'EXTERNAL_WITNESS_START_CANCELLED');
      }
      this.lifecycleState = 'running';
      return this;
    } catch (error) {
      try { await this.closeServer(); } catch (_serverError) {}
      try { await this.releaseLeases(); } catch (_leaseError) {}
      try { this.closeRuntimeDirectories(); } catch (_directoryError) {}
      this.lifecycleState = 'idle';
      throw error;
    }
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopRequested = true;
    const work = this.stopInternal();
    let trackedStop;
    trackedStop = work.finally(() => {
      if (this.stopPromise === trackedStop) this.stopPromise = null;
    });
    this.stopPromise = trackedStop;
    return trackedStop;
  }

  async stopInternal() {
    const pendingStart = this.startPromise;
    if (pendingStart) {
      try { await pendingStart; } catch (_startError) {}
    }
    if (this.lifecycleState === 'idle') {
      this.stopRequested = false;
      return;
    }
    this.lifecycleState = 'stopping';
    let stopError = null;
    try {
      await this.closeServer();
    } catch (error) {
      stopError = error;
    }
    try {
      await this.releaseLeases();
    } catch (error) {
      if (!stopError) stopError = error;
    }
    try {
      this.closeRuntimeDirectories();
    } catch (error) {
      if (!stopError) stopError = error;
    }
    this.lifecycleState = 'idle';
    this.stopRequested = false;
    if (stopError) throw stopError;
  }
}

function invokeSocketRequest(raw) {
  const value = assertPlainObject(raw, 'external lifecycle witness client request');
  assertOnlyKeys(value, new Set([
    'socketPath',
    'clientKey',
    'timeoutMs',
    'method',
    'request',
  ]), 'external lifecycle witness client request');
  const config = normalizeClientConfig({
    socketPath: value.socketPath,
    clientKey: value.clientKey,
    timeoutMs: value.timeoutMs,
  });
  if (typeof value.method !== 'string' || !CLIENT_METHODS.has(value.method)) {
    throw witnessError('external lifecycle witness client method is unsupported');
  }
  const request = assertPlainObject(value.request, 'external lifecycle witness client request.request');
  const requestId = sha256(canonicalJson({ method: value.method, request }));
  const envelope = {
    protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
    request_id: requestId,
    method: value.method,
    request,
  };
  const authenticated = {
    ...envelope,
    auth_tag: mac(config.client_key, 'request', requestAuthenticationPayload(envelope)),
  };
  let socketDirectory;
  let pinnedSocketPath;
  try {
    socketDirectory = openTrustedDirectory(path.dirname(config.socket_path), 'client socket directory', {
      requirePrivate: true,
    });
    pinnedSocketPath = fileInDirectory(socketDirectory, path.basename(config.socket_path));
    const socketStat = lstatIfExists(pinnedSocketPath);
    if (!socketStat) {
      throw witnessError('external lifecycle witness socket is unavailable', 'EXTERNAL_WITNESS_UNAVAILABLE');
    }
    if (!socketStat.isSocket() || socketStat.isSymbolicLink()
      || socketStat.uid !== process.getuid() || (socketStat.mode & 0o077) !== 0) {
      throw filesystemUnsafe('external lifecycle witness socket is not private and daemon-owned');
    }
  } catch (error) {
    if (socketDirectory) {
      try { closeDirectoryHandle(socketDirectory); } catch (_closeError) {}
    }
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    let deadlineTimer = null;
    let directoryClosed = false;
    let socket;
    const closeDirectory = () => {
      if (directoryClosed) return;
      directoryClosed = true;
      try { closeDirectoryHandle(socketDirectory); } catch (_error) {}
    };
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
      if (deadlineTimer) clearTimeout(deadlineTimer);
      closeDirectory();
    };
    const fail = (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(witnessError('external lifecycle witness request failed', code));
    };
    try {
      socket = net.createConnection({ path: pinnedSocketPath });
      deadlineTimer = setTimeout(() => fail('EXTERNAL_WITNESS_TIMEOUT'), config.timeout_ms);
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.end(`${canonicalJson(authenticated)}\n`));
      socket.on('data', (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output, 'utf8') > MAX_MESSAGE_BYTES) fail('EXTERNAL_WITNESS_RESPONSE_TOO_LARGE');
      });
      socket.on('error', () => fail('EXTERNAL_WITNESS_UNAVAILABLE'));
      socket.on('end', () => {
        if (settled) return;
        let response;
        try {
          response = JSON.parse(output.trim());
          const normalized = assertPlainObject(response, 'external lifecycle witness response');
          assertOnlyKeys(normalized, new Set([
            'protocol_version',
            'request_id',
            'ok',
            'response',
            'error',
            'auth_tag',
          ]), 'external lifecycle witness response');
          if (normalized.protocol_version !== EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION
            || normalized.request_id !== requestId
            || typeof normalized.ok !== 'boolean'
            || !isSha256(normalized.auth_tag)) {
            throw witnessError('external lifecycle witness response binding is invalid');
          }
          if (normalized.ok) {
            if (!Object.prototype.hasOwnProperty.call(normalized, 'response')
              || Object.prototype.hasOwnProperty.call(normalized, 'error')) {
              throw witnessError('external lifecycle witness response shape is invalid');
            }
          } else if (typeof normalized.error !== 'string' || normalized.error.length === 0
            || Object.prototype.hasOwnProperty.call(normalized, 'response')) {
            throw witnessError('external lifecycle witness error response shape is invalid');
          }
          const unsigned = {
            protocol_version: normalized.protocol_version,
            request_id: normalized.request_id,
            ok: normalized.ok,
            ...(normalized.ok ? { response: normalized.response } : { error: normalized.error }),
          };
          const expectedTag = mac(config.client_key, 'response', responseAuthenticationPayload(unsigned));
          if (!secureEqual(normalized.auth_tag, expectedTag)) {
            throw witnessError('external lifecycle witness response authentication failed');
          }
          if (!normalized.ok) {
            throw witnessError('external lifecycle witness rejected the request', normalized.error);
          }
          settled = true;
          cleanup();
          resolve(cloneCanonical(normalized.response));
        } catch (error) {
          fail(error && typeof error.code === 'string' ? error.code : 'EXTERNAL_WITNESS_RESPONSE_INVALID');
        }
      });
    } catch (_error) {
      closeDirectory();
      reject(witnessError('external lifecycle witness request failed', 'EXTERNAL_WITNESS_UNAVAILABLE'));
    }
  });
}

async function clientMain() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > MAX_MESSAGE_BYTES) {
      throw witnessError('external lifecycle witness client input is too large');
    }
  }
  const result = await invokeSocketRequest(JSON.parse(input));
  process.stdout.write(`${canonicalJson(result)}\n`);
}

class BoundedUnixLifecycleObserver {
  constructor(config) {
    this.config = normalizeClientConfig(config);
  }

  invoke(method, request) {
    if (!CLIENT_METHODS.has(method)) {
      throw witnessError('external lifecycle witness observer operation is unsupported');
    }
    const childInput = canonicalJson({
      socketPath: this.config.socket_path,
      clientKey: this.config.client_key,
      timeoutMs: this.config.timeout_ms,
      method,
      request,
    });
    const child = childProcess.spawnSync(process.execPath, [__filename, '--client'], {
      cwd: path.dirname(__filename),
      env: { PATH: process.env.PATH || '/usr/bin:/bin' },
      input: `${childInput}\n`,
      encoding: 'utf8',
      maxBuffer: MAX_MESSAGE_BYTES,
      timeout: this.config.timeout_ms + 250,
      killSignal: 'SIGKILL',
    });
    if (child.error || child.signal || child.status !== 0) {
      throw witnessError('bounded external lifecycle witness helper did not complete', 'EXTERNAL_WITNESS_UNAVAILABLE');
    }
    let output;
    try {
      output = JSON.parse(child.stdout.trim());
    } catch (_error) {
      throw witnessError('bounded external lifecycle witness helper returned invalid JSON', 'EXTERNAL_WITNESS_RESPONSE_INVALID');
    }
    return cloneCanonical(output);
  }

  open(request) {
    return this.invoke('open', request);
  }

  appendIfHead(request) {
    return this.invoke('append_if_head', request);
  }

  close(request) {
    return this.invoke('close', request);
  }

  getHead(request) {
    return this.invoke('get_head', request);
  }
}

function createBoundedUnixLifecycleObserver(config) {
  return new BoundedUnixLifecycleObserver(config);
}

async function leaseHolderMain() {
  const parentPid = Number(process.argv[3]);
  if (!Number.isInteger(parentPid) || parentPid < 1 || process.ppid !== parentPid) {
    throw witnessError('external lifecycle witness lease parent is invalid', 'EXTERNAL_WITNESS_LEASE_UNAVAILABLE');
  }
  process.stdout.write(`${canonicalJson({ status: 'lease_ready', parent_pid: parentPid })}\n`);
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.pause();
      resolve();
    };
    // The parent keeps this pipe open for the daemon lifetime. Its close is
    // kernel-enforced even when the daemon dies without a signal handler.
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
    process.stdin.resume();
  });
}

async function serveMain() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, 'utf8') > MAX_MESSAGE_BYTES) {
      throw witnessError('external lifecycle witness daemon config is too large');
    }
  }
  const daemon = new ExternalLifecycleWitnessDaemon(JSON.parse(input));
  await daemon.start();
  process.stdout.write(`${canonicalJson({
    status: 'ready',
    protocol_version: EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
  })}\n`);
  const stop = async () => {
    try {
      await daemon.stop();
      process.exit(0);
    } catch (_error) {
      process.exit(1);
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (require.main === module) {
  const mode = process.argv[2];
  const run = mode === '--client'
    ? clientMain
    : mode === '--serve'
      ? serveMain
      : mode === '--hold-lease'
        ? leaseHolderMain
        : null;
  if (!run) {
    process.stderr.write('usage: node external-lifecycle-witness.js --client|--serve < config.json\n');
    process.exitCode = 2;
  } else {
    run().catch((error) => {
      const code = error && error.code ? error.code : 'EXTERNAL_WITNESS_FAILED';
      const message = error && error.message ? error.message : 'external lifecycle witness failed';
      process.stderr.write(`${code}: ${message}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  BoundedUnixLifecycleObserver,
  EXTERNAL_LIFECYCLE_WITNESS_PROTOCOL_VERSION,
  ExternalLifecycleWitnessDaemon,
  createBoundedUnixLifecycleObserver,
  invokeSocketRequest,
  normalizeClientConfig,
  normalizeDaemonConfig,
};
