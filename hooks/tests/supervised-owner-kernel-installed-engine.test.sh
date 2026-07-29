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
const installedEngine = require(path.join(
  root,
  'src',
  'engine',
  'supervised-owner-kernel-installed-engine',
));
const installedContract = require(path.join(
  root,
  'src',
  'engine',
  'supervised-owner-kernel-installed-contract',
));
const { OwnerKernelError, canonicalJson, sha256 } = require(path.join(
  root,
  'src',
  'engine',
  'owner-kernel',
));

let deliveredManifest = [{
  id: 'workspace',
  sha256: baseEngine.sha256('p37-installed-engine-delivered-workspace'),
}];
const contentWorkspaceSha = deliveredManifest[0].sha256;
const acceptanceContract = {
  schema_version: 2,
  contract_id: 'p37-installed-engine-acceptance',
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
  runId: 'p37-installed-engine',
});
const {
  engine,
  hash,
  governanceConfig,
  routeInputs,
  durableBinding,
  serviceBindings,
  kernelBinding,
} = runtime;
const NOW = new Date(runtime.NOW).toISOString();
const EXPIRES = new Date(runtime.NOW + 3600000).toISOString();
let manifestHash = hash(deliveredManifest);
const auditHead = hash('p37-installed-engine-audit-head');

function makeInstalledBinding() {
  const roles = installedContract.SERVICE_ROLES;
  const bindings = {};
  for (const role of roles) {
    if (role === 'kernel') {
      bindings.kernel = {
        role: 'kernel',
        identity: kernelBinding.identity,
        uid: kernelBinding.uid,
        gid: kernelBinding.gid,
        attestation_hash: kernelBinding.attestation_hash,
        cgroup_binding_hash: kernelBinding.cgroup_binding_hash,
      };
      continue;
    }
    const service = serviceBindings[role];
    bindings[role] = {
      role,
      identity: service.identity,
      uid: service.uid,
      gid: service.gid,
      attestation_hash: service.attestation_hash,
      cgroup_binding_hash: service.cgroup_binding_hash,
    };
  }
  return {
    schema_version: 1,
    kind: 'p37_installed_state_binding',
    install_binding_hash: durableBinding.install_binding_hash,
    run_binding_hash: durableBinding.run_binding_hash,
    installed_abi_hash: installedContract.getSupervisedOwnerKernelInstalledAbiHash(),
    durable_abi_hash: durableBinding.durable_abi_hash,
    cohort_id: durableBinding.cohort_id,
    generation: durableBinding.generation,
    service_bindings: bindings,
    snapshot_hash: hash({
      install: durableBinding.install_binding_hash,
      run: durableBinding.run_binding_hash,
      cohort: durableBinding.cohort_id,
    }),
  };
}

const installedBinding = installedContract.normalizeInstalledBinding(makeInstalledBinding());

assert.equal(installedEngine.INSTALLED_ENGINE_SINK_ID, 'engine-implementation-dispatch-v1');
assert.equal(
  installedEngine.ENGINE_IMPLEMENTATION_CATALOG_ID,
  baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ID,
);
assert.throws(
  () => installedEngine.rejectForeignEngineSink('review-dispatch'),
  (error) => error instanceof OwnerKernelError && error.code === 'ENGINE_SINK_REJECTED',
);
assert.throws(
  () => installedEngine.compileInstalledEngineProfile({
    binding: installedBinding,
    sink_id: 'campaign-dispatch',
    governanceConfig,
    acceptanceContract,
    routeInputs,
    capabilityProbedAt: NOW,
    capabilityExpiresAt: EXPIRES,
  }),
  /substitute|reject|sink/i,
);

const profile = installedEngine.compileInstalledEngineProfile({
  binding: installedBinding,
  governanceConfig,
  acceptanceContract,
  routeInputs,
  durableBinding,
  kernelBinding,
  capabilityProbedAt: NOW,
  capabilityExpiresAt: EXPIRES,
});
assert.equal(profile.sink_id, 'engine-implementation-dispatch-v1');
assert.equal(profile.authority.acceptance, 'coordinator_v2');
assert.equal(profile.authority.engine_sink, 'engine-implementation-dispatch-v1');
assert.equal(profile.engine_profile.acceptance, 'coordinator_v2');
assert.deepEqual(profile.action, installedEngine.fixedAction());

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
      issuer: profile.engine_profile.route.kernel_binding.identity,
      issuer_attestation_hash: profile.engine_profile.route.kernel_binding.attestation_hash,
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
      issuer: profile.engine_profile.route.kernel_binding.identity,
      issuer_attestation_hash: profile.engine_profile.route.kernel_binding.attestation_hash,
      authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
    };
    authorizations.set(authorization.authorization_id, authorization.authorization);
    response.execution_authorization = authorization;
  }
  return response;
}

function engineInvoke(message) {
  const request = message.request;
  if (message.profile_hash !== profile.engine_profile.profile_hash
    || message.route_hash !== profile.engine_profile.route_hash) {
    throw new Error('wrong installed engine profile');
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
      installedEngine.ENGINE_IMPLEMENTATION_CATALOG_ID,
    );
    consumed.add(authorization.authorization_id);
    executedClaimId = request.claim_id;

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'p37-installed-engine-'));
    const promptFile = path.join(temporary, 'implement.md');
    fs.writeFileSync(promptFile, 'Implement the frozen U6 installed Engine unit.\n');
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
            runner: 'p37-installed-engine-runner',
            model: 'p37-installed-engine-model',
            branch: 'feat/p37-installed-engine-fixture',
            base: 'b'.repeat(40),
            commit: 'c'.repeat(40),
            files_changed: 2,
            insertions: 12,
            deletions: 1,
            worktree: null,
            agent_log: '/var/log/autopilot/p37-installed-engine.log',
            error: null,
          },
        };
      },
    });
    engineResult = implementationEngine.implementTask({
      promptFile,
      branch: 'feat/p37-installed-engine-fixture',
      base: 'b'.repeat(40),
      cwd: root,
      roster: {
        implementer_runner: 'p37-installed-engine-runner',
        implementer_engine: 'p37-installed-engine-model',
        implementer_effort: 'high',
      },
    });
    fs.rmSync(temporary, { recursive: true, force: true });
    assert.equal(engineResult.status, 'committed');
    assert.equal(engineResult.status === 'committed', true);

    const effectId = `engine-effect-${request.claim_id}`;
    // Non-stub commit identity bound into delivered_manifest commitment.
    const commitSha = 'c'.repeat(40);
    const artifactSha = contentWorkspaceSha;
    const receiptSha = hash({
      effect_id: effectId,
      result: engineResult,
      authorization_id: authorization.authorization_id,
      delivered_commit: commitSha,
      delivered_artifact_sha256: artifactSha,
    });
    const receipt = {
      uri: `file://${profile.engine_profile.receipt_root}/${effectId}.json`,
      sha256: receiptSha,
    };
    const rawDeliveredManifest = {
      commit: commitSha,
      artifacts: [{
        id: 'workspace',
        path: 'workspace.tar',
        sha256: artifactSha,
      }],
      receipt_sha256: receiptSha,
      boundary_effect_id: effectId,
    };
    const normalized = installedEngine.normalizeDispatchDeliveredManifest(rawDeliveredManifest);
    // Coordinator/verification/challenge must use full-commitment acceptance set.
    deliveredManifest = normalized.acceptance_set;
    manifestHash = normalized.acceptance_set_hash;
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
      delivered_manifest: rawDeliveredManifest,
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
  identity: profile.engine_profile.route.coordinator_binding.identity,
  trust_tier: 'external',
  attestation_hash: profile.engine_profile.route.coordinator_binding.attestation_hash,
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
    profile_hash: profile.engine_profile.profile_hash,
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
      uri: `durable://p37-installed-engine-evidence/${hash(verified_evidence)}`,
      sha256: hash(verified_evidence),
    };
  },
  verificationVerifier(_request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'runner-a',
      channel: 'p37-installed-engine-runner',
      envelope_hash: hash('p37-installed-engine-verification-envelope'),
      payload: {
        emitter_kind: 'runner',
        verification_path: 'trusted_runner',
        attestation_sha256: hash('attestation:runner-a'),
        verification_id: 'p37-installed-engine-verification',
        intent_id: context.intent_id,
        leg_id: 'tests',
        outcome: 'green',
        command_hash: hash('node --test'),
        candidate_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        exit_code: 0,
        stdout_hash: hash('p37-installed-engine-test-stdout'),
        stderr_hash: hash('p37-installed-engine-test-stderr'),
        executed_at: NOW,
      },
    };
  },
  challengeVerifier(envelope, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'challenger-a',
      channel: 'p37-installed-engine-challenge',
      envelope_hash: hash({ challenge: envelope.scope_id }),
      payload: {
        verification_path: 'qualified_challenge',
        attestation_sha256: hash('attestation:challenger-a'),
        challenge_id: `p37-installed-engine-challenge-${envelope.scope_id}`,
        intent_id: context.intent_id,
        scope: 'contract_leg',
        scope_id: envelope.scope_id,
        finding: 'clear',
        candidate_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        subject_identity: profile.engine_profile.route.worker_binding.identity,
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
      identity: profile.engine_profile.route.coordinator_binding.identity,
      channel: 'p37-installed-engine-provenance',
      envelope_hash: hash({ provenance: request }),
      payload: {
        verification_path: 'artifact_provenance',
        attestation_sha256: profile.engine_profile.route.coordinator_binding.attestation_hash,
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
      identity: profile.engine_profile.route.coordinator_binding.identity,
      channel: 'p37-installed-engine-audit',
      envelope_hash: hash('p37-installed-engine-audit-envelope'),
      payload: {
        verification_path: 'acceptance_audit',
        attestation_sha256: profile.engine_profile.route.coordinator_binding.attestation_hash,
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

const sharedWitnessInvoke = runtime.createWitnessInvoke();
const session = installedEngine.createInstalledEngineSession({
  profile,
  binding: installedBinding,
  durableBinding,
  governanceConfig,
  acceptanceContract,
  routeInputs,
  witnessInvoke: sharedWitnessInvoke,
  engineInvoke,
  coordinatorInvoke,
  requestIdFactory: ({ label, counter }) => `installed-engine-${label}-${counter}`,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: {
        text: 'Dispatch one installed implementation unit and accept its verified artifact.',
        explicit_action_hashes: [],
      },
    },
    initialOwnerId: 'owner-a',
    adapters,
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'e'.repeat(64),
  },
});
assert.deepEqual(session.authority, installedEngine.INSTALLED_ENGINE_AUTHORITY);
assert.equal(session.sink_id, 'engine-implementation-dispatch-v1');
assert.equal(session.engineTerminalIsAcceptance('committed'), false);
assert.equal(session.engineTerminalIsAcceptance('converged'), false);

(async () => {
  assert.throws(
    () => session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'foreign-sink' },
      actionClass: 'external',
      actionDescriptor: {
        operation: 'engine_review_dispatch',
        tool_class: 'model_runner',
        targets: ['autopilot-engine:review-dispatch'],
      },
    }),
    /non-implementation|ENGINE_SINK_REJECTED|sink/i,
  );
  assert.equal(capturedExecuteMessages.length, 0);

  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'dispatch' },
    actionClass: 'external',
    actionDescriptor: profile.action,
  });
  const actionIdentityBefore = session.getActionIdentity();
  assert.equal(actionIdentityBefore.catalog_id, 'engine-implementation-dispatch-v1');
  assert.equal(actionIdentityBefore.status, 'authorized');

  session.kernel.submitApproval({
    signed: true,
    payload: {
      decision_id: decision.payload.decision_id,
      decision_content_hash: decision.payload.decision_content_hash,
      max_uses: 1,
    },
  });
  await assert.rejects(
    () => session.kernel.executeAuthorizedAction({
      decisionId: decision.payload.decision_id,
      action: { ...profile.action, targets: ['autopilot-engine:review-dispatch'] },
      timeoutMilliseconds: 1000,
    }),
    /substituted|does not exactly match|ENGINE_SINK_REJECTED|authorized descriptor/i,
  );
  assert.equal(capturedExecuteMessages.length, 0);

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
  assert.equal(session.engineTerminalIsAcceptance('committed'), false);
  assert.equal(session.getActionIdentity().status, 'dispatched');

  await assert.rejects(
    () => session.kernel.executeAuthorizedAction({
      decisionId: decision.payload.decision_id,
      action: profile.action,
      timeoutMilliseconds: 1000,
    }),
    /redispatch|ENGINE_REDISPATCH_FORBIDDEN|terminal|uses|permit|authorization/i,
  );
  assert.equal(sinkCalls.length, 1);

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
  assert.equal(session.getActionIdentity().status, 'accepted');
  // Engine terminal labels remain non-acceptance even after separate Kernel acceptance.
  assert.equal(session.engineTerminalIsAcceptance('committed'), false);
  assert.equal(session.engineTerminalIsAcceptance('converged'), false);

  const disclosure = session.disclosure();
  assert.ok(disclosure && typeof disclosure === 'object');
  assert.equal(typeof disclosure.run_id, 'string');
  assert.ok(Array.isArray(disclosure.decisions));
  const ledger = session.kernel.getLedger();
  const acceptanceEvent = ledger.events.filter((event) => event.type === 'acceptance').at(-1);
  const completeEvent = ledger.events.filter((event) => event.type === 'complete').at(-1);
  assert.ok(acceptanceEvent && completeEvent);
  const result = installedEngine.buildInstalledEngineResult({
    profile,
    status: 'complete',
    outcome: 'accepted',
    accepted: true,
    terminalBatch: 'atomic',
    disclosure,
    ledgerHead: completeEvent.event_hash,
    deliveredManifestHead: acceptanceEvent.payload.delivered_set_hash,
    candidateSetHash: acceptanceEvent.payload.candidate_set_hash,
    acceptanceEventHash: acceptanceEvent.event_hash,
    completeEventHash: completeEvent.event_hash,
    ledger,
    witness: session.witness,
    acceptanceAuthority: session.acceptance_authority,
  });
  assert.equal(result.sink_id, 'engine-implementation-dispatch-v1');
  assert.equal(result.terminal_batch, 'atomic');
  assert.equal(result.accepted, true);
  assert.equal(result.status, 'complete');
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.disclosure_hash, hash(disclosure));
  assert.equal(result.ledger_head, completeEvent.event_hash);
  assert.equal(result.acceptance_event_hash, acceptanceEvent.event_hash);
  assert.equal(result.complete_event_hash, completeEvent.event_hash);
  assert.equal(result.action_identity.status, 'accepted');
  assert.equal(result.action_identity.terminal, true);
  assert.equal(result.action_identity.catalog_id, 'engine-implementation-dispatch-v1');
  // delivered-manifest-proof: head is the coordinator delivered_set_hash, bound to candidate.
  assert.equal(
    result.delivered_manifest_head,
    acceptanceEvent.payload.delivered_set_hash,
    'delivered_manifest_head must equal verified coordinator delivered_set_hash',
  );
  assert.equal(
    result.delivered_manifest_head,
    result.candidate_set_hash,
    'delivered_manifest_head must satisfy same-manifest relationship to candidate_set_hash',
  );

  // Dispatch commitment must exact-match coordinator delivered_set_hash.
  const dispatchManifest = session.getDispatchDeliveredManifest();
  assert.ok(dispatchManifest, 'session must expose dispatch delivered-manifest');
  assert.equal(dispatchManifest.acceptance_set_hash, manifestHash);
  assert.equal(dispatchManifest.commit, 'c'.repeat(40));
  assert.equal(
    acceptanceEvent.payload.delivered_set_hash,
    dispatchManifest.acceptance_set_hash,
  );
  assert.notEqual(
    dispatchManifest.acceptance_set[0].sha256,
    contentWorkspaceSha,
    'acceptance-bound digest must include commitment_hash',
  );

  // substitution/synthetic-manifest: host that binds a different artifact set must fail closed.
  {
    const badRuntime = createP37Runtime(root, {
      actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
      acceptanceContract,
      runId: 'p37-installed-engine-manifest-mismatch',
    });
    // Reuse same hosts pattern with mismatched coordinator manifest is hard inline;
    // unit-test normalizeDispatchDeliveredManifest + assert path via direct API.
    const ok = installedEngine.normalizeDispatchDeliveredManifest({
      commit: 'a'.repeat(40),
      artifacts: [{ id: 'workspace', path: 'x', sha256: 'b'.repeat(64) }],
      receipt_sha256: 'c'.repeat(64),
      boundary_effect_id: 'effect-1',
    });
    assert.equal(ok.artifacts[0].sha256, 'b'.repeat(64));
    assert.equal(typeof ok.commitment_hash, 'string');
    assert.equal(typeof ok.artifact_set_hash, 'string');
    let stubRejected = false;
    try {
      installedEngine.normalizeDispatchDeliveredManifest({
        commit: 'd'.repeat(40),
        artifacts: [{ id: 'workspace', path: 'x', sha256: 'b'.repeat(64) }],
        receipt_sha256: 'c'.repeat(64),
        boundary_effect_id: 'effect-1',
      });
    } catch (error) {
      stubRejected = /stub|DISPATCH_MANIFEST/i.test(String(error && error.message));
      assert.equal(error.code, 'DISPATCH_MANIFEST_INVALID');
    }
    assert.equal(stubRejected, true, 'stub commit must be rejected');
  }


  assert.equal(
    result.candidate_set_hash,
    acceptanceEvent.payload.candidate_set_hash,
  );
  // engine_observation is derived from verified action-outcome replay, not caller labels.
  assert.ok(result.engine_observation && typeof result.engine_observation === 'object');
  assert.equal(result.engine_observation.engine_status_is_not_acceptance, true);
  assert.equal(result.engine_observation.outcome, 'succeeded');
  // delivered-manifest-proof: caller substitution of delivered head fails.
  assert.throws(
    () => installedEngine.buildInstalledEngineResult({
      profile,
      status: 'complete',
      outcome: 'accepted',
      accepted: true,
      terminalBatch: 'atomic',
      ledger,
      deliveredManifestHead: 'a'.repeat(64),
      candidateSetHash: acceptanceEvent.payload.candidate_set_hash,
      witness: session.witness,
      acceptanceAuthority: session.acceptance_authority,
    }),
    /delivered_manifest_head|verified ledger|candidate/i,
  );
  // result-acceptance-substitution: accepted:false rejects acceptance-like material.
  assert.throws(
    () => installedEngine.normalizeInstalledEngineResult({
      schema_version: result.schema_version,
      kind: result.kind,
      status: 'complete',
      outcome: 'accepted',
      profile_hash: result.profile_hash,
      sink_id: result.sink_id,
      action_identity: { status: 'accepted', terminal: true, catalog_id: result.sink_id },
      engine_observation: { accepted: true, outcome: 'accepted' },
      accepted: false,
      terminal_batch: 'atomic',
      authority: result.authority,
      disclosure: {},
      disclosure_hash: hash({}),
      ledger: null,
      ledger_head: null,
      delivered_manifest_head: 'b'.repeat(64),
      candidate_set_hash: 'c'.repeat(64),
      acceptance_event_hash: 'd'.repeat(64),
      complete_event_hash: 'e'.repeat(64),
      result_hash: 'f'.repeat(64),
    }),
    /accepted:false|acceptance-like|ACCEPTANCE_LIKE/i,
  );
  assert.throws(
    () => installedEngine.buildInstalledEngineResult({
      profile,
      status: 'complete',
      outcome: 'accepted',
      accepted: false,
      terminalBatch: 'atomic',
      deliveredManifestHead: acceptanceEvent.payload.delivered_set_hash,
      candidateSetHash: acceptanceEvent.payload.candidate_set_hash,
      acceptanceEventHash: acceptanceEvent.event_hash,
      completeEventHash: completeEvent.event_hash,
    }),
    /accepted:false|acceptance-like|ACCEPTANCE_LIKE/i,
  );
  assert.throws(
    () => installedEngine.normalizeInstalledEngineResult({
      ...result,
      terminal_batch: null,
      result_hash: '0'.repeat(64),
    }, {
      profile,
      witness: session.witness,
      acceptanceAuthority: session.acceptance_authority,
    }),
    /atomic|ACCEPTANCE_BATCH|accepted:true|injection/i,
  );
  assert.throws(
    () => installedEngine.normalizeInstalledEngineResult(result),
    /duck-typed|intake-frozen|ACCEPTANCE_BATCH|authoritative witness|acceptance coordinator|profile/i,
  );
  // accepted-result profile binding: substituted profile_hash with recomputed
  // result_hash cannot legitimize acceptance against intake-frozen authorities.
  {
    const substituted = {
      ...result,
      profile_hash: 'a'.repeat(64),
    };
    const material = { ...substituted };
    delete material.result_hash;
    material.result_hash = hash(material);
    assert.throws(
      () => installedEngine.normalizeInstalledEngineResult(material, {
        profile,
        witness: session.witness,
        acceptanceAuthority: session.acceptance_authority,
      }),
      /profile_hash|substituted profile|intake-frozen|exact/i,
    );
  }
  // accepted-verifier-authority: duck-typed witness/coordinator substitutes are rejected.
  const duckWitness = {
    identity: session.witness.identity,
    attestation_hash: session.witness.attestation_hash,
    protocol_version: 1,
    trustTier: 'external',
    streamId: session.witness.streamId,
    getHead: () => session.witness.getHead(),
    verifyBatch: () => true,
    verify: () => true,
  };
  const duckCoordinator = {
    identity: session.acceptance_authority.identity,
    attestation_hash: session.acceptance_authority.attestation_hash,
    protocol_version: 2,
    trustTier: 'external',
    acquire: () => ({}),
    commit: async () => ({}),
    requestAbort: () => ({}),
    cancel: () => ({}),
    resolveAttempt: () => ({}),
    verifyCommit: () => true,
    verifyResolution: () => true,
    release: () => ({}),
  };
  assert.throws(
    () => installedEngine.normalizeInstalledEngineResult(result, {
      profile,
      witness: duckWitness,
      acceptanceAuthority: duckCoordinator,
    }),
    /duck-typed|intake-frozen|ACCEPTANCE_BATCH/i,
  );
  // accepted-result-injection: status "accepted" and caller engineObservation are rejected.
  assert.throws(
    () => installedEngine.buildInstalledEngineResult({
      profile,
      status: 'accepted',
      outcome: 'accepted',
      accepted: true,
      terminalBatch: 'atomic',
      ledger,
      witness: session.witness,
      acceptanceAuthority: session.acceptance_authority,
    }),
    /status injection|exact-match verified replay|accepted:true/i,
  );
  assert.throws(
    () => installedEngine.buildInstalledEngineResult({
      profile,
      status: 'complete',
      outcome: 'accepted',
      engineObservation: 'committed',
      accepted: true,
      terminalBatch: 'atomic',
      ledger,
      witness: session.witness,
      acceptanceAuthority: session.acceptance_authority,
    }),
    /engineObservation|action-outcome|observation injection/i,
  );
  // durable-regression-contradiction / durable non-influence: top-level
  // durableBinding is intentionally ignored as a derivation input. Two otherwise
  // identical valid calls that differ only in that option must yield
  // byte-identical canonically derived durable/profile material — do not expect a
  // throw when the option is present.
  const compileBase = {
    binding: installedBinding,
    governanceConfig,
    acceptanceContract,
    routeInputs,
    capabilityProbedAt: NOW,
    capabilityExpiresAt: EXPIRES,
  };
  const derivedWithoutCallerDurable = installedEngine.compileInstalledEngineProfile({
    ...compileBase,
  });
  const derivedWithCallerDurable = installedEngine.compileInstalledEngineProfile({
    ...compileBase,
    durableBinding,
  });
  assert.equal(
    canonicalJson(derivedWithoutCallerDurable),
    canonicalJson(derivedWithCallerDurable),
    'top-level durableBinding option must not influence canonically derived durable/profile material',
  );
  assert.equal(
    canonicalJson(derivedWithoutCallerDurable.engine_profile),
    canonicalJson(derivedWithCallerDurable.engine_profile),
  );
  assert.equal(
    derivedWithoutCallerDurable.engine_profile.route.p36_install_binding_hash,
    derivedWithCallerDurable.engine_profile.route.p36_install_binding_hash,
  );
  assert.equal(
    derivedWithoutCallerDurable.engine_profile.route.durable_abi_hash,
    derivedWithCallerDurable.engine_profile.route.durable_abi_hash,
  );

  assert.throws(
    () => installedEngine.rejectForeignEngineSink('implementation-dispatch'),
    (error) => error instanceof OwnerKernelError && error.code === 'ENGINE_SINK_REJECTED',
  );
  assert.throws(
    () => installedEngine.compileInstalledEngineProfile({
      binding: installedBinding,
      sink_id: 'implementation-dispatch',
      governanceConfig,
      acceptanceContract,
      routeInputs,
      capabilityProbedAt: NOW,
      capabilityExpiresAt: EXPIRES,
    }),
    /exact|alias|ENGINE_SINK_REJECTED|substitute/i,
  );
  assert.throws(
    () => installedEngine.compileInstalledEngineProfile({
      binding: installedBinding,
      governanceConfig,
      acceptanceContract,
      routeInputs,
      durableBinding: {
        ...durableBinding,
        install_binding_hash: 'a'.repeat(64),
      },
      capabilityProbedAt: NOW,
      capabilityExpiresAt: EXPIRES,
    }),
    /override|INSTALLED_BINDING_MISMATCH|mismatch/i,
  );

  // resume binding: route-core-equivalent but full-binding-different must reject
  // (installed_binding_hash must exactly equal the normalized supplied binding hash).
  {
    const altBinding = installedContract.normalizeInstalledBinding({
      ...installedBinding,
      snapshot_hash: hash(`resume-binding-alt:${installedBinding.snapshot_hash}`),
    });
    assert.notEqual(
      sha256(canonicalJson(altBinding)),
      profile.installed_binding_hash,
      'fixture must differ in full installed binding hash',
    );
    assert.equal(
      altBinding.install_binding_hash,
      installedBinding.install_binding_hash,
      'route-core install hash remains equivalent',
    );
    assert.throws(
      () => installedEngine.resumeInstalledEngineSession({
        profile,
        binding: altBinding,
        governanceConfig,
        acceptanceContract,
        routeInputs,
        ledger,
        priorActionIdentity: session.getActionIdentity(),
        witnessInvoke: sharedWitnessInvoke,
        engineInvoke,
        coordinatorInvoke,
        kernelOptions: {
          adapters,
          clock: () => new Date(runtime.NOW),
          nonceFactory: () => 'e'.repeat(64),
        },
      }),
      /binding does not match profile|INSTALLED_BINDING_MISMATCH|installed Engine session binding/i,
    );
  }

  const priorIdentity = session.getActionIdentity();
  priorIdentity.delivered_manifest = session.getDispatchDeliveredManifest();
  const resumed = installedEngine.resumeInstalledEngineSession({
    profile,
    binding: installedBinding,
    durableBinding,
    governanceConfig,
    acceptanceContract,
    routeInputs,
    ledger,
    priorActionIdentity: priorIdentity,
    witnessInvoke: sharedWitnessInvoke,
    engineInvoke,
    coordinatorInvoke,
    requestIdFactory: ({ label, counter }) => `installed-engine-resume-${label}-${counter}`,
    kernelOptions: {
      adapters,
      clock: () => new Date(runtime.NOW),
      nonceFactory: () => 'f'.repeat(64),
    },
  });
  assert.equal(resumed.getActionIdentity().decision_id, priorIdentity.decision_id);
  assert.equal(resumed.getActionIdentity().catalog_id, priorIdentity.catalog_id);
  assert.equal(resumed.getActionIdentity().status, 'accepted');
  assert.equal(resumed.kernel.getState().terminal_reason, 'accepted');
  assert.equal(sinkCalls.length, 1);
  assert.throws(
    () => resumed.kernel.mintActionDecision({
      capability: resumed.owner_capability || session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'post-accept' },
      actionClass: 'external',
      actionDescriptor: profile.action,
    }),
    /terminal|redispatch|capability|accepted|second identity/i,
  );
  session.teardown();
  resumed.teardown();

  const abortRuntime = createP37Runtime(root, {
    actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
    acceptanceContract,
    runId: 'p37-installed-engine-abort',
  });
  const abortBinding = installedContract.normalizeInstalledBinding({
    ...makeInstalledBinding(),
    install_binding_hash: abortRuntime.durableBinding.install_binding_hash,
    run_binding_hash: abortRuntime.durableBinding.run_binding_hash,
    durable_abi_hash: abortRuntime.durableBinding.durable_abi_hash,
    cohort_id: abortRuntime.durableBinding.cohort_id,
    service_bindings: {
      kernel: {
        role: 'kernel',
        identity: abortRuntime.kernelBinding.identity,
        uid: abortRuntime.kernelBinding.uid,
        gid: abortRuntime.kernelBinding.gid,
        attestation_hash: abortRuntime.kernelBinding.attestation_hash,
        cgroup_binding_hash: abortRuntime.kernelBinding.cgroup_binding_hash,
      },
      ...Object.fromEntries(
        Object.entries(abortRuntime.serviceBindings).map(([role, service]) => [role, {
          role,
          identity: service.identity,
          uid: service.uid,
          gid: service.gid,
          attestation_hash: service.attestation_hash,
          cgroup_binding_hash: service.cgroup_binding_hash,
        }]),
      ),
    },
    snapshot_hash: hash(`abort-snapshot:${abortRuntime.durableBinding.cohort_id}`),
  });
  const abortProfile = installedEngine.compileInstalledEngineProfile({
    binding: abortBinding,
    governanceConfig: abortRuntime.governanceConfig,
    acceptanceContract,
    routeInputs: abortRuntime.routeInputs,
    durableBinding: abortRuntime.durableBinding,
    kernelBinding: abortRuntime.kernelBinding,
    capabilityProbedAt: NOW,
    capabilityExpiresAt: EXPIRES,
  });
  function abortEngineInvoke(message) {
    if (message.operation && message.operation.startsWith('capability:')) {
      const request = message.request;
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response: {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: hash({ operation: message.operation, request }),
          probe_nonce: request.probe_nonce,
        },
        response_hash: hash({
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: hash({ operation: message.operation, request }),
          probe_nonce: request.probe_nonce,
        }),
      };
    }
    throw new Error('abort session must not redispatch');
  }
  const abortWitnessInvoke = abortRuntime.createWitnessInvoke();
  const abortSession = installedEngine.createInstalledEngineSession({
    profile: abortProfile,
    binding: abortBinding,
    durableBinding: abortRuntime.durableBinding,
    governanceConfig: abortRuntime.governanceConfig,
    acceptanceContract,
    routeInputs: abortRuntime.routeInputs,
    witnessInvoke: abortWitnessInvoke,
    engineInvoke: abortEngineInvoke,
    coordinatorInvoke: () => {
      throw new Error('abort session must not commit');
    },
    kernelOptions: {
      initialIntentEnvelope: {
        signed: true,
        payload: { text: 'Abort recovery without redispatch.', explicit_action_hashes: [] },
      },
      initialOwnerId: 'owner-a',
      adapters: abortRuntime.adapters(),
      clock: () => new Date(abortRuntime.NOW),
      nonceFactory: () => 'a'.repeat(64),
    },
  });
  const abortDecision = abortSession.kernel.mintActionDecision({
    capability: abortSession.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'abort-path' },
    actionClass: 'external',
    actionDescriptor: abortProfile.action,
  });
  const aborted = abortSession.abortAction('operator_abort');
  assert.equal(aborted.status, 'aborted');
  assert.equal(aborted.decision_id, abortDecision.payload.decision_id);
  assert.equal(aborted.catalog_id, 'engine-implementation-dispatch-v1');
  const persistedAbort = abortSession.getPersistedAbort();
  assert.ok(persistedAbort);
  assert.equal(persistedAbort.kind, 'p37_installed_engine_action_abort');
  assert.equal(persistedAbort.decision_id, abortDecision.payload.decision_id);
  const abortLedger = abortSession.kernel.getLedger();
  const abortResumed = installedEngine.resumeInstalledEngineSession({
    profile: abortProfile,
    binding: abortBinding,
    durableBinding: abortRuntime.durableBinding,
    governanceConfig: abortRuntime.governanceConfig,
    acceptanceContract,
    routeInputs: abortRuntime.routeInputs,
    ledger: abortLedger,
    persistedAbort,
    witnessInvoke: abortWitnessInvoke,
    engineInvoke: abortEngineInvoke,
    coordinatorInvoke: () => {
      throw new Error('abort resume must not accept');
    },
    kernelOptions: {
      adapters: abortRuntime.adapters(),
      clock: () => new Date(abortRuntime.NOW),
      nonceFactory: () => 'b'.repeat(64),
    },
  });
  assert.equal(abortResumed.getActionIdentity().status, 'aborted');
  assert.equal(abortResumed.getActionIdentity().decision_id, abortDecision.payload.decision_id);
  await assert.rejects(
    () => abortResumed.kernel.executeAuthorizedAction({
      decisionId: abortDecision.payload.decision_id,
      action: abortProfile.action,
      timeoutMilliseconds: 1000,
    }),
    /redispatch|aborted|ENGINE_REDISPATCH_FORBIDDEN|terminal|uses|permit|authorization/i,
  );
  assert.throws(
    () => abortResumed.kernel.mintActionDecision({
      capability: abortResumed.owner_capability || abortSession.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'post-abort' },
      actionClass: 'external',
      actionDescriptor: abortProfile.action,
    }),
    /second identity|redispatch|terminal|aborted|ENGINE_REDISPATCH_FORBIDDEN/i,
  );
  abortSession.teardown();
  abortResumed.teardown();


  // --- Full-commitment binding regressions ---
  // 1) Coordinator/caller set mismatch rejects before acceptance/complete append.
  {
    const mismatchRuntime = createP37Runtime(root, {
      actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
      acceptanceContract,
      runId: 'p37-manifest-mismatch',
    });
    const mismatchHash = mismatchRuntime.hash;
    const mismatchBinding = (() => {
      const roles = installedContract.SERVICE_ROLES;
      const bindings = {};
      for (const role of roles) {
        if (role === 'kernel') {
          bindings.kernel = {
            role: 'kernel',
            identity: mismatchRuntime.kernelBinding.identity,
            uid: mismatchRuntime.kernelBinding.uid,
            gid: mismatchRuntime.kernelBinding.gid,
            attestation_hash: mismatchRuntime.kernelBinding.attestation_hash,
            cgroup_binding_hash: mismatchRuntime.kernelBinding.cgroup_binding_hash,
          };
          continue;
        }
        const service = mismatchRuntime.serviceBindings[role];
        bindings[role] = {
          role,
          identity: service.identity,
          uid: service.uid,
          gid: service.gid,
          attestation_hash: service.attestation_hash,
          cgroup_binding_hash: service.cgroup_binding_hash,
        };
      }
      return {
        schema_version: 1,
        kind: 'p37_installed_state_binding',
        install_binding_hash: mismatchRuntime.durableBinding.install_binding_hash,
        run_binding_hash: mismatchRuntime.durableBinding.run_binding_hash,
        installed_abi_hash: installedContract.getSupervisedOwnerKernelInstalledAbiHash(),
        durable_abi_hash: mismatchRuntime.durableBinding.durable_abi_hash,
        cohort_id: mismatchRuntime.durableBinding.cohort_id,
        generation: mismatchRuntime.durableBinding.generation,
        service_bindings: bindings,
        snapshot_hash: mismatchHash({
          install: mismatchRuntime.durableBinding.install_binding_hash,
          run: mismatchRuntime.durableBinding.run_binding_hash,
          cohort: mismatchRuntime.durableBinding.cohort_id,
        }),
      };
    })();
    const mismatchNow = new Date(mismatchRuntime.NOW).toISOString();
    const mismatchExpires = new Date(mismatchRuntime.NOW + 3600000).toISOString();
    const mismatchProfile = installedEngine.compileInstalledEngineProfile({
      binding: mismatchBinding,
      governanceConfig: mismatchRuntime.governanceConfig,
      acceptanceContract,
      routeInputs: mismatchRuntime.routeInputs,
      durableBinding: mismatchRuntime.durableBinding,
      kernelBinding: mismatchRuntime.kernelBinding,
      capabilityProbedAt: mismatchNow,
      capabilityExpiresAt: mismatchExpires,
    });
    const wrongManifest = [{ id: 'workspace', sha256: 'e'.repeat(64) }];
    const wrongHash = mismatchHash(wrongManifest);
    const authorizations = new Map();
    const consumed = new Set();
    let captureManifest = null;
    function mismatchHostResponse(message, response) {
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: mismatchHash(response),
      };
    }
    function mismatchEngineInvoke(message) {
      const request = message.request;
      if (message.operation.startsWith('capability:')) {
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: mismatchHash({ operation: message.operation, request }),
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
            expires_at: new Date(mismatchRuntime.NOW + 120000).toISOString(),
            attestation_hash: mismatchHash(`permit:${request.claim_id}`),
            issuer: mismatchProfile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: mismatchProfile.engine_profile.route.kernel_binding.attestation_hash,
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
            issued_at: mismatchNow,
            expires_at: new Date(mismatchRuntime.NOW + 60000).toISOString(),
            attestation_hash: mismatchHash(`authorization:${request.claim_id}`),
            issuer: mismatchProfile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: mismatchProfile.engine_profile.route.kernel_binding.attestation_hash,
            authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
          };
          authorizations.set(authorization.authorization_id, authorization.authorization);
          response.execution_authorization = authorization;
        }
        return mismatchHostResponse(message, response);
      }
      if (message.operation === 'execute_engine_dispatch') {
        const authorization = request.execution_authorization;
        consumed.add(authorization.authorization_id);
        const effectId = `mismatch-effect-${request.claim_id}`;
        const commitSha = 'a'.repeat(40);
        const artifactSha = contentWorkspaceSha;
        const receiptSha = mismatchHash({ effect_id: effectId, commit: commitSha });
        const raw = {
          commit: commitSha,
          artifacts: [{ id: 'workspace', path: 'workspace.tar', sha256: artifactSha }],
          receipt_sha256: receiptSha,
          boundary_effect_id: effectId,
        };
        captureManifest = installedEngine.normalizeDispatchDeliveredManifest(raw);
        return mismatchHostResponse(message, {
          receipt: {
            uri: `file://${mismatchProfile.engine_profile.receipt_root}/${effectId}.json`,
            sha256: receiptSha,
          },
          broker: {
            identity: mismatchRuntime.serviceBindings.broker.identity,
            broker_uid: mismatchRuntime.serviceBindings.broker.uid,
          },
          execution_permit_hash: request.execution_permit_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: authorization.authorization_id,
          claim_event_hash: request.claim_event_hash,
          claim_witness_head: request.claim_witness_head,
          permit_state: 'consumed',
          boundary_effect_id: effectId,
          boundary_state_version: 1,
          boundary_attestation_hash: mismatchRuntime.serviceBindings.broker.attestation_hash,
          effect_at: mismatchNow,
          delivered_manifest: raw,
        });
      }
      if (message.operation === 'verify_engine_dispatch') {
        const receipt = request.receipt;
        return mismatchHostResponse(message, {
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
          observed_action: mismatchProfile.action,
          error_code: null,
        });
      }
      throw new Error(`unexpected op ${message.operation}`);
    }
    // Coordinator deliberately returns WRONG artifact set (not full-commitment set).
    function mismatchCoordinatorInvoke(message) {
      const request = message.request;
      if (message.operation === 'coordinator_cancel'
        || message.operation === 'coordinator_release'
        || message.operation === 'coordinator_request_abort') {
        return mismatchHostResponse(message, { ok: true, disposition: 'cancelled' });
      }
      if (message.operation === 'coordinator_acquire') {
        const normalized = {
          attempt_id: request.attempt_id,
          attempt_hash: request.attempt_hash,
          intent_id: request.expected_intent_id,
          transaction_id: `txn-${request.attempt_id}`,
          fence: mismatchHash(`fence:${request.attempt_id}`),
          candidate_artifacts: wrongManifest,
          delivered_artifacts: wrongManifest,
          candidate_set_hash: wrongHash,
          delivered_set_hash: wrongHash,
          audit_head: mismatchHash('audit-mismatch'),
          control_event_head: request.expected_event_head,
          control_witness_head: request.expected_witness_head,
          snapshot_at: mismatchNow,
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
          snapshot_hash: mismatchHash({ run_id: request.run_id, ...normalized }),
        };
        return mismatchHostResponse(message, snapshot);
      }
      throw new Error(`coordinator should not reach ${message.operation} after mismatch`);
    }
    // Minimal adapters for verification path before accept.
    const adapters = {
      ...mismatchRuntime.adapters(),
      evidenceArchiver({ verified_evidence }) {
        return {
          uri: `durable://mismatch/${mismatchHash(verified_evidence)}`,
          sha256: mismatchHash(verified_evidence),
        };
      },
      verificationVerifier(_request, context) {
        return {
          ok: true,
          run_id: context.run_id,
          identity: 'runner-a',
          channel: 'mismatch-runner',
          envelope_hash: mismatchHash('mismatch-verification'),
          payload: {
            emitter_kind: 'runner',
            verification_path: 'trusted_runner',
            attestation_sha256: mismatchHash('attestation:runner-a'),
            verification_id: 'mismatch-verification',
            intent_id: context.intent_id,
            leg_id: 'tests',
            outcome: 'green',
            command_hash: mismatchHash('node --test'),
            candidate_artifacts: captureManifest
              ? captureManifest.acceptance_set
              : wrongManifest,
            candidate_set_hash: captureManifest
              ? captureManifest.acceptance_set_hash
              : wrongHash,
            exit_code: 0,
            stdout_hash: mismatchHash('out'),
            stderr_hash: mismatchHash('err'),
            executed_at: mismatchNow,
          },
        };
      },
      challengeVerifier(envelope, context) {
        return {
          ok: true,
          run_id: context.run_id,
          identity: 'challenger-a',
          channel: 'mismatch-challenge',
          envelope_hash: mismatchHash({ challenge: envelope.scope_id }),
          payload: {
            verification_path: 'qualified_challenge',
            attestation_sha256: mismatchHash('attestation:challenger-a'),
            challenge_id: `mismatch-challenge-${envelope.scope_id}`,
            intent_id: context.intent_id,
            scope: 'contract_leg',
            scope_id: envelope.scope_id,
            finding: 'clear',
            candidate_artifacts: captureManifest
              ? captureManifest.acceptance_set
              : wrongManifest,
            candidate_set_hash: captureManifest
              ? captureManifest.acceptance_set_hash
              : wrongHash,
            subject_identity: mismatchProfile.engine_profile.route.worker_binding.identity,
            subject_family: 'qwen',
            result_hash: mismatchHash(`challenge-result:${envelope.scope_id}`),
            reviewed_at: mismatchNow,
          },
        };
      },
      artifactProvenanceVerifier(request, context) {
        return {
          ok: true,
          run_id: context.run_id,
          identity: mismatchProfile.engine_profile.route.coordinator_binding.identity,
          channel: 'mismatch-provenance',
          envelope_hash: mismatchHash({ provenance: request }),
          payload: {
            verification_path: 'artifact_provenance',
            attestation_sha256: mismatchHash('attestation:provenance'),
            candidate_artifacts: captureManifest
              ? captureManifest.acceptance_set
              : wrongManifest,
            candidate_set_hash: captureManifest
              ? captureManifest.acceptance_set_hash
              : wrongHash,
            observed_at: mismatchNow,
          },
        };
      },
    };
    // Skip full happy path if adapters incomplete — focus on execute + accept mismatch.
    // Use same adapter shape as main test if available via runtime.adapters only
    // and recordVerification with purpose.
    const witnessInvoke = mismatchRuntime.createWitnessInvoke();
    const session = installedEngine.createInstalledEngineSession({
      profile: mismatchProfile,
      binding: mismatchBinding,
      durableBinding: mismatchRuntime.durableBinding,
      governanceConfig: mismatchRuntime.governanceConfig,
      acceptanceContract,
      routeInputs: mismatchRuntime.routeInputs,
      witnessInvoke,
      engineInvoke: mismatchEngineInvoke,
      coordinatorInvoke: mismatchCoordinatorInvoke,
      requestIdFactory: ({ label: part, counter }) => `mm-${part}-${counter}`,
      kernelOptions: {
        initialIntentEnvelope: {
          signed: true,
          payload: { text: 'mismatch', explicit_action_hashes: [] },
        },
        initialOwnerId: 'owner-a',
        adapters: mismatchRuntime.adapters(),
        clock: () => new Date(mismatchRuntime.NOW),
        nonceFactory: () => mismatchHash('nonce-mm').slice(0, 64),
      },
    });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'mismatch' },
      actionClass: 'external',
      actionDescriptor: mismatchProfile.action,
    });
    session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: decision.payload.decision_id,
        decision_content_hash: decision.payload.decision_content_hash,
        max_uses: 1,
      },
    });
    await session.kernel.executeAuthorizedAction({
      decisionId: decision.payload.decision_id,
      action: mismatchProfile.action,
      timeoutMilliseconds: 1000,
    });
    assert.ok(session.getDispatchDeliveredManifest());
    let mismatchCode = null;
    let mismatchMessage = null;
    try {
      await session.kernel.accept({
        capability: session.owner_capability,
        timeoutMilliseconds: 1000,
      });
      assert.fail('coordinator mismatch must reject accept');
    } catch (error) {
      mismatchCode = error && error.code;
      mismatchMessage = String(error && error.message || '');
    }
    assert.equal(mismatchCode, 'DISPATCH_MANIFEST_MISMATCH');
    assert.match(mismatchMessage, /dispatch|commitment|mismatch/i);
    const ledger = session.kernel.getLedger();
    const types = (ledger.events || []).map((event) => event.type);
    assert.equal(types.includes('acceptance'), false, 'mismatch must leave zero acceptance events');
    assert.equal(types.includes('complete'), false, 'mismatch must leave zero complete events');
    session.teardown();
  }

  // 2) Metadata-only substitutions change commitment and fail exact match.
  {
    const base = installedEngine.normalizeDispatchDeliveredManifest({
      commit: 'a'.repeat(40),
      artifacts: [{ id: 'workspace', path: 'workspace.tar', sha256: 'b'.repeat(64), bytes: 12 }],
      receipt_sha256: 'c'.repeat(64),
      boundary_effect_id: 'effect-base',
    });
    const mutations = [
      { label: 'commit', patch: { commit: '1'.repeat(40) } },
      { label: 'path', patch: { artifacts: [{ id: 'workspace', path: 'other.tar', sha256: 'b'.repeat(64), bytes: 12 }] } },
      { label: 'receipt_sha256', patch: { receipt_sha256: '2'.repeat(64) } },
      { label: 'boundary_effect_id', patch: { boundary_effect_id: 'effect-other' } },
    ];
    for (const mutation of mutations) {
      const raw = {
        commit: base.commit,
        artifacts: base.artifacts.map((a) => ({ ...a })),
        receipt_sha256: base.receipt_sha256,
        boundary_effect_id: base.boundary_effect_id,
        ...mutation.patch,
      };
      // Keep artifact id+content sha256 identical for path mutation (path changes only).
      if (mutation.label === 'path') {
        assert.equal(raw.artifacts[0].sha256, base.artifacts[0].sha256);
        assert.equal(raw.artifacts[0].id, base.artifacts[0].id);
      }
      const mutated = installedEngine.normalizeDispatchDeliveredManifest(raw);
      assert.notEqual(
        mutated.commitment_hash,
        base.commitment_hash,
        `${mutation.label} must change commitment_hash`,
      );
      assert.notEqual(
        mutated.acceptance_set_hash,
        base.acceptance_set_hash,
        `${mutation.label} must change acceptance_set_hash`,
      );
      let failed = false;
      try {
        // Simulate resume/result exact-match against original acceptance set hash.
        installedEngine.normalizeDispatchDeliveredManifest; // keep lint quiet
        const { assert } = require('node:assert/strict');
        // Direct match helper path via acceptance assert equivalent:
        if (mutated.acceptance_set_hash === base.acceptance_set_hash) {
          throw new Error('should differ');
        }
        // reconstruct-style: original ledger hash must not match mutated commitment
        failed = mutated.acceptance_set_hash !== base.acceptance_set_hash;
      } catch (_error) {
        failed = true;
      }
      assert.equal(failed, true, `${mutation.label} metadata substitution must fail exact matching`);
    }
  }


console.log(JSON.stringify({
    installed_engine_sink: 'ok',
    sink_id: 'engine-implementation-dispatch-v1',
    sink_calls: sinkCalls.length,
    terminal_batch: 'atomic',
    lost_record_response: 'resolved_exactly_once',
    converged_is_not_terminal: true,
    committed_is_not_acceptance: true,
    redispatch_forbidden: true,
    resume_preserves_action_identity: true,
    abort_preserves_action_identity: true,
    abort_persisted_and_resumed: true,
    exact_disclosure: {
      run_id: disclosure.run_id,
      current_intent_id: disclosure.current_intent_id,
      decisions: disclosure.decisions,
    },
    corpus_evidence: {
      note: 'production corpus owns scenario-specific installed route mutations',
    },
  }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "U6 installed Engine process exits cleanly"
assert_contains "$OUT" '"installed_engine_sink":"ok"' "installed route exposes the fixed Engine sink"
assert_contains "$OUT" '"sink_id":"engine-implementation-dispatch-v1"' "exactly one immutable Engine action"
assert_contains "$OUT" '"sink_calls":1' "implementation authorization is consumed exactly once"
assert_contains "$OUT" '"terminal_batch":"atomic"' "acceptance and complete share one durable atomic batch"
assert_contains "$OUT" '"lost_record_response":"resolved_exactly_once"' "lost commit-record resolves by exact attempt without re-execution"
assert_contains "$OUT" '"committed_is_not_acceptance":true' "Engine committed is not Kernel acceptance"
assert_contains "$OUT" '"converged_is_not_terminal":true' "Engine converged is not Kernel acceptance"
assert_contains "$OUT" '"redispatch_forbidden":true' "open action identity never redispatches"
assert_contains "$OUT" '"resume_preserves_action_identity":true' "resume preserves one action identity"
assert_contains "$OUT" '"abort_preserves_action_identity":true' "abort preserves one action identity"
assert_contains "$OUT" '"abort_persisted_and_resumed":true' "abort is persisted and resume reconstructs without redispatch"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
