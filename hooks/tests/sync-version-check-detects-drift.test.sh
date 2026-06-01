#!/usr/bin/env bash
# sync-version --check detects drift between canonical and mirror.
# Runs inside a sandbox copy of the manifest tree (lib.sh setup_sync_version_sandbox)
# so the live repo files are never touched, even on SIGKILL / concurrent runs.
. "$(dirname "$0")/lib.sh"

SANDBOX="$TEST_TMP/sandbox"
SCRIPT=$(setup_sync_version_sandbox "$SANDBOX")

# Sanity: a fresh sandbox is in sync (canonical → mirror unchanged copy).
node "$SCRIPT" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "fresh sandbox --check is clean"

# Bump the mirror's version so it disagrees with canonical
perl -i -pe 's/"version":\s*"[^"]+"/"version": "0.0.0-drift-test"/' "$SANDBOX/plugin.json"

out=$(node "$SCRIPT" --check 2>&1)
ec=$?

assert_neq "$ec" "0" "--check detects drift (non-zero exit)"
assert_contains "$out" "DRIFT DETECTED" "drift banner present"

# Live repo files were NOT touched.
node "$REPO_ROOT/scripts/sync-version.js" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "live repo --check still clean (no live mutation)"

finalize_test
