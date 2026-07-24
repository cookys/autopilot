#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];
const {
  actionDescriptorHash,
  actionMatchesDescriptor,
  canonicalJson,
  MemoryWitness,
  normalizeActionAuthority,
  normalizeActionDescriptor,
  normalizeExecutionPermit,
  normalizeHostCapability,
  OwnerKernel,
  parseLedgerJsonl,
  replayFromLatestCheckpoint,
  resolveGovernancePolicy,
  sha256,
  validateHostCapabilityCoverage,
  verifyLedger,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const { actionReconciliationHash } = require(path.join(
  root,
  'src',
  'engine',
  'owner-kernel',
  'state',
));
const { currentActionCandidateAudit, evaluateAcceptancePredicate } = require(path.join(
  root,
  'src',
  'engine',
  'owner-kernel',
  'acceptance',
));
const { buildEvent, prepareEvent } = require(path.join(
  root,
  'src',
  'engine',
  'owner-kernel',
  'events',
));

const hash = (value) => sha256(value);
const brokerAttestation = hash('broker-a-attestation');
const hostVerifierAttestation = hash('host-capability-verifier-a-attestation');
const brokerDescriptor = (overrides = {}) => ({
  kind: 'external-broker',
  identity: 'broker-a',
  worker_uid: 1000,
  broker_uid: 1001,
  receipt_root: '/var/lib/autopilot/receipts',
  permit_revocation: true,
  attestation_hash: brokerAttestation,
  protocol_version: 1,
  ...overrides,
});
const brokerAdapter = (overrides = {}) => ({
  identity: 'broker-a',
  broker_uid: 1001,
  receipt_root: '/var/lib/autopilot/receipts',
  attestation_hash: brokerAttestation,
  protocol_version: 1,
  execute() {},
  cancel() {},
  ...overrides,
});
const testHostCapabilityVerifier = (probe = () => ({ ok: true })) => ({
  identity: 'host-capability-verifier-a',
  trustTier: 'test',
  attestation_hash: hostVerifierAttestation,
  probe,
});
const testReceiptVerifier = (verify = () => ({ ok: true })) => ({
  identity: 'receipt-verifier-a',
  trustTier: 'test',
  attestation_hash: hash('receipt-verifier-a'),
  verify,
});
async function main() {
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(identity),
  issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
});
const roster = (identity, role) => ({
  identity, model_alias: identity, model_version: '1', family: 'test', runner: 'test', role,
  attestation: attestation(identity),
});
const config = { schema_version: 1, governance: {
  default_mode: 'owner-led',
  owner_roster: [roster('owner-a', 'owner')],
  challenger_roster: [roster('challenger-a', 'challenger')],
  trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
  approval_policy: {
    read_only: { requires_approval: false, max_uses: 1 },
    reversible: { requires_approval: false, max_uses: 1 },
    external: { requires_approval: true, max_uses: 1 },
    irreversible: { requires_approval: true, max_uses: 1 },
  },
  capability_ttl_seconds: 3600,
  checkpoint_interval_closed_events: 100,
  max_blocked_duration_seconds: 86400,
  action_catalog: [
    { id: 'write-file', operation: 'write_file', tool_class: 'filesystem', action_class: 'reversible', command_required: false, requires_mediator: false, requires_challenge: false },
    { id: 'deploy-prod', operation: 'deploy', tool_class: 'network', action_class: 'irreversible', command_required: true, requires_mediator: true, requires_challenge: false },
  ],
}};
const policy = resolveGovernancePolicy(config).policy;
assert.equal(policy.action_catalog.length, 2);

const deploy = normalizeActionDescriptor(policy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-b', 'service-a'],
});
assert.deepEqual(deploy.targets, ['service-a', 'service-b']);
assert.equal(deploy.action_class, 'irreversible');
assert.equal(policy.approval_policy[deploy.action_class].requires_approval, true);
assert.equal(actionMatchesDescriptor(policy, deploy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-b', 'service-a'],
}), true);
assert.equal(actionMatchesDescriptor(policy, deploy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --staging', targets: ['service-a', 'service-b'],
}), false);
assert.equal(typeof actionDescriptorHash(deploy), 'string');
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-a'],
}, { declaredActionClass: 'reversible' }), (error) => (
  error.code === 'ACTION_CLASS_DOWNGRADE' && /cannot lower/.test(error.message)
));
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'unknown', tool_class: 'network', targets: ['service-a'],
}), (error) => (
  error.code === 'ACTION_CLASSIFICATION_BLOCKED' && /not classified/.test(error.message)
));
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: [],
}), /enumerable/);
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-*'],
}), /wildcard/);

const full = normalizeHostCapability({
  schema_version: 1, tier: 'full', probe_id: 'full-probe',
  probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
  preventive_action_ids: ['deploy-prod'], audited_action_ids: ['deploy-prod'], mediated_action_ids: ['deploy-prod'],
  broker: brokerDescriptor(),
});
assert.throws(() => normalizeHostCapability(Object.create(full)), /plain data object/);
assert.throws(() => normalizeExecutionPermit(Object.create({ permit_id: 'inherited-permit' })), /plain data object/);
assert.equal(validateHostCapabilityCoverage(policy, full, new Date('2026-07-02T00:00:00.000Z')), true);

const partial = normalizeHostCapability({
  schema_version: 1, tier: 'partial', probe_id: 'partial-probe',
  probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
  preventive_action_ids: [], audited_action_ids: [], mediated_action_ids: ['deploy-prod'],
  broker: brokerDescriptor(),
});
assert.equal(validateHostCapabilityCoverage(policy, partial, new Date('2026-07-02T00:00:00.000Z')), true);
assert.throws(() => normalizeHostCapability({
  schema_version: 1, tier: 'partial', probe_id: 'bad-broker',
  probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
  preventive_action_ids: [], audited_action_ids: [], mediated_action_ids: ['deploy-prod'],
  broker: brokerDescriptor({ broker_uid: 1000 }),
}), /distinct/);
assert.throws(() => validateHostCapabilityCoverage(policy, normalizeHostCapability({
  schema_version: 1, tier: 'none', probe_id: 'none-probe',
  probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
  preventive_action_ids: [], audited_action_ids: [], mediated_action_ids: [], broker: null,
}), new Date('2026-07-02T00:00:00.000Z')), /cannot activate/);
const mediatedReversibleConfig = JSON.parse(JSON.stringify(config));
mediatedReversibleConfig.governance.action_catalog = [{
  ...mediatedReversibleConfig.governance.action_catalog[0],
  requires_mediator: true,
}];
const mediatedReversiblePolicy = resolveGovernancePolicy(mediatedReversibleConfig).policy;
const unmediatedReversible = normalizeHostCapability({
  schema_version: 1, tier: 'full', probe_id: 'unmediated-reversible-probe',
  probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
  preventive_action_ids: ['write-file'], audited_action_ids: ['write-file'], mediated_action_ids: [], broker: null,
});
assert.throws(() => validateHostCapabilityCoverage(
  mediatedReversiblePolicy,
  unmediatedReversible,
  new Date('2026-07-02T00:00:00.000Z'),
), /mediator-only/);
let unmediatedDirectCalls = 0;
assert.throws(() => normalizeActionAuthority(mediatedReversiblePolicy, {
  host_capability: unmediatedReversible,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'unmediated-worker', attestation_hash: hash('unmediated-worker'),
    execute() { unmediatedDirectCalls += 1; },
  },
}, { allowTestExecutor: true, now: new Date('2026-07-02T00:00:00.000Z') }), /mediator-only/);
assert.equal(unmediatedDirectCalls, 0);
assert.throws(() => normalizeActionAuthority(policy, {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'test-executor', attestation_hash: hash('test-executor'), worker_uid: 1000,
    broker: brokerAdapter(),
  },
}), /must be external/);
const authority = normalizeActionAuthority(policy, {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'test-executor', attestation_hash: hash('test-executor'), worker_uid: 1000,
    broker: brokerAdapter(),
  },
}, { allowTestExecutor: true, now: new Date('2026-07-02T00:00:00.000Z') });
assert.equal(authority.capability.tier, 'full');
assert.throws(() => normalizeActionAuthority(policy, {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'test-executor', attestation_hash: hash('test-executor'), worker_uid: 1000, execute() {},
    broker: brokerAdapter(),
  },
}, { allowTestExecutor: true, now: new Date('2026-07-02T00:00:00.000Z') }), /must not expose executor\.execute/);
assert.throws(() => normalizeActionAuthority(policy, {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'test-executor', attestation_hash: hash('test-executor'), worker_uid: 1000,
    broker: brokerAdapter({ execute: undefined }),
  },
}, { allowTestExecutor: true, now: new Date('2026-07-02T00:00:00.000Z') }), /broker requires execute/);
assert.throws(() => normalizeActionAuthority(policy, {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier(),
  receipt_verifier: testReceiptVerifier(),
  executor: {
    trustTier: 'test', identity: 'test-executor', attestation_hash: hash('test-executor'), worker_uid: 1001,
    broker: brokerAdapter(),
  },
}, { allowTestExecutor: true, now: new Date('2026-07-02T00:00:00.000Z') }), /worker UID/);

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 6, 2, 0, 0, tick++)).toISOString();
const actionAdapters = {
  userInputVerifier(envelope, kind, context) {
    if (!envelope || envelope.signed !== true || !envelope.payload) return { ok: false };
    return {
      ok: true,
      kind,
      run_id: context.run_id,
      identity: 'user:test',
      channel: 'authenticated-test-input',
      envelope_hash: hash(canonicalJson({ kind, payload: envelope.payload })),
      payload: envelope.payload,
    };
  },
  ownerTurnVerifier(envelope, context) {
    if (!envelope || envelope.witnessed !== true) return { ok: false };
    return {
      ok: true,
      run_id: context.run_id,
      principal_id: context.principal_id,
      identity: envelope.identity,
      channel: 'host-owner-turn',
      envelope_hash: hash(`turn:${envelope.turn}`),
      payload: {},
    };
  },
  principalResolver({ candidate_id, run_id, from_principal_id }) {
    return {
      ok: true,
      run_id,
      from_principal_id,
      identity: candidate_id,
      attestation_sha256: hash(candidate_id),
      outcome: 'qualified',
    };
  },
  qualificationVerifier({ principal, run_id }) {
    return { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 };
  },
};
let hostAvailable = true;
let hostProbeCalls = 0;
let forceWitnessRace = false;
let staleProbeNonce = false;
let brokerCalls = 0;
let receiptMismatch = false;
let lastBrokerRequest = null;
let delayBroker = false;
let releaseBroker = null;
let brokerCancelCalls = 0;
let lastCancelRequest = null;
let cancellationVerifierMismatch = false;
const executionPermit = (request) => ({
  permit_id: `permit:${request.claim_id}`,
  run_id: request.run_id,
  witness_stream_id: request.witness_stream_id,
  witness_binding_hash: request.witness_binding_hash,
  authority_hash: request.authority_hash,
  claim_id: request.claim_id,
  pre_action_witness_head: request.pre_action_witness_head,
  host_capability_hash: request.host_capability_hash,
  action_descriptor_hash: request.action_descriptor_hash,
  executor_binding_hash: request.executor_binding_hash,
  audience_identity: request.audience_identity,
  expires_at: '2026-07-02T00:04:00.000Z',
  attestation_hash: hash(`permit:${request.claim_id}`),
  issuer: 'host-capability-verifier-a',
  issuer_attestation_hash: hostVerifierAttestation,
  preclaim_authorization: `preclaim:${request.claim_id}`,
});
const executionAuthorization = (request) => ({
  authorization_id: `authorization:${request.claim_id}`,
  run_id: request.run_id,
  witness_stream_id: request.witness_stream_id,
  witness_binding_hash: request.witness_binding_hash,
  authority_hash: request.authority_hash,
  claim_id: request.claim_id,
  claim_event_hash: request.claim_event_hash,
  claim_witness_head: request.claim_witness_head,
  claim_emitted_at: request.claim_emitted_at,
  execution_permit_id: request.execution_permit.permit_id,
  execution_permit_hash: request.execution_permit_hash,
  host_capability_hash: request.host_capability_hash,
  action_descriptor_hash: request.action_descriptor_hash,
  executor_binding_hash: request.executor_binding_hash,
  audience_identity: request.audience_identity,
  issued_at: request.claim_emitted_at,
  expires_at: request.execution_permit.expires_at,
  attestation_hash: hash(`authorization:${request.claim_id}`),
  issuer: 'host-capability-verifier-a',
  issuer_attestation_hash: hostVerifierAttestation,
  authorization: `authorization:${request.claim_id}`,
});
const actionAuthority = {
  host_capability: full,
  host_capability_verifier: testHostCapabilityVerifier((request) => {
      hostProbeCalls += 1;
      if (forceWitnessRace && (request.operation === 'decision' || request.operation === 'pre_action')) {
        witness._head = hash(`witness-race:${request.operation}`);
      }
      if (hostAvailable) {
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: hash(`host-probe:${request.operation}`),
          probe_nonce: staleProbeNonce ? 'stale-probe-nonce' : request.probe_nonce,
        };
        if (request.operation === 'pre_action') response.execution_permit = executionPermit(request);
        if (request.operation === 'post_claim') response.execution_authorization = executionAuthorization(request);
        return response;
      }
      return {
        ok: false,
        run_id: request.run_id,
        host_capability_hash: hash('regressed-capability'),
        observation_hash: hash('host-probe:regressed'),
        probe_nonce: request.probe_nonce,
        reason: 'hook_lost',
      };
    }),
  receipt_verifier: testReceiptVerifier((request) => {
    if (request.operation === 'verify_cancellation') {
      if (!cancellationVerifierMismatch) return request.acknowledgement;
      return { ...request.acknowledgement, boundary_state_version: request.acknowledgement.boundary_state_version + 1 };
    }
    const observedAction = {
      operation: lastBrokerRequest.action.operation,
      tool_class: lastBrokerRequest.action.tool_class,
      targets: receiptMismatch ? ['unexpected-target'] : lastBrokerRequest.action.targets,
    };
    if (lastBrokerRequest.action.command !== undefined) observedAction.command = lastBrokerRequest.action.command;
    return {
      ok: true,
      run_id: request.run_id,
      claim_id: request.claim_id,
      executor_binding_hash: request.executor_binding_hash,
      execution_permit_hash: request.execution_permit_hash,
      execution_authorization_hash: request.execution_authorization_hash,
      authorization_id: request.authorization_id,
      claim_event_hash: request.claim_event_hash,
      claim_witness_head: request.claim_witness_head,
      permit_state: request.receipt.permit_state,
      boundary_effect_id: request.receipt.boundary_effect_id,
      boundary_state_version: request.receipt.boundary_state_version,
      boundary_attestation_hash: request.receipt.boundary_attestation_hash,
      effect_at: request.receipt.effect_at,
      status: 'succeeded',
      receipt: request.receipt.receipt_ref,
      broker: request.receipt.broker_receipt,
      observed_action: observedAction,
    };
  }),
  executor: {
    trustTier: 'test',
    identity: 'test-executor',
    attestation_hash: hash('test-executor'),
    worker_uid: 1000,
    broker: brokerAdapter({
      async execute(request) {
        brokerCalls += 1;
        lastBrokerRequest = request;
        const result = {
          receipt: {
            uri: `file:///var/lib/autopilot/receipts/${request.claim_id}.json`,
            sha256: hash(`receipt:${request.claim_id}`),
          },
          broker: { identity: 'broker-a', broker_uid: 1001 },
          execution_permit_hash: request.execution_permit_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: request.authorization_id,
          claim_event_hash: request.claim_event_hash,
          claim_witness_head: request.claim_witness_head,
          permit_state: 'consumed',
          boundary_effect_id: `effect:${request.claim_id}`,
          boundary_state_version: 1,
          boundary_attestation_hash: brokerAttestation,
          effect_at: request.execution_authorization.issued_at,
        };
        if (delayBroker) {
          return new Promise((resolve) => { releaseBroker = () => resolve(result); });
        }
        return result;
      },
      async cancel(request) {
        brokerCancelCalls += 1;
        lastCancelRequest = request;
        return {
          ok: true,
          run_id: request.run_id,
          claim_id: request.claim_id,
          execution_permit_id: request.execution_permit_id,
          execution_permit_hash: request.execution_permit_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: request.authorization_id,
          cancellation_request_hash: request.cancellation_request_hash,
          state: 'revoked',
          receipt: {
            uri: `file:///var/lib/autopilot/receipts/cancel-${request.claim_id}.json`,
            sha256: hash(`cancel:${request.claim_id}:${request.cancellation_request_hash}`),
          },
          broker: { identity: 'broker-a', broker_uid: 1001 },
          boundary_effect_id: null,
          boundary_state_version: 2,
          attestation_hash: brokerAttestation,
          received_at: new Date(Date.UTC(2026, 6, 2, 0, 0, tick++)).toISOString(),
          effect_at: null,
        };
      },
    }),
  },
};
const witness = new MemoryWitness({ streamId: 'action-authority-test' });
const started = OwnerKernel.start({
  runId: 'owner-action-authority',
  governanceConfig: config,
  acceptanceContract: {
    schema_version: 1,
    contract_id: 'action-authority-contract',
    legs: [{ id: 'unit', kind: 'executable', command: 'node --test', artifact_hashes: [hash('unit-artifact')] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Deploy the selected services.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness,
  adapters: actionAdapters,
  clock,
  actionAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'b'.repeat(64),
});
const kernel = started.kernel;
assert.throws(() => kernel.mintDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'generic' },
  actionClass: 'irreversible',
  actionDescriptor: { operation: 'deploy' },
}), /mintActionDecision/);
const decision = kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'deploy' },
  actionDescriptor: {
    operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-b', 'service-a'],
  },
});
await assert.rejects(
  kernel.executeAuthorizedAction({
    decisionId: decision.payload.decision_id,
    action: { operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-a', 'service-b'] },
  }),
  /blocked|approval/i,
);
assert.equal(brokerCalls, 0);
kernel.submitApproval({
  signed: true,
  payload: {
    decision_id: decision.payload.decision_id,
    decision_content_hash: decision.payload.decision_content_hash,
    max_uses: 1,
  },
});
const execution = await kernel.executeAuthorizedAction({
  decisionId: decision.payload.decision_id,
  action: { operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-a', 'service-b'] },
});
assert.equal(execution.claim.payload.evidence_kind, 'action_claim');
assert.equal(execution.outcome.payload.evidence_kind, 'action_outcome');
assert.equal(kernel.getState().decisions[decision.payload.decision_id].claimed_uses, 1);
assert.equal(kernel.getState().action_claims[execution.claim.payload.claim_id].outcome, 'succeeded');
assert.equal(brokerCalls, 1);
  assert.equal(lastBrokerRequest.execution_permit_hash, execution.claim.payload.execution_permit_hash);
  assert.equal(lastBrokerRequest.execution_permit.claim_id, execution.claim.payload.claim_id);
  assert.equal(canonicalJson(lastBrokerRequest.claim), canonicalJson(execution.claim));
  assert.equal(lastBrokerRequest.claim_emitted_at, execution.claim.emitted_at);
  assert.equal(execution.outcome.payload.execution_permit_hash, execution.claim.payload.execution_permit_hash);
await assert.rejects(
  kernel.executeAuthorizedAction({
    decisionId: decision.payload.decision_id,
    action: { operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-a', 'service-b'] },
  }),
  /remaining authorized use/i,
);

hostAvailable = false;
assert.throws(() => kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'regression' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['src/owner-kernel.js'] },
}), /host capability/i);
assert.ok(kernel.getState().block_reasons.includes('host_capability_regression'));
hostAvailable = true;
assert.equal(kernel.revalidateHostCapability().payload.evidence_kind, 'capability_revalidated');
assert.equal(kernel.getState().block_reasons.includes('host_capability_regression'), false);

const witnessHeadBeforeStaleProbe = witness.head;
const probesBeforeStaleHead = hostProbeCalls;
witness._head = hash('foreign-witness-head');
assert.throws(() => kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'stale-head' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/stale-head.txt'] },
}), /witness head/i);
assert.equal(hostProbeCalls, probesBeforeStaleHead);
witness._head = witnessHeadBeforeStaleProbe;

const racedDecision = kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'witness-race' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/witness-race.txt'] },
});
const witnessHeadBeforeRace = witness.head;
const brokerCallsBeforeRace = brokerCalls;
forceWitnessRace = true;
await assert.rejects(
  kernel.executeAuthorizedAction({
    decisionId: racedDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/witness-race.txt'] },
  }),
  /witness.*head|compare-and-append/i,
);
forceWitnessRace = false;
assert.equal(brokerCalls, brokerCallsBeforeRace);
witness._head = witnessHeadBeforeRace;

const delayedDecision = kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'action-lock' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/action-lock.txt'] },
});
delayBroker = true;
const delayedExecution = kernel.executeAuthorizedAction({
  decisionId: delayedDecision.payload.decision_id,
  action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/action-lock.txt'] },
});
await Promise.resolve();
assert.equal(typeof releaseBroker, 'function');
assert.throws(() => kernel.captureIntent({
  signed: true,
  payload: { text: 'replace during host action', explicit_action_hashes: [] },
}), /in flight/i);
assert.throws(() => kernel.revalidateHostCapability(), /in flight/i);
assert.throws(() => kernel.checkBlockedTimeout(), /in flight/i);
delayBroker = false;
releaseBroker();
await delayedExecution;
releaseBroker = null;

staleProbeNonce = true;
assert.throws(() => kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'stale-probe-nonce' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/stale-probe.txt'] },
}), /host capability/i);
assert.ok(kernel.getState().block_reasons.includes('host_capability_regression'));
staleProbeNonce = false;
assert.equal(kernel.revalidateHostCapability().payload.evidence_kind, 'capability_revalidated');

const mismatchedDecision = kernel.mintActionDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'write' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['src/owner-kernel.js'] },
});
receiptMismatch = true;
const mismatchedExecution = await kernel.executeAuthorizedAction({
  decisionId: mismatchedDecision.payload.decision_id,
  action: { operation: 'write_file', tool_class: 'filesystem', targets: ['src/owner-kernel.js'] },
});
assert.equal(mismatchedExecution.outcome.payload.outcome, 'unknown');
assert.ok(kernel.getState().block_reasons.some((reason) => reason.startsWith('action_outcome:')));
assert.throws(() => OwnerKernel.start({
  runId: 'none-tier-intake',
  governanceConfig: config,
  acceptanceContract: {
    schema_version: 1,
    contract_id: 'none-tier-contract',
    legs: [{ id: 'unit', kind: 'executable', command: 'node --test', artifact_hashes: [hash('none-tier-artifact')] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'no autonomous intake', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: new MemoryWitness({ streamId: 'none-tier-witness' }),
  adapters: actionAdapters,
  clock,
  actionAuthority: {
    ...actionAuthority,
    host_capability: {
      schema_version: 1, tier: 'none', probe_id: 'none-tier-probe',
      probed_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-12-01T00:00:00.000Z',
      preventive_action_ids: [], audited_action_ids: [], mediated_action_ids: [], broker: null,
    },
  },
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'd'.repeat(64),
}), /none-tier/);
const verified = verifyLedger(parseLedgerJsonl(kernel.serializeLedger()), { witness, requireWitness: true });
assert.equal(verified.header.authority.host_capability_hash, sha256(full));
assert.equal(verified.header.authority_hash, sha256(verified.header.authority));
assert.equal(typeof verified.header.authority.intake_observation_hash, 'string');
assert.equal(typeof verified.header.authority.intake_probe_nonce_commitment, 'string');
const nonCanonicalAuthorityHeader = kernel.getLedger();
nonCanonicalAuthorityHeader.header.authority = null;
assert.throws(() => verifyLedger(nonCanonicalAuthorityHeader, { witness, requireWitness: true }), /must be omitted/);
const catalogWithoutAuthority = kernel.getLedger();
delete catalogWithoutAuthority.header.authority;
delete catalogWithoutAuthority.header.authority_hash;
assert.throws(() => verifyLedger(catalogWithoutAuthority, { witness, requireWitness: true }), /requires a ledger authority/);
const substitutedAuthority = kernel.getLedger();
substitutedAuthority.header.authority.host_capability.probe_id = 'substituted-host-probe';
substitutedAuthority.header.authority.host_capability_hash = sha256(substitutedAuthority.header.authority.host_capability);
substitutedAuthority.header.authority_hash = sha256(substitutedAuthority.header.authority);
assert.throws(() => verifyLedger(substitutedAuthority, { witness, requireWitness: true }), /authority_hash/);
const undercoveredAuthority = kernel.getLedger();
undercoveredAuthority.header.authority.host_capability.preventive_action_ids = [];
undercoveredAuthority.header.authority.host_capability.audited_action_ids = [];
undercoveredAuthority.header.authority.host_capability_hash = sha256(undercoveredAuthority.header.authority.host_capability);
undercoveredAuthority.header.authority_hash = sha256(undercoveredAuthority.header.authority);
assert.throws(() => verifyLedger(undercoveredAuthority, { witness, requireWitness: true }), /coverage/);
const mismatchedExecutorAuthority = {
  ...actionAuthority,
  executor: { ...actionAuthority.executor, attestation_hash: hash('different-test-executor') },
};
assert.throws(() => OwnerKernel.resume({
  ledger: kernel.getLedger(),
  witness,
  adapters: actionAdapters,
  clock,
  actionAuthority: mismatchedExecutorAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'e'.repeat(64),
}), /executor.*binding|executor does not/i);
const mismatchedReceiptVerifierAuthority = {
  ...actionAuthority,
  receipt_verifier: {
    ...actionAuthority.receipt_verifier,
    attestation_hash: hash('different-receipt-verifier'),
  },
};
assert.throws(() => OwnerKernel.resume({
  ledger: kernel.getLedger(),
  witness,
  adapters: actionAdapters,
  clock,
  actionAuthority: mismatchedReceiptVerifierAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'f'.repeat(64),
}), /receipt verifier/i);
const mismatchedHostVerifierAuthority = {
  ...actionAuthority,
  host_capability_verifier: {
    ...actionAuthority.host_capability_verifier,
    attestation_hash: hash('different-host-capability-verifier'),
  },
};
assert.throws(() => OwnerKernel.resume({
  ledger: kernel.getLedger(),
  witness,
  adapters: actionAdapters,
  clock,
  actionAuthority: mismatchedHostVerifierAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'v'.repeat(64),
}), /host capability verifier/i);
const mismatchedWitness = {
  streamId: witness.streamId,
  trustTier: 'test',
  identity: 'wrong-witness',
  attestation_hash: hash('wrong-witness-attestation'),
  protocol_version: 1,
  append: witness.append.bind(witness),
  appendIfHead: witness.appendIfHead.bind(witness),
  verify: witness.verify.bind(witness),
  getHead: witness.getHead.bind(witness),
};
assert.throws(() => verifyLedger(kernel.getLedger(), {
  witness: mismatchedWitness,
  requireWitness: true,
}), /witness does not exactly match/i);
assert.throws(() => OwnerKernel.resume({
  ledger: kernel.getLedger(),
  witness: mismatchedWitness,
  adapters: actionAdapters,
  clock,
  actionAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'w'.repeat(64),
}), /witness does not exactly match/i);
const collidingWitnessBacking = new MemoryWitness({ streamId: 'colliding-witness' });
const collidingWitness = {
  streamId: collidingWitnessBacking.streamId,
  trustTier: 'test',
  identity: 'broker-a',
  attestation_hash: brokerAttestation,
  protocol_version: 1,
  append: collidingWitnessBacking.append.bind(collidingWitnessBacking),
  appendIfHead: collidingWitnessBacking.appendIfHead.bind(collidingWitnessBacking),
  verify: collidingWitnessBacking.verify.bind(collidingWitnessBacking),
  getHead: collidingWitnessBacking.getHead.bind(collidingWitnessBacking),
};
assert.throws(() => OwnerKernel.start({
  runId: 'colliding-witness-authority',
  governanceConfig: config,
  acceptanceContract: {
    schema_version: 1,
    contract_id: 'colliding-witness-contract',
    legs: [{ id: 'unit', kind: 'executable', command: 'true', artifact_hashes: [hash('colliding-witness')] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Colliding witness.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: collidingWitness,
  adapters: actionAdapters,
  clock,
  actionAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'z'.repeat(64),
}), /independently (identified|attested)/i);
const missingHeadBacking = new MemoryWitness({ streamId: 'authority-missing-head-witness' });
const missingHeadWitness = {
  streamId: missingHeadBacking.streamId,
  trustTier: 'test',
  append: missingHeadBacking.append.bind(missingHeadBacking),
  appendIfHead: missingHeadBacking.appendIfHead.bind(missingHeadBacking),
  verify: missingHeadBacking.verify.bind(missingHeadBacking),
};
assert.throws(() => OwnerKernel.start({
  runId: 'authority-missing-head',
  governanceConfig: config,
  acceptanceContract: {
    schema_version: 1,
    contract_id: 'authority-missing-head-contract',
    legs: [{ id: 'unit', kind: 'executable', command: 'true', artifact_hashes: [hash('authority-missing-head')] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Missing witness head probe.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: missingHeadWitness,
  adapters: actionAdapters,
  clock,
  actionAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'g'.repeat(64),
}), /getHead/);
const missingPermitWitness = new MemoryWitness({ streamId: 'missing-permit-witness' });
const missingPermitAuthority = {
  ...actionAuthority,
  host_capability_verifier: testHostCapabilityVerifier((request) => {
    return {
      ok: true,
      run_id: request.run_id,
      host_capability_hash: request.host_capability_hash,
      observation_hash: hash(`missing-permit:${request.operation}`),
      probe_nonce: request.probe_nonce,
    };
  }),
};
const missingPermitStarted = OwnerKernel.start({
  runId: 'missing-execution-permit',
  governanceConfig: config,
  acceptanceContract: {
    schema_version: 1,
    contract_id: 'missing-execution-permit-contract',
    legs: [{ id: 'unit', kind: 'executable', command: 'true', artifact_hashes: [hash('missing-execution-permit')] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Missing execution permit.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: missingPermitWitness,
  adapters: actionAdapters,
  clock,
  actionAuthority: missingPermitAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'h'.repeat(64),
});
const missingPermitDecision = missingPermitStarted.kernel.mintActionDecision({
  capability: missingPermitStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'missing-permit' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/missing-permit.txt'] },
});
const brokerCallsBeforeMissingPermit = brokerCalls;
await assert.rejects(
  missingPermitStarted.kernel.executeAuthorizedAction({
    decisionId: missingPermitDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/missing-permit.txt'] },
  }),
  /host capability/i,
);
assert.equal(brokerCalls, brokerCallsBeforeMissingPermit);
const resumed = OwnerKernel.resume({
  ledger: kernel.getLedger(),
  witness,
  adapters: actionAdapters,
  clock,
  actionAuthority,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  nonceFactory: () => 'c'.repeat(64),
});
assert.ok(resumed.owner_capability);
assert.equal(resumed.kernel.getState().authority_version, 1);

const recoveryWitness = new MemoryWitness({ streamId: 'pending-claim-recovery-witness' });
const recoveryCoordinator = {
  identity: 'acceptance-coordinator-recovery',
  trustTier: 'test',
  attestation_hash: hash('acceptance-coordinator-recovery'),
  protocol_version: 2,
  acquire() { throw new Error('acceptance is not exercised by pending-claim recovery'); },
  commit() { throw new Error('acceptance is not exercised by pending-claim recovery'); },
  requestAbort(request) {
    return { ok: true, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash, disposition: 'cancelled' };
  },
  cancel(request) {
    return { ok: true, run_id: request.run_id, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash, disposition: 'cancelled', coordinator_resolution: {} };
  },
  resolveAttempt(request) {
    return { ok: true, run_id: request.run_id, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash, disposition: 'cancelled', coordinator_resolution: {} };
  },
  verifyCommit() { return false; },
  verifyResolution() { return false; },
  release() { return { ok: true }; },
};
let pendingRecoveryCalls = 0;
let pendingRecoveryLeakedBearer = false;
let actionReconciliationMode = 'wrong_identity';
const recoveryManifest = [{ id: 'workspace', sha256: hash('recovery-workspace') }];
const recoveryManifestHash = hash(recoveryManifest);
const recoveryAdapters = {
  ...actionAdapters,
  evidenceArchiver({ verified_evidence }) {
    return {
      uri: `durable://recovery/${hash(verified_evidence)}`,
      sha256: hash(verified_evidence),
    };
  },
  pendingActionReconciler(request, context) {
    pendingRecoveryCalls += 1;
    pendingRecoveryLeakedBearer = Object.prototype.hasOwnProperty.call(request, 'execution_permit')
      || Object.prototype.hasOwnProperty.call(request, 'execution_authorization')
      || Object.prototype.hasOwnProperty.call(request, 'preclaim_authorization');
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'receipt-verifier-a',
      channel: 'test-pending-claim-recovery',
      envelope_hash: hash(`pending-recovery:${request.claim_id}`),
      payload: {
        attestation_sha256: hash('receipt-verifier-a'),
        verification_path: 'pending_action_reconciliation',
        claim_id: request.claim_id,
        reconciliation_hash: hash(`pending-reconciliation:${request.claim_id}`),
      },
    };
  },
  verificationVerifier(_request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'runner-a',
      channel: 'test-recovery-verification',
      envelope_hash: hash(`recovery-verification:${context.intent_id}`),
      payload: {
        emitter_kind: 'runner',
        verification_path: 'trusted_runner',
        attestation_sha256: hash('runner-a'),
        verification_id: `verification:${context.intent_id}`,
        intent_id: context.intent_id,
        leg_id: 'tests',
        outcome: 'green',
        command_hash: hash('true'),
        candidate_artifacts: recoveryManifest,
        candidate_set_hash: recoveryManifestHash,
        exit_code: 0,
        stdout_hash: hash('recovery-stdout'),
        stderr_hash: hash('recovery-stderr'),
        executed_at: clock(),
      },
    };
  },
  challengeVerifier(envelope, context) {
    const scope = envelope && envelope.scope ? envelope.scope : 'contract_leg';
    const scopeId = envelope && envelope.scope_id ? envelope.scope_id : 'tests';
    const finding = envelope && envelope.finding ? envelope.finding : 'clear';
    const candidateArtifacts = envelope && envelope.candidate_artifacts
      ? envelope.candidate_artifacts
      : recoveryManifest;
    const candidateSetHash = envelope && envelope.candidate_set_hash
      ? envelope.candidate_set_hash
      : recoveryManifestHash;
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'challenger-a',
      channel: 'test-recovery-challenge',
      envelope_hash: hash({ scope, scopeId, finding, intent: context.intent_id }),
      payload: {
        verification_path: 'qualified_challenge',
        attestation_sha256: hash('challenger-a'),
        challenge_id: envelope && envelope.challenge_id ? envelope.challenge_id : `challenge:${scope}:${scopeId}:${finding}`,
        intent_id: context.intent_id,
        scope,
        scope_id: scopeId,
        finding,
        candidate_artifacts: candidateArtifacts,
        candidate_set_hash: candidateSetHash,
        subject_identity: 'worker-a',
        subject_family: 'worker',
        result_hash: hash({ scope, scopeId, finding }),
        reviewed_at: clock(),
      },
    };
  },
  artifactProvenanceVerifier(request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: recoveryCoordinator.identity,
      channel: 'test-recovery-provenance',
      envelope_hash: hash({ provenance: request }),
      payload: {
        verification_path: 'artifact_provenance',
        attestation_sha256: recoveryCoordinator.attestation_hash,
        candidate_set_hash: request.candidate_set_hash,
        intent_id: context.intent_id,
        subject_identity: request.subject_identity,
        subject_family: request.subject_family,
      },
    };
  },
  auditVerifier(request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: recoveryCoordinator.identity,
      channel: 'test-recovery-audit',
      envelope_hash: hash({ audit: context.evaluated_event_head }),
      payload: {
        verification_path: 'acceptance_audit',
        attestation_sha256: recoveryCoordinator.attestation_hash,
        audit_head: hash({ audit: context.evaluated_event_head }),
        intent_id: context.intent_id,
        candidate_artifacts: recoveryManifest,
        candidate_set_hash: recoveryManifestHash,
        complete: true,
        action_claim_ids: request && Array.isArray(request.action_claim_ids)
          ? request.action_claim_ids
          : [reconciledClaimId],
        action_footprint_hash: context.action_footprint_hash,
        evaluated_event_head: context.evaluated_event_head,
        evaluated_witness_head: context.evaluated_witness_head,
        observed_at: clock(),
      },
    };
  },
  actionReconciliationVerifier(request, context) {
    const trustedIdentity = actionReconciliationMode !== 'wrong_identity';
    const useWrongAuthorization = actionReconciliationMode === 'wrong_authorization';
    const completedCancellation = request.outcome.cancellation
      && request.outcome.cancellation.state === 'completed'
      ? request.outcome.cancellation
      : null;
    const receipt = {
      uri: `file:///var/lib/autopilot/receipts/recovered-${request.claim_id}.json`,
      sha256: hash(`recovered-receipt:${request.claim_id}`),
    };
    const proof = {
      run_id: request.run_id,
      policy_hash: request.policy_hash,
      authority_hash: request.authority_hash,
      claim_id: request.claim_id,
      claim_event_hash: request.claim_event_hash,
      claim_witness_head: request.claim_witness_head,
      execution_permit_hash: request.execution_permit_hash,
      original_outcome_hash: request.original_outcome_hash,
      original_outcome_event_hash: request.original_outcome_event_hash,
      original_outcome_witness_head: request.original_outcome_witness_head,
      execution_authorization_hash: useWrongAuthorization
        ? hash(`wrong-authorization:${request.claim_id}`)
        : request.outcome.execution_authorization_hash,
      authorization_id: useWrongAuthorization
        ? `wrong-authorization:${request.claim_id}`
        : request.outcome.authorization_id,
      resolution: 'succeeded',
      observed_action_descriptor_hash: request.claim.action_descriptor_hash,
      receipt_ref: receipt,
      broker_receipt: { identity: 'broker-a', broker_uid: 1001 },
      boundary_effect_id: completedCancellation
        ? completedCancellation.boundary_effect_id
        : `recovered-effect:${request.claim_id}`,
      boundary_state_version: completedCancellation
        ? completedCancellation.boundary_state_version
        : 2,
      boundary_attestation_hash: brokerAttestation,
      effect_at: completedCancellation
        ? completedCancellation.effect_at
        : '2026-07-02T00:00:00.000Z',
      receipt_verifier_binding_hash: request.receipt_verifier_binding_hash,
      receipt_verifier_attestation_hash: request.receipt_verifier_attestation_hash,
      reconciled_at: completedCancellation
        ? completedCancellation.effect_at
        : '2026-07-02T00:00:00.000Z',
    };
    return {
      ok: true,
      run_id: context.run_id,
      identity: trustedIdentity ? 'receipt-verifier-a' : 'wrong-receipt-verifier',
      channel: 'test-action-reconciliation',
      envelope_hash: hash(`action-reconciliation:${request.claim_id}:${actionReconciliationMode}`),
      payload: {
        attestation_sha256: trustedIdentity ? hash('receipt-verifier-a') : hash('wrong-receipt-verifier'),
        verification_path: 'action_reconciliation',
        ...proof,
        reconciliation_hash: trustedIdentity ? actionReconciliationHash(proof) : hash(`action-reconciliation:${request.claim_id}`),
      },
    };
  },
};
const reconciliationActionAuthority = {
  ...actionAuthority,
  executor: {
    ...actionAuthority.executor,
    broker: {
      ...actionAuthority.executor.broker,
      async cancel(request) {
        brokerCancelCalls += 1;
        lastCancelRequest = request;
        return {
          ok: true,
          run_id: request.run_id,
          claim_id: request.claim_id,
          execution_permit_id: request.execution_permit_id,
          execution_permit_hash: request.execution_permit_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: request.authorization_id,
          cancellation_request_hash: request.cancellation_request_hash,
          state: 'completed',
          receipt: {
            uri: `file:///var/lib/autopilot/receipts/cancel-${request.claim_id}.json`,
            sha256: hash(`cancel:${request.claim_id}:${request.cancellation_request_hash}`),
          },
          broker: { identity: 'broker-a', broker_uid: 1001 },
          boundary_effect_id: `recovered-effect:${request.claim_id}`,
          boundary_state_version: 2,
          attestation_hash: brokerAttestation,
          received_at: request.execution_authorization.issued_at,
          effect_at: request.execution_authorization.issued_at,
        };
      },
    },
  },
};
const recoveryConfig = JSON.parse(JSON.stringify(config));
recoveryConfig.governance.owner_roster[0].family = 'owner';
recoveryConfig.governance.challenger_roster[0].family = 'challenger';
recoveryConfig.governance.trusted_runner_roster[0].family = 'runner';
const recoveryStarted = OwnerKernel.start({
  runId: 'pending-claim-recovery',
  governanceConfig: recoveryConfig,
  acceptanceContract: {
    schema_version: 2,
    contract_id: 'pending-claim-recovery-contract',
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [{ id: 'tests', kind: 'executable', command: 'true', artifact_ids: ['workspace'] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Recover a claimed action.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: recoveryWitness,
  adapters: recoveryAdapters,
  clock,
  actionAuthority: reconciliationActionAuthority,
  acceptanceAuthority: recoveryCoordinator,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  allowTestAcceptanceCoordinator: true,
  nonceFactory: () => 'i'.repeat(64),
});
const reconciliationDecision = recoveryStarted.kernel.mintActionDecision({
  capability: recoveryStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'completed-cancellation-reconciliation' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/reconcile.txt'] },
});
receiptMismatch = true;
const reconciledUnknown = await recoveryStarted.kernel.executeAuthorizedAction({
  decisionId: reconciliationDecision.payload.decision_id,
  action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/reconcile.txt'] },
});
receiptMismatch = false;
const reconciledClaimId = reconciledUnknown.claim.payload.claim_id;
assert.equal(reconciledUnknown.outcome.payload.outcome, 'unknown');
assert.equal(reconciledUnknown.outcome.payload.cancellation.state, 'completed');
assert.equal(typeof reconciledUnknown.outcome.payload.execution_authorization_hash, 'string');
const witnessHeadBeforeBadReconciliation = recoveryWitness.head;
const eventsBeforeBadReconciliation = recoveryStarted.kernel.getLedger().events.length;
actionReconciliationMode = 'wrong_authorization';
assert.throws(() => recoveryStarted.kernel.reconcileActionClaim(reconciledClaimId), /authorization does not match/i);
assert.equal(recoveryWitness.head, witnessHeadBeforeBadReconciliation);
assert.equal(recoveryStarted.kernel.getLedger().events.length, eventsBeforeBadReconciliation);
actionReconciliationMode = 'correct';
const reconciliation = recoveryStarted.kernel.reconcileActionClaim(reconciledClaimId);
assert.equal(reconciliation.payload.evidence_kind, 'action_reconciliation');
assert.equal(recoveryStarted.kernel.getState().action_reconciliations[reconciledClaimId].resolution, 'succeeded');
assert.equal(recoveryStarted.kernel.getState().block_reasons.includes(`action_outcome:${reconciledClaimId}`), false);
assert.equal(verifyLedger(recoveryStarted.kernel.getLedger(), {
  witness: recoveryWitness,
  requireWitness: true,
}).state.action_reconciliations[reconciledClaimId].resolution, 'succeeded');
recoveryStarted.kernel.recordVerification({ purpose: 'post-reconciliation-tests' });
recoveryStarted.kernel.recordChallenge({ purpose: 'post-reconciliation-review', scope_id: 'tests' });
const recoveryAudit = recoveryStarted.kernel.recordAuditReconciliation({
  purpose: 'post-reconciliation-audit',
  action_claim_ids: [reconciledClaimId],
});
const predicateState = recoveryStarted.kernel.getState();
predicateState.acceptance_attempt = {
  status: 'pending',
  expected_event_head: recoveryAudit.event_hash,
  expected_witness_head: recoveryAudit.witness.witness_head,
};
const postReconciliationPredicate = evaluateAcceptancePredicate(predicateState, {
  candidate_artifacts: recoveryManifest,
  delivered_artifacts: recoveryManifest,
  candidate_set_hash: recoveryManifestHash,
  audit_head: recoveryAudit.payload.audit_head,
  snapshot_at: clock(),
});
assert.equal(postReconciliationPredicate.ok, true, postReconciliationPredicate.reasons.join(','));

const actionChallengeConfig = JSON.parse(JSON.stringify(recoveryConfig));
actionChallengeConfig.governance.action_catalog[0].requires_challenge = true;
const actionChallengeWitness = new MemoryWitness({ streamId: 'v2-action-challenge-witness' });
const actionChallengeStarted = OwnerKernel.start({
  runId: 'v2-action-challenge',
  governanceConfig: actionChallengeConfig,
  acceptanceContract: {
    schema_version: 2,
    contract_id: 'v2-action-challenge-contract',
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [{ id: 'tests', kind: 'executable', command: 'true', artifact_ids: ['workspace'] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Write one governed file.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: actionChallengeWitness,
  adapters: recoveryAdapters,
  clock,
  actionAuthority,
  acceptanceAuthority: recoveryCoordinator,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  allowTestAcceptanceCoordinator: true,
  nonceFactory: () => 'm'.repeat(64),
});
const actionChallengePolicy = resolveGovernancePolicy(actionChallengeConfig).policy;
const requiredChallengeDescriptor = normalizeActionDescriptor(actionChallengePolicy, {
  operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'],
});
const requiredChallengeDescriptorHash = actionDescriptorHash(requiredChallengeDescriptor);
actionChallengeStarted.kernel.recordAuditReconciliation({
  purpose: 'pre-action-challenge-audit',
  action_claim_ids: [],
});
const staleChallengeManifest = [{ id: 'workspace', sha256: hash('stale-action-candidate') }];
const staleChallengeManifestHash = hash(staleChallengeManifest);
actionChallengeStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: requiredChallengeDescriptorHash,
  challenge_id: 'action-challenge-stale-candidate',
  candidate_artifacts: staleChallengeManifest,
  candidate_set_hash: staleChallengeManifestHash,
});
assert.throws(() => actionChallengeStarted.kernel.mintActionDecision({
  capability: actionChallengeStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'missing-action-challenge' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'] },
}), /requires a current qualified independent challenge/i);
actionChallengeStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: requiredChallengeDescriptorHash,
  challenge_id: 'action-challenge-clear',
});
const challengedDecision = actionChallengeStarted.kernel.mintActionDecision({
  capability: actionChallengeStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'bound-action-challenge' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'] },
});
assert.equal(challengedDecision.payload.action_challenge_id, 'action-challenge-clear');
assert.equal(challengedDecision.payload.action_challenge_candidate_set_hash, recoveryManifestHash);
const challengedExecution = await actionChallengeStarted.kernel.executeAuthorizedAction({
  decisionId: challengedDecision.payload.decision_id,
  action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'] },
});
assert.equal(challengedExecution.outcome.payload.outcome, 'succeeded');
assert.equal(challengedExecution.claim.payload.action_challenge_id, 'action-challenge-clear');
assert.equal(challengedExecution.claim.payload.action_challenge_candidate_set_hash, recoveryManifestHash);
assert.throws(() => actionChallengeStarted.kernel.mintActionDecision({
  capability: actionChallengeStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'stale-audit-action-challenge' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'] },
}), /requires a current qualified independent challenge/i);
actionChallengeStarted.kernel.recordAuditReconciliation({
  purpose: 'post-action-challenge-audit',
  action_claim_ids: [challengedExecution.claim.payload.claim_id],
});
const actionAuditCheckpoint = actionChallengeStarted.kernel.checkpoint();
assert.equal(actionAuditCheckpoint.type, 'checkpoint');
const actionAuditVerified = verifyLedger(actionChallengeStarted.kernel.getLedger(), {
  witness: actionChallengeWitness,
  requireWitness: true,
});
const actionAuditReplay = replayFromLatestCheckpoint(
  actionChallengeStarted.kernel.getLedger(),
  actionAuditVerified,
);
assert.deepEqual(
  currentActionCandidateAudit(actionAuditReplay.state),
  currentActionCandidateAudit(actionChallengeStarted.kernel.getState()),
);
const blockedChallengeDescriptor = normalizeActionDescriptor(actionChallengePolicy, {
  operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge-blocked.txt'],
});
actionChallengeStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: actionDescriptorHash(blockedChallengeDescriptor),
  challenge_id: 'action-challenge-clear-blocked-target',
});
const blockedChallengeDecision = actionChallengeStarted.kernel.mintActionDecision({
  capability: actionChallengeStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'challenge-before-blocking-finding' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge-blocked.txt'] },
});
actionChallengeStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: blockedChallengeDecision.payload.action_descriptor_hash,
  challenge_id: 'action-challenge-blocking',
  finding: 'blocking',
});
await assert.rejects(
  actionChallengeStarted.kernel.executeAuthorizedAction({
    decisionId: blockedChallengeDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge-blocked.txt'] },
  }),
  /requires challenge evidence/i,
);
const expiringBlockerConfig = JSON.parse(JSON.stringify(actionChallengeConfig));
expiringBlockerConfig.governance.challenger_roster.push({
  identity: 'challenger-b',
  model_alias: 'challenger-b',
  model_version: '1',
  family: 'blocker',
  runner: 'test',
  role: 'challenger',
  attestation: {
    issuer: 'test',
    uri: 'test://challenger-b',
    sha256: hash('challenger-b'),
    issued_at: '2026-07-01T00:00:00.000Z',
    expires_at: '2026-07-02T00:00:05.000Z',
  },
});
let expiringBlockerAt = '2026-07-02T00:00:00.000Z';
const expiringBlockerClock = () => expiringBlockerAt;
const expiringBlockerAdapters = {
  ...recoveryAdapters,
  challengeVerifier(envelope, context) {
    const response = recoveryAdapters.challengeVerifier(envelope, context);
    const challengerId = envelope && envelope.challenger_id ? envelope.challenger_id : 'challenger-a';
    const challenger = expiringBlockerConfig.governance.challenger_roster.find((entry) => (
      entry.identity === challengerId
    ));
    response.identity = challengerId;
    response.payload.attestation_sha256 = challenger.attestation.sha256;
    response.payload.reviewed_at = expiringBlockerAt;
    return response;
  },
  auditVerifier(request, context) {
    const response = recoveryAdapters.auditVerifier(request, context);
    response.payload.observed_at = expiringBlockerAt;
    return response;
  },
};
const expiringBlockerWitness = new MemoryWitness({ streamId: 'expired-blocker-witness' });
const expiringBlockerStarted = OwnerKernel.start({
  runId: 'expired-action-blocker',
  governanceConfig: expiringBlockerConfig,
  acceptanceContract: {
    schema_version: 2,
    contract_id: 'expired-action-blocker-contract',
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [{ id: 'tests', kind: 'executable', command: 'true', artifact_ids: ['workspace'] }],
  },
  initialIntentEnvelope: { signed: true, payload: { text: 'Do not bypass a durable blocker.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: expiringBlockerWitness,
  adapters: expiringBlockerAdapters,
  clock: expiringBlockerClock,
  actionAuthority,
  acceptanceAuthority: recoveryCoordinator,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  allowTestAcceptanceCoordinator: true,
  nonceFactory: () => 'x'.repeat(64),
});
const expiringBlockerPolicy = resolveGovernancePolicy(expiringBlockerConfig).policy;
const expiringBlockerDescriptor = normalizeActionDescriptor(expiringBlockerPolicy, {
  operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/expired-blocker.txt'],
});
const expiringBlockerDescriptorHash = actionDescriptorHash(expiringBlockerDescriptor);
expiringBlockerStarted.kernel.recordAuditReconciliation({ purpose: 'expired-blocker-audit', action_claim_ids: [] });
expiringBlockerStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: expiringBlockerDescriptorHash,
  challenge_id: 'long-lived-clear-action-challenge',
  challenger_id: 'challenger-a',
});
const expiringBlockerDecision = expiringBlockerStarted.kernel.mintActionDecision({
  capability: expiringBlockerStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'freeze-clear-before-blocker' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/expired-blocker.txt'] },
});
expiringBlockerStarted.kernel.recordChallenge({
  scope: 'action',
  scope_id: expiringBlockerDecision.payload.action_descriptor_hash,
  challenge_id: 'expired-blocking-action-challenge',
  challenger_id: 'challenger-b',
  finding: 'blocking',
});
expiringBlockerAt = '2026-07-02T00:00:10.000Z';
await assert.rejects(
  expiringBlockerStarted.kernel.executeAuthorizedAction({
    decisionId: expiringBlockerDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/expired-blocker.txt'] },
  }),
  /requires challenge evidence/i,
);
const expiredBlockerLedger = expiringBlockerStarted.kernel.getLedger();
const expiredBlockerState = expiringBlockerStarted.kernel.getState();
const expiredBlockerClaim = {
  evidence_id: 'expired-blocker-forged-claim',
  evidence_kind: 'action_claim',
  claim_id: 'expired-blocker-forged-claim',
  decision_id: expiringBlockerDecision.payload.decision_id,
  decision_content_hash: expiringBlockerDecision.payload.decision_content_hash,
  action_descriptor_hash: expiringBlockerDecision.payload.action_descriptor_hash,
  claimed_use: 1,
  host_capability_hash: expiredBlockerLedger.header.authority.host_capability_hash,
  host_observation_hash: hash('expired-blocker-observation'),
  host_probe_nonce_commitment: hash('expired-blocker-nonce'),
  execution_permit_id: 'expired-blocker-permit',
  execution_permit_hash: hash('expired-blocker-permit'),
  executor_binding_hash: expiredBlockerLedger.header.authority.executor_binding_hash,
  pre_action_witness_head: expiredBlockerState.witness_head,
  action_challenge_id: expiringBlockerDecision.payload.action_challenge_id,
  action_challenge_candidate_set_hash: expiringBlockerDecision.payload.action_challenge_candidate_set_hash,
};
const expiredBlockerProvisional = prepareEvent({
  sequence: expiredBlockerState.sequence + 1,
  runId: expiredBlockerLedger.header.run_id,
  type: 'evidence',
  emittedAt: expiringBlockerAt,
  emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'test-expired-blocker-claim' },
  policyHash: expiredBlockerLedger.header.policy_hash,
  contractHash: expiredBlockerLedger.header.contract_hash,
  authorityHash: expiredBlockerLedger.header.authority_hash,
  acceptanceAuthorityHash: expiredBlockerLedger.header.acceptance_authority_hash,
  payload: expiredBlockerClaim,
  prevEventHash: expiredBlockerState.event_head,
});
const expiredBlockerReceipt = expiringBlockerWitness.appendIfHead({
  run_id: expiredBlockerLedger.header.run_id,
  stream_id: expiringBlockerWitness.streamId,
  sequence: expiredBlockerProvisional.sequence,
  event_hash: expiredBlockerProvisional.event_hash,
  previous_witness_head: expiredBlockerState.witness_head,
  expected_witness_head: expiredBlockerState.witness_head,
});
expiredBlockerLedger.events.push(buildEvent({
  sequence: expiredBlockerProvisional.sequence,
  runId: expiredBlockerProvisional.run_id,
  type: expiredBlockerProvisional.type,
  emittedAt: expiredBlockerProvisional.emitted_at,
  emitter: expiredBlockerProvisional.emitter,
  policyHash: expiredBlockerProvisional.policy_hash,
  contractHash: expiredBlockerProvisional.contract_hash,
  authorityHash: expiredBlockerProvisional.authority_hash,
  acceptanceAuthorityHash: expiredBlockerProvisional.acceptance_authority_hash,
  payload: expiredBlockerProvisional.payload,
  prevEventHash: expiredBlockerProvisional.prev_event_hash,
  witness: expiredBlockerReceipt,
}));
assert.throws(() => verifyLedger(expiredBlockerLedger, {
  witness: expiringBlockerWitness,
  requireWitness: true,
}), /qualified blocking action challenge/i);
const forgedChallengeLedger = actionChallengeStarted.kernel.getLedger();
const forgedChallengeState = actionChallengeStarted.kernel.getState();
const forgedClaimPayload = {
  evidence_id: 'forged-action-challenge-claim',
  evidence_kind: 'action_claim',
  claim_id: 'forged-action-challenge-claim',
  decision_id: blockedChallengeDecision.payload.decision_id,
  decision_content_hash: blockedChallengeDecision.payload.decision_content_hash,
  action_descriptor_hash: blockedChallengeDecision.payload.action_descriptor_hash,
  claimed_use: 1,
  host_capability_hash: forgedChallengeLedger.header.authority.host_capability_hash,
  host_observation_hash: hash('forged-action-challenge-observation'),
  host_probe_nonce_commitment: hash('forged-action-challenge-nonce'),
  execution_permit_id: 'forged-action-challenge-permit',
  execution_permit_hash: hash('forged-action-challenge-permit'),
  executor_binding_hash: forgedChallengeLedger.header.authority.executor_binding_hash,
  pre_action_witness_head: forgedChallengeState.witness_head,
};
const forgedChallengeProvisional = prepareEvent({
  sequence: forgedChallengeState.sequence + 1,
  runId: forgedChallengeLedger.header.run_id,
  type: 'evidence',
  emittedAt: clock(),
  emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'test-forged-action-challenge' },
  policyHash: forgedChallengeLedger.header.policy_hash,
  contractHash: forgedChallengeLedger.header.contract_hash,
  authorityHash: forgedChallengeLedger.header.authority_hash,
  acceptanceAuthorityHash: forgedChallengeLedger.header.acceptance_authority_hash,
  payload: forgedClaimPayload,
  prevEventHash: forgedChallengeState.event_head,
});
const forgedChallengeReceipt = actionChallengeWitness.appendIfHead({
  run_id: forgedChallengeLedger.header.run_id,
  stream_id: actionChallengeWitness.streamId,
  sequence: forgedChallengeProvisional.sequence,
  event_hash: forgedChallengeProvisional.event_hash,
  previous_witness_head: forgedChallengeState.witness_head,
  expected_witness_head: forgedChallengeState.witness_head,
});
forgedChallengeLedger.events.push(buildEvent({
  sequence: forgedChallengeProvisional.sequence,
  runId: forgedChallengeProvisional.run_id,
  type: forgedChallengeProvisional.type,
  emittedAt: forgedChallengeProvisional.emitted_at,
  emitter: forgedChallengeProvisional.emitter,
  policyHash: forgedChallengeProvisional.policy_hash,
  contractHash: forgedChallengeProvisional.contract_hash,
  authorityHash: forgedChallengeProvisional.authority_hash,
  acceptanceAuthorityHash: forgedChallengeProvisional.acceptance_authority_hash,
  payload: forgedChallengeProvisional.payload,
  prevEventHash: forgedChallengeProvisional.prev_event_hash,
  witness: forgedChallengeReceipt,
}));
assert.throws(() => verifyLedger(forgedChallengeLedger, {
  witness: actionChallengeWitness,
  requireWitness: true,
}), /must exactly carry the decision-frozen action challenge binding/i);

const recoveryDecision = recoveryStarted.kernel.mintActionDecision({
  capability: recoveryStarted.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'pending-claim' },
  actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/recovery.txt'] },
});
const pendingLedger = recoveryStarted.kernel.getLedger();
const pendingState = recoveryStarted.kernel.getState();
const pendingClaimPayload = {
  evidence_id: 'pending-claim-evidence',
  evidence_kind: 'action_claim',
  claim_id: 'pending-claim-1',
  decision_id: recoveryDecision.payload.decision_id,
  decision_content_hash: recoveryDecision.payload.decision_content_hash,
  action_descriptor_hash: recoveryDecision.payload.action_descriptor_hash,
  claimed_use: 1,
  host_capability_hash: pendingLedger.header.authority.host_capability_hash,
  host_observation_hash: hash('pending-claim-host-observation'),
  host_probe_nonce_commitment: hash('pending-claim-probe-nonce'),
  execution_permit_id: 'pending-claim-permit',
  execution_permit_hash: hash('pending-claim-permit'),
  executor_binding_hash: pendingLedger.header.authority.executor_binding_hash,
  pre_action_witness_head: pendingState.witness_head,
};
const pendingProvisional = prepareEvent({
  sequence: pendingState.sequence + 1,
  runId: pendingLedger.header.run_id,
  type: 'evidence',
  emittedAt: '2026-07-02T00:02:00.000Z',
  emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'test-pending-claim' },
  policyHash: pendingLedger.header.policy_hash,
  contractHash: pendingLedger.header.contract_hash,
  authorityHash: pendingLedger.header.authority_hash,
  acceptanceAuthorityHash: pendingLedger.header.acceptance_authority_hash,
  payload: pendingClaimPayload,
  prevEventHash: pendingState.event_head,
});
const pendingReceipt = recoveryWitness.appendIfHead({
  run_id: pendingLedger.header.run_id,
  stream_id: recoveryWitness.streamId,
  sequence: pendingProvisional.sequence,
  event_hash: pendingProvisional.event_hash,
  previous_witness_head: pendingState.witness_head,
  expected_witness_head: pendingState.witness_head,
});
const pendingClaimEvent = buildEvent({
  sequence: pendingProvisional.sequence,
  runId: pendingProvisional.run_id,
  type: pendingProvisional.type,
  emittedAt: pendingProvisional.emitted_at,
  emitter: pendingProvisional.emitter,
  policyHash: pendingProvisional.policy_hash,
  contractHash: pendingProvisional.contract_hash,
  authorityHash: pendingProvisional.authority_hash,
  acceptanceAuthorityHash: pendingProvisional.acceptance_authority_hash,
  payload: pendingProvisional.payload,
  prevEventHash: pendingProvisional.prev_event_hash,
  witness: pendingReceipt,
});
pendingLedger.events.push(pendingClaimEvent);
assert.equal(verifyLedger(pendingLedger, { witness: recoveryWitness, requireWitness: true })
  .state.action_claims['pending-claim-1'].outcome, null);
const { pendingActionReconciler: _pendingActionReconciler, ...missingPendingRecoveryAdapters } = recoveryAdapters;
assert.throws(() => OwnerKernel.resume({
  ledger: pendingLedger,
  witness: recoveryWitness,
  adapters: missingPendingRecoveryAdapters,
  clock,
  actionAuthority,
  acceptanceAuthority: recoveryCoordinator,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  allowTestAcceptanceCoordinator: true,
  nonceFactory: () => 'j'.repeat(64),
}), /pendingActionReconciler/);
const brokerCallsBeforeRecoveryResume = brokerCalls;
const recovered = OwnerKernel.resume({
  ledger: pendingLedger,
  witness: recoveryWitness,
  adapters: recoveryAdapters,
  clock,
  actionAuthority,
  acceptanceAuthority: recoveryCoordinator,
  allowTestWitness: true,
  allowTestActionExecutor: true,
  allowTestAcceptanceCoordinator: true,
  nonceFactory: () => 'k'.repeat(64),
});
assert.equal(pendingRecoveryCalls, 1);
assert.equal(pendingRecoveryLeakedBearer, false);
assert.equal(brokerCalls, brokerCallsBeforeRecoveryResume);
assert.equal(recovered.kernel.getState().action_claims['pending-claim-1'].outcome, 'unknown');
assert.ok(recovered.kernel.getState().block_reasons.some((reason) => reason === 'action_outcome:pending-claim-1'));
assert.throws(() => recovered.kernel.reconcileActionClaim('pending-claim-1'), /never held a witnessed post-claim authorization/);
actionReconciliationMode = 'correct';
assert.throws(() => recovered.kernel.reconcileActionClaim('pending-claim-1'), /never held a witnessed post-claim authorization/);
assert.ok(recovered.kernel.getState().block_reasons.includes('action_outcome:pending-claim-1'));
assert.equal(verifyLedger(recovered.kernel.getLedger(), { witness: recoveryWitness, requireWitness: true })
  .state.action_reconciliations['pending-claim-1'], undefined);

console.log('catalog_classification=ok');
console.log('host_coverage=ok');
console.log('mediator_boundary=ok');
console.log('pre_action_claim=ok');
console.log('capability_revalidation=ok');
console.log('pending_claim_recovery=ok');
console.log('completed_reconciliation=ok');
console.log('action_challenge_binding=ok');
console.log('action_audit_checkpoint_replay=ok');
console.log('durable_action_blocking=ok');
console.log(JSON.stringify({
  corpus_evidence: {
    baseline_categories: {
      irreversible_action: 'escalate',
      mislabeled_reversibility: 'escalate',
      unknown_decision_class: 'escalate',
    },
  },
}));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "Owner action catalog process exits cleanly"
assert_contains "$OUT" "catalog_classification=ok" "Action catalog classifies exact descriptors and blocks downgrades"
assert_contains "$OUT" "host_coverage=ok" "Full and partial host capability coverage is fail-closed"
assert_contains "$OUT" "mediator_boundary=ok" "Test executor and same-UID broker cannot claim production authority"
assert_contains "$OUT" "pre_action_claim=ok" "Approved actions are claimed before execution and cannot reuse a consumed approval"
assert_contains "$OUT" "capability_revalidation=ok" "Host regression, none-tier intake, and mismatched executor output fail closed"
assert_contains "$OUT" "pending_claim_recovery=ok" "P2b resume settles a pending action as unknown without replaying its side effect"
assert_contains "$OUT" "completed_reconciliation=ok" "Completed cancellation reconciliation is exact and malformed proofs do not advance the witness"
assert_contains "$OUT" "action_challenge_binding=ok" "V2 action challenges bind a current audited candidate and reject stale, blocking, and forged bindings"
assert_contains "$OUT" "action_audit_checkpoint_replay=ok" "Current action-audit selection survives checkpoint and deterministic replay"
assert_contains "$OUT" "durable_action_blocking=ok" "A record-time-qualified blocking action challenge remains a durable veto after reviewer expiry"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
