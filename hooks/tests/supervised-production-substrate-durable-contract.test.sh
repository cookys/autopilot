#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');

const root = process.argv[2];
const durable = require(path.join(root, 'src', 'engine', 'supervised-production-substrate-durable-contract'));
const engine = require(path.join(root, 'src', 'engine'));
const { OwnerKernelError, canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const NOW = 2000000000000;
const hash = (value) => sha256(value);

function binding() {
  const roles = ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator'];
  return {
    schema_version: 1,
    kind: 'p36_durable_state_binding',
    install_binding_hash: hash('install'),
    run_binding_hash: hash('run'),
    substrate_abi_hash: hash('substrate-abi'),
    substrate_plan_hash: hash('substrate-plan'),
    durable_abi_hash: durable.getSupervisedProductionDurableAbiHash(),
    cohort_id: 'cohort-p36',
    generation: 1,
    service_bindings: Object.fromEntries(roles.map((role, index) => [role, {
      role,
      identity: `p36-${role}`,
      uid: 71000 + index,
      gid: 72000 + index,
      attestation_hash: hash(`attestation:${role}`),
      cgroup_binding_hash: hash(`cgroup:${role}`),
    }])),
  };
}

function reject(callback, code, label) {
  assert.throws(callback, (error) => error instanceof OwnerKernelError
    && (code === undefined || error.code === code), label);
}

function envelope(bound, endpointId, request, overrides = {}) {
  const endpoint = durable.DURABLE_ENDPOINTS.find((item) => item.endpoint_id === endpointId);
  const sender = bound.service_bindings[endpoint.sender_role];
  const recipient = bound.service_bindings[endpoint.recipient_role];
  return {
    schema_version: 1,
    protocol_version: 1,
    endpoint_id: endpointId,
    request_id: request.request_id,
    operation: request.operation,
    sender_role: endpoint.sender_role,
    sender_identity: sender.identity,
    sender_attestation_hash: sender.attestation_hash,
    sender_cgroup_binding_hash: sender.cgroup_binding_hash,
    recipient_role: endpoint.recipient_role,
    recipient_identity: recipient.identity,
    recipient_attestation_hash: recipient.attestation_hash,
    recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
    install_binding_hash: bound.install_binding_hash,
    run_binding_hash: bound.run_binding_hash,
    substrate_abi_hash: bound.substrate_abi_hash,
    substrate_plan_hash: bound.substrate_plan_hash,
    durable_abi_hash: bound.durable_abi_hash,
    cohort_id: bound.cohort_id,
    generation: bound.generation,
    issued_at_ms: NOW - 10,
    expires_at_ms: NOW + 1000,
    nonce_hash: hash(`nonce:${request.request_id}`),
    authentication_proof_hash: hash(`proof:${request.request_id}`),
    payload_hash: hash(canonicalJson(request)),
    ...overrides,
  };
}

const rawBinding = binding();
const bound = durable.normalizeDurableBinding(rawBinding);
assert.equal(engine.getSupervisedProductionDurableAbiHash, durable.getSupervisedProductionDurableAbiHash);
assert.equal(bound.durable_abi_hash, durable.getSupervisedProductionDurableAbiHash());
assert.equal(durable.DURABLE_ENDPOINTS.length, 5);
assert.deepEqual(durable.DURABLE_ENDPOINTS.map((item) => item.endpoint_id), [
  'worker_broker',
  'receipt_verifier_witness',
  'receipt_verifier_coordinator',
  'coordinator_witness',
  'broker_receipt_verifier',
]);
assert.equal(durable.MAX_DURABLE_FRAME_BYTES > 8192, true);

const append = {
  schema_version: 1,
  request_id: 'append-p36',
  operation: 'appendIfHead',
  stream_id: 'stream-p36',
  expected_head: null,
  event_hash: hash('event'),
  event_payload_hash: hash('payload'),
  substrate_plan_hash: bound.substrate_plan_hash,
};
const appendEnvelope = envelope(bound, 'receipt_verifier_witness', append);
const normalizedAppend = durable.normalizeWitnessRequest(bound, appendEnvelope, append, { now: () => NOW });
assert.deepEqual(normalizedAppend.request, append);
assert.equal(normalizedAppend.envelope.endpoint_id, 'receipt_verifier_witness');

const batch = {
  schema_version: 1,
  request_id: 'batch-p36',
  operation: 'appendBatchIfHead',
  stream_id: 'stream-p36',
  expected_head: hash('head'),
  events: [
    { event_hash: hash('event-1'), event_payload_hash: hash('payload-1') },
    { event_hash: hash('event-2'), event_payload_hash: hash('payload-2') },
  ],
  substrate_plan_hash: bound.substrate_plan_hash,
};
assert.equal(
  durable.normalizeWitnessRequest(bound, envelope(bound, 'receipt_verifier_witness', batch), batch, { now: () => NOW }).request.events.length,
  2,
);
const duplicateBatch = structuredClone(batch);
duplicateBatch.events[1].event_hash = duplicateBatch.events[0].event_hash;
reject(
  () => durable.normalizeWitnessRequest(bound, envelope(bound, 'receipt_verifier_witness', duplicateBatch), duplicateBatch, { now: () => NOW }),
  undefined,
  'duplicate batch hashes are rejected',
);
reject(
  () => durable.normalizeWitnessRequest(bound, envelope(bound, 'coordinator_witness', append), append, { now: () => NOW }),
  undefined,
  'append cannot use the coordinator read endpoint',
);
const badEnvelope = { ...appendEnvelope, payload_hash: hash('wrong') };
reject(
  () => durable.normalizeWitnessRequest(bound, badEnvelope, append, { now: () => NOW }),
  undefined,
  'payload substitution is rejected',
);

const readback = {
  schema_version: 1,
  request_id: 'readback-p36',
  operation: 'readback',
  stream_id: 'stream-p36',
  from_sequence: 1,
  limit: 1024,
  substrate_plan_hash: bound.substrate_plan_hash,
};
assert.equal(
  durable.normalizeWitnessRequest(bound, envelope(bound, 'coordinator_witness', readback), readback, { now: () => NOW }).request.limit,
  1024,
);

const coordinator = {
  schema_version: 1,
  request_id: 'prepare-p36',
  operation: 'prepare',
  transaction_id: 'transaction-p36',
  fence: 1,
  expected_witness_head: hash('witness-head'),
  substrate_plan_hash: bound.substrate_plan_hash,
};
assert.equal(
  durable.normalizeCoordinatorRequest(bound, envelope(bound, 'receipt_verifier_coordinator', coordinator), coordinator, { now: () => NOW }).request.fence,
  1,
);
const commit = { ...coordinator, operation: 'commit' };
reject(
  () => durable.normalizeCoordinatorRequest(bound, envelope(bound, 'receipt_verifier_coordinator', commit), commit, { now: () => NOW }),
  undefined,
  'commit is absent from the durable coordinator ABI',
);

const broker = {
  schema_version: 1,
  request_id: 'broker-p36',
  operation: 'execute',
  substrate_plan_hash: bound.substrate_plan_hash,
};
assert.equal(
  durable.normalizeDurableEnvelope(bound, envelope(bound, 'worker_broker', broker), { now: () => NOW }).recipient_role,
  'broker',
);
const oldProbeSized = 8192;
assert.equal(durable.getSupervisedProductionDurableAbi().max_frame_bytes > oldProbeSized, true);
assert.deepEqual(
  durable.getSupervisedProductionDurableAbi().coordinator.forbidden_operations,
  ['commit', 'accept'],
);
assert.equal(
  durable.getSupervisedProductionDurableAbi().availability.authority.effect_authority,
  'none',
);
assert.equal(
  durable.getSupervisedProductionDurableAbi().receipt_verifier.receipt_anchor,
  'internal_witness_response_commitment_only',
);

function commonResult(request, envelopeHash, role, kind, status, code) {
  const responder = bound.service_bindings[role];
  return {
    schema_version: 1,
    kind,
    status,
    code,
    request_id: request.request_id,
    operation: request.operation,
    install_binding_hash: bound.install_binding_hash,
    run_binding_hash: bound.run_binding_hash,
    substrate_abi_hash: bound.substrate_abi_hash,
    substrate_plan_hash: bound.substrate_plan_hash,
    durable_abi_hash: bound.durable_abi_hash,
    cohort_id: bound.cohort_id,
    generation: bound.generation,
    request_hash: hash(canonicalJson(request)),
    request_envelope_hash: envelopeHash,
    responder_role: role,
    responder_identity: responder.identity,
    responder_attestation_hash: responder.attestation_hash,
    responder_cgroup_binding_hash: responder.cgroup_binding_hash,
    owner_kernel_authority: 'none',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
  };
}

function bindResultHash(value, field = 'result_hash') {
  const material = { ...value };
  delete material[field];
  return { ...value, [field]: hash(canonicalJson(material)) };
}

const receipt = {
  sequence: 1,
  event_hash: append.event_hash,
  event_payload_hash: append.event_payload_hash,
  previous_head: null,
  request_hash: hash(canonicalJson(append)),
};
receipt.head = hash(canonicalJson({
  schema_version: 1,
  kind: 'p36_durable_witness_receipt',
  stream_id: append.stream_id,
  sequence: receipt.sequence,
  previous_head: receipt.previous_head,
  event_hash: receipt.event_hash,
  event_payload_hash: receipt.event_payload_hash,
  request_hash: receipt.request_hash,
}));
const witnessResult = bindResultHash({
  ...commonResult(append, hash(canonicalJson(appendEnvelope)), 'witness', 'p36_durable_witness_result', 'recorded', 'WITNESS_RECORDED'),
  stream_id: append.stream_id,
  head: receipt.head,
  sequence: 1,
  records: [receipt],
  journal_hash: hash('witness-journal'),
});
assert.deepEqual(
  durable.normalizeDurableWitnessResult(bound, append, hash(canonicalJson(appendEnvelope)), witnessResult),
  witnessResult,
);
reject(
  () => durable.normalizeDurableWitnessResult(
    bound,
    append,
    hash(canonicalJson(appendEnvelope)),
    { ...witnessResult, result_hash: hash('tampered-result') },
  ),
  undefined,
  'witness result hashes are exact',
);
const forgedReceipt = {
  ...receipt,
  event_hash: hash('forged-event'),
};
forgedReceipt.head = hash(canonicalJson({
  schema_version: 1,
  kind: 'p36_durable_witness_receipt',
  stream_id: append.stream_id,
  sequence: forgedReceipt.sequence,
  previous_head: forgedReceipt.previous_head,
  event_hash: forgedReceipt.event_hash,
  event_payload_hash: forgedReceipt.event_payload_hash,
  request_hash: forgedReceipt.request_hash,
}));
const forgedWitnessResult = bindResultHash({
  ...witnessResult,
  head: forgedReceipt.head,
  records: [forgedReceipt],
});
reject(
  () => durable.normalizeDurableWitnessResult(
    bound,
    append,
    hash(canonicalJson(appendEnvelope)),
    forgedWitnessResult,
  ),
  undefined,
  'witness result receipts must match the requested event set',
);
const readbackEnvelope = envelope(bound, 'coordinator_witness', readback);
const readbackResult = bindResultHash({
  ...commonResult(
    readback,
    hash(canonicalJson(readbackEnvelope)),
    'witness',
    'p36_durable_witness_result',
    'available',
    'WITNESS_AVAILABLE',
  ),
  stream_id: readback.stream_id,
  head: receipt.head,
  sequence: 1,
  records: [receipt],
  journal_hash: hash('readback-journal'),
});
assert.deepEqual(
  durable.normalizeDurableWitnessResult(
    bound,
    readback,
    hash(canonicalJson(readbackEnvelope)),
    readbackResult,
  ),
  readbackResult,
);
const truncatedReadbackResult = bindResultHash({
  ...readbackResult,
  records: [],
});
reject(
  () => durable.normalizeDurableWitnessResult(
    bound,
    readback,
    hash(canonicalJson(readbackEnvelope)),
    truncatedReadbackResult,
  ),
  undefined,
  'readback result must include the exact requested sequence range',
);
const emptyHeadRequest = {
  schema_version: 1,
  request_id: 'empty-head-p36',
  operation: 'getHead',
  stream_id: append.stream_id,
  substrate_plan_hash: bound.substrate_plan_hash,
};
const emptyHeadEnvelope = envelope(bound, 'coordinator_witness', emptyHeadRequest);
const incoherentEmptyHeadResult = bindResultHash({
  ...commonResult(
    emptyHeadRequest,
    hash(canonicalJson(emptyHeadEnvelope)),
    'witness',
    'p36_durable_witness_result',
    'available',
    'WITNESS_AVAILABLE',
  ),
  stream_id: emptyHeadRequest.stream_id,
  head: hash('impossible-empty-head'),
  sequence: 0,
  records: [],
  journal_hash: hash('empty-head-journal'),
});
reject(
  () => durable.normalizeDurableWitnessResult(
    bound,
    emptyHeadRequest,
    hash(canonicalJson(emptyHeadEnvelope)),
    incoherentEmptyHeadResult,
  ),
  undefined,
  'empty witness streams cannot report a non-null head',
);

const coordinatorEnvelope = envelope(bound, 'receipt_verifier_coordinator', coordinator);
const coordinatorJournalHash = hash('coordinator-journal');
const coordinatorResult = bindResultHash({
  ...commonResult(
    coordinator,
    hash(canonicalJson(coordinatorEnvelope)),
    'coordinator',
    'p36_durable_coordinator_result',
    'prepared',
    'COORDINATOR_PREPARED',
  ),
  transaction_id: coordinator.transaction_id,
  fence: coordinator.fence,
  state_hash: hash(canonicalJson({
    transaction_id: coordinator.transaction_id,
    fence: coordinator.fence,
    expected_witness_head: coordinator.expected_witness_head,
    status: 'prepared',
    journal_hash: coordinatorJournalHash,
  })),
  journal_hash: coordinatorJournalHash,
});
assert.deepEqual(
  durable.normalizeDurableCoordinatorResult(
    bound,
    coordinator,
    hash(canonicalJson(coordinatorEnvelope)),
    coordinatorResult,
  ),
  coordinatorResult,
);
const forgedCoordinatorResult = bindResultHash({
  ...coordinatorResult,
  status: 'cancelled',
  code: 'COORDINATOR_CANCELLED',
  state_hash: hash(canonicalJson({
    transaction_id: coordinator.transaction_id,
    fence: coordinator.fence,
    expected_witness_head: coordinator.expected_witness_head,
    status: 'cancelled',
    journal_hash: coordinatorJournalHash,
  })),
});
reject(
  () => durable.normalizeDurableCoordinatorResult(
    bound,
    coordinator,
    hash(canonicalJson(coordinatorEnvelope)),
    forgedCoordinatorResult,
  ),
  undefined,
  'coordinator result status must match the requested operation',
);
const unknownCancel = {
  ...coordinator,
  request_id: 'unknown-cancel-p36',
  operation: 'cancel',
  transaction_id: 'unknown-transaction-p36',
  fence: 2,
};
const unknownCancelEnvelope = envelope(bound, 'receipt_verifier_coordinator', unknownCancel);
const unknownCancelJournalHash = hash('unknown-cancel-journal');
const unknownCancelResult = bindResultHash({
  ...commonResult(
    unknownCancel,
    hash(canonicalJson(unknownCancelEnvelope)),
    'coordinator',
    'p36_durable_coordinator_result',
    'unknown',
    'COORDINATOR_RESOLVED_UNKNOWN',
  ),
  transaction_id: unknownCancel.transaction_id,
  fence: unknownCancel.fence,
  state_hash: hash(canonicalJson({
    transaction_id: unknownCancel.transaction_id,
    fence: unknownCancel.fence,
    expected_witness_head: unknownCancel.expected_witness_head,
    status: 'unknown',
    journal_hash: unknownCancelJournalHash,
  })),
  journal_hash: unknownCancelJournalHash,
});
assert.deepEqual(
  durable.normalizeDurableCoordinatorResult(
    bound,
    unknownCancel,
    hash(canonicalJson(unknownCancelEnvelope)),
    unknownCancelResult,
  ),
  unknownCancelResult,
);

const brokerEnvelope = envelope(bound, 'worker_broker', broker);
const brokerResult = bindResultHash({
  ...commonResult(
    broker,
    hash(canonicalJson(brokerEnvelope)),
    'broker',
    'p36_durable_broker_result',
    'disabled',
    'BROKER_EFFECTS_DISABLED',
  ),
});
assert.deepEqual(
  durable.normalizeDurableBrokerResult(bound, broker, hash(canonicalJson(brokerEnvelope)), brokerResult),
  brokerResult,
);

const revocation = {
  schema_version: 1,
  request_id: 'revocation-p36',
  operation: 'check_revocation',
  broker_result_hash: brokerResult.result_hash,
  substrate_plan_hash: bound.substrate_plan_hash,
};
const revocationEnvelope = envelope(bound, 'broker_receipt_verifier', revocation);
const revocationResult = bindResultHash({
  ...commonResult(
    revocation,
    hash(canonicalJson(revocationEnvelope)),
    'receipt_verifier',
    'p36_durable_revocation_result',
    'unavailable',
    'REVOCATION_UNAVAILABLE',
  ),
  broker_result_hash: brokerResult.result_hash,
});
assert.deepEqual(
  durable.normalizeDurableRevocationResult(
    bound,
    revocation,
    hash(canonicalJson(revocationEnvelope)),
    revocationResult,
  ),
  revocationResult,
);

function availabilitySnapshot(role, state, journalHash) {
  return bindResultHash({
    schema_version: 1,
    kind: 'p36_durable_service_availability',
    role,
    binding_hash: hash(canonicalJson(bound)),
    status: state,
    journal_hash: journalHash,
  }, 'snapshot_hash');
}

const receiptAnchorSnapshot = availabilitySnapshot('receipt_verifier', 'available', hash('receipt-anchor-journal'));
const witnessSnapshot = availabilitySnapshot('witness', 'available', witnessResult.journal_hash);
const coordinatorSnapshot = availabilitySnapshot('coordinator', 'available', coordinatorResult.journal_hash);
const disclosure = bindResultHash({
  schema_version: 1,
  kind: 'p36_durable_availability',
  status: 'available',
  install_binding_hash: bound.install_binding_hash,
  run_binding_hash: bound.run_binding_hash,
  substrate_abi_hash: bound.substrate_abi_hash,
  substrate_plan_hash: bound.substrate_plan_hash,
  durable_abi_hash: bound.durable_abi_hash,
  cohort_id: bound.cohort_id,
  generation: bound.generation,
  receipt_anchor_role: 'receipt_verifier',
  receipt_anchor_binding_hash: receiptAnchorSnapshot.binding_hash,
  receipt_anchor_state: receiptAnchorSnapshot.status,
  receipt_anchor_journal_hash: receiptAnchorSnapshot.journal_hash,
  receipt_anchor_snapshot_hash: receiptAnchorSnapshot.snapshot_hash,
  witness_role: 'witness',
  witness_binding_hash: witnessSnapshot.binding_hash,
  witness_state: witnessSnapshot.status,
  witness_journal_hash: witnessSnapshot.journal_hash,
  witness_snapshot_hash: witnessSnapshot.snapshot_hash,
  coordinator_role: 'coordinator',
  coordinator_binding_hash: coordinatorSnapshot.binding_hash,
  coordinator_state: coordinatorSnapshot.status,
  coordinator_journal_hash: coordinatorSnapshot.journal_hash,
  coordinator_snapshot_hash: coordinatorSnapshot.snapshot_hash,
  owner_kernel_authority: 'none',
  effect_authority: 'none',
  broker_authority: 'disabled',
  acceptance: 'not_available',
}, 'disclosure_hash');
assert.deepEqual(
  durable.normalizeDurableAvailabilityDisclosure(
    bound, receiptAnchorSnapshot, witnessSnapshot, coordinatorSnapshot, disclosure,
  ),
  disclosure,
);
reject(
  () => durable.normalizeDurableAvailabilityDisclosure(
    bound,
    { ...receiptAnchorSnapshot, binding_hash: hash('foreign-binding') },
    witnessSnapshot,
    coordinatorSnapshot,
    disclosure,
  ),
  undefined,
  'availability cannot mix a foreign cohort snapshot',
);

console.log('durable_topology_frozen=true');
console.log('durable_frame_bound_separate=true');
console.log('durable_request_binding=true');
console.log('durable_nonacceptance=true');
console.log('durable_result_receipts=true');
NODE
)"
STATUS=$?

assert_eq "$STATUS" "0" "P3.6 durable contract fixture exits successfully"
assert_contains "$OUT" "durable_topology_frozen=true" "durable routes include the broker-to-verifier handshake"
assert_contains "$OUT" "durable_frame_bound_separate=true" "durable transport does not reuse the P2b frame ceiling"
assert_contains "$OUT" "durable_request_binding=true" "durable envelopes bind exact canonical request payloads"
assert_contains "$OUT" "durable_nonacceptance=true" "durable coordinator remains explicitly non-accepting"
assert_contains "$OUT" "durable_result_receipts=true" "durable result, receipt, revocation, and availability shapes are verified"

finalize_test
