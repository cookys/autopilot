#!/usr/bin/env bash
# Fixture-repo coverage for preserve-first local dispatch branch lifecycle.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/reap-dispatch-branches.sh"

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
  assert_not_contains "$(cat "$repo/.git/autopilot-reap-ack" 2>/dev/null)" "$t1" "stale ack pruned"

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

test_superseded_opt_in_and_same_tip_survivor() {
  local repo="$TEST_TMP/reap-superseded" base t1 t2 rc
  new_repo "$repo"
  base=$(git -C "$repo" rev-parse develop)
  t1=$(child_commit "$repo" "$base" one)
  t2=$(child_commit "$repo" "$base" two)
  git -C "$repo" update-ref refs/heads/ceo-engine-task-r2-20260715 "$t1"
  git -C "$repo" update-ref refs/heads/ceo-engine-task-r10-20260715 "$t2"

  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b1" >/dev/null
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-engine-task-r2-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "superseded survives default reap"; fi
  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --reap-superseded --bundle-dir "$TEST_TMP/b2" >/dev/null
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-engine-task-r2-20260715; then fail "superseded should reap with opt-in"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi

  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r2 "$t2"
  git -C "$repo" update-ref refs/heads/ceo-integration-candidate-r10 "$t2"
  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b3" >/dev/null
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-integration-candidate-r10; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "highest-round same-tip candidate survives"; fi
  if git -C "$repo" show-ref --verify --quiet refs/heads/ceo-integration-candidate-r2; then fail "lower same-tip candidate should reap"; else __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); fi
}

test_superseded_opt_in_and_same_tip_survivor

test_bundle_failure_and_checked_out_guard() {
  local repo="$TEST_TMP/reap-failures" bad_dir="$TEST_TMP/not-a-\"dir" wt rc out
  new_repo "$repo"
  git -C "$repo" branch agent/bundle-fail-r1-20260715 develop
  : > "$bad_dir"
  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$bad_dir" 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 1 "bundle stage failure exits 1"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "quoted git-path failure must remain valid JSON"; fi
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/bundle-fail-r1-20260715; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "bundle failure must delete nothing"; fi

  wt="$TEST_TMP/checked-out-wt"
  git -C "$repo" worktree add -q "$wt" -b agent/checked-r1-20260715 develop
  set +e
  bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/b4" >/dev/null; rc=$?
  set -e
  assert_eq "$rc" 1 "checked-out eligible branch records failure"
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

test_malformed_recorded_tip_is_bundle_failure() {
  local repo="$TEST_TMP/sha256-repo" out rc
  git init -q --object-format=sha256 -b develop "$repo"
  git -C "$repo" config user.email test@example.com
  git -C "$repo" config user.name "Test User"
  git -C "$repo" commit -q --allow-empty -m base
  git -C "$repo" branch agent/contained-r1-20260715 develop

  set +e
  out=$(bash "$SCRIPT" reap --repo "$repo" --into develop --yes --bundle-dir "$TEST_TMP/sha256-bundles" 2>/dev/null); rc=$?
  set -e
  assert_eq "$rc" 1 "non-40-hex recorded tip is a bundle-stage failure"
  if json_valid "$out"; then __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)); else fail "recorded-tip failure emits valid JSON"; fi
  assert_contains "$out" '"stage":"bundle"' "recorded-tip failure names bundle stage"
  if git -C "$repo" show-ref --verify --quiet refs/heads/agent/contained-r1-20260715; then
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  else
    fail "recorded-tip failure must preserve the eligible branch"
  fi
}

test_malformed_recorded_tip_is_bundle_failure

finalize_test
