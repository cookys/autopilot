#!/usr/bin/env bash
# output-quiescence.sh — Sourceable helper to wait for late-flushing subprocesses
# to finalize their output checks using content-driven stability.
#
# Root cause: runners like 'codex exec' can exit their frontend process while a
# forked child still holds the inherited stdout fd to the capture file and flushes
# the final message AFTER the frontend returns.
#
# Falsification Note (2026-07-05): Empirical probes on this host falsified the fd-holder
# invariant. The sandboxed codex worker is invisible to both procfs fd scans and pgrep
# while it is still writing, so "no visible holder" does NOT mean "final state".
# fd/process observation is therefore unusable for the sandboxed runner.
#
# New Algorithm: Content-driven quiescence. Polls the target file's size every 250ms
# using `wc -c < file`.
# - If the size is > 0 and unchanged across consecutive 250ms polls (stable_count >= stable_polls),
#   the content is considered settled/stable and we return 0. The stability window is now ~1s by default
#   (AUTOPILOT_STABLE_POLLS × 250ms), chosen because a writer may emit output in chunks with sub-second pauses;
#   the window is tunable via AUTOPILOT_STABLE_POLLS.
# - If the size is > 0 but growing, we reset stable_count and keep polling.
# - If the file remains empty (size == 0) and the elapsed time reaches a bounded grace
#   period (grace_ms, default 10000ms), we return 0 (honest empty, does not pay the full deadline).
#   Precedence for grace_ms is: env var AUTOPILOT_EMPTY_GRACE_MS (operator override) > caller's 3rd arg (per-runner default) > 10000.
#   Per-runner defaults exist because the cc-shim runner's flush profile is empirically slower than codex.
# - If elapsed reaches deadline_ms, we return 1 (caller proceeds with its check anyway).
#
# Note: whitespace-only content counts as "content" for stability purposes but will still
# be classified empty by the callers' non-whitespace check — that is intended (stability
# guard is about write-completion, classification stays the callers' job).
#
# Born-from note: 2026-07-05 late-flush fix (BACKLOG third occurrence, codex runner).

wait_output_quiescent() {
  local target="${1:-}"
  local deadline_ms="${2:-0}"

  local grace_ms="${AUTOPILOT_EMPTY_GRACE_MS:-${3:-10000}}"
  local stable_polls="${AUTOPILOT_STABLE_POLLS:-4}"
  local elapsed=0
  local prev_size=-1
  local stable_count=0

  while :; do
    local size=0
    if [[ -r "$target" ]]; then
      size="$(wc -c < "$target" 2>/dev/null)"
      size="${size//[[:space:]]/}"
      if [[ ! "$size" =~ ^[0-9]+$ ]]; then
        size=0
      fi
    fi

    if [[ "$size" -gt 0 ]]; then
      if [[ "$size" -eq "$prev_size" ]]; then
        stable_count=$((stable_count + 1))
        if [[ "$stable_count" -ge "$stable_polls" ]]; then
          return 0
        fi
      else
        stable_count=0
      fi
    else
      # size == 0
      if [[ "$elapsed" -ge "$grace_ms" ]]; then
        return 0
      fi
    fi

    if [[ "$elapsed" -ge "$deadline_ms" ]]; then
      return 1
    fi

    prev_size="$size"
    sleep 0.25
    elapsed=$((elapsed + 250))
  done
}
