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
assert_contains "$OUT" '"status": "HOLD"' "alias retirement is HOLD before real 14-day gate"
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

# kr10-shell-evidence: frozen shell members receive deterministic bash -n evidence.
CHECKER_SRC="$(cat "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js")"
assert_contains "$CHECKER_SRC" "bash', ['-n'" \
  "KR10 runs deterministic bash -n for shell members"
assert_contains "$CHECKER_SRC" 'verifyAuthoritativeWitnessReceipt' \
  "alias retirement uses authoritative witness receipt API"

# alias-receipt-authenticity: fabricated shape-only 14-day chains HOLD retirement.
FAB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alias-retire-fab.XXXXXX")"
mkdir -p "$FAB_DIR/production-telemetry"
node - "$REPO_ROOT" "$FAB_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const dir = process.argv[3];
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const days = [];
for (let i = 1; i <= 14; i += 1) {
  const day = `2020-01-${String(i).padStart(2, '0')}`;
  days.push({
    day,
    translation_used_events: 0,
    unresolved_translation_deltas: 0,
    witness_head: `${i.toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
    witness_receipt: {
      run_id: 'fabricated-run',
      stream_id: 'fabricated-signer-stream',
      sequence: i,
      event_hash: `${i.toString(16).padStart(2, '0')}${'b'.repeat(62)}`,
      previous_witness_head: i === 1
        ? 'e'.repeat(64)
        : `${(i - 1).toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
      witness_head: `${i.toString(16).padStart(2, '0')}${'a'.repeat(62)}`,
    },
  });
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
  compatibility_cycle_receipt_body: { compatibility_cycle_id: 'fabricated-cycle' },
  compatibility_cycle_ship_receipt: {
    run_id: 'fabricated-run',
    stream_id: 'fabricated-signer-stream',
    sequence: 1,
    event_hash: 'd'.repeat(64),
    previous_witness_head: null,
    // Deliberately NOT the authoritative head derivation of the receipt fields.
    witness_head: 'e'.repeat(64),
  },
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
assert_eq "0" "$FAB_EXIT" "fabricated telemetry still emits a report"
assert_contains "$FAB_OUT" '"status": "HOLD"' \
  "fabricated shape-only chains HOLD alias retirement"
assert_contains "$FAB_OUT" 'authoritative' \
  "HOLD reasons cite authoritative receipt verification"
rm -rf "$FAB_DIR"

echo "PASS [owner-kernel-alias-retirement] alias retirement gate stays HOLD without deletion"
finalize_test
