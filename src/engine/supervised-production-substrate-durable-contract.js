'use strict';

// P3.6 Phase 3 defines a stateful transport distinct from the P2b peer
// probe. It describes hash-only durable state and refusal surfaces only. It
// does not load an Engine, interpret an action descriptor, or accept a result.

const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');

const DURABLE_STATE_SCHEMA_VERSION = 1;
const DURABLE_STATE_PROTOCOL_VERSION = 1;
const MAX_DURABLE_FRAME_BYTES = 524288;
const MAX_DURABLE_MESSAGE_LIFETIME_MILLISECONDS = 60 * 1000;
const MAX_DURABLE_FUTURE_SKEW_MILLISECONDS = 1000;
const MAX_DURABLE_BATCH_EVENTS = 64;
const MAX_DURABLE_READBACK_LIMIT = 1024;
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const SERVICE_ROLES = Object.freeze([
  'worker',
  'broker',
  'receipt_verifier',
  'witness',
  'coordinator',
]);
const BROKER_OPERATIONS = Object.freeze([
  'mint_permit',
  'postclaim_authorize',
  'execute',
  'revoke',
]);
const WITNESS_APPEND_OPERATIONS = Object.freeze(['appendIfHead', 'appendBatchIfHead']);
const WITNESS_READ_OPERATIONS = Object.freeze(['getHead', 'readback']);
const COORDINATOR_OPERATIONS = Object.freeze(['prepare', 'cancel', 'resolve']);
const RECEIPT_VERIFIER_OPERATIONS = Object.freeze(['check_revocation']);

const DURABLE_ENDPOINTS = Object.freeze([
  Object.freeze({
    endpoint_id: 'worker_broker',
    sender_role: 'worker',
    recipient_role: 'broker',
    operations: BROKER_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'receipt_verifier_witness',
    sender_role: 'receipt_verifier',
    recipient_role: 'witness',
    operations: WITNESS_APPEND_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'receipt_verifier_coordinator',
    sender_role: 'receipt_verifier',
    recipient_role: 'coordinator',
    operations: COORDINATOR_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'coordinator_witness',
    sender_role: 'coordinator',
    recipient_role: 'witness',
    operations: WITNESS_READ_OPERATIONS,
  }),
  Object.freeze({
    endpoint_id: 'broker_receipt_verifier',
    sender_role: 'broker',
    recipient_role: 'receipt_verifier',
    operations: RECEIPT_VERIFIER_OPERATIONS,
  }),
]);

const SERVICE_BINDING_FIELDS = Object.freeze([
  'role',
  'identity',
  'uid',
  'gid',
  'attestation_hash',
  'cgroup_binding_hash',
]);
const DURABLE_BINDING_FIELDS = Object.freeze([
  'schema_version',
  'kind',
  'install_binding_hash',
  'run_binding_hash',
  'substrate_abi_hash',
  'substrate_plan_hash',
  'durable_abi_hash',
  'cohort_id',
  'generation',
  'service_bindings',
]);
const DURABLE_ENVELOPE_FIELDS = Object.freeze([
  'schema_version',
  'protocol_version',
  'endpoint_id',
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
  'install_binding_hash',
  'run_binding_hash',
  'substrate_abi_hash',
  'substrate_plan_hash',
  'durable_abi_hash',
  'cohort_id',
  'generation',
  'issued_at_ms',
  'expires_at_ms',
  'nonce_hash',
  'authentication_proof_hash',
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
const WITNESS_RECEIPT_FIELDS = Object.freeze([
  'sequence', 'event_hash', 'event_payload_hash', 'previous_head', 'request_hash', 'head',
]);
const COORDINATOR_REQUEST_FIELDS = Object.freeze([
  'schema_version', 'request_id', 'operation', 'transaction_id', 'fence',
  'expected_witness_head', 'substrate_plan_hash',
]);
const BROKER_REQUEST_FIELDS = Object.freeze([
  'schema_version', 'request_id', 'operation', 'substrate_plan_hash',
]);
const REVOCATION_REQUEST_FIELDS = Object.freeze([
  'schema_version', 'request_id', 'operation', 'broker_result_hash', 'substrate_plan_hash',
]);
const RECEIPT_ANCHOR_RECORD_FIELDS = Object.freeze([
  'schema_version', 'kind', 'request_id', 'operation', 'request_hash',
  'request_envelope_hash', 'endpoint_id', 'witness_status', 'witness_code',
  'witness_result_hash', 'witness_response_hash',
  'witness_stream_id', 'witness_head', 'witness_sequence', 'witness_journal_hash',
  'previous_journal_hash', 'journal_hash',
]);
const RESULT_COMMON_FIELDS = Object.freeze([
  'schema_version', 'kind', 'status', 'code', 'request_id', 'operation',
  'install_binding_hash', 'run_binding_hash', 'substrate_abi_hash',
  'substrate_plan_hash', 'durable_abi_hash', 'cohort_id', 'generation',
  'request_hash', 'request_envelope_hash', 'responder_role', 'responder_identity',
  'responder_attestation_hash', 'responder_cgroup_binding_hash',
  'owner_kernel_authority', 'effect_authority', 'broker_authority', 'acceptance',
]);
const WITNESS_RESULT_FIELDS = Object.freeze([
  ...RESULT_COMMON_FIELDS,
  'stream_id', 'head', 'sequence', 'records', 'journal_hash', 'result_hash',
]);
const COORDINATOR_RESULT_FIELDS = Object.freeze([
  ...RESULT_COMMON_FIELDS,
  'transaction_id', 'fence', 'state_hash', 'journal_hash', 'result_hash',
]);
const BROKER_RESULT_FIELDS = Object.freeze([...RESULT_COMMON_FIELDS, 'result_hash']);
const REVOCATION_RESULT_FIELDS = Object.freeze([...RESULT_COMMON_FIELDS, 'broker_result_hash', 'result_hash']);
const AVAILABILITY_SNAPSHOT_FIELDS = Object.freeze([
  'schema_version', 'kind', 'role', 'binding_hash', 'status', 'journal_hash', 'snapshot_hash',
]);
const AVAILABILITY_FIELDS = Object.freeze([
  'schema_version', 'kind', 'status', 'install_binding_hash', 'run_binding_hash',
  'substrate_abi_hash', 'substrate_plan_hash', 'durable_abi_hash', 'cohort_id',
  'generation', 'receipt_anchor_role', 'receipt_anchor_binding_hash', 'receipt_anchor_state',
  'receipt_anchor_journal_hash', 'receipt_anchor_snapshot_hash', 'witness_role', 'witness_binding_hash', 'witness_state',
  'witness_journal_hash', 'witness_snapshot_hash', 'coordinator_role',
  'coordinator_binding_hash', 'coordinator_state', 'coordinator_journal_hash',
  'coordinator_snapshot_hash', 'owner_kernel_authority', 'effect_authority',
  'broker_authority', 'acceptance', 'disclosure_hash',
]);

function durableError(message, code = 'INVALID_DURABLE_SUBSTRATE') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    durableError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    durableError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, keys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    durableError(`${label} has an unexpected key set`);
  }
  return value;
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    durableError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    durableError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireNullableSha256(value, label) {
  return value === null ? null : requireSha256(value, label);
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    durableError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireNonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    durableError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function normalizeServiceBindings(raw) {
  const value = assertExactKeys(raw, new Set(SERVICE_ROLES), 'durable service bindings');
  const seen = new Map();
  const normalized = {};
  for (const role of SERVICE_ROLES) {
    const entry = assertExactKeys(value[role], new Set(SERVICE_BINDING_FIELDS), `durable ${role} binding`);
    if (entry.role !== role) durableError(`durable ${role} binding role is invalid`);
    const normalizedEntry = {
      role,
      identity: requireToken(entry.identity, `durable ${role} identity`),
      uid: requirePositiveInteger(entry.uid, `durable ${role} uid`),
      gid: requirePositiveInteger(entry.gid, `durable ${role} gid`),
      attestation_hash: requireSha256(entry.attestation_hash, `durable ${role} attestation_hash`),
      cgroup_binding_hash: requireSha256(entry.cgroup_binding_hash, `durable ${role} cgroup_binding_hash`),
    };
    for (const [field, item] of Object.entries(normalizedEntry)) {
      if (field === 'role') continue;
      const key = `${field}:${item}`;
      if (seen.has(key)) durableError(`durable ${role} ${field} duplicates ${seen.get(key)}`);
      seen.set(key, role);
    }
    normalized[role] = normalizedEntry;
  }
  return cloneCanonical(normalized);
}

function getDurableEndpoint(endpointId) {
  const endpoint = DURABLE_ENDPOINTS.find((item) => item.endpoint_id === endpointId);
  if (!endpoint) durableError('durable endpoint is not part of the frozen topology');
  return endpoint;
}

function getSupervisedProductionDurableAbi() {
  return cloneCanonical({
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    kind: 'p36_durable_state_transport',
    protocol_version: DURABLE_STATE_PROTOCOL_VERSION,
    max_frame_bytes: MAX_DURABLE_FRAME_BYTES,
    max_message_lifetime_milliseconds: MAX_DURABLE_MESSAGE_LIFETIME_MILLISECONDS,
    max_future_skew_milliseconds: MAX_DURABLE_FUTURE_SKEW_MILLISECONDS,
    service_roles: SERVICE_ROLES,
    endpoints: DURABLE_ENDPOINTS,
    binding_fields: DURABLE_BINDING_FIELDS,
    envelope_fields: DURABLE_ENVELOPE_FIELDS,
    witness: {
      request_fields: WITNESS_REQUEST_FIELDS,
      event_fields: WITNESS_EVENT_FIELDS,
      receipt_fields: WITNESS_RECEIPT_FIELDS,
      result_fields: WITNESS_RESULT_FIELDS,
      max_batch_events: MAX_DURABLE_BATCH_EVENTS,
      max_readback_limit: MAX_DURABLE_READBACK_LIMIT,
      statuses: ['recorded', 'available', 'stale', 'unknown', 'quarantined'],
    },
    coordinator: {
      request_fields: COORDINATOR_REQUEST_FIELDS,
      result_fields: COORDINATOR_RESULT_FIELDS,
      statuses: ['prepared', 'cancelled', 'fenced', 'unavailable', 'unknown', 'quarantined'],
      forbidden_operations: ['commit', 'accept'],
    },
    broker: {
      request_fields: BROKER_REQUEST_FIELDS,
      result_fields: BROKER_RESULT_FIELDS,
      status: 'disabled',
      code: 'BROKER_EFFECTS_DISABLED',
    },
    receipt_verifier: {
      request_fields: REVOCATION_REQUEST_FIELDS,
      result_fields: REVOCATION_RESULT_FIELDS,
      status: 'unavailable',
      code: 'REVOCATION_UNAVAILABLE',
      receipt_anchor_record_fields: RECEIPT_ANCHOR_RECORD_FIELDS,
      receipt_anchor: 'internal_witness_response_commitment_only',
    },
    availability: {
      fields: AVAILABILITY_FIELDS,
      snapshot_fields: AVAILABILITY_SNAPSHOT_FIELDS,
      authority: {
        owner_kernel_authority: 'none',
        effect_authority: 'none',
        broker_authority: 'disabled',
        acceptance: 'not_available',
      },
    },
  });
}

function getSupervisedProductionDurableAbiHash() {
  return sha256(canonicalJson(getSupervisedProductionDurableAbi()));
}

function normalizeDurableBinding(raw) {
  const value = assertExactKeys(raw, new Set(DURABLE_BINDING_FIELDS), 'durable binding');
  if (value.schema_version !== DURABLE_STATE_SCHEMA_VERSION || value.kind !== 'p36_durable_state_binding') {
    durableError('durable binding has an unsupported schema or kind');
  }
  if (value.durable_abi_hash !== getSupervisedProductionDurableAbiHash()) {
    durableError('durable binding does not match the installed durable ABI');
  }
  return cloneCanonical({
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    kind: 'p36_durable_state_binding',
    install_binding_hash: requireSha256(value.install_binding_hash, 'durable install_binding_hash'),
    run_binding_hash: requireSha256(value.run_binding_hash, 'durable run_binding_hash'),
    substrate_abi_hash: requireSha256(value.substrate_abi_hash, 'durable substrate_abi_hash'),
    substrate_plan_hash: requireSha256(value.substrate_plan_hash, 'durable substrate_plan_hash'),
    durable_abi_hash: getSupervisedProductionDurableAbiHash(),
    cohort_id: requireToken(value.cohort_id, 'durable cohort_id'),
    generation: requirePositiveInteger(value.generation, 'durable generation'),
    service_bindings: normalizeServiceBindings(value.service_bindings),
  });
}

function normalizeDurableEnvelope(bindingRaw, raw, { now = () => Date.now() } = {}) {
  const binding = normalizeDurableBinding(bindingRaw);
  const value = assertExactKeys(raw, new Set(DURABLE_ENVELOPE_FIELDS), 'durable envelope');
  if (value.schema_version !== DURABLE_STATE_SCHEMA_VERSION
    || value.protocol_version !== DURABLE_STATE_PROTOCOL_VERSION) {
    durableError('durable envelope has an unsupported schema or protocol');
  }
  const endpoint = getDurableEndpoint(requireToken(value.endpoint_id, 'durable endpoint_id'));
  const operation = requireToken(value.operation, 'durable operation');
  if (!endpoint.operations.includes(operation)) durableError('durable endpoint does not allow this operation');
  if (value.sender_role !== endpoint.sender_role || value.recipient_role !== endpoint.recipient_role) {
    durableError('durable envelope does not use the frozen role route');
  }
  const sender = binding.service_bindings[endpoint.sender_role];
  const recipient = binding.service_bindings[endpoint.recipient_role];
  if (value.sender_identity !== sender.identity
    || value.sender_attestation_hash !== sender.attestation_hash
    || value.sender_cgroup_binding_hash !== sender.cgroup_binding_hash
    || value.recipient_identity !== recipient.identity
    || value.recipient_attestation_hash !== recipient.attestation_hash
    || value.recipient_cgroup_binding_hash !== recipient.cgroup_binding_hash
    || value.install_binding_hash !== binding.install_binding_hash
    || value.run_binding_hash !== binding.run_binding_hash
    || value.substrate_abi_hash !== binding.substrate_abi_hash
    || value.substrate_plan_hash !== binding.substrate_plan_hash
    || value.durable_abi_hash !== binding.durable_abi_hash
    || value.cohort_id !== binding.cohort_id
    || value.generation !== binding.generation) {
    durableError('durable envelope does not match the frozen cohort binding');
  }
  const issuedAt = requirePositiveInteger(value.issued_at_ms, 'durable issued_at_ms');
  const expiresAt = requirePositiveInteger(value.expires_at_ms, 'durable expires_at_ms');
  const observedNow = requirePositiveInteger(now(), 'durable clock');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > MAX_DURABLE_MESSAGE_LIFETIME_MILLISECONDS
    || issuedAt > observedNow + MAX_DURABLE_FUTURE_SKEW_MILLISECONDS || expiresAt <= observedNow) {
    durableError('durable envelope is outside its clock window', 'DURABLE_ENVELOPE_EXPIRED');
  }
  return cloneCanonical({
    ...value,
    request_id: requireToken(value.request_id, 'durable request_id'),
    operation,
    nonce_hash: requireSha256(value.nonce_hash, 'durable nonce_hash'),
    authentication_proof_hash: requireSha256(value.authentication_proof_hash, 'durable authentication_proof_hash'),
    payload_hash: requireSha256(value.payload_hash, 'durable payload_hash'),
  });
}

function normalizeWitnessRequest(bindingRaw, envelopeRaw, raw, options) {
  const binding = normalizeDurableBinding(bindingRaw);
  const value = assertPlainObject(raw, 'durable witness request');
  const operation = requireToken(value.operation, 'durable witness operation');
  if (![...WITNESS_APPEND_OPERATIONS, ...WITNESS_READ_OPERATIONS].includes(operation)) {
    durableError('durable witness operation is unsupported');
  }
  const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS[operation]), 'durable witness request');
  const request = {
    ...input,
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable witness request_id'),
    operation,
    stream_id: requireToken(input.stream_id, 'durable witness stream_id'),
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable witness substrate_plan_hash'),
  };
  if (request.substrate_plan_hash !== binding.substrate_plan_hash) durableError('durable witness request has the wrong plan binding');
  if (operation === 'appendIfHead') {
    request.expected_head = requireNullableSha256(input.expected_head, 'durable witness expected_head');
    request.event_hash = requireSha256(input.event_hash, 'durable witness event_hash');
    request.event_payload_hash = requireSha256(input.event_payload_hash, 'durable witness event_payload_hash');
  } else if (operation === 'appendBatchIfHead') {
    request.expected_head = requireNullableSha256(input.expected_head, 'durable witness expected_head');
    if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_DURABLE_BATCH_EVENTS) {
      durableError('durable witness batch has an invalid event count');
    }
    const seen = new Set();
    request.events = input.events.map((event, index) => {
      const normalized = assertExactKeys(event, new Set(WITNESS_EVENT_FIELDS), `durable witness event ${index}`);
      const eventHash = requireSha256(normalized.event_hash, `durable witness event ${index} hash`);
      if (seen.has(eventHash)) durableError('durable witness batch repeats an event hash');
      seen.add(eventHash);
      return { event_hash: eventHash, event_payload_hash: requireSha256(normalized.event_payload_hash, `durable witness event ${index} payload hash`) };
    });
  } else if (operation === 'readback') {
    request.from_sequence = requirePositiveInteger(input.from_sequence, 'durable witness from_sequence');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_DURABLE_READBACK_LIMIT) {
      durableError('durable witness readback limit is invalid');
    }
    request.limit = input.limit;
  }
  const envelope = normalizeDurableEnvelope(binding, envelopeRaw, options);
  if (envelope.request_id !== request.request_id || envelope.operation !== operation
    || envelope.payload_hash !== sha256(canonicalJson(request))) {
    durableError('durable witness envelope does not bind the exact request');
  }
  return cloneCanonical({ request, envelope });
}

function normalizeCoordinatorRequest(bindingRaw, envelopeRaw, raw, options) {
  const binding = normalizeDurableBinding(bindingRaw);
  const input = assertExactKeys(raw, new Set(COORDINATOR_REQUEST_FIELDS), 'durable coordinator request');
  const operation = requireToken(input.operation, 'durable coordinator operation');
  if (!COORDINATOR_OPERATIONS.includes(operation)) durableError('durable coordinator operation is unsupported');
  const request = {
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable coordinator request_id'),
    operation,
    transaction_id: requireToken(input.transaction_id, 'durable coordinator transaction_id'),
    fence: requirePositiveInteger(input.fence, 'durable coordinator fence'),
    expected_witness_head: requireNullableSha256(input.expected_witness_head, 'durable coordinator expected_witness_head'),
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable coordinator substrate_plan_hash'),
  };
  if (input.schema_version !== DURABLE_STATE_SCHEMA_VERSION || request.substrate_plan_hash !== binding.substrate_plan_hash) {
    durableError('durable coordinator request has an invalid binding');
  }
  const envelope = normalizeDurableEnvelope(binding, envelopeRaw, options);
  if (envelope.request_id !== request.request_id || envelope.operation !== operation
    || envelope.payload_hash !== sha256(canonicalJson(request))) {
    durableError('durable coordinator envelope does not bind the exact request');
  }
  return cloneCanonical({ request, envelope });
}

function normalizeWitnessPayload(bindingRaw, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const value = assertPlainObject(raw, 'durable witness request');
  const operation = requireToken(value.operation, 'durable witness operation');
  if (![...WITNESS_APPEND_OPERATIONS, ...WITNESS_READ_OPERATIONS].includes(operation)) {
    durableError('durable witness operation is unsupported');
  }
  const input = assertExactKeys(value, new Set(WITNESS_REQUEST_FIELDS[operation]), 'durable witness request');
  const request = {
    ...input,
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable witness request_id'),
    operation,
    stream_id: requireToken(input.stream_id, 'durable witness stream_id'),
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable witness substrate_plan_hash'),
  };
  if (request.substrate_plan_hash !== binding.substrate_plan_hash) {
    durableError('durable witness request has the wrong plan binding');
  }
  if (operation === 'appendIfHead') {
    request.expected_head = requireNullableSha256(input.expected_head, 'durable witness expected_head');
    request.event_hash = requireSha256(input.event_hash, 'durable witness event_hash');
    request.event_payload_hash = requireSha256(input.event_payload_hash, 'durable witness event_payload_hash');
  } else if (operation === 'appendBatchIfHead') {
    request.expected_head = requireNullableSha256(input.expected_head, 'durable witness expected_head');
    if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > MAX_DURABLE_BATCH_EVENTS) {
      durableError('durable witness batch has an invalid event count');
    }
    const seen = new Set();
    request.events = input.events.map((event, index) => {
      const normalized = assertExactKeys(event, new Set(WITNESS_EVENT_FIELDS), 'durable witness event ' + index);
      const eventHash = requireSha256(normalized.event_hash, 'durable witness event ' + index + ' hash');
      if (seen.has(eventHash)) durableError('durable witness batch repeats an event hash');
      seen.add(eventHash);
      return {
        event_hash: eventHash,
        event_payload_hash: requireSha256(
          normalized.event_payload_hash,
          'durable witness event ' + index + ' payload hash',
        ),
      };
    });
  } else if (operation === 'readback') {
    request.from_sequence = requirePositiveInteger(input.from_sequence, 'durable witness from_sequence');
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > MAX_DURABLE_READBACK_LIMIT) {
      durableError('durable witness readback limit is invalid');
    }
    request.limit = input.limit;
  }
  return cloneCanonical(request);
}

function normalizeCoordinatorPayload(bindingRaw, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const input = assertExactKeys(raw, new Set(COORDINATOR_REQUEST_FIELDS), 'durable coordinator request');
  const operation = requireToken(input.operation, 'durable coordinator operation');
  if (!COORDINATOR_OPERATIONS.includes(operation)) durableError('durable coordinator operation is unsupported');
  const request = {
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable coordinator request_id'),
    operation,
    transaction_id: requireToken(input.transaction_id, 'durable coordinator transaction_id'),
    fence: requirePositiveInteger(input.fence, 'durable coordinator fence'),
    expected_witness_head: requireNullableSha256(input.expected_witness_head, 'durable coordinator expected_witness_head'),
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable coordinator substrate_plan_hash'),
  };
  if (input.schema_version !== DURABLE_STATE_SCHEMA_VERSION || request.substrate_plan_hash !== binding.substrate_plan_hash) {
    durableError('durable coordinator request has an invalid binding');
  }
  return cloneCanonical(request);
}

function normalizeBrokerPayload(bindingRaw, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const input = assertExactKeys(raw, new Set(BROKER_REQUEST_FIELDS), 'durable broker request');
  const operation = requireToken(input.operation, 'durable broker operation');
  if (!BROKER_OPERATIONS.includes(operation)) durableError('durable broker operation is unsupported');
  const request = {
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable broker request_id'),
    operation,
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable broker substrate_plan_hash'),
  };
  if (input.schema_version !== DURABLE_STATE_SCHEMA_VERSION || request.substrate_plan_hash !== binding.substrate_plan_hash) {
    durableError('durable broker request has an invalid binding');
  }
  return cloneCanonical(request);
}

function normalizeRevocationPayload(bindingRaw, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const input = assertExactKeys(raw, new Set(REVOCATION_REQUEST_FIELDS), 'durable revocation request');
  const operation = requireToken(input.operation, 'durable revocation operation');
  if (!RECEIPT_VERIFIER_OPERATIONS.includes(operation)) durableError('durable revocation operation is unsupported');
  const request = {
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    request_id: requireToken(input.request_id, 'durable revocation request_id'),
    operation,
    broker_result_hash: requireSha256(input.broker_result_hash, 'durable revocation broker_result_hash'),
    substrate_plan_hash: requireSha256(input.substrate_plan_hash, 'durable revocation substrate_plan_hash'),
  };
  if (input.schema_version !== DURABLE_STATE_SCHEMA_VERSION || request.substrate_plan_hash !== binding.substrate_plan_hash) {
    durableError('durable revocation request has an invalid binding');
  }
  return cloneCanonical(request);
}

function normalizeCommonResult(binding, request, requestEnvelopeHash, raw, fields, kind, responderRole, codes) {
  const value = assertExactKeys(raw, new Set(fields), 'durable result');
  if (value.schema_version !== DURABLE_STATE_SCHEMA_VERSION || value.kind !== kind) {
    durableError('durable result has an invalid schema or kind');
  }
  if (!Object.prototype.hasOwnProperty.call(codes, value.status) || value.code !== codes[value.status]) {
    durableError('durable result has an invalid status or code');
  }
  const responder = binding.service_bindings[responderRole];
  const expectedEnvelopeHash = requireSha256(requestEnvelopeHash, 'durable request_envelope_hash');
  if (
    value.request_id !== request.request_id
    || value.operation !== request.operation
    || value.install_binding_hash !== binding.install_binding_hash
    || value.run_binding_hash !== binding.run_binding_hash
    || value.substrate_abi_hash !== binding.substrate_abi_hash
    || value.substrate_plan_hash !== binding.substrate_plan_hash
    || value.durable_abi_hash !== binding.durable_abi_hash
    || value.cohort_id !== binding.cohort_id
    || value.generation !== binding.generation
    || value.request_hash !== sha256(canonicalJson(request))
    || value.request_envelope_hash !== expectedEnvelopeHash
    || value.responder_role !== responderRole
    || value.responder_identity !== responder.identity
    || value.responder_attestation_hash !== responder.attestation_hash
    || value.responder_cgroup_binding_hash !== responder.cgroup_binding_hash
    || value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available'
  ) {
    durableError('durable result does not match the frozen request or responder binding');
  }
  requireSha256(value.request_hash, 'durable result request_hash');
  requireSha256(value.request_envelope_hash, 'durable result request_envelope_hash');
  requireSha256(value.responder_attestation_hash, 'durable result responder_attestation_hash');
  requireSha256(value.responder_cgroup_binding_hash, 'durable result responder_cgroup_binding_hash');
  const material = { ...value };
  delete material.result_hash;
  if (requireSha256(value.result_hash, 'durable result_hash') !== sha256(canonicalJson(material))) {
    durableError('durable result_hash does not bind the complete result');
  }
  return cloneCanonical(value);
}

function normalizeWitnessReceipt(raw, label, streamId) {
  const value = assertExactKeys(raw, new Set(WITNESS_RECEIPT_FIELDS), label);
  const receipt = {
    sequence: requirePositiveInteger(value.sequence, label + ' sequence'),
    event_hash: requireSha256(value.event_hash, label + ' event_hash'),
    event_payload_hash: requireSha256(value.event_payload_hash, label + ' event_payload_hash'),
    previous_head: requireNullableSha256(value.previous_head, label + ' previous_head'),
    request_hash: requireSha256(value.request_hash, label + ' request_hash'),
    head: requireSha256(value.head, label + ' head'),
  };
  const expectedHead = sha256(canonicalJson({
    schema_version: DURABLE_STATE_SCHEMA_VERSION,
    kind: 'p36_durable_witness_receipt',
    stream_id: requireToken(streamId, 'durable witness receipt stream_id'),
    sequence: receipt.sequence,
    previous_head: receipt.previous_head,
    event_hash: receipt.event_hash,
    event_payload_hash: receipt.event_payload_hash,
    request_hash: receipt.request_hash,
  }));
  if (receipt.head !== expectedHead) {
    durableError('durable witness receipt head is not hash-bound to its event');
  }
  return cloneCanonical(receipt);
}

function normalizeDurableWitnessResult(bindingRaw, requestRaw, requestEnvelopeHash, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const request = normalizeWitnessPayload(binding, requestRaw);
  const value = normalizeCommonResult(
    binding,
    request,
    requestEnvelopeHash,
    raw,
    WITNESS_RESULT_FIELDS,
    'p36_durable_witness_result',
    'witness',
    { recorded: 'WITNESS_RECORDED', available: 'WITNESS_AVAILABLE' },
  );
  if (
    value.stream_id !== request.stream_id
    || requireNullableSha256(value.head, 'durable witness result head') !== value.head
    || requireNonnegativeInteger(value.sequence, 'durable witness result sequence') !== value.sequence
    || requireSha256(value.journal_hash, 'durable witness result journal_hash') !== value.journal_hash
    || !Array.isArray(value.records)
  ) {
    durableError('durable witness result has an invalid stream snapshot');
  }
  if ((value.sequence === 0) !== (value.head === null)) {
    durableError('durable witness result head does not match its stream sequence');
  }
  const records = value.records.map(
    (record, index) => normalizeWitnessReceipt(record, 'durable witness receipt ' + index, request.stream_id),
  );
  for (let index = 1; index < records.length; index += 1) {
    if (
      records[index].sequence !== records[index - 1].sequence + 1
      || records[index].previous_head !== records[index - 1].head
    ) {
      durableError('durable witness result receipts do not form a chain');
    }
  }
  if (WITNESS_APPEND_OPERATIONS.includes(request.operation)) {
    const expectedLength = request.operation === 'appendIfHead' ? 1 : request.events.length;
    const expectedEvents = request.operation === 'appendIfHead'
      ? [{ event_hash: request.event_hash, event_payload_hash: request.event_payload_hash }]
      : request.events;
    const firstSequence = value.sequence - expectedLength + 1;
    let previousHead = request.expected_head;
    const expectedRecords = expectedEvents.map((event, index) => {
      const receipt = {
        sequence: firstSequence + index,
        event_hash: event.event_hash,
        event_payload_hash: event.event_payload_hash,
        previous_head: previousHead,
        request_hash: value.request_hash,
      };
      receipt.head = sha256(canonicalJson({
        schema_version: DURABLE_STATE_SCHEMA_VERSION,
        kind: 'p36_durable_witness_receipt',
        stream_id: request.stream_id,
        ...receipt,
      }));
      previousHead = receipt.head;
      return receipt;
    });
    if (
      value.status !== 'recorded'
      || firstSequence < 1
      || records.length !== expectedLength
      || canonicalJson(records) !== canonicalJson(expectedRecords)
      || previousHead !== value.head
    ) {
      durableError('durable witness mutation result is not an exact receipt set');
    }
  } else {
    if (value.status !== 'available' || (request.operation === 'getHead' && records.length !== 0)) {
      durableError('durable witness query result is invalid');
    }
    if (request.operation === 'readback') {
      const expectedCount = Math.min(
        request.limit,
        Math.max(0, value.sequence - request.from_sequence + 1),
      );
      if (
        records.length !== expectedCount
        || (expectedCount > 0 && (
          records[0].sequence !== request.from_sequence
          || records[records.length - 1].sequence !== request.from_sequence + expectedCount - 1
          || (records[records.length - 1].sequence === value.sequence
            && records[records.length - 1].head !== value.head)
        ))
      ) {
        durableError('durable witness readback is not an exact requested range');
      }
    }
  }
  return cloneCanonical({ ...value, records });
}

function normalizeDurableCoordinatorResult(bindingRaw, requestRaw, requestEnvelopeHash, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const request = normalizeCoordinatorPayload(binding, requestRaw);
  const value = normalizeCommonResult(
    binding,
    request,
    requestEnvelopeHash,
    raw,
    COORDINATOR_RESULT_FIELDS,
    'p36_durable_coordinator_result',
    'coordinator',
    {
      prepared: 'COORDINATOR_PREPARED',
      cancelled: 'COORDINATOR_CANCELLED',
      unavailable: 'COORDINATOR_RESOLVED_UNAVAILABLE',
      unknown: 'COORDINATOR_RESOLVED_UNKNOWN',
    },
  );
  if (
    value.transaction_id !== request.transaction_id
    || value.fence !== request.fence
    || requireSha256(value.journal_hash, 'durable coordinator journal_hash') !== value.journal_hash
  ) {
    durableError('durable coordinator result does not match the request');
  }
  const allowedStatuses = {
    prepare: ['prepared'],
    cancel: ['cancelled', 'unknown'],
    resolve: ['unavailable', 'unknown'],
  };
  if (!allowedStatuses[request.operation].includes(value.status)) {
    durableError('durable coordinator result status is invalid for the requested operation');
  }
  const expectedStateHash = sha256(canonicalJson({
    transaction_id: request.transaction_id,
    fence: request.fence,
    expected_witness_head: request.expected_witness_head,
    status: value.status,
    journal_hash: value.journal_hash,
  }));
  if (value.state_hash !== expectedStateHash) {
    durableError('durable coordinator state_hash is not an immutable record snapshot');
  }
  return value;
}

function normalizeDurableBrokerResult(bindingRaw, requestRaw, requestEnvelopeHash, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const request = normalizeBrokerPayload(binding, requestRaw);
  return normalizeCommonResult(
    binding,
    request,
    requestEnvelopeHash,
    raw,
    BROKER_RESULT_FIELDS,
    'p36_durable_broker_result',
    'broker',
    { disabled: 'BROKER_EFFECTS_DISABLED' },
  );
}

function normalizeDurableRevocationResult(bindingRaw, requestRaw, requestEnvelopeHash, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const request = normalizeRevocationPayload(binding, requestRaw);
  const value = normalizeCommonResult(
    binding,
    request,
    requestEnvelopeHash,
    raw,
    REVOCATION_RESULT_FIELDS,
    'p36_durable_revocation_result',
    'receipt_verifier',
    { unavailable: 'REVOCATION_UNAVAILABLE' },
  );
  if (value.broker_result_hash !== request.broker_result_hash) {
    durableError('durable revocation result does not bind its broker result');
  }
  return value;
}

function normalizeDurableServiceAvailabilitySnapshot(bindingRaw, role, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  if (!['receipt_verifier', 'witness', 'coordinator'].includes(role)) durableError('durable availability role is unsupported');
  const value = assertExactKeys(raw, new Set(AVAILABILITY_SNAPSHOT_FIELDS), 'durable service availability');
  if (
    value.schema_version !== DURABLE_STATE_SCHEMA_VERSION
    || value.kind !== 'p36_durable_service_availability'
    || value.role !== role
    || value.binding_hash !== sha256(canonicalJson(binding))
    || !['available', 'unavailable', 'unknown', 'quarantined'].includes(value.status)
  ) {
    durableError('durable service availability does not match the frozen binding');
  }
  requireSha256(value.binding_hash, 'durable service availability binding_hash');
  requireSha256(value.journal_hash, 'durable service availability journal_hash');
  const material = { ...value };
  delete material.snapshot_hash;
  if (requireSha256(value.snapshot_hash, 'durable service availability snapshot_hash') !== sha256(canonicalJson(material))) {
    durableError('durable service availability snapshot_hash is invalid');
  }
  return cloneCanonical(value);
}

function normalizeDurableAvailabilityDisclosure(bindingRaw, receiptAnchorRaw, witnessRaw, coordinatorRaw, raw) {
  const binding = normalizeDurableBinding(bindingRaw);
  const receiptAnchor = normalizeDurableServiceAvailabilitySnapshot(binding, 'receipt_verifier', receiptAnchorRaw);
  const witness = normalizeDurableServiceAvailabilitySnapshot(binding, 'witness', witnessRaw);
  const coordinator = normalizeDurableServiceAvailabilitySnapshot(binding, 'coordinator', coordinatorRaw);
  const value = assertExactKeys(raw, new Set(AVAILABILITY_FIELDS), 'durable availability disclosure');
  const expectedStatus = receiptAnchor.status === 'available'
    && witness.status === 'available' && coordinator.status === 'available'
    ? 'available'
    : 'unknown';
  if (
    value.schema_version !== DURABLE_STATE_SCHEMA_VERSION
    || value.kind !== 'p36_durable_availability'
    || value.status !== expectedStatus
    || value.install_binding_hash !== binding.install_binding_hash
    || value.run_binding_hash !== binding.run_binding_hash
    || value.substrate_abi_hash !== binding.substrate_abi_hash
    || value.substrate_plan_hash !== binding.substrate_plan_hash
    || value.durable_abi_hash !== binding.durable_abi_hash
    || value.cohort_id !== binding.cohort_id
    || value.generation !== binding.generation
    || value.receipt_anchor_role !== 'receipt_verifier'
    || value.receipt_anchor_binding_hash !== receiptAnchor.binding_hash
    || value.receipt_anchor_state !== receiptAnchor.status
    || value.receipt_anchor_journal_hash !== receiptAnchor.journal_hash
    || value.receipt_anchor_snapshot_hash !== receiptAnchor.snapshot_hash
    || value.witness_role !== 'witness'
    || value.witness_binding_hash !== witness.binding_hash
    || value.witness_state !== witness.status
    || value.witness_journal_hash !== witness.journal_hash
    || value.witness_snapshot_hash !== witness.snapshot_hash
    || value.coordinator_role !== 'coordinator'
    || value.coordinator_binding_hash !== coordinator.binding_hash
    || value.coordinator_state !== coordinator.status
    || value.coordinator_journal_hash !== coordinator.journal_hash
    || value.coordinator_snapshot_hash !== coordinator.snapshot_hash
    || value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available'
  ) {
    durableError('durable availability disclosure mixes or omits frozen state bindings');
  }
  const material = { ...value };
  delete material.disclosure_hash;
  if (requireSha256(value.disclosure_hash, 'durable availability disclosure_hash') !== sha256(canonicalJson(material))) {
    durableError('durable availability disclosure_hash is invalid');
  }
  return cloneCanonical(value);
}

module.exports = {
  BROKER_OPERATIONS,
  COORDINATOR_OPERATIONS,
  DURABLE_ENDPOINTS,
  DURABLE_STATE_PROTOCOL_VERSION,
  DURABLE_STATE_SCHEMA_VERSION,
  MAX_DURABLE_BATCH_EVENTS,
  MAX_DURABLE_FRAME_BYTES,
  MAX_DURABLE_READBACK_LIMIT,
  RECEIPT_VERIFIER_OPERATIONS,
  RECEIPT_ANCHOR_RECORD_FIELDS,
  SERVICE_ROLES,
  WITNESS_RECEIPT_FIELDS,
  WITNESS_APPEND_OPERATIONS,
  WITNESS_READ_OPERATIONS,
  getSupervisedProductionDurableAbi,
  getSupervisedProductionDurableAbiHash,
  normalizeCoordinatorRequest,
  normalizeDurableAvailabilityDisclosure,
  normalizeDurableBinding,
  normalizeDurableBrokerResult,
  normalizeDurableCoordinatorResult,
  normalizeDurableEnvelope,
  normalizeDurableRevocationResult,
  normalizeDurableServiceAvailabilitySnapshot,
  normalizeDurableWitnessResult,
  normalizeWitnessRequest,
};
