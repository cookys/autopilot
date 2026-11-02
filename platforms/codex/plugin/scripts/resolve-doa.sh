#!/usr/bin/env bash
# resolve-doa.sh — resolve (role, model-tier) → DOA preset + action-policy JSON.
# Removes per-dispatch LLM judgment about Delegated Operations Authority.
#
# Usage:
#   scripts/resolve-doa.sh --role implementer --tier sonnet
#   scripts/resolve-doa.sh implementer sonnet          # positional args
#
# Order of precedence:
#   1. Project override config — first matching (role, tier) row. The config file
#      is itself resolved by: $DOA_CONFIG_OVERRIDE → $PWD/.claude/doa-config.md
#      (the CONSUMING project's cwd, what matters under a plugin install) →
#      $REPO_ROOT/.claude/doa-config.md (autopilot's own repo, for dogfooding).
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
#
# ── Production targets (--target <name>), added for operator-console A2 ──────
#   scripts/resolve-doa.sh --role implementer --tier sonnet --target example-prod
# Only when --target is given is a target judged; without it the output and exit
# code are byte-identical to before. The target is looked up, by EXACT name (no
# glob, case-sensitive), in the `## Production Targets` section of the COMMITTED
# repo-root config: <git toplevel of $PWD>/.claude/doa-config.md (the $PWD copy if
# $PWD is not in a git checkout). Row shape: `| Target | Class |`, Class is exactly
# `production` or `staging`.
#   production      → stdout {"decision":"production_denied",...}, exit 10. Refused,
#                     never escalated: no card, no "go" turns it into permission.
#   staging         → the ordinary preset JSON, identical to the no --target call.
#   not on the table, section/file missing, invalid target name, or ANY malformed row
#   in the table (misspelt class, wrong column count, bad name) → fail closed:
#                     stdout {"decision":"target_unlisted",...}, exit 11.
#   A name listed twice with different classes is production (the strictest wins).
# $DOA_CONFIG_OVERRIDE is IGNORED for this table (chosen over "may only tighten"):
# an override file can pick presets but can never relax, or even add to, the
# production list; only the committed repo config decides.
# Exit codes added: 10 production_denied | 11 target_unlisted / table untrusted.
# (0 and 2 keep their meaning; 10 and 11 collide with no other exit of this script.)
# Accepted residual risks (master plan §6, line 341; line 54):
#   1. The caller self-reports --target. A mislabelled target (naming prod as a
#      staging name, or an unlisted name that is then rejected) is not detected
#      here; same class as the plan's "request mislabels production". No command
#      content is parsed (separate item).
#   2. An agent that edits the table is not stopped, only visible in git history.
#      Every change to the list must be a reviewed commit.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ROLE=""
MODEL_TIER=""
TARGET=""
TARGET_SET=0

# Parse flags or positional args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role)   ROLE="$2";       shift 2 ;;
    --tier)   MODEL_TIER="$2"; shift 2 ;;
    --target)
      [[ $# -lt 2 ]] && { echo "--target needs a value" >&2; exit 2; }
      TARGET="$2"; TARGET_SET=1; shift 2 ;;
    -h|--help)
      sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'
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

# Input sanitization: reject inputs that contain shell-special characters.
# $ROLE and $MODEL_TIER are interpolated into grep -iE patterns below; an
# unvalidated value such as 'implementer|judge' or '.*' would silently match
# rows it should not, defeating the override lookup.
if ! [[ "$ROLE"       =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid --role value (only [A-Za-z0-9._-] allowed): $ROLE" >&2
  exit 2
fi
if ! [[ "$MODEL_TIER" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "invalid --tier value (only [A-Za-z0-9._-] allowed): $MODEL_TIER" >&2
  exit 2
fi

# Override-row column values flow into printf-built JSON; allowlist them.
valid_token() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]]; }

# ── Production target gate (only with --target) ──────────────────────────────
# Reads the committed repo-root config; $DOA_CONFIG_OVERRIDE is deliberately not consulted.
target_table_config() {
  local top
  top="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)" || top=""
  [[ -z "$top" ]] && top="$PWD"
  printf '%s/.claude/doa-config.md' "$top"
}

# stdout: production | staging | unlisted | malformed
classify_target() {
  local target="$1" cfg
  cfg="$(target_table_config)"
  [[ -f "$cfg" ]] || { echo unlisted; return; }
  awk -F'|' -v want="$target" '
    function trim(x) { gsub(/^[ \t]+|[ \t]+$/, "", x); return x }
    /^[ \t]*```/ { fence = !fence; next }
    fence { next }
    /^## / { insec = ($0 ~ /^## Production Targets[ \t]*$/); next }
    !insec { next }
    /^[ \t]*\|/ {
      if (NF != 4) { bad = 1; next }
      name = trim($2); cls = trim($3)
      if (name == "Target" && cls == "Class") next
      if (name ~ /^:?-+:?$/ && cls ~ /^:?-+:?$/) next
      if (name !~ /^[A-Za-z0-9._-]+$/ || (cls != "production" && cls != "staging")) { bad = 1; next }
      if (name == want) { if (cls == "production") prod = 1; else stg = 1 }
    }
    END {
      if (bad) print "malformed"
      else if (prod) print "production"
      else if (stg) print "staging"
      else print "unlisted"
    }' "$cfg"
}

if [[ "$TARGET_SET" -eq 1 ]]; then
  if ! [[ "$TARGET" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf '{"decision":"target_unlisted","reason":"invalid target name","role":"%s","model_tier":"%s"}\n' "$ROLE" "$MODEL_TIER"
    exit 11
  fi
  target_class="$(classify_target "$TARGET")"
  case "$target_class" in
    production)
      printf '{"decision":"production_denied","target":"%s","role":"%s","model_tier":"%s","source":"production-table"}\n' "$TARGET" "$ROLE" "$MODEL_TIER"
      exit 10
      ;;
    staging) ;;  # falls through to the ordinary class below
    *)
      printf '{"decision":"target_unlisted","target":"%s","reason":"%s","role":"%s","model_tier":"%s"}\n' "$TARGET" \
        "$([[ "$target_class" == malformed ]] && echo 'production table malformed' || echo 'target not on the production table')" "$ROLE" "$MODEL_TIER"
      exit 11
      ;;
  esac
fi

# ── Preset → action-policy tables ────────────────────────────────────────────
# Presets are canonical; project overrides can only select a preset by name.

emit_preset_json() {
  local preset="$1" role="$2" tier="$3" source="$4"
  local r rev ext irr
  case "$preset" in
    cloud-high-trust)
      r="autonomous"; rev="autonomous"; ext="logged"; irr="escalate"
      ;;
    cloud-cautious)
      # Like cloud-high-trust but escalates external actions (push, PR comment,
      # open issue) too — for projects touching production systems / sensitive
      # data where outward-facing actions warrant a human gate, while local
      # reversible work (edit, commit, test) stays autonomous.
      r="autonomous"; rev="autonomous"; ext="escalate"; irr="escalate"
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
#
# Config resolution precedence:
#   1. $DOA_CONFIG_OVERRIDE          — explicit caller override (highest)
#   2. $PWD/.claude/doa-config.md    — the CONSUMING project's config (cwd)
#   3. $REPO_ROOT/.claude/doa-config.md — autopilot's own repo (dogfooding)
# When autopilot runs as a plugin, REPO_ROOT is the plugin install dir, NOT the
# project being worked on — so cwd ($PWD) is what carries the project override.
# NOTE: intentionally NOT migrated to scripts/lib/resolve-config.sh — this ladder is -f/3-tier/no-template/unconditional-else, a different contract.
if [[ -n "${DOA_CONFIG_OVERRIDE:-}" ]]; then
  PROJECT_CONFIG="$DOA_CONFIG_OVERRIDE"
elif [[ -f "$PWD/.claude/doa-config.md" ]]; then
  PROJECT_CONFIG="$PWD/.claude/doa-config.md"
else
  # Same dogfood gate as resolve_config_ladder tier 3: plugin .claude/ is not
  # the consuming project's. If PWD is not a git checkout of REPO_ROOT, leave
  # PROJECT_CONFIG empty so the code-embedded presets answer.
  _pwd_top="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null)" || _pwd_top=""
  _repo_real="$(cd "$REPO_ROOT" && pwd -P 2>/dev/null)" || _repo_real=""
  _pwd_real=""
  if [[ -n "$_pwd_top" ]]; then
    _pwd_real="$(cd "$_pwd_top" && pwd -P 2>/dev/null)" || _pwd_real=""
  fi
  if [[ -n "$_pwd_real" && -n "$_repo_real" && "$_pwd_real" == "$_repo_real" ]]; then
    PROJECT_CONFIG="$REPO_ROOT/.claude/doa-config.md"
  else
    PROJECT_CONFIG=""
  fi
fi

if [[ -f "$PROJECT_CONFIG" ]]; then
  # Escape dots before regex interpolation: sanitization allows '.', and an
  # unescaped dot matches any character (sonnet.v3 would match sonnet_v3).
  ROLE_RE="${ROLE//./\\.}"
  TIER_RE="${MODEL_TIER//./\\.}"
  row="$(grep -iE "^\|[[:space:]]*(\*\*)?${ROLE_RE}(\*\*)?[[:space:]]*\|[[:space:]]*(\*\*)?${TIER_RE}(\*\*)?[[:space:]]*\|" \
    "$PROJECT_CONFIG" 2>/dev/null | head -1 || true)"
  if [[ -n "$row" ]]; then
    preset_val="$(printf '%s' "$row" | awk -F'|' '{print $4}' | tr -d ' *')"
    if [[ -n "$preset_val" ]]; then
      if valid_token "$preset_val"; then
        emit_preset_json "$preset_val" "$ROLE" "$MODEL_TIER" "project"
        exit 0
      fi
      echo "warning: ignoring override row for ${ROLE}/${MODEL_TIER} (preset must match [A-Za-z0-9._-]+); using defaults" >&2
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
