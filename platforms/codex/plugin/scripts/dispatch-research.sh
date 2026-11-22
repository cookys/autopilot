#!/usr/bin/env bash
# dispatch-research.sh — thin wrapper that fans out hard-research dispatches
# to TWO independent engines from different model families.
#
# Usage:
#   scripts/dispatch-research.sh --seats <seat1>,<seat2> --slug <slug> --brief <file> --base <sha> [--timeout Nm] [extra args...]
#
# Validation (before any dispatch):
#   - Exactly two comma-separated seats required (else exit 2:
#     "research: two independent dispatches required").
#   - Both seats must resolve to a known runner/family (else exit 2:
#     "research: seat <name> unavailable — substitute a different-family engine and record the substitution on the fleet task").
#   - Both seats must belong to DIFFERENT model families (else exit 2:
#     "research: two independent families required, got <f1> and <f2>").
#
# Dispatches two separate `dispatch-hetero.sh --no-campaign` runs with branches
# `<slug>-<seat1>` and `<slug>-<seat2>` (never the same worktree).
# Set AUTOPILOT_DISPATCH_WRAPPER to override the dispatch command in tests.

set -euo pipefail

SEATS=""
SLUG=""
BRIEF=""
BASE=""
TIMEOUT=""
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --seats)
      [[ $# -ge 2 ]] || { echo "missing --seats value" >&2; exit 2; }
      SEATS="$2"; shift 2 ;;
    --slug)
      [[ $# -ge 2 ]] || { echo "missing --slug value" >&2; exit 2; }
      SLUG="$2"; shift 2 ;;
    --brief)
      [[ $# -ge 2 ]] || { echo "missing --brief value" >&2; exit 2; }
      BRIEF="$2"; shift 2 ;;
    --base)
      [[ $# -ge 2 ]] || { echo "missing --base value" >&2; exit 2; }
      BASE="$2"; shift 2 ;;
    --timeout)
      [[ $# -ge 2 ]] || { echo "missing --timeout value" >&2; exit 2; }
      TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      awk 'NR>1 && /^[^#]/{exit} NR>1{sub(/^# ?/,""); print}' "$0"
      exit 0 ;;
    *)
      EXTRA_ARGS+=("$1"); shift ;;
  esac
done

[[ -n "$SLUG" ]] || { echo "missing --slug" >&2; exit 2; }
[[ -n "$BRIEF" ]] || { echo "missing --brief" >&2; exit 2; }
[[ -n "$BASE" ]] || { echo "missing --base" >&2; exit 2; }

IFS=',' read -r -a SEAT_ARR <<< "$SEATS"
if [[ "${#SEAT_ARR[@]}" -ne 2 || -z "${SEAT_ARR[0]}" || -z "${SEAT_ARR[1]}" ]]; then
  echo "research: two independent dispatches required" >&2
  exit 2
fi

SEAT1="${SEAT_ARR[0]}"
SEAT2="${SEAT_ARR[1]}"

# Resolve seat name -> "runner|model|family"
resolve_seat() {
  local seat="$1"
  case "$seat" in
    astra)
      echo "codex|gpt-6-astra|openai" ;;
    gpt-*|codex*)
      echo "codex|${seat}|openai" ;;
    carbon)
      echo "agy|gemini-4-carbon-high|anthropic" ;;
    sonnet|opus|haiku|claude*)
      echo "claude-native|${seat}|anthropic" ;;
    hydrogen|neon|gemini*)
      echo "agy|${seat}|google" ;;
    grok*)
      echo "grok|${seat}|xai" ;;
    kimi*)
      echo "kimi|${seat}|moonshot" ;;
    composer*|cursor)
      echo "cursor|${seat}|cursor" ;;
    qwen*|local)
      echo "local|${seat}|alibaba" ;;
    minimax*|pi)
      echo "pi|${seat}|minimax" ;;
    opencode*)
      echo "opencode|${seat}|opencode" ;;
    *)
      return 1 ;;
  esac
}

INFO1="$(resolve_seat "$SEAT1")" || {
  echo "research: seat ${SEAT1} unavailable — substitute a different-family engine and record the substitution on the fleet task" >&2
  exit 2
}
INFO2="$(resolve_seat "$SEAT2")" || {
  echo "research: seat ${SEAT2} unavailable — substitute a different-family engine and record the substitution on the fleet task" >&2
  exit 2
}

IFS='|' read -r RUNNER1 MODEL1 FAMILY1 <<< "$INFO1"
IFS='|' read -r RUNNER2 MODEL2 FAMILY2 <<< "$INFO2"

if [[ "$FAMILY1" == "$FAMILY2" ]]; then
  echo "research: two independent families required, got ${FAMILY1} and ${FAMILY2}" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCH_HETERO="${SCRIPT_DIR}/dispatch-hetero.sh"

run_one() {
  local seat="$1" runner="$2" model="$3"
  local branch="${SLUG}-${seat}"
  local -a cmd_args=(
    --no-campaign
    --branch "$branch"
    --prompt-file "$BRIEF"
    --base "$BASE"
    --runner "$runner"
    --model "$model"
  )
  if [[ -n "$TIMEOUT" ]]; then
    cmd_args+=(--timeout "$TIMEOUT")
  fi
  if [[ "${#EXTRA_ARGS[@]}" -gt 0 ]]; then
    cmd_args+=("${EXTRA_ARGS[@]}")
  fi

  if [[ -n "${AUTOPILOT_DISPATCH_WRAPPER:-}" ]]; then
    "$AUTOPILOT_DISPATCH_WRAPPER" "$DISPATCH_HETERO" "${cmd_args[@]}"
  else
    local quoted_args=""
    printf -v quoted_args '%q ' "${cmd_args[@]}"
    sg lanegit -c "env -u AUTOPILOT_TOKEN_SEAT bash ${DISPATCH_HETERO} ${quoted_args}"
  fi
}

run_one "$SEAT1" "$RUNNER1" "$MODEL1"
run_one "$SEAT2" "$RUNNER2" "$MODEL2"
