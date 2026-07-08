#!/usr/bin/env bash
# dispatch-detach.sh — sourceable R1 detach helper for the READ-ONLY dispatch rails
# (dispatch-review.sh / dispatch-author.sh).
#
# Contract (mirrors dispatch-hetero.sh's in-process detach, kept minimal for the read rails):
#   detach_on
#     → 0 (true) unless DISPATCH_DETACH is 0/false/no/off. Default ON.
#   dispatch_detach_supervise <self> <ledger> <run_id> <stage> <self_dir> -- <orig-args...>
#     When detach_on AND all of ledger/run_id/stage are non-empty, re-execute <self> INLINE
#     (DISPATCH_DETACH=0) inside a `setsid` session that SURVIVES the caller being killed. That
#     session heartbeats to the R0 ledger during the run and lands the inline JSON result
#     atomically at "<ledger>.results/<run_id>.<stage>.result.json"; the supervising parent then
#     relays the SAME stdout + exit code (transparent normal case) and EXITs. When any coord is
#     absent OR detach is off, the function RETURNS 0 and the caller proceeds on its unchanged
#     inline path — byte-identical to pre-R1.
#
# Scope note: the write-oriented rail (dispatch-hetero.sh) implements the full ledger stage
# lifecycle (stage-transition → committed, resume-adoptable git-truth) in-process. The read
# rails are idempotent and produce no commit, so this helper provides setsid kill-survival +
# durable atomic result + heartbeat, and leaves stage-state transitions to the orchestrator
# (the durable result file is what `run-ledger stage-reconcile --result-json` adopts on resume).

detach_on() {
  case "${DISPATCH_DETACH:-1}" in
    0|false|FALSE|no|NO|off|OFF|No|Off) return 1 ;;
    *) return 0 ;;
  esac
}

dispatch_detach_supervise() {
  local self="$1" ledger="$2" run_id="$3" stage="$4" self_dir="$5"
  shift 5
  # consume the "--" separator if present
  [ "${1:-}" = "--" ] && shift
  # gate: only engage when detach is on AND all ledger coords are supplied
  detach_on || return 0
  { [ -n "$ledger" ] && [ -n "$run_id" ] && [ -n "$stage" ]; } || return 0

  local run_ledger="$self_dir/run-ledger.sh"
  [ -f "$run_ledger" ] || return 0   # no ledger tooling available → stay inline (fail-safe)
  command -v setsid >/dev/null 2>&1 || return 0
  command -v jq >/dev/null 2>&1 || return 0

  local results_dir="${ledger}.results"
  local result_file="$results_dir/${run_id}.${stage}.result.json"
  local exit_file="$results_dir/${run_id}.${stage}.exit"
  local hb="${DISPATCH_HEARTBEAT_SECS:-20}"
  mkdir -p "$results_dir"
  rm -f "$result_file" "$exit_file"

  # serialize the original argv NUL-delimited so the detached child re-runs this EXACT dispatch
  local argfile; argfile="$(mktemp -t dispatch-detach-args-XXXXXX)"
  if [ "$#" -gt 0 ]; then printf '%s\0' "$@" > "$argfile"; else : > "$argfile"; fi

  # A caller signal must not reap the surviving session; just exit and leave it running.
  trap 'exit 143' INT TERM

  DISPATCH_DETACH=0 \
  DD_ARGFILE="$argfile" DD_SELF="$self" DD_LEDGER_SH="$run_ledger" \
  DD_LEDGER="$ledger" DD_RUNID="$run_id" DD_STAGE="$stage" \
  DD_RESULT="$result_file" DD_EXIT="$exit_file" DD_HB="$hb" \
  setsid bash -c '
    set -uo pipefail
    _args=()
    if [ -s "$DD_ARGFILE" ]; then mapfile -d "" _args < "$DD_ARGFILE"; fi
    rm -f "$DD_ARGFILE"   # self-clean after reading, so a caller-kill cannot leak it
    # lease AS THIS surviving session (records our pid/start_time for the watchdog)
    acq="$(bash "$DD_LEDGER_SH" stage-acquire --ledger "$DD_LEDGER" --run-id "$DD_RUNID" --stage "$DD_STAGE" --pid "$$" --allow-reopen 2>/dev/null || true)"
    gen="$(printf "%s" "$acq" | jq -r ".generation // empty" 2>/dev/null || true)"
    nonce="$(printf "%s" "$acq" | jq -r ".nonce // empty" 2>/dev/null || true)"
    hbpid=""
    if [ -n "$gen" ] && [ -n "$nonce" ]; then
      ( while :; do
          bash "$DD_LEDGER_SH" stage-heartbeat --ledger "$DD_LEDGER" --run-id "$DD_RUNID" --stage "$DD_STAGE" \
            --generation "$gen" --nonce "$nonce" --pid "$$" >/dev/null 2>&1 || true
          sleep "${DD_HB:-20}"
        done ) &
      hbpid=$!
    fi
    partial="$DD_RESULT.partial.$$"
    DISPATCH_DETACH=0 bash "$DD_SELF" "${_args[@]}" > "$partial" 2>/dev/null
    rc=$?
    [ -n "$hbpid" ] && { kill "$hbpid" 2>/dev/null || true; }
    bash "$DD_LEDGER_SH" write-result --path "$DD_RESULT" --no-require-json --payload-file "$partial" >/dev/null 2>&1 || mv -f "$partial" "$DD_RESULT" 2>/dev/null || true
    rm -f "$partial"
    printf "%s" "$rc" > "$DD_EXIT.tmp.$$" && mv "$DD_EXIT.tmp.$$" "$DD_EXIT"
  ' &
  local child=$!
  wait "$child" 2>/dev/null || true

  # NOT killed → relay the durable result + exit code transparently.
  local rc=1
  [ -f "$exit_file" ] && rc="$(cat "$exit_file" 2>/dev/null || echo 1)"
  if [ -f "$result_file" ]; then cat "$result_file"; fi
  rm -f "$argfile"
  exit "$rc"
}
