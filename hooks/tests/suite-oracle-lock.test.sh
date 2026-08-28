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

# hetero review "sol" (2026-08-28, 5 🟠 all ACCEPTED, depth-0 rulings) — cases
# 8-15 below cover the 5 findings: publication race (#1), fd inheritance
# leaving an orphan-held lock (#2), fail-OPEN -> fail-CLOSED on infra errors
# (#3), post-flock identity revalidation (#4), sidecar write safety (#5).

# hold_lock_and_publish_late <lock> <owner> <run_id> <delay-before-publish> —
# like hold_lock_in_process, but ALSO publishes the owner sidecar itself
# (mirroring suite_oracle_lock_acquire's own publish step) after an
# artificial delay, so a contender's acquire attempt lands in the real
# publication-race window finding #1 describes. Sets global _HOLD_LOCK_PID.
hold_lock_and_publish_late() {
  local lock="$1" owner="$2" run_id="$3" delay="$4"
  bash -c '
    exec {fd}>>"$1"
    flock -x "$fd" || exit 1
    sleep "$4"
    printf "run_id=%s\npid=%s\nacquired_at=%s\n" "$3" "$$" "$(date +%s)" \
      > "$2.$$.tmp" && mv -f "$2.$$.tmp" "$2"
    sleep 30
  ' _ "$lock" "$owner" "$run_id" "$delay" &
  _HOLD_LOCK_PID=$!
}

# ── Case 8: publication race, CAUGHT by the bounded retry — a holder that ──
# ── publishes shortly after flock (well inside the 3x100ms retry budget) ──
# ── is still correctly named, not misreported as "unknown"/unpublished ──
CASE8_TMP="$(new_case_tmpdir 8)"
CASE8_LOCK="$CASE8_TMP/.autopilot-suite-oracle.lock"
CASE8_OWNER="$CASE8_TMP/.autopilot-suite-oracle.owner"
: > "$CASE8_LOCK"
hold_lock_and_publish_late "$CASE8_LOCK" "$CASE8_OWNER" "case8-late-holder" "0.05"
CASE8_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE8_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case8: setup — lock never observed held"
(
  export TMPDIR="$CASE8_TMP"
  export AUTOPILOT_SUITE_ORACLE_RUN_ID="case8-waiter"
  suite_oracle_lock_acquire
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE8_TMP/.msg"
)
kill_lock_holder "$CASE8_HOLDER"
assert_contains "$(cat "$CASE8_TMP/.msg")" "case8-late-holder" \
  "case8: bounded retry catches a holder that publishes within the retry budget"
assert_not_contains "$(cat "$CASE8_TMP/.msg")" "not yet published" \
  "case8: a caught late-but-in-budget publish is not reported as unpublished"

# ── Case 9: publication race, NOT caught — a holder that publishes well ──
# ── outside the retry budget gets the honest "not yet published" fallback, ──
# ── and the contender still returns promptly (never blocks) ──
CASE9_TMP="$(new_case_tmpdir 9)"
CASE9_LOCK="$CASE9_TMP/.autopilot-suite-oracle.lock"
CASE9_OWNER="$CASE9_TMP/.autopilot-suite-oracle.owner"
: > "$CASE9_LOCK"
hold_lock_and_publish_late "$CASE9_LOCK" "$CASE9_OWNER" "case9-never-seen" "3"
CASE9_HOLDER="$_HOLD_LOCK_PID"
poll_until 5 bash -c "flock -n '$CASE9_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case9: setup — lock never observed held"
CASE9_START="$(date +%s)"
(
  export TMPDIR="$CASE9_TMP"
  export AUTOPILOT_SUITE_ORACLE_RUN_ID="case9-waiter"
  suite_oracle_lock_acquire
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE9_TMP/.msg"
)
CASE9_ELAPSED=$(( $(date +%s) - CASE9_START ))
kill_lock_holder "$CASE9_HOLDER"
assert_contains "$(cat "$CASE9_TMP/.msg")" "not yet published" \
  "case9: a publish well outside the retry budget gets the honest unpublished fallback"
assert_not_contains "$(cat "$CASE9_TMP/.msg")" "case9-never-seen" \
  "case9: the not-yet-visible run_id is never guessed/fabricated"
if [ "$CASE9_ELAPSED" -ge 2 ]; then
  fail "case9: acquire took ${CASE9_ELAPSED}s waiting on the sidecar — retry must be bounded, never block"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

# ── Case 10: fd inheritance — SIGKILL to the suite process itself (bypassing ──
# ── its own EXIT trap entirely) must NOT leave the lock held by a still- ──
# ── running worker that merely inherited a copy of the fd at fork time ──
CASE10_TMP="$(new_case_tmpdir 10)"
TMPDIR="$CASE10_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 1 dispatch-author-codex-transport \
  >/dev/null 2>&1 &
CASE10_SUITE_PID=$!
poll_until 30 bash -c "flock -n '$CASE10_TMP/.autopilot-suite-oracle.lock' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case10: setup — suite never observed holding the oracle lock"
# Wait for the L2 worker's actual test-file process (an UNAMBIGUOUS grep
# target — it only exists once run.sh's --parallel phase truly starts) to
# appear, then derive its PARENT — the `start_one` wrapper subshell that
# forked it — as the fd-holder under test. A bare `pgrep -P $CASE10_SUITE_PID`
# is NOT safe here: L1 (`node --test`) runs BEFORE any L2 worker and is
# executed as a foreground pipeline stage, so it briefly shows up as a
# direct child of run.sh's own PID too — sampled at the wrong moment, a
# plain `pgrep -P` finds L1's `node` process instead of the L2 worker, which
# then exits on its own seconds later, reading as "worker died" for reasons
# that have nothing to do with this test.
CASE10_WORKER=""
CASE10_WSTART="$(date +%s)"
while :; do
  CASE10_GRANDCHILD="$(pgrep -f 'dispatch-author-codex-transport\.test\.sh' 2>/dev/null | head -1)"
  if [ -n "$CASE10_GRANDCHILD" ]; then
    # CASE10_WORKER is the grandchild's PARENT — the `start_one` wrapper
    # subshell — which is itself a DIRECT child of the suite PID (the
    # wrapper does not equal the suite PID; the wrapper's PARENT does).
    CASE10_WORKER="$(ps -o ppid= -p "$CASE10_GRANDCHILD" 2>/dev/null | tr -d ' ')"
    if [ -n "$CASE10_WORKER" ]; then
      CASE10_WORKER_PPID="$(ps -o ppid= -p "$CASE10_WORKER" 2>/dev/null | tr -d ' ')"
      [ "$CASE10_WORKER_PPID" = "$CASE10_SUITE_PID" ] && break
    fi
    CASE10_WORKER=""
  fi
  [ $(( $(date +%s) - CASE10_WSTART )) -ge 90 ] && break
  sleep 0.2
done
if [ -z "$CASE10_WORKER" ]; then
  fail "case10: setup — no worker subshell observed under the suite PID"
fi
kill -9 "$CASE10_SUITE_PID" 2>/dev/null || true
wait "$CASE10_SUITE_PID" 2>/dev/null || true
# The worker (and dispatch-author-codex-transport.test.sh's own ~56s runtime underneath it)
# is now an ORPHAN, still genuinely running — kill -9 on the suite's own PID
# never touches already-forked children. This is exactly the scenario: is
# the lock STILL held by that orphan's inherited fd, or did closing it at
# launch (the fix) let it go free the instant the suite itself died?
if [ -n "$CASE10_WORKER" ] && kill -0 "$CASE10_WORKER" 2>/dev/null; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))  # "case10: setup — orphaned worker still alive after suite kill"
else
  fail "case10: setup — orphaned worker did not survive the suite kill; test proves nothing"
fi
CASE10_FREE_RC=1
poll_until 5 bash -c "flock -n '$CASE10_TMP/.autopilot-suite-oracle.lock' -c true 2>/dev/null" \
  && CASE10_FREE_RC=0
assert_eq "$CASE10_FREE_RC" "0" \
  "case10: lock frees promptly even though the orphaned worker (with the fix's fd close) is still alive"
# Cleanup: the orphaned dispatch-author-codex-transport.test.sh subtree would otherwise run to
# completion (~56s) unattended; kill its whole subtree so it doesn't outlive
# this test file's own process.
pkill -9 -P "$CASE10_WORKER" 2>/dev/null || true
kill -9 "$CASE10_WORKER" 2>/dev/null || true

# ── Case 11: fail-CLOSED (not fail-open) on an infra error — _wt_open_lock_fd ──
# ── unavailable must REFUSE the run (rc 2), not run unguarded (depth-0 ──
# ── ruling: fail-open on infra errors defeats the lock whenever the ──
# ── filesystem is even slightly hostile) ──
CASE11_TMP="$(new_case_tmpdir 11)"
(
  # Simulate "worktree-reap.sh not sourced" without actually un-sourcing it
  # for the rest of this test file: shadow the function in a subshell only.
  unset -f _wt_open_lock_fd
  export TMPDIR="$CASE11_TMP"
  suite_oracle_lock_acquire
  echo "$?" > "$CASE11_TMP/.rc"
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE11_TMP/.msg"
)
assert_eq "$(cat "$CASE11_TMP/.rc")" "2" \
  "case11: an infra error (helper unavailable) returns 2 (REFUSED-INFRA), distinct from 1 (contention)"
assert_contains "$(cat "$CASE11_TMP/.msg")" "AUTOPILOT_SUITE_ORACLE_LOCK=0" \
  "case11: the infra-error refusal names the explicit bypass"
assert_not_contains "$(cat "$CASE11_TMP/.msg")" "running unguarded" \
  "case11: planted-negative phrasing check — infra errors no longer claim to run unguarded"

# ── Case 12: post-flock identity revalidation (finding #4) — a fd whose ──
# ── target no longer matches the lock path AFTER flock succeeded must fail ──
# ── closed, and must not leave the stale fd's flock dangling ──
CASE12_TMP="$(new_case_tmpdir 12)"
CASE12_LOCK="$CASE12_TMP/.autopilot-suite-oracle.lock"
: > "$CASE12_LOCK"
(
  # _wt_open_lock_fd's OWN pre-flock check already proves identity before
  # the flock() call (see its header) — the real TOCTOU window finding #4
  # closes is the flock() call itself, which is a kernel syscall this test
  # cannot reliably interleave a filesystem swap into. Stub the POST-flock
  # check only (leave _wt_open_lock_fd and flock itself completely real) to
  # exercise the exact fail-closed branch it guards, in a subshell so the
  # stub never leaks to any other case in this file.
  _sol_fd_identity_matches() { return 1; }
  export TMPDIR="$CASE12_TMP"
  suite_oracle_lock_acquire
  echo "$?" > "$CASE12_TMP/.rc"
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE12_TMP/.msg"
)
assert_eq "$(cat "$CASE12_TMP/.rc")" "2" \
  "case12: a post-flock identity mismatch fails CLOSED (rc 2), not acquired"
assert_contains "$(cat "$CASE12_TMP/.msg")" "identity unstable" \
  "case12: the mismatch refusal names the actual cause, not a generic message"
CASE12_FREE_RC=1
flock -n "$CASE12_LOCK" -c true 2>/dev/null && CASE12_FREE_RC=0
assert_eq "$CASE12_FREE_RC" "0" \
  "case12: the mismatched fd's flock does not dangle — lock is free after the refusal"

# ── Case 13: sidecar write safety (finding #5) — a pre-existing SYMLINK at ──
# ── the owner path must be refused, never followed/overwritten, and the ──
# ── flock must be released (not leaked) on that refusal ──
CASE13_TMP="$(new_case_tmpdir 13)"
CASE13_LOCK="$CASE13_TMP/.autopilot-suite-oracle.lock"
CASE13_OWNER="$CASE13_TMP/.autopilot-suite-oracle.owner"
: > "$CASE13_LOCK"
CASE13_EVIL_TARGET="$CASE13_TMP/evil-target"
: > "$CASE13_EVIL_TARGET"
ln -s "$CASE13_EVIL_TARGET" "$CASE13_OWNER"
(
  export TMPDIR="$CASE13_TMP"
  suite_oracle_lock_acquire
  echo "$?" > "$CASE13_TMP/.rc"
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" > "$CASE13_TMP/.msg"
)
assert_eq "$(cat "$CASE13_TMP/.rc")" "2" \
  "case13: a symlinked owner-sidecar target is refused (rc 2), not overwritten"
assert_eq "$(readlink "$CASE13_OWNER")" "$CASE13_EVIL_TARGET" \
  "case13: the symlink itself is left untouched (never followed or clobbered)"
assert_eq "$(cat "$CASE13_EVIL_TARGET" 2>/dev/null)" "" \
  "case13: the symlink's target file is never written through"
CASE13_FREE_RC=1
flock -n "$CASE13_LOCK" -c true 2>/dev/null && CASE13_FREE_RC=0
assert_eq "$CASE13_FREE_RC" "0" \
  "case13: the flock is released (not leaked) after the sidecar-safety refusal"

finalize_test
