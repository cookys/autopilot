#!/usr/bin/env bash
# lib.sh puts a sentinel `fleet` first on PATH for every suite: a suite that reaches the courier (a card notice or decision answer sent
# to the PM for real) is recorded and fails finalize_test. Negative control: a child suite that sends on purpose must exit 1.
. "$(dirname "$0")/lib.sh"
assert_eq "$(command -v fleet)" "$FLEET_SENTINEL_DIR/fleet" "fleet on PATH is the sentinel"
assert_eq "$(env | grep -c '^FLEET_[A-Z_]*=' | tr -d ' ')" 0 "no inherited fleet identity (FLEET_ env vars)"
CHILD="$TEST_TMP/child.test.sh"
cat > "$CHILD" <<SH
#!/usr/bin/env bash
. "$REPO_ROOT/hooks/tests/lib.sh"
${1:-}
fleet send ns/cc/exec--claude "q A::a" >/dev/null
finalize_test
SH
bash "$CHILD" >"$TEST_TMP/child.out" 2>&1; assert_eq "$?" 1 "a suite that sends through the default fleet fails"
assert_contains "$(head -c 600 "$TEST_TMP/child.out")" "real fleet courier would have received" "the failure names the outbound send"
finalize_test
