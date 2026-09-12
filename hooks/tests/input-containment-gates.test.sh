#!/usr/bin/env bash
# Inputs-landed and method-selected containment gates.
. "$(dirname "$0")/lib.sh"

# --- inputs-landed: 3 present vs 2 absent named in one run ---
INPUTS_REPO="$TEST_TMP/inputs-repo"
git init -q -b target "$INPUTS_REPO"
git -C "$INPUTS_REPO" config user.name "Containment Fixture"
git -C "$INPUTS_REPO" config user.email "containment@example.invalid"
printf 'a\n' >"$INPUTS_REPO/a.txt"
git -C "$INPUTS_REPO" add a.txt
git -C "$INPUTS_REPO" commit -qm a
INPUT_A="$(git -C "$INPUTS_REPO" rev-parse HEAD)"
git -C "$INPUTS_REPO" commit --allow-empty -qm b
INPUT_B="$(git -C "$INPUTS_REPO" rev-parse HEAD)"
git -C "$INPUTS_REPO" commit --allow-empty -qm c
INPUT_C="$(git -C "$INPUTS_REPO" rev-parse HEAD)"
git -C "$INPUTS_REPO" checkout --orphan orphan -q
git -C "$INPUTS_REPO" commit --allow-empty -qm orphan
INPUT_ORPHAN="$(git -C "$INPUTS_REPO" rev-parse HEAD)"
git -C "$INPUTS_REPO" checkout -q target
INPUT_MISSING="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

node - "$TEST_TMP/inputs-partial.json" "$INPUT_C" "$INPUT_ORPHAN" "$INPUT_MISSING" <<'NODE'
const fs = require('fs');
const [out, present, orphan, missing] = process.argv.slice(2);
fs.writeFileSync(out, `${JSON.stringify({
  inputs: [
    { id: 'present', sha: present },
    { id: 'orphan-lane', sha: orphan },
    { id: 'missing-lane', sha: missing },
  ],
})}\n`);
NODE
node - "$TEST_TMP/inputs-all.json" "$INPUT_A" "$INPUT_B" "$INPUT_C" <<'NODE'
const fs = require('fs');
const [out, a, b, c] = process.argv.slice(2);
fs.writeFileSync(out, `${JSON.stringify({
  inputs: [
    { id: 'lane-a', sha: a },
    { id: 'lane-b', sha: b },
    { id: 'lane-c', sha: c },
  ],
})}\n`);
NODE

REFS_BEFORE="$(git -C "$INPUTS_REPO" for-each-ref --format='%(refname) %(objectname)')"
HEAD_BEFORE="$(git -C "$INPUTS_REPO" rev-parse HEAD)"
STATUS_BEFORE="$(git -C "$INPUTS_REPO" status --porcelain=v1 --untracked-files=all)"

set +e
node "$REPO_ROOT/scripts/check-inputs-landed.js" \
  --inputs "$TEST_TMP/inputs-partial.json" --target HEAD --repo "$INPUTS_REPO" \
  >"$TEST_TMP/inputs-partial.out" 2>"$TEST_TMP/inputs-partial.err"
PARTIAL_EXIT=$?
node "$REPO_ROOT/scripts/check-inputs-landed.js" \
  --inputs "$TEST_TMP/inputs-all.json" --target HEAD --repo "$INPUTS_REPO" \
  >"$TEST_TMP/inputs-all.out" 2>"$TEST_TMP/inputs-all.err"
ALL_EXIT=$?
assert_neq "$PARTIAL_EXIT" "0" "p2: mixed inputs exit non-zero"
assert_eq "$ALL_EXIT" "0" "p2: three present inputs exit 0"
PARTIAL_ERR="$(cat "$TEST_TMP/inputs-partial.err")"
assert_contains "$PARTIAL_ERR" "orphan-lane" "p2: names first absent id"
assert_contains "$PARTIAL_ERR" "$INPUT_ORPHAN" "p2: names first absent sha"
assert_contains "$PARTIAL_ERR" "missing-lane" "p2: names second absent id in the same run"
assert_contains "$PARTIAL_ERR" "$INPUT_MISSING" "p2: names second absent sha in the same run"
assert_contains "$PARTIAL_ERR" "merge-base --is-ancestor" "p2: failure names the command"
assert_contains "$PARTIAL_ERR" "target=HEAD" "p2: failure names the target"
assert_not_contains "$PARTIAL_ERR" "lane-a" "p2: does not invent present ids as failures"
assert_eq "$(git -C "$INPUTS_REPO" for-each-ref --format='%(refname) %(objectname)')" \
  "$REFS_BEFORE" "inputs-landed does not write refs"
assert_eq "$(git -C "$INPUTS_REPO" rev-parse HEAD)" "$HEAD_BEFORE" \
  "inputs-landed does not check out"
assert_eq "$(git -C "$INPUTS_REPO" status --porcelain=v1 --untracked-files=all)" \
  "$STATUS_BEFORE" "inputs-landed leaves index and worktree unchanged"

echo 'not json' >"$TEST_TMP/inputs-garbage.json"
set +e
node "$REPO_ROOT/scripts/check-inputs-landed.js" \
  --inputs "$TEST_TMP/inputs-garbage.json" --target HEAD --repo "$INPUTS_REPO" \
  >"$TEST_TMP/inputs-garbage.out" 2>"$TEST_TMP/inputs-garbage.err"
GARBAGE_EXIT=$?
node "$REPO_ROOT/scripts/check-inputs-landed.js" \
  --inputs "$TEST_TMP/inputs-absent-file.json" --target HEAD --repo "$INPUTS_REPO" \
  >"$TEST_TMP/inputs-absent.out" 2>"$TEST_TMP/inputs-absent.err"
ABSENT_EXIT=$?
assert_neq "$GARBAGE_EXIT" "0" "unreadable inputs JSON is a refusal"
assert_contains "$(cat "$TEST_TMP/inputs-garbage.err")" "$TEST_TMP/inputs-garbage.json" \
  "parser refusal names the path"
assert_neq "$ABSENT_EXIT" "0" "missing inputs file is a refusal"
assert_contains "$(cat "$TEST_TMP/inputs-absent.err")" "$TEST_TMP/inputs-absent-file.json" \
  "missing inputs file names the path"
assert_eq "$(wc -c < "$TEST_TMP/inputs-garbage.out" | tr -d ' ')" "0" \
  "parser death is not a valid-empty pass on stdout"

# --- merge fixture: real no-ff merge, then record-integration ---
MERGE_REPO="$TEST_TMP/merge-repo"
git init -q -b target "$MERGE_REPO"
git -C "$MERGE_REPO" config user.name "Containment Fixture"
git -C "$MERGE_REPO" config user.email "containment@example.invalid"
printf 'base\n' >"$MERGE_REPO/base.txt"
git -C "$MERGE_REPO" add base.txt
git -C "$MERGE_REPO" commit -qm base
MERGE_BASE_SHA="$(git -C "$MERGE_REPO" rev-parse HEAD)"
git -C "$MERGE_REPO" switch -qc source
printf 'source\n' >"$MERGE_REPO/source.txt"
git -C "$MERGE_REPO" add source.txt
git -C "$MERGE_REPO" commit -qm source
MERGE_SOURCE_SHA="$(git -C "$MERGE_REPO" rev-parse HEAD)"
git -C "$MERGE_REPO" switch -q target
git -C "$MERGE_REPO" merge --no-ff -m merge source >/dev/null
MERGE_ACCEPTED_SHA="$(git -C "$MERGE_REPO" rev-parse HEAD)"
node "$REPO_ROOT/scripts/record-integration.js" \
  --repo "$MERGE_REPO" \
  --source-sha "$MERGE_SOURCE_SHA" \
  --accepted-sha "$MERGE_ACCEPTED_SHA" \
  --method merge \
  --unit-id merge-unit >"$TEST_TMP/merge-receipt.json"
assert_eq "$?" "0" "merge receipt writer exits 0"

set +e
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/merge-receipt.json" --target HEAD --repo "$MERGE_REPO" \
  >"$TEST_TMP/merge-ok.out" 2>"$TEST_TMP/merge-ok.err"
MERGE_OK=$?
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/merge-receipt.json" --target "$MERGE_BASE_SHA" --repo "$MERGE_REPO" \
  >"$TEST_TMP/merge-bad.out" 2>"$TEST_TMP/merge-bad.err"
MERGE_BAD=$?
assert_eq "$MERGE_OK" "0" "p3: merge with source ancestor of target exits 0"
assert_neq "$MERGE_BAD" "0" "p3: merge with source not ancestor exits non-zero"
assert_contains "$(cat "$TEST_TMP/merge-bad.err")" "$MERGE_SOURCE_SHA" \
  "merge failure names source sha"
assert_contains "$(cat "$TEST_TMP/merge-bad.err")" "merge-base --is-ancestor" \
  "merge failure names the command"
assert_contains "$(cat "$TEST_TMP/merge-bad.err")" "$MERGE_BASE_SHA" \
  "merge failure names the target"

# --- apply+fresh-commit fixture MUST be emitted by record-integration.js ---
APPLY_REPO="$TEST_TMP/apply-repo"
git init -q -b target "$APPLY_REPO"
git -C "$APPLY_REPO" config user.name "Containment Fixture"
git -C "$APPLY_REPO" config user.email "containment@example.invalid"
printf 'base\n' >"$APPLY_REPO/base.txt"
git -C "$APPLY_REPO" add base.txt
git -C "$APPLY_REPO" commit -qm base
APPLY_BASE_SHA="$(git -C "$APPLY_REPO" rev-parse HEAD)"
git -C "$APPLY_REPO" switch -qc source
printf 'applied content\n' >"$APPLY_REPO/applied.txt"
git -C "$APPLY_REPO" add applied.txt
git -C "$APPLY_REPO" commit -qm source
APPLY_SOURCE_SHA="$(git -C "$APPLY_REPO" rev-parse HEAD)"
git -C "$APPLY_REPO" switch -q target
git -C "$APPLY_REPO" diff --binary "$APPLY_BASE_SHA..$APPLY_SOURCE_SHA" \
  | git -C "$APPLY_REPO" apply --index
git -C "$APPLY_REPO" commit -qm "accepted
source_sha $APPLY_SOURCE_SHA"
APPLY_ACCEPTED_SHA="$(git -C "$APPLY_REPO" rev-parse HEAD)"

APPLY_REFS_BEFORE="$(git -C "$APPLY_REPO" for-each-ref --format='%(refname) %(objectname)')"
APPLY_HEAD_BEFORE="$(git -C "$APPLY_REPO" rev-parse HEAD)"
APPLY_STATUS_BEFORE="$(git -C "$APPLY_REPO" status --porcelain=v1 --untracked-files=all)"

node "$REPO_ROOT/scripts/record-integration.js" \
  --repo "$APPLY_REPO" \
  --source-sha "$APPLY_SOURCE_SHA" \
  --accepted-sha "$APPLY_ACCEPTED_SHA" \
  --method apply+fresh-commit \
  --unit-id apply-unit >"$TEST_TMP/apply-receipt.json"
assert_eq "$?" "0" "apply-style writer exits successfully"
assert_eq "$(node -p "require('$TEST_TMP/apply-receipt.json').edges[0].integration_method")" \
  "apply+fresh-commit" "apply receipt records method"

git -C "$APPLY_REPO" merge-base --is-ancestor "$APPLY_SOURCE_SHA" "$APPLY_ACCEPTED_SHA"
assert_neq "$?" "0" "apply-style source is not an ancestor of accepted"

set +e
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/apply-receipt.json" --target HEAD --repo "$APPLY_REPO" \
  >"$TEST_TMP/apply-ok.out" 2>"$TEST_TMP/apply-ok.err"
APPLY_OK=$?
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/apply-receipt.json" --target "$APPLY_BASE_SHA" --repo "$APPLY_REPO" \
  >"$TEST_TMP/apply-bad.out" 2>"$TEST_TMP/apply-bad.err"
APPLY_BAD=$?
assert_eq "$APPLY_OK" "0" \
  "p3: apply-style non-ancestor source with accepted ancestor and source sha in message exits 0"
assert_contains "$(cat "$TEST_TMP/apply-ok.out")" "SOURCE_BRANCH" \
  "apply-style reports source branch existence"
assert_contains "$(cat "$TEST_TMP/apply-ok.out")" "refs/heads/source exists" \
  "apply-style reports the live source ref without enforcing it"
assert_neq "$APPLY_BAD" "0" "p3: apply-style accepted not ancestor of target exits non-zero"
assert_contains "$(cat "$TEST_TMP/apply-bad.err")" "$APPLY_ACCEPTED_SHA" \
  "apply failure names accepted sha"
assert_contains "$(cat "$TEST_TMP/apply-bad.err")" "accepted_sha" \
  "apply failure says containment is on accepted_sha"
assert_contains "$(cat "$TEST_TMP/apply-ok.out")" "$APPLY_ACCEPTED_SHA" \
  "apply pass names accepted sha as the contained object"

# Unconditional ancestry on source would fail the apply-ok case; pin that the
# source probe is expected to fail and still pass the gate.
git -C "$APPLY_REPO" merge-base --is-ancestor "$APPLY_SOURCE_SHA" HEAD
assert_neq "$?" "0" "decisive case: source is not an ancestor of target HEAD"

assert_eq "$(git -C "$APPLY_REPO" for-each-ref --format='%(refname) %(objectname)')" \
  "$APPLY_REFS_BEFORE" "containment check does not write refs"
assert_eq "$(git -C "$APPLY_REPO" rev-parse HEAD)" "$APPLY_HEAD_BEFORE" \
  "containment check does not check out"
assert_eq "$(git -C "$APPLY_REPO" status --porcelain=v1 --untracked-files=all)" \
  "$APPLY_STATUS_BEFORE" "containment check leaves index and worktree unchanged"

# Report-only: deleting the source branch must not fail the gate.
git -C "$APPLY_REPO" branch -D source >/dev/null
set +e
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/apply-receipt.json" --target HEAD --repo "$APPLY_REPO" \
  >"$TEST_TMP/apply-deleted.out" 2>"$TEST_TMP/apply-deleted.err"
APPLY_DELETED=$?
assert_eq "$APPLY_DELETED" "0" "missing source branch is reported, not enforced"
assert_contains "$(cat "$TEST_TMP/apply-deleted.out")" "absent" \
  "apply-style reports absent source branch"

echo 'not json' >"$TEST_TMP/receipt-garbage.json"
set +e
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/receipt-garbage.json" --target HEAD --repo "$APPLY_REPO" \
  >"$TEST_TMP/receipt-garbage.out" 2>"$TEST_TMP/receipt-garbage.err"
RECEIPT_GARBAGE=$?
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/missing-receipt.json" --target HEAD --repo "$APPLY_REPO" \
  >"$TEST_TMP/receipt-missing.out" 2>"$TEST_TMP/receipt-missing.err"
RECEIPT_MISSING=$?
assert_neq "$RECEIPT_GARBAGE" "0" "unreadable receipt is a refusal"
assert_contains "$(cat "$TEST_TMP/receipt-garbage.err")" "$TEST_TMP/receipt-garbage.json" \
  "receipt parser refusal names the path"
assert_neq "$RECEIPT_MISSING" "0" "missing receipt is a refusal"
assert_contains "$(cat "$TEST_TMP/receipt-missing.err")" "$TEST_TMP/missing-receipt.json" \
  "missing receipt names the path"
assert_eq "$(wc -c < "$TEST_TMP/receipt-garbage.out" | tr -d ' ')" "0" \
  "receipt parser death is not a valid-empty pass on stdout"

# Copy-method with source still an ancestor of target is a method-selection miss.
node - "$TEST_TMP/merge-receipt.json" "$TEST_TMP/merge-as-apply.json" <<'NODE'
const fs = require('fs');
const [src, out] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(src, 'utf8'));
receipt.edges[0].integration_method = 'apply+fresh-commit';
fs.writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
NODE
set +e
node "$REPO_ROOT/scripts/check-containment.js" \
  --edge "$TEST_TMP/merge-as-apply.json" --target HEAD --repo "$MERGE_REPO" \
  >"$TEST_TMP/apply-on-merge.out" 2>"$TEST_TMP/apply-on-merge.err"
APPLY_ON_MERGE=$?
assert_neq "$APPLY_ON_MERGE" "0" \
  "p3: apply-style refuses when source IS an ancestor (unconditional ancestry is wrong)"
assert_contains "$(cat "$TEST_TMP/apply-on-merge.err")" "not the contained object" \
  "method-selected miss names that source is the wrong object"

finalize_test
