#!/usr/bin/env bash
# hooks/tests/skill-onoff-fbatch-runner.test.sh — the findings-batch cell runner is a pinned copy of the bpack runner.
# bpack (and gdorm) are digest-frozen and have live results, so they never change. run-skill-onoff-eval-fbatch.sh /
# run-skill-onoff-matrix-fbatch.sh are copies with exactly one code delta on the eval runner: ONOFF_MAX_BUDGET_USD (hard
# per-cell spend cap handed to every `claude -p` as --max-budget-usd, turn 2 gets what turn 1 left, a budget stop is
# infra_fail/budget_exceeded) and ONOFF_CELL_TMPDIR=1 (the agent's TMPDIR is a dir inside the scratch HOME). Both opt-in.
# The delta is pinned line for line: any other code difference, or an edit of these lines, is red. Negative control: a
# mutant with one extra line, and a mutant that no longer passes the budget flag, are both red.
set -uo pipefail
. "$(dirname "$0")/lib.sh"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BASE="$REPO_ROOT/evals/skill-onoff"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "=== matrix-fbatch differs from matrix-bpack only in names ==="
diff <(sed 's/bpack/fbatch/g' "$BASE/run-skill-onoff-matrix-bpack.sh") "$BASE/run-skill-onoff-matrix-fbatch.sh" > /dev/null || fail "matrix-fbatch drifted from matrix-bpack"
grep -q 'run-skill-onoff-eval-fbatch.sh' "$BASE/run-skill-onoff-matrix-fbatch.sh" || fail "matrix-fbatch does not call eval-fbatch"
[ -x "$BASE/run-skill-onoff-eval-fbatch.sh" ] || fail "eval-fbatch is not executable"

echo "=== eval-fbatch differs from eval-bpack by exactly the pinned delta ==="
code_delta() { diff -U0 <(grep -v '^[[:space:]]*#' "$BASE/run-skill-onoff-eval-bpack.sh") <(grep -v '^[[:space:]]*#' "$1") | sed '1,2d' | grep -E '^[+-]' || true; }
cat > "$TEST_TMP/delta.expected" << 'DELTA'
+BUDGET_USD=""; BUDGET_EXHAUSTED=0; CELL_TMPDIR=""
+if [ -n "${ONOFF_MAX_BUDGET_USD:-}" ]; then
+  [[ "$ONOFF_MAX_BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]] && [ -n "${ONOFF_MAX_BUDGET_USD//[0.]/}" ] || { echo "ERROR: ONOFF_MAX_BUDGET_USD must be a positive number: $ONOFF_MAX_BUDGET_USD" >&2; exit 2; }
+  BUDGET_USD="$ONOFF_MAX_BUDGET_USD"
+fi
+if [ "${ONOFF_CELL_TMPDIR:-0}" = 1 ]; then CELL_TMPDIR="$SCRATCH_HOME/tmp"; mkdir -p "$CELL_TMPDIR"; fi
-  local prompt="$1" dest="$2" turn_n="$3" resume="${4:-}"
+  local prompt="$1" dest="$2" turn_n="$3" resume="${4:-}" budget="${5:-}"
+  local budget_args=()
+  [ -z "$budget" ] || budget_args=(--max-budget-usd "$budget")
+      [ -z "$CELL_TMPDIR" ] || export TMPDIR="$CELL_TMPDIR"
+          "${budget_args[@]+"${budget_args[@]}"}" \
+          "${budget_args[@]+"${budget_args[@]}"}" \
-  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 ""
+  run_model_turn "$PROMPT_FILE" "$TRANSCRIPT" 1 "" "$BUDGET_USD"
+      BUDGET_TURN2=""
+      if [ -n "$BUDGET_USD" ]; then
+        BUDGET_TURN2=$(node -e '
+          let spent=0;
+          try{for(const l of require("fs").readFileSync(process.argv[1],"utf8").split("\n")){
+            let j;try{j=JSON.parse(l)}catch{continue}
+            if(j&&j.type==="result"&&typeof j.total_cost_usd==="number"&&j.total_cost_usd>0) spent+=j.total_cost_usd;
+          }}catch{}
+          process.stdout.write(Math.max(0,Number(process.argv[2])-spent).toFixed(6));
+        ' "$TURN1_FILE" "$BUDGET_USD")
+      fi
+      elif [ -n "$BUDGET_USD" ] && [ -z "${BUDGET_TURN2//[0.]/}" ]; then
+        BUDGET_EXHAUSTED=1
-        run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 "$SESSION_ID"
+        run_model_turn "$TURN2_PROMPT" "$TURN2_FILE" 2 "$SESSION_ID" "$BUDGET_TURN2"
+elif [ "$BUDGET_EXHAUSTED" -eq 1 ] || { [ -n "$BUDGET_USD" ] && grep -Eq '"subtype": ?"error_max_budget' "$TRANSCRIPT"; }; then
+  failure_class='"infra_fail"'; failure_cause='"budget_exceeded"'
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
