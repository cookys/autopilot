#!/usr/bin/env bash
# hooks/tests/doc-drift-gate.test.sh — integration tests for doc-drift-gate.js

set -uo pipefail

. "$(dirname "$0")/lib.sh"

# Paths to script under test
GATE_JS="$REPO_ROOT/scripts/doc-drift-gate.js"

# Create a temporary sandbox repo directory inside TEST_TMP
SANDBOX="$TEST_TMP/sandbox"
mkdir -p "$SANDBOX"

# Helper to run gate on sandbox
run_gate() {
  local out
  local exit_code=0
  out=$(node "$GATE_JS" "$@" 2>&1) || exit_code=$?
  __GATE_OUT="$out"
  __GATE_EXIT="$exit_code"
}

# 1. Empty sandbox (no markdown files) should pass
echo "Testing empty sandbox..."
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "empty directory passes"
assert_contains "$__GATE_OUT" "0 md files" "reports 0 md files"
assert_contains "$__GATE_OUT" "baseline doc-drift checks green" "reports baseline green"

# 2. Markdown file with good links and balanced fences should pass
echo "Testing good markdown file..."
mkdir -p "$SANDBOX/docs"
cat > "$SANDBOX/docs/good.md" <<'EOF'
# Good Doc
See [another doc](sibling.md).
See [anchor link](#anchor-only).
See [https link](https://google.com).
See [GH convention](/pull/123).
See [directory link](dir/).
See [placeholder link](<some-place>).

```javascript
const x = 1;
```
EOF
echo "# Sibling" > "$SANDBOX/docs/sibling.md"
mkdir -p "$SANDBOX/docs/dir"

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "good markdown passes"
assert_contains "$__GATE_OUT" "2 md files" "reports 2 md files (good.md and sibling.md)"
assert_contains "$__GATE_OUT" "[PASS] links" "links check passes"
assert_contains "$__GATE_OUT" "[PASS] fences" "fences check passes"

# 3. Markdown file with broken links should fail (exit 1)
echo "Testing broken link..."
cat > "$SANDBOX/docs/broken_link.md" <<'EOF'
# Broken Link Doc
Here is a [broken link](ghost.md).
EOF

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "broken link fails"
assert_contains "$__GATE_OUT" "[FAIL] links" "links check fails"
assert_contains "$__GATE_OUT" "ghost.md" "reports the missing target filename"
assert_contains "$__GATE_OUT" "broken_link.md: ghost.md" "reports path and link target"

# Cleanup broken link for next test
rm "$SANDBOX/docs/broken_link.md"

# 4. Markdown file with unbalanced code fences should fail (exit 1)
echo "Testing unbalanced code fences..."
cat > "$SANDBOX/docs/unbalanced_fence.md" <<'EOF'
# Unbalanced Fence
```javascript
const x = 2;
EOF

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "unbalanced fence fails"
assert_contains "$__GATE_OUT" "[FAIL] fences" "fences check fails"
assert_contains "$__GATE_OUT" "unbalanced_fence.md: 1 fence lines (odd" "reports the unbalanced fence"

# Cleanup unbalanced fence for next test
rm "$SANDBOX/docs/unbalanced_fence.md"

# 5. Testing CLI excludes `--exclude`
echo "Testing custom exclude..."
mkdir -p "$SANDBOX/docs/ignored_subdir"
cat > "$SANDBOX/docs/ignored_subdir/bad_link.md" <<'EOF'
[broken](does-not-exist.md)
EOF

# Should fail without exclude
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "fails on bad_link.md without exclude"

# Should pass with exclude
run_gate "--exclude" "ignored_subdir" "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "passes when bad_link.md is excluded"

# Cleanup
rm -rf "$SANDBOX/docs/ignored_subdir"

# 6. Testing CRLF normalization
# Create a markdown file with CRLF line endings and unbalanced code fences.
# Make sure CRLF is normalized to LF and checked correctly.
# If CRLF is normalized, the line splits by \n work correctly and count is accurate.
echo "Testing CRLF line endings..."
printf "# CRLF Doc\r\n\`\`\`javascript\r\nconst x = 3;\r\n\`\`\`\r\n" > "$SANDBOX/docs/crlf.md"

run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 0 "CRLF doc with balanced fences passes"

# Now unbalanced CRLF
printf "# CRLF Doc\r\n\`\`\`javascript\r\nconst x = 3;\r\n" > "$SANDBOX/docs/crlf.md"
run_gate "$SANDBOX"
assert_exit_code "$__GATE_EXIT" 1 "CRLF doc with unbalanced fences fails"

# Cleanup CRLF doc
rm "$SANDBOX/docs/crlf.md"

# 7. Testing invalid command arguments/usage errors (exit 2)
echo "Testing invalid usage..."
run_gate "--exclude" # missing arg
assert_exit_code "$__GATE_EXIT" 2 "missing exclude arg exits with 2"

run_gate "/path/does/not/exist"
assert_exit_code "$__GATE_EXIT" 2 "non-existent path exits with 2"

finalize_test
