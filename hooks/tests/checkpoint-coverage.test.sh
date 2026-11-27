#!/usr/bin/env bash
# checkpoint-coverage — (1) SessionStart(compact) records every id the injected checkpoint names; (2) scripts/checkpoint-coverage.js
# counts the orphans that record misses: tasks (a) and decision cards (c) created within 60 min after the compaction,
# PM-ledger decision lines (d) within 60 min before it. BACKLOG (b) is `unsupported` (no creation time of day). fleet is a stub.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID

export AUTOPILOT_LIVE_DIR="$TEST_TMP/live"; mkdir -p "$AUTOPILOT_LIVE_DIR"; chmod 0700 "$AUTOPILOT_LIVE_DIR"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/config.json"
STUB="$TEST_TMP/stub"; mkdir -p "$STUB"
printf '#!/bin/sh\nexit 1\n' > "$STUB/fleet"; chmod +x "$STUB/fleet"; export AUTOPILOT_FLEET_BIN="$STUB/fleet"
CLI="$REPO_ROOT/scripts/checkpoint-coverage.js"

# fake ULID with a chosen creation time, built at runtime
mkulid() { node -e 'const A="0123456789ABCDEFGHJKMNPQRSTVWXYZ";let t=Number(process.argv[1]),s="";for(let i=0;i<10;i++){s=A[t%32]+s;t=Math.floor(t/32)}process.stdout.write(s+"TESTTESTTESTTEST")' "$1"; }
iso() { node -e 'process.stdout.write(new Date(Number(process.argv[1])).toISOString().slice(0,16)+"Z")' "$1"; }

# --- 1. SessionStart(compact) writes the record -----------------------------------------------
AP="$HOOK_HOME/.autopilot"; mkdir -p "$AP"
IDA="01TEST""AAAA""BBBBCCCCDDDDEEEE"
printf 'handoff names task %s and BL-0456 and d-0123abcd, not other words\n' "$IDA" > "$AP/compaction-state-covsess.md"
run_hook session-start.js '{"source":"compact","session_id":"covsess"}'
assert_exit_code "$__RUN_EXIT" 0 "session-start exits 0"
REC="$AUTOPILOT_LIVE_DIR/checkpoint-coverage/covsess.json"
assert_file_exists "$REC" "coverage record written at injection"
assert_eq "$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write([r.schema,r.session,r.ids.slice().sort().join(","),Number.isFinite(r.compacted_at_ms)].join("|"))' "$REC")" "checkpoint-coverage/1|covsess|$IDA,BL-0456,d-0123abcd|true" "record: schema, session, exactly the ids in the text"

# --- 2. orphans -------------------------------------------------------------------------------
T0="$(node -e 'process.stdout.write(String(Date.now()-30*60*1000))')"   # compacted 30 min ago
NEWT="$(mkulid $((T0 + 10*60*1000)))"; COVT="$(mkulid $((T0 + 20*60*1000)))"; OLDT="$(mkulid $((T0 - 5*60*1000)))"; LATE="$(mkulid $((T0 + 90*60*1000)))"
write_rec() { node -e 'require(process.argv[1]).recordCoverage({sessionId:"orph",text:process.argv[3],now:Number(process.argv[2])})' "$REPO_ROOT/scripts/lib/compaction-handoff.js" "$T0" "$1"; }
write_rec "the checkpoint named $COVT only"
assert_file_exists "$AUTOPILOT_LIVE_DIR/checkpoint-coverage/orph.json" "record for the orphan session"

# decision cards opened after the compaction (real open-decision in a temp repo)
CWDR="$TEST_TMP/covrepo"; mkdir -p "$CWDR"
( cd "$CWDR" && git init -q -b main && git config user.email t@t && git config user.name t && echo a > a && git add a && git commit -q -m c )
opencard() { HOME="$HOOK_HOME" node "$REPO_ROOT/scripts/open-decision.js" open --category presence --kind step --executor ns/cc/exec--claude --operator-step-none "test fixture card" --question "$1" --source t --cwd "$CWDR" --json 2>/dev/null < /dev/null | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).id)'; }
CARD1="$(opencard "orphan card")"; CARD2="$(opencard "covered card")"
write_rec "the checkpoint named $COVT and $CARD2 only"

# ledger: an orphan decision line, a line naming a known task, an old line, a non-decision line
LD="$TEST_TMP/ledger"; mkdir -p "$LD"; export AUTOPILOT_PM_LEDGER_DIR="$LD"
{ printf -- '- %s 11-15 PM go: nothing names a task here\n' "$(iso $((T0 - 10*60*1000)))"
  printf -- '- %s 11-15 OPERATOR answers, see task %s\n' "$(iso $((T0 - 11*60*1000)))" "$OLDT"
  printf -- '- %s 11-15 PM go: two hours old\n' "$(iso $((T0 - 120*60*1000)))"
  printf -- '- %s 11-15 plain note without a decision marker\n' "$(iso $((T0 - 12*60*1000)))"; } > "$LD/2026-11-15-go-ledger.md"
ALLJSON="[{\"task_id\":\"$OLDT\"},{\"task_id\":\"$NEWT\"},{\"task_id\":\"$COVT\"}]"
MINEJSON="[{\"task_id\":\"$OLDT\",\"title\":\"old\"},{\"task_id\":\"$NEWT\",\"title\":\"orphan task\"},{\"task_id\":\"$COVT\",\"title\":\"covered\"},{\"task_id\":\"$LATE\",\"title\":\"after window\"}]"
printf '#!/bin/sh\ncase "$*" in *--all*) cat <<J\n%s\nJ\n;; *--mine*) cat <<J\n%s\nJ\n;; *) exit 1;; esac\n' "$ALLJSON" "$MINEJSON" > "$STUB/fleet"
NOWARG="$((T0 + 120*60*1000))"
OUT="$(node "$CLI" --session orph --now "$NOWARG" --cwd "$CWDR" --json < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "cli exits 0"
fld() { node -e 'const r=JSON.parse(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$OUT" "$1"; }
assert_eq "$(fld 'r.orphans.a')" "1" "a: one task created after compaction inside the window (covered, old and out-of-window ones not counted)"
assert_eq "$(fld 'r.orphans.b')" "unsupported" "b: backlog has no creation time of day: unsupported"
assert_eq "$(fld 'r.orphans.c')" "1" "c: one open decision card not in the record (CARD2 is in it)"
assert_eq "$(fld 'r.orphans.d')" "1" "d: one ledger decision line naming no known task (old, non-decision and task-naming lines not counted)"
assert_eq "$(fld 'r.total')" "3" "total = a+c+d"
assert_contains "$OUT" "$NEWT" "items list the orphan task"
assert_contains "$OUT" "$CARD1" "items list the orphan card"
assert_not_contains "$OUT" "$COVT" "an id present in the record is not an orphan"
assert_not_contains "$OUT" "\"id\":\"$CARD2\"" "a card present in the record is not an orphan"

# (d) self-cover: the ledger tail is itself injected, so a ledger line naming an id that is only in the record (not a fleet
# task) is still an orphan
ORPH="$(mkulid $((T0 - 3*60*1000)))"
printf -- '- %s 11-15 PM go: names %s which is no fleet task\n' "$(iso $((T0 - 9*60*1000)))" "$ORPH" >> "$LD/2026-11-15-go-ledger.md"
write_rec "named $COVT $CARD2 and the ledger id $ORPH"
OUT="$(node "$CLI" --session orph --now "$NOWARG" --cwd "$CWDR" --json < /dev/null)"
assert_eq "$(fld 'r.orphans.d')" "2" "d: a ledger line naming an id absent from fleet tasks but present in the record is counted"
write_rec "the checkpoint named $COVT and $CARD2 only"
sed -i '$d' "$LD/2026-11-15-go-ledger.md"

# negative control: the same data with the new ids named in the record leaves nothing
write_rec "named $COVT $NEWT $CARD1 $CARD2"
OUT="$(node "$CLI" --session orph --now "$NOWARG" --cwd "$CWDR" --json < /dev/null)"
assert_eq "$(fld 'r.orphans.a')" "0" "negative control: a task named in the record is covered (a = 0)"
assert_eq "$(fld 'r.orphans.c')" "0" "negative control: cards named in the record are covered (c = 0)"

# --- 3. unsupported sources -------------------------------------------------------------------
OUT="$(AUTOPILOT_PM_LEDGER_DIR="$TEST_TMP/none" node "$CLI" --session orph --cwd "$CWDR" --json < /dev/null)"
assert_eq "$(fld 'r.orphans.d')" "unsupported" "absent ledger dir: d unsupported"
printf '#!/bin/sh\nexit 1\n' > "$STUB/fleet"
OUT="$(node "$CLI" --session orph --cwd "$CWDR" --json < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "failing fleet: cli still exits 0"
assert_eq "$(fld 'r.orphans.a')" "unsupported" "failing fleet: a unsupported, not 0"
OUT="$(node "$CLI" --session nosuch --json < /dev/null)"; RC=$?
assert_exit_code "$RC" 0 "no record: cli exits 0"
assert_contains "$OUT" "no coverage record" "no record: says so"

finalize_test
