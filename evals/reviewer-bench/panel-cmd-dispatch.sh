#!/usr/bin/env bash
# panel-cmd-dispatch.sh — Adapter for dispatch-review.sh review panel
# Usage: panel-cmd-dispatch.sh <runner> <model>

set -uo pipefail

if [ $# -lt 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <runner> <model>" >&2
  exit 1
fi

RUNNER="$1"
MODEL="$2"

# Resolve repo root robustly from the script's own path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DISPATCH_SCRIPT="$REPO_ROOT/scripts/dispatch-review.sh"

if [ ! -f "$DISPATCH_SCRIPT" ]; then
  echo "panel-cmd-dispatch: dispatch-review.sh not found at $DISPATCH_SCRIPT" >&2
  echo "panel-cmd-dispatch: no verdict (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

DIFF_TEMP="$(mktemp -t panel-cmd-dispatch-diff-XXXXXX)"
DISPATCH_OUT="$(mktemp -t panel-cmd-dispatch-out-XXXXXX)"
DISPATCH_ERR="$(mktemp -t panel-cmd-dispatch-err-XXXXXX)"

cleanup() {
  rm -f "$DIFF_TEMP" "$DISPATCH_OUT" "$DISPATCH_ERR"
}
trap cleanup EXIT

# Read diff from stdin
cat > "$DIFF_TEMP"

# Run dispatch-review.sh
"$DISPATCH_SCRIPT" --runner "$RUNNER" --model "$MODEL" --diff-file "$DIFF_TEMP" > "$DISPATCH_OUT" 2> "$DISPATCH_ERR"
DISPATCH_RC=$?

# Pass through any stderr output from the dispatch script
cat "$DISPATCH_ERR" >&2

# Check for dispatch execution failure
if [ "$DISPATCH_RC" -ne 0 ]; then
  echo "panel-cmd-dispatch: dispatch failure (fail-closed)" >&2
  echo '{"verdict":"fail"}'
  exit 0
fi

# Parse the verdict from the JSON output of dispatch-review.sh
if grep -q '"verdict"[[:space:]]*:[[:space:]]*"SHIP-AS-IS"' "$DISPATCH_OUT"; then
  echo '{"verdict":"pass"}'
elif grep -q '"verdict"[[:space:]]*:[[:space:]]*"FIX-THEN-SHIP"' "$DISPATCH_OUT"; then
  echo '{"verdict":"fail"}'
else
  echo "panel-cmd-dispatch: no verdict (fail-closed)" >&2
  cat "$DISPATCH_OUT" >&2
  echo '{"verdict":"fail"}'
fi
