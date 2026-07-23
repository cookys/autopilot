#!/usr/bin/env node
'use strict';

// Installed P3.5 entrypoint. This process runs as the dedicated verifier UID.
// Its only successful output is a non-authoritative verified-intake receipt.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  MAX_CANONICAL_REQUEST_BYTES,
  createFileReplayStore,
  normalizeAuthenticatedIntakeKeyring,
  parseCanonicalJsonBytes,
  verifyHostPinnedAuthenticatedIntake,
} = require('./supervised-authenticated-intake');
const {
  compileSupervisedEngineBridgeContract,
  verifySupervisedEngineBridgeContract,
} = require('./supervised-engine-bridge-contract');
const {
  buildVerifiedIntakeCapsule,
  createFileShadowEngineConsumer,
} = require('./supervised-shadow-engine-consumer');
const { canonicalJson, sha256 } = require('./owner-kernel/canonical');

const HOST_SCHEMA_VERSION = 1;
const CONFIG_RELATIVE_PATH = 'etc/supervised-intake-host.json';
const VERIFIER_RELATIVE_PATH = 'lib/supervised-intake-verifier.js';
const MAX_CONFIG_BYTES = 65536;
const REQUIRED_FILE_KEYS = Object.freeze([
  'authenticated_intake',
  'actions',
  'bridge_contract',
  'canonical',
  'errors',
  'policy',
  'shadow_engine_consumer',
  'verifier',
]);
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

class VerifierEntrypointError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerifierEntrypointError';
  }
}

function fail(message) {
  throw new VerifierEntrypointError(message);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be an object`);
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

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) fail(`${label} must be a bounded token`);
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail(`${label} must be a lowercase SHA-256 digest`);
  return value;
}

function requireInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a bounded integer`);
  }
  return value;
}

function requireDecimalCliInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`${label} must be a canonical decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum || String(parsed) !== value) {
    fail(`${label} must be a bounded decimal integer`);
  }
  return parsed;
}

function requireAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value || value === '/') {
    fail(`${label} must be a canonical non-root absolute path`);
  }
  return value;
}

function pathComponents(absolutePath) {
  const components = ['/'];
  let current = '';
  for (const part of absolutePath.split('/')) {
    if (part) {
      current += `/${part}`;
      components.push(current);
    }
  }
  return components;
}

function requireRootOwnedPath(absolutePath, label, { directory = false, executable = false } = {}) {
  const candidate = requireAbsolutePath(absolutePath, label);
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch (error) {
    fail(`${label} cannot be resolved: ${error.message}`);
  }
  if (resolved !== candidate) fail(`${label} must not resolve through a symlink`);
  for (const component of pathComponents(candidate)) {
    let info;
    try {
      info = fs.lstatSync(component);
    } catch (error) {
      fail(`${label} has an unreadable ancestor: ${error.message}`);
    }
    if (info.isSymbolicLink() || info.uid !== 0 || (info.mode & 0o022) !== 0) {
      fail(`${label} has an untrusted ancestor ${component}`);
    }
  }
  const info = fs.lstatSync(candidate);
  if (directory && !info.isDirectory()) fail(`${label} must be a directory`);
  if (!directory && !info.isFile()) fail(`${label} must be a regular file`);
  if (executable && (info.mode & 0o111) === 0) fail(`${label} must be executable`);
  return candidate;
}

function requireVerifierStateDirectory(absolutePath, verifier) {
  const candidate = requireAbsolutePath(absolutePath, 'verifier state_root');
  let info;
  try {
    info = fs.lstatSync(candidate);
  } catch (error) {
    fail(`verifier state_root cannot be inspected: ${error.message}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()
    || info.uid !== verifier.uid || info.gid !== verifier.gid || (info.mode & 0o777) !== 0o700) {
    fail('verifier state_root does not have the expected identity and mode');
  }
  const parent = path.dirname(candidate);
  requireRootOwnedPath(parent, 'verifier state_root parent', { directory: true });
  const replayDirectory = path.join(candidate, 'replay');
  const replay = fs.lstatSync(replayDirectory);
  if (replay.isSymbolicLink() || !replay.isDirectory()
    || replay.uid !== verifier.uid || replay.gid !== verifier.gid || (replay.mode & 0o777) !== 0o700) {
    fail('verifier replay directory does not have the expected identity and mode');
  }
  return candidate;
}

function fileDigest(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  const block = Buffer.allocUnsafe(16384);
  while (true) {
    const read = fs.readSync(0, block, 0, block.length, null);
    if (read === 0) break;
    total += read;
    if (total > MAX_CANONICAL_REQUEST_BYTES) fail('verifier request exceeds the fixed byte limit');
    chunks.push(Buffer.from(block.subarray(0, read)));
  }
  if (total === 0) fail('verifier request is empty');
  return Buffer.concat(chunks, total);
}

function parseArgs(argv) {
  if (argv.length !== 11 || argv[0] !== 'verify') {
    fail('usage is verify --config PATH --session-id ID --session-challenge-hash HASH --session-expires-at-ms TIME --install-binding-hash HASH');
  }
  const expected = ['--config', '--session-id', '--session-challenge-hash', '--session-expires-at-ms', '--install-binding-hash'];
  const values = {};
  for (let index = 0; index < expected.length; index += 1) {
    if (argv[index * 2 + 1] !== expected[index]) fail('verifier arguments must use the fixed ordered protocol');
    values[expected[index].slice(2).replaceAll('-', '_')] = argv[index * 2 + 2];
  }
  return {
    config: requireAbsolutePath(values.config, 'verifier config'),
    session_id: requireToken(values.session_id, 'verifier session_id'),
    session_challenge_hash: requireDigest(values.session_challenge_hash, 'verifier session_challenge_hash'),
    session_expires_at_ms: requireDecimalCliInteger(values.session_expires_at_ms, 'verifier session_expires_at_ms', 1),
    install_binding_hash: requireDigest(values.install_binding_hash, 'verifier install_binding_hash'),
  };
}

function normalizeIdentity(raw, label, expectedIdentity) {
  const value = requireExactKeys(raw, new Set(['gid', 'identity', 'uid']), label);
  const identity = requireToken(value.identity, `${label}.identity`);
  const uid = requireInteger(value.uid, `${label}.uid`, 1, 0x7fffffff);
  const gid = requireInteger(value.gid, `${label}.gid`, 1, 0x7fffffff);
  if (identity !== expectedIdentity) fail(`${label}.identity is not fixed`);
  return { identity, uid, gid };
}

function normalizeInstalledConfig(raw, configPath) {
  const value = requireExactKeys(raw, new Set([
    'binding_hash',
    'files',
    'install_root',
    'keyring',
    'limits',
    'paths',
    'runtime_parent',
    'schema_version',
    'state_root',
    'systemd_properties',
    'verifier',
    'worker',
  ]), 'installed P3.5 config');
  if (value.schema_version !== HOST_SCHEMA_VERSION) fail('installed P3.5 config schema_version is unsupported');
  const installRoot = requireAbsolutePath(value.install_root, 'installed P3.5 install_root');
  const expectedConfig = path.join(installRoot, CONFIG_RELATIVE_PATH);
  if (configPath !== expectedConfig) fail('verifier config path is not the installed fixed path');
  const material = { ...value };
  delete material.binding_hash;
  if (requireDigest(value.binding_hash, 'installed P3.5 binding_hash') !== sha256(canonicalJson(material))) {
    fail('installed P3.5 config binding_hash does not match content');
  }
  const worker = normalizeIdentity(value.worker, 'installed P3.5 worker', 'autopilot-intake-worker');
  const verifier = normalizeIdentity(value.verifier, 'installed P3.5 verifier', 'autopilot-verifier');
  if (worker.uid === verifier.uid || worker.gid === verifier.gid) fail('installed worker and verifier must be distinct');
  const paths = requireExactKeys(value.paths, new Set([
    'node_path',
    'python_path',
    'setpriv_path',
    'systemctl_path',
    'systemd_run_path',
  ]), 'installed P3.5 paths');
  for (const key of Object.keys(paths)) paths[key] = requireRootOwnedPath(paths[key], `installed P3.5 ${key}`, { executable: true });
  const files = requirePlainObject(value.files, 'installed P3.5 files');
  if (Object.keys(files).length < REQUIRED_FILE_KEYS.length) fail('installed P3.5 files are incomplete');
  for (const key of REQUIRED_FILE_KEYS) {
    const entry = requireExactKeys(files[key], new Set(['relative_path', 'sha256']), `installed P3.5 ${key} snapshot`);
    const relative = entry.relative_path;
    if (typeof relative !== 'string' || relative.startsWith('/') || relative.includes('..')) {
      fail(`installed P3.5 ${key} snapshot path is invalid`);
    }
    const destination = path.join(installRoot, relative);
    requireRootOwnedPath(destination, `installed P3.5 ${key} snapshot`, { executable: key === 'verifier' });
    if (fileDigest(destination) !== requireDigest(entry.sha256, `installed P3.5 ${key} snapshot hash`)) {
      fail(`installed P3.5 ${key} snapshot hash does not match`);
    }
  }
  const keyring = requireExactKeys(value.keyring, new Set(['authority', 'relative_path', 'sha256']), 'installed P3.5 keyring');
  if (typeof keyring.relative_path !== 'string' || keyring.relative_path.startsWith('/') || keyring.relative_path.includes('..')) {
    fail('installed P3.5 keyring path is invalid');
  }
  const keyringPath = path.join(installRoot, keyring.relative_path);
  requireRootOwnedPath(keyringPath, 'installed P3.5 keyring snapshot');
  if (fileDigest(keyringPath) !== requireDigest(keyring.sha256, 'installed P3.5 keyring hash')) {
    fail('installed P3.5 keyring hash does not match');
  }
  const authority = requireExactKeys(keyring.authority, new Set(['attestation_hash', 'issuer', 'key_id']), 'installed P3.5 keyring authority');
  const limits = requireExactKeys(value.limits, new Set([
    'max_clock_rollback_milliseconds',
    'max_envelope_lifetime_milliseconds',
    'max_future_skew_milliseconds',
    'max_runtime_sessions',
    'request_timeout_seconds',
    'session_creation_grace_milliseconds',
    'session_submit_grace_milliseconds',
    'session_ttl_milliseconds',
  ]), 'installed P3.5 limits');
  for (const key of Object.keys(limits)) requireInteger(limits[key], `installed P3.5 ${key}`, key === 'request_timeout_seconds' ? 1 : 0);
  if (!Array.isArray(value.systemd_properties) || value.systemd_properties.some((item) => typeof item !== 'string')) {
    fail('installed P3.5 systemd_properties are invalid');
  }
  return {
    binding_hash: value.binding_hash,
    install_root: installRoot,
    runtime_parent: requireAbsolutePath(value.runtime_parent, 'installed P3.5 runtime_parent'),
    state_root: requireVerifierStateDirectory(value.state_root, verifier),
    worker,
    verifier,
    paths,
    files,
    keyring: { ...keyring, authority: {
      issuer: requireToken(authority.issuer, 'installed P3.5 authority issuer'),
      key_id: requireToken(authority.key_id, 'installed P3.5 authority key_id'),
      attestation_hash: requireDigest(authority.attestation_hash, 'installed P3.5 authority attestation_hash'),
    } },
    limits: { ...limits },
    systemd_properties: [...value.systemd_properties],
  };
}

function loadInstalledConfig(configPath) {
  requireRootOwnedPath(configPath, 'installed P3.5 config');
  const bytes = fs.readFileSync(configPath);
  if (bytes.length > MAX_CONFIG_BYTES) fail('installed P3.5 config is too large');
  return normalizeInstalledConfig(parseCanonicalJsonBytes(bytes, 'installed P3.5 config', MAX_CONFIG_BYTES), configPath);
}

function loadInstalledKeyring(config) {
  const keyringPath = path.join(config.install_root, config.keyring.relative_path);
  const keyring = normalizeAuthenticatedIntakeKeyring(parseCanonicalJsonBytes(
    fs.readFileSync(keyringPath),
    'installed P3.5 keyring',
    MAX_CONFIG_BYTES,
  ));
  if (keyring.authority.issuer !== config.keyring.authority.issuer
    || keyring.authority.key_id !== config.keyring.authority.key_id
    || keyring.authority.attestation_hash !== config.keyring.authority.attestation_hash) {
    fail('installed P3.5 keyring does not match its pinned authority');
  }
  return keyring;
}

function readRequest() {
  const value = requireExactKeys(parseCanonicalJsonBytes(readBoundedStdin(), 'P3.5 verifier request'), new Set([
    'bridge_input',
    'envelope',
    'protocol_version',
    'session_id',
  ]), 'P3.5 verifier request');
  if (value.protocol_version !== HOST_SCHEMA_VERSION) fail('P3.5 verifier request protocol_version is unsupported');
  return {
    bridge_input: requirePlainObject(value.bridge_input, 'P3.5 verifier bridge_input'),
    envelope: requirePlainObject(value.envelope, 'P3.5 verifier envelope'),
    session_id: requireToken(value.session_id, 'P3.5 verifier request session_id'),
  };
}

function assertSessionActive(args) {
  if (Date.now() >= args.session_expires_at_ms) fail('verifier session has expired');
}

function assertEntrypoint(config) {
  const expectedScript = path.join(config.install_root, VERIFIER_RELATIVE_PATH);
  if (path.resolve(__filename) !== expectedScript) fail('verifier must run from the installed fixed snapshot path');
  requireRootOwnedPath(expectedScript, 'installed verifier entrypoint', { executable: true });
  if (path.resolve(process.execPath) !== config.paths.node_path) fail('verifier Node executable does not match installed config');
  if (typeof process.getuid !== 'function' || process.getuid() !== config.verifier.uid
    || typeof process.getgid !== 'function' || process.getgid() !== config.verifier.gid) {
    fail('verifier process does not have the installed verifier identity');
  }
  if (typeof process.getgroups === 'function') {
    const groups = new Set(process.getgroups());
    if (groups.size !== 1 || !groups.has(config.verifier.gid)) {
      fail('verifier process has unexpected supplementary groups');
    }
  }
}

function execute() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadInstalledConfig(args.config);
  assertEntrypoint(config);
  if (args.install_binding_hash !== config.binding_hash) fail('verifier install binding does not match installed config');
  assertSessionActive(args);
  const request = readRequest();
  if (request.session_id !== args.session_id) fail('verifier request does not match the host session');
  const keyring = loadInstalledKeyring(config);
  const shadowConsumer = createFileShadowEngineConsumer({ state_directory: config.state_root });
  try {
    // The gateway holds the verifier-wide replay lock for this complete call.
    // A restarted pending shadow record becomes only a durable diagnostic.
    shadowConsumer.recoverPending();
    const replayStore = createFileReplayStore({ state_directory: config.state_root });
    const verifierConfig = {
      install_binding_hash: config.binding_hash,
      keyring: {
        schema_version: keyring.schema_version,
        issuer: keyring.issuer,
        keyring_id: keyring.keyring_id,
        keyring_epoch: keyring.keyring_epoch,
        keys: keyring.keys.map((key) => ({
          algorithm: key.algorithm,
          key_id: key.key_id,
          not_before_ms: key.not_before_ms,
          not_after_ms: key.not_after_ms,
          public_key_spki_base64: key.public_key_spki_base64,
        })),
      },
      max_clock_rollback_milliseconds: config.limits.max_clock_rollback_milliseconds,
      max_envelope_lifetime_milliseconds: config.limits.max_envelope_lifetime_milliseconds,
      max_future_skew_milliseconds: config.limits.max_future_skew_milliseconds,
      now: () => Date.now(),
      replay_store: replayStore,
      session: {
        session_id: args.session_id,
        session_challenge_hash: args.session_challenge_hash,
      },
    };
    const plan = compileSupervisedEngineBridgeContract(request.bridge_input);
    let authenticated = null;
    const bridgeReceipt = verifySupervisedEngineBridgeContract(plan, request.bridge_input, request.envelope, {
      trustedIntakeVerifier: (envelope, context) => {
        assertSessionActive(args);
        authenticated = verifyHostPinnedAuthenticatedIntake(envelope, context, verifierConfig);
        return authenticated.bridge_verification;
      },
      trustedIntakeAuthority: keyring.authority,
    });
    if (authenticated === null) fail('P3.5 host adapter did not produce a verification receipt');
    const shadow = shadowConsumer.consumeVerifiedIntake(buildVerifiedIntakeCapsule({
      plan,
      authenticatedReceipt: authenticated.receipt,
      bridgeReceipt,
      installBindingHash: config.binding_hash,
    }));
    const output = {
      schema_version: HOST_SCHEMA_VERSION,
      status: 'verified_intake',
      owner_kernel_authority: 'none',
      acceptance: 'not_available',
      receipt: authenticated.receipt,
      bridge_receipt: bridgeReceipt,
      shadow,
    };
    process.stdout.write(`${canonicalJson(output)}\n`);
  } finally {
    shadowConsumer.close();
  }
}

try {
  execute();
} catch (error) {
  const detail = error && error.message ? error.message : String(error);
  process.stderr.write(`supervised-intake-verifier: ${detail}\n`);
  process.exitCode = 2;
}
