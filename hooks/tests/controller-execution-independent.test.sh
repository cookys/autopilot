#!/usr/bin/env bash
# hooks/tests/controller-execution-independent.test.sh
#
# Independent, adversarial verification suite for the Controller Execution Discipline.
# Asserts denominator integrity, gate invalidation, vertical-failure review barriers,
# boundary/disposition semantics, budget enforcement, debt blocks, and orphan leaf adoption.

set -euo pipefail
. "$(dirname "$0")/lib.sh"

# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

MY_TMP=$(mktemp -d)
cleanup() {
  rm -rf "$MY_TMP"
  cleanup_test_tmp
}
trap cleanup EXIT

# Run verification assertions in Node.js
node - "$REPO_ROOT" "$MY_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');

const root = process.argv[2];
const tempRepo = process.argv[3];
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));

console.log("Starting independent verification tests for Controller Execution...");

// Group 1: Denominator integrity plus gate invalidation
{
  console.log("Testing Group 1: Denominator integrity plus gate invalidation");

  // Positive: buildFrozenDenominator
  const denom = ctrl.buildFrozenDenominator({
    projectId: 'p1',
    graphDigest: 'a'.repeat(64),
    deliverableIds: ['d1', 'd2', 'd1'], // duplicates should be deduplicated & sorted
    nodeId: 'd1'
  });

  assert.strictEqual(denom.project_id, 'p1');
  assert.deepStrictEqual(denom.deliverable_ids, ['d1', 'd2']);
  assert.strictEqual(denom.deliverable_count, 2);
  assert.strictEqual(denom.active_node_id, 'd1');
  assert.ok(denom.digest);

  // Positive: assertFrozenDenominatorStable passes on same
  assert.ok(ctrl.assertFrozenDenominatorStable(denom, ['d1', 'd2']));
  assert.ok(ctrl.assertFrozenDenominatorStable(denom, ['d2', 'd1'])); // sorting doesn't affect it

  // Negative: assertFrozenDenominatorStable throws on changed deliverables (expansion)
  assert.throws(() => {
    ctrl.assertFrozenDenominatorStable(denom, ['d1', 'd2', 'd3']);
  }, (err) => err.code === 'DENOMINATOR_MUTATION');

  // Negative: assertFrozenDenominatorStable throws on tampered digest
  const tampered = { ...denom, project_id: 'p2' };
  assert.throws(() => {
    ctrl.assertFrozenDenominatorStable(tampered, ['d1', 'd2']);
  }, (err) => err.code === 'DENOMINATOR_DIGEST_MISMATCH');

  // Gate journal positive/negative
  let journal = ctrl.emptyGateJournal();
  assert.deepStrictEqual(journal.entries, []);

  const gateInput = { file: 'src/app.js' };

  // Negative: recordGateEntry rejects invalid gate kind
  assert.throws(() => {
    ctrl.recordGateEntry(journal, {
      kind: 'invalid_kind',
      owner: 'verifier',
      input: gateInput,
      result: { success: true },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }, (err) => err.code === 'INVALID_GATE_KIND');

  // Negative: recordGateEntry rejects missing owner or timestamps
  assert.throws(() => {
    ctrl.recordGateEntry(journal, {
      kind: 'full_diff_review',
      owner: '',
      input: gateInput,
      result: { success: true },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }, (err) => err.code === 'INVALID_GATE_OWNER');

  assert.throws(() => {
    ctrl.recordGateEntry(journal, {
      kind: 'full_diff_review',
      owner: 'verifier',
      input: gateInput,
      result: { success: true },
      startedAt: '',
      finishedAt: new Date().toISOString(),
    });
  }, (err) => err.code === 'INVALID_GATE_TIMING');

  // Positive: recordGateEntry succeeds and findReusableGate finds it
  const record1 = ctrl.recordGateEntry(journal, {
    kind: 'full_diff_review',
    owner: 'verifier',
    input: gateInput,
    result: { success: true },
    startedAt: '2026-07-30T12:00:00.000Z',
    finishedAt: '2026-07-30T12:05:00.000Z',
  });

  assert.strictEqual(record1.reused, false);
  assert.strictEqual(record1.entry.invalidated, false);
  assert.strictEqual(record1.entry.gate_id, 'gate-full_diff_review-1');

  journal = record1.journal;
  const reused1 = ctrl.findReusableGate(journal, 'full_diff_review', gateInput);
  assert.ok(reused1);
  assert.strictEqual(reused1.gate_id, 'gate-full_diff_review-1');

  // Positive reuse (identical successful input)
  const record2 = ctrl.recordGateEntry(journal, {
    kind: 'full_diff_review',
    owner: 'verifier',
    input: gateInput,
    result: { success: true },
    startedAt: '2026-07-30T12:10:00.000Z',
    finishedAt: '2026-07-30T12:15:00.000Z',
  });
  assert.strictEqual(record2.reused, true);

  // Changed input without invalidateReason must fail closed.
  assert.throws(() => {
    ctrl.recordGateEntry(journal, {
      kind: 'full_diff_review',
      owner: 'verifier',
      input: { file: 'src/other.js' },
      result: { success: true },
      startedAt: '2026-07-30T12:16:00.000Z',
      finishedAt: '2026-07-30T12:17:00.000Z',
    });
  }, (err) => err.code === 'GATE_INVALIDATION_REQUIRED');

  // Changed input with explicit invalidateReason supersedes all live same-kind successes.
  const record3 = ctrl.recordGateEntry(journal, {
    kind: 'full_diff_review',
    owner: 'verifier',
    input: { file: 'src/other.js' },
    result: { success: true },
    startedAt: '2026-07-30T12:20:00.000Z',
    finishedAt: '2026-07-30T12:25:00.000Z',
    invalidateReason: 'code drift',
  });

  assert.strictEqual(record3.reused, false);
  const updatedJournal = record3.journal;
  const oldEntry = updatedJournal.entries[0];
  assert.strictEqual(oldEntry.invalidated, true);
  assert.strictEqual(oldEntry.invalidation_reason, 'code drift');
  // Old input is no longer reusable; new input is.
  assert.strictEqual(ctrl.findReusableGate(updatedJournal, 'full_diff_review', gateInput), null);
  const reused2 = ctrl.findReusableGate(updatedJournal, 'full_diff_review', { file: 'src/other.js' });
  assert.ok(reused2);
  assert.strictEqual(reused2.invalidated, false);

  // Failed entries and unrelated kinds are not invalidated.
  let mixed = ctrl.emptyGateJournal();
  mixed = ctrl.recordGateEntry(mixed, {
    kind: 'focused_verification',
    owner: 'verifier',
    input: { t: 1 },
    result: { success: true },
    startedAt: '2026-07-30T13:00:00.000Z',
    finishedAt: '2026-07-30T13:01:00.000Z',
  }).journal;
  mixed = ctrl.recordGateEntry(mixed, {
    kind: 'full_diff_review',
    owner: 'verifier',
    input: { t: 1 },
    result: { success: false },
    startedAt: '2026-07-30T13:02:00.000Z',
    finishedAt: '2026-07-30T13:03:00.000Z',
  }).journal;
  mixed = ctrl.recordGateEntry(mixed, {
    kind: 'full_diff_review',
    owner: 'verifier',
    input: { t: 2 },
    result: { success: true },
    startedAt: '2026-07-30T13:04:00.000Z',
    finishedAt: '2026-07-30T13:05:00.000Z',
  }).journal;
  assert.strictEqual(mixed.entries[0].invalidated, false);
  assert.strictEqual(mixed.entries[1].invalidated, false);
}

// Group 2: Vertical-failure/full-diff ordering
{
  console.log("Testing Group 2: Vertical-failure/full-diff ordering");

  let barriers = {};

  // Positive: recordFullDiffBarrier creates barrier record
  barriers = ctrl.recordFullDiffBarrier(barriers, 0, { success: true, review_digest: 'd1', candidate_ref: 'c1' });
  assert.ok(barriers['0']);
  assert.strictEqual(barriers['0'].kind, 'full_diff_review');
  assert.strictEqual(barriers['0'].success, true);
  assert.strictEqual(barriers['0'].review_digest, 'd1');

  // Positive: requireFullDiffBeforeRepair returns ok when barrier exists
  const check1 = ctrl.requireFullDiffBeforeRepair({
    generation: 0,
    fullDiffBarriers: barriers,
    focusedOnly: false,
    verticalFailed: false,
  });
  assert.strictEqual(check1.ok, true);
  assert.strictEqual(check1.allow_repair, true);

  // Negative: requireFullDiffBeforeRepair rejects focused-only evidence
  const check2 = ctrl.requireFullDiffBeforeRepair({
    generation: 0,
    fullDiffBarriers: barriers,
    focusedOnly: true,
    verticalFailed: false,
  });
  assert.strictEqual(check2.ok, false);
  assert.strictEqual(check2.allow_repair, false);
  assert.strictEqual(check2.code, 'FULL_DIFF_BARRIER_REQUIRED');

  // Negative: requireFullDiffBeforeRepair rejects vertical-verification failure without full-diff barrier
  const check3 = ctrl.requireFullDiffBeforeRepair({
    generation: 1, // generation 1 has no barrier
    fullDiffBarriers: barriers,
    focusedOnly: false,
    verticalFailed: true,
  });
  assert.strictEqual(check3.ok, false);
  assert.strictEqual(check3.allow_repair, false);
  assert.strictEqual(check3.code, 'FULL_DIFF_BARRIER_REQUIRED');
  assert.ok(check3.reason.includes('vertical verification failed but authoritative full-diff review is still required'));
}

// Group 3: Boundary/disposition semantics surviving campaign/resume-facing values
{
  console.log("Testing Group 3: Boundary/disposition semantics surviving campaign/resume-facing values");

  // Positive: classifyBoundaryRejected preserves status and other details
  const boundaryRes = ctrl.classifyBoundaryRejected({
    status: 'boundary_rejected',
    commit: 'c123',
    error: 'out of budget limits',
    boundary_code: 'exceeded_model_calls',
  });
  assert.ok(boundaryRes);
  assert.strictEqual(boundaryRes.status, 'boundary_rejected');
  assert.strictEqual(boundaryRes.phase, 'boundary_rejected');
  assert.strictEqual(boundaryRes.candidate_ref, 'c123');
  assert.strictEqual(boundaryRes.boundary_reason, 'out of budget limits');
  assert.strictEqual(boundaryRes.boundary_code, 'exceeded_model_calls');
  assert.strictEqual(boundaryRes.possibly_effectful, true);
  assert.strictEqual(boundaryRes.mutation_failed, false);

  // Negative: classifyBoundaryRejected returns null for non-boundary-rejected status
  const boundaryResNull = ctrl.classifyBoundaryRejected({ status: 'ok' });
  assert.strictEqual(boundaryResNull, null);

  // Positive: classifyMissingDisposition yields awaiting_disposition
  const findings = [{ id: 'f1', path: 'src/app.js' }];
  const dispRes1 = ctrl.classifyMissingDisposition({
    findings,
    dispositionAuthority: null,
    findingsIdentityOk: true,
  });
  assert.strictEqual(dispRes1.status, 'awaiting_disposition');
  assert.strictEqual(dispRes1.phase, 'awaiting_disposition');
  assert.strictEqual(dispRes1.resumable, true);
  assert.deepStrictEqual(dispRes1.findings, findings);

  // Negative: classifyMissingDisposition yields hard_fail for identity-mismatched findings
  const dispRes2 = ctrl.classifyMissingDisposition({
    findings,
    dispositionAuthority: null,
    findingsIdentityOk: false,
  });
  assert.strictEqual(dispRes2.status, 'hard_fail');
  assert.strictEqual(dispRes2.phase, 'adjudication');
  assert.strictEqual(dispRes2.resumable, false);
}

// Group 4: Repair budgets & axes
{
  console.log("Testing Group 4: Repair budgets & axes");

  const usage = ctrl.emptyBudgetUsage();
  // Represent unobserved fresh tokens as null, not zero
  assert.strictEqual(usage.fresh_input_tokens, null);

  // Positive: checkJointRepairBudget is within budget
  const limits = ctrl.defaultBudgetLimits({ model_calls: 5 });
  const check1 = ctrl.checkJointRepairBudget(usage, limits);
  assert.strictEqual(check1.ok, true);
  assert.strictEqual(check1.status, 'within_budget');
  assert.strictEqual(check1.allow_spend, true);

  // Positive: applyBudgetUsage correctly accumulates budget
  const nextUsage = ctrl.applyBudgetUsage(usage, { model_calls: 3, fresh_input_tokens: 100 });
  assert.strictEqual(nextUsage.model_calls, 3);
  assert.strictEqual(nextUsage.fresh_input_tokens, 100);

  // Negative: checkJointRepairBudget denies overage
  const check2 = ctrl.checkJointRepairBudget(nextUsage, { model_calls: 2 });
  assert.strictEqual(check2.ok, false);
  assert.strictEqual(check2.status, 'awaiting_convergence_adjudication');
  assert.strictEqual(check2.allow_spend, false);
  assert.deepStrictEqual(check2.exceeded, ['model_calls']);
}

// Group 5: Debt/high-water blocking with zero effects
{
  console.log("Testing Group 5: Debt/high-water blocking with zero effects");

  // Positive: clean/terminal resource is released with non-empty recovery_bundle_digest
  const inventory1 = [
    {
      resource_id: 'w1',
      kind: 'worktree',
      clean: true,
      identity_known: true,
      recovery_bundle_digest: 'd123',
    }
  ];
  const debtState1 = ctrl.buildResourceDebtState(inventory1);
  assert.strictEqual(debtState1.blocks_dispatch, false);
  assert.strictEqual(debtState1.released.length, 1);
  assert.strictEqual(debtState1.open.length, 0);

  // Negative: buildResourceDebtState leaves clean-but-unbundled (missing recovery_bundle_digest) in open blocking debt
  const inventory2 = [
    {
      resource_id: 'w1',
      kind: 'worktree',
      clean: true,
      identity_known: true,
      // missing recovery_bundle_digest
    }
  ];
  const debtState2 = ctrl.buildResourceDebtState(inventory2);
  assert.strictEqual(debtState2.blocks_dispatch, true);
  assert.strictEqual(debtState2.open.length, 1);
  assert.strictEqual(debtState2.open[0].disposition, 'disposition_blocked');

  // Negative: dirty, unknown, or clean-but-unbundled residue in open blocking debt
  const inventory3 = [
    {
      resource_id: 'w2',
      kind: 'worktree',
      dirty: true,
    }
  ];
  const debtState3 = ctrl.buildResourceDebtState(inventory3);
  assert.strictEqual(debtState3.blocks_dispatch, true);
  assert.strictEqual(debtState3.open.length, 1);
  assert.strictEqual(debtState3.open[0].disposition, 'retained_dirty');

  // Positive: admitHighWater succeeds
  const highWaterRes1 = ctrl.admitHighWater({ currentOwned: 2, highWater: 4, unresolvedDebt: false, tempCapacityOk: true });
  assert.strictEqual(highWaterRes1.ok, true);
  assert.strictEqual(highWaterRes1.allow_checkout, true);
  assert.strictEqual(highWaterRes1.allow_runner, true);

  // Negative: admitHighWater denies with effects: 0
  const highWaterRes2 = ctrl.admitHighWater({ unresolvedDebt: true });
  assert.strictEqual(highWaterRes2.ok, false);
  assert.strictEqual(highWaterRes2.effects, 0);
  assert.strictEqual(highWaterRes2.code, 'RESOURCE_DEBT_BLOCKS_DISPATCH');

  const highWaterRes3 = ctrl.admitHighWater({ currentOwned: 4, highWater: 4 });
  assert.strictEqual(highWaterRes3.ok, false);
  assert.strictEqual(highWaterRes3.effects, 0);
  assert.strictEqual(highWaterRes3.code, 'HIGH_WATER_EXCEEDED');

  const highWaterRes4 = ctrl.admitHighWater({ tempCapacityOk: false });
  assert.strictEqual(highWaterRes4.ok, false);
  assert.strictEqual(highWaterRes4.effects, 0);
  assert.strictEqual(highWaterRes4.code, 'TEMP_CAPACITY_EXCEEDED');
}

// Group 6: Orphan proof completeness and single adoption
{
  console.log("Testing Group 6: Orphan proof completeness and single adoption");

  const tip = 'a'.repeat(40);
  const tree = 'b'.repeat(40);
  const wt = 'c'.repeat(64);
  const baseAdoptArgs = {
    controllerDead: true,
    leafResult: { committed: true, commit: tip },
    branchTip: tip,
    branchTree: tree,
    baseAncestryOk: true,
    scopeOk: true,
    churnOk: true,
    worktreeDigest: wt,
    generation: 0,
    alreadyAdopted: false,
  };

  // Positive: adoptOrphanLeaf succeeds with canonical bound tip/tree/digest
  const adoptRes1 = ctrl.adoptOrphanLeaf(baseAdoptArgs);
  assert.strictEqual(adoptRes1.ok, true);
  assert.strictEqual(adoptRes1.status, 'adopted');
  assert.strictEqual(adoptRes1.duplicate_mutation, 0);
  assert.ok(adoptRes1.receipt);
  assert.strictEqual(adoptRes1.receipt.branch_tip, tip);
  assert.strictEqual(adoptRes1.receipt.leaf_commit, tip);

  // Negative: placeholder/non-canonical evidence stops
  const adoptPlaceholder = ctrl.adoptOrphanLeaf({
    ...baseAdoptArgs,
    leafResult: { committed: true, commit: 'c1' },
    branchTip: 'b1',
    branchTree: 't1',
    worktreeDigest: 'd1',
  });
  assert.strictEqual(adoptPlaceholder.ok, false);
  assert.strictEqual(adoptPlaceholder.code, 'ADOPTION_BINDING_INCOMPLETE');
  assert.strictEqual(adoptPlaceholder.preserve_evidence, true);

  // Negative: leaf commit must equal branch tip
  const adoptMismatch = ctrl.adoptOrphanLeaf({
    ...baseAdoptArgs,
    leafResult: { committed: true, commit: '1'.repeat(40) },
    branchTip: '2'.repeat(40),
  });
  assert.strictEqual(adoptMismatch.ok, false);
  assert.strictEqual(adoptMismatch.code, 'ADOPTION_LEAF_TIP_MISMATCH');
  assert.strictEqual(adoptMismatch.preserve_evidence, true);

  // Negative: adoptOrphanLeaf stops when controllerDeath is not proven
  const adoptRes2 = ctrl.adoptOrphanLeaf({ ...baseAdoptArgs, controllerDead: false });
  assert.strictEqual(adoptRes2.ok, false);
  assert.strictEqual(adoptRes2.status, 'stopped');
  assert.strictEqual(adoptRes2.code, 'CONTROLLER_NOT_PROVEN_DEAD');
  assert.strictEqual(adoptRes2.preserve_evidence, true);

  // Negative: adoptOrphanLeaf stops when already adopted once
  const adoptRes3 = ctrl.adoptOrphanLeaf({ ...baseAdoptArgs, alreadyAdopted: true });
  assert.strictEqual(adoptRes3.ok, false);
  assert.strictEqual(adoptRes3.status, 'stopped');
  assert.strictEqual(adoptRes3.code, 'ADOPTION_ALREADY_CONSUMED');

  // Negative: adoptOrphanLeaf stops when generation is negative
  const adoptRes4 = ctrl.adoptOrphanLeaf({ ...baseAdoptArgs, generation: -1 });
  assert.strictEqual(adoptRes4.ok, false);
  assert.strictEqual(adoptRes4.status, 'stopped');
  assert.strictEqual(adoptRes4.code, 'ADOPTION_GENERATION_INVALID');
}

// Group 7: Executable-delta no-op vs replay/create/mirror failures
{
  console.log("Testing Group 7: Executable-delta no-op vs replay/create/mirror failures");

  const tempRepo = process.argv[3];

  // Write mock files to satisfy existsSync
  fs.writeFileSync(path.join(tempRepo, 'input.js'), 'input');
  fs.writeFileSync(path.join(tempRepo, 'out.js'), 'out');

  const baseSha = 'd'.repeat(40);
  const acceptance = 'e'.repeat(64);
  const liveBytes = { 'input.js': 'input', 'out.js': 'out' };
  const baseDeltaArgs = {
    repoRoot: tempRepo,
    allowedPathPrefixes: ['src', 'input.js', 'out.js'],
    requiredPaths: ['input.js'],
    outputPaths: ['out.js'],
    authorizedCreates: [],
    versionMirrorPaths: [],
    versionMirrorGenerator: null,
    historicalOutputs: null,
    currentBytesByPath: null,
    noOpReceipt: null,
    baseSha,
    extraDeclaredPaths: [],
  };

  // Positive: narrow required-change set is valid and succeeds (files exist)
  const deltaRes1 = ctrl.admitExecutableMissionDelta(baseDeltaArgs);
  assert.strictEqual(deltaRes1.ok, true);
  assert.strictEqual(deltaRes1.admitted, true);
  assert.strictEqual(deltaRes1.noop, false);
  assert.strictEqual(deltaRes1.narrow_required_ok, true);

  // Negative: absent output without authorized_creates (Mission strict default)
  const deltaMissingOut = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    allowedPathPrefixes: ['src', 'input.js', 'out.js', 'new'],
    outputPaths: ['new/missing-out.js'],
  });
  assert.strictEqual(deltaMissingOut.ok, false);
  assert.ok(deltaMissingOut.reason.includes('OUTPUT_MISSING_CREATE_AUTH'));

  // Positive: authorized create permits absent output
  const deltaCreateOk = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    allowedPathPrefixes: ['src', 'input.js', 'out.js', 'new'],
    outputPaths: ['new/missing-out.js'],
    authorizedCreates: ['new/missing-out.js'],
  });
  assert.strictEqual(deltaCreateOk.ok, true);

  // Negative: nonexistent declared typo without authority
  const deltaRes2 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    extraDeclaredPaths: ['typo.js'],
  });
  assert.strictEqual(deltaRes2.ok, false);
  assert.ok(deltaRes2.reason.includes('OUTPUT_MISSING_CREATE_AUTH'));

  // Negative: missing required input
  const deltaRes3 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    requiredPaths: ['nonexistent_input.js'],
  });
  assert.strictEqual(deltaRes3.ok, false);
  assert.ok(deltaRes3.reason.includes('REQUIRED_PATH_MISSING'));

  // Negative: missing version-mirror generator or closure
  const deltaRes4 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    versionMirrorPaths: ['out.js'],
    versionMirrorGenerator: null,
  });
  assert.strictEqual(deltaRes4.ok, false);
  assert.ok(deltaRes4.reason.includes('VERSION_MIRROR_GENERATOR_MISSING'));

  const deltaRes5 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    versionMirrorPaths: ['unrelated.js'],
    versionMirrorGenerator: 'generator1',
  });
  assert.strictEqual(deltaRes5.ok, false);
  assert.ok(deltaRes5.reason.includes('VERSION_MIRROR_INCOMPLETE'));

  // Negative: historical output replay without no-op receipt
  const deltaRes6 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    historicalOutputs: { 'out.js': 'out' },
    currentBytesByPath: { 'out.js': 'out' },
  });
  assert.strictEqual(deltaRes6.ok, false);
  assert.ok(deltaRes6.reason.includes('HISTORICAL_OUTPUT_REPLAY'));

  // Negative: no-op with wrong current_bytes (shape-only must not pass)
  const deltaBadBytes = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    currentBytesByPath: liveBytes,
    noOpReceipt: {
      base_sha: baseSha,
      acceptance_digest: acceptance,
      current_bytes: { 'input.js': 'input', 'out.js': 'WRONG' },
    },
  });
  assert.strictEqual(deltaBadBytes.ok, false);
  assert.ok(deltaBadBytes.reason.includes('NOOP_BYTES_MISMATCH'));

  // Positive: valid no-op receipt with exact byte binding succeeds
  const deltaRes7 = ctrl.admitExecutableMissionDelta({
    ...baseDeltaArgs,
    currentBytesByPath: liveBytes,
    noOpReceipt: {
      base_sha: baseSha,
      acceptance_digest: acceptance,
      current_bytes: liveBytes,
    },
  });
  assert.strictEqual(deltaRes7.ok, true);
  assert.strictEqual(deltaRes7.noop, true);
  assert.strictEqual(deltaRes7.dispatcher_called, false);
  assert.strictEqual(deltaRes7.mutation_attempts, 0);
  assert.strictEqual(deltaRes7.gate_attempts, 0);
}

// Group 8: PostCompact host neutrality
{
  console.log("Testing Group 8: PostCompact host neutrality");

  const reconcileFn = ({ gitCwd, root_run_id, durable, requireBoundEvidence }) => {
    assert.strictEqual(root_run_id, 'run123');
    assert.strictEqual(requireBoundEvidence, true);
    return { status: 'reconciled', reason_code: null };
  };

  const input = {
    reconcileFn,
    rootRunId: 'run123',
    gitCwd: '/mock/cwd',
    resourceInventory: [],
    probeEvidenceAccepted: true,
  };

  // Positive: runPostCompactAdapter returns production_hook_wired: false
  const pcRes1 = ctrl.runPostCompactAdapter(input);
  assert.strictEqual(pcRes1.status, 'ready');
  assert.strictEqual(pcRes1.production_hook_wired, false);
  assert.strictEqual(pcRes1.receipt.production_hook_wired, false);
  assert.strictEqual(pcRes1.receipt.probe_evidence_accepted, true);

  // Negative: reconcile failure rejects
  const failingReconcileFn = () => ({ status: 'failed', reason_code: 'corrupt_pack' });
  const pcRes2 = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: failingReconcileFn,
  });
  assert.strictEqual(pcRes2.status, 'reject');
  assert.strictEqual(pcRes2.reason_code, 'corrupt_pack');

  // Negative: resource debt rejects
  const pcRes3 = ctrl.runPostCompactAdapter({
    ...input,
    resourceInventory: [{ resource_id: 'w1', dirty: true }],
  });
  assert.strictEqual(pcRes3.status, 'reject');
  assert.strictEqual(pcRes3.reason_code, 'resource_debt_open');
}

console.log("All inline verification assertions passed successfully!");
NODE
assert_exit_code "$?" "0" "Independent Controller Discipline verification node assertions"

finalize_test
