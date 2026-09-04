#!/usr/bin/env bash
# dispatch-consult-hermetic.test.sh — hermetic resolver test for consult_dispatch: auto
# Exercises topology ladder ordering, qc_panel triple exclusion, native fallback,
# and verifies the plugin-absent precondition.
. "$(dirname "$0")/lib.sh"

RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"

# ── 5. Record plugin-absent precondition ──
# The codex-plugin transport is not available; dispatch-consult must work via seat rail alone.
echo "Precondition: running with no ~/.claude/plugins directory present in scratch HOME ($HOOK_HOME)"
assert_file_absent "$HOOK_HOME/.claude/plugins" "scratch HOME does not contain .claude/plugins"

# ── 1. Build scratch topology-cache JSON with 3 seats ──
# Seat 1: anthropic family (sonnet, claude-native, high)
# Seat 2: qc-panel duplicate to be excluded (gpt-5.6, codex, high)
# Seat 3: minimax family (minimax-m3, agy, high)
# Order: Seat 3 (minimax) precedes Seat 1 (anthropic) reflecting sortConsultDiscuss asking-family anthropic
TOPO_FILE="$TEST_TMP/topology-ladder.json"
cat > "$TOPO_FILE" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-09-04T00:00:00.000Z",
  "host": "test-host",
  "consult_ladder": [
    {
      "rung": "gpt-5.6/high@codex",
      "engine": "gpt-5.6",
      "effort": "high",
      "runner": "codex",
      "family": "openai",
      "endpoint": "",
      "role_source": "consult"
    },
    {
      "rung": "minimax-m3/high@agy",
      "engine": "minimax-m3",
      "effort": "high",
      "runner": "agy",
      "family": "minimax",
      "endpoint": "",
      "role_source": "consult"
    },
    {
      "rung": "sonnet/high@claude-native",
      "engine": "sonnet",
      "effort": "high",
      "runner": "claude-native",
      "family": "anthropic",
      "endpoint": "",
      "role_source": "consult"
    }
  ]
}
JSON

# ── 2. Write scratch review-loop config matching Seat 2 ──
CFG_FILE="$TEST_TMP/review-loop-config.md"
cat > "$CFG_FILE" <<'EOF'
- consult_dispatch: auto
- qc_panel: gpt-5.6
- qc_panel_runners: codex
- qc_panel_efforts: high
- qc_panel_endpoints: @none
EOF

# ── 3. Point resolve-review-loop.sh at scratch files and assert consult_engine / consult_resolved_from ──
ENGINE_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FILE" AUTOPILOT_TOPOLOGY_FILE="$TOPO_FILE" bash "$RESOLVER" --field consult_engine 2>"$TEST_TMP/run1.err")"
EXIT_ENGINE=$?
assert_eq "0" "$EXIT_ENGINE" "resolve-review-loop consult_engine exit 0"
assert_eq "minimax-m3" "$ENGINE_OUT" "consult_engine resolved to minimax-m3 (seat 2 excluded, seat 3 picked before seat 1)"

FROM_OUT="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FILE" AUTOPILOT_TOPOLOGY_FILE="$TOPO_FILE" bash "$RESOLVER" --field consult_resolved_from 2>"$TEST_TMP/run2.err")"
EXIT_FROM=$?
assert_eq "0" "$EXIT_FROM" "resolve-review-loop consult_resolved_from exit 0"
assert_eq "topology" "$FROM_OUT" "consult_resolved_from equals topology"

# ── 4. Empty consult_ladder fallback to native-fallback and capability warning ──
TOPO_EMPTY="$TEST_TMP/topology-empty.json"
cat > "$TOPO_EMPTY" <<'JSON'
{
  "schema_version": 1,
  "generated_at": "2026-09-04T00:00:00.000Z",
  "host": "test-host",
  "consult_ladder": []
}
JSON

FALLBACK_FROM="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FILE" AUTOPILOT_TOPOLOGY_FILE="$TOPO_EMPTY" bash "$RESOLVER" --field consult_resolved_from 2>"$TEST_TMP/run3.err")"
EXIT_FALLBACK=$?
assert_eq "0" "$EXIT_FALLBACK" "resolve-review-loop empty ladder exit 0"
assert_eq "native-fallback" "$FALLBACK_FROM" "empty consult_ladder resolves to native-fallback"

RESOLVER_JSON="$(REVIEW_LOOP_CONFIG_OVERRIDE="$CFG_FILE" AUTOPILOT_TOPOLOGY_FILE="$TOPO_EMPTY" bash "$RESOLVER" 2>"$TEST_TMP/run4.err")"
EXIT_JSON=$?
assert_eq "0" "$EXIT_JSON" "resolve-review-loop JSON exit 0"
assert_contains "$RESOLVER_JSON" "consult_dispatch" "capability_warnings mentions consult_dispatch on native fallback"

finalize_test
