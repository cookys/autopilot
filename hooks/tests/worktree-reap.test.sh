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

finalize_test
