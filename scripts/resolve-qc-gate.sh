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
# Output: JSON {mode, protected_paths, evidence, source, outcome, outcome_rerun, outcome_sample, outcome_budget_s}
#   mode ∈ {block, warn, off}; evidence ∈ {trailer, artifact, either}
#   source ∈ {override, project-cwd, project-repo, template, fail-closed-default}
#   outcome ∈ {off, warn, block}, default off. AUTOPILOT_QC_OUTCOME wins over the file.
#   An unknown outcome value (file or env) resolves to off and names itself on stderr
#   (opt-in fail-safe; mode still fails closed). AUTOPILOT_QC_OUTCOME=off while the file
#   says warn or block prints one stderr line that the outcome stage is skipped.
#   outcome_rerun ∈ {sample, all, none}, default sample (anything else → sample).
#   outcome_sample: non-negative integer, default 20. outcome_budget_s: positive integer, default 600.
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

# outcome is opt-in: unknown → off (the opposite of mode). Env wins over the file.
FILE_OUTCOME="$(read_field "$CONFIG" outcome "")"
OUTCOME="off"
if [ -n "${AUTOPILOT_QC_OUTCOME+x}" ]; then
  case "$AUTOPILOT_QC_OUTCOME" in
    off|warn|block)
      OUTCOME="$AUTOPILOT_QC_OUTCOME"
      if [ "$AUTOPILOT_QC_OUTCOME" = "off" ] && { [ "$FILE_OUTCOME" = "warn" ] || [ "$FILE_OUTCOME" = "block" ]; }; then
        printf 'resolve-qc-gate: outcome stage is skipped by AUTOPILOT_QC_OUTCOME=off\n' >&2
      fi
      ;;
    *)
      printf 'resolve-qc-gate: outcome value '\''%s'\'' is not off|warn|block; fell back to off\n' "$AUTOPILOT_QC_OUTCOME" >&2
      OUTCOME="off"
      ;;
  esac
else
  case "$FILE_OUTCOME" in
    ""|off) OUTCOME="off" ;;
    warn|block) OUTCOME="$FILE_OUTCOME" ;;
    *)
      printf 'resolve-qc-gate: outcome value '\''%s'\'' is not off|warn|block; fell back to off\n' "$FILE_OUTCOME" >&2
      OUTCOME="off"
      ;;
  esac
fi

OUTCOME_RERUN="$(read_field "$CONFIG" outcome_rerun "sample")"
case "$OUTCOME_RERUN" in sample|all|none) ;; *) OUTCOME_RERUN="sample" ;; esac

OUTCOME_SAMPLE="$(read_field "$CONFIG" outcome_sample "20")"
[[ "$OUTCOME_SAMPLE" =~ ^[0-9]+$ ]] || OUTCOME_SAMPLE="20"

OUTCOME_BUDGET_S="$(read_field "$CONFIG" outcome_budget_s "600")"
[[ "$OUTCOME_BUDGET_S" =~ ^[1-9][0-9]*$ ]] || OUTCOME_BUDGET_S="600"

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    mode) printf '%s\n' "$MODE" ;;
    protected_paths) printf '%s\n' "$PATHS" ;;
    evidence) printf '%s\n' "$EVIDENCE" ;;
    source) printf '%s\n' "$SOURCE" ;;
    outcome) printf '%s\n' "$OUTCOME" ;;
    outcome_rerun) printf '%s\n' "$OUTCOME_RERUN" ;;
    outcome_sample) printf '%s\n' "$OUTCOME_SAMPLE" ;;
    outcome_budget_s) printf '%s\n' "$OUTCOME_BUDGET_S" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "mode": "%s", "protected_paths": "%s", "evidence": "%s", "source": "%s", "outcome": "%s", "outcome_rerun": "%s", "outcome_sample": %s, "outcome_budget_s": %s }\n' \
  "$MODE" "$(json_escape "$PATHS")" "$EVIDENCE" "$SOURCE" "$OUTCOME" "$OUTCOME_RERUN" "$OUTCOME_SAMPLE" "$OUTCOME_BUDGET_S"
