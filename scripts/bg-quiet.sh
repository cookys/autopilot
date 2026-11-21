#!/usr/bin/env bash
# scripts/bg-quiet.sh — Opt-in background job launcher that wakes the seat only on failure or timeout.
# Usage: scripts/bg-quiet.sh [--timeout <dur, default 2h>] [--task <fleet task id>] [--label <slug>] -- <cmd...>
#
# Registers `fleet watch --until-file <queue>/<id>.fail --timeout <timeout+900s>` in the foreground
# (while still attributed to the Claude session), then launches <cmd...> detached under `timeout`.
# On exit 0, writes <queue>/<id>.ok (swept at next UserPromptSubmit/Stop by hooks/bg-quiet-sweep.js).
# On non-zero or timeout (rc 124), writes <queue>/<id>.fail so the watch fires and wakes the seat.

set -uo pipefail

TIMEOUT_DUR="2h"
TASK_ID=""
LABEL=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --timeout)
      TIMEOUT_DUR="${2:-}"
      shift 2
      ;;
    --task)
      TASK_ID="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      echo "Usage: $0 [--timeout <dur, default 2h>] [--task <fleet task id>] [--label <slug>] -- <cmd...>"
      exit 0
      ;;
    *)
      echo "bg-quiet: unknown option: $1 (use -- before command)" >&2
      exit 2
      ;;
  esac
done

if [ "$#" -eq 0 ]; then
  echo "bg-quiet: missing command after --" >&2
  exit 2
fi

parse_duration_secs() {
  local dur="$1"
  if [[ "$dur" =~ ^([0-9]+)s?$ ]]; then
    echo "${BASH_REMATCH[1]}"
  elif [[ "$dur" =~ ^([0-9]+)m$ ]]; then
    echo $(( ${BASH_REMATCH[1]} * 60 ))
  elif [[ "$dur" =~ ^([0-9]+)h$ ]]; then
    echo $(( ${BASH_REMATCH[1]} * 3600 ))
  elif [[ "$dur" =~ ^([0-9]+)d$ ]]; then
    echo $(( ${BASH_REMATCH[1]} * 86400 ))
  else
    return 1
  fi
}

TIMEOUT_SECS="$(parse_duration_secs "$TIMEOUT_DUR")" || {
  echo "bg-quiet: invalid --timeout duration: $TIMEOUT_DUR" >&2
  exit 2
}
WATCH_TIMEOUT_SECS=$(( TIMEOUT_SECS + 900 ))

SESSION_ID="${CLAUDE_CODE_SESSION_ID:-default}"
QUEUE_DIR="${XDG_RUNTIME_DIR:-/dev/shm}/autopilot/bg-quiet/${SESSION_ID}"
mkdir -p "$QUEUE_DIR" || {
  echo "bg-quiet: failed to create queue dir $QUEUE_DIR; use run_in_background instead" >&2
  exit 1
}

JOB_ID="bg-$(date +%s)-$$-$RANDOM"
FAIL_FILE="${QUEUE_DIR}/${JOB_ID}.fail"
OK_FILE="${QUEUE_DIR}/${JOB_ID}.ok"
META_FILE="${QUEUE_DIR}/${JOB_ID}.json"
LOG_FILE="${QUEUE_DIR}/${JOB_ID}.log"

if [ -z "$LABEL" ]; then
  LABEL="$1"
fi

FLEET_CMD="${FLEET_BIN:-fleet}"
if ! command -v "$FLEET_CMD" >/dev/null 2>&1 && [ ! -x "$FLEET_CMD" ]; then
  echo "bg-quiet: warning: '$FLEET_CMD' not found; cannot register failure watch. Use run_in_background instead." >&2
  exit 1
fi

WATCH_ARGS=(watch --until-file "$FAIL_FILE" --timeout "${WATCH_TIMEOUT_SECS}s")
if [ -n "$TASK_ID" ]; then
  WATCH_ARGS+=(--task "$TASK_ID")
fi

WATCH_OUT="$("$FLEET_CMD" "${WATCH_ARGS[@]}" 2>&1)"
WATCH_RC=$?
if [ "$WATCH_RC" -ne 0 ]; then
  echo "bg-quiet: warning: fleet watch registration failed (rc=$WATCH_RC): $WATCH_OUT. Use run_in_background instead." >&2
  exit 1
fi

WATCH_ID="${WATCH_OUT%% *}"
if [ -z "$WATCH_ID" ]; then
  echo "bg-quiet: warning: fleet watch returned empty watch_id. Use run_in_background instead." >&2
  exit 1
fi

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CMD_STR="$*"

node -e '
const fs = require("fs");
const [metaFile, id, watchId, label, cmd, started, logFile] = process.argv.slice(1);
const data = {
  id,
  watch_id: watchId,
  label,
  cmd: cmd.slice(0, 200),
  started,
  log: logFile,
};
fs.writeFileSync(metaFile, JSON.stringify(data) + "\n", "utf8");
' "$META_FILE" "$JOB_ID" "$WATCH_ID" "$LABEL" "$CMD_STR" "$STARTED_AT" "$LOG_FILE"

export BG_QUIET_TIMEOUT="$TIMEOUT_SECS"
export BG_QUIET_LOG="$LOG_FILE"
export BG_QUIET_OK="$OK_FILE"
export BG_QUIET_FAIL="$FAIL_FILE"
export BG_QUIET_ID="$JOB_ID"
export BG_QUIET_LABEL="$LABEL"

setsid nohup bash -c '
  timeout "$BG_QUIET_TIMEOUT" "$@" > "$BG_QUIET_LOG" 2>&1
  rc=$?
  ended="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  target="$BG_QUIET_FAIL"
  if [ "$rc" -eq 0 ]; then
    target="$BG_QUIET_OK"
  fi
  node -e "
    const fs = require(\"fs\");
    const [target, id, label, rcStr, ended, logFile] = process.argv.slice(1);
    let lastLine = \"\";
    try {
      const lines = fs.readFileSync(logFile, \"utf8\").split(/\r?\n/).filter(l => l.trim().length > 0);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
    } catch {}
    lastLine = lastLine
      .replace(/(?:sk-|ghp_|gho_|xoxb-|Bearer\s+)[A-Za-z0-9._-]+/gi, \"[REDACTED]\")
      .slice(0, 200);
    const receipt = { id, label, rc: Number(rcStr), ended, last_line: lastLine };
    fs.writeFileSync(target, JSON.stringify(receipt) + \"\\n\", \"utf8\");
  " "$target" "$BG_QUIET_ID" "$BG_QUIET_LABEL" "$rc" "$ended" "$BG_QUIET_LOG"
' _ "$@" </dev/null >/dev/null 2>&1 &

echo "bg-quiet ${JOB_ID} watch=${WATCH_ID} log=${LOG_FILE}"
exit 0
