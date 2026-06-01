#!/usr/bin/env bash
# sync-version rejects a non-semver version string and exits non-zero.
. "$(dirname "$0")/lib.sh"

CANONICAL="$REPO_ROOT/.claude-plugin/plugin.json"
BEFORE_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')

out=$(node "$REPO_ROOT/scripts/sync-version.js" --version notsemver --hook-count 19 --skill-count 16 --opt-in-count 7 2>&1)
ec=$?

assert_neq "$ec" "0" "invalid version → non-zero exit"
assert_contains "$out" "invalid version" "error message names the problem"

AFTER_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')
assert_eq "$AFTER_HASH" "$BEFORE_HASH" "no files touched on validation fail"

finalize_test
