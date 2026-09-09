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

# The live dir must be RAM-backed or resolveLiveDir() rejects the override and
# silently falls through to the host's real live dir (this host's /tmp is ext4).
TMP="$(mktemp -d "/dev/shm/context-budget-window-memory-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

SID="11111111-2222-3333-4444-555555555555"
LIVE="$TMP/live"
mkdir -p "$LIVE/context"
export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
export CLAUDE_CODE_SESSION_ID="$SID"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

# A transcript whose single usage row sits at 160k tokens: 16%% of a 1M window (well
# under the scaled 750k T2) but past the unscaled 150k T2. The value also matters for
# case 3: inferWindowTokens(160k) returns the 200K calibration, so the inference path
# still fires. (At 217k inference already concludes the window is 1M and fires nothing,
# which would make this test pass without the fix.)
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

# ---- 1. fresh live file: the exact window is read, no tier fires ----------------
write_live "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
[ "$RC" = "0" ] && ok "fresh live file: exit 0" || bad "fresh live file: exit $RC (stderr: $ERR)"
case "$ERR" in
  *"Context budget T2"*) bad "fresh live file must not fire T2: $ERR" ;;
  *) ok "fresh live file: no T2" ;;
esac

# The window must have been remembered in the hook's own state.
KNOWN="$(node -e 'const s=require(process.argv[1]);process.stdout.write(String(s.knownWindow||0))' "$TMP/state/$SID.json" 2>/dev/null)"
[ "$KNOWN" = "1000000" ] \
  && ok "window remembered in state (knownWindow=1000000)" \
  || bad "window not remembered: knownWindow=$KNOWN"

# ---- 2. live file goes stale: the remembered window must still hold -------------
# This is the regression. Deleting the file is the strongest form of "unusable"
# (stale, malformed and absent all take the same fallback branch).
rm -f "$LIVE/context/$SID.json"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"Context budget T2"*)
    bad "stale live file re-derived the window and fired a spurious T2: $ERR" ;;
  *)
    ok "stale live file: no spurious T2 at 160k on a 1M window" ;;
esac
[ "$RC" = "0" ] && ok "stale live file: exit 0" || bad "stale live file: exit $RC (stderr: $ERR)"

# ---- 3. the memory is per-session, not global ------------------------------------
# A different session with no live file must still take the inference path and, at
# 217k observed, fire T2 against the 200K-calibrated ceiling. This is what proves the
# fix did not simply disable the tier.
SID2="99999999-8888-7777-6666-555555555555"
export CLAUDE_CODE_SESSION_ID="$SID2"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID2\"}"
RC="$(run_hook)"
ERR="$(cat "$TMP/err.txt")"
case "$ERR" in
  *"Context budget T2"*) ok "unseen session still fires T2 on the inferred window" ;;
  *) bad "unseen session should still fire T2 (inference path), got: [$ERR]" ;;
esac

printf '\n%s\n' "context-budget-window-memory: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
