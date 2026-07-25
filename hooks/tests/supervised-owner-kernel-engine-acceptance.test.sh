#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.argv[2];
const { createP37Runtime } = require(path.join(
  root,
  'hooks',
  'tests',
  'fixtures',
  'p37-runtime',
));
const baseEngine = require(path.join(root, 'src', 'engine'));

const deliveredManifest = [{
  id: 'workspace',
  sha256: baseEngine.sha256('p37-engine-delivered-workspace'),
}];
const acceptanceContract = {
  schema_version: 2,
  contract_id: 'p37-engine-acceptance',
  artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
  legs: [
    {
      id: 'tests',
      kind: 'executable',
      command: 'node --test',
      artifact_ids: ['workspace'],
    },
    {
      id: 'ux',
      kind: 'non_executable',
      artifact_ids: ['workspace'],
    },
  ],
};
const runtime = createP37Runtime(root, {
  actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
  acceptanceContract,
  runId: 'p37-engine',
});
const {
  engine,
  hash,
  governanceConfig,
  routeInputs,
  durableBinding,
  serviceBindings,
} = runtime;
const NOW = new Date(runtime.NOW).toISOString();
const EXPIRES = new Date(runtime.NOW + 3600000).toISOString();
const manifestHash = hash(deliveredManifest);
const auditHead = hash('p37-engine-audit-head');

const profile = engine.compileEngineAcceptanceProfile({
  ...routeInputs,
  capabilityProbedAt: NOW,
  capabilityExpiresAt: EXPIRES,
});
assert.deepEqual(profile.catalog_entry, engine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY);
assert.equal(profile.effect_authority, 'engine_implementation_only');
assert.equal(profile.acceptance, 'coordinator_v2');
const noncontiguousWitness = engine.createSemanticWitnessAdapter({
  route: profile.route,
  durableBinding,
  invoke: runtime.createWitnessInvoke(),
  requestIdFactory: ({ label, counter }) => `noncontiguous-${label}-${counter}`,
});
const noncontiguousBatch = {
  run_id: profile.route.run_id,
  stream_id: profile.route.run_id,
  batch_id: 'noncontiguous-batch',
  expected_witness_head: null,
  events: [
    { sequence: 1, event_hash: hash('noncontiguous-1'), type: 'acceptance' },
    { sequence: 3, event_hash: hash('noncontiguous-3'), type: 'complete' },
  ],
};
noncontiguousBatch.batch_commitment = hash({
  run_id: noncontiguousBatch.run_id,
  stream_id: noncontiguousBatch.stream_id,
  batch_id: noncontiguousBatch.batch_id,
  expected_witness_head: noncontiguousBatch.expected_witness_head,
  event_hashes: noncontiguousBatch.events.map((event) => event.event_hash),
});
assert.throws(
  () => noncontiguousWitness.appendBatchIfHead(noncontiguousBatch),
  /contiguous safe sequences/,
);
assert.equal(noncontiguousWitness.getHead(), null);
noncontiguousWitness.teardown();
const overrideRuntime = createP37Runtime(root, {
  actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
  acceptanceContract,
  runId: 'p37-engine-override',
  modeOverride: 'milestone-led',
});
const overrideProfile = engine.compileEngineAcceptanceProfile({
  ...overrideRuntime.routeInputs,
  capabilityProbedAt: NOW,
  capabilityExpiresAt: EXPIRES,
});
assert.equal(
  overrideProfile.policy_hash,
  engine.resolveGovernancePolicy(overrideRuntime.governanceConfig, {
    modeOverride: 'milestone-led',
  }).policy_hash,
);

const authorizations = new Map();
const consumed = new Set();
const sinkCalls = [];
const capturedExecuteMessages = [];
let executedClaimId = null;
let engineResult = null;

function hostResponse(message, response) {
  return {
    schema_version: 1,
    kind: 'p37_engine_host_response',
    profile_hash: message.profile_hash,
    route_hash: message.route_hash,
    operation: message.operation,
    request_hash: message.request_hash,
    response,
    response_hash: hash(response),
  };
}

function capabilityResponse(message) {
  const request = message.request;
  const response = {
    ok: true,
    run_id: request.run_id,
    host_capability_hash: request.host_capability_hash,
    observation_hash: hash({ operation: message.operation, request }),
    probe_nonce: request.probe_nonce,
  };
  if (message.operation === 'capability:pre_action') {
    response.execution_permit = {
      permit_id: `permit-${request.claim_id}`,
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
      expires_at: new Date(runtime.NOW + 120000).toISOString(),
      attestation_hash: hash(`permit:${request.claim_id}`),
      issuer: profile.route.kernel_binding.identity,
      issuer_attestation_hash: profile.route.kernel_binding.attestation_hash,
      preclaim_authorization: `preclaim:${request.claim_id}`,
    };
  }
  if (message.operation === 'capability:post_claim') {
    const authorization = {
      authorization_id: `authorization-${request.claim_id}`,
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
      issued_at: NOW,
      expires_at: new Date(runtime.NOW + 60000).toISOString(),
      attestation_hash: hash(`authorization:${request.claim_id}`),
      issuer: profile.route.kernel_binding.identity,
      issuer_attestation_hash: profile.route.kernel_binding.attestation_hash,
      authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
    };
    authorizations.set(authorization.authorization_id, authorization.authorization);
    response.execution_authorization = authorization;
  }
  return response;
}

function engineInvoke(message) {
  const request = message.request;
  if (message.profile_hash !== profile.profile_hash || message.route_hash !== profile.route_hash) {
    throw new Error('wrong engine acceptance profile');
  }
  if (message.operation.startsWith('capability:')) {
    return hostResponse(message, capabilityResponse(message));
  }
  if (message.operation === 'execute_engine_dispatch') {
    capturedExecuteMessages.push(structuredClone(message));
    const authorization = request.execution_authorization;
    if (!authorization
      || authorizations.get(authorization.authorization_id) !== authorization.authorization
      || consumed.has(authorization.authorization_id)) {
      throw new Error('engine execution authorization replay or substitution');
    }
    assert.deepEqual(request.action, profile.action);
    assert.equal(
      request.action_descriptor.catalog_id,
      engine.ENGINE_IMPLEMENTATION_CATALOG_ID,
    );
    consumed.add(authorization.authorization_id);
    executedClaimId = request.claim_id;

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'p37-engine-'));
    const promptFile = path.join(temporary, 'implement.md');
    fs.writeFileSync(promptFile, 'Implement the frozen P3.7 test unit.\n');
    const implementationEngine = new engine.AutopilotEngine({
      cwd: root,
      implementationDispatcher(args, options) {
        sinkCalls.push({ args, cwd: options.cwd });
        return {
          error: null,
          status: 0,
          signal: null,
          stdout: '',
          stderr: '',
          parseError: null,
          result: {
            status: 'committed',
            runner: 'p37-engine-runner',
            model: 'p37-engine-model',
            branch: 'feat/p37-engine-fixture',
            base: 'b'.repeat(40),
            commit: 'c'.repeat(40),
            files_changed: 2,
            insertions: 12,
            deletions: 1,
            worktree: null,
            agent_log: '/var/log/autopilot/p37-engine.log',
            error: null,
          },
        };
      },
    });
    engineResult = implementationEngine.implementTask({
      promptFile,
      branch: 'feat/p37-engine-fixture',
      base: 'b'.repeat(40),
      cwd: root,
      roster: {
        implementer_runner: 'p37-engine-runner',
        implementer_engine: 'p37-engine-model',
        implementer_effort: 'high',
      },
    });
    fs.rmSync(temporary, { recursive: true, force: true });
    assert.equal(engineResult.status, 'committed');

    const effectId = `engine-effect-${request.claim_id}`;
    const receipt = {
      uri: `file://${profile.receipt_root}/${effectId}.json`,
      sha256: hash({
        effect_id: effectId,
        result: engineResult,
        authorization_id: authorization.authorization_id,
      }),
    };
    return hostResponse(message, {
      receipt,
      broker: {
        identity: serviceBindings.broker.identity,
        broker_uid: serviceBindings.broker.uid,
      },
      execution_permit_hash: request.execution_permit_hash,
      execution_authorization_hash: request.execution_authorization_hash,
      authorization_id: authorization.authorization_id,
      claim_event_hash: request.claim_event_hash,
      claim_witness_head: request.claim_witness_head,
      permit_state: 'consumed',
      boundary_effect_id: effectId,
      boundary_state_version: 1,
      boundary_attestation_hash: serviceBindings.broker.attestation_hash,
      effect_at: NOW,
    });
  }
  if (message.operation === 'verify_engine_dispatch') {
    const receipt = request.receipt;
    return hostResponse(message, {
      ok: true,
      run_id: request.run_id,
      claim_id: request.claim_id,
      executor_binding_hash: request.executor_binding_hash,
      execution_permit_hash: request.execution_permit_hash,
      execution_authorization_hash: request.execution_authorization_hash,
      authorization_id: request.authorization_id,
      claim_event_hash: request.claim_event_hash,
      claim_witness_head: request.claim_witness_head,
      permit_state: 'consumed',
      boundary_effect_id: receipt.boundary_effect_id,
      boundary_state_version: receipt.boundary_state_version,
      boundary_attestation_hash: receipt.boundary_attestation_hash,
      effect_at: receipt.effect_at,
      status: 'succeeded',
      receipt: receipt.receipt_ref,
      broker: receipt.broker_receipt,
      observed_action: profile.action,
      error_code: null,
    });
  }
  throw new Error(`unexpected engine host operation ${message.operation}`);
}

const coordinatorBinding = {
  identity: profile.route.coordinator_binding.identity,
  trust_tier: 'external',
  attestation_hash: profile.route.coordinator_binding.attestation_hash,
  protocol_version: 2,
};
const coordinatorBindingHash = hash(coordinatorBinding);
const coordinatorAttempts = new Map();
let loseRecordResponseOnce = true;
let coordinatorResolveCalls = 0;

function unsigned(value) {
  const { signature: _signature, ...rest } = value;
  return rest;
}

function sign(value) {
  return hash({
    profile_hash: profile.profile_hash,
    coordinator_binding_hash: coordinatorBindingHash,
    commitment: value,
  });
}

function makeCommitment(request) {
  const commitment = {
    protocol_version: 1,
    run_id: request.run_id,
    coordinator_binding_hash: request.coordinator_binding_hash,
    attempt_id: request.attempt_id,
    attempt_hash: request.attempt_hash,
    transaction_id: request.transaction_id,
    fence: request.fence,
    expected_event_head: request.expected_event_head,
    expected_witness_head: request.expected_witness_head,
    intent_id: request.expected_intent_id,
    snapshot_hash: request.snapshot_hash,
    snapshot_at: request.snapshot_at,
    batch_id: request.batch.batch_id,
    batch_commitment: request.batch.batch_commitment,
    batch_event_hashes: request.batch.events.map((event) => event.event_hash),
    disposition: 'accepted',
    issued_at: NOW,
    attestation_hash: coordinatorBinding.attestation_hash,
    signature: '',
  };
  commitment.signature = sign(unsigned(commitment));
  return commitment;
}

function commitmentMatches(request, commitment) {
  if (!commitment || commitment.signature !== sign(unsigned(commitment))) return false;
  const expected = makeCommitment(request);
  return Object.entries(unsigned(expected)).every(([key, value]) => (
    engine.canonicalJson(commitment[key]) === engine.canonicalJson(value)
  ));
}

function coordinatorInvoke(message) {
  const request = message.request;
  if (message.operation === 'coordinator_acquire') {
    const normalized = {
      attempt_id: request.attempt_id,
      attempt_hash: request.attempt_hash,
      intent_id: request.expected_intent_id,
      transaction_id: `txn-${request.attempt_id}`,
      fence: hash(`fence:${request.attempt_id}`),
      candidate_artifacts: deliveredManifest,
      delivered_artifacts: deliveredManifest,
      candidate_set_hash: manifestHash,
      delivered_set_hash: manifestHash,
      audit_head: auditHead,
      control_event_head: request.expected_event_head,
      control_witness_head: request.expected_witness_head,
      snapshot_at: NOW,
    };
    const snapshot = {
      ok: true,
      run_id: request.run_id,
      attempt_id: normalized.attempt_id,
      attempt_hash: normalized.attempt_hash,
      intent_id: normalized.intent_id,
      transaction_id: normalized.transaction_id,
      fence: normalized.fence,
      candidate_artifacts: normalized.candidate_artifacts,
      delivered_artifacts: normalized.delivered_artifacts,
      audit_head: normalized.audit_head,
      control_event_head: normalized.control_event_head,
      control_witness_head: normalized.control_witness_head,
      snapshot_at: normalized.snapshot_at,
      snapshot_hash: hash({ run_id: request.run_id, ...normalized }),
    };
    coordinatorAttempts.set(request.attempt_id, { snapshot, status: 'acquired' });
    return hostResponse(message, snapshot);
  }
  if (message.operation === 'coordinator_prepare_commit') {
    const attempt = coordinatorAttempts.get(request.attempt_id);
    if (!attempt || request.coordinator_binding_hash !== coordinatorBindingHash) {
      throw new Error('coordinator commit does not match an acquired attempt');
    }
    return hostResponse(message, {
      disposition: 'prepared',
      coordinator_commitment: makeCommitment(request),
    });
  }
  if (message.operation === 'coordinator_record_commit') {
    const attempt = coordinatorAttempts.get(request.attempt_id);
    if (!attempt || request.disposition !== 'accepted' || request.receipts.length !== 2) {
      throw new Error('coordinator record is not one accepted terminal batch');
    }
    attempt.status = 'accepted';
    attempt.response = request;
    if (loseRecordResponseOnce) {
      loseRecordResponseOnce = false;
      throw new Error('simulated lost coordinator record response');
    }
    return hostResponse(message, { recorded: true });
  }
  if (message.operation === 'coordinator_verify_commit') {
    return hostResponse(message, {
      verified: request.coordinator_binding_hash === coordinatorBindingHash
        && request.disposition === 'accepted'
        && commitmentMatches(request, request.coordinator_commitment),
    });
  }
  if (message.operation === 'coordinator_release') {
    return hostResponse(message, { ok: true, disposition: 'released' });
  }
  if (message.operation === 'coordinator_request_abort') {
    return hostResponse(message, {
      ok: true,
      attempt_id: request.attempt_id,
      attempt_hash: request.attempt_hash,
      disposition: 'queued',
    });
  }
  if (message.operation === 'coordinator_resolve') {
    coordinatorResolveCalls += 1;
    const attempt = coordinatorAttempts.get(request.attempt_id);
    if (attempt && attempt.status === 'accepted') {
      return hostResponse(message, attempt.response);
    }
    return hostResponse(message, {
      ok: true,
      run_id: request.run_id,
      attempt_id: request.attempt_id,
      attempt_hash: request.attempt_hash,
      transaction_id: request.transaction_id,
      fence: request.fence,
      disposition: 'released',
    });
  }
  if (message.operation === 'coordinator_cancel') {
    throw new Error(`unexpected happy-path coordinator operation ${message.operation}`);
  }
  if (message.operation === 'coordinator_verify_resolution') {
    return hostResponse(message, { verified: false });
  }
  throw new Error(`unexpected coordinator operation ${message.operation}`);
}

const adapters = {
  ...runtime.adapters(),
  evidenceArchiver({ verified_evidence }) {
    return {
      uri: `durable://p37-engine-evidence/${hash(verified_evidence)}`,
      sha256: hash(verified_evidence),
    };
  },
  verificationVerifier(_request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'runner-a',
      channel: 'p37-engine-runner',
      envelope_hash: hash('p37-engine-verification-envelope'),
      payload: {
        emitter_kind: 'runner',
        verification_path: 'trusted_runner',
        attestation_sha256: hash('attestation:runner-a'),
        verification_id: 'p37-engine-verification',
        intent_id: context.intent_id,
        leg_id: 'tests',
        outcome: 'green',
        command_hash: hash('node --test'),
        candidate_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        exit_code: 0,
        stdout_hash: hash('p37-engine-test-stdout'),
        stderr_hash: hash('p37-engine-test-stderr'),
        executed_at: NOW,
      },
    };
  },
  challengeVerifier(envelope, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'challenger-a',
      channel: 'p37-engine-challenge',
      envelope_hash: hash({ challenge: envelope.scope_id }),
      payload: {
        verification_path: 'qualified_challenge',
        attestation_sha256: hash('attestation:challenger-a'),
        challenge_id: `p37-engine-challenge-${envelope.scope_id}`,
        intent_id: context.intent_id,
        scope: 'contract_leg',
        scope_id: envelope.scope_id,
        finding: 'clear',
        candidate_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        subject_identity: profile.route.worker_binding.identity,
        subject_family: 'qwen',
        result_hash: hash(`challenge-result:${envelope.scope_id}`),
        reviewed_at: NOW,
      },
    };
  },
  artifactProvenanceVerifier(request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: profile.route.coordinator_binding.identity,
      channel: 'p37-engine-provenance',
      envelope_hash: hash({ provenance: request }),
      payload: {
        verification_path: 'artifact_provenance',
        attestation_sha256: profile.route.coordinator_binding.attestation_hash,
        candidate_set_hash: request.candidate_set_hash,
        intent_id: context.intent_id,
        subject_identity: request.subject_identity,
        subject_family: request.subject_family,
      },
    };
  },
  auditVerifier(_request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: profile.route.coordinator_binding.identity,
      channel: 'p37-engine-audit',
      envelope_hash: hash('p37-engine-audit-envelope'),
      payload: {
        verification_path: 'acceptance_audit',
        attestation_sha256: profile.route.coordinator_binding.attestation_hash,
        audit_head: auditHead,
        intent_id: context.intent_id,
        candidate_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        complete: true,
        action_claim_ids: [executedClaimId],
        action_footprint_hash: context.action_footprint_hash,
        evaluated_event_head: context.evaluated_event_head,
        evaluated_witness_head: context.evaluated_witness_head,
        observed_at: NOW,
      },
    };
  },
};

const cleanupWitnessTransport = runtime.createWitnessInvoke();
let cleanupTeardownCalls = 0;
assert.throws(() => engine.createEngineAcceptanceSession({
  profile,
  durableBinding,
  governanceConfig,
  acceptanceContract,
  witnessInvoke(message) {
    if (message.operation === 'teardown') cleanupTeardownCalls += 1;
    return cleanupWitnessTransport(message);
  },
  engineInvoke: null,
  coordinatorInvoke,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: { text: 'Reject an invalid engine authority.', explicit_action_hashes: [] },
    },
    initialOwnerId: 'owner-a',
    adapters,
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'c'.repeat(64),
  },
}), /requires a host invoke/);
assert.equal(cleanupTeardownCalls, 1);

const session = engine.createEngineAcceptanceSession({
  profile,
  durableBinding,
  governanceConfig,
  acceptanceContract,
  witnessInvoke: runtime.createWitnessInvoke(),
  engineInvoke,
  coordinatorInvoke,
  requestIdFactory: ({ label, counter }) => `engine-${label}-${counter}`,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: {
        text: 'Dispatch one implementation unit and accept its verified artifact.',
        explicit_action_hashes: [],
      },
    },
    initialOwnerId: 'owner-a',
    adapters,
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'e'.repeat(64),
  },
});
assert.deepEqual(session.authority, {
  owner_kernel_authority: 'active',
  effect_authority: 'engine_implementation_only',
  broker_authority: 'implementation_only',
  acceptance: 'coordinator_v2',
});
assert.throws(() => engine.createEngineAcceptanceSession({
  profile,
  modeOverride: 'milestone-led',
  durableBinding,
  governanceConfig,
  acceptanceContract,
  witnessInvoke: runtime.createWitnessInvoke(),
  engineInvoke,
  coordinatorInvoke,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: { text: 'This mismatched profile must not start.', explicit_action_hashes: [] },
    },
    initialOwnerId: 'owner-a',
    adapters,
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'm'.repeat(64),
  },
}), /does not match the session policy/);

(async () => {
  const substitutedDecision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'substitution' },
    actionClass: 'external',
    actionDescriptor: profile.action,
  });
  session.kernel.submitApproval({
    signed: true,
    payload: {
      decision_id: substitutedDecision.payload.decision_id,
      decision_content_hash: substitutedDecision.payload.decision_content_hash,
      max_uses: 1,
    },
  });
  await assert.rejects(
    () => session.kernel.executeAuthorizedAction({
      decisionId: substitutedDecision.payload.decision_id,
      action: { ...profile.action, targets: ['autopilot-engine:review-dispatch'] },
      timeoutMilliseconds: 1000,
    }),
    /does not exactly match|target_set_hash|authorized descriptor/,
  );
  assert.equal(capturedExecuteMessages.length, 0);

  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'dispatch' },
    actionClass: 'external',
    actionDescriptor: profile.action,
  });
  session.kernel.submitApproval({
    signed: true,
    payload: {
      decision_id: decision.payload.decision_id,
      decision_content_hash: decision.payload.decision_content_hash,
      max_uses: 1,
    },
  });
  const actionResult = await session.kernel.executeAuthorizedAction({
    decisionId: decision.payload.decision_id,
    action: profile.action,
    timeoutMilliseconds: 1000,
  });
  assert.equal(actionResult.outcome.payload.outcome, 'succeeded');
  assert.equal(engineResult.status, 'committed');
  assert.equal(sinkCalls.length, 1);
  assert.equal(capturedExecuteMessages.length, 1);
  assert.equal(session.kernel.getState().terminal_reason, null);

  session.kernel.recordVerification({ purpose: 'tests' });
  session.kernel.recordChallenge({ scope_id: 'tests' });
  session.kernel.recordChallenge({ scope_id: 'ux' });
  session.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const accepted = await session.kernel.accept({
    capability: session.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(coordinatorResolveCalls, 1);
  assert.equal(loseRecordResponseOnce, false);
  assert.equal(session.kernel.getState().terminal_reason, 'accepted');
  assert.deepEqual(
    session.kernel.getLedger().events.slice(-2).map((event) => event.type),
    ['acceptance', 'complete'],
  );
  const terminalReceipts = session.kernel.getLedger().events.slice(-2)
    .map((event) => event.witness);
  assert.equal(terminalReceipts[0].batch_id, terminalReceipts[1].batch_id);
  assert.equal(terminalReceipts[0].durable_request_hash, terminalReceipts[1].durable_request_hash);
  assert.equal(session.witness.verifyBatch(terminalReceipts), true);
  assert.equal(engine.verifyLedger(session.kernel.getLedger(), {
    witness: session.witness,
    requireWitness: true,
    acceptanceAuthority: session.acceptance_authority,
  }).state.terminal_reason, 'accepted');

  assert.throws(
    () => engineInvoke(capturedExecuteMessages[0]),
    /replay/,
  );
  assert.throws(
    () => session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'post-acceptance' },
      actionClass: 'external',
      actionDescriptor: profile.action,
    }),
    /terminal/i,
  );
  const forgedProfile = {
    ...profile,
    receipt_root: '/tmp/p37-forged-engine-receipts',
  };
  forgedProfile.profile_hash = hash((({ profile_hash: _ignored, ...rest }) => rest)(forgedProfile));
  assert.throws(() => engine.createEngineActionAuthority({
    profile: forgedProfile,
    durableBinding,
    invoke: engineInvoke,
  }), /canonical|hash|profile|fixed sink/);
  session.teardown();

  console.log(JSON.stringify({
    engine_sink: 'ok',
    sink_calls: sinkCalls.length,
    terminal_batch: 'atomic',
    lost_record_response: 'resolved_exactly_once',
    converged_is_not_terminal: true,
    corpus_evidence: {
      attacks: {
        capability_set_drift: 'held',
      },
    },
  }));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "P3.7c Engine acceptance process exits cleanly"
assert_contains "$OUT" '"engine_sink":"ok"' "Owner Kernel crosses the real AutopilotEngine implementation sink"
assert_contains "$OUT" '"sink_calls":1' "the implementation authorization is consumed exactly once"
assert_contains "$OUT" '"terminal_batch":"atomic"' "acceptance and completion share one durable atomic batch"
assert_contains "$OUT" '"lost_record_response":"resolved_exactly_once"' "a lost commit-record response resolves by exact attempt without re-execution"
assert_contains "$OUT" '"converged_is_not_terminal":true' "Engine completion alone cannot self-accept"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
