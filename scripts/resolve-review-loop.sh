#!/usr/bin/env bash
# resolve-review-loop.sh — resolve the per-project review-loop engine roster + loop
# policy → JSON. Turns the hand-typed "/l5 generation-adversarial heterogeneous"
# prompt into DATA consumed by /l5 (ceo-agent level-front-door). Sibling of
# resolve-qc-gate.sh / resolve-doa.sh — same precedence chain.
#
# Usage:
#   scripts/resolve-review-loop.sh                 # emit resolved config JSON
#   scripts/resolve-review-loop.sh --field reviewer_engine   # one raw field (for shell)
#
# Order of precedence (first existing file wins):
#   1. $REVIEW_LOOP_CONFIG_OVERRIDE
#   2. $PWD/.claude/review-loop-config.md          (consuming project's cwd)
#   3. $REPO_ROOT/.claude/review-loop-config.md    (autopilot's own repo, dogfood)
#   4. project-config-template/review-loop-config.md  (shipped default)
#   5. Built-in defaults below
#
# Output: JSON {reviewer_engine, reviewer_effort, reviewer_runner,
#   implementer_engine, implementer_effort, implementer_runner,
#   loop_max_rounds, loop_convergence_verdict, spec_review, independent_harness, source}
#
# Exit codes: 0 success / 2 usage.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Built-in defaults (the user's stated good-loop roster; agy is NOT the default
# implementer because it corrupts the autopilot repo — see config gotchas).
DEF_REV_ENGINE="gpt-5.5"
DEF_REV_EFFORT="xhigh"
DEF_REV_RUNNER="codex"
DEF_IMPL_ENGINE="gpt-5.3-codex-spark"
DEF_IMPL_EFFORT="high"
DEF_IMPL_RUNNER="auto"
DEF_MAX_ROUNDS="5"
DEF_CONVERGE="SHIP-AS-IS"
DEF_SPEC_REVIEW="on"
DEF_HARNESS="on"

FIELD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --field) FIELD="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

CONFIG=""
SOURCE="builtin-default"
if [[ -n "${REVIEW_LOOP_CONFIG_OVERRIDE:-}" && -r "${REVIEW_LOOP_CONFIG_OVERRIDE:-}" ]]; then
  CONFIG="$REVIEW_LOOP_CONFIG_OVERRIDE"; SOURCE="override"
elif [[ -r "$PWD/.claude/review-loop-config.md" ]]; then
  CONFIG="$PWD/.claude/review-loop-config.md"; SOURCE="project-cwd"
elif [[ -r "$REPO_ROOT/.claude/review-loop-config.md" ]]; then
  CONFIG="$REPO_ROOT/.claude/review-loop-config.md"; SOURCE="project-repo"
elif [[ -r "$REPO_ROOT/project-config-template/review-loop-config.md" ]]; then
  CONFIG="$REPO_ROOT/project-config-template/review-loop-config.md"; SOURCE="template"
fi

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

REV_ENGINE="$(read_field reviewer_engine "$DEF_REV_ENGINE")"
REV_EFFORT="$(read_field reviewer_effort "$DEF_REV_EFFORT")"
REV_RUNNER="$(read_field reviewer_runner "$DEF_REV_RUNNER")"
IMPL_ENGINE="$(read_field implementer_engine "$DEF_IMPL_ENGINE")"
IMPL_EFFORT="$(read_field implementer_effort "$DEF_IMPL_EFFORT")"
IMPL_RUNNER="$(read_field implementer_runner "$DEF_IMPL_RUNNER")"
MAX_ROUNDS="$(read_field loop_max_rounds "$DEF_MAX_ROUNDS")"
CONVERGE="$(read_field loop_convergence_verdict "$DEF_CONVERGE")"
SPEC_REVIEW="$(read_field spec_review "$DEF_SPEC_REVIEW")"
HARNESS="$(read_field independent_harness "$DEF_HARNESS")"

# Validate enums; fall back to defaults on garbage (fail toward the safe roster).
case "$REV_RUNNER" in codex|auto|agy) ;; *) REV_RUNNER="$DEF_REV_RUNNER" ;; esac
case "$REV_EFFORT" in low|medium|high|xhigh|max) ;; *) REV_EFFORT="$DEF_REV_EFFORT" ;; esac
case "$IMPL_EFFORT" in low|medium|high|xhigh|max) ;; *) IMPL_EFFORT="$DEF_IMPL_EFFORT" ;; esac
case "$IMPL_RUNNER" in auto|codex|agy) ;; *) IMPL_RUNNER="$DEF_IMPL_RUNNER" ;; esac
case "$SPEC_REVIEW" in on|off) ;; *) SPEC_REVIEW="$DEF_SPEC_REVIEW" ;; esac
case "$HARNESS" in on|off) ;; *) HARNESS="$DEF_HARNESS" ;; esac
[[ "$MAX_ROUNDS" =~ ^[0-9]+$ ]] || MAX_ROUNDS="$DEF_MAX_ROUNDS"

json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

if [[ -n "$FIELD" ]]; then
  case "$FIELD" in
    reviewer_engine) printf '%s\n' "$REV_ENGINE" ;;
    reviewer_effort) printf '%s\n' "$REV_EFFORT" ;;
    reviewer_runner) printf '%s\n' "$REV_RUNNER" ;;
    implementer_engine) printf '%s\n' "$IMPL_ENGINE" ;;
    implementer_effort) printf '%s\n' "$IMPL_EFFORT" ;;
    implementer_runner) printf '%s\n' "$IMPL_RUNNER" ;;
    loop_max_rounds) printf '%s\n' "$MAX_ROUNDS" ;;
    loop_convergence_verdict) printf '%s\n' "$CONVERGE" ;;
    spec_review) printf '%s\n' "$SPEC_REVIEW" ;;
    independent_harness) printf '%s\n' "$HARNESS" ;;
    source) printf '%s\n' "$SOURCE" ;;
    *) echo "unknown field: $FIELD" >&2; exit 2 ;;
  esac
  exit 0
fi

printf '{ "reviewer_engine": "%s", "reviewer_effort": "%s", "reviewer_runner": "%s", "implementer_engine": "%s", "implementer_effort": "%s", "implementer_runner": "%s", "loop_max_rounds": %s, "loop_convergence_verdict": "%s", "spec_review": "%s", "independent_harness": "%s", "source": "%s" }\n' \
  "$(json_escape "$REV_ENGINE")" "$REV_EFFORT" "$REV_RUNNER" \
  "$(json_escape "$IMPL_ENGINE")" "$IMPL_EFFORT" "$IMPL_RUNNER" \
  "$MAX_ROUNDS" "$(json_escape "$CONVERGE")" "$SPEC_REVIEW" "$HARNESS" "$SOURCE"
