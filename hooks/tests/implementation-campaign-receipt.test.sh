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
  createDetachedCheckoutAttestation,
  createLedgerReconciliationReceipt,
  createVerificationReceipt,
  createVerificationRequest,
  createWriterFence,
  reusableGreenReceipt,
  runCampaignComposition,
  verificationArgv,
} = require(path.join(root, 'src', 'engine'));

const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);
const COMMIT_A = 'c'.repeat(40);
const env = {
  PATH: '/fixture/bin',
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
assert.deepStrictEqual(verificationArgv('node test.js'), ['/bin/sh', '-c', 'node test.js']);
const sameSecretChange = createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: { ...env, API_TOKEN: 'changed-secret' },
  envAllowlist: ['NODE_ENV', 'API_TOKEN', 'CI'],
});
assert.strictEqual(request.env_fingerprint, sameSecretChange.env_fingerprint);
const sameDatabaseSecretChange = createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: {
    ...env,
    DATABASE_URL: 'postgres://fixture-user:credential-a@example.invalid/db',
  },
  envAllowlist: ['NODE_ENV', 'DATABASE_URL', 'CI'],
});
const changedDatabaseSecret = createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: {
    ...env,
    DATABASE_URL: 'postgres://fixture-user:credential-b@example.invalid/db',
  },
  envAllowlist: ['NODE_ENV', 'DATABASE_URL', 'CI'],
});
assert.strictEqual(
  sameDatabaseSecretChange.env_fingerprint,
  changedDatabaseSecret.env_fingerprint,
);
assert.notStrictEqual(request.env_fingerprint, createVerificationRequest({
  treeSha: TREE_A,
  verifyCmd: 'node test.js',
  env: { ...env, PATH: '/other/bin' },
  envAllowlist: ['CI'],
}).env_fingerprint);

const implementationResult = {
  status: 'committed',
  implementation: { commit: COMMIT_A },
  implementationResult: {
    error: null,
    status: 0,
    signal: null,
  },
};
const writerFence = createWriterFence({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  implementationResult,
});
const ledgerReconciliation = createLedgerReconciliationReceipt({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  reconcileResult: {
    status: 'resolved',
    reason: 'terminal_state',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'committed',
    nonce: 'fixture-nonce',
    pending_side_effects: 0,
    terminal: true,
    git_truth: false,
    holder_alive: false,
  },
  latestRecord: {
    kind: 'stage',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'committed',
    nonce: 'fixture-nonce',
    git_sha: COMMIT_A,
  },
});
assert.throws(() => createLedgerReconciliationReceipt({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  reconcileResult: {
    status: 'resolved',
    reason: 'git_truth',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'leased',
    nonce: 'fixture-nonce',
    pending_side_effects: 0,
    terminal: false,
    git_truth: true,
    holder_alive: true,
  },
  latestRecord: {
    kind: 'stage',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'leased',
    nonce: 'fixture-nonce',
    git_sha: COMMIT_A,
  },
}), /does not prove a closed implementation writer/);
assert.throws(() => createLedgerReconciliationReceipt({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  reconcileResult: {
    status: 'resolved',
    reason: 'terminal_state',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'committed',
    nonce: 'fixture-nonce',
    pending_side_effects: 0,
    terminal: true,
    git_truth: false,
    holder_alive: true,
  },
  latestRecord: {
    kind: 'stage',
    run_id: 'campaign-fixture',
    stage: 'campaign-implementation',
    generation: 1,
    state: 'committed',
    nonce: 'fixture-nonce',
    git_sha: COMMIT_A,
  },
}), /does not prove a closed implementation writer/);
const ledgerWriterFence = createWriterFence({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  implementationResult: {
    status: 'committed',
    implementation: {
      commit: COMMIT_A,
      reconcile_by_ledger: true,
      reconciliation_receipt: ledgerReconciliation,
    },
    implementationResult: {
      error: new Error('transport exited before its terminal response'),
      status: null,
      signal: null,
    },
  },
});
assert.strictEqual(ledgerWriterFence.evidence_mode, 'terminal_ledger');
assert.strictEqual(
  ledgerWriterFence.closure_evidence_digest,
  ledgerReconciliation.receipt_digest,
);
const checkoutAttestation = createDetachedCheckoutAttestation({
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  worktreeResult: {
    error: null,
    status: 0,
    signal: null,
    detached: true,
    commit: COMMIT_A,
    observed_commit: COMMIT_A,
    observed_tree_sha: TREE_A,
    worktree: '/tmp/campaign-fixture-wt',
  },
});
const green = createVerificationReceipt({
  campaignId: 'campaign-fixture',
  request,
  exitStatus: 0,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerFence,
  checkoutAttestation,
  executedArgv: verificationArgv('node test.js'),
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
  writerFence,
  checkoutAttestation,
  executedArgv: verificationArgv('node test.js'),
  stderr: 'failed\n',
});
assert.strictEqual(reusableGreenReceipt(red, request), false);
assert.strictEqual(reusableGreenReceipt({ ...green, stdout_digest: '0'.repeat(64) }, request), false);
assert.strictEqual(reusableGreenReceipt({
  ...green,
  writer_fence_digest: undefined,
  receipt_digest: undefined,
}, request), false);
assert.throws(() => createVerificationReceipt({
  campaignId: 'other-campaign',
  request,
  exitStatus: 0,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerFence,
  checkoutAttestation,
  executedArgv: verificationArgv('node test.js'),
}), /fence or checkout binding/);
assert.throws(() => createVerificationReceipt({
  campaignId: 'campaign-fixture',
  request,
  exitStatus: 0,
  startedAt: '2026-07-27T00:00:00.000Z',
  endedAt: '2026-07-27T00:00:01.000Z',
  writerFence,
  checkoutAttestation,
  executedArgv: ['/bin/sh', '-c', 'node other.js'],
}), /argv attestation does not match/);
assert.throws(() => createWriterFence({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  implementationResult: { ...implementationResult, status: 'blocked' },
}), /completed committed/);
assert.throws(() => createWriterFence({
  campaignId: 'campaign-fixture',
  stageIdentity: 'campaign-implementation',
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  implementationResult: {
    status: 'committed',
    implementation: {
      commit: COMMIT_A,
      reconcile_by_ledger: true,
    },
    implementationResult: {
      error: new Error('transport failed'),
      status: null,
      signal: null,
    },
  },
}), /ledger reconciliation must be a receipt object/);
assert.throws(() => createDetachedCheckoutAttestation({
  candidateCommit: COMMIT_A,
  candidateTreeSha: TREE_A,
  worktreeResult: {
    error: null,
    status: 0,
    signal: null,
    detached: false,
    commit: COMMIT_A,
    observed_commit: COMMIT_A,
    observed_tree_sha: TREE_A,
    worktree: '/tmp/campaign-fixture-wt',
  },
}), /not attested detached/);

const REVIEW_DIGEST = 'd'.repeat(64);
const structuredReview = JSON.stringify([
  {
    finding_id: 'F-IN-SCOPE',
    claim: 'in-scope acceptance defect',
    severity: '🟠',
    source: 'reviewer-a',
  },
  {
    finding_id: 'F-HARDENING',
    claim: 'optional hardening outside the vertical slice',
    severity: '🟠',
    source: 'reviewer-b',
  },
  {
    finding_id: 'F-REFUTED',
    claim: 'a refuted major claim',
    severity: '🟠',
    source: 'reviewer-c',
  },
]);
const adjudicated = adjudicateCampaignReview({
  review: {
    verdict: 'FIX-THEN-SHIP',
    findings: structuredReview,
    review_digest: REVIEW_DIGEST,
  },
  convergenceVerdict: 'SHIP-AS-IS',
  dispositionAuthority: {
    authority: 'depth-0',
    actor_id: 'core-owner',
    review_digest: REVIEW_DIGEST,
    decisions: [
      {
        finding_id: 'F-IN-SCOPE',
        evidence: {
          kind: 'trace',
          trace_chain: ['src/engine/example.js:12'],
          confirmed_by: 'core-owner',
        },
        disposition: {
          disposition: 'must-fix-now',
          acceptance_id: 'ICC-P2-AC1',
          deferral_harm: 'blocks the frozen acceptance criterion',
        },
      },
      {
        finding_id: 'F-HARDENING',
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
    ],
  },
  now: '2026-07-27T00:00:00.000Z',
});
assert.strictEqual(adjudicated.registry_complete, true);
assert.strictEqual(adjudicated.repair_gate_passed, true);
assert.deepStrictEqual(adjudicated.must_fix_now.map((finding) => finding.id), ['F-IN-SCOPE']);
assert.deepStrictEqual(adjudicated.follow_up.map((finding) => finding.id), ['F-HARDENING']);
assert.deepStrictEqual(adjudicated.rejected.map((finding) => finding.id), ['F-REFUTED']);
assert.strictEqual(adjudicated.must_fix_now[0].adjudication_authority.actor_id, 'core-owner');
assert.match(adjudicated.must_fix_now[0].evidence.digest, /^[0-9a-f]{64}$/);
assert.strictEqual(adjudicated.rejected[0].adjudication_authority.actor_id, 'core-owner');
assert.strictEqual(adjudicated.rejected[0].evidence.classification, 'refuted');

const reviewerDisposition = adjudicateCampaignReview({
  review: {
    verdict: 'FIX-THEN-SHIP',
    review_digest: REVIEW_DIGEST,
    findings: JSON.stringify([{
      finding_id: 'F-UNTRUSTED',
      claim: 'reviewer attempts to authorize its own repair',
      severity: '🟠',
      source: 'reviewer-a',
      evidence: {
        kind: 'trace',
        trace_chain: ['src/engine/example.js:55'],
        confirmed_by: 'depth-0',
      },
      disposition: {
        disposition: 'must-fix-now',
        acceptance_id: 'ICC-P2-AC1',
        deferral_harm: 'self-authorized',
      },
    }]),
  },
  convergenceVerdict: 'SHIP-AS-IS',
});
assert.strictEqual(reviewerDisposition.registry_complete, false);
assert.strictEqual(reviewerDisposition.error_code, 'INVALID_FINDING');

const missingDisposition = adjudicateCampaignReview({
  review: {
    verdict: 'FIX-THEN-SHIP',
    review_digest: REVIEW_DIGEST,
    findings: JSON.stringify([{
      finding_id: 'F-MISSING',
      claim: 'blocking claim lacks a disposition',
      severity: '🔴',
      source: 'reviewer-a',
    }]),
  },
  convergenceVerdict: 'SHIP-AS-IS',
  dispositionAuthority: {
    authority: 'depth-0',
    actor_id: 'core-owner',
    review_digest: REVIEW_DIGEST,
    decisions: [{
      finding_id: 'F-MISSING',
      evidence: {
        kind: 'trace',
        trace_chain: ['src/engine/example.js:99'],
        confirmed_by: 'core-owner',
      },
      disposition: null,
    }],
  },
  now: '2026-07-27T00:00:00.000Z',
});
assert.strictEqual(missingDisposition.registry_complete, false);

let mutations = 0;
let focusedReviews = 0;
let finalPanels = 0;
let authorizedRepairInput = null;
const scopeCheckpoints = [];
const retainedFollowUp = {
  id: 'F-HARDENING',
  evidence: {
    classification: 'actionable',
    digest: '7'.repeat(64),
  },
  adjudication_authority: {
    authority: 'depth-0',
    actor_id: 'core-owner',
    review_digest: '1'.repeat(64),
  },
};
const composition = runCampaignComposition({
  maxRepairGenerations: 2,
}, {
  preflight: () => ({ passed: true }),
  implement(input) {
    const { kind } = input;
    mutations += 1;
    if (kind === 'review_repair') authorizedRepairInput = input;
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
        follow_up: [{
          ...retainedFollowUp,
          adjudication_authority: {
            ...retainedFollowUp.adjudication_authority,
            review_digest: '2'.repeat(64),
          },
        }],
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
      follow_up: [retainedFollowUp],
      rejected: [{ id: 'F-REFUTED' }],
    };
  },
  convergence: () => ({ passed: true }),
  finalPanel() {
    finalPanels += 1;
    return { reviewed: true, review_id: 'final' };
  },
});
assert.strictEqual(composition.status, 'follow_up');
assert.strictEqual(composition.repair_generations, 1);
assert.strictEqual(mutations, 2);
assert.strictEqual(focusedReviews, 2);
assert.strictEqual(finalPanels, 1);
assert.deepStrictEqual(authorizedRepairInput.repair_finding_ids, ['F-IN-SCOPE']);
assert.deepStrictEqual(authorizedRepairInput.repair_findings, [{ id: 'F-IN-SCOPE' }]);
assert.deepStrictEqual(scopeCheckpoints, [
  'after_initial_mutation',
  'before_repair',
  'after_repair_mutation',
  'before_acceptance',
]);
assert.deepStrictEqual(composition.follow_up, [retainedFollowUp]);
assert.deepStrictEqual(composition.rejected_findings, [{ id: 'F-REFUTED' }]);
assert.strictEqual(composition.final_panel_count, 1);

const dispositionConflict = runCampaignComposition({
  maxRepairGenerations: 1,
}, {
  preflight: () => ({ passed: true }),
  implement: () => ({ committed: true, tree_sha: TREE_A }),
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '6'.repeat(64) }),
  review: () => ({ reviewed: true }),
  adjudicate({ final }) {
    return {
      registry_complete: true,
      repair_gate_passed: true,
      must_fix_now: final ? [{ id: 'F-CONFLICT' }] : [],
      follow_up: final ? [] : [{ id: 'F-CONFLICT' }],
      rejected: [],
    };
  },
  convergence: () => ({ passed: true }),
  finalPanel: () => ({ reviewed: true }),
});
assert.strictEqual(dispositionConflict.status, 'blocked');
assert.strictEqual(dispositionConflict.phase, 'final_adjudication');
assert.match(dispositionConflict.reason, /conflicting cross-round dispositions/);

const evidenceConflict = runCampaignComposition({
  maxRepairGenerations: 1,
}, {
  preflight: () => ({ passed: true }),
  implement: () => ({ committed: true, tree_sha: TREE_A }),
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '8'.repeat(64) }),
  review: () => ({ reviewed: true }),
  adjudicate({ final }) {
    return {
      registry_complete: true,
      repair_gate_passed: true,
      must_fix_now: [],
      follow_up: [{
        id: 'F-EVIDENCE-DRIFT',
        evidence: {
          classification: 'actionable',
          digest: (final ? '9' : '8').repeat(64),
        },
      }],
      rejected: [],
    };
  },
  convergence: () => ({ passed: true }),
  finalPanel: () => ({ reviewed: true }),
});
assert.strictEqual(evidenceConflict.status, 'blocked');
assert.strictEqual(evidenceConflict.phase, 'final_adjudication');
assert.match(evidenceConflict.reason, /conflicting cross-round dispositions/);

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
