#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# U6 production corpus against the installed Engine route.
# Executes one scenario-specific installed route mutation for each of the 8
# attacks and 15 baseline categories before emitting markers. Static successful
# marker printing is not evidence.

GATE_DIR="$TEST_TMP/p37-installed-corpus-gates"
mkdir -p "$GATE_DIR"

run_gate() {
  local id="$1"
  local script="$2"
  local output
  output="$(AUTOPILOT_CORPUS_EVIDENCE=1 bash "$REPO_ROOT/hooks/tests/$script" 2>&1)"
  local status=$?
  printf '%s' "$output" >"$GATE_DIR/$id.out"
  assert_eq "0" "$status" "U6 installed corpus prerequisite $id exits cleanly"
}

run_gate installed supervised-owner-kernel-installed-engine.test.sh
run_gate semantic supervised-owner-kernel-semantic-witness.test.sh
run_gate probe supervised-owner-kernel-probe-effect.test.sh
run_gate core owner-kernel.test.sh
run_gate adversarial owner-kernel-adversarial.test.sh
run_gate acceptance owner-kernel-acceptance.test.sh
run_gate action owner-action-hardening.test.sh
run_gate reconciliation owner-action-reconciliation.test.sh

OUT="$(node - "$REPO_ROOT" "$GATE_DIR" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const gateDir = process.argv[3];
const { canonicalJson, sha256, OwnerKernelError } = require(path.join(
  root,
  'src',
  'engine',
  'owner-kernel',
));
const baseline = JSON.parse(fs.readFileSync(path.join(
  root,
  'docs',
  'projects',
  '2026-07-20-owner-kernel-governance',
  'p0',
  'fixtures',
  'baseline-fixtures.json',
), 'utf8'));
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

const gates = {
  installed: {
    marker: 'PASS [supervised-owner-kernel-installed-engine]',
    output: fs.readFileSync(path.join(gateDir, 'installed.out'), 'utf8'),
  },
  semantic: {
    marker: 'PASS [supervised-owner-kernel-semantic-witness]',
    output: fs.readFileSync(path.join(gateDir, 'semantic.out'), 'utf8'),
  },
  probe: {
    marker: 'PASS [supervised-owner-kernel-probe-effect]',
    output: fs.readFileSync(path.join(gateDir, 'probe.out'), 'utf8'),
  },
  core: {
    marker: 'PASS [owner-kernel]',
    output: fs.readFileSync(path.join(gateDir, 'core.out'), 'utf8'),
  },
  adversarial: {
    marker: 'PASS [owner-kernel-adversarial]',
    output: fs.readFileSync(path.join(gateDir, 'adversarial.out'), 'utf8'),
  },
  acceptance: {
    marker: 'PASS [owner-kernel-acceptance]',
    output: fs.readFileSync(path.join(gateDir, 'acceptance.out'), 'utf8'),
  },
  action: {
    marker: 'PASS [owner-action-hardening]',
    output: fs.readFileSync(path.join(gateDir, 'action.out'), 'utf8'),
  },
  reconciliation: {
    marker: 'PASS [owner-action-reconciliation]',
    output: fs.readFileSync(path.join(gateDir, 'reconciliation.out'), 'utf8'),
  },
};

for (const [id, gate] of Object.entries(gates)) {
  assert.ok(gate.output.includes(gate.marker), `${id} gate output lacks its canonical PASS marker`);
}

assert.ok(
  gates.installed.output.includes('"sink_id":"engine-implementation-dispatch-v1"'),
  'installed gate must freeze the single Engine sink',
);
assert.ok(
  gates.installed.output.includes('"terminal_batch":"atomic"'),
  'installed gate must prove atomic acceptance+complete',
);

const acceptanceContract = {
  schema_version: 2,
  contract_id: 'p37-installed-corpus-acceptance',
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

function installedFixture(runId, {
  contract = acceptanceContract,
  capabilityTtlMs = 3600000,
} = {}) {
  const runtime = createP37Runtime(root, {
    actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
    acceptanceContract: contract,
    runId,
  });
  const { durableBinding, serviceBindings, kernelBinding, hash } = runtime;
  const bindings = {};
  for (const role of installedContract.SERVICE_ROLES) {
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
  const installedBinding = installedContract.normalizeInstalledBinding({
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
  const now = new Date(runtime.NOW).toISOString();
  const expires = new Date(runtime.NOW + capabilityTtlMs).toISOString();
  const profile = installedEngine.compileInstalledEngineProfile({
    binding: installedBinding,
    governanceConfig: runtime.governanceConfig,
    acceptanceContract: contract,
    routeInputs: runtime.routeInputs,
    durableBinding,
    kernelBinding,
    capabilityProbedAt: now,
    capabilityExpiresAt: expires,
  });
  return {
    runtime,
    installedBinding,
    durableBinding,
    kernelBinding,
    profile,
    now,
    expires,
    hash,
    acceptanceContract: contract,
  };
}

function held(fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => false,
        (error) => {
          assert.ok(
            error instanceof OwnerKernelError || error instanceof Error,
            'mutation must throw an Error',
          );
          return true;
        },
      );
    }
    return false;
  } catch (error) {
    assert.ok(
      error instanceof OwnerKernelError || error instanceof Error,
      'mutation must throw an Error',
    );
    return true;
  }
}

/**
 * Exact named rejection path — not any exception. Requires error.code (and
 * optional message pattern). Returns true only on the named path.
 */
function heldNamed(fn, { code, messagePattern = null, label = 'mutation' } = {}) {
  assert.ok(typeof code === 'string' && code.length > 0, `${label} requires exact error code`);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => {
          assert.fail(`${label} expected exact rejection ${code} but resolved`);
        },
        (error) => {
          assert.equal(
            error && error.code,
            code,
            `${label} must reject via exact code ${code}; got ${error && error.code}: ${error && error.message}`,
          );
          if (messagePattern) {
            assert.match(
              String(error.message || ''),
              messagePattern,
              `${label} message must match ${messagePattern}`,
            );
          }
          return true;
        },
      );
    }
    assert.fail(`${label} expected exact rejection ${code} but returned`);
    return false;
  } catch (error) {
    assert.equal(
      error && error.code,
      code,
      `${label} must reject via exact code ${code}; got ${error && error.code}: ${error && error.message}`,
    );
    if (messagePattern) {
      assert.match(
        String(error.message || ''),
        messagePattern,
        `${label} message must match ${messagePattern}`,
      );
    }
    return true;
  }
}

function capabilityOnlyInvoke(fx) {
  return function capInvoke(message) {
    if (message.operation && message.operation.startsWith('capability:')) {
      const request = message.request;
      const response = {
        ok: true,
        run_id: request.run_id,
        host_capability_hash: request.host_capability_hash,
        observation_hash: fx.hash({ operation: message.operation, request }),
        probe_nonce: request.probe_nonce,
      };
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: fx.hash(response),
      };
    }
    throw new Error(`unexpected engine op ${message.operation}`);
  };
}

function openInstalledSession(fx, {
  runLabel,
  engineInvoke,
  coordinatorInvoke,
  adapters,
  nonce = 'c'.repeat(64),
  clock = null,
  acceptanceContract: sessionContract = null,
} = {}) {
  const contract = sessionContract || fx.acceptanceContract || acceptanceContract;
  const witnessInvoke = fx.runtime.createWitnessInvoke();
  const session = installedEngine.createInstalledEngineSession({
    profile: fx.profile,
    binding: fx.installedBinding,
    durableBinding: fx.durableBinding,
    governanceConfig: fx.runtime.governanceConfig,
    acceptanceContract: contract,
    routeInputs: fx.runtime.routeInputs,
    verifiedHandoff: fx.runtime.routeInputs.verifiedHandoff,
    substratePlan: fx.runtime.routeInputs.substratePlan,
    runBinding: fx.runtime.routeInputs.runBinding,
    witnessInvoke,
    engineInvoke: engineInvoke || capabilityOnlyInvoke(fx),
    coordinatorInvoke: coordinatorInvoke || (() => {
      throw new Error(`${runLabel} must not accept`);
    }),
    kernelOptions: {
      initialIntentEnvelope: {
        signed: true,
        payload: { text: `Corpus ${runLabel}`, explicit_action_hashes: [] },
      },
      initialOwnerId: 'owner-a',
      adapters: adapters || fx.runtime.adapters(),
      clock: clock || (() => new Date(fx.runtime.NOW)),
      nonceFactory: () => nonce,
    },
  });
  return { session, witnessInvoke };
}

/** Shared harness for dispatch+accept category oracles. */
function createAcceptanceHarness(fx, {
  contentLabel,
  executableLegId = 'tests',
  command = 'node --test',
} = {}) {
  const contentSha = fx.hash(contentLabel);
  // Placeholder until bindDispatchManifest() rebinds to the session's full
  // commitment acceptance_set after execute.
  let deliveredManifest = [{ id: 'workspace', sha256: contentSha }];
  let manifestHash = fx.hash(deliveredManifest);
  const auditHead = fx.hash(`corpus-audit-head:${contentLabel}`);
  const authorizations = new Map();
  let executedClaimId = null;

  function bindDispatchManifest(session) {
    const dispatchManifest = session.getDispatchDeliveredManifest
      && session.getDispatchDeliveredManifest();
    assert.ok(
      dispatchManifest && Array.isArray(dispatchManifest.acceptance_set),
      'dispatch must produce acceptance_set for category oracle',
    );
    deliveredManifest = dispatchManifest.acceptance_set;
    manifestHash = dispatchManifest.acceptance_set_hash;
    return dispatchManifest;
  }

  function engineInvoke(message) {
    const request = message.request;
    if (message.operation && message.operation.startsWith('capability:')) {
      const response = {
        ok: true,
        run_id: request.run_id,
        host_capability_hash: request.host_capability_hash,
        observation_hash: fx.hash({ operation: message.operation, request }),
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
          expires_at: new Date(fx.runtime.NOW + 120000).toISOString(),
          attestation_hash: fx.hash(`permit:${request.claim_id}`),
          issuer: fx.profile.engine_profile.route.kernel_binding.identity,
          issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
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
          issued_at: fx.now,
          expires_at: new Date(fx.runtime.NOW + 60000).toISOString(),
          attestation_hash: fx.hash(`authorization:${request.claim_id}`),
          issuer: fx.profile.engine_profile.route.kernel_binding.identity,
          issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
          authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
        };
        authorizations.set(authorization.authorization_id, authorization.authorization);
        response.execution_authorization = authorization;
      }
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: fx.hash(response),
      };
    }
    if (message.operation === 'execute_engine_dispatch') {
      const authorization = request.execution_authorization;
      if (!authorization
        || authorizations.get(authorization.authorization_id) !== authorization.authorization) {
        throw new Error('mediated execute authorization missing');
      }
      executedClaimId = request.claim_id;
      const effectId = `corpus-effect-${request.claim_id}`;
      const commitSha = 'a'.repeat(40);
      const receiptSha = fx.hash({ effect_id: effectId, commit: commitSha, content: contentSha });
      const response = {
        receipt: {
          uri: `file://${fx.profile.engine_profile.receipt_root}/${effectId}.json`,
          sha256: receiptSha,
        },
        broker: {
          identity: fx.runtime.serviceBindings.broker.identity,
          broker_uid: fx.runtime.serviceBindings.broker.uid,
        },
        execution_permit_hash: request.execution_permit_hash,
        execution_authorization_hash: request.execution_authorization_hash,
        authorization_id: authorization.authorization_id,
        claim_event_hash: request.claim_event_hash,
        claim_witness_head: request.claim_witness_head,
        permit_state: 'consumed',
        boundary_effect_id: effectId,
        boundary_state_version: 1,
        boundary_attestation_hash: fx.runtime.serviceBindings.broker.attestation_hash,
        effect_at: fx.now,
        delivered_manifest: {
          commit: commitSha,
          artifacts: [{ id: 'workspace', path: 'workspace.tar', sha256: contentSha }],
          receipt_sha256: receiptSha,
          boundary_effect_id: effectId,
        },
      };
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: fx.hash(response),
      };
    }
    if (message.operation === 'verify_engine_dispatch') {
      const receipt = request.receipt;
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
        permit_state: 'consumed',
        boundary_effect_id: receipt.boundary_effect_id,
        boundary_state_version: receipt.boundary_state_version,
        boundary_attestation_hash: receipt.boundary_attestation_hash,
        effect_at: receipt.effect_at,
        status: 'succeeded',
        receipt: receipt.receipt_ref,
        broker: receipt.broker_receipt,
        observed_action: fx.profile.action,
        error_code: null,
      };
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: fx.hash(response),
      };
    }
    throw new Error(`unexpected engine op ${message.operation}`);
  }

  const adapters = {
    ...fx.runtime.adapters(),
    evidenceArchiver({ verified_evidence }) {
      return {
        uri: `durable://corpus-accept/${fx.hash(verified_evidence)}`,
        sha256: fx.hash(verified_evidence),
      };
    },
    verificationVerifier(_request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'runner-a',
        channel: 'corpus-verification',
        envelope_hash: fx.hash('corpus-verification-envelope'),
        payload: {
          emitter_kind: 'runner',
          verification_path: 'trusted_runner',
          attestation_sha256: fx.hash('attestation:runner-a'),
          verification_id: `corpus-verification-${executableLegId}`,
          intent_id: context.intent_id,
          leg_id: executableLegId,
          outcome: 'green',
          command_hash: fx.hash(command),
          candidate_artifacts: deliveredManifest,
          candidate_set_hash: manifestHash,
          exit_code: 0,
          stdout_hash: fx.hash('corpus-test-stdout'),
          stderr_hash: fx.hash('corpus-test-stderr'),
          executed_at: fx.now,
        },
      };
    },
    challengeVerifier(envelope, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'challenger-a',
        channel: 'corpus-challenge',
        envelope_hash: fx.hash({ challenge: envelope.scope_id }),
        payload: {
          verification_path: 'qualified_challenge',
          attestation_sha256: fx.hash('attestation:challenger-a'),
          challenge_id: `corpus-challenge-${envelope.scope_id}`,
          intent_id: context.intent_id,
          scope: 'contract_leg',
          scope_id: envelope.scope_id,
          finding: 'clear',
          candidate_artifacts: deliveredManifest,
          candidate_set_hash: manifestHash,
          subject_identity: fx.profile.engine_profile.route.worker_binding.identity,
          subject_family: 'qwen',
          result_hash: fx.hash(`challenge-result:${envelope.scope_id}`),
          reviewed_at: fx.now,
        },
      };
    },
    artifactProvenanceVerifier(request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: fx.profile.engine_profile.route.coordinator_binding.identity,
        channel: 'corpus-provenance',
        envelope_hash: fx.hash({ provenance: request }),
        payload: {
          verification_path: 'artifact_provenance',
          attestation_sha256:
            fx.profile.engine_profile.route.coordinator_binding.attestation_hash,
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
        identity: fx.profile.engine_profile.route.coordinator_binding.identity,
        channel: 'corpus-audit',
        envelope_hash: fx.hash('corpus-audit-envelope'),
        payload: {
          verification_path: 'acceptance_audit',
          attestation_sha256:
            fx.profile.engine_profile.route.coordinator_binding.attestation_hash,
          audit_head: auditHead,
          intent_id: context.intent_id,
          candidate_artifacts: deliveredManifest,
          candidate_set_hash: manifestHash,
          complete: true,
          action_claim_ids: executedClaimId ? [executedClaimId] : [],
          action_footprint_hash: context.action_footprint_hash,
          evaluated_event_head: context.evaluated_event_head,
          evaluated_witness_head: context.evaluated_witness_head,
          observed_at: fx.now,
        },
      };
    },
  };

  // Coordinator closes over getters so bindDispatchManifest can rebind the
  // acceptance set after execute without rebuilding the invoke functions.
  const coordinatorInvoke = acceptanceCoordinatorInvoke(fx, {
    getDeliveredManifest: () => deliveredManifest,
    getManifestHash: () => manifestHash,
    auditHead,
  });

  return {
    contentSha,
    auditHead,
    engineInvoke,
    adapters,
    coordinatorInvoke,
    bindDispatchManifest,
    getExecutedClaimId: () => executedClaimId,
    getDeliveredManifest: () => deliveredManifest,
    getManifestHash: () => manifestHash,
  };
}

function acceptanceCoordinatorInvoke(fx, {
  getDeliveredManifest,
  getManifestHash,
  auditHead,
}) {
  const coordinatorAttempts = new Map();
  const routeCoordinator = fx.profile.engine_profile.route.coordinator_binding;
  const coordinatorBinding = {
    identity: routeCoordinator.identity,
    trust_tier: 'external',
    attestation_hash: routeCoordinator.attestation_hash,
    protocol_version: 2,
  };
  const coordinatorBindingHash = fx.hash(coordinatorBinding);
  function hostResponse(message, response) {
    return {
      schema_version: 1,
      kind: 'p37_engine_host_response',
      profile_hash: message.profile_hash,
      route_hash: message.route_hash,
      operation: message.operation,
      request_hash: message.request_hash,
      response,
      response_hash: fx.hash(response),
    };
  }
  function unsigned(value) {
    const { signature: _signature, ...rest } = value;
    return rest;
  }
  function sign(value) {
    return fx.hash({
      profile_hash: fx.profile.engine_profile.profile_hash,
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
      issued_at: fx.now,
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
      canonicalJson(commitment[key]) === canonicalJson(value)
    ));
  }
  return function coordinatorInvoke(message) {
    const request = message.request;
    if (message.operation === 'coordinator_acquire') {
      const deliveredManifest = getDeliveredManifest();
      const manifestHash = getManifestHash();
      // Snapshot body excludes set hashes (derived by normalizeAcceptanceSnapshot);
      // snapshot_hash still commits them so the derived hash matches.
      const normalized = {
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        intent_id: request.expected_intent_id,
        transaction_id: `txn-${request.attempt_id}`,
        fence: fx.hash(`fence:${request.attempt_id}`),
        candidate_artifacts: deliveredManifest,
        delivered_artifacts: deliveredManifest,
        candidate_set_hash: manifestHash,
        delivered_set_hash: manifestHash,
        audit_head: auditHead || fx.hash('corpus-audit-head'),
        control_event_head: request.expected_event_head,
        control_witness_head: request.expected_witness_head,
        snapshot_at: fx.now,
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
        snapshot_hash: fx.hash({ run_id: request.run_id, ...normalized }),
      };
      coordinatorAttempts.set(request.attempt_id, { snapshot, status: 'acquired' });
      return hostResponse(message, snapshot);
    }
    if (message.operation === 'coordinator_prepare_commit') {
      return hostResponse(message, {
        disposition: 'prepared',
        coordinator_commitment: makeCommitment(request),
      });
    }
    if (message.operation === 'coordinator_record_commit') {
      const attempt = coordinatorAttempts.get(request.attempt_id);
      if (attempt) {
        attempt.status = 'accepted';
        attempt.response = request;
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
    function resolutionFor(req, disposition = 'released') {
      const coordinator_resolution = {
        protocol_version: 1,
        run_id: req.run_id,
        coordinator_binding_hash: coordinatorBindingHash,
        attempt_id: req.attempt_id,
        attempt_hash: req.attempt_hash,
        transaction_id: req.transaction_id || null,
        fence: req.fence || null,
        disposition,
        issued_at: fx.now,
        attestation_hash: coordinatorBinding.attestation_hash,
        signature: '',
      };
      coordinator_resolution.signature = fx.hash({
        coordinator: coordinatorBindingHash,
        ...unsigned(coordinator_resolution),
      });
      return coordinator_resolution;
    }
    if (message.operation === 'coordinator_release') {
      const disposition = request.outcome === 'aborted' ? 'aborted' : 'released';
      const coordinator_resolution = resolutionFor(request, disposition);
      return hostResponse(message, {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition,
        coordinator_resolution,
      });
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
      const attempt = coordinatorAttempts.get(request.attempt_id);
      if (attempt && attempt.status === 'accepted') {
        return hostResponse(message, attempt.response);
      }
      const coordinator_resolution = resolutionFor(request, 'released');
      return hostResponse(message, {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        transaction_id: request.transaction_id,
        fence: request.fence,
        disposition: 'released',
        coordinator_resolution,
      });
    }
    if (message.operation === 'coordinator_cancel') {
      const coordinator_resolution = resolutionFor(request, 'cancelled');
      return hostResponse(message, {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: 'cancelled',
        coordinator_resolution,
      });
    }
    if (message.operation === 'coordinator_verify_resolution') {
      return hostResponse(message, {
        verified: Boolean(
          request.coordinator_resolution
          && request.coordinator_resolution.disposition === request.disposition,
        ),
      });
    }
    throw new Error(`unexpected coordinator op ${message.operation}`);
  };
}

async function dispatchAuthorized(fx, session) {
  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'corpus-accept' },
    actionClass: 'external',
    actionDescriptor: fx.profile.action,
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
    action: fx.profile.action,
    timeoutMilliseconds: 1000,
  });
  return decision;
}

const attackMutations = {
  protected_event_envelope_forgery() {
    // Same installed operation on clean vs one-field-mutated ledger.
    // Positive control: clean ledger reaches resumeInstalledEngineSession.
    // Mutation: only event_hash on the protected decision envelope is forged.
    // Exact documented OwnerKernelError code from the protected-envelope path:
    // WITNESS_REJECTED ("external witness rejected event receipt").
    const fx = installedFixture('corpus-attack-forgery');
    const { session, witnessInvoke } = openInstalledSession(fx, {
      runLabel: 'protected-envelope-forgery',
    });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'forgery' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    assert.equal(decision.payload.action_class, 'external');
    const cleanLedger = session.kernel.getLedger();
    const resumeArgs = {
      binding: fx.installedBinding,
      profile: fx.profile,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      kernelBinding: fx.kernelBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
      witnessInvoke,
      engineInvoke: capabilityOnlyInvoke(fx),
      coordinatorInvoke: () => {
        throw new Error('forgery resume must not accept');
      },
      kernelOptions: {
        adapters: fx.runtime.adapters(),
        clock: () => new Date(fx.runtime.NOW),
        nonceFactory: () => 'd'.repeat(64),
      },
    };
    // Positive reachability: clean ledger reaches the installed resume operation.
    const cleanResumed = installedEngine.resumeInstalledEngineSession({
      ...resumeArgs,
      ledger: cleanLedger,
    });
    assert.ok(cleanResumed && cleanResumed.kernel, 'clean control must reach resumeInstalledEngineSession');
    assert.equal(
      cleanResumed.getActionIdentity().decision_id,
      decision.payload.decision_id,
    );
    cleanResumed.teardown();

    // One-field mutation of the protected decision envelope event_hash only.
    const mutatedLedger = structuredClone(cleanLedger);
    const decisionIndex = mutatedLedger.events.findIndex((event) => event.type === 'decision');
    assert.ok(decisionIndex >= 0);
    mutatedLedger.events[decisionIndex] = {
      ...mutatedLedger.events[decisionIndex],
      event_hash: 'f'.repeat(64),
    };
    let namedCode = null;
    let namedMessage = null;
    try {
      installedEngine.resumeInstalledEngineSession({
        ...resumeArgs,
        ledger: mutatedLedger,
      });
      assert.fail('forged protected envelope must be rejected by resume');
    } catch (error) {
      namedCode = error && error.code;
      namedMessage = String(error && error.message || '');
      assert.ok(
        error instanceof OwnerKernelError,
        `protected-envelope path must throw OwnerKernelError; got ${error && error.name}`,
      );
    }
    session.teardown();
    // Exact documented code from the protected-envelope integrity path — not a broad regex.
    assert.equal(
      namedCode,
      'WITNESS_REJECTED',
      `protected-envelope forgery must reject with WITNESS_REJECTED; got ${namedCode}: ${namedMessage}`,
    );
    assert.equal(
      namedMessage,
      'external witness rejected event receipt',
      `protected-envelope forgery must use the documented witness rejection message; got ${namedMessage}`,
    );
    return true;
  },
  direct_decision_append() {
    // Control: valid installed session mints exactly one legitimate decision
    // under the real owner capability; ledger reconstructs successfully.
    const fx = installedFixture('corpus-attack-direct-decision');
    const { session } = openInstalledSession(fx, { runLabel: 'direct-decision' });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'direct-control' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    assert.equal(typeof decision.payload.decision_id, 'string');
    const cleanLedger = session.kernel.getLedger();
    const controlIdentity = installedEngine.reconstructActionIdentityFromLedger(cleanLedger);
    assert.equal(controlIdentity.decision_id, decision.payload.decision_id);
    assert.ok(
      controlIdentity.status === 'authorized' || controlIdentity.decision_id,
      'control decision must reconstruct from installed ledger',
    );
    // Mutation: exactly one direct appended decision event on that ledger.
    const mutated = structuredClone(cleanLedger);
    const controlDecision = mutated.events.find((event) => event.type === 'decision');
    assert.ok(controlDecision);
    mutated.events.push({
      ...controlDecision,
      event_hash: 'a'.repeat(64),
      payload: {
        ...controlDecision.payload,
        decision_id: `${controlDecision.payload.decision_id}-appended`,
      },
    });
    let code = null;
    let message = null;
    try {
      installedEngine.reconstructActionIdentityFromLedger(mutated);
      assert.fail('direct appended decision must be rejected');
    } catch (error) {
      code = error && error.code;
      message = String(error && error.message || '');
      assert.ok(
        error instanceof OwnerKernelError || error instanceof Error,
        'direct append must throw a named error',
      );
    }
    session.teardown();
    assert.ok(typeof code === 'string' && code.length > 0, `direct_decision_append exact code; got ${code}`);
    assert.equal(
      code,
      'ENGINE_REDISPATCH_FORBIDDEN',
      `direct appended decision must reject with ENGINE_REDISPATCH_FORBIDDEN; got ${code}: ${message}`,
    );
    assert.match(
      message,
      /duplicate or replaced installed action identities/i,
      `direct_decision_append exact message; got ${message}`,
    );
    return true;
  },
  worker_artifact_decision_injection() {
    const fx = installedFixture('corpus-attack-worker-inject');
    const workerIdentity = fx.profile.engine_profile.route.worker_binding.identity;
    const workerBindingHash = sha256(canonicalJson(
      fx.profile.engine_profile.route.worker_binding,
    ));
    // Production-shaped evidence adapters only — never install a verifier whose
    // programmed behavior is the rejection under test (worker-intake-tautological-oracle).
    // Decision-shaped worker output is still accepted as evidence; Kernel never
    // appends a decision from this path.
    const adapters = {
      ...fx.runtime.adapters(),
      evidenceArchiver({ verified_evidence }) {
        return {
          uri: `durable://corpus-worker-artifact/${sha256(canonicalJson(verified_evidence))}`,
          sha256: sha256(canonicalJson(verified_evidence)),
        };
      },
      evidenceVerifier(request, context) {
        return {
          ok: true,
          run_id: context.run_id,
          identity: 'owner-kernel',
          channel: 'kernel-evidence',
          envelope_hash: sha256(canonicalJson({ request, context })),
          payload: {
            emitter_kind: 'kernel',
            verification_path: 'kernel_verify',
            artifact_hashes: [sha256(canonicalJson(request || {}))],
          },
        };
      },
    };
    const { session } = openInstalledSession(fx, {
      runLabel: 'worker-inject',
      adapters,
    });
    // Instrument reachability of the canonical installed worker-artifact adapter
    // (Kernel.recordEvidence) only — do not reprogram its decision semantics.
    let workerArtifactIntakeCalls = 0;
    const canonicalWorkerArtifactIntake = session.kernel.recordEvidence.bind(session.kernel);
    session.kernel.recordEvidence = (request) => {
      workerArtifactIntakeCalls += 1;
      return canonicalWorkerArtifactIntake(request);
    };
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'worker-inject' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const decisionsBeforeIntake = session.kernel.getLedger().events
      .filter((event) => event.type === 'decision').length;
    assert.equal(decisionsBeforeIntake, 1);
    // Invoke the canonical installed worker-artifact adapter exactly once.
    session.kernel.recordEvidence({
      purpose: 'worker-artifact-decision-injection',
      kind: 'worker_artifact',
      channel: 'worker-artifact',
      worker_identity: workerIdentity,
      worker_binding_hash: workerBindingHash,
      decision_id: 'worker-injected-decision',
      action_descriptor: {
        ...fx.profile.action,
        targets: ['worker-forged-target'],
      },
      source_artifact: 'worker-decision.json',
      payload: {
        type: 'decision',
        decision_id: 'worker-injected-decision',
        descriptor: 'worker-forged-target',
      },
    });
    assert.equal(workerArtifactIntakeCalls, 1, 'production intake reached exactly once');
    const decisionsAfterIntake = session.kernel.getLedger().events
      .filter((event) => event.type === 'decision').length;
    // Worker output is evidence only — no decision is appended.
    assert.equal(decisionsAfterIntake, decisionsBeforeIntake);
    assert.equal(decisionsAfterIntake, 1);
    assert.equal(decision.payload.action_class, 'external');
    const evidenceEvents = session.kernel.getLedger().events
      .filter((event) => event.type === 'evidence');
    assert.ok(evidenceEvents.length >= 1, 'worker artifact recorded as evidence only');
    session.teardown();
    return true;
  },
  child_process_capability_theft() {
    const fx = installedFixture('corpus-attack-cap-theft');
    const { session, witnessInvoke } = openInstalledSession(fx, { runLabel: 'cap-theft' });
    const realCapability = session.owner_capability;
    const stateJson = JSON.stringify(session.kernel.getState());
    const ledgerJson = JSON.stringify(session.kernel.getLedger());
    const leaked = stateJson.includes('owner_capability')
      || ledgerJson.includes('owner_capability')
      || JSON.stringify(session.kernel.disclosure()).includes(String(realCapability));
    // Serialize only the capability blob the child could steal — not live WeakMap identity.
    const stolenPayload = JSON.stringify({
      capability: realCapability,
      action: fx.profile.action,
      root,
      acceptanceContract,
      now: fx.runtime.NOW,
      expires: fx.expires,
    });
    const child = require('child_process').spawnSync(
      process.execPath,
      ['-e', `
        const path = require('path');
        const payload = JSON.parse(process.argv[1]);
        const eng = require(path.join(payload.root, 'src/engine/supervised-owner-kernel-installed-engine'));
        const installedContract = require(path.join(
          payload.root, 'src/engine/supervised-owner-kernel-installed-contract',
        ));
        const { createP37Runtime } = require(path.join(payload.root, 'hooks/tests/fixtures/p37-runtime'));
        // Child builds its own complete installed session; only the stolen
        // capability token is imported from the parent process.
        const childRuntime = createP37Runtime(payload.root, {
          actionCatalog: [eng.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
          acceptanceContract: payload.acceptanceContract,
          runId: 'corpus-attack-cap-theft-child',
        });
        const { durableBinding, serviceBindings, kernelBinding, hash } = childRuntime;
        const bindings = { kernel: {
          role: 'kernel',
          identity: kernelBinding.identity,
          uid: kernelBinding.uid,
          gid: kernelBinding.gid,
          attestation_hash: kernelBinding.attestation_hash,
          cgroup_binding_hash: kernelBinding.cgroup_binding_hash,
        } };
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
        const binding = installedContract.normalizeInstalledBinding({
          schema_version: 1,
          kind: 'p37_installed_state_binding',
          install_binding_hash: durableBinding.install_binding_hash,
          run_binding_hash: durableBinding.run_binding_hash,
          installed_abi_hash: installedContract.getSupervisedOwnerKernelInstalledAbiHash(),
          durable_abi_hash: durableBinding.durable_abi_hash,
          cohort_id: durableBinding.cohort_id,
          generation: durableBinding.generation,
          service_bindings: bindings,
          snapshot_hash: hash({ cohort: durableBinding.cohort_id, gen: durableBinding.generation }),
        });
        const nowIso = new Date(payload.now).toISOString();
        const expiresIso = new Date(payload.expires || (payload.now + 3600000)).toISOString();
        const profile = eng.compileInstalledEngineProfile({
          binding,
          governanceConfig: childRuntime.governanceConfig,
          acceptanceContract: payload.acceptanceContract,
          routeInputs: childRuntime.routeInputs,
          durableBinding,
          kernelBinding,
          capabilityProbedAt: nowIso,
          capabilityExpiresAt: expiresIso,
        });
        const childWitness = childRuntime.createWitnessInvoke();
        const capabilityOnly = (message) => {
          if (message.operation && message.operation.startsWith('capability:')) {
            const request = message.request;
            const response = {
              ok: true,
              run_id: request.run_id,
              host_capability_hash: request.host_capability_hash,
              observation_hash: childRuntime.hash({ operation: message.operation, request }),
              probe_nonce: request.probe_nonce,
            };
            return {
              schema_version: 1,
              kind: 'p37_engine_host_response',
              profile_hash: message.profile_hash,
              route_hash: message.route_hash,
              operation: message.operation,
              request_hash: message.request_hash,
              response,
              response_hash: childRuntime.hash(response),
            };
          }
          throw new Error('child must not execute');
        };
        let childSession;
        try {
          childSession = eng.createInstalledEngineSession({
            profile,
            binding,
            durableBinding,
            governanceConfig: childRuntime.governanceConfig,
            acceptanceContract: payload.acceptanceContract,
            routeInputs: childRuntime.routeInputs,
            witnessInvoke: childWitness,
            engineInvoke: capabilityOnly,
            coordinatorInvoke: () => { throw new Error('child must not accept'); },
            kernelOptions: {
              initialIntentEnvelope: {
                signed: true,
                payload: { text: 'stolen-child', explicit_action_hashes: [] },
              },
              initialOwnerId: 'owner-a',
              adapters: childRuntime.adapters(),
              clock: () => new Date(payload.now),
              nonceFactory: () => 'd'.repeat(64),
            },
          });
        } catch (error) {
          process.stdout.write('CHILD_SESSION_FAILED:' + (error && error.message ? error.message : 'failed'));
          process.exit(2);
        }
        process.stdout.write('CHILD_SESSION_OK\\n');
        try {
          childSession.kernel.mintActionDecision({
            capability: payload.capability,
            ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'stolen' },
            actionClass: 'external',
            actionDescriptor: profile.action,
          });
          process.stdout.write('CHILD_AUTHORIZED');
          process.exit(0);
        } catch (error) {
          const msg = error && error.message ? error.message : 'held';
          const code = error && error.code ? error.code : '';
          process.stdout.write('CHILD_HELD:' + code + ':' + msg);
          process.exit(1);
        }
      `, stolenPayload],
      { encoding: 'utf8', cwd: root, timeout: 20000 },
    );
    const childOut = typeof child.stdout === 'string' ? child.stdout : '';
    const childHeld = child.status === 1
      && childOut.includes('CHILD_SESSION_OK')
      && childOut.includes('CHILD_HELD')
      && !childOut.includes('CHILD_AUTHORIZED')
      && /OWNER_CAPABILITY|capability|in-memory owner capability/i.test(childOut);
    const sameProcessHeld = heldNamed(() => session.kernel.mintActionDecision({
      capability: { stolen: true, from: 'child-process', token: realCapability },
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'theft' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    }), {
      code: 'OWNER_CAPABILITY_REQUIRED',
      messagePattern: /capability|owner/i,
      label: 'child_process_capability_theft_same_process',
    });
    session.teardown();
    return !leaked && childHeld && sameProcessHeld;
  },
  policy_kernel_mutation() {
    const fx = installedFixture('corpus-attack-policy-kernel');
    // Positive control: clean durable binding compiles.
    const control = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(control.sink_id, 'engine-implementation-dispatch-v1');
    return heldNamed(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: {
        ...fx.durableBinding,
        install_binding_hash: 'a'.repeat(64),
      },
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }), {
      code: 'INSTALLED_BINDING_MISMATCH',
      messagePattern: /binding|hash|cohort|route/i,
      label: 'policy_kernel_mutation',
    });
  },
  async mediated_action_bypass() {
    const fx = installedFixture('corpus-attack-mediated-bypass');
    const { session } = openInstalledSession(fx, { runLabel: 'mediated-bypass' });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'bypass' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const raceExecute = session.kernel.executeAuthorizedAction({
      decisionId: decision.payload.decision_id,
      action: fx.profile.action,
      timeoutMilliseconds: 1000,
    });
    const lateApprovalHeld = await heldNamed(() => session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: decision.payload.decision_id,
        decision_content_hash: '0'.repeat(64),
        max_uses: 99,
        forged_async_bypass: true,
      },
    }), {
      code: 'INVALID_OWNER_EVENT_STATE',
      messagePattern: /approval|content|hash|decision/i,
      label: 'mediated_action_bypass_late_approval',
    });
    const executeWithoutMediation = await heldNamed(() => raceExecute, {
      code: 'ACTION_USE_EXHAUSTED',
      messagePattern: /remaining authorized use|approv|authorization|execute|claim/i,
      label: 'mediated_action_bypass_execute',
    });
    const foreignOpHeld = heldNamed(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      operation: 'engine_review_dispatch',
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }), {
      code: 'ENGINE_SINK_REJECTED',
      messagePattern: /operation|substitute|sink/i,
      label: 'mediated_action_bypass_foreign_op',
    });
    session.teardown();
    return executeWithoutMediation && lateApprovalHeld && foreignOpHeld;
  },
  capability_set_drift() {
    const fx = installedFixture('corpus-attack-cap-drift');
    // Positive control: fixed installed sink is accepted.
    assert.equal(
      installedEngine.rejectForeignEngineSink(installedEngine.INSTALLED_ENGINE_SINK_ID),
      true,
    );
    const a = heldNamed(() => installedEngine.rejectForeignEngineSink('implementation-dispatch'), {
      code: 'ENGINE_SINK_REJECTED',
      messagePattern: /implementation-dispatch|rejects sink/i,
      label: 'capability_set_drift_foreign_sink',
    });
    const b = heldNamed(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      sink_id: 'implementation-dispatch',
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }), {
      code: 'ENGINE_SINK_REJECTED',
      messagePattern: /sink|substitute|caller/i,
      label: 'capability_set_drift_sink_id',
    });
    return a && b;
  },
  witness_head_rewrite() {
    // Isolated mutation: rewrite an actual witnessed ledger receipt/head only
    // (not route/profile hashes). Prefer the last witnessed event so subsequent
    // previous_witness_head chain validators cannot fire first. Non-witness
    // integrity fields (content_hash / event_hash / payload) stay intact so the
    // exact witness-head mismatch is the first and only failure mode — held(any
    // exception) is forbidden.
    const fx = installedFixture('corpus-attack-witness-rewrite');
    const { session, witnessInvoke } = openInstalledSession(fx, {
      runLabel: 'witness-head-rewrite',
    });
    session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'witness-rewrite' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const ledger = structuredClone(session.kernel.getLedger());
    assert.ok(Array.isArray(ledger.events) && ledger.events.length > 0);
    let witnessedIdx = -1;
    for (let index = ledger.events.length - 1; index >= 0; index -= 1) {
      const event = ledger.events[index];
      if (event && event.witness && typeof event.witness.witness_head === 'string') {
        witnessedIdx = index;
        break;
      }
    }
    assert.ok(witnessedIdx >= 0, 'ledger must carry a witnessed receipt to rewrite');
    const original = ledger.events[witnessedIdx];
    // Isolate mutation to witness_head on the actual receipt. Leave event_hash,
    // content_hash, payload, and previous_witness_head untouched so no unrelated
    // INVALID_OWNER_EVENT / content-hash validator fails first.
    const forgedHead = 'b'.repeat(64);
    assert.notEqual(
      original.witness.witness_head.toLowerCase(),
      forgedHead,
      'forged head must differ from the authentic witnessed head',
    );
    ledger.events[witnessedIdx] = {
      ...original,
      // Preserve non-witness integrity fields byte-for-byte.
      content_hash: original.content_hash,
      event_hash: original.event_hash,
      payload: original.payload,
      witness: {
        ...original.witness,
        witness_head: forgedHead,
        previous_witness_head: original.witness.previous_witness_head,
        event_hash: original.witness.event_hash,
      },
    };
    let caught = null;
    try {
      installedEngine.resumeInstalledEngineSession({
        binding: fx.installedBinding,
        profile: fx.profile,
        governanceConfig: fx.runtime.governanceConfig,
        acceptanceContract,
        routeInputs: fx.runtime.routeInputs,
        durableBinding: fx.durableBinding,
        kernelBinding: fx.kernelBinding,
        ledger,
        capabilityProbedAt: fx.now,
        capabilityExpiresAt: fx.expires,
        witnessInvoke,
        engineInvoke: capabilityOnlyInvoke(fx),
        coordinatorInvoke: () => {
          throw new Error('witness-head rewrite must not accept');
        },
        kernelOptions: {
          adapters: fx.runtime.adapters(),
          clock: () => new Date(fx.runtime.NOW),
          nonceFactory: () => 'f'.repeat(64),
        },
      });
    } catch (error) {
      caught = error;
    }
    session.teardown();
    assert.ok(caught, 'witness-head rewrite must throw');
    assert.ok(
      caught instanceof OwnerKernelError,
      'witness-head rewrite must throw OwnerKernelError (not a generic Error)',
    );
    assert.equal(
      caught.code,
      'WITNESS_REJECTED',
      'exact witness-head mismatch code must be WITNESS_REJECTED',
    );
    assert.equal(
      caught.message,
      'external witness rejected event receipt',
      'exact witness-head mismatch message must be the external witness rejection',
    );
    return true;
  },
};

const categoryMutations = {
  async low_risk_executable() {
    const fx = installedFixture('corpus-cat-low-risk');
    assert.equal(fx.profile.sink_id, 'engine-implementation-dispatch-v1');
    assert.equal(fx.profile.authority.acceptance, 'coordinator_v2');
    // Real mediated fixed-sink execute through the installed action path.
    const authorizations = new Map();
    const sinkCalls = [];
    let engineObservation = null;
    const contentSha = fx.hash('low-risk-workspace-bytes');
    function hostResponse(message, response) {
      return {
        schema_version: 1,
        kind: 'p37_engine_host_response',
        profile_hash: message.profile_hash,
        route_hash: message.route_hash,
        operation: message.operation,
        request_hash: message.request_hash,
        response,
        response_hash: fx.hash(response),
      };
    }
    function engineInvoke(message) {
      const request = message.request;
      if (message.operation && message.operation.startsWith('capability:')) {
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: fx.hash({ operation: message.operation, request }),
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
            expires_at: new Date(fx.runtime.NOW + 120000).toISOString(),
            attestation_hash: fx.hash(`permit:${request.claim_id}`),
            issuer: fx.profile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
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
            issued_at: fx.now,
            expires_at: new Date(fx.runtime.NOW + 60000).toISOString(),
            attestation_hash: fx.hash(`authorization:${request.claim_id}`),
            issuer: fx.profile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
            authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
          };
          authorizations.set(authorization.authorization_id, authorization.authorization);
          response.execution_authorization = authorization;
        }
        return hostResponse(message, response);
      }
      if (message.operation === 'execute_engine_dispatch') {
        const authorization = request.execution_authorization;
        if (!authorization
          || authorizations.get(authorization.authorization_id) !== authorization.authorization) {
          throw new Error('low_risk execute authorization missing');
        }
        sinkCalls.push(request.claim_id);
        engineObservation = 'committed';
        const effectId = `low-risk-effect-${request.claim_id}`;
        const commitSha = 'a'.repeat(40);
        const receiptSha = fx.hash({ effect_id: effectId, commit: commitSha, content: contentSha });
        return hostResponse(message, {
          receipt: {
            uri: `file://${fx.profile.engine_profile.receipt_root}/${effectId}.json`,
            sha256: receiptSha,
          },
          broker: {
            identity: fx.runtime.serviceBindings.broker.identity,
            broker_uid: fx.runtime.serviceBindings.broker.uid,
          },
          execution_permit_hash: request.execution_permit_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: authorization.authorization_id,
          claim_event_hash: request.claim_event_hash,
          claim_witness_head: request.claim_witness_head,
          permit_state: 'consumed',
          boundary_effect_id: effectId,
          boundary_state_version: 1,
          boundary_attestation_hash: fx.runtime.serviceBindings.broker.attestation_hash,
          effect_at: fx.now,
          delivered_manifest: {
            commit: commitSha,
            artifacts: [{ id: 'workspace', path: 'workspace.tar', sha256: contentSha }],
            receipt_sha256: receiptSha,
            boundary_effect_id: effectId,
          },
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
          observed_action: fx.profile.action,
          error_code: null,
        });
      }
      throw new Error(`unexpected engine op ${message.operation}`);
    }
    const { session } = openInstalledSession(fx, {
      runLabel: 'low-risk-executable',
      engineInvoke,
    });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'low-risk' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
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
      action: fx.profile.action,
      timeoutMilliseconds: 1000,
    });
    assert.equal(sinkCalls.length, 1, 'low_risk must call fixed sink exactly once');
    assert.equal(engineObservation, 'committed');
    assert.equal(session.engineTerminalIsAcceptance('committed'), false);
    assert.equal(session.sink_id, 'engine-implementation-dispatch-v1');
    session.teardown();
    return 'accept';
  },
  high_risk_executable() {
    const fx = installedFixture('corpus-cat-high-risk');
    // Positive reachability: the fixed installed sink is accepted by the gate.
    assert.equal(
      installedEngine.rejectForeignEngineSink(installedEngine.INSTALLED_ENGINE_SINK_ID),
      true,
      'positive control: fixed installed sink must be reachable/accepted',
    );
    // Exact named rejection for a foreign high-risk sink — not any exception.
    const blocked = heldNamed(
      () => installedEngine.rejectForeignEngineSink('campaign-dispatch'),
      {
        code: 'ENGINE_SINK_REJECTED',
        messagePattern: /campaign-dispatch|rejects sink/i,
        label: 'high_risk_executable',
      },
    );
    return blocked ? 'block' : 'accept';
  },
  async mixed_executable_non_executable() {
    // Coherent mixed fixture: one executable leg + one non-executable leg.
    // Control: challenge both legs after dispatch → accept. Mutation: challenge
    // only the executable leg (skip ux) → accept blocks with challenge_missing:ux.
    // Not a schema_version surrogate.
    const fx = installedFixture('corpus-cat-mixed');
    assert.equal(
      fx.acceptanceContract.legs.map((leg) => leg.kind).sort().join(','),
      'executable,non_executable',
      'mixed fixture must carry both leg kinds',
    );

    // --- Positive control: both legs challenged ---
    const controlHarness = createAcceptanceHarness(fx, {
      contentLabel: 'mixed-control-workspace',
      executableLegId: 'tests',
    });
    const { session: controlSession } = openInstalledSession(fx, {
      runLabel: 'mixed-control',
      engineInvoke: controlHarness.engineInvoke,
      coordinatorInvoke: controlHarness.coordinatorInvoke,
      adapters: controlHarness.adapters,
    });
    await dispatchAuthorized(fx, controlSession);
    controlHarness.bindDispatchManifest(controlSession);
    controlSession.kernel.recordVerification({ purpose: 'tests' });
    const controlTests = controlSession.kernel.recordChallenge({ scope_id: 'tests' });
    const controlUx = controlSession.kernel.recordChallenge({ scope_id: 'ux' });
    assert.equal(controlTests.payload.finding, 'clear');
    assert.equal(controlUx.payload.finding, 'clear');
    controlSession.kernel.recordAuditReconciliation({ purpose: 'audit' });
    const controlAccept = await controlSession.kernel.accept({
      capability: controlSession.owner_capability,
      timeoutMilliseconds: 1000,
    });
    assert.equal(
      controlAccept.accepted,
      true,
      'positive control: mixed contract with both challenges must accept',
    );
    controlSession.teardown();

    // --- Mutation: only executable leg challenged; non-executable residue skipped ---
    const mutantHarness = createAcceptanceHarness(fx, {
      contentLabel: 'mixed-mutation-workspace',
      executableLegId: 'tests',
    });
    const { session } = openInstalledSession(fx, {
      runLabel: 'mixed-mutation',
      engineInvoke: mutantHarness.engineInvoke,
      coordinatorInvoke: mutantHarness.coordinatorInvoke,
      adapters: mutantHarness.adapters,
      nonce: 'd'.repeat(64),
    });
    await dispatchAuthorized(fx, session);
    mutantHarness.bindDispatchManifest(session);
    session.kernel.recordVerification({ purpose: 'tests' });
    session.kernel.recordChallenge({ scope_id: 'tests' });
    // Intentionally omit recordChallenge({ scope_id: 'ux' }).
    session.kernel.recordAuditReconciliation({ purpose: 'audit' });
    const blocked = await session.kernel.accept({
      capability: session.owner_capability,
      timeoutMilliseconds: 1000,
    });
    assert.equal(blocked.accepted, false, 'mixed must not accept without non-executable challenge');
    assert.equal(
      blocked.disposition,
      'blocked',
      `mixed disposition must be blocked; got ${blocked.disposition}`,
    );
    assert.ok(
      Array.isArray(blocked.reasons)
        && blocked.reasons.some((reason) => reason === 'challenge_missing:ux'),
      `mixed must cite challenge_missing:ux; got ${JSON.stringify(blocked.reasons)}`,
    );
    assert.equal(session.kernel.getState().status, 'blocked');
    session.teardown();
    return 'block';
  },
  async non_executable_design() {
    // Coherent non-executable-only installed fixture from intake — not a mid-compile
    // leg swap / binding mismatch. Missing mandatory design challenge → block.
    const nonExecContract = {
      schema_version: 2,
      contract_id: 'p37-installed-corpus-non-exec-design',
      artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
      legs: [
        {
          id: 'design',
          kind: 'non_executable',
          artifact_ids: ['workspace'],
        },
      ],
    };
    const fx = installedFixture('corpus-cat-non-exec', { contract: nonExecContract });
    assert.equal(fx.profile.sink_id, 'engine-implementation-dispatch-v1');
    assert.equal(
      fx.acceptanceContract.legs.length,
      1,
      'non_executable_design fixture must have exactly one leg',
    );
    assert.equal(fx.acceptanceContract.legs[0].kind, 'non_executable');
    assert.equal(fx.acceptanceContract.legs[0].id, 'design');

    // --- Positive control: design challenge present → accept ---
    const controlHarness = createAcceptanceHarness(fx, {
      contentLabel: 'design-control-workspace',
      executableLegId: 'design',
    });
    const { session: controlSession } = openInstalledSession(fx, {
      runLabel: 'non-exec-control',
      engineInvoke: controlHarness.engineInvoke,
      coordinatorInvoke: controlHarness.coordinatorInvoke,
      adapters: controlHarness.adapters,
    });
    await dispatchAuthorized(fx, controlSession);
    controlHarness.bindDispatchManifest(controlSession);
    const controlChallenge = controlSession.kernel.recordChallenge({ scope_id: 'design' });
    assert.equal(controlChallenge.payload.finding, 'clear');
    assert.equal(controlChallenge.payload.scope_id, 'design');
    controlSession.kernel.recordAuditReconciliation({ purpose: 'audit' });
    const controlAccept = await controlSession.kernel.accept({
      capability: controlSession.owner_capability,
      timeoutMilliseconds: 1000,
    });
    assert.equal(
      controlAccept.accepted,
      true,
      'positive control: design-only contract with challenge must accept',
    );
    controlSession.teardown();

    // --- Mutation: omit the only non-executable challenge ---
    const mutantHarness = createAcceptanceHarness(fx, {
      contentLabel: 'design-mutation-workspace',
      executableLegId: 'design',
    });
    const { session } = openInstalledSession(fx, {
      runLabel: 'non-exec-mutation',
      engineInvoke: mutantHarness.engineInvoke,
      coordinatorInvoke: mutantHarness.coordinatorInvoke,
      adapters: mutantHarness.adapters,
      nonce: 'e'.repeat(64),
    });
    await dispatchAuthorized(fx, session);
    mutantHarness.bindDispatchManifest(session);
    // No recordChallenge for design.
    session.kernel.recordAuditReconciliation({ purpose: 'audit' });
    const blocked = await session.kernel.accept({
      capability: session.owner_capability,
      timeoutMilliseconds: 1000,
    });
    assert.equal(blocked.accepted, false, 'design-only must not accept without challenge');
    assert.equal(blocked.disposition, 'blocked');
    assert.ok(
      Array.isArray(blocked.reasons)
        && blocked.reasons.some((reason) => reason === 'challenge_missing:design'),
      `non_executable_design must cite challenge_missing:design; got ${JSON.stringify(blocked.reasons)}`,
    );
    assert.equal(session.kernel.getState().status, 'blocked');
    session.teardown();
    return 'block';
  },
  irreversible_action() {
    const fx = installedFixture('corpus-cat-irreversible');
    const control = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      action: installedEngine.fixedAction(),
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(control.action_hash, sha256(canonicalJson(installedEngine.fixedAction())));
    // Mutation: only action descriptor (publish/external).
    const blocked = heldNamed(
      () => installedEngine.compileInstalledEngineProfile({
        binding: fx.installedBinding,
        action: {
          operation: 'engine_publish_external',
          tool_class: 'publisher',
          targets: ['external:publish'],
        },
        governanceConfig: fx.runtime.governanceConfig,
        acceptanceContract,
        routeInputs: fx.runtime.routeInputs,
        durableBinding: fx.durableBinding,
        capabilityProbedAt: fx.now,
        capabilityExpiresAt: fx.expires,
      }),
      {
        code: 'ENGINE_SINK_REJECTED',
        messagePattern: /^caller cannot substitute the installed Engine action descriptor$/,
        label: 'irreversible_action',
      },
    );
    return blocked ? 'escalate' : 'accept';
  },
  mislabeled_reversibility() {
    const fx = installedFixture('corpus-cat-mislabeled');
    const control = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      action: installedEngine.fixedAction(),
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(control.sink_id, 'engine-implementation-dispatch-v1');
    // Mutation: only targets → review-dispatch.
    const blocked = heldNamed(
      () => installedEngine.compileInstalledEngineProfile({
        binding: fx.installedBinding,
        action: {
          operation: 'engine_implementation_dispatch',
          tool_class: 'model_runner',
          targets: ['autopilot-engine:review-dispatch'],
        },
        governanceConfig: fx.runtime.governanceConfig,
        acceptanceContract,
        routeInputs: fx.runtime.routeInputs,
        durableBinding: fx.durableBinding,
        capabilityProbedAt: fx.now,
        capabilityExpiresAt: fx.expires,
      }),
      {
        code: 'ENGINE_SINK_REJECTED',
        messagePattern: /^caller cannot substitute the installed Engine action descriptor$/,
        label: 'mislabeled_reversibility',
      },
    );
    return blocked ? 'escalate' : 'accept';
  },
  acceptance_substitution() {
    // Control: installed profile compile reaches the fixed sink boundary.
    const fx = installedFixture('corpus-cat-accept-sub');
    const control = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(control.sink_id, 'engine-implementation-dispatch-v1');
    // Mutation: only accepted:true without a witnessed ledger (do not also
    // fabricate unrelated hash fields or corrupt result_hash as confounds).
    const blocked = heldNamed(
      () => installedEngine.normalizeInstalledEngineResult({
        schema_version: 1,
        kind: 'p37_installed_engine_result',
        status: 'complete',
        outcome: 'accepted',
        profile_hash: fx.profile.profile_hash,
        sink_id: 'engine-implementation-dispatch-v1',
        action_identity: {
          status: 'accepted',
          catalog_id: 'engine-implementation-dispatch-v1',
          decision_id: 'sub',
          action_hash: fx.profile.action_hash,
        },
        engine_observation: { status: 'ok' },
        accepted: true,
        terminal_batch: 'atomic',
        authority: installedEngine.INSTALLED_ENGINE_AUTHORITY,
        disclosure: { run_id: 'x', current_intent_id: 'y', decisions: [] },
        disclosure_hash: sha256(canonicalJson({ run_id: 'x', current_intent_id: 'y', decisions: [] })),
        ledger: null,
        ledger_head: null,
        delivered_manifest_head: null,
        candidate_set_hash: null,
        acceptance_event_hash: null,
        complete_event_hash: null,
        result_hash: '0'.repeat(64),
      }),
      {
        code: 'ACCEPTANCE_BATCH_REQUIRED',
        messagePattern: /^accepted:true result requires the witnessed ledger; literal hashes alone cannot authorize$/,
        label: 'acceptance_substitution',
      },
    );
    return blocked ? 'block' : 'accept';
  },
  approval_supersession() {
    const fx = installedFixture('corpus-cat-approval');
    const { session } = openInstalledSession(fx, { runLabel: 'approval-supersession' });
    const first = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'approval-1' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    // Positive control: a fresh approval on the current decision succeeds.
    const freshApproval = session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: first.payload.decision_id,
        decision_content_hash: first.payload.decision_content_hash,
        max_uses: 1,
      },
    });
    assert.ok(freshApproval, 'positive control: fresh approval must succeed');
    // Mutation: only intent/decision freshness changes via superseding captureIntent.
    session.kernel.captureIntent({
      signed: true,
      payload: { text: 'Superseding intent', explicit_action_hashes: [] },
    });
    const staleApprovalHeld = heldNamed(() => session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: first.payload.decision_id,
        decision_content_hash: first.payload.decision_content_hash,
        max_uses: 1,
      },
    }), {
      code: 'INVALID_OWNER_EVENT_STATE',
      messagePattern: /approv|supersed|intent|stale|decision/i,
      label: 'approval_supersession',
    });
    session.teardown();
    return staleApprovalHeld ? 'reject' : 'accept';
  },
  async worker_failure() {
    const fx = installedFixture('corpus-cat-worker-fail');
    let engineCalls = 0;
    const authorizations = new Map();
    // Valid mediated capability responses so execution reaches the worker exactly once.
    function mediatedFailingWorkerInvoke(message) {
      const request = message.request;
      if (message.operation && message.operation.startsWith('capability:')) {
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: fx.hash({ operation: message.operation, request }),
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
            expires_at: new Date(fx.runtime.NOW + 120000).toISOString(),
            attestation_hash: fx.hash(`permit:${request.claim_id}`),
            issuer: fx.profile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
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
            issued_at: new Date(fx.runtime.NOW).toISOString(),
            expires_at: new Date(fx.runtime.NOW + 60000).toISOString(),
            attestation_hash: fx.hash(`authorization:${request.claim_id}`),
            issuer: fx.profile.engine_profile.route.kernel_binding.identity,
            issuer_attestation_hash: fx.profile.engine_profile.route.kernel_binding.attestation_hash,
            authorization: `postclaim:${request.claim_id}:${request.claim_event_hash}`,
          };
          authorizations.set(authorization.authorization_id, authorization.authorization);
          response.execution_authorization = authorization;
        }
        return {
          schema_version: 1,
          kind: 'p37_engine_host_response',
          profile_hash: message.profile_hash,
          route_hash: message.route_hash,
          operation: message.operation,
          request_hash: message.request_hash,
          response,
          response_hash: fx.hash(response),
        };
      }
      if (message.operation === 'execute_engine_dispatch') {
        engineCalls += 1;
        throw new Error('worker exited non-zero / dirty tree');
      }
      throw new Error(`unexpected engine op ${message.operation}`);
    }
    const { session } = openInstalledSession(fx, {
      runLabel: 'worker-failure',
      engineInvoke: mediatedFailingWorkerInvoke,
    });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'worker-fail' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: decision.payload.decision_id,
        decision_content_hash: decision.payload.decision_content_hash,
        max_uses: 1,
      },
    });
    // executeAuthorizedAction does not rethrow worker failures after a claim is
    // witnessed — it records an unknown outcome. The oracle must require the
    // failing worker to run exactly once under valid mediation.
    let executeResult = null;
    let executeThrew = false;
    try {
      executeResult = await session.kernel.executeAuthorizedAction({
        decisionId: decision.payload.decision_id,
        action: fx.profile.action,
        timeoutMilliseconds: 1000,
      });
    } catch (_error) {
      executeThrew = true;
    }
    const outcomePayload = executeResult
      && executeResult.outcome
      && executeResult.outcome.payload;
    const workerFailedOnce = engineCalls === 1
      && !executeThrew
      && outcomePayload
      && outcomePayload.outcome === 'unknown'
      && (
        outcomePayload.error_code === 'executor_exception'
        || outcomePayload.error_code === 'action_boundary_ambiguous'
      );
    const acceptHeld = await heldNamed(() => session.kernel.accept({
      capability: session.owner_capability,
      timeoutMilliseconds: 1000,
    }), {
      code: 'DISPATCH_MANIFEST_REQUIRED',
      messagePattern: /dispatch|delivered-manifest|accept requires/i,
      label: 'worker_failure_accept',
    });
    session.teardown();
    return workerFailedOnce && acceptHeld ? 'recover' : 'accept';
  },
  unavailable_challenger() {
    // Same installed operation (mint + recordChallenge) on control vs mutant.
    // Control: working challengeVerifier must succeed (no exception) and produce
    // challenge evidence. Mutant: only challengeVerifier returns ok:false.
    const fx = installedFixture('corpus-cat-challenger');
    const deliveredManifest = [{ id: 'workspace', sha256: fx.hash('ws') }];
    const manifestHash = fx.hash(deliveredManifest);
    const nowIso = fx.now;
    function challengeAdapters(challengeOk) {
      return {
        ...fx.runtime.adapters(),
        evidenceArchiver({ verified_evidence }) {
          return {
            uri: `durable://corpus-challenge/${fx.hash(verified_evidence)}`,
            sha256: fx.hash(verified_evidence),
          };
        },
        challengeVerifier(envelope, context) {
          if (!challengeOk) {
            return { ok: false, reason: 'no_qualified_challenger' };
          }
          return {
            ok: true,
            run_id: context.run_id,
            identity: 'challenger-a',
            channel: 'corpus-challenge',
            envelope_hash: fx.hash({ challenge: envelope.scope_id }),
            payload: {
              verification_path: 'qualified_challenge',
              attestation_sha256: fx.hash('attestation:challenger-a'),
              challenge_id: `corpus-challenge-${envelope.scope_id}`,
              intent_id: context.intent_id,
              scope: 'contract_leg',
              scope_id: envelope.scope_id,
              finding: 'clear',
              candidate_artifacts: deliveredManifest,
              candidate_set_hash: manifestHash,
              subject_identity: fx.profile.engine_profile.route.worker_binding.identity,
              subject_family: 'qwen',
              result_hash: fx.hash(`challenge-result:${envelope.scope_id}`),
              reviewed_at: nowIso,
            },
          };
        },
        artifactProvenanceVerifier(request, context) {
          return {
            ok: true,
            run_id: context.run_id,
            identity: fx.profile.engine_profile.route.coordinator_binding.identity,
            channel: 'corpus-provenance',
            envelope_hash: fx.hash({ provenance: request }),
            payload: {
              verification_path: 'artifact_provenance',
              attestation_sha256:
                fx.profile.engine_profile.route.coordinator_binding.attestation_hash,
              candidate_set_hash: request.candidate_set_hash,
              intent_id: context.intent_id,
              subject_identity: request.subject_identity,
              subject_family: request.subject_family,
            },
          };
        },
      };
    }
    // --- Positive control: recordChallenge succeeds ---
    const { session: controlSession } = openInstalledSession(fx, {
      runLabel: 'unavailable-challenger-control',
      adapters: challengeAdapters(true),
    });
    controlSession.kernel.mintActionDecision({
      capability: controlSession.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'chal-control' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const controlChallenge = controlSession.kernel.recordChallenge({ scope_id: 'tests' });
    assert.ok(controlChallenge && controlChallenge.payload, 'control recordChallenge must return evidence');
    assert.equal(
      controlChallenge.payload.evidence_kind,
      'challenge',
      'control recordChallenge must produce challenge evidence',
    );
    assert.equal(
      controlChallenge.payload.finding,
      'clear',
      'control challenge finding must be clear',
    );
    assert.equal(
      typeof controlChallenge.payload.challenge_id,
      'string',
      'control challenge_id must be present',
    );
    controlSession.teardown();
    // --- Mutation: only challengeVerifier unavailability ---
    const { session } = openInstalledSession(fx, {
      runLabel: 'unavailable-challenger',
      adapters: challengeAdapters(false),
    });
    session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'chal-mut' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    let code = null;
    let message = null;
    try {
      session.kernel.recordChallenge({ scope_id: 'tests' });
      assert.fail('unavailable challenger must reject');
    } catch (error) {
      code = error && error.code;
      message = String(error && error.message || '');
      assert.ok(error instanceof OwnerKernelError, 'unavailable challenger must be OwnerKernelError');
    }
    session.teardown();
    assert.equal(
      code,
      'UNVERIFIED_ENVELOPE',
      `unavailable_challenger exact code UNVERIFIED_ENVELOPE; got ${code}: ${message}`,
    );
    assert.equal(
      message,
      'challenge result was not verified by the trusted adapter',
      `unavailable_challenger exact message; got ${message}`,
    );
    return 'block';
  },
  owner_principal_swap_expiry() {
    // Isolates owner principal/capability lifecycle on the installed route:
    // (1) live capability mints, (2) capability TTL expiry rejects with
    // OWNER_CAPABILITY_EXPIRED on the first post-expiry decision attempt,
    // (3) qualification failure revokes principal to null and blocks
    // (roster exhaustion / never off-roster promotion).
    // Not an engine-profile capabilityExpiresAt compile surrogate.
    const fx = installedFixture('corpus-cat-principal');
    let nowMs = fx.runtime.NOW;
    let qualificationOk = true;
    const adapters = {
      ...fx.runtime.adapters(),
      qualificationVerifier({ principal, run_id }) {
        if (!qualificationOk) return { ok: false };
        return {
          ok: true,
          run_id,
          principal_id: principal.identity,
          attestation_sha256: principal.attestation.sha256,
        };
      },
    };

    // --- Positive control: live principal capability mints on installed session ---
    const { session: controlSession } = openInstalledSession(fx, {
      runLabel: 'principal-control',
      adapters,
      clock: () => new Date(nowMs),
    });
    assert.equal(
      controlSession.kernel.getState().active_principal.identity,
      'owner-a',
      'positive control: installed session must start with owner-a',
    );
    const liveDecision = controlSession.kernel.mintActionDecision({
      capability: controlSession.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'principal-live' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    assert.equal(liveDecision.payload.principal_id, 'owner-a');
    controlSession.teardown();

    // --- Mutation A: capability issued at NOW; clock advances past owner TTL.
    // freezeTaskAuthority asserts owner capability before host capability,
    // isolating OWNER_CAPABILITY_EXPIRED (mintActionDecision hits host first).
    nowMs = fx.runtime.NOW;
    const { session: expirySession } = openInstalledSession(fx, {
      runLabel: 'principal-expiry',
      adapters,
      clock: () => new Date(nowMs),
      nonce: 'd'.repeat(64),
    });
    const liveCapability = expirySession.owner_capability;
    assert.equal(expirySession.kernel.getState().active_principal.identity, 'owner-a');
    nowMs = fx.runtime.NOW
      + (fx.runtime.governanceConfig.governance.capability_ttl_seconds * 1000)
      + 1;
    const expiredHeld = heldNamed(
      () => expirySession.kernel.freezeTaskAuthority({
        capability: liveCapability,
        taskAuthorityInput: {
          task_authority_id: fx.hash('principal-expiry-task-authority'),
          mission_lineage_id: fx.hash('principal-expiry-lineage'),
          base_sha: 'a'.repeat(40),
        },
      }),
      {
        code: 'OWNER_CAPABILITY_EXPIRED',
        messagePattern: /owner capability has expired/,
        label: 'owner_principal_swap_expiry_capability',
      },
    );
    assert.equal(expiredHeld, true);

    // --- Mutation B: off-roster promotion is rejected (never silent promotion) ---
    const offRosterHeld = heldNamed(
      () => expirySession.kernel.activateOwner('owner-not-in-roster', 'off_roster_promotion'),
      {
        code: 'UNVERIFIED_PRINCIPAL',
        messagePattern: /outside the frozen owner roster|principalResolver/i,
        label: 'owner_principal_swap_expiry_off_roster',
      },
    );
    assert.equal(offRosterHeld, true);
    expirySession.teardown();

    // --- Mutation C: qualification failure revokes principal → blocked ---
    // Use a non-minting operation that still requires qualification after a live
    // capability was established: recordChallenge path requires active principal
    // qualification. First mint succeeds, then flip qualification and force a
    // second owner operation via submitApproval/accept that rechecks qualification.
    // Simpler: open session, fail qualification on first decision by flipping
    // before any mint (capability still valid).
    nowMs = fx.runtime.NOW;
    qualificationOk = true;
    const { session } = openInstalledSession(fx, {
      runLabel: 'principal-qualification',
      adapters,
      clock: () => new Date(nowMs),
      nonce: 'f'.repeat(64),
    });
    assert.equal(session.kernel.getState().active_principal.identity, 'owner-a');
    // Isolate the named property: flip only qualificationVerifier before first mint.
    // Capability remains live; qualification alone fails and clears principal.
    qualificationOk = false;
    const revokedHeld = heldNamed(
      () => session.kernel.mintActionDecision({
        capability: session.owner_capability,
        ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'qual-revoked' },
        actionClass: 'external',
        actionDescriptor: fx.profile.action,
      }),
      {
        code: 'OWNER_QUALIFICATION_FAILED',
        messagePattern: /authority was revoked|qualification failed/i,
        label: 'owner_principal_swap_expiry_qualification',
      },
    );
    assert.equal(revokedHeld, true);
    assert.equal(
      session.kernel.getState().active_principal,
      null,
      'qualification failure must clear active principal (zero-owner blocked)',
    );
    assert.equal(
      session.kernel.getState().status,
      'blocked',
      'qualification failure must enter blocked',
    );
    // Off-roster still cannot rescue a blocked zero-owner state.
    const stillOffRoster = heldNamed(
      () => session.kernel.activateOwner('owner-not-in-roster', 'post_revoke_promotion'),
      {
        code: 'UNVERIFIED_PRINCIPAL',
        messagePattern: /outside the frozen owner roster|principalResolver/i,
        label: 'owner_principal_swap_expiry_post_revoke',
      },
    );
    assert.equal(stillOffRoster, true);
    session.teardown();
    return 'block';
  },
  session_resume() {
    const fx = installedFixture('corpus-cat-resume');

    function capInvoke(message) {
      if (message.operation && message.operation.startsWith('capability:')) {
        const request = message.request;
        const response = {
          ok: true,
          run_id: request.run_id,
          host_capability_hash: request.host_capability_hash,
          observation_hash: fx.hash({ operation: message.operation, request }),
          probe_nonce: request.probe_nonce,
        };
        return {
          schema_version: 1,
          kind: 'p37_engine_host_response',
          profile_hash: message.profile_hash,
          route_hash: message.route_hash,
          operation: message.operation,
          request_hash: message.request_hash,
          response,
          response_hash: fx.hash(response),
        };
      }
      throw new Error('session_resume must not redispatch');
    }
    const witnessInvoke = fx.runtime.createWitnessInvoke();
    const session = installedEngine.createInstalledEngineSession({
      profile: fx.profile,
      binding: fx.installedBinding,
      durableBinding: fx.durableBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      witnessInvoke,
      engineInvoke: capInvoke,
      coordinatorInvoke: () => {
        throw new Error('session_resume must not accept');
      },
      kernelOptions: {
        initialIntentEnvelope: {
          signed: true,
          payload: { text: 'Corpus session resume', explicit_action_hashes: [] },
        },
        initialOwnerId: 'owner-a',
        adapters: fx.runtime.adapters(),
        clock: () => new Date(fx.runtime.NOW),
        nonceFactory: () => 'c'.repeat(64),
      },
    });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'resume-corpus' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const aborted = session.abortAction('corpus_session_resume_abort');
    assert.equal(aborted.status, 'aborted');
    assert.equal(aborted.decision_id, decision.payload.decision_id);
    assert.equal(session.kernel.getState().terminal_reason, 'user_abort');
    const ledger = session.kernel.getLedger();
    assert.ok(ledger.events.some((event) => event.type === 'abort'));
    const reconstructed = installedEngine.reconstructActionIdentityFromLedger(ledger);
    assert.equal(reconstructed.status, 'aborted');
    assert.equal(reconstructed.decision_id, decision.payload.decision_id);
    // Positive control: valid witnessed-ledger resume succeeds first.
    const resumed = installedEngine.resumeInstalledEngineSession({
      profile: fx.profile,
      binding: fx.installedBinding,
      durableBinding: fx.durableBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      ledger,
      priorActionIdentity: {
        decision_id: reconstructed.decision_id,
        action_hash: reconstructed.action_hash,
        claim_id: reconstructed.claim_id,
        status: reconstructed.status,
        catalog_id: reconstructed.catalog_id,
      },
      witnessInvoke,
      engineInvoke: capInvoke,
      coordinatorInvoke: () => {
        throw new Error('session_resume resume must not accept');
      },
      kernelOptions: {
        adapters: fx.runtime.adapters(),
        clock: () => new Date(fx.runtime.NOW),
        nonceFactory: () => 'd'.repeat(64),
      },
    });
    assert.equal(resumed.getActionIdentity().status, 'aborted');
    assert.equal(resumed.getActionIdentity().decision_id, decision.payload.decision_id);
    // Mutation: missing-ledger rejection is exact (not the positive control).
    const rejected = heldNamed(() => installedEngine.resumeInstalledEngineSession({
      profile: fx.profile,
      binding: fx.installedBinding,
      durableBinding: fx.durableBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
    }), {
      code: 'INVALID_INSTALLED_ENGINE',
      messagePattern: /ledger|requires the witnessed ledger/i,
      label: 'session_resume_missing_ledger',
    });
    assert.equal(rejected, true);
    // Isolated abort side-record mutation without witnessed abort events.
    assert.equal(
      heldNamed(() => installedEngine.reconstructActionIdentityFromLedger(
        { header: ledger.header, events: ledger.events.filter((e) => e.type !== 'abort') },
        session.getPersistedAbort(),
      ), {
        code: 'ENGINE_ABORT_INVALID',
        messagePattern: /abort|side record|witnessed/i,
        label: 'session_resume_abort_side_record',
      }),
      true,
    );
    session.teardown();
    resumed.teardown();
    return 'accept';
  },
  intent_amendment() {
    const fx = installedFixture('corpus-cat-intent');
    // Positive reachability: fixed action descriptor compiles.
    const live = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      action: installedEngine.fixedAction(),
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(
      live.sink_id,
      'engine-implementation-dispatch-v1',
      'positive control: fixed action must compile on installed route',
    );
    assert.equal(
      live.action_hash,
      sha256(canonicalJson(installedEngine.fixedAction())),
      'positive control: compiled action_hash must match fixed action',
    );
    // Exact named rejection for amended targets — not any exception.
    const blocked = heldNamed(
      () => installedEngine.compileInstalledEngineProfile({
        binding: fx.installedBinding,
        action: {
          operation: 'engine_implementation_dispatch',
          tool_class: 'model_runner',
          targets: ['autopilot-engine:implementation-dispatch', 'extra'],
        },
        governanceConfig: fx.runtime.governanceConfig,
        acceptanceContract,
        routeInputs: fx.runtime.routeInputs,
        durableBinding: fx.durableBinding,
        capabilityProbedAt: fx.now,
        capabilityExpiresAt: fx.expires,
      }),
      {
        code: 'ENGINE_SINK_REJECTED',
        messagePattern: /action descriptor|substitute|sink/i,
        label: 'intent_amendment',
      },
    );
    return blocked ? 'block' : 'accept';
  },
  event_log_tampering() {
    // Isolated mutation: mutate actual ledger events (not profile hashes) and
    // require rejection through the installed resume/verification route.
    const fx = installedFixture('corpus-cat-tamper');
    const { session, witnessInvoke } = openInstalledSession(fx, { runLabel: 'event-log-tamper' });
    session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'tamper-base' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const ledger = structuredClone(session.kernel.getLedger());
    assert.ok(Array.isArray(ledger.events) && ledger.events.length > 0);
    const decisionIdx = ledger.events.findIndex((event) => event.type === 'decision');
    const targetIndex = decisionIdx >= 0 ? decisionIdx : ledger.events.length - 1;
    const original = ledger.events[targetIndex];
    ledger.events[targetIndex] = {
      ...original,
      payload: {
        ...(original.payload || {}),
        decision_id: `${(original.payload && original.payload.decision_id) || 'decision'}-tampered`,
        text: 'event-log-tampered-payload',
      },
      // Break the event hash chain while keeping a plausible shape.
      event_hash: 'a'.repeat(64),
      previous_hash: original.previous_hash,
    };
    const rejectedResume = heldNamed(() => installedEngine.resumeInstalledEngineSession({
      binding: fx.installedBinding,
      profile: fx.profile,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      kernelBinding: fx.kernelBinding,
      ledger,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
      witnessInvoke,
      engineInvoke: capabilityOnlyInvoke(fx),
      coordinatorInvoke: () => {
        throw new Error('tampered ledger must not accept');
      },
      kernelOptions: {
        adapters: fx.runtime.adapters(),
        clock: () => new Date(fx.runtime.NOW),
        nonceFactory: () => 'e'.repeat(64),
      },
    }), {
      code: 'INVALID_OWNER_EVENT',
      messagePattern: /unsupported key|event|hash|tamper|witness/i,
      label: 'event_log_tampering',
    });
    session.teardown();
    assert.equal(rejectedResume, true, 'event-log tampering must be rejected by installed resume');
    return rejectedResume ? 'reject' : 'accept';
  },
  unknown_decision_class() {
    const fx = installedFixture('corpus-cat-unknown');
    // Control: default catalog compiles.
    const control = installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    });
    assert.equal(control.sink_id, 'engine-implementation-dispatch-v1');
    // Mutation: only action_class on the existing catalog entry.
    const baseEntry = fx.runtime.governanceConfig.governance.action_catalog[0];
    const blocked = heldNamed(
      () => installedEngine.compileInstalledEngineProfile({
        binding: fx.installedBinding,
        governanceConfig: {
          ...fx.runtime.governanceConfig,
          governance: {
            ...fx.runtime.governanceConfig.governance,
            action_catalog: [{
              ...baseEntry,
              action_class: 'unknown_class',
            }],
          },
        },
        acceptanceContract,
        routeInputs: fx.runtime.routeInputs,
        durableBinding: fx.durableBinding,
        capabilityProbedAt: fx.now,
        capabilityExpiresAt: fx.expires,
      }),
      {
        code: 'INSTALLED_BINDING_MISMATCH',
        messagePattern: /action_class must be one of/i,
        label: 'unknown_decision_class',
      },
    );
    return blocked ? 'escalate' : 'accept';
  },
};

const attackDefinitions = [
  {
    id: 'protected_event_envelope_forgery',
    marker: '"protected_event_envelope_forgery":"held"',
    oracle: 'installed route binds authenticated handoff and exact semantic route; forgery is held',
  },
  {
    id: 'direct_decision_append',
    marker: '"direct_decision_append":"held"',
    oracle: 'installed Kernel APIs only mint decisions under the current capability',
  },
  {
    id: 'worker_artifact_decision_injection',
    marker: '"worker_artifact_decision_injection":"held"',
    oracle: 'delegation is bound to the intake-frozen worker; worker output is evidence only',
  },
  {
    id: 'child_process_capability_theft',
    marker: '"child_process_capability_theft":"held"',
    oracle: 'executor, capability verifier, broker, receipt verifier, and witness bindings are independent',
  },
  {
    id: 'policy_kernel_mutation',
    marker: '"policy_kernel_mutation":"held"',
    oracle: 'route, policy, contract, handoff, cohort, and immutable base hashes must agree',
  },
  {
    id: 'mediated_action_bypass',
    marker: '"mediated_action_bypass":"held"',
    oracle: 'the only Engine effect requires claim, permit, post-claim authorization, broker receipt, and verification',
  },
  {
    id: 'capability_set_drift',
    marker: '"capability_set_drift":"held"',
    oracle: 'the one Engine sink inventory, catalog row, route, receipt root, and mode override are frozen',
  },
  {
    id: 'witness_head_rewrite',
    marker: '"witness_head_rewrite":"held"',
    oracle: 'compare-and-append, authoritative readback, independent receipt anchor, and resume replay detect drift',
  },
];

const categoryExpected = Object.fromEntries(
  baseline.categories.map((category) => [category.id, category.expected_outcome]),
);

(async () => {
const attackResults = {};
for (const attack of attackDefinitions) {
  const mutationHeld = await attackMutations[attack.id]();
  assert.equal(mutationHeld, true, `${attack.id} installed route mutation must hold`);
  attackResults[attack.id] = 'held';
}

const categoryResults = {};
for (const category of baseline.categories) {
  const observed = await categoryMutations[category.id]();
  assert.equal(
    observed,
    categoryExpected[category.id],
    `${category.id} installed route mutation must observe ${categoryExpected[category.id]}`,
  );
  categoryResults[category.id] = observed;
}

const scenarioMarkers = {
  attacks: attackResults,
  baseline_categories: categoryResults,
};
const markerPayload = JSON.stringify(scenarioMarkers);
for (const attack of attackDefinitions) {
  assert.ok(
    markerPayload.includes(`"${attack.id}":"held"`),
    `${attack.id} marker emitted only after mutation`,
  );
}
for (const category of baseline.categories) {
  assert.ok(
    markerPayload.includes(`"${category.id}":"${category.expected_outcome}"`),
    `${category.id} marker emitted only after mutation`,
  );
}

function evidence(id, marker) {
  return {
    gate: 'installed_route_mutation',
    gate_marker: gates.installed.marker,
    scenario_marker: marker,
    mutation_executed: true,
    evidence_hash: sha256(canonicalJson({
      id,
      gate: 'installed_route_mutation',
      marker: gates.installed.marker,
      scenario_marker: marker,
      mutation_executed: true,
      scenario_markers: scenarioMarkers,
    })),
  };
}

const material = {
  schema_version: 1,
  kind: 'p37_installed_owner_kernel_authority_corpus_report',
  status: 'installed_authority_protocol_pass',
  execution_scope: 'installed_engine_route',
  installed_engine_sink: 'engine-implementation-dispatch-v1',
  privileged_host_evidence: 'p37_installed_engine_vertical',
  supporting_protocol_gates: Object.keys(gates).filter((id) => id !== 'installed'),
  attacks: attackDefinitions.map((attack) => ({
    id: attack.id,
    outcome: 'held',
    oracle: attack.oracle,
    ...evidence(attack.id, attack.marker),
  })),
  baseline_categories: baseline.categories.map((category) => ({
    id: category.id,
    expected_outcome: category.expected_outcome,
    observed_outcome: categoryResults[category.id],
    ...evidence(category.id, `"${category.id}":"${category.expected_outcome}"`),
  })),
};
const report = {
  ...material,
  report_hash: sha256(canonicalJson(material)),
};

function validate(candidate) {
  assert.equal(candidate.schema_version, 1);
  assert.equal(candidate.kind, 'p37_installed_owner_kernel_authority_corpus_report');
  assert.equal(candidate.status, 'installed_authority_protocol_pass');
  assert.equal(candidate.execution_scope, 'installed_engine_route');
  assert.equal(candidate.installed_engine_sink, 'engine-implementation-dispatch-v1');
  const reportMaterial = { ...candidate };
  delete reportMaterial.report_hash;
  assert.equal(candidate.report_hash, sha256(canonicalJson(reportMaterial)));
  assert.deepEqual(
    candidate.attacks.map((attack) => attack.id),
    attackDefinitions.map((attack) => attack.id),
  );
  assert.deepEqual(
    candidate.baseline_categories.map((category) => category.id),
    baseline.categories.map((category) => category.id),
  );
  for (const [index, attack] of candidate.attacks.entries()) {
    const expected = attackDefinitions[index];
    assert.equal(attack.outcome, 'held');
    assert.equal(attack.mutation_executed, true);
    assert.equal(attack.oracle, expected.oracle);
    assert.equal(attack.scenario_marker, expected.marker);
    assert.equal(
      attack.evidence_hash,
      evidence(attack.id, attack.scenario_marker).evidence_hash,
    );
  }
  for (const [index, category] of candidate.baseline_categories.entries()) {
    const expected = baseline.categories[index];
    assert.equal(category.expected_outcome, expected.expected_outcome);
    assert.equal(category.observed_outcome, expected.expected_outcome);
    assert.equal(category.mutation_executed, true);
    assert.equal(
      category.evidence_hash,
      evidence(category.id, category.scenario_marker).evidence_hash,
    );
  }
  assert.equal(JSON.stringify(candidate).includes('not_applicable'), false);
  return true;
}

function rehash(candidate) {
  const value = structuredClone(candidate);
  const valueMaterial = { ...value };
  delete valueMaterial.report_hash;
  value.report_hash = sha256(canonicalJson(valueMaterial));
  return value;
}

validate(report);
for (let index = 0; index < report.attacks.length; index += 1) {
  const mutated = structuredClone(report);
  mutated.attacks[index].outcome = 'unknown';
  assert.throws(() => validate(rehash(mutated)));
  const evidenceMutation = structuredClone(report);
  evidenceMutation.attacks[index].evidence_hash = '0'.repeat(64);
  assert.throws(() => validate(rehash(evidenceMutation)));
}
for (let index = 0; index < report.baseline_categories.length; index += 1) {
  const mutated = structuredClone(report);
  mutated.baseline_categories[index].observed_outcome = 'not_executed';
  assert.throws(() => validate(rehash(mutated)));
  const evidenceMutation = structuredClone(report);
  evidenceMutation.baseline_categories[index].evidence_hash = '0'.repeat(64);
  assert.throws(() => validate(rehash(evidenceMutation)));
}

console.log(JSON.stringify({
  status: report.status,
  execution_scope: report.execution_scope,
  installed_engine_sink: report.installed_engine_sink,
  attacks_executed: report.attacks.length,
  categories_executed: report.baseline_categories.length,
  not_applicable: 0,
  behavior_oracles: report.attacks.length + report.baseline_categories.length,
  report_integrity_mutations: (report.attacks.length + report.baseline_categories.length) * 2,
  scenario_specific_installed_mutations: true,
  scenario_markers: scenarioMarkers,
  report_hash: report.report_hash,
}));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "U6 installed production-code corpus report validates"
assert_contains "$OUT" '"status":"installed_authority_protocol_pass"' "installed corpus records the installed authority-protocol verdict"
assert_contains "$OUT" '"execution_scope":"installed_engine_route"' "corpus executes against the installed Engine route"
assert_contains "$OUT" '"installed_engine_sink":"engine-implementation-dispatch-v1"' "corpus binds the single installed Engine sink"
assert_contains "$OUT" '"attacks_executed":8' "all eight named attacks have explicit executed evidence"
assert_contains "$OUT" '"categories_executed":15' "all fifteen frozen baseline categories have explicit executed evidence"
assert_contains "$OUT" '"not_applicable":0' "no corpus row is hidden as not applicable"
assert_contains "$OUT" '"behavior_oracles":23' "every attack and category has its own executed scenario marker"
assert_contains "$OUT" '"report_integrity_mutations":46' "every report row rejects outcome and evidence mutation"
assert_contains "$OUT" '"scenario_specific_installed_mutations":true' "corpus executed scenario-specific installed mutations"
assert_contains "$OUT" '"protected_event_envelope_forgery":"held"' "attack mutation marker after execution"
assert_contains "$OUT" '"low_risk_executable":"accept"' "category mutation marker after execution"

finalize_test
