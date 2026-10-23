#!/usr/bin/env bash
# BL-0246 end to end: a final-panel seat whose cleanroom transport fails must leave exit_code,
# stage and stderr_tail in the seat artifact (seat-N.json `failure`) after a REAL engine run
# (real ledger/intake/packet; dispatch-review.sh pointed at a stub emitting the no_verdict detail).
# RED at b7f421e66 (engine not wired; measured by restoring that engine): 4 passed, 3 failed -
#   seat artifact carries failure.exit_code: actual '<undef>', wanted '5'; same for stage (cleanroom)
#   and stderr_tail (Permission denied). Restoring only the old runners/review.js (unknown-field
#   throw) over the wired engine gives the same 3 FAILs.
# Negative control: remove the recordFailure calls from autopilot-engine.js -> the same asserts go red.
. "$(dirname "$0")/lib.sh"
TEST_NAME="final-panel-seat-failure-reason"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID AUTOPILOT_PARENT_RUN_ID \
  AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID AUTOPILOT_DISPATCH_DEPTH \
  AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID 2>/dev/null || true
DRIVER="$REPO_ROOT/hooks/tests/lib/final-panel-seat-xproc-driver.js"
STUB="$REPO_ROOT/hooks/tests/lib/final-panel-seat-failure-stub-review.sh"
M1=claude-opus-4-6; M2=gpt-5.4; M3=glm-4.7

mk_ctx() { # $1 name, $2 failModel
  local d="$TEST_TMP/$1"; mkdir -p "$d/repo"
  cat > "$d/ctx.json" <<J
{"root":"$REPO_ROOT","tmp":"$d","sbx":"$d/repo","tag":"xp-$1","stub":"$STUB","log":"$d/log","failModel":"$2",
"seats":[{"role":"qc","runner":"cc-shim","model":"$M1","effort":"high","endpoint":null,"family":"anthropic"},
{"role":"qc","runner":"cc-shim","model":"$M2","effort":"high","endpoint":null,"family":"openai"},
{"role":"qc","runner":"cc-shim","model":"$M3","effort":"high","endpoint":null,"family":"zai"}]}
J
  echo "$d"
}
# node's own exit code (not tail's): run to a file first, then take the last line.
drive() {
  node "$DRIVER" "$1" "$2/ctx.json" < /dev/null >"$2/$1.out" 2>"$2/$1.err"
  local rc=$?
  tail -1 "$2/$1.out" > "$2/$1.json"
  echo "$rc"
}
field() { node -e "const j=JSON.parse(require('fs').readFileSync('$1','utf8'));process.stdout.write(String(j['$2']))"; }
setfield() { node -e "const f='$1/ctx.json';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));j['$2']=$3;require('fs').writeFileSync(f,JSON.stringify(j))"; }
models() { sort "$1/log" | tr '\n' ','; }  # sorted: the fanout dispatches seats concurrently
seat1() { find "$1/repo/.git/autopilot/final-panel-seats" -name seat-1.json | head -1; }


A=$(mk_ctx a "$M2")
assert_eq "0" "$(drive run1 "$A")" "run1 process exits 0"
assert_eq "final_panel_seat_transport_failed" "$(field "$A/run1.json" reason)" "run1 reason is the seat transport failure"
FAILED="$(find "$A/repo/.git/autopilot/final-panel-seats" -name seat-2.json | head -1)"
assert_file_exists "$FAILED" "failed seat artifact exists"
jf() { node -e "const j=JSON.parse(require('fs').readFileSync('$FAILED','utf8'));const v=j.failure&&j.failure['$1'];process.stdout.write(v===undefined?'<undef>':String(v))"; }
assert_eq "5" "$(jf exit_code)" "seat artifact carries failure.exit_code"
assert_eq "cleanroom" "$(jf stage)" "seat artifact carries failure.stage"
assert_contains "$(jf stderr_tail)" "Permission denied" "seat artifact carries failure.stderr_tail"
assert_eq "null" "$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$FAILED','utf8')).result))")" "failed seat result stays null (never reusable)"
finalize_test
