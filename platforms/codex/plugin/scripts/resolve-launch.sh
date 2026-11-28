#!/usr/bin/env bash
# resolve-launch.sh — one launch decision for a worker role (fleet 01M883AEHTJWZH95JSY1MSKEFX).
# Callers that spawn a mechanical worker read THIS instead of using resolve-dispatch.sh's model directly.
#
#   scripts/resolve-launch.sh --role hands [--branch <b> --prompt-file <f>] [--data-class <c>]
#   scripts/resolve-launch.sh --json '<resolve-dispatch json>' [--branch <b> --prompt-file <f>]
#
# stdout, one JSON line:
#   {"launch":"claude","model":...,"mode":...,"agent":...,"source":...}   -> Agent tool with that model (unchanged path)
#   {"launch":"hetero","runner":"agy","model":...,"pool":...,"argv":[...]} -> run argv (scripts/dispatch-hetero.sh --runner <runner> ...)
# "hetero" only when the resolve output carries engine/runner other than Claude (pool route, e.g. singularaion
# seat; off with AUTOPILOT_POOL_MECH_ROUTE=0). Exit: resolve-dispatch's exit (1 role, 2 usage, 3 gate) or
# 2 invalid token / 3 private lane + Chinese-model runner. Never reads ~/.claude or credentials.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON=""; BRANCH=""; PROMPT=""; ROLE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON="${2:?--json needs a value}"; shift 2 ;;
    --branch) BRANCH="${2:?}"; shift 2 ;;
    --prompt-file) PROMPT="${2:?}"; shift 2 ;;
    --role|--data-class|--model|--endpoint) ROLE_ARGS+=("$1" "${2:?$1 needs a value}"); shift 2 ;;
    *) echo "resolve-launch: unknown argument $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$JSON" ]]; then
  [[ ${#ROLE_ARGS[@]} -gt 0 ]] || { echo "resolve-launch: need --role or --json" >&2; exit 2; }
  JSON="$("$SCRIPT_DIR/resolve-dispatch.sh" "${ROLE_ARGS[@]}")"
fi
args=(--json "$JSON")
[[ -n "$BRANCH" ]] && args+=(--branch "$BRANCH")
[[ -n "$PROMPT" ]] && args+=(--prompt-file "$PROMPT")
exec node "$SCRIPT_DIR/lib/launch-decision.js" "${args[@]}"
