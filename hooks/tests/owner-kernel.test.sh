#!/usr/bin/env bash
# Core P1 governance contract: trusted adapter minting, deterministic replay,
# exact approvals, principal authority, and decision-only disclosure.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const {
  MemoryWitness,
  OwnerKernel,
  canonicalJson,
  freezeAcceptanceContract,
  parseLedgerJsonl,
  replayFromLatestCheckpoint,
  resolveGovernancePolicy,
  sha256,
  validateEventShape,
  verifyLedger,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const ATTESTATION_START = '2026-01-01T00:00:00.000Z';
const ATTESTATION_END = '2027-01-01T00:00:00.000Z';

function rosterEntry(identity, role, family = 'test') {
  return {
    identity,
    model_alias: `${identity}-model`,
    model_version: '1',
    family,
    runner: `${identity}-runner`,
    role,
    attestation: {
      issuer: 'test-attestor',
      uri: `test://${identity}`,
      sha256: hash(`attestation:${identity}`),
      issued_at: ATTESTATION_START,
      expires_at: ATTESTATION_END,
    },
  };
}

function governanceConfig(interval = 3) {
  return {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led',
      owner_roster: [
        rosterEntry('owner-a', 'owner', 'openai'),
        rosterEntry('owner-b', 'owner', 'xai'),
      ],
      challenger_roster: [rosterEntry('challenger-a', 'challenger', 'minimax')],
      trusted_runner_roster: [rosterEntry('runner-a', 'trusted_runner', 'kernel')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 },
        reversible: { requires_approval: false, max_uses: 1 },
        external: { requires_approval: true, max_uses: 2 },
        irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: interval,
      max_blocked_duration_seconds: 86400,
    },
  };
}

function contract() {
  return {
    schema_version: 1,
    contract_id: 'owner-kernel-test-contract',
    legs: [{
      id: 'unit',
      kind: 'executable',
      command: 'node --test',
      artifact_hashes: [hash('artifact:unit')],
    }],
  };
}

let tick = 0;
const clock = () => new Date(Date.UTC(2026, 6, 1, 0, 0, tick++)).toISOString();
const adapters = {
  userInputVerifier(envelope, kind, context) {
    if (!envelope || envelope.signed !== true || !envelope.payload) return { ok: false };
    return {
      ok: true,
      kind,
      run_id: context.run_id,
      identity: 'user:test',
      channel: 'authenticated-test-input',
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
      channel: 'host-owner-turn',
      envelope_hash: hash({ turn: envelope.turn }),
      payload: {},
    };
  },
  principalResolver({ candidate_id, run_id, from_principal_id }) {
    return {
      ok: true,
      run_id,
      from_principal_id,
      identity: candidate_id,
      attestation_sha256: hash(`attestation:${candidate_id}`),
      outcome: 'frozen_roster_qualified',
    };
  },
  qualificationVerifier({ principal, run_id }) {
    return { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 };
  },
  evidenceVerifier(request, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'runner-a',
      channel: 'trusted-runner-verify',
      envelope_hash: hash({ request, context }),
      payload: {
        emitter_kind: 'runner',
        verification_path: 'trusted_runner',
        attestation_sha256: hash('attestation:runner-a'),
        artifact_hashes: [hash('evidence-artifact')],
      },
    };
  },
  evidenceArchiver() {
    return { uri: 'durable://evidence/test', sha256: hash('durable-evidence') };
  },
  translationVerifier(envelope, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'translation-adapter',
      channel: 'host-translation',
      envelope_hash: hash({ envelope, context }),
      payload: { source: hash('source'), target: hash('target') },
    };
  },
};

const config = governanceConfig();
const eventSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'owner-event.schema.json'), 'utf8'));
assert.equal(eventSchema.properties.type.enum.includes('decision'), true);
assert.equal(eventSchema.properties.type.enum.includes('principal_change'), true);
const override = resolveGovernancePolicy(config, { modeOverride: 'milestone-led' });
assert.equal(override.policy.mode, 'milestone-led');
assert.equal(override.policy.mode_source, 'run-override');
assert.equal(resolveGovernancePolicy(config, { modeOverride: 'owner-led' }).policy.mode_source, 'run-override');
assert.equal(config.governance.default_mode, 'owner-led');
assert.equal(resolveGovernancePolicy(config).policy_hash, resolveGovernancePolicy(config).policy_hash);
assert.equal(canonicalJson({ z: 1, a: [true, null] }), canonicalJson({ a: [true, null], z: 1 }));
assert.throws(() => freezeAcceptanceContract({
  schema_version: 1,
  contract_id: 'empty-command',
  legs: [{ id: 'bad', kind: 'executable', command: '', artifact_hashes: [hash('bad-leg')] }],
}), /command must be non-empty/);

const explicitDescriptor = { operation: 'inspect', target: 'src' };
const witness = new MemoryWitness({ streamId: 'test-witness-stream' });
const started = OwnerKernel.start({
  runId: 'owner-kernel-p1-test',
  governanceConfig: config,
  acceptanceContract: contract(),
  initialIntentEnvelope: {
    signed: true,
    payload: {
      text: 'Inspect this project and make one explicitly requested inspection decision.',
      explicit_action_hashes: [hash(explicitDescriptor)],
    },
  },
  initialOwnerId: 'owner-a',
  witness,
  adapters,
  clock,
  allowTestWitness: true,
  nonceFactory: () => 'a'.repeat(64),
});
const kernel = started.kernel;
const explicitDecision = kernel.mintDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'one' },
  actionClass: 'read_only',
  actionDescriptor: explicitDescriptor,
});
assert.equal(explicitDecision.payload.intent_relation, 'explicit');
assert.equal(kernel.disclosure().decisions.length, 0);

const derivedDecision = kernel.mintDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'two' },
  actionClass: 'external',
  actionDescriptor: { operation: 'open_issue', target: 'owner-kernel' },
  maxUses: 2,
});
assert.equal(kernel.getState().status, 'blocked');
const eventCountBeforeBadApproval = kernel.getLedger().events.length;
assert.throws(() => kernel.submitApproval({
  signed: true,
  payload: {
    decision_id: derivedDecision.payload.decision_id,
    decision_content_hash: derivedDecision.payload.decision_content_hash,
    max_uses: 1,
  },
}), /max_uses/);
assert.equal(kernel.getLedger().events.length, eventCountBeforeBadApproval);
kernel.submitApproval({
  signed: true,
  payload: {
    decision_id: derivedDecision.payload.decision_id,
    decision_content_hash: derivedDecision.payload.decision_content_hash,
    max_uses: 2,
  },
});
assert.equal(kernel.getState().status, 'decide');
assert.equal(kernel.disclosure().decisions.length, 1);
assert.equal(kernel.disclosure().decisions[0].decision_id, derivedDecision.payload.decision_id);
assert.equal(kernel.recordEvidence({ kind: 'verified-green' }).type, 'evidence');
assert.equal(kernel.recordTranslation({ kind: 'legacy-mode' }).type, 'translation_used');
assert.ok(kernel.getLedger().events.some((event) => event.type === 'checkpoint'));
assert.equal(typeof kernel.append, 'undefined');

assert.throws(() => kernel.mintDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'three' },
  actionClass: 'irreversible',
  actionDescriptor: { operation: 'publish' },
  maxUses: 2,
}), /requested_max_uses/);

const parsed = parseLedgerJsonl(kernel.serializeLedger());
const verified = verifyLedger(parsed, { witness, requireWitness: true });
assert.equal(canonicalJson(verified.state_projection), canonicalJson(kernel.getState()));
assert.equal(verified.witness_verified, true);
const checkpointReplay = replayFromLatestCheckpoint(parsed, verified);
assert.ok(checkpointReplay.checkpoint_sequence !== null);
assert.equal(canonicalJson(checkpointReplay.state), canonicalJson(verified.state));

const resumed = OwnerKernel.resume({
  ledger: parsed,
  witness,
  adapters,
  clock,
  allowTestWitness: true,
  nonceFactory: () => 'b'.repeat(64),
});
assert.equal(resumed.kernel.getState().active_principal.identity, 'owner-a');
assert.throws(() => resumed.kernel.mintDecision({
  capability: started.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'old-capability' },
  actionClass: 'read_only',
  actionDescriptor: { operation: 'read_old' },
}), /in-memory owner capability/);
const ownerB = resumed.kernel.activateOwner('owner-b', 'milestone_reinstantiation');
assert.equal(resumed.kernel.getState().active_principal.identity, 'owner-b');
const newDecision = resumed.kernel.mintDecision({
  capability: ownerB,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-b', turn: 'new-owner' },
  actionClass: 'read_only',
  actionDescriptor: { operation: 'inspect_after_resume' },
});
assert.equal(newDecision.payload.principal_id, 'owner-b');
resumed.kernel.captureIntent({
  signed: true,
  payload: { text: 'New intent replaces earlier work.', explicit_action_hashes: [] },
});
const superseded = resumed.kernel.getState().decisions[derivedDecision.payload.decision_id];
assert.equal(superseded.suspended, true);
assert.ok(resumed.kernel.getLedger().events.some((event) => event.type === 'suspension'));
assert.equal(resumed.kernel.disclosure().decisions.find((item) => item.decision_id === derivedDecision.payload.decision_id).status, 'superseded');
const suspensionCount = resumed.kernel.getLedger().events.filter((event) => event.type === 'suspension').length;
resumed.kernel.captureIntent({
  signed: true,
  payload: { text: 'A second replacement has no newly active decision to suspend.', explicit_action_hashes: [] },
});
assert.equal(
  resumed.kernel.getLedger().events.filter((event) => event.type === 'suspension').length,
  suspensionCount,
);

assert.throws(() => OwnerKernel.start({
  runId: 'untrusted-witness-test',
  governanceConfig: config,
  acceptanceContract: contract(),
  initialIntentEnvelope: { signed: true, payload: { text: 'no', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness: new MemoryWitness({ streamId: 'local-only', trustTier: 'external' }),
  adapters,
  clock,
}), /test\/local witness adapters/);

assert.throws(() => validateEventShape({
  schema_version: 1,
  sequence: 1,
  run_id: 'forged-run',
  type: 'decision',
  emitted_at: '2026-07-01T00:00:00.000Z',
  emitter: { kind: 'user', identity: 'forger', channel: 'workspace-file' },
  policy_hash: hash('policy'),
  contract_hash: hash('contract'),
  payload: {},
  prev_event_hash: null,
}), /cannot be minted/);

console.log('policy_override=ok');
console.log('exact_approval=ok');
console.log('checkpoint_replay=ok');
console.log('owner_capability=ok');
console.log('supersession_disclosure=ok');
console.log(JSON.stringify({
  corpus_evidence: {
    baseline_categories: {
      session_resume: 'accept',
      intent_amendment: 'block',
    },
  },
}));
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "Owner Kernel P1 core process exits cleanly"
assert_contains "$OUT" "policy_override=ok" "Project default plus run override is resolved"
assert_contains "$OUT" "exact_approval=ok" "Approval is bound to exact decision hash and uses"
assert_contains "$OUT" "checkpoint_replay=ok" "Checkpoint/replay stays deterministic"
assert_contains "$OUT" "owner_capability=ok" "Old capabilities are rejected after resume/principal change"
assert_contains "$OUT" "supersession_disclosure=ok" "New intent suspends prior decisions and disclosure is decision-only"
if [ "${AUTOPILOT_CORPUS_EVIDENCE:-0}" = "1" ]; then
  printf '%s\n' "$OUT"
fi

finalize_test
