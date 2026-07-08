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
    local shas; shas=$(create_test_repo "$repo" "echo 3" "echo 5" '[ "$(bash calc.sh)" = "5" ]')
    local base head; base=${shas%% *}; head=${shas##* }
    create_verify_cmd "$vc"
    local out; out=$("$SCRIPT" --range "$base..$head" --verify-cmd "$vc" --repo "$repo" 2>&1); local ec=$?
    assert_eq "$ec" "0" "VALIDATED exits 0"
    assert_eq "$(json_field "$out" verdict)" "VALIDATED" "VALIDATED verdict"
    assert_contains "$out" '"red_green_validated": true' "VALIDATED sets red_green_validated true"
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

test_validated
test_not_red_on_base
test_not_green_on_head
test_inconclusive_no_test_files
test_help
test_invalid_flag
test_missing_verify_cmd

finalize_test
