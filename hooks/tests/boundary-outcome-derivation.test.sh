#!/usr/bin/env bash
# hooks/tests/boundary-outcome-derivation.test.sh
#
# BL-0078: mutation_failed / unknown_status on a boundary_rejected outcome are
# derived from the rail evidence, never written as constants, and a boundary
# stop that the rail itself reports as a failed mutation or unknown status is
# not a clean durable boundary wait. Also pins the decision that dispatch
# exclusion is root-wide on purpose (one active Work Order per root).

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
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));
const { runCampaignComposition } = require(path.join(root, 'src', 'engine', 'campaign-composition'));
const wo = require(path.join(root, 'src', 'engine', 'work-order'));

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

const rejected = (extra = {}) => ({
  status: 'boundary_rejected',
  error: 'scope violation',
  boundary_code: 'scope_violation',
  commit: 'a'.repeat(40),
  ...extra,
});

run('classify derives flags', () => {
  const clean = ctrl.classifyBoundaryRejected(rejected());
  assert.ok(clean, 'a clean boundary rejection classifies');
  assert.strictEqual(clean.mutation_failed, false);
  assert.strictEqual(clean.unknown_status, false);
  assert.strictEqual(clean.candidate_ref, 'a'.repeat(40));
  // Evidence the rail itself reported must not be overwritten by a constant.
  assert.strictEqual(ctrl.classifyBoundaryRejected(rejected({ mutation_failed: true })), null,
    'rail-reported mutation_failed is not a clean boundary wait');
  assert.strictEqual(ctrl.classifyBoundaryRejected(rejected({ unknown_status: true })), null,
    'rail-reported unknown_status is not a clean boundary wait');
  assert.strictEqual(ctrl.classifyBoundaryRejected(rejected({
    commit: null, possibly_effectful: true,
  })), null, 'a possible effect with no candidate to point at is an unknown status');
  assert.strictEqual(ctrl.classifyBoundaryRejected(rejected({ mutation_failed: 'no' })), null,
    'a non-boolean flag is unknown, not false');
  const noCandidate = ctrl.classifyBoundaryRejected(rejected({ commit: null, possibly_effectful: false }));
  assert.ok(noCandidate, 'no candidate and no claimed effect is a clean boundary stop (positive control)');
  assert.strictEqual(noCandidate.possibly_effectful, false);
});

run('derive helper', () => {
  assert.deepStrictEqual(ctrl.deriveBoundaryOutcomeFlags(rejected()), {
    mutation_failed: false, unknown_status: false, clean: true,
  });
  assert.strictEqual(ctrl.deriveBoundaryOutcomeFlags(rejected({ mutation_failed: true })).clean, false);
  assert.strictEqual(ctrl.deriveBoundaryOutcomeFlags(null).clean, true, 'no flags reported');
});

run('composition refuses a contradictory boundary', () => {
  const adaptersFor = (mutation) => ({
    preflight: () => ({ passed: true }),
    preEffectAdmit: () => ({ ok: true }),
    implement: () => mutation,
    scopeCheck: () => ({ passed: true }),
    verify: () => ({ passed: true }),
    review: () => ({ reviewed: true, success: true, findings: '[]' }),
    adjudicate: () => ({}),
    convergence: () => ({ passed: true }),
    finalPanel: () => ({}),
  });
  const input = () => ({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptBytes: 0,
    controller: ctrl.emptyControllerState({ started_at_ms: Date.now() - 1000 }),
  });
  const clean = runCampaignComposition(input(), adaptersFor({
    committed: false, ...rejected(), phase: 'boundary_rejected',
    dispatcher_called: true, model_calls: 1,
    candidate_ref: 'a'.repeat(40), possibly_effectful: true,
  }));
  assert.strictEqual(clean.status, 'boundary_rejected', `positive control: ${JSON.stringify(clean).slice(0, 300)}`);
  assert.strictEqual(clean.mutation_failed, false);
  assert.strictEqual(clean.unknown_status, false);
  const bad = runCampaignComposition(input(), adaptersFor({
    committed: false, ...rejected({ mutation_failed: true }), phase: 'boundary_rejected',
    dispatcher_called: true, model_calls: 1,
    candidate_ref: 'a'.repeat(40), possibly_effectful: true,
  }));
  assert.notStrictEqual(bad.status, 'boundary_rejected',
    'a mutation_failed boundary must not become a durable boundary wait');
  assert.notStrictEqual(bad.durable_wait, true);
});

run('root-wide exclusion is pinned', () => {
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
  const first = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'root-x', graph_node: 'node-a', attempt: 1, role: 'controller',
    next_action: 'continue', branch, base_sha: base, worktree: dir, paths: {},
  }, { bindArtifacts: false });
  assert.strictEqual(first.status, 'written');
  const second = wo.claimDispatchCas(common, {
    root_run_id: 'root-x', graph_node: 'node-b', attempt: 1, role: 'controller', next_action: 'dispatch',
  }, { gitCwd: dir, bindArtifacts: false });
  assert.notStrictEqual(second.status, 'claimed', 'a live node blocks another node under the same root');
  assert.strictEqual(second.duplicate_dispatch, 0);
  // Positive control: a different root is not blocked.
  const other = wo.claimDispatchCas(common, {
    root_run_id: 'root-y', graph_node: 'node-b', attempt: 1, role: 'controller', next_action: 'dispatch',
    branch, base_sha: base, worktree: dir,
  }, { gitCwd: dir, bindArtifacts: false });
  assert.strictEqual(other.status, 'claimed', JSON.stringify(other).slice(0, 300));
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('boundary outcome derivation assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0078 boundary outcome derivation assertions"

finalize_test
