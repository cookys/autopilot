#!/usr/bin/env bash
# resolve-review-loop.sh integration test — default roster, --field, enum
# fallback on garbage, and override precedence. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# Keep default-path assertions hermetic when the surrounding agent/session exports
# resolver overrides or live engine-state paths.
unset REVIEW_LOOP_CONFIG_OVERRIDE ENGINE_CAPABILITY_DIR ENGINE_CAPABILITY_FILE ENGINE_SCORECARD_DIR

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
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- implementer_runner: codex\n' > "$CODEX_IMPL_CFG"

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
assert_contains "$OUT" '"verification_author_engine": "Gemini 3.5 Flash (High)"' "default verification_author_engine"
assert_contains "$OUT" '"verification_author_runner": "agy"' "default verification_author_runner"
assert_contains "$OUT" '"verification_author_effort": "high"' "default verification_author_effort"
assert_contains "$OUT" '"verification_author_endpoint": ""' "default verification_author_endpoint"
assert_contains "$OUT" '"verification_author_family": "google"' "default derived verification_author_family"
assert_contains "$OUT" '"implementer_family": "xai"' "default derived implementer_family"
assert_contains "$OUT" '"config_path": "'"$REPO_ROOT/.claude/review-loop-config.md"'"' "default config_path is repo dogfood absolute path"
assert_contains "$OUT" '"loop_convergence_verdict": "SHIP-AS-IS"' "default convergence verdict"
assert_contains "$OUT" '"review_risk": "high"' "default review_risk (xai impl → low-trust → high by design)"
assert_contains "$OUT" '"required_review_families": 2' "default required_review_families"
assert_contains "$OUT" '"l1_required": true' "default l1_required"
assert_contains "$OUT" '"cross_family_required": true' "default cross_family_required"
assert_contains "$OUT" '"cross_family_satisfied": true' "default cross_family_satisfied"

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
assert_eq "Gemini 3.5 Flash (High)" "$(bash "$SCRIPT" --field verification_author_engine)" "--field verification_author_engine"
assert_eq "agy" "$(bash "$SCRIPT" --field verification_author_runner)" "--field verification_author_runner"
assert_eq "high" "$(bash "$SCRIPT" --field verification_author_effort)" "--field verification_author_effort"
assert_eq "" "$(bash "$SCRIPT" --field verification_author_endpoint)" "--field verification_author_endpoint"
assert_eq "google" "$(bash "$SCRIPT" --field verification_author_family)" "--field verification_author_family"
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
printf -- '- implementer_runner: qoderclicn\n- implementer_engine: Qwen3.8-Max-Preview\n- reviewer_runner: qoderclicn\n- reviewer_engine: Qwen3.8-Max-Preview\n' > "$QCFG"
assert_eq "qoderclicn" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QCFG" bash "$SCRIPT" --field implementer_runner)" "qoderclicn implementer_runner honored"
assert_eq "qoderclicn" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QCFG" bash "$SCRIPT" --field reviewer_runner)" "qoderclicn reviewer_runner honored"
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
assert_contains "$OUT" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-flash"]' "default qc_panel array emitted"
assert_contains "$OUT" '"qc_panel_aggregation": "union-on-verified-critical"' "default aggregation"
assert_eq "gpt-5.5 claude-opus gemini-flash" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --field qc_panel)" "--field qc_panel space-joined"
assert_eq "true" "$(json_get "$OUT" qc_panel_seats_complete)" \
  "built-in panel has a complete exact-tuple roster"
assert_eq '[{"role":"qc","runner":"codex","model":"gpt-5.5","effort":"xhigh","endpoint":null,"family":"openai"},{"role":"qc","runner":"claude-native","model":"claude-opus","effort":"high","endpoint":null,"family":"anthropic"},{"role":"qc","runner":"agy","model":"gemini-flash","effort":"high","endpoint":null,"family":"google"}]' \
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
assert_contains "$AC_OUT" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-flash", "grok-4.5", "MiniMax-M3"]' "all-calibrated preset expands to the 5-family roster"
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

# case/trim handling check
AC_CFG_CASE="$TEST_TMP/all-calibrated-case.md"
printf -- '- qc_panel:   All-Calibrated  \n' > "$AC_CFG_CASE"
AC_OUT_CASE="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AC_CFG_CASE" bash "$SCRIPT")"
assert_contains "$AC_OUT_CASE" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-flash", "grok-4.5", "MiniMax-M3"]' "all-calibrated preset case/trim is handled correctly"

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

# 13. --auto-domain inserts exactly two keys at JSON tail (legacy output is unchanged prefix)
BASE_JSON="$(bash "$SCRIPT")"
AUTO_JSON="$(bash "$SCRIPT" --auto-domain HEAD..HEAD)"
AUTO_WD="$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field work_domain)"
AUTO_SOURCE="$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field domain_source)"
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
EXPECTED_KEYS='"reviewer_engine":"reviewer_effort":"reviewer_runner":"implementer_engine":"implementer_effort":"implementer_runner":"loop_max_rounds":"loop_convergence_verdict":"spec_review":"independent_harness":"qc_panel":"qc_panel_aggregation":"review_risk":"required_review_families":"l1_required":"cross_family_required":"cross_family_satisfied":"review_diff_scope":"source":"work_domain":"domain_source":"capability_state_source":"quota_status":"quota_reset_at":"skill_mode_requested":"skill_mode_effective":"capability_warnings":"reviewer_endpoint":"implementer_endpoint":"verification_author_present":"verification_author_engine":"verification_author_runner":"verification_author_effort":"verification_author_endpoint":"verification_author_family":"implementer_family":"config_path":"min_panel_size":"on_engine_unavailable":"reviewer_engine_low_risk":"reviewer_effort_low_risk":"on_family_conflict":"reviewer_fallback_preference":"reviewer_fallback_preference_low_risk":"qc_panel_seats":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"qc_panel_seats_complete":"provider_readiness_receipt_ttl_seconds":"provider_readiness_fallback_family_constraint":"plan_review":"plan_reviewer_engine":"plan_reviewer_effort":"plan_reviewer_runner":"plan_reviewer_endpoint":"plan_deep_reviewer_engine":"plan_deep_reviewer_effort":"plan_deep_reviewer_runner":"plan_deep_reviewer_endpoint":"plan_review_max_generations":"plan_review_max_wall_seconds":"plan_review_growth_warn_ratio":"plan_review_growth_stop_ratio":'
ACTUAL_KEYS="$(printf '%s' "$AUTO_JSON" | grep -oE '"[a-z0-9_]+":' | tr -d '\n')"
assert_eq "$EXPECTED_KEYS" "$ACTUAL_KEYS" "JSON schema key order is exact, including newly surfaced provenance keys"

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
# Omitting --capability-state (or empty store) => source: unknown, status: unknown, warnings: []
EMPTY_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT")"
assert_eq "unknown" "$(json_get "$EMPTY_OUT" capability_state_source)" "empty store => capability_state_source is unknown"
assert_eq "unknown" "$(json_get "$EMPTY_OUT" quota_status)" "empty store => quota_status is unknown"
assert_eq "[]" "$(json_get "$EMPTY_OUT" capability_warnings)" "empty store => capability_warnings is empty []"

# B. --capability-state off test
OFF_OUT="$(ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT" --capability-state off)"
assert_eq "none" "$(json_get "$OFF_OUT" capability_state_source)" "--capability-state off => capability_state_source is none"
assert_eq "unknown" "$(json_get "$OFF_OUT" quota_status)" "--capability-state off => quota_status is unknown"
assert_eq "[]" "$(json_get "$OFF_OUT" capability_warnings)" "--capability-state off => capability_warnings is empty []"

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
assert_eq "[]" "$(json_get "$EXPIRED_OUT" capability_warnings)" "expired quota => no demotion warning"

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
assert_eq "[]" "$(json_get "$UNK_OUT" capability_warnings)" "quota status unknown => no demotion warning"

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
assert_eq "[]" "$(json_get "$SKILL_AUTO_OUT" capability_warnings)" "auto fallback to prompt => no warning"

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
assert_eq "[]" "$(json_get "$SKILL_AUTO_OK_OUT" capability_warnings)" "native supported => no warning"

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
assert_eq "[]" "$(json_get "$L4_OUT" capability_warnings)" "L4 path (Claude implementer) => no demotion or native skill warning is ever emitted"

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

finalize_test
