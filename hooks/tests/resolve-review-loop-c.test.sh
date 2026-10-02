#!/usr/bin/env bash
# resolve-review-loop.sh integration test, shard c: sections 20-30 plus enum fallbacks (endpoints, density, min_panel_size). No network.
# Split from resolve-review-loop.test.sh; shared setup in lib/rrl-common.sh.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/rrl-common.sh"

# Fixtures defined in earlier sections of the original file (now shard a/b).
R2F1CFG="$TEST_TMP/r2f1.md"
printf -- '- implementer_engine: gpt-5.3-codex-spark\n- qc_panel: claude-opus, claude-sonnet\n' > "$R2F1CFG"
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

EMPTY_SCDIR="$TEST_TMP/check-miss"
mkdir -p "$EMPTY_SCDIR"

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
# plan_review widened to auto|on|off per docs/plans/_archive/2026/09/2026-09-04-dev-flow-hetero-loops-default.md; invalid value still exits 3
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


finalize_test
