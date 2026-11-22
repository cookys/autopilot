#!/usr/bin/env bash
# hooks/tests/agent-event-emit.test.sh — tests for scripts/lib/agent-event-emit.sh
. "$(dirname "$0")/lib.sh"

# Never inherit a real session id or fleet address
unset AUTOPILOT_SESSION_ID AUTOPILOT_FLEET_ADDRESS AUTOPILOT_FLEET_TASK AUTOPILOT_UPSTREAM_TASK_ID

EMIT_SH="$REPO_ROOT/scripts/lib/agent-event-emit.sh"
LOG_FILE="$TEST_TMP/fleet-events.jsonl"
FAKE_FLEET="$TEST_TMP/fake-fleet"

cat > "$FAKE_FLEET" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "whoami" ]; then
  echo "test-ns/courier/test-seat"
  exit 0
fi
if [ "${1:-}" = "event" ] && [ "${2:-}" = "emit" ]; then
  if [ "${FAKE_FLEET_FAIL:-0}" = "1" ]; then
    exit 3
  fi
  cat >> "${FAKE_FLEET_LOG:?}"
  echo '{"ok":true}'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_FLEET"

export AUTOPILOT_FLEET_BIN="$FAKE_FLEET"
export FAKE_FLEET_LOG="$LOG_FILE"
export AUTOPILOT_FLEET_ADDRESS="test-ns/courier/test-seat"
export AUTOPILOT_SESSION_ID="sess-test-123"
export AUTOPILOT_LANE="autopilot"
export AUTOPILOT_FLEET_TASK="01M81BHZE529XAZ6N0JRR90YAM"

# Case 1: dispatch through helper emits accepted then ended with right fields
(
  # shellcheck source=/dev/null
  . "$EMIT_SH"
  agent_event_emit_init "implementer" "codex" "run-test-1"
  agent_event_emit_accepted
  agent_event_emit_ended 0 "ok"
)
rc1=$?
assert_eq "0" "$rc1" "helper dispatch exits 0"
assert_file_exists "$LOG_FILE" "events log created"

line_count="$(wc -l < "$LOG_FILE" | tr -d ' ')"
assert_eq "2" "$line_count" "two events emitted (accepted + ended)"

line1="$(sed -n '1p' "$LOG_FILE")"
line2="$(sed -n '2p' "$LOG_FILE")"

assert_contains "$line1" '"state":"accepted"' "first event is accepted"
assert_contains "$line1" '"agent_kind":"dispatch"' "agent_kind is dispatch"
assert_contains "$line1" '"runner":"codex"' "runner is codex"
assert_contains "$line1" '"stage":"build"' "stage is build"
assert_contains "$line1" '"run_id":"run-test-1"' "run_id matches"
assert_contains "$line1" '"task_id":"01M81BHZE529XAZ6N0JRR90YAM"' "task_id matches"
assert_contains "$line1" '"seq":1' "seq is 1"
assert_contains "$line1" '"event_id":"run-test-1-1"' "event_id is run-test-1-1"

assert_contains "$line2" '"state":"ended"' "second event is ended"
assert_contains "$line2" '"rc":0' "rc is 0"
assert_contains "$line2" '"detail":"ok"' "detail is ok"
assert_contains "$line2" '"seq":2' "seq is 2"
assert_contains "$line2" '"event_id":"run-test-1-2"' "event_id is run-test-1-2"

# Case 2: emit failure (fake fleet exits 3) does not fail the dispatch
stderr_file="$TEST_TMP/fail-stderr.txt"
(
  export FAKE_FLEET_FAIL=1
  # shellcheck source=/dev/null
  . "$EMIT_SH"
  agent_event_emit_init "reviewer" "agy" "run-test-2"
  agent_event_emit_accepted
  agent_event_emit_ended 1 "err"
) 2>"$stderr_file"
rc2=$?
assert_eq "0" "$rc2" "emit failure does not fail dispatch"
assert_contains "$(cat "$stderr_file")" "agent-event-emit: fleet event emit failed" "stderr hint printed on failure"

# Case 3: ts is positive integer milliseconds
ts_val="$(node -e "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('$LOG_FILE','utf8').trim().split('\n')[0]); process.stdout.write(String(typeof o.ts === 'number' && Number.isInteger(o.ts) && o.ts > 1000000000000));")"
assert_eq "true" "$ts_val" "ts is positive integer milliseconds"

# Case 4: exit trap emits ended with nonzero rc, preserves rc, and passes runner verbatim
LOG_FILE_4="$TEST_TMP/fleet-events-4.jsonl"
(
  export FAKE_FLEET_LOG="$LOG_FILE_4"
  # shellcheck source=/dev/null
  . "$EMIT_SH"
  agent_event_emit_init "implementer" "local" "run-test-4"
  agent_event_emit_register_exit_trap
  agent_event_emit_accepted
  (exit 42)
)
rc4=$?
assert_eq "42" "$rc4" "exit trap preserves nonzero rc"
assert_file_exists "$LOG_FILE_4" "case 4 events log created"
line_count_4="$(wc -l < "$LOG_FILE_4" | tr -d ' ')"
assert_eq "2" "$line_count_4" "case 4 emits accepted + ended"
line4_1="$(sed -n '1p' "$LOG_FILE_4")"
line4_2="$(sed -n '2p' "$LOG_FILE_4")"
assert_contains "$line4_1" '"state":"accepted"' "case 4 first event is accepted"
assert_contains "$line4_1" '"runner":"local"' "case 4 runner passed through verbatim (local)"
assert_contains "$line4_2" '"state":"ended"' "case 4 second event is ended"
assert_contains "$line4_2" '"rc":42' "case 4 ended records nonzero rc 42"
assert_contains "$line4_2" '"runner":"local"' "case 4 ended runner is local"

# Case 5: caller-style invocation (dispatch-explore.sh --runner agy --model gemini-4-hydrogen-low)
# produces runner "agy" in both accepted and ended events, and ended fires on nonzero exit
LOG_FILE_5="$TEST_TMP/fleet-events-5.jsonl"
(
  export FAKE_FLEET_LOG="$LOG_FILE_5"
  bash "$REPO_ROOT/scripts/dispatch-explore.sh" --runner agy --model gemini-4-hydrogen-low --prompt-file /nonexistent-prompt-file >/dev/null 2>&1 || true
)
assert_file_exists "$LOG_FILE_5" "case 5 events log created"
line_count_5="$(wc -l < "$LOG_FILE_5" | tr -d ' ')"
assert_eq "2" "$line_count_5" "case 5 emits accepted + ended on nonzero exit"
line5_1="$(sed -n '1p' "$LOG_FILE_5")"
line5_2="$(sed -n '2p' "$LOG_FILE_5")"
assert_contains "$line5_1" '"state":"accepted"' "case 5 first event is accepted"
assert_contains "$line5_1" '"runner":"agy"' "case 5 accepted runner is agy"
assert_contains "$line5_2" '"state":"ended"' "case 5 second event is ended"
assert_contains "$line5_2" '"rc":2' "case 5 ended records nonzero rc 2"
assert_contains "$line5_2" '"runner":"agy"' "case 5 ended runner is agy"

finalize_test
