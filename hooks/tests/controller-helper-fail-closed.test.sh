#!/usr/bin/env bash
# hooks/tests/controller-helper-fail-closed.test.sh
#
# BL-0077: controller helper API fail-closed hardening. A helper that is handed
# missing input must refuse, not default to admitting. Every case pairs the
# refusal with the explicit-input case that still passes, so the test goes red
# when the refusal is removed and also when the helper refuses everything.

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
const crypto = require('crypto');

const root = process.argv[2];
const tmp = process.argv[3];
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));
const { runCampaignComposition } = require(path.join(root, 'src', 'engine', 'campaign-composition'));
const mra = require(path.join(root, 'scripts', 'mission-routing-admission'));

// Each numbered section runs independently so a negative control shows every
// section that goes red, not only the first.
const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

// 1. Spend projection must be explicit.
run('section 1', () => {
  const usage = { ...ctrl.emptyBudgetUsage(), model_calls: 2 };
  const limits = ctrl.defaultBudgetLimits({ model_calls: 2 });
  const omitted = ctrl.checkJointRepairBudget(usage, limits);
  assert.strictEqual(omitted.ok, false, 'omitted projection must not admit at cap');
  assert.strictEqual(omitted.allow_spend, false);
  assert.strictEqual(omitted.code, 'BUDGET_PROJECTION_REQUIRED');
  for (const bad of [null, undefined, 3, 'x', []]) {
    const r = ctrl.checkJointRepairBudget(usage, limits, { projectedDelta: bad });
    assert.strictEqual(r.allow_spend, false, `non-object projection ${JSON.stringify(bad)}`);
  }
  // Positive control: an explicit empty projection below the cap still admits.
  const below = ctrl.checkJointRepairBudget(
    { ...ctrl.emptyBudgetUsage(), model_calls: 1 },
    limits,
    { projectedDelta: {} },
  );
  assert.strictEqual(below.ok, true);
  assert.strictEqual(below.allow_spend, true);
  // And an explicit positive projection at the cap still blocks.
  const blocked = ctrl.checkJointRepairBudget(usage, limits, { projectedDelta: { model_calls: 1 } });
  assert.strictEqual(blocked.allow_spend, false);
});

// 2. Empty controller replacement is rejected; omission preserves.
run('section 2', () => {
  const stored = ctrl.emptyControllerState({ phase: 'REVIEWING', next_action: 'review' });
  const wo = { work_order_id: 'w1', controller: stored };
  assert.throws(() => ctrl.attachControllerState(wo, {}), (e) => e.code === 'INVALID_CONTROLLER_STATE');
  assert.throws(() => ctrl.attachControllerState(wo, []), (e) => e.code === 'INVALID_CONTROLLER_STATE');
  assert.throws(() => ctrl.attachControllerState(wo, 'x'), (e) => e.code === 'INVALID_CONTROLLER_STATE');
  const kept = ctrl.attachControllerState(wo);
  assert.strictEqual(kept.controller.phase, 'REVIEWING', 'omitted state preserves the stored controller');
  const kept2 = ctrl.attachControllerState(wo, null);
  assert.strictEqual(kept2.controller.phase, 'REVIEWING');
  const replaced = ctrl.attachControllerState(wo, { phase: 'ADJUDICATING' });
  assert.strictEqual(replaced.controller.phase, 'ADJUDICATING');
});

// 3. Repository authority: the default effect admission refuses without a repo.
run('section 3', () => {
  let implementCalls = 0;
  const adapters = {
    preflight: () => ({ passed: true }),
    implement: () => { implementCalls += 1; return { committed: false, dispatcher_called: false, model_calls: 0 }; },
    scopeCheck: () => ({ passed: true }),
    verify: () => ({ passed: true }),
    review: () => ({ reviewed: true, success: true, findings: '[]' }),
    adjudicate: () => ({}),
    convergence: () => ({ passed: true }),
    finalPanel: () => ({}),
  };
  const input = {
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptBytes: 0,
    controller: ctrl.emptyControllerState({
      started_at_ms: Date.now() - 1000,
    }),
  };
  const refused = runCampaignComposition(input, adapters);
  assert.strictEqual(implementCalls, 0, 'no repository authority means no implementer call');
  assert.strictEqual(refused.code, 'EFFECT_REPOSITORY_AUTHORITY_REQUIRED', JSON.stringify(refused));
  // Positive control: an explicit adapter is an explicit decision and proceeds.
  runCampaignComposition(input, { ...adapters, preEffectAdmit: () => ({ ok: true }) });
  assert.strictEqual(implementCalls, 1, 'explicit preEffectAdmit adapter reaches the implementer');
});

// 4. Traversal is rejected inside the helper, not only by its callers.
run('section 4', () => {
  const base = {
    repoRoot: tmp,
    allowedPathPrefixes: ['docs'],
    authorizedCreates: [],
  };
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'docs', 'ok.md'), 'x\n');
  const good = ctrl.admitExecutableMissionDelta({ ...base, requiredPaths: ['docs/ok.md'], outputPaths: ['docs/ok.md'] });
  assert.notStrictEqual(good.ok, false, `clean path must not trip traversal: ${JSON.stringify(good)}`);
  for (const bad of ['docs/../outside.md', 'docs//ok.md', 'docs/./ok.md', '/docs/ok.md', 'docs\\ok.md', 'docs/ok.md\0']) {
    const r = ctrl.admitExecutableMissionDelta({ ...base, requiredPaths: [bad], outputPaths: [bad] });
    assert.strictEqual(r.ok, false, `traversal ${JSON.stringify(bad)} must reject`);
    assert.ok(JSON.stringify(r).includes('PATH_TRAVERSAL'), `PATH_TRAVERSAL for ${JSON.stringify(bad)}: ${JSON.stringify(r)}`);
  }
  // A traversing create authority is not allowed to launder an output either.
  const create = ctrl.admitExecutableMissionDelta({
    ...base, requiredPaths: [], outputPaths: ['docs/new.md'], authorizedCreates: ['docs/../x'],
  });
  assert.ok(JSON.stringify(create).includes('PATH_TRAVERSAL'));
});

// 5. The test-evidence seam carries production-equivalent binding.
run('section 5', () => {
  const repo = path.join(tmp, 'evidence-repo');
  fs.mkdirSync(repo, { recursive: true });
  cp.execFileSync('git', ['init', '-q', repo]);
  const canonicalJson = (v) => {
    const sort = (x) => (Array.isArray(x) ? x.map(sort)
      : (x && typeof x === 'object'
        ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x));
    return JSON.stringify(sort(v));
  };
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const bound = {
    artifact_type: 'noop_receipt',
    dispatcher_called: false,
    mutation_attempts: 0,
    gate_attempts: 0,
    repo_identity: 'git-common-dir:/x',
    mission_lineage_id: 'l',
    mission_policy_digest: 'a'.repeat(64),
    mission_graph_digest: 'b'.repeat(64),
    graph_node_id: 'n1',
    graph_attempt: 1,
    mission_claim_id: 'c',
    mission_campaign_id: 'mc',
    icc_campaign_id: 'icc',
    campaign_contract_digest: 'c'.repeat(64),
    strict_contract_digest: 'd'.repeat(64),
    base_sha: 'e'.repeat(40),
  };
  const seal = (body) => ({ ...body, digest: sha(canonicalJson(body)) });
  const load = (receipt, extra = {}) => mra.loadDurableMissionEvidence(repo, {
    allowTestCallerEvidence: true, noOpReceipt: receipt, ...extra,
  });
  assert.ok(load(seal(bound)).noOpReceipt, 'fully bound test receipt is accepted (positive control)');
  assert.strictEqual(load(seal({ base_sha: 'e'.repeat(40), acceptance_digest: 'f'.repeat(64) })).noOpReceipt, null,
    'receipt without production binding keys is refused');
  const missingKey = { ...bound }; delete missingKey.strict_contract_digest;
  assert.strictEqual(load(seal(missingKey)).noOpReceipt, null, 'one missing binding key refuses');
  assert.strictEqual(load(seal({ ...bound, dispatcher_called: true })).noOpReceipt, null);
  assert.strictEqual(load(seal({ ...bound, mutation_attempts: 1 })).noOpReceipt, null);
  assert.strictEqual(load(seal(bound), { graphNodeId: 'other' }).noOpReceipt, null,
    'receipt bound to another graph node refuses when the caller sealed a node');
  assert.ok(load(seal(bound), { graphNodeId: 'n1' }).noOpReceipt);
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('controller helper fail-closed assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0077 controller helper fail-closed assertions"

finalize_test
