#!/usr/bin/env bash
# KR3 repair ladder — STATELESS form (2026-08-21 pre-merge review killed the
# durable-lock variant: unreachable release = permanent Mission deadlock).
# The whole gate lives at the terminalization edge: a BOUNDARY_REJECTED-admitted
# campaign with a GIT-VERIFIABLE candidate cannot be converted to a terminal
# without repair evidence; without a verifiable candidate, terminalization
# PROCEEDS (refusing would deadlock a legitimately dead campaign).
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
const assert = require('assert');
const root = process.argv[2];
const ladder = require(`${root}/src/engine/repair-ladder.js`);
const { AutopilotEngine } = require(`${root}/src/engine/autopilot-engine.js`);
let n = 0;
const check = (name, cond) => { n++; assert.ok(cond, name); };

// ── layer 1: predicate ──
const boundary = ladder.extractBoundaryEvidence({
  phase: 'BOUNDARY_REJECTED',
  boundary_rejected: {
    candidate_ref: 'c'.repeat(40),
    reason: 'boundary_rejected: changed path violates scope',
    receipt_digest: 'a'.repeat(64),
  },
});
check('boundary extracted from the DURABLE reducer shape (reason/receipt_digest mapping)',
  boundary && boundary.candidate_ref === 'c'.repeat(40)
  && boundary.boundary_reason === 'boundary_rejected: changed path violates scope'
  && boundary.failure_output_sha256 === 'a'.repeat(64));
check('no-phase → null', ladder.extractBoundaryEvidence({ phase: 'PREPARED' }) === null);
check('no candidate → null', ladder.extractBoundaryEvidence({ phase: 'BOUNDARY_REJECTED', boundary_rejected: {} }) === null);

const red = ladder.evaluateRepairLadder({ boundary, context: 't' });
check('zero-delta refused', red.ok === false && red.code === 'MISSION_REPAIR_REQUIRED');
check('refusal names the cheap repair', /resume the SAME campaign/.test(red.remedy));
check('verdict-changed rerun repairs',
  ladder.evaluateRepairLadder({ boundary, rerun: { outcome: 'ready' } }).ok === true);
check('follow_up counts',
  ladder.evaluateRepairLadder({ boundary, rerun: { outcome: 'follow_up' } }).ok === true);
check('engine bypass (closed enum) passes',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'engine', classification: 'timeout' } }).ok === true);
check('controller-shaped evidence never bypasses',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'controller', classification: 'timeout' } }).ok === false);
check('free-text never bypasses',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'engine', classification: 'operator said so' } }).ok === false);
check('no boundary → no-op', ladder.evaluateRepairLadder({ boundary: null }).ok === true);
check('named-extras shrink branch stays bound to prior hash',
  ladder.evaluateRepairLadder({ boundary: { ...boundary, named_extras: ['x','y'] }, rerun: {
    outcome: 'blocked', named_extras: ['x'], prior_failure_output_sha256: 'b'.repeat(64),
  } }).ok === false);

// ── layer 2: engine edge (frozen call edge's method; stateless) ──
const method = AutopilotEngine.prototype.terminalizeManagedCampaignFailure;
// PRODUCTION SHAPE (R2 review 🔴): intake attaches resume bindings to the
// generation-claim object. `claimExtra` spreads INSIDE generation_claim —
// fixtures must never re-grow the top-level shape the gate wrongly read once.
const mkControl = (phase, claimExtra = {}, extra = {}) => ({
  status: 'admitted',
  campaign_id: 'campaign-v1-' + 'd'.repeat(64),
  contract_digest: 'e'.repeat(64),
  generation_claim: { durable_journal: true, ...claimExtra },
  initial_state: {
    phase,
    event_count: 3,
    live_lease: null,
    generation: 1,
    boundary_rejected: phase === 'BOUNDARY_REJECTED'
      ? { candidate_ref: 'f'.repeat(40), reason: 'scope', receipt_digest: 'a'.repeat(64) }
      : null,
  },
  ...extra,
});
const GIT_CAND = { resume_candidate: { kind: 'git_candidate', commit: 'f'.repeat(40) } };
const thisStub = { now: () => '2026-08-21T00:00:00.000Z' };

// planted red: git-bound candidate on the GENERATION CLAIM + zero delta → refused
const guardRed = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED', GIT_CAND),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('refuses converting a REPAIRABLE rejection to terminal (production shape)',
  guardRed.status === 'rejected' && guardRed.code === 'MISSION_REPAIR_REQUIRED');
check('refusal carries remedy', /resume the SAME campaign/.test(guardRed.remedy));

// deadlock-avoidance green: boundary, NO git-bound candidate → proceeds
const guardDead = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED'),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('NO verifiable candidate → terminalization proceeds (no deadlock)',
  !(guardDead.status === 'rejected' && guardDead.code === 'MISSION_REPAIR_REQUIRED'));

// R2-adjudicated planted case: RECORDED candidate_ref (durable-wait string,
// no git object bound) must NOT trigger the gate — admitting it reinstates
// the no-git-object livelock trace.
const guardRecorded = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED',
    { resume_durable_wait: { candidate_ref: 'f'.repeat(40), no_op: true } }),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('recorded-ref-without-git-object terminalizes freely (livelock guard)',
  !(guardRecorded.status === 'rejected' && guardRecorded.code === 'MISSION_REPAIR_REQUIRED'));

// reverse-shape pin (R2 review): the TOP-LEVEL shape production never emits
// must NOT trigger the gate — a fixture anchored there certifies a dead gate.
const guardTopLevel = method.call(thisStub, {
  campaignControl: {
    ...mkControl('BOUNDARY_REJECTED'),
    resume_candidate: { kind: 'git_candidate', commit: 'f'.repeat(40) },
  },
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('top-level resume_candidate (non-production shape) does NOT trigger',
  !(guardTopLevel.status === 'rejected' && guardTopLevel.code === 'MISSION_REPAIR_REQUIRED'));

// bypass green
const guardBypass = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED', GIT_CAND,
    { engine_terminal_evidence: { source: 'engine', classification: 'wall_budget_exhausted' } }),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('engine-derived terminal evidence bypasses',
  !(guardBypass.status === 'rejected' && guardBypass.code === 'MISSION_REPAIR_REQUIRED'));

// repaired green
const guardRepaired = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED', GIT_CAND, { repair_rerun: { outcome: 'ready' } }),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('changed-verdict rerun unlocks',
  !(guardRepaired.status === 'rejected' && guardRepaired.code === 'MISSION_REPAIR_REQUIRED'));

// fresh failure untouched
const guardFresh = method.call(thisStub, {
  campaignControl: mkControl('IMPLEMENTING'),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('fresh (non-BOUNDARY_REJECTED admission) failures terminalize freely',
  !(guardFresh.status === 'rejected' && guardFresh.code === 'MISSION_REPAIR_REQUIRED'));

// stateless invariant: no lock machinery exists anywhere
check('no durable-lock exports remain (stateless by review ruling)',
  ladder.buildRepairLock === undefined && ladder.anyUnreleasedRepairLock === undefined);

console.log(`OK ${n} node assertions`);
NODE
assert_eq "$?" "0" "node assertion block green"

# stateless invariant at repo level: no repair_lock writer outside the lib+test
HITS=$(grep -rln "repair_lock" "$REPO_ROOT/src" 2>/dev/null | grep -v repair-ladder.js | wc -l)
assert_eq "$HITS" "0" "no src/ file writes or reads repair_lock (lock machinery fully removed)"

finalize_test
