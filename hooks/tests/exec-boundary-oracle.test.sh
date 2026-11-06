#!/usr/bin/env bash
# Reference-parity test for hooks/exec-boundary.js rule E2: run the fixture corpus plus
# generated variants through real shells (zsh and bash, sandboxed with a stub rm) and
# through the hook, and demand 0 bypasses (the shell ran a recursive out-of-scope rm but
# the hook ALLOWED) and 0 failed corpus expectations (named deny / allow cases).
# False DENYs of generated cases are reported by the harness, not blocking.
# Negative control: the harness is run against a deliberately weakened hook copy that
# allows everything; it must report bypasses and exit 1.
. "$(dirname "$0")/lib.sh"

ORACLE="$REPO_ROOT/hooks/tests/exec-boundary-oracle.js"
export ORACLE_TMP="$TEST_TMP"

if [ ! -x /usr/bin/bwrap ]; then
  echo "SKIP: bubblewrap is required (the oracle harness refuses to run without it)"
  finalize_test
fi
if [ ! -x /usr/bin/zsh ] || [ ! -x /usr/bin/bash ] || [ ! -x /usr/bin/timeout ]; then
  echo "SKIP: zsh, bash and timeout are required for the oracle shells"
  finalize_test
fi

OUT="$(node "$ORACLE" < /dev/null 2>&1)"; EXIT=$?
printf '%s\n' "$OUT" | grep -E '^(cases|BYPASS|EXPECTATION|FALSE DENY|SHELL DIVERGENCE)' | cut -c1-200
assert_eq "0" "$EXIT" "oracle harness: no bypass and no failed corpus expectation"
assert_contains "$OUT" "BYPASS (truth yes, hook ALLOW): 0" "oracle harness reports 0 bypasses"
CASES="$(printf '%s\n' "$OUT" | sed -n 's/^cases: \([0-9]*\) .*/\1/p')"
[ "${CASES:-0}" -ge 300 ] && R=ok || R="only ${CASES:-0} cases"
assert_eq "ok" "$R" "oracle corpus has at least 300 cases"

# Negative control: a hook that allows everything must be caught as bypassing.
printf '#!/usr/bin/env node\nprocess.exit(0);\n' > "$TEST_TMP/allow-all-hook.js"
NEG="$(node "$ORACLE" --hook "$TEST_TMP/allow-all-hook.js" --no-generated < /dev/null 2>&1)"; NEG_EXIT=$?
assert_eq "1" "$NEG_EXIT" "negative control: an allow-all hook makes the oracle fail"
assert_not_contains "$NEG" "BYPASS (truth yes, hook ALLOW): 0" "negative control: bypasses are reported"

# Negative control 2 (sandbox): a copy of the harness whose stub binds are stripped must fail
# its own self-check (exit 3) before it runs any case: the real rm paths are then not the stub.
sed 's|^.*// STUB-BIND$|  return [];|' "$ORACLE" > "$TEST_TMP/oracle-nostub.js"
SB="$(node "$TEST_TMP/oracle-nostub.js" --hook "$REPO_ROOT/hooks/exec-boundary.js" --corpus "$REPO_ROOT/hooks/tests/fixtures/exec-boundary-oracle-cases.txt" < /dev/null 2>&1)"; SB_EXIT=$?
assert_eq "3" "$SB_EXIT" "negative control: without the stub binds the sandbox self-check exits 3"
assert_contains "$SB" "NOT IN STUB LOG" "negative control: the self-check names the rm spelling that missed the stub"
assert_not_contains "$SB" "cases:" "negative control: no case ran after the failed self-check"

finalize_test
