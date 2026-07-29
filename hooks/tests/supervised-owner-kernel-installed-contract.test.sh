#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const installed = require(path.join(root, 'src', 'engine', 'supervised-owner-kernel-installed-contract'));
const ipc = require(path.join(root, 'src', 'engine', 'supervised-owner-kernel-installed-ipc'));
const runner = require(path.join(root, 'src', 'engine', 'supervised-owner-kernel-installed-runner'));
const engine = require(path.join(root, 'src', 'engine'));
const { OwnerKernelError, canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const NOW = 2000000000000;
const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
function binding() {
  const roles = installed.SERVICE_ROLES;
  return {
    schema_version: 1,
    kind: 'p37_installed_state_binding',
    install_binding_hash: hash('install'),
    run_binding_hash: hash('run'),
    installed_abi_hash: installed.getSupervisedOwnerKernelInstalledAbiHash(),
    durable_abi_hash: hash('durable-abi'),
    cohort_id: 'cohort-p37i',
    generation: 1,
    service_bindings: Object.fromEntries(roles.map((role, index) => [role, {
      role,
      identity: `p37i-${role}`,
      uid: 81000 + index,
      gid: 82000 + index,
      attestation_hash: hash(`attestation:${role}`),
      cgroup_binding_hash: hash(`cgroup:${role}`),
    }])),
    snapshot_hash: hash('snapshot'),
  };
}
function reject(callback, code, label) {
  assert.throws(callback, (error) => error instanceof OwnerKernelError
    && (code === undefined || error.code === code), label);
}
assert.equal(engine.getSupervisedOwnerKernelInstalledAbiHash, installed.getSupervisedOwnerKernelInstalledAbiHash);
assert.equal(installed.SERVICE_ROLES.length, 6);
assert.deepEqual([...installed.SERVICE_ROLES], [
  'kernel', 'worker', 'broker', 'receipt_verifier', 'witness', 'coordinator',
]);
assert.equal(installed.SERVICE_IDENTITIES.kernel, 'autopilot-p37i-kernel');
assert.equal(installed.FIXED_PROBE.catalog_id, 'owner-kernel-probe-toggle-v1');
assert.equal(installed.AUTHORITY_DISCLOSURE.engine_sink, 'disabled');
assert.equal(installed.AUTHORITY_DISCLOSURE.acceptance, 'not_available');
assert.equal(installed.AUTHORITY_DISCLOSURE.acceptance_transaction, 'disabled');
assert.ok(installed.FORBIDDEN_OPERATIONS.includes('engine_dispatch'));
assert.ok(installed.FORBIDDEN_OPERATIONS.includes('accept'));
const abi = installed.getSupervisedOwnerKernelInstalledAbi();
assert.equal(abi.kind, 'p37_installed_semantic_probe_contract');
assert.equal(abi.fixed_probe.catalog_id, 'owner-kernel-probe-toggle-v1');
assert.equal(abi.authority.engine_sink, 'disabled');
assert.equal(installed.INSTALLED_ENDPOINTS.length, 6);
const rawBinding = binding();
const bound = installed.normalizeInstalledBinding(rawBinding);
assert.equal(bound.installed_abi_hash, installed.getSupervisedOwnerKernelInstalledAbiHash());
assert.equal(Object.keys(bound.service_bindings).length, 6);
assert.equal(bound.service_bindings.kernel.role, 'kernel');
reject(
  () => installed.normalizeInstalledBinding({ ...rawBinding, installed_abi_hash: hash('wrong') }),
  undefined,
  'wrong installed ABI hash is rejected',
);
reject(
  () => installed.normalizeInstalledBinding({
    ...rawBinding,
    service_bindings: {
      ...rawBinding.service_bindings,
      worker: { ...rawBinding.service_bindings.worker, uid: rawBinding.service_bindings.kernel.uid },
    },
  }),
  undefined,
  'duplicate uid across roles is rejected',
);
const profile = installed.compileInstalledProfile({ binding: bound });
assert.equal(profile.allowed_operation, 'run_probe');
assert.equal(profile.catalog_id, 'owner-kernel-probe-toggle-v1');
assert.equal(profile.authority.engine_sink, 'disabled');
assert.equal(installed.normalizeInstalledProfile(profile).profile_hash, profile.profile_hash);
reject(() => installed.compileInstalledProfile({ binding: bound, engine_sink: 'enabled' }), 'ENGINE_SINK_DISABLED');
reject(() => installed.compileInstalledProfile({ binding: bound, acceptance: 'available' }), 'ACCEPTANCE_DISABLED');
reject(() => installed.compileInstalledProfile({ binding: bound, operation: 'engine_dispatch' }), 'OPERATION_FORBIDDEN');
reject(() => installed.compileInstalledProfile({ binding: bound, command: 'echo hi' }), 'CALLER_CONTROLLED_FIELD_FORBIDDEN');
reject(() => installed.compileInstalledProfile({ binding: bound, path: '/tmp/x' }), 'CALLER_CONTROLLED_FIELD_FORBIDDEN');
const endpoint = installed.INSTALLED_ENDPOINTS.find((item) => item.endpoint_id === 'kernel_broker');
const sender = bound.service_bindings[endpoint.sender_role];
const recipient = bound.service_bindings[endpoint.recipient_role];
const payload = {
  schema_version: 1,
  request_id: 'probe-1',
  operation: 'execute_probe',
  authorization_id: 'authorization-1',
};
const envelope = {
  schema_version: 1,
  protocol_version: 1,
  endpoint_id: 'kernel_broker',
  request_id: payload.request_id,
  operation: payload.operation,
  sender_role: endpoint.sender_role,
  sender_identity: sender.identity,
  sender_attestation_hash: sender.attestation_hash,
  sender_cgroup_binding_hash: sender.cgroup_binding_hash,
  recipient_role: endpoint.recipient_role,
  recipient_identity: recipient.identity,
  recipient_attestation_hash: recipient.attestation_hash,
  recipient_cgroup_binding_hash: recipient.cgroup_binding_hash,
  install_binding_hash: bound.install_binding_hash,
  run_binding_hash: bound.run_binding_hash,
  installed_abi_hash: bound.installed_abi_hash,
  cohort_id: bound.cohort_id,
  generation: bound.generation,
  issued_at_ms: NOW - 10,
  expires_at_ms: NOW + 1000,
  nonce_hash: hash('nonce:probe-1'),
  authentication_proof_hash: hash('proof:probe-1'),
  payload_hash: hash(payload),
};
const normalizedEnvelope = installed.normalizeInstalledEnvelope(bound, envelope, { now: () => NOW });
assert.equal(normalizedEnvelope.endpoint_id, 'kernel_broker');
reject(
  () => installed.normalizeInstalledEnvelope(bound, {
    ...envelope,
    operation: 'accept',
    payload_hash: hash({ ...payload, operation: 'accept' }),
  }, { now: () => NOW }),
  'OPERATION_FORBIDDEN',
);
reject(
  () => installed.normalizeInstalledEnvelope(bound, {
    ...envelope,
    endpoint_id: 'receipt_verifier_witness',
    sender_role: 'receipt_verifier',
    recipient_role: 'witness',
  }, { now: () => NOW }),
);
reject(
  () => installed.normalizeInstalledEnvelope(bound, { ...envelope, expires_at_ms: NOW - 1 }, { now: () => NOW }),
  'INSTALLED_ENVELOPE_EXPIRED',
);
const crash = installed.createInstalledCrashOutcome({
  outcome: 'unknown',
  requestId: 'crash-1',
  reasonCode: 'CRASH_AMBIGUOUS',
  auditMaterial: { window: 'post-execute' },
});
assert.equal(crash.effect_replayed, false);
assert.equal(crash.outcome, 'unknown');
reject(
  () => installed.normalizeCrashOutcome({ ...crash, effect_replayed: true }),
  'EFFECT_REPLAY_FORBIDDEN',
);
const request = ipc.createInstalledRequest(bound, 'kernel_broker', payload, {
  now: () => NOW,
  nonceHash: hash('ipc-nonce-1'),
});
assert.equal(request.kind, 'p37_installed_transport_request');
const frame = ipc.encodeFrame(request);
assert.deepEqual(ipc.decodeFrame(frame), request);
const fence = ipc.createReplayFence();
fence.observe(request.envelope.nonce_hash);
reject(() => fence.observe(request.envelope.nonce_hash), 'REPLAY_DETECTED');
(async () => {
  await assert.rejects(
    () => runner.runInstalledProbe({ binding: bound }),
    (error) => error instanceof OwnerKernelError && error.code === 'INSTALLED_ROUTE_REQUIRED',
  );
  await assert.rejects(
    () => runner.runInstalledProbe({
      binding: bound,
      routeInputs: { durableBinding: {} },
      governanceConfig: {},
      acceptanceContract: {},
      driveSession: async () => {},
    }),
    (error) => error instanceof OwnerKernelError && error.code === 'INSTALLED_ROUTE_REQUIRED',
  );
  await assert.rejects(
    () => runner.runInstalledProbe({
      binding: bound,
      simulateCrashWindow: 'ambiguous',
      requestId: 'crash-window-1',
    }),
    (error) => error instanceof OwnerKernelError && error.code === 'INSTALLED_ROUTE_REQUIRED',
  );
  const runnerSource = fs.readFileSync(
    path.join(root, 'src', 'engine', 'supervised-owner-kernel-installed-runner.js'),
    'utf8',
  );
  assert.ok(!/function\s+createInProcessProbeHost\b/.test(runnerSource));
  assert.ok(!/function\s+runInstalledInProcessFixture\b/.test(runnerSource));
  assert.ok(!/function\s+createInProcessWitnessInvoke\b/.test(runnerSource));
  assert.equal(typeof runner.runInstalledInProcessFixture, 'undefined');
  assert.equal(typeof runner.createInProcessProbeHost, 'undefined');
  assert.equal(typeof engine.runInstalledInProcessFixture, 'undefined');
  const prodFn = runnerSource.split('async function runInstalledProbe')[1].split('function createInstalledRunner')[0];
  assert.ok(!prodFn.includes('createInProcessProbeHost('));
  assert.ok(!prodFn.includes('createProbeEffectSession('));
  assert.ok(!prodFn.includes('createInProcessWitnessInvoke('));
  assert.ok(!/options\.driveSession\s*\(/.test(prodFn));
  assert.ok(prodFn.includes('simulateCrashWindow'));
  assert.ok(!/simulateCrashWindow[\s\S]*outcome:\s*['"]unknown['"]/.test(prodFn));
  assert.ok(prodFn.includes('INSTALLED_ROUTE_REQUIRED'));
  // Test-only result builder (not a production host path).
  const dry = {
    schema_version: 1,
    kind: runner.RUNNER_KIND,
    result: runner.buildInstalledResult({
      profile,
      outcome: 'completed',
      status: 'completed',
      sentinelRestored: true,
      auditMaterial: { fixture_only: true, effect_replayed: false },
    }),
    authority: installed.AUTHORITY_DISCLOSURE,
    fixture_only: true,
  };
  assert.equal(dry.result.outcome, 'completed');
  assert.equal(dry.result.sentinel_restored, true);
  assert.equal(dry.result.effect_replayed, false);
  assert.equal(dry.result.probe_catalog_id, 'owner-kernel-probe-toggle-v1');
  assert.equal(dry.result.authority.engine_sink, 'disabled');
  assert.equal(dry.fixture_only, true);
  const ambiguous = installed.createInstalledCrashOutcome({
    outcome: 'unknown', requestId: 'crash-window-1', reasonCode: 'CRASH_AMBIGUOUS',
    auditMaterial: { window: 'ambiguous' },
  });
  assert.equal(ambiguous.outcome, 'unknown');
  assert.equal(ambiguous.effect_replayed, false);
  const recovery = installed.createInstalledCrashOutcome({
    outcome: 'recovery_required', requestId: 'crash-window-2', reasonCode: 'RECOVERY_REQUIRED',
    auditMaterial: { window: 'needs-recovery' },
  });
  assert.equal(recovery.outcome, 'recovery_required');
  assert.equal(recovery.effect_replayed, false);
  await assert.rejects(
    () => runner.runInstalledProbe({ binding: bound, command: '/bin/true' }),
    (error) => error instanceof OwnerKernelError && error.code === 'CALLER_CONTROLLED_FIELD_FORBIDDEN',
  );
  await assert.rejects(
    () => runner.runInstalledProbe({ binding: bound, engine_sink: 'enabled' }),
    (error) => error instanceof OwnerKernelError && error.code === 'ENGINE_SINK_DISABLED',
  );
  const created = runner.createInstalledRunner({ binding: bound });
  assert.equal(created.authority.engine_sink, 'disabled');
  assert.equal(created.fixed_probe.catalog_id, 'owner-kernel-probe-toggle-v1');
  await assert.rejects(
    () => created.runProbe(),
    (error) => error instanceof OwnerKernelError && error.code === 'INSTALLED_ROUTE_REQUIRED',
  );
  console.log(JSON.stringify({
    ok: true,
    abi_hash: installed.getSupervisedOwnerKernelInstalledAbiHash(),
    roles: installed.SERVICE_ROLES.length,
    endpoints: installed.INSTALLED_ENDPOINTS.length,
    dry_outcome: dry.result.outcome,
    production_route_required: true,
    production_simulation_stripped: true,
  }));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
NODE
)"
assert_contains "$OUT" '"ok":true'
assert_contains "$OUT" '"roles":6'
assert_contains "$OUT" '"dry_outcome":"completed"'
assert_contains "$OUT" '"production_route_required":true'
assert_contains "$OUT" '"production_simulation_stripped":true'
finalize_test
