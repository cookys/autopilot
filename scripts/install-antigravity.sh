#!/usr/bin/env bash
# install-antigravity.sh — register autopilot as an Antigravity (`agy`) plugin.
#
# verified-against: agy 1.0.1 empirical, 2026-05-29 (NOT the codelabs walkthrough —
# that described a loose ~/.gemini/antigravity/skills/ path which is NOT how agy's
# plugin mechanism works; see references/multi-agent-portability.md).
#
# Real agy plugin model (agy 1.0.1):
#   - `agy plugin validate <path>`  → reads ROOT plugin.json; reports skills/agents/hooks
#   - `agy plugin install <path>`   → imports the repo as a claude-code-source plugin
#                                      (reads .claude-plugin/plugin.json for source detection)
#   - `agy plugin list`             → shows the imports registry
#   - `agy plugin uninstall <name>` → removes it
#
# This script validates then installs. Idempotent-ish: if already imported,
# agy install re-imports (no error). Uninstall with: agy plugin uninstall autopilot

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v agy >/dev/null 2>&1; then
  echo "ERROR: agy (Antigravity CLI) not found on PATH." >&2
  echo "       Install Antigravity first: https://antigravity.google/" >&2
  exit 1
fi

# Root plugin.json is required by `agy plugin validate` (verified: removing it
# yields 'Error: missing plugin.json'). Fail early with a clear message.
if [ ! -f "$REPO/plugin.json" ]; then
  echo "ERROR: $REPO/plugin.json missing — agy validate requires the root manifest." >&2
  echo "       Run: node scripts/sync-version.js --check  (and re-sync if it reports drift)" >&2
  exit 1
fi

echo "== validate =="
agy plugin validate "$REPO"

echo ""
echo "== install =="
agy plugin install "$REPO"

echo ""
echo "== verify =="
agy plugin list
echo ""
echo "autopilot registered as an agy plugin. To remove: agy plugin uninstall autopilot"
