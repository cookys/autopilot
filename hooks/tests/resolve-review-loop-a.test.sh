#!/usr/bin/env bash
# resolve-review-loop.sh integration test, shard a: sections 1-6c (help, default roster, fields, runners, ladder, plan review). No network.
# Split from resolve-review-loop.test.sh; shared setup in lib/rrl-common.sh.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/rrl-common.sh"

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
#
# FROZEN FIXTURE (2026-09-13, BACKLOG "resolve-review-loop.test.sh asserts on the LIVE
# project config"): the roster assertions below read hooks/tests/fixtures/
# review-loop-config.frozen-2026-09-13.md, a byte copy of the shipped dogfood config at
# freeze time, so a legitimate seat swap in .claude/review-loop-config.md (a vendor
# paywall, 2026-09-12) no longer reds nine assertions that were never about the resolver.
# The LIVE config keeps exactly one assertion — it must still parse and resolve — with a
# message that names the operand.
LIVE_OUT="$(bash "$SCRIPT" 2>&1)"; LIVE_EXIT=$?
assert_eq "0" "$LIVE_EXIT" "LIVE .claude/review-loop-config.md still resolves (exit 0). If this reds after a deliberate seat change, the project config is the operand — fix the config or the resolver, not this assertion"
assert_contains "$LIVE_OUT" '"config_path": "'"$REPO_ROOT/.claude/review-loop-config.md"'"' "LIVE config is the one resolved by default (absolute repo path)"
LIVE_JSON_OK="$(printf '%s' "$LIVE_OUT" | grep '^{' | tail -n1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);process.stdout.write("parsed");}catch{process.stdout.write("unparseable");}})' 2>/dev/null)"
assert_eq "parsed" "$LIVE_JSON_OK" "LIVE config output is parseable JSON"
OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$FROZEN_CFG" bash "$SCRIPT" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "default exit code"
assert_contains "$OUT" '"reviewer_engine": "MiniMax-M3"' "default reviewer engine"
# Board decision A named grok-4.5 @ grok. Moved to grok-4.6 via cursor on
# 2026-09-12 because Grok Build returned 402 Payment Required (balance
# exhausted) and the rail has no automatic stand-in for a quota wall. Same
# vendor family, so implementer_family stays xai and every risk-tier assertion
# below is unchanged. Revert together with the config when the balance returns.
assert_contains "$OUT" '"implementer_engine": "cursor-grok-4.6-low"' "default implementer (grok-4.6 via cursor; Board decision A seat moved 2026-09-12 on a paywall)"
assert_contains "$OUT" '"verification_author_present": true' "default verification_author_present"
assert_contains "$OUT" '"verification_author_engine": "Qwen3.8-Max-Preview"' "default verification_author_engine"
assert_contains "$OUT" '"verification_author_runner": "qoderclicn"' "default verification_author_runner"
assert_contains "$OUT" '"verification_author_effort": "high"' "default verification_author_effort"
assert_contains "$OUT" '"verification_author_endpoint": ""' "default verification_author_endpoint"
assert_contains "$OUT" '"verification_author_family": "alibaba"' "default derived verification_author_family"
assert_contains "$OUT" '"implementer_family": "xai"' "default derived implementer_family"
assert_contains "$OUT" '"config_path": "'"$FROZEN_CFG"'"' "config_path is the frozen fixture's absolute path"
assert_contains "$OUT" '"loop_convergence_verdict": "SHIP-AS-IS"' "default convergence verdict"
assert_contains "$OUT" '"review_risk": "high"' "default review_risk (xai impl → low-trust → high by design)"
assert_contains "$OUT" '"required_review_families": 2' "default required_review_families"
assert_contains "$OUT" '"l1_required": true' "default l1_required"
assert_contains "$OUT" '"cross_family_required": true' "default cross_family_required"
assert_contains "$OUT" '"cross_family_satisfied": true' "default cross_family_satisfied"
assert_contains "$OUT" 'MiniMax-M3 diff-only reviewer limitation: 5/6 recorded central claims were false' "default MiniMax seat surfaces calibration limitation"

# A2 perturbation: deleting the exact-seat caveat makes the roster fail closed.
NO_MINIMAX_CAVEAT_CFG="$TEST_TMP/no-minimax-caveat.md"
sed '/^[[:space:]]*- reviewer_limitation:/d' "$FROZEN_CFG" > "$NO_MINIMAX_CAVEAT_CFG"
NO_CAVEAT_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$NO_MINIMAX_CAVEAT_CFG" bash "$SCRIPT" 2>&1)"
NO_CAVEAT_EXIT=$?
assert_eq "3" "$NO_CAVEAT_EXIT" "MiniMax exact seat is rejected when its limitation tag is removed"
assert_contains "$NO_CAVEAT_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "removed MiniMax caveat is diagnosed"

# Removing or falsifying the legacy required flag must not weaken the exact-seat
# guard. The tuple itself is the authority boundary.
NO_MINIMAX_GUARD_FIELDS_CFG="$TEST_TMP/no-minimax-guard-fields.md"
sed -e '/^[[:space:]]*- reviewer_limitation:/d' \
  -e '/^[[:space:]]*- reviewer_limitation_required:/d' \
  "$FROZEN_CFG" > "$NO_MINIMAX_GUARD_FIELDS_CFG"
NO_GUARD_FIELDS_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$NO_MINIMAX_GUARD_FIELDS_CFG" bash "$SCRIPT" 2>&1)"
NO_GUARD_FIELDS_EXIT=$?
assert_eq "3" "$NO_GUARD_FIELDS_EXIT" "MiniMax exact seat rejects caveat removal even when required flag is deleted"
assert_contains "$NO_GUARD_FIELDS_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "deleted MiniMax guard fields are diagnosed"

MINIMAX_FALSE_REQUIRED_CFG="$TEST_TMP/minimax-false-required.md"
sed -e '/^[[:space:]]*- reviewer_limitation:/d' \
  -e 's/^[[:space:]]*- reviewer_limitation_required:.*/- reviewer_limitation_required: false/' \
  "$FROZEN_CFG" > "$MINIMAX_FALSE_REQUIRED_CFG"
FALSE_REQUIRED_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$MINIMAX_FALSE_REQUIRED_CFG" bash "$SCRIPT" 2>&1)"
FALSE_REQUIRED_EXIT=$?
assert_eq "3" "$FALSE_REQUIRED_EXIT" "MiniMax exact seat rejects caveat removal when required flag is false"
assert_contains "$FALSE_REQUIRED_OUT" "requires reviewer_limitation=minimax-false-central-claim-5-of-6" "false MiniMax required flag cannot silence diagnosis"

# 4. --field accessors (frozen fixture — see §3)
assert_eq "MiniMax-M3" "$(F --field reviewer_engine)" "--field reviewer_engine"
assert_eq "high" "$(F --field reviewer_effort)" "--field reviewer_effort"
assert_eq "on" "$(F --field independent_harness)" "--field independent_harness"
assert_eq "high" "$(F --field review_risk)" "--field review_risk (xai impl → high by design)"
assert_eq "2" "$(F --field required_review_families)" "--field required_review_families"
assert_eq "true" "$(F --field l1_required)" "--field l1_required"
assert_eq "true" "$(F --field cross_family_required)" "--field cross_family_required"
assert_eq "true" "$(F --field cross_family_satisfied)" "--field cross_family_satisfied"
assert_eq "true" "$(F --field verification_author_present)" "--field verification_author_present"
assert_eq "$(F --field verification_author_engine)" "Qwen3.8-Max-Preview" "--field verification_author_engine"
assert_eq "$(F --field verification_author_runner)" "qoderclicn" "--field verification_author_runner"
assert_eq "high" "$(F --field verification_author_effort)" "--field verification_author_effort"
assert_eq "$(F --field verification_author_endpoint)" "" "--field verification_author_endpoint"
assert_eq "$(F --field verification_author_family)" "alibaba" "--field verification_author_family"
assert_eq "xai" "$(F --field implementer_family)" "--field implementer_family"
assert_eq "$FROZEN_CFG" "$(F --field config_path)" "--field config_path"
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

# (c4) implementer_ladder: auto + topology file has a rung with an empty effort (what
# resolve-dispatch-topology.js emitted for legacy no-effort seats before v2.36.16)
# -> exit 3 naming the rung and the fix, instead of the JS contract validator
# rejecting the whole output later with only an index.
STALE_TOPO_FILE="$TEST_TMP/topo-stale-effort-fixture.json"
cat > "$STALE_TOPO_FILE" <<'JSON'
{
  "implementer_ladder": [
    { "rung": "grok-4.5@grok", "engine": "grok-4.5", "effort": "", "runner": "grok", "baseline_event_id": 138 }
  ]
}
JSON
STALE_TOPO_ERR="$(AUTOPILOT_TOPOLOGY_FILE="$STALE_TOPO_FILE" REVIEW_LOOP_CONFIG_OVERRIDE="$AUTO_CFG" bash "$SCRIPT" 2>&1 1>/dev/null)"; STALE_TOPO_RC=$?
assert_exit_code "$STALE_TOPO_RC" 3 "implementer_ladder: auto with an empty-effort rung exits 3"
assert_contains "$STALE_TOPO_ERR" "invalid implementer_ladder effort (must be low|medium|high|xhigh|max): grok-4.5/@grok" "empty-effort auto rung error names the rung"
assert_contains "$STALE_TOPO_ERR" "rerun scripts/resolve-dispatch-topology.js" "empty-effort auto rung error names the fix"

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


finalize_test
