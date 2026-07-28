#!/usr/bin/env bash
# Fixture-repo coverage for preserve-first local dispatch branch lifecycle.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/reap-dispatch-branches.sh"
WORKTREE_REAPER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"

new_repo() {
  local repo="$1"
  git init -q -b develop "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  git -C "$repo" commit -q --allow-empty -m base
}

child_commit() {
  local repo="$1" parent="$2" message="$3"
  printf '%s\n' "$message" | git -C "$repo" commit-tree "${parent}^{tree}" -p "$parent"
}

json_valid() {
  node -e 'JSON.parse(process.argv[1])' "$1" >/dev/null 2>&1
}

write_inventory_journal() {
  local repo="$1" root="$2" branch="$3" tip="$4" origin="$5"
  local common directory key
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  directory="$common/autopilot-worktree-branch-inventory"
  mkdir -p "$directory"
  chmod 700 "$directory"
  key="$(
    printf '%s\0%s\0%s\0%s\0' "$root" "$origin" "$branch" "$tip" \
      | sha256sum | awk '{print $1}'
  )"
  printf \
    '{"schema":1,"root_run_id":"%s","path":"%s","branch":"%s","tip":"%s","marker_sha256":"%s","captured_at":1}\n' \
    "$root" "$origin" "$branch" "$tip" \
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" \
    > "$directory/$key.json"
  chmod 600 "$directory/$key.json"
}

test_scan_check_and_ack() {
  local repo="$TEST_TMP/scan-check"
  new_repo "$repo"
  local base t1 t2 t3 t4 out rc
  base=$(git -C "$repo" rev-parse develop)
  t1=$(child_commit "$repo" "$base" one)
  t2=$(child_commit "$repo" "$base" two)
  t3=$(child_commit "$repo" "$base" candidate)

  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t3"
  git -C "$repo" tag ceo-integration-candidate-r1 "$t3"
  git -C "$repo" update-ref refs/heads/ceo-openai-task-r2-20260715 "$t1"
  git -C "$repo" update-ref refs/heads/ceo-openai-task-r10-20260715 "$t2"
  git -C "$repo" update-ref refs/heads/agent/unit-r08-20260715 "$t1"
  git -C "$repo" update-ref refs/heads/agent/unit-r9-20260715 "$t2"
  git -C "$repo" branch ceo-mybranch develop

  out=$(bash "$SCRIPT" scan --repo "$repo" --into develop); rc=$?
  assert_eq "$rc" 0 "scan exits clean"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "scan JSON must parse"; fi
  assert_contains "$out" '"name":"ceo-integration-candidate-r1"' "candidate matched"
  assert_contains "$out" '"name":"agent/unit-r08-20260715"' "unit family matched"
  assert_not_contains "$out" 'ceo-mybranch' "undated lookalike excluded"
  assert_contains "$out" '"name":"ceo-openai-task-r2-20260715","family":"intermediate"' "intermediate classified"
  assert_contains "$out" '"superseded_by":"ceo-openai-task-r10-20260715"' "r10 numerically supersedes r2"
  assert_contains "$out" '"superseded_by":"agent/unit-r9-20260715"' "r9 numerically supersedes r08"

  set +e
  out=$(bash "$SCRIPT" check --repo "$repo" --into develop 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 1 "unacked candidate gates"
  bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 >/dev/null
  assert_eq "$?" 0 "sha-pinned ack clears gate"

  t4=$(child_commit "$repo" "$t3" advance)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t4" "$t3"
  set +e
  bash "$SCRIPT" check --repo "$repo" --into develop >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 1 "new candidate commit re-arms gate"
  assert_not_contains "$(cat "$repo/.git/autopilot-reap-ack" 2>/dev/null)" "$t3" "stale ack pruned"

  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r11 "$t2"
  set +e
  bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 1 "ack for r1 does not clear r11 gate"
  assert_not_contains "$(cat "$repo/.git/autopilot-reap-ack")" 'ceo-integration-candidate-r11 ' "r1 ack never prefix-matches r11"
}

test_scan_check_and_ack

test_reap_contained_and_preserve_uncontained() {
  local repo="$TEST_TMP/reap-contained" bundle_dir="$TEST_TMP/bundles-with-\"quote" out rc base child bundle
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse develop)
  child=$(child_commit "$repo" "$base" child)
  git -C "$repo" branch agent/contained-r1-20260715 develop
  git -C "$repo" config branch.agent/contained-r1-20260715.remote origin
  git -C "$repo" update-ref refs/heads/ceo-uncontained-r1-20260715 "$child"

  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --bundle-dir "$bundle_dir")
  assert_contains "$out" '"dry_run":true' "reap defaults dry-run"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "dry-run must keep contained branch"; fi

  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$bundle_dir"); rc=$?
  assert_eq "$rc" 0 "contained reap exits clean"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "reap JSON with quoted path must parse"; fi
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then fail "contained branch should be deleted"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
  assert_eq "$(git -C "$repo" config --get branch.agent/contained-r1-20260715.remote 2>/dev/null || true)" "" "deleted branch local config removed"
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-uncontained-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "uncontained branch must survive"; fi
  bundle=$(find "$bundle_dir" -name '*.bundle' -type f | head -n1)
  assert_file_exists "$bundle" "preservation bundle exists"
  if git -C "$repo" bundle verify "$bundle" >/dev/null 2>&1; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "bundle verify must pass"; fi
  assert_contains "$(git -C "$repo" bundle list-heads "$bundle")" 'refs/heads/agent/contained-r1-20260715' "bundle lists deleted slash ref"
}

test_reap_contained_and_preserve_uncontained

test_symbolic_dispatch_ref_never_deletes_referent() {
  local repo="$TEST_TMP/reap-symbolic-ref" out rc
  new_repo "$repo"
  git -C "$repo" branch ordinary-victim develop
  git -C "$repo" symbolic-ref refs/heads/agent/symbolic-r1-20260715 refs/heads/ordinary-victim

  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/symbolic-bundles"); rc=$?
  assert_eq "$rc" 0 "contained symbolic dispatch ref reaps cleanly"
  if git -C "$repo" show-ref --verify --quiet refs/heads/ordinary-victim; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "no-deref deletion must preserve symbolic ref referent"
  fi
  if git -C "$repo" symbolic-ref -q refs/heads/agent/symbolic-r1-20260715 >/dev/null 2>&1; then
    fail "contained dispatch symref itself should be deleted"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  assert_contains "$out" 'agent/symbolic-r1-20260715' "reap JSON names deleted dispatch symref"
}

test_symbolic_dispatch_ref_never_deletes_referent

test_superseded_opt_in_and_same_tip_survivor() {
  local repo="$TEST_TMP/reap-superseded" base t1 t2 rc out
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse develop)
  t1=$(child_commit "$repo" "$base" one)
  t2=$(child_commit "$repo" "$base" two)
  git -C "$repo" update-ref refs/heads/ceo-engine-task-r2-20260715 "$t1"
  git -C "$repo" update-ref refs/heads/ceo-engine-task-r10-20260715 "$t2"

  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b1" >/dev/null
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-engine-task-r2-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "superseded survives default reap"; fi
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --reap-superseded --bundle-dir "$TEST_TMP/b2")
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-engine-task-r2-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "uncontained superseded branch survives every reaper flag combination"; fi
  assert_contains "$out" 'ceo-engine-task-r2-20260715' "superseded opt-in reports preserved branch"

  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r2 "$t2"
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r10 "$t2"
  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b3" >/dev/null
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-integration-candidate-r10; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "highest-round same-tip candidate survives"; fi
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-integration-candidate-r2; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "same-tip candidate not contained by integration target must survive"; fi
}

test_superseded_opt_in_and_same_tip_survivor

test_bundle_failure_and_checked_out_guard() {
  local repo="$TEST_TMP/reap-failures" bad_dir="$TEST_TMP/not-a-\"dir" wt rc out base t1 t2
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse develop)
  t1=$(child_commit "$repo" "$base" superseded-one)
  t2=$(child_commit "$repo" "$base" superseded-two)
  git -C "$repo" branch agent/bundle-fail-r1-20260715 develop
  git -C "$repo" update-ref refs/heads/ceo-failure-task-r1-20260715 "$t1"
  git -C "$repo" update-ref refs/heads/ceo-failure-task-r2-20260715 "$t2"
  : > "$bad_dir"
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --reap-superseded --bundle-dir "$bad_dir" 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 1 "bundle stage failure exits 1"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "quoted git-path failure must remain valid JSON"; fi
  assert_contains "$out" 'ceo-failure-task-r1-20260715' "early bundle failure reports preserved superseded branch in kept"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/bundle-fail-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "bundle failure must delete nothing"; fi

  wt="$TEST_TMP/checked-out-wt"
  git -C "$repo" worktree add -q "$wt" -b agent/checked-r1-20260715 develop
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b4"); rc=$?
  set -e
  assert_eq "$rc" 1 "checked-out eligible branch records failure"
  assert_contains "$out" '"stage":"checked-out"' "checked-out failure names stage"
  assert_contains "$out" "checked out at $wt" "checked-out failure names exact worktree path"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/checked-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "checked-out branch must survive"; fi
  git -C "$repo" worktree remove --force "$wt"
}

test_bundle_failure_and_checked_out_guard

test_environment_errors() {
  local rc out
  set +e
  bash "$SCRIPT" scan --repo "$TEST_TMP/no-repo" >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 2 "non-git environment exits 2"

  local repo="$TEST_TMP/invalid-target"
  new_repo "$repo"
  set +e
  bash "$SCRIPT" scan --repo "$repo" --into does-not-exist >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 2 "invalid integration target exits 2"

  bash "$SCRIPT" check --repo "$repo" --into develop >/dev/null
  if [ -e "$repo/.git/autopilot-reap-ack" ]; then
    fail "plain check without acknowledgements must not create persistent state"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi

  git -C "$repo" branch ordinary-user-branch develop
  set +e
  out=$(bash "$SCRIPT" scan --repo "$repo" --into develop --pattern '' 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 2 "empty custom pattern is rejected"
  assert_eq "$out" "" "empty custom pattern cannot classify every local branch"
}

test_environment_errors

test_sha256_recorded_tip_is_reaped_with_bundle() {
  local repo="$TEST_TMP/sha256-repo" out rc
  git init -q --object-format=sha256 -b develop "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  git -C "$repo" commit -q --allow-empty -m base
  git -C "$repo" branch agent/contained-r1-20260715 develop

  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/sha256-bundles" 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 0 "SHA-256 recorded tip is accepted"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "SHA-256 reap emits valid JSON"; fi
  assert_contains "$out" '"branch":"agent/contained-r1-20260715"' "SHA-256 branch is reaped"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then
    fail "SHA-256 eligible branch must be removed"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  if find "$TEST_TMP/sha256-bundles" -name '*.bundle' -type f | grep -q .; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "SHA-256 branch is preserved in a verified bundle"
  fi
}

test_sha256_recorded_tip_is_reaped_with_bundle

test_exact_inventory_recovers_after_post_delete_crash() {
  local repo="$TEST_TMP/post-delete-crash" base common identity inventory hook out rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse HEAD)
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  identity="git-common-dir:$(realpath "$common")"
  git -C "$repo" branch hetero/post-delete-crash develop
  write_inventory_journal "$repo" post-delete-crash \
    hetero/post-delete-crash "$base" "$TEST_TMP/post-delete-crash-origin"
  inventory="$TEST_TMP/post-delete-crash-inventory.json"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"post-delete-crash","branches":[{"name":"hetero/post-delete-crash","tip":"%s"}]}\n' \
    "$identity" "$base" > "$inventory"
  hook="$TEST_TMP/kill-reaper-after-delete.sh"
  cat > "$hook" <<'EOF'
#!/usr/bin/env bash
kill -KILL "$PPID"
EOF
  chmod +x "$hook"

  set +e
  AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE="$hook" \
    bash "$SCRIPT" reap --repo "$repo" --into develop \
      --inventory-file "$inventory" --yes \
      --bundle-dir "$TEST_TMP/post-delete-crash-bundles" >/dev/null 2>&1
  rc=$?
  set -e
  assert_neq "$rc" 0 "fault injection kills reaper after exact ref deletion"
  if git -C "$repo" show-ref --verify --quiet refs/heads/hetero/post-delete-crash; then
    fail "post-delete crash fixture must leave the ref absent"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi

  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$inventory" --yes \
    --bundle-dir "$TEST_TMP/post-delete-crash-bundles" 2>/dev/null)
  rc=$?
  set -e
  assert_eq "$rc" 0 "same exact inventory recovers from write-ahead disposition"
  assert_contains "$out" '"branch":"hetero/post-delete-crash"' \
    "recovery returns the verified reaped disposition"
}

test_exact_inventory_recovers_after_post_delete_crash

test_write_ahead_reaped_ref_remains_unresolved_while_live() {
  local repo="$TEST_TMP/pre-delete-crash" base common identity inventory hook scan rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse HEAD)
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  identity="git-common-dir:$(realpath "$common")"
  git -C "$repo" branch hetero/pre-delete-crash develop
  write_inventory_journal "$repo" pre-delete-crash \
    hetero/pre-delete-crash "$base" "$TEST_TMP/pre-delete-crash-origin"
  inventory="$TEST_TMP/pre-delete-crash-inventory.json"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"pre-delete-crash","branches":[{"name":"hetero/pre-delete-crash","tip":"%s"}]}\n' \
    "$identity" "$base" > "$inventory"
  hook="$TEST_TMP/kill-reaper-before-delete.sh"
  cat > "$hook" <<'EOF'
#!/usr/bin/env bash
kill -KILL "$PPID"
EOF
  chmod +x "$hook"

  set +e
  AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE="$hook" \
    bash "$SCRIPT" reap --repo "$repo" --into develop \
      --inventory-file "$inventory" --yes \
      --bundle-dir "$TEST_TMP/pre-delete-crash-bundles" >/dev/null 2>&1
  rc=$?
  set -e
  assert_neq "$rc" 0 "fault injection kills reaper after write-ahead persistence"
  assert_eq "$(git -C "$repo" rev-parse refs/heads/hetero/pre-delete-crash)" \
    "$base" "pre-delete crash leaves the exact ref live"
  scan=$("$WORKTREE_REAPER" scan --repo "$repo" --root-run-id pre-delete-crash)
  assert_contains "$scan" '"branch":"hetero/pre-delete-crash"' \
    "journal reconstruction does not hide a live write-ahead reaped ref"
}

test_write_ahead_reaped_ref_remains_unresolved_while_live

test_exact_inventory_requires_canonical_journal_ownership() {
  local repo="$TEST_TMP/unowned-inventory" base common identity inventory out rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse HEAD)
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  identity="git-common-dir:$(realpath "$common")"
  git -C "$repo" branch hetero/unowned-inventory develop
  inventory="$TEST_TMP/unowned-inventory.json"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"unowned-inventory","branches":[{"name":"hetero/unowned-inventory","tip":"%s"}]}\n' \
    "$identity" "$base" > "$inventory"
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$inventory" --yes 2>&1)
  rc=$?
  set -e
  assert_eq "$rc" 2 "caller-authored inventory without ownership journal is rejected"
  assert_contains "$out" "canonical branch inventory journal" \
    "unowned inventory rejection names missing provenance"
  assert_eq "$(git -C "$repo" rev-parse refs/heads/hetero/unowned-inventory)" \
    "$base" "unowned contained branch survives exact inventory rejection"
}

test_exact_inventory_requires_canonical_journal_ownership

test_empty_exact_inventory_is_a_valid_noop() {
  local repo="$TEST_TMP/empty-exact-inventory" inventory out
  new_repo "$repo"
  inventory="$TEST_TMP/empty-exact-inventory.json"
  "$WORKTREE_REAPER" reap --repo "$repo" --root-run-id empty-root --yes \
    > "$inventory"
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$inventory" --yes)
  assert_exit_code "$?" "0" \
    "empty controller inventory is a valid exact-scope no-op"
  assert_contains "$out" '"root_run_id":"empty-root"' \
    "empty exact disposition preserves the root resource identity"
  assert_contains "$out" '"inventory_dispositions":[]' \
    "empty exact disposition emits an empty disposition set"
}

test_empty_exact_inventory_is_a_valid_noop

test_empty_exact_inventory_rejects_unresolved_journal() {
  local repo="$TEST_TMP/empty-exact-stale" wt wt2 base common marker_sha key
  local actual_inventory forged_empty forged_partial out rc
  new_repo "$repo"
  wt="$TEST_TMP/empty-exact-stale-wt"
  base=$(git -C "$repo" rev-parse HEAD)
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  mkdir -p "$common/info"
  printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" \
    >> "$common/info/exclude"
  git -C "$repo" worktree add -q -b hetero/empty-exact-stale "$wt" develop
  {
    printf 'created_at=1\n'
    printf 'branch=hetero/empty-exact-stale\n'
    printf 'base_sha=%s\n' "$base"
    printf 'run_id=empty-exact-stale\n'
    printf 'root_run_id=empty-exact-stale-root\n'
    printf 'loop_id=empty-exact-stale-loop\n'
    printf 'schema=2\n'
  } > "$wt/.autopilot-worktree"
  : > "$wt/.autopilot-worktree.lock"
  wt2="$TEST_TMP/empty-exact-stale-wt-b"
  git -C "$repo" worktree add -q -b hetero/empty-exact-stale-b "$wt2" develop
  {
    printf 'created_at=1\n'
    printf 'branch=hetero/empty-exact-stale-b\n'
    printf 'base_sha=%s\n' "$base"
    printf 'run_id=empty-exact-stale-b\n'
    printf 'root_run_id=empty-exact-stale-root\n'
    printf 'loop_id=empty-exact-stale-loop\n'
    printf 'schema=2\n'
  } > "$wt2/.autopilot-worktree"
  : > "$wt2/.autopilot-worktree.lock"
  actual_inventory="$TEST_TMP/empty-exact-stale-actual.json"
  "$WORKTREE_REAPER" reap --repo "$repo" \
    --root-run-id empty-exact-stale-root --yes > "$actual_inventory"
  assert_exit_code "$?" "0" "stale-empty fixture persists exact branch journal"

  forged_empty="$TEST_TMP/empty-exact-stale-forged.json"
  node - "$actual_inventory" "$forged_empty" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
value.branch_inventory = [];
value.journal_branch_inventory = [];
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$forged_empty" --yes 2>&1)
  rc=$?
  set -e
  assert_eq "$rc" "2" \
    "forged empty exact inventory cannot hide unresolved canonical journal"
  assert_contains "$out" "current canonical lifecycle state" \
    "stale empty rejection names its independent lifecycle comparison"
  assert_eq "$(git -C "$repo" rev-parse refs/heads/hetero/empty-exact-stale)" \
    "$base" "stale empty rejection preserves the unresolved exact branch"

  forged_partial="$TEST_TMP/nonempty-exact-stale-forged.json"
  node - "$actual_inventory" "$forged_partial" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
value.branch_inventory = value.branch_inventory.slice(0, 1);
value.journal_branch_inventory = value.journal_branch_inventory.slice(0, 1);
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$forged_partial" --yes 2>&1)
  rc=$?
  set -e
  assert_eq "$rc" "2" \
    "forged nonempty exact inventory cannot omit another canonical branch"
  assert_contains "$out" "current canonical lifecycle state" \
    "partial exact rejection names its canonical-set mismatch"
  assert_eq "$(git -C "$repo" rev-parse refs/heads/hetero/empty-exact-stale-b)" \
    "$base" "partial exact rejection preserves the omitted branch"
}

test_empty_exact_inventory_rejects_unresolved_journal

test_empty_exact_inventory_rejects_lost_journal_directory() {
  local repo="$TEST_TMP/empty-exact-lost-journal" inventory common out rc
  new_repo "$repo"
  inventory="$TEST_TMP/empty-exact-lost-journal.json"
  "$WORKTREE_REAPER" reap --repo "$repo" \
    --root-run-id empty-exact-lost-journal --yes > "$inventory"
  assert_exit_code "$?" "0" \
    "empty lifecycle fixture establishes a durable root anchor"
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  rm -rf "$common/autopilot-worktree-branch-inventory"
  mkdir "$common/autopilot-worktree-branch-inventory"
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$inventory" --yes 2>&1)
  rc=$?
  set -e
  assert_eq "$rc" "2" \
    "cross-bound root sentinel makes a recreated empty journal fail closed"
  assert_contains "$out" "verify or migrate exact inventory" \
    "lost journal rejection names the failed canonical preflight"
}

test_empty_exact_inventory_rejects_lost_journal_directory

test_exact_inventory_recovery_rejects_thin_bundle() {
  local repo="$TEST_TMP/thin-recovery" common identity base tip bundle inventory
  local inventory_digest disposition_dir disposition_key out rc empty
  new_repo "$repo"
  common=$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)
  identity="git-common-dir:$(realpath "$common")"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  git -C "$repo" checkout -q -b hetero/thin-recovery
  git -C "$repo" commit -q --allow-empty -m dispatch
  tip=$(git -C "$repo" rev-parse HEAD)
  git -C "$repo" checkout -q develop
  bundle="$TEST_TMP/thin-recovery.bundle"
  git -C "$repo" bundle create "$bundle" \
    "^refs/heads/develop" refs/heads/hetero/thin-recovery
  git -C "$repo" bundle verify "$bundle" >/dev/null 2>&1
  assert_exit_code "$?" "0" "thin recovery fixture verifies only in its source repo"
  empty="$TEST_TMP/thin-recovery-empty.git"
  git init --bare -q "$empty"
  set +e
  git --git-dir="$empty" bundle unbundle "$bundle" >/dev/null 2>&1
  rc=$?
  set -e
  assert_neq "$rc" 0 "thin recovery fixture is not independently restorable"

  inventory="$TEST_TMP/thin-recovery-inventory.json"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"thin-recovery","branches":[{"name":"hetero/thin-recovery","tip":"%s"}]}\n' \
    "$identity" "$tip" > "$inventory"
  write_inventory_journal "$repo" thin-recovery \
    hetero/thin-recovery "$tip" "$TEST_TMP/thin-recovery-origin"
  inventory_digest="$(
    node - "$identity" "$tip" <<'NODE'
const crypto = require("crypto");
const [repoIdentity, tip] = process.argv.slice(2);
const value = {
  branches: [{ name: "hetero/thin-recovery", tip }],
  repo_identity: repoIdentity,
  root_run_id: "thin-recovery",
};
process.stdout.write(
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"),
);
NODE
  )"
  disposition_dir="$common/autopilot-branch-dispositions"
  mkdir -p "$disposition_dir"
  disposition_key="$(
    printf '%s\0%s\0%s\0' \
      thin-recovery hetero/thin-recovery "$tip" | sha256sum | awk '{print $1}'
  )"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"thin-recovery","branch":"hetero/thin-recovery","tip":"%s","disposition":"reaped","bundle":"%s","acknowledged":false,"inventory_digest":"%s","recorded_at":1}\n' \
    "$identity" "$tip" "$bundle" "$inventory_digest" \
    > "$disposition_dir/$disposition_key.json"
  git -C "$repo" update-ref -d refs/heads/hetero/thin-recovery "$tip"

  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop \
    --inventory-file "$inventory" --yes 2>&1)
  rc=$?
  set -e
  assert_eq "$rc" 2 "crash recovery rejects a source-dependent thin bundle"
  assert_contains "$out" "missing or moved" \
    "thin recovery cannot masquerade as a safe reaped disposition"
}

test_exact_inventory_recovery_rejects_thin_bundle

test_sha256_post_delete_race_restores_exact_ref() {
  local repo="$TEST_TMP/sha256-restore" base unrelated hook out rc
  git init -q --object-format=sha256 -b develop "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  git -C "$repo" commit -q --allow-empty -m base
  base=$(git -C "$repo" rev-parse HEAD)
  unrelated=$(printf '%s\n' unrelated | git -C "$repo" commit-tree "${base}^{tree}")
  git -C "$repo" branch agent/sha256-restore-r1-20260727 develop
  hook="$TEST_TMP/move-sha256-target-after-delete.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref refs/heads/develop "$unrelated" "$base"
EOF
  chmod +x "$hook"

  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE="$hook" \
    bash "$SCRIPT" reap --repo "$repo" --into develop --yes \
      --bundle-dir "$TEST_TMP/sha256-restore-bundles" 2>/dev/null)
  rc=$?
  set -e
  assert_eq "$rc" 1 "SHA-256 post-delete target race fails closed"
  assert_contains "$out" '"stage":"post-delete-race"' \
    "SHA-256 race reports successful exact restoration"
  assert_not_contains "$out" '"stage":"restore-failed"' \
    "SHA-256 rollback does not use a 40-digit zero OID"
  assert_eq "$(git -C "$repo" rev-parse refs/heads/agent/sha256-restore-r1-20260727)" \
    "$base" "SHA-256 branch is restored at the exact pre-delete tip"
}

test_sha256_post_delete_race_restores_exact_ref

test_exact_local_target_and_defense_assertion() {
  local repo="$TEST_TMP/exact-target" base target_tip tag_tip out rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  target_tip=$(child_commit "$repo" "$base" target)
  tag_tip=$(child_commit "$repo" "$base" divergent-tag)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r9 "$target_tip"
  git -C "$repo" tag ceo-integration-candidate-r9 "$tag_tip"

  out=$(bash "$SCRIPT" scan --repo "$repo" --into ceo-integration-candidate-r9 --pattern '^.*$'); rc=$?
  assert_eq "$rc" 0 "bare --into resolves exact local branch despite same-name tag"
  assert_not_contains "$out" '"name":"ceo-integration-candidate-r9"' "integration target is excluded after broad-pattern classification"

  set +e
  bash "$SCRIPT" scan --repo "$repo" --into refs/tags/ceo-integration-candidate-r9 >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 2 "non-local exact --into ref is rejected"
}

test_exact_local_target_and_defense_assertion

test_enumeration_and_config_fail_closed() {
  local repo="$TEST_TMP/enumeration-errors" real_git fake_bin out rc
  new_repo "$repo"
  git -C "$repo" branch agent/contained-r1-20260715 develop
  real_git=$(command -v git)
  fake_bin="$TEST_TMP/enumeration-git-bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/git" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *" for-each-ref "* ]]; then
  printf '%s\n' 'agent/partial-r1-20260715'
  printf '%s\n' 'fatal: injected "enumeration" failure' >&2
  exit 9
fi
exec "$real_git" "\$@"
EOF
  chmod +x "$fake_bin/git"
  set +e
  out=$(PATH="$fake_bin:$PATH" bash "$SCRIPT" scan --repo "$repo" --into develop 2>&1); rc=$?
  set -e
  assert_eq "$rc" 2 "partial for-each-ref output fails closed"
  assert_not_contains "$out" '"branches"' "partial enumeration never emits a scan result"

  cat > "$fake_bin/git" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *" config --local --name-only --get-regexp "* ]]; then
  printf '%s\n' 'fatal: injected "config query" failure' >&2
  exit 9
fi
exec "$real_git" "\$@"
EOF
  chmod +x "$fake_bin/git"
  set +e
  out=$(PATH="$fake_bin:$PATH" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/config-fail-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "config enumeration failure is reported"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "quoted config failure remains valid JSON"; fi
  assert_contains "$out" '"stage":"config-query"' "config query failure names stage"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "config query failure preserves branch"; fi
}

test_enumeration_and_config_fail_closed

test_ack_races_and_merged_gate() {
  local repo="$TEST_TMP/ack-races" base t1 hook rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  t1=$(child_commit "$repo" "$base" candidate-one)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t1"

  hook="$TEST_TMP/delete-ack.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref -d refs/heads/ceo-integration-candidate-r1 "$t1"
EOF
  chmod +x "$hook"
  set +e
  AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE="$hook" bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_eq "$rc" 2 "ack target deleted during write fails as environment race"

  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t1"
  git -C "$repo" update-ref refs/heads/develop "$t1" "$base"
  bash "$SCRIPT" check --repo "$repo" --into develop >/dev/null
  assert_eq "$?" 0 "check returns zero once candidate is merged"
}

test_ack_races_and_merged_gate

test_ack_publication_directory_race() {
  local repo="$TEST_TMP/ack-publish-directory" base tip hook out rc ack_file
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  tip=$(child_commit "$repo" "$base" candidate)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$tip"
  ack_file="$repo/.git/autopilot-reap-ack"
  hook="$TEST_TMP/replace-ack-with-directory.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
mkdir "$ack_file"
EOF
  chmod +x "$hook"

  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION="$hook" bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 2>&1); rc=$?
  set -e
  assert_eq "$rc" 2 "ack destination directory race fails closed"
  assert_not_contains "$out" '"branches"' "failed ack publication never emits a clean check result"
  if [ -f "$ack_file" ] && [ ! -L "$ack_file" ]; then
    fail "successful --ack requires an exact regular-file publication"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
}

test_ack_publication_directory_race

test_check_snapshot_linearization_races() {
  local repo base t1 t2 hook out rc

  repo="$TEST_TMP/check-new-candidate"
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  t1=$(child_commit "$repo" "$base" candidate-one)
  t2=$(child_commit "$repo" "$base" candidate-two)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t1"
  hook="$TEST_TMP/create-candidate-after-ack.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r2 "$t2"
EOF
  chmod +x "$hook"
  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE="$hook" bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 2>&1); rc=$?
  set -e
  assert_neq "$rc" 0 "hook-after-ack new ahead candidate fails closed"
  assert_not_contains "$out" '"branches"' "new candidate race never emits stale clean JSON"

  repo="$TEST_TMP/check-candidate-cas"
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  t1=$(child_commit "$repo" "$base" candidate-one)
  t2=$(child_commit "$repo" "$t1" candidate-two)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t1"
  hook="$TEST_TMP/advance-candidate-cas-after-evaluation.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t2" "$t1"
EOF
  chmod +x "$hook"
  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_CHECK_EVALUATION="$hook" bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 2>&1); rc=$?
  set -e
  assert_neq "$rc" 0 "existing candidate exact-CAS advance fails closed"
  assert_not_contains "$out" '"branches"' "candidate advance never emits contradictory JSON"
  assert_not_contains "$(cat "$repo/.git/autopilot-reap-ack" 2>/dev/null)" "$t2" "failed raced ack never persists the moved tip"
  set +e
  bash "$SCRIPT" check --repo "$repo" --into develop >/dev/null 2>/dev/null; rc=$?
  set -e
  assert_neq "$rc" 0 "plain check after failed raced ack remains gated"

  repo="$TEST_TMP/check-target-move"
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  t1=$(child_commit "$repo" "$base" candidate-one)
  t2=$(child_commit "$repo" "$base" target-move)
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r1 "$t1"
  hook="$TEST_TMP/move-target-after-ack.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref refs/heads/develop "$t2" "$base"
EOF
  chmod +x "$hook"
  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_ACK_WRITE="$hook" bash "$SCRIPT" check --repo "$repo" --into develop --ack ceo-integration-candidate-r1 2>&1); rc=$?
  set -e
  assert_neq "$rc" 0 "integration target movement fails closed"
  assert_not_contains "$out" '"branches"' "target movement never emits stale classification JSON"
}

test_check_snapshot_linearization_races

test_worktree_and_delete_races() {
  local repo="$TEST_TMP/delete-races" real_git fake_bin hook wt out rc base unrelated
  new_repo "$repo"
  git -C "$repo" branch agent/contained-r1-20260715 develop
  real_git=$(command -v git)
  fake_bin="$TEST_TMP/worktree-git-bin"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/git" <<EOF
#!/usr/bin/env bash
if [[ " \$* " == *" worktree list --porcelain "* ]]; then
  printf '%s\n' 'fatal: injected "worktree list" failure' >&2
  exit 9
fi
exec "$real_git" "\$@"
EOF
  chmod +x "$fake_bin/git"
  set +e
  out=$(PATH="$fake_bin:$PATH" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/worktree-fail-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "worktree enumeration failure blocks deletion"
  assert_contains "$out" '"stage":"worktree-list"' "worktree enumeration failure is structured"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "worktree enumeration failure preserves branch"; fi

  git -C "$repo" branch -f agent/contained-r1-20260715 develop
  wt="$TEST_TMP/race-worktree"
  hook="$TEST_TMP/checkout-before-delete.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" worktree add -q "$wt" agent/contained-r1-20260715
EOF
  chmod +x "$hook"
  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_BEFORE_DELETE="$hook" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/pre-delete-race-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "pre-delete checkout race is caught"
  assert_contains "$out" "$wt" "pre-delete checkout race names worktree path"
  if [ -d "$wt" ]; then git -C "$repo" worktree remove --force "$wt"; fi

  git -C "$repo" branch -f agent/contained-r1-20260715 develop
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  unrelated=$(printf '%s\n' unrelated | git -C "$repo" commit-tree "${base}^{tree}")
  hook="$TEST_TMP/move-target-after-delete.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref refs/heads/develop "$unrelated" "$base"
EOF
  chmod +x "$hook"
  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE="$hook" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/post-delete-race-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "post-delete containment race fails"
  assert_contains "$out" '"stage":"post-delete-race"' "post-delete race names stage"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "post-delete race restores exact deleted ref"; fi
}

test_worktree_and_delete_races

test_restore_never_follows_concurrent_dangling_symref() {
  local repo="$TEST_TMP/restore-dangling-symref" hook out rc victim_ref branch_ref bundle
  new_repo "$repo"
  branch_ref=refs/heads/agent/contained-r1-20260715
  victim_ref=refs/heads/ordinary-victim
  git -C "$repo" branch agent/contained-r1-20260715 develop
  hook="$TEST_TMP/install-dangling-symref-after-delete.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" symbolic-ref "$branch_ref" "$victim_ref"
EOF
  chmod +x "$hook"

  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE="$hook" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/dangling-symref-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "concurrent dangling symref makes exact restoration fail closed"
  assert_contains "$out" '"stage":"restore-failed"' "dangling symref restoration reports its preservation fallback"
  if git -C "$repo" show-ref --verify --quiet "$victim_ref"; then
    fail "exact restoration must never create a concurrent symref's unrelated referent"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  assert_eq "$(git -C "$repo" symbolic-ref -q "$branch_ref")" "$victim_ref" "prepared restoration aborts and preserves the raced symref"
  bundle=$(find "$TEST_TMP/dangling-symref-bundles" -name '*.bundle' -type f | head -n1)
  if git -C "$repo" bundle verify "$bundle" >/dev/null 2>&1; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "verified bundle remains the authoritative deleted-tip recovery"; fi
  assert_contains "$(git -C "$repo" bundle list-heads "$bundle")" "$branch_ref" "authoritative bundle retains the exact dispatch ref"
}

test_restore_never_follows_concurrent_dangling_symref

test_restore_preserves_concurrent_direct_ref() {
  local repo="$TEST_TMP/restore-direct-ref" base raced hook out rc branch_ref
  new_repo "$repo"
  branch_ref=refs/heads/agent/contained-r1-20260715
  base=$(git -C "$repo" rev-parse refs/heads/develop)
  raced=$(child_commit "$repo" "$base" raced-direct-ref)
  git -C "$repo" branch agent/contained-r1-20260715 develop
  hook="$TEST_TMP/install-direct-ref-after-delete.sh"
  cat > "$hook" <<EOF
#!/usr/bin/env bash
git -C "$repo" update-ref "$branch_ref" "$raced"
exit 1
EOF
  chmod +x "$hook"

  set +e
  out=$(AUTOPILOT_REAP_TEST_HOOK_AFTER_DELETE="$hook" bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/direct-ref-bundles"); rc=$?
  set -e
  assert_eq "$rc" 1 "concurrent direct ref makes exact restoration fail closed"
  assert_contains "$out" '"stage":"restore-failed"' "direct-ref recreation is never accepted as restoration"
  assert_eq "$(git -C "$repo" rev-parse --verify "$branch_ref")" "$raced" "prepared restore preserves the concurrently recreated direct ref"
}

test_restore_preserves_concurrent_direct_ref

test_relative_bundle_dir_is_repo_relative() {
  local repo="$TEST_TMP/relative-bundle-repo" caller="$TEST_TMP/relative-bundle-caller"
  new_repo "$repo"
  git -C "$repo" branch agent/contained-r1-20260715 develop
  mkdir -p "$caller"
  (cd "$caller" && bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir relative-bundles >/dev/null)
  if find "$repo/relative-bundles" -name '*.bundle' -type f | grep -q .; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "relative bundle dir resolves against repo root"; fi
  if [ -e "$caller/relative-bundles" ]; then fail "relative bundle dir must not depend on caller cwd"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
}

test_relative_bundle_dir_is_repo_relative

test_finish_flow_package_root_resolver() {
  local package="$TEST_TMP/plugin-package" consumer="$TEST_TMP/consumer" resolver="$TEST_TMP/finish-flow-resolver.sh" out rc
  mkdir -p "$package/skills/finish-flow" "$package/scripts" "$consumer"
  cp "$REPO_ROOT/skills/finish-flow/SKILL.md" "$package/skills/finish-flow/SKILL.md"
  cp "$SCRIPT" "$package/scripts/reap-dispatch-branches.sh"
  chmod +x "$package/scripts/reap-dispatch-branches.sh"
  git init -q -b develop "$consumer"
  awk '/finish-flow-root-resolver:start/{capture=1; next} /finish-flow-root-resolver:end/{exit} capture && $0 !~ /^```/{print}' \
    "$REPO_ROOT/skills/finish-flow/SKILL.md" > "$resolver"

  out=$(cd "$consumer" && unset CLAUDE_PLUGIN_ROOT PLUGIN_ROOT && . "$resolver" && resolve_finish_flow_package_root "$package/skills/finish-flow/SKILL.md")
  assert_eq "$out" "$package" "catalog-path fallback resolves package root, never consumer git root"
  set +e
  (cd "$consumer" && unset CLAUDE_PLUGIN_ROOT PLUGIN_ROOT && . "$resolver" && resolve_finish_flow_package_root >/dev/null 2>&1); rc=$?
  set -e
  assert_neq "$rc" 0 "missing active catalog path fails closed"
  chmod -x "$package/scripts/reap-dispatch-branches.sh"
  set +e
  (cd "$consumer" && unset CLAUDE_PLUGIN_ROOT PLUGIN_ROOT && . "$resolver" && resolve_finish_flow_package_root "$package/skills/finish-flow/SKILL.md" >/dev/null 2>&1); rc=$?
  set -e
  assert_neq "$rc" 0 "non-executable package reaper fails closed"
}

test_finish_flow_package_root_resolver

test_lifecycle_wiring_is_explicit() {
  local finish front
  finish=$(cat "$REPO_ROOT/skills/finish-flow/SKILL.md")
  front=$(cat "$REPO_ROOT/skills/ceo-agent/references/level-front-door.md")
  assert_contains "$finish" '--into "$integration_target"' "finish-flow passes derived integration target explicitly"
  assert_contains "$finish" 'resolve_finish_flow_package_root()' "finish-flow ships an executable fail-closed package-root resolver"
  assert_contains "$finish" 'Never substitute the consumer git root or a newest-cache search' "finish-flow forbids consumer-root and newest-cache fallback"
  assert_contains "$front" 'Reuse finish-flow' "front-door reuses finish-flow resolver and target derivation"
  assert_contains "$front" '--repo "$consumer_repo" --into "$integration_target"' "front-door passes consumer repo and authoritative target explicitly"
  assert_not_contains "$front" $'\nscripts/reap-dispatch-branches.sh reap' "front-door has no consumer-relative reaper command"
  assert_not_contains "$front" 'reap --into develop' "front-door never hardcodes develop for reaping"
  assert_contains "$front" 'does **not** make' "front-door does not claim cherry-pick ancestry containment"
  assert_contains "$front" 'Never use a bare branch -D' "front-door forbids unpreserved out-of-grammar deletion"
}

test_lifecycle_wiring_is_explicit

finalize_test
