#!/usr/bin/env bash
# sync-version rejects bogus hook-count / opt-in-count combinations.
. "$(dirname "$0")/lib.sh"

CANONICAL="$REPO_ROOT/.claude-plugin/plugin.json"
BEFORE_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')

# hook-count zero → invalid (script asserts integer 1..100)
out=$(node "$REPO_ROOT/scripts/sync-version.js" --version 9.9.9 --hook-count 0 --skill-count 16 --opt-in-count 7 2>&1)
ec=$?
assert_neq "$ec" "0" "hook-count=0 rejected"
assert_contains "$out" "hook-count" "error message names hook-count"

# opt-in-count >= hook-count → invalid
out2=$(node "$REPO_ROOT/scripts/sync-version.js" --version 9.9.9 --hook-count 19 --skill-count 16 --opt-in-count 19 2>&1)
ec2=$?
assert_neq "$ec2" "0" "opt-in-count == hook-count rejected"
assert_contains "$out2" "opt-in-count" "error message names opt-in-count"

AFTER_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')
assert_eq "$AFTER_HASH" "$BEFORE_HASH" "no files touched on either validation fail"

finalize_test
