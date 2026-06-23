#!/usr/bin/env bash
# resolve-qc-gate.sh — resolve the per-project qc-gate forcing-function config → JSON.
# Single source of truth consulted by .githooks/pre-push and finish-flow, so the
# anti-skip policy lives in one place (sibling of resolve-doa.sh).
#
# Usage:
#   scripts/resolve-qc-gate.sh            # emit resolved config JSON
#   scripts/resolve-qc-gate.sh --field mode   # emit just one field (raw, for shell)
#
# Order of precedence (first existing file wins):
#   1. $QC_GATE_CONFIG_OVERRIDE
#   2. $PWD/.claude/qc-gate-config.md         (consuming project's cwd)
#   3. $REPO_ROOT/.claude/qc-gate-config.md   (autopilot's own repo, dogfood)
#   4. project-config-template/qc-gate-config.md  (shipped default)
#   5. Fail-closed built-in: mode=block, protected_paths as below
#
# Output: JSON {mode, protected_paths, evidence, source}
#   mode ∈ {block, warn, off}; evidence ∈ {trailer, artifact, either}
#   source ∈ {override, project-cwd, project-repo, template, fail-closed-default}
#
# Exit codes:
#   0  success (JSON or --field value on stdout)
#   2  usage / bad argument

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Fail-closed built-in defaults (used if no config file is found or a field is absent)
DEF_MODE="block"
DEF_PATHS="skills/,agents/,scripts/,references/,hooks/"
DEF_EVIDENCE="trailer"

FIELD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# --- locate the config file ---
CONFIG=""
SOURCE="fail-closed-default"
if [[ -n "${QC_GATE_CONFIG_OVERRIDE:-}" && -r "${QC_GATE_CONFIG_OVERRIDE:-}" ]]; then
  CONFIG="$QC_GATE_CONFIG_OVERRIDE"; SOURCE="override"
elif [[ -r "$PWD/.claude/qc-gate-config.md" ]]; then
  CONFIG="$PWD/.claude/qc-gate-config.md"; SOURCE="project-cwd"
elif [[ -r "$REPO_ROOT/.claude/qc-gate-config.md" ]]; then
  CONFIG="$REPO_ROOT/.claude/qc-gate-config.md"; SOURCE="project-repo"
elif [[ -r "$REPO_ROOT/project-config-template/qc-gate-config.md" ]]; then
  CONFIG="$REPO_ROOT/project-config-template/qc-gate-config.md"; SOURCE="template"
fi

# --- parse a `- key: value` (or `key: value`) line from the config's Settings block ---
# Only reads the first match; tolerates leading "- " and surrounding whitespace.
read_field() { # key default
  local key="$1" def="$2" val=""
  if [[ -n "$CONFIG" ]]; then
    val="$(grep -iE "^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:" "$CONFIG" 2>/dev/null \
            | head -1 | sed -E "s/^[[:space:]]*-?[[:space:]]*${key}[[:space:]]*:[[:space:]]*//I" \
            | sed -E 's/[[:space:]]+$//')"
  fi
  [[ -z "$val" ]] && val="$def"
  printf '%s' "$val"
}

MODE="$(read_field mode "$DEF_MODE")"
PATHS="$(read_field protected_paths "$DEF_PATHS")"
EVIDENCE="$(read_field evidence "$DEF_EVIDENCE")"

# --- validate enums; fall back fail-closed on garbage ---
case "$MODE" in block|warn|off) ;; *) MODE="$DEF_MODE" ;; esac
case "$EVIDENCE" in trailer|artifact|either) ;; *) EVIDENCE="$DEF_EVIDENCE" ;; esac

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    mode) printf '%s\n' "$MODE" ;;
    protected_paths) printf '%s\n' "$PATHS" ;;
    evidence) printf '%s\n' "$EVIDENCE" ;;
    source) printf '%s\n' "$SOURCE" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "mode": "%s", "protected_paths": "%s", "evidence": "%s", "source": "%s" }\n' \
  "$MODE" "$PATHS" "$EVIDENCE" "$SOURCE"
