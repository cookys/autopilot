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

echo "PASS [owner-kernel-alias-retirement] alias retirement gate stays HOLD without deletion"
finalize_test
