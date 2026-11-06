#!/usr/bin/env bash
# BL cardtrail: `open-decision.js close` keeps the card (status closed, closed_at, answer), `show --id` finds a closed card, `list` hides closed ones
# unless --all, `close --answer` delivers to the executor (dispatch) and the asker (fyi), a failed delivery is recorded and exits 14, a step only the
# operator can do goes to awaiting_operator_action (`done` ends it, plain `close` is refused), and `backfill` is a dry run unless --apply.
# Negative controls (each shown red before green in the lane logs):
#   NC1 show --id of a CLOSED card (it used to be gone, so the answer only lived in chat);
#   NC2 a failing fleet must exit 14 and leave delivery: failed on the card (a swallowed error would exit 0);
#   NC3 backfill without --apply writes nothing.
# fleet is always the stub below (AUTOPILOT_FLEET_BIN): nothing real is ever sent.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
STUBLOG="$TEST_TMP/fleet.log"; : > "$STUBLOG"
cat > "$TEST_TMP/fleet" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$STUBLOG"
if [ -n "$STUB_FAIL" ]; then echo "stub: courier down" >&2; exit 3; fi
exit 0
STUB
chmod +x "$TEST_TMP/fleet"
export AUTOPILOT_FLEET_BIN="$TEST_TMP/fleet" STUBLOG
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
D="$R/.git/autopilot/decisions"
EXEC="ns/cc/exec--claude"; ASK="ns/cc/asker--claude"
od() { OUT="$(node "$OD" "$@" --cwd "$R" --root-run-id rt 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
opencard() { OUT="$(node "$OD" open --cwd "$R" --root-run-id rt --question "$1" --free-text --not-authorized irreversible "${@:2}" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
field() { node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const e=v.decisions.find(d=>d.id===process.argv[2]);const x=e?e[process.argv[3]]:undefined;process.stdout.write(x===undefined?"<undef>":String(x))' "$(ls "$D"/*.json | head -1)" "$1" "$2"; }

# 1. open stores executor + asker; close --answer keeps the record
opencard "Q1?" --executor "$EXEC" --asker "$ASK"; assert_eq "$RC" 0 "open with --executor/--asker: exit 0"; C1="$OUT"
assert_eq "$(field "$C1" executor)" "$EXEC" "open stored executor"; assert_eq "$(field "$C1" asker)" "$ASK" "open stored asker"
assert_eq "$(field "$C1" status)" "open" "open card has status open"
od close --id "$C1" --answer "go：就照 A 做"; assert_eq "$RC" 0 "close --answer: exit 0"; assert_contains "$OUT" "closed $C1" "close says closed"
assert_eq "$(field "$C1" status)" "closed" "card kept with status closed"
assert_eq "$(field "$C1" answer)" "go：就照 A 做" "answer text kept verbatim"
CA="$(field "$C1" closed_at)"; case "$CA" in 20??-??-??T??:??:??.???Z) assert_eq 1 1 "closed_at is ISO UTC";; *) fail "closed_at not ISO UTC: $CA";; esac
od list; assert_eq "$RC" 1 "list: closed card is not listed (exit 1, none open)"; assert_contains "$OUT" "no open decision" "list says none open"
od list --all; assert_eq "$RC" 0 "list --all: exit 0"; assert_contains "$OUT" "$C1" "list --all shows the closed card"
# NC1: show --id finds the closed card with its answer
od show --id "$C1"; assert_eq "$RC" 0 "NC1 show --id of a closed card: exit 0"; assert_contains "$OUT" "status: closed" "NC1 show --id: status"; assert_contains "$OUT" "go：就照 A 做" "NC1 show --id: answer text"
od show --id d-nope; assert_eq "$RC" 1 "show --id of an unknown card: exit 1"
# delivery: dispatch to the executor, fyi to the asker, both carry the card id and the answer
assert_contains "$(cat "$STUBLOG")" "dispatch $EXEC" "executor got a dispatch"
assert_contains "$(cat "$STUBLOG")" "send $ASK" "asker got an fyi send"
assert_contains "$(cat "$STUBLOG")" "$C1" "dispatch names the card id"; assert_contains "$(cat "$STUBLOG")" "go：就照 A 做" "dispatch carries the answer text"
assert_eq "$(field "$C1" delivery)" "ok" "delivery recorded ok"
od close --id "$C1" --answer "again"; assert_contains "$OUT" "not open: $C1" "closing a closed card is a no-op (record unchanged)"
assert_eq "$(field "$C1" answer)" "go：就照 A 做" "second close did not overwrite the answer"

# 2. executor given at close; none anywhere -> warning, no send
: > "$STUBLOG"; opencard "Q2?"; C2="$OUT"
od close --id "$C2" --answer "no executor here"; assert_eq "$RC" 0 "no executor anywhere: still closes, exit 0"
assert_contains "$OUT" "沒有 executor，不會派工" "warns there is no executor"; assert_eq "$(cat "$STUBLOG")" "" "nothing sent without an executor"
assert_eq "$(field "$C2" status)" "closed" "card closed anyway"
: > "$STUBLOG"; opencard "Q3?"; C3="$OUT"
od close --id "$C3" --answer "x" --executor "$EXEC"; assert_eq "$RC" 0 "executor given at close: exit 0"
assert_contains "$(cat "$STUBLOG")" "dispatch $EXEC" "close --executor dispatched"; assert_not_contains "$(cat "$STUBLOG")" "send " "no asker -> no fyi"

# 3. NC2: a failing fleet is not swallowed
: > "$STUBLOG"; opencard "Q4?" --executor "$EXEC" --asker "$ASK"; C4="$OUT"
STUB_FAIL=1 od close --id "$C4" --answer "ans4"; assert_eq "$RC" 14 "NC2 failed delivery: exit 14"
assert_contains "$ERR" "NOT fully delivered" "NC2 stderr names the failure"; assert_contains "$ERR" "courier down" "NC2 stderr carries the reason"
assert_eq "$(field "$C4" status)" "closed" "NC2 card is closed anyway"; assert_eq "$(field "$C4" delivery)" "failed" "NC2 delivery: failed recorded"
assert_contains "$(field "$C4" delivery_error)" "courier down" "NC2 reason recorded on the card"
opencard "Q4b?" --executor "bad address"; assert_eq "$RC" 2 "open --executor with a non-address: usage exit 2"

# 4. awaiting_operator_action
: > "$STUBLOG"; opencard "Q5?" --executor "$EXEC"; C5="$OUT"
od close --id "$C5" --answer "run the script" --awaiting-operator "跑 scripts/x.sh"; assert_eq "$RC" 0 "awaiting: exit 0"; assert_contains "$OUT" "awaiting_operator_action $C5" "awaiting says so"
assert_eq "$(field "$C5" status)" "awaiting_operator_action" "status awaiting_operator_action"; assert_eq "$(field "$C5" awaiting_operator)" "跑 scripts/x.sh" "the step is stored"
od list; assert_contains "$OUT" "$C5" "list shows an awaiting card (it is not closed)"; assert_contains "$OUT" "status: awaiting_operator_action" "list marks the status"
assert_contains "$(cat "$STUBLOG")" "操作員本人動手" "the executor is told the operator still has a step"
od close --id "$C5"; assert_eq "$RC" 2 "plain close of an awaiting card is refused"; assert_contains "$ERR" "done --id" "refusal points at done"
assert_eq "$(field "$C5" status)" "awaiting_operator_action" "still awaiting after the refused close"
od done --id "$C1"; assert_contains "$OUT" "already closed" "done on a closed card is idempotent"
opencard "Q6?"; C6="$OUT"; od done --id "$C6"; assert_eq "$RC" 2 "done on an open card is refused"
od done --id "$C5"; assert_eq "$RC" 0 "done: exit 0"; assert_eq "$(field "$C5" status)" "closed" "done closes it"
assert_neq "$(field "$C5" closed_at)" "<undef>" "done sets closed_at"; assert_eq "$(field "$C5" answer)" "run the script" "done keeps the answer"

# 5. argument checks
od close --id "$C6" --answer a --option X; assert_eq "$RC" 2 "--answer with --option: usage exit 2"
od close --id "$C6" --executor "$EXEC"; assert_eq "$RC" 2 "--executor without --answer: usage exit 2"
od close --id "$C6" --answer a --executor "x y"; assert_eq "$RC" 2 "--executor not an address: usage exit 2"
od close --id "$C6"; assert_eq "$RC" 0 "plain close (withdrawal) still works"; assert_eq "$(field "$C6" status)" "closed" "withdrawal kept as closed"; assert_eq "$(field "$C6" answer)" "null" "withdrawal has answer null"

# 6. backfill: dry run by default
cat > "$TEST_TMP/bf.jsonl" <<JSON
{"id":"d-aaaa1111","question":"old Q A?","answer":"yes A","closed_at":"2026-11-05T02:57:00Z","executor":"$EXEC","asker":"$ASK"}
{"id":"d-bbbb2222","question":"old Q B?","answer":"yes B","closed_at":"2026-11-04T22:16:00Z"}
{"id":"$C1","question":"dup","answer":"dup","closed_at":"2026-11-05T02:57:00Z"}
JSON
BEFORE="$(cat "$D"/*.json | wc -c | tr -d ' ')"
od backfill --from "$TEST_TMP/bf.jsonl"; assert_eq "$RC" 0 "NC3 backfill dry run: exit 0"
assert_contains "$OUT" "DRY RUN" "NC3 says dry run"; assert_contains "$OUT" "would add d-aaaa1111" "NC3 lists what it would add"
assert_eq "$(cat "$D"/*.json | wc -c | tr -d ' ')" "$BEFORE" "NC3 dry run wrote nothing"
od show --id d-aaaa1111; assert_eq "$RC" 1 "NC3 dry run: the card is not in the store"
od backfill --from "$TEST_TMP/bf.jsonl" --apply; assert_eq "$RC" 0 "backfill --apply: exit 0"; assert_contains "$OUT" "2 to add, 1 already" "apply counts"
od show --id d-aaaa1111; assert_eq "$RC" 0 "applied card found by show --id"; assert_contains "$OUT" "yes A" "applied card has the answer"; assert_contains "$OUT" "closed_at: 2026-11-05T02:57:00.000Z" "applied card has closed_at"
assert_eq "$(field "$C1" answer)" "go：就照 A 做" "backfill did not overwrite an existing card"
od backfill --from "$TEST_TMP/bf.jsonl" --apply; assert_contains "$OUT" "0 to add, 3 already" "second apply adds nothing"
printf '{"id":"d-cccc3333","question":"q","answer":"","closed_at":"2026-11-05T02:57:00Z"}\n' > "$TEST_TMP/bad.jsonl"
od backfill --from "$TEST_TMP/bad.jsonl" --apply; assert_eq "$RC" 2 "a bad line refuses the run (even with --apply)"; od show --id d-cccc3333; assert_eq "$RC" 1 "bad line wrote nothing"
finalize_test
