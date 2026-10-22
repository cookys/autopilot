#!/usr/bin/env bash
# Pins the BL-0275 keep labels. Comments only; no script is retired.
# RED at 14ef4aa39:
# FAIL [uncalled-script-labels] 2 passed, 20 failed
#       - scripts/ladder-run.sh: header missing Callers:/Archive-only/no runtime caller
#       - scripts/ladder-run.sh: inventory row missing label word 'external'
#       - scripts/qc-metric-emit.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/qc-metric-emit.js: inventory row missing label word 'ladder-run.sh only'
#       - scripts/check-escalation-coverage.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/check-escalation-coverage.js: inventory row missing label word 'check-escalation-coverage.js: manual'
#       - scripts/validate-next-touch-reservation.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/validate-next-touch-reservation.js: inventory row missing label word 'archive-only'
#       - scripts/validate-next-touch-terminal.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/validate-next-touch-terminal.js: inventory row missing label word 'archive-only'
#       - scripts/next-touch-validation.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/next-touch-validation.js: inventory row missing label word 'archive-only'
#       - scripts/qualification-metrics.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/qualification-metrics.js: inventory row missing label word 'manual'
#       - scripts/resolve-execution-profile.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/resolve-execution-profile.js: inventory row missing label word 'no runtime caller'
#       - scripts/check-profile-isolation.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/check-profile-isolation.js: inventory row missing label word 'no runtime caller'
#       - scripts/profile-session.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/profile-session.js: inventory row missing label word 'no runtime caller'
# RED at 63329748c:
# FAIL [uncalled-script-labels] scripts/tree.js: header missing ADR-0002 within the first 60 lines
# FAIL [uncalled-script-labels] scripts/tree.js: inventory row missing Dormant (ADR-0002)
# FAIL [uncalled-script-labels] scripts/qc-panel.js: header missing ADR-0002 within the first 60 lines
# FAIL [uncalled-script-labels] scripts/qc-panel.js: inventory row missing Dormant (ADR-0002)
# FAIL [uncalled-script-labels] scripts/calibration.sh: header missing ADR-0002 within the first 60 lines
# FAIL [uncalled-script-labels] scripts/calibration.sh: inventory row missing Dormant (ADR-0002)
# FAIL [uncalled-script-labels] scripts/check-node-report.js: header missing ADR-0002 within the first 60 lines
# FAIL [uncalled-script-labels] scripts/check-node-report.js: inventory row missing Dormant (ADR-0002)
# FAIL [uncalled-script-labels] 22 passed, 8 failed
#       - scripts/tree.js: header missing ADR-0002 within the first 60 lines
#       - scripts/tree.js: inventory row missing Dormant (ADR-0002)
#       - scripts/qc-panel.js: header missing ADR-0002 within the first 60 lines
#       - scripts/qc-panel.js: inventory row missing Dormant (ADR-0002)
#       - scripts/calibration.sh: header missing ADR-0002 within the first 60 lines
#       - scripts/calibration.sh: inventory row missing Dormant (ADR-0002)
#       - scripts/check-node-report.js: header missing ADR-0002 within the first 60 lines
#       - scripts/check-node-report.js: inventory row missing Dormant (ADR-0002)
# RED at 2ea016dd7: round 5 retargeted the pin to the evidence-backed header
# (no script or hook calls it; stale skill text tracked in BL-0283). Removing
# that header line from scripts/tree.js goes red:
# FAIL [uncalled-script-labels] scripts/tree.js: header missing ADR-0002 within the first 60 lines
# FAIL [uncalled-script-labels] 29 passed, 1 failed
#       - scripts/tree.js: header missing ADR-0002 within the first 60 lines
. "$(dirname "$0")/lib.sh"

# A header counts only when one of the first 60 lines carries the label.
header_has_label() {
  local file="$1"
  head -n 60 "$file" | grep -E -q 'Callers:|Archive-only|no runtime caller'
}

inventory_row() {
  local needle="$1"
  grep -F "$needle" "$REPO_ROOT/docs/scripts-inventory.md" | head -n 1
}

check_script() {
  local rel="$1" word="$2" row
  if header_has_label "$REPO_ROOT/$rel"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$rel: header missing Callers:/Archive-only/no runtime caller"
  fi
  row="$(inventory_row "$rel")"
  if printf '%s\n' "$row" | grep -F -i -q -- "$word"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$rel: inventory row missing label word '$word'"
  fi
}

check_script scripts/ladder-run.sh external
check_script scripts/qc-metric-emit.js "ladder-run.sh only"
check_script scripts/check-escalation-coverage.js "check-escalation-coverage.js: manual"
check_script scripts/validate-next-touch-reservation.js archive-only
check_script scripts/validate-next-touch-terminal.js archive-only
check_script scripts/next-touch-validation.js archive-only
check_script scripts/qualification-metrics.js manual
check_script scripts/resolve-execution-profile.js "no runtime caller"
check_script scripts/check-profile-isolation.js "no runtime caller"
check_script scripts/profile-session.js "no runtime caller"

# Negative control: plant one label inside a 60-line window, then delete that
# label line. The 60-line scan must see it before and miss it after.
neg="$TEST_TMP/header-stripped.sh"
{
  printf '%s\n' '# Callers: external only'
  head -n 59 "$REPO_ROOT/scripts/ladder-run.sh" \
    | grep -E -v 'Callers:|Archive-only|no runtime caller'
} > "$neg"
if header_has_label "$neg"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "negative control setup did not plant a label inside the 60-line header"
fi
grep -E -v 'Callers:|Archive-only|no runtime caller' "$neg" > "$neg.stripped"
if header_has_label "$neg.stripped"; then
  fail "negative control still saw a label after the label line was removed"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ADR-0002 dormancy pins. A header counts only inside the first 60 lines.
header_has_adr0002() {
  local file="$1"
  # The mandated header is one line and spells the ADR as a path
  # (docs/adr/0002-...), so the pin matches that line, not the token ADR-0002.
  head -n 60 "$file" | grep -F -q 'Dormant since 2026-08-22 (board abort): no script or hook calls it; stale skill text tracked in BL-0283 still describes it. Kept, not retired: see docs/adr/0002-task-tree-and-qc-panel-dormant.md'
}

check_dormant() {
  local rel="$1" row
  if header_has_adr0002 "$REPO_ROOT/$rel"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$rel: header missing ADR-0002 within the first 60 lines"
  fi
  # The index row is the one whose link target is this script. A earlier
  # mention (jsonl-store.js names scripts/tree.js) is not that row.
  row="$(grep -F "](../$rel)" "$REPO_ROOT/docs/scripts-inventory.md" | head -n 1)"
  if printf '%s\n' "$row" | grep -F -q 'Dormant (ADR-0002)'; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$rel: inventory row missing Dormant (ADR-0002)"
  fi
}

check_dormant scripts/tree.js
check_dormant scripts/qc-panel.js
check_dormant scripts/calibration.sh
check_dormant scripts/check-node-report.js

finalize_test
