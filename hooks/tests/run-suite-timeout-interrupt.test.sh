#!/usr/bin/env bash
# run-suite-timeout-interrupt.test.sh — hooks/tests/run.sh per-suite timeout + interrupt contract.
#
# BL-0088: [TIMEOUT] must mean "the runner's watchdog fired", never "the suite exited 124/137".
#   A suite that exits 124 or 137 on its own is a plain FAILED; a suite that outlives the ceiling
#   is [TIMEOUT]; a green suite is neither.
# BL-0100: a group INT sent to the runner must stop the running suite NOW (not after it finishes)
#   and leave no orphan. Serial and --parallel, checked by PID (never by name).
# The runner is exercised from a scratch tree holding fake suites (as run-summary-skip.test.sh).
# RUN_SH_UNDER_TEST points the same cases at another run.sh (negative control: the pre-fix one).
. "$(dirname "$0")/lib.sh"

RUN_SRC="${RUN_SH_UNDER_TEST:-$REPO_ROOT/hooks/tests/run.sh}"
SCR="$TEST_TMP/scratch"
mkdir -p "$SCR/hooks/tests"
cp "$RUN_SRC" "$SCR/hooks/tests/run.sh"
cp -r "$REPO_ROOT/hooks/tests/lib" "$SCR/hooks/tests/lib"
mkdir -p "$SCR/scripts"
cp -r "$REPO_ROOT/scripts/lib" "$SCR/scripts/lib"
git init -q "$SCR"
git -C "$SCR" -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m init
chmod +x "$SCR/hooks/tests/run.sh"

mk_suite() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$SCR/hooks/tests/$1"
  chmod +x "$SCR/hooks/tests/$1"
}
rm_suites() { rm -f "$SCR"/hooks/tests/*.test.sh; }

# run_mode <timeout-secs> <filter> [run.sh flags...]: sets OUT, RC, SUMMARY.
run_mode() {
  local secs="$1" filter="$2"; shift 2
  OUT="$(cd "$SCR" && AUTOPILOT_TEST_SUITE_TIMEOUT_SECS="$secs" AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/dur.tsv" \
    bash hooks/tests/run.sh "$@" "$filter" 2>&1 </dev/null)"
  RC=$?
  SUMMARY="$(printf '%s\n' "$OUT" | sed -n '/Summary/,$p')"
}

for mode in serial parallel; do
  flags=(); [ "$mode" = parallel ] && flags=(--parallel 1)

  # BL-0088: self-exit 124 / 137 is a plain failure, not a timeout.
  for code in 124 137; do
    rm_suites
    mk_suite fake-self.test.sh "echo FAIL: boom; exit $code"
    run_mode 60 fake- "${flags[@]}"
    assert_eq "$RC" "1" "$mode: a suite exiting $code makes the run fail"
    assert_contains "$SUMMARY" "fake-self.test.sh" "$mode: exit $code suite is listed as failed"
    assert_not_contains "$OUT" "TIMEOUT" "$mode: exit $code on its own is NOT labelled TIMEOUT"
  done

  # A real overrun is still [TIMEOUT].
  rm_suites
  mk_suite fake-hang.test.sh "sleep 30"
  run_mode 2 fake- "${flags[@]}"
  assert_eq "$RC" "1" "$mode: an overrunning suite fails the run"
  assert_contains "$SUMMARY" "fake-hang.test.sh [TIMEOUT]" "$mode: an overrunning suite is labelled [TIMEOUT]"

  # A suite that traps the watchdog's TERM and exits 0 must still be a TIMEOUT failure, never a pass.
  rm_suites
  mk_suite fake-trapterm.test.sh 'trap "exit 0" TERM; sleep 30 & wait'
  run_mode 2 fake- "${flags[@]}"
  assert_neq "$RC" "0" "$mode: a suite that traps TERM and exits 0 after the ceiling does not pass"
  assert_contains "$SUMMARY" "fake-trapterm.test.sh [TIMEOUT]" "$mode: trap-TERM-exit-0 is still labelled [TIMEOUT]"
  assert_not_contains "$OUT" "ALL TESTS PASSED" "$mode: trap-TERM-exit-0 is not reported as passed"

  # Control: a green suite is neither.
  rm_suites
  mk_suite fake-ok.test.sh "echo PASS: ok; exit 0"
  run_mode 60 fake- "${flags[@]}"
  assert_eq "$RC" "0" "$mode: a green suite exits 0"
  assert_not_contains "$OUT" "TIMEOUT" "$mode: a green suite is not labelled TIMEOUT"
done

# BL-0100: group INT stops the running suite promptly, leaves no orphan.
alive() { kill -0 "$1" 2>/dev/null; }
# The -nosnap modes run the runner itself (AUTOPILOT_TEST_SNAPSHOT=0), the case where no outer
# snapshot wrapper does the killing: there the signal reaches run.sh directly (BL-0100).
for mode in serial parallel serial-nosnap parallel-nosnap; do
  flags=(); case "$mode" in parallel*) flags=(--parallel 1);; esac
  SNAP_ENV=1; case "$mode" in *-nosnap) SNAP_ENV=0;; esac
  rm_suites
  PIDF="$TEST_TMP/int-$mode.pids"; rm -f "$PIDF"
  # The suite records its own pid and a child's, then waits; it never finishes on its own.
  mk_suite fake-slow.test.sh "echo \$\$ >'$PIDF'; sleep 40 & echo \$! >>'$PIDF'; wait"
  # Own session so pgid == pid and a group INT reaches the runner like Ctrl-C would; SIGINT is reset
  # because a background launch hands it down as ignored (bash cannot trap an inherited ignore).
  (cd "$SCR" && AUTOPILOT_TEST_SNAPSHOT="$SNAP_ENV" AUTOPILOT_TEST_SUITE_TIMEOUT_SECS=120 AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/dur.tsv" \
    exec python3 -c 'import os, sys
import signal
signal.signal(signal.SIGINT, signal.SIG_DFL)
os.setsid()
os.execvp("bash", ["bash", "hooks/tests/run.sh"] + sys.argv[1:])' "${flags[@]}" fake-slow >"$TEST_TMP/int-$mode.out" 2>&1 </dev/null) &
  RPID=$!
  for _ in $(seq 1 100); do
    [ "$(cat "$PIDF" 2>/dev/null | wc -l)" -ge 2 ] && break
    sleep 0.1
  done
  SPID="$(sed -n 1p "$PIDF" 2>/dev/null)"; CPID="$(sed -n 2p "$PIDF" 2>/dev/null)"
  assert_neq "$SPID" "" "$mode interrupt: the fake suite started"
  T0=$SECONDS
  kill -INT -- "-$RPID" 2>/dev/null
  for _ in $(seq 1 150); do alive "$RPID" || break; sleep 0.1; done
  ELAPSED=$((SECONDS - T0))
  if alive "$RPID"; then
    kill -KILL -- "-$RPID" 2>/dev/null; RUNNER_DONE=no
  else
    RUNNER_DONE=yes
  fi
  wait "$RPID" 2>/dev/null
  # Allow a moment for the group to be reaped before the orphan check.
  for _ in $(seq 1 30); do alive "$SPID" || alive "$CPID" || break; sleep 0.1; done
  SALIVE=no; alive "$SPID" && SALIVE=yes
  CALIVE=no; alive "$CPID" && CALIVE=yes
  [ "$SALIVE" = yes ] && kill -KILL "$SPID" 2>/dev/null
  [ "$CALIVE" = yes ] && kill -KILL "$CPID" 2>/dev/null
  assert_eq "$RUNNER_DONE" "yes" "$mode interrupt: the runner exits after INT instead of waiting out the suite (took ${ELAPSED}s)"
  [ "$ELAPSED" -le 10 ]
  assert_eq "$?" "0" "$mode interrupt: stopped within 10s of INT, not the suite's 40s (took ${ELAPSED}s)"
  assert_eq "$SALIVE" "no" "$mode interrupt: the suite process is gone (no orphan)"
  assert_eq "$CALIVE" "no" "$mode interrupt: the suite's child process is gone (no orphan)"
done

finalize_test "run-suite-timeout-interrupt"
