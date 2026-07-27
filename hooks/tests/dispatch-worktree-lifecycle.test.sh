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
while [ "$(linked_worktree_count "$CONCURRENT_REPO")" -lt 4 ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "concurrent fixture did not register four live leaves before timeout"
    break
  fi
  sleep 0.05
done
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

assert_eq "$(linked_worktree_count "$STATE_REPO")" "7" \
  "retained-state fixture registers all seven linked worktrees"
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
CUSTOM_TIP="$(
  git -C "$STATE_REPO" rev-parse --verify --quiet refs/heads/hetero/custom-p0
)"
assert_eq "$CUSTOM_TIP" "$STATE_BASE" \
  "custom hetero branch fixture preserves its exact tip"

if [ ! -x "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" ]; then
  printf '%s\n' \
    "RED_EVIDENCE lifecycle_receipt_surface=missing (owned by WLB P2/P3)"
fi

finalize_test
