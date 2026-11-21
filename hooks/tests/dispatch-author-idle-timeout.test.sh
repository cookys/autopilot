#!/usr/bin/env bash
# Idle limit vs hard cap for every runner dispatch-author launches.
# --timeout is the idle limit: progress (capture bytes or process-tree CPU)
# extends the run. Silence past the idle limit is idle_timeout. A wall cap
# (--hard-timeout) is hard_timeout. A fast non-zero exit is exit_failure.
# RED before the watcher: a printing stub past --timeout is killed (no extend,
# dispatch not 0); a silent sleeper is transport_status "timeout" not
# idle_timeout; --hard-timeout is an unknown arg (exit 2).
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
export AUTOPILOT_STRIKE_WRITER=off
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"
mkdir -p "$ENGINE_CAPABILITY_DIR"
# The grok effort probe invokes the same binary before the timed run.
export AUTOPILOT_GROK_EFFORT_PROBE=0
export AUTOPILOT_AUTHOR_SAMPLE_S=1
export AUTOPILOT_AUTHOR_KILL_GRACE_SECS=1

SCRIPT="$REPO_ROOT/scripts/dispatch-author.sh"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s' "Write a verification plan for the change and include exactly three bullet items." > "$PROMPT"
RUNS="$TEST_TMP/runs"
mkdir -p "$RUNS"

# Frame markers live in the wrapped prompt. Echo them so a successful body stays inside BEGIN/END.
cat > "$TEST_TMP/read-frame.sh" <<'EOF'
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
EOF

json_field() {
  node -e '
const fs = require("fs");
const s = fs.readFileSync(process.argv[1], "utf8");
const a = s.indexOf("{");
const b = s.lastIndexOf("}");
if (a < 0 || b < a) process.exit(1);
const o = JSON.parse(s.slice(a, b + 1));
const v = o[process.argv[2]];
process.stdout.write(v == null ? "" : String(v));
' "$1" "$2"
}

run_case() {
  local id="$1"; shift
  local out="$TEST_TMP/${id}.out" err="$TEST_TMP/${id}.err"
  set +e
  env DISPATCH_QUIET=1 DISPATCH_DETACH=0 AUTOPILOT_SETTLE_MS=0 \
    AUTOPILOT_GROK_EFFORT_PROBE=0 AUTOPILOT_AUTHOR_SAMPLE_S=1 \
    AUTOPILOT_AUTHOR_KILL_GRACE_SECS=1 AUTOPILOT_DISPATCH_RUNS_DIR="$RUNS" \
    "$SCRIPT" --runner grok --model gpt-test --prompt-file "$PROMPT" --bin "$1" \
    --run-id "$id" "${@:2}" >"$out" 2>"$err"
  local rc=$?
  set -e
  printf '%s' "$rc" > "$TEST_TMP/${id}.rc"
}

# --- (a) printing past the idle limit is extended, not killed ---
STUB_PRINT="$TEST_TMP/runner-print"
cat > "$STUB_PRINT" <<EOF
#!/usr/bin/env bash
. "$TEST_TMP/read-frame.sh"
printf '%s\n' "\$begin"
deadline=\$((SECONDS + 5))
n=0
while [ "\$SECONDS" -lt "\$deadline" ]; do
  n=\$((n + 1))
  printf 'tick %s\n' "\$n"
  sleep 0.4
done
printf '%s\n' "\$end"
EOF
chmod +x "$STUB_PRINT"

PRINT_START=$(date +%s)
run_case idle-print "$STUB_PRINT" --timeout 2s --hard-timeout 30s
PRINT_ELAPSED=$(( $(date +%s) - PRINT_START ))
PRINT_RC="$(cat "$TEST_TMP/idle-print.rc")"
PRINT_OUT="$(cat "$TEST_TMP/idle-print.out")"
PRINT_LOG="$(json_field "$TEST_TMP/idle-print.out" raw_log || true)"
assert_eq "0" "$PRINT_RC" "printing past idle limit exits 0 (rc=${PRINT_RC} elapsed=${PRINT_ELAPSED}s)"
assert_contains "$PRINT_OUT" '"status": "authored"' "printing past idle limit is authored"
assert_file_exists "$PRINT_LOG" "printing past idle limit keeps a raw log"
assert_contains "$(cat "$PRINT_LOG")" "extend: progress seen" "printing past idle limit records an extend line"
assert_eq "0" "$([[ "$PRINT_ELAPSED" -lt 20 ]] && echo 0 || echo "$PRINT_ELAPSED")" \
  "printing stub finishes before the hard cap (elapsed=${PRINT_ELAPSED}s)"

# --- (a-cpu) silent CPU burn past the idle limit is extended ---
STUB_CPU="$TEST_TMP/runner-cpu"
cat > "$STUB_CPU" <<EOF
#!/usr/bin/env bash
. "$TEST_TMP/read-frame.sh"
printf '%s\n' "\$begin"
deadline=\$((SECONDS + 4))
while [ "\$SECONDS" -lt "\$deadline" ]; do
  :
done
printf '%s\n' "\$end"
EOF
chmod +x "$STUB_CPU"

run_case idle-cpu "$STUB_CPU" --timeout 2s --hard-timeout 30s
CPU_RC="$(cat "$TEST_TMP/idle-cpu.rc")"
CPU_OUT="$(cat "$TEST_TMP/idle-cpu.out")"
CPU_LOG="$(json_field "$TEST_TMP/idle-cpu.out" raw_log || true)"
assert_eq "0" "$CPU_RC" "CPU burn past idle limit exits 0 (rc=${CPU_RC})"
assert_contains "$CPU_OUT" '"status": "authored"' "CPU burn past idle limit is authored"
assert_contains "$(cat "$CPU_LOG")" "extend: progress seen (cpu" "CPU burn records a cpu extend line"

# --- (b) silent sleep past the idle limit is idle_timeout; partial output kept ---
STUB_SLEEP="$TEST_TMP/runner-sleep"
cat > "$STUB_SLEEP" <<'EOF'
#!/usr/bin/env bash
printf 'PARTIAL-KEEP\n'
exec sleep 30
EOF
chmod +x "$STUB_SLEEP"

SLEEP_START=$(date +%s)
run_case idle-sleep "$STUB_SLEEP" --timeout 2s --hard-timeout 30s
SLEEP_ELAPSED=$(( $(date +%s) - SLEEP_START ))
SLEEP_RC="$(cat "$TEST_TMP/idle-sleep.rc")"
SLEEP_OUT="$(cat "$TEST_TMP/idle-sleep.out")"
SLEEP_ERR="$(cat "$TEST_TMP/idle-sleep.err")"
SLEEP_LOG="$(json_field "$TEST_TMP/idle-sleep.out" raw_log || true)"
assert_eq "3" "$SLEEP_RC" "silent sleeper dispatch exit is 3 (runner_failed), watcher exit stays in the result (rc=${SLEEP_RC})"
assert_contains "$SLEEP_OUT" '"status": "runner_failed"' "silent sleeper is runner_failed"
assert_contains "$SLEEP_OUT" 'runner exited 124' "silent sleeper watcher exits 124"
assert_contains "$SLEEP_OUT" '"transport_status": "idle_timeout"' "silent sleeper transport_status is idle_timeout"
assert_contains "$SLEEP_ERR" "dispatch-author: idle for 2s with no output or CPU; killed (raise --timeout to allow longer idle)" \
  "silent sleeper stderr names the idle limit"
assert_not_contains "$SLEEP_ERR" "hard cap" "silent sleeper is not a hard cap"
assert_file_exists "$SLEEP_LOG" "silent sleeper keeps the partial raw log"
assert_contains "$(cat "$SLEEP_LOG")" "PARTIAL-KEEP" "silent sleeper partial output is not deleted"
assert_contains "$(cat "$RUNS/idle-sleep.manifest.json")" '"transport_status": "idle_timeout"' \
  "silent sleeper manifest transport_status is idle_timeout"
assert_eq "0" "$([[ "$SLEEP_ELAPSED" -le 12 ]] && echo 0 || echo "$SLEEP_ELAPSED")" \
  "silent sleeper is killed within idle+grace (elapsed=${SLEEP_ELAPSED}s)"

# --- (c) printing past the hard cap is hard_timeout ---
STUB_HARD="$TEST_TMP/runner-hard"
cat > "$STUB_HARD" <<EOF
#!/usr/bin/env bash
. "$TEST_TMP/read-frame.sh"
printf '%s\n' "\$begin"
printf 'HARD-TICK\n'
deadline=\$((SECONDS + 8))
while [ "\$SECONDS" -lt "\$deadline" ]; do
  printf 'HARD-TICK\n'
  sleep 0.3
done
printf '%s\n' "\$end"
EOF
chmod +x "$STUB_HARD"

HARD_START=$(date +%s)
run_case hard-cap "$STUB_HARD" --timeout 30s --hard-timeout 3s
HARD_ELAPSED=$(( $(date +%s) - HARD_START ))
HARD_RC="$(cat "$TEST_TMP/hard-cap.rc")"
HARD_OUT="$(cat "$TEST_TMP/hard-cap.out")"
HARD_ERR="$(cat "$TEST_TMP/hard-cap.err")"
HARD_LOG="$(json_field "$TEST_TMP/hard-cap.out" raw_log || true)"
assert_eq "3" "$HARD_RC" "hard cap dispatch exit is 3 (rc=${HARD_RC})"
assert_contains "$HARD_OUT" '"transport_status": "hard_timeout"' "printing past the hard cap is hard_timeout"
assert_not_contains "$HARD_OUT" '"transport_status": "idle_timeout"' "hard cap is not idle_timeout"
assert_contains "$HARD_ERR" "dispatch-author: hard cap 3s reached; killed" "hard cap stderr names the cap"
assert_file_exists "$HARD_LOG" "hard cap keeps the partial raw log"
assert_contains "$(cat "$HARD_LOG")" "HARD-TICK" "hard cap partial output is not deleted"
assert_contains "$(cat "$RUNS/hard-cap.manifest.json")" '"transport_status": "hard_timeout"' \
  "hard cap manifest transport_status is hard_timeout"
assert_eq "0" "$([[ "$HARD_ELAPSED" -le 12 ]] && echo 0 || echo "$HARD_ELAPSED")" \
  "hard cap kills within the cap plus grace (elapsed=${HARD_ELAPSED}s)"

# --- negative control: a fast exit 3 is exit_failure, with no timeout hint ---
STUB_FAIL="$TEST_TMP/runner-fail"
cat > "$STUB_FAIL" <<'EOF'
#!/usr/bin/env bash
printf 'FAIL-KEEP\n'
exit 3
EOF
chmod +x "$STUB_FAIL"

run_case exit-fail "$STUB_FAIL" --timeout 2s --hard-timeout 30s
FAIL_RC="$(cat "$TEST_TMP/exit-fail.rc")"
FAIL_OUT="$(cat "$TEST_TMP/exit-fail.out")"
FAIL_ERR="$(cat "$TEST_TMP/exit-fail.err")"
assert_eq "3" "$FAIL_RC" "fast exit 3 dispatch exit is 3"
assert_contains "$FAIL_OUT" '"transport_status": "exit_failure"' "fast exit 3 is exit_failure"
assert_not_contains "$FAIL_OUT" '"transport_status": "idle_timeout"' "fast exit 3 is not idle_timeout"
assert_not_contains "$FAIL_OUT" '"transport_status": "hard_timeout"' "fast exit 3 is not hard_timeout"
assert_not_contains "$FAIL_ERR" "idle for" "fast exit 3 has no idle hint"
assert_not_contains "$FAIL_ERR" "hard cap" "fast exit 3 has no hard-cap hint"

finalize_test
