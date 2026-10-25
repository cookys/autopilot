#!/usr/bin/env bash
# hooks/tests/skill-onoff-fbatch-runner.test.sh — the findings-batch cell runner is a pinned copy of the bpack runner.
# bpack (and gdorm) are digest-frozen and have live results, so they never change. run-skill-onoff-eval-fbatch.sh /
# run-skill-onoff-matrix-fbatch.sh are copies; the matrix adds ONOFF_SINGLE_REP (run only the campaign's rep, no hidden
# retry of an earlier failed rep), the eval runner adds: ONOFF_MAX_BUDGET_USD (hard
# per-cell spend cap handed to every `claude -p` as --max-budget-usd, turn 2 gets what turn 1 left, a budget stop is
# infra_fail/budget_exceeded; a turn without a trustworthy end cost = no further turn, cost_unknown:true) and ONOFF_CELL_TMPDIR=1 (the agent's TMPDIR is a dir inside the scratch HOME). Both opt-in.
# The delta is pinned line for line: any other code difference, or an edit of these lines, is red. Negative control: a
# mutant with one extra line, and a mutant that no longer passes the budget flag, are both red.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "=== matrix-fbatch differs from matrix-bpack (names aside) by exactly the pinned single-rep delta ==="
mdelta() { diff -U0 <(grep -v '^[[:space:]]*#' "$BASE/run-skill-onoff-matrix-bpack.sh" | sed 's/bpack/fbatch/g') <(grep -v '^[[:space:]]*#' "$1") | sed '1,2d' | grep -E '^[+-]' || true; }
cat > "$TEST_TMP/mdelta.expected" << 'MDELTA'
+REP_FROM=1; [ "${ONOFF_SINGLE_REP:-0}" != 1 ] || REP_FROM="$REPS"
-  for rep in $(seq 1 "$REPS"); do
+  for rep in $(seq "$REP_FROM" "$REPS"); do
MDELTA
mdelta "$BASE/run-skill-onoff-matrix-fbatch.sh" > "$TEST_TMP/mdelta.actual"
diff "$TEST_TMP/mdelta.expected" "$TEST_TMP/mdelta.actual" > "$TEST_TMP/mdelta.diff" || fail "matrix-fbatch differs from matrix-bpack by more or less than the pinned delta: $(cat "$TEST_TMP/mdelta.diff")"
sed 's/^REP_FROM=1; /REP_FROM=1; EXTRA=1; /' "$BASE/run-skill-onoff-matrix-fbatch.sh" > "$TEST_TMP/mmutant.sh"
mdelta "$TEST_TMP/mmutant.sh" > "$TEST_TMP/mm.out"
! diff -q "$TEST_TMP/mdelta.expected" "$TEST_TMP/mm.out" > /dev/null || fail "the matrix delta pin did not notice a changed line"
grep -q 'run-skill-onoff-eval-fbatch.sh' "$BASE/run-skill-onoff-matrix-fbatch.sh" || fail "matrix-fbatch does not call eval-fbatch"
[ -x "$BASE/run-skill-onoff-eval-fbatch.sh" ] || fail "eval-fbatch is not executable"

echo "=== eval-fbatch differs from eval-bpack by exactly the pinned delta ==="
code_delta() { diff -U0 <(grep -v '^[[:space:]]*#' "$BASE/run-skill-onoff-eval-bpack.sh") <(grep -v '^[[:space:]]*#' "$1") | sed '1,2d' | grep -E '^[+-]' || true; }
cat > "$TEST_TMP/delta.expected" << 'DELTA'
+BUDGET_USD=""; BUDGET_EXHAUSTED=0; CELL_TMPDIR=""; COST_UNKNOWN=0
+if [ -n "${ONOFF_MAX_BUDGET_USD:-}" ]; then
+  [[ "$ONOFF_MAX_BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]] && [ -n "${ONOFF_MAX_BUDGET_USD//[0.]/}" ] || { echo "ERROR: ONOFF_MAX_BUDGET_USD must be a positive number: $ONOFF_MAX_BUDGET_USD" >&2; exit 2; }
+  BUDGET_USD="$ONOFF_MAX_BUDGET_USD"
+fi
+if [ "${ONOFF_CELL_TMPDIR:-0}" = 1 ]; then CELL_TMPDIR="$SCRATCH_HOME/tmp"; mkdir -p "$CELL_TMPDIR"; fi
+turn_cost() { # $1 one turn's transcript -> its spend in USD, or "unknown" unless a result event carries a finite total_cost_usd >= 0
+  node -e '
+    let sum=0,n=0,bad=0;
+    try{for(const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n")){
+      let j;try{j=JSON.parse(l)}catch{continue}
+      if(j&&j.type==="result"){n++;if(typeof j.total_cost_usd==="number"&&Number.isFinite(j.total_cost_usd)&&j.total_cost_usd>=0)sum+=j.total_cost_usd;else bad++}
+    }}catch{}
+    process.stdout.write(n>0&&bad===0?sum.toFixed(6):"unknown");
+  ' "$1"
+}
-  local prompt="$1" dest="$2" turn_n="$3" resume="${4:-}"
+  local prompt="$1" dest="$2" turn_n="$3" resume="${4:-}" budget="${5:-}"
+  local budget_args=()
+  [ -z "$budget" ] || budget_args=(--max-budget-usd "$budget")
+      [ -z "$CELL_TMPDIR" ] || export TMPDIR="$CELL_TMPDIR"
+          "${budget_args[@]+"${budget_args[@]}"}" \
+          "${budget_args[@]+"${budget_args[@]}"}" \
-  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 ""
+  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 "" "$BUDGET_USD"
+  [ -z "$BUDGET_USD" ] || { TURN1_COST=$(turn_cost "$TRANSCRIPT"); [ "$TURN1_COST" != unknown ] || COST_UNKNOWN=1; }
+      BUDGET_TURN2=""
+      if [ -n "$BUDGET_USD" ] && [ "$COST_UNKNOWN" -eq 0 ]; then
+        BUDGET_TURN2=$(node -e 'process.stdout.write(Math.max(0,Number(process.argv[1])-Number(process.argv[2])).toFixed(6))' "$BUDGET_USD" "$TURN1_COST")
+      fi
+      elif [ "$COST_UNKNOWN" -eq 1 ]; then
+        :  # turn 1's spend is unknown: no second turn, the campaign charges the whole cell ceiling
+      elif [ -n "$BUDGET_USD" ] && [ -z "${BUDGET_TURN2//[0.]/}" ]; then
+        BUDGET_EXHAUSTED=1
-        run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 "$SESSION_ID"
+        run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 "$SESSION_ID" "$BUDGET_TURN2"
+        [ -z "$BUDGET_USD" ] || [ "$(turn_cost "$TURN2_FILE")" != unknown ] || COST_UNKNOWN=1
+elif [ "$BUDGET_EXHAUSTED" -eq 1 ] || { [ -n "$BUDGET_USD" ] && grep -Eq '"subtype": ?"error_max_budget' "$TRANSCRIPT"; }; then
+  failure_class='"infra_fail"'; failure_cause='"budget_exceeded"'
+elif [ "$COST_UNKNOWN" -eq 1 ]; then
+  failure_class='"infra_fail"'; failure_cause='"cost_unknown"'
+[ "$COST_UNKNOWN" -eq 0 ] || ARM_SHA_FIELD="$ARM_SHA_FIELD,\"cost_unknown\":true"
DELTA
code_delta "$BASE/run-skill-onoff-eval-fbatch.sh" > "$TEST_TMP/delta.actual"
diff "$TEST_TMP/delta.expected" "$TEST_TMP/delta.actual" > "$TEST_TMP/delta.diff" || fail "eval-fbatch code differs from eval-bpack by more or less than the pinned delta: $(cat "$TEST_TMP/delta.diff")"

echo "=== negative control: one extra code line is red ==="
sed 's/^BUDGET_USD=""; /BUDGET_USD=""; EXTRA_LINE=1; /' "$BASE/run-skill-onoff-eval-fbatch.sh" > "$TEST_TMP/mutant1.sh"
code_delta "$TEST_TMP/mutant1.sh" > "$TEST_TMP/m1.out"
! diff -q "$TEST_TMP/delta.expected" "$TEST_TMP/m1.out" > /dev/null || fail "the delta pin did not notice a changed code line"
echo "=== negative control: a runner that no longer passes --max-budget-usd is red ==="
grep -v '^          "\${budget_args\[@\]+"\${budget_args\[@\]}"}" \\$' "$BASE/run-skill-onoff-eval-fbatch.sh" > "$TEST_TMP/mutant2.sh"
code_delta "$TEST_TMP/mutant2.sh" > "$TEST_TMP/m2.out"
! diff -q "$TEST_TMP/delta.expected" "$TEST_TMP/m2.out" > /dev/null || fail "the delta pin did not notice the dropped budget flag"
echo "=== frozen runners stay untouched (digest rows keep checking ok) ==="
node "$BASE/stamp-prereg.js" --row bpack --check > /dev/null || fail "bpack frozen row no longer checks ok"
echo "PASS: skill-onoff fbatch runner pin"
