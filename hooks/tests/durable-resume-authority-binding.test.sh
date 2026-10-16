#!/usr/bin/env bash
# hooks/tests/durable-resume-authority-binding.test.sh
#
# BL-0080: durable resume and review authority binding.
#   1. every durable stop payload (awaiting disposition, awaiting convergence,
#      boundary rejected) validates verbatim as a resume checkpoint;
#   2. a full-diff barrier authorizes repair only of the candidate and the review
#      kind it was recorded for;
#   3. a different sealed reviewer roster does not reuse a full-diff verdict.
# Each section is paired with a positive control so a blanket refusal is red too.

set -euo pipefail
. "$(dirname "$0")/lib.sh"
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $REPO_ROOT/hooks/tests/lib/explicit-admission-preload.js"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));
const { runCampaignComposition } = require(path.join(root, 'src', 'engine', 'campaign-composition'));
const { adjudicateCampaignReview } = require(path.join(root, 'src', 'engine', 'campaign-adjudication'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

const CAND = {
  committed: true, commit: '1'.repeat(40), tree_sha: '2'.repeat(40), base_sha: '0'.repeat(40),
  branch: 'feat/x', dispatcher_called: true, model_calls: 1, fresh_input_bytes: 1,
};
const seat = () => {
  const s = {
    schema_version: 1, artifact_type: 'implementation_campaign_final_panel_seat', seat_index: 1,
    runner: 'f', model: 'm', effort: 'high', endpoint: null, family: 'f',
    status: 'reviewed', verdict: 'SHIP-AS-IS', review_digest: 'f'.repeat(64), reason: null,
  };
  s.receipt_digest = canonicalDigest(s);
  return s;
};
const verification = () => {
  const body = { schema_version: 1, artifact_type: 'implementation_campaign_verification', verdict: 'GREEN', exit_status: 0 };
  const receipt = { ...body, receipt_digest: canonicalDigest(body) };
  return { passed: true, receipt_digest: receipt.receipt_digest, receipt };
};
const blue = { finding_id: 'b-1', claim: 'naming nit', severity: '🔵', source: 'fixture' };
const orange = { finding_id: 'o-1', claim: 'real defect', severity: '🟠', source: 'fixture' };
function make({ findings = [], implement, reviewCalls } = {}) {
  return {
    preflight: () => ({ passed: true }),
    preEffectAdmit: () => ({ ok: true }),
    implement: implement || (() => ({ ...CAND })),
    scopeCheck: () => ({ passed: true }),
    verify: verification,
    review: () => {
      if (reviewCalls) reviewCalls.n += 1;
      return {
        reviewed: true, success: true, review_input_mode: 'full_diff_generation',
        verdict: findings.length ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
        findings: JSON.stringify(findings), review_digest: 'd'.repeat(64),
      };
    },
    adjudicate: ({ review }) => adjudicateCampaignReview({ review }),
    convergence: () => ({ passed: true }),
    finalPanel: () => ({
      reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: 'e'.repeat(64),
      sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat()],
    }),
  };
}
const input = (extra = {}) => ({
  maxRepairGenerations: 2, minPanelSize: 1, promptBytes: 0,
  controller: ctrl.emptyControllerState({ started_at_ms: Date.now() - 1000 }),
  ...extra,
});
// Feed a stop back verbatim; the checkpoint validator must not be what refuses it.
function resumeCode(stop, adapters) {
  try {
    runCampaignComposition(input({ resume: stop }), adapters);
    return null;
  } catch (e) { return e.code || String(e.message); }
}

// 1. durable stop payloads validate verbatim as resume checkpoints.
let dispositionStop;
run('stop: awaiting disposition', () => {
  dispositionStop = runCampaignComposition(input(), make({ findings: [blue] }));
  assert.strictEqual(dispositionStop.status, 'awaiting_disposition', JSON.stringify(dispositionStop).slice(0, 300));
  assert.notStrictEqual(resumeCode(dispositionStop, make({ findings: [blue] })), 'INVALID_RESUME_CHECKPOINT');
});
run('stop: boundary rejected (with and without a candidate)', () => {
  const boundary = (commit) => ({
    committed: false, status: 'boundary_rejected', phase: 'boundary_rejected', error: 'scope violation',
    boundary_code: 'scope_violation', candidate_ref: commit, commit, possibly_effectful: Boolean(commit),
    dispatcher_called: true, model_calls: 1,
  });
  for (const commit of ['a'.repeat(40), null]) {
    const stop = runCampaignComposition(input(), make({ implement: () => boundary(commit) }));
    assert.strictEqual(stop.status, 'boundary_rejected', JSON.stringify(stop).slice(0, 300));
    assert.notStrictEqual(resumeCode(stop, make({ implement: () => boundary(commit) })), 'INVALID_RESUME_CHECKPOINT',
      `boundary stop candidate=${commit}`);
  }
});
run('stop: awaiting convergence (initial and repair)', () => {
  for (const limit of [0, 1]) {
    const stop = runCampaignComposition(input({
      controller: ctrl.emptyControllerState({
        started_at_ms: Date.now() - 1000,
        repair_budget_limits: ctrl.defaultBudgetLimits({ model_calls: limit }),
      }),
    }), make({ findings: [orange] }));
    assert.strictEqual(stop.phase, 'awaiting_convergence_adjudication', `limit ${limit}: ${JSON.stringify(stop).slice(0, 300)}`);
    assert.notStrictEqual(resumeCode(stop, make({ findings: [orange] })), 'INVALID_RESUME_CHECKPOINT',
      `convergence stop with model_calls limit ${limit}`);
  }
});
run('resume validator still refuses an incomplete checkpoint', () => {
  const base = { phase: 'awaiting_disposition', repair_generation: 0, candidate: { ...CAND } };
  assert.strictEqual(resumeCode({ ...base, repair_generation: undefined }, make()), 'INVALID_RESUME_CHECKPOINT');
  const noCandidateKey = { ...base }; delete noCandidateKey.candidate;
  assert.strictEqual(resumeCode(noCandidateKey, make()), 'INVALID_RESUME_CHECKPOINT');
  // A null candidate is only legitimate for stops that can precede any candidate.
  assert.strictEqual(resumeCode({ ...base, candidate: null }, make()), 'INVALID_RESUME_CHECKPOINT');
  assert.strictEqual(resumeCode({ ...base, candidate: { ...CAND, committed: false } }, make()), 'INVALID_RESUME_CHECKPOINT');
});

// 2. full-diff barrier is bound to the candidate and the review kind.
run('barrier bound to candidate', () => {
  const full = ctrl.recordFullDiffBarrier({}, 0, { kind: 'full_diff_review', success: true, review_digest: 'r', candidate_ref: 'cand-A' });
  const ok = ctrl.requireFullDiffBeforeRepair({ generation: 0, fullDiffBarriers: full, candidateRef: 'cand-A' });
  assert.strictEqual(ok.allow_repair, true, 'same candidate (positive control)');
  const swapped = ctrl.requireFullDiffBeforeRepair({ generation: 0, fullDiffBarriers: full, candidateRef: 'cand-B' });
  assert.strictEqual(swapped.allow_repair, false);
  assert.strictEqual(swapped.code, 'FULL_DIFF_BARRIER_CANDIDATE_MISMATCH');
  const unstated = ctrl.requireFullDiffBeforeRepair({ generation: 0, fullDiffBarriers: full });
  assert.strictEqual(unstated.allow_repair, false, 'a caller that does not name the candidate is refused');
});
run('barrier minted only by a full-diff review', () => {
  for (const kind of ['focused_supplement', undefined, null, 'joint_review']) {
    assert.throws(() => ctrl.recordFullDiffBarrier({}, 0, { kind, success: true, review_digest: 'r', candidate_ref: 'c' }),
      (e) => e.code === 'INVALID_FULL_DIFF_BARRIER', `kind ${kind}`);
  }
  assert.ok(ctrl.recordFullDiffBarrier({}, 0, { kind: 'full_diff_review', success: true, candidate_ref: 'c' })['0']);
});

// 3. at the panel station a different sealed reviewer roster does not reuse the
// full-diff verdict (the verdict IS the roster's); a single-reviewer station keeps
// reusing across roster changes, because it is keyed by its own reviewer tuple.
function panelAdapters(calls) {
  const a = make();
  a.reviewPanel = () => {
    calls.n += 1;
    return {
      reviewed: true, success: true, review_input_mode: 'full_diff_generation',
      verdict: 'SHIP-AS-IS', findings: '[]', review_digest: 'd'.repeat(64),
      packet_hash: 'c'.repeat(64),
      sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat()],
    };
  };
  return a;
}
run('panel station: full-diff reuse keyed by reviewer roster', () => {
  const calls = { n: 0 };
  const base = (roster, controller) => input({
    reviewStation: 'panel', jointReviewRosterDigest: roster, includeControllerMeta: true,
    baseSha: CAND.base_sha, ...(controller ? { controller } : {}),
  });
  const first = runCampaignComposition(base('a'.repeat(64)), panelAdapters(calls));
  assert.strictEqual(first.status, 'ready', JSON.stringify(first).slice(0, 400));
  assert.strictEqual(calls.n, 1);
  const before = calls.n;
  const same = runCampaignComposition(base('a'.repeat(64), first.controller), panelAdapters(calls));
  assert.ok(same.trace.includes('full_diff_gate_reused'), `same roster reuses (positive control): ${same.trace}`);
  assert.strictEqual(calls.n, before, 'same roster: no new panel review');
  const rotated = runCampaignComposition(base('b'.repeat(64), first.controller), panelAdapters(calls));
  assert.ok(!rotated.trace.includes('full_diff_gate_reused'), 'rotated roster must not reuse the verdict');
  assert.strictEqual(calls.n, before + 1, 'rotated roster: the panel full-diff review runs again');
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('durable resume authority binding assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0080 durable resume and review authority binding assertions"

finalize_test
