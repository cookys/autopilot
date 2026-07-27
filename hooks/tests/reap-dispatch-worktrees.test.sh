#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CONTROLLER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"
REPO="$TEST_TMP/repo"
ROOT_ID="wlb-p2-root"

mkdir -p "$REPO"
git -C "$REPO" init -q -b develop
git -C "$REPO" -c user.email=wlb@test -c user.name=wlb \
  commit -q --allow-empty -m "fixture base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
COMMON="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" >> "$COMMON/info/exclude"

add_worktree() {
  local label="$1" branch="$2"
  WT="$TEST_TMP/$label"
  git -C "$REPO" worktree add -q -b "$branch" "$WT" develop
}

write_marker() {
  local path="$1" branch="$2" run_id="$3"
  {
    printf 'created_at=%s\n' "$(date +%s)"
    printf 'branch=%s\n' "$branch"
    printf 'base_sha=%s\n' "$BASE"
    printf 'run_id=%s\n' "$run_id"
    printf 'root_run_id=%s\n' "$ROOT_ID"
    printf 'loop_id=%s\n' "p2-loop"
    printf 'schema=2\n'
  } > "$path/.autopilot-worktree"
  : > "$path/.autopilot-worktree.lock"
}

add_worktree clean "hetero/p2-custom-clean"
CLEAN_WT="$WT"
write_marker "$CLEAN_WT" "hetero/p2-custom-clean" "p2-clean"
CLEAN_TIP="$(git -C "$CLEAN_WT" rev-parse HEAD)"

add_worktree race "wlb/p2-race"
RACE_WT="$WT"
write_marker "$RACE_WT" "wlb/p2-race" "p2-race"

add_worktree marker-race "wlb/p2-marker-race"
MARKER_RACE_WT="$WT"
write_marker "$MARKER_RACE_WT" "wlb/p2-marker-race" "p2-marker-race"

add_worktree lock-race "wlb/p2-lock-race"
LOCK_RACE_WT="$WT"
write_marker "$LOCK_RACE_WT" "wlb/p2-lock-race" "p2-lock-race"

add_worktree dirty "wlb/p2-dirty"
DIRTY_WT="$WT"
write_marker "$DIRTY_WT" "wlb/p2-dirty" "p2-dirty"
printf '%s\n' "preserve" > "$DIRTY_WT/dirty.txt"

add_worktree live "wlb/p2-live"
LIVE_WT="$WT"
write_marker "$LIVE_WT" "wlb/p2-live" "p2-live"
exec {live_fd}>>"$LIVE_WT/.autopilot-worktree.lock"
flock -x "$live_fd"

add_worktree unsupported "wlb/p2-unsupported"
UNSUPPORTED_WT="$WT"
write_marker "$UNSUPPORTED_WT" "wlb/p2-unsupported" "p2-unsupported"
LOCK_TARGET="$TEST_TMP/unsupported-target"
: > "$LOCK_TARGET"
rm -f "$UNSUPPORTED_WT/.autopilot-worktree.lock"
ln -s "$LOCK_TARGET" "$UNSUPPORTED_WT/.autopilot-worktree.lock"

add_worktree mismatch "wlb/p2-mismatch"
MISMATCH_WT="$WT"
write_marker "$MISMATCH_WT" "wlb/not-checked-out" "p2-mismatch"

add_worktree legacy "wlb/p2-legacy"
LEGACY_WT="$WT"
printf 'created_at=%s\nbranch=%s\nschema=1\n' \
  "$(date +%s)" "wlb/p2-legacy" > "$LEGACY_WT/.autopilot-worktree"
: > "$LEGACY_WT/.autopilot-worktree.lock"

add_worktree marker-symlink "wlb/p2-marker-symlink"
MARKER_SYMLINK_WT="$WT"
MARKER_TARGET="$TEST_TMP/marker-target"
printf 'created_at=%s\nbranch=%s\nschema=1\n' \
  "$(date +%s)" "wlb/p2-marker-symlink" > "$MARKER_TARGET"
ln -s "$MARKER_TARGET" "$MARKER_SYMLINK_WT/.autopilot-worktree"
: > "$MARKER_SYMLINK_WT/.autopilot-worktree.lock"

PENDING_DIR="$COMMON/autopilot-worktree-creation"
mkdir -p "$PENDING_DIR"
PENDING_RECORD="$PENDING_DIR/p2-pending.json"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"p2-pending","loop_id":"p2-loop","branch":"wlb/p2-pending","base_sha":"%s","planned_path":"%s"}\n' \
  "$ROOT_ID" "$BASE" "$TEST_TMP/pending-path" > "$PENDING_RECORD"
printf '%s\n' '{"schema":' > "$PENDING_DIR/malformed.json"

SCAN_OUT="$TEST_TMP/scan.json"
"$CONTROLLER" scan --repo "$REPO" --root-run-id "$ROOT_ID" > "$SCAN_OUT"
SCAN_RC=$?
assert_exit_code "$SCAN_RC" "0" "scan succeeds"
node - "$SCAN_OUT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.command !== "scan") process.exit(1);
if (value.owned_worktree_count !== 8) process.exit(2);
if (value.clean_dead.length !== 4) process.exit(3);
if (value.dirty.length !== 1) process.exit(4);
if (value.live.length !== 1) process.exit(5);
if (value.lock_unsupported.length !== 1) process.exit(6);
if (!value.malformed.some(x => x.reason === "ownership_identity_mismatch")) process.exit(7);
if (!value.malformed.some(x => x.reason === "invalid_pending_record")) process.exit(10);
if (!value.malformed.some(x => x.path.endsWith("/marker-symlink"))) process.exit(11);
if (value.legacy.length !== 1) process.exit(8);
if (value.pending_creation.length !== 1) process.exit(9);
NODE
assert_exit_code "$?" "0" "scan reports every owned and preserved state exactly"

CHECK_OUT="$TEST_TMP/check.json"
"$CONTROLLER" check --repo "$REPO" --root-run-id "$ROOT_ID" > "$CHECK_OUT"
CHECK_RC=$?
assert_exit_code "$CHECK_RC" "1" "check fails while exact owned worktrees remain"

"$CONTROLLER" reap --repo "$REPO" --root-run-id "$ROOT_ID" > /dev/null 2>&1
assert_exit_code "$?" "2" "reap requires explicit --yes"

REAP_OUT="$TEST_TMP/reap.json"
AUTOPILOT_TEST_WORKTREE_REAP_RACE_PATH="$RACE_WT" \
AUTOPILOT_TEST_WORKTREE_REAP_LOCK_RACE_PATH="$LOCK_RACE_WT" \
AUTOPILOT_TEST_WORKTREE_REAP_MARKER_RACE_PATH="$MARKER_RACE_WT" \
AUTOPILOT_TEST_MODE=1 \
  "$CONTROLLER" reap --repo "$REPO" --root-run-id "$ROOT_ID" --yes > "$REAP_OUT"
REAP_RC=$?
assert_exit_code "$REAP_RC" "0" "reap completes with preserve-first result"
node - "$REAP_OUT" "$CLEAN_WT" "$RACE_WT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.command !== "reap") process.exit(1);
if (value.reaped.length !== 1 || value.reaped[0].path !== process.argv[3]) process.exit(2);
if (value.raced.length !== 3) process.exit(3);
if (!value.raced.some(x => x.path === process.argv[4] && x.reason === "cleanliness_changed")) process.exit(4);
if (!value.raced.some(x => x.reason === "lifetime_lock_changed")) process.exit(5);
if (!value.raced.some(x => x.reason === "marker_changed")) process.exit(8);
if (value.owned_worktree_count !== 7) process.exit(6);
if (value.branch_inventory.length !== 1
    || value.branch_inventory[0].branch !== "hetero/p2-custom-clean") process.exit(7);
if (value.branch_inventory_records.length !== 1
    || value.branch_inventory_records[0].branch !== "hetero/p2-custom-clean") process.exit(9);
const record = JSON.parse(fs.readFileSync(value.branch_inventory_records[0].record, "utf8"));
if (record.tip !== value.branch_inventory[0].tip
    || record.branch !== "hetero/p2-custom-clean") process.exit(10);
NODE
assert_exit_code "$?" "0" "reap durably journals exact branch inventory before removal"

assert_file_absent "$CLEAN_WT/.git" "dead clean exact worktree is removed"
assert_eq "$(
  git -C "$REPO" rev-parse --verify --quiet refs/heads/hetero/p2-custom-clean
)" "$CLEAN_TIP" "reap preserves the exact custom branch tip"
assert_file_exists "$RACE_WT/.git" "compare/remove race preserves worktree"
assert_file_exists "$MARKER_RACE_WT/.git" "marker-byte race preserves worktree"
assert_file_exists "$LOCK_RACE_WT/.git" "lifetime-lock inode race preserves worktree"
assert_file_exists "$DIRTY_WT/.git" "dirty worktree survives"
assert_file_exists "$LIVE_WT/.git" "live worktree survives"
assert_file_exists "$UNSUPPORTED_WT/.git" "lock-unsupported worktree survives"
assert_file_exists "$MISMATCH_WT/.git" "identity-mismatched worktree survives"
assert_file_exists "$LEGACY_WT/.git" "legacy worktree survives"
assert_file_exists "$MARKER_SYMLINK_WT/.git" "symlink marker worktree survives"

PENDING_ONLY_REPO="$TEST_TMP/pending-only-repo"
mkdir -p "$PENDING_ONLY_REPO"
git -C "$PENDING_ONLY_REPO" init -q -b develop
git -C "$PENDING_ONLY_REPO" -c user.email=wlb@test -c user.name=wlb \
  commit -q --allow-empty -m "pending-only fixture"
PENDING_ONLY_COMMON="$(
  git -C "$PENDING_ONLY_REPO" rev-parse --path-format=absolute --git-common-dir
)"
mkdir -p "$PENDING_ONLY_COMMON/autopilot-worktree-creation"
printf \
  '{"schema":1,"root_run_id":"%s","run_id":"pending-only","loop_id":"p2-loop","branch":"wlb/pending-only","base_sha":"%s","planned_path":"%s"}\n' \
  "$ROOT_ID" "$(git -C "$PENDING_ONLY_REPO" rev-parse HEAD)" "$TEST_TMP/pending-only-path" \
  > "$PENDING_ONLY_COMMON/autopilot-worktree-creation/pending-only.json"
"$CONTROLLER" check --repo "$PENDING_ONLY_REPO" --root-run-id "$ROOT_ID" \
  > "$TEST_TMP/pending-only-check.json"
assert_exit_code "$?" "1" "check fails while exact same-root pending creation remains"
node - "$TEST_TMP/pending-only-check.json" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.owned_worktree_count !== 0 || value.unresolved_pending_count !== 1) process.exit(1);
NODE
assert_exit_code "$?" "0" "pending-only failure reports its blocker count explicitly"

LINKED_REPO="$TEST_TMP/linked-repo"
mkdir -p "$LINKED_REPO"
git -C "$LINKED_REPO" init -q -b develop
git -C "$LINKED_REPO" -c user.email=wlb@test -c user.name=wlb \
  commit -q --allow-empty -m "linked fixture"
LINKED_WT="$TEST_TMP/"$'linked\nowned'
git -C "$LINKED_REPO" worktree add -q -b "wlb/p2-linked-owned" "$LINKED_WT" develop
LINKED_BASE="$(git -C "$LINKED_WT" rev-parse HEAD)"
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "wlb/p2-linked-owned"
  printf 'base_sha=%s\n' "$LINKED_BASE"
  printf 'run_id=%s\n' "p2-linked-owned"
  printf 'root_run_id=%s\n' "$ROOT_ID"
  printf 'loop_id=%s\n' "p2-loop"
  printf 'schema=2\n'
} > "$LINKED_WT/.autopilot-worktree"
: > "$LINKED_WT/.autopilot-worktree.lock"
"$CONTROLLER" check --repo "$LINKED_WT" --root-run-id "$ROOT_ID" \
  > "$TEST_TMP/linked-root-check.json"
assert_exit_code "$?" "1" "linked-worktree repo input cannot hide its own owned entry"
node - "$TEST_TMP/linked-root-check.json" "$LINKED_WT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.owned_worktree_count !== 1 || value.owned[0].path !== process.argv[3]) process.exit(1);
NODE
assert_exit_code "$?" "0" "NUL porcelain preserves an exact control-character path"

EMPTY_REPO="$TEST_TMP/empty-repo"
mkdir -p "$EMPTY_REPO"
git -C "$EMPTY_REPO" init -q -b develop
git -C "$EMPTY_REPO" -c user.email=wlb@test -c user.name=wlb \
  commit -q --allow-empty -m "empty fixture"
"$CONTROLLER" check --repo "$EMPTY_REPO" --root-run-id "$ROOT_ID" \
  > "$TEST_TMP/empty-check.json"
assert_exit_code "$?" "0" "check succeeds when exact owned worktree count is zero"

finalize_test
