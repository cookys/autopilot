#!/usr/bin/env bash
# suite-oracle-lock.test.sh — proving test for
# hooks/tests/lib/suite-oracle-lock.sh and its wiring into
# hooks/tests/run.sh --parallel.
#
# docs/BACKLOG.md "Depth-0's exclusive ownership of the execution oracle is
# prose, not a lock": a second concurrent "full parallel suite" run must
# refuse fast, naming the holder's run identity, instead of silently
# interleaving and corrupting shared /tmp state.
#
# Unit cases (1-4) drive the lock functions directly under an isolated
# TMPDIR. Integration cases (5-7) prove the gate actually fires inside the
# real hooks/tests/run.sh subprocess path — "a script existing is not
# evidence it is running" (references/evidence-discipline.md).
. "$(dirname "$0")/lib.sh"

# shellcheck source=../../scripts/lib/worktree-reap.sh
. "$REPO_ROOT/scripts/lib/worktree-reap.sh"
# shellcheck source=lib/suite-oracle-lock.sh
. "$REPO_ROOT/hooks/tests/lib/suite-oracle-lock.sh"

new_case_tmpdir() {
  local d
  d="$TEST_TMP/case-$1"
  mkdir -p "$d"
  printf '%s' "$d"
}

# hold_lock_in_process <lock-path> — flock's the lock INSIDE this single
# background bash process (exec'd fd + flock builtin, no forked `sleep`
# child), so a plain SIGKILL on its PID (no process-group tricks) releases
# the flock immediately and deterministically. `flock <path> sleep 30 &`
# would instead leave the lock held by the forked sleep child even after the
# parent flock binary is killed, since the child inherits the locked fd.
#
# Sets global _HOLD_LOCK_PID — NOT `echo $! from a $(...) command
# substitution: bash reaps/kills an async job started inside a command-
# substitution subshell as soon as that subshell exits, so a caller doing
# `PID="$(hold_lock_in_process ...)"` would capture a PID that is already
# dead by the time the assignment completes (reproduced empirically while
# writing this test). Calling this function directly (no substitution)
# keeps the background job in the CALLER's own shell, which does survive.
_HOLD_LOCK_PID=""
hold_lock_in_process() {
  local lock="$1"
  bash -c '
    exec {fd}>>"$1"
    flock -x "$fd" || exit 1
    sleep 30
  ' _ "$lock" &
  _HOLD_LOCK_PID=$!
}

# kill_lock_holder <pid> — the `bash -c '... ; sleep 30'` job above does NOT
# get exec-optimized into a single process: bash forks `sleep 30` as a real
# child of the `bash -c` process, which inherits its own copy of the locked
# fd via fork(). `kill -9 <pid>` on the outer PID alone therefore leaves the
# lock held by that still-living `sleep` grandchild (reproduced empirically
# while writing this test — `flock -n` kept reporting held, and `fuser`
# showed a second PID on the lock file after the "parent" kill). Kill the
# child first, THEN the outer PID, so no fd referencing the lock survives.
kill_lock_holder() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill -9 "$child" 2>/dev/null || true
  done
  kill -9 "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

# ── Case 1: acquire succeeds when the lock is free, publishes owner info ──
CASE1_TMP="$(new_case_tmpdir 1)"
(
  export TMPDIR="$CASE1_TMP"
  export AUTOPILOT_SUITE_ORACLE_RUN_ID="case1-run"
  suite_oracle_lock_acquire
  echo "$?" > "$CASE1_TMP/.rc"
  suite_oracle_lock_release
)
assert_eq "$(cat "$CASE1_TMP/.rc")" "0" "case1: acquire on a free lock returns 0"
assert_file_exists "$CASE1_TMP/.autopilot-suite-oracle.owner" \
  "case1: acquire publishes an owner file"
assert_contains "$(cat "$CASE1_TMP/.autopilot-suite-oracle.owner")" "run_id=case1-run" \
  "case1: owner file carries the acquiring run's id"

# ── Case 2: second acquire while the first holds the lock is REFUSED, ──
# ── and the refusal names the holder's run id (not a command name) ──
CASE2_TMP="$(new_case_tmpdir 2)"
CASE2_LOCK="$CASE2_TMP/.autopilot-suite-oracle.lock"
: > "$CASE2_LOCK"
cat > "$CASE2_TMP/.autopilot-suite-oracle.owner" <<'OWNER'
run_id=holder-run-xyz
pid=999999
acquired_at=1000000000
OWNER
hold_lock_in_process "$CASE2_LOCK"
CASE2_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE2_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case2: setup — lock never observed held"
(
  export TMPDIR="$CASE2_TMP"
  export AUTOPILOT_SUITE_ORACLE_RUN_ID="case2-waiter"
  suite_oracle_lock_acquire
  echo "$?" > "$CASE2_TMP/.rc"
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE2_TMP/.msg"
)
kill_lock_holder "$CASE2_HOLDER"
assert_eq "$(cat "$CASE2_TMP/.rc")" "1" "case2: acquire while held returns 1 (refused)"
assert_contains "$(cat "$CASE2_TMP/.msg")" "holder-run-xyz" \
  "case2: refusal message names the holder's run id"
assert_not_contains "$(cat "$CASE2_TMP/.msg")" "run.sh" \
  "case2: refusal message does not identify the holder by command/script name"

# ── Case 3: AUTOPILOT_SUITE_ORACLE_LOCK=0 admits despite a held lock ──
CASE3_TMP="$(new_case_tmpdir 3)"
CASE3_LOCK="$CASE3_TMP/.autopilot-suite-oracle.lock"
: > "$CASE3_LOCK"
hold_lock_in_process "$CASE3_LOCK"
CASE3_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE3_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case3: setup — lock never observed held"
(
  export TMPDIR="$CASE3_TMP"
  AUTOPILOT_SUITE_ORACLE_LOCK=0 suite_oracle_lock_acquire
  echo "$?" > "$CASE3_TMP/.rc"
)
kill_lock_holder "$CASE3_HOLDER"
assert_eq "$(cat "$CASE3_TMP/.rc")" "0" \
  "case3: AUTOPILOT_SUITE_ORACLE_LOCK=0 admits even though the lock is held"

# ── Case 4: stale lock (holder killed) does not block forever — a fresh ──
# ── acquire after the holder dies succeeds immediately, no waiting ──
CASE4_TMP="$(new_case_tmpdir 4)"
CASE4_LOCK="$CASE4_TMP/.autopilot-suite-oracle.lock"
: > "$CASE4_LOCK"
hold_lock_in_process "$CASE4_LOCK"
CASE4_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE4_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case4: setup — lock never observed held"
kill_lock_holder "$CASE4_HOLDER"
poll_until 5 bash -c "flock -n '$CASE4_LOCK' -c true 2>/dev/null; [ \$? -eq 0 ]" \
  || fail "case4: setup — lock never observed free after kill -9"
# The kernel releases a held flock the instant the holder's fd closes
# (process death included) — no artificial age threshold is needed to make
# this lock available again; the poll_until above only absorbs OS scheduling
# jitter around the SIGKILL, not any staleness window this lock imposes.
(
  export TMPDIR="$CASE4_TMP"
  export AUTOPILOT_SUITE_ORACLE_RUN_ID="case4-run"
  suite_oracle_lock_acquire
  exit "$?"
)
assert_eq "$?" "0" \
  "case4: a dead holder's lock is acquirable immediately, does not block forever"

# ── Case 5: integration — a second concurrent `run.sh --parallel` refuses, ──
# ── naming the holder's run id, and exits fast without running any tests ──
CASE5_TMP="$(new_case_tmpdir 5)"
CASE5_LOCK="$CASE5_TMP/.autopilot-suite-oracle.lock"
: > "$CASE5_LOCK"
cat > "$CASE5_TMP/.autopilot-suite-oracle.owner" <<'OWNER'
run_id=depth0-holder-run
pid=123456
acquired_at=1000000000
OWNER
hold_lock_in_process "$CASE5_LOCK"
CASE5_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE5_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case5: setup — lock never observed held"
CASE5_START="$(date +%s)"
CASE5_STDOUT="$(TMPDIR="$CASE5_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 2 sync-version-invalid-version 2>&1)"
CASE5_RC=$?
CASE5_ELAPSED=$(( $(date +%s) - CASE5_START ))
kill_lock_holder "$CASE5_HOLDER"
assert_neq "$CASE5_RC" "0" "case5: refused concurrent run.sh --parallel exits non-zero"
assert_contains "$CASE5_STDOUT" "depth0-holder-run" \
  "case5: run.sh's refusal output names the holder's run id"
assert_not_contains "$CASE5_STDOUT" "════════ L2 integration tests" \
  "case5: refused run never reaches the test-execution phase"
if [ "$CASE5_ELAPSED" -ge 10 ]; then
  fail "case5: refusal took ${CASE5_ELAPSED}s — expected a fast fail, not a wait"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ── Case 6: planted negative — a filtered run.sh WITHOUT --parallel is not ──
# ── gated by the oracle lock at all (scoped to the "full parallel suite" ──
# ── action, per the backlog entry's fix shape) ──
CASE6_TMP="$(new_case_tmpdir 6)"
CASE6_LOCK="$CASE6_TMP/.autopilot-suite-oracle.lock"
: > "$CASE6_LOCK"
hold_lock_in_process "$CASE6_LOCK"
CASE6_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE6_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case6: setup — lock never observed held"
TMPDIR="$CASE6_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" sync-version-invalid-version >/dev/null 2>&1
CASE6_RC=$?
kill_lock_holder "$CASE6_HOLDER"
assert_eq "$CASE6_RC" "0" \
  "case6: a serial (non --parallel) run.sh is unaffected by a held oracle lock"

# ── Case 7: lock released on normal exit — a held oracle lock does not ──
# ── survive a run.sh --parallel process that exits cleanly ──
CASE7_TMP="$(new_case_tmpdir 7)"
AUTOPILOT_SUITE_ORACLE_RUN_ID="case7-run" TMPDIR="$CASE7_TMP" \
  bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 2 sync-version-invalid-version >/dev/null 2>&1
CASE7_RC=$?
assert_eq "$CASE7_RC" "0" "case7: setup — first run.sh --parallel completed cleanly"
CASE7_PROBE_RC=0
flock -n "$CASE7_TMP/.autopilot-suite-oracle.lock" true 2>/dev/null || CASE7_PROBE_RC=$?
assert_eq "$CASE7_PROBE_RC" "0" \
  "case7: oracle lock is free (flock -n succeeds) after run.sh exits normally"

finalize_test
