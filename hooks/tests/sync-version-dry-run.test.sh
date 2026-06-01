#!/usr/bin/env bash
# sync-version --dry-run: prints proposed diff, writes nothing.
. "$(dirname "$0")/lib.sh"

# Snapshot the canonical file before invocation
CANONICAL="$REPO_ROOT/.claude-plugin/plugin.json"
BEFORE_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')

out=$(node "$REPO_ROOT/scripts/sync-version.js" --version 9.9.9 --hook-count 19 --skill-count 16 --opt-in-count 7 --dry-run 2>&1)
ec=$?

assert_exit_code "$ec" 0 "dry-run exits 0"
assert_contains "$out" "DRY RUN" "dry-run banner present"
assert_contains "$out" "WOULD_CHANGE" "dry-run reports proposed changes"

AFTER_HASH=$(sha1sum "$CANONICAL" | awk '{print $1}')
assert_eq "$AFTER_HASH" "$BEFORE_HASH" "canonical file byte-identical after dry-run"

finalize_test
