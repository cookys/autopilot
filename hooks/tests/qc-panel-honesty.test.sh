#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const { runCampaignComposition } = require(path.join(root, 'src/engine/campaign-composition'));
const { canonicalDigest } = require(path.join(root, 'src/engine/campaign-verification'));
const {
  AutopilotEngine,
  finalPanelSeatQualified,
  terminalPanelCrossFamilySatisfied,
} = require(path.join(root, 'src/engine/autopilot-engine'));

const TREE = 'a'.repeat(40);
const DIGEST = 'b'.repeat(64);

function seat(index, overrides = {}) {
  const body = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_final_panel_seat',
    seat_index: index,
    runner: `runner-${index}`,
    model: `model-${index}`,
    effort: 'high',
    endpoint: `endpoint-${index}`,
    family: `family-${index}`,
    status: 'reviewed',
    verdict: 'SHIP-AS-IS',
    review_digest: String(index).repeat(64).slice(0, 64),
    reason: null,
    ...overrides,
  };
  return { ...body, receipt_digest: canonicalDigest(body) };
}

function panel(minimum, seats, overrides = {}) {
  return {
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: [],
    review_digest: DIGEST,
    sealed_min_panel_size: minimum,
    final_panel_count: seats.filter((item) => item.status === 'reviewed').length,
    final_panel_seat_receipts: seats,
    ...overrides,
  };
}

function run(minimum, panelReceipt) {
  return runCampaignComposition({
    maxRepairGenerations: 0,
    minPanelSize: minimum,
  }, {
    preflight: () => ({ passed: true }),
    implement: () => ({ committed: true, tree_sha: TREE }),
    scopeCheck: () => ({ passed: true }),
    verify: () => ({ passed: true, receipt_digest: DIGEST }),
    review: () => ({ reviewed: true }),
    adjudicate: () => ({
      registry_complete: true,
      repair_gate_passed: true,
      must_fix_now: [],
      follow_up: [],
      rejected: [],
    }),
    convergence: () => ({ passed: true }),
    finalPanel: () => panelReceipt,
  });
}

const undersized = run(3, panel(3, [seat(1)]));
assert.strictEqual(undersized.status, 'blocked');
assert.strictEqual(undersized.phase, 'final_panel');
assert.strictEqual(undersized.reason, 'final_panel_below_minimum');
assert.strictEqual(undersized.sealed_min_panel_size, 3);
assert.strictEqual(undersized.final_panel_count, 1);

const complete = run(3, panel(3, [seat(1), seat(2), seat(3)]));
assert.strictEqual(complete.status, 'ready');
assert.strictEqual(complete.sealed_min_panel_size, 3);
assert.strictEqual(complete.final_panel_count, 3);
assert.strictEqual(complete.final_panel_seat_receipts.length, 3);

const overMinimum = run(3, panel(3, [seat(1), seat(2), seat(3), seat(4)]));
assert.strictEqual(overMinimum.status, 'ready');
assert.strictEqual(overMinimum.final_panel_count, 4);

const explicitSingle = run(1, panel(1, [seat(1)]));
assert.strictEqual(explicitSingle.status, 'ready');
assert.strictEqual(explicitSingle.final_panel_count, 1);

const noVerdict = run(3, panel(3, [
  seat(1),
  seat(2),
  seat(3, {
    status: 'no_verdict',
    verdict: null,
    review_digest: null,
    reason: 'final_panel_seat_no_verdict',
  }),
]));
assert.strictEqual(noVerdict.status, 'blocked');
assert.strictEqual(noVerdict.reason, 'final_panel_seat_no_verdict');
assert.strictEqual(noVerdict.final_panel_count, 2);

const qualifiedRoster = {
  reviewer_qualified: true,
  reviewer_runner: 'primary-runner',
  reviewer_engine: 'primary-model',
  reviewer_effort: 'high',
  fallback_ladder: [{
    runner: 'panel-runner', model: 'panel-model', effort: 'high', family: 'panel-family',
  }],
};
assert.strictEqual(finalPanelSeatQualified(qualifiedRoster, {
  runner: 'panel-runner', model: 'panel-model', effort: 'high', family: 'panel-family',
}), true);
assert.strictEqual(finalPanelSeatQualified(qualifiedRoster, {
  runner: 'unqualified-runner', model: 'unqualified-model', effort: 'high', family: 'other',
}), false);
assert.strictEqual(finalPanelSeatQualified({
  ...qualifiedRoster,
  fallback_ladder: [{
    runner: 'cc-shim', model: 'same-model', effort: 'high', family: 'openai', endpoint: 'qualified_endpoint',
  }],
}, {
  runner: 'cc-shim', model: 'same-model', effort: 'high', family: 'openai', endpoint: 'unqualified_endpoint',
}), false);
const unqualifiedSeat = seat(3, {
  runner: 'unqualified-runner',
  model: 'unqualified-model',
  family: 'other',
  status: 'precondition_failed',
  verdict: null,
  review_digest: null,
  reason: 'final_panel_seat_precondition_failed',
});
const unqualifiedPanel = run(3, panel(3, [seat(1), seat(2), unqualifiedSeat]));
assert.strictEqual(unqualifiedPanel.status, 'blocked');
assert.strictEqual(unqualifiedPanel.reason, 'final_panel_seat_precondition_failed');

let pinnedArgs = null;
const pinEngine = new AutopilotEngine({
  reviewDispatcher(args) {
    pinnedArgs = args;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: { status: 'reviewed', verdict: 'SHIP-AS-IS', findings: 'none' },
    };
  },
});
const pinnedReview = pinEngine.reviewDiff({
  diffFile: '/tmp/qc-panel-fixture.diff',
  implementerEngine: 'claude-opus',
  requireQualifiedReviewer: true,
  pinReviewerTuple: true,
  roster: {
    reviewer_runner: 'fixture', reviewer_engine: 'gpt-5.6', reviewer_effort: 'high',
    reviewer_qualified: true, review_risk: 'low',
    reviewer_engine_low_risk: 'gpt-5.6-mini', reviewer_effort_low_risk: 'low',
    implementer_engine: 'claude-opus',
  },
});
assert.strictEqual(pinnedReview.status, 'reviewed');
assert.strictEqual(pinnedArgs[pinnedArgs.indexOf('--model') + 1], 'gpt-5.6');
const pinnedSameFamilySeat = pinEngine.reviewDiff({
  diffFile: '/tmp/qc-panel-fixture.diff',
  implementerEngine: 'gpt-5.6',
  requireQualifiedReviewer: true,
  pinReviewerTuple: true,
  roster: {
    reviewer_runner: 'fixture', reviewer_engine: 'gpt-5.6', reviewer_effort: 'high',
    reviewer_qualified: true, implementer_engine: 'gpt-5.6',
    on_family_conflict: 'fallback',
    fallback_ladder: [{ runner: 'fixture', model: 'claude-opus', effort: 'high', family: 'anthropic' }],
  },
});
assert.strictEqual(pinnedSameFamilySeat.status, 'reviewed');
assert.strictEqual(pinnedArgs[pinnedArgs.indexOf('--model') + 1], 'gpt-5.6');

const unpinnedFamilyConflict = pinEngine.reviewDiff({
  diffFile: '/tmp/qc-panel-fixture.diff',
  implementerEngine: 'gpt-5.6',
  requireQualifiedReviewer: true,
  roster: {
    reviewer_runner: 'fixture', reviewer_engine: 'gpt-5.6', reviewer_effort: 'high',
    reviewer_qualified: true, implementer_engine: 'gpt-5.6',
    on_family_conflict: 'block',
  },
});
assert.strictEqual(unpinnedFamilyConflict.status, 'blocked');
assert.strictEqual(unpinnedFamilyConflict.phase, 'reviewer_family');

assert.strictEqual(terminalPanelCrossFamilySatisfied({
  implementer_engine: 'gpt-5.6',
  required_review_families: 1,
  cross_family_required: true,
}, [
  { model: 'gpt-5.5', family: 'openai' },
  { model: 'codex-5.4', family: 'openai' },
  { model: 'o3', family: 'openai' },
]), false);
assert.strictEqual(terminalPanelCrossFamilySatisfied({
  implementer_engine: 'gpt-5.6',
  required_review_families: 1,
  min_panel_size: 3,
  cross_family_required: true,
}, [
  { model: 'claude-opus', family: 'anthropic' },
  { model: 'claude-sonnet', family: 'anthropic' },
  { model: 'claude-haiku', family: 'anthropic' },
]), false);
assert.strictEqual(terminalPanelCrossFamilySatisfied({
  implementer_engine: 'gpt-5.6',
  required_review_families: 2,
  cross_family_required: true,
}, [
  { model: 'gpt-5.5', family: 'openai' },
  { model: 'claude-opus', family: 'anthropic' },
  { model: 'grok-4.5', family: 'xai' },
]), true);

const duplicate = seat(2, { seat_index: 3 });
const duplicateTuple = run(3, panel(3, [seat(1), seat(2), duplicate]));
assert.strictEqual(duplicateTuple.status, 'blocked');
assert.strictEqual(duplicateTuple.reason, 'final_panel_duplicate_tuple');

const incompleteBody = { ...seat(1) };
delete incompleteBody.family;
const incomplete = run(1, panel(1, [incompleteBody]));
assert.strictEqual(incomplete.status, 'blocked');
assert.strictEqual(incomplete.reason, 'final_panel_metadata_incomplete');

assert.throws(
  () => runCampaignComposition({ maxRepairGenerations: 0 }, {}),
  (error) => error && error.code === 'INVALID_PANEL_MINIMUM',
);

console.log('qc-panel-honesty assertions passed');
NODE
)"

assert_contains "$OUT" "qc-panel-honesty assertions passed" "QC panel honesty oracle passes"
finalize_test
