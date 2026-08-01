#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ctrl = require(path.join(root, 'src/engine/controller-execution'));
const wo = require(path.join(root, 'src/engine/work-order'));
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-git-'));
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'e1@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'E1']);
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'product.js'), 'base\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(repo, 'src', 'product.js'), 'candidate\n');
execFileSync('git', ['-C', repo, 'commit', '-qam', 'candidate']);
const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const rootId = 'mission-e1-fixture';
const workOrderId = `wo-${rootId}-node-a1`;
const record = {
  schema_version: 1,
  root_run_id: rootId,
  work_order_id: workOrderId,
  accepted_commit: commit,
  dispatch_depth: 2,
  changed_paths: ['src/product.js'],
};
const common = wo.resolveGitCommonDir(repo);
const manifestPath = path.join(common, 'e1-manifest.json');
const persist = (nextRecord) => {
  const controller = ctrl.emptyControllerState({
    frozen_denominator: ctrl.buildFrozenDenominator({ projectId: rootId, graphDigest: 'b'.repeat(64), deliverableIds: ['node'], nodeId: 'node' }),
    dispatch_records: [nextRecord],
  });
  fs.writeFileSync(manifestPath, JSON.stringify({ root_run_id: rootId, work_order_id: workOrderId, controller_digest: controller.controller_digest, entries: [nextRecord] }));
  const workOrder = wo.buildWorkOrder({ root_run_id: rootId, work_order_id: workOrderId, graph_node: 'node', role: 'controller', next_action: 'merge', branch: 'feat/e1', base_sha: baseSha, controller, paths: { manifest: manifestPath } }, { bindArtifacts: true });
  const workOrderFile = wo.workOrderPath(common, rootId, 'node', 1);
  fs.mkdirSync(path.dirname(workOrderFile), { recursive: true });
  wo.writeAtomicJson(workOrderFile, workOrder);
};
const request = { repoRoot: repo, rootRunId: rootId, workOrderId, baseSha, headSha: commit, productPathPrefixes: ['src'] };
persist(record);
assert.strictEqual(ctrl.validateDispatchMergeProvenance(request).ok, true);
assert.strictEqual(ctrl.validateDispatchMergeProvenance({ ...request, commits: [], manifests: [] }).ok, true);
persist({ ...record, dispatch_depth: 0 });
assert.ok(ctrl.validateDispatchMergeProvenance(request).problems.some((item) => item.code === 'PROVENANCE_DEPTH0_PRODUCT_EDIT'));
persist({ ...record, changed_paths: [] });
assert.ok(ctrl.validateDispatchMergeProvenance(request).problems.some((item) => item.code === 'PROVENANCE_PATH_UNBOUND'));
console.log('PASS [backlog-convergence-e1] 4 assertions');

const qp = require(path.join(root, 'src/readiness/qualification-provider'));
const now = '2026-08-02T00:00:00.000Z';
const allowedRoles = new Set(['implementer', 'verification_author', 'qc']);
const provider = qp.createQualificationProvider({ qualify: (tuple) => allowedRoles.has(tuple.role) });
for (const role of allowedRoles) {
  const tuple = { role, runner: 'codex', model: 'gpt-5.6-sol', effort: 'high', endpoint: null };
  const receipt = qp.issueExactRoleQualification(provider, { tuple, now });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(receipt)), {});
  assert.strictEqual(qp.consumeExactRoleQualification(provider, receipt, { tuple, now }).status, 'ready');
  assert.throws(() => qp.consumeExactRoleQualification(provider, receipt, { tuple, now }), /replayed/);
}
const wrongTuple = { role: 'reviewer', runner: 'codex', model: 'gpt-5.6-sol', effort: 'high', endpoint: null };
assert.strictEqual(qp.issueExactRoleQualification(provider, { tuple: wrongTuple, now }), null);
console.log('PASS [backlog-convergence-qualification] 10 assertions');
NODE

# Production authority selection is not a test seam.
set +e
AUTH_OUT="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$REPO_ROOT" --level l3 --authority-store "$TEST_TMP/common" 2>&1)"
AUTH_RC=$?
set -e
assert_eq "2" "$AUTH_RC" "caller-selected authority store is rejected"
assert_contains "$AUTH_OUT" "invalid argument" "authority override rejection is explicit"

GRAPH_DIGEST="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" --repo-root "$REPO_ROOT" --level l3 | jq -r '.admission.mission_graph_digest')"
RECONCILE_OUT="$(node "$REPO_ROOT/scripts/mission-terminal-reconcile.js" --repo-root "$REPO_ROOT" --graph-digest "$GRAPH_DIGEST")"
assert_eq "2" "$(jq '.dispositions | length' <<<"$RECONCILE_OUT")" "exact B/C terminal pair is dispositioned"
assert_eq "0" "$(jq '.writes' <<<"$RECONCILE_OUT")" "durable B/C reconciliation replay is idempotent"
assert_eq "0:0:false" "$(jq -r '[.synthesized_work_orders,.mutated_receipts,.history_rewritten] | join(":")' <<<"$RECONCILE_OUT")" \
  "reconciliation synthesizes no authority and rewrites no history"

finalize_test
