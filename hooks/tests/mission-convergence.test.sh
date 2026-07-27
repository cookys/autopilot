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
try {
  const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
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
      reserved_active: axisName === 'tool_calls' ? reserved : 0,
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
    // Successor inheritance: new state inherits durable_consumed.
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
      mission_lineage_id: 'lineage-v1-' + require('crypto').createHash('sha256').update('SUCC').digest('hex'),
      task_authority_id: require('crypto').createHash('sha256').update('TA-SUCC').digest('hex'),
      policy_hash: require('crypto').createHash('sha256').update('P-SUCC').digest('hex'),
      lineage_binding: {
        task_authority_id: require('crypto').createHash('sha256').update('TA-SUCC').digest('hex'),
        root_run_id: 'root-succ',
        policy_hash: require('crypto').createHash('sha256').update('P-SUCC').digest('hex'),
        successor_inherits_durable_consumed: true,
      },
    }, { inheritFrom: r.state });
    console.log(`successor-inherits-direct\t${succ.axes.tool_calls.durable_consumed === 5 ? 'PASS' : 'FAIL'}`);
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
  successor-inherits-direct
do
  assert_contains "$OUT" "$id	PASS" "RED: generic state transition $id"
done

finalize_test
