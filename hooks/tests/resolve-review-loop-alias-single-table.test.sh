#!/usr/bin/env bash
# resolve-review-loop-alias-single-table — BL-0138 follow-ups.
#   1. The gemini-flash alias lives in ONE table (normalize_agy_alias); the consult/qc_panel
#      collision checks (a shell helper and a node pick) reuse it instead of restating it.
#   2. A declared consult seat equal to a qc_panel seat is refused (exit 3) whichever side
#      spells the alias; the native sonnet fallback that equals a qc_panel seat is kept but
#      warned about (capability_warnings + stderr), never refused.
#   3. The config template documents the "consult seat must not equal a qc_panel seat" rule.
. "$(dirname "$0")/lib.sh"

RESOLVER="$REPO_ROOT/scripts/resolve-review-loop.sh"
export HOME="$TEST_TMP/home"
mkdir -p "$HOME"
export AUTOPILOT_CONFIG_FILE="$TEST_TMP/no-config.json"
export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/no-topology.json"

# --- 1. single alias table --------------------------------------------------------------
N="$(grep -c 'gemini-3\.6-flash-high' "$RESOLVER")"
assert_eq "$N" "1" "the resolved gemini-flash id appears once in resolve-review-loop.sh (single alias table)"

run_resolver() { # run_resolver <config-file> -> sets OUT, ERR, RC
  OUT="$(cd "$TEST_TMP" && REVIEW_LOOP_CONFIG_OVERRIDE="$1" "$RESOLVER" 2>"$TEST_TMP/err")"; RC=$?
  ERR="$(cat "$TEST_TMP/err")"
}

# --- 2a. declared consult seat vs qc_panel seat, alias spelled on either side ------------
mk_cfg() { # mk_cfg <file> <qc-engine> <consult-engine>
  cat > "$1" <<EOF
- qc_panel: $2
- qc_panel_runners: agy
- qc_panel_efforts: high
- qc_panel_endpoints: @none
- consult_dispatch: auto
- consult_engine: $3
- consult_runner: agy
- consult_effort: high
EOF
}
mk_cfg "$TEST_TMP/a1.md" gemini-flash gemini-3.6-flash-high
run_resolver "$TEST_TMP/a1.md"
assert_eq "$RC" "3" "consult gemini-3.6-flash-high vs qc gemini-flash collides (exit 3)"
assert_contains "$ERR" "must not be a qc_panel seat" "collision diagnostic names the rule (alias on qc side)"
mk_cfg "$TEST_TMP/a2.md" gemini-3.6-flash-high gemini-flash
run_resolver "$TEST_TMP/a2.md"
assert_eq "$RC" "3" "consult gemini-flash vs qc gemini-3.6-flash-high collides (exit 3)"
mk_cfg "$TEST_TMP/a3.md" gemini-flash gemini-4.0-flash-high
run_resolver "$TEST_TMP/a3.md"
assert_not_contains "$ERR" "must not be a qc_panel seat" "a different consult seat is not refused for collision"

# --- 2b. native fallback equal to a qc_panel seat: warned, not refused --------------------
cat > "$TEST_TMP/b1.md" <<EOF
- qc_panel: sonnet
- qc_panel_runners: claude-native
- qc_panel_efforts: high
- qc_panel_endpoints: @none
- consult_dispatch: auto
EOF
run_resolver "$TEST_TMP/b1.md"
assert_neq "$RC" "3" "native fallback that equals a qc seat is not refused"
assert_contains "$OUT" '"consult_resolved_from": "native-fallback"' "consult resolved via native fallback"
assert_contains "$ERR" "native fallback seat (sonnet/claude-native/high) is also qc_panel[0]" "stderr names the duplicated seat"
assert_contains "$OUT" "is also qc_panel[0]" "capability_warnings carries the duplicate-seat line"

# Negative control: a qc_panel with no equal seat produces no such warning.
cat > "$TEST_TMP/b2.md" <<EOF
- qc_panel: gpt-5.5
- qc_panel_runners: codex
- qc_panel_efforts: high
- qc_panel_endpoints: @none
- consult_dispatch: auto
EOF
run_resolver "$TEST_TMP/b2.md"
assert_contains "$OUT" '"consult_resolved_from": "native-fallback"' "b2: still native fallback"
assert_not_contains "$ERR" "is also qc_panel" "b2: no duplicate warning when the seats differ"

# --- 3. template documents the rule -------------------------------------------------------
TPL="$(cat "$REPO_ROOT/project-config-template/review-loop-config.md")"
assert_contains "$TPL" "The consult seat must not equal a \`qc_panel\` seat" "template states the consult-vs-qc_panel rule on the consult_* row"

finalize_test
