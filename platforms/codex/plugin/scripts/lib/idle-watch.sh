#!/usr/bin/env bash
# idle-watch.sh — run a command and kill it (whole process group) when its OUTPUT stops growing.
#
#   idle-watch.sh <idle_seconds> <marker_file> -- <cmd> [args...]
#
# BL-0293. dispatch-review.sh puts this between `timeout "$TIMEOUT"` and the runner command, so
# the wall-clock cap still applies on top. Progress is the combined size of this process's own
# stdout and stderr targets (/dev/fd/1, /dev/fd/2: the capture files the caller redirected the
# seat into). Any change of that size resets the idle clock. When the size has not changed for
# <idle_seconds> the seat is judged idle: the marker file gets a one-line reason (that is how
# dispatch-review.sh tells an idle kill from an ordinary failure), the group is killed with
# SIGKILL, and the exit code is 125.
#
# Fail-open: when neither stdout nor stderr is a regular file (a pipe or a tty has no size to
# watch) or <idle_seconds> is not a positive integer, the command is exec'd unwatched.
#
# Kill scope: the command runs as the leader of its own process group (`set -m`), and only that
# group is killed. The watcher and the `timeout` above it are outside it, so a wall-clock TERM
# (timeout -> watcher trap -> seat group killed) still ends as timeout's own exit 124.
#
# Exit: the command's own code; 125 idle kill; 143 on TERM/INT (command killed first).

idle="${1:-}"; marker="${2:-}"
if [ "${3:-}" = "--" ]; then shift 3; else echo "idle-watch: usage: idle-watch.sh <seconds> <marker> -- cmd..." >&2; exit 2; fi

# Command substitution gives the subshell a pipe as fd 1, so the real targets are kept on 3 and 4.
exec 3>&1 4>&2
watch_size() {
  local n total=0 s
  for n in 3 4; do
    [ -f "/dev/fd/$n" ] || continue
    s="$(stat -L -c %s "/dev/fd/$n" 2>/dev/null || stat -L -f %z "/dev/fd/$n" 2>/dev/null)" || s=0
    case "$s" in ''|*[!0-9]*) s=0 ;; esac
    total=$((total + s))
  done
  printf '%s' "$total"
}

case "$idle" in ''|*[!0-9]*|0) exec 3>&- 4>&-; exec "$@" ;; esac
if [ ! -f /dev/fd/3 ] && [ ! -f /dev/fd/4 ]; then exec 3>&- 4>&-; exec "$@"; fi

descendants() { # <pid>: print every descendant pid, depth first
  local c
  for c in $(ps -e -o pid=,ppid= 2>/dev/null | awk -v p="$1" '$2 == p { print $1 }'); do
    descendants "$c"; printf '%s\n' "$c"
  done
}

kill_seat() {
  local pid pg
  pg="$(ps -o pgid= -p "$CHILD" 2>/dev/null | tr -d ' ')"
  if [ "$pg" = "$CHILD" ]; then
    kill -KILL -- "-$CHILD" 2>/dev/null
  else   # job control unavailable: walk the descendants instead
    for pid in $(descendants "$CHILD"); do kill -KILL "$pid" 2>/dev/null; done
  fi
  kill -KILL "$CHILD" 2>/dev/null
}

# The seat leads a process group of its own (job control), so killing it never reaches this
# watcher or the `timeout` above it: the 125 / 124 exit codes stay intact under GNU and uutils alike.
set -m
"$@" <&0 3>&- 4>&- &
CHILD=$!
set +m
trap 'kill_seat; wait "$CHILD" 2>/dev/null; exit 143' TERM INT

last="$(watch_size)"; since=$SECONDS
while kill -0 "$CHILD" 2>/dev/null; do
  sleep 0.25
  cur="$(watch_size)"
  if [ "$cur" != "$last" ]; then last="$cur"; since=$SECONDS; continue; fi
  if [ $((SECONDS - since)) -ge "$idle" ] && kill -0 "$CHILD" 2>/dev/null; then
    [ -n "$marker" ] && printf 'no output growth for %ss\n' "$idle" > "$marker"
    kill_seat
    wait "$CHILD" 2>/dev/null
    exit 125
  fi
done
wait "$CHILD"
