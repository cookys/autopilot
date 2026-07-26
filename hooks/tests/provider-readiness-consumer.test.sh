#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

CLI_OUT="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" \
  AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" \
  ENGINE_SCORECARD_DIR="$TEST_TMP/scorecard" \
  REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/review-loop-config.md" \
  node "$REPO_ROOT/bin/autopilot.js" status readiness --json 2>"$TEST_TMP/cli.err")"
CLI_EXIT=$?
assert_exit_code "$CLI_EXIT" "0" "status readiness is an admitted CLI subcommand"
assert_contains "$CLI_OUT" '"artifact_type": "provider_readiness_receipt"' \
  "status readiness emits a provider readiness receipt"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const {
  canonicalDigest,
  consumeProviderReadinessReceipt,
  createProviderReadinessReceipt,
  validateProviderReadinessReceipt,
} = require(path.join(root, 'src', 'readiness', 'receipt'));

const NOW = '2026-07-27T12:00:00.000Z';
const policy = {
  receipt_ttl_seconds: 300,
  fallback_family_constraint: 'different',
};
const tuple = (role, runner, model, effort, endpoint = null) => ({
  role,
  runner,
  model,
  effort,
  endpoint,
});
const observation = (boundTuple, axis, status, overrides = {}) => ({
  schema_version: 1,
  artifact_type: 'provider_axis_observation',
  tuple: boundTuple,
  axis,
  status,
  observed_at: '2026-07-27T11:59:00.000Z',
  ttl_seconds: 600,
  evidence_class: axis === 'qualification' ? 'scorecard' : 'live-probe',
  reason: status === 'blocked' ? `${axis}_blocked` : null,
  ...overrides,
});
const ready = (boundTuple) => ({
  transport: observation(boundTuple, 'transport', 'ready', {
    evidence_class: 'safe-surface',
  }),
  live: observation(boundTuple, 'live', 'ready'),
  qualification: observation(boundTuple, 'qualification', 'ready'),
});
const seat = (
  seatId,
  family,
  boundTuple,
  observations,
  fallbacks = [],
  required = true,
) => ({
  seat_id: seatId,
  required,
  family,
  tuple: boundTuple,
  observations,
  fallbacks,
});
const fallback = (family, boundTuple, observations) => ({
  family,
  tuple: boundTuple,
  observations,
});

const grok = tuple('implementer', 'grok', 'grok-4.5', 'high');
const minimax = tuple('reviewer', 'cc-shim', 'MiniMax-M3', 'high', 'minimax');
const kimi = tuple('verification_author', 'kimi', 'kimi-code/k3', 'high');
const fable = tuple('qc', 'claude-native', 'claude-fable-5', 'high');

const fixtureRoster = [
  seat('implementer', 'xai', grok, {
    ...ready(grok),
    transport: observation(grok, 'transport', 'ready', {
      observed_at: '2026-07-27T11:00:00.000Z',
      ttl_seconds: 60,
      evidence_class: 'safe-surface',
    }),
  }),
  seat('reviewer', 'minimax', minimax, ready(minimax)),
  seat('verification_author', 'moonshot', kimi, {
    transport: ready(kimi).transport,
    live: ready(kimi).live,
  }),
  seat('qc:fable', 'anthropic', fable, {
    ...ready(fable),
    live: observation(fable, 'live', 'blocked', {
      reason: 'quota_exhausted',
    }),
  }),
];

const fixtureReceipt = createProviderReadinessReceipt({
  roster: fixtureRoster,
  policy,
  now: NOW,
});
assert.strictEqual(fixtureReceipt.overall_status, 'blocked');
assert.deepStrictEqual(
  fixtureReceipt.seats.map((row) => [row.seat_id, row.status]),
  [
    ['implementer', 'probe-needed'],
    ['reviewer', 'usable'],
    ['verification_author', 'probe-needed'],
    ['qc:fable', 'blocked'],
  ],
);
assert.deepStrictEqual(
  fixtureReceipt.seats[0].failing_axes,
  [{ axis: 'transport', status: 'unknown', reason: 'stale_transport_observation' }],
);
assert.deepStrictEqual(
  fixtureReceipt.seats[2].failing_axes,
  [{
    axis: 'qualification',
    status: 'unknown',
    reason: 'missing_qualification_observation',
  }],
);
assert.throws(
  () => consumeProviderReadinessReceipt(fixtureReceipt, {
    roster: fixtureRoster,
    policy,
    now: '2026-07-27T12:01:00.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_blocked',
);

const unknownRoster = fixtureRoster.slice(0, 3);
const unknownReceipt = createProviderReadinessReceipt({
  roster: unknownRoster,
  policy,
  now: NOW,
});
const unknownResult = consumeProviderReadinessReceipt(unknownReceipt, {
  roster: unknownRoster,
  policy,
  now: '2026-07-27T12:01:00.000Z',
});
assert.strictEqual(unknownReceipt.overall_status, 'probe-needed');
assert.strictEqual(unknownResult.status, 'unknown');
assert.deepStrictEqual(unknownResult.selections, []);

const primary = tuple('reviewer', 'grok', 'grok-4.5', 'high');
const sameFamily = tuple('reviewer', 'grok', 'grok-4.5-fast', 'high');
const unqualified = tuple('reviewer', 'kimi', 'kimi-code/k3', 'high');
const eligible = tuple('reviewer', 'cc-shim', 'MiniMax-M3', 'high', 'minimax');
const laterEligible = tuple('reviewer', 'qoderclicn', 'Qwen3.8-Max-Preview', 'max');
const blockedPrimary = {
  ...ready(primary),
  live: observation(primary, 'live', 'blocked', { reason: 'quota_exhausted' }),
};
const unqualifiedObservations = {
  ...ready(unqualified),
  qualification: observation(unqualified, 'qualification', 'blocked', {
    reason: 'unqualified',
  }),
};
const fallbackRoster = [
  seat('reviewer', 'xai', primary, blockedPrimary, [
    fallback('xai', sameFamily, ready(sameFamily)),
    fallback('moonshot', unqualified, unqualifiedObservations),
    fallback('minimax', eligible, ready(eligible)),
    fallback('alibaba', laterEligible, ready(laterEligible)),
  ]),
];
const fallbackReceipt = createProviderReadinessReceipt({
  roster: fallbackRoster,
  policy,
  now: NOW,
});
const fallbackSeat = fallbackReceipt.seats[0];
assert.strictEqual(fallbackSeat.status, 'usable');
assert.deepStrictEqual(fallbackSeat.selected.tuple, eligible);
assert.deepStrictEqual(
  fallbackSeat.fallbacks.map((row) => [
    row.order,
    row.eligible,
    row.exclusion_reason,
  ]),
  [
    [1, false, 'family_constraint'],
    [2, false, 'not_usable'],
    [3, true, null],
    [4, true, null],
  ],
);
const fallbackResult = consumeProviderReadinessReceipt(fallbackReceipt, {
  roster: fallbackRoster,
  policy,
  now: '2026-07-27T12:01:00.000Z',
});
assert.strictEqual(fallbackResult.status, 'ready');
assert.deepStrictEqual(fallbackResult.selections[0].tuple, eligible);

const unknownPrimaryRoster = [
  seat('reviewer', 'xai', primary, {
    transport: ready(primary).transport,
    qualification: ready(primary).qualification,
  }, [
    fallback('minimax', eligible, ready(eligible)),
  ]),
];
const unknownPrimaryReceipt = createProviderReadinessReceipt({
  roster: unknownPrimaryRoster,
  policy,
  now: NOW,
});
assert.strictEqual(unknownPrimaryReceipt.seats[0].status, 'probe-needed');
assert.strictEqual(unknownPrimaryReceipt.seats[0].selected, null);

validateProviderReadinessReceipt(fallbackReceipt, {
  roster: fallbackRoster,
  policy,
  now: '2026-07-27T12:04:59.999Z',
});
assert.throws(
  () => validateProviderReadinessReceipt(fallbackReceipt, {
    roster: fallbackRoster,
    policy,
    now: '2026-07-27T12:05:00.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_receipt_expired',
);
assert.throws(
  () => validateProviderReadinessReceipt(fallbackReceipt, {
    roster: [{
      ...fallbackRoster[0],
      tuple: { ...fallbackRoster[0].tuple, model: 'grok-4.5-drift' },
    }],
    policy,
    now: '2026-07-27T12:01:00.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_roster_drift',
);
assert.throws(
  () => validateProviderReadinessReceipt(fallbackReceipt, {
    roster: fallbackRoster,
    policy: { ...policy, receipt_ttl_seconds: 301 },
    now: '2026-07-27T12:01:00.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_policy_drift',
);

const incomplete = {
  ...fallbackReceipt,
  seats: [],
};
incomplete.observation_digest = canonicalDigest([]);
incomplete.receipt_digest = canonicalDigest({
  ...incomplete,
  receipt_digest: undefined,
});
assert.throws(
  () => validateProviderReadinessReceipt(incomplete, {
    roster: fallbackRoster,
    policy,
    now: '2026-07-27T12:01:00.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_receipt_incomplete',
);

fs.writeFileSync(
  path.join(tmp, 'provider-readiness-receipt.json'),
  `${JSON.stringify(fallbackReceipt, null, 2)}\n`,
);
console.log('four_distinct_decisions=true');
console.log('blocked_consumer_rejection=true');
console.log('unknown_preserved=true');
console.log('fallback_order_and_family=true');
console.log('unqualified_not_promoted=true');
console.log('receipt_drift_guards=true');
NODE
)"
assert_exit_code "$?" "0" "provider readiness receipt consumer matrix executes"
for key in four_distinct_decisions blocked_consumer_rejection unknown_preserved \
  fallback_order_and_family unqualified_not_promoted receipt_drift_guards; do
  assert_contains "$OUT" "$key=true" "PRO P4 proves $key"
done

node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/provider-readiness-receipt.schema.json" \
  --document "$TEST_TMP/provider-readiness-receipt.json" >/dev/null
assert_exit_code "$?" "0" "provider readiness receipt matches the closed schema"

finalize_test
