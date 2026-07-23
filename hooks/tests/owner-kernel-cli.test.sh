#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CONFIG="$TEST_TMP/governance.json"
LEDGER="$TEST_TMP/owner-kernel.jsonl"

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

OUT="$(node "$REPO_ROOT/scripts/owner-kernel.js" --help)"; EXIT=$?
assert_eq "0" "$EXIT" "Owner Kernel help exits cleanly"
assert_not_contains "$OUT" " append --" "CLI has no generic append command"

node "$REPO_ROOT/scripts/owner-kernel.js" append --ledger "$LEDGER" >"$TEST_TMP/append.out" 2>"$TEST_TMP/append.err"; EXIT=$?
assert_eq "2" "$EXIT" "Unknown append command is rejected"
assert_contains "$(cat "$TEST_TMP/append.err")" 'unknown command "append"' "CLI rejects generic append"

finalize_test
