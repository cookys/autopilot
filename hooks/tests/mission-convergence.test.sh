#!/usr/bin/env bash
# Mission P1 pure reducer oracle. Drives the generic state machine
# (`createMissionState` + `reduceMissionState`) directly. Every assertion
# is derived from real reducer behavior — no fixture-answer code.
#
# Coverage:
#   * 12 legacy fixture cases (config, identity, claim, release, reconcile,
#     ceiling, control, shadow, projection) translated through the fixture
#     layer (which calls the real reducer).
#   * Generic state machine negatives: replay idempotency, double-release,
#     binding mismatch, verifier forgery, terminal-reconcile-replay,
#     successor inheritance, projection roundtrip hash equality.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
let evaluate = null;
let createMissionState = null;
let reduceMissionState = null;
let stateHash = null;
let buildProjection = null;
let restoreProjection = null;
let evaluateIdentityReset = null;
let m = null;
try {
  m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
  ({ evaluateMissionReducerFixture: evaluate,
     createMissionState, reduceMissionState, stateHash,
     buildProjection, restoreProjection,
     evaluateIdentityReset } = m);
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const cases = [
  ['legacy-config-off', { kind: 'config', section: null }, { mode: 'off' }],
  ['partial-config-rejected', { kind: 'config', section: { enforcement_mode: 'shadow' } }, { error: 'mission_config_invalid' }],
  ['identity-cannot-reset', { kind: 'identity_reset', consumed: 99, ceiling: 100 }, { remaining: 1 }],
  ['single-use-claim', { kind: 'double_claim' }, { second: 'grant_already_claimed' }],
  ['resume-reuses-claim', { kind: 'resume_claim' }, { reservations: 1, same_claim: true }],
  ['no-effect-release', { kind: 'no_effect_release', reserved: 10 }, { reserved_active: 0, durable_consumed: 0 }],
  ['terminal-reconcile-once', { kind: 'reconcile', reserved: 10, actual: 4 }, { consumed: 4, freed: 6, replay: 'idempotent' }],
  ['overspend-blocks', { kind: 'reconcile', reserved: 10, actual: 11 }, { state: 'BLOCKED', reason: 'accounting_breach', consumed: 11 }],
  ['agent-cannot-loosen', { kind: 'ceiling_adjust', authority: 'agent', old: 10, next: 11 }, { error: 'ceiling_loosen_unauthorized' }],
  ['stale-control-blocks', { kind: 'control', current_sequence: 7, effect_sequence: 6 }, { state: 'CLOSING', reason: 'control_sequence_stale' }],
  ['shadow-never-blocks-effect', { kind: 'shadow_would_block' }, { effect_allowed: true, would_block: true }],
  ['projection-roundtrip', { kind: 'projection_roundtrip' }, { state_hash_equal: true, raw_transcript_present: false }],
  ['lineage-budget-would-block-preserves-remaining', { kind: 'lineage_budget_invariant', ceiling: 100, consumed: 99, requested: 2 }, { would_block: true, pre_claim_remaining: 1, effective_remaining: 1, budget_preserved: true }],
];

for (const [id, input, expected] of cases) {
  const actual = evaluate ? evaluate(input) : { error: 'mission_reducer_absent' };
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${id}\t${pass ? 'PASS' : 'FAIL'}\t${JSON.stringify(expected)}\t${JSON.stringify(actual)}`);
}

function makeContract() {
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: 'mission-v1-' + require('crypto').createHash('sha256').update('test').digest('hex'),
    repo_identity: 'r',
    mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('L').digest('hex'),
    task_authority_id: require('crypto').createHash('sha256').update('TA').digest('hex'),
    policy_hash: require('crypto').createHash('sha256').update('P').digest('hex'),
    enforcement_mode: 'shadow',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: {
      campaigns: { authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      wall_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      tool_calls: { authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      engine_attempts: { authorized_ceiling: 50, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      external_wait_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      canonical_changed_files: { authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      output_bytes: { authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
    },
    grant_contract: { idempotency_key_required: true, single_use: true, expiry_seconds: 3600, bindings: ['mission_lineage_id', 'task_authority_id', 'campaign_id', 'campaign_contract_digest', 'base_sha', 'acceptance_ids'] },
    control_contract: { actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'], allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'], ceiling_loosen_authority: 'authenticated_user' },
    lineage_binding: {
      task_authority_id: require('crypto').createHash('sha256').update('TA').digest('hex'),
      root_run_id: 'root-1',
      policy_hash: require('crypto').createHash('sha256').update('P').digest('hex'),
      successor_inherits_durable_consumed: true,
    },
  };
}

function reservation(state, reserved) {
  return {
    per_axis: ['campaigns', 'wall_seconds', 'tool_calls', 'engine_attempts', 'external_wait_seconds', 'canonical_changed_files', 'output_bytes'].map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? reserved : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  };
}

function claimEvent(state, opts) {
  return {
    event_type: 'grant_claimed',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: opts.idempotency_key,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: opts.campaign_id || 'c1',
      campaign_contract_digest: state.policy_hash,
      base_sha: '0000000000000000000000000000000000000000',
      acceptance_ids: ['acc-1'],
      reservation: reservation(state, opts.reserved || 5),
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  };
}

if (createMissionState && reduceMissionState && stateHash) {
  // Generic state machine negatives.
  {
    // Replay idempotency: a re-submitted claim with the same idempotency_key
    // returns the same claim_id and does not double-reserve the budget.
    const s0 = createMissionState(makeContract());
    const a = reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'replay-1' }));
    const b = reduceMissionState(a.state, claimEvent(a.state, { idempotency_key: 'replay-1' }));
    const sameClaim = a.receipt.claim_id === b.receipt.claim_id;
    const sameReservation = a.state.axes.tool_calls.reserved_active === b.state.axes.tool_calls.reserved_active;
    console.log(`replay-same-claim-id-direct\t${sameClaim ? 'PASS' : 'FAIL'}`);
    console.log(`replay-no-double-reserve-direct\t${sameReservation ? 'PASS' : 'FAIL'}`);
  }
  {
    const s0 = createMissionState(makeContract());
    const a = reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'double-rel' }));
    const b = reduceMissionState(a.state, {
      event_type: 'no_effect_release', sequence: a.state.events.length + 1,
      mission_lineage_id: s0.mission_lineage_id, payload: { claim_id: a.receipt.claim_id },
    });
    const c = reduceMissionState(b.state, {
      event_type: 'no_effect_release', sequence: b.state.events.length + 1,
      mission_lineage_id: s0.mission_lineage_id, payload: { claim_id: a.receipt.claim_id },
    });
    const ok = c.receipt.artifact_type === 'mission_grant_rejected'
      && c.receipt.reason === 'grant_already_claimed';
    console.log(`double-release-rejected-direct\t${ok ? 'PASS' : 'FAIL'}`);
  }
  {
    const s0 = createMissionState(makeContract());
    const ev = claimEvent(s0, { idempotency_key: 'bad-binding' });
    ev.payload.mission_lineage_id = 'lineage-v1-' + require('crypto').createHash('sha256').update('OTHER').digest('hex');
    const a = reduceMissionState(s0, ev);
    const ok = a.receipt.artifact_type === 'mission_grant_rejected'
      && a.receipt.reason === 'binding_mismatch';
    console.log(`binding-mismatch-direct\t${ok ? 'PASS' : 'FAIL'}`);
  }
  {
    // Projection roundtrip directly: build, restore, hash equal.
    const s0 = createMissionState(makeContract());
    const a = reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'rt-1', reserved: 3 }));
    const p = buildProjection(a.state);
    const r = restoreProjection(p);
    console.log(`projection-roundtrip-hash-equal\t${stateHash(r) === p.state_hash ? 'PASS' : 'FAIL'}`);
    console.log(`projection-raw-transcript-false\t${p.raw_transcript_present === false ? 'PASS' : 'FAIL'}`);
  }
  {
    // Terminal reconcile once: second reconcile is replay_noop.
    const s0 = createMissionState(makeContract());
    const a = reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'recon-direct', reserved: 4 }));
    const actualUsage = reservation(a.state, 4);
    const r1 = reduceMissionState(a.state, {
      event_type: 'reconciliation', sequence: a.state.events.length + 1,
      mission_lineage_id: s0.mission_lineage_id,
      payload: { claim_id: a.receipt.claim_id, actual_usage: actualUsage },
    });
    const r2 = reduceMissionState(r1.state, {
      event_type: 'reconciliation', sequence: r1.state.events.length + 1,
      mission_lineage_id: s0.mission_lineage_id,
      payload: { claim_id: a.receipt.claim_id, actual_usage: actualUsage },
    });
    console.log(`terminal-reconcile-replay-noop-direct\t${r2.receipt.replay === 'replay_noop' ? 'PASS' : 'FAIL'}`);
  }
  {
    // Successor inheritance: new state inherits durable_consumed and
    // every nonterminal claim/reservation. The successor MUST agree on
    // task_authority_id and policy_hash (conflicting lineage/policy
    // binding fails closed).
    const predecessor = makeContract();
    const s0 = createMissionState(predecessor);
    const a = reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'succ-direct', reserved: 5 }));
    const actualUsage = reservation(a.state, 5);
    const r = reduceMissionState(a.state, {
      event_type: 'reconciliation', sequence: a.state.events.length + 1,
      mission_lineage_id: s0.mission_lineage_id,
      payload: { claim_id: a.receipt.claim_id, actual_usage: actualUsage },
    });
    const succ = createMissionState({
      ...predecessor,
      lineage_binding: {
        task_authority_id: predecessor.task_authority_id,
        root_run_id: 'root-succ',
        policy_hash: predecessor.policy_hash,
        successor_inherits_durable_consumed: true,
      },
    }, { inheritFrom: r.state });
    console.log(`successor-inherits-direct\t${succ.axes.tool_calls.durable_consumed === 5 ? 'PASS' : 'FAIL'}`);
    console.log(`successor-inherits-lineage\t${succ.mission_lineage_id === s0.mission_lineage_id ? 'PASS' : 'FAIL'}`);
    console.log(`successor-inherits-task-authority\t${succ.task_authority_id === s0.task_authority_id ? 'PASS' : 'FAIL'}`);
    console.log(`successor-inherits-policy-hash\t${succ.policy_hash === s0.policy_hash ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 2: Grant reservation axis validation & idempotency ───
    // Empty per_axis rejects. Partial rejects. Duplicate rejects. Unknown rejects.
    const s0 = createMissionState(makeContract());
    function tryClaim(reservation) {
      try {
        return reduceMissionState(s0, {
          event_type: 'grant_claimed',
          sequence: 1,
          mission_lineage_id: s0.mission_lineage_id,
          payload: {
            idempotency_key: 'ax-' + Math.random(),
            mission_lineage_id: s0.mission_lineage_id,
            task_authority_id: s0.task_authority_id,
            campaign_id: 'c1',
            campaign_contract_digest: s0.policy_hash,
            base_sha: '0000000000000000000000000000000000000000',
            acceptance_ids: ['acc-1'],
            reservation,
            issued_at: '2026-07-27T00:00:00.000Z',
            expires_at: '2026-07-27T01:00:00.000Z',
          },
        });
      } catch (e) { return { err: e.code }; }
    }
    // Empty per_axis rejects (reservationFor fails closed, reducer returns binding_mismatch).
    const emptyRes = tryClaim({ per_axis: [] });
    console.log(`grant-empty-reservation-rejects\t${
      emptyRes.receipt && emptyRes.receipt.artifact_type === 'mission_grant_rejected'
      && emptyRes.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Partial reservation (missing axes) rejects.
    const partialRes = tryClaim({ per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'campaigns', authorized_ceiling: 10, reserved_active: 1, durable_consumed: 0, known: true },
    ]});
    console.log(`grant-partial-reservation-rejects\t${
      partialRes.receipt && partialRes.receipt.artifact_type === 'mission_grant_rejected'
      && partialRes.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Duplicate axis rejects.
    const dupRes = tryClaim({ per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'campaigns', authorized_ceiling: 10, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'wall_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'engine_attempts', authorized_ceiling: 50, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'external_wait_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'canonical_changed_files', authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'output_bytes', authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true },
    ]});
    console.log(`grant-duplicate-axis-rejects\t${
      dupRes.receipt && dupRes.receipt.artifact_type === 'mission_grant_rejected'
      && dupRes.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Unknown axis rejects.
    const unknownRes = tryClaim({ per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'campaigns', authorized_ceiling: 10, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'wall_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'engine_attempts', authorized_ceiling: 50, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'external_wait_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'canonical_changed_files', authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'output_bytes', authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'mystery_axis', authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true },
    ]});
    console.log(`grant-unknown-axis-rejects\t${
      unknownRes.receipt && unknownRes.receipt.artifact_type === 'mission_grant_rejected'
      && unknownRes.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Campaign axis requires reserved_active >= 1.
    const zeroCampaignRes = tryClaim({ per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 1, durable_consumed: 0, known: true },
      { axis: 'campaigns', authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'wall_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'engine_attempts', authorized_ceiling: 50, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'external_wait_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'canonical_changed_files', authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'output_bytes', authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true },
    ]});
    console.log(`grant-zero-campaign-rejects\t${
      zeroCampaignRes.receipt && zeroCampaignRes.receipt.artifact_type === 'mission_grant_rejected'
      && zeroCampaignRes.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Same logical binding with different idempotency_key rejects.
    const sIdem = createMissionState(makeContract());
    const a1 = reduceMissionState(sIdem, claimEvent(sIdem, { idempotency_key: 'k1' }));
    const a2 = reduceMissionState(a1.state, claimEvent(a1.state, { idempotency_key: 'k2' }));
    console.log(`grant-same-binding-different-idem-rejects\t${
      a2.receipt.artifact_type === 'mission_grant_rejected'
      && a2.receipt.reason === 'grant_already_claimed' ? 'PASS' : 'FAIL'}`);
    // Same key with changed reservation rejects.
    const sR = createMissionState(makeContract());
    const r1 = reduceMissionState(sR, claimEvent(sR, { idempotency_key: 'res-1', reserved: 3 }));
    const r2Event = claimEvent(r1.state, { idempotency_key: 'res-1', reserved: 7 });
    const r2 = reduceMissionState(r1.state, r2Event);
    console.log(`grant-same-key-changed-reservation-rejects\t${
      r2.receipt.artifact_type === 'mission_grant_rejected'
      && r2.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Same key with changed binding rejects (binding_digest mismatch → binding_mismatch).
    const sB = createMissionState(makeContract());
    const b1 = reduceMissionState(sB, claimEvent(sB, { idempotency_key: 'bnd-1', campaign_id: 'c-A' }));
    const b2Event = claimEvent(b1.state, { idempotency_key: 'bnd-1', campaign_id: 'c-B' });
    const b2 = reduceMissionState(b1.state, b2Event);
    console.log(`grant-same-key-changed-binding-rejects\t${
      b2.receipt.artifact_type === 'mission_grant_rejected'
      && b2.receipt.reason === 'binding_mismatch' ? 'PASS' : 'FAIL'}`);
    // Exact replay is idempotent.
    const sE = createMissionState(makeContract());
    const e1 = reduceMissionState(sE, claimEvent(sE, { idempotency_key: 'exact-1' }));
    const e2 = reduceMissionState(e1.state, claimEvent(e1.state, { idempotency_key: 'exact-1' }));
    console.log(`grant-exact-replay-idempotent\t${
      e2.receipt.artifact_type === 'mission_campaign_grant_claimed'
      && e2.receipt.event_type === 'grant_resumed' ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 3: Shadow would-block from real reducer, not blocking ───
    const sShadow = createMissionState(makeContract());
    const overReservation = reservation(sShadow, 200); // overspend: 100 ceiling, 200 requested
    const sh = reduceMissionState(sShadow, {
      event_type: 'grant_claimed',
      sequence: 1,
      mission_lineage_id: sShadow.mission_lineage_id,
      payload: {
        idempotency_key: 'shadow-over',
        mission_lineage_id: sShadow.mission_lineage_id,
        task_authority_id: sShadow.task_authority_id,
        campaign_id: 'c1',
        campaign_contract_digest: sShadow.policy_hash,
        base_sha: '0000000000000000000000000000000000000000',
        acceptance_ids: ['acc-1'],
        reservation: overReservation,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    // Shadow: state.state stays DRAFT (not BLOCKED), but evidence is recorded.
    console.log(`shadow-does-not-block-state\t${sh.state.state === 'DRAFT' ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-would-block-evidence-recorded\t${
      sh.state.receipts && sh.state.receipts.mission_would_block_evidence ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-evidence-has-overspend-axis\t${
      sh.receipt.evidence && sh.receipt.evidence.axis === 'tool_calls'
      && typeof sh.receipt.evidence.remaining_before === 'number'
      && typeof sh.receipt.evidence.remaining_after === 'number'
      && typeof sh.receipt.evidence.requested === 'number' ? 'PASS' : 'FAIL'}`);
    // Finding 5: the represented grant is NOT prevented — a claim is durably
    // created carrying the full requested reservation for later release/
    // reconciliation, even though the shadow ledger is over its ceiling.
    const shadowClaimId = sh.receipt.claim_id;
    const shadowClaim = shadowClaimId ? sh.state.claims[shadowClaimId] : null;
    console.log(`shadow-grant-claim-created\t${
      !!shadowClaim && shadowClaim.shadow_would_block === true ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-grant-reservation-recorded\t${
      !!shadowClaim
      && shadowClaim.reservation.tool_calls.reserved_active === 200
      && shadowClaim.reservation.campaigns.reserved_active === 1 ? 'PASS' : 'FAIL'}`);
    // Finding 5: repeated shadow admissions remain auditable and cumulative —
    // a second over-ceiling admission creates a distinct claim and a distinct
    // per-event evidence receipt without overwriting the first.
    const sh2 = reduceMissionState(sh.state, {
      event_type: 'grant_claimed',
      sequence: sh.state.events.length + 1,
      mission_lineage_id: sShadow.mission_lineage_id,
      payload: {
        idempotency_key: 'shadow-over-2',
        mission_lineage_id: sShadow.mission_lineage_id,
        task_authority_id: sShadow.task_authority_id,
        campaign_id: 'c2',
        campaign_contract_digest: sShadow.policy_hash,
        base_sha: '0000000000000000000000000000000000000000',
        acceptance_ids: ['acc-1'],
        reservation: overReservation,
        issued_at: '2026-07-27T00:00:01.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    const evidenceKeys = Object.keys(sh2.state.receipts)
      .filter((k) => k.startsWith('mission_would_block_evidence:'));
    console.log(`shadow-repeated-admissions-cumulative\t${
      sh2.receipt.claim_id !== shadowClaimId
      && !!sh2.state.claims[sh2.receipt.claim_id]
      && evidenceKeys.length === 2 ? 'PASS' : 'FAIL'}`);
    // Enforce mode rejects same input (transitions to BLOCKED).
    const enforceContract = makeContract();
    enforceContract.enforcement_mode = 'enforce';
    const sEnforce = createMissionState(enforceContract);
    const ef = reduceMissionState(sEnforce, {
      event_type: 'grant_claimed',
      sequence: 1,
      mission_lineage_id: sEnforce.mission_lineage_id,
      payload: {
        idempotency_key: 'enforce-over',
        mission_lineage_id: sEnforce.mission_lineage_id,
        task_authority_id: sEnforce.task_authority_id,
        campaign_id: 'c1',
        campaign_contract_digest: sEnforce.policy_hash,
        base_sha: '0000000000000000000000000000000000000000',
        acceptance_ids: ['acc-1'],
        reservation: overReservation,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    console.log(`enforce-blocks-overspend\t${
      ef.state.state === 'BLOCKED' && ef.state.terminal && ef.state.terminal.reason === 'resource_ceiling'
      ? 'PASS' : 'FAIL'}`);
    // Finding 5: enforce mode creates NO claim for the identical request that
    // shadow durably granted.
    console.log(`enforce-creates-no-shadow-claim\t${
      Object.keys(ef.state.claims).length === 0 ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 4: Reconciliation receipt correctness ───
    const sR = createMissionState(makeContract());
    const a = reduceMissionState(sR, claimEvent(sR, { idempotency_key: 'rec-1', reserved: 10 }));
    const claimId = a.receipt.claim_id;
    // Normal reconcile: actual=4, reserved=10 → consumed=4, freed=6 per axis.
    const actualUsage4 = reservation(a.state, 4);
    const r1 = reduceMissionState(a.state, {
      event_type: 'reconciliation', sequence: a.state.events.length + 1,
      mission_lineage_id: sR.mission_lineage_id,
      payload: { claim_id: claimId, actual_usage: actualUsage4 },
    });
    console.log(`reconcile-consumed-equals-actual\t${
      r1.receipt.reservation_consumed.tool_calls.reserved_active === 4 ? 'PASS' : 'FAIL'}`);
    console.log(`reconcile-freed-equals-original-minus-actual\t${
      r1.receipt.reservation_freed.tool_calls.reserved_active === 6 ? 'PASS' : 'FAIL'}`);
    // Missing actual axes = 0 actual, frees original (still per axis).
    const sR2 = createMissionState(makeContract());
    const a2 = reduceMissionState(sR2, claimEvent(sR2, { idempotency_key: 'rec-2', reserved: 5 }));
    const partialActual = { per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 100, reserved_active: 2, durable_consumed: 0, known: true },
      // No other axes — they should default to 0 actual but still be freed.
    ]};
    const r2 = reduceMissionState(a2.state, {
      event_type: 'reconciliation', sequence: a2.state.events.length + 1,
      mission_lineage_id: sR2.mission_lineage_id,
      payload: { claim_id: a2.receipt.claim_id, actual_usage: partialActual },
    });
    console.log(`reconcile-missing-axes-zero-actual\t${
      r2.receipt.reservation_consumed.wall_seconds
      && r2.receipt.reservation_consumed.wall_seconds.reserved_active === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`reconcile-missing-axes-free-original\t${
      r2.receipt.reservation_freed.wall_seconds
      && r2.receipt.reservation_freed.wall_seconds.reserved_active === 0 ? 'PASS' : 'FAIL'}`);
    // Overspend: conservative charge, clears reservation, terminalizes claim, blocks once.
    const sR3 = createMissionState(makeContract());
    const a3 = reduceMissionState(sR3, claimEvent(sR3, { idempotency_key: 'rec-3', reserved: 5 }));
    const overActual = reservation(a3.state, 11); // observed: 11, reserved: 5
    const r3 = reduceMissionState(a3.state, {
      event_type: 'reconciliation', sequence: a3.events ? a3.state.events.length + 1 : 2,
      mission_lineage_id: sR3.mission_lineage_id,
      payload: { claim_id: a3.receipt.claim_id, actual_usage: overActual },
    });
    console.log(`reconcile-overspend-blocks-once\t${
      r3.state.state === 'BLOCKED'
      && r3.state.terminal && r3.state.terminal.reason === 'accounting_breach' ? 'PASS' : 'FAIL'}`);
    console.log(`reconcile-overspend-clears-reservation\t${
      r3.state.axes.tool_calls.reserved_active === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`reconcile-overspend-terminalizes-claim\t${
      r3.state.claims[a3.receipt.claim_id].terminal === true ? 'PASS' : 'FAIL'}`);
    console.log(`reconcile-overspend-conservative-charge\t${
      r3.state.axes.tool_calls.durable_consumed >= 11 ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 1 + 2 + 6: private registry, non-serialized capability,
    //     authoritative constructor verifier ───
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    const engineIndex = require(path.join(root, 'src', 'engine', 'index.js'));
    const L = 'lineage-v1-' + require('crypto').createHash('sha256').update('L').digest('hex');

    // Finding 1: the capability registry is module-private. No public export
    // exposes the WeakSet, so no caller can add an arbitrary capability.
    console.log(`registry-not-exported-authenticated-control\t${
      ac.ADAPTER_CAPABILITY_REGISTRY === undefined ? 'PASS' : 'FAIL'}`);
    console.log(`registry-not-exported-engine-index\t${
      engineIndex.ADAPTER_CAPABILITY_REGISTRY === undefined ? 'PASS' : 'FAIL'}`);
    console.log(`registry-not-exported-mission-convergence\t${
      m.ADAPTER_CAPABILITY_REGISTRY === undefined ? 'PASS' : 'FAIL'}`);
    // A caller-fabricated capability object (even with a real symbol) is not
    // authenticated — only adapter-minted capabilities validate.
    console.log(`predicate-rejects-fabricated-capability\t${
      ac.isAuthenticatedAdapterCapability({ mint: 'AuthenticatedControlAdapter', symbol: Symbol('forged') }) === false
      ? 'PASS' : 'FAIL'}`);

    // Finding 2: plain JSON object verifier rejected at adapter construction.
    let plainObjectVerifierRejected = false;
    try {
      new ac.AuthenticatedControlAdapter({ verifier: { verified: true } });
    } catch (e) {
      plainObjectVerifierRejected = e.code === 'authenticated_control_verifier_non_serializable';
    }
    console.log(`forgery-plain-object-verifier-rejected\t${plainObjectVerifierRejected ? 'PASS' : 'FAIL'}`);
    let missingVerifierRejected = false;
    try { new ac.AuthenticatedControlAdapter(); } catch (e) {
      missingVerifierRejected = e.code === 'authenticated_control_verifier_missing';
    }
    console.log(`forgery-missing-verifier-rejected\t${missingVerifierRejected ? 'PASS' : 'FAIL'}`);

    // Finding 2: the adapter capability never serializes or hashes.
    const adapter = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const canonical = adapter.acceptEvent({
      mission_lineage_id: L, action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'serialize-test',
    });
    // The exact frozen canonical event is in the module-private WeakSet
    // and authenticated by the narrow predicate — no capability field is
    // ever attached. A copied, JSON-roundtripped, or already-consumed
    // object all fail this check.
    console.log(`capability-present-for-reducer\t${
      ac.isAuthenticatedAdapterCapability(canonical) ? 'PASS' : 'FAIL'}`);
    console.log(`capability-non-enumerable\t${
      Object.keys(canonical).includes('_adapter_capability') === false ? 'PASS' : 'FAIL'}`);
    const parsed = JSON.parse(JSON.stringify(canonical));
    console.log(`capability-not-serialized\t${
      parsed._adapter_capability === undefined && parsed.cap === undefined ? 'PASS' : 'FAIL'}`);
    // canonicalJson must reject symbol/function rather than serialize them.
    let canonicalJsonRejectsSymbol = false;
    try { ac.canonicalJson({ s: Symbol('x') }); } catch (e) { canonicalJsonRejectsSymbol = true; }
    console.log(`canonical-json-rejects-symbol\t${canonicalJsonRejectsSymbol ? 'PASS' : 'FAIL'}`);
    let canonicalJsonRejectsFunction = false;
    try { ac.canonicalJson({ f: () => 1 }); } catch (e) { canonicalJsonRejectsFunction = true; }
    console.log(`canonical-json-rejects-function\t${canonicalJsonRejectsFunction ? 'PASS' : 'FAIL'}`);

    // Finding 2: a reduced control event's stored payload omits the capability.
    const sCtl = createMissionState(makeContract());
    const ctlResult = reduceMissionState(sCtl, {
      event_type: 'control_event', sequence: 1, mission_lineage_id: sCtl.mission_lineage_id,
      payload: { event: canonical },
    });
    const storedCtlEvent = ctlResult.state.events[ctlResult.state.events.length - 1];
    console.log(`stored-event-payload-omits-capability\t${
      storedCtlEvent.payload.event._adapter_capability === undefined ? 'PASS' : 'FAIL'}`);
    console.log(`stored-event-json-omits-capability\t${
      JSON.stringify(storedCtlEvent).includes('_adapter_capability') === false ? 'PASS' : 'FAIL'}`);
    console.log(`receipt-json-omits-capability\t${
      JSON.stringify(ctlResult.receipt).includes('_adapter_capability') === false ? 'PASS' : 'FAIL'}`);

    // Finding 1: a raw reducer control event without a minted capability rejects.
    const sRaw = createMissionState(makeContract());
    let rawControlErr = null;
    try {
      reduceMissionState(sRaw, {
        event_type: 'control_event', sequence: 1, mission_lineage_id: sRaw.mission_lineage_id,
        payload: { event: { action: 'finish_requested', authority: 'authenticated_user',
          sequence: 1, mission_lineage_id: sRaw.mission_lineage_id } },
      });
    } catch (e) { rawControlErr = e.code; }
    console.log(`raw-control-event-rejects\t${
      rawControlErr === 'MISSION_CONTROL_UNAUTHENTICATED' ? 'PASS' : 'FAIL'}`);
    // A raw event carrying a fabricated capability also rejects.
    let forgedControlErr = null;
    try {
      reduceMissionState(createMissionState(makeContract()), {
        event_type: 'control_event', sequence: 1, mission_lineage_id: sRaw.mission_lineage_id,
        payload: { event: { action: 'finish_requested', authority: 'authenticated_user',
          sequence: 1, mission_lineage_id: sRaw.mission_lineage_id,
          _adapter_capability: { mint: 'AuthenticatedControlAdapter', symbol: Symbol('forged') } } },
      });
    } catch (e) { forgedControlErr = e.code; }
    console.log(`forged-capability-control-event-rejects\t${
      forgedControlErr === 'MISSION_CONTROL_UNAUTHENTICATED' ? 'PASS' : 'FAIL'}`);

    // Finding 6: the constructor verifier is authoritative even when
    // acceptEvent receives extra arguments/options. A rejecting verifier must
    // keep rejecting; a caller-supplied "approve" option cannot replace it.
    const rejecting = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: false, reason: 'authenticated_control_verifier_rejected' }),
    });
    let rejectingHonored = false;
    try {
      rejecting.acceptEvent({ mission_lineage_id: L, action: 'finish_requested',
        authority: 'authenticated_user', sequence: 1,
        issued_at: '2026-07-27T00:00:00.000Z', reason: 'x' },
        { verifier: () => ({ verified: true, authority: 'authenticated_user' }) });
    } catch (e) {
      rejectingHonored = e.code === 'authenticated_control_verifier_rejected';
    }
    console.log(`verifier-reject-authoritative-with-extra-args\t${rejectingHonored ? 'PASS' : 'FAIL'}`);
    // A verifier that changes authority is authoritative: an override that
    // mismatches the raw event authority must reject.
    const overriding = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_doa' }),
    });
    let overrideMismatchRejected = false;
    try {
      overriding.acceptEvent({ mission_lineage_id: L, action: 'finish_requested',
        authority: 'authenticated_user', sequence: 1,
        issued_at: '2026-07-27T00:00:00.000Z', reason: 'x' },
        { verifier: () => ({ verified: true, authority: 'authenticated_user' }) });
    } catch (e) {
      overrideMismatchRejected = e.code === 'authenticated_control_authority_override_mismatch';
    }
    console.log(`verifier-authority-change-authoritative\t${overrideMismatchRejected ? 'PASS' : 'FAIL'}`);
    // The caller cannot replace the constructor verifier; the approving
    // constructor verifier still approves despite any extra arguments
    // (a "verifier override" passed in options is ignored — only the
    // constructor-bound verifier runs). The new design uses object
    // identity via the module-private WeakSet, not a non-enumerable
    // capability field, so we check the canonical event itself.
    const approving = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    let approveStillWorks = false;
    try {
      const ev = approving.acceptEvent({ mission_lineage_id: L, action: 'finish_requested',
        authority: 'authenticated_user', sequence: 1,
        issued_at: '2026-07-27T00:00:00.000Z', reason: 'x' },
        { verifier: () => ({ verified: false, reason: 'authenticated_control_verifier_rejected' }) });
      approveStillWorks = ac.isAuthenticatedAdapterCapability(ev);
    } catch (e) { approveStillWorks = false; }
    console.log(`verifier-cannot-be-replaced-by-caller\t${approveStillWorks ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 6: Projection validation, preservation, deep freeze ───
    // Tampered projection_digest rejects.
    const sP = createMissionState(makeContract());
    const proj = buildProjection(sP);
    const tampered = JSON.parse(JSON.stringify(proj));
    tampered.projection_digest = 'a'.repeat(64);
    let tamperProjectionRejected = false;
    try { restoreProjection(tampered); } catch (e) {
      tamperProjectionRejected = e.code === 'PROJECTION_DIGEST_MISMATCH';
    }
    console.log(`projection-tamper-digest-rejects\t${tamperProjectionRejected ? 'PASS' : 'FAIL'}`);
    // Tampered ordered_event_head rejects (re-compute projection_digest so we
    // specifically exercise the head_digest check).
    const tamperedHead = JSON.parse(JSON.stringify(proj));
    tamperedHead.ordered_event_head.head_digest = 'b'.repeat(64);
    tamperedHead.projection_digest = require(path.join(root, 'src', 'engine', 'authenticated-control')).sha256({ ...tamperedHead, projection_digest: undefined });
    let tamperHeadRejected = false;
    try { restoreProjection(tamperedHead); } catch (e) {
      tamperHeadRejected = e.code === 'PROJECTION_HEAD_DIGEST_MISMATCH';
    }
    console.log(`projection-tamper-head-rejects\t${tamperHeadRejected ? 'PASS' : 'FAIL'}`);
    // Tampered config_digest rejects (re-compute projection_digest first).
    const tamperedCfg = JSON.parse(JSON.stringify(proj));
    tamperedCfg.config_digest = 'c'.repeat(64);
    tamperedCfg.projection_digest = require(path.join(root, 'src', 'engine', 'authenticated-control')).sha256({ ...tamperedCfg, projection_digest: undefined });
    let tamperConfigRejected = false;
    try { restoreProjection(tamperedCfg); } catch (e) {
      tamperConfigRejected = e.code === 'PROJECTION_CONFIG_DIGEST_MISMATCH';
    }
    console.log(`projection-tamper-config-rejects\t${tamperConfigRejected ? 'PASS' : 'FAIL'}`);
    // Tampered source_refs reject: source_refs are bound into projection_digest,
    // so altering them without recomputing breaks the digest-bound refs.
    const tamperedRefs = JSON.parse(JSON.stringify(proj));
    tamperedRefs.source_refs = [{ digest: 'forged-source-ref' }];
    let tamperRefsRejected = false;
    try { restoreProjection(tamperedRefs); } catch (e) {
      tamperRefsRejected = e.code === 'PROJECTION_DIGEST_MISMATCH';
    }
    console.log(`projection-tamper-source-refs-rejects\t${tamperRefsRejected ? 'PASS' : 'FAIL'}`);
    // Valid next claim after JSON roundtrip with identical state hash.
    const roundtripClaim = claimEvent(sP, { idempotency_key: 'rt-claim', reserved: 2 });
    const roundResult1 = reduceMissionState(sP, roundtripClaim);
    const originalState = roundResult1.state;
    const projection = buildProjection(originalState);
    const serialized = JSON.stringify(projection);
    const restored = restoreProjection(JSON.parse(serialized));
    // Finding 4: the restored state hash MUST equal the original state hash.
    console.log(`projection-restored-hash-equals-original\t${
      stateHash(restored) === stateHash(originalState) ? 'PASS' : 'FAIL'}`);
    console.log(`projection-restored-hash-equals-snapshot\t${
      stateHash(restored) === projection.state_hash ? 'PASS' : 'FAIL'}`);
    // Finding 4: a valid next sequenced claim works on the restored state.
    // Use a distinct campaign_id so the claim is a new logical binding (the
    // restored state must still enforce single-use admission on the old one).
    const roundResult2 = reduceMissionState(restored, claimEvent(restored, { idempotency_key: 'rt-claim-2', campaign_id: 'c-next', reserved: 1 }));
    console.log(`projection-roundtrip-replay-valid-next-claim\t${
      roundResult2.receipt.artifact_type === 'mission_campaign_grant_claimed'
      && roundResult2.state.axes.tool_calls.reserved_active
        === originalState.axes.tool_calls.reserved_active + 1 ? 'PASS' : 'FAIL'}`);
    // Finding 4: restored config carries the complete non-secret contract shape.
    const rc = restored.config;
    const configShapeComplete = rc
      && rc.grant_contract && Array.isArray(rc.grant_contract.bindings)
      && rc.grant_contract.idempotency_key_required === true
      && rc.grant_contract.single_use === true
      && rc.control_contract && Array.isArray(rc.control_contract.actions)
      && rc.control_contract.ceiling_loosen_authority === 'authenticated_user'
      && rc.lineage_binding && typeof rc.lineage_binding.root_run_id === 'string'
      && rc.axes && rc.axes.tool_calls
      && Array.isArray(rc.red_lines)
      && typeof rc.closure_ratio === 'number'
      && typeof rc.max_stagnant_campaigns === 'number';
    console.log(`projection-restored-config-complete-shape\t${configShapeComplete ? 'PASS' : 'FAIL'}`);
    // replayEvents not exported.
    console.log(`projection-replay-events-not-exported\t${
      m.replayEvents === undefined ? 'PASS' : 'FAIL'}`);
    // Caller mutation of projection cannot mutate restored state.
    const restoredFrozen = restoreProjection(projection);
    let mutationBlocked = true;
    try {
      restoredFrozen.mission_lineage_id = 'tampered';
    } catch (e) { /* fine, frozen */ }
    if (restoredFrozen.mission_lineage_id !== sP.mission_lineage_id) mutationBlocked = false;
    console.log(`projection-restored-state-immutable\t${mutationBlocked ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Finding 7 + 3: Deep clone/freeze, evaluateConfig rejects ───
    // Finding 3: real deep-immutability proof. Save originals BEFORE mutation,
    // attempt nested caller/state mutations, then compare to the saved
    // originals. A frozen assignment either throws (strict mode) or silently
    // no-ops; either way the value must equal the saved original afterward.
    function attempt(fn) { try { fn(); } catch (e) { /* frozen: blocked */ } }
    const sC = createMissionState(makeContract());
    const aC = reduceMissionState(sC, claimEvent(sC, { idempotency_key: 'imm-bind', reserved: 4 }));
    const st = aC.state;
    // Contract bindings.
    const origBindings = JSON.stringify(st.config.grant_contract.bindings);
    attempt(() => { st.config.grant_contract.bindings.push('forged_binding'); });
    attempt(() => { st.config.grant_contract.bindings[0] = 'forged_binding'; });
    console.log(`immutability-contract-bindings\t${
      JSON.stringify(st.config.grant_contract.bindings) === origBindings ? 'PASS' : 'FAIL'}`);
    // Axes (nested numeric fields).
    const origToolReserved = st.axes.tool_calls.reserved_active;
    const origToolCeiling = st.axes.tool_calls.authorized_ceiling;
    attempt(() => { st.axes.tool_calls.reserved_active = 999999; });
    attempt(() => { st.axes.tool_calls.authorized_ceiling = 999999; });
    console.log(`immutability-axes\t${
      st.axes.tool_calls.reserved_active === origToolReserved
      && st.axes.tool_calls.authorized_ceiling === origToolCeiling ? 'PASS' : 'FAIL'}`);
    // Claims (nested reservation).
    const claimId = aC.receipt.claim_id;
    const origClaimReserved = st.claims[claimId].reservation.tool_calls.reserved_active;
    const origClaimTerminal = st.claims[claimId].terminal;
    attempt(() => { st.claims[claimId].reservation.tool_calls.reserved_active = 999999; });
    attempt(() => { st.claims[claimId].terminal = true; });
    attempt(() => { st.claims[claimId].released = true; });
    console.log(`immutability-claims\t${
      st.claims[claimId].reservation.tool_calls.reserved_active === origClaimReserved
      && st.claims[claimId].terminal === origClaimTerminal
      && st.claims[claimId].released === false ? 'PASS' : 'FAIL'}`);
    // Events (nested payload).
    const origEventDigests = JSON.stringify(st.events.map((e) => e.event_digest));
    const origEventType = st.events[0].event_type;
    attempt(() => { st.events[0].event_digest = 'f'.repeat(64); });
    attempt(() => { st.events[0].event_type = 'forged_event'; });
    attempt(() => { st.events.push({ event_type: 'forged_event' }); });
    console.log(`immutability-events\t${
      JSON.stringify(st.events.map((e) => e.event_digest)) === origEventDigests
      && st.events[0].event_type === origEventType
      && st.events.length === 1 ? 'PASS' : 'FAIL'}`);
    // Replay-return state: mutate the input event after reduction, then prove
    // the recorded event log is unaffected (deep clone on append).
    const sR = createMissionState(makeContract());
    const mutableEvent = claimEvent(sR, { idempotency_key: 'imm-replay', reserved: 3 });
    const r1 = reduceMissionState(sR, mutableEvent);
    const origRecordedReserved =
      r1.state.events[0].payload.reservation.per_axis.find((x) => x.axis === 'tool_calls').reserved_active;
    attempt(() => { mutableEvent.payload.reservation.per_axis.find((x) => x.axis === 'tool_calls').reserved_active = 999999; });
    attempt(() => { mutableEvent.payload.idempotency_key = 'mutated-after-the-fact'; });
    const recordedAfter =
      r1.state.events[0].payload.reservation.per_axis.find((x) => x.axis === 'tool_calls').reserved_active;
    console.log(`immutability-replay-return-state\t${
      recordedAfter === origRecordedReserved
      && r1.state.events[0].payload.idempotency_key === 'imm-replay' ? 'PASS' : 'FAIL'}`);
    // Top-level scalar field stays frozen.
    const origLineage = st.mission_lineage_id;
    attempt(() => { st.mission_lineage_id = 'tampered'; });
    console.log(`state-immutable-after-construction\t${
      st.mission_lineage_id === origLineage ? 'PASS' : 'FAIL'}`);
    // Idempotent replay cannot mutate state.
    const sI = createMissionState(makeContract());
    const i1 = reduceMissionState(sI, claimEvent(sI, { idempotency_key: 'imm-1' }));
    const tc1 = i1.state.axes.tool_calls.reserved_active;
    const i2 = reduceMissionState(i1.state, claimEvent(i1.state, { idempotency_key: 'imm-1' }));
    const tc2 = i2.state.axes.tool_calls.reserved_active;
    console.log(`state-idempotent-replay-no-double-reserve\t${tc1 === tc2 ? 'PASS' : 'FAIL'}`);
    // evaluateConfig rejects unknown key.
    const unknownCfg = evaluate({ kind: 'config', section: { unknown_field: 'x',
      enforcement_mode: 'shadow', max_campaigns: 1, max_wall_seconds: 1, max_tool_calls: 1,
      max_engine_attempts: 1, max_external_wait_seconds: 1, max_canonical_changed_files: 1,
      max_output_bytes: 1, closure_ratio: 0.5, max_stagnant_campaigns: 1 } });
    console.log(`config-unknown-key-rejects\t${
      unknownCfg.error === 'mission_config_invalid' ? 'PASS' : 'FAIL'}`);
    // evaluateConfig rejects missing field.
    const missingCfg = evaluate({ kind: 'config', section: { enforcement_mode: 'shadow',
      max_campaigns: 1 } });
    console.log(`config-missing-field-rejects\t${
      missingCfg.error === 'mission_config_invalid' ? 'PASS' : 'FAIL'}`);
    // evaluateConfig rejects wrong type (closure_ratio as string).
    const wrongTypeCfg = evaluate({ kind: 'config', section: { enforcement_mode: 'shadow',
      max_campaigns: 1, max_wall_seconds: 1, max_tool_calls: 1, max_engine_attempts: 1,
      max_external_wait_seconds: 1, max_canonical_changed_files: 1, max_output_bytes: 1,
      closure_ratio: '0.5', max_stagnant_campaigns: 1 } });
    console.log(`config-wrong-type-rejects\t${
      wrongTypeCfg.error === 'mission_config_invalid' ? 'PASS' : 'FAIL'}`);
    // evaluateConfig rejects range violation.
    const rangeCfg = evaluate({ kind: 'config', section: { enforcement_mode: 'shadow',
      max_campaigns: -1, max_wall_seconds: 1, max_tool_calls: 1, max_engine_attempts: 1,
      max_external_wait_seconds: 1, max_canonical_changed_files: 1, max_output_bytes: 1,
      closure_ratio: 0.5, max_stagnant_campaigns: 1 } });
    console.log(`config-range-violation-rejects\t${
      rangeCfg.error === 'mission_config_invalid' ? 'PASS' : 'FAIL'}`);
    // evaluateConfig rejects bad provenance.
    const badProvCfg = evaluate({ kind: 'config', section: { enforcement_mode: 'shadow',
      max_campaigns: 1, max_wall_seconds: 1, max_tool_calls: 1, max_engine_attempts: 1,
      max_external_wait_seconds: 1, max_canonical_changed_files: 1, max_output_bytes: 1,
      closure_ratio: 0.5, max_stagnant_campaigns: 1, provenance: { enforcement_mode: 'evil' } } });
    console.log(`config-bad-provenance-rejects\t${
      badProvCfg.error === 'mission_config_invalid' ? 'PASS' : 'FAIL'}`);
    // Absent section returns off (mode=off).
    const offCfg = evaluate({ kind: 'config', section: null });
    console.log(`config-absent-section-off\t${
      offCfg.mode === 'off' ? 'PASS' : 'FAIL'}`);
    // Section absent (no `section` key at all) returns off.
    const noSection = evaluate({ kind: 'config' });
    console.log(`config-no-section-off\t${noSection.mode === 'off' ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: module-private event-identity attestation ──────────
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    // (a) Adapter construction smoke test. The prior Symbol-in-WeakSet
    //     design was a Node-version-specific accident; the new design
    //     uses object identity via a module-private WeakSet. The adapter
    //     must construct cleanly with a non-serializable verifier.
    let adapterConstructed = false;
    try {
      const smokeAdapter = new ac.AuthenticatedControlAdapter({
        verifier: () => ({ verified: true, authority: 'authenticated_user' }),
      });
      const smokeEvent = smokeAdapter.acceptEvent({
        mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('smoke-consume').digest('hex'),
        action: 'finish_requested', authority: 'authenticated_user',
        sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'smoke-lifecycle',
      });
      const smokeConsume = ac.consumeAuthenticatedControlEvent(smokeEvent);
      adapterConstructed = smokeConsume.ok === true && smokeConsume.event.action === 'finish_requested';
    } catch (e) { adapterConstructed = false; }
    console.log(`adapter-construction-smoke\t${adapterConstructed ? 'PASS' : 'FAIL'}`);

    // (b) No public capability/token/getter. The module must NOT export
    //     a `mint` function, a `capability` field, or a token. The only
    //     reducer-facing surface is the narrow `consumeAuthenticatedControlEvent`.
    console.log(`no-public-mint-function\t${
      ac.mintAdapterCapability === undefined ? 'PASS' : 'FAIL'}`);
    console.log(`no-public-token\t${
      ac.ADAPTER_TOKEN === undefined && ac.adapterToken === undefined ? 'PASS' : 'FAIL'}`);

    // (c) acceptEvent does not attach a `_adapter_capability` field.
    const smokeCanonical = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const smokeCanonical2 = smokeCanonical.acceptEvent({
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('smoke2').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'smoke2',
    });
    console.log(`no-capability-field-on-canonical\t${
      smokeCanonical2._adapter_capability === undefined
      && Object.keys(smokeCanonical2).includes('_adapter_capability') === false
      ? 'PASS' : 'FAIL'}`);

    // (d) consumeAuthenticatedControlEvent is the only reducer-facing
    //     surface. A successful consume returns a sanitized snapshot;
    //     a second consume of the same canonical event fails closed.
    const singleCanonical = smokeCanonical.acceptEvent({
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('single').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'single',
    });
    const firstConsume = ac.consumeAuthenticatedControlEvent(singleCanonical);
    const secondConsume = ac.consumeAuthenticatedControlEvent(singleCanonical);
    console.log(`consume-first-succeeds\t${firstConsume.ok === true ? 'PASS' : 'FAIL'}`);
    console.log(`consume-second-fails\t${secondConsume.ok === false ? 'PASS' : 'FAIL'}`);
    console.log(`consume-snapshot-sanitized\t${
      firstConsume.event && typeof firstConsume.event.action === 'string'
      && firstConsume.event._adapter_capability === undefined ? 'PASS' : 'FAIL'}`);
    console.log(`consume-snapshot-frozen\t${
      firstConsume.event && Object.isFrozen(firstConsume.event) ? 'PASS' : 'FAIL'}`);

    // (e) Copying fields, Reflect.ownKeys, JSON roundtrip, or reusing a
    //     receipt cannot authenticate a new reducer event. Each forgery
    //     attempt must fail closed at the consume boundary.
    const canonical = smokeCanonical.acceptEvent({
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('forged').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'forged',
    });
    // Field-copy
    const fieldCopy = {};
    for (const k of Object.keys(canonical)) fieldCopy[k] = canonical[k];
    const fieldCopyResult = ac.consumeAuthenticatedControlEvent(fieldCopy);
    console.log(`consume-field-copy-fails\t${fieldCopyResult.ok === false ? 'PASS' : 'FAIL'}`);
    // Reflect.ownKeys: copy every own key/descriptor into a fresh object
    const reflectedKeys = Reflect.ownKeys(canonical);
    const reflectReplica = {};
    for (const key of reflectedKeys) {
      Object.defineProperty(reflectReplica, key, Reflect.getOwnPropertyDescriptor(canonical, key));
    }
    Object.freeze(reflectReplica);
    const reflectResult = ac.consumeAuthenticatedControlEvent(reflectReplica);
    console.log(`consume-reflect-replica-fails\t${reflectResult.ok === false ? 'PASS' : 'FAIL'}`);
    // JSON roundtrip
    const roundtrip = JSON.parse(JSON.stringify(canonical));
    Object.freeze(roundtrip);
    const roundtripResult = ac.consumeAuthenticatedControlEvent(roundtrip);
    console.log(`consume-json-roundtrip-fails\t${roundtripResult.ok === false ? 'PASS' : 'FAIL'}`);
    // Receipt reuse: consume, then try to reuse the receipt's payload
    const receiptCanonical = smokeCanonical.acceptEvent({
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('receipt').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'receipt',
    });
    const firstReceiptConsume = ac.consumeAuthenticatedControlEvent(receiptCanonical);
    const receiptReuseResult = ac.consumeAuthenticatedControlEvent(firstReceiptConsume.event);
    console.log(`consume-receipt-reuse-fails\t${receiptReuseResult.ok === false ? 'PASS' : 'FAIL'}`);
    // Raw, unfrozen object
    const rawResult = ac.consumeAuthenticatedControlEvent({
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('raw').digest('hex'),
      issued_at: '2026-07-27T00:00:00.000Z', reason: 'raw', event_digest: 'a'.repeat(64),
    });
    console.log(`consume-raw-unfrozen-fails\t${rawResult.ok === false ? 'PASS' : 'FAIL'}`);
    // null/undefined/array
    console.log(`consume-null-fails\t${ac.consumeAuthenticatedControlEvent(null).ok === false ? 'PASS' : 'FAIL'}`);
    console.log(`consume-undefined-fails\t${ac.consumeAuthenticatedControlEvent(undefined).ok === false ? 'PASS' : 'FAIL'}`);
    console.log(`consume-array-fails\t${ac.consumeAuthenticatedControlEvent([]).ok === false ? 'PASS' : 'FAIL'}`);
    // Sanitized consume snapshot must have exactly the closed allowlisted
    // keys — no symbols, no extra provenance fields.
    const closedKeysAdapter = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const closedKeysCanonical = closedKeysAdapter.acceptEvent({
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('closed-keys').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'closed-keys',
    });
    const closedKeysConsume = ac.consumeAuthenticatedControlEvent(closedKeysCanonical);
    const ALLOWED_SNAPSHOT_KEYS = ['mission_lineage_id', 'action', 'authority', 'sequence', 'issued_at', 'reason', 'ceiling_before', 'ceiling_after', 'event_digest'];
    const actualKeys = Object.keys(closedKeysConsume.event).sort();
    const expectedKeys = [...ALLOWED_SNAPSHOT_KEYS].sort();
    const noSymbols = Object.getOwnPropertySymbols(closedKeysConsume.event).length === 0;
    console.log(`consume-snapshot-closed-keys\t${
      JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) && noSymbols ? 'PASS' : 'FAIL'}`);
    // Two adapters producing identical content must mint distinct event
    // identities; consuming one must not consume/collide with the other.
    const adapterA = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const adapterB = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const identicalInput = {
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('identical').digest('hex'),
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'identical-content',
    };
    const eventA = adapterA.acceptEvent({ ...identicalInput });
    const eventB = adapterB.acceptEvent({ ...identicalInput });
    const distinctIdentity = eventA !== eventB;
    const consumeA = ac.consumeAuthenticatedControlEvent(eventA);
    const consumeBAfterA = ac.consumeAuthenticatedControlEvent(eventB);
    console.log(`two-adapters-distinct-identities\t${
      distinctIdentity && consumeA.ok === true && consumeBAfterA.ok === true ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: no identity-bearing event object retained ──────────
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    // The reducer must consume the canonical event first, then create a
    // sanitized deep-frozen plain semantic snapshot for event digest,
    // storage, and receipt. Tests inspect object identity, not only
    // JSON.stringify.
    const a2 = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const L2 = 'lineage-v1-' + require('crypto').createHash('sha256').update('L2').digest('hex');
    const canonical2 = a2.acceptEvent({
      mission_lineage_id: L2, action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'no-retain',
    });
    const sNoRetain = createMissionState(makeContract());
    const result = reduceMissionState(sNoRetain, {
      event_type: 'control_event', sequence: 1, mission_lineage_id: sNoRetain.mission_lineage_id,
      payload: { event: canonical2 },
    });
    const storedEvent = result.state.events[result.state.events.length - 1];
    const payloadEvent = storedEvent.payload.event;
    // 1. The event stored in state is NOT the original canonical object.
    console.log(`state-event-not-original-canonical\t${
      payloadEvent !== canonical2 ? 'PASS' : 'FAIL'}`);
    // 2. The event stored in state is a frozen, sanitized snapshot.
    console.log(`state-event-snapshot-frozen\t${
      Object.isFrozen(payloadEvent) ? 'PASS' : 'FAIL'}`);
    console.log(`state-event-snapshot-no-cap-field\t${
      payloadEvent._adapter_capability === undefined ? 'PASS' : 'FAIL'}`);
    // 3. The receipt's source_event is also the sanitized event (not the
    //    original canonical). Test object identity.
    const sourceEventInReceipt = result.receipt.source_event;
    console.log(`receipt-source-event-not-original-canonical\t${
      sourceEventInReceipt !== canonical2 ? 'PASS' : 'FAIL'}`);
    console.log(`receipt-source-event-payload-not-original-canonical\t${
      sourceEventInReceipt.payload.event !== canonical2 ? 'PASS' : 'FAIL'}`);
    // 4. The state and receipt must NOT contain any object reference
    //    that is the same identity as the canonical event. The
    //    sanitized snapshot is a distinct object (different identity),
    //    so a structural comparison by object identity catches
    //    identity retention even when the digest values match.
    const stateJson = JSON.stringify(result.state);
    const receiptJson = JSON.stringify(result.receipt);
    // The state.events[i].payload.event must be a different object
    // (different identity) from the canonical. JSON.stringify cannot
    // express identity, so we walk the live objects to check.
    let noCanonicalIdentityInState = true;
    const walkValue = (value, seen = new WeakSet()) => {
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      if (value === canonical2) noCanonicalIdentityInState = false;
      for (const k of Object.keys(value)) walkValue(value[k], seen);
    };
    walkValue(result.state);
    let noCanonicalIdentityInReceipt = true;
    const walkValueR = (value, seen = new WeakSet()) => {
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      if (value === canonical2) noCanonicalIdentityInReceipt = false;
      for (const k of Object.keys(value)) walkValueR(value[k], seen);
    };
    walkValueR(result.receipt);
    console.log(`state-no-canonical-identity\t${
      noCanonicalIdentityInState ? 'PASS' : 'FAIL'}`);
    console.log(`receipt-no-canonical-identity\t${
      noCanonicalIdentityInReceipt ? 'PASS' : 'FAIL'}`);
    // 5. The event_digest in the stored event is independently verifiable
    //    from the stored sanitized event shape (event_type, sequence,
    //    mission_lineage_id, payload). Recomputing over the stored object
    //    must yield the same digest — proving the digest is bound to the
    //    sanitized snapshot content, not the original canonical identity.
    const independentDigest = ac.sha256({
      event_type: storedEvent.event_type,
      sequence: storedEvent.sequence,
      mission_lineage_id: storedEvent.mission_lineage_id,
      payload: storedEvent.payload,
    });
    console.log(`event-digest-bound-to-sanitized-snapshot\t${
      storedEvent.event_digest === independentDigest ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: shadow over-ceiling admission durability + clearing ─
    // Shadow mode: durable evidence is recorded, the claim is created,
    // AND the complete requested reservation is applied to state.axes
    // (remaining=0, overspend=true). A subsequent no_effect_release
    // must clear exactly that reservation without producing negative
    // counters.
    const sSh = createMissionState(makeContract());
    const overReservation = reservation(sSh, 200);
    const sh = reduceMissionState(sSh, {
      event_type: 'grant_claimed',
      sequence: 1,
      mission_lineage_id: sSh.mission_lineage_id,
      payload: {
        idempotency_key: 'shadow-durable',
        mission_lineage_id: sSh.mission_lineage_id,
        task_authority_id: sSh.task_authority_id,
        campaign_id: 'c-shadow',
        campaign_contract_digest: sSh.policy_hash,
        base_sha: '0000000000000000000000000000000000000000',
        acceptance_ids: ['acc-1'],
        reservation: overReservation,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    // Shadow applies the full reservation to axes.tool_calls.reserved_active
    // (which is 0 + 200 = 200, even above the 100 ceiling). remaining
    // is clamped to 0, overspend is true.
    console.log(`shadow-axes-applied-overspend\t${
      sh.state.axes.tool_calls.reserved_active === 200 ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-remaining-zero\t${
      sh.state.axes.tool_calls.remaining === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-overspend-flag-true\t${
      sh.state.axes.tool_calls.overspend === true ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-evidence-keyed-by-digest\t${
      sh.state.receipts[`mission_would_block_evidence:${sh.receipt.source_event.event_digest}`] !== undefined
      ? 'PASS' : 'FAIL'}`);
    // Release clears exactly the reservation. No negative counter.
    const claimId = sh.receipt.claim_id;
    const rel = reduceMissionState(sh.state, {
      event_type: 'no_effect_release', sequence: sh.state.events.length + 1,
      mission_lineage_id: sSh.mission_lineage_id,
      payload: { claim_id: claimId },
    });
    console.log(`shadow-release-tool-reserved-clears\t${
      rel.state.axes.tool_calls.reserved_active === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`shadow-release-no-negative-counters\t${
      rel.state.axes.tool_calls.reserved_active >= 0
      && rel.state.axes.campaigns.reserved_active >= 0
      && rel.state.axes.wall_seconds.reserved_active >= 0 ? 'PASS' : 'FAIL'}`);
    // Re-reconcile an overspend on the same claim (the claim is released,
    // so this should reject without mutation).
    const reReconcile = reduceMissionState(rel.state, {
      event_type: 'reconciliation', sequence: rel.state.events.length + 1,
      mission_lineage_id: sSh.mission_lineage_id,
      payload: { claim_id: claimId, actual_usage: reservation(rel.state, 100) },
    });
    console.log(`shadow-release-rejects-recon\t${
      reReconcile.receipt.artifact_type === 'mission_grant_rejected' ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: Enforce mode rejects shadow-style input without mutating axes
    const enforceContract = makeContract();
    enforceContract.enforcement_mode = 'enforce';
    const sEnf = createMissionState(enforceContract);
    const overReservation = reservation(sEnf, 200);
    const before = sEnf.axes.tool_calls.reserved_active;
    const ef = reduceMissionState(sEnf, {
      event_type: 'grant_claimed',
      sequence: 1,
      mission_lineage_id: sEnf.mission_lineage_id,
      payload: {
        idempotency_key: 'enforce-no-mutate',
        mission_lineage_id: sEnf.mission_lineage_id,
        task_authority_id: sEnf.task_authority_id,
        campaign_id: 'c-enforce',
        campaign_contract_digest: sEnf.policy_hash,
        base_sha: '0000000000000000000000000000000000000000',
        acceptance_ids: ['acc-1'],
        reservation: overReservation,
        issued_at: '2026-07-27T00:00:00.000Z',
        expires_at: '2026-07-27T01:00:00.000Z',
      },
    });
    console.log(`enforce-blocks-overspend-no-axes-mutation\t${
      ef.state.state === 'BLOCKED'
      && ef.state.axes.tool_calls.reserved_active === before ? 'PASS' : 'FAIL'}`);
    console.log(`enforce-creates-no-claim\t${
      Object.keys(ef.state.claims).length === 0 ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: stateHash covers config; restore rejects binding mismatch ─
    // Direct test: modify the config_snapshot of a projection, recompute
    // ONLY the outer projection_digest, then verify that restore still
    // rejects because the state_hash / config_digest binding differs.
    const sBinding = createMissionState(makeContract());
    const proj = buildProjection(sBinding);
    // Build a tampered config_snapshot that has a different field.
    const tamperedBinding = JSON.parse(JSON.stringify(proj));
    // Modify closure_ratio in the embedded config_snapshot.
    tamperedBinding.config_snapshot.closure_ratio = 0.5;
    // Recompute the config_digest over the modified snapshot to match
    // the projection's own digest (the test bypasses the per-snapshot
    // config_digest check by also updating that field).
    const newCfgDigest = m.computeConfigDigest({
      schema_version: tamperedBinding.config_snapshot.schema_version,
      artifact_type: tamperedBinding.config_snapshot.artifact_type,
      contract_id: tamperedBinding.config_snapshot.contract_id,
      repo_identity: tamperedBinding.config_snapshot.repo_identity,
      mission_lineage_id: tamperedBinding.config_snapshot.mission_lineage_id,
      task_authority_id: tamperedBinding.config_snapshot.task_authority_id,
      policy_hash: tamperedBinding.config_snapshot.policy_hash,
      enforcement_mode: tamperedBinding.config_snapshot.enforcement_mode,
      state: tamperedBinding.config_snapshot.contract_state,
      closure_ratio: tamperedBinding.config_snapshot.closure_ratio,
      max_stagnant_campaigns: tamperedBinding.config_snapshot.max_stagnant_campaigns,
      red_lines: tamperedBinding.config_snapshot.red_lines,
      axes: tamperedBinding.config_snapshot.axes,
      grant_contract: tamperedBinding.config_snapshot.grant_contract,
      control_contract: tamperedBinding.config_snapshot.control_contract,
      lineage_binding: {
        task_authority_id: tamperedBinding.config_snapshot.lineage_binding.task_authority_id,
        root_run_id: tamperedBinding.config_snapshot.lineage_binding.root_run_id,
        policy_hash: tamperedBinding.config_snapshot.lineage_binding.policy_hash,
        successor_inherits_durable_consumed: tamperedBinding.config_snapshot.lineage_binding.successor_inherits_durable_consumed === true,
      },
    }, tamperedBinding.config_snapshot.provenance);
    tamperedBinding.config_digest = newCfgDigest;
    // Recompute only the outer projection_digest to pass the outer
    // digest check. The state_hash field in the projection is the
    // ORIGINAL state hash; restore will fail because the restored
    // state's hash (which now depends on the modified config's digest)
    // cannot match.
    tamperedBinding.projection_digest = m.sha256({ ...tamperedBinding, projection_digest: undefined });
    let bindingMismatchRejected = false;
    let bindingErr = null;
    try { restoreProjection(tamperedBinding); } catch (e) { bindingErr = e.code || e.message; bindingMismatchRejected = true; }
    console.log(`restore-rejects-config-binding-tamper\t${
      bindingMismatchRejected ? 'PASS' : 'FAIL'}`);
    console.log(`restore-rejects-config-binding-tamper-code\t${
      bindingErr === 'PROJECTION_HASH_MISMATCH' ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: cross-field lineage/task/policy binding on restore ──
    // A tampered config_snapshot whose lineage_binding.task_authority_id
    // does not match its task_authority_id must reject restore.
    const sX = createMissionState(makeContract());
    const projX = buildProjection(sX);
    const tamperedX = JSON.parse(JSON.stringify(projX));
    tamperedX.config_snapshot.lineage_binding.task_authority_id = '0'.repeat(64);
    // Recompute config_digest and projection_digest to focus on the binding check.
    const newCfgDigestX = m.computeConfigDigest({
      schema_version: tamperedX.config_snapshot.schema_version,
      artifact_type: tamperedX.config_snapshot.artifact_type,
      contract_id: tamperedX.config_snapshot.contract_id,
      repo_identity: tamperedX.config_snapshot.repo_identity,
      mission_lineage_id: tamperedX.config_snapshot.mission_lineage_id,
      task_authority_id: tamperedX.config_snapshot.task_authority_id,
      policy_hash: tamperedX.config_snapshot.policy_hash,
      enforcement_mode: tamperedX.config_snapshot.enforcement_mode,
      state: tamperedX.config_snapshot.contract_state,
      closure_ratio: tamperedX.config_snapshot.closure_ratio,
      max_stagnant_campaigns: tamperedX.config_snapshot.max_stagnant_campaigns,
      red_lines: tamperedX.config_snapshot.red_lines,
      axes: tamperedX.config_snapshot.axes,
      grant_contract: tamperedX.config_snapshot.grant_contract,
      control_contract: tamperedX.config_snapshot.control_contract,
      lineage_binding: {
        task_authority_id: tamperedX.config_snapshot.lineage_binding.task_authority_id,
        root_run_id: tamperedX.config_snapshot.lineage_binding.root_run_id,
        policy_hash: tamperedX.config_snapshot.lineage_binding.policy_hash,
        successor_inherits_durable_consumed: tamperedX.config_snapshot.lineage_binding.successor_inherits_durable_consumed === true,
      },
    }, tamperedX.config_snapshot.provenance);
    tamperedX.config_digest = newCfgDigestX;
    tamperedX.projection_digest = m.sha256({ ...tamperedX, projection_digest: undefined });
    let crossFieldRejected = false;
    let crossErr = null;
    try { restoreProjection(tamperedX); } catch (e) { crossErr = e.code || e.message; crossFieldRejected = true; }
    console.log(`restore-rejects-cross-field-binding-mismatch\t${
      crossFieldRejected ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── P1 repair: source refs per-entry digest validation ───────────
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
    // The new `validateSourceRefs` rejects malformed, duplicate, or
    // recomputed-content-mismatch refs. Positive and negative cases.
    const sRefs = createMissionState(makeContract());
    const L = 'lineage-v1-' + require('crypto').createHash('sha256').update('L').digest('hex');

    // Positive: a well-formed ref passes and roundtrips.
    const goodRef = {
      kind: 'evidence',
      locator: 'docs/specs/control.md',
      label: 'control spec',
      evidence_kind: 'frozen_spec',
      digest: m.computeSourceRefDigest({
        kind: 'evidence',
        locator: 'docs/specs/control.md',
        label: 'control spec',
        evidence_kind: 'frozen_spec',
      }),
    };
    const goodProj = buildProjection(sRefs, [goodRef]);
    console.log(`source-ref-positive-passes\t${
      goodProj.source_refs.length === 1 && goodProj.source_refs[0].digest === goodRef.digest
      ? 'PASS' : 'FAIL'}`);
    const goodRestored = restoreProjection(goodProj);
    console.log(`source-ref-positive-restore-passes\t${
      goodRestored !== null ? 'PASS' : 'FAIL'}`);

    // Negative: missing digest field rejects at buildProjection.
    let missingDigestRejected = false;
    try {
      buildProjection(sRefs, [{
        kind: 'evidence', locator: 'docs/missing.md', label: 'missing', evidence_kind: 'frozen_spec',
      }]);
    } catch (e) { missingDigestRejected = e.code === 'SOURCE_REF_DIGEST_MISSING'; }
    console.log(`source-ref-missing-digest-rejects\t${
      missingDigestRejected ? 'PASS' : 'FAIL'}`);

    // Negative: wrong digest rejects at buildProjection.
    let wrongDigestRejected = false;
    try {
      buildProjection(sRefs, [{
        kind: 'evidence', locator: 'docs/wrong.md', label: 'wrong',
        evidence_kind: 'frozen_spec', digest: 'a'.repeat(64),
      }]);
    } catch (e) { wrongDigestRejected = e.code === 'SOURCE_REF_DIGEST_MISMATCH'; }
    console.log(`source-ref-wrong-digest-rejects\t${
      wrongDigestRejected ? 'PASS' : 'FAIL'}`);

    // Negative: duplicate locator rejects.
    let duplicateRejected = false;
    try {
      buildProjection(sRefs, [
        { kind: 'evidence', locator: 'docs/dup.md', label: 'a', evidence_kind: 'frozen_spec',
          digest: m.computeSourceRefDigest({ kind: 'evidence', locator: 'docs/dup.md', label: 'a', evidence_kind: 'frozen_spec' }) },
        { kind: 'snapshot', locator: 'docs/dup.md', label: 'b', evidence_kind: 'frozen_spec',
          digest: m.computeSourceRefDigest({ kind: 'snapshot', locator: 'docs/dup.md', label: 'b', evidence_kind: 'frozen_spec' }) },
      ]);
    } catch (e) { duplicateRejected = e.code === 'SOURCE_REF_DUPLICATE_LOCATOR'; }
    console.log(`source-ref-duplicate-locator-rejects\t${
      duplicateRejected ? 'PASS' : 'FAIL'}`);

    // Negative: unknown kind rejects.
    let unknownKindRejected = false;
    try {
      buildProjection(sRefs, [{
        kind: 'mystery', locator: 'docs/mystery.md', label: 'mystery',
        evidence_kind: 'frozen_spec',
        digest: m.computeSourceRefDigest({ kind: 'mystery', locator: 'docs/mystery.md', label: 'mystery', evidence_kind: 'frozen_spec' }),
      }]);
    } catch (e) { unknownKindRejected = e.code === 'SOURCE_REF_KIND_INVALID'; }
    console.log(`source-ref-unknown-kind-rejects\t${
      unknownKindRejected ? 'PASS' : 'FAIL'}`);

    // Negative: restore rejects a tampered ref (recomputed digest doesn't match).
    // The tampered ref's locator is changed AFTER the digest was computed,
    // so the recompute path catches the mismatch.
    const tamperedRefProj = JSON.parse(JSON.stringify(goodProj));
    const computedDigest = m.computeSourceRefDigest({
      kind: 'evidence', locator: 'docs/tampered.md', label: 'tampered', evidence_kind: 'frozen_spec',
    });
    tamperedRefProj.source_refs = [{
      kind: 'evidence',
      locator: 'docs/tampered-renamed.md', // different from what was used to compute the digest
      label: 'tampered',
      evidence_kind: 'frozen_spec',
      digest: computedDigest,
    }];
    tamperedRefProj.projection_digest = m.sha256({ ...tamperedRefProj, projection_digest: undefined });
    let restoreRefTamperRejected = false;
    try { restoreProjection(tamperedRefProj); } catch (e) { restoreRefTamperRejected = true; }
    console.log(`source-ref-restore-tamper-rejects\t${
      restoreRefTamperRejected ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Fix #1: closed-shape control payload alias attack ─────────────
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    const aliasAdapter = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const sAlias = createMissionState(makeContract());
    const aliasCanonical = aliasAdapter.acceptEvent({
      mission_lineage_id: sAlias.mission_lineage_id,
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'alias-attack',
    });
    // Payload with an extra alias property referencing the same canonical event
    let aliasRejected = false;
    let aliasErrCode = null;
    try {
      reduceMissionState(sAlias, {
        event_type: 'control_event', sequence: 1,
        mission_lineage_id: sAlias.mission_lineage_id,
        payload: { event: aliasCanonical, alias: aliasCanonical },
      });
    } catch (e) { aliasRejected = true; aliasErrCode = e.code; }
    console.log(`control-payload-alias-attack-rejects\t${
      aliasRejected && aliasErrCode === 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED' ? 'PASS' : 'FAIL'}`);
    // Payload with any extra key (not an alias) also rejects
    let extraKeyRejected = false;
    try {
      reduceMissionState(sAlias, {
        event_type: 'control_event', sequence: 1,
        mission_lineage_id: sAlias.mission_lineage_id,
        payload: { event: aliasCanonical, hint: 'something' },
      });
    } catch (e) { extraKeyRejected = e.code === 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED'; }
    console.log(`control-payload-extra-key-rejects\t${
      extraKeyRejected ? 'PASS' : 'FAIL'}`);
    // Valid single-key payload still works and recursively contains no
    // authenticated object identity.
    const aliasAdapter2 = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const goodCanonical = aliasAdapter2.acceptEvent({
      mission_lineage_id: sAlias.mission_lineage_id,
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'clean',
    });
    const aliasResult = reduceMissionState(sAlias, {
      event_type: 'control_event', sequence: 1,
      mission_lineage_id: sAlias.mission_lineage_id,
      payload: { event: goodCanonical },
    });
    // Recursively inspect live stored objects: no nested field may be the
    // original canonical identity.
    let noIdentityLeak = true;
    const walkIdentity = (value, seen = new WeakSet()) => {
      if (value === null || typeof value !== 'object') return;
      if (seen.has(value)) return;
      seen.add(value);
      if (value === goodCanonical) noIdentityLeak = false;
      for (const k of Reflect.ownKeys(value)) {
        if (typeof k === 'string') walkIdentity(value[k], seen);
      }
    };
    walkIdentity(aliasResult.state);
    walkIdentity(aliasResult.receipt);
    console.log(`control-payload-no-identity-leak\t${
      noIdentityLeak ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Fix #2: isAuthenticatedAdapterCapability not in barrel export ──
    const engineIndex = require(path.join(root, 'src', 'engine', 'index.js'));
    console.log(`predicate-not-in-barrel-export\t${
      engineIndex.isAuthenticatedAdapterCapability === undefined ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Fix #3: minimal source-ref (no optional keys) build/restore ────
    const sMinRef = createMissionState(makeContract());
    const minRef = {
      kind: 'commit',
      locator: 'abc123',
      label: 'minimal ref',
      digest: m.computeSourceRefDigest({ kind: 'commit', locator: 'abc123', label: 'minimal ref' }),
    };
    const minProj = buildProjection(sMinRef, [minRef]);
    const minRefStored = minProj.source_refs[0];
    const noUndefinedKeys = !Object.prototype.hasOwnProperty.call(minRefStored, 'evidence_kind')
      && !Object.prototype.hasOwnProperty.call(minRefStored, 'ref_class');
    console.log(`source-ref-minimal-no-undefined-keys\t${
      noUndefinedKeys ? 'PASS' : 'FAIL'}`);
    const minRestored = restoreProjection(minProj);
    console.log(`source-ref-minimal-restore-passes\t${
      minRestored !== null ? 'PASS' : 'FAIL'}`);
    // Closed-shape: unsupported key rejects
    let closedShapeRejected = false;
    try {
      buildProjection(sMinRef, [{
        kind: 'commit', locator: 'x', label: 'y', extra_field: 'bad',
        digest: m.computeSourceRefDigest({ kind: 'commit', locator: 'x', label: 'y' }),
      }]);
    } catch (e) { closedShapeRejected = e.code === 'SOURCE_REF_UNSUPPORTED_KEY'; }
    console.log(`source-ref-closed-shape-malformed-rejects\t${
      closedShapeRejected ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Fix #4: cross-binding family negative tests ───────────────────
    // Each test tampers one config_snapshot identity field, recomputes
    // digests, and verifies restore rejects with PROJECTION_BINDING_MISMATCH.
    const sBind = createMissionState(makeContract());
    const projBind = buildProjection(sBind);

    function tamperAndRestore(mutate) {
      const t = JSON.parse(JSON.stringify(projBind));
      mutate(t);
      t.config_digest = m.computeConfigDigest({
        schema_version: t.config_snapshot.schema_version,
        artifact_type: t.config_snapshot.artifact_type,
        contract_id: t.config_snapshot.contract_id,
        repo_identity: t.config_snapshot.repo_identity,
        mission_lineage_id: t.config_snapshot.mission_lineage_id,
        task_authority_id: t.config_snapshot.task_authority_id,
        policy_hash: t.config_snapshot.policy_hash,
        enforcement_mode: t.config_snapshot.enforcement_mode,
        state: t.config_snapshot.contract_state,
        closure_ratio: t.config_snapshot.closure_ratio,
        max_stagnant_campaigns: t.config_snapshot.max_stagnant_campaigns,
        red_lines: t.config_snapshot.red_lines,
        axes: t.config_snapshot.axes,
        grant_contract: t.config_snapshot.grant_contract,
        control_contract: t.config_snapshot.control_contract,
        lineage_binding: {
          task_authority_id: t.config_snapshot.lineage_binding.task_authority_id,
          root_run_id: t.config_snapshot.lineage_binding.root_run_id,
          policy_hash: t.config_snapshot.lineage_binding.policy_hash,
          successor_inherits_durable_consumed: t.config_snapshot.lineage_binding.successor_inherits_durable_consumed === true,
        },
      }, t.config_snapshot.provenance);
      t.projection_digest = m.sha256({ ...t, projection_digest: undefined });
      try { restoreProjection(t); return null; } catch (e) { return e.code; }
    }

    const errLineage = tamperAndRestore((t) => {
      t.config_snapshot.mission_lineage_id = 'lineage-v1-' + 'f'.repeat(64);
    });
    console.log(`restore-rejects-lineage-id-mismatch\t${
      errLineage === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errTask = tamperAndRestore((t) => {
      t.config_snapshot.task_authority_id = 'e'.repeat(64);
    });
    console.log(`restore-rejects-task-authority-mismatch\t${
      errTask === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errPolicy = tamperAndRestore((t) => {
      t.config_snapshot.policy_hash = 'd'.repeat(64);
    });
    console.log(`restore-rejects-policy-hash-mismatch\t${
      errPolicy === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errEnforce = tamperAndRestore((t) => {
      t.config_snapshot.enforcement_mode = 'enforce';
    });
    console.log(`restore-rejects-enforcement-mode-mismatch\t${
      errEnforce === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errLineageBinding = tamperAndRestore((t) => {
      t.config_snapshot.lineage_binding.policy_hash = 'b'.repeat(64);
    });
    console.log(`restore-rejects-lineage-binding-policy-hash-mismatch\t${
      errLineageBinding === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errLBTaskAuth = tamperAndRestore((t) => {
      t.config_snapshot.lineage_binding.task_authority_id = 'a'.repeat(64);
    });
    console.log(`restore-rejects-lineage-binding-task-authority-mismatch\t${
      errLBTaskAuth === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errLBRootRun = tamperAndRestore((t) => {
      t.config_snapshot.lineage_binding.root_run_id = 'tampered-root';
    });
    console.log(`restore-rejects-lineage-binding-root-run-id-mismatch\t${
      errLBRootRun === 'PROJECTION_HASH_MISMATCH' ? 'PASS' : 'FAIL'}`);

    const errLBSucc = tamperAndRestore((t) => {
      t.config_snapshot.lineage_binding.successor_inherits_durable_consumed = false;
    });
    console.log(`restore-rejects-lineage-binding-successor-flag-mismatch\t${
      errLBSucc === 'PROJECTION_BINDING_MISMATCH' ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── Fix #2: symbol-key and non-enumerable-key alias attacks ────────
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    const symAdapter = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const sSym = createMissionState(makeContract());
    const symCanonical = symAdapter.acceptEvent({
      mission_lineage_id: sSym.mission_lineage_id,
      action: 'finish_requested', authority: 'authenticated_user',
      sequence: 1, issued_at: '2026-07-27T00:00:00.000Z', reason: 'sym-attack',
    });
    // Symbol-key aliasing the canonical event
    let symRejected = false;
    let symErrCode = null;
    try {
      const symPayload = { event: symCanonical };
      symPayload[Symbol('alias')] = symCanonical;
      reduceMissionState(sSym, {
        event_type: 'control_event', sequence: 1,
        mission_lineage_id: sSym.mission_lineage_id,
        payload: symPayload,
      });
    } catch (e) { symRejected = true; symErrCode = e.code; }
    console.log(`control-payload-symbol-key-alias-rejects\t${
      symRejected && symErrCode === 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED' ? 'PASS' : 'FAIL'}`);
    // Non-enumerable key aliasing the canonical event
    let nonEnumRejected = false;
    let nonEnumErrCode = null;
    try {
      const nonEnumPayload = { event: symCanonical };
      Object.defineProperty(nonEnumPayload, 'hidden', {
        value: symCanonical, enumerable: false, writable: true, configurable: true,
      });
      reduceMissionState(sSym, {
        event_type: 'control_event', sequence: 1,
        mission_lineage_id: sSym.mission_lineage_id,
        payload: nonEnumPayload,
      });
    } catch (e) { nonEnumRejected = true; nonEnumErrCode = e.code; }
    console.log(`control-payload-non-enumerable-alias-rejects\t${
      nonEnumRejected && nonEnumErrCode === 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED' ? 'PASS' : 'FAIL'}`);
    // The canonical event must still be unconsumed: a legitimate exact
    // payload can still use it once.
    const legitResult = reduceMissionState(sSym, {
      event_type: 'control_event', sequence: 1,
      mission_lineage_id: sSym.mission_lineage_id,
      payload: { event: symCanonical },
    });
    console.log(`control-payload-canonical-still-unconsumed\t${
      legitResult && legitResult.state ? 'PASS' : 'FAIL'}`);
  }
  {
    // ─── normalizeLineageBinding fail-closed validation ─────────────────
    const baseContract = makeContract();
    const taId = baseContract.task_authority_id;
    const phId = baseContract.policy_hash;

    // Missing successor_inherits_durable_consumed rejects.
    let missingSuccRejected = false;
    try {
      createMissionState({ ...baseContract, lineage_binding: {
        task_authority_id: taId, root_run_id: 'root-ms', policy_hash: phId,
      }});
    } catch (e) { missingSuccRejected = e.code === 'LINEAGE_BINDING_MISSING_KEY'; }
    console.log(`lineage-binding-missing-successor-rejects\t${missingSuccRejected ? 'PASS' : 'FAIL'}`);

    // Successor flag supplied only via prototype inheritance rejects.
    let protoInheritRejected = false;
    try {
      Object.defineProperty(Object.prototype, 'successor_inherits_durable_consumed', {
        value: true, configurable: true, enumerable: true, writable: true,
      });
      const protoObj = { task_authority_id: taId, root_run_id: 'root-proto', policy_hash: phId };
      createMissionState({ ...baseContract, lineage_binding: protoObj });
    } catch (e) { protoInheritRejected = e.code === 'LINEAGE_BINDING_MISSING_KEY'; }
    finally { delete Object.prototype.successor_inherits_durable_consumed; }
    console.log(`lineage-binding-proto-inherited-successor-rejects\t${protoInheritRejected ? 'PASS' : 'FAIL'}`);

    // Accessor property rejects.
    let accessorRejected = false;
    try {
      const accessorObj = { task_authority_id: taId, root_run_id: 'root-acc', policy_hash: phId };
      Object.defineProperty(accessorObj, 'successor_inherits_durable_consumed', {
        get() { return true; }, enumerable: true, configurable: true,
      });
      createMissionState({ ...baseContract, lineage_binding: accessorObj });
    } catch (e) { accessorRejected = e.code === 'LINEAGE_BINDING_ACCESSOR_KEY'; }
    console.log(`lineage-binding-accessor-rejects\t${accessorRejected ? 'PASS' : 'FAIL'}`);

    // Valid plain four-field object is accepted and projection roundtrip succeeds.
    const validLB = {
      task_authority_id: taId, root_run_id: 'root-valid', policy_hash: phId,
      successor_inherits_durable_consumed: false,
    };
    const sValid = createMissionState({ ...baseContract, lineage_binding: validLB });
    console.log(`lineage-binding-valid-four-field-accepted\t${
      sValid.config.lineage_binding.successor_inherits_durable_consumed === false
      && sValid.config.lineage_binding.root_run_id === 'root-valid' ? 'PASS' : 'FAIL'}`);
    const projValid = buildProjection(sValid);
    const restoredValid = restoreProjection(projValid);
    console.log(`lineage-binding-valid-projection-roundtrip\t${
      stateHash(restoredValid) === projValid.state_hash ? 'PASS' : 'FAIL'}`);
  }
}
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "P1 fixture runner executes"

for id in \
  legacy-config-off partial-config-rejected identity-cannot-reset single-use-claim \
  resume-reuses-claim no-effect-release terminal-reconcile-once overspend-blocks \
  agent-cannot-loosen stale-control-blocks shadow-never-blocks-effect projection-roundtrip
do
  assert_contains "$OUT" "$id	PASS	" "RED: $id"
done

for id in \
  replay-same-claim-id-direct replay-no-double-reserve-direct \
  double-release-rejected-direct \
  binding-mismatch-direct projection-roundtrip-hash-equal \
  projection-raw-transcript-false terminal-reconcile-replay-noop-direct \
  successor-inherits-direct \
  successor-inherits-lineage successor-inherits-task-authority \
  successor-inherits-policy-hash \
  grant-empty-reservation-rejects grant-partial-reservation-rejects \
  grant-duplicate-axis-rejects grant-unknown-axis-rejects \
  grant-zero-campaign-rejects \
  grant-same-binding-different-idem-rejects \
  grant-same-key-changed-reservation-rejects \
  grant-same-key-changed-binding-rejects \
  grant-exact-replay-idempotent \
  shadow-does-not-block-state shadow-would-block-evidence-recorded \
  shadow-evidence-has-overspend-axis enforce-blocks-overspend \
  shadow-grant-claim-created shadow-grant-reservation-recorded \
  shadow-repeated-admissions-cumulative enforce-creates-no-shadow-claim \
  reconcile-consumed-equals-actual \
  reconcile-freed-equals-original-minus-actual \
  reconcile-missing-axes-zero-actual \
  reconcile-missing-axes-free-original \
  reconcile-overspend-blocks-once reconcile-overspend-clears-reservation \
  reconcile-overspend-terminalizes-claim reconcile-overspend-conservative-charge \
  registry-not-exported-authenticated-control \
  registry-not-exported-engine-index \
  registry-not-exported-mission-convergence \
  predicate-rejects-fabricated-capability \
  forgery-plain-object-verifier-rejected forgery-missing-verifier-rejected \
  capability-present-for-reducer capability-non-enumerable \
  capability-not-serialized \
  canonical-json-rejects-symbol canonical-json-rejects-function \
  stored-event-payload-omits-capability \
  stored-event-json-omits-capability receipt-json-omits-capability \
  raw-control-event-rejects forged-capability-control-event-rejects \
  verifier-reject-authoritative-with-extra-args \
  verifier-authority-change-authoritative \
  verifier-cannot-be-replaced-by-caller \
  projection-tamper-digest-rejects projection-tamper-head-rejects \
  projection-tamper-config-rejects projection-tamper-source-refs-rejects \
  projection-restored-hash-equals-original \
  projection-restored-hash-equals-snapshot \
  projection-roundtrip-replay-valid-next-claim \
  projection-restored-config-complete-shape \
  projection-replay-events-not-exported \
  projection-restored-state-immutable \
  immutability-contract-bindings immutability-axes \
  immutability-claims immutability-events \
  immutability-replay-return-state \
  state-immutable-after-construction \
  state-idempotent-replay-no-double-reserve \
  config-unknown-key-rejects config-missing-field-rejects \
  config-wrong-type-rejects config-range-violation-rejects \
  config-bad-provenance-rejects config-absent-section-off \
  config-no-section-off \
  adapter-construction-smoke no-public-mint-function no-public-token \
  no-capability-field-on-canonical \
  consume-first-succeeds consume-second-fails \
  consume-snapshot-sanitized consume-snapshot-frozen \
  consume-field-copy-fails consume-reflect-replica-fails \
  consume-json-roundtrip-fails consume-receipt-reuse-fails \
  consume-raw-unfrozen-fails consume-null-fails \
  consume-undefined-fails consume-array-fails \
  consume-snapshot-closed-keys two-adapters-distinct-identities \
  state-event-not-original-canonical \
  state-event-snapshot-frozen state-event-snapshot-no-cap-field \
  receipt-source-event-not-original-canonical \
  receipt-source-event-payload-not-original-canonical \
  state-no-canonical-identity receipt-no-canonical-identity \
  event-digest-bound-to-sanitized-snapshot \
  shadow-axes-applied-overspend shadow-remaining-zero \
  shadow-overspend-flag-true shadow-evidence-keyed-by-digest \
  shadow-release-tool-reserved-clears shadow-release-no-negative-counters \
  shadow-release-rejects-recon \
  enforce-blocks-overspend-no-axes-mutation enforce-creates-no-claim \
  restore-rejects-config-binding-tamper \
  restore-rejects-config-binding-tamper-code \
  restore-rejects-cross-field-binding-mismatch \
  source-ref-positive-passes source-ref-positive-restore-passes \
  source-ref-missing-digest-rejects source-ref-wrong-digest-rejects \
  source-ref-duplicate-locator-rejects source-ref-unknown-kind-rejects \
  source-ref-restore-tamper-rejects \
  control-payload-alias-attack-rejects control-payload-extra-key-rejects \
  control-payload-no-identity-leak \
  predicate-not-in-barrel-export \
  source-ref-minimal-no-undefined-keys source-ref-minimal-restore-passes \
  source-ref-closed-shape-malformed-rejects \
  restore-rejects-lineage-id-mismatch restore-rejects-task-authority-mismatch \
  restore-rejects-policy-hash-mismatch restore-rejects-enforcement-mode-mismatch \
  restore-rejects-lineage-binding-policy-hash-mismatch \
  restore-rejects-lineage-binding-task-authority-mismatch \
  restore-rejects-lineage-binding-root-run-id-mismatch \
  restore-rejects-lineage-binding-successor-flag-mismatch \
  control-payload-symbol-key-alias-rejects \
  control-payload-non-enumerable-alias-rejects \
  control-payload-canonical-still-unconsumed \
  lineage-binding-missing-successor-rejects \
  lineage-binding-proto-inherited-successor-rejects \
  lineage-binding-accessor-rejects \
  lineage-binding-valid-four-field-accepted \
  lineage-binding-valid-projection-roundtrip
do
  assert_contains "$OUT" "$id	PASS" "RED: generic state transition $id"
done

finalize_test
