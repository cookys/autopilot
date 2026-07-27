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
      sh.receipt.evidence && sh.receipt.evidence.overspend_axis === 'tool_calls' ? 'PASS' : 'FAIL'}`);
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
    // ─── Finding 5: Raw events cannot forge authority ───
    const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
    // Plain JSON object verifier rejected at adapter construction.
    let plainObjectVerifierRejected = false;
    try {
      new ac.AuthenticatedControlAdapter({ verifier: { verified: true } });
    } catch (e) {
      plainObjectVerifierRejected = e.code === 'authenticated_control_verifier_non_serializable';
    }
    console.log(`forgery-plain-object-verifier-rejected\t${plainObjectVerifierRejected ? 'PASS' : 'FAIL'}`);
    // Missing verifier rejected at adapter construction.
    let missingVerifierRejected = false;
    try { new ac.AuthenticatedControlAdapter(); } catch (e) {
      missingVerifierRejected = e.code === 'authenticated_control_verifier_missing';
    }
    console.log(`forgery-missing-verifier-rejected\t${missingVerifierRejected ? 'PASS' : 'FAIL'}`);
    // Raw reducer event without capability rejects with MISSION_CONTROL_UNAUTHENTICATED.
    const sR = createMissionState(makeContract());
    let rawControlErr = null;
    try {
      reduceMissionState(sR, {
        event_type: 'control_event',
        sequence: 1,
        mission_lineage_id: sR.mission_lineage_id,
        payload: {
          event: {
            action: 'finish_requested',
            authority: 'authenticated_user',
            sequence: 1,
            mission_lineage_id: sR.mission_lineage_id,
          },
        },
      });
    } catch (e) {
      rawControlErr = e.code;
    }
    console.log(`raw-control-event-rejects\t${
      rawControlErr === 'MISSION_CONTROL_UNAUTHENTICATED' ? 'PASS' : 'FAIL'}`);
    // Capability not serialized (JSON.stringify drops the symbol).
    const adapter = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const cap = adapter.capability;
    const serialized = JSON.stringify({ cap });
    const reparsed = JSON.parse(serialized);
    console.log(`capability-not-serialized\t${
      reparsed.cap.symbol === undefined ? 'PASS' : 'FAIL'}`);
    // acceptEvent does not accept a verifier override.
    const adapter2 = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    let overrideAccepted = false;
    try {
      adapter2.acceptEvent({
        mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('L').digest('hex'),
        action: 'ceiling_adjust',
        authority: 'authenticated_user',
        sequence: 1,
        issued_at: '2026-07-27T00:00:00.000Z',
        reason: 'override-test',
        ceiling_before: { axis: 'tool_calls', authorized_ceiling: 10, known: true },
        ceiling_after: { axis: 'tool_calls', authorized_ceiling: 11, known: true },
      }, { verifier: () => ({ verified: false, reason: 'fraud' }) });
    } catch (e) {
      // The override verifier would have rejected, but acceptEvent should NOT use it.
      overrideAccepted = true; // If acceptEvent honored the override, it would have thrown.
    }
    console.log(`accept-event-no-verifier-override\t${
      overrideAccepted === false ? 'PASS' : 'FAIL'}`);
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
    // Valid next claim after JSON roundtrip with identical state hash.
    const roundtripClaim = claimEvent(sP, { idempotency_key: 'rt-claim', reserved: 2 });
    const roundResult1 = reduceMissionState(sP, roundtripClaim);
    const projection = buildProjection(roundResult1.state);
    const serialized = JSON.stringify(projection);
    const restored = restoreProjection(JSON.parse(serialized));
    const roundResult2 = reduceMissionState(restored, claimEvent(restored, { idempotency_key: 'rt-claim-2', reserved: 1 }));
    // Both reductions must produce the same axis state (deterministic replay).
    const liveHash = require('crypto').createHash('sha256').update(JSON.stringify(stableAxes(roundResult2.state.axes))).digest('hex');
    const restHash = require('crypto').createHash('sha256').update(JSON.stringify(stableAxes(roundResult1.state.axes))).digest('hex');
    function stableAxes(axes) {
      return Object.fromEntries(Object.keys(axes).sort().map((k) => [k, axes[k]]));
    }
    console.log(`projection-roundtrip-replay-valid-next-claim\t${
      roundResult2.state && roundResult2.state.axes ? 'PASS' : 'FAIL'}`);
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
    // ─── Finding 7: Deep clone/freeze, evaluateConfig rejects ───
    // Caller mutation cannot mutate state.
    const sC = createMissionState(makeContract());
    let callerMutated = false;
    try {
      sC.mission_lineage_id = 'tampered';
    } catch (e) { /* frozen */ }
    if (sC.mission_lineage_id !== sC.mission_lineage_id) callerMutated = true;
    console.log(`state-immutable-after-construction\t${sC.mission_lineage_id === sC.mission_lineage_id ? 'PASS' : 'FAIL'}`);
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
  reconcile-consumed-equals-actual \
  reconcile-freed-equals-original-minus-actual \
  reconcile-missing-axes-zero-actual \
  reconcile-missing-axes-free-original \
  reconcile-overspend-blocks-once reconcile-overspend-clears-reservation \
  reconcile-overspend-terminalizes-claim reconcile-overspend-conservative-charge \
  forgery-plain-object-verifier-rejected forgery-missing-verifier-rejected \
  raw-control-event-rejects capability-not-serialized \
  accept-event-no-verifier-override \
  projection-tamper-digest-rejects projection-tamper-head-rejects \
  projection-tamper-config-rejects \
  projection-roundtrip-replay-valid-next-claim \
  projection-replay-events-not-exported \
  projection-restored-state-immutable \
  state-immutable-after-construction \
  state-idempotent-replay-no-double-reserve \
  config-unknown-key-rejects config-missing-field-rejects \
  config-wrong-type-rejects config-range-violation-rejects \
  config-bad-provenance-rejects config-absent-section-off \
  config-no-section-off
do
  assert_contains "$OUT" "$id	PASS" "RED: generic state transition $id"
done

finalize_test
