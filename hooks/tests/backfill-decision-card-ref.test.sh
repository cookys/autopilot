#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
PLUGIN="${AP_PLUGIN_ROOT:-$REPO_ROOT}"
S="$PLUGIN/scripts/backfill-decision-card-ref.js"
REC="$TEST_TMP/records"; CARDS="$TEST_TMP/cards"
mkdir -p "$REC" "$CARDS"
TASK=01M883AEHTJWZH95JSY1MSKEFX
cat > "$CARDS/c.json" <<EOF
{"schema":"autopilot.decision/2","decisions":[
 {"id":"d-aaaaaaaa","question":"Q one?","answer":"Yes  do it","background":"why\nwaiting task: $TASK","status":"closed"},
 {"id":"d-bbbbbbbb","question":"Q two?","answer":"No","status":"closed"}]}
EOF
printf -- '---\nid: R1\nkind: decision\ncreated: 2026-11-20T00:00:00.000Z\n---\nQ one?\n\nAnswer: Yes do it\n' > "$REC/R1.md"
printf -- '---\nid: R2\nkind: decision\ncreated: 2026-11-20T00:00:00.000Z\n---\nQ nobody asked?\n\nAnswer: No\n' > "$REC/R2.md"
printf -- '---\nid: R3\nkind: decision\ncreated: 2026-11-20T00:00:00.000Z\n---\nNo\n\nOption: A\nCard: d-bbbbbbbb\n' > "$REC/R3.md"
cp "$REC/R2.md" "$TEST_TMP/R2.before"
DRY="$(node "$S" --records "$REC" --cards "$CARDS")"
assert_contains "$DRY" 'matched 1, unmatched 1' 'dry run counts'
assert_contains "$DRY" 'unmatched ids: R2' 'dry run lists unmatched ids'
assert_eq "$(command grep -c 'Card:' "$REC/R1.md")" 0 'dry run writes nothing'
node "$S" --records "$REC" --cards "$CARDS" --apply >/dev/null
assert_contains "$(cat "$REC/R1.md")" 'Card: d-aaaaaaaa' 'apply adds the card marker'
assert_contains "$(cat "$REC/R1.md")" "task:$TASK" 'apply adds the waiting task marker'
assert_eq "$(cmp -s "$REC/R2.md" "$TEST_TMP/R2.before" && echo same || echo changed)" same 'negative control: record matching no card stays untouched'
cp "$REC/R1.md" "$TEST_TMP/R1.once"
OUT="$(node "$S" --records "$REC" --cards "$CARDS" --apply)"
assert_eq "$(cmp -s "$REC/R1.md" "$TEST_TMP/R1.once" && echo same || echo changed)" same 'second apply is a no-op'
assert_contains "$OUT" 'matched 0, unmatched 1' 'second run matches nothing new'
finalize_test
