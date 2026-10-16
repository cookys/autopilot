#!/usr/bin/env bash
# hooks/tests/terminal-status-closed-enum.test.sh
#
# BL-0083: terminal_status is a closed enum wherever a Work Order or terminal
# receipt is consumed, and the unused `attached` disposition no longer makes a
# record terminal. Each refusal is paired with the legal-status control.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

MY_TMP=$(mktemp -d)
cleanup() {
  rm -rf "$MY_TMP"
  cleanup_test_tmp
}
trap cleanup EXIT

node - "$REPO_ROOT" "$MY_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const root = process.argv[2];
const tmp = process.argv[3];
const wo = require(path.join(root, 'src', 'engine', 'work-order'));

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

const dir = path.join(tmp, 'repo');
fs.mkdirSync(dir, { recursive: true });
const git = (...a) => cp.execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 't@example.invalid');
git('config', 'user.name', 't');
fs.writeFileSync(path.join(dir, 'f'), 'x\n');
git('add', 'f');
git('commit', '-q', '-m', 'init');
const base = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const common = wo.resolveGitCommonDir(dir);
const live = wo.createOrUpdateWorkOrder(common, {
  root_run_id: 'enum-root', graph_node: 'n', attempt: 1, role: 'implementer', next_action: 'continue',
  branch, base_sha: base, worktree: dir, paths: {},
}, { bindArtifacts: false }).work_order;

// A receipt whose digest is bound by the Work Order's expected_receipt, so only the
// status can make it fail.
function receiptFor(status) {
  const body = {
    schema_version: 1,
    artifact_type: wo.TERMINAL_RECEIPT_ARTIFACT,
    terminal_status: status,
    root_run_id: live.root_run_id,
    work_order_id: live.work_order_id,
  };
  const digest = wo.sha256Json(body);
  const receiptPath = path.join(tmp, `receipt-${status}.json`);
  return {
    receipt: { ...body, digest },
    receiptPath,
    workOrder: { ...live, terminal_status: status, expected_receipt: { path: receiptPath, digest } },
  };
}

run('receipt with a status outside the enum is invalid', () => {
  const good = receiptFor('success');
  const ok = wo.validateTerminalReceipt(good.receipt, good.workOrder, { receiptPath: good.receiptPath });
  assert.strictEqual(ok.ok, true, `legal status validates (positive control): ${JSON.stringify(ok)}`);
  for (const bad of ['succeeded', 'done', 'SUCCESS', 'ok']) {
    const r = receiptFor(bad);
    const v = wo.validateTerminalReceipt(r.receipt, r.workOrder, { receiptPath: r.receiptPath });
    assert.strictEqual(v.ok, false, `${bad} must not validate`);
    assert.strictEqual(v.reason_code, 'terminal_receipt_invalid');
  }
});

run('every enum member is still a terminal status', () => {
  for (const status of wo.TERMINAL_STATUSES) {
    assert.strictEqual(wo.isTerminalWorkOrder({ ...live, terminal_status: status }), true, status);
  }
});

run('a typo status is not terminal under any disposition', () => {
  for (const disposition of ['consumed', 'stale_dispositioned', 'attached', null]) {
    assert.strictEqual(wo.isTerminalWorkOrder({ ...live, disposition, terminal_status: 'succeeded' }), false,
      `disposition ${disposition}`);
  }
  // The retired `attached` disposition no longer makes a statusless-enum record terminal.
  assert.strictEqual(wo.isTerminalWorkOrder({ ...live, disposition: 'attached', terminal_status: 'nonsense' }), false);
});

run('a tombstone with a typo status keeps blocking', () => {
  for (const disposition of ['consumed', 'stale_dispositioned']) {
    assert.strictEqual(wo.isNonterminalWorkOrder({ ...live, disposition, terminal_status: 'succeeded' }), true,
      `${disposition}+succeeded must stay nonterminal`);
    assert.strictEqual(wo.isNonterminalWorkOrder({ ...live, disposition, terminal_status: 'success' }), false,
      `${disposition}+success is closed (positive control)`);
  }
});

run('classification blocks a typo status', () => {
  const c = wo.classifyWorkOrder({ ...live, terminal_status: 'succeeded' }, {
    gitCwd: dir, requireBoundEvidence: false,
  });
  assert.strictEqual(c.classification, 'orphan_blocked');
  assert.notStrictEqual(c.classification, 'consume_terminal');
});

run('a typo status cannot be written onto a tombstone', () => {
  for (const disposition of ['consumed', 'stale_dispositioned']) {
    assert.throws(() => wo.buildWorkOrder({ ...live, disposition, terminal_status: 'succeeded' }, { bindArtifacts: false }),
      (e) => e.code === 'terminal_status_invalid', disposition);
  }
  // Positive control: a legal status builds (stale needs its receipt, so use a live record).
  assert.ok(wo.buildWorkOrder({ ...live, terminal_status: 'success' }, { bindArtifacts: false }));
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('terminal status closed enum assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0083 terminal status closed enum assertions"

finalize_test
