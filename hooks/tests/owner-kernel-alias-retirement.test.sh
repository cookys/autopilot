#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROJECT="docs/projects/2026-07-20-owner-kernel-governance"

# Compatibility aliases must still exist; retirement is not authorized in U6.
for level in l3 l4 l5 l6; do
  assert_file_exists "$REPO_ROOT/skills/$level/SKILL.md" \
    "compatibility alias skill /$level remains present"
done

OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" 2>&1)"
EXIT=$?
assert_eq "0" "$EXIT" "alias-retirement readiness report emits without tool failure"

assert_contains "$OUT" '"alias_retirement"' "alias retirement section present"
# alias-test-masking: inspect the exact alias_retirement subsection, never aggregate HOLD.
node - "$OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || typeof alias !== 'object') {
  console.error('alias_retirement section missing');
  process.exit(1);
}
if (alias.status !== 'HOLD') {
  console.error('alias_retirement.status must be HOLD before real 14-day gate; got', alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/trusted|authority|witness|telemetry|14|manufacture/i.test(reasons)) {
  console.error('alias HOLD must cite trusted-authority or telemetry blockers; got:', reasons);
  process.exit(1);
}
if (alias.trusted_authority_present === true) {
  // Project default has no trusted authority journal — must be absent/false.
  console.error('default project must not claim trusted_authority_present without config');
  process.exit(1);
}
console.log('alias_subsection_hold=ok');
NODE
assert_eq "0" "$?" "alias_retirement.status HOLD asserted on subsection"
assert_contains "$OUT" '"aliases_present"' "present aliases are enumerated"
assert_contains "$OUT" 'l3' "l3 alias readiness is reported"
assert_contains "$OUT" 'l4' "l4 alias readiness is reported"
assert_contains "$OUT" 'l5' "l5 alias readiness is reported"
assert_contains "$OUT" 'l6' "l6 alias readiness is reported"
assert_contains "$OUT" 'required_witnessed_days": 14' "14 complete witnessed days remain required"
assert_contains "$OUT" 'refusing to manufacture 14 elapsed days' \
  "missing production telemetry cannot fabricate a pass"
assert_contains "$OUT" 'still present' \
  "aliases are not deleted by release tooling"

# Negative control: inventing production telemetry inline is not a checker API.
# There is no --assume-14-days or --waive flag.
HELP="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" --help 2>&1 || true)"
assert_contains "$HELP" '--project' "checker help documents --project"
assert_not_contains "$HELP" 'waive' "checker has no waiver flag"
assert_not_contains "$HELP" 'assume-14' "checker has no elapsed-day fabrication flag"
assert_not_contains "$HELP" 'delete-alias' "checker has no alias deletion flag"

# Translation surface still exists for shadow/compat (not production zero-use proof).
assert_file_exists "$REPO_ROOT/src/engine/owner-kernel/compatibility.js" \
  "compatibility translation module remains (aliases not retired)"

# kr10-shell-evidence / alias authority surface checks in checker source.
CHECKER_SRC="$(cat "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js")"
assert_contains "$CHECKER_SRC" "bash', ['-n'" \
  "KR10 runs deterministic bash -n for shell members"
assert_contains "$CHECKER_SRC" 'assertWitnessAdapter' \
  "alias retirement uses trusted installed witness-authority API"
assert_contains "$CHECKER_SRC" 'loadTrustedInstalledWitnessAuthority' \
  "alias retirement loads independently configured installed witness authority"
assert_contains "$CHECKER_SRC" 'verifyWithTrustedInstalledWitnessAuthority' \
  "alias retirement calls trusted witness-authority verification"
assert_contains "$CHECKER_SRC" 'authority.verify(receipt)' \
  "alias retirement authenticates via witness.verify authority API"
assert_contains "$CHECKER_SRC" 'AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY' \
  "authority path is independently configured (not project-local co-located journal)"
assert_contains "$CHECKER_SRC" 'executeDeterministicCallerMigrationScan' \
  "caller migration is mechanically executed"
assert_contains "$CHECKER_SRC" 'requiredWitnessedDayKeys' \
  "14-day window binds to host-clock timestamps outside the evidence"
assert_not_contains "$CHECKER_SRC" 'compatibility_cycle_signer_binding' \
  "telemetry-supplied signer bindings are not a trust root"
# Must not construct MemoryWitness from telemetry receipt.stream_id as trust root.
if printf '%s' "$CHECKER_SRC" | grep -q "new MemoryWitness({ streamId: receipt.stream_id })"; then
  echo "FAIL: telemetry-stream-derived fresh MemoryWitness is forbidden" >&2
  exit 1
fi

# alias-receipt-self-authentication / alias-authority-bootstrap:
# internally consistent forged chains HOLD; absent trusted state HOLDs.
FAB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-retire-fab.XXXXXX")"
mkdir -p "$FAB_DIR/production-telemetry"
node - "$REPO_ROOT" "$FAB_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));

function witnessHead(fields) {
  return sha256(canonicalJson({
    run_id: fields.run_id,
    stream_id: fields.stream_id,
    sequence: fields.sequence,
    event_hash: fields.event_hash,
    previous_witness_head: fields.previous_witness_head,
  }));
}

const runId = 'fabricated-run';
const streamId = 'fabricated-signer-stream';
const cycleBody = { compatibility_cycle_id: 'fabricated-cycle' };
const cycleEventHash = sha256(canonicalJson(cycleBody));
const cycleBase = {
  run_id: runId,
  stream_id: streamId,
  sequence: 1,
  event_hash: cycleEventHash,
  previous_witness_head: null,
};
const cycleHead = witnessHead(cycleBase);
const cycleReceipt = { ...cycleBase, witness_head: cycleHead };

const days = [];
let previousHead = cycleHead;
for (let i = 1; i <= 14; i += 1) {
  const day = `2020-01-${String(i).padStart(2, '0')}`;
  const dayBody = {
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    prior_witness_head: previousHead,
  };
  const eventHash = sha256(canonicalJson(dayBody));
  const base = {
    run_id: runId,
    stream_id: streamId,
    sequence: i + 1,
    event_hash: eventHash,
    previous_witness_head: previousHead,
  };
  const head = witnessHead(base);
  days.push({
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    witness_head: head,
    witness_receipt: { ...base, witness_head: head },
  });
  previousHead = head;
}

const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const telemetry = {
  compatibility_cycle_id: 'fabricated-cycle',
  shipped_compatibility_cycle: true,
  compatibility_cycle_signer_binding: {
    identity: 'fabricated-signer',
    attestation_hash: 'c'.repeat(64),
    protocol_version: 1,
  },
  compatibility_cycle_receipt_body: cycleBody,
  compatibility_cycle_ship_receipt: cycleReceipt,
  witnessed_zero_use_days: 14,
  translation_used_events: 0,
  unresolved_translation_deltas: 0,
  deterministic_caller_migration: true,
  caller_migration_complete: true,
  caller_migration_scan_body: migrationBody,
  caller_migration_scan_hash: sha256(canonicalJson(migrationBody)),
  witnessed_day_records: days,
};
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify(telemetry, null, 2),
);
NODE

FAB_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$FAB_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
FAB_EXIT=$?
assert_eq "0" "$FAB_EXIT" "internally consistent forged telemetry still emits a report"
# alias-test-masking: parse JSON and assert alias_retirement.status + trusted-authority blocker.
node - "$FAB_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('forged chains must HOLD alias_retirement.status; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/trusted|authority|witness/i.test(reasons)) {
  console.error('HOLD reasons must cite trusted witness-authority verification; got:', reasons);
  process.exit(1);
}
// KR8/KR10 HOLD cannot mask an erroneous alias PASS — we already require alias HOLD.
if (alias.status === 'PASS') {
  console.error('alias PASS masked by other gates is forbidden');
  process.exit(1);
}
console.log('alias_forged_hold=ok');
NODE
assert_eq "0" "$?" "internally consistent forged chains HOLD alias retirement subsection"
rm -rf "$FAB_DIR"

# alias-cogen-backdated: freshly generated project-local journal + backdated
# 14-day chain + self-hashed deterministic_caller_migration cannot fund PASS.
COGEN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-cogen.XXXXXX")"
mkdir -p "$COGEN_DIR/production-telemetry"
node - "$REPO_ROOT" "$COGEN_DIR" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const { MemoryWitness } = require(path.join(root, 'src/engine/owner-kernel/witness'));

const streamId = 'alias-cogen-stream';
const runId = 'alias-cogen-run';
const witness = new MemoryWitness({ streamId });
const cycleBody = { compatibility_cycle_id: 'alias-cogen-cycle' };
const cycleReceipt = witness.append({
  run_id: runId,
  sequence: 1,
  event_hash: sha256(canonicalJson(cycleBody)),
});
const days = [];
for (let i = 1; i <= 14; i += 1) {
  const day = `2020-01-${String(i).padStart(2, '0')}`;
  const previousHead = witness.getHead();
  const dayBody = {
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    prior_witness_head: previousHead,
  };
  const receipt = witness.append({
    run_id: runId,
    sequence: i + 1,
    event_hash: sha256(canonicalJson(dayBody)),
  });
  days.push({
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    witness_head: receipt.witness_head,
    witness_receipt: receipt,
  });
}
const migrationBody = { complete: true, callers_migrated: ['l3', 'l4', 'l5', 'l6'] };
const migrationHash = sha256(canonicalJson(migrationBody));
const migrationReceipt = witness.append({
  run_id: runId,
  sequence: 16,
  event_hash: migrationHash,
});

fs.writeFileSync(
  path.join(dir, 'trusted-installed-witness-authority.json'),
  JSON.stringify({
    kind: 'trusted_installed_witness_authority',
    stream_id: streamId,
    receipts: witness._receipts,
  }, null, 2),
);
fs.writeFileSync(
  path.join(dir, 'production-telemetry', 'alias-retirement.json'),
  JSON.stringify({
    compatibility_cycle_id: 'alias-cogen-cycle',
    shipped_compatibility_cycle: true,
    compatibility_cycle_receipt_body: cycleBody,
    compatibility_cycle_ship_receipt: cycleReceipt,
    witnessed_zero_use_days: 14,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    deterministic_caller_migration: true,
    caller_migration_complete: true,
    caller_migration_scan_body: migrationBody,
    caller_migration_scan_hash: migrationHash,
    caller_migration_witness_receipt: migrationReceipt,
    witnessed_day_records: days,
  }, null, 2),
);
NODE

COGEN_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$COGEN_DIR" \
  --repo-root "$REPO_ROOT" 2>&1)"
node - "$COGEN_OUT" <<'NODE'
const report = JSON.parse(process.argv[2]);
const alias = report.alias_retirement;
if (!alias || alias.status !== 'HOLD') {
  console.error('backdated co-gen alias evidence must HOLD; got', alias && alias.status);
  process.exit(1);
}
const reasons = (alias.blocking_reasons || []).join('\n');
if (!/independent|untrusted|project-local|authority|self-hashed|migration|backdated|host-clock/i.test(reasons)) {
  console.error('alias co-gen HOLD must cite independent authority/migration/backdating; got:', reasons);
  process.exit(1);
}
if (alias.deterministic_caller_migration === true) {
  console.error('self-hashed migration must not set deterministic_caller_migration true');
  process.exit(1);
}
console.log('alias_cogen_backdated_hold=ok');
NODE
assert_eq "0" "$?" "backdated co-gen alias evidence HOLD"
rm -rf "$COGEN_DIR"

echo "PASS [owner-kernel-alias-retirement] alias retirement gate stays HOLD without deletion"
finalize_test
