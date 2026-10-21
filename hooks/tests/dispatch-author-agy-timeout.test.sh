#!/usr/bin/env bash
# RED at 6d00e2687ebfad4e80fe10ebe8c9793621edbf1f: TERM-ignoring sleeper ran out the 30s outer wrapper (elapsed=30s exit=124) with no transport_status timeout — agy branch had no outer timeout.
# Outer timeout + kill grace for the agy branch of dispatch-author.sh.
# agy ignores SIGTERM; the outer `timeout -k` must still reap a sleeper that traps TERM.
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session_isolation"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
# bwrap --tmpfs needs the leaf's parents to exist on the read-only root.
mkdir -p "$HOME/.gemini/antigravity-cli/log" "$HOME/.gemini/antigravity-cli/crashes"
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan for the change and include exactly three bullet items." > "$PROMPT"

# Unique sleeper marker. The character class is only in the pgrep pattern so
# `pgrep -f` does not match its own command line.
AGY_SLEEP_SECS=86417
AGY_SLEEP_PAT='sleep 8641[7]'

cleanup_agy_sleeper() {
  local pids
  pids="$(pgrep -f "$AGY_SLEEP_PAT" || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}
trap 'cleanup_agy_sleeper; cleanup_test_tmp' EXIT

if ! command -v script >/dev/null 2>&1 || ! command -v bwrap >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] script or bwrap missing"
  exit 0
fi

# --- case 1: TERM-ignoring sleeper is reaped and classified timeout ---
STUB_AGY_HANG="$TEST_TMP/runner-agy-hang"
cat > "$STUB_AGY_HANG" <<EOF
#!/usr/bin/env bash
trap '' TERM
exec sleep $AGY_SLEEP_SECS
EOF
chmod +x "$STUB_AGY_HANG"

HANG_START=$(date +%s)
set +e
HANG_OUT="$(timeout 30s env DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_AGY_HANG" --timeout 3s 2>&1)"
HANG_EXIT=$?
set -e
HANG_ELAPSED=$(( $(date +%s) - HANG_START ))

assert_eq "0" "$([[ "$HANG_ELAPSED" -le 20 ]] && echo 0 || echo "$HANG_ELAPSED")" \
  "agy TERM-ignoring sleeper returns within timeout+grace+buffer (elapsed=${HANG_ELAPSED}s exit=${HANG_EXIT})"
assert_eq "3" "$HANG_EXIT" "agy outer timeout exits 3 (runner_failed)"
assert_contains "$HANG_OUT" '"transport_status": "timeout"' "agy outer timeout maps to transport_status timeout"
assert_contains "$HANG_OUT" '"status": "runner_failed"' "agy outer timeout is runner_failed"

sleep 0.5
HANG_LEFT="$(pgrep -f "$AGY_SLEEP_PAT" || true)"
assert_eq "" "$HANG_LEFT" "no fake agy sleeper remains after timeout plus grace"

# --- case 2: a normally exiting fake agy is still authored ---
STUB_AGY_OK="$TEST_TMP/runner-agy-ok"
cat > "$STUB_AGY_OK" <<'EOF'
#!/usr/bin/env bash
begin=""; end=""
for a in "$@"; do
  if [ -z "$begin" ]; then
    begin=$(printf '%s\n' "$a" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
  fi
  if [ -z "$end" ]; then
    end=$(printf '%s\n' "$a" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
  fi
done
body="ok from agy"
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "$body" "$end"
else
  printf '%s\n' "$body"
fi
EOF
chmod +x "$STUB_AGY_OK"

OK_OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_AGY_OK" --timeout 3s 2>&1)"
OK_EXIT=$?
assert_eq "0" "$OK_EXIT" "normal agy stub exits 0"
assert_contains "$OK_OUT" '"status": "authored"' "normal agy stub returns authored"

# --- case 3: brand-new HOME with no .gemini directory still authors ---
# RED at 89f4a823268a80803f843d18bebc1cd069890445: fresh HOME, exit 3, status runner_failed ("runner exited 1"); raw log `bwrap: Can't mkdir parents for <HOME>/.gemini/antigravity-cli/log: Read-only file system`.
FRESH_HOME="$TEST_TMP/fresh-home-no-gemini"
mkdir -p "$FRESH_HOME"
test ! -e "$FRESH_HOME/.gemini"
FRESH_OUT="$(HOME="$FRESH_HOME" DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner agy --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_AGY_OK" --timeout 3s 2>&1)"
FRESH_EXIT=$?
assert_eq "0" "$FRESH_EXIT" "fresh HOME with no .gemini exits 0"
assert_contains "$FRESH_OUT" '"status": "authored"' "fresh HOME with no .gemini returns authored"
test -d "$FRESH_HOME/.gemini/antigravity-cli/log"
test -d "$FRESH_HOME/.gemini/antigravity-cli/crashes"

finalize_test
