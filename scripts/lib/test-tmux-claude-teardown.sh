#!/usr/bin/env bash
# test-tmux-claude-teardown.sh — source this from a harness that starts its own tmux server
# (tmux -L <socket>) and/or a claude process. BL-0433: those must die when the harness exits.
#
#   ap_arm_tmux_claude_teardown <socket>   before the first new-session. The socket is [A-Za-z0-9_-],
#                                          not starting with '-'. EXIT, INT, TERM and HUP run
#                                          `tmux -L <socket> kill-server` on that socket only.
#   ap_record_claude_pid <pid>             the claude (or stand-in) this harness started. The same trap
#                                          kills that pid only when /proc still shows the start time
#                                          recorded here. A recycled pid is left alone.
# Never pkill, and never signal a pid this harness did not record.
# Bash. The trap is installed on the sourcing shell. Call arm again only to name a different socket
# before any server exists; the trap itself is installed once.

ap_arm_tmux_claude_teardown() {
  local sock="${1-}"
  if [ -z "$sock" ]; then
    echo "ap_arm_tmux_claude_teardown: socket name required" >&2
    return 2
  fi
  case "$sock" in
    -*) echo "ap_arm_tmux_claude_teardown: socket name must not start with -" >&2; return 2 ;;
    *[!A-Za-z0-9_-]*) echo "ap_arm_tmux_claude_teardown: socket name must be [A-Za-z0-9_-]" >&2; return 2 ;;
  esac
  AP_TEST_TMUX_SOCKET="$sock"
  _ap_install_teardown_trap
}

ap_record_claude_pid() {
  local pid="${1-}" start
  case "$pid" in
    ''|*[!0-9]*) echo "ap_record_claude_pid: pid must be decimal digits" >&2; return 2 ;;
  esac
  if [ "$pid" -le 1 ] || [ "$pid" -eq "$$" ]; then
    echo "ap_record_claude_pid: refusing pid $pid" >&2
    return 2
  fi
  start="$(_ap_start_of "$pid" || true)"
  if [ -z "$start" ]; then
    echo "ap_record_claude_pid: pid $pid is not running" >&2
    return 2
  fi
  AP_TEST_CLAUDE_PIDS="${AP_TEST_CLAUDE_PIDS:+$AP_TEST_CLAUDE_PIDS }${pid}:${start}"
  _ap_install_teardown_trap
}

_ap_start_of() {
  local stat rest
  stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  rest="${stat##*) }"
  [ "$rest" != "$stat" ] || return 1
  awk '{print $20}' <<<"$rest"
}

_ap_kill_recorded() {
  local pair pid start now i
  for pair in ${AP_TEST_CLAUDE_PIDS:-}; do
    pid="${pair%%:*}"
    start="${pair#*:}"
    now="$(_ap_start_of "$pid" || true)"
    if [ -z "$now" ] || [ "$now" != "$start" ]; then
      continue
    fi
    kill -- "$pid" 2>/dev/null || true
    i=0
    while [ "$i" -lt 5 ]; do
      now="$(_ap_start_of "$pid" || true)"
      if [ -z "$now" ] || [ "$now" != "$start" ]; then
        break
      fi
      i=$((i + 1))
      sleep 0.05
    done
    now="$(_ap_start_of "$pid" || true)"
    if [ -n "$now" ] && [ "$now" = "$start" ]; then
      kill -9 -- "$pid" 2>/dev/null || true
    fi
  done
}

_ap_tmux_claude_teardown() {
  # BEGIN TEARDOWN BODY
  local sock="${AP_TEST_TMUX_SOCKET:-}"
  if [ -n "$sock" ]; then
    command tmux -L "$sock" kill-server >/dev/null 2>&1 || true
  fi
  _ap_kill_recorded
  # END TEARDOWN BODY
}

_ap_install_teardown_trap() {
  if [ "${AP_TEST_TEARDOWN_ARMED:-}" = 1 ]; then
    return 0
  fi
  AP_TEST_TEARDOWN_ARMED=1
  trap _ap_tmux_claude_teardown EXIT
  trap '_ap_tmux_claude_teardown; exit 143' INT TERM HUP
}
