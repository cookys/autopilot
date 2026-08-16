#!/usr/bin/env bash
# Red-case coverage for scripts/lib/scaffold-envelope.sh (four-layer D4 / KR3 consumer side).
. "$(dirname "$0")/lib.sh"

. "$REPO_ROOT/scripts/lib/scaffold-envelope.sh"
DOC="$REPO_ROOT/references/scaffold-tiers.md"
BODY="$TEST_TMP/body.txt"; printf 'TASK: fix the widget.\n' > "$BODY"

# Cumulative envelopes: T0 ⊂ T1 ⊂ T2
OUT="$TEST_TMP/t0.txt"; build_scaffold_envelope T0 "$DOC" "$BODY" "$OUT"
assert_eq "0" "$?" "T0 envelope builds"
assert_contains "$(cat "$OUT")" "You own this task end-to-end" "T0 contract present"
assert_not_contains "$(cat "$OUT")" "OBLIGATIONS" "T0 has no T1 checklist"
assert_contains "$(cat "$OUT")" "TASK: fix the widget." "prompt body untouched"

OUT="$TEST_TMP/t1.txt"; build_scaffold_envelope T1 "$DOC" "$BODY" "$OUT"
assert_contains "$(cat "$OUT")" "OBLIGATIONS" "T1 adds the checklist"
assert_not_contains "$(cat "$OUT")" "PROCESS (follow in order" "T1 has no T2 sequence"

OUT="$TEST_TMP/t2.txt"; build_scaffold_envelope T2 "$DOC" "$BODY" "$OUT"
assert_contains "$(cat "$OUT")" "PROCESS (follow in order" "T2 adds the prescribed sequence"
assert_contains "$(cat "$OUT")" "red lines stated in the task prompt below" "placeholder resolved"

# RED: missing doc fails closed (a silently absent envelope defeats the mechanism)
build_scaffold_envelope T0 "$TEST_TMP/no-such-doc.md" "$BODY" "$TEST_TMP/x.txt" 2>/dev/null; EXIT=$?
assert_eq "1" "$EXIT" "missing tiers doc fails closed"

# RED: bad tier rejected
build_scaffold_envelope T9 "$DOC" "$BODY" "$TEST_TMP/x.txt" 2>/dev/null; EXIT=$?
assert_eq "1" "$EXIT" "unknown tier fails closed"

# Rank order underpins the may-only-ADD-scaffolding override rule
assert_eq "0" "$(scaffold_tier_rank T0)" "T0 rank 0"
assert_eq "2" "$(scaffold_tier_rank T2)" "T2 rank 2"

finalize_test
