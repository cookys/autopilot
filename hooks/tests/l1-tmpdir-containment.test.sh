#!/usr/bin/env bash
# l1-tmpdir-containment.test.sh — KR2 of docs/plans/2026-10-12-tmp-residue-containment.md.
#
# hooks/tests/run.sh runs the L1 `node --test` pass inside a short per-run `apl1.XXXXXX` dir that
# holds a live flock. This suite proves, on the real entry points:
#   (a) the L1 probe (hooks/l1-tmpdir.test.js) saw os.tmpdir() == the apl1.* dir run.sh exported
#       as AUTOPILOT_L1_TMP, and the dir is gone after the run;
#   (b) a killed run's apl1.* dir (lock holder kill -9'd, lock backdated past the reaper's min
#       age) is reaped by suite_residue_reap;
#   (c) the same dir with the lock still held is kept (skipped_live);
#   (d) a backdated dead apl1.* dir is gone after a real `run.sh <one fast suite>` start.
. "$(dirname "$0")/lib.sh"

# shellcheck source=../../scripts/lib/worktree-reap.sh
. "$REPO_ROOT/scripts/lib/worktree-reap.sh"
# shellcheck source=lib/suite-residue-reap.sh
. "$REPO_ROOT/hooks/tests/lib/suite-residue-reap.sh"

[ -n "${TEST_SHORT_TMP:-}" ] || fail "setup: lib.sh did not provide TEST_SHORT_TMP"

extract_json_field() { printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | grep -o '[0-9]*$'; }

# Start a child that holds an exclusive flock on $1 and nothing else (exec sleep keeps the pid,
# so kill -9 of the pid releases the lock). Sets HOLDER_PID.
start_holder() {
  local lock="$1" ready="$1.ready"
  rm -f "$ready"
  bash -c 'exec 9>>"$1"; flock -n 9 || exit 1; : >"$2"; exec sleep 300' _ "$lock" "$ready" &
  HOLDER_PID=$!
  poll_until 5 test -e "$ready" || fail "setup: lock holder never took the lock"
}

# ── (a) run.sh gives L1 a contained TMPDIR; the probe reports what it saw ──
A_TMP="$TEST_SHORT_TMP/a"
mkdir -p "$A_TMP"
PROBE_OUT="$TEST_TMP/probe-out.json"
OUT_A="$(TMPDIR="$A_TMP" AUTOPILOT_L1_PROBE_OUT="$PROBE_OUT" bash "$REPO_ROOT/hooks/tests/run.sh" l1-tmpdir.test.js 2>&1)"
RC_A=$?
assert_eq "$RC_A" "0" "a: run.sh with the L1 probe exits 0"
assert_file_exists "$PROBE_OUT" "a: the probe actually ran (non-vacuous; it was not skipped)"
SEEN_TMPDIR="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).tmpdir)' "$PROBE_OUT")"
SEEN_L1="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).l1_tmp)' "$PROBE_OUT")"
assert_eq "$SEEN_TMPDIR" "$SEEN_L1" "a: probe os.tmpdir() == AUTOPILOT_L1_TMP exported by run.sh"
case "$(basename "$SEEN_L1")" in apl1.??????) : ;; *) fail "a: L1 dir is not apl1.XXXXXX: $SEEN_L1" ;; esac
assert_eq "$(dirname "$SEEN_L1")" "$A_TMP" "a: the apl1.* dir sits directly under the run's temp root"
assert_file_absent "$SEEN_L1" "a: the apl1.* dir is removed when the run ends"
LEFT_A="$(find "$A_TMP" -maxdepth 1 -name 'apl1.*' | wc -l | tr -d ' ')"
assert_eq "$LEFT_A" "0" "a: no apl1.* dir left behind"

# ── (b) killed run: dead holder + lock backdated past the min age ⇒ reaped ──
B_TMP="$TEST_SHORT_TMP/b"
mkdir -p "$B_TMP/apl1.AbC123"
start_holder "$B_TMP/apl1.AbC123/.autopilot-live.lock"
kill -9 "$HOLDER_PID" 2>/dev/null
wait "$HOLDER_PID" 2>/dev/null
touch -d '-2 min' "$B_TMP/apl1.AbC123/.autopilot-live.lock"
touch -d '-2 min' "$B_TMP/apl1.AbC123"
(
  export TMPDIR="$B_TMP"
  suite_residue_reap >"$B_TMP/.out"
)
OUT_B="$(cat "$B_TMP/.out")"
REAPED_B="$(extract_json_field "$OUT_B" reaped)"
if [ "${REAPED_B:-0}" -lt 1 ]; then fail "b: expected reaped >= 1, got ${REAPED_B:-none}: $OUT_B"; fi
echo "PASS b: reaped=$REAPED_B"
assert_file_absent "$B_TMP/apl1.AbC123" "b: killed run's apl1.* dir is gone"

# ── (c) same dir, lock still held ⇒ kept ──
C_TMP="$TEST_SHORT_TMP/c"
mkdir -p "$C_TMP/apl1.XyZ789"
start_holder "$C_TMP/apl1.XyZ789/.autopilot-live.lock"
touch -d '-2 min' "$C_TMP/apl1.XyZ789/.autopilot-live.lock"
(
  export TMPDIR="$C_TMP"
  suite_residue_reap >"$C_TMP/.out"
)
OUT_C="$(cat "$C_TMP/.out")"
LIVE_C="$(extract_json_field "$OUT_C" skipped_live)"
if [ "${LIVE_C:-0}" -lt 1 ]; then fail "c: expected skipped_live >= 1, got ${LIVE_C:-none}: $OUT_C"; fi
echo "PASS c: skipped_live=$LIVE_C"
assert_file_exists "$C_TMP/apl1.XyZ789" "c: live run's apl1.* dir is kept"
kill -9 "$HOLDER_PID" 2>/dev/null
wait "$HOLDER_PID" 2>/dev/null

# ── (d) run.sh's own start-of-run reaper covers apl1.* ──
D_TMP="$TEST_SHORT_TMP/d"
mkdir -p "$D_TMP/apl1.Dd4567"
: >"$D_TMP/apl1.Dd4567/.autopilot-live.lock"      # dead: nobody holds it
touch -d '-2 min' "$D_TMP/apl1.Dd4567/.autopilot-live.lock"
touch -d '-2 min' "$D_TMP/apl1.Dd4567"
OUT_D="$(TMPDIR="$D_TMP" bash "$REPO_ROOT/hooks/tests/run.sh" hooks/tests/stage-graph.test.sh 2>&1)"
RC_D=$?
assert_eq "$RC_D" "0" "d: run.sh <fast suite> exits 0"
assert_contains "$OUT_D" "reaper: reaped" "d: run.sh printed its reaper summary"
assert_file_absent "$D_TMP/apl1.Dd4567" "d: backdated dead apl1.* dir is gone after a real run.sh start"

finalize_test "l1-tmpdir-containment"
