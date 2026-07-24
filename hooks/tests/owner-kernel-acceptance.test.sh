#!/usr/bin/env bash
# P2b acceptance protocol: typed proof, independent challenge, and atomic terminal batch.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const path = require('path');
const root = process.argv[2];
const {
  MemoryWitness,
  OwnerKernel,
  canonicalJson,
  sha256,
  verifyLedger,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const now = '2026-07-23T00:00:00.000Z';
const manifest = [{ id: 'workspace', sha256: hash('final-workspace') }];
const manifestHash = hash(manifest);
const auditHead = hash('audit-head');

function roster(identity, role, family) {
  return {
    identity,
    model_alias: identity,
    model_version: '1',
    family,
    runner: `${identity}-runner`,
    role,
    attestation: {
      issuer: 'test-attestor',
      uri: `test://${identity}`,
      sha256: hash(`attestation:${identity}`),
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2027-01-01T00:00:00.000Z',
    },
  };
}

function config({ maxRecoverCycles = 1 } = {}) {
  return {
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
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: 100,
      max_blocked_duration_seconds: 86400,
      max_recover_cycles: maxRecoverCycles,
      max_delegate_per_decision: 1,
      action_catalog: [],
    },
  };
}

function contract() {
  return {
    schema_version: 2,
    contract_id: 'p2b-contract',
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [
      { id: 'tests', kind: 'executable', command: 'node --test', artifact_ids: ['workspace'] },
      { id: 'ux', kind: 'non_executable', artifact_ids: ['workspace'] },
    ],
  };
}

function executableOnlyContract(id) {
  return {
    schema_version: 2,
    contract_id: id,
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [{ id: 'tests', kind: 'executable', command: 'node --test', artifact_ids: ['workspace'] }],
  };
}

function nonExecutableOnlyContract(id) {
  return {
    schema_version: 2,
    contract_id: id,
    artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
    legs: [{ id: 'ux', kind: 'non_executable', artifact_ids: ['workspace'] }],
  };
}

function makeSnapshot(request, overrides = {}) {
  const { run_id: runId, expected_event_head: eventHead, expected_witness_head: witnessHead } = request;
  const normalized = {
    attempt_id: request.attempt_id,
    attempt_hash: request.attempt_hash,
    intent_id: request.expected_intent_id,
    transaction_id: overrides.transaction_id || 'acceptance-txn-1',
    fence: overrides.fence || hash('acceptance-fence'),
    candidate_artifacts: overrides.candidate_artifacts || manifest,
    delivered_artifacts: overrides.delivered_artifacts || manifest,
    candidate_set_hash: manifestHash,
    delivered_set_hash: manifestHash,
    audit_head: overrides.audit_head || auditHead,
    control_event_head: eventHead,
    control_witness_head: witnessHead,
    snapshot_at: now,
  };
  return {
    ok: true,
    run_id: runId,
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
    snapshot_hash: hash({ run_id: runId, ...normalized }),
  };
}

function adapters() {
  return {
    userInputVerifier(envelope, kind, context) {
      if (!envelope || envelope.signed !== true) return { ok: false };
      return {
        ok: true,
        kind,
        run_id: context.run_id,
        identity: 'user-a',
        channel: 'test-user',
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
        channel: 'test-owner-turn',
        envelope_hash: hash(envelope),
        payload: {},
      };
    },
    principalResolver({ candidate_id, run_id, from_principal_id }) {
      return { ok: true, run_id, from_principal_id, identity: candidate_id, attestation_sha256: hash(`attestation:${candidate_id}`) };
    },
    qualificationVerifier({ principal, run_id }) {
      return { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 };
    },
    evidenceArchiver({ verified_evidence }) {
      return { uri: `durable://evidence/${hash(verified_evidence)}`, sha256: hash(verified_evidence) };
    },
    evidenceVerifier(_request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'owner-kernel',
        channel: 'test-generic-evidence',
        envelope_hash: hash('generic-evidence-envelope'),
        payload: {
          emitter_kind: 'kernel',
          verification_path: 'kernel_verify',
          artifact_hashes: [hash('advisory-only')],
        },
      };
    },
    verificationVerifier(_request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'runner-a',
        channel: 'test-runner',
        envelope_hash: hash('verification-envelope'),
        payload: {
          emitter_kind: 'runner',
          verification_path: 'trusted_runner',
          attestation_sha256: hash('attestation:runner-a'),
          verification_id: 'verification-1',
          intent_id: context.intent_id,
          leg_id: 'tests',
          outcome: 'green',
          command_hash: hash('node --test'),
          candidate_artifacts: manifest,
          candidate_set_hash: manifestHash,
          exit_code: 0,
          stdout_hash: hash('stdout'),
          stderr_hash: hash('stderr'),
          executed_at: now,
        },
      };
    },
    challengeVerifier(envelope, context) {
      const scopeId = envelope && envelope.scope_id ? envelope.scope_id : 'ux';
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'challenger-a',
        channel: 'test-challenge',
        envelope_hash: hash('challenge-envelope'),
        payload: {
          verification_path: 'qualified_challenge',
          attestation_sha256: hash('attestation:challenger-a'),
          challenge_id: `challenge-${scopeId}`,
          intent_id: context.intent_id,
          scope: 'contract_leg',
          scope_id: scopeId,
          finding: 'clear',
          candidate_artifacts: manifest,
          candidate_set_hash: manifestHash,
          subject_identity: 'worker-a',
          subject_family: 'anthropic',
          result_hash: hash('challenge-result'),
          reviewed_at: now,
        },
      };
    },
    artifactProvenanceVerifier(request, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'acceptance-coordinator',
        channel: 'test-artifact-provenance',
        envelope_hash: hash({ provenance: request }),
        payload: {
          verification_path: 'artifact_provenance',
          attestation_sha256: hash('acceptance-coordinator-attestation'),
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
        identity: 'acceptance-coordinator',
        channel: 'test-audit',
        envelope_hash: hash('audit-envelope'),
        payload: {
          verification_path: 'acceptance_audit',
          attestation_sha256: hash('acceptance-coordinator-attestation'),
          audit_head: auditHead,
          intent_id: context.intent_id,
          candidate_artifacts: manifest,
          candidate_set_hash: manifestHash,
          complete: true,
          action_claim_ids: [],
          action_footprint_hash: context.action_footprint_hash,
          evaluated_event_head: context.evaluated_event_head,
          evaluated_witness_head: context.evaluated_witness_head,
          observed_at: now,
        },
      };
    },
    delegationVerifier(_envelope, context) {
      return {
        ok: true,
        run_id: context.run_id,
        identity: 'dispatch-host',
        channel: 'test-dispatch',
        envelope_hash: hash('dispatch-envelope'),
        payload: { dispatch_hash: hash('dispatch'), worker_identity: 'worker-a', worker_family: 'anthropic' },
      };
    },
  };
}

function authority({ witness, failBatch = false, responseLostAfterCommit = false, snapshotOverrides = {} } = {}) {
  let released = 0;
  const attempts = new Map();
  const binding = {
    identity: 'acceptance-coordinator',
    trust_tier: 'test',
    attestation_hash: hash('acceptance-coordinator-attestation'),
    protocol_version: 2,
  };
  const bindingHash = hash(binding);
  const sign = (value) => hash({ coordinator: bindingHash, ...value });
  const unsigned = ({ signature: _signature, ...rest }) => rest;
  const resolutionFor = (request, disposition = 'released') => {
    const coordinator_resolution = {
      protocol_version: 1,
      run_id: request.run_id,
      coordinator_binding_hash: bindingHash,
      attempt_id: request.attempt_id,
      attempt_hash: request.attempt_hash,
      transaction_id: request.transaction_id || null,
      fence: request.fence || null,
      disposition,
      issued_at: now,
      attestation_hash: binding.attestation_hash,
      signature: '',
    };
    coordinator_resolution.signature = sign(unsigned(coordinator_resolution));
    return coordinator_resolution;
  };
  const value = {
    identity: binding.identity,
    trustTier: 'test',
    attestation_hash: binding.attestation_hash,
    protocol_version: 2,
    acquire(request) {
      const snapshot = makeSnapshot(request, snapshotOverrides);
      attempts.set(request.attempt_id, { request, snapshot, status: 'acquired', abort: null });
      return snapshot;
    },
    commit(request) {
      const attempt = attempts.get(request.attempt_id);
      if (!attempt) throw new Error('unknown attempt');
      if (attempt.abort) {
        const coordinator_resolution = resolutionFor({ ...request, transaction_id: request.transaction_id, fence: request.fence }, 'aborted');
        attempt.status = 'aborted';
        attempt.resolution = coordinator_resolution;
        return {
          ok: true,
          run_id: request.run_id,
          attempt_id: request.attempt_id,
          attempt_hash: request.attempt_hash,
          transaction_id: request.transaction_id,
          fence: request.fence,
          disposition: 'aborted',
          user_abort: attempt.abort,
          coordinator_resolution,
        };
      }
      if (failBatch) throw new Error('batch witness outage');
      const coordinator_commitment = {
        protocol_version: 1,
        run_id: request.run_id,
        coordinator_binding_hash: bindingHash,
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
        issued_at: now,
        attestation_hash: binding.attestation_hash,
        signature: '',
      };
      coordinator_commitment.signature = sign(unsigned(coordinator_commitment));
      const witnessResult = witness.appendBatchIfHead({
        ...request.batch,
        coordinator_commitment,
      });
      const response = {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        transaction_id: request.transaction_id,
        fence: request.fence,
        disposition: 'accepted',
        lease_released: true,
        coordinator_commitment,
        event_records: request.provisional_events,
        receipts: witnessResult.receipts,
      };
      attempts.set(request.attempt_id, { ...attempt, status: 'accepted', response, request });
      if (responseLostAfterCommit) throw new Error('commit response lost after witness mutation');
      return response;
    },
    requestAbort(request) {
      const attempt = attempts.get(request.attempt_id) || { request, status: 'recording' };
      attempt.abort = request.user_abort;
      attempts.set(request.attempt_id, attempt);
      return {
        ok: true,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: attempt.status === 'accepted' ? 'accepted' : 'queued',
      };
    },
    cancel(request) {
      const attempt = attempts.get(request.attempt_id) || { request };
      attempt.status = 'cancelled';
      attempt.resolution = resolutionFor(request, 'cancelled');
      attempts.set(request.attempt_id, attempt);
      return {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: 'cancelled',
        coordinator_resolution: attempt.resolution,
      };
    },
    resolveAttempt(request) {
      const attempt = attempts.get(request.attempt_id);
      if (!attempt) return this.cancel(request);
      if (attempt.status === 'accepted') return attempt.response;
      const coordinator_resolution = attempt.resolution || resolutionFor(request, attempt.status === 'aborted' ? 'aborted' : 'cancelled');
      return {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: attempt.status === 'aborted' ? 'aborted' : 'cancelled',
        coordinator_resolution,
      };
    },
    verifyCommit(request) {
      const commitment = request.coordinator_commitment;
      return Boolean(commitment && commitment.signature === sign(unsigned(commitment))
        && commitment.coordinator_binding_hash === bindingHash
        && commitment.batch_commitment === request.batch.batch_commitment);
    },
    verifyResolution(request) {
      const resolution = request.coordinator_resolution;
      return Boolean(resolution && resolution.signature === sign(unsigned(resolution))
        && resolution.coordinator_binding_hash === bindingHash
        && resolution.disposition === request.disposition);
    },
    release(request) {
      released += 1;
      const existing = attempts.get(request.attempt_id);
      if (existing && existing.status === 'accepted') return existing.response;
      const coordinator_resolution = resolutionFor(request, request.outcome === 'aborted' ? 'aborted' : 'released');
      const attempt = existing || { request };
      attempt.status = coordinator_resolution.disposition;
      attempt.resolution = coordinator_resolution;
      attempts.set(request.attempt_id, attempt);
      return {
        ok: true,
        run_id: request.run_id,
        attempt_id: request.attempt_id,
        attempt_hash: request.attempt_hash,
        disposition: coordinator_resolution.disposition,
        coordinator_resolution,
      };
    },
  };
  Object.defineProperty(value, 'releases', { enumerable: false, get: () => released });
  Object.defineProperty(value, 'failBatch', { enumerable: false, value: failBatch });
  return value;
}

function start(runId, options = {}) {
  const witness = options.witness || new MemoryWitness({ streamId: `${runId}-witness` });
  const coordinator = options.coordinator || authority({ witness });
  const started = OwnerKernel.start({
    runId,
    governanceConfig: options.governanceConfig || config(),
    acceptanceContract: options.acceptanceContract || contract(),
    initialIntentEnvelope: { signed: true, payload: { text: 'Ship the artifact.', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a',
    witness,
    adapters: options.adapters || adapters(),
    clock: () => now,
    allowTestWitness: true,
    acceptanceAuthority: coordinator,
    allowTestAcceptanceCoordinator: true,
    nonceFactory: () => `${runId}`.padEnd(64, 'n'),
  });
  return { ...started, witness, coordinator };
}

async function main() {
  assert.throws(() => OwnerKernel.start({
    runId: 'v2-needs-coordinator', governanceConfig: config(), acceptanceContract: contract(),
    initialIntentEnvelope: { signed: true, payload: { text: 'x', explicit_action_hashes: [] } }, initialOwnerId: 'owner-a',
    witness: new MemoryWitness({ streamId: 'v2-needs-coordinator-witness' }), adapters: adapters(), clock: () => now,
    allowTestWitness: true,
  }), /acceptance coordinator/);

  const run = start('acceptance-success');
  run.kernel.recordVerification({ purpose: 'tests' });
  run.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' });
  run.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'ux' });
  run.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const result = await run.kernel.accept({ capability: run.owner_capability, timeoutMilliseconds: 1000 });
  assert.equal(result.accepted, true);
  assert.equal(run.kernel.getState().terminal_reason, 'accepted');
  const types = run.kernel.getLedger().events.slice(-2).map((event) => event.type);
  assert.deepEqual(types, ['acceptance', 'complete']);
  assert.equal(run.coordinator.releases, 0, 'accepted commit closes its coordinator lease atomically');
  assert.equal(verifyLedger(run.kernel.getLedger(), {
    witness: run.witness,
    requireWitness: true,
    acceptanceAuthority: run.coordinator,
    allowTestAcceptanceCoordinator: true,
  }).state.terminal_reason, 'accepted');
  assert.equal(run.kernel.getLedger().events.every((event) => (
    event.acceptance_authority_hash === run.kernel.getLedger().header.acceptance_authority_hash
  )), true);
  const substitutedCoordinatorHeader = run.kernel.getLedger();
  substitutedCoordinatorHeader.header.acceptance_authority.binding.identity = 'substituted-coordinator';
  substitutedCoordinatorHeader.header.acceptance_authority.binding_hash = hash(
    substitutedCoordinatorHeader.header.acceptance_authority.binding,
  );
  substitutedCoordinatorHeader.header.acceptance_authority_hash = hash(
    substitutedCoordinatorHeader.header.acceptance_authority,
  );
  assert.throws(() => verifyLedger(substitutedCoordinatorHeader, {
    witness: run.witness,
    requireWitness: true,
  }), /acceptance authority commitment/);
  assert.throws(() => verifyLedger(run.kernel.getLedger(), {
    witness: new MemoryWitness({ streamId: 'wrong-acceptance-witness' }),
    requireWitness: true,
  }), /acceptance authority binding/);
  const resumed = OwnerKernel.resume({
    ledger: run.kernel.getLedger(), witness: run.witness, adapters: adapters(), clock: () => now,
    allowTestWitness: true, acceptanceAuthority: run.coordinator, allowTestAcceptanceCoordinator: true,
    nonceFactory: () => 'r'.repeat(64),
  });
  assert.equal(resumed.kernel.getState().terminal_reason, 'accepted');
  assert.throws(() => OwnerKernel.resume({
    ledger: run.kernel.getLedger(), witness: run.witness, adapters: adapters(), clock: () => now,
    allowTestWitness: true,
    acceptanceAuthority: { ...authority(), attestation_hash: hash('wrong-coordinator') },
    allowTestAcceptanceCoordinator: true, nonceFactory: () => 's'.repeat(64),
  }), /acceptance coordinator/);

  const insufficient = start('acceptance-insufficient');
  insufficient.kernel.recordEvidence({ purpose: 'advisory-only' });
  const failure = await insufficient.kernel.accept({ capability: insufficient.owner_capability, timeoutMilliseconds: 1000 });
  assert.equal(failure.accepted, false);
  assert.equal(insufficient.kernel.getState().status, 'blocked');
  assert.equal(insufficient.kernel.getLedger().events.some((event) => event.payload.evidence_kind === 'acceptance_failure'), true);

  const highRisk = start('baseline-high-risk', {
    acceptanceContract: executableOnlyContract('baseline-high-risk-contract'),
  });
  highRisk.kernel.recordVerification({ purpose: 'tests' });
  highRisk.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const highRiskFailure = await highRisk.kernel.accept({
    capability: highRisk.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(highRiskFailure.accepted, false);
  assert.equal(highRisk.kernel.getState().status, 'blocked');

  const mixed = start('baseline-mixed');
  mixed.kernel.recordVerification({ purpose: 'tests' });
  mixed.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' });
  mixed.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const mixedFailure = await mixed.kernel.accept({
    capability: mixed.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(mixedFailure.accepted, false);
  assert.equal(mixed.kernel.getState().status, 'blocked');

  const nonExecutable = start('baseline-non-executable', {
    acceptanceContract: nonExecutableOnlyContract('baseline-non-executable-contract'),
  });
  nonExecutable.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const nonExecutableFailure = await nonExecutable.kernel.accept({
    capability: nonExecutable.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(nonExecutableFailure.accepted, false);
  assert.equal(nonExecutable.kernel.getState().status, 'blocked');

  const unavailableAdapters = adapters();
  unavailableAdapters.challengeVerifier = () => ({ ok: false });
  const unavailable = start('baseline-unavailable-challenger', { adapters: unavailableAdapters });
  unavailable.kernel.recordVerification({ purpose: 'tests' });
  assert.throws(
    () => unavailable.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' }),
    /not verified/,
  );
  unavailable.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const unavailableFailure = await unavailable.kernel.accept({
    capability: unavailable.owner_capability,
    timeoutMilliseconds: 1000,
  });
  assert.equal(unavailableFailure.accepted, false);
  assert.equal(unavailable.kernel.getState().status, 'blocked');

  const drift = start('acceptance-drift', {
    coordinator: authority({ snapshotOverrides: { delivered_artifacts: [{ id: 'workspace', sha256: hash('other') }] } }),
  });
  drift.kernel.recordVerification({ purpose: 'tests' });
  drift.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' });
  drift.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'ux' });
  drift.kernel.recordAuditReconciliation({ purpose: 'audit' });
  await assert.rejects(() => drift.kernel.accept({ capability: drift.owner_capability, timeoutMilliseconds: 1000 }), /candidate and delivered manifests/);
  assert.equal(drift.kernel.getLedger().events.some((event) => event.type === 'acceptance' || event.type === 'complete'), false);
  assert.equal(drift.coordinator.releases, 1, 'an invalid acquired snapshot still releases its host lease');

  const lostWitness = new MemoryWitness({ streamId: 'acceptance-response-lost-witness' });
  const lostCoordinator = authority({ witness: lostWitness, responseLostAfterCommit: true });
  const lost = start('acceptance-response-lost', { witness: lostWitness, coordinator: lostCoordinator });
  lost.kernel.recordVerification({ purpose: 'tests' });
  lost.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' });
  lost.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'ux' });
  lost.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const inlineRecovered = await lost.kernel.accept({ capability: lost.owner_capability, timeoutMilliseconds: 1000 });
  assert.equal(inlineRecovered.accepted, true);
  assert.equal(inlineRecovered.recovered, true);
  assert.equal(lost.kernel.getState().acceptance_attempt.status, 'accepted');
  assert.equal(lost.kernel.getLedger().events.some((event) => event.type === 'acceptance'), true);
  const resumedLost = OwnerKernel.resume({
    ledger: lost.kernel.getLedger(), witness: lostWitness, adapters: adapters(), clock: () => now,
    allowTestWitness: true, acceptanceAuthority: lostCoordinator, allowTestAcceptanceCoordinator: true,
    nonceFactory: () => 'l'.repeat(64),
  });
  assert.equal(resumedLost.acceptance_recovery, undefined);
  assert.equal(resumedLost.kernel.getState().terminal_reason, 'accepted');
  assert.equal(verifyLedger(resumedLost.kernel.getLedger(), {
    witness: lostWitness,
    requireWitness: true,
    acceptanceAuthority: lostCoordinator,
    allowTestAcceptanceCoordinator: true,
  }).state.terminal_reason, 'accepted');

  const batchWitness = new MemoryWitness({ streamId: 'acceptance-batch-fail-witness' });
  let batchAbortResponse = null;
  let batch;
  batchWitness.appendBatchIfHead = () => {
    batchAbortResponse = batch.kernel.userAbort({
      signed: true,
      payload: { reason: 'abort-during-unconfirmed-batch' },
    });
    throw new Error('batch witness outage');
  };
  batch = start('acceptance-batch-fail', { witness: batchWitness });
  batch.kernel.recordVerification({ purpose: 'tests' });
  batch.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'tests' });
  batch.kernel.recordChallenge({ purpose: 'challenge', scope_id: 'ux' });
  batch.kernel.recordAuditReconciliation({ purpose: 'audit' });
  const batchResult = await batch.kernel.accept({ capability: batch.owner_capability, timeoutMilliseconds: 1000 });
  assert.equal(batchResult.accepted, false);
  assert.equal(batchResult.aborted, true);
  assert.equal(batch.kernel.getLedger().events.some((event) => event.type === 'acceptance' || event.type === 'complete'), false);
  assert.equal(batch.coordinator.releases, 1);
  const queuedAbort = await batchAbortResponse;
  assert.equal(queuedAbort.acceptance_abort_queued, true);
  assert.equal(typeof queuedAbort.attempt_id, 'string');
  assert.equal(batch.kernel.getState().terminal_reason, 'user_abort');

  const counters = start('acceptance-counters');
  const decision = counters.kernel.mintDecision({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'delegate' },
    actionClass: 'read_only',
    actionDescriptor: { operation: 'inspect' },
  });
  counters.kernel.delegate({ capability: counters.owner_capability, ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'd1' }, decisionId: decision.payload.decision_id, dispatchEnvelope: {} });
  assert.equal(counters.kernel.getState().status, 'blocked');
  assert.throws(() => counters.kernel.delegate({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'd2' },
    decisionId: decision.payload.decision_id,
    dispatchEnvelope: {},
  }), /delegation.*budget/i);
  const resetDecision = counters.kernel.mintDecision({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'reset-delegate' },
    actionClass: 'read_only',
    actionDescriptor: { operation: 'inspect-reset' },
  });
  assert.equal(counters.kernel.getState().status, 'decide');
  counters.kernel.recover({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'recover-1' },
    decisionId: resetDecision.payload.decision_id,
    reason: 'retry_after_delegate_limit',
    sourceEvidenceIds: ['evidence-1'],
  });
  assert.equal(counters.kernel.getState().status, 'blocked');
  assert.throws(() => counters.kernel.recover({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'recover-2' },
    decisionId: resetDecision.payload.decision_id,
    reason: 'must_not_retry',
    sourceEvidenceIds: ['evidence-2'],
  }), /recovery.*budget/i);
  counters.kernel.mintDecision({
    capability: counters.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'reset-recovery' },
    actionClass: 'read_only',
    actionDescriptor: { operation: 'inspect-after-recovery' },
  });
  assert.equal(counters.kernel.getState().status, 'decide');

  const workerFailure = start('baseline-worker-failure', {
    governanceConfig: config({ maxRecoverCycles: 2 }),
  });
  const workerDecision = workerFailure.kernel.mintDecision({
    capability: workerFailure.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'worker-failure' },
    actionClass: 'read_only',
    actionDescriptor: { operation: 'inspect-worker-failure' },
  });
  const workerEvidence = workerFailure.kernel.recordEvidence({ purpose: 'worker-failed' });
  workerFailure.kernel.recover({
    capability: workerFailure.owner_capability,
    ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'worker-recovery' },
    decisionId: workerDecision.payload.decision_id,
    reason: 'worker_exit_nonzero',
    sourceEvidenceIds: [workerEvidence.payload.evidence_id],
  });
  assert.equal(workerFailure.kernel.getState().status, 'recover');

  console.log(JSON.stringify({
    assertions: 61,
    corpus_evidence: {
      baseline_categories: {
        low_risk_executable: 'accept',
        high_risk_executable: 'block',
        mixed_executable_non_executable: 'block',
        non_executable_design: 'block',
        acceptance_substitution: 'block',
        worker_failure: 'recover',
        unavailable_challenger: 'block',
      },
    },
  }));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "P2b acceptance protocol process exits cleanly"
assert_contains "$OUT" '"assertions":61' "P2b acceptance protocol assertions pass"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi
finalize_test
