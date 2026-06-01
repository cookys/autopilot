#!/usr/bin/env bash
# sync-version --check on a clean tree exits 0 and announces "in sync".
. "$(dirname "$0")/lib.sh"

out=$(node "$REPO_ROOT/scripts/sync-version.js" --check 2>&1)
ec=$?

assert_exit_code "$ec" 0 "--check on clean state exits 0"
assert_contains "$out" "All mirrors in sync" "success banner present"

finalize_test
