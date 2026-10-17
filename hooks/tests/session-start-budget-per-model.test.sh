#!/usr/bin/env bash
# session-start-budget-per-model.test.sh — BL-0205: the SessionStart budget warning reads context_budget.per_model.
# Window 250000 -> compaction point 217000. Top-level t2 150000 + gap 50000 fits (silent); per_model "big-*" t2 400000 does not.
# Model id sources: the SessionStart payload's model, else the statusline live file's model.id for the session.
# Negative controls: a hook copy without the model hand-off must lose the matching cases.
. "$(dirname "$0")/lib.sh"

export CLAUDE_CONFIG_DIR="$HOOK_HOME/.claude" AUTOPILOT_MANAGED_SETTINGS_FILE="$TEST_TMP/no-managed.json"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT CLAUDE_PROJECT_DIR
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_GAP AUTOPILOT_CONTEXT_BUDGET_MODE
mkdir -p "$CLAUDE_CONFIG_DIR" "$HOOK_HOME/.autopilot"
printf '{"autoCompactWindow":250000}' > "$CLAUDE_CONFIG_DIR/settings.json"
printf '%s' '{"context_budget":{"t2":150000,"gap":50000,"per_model":{"big-*":{"t2":400000}}}}' > "$AUTOPILOT_CONFIG_FILE"

ROOT="$TEST_TMP/root"; mkdir -p "$ROOT/.claude-plugin"
printf '{"name":"autopilot","version":"3.0.0"}' > "$ROOT/.claude-plugin/plugin.json"
printf '## v3.0.0 - Baseline\n' > "$ROOT/CHANGELOG.md"
WS="$TEST_TMP/ws"; mkdir -p "$WS"
SID="aaaaaaaa-1111-2222-3333-444444444444"
LIVE="$(mktemp -d /dev/shm/ss-budget-pm-XXXXXX)"; chmod 0700 "$LIVE"; mkdir -p "$LIVE/context"
trap 'rm -rf "$LIVE"' EXIT

ctx_of() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(j?.hookSpecificOutput?.additionalContext||j?.additional_context||"")}catch{}})'; }
run_at() { # <hooks-dir> <payload-model-or-empty>
  local pl="{\"source\":\"startup\",\"cwd\":\"$WS\",\"session_id\":\"$SID\"${2:+,\"model\":\"$2\"}}"
  env HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$ROOT" AUTOPILOT_LIVE_DIR="$LIVE" AUTOPILOT_CONTEXT_BUDGET_DIR="$TEST_TMP/cbstate" \
    node "$1/session-start.js" <<< "$pl" 2>/dev/null | ctx_of
}

OUT="$(run_at "$HOOKS_DIR" big-1)"
assert_contains "$OUT" "T2 400k + gap 50k" "payload model big-1: per_model t2 drives the warning"
OUT="$(run_at "$HOOKS_DIR" small-1)"
assert_not_contains "$OUT" "Context budget config:" "payload model small-1: top-level tiers fit, no warning"
OUT="$(run_at "$HOOKS_DIR" "")"
assert_not_contains "$OUT" "Context budget config:" "no model anywhere: top-level tiers, no warning"

# live-file fallback: no model in the payload, the session's live file names it
printf '%s' "{\"schema_version\":1,\"session_id\":\"$SID\",\"written_at\":\"2026-10-17T00:00:00.000Z\",\"model\":{\"id\":\"big-2[1m]\"},\"context_window\":{\"context_window_size\":250000,\"total_input_tokens\":1}}" > "$LIVE/context/$SID.json"
OUT="$(run_at "$HOOKS_DIR" "")"
assert_contains "$OUT" "T2 400k + gap 50k" "live file model.id big-2[1m]: per_model t2 drives the warning"

# negative controls
mk_mut() { # <name> <sed-expr>
  local m="$TEST_TMP/$1/hooks"; mkdir -p "$m/../scripts"; cp -r "$HOOKS_DIR/." "$m/"; cp -r "$REPO_ROOT/scripts/." "$m/../scripts/"; cp -r "$REPO_ROOT/src" "$m/../src"
  sed -i "$2" "$m/session-start.js"; printf '%s' "$m"
}
M1="$(mk_mut m1 '/models: knownModelIds(payload),/d')"
grep -q 'models: knownModelIds' "$M1/session-start.js" && fail "mutant 1: line not removed"
OUT="$(run_at "$M1" "")"
assert_not_contains "$OUT" "T2 400k" "negative control: without the models hand-off the live-file case is red"
M2="$(mk_mut m2 "/models: knownModelIds(payload),/d;/budgetWarning({/,/}) || ''/ s/model: typeof payload.model === 'string' ? payload.model : undefined,//")"
OUT="$(run_at "$M2" big-1)"
assert_not_contains "$OUT" "T2 400k" "negative control: without any model hand-off the payload case is red"
finalize_test
