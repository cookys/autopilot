#!/usr/bin/env bash
# accept-dev-channel-prompt.sh --pane <tmux target> [--timeout <s>] [--interval <s>]
#
# Accepts Claude Code's startup dialog "WARNING: Loading development channels"
# for an unattended lane (claude started with --dangerously-load-development-channels
# inside a detached tmux pane). Claude Code 2.1.319 has no setting, env var or flag
# to pre-accept it, so this polls the pane and answers it.
#
# It polls `tmux capture-pane -p -t <pane>` and sends the single key Enter (option 1,
# "I am using this for local development", is the default focus) ONLY when the screen
# holds both exact strings "Loading development channels" and
# "I am using this for local development". It sends at most one key per run, then
# exits 0. Any other screen (folder trust, login, anything else) gets no key. If the
# text never appears within --timeout (default 90 s, poll every --interval, default 2 s)
# it sends nothing and exits 1. A missing pane is polled until the timeout too.
# Exit codes: 0 accepted, 1 not_seen or send_failed (a failed send is not retried), 2 usage.
# --timeout and --interval are positive integers; each sleep is capped at the time left, so a run
# never outlasts the timeout by more than the final capture.
#
# One line per outcome (pane, outcome, seconds waited) goes to stderr and, when
# `logger` exists, to the journal with tag accept-dev-channel-prompt. The captured
# screen text is never logged. tmux and logger are looked up on PATH.
#
# Example unit line (the pane name must be fixed):
#   ExecStartPost=/path/to/autopilot/scripts/accept-dev-channel-prompt.sh --pane lane:0.0 --timeout 90
set -u

pane=""; timeout=90; interval=2
usage() { echo "usage: accept-dev-channel-prompt.sh --pane <tmux target> [--timeout <s>] [--interval <s>]" >&2; }
log_line() {
  local line="pane=$pane outcome=$1 waited=${2}s${3:+ reason=$3}"
  command -v logger >/dev/null 2>&1 && logger -t accept-dev-channel-prompt -- "$line" || true
  echo "accept-dev-channel-prompt: $line" >&2
}

pos_int() { case "$1" in ""|*[!0-9]*) return 1 ;; esac; [ "$1" -gt 0 ]; }
while [ $# -gt 0 ]; do
  case "$1" in
    --pane|--timeout|--interval)
      [ $# -ge 2 ] || { usage; log_line usage 0 missing_value; exit 2; }
      case "$1" in --pane) pane="$2" ;; --timeout) timeout="$2" ;; --interval) interval="$2" ;; esac
      shift 2 ;;
    *) usage; log_line usage 0; exit 2 ;;
  esac
done
if [ -z "$pane" ]; then usage; log_line usage 0 missing_pane; exit 2; fi
pos_int "$timeout" || { usage; log_line usage 0 bad_timeout; exit 2; }
pos_int "$interval" || { usage; log_line usage 0 bad_interval; exit 2; }

start=$SECONDS
capture_failed=0
while :; do
  if screen="$(tmux capture-pane -p -t "$pane" 2>/dev/null)"; then
    capture_failed=0
    case "$screen" in
      *"Loading development channels"*"I am using this for local development"*|*"I am using this for local development"*"Loading development channels"*)
        if tmux send-keys -t "$pane" Enter; then
          log_line accepted $((SECONDS - start)); exit 0
        fi
        log_line send_failed $((SECONDS - start)); exit 1 ;;
    esac
  else
    capture_failed=1
  fi
  left=$((timeout - (SECONDS - start)))
  [ "$left" -le 0 ] && break
  [ "$interval" -lt "$left" ] && sleep "$interval" || sleep "$left"
done
log_line not_seen $((SECONDS - start)) "$([ "$capture_failed" = 1 ] && echo capture_failed || echo text_absent)"
exit 1
