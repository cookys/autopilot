#!/usr/bin/env bash
# RED at 6ec27032: 12 of 17 assertions fail (message is 'has read N cache tokens cumulatively (threshold T) — a long-lived context ... (docs/ironlaw-to-gate-map.md #6)'; no 'across K calls', no context %, no 'cost unknown').
# cost-tracker-context-signal.test.sh — the cumulative cache-read advisory names what it counted
# (a calls x window SUM, not window fill) and carries the contradicting-axis number: the real
# context % read from the statusline live file (the same file context-budget reads).
# Isolated HOME / XDG_RUNTIME_DIR / AUTOPILOT_LIVE_DIR.
. "$(dirname "$0")/lib.sh"

export HOME="$HOOK_HOME"
export XDG_RUNTIME_DIR="$TEST_TMP/xdg"
mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
LIVE_DIR="$(mktemp -d /dev/shm/ap-ctsig-live-XXXXXX 2>/dev/null || mktemp -d "$TEST_TMP/live-XXXXXX")"
chmod 700 "$LIVE_DIR"
export AUTOPILOT_LIVE_DIR="$LIVE_DIR"
mkdir -p "$LIVE_DIR/context"
trap 'rm -rf "$LIVE_DIR"' EXIT
export AUTOPILOT_COST_TRACKER_CACHE_READ_WARN=1000
unset AUTOPILOT_COST_TRACKER AUTOPILOT_COST_TRACKER_CLEAR_PCT

TR="$TEST_TMP/transcript.jsonl"
METRICS="$HOOK_HOME/.claude/metrics"
turn() { # <model> <cache_read> <input> <output>
  printf '{"type":"assistant","message":{"model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":0}}}\n' "$1" "$3" "$4" "$2"
}
payload() { printf '{"session_id":"%s","transcript_path":"%s","hook_event_name":"Stop","cwd":"%s"}' "$1" "$TR" "$TEST_TMP"; }
live() { # <sid> <used_percentage> [written_at]
  local wa="${3:-$(node -e 'process.stdout.write(new Date().toISOString())')}"
  printf '{"schema_version":1,"session_id":"%s","written_at":"%s","context_window":{"context_window_size":1000000,"used_percentage":%s,"total_input_tokens":%s}}' \
    "$1" "$wa" "$2" "$(( $2 * 10000 ))" > "$LIVE_DIR/context/$1.json"
}
fresh_session() { rm -rf "$METRICS"; }
over() { { turn claude-sonnet-5 400 10 5; turn claude-sonnet-5 700 10 5; } > "$TR"; }   # 1,100 over 2 calls

# ── 1. live 33%: message names the cumulative sum + calls + the real %, no /clear, no wrong pointer ──
fresh_session; over; live ct-sig-33 33
run_hook cost-tracker.js "$(payload ct-sig-33)"
assert_contains "$__RUN_STDERR" 'has read 1,100 cache tokens cumulatively across 2 calls' "names what it counted: cumulative sum over K calls"
assert_contains "$__RUN_STDERR" 'context now 33%' "carries the real window fill from the live file"
assert_contains "$__RUN_STDERR" '330,000 of 1,000,000 tokens' "carries tokens of window"
assert_not_contains "$__RUN_STDERR" 'long-lived context' "false long-lived-context claim is gone"
assert_not_contains "$__RUN_STDERR" 'ironlaw-to-gate-map' "wrong doc pointer is gone"
assert_not_contains "$__RUN_STDERR" '#6' "wrong #6 pointer is gone"
assert_contains "$__RUN_STDERR" 'threshold 1,000' "threshold wording preserved"
assert_contains "$__RUN_STDERR" "of this session's spend" "names its share of session spend"

# ── 2. no live file: honest 'unknown' ──
fresh_session; over; rm -f "$LIVE_DIR/context/ct-sig-none.json"
run_hook cost-tracker.js "$(payload ct-sig-none)"
assert_contains "$__RUN_STDERR" 'context % unknown' "no live file: says context % unknown"
assert_not_contains "$__RUN_STDERR" 'context now' "no live file: no invented percentage"

# ── 2b. stale live file counts as absent ──
fresh_session; over; live ct-sig-stale 33 "2020-01-01T00:00:00.000Z"
run_hook cost-tracker.js "$(payload ct-sig-stale)"
assert_contains "$__RUN_STDERR" 'context % unknown' "stale live file: unknown, not a stale 33%"

# ── 3. model without a price row: cost unknown, never a guess ──
fresh_session; { turn claude-mystery-9 400 10 5; turn claude-mystery-9 700 10 5; } > "$TR"; live ct-sig-mys 33
run_hook cost-tracker.js "$(payload ct-sig-mys)"
assert_contains "$__RUN_STDERR" 'cost unknown' "unpriced model: cost unknown"
assert_not_contains "$__RUN_STDERR" "% of this session's spend" "unpriced model: no guessed share"

# ── 4. queued advisory carries the same truthful text ──
fresh_session; over; live ct-sig-q 33
run_hook cost-tracker.js "$(payload ct-sig-q)"
QF="$LIVE_DIR/advisory-queue/ct-sig-q.jsonl"
assert_file_exists "$QF" "advisory queued"
assert_contains "$(cat "$QF")" 'context now 33%' "queued text carries the real %"

# ── 5. fail-open on a corrupt live file ──
fresh_session; over; printf '{not json' > "$LIVE_DIR/context/ct-sig-bad.json"
run_hook cost-tracker.js "$(payload ct-sig-bad)"
assert_eq 0 "$__RUN_EXIT" "corrupt live file: exit 0"
assert_contains "$__RUN_STDERR" 'context % unknown' "corrupt live file: unknown"

finalize_test
