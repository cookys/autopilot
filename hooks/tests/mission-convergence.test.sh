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
    // The capability is present for the reducer (non-enumerable) but absent
    // from every serializable view.
    console.log(`capability-present-for-reducer\t${
      ac.isAuthenticatedAdapterCapability(canonical._adapter_capability) ? 'PASS' : 'FAIL'}`);
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
    // constructor verifier still approves despite a rejecting extra option.
    const approving = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    let approveStillWorks = false;
    try {
      const ev = approving.acceptEvent({ mission_lineage_id: L, action: 'finish_requested',
        authority: 'authenticated_user', sequence: 1,
        issued_at: '2026-07-27T00:00:00.000Z', reason: 'x' },
        { verifier: () => ({ verified: false, reason: 'authenticated_control_verifier_rejected' }) });
      approveStillWorks = ac.isAuthenticatedAdapterCapability(ev._adapter_capability);
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
  config-no-section-off
do
  assert_contains "$OUT" "$id	PASS" "RED: generic state transition $id"
done

finalize_test
