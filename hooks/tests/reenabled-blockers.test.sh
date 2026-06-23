#!/usr/bin/env bash
# reenabled-blockers.test.sh — positive block/allow behavior for the three
# PreToolUse hooks re-enabled (opt-in) by the /dev/stdin → fd-0 read fix.
#
# These hooks were parked by the v2.7.4 disable batch because opening the
# '/dev/stdin' PATH throws ENXIO in the Bun-spawned hook environment (#6305).
# The fix reads fd 0 directly. run_hook feeds stdin via a here-string (fd 0),
# so this exercises the fd-0 read path AND the block/allow logic.
#
# NOTE: a here-string makes fd 0 a real readable file, so this cannot reproduce
# the production ENXIO; it guards the read pattern + decision logic. The ENXIO
# delivery itself is verified e2e against live Claude Code (see CHANGELOG).
#
# Assertions run in the main shell (no subshells — those can't update the
# lib.sh bookkeeping arrays). cwd is saved/restored around git-repo hooks.

. "$(dirname "$0")/lib.sh"

START_PWD="$PWD"
mkgit() { mkdir -p "$1"; cd "$1"; git init -q -b "$2"; git config user.email t@t; git config user.name t; }

# ---- large-file-warner: PreToolUse/Read ----
BIG="$TEST_TMP/big.bin"; head -c $((3 * 1024 * 1024)) /dev/zero > "$BIG"
SMALL="$TEST_TMP/small.txt"; echo "hi" > "$SMALL"

run_hook "large-file-warner.js" "{\"tool_input\":{\"file_path\":\"$BIG\"}}"
assert_exit_code "$__RUN_EXIT" "2" "large-file-warner blocks a 3MB Read"
assert_contains "$__RUN_STDERR" "BLOCKED" "large-file-warner emits BLOCKED"

run_hook "large-file-warner.js" "{\"tool_input\":{\"file_path\":\"$SMALL\"}}"
assert_exit_code "$__RUN_EXIT" "0" "large-file-warner allows a small Read"

run_hook "large-file-warner.js" "{\"tool_input\":{\"file_path\":\"$BIG\",\"offset\":0,\"limit\":10}}"
assert_exit_code "$__RUN_EXIT" "0" "large-file-warner bypasses when offset/limit set"

# ---- branch-protection: PreToolUse/Bash (runs git in cwd) ----
mkgit "$TEST_TMP/repo-main" main
echo a > f; git add f; git commit -qm init

run_hook "branch-protection.js" '{"tool_input":{"command":"git commit -m x"}}'
assert_exit_code "$__RUN_EXIT" "2" "branch-protection blocks commit on main"
assert_contains "$__RUN_STDERR" "protected branch" "branch-protection names the protected branch"

git checkout -q -b feature/x
run_hook "branch-protection.js" '{"tool_input":{"command":"git commit -m x"}}'
assert_exit_code "$__RUN_EXIT" "0" "branch-protection allows commit on a feature branch"

run_hook "branch-protection.js" '{"tool_input":{"command":"ls -la"}}'
assert_exit_code "$__RUN_EXIT" "0" "branch-protection ignores non-git commands"

# ---- commit-secret-scan: PreToolUse/Bash (scans staged diff) ----
mkgit "$TEST_TMP/repo-secret" feature
printf 'key = "AKIAIOSFODNN7EXAMPLE"\n' > creds.txt; git add creds.txt
run_hook "commit-secret-scan.js" '{"tool_input":{"command":"git commit -m x"}}'
assert_exit_code "$__RUN_EXIT" "2" "commit-secret-scan blocks commit with a staged AWS key"
assert_contains "$__RUN_STDERR" "secrets" "commit-secret-scan reports the secret"

mkgit "$TEST_TMP/repo-clean" feature
echo "clean code" > app.js; git add app.js
run_hook "commit-secret-scan.js" '{"tool_input":{"command":"git commit -m x"}}'
assert_exit_code "$__RUN_EXIT" "0" "commit-secret-scan allows a clean commit"

cd "$START_PWD"
finalize_test
