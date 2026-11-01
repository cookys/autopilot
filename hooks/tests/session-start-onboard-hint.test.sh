#!/usr/bin/env bash
# session-start-onboard-hint.test.sh — BL-0363: a startup in a git repo that has .claude/ but no
# onboard-written config prints ONE advisory line pointing at autopilot:onboard; a fully configured
# repo, a repo without .claude/, a non-startup source, and either opt-out print nothing.
# Negative control: delete the onboardHint() call in hooks/session-start.js and cases 1 must go red.
. "$(dirname "$0")/lib.sh"

export CLAUDE_CONFIG_DIR="$HOOK_HOME/.claude" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR AUTOPILOT_ONBOARD_HINT
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP AUTOPILOT_CONTEXT_BUDGET_MODE
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOOK_HOME/.autopilot"
CFG="$AUTOPILOT_CONFIG_FILE"; rm -f "$CFG"

ROOT="$TEST_TMP/root"; mkdir -p "$ROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.1"}' > "$ROOT/.claude-plugin/plugin.json"
printf '## v3.0.1 - Something\n' > "$ROOT/CHANGELOG.md"
printf '%s' "3.0.1" > "$HOOK_HOME/.autopilot/last-seen-version"

mkrepo() { mkdir -p "$1" && git -C "$1" init -q; }
GAP="$TEST_TMP/gap"; mkrepo "$GAP"; mkdir -p "$GAP/.claude"; printf '# hand written\n' > "$GAP/.claude/dev-flow-config.md"
FULL="$TEST_TMP/full"; mkrepo "$FULL"; mkdir -p "$FULL/.claude"; printf '# d\n' > "$FULL/.claude/dispatch-config.md"
BARE="$TEST_TMP/bare"; mkrepo "$BARE"
NOGIT="$TEST_TMP/nogit"; mkdir -p "$NOGIT/.claude"

ctx_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'; }
hook() { local payload="{\"source\":\"$2\",\"cwd\":\"$1\"}"
  printf '%s' "$payload" | env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" ${3:+"$3"} \
    node "$HOOKS_DIR/session-start.js" 2>/dev/null | ctx_of; }

OUT="$(hook "$GAP" startup)"
assert_contains "$OUT" "[Autopilot onboard]" "1. .claude/ without onboard config: hint printed"
N="$(printf '%s\n' "$OUT" | grep -c '^\[Autopilot onboard\]' || true)"
assert_eq "$N" "1" "1. exactly one hint line"

OUT="$(hook "$FULL" startup)"
assert_not_contains "$OUT" "[Autopilot onboard]" "2. fully configured repo: no hint"

OUT="$(hook "$BARE" startup)"
assert_not_contains "$OUT" "[Autopilot onboard]" "3. repo without .claude/: no hint"

OUT="$(hook "$NOGIT" startup)"
assert_not_contains "$OUT" "[Autopilot onboard]" "3b. not a git repo: no hint"

printf '{"onboard_hint":false}' > "$CFG"
OUT="$(hook "$GAP" startup)"
assert_not_contains "$OUT" "[Autopilot onboard]" "4. config onboard_hint=false: no hint"
rm -f "$CFG"
OUT="$(hook "$GAP" startup AUTOPILOT_ONBOARD_HINT=0)"
assert_not_contains "$OUT" "[Autopilot onboard]" "4b. AUTOPILOT_ONBOARD_HINT=0: no hint"

OUT="$(hook "$GAP" clear)"
assert_not_contains "$OUT" "[Autopilot onboard]" "5. non-startup source: no hint"

# autopilot itself ships full config, so its own repo must stay quiet.
OUT="$(hook "$REPO_ROOT" startup)"
assert_not_contains "$OUT" "[Autopilot onboard]" "6. the autopilot repo itself: no hint"

finalize_test
