#!/usr/bin/env bash
# resolve-doa.sh — resolve (role, model-tier) → DOA preset + action-policy JSON.
# Removes per-dispatch LLM judgment about Delegated Operations Authority.
#
# Usage:
#   scripts/resolve-doa.sh --role implementer --tier sonnet
#   scripts/resolve-doa.sh implementer sonnet          # positional args
#
# Order of precedence:
#   1. .claude/doa-config.md (project override) — first matching (role, tier) row
#   2. project-config-template/doa-config.md defaults (tier → preset mapping)
#   3. Fail-closed: unknown role or unknown tier → all actions escalate
#
# Output: JSON {preset, role, model_tier, actions: {read_only, reversible,
#              external, irreversible}, source}
#   where each action value ∈ {autonomous, logged, escalate}
#   source ∈ {project, default, fail-closed-default}
#
# Exit codes:
#   0  success (JSON on stdout)
#   2  usage / missing required argument
#
# Note: flock(1) is Linux-native (util-linux). On macOS install via Homebrew
#   (brew install util-linux). This script does not use flock itself; this note
#   is here to mirror tree.sh's portability caveat for awareness.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ROLE=""
MODEL_TIER=""

# Parse flags or positional args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)   ROLE="$2";       shift 2 ;;
    --tier)   MODEL_TIER="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
    *)
      # positional: first = role, second = tier
      if [[ -z "$ROLE" ]]; then
        ROLE="$1"
      elif [[ -z "$MODEL_TIER" ]]; then
        MODEL_TIER="$1"
      else
        echo "unexpected positional arg: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

[[ -z "$ROLE" ]]       && { echo "missing --role"       >&2; exit 2; }
[[ -z "$MODEL_TIER" ]] && { echo "missing --tier"       >&2; exit 2; }

# ── Preset → action-policy tables ────────────────────────────────────────────
# Presets are canonical; project overrides can only select a preset by name.

emit_preset_json() {
  local preset="$1" role="$2" tier="$3" source="$4"
  local r rev ext irr
  case "$preset" in
    cloud-high-trust)
      r="autonomous"; rev="autonomous"; ext="logged"; irr="escalate"
      ;;
    local-low-trust)
      r="autonomous"; rev="escalate"; ext="escalate"; irr="escalate"
      ;;
    fail-closed)
      r="escalate"; rev="escalate"; ext="escalate"; irr="escalate"
      preset="fail-closed-default"
      source="fail-closed-default"
      ;;
    *)
      # Unknown preset name in override config → fail-closed
      r="escalate"; rev="escalate"; ext="escalate"; irr="escalate"
      preset="fail-closed-default"
      source="fail-closed-default"
      ;;
  esac
  printf '{"preset":"%s","role":"%s","model_tier":"%s","actions":{"read_only":"%s","reversible":"%s","external":"%s","irreversible":"%s"},"source":"%s"}\n' \
    "$preset" "$role" "$tier" "$r" "$rev" "$ext" "$irr" "$source"
}

# ── Default tier → preset mapping ────────────────────────────────────────────
# cloud-tier: fable, opus, sonnet (and any substring match, e.g. "sonnet-3-7")
# local-tier: flash, haiku, local

tier_to_preset() {
  local tier="$1"
  local tlower
  tlower="$(printf '%s' "$tier" | tr '[:upper:]' '[:lower:]')"
  case "$tlower" in
    *fable*|*opus*|*sonnet*) echo "cloud-high-trust" ;;
    *flash*|*haiku*|*local*) echo "local-low-trust"  ;;
    *) echo ""  ;;  # unknown tier
  esac
}

# ── Try project override (.claude/doa-config.md) ─────────────────────────────
# Override rows format (from project-config-template/doa-config.md §Project Override):
#   | Role | Model tier | Preset |
#   | implementer | sonnet | cloud-high-trust |
# Match is case-insensitive on both role and tier columns.

PROJECT_CONFIG="${DOA_CONFIG_OVERRIDE:-$REPO_ROOT/.claude/doa-config.md}"

if [[ -f "$PROJECT_CONFIG" ]]; then
  row="$(grep -iE "^\|[[:space:]]*(\*\*)?${ROLE}(\*\*)?[[:space:]]*\|[[:space:]]*(\*\*)?${MODEL_TIER}(\*\*)?[[:space:]]*\|" \
    "$PROJECT_CONFIG" 2>/dev/null | head -1 || true)"
  if [[ -n "$row" ]]; then
    preset_val="$(printf '%s' "$row" | awk -F'|' '{print $4}' | tr -d ' *')"
    if [[ -n "$preset_val" ]]; then
      emit_preset_json "$preset_val" "$ROLE" "$MODEL_TIER" "project"
      exit 0
    fi
  fi
fi

# ── Fall back to default tier mapping ────────────────────────────────────────
# Known tree roles (from references/model-routing.md §Tree roles).
# Unknown role on the default path → fail-closed (project overrides can extend
# the role set via the override config table).
KNOWN_ROLES=(
  manager
  sub-orchestrator
  planner
  researcher
  implementer
  judge
  synthesizer
)

role_is_known() {
  local r
  for r in "${KNOWN_ROLES[@]}"; do
    [[ "$r" == "$1" ]] && return 0
  done
  return 1
}

preset="$(tier_to_preset "$MODEL_TIER")"

if [[ -z "$preset" ]]; then
  # Unknown tier → fail-closed (regardless of role)
  emit_preset_json "fail-closed" "$ROLE" "$MODEL_TIER" "fail-closed-default"
  exit 0
fi

if ! role_is_known "$ROLE"; then
  # Unknown role → fail-closed (fail-closed default wins)
  emit_preset_json "fail-closed" "$ROLE" "$MODEL_TIER" "fail-closed-default"
  exit 0
fi

emit_preset_json "$preset" "$ROLE" "$MODEL_TIER" "default"
exit 0
