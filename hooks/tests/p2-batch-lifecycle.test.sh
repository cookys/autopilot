#!/usr/bin/env bash
# hooks/tests/p2-batch-lifecycle.test.sh - BL-0055 P2-3: stop signals, SIGKILL of the launcher or the wrapper, multi-pause resume, resume position. Fake claude only.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib-p2.sh"

echo "--- lifecycle"
# lifecycle: the first TERM/INT is a safe pause, the second is a hard stop, SIGKILL of the launcher leaves a wrapper that pauses
life() { # <name> <loop script> <loop manifest> <loop wrapper> <sig1> [<sig2>]: loop in the background, a slow probe keeps the first id busy
  local n="$1" l="$2" m="$3" w="$4" s1="$5" s2="${6:-}" d="$TEST_TMP/run-life-$1"; rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR" "$d"
  env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_PROBE_SLEEP=3 \
    node "$l" --manifest "$m" --run-dir "$d" --clone "$CLONE" --credentials-source "$TEST_TMP/cred-fresh.json" --wrapper "$w" --poll-s 0.2 >"$d.out" 2>&1 </dev/null &
  local lp=$!; local i=0; while [ ! -s "$d/loop.wrapper.pid" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
  sleep 1; LWPID=$(cat "$d/loop.wrapper.pid"); kill -"$s1" "$lp"; [ -n "$s2" ] && { sleep 0.5; kill -"$s2" "$lp"; }
  wait "$lp" 2>/dev/null; LIFE_RC=$?
  LIFE_ALIVE_AFTER_LOOP=$(kill -0 "$LWPID" 2>/dev/null && echo alive || echo gone)
  i=0; while kill -0 "$LWPID" 2>/dev/null && [ $i -lt 600 ]; do sleep 0.2; i=$((i + 1)); done
  LIFE_FINAL=$(kill -0 "$LWPID" 2>/dev/null && echo alive || echo gone); LIFE_DIR="$d"
}
safe_stop_checks() { # <label>: after a safe pause: the id in flight finished, the next one paused, then the batch resumes and audits
  assert_eq "$LIFE_RC" 0 "$1: launcher exits 0 after a safe stop"
  assert_eq "$LIFE_ALIVE_AFTER_LOOP" gone "$1: the wrapper has ended when the launcher exits"
  assert_contains "$(cat "$LIFE_DIR/loop.status")" "stopped_by_operator" "$1: status says stopped_by_operator"
  assert_eq "$(grep -c ' START ' "$LIFE_DIR/invocation.log")" 1 "$1: the running id finished, no further id was started"
  assert_eq "$(grep -c ' END ' "$LIFE_DIR/invocation.log")" 1 "$1: the running id has its END"
  assert_eq "$(grep -c ' PAUSE ' "$LIFE_DIR/invocation.log")" 1 "$1: the next id paused (PROBE_FAIL, PAUSE)"
  assert_contains "$(cat "$LIFE_DIR"/probes/*.json | tr '\n' ' ')" "operator_stop" "$1: the saved response names operator_stop"
  KEEP_STATE=1 loop_run "$LIFE_DIR" "$TEST_TMP/cred-fresh.json"; assert_eq "$?" 0 "$1: the paused batch resumes and completes"
  assert_file_absent "$LIFE_DIR/stop.request"
  node "$WRAP" --audit --manifest "$MAN" --run-dir "$LIFE_DIR" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/life-audit.out" 2>&1; assert_eq "$?" 0 "$1: resumed batch audits OK ($(head -c 150 "$TEST_TMP/life-audit.out"))"
}
life term "$LOOP" "$MAN" "$WRAP" TERM; safe_stop_checks "TERM once"
life intr "$LOOP" "$MAN" "$WRAP" INT; safe_stop_checks "INT once"
life twice "$LOOP" "$MAN" "$WRAP" TERM TERM
assert_eq "$LIFE_RC" 143 "TERM twice: the launcher exits 143"
assert_contains "$(cat "$LIFE_DIR/loop.status")" "aborted" "TERM twice: status says aborted (the batch cannot be audited)"
assert_eq "$LIFE_ALIVE_AFTER_LOOP" gone "TERM twice: the wrapper was killed at once"
assert_eq "$(grep -c ' WRAPPER_EXIT ' "$LIFE_DIR/invocation.log")" 0 "TERM twice: the log has no footer"
# TERM straight to the wrapper is the same safe pause
RT="$TEST_TMP/run-directterm"; rm -rf "$FAKE_STATE_DIR" "$RT"; mkdir -p "$FAKE_STATE_DIR"
env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_PROBE_SLEEP=3 \
  node "$WRAP" --run --manifest "$MAN" --run-dir "$RT" --clone "$CLONE" >"$RT.out" 2>&1 </dev/null &
WP=$!; sleep 1; kill -TERM "$WP"; wait "$WP"; assert_eq "$?" 7 "TERM straight to the wrapper: safe pause, exit 7"
assert_eq "$(grep -c ' START ' "$RT/invocation.log")" 1 "TERM to the wrapper: the running id finished"
assert_contains "$(cat "$RT"/probes/*.json | tr '\n' ' ')" "operator_stop" "TERM to the wrapper: operator_stop"
RUN_ARGS="--first 2" KEEP_STATE=1 run_batch "$WRAP" "$MAN" "$RT"; assert_eq "$?" 0 "TERM to the wrapper: the batch resumes"
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RT" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rt-audit.out" 2>&1; assert_eq "$?" 0 "TERM to the wrapper then resumed: audit OK ($(head -c 150 "$TEST_TMP/rt-audit.out"))"
# RED: a wrapper that ignores the stop request carries on with every id
RTM="$TEST_TMP/run-directterm-mut"; rm -rf "$FAKE_STATE_DIR" "$RTM"; mkdir -p "$FAKE_STATE_DIR"
env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_PROBE_SLEEP=1 \
  node "$TEST_TMP/mut-nostop/run-p2-batch.js" --run --manifest "$MAN_NOSTOP" --run-dir "$RTM" --clone "$CLONE" >"$RTM.out" 2>&1 </dev/null &
WP=$!; sleep 1; kill -TERM "$WP"; wait "$WP"; assert_eq "$(grep -c ' START ' "$RTM/invocation.log")" 6 "RED: a wrapper without the stop check starts all six ids after TERM"
# RED: a launcher that hard-kills on the first signal leaves a log without a footer
mkdir -p "$TEST_TMP/mut-loophard"; cp "$LOOP" "$TEST_TMP/mut-loophard/l.js"; mutate "$TEST_TMP/mut-loophard/l.js" "if (signals === 1) {" "if (signals === 0) {" || fail "loophard mutant"
life hard "$TEST_TMP/mut-loophard/l.js" "$MAN" "$WRAP" TERM
assert_eq "$(grep -c ' PAUSE ' "$LIFE_DIR/invocation.log")" 0 "RED: a launcher that kills on the first signal leaves no PAUSE (an unauditable log)"
# SIGKILL of the launcher: the running id finishes, the next one pauses (parent_gone)
life kill "$LOOP" "$MAN" "$WRAP" KILL
assert_eq "$LIFE_FINAL" gone "SIGKILL to the launcher: the orphaned wrapper ends by itself"
assert_eq "$(grep -c ' START ' "$LIFE_DIR/invocation.log")" 1 "SIGKILL to the launcher: the running id finished and no further id was started"
assert_contains "$(cat "$LIFE_DIR"/probes/*.json | tr '\n' ' ')" "parent_gone" "SIGKILL to the launcher: the next id paused with reason parent_gone"
assert_eq "$(grep -c ' PAUSE ' "$LIFE_DIR/invocation.log")" 1 "SIGKILL to the launcher: the pause is an ordinary PROBE_FAIL / PAUSE"
life killmut "$LOOP" "$MAN_NOPAR" "$TEST_TMP/mut-nopar/run-p2-batch.js" KILL
assert_eq "$([ "$(grep -c ' START ' "$LIFE_DIR/invocation.log")" -gt 1 ] && echo y)" y "RED: a wrapper without the parent check keeps starting ids after the launcher was killed"
# HUP is a safe pause like TERM and INT
life hup "$LOOP" "$MAN" "$WRAP" HUP; safe_stop_checks "HUP once"
# a kill -9 of the wrapper itself (or a reboot) tears the log: the batch cannot be audited and says so
RK="$TEST_TMP/run-kill9wrapper"; rm -rf "$FAKE_STATE_DIR" "$RK"; mkdir -p "$FAKE_STATE_DIR"
env PATH="$BIN:$PATH" HOME="$FHOME" FAKE_STATE="$FAKE_STATE_DIR" FAKE_FIXTURES="$TASKDIR/gate/fixtures" FAKE_COST=0.1 ORCH_TIMEOUT=1m FAKE_PROBE_SLEEP=3 \
  node "$WRAP" --run --manifest "$MAN" --run-dir "$RK" --clone "$CLONE" >"$RK.out" 2>&1 </dev/null &
WP=$!; sleep 1; kill -KILL "$WP"; wait "$WP" 2>/dev/null
node "$WRAP" --audit --manifest "$MAN" --run-dir "$RK" --clone "$CLONE" --wrapper-file "$WRAP" >"$TEST_TMP/rk-audit.out" 2>&1; assert_neq "$?" 0 "kill -9 of the wrapper: the torn log fails the audit"
# several pauses of different kinds in one batch: every id runs exactly once, in order, and the batch audits
RM="$TEST_TMP/run-multipause"; cp "$TEST_TMP/cred-soon.json" "$TEST_TMP/cred-mp.json"; rm -rf "$FAKE_STATE_DIR"; mkdir -p "$FAKE_STATE_DIR"
( sleep 2; mkcred "$TEST_TMP/cred-mp.json" 120 ) &
KEEP_STATE=1 loop_run "$RM" "$TEST_TMP/cred-mp.json"; assert_eq "$?" 0 "multi-pause batch: the launcher pauses on the expiring source, resumes, and completes"
wait
RUN_ARGS="--credentials-source $TEST_TMP/cred-fresh.json --first 4 --last 4" KEEP_STATE=1 run_batch "$WRAP" "$MAN" "$TEST_TMP/run-multipause-b" >/dev/null 2>&1
assert_eq "$(grep ' START ' "$RM/invocation.log" | awk '{print $3}' | sort | uniq -d | wc -l | tr -d ' ')" 0 "multi-pause batch: no id was started twice"
assert_eq "$(grep -c ' START ' "$RM/invocation.log")" 6 "multi-pause batch: every id was started"
assert_eq "$(grep ' ORDER ' "$RM/invocation.log" | awk '{print $3}' | tr '\n' ' ')" "$(echo "$O1" | awk '{print $2}' | tr '\n' ' ')" "multi-pause batch: ids ran in the seeded order"
# RED: a launcher that resumes one position too late skips the paused id (after an operator stop at id 2)
mkdir -p "$TEST_TMP/mut-loopskip"; cp "$LOOP" "$TEST_TMP/mut-loopskip/l.js"; mutate "$TEST_TMP/mut-loopskip/l.js" "if (next > 1) args.push('--first', String(next));" "if (next > 1) args.push('--first', String(next + 1));" || fail "loopskip mutant"
life skip "$LOOP" "$MAN" "$WRAP" TERM
LOOP="$TEST_TMP/mut-loopskip/l.js" KEEP_STATE=1 loop_run "$LIFE_DIR" "$TEST_TMP/cred-fresh.json"; assert_neq "$?" 0 "RED: a launcher that resumes at the wrong position does not complete the batch"
finalize_test
