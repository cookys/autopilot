#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = process.argv[2];
const engine = require(path.join(root, 'src', 'engine'));
const durable = require(path.join(
  root,
  'src',
  'engine',
  'supervised-production-substrate-durable-contract',
));

const { canonicalJson, cloneCanonical, sha256 } = engine;
const NOW = 2000000000000;
const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const bindHash = (value, field) => ({ ...value, [field]: hash(value) });

function roster(identity, role, family) {
  return {
    identity,
    model_alias: `${identity}-model`,
    model_version: '1',
    family,
    runner: `${identity}-runner`,
    role,
    attestation: {
      issuer: 'p37-attestor',
      uri: `test://${identity}`,
      sha256: hash(`attestation:${identity}`),
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2035-01-01T00:00:00.000Z',
    },
  };
}

const governanceConfig = {
  schema_version: 1,
  governance: {
    default_mode: 'owner-led',
    owner_roster: [roster('owner-a', 'owner', 'openai')],
    challenger_roster: [roster('challenger-a', 'challenger', 'minimax')],
    trusted_runner_roster: [roster('runner-a', 'trusted_runner', 'kernel')],
    approval_policy: {
      read_only: { requires_approval: false, max_uses: 1 },
      reversible: { requires_approval: false, max_uses: 1 },
      external: { requires_approval: true, max_uses: 1 },
      irreversible: { requires_approval: true, max_uses: 1 },
    },
    action_catalog: [],
    capability_ttl_seconds: 3600,
    checkpoint_interval_closed_events: 3,
    max_blocked_duration_seconds: 86400,
  },
};

const acceptanceContract = {
  schema_version: 1,
  contract_id: 'p37-semantic-only',
  legs: [{
    id: 'semantic-output',
    kind: 'non_executable',
    artifact_hashes: [hash('semantic-output')],
  }],
};

const policyHash = engine.resolveGovernancePolicy(governanceConfig).policy_hash;
const contractHash = engine.freezeAcceptanceContract(acceptanceContract).contract_hash;
const bridgePlanHash = hash('p35-bridge-plan');
const p35InstallHash = hash('p35-install');
const immutableBase = 'a'.repeat(40);
const cgroups = Object.fromEntries(
  ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']
    .map((role) => [role, `/autopilot.slice/p37-${role}.service`]),
);

const serviceBindings = Object.fromEntries(
  ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']
    .map((role, index) => [role, {
      role,
      identity: `p37-${role}`,
      uid: 71000 + index,
      gid: 72000 + index,
      attestation_hash: hash(`service-attestation:${role}`),
      cgroup_binding_hash: hash(cgroups[role]),
    }]),
);
const kernelBinding = {
  role: 'kernel',
  identity: 'p37-kernel',
  uid: 70000,
  gid: 70001,
  attestation_hash: hash('service-attestation:kernel'),
  cgroup_binding_hash: hash('/autopilot.slice/p37-kernel.service'),
};

const trustedBinding = {
  schema_version: 2,
  owner_run_id: 'p37-semantic-run',
  engine_run_id: 'p37-semantic-run',
  invocation_id: 'p37-semantic-invocation',
  policy_hash: policyHash,
  contract_hash: contractHash,
  immutable_base: immutableBase,
  workspace_registration_id: 'p37-workspace',
  workspace_root_hash: hash('workspace-root'),
  workspace_descriptor_binding_hash: hash('descriptor-binding'),
  workspace_ticket_hash: hash('workspace-ticket'),
  prompt_hash: hash('prompt'),
  branch_hash: hash('branch'),
  verify_command_hash: hash('verify'),
  sink_inventory_hash: hash(engine.getAutopilotEngineControlSinkInventory()),
  bridge_abi_hash: engine.getSupervisedEngineBridgeAbiHash(2),
};

const verifiedIntake = {
  schema_version: 1,
  verified: true,
  intake_protocol_version: 2,
  replay_status: 'fresh',
  session_id: 'p37-session',
  session_challenge_hash: hash('session-challenge'),
  install_binding_hash: p35InstallHash,
  issuer: 'p37-intake',
  key_id: 'p37-key',
  attestation_hash: hash('intake-attestation'),
  envelope_hash: hash('intake-envelope'),
  replay_fingerprint: hash('replay'),
  issued_at_ms: NOW,
  not_before_ms: NOW,
  expires_at_ms: NOW + 60000,
  trusted_intake_binding: trustedBinding,
  bridge_plan_hash: bridgePlanHash,
  bridge_receipt_hash: hash('bridge-receipt'),
  authenticated_receipt_hash: hash('authenticated-receipt'),
};

const substratePlan = engine.compileSupervisedProductionSubstrateContract({
  schema_version: 1,
  trusted_intake_envelope: { fixture: true },
  service_bindings: serviceBindings,
}, {
  trustedIntakeAuthority: {
    issuer: verifiedIntake.issuer,
    key_id: verifiedIntake.key_id,
    attestation_hash: verifiedIntake.attestation_hash,
    install_binding_hash: p35InstallHash,
  },
  trustedIntakeVerifier() {
    return cloneCanonical(verifiedIntake);
  },
  now: () => NOW,
});

const handoffMaterial = {
  schema_version: 1,
  kind: 'p36_root_verified_intake_handoff',
  handoff_id: 'p37-handoff',
  p35_install_binding_hash: p35InstallHash,
  session_id: verifiedIntake.session_id,
  session_challenge_hash: verifiedIntake.session_challenge_hash,
  intake_protocol_version: 2,
  ticket_hash: trustedBinding.workspace_ticket_hash,
  descriptor_binding_hash: trustedBinding.workspace_descriptor_binding_hash,
  workspace_root_hash: trustedBinding.workspace_root_hash,
  immutable_base: immutableBase,
  issuer: verifiedIntake.issuer,
  key_id: verifiedIntake.key_id,
  attestation_hash: verifiedIntake.attestation_hash,
  gateway_receipt_hash: verifiedIntake.envelope_hash,
  bridge_plan_hash: bridgePlanHash,
  bridge_receipt_hash: verifiedIntake.bridge_receipt_hash,
  authenticated_receipt_hash: verifiedIntake.authenticated_receipt_hash,
  issued_at_ms: NOW,
  expires_at_ms: NOW + 60000,
};
const verifiedHandoff = {
  ...handoffMaterial,
  handoff_hash: hash(handoffMaterial),
};

const p36InstallHash = hash('p36-install');
const runBinding = {
  schema_version: 1,
  kind: 'p36_durable_run_binding',
  p36_install_binding_hash: p36InstallHash,
  p35_handoff_hash: verifiedHandoff.handoff_hash,
  p35_install_binding_hash: p35InstallHash,
  bridge_plan_hash: bridgePlanHash,
  cohort_id: 'p37-cohort',
  generation: 1,
  services: Object.values(serviceBindings).map((service) => ({
    role: service.role,
    identity: service.identity,
    uid: service.uid,
    gid: service.gid,
    attestation_hash: service.attestation_hash,
    unit: `p37-${service.role}.service`,
    cgroup_path: cgroups[service.role],
  })),
};
const runBindingHash = hash(runBinding);
const durableBinding = {
  schema_version: 1,
  kind: 'p36_durable_state_binding',
  install_binding_hash: p36InstallHash,
  run_binding_hash: runBindingHash,
  substrate_abi_hash: substratePlan.substrate_abi_hash,
  substrate_plan_hash: bridgePlanHash,
  durable_abi_hash: durable.getSupervisedProductionDurableAbiHash(),
  cohort_id: runBinding.cohort_id,
  generation: runBinding.generation,
  service_bindings: serviceBindings,
};
const claimMaterial = {
  schema_version: 1,
  kind: 'p36_root_verified_intake_handoff_claim',
  handoff_id: verifiedHandoff.handoff_id,
  handoff_hash: verifiedHandoff.handoff_hash,
  claimed_at_ms: NOW + 1,
  p36_install_binding_hash: p36InstallHash,
  p36_run_binding_hash: runBindingHash,
  durable_binding_hash: hash(durableBinding),
  cohort_id: runBinding.cohort_id,
  generation: runBinding.generation,
};
const handoffClaim = { ...claimMaterial, claim_hash: hash(claimMaterial) };

const routeInputs = {
  verifiedHandoff,
  handoffClaim,
  runBinding,
  durableBinding,
  substratePlan,
  governanceConfig,
  acceptanceContract,
  kernelBinding,
};

const route = engine.compileSemanticWitnessRoute(routeInputs);
assert.equal(route.owner_kernel_authority, 'semantic_only');
assert.equal(route.p36_contract_plan_hash, substratePlan.substrate_plan_hash);
assert.equal(route.kernel_binding.role, 'kernel');
assert.equal(route.worker_binding.role, 'worker');
assert.equal(route.receipt_verifier_binding.role, 'receipt_verifier');
assert.equal(route.witness_binding.role, 'witness');
assert.throws(
  () => engine.assertSemanticRouteFresh(route, () => new Date(verifiedHandoff.expires_at_ms + 1)),
  /fresh exclusively claimed handoff/,
);

function createTransport() {
  let head = null;
  let journal = hash('witness-journal-genesis');
  const records = [];
  const anchors = new Map();
  let tornDown = false;

  function commonResult(request, envelopeHash, status, code) {
    const responder = durableBinding.service_bindings.witness;
    return {
      schema_version: 1,
      kind: 'p36_durable_witness_result',
      status,
      code,
      request_id: request.request_id,
      operation: request.operation,
      install_binding_hash: durableBinding.install_binding_hash,
      run_binding_hash: durableBinding.run_binding_hash,
      substrate_abi_hash: durableBinding.substrate_abi_hash,
      substrate_plan_hash: durableBinding.substrate_plan_hash,
      durable_abi_hash: durableBinding.durable_abi_hash,
      cohort_id: durableBinding.cohort_id,
      generation: durableBinding.generation,
      request_hash: hash(request),
      request_envelope_hash: envelopeHash,
      responder_role: 'witness',
      responder_identity: responder.identity,
      responder_attestation_hash: responder.attestation_hash,
      responder_cgroup_binding_hash: responder.cgroup_binding_hash,
      owner_kernel_authority: 'none',
      effect_authority: 'none',
      broker_authority: 'disabled',
      acceptance: 'not_available',
    };
  }

  function resultHash(value) {
    const material = { ...value };
    delete material.result_hash;
    return { ...value, result_hash: hash(material) };
  }

  function anchorProof(routeHash, requestHash, witnessResult) {
    const anchorMaterial = {
      route_hash: routeHash,
      request_hash: requestHash,
      witness_result_hash: witnessResult.result_hash,
    };
    const anchorRecordHash = hash(anchorMaterial);
    anchors.set(requestHash, anchorRecordHash);
    const material = {
      schema_version: 1,
      kind: 'p37_semantic_receipt_anchor_proof',
      route_hash: routeHash,
      request_hash: requestHash,
      witness_result_hash: witnessResult.result_hash,
      anchor_record_hash: anchorRecordHash,
      verified: true,
    };
    return { ...material, proof_hash: hash(material) };
  }

  return function invoke(message) {
    assert.equal(message.route_hash, hash(route));
    if (message.operation === 'teardown') {
      tornDown = true;
      return { ok: true, route_hash: message.route_hash };
    }
    if (tornDown) tornDown = false;
    if (message.operation === 'verifyReceipt') {
      const anchorRecordHash = anchors.get(message.request.durable_request_hash);
      const material = {
        schema_version: 1,
        kind: 'p37_semantic_anchor_verification',
        route_hash: message.route_hash,
        operation: 'verifyReceipt',
        verified: anchorRecordHash === message.request.receipt_anchor_hash,
        request_hash: message.request.durable_request_hash,
        anchor_record_hash: anchorRecordHash,
      };
      return { ...material, proof_hash: hash(material) };
    }

    const request = message.request;
    const envelopeHash = hash({
      route_hash: message.route_hash,
      operation: message.operation,
      request,
      sender: serviceBindings.receipt_verifier,
      recipient: serviceBindings.witness,
    });
    let selected = [];
    let status = 'available';
    let code = 'WITNESS_AVAILABLE';
    if (message.operation === 'appendIfHead') {
      assert.equal(request.expected_head, head);
      status = 'recorded';
      code = 'WITNESS_RECORDED';
      const receipt = {
        sequence: records.length + 1,
        event_hash: request.event_hash,
        event_payload_hash: request.event_payload_hash,
        previous_head: head,
        request_hash: hash(request),
      };
      receipt.head = hash({
        schema_version: 1,
        kind: 'p36_durable_witness_receipt',
        stream_id: request.stream_id,
        ...receipt,
      });
      records.push(receipt);
      head = receipt.head;
      selected = [receipt];
    } else if (message.operation === 'readback') {
      selected = records.slice(request.from_sequence - 1, request.from_sequence - 1 + request.limit);
    } else {
      assert.equal(message.operation, 'getHead');
    }
    journal = hash({ previous: journal, request, selected });
    const witnessResult = resultHash({
      ...commonResult(request, envelopeHash, status, code),
      stream_id: request.stream_id,
      head,
      sequence: records.length,
      records: cloneCanonical(selected),
      journal_hash: journal,
    });
    const proof = message.operation === 'appendIfHead'
      ? anchorProof(message.route_hash, witnessResult.request_hash, witnessResult)
      : null;
    return {
      schema_version: 1,
      kind: 'p37_semantic_witness_transport_result',
      route_hash: message.route_hash,
      operation: message.operation,
      request_envelope_hash: envelopeHash,
      witness_result: witnessResult,
      anchor_proof: proof,
    };
  };
}

const invoke = createTransport();
const sequenceGuardTransport = createTransport();
let guardedAppendCalls = 0;
const sequenceGuardWitness = engine.createSemanticWitnessAdapter({
  route,
  durableBinding,
  invoke(message) {
    if (message.operation === 'appendIfHead' || message.operation === 'appendBatchIfHead') {
      guardedAppendCalls += 1;
    }
    return sequenceGuardTransport(message);
  },
  requestIdFactory: ({ label, counter }) => `guard-${label}-${counter}`,
});
assert.throws(() => sequenceGuardWitness.appendIfHead({
  run_id: route.run_id,
  stream_id: route.run_id,
  sequence: 2,
  event_hash: hash('skipped-sequence'),
  previous_witness_head: null,
  expected_witness_head: null,
}), /current durable witness sequence/);
const skippedBatchEvents = [
  { sequence: 2, event_hash: hash('skipped-batch-2'), type: 'acceptance' },
  { sequence: 3, event_hash: hash('skipped-batch-3'), type: 'complete' },
];
assert.throws(() => sequenceGuardWitness.appendBatchIfHead({
  run_id: route.run_id,
  stream_id: route.run_id,
  batch_id: 'skipped-batch',
  expected_witness_head: null,
  events: skippedBatchEvents,
  batch_commitment: hash({
    run_id: route.run_id,
    stream_id: route.run_id,
    batch_id: 'skipped-batch',
    expected_witness_head: null,
    event_hashes: skippedBatchEvents.map((event) => event.event_hash),
  }),
}), /current durable witness sequence/);
assert.equal(guardedAppendCalls, 0);
sequenceGuardWitness.teardown();
const adapters = {
  userInputVerifier(envelope, kind, context) {
    return {
      ok: envelope.signed === true,
      kind,
      run_id: context.run_id,
      identity: 'user:p37',
      channel: 'authenticated-input',
      envelope_hash: hash({ envelope, kind }),
      payload: cloneCanonical(envelope.payload),
    };
  },
  ownerTurnVerifier(envelope, context) {
    return {
      ok: envelope.witnessed === true,
      run_id: context.run_id,
      principal_id: context.principal_id,
      identity: envelope.identity,
      channel: 'owner-turn',
      envelope_hash: hash(envelope),
      payload: {},
    };
  },
  principalResolver(request) {
    return {
      ok: true,
      run_id: request.run_id,
      from_principal_id: request.from_principal_id,
      identity: request.candidate_id,
      attestation_sha256: hash(`attestation:${request.candidate_id}`),
      outcome: 'qualified',
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
  delegationVerifier(envelope, context) {
    return {
      ok: envelope.signed === true,
      run_id: context.run_id,
      identity: serviceBindings.worker.identity,
      channel: 'supervised-worker',
      envelope_hash: hash({ envelope, context }),
      payload: {
        dispatch_hash: hash(envelope),
        worker_identity: serviceBindings.worker.identity,
        worker_family: 'supervised',
        worker_binding_hash: envelope.forged_worker_binding
          ? hash('forged-worker-binding')
          : hash(serviceBindings.worker),
      },
    };
  },
  evidenceVerifier(request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'runner-a',
      channel: 'trusted-runner',
      envelope_hash: hash({ request, context }),
      payload: {
        emitter_kind: 'runner',
        verification_path: 'trusted_runner',
        attestation_sha256: hash('attestation:runner-a'),
        artifact_hashes: [hash('evidence')],
      },
    };
  },
  evidenceArchiver(request) {
    return { uri: 'durable://p37/evidence', sha256: hash(request) };
  },
};

let tick = 0;
const kernelOptions = {
  initialIntentEnvelope: {
    signed: true,
    payload: {
      text: 'Run the semantic witness activation.',
      explicit_action_hashes: [hash({ operation: 'inspect', target: 'owner-kernel' })],
    },
  },
  initialOwnerId: 'owner-a',
  adapters,
  clock: () => new Date(NOW + (tick += 1000)),
  nonceFactory: () => 'n'.repeat(64),
};

const session = engine.createSemanticWitnessSession({
  ...routeInputs,
  invoke,
  kernelOptions,
  requestIdFactory: ({ label, counter }) => `p37-${label}-${counter}`,
});
assert.equal(session.authority.owner_kernel_authority, 'semantic_only');
assert.ok(session.kernel.getLedger().header.semantic_authority);

const decision = session.kernel.mintDecision({
  capability: session.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'one' },
  actionClass: 'read_only',
  actionDescriptor: { operation: 'inspect', target: 'owner-kernel' },
});
assert.throws(() => session.kernel.delegate({
  capability: session.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'forged-worker-binding' },
  decisionId: decision.payload.decision_id,
  dispatchEnvelope: { signed: true, task: 'inspect', forged_worker_binding: true },
}), /worker binding/);
session.kernel.delegate({
  capability: session.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'two' },
  decisionId: decision.payload.decision_id,
  dispatchEnvelope: { signed: true, task: 'inspect' },
});
session.kernel.recordEvidence({ source: 'semantic-gate' });
session.kernel.checkpoint();
const ledger = session.kernel.getLedger();
assert.ok(ledger.events.length >= 6);
for (const event of ledger.events) {
  assert.equal(event.semantic_authority_hash, ledger.header.semantic_authority_hash);
  assert.equal(event.witness.semantic_route_hash, session.route_hash);
}
assert.equal(engine.verifyLedger(ledger, {
  witness: engine.createSemanticWitnessAdapter({
    route,
    durableBinding,
    invoke,
    requestIdFactory: ({ label, counter }) => `verify-${label}-${counter}`,
  }),
  requireWitness: true,
}).witness_verified, true);
const rewrittenLedger = cloneCanonical(ledger);
rewrittenLedger.events[rewrittenLedger.events.length - 1].witness.witness_head = hash('rewritten-head');
assert.throws(() => engine.verifyLedger(rewrittenLedger, {
  witness: engine.createSemanticWitnessAdapter({
    route,
    durableBinding,
    invoke,
    requestIdFactory: ({ label, counter }) => `rewrite-${label}-${counter}`,
  }),
  requireWitness: true,
}), /witness|head|receipt/i);
session.teardown();

const resumed = engine.resumeSemanticWitnessSession({
  ...routeInputs,
  ledger,
  invoke,
  requestIdFactory: ({ label, counter }) => `resume-${label}-${counter}`,
  kernelOptions: {
    adapters,
    clock: () => new Date(NOW + (tick += 1000)),
    nonceFactory: () => 'r'.repeat(64),
  },
});
assert.equal(resumed.kernel.getState().active_principal.identity, 'owner-a');
resumed.teardown();

const forgedClaim = { ...handoffClaim, handoff_hash: hash('forged') };
assert.throws(
  () => engine.compileSemanticWitnessRoute({ ...routeInputs, handoffClaim: forgedClaim }),
  /claim hash|claimed handoff|hash/,
);
const forgedSubstratePlan = cloneCanonical(substratePlan);
forgedSubstratePlan.service_bindings.worker.identity = 'forged-worker';
forgedSubstratePlan.service_binding_hash = hash(forgedSubstratePlan.service_bindings);
delete forgedSubstratePlan.substrate_plan_hash;
forgedSubstratePlan.substrate_plan_hash = hash(forgedSubstratePlan);
assert.throws(
  () => engine.compileSemanticWitnessRoute({ ...routeInputs, substratePlan: forgedSubstratePlan }),
  /service bindings.*durable cohort/,
);
const forgedRoute = { ...route, witness_binding: { ...route.witness_binding, identity: 'forged' } };
assert.throws(
  () => engine.createSemanticWitnessAdapter({ route: forgedRoute, durableBinding, invoke }),
  /route|binding/,
);
const emptyTransport = createTransport();
assert.throws(() => engine.OwnerKernel.start({
  ...kernelOptions,
  runId: route.run_id,
  governanceConfig,
  acceptanceContract,
  witness: engine.createSemanticWitnessAdapter({
    route,
    durableBinding,
    invoke: emptyTransport,
    requestIdFactory: ({ label, counter }) => `forged-${label}-${counter}`,
  }),
  semanticAuthority: { ...route, policy_hash: hash('wrong-policy') },
}), /policy|semantic authority/);
const failedTeardownTransport = createTransport();
const failedTeardownWitness = engine.createSemanticWitnessAdapter({
  route,
  durableBinding,
  invoke(message) {
    if (message.operation === 'teardown') {
      return { ok: false, route_hash: message.route_hash };
    }
    return failedTeardownTransport(message);
  },
  requestIdFactory: ({ label, counter }) => `failed-teardown-${label}-${counter}`,
});
assert.throws(() => failedTeardownWitness.teardown(), /teardown failed/);
assert.throws(() => failedTeardownWitness.getHead(), /torn down/);
assert.throws(
  () => engine.createSemanticWitnessSession({
    ...routeInputs,
    invoke(message) {
      if (message.operation === 'teardown') {
        return { ok: false, route_hash: message.route_hash };
      }
      return createTransport()(message);
    },
    kernelOptions: {
      ...kernelOptions,
      initialIntentEnvelope: { signed: false, payload: {} },
    },
  }),
  (error) => (
    error instanceof AggregateError
    && error.errors.length === 2
    && error.errors[0].code === 'UNVERIFIED_ENVELOPE'
    && /teardown failed/i.test(error.errors[1].message)
  ),
);

console.log(JSON.stringify({
  semantic_route: 'ok',
  durable_receipt_anchor: 'ok',
  resume_readback: 'ok',
  events: ledger.events.length,
  corpus_evidence: {
    attacks: {
      protected_event_envelope_forgery: 'held',
      policy_kernel_mutation: 'held',
      witness_head_rewrite: 'held',
    },
  },
}));
NODE
)"
EXIT=$?

assert_eq "0" "$EXIT" "P3.7a semantic witness process exits cleanly"
assert_contains "$OUT" '"semantic_route":"ok"' "claimed P3.5d/P3.6 semantic route is active"
assert_contains "$OUT" '"durable_receipt_anchor":"ok"' "mutations require receipt-verifier anchor proof"
assert_contains "$OUT" '"resume_readback":"ok"' "fresh resume revalidates durable witness state"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
