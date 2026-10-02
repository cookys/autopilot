#!/usr/bin/env bash
# resolve-review-loop.sh integration test, shard d: topology auto matrix and later knobs. No network.
# Split from resolve-review-loop.test.sh; shared setup in lib/rrl-common.sh.
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/rrl-common.sh"

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

# plan_reviewer_runner / plan_deep_reviewer_runner: kimi is a first-class review
# transport (dispatch-review.sh --runner kimi) but the plan-chair and plan-deep-chair
# seat allowlists omitted it (308 request 2026-09-07). Both must resolve exit 0 with
# the field echoed back, and a garbage runner must still exit 3 (checked above).
PLAN_KIMI_CFG="$TEST_TMP/rl-plan-kimi-runner.md"
printf -- '- plan_review: on\n- plan_reviewer_engine: kimi-code/k3\n- plan_reviewer_runner: kimi\n- plan_reviewer_effort: high\n' > "$PLAN_KIMI_CFG"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_KIMI_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "plan_reviewer_runner kimi exits 0"
assert_eq "kimi" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_KIMI_CFG" bash "$SCRIPT" --field plan_reviewer_runner)" \
  "plan_reviewer_runner kimi honored"

PLAN_DEEP_KIMI_CFG="$TEST_TMP/rl-plan-deep-kimi-runner.md"
printf -- '- plan_review: on\n- plan_reviewer_engine: claude-fable-5\n- plan_reviewer_runner: claude-native\n- plan_reviewer_effort: high\n- plan_deep_reviewer_engine: kimi-code/k3\n- plan_deep_reviewer_runner: kimi\n- plan_deep_reviewer_effort: high\n' > "$PLAN_DEEP_KIMI_CFG"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_DEEP_KIMI_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "plan_deep_reviewer_runner kimi exits 0"
assert_eq "kimi" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$PLAN_DEEP_KIMI_CFG" bash "$SCRIPT" --field plan_deep_reviewer_runner)" \
  "plan_deep_reviewer_runner kimi honored"

# qc_panel_runners: kimi already resolves complete (regression test in section 7b2
# above); this is a second, minimal single-seat case for the plan/deep/VA parity story.
QC_KIMI_MIN_CFG="$TEST_TMP/rl-qc-kimi-min.md"
printf -- '- qc_panel: kimi-code/k3\n- qc_panel_runners: kimi\n- qc_panel_efforts: high\n- qc_panel_endpoints: @none\n' > "$QC_KIMI_MIN_CFG"
assert_eq "true" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$QC_KIMI_MIN_CFG" bash "$SCRIPT" --field qc_panel_seats_complete)" \
  "single-seat qc_panel_runners kimi resolves complete"

# verification_author_runner: kimi is fully wired on the VA dispatch path
# (dispatch-author.sh --runner kimi -> dispatch-author-kimi.js -> src/runners/kimi.js,
# contract-pinned by hooks/tests/dispatch-author-kimi.test.sh), so the resolver's
# verification_author_runner allowlist must accept it too.
VA_KIMI_CFG="$TEST_TMP/rl-va-kimi.md"
printf -- '- verification_author_present: true\n- verification_author_engine: kimi-code/k3\n- verification_author_runner: kimi\n- verification_author_effort: high\n' > "$VA_KIMI_CFG"
assert_eq "0" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$VA_KIMI_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "verification_author_runner kimi exits 0"
assert_eq "kimi" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$VA_KIMI_CFG" bash "$SCRIPT" --field verification_author_runner)" \
  "verification_author_runner kimi honored"

# garbage verification_author_runner still exits 3 (no weakening of validation)
VA_BOGUS_CFG="$TEST_TMP/rl-va-bogus.md"
printf -- '- verification_author_present: true\n- verification_author_engine: bogus-model\n- verification_author_runner: bogus\n- verification_author_effort: high\n' > "$VA_BOGUS_CFG"
assert_eq "3" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$VA_BOGUS_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)" \
  "verification_author_runner bogus still exits 3"


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

# --- plan_review: auto honours a fully DECLARED chair (7840hs item 3, 2026-09-13) ---
# Before: the declared plan_reviewer_* keys were read, then the auto block overwrote them
# from topology / native fallback, so MiniMax-M3@cc-shim resolved to opus@claude-native
# with a generic warning. The peer's plan got READY with zero findings from that chair.
DECL_CFG="$TEST_TMP/declared-chair.md"
cp "$REPO_ROOT/.claude/review-loop-config.md" "$DECL_CFG"
python3 - "$DECL_CFG" <<'PY2'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=re.sub(r'^- plan_review:.*$','- plan_review: auto',s,flags=re.M)
s=re.sub(r'^- plan_reviewer_[a-z]+:.*\n','',s,flags=re.M)
s+='\n- plan_reviewer_engine: MiniMax-M3\n- plan_reviewer_runner: cc-shim\n- plan_reviewer_effort: high\n- plan_reviewer_endpoint: minimax\n'
open(p,'w').write(s)
PY2
DECL_OUT="$(AUTOPILOT_TOPOLOGY_FILE=/nonexistent REVIEW_LOOP_CONFIG_OVERRIDE="$DECL_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_contains "$DECL_OUT" '"plan_review_resolved_from": "config-explicit"' "auto + fully declared chair: resolved_from config-explicit"
assert_contains "$DECL_OUT" '"plan_reviewer_engine": "MiniMax-M3"' "auto + declared chair: the declared engine is kept"
assert_contains "$DECL_OUT" '"plan_reviewer_runner": "cc-shim"' "auto + declared chair: the declared runner is kept"
assert_contains "$DECL_OUT" '"plan_review_same_family_as_depth0": false' "auto + declared cross-family chair: same_family false"
# a DECLARED claude-native chair is still marked same-family (the mark is about the chair)
sed -i 's/^- plan_reviewer_runner: cc-shim/- plan_reviewer_runner: claude-native/; s/^- plan_reviewer_engine: MiniMax-M3/- plan_reviewer_engine: opus/' "$DECL_CFG"
DECL_OUT3="$(AUTOPILOT_TOPOLOGY_FILE=/nonexistent REVIEW_LOOP_CONFIG_OVERRIDE="$DECL_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_contains "$DECL_OUT3" '"plan_review_resolved_from": "config-explicit"' "declared claude-native chair: still config-explicit"
assert_contains "$DECL_OUT3" '"plan_review_same_family_as_depth0": true' "declared claude-native chair: same_family marked true"
sed -i 's/^- plan_reviewer_runner: claude-native/- plan_reviewer_runner: cc-shim/; s/^- plan_reviewer_engine: opus/- plan_reviewer_engine: MiniMax-M3/' "$DECL_CFG"
# partial declaration is replaced — LOUDLY, naming what was declared
sed -i '/^- plan_reviewer_runner:/d' "$DECL_CFG"
DECL_ERR="$(AUTOPILOT_TOPOLOGY_FILE=/nonexistent REVIEW_LOOP_CONFIG_OVERRIDE="$DECL_CFG" bash "$SCRIPT" 2>&1 >/dev/null)"
DECL_OUT2="$(AUTOPILOT_TOPOLOGY_FILE=/nonexistent REVIEW_LOOP_CONFIG_OVERRIDE="$DECL_CFG" bash "$SCRIPT" 2>/dev/null)"
assert_contains "$DECL_ERR" "declared chair IGNORED" "auto + partial chair: the replacement is announced"
assert_contains "$DECL_ERR" "engine='MiniMax-M3', runner=''" "auto + partial chair: the announcement names what was declared"
assert_contains "$DECL_OUT2" '"plan_review_resolved_from": "native-fallback"' "auto + partial chair: falls back"
assert_contains "$DECL_OUT2" '"plan_review_same_family_as_depth0": true' "auto + native fallback: receipt marks same_family true"

# --- review_packet_deny_extra (cut 1c) ---
# RED at base 10c50297: field absent from resolver JSON
ABSENT_DENY="$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT")"
assert_eq "[]" "$(json_get "$ABSENT_DENY" review_packet_deny_extra)" \
  "review_packet_deny_extra absent ⇒ [] (RED at base 10c50297: field absent)"

VALID_DENY_CFG="$TEST_TMP/packet-deny-valid.md"
printf -- '- review_packet_deny_extra: secret/**, planted.txt, keep-me/**\n' > "$VALID_DENY_CFG"
VALID_DENY_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$VALID_DENY_CFG" bash "$SCRIPT")"
assert_eq '["secret/**","planted.txt","keep-me/**"]' "$(json_get "$VALID_DENY_OUT" review_packet_deny_extra)" \
  "review_packet_deny_extra echoed as given (no sort/dedupe)"

INVALID_DENY_CFG="$TEST_TMP/packet-deny-invalid.md"
printf -- '- review_packet_deny_extra: ok/**, /abs/**\n' > "$INVALID_DENY_CFG"
INVALID_DENY_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$INVALID_DENY_CFG" bash "$SCRIPT" >/dev/null 2>&1; echo $?)"
assert_eq "3" "$INVALID_DENY_ERR" "invalid review_packet_deny_extra element exits 3"
INVALID_DENY_MSG="$(REVIEW_LOOP_CONFIG_OVERRIDE="$INVALID_DENY_CFG" bash "$SCRIPT" 2>&1 >/dev/null || true)"
assert_contains "$INVALID_DENY_MSG" "review_packet_deny_extra[1] invalid pattern: /abs/**" \
  "invalid element fails closed with index and pattern (RED at base 10c50297: field absent)"

ORACLE_OUT="$(node - "$REPO_ROOT" "$SCRIPT" "$TEST_TMP" <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const script = process.argv[3];
const tmp = process.argv[4];
const { normalizeDenyList } = require(path.join(root, 'src', 'runners', 'review-packet'));
const probes = [
  { p: '/abs/**', kind: 'g' },
  { p: 'a/../b', kind: 'g' },
  { p: '', kind: 'g' },
  { p: '{a,b}', kind: 'g' },
  { p: 'secret/**', kind: 'ok' },
  { p: 'foo bar/**', kind: 'space' },
  { p: 'foo+bar/**', kind: 'plus' },
  { p: 'foo@bar/**', kind: 'at' },
  { p: 'foo~bar/**', kind: 'tilde' },
  { p: '文件/**', kind: 'nonascii' },
  { p: 'quote"me/**', kind: 'quote' },
  { p: 'back\\slash/**', kind: 'backslash' },
  { p: 'a//b', kind: 'empty-seg' },
  { p: 'trail/', kind: 'trailing' },
  { p: '**', kind: 'starstar' },
  { p: 'foo?bar', kind: 'qmark' },
  { p: 'a[b', kind: 'lbracket' },
  { p: 'a]b', kind: 'rbracket' },
  { p: 'a{b', kind: 'lbrace' },
  { p: 'a}b', kind: 'rbrace' },
];
function shellResolve(pattern) {
  const cfg = path.join(tmp, `oracle-${Buffer.from(pattern).toString('hex') || 'empty'}.md`);
  const value = pattern.length === 0 ? ',' : pattern;
  fs.writeFileSync(cfg, `- review_packet_deny_extra: ${value}\n`);
  return spawnSync('bash', [script], {
    env: { ...process.env, REVIEW_LOOP_CONFIG_OVERRIDE: cfg },
    encoding: 'utf8',
  });
}
let failed = 0;
for (const { p } of probes) {
  let jsOk = true;
  let jsEl = null;
  try {
    jsEl = normalizeDenyList([p])[0];
  } catch {
    jsOk = false;
  }
  const sh = shellResolve(p);
  const shOk = sh.status === 0;
  let shEl = null;
  if (shOk) {
    const j = JSON.parse(sh.stdout);
    if (!Array.isArray(j.review_packet_deny_extra) || j.review_packet_deny_extra.length !== 1) {
      console.error('shell emit shape', p, j.review_packet_deny_extra);
      failed += 1;
      continue;
    }
    shEl = j.review_packet_deny_extra[0];
  }
  if (jsOk !== shOk) {
    console.error('accept mismatch', JSON.stringify(p), 'js', jsOk, 'sh', shOk, sh.stderr);
    failed += 1;
    continue;
  }
  if (jsOk && shEl !== jsEl) {
    console.error('emit mismatch', JSON.stringify(p), 'js', jsEl, 'sh', shEl);
    failed += 1;
  }
}
console.log(failed === 0 ? 'oracle_parity=true' : 'oracle_parity=false');
process.exit(failed === 0 ? 0 : 1);
NODE
)"
assert_eq "0" "$?" "oracle parity process exits 0: $ORACLE_OUT"
assert_contains "$ORACLE_OUT" "oracle_parity=true" "shell accept/reject and emitted element match normalizeDenyList both ways"

# RED at base ae7ea5ce: in_rail_review is not a resolver field.
assert_eq "panel" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$EMPTY_CFG" bash "$SCRIPT" --field in_rail_review)" \
  "in_rail_review auto with the built-in complete panel metadata resolves to panel"
IN_RAIL_INCOMPLETE_CFG="$TEST_TMP/in-rail-incomplete.md"
cat > "$IN_RAIL_INCOMPLETE_CFG" <<'CFG'
# Review-Loop Config
- in_rail_review: auto
- qc_panel: gpt-5.5
CFG
assert_eq "single" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$IN_RAIL_INCOMPLETE_CFG" bash "$SCRIPT" --field in_rail_review)" \
  "in_rail_review auto with incomplete panel metadata resolves to single"
IN_RAIL_FORCE_CFG="$TEST_TMP/in-rail-force.md"
cat > "$IN_RAIL_FORCE_CFG" <<'CFG'
# Review-Loop Config
- in_rail_review: panel
- qc_panel: gpt-5.5
CFG
IN_RAIL_FORCE_ERR="$(REVIEW_LOOP_CONFIG_OVERRIDE="$IN_RAIL_FORCE_CFG" bash "$SCRIPT" --field in_rail_review 2>&1)"; IN_RAIL_FORCE_EXIT=$?
assert_eq "3" "$IN_RAIL_FORCE_EXIT" "panel with incomplete seats fails closed"
assert_contains "$IN_RAIL_FORCE_ERR" "in_rail_review" "refusal names the field"
cat > "$TEST_TMP/in-rail-single.md" <<'CFG'
# Review-Loop Config
- in_rail_review: single
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_runners: codex, claude-native, agy
- qc_panel_efforts: xhigh, high, high
- qc_panel_endpoints: @none, @none, @none
CFG
assert_eq "single" "$(REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/in-rail-single.md" bash "$SCRIPT" --field in_rail_review)" \
  "explicit single stays single even with a complete panel"


finalize_test
