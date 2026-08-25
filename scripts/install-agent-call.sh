#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$ROOT/packages/agent-call"
command -v node >/dev/null 2>&1 || { echo "error: Node.js is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "error: npm is required" >&2; exit 1; }
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$major" =~ ^[0-9]+$ ]] || (( major < 22 )); then
  echo "error: agent-call requires Node.js 22 or newer" >&2
  exit 1
fi
npm install --prefix "$PACKAGE" --ignore-scripts
npm install --global "$PACKAGE"
echo "Installed agent-call from $PACKAGE"
echo "Run: agent-call --help"
