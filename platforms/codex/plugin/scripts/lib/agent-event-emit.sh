#!/usr/bin/env bash
# scripts/lib/agent-event-emit.sh — shared fleet agent-event emitter for dispatch rails.
# Emits `autopilot.agent-event/1` JSON lines to `fleet event emit` on stdin.
# Never fails the dispatch: any emit failure prints one stderr hint and returns 0.

_AEE_SEQ=0
_AEE_RUN_ID=""
_AEE_TASK_ID=""
_AEE_FLEET_TASK_ID=""
_AEE_STAGE="build"
_AEE_RUNNER="claude"
_AEE_SEAT=""

_aee_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

_aee_ts_ms() {
  local ms
  ms="$(date +%s%3N 2>/dev/null || true)"
  case "$ms" in
    *[!0-9]*|'')
      ms="$(($(date +%s 2>/dev/null || echo 0) * 1000))"
      ;;
  esac
  printf '%s' "$ms"
}

_aee_map_runner() {
  local r="${1:-}"
  if [ -n "$r" ]; then
    printf '%s' "$r"
  else
    printf 'claude'
  fi
}

_aee_map_stage() {
  case "${1:-}" in
    implementer|build|foreman|batch) printf 'build' ;;
    reviewer|plan-review|review) printf 'review' ;;
    author|plan|consult|discuss|panel|explore) printf 'plan' ;;
    merge) printf 'merge' ;;
    *) printf 'build' ;;
  esac
}

_aee_fleet_bin() {
  if [ -n "${AUTOPILOT_FLEET_BIN:-}" ]; then
    printf '%s' "$AUTOPILOT_FLEET_BIN"
  elif command -v fleet >/dev/null 2>&1; then
    command -v fleet
  elif [ -x "${HOME:-}/.local/bin/fleet" ]; then
    printf '%s' "$HOME/.local/bin/fleet"
  else
    return 1
  fi
}

# The seat is the address of the session that emits, never the shell CLI's own identity (fleet-cli) and never a
# whole `fleet whoami` line. Order: env address, then `fleet whoami --session <id> --json`, then plain whoami.
_aee_addr_of() {
  # stdin: whoami output, JSON or text. Prints the bare address (namespace/courier/member) or nothing.
  local first
  first="$(head -n 1 | tr -d '\r')"
  case "$first" in
    \{*) printf '%s' "$first" | sed -n 's/.*"address"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' ;;
    *) first="${first#address:}"; set -- $first; printf '%s' "${1:-}" ;;
  esac
}

_aee_resolve_seat() {
  local env_addr="${FLEET_ADDRESS:-${AUTOPILOT_FLEET_ADDRESS:-}}"
  if [ -n "$env_addr" ]; then
    printf '%s' "${env_addr%%@*}"
    return 0
  fi
  local sid="${CLAUDE_CODE_SESSION_ID:-${AUTOPILOT_SESSION_ID:-}}"
  local cache_file="${TMPDIR:-/tmp}/autopilot-fleet-seat-${USER:-$(id -u)}-${sid:-nosession}.txt"
  if [ -r "$cache_file" ]; then
    local cached
    cached="$(head -n 1 "$cache_file" 2>/dev/null | tr -d '\r\n')"
    case "$cached" in ''|*[[:space:]]*) cached='' ;; esac
    if [ -n "$cached" ]; then
      printf '%s' "$cached"
      return 0
    fi
  fi
  local fleet_bin who=""
  fleet_bin="$(_aee_fleet_bin)" || fleet_bin="fleet"
  if [ -n "$sid" ]; then
    who="$("$fleet_bin" whoami --session "$sid" --json 2>/dev/null | _aee_addr_of || true)"
  fi
  if [ -z "$who" ]; then
    who="$("$fleet_bin" whoami --json 2>/dev/null | _aee_addr_of || true)"
  fi
  if [ -n "$who" ]; then
    printf '%s\n' "$who" > "$cache_file" 2>/dev/null || true
    printf '%s' "$who"
    return 0
  fi
  printf 'unknown'
}

_aee_resolve_task_id() {
  local tid="${1:-}"
  if [ -z "$tid" ]; then
    tid="${AUTOPILOT_FLEET_TASK:-${AUTOPILOT_UPSTREAM_TASK_ID:-}}"
  fi
  printf '%s' "$tid"
}

agent_event_emit_init() {
  local role="${1:-implementer}"
  local runner="${2:-claude}"
  local run_id="${3:-}"
  local task_id="${4:-}"

  _AEE_SEQ=0
  _AEE_STAGE="$(_aee_map_stage "$role")"
  _AEE_RUNNER="fleet"
  _AEE_FLEET_TASK_ID="$task_id"
  if [ -n "$run_id" ]; then
    _AEE_RUN_ID="$run_id"
  else
    _AEE_RUN_ID="run-$(_aee_ts_ms)-$$"
  fi
  _AEE_TASK_ID="$(_aee_resolve_task_id "$task_id")"
  _AEE_SEAT="$(_aee_resolve_seat)"
}

_aee_emit_line() {
  local state="$1"
  local rc="${2:-}"
  local detail="${3:-}"

  _AEE_SEQ=$((_AEE_SEQ + 1))
  local ts
  ts="$(_aee_ts_ms)"
  local session_id="${AUTOPILOT_SESSION_ID:-$$}"
  [ -z "$_AEE_FLEET_TASK_ID" ] || session_id="fleet-$_AEE_FLEET_TASK_ID"
  local lane="${AUTOPILOT_LANE:-autopilot}"
  local event_id="${_AEE_RUN_ID}-${_AEE_SEQ}"
  local seat="${_AEE_SEAT:-$(_aee_resolve_seat)}"

  local json
  json="$(printf '{"ts":%s,"seat":"%s","session_id":"%s","runner":"%s","agent_kind":"dispatch","lane":"%s","state":"%s","seq":%s,"event_id":"%s","run_id":"%s","stage":"%s"' \
    "$ts" \
    "$(_aee_json_escape "$seat")" \
    "$(_aee_json_escape "$session_id")" \
    "$(_aee_json_escape "$_AEE_RUNNER")" \
    "$(_aee_json_escape "$lane")" \
    "$(_aee_json_escape "$state")" \
    "$_AEE_SEQ" \
    "$(_aee_json_escape "$event_id")" \
    "$(_aee_json_escape "$_AEE_RUN_ID")" \
    "$(_aee_json_escape "$_AEE_STAGE")")"

  if [ -n "$_AEE_TASK_ID" ]; then
    json="${json},\"task_id\":\"$(_aee_json_escape "$_AEE_TASK_ID")\""
  fi
  if [ "$state" = "ended" ]; then
    local rc_num=0
    case "$rc" in
      ''|*[!0-9]*) rc_num=1 ;;
      *) rc_num="$rc" ;;
    esac
    json="${json},\"rc\":${rc_num}"
    if [ -n "$detail" ]; then
      json="${json},\"detail\":\"$(_aee_json_escape "$detail")\""
    fi
  fi
  json="${json}}"

  local fleet_bin
  fleet_bin="$(_aee_fleet_bin)" || fleet_bin="fleet"
  if ! printf '%s\n' "$json" | "$fleet_bin" event emit >/dev/null 2>&1; then
    echo "agent-event-emit: fleet event emit failed (state=$state, run_id=$_AEE_RUN_ID)" >&2
  fi
  return 0
}

agent_event_emit_accepted() {
  _aee_emit_line "accepted"
}

agent_event_emit_ended() {
  local rc="${1:-0}"
  local detail="${2:-}"
  _aee_emit_line "ended" "$rc" "$detail"
}

agent_event_emit_register_exit_trap() {
  local prev
  prev="$(trap -p EXIT | sed "s/^trap -- '\(.*\)' EXIT$/\1/")"
  if [ -n "$prev" ]; then
    # shellcheck disable=SC2064
    trap "agent_event_emit_ended \$?; $prev" EXIT
  else
    trap 'agent_event_emit_ended $?' EXIT
  fi
}
