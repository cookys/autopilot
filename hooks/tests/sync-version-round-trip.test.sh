#!/usr/bin/env bash
# sync-version round-trip: bump canonical to 9.9.9, confirm mirrors all match,
# bump back to the original, confirm restoration. Snapshots every file the
# script edits so we can verify byte-identity after the round-trip.
. "$(dirname "$0")/lib.sh"

TRACKED=(
  "$REPO_ROOT/.claude-plugin/plugin.json"
  "$REPO_ROOT/.claude-plugin/marketplace.json"
  "$REPO_ROOT/plugin.json"
  "$REPO_ROOT/README.md"
)
declare -A BACKUPS=()
for f in "${TRACKED[@]}"; do
  BACKUPS["$f"]="$TEST_TMP/$(basename "$f").bak"
  cp "$f" "${BACKUPS[$f]}"
done
restore_all() { for f in "${TRACKED[@]}"; do cp "${BACKUPS[$f]}" "$f"; done; }
trap 'restore_all' EXIT INT TERM

# Capture the original canonical version
ORIG=$(grep -oE '"version":\s*"[0-9]+\.[0-9]+\.[0-9]+"' "$REPO_ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
assert_neq "$ORIG" "" "original version parseable"

# Forward bump
node "$REPO_ROOT/scripts/sync-version.js" --version 9.9.9 --hook-count 19 --skill-count 16 --opt-in-count 7 >/dev/null 2>&1
assert_exit_code "$?" 0 "forward bump succeeded"
node "$REPO_ROOT/scripts/sync-version.js" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "mirrors in sync after forward bump"

# Reverse bump back to original
node "$REPO_ROOT/scripts/sync-version.js" --version "$ORIG" --hook-count 19 --skill-count 16 --opt-in-count 7 >/dev/null 2>&1
assert_exit_code "$?" 0 "reverse bump succeeded"

# Byte-identity check
for f in "${TRACKED[@]}"; do
  after_hash=$(sha1sum "$f" | awk '{print $1}')
  before_hash=$(sha1sum "${BACKUPS[$f]}" | awk '{print $1}')
  assert_eq "$after_hash" "$before_hash" "round-trip byte-identity: $(basename "$f")"
done

restore_all
trap - EXIT INT TERM

finalize_test
