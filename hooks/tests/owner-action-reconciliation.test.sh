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
  resolveGovernancePolicy,
  sha256,
  validateHostCapabilityCoverage,
  verifyLedger,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

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
assert.equal(actionMatchesDescriptor(policy, deploy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-b', 'service-a'],
}), true);
assert.equal(actionMatchesDescriptor(policy, deploy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --staging', targets: ['service-a', 'service-b'],
}), false);
assert.equal(typeof actionDescriptorHash(deploy), 'string');
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'deploy', tool_class: 'network', command: 'deploy --prod', targets: ['service-a'],
}, { declaredActionClass: 'reversible' }), /cannot lower/);
assert.throws(() => normalizeActionDescriptor(policy, {
  operation: 'unknown', tool_class: 'network', targets: ['service-a'],
}), /not classified/);
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

console.log('catalog_classification=ok');
console.log('host_coverage=ok');
console.log('mediator_boundary=ok');
console.log('pre_action_claim=ok');
console.log('capability_revalidation=ok');
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

finalize_test
