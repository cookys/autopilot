#!/usr/bin/env bash
# resolve-dispatch.sh — resolve role → {model, mode, agent} JSON.
# Removes the per-dispatch LLM lookup against model-routing-config.md / defaults.
#
# Usage:
#   scripts/resolve-dispatch.sh --role reviewer
#   scripts/resolve-dispatch.sh --role planner
#
# Order of precedence:
#   1. .claude/model-routing-config.md (project override) — first matching row
#   2. references/model-routing.md defaults (embedded below)
#
# Output: JSON {model, mode, agent, source}. source = "project" | "default".

set -euo pipefail

ROLE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$ROLE" ]] && { echo "missing --role" >&2; exit 2; }

# Default table — keep in sync with references/model-routing.md
declare -A DEFAULTS
DEFAULTS[planner]='{"model":"sonnet","mode":"plan","agent":"autopilot:planner"}'
DEFAULTS[reviewer]='{"model":"sonnet","mode":"plan","agent":"autopilot:reviewer"}'
DEFAULTS[debugger]='{"model":"sonnet","mode":"plan","agent":"autopilot:debugger"}'
DEFAULTS[implementer]='{"model":"opus","mode":"default","agent":""}'
DEFAULTS[test-runner]='{"model":"haiku","mode":"default","agent":""}'
DEFAULTS[researcher]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[think-tank-role]='{"model":"sonnet","mode":"plan","agent":""}'

# Try project override
CONFIG=".claude/model-routing-config.md"
if [[ -f "$CONFIG" ]]; then
  row="$(grep -iE "^\|[[:space:]]*(\*\*)?${ROLE}(\*\*)?[[:space:]]*\|" "$CONFIG" 2>/dev/null | head -1 || true)"
  if [[ -n "$row" ]]; then
    model="$(echo "$row" | awk -F'|' '{print $3}' | tr -d ' *')"
    mode="$(echo "$row" | awk -F'|' '{print $4}'  | tr -d ' *')"
    printf '{"model":"%s","mode":"%s","agent":"","source":"project"}\n' "$model" "$mode"
    exit 0
  fi
fi

# Fall back to defaults
result="${DEFAULTS[$ROLE]:-}"
if [[ -z "$result" ]]; then
  echo "unknown role: $ROLE (known: ${!DEFAULTS[*]})" >&2
  exit 1
fi
echo "${result%\}},\"source\":\"default\"}"
