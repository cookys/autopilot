#!/usr/bin/env bash
# RED at 06d4a8724829c0ed357aeeb96b75d50de8c5f538: grok elapsed=21s exit=124 and claude-native elapsed=20s exit=124, no transport_status timeout, sleepers left (pgrep 3320090 and 3326537). Plain timeout never KILLs a TERM-ignoring child.
# Kill-after for non-agy dispatch-author runners. A child that ignores TERM
# must still be reaped by `timeout -k`, and only a deadline-elapsed 137 maps
# back to transport_status timeout.
. "$(dirname "$0")/lib.sh"
export CLAUDE_CONFIG_DIR="$TEST_TMP/claude-config"; seed_fake_claude_credentials "$CLAUDE_CONFIG_DIR"

export HOME="$HOOK_HOME"
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
# The grok effort probe invokes the same binary before the timed run. Leave it
# off so a TERM-ignoring stub is only the dispatch itself.
export AUTOPILOT_GROK_EFFORT_PROBE=0

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan for the change and include exactly three bullet items." > "$PROMPT"

# Unique markers. The character class is only in the pgrep pattern so
# `pgrep -f` does not match its own command line.
GROK_SLEEP_SECS=86421
GROK_SLEEP_PAT='sleep 8642[1]'
CLAUDE_SLEEP_SECS=86423
CLAUDE_SLEEP_PAT='sleep 8642[3]'

cleanup_kill_after_sleepers() {
  local pids
  pids="$(pgrep -f "$GROK_SLEEP_PAT" || true)"
  pids="$pids $(pgrep -f "$CLAUDE_SLEEP_PAT" || true)"
  # shellcheck disable=SC2086
  kill -9 $pids 2>/dev/null || true
}
trap 'cleanup_kill_after_sleepers; cleanup_test_tmp' EXIT

# Bound is timeout (2) + grace (2) + slack. An outer timeout -k only exists so a
# red run (no kill-after) can finish and record the failure.
BOUND_SECS=12

run_hang() {
  local runner="$1" bin="$2"
  local start out elapsed exit_code
  start=$(date +%s)
  set +e
  out="$(timeout -k 2 20s env DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
    "$SCRIPT" --runner "$runner" --model gpt-test --prompt-file "$PROMPT" --bin "$bin" --timeout 2s 2>&1)"
  exit_code=$?
  set -e
  elapsed=$(( $(date +%s) - start ))
  printf '%s\n' "$elapsed" "$exit_code" "$out"
}

# --- grok: TERM-ignoring sleeper ---
STUB_GROK_HANG="$TEST_TMP/runner-grok-hang"
cat > "$STUB_GROK_HANG" <<EOF
#!/usr/bin/env bash
trap '' TERM
exec sleep $GROK_SLEEP_SECS
EOF
chmod +x "$STUB_GROK_HANG"

GROK_HANG_RAW="$(run_hang grok "$STUB_GROK_HANG")"
GROK_HANG_ELAPSED="$(printf '%s\n' "$GROK_HANG_RAW" | sed -n '1p')"
GROK_HANG_EXIT="$(printf '%s\n' "$GROK_HANG_RAW" | sed -n '2p')"
GROK_HANG_OUT="$(printf '%s\n' "$GROK_HANG_RAW" | sed -n '3,$p')"

assert_eq "0" "$([[ "$GROK_HANG_ELAPSED" -le "$BOUND_SECS" ]] && echo 0 || echo "$GROK_HANG_ELAPSED")" \
  "grok TERM-ignoring sleeper returns within timeout+grace+slack (elapsed=${GROK_HANG_ELAPSED}s exit=${GROK_HANG_EXIT})"
assert_contains "$GROK_HANG_OUT" '"transport_status": "timeout"' "grok kill-after maps to transport_status timeout"
sleep 0.5
GROK_LEFT="$(pgrep -f "$GROK_SLEEP_PAT" || true)"
assert_eq "" "$GROK_LEFT" "no fake grok sleeper remains after timeout plus grace"

# --- grok: normal exit is not a timeout ---
STUB_GROK_OK="$TEST_TMP/runner-grok-ok"
cat > "$STUB_GROK_OK" <<'EOF'
#!/usr/bin/env bash
pf=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--prompt-file" ]; then
    i=$((i + 1)); pf="${args[$i]}"
  fi
  i=$((i + 1))
done
begin=""; end=""
if [ -n "$pf" ] && [ -f "$pf" ]; then
  begin=$(grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' "$pf" | head -n1)
  end=$(grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' "$pf" | head -n1)
fi
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "ok from grok" "$end"
else
  printf '%s\n' "ok from grok"
fi
EOF
chmod +x "$STUB_GROK_OK"

GROK_OK_START=$(date +%s)
GROK_OK_OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner grok --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_GROK_OK" --timeout 2s 2>&1)"
GROK_OK_EXIT=$?
GROK_OK_ELAPSED=$(( $(date +%s) - GROK_OK_START ))
assert_eq "0" "$GROK_OK_EXIT" "normal grok stub exits 0"
assert_not_contains "$GROK_OK_OUT" '"transport_status": "timeout"' "normal grok stub is not transport_status timeout"
assert_eq "0" "$([[ "$GROK_OK_ELAPSED" -le 8 ]] && echo 0 || echo "$GROK_OK_ELAPSED")" \
  "normal grok stub finishes fast (elapsed=${GROK_OK_ELAPSED}s)"

# --- grok: early self-SIGKILL is not a timeout ---
STUB_GROK_KILL="$TEST_TMP/runner-grok-self-kill"
cat > "$STUB_GROK_KILL" <<'EOF'
#!/usr/bin/env bash
kill -9 $$
exit 0
EOF
chmod +x "$STUB_GROK_KILL"

set +e
GROK_KILL_OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner grok --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_GROK_KILL" --timeout 30s 2>&1)"
GROK_KILL_EXIT=$?
set -e
assert_neq "0" "$GROK_KILL_EXIT" "grok early self-SIGKILL dispatch exit is non-zero (exit=${GROK_KILL_EXIT})"
assert_not_contains "$GROK_KILL_OUT" '"transport_status": "timeout"' "grok early self-SIGKILL is not transport_status timeout"

# --- claude-native: TERM-ignoring sleeper ---
STUB_CLAUDE_HANG="$TEST_TMP/runner-claude-hang"
cat > "$STUB_CLAUDE_HANG" <<EOF
#!/usr/bin/env bash
trap '' TERM
exec sleep $CLAUDE_SLEEP_SECS
EOF
chmod +x "$STUB_CLAUDE_HANG"

CLAUDE_HANG_RAW="$(run_hang claude-native "$STUB_CLAUDE_HANG")"
CLAUDE_HANG_ELAPSED="$(printf '%s\n' "$CLAUDE_HANG_RAW" | sed -n '1p')"
CLAUDE_HANG_EXIT="$(printf '%s\n' "$CLAUDE_HANG_RAW" | sed -n '2p')"
CLAUDE_HANG_OUT="$(printf '%s\n' "$CLAUDE_HANG_RAW" | sed -n '3,$p')"

assert_eq "0" "$([[ "$CLAUDE_HANG_ELAPSED" -le "$BOUND_SECS" ]] && echo 0 || echo "$CLAUDE_HANG_ELAPSED")" \
  "claude-native TERM-ignoring sleeper returns within timeout+grace+slack (elapsed=${CLAUDE_HANG_ELAPSED}s exit=${CLAUDE_HANG_EXIT})"
assert_contains "$CLAUDE_HANG_OUT" '"transport_status": "timeout"' "claude-native kill-after maps to transport_status timeout"
sleep 0.5
CLAUDE_LEFT="$(pgrep -f "$CLAUDE_SLEEP_PAT" || true)"
assert_eq "" "$CLAUDE_LEFT" "no fake claude sleeper remains after timeout plus grace"

# --- claude-native: normal exit is not a timeout ---
STUB_CLAUDE_OK="$TEST_TMP/runner-claude-ok"
cat > "$STUB_CLAUDE_OK" <<'EOF'
#!/usr/bin/env bash
prompt="$(cat)"
begin=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-AUTHOR-[0-9a-f]{32}>>>$' | head -n1)
end=$(printf '%s\n' "$prompt" | grep -E '^<<<AUTOPILOT-END-[0-9a-f]{32}>>>$' | head -n1)
if [ -n "$begin" ] && [ -n "$end" ]; then
  printf '%s\n%s\n%s\n' "$begin" "ok from claude" "$end"
else
  printf '%s\n' "ok from claude"
fi
EOF
chmod +x "$STUB_CLAUDE_OK"

CLAUDE_OK_START=$(date +%s)
CLAUDE_OK_OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner claude-native --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_CLAUDE_OK" --timeout 2s 2>&1)"
CLAUDE_OK_EXIT=$?
CLAUDE_OK_ELAPSED=$(( $(date +%s) - CLAUDE_OK_START ))
assert_eq "0" "$CLAUDE_OK_EXIT" "normal claude-native stub exits 0"
assert_not_contains "$CLAUDE_OK_OUT" '"transport_status": "timeout"' "normal claude-native stub is not transport_status timeout"
assert_eq "0" "$([[ "$CLAUDE_OK_ELAPSED" -le 8 ]] && echo 0 || echo "$CLAUDE_OK_ELAPSED")" \
  "normal claude-native stub finishes fast (elapsed=${CLAUDE_OK_ELAPSED}s)"

# --- claude-native: early self-SIGKILL is not a timeout ---
STUB_CLAUDE_KILL="$TEST_TMP/runner-claude-self-kill"
cat > "$STUB_CLAUDE_KILL" <<'EOF'
#!/usr/bin/env bash
kill -9 $$
exit 0
EOF
chmod +x "$STUB_CLAUDE_KILL"

set +e
CLAUDE_KILL_OUT="$(DISPATCH_QUIET=1 AUTOPILOT_SETTLE_MS=0 AUTOPILOT_AUTHOR_KILL_GRACE_SECS=2 \
  "$SCRIPT" --runner claude-native --model gpt-test --prompt-file "$PROMPT" --bin "$STUB_CLAUDE_KILL" --timeout 30s 2>&1)"
CLAUDE_KILL_EXIT=$?
set -e
assert_neq "0" "$CLAUDE_KILL_EXIT" "claude-native early self-SIGKILL dispatch exit is non-zero (exit=${CLAUDE_KILL_EXIT})"
assert_not_contains "$CLAUDE_KILL_OUT" '"transport_status": "timeout"' "claude-native early self-SIGKILL is not transport_status timeout"

finalize_test
