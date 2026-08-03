#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

if [ "${AUTOPILOT_P37_DOGFOOD:-0}" != "1" ]; then
  echo "SKIP [owner-kernel-installed-dogfood] set AUTOPILOT_P37_DOGFOOD=1 to run low-risk installed dogfood"
  exit 0
fi

OUT="$(node - "$REPO_ROOT" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = process.argv[2];
const { createP37Runtime } = require(path.join(root, 'hooks/tests/fixtures/p37-runtime'));
const baseEngine = require(path.join(root, 'src/engine'));
const installedEngine = require(path.join(root, 'src/engine/supervised-owner-kernel-installed-engine'));
const installedContract = require(path.join(root, 'src/engine/supervised-owner-kernel-installed-contract'));
const {
  canonicalJson,
  sha256,
} = require(path.join(root, 'src/engine/owner-kernel'));
const { decisionContent } = require(path.join(root, 'src/engine/owner-kernel/state'));

function expectedNormalizedActionDescriptor() {
  const targets = [baseEngine.ENGINE_IMPLEMENTATION_TARGET];
  return {
    action_class: 'external',
    catalog_id: baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ID,
    operation: baseEngine.ENGINE_IMPLEMENTATION_OPERATION,
    targets,
    target_set_hash: sha256(canonicalJson(targets)),
    tool_class: baseEngine.ENGINE_IMPLEMENTATION_TOOL_CLASS,
  };
}

function expectedDisclosureFromFixtures({
  runId,
  label,
  hash,
  principalId = 'owner-a',
  intentId = 'intent-1',
  decisionId = 'decision-3',
}) {
  const ownerTurnEnvelope = { witnessed: true, identity: principalId, turn: label };
  const ownerTurnHash = hash(ownerTurnEnvelope);
  const actionDescriptor = expectedNormalizedActionDescriptor();
  const actionDescriptorHash = sha256(canonicalJson(actionDescriptor));
  const decisionPayload = {
    decision_id: decisionId,
    intent_id: intentId,
    principal_id: principalId,
    owner_turn_hash: ownerTurnHash,
    action_class: 'external',
    action_descriptor: actionDescriptor,
    action_descriptor_hash: actionDescriptorHash,
    requested_max_uses: 1,
  };
  const decisionContentHash = sha256(canonicalJson(decisionContent(decisionPayload)));
  return {
    run_id: runId,
    current_intent_id: intentId,
    decisions: [{
      decision_id: decisionId,
      principal_id: principalId,
      intent_id: intentId,
      action_descriptor: actionDescriptor,
      action_descriptor_hash: actionDescriptorHash,
      decision_content_hash: decisionContentHash,
      action_class: 'external',
      status: 'active',
    }],
  };
}

const acceptanceContract = {
  schema_version: 2,
  contract_id: 'p37-installed-dogfood-acceptance',
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

function makeRuntime(runId, modeOverride) {
  return createP37Runtime(root, {
    actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
    acceptanceContract,
    runId,
    modeOverride,
  });
}

function installedBindingFor(runtime) {
  const { durableBinding, serviceBindings, kernelBinding, hash } = runtime;
  const bindings = {
    kernel: {
      role: 'kernel',
      identity: kernelBinding.identity,
      uid: kernelBinding.uid,
      gid: kernelBinding.gid,
      attestation_hash: kernelBinding.attestation_hash,
      cgroup_binding_hash: kernelBinding.cgroup_binding_hash,
    },
  };
  for (const [role, service] of Object.entries(serviceBindings)) {
    bindings[role] = {
      role,
      identity: service.identity,
      uid: service.uid,
      gid: service.gid,
      attestation_hash: service.attestation_hash,
      cgroup_binding_hash: service.cgroup_binding_hash,
    };
  }
  return installedContract.normalizeInstalledBinding({
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
  });
}

function hostResponse(message, response, hash) {
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

function buildHosts(runtime, profile, hash) {
  const NOW = new Date(runtime.NOW).toISOString();
  const authorizations = new Map();
  const consumed = new Set();
  const sinkCalls = [];
  let executedClaimId = null;
  let engineObservation = null;
  let lastDogfoodDelivery = null;
  // Active delivered manifest is bound only from real execute sink output.
  let activeDeliveredManifest = null;
  function requireActiveManifest() {
    if (!activeDeliveredManifest) {
      throw new Error('delivered manifest not yet bound from execute_engine_dispatch');
    }
    return activeDeliveredManifest;
  }
  function activeManifestHash() {
    return hash(requireActiveManifest());
  }
  const auditHead = hash(`audit:${runtime.routeInputs.runBinding.cohort_id}`);
  const coordinatorBinding = {
    identity: profile.engine_profile.route.coordinator_binding.identity,
    trust_tier: 'external',
    attestation_hash: profile.engine_profile.route.coordinator_binding.attestation_hash,
    protocol_version: 2,
  };
  const coordinatorBindingHash = hash(coordinatorBinding);
  const coordinatorAttempts = new Map();

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
    if (message.operation.startsWith('capability:')) {
      return hostResponse(message, capabilityResponse(message), hash);
    }
    if (message.operation === 'execute_engine_dispatch') {
      const authorization = request.execution_authorization;
      if (!authorization
        || authorizations.get(authorization.authorization_id) !== authorization.authorization
        || consumed.has(authorization.authorization_id)) {
        throw new Error('engine execution authorization replay or substitution');
      }
      assert.deepEqual(request.action, profile.action);
      consumed.add(authorization.authorization_id);
      executedClaimId = request.claim_id;
      sinkCalls.push(request.claim_id);
      // Real bounded sink mutation in an isolated temporary git repository —
      // not an unconditional committed stub. The fixed sink is the installed
      // engine route (execute_engine_dispatch); AutopilotEngine.implementTask
      // is exercised with a dispatcher that returns the real commit receipt.
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'p37-dogfood-'));
      const workRepo = path.join(temporary, 'sink-repo');
      fs.mkdirSync(workRepo, { recursive: true });
      const git = (args) => {
        const run = require('child_process').spawnSync('git', args, {
          cwd: workRepo,
          encoding: 'utf8',
        });
        if (run.error || run.status !== 0) {
          throw new Error(`dogfood sink git ${args.join(' ')} failed: ${run.stderr || run.error}`);
        }
        return (run.stdout || '').trim();
      };
      git(['init']);
      git(['config', 'user.email', 'dogfood@autopilot.local']);
      git(['config', 'user.name', 'p37-dogfood']);
      const deliveredRel = 'delivered/implement-unit.md';
      const deliveredAbs = path.join(workRepo, deliveredRel);
      fs.mkdirSync(path.dirname(deliveredAbs), { recursive: true });
      const deliveredBody = `Low-risk installed dogfood unit\nclaim=${request.claim_id}\n`;
      fs.writeFileSync(deliveredAbs, deliveredBody);
      git(['add', deliveredRel]);
      git(['commit', '-m', `dogfood fixed-sink ${request.claim_id}`]);
      const commitSha = git(['rev-parse', 'HEAD']);
      const deliveredBytes = fs.readFileSync(deliveredAbs);
      const deliveredSha = hash(deliveredBytes.toString('utf8'));
      assert.notEqual(commitSha, 'd'.repeat(40), 'must not use stub commit hash');
      assert.equal(fs.existsSync(deliveredAbs), true, 'dogfood delivered artifact must exist');
      const show = require('child_process').spawnSync(
        'git',
        ['show', '--name-only', '--pretty=format:', commitSha],
        { cwd: workRepo, encoding: 'utf8' },
      );
      assert.equal(show.status, 0);
      assert.match(show.stdout || '', /delivered\/implement-unit\.md/);
      const blob = require('child_process').spawnSync(
        'git',
        ['show', `${commitSha}:${deliveredRel}`],
        { cwd: workRepo, encoding: 'utf8' },
      );
      assert.equal(blob.status, 0);
      assert.equal(blob.stdout, deliveredBody);
      const baseSha = 'b'.repeat(40);
      const promptFile = path.join(temporary, 'implement.md');
      fs.writeFileSync(promptFile, 'Low-risk installed dogfood unit.\n');
      const implementationEngine = new baseEngine.AutopilotEngine({
        cwd: workRepo,
        implementationDispatcher() {
          // Dispatcher returns the real commit/receipt from the isolated sink.
          return {
            error: null,
            status: 0,
            signal: null,
            stdout: '',
            stderr: '',
            parseError: null,
            result: {
              status: 'committed',
              runner: 'p37-dogfood-runner',
              model: 'p37-dogfood-model',
              branch: 'feat/p37-dogfood',
              base: baseSha,
              commit: commitSha,
              files_changed: 1,
              insertions: deliveredBody.split('\n').length,
              deletions: 0,
              worktree: null,
              agent_log: path.join(temporary, 'agent.log'),
              error: null,
            },
          };
        },
      });
      const engineResult = implementationEngine.implementTask({
        promptFile,
        branch: 'feat/p37-dogfood',
        base: baseSha,
        cwd: workRepo,
        roster: {
          implementer_runner: 'p37-dogfood-runner',
          implementer_engine: 'p37-dogfood-model',
          implementer_effort: 'low',
        },
      });
      const deliveredCommit = engineResult
        && engineResult.implementation
        && engineResult.implementation.commit;
      assert.equal(engineResult.status, 'committed');
      assert.equal(deliveredCommit, commitSha, 'engine result must bind the real sink commit');
      lastDogfoodDelivery = {
        commit: commitSha,
        artifact_path: deliveredRel,
        artifact_sha256: deliveredSha,
        work_repo: workRepo,
      };
      engineObservation = engineResult.status;
      const effectId = `dogfood-effect-${request.claim_id}`;
      const receiptSha = hash({
        effect_id: effectId,
        result: engineResult,
        delivered_commit: commitSha,
        delivered_artifact_sha256: deliveredSha,
      });
      // Full commitment → acceptance_set binds content digests + commitment_hash
      // into the coordinator candidate/delivered set.
      const normalizedManifest = installedEngine.normalizeDispatchDeliveredManifest({
        commit: commitSha,
        artifacts: [{
          id: 'workspace',
          path: deliveredRel,
          sha256: deliveredSha,
          bytes: deliveredBytes.length,
        }],
        receipt_sha256: receiptSha,
        boundary_effect_id: effectId,
      });
      activeDeliveredManifest = normalizedManifest.acceptance_set;
      // delivered_manifest is stripped by installed-engine before Kernel schema.
      return hostResponse(message, {
        receipt: {
          uri: `file://${profile.engine_profile.receipt_root}/${effectId}.json`,
          sha256: receiptSha,
        },
        broker: {
          identity: runtime.serviceBindings.broker.identity,
          broker_uid: runtime.serviceBindings.broker.uid,
        },
        execution_permit_hash: request.execution_permit_hash,
        execution_authorization_hash: request.execution_authorization_hash,
        authorization_id: authorization.authorization_id,
        claim_event_hash: request.claim_event_hash,
        claim_witness_head: request.claim_witness_head,
        permit_state: 'consumed',
        boundary_effect_id: effectId,
        boundary_state_version: 1,
        boundary_attestation_hash: runtime.serviceBindings.broker.attestation_hash,
        effect_at: NOW,
        delivered_manifest: {
          commit: commitSha,
          artifacts: [{
            id: 'workspace',
            path: deliveredRel,
            sha256: deliveredSha,
            bytes: deliveredBytes.length,
          }],
          receipt_sha256: receiptSha,
          boundary_effect_id: effectId,
        },
      }, hash);
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
      }, hash);
    }
    throw new Error(`unexpected engine op ${message.operation}`);
  }

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
  function coordinatorInvoke(message) {
    const request = message.request;
    if (message.operation === 'coordinator_acquire') {
      const normalized = {
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        intent_id: request.expected_intent_id,
        transaction_id: `txn-${request.attempt_id}`,
        fence: hash(`fence:${request.attempt_id}`),
        candidate_artifacts: requireActiveManifest(),
        delivered_artifacts: requireActiveManifest(),
        candidate_set_hash: activeManifestHash(),
        delivered_set_hash: activeManifestHash(),
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
      return hostResponse(message, snapshot, hash);
    }
    if (message.operation === 'coordinator_prepare_commit') {
      return hostResponse(message, {
        disposition: 'prepared',
        coordinator_commitment: makeCommitment(request),
      }, hash);
    }
    if (message.operation === 'coordinator_record_commit') {
      const attempt = coordinatorAttempts.get(request.attempt_id);
      attempt.status = 'accepted';
      attempt.response = request;
      return hostResponse(message, { recorded: true }, hash);
    }
    if (message.operation === 'coordinator_verify_commit') {
      return hostResponse(message, { verified: true }, hash);
    }
    if (message.operation === 'coordinator_release') {
      return hostResponse(message, { ok: true, disposition: 'released' }, hash);
    }
    if (message.operation === 'coordinator_request_abort') {
      return hostResponse(message, {
        ok: true,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: 'queued',
      }, hash);
    }
    if (message.operation === 'coordinator_resolve') {
      const attempt = coordinatorAttempts.get(request.attempt_id);
      if (attempt && attempt.status === 'accepted') {
        return hostResponse(message, attempt.response, hash);
      }
      return hostResponse(message, {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        transaction_id: request.transaction_id,
        fence: request.fence,
        disposition: 'released',
      }, hash);
    }
    if (message.operation === 'coordinator_verify_resolution') {
      return hostResponse(message, { verified: false }, hash);
    }
    if (message.operation === 'coordinator_cancel') {
      return hostResponse(message, { ok: true, disposition: 'cancelled' }, hash);
    }
    throw new Error(`unexpected coordinator op ${message.operation}`);
  }

  const adapters = {
    ...runtime.adapters(),
    evidenceArchiver({ verified_evidence }) {
      return {
        uri: `durable://p37-dogfood/${hash(verified_evidence)}`,
        sha256: hash(verified_evidence),
      };
    },
    verificationVerifier(_request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'runner-a',
        channel: 'p37-dogfood-runner',
        envelope_hash: hash('p37-dogfood-verification'),
        payload: {
          emitter_kind: 'runner',
          verification_path: 'trusted_runner',
          attestation_sha256: hash('attestation:runner-a'),
          verification_id: 'p37-dogfood-verification',
          intent_id: context.intent_id,
          leg_id: 'tests',
          outcome: 'green',
          command_hash: hash('node --test'),
          candidate_artifacts: requireActiveManifest(),
          candidate_set_hash: activeManifestHash(),
          exit_code: 0,
          stdout_hash: hash('dogfood-stdout'),
          stderr_hash: hash('dogfood-stderr'),
          executed_at: NOW,
        },
      };
    },
    challengeVerifier(envelope, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'challenger-a',
        channel: 'p37-dogfood-challenge',
        envelope_hash: hash({ challenge: envelope.scope_id }),
        payload: {
          verification_path: 'qualified_challenge',
          attestation_sha256: hash('attestation:challenger-a'),
          challenge_id: `dogfood-challenge-${envelope.scope_id}`,
          intent_id: context.intent_id,
          scope: 'contract_leg',
          scope_id: envelope.scope_id,
          finding: 'clear',
          candidate_artifacts: requireActiveManifest(),
          candidate_set_hash: activeManifestHash(),
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
        channel: 'p37-dogfood-provenance',
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
        channel: 'p37-dogfood-audit',
        envelope_hash: hash('p37-dogfood-audit'),
        payload: {
          verification_path: 'acceptance_audit',
          attestation_sha256: profile.engine_profile.route.coordinator_binding.attestation_hash,
          audit_head: auditHead,
          intent_id: context.intent_id,
          candidate_artifacts: requireActiveManifest(),
          candidate_set_hash: activeManifestHash(),
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

  return {
    engineInvoke,
    coordinatorInvoke,
    adapters,
    sinkCalls,
    getEngineObservation: () => engineObservation,
    getLastDogfoodDelivery: () => lastDogfoodDelivery,
    getActiveDeliveredManifest: () => (activeDeliveredManifest
      ? activeDeliveredManifest.map((item) => ({ ...item }))
      : null),
    getActiveManifestHash: () => (activeDeliveredManifest ? hash(activeDeliveredManifest) : null),
  };
}

async function runHappyPath({ runtime, modeOverride, label }) {
  const binding = installedBindingFor(runtime);
  const NOW = new Date(runtime.NOW).toISOString();
  const EXPIRES = new Date(runtime.NOW + 3600000).toISOString();
  const profile = installedEngine.compileInstalledEngineProfile({
    binding,
    governanceConfig: runtime.governanceConfig,
    acceptanceContract,
    routeInputs: runtime.routeInputs,
    durableBinding: runtime.durableBinding,
    kernelBinding: runtime.kernelBinding,
    modeOverride,
    capabilityProbedAt: NOW,
    capabilityExpiresAt: EXPIRES,
  });
  const expectedDisclosure = expectedDisclosureFromFixtures({
    runId: profile.engine_profile.route.run_id,
    label,
    hash: runtime.hash,
  });
  const hosts = buildHosts(runtime, profile, runtime.hash);
  const witnessInvoke = runtime.createWitnessInvoke();
  const session = installedEngine.createInstalledEngineSession({
    profile,
    binding,
    durableBinding: runtime.durableBinding,
    governanceConfig: runtime.governanceConfig,
    acceptanceContract,
    routeInputs: runtime.routeInputs,
    modeOverride,
    witnessInvoke,
    engineInvoke: hosts.engineInvoke,
    coordinatorInvoke: hosts.coordinatorInvoke,
    requestIdFactory: ({ label: part, counter }) => `${label}-${part}-${counter}`,
    kernelOptions: {
      modeOverride,
      initialIntentEnvelope: {
        signed: true,
        payload: {
          text: `Low-risk dogfood ${label}`,
          explicit_action_hashes: [],
        },
      },
      initialOwnerId: 'owner-a',
      adapters: hosts.adapters,
      clock: () => new Date(runtime.NOW),
      nonceFactory: () => runtime.hash(`nonce:${label}`).slice(0, 64),
    },
  });
  assert.equal(session.sink_id, 'engine-implementation-dispatch-v1');
  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: label },
    actionClass: 'external',
    actionDescriptor: profile.action,
  });
  assert.equal(decision.payload.decision_id, expectedDisclosure.decisions[0].decision_id);
  assert.equal(decision.payload.intent_id, expectedDisclosure.current_intent_id);
  session.kernel.submitApproval({
    signed: true,
    payload: {
      decision_id: expectedDisclosure.decisions[0].decision_id,
      decision_content_hash: expectedDisclosure.decisions[0].decision_content_hash,
      max_uses: 1,
    },
  });
  await session.kernel.executeAuthorizedAction({
    decisionId: expectedDisclosure.decisions[0].decision_id,
    action: profile.action,
    timeoutMilliseconds: 1000,
  });
  assert.equal(hosts.sinkCalls.length, 1);
  assert.equal(hosts.getEngineObservation(), 'committed');
  assert.equal(session.engineTerminalIsAcceptance('committed'), false);
  const delivery = hosts.getLastDogfoodDelivery();
  assert.ok(delivery && delivery.commit, 'fixed sink must return real delivery receipt');
  assert.notEqual(delivery.commit, 'd'.repeat(40), 'delivery commit must not be stub');
  assert.equal(typeof delivery.artifact_sha256, 'string');
  assert.match(delivery.artifact_path, /delivered\/implement-unit\.md/);
  assert.equal(
    fs.existsSync(path.join(delivery.work_repo, delivery.artifact_path)),
    true,
    'delivered artifact bytes must exist in isolated sink repo',
  );
  session.kernel.recordVerification({ purpose: 'tests' });
  session.kernel.recordChallenge({ scope_id: 'tests' });
  session.kernel.recordChallenge({ scope_id: 'ux' });
  session.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const accepted = await session.kernel.accept({
    capability: session.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(accepted.accepted, true);
  const realManifestHash = hosts.getActiveManifestHash();
  assert.equal(typeof realManifestHash, 'string');
  const disclosure = session.disclosure();
  assert.deepEqual(disclosure, expectedDisclosure);
  const ledger = session.kernel.getLedger();
  assert.deepEqual(ledger.events.slice(-2).map((event) => event.type), ['acceptance', 'complete']);
  const acceptanceEvent = ledger.events.find((event) => event.type === 'acceptance');
  assert.ok(acceptanceEvent && acceptanceEvent.payload);
  assert.equal(
    acceptanceEvent.payload.delivered_set_hash,
    realManifestHash,
    'acceptance delivered_set_hash must bind the real dispatch artifact set',
  );
  assert.equal(
    acceptanceEvent.payload.candidate_set_hash,
    realManifestHash,
    'acceptance candidate_set_hash must bind the real dispatch artifact set',
  );
  const dispatchManifest = session.getDispatchDeliveredManifest();
  assert.ok(dispatchManifest, 'session must expose dispatch delivered-manifest commitment');
  assert.equal(dispatchManifest.acceptance_set_hash, realManifestHash);
  assert.equal(dispatchManifest.commit, delivery.commit);
  assert.equal(dispatchManifest.artifacts[0].sha256, delivery.artifact_sha256);
  assert.equal(
    dispatchManifest.acceptance_set[0].id,
    'workspace',
  );
  assert.notEqual(
    dispatchManifest.acceptance_set[0].sha256,
    delivery.artifact_sha256,
    'acceptance-bound digest must include commitment_hash (not raw content alone)',
  );
  const priorIdentity = session.getActionIdentity();
  // Resume/replay carries the same dispatch commitment on prior identity.
  priorIdentity.delivered_manifest = dispatchManifest;
  const resumed = installedEngine.resumeInstalledEngineSession({
    profile,
    binding,
    durableBinding: runtime.durableBinding,
    governanceConfig: runtime.governanceConfig,
    acceptanceContract,
    routeInputs: runtime.routeInputs,
    modeOverride,
    ledger,
    priorActionIdentity: priorIdentity,
    witnessInvoke,
    engineInvoke: hosts.engineInvoke,
    coordinatorInvoke: hosts.coordinatorInvoke,
    kernelOptions: {
      adapters: hosts.adapters,
      clock: () => new Date(runtime.NOW),
      nonceFactory: () => runtime.hash(`resume-nonce:${label}`).slice(0, 64),
    },
  });
  assert.equal(resumed.getActionIdentity().decision_id, priorIdentity.decision_id);
  assert.equal(resumed.getActionIdentity().status, 'accepted');
  assert.equal(resumed.kernel.getState().terminal_reason, 'accepted');
  assert.equal(hosts.sinkCalls.length, 1);
  const resumedDisclosure = resumed.disclosure();
  assert.deepEqual(resumedDisclosure, expectedDisclosure);
  session.teardown();
  resumed.teardown();
  return {
    label,
    mode: modeOverride || runtime.governanceConfig.governance.default_mode,
    sink_calls: hosts.sinkCalls.length,
    disclosure: expectedDisclosure,
    accepted: true,
  };
}

(async () => {
  const defaultRuntime = makeRuntime('p37-dogfood-default');
  const defaultResult = await runHappyPath({
    runtime: defaultRuntime,
    label: 'project-default',
  });
  assert.equal(defaultResult.mode, 'owner-led');

  const overrideRuntime = makeRuntime('p37-dogfood-override', 'milestone-led');
  const overrideResult = await runHappyPath({
    runtime: overrideRuntime,
    modeOverride: 'milestone-led',
    label: 'one-run-override',
  });
  assert.equal(overrideResult.mode, 'milestone-led');

  const conservativePolicy = baseEngine.resolveGovernancePolicy(
    defaultRuntime.governanceConfig,
    { modeOverride: 'owner-led' },
  );
  assert.ok(conservativePolicy.policy_hash);
  assert.equal(
    Array.isArray(conservativePolicy.policy.action_catalog)
      && conservativePolicy.policy.action_catalog.length,
    1,
  );

  const abortRuntime = makeRuntime('p37-dogfood-abort');
  const abortBinding = installedBindingFor(abortRuntime);
  const abortNow = new Date(abortRuntime.NOW).toISOString();
  const abortExpires = new Date(abortRuntime.NOW + 3600000).toISOString();
  const abortProfile = installedEngine.compileInstalledEngineProfile({
    binding: abortBinding,
    governanceConfig: abortRuntime.governanceConfig,
    acceptanceContract,
    routeInputs: abortRuntime.routeInputs,
    durableBinding: abortRuntime.durableBinding,
    kernelBinding: abortRuntime.kernelBinding,
    capabilityProbedAt: abortNow,
    capabilityExpiresAt: abortExpires,
  });
  function abortCapabilityInvoke(message) {
    if (message.operation && message.operation.startsWith('capability:')) {
      const request = message.request;
      const response = {
        ok: true,
        run_id: request.run_id,
        host_capability_hash: request.host_capability_hash,
        observation_hash: abortRuntime.hash({ operation: message.operation, request }),
        probe_nonce: request.probe_nonce,
      };
      return hostResponse(message, response, abortRuntime.hash);
    }
    throw new Error('dogfood abort path must not redispatch');
  }
  const expectedAbortDisclosure = expectedDisclosureFromFixtures({
    runId: abortProfile.engine_profile.route.run_id,
    label: 'abort',
    hash: abortRuntime.hash,
  });
  const abortWitnessInvoke = abortRuntime.createWitnessInvoke();
  const abortSession = installedEngine.createInstalledEngineSession({
    profile: abortProfile,
    binding: abortBinding,
    durableBinding: abortRuntime.durableBinding,
    governanceConfig: abortRuntime.governanceConfig,
    acceptanceContract,
    routeInputs: abortRuntime.routeInputs,
    witnessInvoke: abortWitnessInvoke,
    engineInvoke: abortCapabilityInvoke,
    coordinatorInvoke: () => {
      throw new Error('dogfood abort path must not accept');
    },
    kernelOptions: {
      initialIntentEnvelope: {
        signed: true,
        payload: { text: 'Abort recovery dogfood', explicit_action_hashes: [] },
      },
      initialOwnerId: 'owner-a',
      adapters: abortRuntime.adapters(),
      clock: () => new Date(abortRuntime.NOW),
      nonceFactory: () => 'b'.repeat(64),
    },
  });
  const abortDecision = abortSession.kernel.mintActionDecision({
    capability: abortSession.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'abort' },
    actionClass: 'external',
    actionDescriptor: abortProfile.action,
  });
  assert.equal(abortDecision.payload.decision_id, expectedAbortDisclosure.decisions[0].decision_id);
  const aborted = abortSession.abortAction('dogfood_operator_abort');
  assert.equal(aborted.decision_id, expectedAbortDisclosure.decisions[0].decision_id);
  assert.equal(aborted.status, 'aborted');
  assert.equal(abortSession.kernel.getState().terminal_reason, 'user_abort');
  assert.deepEqual(abortSession.disclosure(), expectedAbortDisclosure);
  const persistedAbort = abortSession.getPersistedAbort();
  assert.ok(persistedAbort && persistedAbort.abort_hash);
  const abortLedger = abortSession.kernel.getLedger();
  assert.ok(abortLedger.events.some((event) => event.type === 'abort'));
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
    engineInvoke: abortCapabilityInvoke,
    coordinatorInvoke: () => {
      throw new Error('dogfood abort resume must not accept');
    },
    kernelOptions: {
      adapters: abortRuntime.adapters(),
      clock: () => new Date(abortRuntime.NOW),
      nonceFactory: () => 'c'.repeat(64),
    },
  });
  assert.equal(abortResumed.getActionIdentity().status, 'aborted');
  assert.equal(
    abortResumed.getActionIdentity().decision_id,
    expectedAbortDisclosure.decisions[0].decision_id,
  );
  assert.deepEqual(abortResumed.disclosure(), expectedAbortDisclosure);
  await assert.rejects(
    () => abortResumed.kernel.executeAuthorizedAction({
      decisionId: expectedAbortDisclosure.decisions[0].decision_id,
      action: abortProfile.action,
      timeoutMilliseconds: 1000,
    }),
    /redispatch|aborted|ENGINE_REDISPATCH_FORBIDDEN|terminal|uses|permit|authorization/i,
  );
  abortSession.teardown();
  abortResumed.teardown();

  assert.throws(
    () => installedEngine.rejectForeignEngineSink('review-dispatch'),
    /reject|ENGINE_SINK/,
  );
  assert.throws(
    () => installedEngine.rejectForeignEngineSink('implementation-dispatch'),
    /reject|ENGINE_SINK/,
  );

  console.log(JSON.stringify({
    dogfood: 'ok',
    project_default: defaultResult.mode,
    one_run_override: overrideResult.mode,
    session_replacement: 'resume_preserved_action_identity',
    conservative_policy: 'kernel_only_no_legacy_bypass',
    abort_recovery: 'action_identity_preserved_without_redispatch',
    exact_disclosure: defaultResult.disclosure,
    fixed_engine_sink: 'engine-implementation-dispatch-v1',
    external_mutation: 'none',
  }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "installed low-risk dogfood process exits cleanly"
assert_contains "$OUT" '"dogfood":"ok"' "low-risk installed dogfood completed"
assert_contains "$OUT" '"project_default":"owner-led"' "project default governance is exercised"
assert_contains "$OUT" '"one_run_override":"milestone-led"' "one-run override is exercised"
assert_contains "$OUT" '"session_replacement":"resume_preserved_action_identity"' "session replacement preserves action identity"
assert_contains "$OUT" '"conservative_policy":"kernel_only_no_legacy_bypass"' "conservative policy stays on Kernel authority"
assert_contains "$OUT" '"abort_recovery":"action_identity_preserved_without_redispatch"' "abort/recovery resumes without redispatch"
assert_contains "$OUT" '"run_id"' "exact final disclosure includes run_id"
assert_contains "$OUT" '"decisions"' "exact final disclosure includes decisions structure"
assert_contains "$OUT" '"fixed_engine_sink":"engine-implementation-dispatch-v1"' "fixed Engine sink only"
assert_contains "$OUT" '"external_mutation":"none"' "no external publish/push/deploy mutation"

finalize_test
