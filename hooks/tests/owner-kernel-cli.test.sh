#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CONFIG="$TEST_TMP/governance.json"
LEDGER="$TEST_TMP/owner-kernel.jsonl"
V2_LEDGER="$TEST_TMP/owner-kernel-v2-resolution.jsonl"

OUT="$(node - "$REPO_ROOT" "$CONFIG" "$LEDGER" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const configPath = process.argv[3];
const ledgerPath = process.argv[4];
const { MemoryWitness, OwnerKernel, canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(identity),
  issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
});
const entry = (identity, role) => ({
  identity, model_alias: identity, model_version: '1', family: 'test', runner: 'test', role,
  attestation: attestation(identity),
});
const config = { schema_version: 1, governance: {
  default_mode: 'owner-led',
  owner_roster: [entry('owner-a', 'owner')],
  challenger_roster: [entry('challenger-a', 'challenger')],
  trusted_runner_roster: [entry('runner-a', 'trusted_runner')],
  approval_policy: {
    read_only: { requires_approval: false, max_uses: 1 },
    reversible: { requires_approval: false, max_uses: 1 },
    external: { requires_approval: true, max_uses: 1 },
    irreversible: { requires_approval: true, max_uses: 1 },
  },
  capability_ttl_seconds: 3600,
  checkpoint_interval_closed_events: 100,
  max_blocked_duration_seconds: 86400,
}};
fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);
const adapters = {
  userInputVerifier(envelope, kind, context) {
    return { ok: true, kind, run_id: context.run_id, identity: 'user-a', channel: 'trusted-user', envelope_hash: hash(envelope), payload: envelope.payload };
  },
  ownerTurnVerifier(envelope, context) {
    return { ok: true, run_id: context.run_id, principal_id: context.principal_id, identity: 'owner-a', channel: 'trusted-owner-turn', envelope_hash: hash(envelope), payload: {} };
  },
  principalResolver({ candidate_id, run_id, from_principal_id }) {
    return { ok: true, run_id, from_principal_id, identity: candidate_id, attestation_sha256: hash(candidate_id) };
  },
  qualificationVerifier({ principal, run_id }) {
    return { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 };
  },
};
const witness = new MemoryWitness({ streamId: 'cli-test-witness' });
const { kernel } = OwnerKernel.start({
  runId: 'owner-cli-test', governanceConfig: config,
  acceptanceContract: { schema_version: 1, contract_id: 'cli-contract', legs: [{ id: 'unit', kind: 'executable', command: 'true', artifact_hashes: [hash('unit')] }] },
  initialIntentEnvelope: { payload: { text: 'Inspect', explicit_action_hashes: [] } },
  initialOwnerId: 'owner-a', witness, adapters, allowTestWitness: true,
  clock: () => '2026-07-01T00:00:00.000Z', nonceFactory: () => 'c'.repeat(64),
});
fs.writeFileSync(ledgerPath, kernel.serializeLedger());
console.log('fixture=ok');
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel CLI fixture creation succeeds"
assert_contains "$OUT" "fixture=ok" "Owner Kernel CLI fixture is ready"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" resolve --config "$CONFIG" --mode milestone-led --check)"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel resolve exits cleanly"
assert_contains "$OUT" '"mode":"milestone-led"' "One-run mode override is reported"
assert_contains "$OUT" '"mode_source":"run-override"' "Override does not mutate project default"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" resolve --config "$REPO_ROOT/.claude/owner-kernel-governance.json" --check)"; EXIT=$?
assert_eq "0" "$EXIT" "Self-hosted dogfood governance config resolves"
assert_contains "$OUT" '"identity":"p1-dogfood-owner-pending-p4"' "Dogfood owner stays explicitly pending P4"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" verify --ledger "$LEDGER")"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel verify exits cleanly"
assert_contains "$OUT" '"status":"structural_valid"' "CLI verifies ledger structure"
assert_contains "$OUT" '"production_activation":"blocked_without_external_witness_adapter"' "CLI does not claim local file witness authority"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" status --ledger "$LEDGER")"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel status exits cleanly"
assert_contains "$OUT" '"run_status":"decide"' "CLI replays current state"
assert_contains "$OUT" '"active_principal":"owner-a"' "CLI renders active principal"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" disclose --ledger "$LEDGER")"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel disclose exits cleanly"
assert_contains "$OUT" '"decisions":[]' "CLI disclosure excludes non-decision records and explicit absence"
assert_contains "$OUT" '"acceptance_proof":"not_applicable_or_verified"' "Legacy disclosure labels its non-applicable acceptance proof state"

OUT="$(node - "$REPO_ROOT" "$V2_LEDGER" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ledgerPath = process.argv[3];
const { MemoryWitness, OwnerKernel, canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel'));
const hash = (value) => sha256(typeof value === 'string' ? value : canonicalJson(value));
const now = '2026-07-01T00:00:00.000Z';
const attestation = (identity) => ({
  issuer: 'test', uri: `test://${identity}`, sha256: hash(identity),
  issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z',
});
const entry = (identity, role, family) => ({
  identity, model_alias: identity, model_version: '1', family, runner: 'test', role,
  attestation: attestation(identity),
});
const config = { schema_version: 1, governance: {
  default_mode: 'owner-led',
  owner_roster: [entry('owner-a', 'owner', 'owner')],
  challenger_roster: [entry('challenger-a', 'challenger', 'challenger')],
  trusted_runner_roster: [entry('runner-a', 'trusted_runner', 'runner')],
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
}};
const manifest = [{ id: 'workspace', sha256: hash('v2-cli-workspace') }];
const binding = {
  identity: 'cli-acceptance-coordinator', trust_tier: 'test',
  attestation_hash: hash('cli-acceptance-coordinator'), protocol_version: 2,
};
const bindingHash = hash(binding);
const unsigned = ({ signature: _signature, ...rest }) => rest;
const sign = (value) => hash({ coordinator: bindingHash, ...value });
const resolution = (request, disposition) => {
  const value = {
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
  value.signature = sign(unsigned(value));
  return value;
};
const coordinator = {
  identity: binding.identity,
  trustTier: 'test',
  attestation_hash: binding.attestation_hash,
  protocol_version: 2,
  acquire(request) {
    const snapshot = {
      attempt_id: request.attempt_id,
      attempt_hash: request.attempt_hash,
      intent_id: request.expected_intent_id,
      transaction_id: 'cli-acceptance-transaction',
      fence: hash('cli-acceptance-fence'),
      candidate_artifacts: manifest,
      delivered_artifacts: manifest,
      audit_head: hash('cli-audit-head'),
      control_event_head: request.expected_event_head,
      control_witness_head: request.expected_witness_head,
      snapshot_at: now,
    };
    const normalizedSnapshot = {
      ...snapshot,
      candidate_set_hash: hash(manifest),
      delivered_set_hash: hash(manifest),
    };
    return {
      ok: true,
      run_id: request.run_id,
      ...snapshot,
      snapshot_hash: hash({ run_id: request.run_id, ...normalizedSnapshot }),
    };
  },
  commit() { throw new Error('the empty v2 fixture cannot commit acceptance'); },
  requestAbort(request) {
    return { ok: true, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash, disposition: 'queued' };
  },
  cancel(request) {
    return {
      ok: true, run_id: request.run_id, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash,
      disposition: 'cancelled', coordinator_resolution: resolution(request, 'cancelled'),
    };
  },
  resolveAttempt(request) { return this.cancel(request); },
  verifyCommit() { return false; },
  verifyResolution(request) {
    const value = request.coordinator_resolution;
    return Boolean(value && value.signature === sign(unsigned(value))
      && value.coordinator_binding_hash === bindingHash && value.disposition === request.disposition);
  },
  release(request) {
    return {
      ok: true, run_id: request.run_id, attempt_id: request.attempt_id, attempt_hash: request.attempt_hash,
      disposition: 'released', coordinator_resolution: resolution(request, 'released'),
    };
  },
};
const adapters = {
  userInputVerifier(envelope, kind, context) {
    return { ok: true, kind, run_id: context.run_id, identity: 'user-a', channel: 'trusted-user', envelope_hash: hash(envelope), payload: envelope.payload };
  },
  ownerTurnVerifier(envelope, context) {
    return { ok: true, run_id: context.run_id, principal_id: context.principal_id, identity: 'owner-a', channel: 'trusted-owner-turn', envelope_hash: hash(envelope), payload: {} };
  },
  principalResolver({ candidate_id, run_id, from_principal_id }) {
    return { ok: true, run_id, from_principal_id, identity: candidate_id, attestation_sha256: hash(candidate_id) };
  },
  qualificationVerifier({ principal, run_id }) {
    return { ok: true, run_id, principal_id: principal.identity, attestation_sha256: principal.attestation.sha256 };
  },
};
(async () => {
  const witness = new MemoryWitness({ streamId: 'cli-v2-resolution-witness' });
  const started = OwnerKernel.start({
    runId: 'owner-cli-v2-resolution', governanceConfig: config,
    acceptanceContract: {
      schema_version: 2, contract_id: 'cli-v2-contract',
      artifacts: [{ id: 'workspace', target: 'workspace.tar' }],
      legs: [{ id: 'tests', kind: 'executable', command: 'true', artifact_ids: ['workspace'] }],
    },
    initialIntentEnvelope: { payload: { text: 'Inspect', explicit_action_hashes: [] } },
    initialOwnerId: 'owner-a', witness, adapters, allowTestWitness: true,
    acceptanceAuthority: coordinator, allowTestAcceptanceCoordinator: true,
    clock: () => now, nonceFactory: () => 'v'.repeat(64),
  });
  const result = await started.kernel.accept({ capability: started.owner_capability, timeoutMilliseconds: 1000 });
  if (result.accepted !== false) throw new Error('fixture must produce a non-terminal v2 acceptance resolution');
  fs.writeFileSync(ledgerPath, started.kernel.serializeLedger());
  console.log('v2_fixture=ok');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "V2 Owner Kernel CLI fixture creation succeeds"
assert_contains "$OUT" "v2_fixture=ok" "V2 acceptance-resolution fixture is ready"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" disclose --ledger "$V2_LEDGER")"; EXIT=$?
assert_eq "0" "$EXIT" "CLI structurally discloses a V2 resolution ledger"
assert_contains "$OUT" '"acceptance_proof":"unverified"' "CLI disclosure marks an offline V2 coordinator proof as unverified"

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" --help)"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel help exits cleanly"
assert_not_contains "$OUT" " append --" "CLI has no generic append command"

node "$REPO_ROOT/scripts/owner-kernel.js" append --ledger "$LEDGER" >"$TEST_TMP/append.out" 2>"$TEST_TMP/append.err"; EXIT=$?
assert_eq "2" "$EXIT" "Unknown append command is rejected"
assert_contains "$(cat "$TEST_TMP/append.err")" 'unknown command "append"' "CLI rejects generic append"

finalize_test
