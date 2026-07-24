#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE' 2>&1
'use strict';

const assert = require('node:assert/strict');
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
const catalog = [baseEngine.PROBE_EFFECT_CATALOG_ENTRY];
const runtime = createP37Runtime(root, {
  actionCatalog: catalog,
  runId: 'p37-probe',
});
const {
  engine,
  hash,
  governanceConfig,
  contract,
  routeInputs,
  durableBinding,
  serviceBindings,
} = runtime;
const NOW = new Date(runtime.NOW).toISOString();
const EXPIRES = new Date(runtime.NOW + 3600000).toISOString();

const profile = engine.compileProbeEffectProfile({
  ...routeInputs,
  capabilityProbedAt: NOW,
  capabilityExpiresAt: EXPIRES,
});
assert.deepEqual(profile.catalog_entry, engine.PROBE_EFFECT_CATALOG_ENTRY);
assert.equal(profile.effect_authority, 'reversible_probe_only');

let sentinel = false;
let stateVersion = 0;
let effectCounter = 0;
const authorizations = new Map();
const consumed = new Set();
const capturedExecuteMessages = [];

function hostResponse(message, response) {
  return {
    schema_version: 1,
    kind: 'p37_probe_effect_host_response',
    profile_hash: message.profile_hash,
    route_hash: message.route_hash,
    operation: message.operation,
    request_hash: message.request_hash,
    response,
    response_hash: hash(response),
  };
}

function effectInvoke(message) {
  const request = message.request;
  if (message.profile_hash !== profile.profile_hash || message.route_hash !== profile.route_hash) {
    throw new Error('wrong probe profile');
  }
  if (message.operation.startsWith('capability:')) {
    assert.deepEqual(message.recipient, profile.route.kernel_binding);
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
    return hostResponse(message, response);
  }
  if (message.operation === 'execute_probe') {
    capturedExecuteMessages.push(message);
    const authorization = request.execution_authorization;
    if (!authorization
      || authorizations.get(authorization.authorization_id) !== authorization.authorization
      || consumed.has(authorization.authorization_id)) {
      throw new Error('execution authorization replay or substitution');
    }
    assert.deepEqual(request.action, profile.action);
    assert.equal(request.action_descriptor.catalog_id, engine.PROBE_EFFECT_CATALOG_ID);
    consumed.add(authorization.authorization_id);
    const prior = sentinel;
    sentinel = !sentinel;
    stateVersion += 1;
    effectCounter += 1;
    const effectId = `probe-effect-${effectCounter}`;
    const receipt = {
      uri: `file://${profile.receipt_root}/${effectId}.json`,
      sha256: hash({
        effect_id: effectId,
        prior_state_hash: hash(prior),
        new_state_hash: hash(sentinel),
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
      boundary_state_version: stateVersion,
      boundary_attestation_hash: serviceBindings.broker.attestation_hash,
      effect_at: NOW,
    });
  }
  if (message.operation === 'verify_effect') {
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
  throw new Error(`unexpected probe host operation ${message.operation}`);
}

const witnessInvoke = runtime.createWitnessInvoke();
const cleanupWitnessTransport = runtime.createWitnessInvoke();
let cleanupTeardownCalls = 0;
assert.throws(() => engine.createProbeEffectSession({
  profile,
  durableBinding,
  governanceConfig,
  acceptanceContract: contract,
  witnessInvoke(message) {
    if (message.operation === 'teardown') cleanupTeardownCalls += 1;
    return cleanupWitnessTransport(message);
  },
  effectInvoke: null,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: { text: 'Reject an invalid probe authority.', explicit_action_hashes: [] },
    },
    initialOwnerId: 'owner-a',
    adapters: runtime.adapters(),
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'c'.repeat(64),
  },
}), /requires invoke/);
assert.equal(cleanupTeardownCalls, 1);
const session = engine.createProbeEffectSession({
  profile,
  durableBinding,
  governanceConfig,
  acceptanceContract: contract,
  witnessInvoke,
  effectInvoke,
  requestIdFactory: ({ label, counter }) => `probe-${label}-${counter}`,
  kernelOptions: {
    initialIntentEnvelope: {
      signed: true,
      payload: { text: 'Toggle and restore the fixed probe.', explicit_action_hashes: [] },
    },
    initialOwnerId: 'owner-a',
    adapters: runtime.adapters(),
    clock: () => new Date(runtime.NOW),
    nonceFactory: () => 'p'.repeat(64),
  },
});
assert.deepEqual(session.authority, {
  owner_kernel_authority: 'active',
  effect_authority: 'reversible_probe_only',
  broker_authority: 'probe_only',
  acceptance: 'not_available',
});

async function runProbe(turn) {
  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn },
    actionClass: 'reversible',
    actionDescriptor: profile.action,
  });
  const result = await session.kernel.executeAuthorizedAction({
    decisionId: decision.payload.decision_id,
    action: profile.action,
    timeoutMilliseconds: 1000,
  });
  assert.equal(result.outcome.payload.outcome, 'succeeded');
  return result;
}

(async () => {
  const first = await runProbe('enable');
  assert.equal(sentinel, true);
  const second = await runProbe('restore');
  assert.equal(sentinel, false);
  assert.notEqual(first.outcome.payload.boundary_effect_id, second.outcome.payload.boundary_effect_id);
  assert.equal(consumed.size, 2);

  const eventsBeforeSubstitution = session.kernel.getLedger().events.length;
  const substituted = {
    ...profile.action,
    targets: ['forbidden-target'],
  };
  const decision = session.kernel.mintActionDecision({
    capability: session.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'substitution' },
    actionClass: 'reversible',
    actionDescriptor: profile.action,
  });
  await assert.rejects(
    () => session.kernel.executeAuthorizedAction({
      decisionId: decision.payload.decision_id,
      action: substituted,
      timeoutMilliseconds: 1000,
    }),
    /does not exactly match|target_set_hash|authorized descriptor/,
  );
  assert.equal(capturedExecuteMessages.length, 2);
  assert.ok(session.kernel.getLedger().events.length >= eventsBeforeSubstitution);
  assert.throws(
    () => effectInvoke(capturedExecuteMessages[0]),
    /replay/,
  );
  assert.throws(
    () => effectInvoke({
      profile_hash: profile.profile_hash,
      route_hash: profile.route_hash,
      operation: 'execute_probe',
      request: { execution_authorization: null },
    }),
    /authorization replay or substitution/,
  );

  const forgedProfile = {
    ...profile,
    receipt_root: '/tmp/p37-forged-receipts',
  };
  forgedProfile.profile_hash = hash((({ profile_hash: _ignored, ...rest }) => rest)(forgedProfile));
  assert.throws(
    () => engine.createProbeEffectActionAuthority({
      profile: forgedProfile,
      durableBinding,
      invoke: effectInvoke,
    }),
    /canonical|hash|profile|fixed host-owned/,
  );
  const forgedRoute = structuredClone(profile.route);
  forgedRoute.worker_binding.identity = 'p37-forged-worker';
  forgedRoute.worker_binding.attestation_hash = hash('p37-forged-worker');
  const forgedCohortProfile = {
    ...profile,
    route: forgedRoute,
    route_hash: engine.semanticRouteHash(forgedRoute),
  };
  forgedCohortProfile.profile_hash = hash(
    (({ profile_hash: _ignored, ...rest }) => rest)(forgedCohortProfile),
  );
  assert.throws(
    () => engine.createProbeEffectActionAuthority({
      profile: forgedCohortProfile,
      durableBinding,
      invoke: effectInvoke,
    }),
    /does not match the durable service cohort/,
  );
  const forgedResumeRoute = structuredClone(profile.route);
  forgedResumeRoute.workspace_root_hash = hash('forged-resume-workspace');
  const forgedResumeProfile = {
    ...profile,
    route: forgedResumeRoute,
    route_hash: engine.semanticRouteHash(forgedResumeRoute),
  };
  forgedResumeProfile.profile_hash = hash(
    (({ profile_hash: _ignored, ...rest }) => rest)(forgedResumeProfile),
  );
  assert.throws(() => engine.resumeProbeEffectSession({
    profile: forgedResumeProfile,
    ledger: session.kernel.getLedger(),
    durableBinding,
    governanceConfig,
    acceptanceContract: contract,
    witnessInvoke,
    effectInvoke,
    kernelOptions: {
      adapters: runtime.adapters(),
      clock: () => new Date(runtime.NOW),
      nonceFactory: () => 'r'.repeat(64),
    },
  }), /exactly match the ledger-frozen authority/);
  session.teardown();
  assert.throws(
    () => session.kernel.mintActionDecision({
      capability: session.owner_capability,
      ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'after-teardown' },
      actionClass: 'reversible',
      actionDescriptor: profile.action,
    }),
    /torn down|unavailable|witness/i,
  );

  console.log(JSON.stringify({
    reversible_probe: 'ok',
    restored: sentinel === false,
    replay_blocked: true,
    effects: effectCounter,
    corpus_evidence: {
      attacks: {
        mediated_action_bypass: 'held',
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

assert_eq "0" "$EXIT" "P3.7b reversible probe process exits cleanly"
assert_contains "$OUT" '"reversible_probe":"ok"' "fixed broker-owned probe executes"
assert_contains "$OUT" '"restored":true' "probe restores its pre-effect state"
assert_contains "$OUT" '"replay_blocked":true' "consumed authorization replay is rejected"
assert_contains "$OUT" '"effects":2' "only the toggle and restore effects execute"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
