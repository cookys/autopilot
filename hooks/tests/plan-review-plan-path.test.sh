#!/usr/bin/env bash
# dispatch-plan-review --plan-file resolves against --repo-root; --expect-revision; blob provenance.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/plan-review"
STATE_DIR="$TEST_TMP/state"
MAIN="$TEST_TMP/main"; WT="$TEST_TMP/wt"
MANIFEST="$TEST_TMP/manifest.json"
mkdir -p "$MAIN" "$WT" "$STATE_DIR"
for r in "$MAIN" "$WT"; do
  git -C "$r" init -q
  printf '# Rubric\n- R1: next-slice readiness\n' >"$r/rubric.md"
done
printf '# Plan OLD\nold text\n' >"$MAIN/plan.md"
printf '# Plan NEW\nnew text\n' >"$WT/plan.md"
git -C "$WT" add -A
git -C "$WT" -c user.name=t -c user.email=none commit -q -m base
OLD_SHA="$(git -C "$MAIN" hash-object plan.md)"
NEW_SHA="$(git -C "$WT" hash-object plan.md)"
cat >"$MANIFEST" <<'JSON'
{
  "schema_version": 1, "artifact_type": "plan_review_manifest",
  "logical_plan_id": "pp-plan", "minimum_distinct_families": 1,
  "max_attempts_per_seat": 2,
  "seats": [{
    "id": "architect", "runner": "claude-native", "model": "claude-fixture",
    "effort": "high", "endpoint": "default", "role": "architecture",
    "family": "anthropic", "readiness_status": "ready",
    "qualification_status": "qualified", "required": true,
    "excluded_families": [], "fallbacks": []
  }]
}
JSON

# Replays the incident: cwd is the OTHER checkout, plan path relative, --repo-root is the worktree.
run_pp() {
  local ticket="$1"; shift
  sed "s/pp-plan/pp-$ticket/" "$MANIFEST" >"$TEST_TMP/m-$ticket.json"
  (cd "$MAIN" && AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
   AUTOPILOT_PLAN_REVIEW_RESPONSE_SEQUENCE="{\"architect\":[\"$FIXTURES/ready.json\"]}" \
    node "$SCRIPT" --repo-root "$WT" --plan-file plan.md --rubric-file "$WT/rubric.md" \
      --ticket "$ticket" --session-id "s-$ticket" --generation 1 --manifest-file "$TEST_TMP/m-$ticket.json" \
      --state-dir "$STATE_DIR" --allow-unregistered "$@" 2>&1) </dev/null
}
plan_sha_in() { grep -rho '"plan_sha256": *"[0-9a-f]*"' "$STATE_DIR"/*/ 2>/dev/null | head -1 | grep -o '[0-9a-f]\{64\}'; }

OUT="$(run_pp t-resolve)"; RC=$?
assert_exit_code "$RC" "0" "relative plan reviews: $OUT"
assert_contains "$OUT" "also exists under the cwd with different content" "cwd twin warning"
WANT="$(sha256sum "$WT/plan.md" | cut -d' ' -f1)"
assert_eq "$(plan_sha_in)" "$WANT" "reviewed bytes are the --repo-root copy, not the cwd copy"
assert_contains "$(cat "$STATE_DIR"/*/*.json)" "$NEW_SHA" "artifact records the git blob sha"
assert_contains "$(cat "$STATE_DIR"/*/*.json)" '"plan_dirty_vs_head": false' "artifact records dirty flag"

# --expect-revision: matching revision passes, mismatching one is refused with 0 seats.
OUT="$(run_pp t-rev-ok --expect-revision HEAD 2>&1)"; RC=$?
assert_exit_code "$RC" "0" "expect-revision HEAD accepted: $OUT"
printf 'dirty edit\n' >>"$WT/plan.md"
OUT="$(run_pp t-rev-bad --expect-revision HEAD)"; RC=$?
assert_exit_code "$RC" "2" "dirty plan vs HEAD refused"
assert_contains "$OUT" "plan blob sha mismatch" "mismatch message"
assert_contains "$OUT" "0 seats dispatched" "no seat dispatched"
git -C "$WT" checkout -q -- plan.md

# Outside --repo-root is refused.
printf '# outside\n' >"$TEST_TMP/outside.md"
OUTABS="$(cd "$MAIN" && node "$SCRIPT" --repo-root "$WT" --plan-file "$TEST_TMP/outside.md" --rubric-file "$WT/rubric.md" --ticket t-abs --session-id s-abs --generation 1 --manifest-file "$MANIFEST" --state-dir "$STATE_DIR" --allow-unregistered --expect-revision HEAD 2>&1 </dev/null)"; RC=$?
assert_exit_code "$RC" "2" "expect-revision with plan outside repo refused"
assert_contains "$OUTABS" "needs a --plan-file inside" "expect-revision outside message"
OUT="$(cd "$MAIN" && node "$SCRIPT" --repo-root "$WT" --plan-file ../outside.md --rubric-file "$WT/rubric.md" --ticket t-out --session-id s-out --generation 1 --manifest-file "$MANIFEST" --state-dir "$STATE_DIR" --allow-unregistered 2>&1 </dev/null)"; RC=$?
assert_exit_code "$RC" "2" "relative plan escaping repo-root refused"
assert_contains "$OUT" "must be inside --repo-root" "outside message"

finalize_test
