#!/usr/bin/env bash
# LSM P3 — sealed, ordered merge execution with exact dirty-state restoration.
. "$(dirname "$0")/lib.sh"

SBX="$TEST_TMP/repo"
git init -q -b peo "$SBX"
git -C "$SBX" config user.name "LSM P3 Fixture"
git -C "$SBX" config user.email "lsm-p3@example.invalid"
mkdir -p "$SBX/consumer"
printf 'base\n' >"$SBX/shared.txt"
printf 'base script\n' >"$SBX/consumer/script.sh"
printf 'base local\n' >"$SBX/consumer/local.txt"
printf 'base tool\n' >"$SBX/consumer/tool.sh"
git -C "$SBX" add .
git -C "$SBX" commit -qm base

git -C "$SBX" branch develop
git -C "$SBX" branch safety
SAFETY_WT="$TEST_TMP/safety"
DEVELOP_WT="$TEST_TMP/develop"
git -C "$SBX" worktree add -q "$SAFETY_WT" safety
git -C "$SBX" worktree add -q "$DEVELOP_WT" develop

printf 'safety\n' >"$SAFETY_WT/safety.txt"
git -C "$SAFETY_WT" add safety.txt
git -C "$SAFETY_WT" commit -qm safety
printf 'develop\n' >"$DEVELOP_WT/develop.txt"
printf 'incoming script\n' >"$DEVELOP_WT/consumer/script.sh"
git -C "$DEVELOP_WT" add .
git -C "$DEVELOP_WT" commit -qm develop

printf 'local staged script\n' >"$SBX/consumer/script.sh"
git -C "$SBX" add consumer/script.sh
printf 'local unstaged\n' >"$SBX/consumer/local.txt"
printf 'local untracked\n' >"$SBX/consumer/new.txt"
printf 'local executable tool\n' >"$SBX/consumer/tool.sh"
chmod 755 "$SBX/consumer/tool.sh"

PEO_BEFORE="$(git -C "$SBX" rev-parse refs/heads/peo)"
SAFETY_BEFORE="$(git -C "$SBX" rev-parse refs/heads/safety)"
STASH_BEFORE="$(git -C "$SBX" stash list)"
REFS_BEFORE="$(git -C "$SBX" for-each-ref --format='%(refname)')"

OUT="$(RECEIPT_PATH="$TEST_TMP/execution-receipt.json" \
  node - "$REPO_ROOT" "$SBX" "$SAFETY_WT" "$DEVELOP_WT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const safetyWorktree = process.argv[4];
const developWorktree = process.argv[5];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent, verifyMergeExecutionReceipt } =
  require(path.join(root, 'src/merge/cli'));

const input = {
  repo,
  root_run_id: 'lsm-p3-twgame',
  edges: [
    {
      source_ref: 'refs/heads/safety',
      source_worktree: safetyWorktree,
      target_ref: 'refs/heads/develop',
      target_worktree: developWorktree,
      mode: 'no-ff',
      required_result: 'source-contained',
    },
    {
      source_ref: 'refs/heads/develop',
      source_worktree: developWorktree,
      target_ref: 'refs/heads/peo',
      target_worktree: repo,
      mode: 'ff-only',
      required_result: 'source-contained',
    },
  ],
  forbidden_reverse_edges: [
    { source_ref: 'refs/heads/develop', target_ref: 'refs/heads/safety' },
    { source_ref: 'refs/heads/peo', target_ref: 'refs/heads/develop' },
  ],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
};

const sealed = buildMergeIntent(input);
const preflight = preflightMergeIntent(sealed);
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: [
    { edge_sequence: 2, paths: ['consumer/script.sh'] },
  ],
});
fs.writeFileSync(process.env.RECEIPT_PATH, `${JSON.stringify(receipt)}\n`);

const checks = [];
function check(id, pass, detail = '') {
  checks.push({ id, pass: pass === true, detail });
}
check('preflight_overlap', preflight.status === 'overlapping'
  && preflight.edges[1].preservation_proposal.join(',') === 'consumer/script.sh',
JSON.stringify(preflight));
check('receipt_valid', verifyMergeExecutionReceipt(receipt));
check('ordered_execution', receipt.status === 'complete'
  && receipt.edges.length === 2
  && receipt.edges.every((edge) => edge.status === 'executed'));
check('predecessor_binding', receipt.edges[1].source_validation.from_edge === 1
  && receipt.edges[1].source_validation.expected_sha === receipt.edges[0].after_sha);
check('no_ff_receipt', receipt.edges[0].mode === 'no-ff'
  && receipt.edges[0].merge_commit === receipt.edges[0].after_sha
  && receipt.edges[0].before_sha !== receipt.edges[0].after_sha);
check('ff_only_receipt', receipt.edges[1].mode === 'ff-only'
  && receipt.edges[1].merge_commit === null
  && receipt.edges[1].after_sha === receipt.edges[0].after_sha);
check('preservation_receipt', receipt.edges[1].preservation.action === 'path_snapshot_restore'
  && receipt.edges[1].preservation.restored === true
  && receipt.edges[1].preservation.verification === 'exact');
check('no_conflicts', receipt.edges.every((edge) => edge.conflicts.length === 0));

for (const item of checks) {
  console.log(`${item.id}\t${item.pass ? 'PASS' : 'FAIL'}\t${item.detail}`);
}
process.exit(checks.every((item) => item.pass) ? 0 : 1);
NODE
)"
EXIT=$?
printf '%s\n' "$OUT"

assert_eq "$EXIT" "0" "merge execution oracle exits successfully"
for id in preflight_overlap receipt_valid ordered_execution predecessor_binding no_ff_receipt \
  ff_only_receipt preservation_receipt no_conflicts; do
  assert_contains "$OUT" "$id	PASS" "$id"
done
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/merge-execution-receipt.schema.json" \
  --document "$TEST_TMP/execution-receipt.json"
assert_eq "$?" "0" "execution receipt validates against its canonical schema"

assert_eq "$(git -C "$SBX" show :consumer/script.sh)" "local staged script" \
  "approved overlapping staged content is restored exactly"
assert_eq "$(git -C "$SBX" show HEAD:consumer/script.sh)" "incoming script" \
  "merged HEAD retains incoming content beneath the restored local change"
assert_eq "$(cat "$SBX/consumer/local.txt")" "local unstaged" \
  "unrelated unstaged content is untouched"
assert_eq "$(cat "$SBX/consumer/new.txt")" "local untracked" \
  "unrelated untracked content is untouched"
assert_eq "$(cat "$SBX/consumer/tool.sh")" "local executable tool" \
  "dirty executable content is restored exactly"
assert_eq "$(stat -c '%a' "$SBX/consumer/tool.sh")" "755" \
  "dirty executable mode is restored exactly"
STATUS="$(git -C "$SBX" status --porcelain=v1 --untracked-files=all)"
assert_contains "$STATUS" "M  consumer/script.sh" "staged state restored"
assert_contains "$STATUS" " M consumer/local.txt" "unstaged state preserved"
assert_contains "$STATUS" "?? consumer/new.txt" "untracked state preserved"
assert_contains "$STATUS" " M consumer/tool.sh" "executable mode/content state preserved"
assert_eq "$(git -C "$SBX" stash list)" "$STASH_BEFORE" "no stash is created or dropped"
assert_eq "$(git -C "$SBX" for-each-ref --format='%(refname)')" "$REFS_BEFORE" \
  "no branch is created or deleted"
assert_eq "$(git -C "$SBX" rev-parse refs/heads/safety)" "$SAFETY_BEFORE" \
  "source branch is not mutated"
assert_neq "$(git -C "$SBX" rev-parse refs/heads/peo)" "$PEO_BEFORE" \
  "declared target branch advances"

# A direct-endpoint drift must halt before any target mutation.
DRIFT="$TEST_TMP/drift"
git init -q -b target "$DRIFT"
git -C "$DRIFT" config user.name "LSM P3 Drift"
git -C "$DRIFT" config user.email "lsm-p3-drift@example.invalid"
printf 'base\n' >"$DRIFT/base.txt"
git -C "$DRIFT" add .
git -C "$DRIFT" commit -qm base
git -C "$DRIFT" branch source
SOURCE_WT="$TEST_TMP/drift-source"
git -C "$DRIFT" worktree add -q "$SOURCE_WT" source
printf 'one\n' >"$SOURCE_WT/one.txt"
git -C "$SOURCE_WT" add .
git -C "$SOURCE_WT" commit -qm one
DRIFT_TARGET_BEFORE="$(git -C "$DRIFT" rev-parse refs/heads/target)"

DRIFT_OUT="$(node - "$REPO_ROOT" "$DRIFT" "$SOURCE_WT" <<'NODE'
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'lsm-p3-drift',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'ff-only',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [
    { source_ref: 'refs/heads/target', target_ref: 'refs/heads/source' },
  ],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const preflight = preflightMergeIntent(sealed);
spawnSync('sh', ['-c',
  'printf two > two.txt && git add two.txt && git commit -qm two'],
{ cwd: sourceWorktree });
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: [],
});
console.log(JSON.stringify(receipt));
NODE
)"
assert_contains "$DRIFT_OUT" '"status":"halted"' "drift returns halted receipt"
assert_contains "$DRIFT_OUT" '"halt_reason":"initial_source_sha_drift"' \
  "drift reason is explicit"
assert_eq "$(git -C "$DRIFT" rev-parse refs/heads/target)" "$DRIFT_TARGET_BEFORE" \
  "drift halts before target mutation"

# The caller-supplied seal is an independent exact-match gate.
BAD_SEAL_OUT="$(node - "$REPO_ROOT" "$DRIFT" "$SOURCE_WT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'lsm-p3-bad-seal',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'ff-only',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const preflight = preflightMergeIntent(sealed);
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: '0'.repeat(64),
  preflight,
  approved_preservation: [],
});
console.log(JSON.stringify(receipt));
NODE
)"
assert_contains "$BAD_SEAL_OUT" '"halt_reason":"manifest_seal_mismatch"' \
  "wrong caller seal is rejected"

# A merge conflict is aborted, the target ref is rolled back, and a partial
# receipt retains the conflict path instead of claiming execution.
CONFLICT="$TEST_TMP/conflict"
git init -q -b target "$CONFLICT"
git -C "$CONFLICT" config user.name "LSM P3 Conflict"
git -C "$CONFLICT" config user.email "lsm-p3-conflict@example.invalid"
printf 'base\n' >"$CONFLICT/shared.txt"
git -C "$CONFLICT" add .
git -C "$CONFLICT" commit -qm base
git -C "$CONFLICT" branch source
CONFLICT_SOURCE="$TEST_TMP/conflict-source"
git -C "$CONFLICT" worktree add -q "$CONFLICT_SOURCE" source
printf 'target\n' >"$CONFLICT/shared.txt"
git -C "$CONFLICT" commit -qam target
printf 'source\n' >"$CONFLICT_SOURCE/shared.txt"
git -C "$CONFLICT_SOURCE" commit -qam source
CONFLICT_BEFORE="$(git -C "$CONFLICT" rev-parse refs/heads/target)"
CONFLICT_OUT="$(node - "$REPO_ROOT" "$CONFLICT" "$CONFLICT_SOURCE" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'lsm-p3-conflict',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'no-ff',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight: preflightMergeIntent(sealed),
  approved_preservation: [],
});
console.log(JSON.stringify(receipt));
NODE
)"
assert_contains "$CONFLICT_OUT" '"halt_reason":"merge_failed"' \
  "conflict returns a halted partial receipt"
assert_contains "$CONFLICT_OUT" '"conflicts":["shared.txt"]' \
  "conflict path is recorded"
assert_contains "$CONFLICT_OUT" '"halt_reason":"merge_failed"' \
  "fully rolled-back conflict does not require recovery"
assert_eq "$(git -C "$CONFLICT" rev-parse refs/heads/target)" "$CONFLICT_BEFORE" \
  "owned conflicting merge is aborted back to the prior target"
assert_file_absent "$CONFLICT/.git/MERGE_HEAD" "merge operation is not left active"

# Ignored incoming collisions are invisible to ordinary dirty inventory, so
# execution probes them explicitly and halts before Git can overwrite them.
IGNORED="$TEST_TMP/ignored"
git init -q -b target "$IGNORED"
git -C "$IGNORED" config user.name "LSM P3 Ignored"
git -C "$IGNORED" config user.email "lsm-p3-ignored@example.invalid"
printf 'generated.txt\n' >"$IGNORED/.gitignore"
printf 'base\n' >"$IGNORED/base.txt"
git -C "$IGNORED" add .
git -C "$IGNORED" commit -qm base
git -C "$IGNORED" branch source
IGNORED_SOURCE="$TEST_TMP/ignored-source"
git -C "$IGNORED" worktree add -q "$IGNORED_SOURCE" source
git -C "$IGNORED_SOURCE" rm -q .gitignore
printf 'incoming\n' >"$IGNORED_SOURCE/generated.txt"
git -C "$IGNORED_SOURCE" add .
git -C "$IGNORED_SOURCE" commit -qm incoming
printf 'ignored local\n' >"$IGNORED/generated.txt"
IGNORED_BEFORE="$(git -C "$IGNORED" rev-parse refs/heads/target)"
IGNORED_OUT="$(node - "$REPO_ROOT" "$IGNORED" "$IGNORED_SOURCE" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'lsm-p3-ignored',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'ff-only',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['generated/'] },
});
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight: preflightMergeIntent(sealed),
  approved_preservation: [],
});
console.log(JSON.stringify(receipt));
NODE
)"
assert_contains "$IGNORED_OUT" '"halt_reason":"ignored_or_path_prefix_collision"' \
  "ignored collision is detected explicitly"
assert_eq "$(git -C "$IGNORED" rev-parse refs/heads/target)" "$IGNORED_BEFORE" \
  "ignored collision halts before target mutation"
assert_eq "$(cat "$IGNORED/generated.txt")" "ignored local" \
  "ignored local content is untouched"

# Replacing a sealed worktree path with another repository at the same ref/SHA
# must fail repository identity, even though ordinary ref/head checks pass.
BINDING="$TEST_TMP/binding"
git init -q -b target "$BINDING"
git -C "$BINDING" config user.name "LSM P3 Binding"
git -C "$BINDING" config user.email "lsm-p3-binding@example.invalid"
printf 'base\n' >"$BINDING/base.txt"
git -C "$BINDING" add .
git -C "$BINDING" commit -qm base
git -C "$BINDING" branch source
BINDING_SOURCE="$TEST_TMP/binding-source"
git -C "$BINDING" worktree add -q "$BINDING_SOURCE" source
printf 'source\n' >"$BINDING_SOURCE/source.txt"
git -C "$BINDING_SOURCE" add .
git -C "$BINDING_SOURCE" commit -qm source
BINDING_TARGET_BEFORE="$(git -C "$BINDING" rev-parse refs/heads/target)"
BINDING_REQUEST="$TEST_TMP/binding-request.json"
node - "$REPO_ROOT" "$BINDING" "$BINDING_SOURCE" "$BINDING_REQUEST" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const output = process.argv[5];
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const sealed = buildMergeIntent({
  repo,
  root_run_id: 'lsm-p3-binding',
  edges: [{
    source_ref: 'refs/heads/source',
    source_worktree: sourceWorktree,
    target_ref: 'refs/heads/target',
    target_worktree: repo,
    mode: 'ff-only',
    required_result: 'source-contained',
  }],
  forbidden_reverse_edges: [],
  preservation_policy: { allowed_path_prefixes: ['consumer/'] },
});
fs.writeFileSync(output, JSON.stringify({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight: preflightMergeIntent(sealed),
  approved_preservation: [],
}));
NODE
BINDING_REPLACEMENT="$TEST_TMP/binding-replacement"
git clone -q "$BINDING" "$BINDING_REPLACEMENT"
git -C "$BINDING_REPLACEMENT" checkout -q source
mv "$BINDING_SOURCE" "$BINDING_SOURCE.original"
ln -s "$BINDING_REPLACEMENT" "$BINDING_SOURCE"
BINDING_OUT="$(node - "$REPO_ROOT" "$BINDING_REQUEST" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const request = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));
console.log(JSON.stringify(executeMergeIntent(request)));
NODE
)"
assert_contains "$BINDING_OUT" '"halt_reason":"initial_source_worktree_repo_binding_drift"' \
  "repointed source worktree path is rejected despite matching ref and SHA"
assert_eq "$(git -C "$BINDING" rev-parse refs/heads/target)" "$BINDING_TARGET_BEFORE" \
  "worktree repository binding drift halts before target mutation"

finalize_test
