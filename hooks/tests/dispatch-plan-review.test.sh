#!/usr/bin/env bash
# Bounded plan-review controller: durable identity, frozen rubric and stop-loss.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
PLAN_REPO="$TEST_TMP/repo"
STATE_DIR="$TEST_TMP/state"
PLAN_FILE="$PLAN_REPO/plan.md"
RUBRIC_FILE="$PLAN_REPO/rubric.md"
READY_RESPONSE="$TEST_TMP/ready.json"
BLOCK_RESPONSE="$TEST_TMP/block.json"
SCOPE_RESPONSE="$TEST_TMP/scope.json"
SCHEDULE_RESPONSE="$TEST_TMP/schedule.json"

mkdir -p "$PLAN_REPO"
git -C "$PLAN_REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' > "$PLAN_FILE"
printf '%s\n' '# Frozen rubric' '- R1: next-slice readiness' '- R2: immediate integrity' > "$RUBRIC_FILE"
printf '%s\n' '{"verdict":"READY","findings":[]}' > "$READY_RESPONSE"
printf '%s\n' \
  '{"verdict":"STOP","findings":[{"rubric_id":"R1","class":"decision-now","severity":"blocking","evidence":"section 2 omits the required boundary","repair":"state the boundary","blocks_next_slice_or_immediate_integrity":true,"cannot_defer_to_spike":true}]}' \
  > "$BLOCK_RESPONSE"
printf '%s\n' \
  '{"verdict":"STOP","findings":[{"rubric_id":"R999","class":"decision-now","severity":"blocking","evidence":"invented requirement","repair":"expand the plan","blocks_next_slice_or_immediate_integrity":true,"cannot_defer_to_spike":true}]}' \
  > "$SCOPE_RESPONSE"
printf '%s\n' '{"verdict":"READY","findings":[],"next_generation":3}' > "$SCHEDULE_RESPONSE"

json_field() {
  node -e '
let value = JSON.parse(process.argv[1]);
for (const part of process.argv[2].split(".")) {
  if (value === null || typeof value !== "object" || !(part in value)) process.exit(2);
  value = value[part];
}
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
' "$1" "$2"
}

run_review() {
  local ticket="$1" session_id="$2" generation="$3" response="$4"
  local runner="${5:-claude-native}" model="${6:-claude-fable-5}" now="${7:-}"
  local now_args=()
  [[ -z "$now" ]] || now_args=(--now "$now")
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$response" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" \
      --plan-file "$PLAN_FILE" \
      --rubric-file "$RUBRIC_FILE" \
      --ticket "$ticket" \
      --session-id "$session_id" \
      --generation "$generation" \
      --runner "$runner" \
      --model "$model" \
      --state-dir "$STATE_DIR" \
      "${now_args[@]}"
}

run_panel() {
  local ticket="$1" chair_response="$2" deep_response="$3"
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$chair_response" \
  AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE="$deep_response" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" \
      --plan-file "$PLAN_FILE" \
      --rubric-file "$RUBRIC_FILE" \
      --ticket "$ticket" \
      --session-id panel-session \
      --generation 1 \
      --runner claude-native \
      --model claude-fable-5 \
      --effort high \
      --deep-runner codex \
      --deep-model gpt-5.6-sol \
      --deep-effort max \
      --state-dir "$STATE_DIR"
}

# 1. A clean first generation is terminal READY.
OUT="$(run_review ready session-a 1 "$READY_RESPONSE")"; EXIT=$?
assert_eq "0" "$EXIT" "READY generation exits zero"
assert_eq "READY" "$(json_field "$OUT" verdict)" "READY verdict preserved"
assert_eq "true" "$(json_field "$OUT" terminal)" "READY result is terminal"
assert_eq "null" "$(json_field "$OUT" next_generation)" "terminal READY schedules no generation"

# 2. Chair + deep reviewer widen one generation; findings aggregate by union.
OUT="$(run_panel panel "$READY_RESPONSE" "$BLOCK_RESPONSE")"; EXIT=$?
assert_eq "0" "$EXIT" "two-seat generation returns a bounded result"
assert_eq "CONDITIONAL" "$(json_field "$OUT" verdict)" "deep-seat blocker cannot be out-voted by chair READY"
assert_eq "1" "$(json_field "$OUT" admitted_blocker_count)" "panel union admits the deep blocker"
assert_eq "deep" "$(json_field "$OUT" findings.0.reviewer_seat)" "finding preserves reviewer-seat provenance"
assert_eq "deep" "$(json_field "$OUT" reviewers.1.seat)" "transport provenance records deep seat in same generation"

# 3. Runner/model/session changes do not reset the repo+ticket generation budget.
OUT="$(run_review cap session-a 1 "$BLOCK_RESPONSE")"; EXIT=$?
assert_eq "0" "$EXIT" "generation 1 admitted blocker returns bounded CONDITIONAL"
assert_eq "CONDITIONAL" "$(json_field "$OUT" verdict)" "generation 1 blocker is conditional"
assert_eq "2" "$(json_field "$OUT" next_generation)" "generation 1 permits exactly generation 2"

OUT="$(run_review cap new-terminal 2 "$BLOCK_RESPONSE" codex gpt-5.6-sol)"; EXIT=$?
assert_eq "3" "$EXIT" "generation 2 with open blocker stops"
assert_eq "STOP" "$(json_field "$OUT" verdict)" "generation cap produces STOP"
assert_eq "generation_cap_with_open_blockers" "$(json_field "$OUT" policy_reason)" "generation cap reason is explicit"

OUT="$(run_review cap third-session 3 "$READY_RESPONSE" grok grok-4.5)"; EXIT=$?
assert_eq "3" "$EXIT" "generation 3 cannot acquire after runner/model/session change"
assert_contains "$(json_field "$OUT" policy_reason)" "terminal" "third generation reports durable terminal state"

CAP_KEY="$(json_field "$OUT" session_key)"
CAP_STATE="$STATE_DIR/$CAP_KEY/state.json"
assert_file_exists "$CAP_STATE" "durable state is stored by repo+ticket key"
assert_eq "2" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).claims.length)' "$CAP_STATE")" "only two generations were claimed"

# 4. Missing/unfrozen rubric IDs are scope expansion, never automatic repair.
OUT="$(run_review scope session-scope 1 "$SCOPE_RESPONSE")"; EXIT=$?
assert_eq "3" "$EXIT" "unfrozen rubric ID stops for human adjudication"
assert_eq "scope_expansion_requires_human_adjudication" "$(json_field "$OUT" policy_reason)" "scope expansion reason is explicit"
assert_eq "scope-expansion" "$(json_field "$OUT" findings.0.admission)" "finding is marked scope expansion"
assert_eq "false" "$(json_field "$OUT" findings.0.admitted_blocker)" "scope expansion is not admitted as blocker"

# 5. Reviewer prose/JSON cannot schedule another generation.
OUT="$(run_review scheduler session-scheduler 1 "$SCHEDULE_RESPONSE")"; EXIT=$?
assert_eq "4" "$EXIT" "reviewer-added scheduling field fails strict response contract"
assert_eq "reviewer_transport_or_response_failure" "$(json_field "$OUT" policy_reason)" "self-scheduling attempt terminates fail-closed"
assert_contains "$(json_field "$OUT" error)" "unsupported field" "self-scheduling field is diagnosed"

# 6. Plan growth >1.50x hard-stops before a second reviewer dispatch.
node -e 'require("fs").writeFileSync(process.argv[1], "x".repeat(100))' "$PLAN_FILE"
OUT="$(run_review growth session-growth 1 "$BLOCK_RESPONSE")"; EXIT=$?
assert_eq "0" "$EXIT" "growth fixture generation 1 is conditional"
node -e 'require("fs").writeFileSync(process.argv[1], "x".repeat(151))' "$PLAN_FILE"
OUT="$(run_review growth session-growth-2 2 "$READY_RESPONSE" codex gpt-5.6-sol)"; EXIT=$?
assert_eq "3" "$EXIT" "plan over 1.50x hard-stops"
assert_eq "plan_growth_hard_stop" "$(json_field "$OUT" policy_reason)" "growth stop reason is explicit"
assert_eq "1.51" "$(json_field "$OUT" growth_ratio)" "growth ratio uses frozen generation-1 baseline"

# 7. Exactly 1.25x warns but does not block a clean generation 2.
node -e 'require("fs").writeFileSync(process.argv[1], "y".repeat(100))' "$PLAN_FILE"
OUT="$(run_review warn session-warn 1 "$BLOCK_RESPONSE")"; EXIT=$?
assert_eq "0" "$EXIT" "warning fixture generation 1 is conditional"
node -e 'require("fs").writeFileSync(process.argv[1], "y".repeat(125))' "$PLAN_FILE"
OUT="$(run_review warn session-warn-2 2 "$READY_RESPONSE" codex gpt-5.6-sol)"; EXIT=$?
assert_eq "0" "$EXIT" "1.25x warning does not block clean review"
assert_eq "true" "$(json_field "$OUT" growth_warning)" "1.25x sets growth warning"
assert_eq "READY" "$(json_field "$OUT" verdict)" "clean warning-boundary result is READY"

# 8. The depth-0 wall clock is durable; a later terminal cannot reacquire.
node -e 'require("fs").writeFileSync(process.argv[1], "z".repeat(100))' "$PLAN_FILE"
OUT="$(run_review clock clock-a 1 "$BLOCK_RESPONSE" claude-native claude-fable-5 2026-01-01T00:00:00Z)"; EXIT=$?
assert_eq "0" "$EXIT" "clock fixture generation 1 is conditional"
OUT="$(run_review clock clock-b 2 "$READY_RESPONSE" codex gpt-5.6-sol 2026-01-01T02:00:01Z)"; EXIT=$?
assert_eq "3" "$EXIT" "wall-clock expiry blocks a new generation"
assert_eq "wall_clock_expired" "$(json_field "$OUT" policy_reason)" "wall-clock reason is explicit"

# 9. Callers cannot loosen the controller's hard ceilings.
OUT="$(
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$READY_RESPONSE" \
    node "$SCRIPT" \
      --repo-root "$PLAN_REPO" --plan-file "$PLAN_FILE" --rubric-file "$RUBRIC_FILE" \
      --ticket loose --session-id loose --generation 1 \
      --runner codex --model gpt-5.6-sol --state-dir "$STATE_DIR" \
      --max-generations 3 2>&1
)"
EXIT=$?
assert_eq "2" "$EXIT" "generation hard cap cannot be loosened"
assert_contains "$OUT" "cannot exceed hard cap 2" "loosened cap is diagnosed"

finalize_test
