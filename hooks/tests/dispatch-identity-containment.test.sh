#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

json_get() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"; }

setup_mini_repo() {
    local repo_dir="$1"
    git init -qb main "$repo_dir"
    (
        cd "$repo_dir" || exit 9
        git config user.name "Real Owner"
        git config user.email "owner@example.com"
        git commit -q --allow-empty -m base
    )
}

write_stub_bin() {
    local path="$1"
    local variant="$2"
    cat > "$path" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
EOF
    if [ "$variant" = "CLEAN" ]; then
        cat >> "$path" <<'EOF'
echo hi > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF
    elif [ "$variant" = "DRIFT" ]; then
        cat >> "$path" <<'EOF'
git config user.name "Evil Bot"
git config user.email "evil@bot.local"
echo hi > done.txt
git add done.txt
git commit -qm w
exit 0
EOF
    fi
    chmod +x "$path"
}

PROBE_DIR="$TEST_TMP/probe_worktree"
write_stub_bin "$TEST_TMP/codex-clean" "CLEAN"
write_stub_bin "$TEST_TMP/codex-drift" "DRIFT"

MINI_REPO="$TEST_TMP/mini_repo"
setup_mini_repo "$MINI_REPO"
assert_file_exists "$MINI_REPO/.git" "mini_repo_git_dir_exists"

# CASE 3: DRIFT-detect-negative-control (runs first to validate the shared-config passthrough)
CONTROL_OUT="$TEST_TMP/control_out.txt"
(
    cd "$MINI_REPO" || exit 9
    git worktree add "$PROBE_DIR" -b probe main
    (
        cd "$PROBE_DIR" || exit 9
        git config user.name "Probe Bot"
    )
) > "$CONTROL_OUT" 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then
    fail "control worktree setup failed with rc=$rc. Output:\n$(cat "$CONTROL_OUT")"
fi

probe_name=$(git -C "$MINI_REPO" config user.name)
assert_eq "Probe Bot" "$probe_name" "control_probe_name_passthrough"
probe_email=$(git -C "$MINI_REPO" config user.email)
assert_eq "owner@example.com" "$probe_email" "control_probe_email_passthrough"

git -C "$MINI_REPO" config user.name "Real Owner"
git -C "$MINI_REPO" worktree remove "$PROBE_DIR" --force
git -C "$MINI_REPO" branch -D probe

# CASE 1: CLEAN
CLEAN_DIR="$TEST_TMP/clean_case"
mkdir -p "$CLEAN_DIR"
PROMPT_CLEAN="$TEST_TMP/prompt_clean.txt"
echo "do clean work" > "$PROMPT_CLEAN"
CLEAN_OUT="$TEST_TMP/clean_out.txt"
(
    cd "$MINI_REPO" || exit 9
    DISPATCH_QUIET=1 \
    AUTOPILOT_DISPATCH_MANIFEST=0 \
    AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sess_empty_clean" \
    TMPDIR="$CLEAN_DIR" \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" \
        --branch clean-dispatch-001 \
        --base main \
        --prompt-file "$PROMPT_CLEAN" \
        --runner codex \
        --model gpt-5.3-codex-spark \
        --codex-bin "$TEST_TMP/codex-clean"
) > "$CLEAN_OUT" 2>&1
rc=$?
assert_eq 0 "$rc" "clean_dispatch_rc"

clean_json=""
clean_found=0
while IFS= read -r line; do
    case "$line" in
        *"{"*) clean_json="$line"; clean_found=1 ;;
    esac
done < "$CLEAN_OUT"
if [ "$clean_found" -eq 0 ]; then
    fail "No JSON object found in clean output"
fi

assert_eq "committed" "$(json_get "$clean_json" "status")" "clean_status_committed"
assert_not_contains "$clean_json" "identity_drift" "clean_no_identity_drift_key"

clean_name=$(git -C "$MINI_REPO" config user.name)
clean_email=$(git -C "$MINI_REPO" config user.email)
assert_eq "Real Owner" "$clean_name" "clean_repo_user_name_restored"
assert_eq "owner@example.com" "$clean_email" "clean_repo_user_email_restored"

# CASE 2: DRIFT
DRIFT_DIR="$TEST_TMP/drift_case"
mkdir -p "$DRIFT_DIR"
PROMPT_DRIFT="$TEST_TMP/prompt_drift.txt"
echo "introduce drift" > "$PROMPT_DRIFT"
DRIFT_OUT="$TEST_TMP/drift_out.txt"
(
    cd "$MINI_REPO" || exit 9
    DISPATCH_QUIET=1 \
    AUTOPILOT_DISPATCH_MANIFEST=0 \
    AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sess_empty_drift" \
    TMPDIR="$DRIFT_DIR" \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" \
        --branch drift-dispatch-001 \
        --base main \
        --prompt-file "$PROMPT_DRIFT" \
        --runner codex \
        --model gpt-5.3-codex-spark \
        --codex-bin "$TEST_TMP/codex-drift"
) > "$DRIFT_OUT" 2>&1
rc=$?

drift_json=""
drift_found=0
while IFS= read -r line; do
    case "$line" in
        *"{"*) drift_json="$line"; drift_found=1 ;;
    esac
done < "$DRIFT_OUT"
if [ "$drift_found" -eq 0 ]; then
    fail "No JSON object found in drift output"
fi

assert_eq "true" "$(json_get "$drift_json" "identity_drift")" "drift_identity_drift_true"
assert_contains "$(cat "$DRIFT_OUT")" "identity drift" "drift_loud_warning_present"

drift_name=$(git -C "$MINI_REPO" config user.name)
drift_email=$(git -C "$MINI_REPO" config user.email)
assert_eq "Real Owner" "$drift_name" "drift_repo_user_name_restored"
assert_eq "owner@example.com" "$drift_email" "drift_repo_user_email_restored"

finalize_test