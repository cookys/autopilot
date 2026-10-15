#!/usr/bin/env bash
# context-budget-unknown-window — with no live file and no remembered window, a sub-200K
# RED at 53ddc02f: 10 passed, 4 failed — "FAIL — unknown window 151k: exit 2", "FAIL — no unknown-window text", "FAIL — directive leaked", "FAIL — no additionalContext".
# observation cannot tell a 200K session from a 1M one, so T2 must degrade to an advisory
# (exit 0, no STOP/clear directive). Known windows, observedMax >= 200K and user-explicit
# T2 keep today's behaviour.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/context-budget.js"

TMP="$(mktemp -d "/dev/shm/context-budget-unknown-window-XXXXXX")"
export AUTOPILOT_MANAGED_SETTINGS_FILE="$TMP/.no-managed-settings.json"  # isolate from a host /etc/claude-code
trap 'rm -rf "$TMP"' EXIT

SID="aaaaaaaa-2222-3333-4444-555555555555"
LIVE="$TMP/live"
mkdir -p "$LIVE/context" "$TMP/home"
chmod 0700 "$LIVE"
export AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state"
export CLAUDE_CODE_SESSION_ID="$SID"
export HOME="$TMP/home"
export AUTOPILOT_CONFIG_FILE="$TMP/home/.autopilot/config.json"  # BL-0181: hooks read this, not just $HOME
unset AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_T2 AUTOPILOT_CONTEXT_BUDGET_MODE

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

TRANSCRIPT="$TMP/transcript.jsonl"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"

set_tokens() {  # $1 = cache_read tokens
  printf '{"timestamp":"2026-10-03T08:00:00.000Z","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":%s,"cache_creation_input_tokens":0,"output_tokens":10}}}\n' "$1" > "$TRANSCRIPT"
}
reset_state() { rm -rf "$TMP/state"; rm -f "$LIVE/context/$SID.json"; rm -f "$TMP/home/.autopilot/config.json"; }
run_hook() {
  OUT="$(printf '%s' "$PAYLOAD" | node "$HOOK" 2>"$TMP/err.txt")"; RC=$?
  ERR="$(cat "$TMP/err.txt")"
}

# 1. no live file, no memory, 151k observed -> advisory, exit 0, no STOP
reset_state; set_tokens 151000; run_hook
[ "$RC" = "0" ] && ok "unknown window 151k: exit 0" || bad "unknown window 151k: exit $RC ($ERR)"
case "$ERR" in *"window"*"unknown"*|*"unknown"*"window"*) ok "advisory names the unknown window" ;; *) bad "no unknown-window text: $ERR" ;; esac
case "$ERR" in *"151k"*) ok "advisory gives the token count" ;; *) bad "no token count: $ERR" ;; esac
case "$ERR" in *"STOP"*|*"/clear"*) bad "directive leaked: $ERR" ;; *) ok "no STOP / clear directive" ;; esac
case "$OUT" in *additionalContext*unknown*) ok "advisory also delivered via additionalContext" ;; *) bad "no additionalContext: $OUT" ;; esac
case "$OUT$ERR" in *permissionDecision*) bad "permissionDecision emitted" ;; *) ok "no permissionDecision" ;; esac

# 2. remembered 1M window, 151k -> no T2 at all
reset_state; mkdir -p "$TMP/state"
printf '{"calls":10,"lastT1Call":0,"lastT2Call":0,"lastContext":0,"observedMax":0,"knownWindow":1000000}\n' > "$TMP/state/$SID.json"
set_tokens 151000; run_hook
[ "$RC" = "0" ] && ok "remembered 1M: exit 0" || bad "remembered 1M: exit $RC"
case "$ERR" in *"T2"*|*"STOP"*) bad "remembered 1M fired T2: $ERR" ;; *) ok "remembered 1M: no T2" ;; esac

# 3. explicit t2=150000 -> today's T2 (exit 2, STOP)
reset_state; mkdir -p "$TMP/home/.autopilot"
printf '{"context_budget":{"t2":150000}}\n' > "$TMP/home/.autopilot/config.json"
set_tokens 151000; run_hook
[ "$RC" = "2" ] && ok "explicit t2: exit 2" || bad "explicit t2: exit $RC ($ERR)"
case "$ERR" in *"STOP taking on new work"*) ok "explicit t2: STOP directive kept" ;; *) bad "explicit t2 lost directive: $ERR" ;; esac

# 4. observedMax 250k, no live file -> window inferred 1M, but tiers are ABSOLUTE: 250k >= 150k fires T2 directive
reset_state; set_tokens 250000; run_hook
[ "$RC" = "2" ] && ok "observed 250k: absolute T2 exit 2 (no upscaling to 750k)" || bad "observed 250k: exit $RC ($ERR)"
case "$ERR" in *"threshold 150k"*"STOP taking on new work"*) ok "observed 250k: directive, threshold 150k" ;; *) bad "250k wrong message: $ERR" ;; esac
case "$ERR" in *"unknown"*) bad "250k observation proves the window; must not be the unknown advisory: $ERR" ;; *) ok "observed 250k: not the unknown-window advisory" ;; esac
# a 120k observation (below T2, above T1) is only a T1 nudge
reset_state; set_tokens 120000; run_hook
[ "$RC" = "0" ] && ok "observed 120k: exit 0" || bad "observed 120k: exit $RC ($ERR)"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = "0" ]
