#!/usr/bin/env bash
# Negative controls for P1. Each attack must fail before an action mediator exists.
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
  verifyEvent,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(`attestation:${identity}`),
  issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
});
const entry = (identity, role) => ({
  identity, model_alias: identity, model_version: '1', family: 'test', runner: 'test', role,
  attestation: attestation(identity),
});
function config(maxBlocked = 86400) {
  return { schema_version: 1, governance: {
    default_mode: 'owner-led',
    owner_roster: [entry('owner-a', 'owner'), entry('owner-b', 'owner')],
    challenger_roster: [entry('challenger-a', 'challenger')],
    trusted_runner_roster: [entry('runner-a', 'trusted_runner')],
    approval_policy: {
      read_only: { requires_approval: false, max_uses: 1 },
      reversible: { requires_approval: false, max_uses: 1 },
      external: { requires_approval: true, max_uses: 2 },
      irreversible: { requires_approval: true, max_uses: 1 },
    },
    capability_ttl_seconds: 3600,
    checkpoint_interval_closed_events: 100,
    max_blocked_duration_seconds: maxBlocked,
  }};
}
const acceptanceContract = { schema_version: 1, contract_id: 'adversarial', legs: [{ id: 'leg', kind: 'executable', command: 'true', artifact_hashes: [hash('leg')] }] };

function adapters({ qualification = true } = {}) {
  return {
    userInputVerifier(envelope, kind, context) {
      if (!envelope || envelope.signed !== true) return { ok: false };
      return { ok: true, kind, run_id: context.run_id, identity: 'user-a', channel: 'host-user', envelope_hash: hash({ kind, envelope }), payload: envelope.payload };
    },
    ownerTurnVerifier(envelope, context) {
      if (!envelope || envelope.witnessed !== true) return { ok: false };
      return { ok: true, run_id: context.run_id, principal_id: context.principal_id, identity: envelope.identity, channel: 'host-owner-turn', envelope_hash: hash(envelope), payload: {} };
    },
    principalResolver({ candidate_id, run_id, from_principal_id }) {
      return { ok: true, run_id, from_principal_id, identity: candidate_id, attestation_sha256: hash(`attestation:${candidate_id}`) };
    },
    qualificationVerifier({ principal, run_id }) {
      return qualification
        ? { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 }
        : { ok: false };
    },
  };
}

function start(runId, options = {}) {
  const witness = new MemoryWitness({ streamId: `${runId}-witness` });
  let now = '2026-07-01T00:00:00.000Z';
  const started = OwnerKernel.start({
    runId,
    governanceConfig: config(options.maxBlocked),
    acceptanceContract,
    initialIntentEnvelope: { signed: true, payload: { text: 'Begin', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a',
    witness,
    adapters: options.adapters || adapters(),
    allowTestWitness: true,
    clock: () => now,
    nonceFactory: () => `${runId}`.padEnd(64, 'n'),
  });
  return { ...started, witness, setNow(value) { now = value; } };
}

function refreshEvent(event) {
  const copy = JSON.parse(JSON.stringify(event));
  const content = {
    schema_version: copy.schema_version,
    sequence: copy.sequence,
    run_id: copy.run_id,
    type: copy.type,
    emitted_at: copy.emitted_at,
    emitter: copy.emitter,
    policy_hash: copy.policy_hash,
    contract_hash: copy.contract_hash,
    payload: copy.payload,
  };
  copy.content_hash = hash(content);
  copy.event_hash = hash({ content_hash: copy.content_hash, prev_event_hash: copy.prev_event_hash });
  copy.witness.event_hash = copy.event_hash;
  return copy;
}

const run = start('adversarial-run');
const decision = run.kernel.mintDecision({
  capability: run.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'external' },
  actionClass: 'external',
  actionDescriptor: { operation: 'external_write' },
  maxUses: 2,
});

const clonedCapability = JSON.parse(JSON.stringify(run.owner_capability));
assert.throws(() => run.kernel.mintDecision({
  capability: clonedCapability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'forged-cap' },
  actionClass: 'read_only',
  actionDescriptor: { operation: 'read' },
}), /in-memory owner capability/);

const eventsBeforeForgedUser = run.kernel.getLedger().events.length;
assert.throws(() => run.kernel.captureIntent({
  signed: false,
  payload: { text: 'forge user input', explicit_action_hashes: [] },
}), /not verified/);
assert.equal(run.kernel.getLedger().events.length, eventsBeforeForgedUser);

const eventsBeforeStaleApproval = run.kernel.getLedger().events.length;
run.kernel.captureIntent({ signed: true, payload: { text: 'new intent', explicit_action_hashes: [] } });
assert.throws(() => run.kernel.submitApproval({
  signed: true,
  payload: {
    decision_id: decision.payload.decision_id,
    decision_content_hash: decision.payload.decision_content_hash,
    max_uses: 2,
  },
}), /suspended decision/);
assert.ok(run.kernel.getLedger().events.length > eventsBeforeStaleApproval);

const validLedger = run.kernel.getLedger();
const tamperedHash = JSON.parse(JSON.stringify(validLedger));
tamperedHash.events[0].payload.text = 'tampered';
assert.throws(() => verifyLedger(tamperedHash), /content_hash/);

const unsignedEvent = JSON.parse(JSON.stringify(validLedger.events[0]));
delete unsignedEvent.witness;
assert.throws(() => verifyEvent(unsignedEvent), /authoritative event requires a witness receipt/);

const crossRun = JSON.parse(JSON.stringify(validLedger));
crossRun.events[0].run_id = 'other-run';
crossRun.events[0].witness.run_id = 'other-run';
crossRun.events[0] = refreshEvent(crossRun.events[0]);
assert.throws(() => verifyLedger(crossRun), /does not belong to the ledger header/);

const forgedOwnerEvent = JSON.parse(JSON.stringify(validLedger));
const targetIndex = forgedOwnerEvent.events.findIndex((event) => event.type === 'decision');
forgedOwnerEvent.events[targetIndex].emitter = { kind: 'user', identity: 'workspace-forger', channel: 'workspace-file' };
forgedOwnerEvent.events[targetIndex] = refreshEvent(forgedOwnerEvent.events[targetIndex]);
assert.throws(() => verifyLedger(forgedOwnerEvent), /cannot be minted/);

const outOfRoster = JSON.parse(JSON.stringify(validLedger));
const principalIndex = outOfRoster.events.findIndex((event) => event.type === 'principal_change');
outOfRoster.events[principalIndex].payload.to_principal_id = 'owner-not-in-roster';
outOfRoster.events[principalIndex].payload.attestation = attestation('owner-not-in-roster');
outOfRoster.events[principalIndex] = refreshEvent(outOfRoster.events[principalIndex]);
assert.throws(() => verifyLedger(outOfRoster), /outside frozen owner roster/);

const crossRunAdapter = adapters();
crossRunAdapter.userInputVerifier = (_envelope, kind) => ({
  ok: true,
  kind,
  run_id: 'wrong-run',
  identity: 'user-a',
  channel: 'replayed-user-channel',
  envelope_hash: hash('wrong-run-envelope'),
  payload: { text: 'wrong run', explicit_action_hashes: [] },
});
assert.throws(() => start('adapter-bound-run', { adapters: crossRunAdapter }), /not bound to the current run/);

const forgedEvidenceAdapters = adapters();
forgedEvidenceAdapters.evidenceVerifier = (_request, context) => ({
  ok: true,
  run_id: context.run_id,
  identity: 'runner-a',
  channel: 'forged-runner-proof',
  envelope_hash: hash('forged-evidence'),
  payload: {
    emitter_kind: 'runner',
    verification_path: 'trusted_runner',
    attestation_sha256: hash('wrong-runner-attestation'),
    artifact_hashes: [hash('forged-artifact')],
  },
});
forgedEvidenceAdapters.evidenceArchiver = () => ({ uri: 'durable://forged', sha256: hash('forged-durable') });
const forgedEvidence = start('evidence-run', { adapters: forgedEvidenceAdapters });
assert.throws(() => forgedEvidence.kernel.recordEvidence({ kind: 'unverified' }), /frozen trusted-runner roster/);

const timeout = start('timeout-run', { maxBlocked: 3600 });
const timeoutDecision = timeout.kernel.mintDecision({
  capability: timeout.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'timeout' },
  actionClass: 'external',
  actionDescriptor: { operation: 'wait_for_user' },
  maxUses: 2,
});
assert.equal(timeout.kernel.getState().status, 'blocked');
timeout.setNow('2026-07-01T02:00:00.000Z');
assert.equal(timeout.kernel.checkBlockedTimeout(), true);
assert.equal(timeout.kernel.getState().terminal_reason, 'timeout_abort');
assert.throws(() => timeout.kernel.submitApproval({
  signed: true,
  payload: {
    decision_id: timeoutDecision.payload.decision_id,
    decision_content_hash: timeoutDecision.payload.decision_content_hash,
    max_uses: 2,
  },
}), /terminal completion/);

const monitored = start('monitor-run', { maxBlocked: 3600 });
monitored.kernel.mintDecision({
  capability: monitored.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'monitor' },
  actionClass: 'external',
  actionDescriptor: { operation: 'monitor_wait' },
  maxUses: 2,
});
let monitorTick = null;
let monitorCleared = false;
monitored.kernel.startBlockedTimeoutMonitor({
  pollMilliseconds: 1000,
  setIntervalFn(callback) { monitorTick = callback; return 'test-timer'; },
  clearIntervalFn(timer) { monitorCleared = timer === 'test-timer'; },
});
monitored.setNow('2026-07-01T02:00:00.000Z');
monitorTick();
assert.equal(monitored.kernel.getState().terminal_reason, 'timeout_abort');
assert.equal(monitorCleared, true);

let qualificationAvailable = true;
const revokingAdapters = adapters();
revokingAdapters.qualificationVerifier = ({ principal, run_id }) => (qualificationAvailable
  ? { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 }
  : { ok: false });
const badQualification = start('qualification-run', { adapters: revokingAdapters });
qualificationAvailable = false;
assert.throws(() => badQualification.kernel.mintDecision({
  capability: badQualification.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'qualification-fail' },
  actionClass: 'read_only',
  actionDescriptor: { operation: 'nope' },
}), /authority was revoked/);
assert.equal(badQualification.kernel.getState().active_principal, null);
assert.equal(badQualification.kernel.getState().status, 'blocked');

console.log('forgery_controls=ok');
console.log('cross_run_controls=ok');
console.log('approval_supersession=ok');
console.log('timeout_and_qualification=ok');
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "Owner Kernel adversarial controls process exits cleanly"
assert_contains "$OUT" "forgery_controls=ok" "Forged capabilities, user input, and event hashes are blocked"
assert_contains "$OUT" "cross_run_controls=ok" "Cross-run and roster forgery are blocked"
assert_contains "$OUT" "approval_supersession=ok" "Superseded approvals remain blocked"
assert_contains "$OUT" "timeout_and_qualification=ok" "Timeout abort and qualification revocation are fail-closed"

finalize_test
