#!/usr/bin/env bash
# verify-preexisting.sh — classify a test failure as PRE_EXISTING vs INTRODUCED.
# Replaces the fragile prose recipe at test-policy.md:42-52
# (git stash + checkout develop + restore).
#
# Usage:
#   scripts/verify-preexisting.sh '<test-command>' [--base develop|main|<ref>]
#
# Output: JSON {head, base, verdict}
#   verdict = PRE_EXISTING | INTRODUCED | NO_FAILURE | INCONCLUSIVE
#
# Exit codes:
#   0   verdict reached (any)
#   2   usage / setup error
#
# Safety: stashes uncommitted work before checkout; pops on exit (incl. errors).

set -euo pipefail

TEST_CMD="${1:-}"
[[ -z "$TEST_CMD" ]] && { echo "usage: $0 '<test-command>' [--base <ref>]" >&2; exit 2; }
shift

BASE="develop"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Sanity
if ! git rev-parse --verify "$BASE" >/dev/null 2>&1; then
  echo "base ref not found: $BASE" >&2
  exit 2
fi

ORIG="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || git rev-parse HEAD)"
STASHED=0

cleanup() {
  # always try to return to original ref, then pop stash
  git checkout --quiet "$ORIG" 2>/dev/null || true
  [[ $STASHED -eq 1 ]] && git stash pop --quiet 2>/dev/null || true
}
trap cleanup EXIT

# Stash if dirty
if ! git diff --quiet || ! git diff --cached --quiet; then
  git stash push -u -m "verify-preexisting:$$" --quiet
  STASHED=1
fi

# Run on HEAD (i.e., current ORIG, post-stash)
if eval "$TEST_CMD" >/dev/null 2>&1; then
  HEAD_RESULT="pass"
else
  HEAD_RESULT="fail"
fi

if [[ "$HEAD_RESULT" == "pass" ]]; then
  printf '{"head":"pass","base":"unknown","verdict":"NO_FAILURE"}\n'
  exit 0
fi

# Switch to base and run
if ! git checkout --quiet "$BASE" 2>/dev/null; then
  printf '{"head":"fail","base":"unknown","verdict":"INCONCLUSIVE","reason":"cannot-checkout-base"}\n'
  exit 0
fi

if eval "$TEST_CMD" >/dev/null 2>&1; then
  BASE_RESULT="pass"
else
  BASE_RESULT="fail"
fi

case "$BASE_RESULT" in
  fail) VERDICT="PRE_EXISTING" ;;
  pass) VERDICT="INTRODUCED" ;;
esac

printf '{"head":"%s","base":"%s","verdict":"%s"}\n' "$HEAD_RESULT" "$BASE_RESULT" "$VERDICT"
