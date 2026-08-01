#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const ctrl = require(path.join(root, 'src/engine/controller-execution'));
const wo = require(path.join(root, 'src/engine/work-order'));
const commit = 'a'.repeat(40);
const rootId = 'mission-e1-fixture';
const workOrderId = `wo-${rootId}-node-a1`;
const manifest = {
  schema_version: 1,
  root_run_id: rootId,
  work_order_id: workOrderId,
  accepted_commit: commit,
  changed_paths: ['src/engine/controller-execution.js'],
};
const controller = ctrl.emptyControllerState({
  frozen_denominator: ctrl.buildFrozenDenominator({
    projectId: rootId,
    graphDigest: 'b'.repeat(64),
    deliverableIds: ['node'],
    nodeId: 'node',
  }),
  dispatch_records: [manifest],
});
const workOrder = wo.buildWorkOrder({
  root_run_id: rootId,
  work_order_id: workOrderId,
  graph_node: 'node',
  role: 'controller',
  next_action: 'merge',
  branch: 'feat/e1',
  base_sha: 'c'.repeat(40),
  controller,
});
const base = {
  workOrder,
  manifests: [manifest],
  productPathPrefixes: ['src'],
  commits: [{ commit_sha: commit, dispatch_depth: 2,
    changed_paths: ['src/engine/controller-execution.js'] }],
};
assert.strictEqual(ctrl.validateDispatchMergeProvenance(base).ok, true);
assert.strictEqual(ctrl.validateDispatchMergeProvenance({ ...base, manifests: [] }).ok, false);
assert.strictEqual(ctrl.validateDispatchMergeProvenance({
  ...base,
  commits: [{ ...base.commits[0], dispatch_depth: 0 }],
}).problems[0].code, 'PROVENANCE_DEPTH0_PRODUCT_EDIT');
assert.strictEqual(ctrl.validateDispatchMergeProvenance({
  ...base,
  manifests: [{ ...manifest, changed_paths: ['src/other.js'] }],
}).ok, false);
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

# An explicitly injected empty authority store must not inherit this checkout's
# production Mission registry or Work Orders.
mkdir -p "$TEST_TMP/common"
AUTH_OUT="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$REPO_ROOT" --level l3 --authority-store "$TEST_TMP/common" 2>&1)"
assert_contains "$AUTH_OUT" '"status":"READY"' "hermetic authority store admits independently"

finalize_test
