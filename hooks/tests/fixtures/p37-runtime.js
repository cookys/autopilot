'use strict';

const path = require('path');

function createP37Runtime(root, {
  actionCatalog = [],
  acceptanceContract = null,
  runId = 'p37-runtime',
  modeOverride,
} = {}) {
  const engine = require(path.join(root, 'src', 'engine'));
  const durable = require(path.join(
    root,
    'src',
    'engine',
    'supervised-production-substrate-durable-contract',
  ));
  const { canonicalJson, cloneCanonical, sha256 } = engine;
  const NOW = Date.parse('2026-07-25T00:00:00.000Z');
  const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));

  function roster(identity, role, family) {
    return {
      identity,
      model_alias: `${identity}-model`,
      model_version: '1',
      family,
      runner: `${identity}-runner`,
      role,
      attestation: {
        issuer: 'p37-fixture-attestor',
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
      action_catalog: cloneCanonical(actionCatalog),
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: 100,
      max_blocked_duration_seconds: 86400,
      max_recover_cycles: 1,
      max_delegate_per_decision: 1,
    },
  };
  const contract = acceptanceContract || {
    schema_version: 1,
    contract_id: 'p37-runtime-semantic',
    legs: [{
      id: 'semantic-output',
      kind: 'non_executable',
      artifact_hashes: [hash('semantic-output')],
    }],
  };
  const policyHash = engine.resolveGovernancePolicy(governanceConfig, { modeOverride }).policy_hash;
  const contractHash = engine.freezeAcceptanceContract(contract).contract_hash;
  const bridgePlanHash = hash(`${runId}:p35-bridge-plan`);
  const p35InstallHash = hash(`${runId}:p35-install`);
  const immutableBase = 'a'.repeat(40);
  const cgroups = Object.fromEntries(
    ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']
      .map((role) => [role, `/autopilot.slice/${runId}-${role}.service`]),
  );
  const serviceBindings = Object.fromEntries(
    ['worker', 'broker', 'receipt_verifier', 'witness', 'coordinator']
      .map((role, index) => [role, {
        role,
        identity: `${runId}-${role}`,
        uid: 71000 + index,
        gid: 72000 + index,
        attestation_hash: hash(`${runId}:service-attestation:${role}`),
        cgroup_binding_hash: hash(cgroups[role]),
      }]),
  );
  const kernelBinding = {
    role: 'kernel',
    identity: `${runId}-kernel`,
    uid: 70000,
    gid: 70001,
    attestation_hash: hash(`${runId}:service-attestation:kernel`),
    cgroup_binding_hash: hash(`/autopilot.slice/${runId}-kernel.service`),
  };
  const trustedBinding = {
    schema_version: 2,
    owner_run_id: runId,
    engine_run_id: runId,
    invocation_id: `${runId}-invocation`,
    policy_hash: policyHash,
    contract_hash: contractHash,
    immutable_base: immutableBase,
    workspace_registration_id: `${runId}-workspace`,
    workspace_root_hash: hash(`${runId}:workspace-root`),
    workspace_descriptor_binding_hash: hash(`${runId}:descriptor-binding`),
    workspace_ticket_hash: hash(`${runId}:workspace-ticket`),
    prompt_hash: hash(`${runId}:prompt`),
    branch_hash: hash(`${runId}:branch`),
    verify_command_hash: hash(`${runId}:verify`),
    sink_inventory_hash: hash(engine.getAutopilotEngineControlSinkInventory()),
    bridge_abi_hash: engine.getSupervisedEngineBridgeAbiHash(2),
  };
  const verifiedIntake = {
    schema_version: 1,
    verified: true,
    intake_protocol_version: 2,
    replay_status: 'fresh',
    session_id: `${runId}-session`,
    session_challenge_hash: hash(`${runId}:session-challenge`),
    install_binding_hash: p35InstallHash,
    issuer: 'p37-fixture-intake',
    key_id: `${runId}-key`,
    attestation_hash: hash(`${runId}:intake-attestation`),
    envelope_hash: hash(`${runId}:intake-envelope`),
    replay_fingerprint: hash(`${runId}:replay`),
    issued_at_ms: NOW,
    not_before_ms: NOW,
    expires_at_ms: NOW + 60000,
    trusted_intake_binding: trustedBinding,
    bridge_plan_hash: bridgePlanHash,
    bridge_receipt_hash: hash(`${runId}:bridge-receipt`),
    authenticated_receipt_hash: hash(`${runId}:authenticated-receipt`),
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
    handoff_id: `${runId}-handoff`,
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
  const p36InstallHash = hash(`${runId}:p36-install`);
  const runBinding = {
    schema_version: 1,
    kind: 'p36_durable_run_binding',
    p36_install_binding_hash: p36InstallHash,
    p35_handoff_hash: verifiedHandoff.handoff_hash,
    p35_install_binding_hash: p35InstallHash,
    bridge_plan_hash: bridgePlanHash,
    cohort_id: `${runId}-cohort`,
    generation: 1,
    services: Object.values(serviceBindings).map((service) => ({
      role: service.role,
      identity: service.identity,
      uid: service.uid,
      gid: service.gid,
      attestation_hash: service.attestation_hash,
      unit: `${runId}-${service.role}.service`,
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
    acceptanceContract: contract,
    kernelBinding,
    modeOverride,
  };
  const route = engine.compileSemanticWitnessRoute(routeInputs);

  function createWitnessInvoke() {
    let head = null;
    let journal = hash(`${runId}:witness-journal-genesis`);
    let tornDown = false;
    const records = [];
    const anchors = new Map();

    function resultHash(value) {
      return { ...value, result_hash: hash(value) };
    }

    return function invoke(message) {
      if (message.operation === 'teardown') {
        tornDown = true;
        return { ok: true, route_hash: message.route_hash };
      }
      if (tornDown) throw new Error('witness transport is torn down');
      if (message.operation === 'verifyReceipt') {
        const anchor = anchors.get(message.request.durable_request_hash);
        const material = {
          schema_version: 1,
          kind: 'p37_semantic_anchor_verification',
          route_hash: message.route_hash,
          operation: 'verifyReceipt',
          verified: Boolean(anchor && anchor === message.request.receipt_anchor_hash),
          request_hash: message.request.durable_request_hash,
          anchor_record_hash: anchor || null,
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
        if (request.expected_head !== head) throw new Error('stale witness head');
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
        selected = [receipt];
        head = receipt.head;
      } else if (message.operation === 'appendBatchIfHead') {
        if (request.expected_head !== head) throw new Error('stale witness head');
        status = 'recorded';
        code = 'WITNESS_RECORDED';
        const requestHash = hash(request);
        let previousHead = head;
        selected = request.events.map((event, index) => {
          const receipt = {
            sequence: records.length + index + 1,
            event_hash: event.event_hash,
            event_payload_hash: event.event_payload_hash,
            previous_head: previousHead,
            request_hash: requestHash,
          };
          receipt.head = hash({
            schema_version: 1,
            kind: 'p36_durable_witness_receipt',
            stream_id: request.stream_id,
            ...receipt,
          });
          previousHead = receipt.head;
          return receipt;
        });
        records.push(...selected);
        head = previousHead;
      } else if (message.operation === 'readback') {
        selected = records.slice(request.from_sequence - 1, request.from_sequence - 1 + request.limit);
      } else if (message.operation !== 'getHead') {
        throw new Error(`unsupported witness operation ${message.operation}`);
      }
      journal = hash({ previous: journal, request, selected });
      const witnessResult = resultHash({
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
        responder_identity: serviceBindings.witness.identity,
        responder_attestation_hash: serviceBindings.witness.attestation_hash,
        responder_cgroup_binding_hash: serviceBindings.witness.cgroup_binding_hash,
        owner_kernel_authority: 'none',
        effect_authority: 'none',
        broker_authority: 'disabled',
        acceptance: 'not_available',
        stream_id: request.stream_id,
        head,
        sequence: records.length,
        records: cloneCanonical(selected),
        journal_hash: journal,
      });
      let anchorProof = null;
      if (message.operation === 'appendIfHead' || message.operation === 'appendBatchIfHead') {
        const anchorMaterial = {
          route_hash: message.route_hash,
          request_hash: witnessResult.request_hash,
          witness_result_hash: witnessResult.result_hash,
        };
        const anchorRecordHash = hash(anchorMaterial);
        anchors.set(witnessResult.request_hash, anchorRecordHash);
        const material = {
          schema_version: 1,
          kind: 'p37_semantic_receipt_anchor_proof',
          route_hash: message.route_hash,
          request_hash: witnessResult.request_hash,
          witness_result_hash: witnessResult.result_hash,
          anchor_record_hash: anchorRecordHash,
          verified: true,
        };
        anchorProof = { ...material, proof_hash: hash(material) };
      }
      return {
        schema_version: 1,
        kind: 'p37_semantic_witness_transport_result',
        route_hash: message.route_hash,
        operation: message.operation,
        request_envelope_hash: envelopeHash,
        witness_result: witnessResult,
        anchor_proof: anchorProof,
      };
    };
  }

  function adapters() {
    return {
      userInputVerifier(envelope, kind, context) {
        return {
          ok: Boolean(envelope && envelope.signed),
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
          ok: Boolean(envelope && envelope.witnessed),
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
    };
  }

  return {
    NOW,
    adapters,
    contract,
    createWitnessInvoke,
    durableBinding,
    engine,
    governanceConfig,
    hash,
    kernelBinding,
    route,
    routeInputs,
    serviceBindings,
  };
}

module.exports = { createP37Runtime };
