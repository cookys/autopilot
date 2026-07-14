#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

if ! command -v opencode2 >/dev/null 2>&1; then
  echo "SKIP [$TEST_NAME] opencode2 not found"
  exit 0
fi

"$REPO_ROOT/scripts/sync-opencode-plugin.sh" >/dev/null

PORT="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
LOG="$TEST_TMP/server.log"
HOME="$HOOK_HOME" AUTOPILOT_PLUGIN_SMOKE=1 opencode2 serve --hostname 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!

cleanup_server() {
  kill "$SERVER_PID" 2>/dev/null || true
  pkill -P "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap 'cleanup_server; cleanup_test_tmp' EXIT

PASSWORD=""
for _ in $(seq 1 100); do
  PASSWORD="$(sed -n 's/^server password //p' "$LOG" | head -1)"
  [ -n "$PASSWORD" ] && break
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.1
done

assert_neq "$PASSWORD" "" "server emits authentication password"

PLUGINS="$(curl --silent --show-error --max-time 20 -u "opencode:$PASSWORD" \
  -G --data-urlencode "directory=$REPO_ROOT" \
  "http://127.0.0.1:$PORT/api/plugin" 2>&1)"
CURL_EXIT=$?
assert_eq "$CURL_EXIT" "0" "plugin list completes without setup deadlock"

SESSION="$(curl --silent --show-error --max-time 20 -u "opencode:$PASSWORD" \
  -X POST -H 'Content-Type: application/json' \
  -d "{\"location\":{\"directory\":\"$REPO_ROOT\"}}" \
  "http://127.0.0.1:$PORT/api/session" 2>&1)"
CURL_EXIT=$?
assert_eq "$CURL_EXIT" "0" "session creation completes without plugin setup deadlock"
assert_contains "$SESSION" '"id":"ses_' "session creation returns an ID"

for _ in $(seq 1 50); do
  find "$HOOK_HOME/.autopilot/intent" -type f -name '*.json' -print -quit 2>/dev/null | grep -q . && break
  sleep 0.1
done

INTENT_FILE="$(find "$HOOK_HOME/.autopilot/intent" -type f -name '*.json' -print -quit 2>/dev/null)"
assert_neq "$INTENT_FILE" "" "plugin setup writes isolated smoke intent"
if [ -n "$INTENT_FILE" ]; then
  INTENT="$(cat "$INTENT_FILE")"
  assert_contains "$INTENT" '"session_id": "autopilot-smoke"' "smoke intent identifies plugin probe"
  assert_contains "$INTENT" '"last_tool": "autopilot_smoke"' "smoke intent exercises capture path"
  assert_contains "$INTENT" "\"cwd\": \"$REPO_ROOT\"" "smoke intent records project directory"
fi

SERVER_LOG="$(cat "$LOG")"
assert_contains "$SERVER_LOG" '[autopilot] plugin loaded' "OpenCode V2 executes plugin setup"
PLUGIN_VERSION="$(node -p "require('$REPO_ROOT/.claude-plugin/plugin.json').version")"
assert_contains "$SERVER_LOG" "version: $PLUGIN_VERSION" "plugin reads repository version"

cleanup_server
finalize_test
