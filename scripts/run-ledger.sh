#!/usr/bin/env bash
# run-ledger.sh — durable per-run ledger + stage state machine primitives for R0.
#
# This is an additive, standalone foundation for R1-R5 handlers. It stores append-only
# records in JSONL, uses flock for all critical mutation paths, uses write-temp->fsync->rename
# for durable single-path writes, and supports recovery reconciliation against ledger,
# git-truth, and side-effect journal idempotency.
#
# Usage:
#   scripts/run-ledger.sh <command> [--ledger <path>] [options]
#
# Commands:
#   init
#   stage-acquire
#   stage-heartbeat
#   stage-transition
#   stage-apply
#   journal-add
#   stage-probe
#   stage-reconcile
#   gc-check
#   query-latest
#   resource-lock
#   resource-scan
#   write-result
#   write-atomic
#
# Notes:
#   - The default lock order is global and explicit: resource locks (sorted by resource id)
#     first, then run lock.
#   - stage mutations are append-only and never overwrite existing rows.
#   - stale live checks use PID + process start_time dual verification.
#

set -euo pipefail

DEFAULT_STALE_SECS=120
DEFAULT_LOCK_TIMEOUT=15
DEFAULT_MAX_BYTES=${RUN_LEDGER_MAX_BYTES:-262144}
DEFAULT_MAX_ROTATIONS=${RUN_LEDGER_MAX_ROTATIONS:-4}
DEFAULT_QUARANTINE_TTL_SECS=${RUN_LEDGER_QUARANTINE_TTL_SECS:-43200}
DEFAULT_LOCK_DIR_SUFFIX=".run-ledger-lock"

SCRIPT_NAME="$(basename "$0")"

TERMINAL_STATES="committed reviewed verified merged"
BLOCKED_STATES="stale_ignored quarantined dead"

state_rank() {
  case "$1" in
    pending) echo 0 ;;
    leased) echo 1 ;;
    committed) echo 2 ;;
    reviewed) echo 3 ;;
    verified) echo 4 ;;
    merged) echo 5 ;;
    stale_ignored) echo 6 ;;
    quarantined) echo 7 ;;
    dead) echo 8 ;;
    *) echo 0 ;;
  esac
}

is_terminal_gc_state() {
  case "$1" in
    committed|reviewed|verified|merged) return 0 ;;
    *) return 1 ;;
  esac
}

is_blocked_state() {
  case "$1" in
    stale_ignored|quarantined|dead) return 0 ;;
    *) return 1 ;;
  esac
}

is_allowed_transition() {
  local from="$1" to="$2"
  case "$from" in
    pending)
      case "$to" in
        leased|stale_ignored|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    leased)
      case "$to" in
        committed|reviewed|verified|merged|stale_ignored|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    committed)
      case "$to" in
        reviewed|stale_ignored|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    reviewed)
      case "$to" in
        verified|stale_ignored|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    verified)
      case "$to" in
        merged|stale_ignored|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    stale_ignored|quarantined|dead)
      case "$to" in
        stale_ignored|quarantined|dead) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *)
      return 1
      ;;
  esac
}

error() {
  echo "$SCRIPT_NAME: $*" >&2
  exit 1
}

usage() {
  sed -n '1,240p' "$0" | sed -n '1,220p'
  exit 1
}

now_ts() { date +%s; }
iso_ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

rand_hex() {
  local v
  v="$(tr -dc 'a-f0-9' < /dev/urandom | head -c 16 || true)"
  echo "${v:-0}"
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || error "required command '$cmd' not found"
}

require_cmd flock
require_cmd jq
require_cmd sha256sum

canonical_ledger_path() {
  local ledger="$1"
  if [ -z "$ledger" ]; then
    echo "$PWD/.autopilot/run-ledger.jsonl"
  else
    echo "$ledger"
  fi
}

run_lock_path() {
  local ledger="$1" run_id="$2"
  echo "${ledger}.locks/run.${run_id}.lock"
}

resource_lock_path() {
  local ledger="$1" resource_id="$2"
  local hash
  hash="$(printf '%s' "$resource_id" | sha256sum | awk '{print $1}')"
  echo "${ledger}.locks/res.${hash}.lock"
}

resource_row_id() {
  local resource_id="$1"
  printf '%s' "$resource_id"
}

acquire_lock() {
  local lock_file="$1" timeout="$2" out_var="${3:-}"
  local fd
  mkdir -p "$(dirname "$lock_file")"
  exec {fd}>"$lock_file"
  if ! flock -x -w "$timeout" "$fd"; then
    exec {fd}>&-
    return 1
  fi
  if [ -n "$out_var" ]; then
    printf -v "$out_var" '%s' "$fd"
    return 0
  fi
  echo "$fd"
}

acquire_resource_lock() {
  local lock_file="$1" timeout="$2" owner_json="$3"
  local out_fd="${4:-}"
  local lock_fd
  acquire_lock "$lock_file" "$timeout" lock_fd || return 1
  printf '%s
' "$owner_json" > "$lock_file"
  if [ -n "$out_fd" ]; then
    printf -v "$out_fd" '%s' "$lock_fd"
    return 0
  fi
  echo "$lock_fd"
}

release_lock() {
  local fd="$1"
  flock -u "$fd" 2>/dev/null || true
  eval "exec ${fd}>&-"
}

read_lock_owner() {
  local lock_file="$1" key
  if [ ! -f "$lock_file" ]; then
    return 1
  fi
  if ! jq -e . "$lock_file" >/dev/null 2>&1; then
    return 1
  fi
  cat "$lock_file"
}

sort_csv_ids() {
  local csv="$1"
  printf '%s' "$csv" | tr ',' '\n' | sed '/^$/d' | sort -u | tr '\n' ',' | sed 's/,$//'
}

get_process_start_time() {
  local pid="$1"
  if [ ! -r "/proc/$pid/stat" ]; then
    echo "0"
    return
  fi
  local start_ticks
  start_ticks="$(awk '{print $22}' "/proc/$pid/stat")"
  if [ -z "$start_ticks" ]; then
    echo "0"
    return
  fi
  local btime clock_ticks
  btime="$(awk '/^btime /{print $2}' /proc/stat 2>/dev/null || echo 0)"
  clock_ticks="$(getconf CLK_TCK)"
  if [ -z "$clock_ticks" ] || [ "$clock_ticks" -le 0 ] || [ -z "$btime" ]; then
    echo "0"
    return
  fi
  echo $((btime + start_ticks / clock_ticks))
}

is_process_alive() {
  local pid="$1" expected_start="$2"
  if [ -z "$pid" ] || [ "$pid" -le 0 ] || [ ! -d "/proc/$pid" ]; then
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if [ -n "$expected_start" ] && [ "$expected_start" -gt 0 ]; then
    local current_start
    current_start="$(get_process_start_time "$pid")"
    if [ "$current_start" -ne "$expected_start" ]; then
      return 1
    fi
  fi
  return 0
}

atomic_write_temp() {
  local target="$1"
  local data="$2"
  local tmp="${target}.tmp.$$"
  mkdir -p "$(dirname "$target")"
  printf '%s' "$data" > "$tmp"
  sync -d "$tmp"
  mv "$tmp" "$target"
  sync -f "$(dirname "$target")"
}

atomic_append_ledger() {
  local ledger="$1"
  local line="$2"
  local fd="$3"

  local tmp="${ledger}.tmp.$$"
  if [ -f "$ledger" ]; then
    cp "$ledger" "$tmp"
  else
    : > "$tmp"
  fi

  local max_bytes max_rot
  max_bytes="${RUN_LEDGER_MAX_BYTES:-$DEFAULT_MAX_BYTES}"
  max_rot="${RUN_LEDGER_MAX_ROTATIONS:-$DEFAULT_MAX_ROTATIONS}"

  if [ -s "$tmp" ]; then
    local bytes
    bytes=$(wc -c < "$tmp")
    if [ "$bytes" -ge "$max_bytes" ] && [ "$max_bytes" -gt 0 ]; then
      local idx
      idx=$max_rot
      while [ "$idx" -ge 2 ]; do
        local prev=$((idx - 1))
        if [ -f "${ledger}.${prev}" ]; then
          mv "${ledger}.${prev}" "${ledger}.${idx}"
        fi
        idx=$((idx - 1))
      done
      if [ -f "$ledger" ]; then
        mv "$ledger" "${ledger}.1"
      fi
      : > "$tmp"
    fi
  fi

  printf '%s
' "$line" >> "$tmp"
  sync -d "$tmp"
  mv "$tmp" "$ledger"
  sync -f "$(dirname "$ledger")"
  flock -u "$fd"
  eval "exec ${fd}>&-"
}

with_run_lock() {
  local ledger="$1" run_id="$2" timeout="$3"
  local out_var="${4:-}"
  local lock_file lock_fd
  lock_file="$(run_lock_path "$ledger" "$run_id")"
  acquire_lock "$lock_file" "$timeout" lock_fd || return 1
  if [ -n "$out_var" ]; then
    printf -v "$out_var" '%s' "$lock_fd"
    return 0
  fi
  echo "$lock_fd"
}

with_resource_locks() {
  local ledger="$1" resource_csv="$2" timeout="$3"
  local out_var="${4:-}"
  local sorted="$(sort_csv_ids "$resource_csv")"
  if [ -z "$sorted" ]; then
    [ -n "$out_var" ] && printf -v "$out_var" '%s' ""
    return 0
  fi

  local lock_fds=""
  local resource
  local IFS=','
  for resource in $sorted; do
    [ -z "$resource" ] && continue
    local path fd
    path="$(resource_lock_path "$ledger" "$resource")"
    acquire_resource_lock "$path" "$timeout" '{"resource_state":"waiting"}' fd || return 1
    lock_fds="${lock_fds}${fd} "
  done
  if [ -n "$out_var" ]; then
    printf -v "$out_var" '%s' "$lock_fds"
    return 0
  fi
  echo "$lock_fds"
}

audit_resource_contention() {
  local ledger="$1" resource_id="$2"
  local last
  if [ ! -f "$ledger" ]; then
    echo "active"
    return
  fi
  last="$(jq -r -s --arg rid "$resource_id" '
    [ .[] | select(.kind=="resource" and .resource_id==$rid) ]
    | if length==0 then empty else .[-1].state end
  ' "$ledger")"
  if [ -z "$last" ] || [ "$last" = "null" ]; then
    echo "active"
  else
    echo "$last"
  fi
}

append_record() {
  local ledger="$1"
  local run_id="$2"
  local row_json="$3"
  local timeout="$4"
  local run_lock_fd="${5:-}"

  if [ -n "$run_lock_fd" ]; then
    atomic_append_ledger "$ledger" "$row_json" "$run_lock_fd"
    return 0
  fi

  local run_fd
  with_run_lock "$ledger" "$run_id" "$timeout" run_fd || error "failed to acquire run lock"
  atomic_append_ledger "$ledger" "$row_json" "$run_fd"
}

latest_stage_record() {
  local ledger="$1" run_id="$2" stage="$3"
  if [ ! -f "$ledger" ]; then
    echo ""
    return
  fi
  jq -c --arg rid "$run_id" --arg stg "$stage" '
    [ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) ]
    | if length==0 then empty else .[-1] end
  ' "$ledger"
}

has_applied_journal_key() {
  local ledger="$1" run_id="$2" stage="$3" generation="$4" idempotency_key="$5"
  if [ ! -f "$ledger" ] || [ -z "$idempotency_key" ]; then
    echo "false"
    return
  fi
  local exists
  exists="$(jq -r --arg rid "$run_id" --arg stg "$stage" --arg gid "$generation" --arg key "$idempotency_key" '
    [ .[]
      | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.generation|tostring)==$gid and .idempotency_key==$key and .status=="applied") ]
    | if length>0 then true else false end
  ' "$ledger")"
  echo "$exists"
}

write_side_effect_row() {
  local ledger="$1" run_id="$2" stage="$3" generation="$4" nonce="$5" op="$6" idempotency_key="$7" status="$8" payload="$9" timeout="${10}"

  local line
  line="$(jq -nc \
    --arg kind "journal" \
    --arg ts "$(iso_ts)" \
    --arg run_id "$run_id" \
    --arg stage "$stage" \
    --arg op "$op" \
    --arg id_key "$idempotency_key" \
    --arg status "$status" \
    --argjson gen "$generation" \
    --arg nonce "$nonce" \
    --arg payload "$payload" \
    '{kind:$kind,ts:$ts,run_id:$run_id,stage:$stage,generation:$gen,nonce:$nonce,op:$op,idempotency_key:$id_key,status:$status,payload:$payload}')"
  append_record "$ledger" "$run_id" "$line" "$timeout"
}

command_stage_acquire() {
  local ledger="" run_id="" stage="" pid="" start_time="" heartbeat_ts="" git_ref="" git_sha="" worktree="" resources="" allow_reopen="0" timeout="$DEFAULT_LOCK_TIMEOUT" stale_secs="$DEFAULT_STALE_SECS"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --pid) pid="$2"; shift 2 ;;
      --start-time) start_time="$2"; shift 2 ;;
      --heartbeat-ts) heartbeat_ts="$2"; shift 2 ;;
      --git-ref) git_ref="$2"; shift 2 ;;
      --git-sha) git_sha="$2"; shift 2 ;;
      --worktree) worktree="$2"; shift 2 ;;
      --resources) resources="$2"; shift 2 ;;
      --allow-reopen) allow_reopen=1; shift ;;
      --timeout) timeout="$2"; shift 2 ;;
      --stale-seconds) stale_secs="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id is required"
  [ -n "$stage" ] || error "--stage is required"
  [ -n "$pid" ] || pid=$$
  [ -n "$start_time" ] || start_time="$(get_process_start_time "$pid")"
  [ -n "$start_time" ] || start_time="$(now_ts)"
  [ -n "$heartbeat_ts" ] || heartbeat_ts="$(now_ts)"

  resources="$(sort_csv_ids "$resources")"

  local latest latest_state latest_gen latest_nonce
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -n "$latest" ]; then
    latest_state="$(jq -r '.state' <<<"$latest")"
    latest_gen="$(jq -r '.generation // 0' <<<"$latest")"
    latest_nonce="$(jq -r '.nonce // empty' <<<"$latest")"

    local latest_alive=1
    if [ "$latest_state" = "leased" ]; then
      if is_process_alive "$(jq -r '.pid' <<<"$latest")" "$(jq -r '.start_time' <<<"$latest")"; then
        last_hb="$(jq -r '.heartbeat_ts // 0' <<<"$latest")"
        now=$(now_ts)
        if [ "$((now - last_hb))" -lt "$stale_secs" ]; then
          latest_alive=0
          is_terminal_gstate=0
        fi
      fi
    fi
    if [ "$latest_state" = "leased" ] && [ "$latest_alive" -eq 0 ]; then
      # keep allowing renewal from stale leased holder only when explicitly stale/allow-reopen
      :
    elif is_terminal_gc_state "$latest_state" && [ "$allow_reopen" -eq 0 ]; then
      error "run=$run_id stage=$stage already in terminal state=$latest_state; pass --allow-reopen"
    fi
  fi

  local resource_fds=""
  if [ -n "$resources" ]; then
    with_resource_locks "$ledger" "$resources" "$timeout" resource_fds || error "could not acquire resource locks"
  fi

  local run_fd
  with_run_lock "$ledger" "$run_id" "$timeout" run_fd || {
    if [ -n "$resource_fds" ]; then
      for fd in $resource_fds; do release_lock "$fd"; done
    fi
    error "run-lock unavailable"
  }

  if [ -n "$latest" ] && is_blocked_state "$latest_state" && [ "$allow_reopen" -eq 0 ]; then
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    [ -n "$resource_fds" ] && for fd in $resource_fds; do release_lock "$fd"; done
    error "run=$run_id stage=$stage in non-reopenable state=$latest_state"
  fi

  local next_gen
  if [ -n "$latest" ]; then
    if [ "${latest_gen:-0}" -ge 0 ]; then
      next_gen=$((latest_gen + 1))
    else
      next_gen=1
    fi
  else
    next_gen=1
  fi
  local nonce
  nonce="$(rand_hex)"

  local line
  line="$(jq -nc \
    --arg kind "stage" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg state "leased" \
    --arg nonce_v "$nonce" \
    --argjson gen "$next_gen" \
    --arg pid_v "$pid" \
    --arg start_v "$start_time" \
    --arg hb "$heartbeat_ts" \
    --arg git_ref_v "$git_ref" \
    --arg git_sha_v "$git_sha" \
    --arg wt "$worktree" \
    --arg resources_v "$resources" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,generation:$gen,nonce:$nonce_v,pid:($pid_v|tonumber),start_time:($start_v|tonumber),heartbeat_ts:($hb|tonumber),git_ref:$git_ref_v,git_sha:$git_sha_v,worktree:$wt,resources:$resources_v,reason:"acquire"}')"
  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"

  for fd in $resource_fds; do release_lock "$fd"; done

  echo "$line"
}

command_stage_heartbeat() {
  local ledger="" run_id="" stage="" generation="" nonce="" pid="" start_time="" heartbeat_ts=""
  local timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --generation) generation="$2"; shift 2 ;;
      --nonce) nonce="$2"; shift 2 ;;
      --pid) pid="$2"; shift 2 ;;
      --start-time) start_time="$2"; shift 2 ;;
      --heartbeat-ts) heartbeat_ts="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"
  [ -n "$generation" ] || error "--generation required"
  [ -n "$nonce" ] || error "--nonce required"
  [ -n "$pid" ] || pid=$$
  [ -n "$start_time" ] || start_time="$(get_process_start_time "$pid")"
  [ -n "$heartbeat_ts" ] || heartbeat_ts="$(now_ts)"

  local latest
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$latest" ]; then
    error "no stage row to heartbeat"
  fi

  local latest_generation latest_nonce
  latest_generation="$(jq -r '.generation // 0' <<<"$latest")"
  latest_nonce="$(jq -r '.nonce // empty' <<<"$latest")"

  local resources
  resources="$(jq -r '.resources // ""' <<<"$latest")"

  local r_fds=""
  with_resource_locks "$ledger" "$resources" "$timeout" r_fds || error "resource lock unavailable"

  local run_fd
  with_run_lock "$ledger" "$run_id" "$timeout" run_fd || {
    for fd in $r_fds; do release_lock "$fd"; done
    error "run lock unavailable"
  }

  if [ "$generation" -ne "$latest_generation" ] || [ "$nonce" != "$latest_nonce" ]; then
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "heartbeat writer fenced (generation/nonce mismatch)"
  fi

  local line
  line="$(jq -nc \
    --arg kind "heartbeat" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg state "heartbeat" \
    --arg nonce_v "$nonce" \
    --argjson gen "$generation" \
    --arg pid_v "$pid" \
    --arg start_v "$start_time" \
    --arg hb "$heartbeat_ts" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,generation:$gen,nonce:$nonce_v,pid:($pid_v|tonumber),start_time:($start_v|tonumber),heartbeat_ts:($hb|tonumber)}')"
  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
  for fd in $r_fds; do release_lock "$fd"; done
  echo "$line"
}

command_journal_add() {
  local ledger="" run_id="" stage="" generation="" nonce="" idempotency_key="" op="journal" status="applied" payload='{}' timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --generation) generation="$2"; shift 2 ;;
      --nonce) nonce="$2"; shift 2 ;;
      --idempotency-key) idempotency_key="$2"; shift 2 ;;
      --op) op="$2"; shift 2 ;;
      --status) status="$2"; shift 2 ;;
      --payload) payload="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"
  [ -n "$generation" ] || error "--generation required"
  [ -n "$nonce" ] || error "--nonce required"
  [ -n "$idempotency_key" ] || error "--idempotency-key required"

  if [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
    echo '{"status":"already_applied"}'
    return 0
  fi

  local existing
  existing="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$existing" ]; then
    error "stage row missing; record journal after stage is acquired first"
  fi

  write_side_effect_row "$ledger" "$run_id" "$stage" "$generation" "$nonce" "$op" "$idempotency_key" "$status" "$payload" "$timeout"
  echo '{"status":"recorded"}'
}

command_stage_transition() {
  local ledger="" run_id="" stage="" generation="" nonce="" to_state="" idempotency_key=""
  local git_ref="" git_sha="" worktree="" required_side_effect_keys="" timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --generation) generation="$2"; shift 2 ;;
      --nonce) nonce="$2"; shift 2 ;;
      --to-state) to_state="$2"; shift 2 ;;
      --idempotency-key) idempotency_key="$2"; shift 2 ;;
      --git-ref) git_ref="$2"; shift 2 ;;
      --git-sha) git_sha="$2"; shift 2 ;;
      --worktree) worktree="$2"; shift 2 ;;
      --required-side-effect-keys) required_side_effect_keys="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"
  [ -n "$generation" ] || error "--generation required"
  [ -n "$nonce" ] || error "--nonce required"
  [ -n "$to_state" ] || error "--to-state required"

  local latest
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  [ -n "$latest" ] || error "no stage exists for run=$run_id stage=$stage"

  local current_state current_gen current_nonce resources git_ref_cur git_sha_cur worktree_cur
  current_state="$(jq -r '.state' <<<"$latest")"
  current_gen="$(jq -r '.generation // 0' <<<"$latest")"
  current_nonce="$(jq -r '.nonce // empty' <<<"$latest")"
  resources="$(jq -r '.resources // ""' <<<"$latest")"

  local r_fds=""
  with_resource_locks "$ledger" "$resources" "$timeout" r_fds || error "resource lock unavailable"
  local run_fd
  with_run_lock "$ledger" "$run_id" "$timeout" run_fd || {
    for fd in $r_fds; do release_lock "$fd"; done
    error "run lock unavailable"
  }

  if [ "$generation" -ne "$current_gen" ] || [ "$nonce" != "$current_nonce" ]; then
    local stale_line
    stale_line="$(jq -nc \
      --arg kind "stage" \
      --arg ts "$(iso_ts)" \
      --arg rid "$run_id" \
      --arg stg "$stage" \
      --arg state "stale_ignored" \
      --arg reason "late_writer" \
      --argjson gen "$current_gen" \
      --arg nonce_v "$nonce" \
      --arg from "${current_state}" \
      --arg to "$to_state" \
      '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,reason:$reason,generation:$gen,nonce:$nonce_v,transition_from:$from,transition_to:$to}')"
    append_record "$ledger" "$run_id" "$stale_line" "$timeout" "$run_fd"
    for fd in $r_fds; do release_lock "$fd"; done
    echo "$stale_line"
    return 11
  fi

  if ! is_allowed_transition "$current_state" "$to_state"; then
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "invalid transition ${current_state} -> ${to_state}"
  fi

  if [ "$(state_rank "$to_state")" -le "$(state_rank "$current_state")" ] && [ "${current_state}" != "$to_state" ]; then
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "non-forward transition requested"
  fi

  if [ "$current_state" = "$to_state" ]; then
    if [ -n "$idempotency_key" ] && [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
      flock -u "$run_fd"; eval "exec ${run_fd}>&-"
      for fd in $r_fds; do release_lock "$fd"; done
      echo '{"status":"already_applied","state":"'$current_state'"}'
      return 0
    fi
  fi

  git_ref="${git_ref:-$(jq -r '.git_ref // ""' <<<"$latest")}"
  git_sha="${git_sha:-$(jq -r '.git_sha // ""' <<<"$latest")}"
  worktree="${worktree:-$(jq -r '.worktree // ""' <<<"$latest")}"

  local line
  line="$(jq -nc \
    --arg kind "stage" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg state "$to_state" \
    --arg reason "transition" \
    --arg id_key "$idempotency_key" \
    --arg from "$current_state" \
    --argjson gen "$generation" \
    --arg nonce_v "$nonce" \
    --argjson req "$(jq -Rc 'split(",")' <<<"$required_side_effect_keys")" \
    --arg git_ref_v "$git_ref" \
    --arg git_sha_v "$git_sha" \
    --arg wt "$worktree" \
    --arg resources_v "$resources" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,reason:$reason,idempotency_key:$id_key,transition_from:$from,generation:$gen,nonce:$nonce_v,required_side_effect_keys:$req,git_ref:$git_ref_v,git_sha:$git_sha_v,worktree:$wt,resources:$resources_v}')"
  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
  for fd in $r_fds; do release_lock "$fd"; done
  echo "$line"
}

command_stage_apply() {
  local ledger="" run_id="" stage="" generation="" nonce="" to_state="" idempotency_key="" payload='{}' timeout="$DEFAULT_LOCK_TIMEOUT" side_effect_op="apply_stage"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --generation) generation="$2"; shift 2 ;;
      --nonce) nonce="$2"; shift 2 ;;
      --to-state) to_state="$2"; shift 2 ;;
      --idempotency-key) idempotency_key="$2"; shift 2 ;;
      --payload) payload="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      --op) side_effect_op="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"
  [ -n "$generation" ] || error "--generation required"
  [ -n "$nonce" ] || error "--nonce required"
  [ -n "$to_state" ] || error "--to-state required"

  if [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
    echo '{"status":"already_applied"}'
    return 0
  fi

  local existing_line
  existing_line="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$existing_line" ]; then
    error "stage not initialized"
  fi

  local current_gen current_nonce current_state
  current_gen="$(jq -r '.generation // 0' <<<"$existing_line")"
  current_nonce="$(jq -r '.nonce // empty' <<<"$existing_line")"
  current_state="$(jq -r '.state' <<<"$existing_line")"

  if [ "$generation" -ne "$current_gen" ] || [ "$nonce" != "$current_nonce" ]; then
    error "stage transition token invalid"
  fi

  # Record side effect first so probe/recovery can reason on idempotent key.
  if [ -n "$idempotency_key" ]; then
    write_side_effect_row "$ledger" "$run_id" "$stage" "$generation" "$nonce" "$side_effect_op" "$idempotency_key" "applied" "$payload" "$timeout"
  fi

  command_stage_transition \
    --ledger "$ledger" \
    --run-id "$run_id" \
    --stage "$stage" \
    --generation "$generation" \
    --nonce "$nonce" \
    --to-state "$to_state" \
    --idempotency-key "${idempotency_key}" \
    --timeout "$timeout" \
    >/dev/null
  echo '{"status":"applied"}'
}

command_stage_probe() {
  local ledger="" run_id="" stage="" stale_secs="$DEFAULT_STALE_SECS" timeout="$DEFAULT_LOCK_TIMEOUT" quarantine_on_stale_alive=0

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --stale-seconds) stale_secs="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      --quarantine-on-stale-alive) quarantine_on_stale_alive=1; shift ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"

  local latest
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$latest" ]; then
    error "no stage found"
  fi

  local state generation nonce pid start_time hb resources
  state="$(jq -r '.state' <<<"$latest")"
  generation="$(jq -r '.generation // 0' <<<"$latest")"
  nonce="$(jq -r '.nonce // empty' <<<"$latest")"
  pid="$(jq -r '.pid // "0"' <<<"$latest")"
  start_time="$(jq -r '.start_time // "0"' <<<"$latest")"
  hb="$(jq -r '.heartbeat_ts // "0"' <<<"$latest")"
  resources="$(jq -r '.resources // ""' <<<"$latest")"

  if [ "$state" != "leased" ]; then
    echo '{"status":"noop","reason":"not_leased"}'
    return 0
  fi

  local now
  now="$(now_ts)"
  local age=$((now - hb))
  if [ "$age" -lt "$stale_secs" ]; then
    echo '{"status":"alive","state":"leased"}'
    return 0
  fi

  local live=1
  if is_process_alive "$pid" "$start_time"; then
    live=0
  fi

  local target_state="dead"
  local reason="stale_missing"
  if [ "$live" -eq 0 ]; then
    target_state="stale_ignored"
    reason="stale_writer_alive"
  fi

  command_stage_transition \
    --ledger "$ledger" \
    --run-id "$run_id" \
    --stage "$stage" \
    --generation "$generation" \
    --nonce "$nonce" \
    --to-state "$target_state" \
    --timeout "$timeout"

  if [ "$live" -eq 0 ] && [ "$quarantine_on_stale_alive" -eq 1 ]; then
    for resource in $(printf '%s' "$resources" | tr ',' '\n' | sed '/^$/d'); do
      command_resource_mark "${ledger}" "$resource" "$run_id" "$generation" "$nonce" "$reason" "$timeout"
    done
  fi

  echo '{"status":"updated","to":"'"$target_state"'","reason":"'"$reason"'"}'
}

command_resource_mark() {
  local ledger="$1" resource_id="$2" run_id="$3" generation="$4" nonce="$5" reason="${6:-recovery}" timeout="$7"
  [ -n "$ledger" ] || error "ledger required"
  [ -n "$resource_id" ] || error "resource-id required"

  local state
  state="$(audit_resource_contention "$ledger" "$resource_id")"
  if [ "$state" = "quarantined" ]; then
    echo '{"status":"already_quarantined"}'
    return 0
  fi
  local ttl_sec
  ttl_sec="$(now_ts)"
  local ttl=$((ttl_sec + DEFAULT_QUARANTINE_TTL_SECS))
  local line
  line="$(jq -nc \
    --arg kind "resource" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg resource "$resource_id" \
    --arg state_v "quarantined" \
    --arg reason_v "$reason" \
    --argjson gen "$generation" \
    --arg nonce_v "$nonce" \
    --argjson ts_exp "$ttl" \
    '{kind:$kind,ts:$ts,run_id:$rid,resource_id:$resource,state:$state_v,reason:$reason_v,generation:$gen,nonce:$nonce_v,quarantine_expires_at:($ts_exp)}')"
  append_record "$ledger" "$run_id" "$line" "$timeout"
  echo '{"status":"quarantined"}'
}


command_resource_lock() {
  local ledger="" resource_id="" run_id="" stage="" pid="" start_time="" timeout="$DEFAULT_LOCK_TIMEOUT" hold_seconds="" heartbeat_ts=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --resource-id) resource_id="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --pid) pid="$2"; shift 2 ;;
      --start-time) start_time="$2"; shift 2 ;;
      --heartbeat-ts) heartbeat_ts="$2"; shift 2 ;;
      --hold-seconds) hold_seconds="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$resource_id" ] || error "--resource-id required"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"
  [ -n "$pid" ] || pid=$$
  [ -n "$start_time" ] || start_time="$(get_process_start_time "$pid")"
  [ -n "$heartbeat_ts" ] || heartbeat_ts="$(now_ts)"

  case "$hold_seconds" in
    ""|*[!0-9]*) hold_seconds="" ;;
    *) : ;;
  esac

  local path
  path="$(resource_lock_path "$ledger" "$resource_id")"
  local state
  state="$(audit_resource_contention "$ledger" "$resource_id")"
  if [ "$state" = "quarantined" ]; then
    error "resource "$resource_id" currently quarantined"
  fi

  local fd held_at
  held_at="$(now_ts)"
  local meta
  meta="$(jq -nc \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg resource "$resource_id" \
    --arg pid_v "$pid" \
    --arg start_v "$start_time" \
    --arg hb "$heartbeat_ts" \
    --arg held "$held_at" \
    '{resource_id:$resource,run_id:$rid,stage:$stg,pid:($pid_v|tonumber),start_time:($start_v|tonumber),heartbeat_ts:($hb|tonumber),held_at:($held|tonumber)}')"
  acquire_resource_lock "$path" "$timeout" "$meta" fd || error "resource lock unavailable"

  local out
  out="$(jq -nc \
    --arg kind "resource" \
    --arg rid "$resource_id" \
    --argjson fd "$fd" \
    --arg lock_for "$run_id" \
    --arg stg "$stage" \
    --argjson hold "${hold_seconds:-0}" \
    --arg held "$held_at" \
    '{status:"acquired",kind:$kind,resource_id:$rid,run_id:$lock_for,stage:$stg,lock_fd:($fd),held_at:($held|tonumber),hold_seconds:($hold|tonumber)}')"

  if [ -n "$hold_seconds" ]; then
    sleep "$hold_seconds"
  fi

  flock -u "$fd"
  eval "exec ${fd}>&-"
  echo "$out"
}

command_stage_reconcile() {
  local ledger="" run_id="" stage="" result_path="" git_dir="" timeout="$DEFAULT_LOCK_TIMEOUT"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --result-json) result_path="$2"; shift 2 ;;
      --git-dir) git_dir="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"

  local latest
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$latest" ]; then
    echo "{\"status\":\"missing\",\"reason\":\"no_stage_row\",\"run_id\":\"$run_id\",\"stage\":\"$stage\"}"
    return 0
  fi

  local state generation nonce git_ref git_sha worktree resources git_root start_time pid
  state="$(jq -r '.state' <<<"$latest")"
  generation="$(jq -r '.generation // 0' <<<"$latest")"
  nonce="$(jq -r '.nonce // empty' <<<"$latest")"
  git_ref="$(jq -r '.git_ref // ""' <<<"$latest")"
  git_sha="$(jq -r '.git_sha // ""' <<<"$latest")"
  worktree="$(jq -r '.worktree // ""' <<<"$latest")"
  pid="$(jq -r '.pid // "0"' <<<"$latest")"
  start_time="$(jq -r '.start_time // "0"' <<<"$latest")"
  resources="$(jq -r '.resources // ""' <<<"$latest")"

  local has_result=0
  local result_valid=1
  if [ -n "$result_path" ]; then
    if [ -f "$result_path" ]; then
      if jq -e . "$result_path" >/dev/null 2>&1; then
        has_result=1
      else
        has_result=0
        result_valid=0
      fi
    else
      has_result=0
    fi
  fi

  local terminal_state=0 blocked_state=0
  if is_terminal_gc_state "$state"; then
    terminal_state=1
  fi
  if is_blocked_state "$state"; then
    blocked_state=1
  fi

  local git_truth=0
  if [ -n "$git_sha" ]; then
    if [ -z "$git_dir" ] && [ -n "$worktree" ]; then
      git_dir="$worktree"
    fi

    if [ -n "$git_dir" ] && [ -d "$git_dir/.git" ]; then
      if git -C "$git_dir" rev-parse -q --verify "${git_sha}^{commit}" >/dev/null 2>&1; then
        if [ -n "$git_ref" ] && [ "$git_ref" != "null" ]; then
          local ref_sha
          ref_sha="$(git -C "$git_dir" rev-parse -q "$git_ref" 2>/dev/null || true)"
          if [ -n "$ref_sha" ]; then
            if [ "$ref_sha" = "$git_sha" ]; then
              git_truth=1
            elif git -C "$git_dir" merge-base --is-ancestor "$git_sha" "$ref_sha" 2>/dev/null; then
              git_truth=1
            fi
          fi
        else
          git_truth=1
        fi
      fi
    fi
  fi

  local pending_side_effects=0
  if [ -f "$ledger" ]; then
    pending_side_effects="$(jq -s --arg rid "$run_id" --arg stg "$stage" '
      [ .[] | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.status|ascii_downcase) != "applied") ]
      | length' "$ledger" 2>/dev/null || echo 0)"
  fi
  pending_side_effects="${pending_side_effects:-0}"

  local status reason=""
  if [ "$blocked_state" -eq 1 ]; then
    status="blocked"
    reason="blocked_state"
  elif [ "$terminal_state" -eq 1 ]; then
    status="resolved"
    reason="terminal_state"
  elif [ "$result_valid" -ne 1 ]; then
    status="invalid_result"
    reason="result_json_parse_failed"
  elif [ "$has_result" -eq 1 ] && [ "$pending_side_effects" -eq 0 ]; then
    status="resolved"
    reason="result_present"
  elif [ "$git_truth" -eq 1 ] && [ "$pending_side_effects" -eq 0 ]; then
    status="resolved"
    reason="git_truth"
  else
    status="incomplete"
    reason="missing_result"
  fi

  local alive=0
  if is_process_alive "$pid" "$start_time"; then
    alive=1
  fi

  jq -nc \
    --arg status "$status" \
    --arg reason "$reason" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg state_v "$state" \
    --argjson generation "$generation" \
    --arg nonce_v "$nonce" \
    --argjson has_result "$has_result" \
    --argjson git_truth "$git_truth" \
    --argjson pending "$pending_side_effects" \
    --argjson terminal "$terminal_state" \
    --argjson blocked "$blocked_state" \
    --argjson is_alive "$alive" \
    --arg resources "$resources" \
    '{status:$status,reason:$reason,run_id:$rid,stage:$stg,state:$state_v,generation:$generation,nonce:$nonce_v,has_result:($has_result|if . then true else false end),git_truth:($git_truth|if . then true else false end),pending_side_effects:($pending|tonumber),terminal:($terminal|if . then true else false end),blocked_state:($blocked|if . then true else false end),holder_alive:($is_alive|if . then true else false end),resources:$resources}'
}

command_gc_check() {
  local ledger="" run_id="" stage="" timeout="$DEFAULT_LOCK_TIMEOUT"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$stage" ] || error "--stage required"

  local latest
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$latest" ]; then
    echo "{\"status\":\"missing\",\"run_id\":\"$run_id\",\"stage\":\"$stage\"}"
    return 0
  fi

  local state generation pid start_time worktree resources
  state="$(jq -r '.state' <<<"$latest")"
  generation="$(jq -r '.generation // 0' <<<"$latest")"
  pid="$(jq -r '.pid // "0"' <<<"$latest")"
  start_time="$(jq -r '.start_time // "0"' <<<"$latest")"
  worktree="$(jq -r '.worktree // ""' <<<"$latest")"
  resources="$(jq -r '.resources // ""' <<<"$latest")"

  local eligible=1
  local reasons=()
  if ! is_terminal_gc_state "$state"; then
    reasons+=("not_terminal_gc_state")
    eligible=0
  fi
  if is_blocked_state "$state"; then
    reasons+=("blocked_state")
    eligible=0
  fi

  if is_process_alive "$pid" "$start_time"; then
    reasons+=("active_holder")
    eligible=0
  fi

  local pending_side_effects=0
  if [ -f "$ledger" ]; then
    pending_side_effects="$(jq -s --arg rid "$run_id" --arg stg "$stage" '
      [ .[] | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.status|ascii_downcase) != "applied") ]
      | length' "$ledger" 2>/dev/null || echo 0)"
  fi
  pending_side_effects="${pending_side_effects:-0}"
  if [ "$pending_side_effects" -ne 0 ]; then
    reasons+=("pending_side_effects")
    eligible=0
  fi

  local worktree_state="clean"
  if [ -n "$worktree" ] && [ -d "$worktree/.git" ]; then
    if [ -n "$(git -C "$worktree" status --porcelain 2>/dev/null || true)" ]; then
      reasons+=("worktree_dirty")
      worktree_state="dirty"
      eligible=0
    fi
  fi

  local resource_count=0
  if [ -n "$resources" ]; then
    local resource
    IFS=','
    for resource in $resources; do
      [ -z "$resource" ] && continue
      resource_count=$((resource_count + 1))
      local rstate
      rstate="$(audit_resource_contention "$ledger" "$resource")"
      if [ "$rstate" != "active" ] && [ "$rstate" != "" ]; then
        reasons+=("resource_${resource}_state_${rstate}")
        eligible=0
      fi
    done
    IFS=' '
  fi

  local reason_json
  if [ ${#reasons[@]} -eq 0 ]; then
    reason_json='[]'
  else
    reason_json="$(printf '%s\n' "${reasons[@]}" | jq -R -s -c 'split("\n") | map(select(length > 0))')"
  fi

  local status="eligible"
  if [ "$eligible" -ne 1 ]; then
    status="blocked"
  fi

  jq -nc \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --arg state_v "$state" \
    --argjson gen "$generation" \
    --argjson eligible_v "$eligible" \
    --arg worktree_state_v "$worktree_state" \
    --argjson resource_cnt "$resource_count" \
    --argjson pending "$pending_side_effects" \
    --argjson reason_json "$reason_json" \
    --arg status_v "$status" \
    '{status:$status_v,run_id:$rid,stage:$stg,state:$state_v,generation:$gen,eligible:($eligible_v|if . then true else false end),worktree_state:$worktree_state_v,resources_count:($resource_cnt|tonumber),pending_side_effects:($pending|tonumber),reasons:$reason_json}'
}

command_query_latest() {
  local ledger="" run_id="" stage="" resource_id="" kind=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --resource-id) resource_id="$2"; shift 2 ;;
      --kind) kind="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$kind" ] || kind="latest"

  if [ "$kind" = "stage" ] || [ -n "$stage" ]; then
    if [ -z "$run_id" ] || [ -z "$stage" ]; then
      error "--run-id and --stage required for stage query"
    fi
    latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
    if [ -z "$latest" ]; then
      echo '{}'
      return 0
    fi
    echo "$latest"
    return 0
  fi

  if [ -n "$resource_id" ]; then
    if [ -z "$ledger" ] || [ -z "$run_id" ]; then
      error "--ledger and --run-id required for resource query"
    fi
    if [ ! -f "$ledger" ]; then
      echo '{}'
      return 0
    fi
    jq -s --arg rid "$resource_id" '
      [ .[] | select(.kind=="resource" and .resource_id==$rid) ]
      | if length==0 then {} else .[-1] end' "$ledger"
    return 0
  fi

  if [ -z "$run_id" ]; then
    echo "{\"status\":\"missing_filter\",\"error\":\"run_id required when not querying by resource\"}"
    return 0
  fi

  jq -s --arg rid "$run_id" '
    [ .[] | select(.kind=="stage" and .run_id==$rid) ]
    | if length==0 then {} else .[-1] end' "$ledger"
}

command_resource_scan() {
  local ledger="" resource_ids="" state_filter=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --resource-id) resource_ids="$2"; shift 2 ;;
      --state) state_filter="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"

  if [ ! -f "$ledger" ]; then
    echo '[]'
    return 0
  fi

  if [ -n "$resource_ids" ]; then
    local output='[' sep=''
    local resource
    local resource_csv
    resource_csv="$(sort_csv_ids "$resource_ids")"
    for resource in $(printf '%s' "$resource_csv" | tr ',' ' '); do
      [ -z "$resource" ] && continue
      local resource_state
      resource_state="$(audit_resource_contention "$ledger" "$resource")"
      if [ -n "$state_filter" ] && [ "$resource_state" != "$state_filter" ]; then
        continue
      fi
      output="$output${sep}{\"resource_id\":\"$resource\",\"state\":\"$resource_state\",\"query\":\"resource\"}"
      sep=','
    done
    echo "$output]"
    return 0
  fi

  if [ -n "$state_filter" ]; then
    jq -s --arg state "$state_filter" '
      [ .[] | select(.kind=="resource") ]
      | reduce .[] as $r ({};
          .[$r.resource_id] = $r.state)
      | to_entries
      | map(select(.value==$state))
      | map({resource_id:.key,state:.value})' "$ledger"
    return 0
  fi

  jq -s '
    [ .[] | select(.kind=="resource") ]
    | reduce .[] as $r ({}; .[$r.resource_id] = ($r.state // "active"))
    | to_entries
    | map({resource_id:.key,state:.value})' "$ledger"
}

command_write_atomic() {
  local path="" payload='{}'

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --path) path="$2"; shift 2 ;;
      --payload) payload="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$path" ] || error "--path required"
  atomic_write_temp "$path" "$payload"
  echo "{\"status\":\"written\",\"path\":\"$path\",\"bytes\":${#payload}}"
}

command_write_result() {
  local ledger_path="" payload='{}' payload_file="" require_json=1

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --path) ledger_path="$2"; shift 2 ;;
      --payload) payload="$2"; shift 2 ;;
      --payload-file) payload_file="$2"; shift 2 ;;
      --require-json) require_json=1; shift ;;
      --no-require-json) require_json=0; shift ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger_path" ] || error "--path required"
  if [ -n "$payload_file" ]; then
    payload="$(cat "$payload_file")"
  fi

  if [ "$require_json" -eq 1 ] && ! jq -e . <<<"$payload" >/dev/null 2>&1; then
    error "payload must be JSON"
  fi

  atomic_write_temp "$ledger_path" "$payload"
  echo "{\"status\":\"result_written\",\"path\":\"$ledger_path\"}"
}

command_init() {
  local ledger=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  mkdir -p "$(dirname "$ledger")"
  mkdir -p "${ledger}.locks"

  if [ -f "$ledger" ]; then
    echo "{\"status\":\"exists\",\"path\":\"$ledger\"}"
    return 0
  fi

  : > "$ledger"
  echo "{\"status\":\"initialized\",\"path\":\"$ledger\"}"
}

# Correcting JSONL readers in slurp mode for robust scan against jsonl ledger append.
latest_stage_record() {
  local ledger="$1" run_id="$2" stage="$3"
  if [ ! -f "$ledger" ]; then
    echo ""
    return
  fi
  jq -s --arg rid "$run_id" --arg stg "$stage" '
    [ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) ]
    | if length==0 then empty else .[-1] end' "$ledger"
}

has_applied_journal_key() {
  local ledger="$1" run_id="$2" stage="$3" generation="$4" idempotency_key="$5"
  if [ ! -f "$ledger" ] || [ -z "$idempotency_key" ]; then
    echo "false"
    return
  fi

  local exists
  exists="$(jq -s --arg rid "$run_id" --arg stg "$stage" --arg gid "$generation" --arg key "$idempotency_key" '
    [ .[]
      | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.generation|tostring)==$gid and .idempotency_key==$key and .status=="applied") ]
    | if length>0 then true else false end' "$ledger" 2>/dev/null || echo false)"
  echo "${exists:-false}"
}

audit_resource_contention() {
  local ledger="$1" resource_id="$2"
  if [ ! -f "$ledger" ]; then
    echo "active"
    return
  fi

  local state
  state="$(jq -r -s --arg rid "$resource_id" '
    [ .[] | select(.kind=="resource" and .resource_id==$rid) ]
    | if length==0 then "active" else .[-1].state end' "$ledger" 2>/dev/null || echo active)"

  if [ -z "$state" ] || [ "$state" = "null" ]; then
    echo "active"
  else
    echo "$state"
  fi
}

durable_sync() {
  local target="$1"
  if [ -z "$target" ]; then
    return 0
  fi

  if command -v fsync >/dev/null 2>&1; then
    fsync "$target" || true
    return
  fi

  if [ -e "$target" ]; then
    sync -f "$target" 2>/dev/null || true
  else
    sync -f "$(dirname "$target")" 2>/dev/null || true
  fi
}

atomic_write_temp() {
  local target="$1"
  local data="$2"

  if [ -z "$target" ]; then
    error "atomic_write_temp path required"
  fi

  local tmp="${target}.tmp.$$"
  mkdir -p "$(dirname "$target")"
  printf '%s' "$data" > "$tmp"
  durable_sync "$tmp"
  mv "$tmp" "$target"
  durable_sync "$target"
  durable_sync "$(dirname "$target")"
}

atomic_append_ledger() {
  local ledger="$1"
  local line="$2"
  local fd="$3"

  local tmp="${ledger}.tmp.$$"
  if [ -f "$ledger" ]; then
    cp "$ledger" "$tmp"
  else
    : > "$tmp"
  fi

  local max_bytes max_rot
  max_bytes="${RUN_LEDGER_MAX_BYTES:-$DEFAULT_MAX_BYTES}"
  max_rot="${RUN_LEDGER_MAX_ROTATIONS:-$DEFAULT_MAX_ROTATIONS}"

  if [ -s "$tmp" ]; then
    local bytes
    bytes=$(wc -c < "$tmp")
    if [ "$bytes" -ge "$max_bytes" ] && [ "$max_bytes" -gt 0 ]; then
      local idx
      idx=$max_rot
      while [ "$idx" -ge 2 ]; do
        local prev=$((idx - 1))
        if [ -f "${ledger}.${prev}" ]; then
          mv "${ledger}.${prev}" "${ledger}.${idx}"
        fi
        idx=$((idx - 1))
      done
      if [ -f "$ledger" ]; then
        mv "$ledger" "${ledger}.1"
      fi
      : > "$tmp"
    fi
  fi

  printf '%s\n' "$line" >> "$tmp"
  durable_sync "$tmp"
  mv "$tmp" "$ledger"
  durable_sync "$ledger"
  durable_sync "$(dirname "$ledger")"
  flock -u "$fd"
  eval "exec ${fd}>&-"
}

command="${1:-}"
shift || true

if [ -z "$command" ] || [ "$command" = "" ]; then
  usage
fi

case "$command" in
  init)
    command_init "$@" ;;

  stage-acquire)
    command_stage_acquire "$@" ;;

  stage-heartbeat)
    command_stage_heartbeat "$@" ;;

  stage-transition)
    command_stage_transition "$@" ;;

  stage-apply)
    command_stage_apply "$@" ;;

  stage-probe)
    command_stage_probe "$@" ;;

  stage-reconcile)
    command_stage_reconcile "$@" ;;

  journal-add)
    command_journal_add "$@" ;;

  resource-lock)
    command_resource_lock "$@" ;;

  resource-scan)
    command_resource_scan "$@" ;;

  gc-check)
    command_gc_check "$@" ;;

  query-latest)
    command_query_latest "$@" ;;

  write-result)
    command_write_result "$@" ;;

  write-atomic)
    command_write_atomic "$@" ;;

  --help|-h|help)
    usage
    ;;

  *)
    usage
    ;;
esac
