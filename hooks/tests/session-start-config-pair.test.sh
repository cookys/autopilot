#!/usr/bin/env bash
# session-start-config-pair.test.sh — BL-0250: a non-version-update SessionStart surfaces
# only a t2_gap_over_window mismatch (at most 2 lines), and a version-update SessionStart
# still prints that finding exactly once via the existing config-audit block.
# RED at 56095b46c: non-version-update mismatch printed no t2_gap_over_window (pair section 0 lines)
. "$(dirname "$0")/lib.sh"

export CLAUDE_CONFIG_DIR="$HOOK_HOME/.claude" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP AUTOPILOT_CONTEXT_BUDGET_MODE
unset AUTOPILOT_UPDATE_CHECK AUTOPILOT_CONFIG_PAIR_CHECK
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOOK_HOME/.autopilot"

ROOT="$TEST_TMP/root"; mkdir -p "$ROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.1"}' > "$ROOT/.claude-plugin/plugin.json"
printf '## v3.0.1 - Something\n## v3.0.0 - Baseline\n' > "$ROOT/CHANGELOG.md"
WS="$TEST_TMP/ws"; mkdir -p "$WS"
PAYLOAD="{\"source\":\"startup\",\"cwd\":\"$WS\"}"
CFG="$AUTOPILOT_CONFIG_FILE"

ctx_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'; }
run_hook() { # [extra env]
  env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" ${1:+"$1"} node "$HOOKS_DIR/session-start.js" <<< "$PAYLOAD" 2>/dev/null | ctx_of
}
pair_section() { # lines of the pair section only
  printf '%s\n' "$1" | awk 'BEGIN{p=0} /^\[Autopilot config pair\]/{p=1} p{print} p&&NR>0&&/^\[Autopilot config pair\]/{c=0} p{c++; if(c>=2) exit}'
}

# non-version-update + mismatch
printf '%s' "3.0.1" > "$HOOK_HOME/.autopilot/last-seen-version"
printf '{"autoCompactWindow":200000}' > "$CLAUDE_CONFIG_DIR/settings.json"
printf '%s' '{"config_schema_version":1,"context_budget":{"t2":150000,"gap":50000}}' > "$CFG"
OUT="$(run_hook)"
assert_contains "$OUT" "t2_gap_over_window" "mismatch, no version change: finding is shown"
assert_not_contains "$OUT" "[Autopilot config check:" "mismatch, no version change: not the upgrade block"
SEC="$(pair_section "$OUT")"
SEC_LINES="$(printf '%s\n' "$SEC" | grep -c . || true)"
if [ "$SEC_LINES" -ge 1 ] && [ "$SEC_LINES" -le 2 ]; then echo "ok pair section lines: $SEC_LINES"; else fail "pair section has $SEC_LINES lines (want 1..2): $SEC"; fi

# negative control: pair fits
printf '%s' '{"config_schema_version":1,"context_budget":{"t2":100000,"gap":20000}}' > "$CFG"
OUT="$(run_hook)"
assert_not_contains "$OUT" "t2_gap_over_window" "fitting pair: no finding"
assert_not_contains "$OUT" "[Autopilot config pair]" "fitting pair: no section"

# env opt-out
printf '%s' '{"config_schema_version":1,"context_budget":{"t2":150000,"gap":50000}}' > "$CFG"
OUT="$(run_hook AUTOPILOT_CONFIG_PAIR_CHECK=0)"
assert_not_contains "$OUT" "t2_gap_over_window" "AUTOPILOT_CONFIG_PAIR_CHECK=0: no finding"
assert_not_contains "$OUT" "[Autopilot config pair]" "AUTOPILOT_CONFIG_PAIR_CHECK=0: no section"

# version-update: the finding is printed once (existing block only)
printf '%s' "3.0.0" > "$HOOK_HOME/.autopilot/last-seen-version"
OUT="$(run_hook)"
COUNT="$(printf '%s\n' "$OUT" | grep -o 't2_gap_over_window' | wc -l | tr -d ' ')"
assert_eq "$COUNT" "1" "version-update + mismatch: t2_gap_over_window exactly once"
assert_contains "$OUT" "[Autopilot config check:" "version-update: existing block still prints"
assert_not_contains "$OUT" "[Autopilot config pair]" "version-update: pair section not added on top"

# empty temp HOME: nothing configured, no pair section
rm -f "$CLAUDE_CONFIG_DIR/settings.json" "$CFG"
printf '%s' "3.0.1" > "$HOOK_HOME/.autopilot/last-seen-version"
OUT="$(run_hook)"
assert_not_contains "$OUT" "t2_gap_over_window" "empty home: no finding"
assert_not_contains "$OUT" "[Autopilot config pair]" "empty home: no section"
assert_not_contains "$OUT" "[Autopilot config check:" "empty home: no upgrade block"
assert_contains "$OUT" "You have **Autopilot**" "empty home: baseline context still present"

finalize_test
