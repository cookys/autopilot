#!/usr/bin/env bash
# Unit test for scripts/verify-red-green.sh
#
# Test design authored by glm-4.6 via dispatch-author (decorrelated from the codex
# implementer, /l6). Mechanical bash bugs fixed by depth-0 QC (see run-summary
# deviation): git output was polluting captured SHAs; product script needs `bash`
# to execute. Test scenarios / fixtures are as authored.

. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/verify-red-green.sh"

GIT="git -c user.email=t@t -c user.name=t -c init.defaultBranch=main -c commit.gpgsign=false"

# Create a git repo with a base commit (calc.sh only) and a head commit
# (calc.sh updated + calc.test.sh added). Echoes "<base_sha> <head_sha>".
# ALL git chatter is silenced so the captured stdout is the two SHAs only.
create_test_repo() {
    local repo="$1" base_calc="$2" head_calc="$3" test_content="$4"
    $GIT init "$repo" >/dev/null 2>&1

    printf '%s\n' "$base_calc" > "$repo/calc.sh"
    $GIT -C "$repo" add calc.sh >/dev/null 2>&1
    $GIT -C "$repo" commit -m base >/dev/null 2>&1
    local base_sha; base_sha=$($GIT -C "$repo" rev-parse HEAD)

    printf '%s\n' "$head_calc" > "$repo/calc.sh"
    printf '%s\n' "$test_content" > "$repo/calc.test.sh"
    $GIT -C "$repo" add calc.sh calc.test.sh >/dev/null 2>&1
    $GIT -C "$repo" commit -m "head with test" >/dev/null 2>&1
    local head_sha; head_sha=$($GIT -C "$repo" rev-parse HEAD)

    echo "$base_sha $head_sha"
}

# verify-cmd: receives worktree path as $1, cwd already set to it; runs calc.test.sh
# if present. Exit code IS the pass/fail signal (artifact, not self-report).
create_verify_cmd() {
    cat > "$1" <<'VERIFY_EOF'
#!/usr/bin/env bash
cd "$1" || exit 1
if [ -f "calc.test.sh" ]; then
    bash calc.test.sh
else
    exit 0
fi
VERIFY_EOF
    chmod +x "$1"
}

json_field() { echo "$1" | grep -o "\"$2\": *\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

# 1. VALIDATED: base calc prints 3, head prints 5, test requires 5.
#    test applied on base => RED (3 != 5); head => GREEN.
test_validated() {
    local repo="$TEST_TMP/repo_validated" vc="$TEST_TMP/verify_validated.sh"
    local receipt="$TEST_TMP/receipt_validated.json"
    local shas; shas=$(create_test_repo "$repo" "echo 3" "echo 5" '[ "$(bash calc.sh)" = "5" ]')
    local base head; base=${shas%% *}; head=${shas##* }
    create_verify_cmd "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" --receipt-out "$receipt" 2>&1); local ec=$?
    assert_eq "$ec" "0" "VALIDATED exits 0"
    assert_eq "$(json_field "$out" verdict)" "VALIDATED" "VALIDATED verdict"
    assert_contains "$out" '"red_green_validated": true' "VALIDATED sets red_green_validated true"
    assert_file_exists "$receipt" "VALIDATED writes a polarity receipt"
    assert_contains "$(cat "$receipt")" '"artifact_type": "red_green_polarity_receipt"' "receipt has polarity artifact type"
    assert_contains "$(cat "$receipt")" '"expected_red_exit_class": "nonzero"' "receipt binds expected red exit class"
    local validated; validated=$("$SCRIPT" --validate --receipt "$receipt" --repo "$repo" --verify-cmd "$vc" --assertion-artifact calc.test.sh 2>&1); ec=$?
    assert_eq "$ec" "0" "matching polarity receipt validates"
    assert_contains "$validated" '"status":"validated"' "matching polarity receipt returns validated status"
    "$SCRIPT" --validate --receipt "$receipt" --repo "$repo" --base "$head" --assertion-artifact calc.test.sh >/dev/null 2>&1; ec=$?
    assert_eq "$ec" "1" "cross-base polarity receipt is rejected"
    local other_vc="$TEST_TMP/verify_validated_other.sh"
    printf '%s\n' '#!/usr/bin/env bash' 'exit 0' > "$other_vc"
    chmod +x "$other_vc"
    "$SCRIPT" --validate --receipt "$receipt" --repo "$repo" --verify-cmd "$other_vc" --assertion-artifact calc.test.sh >/dev/null 2>&1; ec=$?
    assert_eq "$ec" "1" "cross-command polarity receipt is rejected"
    "$SCRIPT" --validate --receipt "$receipt" --repo "$repo" --verify-cmd "$vc" --assertion-artifact calc.sh >/dev/null 2>&1; ec=$?
    assert_eq "$ec" "1" "cross-assertion polarity receipt is rejected"
}

# 1b. VALIDATED with test at a NESTED path (tests/unit_test.sh) — regression guard:
#     the default globs must match test files at any depth, not just repo root.
test_validated_nested() {
    local repo="$TEST_TMP/repo_nested" vc="$TEST_TMP/verify_nested.sh"
    $GIT init "$repo" >/dev/null 2>&1
    mkdir -p "$repo/src" "$repo/tests"
    printf 'echo 2\n' > "$repo/src/prod.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m base >/dev/null 2>&1
    local base; base=$($GIT -C "$repo" rev-parse HEAD)
    printf 'echo 4\n' > "$repo/src/prod.sh"
    printf '[ "$(bash src/prod.sh)" = "4" ]\n' > "$repo/tests/unit_test.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m "fix + nested test" >/dev/null 2>&1
    local head; head=$($GIT -C "$repo" rev-parse HEAD)
    cat > "$vc" <<'VC_EOF'
#!/usr/bin/env bash
cd "$1" || exit 1
if [ -f tests/unit_test.sh ]; then bash tests/unit_test.sh; else exit 0; fi
VC_EOF
    chmod +x "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" 2>&1); local ec=$?
    assert_eq "$ec" "0" "nested-path VALIDATED exits 0"
    assert_eq "$(json_field "$out" verdict)" "VALIDATED" "nested-path VALIDATED verdict"
}

# 1c. A repo-owned verify script must execute from the matching detached
#     worktree. Reusing the caller checkout's HEAD script makes the base run
#     inspect HEAD production code and falsely report NOT_RED_ON_BASE.
test_repo_owned_verify_cmd_uses_worktree_copy() {
    local repo="$TEST_TMP/repo_owned_verify"
    $GIT init "$repo" >/dev/null 2>&1
    mkdir -p "$repo/tests"
    printf 'echo 3\n' > "$repo/calc.sh"
    cat > "$repo/tests/repo-owned.test.sh" <<'TEST_EOF'
#!/usr/bin/env bash
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(bash "$repo_dir/calc.sh")" = "3" ]
TEST_EOF
    chmod +x "$repo/tests/repo-owned.test.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m base >/dev/null 2>&1
    local base; base=$($GIT -C "$repo" rev-parse HEAD)

    printf 'echo 5\n' > "$repo/calc.sh"
    cat > "$repo/tests/repo-owned.test.sh" <<'TEST_EOF'
#!/usr/bin/env bash
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(bash "$repo_dir/calc.sh")" = "5" ]
TEST_EOF
    chmod +x "$repo/tests/repo-owned.test.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m head >/dev/null 2>&1
    local head; head=$($GIT -C "$repo" rev-parse HEAD)

    local out
    out=$("$SCRIPT" --range "$base..$head" \
        --verify-cmd "$repo/tests/repo-owned.test.sh" --repo "$repo" 2>&1)
    local ec=$?
    assert_eq "$ec" "0" "repo-owned verify-cmd VALIDATED exits 0"
    assert_eq "$(json_field "$out" verdict)" "VALIDATED" "repo-owned verify-cmd runs from each worktree"
    assert_contains "$out" '"tests/repo-owned.test.sh"' "repo-owned negative control is applied to base"
}

# 1d. A repo-owned verify executable introduced only at head is infrastructure,
#     not valid RED evidence. The base worktree must report INCONCLUSIVE instead
#     of treating command-not-found as a product/test failure.
test_repo_owned_verify_cmd_missing_on_base_is_inconclusive() {
    local repo="$TEST_TMP/repo_owned_verify_missing_base"
    $GIT init "$repo" >/dev/null 2>&1
    printf 'echo 3\n' > "$repo/calc.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m base >/dev/null 2>&1
    local base; base=$($GIT -C "$repo" rev-parse HEAD)

    mkdir -p "$repo/tests" "$repo/tools"
    printf '[ "$(bash calc.sh)" = "3" ]\n' > "$repo/tests/new.test.sh"
    cat > "$repo/tools/new-verify.sh" <<'VERIFY_EOF'
#!/usr/bin/env bash
bash tests/new.test.sh
VERIFY_EOF
    chmod +x "$repo/tools/new-verify.sh"
    $GIT -C "$repo" add -A >/dev/null 2>&1
    $GIT -C "$repo" commit -m "head adds verify command" >/dev/null 2>&1
    local head; head=$($GIT -C "$repo" rev-parse HEAD)

    local out
    out=$("$SCRIPT" --range "$base..$head" \
        --verify-cmd "$repo/tools/new-verify.sh" --repo "$repo" 2>&1)
    local ec=$?
    assert_eq "$ec" "3" "base-missing repo-owned verify-cmd exits 3"
    assert_eq "$(json_field "$out" verdict)" "INCONCLUSIVE" "base-missing repo-owned verify-cmd is inconclusive"
    assert_contains "$out" 'base-verify-cmd-missing-or-not-executable' "base-missing reason names verify-cmd infrastructure"
}

# 2. NOT_RED_ON_BASE: test only checks file existence (true at base too) => base GREEN.
test_not_red_on_base() {
    local repo="$TEST_TMP/repo_not_red" vc="$TEST_TMP/verify_not_red.sh"
    local shas; shas=$(create_test_repo "$repo" "echo 3" "echo 5" '[ -f calc.sh ]')
    local base head; base=${shas%% *}; head=${shas##* }
    create_verify_cmd "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" 2>&1); local ec=$?
    assert_eq "$ec" "1" "NOT_RED_ON_BASE exits 1"
    assert_eq "$(json_field "$out" verdict)" "NOT_RED_ON_BASE" "NOT_RED_ON_BASE verdict"
}

# 3. NOT_GREEN_ON_HEAD: test asserts a false value (99) => fails even at head.
test_not_green_on_head() {
    local repo="$TEST_TMP/repo_not_green" vc="$TEST_TMP/verify_not_green.sh"
    local shas; shas=$(create_test_repo "$repo" "echo 3" "echo 5" '[ "$(bash calc.sh)" = "99" ]')
    local base head; base=${shas%% *}; head=${shas##* }
    create_verify_cmd "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" 2>&1); local ec=$?
    assert_eq "$ec" "1" "NOT_GREEN_ON_HEAD exits 1"
    assert_eq "$(json_field "$out" verdict)" "NOT_GREEN_ON_HEAD" "NOT_GREEN_ON_HEAD verdict"
}

# 4. INCONCLUSIVE: diff has no test file (only calc.sh changed).
test_inconclusive_no_test_files() {
    local repo="$TEST_TMP/repo_inconclusive" vc="$TEST_TMP/verify_inc.sh"
    $GIT init "$repo" >/dev/null 2>&1
    printf 'echo 3\n' > "$repo/calc.sh"
    $GIT -C "$repo" add calc.sh >/dev/null 2>&1
    $GIT -C "$repo" commit -m base >/dev/null 2>&1
    local base; base=$($GIT -C "$repo" rev-parse HEAD)
    printf 'echo 5\n' > "$repo/calc.sh"
    $GIT -C "$repo" add calc.sh >/dev/null 2>&1
    $GIT -C "$repo" commit -m head >/dev/null 2>&1
    local head; head=$($GIT -C "$repo" rev-parse HEAD)
    create_verify_cmd "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" 2>&1); local ec=$?
    assert_eq "$ec" "3" "INCONCLUSIVE exits 3"
    assert_eq "$(json_field "$out" verdict)" "INCONCLUSIVE" "INCONCLUSIVE verdict"
    assert_contains "$out" "no-test-files" "INCONCLUSIVE reason mentions no-test-files"
}

# 5. --help exits 0.
test_help() {
    local out; out=$("$SCRIPT" --help 2>&1); local ec=$?
    assert_eq "$ec" "0" "--help exits 0"
    assert_contains "$out" "Usage:" "--help prints Usage"
}

# 6. bogus flag exits 2.
test_invalid_flag() {
    "$SCRIPT" --bogus-flag >/dev/null 2>&1
    assert_eq "$?" "2" "bogus flag exits 2"
}

# 7. missing --verify-cmd exits 2.
test_missing_verify_cmd() {
    local repo="$TEST_TMP/repo_missing"
    $GIT init "$repo" >/dev/null 2>&1
    $GIT -C "$repo" commit --allow-empty -m base >/dev/null 2>&1
    "$SCRIPT" --range "HEAD..HEAD" --repo "$repo" >/dev/null 2>&1
    assert_eq "$?" "2" "missing --verify-cmd exits 2"
}

# 8. Relative --verify-cmd is canonicalized against the CALLER's cwd at startup
#    (regression: the executable check ran in caller cwd but execution cd'd into
#    detached worktrees, so a relative path silently failed as NOT_GREEN_ON_HEAD).
test_relative_verify_cmd() {
    local repo="$TEST_TMP/repo_relvc"
    local shas; shas=$(create_test_repo "$repo" "echo 3" "echo 5" '[ "$(bash calc.sh)" = "5" ]')
    local base head; base=${shas%% *}; head=${shas##* }
    create_verify_cmd "$TEST_TMP/verify_rel.sh"
    local out ec
    out=$(cd "$TEST_TMP" && "$SCRIPT" --range "$base..$head" --verify-cmd "./verify_rel.sh" --repo "$repo" 2>&1); ec=$?
    assert_eq "$ec" "0" "relative verify-cmd VALIDATED exits 0"
    assert_eq "$(json_field "$out" verdict)" "VALIDATED" "relative verify-cmd VALIDATED verdict"
    (cd "$TEST_TMP" && "$SCRIPT" --range "$base..$head" --verify-cmd "./no_such_cmd.sh" --repo "$repo") >/dev/null 2>&1
    assert_eq "$?" "2" "nonexistent relative verify-cmd exits 2 (named error)"
}

# 9. json_escape yields valid JSON for control chars (\n \t \r \b \f, other
#    <0x20 as \u00XX) plus quote and backslash (regression: only \ and " were
#    escaped, so a crafted path/reason string produced invalid JSON).
test_json_escape_control_chars() {
    eval "$(sed -n '/^json_escape()/,/^}$/p' "$SCRIPT")"
    local out; out=$(json_escape $'a\nb\tc\rd\be\ff"g\\h\x01i')
    assert_eq "$out" 'a\nb\tc\rd\be\ff\"g\\h\u0001i' "json_escape escapes control chars + quote + backslash"
}

# 10. Relative --verify-cmd whose dirname component is a PLAIN FILE must exit 2
#     with a named error — never abort uncleanly via set -e during
#     canonicalization (the cd is wrapped in a conditional).
test_verify_cmd_dirname_plain_file() {
    local repo="$TEST_TMP/repo_dirname"
    $GIT init "$repo" >/dev/null 2>&1
    $GIT -C "$repo" commit --allow-empty -m base >/dev/null 2>&1
    : > "$TEST_TMP/plainfile"
    local err ec
    err=$(cd "$TEST_TMP" && "$SCRIPT" --range "HEAD..HEAD" --verify-cmd "plainfile/cmd.sh" --repo "$repo" 2>&1 >/dev/null); ec=$?
    assert_eq "$ec" "2" "plain-file dirname verify-cmd exits 2 (named error)"
    assert_contains "$err" "verify-cmd" "plain-file dirname error names verify-cmd"
}

test_validated
test_validated_nested
test_repo_owned_verify_cmd_uses_worktree_copy
test_repo_owned_verify_cmd_missing_on_base_is_inconclusive
test_not_red_on_base
test_not_green_on_head
test_inconclusive_no_test_files
test_help
test_invalid_flag
test_missing_verify_cmd
test_relative_verify_cmd
test_json_escape_control_chars
test_verify_cmd_dirname_plain_file

finalize_test
