#!/usr/bin/env bash
# resolve-dispatch.sh — resolve role → {model, mode, agent} JSON.
# Removes the per-dispatch LLM lookup against model-routing-config.md / defaults.
#
# Usage:
#   scripts/resolve-dispatch.sh --role reviewer
#   scripts/resolve-dispatch.sh --role planner
#   scripts/resolve-dispatch.sh --role implementer --tree
#   scripts/resolve-dispatch.sh --role manager --tree    # exit 3 — never dispatched
#   scripts/resolve-dispatch.sh --role ar-analyst --data-class transcript
#   scripts/resolve-dispatch.sh --role ar-analyst --data-class transcript --model glm-5.3
#   scripts/resolve-dispatch.sh --role ar-analyst --data-class transcript --endpoint qwen_local
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
# --data-class <name> works with any role. After the role resolves, the engine,
# an optional --model probe, and --endpoint are checked against
# scripts/lib/data-class-policy.json. A family outside the allowlist (or on the
# deny list) exits 3 with one reason line on stderr. No flag overrides that file.
# ar-analyst's default seat is haiku, first of haiku, sonnet, grok, carbon, hydrogen, astra.
#
# Exit codes:
#   0  success (JSON on stdout)
#   1  unknown role
#   2  usage / missing required argument / invalid input
#   3  manager role with --tree (manager is Fable-class and never dispatched
#      as a delegate — Amendment 11; MANAGER_NOT_DISPATCHABLE on stderr),
#      or a data-class refusal

set -euo pipefail

ROLE=""
TREE_MODE=0
DATA_CLASS=""
MODEL_PROBE=""
ENDPOINT=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_CLASS_JS="$SCRIPT_DIR/lib/data-class-policy.js"

# Print the resolved JSON. When --data-class is set, refuse first (exit 3, reason on stderr).
# The gate reads only the policy file. A non-zero node status is this script's status.
finish_ok() {
  local model="$1" json="$2" rc=0
  if [[ -n "$DATA_CLASS" ]]; then
    local -a args=(check --engine "$model" --data-class "$DATA_CLASS")
    [[ -n "$MODEL_PROBE" ]] && args+=(--model "$MODEL_PROBE")
    [[ -n "$ENDPOINT" ]] && args+=(--endpoint "$ENDPOINT")
    node "$DATA_CLASS_JS" "${args[@]}" || rc=$?
    [[ "$rc" -eq 0 ]] || exit "$rc"
  fi
  printf '%s\n' "$json"
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    --tree) TREE_MODE=1; shift ;;
    --data-class)
      if [[ $# -lt 2 || -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "missing --data-class value" >&2; exit 2
      fi
      DATA_CLASS="$2"; shift 2 ;;
    --model)
      if [[ $# -lt 2 || -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "missing --model value" >&2; exit 2
      fi
      MODEL_PROBE="$2"; shift 2 ;;
    --endpoint)
      if [[ $# -lt 2 || -z "${2:-}" || "${2:-}" == --* ]]; then
        echo "missing --endpoint value" >&2; exit 2
      fi
      ENDPOINT="$2"; shift 2 ;;
    -h|--help) awk 'NR>1 && /^[^#]/{exit} NR>1{sub(/^# ?/,""); print}' "$0"; exit 0 ;;
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
# Grammar: one optional slash-separated namespace, nothing more — lets a project
# override name a namespaced model alias (e.g. kimi-code/k3) in the model column
# without opening the door to multi-segment or leading/trailing-slash values
# (project/plans/_archive/2026/09/2026-09-11-kimi-implementer-rail.md §2.5 / KR2).
valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?$ ]]; }

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
        finish_ok "$model" "$(printf '{"model":"%s","mode":"%s","agent":"","table":"tree","source":"project"}' "$model" "$mode")"
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
  _tree_model="$(printf '%s' "$result" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')"
  finish_ok "$_tree_model" "${result%\}},\"table\":\"tree\",\"source\":\"default\"}"
fi

# ── Legacy path ──────────────────────────────────────────────────────────────

# Default table — keep in sync with references/model-routing.md
declare -A DEFAULTS
DEFAULTS[planner]='{"model":"sonnet","mode":"plan","agent":"autopilot:planner"}'
DEFAULTS[reviewer]='{"model":"opus","mode":"plan","agent":"autopilot:reviewer"}'
DEFAULTS[debugger]='{"model":"opus","mode":"plan","agent":"autopilot:debugger"}'
DEFAULTS[implementer]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[deep-reasoner]='{"model":"opus","mode":"plan","agent":""}'
DEFAULTS[fast-worker]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[hands]='{"model":"haiku","mode":"default","agent":""}'
DEFAULTS[test-runner]='{"model":"haiku","mode":"default","agent":""}'
DEFAULTS[researcher]='{"model":"sonnet","mode":"default","agent":""}'
DEFAULTS[think-tank-role]='{"model":"sonnet","mode":"plan","agent":""}'
# Transcript digest. First seat is haiku; order lives in data-class-policy.json seat_preference.
DEFAULTS[ar-analyst]='{"model":"haiku","mode":"default","agent":""}'

# Pool-aware mechanical routing (fleet 01M883AEHTJWZH95JSY1MSKEFX): on a seat of a listed account
# pool (scripts/lib/pool-mech-route.json) the mechanical roles resolve to agy / codex A / codex B.
# Off: AUTOPILOT_POOL_MECH_ROUTE=0 or "enabled": false in that file. Not applied to --tree.
POOL_ROUTE_JS="$(dirname "$0")/lib/pool-mech-route.js"
if routed="$(node "$POOL_ROUTE_JS" route --role "$ROLE" 2>/dev/null)"; then
  # Same data-class gate as every other success path (finish_ok exits).
  _routed_engine="$(printf '%s' "$routed" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')"
  finish_ok "$_routed_engine" "$routed"
fi

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
      # Private lanes (308, mple2/MSN, thinksmart, alfred) never resolve to kimi or other Chinese-model engines.
      if node "$POOL_ROUTE_JS" private-model-ok --model "$model" 2>/dev/null; then
        finish_ok "$model" "$(printf '{"model":"%s","mode":"%s","agent":"","source":"project"}' "$model" "$mode")"
      fi
      echo "warning: private lane refuses a Chinese-model override for ${ROLE}; using defaults" >&2
    else
      echo "warning: ignoring override row for ${ROLE} (model/mode must match [A-Za-z0-9._-]+); using defaults" >&2
    fi
  fi
fi

# Fall back to defaults
result="${DEFAULTS[$ROLE]:-}"
if [[ -z "$result" ]]; then
  echo "unknown role: $ROLE (known: ${!DEFAULTS[*]})" >&2
  exit 1
fi
_legacy_model="$(printf '%s' "$result" | sed -n 's/.*"model":"\([^"]*\)".*/\1/p')"
finish_ok "$_legacy_model" "${result%\}},\"source\":\"default\"}"
