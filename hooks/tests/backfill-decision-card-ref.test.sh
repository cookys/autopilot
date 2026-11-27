#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
require_hippo_or_skip backfill-decision-card-ref
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
PLUGIN="${AP_PLUGIN_ROOT:-$REPO_ROOT}"
S="$PLUGIN/scripts/backfill-decision-card-ref.js"
R="$(hs_mkrepo bf store)"
CARDS="$TEST_TMP/cards"; mkdir -p "$CARDS"
cat > "$CARDS/c.json" <<EOF
{"schema":"autopilot.decision/2","decisions":[
 {"id":"d-aaaaaaaa","question":"Q one?","answer":"Yes  do it","status":"closed"},
 {"id":"d-bbbbbbbb","question":"Q two?","answer":"Ruling two","answer_free_text":"Ruling two","answer_option":"A","status":"closed"},
 {"id":"d-cccccccc","question":"Q dup?","answer":"Same","status":"closed"},
 {"id":"d-dddddddd","question":"Q dup?","answer":"Same","status":"closed"}]}
EOF
newrec() { printf '%b' "$2" | "$HIPPO_BIN" -C "$R" --json new decision --title "$1" --status open ${3:+--tag "$3"} --body-file - | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.ids[0]))'; }
tags_of() { "$HIPPO_BIN" -C "$R" --json show "$1" | node -e 'let s="";process.stdin.on("data",x=>s+=x).on("end",()=>console.log(JSON.parse(s).data.record.tags.join(" ")))'; }
TAGGED="$(newrec t1 'Q tagged?\n\nAnswer: x\n' key:card:d-99999999)"
MATCH_Q="$(newrec t2 'Q one?\n\nAnswer: Yes do it\n')"
MATCH_R="$(newrec t3 'Ruling two\n\nOption: A\n')"
CARDLINE="$(newrec t4 'Something\n\nOption: B\nCard: d-eeeeeeee\n')"
NOMATCH="$(newrec t5 'Q nobody asked?\n\nAnswer: No\n')"
AMBIG="$(newrec t6 'Q dup?\n\nAnswer: Same\n')"
OPENQ="$(newrec t7 'Just a question?\n')"
ops_sum() { find "$R/.hippo/ops" -type f -exec sha256sum {} + | sort; }
BEFORE="$(ops_sum)"
DRY="$(node "$S" --repo "$R" --cards "$CARDS")"
assert_contains "$DRY" 'dry run: matched 3, unmatched 2, already tagged 1' 'dry run counts'
assert_contains "$DRY" "$NOMATCH" 'dry run lists the unmatched record'
assert_eq "$(ops_sum)" "$BEFORE" 'dry run writes no ops'
ERR="$(node "$S" --repo "$R" --cards "$CARDS" --apply 2>&1)"; RC=$?
assert_eq "$RC" 2 'apply without --backup-ack is refused'
assert_contains "$ERR" 'backup-ack' 'refusal names the missing ack'
node "$S" --repo "$R" --cards "$CARDS" --apply --backup-ack nothex >/dev/null 2>&1; assert_eq "$?" 2 'a non-sha16 ack is refused'
assert_eq "$(ops_sum)" "$BEFORE" 'refused apply writes no ops'
OUT="$(node "$S" --repo "$R" --cards "$CARDS" --apply --backup-ack 0123456789abcdef)"
assert_contains "$OUT" 'applied: matched 3, unmatched 2, already tagged 1' 'apply counts'
assert_contains "$OUT" 'restore:' 'apply prints the restore reminder'
assert_contains "$(tags_of "$MATCH_Q")" 'key:card:d-aaaaaaaa' 'question+answer match gets the card tag'
assert_contains "$(tags_of "$MATCH_R")" 'key:card:d-bbbbbbbb' 'ruling-text match gets the card tag'
assert_contains "$(tags_of "$CARDLINE")" 'key:card:d-eeeeeeee' 'a Card: body line is taken as the card id'
assert_eq "$(tags_of "$TAGGED")" 'key:card:d-99999999' 'already tagged record is left alone'
assert_eq "$(tags_of "$NOMATCH")" '' 'negative control: record matching no card stays untouched'
assert_eq "$(tags_of "$AMBIG")" '' 'negative control: record matching two cards stays untouched'
assert_eq "$(tags_of "$OPENQ")" '' 'a decision that is not a card answer stays untouched'
AFTER1="$(ops_sum)"
OUT2="$(node "$S" --repo "$R" --cards "$CARDS" --apply --backup-ack 0123456789abcdef)"
assert_contains "$OUT2" 'matched 0, unmatched 2, already tagged 4' 'second apply matches nothing new'
assert_eq "$(ops_sum)" "$AFTER1" 'second apply is a no-op (ops unchanged)'
hs_exit_check
finalize_test
