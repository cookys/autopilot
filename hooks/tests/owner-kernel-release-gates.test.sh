#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PROJECT="docs/projects/2026-07-20-owner-kernel-governance"

OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" 2>&1)"
EXIT=$?

assert_eq "0" "$EXIT" "release-gate checker emits a report without tool failure"

assert_contains "$OUT" '"kind": "owner_kernel_release_gate_report"' "report kind is frozen"
assert_contains "$OUT" '"disposition": "HOLD"' "incomplete/failing gates terminal HOLD (not fabricated pass)"
assert_contains "$OUT" '"id": "KR8"' "KR8 is reported"
assert_contains "$OUT" '"id": "KR10"' "KR10 is reported"
assert_contains "$OUT" '"id": "alias_retirement"' "alias retirement readiness is reported"
assert_contains "$OUT" 'blocking_reasons' "every blocking reason is enumerated"

# KR8 must not promote fixture telemetry to production pass.
assert_contains "$OUT" 'fixture' "KR8 distinguishes fixture/spike evidence from production"

# KR10 must use frozen baseline 42 / projected 51 and not redefine the metric.
assert_contains "$OUT" '"baseline_surface_count": 42' "KR10 baseline remains 42"
assert_contains "$OUT" '"projected_post_p3_surface_count": 51' "KR10 projected target remains 51"
assert_contains "$OUT" 'KR10' "KR10 blocking reasons are present when surface did not fall"

# Must not claim 14 elapsed production days when telemetry is absent.
assert_contains "$OUT" '14' "alias gate states the 14-day requirement"
assert_contains "$OUT" 'refusing to manufacture 14 elapsed days' \
  "incomplete 14-day window is HOLD, not fabricated pass"

# --check must exit non-zero on HOLD
CHECK_OUT="$(node "$REPO_ROOT/scripts/check-owner-kernel-release-gates.js" \
  --project "$PROJECT" \
  --repo-root "$REPO_ROOT" \
  --check 2>&1)"
CHECK_EXIT=$?
assert_eq "1" "$CHECK_EXIT" "--check exits non-zero on terminal HOLD"

# Mutation: attempting to treat a redefinition of KR10 as pass must not be possible
# via the checker CLI (no flags to waive/redefine).
assert_contains "$OUT" 'not strictly below baseline' \
  "KR10 failure reasons stay on the frozen definition"
assert_contains "$OUT" 'definition is not revised after measurement' \
  "KR10 does not redefine the metric after measurement"

# Notes must forbid fixture promotion and alias deletion by this tool.
assert_contains "$OUT" 'fixture telemetry is never promoted' "fixture promotion is refused"
assert_contains "$OUT" 'never deletes compatibility aliases' "checker never deletes aliases"
assert_contains "$OUT" 'P4 role qualification is out of scope' "P4 remains out of scope"

echo "PASS [owner-kernel-release-gates] release gate honesty checks"
finalize_test
