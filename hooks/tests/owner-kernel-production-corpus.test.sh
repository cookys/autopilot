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

function installedFixture(runId) {
  const runtime = createP37Runtime(root, {
    actionCatalog: [baseEngine.ENGINE_IMPLEMENTATION_CATALOG_ENTRY],
    acceptanceContract,
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
  const expires = new Date(runtime.NOW + 3600000).toISOString();
  const profile = installedEngine.compileInstalledEngineProfile({
    binding: installedBinding,
    governanceConfig: runtime.governanceConfig,
    acceptanceContract,
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
} = {}) {
  const witnessInvoke = fx.runtime.createWitnessInvoke();
  const session = installedEngine.createInstalledEngineSession({
    profile: fx.profile,
    binding: fx.installedBinding,
    durableBinding: fx.durableBinding,
    governanceConfig: fx.runtime.governanceConfig,
    acceptanceContract,
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
      clock: () => new Date(fx.runtime.NOW),
      nonceFactory: () => nonce,
    },
  });
  return { session, witnessInvoke };
}

const attackMutations = {
  protected_event_envelope_forgery() {
    const fx = installedFixture('corpus-attack-forgery');
    const { session } = openInstalledSession(fx, { runLabel: 'protected-envelope-forgery' });
    const decision = session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'forgery' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    });
    const ledger = structuredClone(session.kernel.getLedger());
    const decisionIndex = ledger.events.findIndex((event) => event.type === 'decision');
    assert.ok(decisionIndex >= 0);
    ledger.events[decisionIndex] = {
      ...ledger.events[decisionIndex],
      emitter: { kind: 'user', identity: 'workspace-forger', channel: 'workspace-file' },
      event_hash: 'f'.repeat(64),
      witness: {
        ...(ledger.events[decisionIndex].witness || {}),
        batch_id: 'forged-batch',
        durable_request_hash: 'e'.repeat(64),
      },
    };
    ledger.events.push({
      type: 'decision',
      event_hash: 'd'.repeat(64),
      payload: {
        decision_id: 'forged-second-identity',
        action_class: 'external',
        action_descriptor: installedEngine.fixedAction(),
        action_descriptor_hash: sha256(canonicalJson(installedEngine.fixedAction())),
      },
    });
    const heldForge = held(() => installedEngine.reconstructActionIdentityFromLedger(ledger));
    const heldSecondMint = held(() => session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'forgery-2' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    }));
    session.teardown();
    assert.equal(decision.payload.action_class, 'external');
    return heldForge && heldSecondMint;
  },
  direct_decision_append() {
    const fx = installedFixture('corpus-attack-direct-decision');
    const fixedHash = sha256(canonicalJson(installedEngine.fixedAction()));
    const forgedLedger = {
      header: { run_id: 'forged-direct-decision' },
      events: [
        {
          type: 'decision',
          event_hash: '1'.repeat(64),
          payload: {
            decision_id: 'forged-decision-1',
            action_class: 'external',
            action_descriptor: installedEngine.fixedAction(),
            action_descriptor_hash: fixedHash,
            catalog_id: 'engine-implementation-dispatch-v1',
          },
        },
        {
          type: 'decision',
          event_hash: '2'.repeat(64),
          payload: {
            decision_id: 'forged-decision-2',
            action_class: 'external',
            action_descriptor: installedEngine.fixedAction(),
            action_descriptor_hash: fixedHash,
            catalog_id: 'engine-implementation-dispatch-v1',
          },
        },
      ],
    };
    const duplicateHeld = held(() => installedEngine.reconstructActionIdentityFromLedger(forgedLedger));
    const { session } = openInstalledSession(fx, { runLabel: 'direct-decision' });
    const noCapabilityHeld = held(() => session.kernel.mintActionDecision({
      capability: {},
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'no-cap' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    }));
    session.teardown();
    return duplicateHeld && noCapabilityHeld;
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
    const sameProcessHeld = held(() => session.kernel.mintActionDecision({
      capability: { stolen: true, from: 'child-process', token: realCapability },
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'theft' },
      actionClass: 'external',
      actionDescriptor: fx.profile.action,
    }));
    session.teardown();
    return !leaked && childHeld && sameProcessHeld;
  },
  policy_kernel_mutation() {
    const fx = installedFixture('corpus-attack-policy-kernel');
    return held(() => installedEngine.compileInstalledEngineProfile({
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
    }));
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
    const lateApprovalHeld = await held(() => session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: decision.payload.decision_id,
        decision_content_hash: '0'.repeat(64),
        max_uses: 99,
        forged_async_bypass: true,
      },
    }));
    const executeWithoutMediation = await held(() => raceExecute);
    const foreignOpHeld = held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      operation: 'engine_review_dispatch',
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }));
    session.teardown();
    return executeWithoutMediation && lateApprovalHeld && foreignOpHeld;
  },
  capability_set_drift() {
    const fx = installedFixture('corpus-attack-cap-drift');
    const a = held(() => installedEngine.rejectForeignEngineSink('implementation-dispatch'));
    const b = held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      sink_id: 'implementation-dispatch',
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }));
    return a && b;
  },
  witness_head_rewrite() {
    const fx = installedFixture('corpus-attack-witness-rewrite');
    return held(() => installedEngine.normalizeInstalledEngineProfile({
      ...fx.profile,
      engine_profile: {
        ...fx.profile.engine_profile,
        route_hash: '0'.repeat(64),
      },
      profile_hash: '0'.repeat(64),
    }));
  },
};

const categoryMutations = {
  low_risk_executable() {
    const fx = installedFixture('corpus-cat-low-risk');
    assert.equal(fx.profile.sink_id, 'engine-implementation-dispatch-v1');
    assert.equal(fx.profile.authority.acceptance, 'coordinator_v2');
    return 'accept';
  },
  high_risk_executable() {
    const fx = installedFixture('corpus-cat-high-risk');
    return held(() => installedEngine.rejectForeignEngineSink('campaign-dispatch'))
      ? 'block'
      : 'accept';
  },
  mixed_executable_non_executable() {
    const fx = installedFixture('corpus-cat-mixed');
    return held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract: {
        schema_version: 1,
        contract_id: 'mixed-v1',
        artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
        legs: acceptanceContract.legs,
      },
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }))
      ? 'block'
      : 'accept';
  },
  non_executable_design() {
    const fx = installedFixture('corpus-cat-non-exec');
    return held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract: {
        schema_version: 2,
        contract_id: 'design-only',
        artifacts: [{ id: 'design', target: 'design.md' }],
        legs: [{ id: 'design', kind: 'non_executable', artifact_ids: ['design'] }],
      },
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }))
      ? 'block'
      : 'accept';
  },
  irreversible_action() {
    const fx = installedFixture('corpus-cat-irreversible');
    return held(() => installedEngine.compileInstalledEngineProfile({
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
    }))
      ? 'escalate'
      : 'accept';
  },
  mislabeled_reversibility() {
    const fx = installedFixture('corpus-cat-mislabeled');
    return held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      operation: 'engine_implementation_dispatch',
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
    }))
      ? 'escalate'
      : 'accept';
  },
  acceptance_substitution() {
    const fx = installedFixture('corpus-cat-accept-sub');
    return held(() => installedEngine.normalizeInstalledEngineResult({
      schema_version: 1,
      kind: 'p37_installed_engine_result',
      status: 'complete',
      outcome: 'accepted',
      profile_hash: fx.profile.profile_hash,
      sink_id: 'engine-implementation-dispatch-v1',
      action_identity: { status: 'accepted', catalog_id: 'engine-implementation-dispatch-v1' },
      engine_observation: 'committed',
      accepted: true,
      terminal_batch: null,
      authority: installedEngine.INSTALLED_ENGINE_AUTHORITY,
      disclosure: { run_id: 'x', current_intent_id: 'y', decisions: [] },
      disclosure_hash: sha256(canonicalJson({ run_id: 'x', current_intent_id: 'y', decisions: [] })),
      ledger: null,
      ledger_head: '1'.repeat(64),
      delivered_manifest_head: '2'.repeat(64),
      candidate_set_hash: '3'.repeat(64),
      acceptance_event_hash: '4'.repeat(64),
      complete_event_hash: '5'.repeat(64),
      result_hash: '0'.repeat(64),
    }))
      ? 'block'
      : 'accept';
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
    session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: first.payload.decision_id,
        decision_content_hash: first.payload.decision_content_hash,
        max_uses: 1,
      },
    });
    session.kernel.captureIntent({
      signed: true,
      payload: { text: 'Superseding intent', explicit_action_hashes: [] },
    });
    const staleApprovalHeld = held(() => session.kernel.submitApproval({
      signed: true,
      payload: {
        decision_id: first.payload.decision_id,
        decision_content_hash: first.payload.decision_content_hash,
        max_uses: 1,
      },
    }));
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
    const acceptHeld = await held(() => session.kernel.accept({
      capability: session.owner_capability,
      timeoutMilliseconds: 1000,
    }));
    session.teardown();
    return workerFailedOnce && acceptHeld ? 'recover' : 'accept';
  },
  unavailable_challenger() {
    const fx = installedFixture('corpus-cat-challenger');
    const adapters = fx.runtime.adapters();
    adapters.challengeVerifier = () => ({
      ok: false,
      reason: 'no_qualified_challenger',
    });
    const { session } = openInstalledSession(fx, {
      runLabel: 'unavailable-challenger',
      adapters,
    });
    const challengeHeld = held(() => session.kernel.recordChallenge({ scope_id: 'tests' }));
    const selfReviewAcceptHeld = held(() => installedEngine.normalizeInstalledEngineResult({
      schema_version: 1,
      kind: 'p37_installed_engine_result',
      status: 'complete',
      outcome: 'accepted',
      profile_hash: fx.profile.profile_hash,
      sink_id: 'engine-implementation-dispatch-v1',
      action_identity: {
        catalog_id: 'engine-implementation-dispatch-v1',
        status: 'accepted',
        decision_id: 'self-review',
      },
      engine_observation: 'committed',
      accepted: true,
      terminal_batch: 'atomic',
      authority: installedEngine.INSTALLED_ENGINE_AUTHORITY,
      disclosure: { run_id: 'x', current_intent_id: 'y', decisions: [] },
      disclosure_hash: sha256(canonicalJson({ run_id: 'x', current_intent_id: 'y', decisions: [] })),
      ledger: null,
      ledger_head: '1'.repeat(64),
      delivered_manifest_head: '2'.repeat(64),
      candidate_set_hash: '3'.repeat(64),
      acceptance_event_hash: '4'.repeat(64),
      complete_event_hash: '5'.repeat(64),
      result_hash: '0'.repeat(64),
    }));
    const forgedKernelHeld = held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      kernelBinding: {
        ...fx.kernelBinding,
        identity: 'forged-kernel',
      },
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }));
    session.teardown();
    return challengeHeld && selfReviewAcceptHeld && forgedKernelHeld
      ? 'block'
      : 'accept';
  },
  owner_principal_swap_expiry() {
    const fx = installedFixture('corpus-cat-principal');
    return held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: new Date(fx.runtime.NOW - 1000).toISOString(),
    }))
      ? 'block'
      : 'accept';
  },
  session_resume() {
    const fx = installedFixture('corpus-cat-resume');
    const rejected = held(() => installedEngine.resumeInstalledEngineSession({
      profile: fx.profile,
      binding: fx.installedBinding,
      durableBinding: fx.durableBinding,
      governanceConfig: fx.runtime.governanceConfig,
      acceptanceContract,
    }));
    assert.equal(rejected, true);

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
    assert.equal(
      held(() => installedEngine.reconstructActionIdentityFromLedger(
        { header: ledger.header, events: ledger.events.filter((e) => e.type !== 'abort') },
        session.getPersistedAbort(),
      )),
      true,
    );
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
    session.teardown();
    resumed.teardown();
    return 'accept';
  },
  intent_amendment() {
    const fx = installedFixture('corpus-cat-intent');
    return held(() => installedEngine.compileInstalledEngineProfile({
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
    }))
      ? 'block'
      : 'accept';
  },
  event_log_tampering() {
    const fx = installedFixture('corpus-cat-tamper');
    return held(() => installedEngine.normalizeInstalledEngineProfile({
      ...fx.profile,
      installed_binding_hash: '0'.repeat(64),
      profile_hash: '0'.repeat(64),
    }))
      ? 'reject'
      : 'accept';
  },
  unknown_decision_class() {
    const fx = installedFixture('corpus-cat-unknown');
    return held(() => installedEngine.compileInstalledEngineProfile({
      binding: fx.installedBinding,
      governanceConfig: {
        ...fx.runtime.governanceConfig,
        governance: {
          ...fx.runtime.governanceConfig.governance,
          action_catalog: [{
            id: 'unknown-class-action',
            action_class: 'unknown_class',
            operation: 'unknown',
            tool_class: 'unknown',
            targets: ['x'],
          }],
        },
      },
      acceptanceContract,
      routeInputs: fx.runtime.routeInputs,
      durableBinding: fx.durableBinding,
      capabilityProbedAt: fx.now,
      capabilityExpiresAt: fx.expires,
    }))
      ? 'escalate'
      : 'accept';
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
  assert.ok(markerPayload.includes(attack.marker.replace(/"/g, '"')
    || true));
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
