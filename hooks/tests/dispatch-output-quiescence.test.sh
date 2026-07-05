#!/usr/bin/env bash
# born-from "2026-07-05 late-flush empty_output misclassification fix (BACKLOG third occurrence)"
# Content-driven invariant: size-stable => settled; bounded empty-grace => honest empty.
# Case 2 is the honest-empty negative control the BACKLOG entry demands (real empties must not be blurred).

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT_FILE="$TEST_TMP/prompt.txt"
printf 'Write a short answer.\n' > "$PROMPT_FILE"
EXTRA_ARGS=()

make_stub() {
  local name="$1"
  local body="$2"
  local stub="$TEST_TMP/$name"
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$body"
  } > "$stub"
  chmod +x "$stub"
  printf '%s\n' "$stub"
}

json_field() {
  local json="$1"
  local field="$2"
  printf '%s\n' "$json" \
    | grep -o "\"$field\": \"[^\"]*\"" \
    | sed "s/^\"$field\": \"//; s/\"$//" \
    | head -n 1
}

run_dispatch() {
  local stub="$1"
  shift

  local stdout_file="$TEST_TMP/dispatch-stdout.$$"
  local stderr_file="$TEST_TMP/dispatch-stderr.$$"

  START_TS=$(date +%s)
  set +e
  DISPATCH_QUIET=1 "$@" "$SCRIPT" \
    --runner codex \
    --model test-model \
    --prompt-file "$PROMPT_FILE" \
    --bin "$stub" \
    "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}" \
    > "$stdout_file" 2> "$stderr_file"
  DISPATCH_EXIT=$?
  END_TS=$(date +%s)

  DISPATCH_STDOUT=$(cat "$stdout_file")
  DISPATCH_STDERR=$(cat "$stderr_file")
  DISPATCH_ELAPSED=$((END_TS - START_TS))
  DISPATCH_STATUS=$(json_field "$DISPATCH_STDOUT" "status")
  DISPATCH_RAW_LOG=$(json_field "$DISPATCH_STDOUT" "raw_log")

  rm -f "$stdout_file" "$stderr_file"
}

assert_le() {
  local actual="$1"
  local max="$2"
  local msg="$3"

  if [ "$actual" -le "$max" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg: expected <= $max, got $actual"
  fi
}

assert_ge() {
  local actual="$1"
  local min="$2"
  local msg="$3"

  if [ "$actual" -ge "$min" ]; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg: expected >= $min, got $actual"
  fi
}

late_stub=$(make_stub "codex-late-flush" 'setsid bash -c '"'"'sleep 2; printf "LATE-ANSWER\n"'"'"' &
exit 0')
run_dispatch "$late_stub" env
assert_eq "$DISPATCH_EXIT" "0" "late-flush-authored exit"
assert_eq "$DISPATCH_STATUS" "authored" "late-flush-authored status"
if [ -n "$DISPATCH_RAW_LOG" ] && [ -r "$DISPATCH_RAW_LOG" ]; then
  assert_contains "$(cat "$DISPATCH_RAW_LOG")" "LATE-ANSWER" "late-flush-authored raw log"
else
  fail "late-flush-authored raw log missing: $DISPATCH_RAW_LOG"
fi
assert_ge "$DISPATCH_ELAPSED" "2" "late-flush-authored waits for late content"

empty_stub=$(make_stub "codex-genuine-empty" 'exit 0')
run_dispatch "$empty_stub" env AUTOPILOT_EMPTY_GRACE_MS=1000
assert_eq "$DISPATCH_EXIT" "1" "genuine-empty-fast exit"
assert_eq "$DISPATCH_STATUS" "empty_output" "genuine-empty-fast status"
assert_le "$DISPATCH_ELAPSED" "5" "genuine-empty-fast uses tuned empty grace"

immediate_stub=$(make_stub "codex-immediate-content" 'printf "OK\n"
exit 0')
run_dispatch "$immediate_stub" env
assert_eq "$DISPATCH_EXIT" "0" "immediate-content exit"
assert_eq "$DISPATCH_STATUS" "authored" "immediate-content status"
assert_le "$DISPATCH_ELAPSED" "5" "immediate-content returns quickly"

drip_stub=$(make_stub "codex-drip-writer" 'setsid bash -c '"'"'for i in $(seq 1 50); do printf x; sleep 0.2; done'"'"' &
exit 0')
run_dispatch "$drip_stub" env AUTOPILOT_SETTLE_MS=1500
assert_eq "$DISPATCH_EXIT" "0" "drip-writer-deadline-bounded exit"
assert_eq "$DISPATCH_STATUS" "authored" "drip-writer-deadline-bounded status"
assert_le "$DISPATCH_ELAPSED" "7" "drip-writer-deadline-bounded capped by settle deadline"

timeout_stub=$(make_stub "codex-runner-timeout" 'exec sleep 30')
EXTRA_ARGS=(--timeout 2s)
run_dispatch "$timeout_stub" env AUTOPILOT_EMPTY_GRACE_MS=500
EXTRA_ARGS=()
assert_eq "$DISPATCH_EXIT" "3" "runner-timeout-parity exit"
assert_eq "$DISPATCH_STATUS" "runner_failed" "runner-timeout-parity status"
assert_le "$DISPATCH_ELAPSED" "10" "runner-timeout-parity bounded by timeout"

finalize_test
