#!/usr/bin/env bash
# RED at fea2b7615: helper_exists — scripts/lib/gitconfig-containment.sh does not exist
# RED at fea2b7615: core.hooksPath missing from helper; also already present in dispatch-hetero.sh (comment)
# RED at fea2b7615: drift_dispatch_rc expected 0 got 1; gitconfig_drift absent; no WARNING
# RED at fea2b7615: credential.helper left as pre-existing+added-one+added-two; pushurl deleted; core.hookspath kept
# RED at fea2b7615: 6 passed, 12 failed, exit 1 (clean path had no drift key because nothing changed)
# Denylist containment for shared .git/config (BL-0074).
# The identity suite covers dispatch-hetero.sh only, so this suite does too.
. "$(dirname "$0")/lib.sh"

json_get() { echo "$1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);const p=process.argv[1].split('.');let v=o;for(const k of p){v=v?.[k];}console.log(v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v))}catch(e){console.log('')}})" "$2"; }

HELPER="$REPO_ROOT/scripts/lib/gitconfig-containment.sh"

denylist_bytes() {
  local root="$1" rec key outf="$2"
  : > "$outf"
  # shellcheck disable=SC1090
  . "$HELPER"
  while IFS= read -r -d '' rec || [ -n "$rec" ]; do
    [ -n "$rec" ] || continue
    key="${rec%%$'\n'*}"
    if gitconfig_key_on_denylist "$key"; then
      printf '%s\0' "$rec" >> "$outf"
    fi
  done < <(git -C "$root" config --local --list --null 2>/dev/null || true)
}

setup_mini_repo() {
  local repo_dir="$1"
  git init -qb main "$repo_dir"
  (
    cd "$repo_dir" || exit 9
    git config user.name "Real Owner"
    git config user.email "owner@example.com"
    git config --local remote.origin.pushurl "git@example.com:orig.git"
    git config --local --add credential.helper "pre-existing"
    git config --local autopilot-test.note "original-note"
    git commit -q --allow-empty -m base
  )
}

write_stub_bin() {
  local path="$1" variant="$2"
  cat > "$path" <<'EOF'
#!/usr/bin/env bash
case "$*" in
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
_hooks="$(mktemp -d)"
git config --local core.hooksPath "$_hooks"
git config --local --add credential.helper "added-one"
git config --local --add credential.helper "added-two"
git config --local --unset-all remote.origin.pushurl || true
git config --local autopilot-test.note "mutated-note"
echo hi > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF
  fi
  chmod +x "$path"
}

run_dispatch() {
  local repo="$1" branch="$2" prompt="$3" bin="$4" out="$5" sess="$6" tmp="$7"
  (
    cd "$repo" || exit 9
    DISPATCH_QUIET=1 \
    AUTOPILOT_DISPATCH_MANIFEST=0 \
    AUTOPILOT_SESSION_MODE_DIR="$sess" \
    TMPDIR="$tmp" \
    "$REPO_ROOT/scripts/dispatch-hetero.sh" \
      --branch "$branch" \
      --base main \
      --prompt-file "$prompt" \
      --runner codex \
      --model gpt-5.3-codex-spark \
      --codex-bin "$bin"
  ) > "$out" 2>&1
}

extract_json() {
  local out="$1" line json="" found=0
  while IFS= read -r line; do
    case "$line" in
      *"{"*) json="$line"; found=1 ;;
    esac
  done < "$out"
  [ "$found" -eq 1 ] || return 1
  printf '%s' "$json"
}

write_stub_bin "$TEST_TMP/codex-clean" "CLEAN"
write_stub_bin "$TEST_TMP/codex-drift" "DRIFT"

MINI_REPO="$TEST_TMP/mini_repo"
setup_mini_repo "$MINI_REPO"

# Denylist lives in exactly one place.
assert_file_exists "$HELPER" "helper_exists"
if ! grep -q 'core.hooksPath' "$HELPER"; then
  fail "denylist string core.hooksPath missing from helper"
fi
if grep -q 'core.hooksPath' "$REPO_ROOT/scripts/dispatch-hetero.sh"; then
  fail "denylist string core.hooksPath duplicated in dispatch-hetero.sh"
fi
if grep -q 'core.hooksPath' "$REPO_ROOT/scripts/dispatch-author.sh"; then
  fail "denylist string core.hooksPath duplicated in dispatch-author.sh"
fi

# CASE clean: no worker config change.
CLEAN_DIR="$TEST_TMP/clean_case"
mkdir -p "$CLEAN_DIR"
echo "do clean work" > "$TEST_TMP/prompt_clean.txt"
denylist_bytes "$MINI_REPO" "$TEST_TMP/clean_before.bin"
CLEAN_OUT="$TEST_TMP/clean_out.txt"
run_dispatch "$MINI_REPO" "gc-clean-001" "$TEST_TMP/prompt_clean.txt" \
  "$TEST_TMP/codex-clean" "$CLEAN_OUT" "$TEST_TMP/sess_clean" "$CLEAN_DIR"
rc=$?
assert_eq "$rc" 0 "clean_dispatch_rc"
clean_json="$(extract_json "$CLEAN_OUT")" || fail "No JSON object found in clean output"
assert_not_contains "$clean_json" "gitconfig_drift" "clean_no_gitconfig_drift_key"
assert_not_contains "$(cat "$CLEAN_OUT")" "git config drift" "clean_no_gitconfig_warning"
denylist_bytes "$MINI_REPO" "$TEST_TMP/clean_after.bin"
cmp -s "$TEST_TMP/clean_before.bin" "$TEST_TMP/clean_after.bin" \
  || fail "clean denylist projection changed"
assert_eq "$(git -C "$MINI_REPO" config --local autopilot-test.note)" "original-note" "clean_note_unchanged"

# CASE drift: hooksPath set, credential.helper multi-add, seeded pushurl deleted.
# Negative control: autopilot-test.note is off the denylist and must stick.
DRIFT_DIR="$TEST_TMP/drift_case"
mkdir -p "$DRIFT_DIR"
echo "introduce config drift" > "$TEST_TMP/prompt_drift.txt"
denylist_bytes "$MINI_REPO" "$TEST_TMP/drift_before.bin"
DRIFT_OUT="$TEST_TMP/drift_out.txt"
run_dispatch "$MINI_REPO" "gc-drift-001" "$TEST_TMP/prompt_drift.txt" \
  "$TEST_TMP/codex-drift" "$DRIFT_OUT" "$TEST_TMP/sess_drift" "$DRIFT_DIR"
drift_json="$(extract_json "$DRIFT_OUT")" || fail "No JSON object found in drift output"
denylist_bytes "$MINI_REPO" "$TEST_TMP/drift_after.bin"
cmp -s "$TEST_TMP/drift_before.bin" "$TEST_TMP/drift_after.bin" \
  || fail "drift denylist projection was not restored byte-for-byte"
assert_eq "$(json_get "$drift_json" "gitconfig_drift")" \
  '["core.hookspath","credential.helper","remote.origin.pushurl"]' "drift_gitconfig_drift_keys"
assert_not_contains "$(json_get "$drift_json" "gitconfig_drift")" "autopilot-test" "drift_denylist_not_blanket"
drift_warn="$(cat "$DRIFT_OUT")"
assert_contains "$drift_warn" "WARNING: git config drift detected" "drift_warning_present"
assert_contains "$drift_warn" "core.hookspath" "drift_warning_names_hookspath"
assert_contains "$drift_warn" "credential.helper" "drift_warning_names_helper"
assert_contains "$drift_warn" "remote.origin.pushurl" "drift_warning_names_pushurl"
assert_eq "$(git -C "$MINI_REPO" config --local autopilot-test.note)" "mutated-note" "negative_control_note_kept"
assert_eq "$(git -C "$MINI_REPO" config --local --get-all credential.helper)" "pre-existing" "helpers_restored_single"
assert_eq "$(git -C "$MINI_REPO" config --local --get remote.origin.pushurl)" "git@example.com:orig.git" "pushurl_restored"
if git -C "$MINI_REPO" config --local --get core.hookspath >/dev/null 2>&1; then
  fail "core.hookspath should have been deleted (it did not exist before)"
fi

finalize_test
