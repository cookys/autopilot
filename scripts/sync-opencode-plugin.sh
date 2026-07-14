#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/platforms/opencode/plugin"
TARGET="$ROOT/.opencode/plugin-package"
MODE="sync"

if [[ "${1:-}" = "--check" ]]; then
  MODE="check"
elif [[ $# -gt 0 ]]; then
  echo "Usage: scripts/sync-opencode-plugin.sh [--check]" >&2
  exit 2
fi

build() {
  local dest="$1"
  mkdir -p "$dest/core"
  cp "$SOURCE/autopilot.ts" "$dest/autopilot.ts"
  cp "$SOURCE/package.json" "$dest/package.json"
  cp "$ROOT/src/hooks/handlers/intent-capture.js" "$dest/core/intent-capture.cjs"
  cp "$ROOT/src/hooks/normalize/opencode.js" "$dest/core/opencode.cjs"
}

if [[ "$MODE" = "check" ]]; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  build "$TMP/plugin-package"
  if [[ ! -d "$TARGET" ]] || ! diff -ruN --exclude=node_modules "$TMP/plugin-package" "$TARGET"; then
    echo "OpenCode plugin payload drift detected; run scripts/sync-opencode-plugin.sh" >&2
    exit 1
  fi
  echo "OpenCode plugin payload is in sync"
  exit 0
fi

rm -rf "$TARGET"
build "$TARGET"
echo "Synced OpenCode plugin payload: $TARGET"
