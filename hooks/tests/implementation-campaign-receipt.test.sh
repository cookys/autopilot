#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, temp] = process.argv.slice(2);
const {
  adjudicateCampaignReview,
  createVerificationReceipt,
  createVerificationRequest,
  reusableGreenReceipt,
  runCampaignComposition,
} = require(path.join(root, 'src', 'engine'));

const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);
const env = {
  CI: '1',
  NODE_ENV: 'test',
  API_TOKEN: 'never-fingerprint',
};
const request = createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env,
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
});
const sameSecretChange = createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: { ...env, API_TOKEN: 'changed-secret' },
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
});
assert.strictEqual(request.env_fingerprint, sameSecretChange.env_fingerprint);

const green = createVerificationReceipt({
  campaignId: 'campaign-fixture',
  request,
  exitStatus: 0,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerLeaseClosed: true,
  detachedCheckout: true,
  stdout: 'ok\n',
});
assert.strictEqual(reusableGreenReceipt(green, request), true);
assert.strictEqual(reusableGreenReceipt(green, createVerificationRequest({
  treeSha: TREE_B,
  verifyCmd: 'node test.js',
  env,
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
})), false);
assert.strictEqual(reusableGreenReceipt(green, createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node other.js',
  env,
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
})), false);
assert.strictEqual(reusableGreenReceipt(green, createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: { ...env, CI: '0' },
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
})), false);
const red = createVerificationReceipt({
  campaignId: 'campaign-fixture',
  request,
  exitStatus: 1,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerLeaseClosed: true,
  detachedCheckout: true,
  stderr: 'failed\n',
});
assert.strictEqual(reusableGreenReceipt(red, request), false);
assert.strictEqual(reusableGreenReceipt({ ...green, stdout_digest: '0'.repeat(64) }, request), false);
assert.throws(() => createVerificationReceipt({
  campaignId: 'campaign-fixture',
  request,
  exitStatus: 0,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerLeaseClosed: false,
  detachedCheckout: true,
}), /closed writer/);

const structuredReview = JSON.stringify([
  {
    finding_id: 'F-IN-SCOPE',
    claim: 'in-scope acceptance defect',
    severity: '🟠',
    source: 'reviewer-a',
    evidence: {
      kind: 'trace',
      trace_chain: ['src/engine/example.js:12'],
      confirmed_by: 'depth-0',
    },
    disposition: {
      disposition: 'must-fix-now',
      acceptance_id: 'ICC-P2-AC1',
      deferral_harm: 'blocks the frozen acceptance criterion',
    },
  },
  {
    finding_id: 'F-HARDENING',
    claim: 'optional hardening outside the vertical slice',
    severity: '🟠',
    source: 'reviewer-b',
    evidence: {
      kind: 'reproduced',
      probe_cmd: 'node fixture.js',
      expected_signature: 'hardening absent',
      observed_output: 'hardening absent',
    },
    disposition: {
      disposition: 'follow-up',
      context: 'real but outside this campaign',
      trigger: 'when the hardening ticket is funded',
      proposed_backlog_title: 'Harden the optional path',
    },
  },
  {
    finding_id: 'F-REFUTED',
    claim: 'a refuted major claim',
    severity: '🟠',
    source: 'reviewer-c',
    evidence: {
      kind: 'refuted',
      probe_cmd: 'node refute.js',
      expected_signature: 'claim reproduced',
      observed_output: 'claim absent',
      mutation_desc: 'inject the claimed defect',
      mutation_probe_output: 'claim reproduced',
    },
    disposition: null,
  },
]);
const adjudicated = adjudicateCampaignReview({
  review: { verdict: 'FIX-THEN-SHIP', findings: structuredReview },
  convergenceVerdict: 'SHIP-AS-IS',
  now: '2026-07-27T00:00:00.000Z',
});
assert.strictEqual(adjudicated.registry_complete, true);
assert.strictEqual(adjudicated.repair_gate_passed, true);
assert.deepStrictEqual(adjudicated.must_fix_now.map((finding) => finding.id), ['F-IN-SCOPE']);
assert.deepStrictEqual(adjudicated.follow_up.map((finding) => finding.id), ['F-HARDENING']);
assert.deepStrictEqual(adjudicated.rejected.map((finding) => finding.id), ['F-REFUTED']);

const missingDisposition = adjudicateCampaignReview({
  review: {
    verdict: 'FIX-THEN-SHIP',
    findings: JSON.stringify([{
      finding_id: 'F-MISSING',
      claim: 'blocking claim lacks a disposition',
      severity: '🔴',
      source: 'reviewer-a',
      evidence: {
        kind: 'trace',
        trace_chain: ['src/engine/example.js:99'],
        confirmed_by: 'depth-0',
      },
    }]),
  },
  convergenceVerdict: 'SHIP-AS-IS',
  now: '2026-07-27T00:00:00.000Z',
});
assert.strictEqual(missingDisposition.registry_complete, false);

let mutations = 0;
let focusedReviews = 0;
let finalPanels = 0;
const scopeCheckpoints = [];
const composition = runCampaignComposition({
  maxRepairGenerations: 2,
}, {
  preflight: () => ({ passed: true }),
  implement({ kind }) {
    mutations += 1;
    return {
      committed: true,
      tree_sha: mutations === 1 ? TREE_A : TREE_B,
      kind,
    };
  },
  scopeCheck({ checkpoint }) {
    scopeCheckpoints.push(checkpoint);
    return { passed: true, checkpoint };
  },
  verify({ candidate }) {
    return {
      passed: true,
      receipt_digest: candidate.tree_sha === TREE_A
        ? '1'.repeat(64)
        : '2'.repeat(64),
    };
  },
  review() {
    focusedReviews += 1;
    return { reviewed: true, review_id: `focused-${focusedReviews}` };
  },
  adjudicate({ final, repair_generation: generation }) {
    if (final) {
      return {
        registry_complete: true,
        repair_gate_passed: true,
        must_fix_now: [],
        follow_up: [{ id: 'F-HARDENING' }],
        rejected: [],
      };
    }
    if (generation > 0) {
      return {
        registry_complete: true,
        repair_gate_passed: true,
        must_fix_now: [],
        follow_up: [],
        rejected: [],
      };
    }
    return {
      registry_complete: true,
      repair_gate_passed: true,
      must_fix_now: [{ id: 'F-IN-SCOPE' }],
      follow_up: [{ id: 'F-HARDENING' }],
      rejected: [{ id: 'F-REFUTED' }],
    };
  },
  convergence: () => ({ passed: true }),
  finalPanel() {
    finalPanels += 1;
    return { reviewed: true, review_id: 'final' };
  },
});
assert.strictEqual(composition.status, 'ready');
assert.strictEqual(composition.repair_generations, 1);
assert.strictEqual(mutations, 2);
assert.strictEqual(focusedReviews, 2);
assert.strictEqual(finalPanels, 1);
assert.deepStrictEqual(scopeCheckpoints, [
  'after_initial_mutation',
  'before_repair',
  'after_repair_mutation',
  'before_acceptance',
]);
assert.deepStrictEqual(composition.follow_up, [{ id: 'F-HARDENING' }]);
assert.strictEqual(composition.final_panel_count, 1);

let incompleteMutations = 0;
const incomplete = runCampaignComposition({
  maxRepairGenerations: 2,
}, {
  preflight: () => ({ passed: true }),
  implement() {
    incompleteMutations += 1;
    return { committed: true, tree_sha: TREE_A };
  },
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '3'.repeat(64) }),
  review: () => ({ reviewed: true }),
  adjudicate: () => ({ registry_complete: false, reason: 'missing disposition' }),
  convergence: () => ({ passed: true }),
  finalPanel: () => {
    throw new Error('incomplete registry must not reach final panel');
  },
});
assert.strictEqual(incomplete.status, 'blocked');
assert.strictEqual(incomplete.phase, 'adjudication');
assert.strictEqual(incompleteMutations, 1);

let verticalReviews = 0;
let verticalMutations = 0;
const verticalScopeCheckpoints = [];
const vertical = runCampaignComposition({
  maxRepairGenerations: 1,
}, {
  preflight: () => ({ passed: true }),
  implement() {
    verticalMutations += 1;
    return {
      committed: true,
      tree_sha: verticalMutations === 1 ? TREE_A : TREE_B,
    };
  },
  scopeCheck({ checkpoint }) {
    verticalScopeCheckpoints.push(checkpoint);
    return { passed: true };
  },
  verify({ repair_generation: generation }) {
    return {
      passed: generation === 1,
      receipt_digest: generation === 1 ? '4'.repeat(64) : '5'.repeat(64),
    };
  },
  review() {
    verticalReviews += 1;
    return { reviewed: true };
  },
  adjudicate: () => ({
    registry_complete: true,
    repair_gate_passed: true,
    must_fix_now: [],
    follow_up: [],
  }),
  convergence: () => ({ passed: true }),
  finalPanel: () => ({ reviewed: true }),
});
assert.strictEqual(vertical.status, 'ready');
assert.strictEqual(verticalMutations, 2);
assert.strictEqual(verticalReviews, 1);
assert.deepStrictEqual(verticalScopeCheckpoints, [
  'after_initial_mutation',
  'before_repair',
  'after_repair_mutation',
  'before_acceptance',
]);

fs.writeFileSync(path.join(temp, 'green.json'), `${JSON.stringify(green, null, 2)}\n`);
fs.writeFileSync(path.join(temp, 'terminal.json'), `${JSON.stringify(composition, null, 2)}\n`);
console.log('exact_green_reuse=true');
console.log('drift_miss=true');
console.log('red_never_reused=true');
console.log('one_bounded_repair=true');
console.log('mechanical_adjudication=true');
console.log('missing_disposition_blocks=true');
console.log('vertical_first=true');
NODE
)"
assert_exit_code "$?" "0" "campaign receipt and composition tests execute"
assert_contains "$OUT" "exact_green_reuse=true" "exact green receipt is reusable"
assert_contains "$OUT" "drift_miss=true" "tree, argv, and environment drift miss cache"
assert_contains "$OUT" "red_never_reused=true" "red receipts never become green hits"
assert_contains "$OUT" "one_bounded_repair=true" "synthetic findings authorize exactly one repair"
assert_contains "$OUT" "mechanical_adjudication=true" \
  "campaign adapter uses registry completeness and repair-gate"
assert_contains "$OUT" "missing_disposition_blocks=true" \
  "missing disposition fails closed before repair"
assert_contains "$OUT" "vertical_first=true" \
  "failed vertical evidence repairs before broad review"

node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/implementation-campaign-receipt.schema.json" \
  --document "$TEST_TMP/green.json" >/dev/null
assert_exit_code "$?" "0" "verification receipt matches the closed schema"
node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/implementation-campaign-receipt.schema.json" \
  --document "$TEST_TMP/terminal.json" >/dev/null
assert_exit_code "$?" "0" "terminal receipt matches the closed schema"

finalize_test
