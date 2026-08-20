#!/usr/bin/env bash
# Keeper coverage for src/engine/owner-kernel/actions.js + policy.js catalog surface,
# extracted from owner-action-reconciliation.test.sh when the kernel trust machinery
# was retired (docs/plans/2026-08-16-owner-kernel-retirement.md P2). The kernel-driven
# sections of the original are recoverable via the plan's quarry anchor.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];
const {
  actionDescriptorHash,
  actionMatchesDescriptor,
  normalizeActionAuthority,
  normalizeActionDescriptor,
  normalizeExecutionPermit,
  normalizeHostCapability,
  resolveGovernancePolicy,
  sha256,
  validateHostCapabilityCoverage,
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
console.log('catalog_classification=ok');
console.log('host_coverage=ok');
console.log('action_authority=ok');
}
main().then(() => { console.log('keeper_actions=ok'); }).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
NODE
)"; EXIT=$?

assert_eq "$EXIT" 0 "Keeper action-catalog process exits cleanly"
assert_contains "$OUT" "catalog_classification=ok" "Action catalog classifies exact descriptors and blocks downgrades"
assert_contains "$OUT" "host_coverage=ok" "Full and partial host capability coverage is fail-closed"
assert_contains "$OUT" "action_authority=ok" "Action authority normalization enforces broker separation"
assert_contains "$OUT" "keeper_actions=ok" "Keeper assertions completed"

finalize_test
