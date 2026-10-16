#!/usr/bin/env bash
# A final panel that returns findings with no bound disposition authority parks
# (durable wait) instead of terminal-stopping; a clean final panel is unchanged.
. "$(dirname "$0")/lib.sh"
# BL-0077: composition fixtures make effect admission an explicit adapter.
export NODE_OPTIONS="${NODE_OPTIONS:-} --require $REPO_ROOT/hooks/tests/lib/explicit-admission-preload.js"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const {
  runCampaignComposition,
  compileCampaignDispositionProvider,
} = require(path.join(root, 'src', 'engine'));
const { adjudicateCampaignReview } = require(path.join(root, 'src', 'engine', 'campaign-adjudication'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));

const D = 'a'.repeat(64);
const CAMPAIGN_ID = `campaign-v1-${'b'.repeat(64)}`;
const FULL_DIFF_DIGEST = 'c'.repeat(64);
const PANEL_DIGEST = '7'.repeat(64);
const ROSTER = 'e'.repeat(64);
const candidate = {
  committed: true, commit: '1'.repeat(40), tree_sha: '2'.repeat(40),
  branch: 'feat/final-park', writer_fence: { receipt_digest: '3'.repeat(64) },
};
const blueFinding = {
  finding_id: 'fp-001', claim: 'naming nit in the final panel', severity: '🔵', source: 'fixture',
};
const seat = (status) => {
  const s = {
    schema_version: 1, artifact_type: 'implementation_campaign_final_panel_seat', seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status, verdict: status === 'reviewed' ? 'SHIP-AS-IS' : null,
    review_digest: status === 'reviewed' ? PANEL_DIGEST : null,
    reason: status === 'reviewed' ? null : 'seat fault',
  };
  s.receipt_digest = canonicalDigest(s);
  return s;
};
const panelWith = (findings) => () => ({
  reviewed: true,
  verdict: findings.length ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
  findings: JSON.stringify(findings),
  review_digest: PANEL_DIGEST,
  sealed_min_panel_size: 1, final_panel_count: 1, final_panel_seat_receipts: [seat('reviewed')],
});
const faultPanel = () => ({
  reviewed: false, verdict: null, findings: '[]', review_digest: PANEL_DIGEST,
  sealed_min_panel_size: 1, final_panel_count: 0, final_panel_seat_receipts: [seat('failed')],
});
const engineAdjudicate = (provider) => ({ review, final }) => {
  let dispositionAuthority = null;
  if (provider) {
    try {
      dispositionAuthority = provider({ review, final, campaignId: CAMPAIGN_ID, contractDigest: D });
    } catch (error) {
      return {
        registry_complete: false, repair_gate_passed: false, reason: error.message,
        must_fix_now: [], follow_up: [], rejected: [],
      };
    }
  }
  return adjudicateCampaignReview({
    review, convergenceVerdict: 'SHIP-AS-IS', dispositionAuthority,
    now: '2026-10-13T00:00:00.000Z',
  });
};
const inloopFinding = {
  finding_id: 'il-001', claim: 'naming nit in the in-loop review', severity: '🔵', source: 'fixture',
};
const adapters = (finalPanel, provider, sink, inloopFindings = []) => ({
  preflight: () => ({ passed: true }),
  implement: () => candidate,
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: '4'.repeat(64) }),
  review: () => ({
    reviewed: true, success: true,
    verdict: inloopFindings.length ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS',
    findings: JSON.stringify(inloopFindings),
    review_digest: FULL_DIFF_DIGEST,
  }),
  adjudicate: engineAdjudicate(provider),
  convergence: () => ({ passed: true }),
  finalPanel: (...args) => { sink.panelCalls += 1; return finalPanel(...args); },
  onControllerUpdate: (c) => sink.controllers.push(JSON.parse(JSON.stringify(c))),
  onCampaignEvent: (e) => sink.events.push(e.event_type),
});
const input = (extra = {}) => ({
  promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1, jointReviewRosterDigest: ROSTER, ...extra,
});
// entries: [[review_digest, finding_id], ...] — one reviews[] entry each.
const authorityOver = (entries) => compileCampaignDispositionProvider({
  schema_version: 1, artifact_type: 'campaign_disposition_authority', authority: 'depth-0',
  actor_id: 'owner/root', campaign_id: CAMPAIGN_ID, contract_digest: D,
  reviews: entries.map(([digest, findingId]) => ({
    review_digest: digest,
    decisions: [{
      finding_id: findingId,
      evidence: { kind: 'trace', trace_chain: ['test:final-park'], confirmed_by: 'owner/root' },
      disposition: {
        disposition: 'follow-up', context: 'naming nit', trigger: 'next touch of the file',
        proposed_backlog_title: `Rename the nit ${findingId}`,
      },
    }],
  })),
});
const authorityFor = (digest) => authorityOver([[digest, blueFinding.finding_id]]);
const sink = () => ({ controllers: [], events: [], panelCalls: 0 });
const resumeFrom = (c) => ({
  phase: c.phase, repair_generation: 0, candidate: c.candidate, controller: c,
  verification: c.verification_receipt, review: c.review_payload,
  findings: c.findings_snapshot, full_diff_barriers: c.full_diff_barriers,
});

// (1) findings, no authority => parked, not blocked/terminal.
const s1 = sink();
const parked = runCampaignComposition(input(), adapters(panelWith([blueFinding]), null, s1));
assert.strictEqual(parked.status, 'awaiting_disposition', parked.reason);
assert.strictEqual(parked.durable_wait, true);
assert.strictEqual(parked.terminalize, false);
const pc = s1.controllers.at(-1);
assert.strictEqual(pc.phase, 'awaiting_disposition');
assert.strictEqual(pc.next_action, 'await_final_disposition_authority');
assert.deepStrictEqual(pc.findings_snapshot, []);
assert.strictEqual(s1.events.at(-1), 'AWAITING_DISPOSITION');
console.log('final_panel_findings_park=true');
// The receipt's review is the panel the findings and the authority bind; the
// stored resume input stays the in-loop full-diff review.
assert.strictEqual(parked.review.review_digest, PANEL_DIGEST);
assert.strictEqual(pc.review_payload.review_digest, FULL_DIFF_DIGEST);
console.log('final_panel_park_receipt_review_is_panel=true');

// (2) resume with an authority bound to the stored panel digest => terminal, no new panel call.
const s2 = sink();
const done = runCampaignComposition(
  input({ controller: pc, resume: resumeFrom(pc) }),
  adapters(panelWith([blueFinding]), authorityFor(PANEL_DIGEST), s2),
);
assert.ok(['follow_up', 'ready'].includes(done.status), `${done.status}: ${done.reason}`);
assert.strictEqual(s2.panelCalls, 0, 'resume must not call the final panel again');
console.log('final_panel_resume_terminal_no_panel_call=true');

// (3) authority bound to another digest => still not terminal success.
const s3 = sink();
const bad = runCampaignComposition(
  input({ controller: pc, resume: resumeFrom(pc) }),
  adapters(panelWith([blueFinding]), authorityFor(FULL_DIFF_DIGEST), s3),
);
assert.ok(!['follow_up', 'ready'].includes(bad.status), `stale authority reached ${bad.status}`);
assert.strictEqual(bad.status, 'awaiting_disposition');
assert.strictEqual(s3.panelCalls, 0);
console.log('final_panel_stale_authority_rejected=true');

// (4) a seat fault still fails at final_panel.
const s4 = sink();
const fault = runCampaignComposition(input(), adapters(faultPanel, null, s4));
assert.strictEqual(fault.status, 'blocked');
assert.strictEqual(fault.phase, 'final_panel');
assert.notStrictEqual(fault.durable_wait, true);
console.log('final_panel_seat_fault_still_fails=true');

// (5) clean final panel is unchanged: terminal ready.
const s5 = sink();
const clean = runCampaignComposition(input(), adapters(panelWith([]), null, s5));
assert.strictEqual(clean.status, 'ready', clean.reason);
console.log('final_panel_clean_unchanged=true');

// (6) in-loop review had a finding: in-loop park -> INLOOP authority -> final
// park -> PANEL-only authority must park again (the resume re-adjudicates the
// in-loop review), never terminal-stop; INLOOP+PANEL reaches follow_up.
const s6a = sink();
const inloopParked = runCampaignComposition(
  input(), adapters(panelWith([blueFinding]), null, s6a, [inloopFinding]),
);
assert.strictEqual(inloopParked.status, 'awaiting_disposition', inloopParked.reason);
const c6a = s6a.controllers.at(-1);
assert.strictEqual(c6a.next_action, 'await_disposition_authority');
assert.strictEqual(s6a.panelCalls, 0);
const s6b = sink();
const finalParked = runCampaignComposition(
  input({ controller: c6a, resume: resumeFrom(c6a) }),
  adapters(panelWith([blueFinding]), authorityOver([[FULL_DIFF_DIGEST, inloopFinding.finding_id]]),
    s6b, [inloopFinding]),
);
assert.strictEqual(finalParked.status, 'awaiting_disposition', finalParked.reason);
const c6b = s6b.controllers.at(-1);
assert.strictEqual(c6b.next_action, 'await_final_disposition_authority');
assert.strictEqual(s6b.panelCalls, 1);
assert.strictEqual(finalParked.review.review_digest, PANEL_DIGEST);
const s6c = sink();
const panelOnly = runCampaignComposition(
  input({ controller: c6b, resume: resumeFrom(c6b) }),
  adapters(panelWith([blueFinding]), authorityFor(PANEL_DIGEST), s6c, [inloopFinding]),
);
assert.notStrictEqual(panelOnly.status, 'blocked', `panel-only authority terminal-stopped: ${panelOnly.reason}`);
assert.strictEqual(panelOnly.status, 'awaiting_disposition', panelOnly.reason);
assert.strictEqual(panelOnly.durable_wait, true);
assert.notStrictEqual(panelOnly.resumable, false);
const c6c = s6c.controllers.at(-1);
assert.strictEqual(c6c.phase, 'awaiting_disposition');
assert.strictEqual(c6c.next_action, 'await_final_disposition_authority');
assert.deepStrictEqual(s6c.events, [], 'journal stays in AWAITING_DISPOSITION: no event');
assert.strictEqual(s6c.panelCalls, 0);
console.log('final_panel_inloop_authority_missing_reparks=true');
const s6d = sink();
const both = runCampaignComposition(
  input({ controller: c6c, resume: resumeFrom(c6c) }),
  adapters(panelWith([blueFinding]), authorityOver([
    [FULL_DIFF_DIGEST, inloopFinding.finding_id], [PANEL_DIGEST, blueFinding.finding_id],
  ]), s6d, [inloopFinding]),
);
assert.strictEqual(both.status, 'follow_up', both.reason);
assert.strictEqual(s6d.panelCalls, 0);
const followIds = both.follow_up.map((f) => f.id || f.finding_id).sort();
assert.deepStrictEqual(followIds, [blueFinding.finding_id, inloopFinding.finding_id].sort());
assert.ok(s6d.events.includes('DISPOSITION_RESUMED'));
console.log('final_panel_inloop_and_panel_authority_follow_up=true');
NODE
)"
assert_exit_code "$?" "0" "final-panel park process exits zero: $OUT"
for key in final_panel_findings_park final_panel_resume_terminal_no_panel_call \
  final_panel_stale_authority_rejected final_panel_seat_fault_still_fails \
  final_panel_clean_unchanged final_panel_park_receipt_review_is_panel \
  final_panel_inloop_authority_missing_reparks final_panel_inloop_and_panel_authority_follow_up; do
  assert_contains "$OUT" "$key=true" "final-panel park proves $key"
done

finalize_test
