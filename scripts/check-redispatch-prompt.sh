#!/usr/bin/env bash
# check-redispatch-prompt.sh — leaky-phrase linter for round-2+ methodology-agent
# re-dispatch prompts. Enforces the dispatcher pre-flight checklist documented in
# references/blind-dispatch.md (Dispatcher pre-flight checklist).
#
# Usage:
#   scripts/check-redispatch-prompt.sh <prompt-file>           # exit 1 if leaky
#   scripts/check-redispatch-prompt.sh -                       # read prompt from stdin
#   echo "..." | scripts/check-redispatch-prompt.sh -          # same
#
# Exit codes:
#   0  prompt is blind-safe
#   1  prompt contains one or more leaky phrases (listed on stderr)
#   2  usage error

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <prompt-file>|-" >&2
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

# Patterns from references/blind-dispatch.md Dispatcher pre-flight checklist.
# Each line is one ERE pattern; matches are case-insensitive.
# Comments are stripped before grep.
PATTERNS=$(cat <<'EOF'
# round indicators
\bround[[:space:]]*[0-9]+\b
\bprevious[[:space:]]+review\b
\bpreviously[[:space:]]+flagged\b
\blast[[:space:]]+cycle\b
\bbefore[[:space:]]+the[[:space:]]+fix\b
# fixer-applied markers
\bfixer[[:space:]]+applied\b
\bpatched[[:space:]]+at[[:space:]]+line\b
\bfix[[:space:]]+just[[:space:]]+went[[:space:]]+in\b
# re-check / verify-fix
\bverify[[:space:]]+the[[:space:]]+fix\b
\bconfirm[[:space:]]+the[[:space:]]+patch\b
\bre-check\b
# anchor-to-prior-finding cues
\baround[[:space:]]+line[[:space:]]+[0-9]+\b
\bfocus[[:space:]]+on\b.*\b(null|race|deref|leak|injection|overflow)
# severity glyph + prior context
🔴
🟠
🟡
🔵
# severity tier names tied to prior verdict
\b(critical|major|important|minor|suggestion)\b.*\b(from|in)[[:space:]]+(round|the[[:space:]]+previous|last)
# round-cycle meta-signals (forbidden even when framed as "no leakage")
\bthis[[:space:]]+is[[:space:]]+a[[:space:]]+re-?review\b
\bre-?derive[[:space:]]+findings[[:space:]]+from[[:space:]]+scratch\b
\bno[[:space:]]+prior[[:space:]]+context[[:space:]]+is[[:space:]]+being[[:space:]]+passed\b
EOF
)

hits=0
matched_phrases=()

while IFS= read -r pat; do
  # skip comments and blank lines
  [[ -z "$pat" || "${pat:0:1}" == "#" ]] && continue
  # grep -E -i; -o so we can echo back exactly what matched
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    hits=$((hits + 1))
    matched_phrases+=("$match")
  done < <(printf '%s' "$PROMPT" | grep -oEi "$pat" 2>/dev/null || true)
done <<< "$PATTERNS"

# Also check for quoted-code excerpts. Heuristic: a fenced code block longer
# than ~2 lines OR an indented block of 4+ consecutive code-shaped lines is
# suspicious in a re-dispatch prompt (the original task description belongs
# in plain prose; quoted code usually means the dispatcher copy-pasted a
# previous finding's excerpt). This is a heuristic — flag for human review.
fenced=$(printf '%s' "$PROMPT" | awk '
  /^[[:space:]]*```/ { in_fence = !in_fence; if (in_fence) { start = NR; lines = 0; next } else { if (lines >= 2) print "fenced-code:" start "-" NR; next } }
  in_fence { lines++ }
' || true)
if [[ -n "$fenced" ]]; then
  hits=$((hits + 1))
  matched_phrases+=("quoted-code-block ($fenced)")
fi

if [[ $hits -gt 0 ]]; then
  {
    echo "LEAKY: re-dispatch prompt contains $hits forbidden marker(s):"
    for m in "${matched_phrases[@]}"; do
      echo "  - $m"
    done
    echo ""
    echo "See references/blind-dispatch.md Dispatcher pre-flight checklist."
    echo "Strip these before re-dispatching the reviewer/auditor."
  } >&2
  exit 1
fi

echo "BLIND-SAFE: no forbidden markers found." >&2
exit 0
