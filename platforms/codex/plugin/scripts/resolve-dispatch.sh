#!/usr/bin/env bash
# resolve-dispatch.sh — resolve role → {model, mode, agent} JSON.
# Removes the per-dispatch LLM lookup against model-routing-config.md / defaults.
#
# Usage:
#   scripts/resolve-dispatch.sh --role reviewer
#   scripts/resolve-dispatch.sh --role planner
#   scripts/resolve-dispatch.sh --role implementer --tree
#   scripts/resolve-dispatch.sh --role manager --tree    # exit 3 — never dispatched
#
# Order of precedence:
#   1. ${MODEL_ROUTING_CONFIG_OVERRIDE:-.claude/model-routing-config.md}
#      (project override) — first matching row
#   2. references/model-routing.md defaults (embedded below)
#
# Output: JSON {model, mode, agent, source}. source = "project" | "default".
# With --tree: JSON {model, mode, agent, table, source}.
#   table = "tree" always when --tree is used.
#
# Exit codes:
#   0  success (JSON on stdout)
#   1  unknown role
#   2  usage / missing required argument / invalid input
#   3  manager role with --tree (manager is Fable-class and never dispatched
#      as a delegate — Amendment 11; MANAGER_NOT_DISPATCHABLE on stderr)

set -euo pipefail

ROLE=""
TREE_MODE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    --tree) TREE_MODE=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[[ -z "$ROLE" ]] && { echo "missing --role" >&2; exit 2; }

# Input sanitization: reject inputs that contain shell-special characters.
# $ROLE is interpolated into grep -iE patterns below; an unvalidated value
# such as 'implementer|judge' or '.*' would silently match rows it should not.
if ! [[ "$ROLE" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid --role value (only [A-Za-z0-9._-] allowed): $ROLE" >&2
  exit 2
fi

# Override-row column values flow into printf-built JSON; allowlist them like
# $ROLE. An invalid value (e.g. a crafted row injecting extra JSON fields) is
# warned and the row ignored — falls through to defaults, mirroring the
# malformed-override resilience convention.
valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }

# ── Tree path ────────────────────────────────────────────────────────────────

if [[ "$TREE_MODE" -eq 1 ]]; then
  # Manager (depth 0) is Fable-class and NEVER dispatched as a delegate.
  if [[ "$ROLE" == "manager" ]]; then
    echo "MANAGER_NOT_DISPATCHABLE: manager (depth 0) is Fable-class and is never dispatched as a delegate agent. It is the orchestrator that dispatches others. See references/model-routing.md §Tree roles (Amendment 11)." >&2
    exit 3
  fi

  # Tree default table — from references/model-routing.md §Tree roles
  declare -A TREE_DEFAULTS
  TREE_DEFAULTS[sub-orchestrator]='{"model":"opus","mode":"default","agent":""}'
  TREE_DEFAULTS[planner]='{"model":"sonnet","mode":"plan","agent":""}'
  TREE_DEFAULTS[researcher]='{"model":"sonnet","mode":"default","agent":""}'
  TREE_DEFAULTS[implementer]='{"model":"sonnet","mode":"default","agent":""}'
  TREE_DEFAULTS[judge]='{"model":"haiku","mode":"plan","agent":""}'
  TREE_DEFAULTS[synthesizer]='{"model":"haiku","mode":"plan","agent":""}'

  # Try project override (tree: prefixed rows)
  CONFIG="${MODEL_ROUTING_CONFIG_OVERRIDE:-.claude/model-routing-config.md}"
  ROLE_RE="${ROLE//./\\.}"
  if [[ -f "$CONFIG" ]]; then
    row="$(grep -iE "^\|[[:space:]]*(\*\*)?tree:${ROLE_RE}(\*\*)?[[:space:]]*\|" "$CONFIG" 2>/dev/null | head -1 || true)"
    if [[ -n "$row" ]]; then
      model="$(echo "$row" | awk -F'|' '{print $3}' | tr -d ' *')"
      mode="$(echo "$row"  | awk -F'|' '{print $4}' | tr -d ' *')"
      if valid_token "$model" && valid_token "$mode"; then
        printf '{"model":"%s","mode":"%s","agent":"","table":"tree","source":"project"}\n' "$model" "$mode"
        exit 0
      fi
      echo "warning: ignoring override row for tree:${ROLE} (model/mode must match [A-Za-z0-9._-]+); using defaults" >&2
    fi
  fi

  # Fall back to tree defaults
  result="${TREE_DEFAULTS[$ROLE]:-}"
  if [[ -z "$result" ]]; then
    echo "unknown tree role: $ROLE (known: ${!TREE_DEFAULTS[*]})" >&2
    exit 1
  fi
  echo "${result%\}},\"table\":\"tree\",\"source\":\"default\"}"
  exit 0
fi

# ── Legacy path ──────────────────────────────────────────────────────────────

# Default table — keep in sync with references/model-routing.md
declare -A DEFAULTS
DEFAULTS[planner]='{"model":"sonnet","mode":"plan","agent":"autopilot:planner"}'
DEFAULTS[reviewer]='{"model":"sonnet","mode":"plan","agent":"autopilot:reviewer"}'
DEFAULTS[debugger]='{"model":"sonnet","mode":"plan","agent":"autopilot:debugger"}'
DEFAULTS[implementer]='{"model":"opus","mode":"default","agent":""}'
DEFAULTS[deep-reasoner]='{"model":"opus","mode":"plan","agent":""}'
DEFAULTS[fast-worker]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[test-runner]='{"model":"haiku","mode":"default","agent":""}'
DEFAULTS[researcher]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[think-tank-role]='{"model":"sonnet","mode":"plan","agent":""}'

# Try project override (bare role rows only — tree: prefixed rows are ignored)
CONFIG="${MODEL_ROUTING_CONFIG_OVERRIDE:-.claude/model-routing-config.md}"
ROLE_RE="${ROLE//./\\.}"
if [[ -f "$CONFIG" ]]; then
  # Anchor matches bare role: must NOT start with "tree:" before the role name.
  # Pattern: line starts with | then optional whitespace + optional ** then
  # the role (no "tree:" prefix allowed).
  row="$(grep -iE "^\|[[:space:]]*(\*\*)?${ROLE_RE}(\*\*)?[[:space:]]*\|" "$CONFIG" 2>/dev/null \
    | grep -ivE "^\|[[:space:]]*(\*\*)?tree:" | head -1 || true)"
  if [[ -n "$row" ]]; then
    model="$(echo "$row" | awk -F'|' '{print $3}' | tr -d ' *')"
    mode="$(echo "$row"  | awk -F'|' '{print $4}' | tr -d ' *')"
    if valid_token "$model" && valid_token "$mode"; then
      printf '{"model":"%s","mode":"%s","agent":"","source":"project"}\n' "$model" "$mode"
      exit 0
    fi
    echo "warning: ignoring override row for ${ROLE} (model/mode must match [A-Za-z0-9._-]+); using defaults" >&2
  fi
fi

# Fall back to defaults
result="${DEFAULTS[$ROLE]:-}"
if [[ -z "$result" ]]; then
  echo "unknown role: $ROLE (known: ${!DEFAULTS[*]})" >&2
  exit 1
fi
echo "${result%\}},\"source\":\"default\"}"
