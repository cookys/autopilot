'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const { verifyReceiptShape } = require('./witness');

const OWNER_EVENT_SCHEMA_VERSION = 1;
const EVENT_TYPES = new Set([
  'intent',
  'approval',
  'abort',
  'decision',
  'evidence',
  'checkpoint',
  'acceptance',
  'suspension',
  'principal_change',
  'translation_used',
]);

const EVENT_KEYS = new Set([
  'schema_version',
  'sequence',
  'run_id',
  'type',
  'emitted_at',
  'emitter',
  'policy_hash',
  'contract_hash',
  'authority_hash',
  'payload',
  'prev_event_hash',
  'content_hash',
  'event_hash',
  'witness',
]);

function eventError(message) {
  throw new OwnerKernelError(message, 'INVALID_OWNER_EVENT');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    eventError(`${label} must be a plain object`);
  }
  return value;
}

function assertNoUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      eventError(`${label} has unsupported key "${key}"`);
    }
  }
}

function assertTimestamp(value, label) {
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    eventError(`${label} must be a UTC ISO-8601 timestamp`);
  }
}

function assertEmitter(value, eventType) {
  const emitter = assertPlainObject(value, 'event.emitter');
  assertNoUnknownKeys(emitter, new Set(['kind', 'identity', 'channel']), 'event.emitter');
  if (typeof emitter.kind !== 'string' || typeof emitter.identity !== 'string' || emitter.identity.length === 0
    || typeof emitter.channel !== 'string' || emitter.channel.length === 0) {
    eventError('event.emitter requires non-empty kind, identity, and channel');
  }
  const kind = emitter.kind;
  const valid = (
    ((eventType === 'intent' || eventType === 'approval') && kind === 'user')
    || (eventType === 'abort' && (kind === 'user' || kind === 'kernel'))
    || (eventType === 'decision' && kind === 'owner')
    || (eventType === 'evidence' && (kind === 'kernel' || kind === 'runner'))
    || ((eventType === 'checkpoint' || eventType === 'acceptance') && (kind === 'kernel' || kind === 'runner'))
    || (eventType === 'suspension' && kind === 'kernel')
    || (eventType === 'principal_change' && kind === 'kernel')
    || (eventType === 'translation_used' && kind === 'translation')
  );
  if (!valid) {
    eventError(`event type "${eventType}" cannot be minted by emitter kind "${kind}"`);
  }
  return cloneCanonical(emitter);
}

function eventContent(event) {
  return {
    schema_version: event.schema_version,
    sequence: event.sequence,
    run_id: event.run_id,
    type: event.type,
    emitted_at: event.emitted_at,
    emitter: event.emitter,
    policy_hash: event.policy_hash,
    contract_hash: event.contract_hash,
    ...(Object.prototype.hasOwnProperty.call(event, 'authority_hash')
      ? { authority_hash: event.authority_hash }
      : {}),
    payload: event.payload,
  };
}

function prepareEvent({
  sequence,
  runId,
  type,
  emittedAt,
  emitter,
  policyHash,
  contractHash,
  authorityHash,
  payload,
  prevEventHash,
}) {
  const event = {
    schema_version: OWNER_EVENT_SCHEMA_VERSION,
    sequence,
    run_id: runId,
    type,
    emitted_at: emittedAt,
    emitter,
    policy_hash: policyHash,
    contract_hash: contractHash,
    ...(authorityHash === undefined ? {} : { authority_hash: authorityHash }),
    payload: cloneCanonical(payload),
    prev_event_hash: prevEventHash,
  };
  validateEventShape(event, { expectedSequence: sequence, expectedPrevEventHash: prevEventHash });
  event.content_hash = sha256(canonicalJson(eventContent(event)));
  event.event_hash = sha256(canonicalJson({
    content_hash: event.content_hash,
    prev_event_hash: event.prev_event_hash,
  }));
  return cloneCanonical(event);
}

function buildEvent({
  sequence,
  runId,
  type,
  emittedAt,
  emitter,
  policyHash,
  contractHash,
  authorityHash,
  payload,
  prevEventHash,
  witness,
}) {
  const event = prepareEvent({
    sequence,
    runId,
    type,
    emittedAt,
    emitter,
    policyHash,
    contractHash,
    authorityHash,
    payload,
    prevEventHash,
  });
  event.witness = cloneCanonical(witness);
  validateEventShape(event, { expectedSequence: sequence, expectedPrevEventHash: prevEventHash });
  return cloneCanonical(event);
}

function validateEventShape(event, options = {}) {
  const value = assertPlainObject(event, 'event');
  assertNoUnknownKeys(value, EVENT_KEYS, 'event');
  if (value.schema_version !== OWNER_EVENT_SCHEMA_VERSION) {
    eventError(`event.schema_version must equal ${OWNER_EVENT_SCHEMA_VERSION}`);
  }
  if (!Number.isInteger(value.sequence) || value.sequence < 1) {
    eventError('event.sequence must be a positive integer');
  }
  if (options.expectedSequence !== undefined && value.sequence !== options.expectedSequence) {
    eventError('event.sequence does not match expected sequence');
  }
  if (typeof value.run_id !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(value.run_id)) {
    eventError('event.run_id is invalid');
  }
  if (typeof value.type !== 'string' || !EVENT_TYPES.has(value.type)) {
    eventError('event.type is invalid');
  }
  assertTimestamp(value.emitted_at, 'event.emitted_at');
  assertEmitter(value.emitter, value.type);
  if (!isSha256(value.policy_hash) || !isSha256(value.contract_hash)) {
    eventError('event policy_hash and contract_hash must be SHA-256 digests');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'authority_hash') && !isSha256(value.authority_hash)) {
    eventError('event.authority_hash must be a SHA-256 digest when present');
  }
  assertPlainObject(value.payload, 'event.payload');
  canonicalJson(value.payload);
  if (value.prev_event_hash !== null && !isSha256(value.prev_event_hash)) {
    eventError('event.prev_event_hash must be null or a SHA-256 digest');
  }
  if (options.expectedPrevEventHash !== undefined && value.prev_event_hash !== options.expectedPrevEventHash) {
    eventError('event.prev_event_hash does not match prior event');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'content_hash')) {
    if (!isSha256(value.content_hash)) {
      eventError('event.content_hash must be a SHA-256 digest');
    }
    const expectedContentHash = sha256(canonicalJson(eventContent(value)));
    if (value.content_hash !== expectedContentHash) {
      eventError('event.content_hash does not match event content');
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'event_hash')) {
    if (!isSha256(value.event_hash) || !Object.prototype.hasOwnProperty.call(value, 'content_hash')) {
      eventError('event.event_hash requires a valid content_hash');
    }
    const expectedEventHash = sha256(canonicalJson({
      content_hash: value.content_hash,
      prev_event_hash: value.prev_event_hash,
    }));
    if (value.event_hash !== expectedEventHash) {
      eventError('event.event_hash does not match event content hash chain');
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'witness')) {
    if (!Object.prototype.hasOwnProperty.call(value, 'event_hash')) {
      eventError('event.witness requires event_hash');
    }
    verifyReceiptShape(value.witness, {
      run_id: value.run_id,
      sequence: value.sequence,
      event_hash: value.event_hash,
    });
  } else if (options.requireWitness) {
    eventError('authoritative event requires a witness receipt');
  }
  return true;
}

function verifyEvent(event, { header, previousEventHash, previousWitnessHead, witness } = {}) {
  validateEventShape(event, {
    expectedSequence: header ? header.event_count + 1 : undefined,
    expectedPrevEventHash: previousEventHash,
    requireWitness: true,
  });
  if (header) {
    if (event.run_id !== header.run_id
      || event.policy_hash !== header.policy_hash
      || event.contract_hash !== header.contract_hash
      || event.witness.stream_id !== header.witness_stream_id) {
      eventError('event does not belong to the ledger header run, policy, contract, or witness stream');
    }
    if (header.authority_hash === undefined) {
      if (Object.prototype.hasOwnProperty.call(event, 'authority_hash')) {
        eventError('legacy ledger event must not contain authority_hash');
      }
    } else if (!Object.prototype.hasOwnProperty.call(event, 'authority_hash')
      || event.authority_hash !== header.authority_hash) {
      eventError('event authority_hash does not match the ledger authority commitment');
    }
  }
  if (event.witness.previous_witness_head !== previousWitnessHead) {
    eventError('event witness receipt does not chain to the previous witnessed head');
  }
  if (witness && !witness.verify(event.witness)) {
    throw new OwnerKernelError('external witness rejected event receipt', 'WITNESS_REJECTED');
  }
  return true;
}

module.exports = {
  EVENT_TYPES,
  OWNER_EVENT_SCHEMA_VERSION,
  buildEvent,
  eventContent,
  prepareEvent,
  validateEventShape,
  verifyEvent,
};
