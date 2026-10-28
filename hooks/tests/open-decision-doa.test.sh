#!/usr/bin/env bash
# BL-0309 item 3: `open-decision.js open` needs --not-authorized <boundary>, and in an orchestrator (l3-l6) session a boundary the
# DOA lets the session decide alone is refused (exit 3). owner-question-guard tells an autonomous session not to open a card.
# Everything runs in TEST_TMP: its own HOME, marker dir and git repo; no model call.
# RED when the check is removed (six mutations tried): checkNotAuthorized always accepting -> 14+ FAIL (missing, unknown, inside-DOA, failure cases);
# autonomous never detected -> 12 FAIL; resolve-doa failure fails open -> 5 FAIL; unknown boundary accepted -> 4 FAIL; DOA verdict ignored -> 7 FAIL;
# guard autonomous hint removed -> 1 FAIL ("不要開卡").
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID DOA_CONFIG_OVERRIDE
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
OD="$REPO_ROOT/scripts/open-decision.js"
GUARD="$REPO_ROOT/hooks/owner-question-guard.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base

# marker <sid> <level|null>: an unexpired session marker
marker() {
  node -e '
    const fs=require("fs");const [d,sid,level,repo]=process.argv.slice(1);
    const now=Date.now();
    fs.writeFileSync(d+"/"+sid+".json",JSON.stringify({session_id:sid,level:level==="null"?null:level,repo_root:repo,started_at:new Date(now-1000).toISOString(),expires_at:new Date(now+3600e3).toISOString(),root_run_id:"root-t"}));
  ' "$AUTOPILOT_SESSION_MODE_DIR" "$1" "$2" "$R"
}
marker auto l3
marker plain null

# od <sid> <args...>: run open; sets RC, ERR, OUT
od() {
  local sid="$1"; shift
  OUT="$(AUTOPILOT_SESSION_ID="$sid" node "$OD" open --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" "$@" 2>"$TEST_TMP/err")"; RC=$?
  ERR="$(cat "$TEST_TMP/err")"
}

# 1. missing --not-authorized: refused in both modes
od auto;  assert_eq "$RC" 2 "autonomous, no --not-authorized: exit 2"; assert_contains "$ERR" "--not-authorized" "missing flag is named"
od plain; assert_eq "$RC" 2 "plain, no --not-authorized: exit 2"
# 2. unknown boundary: refused in both modes (the old free-text form is no longer a boundary)
od auto  --not-authorized "force-push to origin/main"; assert_eq "$RC" 2 "autonomous, free text only: exit 2"; assert_contains "$ERR" "not a known boundary" "unknown boundary named"
od plain --not-authorized "bogus:why";                 assert_eq "$RC" 2 "plain, unknown boundary: exit 2"
# 3. autonomous + inside the DOA (cloud tier: reversible autonomous, external logged): refused, exit 3
od auto --not-authorized "reversible:which helper name"; assert_eq "$RC" 3 "autonomous, reversible is inside the DOA: exit 3"
assert_contains "$ERR" "decide it yourself" "refusal says decide it yourself"; assert_contains "$ERR" "reversible" "refusal names the class"; assert_eq "$OUT" "" "no card id printed"
od auto --not-authorized external;  assert_eq "$RC" 3 "autonomous, external (logged) is inside the DOA: exit 3"
od auto --not-authorized read_only; assert_eq "$RC" 3 "autonomous, read_only is inside the DOA: exit 3"
assert_eq "$(ls "$R/.git/autopilot/decisions" 2>/dev/null)" "" "refused opens wrote no scope file"
# 4. autonomous + outside the DOA: accepted
od auto --not-authorized "irreversible:force-push main"; assert_eq "$RC" 0 "autonomous, irreversible: exit 0"; assert_contains "$OUT" "d-" "card id printed"
SHOW="$(node "$OD" show --cwd "$R")"; assert_contains "$SHOW" "not_authorized: irreversible:force-push main" "boundary:why stored"
od auto --not-authorized "scope-expansion"; assert_eq "$RC" 0 "autonomous, Board boundary scope-expansion: exit 0"
# 5. a lower-trust tier moves the line: local-low-trust escalates reversible
od auto --not-authorized reversible --doa-tier local; assert_eq "$RC" 0 "local tier: reversible escalates, so it is outside the DOA: exit 0"
# 6. plain session: only a known boundary is needed, no DOA lookup
od plain --not-authorized reversible; assert_eq "$RC" 0 "plain session, known boundary: exit 0"
# 7. resolve-doa fails (invalid tier -> its exit 2): owner-only boundaries still open, with a warning; the rest are refused
od auto --not-authorized irreversible --doa-tier "a b"; assert_eq "$RC" 0 "resolve-doa fails, irreversible: opens"; assert_contains "$ERR" "warning: resolve-doa failed" "warning on stderr"
od auto --not-authorized reversible   --doa-tier "a b"; assert_eq "$RC" 3 "resolve-doa fails, reversible: refused (cannot be verified)"; assert_contains "$ERR" "resolve-doa failed" "refusal names the failure"
# 7b. resolve-doa cannot even be spawned (no bash on PATH)
NODE_BIN="$(command -v node)"; NOBASH="$TEST_TMP/nobash"; mkdir -p "$NOBASH"; ln -s "$(command -v git)" "$NOBASH/git"
OUT="$(AUTOPILOT_SESSION_ID=auto PATH="$NOBASH" "$NODE_BIN" "$OD" open --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --not-authorized external 2>"$TEST_TMP/err")"; RC=$?
assert_eq "$RC" 3 "no bash: external refused"; assert_contains "$(cat "$TEST_TMP/err")" "resolve-doa failed" "spawn failure named"

# 7c. dcopt: a card needs options. Every case carries a valid --not-authorized, so each fails only on its own guard.
R2="$TEST_TMP/r2"; mkdir -p "$R2"; git -C "$R2" init -q
odn() { OUT="$(AUTOPILOT_SESSION_ID=plain node "$OD" open --cwd "$R2" --root-run-id root-n --not-authorized irreversible --question "Q?" "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
odn; assert_eq "$RC" 2 "no --option, no --free-text: exit 2"; assert_contains "$ERR" "--free-text" "refusal names --free-text"
assert_eq "$(command ls "$R2/.git/autopilot/decisions" 2>/dev/null)" "" "the refused card wrote no scope file"
odn --option "only::one"; assert_eq "$RC" 2 "exactly one --option: exit 2"
odn --free-text --option "A::a" --option "B::b"; assert_eq "$RC" 2 "--free-text with --option: exit 2"; assert_contains "$ERR" "mutually exclusive" "conflict named"
assert_eq "$(command ls "$R2/.git/autopilot/decisions" 2>/dev/null)" "" "conflicting flags wrote no scope file"
odn --free-text; assert_eq "$RC" 0 "--free-text alone: exit 0"
assert_contains "$(node "$OD" show --cwd "$R2" --json)" '"options": null' "free-text card stores options null"
odn --option "A::a" --option "B::b"; assert_eq "$RC" 0 "two options: exit 0"

# 8. owner-question-guard: both modes name --not-authorized; only the autonomous one says do not open a card
mkdir -p "$TEST_TMP/t"
node -e '
  const fs=require("fs");
  fs.writeFileSync(process.argv[1],JSON.stringify({type:"user",message:{role:"user",content:"go"}})+"\n"+JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"text",text:"Should I rename the helper?"}]}})+"\n");
' "$TEST_TMP/t/q.jsonl"
guard() { printf '{"session_id":"%s","transcript_path":"%s","stop_hook_active":false}' "$1" "$TEST_TMP/t/q.jsonl" | node "$GUARD"; }
G_AUTO="$(guard auto)"; G_PLAIN="$(guard plain)"; G_NONE="$(guard nomarker)"
assert_contains "$G_AUTO" '"decision":"block"' "guard blocks the autonomous session"
assert_contains "$G_AUTO" "--not-authorized" "guard (autonomous) names --not-authorized"
assert_contains "$G_AUTO" "不要開卡" "guard (autonomous): inside the DOA, do not open a card"
assert_contains "$G_PLAIN" "--not-authorized" "guard (plain) names --not-authorized"
assert_not_contains "$G_PLAIN" "不要開卡" "guard (plain) does not say do not open a card"
assert_not_contains "$G_NONE" "不要開卡" "guard (no marker) does not say do not open a card"
finalize_test
