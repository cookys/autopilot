#!/usr/bin/env bash
# check-test-bg-reap.test.sh — unit tests for scripts/check-test-bg-reap.js
set -uo pipefail
. "$(dirname "$0")/lib.sh"

TEST_NAME="check-test-bg-reap"
CHECK="$REPO_ROOT/scripts/check-test-bg-reap.js"

# 1. Negative control: un-reaped tail -f in hooks/tests/ is flagged
FX="$TEST_TMP/fx-red"
mkdir -p "$FX/hooks/tests"
cat > "$FX/hooks/tests/bad.test.sh" <<'EOF'
#!/usr/bin/env bash
tail -f /dev/null >/dev/null 2>&1 &
BAD_PID=$!
EOF
OUT="$(node "$CHECK" --root "$FX" 2>&1)"
RC=$?
assert_eq "1" "$RC" "red: un-reaped tail -f exits 1"
assert_contains "$OUT" "hooks/tests/bad.test.sh:2:" "red: reports file:line"

# 2. Green: trap EXIT with kill passes
FX_TRAP="$TEST_TMP/fx-trap"
mkdir -p "$FX_TRAP/hooks/tests"
cat > "$FX_TRAP/hooks/tests/good-trap.test.sh" <<'EOF'
#!/usr/bin/env bash
cleanup() {
  kill "${STANDIN_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT
tail -f /dev/null >/dev/null 2>&1 &
STANDIN_PID=$!
EOF
OUT="$(node "$CHECK" --root "$FX_TRAP" 2>&1)"
RC=$?
assert_eq "0" "$RC" "green: trap EXIT cleanup function passes"

# 3. Green: explicit kill of PID variable passes
FX_KILL="$TEST_TMP/fx-kill"
mkdir -p "$FX_KILL/scripts/sub"
cat > "$FX_KILL/scripts/sub/good-kill.test.sh" <<'EOF'
#!/usr/bin/env bash
sleep 300 &
SPID=$!
kill "$SPID" 2>/dev/null || true
EOF
OUT="$(node "$CHECK" --root "$FX_KILL" 2>&1)"
RC=$?
assert_eq "0" "$RC" "green: explicit kill of PID variable passes"

# 4. Short sleep (<60s) is not flagged
FX_SHORT="$TEST_TMP/fx-short"
mkdir -p "$FX_SHORT/hooks/tests"
cat > "$FX_SHORT/hooks/tests/short.test.sh" <<'EOF'
#!/usr/bin/env bash
sleep 5 &
EOF
OUT="$(node "$CHECK" --root "$FX_SHORT" 2>&1)"
RC=$?
assert_eq "0" "$RC" "green: short sleep (<60s) is not flagged"

finalize_test "check-test-bg-reap"
