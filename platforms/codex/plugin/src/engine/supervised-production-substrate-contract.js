'use strict';

// P3.6 A0 freezes the authority boundary that a future supervised host may
// use. It is intentionally effect-disabled: this module does not execute an
// action or accept a result. The trusted P3.5d verification adapter and IPC
// proof verifier are owned by the later root-installed host.

const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
const {
  ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION,
  normalizeSupervisedEngineTrustedIntakeBinding,
} = require('./supervised-engine-bridge-contract');

const SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION = 1;
const SUPERVISED_PRODUCTION_SUBSTRATE_KIND = 'p36_effect_disabled_substrate';
const SUPERVISED_PRODUCTION_SUBSTRATE_STATUS = 'effects_disabled';
const SUPERVISED_SERVICE_IPC_PROTOCOL_VERSION = 1;
const INTAKE_PROTOCOL_VERSION = 2;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_UNIX_ID = 2147483647;
const MAX_INTAKE_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const MAX_SERVICE_MESSAGE_LIFETIME_MILLISECONDS = 60 * 1000;
const MAX_FUTURE_SKEW_MILLISECONDS = 1000;
const MAX_WITNESS_BATCH_EVENTS = 64;
const MAX_WITNESS_READBACK_LIMIT = 1024;
const SERVICE_ROLES = Object.freeze([
  'worker',
  'broker',
  'receipt_verifier',
  'witness',
  'coordinator',
]);
const WITNESS_OPERATIONS = Object.freeze([
  'appendIfHead',
  'appendBatchIfHead',
  'getHead',
  'readback',
]);
const COORDINATOR_OPERATIONS = Object.freeze([
  'prepare',
  'cancel',
  'resolve',
]);
const BROKER_OPERATIONS = Object.freeze([
  'mint_permit',
  'postclaim_authorize',
  'execute',
  'revoke',
]);
const SERVICE_BINDING_FIELDS = Object.freeze([
  'role',
  'identity',
  'uid',
  'gid',
  'attestation_hash',
  'cgroup_binding_hash',
]);
const VERIFIED_P35D_INTAKE_FIELDS = Object.freeze([
  'schema_version',
  'verified',
  'intake_protocol_version',
  'replay_status',
  'session_id',
  'session_challenge_hash',
  'install_binding_hash',
  'issuer',
  'key_id',
  'attestation_hash',
  'envelope_hash',
  'replay_fingerprint',
  'issued_at_ms',
  'not_before_ms',
  'expires_at_ms',
  'trusted_intake_binding',
  'bridge_plan_hash',
  'bridge_receipt_hash',
  'authenticated_receipt_hash',
]);
const SERVICE_IPC_ENVELOPE_FIELDS = Object.freeze([
  'schema_version',
  'protocol_version',
  'request_id',
  'operation',
  'sender_role',
  'sender_identity',
  'sender_attestation_hash',
  'sender_cgroup_binding_hash',
  'recipient_role',
  'recipient_identity',
  'recipient_attestation_hash',
  'recipient_cgroup_binding_hash',
  'issued_at_ms',
  'expires_at_ms',
  'nonce_hash',
  'authentication_proof_hash',
  'substrate_plan_hash',
  'payload_hash',
]);
const WITNESS_REQUEST_FIELDS = Object.freeze({
  appendIfHead: Object.freeze([
    'schema_version', 'request_id', 'operation', 'stream_id', 'expected_head',
    'event_hash', 'event_payload_hash', 'substrate_plan_hash',
  ]),
  appendBatchIfHead: Object.freeze([
    'schema_version', 'request_id', 'operation', 'stream_id', 'expected_head',
    'events', 'substrate_plan_hash',
  ]),
  getHead: Object.freeze([
    'schema_version', 'request_id', 'operation', 'stream_id', 'substrate_plan_hash',
  ]),
  readback: Object.freeze([
    'schema_version', 'request_id', 'operation', 'stream_id', 'from_sequence',
    'limit', 'substrate_plan_hash',
  ]),
});
const WITNESS_EVENT_FIELDS = Object.freeze(['event_hash', 'event_payload_hash']);
const COORDINATOR_REQUEST_FIELDS = Object.freeze([
  'schema_version',
  'request_id',
  'operation',
  'transaction_id',
  'fence',
  'expected_witness_head',
  'substrate_plan_hash',
]);
const DISABLED_REQUEST_FIELDS = Object.freeze([
  'schema_version',
  'request_id',
  'operation',
  'substrate_plan_hash',
]);
const DISABLED_RESULT_FIELDS = Object.freeze([
  'schema_version', 'kind', 'status', 'code', 'request_id', 'operation',
  'substrate_plan_hash', 'request_hash', 'request_envelope_hash', 'responder_role',
  'responder_identity', 'responder_attestation_hash', 'responder_cgroup_binding_hash',
  'owner_kernel_authority', 'effect_authority', 'broker_authority', 'acceptance', 'result_hash',
]);
const DISABLED_RESULT_CORRELATION = Object.freeze({
  expected_context_fields: Object.freeze(['request', 'envelope', 'now']),
  request_id: 'expected_request.request_id',
  operation: 'expected_request.operation',
  request_hash: 'sha256(canonical_json(expected_request))',
  request_envelope_hash: 'sha256(canonical_json(expected_envelope))',
  result_hash: 'sha256(canonical_json(result_without_result_hash))',
});
const SERVICE_ROUTES = Object.freeze({
  witness_append: Object.freeze({ sender_role: 'receipt_verifier', recipient_role: 'witness' }),
  witness_read: Object.freeze({ sender_role: 'coordinator', recipient_role: 'witness' }),
  coordinator: Object.freeze({ sender_role: 'receipt_verifier', recipient_role: 'coordinator' }),
  broker: Object.freeze({ sender_role: 'worker', recipient_role: 'broker' }),
});
const OPERATION_ROUTES = Object.freeze({
  appendIfHead: SERVICE_ROUTES.witness_append,
  appendBatchIfHead: SERVICE_ROUTES.witness_append,
  getHead: SERVICE_ROUTES.witness_read,
  readback: SERVICE_ROUTES.witness_read,
  prepare: SERVICE_ROUTES.coordinator,
  cancel: SERVICE_ROUTES.coordinator,
  resolve: SERVICE_ROUTES.coordinator,
  mint_permit: SERVICE_ROUTES.broker,
  postclaim_authorize: SERVICE_ROUTES.broker,
  execute: SERVICE_ROUTES.broker,
  revoke: SERVICE_ROUTES.broker,
});
const DISABLED_SERVICE_SPECS = Object.freeze({
  broker: Object.freeze({
    allowed_operations: BROKER_OPERATIONS,
    route: SERVICE_ROUTES.broker,
    responder_role: 'broker',
    kind: 'p36_disabled_broker_result',
    code: 'BROKER_EFFECTS_DISABLED',
  }),
  coordinator: Object.freeze({
    allowed_operations: COORDINATOR_OPERATIONS,
    route: SERVICE_ROUTES.coordinator,
    responder_role: 'coordinator',
    kind: 'p36_disabled_coordinator_result',
    code: 'COORDINATOR_ACCEPTANCE_DISABLED',
  }),
});

function substrateError(message, code = 'INVALID_SUPERVISED_PRODUCTION_SUBSTRATE') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    substrateError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    substrateError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    substrateError(`${label} has an unexpected key set`);
  }
  return value;
}

function assertOnlyKeys(value, keys, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) substrateError(`${label} has an unsupported key ${key}`);
  }
  return value;
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    substrateError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    substrateError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireNullableSha256(value, label) {
  if (value === null) return null;
  return requireSha256(value, label);
}

function requireGitSha(value, label) {
  if (typeof value !== 'string' || !GIT_SHA_PATTERN.test(value)) {
    substrateError(`${label} must be a lowercase 40-character Git SHA`);
  }
  return value;
}

function requireNonRootUnixId(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_UNIX_ID) {
    substrateError(`${label} must be a non-root Linux UID/GID`);
  }
  return value;
}

function requireEpochMilliseconds(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    substrateError(`${label} must be a non-negative integer epoch in milliseconds`);
  }
  return value;
}

function normalizeTrustedIntakeBinding(raw) {
  let normalized;
  try {
    normalized = normalizeSupervisedEngineTrustedIntakeBinding(raw);
  } catch (error) {
    substrateError(`P3.5d trusted intake binding is invalid: ${error.message || String(error)}`);
  }
  if (normalized.schema_version !== ENGINE_BRIDGE_CONTRACT_V2_SCHEMA_VERSION) {
    substrateError('P3.6 requires the explicit P3.5d trusted intake v2 binding', 'SUBSTRATE_V2_INTAKE_REQUIRED');
  }
  return cloneCanonical(normalized);
}

function normalizeServiceBinding(role, raw) {
  const value = assertExactKeys(raw, new Set(SERVICE_BINDING_FIELDS), `P3.6 ${role} service binding`);
  if (value.role !== role) {
    substrateError(`P3.6 ${role} service binding role must equal ${role}`);
  }
  return {
    role,
    identity: requireToken(value.identity, `P3.6 ${role} service identity`),
    uid: requireNonRootUnixId(value.uid, `P3.6 ${role} service uid`),
    gid: requireNonRootUnixId(value.gid, `P3.6 ${role} service gid`),
    attestation_hash: requireSha256(value.attestation_hash, `P3.6 ${role} service attestation_hash`),
    cgroup_binding_hash: requireSha256(value.cgroup_binding_hash, `P3.6 ${role} service cgroup_binding_hash`),
  };
}

function normalizeServiceBindings(raw) {
  const value = assertExactKeys(raw, new Set(SERVICE_ROLES), 'P3.6 service bindings');
  const normalized = {};
  const identities = new Map();
  const attestations = new Map();
  const uids = new Map();
  const gids = new Map();
  const cgroups = new Map();
  for (const role of SERVICE_ROLES) {
    const service = normalizeServiceBinding(role, value[role]);
    const fields = [
      ['identity', identities, service.identity],
      ['attestation_hash', attestations, service.attestation_hash],
      ['uid', uids, service.uid],
      ['gid', gids, service.gid],
      ['cgroup_binding_hash', cgroups, service.cgroup_binding_hash],
    ];
    for (const [field, registry, fieldValue] of fields) {
      if (registry.has(fieldValue)) {
        substrateError(
          `P3.6 ${role} service ${field} duplicates ${registry.get(fieldValue)}; service roles must remain independent`,
          'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED',
        );
      }
      registry.set(fieldValue, role);
    }
    normalized[role] = service;
  }
  return cloneCanonical(normalized);
}

function normalizeTrustedIntakeAuthority(raw) {
  const value = assertExactKeys(raw, new Set([
    'issuer',
    'key_id',
    'attestation_hash',
    'install_binding_hash',
  ]), 'P3.6 trusted intake authority');
  return {
    issuer: requireToken(value.issuer, 'P3.6 trusted intake authority issuer'),
    key_id: requireToken(value.key_id, 'P3.6 trusted intake authority key_id'),
    attestation_hash: requireSha256(value.attestation_hash, 'P3.6 trusted intake authority attestation_hash'),
    install_binding_hash: requireSha256(
      value.install_binding_hash,
      'P3.6 trusted intake authority install_binding_hash',
    ),
  };
}

function normalizeVerifiedP35dIntake(raw, authority, now) {
  const value = assertExactKeys(raw, new Set(VERIFIED_P35D_INTAKE_FIELDS), 'P3.6 verified P3.5d intake');
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION
    || value.verified !== true
    || value.intake_protocol_version !== INTAKE_PROTOCOL_VERSION
    || value.replay_status !== 'fresh') {
    substrateError('P3.6 requires a fresh verified P3.5d v2 intake', 'SUBSTRATE_VERIFIED_INTAKE_REQUIRED');
  }
  const issuedAt = requireEpochMilliseconds(value.issued_at_ms, 'P3.6 verified intake issued_at_ms');
  const notBefore = requireEpochMilliseconds(value.not_before_ms, 'P3.6 verified intake not_before_ms');
  const expiresAt = requireEpochMilliseconds(value.expires_at_ms, 'P3.6 verified intake expires_at_ms');
  if (notBefore < issuedAt || notBefore >= expiresAt
    || expiresAt - issuedAt > MAX_INTAKE_LIFETIME_MILLISECONDS) {
    substrateError('P3.6 verified intake has an invalid activation window', 'SUBSTRATE_INTAKE_INVALID_WINDOW');
  }
  if (notBefore > now) {
    substrateError('P3.6 verified intake is not active yet', 'SUBSTRATE_INTAKE_NOT_ACTIVE');
  }
  if (expiresAt <= now) {
    substrateError('P3.6 verified intake is expired', 'SUBSTRATE_INTAKE_EXPIRED');
  }
  if (value.issuer !== authority.issuer
    || value.key_id !== authority.key_id
    || value.attestation_hash !== authority.attestation_hash
    || value.install_binding_hash !== authority.install_binding_hash) {
    substrateError('P3.6 verified intake does not match the root-pinned P3.5d authority');
  }
  return {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    verified: true,
    intake_protocol_version: INTAKE_PROTOCOL_VERSION,
    replay_status: 'fresh',
    session_id: requireToken(value.session_id, 'P3.6 verified intake session_id'),
    session_challenge_hash: requireSha256(value.session_challenge_hash, 'P3.6 verified intake session_challenge_hash'),
    install_binding_hash: authority.install_binding_hash,
    issuer: authority.issuer,
    key_id: authority.key_id,
    attestation_hash: authority.attestation_hash,
    envelope_hash: requireSha256(value.envelope_hash, 'P3.6 verified intake envelope_hash'),
    replay_fingerprint: requireSha256(value.replay_fingerprint, 'P3.6 verified intake replay_fingerprint'),
    issued_at_ms: issuedAt,
    not_before_ms: notBefore,
    expires_at_ms: expiresAt,
    trusted_intake_binding: normalizeTrustedIntakeBinding(value.trusted_intake_binding),
    bridge_plan_hash: requireSha256(value.bridge_plan_hash, 'P3.6 verified intake bridge_plan_hash'),
    bridge_receipt_hash: requireSha256(value.bridge_receipt_hash, 'P3.6 verified intake bridge_receipt_hash'),
    authenticated_receipt_hash: requireSha256(
      value.authenticated_receipt_hash,
      'P3.6 verified intake authenticated_receipt_hash',
    ),
  };
}

function normalizeVerificationOptions(raw) {
  // Treat omitted options as an empty host adapter configuration so callers get
  // the security-relevant verifier error rather than an incidental type error.
  const value = assertOnlyKeys(raw === undefined ? {} : raw, new Set([
    'trustedIntakeVerifier',
    'trustedIntakeAuthority',
    'now',
  ]), 'P3.6 verification options');
  if (typeof value.trustedIntakeVerifier !== 'function') {
    substrateError('P3.6 requires a root-owned trustedIntakeVerifier adapter', 'SUBSTRATE_VERIFIED_INTAKE_REQUIRED');
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'trustedIntakeAuthority')) {
    substrateError('P3.6 requires a root-pinned trustedIntakeAuthority');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'now') && typeof value.now !== 'function') {
    substrateError('P3.6 verification options.now must be a function');
  }
  return {
    trustedIntakeVerifier: value.trustedIntakeVerifier,
    trustedIntakeAuthority: normalizeTrustedIntakeAuthority(value.trustedIntakeAuthority),
    now: value.now || (() => Date.now()),
  };
}

function normalizeInput(raw) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'trusted_intake_envelope',
    'service_bindings',
  ]), 'P3.6 production substrate input');
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION) {
    substrateError('P3.6 production substrate input.schema_version is unsupported');
  }
  return {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    trusted_intake_envelope: assertPlainObject(value.trusted_intake_envelope, 'P3.6 trusted intake envelope'),
    service_bindings: normalizeServiceBindings(value.service_bindings),
  };
}

function normalizeVerifiedInput(raw, options) {
  const input = normalizeInput(raw);
  const verifiedOptions = normalizeVerificationOptions(options);
  const now = requireEpochMilliseconds(verifiedOptions.now(), 'P3.6 verification clock');
  let verified;
  try {
    verified = verifiedOptions.trustedIntakeVerifier(input.trusted_intake_envelope, {
      expected_intake_protocol_version: INTAKE_PROTOCOL_VERSION,
      expected_substrate_abi_hash: getSupervisedProductionSubstrateAbiHash(),
    });
  } catch (error) {
    substrateError(`P3.6 trusted intake verifier failed: ${error.message || String(error)}`);
  }
  return {
    ...input,
    verified_intake: normalizeVerifiedP35dIntake(
      verified,
      verifiedOptions.trustedIntakeAuthority,
      now,
    ),
  };
}

function getSupervisedProductionSubstrateWireContract() {
  return {
    service_binding_fields: SERVICE_BINDING_FIELDS,
    verified_p35d_intake_fields: VERIFIED_P35D_INTAKE_FIELDS,
    intake_activation: {
      ordering: 'issued_at_ms <= not_before_ms < expires_at_ms',
      max_lifetime_milliseconds: MAX_INTAKE_LIFETIME_MILLISECONDS,
      require_active_at_use: true,
    },
    service_ipc: {
      envelope_fields: SERVICE_IPC_ENVELOPE_FIELDS,
      max_message_lifetime_milliseconds: MAX_SERVICE_MESSAGE_LIFETIME_MILLISECONDS,
      max_future_skew_milliseconds: MAX_FUTURE_SKEW_MILLISECONDS,
      require_frame_inside_intake_window: true,
      routes: SERVICE_ROUTES,
      operation_routes: OPERATION_ROUTES,
    },
    witness: {
      request_fields: WITNESS_REQUEST_FIELDS,
      event_fields: WITNESS_EVENT_FIELDS,
      max_batch_events: MAX_WITNESS_BATCH_EVENTS,
      max_readback_limit: MAX_WITNESS_READBACK_LIMIT,
      append_route: SERVICE_ROUTES.witness_append,
      read_route: SERVICE_ROUTES.witness_read,
    },
    coordinator: {
      request_fields: COORDINATOR_REQUEST_FIELDS,
      min_fence: 1,
      route: SERVICE_ROUTES.coordinator,
    },
    disabled_results: {
      request_fields: DISABLED_REQUEST_FIELDS,
      result_fields: DISABLED_RESULT_FIELDS,
      correlation: DISABLED_RESULT_CORRELATION,
      broker: DISABLED_SERVICE_SPECS.broker,
      coordinator: DISABLED_SERVICE_SPECS.coordinator,
    },
  };
}

function getSupervisedProductionSubstrateAbi() {
  return cloneCanonical({
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    kind: SUPERVISED_PRODUCTION_SUBSTRATE_KIND,
    intake_protocol_version: INTAKE_PROTOCOL_VERSION,
    service_ipc_protocol_version: SUPERVISED_SERVICE_IPC_PROTOCOL_VERSION,
    service_roles: SERVICE_ROLES,
    witness_operations: WITNESS_OPERATIONS,
    coordinator_operations: COORDINATOR_OPERATIONS,
    broker_operations: BROKER_OPERATIONS,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
    wire_contract: getSupervisedProductionSubstrateWireContract(),
  });
}

function getSupervisedProductionSubstrateAbiHash() {
  return sha256(canonicalJson(getSupervisedProductionSubstrateAbi()));
}

function intakeContextFor(input) {
  const verified = input.verified_intake;
  const binding = verified.trusted_intake_binding;
  return {
    trusted_intake_binding: binding,
    intake_binding_hash: sha256(canonicalJson(binding)),
    bridge_plan_hash: verified.bridge_plan_hash,
    bridge_receipt_hash: verified.bridge_receipt_hash,
    authenticated_receipt_hash: verified.authenticated_receipt_hash,
    install_binding_hash: verified.install_binding_hash,
    session_id: verified.session_id,
    session_challenge_hash: verified.session_challenge_hash,
    issuer: verified.issuer,
    key_id: verified.key_id,
    attestation_hash: verified.attestation_hash,
    envelope_hash: verified.envelope_hash,
    replay_fingerprint: verified.replay_fingerprint,
    issued_at_ms: verified.issued_at_ms,
    not_before_ms: verified.not_before_ms,
    expires_at_ms: verified.expires_at_ms,
  };
}

function compileNormalizedInput(input) {
  const unsigned = {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    kind: SUPERVISED_PRODUCTION_SUBSTRATE_KIND,
    status: SUPERVISED_PRODUCTION_SUBSTRATE_STATUS,
    intake_protocol_version: INTAKE_PROTOCOL_VERSION,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
    intake: intakeContextFor(input),
    service_bindings: input.service_bindings,
    service_binding_hash: sha256(canonicalJson(input.service_bindings)),
    substrate_abi_hash: getSupervisedProductionSubstrateAbiHash(),
    witness_operations: WITNESS_OPERATIONS,
    coordinator_operations: COORDINATOR_OPERATIONS,
    broker_operations: BROKER_OPERATIONS,
  };
  return cloneCanonical({
    ...unsigned,
    substrate_plan_hash: sha256(canonicalJson(unsigned)),
  });
}

function compileSupervisedProductionSubstrateContract(raw, options) {
  return compileNormalizedInput(normalizeVerifiedInput(raw, options));
}

function normalizeIntakeContext(raw) {
  const value = assertExactKeys(raw, new Set([
    'trusted_intake_binding',
    'intake_binding_hash',
    'bridge_plan_hash',
    'bridge_receipt_hash',
    'authenticated_receipt_hash',
    'install_binding_hash',
    'session_id',
    'session_challenge_hash',
    'issuer',
    'key_id',
    'attestation_hash',
    'envelope_hash',
    'replay_fingerprint',
    'issued_at_ms',
    'not_before_ms',
    'expires_at_ms',
  ]), 'P3.6 compiled substrate intake');
  const trusted = normalizeTrustedIntakeBinding(value.trusted_intake_binding);
  const intakeBindingHash = requireSha256(value.intake_binding_hash, 'P3.6 compiled intake_binding_hash');
  if (intakeBindingHash !== sha256(canonicalJson(trusted))) {
    substrateError('P3.6 compiled intake_binding_hash does not match trusted intake binding');
  }
  const issuedAt = requireEpochMilliseconds(value.issued_at_ms, 'P3.6 compiled intake issued_at_ms');
  const notBefore = requireEpochMilliseconds(value.not_before_ms, 'P3.6 compiled intake not_before_ms');
  const expiresAt = requireEpochMilliseconds(value.expires_at_ms, 'P3.6 compiled intake expires_at_ms');
  if (notBefore < issuedAt || notBefore >= expiresAt
    || expiresAt - issuedAt > MAX_INTAKE_LIFETIME_MILLISECONDS) {
    substrateError('P3.6 compiled intake has an invalid clock window');
  }
  return {
    trusted_intake_binding: trusted,
    intake_binding_hash: intakeBindingHash,
    bridge_plan_hash: requireSha256(value.bridge_plan_hash, 'P3.6 compiled bridge_plan_hash'),
    bridge_receipt_hash: requireSha256(value.bridge_receipt_hash, 'P3.6 compiled bridge_receipt_hash'),
    authenticated_receipt_hash: requireSha256(
      value.authenticated_receipt_hash,
      'P3.6 compiled authenticated_receipt_hash',
    ),
    install_binding_hash: requireSha256(value.install_binding_hash, 'P3.6 compiled install_binding_hash'),
    session_id: requireToken(value.session_id, 'P3.6 compiled session_id'),
    session_challenge_hash: requireSha256(value.session_challenge_hash, 'P3.6 compiled session_challenge_hash'),
    issuer: requireToken(value.issuer, 'P3.6 compiled issuer'),
    key_id: requireToken(value.key_id, 'P3.6 compiled key_id'),
    attestation_hash: requireSha256(value.attestation_hash, 'P3.6 compiled attestation_hash'),
    envelope_hash: requireSha256(value.envelope_hash, 'P3.6 compiled envelope_hash'),
    replay_fingerprint: requireSha256(value.replay_fingerprint, 'P3.6 compiled replay_fingerprint'),
    issued_at_ms: issuedAt,
    not_before_ms: notBefore,
    expires_at_ms: expiresAt,
  };
}

function requireExactStaticArray(value, expected, label) {
  if (!Array.isArray(value) || canonicalJson(value) !== canonicalJson(expected)) {
    substrateError(`${label} does not match the frozen P3.6 ABI`);
  }
  return cloneCanonical(value);
}

function normalizeCompiledPlan(raw) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'status',
    'intake_protocol_version',
    'owner_kernel_authority',
    'effect_authority',
    'broker_authority',
    'acceptance',
    'intake',
    'service_bindings',
    'service_binding_hash',
    'substrate_abi_hash',
    'witness_operations',
    'coordinator_operations',
    'broker_operations',
    'substrate_plan_hash',
  ]), 'P3.6 compiled substrate plan');
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION
    || value.kind !== SUPERVISED_PRODUCTION_SUBSTRATE_KIND
    || value.status !== SUPERVISED_PRODUCTION_SUBSTRATE_STATUS
    || value.intake_protocol_version !== INTAKE_PROTOCOL_VERSION
    || value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available') {
    substrateError('P3.6 compiled substrate plan has an invalid authority disclosure');
  }
  const intake = normalizeIntakeContext(value.intake);
  const serviceBindings = normalizeServiceBindings(value.service_bindings);
  const serviceBindingHash = requireSha256(value.service_binding_hash, 'P3.6 compiled service_binding_hash');
  if (serviceBindingHash !== sha256(canonicalJson(serviceBindings))) {
    substrateError('P3.6 compiled service_binding_hash does not match service bindings');
  }
  if (value.substrate_abi_hash !== getSupervisedProductionSubstrateAbiHash()) {
    substrateError('P3.6 compiled substrate_abi_hash does not match the frozen ABI');
  }
  const normalized = {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    kind: SUPERVISED_PRODUCTION_SUBSTRATE_KIND,
    status: SUPERVISED_PRODUCTION_SUBSTRATE_STATUS,
    intake_protocol_version: INTAKE_PROTOCOL_VERSION,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
    intake,
    service_bindings: serviceBindings,
    service_binding_hash: serviceBindingHash,
    substrate_abi_hash: value.substrate_abi_hash,
    witness_operations: requireExactStaticArray(value.witness_operations, WITNESS_OPERATIONS, 'P3.6 witness_operations'),
    coordinator_operations: requireExactStaticArray(
      value.coordinator_operations,
      COORDINATOR_OPERATIONS,
      'P3.6 coordinator_operations',
    ),
    broker_operations: requireExactStaticArray(value.broker_operations, BROKER_OPERATIONS, 'P3.6 broker_operations'),
  };
  const planHash = requireSha256(value.substrate_plan_hash, 'P3.6 substrate_plan_hash');
  if (planHash !== sha256(canonicalJson(normalized))) {
    substrateError('P3.6 substrate_plan_hash does not match the compiled plan');
  }
  return cloneCanonical({ ...normalized, substrate_plan_hash: planHash });
}

function verifySupervisedProductionSubstrateContract(plan, raw, options) {
  const actual = normalizeCompiledPlan(plan);
  const expected = compileNormalizedInput(normalizeVerifiedInput(raw, options));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    substrateError('P3.6 compiled substrate plan does not match its frozen inputs');
  }
  return cloneCanonical({
    verified: true,
    intake_protocol_version: INTAKE_PROTOCOL_VERSION,
    substrate_plan_hash: actual.substrate_plan_hash,
    intake_binding_hash: actual.intake.intake_binding_hash,
    service_binding_hash: actual.service_binding_hash,
    substrate_abi_hash: actual.substrate_abi_hash,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
  });
}

function assertPlanIntakeActive(plan, now) {
  if (now < plan.intake.not_before_ms) {
    substrateError('P3.6 compiled substrate intake is not active yet', 'SUBSTRATE_INTAKE_NOT_ACTIVE');
  }
  if (now >= plan.intake.expires_at_ms) {
    substrateError('P3.6 compiled substrate intake is expired', 'SUBSTRATE_INTAKE_EXPIRED');
  }
}

function normalizeServiceEnvelopeOptions(raw) {
  const value = assertOnlyKeys(raw, new Set([
    'expected_sender_role',
    'expected_recipient_role',
    'expected_operation',
    'now',
  ]), 'P3.6 service envelope options');
  if (Object.prototype.hasOwnProperty.call(value, 'expected_sender_role')
    && !SERVICE_ROLES.includes(value.expected_sender_role)) {
    substrateError('P3.6 expected_sender_role is unsupported');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'expected_recipient_role')
    && !SERVICE_ROLES.includes(value.expected_recipient_role)) {
    substrateError('P3.6 expected_recipient_role is unsupported');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'expected_operation')) {
    requireToken(value.expected_operation, 'P3.6 expected_operation');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'now') && typeof value.now !== 'function') {
    substrateError('P3.6 service envelope options.now must be a function');
  }
  return {
    expected_sender_role: value.expected_sender_role,
    expected_recipient_role: value.expected_recipient_role,
    expected_operation: value.expected_operation,
    now: value.now || (() => Date.now()),
  };
}

function routeForOperation(operation) {
  const route = OPERATION_ROUTES[operation];
  if (!route) {
    substrateError('P3.6 service IPC operation is not assigned a frozen route');
  }
  return route;
}

function normalizeServiceEnvelope(plan, raw, options = {}) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const expected = normalizeServiceEnvelopeOptions(options);
  const value = assertExactKeys(raw, new Set(SERVICE_IPC_ENVELOPE_FIELDS), 'P3.6 service IPC envelope');
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION
    || value.protocol_version !== SUPERVISED_SERVICE_IPC_PROTOCOL_VERSION) {
    substrateError('P3.6 service IPC envelope has an unsupported schema/protocol');
  }
  const senderRole = requireToken(value.sender_role, 'P3.6 service IPC sender_role');
  const recipientRole = requireToken(value.recipient_role, 'P3.6 service IPC recipient_role');
  if (!SERVICE_ROLES.includes(senderRole) || !SERVICE_ROLES.includes(recipientRole) || senderRole === recipientRole) {
    substrateError('P3.6 service IPC envelope has an invalid service route');
  }
  if (expected.expected_sender_role !== undefined && senderRole !== expected.expected_sender_role) {
    substrateError('P3.6 service IPC envelope sender role does not match the operation route');
  }
  if (expected.expected_recipient_role !== undefined && recipientRole !== expected.expected_recipient_role) {
    substrateError('P3.6 service IPC envelope recipient role does not match the operation route');
  }
  const operation = requireToken(value.operation, 'P3.6 service IPC operation');
  const requiredRoute = routeForOperation(operation);
  if (senderRole !== requiredRoute.sender_role || recipientRole !== requiredRoute.recipient_role) {
    substrateError('P3.6 service IPC envelope does not use the frozen operation route');
  }
  if (expected.expected_operation !== undefined && operation !== expected.expected_operation) {
    substrateError('P3.6 service IPC envelope operation does not match the request');
  }
  const sender = normalizedPlan.service_bindings[senderRole];
  const recipient = normalizedPlan.service_bindings[recipientRole];
  if (value.sender_identity !== sender.identity
    || value.sender_attestation_hash !== sender.attestation_hash
    || value.sender_cgroup_binding_hash !== sender.cgroup_binding_hash
    || value.recipient_identity !== recipient.identity
    || value.recipient_attestation_hash !== recipient.attestation_hash
    || value.recipient_cgroup_binding_hash !== recipient.cgroup_binding_hash
    || value.substrate_plan_hash !== normalizedPlan.substrate_plan_hash) {
    substrateError('P3.6 service IPC envelope does not match the frozen service bindings');
  }
  const issuedAt = requireEpochMilliseconds(value.issued_at_ms, 'P3.6 service IPC issued_at_ms');
  const expiresAt = requireEpochMilliseconds(value.expires_at_ms, 'P3.6 service IPC expires_at_ms');
  const now = requireEpochMilliseconds(expected.now(), 'P3.6 service IPC clock');
  assertPlanIntakeActive(normalizedPlan, now);
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_SERVICE_MESSAGE_LIFETIME_MILLISECONDS
    || issuedAt > now + MAX_FUTURE_SKEW_MILLISECONDS || expiresAt <= now) {
    substrateError('P3.6 service IPC envelope is outside its permitted clock window', 'SUBSTRATE_IPC_EXPIRED');
  }
  if (issuedAt < normalizedPlan.intake.not_before_ms
    || expiresAt > normalizedPlan.intake.expires_at_ms) {
    substrateError('P3.6 service IPC envelope exceeds the verified intake window', 'SUBSTRATE_IPC_OUTSIDE_INTAKE');
  }
  return {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    protocol_version: SUPERVISED_SERVICE_IPC_PROTOCOL_VERSION,
    request_id: requireToken(value.request_id, 'P3.6 service IPC request_id'),
    operation,
    sender_role: senderRole,
    sender_identity: sender.identity,
    sender_attestation_hash: sender.attestation_hash,
    sender_cgroup_binding_hash: sender.cgroup_binding_hash,
    recipient_role: recipientRole,
    recipient_identity: recipient.identity,
    recipient_attestation_hash: recipient.attestation_hash,
    recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
    issued_at_ms: issuedAt,
    expires_at_ms: expiresAt,
    nonce_hash: requireSha256(value.nonce_hash, 'P3.6 service IPC nonce_hash'),
    authentication_proof_hash: requireSha256(
      value.authentication_proof_hash,
      'P3.6 service IPC authentication_proof_hash',
    ),
    substrate_plan_hash: normalizedPlan.substrate_plan_hash,
    payload_hash: requireSha256(value.payload_hash, 'P3.6 service IPC payload_hash'),
  };
}

function bindServiceRequest(plan, envelope, request, route) {
  const envelopeOptions = {
    expected_sender_role: route.sender_role,
    expected_recipient_role: route.recipient_role,
    expected_operation: request.operation,
  };
  if (route.now !== undefined) envelopeOptions.now = route.now;
  const normalizedEnvelope = normalizeServiceEnvelope(plan, envelope, envelopeOptions);
  if (normalizedEnvelope.request_id !== request.request_id
    || normalizedEnvelope.substrate_plan_hash !== request.substrate_plan_hash
    || normalizedEnvelope.payload_hash !== sha256(canonicalJson(request))) {
    substrateError('P3.6 service IPC envelope does not bind the exact request payload');
  }
  return normalizedEnvelope;
}

function normalizeWitnessEvent(raw, label) {
  const value = assertExactKeys(raw, new Set(WITNESS_EVENT_FIELDS), label);
  return {
    event_hash: requireSha256(value.event_hash, `${label}.event_hash`),
    event_payload_hash: requireSha256(value.event_payload_hash, `${label}.event_payload_hash`),
  };
}

function normalizeWitnessRequest(plan, envelope, raw, { now } = {}) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const value = assertPlainObject(raw, 'P3.6 witness request');
  const operation = requireToken(value.operation, 'P3.6 witness request.operation');
  if (!WITNESS_OPERATIONS.includes(operation)) {
    substrateError('P3.6 witness request operation is unsupported');
  }
  let request;
  if (operation === 'appendIfHead') {
    const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS.appendIfHead), 'P3.6 witness appendIfHead request');
    request = {
      schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
      request_id: requireToken(input.request_id, 'P3.6 witness appendIfHead request_id'),
      operation,
      stream_id: requireToken(input.stream_id, 'P3.6 witness appendIfHead stream_id'),
      expected_head: requireNullableSha256(input.expected_head, 'P3.6 witness appendIfHead expected_head'),
      event_hash: requireSha256(input.event_hash, 'P3.6 witness appendIfHead event_hash'),
      event_payload_hash: requireSha256(input.event_payload_hash, 'P3.6 witness appendIfHead event_payload_hash'),
      substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'P3.6 witness appendIfHead substrate_plan_hash'),
    };
  } else if (operation === 'appendBatchIfHead') {
    const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS.appendBatchIfHead), 'P3.6 witness appendBatchIfHead request');
    if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_WITNESS_BATCH_EVENTS) {
      substrateError('P3.6 witness appendBatchIfHead events must be a bounded non-empty array');
    }
    const events = input.events.map((event, index) => normalizeWitnessEvent(event, `P3.6 witness batch event ${index}`));
    const eventHashes = new Set(events.map((event) => event.event_hash));
    if (eventHashes.size !== events.length) {
      substrateError('P3.6 witness appendBatchIfHead events must not duplicate event hashes');
    }
    request = {
      schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
      request_id: requireToken(input.request_id, 'P3.6 witness appendBatchIfHead request_id'),
      operation,
      stream_id: requireToken(input.stream_id, 'P3.6 witness appendBatchIfHead stream_id'),
      expected_head: requireNullableSha256(input.expected_head, 'P3.6 witness appendBatchIfHead expected_head'),
      events,
      substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'P3.6 witness appendBatchIfHead substrate_plan_hash'),
    };
  } else if (operation === 'getHead') {
    const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS.getHead), 'P3.6 witness getHead request');
    request = {
      schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
      request_id: requireToken(input.request_id, 'P3.6 witness getHead request_id'),
      operation,
      stream_id: requireToken(input.stream_id, 'P3.6 witness getHead stream_id'),
      substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'P3.6 witness getHead substrate_plan_hash'),
    };
  } else {
    const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS.readback), 'P3.6 witness readback request');
    if (!Number.isSafeInteger(input.from_sequence) || input.from_sequence < 1
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_WITNESS_READBACK_LIMIT) {
      substrateError('P3.6 witness readback range is invalid');
    }
    request = {
      schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
      request_id: requireToken(input.request_id, 'P3.6 witness readback request_id'),
      operation,
      stream_id: requireToken(input.stream_id, 'P3.6 witness readback stream_id'),
      from_sequence: input.from_sequence,
      limit: input.limit,
      substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'P3.6 witness readback substrate_plan_hash'),
    };
  }
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION
    || request.substrate_plan_hash !== normalizedPlan.substrate_plan_hash) {
    substrateError('P3.6 witness request does not match the frozen substrate plan');
  }
  const route = operation === 'appendIfHead' || operation === 'appendBatchIfHead'
    ? SERVICE_ROUTES.witness_append
    : SERVICE_ROUTES.witness_read;
  return cloneCanonical({
    request,
    envelope: bindServiceRequest(normalizedPlan, envelope, request, {
      ...route,
      now,
    }),
  });
}

function normalizeCoordinatorRequest(plan, envelope, raw, { now } = {}) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const value = assertExactKeys(raw, new Set(COORDINATOR_REQUEST_FIELDS), 'P3.6 coordinator request');
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION) {
    substrateError('P3.6 coordinator request schema_version is unsupported');
  }
  const operation = requireToken(value.operation, 'P3.6 coordinator request operation');
  if (!COORDINATOR_OPERATIONS.includes(operation)) {
    substrateError('P3.6 coordinator request operation is unsupported');
  }
  if (!Number.isSafeInteger(value.fence) || value.fence < 1) {
    substrateError('P3.6 coordinator request fence must be a positive integer');
  }
  const request = {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    request_id: requireToken(value.request_id, 'P3.6 coordinator request_id'),
    operation,
    transaction_id: requireToken(value.transaction_id, 'P3.6 coordinator transaction_id'),
    fence: value.fence,
    expected_witness_head: requireNullableSha256(
      value.expected_witness_head,
      'P3.6 coordinator expected_witness_head',
    ),
    substrate_plan_hash: requireSha256(value.substrate_plan_hash, 'P3.6 coordinator substrate_plan_hash'),
  };
  if (request.substrate_plan_hash !== normalizedPlan.substrate_plan_hash) {
    substrateError('P3.6 coordinator request does not match the frozen substrate plan');
  }
  return cloneCanonical({
    request,
    envelope: bindServiceRequest(normalizedPlan, envelope, request, {
      ...SERVICE_ROUTES.coordinator,
      now,
    }),
  });
}

function normalizeDisabledRequest(raw, allowedOperations, label) {
  const value = assertExactKeys(raw, new Set(DISABLED_REQUEST_FIELDS), label);
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION) {
    substrateError(`${label}.schema_version is unsupported`);
  }
  const operation = requireToken(value.operation, `${label}.operation`);
  if (!allowedOperations.includes(operation)) {
    substrateError(`${label}.operation is unsupported`);
  }
  return {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    request_id: requireToken(value.request_id, `${label}.request_id`),
    operation,
    substrate_plan_hash: requireSha256(value.substrate_plan_hash, `${label}.substrate_plan_hash`),
  };
}

function disabledResult(kind, code, responderRole, plan, envelope, request) {
  const responder = plan.service_bindings[responderRole];
  const material = {
    schema_version: SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
    kind,
    status: 'disabled',
    code,
    request_id: request.request_id,
    operation: request.operation,
    substrate_plan_hash: plan.substrate_plan_hash,
    request_hash: sha256(canonicalJson(request)),
    request_envelope_hash: sha256(canonicalJson(envelope)),
    responder_role: responderRole,
    responder_identity: responder.identity,
    responder_attestation_hash: responder.attestation_hash,
    responder_cgroup_binding_hash: responder.cgroup_binding_hash,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
  };
  return cloneCanonical({
    ...material,
    result_hash: sha256(canonicalJson(material)),
  });
}

function normalizeDisabledResultExpectation(plan, raw, spec) {
  if (raw === undefined) {
    substrateError(
      'P3.6 disabled result verification requires the original request, envelope, and clock',
      'SUBSTRATE_DISABLED_RESULT_EXPECTATION_REQUIRED',
    );
  }
  const expected = assertExactKeys(
    raw,
    new Set(DISABLED_RESULT_CORRELATION.expected_context_fields),
    'P3.6 disabled result expectation',
  );
  if (typeof expected.now !== 'function') {
    substrateError('P3.6 disabled result expectation.now must be a function', 'SUBSTRATE_DISABLED_RESULT_EXPECTATION_REQUIRED');
  }
  const request = normalizeDisabledRequest(
    expected.request,
    spec.allowed_operations,
    `P3.6 ${spec.responder_role} disabled result expected request`,
  );
  if (request.substrate_plan_hash !== plan.substrate_plan_hash) {
    substrateError('P3.6 disabled result expected request does not match the frozen substrate plan');
  }
  const envelope = bindServiceRequest(plan, expected.envelope, request, {
    ...spec.route,
    now: expected.now,
  });
  return { request, envelope };
}

function normalizeDisabledResult(plan, raw, expected, spec) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const responder = normalizedPlan.service_bindings[spec.responder_role];
  const bound = normalizeDisabledResultExpectation(normalizedPlan, expected, spec);
  const value = assertExactKeys(raw, new Set(DISABLED_RESULT_FIELDS), 'P3.6 disabled service result');
  const material = { ...value };
  delete material.result_hash;
  if (value.schema_version !== SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION
    || value.kind !== spec.kind
    || value.status !== 'disabled'
    || value.code !== spec.code
    || value.request_id !== bound.request.request_id
    || value.operation !== bound.request.operation
    || value.substrate_plan_hash !== normalizedPlan.substrate_plan_hash
    || value.request_hash !== sha256(canonicalJson(bound.request))
    || value.request_envelope_hash !== sha256(canonicalJson(bound.envelope))
    || value.responder_role !== spec.responder_role
    || value.responder_identity !== responder.identity
    || value.responder_attestation_hash !== responder.attestation_hash
    || value.responder_cgroup_binding_hash !== responder.cgroup_binding_hash
    || value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available'
    || sha256(canonicalJson(material)) !== requireSha256(value.result_hash, 'P3.6 disabled result_hash')) {
    substrateError('P3.6 disabled service result is invalid or tampered');
  }
  requireToken(value.request_id, 'P3.6 disabled result request_id');
  requireToken(value.operation, 'P3.6 disabled result operation');
  requireSha256(value.request_hash, 'P3.6 disabled result request_hash');
  requireSha256(value.request_envelope_hash, 'P3.6 disabled result request_envelope_hash');
  return cloneCanonical(value);
}

function createEffectsDisabledBrokerResult(plan, envelope, rawRequest, { now } = {}) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const spec = DISABLED_SERVICE_SPECS.broker;
  const request = normalizeDisabledRequest(rawRequest, spec.allowed_operations, 'P3.6 disabled broker request');
  if (request.substrate_plan_hash !== normalizedPlan.substrate_plan_hash) {
    substrateError('P3.6 disabled broker request does not match the frozen substrate plan');
  }
  const normalizedEnvelope = bindServiceRequest(normalizedPlan, envelope, request, {
    ...spec.route,
    now,
  });
  return disabledResult(
    spec.kind,
    spec.code,
    spec.responder_role,
    normalizedPlan,
    normalizedEnvelope,
    request,
  );
}

function createAcceptanceDisabledCoordinatorResult(plan, envelope, rawRequest, { now } = {}) {
  const normalizedPlan = normalizeCompiledPlan(plan);
  const spec = DISABLED_SERVICE_SPECS.coordinator;
  const request = normalizeDisabledRequest(
    rawRequest,
    spec.allowed_operations,
    'P3.6 disabled coordinator request',
  );
  if (request.substrate_plan_hash !== normalizedPlan.substrate_plan_hash) {
    substrateError('P3.6 disabled coordinator request does not match the frozen substrate plan');
  }
  const normalizedEnvelope = bindServiceRequest(normalizedPlan, envelope, request, {
    ...spec.route,
    now,
  });
  return disabledResult(
    spec.kind,
    spec.code,
    spec.responder_role,
    normalizedPlan,
    normalizedEnvelope,
    request,
  );
}

function normalizeEffectsDisabledBrokerResult(plan, raw, expected) {
  return normalizeDisabledResult(plan, raw, expected, DISABLED_SERVICE_SPECS.broker);
}

function normalizeAcceptanceDisabledCoordinatorResult(plan, raw, expected) {
  return normalizeDisabledResult(plan, raw, expected, DISABLED_SERVICE_SPECS.coordinator);
}

module.exports = {
  BROKER_OPERATIONS,
  COORDINATOR_OPERATIONS,
  INTAKE_PROTOCOL_VERSION,
  SERVICE_ROLES,
  SUPERVISED_PRODUCTION_SUBSTRATE_KIND,
  SUPERVISED_PRODUCTION_SUBSTRATE_SCHEMA_VERSION,
  SUPERVISED_PRODUCTION_SUBSTRATE_STATUS,
  SUPERVISED_SERVICE_IPC_PROTOCOL_VERSION,
  WITNESS_OPERATIONS,
  compileSupervisedProductionSubstrateContract,
  createAcceptanceDisabledCoordinatorResult,
  createEffectsDisabledBrokerResult,
  getSupervisedProductionSubstrateAbi,
  getSupervisedProductionSubstrateAbiHash,
  normalizeAcceptanceDisabledCoordinatorResult,
  normalizeEffectsDisabledBrokerResult,
  normalizeServiceEnvelope,
  normalizeWitnessRequest,
  normalizeCoordinatorRequest,
  verifySupervisedProductionSubstrateContract,
};
