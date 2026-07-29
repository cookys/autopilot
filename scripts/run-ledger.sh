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
#   resume
#   gc-check
#   query-latest
#   resource-lock
#   resource-scan
#   write-result
#   write-atomic
#   directive-send
#   directive-poll
#   directive-list
#   directive-ack
#
# Notes:
#   - The default lock order is global and explicit: resource locks (sorted by resource id)
#     first, then run lock.
#   - stage mutations are append-only and never overwrite existing rows.
#   - stale live checks use PID + process start_time dual verification.
#   - stage-acquire --exclusive-live rejects a second verified-live lease instead of
#     preserving the legacy additive reacquire behavior.
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

ledger_lock_path() {
  local ledger="$1"
  echo "${ledger}.locks/ledger.lock"
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
  fd="$(printf '%s' "$fd" | tr -d '[:space:]')"
  if [ -z "$fd" ]; then
    return 0
  fi
  flock -u "$fd" 2>/dev/null || true
  eval "exec ${fd}>&-" 2>/dev/null || true
}

with_ledger_lock() {
  local ledger="$1" timeout="$2" out_var="${3:-}"
  local lock_file lock_fd
  lock_file="$(ledger_lock_path "$ledger")"
  acquire_lock "$lock_file" "$timeout" lock_fd || return 1
  if [ -n "$out_var" ]; then
    printf -v "$out_var" '%s' "$lock_fd"
    return 0
  fi
  echo "$lock_fd"
}

with_ledger_read_lock() {
  local ledger="$1" timeout="$2" out_var="${3:-}"
  local lock_file lock_fd
  lock_file="$(ledger_lock_path "$ledger")"
  mkdir -p "$(dirname "$lock_file")"
  exec {lock_fd}>"$lock_file"
  if ! flock -s -w "$timeout" "$lock_fd"; then
    exec {lock_fd}>&-
    return 1
  fi
  if [ -n "$out_var" ]; then
    printf -v "$out_var" '%s' "$lock_fd"
    return 0
  fi
  echo "$lock_fd"
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
  if [ -r "/proc/$pid/stat" ]; then
    local stat_line stat_tail start_ticks btime clock_ticks
    local -a stat_fields=()
    IFS= read -r stat_line < "/proc/$pid/stat" || stat_line=""
    # Field 2 is parenthesized and may contain spaces or ')'. Strip through
    # its final delimiter, then field 22 is the 20th field in the remainder.
    stat_tail="${stat_line##*) }"
    read -r -a stat_fields <<< "$stat_tail"
    start_ticks="${stat_fields[19]:-}"
    btime="$(awk '/^btime /{print $2}' /proc/stat 2>/dev/null || echo 0)"
    clock_ticks="$(getconf CLK_TCK 2>/dev/null || echo 0)"
    if [[ "$start_ticks" =~ ^[0-9]+$ ]] \
      && [ "$clock_ticks" -gt 0 ] && [ "$btime" -gt 0 ]; then
      echo $((btime + start_ticks / clock_ticks))
      return
    fi
  fi
  local ps_start parsed
  if ! ps_start="$(ps -o lstart= -p "$pid" 2>/dev/null \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"; then
    ps_start=""
  fi
  if [ -n "$ps_start" ]; then
    if ! parsed="$(date -d "$ps_start" +%s 2>/dev/null)"; then
      parsed=""
    fi
    if [ -z "$parsed" ]; then
      if ! parsed="$(date -j -f '%a %b %e %T %Y' "$ps_start" +%s 2>/dev/null)"; then
        parsed=""
      fi
    fi
    if [ -n "$parsed" ]; then
      echo "$parsed"
      return
    fi
  fi
  echo "0"
}

is_process_alive() {
  local pid="$1" expected_start="$2"
  if [ -z "$pid" ] || [ "$pid" -le 0 ]; then
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if [ -n "$expected_start" ] && [ "$expected_start" -gt 0 ]; then
    local current_start
    current_start="$(get_process_start_time "$pid")"
    if [ "$current_start" -gt 0 ] && [ "$current_start" -ne "$expected_start" ]; then
      return 1
    fi
  fi
  return 0
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

  local lock_fds=()
  local resource
  local IFS=','
  for resource in $sorted; do
    [ -z "$resource" ] && continue
    local path fd
    path="$(resource_lock_path "$ledger" "$resource")"
    if ! acquire_resource_lock "$path" "$timeout" '{"resource_state":"waiting"}' fd; then
      local release_fd
      for release_fd in "${lock_fds[@]}"; do
        release_lock "$release_fd"
      done
      return 1
    fi
    lock_fds+=("$fd")
  done
  if [ -n "$out_var" ]; then
    local out_list
    out_list="${lock_fds[*]}"
    printf -v "$out_var" '%s' "$out_list"
    return 0
  fi
  echo "${lock_fds[*]}"
}

append_record() {
  local ledger="$1"
  local run_id="$2"
  local row_json="$3"
  local timeout="$4"
  local run_lock_fd="${5:-}"

  if [ -n "$run_lock_fd" ]; then
    local ledger_lock_fd
    with_ledger_lock "$ledger" "$timeout" ledger_lock_fd || {
      error "failed to acquire ledger lock"
    }
    atomic_append_ledger "$ledger" "$row_json" "$run_lock_fd" "$ledger_lock_fd"
    return 0
  fi

  local run_fd
  if ! with_run_lock "$ledger" "$run_id" "$timeout" run_fd; then
    error "failed to acquire run lock"
  fi
  local ledger_lock_fd
  if ! with_ledger_lock "$ledger" "$timeout" ledger_lock_fd; then
    flock -u "$run_fd"
    eval "exec ${run_fd}>&-"
    error "failed to acquire ledger lock"
  fi
  atomic_append_ledger "$ledger" "$row_json" "$run_fd" "$ledger_lock_fd"
}

write_side_effect_row() {
  local ledger="$1" run_id="$2" stage="$3" generation="$4" nonce="$5" op="$6" idempotency_key="$7" status="$8" payload="$9" timeout="${10}" run_lock_fd="${11:-}" caller_resource_fds="${12:-}"
  local latest_resources resource_fds="" local_run_fd own_resource_locks=0

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

  local latest
  if [ -n "$caller_resource_fds" ]; then
    resource_fds="$caller_resource_fds"
  else
    latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
    latest_resources="$(jq -r '.resources // ""' <<<"$latest")"
    if [ -n "$latest_resources" ]; then
      with_resource_locks "$ledger" "$latest_resources" "$timeout" resource_fds || error "resource lock unavailable"
      own_resource_locks=1
    fi
  fi

  if [ -n "$run_lock_fd" ]; then
    append_record "$ledger" "$run_id" "$line" "$timeout" "$run_lock_fd"
    if [ "$own_resource_locks" -eq 1 ] && [ -n "$resource_fds" ]; then
      local release_fd
      for release_fd in $resource_fds; do
        release_lock "$release_fd"
      done
    fi
    return 0
  fi

  if ! with_run_lock "$ledger" "$run_id" "$timeout" local_run_fd; then
    if [ "$own_resource_locks" -eq 1 ] && [ -n "$resource_fds" ]; then
      local release_fd
      for release_fd in $resource_fds; do
        release_lock "$release_fd"
      done
    fi
    error "run lock unavailable"
  fi

  append_record "$ledger" "$run_id" "$line" "$timeout" "$local_run_fd"
  if [ "$own_resource_locks" -eq 1 ] && [ -n "$resource_fds" ]; then
    for fd in $resource_fds; do release_lock "$fd"; done
  fi
}

command_stage_acquire() {
  local ledger="" run_id="" stage="" pid="" start_time="" heartbeat_ts="" git_ref="" git_sha="" worktree="" resources="" allow_reopen="0" exclusive_live="0" timeout="$DEFAULT_LOCK_TIMEOUT" stale_secs="$DEFAULT_STALE_SECS"

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
      --exclusive-live) exclusive_live=1; shift ;;
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
        now="$(now_ts)"
        if [ "$((now - last_hb))" -lt "$stale_secs" ]; then
          latest_alive=0
        fi
      fi
    fi

    if [ "$latest_state" = "leased" ] && [ "$latest_alive" -eq 0 ]; then
      if [ "$exclusive_live" -eq 1 ]; then
        flock -u "$run_fd"
        eval "exec ${run_fd}>&-"
        [ -n "$resource_fds" ] && for fd in $resource_fds; do release_lock "$fd"; done
        error "run=$run_id stage=$stage already has a live lease"
      fi
    elif is_terminal_gc_state "$latest_state" && [ "$allow_reopen" -eq 0 ]; then
      flock -u "$run_fd"
      eval "exec ${run_fd}>&-"
      [ -n "$resource_fds" ] && for fd in $resource_fds; do release_lock "$fd"; done
      error "run=$run_id stage=$stage already in terminal state=$latest_state; pass --allow-reopen"
    fi
  fi

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

command_stage_transfer() {
  local ledger="" run_id="" stage="" generation="" nonce="" pid="" git_ref="" worktree=""
  local timeout="$DEFAULT_LOCK_TIMEOUT"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --generation) generation="$2"; shift 2 ;;
      --nonce) nonce="$2"; shift 2 ;;
      --pid) pid="$2"; shift 2 ;;
      --git-ref) git_ref="$2"; shift 2 ;;
      --worktree) worktree="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id is required"
  [ -n "$stage" ] || error "--stage is required"
  [ -n "$generation" ] || error "--generation is required"
  [ -n "$nonce" ] || error "--nonce is required"
  [ -n "$pid" ] || pid=$$
  [[ "$generation" =~ ^[1-9][0-9]*$ ]] || error "--generation must be a positive integer"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || error "--pid must be a positive integer"

  local run_fd latest latest_state latest_generation latest_nonce
  with_run_lock "$ledger" "$run_id" "$timeout" run_fd || error "run-lock unavailable"
  latest="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  latest_state="$(jq -r '.state // empty' <<<"$latest")"
  latest_generation="$(jq -r '.generation // 0' <<<"$latest")"
  latest_nonce="$(jq -r '.nonce // empty' <<<"$latest")"
  if [ "$latest_state" != "leased" ] \
      || [ "$latest_generation" != "$generation" ] \
      || [ "$latest_nonce" != "$nonce" ]; then
    release_lock "$run_fd"
    error "stage ownership transfer compare-and-swap failed"
  fi

  local next_generation new_nonce start_time heartbeat_ts line
  next_generation=$((generation + 1))
  new_nonce="$(rand_hex)"
  start_time="$(get_process_start_time "$pid")"
  [ -n "$start_time" ] || start_time="$(now_ts)"
  heartbeat_ts="$(now_ts)"
  line="$(jq -nc \
    --arg kind "stage" --arg ts "$(iso_ts)" --arg rid "$run_id" --arg stg "$stage" \
    --arg state "leased" --arg nonce_v "$new_nonce" --argjson gen "$next_generation" \
    --arg pid_v "$pid" --arg start_v "$start_time" --arg hb "$heartbeat_ts" \
    --arg git_ref_v "$git_ref" --arg wt "$worktree" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,generation:$gen,nonce:$nonce_v,pid:($pid_v|tonumber),start_time:($start_v|tonumber),heartbeat_ts:($hb|tonumber),git_ref:$git_ref_v,git_sha:"",worktree:$wt,resources:"",reason:"ownership_transfer"}')"
  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
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

  local existing
  existing="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$existing" ]; then
    error "stage row missing; record journal after stage is acquired first"
  fi
  local resources run_fds="" run_fd
  resources="$(jq -r '.resources // ""' <<<"$existing")"
  if [ -n "$resources" ]; then
    with_resource_locks "$ledger" "$resources" "$timeout" run_fds || error "resource lock unavailable"
  fi
  if ! with_run_lock "$ledger" "$run_id" "$timeout" run_fd; then
    if [ -n "$run_fds" ]; then
      for fd in $run_fds; do release_lock "$fd"; done
    fi
    error "run lock unavailable"
  fi

  if [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    if [ -n "$run_fds" ]; then
      for fd in $run_fds; do release_lock "$fd"; done
    fi
    echo '{"status":"already_applied"}'
    return 0
  fi

  write_side_effect_row "$ledger" "$run_id" "$stage" "$generation" "$nonce" "$op" "$idempotency_key" "$status" "$payload" "$timeout" "$run_fd" "$run_fds"
  if [ -n "$run_fds" ]; then
    for fd in $run_fds; do release_lock "$fd"; done
  fi
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
  local pid start_time heartbeat_ts
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

  local stage_rows max_gen caller_rows current_row stale_from
  stage_rows="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" '
    [ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) ]')"
  if [ -z "$stage_rows" ] || [ "$stage_rows" = "null" ] || [ "$stage_rows" = "[]" ]; then
    flock -u "$run_fd"
    eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "stage moved while locking run=$run_id stage=$stage"
  fi

  max_gen="$(jq -r 'if length==0 then 0 else (map((.generation // 0 | tostring) | tonumber) | max) end' <<<"$stage_rows")"
  current_row="$(jq -r --arg generation "$generation" '
    [ .[] | select((.generation // 0 | tostring) == $generation) ]
    | if length==0 then empty else .[-1] end' <<<"$stage_rows")"

  if [ "$max_gen" -gt "$generation" ]; then
    stale_from=""
    if [ -n "$current_row" ]; then
      stale_from="$(jq -r '.state // ""' <<<"$current_row")"
    fi
    local stale_line
    stale_line="$(jq -nc \
      --arg kind "stage" \
      --arg ts "$(iso_ts)" \
      --arg rid "$run_id" \
      --arg stg "$stage" \
      --arg state "stale_ignored" \
      --arg reason "late_writer" \
      --argjson gen "$generation" \
      --arg nonce_v "$nonce" \
      --arg from "$stale_from" \
      --arg to "$to_state" \
      '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,reason:$reason,generation:$gen,nonce:$nonce_v,transition_from:$from,transition_to:$to}')"
    append_record "$ledger" "$run_id" "$stale_line" "$timeout" "$run_fd"
    for fd in $r_fds; do release_lock "$fd"; done
    echo "$stale_line"
    return 11
  fi

  [ -n "$current_row" ] || {
    flock -u "$run_fd"
    eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "stage moved while locking run=$run_id stage=$stage"
  }

  current_state="$(jq -r '.state' <<<"$current_row")"
  current_gen="$(jq -r '.generation // 0' <<<"$current_row")"
  current_nonce="$(jq -r '.nonce // empty' <<<"$current_row")"
  resources="$(jq -r '.resources // ""' <<<"$current_row")"
  pid="$(jq -r '.pid // "0"' <<<"$current_row")"
  start_time="$(jq -r '.start_time // "0"' <<<"$current_row")"
  heartbeat_ts="$(jq -r '.heartbeat_ts // "0"' <<<"$current_row")"

  if [ "$nonce" != "$current_nonce" ]; then
    stale_from="$(jq -r '.state // ""' <<<"$current_row")"
    local stale_line
    stale_line="$(jq -nc \
      --arg kind "stage" \
      --arg ts "$(iso_ts)" \
      --arg rid "$run_id" \
      --arg stg "$stage" \
      --arg state "stale_ignored" \
      --arg reason "late_writer" \
      --argjson gen "$generation" \
      --arg nonce_v "$nonce" \
      --arg from "$stale_from" \
      --arg to "$to_state" \
      '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,reason:$reason,generation:$gen,nonce:$nonce_v,transition_from:$from,transition_to:$to}')"
    append_record "$ledger" "$run_id" "$stale_line" "$timeout" "$run_fd"
    for fd in $r_fds; do release_lock "$fd"; done
    echo "$stale_line"
    return 11
  fi

  if [ "$current_state" = "$to_state" ]; then
    if [ -n "$idempotency_key" ] && [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
      flock -u "$run_fd"; eval "exec ${run_fd}>&-"
      for fd in $r_fds; do release_lock "$fd"; done
      echo '{"status":"already_applied","state":"'$current_state'"}'
      return 0
    fi
    flock -u "$run_fd"; eval "exec ${run_fd}>&-"
    for fd in $r_fds; do release_lock "$fd"; done
    error "invalid transition ${current_state} -> ${to_state}"
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
    --arg pid_v "$pid" \
    --arg start_v "$start_time" \
    --arg heartbeat_v "$heartbeat_ts" \
    --argjson req "$(jq -Rc 'split(",")' <<<"$required_side_effect_keys")" \
    --arg git_ref_v "$git_ref" \
    --arg git_sha_v "$git_sha" \
    --arg wt "$worktree" \
    --arg resources_v "$resources" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,state:$state,reason:$reason,idempotency_key:$id_key,transition_from:$from,generation:$gen,nonce:$nonce_v,pid:($pid_v|tonumber),start_time:($start_v|tonumber),heartbeat_ts:($heartbeat_v|tonumber),required_side_effect_keys:$req,git_ref:$git_ref_v,git_sha:$git_sha_v,worktree:$wt,resources:$resources_v}')"
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

  if [ -n "$idempotency_key" ]; then
    local apply_resources apply_resource_fds="" apply_run_fd
    apply_resources="$(jq -r '.resources // ""' <<<"$existing_line")"
    if [ -n "$apply_resources" ]; then
      with_resource_locks "$ledger" "$apply_resources" "$timeout" apply_resource_fds || error "resource lock unavailable"
    fi

    if ! with_run_lock "$ledger" "$run_id" "$timeout" apply_run_fd; then
      if [ -n "$apply_resource_fds" ]; then
        for fd in $apply_resource_fds; do release_lock "$fd"; done
      fi
      error "run lock unavailable"
    fi

    existing_line="$(latest_stage_record "$ledger" "$run_id" "$stage")"
    current_state="$(jq -r '.state // ""' <<<"$existing_line")"
    if [ "$(has_applied_journal_key "$ledger" "$run_id" "$stage" "$generation" "$idempotency_key")" = "true" ]; then
      flock -u "$apply_run_fd"; eval "exec ${apply_run_fd}>&-"
      if [ -n "$apply_resource_fds" ]; then
        for fd in $apply_resource_fds; do release_lock "$fd"; done
      fi
      if [ "$current_state" = "$to_state" ]; then
        echo '{"status":"already_applied"}'
        return 0
      fi
      command_stage_transition \
        --ledger "$ledger" \
        --run-id "$run_id" \
        --stage "$stage" \
        --generation "$generation" \
        --nonce "$nonce" \
        --to-state "$to_state" \
        --idempotency-key "$idempotency_key" \
        --timeout "$timeout" \
        >/dev/null
      echo '{"status":"applied"}'
      return 0
    fi

    write_side_effect_row "$ledger" "$run_id" "$stage" "$generation" "$nonce" "$side_effect_op" "$idempotency_key" "applied" "$payload" "$timeout" "$apply_run_fd" "$apply_resource_fds"
    if [ -n "$apply_resource_fds" ]; then
      for fd in $apply_resource_fds; do release_lock "$fd"; done
    fi
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
  pending_side_effects="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" '
      [ .[] | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.status|ascii_downcase) != "applied") ]
      | length' 2>/dev/null || echo 0)"
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
    '{status:$status,reason:$reason,run_id:$rid,stage:$stg,state:$state_v,generation:$generation,nonce:$nonce_v,has_result:($has_result == 1),git_truth:($git_truth == 1),pending_side_effects:($pending|tonumber),terminal:($terminal == 1),blocked_state:($blocked == 1),holder_alive:($is_alive == 1),resources:$resources}'
}

command_resume() {
  local ledger="" run_id="" idempotency_key="" timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --idempotency-key) idempotency_key="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id required"
  [ -n "$idempotency_key" ] || error "--idempotency-key required"

  local resume_stage resume_record resume_generation resume_nonce resume_state resume_resources resume_worktree resume_git_ref resume_git_sha
  resume_stage="$(ledger_jq_slurp "$ledger" -r --arg rid "$run_id" '[ .[] | select(.kind=="stage" and .run_id==$rid) ] | if length==0 then empty else .[-1].stage end')"
  [ -n "$resume_stage" ] || error "no stage rows for run_id=$run_id"

  resume_record="$(ledger_jq_slurp "$ledger" -c --arg rid "$run_id" --arg stage "$resume_stage" '[ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stage) ] | if length==0 then empty else .[-1] end')"
  [ -n "$resume_record" ] || error "missing resume stage row"

  resume_generation="$(jq -r '.generation // 0' <<<"$resume_record")"
  resume_nonce="$(jq -r '.nonce // empty' <<<"$resume_record")"
  resume_state="$(jq -r '.state // ""' <<<"$resume_record")"
  resume_resources="$(jq -r '.resources // ""' <<<"$resume_record")"
  resume_worktree="$(jq -r '.worktree // ""' <<<"$resume_record")"
  resume_git_ref="$(jq -r '.git_ref // ""' <<<"$resume_record")"
  resume_git_sha="$(jq -r '.git_sha // ""' <<<"$resume_record")"

  local review_row review_state review_round_owed review_stage
  review_row="$(ledger_jq_slurp "$ledger" -c --arg rid "$run_id" '[ .[] | select(.kind=="stage" and .run_id==$rid and .stage=="review") ] | if length==0 then empty else .[-1] end')"
  review_state=""
  review_stage="review"
  if [ -n "$review_row" ] && [ "$review_row" != "empty" ] && [ "$review_row" != "null" ]; then
    review_state="$(jq -r '.state // ""' <<<"$review_row")"
    review_stage="$(jq -r '.stage // "review"' <<<"$review_row")"
  fi

  review_round_owed=1
  if [ -n "$review_state" ] && is_terminal_gc_state "$review_state"; then
    review_round_owed=0
  fi

  local blocked_csv=""
  if [ -n "$resume_resources" ]; then
    local r resource_state
    local IFS=','
    for r in $resume_resources; do
      [ -z "$r" ] && continue
      resource_state="$(audit_resource_contention "$ledger" "$r")"
      if [ "$resource_state" = "quarantined" ]; then
        if [ -z "$blocked_csv" ]; then
          blocked_csv="$r"
        else
          blocked_csv="$blocked_csv $r"
        fi
      fi
    done
  fi

  if [ -n "$blocked_csv" ]; then
    local blocked_json
    blocked_json="$(jq -R -s -c 'split(" ") | map(select(length>0))' <<<"$blocked_csv")"
    jq -nc \
      --arg rid "$run_id" \
      --arg stage "$resume_stage" \
      --arg resources "$resume_resources" \
      --argjson blocked "$blocked_json" \
      '{status:"blocked_resource",reason:"quarantined_resource",run_id:$rid,stage:$stage,resume_resources:$resources,blocked_resources:$blocked,must_use_new_resource:true,must_report:"use_new_resource_path"}'
    return 3
  fi

  local resume_journal_stage="__resume__"
  local review_json='{}'
  if [ -n "$review_row" ] && [ "$review_row" != "empty" ] && [ "$review_row" != "null" ]; then
    review_json="$review_row"
  fi

  local resume_lock_fds=""
  local resume_has_resources=0
  if [ -n "$resume_resources" ]; then
    resume_has_resources=1
    with_resource_locks "$ledger" "$resume_resources" "$timeout" resume_lock_fds || error "resource lock unavailable"
  fi

  if [ "$(has_applied_journal_key "$ledger" "$run_id" "$resume_journal_stage" "0" "$idempotency_key")" = "true" ]; then
    if [ "$resume_has_resources" -eq 1 ]; then
      for fd in $resume_lock_fds; do release_lock "$fd"; done
    fi
    jq -nc \
      --arg rid "$run_id" \
      --arg stage "$resume_stage" \
      --arg pre_state "$resume_state" \
      --arg pre_gen "$resume_generation" \
      --arg pre_nonce "$resume_nonce" \
      --arg pre_resources "$resume_resources" \
      --argjson review_round_owed "$review_round_owed" \
      --arg review_stage_name "$review_stage" \
      --argjson review "$review_json" \
      '{status:"already_applied",run_id:$rid,run_ledger_stage:$stage,resume_point:{state:$pre_state,generation:($pre_gen|tonumber),nonce:$pre_nonce,resources:$pre_resources},review_round_owed:($review_round_owed|if . then true else false end),review_stage:$review_stage_name,latest_review:$review}'
    return 0
  fi

  local acquire_output new_generation new_nonce
  acquire_output="$(command_stage_acquire --ledger "$ledger" --run-id "$run_id" --stage "$resume_stage" --pid "$$" --git-ref "$resume_git_ref" --git-sha "$resume_git_sha" --worktree "$resume_worktree" --resources "" --allow-reopen --timeout "$timeout")"
  new_generation="$(jq -r '.generation' <<<"$acquire_output")"
  new_nonce="$(jq -r '.nonce // empty' <<<"$acquire_output")"

  local reconcile_json reconcile_status reconcile_reason
  reconcile_json="$(command_stage_reconcile --ledger "$ledger" --run-id "$run_id" --stage "$resume_stage" --git-dir "$resume_worktree" --timeout "$timeout")"
  reconcile_status="$(jq -r '.status // "missing"' <<<"$reconcile_json")"
  reconcile_reason="$(jq -r '.reason // ""' <<<"$reconcile_json")"

  local adoption_status="needs_resume"
  if [ "$reconcile_status" = "resolved" ]; then
    adoption_status="adopted"
  fi

  local adopted=0
  if [ "$adoption_status" = "adopted" ]; then
    adopted=1
  fi

  local resume_payload review_owed_bool="false"
  if [ "$review_round_owed" -eq 1 ]; then
    review_owed_bool="true"
  fi
  resume_payload="$(jq -nc \
    --arg rid "$run_id" \
    --arg stage "$resume_stage" \
    --arg pre_state "$resume_state" \
    --arg pre_gen "$resume_generation" \
    --arg pre_nonce "$resume_nonce" \
    --arg pre_resources "$resume_resources" \
    --arg new_gen "$new_generation" \
    --arg new_nonce "$new_nonce" \
    --arg adopt "$adoption_status" \
    --arg reason "$reconcile_reason" \
    --arg id_key "$idempotency_key" \
    --arg review_owed "$review_owed_bool" \
    '{run_id:$rid,stage:$stage,resume_from:{state:$pre_state,generation:($pre_gen|tonumber),nonce:$pre_nonce,resources:$pre_resources},acquired:{generation:($new_gen|tonumber),nonce:$new_nonce},adoption:{status:$adopt,reason:$reason},review_round_owed:($review_owed=="true"),idempotency_key:$id_key}')"

  write_side_effect_row "$ledger" "$run_id" "$resume_journal_stage" "0" "$new_nonce" "resume" "$idempotency_key" "applied" "$resume_payload" "$timeout"

  local review_out='{}'
  if [ -n "$review_row" ] && [ "$review_row" != "empty" ] && [ "$review_row" != "null" ]; then
    review_out="$review_row"
  fi

  if [ "$resume_has_resources" -eq 1 ]; then
    for fd in $resume_lock_fds; do release_lock "$fd"; done
  fi

  jq -nc \
    --arg rid "$run_id" \
    --arg stage "$resume_stage" \
    --arg pre_state "$resume_state" \
    --arg pre_gen "$resume_generation" \
    --arg pre_nonce "$resume_nonce" \
    --arg pre_resources "$resume_resources" \
    --arg new_gen "$new_generation" \
    --arg new_nonce "$new_nonce" \
    --arg reconciliation "$reconcile_status" \
    --arg reconciliation_reason "$reconcile_reason" \
    --arg adopt_status "$adoption_status" \
    --arg review_stage_name "$review_stage" \
    --argjson review_round_owed "$review_round_owed" \
    --argjson adopted "$adopted" \
    --argjson reconcile "$reconcile_json" \
    --argjson review "$review_out" \
    '{status:"resumed",run_id:$rid,run_ledger_stage:$stage,resume_point:{state:$pre_state,generation:($pre_gen|tonumber),nonce:$pre_nonce,resources:$pre_resources},new_generation:($new_gen|tonumber),new_nonce:$new_nonce,review_round_owed:($review_round_owed|if . then true else false end),adoption:{status:$adopt_status,reason:$reconciliation_reason,reconciled:($adopted|if . then true else false end),reconcile:$reconcile},review_stage:$review_stage_name,latest_review:$review}'
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
  pending_side_effects="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" '
      [ .[] | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.status|ascii_downcase) != "applied") ]
      | length' 2>/dev/null || echo 0)"
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
    ledger_jq_slurp "$ledger" --arg rid "$resource_id" '
      [ .[] | select(.kind=="resource" and .resource_id==$rid) ]
      | if length==0 then {} else .[-1] end'
    return 0
  fi

  if [ -z "$run_id" ]; then
    echo "{\"status\":\"missing_filter\",\"error\":\"run_id required when not querying by resource\"}"
    return 0
  fi

  ledger_jq_slurp "$ledger" --arg rid "$run_id" '
    [ .[] | select(.kind=="stage" and .run_id==$rid) ]
    | if length==0 then {} else .[-1] end'
}

# ledger_scan_files — the ONE rotation-aware active view: rotated segments oldest-first,
# then the live ledger. All campaign/state/lease/journal/status/resume/directive readers
# MUST use this set so last-write semantics survive RUN_LEDGER_MAX_BYTES rotation and a
# later heartbeat cannot be observed without its active state and lease.
# Appends always go to the live ledger only (under the ledger lock with rotation).
ledger_scan_files() {
  local ledger="$1" idx max_rot
  max_rot="${RUN_LEDGER_MAX_ROTATIONS:-$DEFAULT_MAX_ROTATIONS}"
  idx="$max_rot"
  while [ "$idx" -ge 1 ]; do
    if [ -f "${ledger}.${idx}" ]; then
      printf '%s\n' "${ledger}.${idx}"
    fi
    idx=$((idx - 1))
  done
  if [ -f "$ledger" ]; then
    printf '%s\n' "$ledger"
  fi
  return 0
}

# directive_scan_files — alias; directives share the universal rotation-aware view.
directive_scan_files() {
  ledger_scan_files "$@"
}

# ledger_jq_slurp_unlocked <ledger> [jq-args and filter...]
# Caller must hold the ledger lock. Used by rotation while it owns the exclusive
# lock so it cannot recursively acquire a shared lock.
ledger_jq_slurp_unlocked() {
  local ledger="$1"
  shift
  local scan_files=()
  mapfile -t scan_files < <(ledger_scan_files "$ledger")
  if [ "${#scan_files[@]}" -eq 0 ]; then
    jq -s "$@" </dev/null
  else
    jq -s "$@" "${scan_files[@]}"
  fi
}

# ledger_jq_slurp <ledger> [jq-args and filter...]
# Take one coherent oldest-to-live snapshot while holding a shared ledger lock.
# This prevents a reader from observing half of the rename rotation sequence.
ledger_jq_slurp() {
  local ledger="$1"
  shift
  local ledger_read_fd output rc
  with_ledger_read_lock "$ledger" "$DEFAULT_LOCK_TIMEOUT" ledger_read_fd \
    || error "ledger read lock unavailable"
  output="$(ledger_jq_slurp_unlocked "$ledger" "$@")"
  rc=$?
  release_lock "$ledger_read_fd"
  printf '%s\n' "$output"
  return "$rc"
}

command_directive_send() {
  local ledger="" run_id="" stage="" text="" from="" directive_id="" timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --stage) stage="$2"; shift 2 ;;
      --text) text="$2"; shift 2 ;;
      --from) from="$2"; shift 2 ;;
      --directive-id) directive_id="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id is required"
  [ -n "$stage" ] || error "--stage is required"
  [ -n "$text" ] || error "--text is required"
  [ -n "$from" ] || from=""

  local run_fd
  if ! with_run_lock "$ledger" "$run_id" "$timeout" run_fd; then
    error "run lock unavailable"
  fi

  local lease_row lease_state generation nonce
  lease_row="$(latest_stage_record "$ledger" "$run_id" "$stage")"
  if [ -z "$lease_row" ]; then
    release_lock "$run_fd"
    error "no live lease for stage=$stage; cannot send directive"
  fi

  lease_state="$(jq -r '.state // ""' <<<"$lease_row")"
  if [ "$lease_state" != "leased" ]; then
    release_lock "$run_fd"
    error "no live lease for stage=$stage; cannot send directive"
  fi

  generation="$(jq -r '.generation // 0' <<<"$lease_row")"
  nonce="$(jq -r '.nonce // ""' <<<"$lease_row")"
  if [ -z "$directive_id" ]; then
    directive_id="dir-$(rand_hex)"
  fi

  local line
  line="$(jq -nc \
    --arg kind "directive" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --argjson gen "$generation" \
    --arg nonce_v "$nonce" \
    --arg did "$directive_id" \
    --arg txt "$text" \
    --arg from_v "$from" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,generation:$gen,nonce:$nonce_v,directive_id:$did,text:$txt,from:$from_v}')"

  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
  echo "$line"
}

command_directive_poll() {
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
  [ -n "$run_id" ] || error "--run-id is required"
  [ -n "$stage" ] || stage=""

  ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" '
    (map(select(.kind=="directive_delivered" or .kind=="directive_expired") | .directive_id) | unique) as $acked
    | [ .[] | select(.kind=="directive" and .run_id==$rid and ($stg=="" or .stage==$stg) and (.directive_id as $d | ($acked | index($d)) | not)) ]'
}

command_directive_ack() {
  local ledger="" run_id="" directive_id="" reason="" by="" timeout="$DEFAULT_LOCK_TIMEOUT"

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --run-id) run_id="$2"; shift 2 ;;
      --directive-id) directive_id="$2"; shift 2 ;;
      --reason) reason="$2"; shift 2 ;;
      --by) by="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done

  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  [ -n "$run_id" ] || error "--run-id is required"
  [ -n "$directive_id" ] || error "--directive-id required"
  if [ -n "$reason" ] && [ "$reason" != "run_ended" ] && [ "$reason" != "stale_generation" ]; then
    error "invalid reason; expected run_ended or stale_generation"
  fi
  [ -n "$by" ] || by=""

  local run_fd
  if ! with_run_lock "$ledger" "$run_id" "$timeout" run_fd; then
    error "run lock unavailable"
  fi

  local directive_row
  directive_row="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg did "$directive_id" '
    [ .[] | select(.kind=="directive" and .run_id==$rid and .directive_id==$did) ]
    | if length==0 then empty else .[-1] end')"
  if [ -z "$directive_row" ] || [ "$directive_row" = "empty" ]; then
    release_lock "$run_fd"
    error "no directive directive_id=$directive_id"
  fi

  local has_acked
  has_acked="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg did "$directive_id" '
    [ .[] | select((.kind=="directive_delivered" or .kind=="directive_expired") and .run_id==$rid and .directive_id==$did) ]
    | if length==0 then false else true end' 2>/dev/null || echo false)"
  if [ "$has_acked" = "true" ]; then
    release_lock "$run_fd"
    echo '{"status":"already_acked"}'
    return 0
  fi

  local stage generation nonce outcome terminal_reason
  stage="$(jq -r '.stage // ""' <<<"$directive_row")"
  generation="$(jq -r '.generation // 0' <<<"$directive_row")"
  nonce="$(jq -r '.nonce // ""' <<<"$directive_row")"

  if [ "$reason" = "run_ended" ]; then
    outcome="expired"
    terminal_reason="run_ended"
  else
    # Delivery-time fencing: the CURRENT lease must match the directive's bound
    # generation AND nonce (both captured at send time). A nonce mismatch at the same
    # generation is a fenced/replaced writer — treated identically to a generation
    # advance and recorded as expired(stale_generation).
    local leased_row
    leased_row="$(latest_stage_record "$ledger" "$run_id" "$stage")"
    if [ -n "$leased_row" ] && [ "$(jq -r '.state // ""' <<<"$leased_row")" = "leased" ] && [ "$(jq -r '.generation // 0' <<<"$leased_row")" -eq "$generation" ] && [ "$(jq -r '.nonce // ""' <<<"$leased_row")" = "$nonce" ]; then
      outcome="delivered"
    else
      outcome="expired"
      terminal_reason="stale_generation"
    fi
  fi

  local line
  if [ "$outcome" = "delivered" ]; then
    line="$(jq -nc \
      --arg kind "directive_delivered" \
      --arg ts "$(iso_ts)" \
      --arg rid "$run_id" \
      --arg stg "$stage" \
      --argjson gen "$generation" \
      --arg nonce_v "$nonce" \
      --arg did "$directive_id" \
      --arg by_v "$by" \
      '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,generation:$gen,nonce:$nonce_v,directive_id:$did,by:$by_v}')"
    append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
    echo '{"status":"delivered"}'
    return 0
  fi

  line="$(jq -nc \
    --arg kind "directive_expired" \
    --arg ts "$(iso_ts)" \
    --arg rid "$run_id" \
    --arg stg "$stage" \
    --argjson gen "$generation" \
    --arg nonce_v "$nonce" \
    --arg did "$directive_id" \
    --arg reason_v "$terminal_reason" \
    --arg by_v "$by" \
    '{kind:$kind,ts:$ts,run_id:$rid,stage:$stg,generation:$gen,nonce:$nonce_v,directive_id:$did,reason:$reason_v,by:$by_v}')"
  append_record "$ledger" "$run_id" "$line" "$timeout" "$run_fd"
  echo '{"status":"expired","reason":"'"$terminal_reason"'"}'
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
    ledger_jq_slurp "$ledger" --arg state "$state_filter" '
      [ .[] | select(.kind=="resource") ]
      | reduce .[] as $r ({};
          .[$r.resource_id] = $r.state)
      | to_entries
      | map(select(.value==$state))
      | map({resource_id:.key,state:.value})'
    return 0
  fi

  ledger_jq_slurp "$ledger" '
    [ .[] | select(.kind=="resource") ]
    | reduce .[] as $r ({}; .[$r.resource_id] = ($r.state // "active"))
    | to_entries
    | map({resource_id:.key,state:.value})'
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

  local ledger_lock_fd
  with_ledger_lock "$ledger" "$DEFAULT_LOCK_TIMEOUT" ledger_lock_fd || error "ledger lock unavailable"

  if [ -f "$ledger" ]; then
    flock -u "$ledger_lock_fd"
    eval "exec ${ledger_lock_fd}>&-"
    echo "{\"status\":\"exists\",\"path\":\"$ledger\"}"
    return 0
  fi

  : > "$ledger"
  flock -u "$ledger_lock_fd"
  eval "exec ${ledger_lock_fd}>&-"
  echo "{\"status\":\"initialized\",\"path\":\"$ledger\"}"
}

command_snapshot() {
  local ledger="" timeout="$DEFAULT_LOCK_TIMEOUT"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --ledger) ledger="$2"; shift 2 ;;
      --timeout) timeout="$2"; shift 2 ;;
      *) usage ;;
    esac
  done
  [ -n "$ledger" ] || ledger="$(canonical_ledger_path "$ledger")"
  local ledger_read_fd scan_files=() file
  with_ledger_read_lock "$ledger" "$timeout" ledger_read_fd \
    || error "ledger read lock unavailable"
  mapfile -t scan_files < <(ledger_scan_files "$ledger")
  for file in "${scan_files[@]}"; do
    cat -- "$file" || {
      release_lock "$ledger_read_fd"
      error "ledger snapshot read failed: $file"
    }
    printf '\n'
  done
  release_lock "$ledger_read_fd"
}

# Correcting JSONL readers in slurp mode for robust scan against jsonl ledger append.
# All readers use ledger_jq_slurp (oldest-to-live) so rotation cannot hide leases/state.
latest_stage_record() {
  local ledger="$1" run_id="$2" stage="$3"
  ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" '
    [ .[] | select(.kind=="stage" and .run_id==$rid and .stage==$stg) ]
    | if length==0 then empty else .[-1] end'
}

has_applied_journal_key() {
  local ledger="$1" run_id="$2" stage="$3" generation="$4" idempotency_key="$5"
  if [ -z "$idempotency_key" ]; then
    echo "false"
    return
  fi
  local exists
  exists="$(ledger_jq_slurp "$ledger" --arg rid "$run_id" --arg stg "$stage" --arg gid "$generation" --arg key "$idempotency_key" '
    [ .[]
      | select(.kind=="journal" and .run_id==$rid and .stage==$stg and (.generation|tostring)==$gid and .idempotency_key==$key and .status=="applied") ]
    | if length>0 then true else false end' 2>/dev/null || echo false)"
  echo "${exists:-false}"
}

audit_resource_contention() {
  local ledger="$1" resource_id="$2"
  local state
  state="$(ledger_jq_slurp "$ledger" -r --arg rid "$resource_id" '
    [ .[] | select(.kind=="resource" and .resource_id==$rid) ]
    | if length==0 then "active" else .[-1].state end' 2>/dev/null || echo active)"

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
  local ledger_lock_fd="${4:-}"

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
      # Carry forward every still-leased stage row (and its run's journals) so
      # rotation cannot expose a heartbeat without its active state/lease, and
      # active campaigns survive segment GC under RUN_LEDGER_MAX_ROTATIONS.
      # Readers still use the oldest-to-live view; this is belt-and-braces for
      # the live segment under the same ledger lock as the append.
      if [ -f "${ledger}.1" ]; then
        local carry
        # Compact carry: latest leased stage row per (run_id, stage). Keeps the
        # new live segment from exposing a post-rotation heartbeat without its
        # lease, without re-materializing the entire active history (journals
        # and older stage rows remain readable via oldest-to-live scan).
        # Compact carry into the new live segment under the same lock:
        #  1) latest leased stage row per (run_id, stage)
        #  2) all journal rows for those active run_ids (intake/events/idempotency)
        # so rotation cannot hide active state/lease, and campaign projection still
        # finds its intake after older segments are GC'd. -c keeps JSONL compact.
        carry="$(ledger_jq_slurp_unlocked "$ledger" -c '
          ([ .[] | select(.kind=="stage") ]
            | group_by((.run_id // "") + "\u0000" + (.stage // ""))
            | map(.[-1] | select(.state=="leased"))
          ) as $leases
          | ($leases | map(.run_id) | unique) as $active
          | ([ .[]
              | select(.kind=="journal" and ((.run_id as $r | $active | index($r)) != null))
              | . as $row
              | (($row | del(._rotation_carry, ._rotation_root) | tojson | @base64)) as $root
              | ($row + {_rotation_carry:true, _rotation_root:($row._rotation_root // $root)})
            ]
            | group_by(._rotation_root)
            | map(.[-1])
          ) as $journals
          | ($leases + $journals)
          | .[]
        ' 2>/dev/null || true)"
        if [ -n "$carry" ]; then
          printf '%s\n' "$carry" >> "$tmp"
        fi
      fi
    fi
  fi

  printf '%s\n' "$line" >> "$tmp"
  durable_sync "$tmp"
  mv "$tmp" "$ledger"
  durable_sync "$ledger"
  durable_sync "$(dirname "$ledger")"
  if [ -n "$fd" ]; then
    flock -u "$fd"
    eval "exec ${fd}>&-"
  fi
  if [ -n "$ledger_lock_fd" ]; then
    flock -u "$ledger_lock_fd"
    eval "exec ${ledger_lock_fd}>&-"
  fi
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

  stage-transfer)
    command_stage_transfer "$@" ;;

  stage-transition)
    command_stage_transition "$@" ;;

  stage-apply)
    command_stage_apply "$@" ;;

  stage-probe)
    command_stage_probe "$@" ;;

  stage-reconcile)
    command_stage_reconcile "$@" ;;

  resume)
    command_resume "$@" ;;

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

  snapshot)
    command_snapshot "$@" ;;

  write-result)
    command_write_result "$@" ;;

  write-atomic)
    command_write_atomic "$@" ;;

  directive-send)
    command_directive_send "$@" ;;

  directive-poll|directive-list)
    command_directive_poll "$@" ;;

  directive-ack)
    command_directive_ack "$@" ;;

  --help|-h|help)
    usage
    ;;

  *)
    usage
    ;;
esac
