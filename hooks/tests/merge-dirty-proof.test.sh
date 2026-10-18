#!/usr/bin/env bash
# RED at 5ae72fe12: positive has_dirty_proof false and status complete; mutate/old-version/missing-proof all status complete with halt_reason null (8 assertions failed, exit 1).
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
const receipt = executeMergeIntent({
  sealed_manifest: sealed,
  manifest_seal: sealed.seal,
  preflight,
  approved_preservation: [],
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

finalize_test
