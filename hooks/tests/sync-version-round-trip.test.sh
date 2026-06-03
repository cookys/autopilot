#!/usr/bin/env bash
# sync-version round-trip in a sandboxed mini-repo. Forward bump to 9.9.9,
# confirm --check clean, reverse bump to original, confirm byte-identity
# across all 5 tracked files. Live repo files are never touched.
. "$(dirname "$0")/lib.sh"

SANDBOX="$TEST_TMP/sandbox"
SCRIPT=$(setup_sync_version_sandbox "$SANDBOX")

TRACKED=(
  "$SANDBOX/.claude-plugin/plugin.json"
  "$SANDBOX/.claude-plugin/marketplace.json"
  "$SANDBOX/plugin.json"
  "$SANDBOX/README.md"
  "$SANDBOX/hooks/README.md"
)

# Hash everything pre-bump (these are the round-trip targets we'll compare against).
declare -A PRE_HASH=()
for f in "${TRACKED[@]}"; do
  PRE_HASH["$f"]=$(sha1sum "$f" | awk '{print $1}')
done

ORIG=$(grep -oE '"version":\s*"[0-9]+\.[0-9]+\.[0-9]+"' "$SANDBOX/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
assert_neq "$ORIG" "" "original version parseable from sandbox canonical"

# Derive the count args FROM the fixture's own description so the round-trip is
# count-agnostic — otherwise this test silently goes red every time the live
# skill/hook count changes (it did at v2.9.0 when skills went 16→17, and the
# hardcoded `--skill-count 16` here was never updated). Parse the same fragments
# sync-version.js itself matches.
SKILLS=$(grep -oE '[0-9]+ lifecycle skills' "$SANDBOX/.claude-plugin/plugin.json" | head -1 | grep -oE '^[0-9]+')
HFRAG=$(grep -oE '[0-9]+ hooks \([0-9]+ default-on, [0-9]+ opt-in\)' "$SANDBOX/.claude-plugin/plugin.json" | head -1)
HOOKS=$(printf '%s' "$HFRAG" | grep -oE '^[0-9]+')
OPTIN=$(printf '%s' "$HFRAG" | grep -oE '[0-9]+ opt-in' | grep -oE '^[0-9]+')
assert_neq "$SKILLS" "" "skill-count parseable from sandbox canonical"
assert_neq "$HOOKS" "" "hook-count parseable from sandbox canonical"
assert_neq "$OPTIN" "" "opt-in-count parseable from sandbox canonical"

# Forward bump
node "$SCRIPT" --version 9.9.9 --hook-count "$HOOKS" --skill-count "$SKILLS" --opt-in-count "$OPTIN" >/dev/null 2>&1
assert_exit_code "$?" 0 "forward bump succeeded"
node "$SCRIPT" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "mirrors in sync after forward bump"

# Reverse bump back to original
node "$SCRIPT" --version "$ORIG" --hook-count "$HOOKS" --skill-count "$SKILLS" --opt-in-count "$OPTIN" >/dev/null 2>&1
assert_exit_code "$?" 0 "reverse bump succeeded"

# Byte-identity check across all 5 tracked files
for f in "${TRACKED[@]}"; do
  after=$(sha1sum "$f" | awk '{print $1}')
  assert_eq "$after" "${PRE_HASH[$f]}" "round-trip byte-identity: $(basename "$f")"
done

# Live repo unchanged
node "$REPO_ROOT/scripts/sync-version.js" --check >/dev/null 2>&1
assert_exit_code "$?" 0 "live repo --check still clean (no live mutation)"

finalize_test
