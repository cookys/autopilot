#!/usr/bin/env bash
# scan-fixture-literals.test.sh — BL-0031: fixture literals written into production code.
. "$(dirname "$0")/lib.sh"

S="$REPO_ROOT/scripts/scan-fixture-literals.js"
assert_file_exists "$S" "script present"

R="$TEST_TMP/repo"; mkdir -p "$R/scripts" "$R/hooks/tests"
git -C "$R" init -q; git -C "$R" config user.email t@t; git -C "$R" config user.name t
printf "module.exports = (s) => s.status === 'pending';\n" > "$R/scripts/handler.js"
git -C "$R" add -A; git -C "$R" commit -qm base
BASE="$(git -C "$R" rev-parse HEAD)"

# probe <CATCH|CLEAN> <label> <relative file> <line> [expected rule]
probe() {
  local want="$1" label="$2" file="$3" line="$4" rule="${5:-}"
  git -C "$R" reset -q --hard "$BASE"
  mkdir -p "$R/$(dirname "$file")"
  printf '%s\n' "$line" >> "$R/$file"
  git -C "$R" add -A; git -C "$R" commit -qm "probe: $label"
  local out rc=0
  out="$(node "$S" --repo "$R" --base "$BASE" --head HEAD 2>&1)" || rc=$?
  if [ "$want" = CATCH ]; then
    assert_exit_code "$rc" 1 "$label: flagged"
    [ -z "$rule" ] || assert_contains "$out" "\"rule\": \"$rule\"" "$label: rule $rule"
  else
    assert_exit_code "$rc" 0 "$label: clean"
  fi
}

probe CATCH 'phase carve-out (the original p7 incident)' scripts/handler.js "if (phase === 'p7') return true;" literal_compare
probe CATCH 'reversed comparison'           scripts/handler.js "if ('fixture-a' == name) go();"        literal_compare
probe CATCH 'case label'                    scripts/handler.js "  case 'test-seat': break;"            literal_compare
probe CATCH 'FIXTURE_ constant'             scripts/handler.js "const x = FIXTURE_SHA;"                 fixture_const
probe CATCH 'repeated-hex fake sha'         scripts/handler.js "const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';" fake_sha
probe CATCH 'deadbeef sha'                  scripts/handler.js "const sha = 'deadbeef00112233';"        fake_sha
probe CATCH 'fake tmp path'                 scripts/handler.js "const p = '/tmp/fixture-root/x';"       fake_path
probe CATCH 'shell script too'              scripts/run.sh     "[ \"\$1\" = x ] && P=/tmp/x; X=\"/path/to/thing\"" fake_path
probe CATCH 'test-mode branch'              scripts/handler.js "if (process.env.NODE_ENV === 'test') skip();" test_mode_branch
probe CLEAN 'same literal inside a test file'   scripts/handler.test.js "if (phase === 'p7') return true;"
probe CLEAN 'same literal under hooks/tests/'   hooks/tests/helper.js   "const sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';"
probe CLEAN 'comment-only line'             scripts/handler.js "// phase === 'p7' is how the test used to do it"
probe CLEAN 'explicit waiver marker'        scripts/handler.js "if (kind === 'test') run(); // fixture-literal-ok: real kind name"
probe CLEAN 'null OID (all zeros)'          scripts/handler.js "const z = '0000000000000000000000000000000000000000';"
probe CLEAN 'ordinary comparison'           scripts/handler.js "if (status === 'pending') run();"
probe CLEAN 'non-code file'                 docs/notes.md      "phase === 'p7'"

# a literal that was already in base is not re-flagged by an unrelated hands edit
git -C "$R" reset -q --hard "$BASE"
printf "if (phase === 'p7') old();\n" >> "$R/scripts/handler.js"
git -C "$R" add -A; git -C "$R" commit -qm "legacy literal"
LEGACY="$(git -C "$R" rev-parse HEAD)"
printf "const harmless = 1;\n" >> "$R/scripts/handler.js"
git -C "$R" add -A; git -C "$R" commit -qm "unrelated edit"
rc=0; node "$S" --repo "$R" --base "$LEGACY" >/dev/null 2>&1 || rc=$?
assert_exit_code "$rc" 0 "pre-existing literal is not re-flagged"

# could-not-run is exit 3, never a clean 0
rc=0; node "$S" --repo "$R" --base does-not-exist >/dev/null 2>&1 || rc=$?
assert_exit_code "$rc" 3 "unresolvable base is exit 3 (not verified)"
rc=0; node "$S" --repo "$R" >/dev/null 2>&1 || rc=$?
assert_exit_code "$rc" 2 "missing --base is a usage error"

# dispatch-hetero.sh advisory wrapper: branches on the scanner rc, never fails the gate
FN="$(sed -n '/^run_fixture_literal_advisory() {/,/^}/p' "$REPO_ROOT/scripts/dispatch-hetero.sh")"
assert_contains "$FN" "scan-fixture-literals.js" "advisory wrapper present in dispatch-hetero.sh"
adv() { # adv <stub-body> -> sets ADV_ERR, ADV_RC
  local d="$TEST_TMP/stub.$RANDOM"; mkdir -p "$d"
  printf '%s\n' "$1" > "$d/scan-fixture-literals.js"
  ADV_ERR="$(SELF_DIR="$d" WT=x BASE_SHA=a HEAD_SHA=b bash -c "set -e; $FN; run_fixture_literal_advisory; echo survived" 2>&1 >/dev/null)"
  ADV_RC=$?
  ADV_OUT="$(SELF_DIR="$d" WT=x BASE_SHA=a HEAD_SHA=b bash -c "set -e; $FN; run_fixture_literal_advisory; echo survived" 2>/dev/null)"
}
adv 'process.exit(0)';                                          assert_not_contains "$ADV_ERR" "hands-advisory" "rc0: silent"; assert_contains "$ADV_OUT" survived "rc0: gate survives"
adv 'console.log("{\"hits\":[1]}"); process.exit(1)';           assert_contains "$ADV_ERR" "hands-advisory" "rc1: hits printed"; assert_contains "$ADV_OUT" survived "rc1: gate survives"
adv 'process.exit(1)';                                          assert_not_contains "$ADV_ERR" "hands-advisory" "rc1 with empty stdout: silent"; assert_contains "$ADV_OUT" survived "rc1 empty: gate survives under set -e"
adv 'console.log("{\"ok\":false}"); process.exit(3)';          assert_not_contains "$ADV_ERR" "hands-advisory" "rc3: not printed as a hit"; assert_contains "$ADV_OUT" survived "rc3: gate survives"
adv 'process.exit(2)';                                          assert_not_contains "$ADV_ERR" "hands-advisory" "rc2: silent"; assert_contains "$ADV_OUT" survived "rc2: gate survives"

finalize_test
