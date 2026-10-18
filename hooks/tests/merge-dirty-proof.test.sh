#!/usr/bin/env bash
# RED at 5ae72fe12: positive has_dirty_proof false and status complete; mutate/old-version/missing-proof all status complete with halt_reason null (8 assertions failed, exit 1).
# RED at 604b8d758: schema validate throws unsupported keyword "description" (schema_valid true absent); block-directory stays safe with has_blocker false; block-unmerged stays ambiguous with has_blocker false; block-submodule blocked without dirty_proof_failed.
# Preserved dirty content must be proven between preflight and execution.
. "$(dirname "$0")/lib.sh"

make_repo() {
  local name="$1"
  local sbx="$TEST_TMP/$name"
  git init -q -b target "$sbx"
  git -C "$sbx" config user.name "Dirty Proof Fixture"
  git -C "$sbx" config user.email "dirty-proof@example.invalid"
  mkdir -p "$sbx/consumer"
  printf 'base\n' >"$sbx/consumer/keep.txt"
  printf 'base\n' >"$sbx/other.txt"
  git -C "$sbx" add .
  git -C "$sbx" commit -qm base
  git -C "$sbx" branch source
  local source_wt="$TEST_TMP/${name}-source"
  git -C "$sbx" worktree add -q "$source_wt" source
  printf 'incoming\n' >"$source_wt/incoming.txt"
  git -C "$source_wt" add incoming.txt
  git -C "$source_wt" commit -qm incoming
  printf 'preserved\n' >"$sbx/consumer/keep.txt"
  printf '%s\n' "$sbx"
}

run_case() {
  local mode="$1"
  local sbx source_wt
  sbx="$(make_repo "$mode")"
  source_wt="$TEST_TMP/${mode}-source"
  node - "$REPO_ROOT" "$sbx" "$source_wt" "$mode" <<'NODE'
'use strict';
function main() {
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const repo = process.argv[3];
const sourceWorktree = process.argv[4];
const mode = process.argv[5];
const { canonicalDigest } = require(path.join(root, 'src/engine/implementation-campaign'));
const { buildMergeIntent, preflightMergeIntent } = require(path.join(root, 'src/status/merge-intent'));
const { executeMergeIntent } = require(path.join(root, 'src/merge/cli'));

const sealed = buildMergeIntent({
  repo,
  root_run_id: 'bl0076-dirty-proof',
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
if (mode === 'mutate') {
  fs.writeFileSync(path.join(repo, 'consumer/keep.txt'), 'changed-after-preflight\n');
}
if (mode === 'old-version') {
  const { receipt_digest: _ignored, ...body } = preflight;
  body.schema_version = 1;
  preflight.schema_version = 1;
  preflight.receipt_digest = canonicalDigest(body);
}
if (mode === 'missing-proof') {
  const { receipt_digest: _ignored, ...body } = preflight;
  body.edges = body.edges.map((edge) => {
    const copy = { ...edge };
    delete copy.dirty_proof;
    return copy;
  });
  preflight.edges = body.edges;
  preflight.receipt_digest = canonicalDigest(body);
}
if (mode === 'schema') {
  const { validateJsonSchema } = require(path.join(root, 'scripts/validate-json-schema.js'));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/merge-intent.schema.json'), 'utf8'));
  const produced = validateJsonSchema(schema, preflight);
  const stripped = JSON.parse(JSON.stringify(preflight));
  delete stripped.edges[0].dirty_proof;
  const { receipt_digest: _ignoredDigest, ...strippedBody } = stripped;
  stripped.receipt_digest = canonicalDigest(strippedBody);
  const branch = schema.$defs && schema.$defs.preflightReceipt
    ? {
      $schema: schema.$schema,
      $id: schema.$id,
      $defs: schema.$defs,
      ...schema.$defs.preflightReceipt,
    }
    : schema;
  const missing = validateJsonSchema(branch, stripped);
  const detail = (missing.errors || []).join(' ');
  console.log(JSON.stringify({
    mode,
    schema_valid: produced.valid === true,
    schema_missing_proof_valid: missing.valid === true,
    schema_errors: detail,
  }));
  return;
}
if (mode.startsWith('block-')) {
  const kind = mode.slice('block-'.length);
  const target = path.join(repo, 'consumer/keep.txt');
  if (kind === 'directory') {
    fs.rmSync(target);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'inside.txt'), 'dir\n');
  } else if (kind === 'submodule') {
    const sub = fs.mkdtempSync(path.join(require('os').tmpdir(), 'dirty-proof-sub-'));
    fs.mkdirSync(sub, { recursive: true });
    const { execFileSync } = require('child_process');
    const gsub = (...args) => execFileSync('git', ['-C', sub, ...args], { encoding: 'utf8' });
    gsub('init', '-q');
    gsub('config', 'user.email', 'sub@example.invalid');
    gsub('config', 'user.name', 'Sub');
    fs.writeFileSync(path.join(sub, 'a.txt'), 'a\n');
    gsub('add', 'a.txt');
    gsub('commit', '-qm', 'sub');
    const oid = gsub('rev-parse', 'HEAD').trim();
    const { execFileSync: run } = require('child_process');
    run('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', `160000,${oid},consumer/keep.txt`], { encoding: 'utf8' });
  } else if (kind === 'unmerged') {
    const { execFileSync } = require('child_process');
    const oid = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD:consumer/keep.txt'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repo, 'update-index', '--force-remove', '--', 'consumer/keep.txt'], { encoding: 'utf8' });
    const info = [1, 2, 3].map((stage) => `100644 ${oid} ${stage}\tconsumer/keep.txt`).join('\n') + '\n';
    execFileSync('git', ['-C', repo, 'update-index', '--index-info'], { input: info, encoding: 'utf8' });
  }
  const blocked = preflightMergeIntent(sealed);
  const edge = blocked.edges[0] || {};
  const reason = String(edge.reason || '');
  const blockerHit = Array.isArray(blocked.blockers)
    && blocked.blockers.some((item) => String(item.reason || '').includes('dirty_proof_failed'));
  console.log(JSON.stringify({
    mode,
    preflight_status: blocked.status,
    edge_status: edge.status || null,
    reason,
    has_blocker: blockerHit,
  }));
  return;
}
let approved = [];
if (mode === 'preserve') {
  const { execFileSync } = require('child_process');
  execFileSync('git', ['-C', repo, 'add', '--', 'consumer/keep.txt'], { encoding: 'utf8' });
  fs.writeFileSync(path.join(sourceWorktree, 'consumer/keep.txt'), 'incoming-keep\n');
  execFileSync('git', ['-C', sourceWorktree, 'add', 'consumer/keep.txt'], { encoding: 'utf8' });
  execFileSync('git', ['-C', sourceWorktree, 'commit', '-qm', 'overlap-keep'], { encoding: 'utf8' });
  const overlapped = buildMergeIntent({
    repo,
    root_run_id: 'bl0076-dirty-proof',
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
  const overlapPreflight = preflightMergeIntent(overlapped);
  approved = (overlapPreflight.edges || [])
    .filter((edge) => Array.isArray(edge.preservation_proposal) && edge.preservation_proposal.length > 0)
    .map((edge) => ({ edge_sequence: edge.sequence, paths: edge.preservation_proposal }));
  const receipt = executeMergeIntent({
    sealed_manifest: overlapped,
    manifest_seal: overlapped.seal,
    preflight: overlapPreflight,
    approved_preservation: approved,
  });
  const preservation = receipt.edges && receipt.edges[0] && receipt.edges[0].preservation;
  console.log(JSON.stringify({
    mode,
    preflight_status: overlapPreflight.status,
    proposal: overlapPreflight.edges[0] && overlapPreflight.edges[0].preservation_proposal,
    status: receipt.status,
    halt_reason: receipt.halt_reason,
    preservation_action: preservation && preservation.action,
    preservation_restored: preservation && preservation.restored,
    preservation_verification: preservation && preservation.verification,
    restored_bytes: fs.readFileSync(path.join(repo, 'consumer/keep.txt'), 'utf8'),
  }));
  return;
}
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: approved,
});
const proof = preflight.edges[0] && preflight.edges[0].dirty_proof;
console.log(JSON.stringify({
  mode,
  preflight_status: preflight.status,
  has_dirty_proof: Array.isArray(proof),
  status: receipt.status,
  halt_reason: receipt.halt_reason,
  halt_edge: receipt.halt_edge,
}));
}
main();
NODE
}

POS="$(run_case positive)"
printf '%s\n' "$POS"
assert_contains "$POS" '"status":"complete"' "unchanged preserved content still executes"
assert_contains "$POS" '"has_dirty_proof":true' "preflight edge stores dirty_proof"

NEG="$(run_case mutate)"
printf '%s\n' "$NEG"
assert_contains "$NEG" '"status":"halted"' "changed preserved bytes halt"
assert_contains "$NEG" '"halt_reason":"dirty_content_or_index_drift"' \
  "content drift uses dirty_content_or_index_drift"
assert_contains "$NEG" '"halt_edge":1' "content drift names the edge sequence"

OLD="$(run_case old-version)"
printf '%s\n' "$OLD"
assert_contains "$OLD" '"status":"halted"' "old preflight schema version is rejected"
assert_contains "$OLD" 'preflight_schema_version_unsupported' \
  "old preflight schema version has a clear halt reason"

MISS="$(run_case missing-proof)"
printf '%s\n' "$MISS"
assert_contains "$MISS" '"status":"halted"' "preflight without dirty_proof is rejected"
assert_contains "$MISS" 'preflight_dirty_proof_missing' \
  "missing dirty_proof has a clear halt reason"

# Schema: a produced v2 preflight must validate; stripping dirty_proof must not.
SCHEMA_OUT="$(run_case schema)"
printf '%s\n' "$SCHEMA_OUT"
assert_contains "$SCHEMA_OUT" '"schema_valid":true' \
  "produced v2 preflight matches merge-intent schema"
assert_contains "$SCHEMA_OUT" '"schema_missing_proof_valid":false' \
  "preflight edge without dirty_proof fails the schema"
assert_contains "$SCHEMA_OUT" 'dirty_proof' \
  "schema rejection names dirty_proof"

# Proof failures must block the edge instead of dropping dirty_proof.
for kind in directory submodule unmerged; do
  BLOCK="$(run_case "block-$kind")"
  printf '%s\n' "$BLOCK"
  assert_contains "$BLOCK" '"preflight_status":"blocked"' \
    "$kind dirty path blocks the preflight"
  assert_contains "$BLOCK" '"edge_status":"blocked"' \
    "$kind dirty path blocks the edge"
  assert_contains "$BLOCK" 'dirty_proof_failed' \
    "$kind dirty path records a proof failure reason"
  assert_contains "$BLOCK" '"has_blocker":true' \
    "$kind dirty path records a blocker"
done

PRESERVE="$(run_case preserve)"
printf '%s\n' "$PRESERVE"
assert_contains "$PRESERVE" '"status":"complete"' \
  "approved preservation still executes"
assert_contains "$PRESERVE" '"preservation_action":"path_snapshot_restore"' \
  "approved preservation restores the snapshot"
assert_contains "$PRESERVE" '"preservation_restored":true' \
  "approved preservation reports restored"
assert_contains "$PRESERVE" '"preservation_verification":"exact"' \
  "approved preservation verifies the restored snapshot"
assert_contains "$PRESERVE" '"restored_bytes":"preserved' \
  "approved preservation puts the preflight bytes back"

finalize_test
