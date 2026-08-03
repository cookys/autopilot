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
DIRTY_BRANCH_RESULT="$TEST_TMP/dirty-branch-result.json"
"$BRANCH_REAPER" reap --repo "$REPO" --into develop \
  --inventory-file "$DIRTY_SCAN" --yes > "$DIRTY_BRANCH_RESULT"
assert_exit_code "$?" "0" \
  "empty branch disposition preserves current dirty worktree blockers"
DIRTY_RECEIPT="$TEST_TMP/dirty-receipt.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$ROOT_ID" \
  --worktree-result "$DIRTY_SCAN" --branch-result "$DIRTY_BRANCH_RESULT" \
  --out "$DIRTY_RECEIPT"
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

node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FRESH_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "fresh receipt validates against current repository state"
node "$RECEIPT" check --repo "$REPO" --root-run-id wrong-root \
  --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt cannot be substituted across expected root runs"
node - "$REPO_ROOT" "$REPO" "$FRESH_RECEIPT" <<'NODE'
const path = require("path");
const { inspectLifecycleReceipt } = require(
  path.join(process.argv[2], "scripts", "lifecycle-residue-receipt"),
);
const result = inspectLifecycleReceipt({
  repo: process.argv[3],
  receipt: process.argv[4],
  rootRunId: "wlb-p3-root",
});
if (result.status !== "valid" || result.zero_residue !== true) process.exit(1);
if (result.active_owned_worktrees !== 0 || result.active_owned_branches !== 0) process.exit(2);
if (typeof result.receipt_digest !== "string" || !/^[0-9a-f]{64}$/.test(result.receipt_digest)) {
  process.exit(3);
}
// Backward-compatible extension: counts come from authenticated scan/dispositions,
// never a nested receipt object for LSM consumers.
if (Object.prototype.hasOwnProperty.call(result, "receipt")) process.exit(4);
NODE
assert_exit_code "$?" "0" "LSM can import the receipt consumer without computing can_close"

ORPHAN_BRANCH="hetero/p3-orphan-disposition"
ORPHAN_KEY="$(
  printf '%s\0%s\0%s\0' "$ROOT_ID" "$ORPHAN_BRANCH" "$BASE" \
    | sha256sum | awk '{print $1}'
)"
ORPHAN_DIR="$COMMON/autopilot-branch-dispositions"
printf \
  '{"schema":1,"repo_identity":"%s","root_run_id":"%s","branch":"%s","tip":"%s","disposition":"failed","bundle":null,"acknowledged":false,"inventory_digest":"%s","recorded_at":1}\n' \
  "$IDENTITY" "$ROOT_ID" "$ORPHAN_BRANCH" "$BASE" \
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" \
  > "$ORPHAN_DIR/$ORPHAN_KEY.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$ROOT_ID" \
  --worktree-result "$WORKTREE_RESULT" --branch-result "$BRANCH_RESULT" \
  --out "$TEST_TMP/orphan-receipt.json" >/dev/null 2>&1
assert_exit_code "$?" "2" "orphan disposition cannot issue a zero-residue receipt"
rm -f "$ORPHAN_DIR/$ORPHAN_KEY.json"

TAMPERED_RECEIPT="$TEST_TMP/tampered-receipt.json"
node - "$FRESH_RECEIPT" "$TAMPERED_RECEIPT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
value.zero_residue = false;
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$TAMPERED_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt digest rejects content tampering"

IMPOSSIBLE_RECEIPT="$TEST_TMP/impossible-receipt.json"
node - "$FRESH_RECEIPT" "$IMPOSSIBLE_RECEIPT" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
value.branches[0].disposition = "failed";
value.branches[0].acknowledged = true;
const { receipt_digest: ignored, ...material } = value;
value.receipt_digest = crypto.createHash("sha256")
  .update(JSON.stringify(canonicalize(material))).digest("hex");
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$IMPOSSIBLE_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "rehashed impossible disposition semantics are rejected"

FORGED_RECEIPT="$TEST_TMP/forged-receipt.json"
node - "$DIRTY_RECEIPT" "$FORGED_RECEIPT" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
value.zero_residue = true;
value.blockers = [];
const { receipt_digest: ignored, ...material } = value;
value.receipt_digest = crypto.createHash("sha256")
  .update(JSON.stringify(canonicalize(material))).digest("hex");
fs.writeFileSync(process.argv[3], JSON.stringify(value));
NODE
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FORGED_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "recomputed digest cannot forge dirty lifecycle semantics"

MARKER_DRIFT_WT="$TEST_TMP/marker-drift"
git -C "$REPO" worktree add -q -b hetero/p3-marker-drift "$MARKER_DRIFT_WT" develop
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "hetero/p3-marker-drift"
  printf 'base_sha=%s\n' "$BASE"
  printf 'run_id=%s\n' "p3-marker-drift"
  printf 'root_run_id=%s\n' "$ROOT_ID"
  printf 'loop_id=%s\n' "p3-loop"
  printf 'schema=2\n'
} > "$MARKER_DRIFT_WT/.autopilot-worktree"
: > "$MARKER_DRIFT_WT/.autopilot-worktree.lock"
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt is stale after owned marker inventory changes"
git -C "$REPO" worktree remove --force "$MARKER_DRIFT_WT"
git -C "$REPO" branch -D hetero/p3-marker-drift >/dev/null

JOURNAL_DIR="$COMMON/autopilot-worktree-branch-inventory"
commit_test_journal() {
  local root="$1" record_key="$2" root_key record mirror
  root_key="$(
    printf '%s\0%s\0' "$IDENTITY" "$root" | sha256sum | awk '{print $1}'
  )"
  record="$JOURNAL_DIR/$record_key.json"
  mirror="$COMMON/autopilot-worktree-lifecycle-roots/$root_key.$record_key.record.json"
  cp "$record" "$mirror"
  chmod 600 "$record" "$mirror"
}
JOURNAL_DRIFT="$JOURNAL_DIR/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"
printf \
  '{"schema":1,"root_run_id":"%s","path":"%s","branch":"hetero/p3-journal-drift","tip":"%s","marker_sha256":"%s","captured_at":1}\n' \
  "$ROOT_ID" "$TEST_TMP/journal-drift" "$BASE" \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
  > "$JOURNAL_DRIFT"
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "2" "malformed branch inventory journal fails closed"
rm -f "$JOURNAL_DRIFT"

git -C "$REPO" commit -q --allow-empty -m drift
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt is stale after observed HEAD changes"
git -C "$REPO" reset -q --hard "$BASE"
REAPPEARED_TIP="$(
  printf '%s\n' reappeared \
    | git -C "$REPO" commit-tree "${BASE}^{tree}" -p "$BASE"
)"
git -C "$REPO" update-ref refs/heads/hetero/p3-custom "$REAPPEARED_TIP"
node "$RECEIPT" check --repo "$REPO" --root-run-id "$ROOT_ID" --receipt "$FRESH_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "receipt is stale when a reaped ref reappears at a different tip"
git -C "$REPO" update-ref -d refs/heads/hetero/p3-custom "$REAPPEARED_TIP"

HANDOFF_ROOT_ID="wlb-p3-handoff-root"
HANDOFF_TIP="$(
  printf '%s\n' handoff \
    | git -C "$REPO" commit-tree "${BASE}^{tree}" -p "$BASE"
)"
git -C "$REPO" update-ref refs/heads/hetero/p3-handoff "$HANDOFF_TIP"
git -C "$REPO" branch agent/unrelated-r1-20260727 develop
"$WORKTREE_REAPER" scan --repo "$REPO" --root-run-id "$HANDOFF_ROOT_ID" >/dev/null
assert_exit_code "$?" "0" "handoff fixture establishes its anchored journal root"
HANDOFF_INVENTORY="$TEST_TMP/handoff-inventory.json"
printf \
  '{"schema":1,"git_common_dir":"%s","root_run_id":"%s","branch_inventory":[{"branch":"hetero/p3-handoff","tip":"%s"}]}\n' \
  "$COMMON" "$HANDOFF_ROOT_ID" "$HANDOFF_TIP" > "$HANDOFF_INVENTORY"
HANDOFF_PATH="$TEST_TMP/handoff-origin"
git -C "$REPO" worktree add -q "$HANDOFF_PATH" hetero/p3-handoff
{
  printf 'created_at=1\n'
  printf 'branch=hetero/p3-handoff\n'
  printf 'base_sha=%s\n' "$BASE"
  printf 'run_id=p3-handoff\n'
  printf 'root_run_id=%s\n' "$HANDOFF_ROOT_ID"
  printf 'loop_id=p3-handoff-loop\n'
  printf 'schema=2\n'
} > "$HANDOFF_PATH/.autopilot-worktree"
: > "$HANDOFF_PATH/.autopilot-worktree.lock"
"$WORKTREE_REAPER" journal --repo "$REPO" --root-run-id "$HANDOFF_ROOT_ID" \
  --path "$HANDOFF_PATH" >/dev/null
assert_exit_code "$?" "0" "handoff branch enters authority through exact journal command"
git -C "$REPO" worktree remove "$HANDOFF_PATH"
HANDOFF_RESULT="$TEST_TMP/handoff-result.json"
"$BRANCH_REAPER" reap --repo "$REPO" --into develop \
  --inventory-file "$HANDOFF_INVENTORY" \
  --ack-preserved "hetero/p3-handoff@$HANDOFF_TIP" --yes \
  > "$HANDOFF_RESULT"
assert_exit_code "$?" "0" "exact-tip handoff acknowledgement preserves uncontained branch"
assert_eq "$(git -C "$REPO" rev-parse refs/heads/hetero/p3-handoff)" "$HANDOFF_TIP" \
  "acknowledged handoff branch remains at its exact tip"
if git -C "$REPO" show-ref --verify --quiet refs/heads/agent/unrelated-r1-20260727; then
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
else
  fail "exact inventory mode must not classify an unrelated regex branch"
fi
HANDOFF_RECEIPT="$TEST_TMP/handoff-receipt.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$HANDOFF_ROOT_ID" \
  --worktree-result "$HANDOFF_INVENTORY" --branch-result "$HANDOFF_RESULT" \
  --out "$HANDOFF_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "acknowledged exact-tip preservation issues a receipt"
node - "$HANDOFF_RECEIPT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!value.zero_residue || value.branches[0].disposition !== "preserved"
    || value.branches[0].acknowledged !== true) process.exit(1);
NODE
assert_exit_code "$?" "0" "exact preservation acknowledgement satisfies branch disposition"
node "$RECEIPT" check --repo "$REPO" --root-run-id "$HANDOFF_ROOT_ID" --receipt "$HANDOFF_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "acknowledged handoff receipt stays fresh at the exact tip"
git -C "$REPO" update-ref refs/heads/hetero/p3-handoff "$BASE" "$HANDOFF_TIP"
node "$RECEIPT" check --repo "$REPO" --root-run-id "$HANDOFF_ROOT_ID" --receipt "$HANDOFF_RECEIPT" >/dev/null 2>&1
assert_exit_code "$?" "1" "acknowledged handoff receipt is stale after tip drift"
git -C "$REPO" update-ref -d refs/heads/hetero/p3-handoff "$BASE"
git -C "$REPO" branch -D agent/unrelated-r1-20260727 >/dev/null

SEQUENTIAL_ROOT_ID="wlb-p3-sequential-root"
for SEQUENTIAL_NAME in a b; do
  SEQUENTIAL_BRANCH="hetero/p3-sequential-$SEQUENTIAL_NAME"
  SEQUENTIAL_WT="$TEST_TMP/sequential-$SEQUENTIAL_NAME"
  git -C "$REPO" worktree add -q -b "$SEQUENTIAL_BRANCH" "$SEQUENTIAL_WT" develop
  {
    printf 'created_at=%s\n' "$(date +%s)"
    printf 'branch=%s\n' "$SEQUENTIAL_BRANCH"
    printf 'base_sha=%s\n' "$BASE"
    printf 'run_id=%s\n' "p3-sequential-$SEQUENTIAL_NAME"
    printf 'root_run_id=%s\n' "$SEQUENTIAL_ROOT_ID"
    printf 'loop_id=%s\n' "p3-sequential-loop"
    printf 'schema=2\n'
  } > "$SEQUENTIAL_WT/.autopilot-worktree"
  : > "$SEQUENTIAL_WT/.autopilot-worktree.lock"
  SEQUENTIAL_WORKTREE_RESULT="$TEST_TMP/sequential-$SEQUENTIAL_NAME-worktree.json"
  "$WORKTREE_REAPER" reap --repo "$REPO" --root-run-id "$SEQUENTIAL_ROOT_ID" --yes \
    > "$SEQUENTIAL_WORKTREE_RESULT"
  assert_exit_code "$?" "0" "sequential worktree $SEQUENTIAL_NAME is reaped"
  if [ "$SEQUENTIAL_NAME" = "b" ]; then
    node - "$SEQUENTIAL_WORKTREE_RESULT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.journal_branch_inventory.length !== 1
    || value.journal_branch_inventory[0].branch !== "hetero/p3-sequential-b") {
  process.exit(1);
}
NODE
    assert_exit_code "$?" "0" "resolved batch A does not poison sequential batch B inventory"
  fi
  SEQUENTIAL_BRANCH_RESULT="$TEST_TMP/sequential-$SEQUENTIAL_NAME-branch.json"
  "$BRANCH_REAPER" reap --repo "$REPO" --into develop \
    --inventory-file "$SEQUENTIAL_WORKTREE_RESULT" --yes \
    --bundle-dir "$TEST_TMP/sequential-bundles" > "$SEQUENTIAL_BRANCH_RESULT"
  assert_exit_code "$?" "0" "sequential branch $SEQUENTIAL_NAME is dispositioned"
done
SEQUENTIAL_RECEIPT="$TEST_TMP/sequential-receipt.json"
node "$RECEIPT" issue --repo "$REPO" --root-run-id "$SEQUENTIAL_ROOT_ID" \
  --worktree-result "$SEQUENTIAL_WORKTREE_RESULT" \
  --branch-result "$SEQUENTIAL_BRANCH_RESULT" --out "$SEQUENTIAL_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "sequential lifecycle history issues one cumulative receipt"
node - "$SEQUENTIAL_RECEIPT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!value.zero_residue || value.branches.length !== 2
    || !value.branches.every((item) => item.disposition === "reaped")) process.exit(1);
NODE
assert_exit_code "$?" "0" "cumulative receipt proves both sequential batches dispositioned"

LOSS_REPO="$TEST_TMP/journal-loss-repo"
LOSS_WT="$TEST_TMP/journal-loss-worktree"
LOSS_ROOT_ID="wlb-p3-journal-loss"
git init -q -b develop "$LOSS_REPO"
git -C "$LOSS_REPO" config user.email test@example.com
git -C "$LOSS_REPO" config user.name "Test User"
git -C "$LOSS_REPO" commit -q --allow-empty -m base
LOSS_BASE="$(git -C "$LOSS_REPO" rev-parse HEAD)"
LOSS_COMMON="$(git -C "$LOSS_REPO" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$LOSS_COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" \
  >> "$LOSS_COMMON/info/exclude"
git -C "$LOSS_REPO" worktree add -q -b hetero/p3-journal-loss "$LOSS_WT" develop
{
  printf 'created_at=1\n'
  printf 'branch=hetero/p3-journal-loss\n'
  printf 'base_sha=%s\n' "$LOSS_BASE"
  printf 'run_id=p3-journal-loss\n'
  printf 'root_run_id=%s\n' "$LOSS_ROOT_ID"
  printf 'loop_id=p3-journal-loss-loop\n'
  printf 'schema=2\n'
} > "$LOSS_WT/.autopilot-worktree"
: > "$LOSS_WT/.autopilot-worktree.lock"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null
assert_exit_code "$?" "0" "journal-loss fixture admits the root before evidence"
LOSS_REGISTRY="$LOSS_COMMON/autopilot-worktree-lifecycle-roots.registry.json"
LOSS_ROOT_KEY="$(
  printf '%s\0%s\0' "git-common-dir:$LOSS_COMMON" "$LOSS_ROOT_ID" \
    | sha256sum | awk '{print $1}'
)"
LOSS_ANCHOR="$LOSS_COMMON/autopilot-worktree-lifecycle-roots/$LOSS_ROOT_KEY.json"
cp "$LOSS_REGISTRY" "$TEST_TMP/loss-registry-empty-snapshot.json"
cp "$LOSS_ANCHOR" "$TEST_TMP/loss-anchor-empty-snapshot.json"
LOSS_RESULT="$TEST_TMP/journal-loss-result.json"
"$WORKTREE_REAPER" reap --repo "$LOSS_REPO" \
  --root-run-id "$LOSS_ROOT_ID" --yes > "$LOSS_RESULT"
assert_exit_code "$?" "0" "journal-loss fixture establishes anchored branch evidence"
LOSS_RECORD="$(
  find "$LOSS_COMMON/autopilot-worktree-branch-inventory" -maxdepth 1 \
    -type f -regextype posix-extended -regex '.*/[0-9a-f]{64}\.json' -print -quit
)"
mv "$LOSS_RECORD" "$LOSS_RECORD.lost"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "durable evidence mirror rejects individual journal record loss"
mv "$LOSS_RECORD.lost" "$LOSS_RECORD"
LOSS_RECORD_KEY="$(basename "$LOSS_RECORD" .json)"
LOSS_MIRROR="$LOSS_COMMON/autopilot-worktree-lifecycle-roots/$LOSS_ROOT_KEY.$LOSS_RECORD_KEY.record.json"
mv "$LOSS_RECORD" "$LOSS_RECORD.lost"
mv "$LOSS_MIRROR" "$LOSS_MIRROR.lost"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "anchor record-set commitment rejects dual journal and mirror loss"
mv "$LOSS_RECORD.lost" "$LOSS_RECORD"
mv "$LOSS_MIRROR.lost" "$LOSS_MIRROR"
cp "$LOSS_REGISTRY" "$TEST_TMP/loss-registry-current.json"
cp "$LOSS_ANCHOR" "$TEST_TMP/loss-anchor-current.json"
mv "$LOSS_RECORD" "$LOSS_RECORD.lost"
mv "$LOSS_MIRROR" "$LOSS_MIRROR.lost"
cp "$TEST_TMP/loss-registry-empty-snapshot.json" "$LOSS_REGISTRY"
cp "$TEST_TMP/loss-anchor-empty-snapshot.json" "$LOSS_ANCHOR"
chmod 600 "$LOSS_REGISTRY"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "Git-ref authority rejects coordinated stale anchor and registry replay"
mv "$LOSS_RECORD.lost" "$LOSS_RECORD"
mv "$LOSS_MIRROR.lost" "$LOSS_MIRROR"
cp "$TEST_TMP/loss-registry-current.json" "$LOSS_REGISTRY"
cp "$TEST_TMP/loss-anchor-current.json" "$LOSS_ANCHOR"
chmod 600 "$LOSS_REGISTRY" "$LOSS_ANCHOR"
LOSS_SENTINEL="$LOSS_COMMON/autopilot-worktree-branch-inventory/$LOSS_ROOT_KEY.root.json"
for loss_file in "$LOSS_RECORD" "$LOSS_MIRROR" "$LOSS_ANCHOR" "$LOSS_SENTINEL"; do
  mv "$loss_file" "$loss_file.lost"
done
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "active root registry prevents reinitialization after all root evidence is lost"
for loss_file in "$LOSS_RECORD" "$LOSS_MIRROR" "$LOSS_ANCHOR" "$LOSS_SENTINEL"; do
  mv "$loss_file.lost" "$loss_file"
done

EMPTY_REPO="$TEST_TMP/authority-only-repo"
EMPTY_ROOT_ID="wlb-p3-authority-only"
git init -q -b develop "$EMPTY_REPO"
git -C "$EMPTY_REPO" config user.email test@example.com
git -C "$EMPTY_REPO" config user.name "Test User"
git -C "$EMPTY_REPO" commit -q --allow-empty -m base
EMPTY_COMMON="$(git -C "$EMPTY_REPO" rev-parse --path-format=absolute --git-common-dir)"
"$WORKTREE_REAPER" scan --repo "$EMPTY_REPO" --root-run-id "$EMPTY_ROOT_ID" \
  >/dev/null
assert_exit_code "$?" "0" "empty root fixture establishes Git authority"
mv "$EMPTY_COMMON/autopilot-worktree-branch-inventory" \
  "$EMPTY_COMMON/autopilot-worktree-branch-inventory.lost"
mv "$EMPTY_COMMON/autopilot-worktree-lifecycle-roots" \
  "$EMPTY_COMMON/autopilot-worktree-lifecycle-roots.lost"
mv "$EMPTY_COMMON/autopilot-worktree-lifecycle-roots.registry.json" \
  "$EMPTY_COMMON/autopilot-worktree-lifecycle-roots.registry.json.lost"
"$WORKTREE_REAPER" scan --repo "$EMPTY_REPO" --root-run-id "$EMPTY_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "Git authority rejects fresh identity after all ordinary evidence is lost"
"$WORKTREE_REAPER" scan --repo "$EMPTY_REPO" --root-run-id "$EMPTY_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "failed recovery cannot promote a fresh empty root on a second scan"

chmod 777 "$LOSS_COMMON/autopilot-worktree-branch-inventory"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" "world-writable journal directory fails closed"
chmod 700 "$LOSS_COMMON/autopilot-worktree-branch-inventory"
mv "$LOSS_COMMON/autopilot-worktree-branch-inventory" \
  "$LOSS_COMMON/autopilot-worktree-branch-inventory.lost"
mkdir "$LOSS_COMMON/autopilot-worktree-branch-inventory"
cp "$LOSS_COMMON/autopilot-worktree-branch-inventory.lost/"*.root.json \
  "$LOSS_COMMON/autopilot-worktree-branch-inventory/"
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "directory-generation anchor rejects replayed sentinel after journal replacement"
node - "$LOSS_ANCHOR" "$LOSS_COMMON/autopilot-worktree-branch-inventory/$LOSS_ROOT_KEY.root.json" \
  "$LOSS_COMMON/autopilot-worktree-branch-inventory" <<'NODE'
const fs = require("fs");
const [anchor, sentinel, directory] = process.argv.slice(2);
const stat = fs.lstatSync(directory, { bigint: true });
for (const file of [anchor, sentinel]) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  value.journal_birthtime_ns = stat.birthtimeNs.toString();
  value.journal_device = stat.dev.toString();
  value.journal_inode = stat.ino.toString();
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
NODE
"$WORKTREE_REAPER" scan --repo "$LOSS_REPO" --root-run-id "$LOSS_ROOT_ID" \
  >/dev/null 2>&1
assert_exit_code "$?" "2" \
  "Git authority rejects coordinated active anchor and sentinel replacement"

assert_eq "$(
  git -C "$LOSS_REPO" rev-parse refs/heads/hetero/p3-journal-loss
)" "$LOSS_BASE" "journal replacement failure preserves the unresolved exact branch"

SHA_REPO="$TEST_TMP/sha256-receipt-repo"
SHA_WT="$TEST_TMP/sha256-receipt-worktree"
SHA_ROOT_ID="wlb-p3-sha256-root"
git init -q --object-format=sha256 -b develop "$SHA_REPO"
git -C "$SHA_REPO" config user.email test@example.com
git -C "$SHA_REPO" config user.name "Test User"
git -C "$SHA_REPO" commit -q --allow-empty -m base
SHA_BASE="$(git -C "$SHA_REPO" rev-parse HEAD)"
SHA_COMMON="$(git -C "$SHA_REPO" rev-parse --path-format=absolute --git-common-dir)"
mkdir -p "$SHA_COMMON/info"
printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" >> "$SHA_COMMON/info/exclude"
git -C "$SHA_REPO" worktree add -q -b hetero/p3-sha256 "$SHA_WT" develop
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' "hetero/p3-sha256"
  printf 'base_sha=%s\n' "$SHA_BASE"
  printf 'run_id=%s\n' "p3-sha256"
  printf 'root_run_id=%s\n' "$SHA_ROOT_ID"
  printf 'loop_id=%s\n' "p3-sha256-loop"
  printf 'schema=2\n'
} > "$SHA_WT/.autopilot-worktree"
: > "$SHA_WT/.autopilot-worktree.lock"
SHA_WORKTREE_RESULT="$TEST_TMP/sha256-worktree.json"
"$WORKTREE_REAPER" reap --repo "$SHA_REPO" --root-run-id "$SHA_ROOT_ID" --yes \
  > "$SHA_WORKTREE_RESULT"
SHA_BRANCH_RESULT="$TEST_TMP/sha256-branch.json"
"$BRANCH_REAPER" reap --repo "$SHA_REPO" --into develop \
  --inventory-file "$SHA_WORKTREE_RESULT" --yes \
  --bundle-dir "$TEST_TMP/sha256-receipt-bundles" > "$SHA_BRANCH_RESULT"
SHA_RECEIPT="$TEST_TMP/sha256-receipt.json"
node "$RECEIPT" issue --repo "$SHA_REPO" --root-run-id "$SHA_ROOT_ID" \
  --worktree-result "$SHA_WORKTREE_RESULT" --branch-result "$SHA_BRANCH_RESULT" \
  --out "$SHA_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "SHA-256 lifecycle receipt is issued"
node - "$SHA_RECEIPT" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!value.zero_residue || value.blockers.length !== 0
    || value.branches[0].disposition !== "reaped"
    || value.branches[0].tip.length !== 64) process.exit(1);
NODE
assert_exit_code "$?" "0" "SHA-256 bundle is independently restorable for zero residue"
node "$RECEIPT" check --repo "$SHA_REPO" --root-run-id "$SHA_ROOT_ID" --receipt "$SHA_RECEIPT" >/dev/null
assert_exit_code "$?" "0" "SHA-256 lifecycle receipt stays fresh"

write_inventory() {
  local file="$1" branches="$2"
  printf \
    '{"schema":1,"repo_identity":"%s","root_run_id":"%s","branches":%s}\n' \
    "$IDENTITY" "$ROOT_ID" "$branches" > "$file"
}

write_test_journal() {
  local branch="$1" tip="$2" origin="$3" key
  key="$(
    printf '%s\0%s\0%s\0%s\0' "$ROOT_ID" "$origin" "$branch" "$tip" \
      | sha256sum | awk '{print $1}'
  )"
  printf \
    '{"schema":1,"root_run_id":"%s","path":"%s","branch":"%s","tip":"%s","marker_sha256":"%s","captured_at":1}\n' \
    "$ROOT_ID" "$origin" "$branch" "$tip" \
    "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" \
    > "$JOURNAL_DIR/$key.json"
  commit_test_journal "$ROOT_ID" "$key"
}

MISSING="$TEST_TMP/missing.json"
write_inventory "$MISSING" '[{"name":"hetero/missing","tip":"0000000000000000000000000000000000000000"}]'
write_test_journal hetero/missing \
  0000000000000000000000000000000000000000 "$TEST_TMP/missing-origin"
MISSING_ERROR="$(
  "$BRANCH_REAPER" reap --repo "$REPO" --into develop --inventory-file "$MISSING" \
    --yes --bundle-dir "$TEST_TMP/missing-bundles" 2>&1
)"
assert_exit_code "$?" "2" "missing exact inventory branch is rejected"
assert_contains "$MISSING_ERROR" "missing or moved" "missing inventory rejection is specific"

DUPLICATE="$TEST_TMP/duplicate.json"
write_inventory "$DUPLICATE" \
  '[{"name":"hetero/duplicate","tip":"0000000000000000000000000000000000000000"},{"name":"hetero/duplicate","tip":"0000000000000000000000000000000000000000"}]'
DUPLICATE_ERROR="$(
  "$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$DUPLICATE" 2>&1
)"
assert_exit_code "$?" "2" "duplicate exact inventory branch is rejected"
assert_contains "$DUPLICATE_ERROR" "malformed or contains duplicate" \
  "duplicate inventory rejection is specific"

TARGET="$TEST_TMP/target.json"
write_inventory "$TARGET" "[{\"name\":\"develop\",\"tip\":\"$BASE\"}]"
TARGET_ERROR="$(
  "$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$TARGET" 2>&1
)"
assert_exit_code "$?" "2" "integration target cannot enter exact inventory"
assert_contains "$TARGET_ERROR" "integration target cannot enter" \
  "integration-target rejection is specific"

git -C "$REPO" update-ref refs/heads/hetero/moved "$BASE"
MOVED="$TEST_TMP/moved.json"
write_inventory "$MOVED" '[{"name":"hetero/moved","tip":"0000000000000000000000000000000000000000"}]'
write_test_journal hetero/moved \
  0000000000000000000000000000000000000000 "$TEST_TMP/moved-origin"
MOVED_ERROR="$(
  "$BRANCH_REAPER" scan --repo "$REPO" --into develop --inventory-file "$MOVED" 2>&1
)"
assert_exit_code "$?" "2" "moved exact inventory tip is rejected"
assert_contains "$MOVED_ERROR" "missing or moved" "moved-tip rejection is specific"

RECEIPT_SOURCE="$(cat "$RECEIPT")"
assert_not_contains "$RECEIPT_SOURCE" "can_close" \
  "WLB receipt implementation never computes task close authority"
assert_not_contains "$RECEIPT_SOURCE" "session-mode.js clear" \
  "WLB receipt implementation never clears the session marker"

finalize_test
