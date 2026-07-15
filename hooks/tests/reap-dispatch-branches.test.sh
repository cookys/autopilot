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
  assert_contains "$front" 'does **not** make' "front-door does not claim cherry-pick ancestry containment"
  assert_contains "$front" 'Never use a bare branch -D' "front-door forbids unpreserved out-of-grammar deletion"
}

test_lifecycle_wiring_is_explicit

finalize_test
