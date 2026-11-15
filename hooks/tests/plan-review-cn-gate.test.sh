#!/usr/bin/env bash
# Plan review goes through the Chinese-model dispatch gate with role plan_review (01M7E2A1, d-1dfcf757):
# a plan is novel work, so a barred-family seat is skipped before anything spawns, stderr names it, exit 2.
# Negative control: the clean (non-Chinese) panel in the same harness is unchanged (exit 0).
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
READY="$REPO_ROOT/hooks/tests/fixtures/plan-review/ready.json"
REPO="$TEST_TMP/repo"; STATE="$TEST_TMP/state"; PLAN="$REPO/plan.md"; RUBRIC="$REPO/rubric.md"
mkdir -p "$REPO" "$TEST_TMP/sent"
git -C "$REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' >"$RUBRIC"
# sentinel runners: any spawn is recorded here
RECORD="$TEST_TMP/spawned.txt"; : >"$RECORD"
for b in kimi codex grok agy claude cursor opencode; do
  printf '#!/bin/sh\necho "%s $*" >> "%s"\nexit 99\n' "$b" "$RECORD" >"$TEST_TMP/sent/$b"; chmod +x "$TEST_TMP/sent/$b"
done

run_plan() {
  local ticket="$1" drunner="$2" dmodel="$3"; shift 3
  PATH="$TEST_TMP/sent:$PATH" AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$READY" AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE="$READY" \
    node "$SCRIPT" --repo-root "$REPO" --plan-file "$PLAN" --rubric-file "$RUBRIC" \
      --ticket "$ticket" --session-id "$ticket" --generation 1 --allow-unregistered --no-topology-fallbacks \
      --runner claude-native --model claude-fixture-1 --effort high \
      --deep-runner "$drunner" --deep-model "$dmodel" --deep-effort high \
      --state-dir "$STATE" "$@" 2>"$TEST_TMP/$ticket.err" >"$TEST_TMP/$ticket.out"
}

run_plan cn-panel kimi kimi-code/kimi-for-coding; EXIT=$?
assert_exit_code "$EXIT" "2" "panel with a Chinese-family seat exits 2"
assert_contains "$(cat "$TEST_TMP/cn-panel.err")" "cn_model_dispatch_barred moonshot novel" "stderr names family and the novel class"
assert_contains "$(cat "$TEST_TMP/cn-panel.err")" "kimi/kimi-code/kimi-for-coding" "stderr names the seat's runner/model"
assert_eq "$(cat "$RECORD")" "" "the barred seat's runner was never spawned"

# an operator-style env claiming a non-novel implementer task cannot widen the gate for a plan review
AUTOPILOT_TASK_SIZE=S AUTOPILOT_TASK_ROLE=implementer AUTOPILOT_TASK_SCOPE=docs/a.md \
  run_plan cn-env kimi kimi-code/kimi-for-coding; EXIT=$?
assert_exit_code "$EXIT" "2" "env claiming S/implementer still refused for plan review"

run_plan clean claude-native claude-fixture-2 >/dev/null; EXIT=$?
assert_exit_code "$EXIT" "0" "panel without a Chinese-family seat is unchanged"
assert_eq "$(grep -c cn_model_dispatch_barred "$TEST_TMP/clean.err")" "0" "clean panel prints no gate line"

finalize_test
