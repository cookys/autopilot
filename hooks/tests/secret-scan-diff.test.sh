#!/usr/bin/env bash
# hooks/tests/secret-scan-diff.test.sh

. "$(dirname "$0")/lib.sh"

git init -q "$TEST_TMP/repo"
cd "$TEST_TMP/repo"
git config user.email "test@example.com"
git config user.name "Test"

echo "initial" > file.txt
git add file.txt
git commit -q -m "initial"

# Add secret
echo "sk-ant-1234567890123456789012345" >> file.txt
git add file.txt

OUT="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --staged)"
EXIT=$?

assert_eq "1" "$EXIT" "exit 1 on finding"
assert_contains "$OUT" "anthropic" "pattern name is anthropic"
assert_contains "$OUT" "sk-a…" "snippet is redacted (first 4 chars + …)"
assert_not_contains "$OUT" "sk-ant-1234567890123456789012345" "full secret is not in output"

git reset --hard -q
echo "no secret here" >> file.txt
git add file.txt
OUT2="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --staged)"
EXIT2=$?

assert_eq "0" "$EXIT2" "exit 0 when clean"

OUT3="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --range invalid..range 2>&1)"
EXIT3=$?
assert_eq "2" "$EXIT3" "exit 2 on git diff error (e.g. invalid range)"
# RED at dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6: exit 2,
# git diff failed with status 128: fatal: ambiguous argument 'invalid..range'...

# --- per-file streaming: 3 MiB clean add must not ENOBUFS ---
git init -q "$TEST_TMP/bigrepo"
cd "$TEST_TMP/bigrepo"
git config user.email "test@example.com"
git config user.name "Test"
echo "initial" > file.txt
git add file.txt
git commit -q -m "initial"
BASE_RANGE=$(git rev-parse HEAD)

head -c 3145728 /dev/zero | tr '\0' 'a' | fold -w 100 > big.txt
echo "AKIAIOSFODNN7EXAMPLE" > small-secret.txt
git add big.txt small-secret.txt
git commit -q -m "add mixed"

OUT_MIXED="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --range "${BASE_RANGE}..HEAD" 2>&1)"
EXIT_MIXED=$?
# RED at dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6: exit 2, git diff error: spawnSync git ENOBUFS
assert_eq "1" "$EXIT_MIXED" "exit 1 on planted key beside 3 MiB clean file"
assert_contains "$OUT_MIXED" "small-secret.txt" "finding names the small secret file"

git rm -q small-secret.txt
git commit -q -m "drop secret"
OUT_CLEAN="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --range "${BASE_RANGE}..HEAD" 2>&1)"
EXIT_CLEAN=$?
# RED at dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6: exit 2, git diff error: spawnSync git ENOBUFS
assert_eq "0" "$EXIT_CLEAN" "exit 0 when 3 MiB range has no secret"
assert_contains "$OUT_CLEAN" '"findings": []' "findings: [] when clean"

# Restore mixed commit for --files restriction (HEAD~1 is mixed)
OUT_FILES="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --range "${BASE_RANGE}..HEAD~1" --files big.txt 2>&1)"
EXIT_FILES=$?
# RED at dec4a01b423e9749a1f9a84a4a4f8c316f2e56b6: exit 0 + findings [] because
# --files overwrote mode (dropped the range) and scanned a clean worktree, not
# because the range was filtered to big.txt.
assert_eq "0" "$EXIT_FILES" "--files restricting to the clean 3 MiB file exits 0"

# --- quoted-paths: non-ASCII filename must not be C-quoted and skipped ---
git init -q "$TEST_TMP/quoterepo"
cd "$TEST_TMP/quoterepo"
git config user.email "test@example.com"
git config user.name "Test"
git config core.quotePath true
echo "initial" > file.txt
git add file.txt
git commit -q -m "initial"
printf '%s\n' "sk-ant-1234567890123456789012345" > $'\321\201onfig.txt'
git add -- $'\321\201onfig.txt'
OUT_QUOTE="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --staged 2>&1)"
EXIT_QUOTE=$?
assert_eq "1" "$EXIT_QUOTE" "exit 1 on secret in C-quotable non-ASCII path"
assert_contains "$OUT_QUOTE" "anthropic" "quoted-path finding is not silently skipped"

# --- bare --files: unstaged worktree edits (not --cached) ---
git init -q "$TEST_TMP/filesrepo"
cd "$TEST_TMP/filesrepo"
git config user.email "test@example.com"
git config user.name "Test"
echo "clean" > unstaged.txt
git add unstaged.txt
git commit -q -m "initial"
echo "sk-ant-1234567890123456789012345" >> unstaged.txt
OUT_UNSTAGED="$(node "$REPO_ROOT/scripts/secret-scan-diff.js" --files unstaged.txt 2>&1)"
EXIT_UNSTAGED=$?
assert_eq "1" "$EXIT_UNSTAGED" "bare --files scans unstaged worktree edits"
assert_contains "$OUT_UNSTAGED" "unstaged.txt" "bare --files finding names the unstaged file"

finalize_test
