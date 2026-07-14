#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$ROOT/platforms/opencode/plugin"

command -v opencode2 >/dev/null 2>&1 || {
  echo "Error: opencode2 not found on PATH" >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "Error: npm not found on PATH" >&2
  exit 1
}

EXPECTED="$(node -p "require('$PACKAGE/package.json').dependencies['@opencode-ai/plugin']")"
ACTUAL="$(opencode2 --version 2>/dev/null | awk '{print $NF}' | sed 's/^v//')"
if [[ "$ACTUAL" != "$EXPECTED" && "${AUTOPILOT_OPENCODE_ALLOW_VERSION_MISMATCH:-0}" != "1" ]]; then
  echo "Error: OpenCode2 version mismatch: installed $ACTUAL, extension targets $EXPECTED" >&2
  echo "Run the smoke probe and update the extension pin, or set AUTOPILOT_OPENCODE_ALLOW_VERSION_MISMATCH=1 for an explicit local probe." >&2
  exit 1
fi

"$ROOT/scripts/setup-symlinks.sh"
(cd "$PACKAGE" && npm install)
"$ROOT/scripts/sync-opencode-plugin.sh"

echo "Installed Autopilot OpenCode V2 extension"
echo "Package: $PACKAGE"
echo "Project config: $ROOT/.opencode/opencode.json"
echo "Verify: bash $ROOT/hooks/tests/opencode-v2-plugin.test.sh"
