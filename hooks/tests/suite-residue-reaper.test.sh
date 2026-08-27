#!/usr/bin/env bash
# suite-residue-reaper.test.sh — proving test for hooks/tests/lib/suite-residue-reap.sh
# and its wiring into hooks/tests/run.sh.
#
# Unit cases (1-9) drive suite_residue_reap directly by sourcing the lib under
# an isolated TMPDIR. Integration cases (10-12) prove the reaper actually
# fires inside the real hooks/tests/run.sh subprocess path — "a script
# existing is not evidence it is running" (references/evidence-discipline.md).
. "$(dirname "$0")/lib.sh"

# shellcheck source=../../scripts/lib/worktree-reap.sh
. "$REPO_ROOT/scripts/lib/worktree-reap.sh"
# shellcheck source=../../scripts/lib/prune-tmp-residue.sh
. "$REPO_ROOT/scripts/lib/prune-tmp-residue.sh"
# shellcheck source=lib/suite-residue-reap.sh
. "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"

# Every case gets its own isolated TMPDIR under $TEST_TMP so no case's
# residue can leak into another's assertions, and nothing touches the host's
# real /tmp.
new_case_tmpdir() {
  local d
  d="$TEST_TMP/case-$1"
  mkdir -p "$d"
  printf '%s' "$d"
}

extract_json_field() {
  # extract_json_field <json> <key> — best-effort integer field extraction,
  # mirroring the sed/grep approach used in run.sh (no jq dependency).
  printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | grep -o '[0-9]*$'
}

# ── Case 1: marker + FREE lock ⇒ reaped ──
CASE1_TMP="$(new_case_tmpdir 1)"
mkdir -p "$CASE1_TMP/hetero-a-XXXX"
cat > "$CASE1_TMP/hetero-a-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case1-run
root_run_id=case1-root
loop_id=case1-loop
MARKER
: > "$CASE1_TMP/hetero-a-XXXX/.autopilot-worktree.lock"
(
  export TMPDIR="$CASE1_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE1_TMP/.out"
)
CASE1_OUT="$(cat "$CASE1_TMP/.out")"
assert_file_absent "$CASE1_TMP/hetero-a-XXXX" \
  "case1: marker+free-lock hetero dir is reaped"
assert_eq "$(extract_json_field "$CASE1_OUT" reaped)" "1" \
  "case1: envelope reaped=1"

# ── Case 2: marker + lock HELD by a live background process ⇒ survives ──
CASE2_TMP="$(new_case_tmpdir 2)"
mkdir -p "$CASE2_TMP/hetero-b-XXXX"
cat > "$CASE2_TMP/hetero-b-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case2-run
root_run_id=case2-root
loop_id=case2-loop
MARKER
CASE2_LOCK="$CASE2_TMP/hetero-b-XXXX/.autopilot-worktree.lock"
: > "$CASE2_LOCK"
flock "$CASE2_LOCK" sleep 30 &
CASE2_HOLDER=$!
poll_until 5 bash -c "flock -n '$CASE2_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case2: setup — lock never observed held"
(
  export TMPDIR="$CASE2_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE2_TMP/.out"
)
CASE2_OUT="$(cat "$CASE2_TMP/.out")"
kill "$CASE2_HOLDER" >/dev/null 2>&1 || true
wait "$CASE2_HOLDER" 2>/dev/null || true
assert_file_exists "$CASE2_TMP/hetero-b-XXXX/.autopilot-worktree" \
  "case2: marker+held-lock hetero dir survives"
assert_eq "$(extract_json_field "$CASE2_OUT" skipped_live)" "1" \
  "case2: envelope skipped_live=1"

# ── Case 3: marker but NO lock file ⇒ survives (unknown) ──
CASE3_TMP="$(new_case_tmpdir 3)"
mkdir -p "$CASE3_TMP/hetero-c-XXXX"
cat > "$CASE3_TMP/hetero-c-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case3-run
root_run_id=case3-root
loop_id=case3-loop
MARKER
(
  export TMPDIR="$CASE3_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE3_TMP/.out"
)
CASE3_OUT="$(cat "$CASE3_TMP/.out")"
assert_file_exists "$CASE3_TMP/hetero-c-XXXX/.autopilot-worktree" \
  "case3: marker-without-lock hetero dir survives (unknown ownership)"
CASE3_UNKNOWN="$(extract_json_field "$CASE3_OUT" skipped_unknown)"
[ "${CASE3_UNKNOWN:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case3: envelope skipped_unknown >= 1, got '${CASE3_UNKNOWN:-}'"

# ── Case 4: lockless autopilot-test-x dir, no other live suite run ⇒ reaped ──
CASE4_TMP="$(new_case_tmpdir 4)"
mkdir -p "$CASE4_TMP/autopilot-test-x"
(
  export TMPDIR="$CASE4_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE4_TMP/.out"
)
CASE4_OUT="$(cat "$CASE4_TMP/.out")"
assert_file_absent "$CASE4_TMP/autopilot-test-x" \
  "case4: lockless autopilot-test-* dir is reaped when no other run is live"
assert_eq "$(extract_json_field "$CASE4_OUT" reaped)" "1" \
  "case4: envelope reaped=1"

# ── Case 5: a FOREIGN live suite-run registry lock protects lockless residue,
#    but a marker+free-lock hetero dir is STILL reaped ──
CASE5_TMP="$(new_case_tmpdir 5)"
mkdir -p "$CASE5_TMP/autopilot-test-y"
mkdir -p "$CASE5_TMP/hetero-d-XXXX"
cat > "$CASE5_TMP/hetero-d-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case5-run
root_run_id=case5-root
loop_id=case5-loop
MARKER
: > "$CASE5_TMP/hetero-d-XXXX/.autopilot-worktree.lock"
CASE5_FOREIGN_LOCK="$CASE5_TMP/.autopilot-suite-run.999999.lock"
: > "$CASE5_FOREIGN_LOCK"
flock "$CASE5_FOREIGN_LOCK" sleep 30 &
CASE5_HOLDER=$!
poll_until 5 bash -c "flock -n '$CASE5_FOREIGN_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case5: setup — foreign registry lock never observed held"
(
  export TMPDIR="$CASE5_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE5_TMP/.out"
)
CASE5_OUT="$(cat "$CASE5_TMP/.out")"
kill "$CASE5_HOLDER" >/dev/null 2>&1 || true
wait "$CASE5_HOLDER" 2>/dev/null || true
assert_file_exists "$CASE5_TMP/autopilot-test-y" \
  "case5: lockless dir survives while a foreign suite run is live"
assert_file_absent "$CASE5_TMP/hetero-d-XXXX" \
  "case5: marker+free-lock hetero dir is STILL reaped despite a foreign live run"
CASE5_FOREIGN="$(extract_json_field "$CASE5_OUT" skipped_foreign_run)"
[ "${CASE5_FOREIGN:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case5: envelope skipped_foreign_run >= 1, got '${CASE5_FOREIGN:-}'"

# ── Case 6: non-matching dir ⇒ survives ──
CASE6_TMP="$(new_case_tmpdir 6)"
mkdir -p "$CASE6_TMP/unrelated-thing"
(
  export TMPDIR="$CASE6_TMP"
  suite_residue_reap >/dev/null
)
assert_file_exists "$CASE6_TMP/unrelated-thing" \
  "case6: non-matching basename survives"

# ── Case 7: symlink hetero-link → outside $TMPDIR is never followed ──
CASE7_TMP="$(new_case_tmpdir 7)"
CASE7_OUTSIDE="$TEST_TMP/case-7-outside-target"
mkdir -p "$CASE7_OUTSIDE"
: > "$CASE7_OUTSIDE/marker-file"
ln -s "$CASE7_OUTSIDE" "$CASE7_TMP/hetero-link"
(
  export TMPDIR="$CASE7_TMP"
  suite_residue_reap >/dev/null
)
assert_file_exists "$CASE7_OUTSIDE/marker-file" \
  "case7: symlink target outside TMPDIR is untouched (never followed)"

# ── Case 8: AUTOPILOT_SUITE_REAP=0 ⇒ nothing reaped ──
CASE8_TMP="$(new_case_tmpdir 8)"
mkdir -p "$CASE8_TMP/hetero-e-XXXX"
cat > "$CASE8_TMP/hetero-e-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case8-run
root_run_id=case8-root
loop_id=case8-loop
MARKER
: > "$CASE8_TMP/hetero-e-XXXX/.autopilot-worktree.lock"
(
  export TMPDIR="$CASE8_TMP"
  export AUTOPILOT_SUITE_REAP=0
  suite_residue_reap >/dev/null
)
assert_file_exists "$CASE8_TMP/hetero-e-XXXX/.autopilot-worktree" \
  "case8: AUTOPILOT_SUITE_REAP=0 kill switch leaves a stale marker+free-lock dir untouched"

# ── Case 9: a live ledger survives while a stale manifest beside it is reaped ──
CASE9_TMP="$(new_case_tmpdir 9)"
mkdir -p "$CASE9_TMP/autopilot-dispatch-runs"
printf '{"run_id":"case9","started_epoch":1}\n' \
  > "$CASE9_TMP/autopilot-dispatch-runs/case9.manifest.json"
printf '{"event":"foreman-tick"}\n' \
  > "$CASE9_TMP/autopilot-dispatch-runs/case9.ledger.jsonl"
(
  export TMPDIR="$CASE9_TMP"
  suite_residue_reap >/dev/null
)
assert_file_absent "$CASE9_TMP/autopilot-dispatch-runs/case9.manifest.json" \
  "case9: stale dead manifest is reaped"
assert_file_exists "$CASE9_TMP/autopilot-dispatch-runs/case9.ledger.jsonl" \
  "case9: live foreman ledger (.ledger.jsonl) survives a reap"

# ── Case 10: pre-run reaper actually fires inside the real run.sh subprocess ──
CASE10_TMP="$(new_case_tmpdir 10)"
mkdir -p "$CASE10_TMP/hetero-f-XXXX"
cat > "$CASE10_TMP/hetero-f-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case10-run
root_run_id=case10-root
loop_id=case10-loop
MARKER
: > "$CASE10_TMP/hetero-f-XXXX/.autopilot-worktree.lock"
mkdir -p "$CASE10_TMP/autopilot-test-z"
CASE10_STDOUT="$(TMPDIR="$CASE10_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 2 sync-version-invalid-version 2>&1)"
CASE10_RC=$?
assert_eq "$CASE10_RC" "0" "case10: run.sh exits 0 with residue seeded"
assert_file_absent "$CASE10_TMP/hetero-f-XXXX" \
  "case10: seeded marker+free-lock residue is gone after run.sh"
assert_file_absent "$CASE10_TMP/autopilot-test-z" \
  "case10: seeded lockless residue is gone after run.sh"
assert_contains "$CASE10_STDOUT" "reaper:" \
  "case10: run.sh stdout contains the reaper: summary line"

# ── Case 11: planted negative — AUTOPILOT_SUITE_REAP=0 leaves residue alone ──
# Without this case, case 10 proves nothing: it shows the assertions CAN go red.
CASE11_TMP="$(new_case_tmpdir 11)"
mkdir -p "$CASE11_TMP/hetero-g-XXXX"
cat > "$CASE11_TMP/hetero-g-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case11-run
root_run_id=case11-root
loop_id=case11-loop
MARKER
: > "$CASE11_TMP/hetero-g-XXXX/.autopilot-worktree.lock"
AUTOPILOT_SUITE_REAP=0 TMPDIR="$CASE11_TMP" \
  bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 2 sync-version-invalid-version >/dev/null 2>&1
assert_file_exists "$CASE11_TMP/hetero-g-XXXX/.autopilot-worktree" \
  "case11: AUTOPILOT_SUITE_REAP=0 leaves seeded residue untouched end-to-end"

# ── Case 12: EXIT trap on interrupt (INT/TERM) still reaps and clears scratch ──
CASE12_TMP="$(new_case_tmpdir 12)"
(
  TMPDIR="$CASE12_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" --parallel 2 session-mode \
    >"$CASE12_TMP/.run-stdout" 2>&1
) &
CASE12_PID=$!

poll_until 15 bash -c "compgen -G '$CASE12_TMP/hooks-run-parallel.*' >/dev/null 2>&1" \
  || fail "case12: setup — run.sh never created a hooks-run-parallel.* scratch dir"

mkdir -p "$CASE12_TMP/hetero-h-XXXX"
cat > "$CASE12_TMP/hetero-h-XXXX/.autopilot-worktree" <<'MARKER'
schema=2
created_at=1000000000
branch=fixture-branch
base_sha=0000000000000000000000000000000000000000
run_id=case12-run
root_run_id=case12-root
loop_id=case12-loop
MARKER
: > "$CASE12_TMP/hetero-h-XXXX/.autopilot-worktree.lock"

kill -TERM "$CASE12_PID" >/dev/null 2>&1
wait "$CASE12_PID" 2>/dev/null
CASE12_RC=$?
# finding srr-untested-exitcodes-rc2: __suite_on_interrupt hardcodes exit 143
# for TERM but nothing asserted it — the subshell's own exit status equals
# run.sh's, since the subshell's last (and only) command is the run.sh call.
assert_eq "$CASE12_RC" "143" \
  "case12: SIGTERM-interrupted run.sh exits 143 (__suite_on_interrupt TERM path)"
poll_until 10 bash -c "! compgen -G '$CASE12_TMP/hooks-run-parallel.*' >/dev/null 2>&1"
CASE12_SCRATCH_MATCHES="$(compgen -G "$CASE12_TMP/hooks-run-parallel.*" 2>/dev/null || true)"
assert_eq "$CASE12_SCRATCH_MATCHES" "" \
  "case12: hooks-run-parallel.* scratch dir still present after SIGTERM"
poll_until 10 bash -c "[ ! -e '$CASE12_TMP/hetero-h-XXXX' ]"
assert_file_absent "$CASE12_TMP/hetero-h-XXXX" \
  "case12: planted stale hetero dir still present after SIGTERM"
CASE12_STDOUT="$(cat "$CASE12_TMP/.run-stdout" 2>/dev/null || true)"
assert_not_contains "$CASE12_STDOUT" "════════ Summary ════════" \
  "case12: SIGTERM genuinely interrupted run.sh before it reached the Summary banner"

# ── Case 13: LIVE-locked, marker-less hetero-* dir survives (foreman defect 1) ──
# dispatch-hetero.sh creates the worktree DIR, then git worktree add, then
# writes the marker, and only THEN opens+acquires the lifetime lock — so a
# live dispatch genuinely has a directory with a held lock but NO marker yet.
CASE13_TMP="$(new_case_tmpdir 13)"
mkdir -p "$CASE13_TMP/hetero-live-XXXX"
CASE13_LOCK="$CASE13_TMP/hetero-live-XXXX/.autopilot-worktree.lock"
: > "$CASE13_LOCK"
flock "$CASE13_LOCK" sleep 30 &
CASE13_HOLDER=$!
poll_until 5 bash -c "flock -n '$CASE13_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case13: setup — lock never observed held"
(
  export TMPDIR="$CASE13_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE13_TMP/.out"
)
CASE13_OUT="$(cat "$CASE13_TMP/.out")"
kill "$CASE13_HOLDER" >/dev/null 2>&1 || true
wait "$CASE13_HOLDER" 2>/dev/null || true
assert_file_exists "$CASE13_TMP/hetero-live-XXXX" \
  "case13: live-locked, marker-less hetero-* dir survives (was reaped outright before the fix)"
CASE13_LIVE="$(extract_json_field "$CASE13_OUT" skipped_live)"
[ "${CASE13_LIVE:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case13: envelope skipped_live >= 1, got '${CASE13_LIVE:-}'"

# ── Case 14: marker-less, lock-less hetero-* dir survives as unknown (foreman defect 2) ──
CASE14_TMP="$(new_case_tmpdir 14)"
mkdir -p "$CASE14_TMP/hetero-nolock-XXXX"
(
  export TMPDIR="$CASE14_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE14_TMP/.out"
)
CASE14_OUT="$(cat "$CASE14_TMP/.out")"
assert_file_exists "$CASE14_TMP/hetero-nolock-XXXX" \
  "case14: marker-less, lock-less hetero-* dir survives (was reaped outright before the fix)"
CASE14_UNKNOWN="$(extract_json_field "$CASE14_OUT" skipped_unknown)"
[ "${CASE14_UNKNOWN:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case14: envelope skipped_unknown >= 1, got '${CASE14_UNKNOWN:-}'"

# ── Case 15: a live standalone test's TEST_TMP (generic .autopilot-live.lock
#    sidecar) survives; once released, the same dir IS reaped (proves the
#    survival isn't just "nothing is ever reaped") ──
CASE15_TMP="$(new_case_tmpdir 15)"
mkdir -p "$CASE15_TMP/autopilot-test-livepeer-XXXX"
CASE15_LOCK="$CASE15_TMP/autopilot-test-livepeer-XXXX/.autopilot-live.lock"
: > "$CASE15_LOCK"
# `flock LOCK sleep 30 &` forks a separate `sleep` child that inherits the
# locked fd, so killing the captured $! (the flock wrapper) leaves the lock
# held by the orphaned child — this case needs the lock to actually become
# free after "releasing the holder", so hold it via an `exec`-replaced
# subshell instead: a single process (no extra fork) that IS the lock holder,
# so killing $! closes the fd and releases the lock immediately.
( exec 9>>"$CASE15_LOCK"; flock -x 9; exec sleep 30 ) &
CASE15_HOLDER=$!
poll_until 5 bash -c "flock -n '$CASE15_LOCK' -c true 2>/dev/null; [ \$? -eq 1 ]" \
  || fail "case15: setup — lock never observed held"
(
  export TMPDIR="$CASE15_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE15_TMP/.out-live"
)
CASE15_OUT_LIVE="$(cat "$CASE15_TMP/.out-live")"
assert_file_exists "$CASE15_TMP/autopilot-test-livepeer-XXXX" \
  "case15: live standalone test's TEST_TMP survives while its .autopilot-live.lock is held"
CASE15_LIVE="$(extract_json_field "$CASE15_OUT_LIVE" skipped_live)"
[ "${CASE15_LIVE:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case15: envelope skipped_live >= 1, got '${CASE15_LIVE:-}'"

kill "$CASE15_HOLDER" >/dev/null 2>&1 || true
wait "$CASE15_HOLDER" 2>/dev/null || true
poll_until 5 bash -c "flock -n '$CASE15_LOCK' -c true 2>/dev/null" \
  || fail "case15: setup — lock never observed free after releasing the holder"
(
  export TMPDIR="$CASE15_TMP"
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE15_TMP/.out-dead"
)
CASE15_OUT_DEAD="$(cat "$CASE15_TMP/.out-dead")"
assert_file_absent "$CASE15_TMP/autopilot-test-livepeer-XXXX" \
  "case15: same TEST_TMP dir IS reaped once its .autopilot-live.lock is released"
assert_eq "$(extract_json_field "$CASE15_OUT_DEAD" reaped)" "1" \
  "case15: envelope reaped=1 after the lock is released"

# ── Case 16: hooks/tests/lib.sh really takes the sidecar lock (wiring
#    evidence, not just capability) — a live sourcing process's TEST_TMP
#    carries an OBSERVABLY HELD .autopilot-live.lock while it runs ──
CASE16_TMP="$(new_case_tmpdir 16)"
CASE16_HELPER="$CASE16_TMP/case16-helper.test.sh"
CASE16_TESTTMP_FILE="$CASE16_TMP/testtmp-path"
cat > "$CASE16_HELPER" <<HELPER
#!/usr/bin/env bash
. "$REPO_ROOT/hooks/tests/lib.sh"
printf '%s' "\$TEST_TMP" > "$CASE16_TESTTMP_FILE"
sleep 5
finalize_test
HELPER
chmod +x "$CASE16_HELPER"
bash "$CASE16_HELPER" >/dev/null 2>&1 &
CASE16_PID=$!
poll_until 5 bash -c "[ -s '$CASE16_TESTTMP_FILE' ]" \
  || fail "case16: setup — helper never wrote its TEST_TMP path"
CASE16_TESTTMP="$(cat "$CASE16_TESTTMP_FILE")"
poll_until 5 bash -c "[ -e '$CASE16_TESTTMP/.autopilot-live.lock' ]" \
  || fail "case16: setup — helper's TEST_TMP never grew a .autopilot-live.lock file"
flock -n "$CASE16_TESTTMP/.autopilot-live.lock" true 2>/dev/null
assert_eq "$?" "1" \
  "case16: a live hooks/tests/lib.sh sourcing process holds its TEST_TMP/.autopilot-live.lock"
wait "$CASE16_PID" 2>/dev/null || true
# lib.sh's own cleanup_test_tmp closes the lock fd THEN rm -rf's TEST_TMP
# whole, so by the time the helper process has fully exited its TEST_TMP
# (lock file included) is gone entirely — checking `flock -n` on a path
# whose parent directory no longer exists is not a meaningful "is it free"
# probe (ENOENT, not lock contention). The real proof the fd was released as
# part of a clean exit is that cleanup ran to completion at all.
poll_until 5 bash -c "[ ! -e '$CASE16_TESTTMP' ]" \
  || fail "case16: helper's TEST_TMP still present after the helper process exited"

# ── Case 17: a failed suite_run_lock_acquire must not blackhole this shell's
#    stderr for the rest of the process (srr-exec-stderr-persist). A no-command
#    `exec {fd}>&- 2>/dev/null` applies its redirections PERMANENTLY to the
#    calling shell; run.sh calls suite_run_lock_acquire directly in its own
#    process, so one failed flock -n (registry lock held by another suite run)
#    used to silence every later stderr diagnostic (L1 output, FAIL lines) for
#    the rest of the run, with exit codes unaffected. Run in a real subprocess
#    so a regression cannot leak this test's own stderr masking into the rest
#    of this suite. ──
CASE17_TMP="$(new_case_tmpdir 17)"
CASE17_HELPER="$CASE17_TMP/case17-helper.sh"
cat > "$CASE17_HELPER" <<'HELPER'
#!/usr/bin/env bash
set -uo pipefail
. "$REPO_ROOT/scripts/lib/worktree-reap.sh"
. "$REPO_ROOT/scripts/lib/prune-tmp-residue.sh"
. "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"
export TMPDIR="$1"
LOCK="$TMPDIR/.autopilot-suite-run.$$.lock"
: > "$LOCK"
# Pre-hold the EXACT lock suite_run_lock_acquire will try to open (keyed on
# this script's own $$), via a single exec-replaced process so killing it
# genuinely releases the flock. A fixed settle sleep (not a tight polling
# loop) mirrors the foreman's verbatim repro: a rapid poll loop here was
# observed to starve the lone background holder process of scheduling time
# in this sandboxed environment, so it never actually got to open+flock
# within the poll window.
( exec 9>>"$LOCK"; flock -n 9; exec sleep 20 ) &
HOLDER=$!
sleep 0.5
suite_run_lock_acquire
echo CASE17-SENTINEL >&2
kill "$HOLDER" >/dev/null 2>&1 || true
wait "$HOLDER" 2>/dev/null || true
HELPER
chmod +x "$CASE17_HELPER"
CASE17_ISOLATED_TMP="$CASE17_TMP/isolated"
mkdir -p "$CASE17_ISOLATED_TMP"
CASE17_STDERR="$(REPO_ROOT="$REPO_ROOT" bash "$CASE17_HELPER" "$CASE17_ISOLATED_TMP" 2>&1 1>/dev/null)"
assert_contains "$CASE17_STDERR" "CASE17-SENTINEL" \
  "case17: stderr still works after a failed suite_run_lock_acquire (srr-exec-stderr-persist)"

# ── Case 18: --dry-run must not really delete anything, including the aged
#    log prune it forwards to (srr-dryrun-prune-not-dry) ──
CASE18_TMP="$(new_case_tmpdir 18)"
CASE18_LOG="$CASE18_TMP/hetero-fixture-log-XXXXXX"
: > "$CASE18_LOG"
touch -d '10 days ago' "$CASE18_LOG"
(
  export TMPDIR="$CASE18_TMP"
  suite_residue_reap --dry-run >/dev/null
)
assert_file_exists "$CASE18_LOG" \
  "case18: --dry-run leaves an aged hetero-*-log-* file in place (was really deleted before the fix)"

# ── Case 19: a live external dispatch's hetero-*-log-* file (a PLAIN FILE,
#    never lock-gated) survives the suite's own immediate reap; a hetero-*-log-*
#    file older than the retention window is still removed, via the aged
#    prune_tmp_residue primitive (srr-live-logfile-unlink) ──
CASE19_TMP="$(new_case_tmpdir 19)"
CASE19_FRESH_LOG="$CASE19_TMP/hetero-live-log-XXXXXX"
: > "$CASE19_FRESH_LOG"
CASE19_AGED_LOG="$CASE19_TMP/hetero-old-log-XXXXXX"
: > "$CASE19_AGED_LOG"
touch -d '10 days ago' "$CASE19_AGED_LOG"
(
  export TMPDIR="$CASE19_TMP"
  export AUTOPILOT_TMP_LOG_RETENTION_DAYS=3
  OUT="$(suite_residue_reap)"
  echo "$OUT" > "$CASE19_TMP/.out"
)
CASE19_OUT="$(cat "$CASE19_TMP/.out")"
assert_file_exists "$CASE19_FRESH_LOG" \
  "case19: a live dispatch's fresh hetero-*-log-* file survives the suite's own reap"
assert_file_absent "$CASE19_AGED_LOG" \
  "case19: a hetero-*-log-* file older than the retention window is still removed (by the aged prune)"
CASE19_DEFERRED="$(extract_json_field "$CASE19_OUT" skipped_log_deferred)"
[ "${CASE19_DEFERRED:-0}" -ge 1 ] 2>/dev/null \
  && __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) \
  || fail "case19: envelope skipped_log_deferred >= 1, got '${CASE19_DEFERRED:-}'"

# ── Case 20: a registry-run lock file landed on mid another run's
#    open→flock gap (freshly created, still unlocked) is left alone rather
#    than tidied as "dead"; one old enough to be genuinely abandoned is still
#    tidied (srr-registry-tidy-race) ──
CASE20_TMP="$(new_case_tmpdir 20)"
CASE20_FRESH="$CASE20_TMP/.autopilot-suite-run.11111.lock"
: > "$CASE20_FRESH"
_srr_other_live_run "$CASE20_TMP" "$CASE20_TMP/.autopilot-suite-run.own.lock"
assert_file_exists "$CASE20_FRESH" \
  "case20: a fresh (<5s) free registry lock file is left alone, not tidied away (was rm'd unconditionally before the fix)"

CASE20_AGED="$CASE20_TMP/.autopilot-suite-run.22222.lock"
: > "$CASE20_AGED"
touch -d '10 seconds ago' "$CASE20_AGED"
_srr_other_live_run "$CASE20_TMP" "$CASE20_TMP/.autopilot-suite-run.own.lock"
assert_file_absent "$CASE20_AGED" \
  "case20: an aged (>=5s) free registry lock file is still tidied away (rm -f), same as before the hardening"

finalize_test
