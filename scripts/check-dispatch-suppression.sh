#!/usr/bin/env bash
# check-dispatch-suppression.sh — anti-gaming linter for ANY methodology-agent
# dispatch prompt (round-1 included, unlike check-redispatch-prompt.sh which is
# round-2+ only). Catches the *controller-corrupts-reviewer* class: a dispatcher
# telling the reviewer what to ignore, or pre-rating a finding's severity, to
# game the gate. Enforces the "no severity-coaching / no suppression" rule in
# references/blind-dispatch.md (Doubt-theater / anti-gaming pre-flight).
#
# Sibling of check-redispatch-prompt.sh (round-cycle leakage) — DIFFERENT class:
# leakage = "you saw this last round"; suppression = "don't flag this / call it
# minor". A prompt can be blind-safe yet still coach the reviewer to go soft.
#
# Usage:
#   scripts/check-dispatch-suppression.sh <prompt-file>     # exit 1 if coaching
#   scripts/check-dispatch-suppression.sh -                 # read prompt from stdin
#   echo "..." | scripts/check-dispatch-suppression.sh -    # same
#   scripts/check-dispatch-suppression.sh --help
#
# Exit codes:
#   0  prompt is coaching-free (clean)
#   1  prompt contains one or more suppression / severity-coaching phrases (stderr)
#   2  usage error

set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <prompt-file>|- (or --help)" >&2
  exit 2
fi

if [[ "$1" == "-" ]]; then
  PROMPT="$(cat)"
elif [[ -f "$1" ]]; then
  PROMPT="$(cat "$1")"
else
  echo "no such file: $1" >&2
  exit 2
fi

# Suppression / severity-coaching patterns. Each non-comment line is ONE ERE
# pattern, matched case-insensitively. Anchored to imperative-suppression grammar
# (an instruction to the reviewer), NOT bare severity-word proximity — so honest
# calibration prose ("don't over-flag minor nits") does NOT trip it.
#
PATTERNS=$(cat <<'EOF'
# --- pre-rating a finding's severity (coaching the reviewer to go soft) ---
# "call it Minor", "rate the null-deref low", "mark this trivial", "treat that as a suggestion".
# NOTE the verb set EXCLUDES "grade" — "grade each finding critical/major/minor" is the legit
# instruction to use the vocabulary, not to pre-rate a specific finding.
(call|rate|mark|score|keep|downgrade|treat)[[:space:]]+(it|this|that|them|the[[:space:]]+[a-z][a-z-]*([[:space:]]+[a-z][a-z-]*){0,2})[[:space:]]+(as[[:space:]]+)?(a[[:space:]]+|an[[:space:]]+)?(at[[:space:]]+(most|worst)[[:space:]]+|no[[:space:]]+more[[:space:]]+than[[:space:]]+|only[[:space:]]+)?(critical|major|minor|suggestion|trivial|cosmetic|low|nit)\b
# "...at most a minor" / "at worst a suggestion"
\bat[[:space:]]+(most|worst)[[:space:]]+(a[[:space:]]+|an[[:space:]]+)?(minor|suggestion|trivial|cosmetic|nit|note|low)\b
# --- suppressing a defect outright ("don't flag the X as a bug", "do not report this issue") ---
# anchored to a DEFECT object so honest scope statements don't trip; "over-flag" has the "over-"
# prefix so "don't over-flag" never matches "don'?t flag".
(do[[:space:]]+not|don'?t|never|no[[:space:]]+need[[:space:]]+to)[[:space:]]+(flag|report|raise|surface|count|treat|mention)[^.]{0,45}(as[[:space:]]+)?(a[[:space:]]+|an[[:space:]]+)?(defect|bug|issue|problem|finding|blocker|vuln|critical|major)\b
# --- "ignore the <area>" (telling the reviewer to skip a surface) ---
\bignore[[:space:]]+(the[[:space:]]+|any[[:space:]]+|all[[:space:]]+)?[a-z][a-z -]*(path|case|cases|error|handling|section|module|check|branch|finding|issue)\b
# --- "don't worry about / don't bother with <X>" ---
(don'?t|do[[:space:]]+not)[[:space:]]+(worry[[:space:]]+about|bother[[:space:]]+with|sweat)[[:space:]]+
EOF
)

hits=0
matched_phrases=()

while IFS= read -r pat; do
  [[ -z "$pat" || "${pat:0:1}" == "#" ]] && continue
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    hits=$((hits + 1))
    matched_phrases+=("$match")
  done < <(printf '%s' "$PROMPT" | grep -oEi "$pat" 2>/dev/null || true)
done <<< "$PATTERNS"

if [[ $hits -gt 0 ]]; then
  {
    echo "COACHING: dispatch prompt contains $hits suppression/severity-coaching marker(s):"
    for m in "${matched_phrases[@]}"; do
      echo "  - $m"
    done
    echo ""
    echo "See references/blind-dispatch.md (anti-gaming pre-flight)."
    echo "A dispatcher must not tell the reviewer what to ignore or pre-rate severity."
  } >&2
  exit 1
fi

echo "CLEAN: no suppression/severity-coaching markers found." >&2
exit 0
