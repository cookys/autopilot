#!/usr/bin/env bash
# sync-version --check detects drift between canonical and mirror by editing
# the mirror (root plugin.json) in a temp working copy of the repo.
#
# We DON'T mutate the real repo here. Instead we create an isolated workspace
# inside $TEST_TMP that mirrors the manifest layout sync-version reads, then
# point the script at it via a child cwd. Since sync-version uses
# path.resolve(__dirname, '..') to find REPO_ROOT, an isolated workspace
# requires copying the script too. Simpler: snapshot the real mirrors, mutate
# one, run --check, then restore. Guard with set -e–style trap so a failure in
# the middle still restores the files.
. "$(dirname "$0")/lib.sh"

ROOT_MIRROR="$REPO_ROOT/plugin.json"
BACKUP="$TEST_TMP/plugin.json.bak"
cp "$ROOT_MIRROR" "$BACKUP"
restore() { cp "$BACKUP" "$ROOT_MIRROR"; }
trap 'restore' EXIT INT TERM

# Bump the mirror's version so it disagrees with canonical
perl -i -pe 's/"version":\s*"[^"]+"/"version": "0.0.0-drift-test"/' "$ROOT_MIRROR"

out=$(node "$REPO_ROOT/scripts/sync-version.js" --check 2>&1)
ec=$?

restore
trap - EXIT INT TERM

assert_neq "$ec" "0" "--check detects drift (non-zero exit)"
assert_contains "$out" "DRIFT DETECTED" "drift banner present"

# Post-restore sanity: --check is clean again
node "$REPO_ROOT/scripts/sync-version.js" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "--check clean again after restore"

finalize_test
