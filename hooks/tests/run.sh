#!/usr/bin/env bash
# hooks/tests/run.sh — umbrella runner for autopilot's hook test suite.
#
# Discovers and runs:
#   - L1 unit tests: `node --test` on hooks/*.test.js + scripts/*.test.js
#   - L2 integration tests: every hooks/tests/*.test.sh + scripts/*.test.sh file
#
# Exit 0 only if every layer passes. Per-file pass/fail summary at the end.
#
# Usage:
#   bash hooks/tests/run.sh              # run everything
#   bash hooks/tests/run.sh state-checkpoint   # filter (substring match on file)

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_DIR="$(cd "$TESTS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$HOOKS_DIR/.." && pwd)"
cd "$REPO_ROOT"

FILTER="${1:-}"
TOTAL=0
FAILED=0
declare -a FAILED_TESTS=()

run_one() {
  local file="$1"
  local rel="${file#$REPO_ROOT/}"
  TOTAL=$((TOTAL + 1))
  if [ -n "$FILTER" ] && [[ "$rel" != *"$FILTER"* ]]; then
    TOTAL=$((TOTAL - 1))
    return
  fi
  echo ""
  echo "──────── $rel ────────"
  if bash "$file"; then
    : # PASS line printed by finalize_test
  else
    FAILED=$((FAILED + 1))
    FAILED_TESTS+=("$rel")
  fi
}

# ── L1 unit tests via node --test ──
# Node's test runner reports its own pass/fail.
echo "════════ L1 unit tests (node --test) ════════"
# scripts/*.test.js rides the same node --test pass — scripts-side unit tests
# used to live outside every scan glob and never ran in CI (found 2026-07-16).
shopt -s nullglob
UNIT_FILES=("$HOOKS_DIR"/*.test.js "$REPO_ROOT"/scripts/*.test.js)
shopt -u nullglob
if [ "${#UNIT_FILES[@]}" -eq 0 ]; then
  echo "(no L1 unit tests yet)"
else
  if [ -n "$FILTER" ]; then
    # Filter unit files too
    FILTERED=()
    for f in "${UNIT_FILES[@]}"; do
      case "$f" in *"$FILTER"*) FILTERED+=("$f");; esac
    done
    UNIT_FILES=("${FILTERED[@]}")
  fi
  if [ "${#UNIT_FILES[@]}" -gt 0 ]; then
    TOTAL=$((TOTAL + ${#UNIT_FILES[@]}))
    if ! node --test "${UNIT_FILES[@]}"; then
      FAILED=$((FAILED + 1))
      FAILED_TESTS+=("L1 unit suite")
    fi
  else
    # Filter matched nothing — neutral
    :
  fi
fi

# ── L2 integration tests ──
echo ""
echo "════════ L2 integration tests (*.test.sh) ════════"
shopt -s nullglob
NON_EXEC=()
for file in "$TESTS_DIR"/*.test.sh; do
  if [ ! -x "$file" ]; then
    NON_EXEC+=("${file#$REPO_ROOT/}")
  fi
done
if [ "${#NON_EXEC[@]}" -gt 0 ]; then
  echo "ERROR: shell test files must be executable:" >&2
  for rel in "${NON_EXEC[@]}"; do
    echo "   - $rel" >&2
  done
  shopt -u nullglob
  exit 1
fi
for file in "$TESTS_DIR"/*.test.sh; do
  run_one "$file"
done
# scripts/*.test.sh — same never-scanned gap as the L1 note above.
for file in "$REPO_ROOT"/scripts/*.test.sh; do
  run_one "$file"
done
shopt -u nullglob

# ── Summary ──
echo ""
echo "════════ Summary ════════"
if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED ($TOTAL test files)"
  exit 0
else
  echo "❌ $FAILED / $TOTAL test files FAILED:"
  for t in "${FAILED_TESTS[@]}"; do echo "   - $t"; done
  exit 1
fi
