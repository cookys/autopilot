#!/usr/bin/env bash
# sync-agent-bodies — strip YAML frontmatter from agents/<role>.md, write body
# to agents/_bodies/<role>.body.md.
#
# Background (R4): agents/{reviewer,debugger,planner}.md have YAML frontmatter
# (name / tools / model) for Claude Code. OpenCode `{file:..}` references inline
# the file verbatim — frontmatter would leak into the agent prompt body. Solution:
# keep two copies — the canonical Claude Code form + a stripped body form for
# OpenCode to reference.
#
# Pre-commit gate (.githooks/pre-commit) runs this with --check to enforce
# bodies stay in sync after agents/<role>.md edits.
#
# UX: --check is read-only and explicit. If drift → user runs:
#   ./scripts/sync-agent-bodies.sh && git add agents/_bodies/ && git commit
#
# This is 3-step but transparent (no auto-stage surprises).

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$REPO/agents/_bodies"

CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

EXIT=0

for src in "$REPO"/agents/{reviewer,debugger,planner}.md; do
  name=$(basename "$src" .md)
  dst="$REPO/agents/_bodies/${name}.body.md"

  # Explicit state machine — survives body-internal `---` (markdown horizontal
  # rule), no-frontmatter files (fail loud), and blank lines after frontmatter.
  body=$(awk '
    BEGIN { state="start" }
    state=="start" && NR==1 && /^---$/ { state="in"; next }
    state=="start" && NR==1            { state="out" }                        # no frontmatter: print everything from line 1
    state=="in"    && /^---$/          { state="out"; next }                  # frontmatter closer
    state=="in"                        { next }                               # inside frontmatter — skip
    state=="out"                       { print }
  ' "$src")

  if [ -z "$body" ]; then
    echo "ERROR: $src has no body (or unclosed frontmatter)" >&2
    EXIT=2
    continue
  fi

  if [ "$CHECK" = "1" ]; then
    if ! diff -q <(printf '%s\n' "$body") "$dst" >/dev/null 2>&1; then
      echo "drift: $dst" >&2
      echo "  fix: ./scripts/sync-agent-bodies.sh && git add agents/_bodies/" >&2
      EXIT=1
    fi
  else
    printf '%s\n' "$body" > "$dst"
    echo "wrote: $dst ($(wc -l < "$dst") lines)"
  fi
done

exit "$EXIT"
