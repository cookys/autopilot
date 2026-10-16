#!/usr/bin/env bash
# context-budget-t2-autocompact (BL-0124) — hook-level T2 wording: with an auto-compact window at or
# below T2 and compaction on, T2 says "do NOT stop"; otherwise it keeps "Directive: STOP".
# Covers both call sites in hooks/context-budget.js: fresh status-line file (statusline path) and a
# stale one (session-window path). HOME and the Claude config dir are scratch dirs.
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SELF_DIR/../.." && pwd)"
HOOK="$REPO_ROOT/hooks/context-budget.js"

TMP="$(mktemp -d "/dev/shm/context-budget-t2-autocompact-XXXXXX")"
export AUTOPILOT_MANAGED_SETTINGS_FILE="$TMP/.no-managed-settings.json"
trap 'rm -rf "$TMP"' EXIT

SID="33333333-4444-5555-6666-777777777777"
LIVE="$TMP/live"; CFG="$TMP/claude"; PROJ="$TMP/proj"
mkdir -p "$LIVE/context" "$CFG" "$PROJ/.claude" "$TMP/home"
chmod 0700 "$LIVE"
export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$CFG" CLAUDE_PROJECT_DIR="$PROJ" AUTOPILOT_LIVE_DIR="$LIVE"
export AUTOPILOT_CONTEXT_BUDGET_DIR="$TMP/state" CLAUDE_CODE_SESSION_ID="$SID"
export AUTOPILOT_CONTEXT_BUDGET_T2=300000
unset CLAUDE_CODE_AUTO_COMPACT_WINDOW DISABLE_AUTO_COMPACT DISABLE_COMPACT AUTOPILOT_CONTEXT_BUDGET_T1 AUTOPILOT_CONTEXT_BUDGET_STEP AUTOPILOT_CONTEXT_BUDGET_MODE

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'ok — %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FAIL — %s\n' "$1"; }

TRANSCRIPT="$TMP/transcript.jsonl"
printf '%s\n' '{"timestamp":"2026-10-12T08:00:00.000Z","message":{"usage":{"input_tokens":2,"cache_read_input_tokens":310000,"cache_creation_input_tokens":0,"output_tokens":10}}}' > "$TRANSCRIPT"
PAYLOAD="{\"transcript_path\":\"$TRANSCRIPT\",\"session_id\":\"$SID\"}"

write_live() {  # $1 = written_at
  cat > "$LIVE/context/$SID.json" <<JSON
{"cc_version":"2.1.296","schema_version":1,"session_id":"$SID",
 "model":{"display_name":"test","id":"claude-opus-5[1m]"},
 "context_window":{"context_window_size":1000000,"total_input_tokens":310002,
   "current_usage":{"input_tokens":2,"cache_read_input_tokens":310000,"cache_creation_input_tokens":0,"output_tokens":10},
   "used_percentage":31},
 "written_at":"$1"}
JSON
}

run_case() {  # $1 = fresh|stale; prints stderr
  rm -rf "$TMP/state" "$LIVE/advisory" 2>/dev/null
  if [ "$1" = fresh ]; then write_live "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"; else write_live "2026-01-01T00:00:00.000Z"; fi
  printf '%s' "$PAYLOAD" | node "$HOOK" >/dev/null 2>"$TMP/err.txt"
  cat "$TMP/err.txt"
}

expect() {  # $1 label, $2 nostop|stop, $3 stderr
  case "$3" in *"Context budget T2"*) ;; *) bad "$1: no T2 message: $3"; return ;; esac
  if [ "$2" = nostop ]; then
    case "$3" in *'do NOT stop'*) ok "$1: no STOP" ;; *) bad "$1: expected 'do NOT stop': $3" ;; esac
    case "$3" in *'Directive: STOP'*) bad "$1: STOP present" ;; esac
  else
    case "$3" in *'Directive: STOP'*) ok "$1: STOP kept" ;; *) bad "$1: expected 'Directive: STOP': $3" ;; esac
  fi
}

for path in fresh stale; do
  echo '{"autoCompactWindow": 250000}' > "$CFG/settings.json"
  expect "$path, window 250k" nostop "$(run_case $path)"

  export DISABLE_AUTO_COMPACT=1
  expect "$path, window 250k + DISABLE_AUTO_COMPACT" stop "$(run_case $path)"
  unset DISABLE_AUTO_COMPACT

  rm -f "$CFG/settings.json"
  out="$(run_case $path)"
  expect "$path, window unset" stop "$out"
  case "$out" in *'autoCompactWindow'*'/autocompact'*) ok "$path: STOP carries autoCompactWindow hint" ;; *) bad "$path: hint missing: $out" ;; esac

  echo '{"autoCompactWindow": 5000}' > "$CFG/settings.json"
  expect "$path, invalid window (5000)" stop "$(run_case $path)"

  echo '{"autoCompactWindow": 533000}' > "$CFG/settings.json"
  expect "$path, window 533k above T2 (t2 300k, ctx 310k)" nostop "$(run_case $path)"
  export DISABLE_AUTO_COMPACT=1
  expect "$path, window 533k + DISABLE_AUTO_COMPACT" stop "$(run_case $path)"
  unset DISABLE_AUTO_COMPACT
  echo '{"autoCompactWindow": 533000, "autoCompactEnabled": false}' > "$CFG/settings.json"
  expect "$path, window 533k + autoCompactEnabled false" stop "$(run_case $path)"
  rm -f "$CFG/settings.json"
done

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] && { echo "PASS [context-budget-t2-autocompact]"; exit 0; }
echo "FAIL [context-budget-t2-autocompact]"; exit 1
