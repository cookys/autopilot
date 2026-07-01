#!/usr/bin/env bash
# sync-version --dry-run: prints proposed diff, writes nothing. Verified against
# byte-identity of all tracked mirrors (sandboxed copy so the live repo is
# never at risk, mirroring -round-trip / -check-detects-drift).
. "$(dirname "$0")/lib.sh"

SANDBOX="$TEST_TMP/sandbox"
SCRIPT=$(setup_sync_version_sandbox "$SANDBOX")

TRACKED=(
  "$SANDBOX/.claude-plugin/plugin.json"
  "$SANDBOX/.claude-plugin/marketplace.json"
  "$SANDBOX/plugin.json"
  "$SANDBOX/platforms/codex/plugin/.codex-plugin/plugin.json"
  "$SANDBOX/README.md"
  "$SANDBOX/hooks/README.md"
)
declare -A BEFORE=()
for f in "${TRACKED[@]}"; do
  BEFORE["$f"]=$(sha1sum "$f" | awk '{print $1}')
done

out=$(node "$SCRIPT" --version 9.9.9 --hook-count 20 --skill-count 20 --opt-in-count 7 --disabled-count 5 --dry-run 2>&1)
ec=$?

assert_exit_code "$ec" 0 "dry-run exits 0"
assert_contains "$out" "DRY RUN" "dry-run banner present"
assert_contains "$out" "WOULD_CHANGE" "dry-run reports proposed changes"

# Byte-identity across every tracked mirror (catches a regression that mutates
# a single non-canonical file under --dry-run).
for f in "${TRACKED[@]}"; do
  after=$(sha1sum "$f" | awk '{print $1}')
  assert_eq "$after" "${BEFORE[$f]}" "$(basename "$f") byte-identical after --dry-run"
done

finalize_test
