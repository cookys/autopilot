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
  local range="${2:-HEAD~1..HEAD}"
  __STDOUT_FILE="$TEST_TMP/stdout.json"
  __EXIT_CODE=0
  # This file tests the L0 static gate. Keep L1 disabled here so assertions do
  # not depend on whether the host machine has pytest/go/node runners installed.
  bash "$S" validate --no-l1 --range "$range" --repo "$repo" $extra_args >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
  __OUTPUT="$(cat "$__STDOUT_FILE")"
}

# ── 1. Default warn mode & deletion detection ──────────────────────────────────
reset_repo
# Change assertion -> produces a deleted line (-)
echo "def test_first(): assert True" > tests/first_test.py
git add tests/first_test.py
git commit -qm "weaken assertion"

run_integrity --no-l1
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

echo -e "def test_first(): assert 1 == 1\n@pytest.mark.skip\ndef test_skipped(): pass" > tests/first_test.py
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

# JS explicit false-positive check: `exit` should not match skip/solo regexes
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "describe('test', () => {\n  // exit early\n  it('works', () => {})\n})" > tests/js_test.test.js
git add tests/js_test.test.js
git commit -qm "add non-matching exit text"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "JS line '// exit early' is ignored as marker"
assert_not_contains "$__OUTPUT" '"kind": "skip_marker"' "does not produce false skip marker"
assert_not_contains "$__OUTPUT" '"kind": "solo_marker"' "does not produce false solo marker"

# JS concurrent-only marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "describe('test', () => {\n  it.concurrent.only('works', () => {})\n})" > tests/js_test.test.js
git add tests/js_test.test.js
git commit -qm "add concurrent.only marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "concurrent-only marker is flagged"
assert_contains "$__OUTPUT" '"kind": "solo_marker"' "detects concurrent.only"

# Python pytestmark non-skip/xfail assignment is ignored
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

cat <<'EOF' > tests/markers_test.py
import pytest

pytestmark = pytest.mark.django_db
EOF
git add tests/markers_test.py
git commit -qm "add non-skipping pytestmark assignment"

run_integrity
assert_exit_code "$__EXIT_CODE" 0 "pytestmark django_db assignment does not trigger marker"
assert_not_contains "$__OUTPUT" '"kind": "skip_marker"' "pytestmark assignment is not parsed as skip"

# Ruby focused test marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

echo -e "fit('focuses test') do\n  expect(true).to eq(true)\nend" > tests/user_spec.rb
git add tests/user_spec.rb
git commit -qm "add ruby focused marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "ruby fit marker is flagged"
assert_contains "$__OUTPUT" '"kind": "solo_marker"' "detects ruby fit marker"

# Python unittest skipTest
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

cat <<'EOF' > tests/first_test.py
import unittest


class T(unittest.TestCase):
    def test_first(self):
        self.skipTest("skip")
EOF
git add tests/first_test.py
git commit -qm "add unittest skipTest marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "python unittest skipTest marker is flagged"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects skipTest"

# Go skipf
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

mkdir -p src
cat <<'EOF' > tests/first_test.go
package tests

import "testing"

func TestSkipf(t *testing.T) {
    t.Skipf("skipf path")
}
EOF
git add tests/first_test.go
git commit -qm "add go skipf marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "go t.Skipf marker is flagged"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects t.Skipf"

# JS it.each(...).skip marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

cat <<'EOF' > tests/js_test.test.js
it.each([1]).skip('skips each', (value) => {
  expect(value).toBe(1)
})
EOF
git add tests/js_test.test.js
git commit -qm "add it.each skip marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "js it.each(...).skip marker is flagged"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects it.each skip"

# Go t.SkipNow marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

cat <<'EOF' > tests/second_test.go
package tests

import "testing"

func TestSkipNow(t *testing.T) {
    t.SkipNow()
}
EOF
git add tests/second_test.go
git commit -qm "add go SkipNow marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "go t.SkipNow marker is flagged"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects t.SkipNow"

# Rust ignore marker
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

cat <<'EOF' > tests/first.rs
#[ignore = "reason"]
fn test_first() {
    assert!(true);
}
EOF
git add tests/first.rs
git commit -qm "add rust ignore marker"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "rust ignore marker is flagged"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "detects rust #[ignore]"

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

run_integrity --no-l1
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

# Surface file that is also under tests/** should still be surface_touch
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

mkdir -p tests/fixtures tests/__snapshots__
echo "{}" > tests/fixtures/x.json
echo "snapshot" > tests/__snapshots__/x.snap
git add tests/fixtures/x.json tests/__snapshots__/x.snap
git commit -qm "touch snapshot and fixture"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "surface files under tests paths are still flagged"
assert_contains "$__OUTPUT" '"kind": "surface_touch"' "surface_touch flagged for tests/fixtures/x.json"
assert_contains "$__OUTPUT" '"tests/fixtures/x.json"' "tracks fixture path in output"
assert_contains "$__OUTPUT" '"tests/__snapshots__/x.snap"' "tracks snapshot path in output"

# ── 5. Override verdicts ────────────────────────────────────────────────────
# Switch back to block mode
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "force block mode"

# Produce a test violation and a surface violation in the same change.
echo "def test_first(): pass" > tests/first_test.py
mkdir -p tests/fixtures
echo "{}" > tests/fixtures/x.json
git add tests/first_test.py tests/fixtures/x.json
git commit -qm "delete test line and touch fixture"

head_sha="$(git rev-parse HEAD)"
head_tree="$(git rev-parse HEAD^{tree})"

# Check fail without override
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "should fail without override"

# Untracked override must be ignored
mkdir -p .qc
echo "{\"tree\": \"${head_tree}\", \"waives\": [{\"file\": \"tests/first_test.py\", \"kind\": \"deleted_line\"}, {\"file\": \"tests/fixtures/x.json\", \"kind\": \"surface_touch\"}]}" > ".qc/${head_sha}.verdict.json"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "should fail with untracked override"

# A committed verdict for the wrong filename must be rejected
git add .qc/${head_sha}.verdict.json
git commit -qm "add committed wrong-filename verdict"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "committed verdict with non-matching filename is rejected"
assert_contains "$__OUTPUT" '"override_status": "No committed verdict file' "override file name is anchored to head SHA"

# Partially waiving only one violation via a committed override is not accepted without an exact match
head_sha="$(git rev-parse HEAD)"
head_tree="$(git rev-parse HEAD^{tree})"
echo "{\"tree\": \"${head_tree}\", \"waives\": [{\"file\": \"tests/first_test.py\", \"kind\": \"deleted_line\"}]}" > ".qc/${head_sha}.verdict.json"
git add .qc/${head_sha}.verdict.json
git commit -qm "add partial override"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "should fail when partial waiver does not clear all violations"

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

# ── 8. Trusted-path and CLI guard hardening ─────────────────────────────────
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

printf "## Mode\nmode: off\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "candidate attempt to disable gate"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "protected config edit remains blocked even if mode is changed in candidate"
assert_contains "$__OUTPUT" '"kind": "protected_path_touch"' "protected path modification reported"
assert_contains "$__OUTPUT" '"file": ".claude/test-integrity-config.md"' "blocked protected config path"

# Missing base in range is internal error (git_error) and exits 2
run_integrity "" "missing..HEAD"
assert_exit_code "$__EXIT_CODE" 2 "missing base commit exits with git_error"
assert_contains "$__OUTPUT" '"kind": "git_error"' "missing range reports git_error"

# set -u arg guard: --repo without value should exit 2
__STDOUT_FILE="$TEST_TMP/stdout.json"
__EXIT_CODE=0
bash "$S" validate --range "HEAD~1..HEAD" --repo >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
assert_exit_code "$__EXIT_CODE" 2 "missing --repo value exits 2"

# TEST_INTEGRITY_CONFIG_OVERRIDE only applies with --allow-env-config
reset_repo
override_file="$TEST_TMP/test-integrity.config.md"
cat <<'EOF' > "$override_file"
## Mode
mode: block
EOF
echo "def test_first(): assert True" > tests/first_test.py
git add tests/first_test.py
git commit -qm "weaken assertion for env override test"

export TEST_INTEGRITY_CONFIG_OVERRIDE="$override_file"
run_integrity
assert_exit_code "$__EXIT_CODE" 0 "env override is ignored without --allow-env-config"

run_integrity "--allow-env-config"
assert_exit_code "$__EXIT_CODE" 1 "env override is applied with --allow-env-config"
assert_contains "$__OUTPUT" '"mode": "block"' "env override sets mode when explicitly allowed"
unset TEST_INTEGRITY_CONFIG_OVERRIDE

# deleted file with space in path keeps correct attribution
reset_repo
mkdir -p .claude
printf "## Mode\nmode: block\n" > .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "config block mode"

mkdir -p tests
echo "def test_with_space(): assert True" > "tests/test file space_test.py"
git add "tests/test file space_test.py"
git commit -qm "add spaced test file"
rm "tests/test file space_test.py"
git add -u
git commit -qm "delete spaced test file"

run_integrity
assert_exit_code "$__EXIT_CODE" 1 "deleted test with space path is parsed correctly"
assert_contains "$__OUTPUT" '"file": "tests/test file space_test.py"' "space path preserved in violation"

finalize_test
