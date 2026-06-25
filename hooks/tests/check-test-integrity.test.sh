#!/usr/bin/env bash
# check-test-integrity.test.sh — acceptance tests for check-test-integrity.sh

. "$(dirname "$0")/lib.sh"

S="$REPO_ROOT/scripts/check-test-integrity.sh"
assert_file_exists "$S" "script present"

git_id() { git -C "$1" config user.email t@t; git -C "$1" config user.name t; }
mkrepo() { local d="$TEST_TMP/$1"; mkdir -p "$d"; git -C "$d" init -q; git_id "$d"; echo "$d"; }

repo="$(mkrepo sandbox)"

# ── Setup initial clean commit ───────────────────────────────────────────────
cd "$repo"
echo "initial code" > main.py
mkdir -p tests
echo "def test_first(): assert 1 == 1" > tests/first_test.py
git add .
git commit -qm "initial commit"
git tag init

reset_repo() {
  git reset --hard init >/dev/null 2>&1
  git clean -fdx >/dev/null 2>&1
  rm -rf .claude
  rm -rf .qc
}

run_integrity() {
  local extra_args="${1:-}"
  local range="HEAD~1..HEAD"
  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  bash "$S" validate --range "$range" --repo "$repo" $extra_args >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

# ── 1. Default warn mode & deletion detection ──────────────────────────────────
reset_repo
# Change assertion -> produces a deleted line (-)
echo "def test_first(): assert True" > tests/first_test.py
git add tests/first_test.py
git commit -qm "weaken assertion"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "default warn mode exits 0 on violation"
assert_contains "$__OUTPUT" '"kind": "deleted_line"' "detects deleted_line"
assert_contains "$__OUTPUT" '"ok": true' "ok is true in warn mode"

# Now configure block mode
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo "def test_first(): assert True" > tests/first_test.py
git add tests/first_test.py
git commit -qm "weaken assertion in block mode"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "block mode exits 1 on violation"
assert_contains "$__OUTPUT" '"ok": false' "ok is false in block mode"

# ── 2. Add skip/solo markers ────────────────────────────────────────────────
# Python skip marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "def test_first(): assert 1 == 1\n# @pytest.mark.skip\ndef test_skipped(): pass" > tests/first_test.py
git add tests/first_test.py
git commit -qm "add skip marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "block mode exits 1 on skip marker"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects skip_marker"
assert_contains "$__OUTPUT" '"ok": false' "ok is false"

# Clean test addition (no markers)
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "describe('test', () => {\n  it('works', () => {})\n})" > tests/js_test.test.js
git add tests/js_test.test.js
git commit -qm "add clean JS test file"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "addition of clean test file is OK"
assert_contains "$__OUTPUT" '"ok": true' "ok is true"

# JS solo marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "describe('test', () => {\n  it.only('works', () => {})\n})" > tests/js_test.test.js
git add tests/js_test.test.js
git commit -qm "add solo marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "block mode exits 1 on solo marker"
assert_contains "$__OUTPUT" '"kind": "solo_marker"' "detects solo_marker"

# ── 3. Rename escape ─────────────────────────────────────────────────────────
# Rename test file to a non-test path
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

mkdir -p src
git mv tests/first_test.py src/first.py
git commit -qm "rename test to non-test"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "rename to non-test triggers rename_escape"
assert_contains "$__OUTPUT" '"kind": "rename_escape"' "detects rename_escape"

# Rename to a valid test path
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

git mv tests/first_test.py tests/first_new_test.py
git commit -qm "rename to valid test path"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "rename to a valid test path is OK"
assert_contains "$__OUTPUT" '"ok": true' "ok is true for valid rename"

# ── 4. Integrity surface touch ──────────────────────────────────────────────
# Touch conftest.py (integrity surface)
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo "test config" > pytest.ini
git add pytest.ini
git commit -qm "touch pytest.ini"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "integrity surface touch blocks in block mode"
assert_contains "$__OUTPUT" '"surface_touches"' "surface_touches field exists"
assert_contains "$__OUTPUT" '"pytest.ini"' "pytest.ini listed"
assert_contains "$__OUTPUT" '"kind": "surface_touch"' "surface_touch registered as violation in block mode"

# Switch to warn mode
reset_repo
mkdir -p .claude
printf "## Mode\nmode: warn\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config warn mode"

echo "test config" > pytest.ini
git add pytest.ini
git commit -qm "touch pytest.ini"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "surface touch does not block in warn mode"
assert_contains "$__OUTPUT" '"surface_touches"' "surface_touches field exists"
assert_contains "$__OUTPUT" '"pytest.ini"' "pytest.ini listed in warn mode"
assert_not_contains "$__OUTPUT" '"kind": "surface_touch"' "surface_touch not a violation in warn mode"

# ── 5. Override verdicts ────────────────────────────────────────────────────
# Switch back to block mode
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "force block mode"

# Delete a test line -> produces a violation
echo "def test_first(): pass" > tests/first_test.py
git add tests/first_test.py
git commit -qm "delete test line"

head_sha="$(git rev-parse HEAD)"
head_tree="$(git rev-parse HEAD^{tree})"

# Check fail without override
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "should fail without override"

# Check fail with mismatched override
mkdir -p .qc
echo '{"tree": "mismatched_tree_sha_here"}' > ".qc/${head_sha}.verdict.json"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "should fail with mismatched override"

# Check pass with matching override
echo "{\"tree\": \"${head_tree}\"}" > ".qc/${head_sha}.verdict.json"
run_integrity
assert_exit_code "$__EXIT_CODE" 0 "should pass with matching override"
assert_contains "$__OUTPUT" '"ok": true' "ok is true after override"

# ── 6. Malformed config file ────────────────────────────────────────────────
reset_repo
mkdir -p .claude
printf "## Mode\nmode: invalid_mode_value\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "commit invalid config"

echo "def test_clean(): pass" >> tests/first_test.py
git add tests/first_test.py
git commit -qm "clean addition with bad config"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "malformed config exits 1 even for clean diff"
assert_contains "$__OUTPUT" '"kind": "malformed_config"' "detects malformed_config"
assert_contains "$__OUTPUT" '"mode": "block"' "forces mode=block"

# ── 7. Zero test paths warning ──────────────────────────────────────────────
reset_repo
# Change a non-test, non-surface file only
echo "print('hello world')" > main.py
git add main.py
git commit -qm "change main.py only"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "clean run on non-test file exits 0"
assert_contains "$__OUTPUT" '"test_paths_matched": 0' "zero test paths matched"
assert_contains "$__OUTPUT" '"warning": "possible misconfiguration: zero test paths matched the diff"' "emits misconfiguration warning"

finalize_test
