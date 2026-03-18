#!/usr/bin/env bash
# dev-setup.sh — Set up autopilot plugin in development mode.
# Points Claude Code's plugin registry directly at this repo (no cache copy).
# Changes to skills take effect immediately — no reinstall needed.
#
# Usage:
#   cd ~/projects/autopilot   # or wherever you cloned it
#   ./scripts/dev-setup.sh

set -euo pipefail

MARKETPLACE_NAME="autopilot"
PLUGIN_KEY="autopilot@autopilot"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
INSTALLED_JSON="$CLAUDE_DIR/plugins/installed_plugins.json"
KNOWN_MARKETPLACES="$CLAUDE_DIR/plugins/known_marketplaces.json"

# Validate we're in the right repo
if [[ ! -f "$REPO_DIR/.claude-plugin/plugin.json" ]]; then
  echo "Error: .claude-plugin/plugin.json not found in $REPO_DIR" >&2
  exit 1
fi

if [[ ! -f "$INSTALLED_JSON" ]]; then
  echo "Error: $INSTALLED_JSON not found — is Claude Code installed?" >&2
  exit 1
fi

# ── Step 1: Register marketplace in known_marketplaces.json ──

python3 -c "
import json, os, datetime

path = '$KNOWN_MARKETPLACES'
repo_dir = '$REPO_DIR'
name = '$MARKETPLACE_NAME'
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

if os.path.exists(path):
    with open(path) as f:
        d = json.load(f)
else:
    d = {}

if name in d and d[name].get('installLocation') == repo_dir:
    pass  # already correct
else:
    d[name] = {
        'source': {
            'source': 'local',
            'path': repo_dir
        },
        'installLocation': repo_dir,
        'lastUpdated': now
    }
    with open(path, 'w') as f:
        json.dump(d, f, indent=2)
    print(f'Marketplace registered: {name} → {repo_dir}')
"

# ── Step 2: Register plugin in installed_plugins.json ──

# Check if already registered
if python3 -c "
import json, sys
with open('$INSTALLED_JSON') as f:
    d = json.load(f)
entries = d.get('plugins', {}).get('$PLUGIN_KEY', [])
for e in entries:
    if e.get('installPath') == '$REPO_DIR':
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
  echo "Already in dev mode: $PLUGIN_KEY → $REPO_DIR"
  exit 0
fi

python3 -c "
import json, datetime

path = '$INSTALLED_JSON'
repo = '$REPO_DIR'
key = '$PLUGIN_KEY'
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'

with open(path) as f:
    d = json.load(f)

entry = {
    'scope': 'user',
    'installPath': repo,
    'version': 'dev',
    'installedAt': now,
    'lastUpdated': now,
    'gitCommitSha': 'dev'
}

if key in d.get('plugins', {}):
    d['plugins'][key] = [entry]
else:
    d.setdefault('plugins', {})[key] = [entry]

with open(path, 'w') as f:
    json.dump(d, f, indent=2)
"

echo "Done: $PLUGIN_KEY → $REPO_DIR (version: dev)"
echo "Restart Claude Code or run /reload-plugins to activate."
