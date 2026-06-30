#!/usr/bin/env bash
# resolve-review-loop.sh integration test — default roster, --field, enum
# fallback on garbage, and override precedence. No network.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/resolve-review-loop.sh"
json_get() { # json key -> raw json value
  local json="$1" key="$2"
  JSON_VALUE="$json" node - "$key" <<'NODE'
const fs = require('fs');
const payload = process.env.JSON_VALUE || '';
const key = process.argv[1];
if (!payload) process.exit(0);
const parsed = JSON.parse(payload);
const value = parsed && parsed[key];
if (value === undefined) process.exit(0);
process.stdout.write(JSON.stringify(value));
NODE
}

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

# 6b. new hetero runners are accepted (v2.26.6–2.26.8): grok (impl+reviewer), cc-shim (impl).
#     Regression guard — these were silently reset to default before the enums were widened.
NCFG="$TEST_TMP/rl-new-runners.md"
printf -- '- implementer_runner: cc-shim\n- implementer_engine: MiniMax-M3\n- reviewer_runner: grok\n- reviewer_engine: grok-build\n' > "$NCFG"
assert_eq "cc-shim" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$NCFG" bash "$SCRIPT" --field implementer_runner)" "cc-shim implementer_runner honored"
assert_eq "grok" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$NCFG" bash "$SCRIPT" --field reviewer_runner)" "grok reviewer_runner honored"
RCFG="$TEST_TMP/rl-ccshim-rev.md"
printf -- '- reviewer_runner: cc-shim\n- reviewer_engine: MiniMax-M3\n' > "$RCFG"
assert_eq "cc-shim" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$RCFG" bash "$SCRIPT" --field reviewer_runner)" "cc-shim reviewer_runner honored (dispatch-review supports it since v2.26.10)"
GCFG="$TEST_TMP/rl-grok-impl.md"
printf -- '- implementer_runner: grok\n- implementer_engine: grok-composer-2.5-fast\n' > "$GCFG"
assert_eq "grok" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$GCFG" bash "$SCRIPT" --field implementer_runner)" "grok implementer_runner honored"
# family_of recognises xai (grok) ≠ minimax (impl). Panel is grok-build ALONE so the result
# can ONLY come from grok being a real (xai) family — an UNKNOWN family never satisfies
# cross-family (fail-closed), so this would be false if family_of didn't know grok.
XFCFG="$TEST_TMP/rl-xfamily.md"
printf -- '- implementer_runner: cc-shim\n- implementer_engine: MiniMax-M3\n- qc_panel: grok-build\n' > "$XFCFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$XFCFG" bash "$SCRIPT" --field cross_family_satisfied)" "lone grok (xai) panel member satisfies cross-family vs a minimax implementer"

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

# 12. probe telemetry fields + invalid --domain enum
assert_eq "mixed" "$(bash "$SCRIPT" --field work_domain)" "--field work_domain"
assert_eq "none" "$(bash "$SCRIPT" --field domain_source)" "--field domain_source"
assert_eq "2" "$(bash "$SCRIPT" --domain nope >/dev/null 2>&1; echo $?)" "--domain invalid returns usage exit 2"

# 13. --auto-domain inserts exactly two keys at JSON tail (legacy output is unchanged prefix)
BASE_JSON="$(bash "$SCRIPT")"
AUTO_JSON="$(bash "$SCRIPT" --auto-domain HEAD..HEAD)"
AUTO_WD="$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field work_domain)"
AUTO_SOURCE="$(bash "$SCRIPT" --auto-domain HEAD..HEAD --field domain_source)"
BASE_LEGACY_PREFIX="$(printf '%s' "$BASE_JSON" | sed 's/, "work_domain": "[^"]*", "domain_source": "[^"]*" }$/ }/')"
BASE_PREFIX="$(printf '%s' "$BASE_LEGACY_PREFIX" | sed 's/ }$//')"
assert_eq "${BASE_PREFIX}, \"work_domain\": \"${AUTO_WD}\", \"domain_source\": \"${AUTO_SOURCE}\" }" "$AUTO_JSON" "auto output is exact legacy prefix + inserted keys"
assert_eq "none" "$AUTO_SOURCE" "empty auto-diff range keeps domain_source=none"

# 13b. round-2 reviewer 🟡 — a NON-self-referential KR2 schema lock. The prefix check
#      above derives its baseline by stripping the new keys from the already-modified
#      output, so a rename/reorder/drop of a PRE-EXISTING field would slip through.
#      Pin the exact key NAMES + ORDER (independent of values): the 19 legacy keys,
#      then work_domain, then domain_source — nothing else, nothing moved.
EXPECTED_KEYS='"reviewer_engine":"reviewer_effort":"reviewer_runner":"implementer_engine":"implementer_effort":"implementer_runner":"loop_max_rounds":"loop_convergence_verdict":"spec_review":"independent_harness":"qc_panel":"qc_panel_aggregation":"review_risk":"required_review_families":"l1_required":"cross_family_required":"cross_family_satisfied":"review_diff_scope":"source":"work_domain":"domain_source":'
ACTUAL_KEYS="$(printf '%s' "$AUTO_JSON" | grep -oE '"[a-z0-9_]+":' | tr -d '\n')"
assert_eq "$EXPECTED_KEYS" "$ACTUAL_KEYS" "JSON schema is EXACTLY the 19 legacy keys + work_domain + domain_source, in order (catches old-field drift/reorder/drop)"

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

# 17. --check-scorecard with a qualified reviewer row emits true + ladder from scorecard
SCDIR="$TEST_TMP/check-ok"
mkdir -p "$SCDIR"
RECQUAL_JSON="$SCDIR/rec.json"
cat > "$RECQUAL_JSON" <<'JSON'
{"engine":"gpt-5.5","runner":"codex","family":"openai","role":"reviewer","model_version":"v1","version_source":"manual","corpus_version":"c@1","harness_version":"h@1","runner_version":"rv1","prompt_config_hash":"ph","date":"2026-06-30","quality":{"corpus_pass":"10/10","false_pass_critical":0,"specificity":"3/3"},"capability_score":0.9,"cost":{"source":"manual","usd_per_mtok_input":0.0,"usd_per_mtok_output":0.0},"latency":{"sample_wall_time_s":0},"status":"qualified","qualified_at":"2026-06-30","expires":"2099-01-01"}
JSON
ENGINE_SCORECARD_DIR="$SCDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" record --file "$RECQUAL_JSON" > /dev/null
EXPECTED_LADDER="$(ENGINE_SCORECARD_DIR="$SCDIR" node "$REPO_ROOT/scripts/engine-scorecard.js" ladder --role reviewer)"
QUAL_OUT="$(ENGINE_SCORECARD_DIR="$SCDIR" bash "$SCRIPT" --check-scorecard)"
assert_eq "true" "$(json_get "$QUAL_OUT" reviewer_qualified)" "qualified reviewer row => reviewer_qualified true"
assert_eq "$EXPECTED_LADDER" "$(json_get "$QUAL_OUT" fallback_ladder)" "fallback_ladder matches scorecard ladder output"

# 18. --check-scorecard with NO matching row fail-closes as unqualified
EMPTY_SCDIR="$TEST_TMP/check-miss"
mkdir -p "$EMPTY_SCDIR"
MISS_OUT="$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard)"
assert_eq "false" "$(json_get "$MISS_OUT" reviewer_qualified)" "missing reviewer scorecard row => reviewer_qualified false"
assert_eq "[]" "$(json_get "$MISS_OUT" fallback_ladder)" "missing reviewer scorecard row still emits fallback ladder"
assert_eq "0" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard >/dev/null 2>&1; echo $?)" "missing reviewer scorecard row without --enforce exits 0"
assert_eq "3" "$(ENGINE_SCORECARD_DIR="$EMPTY_SCDIR" bash "$SCRIPT" --check-scorecard --enforce >/dev/null 2>&1; echo $?)" "missing reviewer scorecard row with --enforce exits 3"

finalize_test
