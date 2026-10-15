#!/usr/bin/env bash
# context-budget-window-memory — the session's context window survives a stale live file.
#
# The live file is written by the statusline, which stops ticking while the session
# waits on a long background task. Before v2.36.22 the hook fell back to inferring the
# window from observed usage, which caps at the 200K calibration and fired a T2
# "stop and write a handoff" directive on a 1M-window session at ~21% used.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/context-budget.js"
# The hook reads ~/.autopilot/config.json context_budget; a host with its own tiers (t2 300000)
# turned the 160k T2 cases into T1. Env beats config, so pin the defaults these cases assume.
export AUTOPILOT_CONTEXT_BUDGET_T1=100000 AUTOPILOT_CONTEXT_BUDGET_T2=150000 AUTOPILOT_CONTEXT_BUDGET_STEP=50000
unset AUTOPILOT_CONTEXT_BUDGET_MODE

# The live dir must be RAM-backed or resolveLiveDir() rejects the override and
# silently falls through to the host's real live dir (this host's /tmp is ext4).
TMP="$(mktemp -d "/dev/shm/context-budget-window-memory-XXXXXX")"
export AUTOPILOT_MANAGED_SETTINGS_FILE="$TMP/.no-managed-settings.json"  # isolate from a host /etc/claude-code
trap 'rm -rf "$TMP"' EXIT
# BL-0140: never read the host operator config (the real ~/.autopilot/config.json).
export HOME="$TMP/home" AUTOPILOT_CONFIG_FILE="$TMP/home/.autopilot/config.json"
mkdir -p "$TMP/home/.autopilot"

SID="11111111-2222-3333-4444-555555555555"
LIVE="$TMP/live"
mkdir -p "$LIVE/context"
chmod 0700 "$LIVE"
export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
export CLAUDE_CODE_SESSION_ID="$SID"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

# A transcript whose single usage row sits at 160k tokens: 16%% of a 1M window, past the
# ABSOLUTE 150k T2 (defaults no longer scale up with the window). What this file pins is
# WHICH window the message attributes to: "(statusline)" while the live file is fresh, the
# remembered "this session's window" once it is gone, and the unknown-window advisory only
# for a session that never saw a window. Case 2 runs with step 0 so the step throttle (state
# keeps the context of the case-1 fire) cannot mask the second message.
TRANSCRIPT="$TMP/transcript.jsonl"
printf '%s\n' \
  '{"timestamp":"2026-09-09T08:00:00.000Z","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":160000,"cache_creation_input_tokens":411,"output_tokens":10}}}' \
  > "$TRANSCRIPT"

PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"

write_live() {  # $1 = written_at ISO
  cat > "$LIVE/context/$SID.json" <<JSON
{"cc_version":"2.1.263","schema_version":1,"session_id":"$SID",
 "model":{"display_name":"Opus 5 (1M context)","id":"claude-opus-5[1m]"},
 "context_window":{"context_window_size":1000000,"total_input_tokens":160413,
   "current_usage":{"input_tokens":2,"cache_read_input_tokens":160000,"cache_creation_input_tokens":411,"output_tokens":10},
   "used_percentage":16},
 "written_at":"$1"}
JSON
}

run_hook() {
  printf '%s' "$PAYLOAD" | node "$HOOK" 2>"$TMP/err.txt"
  printf '%s' "$?"
}

# ---- 1. fresh live file: the exact window is read; T2 fires at the absolute 150k ----
write_live "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
[ "$RC" = "2" ] && ok "fresh live file: T2 at 160k on a 1M window (exit 2)" || bad "fresh live file: exit $RC (stderr: $ERR)"
case "$ERR" in
  *"16% of the ~1000k window (statusline)"*"threshold 150k"*) ok "fresh live file: message attributes the exact window, threshold 150k" ;;
  *) bad "fresh live file: wrong message: $ERR" ;;
esac

# The window must have been remembered in the hook's own state.
KNOWN="$(node -e 'const s=require(process.argv[1]);process.stdout.write(String(s.knownWindow||0))' "$TMP/state/$SID.json" 2>/dev/null)"
[ "$KNOWN" = "1000000" ] \
  && ok "window remembered in state (knownWindow=1000000)" \
  || bad "window not remembered: knownWindow=$KNOWN"

# ---- 2. live file goes stale: the remembered window must still be the one reported ---
# Deleting the file is the strongest form of "unusable" (stale, malformed and absent all
# take the same fallback branch). Before v2.36.22 this re-derived the window from observed
# usage; the regression is the message losing the remembered 1M window.
rm -f "$LIVE/context/$SID.json"
RC="$(AUTOPILOT_CONTEXT_BUDGET_STEP=0 run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"16% of the ~1000k window (this session's window"*) ok "stale live file: remembered 1M window reported" ;;
  *) bad "stale live file lost the remembered window: $ERR" ;;
esac
[ "$RC" = "2" ] && ok "stale live file: T2 exit 2 (known window, directive)" || bad "stale live file: exit $RC (stderr: $ERR)"

# ---- 3. the memory is per-session, not global ------------------------------------
# A different session with no live file must still take the inference path (here the
# unknown-window advisory at 160k). This proves the memory did not leak across sessions.
SID2="99999999-8888-7777-6666-555555555555"
export CLAUDE_CODE_SESSION_ID="$SID2"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID2\"}"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"Context budget T2"*) ok "unseen session still fires T2 on the inferred window" ;;
  *) bad "unseen session should still fire T2 (inference path), got: [$ERR]" ;;
esac

# ---- 4. BL-0091: no memory yet, but this session's stale status-line file is on disk ---------
# First hook call after a long foreground tool call (fresh state, live file >120 s old): the
# window in that file is still this session's window. Without it the hook fell to the
# unknown-window inference path.
SID3="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
export CLAUDE_CODE_SESSION_ID="$SID3"
SID="$SID3"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID3\"}"
write_live "2026-09-09T08:00:00.000Z"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"16% of the ~1000k window (this session's window"*) ok "stale file, no memory: its window is adopted" ;;
  *) bad "stale file, no memory: window not adopted: [$ERR]" ;;
esac
KNOWN="$(node -e 'const s=require(process.argv[1]);process.stdout.write(String(s.knownWindow||0))' "$TMP/state/$SID3.json" 2>/dev/null)"
[ "$KNOWN" = "1000000" ] && ok "stale file window remembered in state" || bad "stale file window not remembered: $KNOWN"
# A stale file authored by this hook (a derived echo) must not be adopted as a window source.
SID4="bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
export CLAUDE_CODE_SESSION_ID="$SID4"; SID="$SID4"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID4\"}"
write_live "2026-09-09T08:00:00.000Z"
sed -i 's/"cc_version"/"writer":"context-budget","cc_version"/' "$LIVE/context/$SID4.json"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"this session's window"*) bad "own-writer stale file adopted as window: [$ERR]" ;;
  *) ok "own-writer stale file is not a window source" ;;
esac

printf '\n%s\n' "context-budget-window-memory: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
