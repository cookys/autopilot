#!/usr/bin/env bash
# Mission P0 integration oracle.
#
# This oracle runs the frozen P0 incident corpus through
# `evaluateMissionIntegrationFixture` (the P0 integration adapter) and
# asserts the adapter's output matches the real P1 reducer behavior. The
# adapter is a translation layer only: it maps fixture shapes onto the
# generic reducer events. Every output value is derived from the actual
# state machine — no fixture-answer code, no fallback reason literals.
#
# Beyond the frozen corpus, this oracle exercises negative cases that prove
# the generic state machine resists replay, double-release, binding
# mismatch, and verifier forgery.
. "$(dirname "$0")/lib.sh"

FIXTURES="$REPO_ROOT/hooks/tests/fixtures/mission-convergence-incidents.json"
assert_file_exists "$FIXTURES" "Mission incident fixture corpus exists"

OUT="$(node - "$REPO_ROOT" "$FIXTURES" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');

const [root, fixturePath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
let evaluate = null;
try {
  ({ evaluateMissionIntegrationFixture: evaluate } = require(
    path.join(root, 'src', 'engine', 'mission-convergence'),
  ));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

// `subset(left, right)`: every key/value in `right` must be present in `left`.
// This lets the reducer emit auxiliary fields (e.g. `remaining_tool_calls`,
// `stagnant_campaigns`) without breaking the comparison.
function subset(left, right) {
  if (right === null || right === undefined) return true;
  if (Array.isArray(right)) {
    if (!Array.isArray(left)) return false;
    for (const item of right) {
      if (!left.some((l) => subset(l, item))) return false;
    }
    return true;
  }
  if (typeof right !== 'object') return left === right;
  if (left === null || typeof left !== 'object') return false;
  for (const [k, v] of Object.entries(right)) {
    if (!subset(left[k], v)) return false;
  }
  return true;
}

// The P0 integration oracle compares against the frozen corpus expectations
// (`fixture.expected`) rather than an inline `frozen` map. The corpus is the
// single source of truth — no ID-specific manufactured outputs are kept in
// the oracle itself.
for (const fixture of [...corpus.fixtures, ...corpus.healthy_controls]) {
  const expected = fixture.expected;
  if (!expected) {
    console.log(`${fixture.id}\tINVALID_FIXTURE\tno frozen corpus expectation`);
    continue;
  }
  const actual = evaluate
    ? evaluate(fixture)
    : { state: 'UNSUPERVISED', reason: 'mission_convergence_unavailable', effect_count: null };
  console.log([
    fixture.id,
    subset(actual, expected) ? 'PASS' : 'FAIL',
    JSON.stringify(expected),
    JSON.stringify(actual),
  ].join('\t'));
}
NODE
)"
EXIT=$?

assert_exit_code "$EXIT" "0" "Mission fixture runner itself executes"

# Required frozen fixtures must pass.
for fixture in \
  successor-model-branch-reset \
  direct-no-agent-stagnation \
  ignored-user-finish \
  provider-maintenance-leakage \
  closure-ratio \
  invalid-review-authority
do
  assert_contains "$OUT" "$fixture	PASS	" \
    "RED: $fixture must reach its frozen Mission terminal state"
done

for control in \
  identity-preserves-remaining \
  real-progress-resets-stagnation \
  current-control-sequence \
  known-axis-below-ratio
do
  assert_contains "$OUT" "$control	PASS	" \
    "RED: healthy control $control must preserve allowed behavior"
done

assert_not_contains "$OUT" "INVALID_FIXTURE" \
  "Incident reasons and terminal ceilings match the frozen oracle"

# ─── Generic reducer negatives: replay / double-release / binding / forgery ─
NEG_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));

function makeContract(over = {}) {
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: 'mission-v1-' + m.sha256('test'),
    repo_identity: 'r',
    mission_lineage_id: 'lineage-v1-' + m.sha256('L'),
    task_authority_id: m.sha256('TA'),
    policy_hash: m.sha256('P'),
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
    lineage_binding: { task_authority_id: m.sha256('TA'), root_run_id: 'root-1', policy_hash: m.sha256('P'), successor_inherits_durable_consumed: true },
    ...over,
  };
}

function reservation(state, reserved) {
  return {
    per_axis: m.SUPPORTED_AXES.map((axisName) => ({
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
      campaign_contract_digest: m.sha256('P'),
      base_sha: '0000000000000000000000000000000000000000',
      acceptance_ids: ['acc-1'],
      reservation: reservation(state, opts.reserved || 5),
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  };
}

const lines = [];
function check(id, cond) { lines.push(`${id}\t${cond ? 'PASS' : 'FAIL'}`); }

// ── Replay idempotency: re-submitting a claim with the same
// idempotency_key returns the same claim_id and does not double-reserve.
{
  const s0 = m.createMissionState(makeContract());
  const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'replay-1' }));
  const b = m.reduceMissionState(a.state, claimEvent(a.state, { idempotency_key: 'replay-1' }));
  const sameClaim = a.receipt.claim_id === b.receipt.claim_id;
  const sameReservation = a.state.axes.tool_calls.reserved_active === b.state.axes.tool_calls.reserved_active;
  check('replay-same-claim-id', sameClaim);
  check('replay-no-double-reserve', sameReservation);
}

// ── Double-release: a no-effect release applied twice must reject the second.
{
  const s0 = m.createMissionState(makeContract());
  const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'double-rel' }));
  const b = m.reduceMissionState(a.state, {
    event_type: 'no_effect_release',
    sequence: a.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: a.receipt.claim_id },
  });
  const c = m.reduceMissionState(b.state, {
    event_type: 'no_effect_release',
    sequence: b.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: a.receipt.claim_id },
  });
  check('double-release-second-rejected', c.receipt.artifact_type === 'mission_grant_rejected'
    && c.receipt.reason === 'grant_already_claimed');
}

// ── Binding mismatch: claim for a different mission_lineage_id must reject.
{
  const s0 = m.createMissionState(makeContract());
  const ev = claimEvent(s0, { idempotency_key: 'bad-binding' });
  ev.payload.mission_lineage_id = 'lineage-v1-' + m.sha256('OTHER');
  const a = m.reduceMissionState(s0, ev);
  check('binding-mismatch-rejected', a.receipt.artifact_type === 'mission_grant_rejected'
    && a.receipt.reason === 'binding_mismatch');
}

// ── Forgery: a non-serializable verifier must reject the event; a plain
// object verifier must be rejected at adapter construction.
try {
  new ac.AuthenticatedControlAdapter();
  lines.push('forgery-no-verifier\tFAIL');
} catch (e) {
  lines.push(`forgery-no-verifier\t${e.code === 'authenticated_control_verifier_missing' ? 'PASS' : 'FAIL'}`);
}
try {
  new ac.AuthenticatedControlAdapter({ verifier: { verified: true, authority: 'authenticated_user' } });
  lines.push('forgery-plain-object-verifier\tFAIL');
} catch (e) {
  lines.push(`forgery-plain-object-verifier\t${e.code === 'authenticated_control_verifier_non_serializable' ? 'PASS' : 'FAIL'}`);
}
try {
  const adapter = new ac.AuthenticatedControlAdapter({ verifier: () => ({ verified: false, reason: 'ceiling_loosen_unauthorized' }) });
  adapter.acceptEvent({
    mission_lineage_id: 'lineage-v1-' + m.sha256('L'),
    action: 'ceiling_adjust',
    authority: 'authenticated_user',
    sequence: 1,
    issued_at: '2026-07-27T00:00:00.000Z',
    reason: 'forgery',
    ceiling_before: { axis: 'tool_calls', authorized_ceiling: 10, known: true },
    ceiling_after: { axis: 'tool_calls', authorized_ceiling: 11, known: true },
  });
  lines.push('forgery-verifier-rejects\tFAIL');
} catch (e) {
  lines.push(`forgery-verifier-rejects\t${e.code === 'ceiling_loosen_unauthorized' ? 'PASS' : 'FAIL'}`);
}

// ── Terminal reconcile once: second reconcile is replay_noop.
{
  const s0 = m.createMissionState(makeContract());
  const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'recon-1', reserved: 4 }));
  const claimId = a.receipt.claim_id;
  const actualUsage = { per_axis: m.SUPPORTED_AXES.map((axisName) => ({
    axis: axisName,
    authorized_ceiling: a.state.axes[axisName].authorized_ceiling,
    reserved_active: axisName === 'tool_calls' ? 4 : 0,
    durable_consumed: a.state.axes[axisName].durable_consumed,
    known: true,
  })) };
  const r1 = m.reduceMissionState(a.state, {
    event_type: 'reconciliation', sequence: a.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: claimId, actual_usage: actualUsage },
  });
  const r2 = m.reduceMissionState(r1.state, {
    event_type: 'reconciliation', sequence: r1.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: claimId, actual_usage: actualUsage },
  });
  check('terminal-reconcile-replay-noop', r2.receipt.replay === 'replay_noop');
}

// ── Successor inheritance: new state inherits durable_consumed.
{
  const s0 = m.createMissionState(makeContract());
  const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'succ-1', reserved: 5 }));
  const actualUsage = { per_axis: m.SUPPORTED_AXES.map((axisName) => ({
    axis: axisName,
    authorized_ceiling: a.state.axes[axisName].authorized_ceiling,
    reserved_active: axisName === 'tool_calls' ? 5 : 0,
    durable_consumed: a.state.axes[axisName].durable_consumed,
    known: true,
  })) };
  const r = m.reduceMissionState(a.state, {
    event_type: 'reconciliation', sequence: a.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: a.receipt.claim_id, actual_usage: actualUsage },
  });
  // Successor MUST agree on task_authority_id and policy_hash with the
  // predecessor (conflicting lineage/policy binding fails closed).
  const succ = m.createMissionState(makeContract({
    mission_lineage_id: 'lineage-v1-' + m.sha256('SUCC'),
    lineage_binding: {
      task_authority_id: s0.task_authority_id,
      root_run_id: 'root-succ',
      policy_hash: s0.policy_hash,
      successor_inherits_durable_consumed: true,
    },
  }), { inheritFrom: r.state });
  check('successor-inherits-tool-calls', succ.axes.tool_calls.durable_consumed === 5);
}

for (const line of lines) console.log(line);
NODE
)"

for id in \
  replay-same-claim-id replay-no-double-reserve double-release-second-rejected \
  binding-mismatch-rejected forgery-no-verifier forgery-plain-object-verifier \
  forgery-verifier-rejects terminal-reconcile-replay-noop successor-inherits-tool-calls
do
  assert_contains "$NEG_OUT" "$id	PASS" "RED: generic negative $id must hold"
done

finalize_test
