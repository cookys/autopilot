#!/usr/bin/env bash
# check-test-integrity-precision.test.sh — BL-0060 planted controls.
# N cases are violations the precise rules must still report.
# F cases are synthetic false positives the precise rules must not report.
# RED at ecb84c9e5: F1 F2 F3 F4 failed on the unmodified base (checker still reported them); N1 N2 N3 N4 N5 N6 passed.
# RED at c65144649: N7 N8 F5 failed on the unmodified base.
# RED at 9cd17a5c6: F6 F7 F8 failed on the unmodified base (pure-add surface edit, same-topic replacement, if-! form still reported); N9 N10 passed.
# RED at 0d790a1b7: N11 failed on the base of this fix (hollow same-stem replacement exempted the deleted test).
. "$(dirname "$0")/lib.sh"

S="$REPO_ROOT/scripts/check-test-integrity.sh"
assert_file_exists "$S" "script present"

git_id() { git -C "$1" config user.email t@t; git -C "$1" config user.name t; }

new_repo() {
  local d
  d="$(mktemp -d "$TEST_TMP/prec.XXXXXX")"
  git -C "$d" init -q
  git_id "$d"
  mkdir -p "$d/.claude"
  printf '## Mode\nmode: block\n' > "$d/.claude/test-integrity-config.md"
  echo "$d"
}

commit_all() {
  git -C "$1" add -A
  git -C "$1" commit -qm "$2"
}

# run_case <repo> ; sets CASE_OUT
run_case() {
  local repo="$1"
  CASE_OUT="$(bash "$S" validate --no-l1 --range HEAD~1..HEAD --repo "$repo" 2>/dev/null || true)"
}

has_kind() { printf '%s' "$CASE_OUT" | grep -q "\"kind\": \"$1\""; }
has_text() { printf '%s' "$CASE_OUT" | grep -q "$1"; }

report() {
  # report <id> <1 if the precise expectation holds>
  local id="$1" ok="$2"
  if [ "$ok" = 1 ]; then
    echo "PASS $id"
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    echo "FAIL $id"
    fail "$id"
  fi
}

# ── N1 delete one assertion; product file stays ────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def foo():\n    return 1\n' > "$repo/foo.py"
printf 'def test_foo():\n    assert foo() == 1\n    assert foo() == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    assert foo() == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "drop one assertion"
run_case "$repo"
if has_kind deleted_line; then report N1 1; else report N1 0; fi

# ── N2 real assertion rewritten into an always-true one ────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    x = 1\n    assert x == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    x = 1\n    assert True\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "tautology"
run_case "$repo"
if has_kind deleted_line; then report N2 1; else report N2 0; fi

# ── N3 added skip marker ────────────────────────────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf '@pytest.mark.skip\ndef test_foo():\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "skip"
run_case "$repo"
if has_kind skip_marker; then report N3 1; else report N3 0; fi

# ── N4 delete the test file; product file stays ────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def foo():\n    return 1\n' > "$repo/foo.py"
printf 'def test_foo():\n    assert foo() == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/test_foo.py
git -C "$repo" commit -qm "delete test only"
run_case "$repo"
if has_kind deleted_line; then report N4 1; else report N4 0; fi

# ── N5 modify an existing fixture (surface) ────────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests/fixtures"
printf '{}\n' > "$repo/tests/fixtures/golden.json"
commit_all "$repo" "base"
printf '{"k":1}\n' > "$repo/tests/fixtures/golden.json"
commit_all "$repo" "edit fixture"
run_case "$repo"
if has_kind surface_touch && has_text 'tests/fixtures/golden.json'; then report N5 1; else report N5 0; fi

# ── N6 delete one assertion and pad with a comment ─────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    # padding keeps the line count\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "comment pad"
run_case "$repo"
if has_kind deleted_line; then report N6 1; else report N6 0; fi

# ── F1 delete test together with its target ────────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'echo hi\n' > "$repo/foo.sh"
printf 'assert_eq "$(bash foo.sh)" "hi" "runs"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q foo.sh tests/foo.test.sh
git -C "$repo" commit -qm "delete test and target"
run_case "$repo"
if has_kind deleted_line; then report F1 0; else report F1 1; fi

# ── F2 rewrite an assertion into a stronger form (1 deleted, 2 added) ─────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    x = 1\n    assert x == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    x = 1\n    assert x == 1 and x > 0\n    assert isinstance(x, int)\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "stronger"
run_case "$repo"
if has_kind deleted_line; then report F2 0; else report F2 1; fi

# ── F3 add a brand-new fixture ──────────────────────────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
mkdir -p "$repo/tests/fixtures"
printf '{}\n' > "$repo/tests/fixtures/brand-new.json"
commit_all "$repo" "add fixture"
run_case "$repo"
if has_kind surface_touch || has_text 'brand-new.json'; then report F3 0; else report F3 1; fi

# ── F4 comment-only deletion and a pure variable rename ────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    # obsolete note\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    assert 1 == 2\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "drop comment"
run_case "$repo"
f4a=0
if has_kind deleted_line; then f4a=0; else f4a=1; fi

repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'def test_foo():\n    value = 1\n    assert compute() == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "base"
printf 'def test_foo():\n    renamed = 1\n    assert compute() == 1\n' > "$repo/tests/test_foo.py"
commit_all "$repo" "rename local"
run_case "$repo"
f4b=0
if has_kind deleted_line; then f4b=0; else f4b=1; fi
if [ "$f4a" = 1 ] && [ "$f4b" = 1 ]; then report F4 1; else report F4 0; fi

# ── N7 delete the test and a same-directory helper; product stays ──────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo hi\n' > "$repo/scripts/foo.sh"
printf 'echo helper\n' > "$repo/tests/foo.sh"
printf 'assert_eq "$(bash "$REPO_ROOT/scripts/foo.sh")" "hi" "runs"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/foo.test.sh tests/foo.sh
git -C "$repo" commit -qm "delete test and same-dir helper"
run_case "$repo"
if has_kind deleted_line && has_text 'tests/foo.test.sh'; then report N7 1; else report N7 0; fi

# ── N8 same basename stem under fixtures; product stays ────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/fixtures" "$repo/scripts"
printf 'module.exports = 1;\n' > "$repo/scripts/foo.js"
printf 'module.exports = 1;\n' > "$repo/fixtures/foo.js"
printf 'const assert = require("assert");\nassert.equal(1, 1);\n' > "$repo/tests/foo.test.js"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/foo.test.js fixtures/foo.js
git -C "$repo" commit -qm "delete test and fixture twin"
run_case "$repo"
if has_kind deleted_line; then report N8 1; else report N8 0; fi

# ── F5 quoted $REPO_ROOT invocation co-deletes the script; a comment does not
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo other\n' > "$repo/scripts/other-name.sh"
printf 'bash "$REPO_ROOT/scripts/other-name.sh"\nassert_eq 1 1 "ok"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/foo.test.sh scripts/other-name.sh
git -C "$repo" commit -qm "delete test and invoked script"
run_case "$repo"
if has_kind deleted_line; then f5a=0; else f5a=1; fi

repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo other\n' > "$repo/scripts/other-name.sh"
printf '# bash "$REPO_ROOT/scripts/other-name.sh"\nassert_eq 1 1 "ok"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/foo.test.sh scripts/other-name.sh
git -C "$repo" commit -qm "comment mention only"
run_case "$repo"
if has_kind deleted_line; then f5b=1; else f5b=0; fi
if [ "$f5a" = 1 ] && [ "$f5b" = 1 ]; then report F5 1; else report F5 0; fi

# ── F6 pure-add edit of a surface helper (BL-0060 v3 rule b) ───────────────
repo="$(new_repo)"
mkdir -p "$repo/tests/fixtures"
printf 'export A=1\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "base"
printf 'export A=1\nexport B=2\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "append export"
run_case "$repo"
if has_kind surface_touch; then report F6 0; else report F6 1; fi

# ── N9 surface file deleted outright still reported ─────────────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests/fixtures"
printf '{}\n' > "$repo/tests/fixtures/golden.json"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/fixtures/golden.json
git -C "$repo" commit -qm "delete fixture"
run_case "$repo"
if has_kind surface_touch && has_text 'tests/fixtures/golden.json'; then report N9 1; else report N9 0; fi

# ── F7 test removed with its feature; same-topic replacement added ─────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo hi\n' > "$repo/scripts/tool.sh"
printf 'assert_eq "$(bash scripts/tool.sh --gc)" "x" "gc works"\n' > "$repo/tests/tool-gc.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/tool-gc.test.sh
mkdir -p "$repo/tests"
printf 'assert_eq "$(bash scripts/tool.sh --gc 2>&1)" "unknown" "gc gone"\n' > "$repo/tests/tool-gc-removed.test.sh"
commit_all "$repo" "remove gc feature, add removal test"
run_case "$repo"
if has_kind deleted_line; then report F7 0; else report F7 1; fi

# ── N10 test deleted, unrelated test added; product stays (N4 shape) ───────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo hi\n' > "$repo/scripts/tool.sh"
printf 'assert_eq 1 1 "gc"\nassert_eq "$(bash scripts/tool.sh)" "hi" "runs"\n' > "$repo/tests/tool-gc.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/tool-gc.test.sh
mkdir -p "$repo/tests"
printf 'assert_eq 1 1 "other"\n' > "$repo/tests/unrelated.test.sh"
commit_all "$repo" "delete test, add unrelated"
run_case "$repo"
if has_kind deleted_line && has_text 'tests/tool-gc.test.sh'; then report N10 1; else report N10 0; fi

# ── F8 "|| fail" rewritten as "if ! cmd; then ... exit 1" ──────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests"
printf 'node build.js || fail "build failed"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
printf 'if ! node build.js\nthen\n  echo "build failed" >&2\n  exit 1\nfi\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "stricter form"
run_case "$repo"
if has_kind deleted_line; then report F8 0; else report F8 1; fi

# ── N11 same-stem "replacement" with only a comment / always-true guard ────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'echo hi\n' > "$repo/scripts/tool.sh"
printf 'assert_eq "$(bash scripts/tool.sh --gc)" "x" "gc works"\n' > "$repo/tests/tool-gc.test.sh"
commit_all "$repo" "base"
git -C "$repo" rm -q tests/tool-gc.test.sh
mkdir -p "$repo/tests"
printf '# gc removed\nif ! true; then exit 1; fi\n' > "$repo/tests/tool-gc-removed.test.sh"
commit_all "$repo" "delete test, add hollow same-stem file"
run_case "$repo"
if has_kind deleted_line && has_text 'tests/tool-gc.test.sh'; then report N11 1; else report N11 0; fi

finalize_test
