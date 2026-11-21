#!/usr/bin/env bash
# runaway-scan.sh — read-only scan for long-running high-CPU node/python processes.
# Usage: scripts/runaway-scan.sh [--min-secs 3600] [--min-cpu 50] [--json]
set -euo pipefail

MIN_SECS=3600
MIN_CPU=50
JSON_OUT=0
PS_BIN="${PS_BIN:-ps}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --min-secs)
      MIN_SECS="${2:?--min-secs requires a value}"
      shift 2
      ;;
    --min-cpu)
      MIN_CPU="${2:?--min-cpu requires a value}"
      shift 2
      ;;
    --json)
      JSON_OUT=1
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--min-secs 3600] [--min-cpu 50] [--json]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

HOST="$(hostname -s 2>/dev/null || hostname)"
CUR_USER="$(id -un 2>/dev/null || echo "${USER:-}")"

"$PS_BIN" -eo user:32,pid,etimes,pcpu,args --no-headers | awk -v min_secs="$MIN_SECS" -v min_cpu="$MIN_CPU" -v cur_user="$CUR_USER" -v host="$HOST" -v json_out="$JSON_OUT" '
function json_escape(s,    out, i, c) {
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  gsub(/\t/, "\\t", s)
  gsub(/\r/, "\\r", s)
  gsub(/\n/, "\\n", s)
  return s
}
BEGIN {
  count = 0
  if (!json_out) {
    printf "%-16s %-16s %-8s %-8s %-6s %s\n", "host", "user", "pid", "etimes", "pcpu", "cmd"
  } else {
    printf "["
  }
}
{
  user = $1
  pid = $2
  etimes = $3 + 0
  pcpu = $4 + 0
  cmd = ""
  for (i = 5; i <= NF; i++) {
    cmd = (cmd == "" ? $i : cmd " " $i)
  }
  if (user != "team" && user !~ /-lead$/ && user !~ /lead$/ && user != cur_user) next
  if (cmd !~ /(^|[\/ ])(node|python|python3)([[:space:]]|$)/) next
  if (etimes <= min_secs || pcpu <= min_cpu) next
  if (length(cmd) > 160) cmd = substr(cmd, 1, 160)

  if (!json_out) {
    printf "%-16s %-16s %-8s %-8s %-6.1f %s\n", host, user, pid, etimes, pcpu, cmd
  } else {
    if (count > 0) printf ","
    printf "{\"host\":\"%s\",\"user\":\"%s\",\"pid\":%s,\"etimes\":%d,\"pcpu\":%.1f,\"cmd\":\"%s\"}",
      json_escape(host), json_escape(user), pid, etimes, pcpu, json_escape(cmd)
  }
  count++
}
END {
  if (json_out) {
    printf "]\n"
  }
}
'
