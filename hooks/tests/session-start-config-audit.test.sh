#!/usr/bin/env bash
# session-start-config-audit.test.sh — the config check wired into the SessionStart version-change notice.
# Cases: version changed + findings -> block (<= 5 lines); version unchanged -> none; update_check off (env and config)
# -> none; clean config -> none. Negative control: a hook copy without the wiring must fail the "block present" case.
. "$(dirname "$0")/lib.sh"

export CLAUDE_CONFIG_DIR="$HOOK_HOME/.claude" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP AUTOPILOT_CONTEXT_BUDGET_MODE
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOOK_HOME/.autopilot"
printf '{"autoCompactWindow":250000}' > "$CLAUDE_CONFIG_DIR/settings.json"

ROOT="$TEST_TMP/root"; mkdir -p "$ROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.1"}' > "$ROOT/.claude-plugin/plugin.json"
printf '## v3.0.1 - Something\n## v3.0.0 - Baseline\n' > "$ROOT/CHANGELOG.md"
WS="$TEST_TMP/ws"; mkdir -p "$WS"
PAYLOAD="{\"source\":\"startup\",\"cwd\":\"$WS\"}"
CFG="$AUTOPILOT_CONFIG_FILE"   # lib.sh points this at $HOOK_HOME/.autopilot/config.json

ctx_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'; }
run_hook_at() { # <hooks-dir> [extra env assignment]
  printf '%s' "3.0.0" > "$HOOK_HOME/.autopilot/last-seen-version"
  env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" ${2:+"$2"} node "$1/session-start.js" <<< "$PAYLOAD" 2>/dev/null | ctx_of
}
BAD='{"config_schema_version":1,"context_budgt":{"t2":1},"context_budget":{"mode":"of","t1":300000},"a_typo":1,"update_chek":false}'
CLEAN='{"config_schema_version":1,"context_budget":{"t2":150000}}'

printf '%s' "$BAD" > "$CFG"
OUT="$(run_hook_at "$HOOKS_DIR")"
assert_contains "$OUT" "[Autopilot updated: v3.0.0" "version changed: update notice still present"
assert_contains "$OUT" "[Autopilot config check:" "version changed + findings: config block present"
assert_contains "$OUT" "scripts/dev-setup.sh --check" "block points at dev-setup --check"
assert_contains "$OUT" "docs/settings-reference.md" "block points at the settings reference"
BLOCK_LINES="$(printf '%s\n' "$OUT" | sed -n '/^\[Autopilot config check:/,$p' | grep -c .)"
if [ "$BLOCK_LINES" -le 5 ]; then echo "ok block lines: $BLOCK_LINES"; else fail "config block has $BLOCK_LINES lines (max 5)"; fi

# negative control: the hook without the wiring (copy with the append removed) must NOT show the block -> the case above is red there
MUT="$TEST_TMP/mut/hooks"; mkdir -p "$MUT/../scripts"; cp -r "$HOOKS_DIR/." "$MUT/"; cp -r "$REPO_ROOT/scripts/." "$MUT/../scripts/"; cp -r "$REPO_ROOT/src" "$MUT/../src"
sed -i 's/return notice + configAuditBlock(homeDir);/return notice;/' "$MUT/session-start.js"
grep -q 'return notice;' "$MUT/session-start.js" || fail "mutant: wiring line not found"
MOUT="$(run_hook_at "$MUT")"
# the mutant must have run normally: update notice (fixed section) still there, and only the config block is gone
assert_contains "$MOUT" "[Autopilot updated: v3.0.0" "negative control: mutant ran normally (update notice present)"
assert_not_contains "$MOUT" "[Autopilot config check:" "negative control: hook without the wiring shows no block (the present-case would be red)"
echo "negative control: wiring removed -> block absent (present-case red), wiring present -> green"

# version unchanged -> nothing
printf '%s' "3.0.1" > "$HOOK_HOME/.autopilot/last-seen-version"
OUT="$(env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" node "$HOOKS_DIR/session-start.js" <<< "$PAYLOAD" 2>/dev/null | ctx_of)"
assert_not_contains "$OUT" "[Autopilot config check:" "version unchanged: no block"

# switches off the notice -> no block
OUT="$(run_hook_at "$HOOKS_DIR" AUTOPILOT_UPDATE_CHECK=0)"
assert_not_contains "$OUT" "[Autopilot config check:" "AUTOPILOT_UPDATE_CHECK=0: no block"
printf '{"update_check":false,"context_budgt":{"t2":1}}' > "$CFG"
OUT="$(run_hook_at "$HOOKS_DIR")"
assert_not_contains "$OUT" "[Autopilot config check:" "update_check=false: no block"

# clean config -> no block, notice still there
printf '%s' "$CLEAN" > "$CFG"
OUT="$(run_hook_at "$HOOKS_DIR")"
assert_contains "$OUT" "[Autopilot updated: v3.0.0" "clean config: update notice present"
assert_not_contains "$OUT" "[Autopilot config check:" "clean config: no block"

finalize_test
