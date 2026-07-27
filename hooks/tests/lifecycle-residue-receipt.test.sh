#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

WORKTREE_REAPER="$REPO_ROOT/scripts/reap-dispatch-worktrees.sh"
BRANCH_REAPER="$REPO_ROOT/scripts/reap-dispatch-branches.sh"
RECEIPT="$REPO_ROOT/scripts/lifecycle-residue-receipt.js"
SCHEMA="$REPO_ROOT/schemas/lifecycle-residue-receipt.schema.json"
REPO="$TEST_TMP/repo"
WT="$TEST_TMP/owned-worktree"
ROOT_ID="wlb-p3-root"

git init -q -b develop "$REPO"
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name "Test User"
git -C "$REPO" commit -q --allow-empty -m base
BASE="$(git -C "$REPO" rev-parse HEAD)"
COMMON="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)"
IDENTITY="git-common-dir:$(realpath "$COMMON")"
mkdir -p "$COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" >> "$COMMON/info/exclude"

git -C "$REPO" worktree add -q -b hetero/p3-custom "$WT" develop
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "hetero/p3-custom"
  printf 'base_sha=%s\n' "$BASE"
  printf 'run_id=%s\n' "p3-custom"
  printf 'root_run_id=%s\n' "$ROOT_ID"
  printf 'loop_id=%s\n' "p3-loop"
  printf 'schema=2\n'
} > "$WT/.autopilot-worktree"
: > "$WT/.autopilot-worktree.lock"
printf '%s\n' dirty > "$WT/dirty.txt"

DIRTY_SCAN="$TEST_TMP/dirty-scan.json"
"$WORKTREE_REAPER" scan --repo "$REPO" --root-run-id "$ROOT_ID" > "$DIRTY_SCAN"
DIRTY_RECEIPT="$TEST_TMP/dirty-receipt.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$ROOT_ID" \
  --worktree-result "$DIRTY_SCAN" --out "$DIRTY_RECEIPT"
assert_exit_code "$?" "0" "dirty lifecycle observation still issues a fail-closed receipt"
node - "$DIRTY_RECEIPT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.zero_residue !== false) process.exit(1);
if (!value.blockers.some((item) => item.kind === "dirty_worktree")) process.exit(2);
NODE
assert_exit_code "$?" "0" "one dirty owned worktree makes zero_residue false"

rm -f "$WT/dirty.txt"
WORKTREE_RESULT="$TEST_TMP/worktree-reap.json"
"$WORKTREE_REAPER" reap --repo "$REPO" --root-run-id "$ROOT_ID" --yes \
  > "$WORKTREE_RESULT"
assert_exit_code "$?" "0" "clean exact worktree is reaped before branch disposition"
assert_file_absent "$WT/.git" "P3 fixture worktree is gone"

BRANCH_RESULT="$TEST_TMP/branch-reap.json"
"$BRANCH_REAPER" reap --repo "$REPO" --into develop \
  --inventory-file "$WORKTREE_RESULT" --yes --bundle-dir "$TEST_TMP/bundles" \
  > "$BRANCH_RESULT"
assert_exit_code "$?" "0" "exact inventory reaps a contained custom branch"
if git -C "$REPO" show-ref --verify --quiet refs/heads/hetero/p3-custom; then
  fail "custom inventory branch must be dispositioned without a regex"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

FRESH_RECEIPT="$TEST_TMP/fresh-receipt.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$ROOT_ID" \
  --worktree-result "$WORKTREE_RESULT" --branch-result "$BRANCH_RESULT" \
  --out "$FRESH_RECEIPT"
assert_exit_code "$?" "0" "post-disposition receipt is issued"
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$SCHEMA" --document "$FRESH_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "lifecycle receipt matches the canonical schema"
node - "$FRESH_RECEIPT" "$IDENTITY" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.repo_identity !== process.argv[3]) process.exit(1);
if (value.zero_residue !== true || value.blockers.length !== 0) process.exit(2);
if (value.branches.length !== 1
    || value.branches[0].name !== "hetero/p3-custom"
    || value.branches[0].disposition !== "reaped") process.exit(3);
NODE
assert_exit_code "$?" "0" "fresh exact receipt proves zero lifecycle residue"

node "$RECEIPT" check --repo "$REPO" --receipt "$FRESH_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "fresh receipt validates against current repository state"

git -C "$REPO" commit -q --allow-empty -m drift
node "$RECEIPT" check --repo "$REPO" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt is stale after observed HEAD changes"
git -C "$REPO" reset -q --hard "$BASE"
git -C "$REPO" update-ref refs/heads/hetero/p3-custom "$BASE"
node "$RECEIPT" check --repo "$REPO" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt is stale when a dispositioned exact branch reappears"
git -C "$REPO" update-ref -d refs/heads/hetero/p3-custom "$BASE"

write_inventory() {
  local file="$1" branches="$2"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"%s","branches":%s}\n' \
    "$IDENTITY" "$ROOT_ID" "$branches" > "$file"
}

MISSING="$TEST_TMP/missing.json"
write_inventory "$MISSING" '[{"name":"hetero/missing","tip":"0000000000000000000000000000000000000000"}]'
"$BRANCH_REAPER" reap --repo "$REPO" --into develop --inventory-file "$MISSING" \
  --yes --bundle-dir "$TEST_TMP/missing-bundles" >/dev/null 2>&1
assert_exit_code "$?" "2" "missing exact inventory branch is rejected"

DUPLICATE="$TEST_TMP/duplicate.json"
write_inventory "$DUPLICATE" \
  '[{"name":"hetero/duplicate","tip":"0000000000000000000000000000000000000000"},{"name":"hetero/duplicate","tip":"0000000000000000000000000000000000000000"}]'
"$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$DUPLICATE" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" "duplicate exact inventory branch is rejected"

TARGET="$TEST_TMP/target.json"
write_inventory "$TARGET" "[{\"name\":\"develop\",\"tip\":\"$BASE\"}]"
"$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$TARGET" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" "integration target cannot enter exact inventory"

git -C "$REPO" update-ref refs/heads/hetero/moved "$BASE"
MOVED="$TEST_TMP/moved.json"
write_inventory "$MOVED" '[{"name":"hetero/moved","tip":"0000000000000000000000000000000000000000"}]'
"$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$MOVED" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" "moved exact inventory tip is rejected"

finalize_test
