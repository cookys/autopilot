#!/usr/bin/env bash
# WLB P0 failure oracle. Production is expected to be RED until Phase 1 adds
# the locked per-root occupancy budget. All repositories and worktrees live
# under TEST_TMP; no real provider or model is invoked.
. "$(dirname "$0")/lib.sh"

DISPATCH="$REPO_ROOT/scripts/dispatch-hetero.sh"
ROOT_RUN_ID="wlb-root-p0"
PROMPT="$TEST_TMP/prompt.txt"
printf '%s\n' "create the fixture artifact" > "$PROMPT"

STUB_AGY="$TEST_TMP/agy-commit"
cat > "$STUB_AGY" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "fixture" > wlb-leaf.txt
git add wlb-leaf.txt
git -c user.email=wlb@test -c user.name=wlb commit -q -m "test: retained leaf"
printf '%s\n' "self-report: DONE"
STUB
chmod +x "$STUB_AGY"

STUB_BARRIER="$TEST_TMP/agy-barrier"
cat > "$STUB_BARRIER" <<'STUB'
#!/usr/bin/env bash
deadline=$((SECONDS + 20))
while [ ! -f "$WLB_RELEASE_FILE" ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    printf '%s\n' "barrier timeout" >&2
    exit 124
  fi
  sleep 0.05
done
printf '%s\n' "fixture" > wlb-leaf.txt
git add wlb-leaf.txt
git -c user.email=wlb@test -c user.name=wlb commit -q -m "test: concurrent retained leaf"
printf '%s\n' "self-report: DONE"
STUB
chmod +x "$STUB_BARRIER"

init_repo() {
  local repo="$1" common
  mkdir -p "$repo"
  git -C "$repo" init -q -b develop
  git -C "$repo" -c user.email=wlb@test -c user.name=wlb \
    commit -q --allow-empty -m "fixture base"
  common="$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$common/info"
  printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" \
    >> "$common/info/exclude"
}

linked_worktree_count() {
  local repo="$1"
  git -C "$repo" worktree list --porcelain \
    | awk '/^worktree / { count += 1 } END { print (count > 0 ? count - 1 : 0) }'
}

dispatch_leaf() {
  local repo="$1" branch="$2" run_id="$3" stub="$4"
  (
    cd "$repo" || exit 98
    env \
      HOME="$HOOK_HOME" \
      AUTOPILOT_DISPATCH_MANIFEST=0 \
      AUTOPILOT_PARENT_RUN_ID="wlb-parent-p0" \
      AUTOPILOT_ROOT_RUN_ID="$ROOT_RUN_ID" \
      AUTOPILOT_DISPATCH_DEPTH=1 \
      "$DISPATCH" \
        --branch "$branch" \
        --prompt-file "$PROMPT" \
        --runner agy \
        --agy-bin "$stub" \
        --context-window off \
        --run-id "$run_id" \
        --keep-worktree
  )
}

extract_worktree() {
  printf '%s' "$1" | sed -n 's/.*"worktree": "\([^"]*\)".*/\1/p' | tail -n 1
}

# Sequential polarity: four live owned leaves fill the budget. The fifth must
# fail before branch/worktree creation. Current production admits it: RED.
SEQ_REPO="$TEST_TMP/sequential-repo"
init_repo "$SEQ_REPO"
SEQ_LOCK_FDS=()

for index in 1 2 3 4; do
  output_file="$TEST_TMP/sequential-$index.out"
  dispatch_leaf \
    "$SEQ_REPO" \
    "hetero/wlb-sequential-$index" \
    "wlb-sequential-$index" \
    "$STUB_AGY" >"$output_file" 2>&1
  rc=$?
  output="$(cat "$output_file")"
  assert_exit_code "$rc" "0" "sequential leaf $index is admitted"
  assert_contains "$output" '"status": "committed"' \
    "sequential leaf $index commits"
  worktree="$(extract_worktree "$output")"
  assert_neq "$worktree" "" "sequential leaf $index reports its retained worktree"
  assert_file_exists "$worktree/.autopilot-worktree.lock" \
    "sequential leaf $index has a lifetime lock"
  assert_contains "$(cat "$worktree/.autopilot-worktree")" "schema=2" \
    "sequential leaf $index publishes a schema-2 marker"
  assert_contains "$(cat "$worktree/.autopilot-worktree")" "root_run_id=$ROOT_RUN_ID" \
    "sequential leaf $index records exact root lineage"
  assert_contains "$(cat "$worktree/.autopilot-worktree")" "run_id=wlb-sequential-$index" \
    "sequential leaf $index records exact run lineage"
  exec {held_fd}>>"$worktree/.autopilot-worktree.lock"
  flock -x "$held_fd"
  SEQ_LOCK_FDS+=("$held_fd")
done

assert_eq "$(linked_worktree_count "$SEQ_REPO")" "4" \
  "four held same-root leaves fill the occupancy budget"

SEQ_FIFTH_OUT="$TEST_TMP/sequential-fifth.out"
dispatch_leaf \
  "$SEQ_REPO" \
  "hetero/wlb-sequential-5" \
  "wlb-sequential-5" \
  "$STUB_AGY" >"$SEQ_FIFTH_OUT" 2>&1
SEQ_FIFTH_RC=$?
SEQ_FIFTH_TEXT="$(cat "$SEQ_FIFTH_OUT")"
assert_exit_code "$SEQ_FIFTH_RC" "2" \
  "RED: fifth same-root leaf is rejected before creation"
assert_contains "$SEQ_FIFTH_TEXT" '"status": "precondition_failed"' \
  "RED: fifth leaf reports precondition failure"
assert_contains "$SEQ_FIFTH_TEXT" '"resource_budget"' \
  "RED: fifth leaf names the worktree resource budget"
printf '%s\n' "$SEQ_FIFTH_TEXT" | tail -n 1 | node -e '
const value = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (value.status !== "precondition_failed"
    || value.run_id !== "wlb-sequential-5"
    || value.resource_budget.resource !== "leaf_worktrees"
    || value.resource_budget.count !== 4
    || value.resource_budget.limit !== 4) process.exit(1);
'
assert_exit_code "$?" "0" \
  "budget rejection is parseable JSON with exact machine-readable details"
FIFTH_REF="$(
  git -C "$SEQ_REPO" rev-parse --verify --quiet \
    refs/heads/hetero/wlb-sequential-5 2>/dev/null || true
)"
assert_eq "$FIFTH_REF" "" "RED: rejected fifth leaf leaks no branch"
assert_eq "$(linked_worktree_count "$SEQ_REPO")" "4" \
  "RED: rejected fifth leaf leaks no registered worktree"

# Concurrent polarity: the barrier keeps the first four workers live while all
# eight creators race. A common-dir transaction must yield exactly 4 + 4.
CONCURRENT_REPO="$TEST_TMP/concurrent-repo"
init_repo "$CONCURRENT_REPO"
RELEASE_FILE="$TEST_TMP/release-concurrent"
PIDS=()

for index in 1 2 3 4 5 6 7 8; do
  (
    export WLB_RELEASE_FILE="$RELEASE_FILE"
    dispatch_leaf \
      "$CONCURRENT_REPO" \
      "hetero/wlb-concurrent-$index" \
      "wlb-concurrent-$index" \
      "$STUB_BARRIER" \
      >"$TEST_TMP/concurrent-$index.out" 2>&1
    printf '%s\n' "$?" >"$TEST_TMP/concurrent-$index.rc"
  ) &
  PIDS+=("$!")
done

deadline=$((SECONDS + 20))
pre_release_registered=0
pre_release_budget_rejected=0
while true; do
  pre_release_registered="$(linked_worktree_count "$CONCURRENT_REPO")"
  completed=0
  pre_release_budget_rejected=0
  for index in 1 2 3 4 5 6 7 8; do
    if [ -f "$TEST_TMP/concurrent-$index.rc" ]; then
      completed=$((completed + 1))
      rc="$(cat "$TEST_TMP/concurrent-$index.rc")"
      output="$(cat "$TEST_TMP/concurrent-$index.out")"
      if [ "$rc" = "2" ] \
          && [[ "$output" == *'"status": "precondition_failed"'* ]] \
          && [[ "$output" == *'"resource_budget"'* ]]; then
        pre_release_budget_rejected=$((pre_release_budget_rejected + 1))
      fi
    fi
  done
  if [ $((pre_release_registered + completed)) -ge 8 ]; then
    break
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "concurrent fixture did not account for all eight creators before timeout"
    break
  fi
  sleep 0.05
done
assert_eq "$pre_release_registered" "4" \
  "RED: four concurrent accepted workers remain live before release"
assert_eq "$pre_release_budget_rejected" "4" \
  "RED: four concurrent creators reject before accepted workers exit"
printf '%s\n' "release" > "$RELEASE_FILE"

for child_pid in "${PIDS[@]}"; do
  wait "$child_pid"
done

accepted=0
budget_rejected=0
unexpected=0
for index in 1 2 3 4 5 6 7 8; do
  rc="$(cat "$TEST_TMP/concurrent-$index.rc")"
  output="$(cat "$TEST_TMP/concurrent-$index.out")"
  if [ "$rc" = "0" ] && [[ "$output" == *'"status": "committed"'* ]]; then
    accepted=$((accepted + 1))
  elif [ "$rc" = "2" ] \
      && [[ "$output" == *'"status": "precondition_failed"'* ]] \
      && [[ "$output" == *'"resource_budget"'* ]]; then
    budget_rejected=$((budget_rejected + 1))
  else
    unexpected=$((unexpected + 1))
  fi
done

assert_eq "$accepted" "4" "RED: concurrent budget admits exactly four leaves"
assert_eq "$budget_rejected" "4" \
  "RED: concurrent budget rejects exactly four leaves"
assert_eq "$unexpected" "0" "concurrent fixture has no unrelated failures"
assert_eq "$(linked_worktree_count "$CONCURRENT_REPO")" "4" \
  "RED: concurrent root retains exactly four registered leaves"

# Crash-window polarity: an exact pending record makes an add-before-marker
# worktree attributable. A dead, clean, unmoved artifact is reclaimed before
# the replacement leaf is admitted. An unmarked worktree without a record is
# not ownership evidence and must survive.
RECOVERY_REPO="$TEST_TMP/recovery-repo"
init_repo "$RECOVERY_REPO"
RECOVERY_BASE="$(git -C "$RECOVERY_REPO" rev-parse HEAD)"
RECOVERY_COMMON="$(git -C "$RECOVERY_REPO" rev-parse --path-format=absolute --git-common-dir)"
RECOVERY_PENDING_DIR="$RECOVERY_COMMON/autopilot-worktree-creation"
mkdir -p "$RECOVERY_PENDING_DIR"

CRASH_WT="$TEST_TMP/recovery-crash-window"
CRASH_BRANCH="wlb/recovery-crash"
git -C "$RECOVERY_REPO" worktree add -q -b "$CRASH_BRANCH" "$CRASH_WT" develop
: > "$CRASH_WT/.autopilot-worktree.lock"
CRASH_RECORD="$RECOVERY_PENDING_DIR/recovery-crash.json"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
  "$ROOT_RUN_ID" "recovery-crash" "recovery-loop" "$CRASH_BRANCH" \
  "$RECOVERY_BASE" "$CRASH_WT" > "$CRASH_RECORD"

UNOWNED_WT="$TEST_TMP/recovery-unowned"
git -C "$RECOVERY_REPO" worktree add -q -b "wlb/recovery-unowned" "$UNOWNED_WT" develop

CONFLICT_WT="$TEST_TMP/recovery-marker-conflict"
CONFLICT_BRANCH="wlb/recovery-marker-conflict"
git -C "$RECOVERY_REPO" worktree add -q -b "$CONFLICT_BRANCH" "$CONFLICT_WT" develop
printf 'created_at=%s\nbranch=%s\nschema=1\n' \
  "$(date +%s)" "$CONFLICT_BRANCH" > "$CONFLICT_WT/.autopilot-worktree"
: > "$CONFLICT_WT/.autopilot-worktree.lock"
CONFLICT_RECORD="$RECOVERY_PENDING_DIR/recovery-marker-conflict.json"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
  "$ROOT_RUN_ID" "recovery-conflict" "recovery-loop" "$CONFLICT_BRANCH" \
  "$RECOVERY_BASE" "$CONFLICT_WT" > "$CONFLICT_RECORD"

MISMATCH_WT="$TEST_TMP/recovery-identity-mismatch"
MISMATCH_BRANCH="wlb/recovery-identity-mismatch"
git -C "$RECOVERY_REPO" worktree add -q -b "$MISMATCH_BRANCH" "$MISMATCH_WT" develop
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "wlb/not-the-checked-out-branch"
  printf 'base_sha=%s\n' "$RECOVERY_BASE"
  printf 'run_id=%s\n' "recovery-mismatch"
  printf 'root_run_id=%s\n' "$ROOT_RUN_ID"
  printf 'loop_id=%s\n' "recovery-loop"
  printf 'schema=2\n'
} > "$MISMATCH_WT/.autopilot-worktree"
: > "$MISMATCH_WT/.autopilot-worktree.lock"

# Simulate a consuming repository's first-ever dispatch. Production must install
# the common excludes before opening the add-before-marker crash window.
: > "$RECOVERY_COMMON/info/exclude"

RECOVERY_OUT="$TEST_TMP/recovery-dispatch.out"
dispatch_leaf \
  "$RECOVERY_REPO" \
  "hetero/wlb-recovery-replacement" \
  "wlb-recovery-replacement" \
  "$STUB_AGY" >"$RECOVERY_OUT" 2>&1
RECOVERY_RC=$?
assert_exit_code "$RECOVERY_RC" "0" \
  "replacement leaf is admitted after exact crash-window reconciliation"
assert_contains "$(cat "$RECOVERY_OUT")" '"status": "committed"' \
  "replacement leaf commits after reconciliation"
assert_file_exists "$CRASH_RECORD" \
  "reconciled pending record preserves exact branch evidence"
if git -C "$RECOVERY_REPO" worktree list --porcelain | grep -qxF "worktree $CRASH_WT"; then
  fail "reconciled crash-window worktree remains registered"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_eq "$(
  git -C "$RECOVERY_REPO" rev-parse --verify --quiet "refs/heads/$CRASH_BRANCH" 2>/dev/null || true
)" "$RECOVERY_BASE" "crash-window branch is preserved for exact later disposition"
assert_file_exists "$UNOWNED_WT/.git" \
  "unmarked worktree without pending ownership survives reconciliation"
assert_file_exists "$CONFLICT_RECORD" \
  "pending record with a conflicting legacy marker is preserved"
assert_file_exists "$CONFLICT_WT/.git" \
  "legacy marker conflict is never treated as an absent-marker crash window"
assert_file_exists "$MISMATCH_WT/.git" \
  "schema-2 marker with mismatched checked-out branch is preserved"
assert_contains "$(cat "$RECOVERY_COMMON/info/exclude")" ".autopilot-worktree.lock" \
  "first dispatch installs bookkeeping exclusions before recovery"

# Real SIGKILL boundaries: every managed creation checkpoint must leave either
# recoverable pending evidence or a schema-2 marker. A subsequent creator must
# reconcile the dead clean worktree without leaving an invisible registration.
for checkpoint in after-pending after-add after-marker after-verification; do
  CRASH_REPO="$TEST_TMP/crash-$checkpoint-repo"
  init_repo "$CRASH_REPO"
  CRASH_COMMON="$(git -C "$CRASH_REPO" rev-parse --path-format=absolute --git-common-dir)"
  ORIGINAL_ROOT_RUN_ID="$ROOT_RUN_ID"
  ROOT_RUN_ID="wlb-crash-$checkpoint"
  (
    export AUTOPILOT_TEST_WORKTREE_CRASH_AT="$checkpoint"
    dispatch_leaf \
      "$CRASH_REPO" \
      "wlb/crash-$checkpoint" \
      "crash-$checkpoint" \
      "$STUB_AGY"
  ) >"$TEST_TMP/crash-$checkpoint.out" 2>&1
  CRASH_RC=$?
  assert_exit_code "$CRASH_RC" "137" \
    "$checkpoint fixture terminates at the real SIGKILL boundary"

  CRASH_RECORDS=("$CRASH_COMMON"/autopilot-worktree-creation/*.json)
  assert_file_exists "${CRASH_RECORDS[0]}" \
    "$checkpoint leaves an atomic pending creation record"
  CRASH_PLANNED_PATH="$(node -e '
const fs = require("fs");
process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).planned_path);
' "${CRASH_RECORDS[0]}")"

  dispatch_leaf \
    "$CRASH_REPO" \
    "wlb/recover-$checkpoint" \
    "recover-$checkpoint" \
    "$STUB_AGY" >"$TEST_TMP/recover-$checkpoint.out" 2>&1
  RECOVER_RC=$?
  assert_exit_code "$RECOVER_RC" "0" \
    "$checkpoint residue permits a reconciled replacement"
  assert_contains "$(cat "$TEST_TMP/recover-$checkpoint.out")" '"status": "committed"' \
    "$checkpoint replacement commits"
  if git -C "$CRASH_REPO" worktree list --porcelain \
      | grep -qxF "worktree $CRASH_PLANNED_PATH"; then
    fail "$checkpoint leaves the crashed worktree registered after reconciliation"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
  ROOT_RUN_ID="$ORIGINAL_ROOT_RUN_ID"
done

# Retained-state fixture inventory. P0 proves these states can be constructed
# without claiming that the not-yet-implemented lifecycle scanner handles them.
STATE_REPO="$TEST_TMP/state-repo"
init_repo "$STATE_REPO"
STATE_BASE="$(git -C "$STATE_REPO" rev-parse HEAD)"
STATE_COMMON="$(git -C "$STATE_REPO" rev-parse --path-format=absolute --git-common-dir)"
STATE_ROOT="wlb-state-root-p0"
STATE_INDEX=0

add_state_worktree() {
  local label="$1" branch="$2"
  STATE_INDEX=$((STATE_INDEX + 1))
  STATE_WT="$TEST_TMP/state-$STATE_INDEX-$label"
  git -C "$STATE_REPO" worktree add -q -b "$branch" "$STATE_WT" develop
}

write_schema2_marker() {
  local worktree="$1" branch="$2" run_id="$3" loop_id="$4"
  {
    printf 'created_at=%s\n' "$(date +%s)"
    printf 'branch=%s\n' "$branch"
    printf 'base_sha=%s\n' "$STATE_BASE"
    printf 'run_id=%s\n' "$run_id"
    printf 'root_run_id=%s\n' "$STATE_ROOT"
    printf 'loop_id=%s\n' "$loop_id"
    printf 'schema=2\n'
  } > "$worktree/.autopilot-worktree"
  : > "$worktree/.autopilot-worktree.lock"
}

add_state_worktree "clean" "hetero/custom-p0"
CLEAN_WT="$STATE_WT"
write_schema2_marker "$CLEAN_WT" "hetero/custom-p0" "state-clean" "loop-clean"

add_state_worktree "dirty" "wlb/state-dirty"
DIRTY_WT="$STATE_WT"
write_schema2_marker "$DIRTY_WT" "wlb/state-dirty" "state-dirty" "loop-dirty"
printf '%s\n' "preserve me" > "$DIRTY_WT/dirty.txt"

add_state_worktree "live" "wlb/state-live"
LIVE_WT="$STATE_WT"
write_schema2_marker "$LIVE_WT" "wlb/state-live" "state-live" "loop-live"
exec {state_live_fd}>>"$LIVE_WT/.autopilot-worktree.lock"
flock -x "$state_live_fd"

add_state_worktree "unsupported" "wlb/state-unsupported"
UNSUPPORTED_WT="$STATE_WT"
write_schema2_marker \
  "$UNSUPPORTED_WT" \
  "wlb/state-unsupported" \
  "state-unsupported" \
  "loop-unsupported"
rm -f "$UNSUPPORTED_WT/.autopilot-worktree.lock"
LOCK_TARGET="$TEST_TMP/unsupported-lock-target"
: > "$LOCK_TARGET"
ln -s "$LOCK_TARGET" "$UNSUPPORTED_WT/.autopilot-worktree.lock"

add_state_worktree "malformed" "wlb/state-malformed"
MALFORMED_WT="$STATE_WT"
write_schema2_marker \
  "$MALFORMED_WT" \
  "wlb/state-malformed" \
  "state-malformed" \
  "loop-malformed"
printf '%s\n' 'root_run_id=bad root id' >> "$MALFORMED_WT/.autopilot-worktree"

add_state_worktree "legacy" "wlb/state-legacy"
LEGACY_WT="$STATE_WT"
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "wlb/state-legacy"
  printf 'schema=1\n'
} > "$LEGACY_WT/.autopilot-worktree"
: > "$LEGACY_WT/.autopilot-worktree.lock"

add_state_worktree "pending" "wlb/state-pending"
PENDING_WT="$STATE_WT"
: > "$PENDING_WT/.autopilot-worktree.lock"
PENDING_DIR="$STATE_COMMON/autopilot-worktree-creation"
mkdir -p "$PENDING_DIR"
PENDING_RECORD="$PENDING_DIR/state-pending.json"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
  "$STATE_ROOT" \
  "state-pending" \
  "loop-pending" \
  "wlb/state-pending" \
  "$STATE_BASE" \
  "$PENDING_WT" > "$PENDING_RECORD"

add_state_worktree "pending-moved" "wlb/state-pending-moved"
PENDING_MOVED_WT="$STATE_WT"
: > "$PENDING_MOVED_WT/.autopilot-worktree.lock"
printf '%s\n' "moved tip" > "$PENDING_MOVED_WT/moved.txt"
git -C "$PENDING_MOVED_WT" add moved.txt
git -C "$PENDING_MOVED_WT" -c user.email=wlb@test -c user.name=wlb \
  commit -q -m "test: move pending branch tip"
PENDING_MOVED_TIP="$(git -C "$PENDING_MOVED_WT" rev-parse HEAD)"
PENDING_MOVED_RECORD="$PENDING_DIR/state-pending-moved.json"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
  "$STATE_ROOT" \
  "state-pending-moved" \
  "loop-pending-moved" \
  "wlb/state-pending-moved" \
  "$STATE_BASE" \
  "$PENDING_MOVED_WT" > "$PENDING_MOVED_RECORD"

assert_eq "$(linked_worktree_count "$STATE_REPO")" "8" \
  "retained-state fixture registers all eight linked worktrees"
assert_eq "$(git -C "$CLEAN_WT" status --porcelain=v1)" "" \
  "clean/dead fixture is clean"
assert_contains "$(git -C "$DIRTY_WT" status --porcelain=v1)" "dirty.txt" \
  "dirty/dead fixture is dirty"
flock -n "$LIVE_WT/.autopilot-worktree.lock" -c true >/dev/null 2>&1
assert_neq "$?" "0" "live fixture lifetime lock is held"
if [ -L "$UNSUPPORTED_WT/.autopilot-worktree.lock" ]; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "lock-unsupported fixture uses a symlink lock"
fi
assert_contains "$(cat "$MALFORMED_WT/.autopilot-worktree")" \
  "root_run_id=bad root id" "malformed marker fixture violates field grammar"
assert_contains "$(cat "$LEGACY_WT/.autopilot-worktree")" "schema=1" \
  "legacy marker fixture remains schema 1"
assert_file_absent "$PENDING_WT/.autopilot-worktree" \
  "pending fixture remains in the add-before-marker window"
assert_file_exists "$PENDING_RECORD" "pending fixture has an exact creation record"
assert_file_exists "$PENDING_MOVED_RECORD" \
  "moved-tip pending fixture has an exact creation record"
CUSTOM_TIP="$(
  git -C "$STATE_REPO" rev-parse --verify --quiet refs/heads/hetero/custom-p0
)"
assert_eq "$CUSTOM_TIP" "$STATE_BASE" \
  "custom hetero branch fixture preserves its exact tip"

STATE_RECONCILE_OUT="$TEST_TMP/state-reconcile.out"
ORIGINAL_ROOT_RUN_ID="$ROOT_RUN_ID"
ROOT_RUN_ID="$STATE_ROOT"
dispatch_leaf \
  "$STATE_REPO" \
  "hetero/wlb-state-replacement" \
  "wlb-state-replacement" \
  "$STUB_AGY" >"$STATE_RECONCILE_OUT" 2>&1
STATE_RECONCILE_RC=$?
ROOT_RUN_ID="$ORIGINAL_ROOT_RUN_ID"
assert_exit_code "$STATE_RECONCILE_RC" "2" \
  "preserved negative states exhaust the four-leaf budget"
assert_contains "$(cat "$STATE_RECONCILE_OUT")" '"resource_budget"' \
  "preserved negative states block replacement with a resource receipt"
assert_file_absent "$CLEAN_WT/.git" \
  "dead clean schema-2 worktree is reclaimed during occupancy reconciliation"
assert_file_absent "$PENDING_WT/.git" \
  "exact dead clean add-before-marker worktree is reclaimed"
assert_file_exists "$PENDING_RECORD" \
  "reconciled add-before-marker record preserves exact branch evidence"
assert_file_exists "$DIRTY_WT/.git" \
  "dirty schema-2 worktree is preserved"
assert_file_exists "$LIVE_WT/.git" \
  "live schema-2 worktree is preserved"
assert_file_exists "$UNSUPPORTED_WT/.git" \
  "lock-unsupported schema-2 worktree is preserved"
assert_file_exists "$MALFORMED_WT/.git" \
  "malformed schema-2 worktree is preserved"
assert_file_exists "$LEGACY_WT/.git" \
  "legacy schema-1 worktree is preserved"
assert_file_exists "$PENDING_MOVED_WT/.git" \
  "pending worktree with a moved branch tip is preserved"
assert_file_exists "$PENDING_MOVED_RECORD" \
  "moved-tip pending record remains available for later disposition"
assert_eq "$(
  git -C "$STATE_REPO" rev-parse --verify --quiet refs/heads/wlb/state-pending-moved 2>/dev/null || true
)" "$PENDING_MOVED_TIP" "pending reconciliation never deletes a moved branch tip"
assert_eq "$(
  git -C "$STATE_REPO" rev-parse --verify --quiet refs/heads/wlb/state-pending 2>/dev/null || true
)" "$STATE_BASE" "unmoved add-before-marker branch is preserved for later disposition"
assert_eq "$(
  git -C "$STATE_REPO" rev-parse --verify --quiet refs/heads/hetero/custom-p0 2>/dev/null || true
)" "$CUSTOM_TIP" "normal schema-2 reclamation preserves the exact branch tip"

if [ ! -x "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" ]; then
  printf '%s\n' \
    "RED_EVIDENCE lifecycle_receipt_surface=missing (owned by WLB P2/P3)"
fi

finalize_test
