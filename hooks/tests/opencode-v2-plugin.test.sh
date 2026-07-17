#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

if ! command -v opencode >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] opencode not found"
  exit 0
fi

# Regenerate the .opencode/plugin-package mirror that the opencode loader reads.
"$REPO_ROOT/scripts/sync-opencode-plugin.sh" >/dev/null

# opencode 1.17's `serve` is unsecured by default (auth is via the OPENCODE_SERVER_PASSWORD
# env var; it emits no random "server password" line) and does not eagerly run plugin setup,
# so the opencode2-era serve + basic-auth + /api/session integration this test used no longer
# applies. Drive plugin load deterministically through `debug config`, which loads plugins
# (running the plugin's documented `server()` setup) and, with AUTOPILOT_PLUGIN_SMOKE=1,
# exercises the intent-capture path — the same observable behaviors, without the removed API.
REPO_REAL="$(cd "$REPO_ROOT" && pwd -P)"
mkdir -p "$HOOK_HOME"
LOG="$TEST_TMP/debug-config.log"
( cd "$REPO_REAL" && HOME="$HOOK_HOME" AUTOPILOT_PLUGIN_SMOKE=1 \
    opencode debug config --print-logs >"$LOG" 2>&1 )

CONFIG_LOG="$(cat "$LOG")"
assert_contains "$CONFIG_LOG" '[autopilot] plugin loaded' "OpenCode executes plugin setup"
PLUGIN_VERSION="$(node -p "require('$REPO_ROOT/.claude-plugin/plugin.json').version")"
assert_contains "$CONFIG_LOG" "version: $PLUGIN_VERSION" "plugin reads repository version"

INTENT_FILE="$(find "$HOOK_HOME/.autopilot/intent" -type f -name '*.json' -print -quit 2>/dev/null)"
assert_neq "$INTENT_FILE" "" "plugin setup writes isolated smoke intent"
if [ -n "$INTENT_FILE" ]; then
  INTENT="$(cat "$INTENT_FILE")"
  assert_contains "$INTENT" '"session_id": "autopilot-smoke"' "smoke intent identifies plugin probe"
  assert_contains "$INTENT" '"last_tool": "autopilot_smoke"' "smoke intent exercises capture path"
  assert_contains "$INTENT" "\"cwd\": \"$REPO_REAL\"" "smoke intent records project directory"
fi

finalize_test
