#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];
const kernelRoot = path.join(root, 'src', 'engine', 'owner-kernel');
const {
  MemoryWitness,
  OwnerKernel,
  canonicalJson,
  sha256,
  verifyLedger,
} = require(kernelRoot);
const { buildEvent, prepareEvent } = require(path.join(kernelRoot, 'events'));
const { applyEvent } = require(path.join(kernelRoot, 'state'));

const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
let at = '2026-07-02T00:00:00.000Z';
const brokerAttestation = hash('broker-a-attestation');
const hostVerifierAttestation = hash('host-capability-verifier-a-attestation');

function attestation(identity) {
  return {
    issuer: 'test',
    uri: `test://${identity}`,
    sha256: hash(`attestation:${identity}`),
    issued_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
  };
}

function roster(identity, role) {
  return {
    identity,
    model_alias: identity,
    model_version: '1',
    family: 'test',
    runner: 'test',
    role,
    attestation: attestation(identity),
  };
}

function config({
  actionCatalog = true,
  challenge = false,
  checkpointInterval = 100,
  requiresMediator = true,
} = {}) {
  return {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led',
      owner_roster: [roster('owner-a', 'owner')],
      challenger_roster: [roster('challenger-a', 'challenger')],
      trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 },
        reversible: { requires_approval: false, max_uses: 2 },
        external: { requires_approval: true, max_uses: 1 },
        irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: checkpointInterval,
      max_blocked_duration_seconds: 86400,
      ...(actionCatalog ? {
        action_catalog: [{
          id: 'write-file',
          operation: 'write_file',
          tool_class: 'filesystem',
          action_class: 'reversible',
          command_required: false,
          requires_mediator: requiresMediator,
          requires_challenge: challenge,
        }],
      } : {}),
    },
  };
}

const contract = (id) => ({
  schema_version: 1,
  contract_id: id,
  legs: [{ id: 'unit', kind: 'executable', command: 'true', artifact_hashes: [hash(`artifact:${id}`)] }],
});

const adapters = {
  userInputVerifier(envelope, kind, context) {
    if (!envelope || envelope.signed !== true) return { ok: false };
    return {
      ok: true,
      kind,
      run_id: context.run_id,
      identity: 'user-a',
      channel: 'host-user',
      envelope_hash: hash({ kind, payload: envelope.payload }),
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
      channel: 'host-owner',
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
      attestation_sha256: attestation(candidate_id).sha256,
    };
  },
  qualificationVerifier({ principal, run_id }) {
    return {
      ok: true,
      run_id,
      principal_id: principal.identity,
      attestation_sha256: principal.attestation.sha256,
    };
  },
};

function capability({ brokered = true } = {}) {
  return {
    schema_version: 1,
    tier: 'full',
    probe_id: 'host-probe',
    probed_at: '2026-07-01T00:00:00.000Z',
    expires_at: '2026-12-01T00:00:00.000Z',
    preventive_action_ids: ['write-file'],
    audited_action_ids: ['write-file'],
    mediated_action_ids: brokered ? ['write-file'] : [],
    broker: brokered ? {
      kind: 'external-broker',
      identity: 'broker-a',
      worker_uid: 1000,
      broker_uid: 1001,
      receipt_root: '/var/lib/autopilot/receipts',
      permit_revocation: true,
      attestation_hash: brokerAttestation,
      protocol_version: 1,
    } : null,
  };
}

function executionPermit(request) {
  return {
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
  };
}

function executionAuthorization(request, controls) {
  return {
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
    expires_at: controls.authorization_expires_at || request.execution_permit.expires_at,
    attestation_hash: hash(`authorization:${request.claim_id}`),
    issuer: 'host-capability-verifier-a',
    issuer_attestation_hash: hostVerifierAttestation,
    authorization: `authorization:${request.claim_id}`,
  };
}

function authority(controls) {
  return {
    host_capability: capability({ brokered: controls.direct !== true }),
    host_capability_verifier: {
      identity: 'host-capability-verifier-a',
      trustTier: 'test',
      attestation_hash: hostVerifierAttestation,
      probe(request) {
        if (controls.host_available === false) {
          return {
            ok: false,
            run_id: request.run_id,
            host_capability_hash: hash('host-regressed'),
            observation_hash: hash(`regressed:${request.probe_nonce}`),
            probe_nonce: request.probe_nonce,
            reason: 'host_lost_prevention',
          };
        }
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: hash(`probe:${request.operation}:${request.probe_nonce}`),
          probe_nonce: request.probe_nonce,
        };
        if (request.operation === 'pre_action') response.execution_permit = executionPermit(request);
        if (request.operation === 'post_claim') {
          response.execution_authorization = executionAuthorization(request, controls);
          if (typeof controls.on_post_claim_probe === 'function') controls.on_post_claim_probe(request);
          if (controls.expire_after_authorization === true) at = '2026-07-02T00:05:00.000Z';
        }
        return response;
      },
    },
    receipt_verifier: {
      identity: 'receipt-verifier-a',
      trustTier: 'test',
      attestation_hash: hash('receipt-verifier-a'),
      verify(request) {
        if (request.operation === 'verify_cancellation') {
          if (!controls.cancellation_verifier_mismatch) return request.acknowledgement;
          return {
            ...request.acknowledgement,
            boundary_state_version: request.acknowledgement.boundary_state_version + 1,
          };
        }
        const response = {
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
          observed_action: controls.last_request.action,
        };
        if (controls.delay_verifier) {
          return new Promise((resolve, reject) => {
            const cancel = () => reject(new Error('receipt verification cancelled'));
            if (controls.honor_abort && request.abort_signal) {
              request.abort_signal.addEventListener('abort', cancel, { once: true });
            }
            controls.release_verifier = () => {
              if (request.abort_signal) request.abort_signal.removeEventListener('abort', cancel);
              resolve(response);
            };
          });
        }
        return response;
      },
    },
    executor: {
      trustTier: 'test',
      identity: 'worker-a',
      attestation_hash: hash('worker-a-attestation'),
      worker_uid: 1000,
        broker: {
          identity: 'broker-a',
          broker_uid: 1001,
          receipt_root: '/var/lib/autopilot/receipts',
          attestation_hash: brokerAttestation,
          protocol_version: 1,
          async execute(request) {
          controls.calls += 1;
          controls.last_request = request;
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
            effect_at: controls.effect_at || at,
          };
          if (controls.hold) {
            return new Promise((resolve, reject) => {
              const cancel = () => reject(new Error('broker action cancelled'));
              if (controls.honor_abort && request.abort_signal) {
                request.abort_signal.addEventListener('abort', cancel, { once: true });
              }
              controls.release = () => {
                if (request.abort_signal) request.abort_signal.removeEventListener('abort', cancel);
                resolve(result);
              };
            });
          }
          return result;
        },
        async cancel(request) {
          controls.cancel_calls = (controls.cancel_calls || 0) + 1;
          controls.last_cancel_request = request;
          const state = controls.cancellation_state || 'revoked';
          return {
            ok: true,
            run_id: request.run_id,
            claim_id: request.claim_id,
            execution_permit_id: request.execution_permit_id,
            execution_permit_hash: request.execution_permit_hash,
            execution_authorization_hash: request.execution_authorization_hash,
            authorization_id: request.authorization_id,
            cancellation_request_hash: request.cancellation_request_hash,
            state,
            receipt: {
              uri: `file:///var/lib/autopilot/receipts/cancel-${request.claim_id}.json`,
              sha256: hash(`cancel:${request.claim_id}:${request.cancellation_request_hash}`),
            },
            broker: { identity: 'broker-a', broker_uid: 1001 },
            boundary_effect_id: state === 'completed' ? `effect:${request.claim_id}` : null,
            boundary_state_version: 2,
            attestation_hash: brokerAttestation,
            received_at: at,
            effect_at: state === 'completed' ? (controls.cancellation_effect_at || null) : null,
          };
        },
      },
    },
  };
}

function directAuthority(controls) {
  const directAttestation = hash('direct-executor-a-attestation');
  controls.direct = true;
  const result = authority(controls);
  result.executor = {
    trustTier: 'test',
    identity: 'direct-executor-a',
    attestation_hash: directAttestation,
    async execute(request) {
      controls.calls += 1;
      controls.last_request = request;
      const response = {
        receipt: {
          uri: `file:///var/lib/autopilot/direct-receipts/${request.claim_id}.json`,
          sha256: hash(`direct-receipt:${request.claim_id}`),
        },
        execution_permit_hash: request.execution_permit_hash,
        execution_authorization_hash: request.execution_authorization_hash,
        authorization_id: request.authorization_id,
        claim_event_hash: request.claim_event_hash,
        claim_witness_head: request.claim_witness_head,
        permit_state: 'consumed',
        boundary_effect_id: `direct-effect:${request.claim_id}`,
        boundary_state_version: 1,
        boundary_attestation_hash: directAttestation,
        effect_at: controls.effect_at || at,
      };
      if (controls.hold) {
        return new Promise((resolve, reject) => {
          const cancel = () => reject(new Error('direct action cancelled'));
          if (controls.honor_abort && request.abort_signal) {
            request.abort_signal.addEventListener('abort', cancel, { once: true });
          }
          controls.release = () => {
            if (request.abort_signal) request.abort_signal.removeEventListener('abort', cancel);
            resolve(response);
          };
        });
      }
      return response;
    },
    async cancel(request) {
      controls.cancel_calls = (controls.cancel_calls || 0) + 1;
      controls.last_cancel_request = request;
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
          uri: `file:///var/lib/autopilot/direct-receipts/cancel-${request.claim_id}.json`,
          sha256: hash(`direct-cancel:${request.claim_id}:${request.cancellation_request_hash}`),
        },
        boundary_effect_id: null,
        boundary_state_version: 2,
        attestation_hash: directAttestation,
        received_at: at,
        effect_at: null,
      };
    },
  };
  return result;
}

function startAuthorityRun(runId, controls, options = {}) {
  const witness = new MemoryWitness({ streamId: `${runId}-witness` });
  const started = OwnerKernel.start({
    runId,
    governanceConfig: config(options),
    acceptanceContract: contract(`${runId}-contract`),
    initialIntentEnvelope: { signed: true, payload: { text: 'Write the requested file.', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a',
    witness,
    adapters,
    clock: () => at,
    actionAuthority: options.actionAuthority || authority(controls),
    allowTestWitness: true,
    allowTestActionExecutor: true,
    nonceFactory: () => `${runId}`.padEnd(64, 'n'),
  });
  return { ...started, witness };
}

function mintWrite(kernel, ownerCapability, turn, target) {
  return kernel.mintActionDecision({
    capability: ownerCapability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn },
    actionDescriptor: { operation: 'write_file', tool_class: 'filesystem', targets: [target] },
    maxUses: 2,
  });
}

function appendForgedIntent(ledger, state, witness) {
  const payload = {
    intent_id: `intent-forged-${state.sequence + 1}`,
    text: 'A later intent supersedes the claimed action.',
    envelope_hash: hash('forged-intent-envelope'),
    explicit_action_hashes: [],
    supersedes_intent_id: state.current_intent_id,
  };
  const provisional = prepareEvent({
    sequence: state.sequence + 1,
    runId: ledger.header.run_id,
    type: 'intent',
    emittedAt: at,
    emitter: { kind: 'user', identity: 'user-a', channel: 'host-user' },
    policyHash: ledger.header.policy_hash,
    contractHash: ledger.header.contract_hash,
    authorityHash: ledger.header.authority_hash,
    payload,
    prevEventHash: state.event_head,
  });
  const receipt = witness.appendIfHead({
    run_id: ledger.header.run_id,
    stream_id: witness.streamId,
    sequence: provisional.sequence,
    event_hash: provisional.event_hash,
    previous_witness_head: state.witness_head,
    expected_witness_head: state.witness_head,
    type: 'intent',
  });
  return buildEvent({
    sequence: provisional.sequence,
    runId: provisional.run_id,
    type: provisional.type,
    emittedAt: provisional.emitted_at,
    emitter: provisional.emitter,
    policyHash: provisional.policy_hash,
    contractHash: provisional.contract_hash,
    authorityHash: provisional.authority_hash,
    payload: provisional.payload,
    prevEventHash: provisional.prev_event_hash,
    witness: receipt,
  });
}

function rebuildAsLegacyPolicy(ledger) {
  const header = JSON.parse(JSON.stringify(ledger.header));
  delete header.policy.action_catalog;
  delete header.policy.max_recover_cycles;
  delete header.policy.max_delegate_per_decision;
  header.policy_hash = hash(header.policy);
  const witness = new MemoryWitness({ streamId: header.witness_stream_id });
  const events = [];
  let previousEventHash = null;
  let previousWitnessHead = null;
  for (const source of ledger.events) {
    const provisional = prepareEvent({
      sequence: source.sequence,
      runId: header.run_id,
      type: source.type,
      emittedAt: source.emitted_at,
      emitter: source.emitter,
      policyHash: header.policy_hash,
      contractHash: header.contract_hash,
      authorityHash: header.authority_hash,
      payload: source.payload,
      prevEventHash: previousEventHash,
    });
    const receipt = witness.append({
      run_id: header.run_id,
      stream_id: witness.streamId,
      sequence: provisional.sequence,
      event_hash: provisional.event_hash,
      previous_witness_head: previousWitnessHead,
      type: source.type,
    });
    const event = buildEvent({
      sequence: provisional.sequence,
      runId: provisional.run_id,
      type: provisional.type,
      emittedAt: provisional.emitted_at,
      emitter: provisional.emitter,
      policyHash: provisional.policy_hash,
      contractHash: provisional.contract_hash,
      authorityHash: provisional.authority_hash,
      payload: provisional.payload,
      prevEventHash: provisional.prev_event_hash,
      witness: receipt,
    });
    events.push(event);
    previousEventHash = event.event_hash;
    previousWitnessHead = receipt.witness_head;
  }
  return { ledger: { header, events }, witness };
}

async function main() {
  const controls = { calls: 0, hold: true, release: null, last_request: null };
  const run = startAuthorityRun('pending-claim', controls);
  const decision = mintWrite(run.kernel, run.owner_capability, 'pending', 'tmp/pending.txt');
  const alternateDecision = mintWrite(run.kernel, run.owner_capability, 'pending-alternate', 'tmp/pending-alternate.txt');
  const execution = run.kernel.executeAuthorizedAction({
    decisionId: decision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/pending.txt'] },
  });
  await Promise.resolve();
  assert.equal(typeof controls.release, 'function');
  assert.equal(controls.calls, 1);
  assert.equal(controls.last_request.execution_permit.claim_id, controls.last_request.claim_id);
  assert.equal(controls.last_request.execution_authorization.claim_id, controls.last_request.claim_id);
  assert.equal(controls.last_request.execution_authorization.execution_permit_hash, controls.last_request.execution_permit_hash);
  assert.equal(controls.last_request.claim_witness_head, controls.last_request.claim.witness.witness_head);
  assert.equal(typeof controls.last_request.execution_authorization.authorization, 'string');
  const pendingLedger = run.kernel.getLedger();
  const pendingState = verifyLedger(pendingLedger, { witness: run.witness, requireWitness: true }).state;
  const claimId = Object.keys(pendingState.action_claims)[0];
  assert.equal(pendingState.action_claims[claimId].outcome, null);

  const forgedIntent = appendForgedIntent(pendingLedger, pendingState, run.witness);
  assert.throws(() => verifyLedger({
    header: pendingLedger.header,
    events: [...pendingLedger.events, forgedIntent],
  }, { witness: run.witness, requireWitness: true }), /only an action outcome/);
  assert.throws(() => OwnerKernel.resume({
    ledger: pendingLedger,
    witness: run.witness,
    adapters,
    clock: () => at,
    actionAuthority: authority(controls),
    allowTestWitness: true,
    allowTestActionExecutor: true,
    nonceFactory: () => 'r'.repeat(64),
  }), /durable recovery/);

  controls.hold = false;
  controls.release();
  await assert.rejects(execution, /outcome could not be witnessed/);
  // The rejected forged replay has intentionally advanced the external test witness. Restore the live
  // Kernel's known head so these assertions reach the pending-claim guard rather than the CAS guard.
  run.witness._head = pendingLedger.events[pendingLedger.events.length - 1].witness.witness_head;
  assert.throws(() => run.kernel.captureIntent({
    signed: true,
    payload: { text: 'Cannot supersede an unresolved host action.', explicit_action_hashes: [] },
  }), /durably reconciled/);
  assert.throws(() => mintWrite(
    run.kernel,
    run.owner_capability,
    'pending-new-decision',
    'tmp/pending-new-decision.txt',
  ), /durably reconciled/);
  await assert.rejects(
    run.kernel.executeAuthorizedAction({
      decisionId: alternateDecision.payload.decision_id,
      action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/pending-alternate.txt'] },
    }),
    /durably reconciled/,
  );
  assert.equal(controls.calls, 1);

  const legacyWitness = new MemoryWitness({ streamId: 'legacy-source-witness' });
  const legacyStarted = OwnerKernel.start({
    runId: 'legacy-replay',
    governanceConfig: config({ actionCatalog: false }),
    acceptanceContract: contract('legacy-contract'),
    initialIntentEnvelope: { signed: true, payload: { text: 'External action.', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a',
    witness: legacyWitness,
    adapters,
    clock: () => at,
    allowTestWitness: true,
    nonceFactory: () => 'l'.repeat(64),
  });
  const legacyDecision = legacyStarted.kernel.mintDecision({
    capability: legacyStarted.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'legacy' },
    actionClass: 'external',
    actionDescriptor: { operation: 'legacy_external' },
  });
  const approvalEnvelope = {
    signed: true,
    payload: {
      decision_id: legacyDecision.payload.decision_id,
      decision_content_hash: legacyDecision.payload.decision_content_hash,
      max_uses: 1,
    },
  };
  legacyStarted.kernel.submitApproval(approvalEnvelope);
  legacyStarted.kernel.submitApproval(approvalEnvelope);
  const rebuilt = rebuildAsLegacyPolicy(legacyStarted.kernel.getLedger());
  const verifiedLegacy = verifyLedger(rebuilt.ledger, { witness: rebuilt.witness, requireWitness: true });
  assert.equal(Object.keys(verifiedLegacy.state.approvals).length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(verifiedLegacy.header.policy, 'action_catalog'), false);

  const p1WitnessBacking = new MemoryWitness({ streamId: 'p1-append-only-witness' });
  const p1AppendOnlyWitness = {
    streamId: p1WitnessBacking.streamId,
    trustTier: 'external',
    append: p1WitnessBacking.append.bind(p1WitnessBacking),
    verify: p1WitnessBacking.verify.bind(p1WitnessBacking),
  };
  const p1Compatible = OwnerKernel.start({
    runId: 'p1-checkpoint-compat',
    governanceConfig: config({ actionCatalog: false }),
    acceptanceContract: contract('p1-checkpoint-contract'),
    initialIntentEnvelope: { signed: true, payload: { text: 'P1 checkpoint compatibility.', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a',
    witness: p1AppendOnlyWitness,
    adapters,
    clock: () => at,
    allowTestWitness: false,
    nonceFactory: () => 'p'.repeat(64),
  });
  assert.equal(p1Compatible.kernel.checkpoint().type, 'checkpoint');

  const checkpointControls = {
    calls: 0,
    hold: false,
    release: null,
    last_request: null,
    host_available: true,
  };
  const checkpointRun = startAuthorityRun('checkpoint-revalidation', checkpointControls, { checkpointInterval: 1 });
  checkpointControls.host_available = false;
  assert.throws(() => checkpointRun.kernel.captureIntent({
    signed: true,
    payload: { text: 'Capture after host regression.', explicit_action_hashes: [] },
  }), /host capability/i);
  assert.ok(checkpointRun.kernel.getState().block_reasons.includes('host_capability_regression'));
  assert.ok(checkpointRun.kernel.getLedger().events.some((event) => (
    event.type === 'evidence' && event.payload.evidence_kind === 'capability_regression'
  )));

  const challengedControls = { calls: 0, hold: false, release: null, last_request: null };
  const challenged = startAuthorityRun('challenge-gate', challengedControls, { challenge: true });
  const challengedDecision = mintWrite(challenged.kernel, challenged.owner_capability, 'challenge', 'tmp/challenge.txt');
  await assert.rejects(
    challenged.kernel.executeAuthorizedAction({
      decisionId: challengedDecision.payload.decision_id,
      action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/challenge.txt'] },
    }),
    /requires challenge evidence/i,
  );
  assert.equal(challengedControls.calls, 0);

  const abortControls = { calls: 0, hold: true, honor_abort: true, release: null, last_request: null };
  const abortRun = startAuthorityRun('abort-in-flight', abortControls);
  const abortDecision = mintWrite(abortRun.kernel, abortRun.owner_capability, 'abort', 'tmp/abort.txt');
  const abortExecution = abortRun.kernel.executeAuthorizedAction({
    decisionId: abortDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/abort.txt'] },
  });
  await Promise.resolve();
  assert.equal(typeof abortControls.release, 'function');
  const abortRequest = abortRun.kernel.userAbort({ signed: true, payload: { reason: 'operator stop' } });
  assert.equal(abortRequest.cancellation_requested, true);
  const aborted = await abortExecution;
  assert.equal(aborted.outcome.payload.outcome, 'unknown');
  assert.equal(abortControls.last_request.abort_signal.aborted, true);
  assert.equal(abortControls.cancel_calls, 1);
  assert.equal(aborted.outcome.payload.cancellation.state, 'revoked');
  assert.equal(aborted.outcome.payload.cancellation.execution_authorization_hash,
    abortControls.last_cancel_request.execution_authorization_hash);
  assert.equal(abortControls.last_cancel_request.claim_id, aborted.claim.payload.claim_id);
  assert.equal(abortControls.last_cancel_request.execution_permit_hash,
    aborted.claim.payload.execution_permit_hash);
  assert.ok(abortRun.kernel.getState().block_reasons.some((reason) => reason.startsWith('action_outcome:')));

  const verifierAbortControls = {
    calls: 0,
    hold: false,
    honor_abort: true,
    release: null,
    release_verifier: null,
    delay_verifier: true,
    last_request: null,
  };
  const verifierAbortRun = startAuthorityRun('abort-during-verification', verifierAbortControls);
  const verifierAbortDecision = mintWrite(
    verifierAbortRun.kernel,
    verifierAbortRun.owner_capability,
    'abort-verifier',
    'tmp/abort-verifier.txt',
  );
  const verifierAbortExecution = verifierAbortRun.kernel.executeAuthorizedAction({
    decisionId: verifierAbortDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/abort-verifier.txt'] },
  });
  for (let attempt = 0; attempt < 20 && typeof verifierAbortControls.release_verifier !== 'function'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof verifierAbortControls.release_verifier, 'function');
  const verifierAbortRequest = verifierAbortRun.kernel.userAbort({
    signed: true,
    payload: { reason: 'operator stop during receipt verification' },
  });
  assert.equal(verifierAbortRequest.cancellation_requested, true);
  const verifierAborted = await verifierAbortExecution;
  assert.equal(verifierAborted.outcome.payload.outcome, 'unknown');
  assert.equal(verifierAbortControls.last_request.abort_signal.aborted, true);
  assert.equal(verifierAbortControls.cancel_calls, 1);
  assert.equal(verifierAborted.outcome.payload.cancellation.state, 'revoked');
  assert.ok(verifierAbortRun.kernel.getState().block_reasons.some((reason) => reason.startsWith('action_outcome:')));

  const claimCommitControls = { calls: 0, hold: false, release: null, last_request: null };
  const claimCommitRun = startAuthorityRun('abort-during-claim-witness', claimCommitControls);
  const claimCommitAppend = claimCommitRun.witness.appendIfHead.bind(claimCommitRun.witness);
  let claimCommitAbort = null;
  claimCommitRun.witness.appendIfHead = (request) => {
    const receipt = claimCommitAppend(request);
    if (request.sequence === 4 && claimCommitAbort === null) {
      claimCommitAbort = claimCommitRun.kernel.userAbort({
        signed: true,
        payload: { reason: 'abort reentered from claim witness' },
      });
    }
    return receipt;
  };
  const claimCommitDecision = mintWrite(
    claimCommitRun.kernel,
    claimCommitRun.owner_capability,
    'abort-during-claim-witness',
    'tmp/abort-during-claim-witness.txt',
  );
  const claimCommitOutcome = await claimCommitRun.kernel.executeAuthorizedAction({
    decisionId: claimCommitDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/abort-during-claim-witness.txt'] },
  });
  assert.deepEqual(claimCommitAbort, {
    cancellation_requested: true,
    claim_id: claimCommitOutcome.claim.payload.claim_id,
    claim_commit_in_progress: true,
  });
  assert.equal(claimCommitOutcome.outcome.payload.outcome, 'unknown');
  assert.equal(claimCommitControls.calls, 0);
  assert.equal(claimCommitControls.cancel_calls, 1);
  assert.equal(
    claimCommitRun.witness.head,
    claimCommitRun.kernel.getLedger().events.at(-1).witness.witness_head,
  );
  verifyLedger(claimCommitRun.kernel.getLedger(), { witness: claimCommitRun.witness, requireWitness: true });

  const outcomeCommitControls = { calls: 0, hold: false, release: null, last_request: null };
  const outcomeCommitRun = startAuthorityRun('abort-during-outcome-witness', outcomeCommitControls);
  const outcomeCommitAppend = outcomeCommitRun.witness.appendIfHead.bind(outcomeCommitRun.witness);
  let outcomeCommitAbort = null;
  outcomeCommitRun.witness.appendIfHead = (request) => {
    if (request.sequence === 5 && outcomeCommitAbort === null) {
      outcomeCommitAbort = outcomeCommitRun.kernel.userAbort({
        signed: true,
        payload: { reason: 'abort reentered from outcome witness' },
      });
    }
    return outcomeCommitAppend(request);
  };
  const outcomeCommitDecision = mintWrite(
    outcomeCommitRun.kernel,
    outcomeCommitRun.owner_capability,
    'abort-during-outcome-witness',
    'tmp/abort-during-outcome-witness.txt',
  );
  const outcomeCommitOutcome = await outcomeCommitRun.kernel.executeAuthorizedAction({
    decisionId: outcomeCommitDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/abort-during-outcome-witness.txt'] },
  });
  assert.deepEqual(outcomeCommitAbort, {
    cancellation_requested: false,
    claim_id: outcomeCommitOutcome.claim.payload.claim_id,
    outcome_commit_in_progress: true,
  });
  assert.equal(outcomeCommitOutcome.outcome.payload.outcome, 'succeeded');
  assert.equal(outcomeCommitOutcome.outcome.payload.cancellation, null);
  assert.equal(outcomeCommitControls.cancel_calls || 0, 0);

  const independentCancelControls = {
    calls: 0,
    hold: true,
    honor_abort: false,
    release: null,
    last_request: null,
    cancellation_verifier_mismatch: true,
  };
  const independentCancelRun = startAuthorityRun('independent-cancel-mismatch', independentCancelControls);
  const independentCancelDecision = mintWrite(
    independentCancelRun.kernel,
    independentCancelRun.owner_capability,
    'independent-cancel-mismatch',
    'tmp/independent-cancel-mismatch.txt',
  );
  const independentCancelExecution = independentCancelRun.kernel.executeAuthorizedAction({
    decisionId: independentCancelDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/independent-cancel-mismatch.txt'] },
  });
  await Promise.resolve();
  independentCancelRun.kernel.userAbort({ signed: true, payload: { reason: 'independent receipt verifier mismatch' } });
  const independentCancelled = await independentCancelExecution;
  assert.equal(independentCancelControls.cancel_calls, 1);
  assert.equal(independentCancelled.outcome.payload.outcome, 'unknown');
  assert.equal(independentCancelled.outcome.payload.cancellation.state, 'unconfirmed');

  const completedCancelControls = {
    calls: 0,
    hold: true,
    honor_abort: true,
    release: null,
    last_request: null,
    cancellation_state: 'completed',
    cancellation_effect_at: at,
  };
  const completedCancelRun = startAuthorityRun('completed-cancellation', completedCancelControls);
  const completedCancelDecision = mintWrite(
    completedCancelRun.kernel,
    completedCancelRun.owner_capability,
    'completed-cancellation',
    'tmp/completed-cancellation.txt',
  );
  const completedCancelExecution = completedCancelRun.kernel.executeAuthorizedAction({
    decisionId: completedCancelDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/completed-cancellation.txt'] },
  });
  await Promise.resolve();
  completedCancelRun.kernel.userAbort({ signed: true, payload: { reason: 'completed at boundary' } });
  const completedCancelled = await completedCancelExecution;
  assert.equal(completedCancelled.outcome.payload.outcome, 'unknown');
  assert.equal(completedCancelled.outcome.payload.cancellation.state, 'completed');
  assert.equal(
    completedCancelled.outcome.payload.cancellation.execution_authorization_hash,
    completedCancelled.outcome.payload.execution_authorization_hash,
  );
  assert.equal(completedCancelled.outcome.payload.cancellation.effect_at, at);

  const invalidCompletedCancelControls = {
    calls: 0,
    hold: true,
    honor_abort: true,
    release: null,
    last_request: null,
    cancellation_state: 'completed',
  };
  const invalidCompletedCancelRun = startAuthorityRun('invalid-completed-cancellation', invalidCompletedCancelControls);
  const invalidCompletedCancelDecision = mintWrite(
    invalidCompletedCancelRun.kernel,
    invalidCompletedCancelRun.owner_capability,
    'invalid-completed-cancellation',
    'tmp/invalid-completed-cancellation.txt',
  );
  const invalidCompletedCancelExecution = invalidCompletedCancelRun.kernel.executeAuthorizedAction({
    decisionId: invalidCompletedCancelDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/invalid-completed-cancellation.txt'] },
  });
  await Promise.resolve();
  invalidCompletedCancelRun.kernel.userAbort({ signed: true, payload: { reason: 'completed without effect proof' } });
  const invalidCompletedCancelled = await invalidCompletedCancelExecution;
  assert.equal(invalidCompletedCancelled.outcome.payload.outcome, 'unknown');
  assert.equal(invalidCompletedCancelled.outcome.payload.cancellation.state, 'unconfirmed');

  const reentrantControls = { calls: 0, hold: false, release: null, last_request: null };
  const reentrantRun = startAuthorityRun('reentrant-post-claim-abort', reentrantControls);
  let reentrantAbortRequest = null;
  reentrantControls.on_post_claim_probe = () => {
    reentrantAbortRequest = reentrantRun.kernel.userAbort({
      signed: true,
      payload: { reason: 'abort while post-claim authorization is issued' },
    });
  };
  const reentrantDecision = mintWrite(
    reentrantRun.kernel,
    reentrantRun.owner_capability,
    'reentrant-post-claim-abort',
    'tmp/reentrant-post-claim-abort.txt',
  );
  const reentrantOutcome = await reentrantRun.kernel.executeAuthorizedAction({
    decisionId: reentrantDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/reentrant-post-claim-abort.txt'] },
  });
  assert.equal(reentrantOutcome.outcome.payload.outcome, 'unknown');
  assert.equal(reentrantControls.cancel_calls, 1);
  assert.deepEqual(reentrantAbortRequest, {
    cancellation_requested: true,
    claim_id: reentrantOutcome.claim.payload.claim_id,
    postclaim_authorization_pending: true,
  });
  assert.equal(
    reentrantControls.last_cancel_request.execution_authorization_hash,
    reentrantOutcome.outcome.payload.execution_authorization_hash,
  );
  assert.equal(
    reentrantOutcome.outcome.payload.cancellation.execution_authorization_hash,
    reentrantOutcome.outcome.payload.execution_authorization_hash,
  );
  assert.equal(
    reentrantControls.last_cancel_request.execution_authorization.authorization_id,
    reentrantOutcome.outcome.payload.authorization_id,
  );
  assert.equal(typeof reentrantOutcome.outcome.payload.execution_authorization_hash, 'string');

  at = '2026-07-02T00:00:00.000Z';
  const expiryControls = { calls: 0, hold: false, release: null, last_request: null, expire_after_authorization: true };
  const expiryRun = startAuthorityRun('authorization-expiry', expiryControls);
  const expiryDecision = mintWrite(expiryRun.kernel, expiryRun.owner_capability, 'authorization-expiry', 'tmp/authorization-expiry.txt');
  const expired = await expiryRun.kernel.executeAuthorizedAction({
    decisionId: expiryDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/authorization-expiry.txt'] },
  });
  assert.equal(expiryControls.calls, 0);
  assert.equal(expiryControls.cancel_calls, 1);
  assert.equal(expired.outcome.payload.outcome, 'unknown');

  at = '2026-07-02T00:00:00.000Z';
  const futureEffectControls = {
    calls: 0,
    hold: false,
    release: null,
    last_request: null,
    effect_at: '2026-07-02T00:03:00.000Z',
  };
  const futureEffectRun = startAuthorityRun('future-effect', futureEffectControls);
  const futureEffectDecision = mintWrite(futureEffectRun.kernel, futureEffectRun.owner_capability, 'future-effect', 'tmp/future-effect.txt');
  const futureEffect = await futureEffectRun.kernel.executeAuthorizedAction({
    decisionId: futureEffectDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/future-effect.txt'] },
  });
  assert.equal(futureEffect.outcome.payload.outcome, 'unknown');
  assert.equal(futureEffectControls.cancel_calls, 1);

  const expiryEffectControls = {
    calls: 0,
    hold: false,
    release: null,
    last_request: null,
    effect_at: '2026-07-02T00:04:00.000Z',
  };
  const expiryEffectRun = startAuthorityRun('effect-at-expiry', expiryEffectControls);
  const expiryEffectDecision = mintWrite(expiryEffectRun.kernel, expiryEffectRun.owner_capability, 'effect-at-expiry', 'tmp/effect-at-expiry.txt');
  const expiryEffect = await expiryEffectRun.kernel.executeAuthorizedAction({
    decisionId: expiryEffectDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/effect-at-expiry.txt'] },
  });
  assert.equal(expiryEffect.outcome.payload.outcome, 'unknown');
  assert.equal(expiryEffectControls.cancel_calls, 1);

  const earlyEffectControls = {
    calls: 0,
    hold: false,
    release: null,
    last_request: null,
    effect_at: '2026-07-01T23:59:59.000Z',
  };
  const earlyEffectRun = startAuthorityRun('effect-before-authorization', earlyEffectControls);
  const earlyEffectDecision = mintWrite(earlyEffectRun.kernel, earlyEffectRun.owner_capability, 'effect-before-authorization', 'tmp/effect-before-authorization.txt');
  const earlyEffect = await earlyEffectRun.kernel.executeAuthorizedAction({
    decisionId: earlyEffectDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/effect-before-authorization.txt'] },
  });
  assert.equal(earlyEffect.outcome.payload.outcome, 'unknown');
  assert.equal(earlyEffectControls.cancel_calls, 1);

  at = '2026-07-02T00:00:00.000Z';
  const directControls = { calls: 0, hold: false, release: null, last_request: null };
  const directRun = startAuthorityRun('direct-boundary', directControls, {
    requiresMediator: false,
    actionAuthority: directAuthority(directControls),
  });
  const directDecision = mintWrite(directRun.kernel, directRun.owner_capability, 'direct-boundary', 'tmp/direct-boundary.txt');
  const directSuccess = await directRun.kernel.executeAuthorizedAction({
    decisionId: directDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/direct-boundary.txt'] },
  });
  assert.equal(directSuccess.outcome.payload.outcome, 'succeeded');
  assert.equal(directControls.last_request.execution_route, 'executor');
  assert.equal(directControls.last_request.broker, null);
  assert.equal(directSuccess.outcome.payload.broker_receipt, null);
  directControls.hold = true;
  const directAbort = directRun.kernel.executeAuthorizedAction({
    decisionId: directDecision.payload.decision_id,
    action: { operation: 'write_file', tool_class: 'filesystem', targets: ['tmp/direct-boundary.txt'] },
  });
  await Promise.resolve();
  directRun.kernel.userAbort({ signed: true, payload: { reason: 'direct-boundary abort' } });
  const directAborted = await directAbort;
  assert.equal(directControls.cancel_calls, 1);
  assert.equal(directAborted.outcome.payload.cancellation.state, 'revoked');

  console.log('pending_claim_replay=ok');
  console.log('legacy_replay=ok');
  console.log('p1_checkpoint_compat=ok');
  console.log('checkpoint_revalidation=ok');
  console.log('challenge_gate=ok');
  console.log('inflight_abort=ok');
  console.log('verification_abort=ok');
  console.log('completed_cancellation_reconciliation=ok');
  console.log('witness_commit_abort_races=ok');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "Owner action hardening process exits cleanly"
assert_contains "$OUT" "pending_claim_replay=ok" "Pending claims reject replayed control-plane mutation, resume takeover, and later action retries"
assert_contains "$OUT" "legacy_replay=ok" "P1 policy-shaped ledgers retain repeated-approval replay compatibility"
assert_contains "$OUT" "p1_checkpoint_compat=ok" "P1 external witnesses remain compatible without P2 head probing"
assert_contains "$OUT" "checkpoint_revalidation=ok" "Automatic checkpoints witness host regression rather than silently skipping it"
assert_contains "$OUT" "challenge_gate=ok" "Challenge-required catalog actions fail closed before broker execution"
assert_contains "$OUT" "inflight_abort=ok" "Authenticated abort cancels an in-flight broker action and records only unknown evidence"
assert_contains "$OUT" "verification_abort=ok" "Authenticated abort also cancels a stalled receipt verifier and records only unknown evidence"
assert_contains "$OUT" "completed_cancellation_reconciliation=ok" "Completed cancellation requires a final authorization-bound in-window effect proof"
assert_contains "$OUT" "witness_commit_abort_races=ok" "Re-entrant aborts cannot split witness commits or contradict a committed action outcome"

finalize_test
