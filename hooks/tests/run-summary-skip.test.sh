#!/usr/bin/env bash
# run-summary-skip.test.sh — hooks/tests/run.sh's Summary must surface `SKIP [suite]` lines.
#
# A suite that runs but asserts nothing (mission-terminal-rollover in a registry-less clone)
# prints `SKIP [suite] VACUOUS RUN ...` and exits 0. The line sits mid-output; the Summary used
# to print only "ALL TESTS PASSED", so the vacuous run was invisible there. The runner is
# exercised from a scratch tree (its REPO_ROOT derives from its own path) holding fake suites.
# Cases: serial pool, parallel pool, serial tail, stderr-only SKIP, a suite that leaves a
# background process behind (collection must not stall run.sh), and a no-SKIP negative control.
. "$(dirname "$0")/lib.sh"

RUN_SRC="$REPO_ROOT/hooks/tests/run.sh"
SCR="$TEST_TMP/scratch"
mkdir -p "$SCR/hooks/tests"
cp "$RUN_SRC" "$SCR/hooks/tests/run.sh"
cp -r "$REPO_ROOT/hooks/tests/lib" "$SCR/hooks/tests/lib"
mkdir -p "$SCR/scripts"
cp -r "$REPO_ROOT/scripts/lib" "$SCR/scripts/lib"
git init -q "$SCR"
git -C "$SCR" -c user.email=t@example.invalid -c user.name=t commit -q --allow-empty -m init
chmod +x "$SCR/hooks/tests/run.sh"

# mk_suite <name> <body>: write an executable fake suite into the scratch tree.
mk_suite() {
  printf '#!/usr/bin/env bash\n%s\n' "$2" >"$SCR/hooks/tests/$1"
  chmod +x "$SCR/hooks/tests/$1"
}
rm_suites() { rm -f "$SCR"/hooks/tests/*.test.sh; }

# run_mode <filter> [run.sh flags...]: sets OUT (stdout+stderr), RC, SUMMARY.
run_mode() {
  local filter="$1"; shift
  OUT="$(cd "$SCR" && AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/dur.tsv" bash hooks/tests/run.sh "$@" "$filter" 2>&1)"
  RC=$?
  SUMMARY="$(printf '%s\n' "$OUT" | sed -n '/Summary/,$p')"
}

VAC='printf "SKIP [fake] VACUOUS RUN - no assertion executed: nothing to act on\n"; exit 0'

# Cases 1-2: serial and parallel pools.
mk_suite fake-vacuous.test.sh "$VAC"
run_mode fake-
assert_eq "$RC" "0" "serial: run.sh exits 0 (a vacuous suite is still exit 0)"
assert_contains "$SUMMARY" "fake-vacuous.test.sh: SKIP [fake]" "serial: Summary names the SKIPped suite"
run_mode fake- --parallel 1
assert_eq "$RC" "0" "parallel: run.sh exits 0"
assert_contains "$SUMMARY" "fake-vacuous.test.sh: SKIP [fake]" "parallel: Summary names the SKIPped suite"

# Case 3: stderr-only SKIP. Serial and parallel both capture stdout+stderr.
mk_suite fake-vacuous.test.sh 'printf "SKIP [fake-err] VACUOUS RUN\n" >&2; exit 0'
run_mode fake-
assert_contains "$SUMMARY" "SKIP [fake-err]" "serial: a SKIP printed on stderr is collected"

# Case 4: the serial tail (serial-only files named in run.sh's case list, run after the pool).
rm_suites
mk_suite sync-all.test.sh "$VAC"
run_mode sync-all --parallel 1
assert_eq "$RC" "0" "tail: run.sh exits 0"
assert_contains "$SUMMARY" "sync-all.test.sh: SKIP [fake]" "tail: Summary names a SKIP from the serial tail"

mk_suite sync-all.test.sh 'printf "SKIP [fake-tail-err] VACUOUS RUN\n" >&2; exit 0'
run_mode sync-all --parallel 1
assert_contains "$SUMMARY" "SKIP [fake-tail-err]" "tail: a SKIP printed on stderr is collected"

# Case 6: an interrupted run (TERM: a background job cannot trap INT, it is ignored on entry) leaves no hooks-run-skipcap.* temp file behind. bash runs a trap only
# after the foreground suite ends, so the suite is short (sleep 3) and the signal arrives mid-suite.
rm_suites
mk_suite fake-slow.test.sh 'sleep 3; exit 0'
ITMP="$TEST_TMP/itmp"
mkdir -p "$ITMP"
(cd "$SCR" && TMPDIR="$ITMP" AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/dur.tsv" exec bash hooks/tests/run.sh fake-slow >/dev/null 2>&1) &
RPID=$!
for _ in $(seq 1 100); do
  compgen -G "$ITMP/hooks-run-skipcap.*" >/dev/null && break
  sleep 0.1
done
SEEN="$(compgen -G "$ITMP/hooks-run-skipcap.*" | wc -l | tr -d ' ')"
kill -TERM "$RPID" 2>/dev/null
wait "$RPID" 2>/dev/null
LEFT="$(compgen -G "$ITMP/hooks-run-skipcap.*" | wc -l | tr -d ' ')"
assert_eq "$SEEN" "1" "interrupt: the capture file existed while the suite ran"
assert_eq "$LEFT" "0" "interrupt: TERM leaves no hooks-run-skipcap.* behind"

# Case 5: a suite that leaves a background process behind must not stall run.sh. A pipe-based
# collector (| tee) waits for the leftover's write end to close: measured 21s against 7s.
rm_suites
PIDF="$TEST_TMP/leftover.pid"
mk_suite fake-linger.test.sh "sleep 25 & echo \$! >'$PIDF'; echo PASS: done; exit 0"
T0=$SECONDS
run_mode fake-
ELAPSED=$((SECONDS - T0))
[ -s "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null
assert_eq "$RC" "0" "linger: run.sh exits 0"
[ "$ELAPSED" -lt 15 ]
assert_eq "$?" "0" "linger: a leftover background process does not stall run.sh (took ${ELAPSED}s)"

# Negative control: no SKIP line => no warning block.
rm_suites
mk_suite fake-vacuous.test.sh 'echo "PASS: real assertion"; exit 0'
run_mode fake-
assert_not_contains "$SUMMARY" "reported a SKIP" "control: a suite with no SKIP adds no warning"

finalize_test "run-summary-skip"
