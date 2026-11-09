#!/usr/bin/env bash
# Plan review follows the code-review cross-family rule (PM ruling 01M6Z8D9YX): READY (and the Mode B receipt
# check) needs a reviewed seat outside Claude's family; consult via claude-native is labelled a same-family
# opinion and is never counted as a review seat.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-plan-review.js"
CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"
CONSULT="$REPO_ROOT/scripts/dispatch-consult.sh"
READY="$REPO_ROOT/hooks/tests/fixtures/plan-review/ready.json"
REPO="$TEST_TMP/repo"
STATE="$TEST_TMP/state"
PLAN="$REPO/plan.md"
RUBRIC="$REPO/rubric.md"
mkdir -p "$REPO"
git -C "$REPO" init -q
printf '%s\n' '# Plan' 'Build the next vertical slice.' >"$PLAN"
printf '%s\n' '# Rubric' '- R1: next-slice readiness' >"$RUBRIC"

json_field() {
  node -e '
let v = JSON.parse(process.argv[1]);
for (const p of process.argv[2].split(".")) { if (v === null || typeof v !== "object" || !(p in v)) process.exit(2); v = v[p]; }
process.stdout.write(typeof v === "string" ? v : JSON.stringify(v));' "$1" "$2"
}

# run_plan <ticket> <deep runner> <deep model> [extra flags...]; the chair seat is always claude-native.
run_plan() {
  local ticket="$1" drunner="$2" dmodel="$3"; shift 3
  AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS=1 \
  AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE="$READY" AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE="$READY" \
    node "$SCRIPT" --repo-root "$REPO" --plan-file "$PLAN" --rubric-file "$RUBRIC" \
      --ticket "$ticket" --session-id "$ticket" --generation 1 --allow-unregistered --no-topology-fallbacks \
      --runner claude-native --model claude-fixture-1 --effort high \
      --deep-runner "$drunner" --deep-model "$dmodel" --deep-effort high \
      --state-dir "$STATE" "$@" 2>"$TEST_TMP/$ticket.err"
}

# Mode B receipt check on an artifact held in a variable.
check_artifact() {
  local name="$1" artifact="$2"
  printf '%s\n' "$artifact" >"$TEST_TMP/$name.artifact.json"
  node -e '
const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
require("fs").writeFileSync(process.argv[2], JSON.stringify({ logical_plan_id: a.logical_plan_id, generation: a.generation, findings: [] }));' \
    "$TEST_TMP/$name.artifact.json" "$TEST_TMP/$name.disp.json"
  node "$CHECKER" --plan-artifact "$TEST_TMP/$name.artifact.json" --dispositions "$TEST_TMP/$name.disp.json" \
    --plan-file "$PLAN" --rubric-file "$RUBRIC" 2>&1
}

# 1. Claude-only reviewed seats: READY is downgraded, receipt check fails
OUT="$(run_plan claude-only claude-native claude-fixture-2)"; EXIT=$?
assert_exit_code "$EXIT" "0" "claude-only panel still completes"
assert_eq "$(json_field "$OUT" verdict)" "CONDITIONAL" "claude-only reviewed seats: verdict is CONDITIONAL, not READY"
assert_eq "$(json_field "$OUT" policy_reason)" "no_cross_family_seat" "claude-only: reason is no_cross_family_seat"
assert_eq "$(json_field "$OUT" terminal)" "true" "claude-only: downgrade is terminal"
assert_contains "$(cat "$TEST_TMP/claude-only.err")" "no_cross_family_seat" "claude-only: stderr names the rule"
CLAUDE_ONLY_ARTIFACT="$OUT"
RC_OUT="$(check_artifact claude-only "$CLAUDE_ONLY_ARTIFACT")"; RC=$?
assert_exit_code "$RC" "1" "claude-only: receipt check fails"
assert_contains "$RC_OUT" "Cross-family rule" "claude-only: receipt failure names the rule"

# 2. One non-Claude reviewed seat: passes as before
OUT="$(run_plan mixed codex gpt-fixture)"; EXIT=$?
assert_exit_code "$EXIT" "0" "mixed panel completes"
assert_eq "$(json_field "$OUT" verdict)" "READY" "one non-Claude reviewed seat: READY"
assert_eq "$(json_field "$OUT" policy_reason)" "no_accepted_blockers" "mixed: reason unchanged"
RC_OUT="$(check_artifact mixed "$OUT")"; RC=$?
assert_exit_code "$RC" "0" "mixed: receipt check passes ($RC_OUT)"

# 3. Exception: sourced passes and is recorded; unsourced is red
OUT="$(run_plan exc-card claude-native claude-fixture-2 --same-family-exception 'd-0123abcd: operator accepted a Claude-only plan review')"; EXIT=$?
assert_exit_code "$EXIT" "0" "exception with a card id completes"
assert_eq "$(json_field "$OUT" verdict)" "READY" "exception with a card id: READY"
assert_eq "$(json_field "$OUT" same_family_exception.source)" "d-0123abcd" "exception source recorded in the artifact"
RC_OUT="$(check_artifact exc-card "$OUT")"; RC=$?
assert_exit_code "$RC" "0" "exception with a card id: receipt check passes ($RC_OUT)"

OUT="$(run_plan exc-none claude-native claude-fixture-2 --same-family-exception 'just because' 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "exception without a source is refused"
assert_contains "$OUT$(cat "$TEST_TMP/exc-none.err")" "same-family-exception" "exception without a source: message names the flag"
OUT="$(run_plan exc-bad claude-native claude-fixture-2 --same-family-exception 'nope: some reason' 2>&1)"; EXIT=$?
assert_exit_code "$EXIT" "2" "exception with an invalid source is refused"

# a hand-forged artifact claiming READY with Claude-only seats and no exception is red in the receipt check
FORGED="$(node -e '
const a = JSON.parse(process.argv[1]); a.verdict = "READY"; a.semantic_verdict = "READY"; a.policy_reason = "no_accepted_blockers";
process.stdout.write(JSON.stringify(a));' "$CLAUDE_ONLY_ARTIFACT")"
RC_OUT="$(check_artifact forged "$FORGED")"; RC=$?
assert_exit_code "$RC" "1" "forged READY with Claude-only seats: receipt check fails"

# 4. Consult via claude-native: marked same-family; a consult result is never a review seat
Q="$TEST_TMP/question.txt"; ART="$TEST_TMP/artifact.diff"
printf 'is the helper needed?\n' >"$Q"; printf 'diff --git a/x b/x\n+line\n' >"$ART"
CFG="$TEST_TMP/native.md"
printf -- '- override: consult | until 2099-01-01 | test fixture seat\n- consult_engine: sonnet\n- consult_runner: claude-native\n- consult_effort: high\n- consult_dispatch: on\n' >"$CFG"
OVR="$TEST_TMP/override.json"
cat >"$OVR" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"sonnet","runner":"claude-native","role":"consult","reason":"plan-review-family-gate.test.sh fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON
RESP="$TEST_TMP/consult-response.json"
cat >"$RESP" <<'JSON'
{ "answer": { "label": "insufficient_evidence", "artifact_ref": null },
  "aside": [],
  "authority": { "refused": true, "reference": "qc@depth-0" } }
JSON
BIN="$TEST_TMP/author.sh"
cat >"$BIN" <<SH
#!/usr/bin/env bash
printf '{ "runner": "claude-native", "model": "sonnet", "status": "authored", "raw_log": "$RESP", "error": null, "selection_source": "explicit_cli", "selection_path": null, "verification_author": null }\n'
exit 0
SH
chmod +x "$BIN"
C_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR" "$CONSULT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$BIN" 2>"$TEST_TMP/consult.err")"; C_EXIT=$?
assert_eq "$C_EXIT" "0" "claude-native consult advises"
assert_eq "$(json_field "$C_OUT" same_family_opinion)" "true" "claude-native consult: same_family_opinion true in the JSON result"
assert_contains "$(head -n 1 "$TEST_TMP/consult.err")" "同家族意見" "claude-native consult: first-line text label"

# a non-Claude consult seat is not labelled
CFG2="$TEST_TMP/codex.md"; OVR2="$TEST_TMP/override2.json"
printf -- '- override: consult | until 2099-01-01 | test fixture seat\n- consult_engine: gpt-5.6\n- consult_runner: codex\n- consult_effort: high\n- consult_dispatch: on\n' >"$CFG2"
cat >"$OVR2" <<'JSON'
{"schema":1,"overrides":[
  {"engine":"gpt-5.6","runner":"codex","role":"consult","reason":"fixture","operator":"cookys","expires":"2099-01-01"}
]}
JSON
C2_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG2" AUTOPILOT_QUALIFICATION_OVERRIDE="$OVR2" "$CONSULT" --question-file "$Q" --artifact "$ART" --dispatch-author-bin "$BIN" 2>/dev/null)"
assert_eq "$(json_field "$C2_OUT" same_family_opinion)" "false" "codex consult: same_family_opinion false"

# the consult result fed where a review seat is counted is recognised and refused, not counted
node -e '
const g = require(process.argv[1]);
const consult = JSON.parse(process.argv[2]);
const asSeat = { ...consult, status: "reviewed" };
process.stdout.write(JSON.stringify([g.isConsultResult(consult), g.isConsultResult(asSeat), g.isConsultResult({ status: "reviewed", verdict: "SHIP-AS-IS" })]));' \
  "$REPO_ROOT/scripts/lib/review-family-gate.js" "$C_OUT" >"$TEST_TMP/isconsult.json"
assert_eq "$(cat "$TEST_TMP/isconsult.json")" "[true,true,false]" "consult result is never a review seat; a real review seat is not flagged"

finalize_test
