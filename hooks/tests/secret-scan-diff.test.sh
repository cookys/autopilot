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

finalize_test
