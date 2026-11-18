#!/usr/bin/env bash
# prune-merged-branch.test.sh — integration tests for:
#   1. scripts/prune-merged-branch.js
#   2. hooks/prune-merged-branch-lib.js (hosted in hooks/audit-log.js PostToolUse)
#   3. scripts/count-merged-remote-branches.js
# All fixtures use throwaway bare "origin" + clone repos under $TEST_TMP. Never touches a real remote.
. "$(dirname "$0")/lib.sh"
scrub_session_env
unset AUTOPILOT_TOKEN_SEAT AUTOPILOT_SESSION_ID AUTOPILOT_PRUNE_MERGED_BRANCH GIT_ALLOW_PROTOCOL
export GIT_CONFIG_COUNT=0

PRUNE_SCRIPT="$REPO_ROOT/scripts/prune-merged-branch.js"
COUNT_SCRIPT="$REPO_ROOT/scripts/count-merged-remote-branches.js"
AUDIT_HOOK="$REPO_ROOT/hooks/audit-log.js"

assert_file_exists "$PRUNE_SCRIPT" "scripts/prune-merged-branch.js exists"
assert_file_exists "$COUNT_SCRIPT" "scripts/count-merged-remote-branches.js exists"
assert_file_exists "$REPO_ROOT/hooks/prune-merged-branch-lib.js" "hooks/prune-merged-branch-lib.js exists"

tgit() {
  local repo="$1"
  shift
  git -C "$repo" -c user.name=t -c user.email=t@example.com -c commit.gpgsign=false -c tag.gpgsign=false "$@"
}

# make_repo <label> — sets BARE and WORK, pushes initial develop commit, sets origin HEAD -> develop.
make_repo() {
  local label="$1"
  BARE="$TEST_TMP/${label}-origin.git"
  WORK="$TEST_TMP/${label}-work"
  git init -q --bare "$BARE"
  git -C "$BARE" symbolic-ref HEAD refs/heads/develop
  git clone -q "$BARE" "$WORK" 2>/dev/null
  require_under_test_tmp "$BARE"
  require_under_test_tmp "$WORK"
  git -C "$WORK" config user.name t
  git -C "$WORK" config user.email t@example.com
  git -C "$WORK" config commit.gpgsign false
  git -C "$WORK" config tag.gpgsign false
  tgit "$WORK" checkout -q -b develop
  printf 'base\n' > "$WORK/base.txt"
  tgit "$WORK" add base.txt
  tgit "$WORK" commit -qm "chore: initial base"
  tgit "$WORK" push -q -u origin develop
  tgit "$WORK" remote set-head origin develop
}

run_prune() {
  local out_f="$TEST_TMP/prune.out"
  local err_f="$TEST_TMP/prune.err"
  node "$PRUNE_SCRIPT" "$@" </dev/null >"$out_f" 2>"$err_f"
  PRUNE_RC=$?
  PRUNE_OUT="$(cat "$out_f")"
  PRUNE_ERR="$(cat "$err_f")"
}

jget() {
  node -e '
    const obj = JSON.parse(process.argv[1]);
    const val = obj[process.argv[2]];
    process.stdout.write(val === null || val === undefined ? "null" : (typeof val === "string" ? val : JSON.stringify(val)));
  ' "$1" "$2"
}

assert_single_prune_json() {
  local label="$1"
  local lines
  lines="$(printf '%s\n' "$PRUNE_OUT" | grep -c . || true)"
  assert_eq "$lines" "1" "$label: stdout is exactly one JSON line"
  assert_eq "$(jget "$PRUNE_OUT" schema)" "autopilot.prune-merged-branch/1" "$label: schema matches"
}

remote_head_sha() {
  local bare="$1"
  local branch="$2"
  git ls-remote --heads "$bare" "refs/heads/$branch" | awk '{print $1}'
}

# ==============================================================================
# 1. Merged feature branch -> deleted, ls-remote empty; already absent -> absent
# ==============================================================================
make_repo "case1"
tgit "$WORK" checkout -q -b feat/merged-one
printf 'one\n' > "$WORK/one.txt"
tgit "$WORK" add one.txt
tgit "$WORK" commit -qm "feat: merged one"
FEAT_MERGED_SHA="$(tgit "$WORK" rev-parse HEAD)"
tgit "$WORK" push -q -u origin feat/merged-one
tgit "$WORK" checkout -q develop
tgit "$WORK" merge -q --no-ff -m "Merge branch 'feat/merged-one'" feat/merged-one
tgit "$WORK" push -q origin develop

assert_eq "$(remote_head_sha "$BARE" feat/merged-one)" "$FEAT_MERGED_SHA" "case1: feat/merged-one present on origin before prune"
run_prune --repo "$WORK" --branch feat/merged-one --remote origin --target develop
assert_exit_code "$PRUNE_RC" 0 "case1: merged branch prune exits 0"
assert_single_prune_json "case1"
assert_eq "$(jget "$PRUNE_OUT" action)" "deleted" "case1: action is deleted"
assert_eq "$(jget "$PRUNE_OUT" branch)" "feat/merged-one" "case1: branch field"
assert_eq "$(jget "$PRUNE_OUT" target)" "develop" "case1: target field"
assert_eq "$(jget "$PRUNE_OUT" unmerged)" "0" "case1: unmerged is 0"
assert_eq "$(jget "$PRUNE_OUT" head_sha)" "$FEAT_MERGED_SHA" "case1: head_sha recorded"
assert_eq "$(remote_head_sha "$BARE" feat/merged-one)" "" "case1: ls-remote --heads empty after delete"

# Re-running on an already-deleted branch -> action "absent", exit 0
run_prune --repo "$WORK" --branch feat/merged-one --remote origin --target develop
assert_exit_code "$PRUNE_RC" 0 "case1b: absent branch exits 0"
assert_single_prune_json "case1b"
assert_eq "$(jget "$PRUNE_OUT" action)" "absent" "case1b: action is absent"

# ==============================================================================
# 2. Branch with an extra unmerged commit -> kept, unmerged 1, exit 2, still on remote
# ==============================================================================
tgit "$WORK" checkout -q -b feat/unmerged-one develop
printf 'unmerged\n' > "$WORK/unmerged.txt"
tgit "$WORK" add unmerged.txt
tgit "$WORK" commit -qm "feat: unmerged commit"
UNMERGED_SHA="$(tgit "$WORK" rev-parse HEAD)"
tgit "$WORK" push -q -u origin feat/unmerged-one
tgit "$WORK" checkout -q develop

run_prune --repo "$WORK" --branch feat/unmerged-one --remote origin --target develop
assert_exit_code "$PRUNE_RC" 2 "case2: unmerged branch exits 2"
assert_single_prune_json "case2"
assert_eq "$(jget "$PRUNE_OUT" action)" "kept" "case2: action is kept"
assert_eq "$(jget "$PRUNE_OUT" reason)" "unmerged_commits" "case2: reason is unmerged_commits"
assert_eq "$(jget "$PRUNE_OUT" unmerged)" "1" "case2: unmerged count is 1"
assert_eq "$(jget "$PRUNE_OUT" head_sha)" "$UNMERGED_SHA" "case2: head_sha matches unmerged tip"
assert_eq "$(remote_head_sha "$BARE" feat/unmerged-one)" "$UNMERGED_SHA" "case2: unmerged branch still on remote"

# ==============================================================================
# 3. Protected names: develop, main, master, release/1.0, remote HEAD, tag, ==target -> skipped
# ==============================================================================
DEV_SHA="$(tgit "$WORK" rev-parse develop)"
tgit "$WORK" push -q origin "develop:refs/heads/main" "develop:refs/heads/master" "develop:refs/heads/release/1.0" "develop:refs/heads/trunk" "develop:refs/heads/custom-target"
tgit "$WORK" tag v1.0
tgit "$WORK" push -q origin refs/tags/v1.0

for prot in develop main master release/1.0; do
  run_prune --repo "$WORK" --branch "$prot" --remote origin --target develop
  assert_exit_code "$PRUNE_RC" 0 "case3 ($prot): exits 0"
  assert_single_prune_json "case3 ($prot)"
  assert_eq "$(jget "$PRUNE_OUT" action)" "skipped" "case3 ($prot): action is skipped"
  assert_eq "$(remote_head_sha "$BARE" "$prot")" "$DEV_SHA" "case3 ($prot): still untouched on origin"
done

# Tag name -> skipped, tag untouched on remote
run_prune --repo "$WORK" --branch v1.0 --remote origin --target develop
assert_exit_code "$PRUNE_RC" 0 "case3 (tag v1.0): exits 0"
assert_single_prune_json "case3 (tag v1.0)"
assert_eq "$(jget "$PRUNE_OUT" action)" "skipped" "case3 (tag v1.0): action is skipped"
assert_eq "$(jget "$PRUNE_OUT" reason)" "tag" "case3 (tag v1.0): reason is tag"
assert_neq "$(git ls-remote --tags "$BARE" refs/tags/v1.0)" "" "case3 (tag v1.0): tag still on origin"

# Remote-only tag (deleted locally first) -> still skipped via ls-remote --tags
tgit "$WORK" tag -d v1.0 >/dev/null
run_prune --repo "$WORK" --branch v1.0 --remote origin --target develop
assert_exit_code "$PRUNE_RC" 0 "case3 (remote-only tag v1.0): exits 0"
assert_eq "$(jget "$PRUNE_OUT" action)" "skipped" "case3 (remote-only tag v1.0): action is skipped"
assert_eq "$(jget "$PRUNE_OUT" reason)" "tag" "case3 (remote-only tag v1.0): reason is tag"

# Remote's HEAD branch (non-static name `trunk`) -> skipped
git -C "$BARE" symbolic-ref HEAD refs/heads/trunk
tgit "$WORK" remote set-head origin trunk
run_prune --repo "$WORK" --branch trunk --remote origin --target develop
assert_exit_code "$PRUNE_RC" 0 "case3 (remote HEAD trunk): exits 0"
assert_eq "$(jget "$PRUNE_OUT" action)" "skipped" "case3 (remote HEAD trunk): action is skipped"
assert_eq "$(jget "$PRUNE_OUT" reason)" "remote_head" "case3 (remote HEAD trunk): reason is remote_head"
assert_eq "$(remote_head_sha "$BARE" trunk)" "$DEV_SHA" "case3 (remote HEAD trunk): untouched on origin"
git -C "$BARE" symbolic-ref HEAD refs/heads/develop
tgit "$WORK" remote set-head origin develop

# --branch equals --target -> skipped
run_prune --repo "$WORK" --branch custom-target --remote origin --target custom-target
assert_exit_code "$PRUNE_RC" 0 "case3 (equals target): exits 0"
assert_eq "$(jget "$PRUNE_OUT" action)" "skipped" "case3 (equals target): action is skipped"
assert_eq "$(jget "$PRUNE_OUT" reason)" "equals_target" "case3 (equals target): reason is equals_target"
assert_eq "$(remote_head_sha "$BARE" custom-target)" "$DEV_SHA" "case3 (equals target): untouched on origin"

# ==============================================================================
# 4. --dry-run deletes nothing
# ==============================================================================
tgit "$WORK" checkout -q -b feat/dry-branch develop
printf 'dry\n' > "$WORK/dry.txt"
tgit "$WORK" add dry.txt
tgit "$WORK" commit -qm "feat: dry branch"
DRY_SHA="$(tgit "$WORK" rev-parse HEAD)"
tgit "$WORK" push -q -u origin feat/dry-branch
tgit "$WORK" checkout -q develop
tgit "$WORK" merge -q --no-ff -m "Merge branch 'feat/dry-branch'" feat/dry-branch
tgit "$WORK" push -q origin develop

run_prune --repo "$WORK" --branch feat/dry-branch --remote origin --target develop --dry-run
assert_exit_code "$PRUNE_RC" 0 "case4 (--dry-run): exits 0"
assert_single_prune_json "case4 (--dry-run)"
assert_eq "$(jget "$PRUNE_OUT" action)" "dry-run" "case4 (--dry-run): action is dry-run"
assert_eq "$(remote_head_sha "$BARE" feat/dry-branch)" "$DRY_SHA" "case4 (--dry-run): branch still on origin"

# ==============================================================================
# 5. Hook path: PostToolUse on hooks/audit-log.js after real merge --no-ff + push
#    Includes negative controls (knob off, push inside quotes, failed exit_code)
#    followed by positive detached prune on the exact same repo state.
# ==============================================================================
make_repo "hook"
HBARE="$BARE"
HWORK="$WORK"

LIVE_BASE="$(HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" node -e 'process.stdout.write(require(process.argv[1]).liveBase())' "$REPO_ROOT/hooks/live-session-lib.js" </dev/null)"
REPO_KEY="$(node -e 'process.stdout.write(require(process.argv[1]).scopeFromCwd(process.argv[2]).project_key)' "$REPO_ROOT/src/status/project-key.js" "$HWORK" </dev/null)"
HOOK_JSONL="$LIVE_BASE/prune-merged-branch/${REPO_KEY}.jsonl"

tgit "$HWORK" checkout -q -b feat/x develop
printf 'x-feature\n' > "$HWORK/x.txt"
tgit "$HWORK" add x.txt
tgit "$HWORK" commit -qm "feat: add x"
FEAT_X_SHA="$(tgit "$HWORK" rev-parse HEAD)"
tgit "$HWORK" push -q -u origin feat/x
tgit "$HWORK" checkout -q develop
tgit "$HWORK" merge -q --no-ff --no-edit feat/x
tgit "$HWORK" push -q origin HEAD:develop

assert_eq "$(remote_head_sha "$HBARE" feat/x)" "$FEAT_X_SHA" "case5 setup: feat/x is on origin after merge push"

make_bash_payload() {
  local cwd="$1"
  local cmd="$2"
  local rc="${3:-0}"
  node -e '
    process.stdout.write(JSON.stringify({
      session_id: "sess-prune-test",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      cwd: process.argv[1],
      tool_input: { command: process.argv[2] },
      tool_response: { exit_code: Number(process.argv[3]), stdout: "", stderr: "" },
    }));
  ' "$cwd" "$cmd" "$rc" </dev/null
}

feed_audit_hook() {
  local payload="$1"
  local knob="${2-}"
  local out_f="$TEST_TMP/audit.out"
  local err_f="$TEST_TMP/audit.err"
  if [ -n "$knob" ]; then
    printf '%s' "$payload" | HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" CLAUDE_PLUGIN_ROOT="$REPO_ROOT" \
      AUTOPILOT_PRUNE_MERGED_BRANCH="$knob" node "$AUDIT_HOOK" >"$out_f" 2>"$err_f"
  else
    printf '%s' "$payload" | env -u AUTOPILOT_PRUNE_MERGED_BRANCH HOME="$HOOK_HOME" TMPDIR="$HOOK_TMPDIR" \
      CLAUDE_PLUGIN_ROOT="$REPO_ROOT" node "$AUDIT_HOOK" >"$out_f" 2>"$err_f"
  fi
  AUDIT_RC=$?
  AUDIT_ERR_FILE="$err_f"
}

wait_for_jsonl_lines() {
  local file="$1"
  local want="$2"
  local waited=0
  while [ "$waited" -lt 200 ]; do
    if [ -f "$file" ]; then
      local got
      got="$(grep -c . "$file" 2>/dev/null || true)"
      if [ "${got:-0}" -ge "$want" ]; then
        return 0
      fi
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 1
}

# 5a. Negative control: knob off -> deletes nothing, writes no jsonl
PAYLOAD_PUSH="$(make_bash_payload "$HWORK" "git push origin HEAD:develop" 0)"
feed_audit_hook "$PAYLOAD_PUSH" "off"
assert_exit_code "$AUDIT_RC" 0 "case5a (knob off): audit-log exits 0"
sleep 0.4
assert_file_absent "$HOOK_JSONL" "case5a (knob off): no jsonl written"
assert_eq "$(remote_head_sha "$HBARE" feat/x)" "$FEAT_X_SHA" "case5a (knob off): feat/x untouched on origin"

# 5b. Negative control: push command inside double/single quotes -> deletes nothing
PAYLOAD_DQUOTED="$(make_bash_payload "$HWORK" 'echo "git push origin HEAD:develop"' 0)"
feed_audit_hook "$PAYLOAD_DQUOTED" ""
assert_exit_code "$AUDIT_RC" 0 "case5b (double-quoted push): audit-log exits 0"
PAYLOAD_SQUOTED="$(make_bash_payload "$HWORK" "printf '%s\n' 'git push origin HEAD:develop'" 0)"
feed_audit_hook "$PAYLOAD_SQUOTED" ""
assert_exit_code "$AUDIT_RC" 0 "case5b (single-quoted push): audit-log exits 0"
sleep 0.4
assert_file_absent "$HOOK_JSONL" "case5b (quoted push): no jsonl written"
assert_eq "$(remote_head_sha "$HBARE" feat/x)" "$FEAT_X_SHA" "case5b (quoted push): feat/x untouched on origin"

# 5c. Negative control: failed Bash command (exit_code 1) -> deletes nothing
PAYLOAD_FAILED="$(make_bash_payload "$HWORK" "git push origin HEAD:develop" 1)"
feed_audit_hook "$PAYLOAD_FAILED" ""
assert_exit_code "$AUDIT_RC" 0 "case5c (failed push): audit-log exits 0"
sleep 0.4
assert_file_absent "$HOOK_JSONL" "case5c (failed push): no jsonl written"
assert_eq "$(remote_head_sha "$HBARE" feat/x)" "$FEAT_X_SHA" "case5c (failed push): feat/x untouched on origin"

# 5d. Positive hook run: exact same payload & repo state with knob default-on -> detached child deletes feat/x
feed_audit_hook "$PAYLOAD_PUSH" ""
assert_exit_code "$AUDIT_RC" 0 "case5d (hook positive): audit-log exits 0"
if ! wait_for_jsonl_lines "$HOOK_JSONL" 1; then
  fail "case5d: timed out waiting 20 s for detached child to write $HOOK_JSONL"
else
  LINE1="$(sed -n '1p' "$HOOK_JSONL")"
  assert_eq "$(jget "$LINE1" schema)" "autopilot.prune-merged-branch/1" "case5d: jsonl schema"
  assert_eq "$(jget "$LINE1" branch)" "feat/x" "case5d: jsonl branch is feat/x"
  assert_eq "$(jget "$LINE1" action)" "deleted" "case5d: jsonl action is deleted"
  assert_eq "$(jget "$LINE1" head_sha)" "$FEAT_X_SHA" "case5d: jsonl head_sha matches"
  assert_eq "$(remote_head_sha "$HBARE" feat/x)" "" "case5d: feat/x deleted from origin"
  assert_contains "$(cat "$AUDIT_ERR_FILE")" "origin/feat/x -> deleted" "case5d: stderr result line written"
fi

# 5e. Additional subject form (`Merge feat/y: summary`) + `git -C <dir> push origin develop`
tgit "$HWORK" checkout -q -b feat/y develop
printf 'y-feature\n' > "$HWORK/y.txt"
tgit "$HWORK" add y.txt
tgit "$HWORK" commit -qm "feat: add y"
FEAT_Y_SHA="$(tgit "$HWORK" rev-parse HEAD)"
tgit "$HWORK" push -q -u origin feat/y
tgit "$HWORK" checkout -q develop
tgit "$HWORK" merge -q --no-ff -m "Merge feat/y: add y summary" feat/y
tgit "$HWORK" push -q origin develop

assert_eq "$(remote_head_sha "$HBARE" feat/y)" "$FEAT_Y_SHA" "case5e setup: feat/y on origin"
PAYLOAD_DASH_C="$(make_bash_payload "$TEST_TMP" "git -C $HWORK push origin develop" 0)"
feed_audit_hook "$PAYLOAD_DASH_C" ""
assert_exit_code "$AUDIT_RC" 0 "case5e: audit-log exits 0"
if ! wait_for_jsonl_lines "$HOOK_JSONL" 2; then
  fail "case5e: timed out waiting 20 s for second jsonl line in $HOOK_JSONL"
else
  LINE2="$(sed -n '2p' "$HOOK_JSONL")"
  assert_eq "$(jget "$LINE2" branch)" "feat/y" "case5e: jsonl branch is feat/y"
  assert_eq "$(jget "$LINE2" action)" "deleted" "case5e: jsonl action is deleted"
  assert_eq "$(remote_head_sha "$HBARE" feat/y)" "" "case5e: feat/y deleted from origin"
fi

# ==============================================================================
# 6. count-merged-remote-branches.js: 3 merged + 1 unmerged + protected refs
#    Count only, never deletes anything.
# ==============================================================================
make_repo "count"
CBARE="$BARE"
CWORK="$WORK"

for b in feat/m1 feat/m2 fix/m3; do
  tgit "$CWORK" checkout -q -b "$b" develop
  printf '%s\n' "$b" > "$CWORK/$(printf '%s' "$b" | tr '/' '_').txt"
  tgit "$CWORK" add .
  tgit "$CWORK" commit -qm "add $b"
  tgit "$CWORK" push -q -u origin "$b"
  tgit "$CWORK" checkout -q develop
  tgit "$CWORK" merge -q --no-ff -m "Merge branch '$b'" "$b"
done
tgit "$CWORK" push -q origin develop

# Protected branches + tag at develop (merged, must be excluded from count)
tgit "$CWORK" push -q origin "develop:refs/heads/main" "develop:refs/heads/master" "develop:refs/heads/release/2.0"
tgit "$CWORK" tag v2.0
tgit "$CWORK" push -q origin refs/tags/v2.0

# 1 unmerged branch on origin
tgit "$CWORK" checkout -q -b feat/unmerged-c develop
printf 'unmerged-c\n' > "$CWORK/unmerged-c.txt"
tgit "$CWORK" add unmerged-c.txt
tgit "$CWORK" commit -qm "feat: unmerged c"
tgit "$CWORK" push -q -u origin feat/unmerged-c
tgit "$CWORK" checkout -q develop
tgit "$CWORK" fetch -q --prune origin

REFS_BEFORE="$(git ls-remote "$CBARE")"
COUNT_OUT="$(node "$COUNT_SCRIPT" --repo "$CWORK" </dev/null)"
COUNT_RC=$?
REFS_AFTER="$(git ls-remote "$CBARE")"

assert_exit_code "$COUNT_RC" 0 "case6 (--repo): exits 0"
assert_eq "$REFS_AFTER" "$REFS_BEFORE" "case6: count script never deletes or mutates remote refs"

ROW1="$(printf '%s\n' "$COUNT_OUT" | sed -n '1p')"
TOT1="$(printf '%s\n' "$COUNT_OUT" | sed -n '2p')"
assert_eq "$(jget "$ROW1" target)" "develop" "case6: target is develop"
assert_eq "$(jget "$ROW1" merged_unDeleted)" "3" "case6: reports 3 merged undeleted branches"
assert_eq "$(jget "$ROW1" names)" '["feat/m1","feat/m2","fix/m3"]' "case6: names lists the 3 merged branches"
assert_eq "$(jget "$TOT1" total)" "true" "case6: total line flag"
assert_eq "$(jget "$TOT1" repos)" "1" "case6: total repos is 1"
assert_eq "$(jget "$TOT1" merged_unDeleted)" "3" "case6: total merged_unDeleted is 3"

# Test --repos-root + --fetch after deleting feat/m1 on bare origin (proves --fetch runs fetch --prune)
REPOS_ROOT="$TEST_TMP/repos-root"
mkdir -p "$REPOS_ROOT"
git clone -q "$CBARE" "$REPOS_ROOT/alpha" 2>/dev/null
git -C "$CBARE" branch -D feat/m1 >/dev/null

STALE_ROOT_OUT="$(node "$COUNT_SCRIPT" --repos-root "$REPOS_ROOT" </dev/null)"
STALE_ROOT_RC=$?
assert_exit_code "$STALE_ROOT_RC" 0 "case6b (without --fetch): exits 0"
SROW="$(printf '%s\n' "$STALE_ROOT_OUT" | sed -n '1p')"
assert_eq "$(jget "$SROW" merged_unDeleted)" "3" "case6b: without --fetch does not run fetch --prune (keeps 3)"

COUNT_ROOT_OUT="$(node "$COUNT_SCRIPT" --repos-root "$REPOS_ROOT" --fetch </dev/null)"
COUNT_ROOT_RC=$?
assert_exit_code "$COUNT_ROOT_RC" 0 "case6b (--repos-root --fetch): exits 0"
RROW="$(printf '%s\n' "$COUNT_ROOT_OUT" | sed -n '1p')"
RTOT="$(printf '%s\n' "$COUNT_ROOT_OUT" | sed -n '2p')"
assert_eq "$(jget "$RROW" merged_unDeleted)" "2" "case6b: --fetch pruned deleted remote branch -> 2 remaining"
assert_eq "$(jget "$RROW" names)" '["feat/m2","fix/m3"]' "case6b: remaining names after --fetch"
assert_eq "$(jget "$RTOT" merged_unDeleted)" "2" "case6b: total is 2"

finalize_test
