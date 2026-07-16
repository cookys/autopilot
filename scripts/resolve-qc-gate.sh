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

# shellcheck source=lib/json-emit.sh
. "$(dirname "$0")/lib/json-emit.sh"
# shellcheck source=lib/resolve-config.sh
. "$(dirname "$0")/lib/resolve-config.sh"

# --- locate the config file (4-tier -r ladder) ---
resolve_config_ladder "qc-gate-config.md" "QC_GATE_CONFIG_OVERRIDE" "fail-closed-default"

MODE="$(read_field "$CONFIG" mode "$DEF_MODE")"
PATHS="$(read_field "$CONFIG" protected_paths "$DEF_PATHS")"
EVIDENCE="$(read_field "$CONFIG" evidence "$DEF_EVIDENCE")"

# Normalize the CSV: strip whitespace around commas + ends, so the natural human
# spacing `skills/, agents/` does NOT yield a leading-space element that the hook's
# prefix match would silently never match (fail-OPEN). Consumers get clean CSV.
PATHS="$(printf '%s' "$PATHS" | sed -E 's/[[:space:]]*,[[:space:]]*/,/g; s/^[[:space:]]+//; s/[[:space:]]+$//')"

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
  "$MODE" "$(json_escape "$PATHS")" "$EVIDENCE" "$SOURCE"
