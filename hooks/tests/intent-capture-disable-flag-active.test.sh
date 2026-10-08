#!/usr/bin/env bash
# intent-capture: a FRESH disable flag stamped with the CURRENT plugin version
# must suppress the intent write. Hook still exits 0 (fail-open).
. "$(dirname "$0")/lib.sh"

# Look up the current canonical version so the flag matches.
# Read through the shared semver grammar so pre-release canonicals (3.0.0-alpha.1) are not truncated.
CURRENT_VERSION=$(node "$REPO_ROOT/scripts/lib/semver.js" from-json "$REPO_ROOT/.claude-plugin/plugin.json" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
assert_neq "$CURRENT_VERSION" "" "canonical version parseable for flag stamp"

mkdir -p "$HOOK_HOME/.autopilot"
DISABLE_FLAG="$HOOK_HOME/.autopilot/intent-capture.disabled"
printf '{"disabled_at":"%s","plugin_version":"%s","reason":"unit-injected"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CURRENT_VERSION" > "$DISABLE_FLAG"

payload='{"session_id":"active","tool_name":"Bash","tool_input":{"command":"x"}}'
run_hook intent-capture.js "$payload"

assert_exit_code "$__RUN_EXIT" 0 "exit 0 with active flag (fail-open)"
assert_file_exists "$DISABLE_FLAG" "active flag NOT cleared"

# No intent file should be written while the flag is active.
intent_count=$(find "$HOOK_HOME/.autopilot/intent" -maxdepth 1 -name '*.json' 2>/dev/null | wc -l)
assert_eq "$intent_count" "0" "intent write suppressed by active disable flag"

finalize_test
