#!/usr/bin/env bash
# P3.0 compatibility translation: deterministic/read-only at the public CLI,
# host-witnessed only through the opaque shadow runtime.
. "$(dirname "$0")/lib.sh"

CONFIG="$TEST_TMP/governance.json"

OUT="$(node - "$REPO_ROOT" "$CONFIG" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const configPath = process.argv[3];
const {
  MemoryWitness,
  OwnerKernel,
  ShadowTranslationRuntime,
  canonicalJson,
  createShadowTranslationEnvelope,
  freezeAcceptanceContract,
  parseLedgerJsonl,
  resolveGovernancePolicy,
  sha256,
  translateLegacyLevel,
  validateLedgerHeader,
  verifyShadowTranslationEnvelope,
  verifyLedger,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const {
  buildEvent,
  prepareEvent,
} = require(path.join(root, 'src', 'engine', 'owner-kernel', 'events'));

const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const now = '2026-07-23T00:00:00.000Z';
const attestation = (identity) => ({
  issuer: 'translation-test',
  uri: `test://${identity}`,
  sha256: hash(`attestation:${identity}`),
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2027-01-01T00:00:00.000Z',
});
const entry = (identity, role, family) => ({
  identity,
  model_alias: identity,
  model_version: 'test',
  family,
  runner: `${identity}-runner`,
  role,
  attestation: attestation(identity),
});
const config = {
  schema_version: 1,
  governance: {
    default_mode: 'owner-led',
    owner_roster: [entry('owner-a', 'owner', 'openai')],
    challenger_roster: [entry('challenger-a', 'challenger', 'xai')],
    trusted_runner_roster: [entry('runner-a', 'trusted_runner', 'host')],
    approval_policy: {
      read_only: { requires_approval: false, max_uses: 1 },
      reversible: { requires_approval: false, max_uses: 1 },
      external: { requires_approval: true, max_uses: 1 },
      irreversible: { requires_approval: true, max_uses: 1 },
    },
    capability_ttl_seconds: 3600,
    checkpoint_interval_closed_events: 100,
    max_blocked_duration_seconds: 86400,
    action_catalog: [],
    red_lines: ['no-production-push', 'no-secret-write'],
    assurance_profile: 'conservative',
  },
};
fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);

const resolved = resolveGovernancePolicy(config);
assert.deepEqual(resolved.policy.red_lines, ['no-production-push', 'no-secret-write']);
assert.equal(resolved.policy.assurance_profile, 'conservative');
const l5Solo = translateLegacyLevel({
  level: 'l5',
  flags: { solo: true, expand: true, red_line_additions: ['no-delete'] },
  policy: resolved.policy,
  policyHash: resolved.policy_hash,
});
assert.equal(l5Solo.target.topology.entry, 'l5');
assert.equal(l5Solo.target.topology.execution, 'inline');
assert.equal(l5Solo.target.topology.degraded_from, 'l5');
assert.equal(l5Solo.target.scope, 'expand');
assert.deepEqual(l5Solo.target.red_lines, ['no-delete', 'no-production-push', 'no-secret-write']);
assert.equal(
  l5Solo.source_hash,
  translateLegacyLevel({
    level: 'l5',
    flags: { solo: true, expand: true, red_line_additions: ['no-delete'] },
    policy: resolved.policy,
    policyHash: resolved.policy_hash,
  }).source_hash,
);
assert.throws(() => translateLegacyLevel({
  level: 'l3', flags: { solo: true }, policy: resolved.policy, policyHash: resolved.policy_hash,
}), /not valid for l3/);
assert.throws(() => translateLegacyLevel({
  level: 'l7', flags: {}, policy: resolved.policy, policyHash: resolved.policy_hash,
}), /legacy level/);
assert.throws(() => translateLegacyLevel({
  level: 'l3', flags: {}, policy: { ...resolved.policy, red_lines: ['forged-red-line'] }, policyHash: resolved.policy_hash,
}), /does not match the canonical policy/);
assert.throws(() => translateLegacyLevel({
  level: 'l3', flags: { red_lines: [] }, policy: resolved.policy, policyHash: resolved.policy_hash,
}), /unsupported key/);
assert.throws(() => resolveGovernancePolicy({
  ...config,
  governance: { ...config.governance, red_lines: ['no-delete', 'no-delete'] },
}), /duplicates/);
assert.throws(() => ShadowTranslationRuntime.start({ actionAuthority: {} }), /never accepts actionAuthority/);
assert.throws(() => ShadowTranslationRuntime.start({ acceptanceAuthority: {} }), /never accepts actionAuthority or acceptanceAuthority/);

const adapters = {
  userInputVerifier(envelope, kind, context) {
    return {
      ok: true,
      kind,
      run_id: context.run_id,
      identity: 'user-a',
      channel: 'authenticated-user',
      envelope_hash: hash({ envelope, kind, run_id: context.run_id }),
      payload: envelope.payload,
    };
  },
  ownerTurnVerifier(envelope, context) {
    return {
      ok: true,
      run_id: context.run_id,
      principal_id: context.principal_id,
      identity: context.principal_id,
      channel: 'host-owner-turn',
      envelope_hash: hash({ envelope, run_id: context.run_id }),
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
  translationVerifier(envelope, context) {
    return {
      ok: true,
      run_id: context.run_id,
      identity: 'host-translation-adapter',
      channel: 'trusted-host-translation',
      envelope_hash: hash({ envelope, run_id: context.run_id }),
      payload: {},
    };
  },
};
const invalidTierWitness = {
  streamId: 'shadow-invalid-tier-witness',
  trustTier: 'unknown',
  appendIfHead() {},
  getHead() { return null; },
  verify() { return true; },
};
assert.throws(() => ShadowTranslationRuntime.start({
  runId: 'shadow-invalid-tier', governanceConfig: config,
  initialIntentEnvelope: { payload: { text: 'no', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: invalidTierWitness, adapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'i'.repeat(64),
}), /external\/test witness/);
const tamperedMemoryWitness = new MemoryWitness({ streamId: 'shadow-tampered-memory-witness' });
assert.equal(Reflect.set(tamperedMemoryWitness, 'trustTier', 'external'), false);
assert.equal(tamperedMemoryWitness.trustTier, 'test');
assert.throws(() => ShadowTranslationRuntime.start({
  runId: 'shadow-tampered-memory', governanceConfig: config,
  initialIntentEnvelope: { payload: { text: 'no', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: tamperedMemoryWitness, adapters,
  clock: () => now, nonceFactory: () => 'm'.repeat(64),
}), /test\/local witness adapters/);
const witness = new MemoryWitness({ streamId: 'shadow-translation-test-witness' });
const started = ShadowTranslationRuntime.start({
  runId: 'shadow-translation-run',
  governanceConfig: config,
  initialIntentEnvelope: { payload: { text: 'Run one bounded shadow translation.', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a',
  witness,
  adapters,
  allowTestWitness: true,
  clock: () => now,
  nonceFactory: () => 't'.repeat(64),
});
assert.equal(started.owner_kernel_authority, 'shadow');
assert.equal(started.acceptance, 'not_available');
assert.equal(started.witness_assurance, 'test_only_not_eligible_for_alias_retirement');
assert.equal(started.alias_retirement_eligible, false);
const first = started.runtime.recordLevelTranslation({
  level: 'l3',
  invocationId: 'l3-shadow-invocation',
  flags: { expand: true, red_line_additions: ['no-delete'] },
});
assert.equal(first.status, 'shadow_recorded');
assert.equal(first.idempotent, false);
assert.equal(first.witness_assurance, 'test_only_not_eligible_for_alias_retirement');
assert.equal(first.alias_retirement_eligible, false);
assert.equal(first.event.type, 'translation_used');
assert.equal(first.witness_receipt.event_hash, first.event.event_hash);
assert.equal(first.translation.target.topology.execution, 'inline');
assert.equal(first.translation.target.owner_kernel_authority, 'none');
assert.equal(first.translation.target.shadow_telemetry, 'eligible');
assert.equal(first.translation.target.acceptance, 'not_available');
assert.deepEqual(first.translation.target.red_lines, ['no-delete', 'no-production-push', 'no-secret-write']);
const retried = started.runtime.recordLevelTranslation({
  level: 'l3',
  invocationId: 'l3-shadow-invocation',
  flags: { expand: true, red_line_additions: ['no-delete'] },
});
assert.equal(retried.idempotent, true);
assert.equal(retried.event.event_hash, first.event.event_hash);
const ledger = parseLedgerJsonl(started.runtime.serializeLedger());
assert.equal(ledger.events.filter((event) => event.type === 'translation_used').length, 1);
fs.writeFileSync(path.join(path.dirname(configPath), 'shadow-ledger.jsonl'), started.runtime.serializeLedger());
const verified = verifyLedger(ledger, { witness, requireWitness: true });
assert.equal(verified.state.status, 'decide');
const preP3Header = JSON.parse(JSON.stringify(ledger.header));
delete preP3Header.policy.red_lines;
delete preP3Header.policy.assurance_profile;
delete preP3Header.policy.guidance_profile;
delete preP3Header.policy.topology_preference;
delete preP3Header.policy.data_egress;
preP3Header.policy_hash = hash(preP3Header.policy);
assert.doesNotThrow(() => validateLedgerHeader(preP3Header));
const partialP3Header = JSON.parse(JSON.stringify(ledger.header));
delete partialP3Header.policy.assurance_profile;
partialP3Header.policy_hash = hash(partialP3Header.policy);
assert.throws(() => validateLedgerHeader(partialP3Header), /partial P3 governance field set/);
const p4WithoutP3Header = JSON.parse(JSON.stringify(ledger.header));
delete p4WithoutP3Header.policy.red_lines;
delete p4WithoutP3Header.policy.assurance_profile;
p4WithoutP3Header.policy_hash = hash(p4WithoutP3Header.policy);
assert.throws(
  () => validateLedgerHeader(p4WithoutP3Header),
  /cannot include P4 execution-profile fields without P3 governance fields/,
);
const historicalTranslation = JSON.parse(JSON.stringify(translateLegacyLevel({
  level: 'l3',
  flags: { expand: false, solo: false, red_line_additions: [] },
  policy: resolved.policy,
  policyHash: resolved.policy_hash,
})));
delete historicalTranslation.target.guidance_profile;
delete historicalTranslation.target.topology_preference;
delete historicalTranslation.target.data_egress;
historicalTranslation.target_hash = hash(historicalTranslation.target);
const historicalEnvelope = createShadowTranslationEnvelope({
  runId: 'historical-translation-run',
  invocationId: 'historical-pre-p4',
  translation: historicalTranslation,
});
assert.throws(
  () => verifyShadowTranslationEnvelope(historicalEnvelope, {
    runId: 'historical-translation-run',
    policy: resolved.policy,
    policyHash: resolved.policy_hash,
  }),
  /does not match the frozen policy version/,
);
const partialHistoricalEnvelope = JSON.parse(JSON.stringify(historicalEnvelope));
partialHistoricalEnvelope.target_detail.guidance_profile = 'adaptive';
partialHistoricalEnvelope.target = hash(partialHistoricalEnvelope.target_detail);
assert.throws(() => verifyShadowTranslationEnvelope(partialHistoricalEnvelope, {
  runId: 'historical-translation-run',
  policy: resolved.policy,
  policyHash: resolved.policy_hash,
}), /either all or none/);
const historicalHeader = JSON.parse(JSON.stringify(ledger.header));
delete historicalHeader.policy.guidance_profile;
delete historicalHeader.policy.topology_preference;
delete historicalHeader.policy.data_egress;
historicalHeader.policy_hash = hash(historicalHeader.policy);
historicalHeader.witness_stream_id = 'historical-pre-p4-shadow-witness';
const historicalContract = freezeAcceptanceContract({
  ...historicalHeader.acceptance_contract,
  legs: historicalHeader.acceptance_contract.legs.map((leg) => ({
    ...leg,
    artifact_hashes: [historicalHeader.policy_hash],
  })),
});
historicalHeader.acceptance_contract = historicalContract.contract;
historicalHeader.contract_hash = historicalContract.contract_hash;
validateLedgerHeader(historicalHeader);

const originalTranslationEvent = ledger.events.find((event) => event.type === 'translation_used');
const preP4Translation = translateLegacyLevel({
  level: originalTranslationEvent.payload.source_detail.legacy_level,
  flags: originalTranslationEvent.payload.source_detail.overrides,
  policy: historicalHeader.policy,
  policyHash: historicalHeader.policy_hash,
});
assert.equal(preP4Translation.source_hash, originalTranslationEvent.payload.source);
assert.equal(
  Object.prototype.hasOwnProperty.call(preP4Translation.target, 'guidance_profile'),
  false,
);

const historicalWitness = new MemoryWitness({
  streamId: historicalHeader.witness_stream_id,
});
let historicalEventHead = null;
const historicalEvents = ledger.events.map((originalEvent) => {
  const payload = JSON.parse(JSON.stringify(originalEvent.payload));
  if (originalEvent.type === 'translation_used') {
    payload.source = preP4Translation.source_hash;
    payload.target = preP4Translation.target_hash;
    payload.source_detail = preP4Translation.source;
    payload.target_detail = preP4Translation.target;
  }
  const eventInput = {
    sequence: originalEvent.sequence,
    runId: historicalHeader.run_id,
    type: originalEvent.type,
    emittedAt: originalEvent.emitted_at,
    emitter: originalEvent.emitter,
    policyHash: historicalHeader.policy_hash,
    contractHash: historicalHeader.contract_hash,
    payload,
    prevEventHash: historicalEventHead,
  };
  const prepared = prepareEvent(eventInput);
  const receipt = historicalWitness.append({
    run_id: historicalHeader.run_id,
    sequence: prepared.sequence,
    event_hash: prepared.event_hash,
  });
  const rebuilt = buildEvent({ ...eventInput, witness: receipt });
  historicalEventHead = rebuilt.event_hash;
  return rebuilt;
});
const historicalLedger = { header: historicalHeader, events: historicalEvents };
assert.equal(
  verifyLedger(historicalLedger, {
    witness: historicalWitness,
    requireWitness: true,
  }).state.status,
  'decide',
);
const historicalResumed = ShadowTranslationRuntime.resume({
  ledger: historicalLedger,
  witness: historicalWitness,
  adapters,
  allowTestWitness: true,
  clock: () => now,
  nonceFactory: () => 'j'.repeat(64),
});
const historicalRetry = historicalResumed.runtime.recordLevelTranslation({
  level: originalTranslationEvent.payload.source_detail.legacy_level,
  invocationId: originalTranslationEvent.payload.invocation_id,
  flags: originalTranslationEvent.payload.source_detail.overrides,
});
assert.equal(historicalRetry.idempotent, true);
assert.equal(historicalRetry.event.event_hash, historicalEvents.at(-1).event_hash);
assert.equal(historicalRetry.translation.target_hash, preP4Translation.target_hash);
assert.equal(
  Object.prototype.hasOwnProperty.call(historicalRetry.translation.target, 'guidance_profile'),
  false,
);
const historicalNewInvocation = historicalResumed.runtime.recordLevelTranslation({
  level: 'l3',
  invocationId: 'historical-pre-p4-new-invocation',
  flags: { expand: false, solo: false, red_line_additions: [] },
});
assert.equal(historicalNewInvocation.idempotent, false);
assert.equal(historicalNewInvocation.translation.target.policy_hash, historicalHeader.policy_hash);
assert.equal(
  Object.prototype.hasOwnProperty.call(
    historicalNewInvocation.translation.target,
    'guidance_profile',
  ),
  false,
);
const status = started.runtime.status();
assert.equal(status.translations.count, 1);
assert.equal(status.translations.latest.target.topology.execution, 'inline');
assert.equal(status.translations.latest.witness_receipt.event_hash, first.event.event_hash);
assert.equal(status.witness_assurance, 'test_only_not_eligible_for_alias_retirement');
assert.equal(status.alias_retirement_eligible, false);
assert.throws(() => started.runtime.recordLevelTranslation({
  level: 'l4', invocationId: 'l4-not-yet-active', flags: {},
}), /limited to l3/);

const resumed = ShadowTranslationRuntime.resume({
  ledger,
  witness,
  adapters,
  allowTestWitness: true,
  clock: () => now,
  nonceFactory: () => 'u'.repeat(64),
});
const resumedRetry = resumed.runtime.recordLevelTranslation({
  level: 'l3',
  invocationId: 'l3-shadow-invocation',
  flags: { expand: true, red_line_additions: ['no-delete'] },
});
assert.equal(resumedRetry.idempotent, true);
assert.equal(resumedRetry.event.event_hash, first.event.event_hash);

const raceLedger = parseLedgerJsonl(resumed.runtime.serializeLedger());
const raceA = ShadowTranslationRuntime.resume({
  ledger: raceLedger, witness, adapters, allowTestWitness: true,
  clock: () => now, nonceFactory: () => 'a'.repeat(64),
});
const raceB = ShadowTranslationRuntime.resume({
  ledger: raceLedger, witness, adapters, allowTestWitness: true,
  clock: () => now, nonceFactory: () => 'b'.repeat(64),
});
const raceFirst = raceA.runtime.recordLevelTranslation({
  level: 'l3', invocationId: 'race-first', flags: {},
});
assert.equal(raceFirst.idempotent, false);
assert.throws(() => raceB.runtime.recordLevelTranslation({
  level: 'l3', invocationId: 'race-stale', flags: {},
}), /witness head does not match/);
const raceNext = raceA.runtime.recordLevelTranslation({
  level: 'l3', invocationId: 'race-next', flags: {},
});
assert.equal(raceNext.idempotent, false);
witness.append({
  run_id: 'outside-shadow-run', stream_id: witness.streamId, sequence: 999,
  event_hash: hash('outside-shadow-event'), previous_witness_head: witness.getHead(),
});
assert.throws(() => raceA.runtime.status(), /witness head does not match/);
assert.throws(() => raceA.runtime.serializeLedger(), /witness head does not match/);
assert.throws(() => raceA.runtime.recordLevelTranslation({
  level: 'l3', invocationId: 'race-next', flags: {},
}), /witness head does not match/);

const genericContract = {
  schema_version: 1,
  contract_id: 'owner-kernel-shadow-telemetry-v1',
  legs: [{ id: 'translation-telemetry', kind: 'non_executable', artifact_hashes: [resolved.policy_hash] }],
};
const genericDecisionWitness = new MemoryWitness({ streamId: 'shadow-generic-decision-witness' });
const genericDecision = OwnerKernel.start({
  runId: 'shadow-generic-decision', governanceConfig: config, acceptanceContract: genericContract,
  initialIntentEnvelope: { payload: { text: 'no lifecycle events in shadow telemetry', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: genericDecisionWitness, adapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'd'.repeat(64),
});
genericDecision.kernel.mintDecision({
  capability: genericDecision.owner_capability,
  ownerTurnEnvelope: { witnessed: true, identity: 'owner-a', turn: 'generic-decision' },
  actionClass: 'read_only', actionDescriptor: { operation: 'inspect' },
});
assert.throws(() => ShadowTranslationRuntime.resume({
  ledger: genericDecision.kernel.getLedger(), witness: genericDecisionWitness, adapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'e'.repeat(64),
}), /does not permit decision events/);

const genericTranslationWitness = new MemoryWitness({ streamId: 'shadow-generic-translation-witness' });
const genericTranslationAdapters = {
  ...adapters,
  translationVerifier(envelope, context) {
    return {
      ok: true, run_id: context.run_id, identity: 'generic-translation-adapter',
      channel: 'generic-translation', envelope_hash: hash({ envelope, run_id: context.run_id }),
      payload: {
        translation_id: 'generic-translation', source: hash('generic-source'), target: hash('generic-target'),
      },
    };
  },
};
const genericTranslation = OwnerKernel.start({
  runId: 'shadow-generic-translation', governanceConfig: config, acceptanceContract: genericContract,
  initialIntentEnvelope: { payload: { text: 'no opaque translation telemetry', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: genericTranslationWitness, adapters: genericTranslationAdapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'f'.repeat(64),
});
genericTranslation.kernel.recordTranslation({ kind: 'opaque-translation' });
assert.throws(() => ShadowTranslationRuntime.resume({
  ledger: genericTranslation.kernel.getLedger(), witness: genericTranslationWitness, adapters: genericTranslationAdapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'g'.repeat(64),
}), /requires invocation_id/);

assert.throws(() => ShadowTranslationRuntime.start({
  runId: 'shadow-action-forbidden',
  governanceConfig: {
    ...config,
    governance: {
      ...config.governance,
      action_catalog: [{
        id: 'write', operation: 'write', tool_class: 'filesystem', action_class: 'external',
        command_required: false, requires_mediator: true, requires_challenge: false,
      }],
    },
  },
  initialIntentEnvelope: { payload: { text: 'no', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: new MemoryWitness({ streamId: 'shadow-action-witness' }), adapters,
  allowTestWitness: true, clock: () => now, nonceFactory: () => 'v'.repeat(64),
}), /empty action_catalog/);
assert.throws(() => ShadowTranslationRuntime.start({
  runId: 'shadow-untrusted-witness', governanceConfig: config,
  initialIntentEnvelope: { payload: { text: 'no', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness: new MemoryWitness({ streamId: 'shadow-untrusted-witness' }), adapters,
  clock: () => now, nonceFactory: () => 'w'.repeat(64),
}), /test\/local witness adapters/);
assert.equal(typeof OwnerKernel.prototype.append, 'undefined');

console.log('deterministic_mapping=ok');
console.log('shadow_witnessed_once=ok');
console.log('resume_idempotency=ok');
console.log('authority_boundary=ok');
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "Level governance translation core process exits cleanly"
assert_contains "$OUT" "deterministic_mapping=ok" "Translation table is deterministic and monotonic"
assert_contains "$OUT" "shadow_witnessed_once=ok" "Shadow telemetry is witnessed exactly once"
assert_contains "$OUT" "resume_idempotency=ok" "A resumed shadow run does not duplicate a translation"
assert_contains "$OUT" "authority_boundary=ok" "Shadow telemetry cannot take action or acceptance authority"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" translate-level --config "$CONFIG" --level l3 --expand -x no-delete --check)"; EXIT=$?
assert_eq "0" "$EXIT" "Read-only translate-level CLI exits cleanly"
assert_contains "$OUT" '"owner_kernel_authority":"none"' "CLI never claims host authority"
assert_contains "$OUT" '"execution":"inline"' "CLI maps l3 to inline execution"
assert_contains "$OUT" '"no-production-push"' "CLI preserves project red lines"
assert_contains "$OUT" '"no-delete"' "CLI can add but not replace red lines"

CONSUMER_DIR="$TEST_TMP/consumer"
mkdir -p "$CONSUMER_DIR/.claude"
cp "$CONFIG" "$CONSUMER_DIR/.claude/owner-kernel-governance.json"
OUT="$(cd "$CONSUMER_DIR" && node "$REPO_ROOT/scripts/owner-kernel.js" translate-level --config .claude/owner-kernel-governance.json --level l3 --check)"; EXIT=$?
assert_eq "0" "$EXIT" "An explicit Autopilot source path works from a consuming project"
assert_contains "$OUT" '"owner_kernel_authority":"none"' "Consumer mapping stays read-only"
for DOC in \
  "$REPO_ROOT/skills/l3/SKILL.md" \
  "$REPO_ROOT/project-config-template/governance-config.md" \
  "$REPO_ROOT/docs/projects/2026-07-20-owner-kernel-governance/p3/README.md"; do
  if grep -q 'node scripts/owner-kernel\.js' "$DOC"; then
    fail_test "Consumer guidance must not assume scripts/ exists in the consumer repository: $DOC"
  fi
done

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" status --ledger "$TEST_TMP/shadow-ledger.jsonl")"; EXIT=$?
assert_eq "0" "$EXIT" "Ledger status remains structurally readable without a witness adapter"
assert_contains "$OUT" '"verification":"unverified_without_external_witness_adapter"' "CLI labels translation telemetry as non-authoritative"
assert_contains "$OUT" '"alias_retirement_eligible":false' "CLI telemetry cannot satisfy alias-retirement evidence"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" translate-level --config "$CONFIG" --all --check)"; EXIT=$?
assert_eq "0" "$EXIT" "Read-only translate-level --all exits cleanly"
assert_contains "$OUT" '"entry":"l6"' "CLI exposes the full executable translation table"

CEO_SKILL="$(cat "$REPO_ROOT/skills/ceo-agent/SKILL.md")"
LEVEL_REFERENCE="$(cat "$REPO_ROOT/skills/ceo-agent/references/level-front-door.md")"
assert_contains "$CEO_SKILL" 'cat .claude/owner-kernel-governance.json' "CEO mode injects project Owner Kernel governance"
assert_contains "$CEO_SKILL" 'can never remove a project rule' "CEO mode keeps project red lines monotonic"
assert_contains "$LEVEL_REFERENCE" 'never removes project rules' "Shared level semantics keep project red lines monotonic"
assert_contains "$LEVEL_REFERENCE" '--mode owner-led|milestone-led' "Shared level semantics expose a per-run mode override"
for LEVEL in l3 l4 l5 l6; do
  if grep -q 'red-lines=none' "$REPO_ROOT/skills/$LEVEL/SKILL.md"; then
    fail_test "$LEVEL must not erase configured project red lines"
  fi
done
if grep -q 'scope=Hold; red-lines=none' "$REPO_ROOT/skills/ceo-agent/SKILL.md"; then
  fail_test "CEO front-door summary must not erase configured project red lines"
fi

node "$REPO_ROOT/scripts/owner-kernel.js" translate-level --config "$CONFIG" --level l3 --solo >"$TEST_TMP/l3-solo.out" 2>"$TEST_TMP/l3-solo.err"; EXIT=$?
assert_eq "2" "$EXIT" "l3 --solo is rejected instead of silently changing topology"
assert_contains "$(cat "$TEST_TMP/l3-solo.err")" 'not valid for l3' "CLI reports invalid l3 solo flag"

node "$REPO_ROOT/scripts/owner-kernel.js" translate-level --config "$CONFIG" --level l3 --ledger "$TEST_TMP/fake.jsonl" >"$TEST_TMP/ledger.out" 2>"$TEST_TMP/ledger.err"; EXIT=$?
assert_eq "2" "$EXIT" "Translate CLI rejects ledger write-shaped input"
assert_contains "$(cat "$TEST_TMP/ledger.err")" 'accepts only' "CLI keeps translation read-only"

finalize_test
