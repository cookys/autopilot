#!/usr/bin/env bash
# scripts/accept-dev-channel-prompt.sh against a stub tmux/logger on PATH (never a real pane).
. "$(dirname "$0")/lib.sh"

SCRIPT="${ACCEPT_SCRIPT_OVERRIDE:-$REPO_ROOT/scripts/accept-dev-channel-prompt.sh}"
BIN="$TEST_TMP/bin"; mkdir -p "$BIN"
SENDS="$TEST_TMP/sends.log"; JOURNAL="$TEST_TMP/journal.log"
cat > "$BIN/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  capture-pane) [ -n "${FIXTURE:-}" ] && [ -f "$FIXTURE" ] && cat "$FIXTURE"; [ -n "${FIXTURE:-}" ] && [ -f "$FIXTURE" ] ;;
  send-keys) shift; echo "$*" >> "$SENDS_LOG"; exit "${SEND_RC:-0}" ;;
esac
STUB
cat > "$BIN/logger" <<'STUB'
#!/bin/sh
echo "$*" >> "$JOURNAL_LOG"
STUB
chmod +x "$BIN/tmux" "$BIN/logger"
export PATH="$BIN:$PATH" SENDS_LOG="$SENDS" JOURNAL_LOG="$JOURNAL"
assert_eq "$(command -v tmux)" "$BIN/tmux" "tmux resolves to the stub"

printf '%s\n' ' WARNING: Loading development channels' '' ' 1. I am using this for local development' ' 2. Exit' > "$TEST_TMP/dev.txt"
printf '%s\n' ' Do you trust the files in this folder?' ' 1. Yes, proceed' ' 2. No, exit' > "$TEST_TMP/trust.txt"
printf '%s\n' ' Select login method:' ' 1. Claude account with subscription' ' 2. Anthropic Console account' > "$TEST_TMP/login.txt"
printf '%s\n' ' WARNING: Loading development channels' ' 2. Exit' > "$TEST_TMP/partial.txt"

run() { : > "$SENDS"; : > "$JOURNAL"; FIXTURE="$1" bash "$SCRIPT" --pane lane:0.0 --timeout 3 --interval 1 </dev/null 2>/dev/null; }
sends() { wc -l < "$SENDS" | tr -d ' '; }

run "$TEST_TMP/dev.txt"; rc=$?
assert_exit_code "$rc" 0 "dev-channel dialog accepted"
assert_eq "$(cat "$SENDS")" "-t lane:0.0 Enter" "exactly one Enter to the pane"
assert_contains "$(cat "$JOURNAL")" "outcome=accepted" "journal says accepted"

run "$TEST_TMP/trust.txt"; rc=$?
assert_exit_code "$rc" 1 "folder trust dialog: exit 1"
assert_eq "$(sends)" 0 "folder trust dialog: no key"
assert_contains "$(cat "$JOURNAL")" "outcome=not_seen" "journal says not_seen"

run "$TEST_TMP/login.txt"; rc=$?
assert_exit_code "$rc" 1 "login prompt: exit 1"
assert_eq "$(sends)" 0 "login prompt: no key"

run "$TEST_TMP/partial.txt"; rc=$?
assert_exit_code "$rc" 1 "title without option text: exit 1"
assert_eq "$(sends)" 0 "title without option text: no key"

run ""; rc=$?
assert_exit_code "$rc" 1 "missing pane (capture fails): exit 1"
assert_eq "$(sends)" 0 "missing pane: no key"
assert_contains "$(cat "$JOURNAL")" "capture_failed" "journal names the capture failure"

: > "$SENDS"; bash "$SCRIPT" --timeout 3 </dev/null 2>/dev/null; rc=$?
assert_exit_code "$rc" 2 "missing --pane: usage exit 2"
assert_eq "$(sends)" 0 "missing --pane: no key"

run "$TEST_TMP/dev.txt" >/dev/null; rc=$?
assert_eq "$(sends)" 1 "dialog visible on every poll: still one send"
assert_not_contains "$(cat "$JOURNAL")" "WARNING" "journal never carries screen text"

SEND_RC=1 run "$TEST_TMP/dev.txt"; rc=$?
assert_exit_code "$rc" 1 "send-keys failure: exit 1"
assert_eq "$(sends)" 1 "send-keys failure: one attempt, no retry"
assert_contains "$(cat "$JOURNAL")" "outcome=send_failed" "journal says send_failed"
assert_not_contains "$(cat "$JOURNAL")" "accepted" "failed send is not logged accepted"

for args in '--timeout ""' '--interval 0' '--timeout 0' '--interval x' '--timeout'; do
  : > "$SENDS"; eval "FIXTURE=$TEST_TMP/dev.txt bash \"$SCRIPT\" --pane lane:0.0 $args" </dev/null >/dev/null 2>&1; rc=$?
  assert_exit_code "$rc" 2 "bad args [$args]: usage exit 2"
  assert_eq "$(sends)" 0 "bad args [$args]: no key"
done

t0=$SECONDS
FIXTURE="$TEST_TMP/trust.txt" timeout 10 bash "$SCRIPT" --pane lane:0.0 --timeout 2 --interval 3600 </dev/null >/dev/null 2>&1; rc=$?
el=$((SECONDS - t0))
assert_exit_code "$rc" 1 "huge interval: still exits 1 at the deadline"
[ "$el" -lt 5 ] && assert_eq ok ok "huge interval: returned in ${el}s" || assert_eq "$el" "<5" "huge interval: took too long"

finalize_test
