#!/usr/bin/env bash
# run-longest-first.test.sh — hooks/tests/run.sh --parallel starts the slowest files first.
#
# The pool's wall time is bounded below by its slowest file; a slow file that starts late
# extends the run by its whole duration. run.sh orders the pool by the per-file seconds the
# last unfiltered parallel run recorded in $AUTOPILOT_TEST_DURATIONS_FILE.
#
# With --parallel 1 the pool runs one file at a time, so print order == start order — that
# makes the ordering observable through the real run.sh subprocess path.
. "$(dirname "$0")/lib.sh"

RUN="$REPO_ROOT/hooks/tests/run.sh"
FILTER="sync-version-"   # seven sub-second files
DUR="$TEST_TMP/durations.tsv"

order_of() {
  # Print the pool files' headers in the order run.sh printed them.
  printf '%s\n' "$1" | sed -n 's#^──────── hooks/tests/\(sync-version-[a-z-]*\)\.test\.sh ────────$#\1#p'
}

# ── Case 1: no durations file ⇒ glob (alphabetical) order, unchanged behaviour ──
OUT1="$(AUTOPILOT_TEST_DURATIONS_FILE="$TEST_TMP/absent.tsv" bash "$RUN" --parallel 1 "$FILTER" 2>&1)"
RC1=$?
assert_eq "$RC1" "0" "case1: run.sh exits 0"
ORDER1="$(order_of "$OUT1")"
assert_eq "$ORDER1" "$(printf '%s\n' "$ORDER1" | sort)" "case1: no record ⇒ alphabetical order"
assert_eq "$(printf '%s\n' "$ORDER1" | wc -l | tr -d ' ')" "7" "case1: all seven filtered files ran"
assert_file_absent "$TEST_TMP/absent.tsv" "case1: a filtered run does not create the durations file"

# ── Case 2: recorded durations reorder the pool, longest first; unknown files go first ──
# round-trip is alphabetically LAST; give it the largest time so it must jump to the front
# of the recorded files. dry-run gets no row ⇒ unknown ⇒ ahead of every recorded file.
cat >"$DUR" <<'EOF'
hooks/tests/sync-version-check-clean.test.sh	1
hooks/tests/sync-version-check-detects-drift.test.sh	2
hooks/tests/sync-version-invalid-counts.test.sh	3
hooks/tests/sync-version-invalid-version.test.sh	4
hooks/tests/sync-version-preserve-counts.test.sh	5
hooks/tests/sync-version-round-trip.test.sh	90
EOF
BEFORE="$(cat "$DUR")"
OUT2="$(AUTOPILOT_TEST_DURATIONS_FILE="$DUR" bash "$RUN" --parallel 1 "$FILTER" 2>&1)"
RC2=$?
assert_eq "$RC2" "0" "case2: run.sh exits 0"
EXPECTED="sync-version-dry-run
sync-version-round-trip
sync-version-preserve-counts
sync-version-invalid-version
sync-version-invalid-counts
sync-version-check-detects-drift
sync-version-check-clean"
assert_eq "$(order_of "$OUT2")" "$EXPECTED" "case2: unknown first, then descending recorded seconds"

# ── Case 3: a filtered run never rewrites the timing history ──
assert_eq "$(cat "$DUR")" "$BEFORE" "case3: filtered run left the durations file byte-identical"

finalize_test "run-longest-first"
