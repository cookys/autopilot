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
# Exit codes: 0 accepted, 1 not_seen, 2 usage.
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

while [ $# -gt 0 ]; do
  case "$1" in
    --pane) pane="${2:-}"; shift 2 || break ;;
    --timeout) timeout="${2:-}"; shift 2 || break ;;
    --interval) interval="${2:-}"; shift 2 || break ;;
    *) usage; log_line usage 0; exit 2 ;;
  esac
done
case "$timeout$interval" in *[!0-9]*|"") usage; log_line usage 0; exit 2 ;; esac
if [ -z "$pane" ]; then usage; log_line usage 0 missing_pane; exit 2; fi

start=$SECONDS
capture_failed=0
while :; do
  if screen="$(tmux capture-pane -p -t "$pane" 2>/dev/null)"; then
    capture_failed=0
    case "$screen" in
      *"Loading development channels"*"I am using this for local development"*|*"I am using this for local development"*"Loading development channels"*)
        tmux send-keys -t "$pane" Enter
        log_line accepted $((SECONDS - start))
        exit 0 ;;
    esac
  else
    capture_failed=1
  fi
  [ $((SECONDS - start)) -ge "$timeout" ] && break
  sleep "$interval"
done
log_line not_seen $((SECONDS - start)) "$([ "$capture_failed" = 1 ] && echo capture_failed || echo text_absent)"
exit 1
