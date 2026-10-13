#!/usr/bin/env bash
# context-budget-autocompact-tip — T1 tells the owner to set autoCompactWindow, only when it helps.
#
# A 1M-window session with no auto-compact window set compacts only near 1M; the cost analysis in
# docs/plans/evidence/2026-10-12-context-reset-cost/README.md found resets at 150k-300k save ~20%.
# The tip rides on the T1 message when the window is a known 1M, nothing sets a window, and
# compaction is on. HOME and the Claude config dir are scratch dirs: the real settings are never read.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/context-budget.js"

# The live dir must be RAM-backed or resolveLiveDir() rejects the override (this host's /tmp is ext4).
TMP="$(mktemp -d "/dev/shm/context-budget-autocompact-tip-XXXXXX")"
export AUTOPILOT_MANAGED_SETTINGS_FILE="$TMP/.no-managed-settings.json"  # isolate from a host /etc/claude-code
trap 'rm -rf "$TMP"' EXIT

SID="22222222-3333-4444-5555-666666666666"
LIVE="$TMP/live"
CFG="$TMP/claude"
PROJ="$TMP/proj"
mkdir -p "$LIVE/context" "$CFG" "$PROJ/.claude" "$TMP/home"
chmod 0700 "$LIVE"
export HOME="$TMP/home"
export CLAUDE_CONFIG_DIR="$CFG"
export CLAUDE_PROJECT_DIR="$PROJ"
export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
export CLAUDE_CODE_SESSION_ID="$SID"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_STEP AUTOPILOT_CONTEXT_BUDGET_MODE

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

# 120k: past T1 (100k), below T2 (150k).
TRANSCRIPT="$TMP/transcript.jsonl"
printf '%s\n' \
  '{"timestamp":"2026-10-12T08:00:00.000Z","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":120000,"cache_creation_input_tokens":0,"output_tokens":10}}}' \
  > "$TRANSCRIPT"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"

write_live() {  # $1 = window, $2 = model id
  cat > "$LIVE/context/$SID.json" <<JSON
{"cc_version":"2.1.296","schema_version":1,"session_id":"$SID",
 "model":{"display_name":"test","id":"$2"},
 "context_window":{"context_window_size":$1,"total_input_tokens":120002,
   "current_usage":{"input_tokens":2,"cache_read_input_tokens":120000,"cache_creation_input_tokens":0,"output_tokens":10},
   "used_percentage":12},
 "written_at":"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"}
JSON
}

# One fresh T1 per case: state is cleared so the step throttle never hides the message.
run_case() {  # $1 = window, $2 = model id; prints stderr, rc in $TMP/rc
  rm -rf "$TMP/state" "$LIVE/advisory" 2>/dev/null
  write_live "$1" "$2"
  printf '%s' "$PAYLOAD" | node "$HOOK" >/dev/null 2>"$TMP/err.txt"
  echo "$?" > "$TMP/rc"
  cat "$TMP/err.txt"
}

expect() {  # $1 = label, $2 = tip|none, $3 = stderr
  local rc; rc="$(cat "$TMP/rc")"
  case "$3" in
    *"Context budget T1"*) ;;
    *) bad "$1: no T1 message (rc $rc, stderr: $3)"; return ;;
  esac
  if [ "$2" = tip ]; then
    case "$3" in *'Tip: no autoCompactWindow is set'*'"autoCompactWindow": 250000'*) ok "$1: tip shown" ;; *) bad "$1: tip missing: $3" ;; esac
  else
    case "$3" in *'Tip: no autoCompactWindow'*) bad "$1: tip shown when it should not be: $3" ;; *) ok "$1: no tip" ;; esac
  fi
  [ "$rc" = "0" ] && ok "$1: T1 exits 0" || bad "$1: T1 exit $rc"
}

# 1. 1M window, nothing set anywhere => tip
expect "1M, unset" tip "$(run_case 1000000 'claude-opus-5[1m]')"

# 2. 200K window => the session compacts near 200K anyway, no tip
expect "200K window" none "$(run_case 200000 'claude-opus-5')"

# 3. user top-level key set => no tip
echo '{"autoCompactWindow": 250000}' > "$CFG/settings.json"
expect "user settings set" none "$(run_case 1000000 'claude-opus-5[1m]')"
rm -f "$CFG/settings.json"

# 4. /autocompact per-model entry for THIS model ([1m] spelling of the live id) => no tip
echo '{"modelSettings": {"claude-opus-5": {"autoCompactWindow": 300000}}}' > "$CFG/settings.json"
expect "per-model entry for this model" none "$(run_case 1000000 'claude-opus-5[1m]')"
# ... but an entry for another model does not cover this one => tip
expect "per-model entry for another model" tip "$(run_case 1000000 'claude-fable-5-1')"
rm -f "$CFG/settings.json"

# 5. project settings count (CLAUDE_PROJECT_DIR)
echo '{"autoCompactWindow": 200000}' > "$PROJ/.claude/settings.local.json"
expect "project local settings set" none "$(run_case 1000000 'claude-opus-5[1m]')"
rm -f "$PROJ/.claude/settings.local.json"

# 6. env window set => no tip
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=250000
expect "env window set" none "$(run_case 1000000 'claude-opus-5[1m]')"
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW

# 7. compaction disabled => recommending a window would be wrong
export DISABLE_AUTO_COMPACT=1
expect "compaction disabled" none "$(run_case 1000000 'claude-opus-5[1m]')"
unset DISABLE_AUTO_COMPACT

# 8. the tip reaches the owner-facing advisory row, not only stderr
run_case 1000000 'claude-opus-5[1m]' >/dev/null
if grep -rqs 'Tip: no autoCompactWindow' "$LIVE"; then ok "advisory row carries the tip"; else bad "advisory row has no tip (files: $(find "$LIVE" -type f | tr '\n' ' '))"; fi

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "PASS [context-budget-autocompact-tip]"; exit 0; }
echo "FAIL [context-budget-autocompact-tip]"; exit 1
