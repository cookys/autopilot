#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const contract = require(path.join(root, 'src', 'engine', 'supervised-production-substrate-contract'));
const publicEngine = require(path.join(root, 'src', 'engine'));
const { OwnerKernelError, canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const NOW = 2000000000000;
const hash = (value) => sha256(value);

function service(role, index) {
  return {
    role,
    identity: `p36-${role}`,
    uid: 61000 + index,
    gid: 62000 + index,
    attestation_hash: hash(`attestation:${role}`),
    cgroup_binding_hash: hash(`cgroup:${role}`),
  };
}

function trustedBinding(overrides = {}) {
  return {
    schema_version: 2,
    owner_run_id: 'owner-run-p36',
    engine_run_id: 'engine-run-p36',
    invocation_id: 'invocation-p36',
    policy_hash: hash('policy-p36'),
    contract_hash: hash('contract-p36'),
    immutable_base: 'a'.repeat(40),
    workspace_registration_id: 'workspace-p36',
    workspace_root_hash: hash('workspace-root-p36'),
    workspace_descriptor_binding_hash: hash('descriptor-p36'),
    workspace_ticket_hash: hash('ticket-p36'),
    prompt_hash: hash('prompt-p36'),
    branch_hash: hash('branch-p36'),
    verify_command_hash: hash('verify-p36'),
    sink_inventory_hash: hash('sinks-p36'),
    bridge_abi_hash: hash('bridge-abi-p36'),
    ...overrides,
  };
}

const authority = {
  issuer: 'p36-owner-control',
  key_id: 'p36-owner-key',
  attestation_hash: hash('p36-owner-attestation'),
  install_binding_hash: hash('p36-install-binding'),
};

function verifiedIntake(overrides = {}) {
  return {
    schema_version: 1,
    verified: true,
    intake_protocol_version: 2,
    replay_status: 'fresh',
    session_id: 'p36-session',
    session_challenge_hash: hash('p36-session-challenge'),
    install_binding_hash: authority.install_binding_hash,
    issuer: authority.issuer,
    key_id: authority.key_id,
    attestation_hash: authority.attestation_hash,
    envelope_hash: hash('p36-owner-envelope'),
    replay_fingerprint: hash('p36-replay-fingerprint'),
    issued_at_ms: NOW - 100,
    not_before_ms: NOW - 100,
    expires_at_ms: NOW + 60000,
    trusted_intake_binding: trustedBinding(),
    bridge_plan_hash: hash('p36-bridge-plan'),
    bridge_receipt_hash: hash('p36-bridge-receipt'),
    authenticated_receipt_hash: hash('p36-authenticated-receipt'),
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    schema_version: 1,
    trusted_intake_envelope: { fixture: 'p36-owner-envelope' },
    service_bindings: {
      worker: service('worker', 1),
      broker: service('broker', 2),
      receipt_verifier: service('receipt_verifier', 3),
      witness: service('witness', 4),
      coordinator: service('coordinator', 5),
    },
    ...overrides,
  };
}

function verificationOptions(result = verifiedIntake()) {
  return {
    trustedIntakeAuthority: authority,
    trustedIntakeVerifier: (envelope, context) => {
      assert.deepEqual(envelope, { fixture: 'p36-owner-envelope' });
      assert.equal(context.expected_intake_protocol_version, 2);
      assert.equal(context.expected_substrate_abi_hash, contract.getSupervisedProductionSubstrateAbiHash());
      return result;
    },
    now: () => NOW,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function reject(callback, code, label) {
  assert.throws(callback, (error) => error instanceof OwnerKernelError
    && (code === undefined || error.code === code), label);
}

function envelope(plan, senderRole, recipientRole, request, overrides = {}) {
  const sender = plan.service_bindings[senderRole];
  const recipient = plan.service_bindings[recipientRole];
  return {
    schema_version: 1,
    protocol_version: 1,
    request_id: request.request_id,
    operation: request.operation,
    sender_role: senderRole,
    sender_identity: sender.identity,
    sender_attestation_hash: sender.attestation_hash,
    sender_cgroup_binding_hash: sender.cgroup_binding_hash,
    recipient_role: recipientRole,
    recipient_identity: recipient.identity,
    recipient_attestation_hash: recipient.attestation_hash,
    recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
    issued_at_ms: NOW - 10,
    expires_at_ms: NOW + 1000,
    nonce_hash: hash(`nonce:${senderRole}:${recipientRole}:${request.request_id}`),
    authentication_proof_hash: hash(`proof:${senderRole}:${recipientRole}:${request.request_id}`),
    substrate_plan_hash: plan.substrate_plan_hash,
    payload_hash: hash(canonicalJson(request)),
    ...overrides,
  };
}

const baselineInput = input();
const plan = contract.compileSupervisedProductionSubstrateContract(baselineInput, verificationOptions());
assert.equal(publicEngine.compileSupervisedProductionSubstrateContract, contract.compileSupervisedProductionSubstrateContract);
assert.equal(plan.schema_version, 1);
assert.equal(plan.kind, 'p36_effect_disabled_substrate');
assert.equal(plan.status, 'effects_disabled');
assert.equal(plan.intake_protocol_version, 2);
assert.equal(plan.owner_kernel_authority, 'none');
assert.equal(plan.effect_authority, 'none');
assert.equal(plan.broker_authority, 'disabled');
assert.equal(plan.acceptance, 'not_available');
assert.equal(plan.intake.trusted_intake_binding.workspace_ticket_hash, hash('ticket-p36'));
assert.equal(plan.service_bindings.broker.identity, 'p36-broker');
assert.deepEqual(plan.witness_operations, ['appendIfHead', 'appendBatchIfHead', 'getHead', 'readback']);
assert.deepEqual(plan.coordinator_operations, ['prepare', 'cancel', 'resolve']);
assert.deepEqual(plan.broker_operations, ['mint_permit', 'postclaim_authorize', 'execute', 'revoke']);
assert.equal(plan.substrate_plan_hash, hash(canonicalJson(Object.fromEntries(
  Object.entries(plan).filter(([key]) => key !== 'substrate_plan_hash'),
))));
assert.equal(canonicalJson(plan).includes('workspaceRoot'), false);
assert.equal(canonicalJson(plan).includes('/tmp/'), false);

const repeatedPlan = contract.compileSupervisedProductionSubstrateContract(clone(baselineInput), verificationOptions());
assert.deepEqual(repeatedPlan, plan);
const verified = contract.verifySupervisedProductionSubstrateContract(plan, baselineInput, verificationOptions());
assert.equal(verified.verified, true);
assert.equal(verified.effect_authority, 'none');
assert.equal(verified.broker_authority, 'disabled');

reject(() => contract.compileSupervisedProductionSubstrateContract(baselineInput), 'SUBSTRATE_VERIFIED_INTAKE_REQUIRED', 'trusted verifier is required');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  input({ bridge_plan_hash: hash('attacker-controlled') }), verificationOptions(),
), undefined, 'caller cannot inject bridge hashes into the input');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ intake_protocol_version: 1 })),
), 'SUBSTRATE_VERIFIED_INTAKE_REQUIRED', 'v1 verified intake must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ replay_status: 'replayed' })),
), 'SUBSTRATE_VERIFIED_INTAKE_REQUIRED', 'replayed verified intake must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ expires_at_ms: NOW })),
), 'SUBSTRATE_INTAKE_EXPIRED', 'expired verified intake must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ not_before_ms: NOW + 1 })),
), 'SUBSTRATE_INTAKE_NOT_ACTIVE', 'not-yet-active verified intake must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ not_before_ms: NOW + 1000, expires_at_ms: NOW + 1 })),
), 'SUBSTRATE_INTAKE_INVALID_WINDOW', 'impossible verified intake window must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ issuer: 'attacker' })),
), undefined, 'authority substitution must be rejected');
reject(() => contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ trusted_intake_binding: trustedBinding({ workspaceRoot: '/root/not-allowed' }) })),
), undefined, 'structured raw path must be rejected');

const duplicateUid = input();
duplicateUid.service_bindings.witness.uid = duplicateUid.service_bindings.worker.uid;
reject(() => contract.compileSupervisedProductionSubstrateContract(duplicateUid, verificationOptions()), 'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED', 'duplicate service UID must be rejected');
const duplicateGid = input();
duplicateGid.service_bindings.witness.gid = duplicateGid.service_bindings.worker.gid;
reject(() => contract.compileSupervisedProductionSubstrateContract(duplicateGid, verificationOptions()), 'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED', 'duplicate service GID must be rejected');
const duplicateIdentity = input();
duplicateIdentity.service_bindings.coordinator.identity = duplicateIdentity.service_bindings.broker.identity;
reject(() => contract.compileSupervisedProductionSubstrateContract(duplicateIdentity, verificationOptions()), 'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED', 'duplicate service identity must be rejected');
const duplicateAttestation = input();
duplicateAttestation.service_bindings.receipt_verifier.attestation_hash = duplicateAttestation.service_bindings.broker.attestation_hash;
reject(() => contract.compileSupervisedProductionSubstrateContract(duplicateAttestation, verificationOptions()), 'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED', 'duplicate service attestation must be rejected');
const duplicateCgroup = input();
duplicateCgroup.service_bindings.coordinator.cgroup_binding_hash = duplicateCgroup.service_bindings.broker.cgroup_binding_hash;
reject(() => contract.compileSupervisedProductionSubstrateContract(duplicateCgroup, verificationOptions()), 'SUBSTRATE_SERVICE_INDEPENDENCE_REQUIRED', 'duplicate service cgroup must be rejected');
const rootService = input();
rootService.service_bindings.broker.uid = 0;
reject(() => contract.compileSupervisedProductionSubstrateContract(rootService, verificationOptions()), undefined, 'root service UID must be rejected');
const rootGroup = input();
rootGroup.service_bindings.broker.gid = 0;
reject(() => contract.compileSupervisedProductionSubstrateContract(rootGroup, verificationOptions()), undefined, 'root service GID must be rejected');

const mutatedPlan = clone(plan);
mutatedPlan.effect_authority = 'available';
reject(() => contract.verifySupervisedProductionSubstrateContract(mutatedPlan, baselineInput, verificationOptions()), undefined, 'authority mutation must be rejected');

const witnessAppend = {
  schema_version: 1,
  request_id: 'witness-append-p36',
  operation: 'appendIfHead',
  stream_id: 'stream-p36',
  expected_head: null,
  event_hash: hash('event-p36'),
  event_payload_hash: hash('event-payload-p36'),
  substrate_plan_hash: plan.substrate_plan_hash,
};
const witnessAppendEnvelope = envelope(plan, 'receipt_verifier', 'witness', witnessAppend);
const normalizedWitnessAppend = contract.normalizeWitnessRequest(plan, witnessAppendEnvelope, witnessAppend, { now: () => NOW });
assert.equal(normalizedWitnessAppend.request.event_hash, hash('event-p36'));
assert.equal(normalizedWitnessAppend.envelope.recipient_role, 'witness');
assert.equal(contract.normalizeServiceEnvelope(plan, witnessAppendEnvelope, { now: () => NOW }).sender_role, 'receipt_verifier');
reject(() => contract.normalizeServiceEnvelope(
  plan,
  envelope(plan, 'worker', 'coordinator', witnessAppend),
  { now: () => NOW },
), undefined, 'generic IPC parser cannot bypass the frozen witness route');
const unknownOperationEnvelope = { ...witnessAppendEnvelope, operation: 'unknown-operation-p36' };
reject(() => contract.normalizeServiceEnvelope(plan, unknownOperationEnvelope, { now: () => NOW }), undefined, 'generic IPC parser rejects unassigned operations');
const ambientNow = Date.now();
const ambientOptions = verificationOptions(verifiedIntake({
  issued_at_ms: ambientNow - 10,
  not_before_ms: ambientNow - 10,
  expires_at_ms: ambientNow + 60000,
}));
ambientOptions.now = () => ambientNow;
const ambientPlan = contract.compileSupervisedProductionSubstrateContract(baselineInput, ambientOptions);
const ambientWitnessRequest = {
  ...witnessAppend,
  request_id: 'witness-ambient-clock-p36',
  substrate_plan_hash: ambientPlan.substrate_plan_hash,
};
assert.equal(contract.normalizeWitnessRequest(
  ambientPlan,
  envelope(ambientPlan, 'receipt_verifier', 'witness', ambientWitnessRequest, {
    issued_at_ms: ambientNow - 1,
    expires_at_ms: ambientNow + 1000,
  }),
  ambientWitnessRequest,
).request.request_id, 'witness-ambient-clock-p36');

const badWitnessEnvelope = clone(witnessAppendEnvelope);
badWitnessEnvelope.payload_hash = hash('different-payload');
reject(() => contract.normalizeWitnessRequest(plan, badWitnessEnvelope, witnessAppend, { now: () => NOW }), undefined, 'witness payload substitution must be rejected');
const wrongWitnessSender = envelope(plan, 'worker', 'witness', witnessAppend);
reject(() => contract.normalizeWitnessRequest(plan, wrongWitnessSender, witnessAppend, { now: () => NOW }), undefined, 'worker cannot impersonate receipt verifier for witness append');

const witnessBatch = {
  schema_version: 1,
  request_id: 'witness-batch-p36',
  operation: 'appendBatchIfHead',
  stream_id: 'stream-p36',
  expected_head: hash('prior-head-p36'),
  events: [
    { event_hash: hash('batch-event-1'), event_payload_hash: hash('batch-payload-1') },
    { event_hash: hash('batch-event-2'), event_payload_hash: hash('batch-payload-2') },
  ],
  substrate_plan_hash: plan.substrate_plan_hash,
};
assert.equal(contract.normalizeWitnessRequest(
  plan,
  envelope(plan, 'receipt_verifier', 'witness', witnessBatch),
  witnessBatch,
  { now: () => NOW },
).request.events.length, 2);
const duplicateBatch = clone(witnessBatch);
duplicateBatch.events[1].event_hash = duplicateBatch.events[0].event_hash;
reject(() => contract.normalizeWitnessRequest(plan, envelope(plan, 'receipt_verifier', 'witness', duplicateBatch), duplicateBatch, { now: () => NOW }), undefined, 'duplicate witness batch event must be rejected');

const coordinatorRequest = {
  schema_version: 1,
  request_id: 'coordinator-prepare-p36',
  operation: 'prepare',
  transaction_id: 'transaction-p36',
  fence: 1,
  expected_witness_head: hash('coordinator-head-p36'),
  substrate_plan_hash: plan.substrate_plan_hash,
};
const coordinatorEnvelope = envelope(plan, 'receipt_verifier', 'coordinator', coordinatorRequest);
assert.equal(contract.normalizeCoordinatorRequest(plan, coordinatorEnvelope, coordinatorRequest, { now: () => NOW }).request.fence, 1);
const badFence = { ...coordinatorRequest, fence: 0 };
reject(() => contract.normalizeCoordinatorRequest(plan, envelope(plan, 'receipt_verifier', 'coordinator', badFence), badFence, { now: () => NOW }), undefined, 'non-positive coordinator fence must be rejected');

const brokerRequest = {
  schema_version: 1,
  request_id: 'broker-request-p36',
  operation: 'execute',
  substrate_plan_hash: plan.substrate_plan_hash,
};
const brokerEnvelope = envelope(plan, 'worker', 'broker', brokerRequest);
const brokerResult = contract.createEffectsDisabledBrokerResult(plan, brokerEnvelope, brokerRequest, { now: () => NOW });
assert.equal(brokerResult.code, 'BROKER_EFFECTS_DISABLED');
assert.equal(brokerResult.effect_authority, 'none');
assert.equal(brokerResult.acceptance, 'not_available');
const brokerExpectation = { request: brokerRequest, envelope: brokerEnvelope, now: () => NOW };
assert.equal(
  contract.normalizeEffectsDisabledBrokerResult(plan, brokerResult, brokerExpectation).result_hash,
  brokerResult.result_hash,
);
reject(() => contract.normalizeEffectsDisabledBrokerResult(plan, brokerResult), 'SUBSTRATE_DISABLED_RESULT_EXPECTATION_REQUIRED', 'disabled result verifier requires the original request and envelope');
const tamperedBrokerResult = clone(brokerResult);
tamperedBrokerResult.effect_authority = 'available';
reject(() => contract.normalizeEffectsDisabledBrokerResult(plan, tamperedBrokerResult, brokerExpectation), undefined, 'tampered broker result must be rejected');
const reboundBrokerResult = clone(brokerResult);
reboundBrokerResult.request_id = 'attacker-request-p36';
reboundBrokerResult.operation = 'mint_permit';
reboundBrokerResult.request_hash = hash('attacker-request-hash');
reboundBrokerResult.request_envelope_hash = hash('attacker-envelope-hash');
const reboundBrokerMaterial = { ...reboundBrokerResult };
delete reboundBrokerMaterial.result_hash;
reboundBrokerResult.result_hash = hash(canonicalJson(reboundBrokerMaterial));
reject(() => contract.normalizeEffectsDisabledBrokerResult(plan, reboundBrokerResult, brokerExpectation), undefined, 'rehashed broker result cannot detach from its original request or envelope');
reject(() => contract.createEffectsDisabledBrokerResult(plan, brokerEnvelope, {
  ...brokerRequest,
  command: 'must not be interpreted',
}, { now: () => NOW }), undefined, 'disabled broker must reject executable payload');
const shortIntakePlan = contract.compileSupervisedProductionSubstrateContract(
  baselineInput,
  verificationOptions(verifiedIntake({ expires_at_ms: NOW + 100 })),
);
const outOfWindowBrokerRequest = {
  schema_version: 1,
  request_id: 'broker-outside-intake-p36',
  operation: 'execute',
  substrate_plan_hash: shortIntakePlan.substrate_plan_hash,
};
reject(() => contract.createEffectsDisabledBrokerResult(
  shortIntakePlan,
  envelope(shortIntakePlan, 'worker', 'broker', outOfWindowBrokerRequest, {
    issued_at_ms: NOW + 1,
    expires_at_ms: NOW + 101,
  }),
  outOfWindowBrokerRequest,
  { now: () => NOW + 2 },
), 'SUBSTRATE_IPC_OUTSIDE_INTAKE', 'service frame must remain inside the verified intake window');
const expiredBrokerRequest = {
  schema_version: 1,
  request_id: 'broker-expired-intake-p36',
  operation: 'execute',
  substrate_plan_hash: shortIntakePlan.substrate_plan_hash,
};
reject(() => contract.createEffectsDisabledBrokerResult(
  shortIntakePlan,
  envelope(shortIntakePlan, 'worker', 'broker', expiredBrokerRequest, {
    issued_at_ms: NOW + 1000,
    expires_at_ms: NOW + 1100,
  }),
  expiredBrokerRequest,
  { now: () => NOW + 1000 },
), 'SUBSTRATE_INTAKE_EXPIRED', 'expired substrate plan cannot send a fresh service frame');

const coordinatorDisabledRequest = {
  schema_version: 1,
  request_id: 'coordinator-disabled-p36',
  operation: 'prepare',
  substrate_plan_hash: plan.substrate_plan_hash,
};
const coordinatorDisabledEnvelope = envelope(plan, 'receipt_verifier', 'coordinator', coordinatorDisabledRequest);
const coordinatorResult = contract.createAcceptanceDisabledCoordinatorResult(
  plan,
  coordinatorDisabledEnvelope,
  coordinatorDisabledRequest,
  { now: () => NOW },
);
assert.equal(coordinatorResult.code, 'COORDINATOR_ACCEPTANCE_DISABLED');
assert.equal(contract.normalizeAcceptanceDisabledCoordinatorResult(plan, coordinatorResult, {
  request: coordinatorDisabledRequest,
  envelope: coordinatorDisabledEnvelope,
  now: () => NOW,
}).result_hash, coordinatorResult.result_hash);
reject(() => contract.createAcceptanceDisabledCoordinatorResult(plan, coordinatorDisabledEnvelope, {
  ...coordinatorDisabledRequest,
  operation: 'commit',
}, { now: () => NOW }), undefined, 'acceptance commit operation must be absent');

const abi = contract.getSupervisedProductionSubstrateAbi();
assert.equal(abi.effect_authority, 'none');
assert.equal(abi.broker_authority, 'disabled');
assert.equal(abi.acceptance, 'not_available');
assert.deepEqual(abi.wire_contract.service_ipc.routes.broker, {
  sender_role: 'worker',
  recipient_role: 'broker',
});
assert.deepEqual(abi.wire_contract.service_ipc.operation_routes.execute, {
  sender_role: 'worker',
  recipient_role: 'broker',
});
assert.equal(abi.wire_contract.intake_activation.require_active_at_use, true);
assert.equal(abi.wire_contract.witness.request_fields.appendIfHead.includes('expected_head'), true);
assert.equal(abi.wire_contract.coordinator.min_fence, 1);
assert.equal(abi.wire_contract.disabled_results.result_fields.includes('request_envelope_hash'), true);
assert.deepEqual(abi.wire_contract.disabled_results.correlation, {
  expected_context_fields: ['request', 'envelope', 'now'],
  request_id: 'expected_request.request_id',
  operation: 'expected_request.operation',
  request_hash: 'sha256(canonical_json(expected_request))',
  request_envelope_hash: 'sha256(canonical_json(expected_envelope))',
  result_hash: 'sha256(canonical_json(result_without_result_hash))',
});
assert.equal(contract.getSupervisedProductionSubstrateAbiHash(), hash(canonicalJson(abi)));

const source = fs.readFileSync(path.join(root, 'src', 'engine', 'supervised-production-substrate-contract.js'), 'utf8');
for (const forbidden of [
  'AutopilotEngine',
  "require('./owner-kernel/kernel')",
  'mintActionDecision',
  'executeAuthorizedAction',
]) {
  assert.equal(source.includes(forbidden), false, `P3.6 contract must not contain ${forbidden}`);
}

console.log('verified_v2_adapter_required=true');
console.log('replay_expiry_authority_rejected=true');
console.log('service_independence=true');
console.log('ipc_cas_fence_schema=true');
console.log('raw_path_rejected=true');
console.log('plan_and_result_tamper_rejected=true');
console.log('broker_effects_disabled=true');
console.log('coordinator_acceptance_disabled=true');
console.log('no_authority_surface=true');
NODE
)"
STATUS=$?

assert_eq "$STATUS" "0" "P3.6 production substrate contract fixture exits successfully"
assert_contains "$OUT" "verified_v2_adapter_required=true" "P3.6 requires a root-owned verified v2 intake adapter"
assert_contains "$OUT" "replay_expiry_authority_rejected=true" "P3.6 rejects stale, replayed, and substituted verified intake"
assert_contains "$OUT" "service_independence=true" "P3.6 rejects every service identity collapse axis"
assert_contains "$OUT" "ipc_cas_fence_schema=true" "P3.6 freezes IPC, witness CAS, and coordinator fence schemas"
assert_contains "$OUT" "raw_path_rejected=true" "P3.6 rejects raw structured workspace paths"
assert_contains "$OUT" "plan_and_result_tamper_rejected=true" "P3.6 detects frozen-plan and refusal-result tampering"
assert_contains "$OUT" "broker_effects_disabled=true" "P3.6 broker surface is explicitly disabled"
assert_contains "$OUT" "coordinator_acceptance_disabled=true" "P3.6 coordinator acceptance is explicitly disabled"
assert_contains "$OUT" "no_authority_surface=true" "P3.6 contract has no runtime authority surface"

finalize_test
