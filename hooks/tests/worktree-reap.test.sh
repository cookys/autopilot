#!/usr/bin/env bash
# worktree-reap.sh lib unit tests — reap_worktree / reap_worktree_minimal /
# _wt_validate_path contracts (plan §2b/2e/2f). Authored by glm-4.7 (2 rounds),
# structurally repaired at depth-0 (recorded deviation): subshell-captured
# globals, out-of-repo hook placement, regex-vs-substring asserts, git spy.
. "$(dirname "$0")/lib.sh"

. "$REPO_ROOT/scripts/lib/worktree-reap.sh"

# All cases bypass the resolver and drive the lib via its config globals.
TEARDOWN_CONFIG_LOADED=1
TEARDOWN_HOOK=""
STALE_REAPER_AGE_DAYS=0
REAPER_SCOPE="marker-only"

setup_repo() { # <repo> — init a scratch repo with one commit
  git init -q "$1"
  git -C "$1" config user.email t@e.c
  git -C "$1" config user.name t
  git -C "$1" commit -q --allow-empty -m init
}

REAP_ERR=""
run_reap() { # <repo-cwd> <fn> <args…> — run in repo cwd, SAME shell (globals survive), stderr → REAP_ERR
  local repo="$1" fn="$2"; shift 2
  local errf="$TEST_TMP/.reap-err"
  pushd "$repo" >/dev/null || fail "pushd $repo"
  "$fn" "$@" 2>"$errf"
  local rc=$?
  popd >/dev/null || true
  REAP_ERR="$(cat "$errf" 2>/dev/null)"
  return $rc
}

# --- 1. hook runs (artifact file), worktree removed, orphan empty, WT cleared ---
R1="$TEST_TMP/r1"; setup_repo "$R1"
git -C "$R1" worktree add -q "$TEST_TMP/r1-wt" -b b1
printf '#!/bin/sh\ntouch "%s/hook-ran"\necho "HOOK_RAN: $1" >&2\n' "$TEST_TMP" > "$R1/hook.sh"
chmod +x "$R1/hook.sh"
TEARDOWN_HOOK="$R1/hook.sh"
OUTCOME_ORPHAN="preset"; WT="$TEST_TMP/r1-wt"
run_reap "$R1" reap_worktree "$TEST_TMP/r1-wt"
assert_eq "0" "$?" "reap_worktree returns 0"
[ -f "$TEST_TMP/hook-ran" ] || fail "teardown hook did not run (artifact missing)"
assert_contains "$REAP_ERR" "HOOK_RAN: $TEST_TMP/r1-wt" "hook received worktree path as \$1"
assert_eq "" "$OUTCOME_ORPHAN" "no orphan on success"
assert_eq "" "$WT" "WT global cleared when it equals the reaped path"
[ ! -d "$TEST_TMP/r1-wt" ] || fail "worktree dir should be removed"
TEARDOWN_HOOK=""

# --- 2. failing hook is fail-open: WARN + removal still proceeds ---
R2="$TEST_TMP/r2"; setup_repo "$R2"
git -C "$R2" worktree add -q "$TEST_TMP/r2-wt" -b b2
printf '#!/bin/sh\nexit 42\n' > "$R2/hook.sh"; chmod +x "$R2/hook.sh"
TEARDOWN_HOOK="$R2/hook.sh"
run_reap "$R2" reap_worktree "$TEST_TMP/r2-wt"
assert_contains "$REAP_ERR" "teardown hook failed (exit 42)" "hook failure warned"
[ ! -d "$TEST_TMP/r2-wt" ] || fail "worktree removed despite failing hook (fail-open)"
TEARDOWN_HOOK=""

# --- 3. WT_RM seam forces removal failure: loud WARN + OUTCOME_ORPHAN + dir kept ---
R3="$TEST_TMP/r3"; setup_repo "$R3"
git -C "$R3" worktree add -q "$TEST_TMP/r3-wt" -b b3
printf '#!/bin/sh\necho "FAKE REMOVE: $*" >&2\nexit 1\n' > "$TEST_TMP/wtrm-fail.sh"
chmod +x "$TEST_TMP/wtrm-fail.sh"
export WT_RM="$TEST_TMP/wtrm-fail.sh"
OUTCOME_ORPHAN=""
run_reap "$R3" reap_worktree "$TEST_TMP/r3-wt"
assert_eq "0" "$?" "reap_worktree still returns 0 on removal failure (D4: exit unchanged)"
assert_contains "$REAP_ERR" "WARN: worktree remove failed; orphan kept at $TEST_TMP/r3-wt" "loud orphan WARN"
assert_eq "$TEST_TMP/r3-wt" "$OUTCOME_ORPHAN" "OUTCOME_ORPHAN set to kept path"
[ -d "$TEST_TMP/r3-wt" ] || fail "worktree dir kept on removal failure"
unset WT_RM

# --- 4. control-char path refused before any removal attempt ---
BAD="$TEST_TMP/bad"$'\n'"name"
OUTCOME_ORPHAN=""
run_reap "$TEST_TMP" reap_worktree "$BAD"
assert_contains "$REAP_ERR" "control character" "control-char path refused with WARN"
assert_eq "$BAD" "$OUTCOME_ORPHAN" "orphan set on refusal"

# --- 5. reap_worktree_minimal: removal failure appends to ORPHAN_LOG ---
R5="$TEST_TMP/r5"; setup_repo "$R5"
git -C "$R5" worktree add -q "$TEST_TMP/r5-wt" -b b5
export WT_RM="$TEST_TMP/wtrm-fail.sh"
ORPHAN_LOG="$TEST_TMP/orphans.log"
run_reap "$R5" reap_worktree_minimal "$TEST_TMP/r5-wt"
assert_contains "$(cat "$ORPHAN_LOG" 2>/dev/null)" "$TEST_TMP/r5-wt" "minimal reap logs orphan path"
unset WT_RM

# --- 6-8. _wt_validate_path: outside-repo / non-executable rejected; valid accepted ---
V="$TEST_TMP/vrepo"; setup_repo "$V"
printf '#!/bin/sh\n' > "$TEST_TMP/outside.sh"; chmod +x "$TEST_TMP/outside.sh"
if _wt_validate_path "$TEST_TMP/outside.sh" "$V" >/dev/null 2>&1; then
  fail "outside-repo hook must be rejected"
fi
printf 'x\n' > "$V/nonexec.sh"
if _wt_validate_path "$V/nonexec.sh" "$V" >/dev/null 2>&1; then
  fail "non-executable hook must be rejected"
fi
printf '#!/bin/sh\n' > "$V/ok.sh"; chmod +x "$V/ok.sh"
GOT="$(_wt_validate_path "$V/ok.sh" "$V" 2>/dev/null)"
assert_eq "0" "$?" "valid in-repo executable hook accepted"
assert_contains "$GOT" "/ok.sh" "validate echoes absolute hook path"

# --- 9. WT untouched when it names a DIFFERENT path ---
R9="$TEST_TMP/r9"; setup_repo "$R9"
git -C "$R9" worktree add -q "$TEST_TMP/r9-wt" -b b9
WT="$TEST_TMP/some-other-path"
run_reap "$R9" reap_worktree "$TEST_TMP/r9-wt"
assert_eq "$TEST_TMP/some-other-path" "$WT" "WT untouched when different from reaped path"

# --- 10. reap_worktree never deletes the branch ---
git -C "$R9" rev-parse -q --verify b9 >/dev/null || fail "precondition: branch b9 exists"
[ ! -d "$TEST_TMP/r9-wt" ] || fail "r9 worktree removed"
git -C "$R9" rev-parse -q --verify b9 >/dev/null || fail "branch b9 must SURVIVE reap_worktree (sole branch-delete site is the abort trap)"

# (Known gap: the 120s hook-timeout branch is untestable without a timeout seam.)

# --- 11. predictable lock symlinks fail closed without touching victim bytes ---
LOCK_VICTIM="$TEST_TMP/lock-victim"; LOCK_BYTES='0123456789abcdef'
printf '%s' "$LOCK_BYTES" > "$LOCK_VICTIM"
ORPHAN_LOG="$TEST_TMP/symlink-orphans.log"
ln -s "$LOCK_VICTIM" "${ORPHAN_LOG}.lock"
_wt_append_orphan_path "$TEST_TMP/should-not-append" >/dev/null 2>&1
assert_neq "$?" 0 "orphan append rejects symlink lock"
assert_eq "$(cat "$LOCK_VICTIM")" "$LOCK_BYTES" "orphan append never truncates symlink victim"

mkdir "$TEST_TMP/symlink-lock-wt"
ln -s "$LOCK_VICTIM" "$TEST_TMP/symlink-lock-wt/.autopilot-worktree.lock"
_wt_is_live "$TEST_TMP/symlink-lock-wt"
assert_eq "$?" 2 "worktree liveness probe rejects symlink lock and preserves worktree"
assert_eq "$(cat "$LOCK_VICTIM")" "$LOCK_BYTES" "worktree lock probe never truncates symlink victim"

# --- 12. cleanliness distinguishes dirty state from status execution failure ---
( git() { return 2; }; _wt_is_clean "$TEST_TMP/status-failure" )
assert_eq "$?" 2 "worktree cleanliness reports status command failure distinctly"

# --- 13. managed teardown hook cannot remove a leaf before exact journaling ---
R13="$TEST_TMP/r13"; setup_repo "$R13"
R13_COMMON="$(git -C "$R13" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$R13_COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" \
  >> "$R13_COMMON/info/exclude"
R13_WT="$TEST_TMP/r13-wt"
R13_ROOT="managed-hook-root"
R13_BASE="$(git -C "$R13" rev-parse HEAD)"
git -C "$R13" worktree add -q "$R13_WT" -b hetero/managed-hook
{
  printf 'created_at=1\n'
  printf 'branch=hetero/managed-hook\n'
  printf 'base_sha=%s\n' "$R13_BASE"
  printf 'run_id=managed-hook\n'
  printf 'root_run_id=%s\n' "$R13_ROOT"
  printf 'loop_id=managed-hook-loop\n'
  printf 'schema=2\n'
} > "$R13_WT/.autopilot-worktree"
: > "$R13_WT/.autopilot-worktree.lock"
printf '#!/bin/sh\ngit -C "%s" worktree remove --force "$1"\n' "$R13" \
  > "$R13/remove-hook.sh"
chmod +x "$R13/remove-hook.sh"
TEARDOWN_HOOK="$R13/remove-hook.sh"
SELF_DIR="$REPO_ROOT/scripts"
AUTOPILOT_WORKTREE_ROOT_RUN_ID="$R13_ROOT"
export AUTOPILOT_WORKTREE_ROOT_RUN_ID
run_reap "$R13" reap_worktree "$R13_WT"
assert_eq "0" "$?" "managed destructive teardown hook completes"
assert_file_absent "$R13_WT/.git" "destructive hook removes the managed worktree"
R13_SCAN="$(
  "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" scan \
    --repo "$R13" --root-run-id "$R13_ROOT"
)"
assert_contains "$R13_SCAN" '"branch":"hetero/managed-hook"' \
  "managed branch is journaled before the destructive hook runs"
TEARDOWN_HOOK=""
AUTOPILOT_WORKTREE_ROOT_RUN_ID=""
export AUTOPILOT_WORKTREE_ROOT_RUN_ID

# --- 14. managed hook tip drift is preserved, never double-journaled ---
R14="$TEST_TMP/r14"; setup_repo "$R14"
R14_COMMON="$(git -C "$R14" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$R14_COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" \
  >> "$R14_COMMON/info/exclude"
R14_WT="$TEST_TMP/r14-wt"
R14_ROOT="managed-hook-tip-root"
R14_BASE="$(git -C "$R14" rev-parse HEAD)"
git -C "$R14" worktree add -q "$R14_WT" -b hetero/managed-hook-tip
{
  printf 'created_at=1\n'
  printf 'branch=hetero/managed-hook-tip\n'
  printf 'base_sha=%s\n' "$R14_BASE"
  printf 'run_id=managed-hook-tip\n'
  printf 'root_run_id=%s\n' "$R14_ROOT"
  printf 'loop_id=managed-hook-tip-loop\n'
  printf 'schema=2\n'
} > "$R14_WT/.autopilot-worktree"
: > "$R14_WT/.autopilot-worktree.lock"
printf '#!/bin/sh\ngit -C "$1" commit -q --allow-empty -m hook-tip\n' \
  > "$R14/advance-hook.sh"
chmod +x "$R14/advance-hook.sh"
TEARDOWN_HOOK="$R14/advance-hook.sh"
AUTOPILOT_WORKTREE_ROOT_RUN_ID="$R14_ROOT"
export AUTOPILOT_WORKTREE_ROOT_RUN_ID
OUTCOME_ORPHAN=""
run_reap "$R14" reap_worktree "$R14_WT"
assert_file_exists "$R14_WT/.git" \
  "managed hook tip drift preserves the worktree"
assert_eq "$R14_WT" "$OUTCOME_ORPHAN" \
  "managed hook tip drift is reported as retained"
R14_SCAN="$(
  "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" scan \
    --repo "$R14" --root-run-id "$R14_ROOT"
)"
node - "$R14_SCAN" "$R14_BASE" <<'NODE'
const value = JSON.parse(process.argv[2]);
if (value.journal_branch_inventory.length !== 1
    || value.journal_branch_inventory[0].tip !== process.argv[3]) process.exit(1);
NODE
assert_exit_code "$?" "0" \
  "managed hook tip drift keeps only the pre-hook journal membership"
"$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$R14" --root-run-id "$R14_ROOT" --yes >/dev/null
assert_exit_code "$?" "0" \
  "generic retry reports preserve-first after a journaled tip conflict"
assert_file_exists "$R14_WT/.git" \
  "generic retry cannot remove a conflicting later branch tip"
R14_RETRY_SCAN="$(
  "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" scan \
    --repo "$R14" --root-run-id "$R14_ROOT"
)"
assert_contains "$R14_RETRY_SCAN" '"branch":"hetero/managed-hook-tip"' \
  "generic retry leaves the original exact journal readable"
TEARDOWN_HOOK=""
AUTOPILOT_WORKTREE_ROOT_RUN_ID=""
export AUTOPILOT_WORKTREE_ROOT_RUN_ID

finalize_test
