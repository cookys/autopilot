#!/usr/bin/env bash
# check-test-integrity-precision.test.sh — BL-0060 planted controls.
# N cases are violations the precise rules must still report.
# F cases are synthetic false positives the precise rules must not report.
# RED at ecb84c9e5: F1 F2 F3 F4 failed on the unmodified base (checker still reported them); N1 N2 N3 N4 N5 N6 passed.
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

finalize_test
