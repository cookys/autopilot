#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

if ! command -v opencode >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] opencode not found"
  exit 0
fi

# The repo's own .opencode package files must survive this suite untouched: opencode
# installs/updates @opencode-ai/plugin into whichever .opencode dir it finds from cwd.
OC_PKG_BEFORE="$(cat "$REPO_ROOT/.opencode/package.json" "$REPO_ROOT/.opencode/package-lock.json" | sha256sum)"

# Regenerate the .opencode/plugin-package mirror that the opencode loader reads.
"$REPO_ROOT/scripts/sync-opencode-plugin.sh" >/dev/null

# Plugin load is observed through scripts/lib/opencode-discovery-probe.js, which sandboxes the run
# (HOME + XDG_* + OPENCODE_* all private, project = a COPY of the consumer layer, never the repo:
# opencode installs/rewrites package files in whichever .opencode it finds) and picks the adaptor
# from `opencode --version`:
#   1.x  `opencode debug config --print-logs` loads plugins eagerly and prints the plugin's stderr.
#   2.x  `debug config` goes through the machine-wide background service (fixed port, the caller's
#        env ignored) and loads nothing; the probe starts a private `opencode serve`, and the plugin's
#        `setup()` runs there. AUTOPILOT_PLUGIN_SMOKE=1 makes setup() exercise the intent-capture path.
probe_plugin() { # <bin> <root> <log> -> prints probe JSON
  node "$REPO_ROOT/scripts/lib/opencode-discovery-probe.js" --bin "$1" --repo "$REPO_ROOT" --root "$2" \
    --env AUTOPILOT_PLUGIN_SMOKE=1 --log-file "$3"
}

assert_plugin_run() { # <label> <bin> <root>
  local label="$1" bin="$2" root="$3" log="$3.log" out intent_file intent project
  out="$(probe_plugin "$bin" "$root" "$log")" || { assert_eq "rc!=0: $out" "ok" "$label probe runs"; return; }
  PLUGIN_VERSION="$(node -p "require('$REPO_ROOT/.claude-plugin/plugin.json').version")"
  CONFIG_LOG="$(cat "$log")"
  assert_contains "$CONFIG_LOG" '[autopilot] plugin loaded' "$label: OpenCode executes plugin setup"
  assert_contains "$CONFIG_LOG" "version: $PLUGIN_VERSION" "$label: plugin reads repository version"

  intent_file="$(find "$root/home/.autopilot/intent" -type f -name '*.json' -print -quit 2>/dev/null)"
  assert_neq "$intent_file" "" "$label: plugin setup writes isolated smoke intent"
  if [ -n "$intent_file" ]; then
    intent="$(cat "$intent_file")"
    project="$(cd "$root/project" && pwd -P)"
    assert_contains "$intent" '"session_id": "autopilot-smoke"' "$label: smoke intent identifies plugin probe"
    assert_contains "$intent" '"last_tool": "autopilot_smoke"' "$label: smoke intent exercises capture path"
    assert_contains "$intent" "\"cwd\": \"$project\"" "$label: smoke intent records project directory"
  fi
}

assert_plugin_run "installed opencode" opencode "$TEST_TMP/probe-installed"

# opencode 1.x may still be installed next to 2.x (the old tool keeps working: same plugin file,
# its `server()` entry point). Run the same assertions against it when present.
V1_BIN="${OPENCODE_V1_BIN:-$HOME/.opencode/bin/opencode1}"
if [ -x "$V1_BIN" ]; then
  assert_plugin_run "opencode 1.x" "$V1_BIN" "$TEST_TMP/probe-v1"
else
  echo "SKIP [$TEST_NAME] opencode 1.x binary not found ($V1_BIN): v1 half not run"
fi

# Static field-mapping guard: AUTOPILOT_PLUGIN_SMOKE calls captureIntent directly and
# bypasses tool.execute.after, so a renamed hookInput.args (etc.) would not fail the
# smoke path. Assert the canonical source still wires the real hook fields.
PLUGIN_SRC="$(cat "$REPO_ROOT/platforms/opencode/plugin/server.ts")"
assert_contains "$PLUGIN_SRC" 'tool.execute.after' \
  "canonical plugin registers tool.execute.after hook"
assert_contains "$PLUGIN_SRC" 'hookInput.args' \
  "tool.execute.after maps hookInput.args into capture"
assert_contains "$PLUGIN_SRC" 'hookInput.tool' \
  "tool.execute.after maps hookInput.tool into capture"
assert_contains "$PLUGIN_SRC" 'hookInput.sessionID' \
  "tool.execute.after maps hookInput.sessionID into capture"
assert_contains "$PLUGIN_SRC" 'captureIntent(hookInput.tool, hookInput.args, hookInput.sessionID)' \
  "tool.execute.after passes hook fields to captureIntent"
# opencode 2.x registers through setup(context) + context.tool.hook("execute.after") and its event
# carries the tool arguments as `input`, not `args`: assert the v2 mapping separately.
assert_contains "$PLUGIN_SRC" 'setup: async (context' \
  "canonical plugin exports the 2.x setup() entry point"
assert_contains "$PLUGIN_SRC" 'context.tool.hook("execute.after"' \
  "setup() registers context.tool.hook execute.after"
assert_contains "$PLUGIN_SRC" 'captureIntent(toolEvent.tool, toolEvent.input, toolEvent.sessionID)' \
  "2.x tool event fields (tool, input, sessionID) reach captureIntent"

OC_PKG_AFTER="$(cat "$REPO_ROOT/.opencode/package.json" "$REPO_ROOT/.opencode/package-lock.json" | sha256sum)"
assert_eq "$OC_PKG_AFTER" "$OC_PKG_BEFORE" "repo .opencode package.json + lock byte-identical after suite"

finalize_test
