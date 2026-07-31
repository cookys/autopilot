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
const {
  adjudicateCampaignReview,
} = require(path.join(root, 'src', 'engine', 'campaign-adjudication'));

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

  assert.throws(() => {
    ctrl.recordGateEntry(journal, {
      kind: 'full_diff_review',
      owner: 'foreign-owner',
      input: { ...gateInput, owner: 'depth-0' },
      result: { success: true },
      startedAt: '2026-07-30T11:58:00.000Z',
      finishedAt: '2026-07-30T11:59:00.000Z',
    });
  }, (err) => err.code === 'INVALID_GATE_OWNER');

  const ownerInput = { ...gateInput, owner: 'depth-0' };
  const ownerBound = ctrl.recordGateEntry(journal, {
    kind: 'focused_verification',
    owner: 'depth-0',
    input: ownerInput,
    result: { success: true },
    startedAt: '2026-07-30T11:58:00.000Z',
    finishedAt: '2026-07-30T11:59:00.000Z',
  }).journal;
  const ownerTampered = JSON.parse(JSON.stringify(ownerBound));
  ownerTampered.entries[0].owner = 'foreign-owner';
  assert.strictEqual(
    ctrl.findReusableGate(ownerTampered, 'focused_verification', ownerInput),
    null,
    'gate owner drift cannot reuse an otherwise matching result',
  );

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

  const { execFileSync } = require('child_process');
  const os = require('os');
  const recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-rec-'));
  execFileSync('git', ['init', '-q', recDir]);
  execFileSync('git', ['-C', recDir, 'config', 'user.email', 'rec@example.invalid']);
  execFileSync('git', ['-C', recDir, 'config', 'user.name', 'Rec']);
  fs.writeFileSync(path.join(recDir, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', recDir, 'add', '.']);
  execFileSync('git', ['-C', recDir, 'commit', '-qm', 'base']);
  const recBase = execFileSync('git', ['-C', recDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  // Positive: clean worktree at frozen base releases only with mechanical observation
  const cleanReceipt = ctrl.buildRecoveryReceipt({
    resourceId: 'w1',
    path: recDir,
    gitCwd: recDir,
    baseSha: recBase,
    evidenceKind: 'clean_release',
  });
  const cleanItem = {
    resource_id: 'w1',
    kind: 'worktree',
    path: recDir,
    branch: cleanReceipt.branch,
    tip: cleanReceipt.tip,
    clean: cleanReceipt.outcome.clean === true,
    dirty: cleanReceipt.outcome.dirty === true,
    terminal: cleanReceipt.outcome.terminal === true,
    identity_known: cleanReceipt.outcome.identity_known === true,
    recovery_receipt: cleanReceipt,
  };
  const debtState1 = ctrl.buildResourceDebtState([cleanItem]);
  assert.strictEqual(debtState1.blocks_dispatch, false);
  assert.strictEqual(debtState1.released.length, 1);
  assert.strictEqual(debtState1.open.length, 0);

  // Negative: caller terminalConsumed on nonexistent path is not authority
  assert.throws(() => ctrl.buildRecoveryReceipt({
    resourceId: 'ghost',
    path: '/definitely/not/a/worktree',
    evidenceKind: 'clean_release',
    terminalConsumed: true,
  }), /terminal|receipt|path|mechanical/i);

  // A caller-authored JSON file with terminal_status is not terminal
  // consumption authority, even when its raw digest is supplied exactly.
  const forgedTerminalPath = path.join(recDir, 'forged-terminal.json');
  fs.writeFileSync(forgedTerminalPath, '{"terminal_status":"success"}\n');
  const forgedTerminalRawDigest = require('crypto').createHash('sha256')
    .update(fs.readFileSync(forgedTerminalPath))
    .digest('hex');
  assert.throws(() => ctrl.buildRecoveryReceipt({
    resourceId: 'ghost-forged-terminal',
    path: '/definitely/not/a/worktree',
    evidenceKind: 'terminal_consumed',
    terminalConsumed: true,
    terminalReceiptPath: forgedTerminalPath,
    terminalReceiptDigest: forgedTerminalRawDigest,
    terminalWorkOrderPath: path.join(recDir, 'missing-work-order.json'),
  }), /Work Order|terminal/i);

  // Positive terminal consumption requires the integrity-valid consumed
  // controller Work Order, exact terminal receipt, and one bound resource row.
  const woMod = require(path.join(root, 'src/engine/work-order'));
  const terminalGhost = path.join(recDir, 'removed-terminal-worktree');
  const terminalRoot = 'terminal-recovery-root';
  const terminalNode = 'n1';
  const terminalWorkOrderId = `wo-${terminalRoot}-${terminalNode}-a1`;
  const terminalFrozen = ctrl.buildFrozenDenominator({
    projectId: terminalRoot,
    graphDigest: '7'.repeat(64),
    deliverableIds: [terminalNode],
    nodeId: terminalNode,
  });
  const terminalController = ctrl.emptyControllerState({
    frozen_denominator: terminalFrozen,
    accepted_commit: recBase,
    resource_inventory: [{
      resource_id: 'terminal-resource',
      kind: 'worktree',
      path: terminalGhost,
      worktree: terminalGhost,
      root_run_id: terminalRoot,
      work_order_id: terminalWorkOrderId,
      identity_known: true,
      terminal: true,
    }],
  });
  const terminalCommon = woMod.resolveGitCommonDir(recDir);
  const activeTerminalWorkOrder = woMod.createOrUpdateWorkOrder(terminalCommon, {
    root_run_id: terminalRoot,
    graph_node: terminalNode,
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: recBase,
    worktree: recDir,
    controller: terminalController,
  }, { bindArtifacts: false });
  assert.strictEqual(
    activeTerminalWorkOrder.status,
    'written',
    JSON.stringify(activeTerminalWorkOrder),
  );
  assert.strictEqual(
    activeTerminalWorkOrder.work_order.work_order_id,
    terminalWorkOrderId,
  );
  const exactTerminalPath = path.join(recDir, 'exact-terminal.json');
  const exactTerminal = woMod.buildControllerTerminalReceipt({
    terminalStatus: 'success',
    rootRunId: terminalRoot,
    workOrderId: terminalWorkOrderId,
    graphNode: terminalNode,
    campaignId: terminalRoot,
    acceptedCommit: recBase,
    controller: terminalController,
  });
  fs.writeFileSync(exactTerminalPath, `${JSON.stringify(exactTerminal, null, 2)}\n`);
  const consumedTerminalWorkOrder = woMod.updateWorkOrderLifecycle(
    terminalCommon,
    { path: activeTerminalWorkOrder.path },
    {
    next_action: 'terminal',
    accepted_commit: recBase,
    terminal_status: 'success',
    disposition: 'consumed',
    paths: { receipt: exactTerminalPath },
    expected_receipt: {
      path: exactTerminalPath,
      digest: exactTerminal.digest,
    },
    controller: terminalController,
    },
    {
      expectedGeneration: activeTerminalWorkOrder.work_order.generation,
      expectedCasToken: activeTerminalWorkOrder.work_order.cas_token,
      expectedControllerDigest:
        activeTerminalWorkOrder.work_order.controller.controller_digest,
      bindArtifacts: false,
      preserveOwner: true,
      gitCwd: recDir,
    },
  );
  assert.strictEqual(
    consumedTerminalWorkOrder.status,
    'written',
    JSON.stringify(consumedTerminalWorkOrder),
  );
  const terminalWorkOrderPath = activeTerminalWorkOrder.path;
  const exactTerminalRawDigest = require('crypto').createHash('sha256')
    .update(fs.readFileSync(exactTerminalPath))
    .digest('hex');
  const terminalRecovery = ctrl.buildRecoveryReceipt({
    resourceId: 'terminal-resource',
    path: terminalGhost,
    evidenceKind: 'terminal_consumed',
    terminalConsumed: true,
    terminalReceiptPath: exactTerminalPath,
    terminalReceiptDigest: exactTerminalRawDigest,
    terminalWorkOrderPath,
    terminalRootRunId: terminalRoot,
    terminalGraphNode: terminalNode,
    terminalAttempt: 1,
    terminalWorkOrderId,
    gitCwd: recDir,
  });
  assert.strictEqual(terminalRecovery.terminal_consumed, true);
  assert.strictEqual(terminalRecovery.outcome.terminal, true);
  assert.strictEqual(
    terminalRecovery.terminal_authority.work_order_digest,
    consumedTerminalWorkOrder.work_order.digest,
  );
  const arbitraryTerminalWorkOrderPath = path.join(
    recDir,
    'standalone-terminal-work-order.json',
  );
  fs.writeFileSync(
    arbitraryTerminalWorkOrderPath,
    `${JSON.stringify(consumedTerminalWorkOrder.work_order, null, 2)}\n`,
  );
  assert.throws(() => ctrl.buildRecoveryReceipt({
    resourceId: 'terminal-resource',
    path: terminalGhost,
    evidenceKind: 'terminal_consumed',
    terminalConsumed: true,
    terminalReceiptPath: exactTerminalPath,
    terminalReceiptDigest: exactTerminalRawDigest,
    terminalWorkOrderPath: arbitraryTerminalWorkOrderPath,
    terminalRootRunId: terminalRoot,
    terminalGraphNode: terminalNode,
    terminalAttempt: 1,
    terminalWorkOrderId,
    gitCwd: recDir,
  }), /canonical Git-common-dir Work Order path/i);

  // Negative: caller mechanicallyObserved on nonexistent path is not authority
  assert.throws(() => ctrl.buildRecoveryReceipt({
    resourceId: 'ghost2',
    path: '/definitely/not/a/worktree',
    evidenceKind: 'clean_release',
    mechanicallyObserved: true,
  }), /mechanical|path|gitCwd/i);

  // Negative: unique commit ahead of base cannot be clean_release with unique:false
  fs.writeFileSync(path.join(recDir, 'a.txt'), 'mutated\n');
  execFileSync('git', ['-C', recDir, 'add', '.']);
  execFileSync('git', ['-C', recDir, 'commit', '-qm', 'unique']);
  assert.throws(() => ctrl.buildRecoveryReceipt({
    resourceId: 'w-unique',
    path: recDir,
    gitCwd: recDir,
    baseSha: recBase,
    evidenceKind: 'clean_release',
  }), /clean_release|unique|clean/i);
  // Mechanical observation still surfaces unique:true when allowed via outcome fields
  // after hard-reset for remaining suite paths.
  execFileSync('git', ['-C', recDir, 'reset', '--hard', recBase]);
  // Re-mint clean receipt after reset (prior unique tip must not linger).
  {
    const r = ctrl.buildRecoveryReceipt({
      resourceId: cleanItem.resource_id,
      path: cleanItem.path,
      gitCwd: recDir,
      baseSha: recBase,
      evidenceKind: 'clean_release',
    });
    cleanItem.recovery_receipt = r;
    cleanItem.branch = r.branch;
    cleanItem.tip = r.tip;
    cleanItem.clean = r.outcome.clean === true;
    cleanItem.dirty = r.outcome.dirty === true;
    cleanItem.terminal = r.outcome.terminal === true;
    cleanItem.identity_known = r.outcome.identity_known === true;
  }

  // Negative: bare / non-canonical recovery digest string is not accepted
  const badDigestItem = {
    resource_id: 'w1',
    kind: 'worktree',
    path: recDir,
    clean: true,
    terminal: true,
    identity_known: true,
    recovery_bundle_digest: 'not-a-digest',
  };
  const debtBad = ctrl.buildResourceDebtState([badDigestItem]);
  assert.strictEqual(debtBad.blocks_dispatch, true);
  assert.strictEqual(debtBad.released.length, 0);

  // Negative: forged recovery receipt (tampered digest) blocks
  const forged = {
    ...cleanItem,
    recovery_receipt: {
      ...cleanItem.recovery_receipt,
      digest: 'f'.repeat(64),
    },
  };
  const debtForged = ctrl.buildResourceDebtState([forged]);
  assert.strictEqual(debtForged.blocks_dispatch, true);

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

  // Negative: dirty residue in open blocking debt
  const inventory3 = [
    {
      resource_id: 'w2',
      kind: 'worktree',
      dirty: true,
      identity_known: true,
    }
  ];
  const debtState3 = ctrl.buildResourceDebtState(inventory3);
  assert.strictEqual(debtState3.blocks_dispatch, true);
  assert.strictEqual(debtState3.open.length, 1);
  assert.strictEqual(debtState3.open[0].disposition, 'retained_dirty');

  // A unique active resource cannot self-authorize with terminal:true. The
  // exact persisted dispatch result receipt must bind the same resource.
  const terminalReceiptDigest = 'a'.repeat(64);
  const uniqueActive = {
    resource_id: 'w-active-unique',
    kind: 'worktree',
    path: '/tmp/w-active-unique',
    identity_known: true,
    active: true,
    unique: true,
    terminal: true,
    terminal_receipt_digest: terminalReceiptDigest,
  };
  const unboundUnique = ctrl.buildResourceDebtState([uniqueActive]);
  assert.strictEqual(unboundUnique.blocks_dispatch, true);
  assert.strictEqual(unboundUnique.open[0].disposition, 'retained_unique');
  const boundUnique = ctrl.buildResourceDebtState([uniqueActive], {
    dispatchRecords: [{
      resource_id: uniqueActive.resource_id,
      result_receipt_digest: terminalReceiptDigest,
    }],
  });
  assert.strictEqual(boundUnique.blocks_dispatch, false);
  assert.strictEqual(boundUnique.open[0].disposition, 'active');
  assert.strictEqual(boundUnique.open[0].terminal_receipt_digest, terminalReceiptDigest);

  // Durable-only inventory is explicitly not live-observed. This must remain
  // canonical JSON for terminal Work Order / manifest / result-index binding.
  const durableOnlyInventory = ctrl.reconstructOwnedInventory({
    gitCwd: null,
    rootRunId: 'root-resource-canonical',
    controller: {
      resource_inventory: [{
        resource_id: '/tmp/not-live-observed',
        kind: 'worktree',
        path: '/tmp/not-live-observed',
        identity_known: true,
      }],
    },
  });
  assert.strictEqual(durableOnlyInventory.ok, true);
  assert.strictEqual(durableOnlyInventory.inventory.length, 1);
  assert.strictEqual(durableOnlyInventory.inventory[0].live_observed, false);
  assert.doesNotThrow(() => ctrl.sha256Json(durableOnlyInventory.inventory));

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

  // Equality: projected == limit is admitted; only projected > limit blocks.
  const highWaterRes3ok = ctrl.admitHighWater({ currentOwned: 4, highWater: 4 });
  assert.strictEqual(highWaterRes3ok.ok, true);
  const highWaterRes3 = ctrl.admitHighWater({ currentOwned: 5, highWater: 4 });
  assert.strictEqual(highWaterRes3.ok, false);
  assert.strictEqual(highWaterRes3.effects, 0);
  assert.strictEqual(highWaterRes3.code, 'HIGH_WATER_EXCEEDED');

  const highWaterRes4 = ctrl.admitHighWater({ tempCapacityOk: false });
  assert.strictEqual(highWaterRes4.ok, false);
  assert.strictEqual(highWaterRes4.effects, 0);
  assert.strictEqual(highWaterRes4.code, 'TEMP_CAPACITY_EXCEEDED');
}

// Group 6: Orphan adoption — boolean flags alone never authorize
{
  console.log("Testing Group 6: Orphan proof completeness and single adoption");

  const tip = 'a'.repeat(40);
  // Boolean proof flags alone never authorize.
  const boolOnly = ctrl.adoptOrphanLeaf({
    controllerDead: true,
    leafResult: { committed: true, commit: tip },
    branchTip: tip,
    branchTree: 'b'.repeat(40),
    baseAncestryOk: true,
    scopeOk: true,
    churnOk: true,
    worktreeDigest: 'c'.repeat(64),
    generation: 0,
    alreadyAdopted: false,
  });
  assert.strictEqual(boolOnly.ok, false);
  assert.strictEqual(boolOnly.code, 'ADOPTION_BOOLEAN_FLAGS_NOT_AUTHORITY');
  assert.strictEqual(boolOnly.preserve_evidence, true);

  // Missing mechanical authorities fail closed.
  const missing = ctrl.adoptOrphanLeaf({});
  assert.strictEqual(missing.ok, false);
  assert.ok(
    missing.code === 'ADOPTION_AUTHORITY_MISSING'
    || missing.code === 'ADOPTION_BOOLEAN_FLAGS_NOT_AUTHORITY',
  );
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

  const { execFileSync } = require('child_process');
  const wo = require(path.join(root, 'src', 'engine', 'work-order'));

  const createPostCompactFixture = ({ rootRunId, withResourceDebt = false }) => {
    const repo = fs.mkdtempSync(path.join(tempRepo, 'pc-host-'));
    execFileSync('git', ['-C', repo, 'init', '-q']);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
    fs.writeFileSync(path.join(repo, 'seed'), 'seed\n');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'seed']);

    const graphNode = 'controller';
    const attempt = 1;
    const workOrderId = `wo-${rootRunId}-${graphNode}-a${attempt}`;
    const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const branch = execFileSync(
      'git',
      ['-C', repo, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
      { encoding: 'utf8' },
    ).trim();
    const resourceInventory = [];
    if (withResourceDebt) {
      const debtBranch = `${rootRunId}-owned`;
      const debtWorktree = path.join(tempRepo, `${rootRunId}-owned-worktree`);
      execFileSync(
        'git',
        ['-C', repo, 'worktree', 'add', '-q', '-b', debtBranch, debtWorktree, baseSha],
      );
      fs.writeFileSync(path.join(debtWorktree, 'dirty'), 'uncommitted\n');
      resourceInventory.push({
        resource_id: `${rootRunId}-owned-worktree`,
        kind: 'worktree',
        path: debtWorktree,
        worktree: debtWorktree,
        branch: debtBranch,
        base_sha: baseSha,
        identity_known: true,
      });
    }

    const parentage = wo.captureProcessParentage(process.pid);
    const controller = ctrl.emptyControllerState({
      phase: 'CONTROLLER',
      next_action: 'continue',
      process_parentage: parentage,
      resource_inventory: resourceInventory,
      dispatch_records: [],
      branch,
      worktree: repo,
    });
    const commonDir = wo.resolveGitCommonDir(repo);
    const authorityDir = path.join(commonDir, 'autopilot', 'postcompact-fixtures', rootRunId);
    const paths = {
      durable: path.join(authorityDir, 'durable.json'),
      checkpoint: path.join(authorityDir, 'checkpoint.json'),
      ledger: path.join(authorityDir, 'ledger.jsonl'),
      manifest: path.join(authorityDir, 'manifest.json'),
      receipt: path.join(authorityDir, 'result-index.json'),
    };
    const writtenAt = new Date().toISOString();
    wo.writeAtomicJson(paths.durable, {
      schema_version: 1,
      artifact_type: 'controller_durable_state',
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt,
      work_order_id: workOrderId,
      campaign_id: rootRunId,
      icc_campaign_id: rootRunId,
      controller_digest: controller.controller_digest,
      written_at: writtenAt,
    });
    wo.writeAtomicJson(paths.checkpoint, {
      schema_version: 1,
      artifact_type: 'controller_checkpoint',
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt,
      work_order_id: workOrderId,
      controller,
      written_at: writtenAt,
    });
    wo.writeAtomicJson(paths.manifest, {
      schema_version: 1,
      artifact_type: 'controller_dispatch_manifest_index',
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt,
      work_order_id: workOrderId,
      controller_digest: controller.controller_digest,
      entries: controller.dispatch_records,
      written_at: writtenAt,
    });
    wo.writeAtomicJson(paths.receipt, {
      schema_version: 1,
      artifact_type: 'controller_dispatch_result_index',
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt,
      work_order_id: workOrderId,
      controller_digest: controller.controller_digest,
      entries: controller.resource_inventory,
      written_at: writtenAt,
    });
    fs.writeFileSync(paths.ledger, `${JSON.stringify({
      schema_version: 1,
      event: 'controller_heartbeat',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      controller_digest: controller.controller_digest,
      at: writtenAt,
    })}\n`);

    const written = wo.createOrUpdateWorkOrder(commonDir, {
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt,
      role: 'controller',
      owner: parentage.owner,
      branch,
      base_sha: baseSha,
      worktree: repo,
      paths,
      phase_cursor: 'CONTROLLER',
      next_action: 'continue',
      controller,
    }, { bindArtifacts: true });
    assert.strictEqual(written.status, 'written');
    return {
      reconcileFn: wo.reconcilePostCompact,
      rootRunId,
      gitCwd: repo,
      workOrder: written.work_order,
      probeEvidenceAccepted: true,
    };
  };

  const input = createPostCompactFixture({ rootRunId: 'run123' });

  // Positive: runPostCompactAdapter returns production_hook_wired: false
  // with exactly one mechanically recovered, integrity-valid controller Work Order.
  const pcRes1 = ctrl.runPostCompactAdapter(input);
  assert.strictEqual(pcRes1.status, 'ready');
  assert.strictEqual(pcRes1.production_hook_wired, false);
  assert.strictEqual(pcRes1.receipt.production_hook_wired, false);
  assert.strictEqual(pcRes1.receipt.probe_evidence_accepted, true);

  // Negative: empty classification / missing controller WO never ready
  const pcZero = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: () => ({ status: 'reconciled', classifications: [] }),
  });
  assert.strictEqual(pcZero.status, 'reject');
  assert.strictEqual(pcZero.reason_code, 'controller_work_order_missing');

  // Negative: caller inventory cannot replace mechanically reconstructed authority.
  const pcNoDig = ctrl.runPostCompactAdapter({
    ...input,
    resourceInventory: [{ resource_id: 'x', dirty: true }],
  });
  assert.strictEqual(pcNoDig.status, 'reject');
  assert.strictEqual(pcNoDig.reason_code, 'inventory_crosscheck_mismatch');

  // Negative: reconcile failure rejects
  const failingReconcileFn = () => ({ status: 'failed', reason_code: 'corrupt_pack' });
  const pcRes2 = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: failingReconcileFn,
  });
  assert.strictEqual(pcRes2.status, 'reject');
  assert.strictEqual(pcRes2.reason_code, 'corrupt_pack');

  // Negative: undefined/null/malformed reconcile never becomes ready
  const pcUndef = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: () => undefined,
  });
  assert.strictEqual(pcUndef.status, 'reject');
  assert.strictEqual(pcUndef.reason_code, 'reconcile_missing');
  const pcNull = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: () => null,
  });
  assert.strictEqual(pcNull.status, 'reject');
  assert.strictEqual(pcNull.reason_code, 'reconcile_missing');
  const pcThrow = ctrl.runPostCompactAdapter({
    ...input,
    reconcileFn: () => { throw new Error('boom'); },
  });
  assert.strictEqual(pcThrow.status, 'reject');
  assert.strictEqual(pcThrow.reason_code, 'reconcile_threw');

  // Negative: resource debt rejects
  const debtInput = createPostCompactFixture({
    rootRunId: 'run-debt',
    withResourceDebt: true,
  });
  const pcRes3 = ctrl.runPostCompactAdapter(debtInput);
  assert.strictEqual(pcRes3.status, 'reject');
  assert.strictEqual(pcRes3.reason_code, 'resource_debt_open');
}

// Group 10: Production Work Order controller CAS + multi-node denominator + ticket stability
{
  console.log("Testing Group 10: Production WO CAS / multi-node / tickets");
  const { execFileSync } = require('child_process');
  const os = require('os');
  const wo = require(path.join(root, 'src', 'engine', 'work-order'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-wo-ind-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'f'), 'x');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'i']);
  const common = wo.resolveGitCommonDir(dir);
  const multi = ctrl.buildFrozenDenominator({
    projectId: 'camp-multi',
    graphDigest: 'c'.repeat(64),
    deliverableIds: ['node-a', 'node-b', 'node-c'],
    nodeId: 'node-a',
  });
  assert.strictEqual(multi.deliverable_count, 3);
  assert.deepStrictEqual(multi.deliverable_ids, ['node-a', 'node-b', 'node-c']);
  let state = ctrl.emptyControllerState({
    frozen_denominator: multi,
    repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 4 }),
  });
  const written = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'camp-multi',
    graph_node: 'node-a',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'main',
    base_sha: 'd'.repeat(40),
    worktree: dir,
    paths: { checkpoint: path.join(dir, 'cp.json') },
    controller: state,
  }, { bindArtifacts: false });
  assert.strictEqual(written.status, 'written');
  assert.strictEqual(written.work_order.generation, 1);
  const woId = written.work_order.work_order_id;
  // Append progress + repair ticket + budget, same WO identity, monotonic gen.
  state = ctrl.appendRepairTicket(state, {
    generation: 1,
    finding_ids: ['F1'],
    review_digest: 'e'.repeat(64),
  });
  const ticketAgain = ctrl.appendRepairTicket(state, {
    generation: 1,
    finding_ids: ['F1'],
    review_digest: 'e'.repeat(64),
  });
  assert.strictEqual(ticketAgain.repair_tickets.length, 1, 'ticket idempotent');
  const receipt = ctrl.buildProgressReceipt({
    frozenDenominator: multi,
    completedDeliverables: ['node-a'],
    generation: 1,
    phase: 'FINDINGS',
  });
  state = {
    ...state,
    progress_receipts: [receipt],
    repair_budget_usage: ctrl.applyBudgetUsage(state.repair_budget_usage, { model_calls: 1 }),
  };
  state.controller_digest = ctrl.controllerStateDigest(state);
  const updated = wo.createOrUpdateWorkOrder(common, {
    ...written.work_order,
    controller: state,
    next_action: 'repair',
  }, {
    expectedGeneration: written.work_order.generation,
    expectedCasToken: written.work_order.cas_token,
    expectedControllerDigest: written.work_order.controller.controller_digest,
    bindArtifacts: false,
  });
  assert.strictEqual(updated.status, 'written');
  assert.strictEqual(updated.work_order.work_order_id, woId);
  assert.strictEqual(updated.work_order.generation, 2);
  assert.strictEqual(
    updated.work_order.controller.frozen_denominator.digest,
    multi.digest,
    'resume retains denominator digest',
  );
  // Incomplete CAS (missing token/digest) rejects before generation compare.
  const incomplete = wo.createOrUpdateWorkOrder(common, {
    ...updated.work_order,
    controller: state,
  }, {
    expectedGeneration: 1,
    bindArtifacts: false,
  });
  assert.strictEqual(incomplete.status, 'reject');
  assert.strictEqual(incomplete.reason_code, 'cas_incomplete');
  // Full CAS with wrong generation is cas_conflict.
  const conflict = wo.createOrUpdateWorkOrder(common, {
    ...updated.work_order,
    controller: state,
  }, {
    expectedGeneration: 1,
    expectedCasToken: updated.work_order.cas_token,
    expectedControllerDigest: updated.work_order.controller.controller_digest,
    bindArtifacts: false,
  });
  assert.strictEqual(conflict.status, 'reject');
  assert.strictEqual(conflict.reason_code, 'cas_conflict');
  // Full-record digest is an additional CAS fence for authority-sensitive
  // mutations such as orphan adoption.
  const digestConflict = wo.createOrUpdateWorkOrder(common, {
    ...updated.work_order,
    controller: state,
  }, {
    expectedGeneration: updated.work_order.generation,
    expectedWorkOrderDigest: '0'.repeat(64),
    expectedCasToken: updated.work_order.cas_token,
    expectedControllerDigest: updated.work_order.controller.controller_digest,
    bindArtifacts: false,
  });
  assert.strictEqual(digestConflict.status, 'reject');
  assert.strictEqual(digestConflict.reason_code, 'cas_conflict');
  assert.match(digestConflict.reason, /work order digest/i);
  // Tamper refuse (digest CAS fails without omitting fields).
  const live = JSON.parse(fs.readFileSync(updated.path, 'utf8'));
  const priorDigest = live.controller.controller_digest;
  live.controller.phase = 'TAMPERED';
  fs.writeFileSync(updated.path, `${JSON.stringify(live, null, 2)}\n`);
  const tampered = wo.createOrUpdateWorkOrder(common, {
    ...live,
    controller: state,
  }, {
    expectedGeneration: live.generation,
    expectedCasToken: live.cas_token,
    expectedControllerDigest: priorDigest,
    bindArtifacts: false,
  });
  assert.strictEqual(tampered.status, 'reject');
  // Projected budget equality blocks next spend.
  const atLimit = ctrl.checkJointRepairBudget(
    { ...ctrl.emptyBudgetUsage(), model_calls: 2 },
    { model_calls: 2 },
    { projectedDelta: { model_calls: 1 } },
  );
  assert.strictEqual(atLimit.ok, false);
  assert.strictEqual(atLimit.allow_spend, false);
  for (const axis of [
    'model_calls',
    'fresh_input_bytes',
    'fresh_input_tokens',
    'finding_recurrence',
  ]) {
    assert.throws(
      () => ctrl.applyBudgetUsage(ctrl.emptyBudgetUsage(), { [axis]: -1 }),
      (error) => error.code === 'INVALID_BUDGET_DELTA',
      `${axis} negative delta rejects`,
    );
  }
  assert.throws(
    () => ctrl.applyBudgetUsage(ctrl.emptyBudgetUsage(), { elapsed_wall_ms: -1 }),
    (error) => error.code === 'INVALID_BUDGET_OBSERVATION',
  );
  assert.throws(
    () => ctrl.applyBudgetUsage(ctrl.emptyBudgetUsage(), {
      owned_worktrees_absolute: -1,
    }),
    (error) => error.code === 'INVALID_BUDGET_OBSERVATION',
  );
  const monotonicHighWater = ctrl.applyBudgetUsage({
    ...ctrl.emptyBudgetUsage(),
    elapsed_wall_ms: 9,
    owned_worktrees: 4,
  }, {
    elapsed_wall_ms: 0,
    owned_worktrees_absolute: 0,
  });
  assert.strictEqual(monotonicHighWater.elapsed_wall_ms, 9);
  assert.strictEqual(monotonicHighWater.owned_worktrees, 4);

  // Production stale disposition: the receipt is minted from the prior live
  // Work Order, included in the new canonical body, and rejected if either its
  // exact shape or prior-generation digest authority is altered.
  const cleanBase = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const deadOwner = {
    pid: 2147483646,
    process_start_time: 1,
    pgid: 2147483646,
    sid: 2147483646,
    kind: 'controller',
  };
  const stale = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'stale-receipt-root',
    graph_node: 'node-a',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: cleanBase,
    worktree: dir,
    owner: deadOwner,
    paths: {},
  }, {
    bindArtifacts: false,
    updateLifecycle: false,
  });
  assert.strictEqual(stale.status, 'written');
  const reconciled = wo.reconcilePostCompact({
    commonDir: common,
    gitCwd: dir,
    root_run_id: 'stale-receipt-root',
    requireBoundEvidence: false,
  });
  assert.strictEqual(reconciled.status, 'reconciled');
  assert.strictEqual(reconciled.classifications[0].classification, 'stale_dispositioned');
  const sealedStale = wo.listWorkOrders(common, 'stale-receipt-root')[0].work_order;
  assert.ok(sealedStale.disposition_receipt);
  assert.strictEqual(
    wo.classifyWorkOrder(sealedStale, {
      gitCwd: dir,
      workOrderPath: stale.path,
      requireBoundEvidence: false,
    }).classification,
    'stale_dispositioned',
  );
  const forgedDisposition = JSON.parse(JSON.stringify(sealedStale));
  forgedDisposition.disposition_receipt.work_order_digest = 'f'.repeat(64);
  forgedDisposition.digest = wo.workOrderDigest(forgedDisposition);
  fs.writeFileSync(stale.path, `${JSON.stringify(forgedDisposition, null, 2)}\n`);
  const forgedListed = wo.listWorkOrders(common, 'stale-receipt-root')[0];
  assert.strictEqual(forgedListed.error.reason_code, 'disposition_receipt_digest_mismatch');
  const extraDisposition = JSON.parse(JSON.stringify(sealedStale));
  extraDisposition.disposition_receipt.unsealed = true;
  extraDisposition.digest = wo.workOrderDigest(extraDisposition);
  fs.writeFileSync(stale.path, `${JSON.stringify(extraDisposition, null, 2)}\n`);
  const extraListed = wo.listWorkOrders(common, 'stale-receipt-root')[0];
  assert.strictEqual(extraListed.error.reason_code, 'disposition_receipt_invalid');

  // C2: public lifecycle patches cannot mint stale/consumed tombstones.
  const liveLifecycle = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'live-lifecycle-root',
    graph_node: 'node-live',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: cleanBase,
    worktree: dir,
    paths: {},
  }, { bindArtifacts: false });
  assert.strictEqual(liveLifecycle.status, 'written');
  const bareStale = wo.updateWorkOrderLifecycle(common, {
    path: liveLifecycle.path,
  }, {
    disposition: 'stale_dispositioned',
    terminal_status: 'aborted',
  }, {
    expectedGeneration: liveLifecycle.work_order.generation,
    expectedCasToken: liveLifecycle.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(bareStale.status, 'reject');
  const bareConsumed = wo.updateWorkOrderLifecycle(common, {
    path: liveLifecycle.path,
  }, {
    disposition: 'consumed',
    terminal_status: 'success',
  }, {
    expectedGeneration: liveLifecycle.work_order.generation,
    expectedCasToken: liveLifecycle.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(bareConsumed.status, 'reject');
  const stillActive = wo.readJsonStrict(liveLifecycle.path).value;
  assert.strictEqual(stillActive.disposition, null);
  assert.strictEqual(stillActive.terminal_status, null);
  const duplicateClaim = wo.claimDispatchCas(common, {
    root_run_id: 'live-lifecycle-root',
    graph_node: 'node-live',
    attempt: 1,
    role: 'controller',
    next_action: 'dispatch',
  }, {
    gitCwd: dir,
    bindArtifacts: false,
  });
  assert.notStrictEqual(duplicateClaim.status, 'claimed');
  assert.strictEqual(duplicateClaim.duplicate_dispatch, 0);

  const makeDeadWorkOrder = (rootRunId, graphNode = 'node-dead') => (
    wo.createOrUpdateWorkOrder(common, {
      root_run_id: rootRunId,
      graph_node: graphNode,
      attempt: 1,
      role: 'controller',
      next_action: 'continue',
      branch: 'master',
      base_sha: cleanBase,
      worktree: dir,
      owner: deadOwner,
      paths: {},
    }, {
      bindArtifacts: false,
      updateLifecycle: false,
    })
  );
  const staleA = makeDeadWorkOrder('closed-stale-a');
  const staleB = makeDeadWorkOrder('closed-stale-b');
  const staleAClass = wo.classifyWorkOrder(staleA.work_order, {
    gitCwd: dir,
    workOrderPath: staleA.path,
    requireBoundEvidence: false,
  });
  assert.strictEqual(staleAClass.classification, 'stale_dispositioned');
  const staleReceiptA = {
    schema_version: 1,
    artifact_type: 'work_order_disposition_receipt',
    disposition: 'stale_dispositioned',
    work_order_id: staleA.work_order.work_order_id,
    root_run_id: staleA.work_order.root_run_id,
    graph_node: staleA.work_order.graph_node,
    attempt: staleA.work_order.attempt,
    generation: staleA.work_order.generation,
    work_order_digest: staleA.work_order.digest,
    cas_token: staleA.work_order.cas_token,
    observation_digest: staleAClass.stale_observation_digest,
    issued_at: new Date().toISOString(),
  };
  staleReceiptA.digest = wo.sha256Json(staleReceiptA);
  const missingReceipt = wo.updateWorkOrderLifecycle(common, {
    path: staleA.path,
  }, {
    disposition: 'stale_dispositioned',
    terminal_status: 'aborted',
  }, {
    expectedGeneration: staleA.work_order.generation,
    expectedCasToken: staleA.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(missingReceipt.status, 'reject');
  const replayedReceipt = wo.updateWorkOrderLifecycle(common, {
    path: staleB.path,
  }, {
    disposition: 'stale_dispositioned',
    terminal_status: 'aborted',
    disposition_receipt: staleReceiptA,
  }, {
    expectedGeneration: staleB.work_order.generation,
    expectedCasToken: staleB.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(replayedReceipt.status, 'reject');
  const foreignReceipt = JSON.parse(JSON.stringify(staleReceiptA));
  foreignReceipt.root_run_id = 'foreign-root';
  delete foreignReceipt.digest;
  foreignReceipt.digest = wo.sha256Json(foreignReceipt);
  const foreignTransition = wo.updateWorkOrderLifecycle(common, {
    path: staleA.path,
  }, {
    disposition: 'stale_dispositioned',
    terminal_status: 'aborted',
    disposition_receipt: foreignReceipt,
  }, {
    expectedGeneration: staleA.work_order.generation,
    expectedCasToken: staleA.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(foreignTransition.status, 'reject');
  const validStaleTransition = wo.updateWorkOrderLifecycle(common, {
    path: staleA.path,
  }, {
    disposition: 'stale_dispositioned',
    terminal_status: 'aborted',
    disposition_receipt: staleReceiptA,
  }, {
    expectedGeneration: staleA.work_order.generation,
    expectedCasToken: staleA.work_order.cas_token,
    bindArtifacts: false,
    preserveOwner: true,
    gitCwd: dir,
  });
  assert.strictEqual(validStaleTransition.status, 'written', JSON.stringify(validStaleTransition));

  const unknownIdentity = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'unknown-liveness-root',
    graph_node: 'node-unknown',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: cleanBase,
    worktree: dir,
    owner: {
      pid: 2147483645,
      process_start_time: null,
      pgid: null,
      sid: null,
      kind: 'controller',
    },
    paths: {},
  }, {
    bindArtifacts: false,
    updateLifecycle: false,
  });
  assert.strictEqual(unknownIdentity.status, 'written');
  const unknownReconcile = wo.reconcilePostCompact({
    commonDir: common,
    gitCwd: dir,
    root_run_id: 'unknown-liveness-root',
    requireBoundEvidence: false,
  });
  assert.strictEqual(unknownReconcile.classifications[0].classification, 'orphan_blocked');
  assert.strictEqual(
    unknownReconcile.classifications[0].reason_code,
    'owner_identity_incomplete',
  );

  const dirtyWork = makeDeadWorkOrder('dirty-stale-root', 'node-dirty');
  fs.writeFileSync(path.join(dir, 'dirty-untracked'), 'dirty\n');
  const dirtyReconcile = wo.reconcilePostCompact({
    commonDir: common,
    gitCwd: dir,
    root_run_id: 'dirty-stale-root',
    requireBoundEvidence: false,
  });
  assert.strictEqual(dirtyReconcile.classifications[0].classification, 'orphan_blocked');
  assert.strictEqual(dirtyReconcile.classifications[0].reason_code, 'worktree_dirty');
  fs.unlinkSync(path.join(dir, 'dirty-untracked'));

  const uniqueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-wo-unique-'));
  execFileSync('git', ['-C', uniqueDir, 'init', '-q']);
  execFileSync('git', ['-C', uniqueDir, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', uniqueDir, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(uniqueDir, 'f'), 'base\n');
  execFileSync('git', ['-C', uniqueDir, 'add', '.']);
  execFileSync('git', ['-C', uniqueDir, 'commit', '-qm', 'base']);
  const uniqueBase = execFileSync('git', ['-C', uniqueDir, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  fs.writeFileSync(path.join(uniqueDir, 'f'), 'unique\n');
  execFileSync('git', ['-C', uniqueDir, 'add', '.']);
  execFileSync('git', ['-C', uniqueDir, 'commit', '-qm', 'unique']);
  const uniqueCommon = wo.resolveGitCommonDir(uniqueDir);
  const uniqueWork = wo.createOrUpdateWorkOrder(uniqueCommon, {
    root_run_id: 'unique-stale-root',
    graph_node: 'node-unique',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: uniqueBase,
    worktree: uniqueDir,
    owner: deadOwner,
    paths: {},
  }, {
    bindArtifacts: false,
    updateLifecycle: false,
  });
  assert.strictEqual(uniqueWork.status, 'written');
  const uniqueReconcile = wo.reconcilePostCompact({
    commonDir: uniqueCommon,
    gitCwd: uniqueDir,
    root_run_id: 'unique-stale-root',
    requireBoundEvidence: false,
  });
  assert.strictEqual(uniqueReconcile.classifications[0].classification, 'orphan_blocked');
  assert.strictEqual(uniqueReconcile.classifications[0].reason_code, 'head_ahead');

  const liveLeaseWork = makeDeadWorkOrder('live-lease-root', 'node-lease');
  const liveLeaseIdentity = wo.captureProcessIdentity(process.pid);
  wo.writeAtomicJson(wo.leasePathFor(liveLeaseWork.path), {
    schema_version: 1,
    ...liveLeaseIdentity,
    nonce: 'live-lease',
    created_at: new Date().toISOString(),
  });
  const liveLeaseReconcile = wo.reconcilePostCompact({
    commonDir: common,
    gitCwd: dir,
    root_run_id: 'live-lease-root',
    requireBoundEvidence: false,
  });
  assert.strictEqual(liveLeaseReconcile.classifications[0].classification, 'orphan_blocked');
  assert.strictEqual(liveLeaseReconcile.classifications[0].reason_code, 'lease_live');

  // C4: admission compares the caller to the exact current persisted fence
  // while holding that Work Order lock.
  let hotController = ctrl.emptyControllerState({
    frozen_denominator: multi,
    repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 4 }),
  });
  const hotWork = wo.createOrUpdateWorkOrder(common, {
    root_run_id: 'hot-admit-root',
    graph_node: 'node-hot',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: cleanBase,
    worktree: dir,
    paths: {},
    controller: hotController,
  }, { bindArtifacts: false });
  assert.strictEqual(hotWork.status, 'written');
  const admitArgs = (record, controller = record.controller) => ({
    gitCwd: dir,
    controller,
    rootRunId: record.root_run_id,
    graphNode: record.graph_node,
    attempt: record.attempt,
    workOrderId: record.work_order_id,
    workOrderGeneration: record.generation,
    workOrderCasToken: record.cas_token,
    expectedWorkOrderDigest: record.digest,
    expectedControllerDigest: record.controller.controller_digest,
    baseSha: cleanBase,
  });
  const currentAdmission = ctrl.admitControllerEffects(admitArgs(hotWork.work_order));
  assert.strictEqual(currentAdmission.ok, true, JSON.stringify(currentAdmission));
  const oldHotWork = JSON.parse(JSON.stringify(hotWork.work_order));
  hotController = {
    ...hotController,
    phase: 'HOT_N_PLUS_ONE',
  };
  hotController.controller_digest = ctrl.controllerStateDigest(hotController);
  const hotNext = wo.createOrUpdateWorkOrder(common, {
    ...hotWork.work_order,
    controller: hotController,
    next_action: 'continue',
  }, {
    expectedGeneration: hotWork.work_order.generation,
    expectedCasToken: hotWork.work_order.cas_token,
    expectedControllerDigest: hotWork.work_order.controller.controller_digest,
    bindArtifacts: false,
  });
  assert.strictEqual(hotNext.status, 'written');
  const staleAdmission = ctrl.admitControllerEffects(admitArgs(
    oldHotWork,
    oldHotWork.controller,
  ));
  assert.strictEqual(staleAdmission.ok, false);
  assert.strictEqual(staleAdmission.effects, 0);
  assert.strictEqual(staleAdmission.code, 'CONTROLLER_WORK_ORDER_FENCE_STALE');
  const nextAdmission = ctrl.admitControllerEffects(admitArgs(hotNext.work_order));
  assert.strictEqual(nextAdmission.ok, true, JSON.stringify(nextAdmission));
  const wrongCasAdmission = ctrl.admitControllerEffects({
    ...admitArgs(hotNext.work_order),
    workOrderCasToken: 'foreign-cas',
  });
  assert.strictEqual(wrongCasAdmission.ok, false);
  assert.strictEqual(wrongCasAdmission.effects, 0);
  const wrongIdAdmission = ctrl.admitControllerEffects({
    ...admitArgs(hotNext.work_order),
    workOrderId: 'foreign-work-order',
  });
  assert.strictEqual(wrongIdAdmission.ok, false);
  assert.strictEqual(wrongIdAdmission.effects, 0);
  const wrongRootAdmission = ctrl.admitControllerEffects({
    ...admitArgs(hotNext.work_order),
    rootRunId: 'foreign-root',
  });
  assert.strictEqual(wrongRootAdmission.ok, false);
  assert.strictEqual(wrongRootAdmission.effects, 0);
}

// Group 11: Gate reuse counters + six-axis budget + transcript exact identity
// + PostCompact mechanical inventory + orphan CAS adopt-once.
{
  console.log('Testing Group 11: production counters / budget / inventory / orphan');
  const { execFileSync, spawn } = require('child_process');
  const os = require('os');
  const { runCampaignComposition } = require(path.join(root, 'src/engine/campaign-composition'));
  const {
    canonicalDigest,
  } = require(path.join(root, 'src/engine/campaign-verification'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-g11-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'i']);
  const base = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', dir, 'rev-parse', `${base}^{tree}`], { encoding: 'utf8' }).trim();
  const frozen = ctrl.buildFrozenDenominator({
    projectId: 'g11',
    graphDigest: 'a'.repeat(64),
    deliverableIds: ['n1', 'n2'],
    nodeId: 'n1',
  });
  let verifyCalls = 0;
  let reviewCalls = 0;
  let panelCalls = 0;
  let implementCalls = 0;
  let focusedReviewCalls = 0;
  let fullSuiteCalls = 0;
  const fullSuiteCommandDigest = '7'.repeat(64);
  const verificationArgvHash = '1'.repeat(64);
  let verificationEnvFingerprint = '2'.repeat(64);
  let reviewSpecDigest = '3'.repeat(64);
  let reviewDiffDigest = '4'.repeat(64);
  let reviewerModel = 'reviewer-a';
  let focusedSupplementDigest = '9'.repeat(64);
  let jointReviewRosterDigest = '5'.repeat(64);
  const verificationRequestDigest = () => canonicalDigest({
    tree_sha: tree,
    argv_hash: verificationArgvHash,
    env_fingerprint: verificationEnvFingerprint,
  });
  const gateMaterialInput = () => ({
    fullSuiteCommandDigest,
    verificationArgvHash,
    verificationEnvFingerprint,
    fullSuiteArgvHash: verificationArgvHash,
    fullSuiteEnvFingerprint: verificationEnvFingerprint,
    jointReviewRosterDigest,
    requireGateMaterialAuthority: true,
  });
  let preEffectCalls = 0;
  const preEffectWorktreeProjection = [];
  const promptPath = path.join(dir, 'prompt.md');
  fs.writeFileSync(promptPath, 'impl\n');
  const seat = () => {
    const s = {
      schema_version: 1,
      artifact_type: 'implementation_campaign_final_panel_seat',
      seat_index: 1,
      runner: 'f', model: 'm', effort: 'high', endpoint: null, family: 'f',
      status: 'reviewed', verdict: 'SHIP-AS-IS', review_digest: 'f'.repeat(64), reason: null,
    };
    s.receipt_digest = canonicalDigest(s);
    return s;
  };
  const adapters = {
    preflight: () => ({ passed: true }),
    preEffectAdmit: ({ wouldCreateWorktree }) => {
      preEffectCalls += 1;
      preEffectWorktreeProjection.push(wouldCreateWorktree === true);
      return {
        ok: true,
        inventory: [],
        inventory_digest: ctrl.sha256Json([]),
        owned_worktrees: 0,
        debt: { blocks_dispatch: false, open: [], released: [] },
      };
    },
    implement: () => {
      implementCalls += 1;
      return {
        committed: true, commit: base, tree_sha: tree, base_sha: base,
        dispatcher_called: true, model_calls: 1, fresh_input_bytes: 5,
      };
    },
    scopeCheck: () => ({ passed: true }),
    verify: () => {
      verifyCalls += 1;
      return {
        passed: true,
        receipt_digest: 'c'.repeat(64),
        tree_sha: tree,
        argv_hash: verificationArgvHash,
        env_fingerprint: verificationEnvFingerprint,
        request_digest: verificationRequestDigest(),
      };
    },
    prepareReview: (reviewPayload) => ({
      prepared: true,
      authority: {
        schema_version: 1,
        artifact_type: 'controller_full_diff_review_input',
        candidate_ref: reviewPayload.candidate.commit || reviewPayload.candidate.tree_sha,
        candidate_tree_sha: reviewPayload.candidate.tree_sha,
        base_sha: reviewPayload.candidate.base_sha,
        diff_digest: reviewDiffDigest,
        spec_digest: reviewSpecDigest,
        review_input_digest: canonicalDigest(reviewPayload),
        reviewer: {
          runner: 'test-reviewer',
          model: reviewerModel,
          effort: 'high',
          endpoint: null,
        },
      },
      diff_file: null,
      spec_file: promptPath,
    }),
    review: () => {
      reviewCalls += 1;
      return {
        reviewed: true, success: true, review_input_mode: 'full_diff_generation',
        review_digest: 'd'.repeat(64), findings: '[]', verdict: 'SHIP-AS-IS',
      };
    },
    focusedReview: () => {
      focusedReviewCalls += 1;
      return {
        reviewed: true,
        success: true,
        model_calls: 1,
        fresh_input_bytes: 7,
        review_digest: focusedSupplementDigest,
      };
    },
    fullSuite: () => {
      fullSuiteCalls += 1;
      return {
        executed: true,
        passed: true,
        model_calls: 0,
        fresh_input_bytes: 0,
        command_digest: fullSuiteCommandDigest,
        candidate_tree_sha: tree,
        argv_hash: verificationArgvHash,
        env_fingerprint: verificationEnvFingerprint,
        request_digest: verificationRequestDigest(),
        receipt_digest: '8'.repeat(64),
      };
    },
    adjudicate: ({ review }) => adjudicateCampaignReview({ review }),
    convergence: () => ({ passed: true }),
    finalPanel: () => {
      panelCalls += 1;
      const s = seat();
      return {
        reviewed: true,
        verdict: 'SHIP-AS-IS',
        findings: '[]',
        review_digest: 'f'.repeat(64),
        sealed_min_panel_size: 1,
        final_panel_count: 1,
        final_panel_seat_receipts: [s],
      };
    },
  };
  const ctrl0 = ctrl.emptyControllerState({
    frozen_denominator: frozen,
    started_at_ms: Date.now() - 1000,
    repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 8 }),
  });
  const r1 = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: ctrl0,
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    ...gateMaterialInput(),
  }, adapters);
  assert.strictEqual(r1.status, 'ready', JSON.stringify(r1));
  const terminalBody = { ...r1 };
  delete terminalBody.receipt_digest;
  assert.strictEqual(
    r1.receipt_digest,
    canonicalDigest(terminalBody),
    'terminal receipt digest covers its complete enumerable body exactly once',
  );
  assert.deepStrictEqual(Object.keys(r1).sort(), [
    'artifact_type',
    'candidate_tree_sha',
    'final_panel_count',
    'final_panel_seat_receipts',
    'follow_up',
    'lifecycle_receipt_ref',
    'receipt_digest',
    'rejected_findings',
    'repair_generations',
    'schema_version',
    'sealed_min_panel_size',
    'status',
    'trace',
    'unresolved_final_findings',
    'verification_receipt_digest',
  ]);
  assert.ok(r1.controller, 'Engine-readable controller metadata remains available');
  assert.strictEqual(
    Object.prototype.propertyIsEnumerable.call(r1, 'controller'),
    false,
    'controller metadata cannot mutate the serialized terminal schema/digest',
  );
  assert.strictEqual(
    r1.controller.dispatch_records.filter((record) => (
      record.kind === 'implementation'
    )).length,
    1,
    'ordinary effectful implementation is charged/recorded exactly once',
  );
  assert.strictEqual(
    r1.controller.dispatch_records.find((record) => (
      record.kind === 'implementation'
    )).model_calls,
    1,
  );

  const honestNoOp = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: ctrl.emptyControllerState({
      frozen_denominator: frozen,
      started_at_ms: Date.now() - 1000,
      repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 8 }),
    }),
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
  }, {
    ...adapters,
    implement: () => ({
      status: 'no_op',
      no_op: true,
      committed: false,
      commit: null,
      candidate_ref: null,
      tree_sha: null,
      worktree: null,
      dispatcher_called: false,
      model_calls: 0,
      mutation_attempts: 0,
      gate_attempts: 0,
      resources_created: 0,
      zero_diff_receipt_digest: '6'.repeat(64),
    }),
  });
  assert.strictEqual(honestNoOp.status, 'no_op', JSON.stringify(honestNoOp));
  assert.strictEqual(honestNoOp.dispatcher_called, false);
  assert.strictEqual(honestNoOp.mutation_attempts, 0);
  assert.strictEqual(honestNoOp.gate_attempts, 0);
  assert.strictEqual(honestNoOp.resources_created, 0);
  assert.strictEqual(honestNoOp.controller.repair_budget_usage.model_calls, 0);

  const fakeNoOp = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: ctrl.emptyControllerState({
      frozen_denominator: frozen,
      started_at_ms: Date.now() - 1000,
      repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 8 }),
    }),
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
  }, {
    ...adapters,
    implement: () => ({
      status: 'no_op',
      no_op: true,
      committed: false,
      commit: base,
      candidate_ref: base,
      tree_sha: tree,
      worktree: dir,
      dispatcher_called: false,
      model_calls: 0,
      mutation_attempts: 0,
      gate_attempts: 0,
      resources_created: 0,
      zero_diff_receipt_digest: '6'.repeat(64),
    }),
  });
  assert.strictEqual(fakeNoOp.status, 'blocked', JSON.stringify(fakeNoOp));
  assert.strictEqual(fakeNoOp.code, 'DISPATCHER_NO_EFFECT_CONTRADICTION');
  assert.strictEqual(fakeNoOp.charged, true);
  assert.strictEqual(fakeNoOp.controller.repair_budget_usage.model_calls, 1);
  assert.strictEqual(implementCalls, 1, 'initial implementation called exactly once');
  assert.strictEqual(verifyCalls, 1, 'focused verification called exactly once');
  assert.strictEqual(reviewCalls, 1, 'full-diff review called exactly once');
  assert.strictEqual(focusedReviewCalls, 1, 'focused supplement called exactly once');
  assert.strictEqual(fullSuiteCalls, 1, 'full suite called exactly once');
  assert.strictEqual(panelCalls, 1, 'joint panel called exactly once');
  assert.strictEqual(
    preEffectCalls,
    8,
    'six real first-pass effects plus two no-op attempts each have one pre-effect gate',
  );
  assert.deepStrictEqual(
    preEffectWorktreeProjection,
    [true, true, false, false, true, false, true, true],
    'implementation, verification, reviews, suite, joint, and no-op projections are exact',
  );
  const firstEffectStages = (r1.controller.audit_events || [])
    .filter((event) => event.event === 'controller_effect_invoked')
    .map((event) => event.stage);
  assert.deepStrictEqual(firstEffectStages, [
    'implementation',
    'focused_verification',
    'full_diff_review',
    'focused_review_supplement',
    'full_suite',
    'joint_review',
  ]);
  const fullDiffReservedIndex = (r1.controller.audit_events || [])
    .findIndex((event) => (
      event.event === 'controller_effect_reserved'
      && event.stage === 'full_diff_review'
    ));
  const fullDiffInvokedIndex = (r1.controller.audit_events || [])
    .findIndex((event) => (
      event.event === 'controller_effect_invoked'
      && event.stage === 'full_diff_review'
    ));
  const fullDiffResultIndex = (r1.controller.audit_events || [])
    .findIndex((event) => (
      event.event === 'controller_effect_result'
      && event.stage === 'full_diff_review'
    ));
  assert.ok(
    fullDiffReservedIndex >= 0
      && fullDiffReservedIndex < fullDiffInvokedIndex
      && fullDiffInvokedIndex < fullDiffResultIndex,
    'full-diff reservation is durable before invocation and result persistence',
  );
  const firstLiveGateKinds = (r1.controller.gate_journal.entries || [])
    .filter((entry) => entry.result && entry.result.success === true && !entry.invalidated)
    .map((entry) => entry.kind)
    .sort();
  assert.deepStrictEqual(firstLiveGateKinds, [
    'focused_verification',
    'full_diff_review',
    'full_suite',
    'joint_review',
  ]);
  const firstJointGate = r1.controller.gate_journal.entries.find((entry) => (
    entry.kind === 'joint_review'
    && entry.result
    && entry.result.success === true
    && !entry.invalidated
  ));
  assert.ok(firstJointGate, 'fixture requires one reusable joint-review gate');
  assert.strictEqual(firstJointGate.result.verdict, 'SHIP-AS-IS');
  assert.strictEqual(firstJointGate.result.findings, '[]');
  assert.strictEqual(firstJointGate.result.review_digest, 'f'.repeat(64));
  const v1 = verifyCalls;
  const rev1 = reviewCalls;
  const p1 = panelCalls;
  const focused1 = focusedReviewCalls;
  const suite1 = fullSuiteCalls;
  const preEffect1 = preEffectCalls;
  // Second identical composition with same controller gate journal must reuse gates.
  const r2 = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: r1.controller || ctrl0,
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    ...gateMaterialInput(),
    resume: {
      phase: 'ADJUDICATING',
      repair_generation: 0,
      candidate: {
        committed: true, commit: base, tree_sha: tree, base_sha: base,
      },
      verification: { passed: true, receipt_digest: 'c'.repeat(64) },
      review: {
        reviewed: true, success: true, review_input_mode: 'full_diff_generation',
        review_digest: 'd'.repeat(64), findings: '[]',
      },
      full_diff_barriers: r1.full_diff_barriers || {
        0: { success: true, review_digest: 'd'.repeat(64), candidate_ref: base, base_sha: base },
      },
    },
  }, adapters);
  // Exact gate reuse: all four frozen gates produce zero new effects. The
  // deliberately non-authoritative focused supplement executes once more.
  assert.strictEqual(implementCalls, 1, 'resume never re-dispatches implementer');
  assert.strictEqual(verifyCalls, v1, 'focused verification gate reused exactly');
  assert.strictEqual(reviewCalls, rev1, 'full-diff gate reused exactly');
  assert.strictEqual(fullSuiteCalls, suite1, 'full-suite gate reused exactly');
  assert.strictEqual(panelCalls, p1, 'joint-review gate reused exactly');
  assert.strictEqual(focusedReviewCalls, focused1 + 1, 'focused supplement is not a reusable gate');
  assert.strictEqual(preEffectCalls, preEffect1 + 1, 'only the focused supplement admits a new effect');
  assert.strictEqual(r2.status, 'ready', JSON.stringify(r2));
  assert.ok(r2.controller, 'ready resume exposes Engine-readable controller metadata');
  assert.strictEqual(
    (r2.controller.audit_events || [])
      .filter((event) => event.event === 'controller_effect_invoked').length,
    firstEffectStages.length + 1,
    'resume adds exactly one explained non-gate effect',
  );

  const exactResumeState = {
    phase: 'ADJUDICATING',
    repair_generation: 0,
    candidate: {
      committed: true, commit: base, tree_sha: tree, base_sha: base,
    },
    verification: { passed: true, receipt_digest: 'c'.repeat(64) },
    review: {
      reviewed: true, success: true, review_input_mode: 'full_diff_generation',
      review_digest: 'd'.repeat(64), findings: '[]',
    },
    full_diff_barriers: r1.full_diff_barriers || {
      0: { success: true, review_digest: 'd'.repeat(64), candidate_ref: base, base_sha: base },
    },
  };
  const incompleteJointController = JSON.parse(JSON.stringify(r1.controller));
  const incompleteJointGate = incompleteJointController.gate_journal.entries.find((entry) => (
    entry.kind === 'joint_review'
    && entry.result
    && entry.result.success === true
    && !entry.invalidated
  ));
  assert.ok(incompleteJointGate, 'fixture requires a live joint-review gate');
  delete incompleteJointGate.result.verdict;
  delete incompleteJointGate.result.findings;
  incompleteJointController.gate_journal.digest = ctrl.sha256Json({
    schema_version: incompleteJointController.gate_journal.schema_version,
    artifact_type: incompleteJointController.gate_journal.artifact_type,
    entries: incompleteJointController.gate_journal.entries,
  });
  const panelCallsBeforeIncompleteReplay = panelCalls;
  const incompleteJointReplay = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: ctrl.emptyControllerState(incompleteJointController),
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    ...gateMaterialInput(),
    resume: exactResumeState,
  }, adapters);
  assert.strictEqual(incompleteJointReplay.status, 'ready', JSON.stringify(incompleteJointReplay));
  assert.strictEqual(
    panelCalls,
    panelCallsBeforeIncompleteReplay + 1,
    'joint gate without verdict/findings cannot reuse and reruns the panel',
  );
  const replacementJointGate = incompleteJointReplay.controller.gate_journal.entries.find(
    (entry) => (
      entry.kind === 'joint_review'
      && entry.result
      && entry.result.success === true
      && !entry.invalidated
    ),
  );
  assert.strictEqual(replacementJointGate.result.verdict, 'SHIP-AS-IS');
  assert.strictEqual(replacementJointGate.result.findings, '[]');

  const fullSuiteCallsBeforeMissingInput = fullSuiteCalls;
  const missingCommandMaterial = gateMaterialInput();
  delete missingCommandMaterial.fullSuiteCommandDigest;
  const missingCommandInput = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: r1.controller,
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    ...missingCommandMaterial,
    resume: exactResumeState,
  }, adapters);
  assert.strictEqual(missingCommandInput.status, 'blocked');
  assert.strictEqual(missingCommandInput.phase, 'full_suite');
  assert.strictEqual(missingCommandInput.code, 'FULL_SUITE_COMMAND_DIGEST_MISSING');
  assert.strictEqual(
    fullSuiteCalls,
    fullSuiteCallsBeforeMissingInput,
    'missing sealed command digest blocks before full-suite effects',
  );

  const controllerWithFullSuiteResultDigest = (commandDigest) => {
    const controllerCopy = JSON.parse(JSON.stringify(r1.controller));
    const gate = controllerCopy.gate_journal.entries.find((entry) => (
      entry.kind === 'full_suite'
      && entry.result
      && entry.result.success === true
      && !entry.invalidated
    ));
    assert.ok(gate, 'fixture requires one reusable full-suite gate');
    if (commandDigest === undefined) delete gate.result.command_digest;
    else gate.result.command_digest = commandDigest;
    controllerCopy.gate_journal.digest = ctrl.sha256Json({
      schema_version: controllerCopy.gate_journal.schema_version,
      artifact_type: controllerCopy.gate_journal.artifact_type,
      entries: controllerCopy.gate_journal.entries,
    });
    return ctrl.emptyControllerState(controllerCopy);
  };
  for (const malformedDigest of [undefined, '6'.repeat(64)]) {
    const suiteCallsBeforeMalformedReuse = fullSuiteCalls;
    const malformedReuse = runCampaignComposition({
      maxRepairGenerations: 1,
      minPanelSize: 1,
      promptFile: promptPath,
      controller: controllerWithFullSuiteResultDigest(malformedDigest),
      frozenDenominator: frozen,
      includeControllerMeta: true,
      gitCwd: dir,
      baseSha: base,
      ...gateMaterialInput(),
      resume: exactResumeState,
    }, adapters);
    assert.strictEqual(malformedReuse.status, 'ready', JSON.stringify(malformedReuse));
    assert.strictEqual(
      fullSuiteCalls,
      suiteCallsBeforeMalformedReuse + 1,
      'missing/mismatched result command digest cannot reuse a successful full-suite gate',
    );
    const liveFullSuiteGates = malformedReuse.controller.gate_journal.entries.filter((entry) => (
      entry.kind === 'full_suite'
      && entry.result
      && entry.result.success === true
      && !entry.invalidated
    ));
    assert.strictEqual(liveFullSuiteGates.length, 1);
    assert.strictEqual(
      liveFullSuiteGates[0].result.command_digest,
      fullSuiteCommandDigest,
      'replacement live full-suite gate binds the sealed command digest',
    );
  }

  // Material-input drift must invalidate the connected gate family before
  // effects. Each case resumes the same baseline controller independently so
  // the observed call deltas identify the exact gate(s) invalidated.
  const replayBaseline = () => runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: ctrl.emptyControllerState(JSON.parse(JSON.stringify(r1.controller))),
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    ...gateMaterialInput(),
    resume: JSON.parse(JSON.stringify(exactResumeState)),
  }, adapters);

  const baselineEnvFingerprint = verificationEnvFingerprint;
  let beforeVerify = verifyCalls;
  let beforeReview = reviewCalls;
  let beforeSuite = fullSuiteCalls;
  let beforePanel = panelCalls;
  verificationEnvFingerprint = 'a'.repeat(64);
  const environmentDrift = replayBaseline();
  assert.strictEqual(environmentDrift.status, 'ready', JSON.stringify(environmentDrift));
  assert.strictEqual(verifyCalls, beforeVerify + 1, 'environment drift reruns focused verification');
  assert.strictEqual(fullSuiteCalls, beforeSuite + 1, 'environment drift reruns full suite');
  assert.strictEqual(reviewCalls, beforeReview + 1, 'verification authority drift reruns full diff');
  assert.strictEqual(panelCalls, beforePanel + 1, 'verification authority drift reruns panel');
  verificationEnvFingerprint = baselineEnvFingerprint;

  const baselineSpecDigest = reviewSpecDigest;
  const baselineReviewerModel = reviewerModel;
  beforeVerify = verifyCalls;
  beforeReview = reviewCalls;
  beforeSuite = fullSuiteCalls;
  beforePanel = panelCalls;
  reviewSpecDigest = 'b'.repeat(64);
  reviewerModel = 'reviewer-b';
  const reviewAuthorityDrift = replayBaseline();
  assert.strictEqual(
    reviewAuthorityDrift.status,
    'ready',
    JSON.stringify(reviewAuthorityDrift),
  );
  assert.strictEqual(verifyCalls, beforeVerify, 'review authority drift reuses focused verification');
  assert.strictEqual(fullSuiteCalls, beforeSuite, 'review authority drift reuses full suite');
  assert.strictEqual(reviewCalls, beforeReview + 1, 'spec/reviewer drift reruns full diff');
  assert.strictEqual(panelCalls, beforePanel + 1, 'new full-diff authority reruns panel');
  reviewSpecDigest = baselineSpecDigest;
  reviewerModel = baselineReviewerModel;

  const baselineFocusedDigest = focusedSupplementDigest;
  beforeVerify = verifyCalls;
  beforeReview = reviewCalls;
  beforeSuite = fullSuiteCalls;
  beforePanel = panelCalls;
  focusedSupplementDigest = '6'.repeat(64);
  const focusedPayloadDrift = replayBaseline();
  assert.strictEqual(focusedPayloadDrift.status, 'ready', JSON.stringify(focusedPayloadDrift));
  assert.strictEqual(verifyCalls, beforeVerify, 'focused payload drift reuses verification');
  assert.strictEqual(fullSuiteCalls, beforeSuite, 'focused payload drift reuses full suite');
  assert.strictEqual(reviewCalls, beforeReview, 'focused payload drift reuses full diff');
  assert.strictEqual(panelCalls, beforePanel + 1, 'focused payload drift reruns panel');
  focusedSupplementDigest = baselineFocusedDigest;

  const baselineRosterDigest = jointReviewRosterDigest;
  beforeVerify = verifyCalls;
  beforeReview = reviewCalls;
  beforeSuite = fullSuiteCalls;
  beforePanel = panelCalls;
  jointReviewRosterDigest = '8'.repeat(64);
  const rosterDrift = replayBaseline();
  assert.strictEqual(rosterDrift.status, 'ready', JSON.stringify(rosterDrift));
  assert.strictEqual(verifyCalls, beforeVerify, 'roster drift reuses verification');
  assert.strictEqual(fullSuiteCalls, beforeSuite, 'roster drift reuses full suite');
  assert.strictEqual(reviewCalls, beforeReview, 'roster drift reuses full diff');
  assert.strictEqual(panelCalls, beforePanel + 1, 'reviewer roster drift reruns panel');
  jointReviewRosterDigest = baselineRosterDigest;

  // Crash window: exercise the real composition → Engine → review provider
  // boundary. The controller must persist an authority-bound reservation
  // before provider invocation; a crash immediately after the provider returns
  // leaves that reservation pending, and restart must not call the provider.
  const pendingCandidate = {
    committed: true, commit: base, tree_sha: tree, base_sha: base,
  };
  const crashReviewDiffPath = path.join(dir, 'crash-reservation-review.diff');
  fs.writeFileSync(
    crashReviewDiffPath,
    'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n',
  );
  const fileSha256 = (file) => require('crypto').createHash('sha256')
    .update(fs.readFileSync(file)).digest('hex');
  const crashReviewRoster = {
    implementer_engine: 'gpt-5.5',
    reviewer_engine: 'claude-test',
    reviewer_effort: 'high',
    reviewer_runner: 'test-review',
    reviewer_endpoint: '',
  };
  const { AutopilotEngine: CrashEngine } = require(path.join(root, 'src', 'engine'));
  let crashProviderCalls = 0;
  const crashEngine = new CrashEngine({
    cwd: dir,
    reviewDispatcher(_args, options) {
      crashProviderCalls += 1;
      assert.ok(
        /^[0-9a-f]{64}$/.test(options.idempotencyKey),
        'provider receives the durable reservation as its idempotency key',
      );
      assert.strictEqual(
        options.env.AUTOPILOT_EFFECT_RESERVATION_ID,
        options.idempotencyKey,
      );
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'test-review',
          model: 'claude-test',
          status: 'reviewed',
          verdict: 'SHIP-AS-IS',
          findings: '',
          no_finding_proof:
            'checked=full diff; evidence=authority-bound crash fixture; conclusion=no finding',
          raw_log: '/tmp/crash-review.log',
          error: null,
        },
      };
    },
    reviewPostProviderHook() {
      throw new Error('crash-after-review-provider');
    },
  });
  const prepareCrashReview = (payload) => ({
    prepared: true,
    authority: {
      schema_version: 1,
      artifact_type: 'controller_full_diff_review_input',
      candidate_ref: payload.candidate.commit,
      candidate_tree_sha: payload.candidate.tree_sha,
      base_sha: payload.candidate.base_sha,
      diff_digest: fileSha256(crashReviewDiffPath),
      spec_digest: fileSha256(promptPath),
      review_input_digest: canonicalDigest(payload),
      reviewer: {
        runner: crashReviewRoster.reviewer_runner,
        model: crashReviewRoster.reviewer_engine,
        effort: crashReviewRoster.reviewer_effort,
        endpoint: null,
      },
    },
    diff_file: crashReviewDiffPath,
    spec_file: promptPath,
  });
  const crashReview = (payload) => {
    const prepared = payload.prepared_review;
    const reviewed = crashEngine.reviewDiff({
      diffFile: prepared.diff_file,
      specFile: prepared.spec_file,
      roster: crashReviewRoster,
      implementerEngine: crashReviewRoster.implementer_engine,
      pinReviewerTuple: true,
      reservationIdentity: payload.reservation_identity,
    });
    return {
      reviewed: reviewed.status === 'reviewed',
      success: reviewed.status === 'reviewed',
      review_input_mode: 'full_diff_generation',
      review_digest: reviewed.review && reviewed.review.review_digest,
      findings: reviewed.review && reviewed.review.findings || '[]',
      verdict: reviewed.verdict,
    };
  };
  const crashController = ctrl.emptyControllerState({
    frozen_denominator: frozen,
    started_at_ms: Date.now() - 1000,
    repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: 8 }),
  });
  let persistedAfterCrash = null;
  const crashAdapters = {
    ...adapters,
    prepareReview: prepareCrashReview,
    review: crashReview,
    onControllerUpdate(nextController) {
      persistedAfterCrash = JSON.parse(JSON.stringify(nextController));
    },
  };
  const implementCallsBeforePendingResume = implementCalls;
  assert.throws(() => runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: crashController,
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    resume: {
      phase: 'ADJUDICATING',
      repair_generation: 0,
      candidate: pendingCandidate,
    },
  }, crashAdapters), /crash-after-review-provider/);
  assert.strictEqual(crashProviderCalls, 1);
  assert.ok(persistedAfterCrash, 'reservation state persisted before provider crash');
  const pendingReservation = persistedAfterCrash.audit_events.find((event) => (
    event.event === 'controller_effect_reserved'
    && event.stage === 'full_diff_review'
  ));
  assert.ok(pendingReservation, 'real full-diff reservation is durable');
  assert.deepStrictEqual(
    pendingReservation.authority,
    prepareCrashReview({
      candidate: { ...pendingCandidate, branch: null },
      verification: {
        passed: true,
        receipt_digest: 'c'.repeat(64),
        tree_sha: tree,
        argv_hash: verificationArgvHash,
        env_fingerprint: verificationEnvFingerprint,
        request_digest: verificationRequestDigest(),
      },
      repair_generation: 0,
      scope: 'full_diff',
      review_input_mode: 'full_diff_generation',
      vertical_failed: false,
    }).authority,
    'reservation binds exact candidate/base/tree/diff/spec/input/reviewer authority',
  );
  assert.strictEqual(
    persistedAfterCrash.audit_events.some((event) => (
      event.event === 'controller_effect_invoked'
      && event.reservation_identity === pendingReservation.reservation_identity
    )),
    false,
    'provider crash leaves no fabricated invoked/result event',
  );
  const pendingResume = runCampaignComposition({
    maxRepairGenerations: 1,
    minPanelSize: 1,
    promptFile: promptPath,
    controller: persistedAfterCrash,
    frozenDenominator: frozen,
    includeControllerMeta: true,
    gitCwd: dir,
    baseSha: base,
    resume: {
      phase: 'ADJUDICATING',
      repair_generation: 0,
      candidate: pendingCandidate,
    },
  }, crashAdapters);
  assert.strictEqual(pendingResume.status, 'blocked');
  assert.strictEqual(pendingResume.phase, 'effect_reconciliation');
  assert.strictEqual(pendingResume.code, 'EFFECT_RESERVATION_PENDING');
  assert.strictEqual(
    crashProviderCalls,
    1,
    'restart with an in-flight full-diff reservation must not call reviewer again',
  );
  assert.strictEqual(
    implementCalls,
    implementCallsBeforePendingResume,
    'reservation reconciliation never re-dispatches implementation',
  );

  // The same durable reservation identity reaches the real Engine provider
  // boundary as both an env fence and idempotency option.
  const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
  const reviewDiffPath = path.join(dir, 'reservation-review.diff');
  fs.writeFileSync(reviewDiffPath, 'diff --git a/f.txt b/f.txt\n');
  const providerReservation = '9'.repeat(64);
  let providerOptions = null;
  let providerCalls = 0;
  const reservationEngine = new AutopilotEngine({
    cwd: dir,
    reviewDispatcher(_args, options) {
      providerCalls += 1;
      providerOptions = options;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'test-review',
          model: 'claude-test',
          status: 'reviewed',
          verdict: 'SHIP-AS-IS',
          findings: '',
          no_finding_proof: 'checked=full diff; evidence=bound fixture; conclusion=no finding',
          raw_log: '/tmp/review.log',
          error: null,
        },
      };
    },
  });
  const reservationReview = reservationEngine.reviewDiff({
    diffFile: reviewDiffPath,
    specFile: promptPath,
    roster: {
      implementer_engine: 'gpt-5.5',
      reviewer_engine: 'claude-test',
      reviewer_effort: 'high',
      reviewer_runner: 'test-review',
    },
    implementerEngine: 'gpt-5.5',
    reservationIdentity: providerReservation,
  });
  assert.strictEqual(reservationReview.status, 'reviewed', JSON.stringify(reservationReview));
  assert.strictEqual(providerCalls, 1);
  assert.strictEqual(providerOptions.idempotencyKey, providerReservation);
  assert.strictEqual(
    providerOptions.env.AUTOPILOT_EFFECT_RESERVATION_ID,
    providerReservation,
  );

  // Engine boundary rejects negative provider telemetry instead of clamping it
  // to zero, and conservatively charges the already-invoked rail once.
  const negativeTelemetryBranch = execFileSync(
    'git',
    ['-C', dir, 'symbolic-ref', '--short', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  let negativeTelemetryCalls = 0;
  const negativeTelemetryEngine = new AutopilotEngine({
    cwd: dir,
    implementationDispatcher() {
      negativeTelemetryCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: 'agy',
          model: 'gpt-5.5',
          containment: 'worktree',
          contained: true,
          branch: negativeTelemetryBranch,
          base,
          commit: base,
          files_changed: 0,
          insertions: 0,
          deletions: 0,
          worktree: dir,
          agent_log: '/tmp/negative-telemetry.log',
          error: null,
          dispatcher_called: true,
          model_calls: -1,
          mutation_attempts: 1,
          gate_attempts: 0,
          resources_created: 0,
        },
      };
    },
  });
  const negativeTelemetry = negativeTelemetryEngine.implementTask({
    promptFile: promptPath,
    branch: negativeTelemetryBranch,
    base,
    roster: {
      implementer_engine: 'gpt-5.5',
      implementer_effort: 'high',
      implementer_runner: 'agy',
    },
    implementationOptions: { cwd: dir },
  });
  assert.strictEqual(negativeTelemetryCalls, 1);
  assert.strictEqual(negativeTelemetry.status, 'blocked');
  assert.strictEqual(negativeTelemetry.phase, 'dispatcher_outcome_authority');
  assert.match(negativeTelemetry.reason, /model_calls.*nonnegative/i);
  assert.strictEqual(negativeTelemetry.dispatcher_called, true);
  assert.strictEqual(negativeTelemetry.model_calls, 1);

  // Six-axis red: each axis independently blocks with zero implement when at limit.
  for (const axis of ctrl.REPAIR_BUDGET_AXES) {
    if (axis === 'fresh_input_tokens') {
      const t = ctrl.checkJointRepairBudget(
        { ...ctrl.emptyBudgetUsage(), fresh_input_tokens: 5 },
        { fresh_input_tokens: 5 },
        { projectedDelta: { fresh_input_tokens: 1 } },
      );
      assert.strictEqual(t.allow_spend, false, 'tokens at limit blocks positive delta');
      continue;
    }
    const limits = ctrl.defaultBudgetLimits({ [axis]: 3 });
    const usage = axis === 'elapsed_wall_ms' || axis === 'owned_worktrees'
      ? { ...ctrl.emptyBudgetUsage(), [axis]: 3 }
      : ctrl.applyBudgetUsage(ctrl.emptyBudgetUsage(), { [axis]: 3 });
    const blocked = ctrl.checkJointRepairBudget(usage, limits, {
      projectedDelta: axis === 'elapsed_wall_ms' || axis === 'owned_worktrees'
        ? { [axis]: 4 }
        : { [axis]: 1 },
    });
    assert.strictEqual(blocked.allow_spend, false, axis);
  }
  // Attach without replenishment: limits stay frozen, usage preserved.
  const attached = ctrl.emptyControllerState({
    frozen_denominator: frozen,
    repair_budget_limits: { model_calls: 2 },
    repair_budget_usage: { ...ctrl.emptyBudgetUsage(), model_calls: 2 },
  });
  assert.strictEqual(attached.repair_budget_limits.model_calls, 2);
  assert.strictEqual(attached.repair_budget_usage.model_calls, 2);
  const attachBlock = ctrl.checkJointRepairBudget(
    attached.repair_budget_usage,
    attached.repair_budget_limits,
    { projectedDelta: { model_calls: 1 } },
  );
  assert.strictEqual(attachBlock.allow_spend, false, 'attach does not replenish budget');

  // Transcript exact identity: independent invocation/result events must
  // explain every concrete row; caller authority is never stamped onto rows.
  const auditRoot = 'r1';
  const auditWork = 'w1';
  const dispatchBody = {
    kind: 'implementation',
    root_run_id: auditRoot,
    work_order_id: auditWork,
    generation: 0,
    dispatcher_called: true,
    model_calls: 1,
    prompt_bytes: 17,
    run_id: 'run-1',
    dispatch_id: 'dispatch-1',
    provider: 'codex',
    runner: 'codex',
    model: 'fixture-model',
    provider_session_id: null,
    resource_id: '/tmp/controller-resource-1',
    result_receipt_digest: 'c'.repeat(64),
  };
  const dispatch = {
    ...dispatchBody,
    at: '2026-07-30T13:00:00.000Z',
    digest: canonicalDigest(dispatchBody),
  };
  const dispatchEventBody = {
    event: 'controller_effect_invoked',
    stage: 'implementation',
    effect_kind: 'dispatch',
    root_run_id: auditRoot,
    work_order_id: auditWork,
    run_id: dispatch.run_id,
    dispatch_id: dispatch.dispatch_id,
    provider: dispatch.provider,
    runner: dispatch.runner,
    model: dispatch.model,
    provider_session_id: dispatch.provider_session_id,
    resource_identity: dispatch.resource_id,
    result_receipt_digest: dispatch.result_receipt_digest,
    model_calls: 1,
    fresh_input_bytes: 17,
    generation: 0,
    effect_identity: dispatch.digest,
  };
  const dispatchEvent = {
    ...dispatchEventBody,
    at: '2026-07-30T13:00:00.000Z',
    digest: canonicalDigest(dispatchEventBody),
  };
  const resource = {
    resource_id: dispatch.resource_id,
    kind: 'worktree',
    path: dispatch.resource_id,
    root_run_id: auditRoot,
    work_order_id: auditWork,
    identity_known: true,
    active: true,
  };
  const disposition = ctrl.buildResourceDebtState([resource]).open[0];
  const gateRecorded = ctrl.recordGateEntry(ctrl.emptyGateJournal(), {
    kind: 'full_diff_review',
    owner: 'depth-0',
    input: {
      root_run_id: auditRoot,
      work_order_id: auditWork,
      candidate_ref: base,
    },
    result: { success: true, review_digest: 'd'.repeat(64) },
    startedAt: '2026-07-30T13:01:00.000Z',
    finishedAt: '2026-07-30T13:02:00.000Z',
  });
  const gate = gateRecorded.entry;
  const gateInvocationResultIdentity = canonicalDigest({ receipt: 'full-diff-result' });
  const gateInvocationIdentity = canonicalDigest({
    schema_version: 1,
    root_run_id: auditRoot,
    work_order_id: auditWork,
    stage: gate.kind,
    effect_kind: 'gate',
    generation: 0,
    invocation_ordinal: 1,
    result_identity: gateInvocationResultIdentity,
  });
  const gateInvocationBody = {
    event: 'controller_effect_invoked',
    stage: gate.kind,
    effect_kind: 'gate',
    effect_identity: gateInvocationIdentity,
    result_identity: gateInvocationResultIdentity,
    invocation_ordinal: 1,
    root_run_id: auditRoot,
    work_order_id: auditWork,
    model_calls: 1,
    fresh_input_bytes: 23,
    generation: 0,
  };
  const gateInvocation = {
    ...gateInvocationBody,
    at: '2026-07-30T13:02:00.000Z',
    digest: canonicalDigest(gateInvocationBody),
  };
  const gateEffectResultDigest = canonicalDigest({
    gate_id: gate.gate_id,
    kind: gate.kind,
    owner: gate.owner,
    root_run_id: gate.root_run_id,
    work_order_id: gate.work_order_id,
    input_digest: gate.input_digest,
    started_at: gate.started_at,
    finished_at: gate.finished_at,
    result: gate.result,
  });
  const gateResultBody = {
    event: 'controller_effect_result',
    effect_kind: 'gate',
    effect_identity: gate.gate_id,
    invocation_identity: gateInvocationIdentity,
    invocation_result_identity: gateInvocationResultIdentity,
    effect_result_digest: gateEffectResultDigest,
    input_digest: gate.input_digest,
    stage: gate.kind,
    root_run_id: auditRoot,
    work_order_id: auditWork,
  };
  const gateResult = {
    ...gateResultBody,
    at: gate.finished_at,
    digest: canonicalDigest(gateResultBody),
  };
  const auditInput = {
    rootRunId: auditRoot,
    workOrderId: auditWork,
    auditEvents: [dispatchEvent, gateInvocation, gateResult],
    dispatches: [dispatch],
    resources: [resource],
    gates: [gate],
    dispositions: [disposition],
  };
  const auditOk = ctrl.rebuildTranscriptAudit(auditInput);
  assert.strictEqual(auditOk.explains_all, true, auditOk.problems.join('; '));
  assert.strictEqual(auditOk.blocks_terminal, false);

  const auditDup = ctrl.rebuildTranscriptAudit({
    ...auditInput,
    dispatches: [dispatch, dispatch],
  });
  assert.strictEqual(auditDup.explains_all, false);
  assert.strictEqual(auditDup.blocks_terminal, true);

  const foreignDispatch = { ...dispatch, root_run_id: 'foreign-root' };
  const auditForeign = ctrl.rebuildTranscriptAudit({
    ...auditInput,
    dispatches: [foreignDispatch],
  });
  assert.strictEqual(auditForeign.explains_all, false);
  assert.strictEqual(auditForeign.rows.find((row) => row.kind === 'dispatch').root_run_id,
    'foreign-root', 'audit must preserve rather than stamp the foreign tuple');

  const auditMissing = ctrl.rebuildTranscriptAudit({
    ...auditInput,
    dispatches: [],
  });
  assert.strictEqual(auditMissing.explains_all, false);
  assert.ok(auditMissing.problems.some((problem) => problem.includes('missing dispatch')));

  const auditMissingTuple = ctrl.rebuildTranscriptAudit({
    ...auditInput,
    auditEvents: [{ ...dispatchEvent, root_run_id: undefined }, gateInvocation, gateResult],
  });
  assert.strictEqual(auditMissingTuple.explains_all, false);
  assert.ok(auditMissingTuple.problems.some((problem) => problem.includes('foreign or missing')));

  // A cross-process resume has no local dispatch invocation for the inherited
  // candidate worktree. Its exact mechanically observed recovery receipt,
  // sealed by the canonical controller Work Order, independently explains the
  // resource; a forged receipt remains unexplained and blocks terminal.
  const recoveryAuditRoot = 'audit-recovery-root';
  const recoveryAuditWork = 'audit-recovery-work';
  const recoveryAuditRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrl-audit-recovery-'));
  execFileSync('git', ['-C', recoveryAuditRepo, 'init', '-q']);
  execFileSync('git', ['-C', recoveryAuditRepo, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', recoveryAuditRepo, 'config', 'user.name', 't']);
  fs.writeFileSync(path.join(recoveryAuditRepo, 'owned.txt'), 'owned\n');
  execFileSync('git', ['-C', recoveryAuditRepo, 'add', '.']);
  execFileSync('git', ['-C', recoveryAuditRepo, 'commit', '-qm', 'owned']);
  const recoveryAuditBase = execFileSync(
    'git',
    ['-C', recoveryAuditRepo, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim();
  const recoveryAuditReceipt = ctrl.buildRecoveryReceipt({
    resourceId: recoveryAuditRepo,
    path: recoveryAuditRepo,
    gitCwd: recoveryAuditRepo,
    baseSha: recoveryAuditBase,
    evidenceKind: 'clean_release',
  });
  const recoveredResource = {
    resource_id: recoveryAuditRepo,
    kind: 'worktree',
    path: recoveryAuditRepo,
    branch: recoveryAuditReceipt.branch,
    tip: recoveryAuditReceipt.tip,
    clean: recoveryAuditReceipt.outcome.clean,
    dirty: recoveryAuditReceipt.outcome.dirty,
    unique: recoveryAuditReceipt.outcome.unique,
    terminal: recoveryAuditReceipt.outcome.terminal,
    identity_known: recoveryAuditReceipt.outcome.identity_known,
    recovery_receipt: recoveryAuditReceipt,
    root_run_id: recoveryAuditRoot,
    work_order_id: recoveryAuditWork,
  };
  const recoveryController = ctrl.emptyControllerState({
    resource_inventory: [recoveredResource],
    recovery_receipts: [recoveryAuditReceipt],
  });
  const recoveryWorkOrderModule = require(path.join(root, 'src/engine/work-order'));
  const recoveryWorkOrder = {
    schema_version: 2,
    artifact_type: 'work_order',
    root_run_id: recoveryAuditRoot,
    work_order_id: recoveryAuditWork,
    role: 'controller',
    controller: recoveryController,
  };
  recoveryWorkOrder.digest = recoveryWorkOrderModule.workOrderDigest(recoveryWorkOrder);
  const recoveredAudit = ctrl.rebuildTranscriptAudit({
    rootRunId: recoveryAuditRoot,
    workOrderId: recoveryAuditWork,
    resources: [recoveredResource],
    workOrder: recoveryWorkOrder,
  });
  assert.strictEqual(
    recoveredAudit.explains_all,
    true,
    recoveredAudit.problems.join('; '),
  );
  assert.ok(recoveredAudit.authority_sources_checked.includes(
    'controller_recovery_receipts',
  ));

  const forgedRecoveryReceipt = {
    ...recoveryAuditReceipt,
    digest: 'f'.repeat(64),
  };
  const forgedRecoveredResource = {
    ...recoveredResource,
    recovery_receipt: forgedRecoveryReceipt,
  };
  const forgedRecoveryController = ctrl.emptyControllerState({
    resource_inventory: [forgedRecoveredResource],
    recovery_receipts: [forgedRecoveryReceipt],
  });
  const forgedRecoveryWorkOrder = {
    ...recoveryWorkOrder,
    controller: forgedRecoveryController,
  };
  forgedRecoveryWorkOrder.digest = recoveryWorkOrderModule.workOrderDigest(
    forgedRecoveryWorkOrder,
  );
  const forgedRecoveredAudit = ctrl.rebuildTranscriptAudit({
    rootRunId: recoveryAuditRoot,
    workOrderId: recoveryAuditWork,
    resources: [forgedRecoveredResource],
    workOrder: forgedRecoveryWorkOrder,
  });
  assert.strictEqual(forgedRecoveredAudit.explains_all, false);
  assert.ok(forgedRecoveredAudit.problems.some((problem) => (
    problem.includes('recovery receipt') && problem.includes('invalid')
  )));

  // PostCompact mechanical inventory from real worktree list (not empty default).
  const common = require(path.join(root, 'src/engine/work-order')).resolveGitCommonDir(dir);
  const woMod = require(path.join(root, 'src/engine/work-order'));
  const cstate = ctrl.emptyControllerState({
    frozen_denominator: frozen,
    resource_inventory: [],
  });
  const w = woMod.createOrUpdateWorkOrder(common, {
    root_run_id: 'postcompact-root',
    graph_node: 'controller',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'master',
    base_sha: base,
    worktree: dir,
    paths: { checkpoint: path.join(dir, 'cp.json') },
    controller: cstate,
  }, { bindArtifacts: false });
  assert.strictEqual(w.status, 'written');
  const rehydrate = path.join(root, 'scripts/compaction-rehydrate.js');
  const pc = require('child_process').spawnSync(process.execPath, [
    rehydrate, 'postcompact-adapter',
    '--git-cwd', dir,
    '--root-run-id', 'postcompact-root',
    '--graph-node', 'controller',
    '--attempt', '1',
  ], { encoding: 'utf8' });
  // A controller Work Order without the complete production authority bundle
  // must deterministically reject; merely emitting output is not an oracle.
  assert.strictEqual(pc.status, 1, pc.stderr);
  const pcBody = JSON.parse(pc.stdout);
  assert.strictEqual(pcBody.production_hook_wired, false);
  assert.strictEqual(pcBody.status, 'reject');
  assert.strictEqual(pcBody.reason_code, 'controller_authority_incomplete');

  // Orphan: real worktree branch, dead owner, leaf digest, CAS adopt once.
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-b', 'orphan-leaf']);
  fs.writeFileSync(path.join(dir, 'orphan.txt'), 'leaf\n');
  execFileSync('git', ['-C', dir, 'add', 'orphan.txt']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'leaf']);
  const leafTip = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const orphanController = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { stdio: 'ignore' },
  );
  const productionParentage = woMod.captureProcessParentage(orphanController.pid);
  const deadOwner = productionParentage.owner;
  assert.ok(woMod.isCompleteIdentity(deadOwner));
  assert.ok(productionParentage.relationships.length > 0);
  process.kill(orphanController.pid, 'SIGKILL');
  orphanController.unref();
  const deathWait = new Int32Array(new SharedArrayBuffer(4));
  for (let attempt = 0; attempt < 100 && woMod.isProcessLive(deadOwner); attempt += 1) {
    Atomics.wait(deathWait, 0, 0, 10);
  }
  assert.strictEqual(woMod.isProcessLive(deadOwner), false);
  const adoptState = ctrl.emptyControllerState({
    frozen_denominator: frozen,
    process_parentage: productionParentage,
  });
  const aw = woMod.createOrUpdateWorkOrder(common, {
    root_run_id: 'adopt-root-g11',
    graph_node: 'n1',
    attempt: 1,
    role: 'controller',
    next_action: 'continue',
    branch: 'orphan-leaf',
    base_sha: base,
    worktree: dir,
    owner: deadOwner,
    paths: { checkpoint: path.join(dir, 'acp.json') },
    controller: adoptState,
    sealed_scope: { allow_paths: ['orphan.txt'], max_files: 10, max_diff_lines: 1000 },
  }, { bindArtifacts: false, updateLifecycle: false });
  assert.strictEqual(aw.status, 'written');
  const live = JSON.parse(fs.readFileSync(aw.path, 'utf8'));
  live.owner = deadOwner;
  live.digest = woMod.workOrderDigest(live);
  fs.writeFileSync(aw.path, `${JSON.stringify(live, null, 2)}\n`);
  const leafBody = { committed: true, commit: leafTip, worktree: dir };
  const leaf = { ...leafBody, digest: ctrl.sha256Json(leafBody) };
  const writeAdoptionAuthority = ({
    rootRunId,
    owner = deadOwner,
    controller = adoptState,
    sealedScope = {
      allow_paths: ['orphan.txt'],
      max_files: 10,
      max_diff_lines: 1000,
    },
    branch = 'orphan-leaf',
    baseSha = base,
    omitSealedScope = false,
  }) => {
    const fields = {
      root_run_id: rootRunId,
      graph_node: 'n1',
      attempt: 1,
      role: 'controller',
      next_action: 'continue',
      branch,
      base_sha: baseSha,
      worktree: dir,
      owner,
      paths: { checkpoint: path.join(dir, `${rootRunId}.json`) },
      controller,
    };
    if (!omitSealedScope) fields.sealed_scope = sealedScope;
    const writtenAuthority = woMod.createOrUpdateWorkOrder(
      common,
      fields,
      { bindArtifacts: false, updateLifecycle: false },
    );
    assert.strictEqual(
      writtenAuthority.status,
      'written',
      JSON.stringify(writtenAuthority),
    );
    return JSON.parse(fs.readFileSync(writtenAuthority.path, 'utf8'));
  };
  const missingParentWo = writeAdoptionAuthority({
    rootRunId: 'adopt-missing-parent',
    controller: ctrl.emptyControllerState({
      ...live.controller,
      process_parentage: null,
    }),
  });
  const missingParentAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: missingParentWo,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: live.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(missingParentAdopt.ok, false);
  assert.strictEqual(missingParentAdopt.code, 'ADOPTION_PARENT_CHAIN_MISSING');
  const badParentWo = writeAdoptionAuthority({
    rootRunId: 'adopt-bad-parent',
    controller: ctrl.emptyControllerState({
      ...live.controller,
      process_parentage: {
        ...productionParentage,
        digest: '0'.repeat(64),
      },
    }),
  });
  const badParentAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: badParentWo,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: live.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(badParentAdopt.ok, false);
  assert.strictEqual(badParentAdopt.code, 'ADOPTION_PARENT_CHAIN_INVALID');
  const callerScopeOverride = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: live,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: { allow_paths: ['docs'], max_files: 10, max_diff_lines: 1000 },
    leafWorktree: dir,
  });
  assert.strictEqual(callerScopeOverride.ok, false);
  assert.strictEqual(callerScopeOverride.code, 'ADOPTION_SCOPE_OVERRIDE_REJECTED');

  // A caller may recompute the public outer digest after changing sealed
  // authority while retaining generation/CAS/controller values. The canonical
  // persisted full-record digest must reject that self-consistent forgery and
  // the live Work Order must remain byte-for-byte unchanged.
  const forgedAuthority = JSON.parse(JSON.stringify(live));
  forgedAuthority.base_sha = leafTip;
  forgedAuthority.sealed_scope = {
    allow_paths: ['orphan.txt', 'outside.txt'],
    max_files: 100,
    max_diff_lines: 10000,
  };
  forgedAuthority.digest = woMod.workOrderDigest(forgedAuthority);
  const authorityBeforeForgery = fs.readFileSync(aw.path, 'utf8');
  const forgedAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: forgedAuthority,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: leafTip,
    sealedScope: forgedAuthority.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(forgedAdopt.ok, false);
  assert.strictEqual(forgedAdopt.code, 'ADOPTION_WO_SNAPSHOT_MISMATCH');
  assert.strictEqual(fs.readFileSync(aw.path, 'utf8'), authorityBeforeForgery);

  const adopt1 = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: live,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: live.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(adopt1.ok, true, JSON.stringify(adopt1));
  assert.strictEqual(adopt1.implementer_redispatch, 0);
  assert.strictEqual(adopt1.work_order_id, live.work_order_id || aw.work_order.work_order_id);
  const gen1 = adopt1.generation;
  const adopt2 = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: adopt1.work_order,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: live.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(adopt2.ok, false);
  assert.strictEqual(adopt2.code, 'ADOPTION_ALREADY_CONSUMED');
  assert.ok(Number.isSafeInteger(gen1) && gen1 >= 1);
  // Negatives: live owner, missing base, path escape.
  const liveParentage = woMod.captureProcessParentage(process.pid);
  const liveOwner = liveParentage.owner;
  const liveWo = writeAdoptionAuthority({
    rootRunId: 'adopt-live-owner',
    owner: liveOwner,
    controller: ctrl.emptyControllerState({
      ...adoptState,
      process_parentage: liveParentage,
    }),
  });
  const liveAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir, workOrder: liveWo, leafResult: leaf, branch: 'orphan-leaf', baseSha: base,
    sealedScope: live.sealed_scope, leafWorktree: dir,
  });
  assert.strictEqual(liveAdopt.ok, false);
  assert.ok(['CONTROLLER_NOT_PROVEN_DEAD', 'CONTROLLER_DEATH_UNKNOWN'].includes(liveAdopt.code));
  const legacyUnscoped = writeAdoptionAuthority({
    rootRunId: 'adopt-unscoped',
    omitSealedScope: true,
  });
  const unscopedAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: legacyUnscoped,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    leafWorktree: dir,
  });
  assert.strictEqual(unscopedAdopt.ok, false);
  assert.strictEqual(unscopedAdopt.code, 'ADOPTION_SCOPE_NOT_SEALED');
  const tamperedScope = JSON.parse(JSON.stringify(live));
  tamperedScope.sealed_scope.allow_paths = ['docs'];
  const tamperedScopeAdopt = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: tamperedScope,
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: base,
    sealedScope: tamperedScope.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(tamperedScopeAdopt.ok, false);
  assert.strictEqual(tamperedScopeAdopt.code, 'work_order_digest_mismatch');

  const rejectRealGitOrphan = ({
    rootRunId,
    branch,
    files,
    sealedScope,
    reason,
  }) => {
    execFileSync('git', ['-C', dir, 'checkout', '-q', '-B', branch, base]);
    for (const [relativePath, bytes] of Object.entries(files)) {
      const absolutePath = path.join(dir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, bytes);
      execFileSync('git', ['-C', dir, 'add', relativePath]);
    }
    execFileSync('git', ['-C', dir, 'commit', '-qm', rootRunId]);
    const tip = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const negativeWorkOrder = writeAdoptionAuthority({
      rootRunId,
      branch,
      sealedScope,
    });
    const negativeLeafBody = { committed: true, commit: tip, worktree: dir };
    const rejected = ctrl.adoptOrphanLeaf({
      gitCwd: dir,
      workOrder: negativeWorkOrder,
      leafResult: {
        ...negativeLeafBody,
        digest: ctrl.sha256Json(negativeLeafBody),
      },
      branch,
      baseSha: base,
      sealedScope,
      leafWorktree: dir,
    });
    assert.strictEqual(rejected.ok, false, JSON.stringify(rejected));
    assert.strictEqual(rejected.code, 'ADOPTION_BINDING_FAILED');
    assert.match(rejected.reason, reason);
  };
  rejectRealGitOrphan({
    rootRunId: 'adopt-outside-path',
    branch: 'orphan-outside-path',
    files: { 'outside.txt': 'outside\n' },
    sealedScope: {
      allow_paths: ['scope'],
      max_files: 10,
      max_diff_lines: 100,
    },
    reason: /outside sealed scope: outside\.txt/,
  });
  rejectRealGitOrphan({
    rootRunId: 'adopt-file-count',
    branch: 'orphan-file-count',
    files: {
      'scope/a.txt': 'a\n',
      'scope/b.txt': 'b\n',
    },
    sealedScope: {
      allow_paths: ['scope'],
      max_files: 1,
      max_diff_lines: 100,
    },
    reason: /changed file count 2 exceeds max 1/,
  });
  rejectRealGitOrphan({
    rootRunId: 'adopt-churn',
    branch: 'orphan-churn',
    files: { 'scope/churn.txt': 'one\ntwo\nthree\n' },
    sealedScope: {
      allow_paths: ['scope'],
      max_files: 10,
      max_diff_lines: 1,
    },
    reason: /diff-line churn 3 exceeds max 1/,
  });

  const noBase = ctrl.adoptOrphanLeaf({
    gitCwd: dir,
    workOrder: { ...live, base_sha: null, controller: adoptState, owner: deadOwner },
    leafResult: leaf,
    branch: 'orphan-leaf',
    baseSha: null,
    sealedScope: live.sealed_scope,
    leafWorktree: dir,
  });
  assert.strictEqual(noBase.ok, false);
}

console.log("All inline verification assertions passed successfully!");
NODE
assert_exit_code "$?" "0" "Independent Controller Discipline verification node assertions"

finalize_test
