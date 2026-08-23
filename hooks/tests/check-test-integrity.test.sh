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

# ── 9. Configurable test_paths / surface_paths ──────────────────────────────
# Regression for the defect that left this repo's whole test surface invisible:
# parse_config tested `line.startswith("#")` BEFORE `line.startswith("##")`, so
# every section heading was swallowed as a comment, `section` never left None,
# and any `- <glob>` line was rejected as an unrecognized config line. Net
# effect: `test_paths` / `surface_paths` could not be configured by ANY project,
# and every repo silently ran on the built-in ecosystem defaults.
reset_repo
mkdir -p .claude
cat > .claude/test-integrity-config.md <<'CFG'
# leading comment must not swallow the headings below
## Mode
mode: block

## Test Paths
- '**/*.suite.sh'

## Integrity Surface Paths
- 'harness/**'
CFG
git add .claude/test-integrity-config.md
git commit -qm "config with custom test and surface paths"

mkdir -p harness
printf 'check() { [ "$1" = "$2" ]; }\n' > harness/lib.sh
printf 'check a a\ncheck b b\n' > custom.suite.sh
git add harness/lib.sh custom.suite.sh
git commit -qm "add custom-convention suite"

run_integrity
assert_contains "$__OUTPUT" '"test_paths_matched": 1' "custom test_paths glob is honored"
assert_not_contains "$__OUTPUT" '"kind": "malformed_config"' "a config declaring test_paths is not malformed"
assert_contains "$__OUTPUT" '"kind": "surface_touch"' "custom surface_paths glob is honored"
assert_contains "$__OUTPUT" 'harness/lib.sh' "surface touch names the harness file"

# A heading the parser does not recognize still must not corrupt the config.
reset_repo
mkdir -p .claude
cat > .claude/test-integrity-config.md <<'CFG'
## Mode
mode: warn

## Notes
# free-form section the parser ignores

## Test Paths
- '**/*.suite.sh'
CFG
git add .claude/test-integrity-config.md
git commit -qm "config with an unrecognized heading"
printf 'check a a\n' > custom.suite.sh
git add custom.suite.sh
git commit -qm "add suite"
run_integrity
assert_contains "$__OUTPUT" '"mode": "warn"' "unrecognized heading does not force block mode"
assert_not_contains "$__OUTPUT" '"kind": "malformed_config"' "unrecognized heading is not malformed"

# ── 10. autopilot's own config sees autopilot's own test surface ────────────
# The BACKLOG defect in one assertion: run the REAL .claude/test-integrity-config.md
# against the REAL list of suites in this repo and require that it matches every
# one of them. Add a suite under a naming convention the config does not cover
# and this goes red — which is the only thing that stops the gate going blind
# again the way it did with the generic template globs.
surface_repo="$(mkrepo real-surface)"
cd "$surface_repo"
mkdir -p .claude
assert_file_exists "$REPO_ROOT/.claude/test-integrity-config.md" "autopilot ships its own test-integrity config"
cp "$REPO_ROOT/.claude/test-integrity-config.md" .claude/test-integrity-config.md
git add .claude/test-integrity-config.md
git commit -qm "adopt the real autopilot config"

# Enumerate the real suites. Both shapes are what hooks/tests/run.sh executes.
REAL_SUITES="$TEST_TMP/real-suites.txt"
git -C "$REPO_ROOT" ls-files '*.test.sh' '*.test.js' > "$REAL_SUITES"
REAL_COUNT="$(wc -l < "$REAL_SUITES" | tr -d ' ')"
# Floor guard: if the enumeration ever returns nothing, `matched == expected`
# would be 0 == 0 and this whole test would pass while measuring nothing.
if [ "$REAL_COUNT" -lt 200 ]; then
  fail "real suite enumeration returned only $REAL_COUNT files — enumeration is broken, not the config"
fi

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  mkdir -p "$(dirname "$rel")"
  printf '# placeholder for %s\n' "$rel" > "$rel"
done < "$REAL_SUITES"
git add -A
git commit -qm "every real suite path as a placeholder"

__STDOUT_FILE="$TEST_TMP/stdout.json"
__EXIT_CODE=0
bash "$S" validate --no-l1 --range HEAD~1..HEAD --repo "$surface_repo" >"$__STDOUT_FILE" 2>/dev/null || __EXIT_CODE=$?
__OUTPUT="$(cat "$__STDOUT_FILE")"
MATCHED="$(sed -n 's/.*"test_paths_matched": \([0-9]*\).*/\1/p' "$__STDOUT_FILE")"
assert_eq "$MATCHED" "$REAL_COUNT" "the real config matches every real *.test.sh / *.test.js suite ($REAL_COUNT)"
assert_not_contains "$__OUTPUT" '"warning": "possible misconfiguration' "no zero-match warning on the real surface"

cd "$repo"

# ── 11. Negative controls on a shell suite ──────────────────────────────────
# Four moves a gaming implementer would make against this repo's dominant test
# shape (bash *.test.sh). Before .claude/test-integrity-config.md existed, the
# template globs matched none of these paths and the gate reported ok with
# test_paths_matched: 0. The reproducer with recorded BEFORE/AFTER output is
# docs/projects/2026-08-23-test-integrity-coverage/evidence/negative-controls.sh.
shell_cfg() { # shell_cfg <mode>
  reset_repo
  mkdir -p .claude hooks/tests
  printf "## Mode\nmode: %s\n\n## Test Paths\n- '**/*.test.sh'\n" "$1" > .claude/test-integrity-config.md
  cat > hooks/tests/example.test.sh <<'SUITE'
#!/usr/bin/env bash
out="alpha beta"
assert_eq "$out" "alpha beta" "payload verbatim"
assert_contains "$out" "alpha" "alpha token present"
assert_eq "2" "2" "counter increments"
SUITE
  git add .claude/test-integrity-config.md hooks/tests/example.test.sh
  git commit -qm "base with shell suite and shell-aware config"
}

# 11a. deleting assertions from a *.test.sh suite
shell_cfg warn
grep -v 'assert_contains' hooks/tests/example.test.sh > "$TEST_TMP/s" && mv "$TEST_TMP/s" hooks/tests/example.test.sh
git add -u; git commit -qm "delete an assertion"
run_integrity
assert_contains "$__OUTPUT" '"test_paths_matched": 1' "deleted assertion: shell suite is seen"
assert_contains "$__OUTPUT" '"kind": "deleted_line"' "deleted assertion: reported"
assert_contains "$__OUTPUT" 'assert_contains' "deleted assertion: the removed line is named"

# 11b. weakening an assertion
shell_cfg block
sed -i 's|^assert_eq "\$out" "alpha beta".*$|true|' hooks/tests/example.test.sh
git add -u; git commit -qm "weaken an assertion"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "weakened assertion: block mode goes red"
assert_contains "$__OUTPUT" '"kind": "deleted_line"' "weakened assertion: reported"

# 11c. adding a skip to a shell suite — pure addition, no deleted lines, so this
# isolates the shell skip heuristic from the language-agnostic deletion check.
shell_cfg block
sed -i '1a skip "flaky on CI"' hooks/tests/example.test.sh
git add -u; git commit -qm "add a skip"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "added skip: block mode goes red"
assert_contains "$__OUTPUT" '"kind": "skip_marker"' "added skip: shell skip marker detected"
assert_not_contains "$__OUTPUT" '"kind": "deleted_line"' "added skip: nothing was deleted, so only the skip fires"

# 11c-bis. THE SHELL SKIP GRAMMAR — one control per grammar class.
#
# History: three separate rounds of first-pass/panel review each found a
# one-token evasion of this heuristic (`&& skip`, a `${#...}`-erased line,
# then `skip;` / `( skip )` / a quoted `#`). Patching per bug moved the hole
# three times. The detector is now driven by an explicit enumeration of the
# shell grammar, and so are these controls: they cover each CLASS, including
# the classes that are deliberately excluded and the ones that stay uncovered.
# The full enumeration (with the uncovered classes named) is in
# docs/projects/2026-08-23-test-integrity-coverage/README.md.
#
# Add a class here before adding a pattern there.

shell_probe() { # shell_probe <line> <CATCH|CLEAN> <label>
  local line="$1" want="$2" label="$3"
  shell_cfg block
  printf '%s\n' "$line" >> hooks/tests/example.test.sh
  git add -u >/dev/null; git commit -qm "probe: $label" >/dev/null
  run_integrity
  case "$want" in
    CATCH) assert_contains    "$__OUTPUT" '"kind": "skip_marker"' "grammar $label: detected" ;;
    CLEAN) assert_not_contains "$__OUTPUT" '"kind": "skip_marker"' "grammar $label: not a skip" ;;
  esac
}

# ── A. command position: every way shell starts a simple command ────────────
shell_probe 'skip "r"'                        CATCH "A1 line start"
shell_probe 'true; skip "r"'                  CATCH "A2 after ;"
shell_probe 'true && skip "r"'                CATCH "A3 after &&"
shell_probe 'false || skip "r"'               CATCH "A4 after ||"
shell_probe 'echo x | skip'                   CATCH "A5 after pipe"
shell_probe 'true & skip "r"'                 CATCH "A6 after &"
shell_probe '( skip "r" )'                    CATCH "A7 subshell"
shell_probe '{ skip "r"; }'                   CATCH "A8 group"
shell_probe 'if true; then skip "r"; fi'      CATCH "A9 then"
shell_probe 'if false; then :; else skip; fi' CATCH "A9 else"
shell_probe 'for i in 1; do skip "r"; done'   CATCH "A9 do"
shell_probe '! skip "r"'                      CATCH "A10 negation"
shell_probe 'x=$( skip "r" )'                 CATCH "A12 command substitution"
shell_probe 'x=`skip "r"`'                    CATCH "A13 backtick"
shell_probe 'FOO=bar skip "r"'                CATCH "A15 assignment prefix"

# Deliberately excluded: a `case` arm pattern is not a command position.
shell_probe 'case $x in skip) :;; esac'       CLEAN "A17 case pattern excluded"
# Named-uncovered classes. These assertions document the CURRENT boundary; if
# one flips to CATCH the boundary moved, and the README enumeration plus the
# BACKLOG row must move with it.
shell_probe 'time skip "r"'                   CLEAN "A14 time prefix (uncovered)"
shell_probe '>/dev/null skip "r"'             CLEAN "A16 redirection prefix (uncovered)"

# ── B. a `#` that is not a comment must not erase the line ──────────────────
shell_probe '[ "${#XS[@]}" -eq 0 ] && skip "r"' CATCH "B1 brace-hash length"
shell_probe '[ $# -eq 0 ] && skip "r"'          CATCH "B2 dollar-hash argc"
shell_probe 'printf " #" && skip "r"'           CATCH "B3 hash in double quotes"
shell_probe "printf ' #' && skip \"r\""          CATCH "B4 hash in single quotes"
shell_probe 'printf \# && skip "r"'             CATCH "B5 escaped hash"
shell_probe 'echo a#b && skip "r"'              CATCH "B6 mid-word hash"

# ...while real comments are still removed.
shell_probe 'echo hi   # skip "r"'            CLEAN "B real trailing comment"
shell_probe '# skip "r"'                      CLEAN "B real full-line comment"
shell_probe 'true ;# skip "r"'                CLEAN "B comment after delimiter"

# ── C. the tail after the `skip` word ───────────────────────────────────────
shell_probe 'skip'                            CATCH "C2 bare, end of line"
shell_probe 'skip;'                           CATCH "C3 semicolon tail"
shell_probe 'skip &'                          CATCH "C4 ampersand tail"
shell_probe 'skip | cat'                      CATCH "C5 pipe tail"
shell_probe '( skip )'                        CATCH "C6 close-paren tail"
shell_probe 'echo "${skip}"'                  CLEAN "C7 brace expansion excluded"
shell_probe 'skip() { :; }'                   CLEAN "C8 function definition"
shell_probe 'skip () { :; }'                  CLEAN "C8 definition with space"
shell_probe 'skip=1'                          CLEAN "C9 assignment"
shell_probe 'skipped=1'                       CLEAN "C10 word continuation"

# ── D. data vs code ─────────────────────────────────────────────────────────
# A suite that WRITES a skip into a fixture is not a suite that skips. This is
# why quoted spans are blanked before detection — and it is what removed the
# self-referential false positives this very file used to produce.
shell_probe "sed -i '1a skip \"x\"' f"          CLEAN "D1 skip inside single quotes"
shell_probe 'echo "skip here"'                CLEAN "D1 skip inside double quotes"
shell_probe 'eval "skip"'                     CLEAN "D2 eval-string (uncovered)"

# The violation must quote the SOURCE line, not the stripped projection: the
# reader needs the reason text, and `skip Q` would not give it to them.
shell_cfg block
printf '%s\n' 'skip "why this suite bailed"' >> hooks/tests/example.test.sh
git add -u >/dev/null; git commit -qm "probe: detail text" >/dev/null
run_integrity
assert_contains "$__OUTPUT" 'why this suite bailed' "violation detail quotes the source line, not the stripped view"

# A comment mentioning skip must not fire (the shell comment stripper).
shell_cfg block
sed -i '1a echo hi  # skip this note' hooks/tests/example.test.sh
git add -u; git commit -qm "add a comment mentioning skip"
run_integrity
assert_not_contains "$__OUTPUT" '"kind": "skip_marker"' "shell trailing comment mentioning skip is not a violation"

# Defining the skip helper is not itself a skip.
shell_cfg block
sed -i '1a skip() { printf "SKIP: %s\\n" "$1"; }' hooks/tests/example.test.sh
git add -u; git commit -qm "define a skip helper"
run_integrity
assert_not_contains "$__OUTPUT" '"kind": "skip_marker"' "defining skip() is not a skip invocation"

# 11d. deleting an entire test file
shell_cfg block
git rm -q hooks/tests/example.test.sh
git commit -qm "delete the whole suite"
run_integrity
assert_exit_code "$__EXIT_CODE" 1 "deleted suite: block mode goes red"
assert_contains "$__OUTPUT" '"kind": "deleted_line"' "deleted suite: reported"
assert_contains "$__OUTPUT" 'hooks/tests/example.test.sh' "deleted suite: the file is named"

# 11e. THE DOCUMENTED GAP, pinned so it cannot become a silent one.
# An early `exit 0` spliced into a bash suite neuters it with no deletions and
# no skip token, and the L0 layer cannot tell it apart from the legitimate
# terminating `exit 0` that most suites in this repo end with. If this
# assertion ever fails, the gap was closed — update the comment in
# .claude/test-integrity-config.md, the note in scripts/lib/test-integrity-l1.py,
# and the BACKLOG row, then flip this to assert detection.
shell_cfg block
sed -i '1a exit 0' hooks/tests/example.test.sh
git add -u; git commit -qm "splice an early exit"
run_integrity
assert_contains "$__OUTPUT" '"test_paths_matched": 1' "early exit: the suite is still seen"
assert_exit_code "$__EXIT_CODE" 0 "KNOWN GAP: a spliced early exit is not detected (see config comments)"

finalize_test
