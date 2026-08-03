'use strict';
// Bounded framed IPC for the installed U5 Kernel path.
// Frames are length-prefixed canonical JSON with nonce/TTL/replay fences.
// Peer credentials and cgroup checks are enforced by the Python transport;
// this module owns the Node-side frame codec and envelope construction.
const crypto = require('crypto');
const net = require('net');
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
const {
  INSTALLED_ENDPOINTS,
  INSTALLED_PROTOCOL_VERSION,
  INSTALLED_SCHEMA_VERSION,
  MAX_FUTURE_SKEW_MILLISECONDS,
  MAX_INSTALLED_FRAME_BYTES,
  MAX_MESSAGE_LIFETIME_MILLISECONDS,
  getInstalledEndpoint,
  normalizeInstalledBinding,
  normalizeInstalledEnvelope,
} = require('./supervised-owner-kernel-installed-contract');
const REQUEST_KIND = 'p37_installed_transport_request';
const RESPONSE_KIND = 'p37_installed_transport_response';
const FRAME_TIMEOUT_MILLISECONDS = 5000;
const DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 15000;
function ipcError(message, code = 'INSTALLED_IPC_ERROR') {
  throw new OwnerKernelError(message, code);}
function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    ipcError(`${label} must be a plain object`);}
  return value;}
function randomNonceHash() {
  return sha256(crypto.randomBytes(32).toString('hex'));}
function authenticationProofHash({
  binding,
  endpoint,
  sender,
  recipient,
  envelopeFields,
}) {
  return sha256(canonicalJson({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: 'p37_installed_peer_transcript',
    install_binding_hash: binding.install_binding_hash,
    run_binding_hash: binding.run_binding_hash,
    installed_abi_hash: binding.installed_abi_hash,
    cohort_id: binding.cohort_id,
    generation: binding.generation,
    endpoint_id: endpoint.endpoint_id,
    sender_role: sender.role,
    sender_identity: sender.identity,
    sender_attestation_hash: sender.attestation_hash,
    sender_cgroup_binding_hash: sender.cgroup_binding_hash,
    recipient_role: recipient.role,
    recipient_identity: recipient.identity,
    recipient_attestation_hash: recipient.attestation_hash,
    recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
    envelope: envelopeFields,
  }));}
function createInstalledEnvelope(bindingRaw, endpointId, payload, {
  now = () => Date.now(),
  nonceHash = null,
} = {}) {
  const binding = normalizeInstalledBinding(bindingRaw);
  const endpoint = getInstalledEndpoint(endpointId);
  const payloadObject = assertPlainObject(payload, 'installed IPC payload');
  const operation = payloadObject.operation;
  if (typeof operation !== 'string' || !endpoint.operations.includes(operation)) {
    ipcError('installed IPC payload operation is not allowed on this endpoint');}
  const sender = binding.service_bindings[endpoint.sender_role];
  const recipient = binding.service_bindings[endpoint.recipient_role];
  const issuedAt = now();
  const expiresAt = issuedAt + MAX_MESSAGE_LIFETIME_MILLISECONDS;
  const payloadHash = sha256(canonicalJson(payloadObject));
  const nonce = nonceHash || randomNonceHash();
  const partial = {
    schema_version: INSTALLED_SCHEMA_VERSION,
    protocol_version: INSTALLED_PROTOCOL_VERSION,
    endpoint_id: endpoint.endpoint_id,
    request_id: typeof payloadObject.request_id === 'string'
      ? payloadObject.request_id
      : `req-${nonce.slice(0, 16)}`,
    operation,
    sender_role: sender.role,
    sender_identity: sender.identity,
    sender_attestation_hash: sender.attestation_hash,
    sender_cgroup_binding_hash: sender.cgroup_binding_hash,
    recipient_role: recipient.role,
    recipient_identity: recipient.identity,
    recipient_attestation_hash: recipient.attestation_hash,
    recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
    install_binding_hash: binding.install_binding_hash,
    run_binding_hash: binding.run_binding_hash,
    installed_abi_hash: binding.installed_abi_hash,
    cohort_id: binding.cohort_id,
    generation: binding.generation,
    issued_at_ms: issuedAt,
    expires_at_ms: expiresAt,
    nonce_hash: nonce,
    payload_hash: payloadHash,};
  const proof = authenticationProofHash({
    binding,
    endpoint,
    sender,
    recipient,
    envelopeFields: partial,
  });
  const envelope = {
    ...partial,
    authentication_proof_hash: proof,};
  return normalizeInstalledEnvelope(binding, envelope, { now: () => issuedAt });}
function createInstalledRequest(bindingRaw, endpointId, payload, options) {
  const envelope = createInstalledEnvelope(bindingRaw, endpointId, payload, options);
  return cloneCanonical({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: REQUEST_KIND,
    envelope,
    payload: cloneCanonical(payload),
  });}
function encodeFrame(value) {
  const body = Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
  if (body.length > MAX_INSTALLED_FRAME_BYTES) {
    ipcError('installed IPC frame exceeds the maximum byte budget', 'FRAME_TOO_LARGE');}
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);}
function decodeFrame(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < 4) {
    ipcError('installed IPC frame is truncated', 'FRAME_INVALID');}
  const size = frame.readUInt32BE(0);
  if (size < 2 || size > MAX_INSTALLED_FRAME_BYTES || frame.length !== size + 4) {
    ipcError('installed IPC frame length is invalid', 'FRAME_INVALID');}
  const body = frame.subarray(4);
  if (body[body.length - 1] !== 0x0a) {
    ipcError('installed IPC frame is not newline-terminated', 'FRAME_INVALID');}
  let parsed;
  try {
    parsed = JSON.parse(body.subarray(0, body.length - 1).toString('utf8'));
  } catch (error) {
    ipcError('installed IPC frame is not valid JSON', 'FRAME_INVALID');}
  if (canonicalJson(parsed) + '\n' !== body.toString('utf8')) {
    ipcError('installed IPC frame is not canonical JSON', 'FRAME_INVALID');}
  return parsed;}
function createReplayFence() {
  const seen = new Set();
  return Object.freeze({
    observe(nonceHash) {
      if (typeof nonceHash !== 'string' || !/^[0-9a-f]{64}$/.test(nonceHash)) {
        ipcError('installed IPC nonce_hash is invalid', 'REPLAY_FENCE');}
      if (seen.has(nonceHash)) {
        ipcError('installed IPC nonce has already been consumed', 'REPLAY_DETECTED');}
      seen.add(nonceHash);
      return true;
    },
    size() {
      return seen.size;
    },
  });}
function normalizeInstalledResponse(raw, { request, binding, now = () => Date.now() } = {}) {
  const value = assertPlainObject(raw, 'installed IPC response');
  if (value.schema_version !== INSTALLED_SCHEMA_VERSION || value.kind !== RESPONSE_KIND) {
    ipcError('installed IPC response has an unsupported schema or kind');}
  if (value.request_id !== request.envelope.request_id
    || value.operation !== request.envelope.operation
    || value.endpoint_id !== request.envelope.endpoint_id) {
    ipcError('installed IPC response does not bind the request');}
  const envelope = normalizeInstalledEnvelope(binding, value.envelope || request.envelope, { now });
  if (envelope.request_id !== request.envelope.request_id) {
    ipcError('installed IPC response envelope request_id drifted');}
  assertPlainObject(value.result, 'installed IPC response result');
  return cloneCanonical({
    schema_version: INSTALLED_SCHEMA_VERSION,
    kind: RESPONSE_KIND,
    endpoint_id: value.endpoint_id,
    request_id: value.request_id,
    operation: value.operation,
    envelope,
    result: cloneCanonical(value.result),
    result_hash: sha256(canonicalJson(value.result)),
  });}
function invokeUnixRequest(socketPath, request, {
  timeoutMilliseconds = DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
} = {}) {
  if (typeof socketPath !== 'string' || !socketPath.startsWith('/')) {
    ipcError('installed IPC socket path must be absolute');}
  const frame = encodeFrame(request);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      fail(new OwnerKernelError('installed IPC request timed out', 'IPC_TIMEOUT'));
    }, timeoutMilliseconds);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error);}
    function succeed(value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      resolve(value);}
    socket.setTimeout(timeoutMilliseconds);
    socket.on('connect', () => {
      socket.write(frame);
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const size = buffer.readUInt32BE(0);
      if (size > MAX_INSTALLED_FRAME_BYTES) {
        fail(new OwnerKernelError('installed IPC response frame is too large', 'FRAME_TOO_LARGE'));
        return;}
      if (buffer.length < size + 4) return;
      try {
        succeed(decodeFrame(buffer.subarray(0, size + 4)));
      } catch (error) {
        fail(error);}
    });
    socket.on('timeout', () => {
      fail(new OwnerKernelError('installed IPC socket timed out', 'IPC_TIMEOUT'));
    });
    socket.on('error', (error) => {
      fail(new OwnerKernelError(`installed IPC socket error: ${error.message}`, 'IPC_SOCKET_ERROR'));
    });
    socket.on('close', () => {
      if (!settled) {
        fail(new OwnerKernelError('installed IPC socket closed before a response', 'IPC_CLOSED'));}
    });
  });}
module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MILLISECONDS,
  FRAME_TIMEOUT_MILLISECONDS,
  INSTALLED_ENDPOINTS,
  MAX_FUTURE_SKEW_MILLISECONDS,
  MAX_INSTALLED_FRAME_BYTES,
  MAX_MESSAGE_LIFETIME_MILLISECONDS,
  REQUEST_KIND,
  RESPONSE_KIND,
  authenticationProofHash,
  createInstalledEnvelope,
  createInstalledRequest,
  createReplayFence,
  decodeFrame,
  encodeFrame,
  invokeUnixRequest,
  normalizeInstalledResponse,
  randomNonceHash,};
