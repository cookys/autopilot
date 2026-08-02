#!/usr/bin/env bash
# born-from "2026-07-05 late-flush empty_output misclassification fix (BACKLOG third occurrence)"
# Content-driven invariant: size-stable => settled; bounded empty-grace => honest empty.
# Case 2 is the honest-empty negative control the BACKLOG entry demands (real empties must not be blurred).

. "$(dirname "$0")/lib.sh"

# Isolate from ambient session markers
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/session_isolation"
mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT_FILE="$TEST_TMP/prompt.txt"
printf 'Write a short answer.\n' > "$PROMPT_FILE"
EXTRA_ARGS=()

# Observe the production helper's logical 250 ms poll ticks without replacing
# dispatch-author.sh or its quiescence implementation. Wall time includes arbitrary
# scheduler delay on a saturated host; the helper's own elapsed budget advances once
# per `sleep 0.25`, which is the semantic clock its grace/deadline decisions use.
REAL_SLEEP="$(command -v sleep)"
QUIESCENCE_POLL_LOG="$TEST_TMP/quiescence-polls.log"
TIMING_BIN="$TEST_TMP/timing-bin"
mkdir -p "$TIMING_BIN"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [ "$#" -eq 1 ] && [ "$1" = "0.25" ]; then' \
  '  printf "tick\\n" >> "$AUTOPILOT_TEST_QUIESCENCE_POLL_LOG"' \
  'fi' \
  'exec "$AUTOPILOT_TEST_REAL_SLEEP" "$@"' \
  > "$TIMING_BIN/sleep"
chmod +x "$TIMING_BIN/sleep"
export AUTOPILOT_TEST_REAL_SLEEP="$REAL_SLEEP"
export AUTOPILOT_TEST_QUIESCENCE_POLL_LOG="$QUIESCENCE_POLL_LOG"
export PATH="$TIMING_BIN:$PATH"

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
  local runner="codex"
  if [[ "$2" == "cc-shim" || "$2" == "codex" ]]; then
    runner="$2"
    shift 2
  else
    shift 1
  fi

  local stdout_file="$TEST_TMP/dispatch-stdout.$$"
  local stderr_file="$TEST_TMP/dispatch-stderr.$$"

  : > "$QUIESCENCE_POLL_LOG"
  START_TS=$(date +%s)
  set +e
  DISPATCH_QUIET=1 "$@" "$SCRIPT" \
    --runner "$runner" \
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
  DISPATCH_QUIESCENCE_POLLS=$(wc -l < "$QUIESCENCE_POLL_LOG")

  rm -f "$stdout_file" "$stderr_file"
}

poll_budget_ok() {
  [ "$1" -le "$2" ]
}

assert_poll_budget() {
  local actual="$1"
  local max="$2"
  local msg="$3"

  if poll_budget_ok "$actual" "$max"; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "$msg: expected <= $max logical polls, got $actual"
  fi
}

assert_poll_budget_rejects() {
  local actual="$1"
  local max="$2"
  local msg="$3"

  if poll_budget_ok "$actual" "$max"; then
    fail "$msg: planted over-budget path unexpectedly passed ($actual <= $max)"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
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

late_stub=$(make_stub "ccshim-late-flush" 'setsid bash -c '"'"'sleep 2; printf "LATE-ANSWER\n"'"'"' &
exit 0')
run_dispatch "$late_stub" cc-shim env ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test-token
assert_eq "$DISPATCH_EXIT" "0" "ccshim-late-flush exit"
assert_eq "$DISPATCH_STATUS" "authored" "ccshim-late-flush status"
if [ -n "$DISPATCH_RAW_LOG" ] && [ -r "$DISPATCH_RAW_LOG" ]; then
  assert_contains "$(cat "$DISPATCH_RAW_LOG")" "LATE-ANSWER" "ccshim-late-flush raw log"
else
  fail "ccshim-late-flush raw log missing: $DISPATCH_RAW_LOG"
fi
assert_ge "$DISPATCH_ELAPSED" "2" "ccshim-late-flush waits for late content"

empty_stub=$(make_stub "codex-genuine-empty" 'exit 0')
run_dispatch "$empty_stub" env AUTOPILOT_EMPTY_GRACE_MS=1000
assert_eq "$DISPATCH_EXIT" "1" "genuine-empty-fast exit"
assert_eq "$DISPATCH_STATUS" "empty_output" "genuine-empty-fast status"
assert_poll_budget "$DISPATCH_QUIESCENCE_POLLS" "4" "genuine-empty-fast uses tuned empty grace"

immediate_body='echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2

sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done

cat >/dev/null 2>&1 || true
msg="OK"
if [ -n "$sidecar" ]; then
  printf "%s\n" "$msg" > "$sidecar"
fi
printf "%s\n" "$msg"
exit 0'
immediate_stub=$(make_stub "codex-immediate-content" "$immediate_body")
run_dispatch "$immediate_stub" env
assert_eq "$DISPATCH_EXIT" "0" "immediate-content exit"
assert_eq "$DISPATCH_STATUS" "authored" "immediate-content status"
assert_poll_budget "$DISPATCH_QUIESCENCE_POLLS" "4" "immediate-content returns after stable poll window"

# Discriminating negative control: the same real dispatch path is forced to require
# eight stable polls. The four-poll semantic oracle above must reject that planted
# over-budget path, proving it is not an unconditional pass.
run_dispatch "$immediate_stub" env AUTOPILOT_STABLE_POLLS=8
assert_eq "$DISPATCH_EXIT" "0" "over-budget-control exit"
assert_eq "$DISPATCH_STATUS" "authored" "over-budget-control status"
assert_poll_budget_rejects "$DISPATCH_QUIESCENCE_POLLS" "4" "over-budget-control is rejected"

drip_stub=$(make_stub "ccshim-drip-writer" 'setsid bash -c '"'"'for i in $(seq 1 50); do printf x; sleep 0.2; done'"'"' &
exit 0')
run_dispatch "$drip_stub" cc-shim env ANTHROPIC_BASE_URL=http://127.0.0.1:9 ANTHROPIC_AUTH_TOKEN=test-token AUTOPILOT_SETTLE_MS=1500
assert_eq "$DISPATCH_EXIT" "0" "ccshim-drip-writer-deadline-bounded exit"
assert_eq "$DISPATCH_STATUS" "authored" "ccshim-drip-writer-deadline-bounded status"
assert_le "$DISPATCH_ELAPSED" "$(test_timing_scale 7)" "ccshim-drip-writer-deadline-bounded capped by settle deadline"

timeout_stub=$(make_stub "codex-runner-timeout" 'exec sleep 30')
EXTRA_ARGS=(--timeout 2s)
run_dispatch "$timeout_stub" env AUTOPILOT_EMPTY_GRACE_MS=500
EXTRA_ARGS=()
assert_eq "$DISPATCH_EXIT" "3" "runner-timeout-parity exit"
assert_eq "$DISPATCH_STATUS" "runner_failed" "runner-timeout-parity status"
assert_le "$DISPATCH_ELAPSED" "$(test_timing_scale 10)" "runner-timeout-parity bounded by timeout"

# big-output-pipefail regression: THE root cause of the 2026-07-05 empty_output
# epidemic — bash `set -o pipefail` + a piped `grep -q` early-exit SIGPIPEs the
# upstream tr/sed on multi-KB captures, so found content is misclassified empty
# ~97% of the time. A large payload must classify "authored", not empty.
big_body='echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2

sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done

cat >/dev/null 2>&1 || true
payload=$(head -c 6000 /dev/urandom | base64)
if [ -n "$sidecar" ]; then
  printf "%s\n" "$payload" > "$sidecar"
fi
printf "%s\n" "$payload"
exit 0'
big_stub=$(make_stub "codex-big-output" "$big_body")
run_dispatch "$big_stub" env
assert_eq "$DISPATCH_EXIT" "0" "big-output-pipefail exit"
assert_eq "$DISPATCH_STATUS" "authored" "big-output-pipefail status (must not false-empty)"
assert_poll_budget "$DISPATCH_QUIESCENCE_POLLS" "4" "big-output-pipefail returns after stable poll window"

finalize_test
