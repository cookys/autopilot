#!/usr/bin/env bash
# Tests for scripts/dispatch-research.sh
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-research.sh"
assert_file_exists "$SCRIPT" "dispatch-research.sh exists"

BRIEF="$TEST_TMP/brief.md"
printf '# Research brief\nInvestigate fanout.\n' > "$BRIEF"

LOG="$TEST_TMP/dispatches.log"
STUB="$TEST_TMP/dispatch-wrapper.sh"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$AUTOPILOT_DISPATCH_LOG"
EOF
chmod +x "$STUB"

export AUTOPILOT_DISPATCH_WRAPPER="$STUB"
export AUTOPILOT_DISPATCH_LOG="$LOG"

# (1) Two different-family seats -> two dispatch invocations recorded with right branch names
: > "$LOG"
out="$(bash "$SCRIPT" --seats astra,carbon --slug res1 --brief "$BRIEF" --base abc1234 --timeout 5m 2>&1)"
rc=$?
assert_eq "$rc" "0" "different-family seats exit 0"
lines="$(wc -l < "$LOG" | tr -d ' ')"
assert_eq "$lines" "2" "two dispatches recorded"
log_content="$(cat "$LOG")"
assert_contains "$log_content" "--branch res1-astra" "first branch is res1-astra"
assert_contains "$log_content" "--branch res1-carbon" "second branch is res1-carbon"

# (2) Same-family seats -> exit 2
: > "$LOG"
out="$(bash "$SCRIPT" --seats astra,gpt-6.1-terra --slug res2 --brief "$BRIEF" --base abc1234 2>&1)"
rc=$?
assert_eq "$rc" "2" "same-family seats exit 2"
assert_contains "$out" "research: two independent families required" "same-family error message"
assert_eq "$(wc -l < "$LOG" | tr -d ' ')" "0" "no dispatch on same-family failure"

# (3) One seat -> exit 2
: > "$LOG"
out="$(bash "$SCRIPT" --seats astra --slug res3 --brief "$BRIEF" --base abc1234 2>&1)"
rc=$?
assert_eq "$rc" "2" "single seat exits 2"
assert_contains "$out" "research: two independent dispatches required" "single-seat error message"
assert_eq "$(wc -l < "$LOG" | tr -d ' ')" "0" "no dispatch on single-seat failure"

# (4) Unknown seat -> exit 2
: > "$LOG"
out="$(bash "$SCRIPT" --seats unknown-seat,carbon --slug res4 --brief "$BRIEF" --base abc1234 2>&1)"
rc=$?
assert_eq "$rc" "2" "unknown seat exits 2"
assert_contains "$out" "research: seat unknown-seat unavailable" "unknown-seat error message"

finalize_test
