#!/usr/bin/env bash
# check-test-integrity-precision.test.sh — BL-0060 planted controls.
# N cases are violations the precise rules must still report.
# F cases are synthetic false positives the precise rules must not report.
# RED at ecb84c9e5: F1 F2 F3 F4 failed on the unmodified base (checker still reported them); N1 N2 N3 N4 N5 N6 passed.
# RED at c65144649: N7 N8 F5 failed on the unmodified base.
# RED at 9cd17a5c6: F6 F7 F8 failed on the unmodified base (pure-add surface edit, same-topic replacement, if-! form still reported); N9 N10 passed.
# RED at da158d42d: F9 F10 failed on the unmodified base (net-0 surface edit, identifier-removed assertion still reported); N12 N13 passed.
# RED at 566272d61 (tirules round 1 head): N14 N15 N16 N17 N18 failed (rules 1-2 too loose: tautology rewrite, unrelated added assertion, comment-only/changed-line/message-token exemptions).
# RED at 42482c4ca (tirules round 3): N19 N20 failed (masking tail, self-comparison counted as equivalent); N21 passed.
# RED at 96e05a96b: F12 N28 failed (N27 passed); N29 N30 failed (continuation / heredoc wrapper accepted as equivalent): [[ < ]] treated as redirect; assertion function name counted as subject identifier.
# RED at 0d790a1b7: N11 failed on the base of this fix (hollow same-stem replacement exempted the deleted test).
# RED at d4415142e: F13 F14 F15 F16 F17 F18 failed (here-string / quoted / commented <<EOF opened a phantom heredoc, END-OF-FILE delimiter truncated, $expected_value subject dropped, [[ "$age"<"5" ]] without spaces rejected); N31 N32 passed.
# RED at d4415142e (acceptance round 5): N33 N34 N35 failed (replacement moved into an existing heredoc, or always true via ${age}, accepted as equivalent).
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

has_kind() { grep -q "\"kind\": \"$1\"" <<<"$CASE_OUT"; }
has_text() { grep -q "$1" <<<"$CASE_OUT"; }

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

# ── F9 rule 1: surface helper edited, assertion kept (net 0) ────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests/fixtures"
printf 'assert_eq "$a" "1" "x"\nexport A=1\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "base"
printf 'assert_eq "$a" "1" "x, with a longer message"\nexport A=2\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "parametrise helper"
run_case "$repo"
if has_kind surface_touch; then report F9 0; else report F9 1; fi

# ── N12 rule 1 control: surface helper loses an assertion, no replacement ──
repo="$(new_repo)"
mkdir -p "$repo/tests/fixtures"
printf 'assert_eq "$a" "1" "x"\nexport A=1\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "base"
printf 'export A=1\n' > "$repo/tests/fixtures/helper.sh"
commit_all "$repo" "drop helper assertion"
run_case "$repo"
if has_kind surface_touch && has_text 'tests/fixtures/helper.sh'; then report N12 1; else report N12 0; fi

# ── F10 rule 2: assertion removed with the identifier it tested ────────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'legacy_widget_key=1\nkeep=2\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$(grep legacy_widget_key scripts/conf.sh)" "x" "key"\nassert_eq "$(grep keep scripts/conf.sh)" "y" "keep"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "base"
printf 'keep=2\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$(grep keep scripts/conf.sh)" "y" "keep"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "remove key and its assertion"
run_case "$repo"
if has_kind deleted_line; then report F10 0; else report F10 1; fi

# ── N13 rule 2 control: assertion removed, identifier still in product ─────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'legacy_widget_key=1\nkeep=2\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$(grep legacy_widget_key scripts/conf.sh)" "x" "key"\nassert_eq "$(grep keep scripts/conf.sh)" "y" "keep"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "base"
printf 'legacy_widget_key=1\nkeep=3\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$(grep keep scripts/conf.sh)" "y" "keep"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "drop assertion, key stays"
run_case "$repo"
if has_kind deleted_line; then report N13 1; else report N13 0; fi

# surface-file fixture builder
mk_surface() { # mk_surface <old> <new>
  local r; r="$(new_repo)"
  printf '## Mode\nmode: block\n## Integrity Surface Paths\n- "harness/**"\n' > "$r/.claude/test-integrity-config.md"
  mkdir -p "$r/harness"
  printf '%s\n' "$1" > "$r/harness/lib.sh"
  commit_all "$r" "base"
  printf '%s\n' "$2" > "$r/harness/lib.sh"
  commit_all "$r" "edit"
  echo "$r"
}

# ── N14 rule 1: assertion rewritten into an always-true form ───────────────
repo="$(mk_surface 'check() { [ "$1" = "$2" ]; }' 'check() { [ 1 -eq 1 ]; }')"
run_case "$repo"
if has_kind surface_touch; then report N14 1; else report N14 0; fi

# ── N15 rule 1: unrelated added assertion must not offset a removed one ────
repo="$(mk_surface 'assert_eq "$actual" "$expected"' 'assert_eq "$other" "unrelated"')"
run_case "$repo"
if has_kind surface_touch; then report N15 1; else report N15 0; fi

# ── N15c rule 1: added assertion whose MESSAGE echoes the removed operands must not offset it ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_gt "$n" "1" "age was 0 before"')"
run_case "$repo"
if has_kind surface_touch; then report N15c 1; else report N15c 0; fi

# ── F11 rule 1: same-subject replacement with a message is still a replacement (no FP) ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "1" "age was 0 before"')"
run_case "$repo"
if has_kind surface_touch; then report F11 0; else report F11 1; fi

# ── N15b rule 1: self-comparison / && true tautologies are reported ────────
repo="$(mk_surface 'check() { [ "$1" = "$2" ]; }' 'check() { [ "$1" = "$2" ] && true; }')"
run_case "$repo"
if has_kind surface_touch; then report N15b 1; else report N15b 0; fi

# ── N16 rule 2: key removed from code but left in a comment ────────────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'legacy_widget_key=1\n# legacy_widget_key\n' > "$repo/scripts/foo.sh"
printf 'test_legacy_widget_key() {\n assert_eq "$legacy_widget_key" "1"\n}\nassert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
printf '# legacy_widget_key\n' > "$repo/scripts/foo.sh"
printf 'assert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "drop key, comment stays"
run_case "$repo"
if has_kind deleted_line; then report N16 1; else report N16 0; fi

# ── N17 rule 2: changed product line still uses the key (key=1 -> key=2) ───
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'legacy_widget_key=1\n' > "$repo/scripts/foo.sh"
printf 'assert_eq "$legacy_widget_key" "1"\nassert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
printf 'legacy_widget_key=2\n' > "$repo/scripts/foo.sh"
printf 'assert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "change key value, drop assertion"
run_case "$repo"
if has_kind deleted_line; then report N17 1; else report N17 0; fi

# ── N18 rule 2: only a message word matches a removed comment ──────────────
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'legacy_widget_key=1\n# obsolete_message\n' > "$repo/scripts/foo.sh"
printf 'assert_eq "$legacy_widget_key" "1" "obsolete_message"\nassert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "base"
printf 'legacy_widget_key=1\n' > "$repo/scripts/foo.sh"
printf 'assert_eq "$keep" "2"\n' > "$repo/tests/foo.test.sh"
commit_all "$repo" "drop comment and assertion"
run_case "$repo"
if has_kind deleted_line; then report N18 1; else report N18 0; fi

# ── N19 rule 1: failure-masking tail appended to the assertion ─────────────
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "0" || ! false')"
run_case "$repo"
if has_kind surface_touch; then report N19 1; else report N19 0; fi

# ── N20 rule 1: self-comparison rewrite is a tautology ─────────────────────
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "$age"')"
run_case "$repo"
if has_kind surface_touch; then report N20 1; else report N20 0; fi

# ── N21 rule 1: renamed subject stays reported ─────────────────────────────
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$years" "0"')"
run_case "$repo"
if has_kind surface_touch; then report N21 1; else report N21 0; fi

# ── N22 (c) if-then-fi: non-bare added line is not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'if assert_eq "$age" "0"; then :; fi')"
run_case "$repo"
if has_kind surface_touch; then report N22 1; else report N22 0; fi

# ── N23 (f) || true # ignored: non-bare added line is not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "0" || true # ignored')"
run_case "$repo"
if has_kind surface_touch; then report N23 1; else report N23 0; fi

# ── N24 && :: non-bare added line is not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "0" && :')"
run_case "$repo"
if has_kind surface_touch; then report N24 1; else report N24 0; fi

# ── N25 subshell || :: non-bare added line is not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' '( assert_eq "$age" "0" ) || :')"
run_case "$repo"
if has_kind surface_touch; then report N25 1; else report N25 0; fi

# ── N26 redirect || :: non-bare added line is not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "0" > /dev/null || :')"
run_case "$repo"
if has_kind surface_touch; then report N26 1; else report N26 0; fi

# ── F12 rule 1: [[ a < b ]] is a comparison operator, same-shape replacement is equivalent ──
repo="$(mk_surface '[[ "$age" < "5" ]]' '[[ "$age" < "9" ]]')"
run_case "$repo"
if has_kind surface_touch; then report F12 0; else report F12 1; fi

# ── N27 rule 1: single-bracket [ a < b ] is a redirect, never an equivalent ──
repo="$(mk_surface '[ "$age" < "5" ]' '[ "$age" < "9" ]')"
run_case "$repo"
if has_kind surface_touch; then report N27 1; else report N27 0; fi

# ── N28 rule 2: product deletes a helper named assert_eq; the removed assertion must still be reported ──
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'assert_eq() { :; }\nkeep=2\n' > "$repo/scripts/helper.sh"
printf 'assert_eq "$age" "0"\nassert_eq "$keep" "2"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "base"
printf 'keep=2\n' > "$repo/scripts/helper.sh"
printf 'assert_eq "$keep" "2"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "delete helper and assertion"
run_case "$repo"
if has_kind deleted_line; then report N28 1; else report N28 0; fi

# ── N29 rule 1: line continuation feeding || : swallows the failure ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'assert_eq "$age" "0" \\\n  || :')"
run_case "$repo"
if has_kind surface_touch; then report N29 1; else report N29 0; fi

# ── N30 rule 1: assertion wrapped in a heredoc is text, not an equivalent ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'cat <<\'EOF_BODY\'\nassert_eq "$age" "0"\nEOF_BODY')"
run_case "$repo"
if has_kind surface_touch; then report N30 1; else report N30 0; fi

# ── F13 rule 1: a here-string is not a heredoc opener ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'cat <<< hello\nassert_eq "$age" "5"')"
run_case "$repo"
if has_kind surface_touch; then report F13 0; else report F13 1; fi

# ── F14 rule 1: <<EOF inside a quoted string is data ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'echo \'use <<EOF\'\nassert_eq "$age" "5"')"
run_case "$repo"
if has_kind surface_touch; then report F14 0; else report F14 1; fi

# ── F15 rule 1: <<EOF inside a trailing comment is data ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'echo ok # use <<EOF\nassert_eq "$age" "5"')"
run_case "$repo"
if has_kind surface_touch; then report F15 0; else report F15 1; fi

# ── F16 rule 1: heredoc delimiter with a dash closes at its full name ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'cat <<END-OF-FILE\ntext\nEND-OF-FILE\nassert_eq "$age" "5"')"
run_case "$repo"
if has_kind surface_touch; then report F16 0; else report F16 1; fi

# ── N31 rule 1: assertion wrapped in a dash-delimited heredoc is still text ──
repo="$(mk_surface 'assert_eq "$age" "0"' $'cat <<END-OF-FILE\nassert_eq "$age" "5"\nEND-OF-FILE')"
run_case "$repo"
if has_kind surface_touch; then report N31 1; else report N31 0; fi

# ── F17 rule 2: subject variable named expected_value is a subject, removed with its assertion ──
repo="$(new_repo)"
mkdir -p "$repo/tests" "$repo/scripts"
printf 'expected_value=1\nkeep=2\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$expected_value" "1"\nassert_eq "$keep" "2"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "base"
printf 'keep=2\n' > "$repo/scripts/conf.sh"
printf 'assert_eq "$keep" "2"\n' > "$repo/tests/conf.test.sh"
commit_all "$repo" "remove variable and its assertion"
run_case "$repo"
if has_kind deleted_line; then report F17 0; else report F17 1; fi

# ── F18 rule 1: [[ a<b ]] without spaces is a comparison operator ──
repo="$(mk_surface '[[ "$age"<"5" ]]' '[[ "$age"<"9" ]]')"
run_case "$repo"
if has_kind surface_touch; then report F18 0; else report F18 1; fi

# ── N32 rule 1: [ a<b ] without spaces stays a redirect ──
repo="$(mk_surface '[ "$age"<"5" ]' '[ "$age"<"9" ]')"
run_case "$repo"
if has_kind surface_touch; then report N32 1; else report N32 0; fi

# ── N33 rule 1: replacement lands inside a heredoc that opens outside the hunk ──
repo="$(mk_surface $'cat <<\'END\'\ntext one\nplaceholder\nEND\nassert_eq "$age" "0"' $'cat <<\'END\'\ntext one\nassert_eq "$age" "5"\nEND')"
run_case "$repo"
if has_kind surface_touch; then report N33 1; else report N33 0; fi

# ── N34 rule 1: assertion rewritten to compare $age with ${age} is always true ──
repo="$(mk_surface 'assert_eq "$age" "0"' 'assert_eq "$age" "${age}"')"
run_case "$repo"
if has_kind surface_touch; then report N34 1; else report N34 0; fi

# ── N35 rule 1: [ "$age" = "${age}" ] is always true ──
repo="$(mk_surface '[ "$age" = "0" ]' '[ "$age" = "${age}" ]')"
run_case "$repo"
if has_kind surface_touch; then report N35 1; else report N35 0; fi

finalize_test
