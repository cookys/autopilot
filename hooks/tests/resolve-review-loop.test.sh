#!/usr/bin/env bash
# resolve-review-loop.sh integration test — default roster, --field, enum
# fallback on garbage, and override precedence. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"

# 1. --help exits 0
HELP_OUT="$(bash "$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit code"
assert_contains "$HELP_OUT" "review-loop" "--help mentions review-loop"

# 2. unknown flag → exit 2
OUT="$(bash "$SCRIPT" --bogus x 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown flag exit code"

# 3. default (template) JSON carries the codex roster + is parseable
OUT="$(bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default exit code"
assert_contains "$OUT" '"reviewer_engine": "gpt-5.5"' "default reviewer engine"
assert_contains "$OUT" '"implementer_engine": "gpt-5.3-codex-spark"' "default implementer (codex, NOT agy on this repo)"
assert_contains "$OUT" '"loop_convergence_verdict": "SHIP-AS-IS"' "default convergence verdict"
assert_contains "$OUT" '"review_risk": "low"' "default review_risk"
assert_contains "$OUT" '"required_review_families": 1' "default required_review_families"
assert_contains "$OUT" '"l1_required": false' "default l1_required"
assert_contains "$OUT" '"cross_family_required": true' "default cross_family_required"
assert_contains "$OUT" '"cross_family_satisfied": true' "default cross_family_satisfied"

# 4. --field accessors
assert_eq "gpt-5.5" "$(bash "$SCRIPT" --field reviewer_engine)" "--field reviewer_engine"
assert_eq "xhigh" "$(bash "$SCRIPT" --field reviewer_effort)" "--field reviewer_effort"
assert_eq "on" "$(bash "$SCRIPT" --field independent_harness)" "--field independent_harness"
assert_eq "low" "$(bash "$SCRIPT" --field review_risk)" "--field review_risk"
assert_eq "1" "$(bash "$SCRIPT" --field required_review_families)" "--field required_review_families"
assert_eq "false" "$(bash "$SCRIPT" --field l1_required)" "--field l1_required"
assert_eq "true" "$(bash "$SCRIPT" --field cross_family_required)" "--field cross_family_required"
assert_eq "true" "$(bash "$SCRIPT" --field cross_family_satisfied)" "--field cross_family_satisfied"

# 5. unknown field → exit 2
OUT="$(bash "$SCRIPT" --field nope 2>&1)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown field exit code"

# 6. override precedence + enum fallback on garbage
CFG="$TEST_TMP/rl.md"
printf -- '- reviewer_effort: turbo\n- implementer_runner: rocket\n- loop_max_rounds: notanum\n- implementer_engine: my-local-model\n' > "$CFG"
assert_eq "xhigh" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field reviewer_effort)" "bad effort falls back to default"
assert_eq "auto" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field implementer_runner)" "bad runner falls back to default"
assert_eq "5" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field loop_max_rounds)" "non-numeric rounds falls back to default"
assert_eq "my-local-model" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field implementer_engine)" "valid override value is honored"
assert_eq "override" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG" bash "$SCRIPT" --field source)" "override source reported"

# 7. qc_panel (v2.25.9): default array + aggregation default
OUT="$(bash "$SCRIPT")"
assert_contains "$OUT" '"qc_panel": ["gpt-5.5", "claude-opus", "gemini-flash"]' "default qc_panel array emitted"
assert_contains "$OUT" '"qc_panel_aggregation": "union-on-verified-critical"' "default aggregation"
assert_eq "gpt-5.5 claude-opus gemini-flash" "$(bash "$SCRIPT" --field qc_panel)" "--field qc_panel space-joined"

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
assert_eq "high" "$(bash "$SCRIPT" --diff-lines 200 --field review_risk)" "large diff sets high risk"
assert_eq "low" "$(bash "$SCRIPT" --diff-lines 10 --field review_risk)" "small diff keeps low risk"

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

finalize_test
