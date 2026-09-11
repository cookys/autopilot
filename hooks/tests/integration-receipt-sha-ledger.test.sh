#!/usr/bin/env bash
# Integration receipts distinguish the produced commit from the accepted commit.
. "$(dirname "$0")/lib.sh"

SCHEMA="$REPO_ROOT/schemas/merge-execution-receipt.schema.json"

# A real no-ff merge must record the source tip and the newly-created merge commit.
MERGE_REPO="$TEST_TMP/merge-repo"
MERGE_SOURCE_WT="$TEST_TMP/merge-source"
git init -q -b target "$MERGE_REPO"
git -C "$MERGE_REPO" config user.name "Receipt Fixture"
git -C "$MERGE_REPO" config user.email "receipt@example.invalid"
printf 'base\n' >"$MERGE_REPO/base.txt"
git -C "$MERGE_REPO" add base.txt
git -C "$MERGE_REPO" commit -qm base
git -C "$MERGE_REPO" branch source
git -C "$MERGE_REPO" worktree add -q "$MERGE_SOURCE_WT" source
printf 'source\n' >"$MERGE_SOURCE_WT/source.txt"
git -C "$MERGE_SOURCE_WT" add source.txt
git -C "$MERGE_SOURCE_WT" commit -qm source
MERGE_SOURCE_SHA="$(git -C "$MERGE_SOURCE_WT" rev-parse HEAD)"

node - "$REPO_ROOT" "$MERGE_REPO" "$MERGE_SOURCE_WT" "$TEST_TMP/merge-receipt.json" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [root, repo, sourceWorktree, output] = process.argv.slice(2);
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'receipt-ledger-live-merge',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'no-ff',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: [] },
});
const preflight = preflightMergeIntent(sealed);
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: [],
});
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
NODE
assert_eq "$?" "0" "real merge writer exits successfully"

MERGE_FACTS="$(node - "$TEST_TMP/merge-receipt.json" <<'NODE'
'use strict';
const receipt = require(process.argv[2]);
const edge = receipt.edges[0];
process.stdout.write([
  receipt.status,
  edge.source_sha,
  edge.accepted_sha,
  edge.integration_method,
  edge.unit_id,
].join('\t'));
NODE
)"
IFS=$'\t' read -r MERGE_STATUS RECEIPT_SOURCE_SHA RECEIPT_ACCEPTED_SHA \
  MERGE_METHOD MERGE_UNIT_ID <<<"$MERGE_FACTS"
assert_eq "$MERGE_STATUS" "complete" "real merge completes"
assert_eq "$RECEIPT_SOURCE_SHA" "$MERGE_SOURCE_SHA" "merge receipt records source tip"
assert_neq "$RECEIPT_SOURCE_SHA" "$RECEIPT_ACCEPTED_SHA" \
  "merge receipt records distinct source and accepted commits"
assert_eq "$RECEIPT_ACCEPTED_SHA" "$(git -C "$MERGE_REPO" rev-parse HEAD)" \
  "merge receipt records accepted merge commit"
assert_eq "$MERGE_METHOD" "merge" "no-ff outcome is merge"
assert_eq "$MERGE_UNIT_ID" "receipt-ledger-live-merge:edge-1" \
  "merge unit identity is stable and independent of ref names"
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$SCHEMA" \
  --document "$TEST_TMP/merge-receipt.json" >/dev/null
assert_eq "$?" "0" "real merge receipt validates against schema"

# A real apply + fresh commit has a source SHA outside the accepted commit's ancestry.
APPLY_REPO="$TEST_TMP/apply-repo"
git init -q -b target "$APPLY_REPO"
git -C "$APPLY_REPO" config user.name "Receipt Fixture"
git -C "$APPLY_REPO" config user.email "receipt@example.invalid"
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
git -C "$APPLY_REPO" commit -qm accepted
APPLY_ACCEPTED_SHA="$(git -C "$APPLY_REPO" rev-parse HEAD)"

REFS_BEFORE="$(git -C "$APPLY_REPO" for-each-ref --format='%(refname) %(objectname)')"
HEAD_BEFORE="$(git -C "$APPLY_REPO" rev-parse HEAD)"
STATUS_BEFORE="$(git -C "$APPLY_REPO" status --porcelain=v1 --untracked-files=all)"
node "$REPO_ROOT/scripts/record-integration.js" \
  --repo "$APPLY_REPO" \
  --source-sha "$APPLY_SOURCE_SHA" \
  --accepted-sha "$APPLY_ACCEPTED_SHA" \
  --method apply+fresh-commit \
  --unit-id apply-unit >"$TEST_TMP/apply-receipt.json"
assert_eq "$?" "0" "apply-style writer exits successfully"

node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$SCHEMA" \
  --document "$TEST_TMP/apply-receipt.json" >/dev/null
assert_eq "$?" "0" "real apply-style receipt validates against schema"
assert_eq "$(node -p "require('$TEST_TMP/apply-receipt.json').edges[0].integration_method")" \
  "apply+fresh-commit" "apply-style writer records method"
assert_eq "$(node -p "require('$TEST_TMP/apply-receipt.json').edges[0].source_sha")" \
  "$APPLY_SOURCE_SHA" "apply-style writer records source SHA"
assert_eq "$(node -p "require('$TEST_TMP/apply-receipt.json').edges[0].accepted_sha")" \
  "$APPLY_ACCEPTED_SHA" "apply-style writer records accepted SHA"
assert_eq "$(node -p "require('$TEST_TMP/apply-receipt.json').edges[0].unit_id")" \
  "apply-unit" "apply-style writer records caller-supplied unit identity"
git -C "$APPLY_REPO" merge-base --is-ancestor "$APPLY_SOURCE_SHA" "$APPLY_ACCEPTED_SHA"
assert_neq "$?" "0" "apply-style source is not an ancestor of accepted commit"
assert_eq "$(git -C "$APPLY_REPO" for-each-ref --format='%(refname) %(objectname)')" \
  "$REFS_BEFORE" "recorder does not write refs"
assert_eq "$(git -C "$APPLY_REPO" rev-parse HEAD)" "$HEAD_BEFORE" \
  "recorder does not check out or integrate"
assert_eq "$(git -C "$APPLY_REPO" status --porcelain=v1 --untracked-files=all)" \
  "$STATUS_BEFORE" "recorder leaves index and worktree unchanged"

# Negative fixtures are derived from the real writer output so only the attacked field varies.
node - "$TEST_TMP/apply-receipt.json" "$TEST_TMP/unknown-method.json" \
  "$TEST_TMP/missing-source.json" "$TEST_TMP/missing-accepted.json" <<'NODE'
'use strict';
const fs = require('fs');
const [source, unknownPath, missingSourcePath, missingAcceptedPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(source, 'utf8'));
receipt.edges[0].integration_method = 'hand-wave';
fs.writeFileSync(unknownPath, `${JSON.stringify(receipt)}\n`);
delete receipt.edges[0].source_sha;
receipt.edges[0].integration_method = 'apply+fresh-commit';
fs.writeFileSync(missingSourcePath, `${JSON.stringify(receipt)}\n`);
const missingAccepted = JSON.parse(fs.readFileSync(source, 'utf8'));
delete missingAccepted.edges[0].accepted_sha;
fs.writeFileSync(missingAcceptedPath, `${JSON.stringify(missingAccepted)}\n`);
NODE
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$SCHEMA" \
  --document "$TEST_TMP/unknown-method.json" >/dev/null 2>&1
assert_neq "$?" "0" "schema rejects unknown integration method"
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$SCHEMA" \
  --document "$TEST_TMP/missing-source.json" >/dev/null 2>&1
assert_neq "$?" "0" "schema rejects omitted source SHA"
node "$REPO_ROOT/scripts/validate-json-schema.js" --schema "$SCHEMA" \
  --document "$TEST_TMP/missing-accepted.json" >/dev/null 2>&1
assert_neq "$?" "0" "schema rejects omitted accepted SHA"

finalize_test
