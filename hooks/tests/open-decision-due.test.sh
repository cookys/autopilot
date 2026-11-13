#!/usr/bin/env bash
# hooks/tests/open-decision-due.test.sh - dated reminder cards (PM 01M78866 item c).
#
# Files exercised here (named so the affected-suites selector reaches them): scripts/open-decision.js (open --due / --kind remind, show, done, due-sweep),
# src/status/scope-key.js (dueState, dueRank), src/status/decision-input.js (readDecision due_state + order).
#
# Cases: dueState unit cases; an ordinary card is unchanged; a remind card due in the past is listed first, counted, marked "due now"; one due in the
# future is listed last, not counted, marked "due <local time>"; due-sweep fires once, then not again; the job-page reader orders and labels the same way;
# `done` answers a reminder; bad --due / a remind card with options are refused with nothing written.
# Negative control (evidence-discipline section 58): a preload makes scope-key.js dueState always return 'due'; the not_due assertions must then fail
# (the future card is counted and the "not yet due" line is gone), which proves they can go red.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
scrub_session_env
unset AUTOPILOT_ROOT_RUN_ID

OD_JS="$REPO_ROOT/scripts/open-decision.js"
SK_JS="$REPO_ROOT/src/status/scope-key.js"
DI_JS="$REPO_ROOT/src/status/decision-input.js"
PK_JS="$REPO_ROOT/src/status/project-key.js"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
require_under_test_tmp "$REPO"

OD() { node "$OD_JS" "$@" --cwd "$REPO"; }
OPEN_COMMON=(--executor ns/courier/pm --not-authorized irreversible:test)

# ---- 1. dueState unit cases (pure helper, one implementation) ----
UNIT="$(node -e '
  const { dueState, dueRank } = require(process.argv[1]);
  const now = Date.parse("2026-11-13T00:00:00Z");
  const r = [
    dueState({}, now),
    dueState({ due_at: "not a date" }, now),
    dueState({ due_at: "2026-11-12T23:59:59Z" }, now),
    dueState({ due_at: "2026-11-13T00:00:01Z" }, now),
    dueState({ due_at: "2026-11-13T00:00:00Z" }, now),
    dueState({ due_at: "2026-11-14T00:00:00Z" }, new Date(now)),
    dueState({ due_at: "2026-11-14T00:00:00Z" }, NaN),
    dueState(null, now),
    dueRank({ due_at: "2020-01-01T00:00:00Z" }, now),
    dueRank({}, now),
    dueRank({ due_at: "2099-01-01T00:00:00Z" }, now),
    dueRank({ due_at: "2020-01-01T00:00:00Z", status: "closed" }, now),
  ];
  process.stdout.write(r.join(","));
' "$SK_JS")"
assert_eq "$UNIT" "none,none,due,not_due,due,not_due,due,none,0,1,2,1" "dueState/dueRank unit cases"

# ---- 2. an ordinary card: no due line, no new fields ----
N="$(OD open --question "ordinary question" --option a::one --option b::two "${OPEN_COMMON[@]}")"; rc=$?
assert_exit_code "$rc" 0 "open ordinary card"
OUT="$(OD show)"
assert_contains "$OUT" "open decisions: 1" "ordinary card counted"
assert_not_contains "$OUT" "due" "ordinary card has no due marker"
assert_not_contains "$OUT" "not yet due" "no not-yet-due line without dated cards"
NJ="$(OD show --id "$N" --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")).decisions[0]; process.stdout.write(["due_at" in d, "kind" in d].join(","))')"
assert_eq "$NJ" "false,false" "ordinary card stores neither due_at nor kind"

# ---- 3. refused opens write nothing ----
OD open --question "bad due" --kind remind --due tomorrow "${OPEN_COMMON[@]}" >/dev/null 2>&1; rc=$?
assert_exit_code "$rc" 2 "unparseable --due refused"
OD open --question "remind with options" --kind remind --option a::one --option b::two "${OPEN_COMMON[@]}" >/dev/null 2>&1; rc=$?
assert_exit_code "$rc" 2 "remind card with --option refused"
OD open --question "remind free text" --kind remind --free-text "${OPEN_COMMON[@]}" >/dev/null 2>&1; rc=$?
assert_exit_code "$rc" 2 "remind card with --free-text refused"
OD show --due +1h >/dev/null 2>&1; rc=$?
assert_exit_code "$rc" 2 "--due outside open refused"
assert_contains "$(OD show)" "open decisions: 1" "refused opens wrote nothing"

# ---- 4. remind cards: one past due, one in the future ----
P="$(OD open --question "pay invoice" --kind remind --due 2020-01-01T00:00:00Z "${OPEN_COMMON[@]}")"; rc=$?
assert_exit_code "$rc" 0 "open past-due remind card (no options needed)"
F="$(OD open --question "future reminder" --kind remind --due +1d "${OPEN_COMMON[@]}")"; rc=$?
assert_exit_code "$rc" 0 "open future remind card"
PJ="$(OD show --id "$P" --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")).decisions[0]; process.stdout.write([d.kind, d.due_at, d.options].join(","))')"
assert_eq "$PJ" "remind,2020-01-01T00:00:00.000Z," "remind card stores kind + due_at (ISO UTC), options null"
FJ="$(OD show --id "$F" --json | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8")).decisions[0];
  const h=(Date.parse(d.due_at)-Date.now())/3600000;
  process.stdout.write(String(h > 23 && h <= 24 && d.due_at.endsWith("Z")))')"
assert_eq "$FJ" "true" "--due +1d stores now+24h in ISO UTC"

OUT="$(OD show)"
assert_contains "$OUT" "open decisions: 2" "pending count = ordinary + due reminder, not the future one"
assert_contains "$OUT" "not yet due: 1" "future reminder counted apart"
assert_contains "$OUT" "[1] $P  pay invoice" "due reminder listed first"
assert_contains "$OUT" "[2] $N  ordinary question" "ordinary card in the middle"
assert_contains "$OUT" "[3] $F  future reminder" "not-yet-due reminder listed last"
assert_contains "$OUT" "due now (due_at 2020-01-01T00:00:00.000Z)" "due marker"
assert_contains "$OUT" "(not yet due)" "not-yet-due marker"
FUT_LINE="$(printf '%s\n' "$OUT" | grep -F '(not yet due)')"
assert_contains "$FUT_LINE" "    due 20" "not-yet-due marker shows the local due time"
DUE_COUNT="$(printf '%s\n' "$OUT" | grep -c 'due now')"
assert_eq "$DUE_COUNT" "1" "only the past card is marked due now"

# ---- 5. the job-page reader (decision-input.js) uses the same judgement and order ----
READ="$(node -e '
  const [pk, di] = process.argv.slice(1, 3); const repo = process.argv[3];
  const s = require(pk).scopeFromCwd(repo);
  const common = /^git-common-dir:(.+)$/.exec(s.repo_identity)[1];
  const r = require(di).readDecision({ commonDir: common, key: s.project_key, identity: s.repo_identity, nowMs: Date.now(), liveBase: null });
  process.stdout.write(r.value.map((v) => `${v.question}:${v.due_state || "-"}:${"due_at" in v}`).join("|"));
' "$PK_JS" "$DI_JS" "$REPO")"
assert_eq "$READ" "pay invoice:due:true|ordinary question:-:false|future reminder:not_due:true" "readDecision: due first, not_due last, ordinary view unchanged"

# ---- 6. due-sweep fires once ----
S1="$(OD due-sweep)"; rc=$?
assert_exit_code "$rc" 0 "due-sweep exit 0"
assert_eq "$S1" "DUE $P pay invoice" "first sweep fires the due card only, stable format"
S2="$(OD due-sweep)"; rc=$?
assert_exit_code "$rc" 0 "second due-sweep exit 0"
assert_eq "$S2" "" "second sweep fires nothing (recorded once)"
STATE_N="$(ls "$(git -C "$REPO" rev-parse --absolute-git-dir)/autopilot/decisions/" | grep -c '\.due-sweep\.state$')"
assert_eq "$STATE_N" "1" "sweep state kept in the decisions dir"

# ---- 7. negative control: dueState forced to 'due' must turn the not_due checks red ----
PRELOAD="$TEST_TMP/due-always.cjs"
printf 'const sk = require(%s); sk.dueState = () => "due";\n' "\"$SK_JS\"" > "$PRELOAD"
MUT="$(NODE_OPTIONS="--require=$PRELOAD" node "$OD_JS" show --cwd "$REPO")"
assert_not_contains "$MUT" "not yet due: 1" "negative control: mutant loses the not-yet-due line (the green check above would go red)"
assert_contains "$MUT" "open decisions: 3" "negative control: mutant counts the future reminder (the pending-count check above would go red)"

# ---- 8. done answers a reminder; an ordinary card is still refused ----
D="$(OD done --id "$P")"; rc=$?
assert_exit_code "$rc" 0 "done on a remind card"
assert_eq "$D" "closed $P (reminder done)" "done closes the reminder"
assert_not_contains "$(OD show)" "$P" "a done reminder leaves the list"
OD done --id "$N" >/dev/null 2>&1; rc=$?
assert_exit_code "$rc" 2 "done still refuses an ordinary open card"
assert_eq "$(OD due-sweep)" "" "closed reminder never fires again"

finalize_test
