'use strict';

// P3.5a authenticates a signed owner-intake envelope for a host-owned P3.3
// adapter. It intentionally returns evidence only: it does not construct a
// Kernel, authorize an action, invoke an Engine sink, or accept a result.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const {
  ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
  TRUSTED_INTAKE_VERIFICATION_PATH,
  normalizeSupervisedEngineTrustedIntakeBinding,
} = require('./supervised-engine-bridge-contract');
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');

const AUTHENTICATED_INTAKE_SCHEMA_VERSION = 1;
const AUTHENTICATED_INTAKE_PURPOSE = 'autopilot-supervised-owner-intake/v1';
const AUTHENTICATED_INTAKE_AUDIENCE = 'autopilot-supervised-host';
const AUTHENTICATED_INTAKE_ALGORITHM = 'ed25519';
const MAX_CANONICAL_REQUEST_BYTES = 262144;
const MAX_SIGNED_PAYLOAD_BYTES = 65536;
const MAX_SIGNATURE_BYTES = 128;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_NODES = 4096;
const MAX_KEYRING_KEYS = 16;
const MAX_KEY_LIFETIME_MILLISECONDS = 366 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENVELOPE_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const DEFAULT_MAX_FUTURE_SKEW_MILLISECONDS = 1000;
const DEFAULT_MAX_CLOCK_ROLLBACK_MILLISECONDS = 0;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

class AuthenticatedIntakeError extends Error {
  constructor(message, code = 'AUTHENTICATED_INTAKE_INVALID') {
    super(message);
    this.name = 'AuthenticatedIntakeError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new AuthenticatedIntakeError(message, code);
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

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    fail(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireSafeInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a bounded integer`);
  }
  return value;
}

function requireBoundedBytes(value, label, maximum) {
  if (!Buffer.isBuffer(value) || value.length === 0 || value.length > maximum) {
    fail(`${label} must contain bounded bytes`);
  }
  return value;
}

function decodeBase64url(value, label, maximum) {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) {
    fail(`${label} must be canonical base64url`);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch (_error) {
    fail(`${label} must be canonical base64url`);
  }
  requireBoundedBytes(decoded, label, maximum);
  if (decoded.toString('base64url') !== value) {
    fail(`${label} must be canonical base64url`);
  }
  return decoded;
}

function assertJsonLimits(value, label, depth = 0, state = { nodes: 0 }) {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    fail(`${label} exceeds JSON shape limits`);
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertJsonLimits(item, label, depth + 1, state);
    return;
  }
  requirePlainObject(value, label);
  for (const key of Object.keys(value)) {
    assertJsonLimits(value[key], label, depth + 1, state);
  }
}

function parseCanonicalJsonBytes(bytes, label, maximum = MAX_CANONICAL_REQUEST_BYTES) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximum) {
    fail(`${label} must contain bounded UTF-8 JSON bytes`);
  }
  let text;
  let parsed;
  try {
    text = UTF8_DECODER.decode(bytes);
    parsed = JSON.parse(text);
  } catch (_error) {
    fail(`${label} must contain valid UTF-8 JSON`);
  }
  assertJsonLimits(parsed, label);
  let canonical;
  try {
    canonical = canonicalJson(parsed);
  } catch (error) {
    fail(`${label} is not canonical JSON: ${error.message}`);
  }
  if (canonical !== text) {
    fail(`${label} must use exact canonical JSON bytes`);
  }
  return parsed;
}

function signedMessage(payloadBytes) {
  return Buffer.concat([
    Buffer.from(`${AUTHENTICATED_INTAKE_PURPOSE}\n`, 'utf8'),
    payloadBytes,
  ]);
}

function normalizeKeyEntry(raw, issuer) {
  const value = requireExactKeys(raw, new Set([
    'algorithm',
    'key_id',
    'not_after_ms',
    'not_before_ms',
    'public_key_spki_base64',
  ]), 'authenticated intake keyring key');
  if (value.algorithm !== AUTHENTICATED_INTAKE_ALGORITHM) {
    fail('authenticated intake keyring key algorithm must be ed25519');
  }
  const keyId = requireToken(value.key_id, 'authenticated intake keyring key_id');
  const notBefore = requireSafeInteger(value.not_before_ms, 'authenticated intake key not_before_ms');
  const notAfter = requireSafeInteger(value.not_after_ms, 'authenticated intake key not_after_ms', 1);
  if (notAfter <= notBefore || notAfter - notBefore > MAX_KEY_LIFETIME_MILLISECONDS) {
    fail('authenticated intake key lifetime is invalid');
  }
  const publicKeyBytes = decodeBase64url(
    value.public_key_spki_base64,
    'authenticated intake public_key_spki_base64',
    4096,
  );
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({
      key: publicKeyBytes,
      format: 'der',
      type: 'spki',
    });
  } catch (_error) {
    fail('authenticated intake public key is invalid');
  }
  if (publicKey.asymmetricKeyType !== AUTHENTICATED_INTAKE_ALGORITHM) {
    fail('authenticated intake public key must be ed25519');
  }
  return {
    algorithm: AUTHENTICATED_INTAKE_ALGORITHM,
    issuer,
    key_id: keyId,
    not_before_ms: notBefore,
    not_after_ms: notAfter,
    public_key_spki_base64: value.public_key_spki_base64,
    public_key: publicKey,
  };
}

function normalizeAuthenticatedIntakeKeyring(raw) {
  const value = requireExactKeys(raw, new Set([
    'issuer',
    'keyring_epoch',
    'keyring_id',
    'keys',
    'schema_version',
  ]), 'authenticated intake keyring');
  if (value.schema_version !== AUTHENTICATED_INTAKE_SCHEMA_VERSION) {
    fail(`authenticated intake keyring schema_version must equal ${AUTHENTICATED_INTAKE_SCHEMA_VERSION}`);
  }
  const issuer = requireToken(value.issuer, 'authenticated intake keyring issuer');
  const keyringId = requireToken(value.keyring_id, 'authenticated intake keyring keyring_id');
  const epoch = requireSafeInteger(value.keyring_epoch, 'authenticated intake keyring epoch', 1);
  if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > MAX_KEYRING_KEYS) {
    fail('authenticated intake keyring keys must be a bounded non-empty array');
  }
  const seen = new Set();
  const keys = value.keys.map((entry) => {
    const normalized = normalizeKeyEntry(entry, issuer);
    if (seen.has(normalized.key_id)) fail('authenticated intake keyring contains duplicate key_id');
    seen.add(normalized.key_id);
    return normalized;
  });
  const material = {
    schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
    issuer,
    keyring_id: keyringId,
    keyring_epoch: epoch,
    keys: keys.map((key) => ({
      algorithm: key.algorithm,
      key_id: key.key_id,
      not_after_ms: key.not_after_ms,
      not_before_ms: key.not_before_ms,
      public_key_spki_base64: key.public_key_spki_base64,
    })),
  };
  const attestationHash = sha256(canonicalJson(material));
  return {
    ...material,
    attestation_hash: attestationHash,
    authority: Object.freeze({
      issuer,
      key_id: keyringId,
      attestation_hash: attestationHash,
    }),
    keys_by_id: new Map(keys.map((key) => [key.key_id, key])),
  };
}

function normalizeBridgeContext(raw) {
  const value = requireExactKeys(raw, new Set([
    'bridge_abi_hash',
    'engine_run_id',
    'intake_binding_hash',
    'invocation_id',
    'owner_run_id',
    'plan_hash',
    'schema_version',
    'sink_inventory_hash',
  ]), 'authenticated intake bridge context');
  if (value.schema_version !== ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION) {
    fail(`authenticated intake bridge context schema_version must equal ${ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION}`);
  }
  return {
    schema_version: ENGINE_BRIDGE_CONTRACT_SCHEMA_VERSION,
    intake_binding_hash: requireDigest(value.intake_binding_hash, 'authenticated intake bridge context intake_binding_hash'),
    sink_inventory_hash: requireDigest(value.sink_inventory_hash, 'authenticated intake bridge context sink_inventory_hash'),
    bridge_abi_hash: requireDigest(value.bridge_abi_hash, 'authenticated intake bridge context bridge_abi_hash'),
    plan_hash: requireDigest(value.plan_hash, 'authenticated intake bridge context plan_hash'),
    owner_run_id: requireToken(value.owner_run_id, 'authenticated intake bridge context owner_run_id'),
    engine_run_id: requireToken(value.engine_run_id, 'authenticated intake bridge context engine_run_id'),
    invocation_id: requireToken(value.invocation_id, 'authenticated intake bridge context invocation_id'),
  };
}

function normalizeClaims(raw) {
  const value = requireExactKeys(raw, new Set([
    'audience',
    'binding',
    'binding_hash',
    'expires_at_ms',
    'host_install_binding_hash',
    'issued_at_ms',
    'issuer',
    'jti',
    'keyring_epoch',
    'not_before_ms',
    'plan_hash',
    'purpose',
    'schema_version',
    'session_challenge_hash',
    'session_id',
    'signing_key_id',
  ]), 'authenticated intake protected claims');
  if (value.schema_version !== AUTHENTICATED_INTAKE_SCHEMA_VERSION) {
    fail(`authenticated intake protected claims schema_version must equal ${AUTHENTICATED_INTAKE_SCHEMA_VERSION}`);
  }
  if (value.purpose !== AUTHENTICATED_INTAKE_PURPOSE) {
    fail('authenticated intake protected claims purpose is invalid');
  }
  if (value.audience !== AUTHENTICATED_INTAKE_AUDIENCE) {
    fail('authenticated intake protected claims audience is invalid');
  }
  const issuedAt = requireSafeInteger(value.issued_at_ms, 'authenticated intake issued_at_ms');
  const notBefore = requireSafeInteger(value.not_before_ms, 'authenticated intake not_before_ms');
  const expiresAt = requireSafeInteger(value.expires_at_ms, 'authenticated intake expires_at_ms', 1);
  if (issuedAt > notBefore || notBefore >= expiresAt) {
    fail('authenticated intake protected claims time ordering is invalid');
  }
  let binding;
  try {
    binding = normalizeSupervisedEngineTrustedIntakeBinding(value.binding);
  } catch (error) {
    fail(`authenticated intake bridge binding is invalid: ${error.message}`);
  }
  const bindingHash = requireDigest(value.binding_hash, 'authenticated intake binding_hash');
  if (bindingHash !== sha256(canonicalJson(binding))) {
    fail('authenticated intake binding_hash does not match binding');
  }
  return {
    schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
    purpose: AUTHENTICATED_INTAKE_PURPOSE,
    audience: AUTHENTICATED_INTAKE_AUDIENCE,
    issuer: requireToken(value.issuer, 'authenticated intake issuer'),
    signing_key_id: requireToken(value.signing_key_id, 'authenticated intake signing_key_id'),
    keyring_epoch: requireSafeInteger(value.keyring_epoch, 'authenticated intake keyring_epoch', 1),
    jti: requireToken(value.jti, 'authenticated intake jti'),
    issued_at_ms: issuedAt,
    not_before_ms: notBefore,
    expires_at_ms: expiresAt,
    session_id: requireToken(value.session_id, 'authenticated intake session_id'),
    session_challenge_hash: requireDigest(value.session_challenge_hash, 'authenticated intake session_challenge_hash'),
    host_install_binding_hash: requireDigest(value.host_install_binding_hash, 'authenticated intake host_install_binding_hash'),
    binding,
    binding_hash: bindingHash,
    plan_hash: requireDigest(value.plan_hash, 'authenticated intake plan_hash'),
  };
}

function normalizeEnvelope(raw) {
  const value = requireExactKeys(raw, new Set([
    'protected_payload',
    'schema_version',
    'signature',
  ]), 'authenticated intake envelope');
  if (value.schema_version !== AUTHENTICATED_INTAKE_SCHEMA_VERSION) {
    fail(`authenticated intake envelope schema_version must equal ${AUTHENTICATED_INTAKE_SCHEMA_VERSION}`);
  }
  const protectedPayload = decodeBase64url(
    value.protected_payload,
    'authenticated intake protected_payload',
    MAX_SIGNED_PAYLOAD_BYTES,
  );
  const signature = decodeBase64url(
    value.signature,
    'authenticated intake signature',
    MAX_SIGNATURE_BYTES,
  );
  const claims = normalizeClaims(parseCanonicalJsonBytes(
    protectedPayload,
    'authenticated intake protected payload',
    MAX_SIGNED_PAYLOAD_BYTES,
  ));
  return {
    schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
    protected_payload: value.protected_payload,
    signature: value.signature,
    protected_payload_bytes: protectedPayload,
    signature_bytes: signature,
    claims,
    envelope_hash: sha256(canonicalJson({
      schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
      protected_payload: value.protected_payload,
      signature: value.signature,
    })),
  };
}

function normalizeSession(raw) {
  const value = requireExactKeys(raw, new Set([
    'session_challenge_hash',
    'session_id',
  ]), 'authenticated intake host session');
  return {
    session_id: requireToken(value.session_id, 'authenticated intake host session_id'),
    session_challenge_hash: requireDigest(value.session_challenge_hash, 'authenticated intake host session_challenge_hash'),
  };
}

function normalizeVerifierConfig(raw) {
  const value = requireExactKeys(raw, new Set([
    'install_binding_hash',
    'keyring',
    'max_clock_rollback_milliseconds',
    'max_envelope_lifetime_milliseconds',
    'max_future_skew_milliseconds',
    'now',
    'replay_store',
    'session',
  ]), 'authenticated intake verifier config');
  const now = typeof value.now === 'function' ? value.now : () => Date.now();
  if (!value.replay_store || typeof value.replay_store.consume !== 'function') {
    fail('authenticated intake verifier config replay_store must provide consume');
  }
  const maximumLifetime = requireSafeInteger(
    value.max_envelope_lifetime_milliseconds === undefined
      ? DEFAULT_MAX_ENVELOPE_LIFETIME_MILLISECONDS
      : value.max_envelope_lifetime_milliseconds,
    'authenticated intake max_envelope_lifetime_milliseconds',
    1,
    DEFAULT_MAX_ENVELOPE_LIFETIME_MILLISECONDS,
  );
  const maximumFutureSkew = requireSafeInteger(
    value.max_future_skew_milliseconds === undefined
      ? DEFAULT_MAX_FUTURE_SKEW_MILLISECONDS
      : value.max_future_skew_milliseconds,
    'authenticated intake max_future_skew_milliseconds',
    0,
    DEFAULT_MAX_FUTURE_SKEW_MILLISECONDS,
  );
  const maximumClockRollback = requireSafeInteger(
    value.max_clock_rollback_milliseconds === undefined
      ? DEFAULT_MAX_CLOCK_ROLLBACK_MILLISECONDS
      : value.max_clock_rollback_milliseconds,
    'authenticated intake max_clock_rollback_milliseconds',
    0,
    DEFAULT_MAX_CLOCK_ROLLBACK_MILLISECONDS,
  );
  return {
    install_binding_hash: requireDigest(value.install_binding_hash, 'authenticated intake install_binding_hash'),
    keyring: normalizeAuthenticatedIntakeKeyring(value.keyring),
    max_envelope_lifetime_milliseconds: maximumLifetime,
    max_future_skew_milliseconds: maximumFutureSkew,
    max_clock_rollback_milliseconds: maximumClockRollback,
    now,
    replay_store: value.replay_store,
    session: normalizeSession(value.session),
  };
}

function assertClaimsMatchHost(claims, context, config, now) {
  if (claims.issuer !== config.keyring.issuer
    || claims.keyring_epoch !== config.keyring.keyring_epoch) {
    fail('authenticated intake protected claims do not match the host keyring');
  }
  const key = config.keyring.keys_by_id.get(claims.signing_key_id);
  if (!key) fail('authenticated intake signing key is not in the host keyring');
  if (now < key.not_before_ms || now >= key.not_after_ms) {
    fail('authenticated intake signing key is not active at the host time');
  }
  if (claims.expires_at_ms - claims.issued_at_ms > config.max_envelope_lifetime_milliseconds) {
    fail('authenticated intake envelope lifetime exceeds the host limit');
  }
  if (claims.issued_at_ms > now + config.max_future_skew_milliseconds
    || claims.not_before_ms > now + config.max_future_skew_milliseconds) {
    fail('authenticated intake envelope is not active at the host time');
  }
  if (now >= claims.expires_at_ms) {
    fail('authenticated intake envelope has expired');
  }
  if (claims.session_id !== config.session.session_id
    || claims.session_challenge_hash !== config.session.session_challenge_hash) {
    fail('authenticated intake protected claims do not match the host session');
  }
  if (claims.host_install_binding_hash !== config.install_binding_hash) {
    fail('authenticated intake protected claims do not match the host installation');
  }
  if (claims.binding_hash !== context.intake_binding_hash
    || claims.plan_hash !== context.plan_hash
    || claims.binding.owner_run_id !== context.owner_run_id
    || claims.binding.engine_run_id !== context.engine_run_id
    || claims.binding.invocation_id !== context.invocation_id
    || claims.binding.sink_inventory_hash !== context.sink_inventory_hash
    || claims.binding.bridge_abi_hash !== context.bridge_abi_hash) {
    fail('authenticated intake protected claims do not match the compiled bridge plan');
  }
  return key;
}

function buildReplayFingerprint(claims, envelopeHash, keyring, installBindingHash) {
  return sha256(canonicalJson({
    schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
    issuer: claims.issuer,
    keyring_epoch: claims.keyring_epoch,
    jti: claims.jti,
    envelope_hash: envelopeHash,
    binding_hash: claims.binding_hash,
    plan_hash: claims.plan_hash,
    session_id: claims.session_id,
    session_challenge_hash: claims.session_challenge_hash,
    host_install_binding_hash: installBindingHash,
    keyring_attestation_hash: keyring.attestation_hash,
  }));
}

function buildShadowReceipt(claims, envelopeHash, keyring, installBindingHash, verifiedAt) {
  return {
    schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
    status: 'verified_intake',
    owner_kernel_authority: 'none',
    acceptance: 'not_available',
    verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
    issuer: keyring.authority.issuer,
    key_id: keyring.authority.key_id,
    attestation_hash: keyring.authority.attestation_hash,
    signing_key_id: claims.signing_key_id,
    keyring_epoch: keyring.keyring_epoch,
    envelope_hash: envelopeHash,
    binding_hash: claims.binding_hash,
    plan_hash: claims.plan_hash,
    install_binding_hash: installBindingHash,
    session_id: claims.session_id,
    session_challenge_hash: claims.session_challenge_hash,
    verified_at_ms: verifiedAt,
  };
}

function normalizeReplayInput(raw) {
  const value = requireExactKeys(raw, new Set([
    'fingerprint',
    'issuer',
    'jti',
    'max_clock_rollback_milliseconds',
    'receipt',
    'verified_at_ms',
  ]), 'authenticated intake replay input');
  return {
    issuer: requireToken(value.issuer, 'authenticated intake replay issuer'),
    jti: requireToken(value.jti, 'authenticated intake replay jti'),
    fingerprint: requireDigest(value.fingerprint, 'authenticated intake replay fingerprint'),
    receipt: cloneCanonical(requirePlainObject(value.receipt, 'authenticated intake replay receipt')),
    verified_at_ms: requireSafeInteger(value.verified_at_ms, 'authenticated intake replay verified_at_ms'),
    max_clock_rollback_milliseconds: requireSafeInteger(
      value.max_clock_rollback_milliseconds,
      'authenticated intake replay max_clock_rollback_milliseconds',
    ),
  };
}

function requireReplayResult(raw) {
  const value = requireExactKeys(raw, new Set(['receipt', 'status']), 'authenticated intake replay result');
  if (value.status !== 'new' && value.status !== 'idempotent') {
    fail('authenticated intake replay result has an invalid status');
  }
  return {
    status: value.status,
    receipt: cloneCanonical(requirePlainObject(value.receipt, 'authenticated intake replay result receipt')),
  };
}

function createInMemoryReplayStore() {
  const entries = new Map();
  let highWater = null;
  return Object.freeze({
    consume(raw) {
      const input = normalizeReplayInput(raw);
      if (highWater !== null
        && input.verified_at_ms + input.max_clock_rollback_milliseconds < highWater) {
        fail('authenticated intake host clock moved backwards beyond the durable high-water mark', 'AUTHENTICATED_INTAKE_CLOCK_ROLLBACK');
      }
      highWater = highWater === null ? input.verified_at_ms : Math.max(highWater, input.verified_at_ms);
      const key = `${input.issuer}\u0000${input.jti}`;
      const existing = entries.get(key);
      if (existing) {
        if (existing.state !== 'complete') {
          fail('authenticated intake replay claim is incomplete', 'AUTHENTICATED_INTAKE_REPLAY_PENDING');
        }
        if (existing.fingerprint !== input.fingerprint) {
          fail('authenticated intake replay claim conflicts with an existing jti', 'AUTHENTICATED_INTAKE_REPLAY_CONFLICT');
        }
        return { status: 'idempotent', receipt: cloneCanonical(existing.receipt) };
      }
      entries.set(key, {
        state: 'complete',
        fingerprint: input.fingerprint,
        receipt: cloneCanonical(input.receipt),
      });
      return { status: 'new', receipt: cloneCanonical(input.receipt) };
    },
    getHighWater() {
      return highWater;
    },
  });
}

function requirePrivateDirectory(directory, label) {
  let info;
  try {
    info = fs.lstatSync(directory);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o022) !== 0) {
    fail(`${label} must be a private non-symlink directory`);
  }
  return directory;
}

function readCanonicalStateFile(filename, label) {
  let info;
  let bytes;
  try {
    info = fs.lstatSync(filename);
    if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o022) !== 0) {
      fail(`${label} must be a private regular file`);
    }
    bytes = fs.readFileSync(filename);
  } catch (error) {
    if (error instanceof AuthenticatedIntakeError) throw error;
    fail(`${label} cannot be read: ${error.message}`);
  }
  return parseCanonicalJsonBytes(bytes, label, 65536);
}

function writeAll(descriptor, content) {
  let offset = 0;
  while (offset < content.length) {
    const written = fs.writeSync(descriptor, content, offset, content.length - offset);
    if (written <= 0) fail('authenticated intake durable state write was short');
    offset += written;
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail(`authenticated intake state directory cannot be synced: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeDurableReplacement(filename, value) {
  const directory = path.dirname(filename);
  const temporary = path.join(directory, `.${path.basename(filename)}.pending-${crypto.randomBytes(16).toString('hex')}`);
  const content = Buffer.from(canonicalJson(value), 'utf8');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    writeAll(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
    fsyncDirectory(directory);
  } catch (error) {
    if (error instanceof AuthenticatedIntakeError) throw error;
    fail(`authenticated intake durable state cannot be published: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') fail(`authenticated intake temporary state cleanup failed: ${error.message}`);
    }
  }
}

function writeExclusiveDurableState(filename, value) {
  const content = Buffer.from(canonicalJson(value), 'utf8');
  let descriptor;
  try {
    descriptor = fs.openSync(filename, 'wx', 0o600);
    writeAll(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fsyncDirectory(path.dirname(filename));
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    if (error instanceof AuthenticatedIntakeError) throw error;
    fail(`authenticated intake replay claim cannot be written: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function normalizeStoredReplayState(raw) {
  const value = requireExactKeys(raw, new Set([
    'fingerprint',
    'receipt',
    'schema_version',
    'state',
  ]), 'authenticated intake replay state');
  if (value.schema_version !== AUTHENTICATED_INTAKE_SCHEMA_VERSION) {
    fail('authenticated intake replay state schema_version is unsupported');
  }
  if (value.state !== 'pending' && value.state !== 'complete') {
    fail('authenticated intake replay state is invalid');
  }
  return {
    state: value.state,
    fingerprint: requireDigest(value.fingerprint, 'authenticated intake replay state fingerprint'),
    receipt: value.receipt === null ? null : cloneCanonical(requirePlainObject(value.receipt, 'authenticated intake replay state receipt')),
  };
}

function normalizeClockState(raw) {
  const value = requireExactKeys(raw, new Set([
    'high_water_ms',
    'schema_version',
  ]), 'authenticated intake clock state');
  if (value.schema_version !== AUTHENTICATED_INTAKE_SCHEMA_VERSION) {
    fail('authenticated intake clock state schema_version is unsupported');
  }
  return requireSafeInteger(value.high_water_ms, 'authenticated intake clock high_water_ms');
}

function createFileReplayStore(options) {
  const value = requireExactKeys(options, new Set(['state_directory']), 'authenticated intake file replay store options');
  const stateDirectory = value.state_directory;
  if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory)) {
    fail('authenticated intake state_directory must be absolute');
  }
  requirePrivateDirectory(stateDirectory, 'authenticated intake state_directory');
  const replayDirectory = path.join(stateDirectory, 'replay');
  requirePrivateDirectory(replayDirectory, 'authenticated intake replay directory');
  const clockPath = path.join(stateDirectory, 'clock.json');
  return Object.freeze({
    consume(raw) {
      const input = normalizeReplayInput(raw);
      let highWater = null;
      if (fs.existsSync(clockPath)) highWater = normalizeClockState(readCanonicalStateFile(clockPath, 'authenticated intake clock state'));
      if (highWater !== null
        && input.verified_at_ms + input.max_clock_rollback_milliseconds < highWater) {
        fail('authenticated intake host clock moved backwards beyond the durable high-water mark', 'AUTHENTICATED_INTAKE_CLOCK_ROLLBACK');
      }
      const replayFilename = path.join(replayDirectory, `${sha256(`${input.issuer}\u0000${input.jti}`)}.json`);
      const nextHighWater = highWater === null ? input.verified_at_ms : Math.max(highWater, input.verified_at_ms);
      const publishHighWater = () => {
        if (highWater !== nextHighWater) {
          writeDurableReplacement(clockPath, {
            schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
            high_water_ms: nextHighWater,
          });
        }
      };
      const pending = {
        schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
        state: 'pending',
        fingerprint: input.fingerprint,
        receipt: null,
      };
      if (!writeExclusiveDurableState(replayFilename, pending)) {
        const existing = normalizeStoredReplayState(readCanonicalStateFile(replayFilename, 'authenticated intake replay state'));
        if (existing.state !== 'complete' || existing.receipt === null) {
          fail('authenticated intake replay claim is incomplete', 'AUTHENTICATED_INTAKE_REPLAY_PENDING');
        }
        if (existing.fingerprint !== input.fingerprint) {
          fail('authenticated intake replay claim conflicts with an existing jti', 'AUTHENTICATED_INTAKE_REPLAY_CONFLICT');
        }
        publishHighWater();
        return { status: 'idempotent', receipt: cloneCanonical(existing.receipt) };
      }
      publishHighWater();
      writeDurableReplacement(replayFilename, {
        schema_version: AUTHENTICATED_INTAKE_SCHEMA_VERSION,
        state: 'complete',
        fingerprint: input.fingerprint,
        receipt: input.receipt,
      });
      return { status: 'new', receipt: cloneCanonical(input.receipt) };
    },
  });
}

function verifyHostPinnedAuthenticatedIntake(envelopeRaw, contextRaw, configRaw) {
  const config = normalizeVerifierConfig(configRaw);
  const context = normalizeBridgeContext(contextRaw);
  const envelope = normalizeEnvelope(envelopeRaw);
  const now = requireSafeInteger(config.now(), 'authenticated intake host clock');
  const key = assertClaimsMatchHost(envelope.claims, context, config, now);
  if (!crypto.verify(
    null,
    signedMessage(envelope.protected_payload_bytes),
    key.public_key,
    envelope.signature_bytes,
  )) {
    fail('authenticated intake signature verification failed', 'AUTHENTICATED_INTAKE_SIGNATURE_INVALID');
  }
  const shadowReceipt = buildShadowReceipt(
    envelope.claims,
    envelope.envelope_hash,
    config.keyring,
    config.install_binding_hash,
    now,
  );
  const replay = requireReplayResult(config.replay_store.consume({
    issuer: envelope.claims.issuer,
    jti: envelope.claims.jti,
    fingerprint: buildReplayFingerprint(
      envelope.claims,
      envelope.envelope_hash,
      config.keyring,
      config.install_binding_hash,
    ),
    receipt: shadowReceipt,
    verified_at_ms: now,
    max_clock_rollback_milliseconds: config.max_clock_rollback_milliseconds,
  }));
  const receipt = {
    ...replay.receipt,
    replay_status: replay.status,
  };
  return cloneCanonical({
    bridge_verification: {
      ok: true,
      verification_path: TRUSTED_INTAKE_VERIFICATION_PATH,
      issuer: config.keyring.authority.issuer,
      key_id: config.keyring.authority.key_id,
      attestation_hash: config.keyring.authority.attestation_hash,
      envelope_hash: envelope.envelope_hash,
      binding: envelope.claims.binding,
      binding_hash: envelope.claims.binding_hash,
      plan_hash: envelope.claims.plan_hash,
    },
    receipt,
  });
}

function createHostPinnedTrustedIntakeVerifier(config) {
  return (envelope, context) => verifyHostPinnedAuthenticatedIntake(
    envelope,
    context,
    config,
  ).bridge_verification;
}

module.exports = {
  AUTHENTICATED_INTAKE_ALGORITHM,
  AUTHENTICATED_INTAKE_AUDIENCE,
  AUTHENTICATED_INTAKE_PURPOSE,
  AUTHENTICATED_INTAKE_SCHEMA_VERSION,
  AuthenticatedIntakeError,
  MAX_CANONICAL_REQUEST_BYTES,
  createFileReplayStore,
  createHostPinnedTrustedIntakeVerifier,
  createInMemoryReplayStore,
  normalizeAuthenticatedIntakeKeyring,
  parseCanonicalJsonBytes,
  verifyHostPinnedAuthenticatedIntake,
};
