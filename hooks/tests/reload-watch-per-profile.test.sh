#!/usr/bin/env bash
# reload-watch keeps its watched installed_plugins.json and its state file under
# the session's Claude config dir ($CLAUDE_CONFIG_DIR, else $HOME/.claude), so two
# login profiles on one OS account never share one state file: a change to
# profile A's installed_plugins.json is reported to A's session and does not touch B's state.
. "$(dirname "$0")/lib.sh"
unset CLAUDE_CONFIG_DIR

A="$TEST_TMP/profile-a"; B="$TEST_TMP/profile-b"
mkdir -p "$A/plugins" "$B/plugins" "$HOOK_HOME/.claude/plugins"
echo '{}' > "$A/plugins/installed_plugins.json"
echo '{}' > "$B/plugins/installed_plugins.json"

run_profile() { # $1 = config dir or empty (unset)
  if [ -n "$1" ]; then
    CLAUDE_CONFIG_DIR="$1" HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" node "$HOOKS_DIR/reload-watch.js" </dev/null >"$TEST_TMP/o" 2>"$TEST_TMP/e"
  else
    HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" node "$HOOKS_DIR/reload-watch.js" </dev/null >"$TEST_TMP/o" 2>"$TEST_TMP/e"
  fi
  __ERR="$(cat "$TEST_TMP/e")"
}

# Init both profiles.
run_profile "$A"; run_profile "$B"
assert_file_exists "$A/plugins/.reload-watch-state.json" "state for A lives in A's config dir"
assert_file_exists "$B/plugins/.reload-watch-state.json" "state for B lives in B's config dir"
assert_file_absent "$HOOK_HOME/.claude/plugins/.reload-watch-state.json" "no state leaks into HOME/.claude when the env names a profile"

B_STATE_BEFORE="$(cat "$B/plugins/.reload-watch-state.json")"
echo '{"plugins":{"x@y":[]}}' > "$A/plugins/installed_plugins.json"; touch -d "1 minute ago" "$A/plugins/.reload-watch-state.json"; touch "$A/plugins/installed_plugins.json"

run_profile "$A"
assert_contains "$__ERR" "Plugin catalog signal changed" "A's session is told about A's change"
run_profile "$B"
assert_not_contains "$__ERR" "Plugin catalog signal changed" "B's session is not told about A's change"
assert_eq "$(cat "$B/plugins/.reload-watch-state.json")" "$B_STATE_BEFORE" "B's state untouched by A's change"

# Unset env: identical paths to before ($HOME/.claude).
run_profile ""
assert_file_exists "$HOOK_HOME/.claude/plugins/.reload-watch-state.json" "unset env uses HOME/.claude"

finalize_test
