#!/usr/bin/env bash
# Retirement receipts: a removal from a governed path must carry evidence.
# The suite's job is to prove the gate FIRES, not merely that it runs — a checker that
# always reports zero removals would pass a naive suite while protecting nothing, which is
# the exact failure this repo filed a backlog entry about.
. "$(dirname "$0")/lib.sh"

CHECKER="$REPO_ROOT/scripts/check-retirement-receipts.js"
RECEIPTS_DIR="$REPO_ROOT/docs/retirement-receipts"
# A real historical commit that removed five governed shell scripts.
DEL_COMMIT="288bf5ce"
PLANTED=()

cleanup_planted() {
  for file in "${PLANTED[@]}"; do rm -f "$file"; done
}
trap cleanup_planted EXIT

plant_receipt() {
  local slug="$1" removed="$2" evidence="$3"
  local file="$RECEIPTS_DIR/zz-test-${slug}.json"
  cat > "$file" <<JSON
{
  "removed": "$removed",
  "replaced_by": "scripts/tree.js",
  "evidence": "$evidence",
  "commit": "$DEL_COMMIT",
  "reason": "planted by hooks/tests/check-retirement-receipts.test.sh"
}
JSON
  PLANTED+=("$file")
}

# --- 1. the gate detects real removals (non-vacuity) -----------------------------
OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" 2>&1)"
assert_contains "$OUT" "governed removals examined: 5" "checker must see the five governed removals in the range"
assert_contains "$OUT" "UNRECEIPTED" "unreceipted removals must be reported"

node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" --check >/dev/null 2>&1
assert_eq "$?" "1" "--check must exit non-zero when a governed removal is unreceipted"

# --- 2. without --check it reports but does not fail the build -------------------
node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" >/dev/null 2>&1
assert_eq "$?" "0" "reporting mode must not exit non-zero"

# --- 3. a valid receipt clears exactly its own removal ---------------------------
plant_receipt "tree" "scripts/tree.sh" "hooks/tests/check-retirement-receipts.test.sh"
OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" 2>&1)"
assert_contains "$OUT" "✓ scripts/tree.sh — RECEIPTED" "a receipted removal must clear"
assert_contains "$OUT" "✗ scripts/qc-panel.sh — UNRECEIPTED" "other removals must still be flagged"
node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" --check >/dev/null 2>&1
assert_eq "$?" "1" "one receipt must not clear the remaining unreceipted removals"

# --- 4. receipt naming evidence that does not exist is refused -------------------
plant_receipt "ghost" "scripts/qc-panel.sh" "hooks/tests/this-test-does-not-exist.test.sh"
OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" 2>&1)"
assert_contains "$OUT" "INVALID_EVIDENCE" "a receipt whose evidence is missing must be refused"
assert_contains "$OUT" "named evidence does not exist" "the reason must name the actual problem"

# --- 5. a malformed receipt is refused, not ignored ------------------------------
BAD="$RECEIPTS_DIR/zz-test-malformed.json"
printf '{ "removed": "scripts/risk-counter.sh", "reason": "no evidence field" }\n' > "$BAD"
PLANTED+=("$BAD")
OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" 2>&1)"
assert_contains "$OUT" "missing required field" "a receipt missing required fields must be reported"
node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" --check >/dev/null 2>&1
assert_eq "$?" "1" "a malformed receipt must fail --check even if every removal is otherwise covered"
rm -f "$BAD"

# --- 6. unparseable JSON is refused ----------------------------------------------
BROKEN="$RECEIPTS_DIR/zz-test-broken.json"
printf '{ this is not json\n' > "$BROKEN"
PLANTED+=("$BROKEN")
OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" 2>&1)"
assert_contains "$OUT" "unparseable JSON" "an unparseable receipt must be reported, never skipped"
rm -f "$BROKEN"

# --- 7. current regime range is clean and stays exit 0 ---------------------------
node "$CHECKER" --check >/dev/null 2>&1
assert_eq "$?" "0" "the live regime range must be clean"

# --- 8. JSON output is well-formed and carries the schema ------------------------
JSON_OUT="$(node "$CHECKER" --base "${DEL_COMMIT}~1" --head "$DEL_COMMIT" --json 2>/dev/null)"
SCHEMA="$(printf '%s' "$JSON_OUT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.schema_version+'|'+o.removals_examined+'|'+o.ok)})")"
assert_eq "$SCHEMA" "1|5|false" "JSON report must carry schema_version, removal count, and ok=false"

# --- 9. non-governed and mirror paths need no receipt ----------------------------
# A commit touching only docs/ must produce zero governed removals.
OUT="$(node "$CHECKER" --base HEAD~1 --head HEAD --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const o=JSON.parse(d);console.log(o.findings.filter(f=>f.removed.startsWith('platforms/codex/plugin/')).length)})")"
assert_eq "$OUT" "0" "generated codex mirrors must never require their own receipt"

cleanup_planted
finalize_test
