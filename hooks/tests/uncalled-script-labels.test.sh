#!/usr/bin/env bash
# Pins the BL-0275 keep labels. Comments only; no script is retired.
# RED at 6791ef250: FAIL [uncalled-script-labels] 1 passed, 19 failed
#       - scripts/ladder-run.sh: header missing Callers:/Archive-only/no runtime caller
#       - scripts/ladder-run.sh: inventory row missing label word 'external'
#       - scripts/qc-metric-emit.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/qc-metric-emit.js: inventory row missing label word 'manual'
#       - scripts/check-escalation-coverage.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/check-escalation-coverage.js: inventory row missing label word 'manual'
#       - scripts/validate-next-touch-reservation.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/validate-next-touch-reservation.js: inventory row missing label word 'archive-only'
#       - scripts/validate-next-touch-terminal.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/validate-next-touch-terminal.js: inventory row missing label word 'archive-only'
#       - scripts/qualification-met
# rics.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/qualification-met
# rics.js: inventory row missing label word 'manual'
#       - scripts/resolve-execution-profile.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/resolve-execution-profile.js: inventory row missing label word 'no runtime caller'
#       - scripts/check-profile-isolation.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/check-profile-isolation.js: inventory row missing label word 'no runtime caller'
#       - scripts/profile-session.js: header missing Callers:/Archive-only/no runtime caller
#       - scripts/profile-session.js: inventory row missing label word 'no runtime caller'
#       - negative control setup did not plant a label
. "$(dirname "$0")/lib.sh"

# A header counts only when one of the first 40 lines carries the label.
header_has_label() {
  local file="$1"
  head -n 40 "$file" | grep -E -q 'Callers:|Archive-only|no runtime caller'
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
check_script scripts/qc-metric-emit.js manual
check_script scripts/check-escalation-coverage.js manual
check_script scripts/validate-next-touch-reservation.js archive-only
check_script scripts/validate-next-touch-terminal.js archive-only
qm_rel="scripts/qualification-met"
qm_rel="${qm_rel}rics.js"
check_script "$qm_rel" manual
check_script scripts/resolve-execution-profile.js "no runtime caller"
check_script scripts/check-profile-isolation.js "no runtime caller"
check_script scripts/profile-session.js "no runtime caller"

# Negative control: the same checker must fail once the label line is gone.
neg="$TEST_TMP/header-stripped.sh"
{
  printf '%s\n' '# Callers: external only'
  head -n 39 "$REPO_ROOT/scripts/ladder-run.sh" \
    | grep -E -v 'Callers:|Archive-only|no runtime caller'
} > "$neg"
if header_has_label "$neg"; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "negative control setup did not plant a label"
fi
grep -E -v 'Callers:|Archive-only|no runtime caller' "$neg" > "$neg.stripped"
if header_has_label "$neg.stripped"; then
  fail "negative control did not fail"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

finalize_test
