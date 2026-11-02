#!/usr/bin/env bash
# F4 R4 (operator console, PM ruling G4): `open-decision.js open --kind decide|go` stores an additive `kind` on the card entry.
# Negative controls (shown red before green): (1) validation removed -> the "--kind foo" case FAILs (it would exit 0 and write a card);
# (2) --kind added to parse()'s valued set instead of being lifted out in main() -> the frozen-stub byte comparison FAILs.
. "$(dirname "$0")/lib.sh"
export HOME="$TEST_TMP/home"; mkdir -p "$HOME"
unset AUTOPILOT_ROOT_RUN_ID AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID CLAUDE_SESSION_ID CODEX_THREAD_ID AUTOPILOT_PARENT_SESSION_ID
export AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/modes"; mkdir -p "$AUTOPILOT_SESSION_MODE_DIR"
export AUTOPILOT_RUNS_WATCH_AUTOSTART=0
OD="$REPO_ROOT/scripts/open-decision.js"
GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=develop -c commit.gpgsign=false"
R="$TEST_TMP/repo"; mkdir -p "$R"; $GIT -C "$R" init -q; $GIT -C "$R" commit -q --allow-empty -m base
od() { OUT="$(node "$OD" open --cwd "$R" --root-run-id root-t --question "Q?" --option "A::a" --option "B::b" --not-authorized irreversible "$@" 2>"$TEST_TMP/err")"; RC=$?; ERR="$(cat "$TEST_TMP/err")"; }
files() { find "$R/.git/autopilot/decisions" -name '*.json' 2>/dev/null | wc -l | tr -d ' '; }
kind_of() { node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const e=v.decisions.find(d=>d.id===process.argv[2]);process.stdout.write(String(e.kind))' "$(find "$R/.git/autopilot/decisions" -name '*.json' | head -1)" "$1"; }

# old behaviour: no --kind, no kind field, still readable
od; assert_eq "$RC" 0 "no --kind: exit 0"; OLD="$OUT"
assert_eq "$(kind_of "$OLD")" "undefined" "no --kind: entry has no kind field"
assert_contains "$(node "$OD" show --cwd "$R")" "$OLD" "old card is shown"
# valid values
od --kind go;     assert_eq "$RC" 0 "--kind go: exit 0"; GO="$OUT"; assert_eq "$(kind_of "$GO")" "go" "go stored"
od --kind decide; assert_eq "$RC" 0 "--kind decide: exit 0"; DE="$OUT"; assert_eq "$(kind_of "$DE")" "decide" "decide stored"
assert_contains "$(node "$OD" show --cwd "$R")" "kind: go" "show prints kind"
# negative control 1: other values refused, nothing written
BEFORE="$(files)"; BODY="$(cat "$R"/.git/autopilot/decisions/*.json | wc -c | tr -d ' ')"
for bad in foo GO unspecified ""; do
  od --kind "$bad"; assert_eq "$RC" 7 "--kind '$bad': exit 7"; assert_contains "$ERR" "--kind must be one of" "--kind '$bad': reason named"; assert_eq "$OUT" "" "--kind '$bad': no id printed"
done
assert_eq "$(cat "$R"/.git/autopilot/decisions/*.json | wc -c | tr -d ' ')" "$BODY" "refused kinds wrote nothing"
od --kind; assert_eq "$RC" 2 "--kind without a value: usage exit 2"
# negative control 2: parse()'s flag set stays byte-identical to the frozen stub
node -e '
const fs=require("fs");
const src=fs.readFileSync(process.argv[1],"utf8");
const m=src.match(/const valued = new Set\(\[[^\]]*\]\)/);
if(!m||/kind/.test(m[0])){console.log("VALUED_HAS_KIND_OR_MISSING");process.exit(1)}
' "$OD"; assert_eq "$?" 0 "valued Set does not contain kind (frozen stub stays byte-identical)"
git -C "$REPO_ROOT" diff --quiet HEAD -- hooks/tests/skill-onoff-d0gate-v2.test.sh 2>/dev/null; assert_eq "$?" 0 "frozen stub test file untouched"
finalize_test
