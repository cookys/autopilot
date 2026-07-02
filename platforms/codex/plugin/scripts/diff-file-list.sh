#!/usr/bin/env bash
# diff-file-list.sh — emit changed-file list as a Verified Clean checklist.
# Removes the LLM-from-memory file enumeration step in reviewer Verified Clean
# output (`agents/reviewer.md`).
#
# Usage:
#   scripts/diff-file-list.sh                  # changed since merge-base with develop/main
#   scripts/diff-file-list.sh staged           # staged diff only
#   scripts/diff-file-list.sh range A..B       # explicit range
#
# Output: one markdown checklist line per file, ready to paste into the
# reviewer's `### ✅ Verified Clean` section.

set -euo pipefail

MODE="${1:-changed}"

case "$MODE" in
  changed)
    BASE="$(git merge-base HEAD develop 2>/dev/null || git merge-base HEAD main 2>/dev/null || git rev-parse HEAD~1)"
    git diff --name-only "$BASE"...HEAD 2>/dev/null
    ;;
  staged)
    git diff --cached --name-only --diff-filter=ACMR 2>/dev/null
    ;;
  range)
    [[ -z "${2:-}" ]] && { echo "usage: $0 range A..B" >&2; exit 2; }
    git diff --name-only --diff-filter=ACMR "$2" 2>/dev/null
    ;;
  -h|--help)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *)
    echo "usage: $0 [changed|staged|range A..B]" >&2; exit 2 ;;
esac | awk 'NF { print "- [ ] " $0 " — " }'
