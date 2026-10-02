#!/usr/bin/env bash
# resolve-review-loop.sh integration test, shard b: sections 7-20 (qc_panel, risk, enforce, scorecard, capability-state). No network.
# Split from resolve-review-loop.test.sh; shared setup in lib/rrl-common.sh.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/rrl-common.sh"

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
# The implementer_* lines are stripped along with the brain identity. What these
# assertions are about is capability_state_source / quota_status / capability
# warnings under an EMPTY store — the project's seat CHOICE is incidental to
# them. Copying it in made the fixture a function of whichever seat this repo
# happens to name today: when the implementer moved to a pin-admitted cursor
# seat on 2026-09-12, an empty store correctly refused that seat and six
# assertions here went red for a reason that had nothing to do with what they
# check. Stripping the seat lets the resolver fall back to its built-in default,
# which is what "ambient" was always meant to mean here.
if [ -f "$REPO_ROOT/.claude/review-loop-config.md" ]; then
  grep -v -e 'brain_seat_identity_file' -e '^- implementer_' \
    "$REPO_ROOT/.claude/review-loop-config.md" > "$AMBIENT_NO_BRAIN"
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
EXPECTED_KEYS='"reviewer_engine":"reviewer_effort":"reviewer_runner":"implementer_engine":"implementer_effort":"implementer_runner":"implementer_ladder":"ladder_start_rung_judgment":"loop_max_rounds":"loop_convergence_verdict":"spec_review":"independent_harness":"qc_panel":"qc_panel_aggregation":"in_rail_review":"review_risk":"required_review_families":"l1_required":"cross_family_required":"cross_family_satisfied":"review_diff_scope":"review_packet_deny_extra":"source":"work_domain":"domain_source":"capability_state_source":"quota_status":"quota_reset_at":"skill_mode_requested":"skill_mode_effective":"capability_warnings":"reviewer_endpoint":"reviewer_family":"implementer_endpoint":"verification_author_present":"verification_author_engine":"verification_author_runner":"verification_author_effort":"verification_author_endpoint":"verification_author_family":"implementer_family":"config_path":"min_panel_size":"on_engine_unavailable":"reviewer_engine_low_risk":"reviewer_effort_low_risk":"on_family_conflict":"reviewer_fallback_preference":"reviewer_fallback_preference_low_risk":"qc_panel_seats":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"role":"runner":"model":"effort":"endpoint":"family":"qc_panel_seats_complete":"provider_readiness_receipt_ttl_seconds":"provider_readiness_fallback_family_constraint":"strict_l5_policy_override":"brain_seat":"plan_review":"plan_review_resolved_from":"plan_review_same_family_as_depth0":"hetero_review":"hetero_review_resolved_from":"plan_reviewer_engine":"plan_reviewer_effort":"plan_reviewer_runner":"plan_reviewer_endpoint":"plan_deep_reviewer_engine":"plan_deep_reviewer_effort":"plan_deep_reviewer_runner":"plan_deep_reviewer_endpoint":"plan_review_max_generations":"plan_review_max_wall_seconds":"plan_review_growth_warn_ratio":"plan_review_growth_stop_ratio":"consult_engine":"consult_effort":"consult_runner":"consult_endpoint":"discuss_engine":"discuss_effort":"discuss_runner":"discuss_endpoint":"consult_dispatch":"consult_resolved_from":"discuss_dispatch":"unknown_escalation":"unknown_budget_u1":"unknown_budget_u2":"unknown_budget_u3":"unknown_resolved_from":"allow_same_runner_dual_seat":"same_runner_dual_seat":"override_admitted_seats":'
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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$EMPTY_OUT" capability_warnings)" "empty store => capability_warnings is only the three topology-fallback lines (no operational warning added)"

# B. --capability-state off test
OFF_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$AMBIENT_NO_BRAIN" ENGINE_CAPABILITY_DIR="$CAP_TEST_DIR" bash "$SCRIPT" --capability-state off)"
assert_eq "none" "$(json_get "$OFF_OUT" capability_state_source)" "--capability-state off => capability_state_source is none"
assert_eq "unknown" "$(json_get "$OFF_OUT" quota_status)" "--capability-state off => quota_status is unknown"
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$OFF_OUT" capability_warnings)" "--capability-state off => capability_warnings is only the three topology-fallback lines (no operational warning added)"

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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$EXPIRED_OUT" capability_warnings)" "expired quota => capability_warnings is only the three topology-fallback lines (no demotion warning added)"

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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$UNK_OUT" capability_warnings)" "quota status unknown => capability_warnings is only the three topology-fallback lines (no demotion warning added)"

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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$SKILL_AUTO_OUT" capability_warnings)" "auto fallback to prompt => capability_warnings is only the three topology-fallback lines (no native-skill warning added)"

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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$SKILL_AUTO_OK_OUT" capability_warnings)" "native supported => capability_warnings is only the three topology-fallback lines (no native-skill warning added)"

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
assert_eq '["plan_review auto: no qualified plan-review seat on this host — falling back to opus/high@claude-native. The chair now shares the depth-0 family: an empty finding list from it is indistinguishable from a clean review, same_family_as_depth0=true","hetero_review auto: no qualified hetero reviewer on this host — reviewer_* stays native","consult_dispatch auto: no qualified consult seat on this host after qc_panel exclusion — falling back to sonnet/high@claude-native"]' "$(json_get "$L4_OUT" capability_warnings)" "L4 path (Claude implementer) => capability_warnings is only the three topology-fallback lines (no demotion or native-skill warning added)"


finalize_test
