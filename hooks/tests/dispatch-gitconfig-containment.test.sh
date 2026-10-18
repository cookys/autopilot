#!/usr/bin/env bash
# RED at ea60a552e: FAIL env_unregistered: AUTOPILOT_GITCONFIG_CONTAINMENT_SH - read in scripts/lib/gitconfig-containment.sh but not in the registry
# RED at 0ae19923b: check-tmp-residue-registry.js exit 1, 6 findings in scripts/lib/gitconfig-containment.sh (unregistered_prefix gitconfig-containment-raw. gitconfig-containment. gitconfig-containment-s. gitconfig-containment-c. gitconfig-containment-cur. gitconfig-containment-after.)
# RED at fea2b7615: helper_exists — scripts/lib/gitconfig-containment.sh does not exist
# RED at fea2b7615: core.hooksPath missing from helper; also already present in dispatch-hetero.sh (comment)
# RED at fea2b7615: drift_dispatch_rc expected 0 got 1; gitconfig_drift absent; no WARNING
# RED at fea2b7615: credential.helper left as pre-existing+added-one+added-two; pushurl deleted; core.hookspath kept
# RED at fea2b7615: 6 passed, 12 failed, exit 1 (clean path had no drift key because nothing changed)
# RED at cd13ca060: restore returns 0, no "restore FAILED" warning, stderr still says "restored the original values", JSON has no gitconfig_restore_failed
# RED at cd13ca060: snapshot --list failure is swallowed; remote.origin.url and credential.helper are deleted; no snapshot-failed WARNING
# RED at cd13ca060: http.extraheader stays set and is absent from gitconfig_drift
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
# Comment lines (first non-blank character is #) may name the key; the denylist
# value itself must not be copied into either rail.
if grep -vE '^[[:space:]]*#' "$REPO_ROOT/scripts/dispatch-hetero.sh" | grep -q 'core.hooksPath'; then
  fail "denylist string core.hooksPath duplicated in dispatch-hetero.sh"
fi
if grep -vE '^[[:space:]]*#' "$REPO_ROOT/scripts/dispatch-author.sh" | grep -q 'core.hooksPath'; then
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

REAL_GIT="$(command -v git)"
FAKE_BIN="$TEST_TMP/fakebin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/git" <<EOF
#!/usr/bin/env bash
real="$REAL_GIT"
joined=" \$* "
if [ -n "\${GITCONFIG_FAIL_LIST_MARKER:-}" ] && [ -f "\${GITCONFIG_FAIL_LIST_MARKER}" ]; then
  case "\$joined" in
    *" config --local --list "*)
      rm -f "\${GITCONFIG_FAIL_LIST_MARKER}"
      echo "forced list failure" >&2
      exit 1
      ;;
  esac
fi
if [ "\${GITCONFIG_BREAK_WRITES:-}" = "1" ]; then
  case "\$joined" in
    *" config --local --unset-all "*|*" config --local --add "*)
      echo "forced write failure" >&2
      exit 1
      ;;
  esac
fi
exec "\$real" "\$@"
EOF
chmod +x "$FAKE_BIN/git"

# (a) restore failure — library return code, then the dispatch JSON flag.
FAIL_REPO="$TEST_TMP/fail_repo"
setup_mini_repo "$FAIL_REPO"
# shellcheck disable=SC1090
. "$HELPER"
gitconfig_containment_snapshot "$FAIL_REPO"
git -C "$FAIL_REPO" config --local core.hooksPath "/tmp/evil-hooks"
FAIL_ERR="$TEST_TMP/lib_restore_err.txt"
lib_rc=0
# A read-only config is not enough: git config replaces the file via the
# directory. The wrapper refuses --unset-all and --add so the replay cannot land.
GITCONFIG_BREAK_WRITES=1 PATH="$FAKE_BIN:$PATH" \
  gitconfig_containment_restore "$FAIL_REPO" "$GITCONFIG_SNAPSHOT_FILE" >/tmp/gc-restore-out.txt 2>"$FAIL_ERR" || lib_rc=$?
if [ "$lib_rc" -eq 0 ]; then
  fail "library restore returned 0 after a failed replay"
fi
assert_contains "$(cat "$FAIL_ERR")" "WARNING: git config restore FAILED" "lib_restore_failed_warning"
assert_contains "$(cat "$FAIL_ERR")" "core.hookspath" "lib_restore_failed_names_key"

RF_DIR="$TEST_TMP/restore_fail_case"
mkdir -p "$RF_DIR"
echo "break restore" > "$TEST_TMP/prompt_restore_fail.txt"
write_stub_bin "$TEST_TMP/codex-restore-fail" "CLEAN"
# The CLEAN stub does not mutate config; append a hooksPath write. Writes go
# through the wrapper, which only refuses --unset-all and --add.
cat >> "$TEST_TMP/codex-restore-fail" <<'EOF'
git config --local core.hooksPath "/tmp/evil-hooks-dispatch"
EOF
# The CLEAN body already exited 0 above the append. Rebuild so the mutation
# happens before exit.
cat > "$TEST_TMP/codex-restore-fail" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
git config --local core.hooksPath "/tmp/evil-hooks-dispatch"
echo hi > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF
chmod +x "$TEST_TMP/codex-restore-fail"
RF_OUT="$TEST_TMP/restore_fail_out.txt"
(
  cd "$FAIL_REPO" || exit 9
  GITCONFIG_BREAK_WRITES=1 \
  PATH="$FAKE_BIN:$PATH" \
  DISPATCH_QUIET=1 \
  AUTOPILOT_DISPATCH_MANIFEST=0 \
  AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sess_restore_fail" \
  TMPDIR="$RF_DIR" \
  "$REPO_ROOT/scripts/dispatch-hetero.sh" \
    --branch "gc-restore-fail" \
    --base main \
    --prompt-file "$TEST_TMP/prompt_restore_fail.txt" \
    --runner codex \
    --model gpt-5.3-codex-spark \
    --codex-bin "$TEST_TMP/codex-restore-fail"
) > "$RF_OUT" 2>&1 || true
rf_json="$(extract_json "$RF_OUT")" || fail "No JSON object found in restore-fail output"
rf_text="$(cat "$RF_OUT")"
assert_contains "$rf_text" "WARNING: git config restore FAILED" "dispatch_restore_failed_warning"
assert_contains "$rf_text" "core.hookspath" "dispatch_restore_failed_names_key"
assert_not_contains "$rf_text" "restored the original values" "dispatch_restore_failed_no_restored_wording"
assert_contains "$rf_json" '"gitconfig_restore_failed": true' "dispatch_gitconfig_restore_failed_json"
chmod u+w "$FAIL_REPO/.git/config" 2>/dev/null || true

# (b) snapshot failure must not delete legitimate denylist entries.
SNAP_REPO="$TEST_TMP/snap_repo"
setup_mini_repo "$SNAP_REPO"
git -C "$SNAP_REPO" config --local remote.origin.url "git@example.com:orig.git"
git -C "$SNAP_REPO" config --local credential.helper "keep-me"
SNAP_DIR="$TEST_TMP/snap_case"
mkdir -p "$SNAP_DIR"
echo "snapshot fails" > "$TEST_TMP/prompt_snap.txt"
SNAP_OUT="$TEST_TMP/snap_out.txt"
SNAP_MARKER="$TEST_TMP/fail-list-once"
: > "$SNAP_MARKER"
(
  cd "$SNAP_REPO" || exit 9
  GITCONFIG_FAIL_LIST_MARKER="$SNAP_MARKER" \
  PATH="$FAKE_BIN:$PATH" \
  DISPATCH_QUIET=1 \
  AUTOPILOT_DISPATCH_MANIFEST=0 \
  AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sess_snap" \
  TMPDIR="$SNAP_DIR" \
  "$REPO_ROOT/scripts/dispatch-hetero.sh" \
    --branch "gc-snap-fail" \
    --base main \
    --prompt-file "$TEST_TMP/prompt_snap.txt" \
    --runner codex \
    --model gpt-5.3-codex-spark \
    --codex-bin "$TEST_TMP/codex-clean"
) > "$SNAP_OUT" 2>&1 || true
snap_text="$(cat "$SNAP_OUT")"
assert_contains "$snap_text" "WARNING: git config snapshot failed" "snapshot_failed_warning"
assert_eq "$(git -C "$SNAP_REPO" config --local --get remote.origin.url)" "git@example.com:orig.git" "snapshot_fail_keeps_remote_url"
assert_eq "$(git -C "$SNAP_REPO" config --local --get credential.helper)" "keep-me" "snapshot_fail_keeps_credential_helper"

# (c) subsection-less http.extraHeader is on the denylist.
HTTP_REPO="$TEST_TMP/http_repo"
setup_mini_repo "$HTTP_REPO"
HTTP_DIR="$TEST_TMP/http_case"
mkdir -p "$HTTP_DIR"
echo "set extraheader" > "$TEST_TMP/prompt_http.txt"
cat > "$TEST_TMP/codex-http" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
git config --local http.extraHeader "secret-token"
echo hi > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF
chmod +x "$TEST_TMP/codex-http"
HTTP_OUT="$TEST_TMP/http_out.txt"
run_dispatch "$HTTP_REPO" "gc-http-001" "$TEST_TMP/prompt_http.txt" \
  "$TEST_TMP/codex-http" "$HTTP_OUT" "$TEST_TMP/sess_http" "$HTTP_DIR"
http_json="$(extract_json "$HTTP_OUT")" || fail "No JSON object found in http output"
assert_contains "$(json_get "$http_json" "gitconfig_drift")" "http.extraheader" "http_extraheader_in_drift"
if git -C "$HTTP_REPO" config --local --get http.extraheader >/dev/null 2>&1; then
  fail "http.extraheader should have been removed"
fi

# (d) wildcard subsections and mixed-case keys.
WILD_REPO="$TEST_TMP/wild_repo"
setup_mini_repo "$WILD_REPO"
git -C "$WILD_REPO" config --local 'url.https://example.com/.insteadOf' 'https://old.example/'
git -C "$WILD_REPO" config --local 'credential.https://example.com.helper' 'old-helper'
git -C "$WILD_REPO" config --local 'includeIf.gitdir:/tmp/x.path' '/old/path'
git -C "$WILD_REPO" config --local 'Core.HooksPath' '/old/hooks'
git -C "$WILD_REPO" config --local 'CORE.sshCommand' 'ssh -o BatchMode=yes'
denylist_bytes "$WILD_REPO" "$TEST_TMP/wild_before.bin"
WILD_DIR="$TEST_TMP/wild_case"
mkdir -p "$WILD_DIR"
echo "mutate wildcards" > "$TEST_TMP/prompt_wild.txt"
cat > "$TEST_TMP/codex-wild" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *"exec --help"*) printf -- '--dangerously-bypass-approvals-and-sandbox\n--dangerously-bypass-hook-trust\n'; exit 0 ;;
  *"--version"*)   echo "codex-cli 9.9.9 (test stub)"; exit 0 ;;
esac
git config --local 'url.https://example.com/.insteadOf' 'https://evil.example/'
git config --local --unset-all 'credential.https://example.com.helper' || true
git config --local 'includeIf.gitdir:/tmp/x.path' '/evil/path'
git config --local --unset-all core.hookspath || true
git config --local 'CORE.sshCommand' 'ssh evil'
echo hi > done.txt
git add done.txt
git -c user.email=t@t -c user.name=t commit -qm w
exit 0
EOF
chmod +x "$TEST_TMP/codex-wild"
WILD_OUT="$TEST_TMP/wild_out.txt"
run_dispatch "$WILD_REPO" "gc-wild-001" "$TEST_TMP/prompt_wild.txt" \
  "$TEST_TMP/codex-wild" "$WILD_OUT" "$TEST_TMP/sess_wild" "$WILD_DIR"
wild_json="$(extract_json "$WILD_OUT")" || fail "No JSON object found in wildcard output"
denylist_bytes "$WILD_REPO" "$TEST_TMP/wild_after.bin"
cmp -s "$TEST_TMP/wild_before.bin" "$TEST_TMP/wild_after.bin" \
  || fail "wildcard denylist projection was not restored byte-for-byte"
wild_drift="$(json_get "$wild_json" "gitconfig_drift")"
assert_contains "$wild_drift" "url.https://example.com/.insteadof" "wild_insteadof_reported"
assert_contains "$wild_drift" "credential.https://example.com.helper" "wild_credential_url_reported"
assert_contains "$wild_drift" "includeif.gitdir:/tmp/x.path" "wild_includeif_reported"
assert_contains "$wild_drift" "core.hookspath" "wild_mixed_hookspath_reported"
assert_contains "$wild_drift" "core.sshcommand" "wild_mixed_sshcommand_reported"

# (e) dispatch-author.sh loads the helper and restores core.hooksPath.
AUTHOR_REPO="$TEST_TMP/author_repo"
setup_mini_repo "$AUTHOR_REPO"
echo "author drift" > "$TEST_TMP/prompt_author.txt"
cat > "$TEST_TMP/author-stub" <<'EOF'
#!/usr/bin/env bash
echo "OpenAI Codex v0.test.0" >&2
echo "--------" >&2
echo "session id: 00000000-0000-4000-8000-000000000000" >&2
echo "--------" >&2
sidecar=""
args=("$@")
i=0
while [ "$i" -lt "${#args[@]}" ]; do
  if [ "${args[$i]}" = "--output-last-message" ]; then
    i=$((i + 1))
    if [ "$i" -lt "${#args[@]}" ]; then
      sidecar="${args[$i]}"
    fi
  fi
  i=$((i + 1))
done
git config --local core.hooksPath "/tmp/author-evil-hooks"
if [ -n "$sidecar" ]; then
  printf '%s' "OK-WRITTEN" > "$sidecar"
fi
echo "OK-WRITTEN"
EOF
chmod +x "$TEST_TMP/author-stub"
AUTHOR_OUT="$TEST_TMP/author_out.txt"
(
  cd "$AUTHOR_REPO" || exit 9
  DISPATCH_QUIET=1 \
  AUTOPILOT_SESSION_MODE_DIR="$TEST_TMP/sess_author" \
  "$REPO_ROOT/scripts/dispatch-author.sh" \
    --runner codex --model gpt-5.5 \
    --prompt-file "$TEST_TMP/prompt_author.txt" \
    --bin "$TEST_TMP/author-stub" \
    --repo-root "$AUTHOR_REPO"
) > "$AUTHOR_OUT" 2>&1 || true
author_json="$(extract_json "$AUTHOR_OUT")" || fail "No JSON object found in author output"
assert_contains "$(json_get "$author_json" "gitconfig_drift")" "core.hookspath" "author_gitconfig_drift"
if git -C "$AUTHOR_REPO" config --local --get core.hookspath >/dev/null 2>&1; then
  fail "author rail left core.hookspath in place"
fi

# The tmp-residue gate must accept the helper's single registered mktemp prefix.
reg_rc=0
reg_out="$(node "$REPO_ROOT/scripts/check-tmp-residue-registry.js" 2>&1)" || reg_rc=$?
assert_exit_code "$reg_rc" 0 "tmp_residue_registry_check"
if [ "$reg_rc" != 0 ]; then
  printf '%s\n' "$reg_out" >&2
fi

# The settings registry must list the helper's include-guard env var.
cfg_rc=0
cfg_out="$(node "$REPO_ROOT/scripts/check-config-docs.js" 2>&1)" || cfg_rc=$?
assert_exit_code "$cfg_rc" 0 "config_docs_registry_check"
if [ "$cfg_rc" != 0 ]; then
  printf '%s\n' "$cfg_out" >&2
fi

finalize_test
