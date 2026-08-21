#!/usr/bin/env bash
# KR3 repair ladder (plan R2' 2026-08-21): planted red/green/bypass across the
# predicate, the reducer backstops, the engine first-hit guard, and the CLI edge.
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
const assert = require('assert');
const root = process.argv[2];
const ladder = require(`${root}/src/engine/repair-ladder.js`);
const mission = require(`${root}/src/engine/mission-convergence.js`);
const { AutopilotEngine } = require(`${root}/src/engine/autopilot-engine.js`);
let n = 0;
const check = (name, cond) => { n++; assert.ok(cond, name); };

// ── layer 1: predicate ──
const boundary = ladder.extractBoundaryEvidence({
  phase: 'BOUNDARY_REJECTED',
  boundary_rejected: {
    candidate_ref: 'c'.repeat(40),
    boundary_code: 'scope_or_budget_boundary',
    failure_output_sha256: 'a'.repeat(64),
    named_extras: ['x', 'y'],
  },
});
check('boundary extracted', boundary && boundary.candidate_ref === 'c'.repeat(40));
check('no-phase → null', ladder.extractBoundaryEvidence({ phase: 'PREPARED' }) === null);
check('no candidate → null (nothing repairable)',
  ladder.extractBoundaryEvidence({ phase: 'BOUNDARY_REJECTED', boundary_rejected: {} }) === null);

// planted red: zero-delta expansion attempt
const red = ladder.evaluateRepairLadder({ boundary, context: 't' });
check('zero-delta refused', red.ok === false && red.code === 'MISSION_REPAIR_REQUIRED');
check('refusal is explanation-first (names the cheap repair)', /resume the SAME campaign/.test(red.remedy));

// greens
check('verdict-changed rerun repairs',
  ladder.evaluateRepairLadder({ boundary, rerun: { outcome: 'ready' } }).ok === true);
check('follow_up counts as changed verdict',
  ladder.evaluateRepairLadder({ boundary, rerun: { outcome: 'follow_up' } }).ok === true);
check('extras strict shrink bound to prior hash repairs',
  ladder.evaluateRepairLadder({ boundary, rerun: {
    outcome: 'blocked', named_extras: ['x'], prior_failure_output_sha256: 'a'.repeat(64),
  } }).ok === true);
check('unbound shrink (wrong prior hash) does NOT repair',
  ladder.evaluateRepairLadder({ boundary, rerun: {
    outcome: 'blocked', named_extras: ['x'], prior_failure_output_sha256: 'b'.repeat(64),
  } }).ok === false);
check('equal extras (no shrink) does NOT repair',
  ladder.evaluateRepairLadder({ boundary, rerun: {
    outcome: 'blocked', named_extras: ['x', 'y'], prior_failure_output_sha256: 'a'.repeat(64),
  } }).ok === false);
check('engine terminal bypass (closed enum) passes',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'engine', classification: 'timeout' } }).ok === true);
check('controller-shaped evidence never bypasses',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'controller', classification: 'timeout' } }).ok === false);
check('free-text classification never bypasses',
  ladder.evaluateRepairLadder({ boundary, terminalEvidence: { source: 'engine', classification: 'operator said so' } }).ok === false);
check('no boundary → no-op', ladder.evaluateRepairLadder({ boundary: null }).ok === true);

// ── layer 2: engine first-hit guard (method-level, minimal this) ──
const method = AutopilotEngine.prototype.terminalizeManagedCampaignFailure;
const mkControl = (phase, extra = {}) => ({
  status: 'admitted',
  campaign_id: 'campaign-v1-' + 'd'.repeat(64),
  contract_digest: 'e'.repeat(64),
  generation_claim: { durable_journal: true },
  initial_state: {
    phase,
    event_count: 3,
    live_lease: null,
    generation: 1,
    boundary_rejected: phase === 'BOUNDARY_REJECTED'
      ? { candidate_ref: 'f'.repeat(40), boundary_code: 'scope_or_budget_boundary' }
      : null,
  },
  ...extra,
});
const thisStub = {
  now: () => '2026-08-21T00:00:00.000Z',
  persistMissionRepairLock: () => false,
};
const guardRed = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED'), reason: 'x', phase: 'y', cwd: '/tmp',
});
check('engine guard: BOUNDARY_REJECTED admission cannot terminalize without repair',
  guardRed.status === 'rejected' && guardRed.code === 'MISSION_REPAIR_REQUIRED');
const guardBypass = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED', {
    engine_terminal_evidence: { source: 'engine', classification: 'wall_budget_exhausted' },
  }),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('engine guard: engine-derived terminal evidence bypasses',
  guardBypass.status !== 'rejected' || guardBypass.code !== 'MISSION_REPAIR_REQUIRED');
const guardRepaired = method.call(thisStub, {
  campaignControl: mkControl('BOUNDARY_REJECTED', { repair_rerun: { outcome: 'ready' } }),
  reason: 'x', phase: 'y', cwd: '/tmp',
});
check('engine guard: changed-verdict rerun unlocks',
  guardRepaired.status !== 'rejected' || guardRepaired.code !== 'MISSION_REPAIR_REQUIRED');

// ── layer 3: mission reducer backstops ──
// abort_finalized with a locked claim refuses (state untouched)
const lockedState = {
  state: 'ABORTING',
  mission_lineage_id: 'lineage-v1-' + '1'.repeat(64),
  claims: {
    k1: {
      claim_id: 'k1', released: false,
      repair_lock: ladder.buildRepairLock({
        boundary, iccCampaignId: null, lockedAt: 't',
      }),
    },
  },
  events: [],
};
// (reducer-level abort refusal asserted in layer 4 against a fully VALID state)

// helper coverage
check('anyUnreleasedRepairLock finds the claim',
  ladder.anyUnreleasedRepairLock(lockedState).claim_id === 'k1');
check('released claim does not lock',
  ladder.anyUnreleasedRepairLock({ claims: { k1: { ...lockedState.claims.k1, released: true } } }) === null);

console.log(`OK ${n} node assertions`);
NODE
RC=$?
assert_eq "$RC" "0" "node assertion block green"

# ── layer 4: CLI in-situ (real bin entry) — finalize-abort refuses, writes nothing ──
STATE="$TEST_TMP/locked-state.json"
OUT="$TEST_TMP/final-out.json"
node - "$REPO_ROOT" "$STATE" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
const ladder = require(path.join(root, 'src', 'engine', 'repair-ladder'));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const contract = {
  schema_version: 1, artifact_type: 'mission_convergence_contract',
  contract_id: 'mission-v1-' + sha('t'), repo_identity: 'r',
  mission_lineage_id: 'lineage-v1-' + sha('L'), task_authority_id: sha('TA'),
  policy_hash: sha('P'), enforcement_mode: 'shadow', state: 'DRAFT',
  closure_ratio: 0.75, max_stagnant_campaigns: 2,
  axes: Object.fromEntries(['campaigns','wall_seconds','tool_calls','engine_attempts','external_wait_seconds','canonical_changed_files','output_bytes']
    .map((k) => [k, { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true }])),
  grant_contract: { idempotency_key_required: true, single_use: true, expiry_seconds: 3600,
    bindings: ['mission_lineage_id','task_authority_id','campaign_id','campaign_contract_digest','base_sha','acceptance_ids'] },
  control_contract: { actions: ['ceiling_adjust','scope_frozen','finish_requested','abort_requested'],
    allowed_authorities: ['authenticated_user','authenticated_doa','agent','owner_kernel'],
    ceiling_loosen_authority: 'authenticated_user' },
  lineage_binding: { task_authority_id: sha('TA'), root_run_id: 'root-1', policy_hash: sha('P'),
    successor_inherits_durable_consumed: true },
};
const s0 = mission.createMissionState(contract);
const adapter = new ac.AuthenticatedControlAdapter({ verifier: () => ({ verified: true, authority: 'authenticated_user' }) });
const canonical = adapter.acceptEvent({
  mission_lineage_id: s0.mission_lineage_id, action: 'abort_requested',
  authority: 'authenticated_user', sequence: 5,
  issued_at: '2026-08-21T00:00:00.000Z', reason: 'kr3-fixture',
});
const aborting = mission.reduceMissionState(s0, {
  event_type: 'control_event', sequence: s0.events.length + 1,
  mission_lineage_id: s0.mission_lineage_id, payload: { event: canonical },
}).state;
if (aborting.state !== 'ABORTING') { console.error('fixture did not reach ABORTING'); process.exit(9); }
// inject a locked claim; the state must still pass full validation
const locked = {
  ...aborting,
  claims: {
    ...aborting.claims,
    k1: {
      claim_id: 'k1', idempotency_key: 'idem-1', binding_digest: sha('bind'),
      identity_scheme: null, mission_lineage_id: aborting.mission_lineage_id,
      task_authority_id: sha('TA'), campaign_id: 'campaign-v1-' + sha('c'),
      campaign_contract_digest: sha('cc'), mission_subject_digest: null,
      base_sha: 'b'.repeat(40), acceptance_ids: [], acceptance_hashes: [],
      graph_node_id: null, graph_attempt: null, campaign_contract_draft: null,
      control_sequence: aborting.control_sequence, reservation: null,
      issued_at: '2026-08-21T00:00:00.000Z', expires_at: '2026-08-22T00:00:00.000Z',
      terminal: false, released: false, reconciled: false, event_digest: sha('ev'),
      repair_lock: ladder.buildRepairLock({
        boundary: { candidate_ref: 'c'.repeat(40), boundary_code: 'scope_or_budget_boundary' },
        lockedAt: '2026-08-21T00:00:00.000Z',
      }),
    },
  },
};
mission.stateHash(locked); // throws if projection/validation breaks
// Reducer backstop, UNCONDITIONAL: abort_finalized on the locked state must
// refuse with mission_repair_required — a dead gate makes this throw/fail.
const abortRes = mission.reduceMissionState(locked, {
  event_type: 'abort_finalized', sequence: locked.events.length + 1,
  mission_lineage_id: locked.mission_lineage_id, payload: {},
});
if (!abortRes || !abortRes.receipt || abortRes.receipt.reason !== 'mission_repair_required') {
  console.error('DEAD GATE: abort_finalized drained a repair-locked claim; receipt='
    + JSON.stringify(abortRes && abortRes.receipt));
  process.exit(8);
}
if (abortRes.state.state !== 'ABORTING') { console.error('refusal mutated state'); process.exit(8); }
fs.writeFileSync(process.argv[3], JSON.stringify(locked));
NODE
assert_eq "$?" "0" "valid ABORTING fixture with locked claim built"
node "$REPO_ROOT/bin/autopilot.js" mission finalize-abort --state "$STATE" --out "$OUT" > "$TEST_TMP/cli-out.json" 2>&1
CLI_RC=$?
assert_eq "$CLI_RC" "1" "finalize-abort CLI refuses (exit 1)"
assert_contains "$(cat "$TEST_TMP/cli-out.json")" "MISSION_REPAIR_REQUIRED" "CLI names the ladder code"
assert_file_absent "$OUT" "refusal writes nothing to --out"

finalize_test
