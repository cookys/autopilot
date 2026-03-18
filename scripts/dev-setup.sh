#!/usr/bin/env bash
# dev-setup.sh — Set up autopilot plugin in development mode.
#
# Prerequisite: install the plugin once via the normal flow:
#   /plugin marketplace add cookys/autopilot
#   /plugin install autopilot@autopilot
#
# This script then replaces the cached copy with a symlink to your local clone,
# so edits take effect immediately without reinstall.
#
# Usage:
#   cd ~/projects/autopilot   # or wherever you cloned it
#   ./scripts/dev-setup.sh

set -euo pipefail

MARKETPLACE_NAME="autopilot"
PLUGIN_NAME="autopilot"
PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_NAME}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
INSTALLED_JSON="$CLAUDE_DIR/plugins/installed_plugins.json"
CACHE_BASE="$CLAUDE_DIR/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME"

# ── Validate ──

if [[ ! -f "$REPO_DIR/.claude-plugin/plugin.json" ]]; then
  echo "Error: .claude-plugin/plugin.json not found in $REPO_DIR" >&2
  exit 1
fi

if [[ ! -f "$INSTALLED_JSON" ]]; then
  echo "Error: $INSTALLED_JSON not found — is Claude Code installed?" >&2
  exit 1
fi

# Check if plugin was ever installed via /plugin install
if ! python3 -c "
import json, sys
with open('$INSTALLED_JSON') as f:
    d = json.load(f)
if '$PLUGIN_KEY' not in d.get('plugins', {}):
    sys.exit(1)
" 2>/dev/null; then
  echo "Error: $PLUGIN_KEY not found in installed_plugins.json." >&2
  echo "" >&2
  echo "First install the plugin via the normal flow:" >&2
  echo "  /plugin marketplace add cookys/autopilot" >&2
  echo "  /plugin install autopilot@autopilot" >&2
  echo "" >&2
  echo "Then re-run this script to switch to dev mode." >&2
  exit 1
fi

# ── Check if already in dev mode ──

DEV_LINK="$CACHE_BASE/dev"
if [[ -L "$DEV_LINK" && "$(readlink -f "$DEV_LINK")" == "$(readlink -f "$REPO_DIR")" ]]; then
  # Check if installed_plugins.json also points here
  if python3 -c "
import json, sys
with open('$INSTALLED_JSON') as f:
    d = json.load(f)
entries = d.get('plugins', {}).get('$PLUGIN_KEY', [])
for e in entries:
    if e.get('installPath') == '$DEV_LINK':
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    echo "Already in dev mode: $PLUGIN_KEY → $REPO_DIR"
    exit 0
  fi
fi

# ── Create symlink in cache ──

mkdir -p "$CACHE_BASE"
# Remove existing dev entry (symlink or directory)
rm -rf "$DEV_LINK"
ln -s "$REPO_DIR" "$DEV_LINK"
echo "Symlink: $DEV_LINK → $REPO_DIR"

# ── Update installed_plugins.json to point to dev symlink ──

python3 -c "
import json, datetime

path = '$INSTALLED_JSON'
dev_link = '$DEV_LINK'
key = '$PLUGIN_KEY'
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

with open(path) as f:
    d = json.load(f)

entry = {
    'scope': 'user',
    'installPath': dev_link,
    'version': 'dev',
    'installedAt': now,
    'lastUpdated': now,
    'gitCommitSha': 'dev'
}

d['plugins'][key] = [entry]

with open(path, 'w') as f:
    json.dump(d, f, indent=2)
"

echo ""
echo "Done: $PLUGIN_KEY → $REPO_DIR (version: dev)"
echo "Restart Claude Code or run /reload-plugins to activate."
echo ""
echo "To revert to release version:"
echo "  /plugin update autopilot@autopilot"
