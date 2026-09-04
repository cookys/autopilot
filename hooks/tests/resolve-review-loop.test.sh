#!/usr/bin/env bash
# resolve-review-loop.sh integration test — default roster, --field, enum
# fallback on garbage, and override precedence. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# Keep default-path assertions hermetic when the surrounding agent/session exports
# resolver overrides or live engine-state paths.
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-such-topology.json"

# Hermetic fixtures (roster-flip-proof). The autopilot repo ships a dogfood
# .claude/review-loop-config.md that the resolver reads by default (precedence
# slot 3). Its roster is a moving target — as of 2026-07-16 (Board decision A,
# while the codex pool is dead) the reviewer is MiniMax-M3 and the implementer is
# grok-4.5 (xai). Behavior/fixture cases below must NOT depend on that live roster:
# they pin their own configured reviewer/implementer identity so they exercise a
# KNOWN engine that matches their scorecard/capability fixtures on ANY machine.
#   EMPTY_CFG       — keyless override → resolver built-in defaults (reviewer gpt-5.5,
#                     implementer gpt-5.3-codex-spark @ openai → high-trust → low risk).
#   CODEX_IMPL_CFG  — pins the pre-Board-A openai/codex implementer so capability-state
#                     (§20) and density-scaling (§22–23) fixtures match by runner+model.
EMPTY_CFG="$TEST_TMP/empty-config.md"
: > "$EMPTY_CFG"
CODEX_IMPL_CFG="$TEST_TMP/impl-codex.md"
# allow_same_runner_dual_seat: this roster names implementer_runner codex and
# inherits the built-in reviewer default, which is ALSO codex — a real dual-seat
# collision under the runner-axis gate. Opting in (rather than diversifying the
# reviewer) keeps every other resolved value byte-identical, which matters because
# this fixture is about quota/capability telemetry, not decorrelation.
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n- allow_same_runner_dual_seat: on\n' > "$CODEX_IMPL_CFG"

json_get() { # json key -> raw json value
  local json="$1" key="$2"
  export JSON_VALUE="$json"
  node - "$key" <<'NODE'
const fs = require('fs');
const payload = process.env.JSON_VALUE || '';
const key = process.argv[2];
if (!payload) process.exit(0);
const parsed = JSON.parse(payload);
const value = parsed && parsed[key];
if (value === undefined) process.exit(0);
// Strings are returned RAW (unquoted) so assertions can compare to a bare value
// (e.g. assert_eq "unknown"); arrays/objects/numbers are JSON.stringify'd (e.g. "[]").
process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
NODE
  unset JSON_VALUE
}

# 1. --help exits 0
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "review-loop" "--help mentions review-loop"

# 2. unknown flag → exit 2
OUT="$(bash "$SCRIPT" --bogus x 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown flag exit code"

# 3. default JSON carries the repo's DOGFOOD roster + is parseable.
# DOGFOOD PIN (reads the live .claude/review-loop-config.md): as of 2026-07-16
# Board decision A the reviewer is MiniMax-M3 and the implementer is grok-4.5 (xai).
# 2026-07-21 seat refresh: Claude native quota is unavailable, and GLM review
# smoke is not enough to re-promote it to authoring, so verification author stays
# Gemini/agy until a full authoring re-drive passes.
# xai ∉ {openai,anthropic,google} ⇒ source-trust low ⇒ review_risk=high,
# required_review_families=2, l1_required=true — BY DESIGN (resolve-review-loop.sh
# §"Derive source trust"). Restore the gpt seats (reviewer gpt-5.5 / implementer
# gpt-5.3-codex-spark, low-risk baseline) after the codex pool resets ~2026-07-23.
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default exit code"
assert_contains "$OUT" '"reviewer_engine": "MiniMax-M3"' "default reviewer engine"
assert_contains "$OUT" '"implementer_engine": "grok-4.5"' "default implementer (grok, Board decision A)"
assert_contains "$OUT" '"verification_author_present": true' "default verification_author_present"
assert_contains "$OUT" '"verification_author_engine": "Qwen3.8-Max-Preview"' "default verification_author_engine"
assert_contains "$OUT" '"verification_author_runner": "qoderclicn"' "default verification_author_runner"
assert_contains "$OUT" '"verification_author_effort": "high"' "default verification_author_effort"
assert_contains "$OUT" '"verification_author_endpoint": ""' "default verification_author_endpoint"
assert_contains "$OUT" '"verification_author_family": "alibaba"' "default derived verification_author_family"
assert_contains "$OUT" '"implementer_family": "xai"' "default derived implementer_family"
assert_contains "$OUT" '"config_path": "'"$REPO_ROOT/.claude/review-loop-config.md"'"' "default config_path is repo dogfood absolute path"
assert_contains "$OUT" '"loop_convergence_verdict": "SHIP-AS-IS"' "default convergence verdict"
assert_contains "$OUT" '"review_risk": "high"' "default review_risk (xai impl → low-trust → high by design)"
assert_contains "$OUT" '"required_review_families": 2' "default required_review_families"
assert_contains "$OUT" '"l1_required": true' "default l1_required"
assert_contains "$OUT" '"cross_family_required": true' "default cross_family_required"
assert_contains "$OUT" '"cross_family_satisfied": true' "default cross_family_satisfied"
assert_contains "$OUT" 'MiniMax-M3 diff-only reviewer limitation: 5/6 recorded central claims were false' "default MiniMax seat surfaces calibration limitation"

# A2 perturbation: deleting the exact-seat caveat makes the roster fail closed.
NO_MINIMAX_CAVEAT_CFG="$TEST_TMP/no-minimax-caveat.md"
sed '/^[[:space:]]*- reviewer_limitation:/d' "$REPO_ROOT/.claude/review-loop-config.md" > "$NO_MINIMAX_CAVEAT_CFG"
NO_CAVEAT_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$NO_MINIMAX_CAVEAT_CFG" bash "$SCRIPT" 2>&1)"
NO_CAVEAT_EXIT=$?
assert_eq "3" "$NO_CAVEAT_EXIT" "MiniMax exact seat is rejected when its limitation tag is removed"
assert_contains "$NO_CAVEAT_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "removed MiniMax caveat is diagnosed"

# Removing or falsifying the legacy required flag must not weaken the exact-seat
# guard. The tuple itself is the authority boundary.
NO_MINIMAX_GUARD_FIELDS_CFG="$TEST_TMP/no-minimax-guard-fields.md"
sed -e '/^[[:space:]]*- reviewer_limitation:/d' \
  -e '/^[[:space:]]*- reviewer_limitation_required:/d' \
  "$REPO_ROOT/.claude/review-loop-config.md" > "$NO_MINIMAX_GUARD_FIELDS_CFG"
NO_GUARD_FIELDS_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$NO_MINIMAX_GUARD_FIELDS_CFG" bash "$SCRIPT" 2>&1)"
NO_GUARD_FIELDS_EXIT=$?
assert_eq "3" "$NO_GUARD_FIELDS_EXIT" "MiniMax exact seat rejects caveat removal even when required flag is deleted"
assert_contains "$NO_GUARD_FIELDS_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "deleted MiniMax guard fields are diagnosed"

MINIMAX_FALSE_REQUIRED_CFG="$TEST_TMP/minimax-false-required.md"
sed -e '/^[[:space:]]*- reviewer_limitation:/d' \
  -e 's/^[[:space:]]*- reviewer_limitation_required:.*/- reviewer_limitation_required: false/' \
  "$REPO_ROOT/.claude/review-loop-config.md" > "$MINIMAX_FALSE_REQUIRED_CFG"
FALSE_REQUIRED_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$MINIMAX_FALSE_REQUIRED_CFG" bash "$SCRIPT" 2>&1)"
FALSE_REQUIRED_EXIT=$?
assert_eq "3" "$FALSE_REQUIRED_EXIT" "MiniMax exact seat rejects caveat removal when required flag is false"
assert_contains "$FALSE_REQUIRED_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "false MiniMax required flag cannot silence diagnosis"

# 4. --field accessors
# DOGFOOD PIN (Board decision A roster — see §3 rationale).
assert_eq "MiniMax-M3" "$(bash "$SCRIPT" --field reviewer_engine)" "--field reviewer_engine"
assert_eq "high" "$(bash "$SCRIPT" --field reviewer_effort)" "--field reviewer_effort"
assert_eq "on" "$(bash "$SCRIPT" --field independent_harness)" "--field independent_harness"
assert_eq "high" "$(bash "$SCRIPT" --field review_risk)" "--field review_risk (xai impl → high by design)"
assert_eq "2" "$(bash "$SCRIPT" --field required_review_families)" "--field required_review_families"
assert_eq "true" "$(bash "$SCRIPT" --field l1_required)" "--field l1_required"
assert_eq "true" "$(bash "$SCRIPT" --field cross_family_required)" "--field cross_family_required"
assert_eq "true" "$(bash "$SCRIPT" --field cross_family_satisfied)" "--field cross_family_satisfied"
assert_eq "true" "$(bash "$SCRIPT" --field verification_author_present)" "--field verification_author_present"
assert_eq "$(bash "$SCRIPT" --field verification_author_engine)" "Qwen3.8-Max-Preview" "--field verification_author_engine"
assert_eq "$(bash "$SCRIPT" --field verification_author_runner)" "qoderclicn" "--field verification_author_runner"
assert_eq "high" "$(bash "$SCRIPT" --field verification_author_effort)" "--field verification_author_effort"
assert_eq "$(bash "$SCRIPT" --field verification_author_endpoint)" "" "--field verification_author_endpoint"
assert_eq "$(bash "$SCRIPT" --field verification_author_family)" "alibaba" "--field verification_author_family"
assert_eq "xai" "$(bash "$SCRIPT" --field implementer_family)" "--field implementer_family"
assert_eq "$REPO_ROOT/.claude/review-loop-config.md" "$(bash "$SCRIPT" --field config_path)" "--field config_path"
EMPTY_SCDIR="$TEST_TMP/empty-scorecard"
mkdir -p "$EMPTY_SCDIR"
assert_eq "false" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --field reviewer_qualified)" "--field reviewer_qualified returns false when no reviewer scorecard row"
assert_eq "[]" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --field fallback_ladder)" "--field fallback_ladder returns [] when no reviewer scorecard row"

# 5. unknown field → exit 2
OUT="$(bash "$SCRIPT" --field nope 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown field exit code"

# 6. override precedence + non-transport enum fallback on garbage
CFG="$TEST_TMP/rl.md"
printf -- '- reviewer_effort: turbo\n- loop_max_rounds: notanum\n- implementer_engine: my-local-model\n' > "$CFG"
assert_eq "xhigh" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field reviewer_effort)" "bad effort falls back to default"
assert_eq "5" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field loop_max_rounds)" "non-numeric rounds falls back to default"
assert_eq "my-local-model" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field implementer_engine)" "valid override value is honored"
assert_eq "override" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field source)" "override source reported"
TEMPLATE_CFG="$REPO_ROOT/project-config-template/review-loop-config.md"
assert_eq "false" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE_CFG" bash "$SCRIPT" --field verification_author_present)" "template override present is false"
assert_eq "" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE_CFG" bash "$SCRIPT" --field verification_author_engine)" "template override verification_author_engine is empty"
assert_eq "" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE_CFG" bash "$SCRIPT" --field verification_author_runner)" "template override verification_author_runner is empty"
assert_eq "" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE_CFG" bash "$SCRIPT" --field verification_author_effort)" "template override verification_author_effort is empty"
assert_eq "" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEMPLATE_CFG" bash "$SCRIPT" --field verification_author_endpoint)" "template override verification_author_endpoint is empty"

# 6a. Explicit runner values select a transport, so invalid/blank values fail
#      instead of being silently attributed to a different default runner.
BAD_IMPL_CFG="$TEST_TMP/rl-bad-impl-runner.md"
printf -- '- implementer_runner: rocket\n' > "$BAD_IMPL_CFG"
BAD_IMPL_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BAD_IMPL_CFG" bash "$SCRIPT" --field implementer_runner 2>&1)"
BAD_IMPL_EXIT=$?
assert_eq "3" "$BAD_IMPL_EXIT" "unknown implementer_runner fails config resolution"
assert_contains "$BAD_IMPL_OUT" "invalid implementer_runner" "unknown implementer_runner reports the configured field"

BAD_REV_CFG="$TEST_TMP/rl-bad-reviewer-runner.md"
printf -- '- reviewer_runner: definitely-not-a-runner\n' > "$BAD_REV_CFG"
BAD_REV_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BAD_REV_CFG" bash "$SCRIPT" --field reviewer_runner 2>&1)"
BAD_REV_EXIT=$?
assert_eq "3" "$BAD_REV_EXIT" "unknown reviewer_runner fails config resolution"
assert_contains "$BAD_REV_OUT" "invalid reviewer_runner" "unknown reviewer_runner reports the configured field"

BLANK_REV_CFG="$TEST_TMP/rl-blank-reviewer-runner.md"
printf -- '- reviewer_runner:\n' > "$BLANK_REV_CFG"
BLANK_REV_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BLANK_REV_CFG" bash "$SCRIPT" --field reviewer_runner 2>&1)"
BLANK_REV_EXIT=$?
assert_eq "3" "$BLANK_REV_EXIT" "blank explicit reviewer_runner fails config resolution"
assert_contains "$BLANK_REV_OUT" "<empty>" "blank explicit reviewer_runner is diagnosed"
assert_eq "codex" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --field reviewer_runner)" "missing reviewer_runner alone uses the built-in default"

# 6b. new hetero runners are accepted (v2.26.6–2.26.8): grok (impl+reviewer), cc-shim (impl).
#     Regression guard — these were silently reset to default before the enums were widened.
NCFG="$TEST_TMP/rl-new-runners.md"
printf -- '- implementer_runner: cc-shim\n- implementer_engine: MiniMax-M3\n- reviewer_runner: grok\n- reviewer_engine: grok-build\n' > "$NCFG"
assert_eq "cc-shim" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$NCFG" bash "$SCRIPT" --field implementer_runner)" "cc-shim implementer_runner honored"
assert_eq "grok" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$NCFG" bash "$SCRIPT" --field reviewer_runner)" "grok reviewer_runner honored"
QCFG="$TEST_TMP/rl-qoderclicn.md"
# This fixture deliberately puts qoderclicn in BOTH seats to prove the enum accepts
# it in each — which is now a dual-seat collision. Opt in: the subject is enum
# acceptance, not decorrelation policy.
printf -- '- implementer_runner: qoderclicn\n- implementer_engine: Qwen3.8-Max-Preview\n- reviewer_runner: qoderclicn\n- reviewer_engine: Qwen3.8-Max-Preview\n- allow_same_runner_dual_seat: on\n' > "$QCFG"
assert_eq "qoderclicn" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QCFG" bash "$SCRIPT" --field implementer_runner)" "qoderclicn implementer_runner honored"
assert_eq "qoderclicn" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QCFG" bash "$SCRIPT" --field reviewer_runner)" "qoderclicn reviewer_runner honored"
OCCFG="$TEST_TMP/rl-opencode-impl.md"
printf -- '- implementer_runner: opencode\n- implementer_engine: opencode-go/muse-spark-1.3-contributor\n' > "$OCCFG"
assert_eq "opencode" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$OCCFG" bash "$SCRIPT" --field implementer_runner)" "opencode implementer_runner honored (v2.35.12 rail)"
assert_eq "opencode-go/muse-spark-1.3-contributor" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$OCCFG" bash "$SCRIPT" --field implementer_engine)" "provider/model engine id passes through verbatim"
OCLCFG="$TEST_TMP/rl-opencode-ladder.md"
printf -- '- implementer_runner: grok\n- implementer_engine: grok-4.5\n- implementer_ladder: opencode-go/muse-spark-1.3-contributor/high@opencode, grok-4.5/high@grok\n' > "$OCLCFG"
OCL_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$OCLCFG" bash "$SCRIPT" 2>/dev/null)"; OCL_RC=$?
assert_exit_code "$OCL_RC" 0 "ladder rung with a provider/model engine id (contains /) parses"
assert_contains "$OCL_JSON" '"engine": "opencode-go/muse-spark-1.3-contributor"' "rung engine keeps the full provider/model id (split at the LAST /)"
assert_contains "$OCL_JSON" '"runner": "opencode"' "rung runner opencode accepted"

# implementer_ladder: auto + ladder_start_rung_judgment test cases
# (a) implementer_ladder: auto + a scratch AUTOPILOT_TOPOLOGY_FILE with a 2-rung implementer_ladder
AUTO_TOPO_FILE="$TEST_TMP/topo-fixture.json"
cat > "$AUTO_TOPO_FILE" <<'JSON'
{
  "implementer_ladder": [
    { "rung": "gemini-3.7-flash-low/low@agy", "engine": "gemini-3.7-flash-low", "effort": "low", "runner": "agy", "baseline_event_id": "b1" },
    { "rung": "grok-4.6/low@grok", "engine": "grok-4.6", "effort": "low", "runner": "grok" }
  ]
}
JSON
AUTO_CFG="$TEST_TMP/rl-impl-auto.md"
printf -- '- implementer_ladder: auto\n' > "$AUTO_CFG"
AUTO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$AUTO_TOPO_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$AUTO_CFG" bash "$SCRIPT" 2>/dev/null)"; AUTO_RC=$?
assert_exit_code "$AUTO_RC" 0 "implementer_ladder: auto with valid topology exits 0"
assert_eq '[{"engine":"gemini-3.7-flash-low","effort":"low","runner":"agy"},{"engine":"grok-4.6","effort":"low","runner":"grok"}]' \
  "$(json_get "$AUTO_OUT" implementer_ladder)" \
  "implementer_ladder auto expands to rungs from topology file dropping rung label and baseline_event_id"

# (b) implementer_ladder: auto + no topology file (unset/missing path)
NO_TOPO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/nonexistent-topo.json" REVIEW_LOOP_CONFIG_OVERRIDE="$AUTO_CFG" bash "$SCRIPT" 2>/dev/null)"; NO_TOPO_RC=$?
assert_exit_code "$NO_TOPO_RC" 0 "implementer_ladder: auto with missing topology exits 0"
assert_eq "[]" "$(json_get "$NO_TOPO_OUT" implementer_ladder)" "implementer_ladder auto without topology falls back to []"
assert_contains "$(json_get "$NO_TOPO_OUT" capability_warnings)" \
  "implementer_ladder auto: no host topology (run scripts/resolve-dispatch-topology.js)" \
  "capability_warnings contains exact auto topology warning when topology file is missing"

# (c) an explicit comma list still works unchanged (regression check)
assert_contains "$OCL_JSON" '"engine": "grok-4.5"' "explicit comma list preserves second rung"

# (c2) implementer_ladder: auto + topology file exists but implementer_ladder is empty
# -> implicit rung kept, [] output, and the specific "no qualified hetero implementer"
# warning (not the "no host topology" one from (b) — the file DOES exist and parse).
EMPTY_TOPO_FILE="$TEST_TMP/topo-empty-fixture.json"
printf '%s\n' '{ "implementer_ladder": [] }' > "$EMPTY_TOPO_FILE"
EMPTY_TOPO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$EMPTY_TOPO_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$AUTO_CFG" bash "$SCRIPT" 2>/dev/null)"; EMPTY_TOPO_RC=$?
assert_exit_code "$EMPTY_TOPO_RC" 0 "implementer_ladder: auto with empty topology ladder exits 0"
assert_eq "[]" "$(json_get "$EMPTY_TOPO_OUT" implementer_ladder)" "implementer_ladder auto with empty topology ladder falls back to []"
assert_contains "$(json_get "$EMPTY_TOPO_OUT" capability_warnings)" \
  "implementer_ladder auto: no qualified hetero implementer on this host — hands run native (haiku→sonnet), see claude_fallback_ladder" \
  "capability_warnings contains the empty-ladder warning (distinct from the no-topology-file warning)"

# (c3) implementer_ladder: auto + topology file has a rung whose runner fails the enum
# check -> exit 3, same message shape as the comma-list path; a stale topology file
# must not smuggle an invalid runner past the resolver.
BOGUS_TOPO_FILE="$TEST_TMP/topo-bogus-fixture.json"
cat > "$BOGUS_TOPO_FILE" <<'JSON'
{
  "implementer_ladder": [
    { "engine": "grok-4.6", "effort": "low", "runner": "bogus" }
  ]
}
JSON
BOGUS_TOPO_ERR="$(AUTOPILOT_TOPOLOGY_FILE="$BOGUS_TOPO_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$AUTO_CFG" bash "$SCRIPT" 2>&1 1>/dev/null)"; BOGUS_TOPO_RC=$?
assert_exit_code "$BOGUS_TOPO_RC" 3 "implementer_ladder: auto with a bogus rung runner exits 3"
assert_contains "$BOGUS_TOPO_ERR" "invalid implementer_ladder runner" "bogus auto rung runner error matches comma-list message shape"

# (d) default ladder_start_rung_judgment is 0 when absent from config, 1 when 1, falls back to 0 for garbage
JUDG_DEF_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_eq "0" "$(json_get "$JUDG_DEF_OUT" ladder_start_rung_judgment)" "ladder_start_rung_judgment defaults to 0 when absent"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --field ladder_start_rung_judgment)" "--field ladder_start_rung_judgment defaults to 0"

JUDG1_CFG="$TEST_TMP/rl-judg-1.md"
printf -- '- ladder_start_rung_judgment: 1\n' > "$JUDG1_CFG"
JUDG1_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$JUDG1_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_eq "1" "$(json_get "$JUDG1_OUT" ladder_start_rung_judgment)" "ladder_start_rung_judgment is 1 when configured to 1"
assert_eq "1" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$JUDG1_CFG" bash "$SCRIPT" --field ladder_start_rung_judgment)" "--field ladder_start_rung_judgment is 1 when configured to 1"

JUDGBAD_CFG="$TEST_TMP/rl-judg-bad.md"
printf -- '- ladder_start_rung_judgment: 7\n' > "$JUDGBAD_CFG"
JUDGBAD_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$JUDGBAD_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_eq "0" "$(json_get "$JUDGBAD_OUT" ladder_start_rung_judgment)" "ladder_start_rung_judgment falls back to 0 for garbage value 7"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$JUDGBAD_CFG" bash "$SCRIPT" --field ladder_start_rung_judgment)" "--field ladder_start_rung_judgment falls back to 0 for garbage value 7"

RCFG="$TEST_TMP/rl-ccshim-rev.md"
printf -- '- reviewer_runner: cc-shim\n- reviewer_engine: MiniMax-M3\n' > "$RCFG"
assert_eq "cc-shim" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RCFG" bash "$SCRIPT" --field reviewer_runner)" "cc-shim reviewer_runner honored (dispatch-review supports it since v2.26.10)"
ACRCFG="$TEST_TMP/rl-anthropic-compatible-rev.md"
printf -- '- reviewer_runner: anthropic-compatible\n- reviewer_engine: MiniMax-M3\n' > "$ACRCFG"
assert_eq "anthropic-compatible" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$ACRCFG" bash "$SCRIPT" --field reviewer_runner)" "anthropic-compatible reviewer_runner honored (dispatch-review direct HTTP reviewer)"
CNRCFG="$TEST_TMP/rl-claude-native-rev.md"
printf -- '- reviewer_runner: claude-native\n- reviewer_engine: claude-fable-5\n' > "$CNRCFG"
assert_eq "claude-native" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CNRCFG" bash "$SCRIPT" --field reviewer_runner)" "claude-native reviewer_runner honored (dispatch-review local Claude transport)"
ACI_CFG="$TEST_TMP/rl-anthropic-compatible-impl.md"
printf -- '- implementer_runner: anthropic-compatible\n- implementer_engine: MiniMax-M3\n' > "$ACI_CFG"
ACI_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ACI_CFG" bash "$SCRIPT" --field implementer_runner 2>&1)"
ACI_EXIT=$?
assert_eq "3" "$ACI_EXIT" "anthropic-compatible implementer_runner rejected (dispatch-hetero does not support it)"
assert_contains "$ACI_OUT" "invalid implementer_runner" "unsupported implementer transport fails loudly"
VAA_CFG="$TEST_TMP/rl-ver-auth-runner-anthropic.md"
printf -- '- verification_author_present: true\n- verification_author_engine: MiniMax-M3\n- verification_author_runner: anthropic-compatible\n- verification_author_effort: high\n- verification_author_endpoint: glm\n' > "$VAA_CFG"
assert_eq "anthropic-compatible" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$VAA_CFG" bash "$SCRIPT" --field verification_author_runner)" "anthropic-compatible verification_author_runner honored"
GCFG="$TEST_TMP/rl-grok-impl.md"
printf -- '- implementer_runner: grok\n- implementer_engine: grok-composer-2.5-fast\n' > "$GCFG"
assert_eq "grok" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$GCFG" bash "$SCRIPT" --field implementer_runner)" "grok implementer_runner honored"

# 6c. Plan review has a separate, bounded roster and cannot loosen hard ceilings.
PLAN_CFG="$TEST_TMP/rl-plan-review.md"
printf -- '- plan_review: on\n- plan_reviewer_engine: claude-fable-5\n- plan_reviewer_runner: claude-native\n- plan_reviewer_effort: high\n- plan_reviewer_endpoint:\n- plan_deep_reviewer_engine: gpt-5.6-sol\n- plan_deep_reviewer_runner: codex\n- plan_deep_reviewer_effort: max\n- plan_deep_reviewer_endpoint:\n- plan_review_max_generations: 2\n- plan_review_max_wall_seconds: 7200\n- plan_review_growth_warn_ratio: 1.25\n- plan_review_growth_stop_ratio: 1.50\n' > "$PLAN_CFG"
assert_eq "on" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_review)" "plan review is independently enabled"
assert_eq "claude-fable-5" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_reviewer_engine)" "plan chair engine preserved"
assert_eq "claude-native" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_reviewer_runner)" "plan chair runner preserved"
assert_eq "gpt-5.6-sol" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_deep_reviewer_engine)" "plan deep engine preserved"
assert_eq "2" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_review_max_generations)" "plan generation hard cap preserved"
assert_eq "1.50" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_CFG" bash "$SCRIPT" --field plan_review_growth_stop_ratio)" "plan growth hard stop preserved"

PLAN_LOOSE_CFG="$TEST_TMP/rl-plan-loose.md"
printf -- '- plan_review_max_generations: 3\n' > "$PLAN_LOOSE_CFG"
PLAN_LOOSE_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_LOOSE_CFG" bash "$SCRIPT" 2>&1)"
PLAN_LOOSE_EXIT=$?
assert_eq "3" "$PLAN_LOOSE_EXIT" "plan generation cap cannot exceed 2"
assert_contains "$PLAN_LOOSE_OUT" "must be 1 or 2" "loosened plan generation cap is diagnosed"

PLAN_INCOMPLETE_CFG="$TEST_TMP/rl-plan-incomplete.md"
printf -- '- plan_review: on\n- plan_reviewer_engine: claude-fable-5\n' > "$PLAN_INCOMPLETE_CFG"
PLAN_INCOMPLETE_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_INCOMPLETE_CFG" bash "$SCRIPT" 2>&1)"
PLAN_INCOMPLETE_EXIT=$?
assert_eq "3" "$PLAN_INCOMPLETE_EXIT" "enabled plan review requires a complete chair tuple"
assert_contains "$PLAN_INCOMPLETE_OUT" "requires plan_reviewer_engine" "incomplete plan chair tuple is diagnosed"

# family_of recognises xai (grok) ≠ minimax (impl). Panel is grok-build ALONE so the result
# can ONLY come from grok being a real (xai) family — an UNKNOWN family never satisfies
# cross-family (fail-closed), so this would be false if family_of didn't know grok.
XFCFG="$TEST_TMP/rl-xfamily.md"
printf -- '- implementer_runner: cc-shim\n- implementer_engine: MiniMax-M3\n- qc_panel: grok-build\n' > "$XFCFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$XFCFG" bash "$SCRIPT" --source-trust high --field cross_family_satisfied)" "lone grok (xai) panel member satisfies cross-family vs a minimax implementer"
QXFCFG="$TEST_TMP/rl-qwen-xfamily.md"
printf -- '- implementer_runner: qoderclicn\n- implementer_engine: Qwen3.8-Max-Preview\n- qc_panel: grok-4.5\n' > "$QXFCFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QXFCFG" bash "$SCRIPT" --source-trust high --field cross_family_satisfied)" "lone grok panel member satisfies cross-family vs qwen/alibaba implementer"

# 7. qc_panel (v2.25.9): default array + aggregation default
# EMPTY_CFG override: isolate from autopilot's dogfood .claude/review-loop-config.md (slot 3),
# whose qc_panel is a moving target (pinned to Gemini 3.6 Flash (High) on 2026-07-23) — this
# case asserts the BUILT-IN default roster, so it must not read the live config.
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT")"
assert_contains "$OUT" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-3.6-flash-high"]' "default qc_panel array emits canonical agy slug"
assert_contains "$OUT" '"qc_panel_aggregation": "union-on-verified-critical"' "default aggregation"
assert_eq "gpt-5.5 claude-opus gemini-3.6-flash-high" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --field qc_panel)" "--field qc_panel space-joined"
assert_eq "true" "$(json_get "$OUT" qc_panel_seats_complete)" \
  "built-in panel has a complete exact-tuple roster"
assert_eq '[{"role":"qc","runner":"codex","model":"gpt-5.5","effort":"xhigh","endpoint":null,"family":"openai"},{"role":"qc","runner":"claude-native","model":"claude-opus","effort":"high","endpoint":null,"family":"anthropic"},{"role":"qc","runner":"agy","model":"gemini-3.6-flash-high","effort":"high","endpoint":null,"family":"google"}]' \
  "$(json_get "$OUT" qc_panel_seats)" \
  "built-in QC seats bind runner, model, effort, endpoint, role, and family"
assert_eq "300" "$(json_get "$OUT" provider_readiness_receipt_ttl_seconds)" \
  "readiness receipt TTL default is emitted"
assert_eq "different" "$(json_get "$OUT" provider_readiness_fallback_family_constraint)" \
  "readiness fallback family constraint default is emitted"

# 7b. qc_panel preset all-calibrated
AC_CFG="$TEST_TMP/all-calibrated.md"
printf -- '- qc_panel: all-calibrated\n' > "$AC_CFG"
AC_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG" bash "$SCRIPT")"
assert_contains "$AC_OUT" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-3.6-flash-high", "grok-4.5", "MiniMax-M3"]' "all-calibrated preset expands to canonical 5-family roster"
assert_not_contains "$(json_get "$AC_OUT" qc_panel)" "all-calibrated" "alias string is absent from parsed qc_panel value"
assert_eq "false" "$(json_get "$AC_OUT" qc_panel_seats_complete)" \
  "an explicit panel without exact companion metadata fails closed"

EXACT_QC_CFG="$TEST_TMP/exact-qc.md"
printf -- '- qc_panel: gpt-5.5, claude-opus\n- qc_panel_runners: codex, claude-native\n- qc_panel_efforts: xhigh, high\n- qc_panel_endpoints: @none, @none\n- provider_readiness_receipt_ttl_seconds: 450\n- provider_readiness_fallback_family_constraint: any\n' > "$EXACT_QC_CFG"
EXACT_QC_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EXACT_QC_CFG" bash "$SCRIPT")"
assert_eq "true" "$(json_get "$EXACT_QC_OUT" qc_panel_seats_complete)" \
  "explicit aligned QC companion metadata produces exact tuples"
assert_eq '[{"role":"qc","runner":"codex","model":"gpt-5.5","effort":"xhigh","endpoint":null,"family":"openai"},{"role":"qc","runner":"claude-native","model":"claude-opus","effort":"high","endpoint":null,"family":"anthropic"}]' \
  "$(json_get "$EXACT_QC_OUT" qc_panel_seats)" \
  "explicit exact QC tuple roster is emitted in configured order"
assert_eq "450" "$(json_get "$EXACT_QC_OUT" provider_readiness_receipt_ttl_seconds)" \
  "configured readiness receipt TTL is emitted"
assert_eq "any" "$(json_get "$EXACT_QC_OUT" provider_readiness_fallback_family_constraint)" \
  "configured fallback family constraint is emitted"

# 7b2. Kimi QC seat. `kimi` is a first-class review transport (dispatch-review.sh
# --runner kimi, added 380405da for exactly this panel), so a QC seat configured on
# it MUST resolve complete. The seat-runner allowlist used to omit `kimi`, which
# silently turned a legitimately configured panel into qc_panel_seats_complete=false
# with an empty roster — fail-closing every strict /l5 and /l6 run downstream.
# Panel mirrors the real four-seat consumer config so the regression stays concrete.
KIMI_QC_CFG="$TEST_TMP/exact-qc-kimi.md"
printf -- '- qc_panel: claude-fable-5, kimi-code/k3, GLM-5.2, Qwen3.8-Max-Preview\n- qc_panel_runners: claude-native, kimi, anthropic-compatible, qoderclicn\n- qc_panel_efforts: high, high, high, max\n- qc_panel_endpoints: @none, @none, glm, @none\n' > "$KIMI_QC_CFG"
KIMI_QC_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$KIMI_QC_CFG" bash "$SCRIPT")"
assert_eq "true" "$(json_get "$KIMI_QC_OUT" qc_panel_seats_complete)" \
  "a kimi-runner QC seat resolves complete"
assert_eq '[{"role":"qc","runner":"claude-native","model":"claude-fable-5","effort":"high","endpoint":null,"family":"anthropic"},{"role":"qc","runner":"kimi","model":"kimi-code/k3","effort":"high","endpoint":null,"family":"moonshot"},{"role":"qc","runner":"anthropic-compatible","model":"GLM-5.2","effort":"high","endpoint":"glm","family":"zhipu"},{"role":"qc","runner":"qoderclicn","model":"Qwen3.8-Max-Preview","effort":"max","endpoint":null,"family":"alibaba"}]' \
  "$(json_get "$KIMI_QC_OUT" qc_panel_seats)" \
  "kimi QC seat binds the kimi runner and the moonshot family"

# 7b3. reviewer_runner accepts kimi. The JS contract validator gates
# qc_panel_seats[].runner on the reviewer_runner enum (src/engine/resolve-review-loop.js),
# and check-contract-schema.js parity-locks that enum to this shell case arm — so the
# loop reviewer seat and the QC seat must admit the same transports.
KIMI_REV_CFG="$TEST_TMP/rl-kimi-reviewer.md"
printf -- '- reviewer_runner: kimi\n- reviewer_engine: kimi-code/k3\n' > "$KIMI_REV_CFG"
assert_eq "kimi" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$KIMI_REV_CFG" bash "$SCRIPT" --field reviewer_runner)" \
  "kimi reviewer_runner honored"
assert_eq "moonshot" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$KIMI_REV_CFG" bash "$SCRIPT" --field reviewer_family)" \
  "kimi reviewer maps to the moonshot family"

# case/trim handling check
AC_CFG_CASE="$TEST_TMP/all-calibrated-case.md"
printf -- '- qc_panel:   All-Calibrated  \n' > "$AC_CFG_CASE"
AC_OUT_CASE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG_CASE" bash "$SCRIPT")"
assert_contains "$AC_OUT_CASE" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-3.6-flash-high", "grok-4.5", "MiniMax-M3"]' "all-calibrated preset case/trim is handled correctly"

# cross-family field computed over the expanded list
AC_CFG_XFAM="$TEST_TMP/all-calibrated-xfam.md"
printf -- '- implementer_engine: MiniMax-M3\n- qc_panel: all-calibrated\n' > "$AC_CFG_XFAM"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG_XFAM" bash "$SCRIPT" --field cross_family_satisfied)" "cross_family_satisfied is true when using all-calibrated preset with MiniMax-M3 implementer"

# 8. aggregation: majority (and any garbage) → falls back to the safe union default
PCFG="$TEST_TMP/panel.md"
printf -- '- qc_panel: a-model , b-model,c-model \n- qc_panel_aggregation: majority\n' > "$PCFG"
assert_eq "union-on-verified-critical" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PCFG" bash "$SCRIPT" --field qc_panel_aggregation)" "majority aggregation rejected → union default"
# panel trims whitespace around comma-separated members
assert_eq "a-model b-model c-model" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PCFG" bash "$SCRIPT" --field qc_panel)" "panel members trimmed"

# 9. family-overlap warning fires when the panel shares the implementer family (advisory stderr, output unchanged)
FCFG="$TEST_TMP/fam.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: gpt-5.5, gpt-5-codex\n' > "$FCFG"
WARN="$(REVIEW_LOOP_CONFIG_OVERRIDE="$FCFG" bash "$SCRIPT" 2>&1 >/dev/null)"
assert_contains "$WARN" "shares the implementer family" "all-OpenAI panel vs OpenAI implementer → warn"
# cross-family panel: NO warning
XCFG="$TEST_TMP/xfam.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: gpt-5.5, claude-opus\n' > "$XCFG"
XWARN="$(REVIEW_LOOP_CONFIG_OVERRIDE="$XCFG" bash "$SCRIPT" 2>&1 >/dev/null)"
assert_not_contains "$XWARN" "shares the implementer family" "cross-family panel → no warn"
# an UNKNOWN-family member must NOT suppress the warn (it could be the impl family in disguise)
UCFG="$TEST_TMP/ufam.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: gpt-5.5, some-unknown-model\n' > "$UCFG"
UWARN="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UCFG" bash "$SCRIPT" 2>&1 >/dev/null)"
assert_contains "$UWARN" "shares the implementer family" "unknown-family member does not mask the overlap warn"
assert_eq "false" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$UCFG" bash "$SCRIPT" --field cross_family_satisfied)" "unknown-member panel does not satisfy cross-family"
assert_contains "$UWARN" "WARNING" "unknown-member overlap stays warning at low risk"
assert_contains "$UWARN" "cross-family" "warning includes cross-family token"

# same unknown-member panel, forced high risk -> escalated ERROR
UERR_WARN="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UCFG" bash "$SCRIPT" --security-surface 1 2>&1 >/dev/null)"
assert_contains "$UERR_WARN" "ERROR" "unknown-member panel at high risk escalates to error"
assert_contains "$UERR_WARN" "cross-family" "error includes cross-family token"
# output JSON still valid regardless of warning
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$FCFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" "warn does not change exit code"

# 10. risk escalates by security/diff threshold
assert_eq "high" "$(bash "$SCRIPT" --security-surface 1 --field review_risk)" "security-surface sets high risk"
assert_eq "2" "$(bash "$SCRIPT" --security-surface 1 --field required_review_families)" "high risk requires two families"
assert_eq "true" "$(bash "$SCRIPT" --security-surface 1 --field l1_required)" "high risk sets l1_required"
# --source-trust high pins a high-trust baseline so these prove the DIFF-LINES escalator,
# independent of the repo's live implementer family (grok/xai is low-trust → always high).
assert_eq "high" "$(bash "$SCRIPT" --source-trust high --diff-lines 200 --field review_risk)" "large diff sets high risk"
assert_eq "low" "$(bash "$SCRIPT" --source-trust high --diff-lines 10 --field review_risk)" "small diff keeps low risk"

# 11. --enforce opt-in hard gate (default stays exit-0 data mode; gate exits 3 only on
# high-risk + cross_family_required + !satisfied). JSON/field still emitted under enforce-fail.
ECFG="$TEST_TMP/enf.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: gpt-5.5, mystery-model\n' > "$ECFG"
# default (no --enforce): even high-risk unsatisfied → exit 0 (resolver reports, caller enforces)
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$ECFG" bash "$SCRIPT" --security-surface 1 >/dev/null 2>&1; echo $?)" "no --enforce: high-risk unsatisfied still exit 0 (data mode)"
# --enforce + high-risk + unsatisfied → exit 3
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$ECFG" bash "$SCRIPT" --enforce --security-surface 1 >/dev/null 2>&1; echo $?)" "--enforce blocks high-risk unsatisfied cross-family (exit 3)"
# --enforce + LOW risk unsatisfied → exit 0 (low is warn, not block)
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$ECFG" bash "$SCRIPT" --enforce >/dev/null 2>&1; echo $?)" "--enforce at low risk does not block (warn only)"
# --enforce + satisfied (default cross-family panel) → exit 0
assert_eq "0" "$(bash "$SCRIPT" --enforce --security-surface 1 >/dev/null 2>&1; echo $?)" "--enforce passes when cross-family satisfied"
# JSON still emitted even when --enforce blocks
assert_contains "$(REVIEW_LOOP_CONFIG_OVERRIDE="$ECFG" bash "$SCRIPT" --enforce --security-surface 1 2>/dev/null)" '"review_risk": "high"' "--enforce still emits the JSON data on block"
# 11b. high-risk + EMPTY panel (no reviewers at all) must be required+unsatisfied → --enforce blocks
# (qc_panel: , parses to zero members — a non-empty config value that trims to an empty panel)
EPCFG="$TEST_TMP/emptypanel.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: ,\n' > "$EPCFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EPCFG" bash "$SCRIPT" --security-surface 1 --field cross_family_required)" "high-risk empty panel: cross_family_required true"
assert_eq "false" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EPCFG" bash "$SCRIPT" --security-surface 1 --field cross_family_satisfied)" "high-risk empty panel: cross_family_satisfied false"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EPCFG" bash "$SCRIPT" --enforce --security-surface 1 >/dev/null 2>&1; echo $?)" "--enforce blocks high-risk EMPTY panel (no reviewers at all)"

# 11c. required=2 + panel spanning 1 distinct family -> satisfied=false
R2F1CFG="$TEST_TMP/r2f1.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: claude-opus, claude-sonnet\n' > "$R2F1CFG"
assert_eq "false" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$R2F1CFG" bash "$SCRIPT" --security-surface 1 --field cross_family_satisfied)" "required=2 with 1 distinct non-impl family -> satisfied=false"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$R2F1CFG" bash "$SCRIPT" --security-surface 1 --enforce >/dev/null 2>&1; echo $?)" "required=2 with 1 distinct non-impl family -> enforce exits 3"

# 11d. required=2 + panel spanning 2 distinct families -> satisfied=true
R2F2CFG="$TEST_TMP/r2f2.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: claude-opus, gemini-flash\n' > "$R2F2CFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$R2F2CFG" bash "$SCRIPT" --security-surface 1 --field cross_family_satisfied)" "required=2 with 2 distinct families -> satisfied=true"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$R2F2CFG" bash "$SCRIPT" --security-surface 1 --enforce >/dev/null 2>&1; echo $?)" "required=2 with 2 distinct families -> enforce exits 0"

# 12. probe telemetry fields + invalid --domain enum
assert_eq "mixed" "$(bash "$SCRIPT" --field work_domain)" "--field work_domain"
assert_eq "none" "$(bash "$SCRIPT" --field domain_source)" "--field domain_source"
assert_eq "2" "$(bash "$SCRIPT" --domain nope >/dev/null 2>&1; echo $?)" "--domain invalid returns usage exit 2"

# Dogfood shim (2026-08-17 qualification-cli-transport): the repo's own config now
# pins a brain seat, but the ambient-default pins below measure the NO-seat default
# shape. Derive an ambient-minus-brain fixture so those pins keep their original
# measurement surface (everything except brain_seat_identity_file is untouched).
AMBIENT_NO_BRAIN="$TEST_TMP/ambient-config-no-brain.md"
if [ -f "$REPO_ROOT/.claude/review-loop-config.md" ]; then
  grep -v 'brain_seat_identity_file' "$REPO_ROOT/.claude/review-loop-config.md" > "$AMBIENT_NO_BRAIN"
else
  : > "$AMBIENT_NO_BRAIN"
fi

# 13. --auto-domain inserts exactly two keys at JSON tail (legacy output is unchanged prefix)
BASE_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" bash "$SCRIPT")"
AUTO_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" bash "$SCRIPT" --auto-domain HEAD..HEAD)"
AUTO_WD="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" bash "$SCRIPT" --auto-domain HEAD..HEAD --field work_domain)"
AUTO_SOURCE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" bash "$SCRIPT" --auto-domain HEAD..HEAD --field domain_source)"
BASE_JSON_STRIPPED="$(printf '%s' "$BASE_JSON" | sed -E 's/, "capability_state_source":.* }/ }/')"
AUTO_JSON_STRIPPED="$(printf '%s' "$AUTO_JSON" | sed -E 's/, "capability_state_source":.* }/ }/')"
BASE_LEGACY_PREFIX="$(printf '%s' "$BASE_JSON_STRIPPED" | sed 's/, "work_domain": "[^"]*", "domain_source": "[^"]*" }$/ }/')"
BASE_PREFIX="$(printf '%s' "$BASE_LEGACY_PREFIX" | sed 's/ }$//')"
assert_eq "${BASE_PREFIX}, \"work_domain\": \"${AUTO_WD}\", \"domain_source\": \"${AUTO_SOURCE}\" }" "$AUTO_JSON_STRIPPED" "auto output is exact legacy prefix + inserted keys"
assert_eq "none" "$AUTO_SOURCE" "empty auto-diff range keeps domain_source=none"

# 13b. round-2 reviewer 🟡 — a NON-self-referential KR2 schema lock. The prefix check
#      above derives its baseline by stripping the new keys from the already-modified
#      output, so a rename/reorder/drop of a PRE-EXISTING field would slip through.
#      Pin the exact key NAMES + ORDER (independent of values): base keys plus new
#      provenance fields in schema order (verification-author tuple, family provenance, config path),
#      then density-variant keys when scale/source flags are enabled.
EXPECTED_KEYS='"reviewer_engine":"reviewer_effort":"reviewer_runner":"implementer_engine":"implementer_effort":"implementer_runner":"implementer_ladder":"ladder_start_rung_judgment":"loop_max_rounds":"loop_convergence_verdict":"spec_review":"independent_harness":"qc_panel":"qc_panel_aggregation":"review_risk":"required_review_families":"l1_required":"cross_family_required":"cross_family_satisfied":"review_diff_scope":"source":"work_domain":"domain_source":"capability_state_source":"quota_status":"quota_reset_at":"skill_mode_requested":"skill_mode_effective":"capability_warnings":"reviewer_endpoint":"reviewer_family":"implementer_endpoint":"verification_author_present":"verification_author_engine":"verification_author_runner":"verification_author_effort":"verification_author_endpoint":"verification_author_family":"implementer_family":"config_path":"min_panel_size":"on_engine_unavailable":"reviewer_engine_low_risk":"reviewer_effort_low_risk":"on_family_conflict":"reviewer_fallback_preference":"reviewer_fallback_preference_low_risk":"qc_panel_seats":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"qc_panel_seats_complete":"provider_readiness_receipt_ttl_seconds":"provider_readiness_fallback_family_constraint":"strict_l5_policy_override":"brain_seat":"plan_review":"plan_review_resolved_from":"hetero_review":"hetero_review_resolved_from":"plan_reviewer_engine":"plan_reviewer_effort":"plan_reviewer_runner":"plan_reviewer_endpoint":"plan_deep_reviewer_engine":"plan_deep_reviewer_effort":"plan_deep_reviewer_runner":"plan_deep_reviewer_endpoint":"plan_review_max_generations":"plan_review_max_wall_seconds":"plan_review_growth_warn_ratio":"plan_review_growth_stop_ratio":"consult_engine":"consult_effort":"consult_runner":"consult_endpoint":"discuss_engine":"discuss_effort":"discuss_runner":"discuss_endpoint":"consult_dispatch":"consult_resolved_from":"discuss_dispatch":"allow_same_runner_dual_seat":"same_runner_dual_seat":"override_admitted_seats":'
ACTUAL_KEYS="$(printf '%s' "$AUTO_JSON" | grep -oE '"[a-z0-9_]+":' | tr -d '\n')"
assert_eq "$ACTUAL_KEYS" "$EXPECTED_KEYS" "JSON schema key order is exact, including newly surfaced provenance keys"

# 14. non-git / empty / probe-failure paths:
NON_GIT_DIR="$TEST_TMP/not-a-repo"
mkdir -p "$NON_GIT_DIR"
NON_GIT_OUT="$(cd "$NON_GIT_DIR" && bash "$SCRIPT" --auto-domain 2>&1)"; NON_GIT_EXIT=$?
assert_eq "0" "$NON_GIT_EXIT" "non-git --auto-domain keeps resolver exit code"
assert_contains "$NON_GIT_OUT" '"work_domain": "mixed"' "non-git --auto-domain yields mixed"
assert_contains "$NON_GIT_OUT" '"domain_source": "none"' "non-git --auto-domain yields domain_source none"

RL_REPO="$TEST_TMP/repo-auto"
mkdir -p "$RL_REPO"
git -C "$RL_REPO" init -q -b main
git -C "$RL_REPO" config user.email t@t
git -C "$RL_REPO" config user.name t
git -C "$RL_REPO" commit --allow-empty -q -m base
BASE_COMMIT="$(git -C "$RL_REPO" rev-parse HEAD)"
EMPTY_AUTO="$(cd "$RL_REPO" && bash "$SCRIPT" --auto-domain "$BASE_COMMIT..$BASE_COMMIT")"
assert_contains "$EMPTY_AUTO" '"work_domain": "mixed"' "empty auto-range returns mixed"
assert_contains "$EMPTY_AUTO" '"domain_source": "none"' "empty auto-range returns domain_source none"

# 15. --enforce and core review fields stay unchanged with --auto-domain
assert_eq "$(bash "$SCRIPT" --field review_risk)" "$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field review_risk)" "auto-domain does not alter review_risk"
assert_eq "$(bash "$SCRIPT" --field cross_family_required)" "$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field cross_family_required)" "auto-domain does not alter cross_family_required"
assert_eq "$(bash "$SCRIPT" --field cross_family_satisfied)" "$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field cross_family_satisfied)" "auto-domain does not alter cross_family_satisfied"
assert_eq "$(bash "$SCRIPT" --enforce --security-surface 1 >/dev/null 2>&1; echo $?)" "$(bash "$SCRIPT" --auto-domain HEAD..HEAD --enforce --security-surface 1 >/dev/null 2>&1; echo $?)" "no-routing invariant for --enforce with auto-domain"

# 16. --check-scorecard is opt-in and additive (legacy output unchanged when omitted)
BASE_OUT="$(bash "$SCRIPT")"
assert_not_contains "$BASE_OUT" "\"reviewer_qualified\"" "no --check-scorecard output omits reviewer_qualified"
assert_not_contains "$BASE_OUT" "\"fallback_ladder\"" "no --check-scorecard output omits fallback_ladder"

# 17. Legacy unscoped qualification cannot enter the adaptive scorecard gate.
SCDIR="$TEST_TMP/check-ok"
mkdir -p "$SCDIR"
RECQUAL_JSON="$SCDIR/rec.json"
cat > "$RECQUAL_JSON" <<'JSON'
{"engine":"gpt-5.5","runner":"codex","family":"openai","role":"reviewer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$SCDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECQUAL_JSON" > /dev/null
# ISOLATED: EMPTY_CFG pins the default reviewer (gpt-5.5/codex) + openai implementer so
# this checks that even a matching legacy row cannot bypass exact scope/deployment evidence.
QUAL_OUT="$(ENGINE_SCORECARD_DIR="$SCDIR" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --check-scorecard)"
assert_eq "false" "$(json_get "$QUAL_OUT" reviewer_qualified)" "legacy qualified row remains unqualified without exact evidence inputs"
assert_eq "[]" "$(json_get "$QUAL_OUT" fallback_ladder)" "legacy row cannot enter the evidence-required ladder"
assert_eq "false" "$(ENGINE_SCORECARD_DIR="$SCDIR" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --check-scorecard --field reviewer_qualified)" "legacy field gate remains false"
assert_eq "[]" "$(ENGINE_SCORECARD_DIR="$SCDIR" REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --check-scorecard --field fallback_ladder)" "legacy field ladder remains empty"

# 18. --check-scorecard with NO matching row fail-closes as unqualified
EMPTY_SCDIR="$TEST_TMP/check-miss"
mkdir -p "$EMPTY_SCDIR"
MISS_OUT="$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard)"
assert_eq "false" "$(json_get "$MISS_OUT" reviewer_qualified)" "missing reviewer scorecard row => reviewer_qualified false"
assert_eq "[]" "$(json_get "$MISS_OUT" fallback_ladder)" "missing reviewer scorecard row still emits fallback ladder"
assert_eq "0" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard >/dev/null 2>&1; echo $?)" "missing reviewer scorecard row without --enforce exits 0"
assert_eq "3" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --enforce >/dev/null 2>&1; echo $?)" "missing reviewer scorecard row with --enforce exits 3"
assert_eq "false" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --field reviewer_qualified)" "field reviewer_qualified false for missing reviewer row"
assert_eq "[]" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --field fallback_ladder)" "field fallback_ladder [] for missing reviewer row"

# 19. --check-scorecard with FAILED or EXPIRED row also fail-closes and still emits ladder
FAILDIR="$TEST_TMP/check-failed"
mkdir -p "$FAILDIR"
RECFAIL_JSON="$FAILDIR/rec.json"
cat > "$RECFAIL_JSON" <<'JSON'
{"engine":"gpt-5.5","runner":"codex","family":"openai","role":"reviewer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"failed","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$FAILDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECFAIL_JSON" > /dev/null
FAIL_LADDER="$(ENGINE_SCORECARD_DIR="$FAILDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" ladder --role reviewer --implementer-family openai)"
FAIL_OUT="$(ENGINE_SCORECARD_DIR="$FAILDIR" bash "$SCRIPT" --check-scorecard)"
assert_eq "false" "$(json_get "$FAIL_OUT" reviewer_qualified)" "failed reviewer row => reviewer_qualified false"
assert_eq "$FAIL_LADDER" "$(json_get "$FAIL_OUT" fallback_ladder)" "failed row still emits fallback ladder"
assert_eq "3" "$(ENGINE_SCORECARD_DIR="$FAILDIR" bash "$SCRIPT" --check-scorecard --enforce >/dev/null 2>&1; echo $?)" "failed reviewer row with --enforce exits 3"

# 20. --check-scorecard surfaces implementer scorecard inadmissibility in capability_warnings
# (BACKLOG "Implementer scorecard lapses on runner-version drift, silently degrading every /l5")
GROK_IMPL_CFG="$TEST_TMP/impl-grok.md"
printf -- '- implementer_engine: grok-4.5\n- implementer_runner: grok\n' > "$GROK_IMPL_CFG"
# 20a. Missing row → loud warning at roster resolution
IMPLMISS_DIR="$TEST_TMP/impl-miss"
mkdir -p "$IMPLMISS_DIR"
IMPLMISS_OUT="$(ENGINE_SCORECARD_DIR="$IMPLMISS_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_contains "$(json_get "$IMPLMISS_OUT" capability_warnings)" "implementer seat (grok-4.5/grok) is not admissible: no scorecard row" \
  "missing implementer row surfaces a capability warning under --check-scorecard"
# 20b. Calendar tooth pulled 2026-08-22 (no-confidence-decay P1/P2): a
# past-expires qualified row is now admissible (status=provisional,
# observed_status=qualified) — expires is advisory-only and never downgrades
# admissibility here either. No implementer warning; was "loud warning naming
# the expired status" pre-cut.
IMPLEXP_DIR="$TEST_TMP/impl-expired"
mkdir -p "$IMPLEXP_DIR"
cat > "$IMPLEXP_DIR/rec.json" <<'JSON'
{"engine":"grok-4.5","runner":"grok","family":"xai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"2/2","false_pass_critical":0},"capability_score":1,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2026-07-14"}
JSON
ENGINE_SCORECARD_DIR="$IMPLEXP_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$IMPLEXP_DIR/rec.json" > /dev/null
IMPLEXP_OUT="$(ENGINE_SCORECARD_DIR="$IMPLEXP_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_not_contains "$(json_get "$IMPLEXP_OUT" capability_warnings)" "implementer seat" \
  "past-expires implementer row is admissible (calendar tooth pulled), no implementer warning"
# 20c. Admissible (fresh) row → NO implementer warning; warning absent without --check-scorecard
IMPLOK_DIR="$TEST_TMP/impl-ok"
mkdir -p "$IMPLOK_DIR"
cat > "$IMPLOK_DIR/rec.json" <<'JSON'
{"engine":"grok-4.5","runner":"grok","family":"xai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"2/2","false_pass_critical":0},"capability_score":1,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$IMPLOK_DIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$IMPLOK_DIR/rec.json" > /dev/null
IMPLOK_OUT="$(ENGINE_SCORECARD_DIR="$IMPLOK_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_not_contains "$(json_get "$IMPLOK_OUT" capability_warnings)" "implementer seat" \
  "admissible implementer row emits no implementer warning"
IMPLOFF_OUT="$(ENGINE_SCORECARD_DIR="$IMPLMISS_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT")"
assert_not_contains "$(json_get "$IMPLOFF_OUT" capability_warnings)" "implementer seat" \
  "without --check-scorecard the implementer admissibility check does not run"
# 20d. P7/KR6: an operator override file flips the warning to a loud evidence-free notice
cat > "$TEST_TMP/qual-override.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"grok-4.5","runner":"grok","role":"implementer","reason":"first-use audition","operator":"cookys","expires":"2099-01-01"}]}
JSON
IMPLOVR_OUT="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$TEST_TMP/qual-override.json" ENGINE_SCORECARD_DIR="$IMPLMISS_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_contains "$(json_get "$IMPLOVR_OUT" capability_warnings)" "EVIDENCE-FREE operator override" \
  "override file flips the warning to a loud evidence-free notice"
assert_contains "$(json_get "$IMPLOVR_OUT" capability_warnings)" "first-use audition" \
  "override reason surfaces in the warning"
cat > "$TEST_TMP/qual-override-malformed.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"grok-4.5","runner":"grok","role":"implementer","reason":"malformed expiry","operator":"cookys","expires":"forever"}]}
JSON
IMPLOVR_BAD_OUT="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$TEST_TMP/qual-override-malformed.json" ENGINE_SCORECARD_DIR="$IMPLMISS_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_not_contains "$(json_get "$IMPLOVR_BAD_OUT" capability_warnings)" "EVIDENCE-FREE operator override" \
  "malformed override expiry never advertises admission"
assert_contains "$(json_get "$IMPLOVR_BAD_OUT" capability_warnings)" "no scorecard row" \
  "malformed override expiry preserves refusal guidance"
cat > "$TEST_TMP/qual-override-no-operator.json" <<'JSON'
{"schema":1,"overrides":[{"engine":"grok-4.5","runner":"grok","role":"implementer","reason":"missing operator","expires":"2099-01-01"}]}
JSON
IMPLOVR_NO_OPERATOR_OUT="$(AUTOPILOT_QUALIFICATION_OVERRIDE="$TEST_TMP/qual-override-no-operator.json" ENGINE_SCORECARD_DIR="$IMPLMISS_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$GROK_IMPL_CFG" bash "$SCRIPT" --check-scorecard)"
assert_not_contains "$(json_get "$IMPLOVR_NO_OPERATOR_OUT" capability_warnings)" "EVIDENCE-FREE operator override" \
  "override without operator never advertises admission"

EXPDIR="$TEST_TMP/check-expired"
mkdir -p "$EXPDIR"
RECEXPIRED_JSON="$EXPDIR/rec.json"
cat > "$RECEXPIRED_JSON" <<'JSON'
{"engine":"gpt-5.5","runner":"codex","family":"openai","role":"reviewer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-01-01","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"expired","qualified_at":"2026-01-01","expires":"2026-01-02"}
JSON
ENGINE_SCORECARD_DIR="$EXPDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECEXPIRED_JSON" > /dev/null
EXP_LADDER="$(ENGINE_SCORECARD_DIR="$EXPDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" ladder --role reviewer --implementer-family openai)"
EXP_OUT="$(ENGINE_SCORECARD_DIR="$EXPDIR" bash "$SCRIPT" --check-scorecard)"
assert_eq "false" "$(json_get "$EXP_OUT" reviewer_qualified)" "expired reviewer row => reviewer_qualified false"
assert_eq "$EXP_LADDER" "$(json_get "$EXP_OUT" fallback_ladder)" "expired row still emits fallback ladder"
# 20. capability-state report-only / demotion-only tests
CAP_TEST_DIR="$TEST_TMP/cap-store"
mkdir -p "$CAP_TEST_DIR"

# A. Empty store test (capability state is enabled by default)
# Omitting --capability-state (or empty store) keeps capability state unknown.
# MiniMax calibration is a resolver diagnostic, not an operational capability warning.
EMPTY_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT")"
assert_eq "unknown" "$(json_get "$EMPTY_OUT" capability_state_source)" "empty store => capability_state_source is unknown"
assert_eq "unknown" "$(json_get "$EMPTY_OUT" quota_status)" "empty store => quota_status is unknown"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$EMPTY_OUT" capability_warnings)" "empty store => no operational capability warning"

# B. --capability-state off test
OFF_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT" --capability-state off)"
assert_eq "none" "$(json_get "$OFF_OUT" capability_state_source)" "--capability-state off => capability_state_source is none"
assert_eq "unknown" "$(json_get "$OFF_OUT" quota_status)" "--capability-state off => quota_status is unknown"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$OFF_OUT" capability_warnings)" "--capability-state off => no operational capability warning"

# C. Record a fresh exhausted/high implementer event
cat <<'JSON' > "$TEST_TMP/event-exhausted.json"
{
  "schema_version": 1,
  "observed_at": "2026-07-02T20:00:00Z",
  "runner": "codex",
  "model": "gpt-5.3-codex-spark",
  "role": "implementer",
  "capability": {
    "quota": {
      "status": "exhausted",
      "confidence": "high",
      "ttl_seconds": 3600
    }
  }
}
JSON
ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/event-exhausted.json" > /dev/null

# D. Query fresh event (now is 2026-07-02T20:30:00Z -> within 3600s TTL)
# ISOLATED: the store fixtures are keyed to runner=codex/model=gpt-5.3-codex-spark, so pin
# that implementer via CODEX_IMPL_CFG — the resolver matches capability by runner+model and
# the live roster's grok/grok-4.5 implementer would never match (giving a false "unknown").
FRESH_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T20:30:00Z)"
assert_eq "store" "$(json_get "$FRESH_OUT" capability_state_source)" "valid store query => capability_state_source is store"
assert_eq "exhausted" "$(json_get "$FRESH_OUT" quota_status)" "fresh exhausted quota => quota_status is exhausted"
assert_contains "$(json_get "$FRESH_OUT" capability_warnings)" "Demoted implementer" "fresh exhausted high event => demotion warning is present"

# E. Query expired event (now is 2026-07-02T22:00:00Z -> past 3600s TTL)
EXPIRED_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T22:00:00Z)"
assert_eq "unknown" "$(json_get "$EXPIRED_OUT" quota_status)" "expired quota => quota_status is unknown"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$EXPIRED_OUT" capability_warnings)" "expired quota => no demotion warning"

# F. Record an unknown event and verify no demotion/warning.
# Use an ISOLATED store — CAP_TEST_DIR already holds a fresh EXHAUSTED event for this same
# runner/model/role (from the demotion test above), and by design an `unknown` observation
# does NOT clobber a still-valid known signal (engine-capability-state.js J1 rule). Testing
# "unknown => no demotion" in isolation requires a store with no prior exhausted event.
UNK_STORE="$TEST_TMP/cap-unknown"
cat <<'JSON' > "$TEST_TMP/event-unknown.json"
{
  "schema_version": 1,
  "observed_at": "2026-07-02T20:00:00Z",
  "runner": "codex",
  "model": "gpt-5.3-codex-spark",
  "role": "implementer",
  "capability": {
    "quota": {
      "status": "unknown",
      "confidence": "high",
      "ttl_seconds": 3600
    }
  }
}
JSON
ENGINE_CAPABILITY_DIR="$UNK_STORE" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/event-unknown.json" > /dev/null
UNK_OUT="$(ENGINE_CAPABILITY_DIR="$UNK_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T20:30:00Z)"
assert_eq "unknown" "$(json_get "$UNK_OUT" quota_status)" "quota status unknown => quota_status is unknown"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$UNK_OUT" capability_warnings)" "quota status unknown => no demotion warning"

# G. Native skill warning tests
cat <<'JSON' > "$TEST_TMP/event-skill-unsupported.json"
{
  "schema_version": 1,
  "observed_at": "2026-07-02T20:00:00Z",
  "runner": "codex",
  "model": "gpt-5.3-codex-spark",
  "role": "implementer",
  "capability": {
    "quota": {
      "status": "available",
      "confidence": "high",
      "ttl_seconds": 3600
    },
    "skill_transport": {
      "native": "unsupported",
      "prompt_pack": "supported"
    }
  }
}
JSON
ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/event-skill-unsupported.json" > /dev/null

# G1. Request skill mode native -> should produce warning
SKILL_NATIVE_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T20:30:00Z --skill-mode native)"
assert_eq "native" "$(json_get "$SKILL_NATIVE_OUT" skill_mode_requested)" "skill_mode_requested matches native"
assert_eq "native" "$(json_get "$SKILL_NATIVE_OUT" skill_mode_effective)" "skill_mode_effective matches native"
assert_contains "$(json_get "$SKILL_NATIVE_OUT" capability_warnings)" "does not support native skills" "native skill warning is present"

# G2. Request skill mode auto -> native is unsupported, but prompt_pack is supported -> should resolve to prompt and no warning
SKILL_AUTO_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T20:30:00Z --skill-mode auto)"
assert_eq "auto" "$(json_get "$SKILL_AUTO_OUT" skill_mode_requested)" "skill_mode_requested matches auto"
assert_eq "prompt" "$(json_get "$SKILL_AUTO_OUT" skill_mode_effective)" "skill_mode_effective resolves to prompt"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$SKILL_AUTO_OUT" capability_warnings)" "auto fallback to prompt => no warning"

# G3. Record skill support supported, request skill mode auto -> should resolve to native
cat <<'JSON' > "$TEST_TMP/event-skill-supported.json"
{
  "schema_version": 1,
  "observed_at": "2026-07-02T20:00:00Z",
  "runner": "codex",
  "model": "gpt-5.3-codex-spark",
  "role": "implementer",
  "capability": {
    "quota": {
      "status": "available",
      "confidence": "high",
      "ttl_seconds": 3600
    },
    "skill_transport": {
      "native": "supported",
      "prompt_pack": "supported"
    }
  }
}
JSON
ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/event-skill-supported.json" > /dev/null
SKILL_AUTO_OK_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --now 2026-07-02T20:30:00Z --skill-mode auto)"
assert_eq "native" "$(json_get "$SKILL_AUTO_OK_OUT" skill_mode_effective)" "native supported => skill_mode_effective resolves to native"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$SKILL_AUTO_OK_OUT" capability_warnings)" "native supported => no warning"

# H. L4 unchanged test
L4_CFG="$TEST_TMP/l4-cfg.md"
printf -- '- implementer_engine: claude-3-5-sonnet\n- implementer_runner: auto\n' > "$L4_CFG"
cat <<'JSON' > "$TEST_TMP/event-claude-exhausted.json"
{
  "schema_version": 1,
  "observed_at": "2026-07-02T20:00:00Z",
  "runner": "codex",
  "model": "claude-3-5-sonnet",
  "role": "implementer",
  "capability": {
    "quota": {
      "status": "exhausted",
      "confidence": "high",
      "ttl_seconds": 3600
    }
  }
}
JSON
ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" node "$REPO_ROOT/scripts/engine-capability-state.js" record --file "$TEST_TMP/event-claude-exhausted.json" > /dev/null
L4_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$L4_CFG" ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT" --now 2026-07-02T20:30:00Z --skill-mode native)"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$L4_OUT" capability_warnings)" "L4 path (Claude implementer) => no demotion or native skill warning is ever emitted"

# 20. reviewer_endpoint / implementer_endpoint (declarative invoke infra)
# ISOLATED: the repo dogfood config sets reviewer_endpoint=minimax (Board decision A),
# so pin the UNCONFIGURED default via EMPTY_CFG to test the true empty-endpoint semantics.
EP_DEFAULT_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT")"
assert_eq "" "$(json_get "$EP_DEFAULT_OUT" reviewer_endpoint)" "default reviewer_endpoint is empty"
assert_eq "" "$(json_get "$EP_DEFAULT_OUT" implementer_endpoint)" "default implementer_endpoint is empty"

EP_CFG="$TEST_TMP/ep-config.md"
printf -- '- reviewer_endpoint: glm\n- implementer_endpoint: minimax\n' > "$EP_CFG"
EP_SET_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EP_CFG" bash "$SCRIPT")"
assert_eq "glm" "$(json_get "$EP_SET_OUT" reviewer_endpoint)" "reviewer_endpoint read from config"
assert_eq "minimax" "$(json_get "$EP_SET_OUT" implementer_endpoint)" "implementer_endpoint read from config"
assert_eq "glm" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EP_CFG" bash "$SCRIPT" --field reviewer_endpoint)" "--field reviewer_endpoint"
assert_eq "minimax" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EP_CFG" bash "$SCRIPT" --field implementer_endpoint)" "--field implementer_endpoint"

# invalid endpoint name (injection guard) → dropped to empty, stderr warns
EP_BAD_CFG="$TEST_TMP/ep-bad.md"
printf -- '- implementer_endpoint: bad;rm -rf\n' > "$EP_BAD_CFG"
EP_BAD_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EP_BAD_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_eq "" "$(json_get "$EP_BAD_OUT" implementer_endpoint)" "invalid implementer_endpoint dropped to empty"
node -e 'JSON.parse(require("fs").readFileSync(0))' <<<"$EP_BAD_OUT" >/dev/null 2>&1 && assert_eq ok ok "output still valid JSON after bad endpoint" || fail "bad-endpoint JSON invalid: $EP_BAD_OUT"

# 21. Default verification density scaling (feature off)
DENS_OFF_OUT="$(bash "$SCRIPT")"
assert_not_contains "$DENS_OFF_OUT" "capability_tier" "feature off -> no capability_tier"
assert_not_contains "$DENS_OFF_OUT" "density_scaled" "feature off -> no density_scaled"
assert_not_contains "$DENS_OFF_OUT" "density_source" "feature off -> no density_source"
assert_not_contains "$DENS_OFF_OUT" "verify_first" "feature off -> no verify_first"
assert_eq "5" "$(json_get "$DENS_OFF_OUT" loop_max_rounds)" "feature off -> max rounds unchanged"
assert_eq "2" "$(bash "$SCRIPT" --field capability_tier >/dev/null 2>&1; echo $?)" "capability_tier field fails when feature off"
assert_eq "2" "$(bash "$SCRIPT" --field verify_first >/dev/null 2>&1; echo $?)" "verify_first field fails when feature off"

# 22. --scale-by-capability with no implementer row -> unknown tier, fail-closed scaling
DENS_UNK_STORE="$TEST_TMP/dens-unk"
mkdir -p "$DENS_UNK_STORE"
# ISOLATED (§22–23): CODEX_IMPL_CFG pins the openai/codex implementer so the scorecard
# tier fixtures match by engine+runner AND the risk baseline is low (openai high-trust) —
# the live roster's grok/xai implementer would give a false "unknown" tier + high baseline.
DENS_UNK_OUT="$(ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability)"
assert_eq "unknown" "$(json_get "$DENS_UNK_OUT" capability_tier)" "no implementer row -> unknown tier"
assert_eq "true" "$(json_get "$DENS_UNK_OUT" density_scaled)" "unknown tier -> density_scaled true"
assert_eq "flag" "$(json_get "$DENS_UNK_OUT" density_source)" "source is flag"
assert_eq "7" "$(json_get "$DENS_UNK_OUT" loop_max_rounds)" "bumped max rounds (+2 default 5 = 7)"
assert_eq "2" "$(json_get "$DENS_UNK_OUT" required_review_families)" "bumped review families to 2"
assert_eq "true" "$(json_get "$DENS_UNK_OUT" l1_required)" "l1_required is true"
assert_eq "false" "$(json_get "$DENS_UNK_OUT" verify_first)" "unknown tier -> verify_first false"
assert_eq "unknown" "$(ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability --field capability_tier)" "field capability_tier unknown"
assert_eq "false" "$(ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability --field verify_first)" "field verify_first false for unknown tier"
assert_eq "false" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$R2F1CFG" ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" bash "$SCRIPT" --scale-by-capability --field cross_family_satisfied)" "density-scaled with 1 distinct non-impl family -> satisfied=false"

# 23. A caller-written disk "qualified" row remains unknown and can only increase verification.
DENS_HIGH_STORE="$TEST_TMP/dens-high"
mkdir -p "$DENS_HIGH_STORE"
RECIMPL_HIGH_JSON="$DENS_HIGH_STORE/rec.json"
cat > "$RECIMPL_HIGH_JSON" <<'JSON'
{"engine":"gpt-5.3-codex-spark","runner":"codex","family":"openai","role":"implementer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$DENS_HIGH_STORE" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECIMPL_HIGH_JSON" > /dev/null
DENS_HIGH_OUT="$(ENGINE_SCORECARD_DIR="$DENS_HIGH_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability)"
assert_eq "unknown" "$(json_get "$DENS_HIGH_OUT" capability_tier)" "disk qualified telemetry cannot become high tier"
assert_eq "true" "$(json_get "$DENS_HIGH_OUT" density_scaled)" "untrusted disk row triggers conservative scaling"
assert_eq "7" "$(json_get "$DENS_HIGH_OUT" loop_max_rounds)" "untrusted disk row cannot reduce review rounds"
assert_eq "2" "$(json_get "$DENS_HIGH_OUT" required_review_families)" "untrusted disk row increases family assurance"
assert_eq "true" "$(json_get "$DENS_HIGH_OUT" l1_required)" "untrusted disk row requires L1"
assert_eq "false" "$(json_get "$DENS_HIGH_OUT" verify_first)" "untrusted disk row cannot enable verify-first shortcut"
assert_eq "false" "$(ENGINE_SCORECARD_DIR="$DENS_HIGH_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability --field verify_first)" "field verify_first stays false for disk telemetry"

DENS_HIGH_BASE1_CFG="$TEST_TMP/dens-high-base1.md"
printf -- '- loop_max_rounds: 1\n' > "$DENS_HIGH_BASE1_CFG"
DENS_HIGH_BASE1_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$DENS_HIGH_BASE1_CFG" ENGINE_SCORECARD_DIR="$DENS_HIGH_STORE" bash "$SCRIPT" --scale-by-capability)"
assert_eq "3" "$(json_get "$DENS_HIGH_BASE1_OUT" loop_max_rounds)" "disk telemetry + base rounds 1 -> conservatively adds 2"
assert_eq "false" "$(json_get "$DENS_HIGH_BASE1_OUT" verify_first)" "disk telemetry never enables verify-first"

DENS_HIGH_RISK_OUT="$(ENGINE_SCORECARD_DIR="$DENS_HIGH_STORE" REVIEW_LOOP_CONFIG_OVERRIDE="$CODEX_IMPL_CFG" bash "$SCRIPT" --scale-by-capability --security-surface 1)"
assert_eq "unknown" "$(json_get "$DENS_HIGH_RISK_OUT" capability_tier)" "disk telemetry stays unknown on high risk"
assert_eq "true" "$(json_get "$DENS_HIGH_RISK_OUT" density_scaled)" "disk telemetry conservatively scales high risk"
assert_eq "7" "$(json_get "$DENS_HIGH_RISK_OUT" loop_max_rounds)" "disk telemetry cannot reduce high-risk rounds"
assert_eq "2" "$(json_get "$DENS_HIGH_RISK_OUT" required_review_families)" "high-risk family requirement remains"
assert_eq "true" "$(json_get "$DENS_HIGH_RISK_OUT" l1_required)" "high-risk l1 requirement remains"
assert_eq "false" "$(json_get "$DENS_HIGH_RISK_OUT" verify_first)" "high-risk disk telemetry cannot enable verify-first"

# 24. Config density_scaling: on -> scales via config (unknown tier)
DENS_CFG="$TEST_TMP/dens-on.md"
printf -- '- density_scaling: on\n' > "$DENS_CFG"
DENS_CFG_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$DENS_CFG" ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" bash "$SCRIPT")"
assert_eq "unknown" "$(json_get "$DENS_CFG_OUT" capability_tier)" "config on -> unknown tier"
assert_eq "true" "$(json_get "$DENS_CFG_OUT" density_scaled)" "config on -> scaled"
assert_eq "config" "$(json_get "$DENS_CFG_OUT" density_source)" "source is config"
assert_eq "7" "$(json_get "$DENS_CFG_OUT" loop_max_rounds)" "max rounds scaled"
assert_eq "false" "$(json_get "$DENS_CFG_OUT" verify_first)" "config on unknown tier -> verify_first false"

# 25. Config density_scaling: garbage -> feature off
DENS_GARBAGE_CFG="$TEST_TMP/dens-garbage.md"
printf -- '- density_scaling: banana\n' > "$DENS_GARBAGE_CFG"
DENS_GARBAGE_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$DENS_GARBAGE_CFG" bash "$SCRIPT")"
assert_not_contains "$DENS_GARBAGE_OUT" "capability_tier" "garbage config -> feature off"
assert_not_contains "$DENS_GARBAGE_OUT" "density_scaled" "garbage config -> feature off"
assert_not_contains "$DENS_GARBAGE_OUT" "verify_first" "garbage config -> feature off"

# 26. Cap max rounds bump to 7
DENS_CAP_CFG="$TEST_TMP/dens-cap.md"
printf -- '- loop_max_rounds: 6\n- density_scaling: on\n' > "$DENS_CAP_CFG"
DENS_CAP_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$DENS_CAP_CFG" ENGINE_SCORECARD_DIR="$DENS_UNK_STORE" bash "$SCRIPT")"
assert_eq "7" "$(json_get "$DENS_CAP_OUT" loop_max_rounds)" "max rounds bumped from 6 to cap 7"

# 27. Unknown implementer family + single-distinct-family panel — the qc2-security crash repro.
# Must emit JSON gracefully (no set -u abort). required=1 (low risk): legacy-compat satisfied=true.
UNK_IMPL_CFG="$TEST_TMP/unk-impl.md"
printf -- '- implementer_engine: my-custom-model-v1\n- qc_panel: gpt-5.5, gpt-5.3-codex-spark\n' > "$UNK_IMPL_CFG"
UNK_LOW_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UNK_IMPL_CFG" bash "$SCRIPT" --source-trust high 2>/dev/null)"; UNK_LOW_EXIT=$?
assert_eq "0" "$UNK_LOW_EXIT" "unknown impl + 1-family panel: exits 0 (no unbound-variable crash)"
assert_contains "$UNK_LOW_OUT" '"cross_family_satisfied"' "unknown impl low risk: JSON emitted"
assert_eq "true" "$(json_get "$UNK_LOW_OUT" cross_family_satisfied)" "unknown impl + 1 family at required=1: legacy-compat satisfied=true"

# 28. Same config at HIGH risk (required=2): graceful JSON, satisfied=false, --enforce exit 3.
UNK_HIGH_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UNK_IMPL_CFG" bash "$SCRIPT" --security-surface 1 2>/dev/null)"; UNK_HIGH_EXIT=$?
assert_eq "0" "$UNK_HIGH_EXIT" "unknown impl + 1-family panel at high risk: exits 0 with JSON"
assert_eq "false" "$(json_get "$UNK_HIGH_OUT" cross_family_satisfied)" "unknown impl + 1 family at required=2: satisfied=false"
REVIEW_LOOP_CONFIG_OVERRIDE="$UNK_IMPL_CFG" bash "$SCRIPT" --security-surface 1 --enforce >/dev/null 2>&1; UNK_ENFORCE_EXIT=$?
assert_eq "3" "$UNK_ENFORCE_EXIT" "unknown impl + 1 family at required=2 --enforce: exit 3 (blocks)"

# 29. Unknown implementer + TWO distinct known families at required=2: pigeonhole -> satisfied=true.
UNK2_CFG="$TEST_TMP/unk-impl-2fam.md"
printf -- '- implementer_engine: my-custom-model-v1\n- qc_panel: gpt-5.5, claude-opus\n' > "$UNK2_CFG"
UNK2_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$UNK2_CFG" bash "$SCRIPT" --security-surface 1 2>/dev/null)"
assert_eq "true" "$(json_get "$UNK2_OUT" cross_family_satisfied)" "unknown impl + 2 distinct families at required=2: satisfied=true (pigeonhole)"

# 30. min_panel_size — family-agnostic panel-size floor, STANDALONE from required_review_families
#     (lens diversity != family decorrelation; same-family lenses can still share blind spots).
assert_eq "3" "$(bash "$SCRIPT" --field min_panel_size)" "default min_panel_size is 3"
assert_contains "$(bash "$SCRIPT")" '"min_panel_size": 3' "default JSON carries min_panel_size as an integer"
# legal override honored
MPS_CFG="$TEST_TMP/mps.md"
printf -- '- min_panel_size: 5\n' > "$MPS_CFG"
assert_eq "5" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_CFG" bash "$SCRIPT" --field min_panel_size)" "legal min_panel_size override honored"
# garbage -> fail-safe 3
MPS_BAD="$TEST_TMP/mps-bad.md"
printf -- '- min_panel_size: banana\n' > "$MPS_BAD"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_BAD" bash "$SCRIPT" --field min_panel_size)" "garbage min_panel_size falls back to 3"
# 0 (below the >=1 floor) -> fail-safe 3
MPS_ZERO="$TEST_TMP/mps-zero.md"
printf -- '- min_panel_size: 0\n' > "$MPS_ZERO"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_ZERO" bash "$SCRIPT" --field min_panel_size)" "min_panel_size 0 (below >=1 floor) falls back to 3"
# negative -> fail-safe 3
MPS_NEG="$TEST_TMP/mps-neg.md"
printf -- '- min_panel_size: -2\n' > "$MPS_NEG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_NEG" bash "$SCRIPT" --field min_panel_size)" "negative min_panel_size falls back to 3"
# INDEPENDENCE from required_review_families (the whole point): a min_panel_size override must
# NOT move required_review_families, and forcing high risk (families=2) must NOT move min_panel_size.
assert_eq "1" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_CFG" bash "$SCRIPT" --field required_review_families)" "min_panel_size override leaves required_review_families untouched"
assert_eq "3" "$(bash "$SCRIPT" --security-surface 1 --field min_panel_size)" "high risk (families=2) leaves min_panel_size at default 3"
assert_eq "2" "$(bash "$SCRIPT" --security-surface 1 --field required_review_families)" "sanity: high risk sets required_review_families=2"
# present in the --check-scorecard JSON branch too
assert_contains "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard)" '"min_panel_size": 3' "min_panel_size present in --check-scorecard JSON"
# present when density_scaling is on (emitted before the density FMT_SUFFIX keys — ordering guard)
MPS_DENS="$TEST_TMP/mps-dens.md"
printf -- '- density_scaling: on\n' > "$MPS_DENS"
assert_contains "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MPS_DENS" ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT")" '"min_panel_size": 3' "min_panel_size present when density_scaling on (before FMT_SUFFIX)"

# risk-tiered low-risk reviewer overlay: ADDITIVE fields, empty = tiering off
# (caller uses reviewer_engine/effort unchanged). Non-empty pair = the loop
# reviewer for computed review_risk=low; high risk always uses reviewer_engine.
# HERMETIC default probe: the autopilot repo now ships a dogfood
# .claude/review-loop-config.md that SETS the low-risk pair (precedence slot 3),
# so "no override" is no longer the neutral default inside this repo — pin the
# default semantics through an explicit keyless config instead.
EMPTY_LR_CFG="$TEST_TMP/lr-empty.md"
: > "$EMPTY_LR_CFG"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_LR_CFG" bash "$SCRIPT" 2>&1)"
assert_contains "$OUT" '"reviewer_engine_low_risk": ""' "default low-risk engine empty"
assert_contains "$OUT" '"reviewer_effort_low_risk": ""' "default low-risk effort empty"

LR_CFG="$TEST_TMP/lr.md"
printf -- '- reviewer_engine_low_risk: gpt-5.6-sol\n- reviewer_effort_low_risk: high\n' > "$LR_CFG"
assert_eq "gpt-5.6-sol" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$LR_CFG" bash "$SCRIPT" --field reviewer_engine_low_risk)" "low-risk engine override honored"
assert_eq "high" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$LR_CFG" bash "$SCRIPT" --field reviewer_effort_low_risk)" "low-risk effort override honored"
assert_contains "$(REVIEW_LOOP_CONFIG_OVERRIDE="$LR_CFG" bash "$SCRIPT")" '"reviewer_engine_low_risk": "gpt-5.6-sol"' "low-risk engine in full JSON"

# garbage low-risk effort → EMPTY (tiering off, never a bogus effort), warn on stderr
LRB_CFG="$TEST_TMP/lrb.md"
printf -- '- reviewer_engine_low_risk: gpt-5.6-sol\n- reviewer_effort_low_risk: turbo\n' > "$LRB_CFG"
assert_eq "" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$LRB_CFG" bash "$SCRIPT" --field reviewer_effort_low_risk 2>/dev/null)" "garbage low-risk effort falls back to empty"
LRB_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$LRB_CFG" bash "$SCRIPT" --field reviewer_effort_low_risk 2>&1 >/dev/null)"
assert_contains "$LRB_ERR" "reviewer_effort_low_risk" "garbage low-risk effort warns on stderr"

# on_family_conflict: always-emitted enum, default fallback, garbage → block (fail-closed)
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_LR_CFG" bash "$SCRIPT" 2>&1)"
assert_contains "$OUT" '"on_family_conflict": "fallback"' "default on_family_conflict is fallback"
OFC_CFG="$TEST_TMP/ofc.md"
printf -- '- on_family_conflict: block\n' > "$OFC_CFG"
assert_eq "block" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$OFC_CFG" bash "$SCRIPT" --field on_family_conflict)" "on_family_conflict block honored"
printf -- '- on_family_conflict: banana\n' > "$OFC_CFG"
assert_eq "block" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$OFC_CFG" bash "$SCRIPT" --field on_family_conflict 2>/dev/null)" "garbage on_family_conflict fails closed to block"

# reviewer_fallback_preference (+_low_risk): always-emitted arrays, default []
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_LR_CFG" bash "$SCRIPT" 2>&1)"
assert_contains "$OUT" '"reviewer_fallback_preference": []' "default fallback preference empty array"
assert_contains "$OUT" '"reviewer_fallback_preference_low_risk": []' "default low-risk fallback preference empty array"
PREF_CFG="$TEST_TMP/pref.md"
printf -- '- reviewer_fallback_preference: claude-opus, MiniMax-M3\n- reviewer_fallback_preference_low_risk: claude-haiku\n' > "$PREF_CFG"
assert_contains "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PREF_CFG" bash "$SCRIPT")" '"reviewer_fallback_preference": ["claude-opus", "MiniMax-M3"]' "preference list parsed to array"
assert_contains "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PREF_CFG" bash "$SCRIPT")" '"reviewer_fallback_preference_low_risk": ["claude-haiku"]' "low-risk preference list parsed"

# --check-scorecard fallback_ladder carries implementer-family provenance
SC_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_LR_CFG" ENGINE_SCORECARD_DIR="${EMPTY_SCDIR:-$TEST_TMP/empty-sc}" bash "$SCRIPT" --check-scorecard 2>/dev/null)"
assert_contains "$SC_OUT" '"fallback_ladder_implementer_family"' "ladder provenance key present under --check-scorecard"

# ---------------------------------------------------------------------------
# D1 A01 — behavioral per-field invalid-value proof for every shell-validated
# enum: one garbage value each → documented fallback (or fail-closed exit).
# Soft-fallback enums (effort/flags/aggregation/scope/policy) first; transport
# and hard-fail enums (runners, plan_review, verification_author_present,
# --domain) asserted separately as exit-code contracts.
# ---------------------------------------------------------------------------
ENUM_CFG="$TEST_TMP/enum-invalid.md"
cat > "$ENUM_CFG" <<'CFG'
- reviewer_effort: not-an-effort
- implementer_effort: turbo
- spec_review: maybe
- independent_harness: maybe
- qc_panel_aggregation: majority
- review_diff_scope: partial
- on_engine_unavailable: invent
- on_family_conflict: invent
- provider_readiness_fallback_family_constraint: invent
CFG
ENUM_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$ENUM_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_eq "$(json_get "$ENUM_OUT" reviewer_effort)" "xhigh" "invalid reviewer_effort falls back to xhigh"
assert_eq "$(json_get "$ENUM_OUT" implementer_effort)" "high" "invalid implementer_effort falls back to high"
assert_eq "$(json_get "$ENUM_OUT" spec_review)" "on" "invalid spec_review falls back to on"
assert_eq "$(json_get "$ENUM_OUT" independent_harness)" "on" "invalid independent_harness falls back to on"
assert_eq "$(json_get "$ENUM_OUT" qc_panel_aggregation)" "union-on-verified-critical" "invalid qc_panel_aggregation falls back to union"
assert_eq "$(json_get "$ENUM_OUT" review_diff_scope)" "full" "invalid review_diff_scope falls back to full"
assert_eq "$(json_get "$ENUM_OUT" on_engine_unavailable)" "ask" "invalid on_engine_unavailable falls back to ask"
assert_eq "$(json_get "$ENUM_OUT" on_family_conflict)" "block" "invalid on_family_conflict fails closed to block"
assert_eq "$(json_get "$ENUM_OUT" provider_readiness_fallback_family_constraint)" "different" "invalid readiness family constraint falls back to different"

# Transport-selecting / hard-fail enums fail loudly (documented fail-closed)
RUN_CFG="$TEST_TMP/enum-runner-bad.md"
printf -- '- reviewer_runner: not-a-runner\n' > "$RUN_CFG"
assert_eq "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RUN_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" "3" "invalid reviewer_runner exits 3"
printf -- '- implementer_runner: not-a-runner\n' > "$RUN_CFG"
assert_eq "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RUN_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" "3" "invalid implementer_runner exits 3"
printf -- '- verification_author_present: maybe\n' > "$RUN_CFG"
assert_eq "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RUN_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" "3" "invalid verification_author_present exits 3"
# plan_review widened to auto|on|off per docs/plans/2026-09-04-dev-flow-hetero-loops-default.md; invalid value still exits 3
printf -- '- plan_review: maybe\n' > "$RUN_CFG"
assert_eq "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RUN_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" "3" "invalid plan_review exits 3"
assert_eq "$(bash "$SCRIPT" --domain invent >/dev/null 2>&1; echo $?)" "2" "invalid --domain exits 2"

# D7 A13 — verify_strength density input (fail-safe; protected-path never reduces)
VS_BASE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --source-trust high --diff-lines 10 --field loop_max_rounds)"
VS_WEAK="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --source-trust high --diff-lines 10 --verify-strength weak --field loop_max_rounds)"
VS_STRONG="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --source-trust high --diff-lines 10 --verify-strength strong --field loop_max_rounds)"
VS_STRONG_PROT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --source-trust high --diff-lines 10 --protected-path 1 --verify-strength strong --field loop_max_rounds)"
VS_PROT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --source-trust high --diff-lines 10 --protected-path 1 --field loop_max_rounds)"
# weak raises rounds above base
node -e 'const b=+process.argv[1],w=+process.argv[2]; process.exit(w>b?0:1)' "$VS_BASE" "$VS_WEAK"
assert_eq "$?" "0" "verify_strength=weak increases loop_max_rounds"
# strong may lower (at most -1) when not protected
node -e 'const b=+process.argv[1],s=+process.argv[2]; process.exit(s<=b&&s>=b-1?0:1)' "$VS_BASE" "$VS_STRONG"
assert_eq "$?" "0" "verify_strength=strong reduces by at most one when unprotected"
# strong cannot reduce below protected-path baseline
assert_eq "$VS_STRONG_PROT" "$VS_PROT" "verify_strength=strong cannot reduce protected-path rounds"
assert_eq "$(bash "$SCRIPT" --verify-strength invent >/dev/null 2>&1; echo $?)" "2" "invalid --verify-strength exits 2"

# ── Cascade trigger (four-layer P2): --prior-status elevates risk on the EXISTING path ──
PS_HIGH="$(bash "$SCRIPT" --prior-status no_verdict --diff-lines 10 --source-trust high --oracle-available 1 --security-surface 0 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(d.review_risk+" "+d.required_review_families+" "+d.cross_family_required)});')"
assert_eq "high 2 true" "$PS_HIGH" "prior no_verdict elevates to the existing high-risk escalation (families=2, cross-family)"
PS_DEF="$(bash "$SCRIPT" --diff-lines 10 --source-trust high --oracle-available 1 --security-surface 0 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(d.review_risk+" "+d.required_review_families)});')"
PS_NONE="$(bash "$SCRIPT" --prior-status none --diff-lines 10 --source-trust high --oracle-available 1 --security-surface 0 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(d.review_risk+" "+d.required_review_families)});')"
assert_eq "$PS_DEF" "$PS_NONE" "--prior-status none is byte-identical to the default (existing behavior pinned)"
bash "$SCRIPT" --prior-status bogus --diff-lines 10 2>/dev/null; PS_EXIT=$?
assert_eq "2" "$PS_EXIT" "invalid --prior-status rejected"

# ── Brain-seat standing (P7/KR4, plan 2026-08-17-brain-seat-exam-suite P4) ─────────
BRAIN_TMP="$TEST_TMP/brain-seat"; mkdir -p "$BRAIN_TMP/store"
BRAIN_ID="$BRAIN_TMP/incumbent-identity.json"
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  identity: "brain-model-exact", model_alias: "brain-engine", model_version: "1",
  family: "test-family", runner: "brain-harness", runner_version: "1.0.0",
  harness_version: "h1", effort: "high",
  prompt_config_hash: "a".repeat(64), semantic_fingerprint: "b".repeat(64),
  containment_fingerprint: "c".repeat(64), identity_resolved: true,
}));
' "$BRAIN_ID"
cp "$BRAIN_ID" "$BRAIN_TMP/candidate-identity.json"
BRAIN_CFG="$TEST_TMP/brain-cfg.md"
printf -- '- brain_seat_identity_file: %s\n' "$BRAIN_ID" > "$BRAIN_CFG"

# a config with no brain seat context → field stays null (pinned no-op; the repo's
# own config pins a seat since 2026-08-17, so the no-seat shape uses the fixture)
assert_eq "null" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" bash "$SCRIPT" --field brain_seat 2>/dev/null)" "no seat context => brain_seat null"

# Seat-pin scope guard (review 2026-08-17): the ladder's project-repo fallback
# (caller cwd OUTSIDE any project with its own config) must NOT project the
# autopilot repo's own pin onto the consumer — brain_seat stays null and no
# brain advisory reaches capability_warnings.
BRAIN_FALLBACK_CWD="$TEST_TMP/consumer-no-config"; mkdir -p "$BRAIN_FALLBACK_CWD"
assert_eq "null" "$(cd "$BRAIN_FALLBACK_CWD" && bash "$SCRIPT" --field brain_seat 2>/dev/null)" \
  "project-repo ladder fallback never seats the repo's own brain pin"
_BRAIN_FB_WARN="$(cd "$BRAIN_FALLBACK_CWD" && bash "$SCRIPT" --field capability_warnings 2>/dev/null)"
assert_not_contains "$_BRAIN_FB_WARN" "brain seat" \
  "no brain advisory leaks to consumers through the ladder fallback"

# A RELATIVE pin resolves against the config's project root (dirname(config)/..),
# never the caller's cwd: a caller-cwd project config with a relative pin still
# finds its identity file when invoked from elsewhere via override.
BRAIN_REL_ROOT="$TEST_TMP/rel-pin-project"; mkdir -p "$BRAIN_REL_ROOT/.claude"
cp "$BRAIN_ID" "$BRAIN_REL_ROOT/.claude/rel-identity.json"
printf -- '- brain_seat_identity_file: .claude/rel-identity.json\n' > "$BRAIN_REL_ROOT/.claude/review-loop-config.md"
_BRAIN_REL="$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_REL_ROOT/.claude/review-loop-config.md" \
  ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" bash "$SCRIPT" --field brain_seat 2>/dev/null)"
assert_contains "$_BRAIN_REL" '"status":"no_record"' \
  "relative pin resolves against the config project root, not caller cwd (pre-fix cwd resolution yields status_unavailable, so this pin is mutation-sensitive)"

# incumbent with NO record: loud advisory annotation, never a block
BS_ADV="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" bash "$SCRIPT" 2>/dev/null)"
assert_eq "advisory" "$(json_get "$BS_ADV" brain_seat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).admission))')" \
  "incumbent without standing => advisory (Board 2026-08-16 bootstrap semantics)"
assert_contains "$(json_get "$BS_ADV" capability_warnings)" "engine-qualify.sh brain" \
  "incumbent annotation names the standing-exam path"

# non-incumbent candidate with NO record: hard refusal naming BOTH legal paths
BS_REF="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" \
  AUTOPILOT_BRAIN_SEAT_IDENTITY="$BRAIN_TMP/candidate-identity.json" bash "$SCRIPT" 2>/dev/null)"
assert_eq "refused" "$(json_get "$BS_REF" brain_seat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).admission))')" \
  "candidate without standing => refused (KR4 red case)"
assert_contains "$(json_get "$BS_REF" capability_warnings)" "qualification override" \
  "refusal names the override path too (two-path rule survives)"

# the per-invocation override STILL admits every non-qualified state (no third path)
BRAIN_OVR="$BRAIN_TMP/override.json"
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({ schema: 1, overrides: [{
  engine: "brain-engine", runner: "brain-harness", role: "owner",
  reason: "test drive", expires: "2999-01-01",
}]}));
' "$BRAIN_OVR"
BS_OVR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" \
  AUTOPILOT_BRAIN_SEAT_IDENTITY="$BRAIN_TMP/candidate-identity.json" \
  AUTOPILOT_QUALIFICATION_OVERRIDE="$BRAIN_OVR" bash "$SCRIPT" 2>/dev/null)"
assert_eq "override_admitted" "$(json_get "$BS_OVR" brain_seat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).admission))')" \
  "override admits a candidate with no standing (EVIDENCE-FREE, loud)"
assert_contains "$(json_get "$BS_OVR" capability_warnings)" "EVIDENCE-FREE" \
  "override admission is loudly labelled"

# a real qualified brain record => admitted, silent; 3 strikes => requalification_required
node -e '
const path = require("path");
const { appendEvidenceRecord, appendStrikeRecord, resolveStoreConfig } =
  require(path.join(process.argv[2], "scripts", "engine-capability-state"));
const { compileCapabilityEvidence, BRAIN_CONSTRUCT_SCOPE } =
  require(path.join(process.argv[2], "src", "engine", "capability-evidence"));
const identity = JSON.parse(require("fs").readFileSync(process.argv[3], "utf8"));
const config = resolveStoreConfig({ store: process.argv[1] });
const corpusHash = "d".repeat(64);
const trial = (id) => ({
  trial_id: id, observed_at: "2026-08-17T00:00:00.000Z", stop_reason: "completed",
  construct_scope: BRAIN_CONSTRUCT_SCOPE, plants_total: 6, plants_caught: 6,
  clean_false_positives: 0, fairness_cases_total: 4, fairness_correctness_failures: 0,
  pair_delta_count: 0, hard_fail_count: 0, ask_floor_violations: 0,
  convergence_terminal: true, economy_ok: true, verification_actions: 4,
  findings_closed: 3, spend_tokens: 1000,
  decision_trace_hash: "e".repeat(64), round_stream_hash: "f".repeat(64),
  corpus_manifest_hash: corpusHash,
});
const evidence = compileCapabilityEvidence({
  schema_version: 1, source: "internal_eval", source_ref: "engine-qualify:brain-v1",
  state: "qualified", role: "owner",
  scope: { task_classes: ["brain-seat"], domains: ["repository"], languages: ["en"], tool_surface: [] },
  identity, issued_at: "2026-08-17T00:00:00.000Z", observed_at: "2026-08-17T00:00:00.000Z",
  expires_at: "2026-09-16T00:00:00.000Z",
  methodology: {
    kind: "owner_brain_seat", name: "owner-brain-seat", version: "1.0.0",
    corpus_version: "brain-seat-v1.brain-seat-metamorphic-v1", corpus_manifest_hash: corpusHash,
    thresholds: { min_trials: 2, min_plants_per_trial: 3, max_clean_false_positives: 0,
      max_critical_misses: 0, max_pair_deltas: 0, max_asks_on_legal_controls: 0 },
    basis: null,
  },
  trials: [trial("trial-1"), trial("trial-2")], revocation: null, supersedes: null,
});
appendEvidenceRecord(config, evidence, "engine-qualify-v2");
for (let i = 0; i < 3; i += 1) {
  appendStrikeRecord(config, { identity, source: "fuse", receiptRef: `t${i}`,
    observedAt: `2026-08-18T0${i}:00:00.000Z` });
}
' "$BRAIN_TMP/store" "$REPO_ROOT" "$BRAIN_ID"
BS_REQ="$(REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" \
  AUTOPILOT_BRAIN_SEAT_IDENTITY="$BRAIN_TMP/candidate-identity.json" bash "$SCRIPT" 2>/dev/null)"
assert_eq "requalification_required" "$(json_get "$BS_REQ" brain_seat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).status))')" \
  "3 post-pass strikes => requalification_required"
assert_eq "refused" "$(json_get "$BS_REQ" brain_seat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).admission))')" \
  "requalification_required refuses a candidate exactly like absence (no silent third path)"

# under --enforce the resolver ITSELF is the gate: a refused candidate seating exits 3
REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" \
  AUTOPILOT_BRAIN_SEAT_IDENTITY="$BRAIN_TMP/candidate-identity.json" \
  bash "$SCRIPT" --enforce >/dev/null 2>&1
assert_eq "3" "$?" "--enforce turns a refused brain seating into exit 3 (the shipped enforce rail)"
REVIEW_LOOP_CONFIG_OVERRIDE="$BRAIN_CFG" ENGINE_CAPABILITY_DIR="$BRAIN_TMP/store" \
  bash "$SCRIPT" --enforce >/dev/null 2>&1
assert_eq "0" "$?" "--enforce leaves the incumbent advisory path passing (annotate, never block)"

# ==============================================================================
# D1-2c — new test matrix for plan_review/hetero_review/consult_dispatch auto
# ==============================================================================

# Topology fixtures
TOPO_PRESENT_SEATS="$TEST_TMP/topo-present-seats.json"
cat > "$TOPO_PRESENT_SEATS" <<'JSON'
{
  "plan_review_panel": [
    { "engine": "claude-fable-5", "effort": "high", "runner": "claude-native", "endpoint": "ep-fable" },
    { "engine": "gpt-5.6-sol", "effort": "max", "runner": "codex", "endpoint": "ep-sol" }
  ],
  "reviewer_ladder": [
    { "engine": "gpt-5.5", "effort": "xhigh", "runner": "codex", "endpoint": "" }
  ],
  "consult_ladder": [
    { "engine": "gpt-5.5", "effort": "xhigh", "runner": "codex", "endpoint": "" },
    { "engine": "MiniMax-M3", "effort": "high", "runner": "cc-shim", "endpoint": "" }
  ]
}
JSON

TOPO_ZERO_SEATS="$TEST_TMP/topo-zero-seats.json"
cat > "$TOPO_ZERO_SEATS" <<'JSON'
{
  "plan_review_panel": [],
  "reviewer_ladder": [],
  "consult_ladder": []
}
JSON

TOPO_MALFORMED="$TEST_TMP/topo-malformed.json"
printf -- '{ not-valid-json ]' > "$TOPO_MALFORMED"

TOPO_ABSENT="$TEST_TMP/topo-absent-file.json"

# --- plan_review: auto × 4 topology states ---
PLAN_AUTO_CFG="$TEST_TMP/rl-plan-auto.md"
printf -- '- plan_review: auto\n' > "$PLAN_AUTO_CFG"

# 1. present-with-seats
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto with present-with-seats resolves from topology"
assert_eq "claude-fable-5" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_reviewer_engine)" \
  "plan_reviewer_engine matches plan_review_panel[0]"
assert_eq "high" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_reviewer_effort)" \
  "plan_reviewer_effort matches plan_review_panel[0]"
assert_eq "claude-native" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_reviewer_runner)" \
  "plan_reviewer_runner matches plan_review_panel[0]"
assert_eq "ep-fable" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_reviewer_endpoint)" \
  "plan_reviewer_endpoint matches plan_review_panel[0]"
assert_eq "gpt-5.6-sol" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_deep_reviewer_engine)" \
  "plan_deep_reviewer_engine matches plan_review_panel[1]"
assert_eq "max" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_deep_reviewer_effort)" \
  "plan_deep_reviewer_effort matches plan_review_panel[1]"
assert_eq "codex" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_deep_reviewer_runner)" \
  "plan_deep_reviewer_runner matches plan_review_panel[1]"
assert_eq "ep-sol" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_deep_reviewer_endpoint)" \
  "plan_deep_reviewer_endpoint matches plan_review_panel[1]"

# 2. present-zero-seats
PLAN_ZERO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto with present-zero-seats resolves from native-fallback"
assert_contains "$PLAN_ZERO_OUT" "plan_review" "plan_review native-fallback output names knob (zero-seats)"
assert_contains "$PLAN_ZERO_OUT" "opus/high@claude-native" "plan_review native-fallback output contains fallback tuple (zero-seats)"

# 3. malformed-json
PLAN_MAL_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto with malformed-json resolves from native-fallback"
assert_contains "$PLAN_MAL_OUT" "plan_review" "plan_review native-fallback output names knob (malformed-json)"
assert_contains "$PLAN_MAL_OUT" "opus/high@claude-native" "plan_review native-fallback output contains fallback tuple (malformed-json)"

# 4. absent
PLAN_ABS_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_AUTO_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto with absent topology resolves from native-fallback"
assert_contains "$PLAN_ABS_OUT" "plan_review" "plan_review native-fallback output names knob (absent)"
assert_contains "$PLAN_ABS_OUT" "opus/high@claude-native" "plan_review native-fallback output contains fallback tuple (absent)"

# 5. same-runner collision against the resolved implementer: the second panel
# seat (codex) collides with implementer_runner — auto must skip it and pick
# the surviving first seat (claude-native), never fail closed.
PLAN_COLLIDE_FIRST_CFG="$TEST_TMP/rl-plan-auto-collide-first.md"
printf -- '- plan_review: auto\n- implementer_runner: codex\n- implementer_engine: gpt-5.6-sol\n- reviewer_runner: agy\n- reviewer_engine: gemini-3.8-flash-low\n' > "$PLAN_COLLIDE_FIRST_CFG"
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_COLLIDE_FIRST_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto skips the runner-colliding panel seat and still resolves from topology"
assert_eq "claude-fable-5" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_COLLIDE_FIRST_CFG" bash "$SCRIPT" --field plan_reviewer_engine)" \
  "plan_reviewer_engine is the surviving non-colliding seat when plan_review_panel[1] collides with the implementer runner"
assert_eq "claude-native" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_COLLIDE_FIRST_CFG" bash "$SCRIPT" --field plan_reviewer_runner)" \
  "plan_reviewer_runner is the surviving non-colliding seat, not the implementer's own runner"

# 6. every panel seat collides with the implementer runner: auto falls back
# to native with a capability warning, never fails closed with an empty tuple.
TOPO_ALL_SAME_RUNNER="$TEST_TMP/topo-all-same-runner.json"
cat > "$TOPO_ALL_SAME_RUNNER" <<'JSON'
{
  "plan_review_panel": [
    { "engine": "claude-fable-5", "effort": "high", "runner": "codex", "endpoint": "ep-fable" },
    { "engine": "gpt-5.6-sol", "effort": "max", "runner": "codex", "endpoint": "ep-sol" }
  ],
  "reviewer_ladder": [],
  "consult_ladder": []
}
JSON
PLAN_COLLIDE_ALL_CFG="$TEST_TMP/rl-plan-auto-collide-all.md"
printf -- '- plan_review: auto\n- implementer_runner: codex\n- implementer_engine: gemini-3.8-flash-low\n- reviewer_runner: claude-native\n' > "$PLAN_COLLIDE_ALL_CFG"
PLAN_COLLIDE_ALL_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ALL_SAME_RUNNER" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_COLLIDE_ALL_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ALL_SAME_RUNNER" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_COLLIDE_ALL_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto with every panel seat colliding falls back to native, never fails closed"
assert_contains "$PLAN_COLLIDE_ALL_OUT" "plan_review" "plan_review all-collide native-fallback output names knob"
assert_contains "$PLAN_COLLIDE_ALL_OUT" "opus/high@claude-native" "plan_review all-collide native-fallback output contains fallback tuple"

# 7 (negative control, d1-runner-alias-exclusion): a panel seat spelled with the "codex-cli"
# alias must still collide with an implementer_runner of "codex" under the same-runner-dual-seat
# guard — the two are the same rail and must be canonicalized before comparison.
TOPO_ALIAS_COLLIDE="$TEST_TMP/topo-alias-collide.json"
cat > "$TOPO_ALIAS_COLLIDE" <<'JSON'
{
  "plan_review_panel": [
    { "engine": "gpt-4o-cli", "effort": "high", "runner": "codex-cli", "endpoint": "" },
    { "engine": "claude-fable-5", "effort": "high", "runner": "claude-native", "endpoint": "ep-fable" }
  ],
  "reviewer_ladder": [],
  "consult_ladder": []
}
JSON
PLAN_ALIAS_COLLIDE_CFG="$TEST_TMP/rl-plan-auto-alias-collide.md"
printf -- '- plan_review: auto\n- implementer_runner: codex\n- implementer_engine: gpt-5.6-sol\n- reviewer_runner: agy\n- reviewer_engine: gemini-3.8-flash-low\n' > "$PLAN_ALIAS_COLLIDE_CFG"
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ALIAS_COLLIDE" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_ALIAS_COLLIDE_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "plan_review auto skips the codex-cli panel seat (aliased collision with implementer_runner=codex) and still resolves from topology"
assert_eq "claude-fable-5" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ALIAS_COLLIDE" REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_ALIAS_COLLIDE_CFG" bash "$SCRIPT" --field plan_reviewer_engine)" \
  "plan_reviewer_engine is the surviving seat, not the codex-cli seat that aliases to the implementer's own runner"


# --- hetero_review: auto × 4 topology states ---
HETERO_AUTO_CFG="$TEST_TMP/rl-hetero-auto.md"
printf -- '- hetero_review: auto\n- reviewer_engine: MiniMax-M3\n' > "$HETERO_AUTO_CFG"

# 1. present-with-seats
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "hetero_review auto with present-with-seats resolves from topology"
assert_eq "MiniMax-M3" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" --field reviewer_engine)" \
  "reviewer_engine is UNCHANGED when hetero_review resolves from topology"

# 2. present-zero-seats
HETERO_ZERO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "hetero_review auto with present-zero-seats resolves from native-fallback"
assert_contains "$HETERO_ZERO_OUT" "hetero_review" "hetero_review native-fallback output names knob (zero-seats)"
assert_contains "$HETERO_ZERO_OUT" "capability_warnings" "hetero_review native-fallback output contains capability_warnings (zero-seats)"

# 3. malformed-json
HETERO_MAL_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "hetero_review auto with malformed-json resolves from native-fallback"
assert_contains "$HETERO_MAL_OUT" "hetero_review" "hetero_review native-fallback output names knob (malformed-json)"
assert_contains "$HETERO_MAL_OUT" "capability_warnings" "hetero_review native-fallback output contains capability_warnings (malformed-json)"

# 4. absent
HETERO_ABS_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_AUTO_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "hetero_review auto with absent topology resolves from native-fallback"
assert_contains "$HETERO_ABS_OUT" "hetero_review" "hetero_review native-fallback output names knob (absent)"
assert_contains "$HETERO_ABS_OUT" "capability_warnings" "hetero_review native-fallback output contains capability_warnings (absent)"


# --- consult_dispatch: auto × 4 topology states ---
CONSULT_AUTO_CFG="$TEST_TMP/rl-consult-auto.md"
printf -- '- consult_dispatch: auto\n' > "$CONSULT_AUTO_CFG"

# 1. present-with-seats
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "consult_dispatch auto with present-with-seats resolves from topology"
assert_eq "MiniMax-M3" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_engine)" \
  "consult_engine matches consult_ladder[1] (first non-colliding non-qc seat)"
assert_eq "high" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_effort)" \
  "consult_effort matches consult_ladder[1]"
assert_eq "cc-shim" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_PRESENT_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_runner)" \
  "consult_runner matches consult_ladder[1]"

# 2. present-zero-seats
CONSULT_ZERO_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ZERO_SEATS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "consult_dispatch auto with present-zero-seats resolves from native-fallback"
assert_contains "$CONSULT_ZERO_OUT" "consult_dispatch" "consult_dispatch native-fallback output names knob (zero-seats)"
assert_contains "$CONSULT_ZERO_OUT" "sonnet/high@claude-native" "consult_dispatch native-fallback output contains fallback tuple (zero-seats)"

# 3. malformed-json
CONSULT_MAL_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_MALFORMED" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "consult_dispatch auto with malformed-json resolves from native-fallback"
assert_contains "$CONSULT_MAL_OUT" "consult_dispatch" "consult_dispatch native-fallback output names knob (malformed-json)"
assert_contains "$CONSULT_MAL_OUT" "sonnet/high@claude-native" "consult_dispatch native-fallback output contains fallback tuple (malformed-json)"

# 4. absent
CONSULT_ABS_OUT="$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" 2>&1)"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_AUTO_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "consult_dispatch auto with absent topology resolves from native-fallback"
assert_contains "$CONSULT_ABS_OUT" "consult_dispatch" "consult_dispatch native-fallback output names knob (absent)"
assert_contains "$CONSULT_ABS_OUT" "sonnet/high@claude-native" "consult_dispatch native-fallback output contains fallback tuple (absent)"


# --- Incomplete tuple / on validation ---
# hetero_review: on with DEF_REV_* defaults succeeds because defaults are non-empty; explicit empty reviewer_engine trips exit 3
HETERO_INCOMPLETE_CFG="$TEST_TMP/rl-hetero-incomplete.md"
printf -- '- hetero_review: on\n- reviewer_engine:\n' > "$HETERO_INCOMPLETE_CFG"
HETERO_INCOMPLETE_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_INCOMPLETE_CFG" bash "$SCRIPT" 2>&1)"
HETERO_INCOMPLETE_EXIT=$?
assert_eq "3" "$HETERO_INCOMPLETE_EXIT" "hetero_review=on with empty reviewer_engine exits 3"
assert_contains "$HETERO_INCOMPLETE_OUT" "hetero_review=on requires" "hetero_review=on missing tuple message diagnosed"

# hetero_review: on with default reviewer tuple succeeds (exit 0) and resolved_from is explicit
HETERO_ON_DEF_CFG="$TEST_TMP/rl-hetero-on-default.md"
printf -- '- hetero_review: on\n' > "$HETERO_ON_DEF_CFG"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_ON_DEF_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "hetero_review=on with default reviewer tuple succeeds (exit 0)"
assert_eq "explicit" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$HETERO_ON_DEF_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "hetero_review_resolved_from is explicit when hetero_review is on"

# plan_reviewer_runner: bogus with plan_review: on exits 3
PLAN_BOGUS_RUNNER_CFG="$TEST_TMP/rl-plan-bogus-runner.md"
printf -- '- plan_review: on\n- plan_reviewer_engine: claude-fable-5\n- plan_reviewer_runner: bogus\n- plan_reviewer_effort: high\n' > "$PLAN_BOGUS_RUNNER_CFG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_BOGUS_RUNNER_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "plan_reviewer_runner bogus exits 3"


# --- Consult exclusion ---
TOPO_CONSULT_EXCL="$TEST_TMP/topo-consult-excl.json"
cat > "$TOPO_CONSULT_EXCL" <<'JSON'
{
  "consult_ladder": [
    { "engine": "gpt-5.5", "effort": "xhigh", "runner": "codex", "endpoint": "" },
    { "engine": "MiniMax-M3", "effort": "high", "runner": "cc-shim", "endpoint": "" }
  ]
}
JSON
CONSULT_EXCL_CFG="$TEST_TMP/rl-consult-excl.md"
printf -- '- consult_dispatch: auto\n- qc_panel: gpt-5.5, claude-opus, gemini-flash\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n' > "$CONSULT_EXCL_CFG"
assert_eq "MiniMax-M3" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_CFG" bash "$SCRIPT" --field consult_engine)" \
  "consult_engine picks consult_ladder[1] when [0] is in qc_panel"
assert_eq "cc-shim" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_CFG" bash "$SCRIPT" --field consult_runner)" \
  "consult_runner picks consult_ladder[1] when [0] is in qc_panel"
assert_eq "high" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_CFG" bash "$SCRIPT" --field consult_effort)" \
  "consult_effort picks consult_ladder[1] when [0] is in qc_panel"
assert_eq "topology" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "consult_resolved_from is topology after exclusion"

# Negative control (d1-runner-alias-exclusion): qc_panel_runners spelled "codex" must still
# exclude a consult_ladder[0] seat whose topology runner is the "codex-cli" alias — the two are
# the same rail and the exclusion tuple-key must canonicalize before comparison.
TOPO_CONSULT_EXCL_ALIAS="$TEST_TMP/topo-consult-excl-alias.json"
cat > "$TOPO_CONSULT_EXCL_ALIAS" <<'JSON'
{
  "consult_ladder": [
    { "engine": "gpt-5.5", "effort": "xhigh", "runner": "codex-cli", "endpoint": "" },
    { "engine": "MiniMax-M3", "effort": "high", "runner": "cc-shim", "endpoint": "" }
  ]
}
JSON
CONSULT_EXCL_ALIAS_CFG="$TEST_TMP/rl-consult-excl-alias.md"
printf -- '- consult_dispatch: auto\n- qc_panel: gpt-5.5, claude-opus, gemini-flash\n- qc_panel_runners: codex, claude-native, agy\n- qc_panel_efforts: xhigh, high, high\n' > "$CONSULT_EXCL_ALIAS_CFG"
assert_eq "MiniMax-M3" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL_ALIAS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_ALIAS_CFG" bash "$SCRIPT" --field consult_engine)" \
  "consult_engine picks consult_ladder[1] when [0] (codex-cli) is excluded by a qc_panel_runners entry spelled codex"
assert_eq "cc-shim" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_EXCL_ALIAS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_EXCL_ALIAS_CFG" bash "$SCRIPT" --field consult_runner)" \
  "consult_runner picks consult_ladder[1] when [0] is excluded via the codex/codex-cli alias"

# Negative control (d1-runner-alias-exclusion): implementer_runner=codex must still collide with
# a consult_ladder seat whose topology runner is the "codex-cli" alias under the
# same-runner-dual-seat guard.
TOPO_CONSULT_COLLIDE_ALIAS="$TEST_TMP/topo-consult-collide-alias.json"
cat > "$TOPO_CONSULT_COLLIDE_ALIAS" <<'JSON'
{
  "consult_ladder": [
    { "engine": "gpt-4o-cli", "effort": "high", "runner": "codex-cli", "endpoint": "" },
    { "engine": "MiniMax-M3", "effort": "high", "runner": "cc-shim", "endpoint": "" }
  ]
}
JSON
CONSULT_COLLIDE_ALIAS_CFG="$TEST_TMP/rl-consult-collide-alias.md"
printf -- '- consult_dispatch: auto\n- implementer_runner: codex\n- implementer_engine: gpt-5.6-sol\n- reviewer_runner: agy\n- reviewer_engine: gemini-3.8-flash-low\n' > "$CONSULT_COLLIDE_ALIAS_CFG"
assert_eq "MiniMax-M3" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_CONSULT_COLLIDE_ALIAS" REVIEW_LOOP_CONFIG_OVERRIDE="$CONSULT_COLLIDE_ALIAS_CFG" bash "$SCRIPT" --field consult_engine)" \
  "consult_engine skips consult_ladder[0] (codex-cli, aliased collision with implementer_runner=codex) under the same-runner-dual-seat guard"


# --- Absent-knob pre-template config ---
PRE_TEMPLATE_CFG="$TEST_TMP/rl-pre-template.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n- reviewer_engine: gpt-5.5\n- allow_same_runner_dual_seat: on\n' > "$PRE_TEMPLATE_CFG"
assert_eq "auto" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field plan_review)" \
  "absent-knob config defaults plan_review to auto"
assert_eq "auto" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field hetero_review)" \
  "absent-knob config defaults hetero_review to auto"
assert_eq "auto" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field consult_dispatch)" \
  "absent-knob config defaults consult_dispatch to auto"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field plan_review_resolved_from)" \
  "absent-knob config plan_review_resolved_from is native-fallback"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field hetero_review_resolved_from)" \
  "absent-knob config hetero_review_resolved_from is native-fallback"
assert_eq "native-fallback" "$(AUTOPILOT_TOPOLOGY_FILE="$TOPO_ABSENT" REVIEW_LOOP_CONFIG_OVERRIDE="$PRE_TEMPLATE_CFG" bash "$SCRIPT" --field consult_resolved_from)" \
  "absent-knob config consult_resolved_from is native-fallback"


# --- Misspelled value per knob ---
MISSPELL_PLAN_CFG="$TEST_TMP/rl-misspell-plan.md"
printf -- '- plan_review: atuo\n' > "$MISSPELL_PLAN_CFG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MISSPELL_PLAN_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "misspelled plan_review: atuo exits 3"

MISSPELL_HETERO_CFG="$TEST_TMP/rl-misspell-hetero.md"
printf -- '- hetero_review: onn\n' > "$MISSPELL_HETERO_CFG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MISSPELL_HETERO_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "misspelled hetero_review: onn exits 3"

MISSPELL_CONSULT_CFG="$TEST_TMP/rl-misspell-consult.md"
printf -- '- consult_dispatch: Auto\n' > "$MISSPELL_CONSULT_CFG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$MISSPELL_CONSULT_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "misspelled consult_dispatch: Auto (case-sensitive) exits 3"

finalize_test
