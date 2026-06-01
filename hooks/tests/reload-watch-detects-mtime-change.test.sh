#!/usr/bin/env bash
# reload-watch happy path: when a watched config file's mtime changes between
# invocations, the hook emits a "Plugin catalog signal changed" warning to
# stderr. First-cwd invocations silently init (no spam); only subsequent
# changes fire the reminder.
. "$(dirname "$0")/lib.sh"

# Watched files (mirrored from hooks/reload-watch.js WATCH_FILES). Of these,
# the one that lives under HOME is the easiest to control inside the sandbox.
INSTALLED="$HOOK_HOME/.claude/plugins/installed_plugins.json"
STATE_FILE="$HOOK_HOME/.claude/plugins/.reload-watch-state.json"
mkdir -p "$(dirname "$INSTALLED")"
echo '{}' > "$INSTALLED"

# First run: silent init (no warning) + state file created.
run_hook reload-watch.js '{}'
assert_exit_code "$__RUN_EXIT" 0 "first-run exit 0"
assert_file_exists "$STATE_FILE" "state file created on first run"
assert_not_contains "$__RUN_STDERR" "Plugin catalog signal changed" "first run silent (no warning)"

# Bump mtime: change the installed_plugins.json content + touch it forward.
echo '{"plugins":{"autopilot@autopilot":[]}}' > "$INSTALLED"
touch -d "1 minute ago" "$STATE_FILE" 2>/dev/null || touch -A -60 "$STATE_FILE"
# Ensure the watched file's mtime is now > state's tracked mtime
touch "$INSTALLED"

# Second run: detects the change → warning to stderr
run_hook reload-watch.js '{}'
assert_exit_code "$__RUN_EXIT" 0 "second-run exit 0 (fail-open contract still holds)"
assert_contains "$__RUN_STDERR" "Plugin catalog signal changed" "warning emitted on detected change"
assert_contains "$__RUN_STDERR" "/reload-plugins" "reminder mentions the fix command"

finalize_test
