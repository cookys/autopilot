#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const {
  evaluateProviderReadiness,
  normalizeProviderTuple,
  providerTupleDigest,
} = require(path.join(root, 'src', 'readiness', 'provider-readiness'));

const NOW = '2026-07-27T12:00:00.000Z';
const tuple = {
  role: 'reviewer',
  runner: 'cc-shim',
  model: 'GLM-5.2',
  effort: 'high',
  endpoint: 'wallet-a',
};
const otherWallet = { ...tuple, endpoint: 'wallet-b' };
const observation = (boundTuple, axis, status, overrides = {}) => ({
  schema_version: 1,
  artifact_type: 'provider_axis_observation',
  tuple: boundTuple,
  axis,
  status,
  observed_at: '2026-07-27T11:55:00.000Z',
  ttl_seconds: 600,
  evidence_class: axis === 'qualification' ? 'scorecard' : 'safe-surface',
  reason: null,
  ...overrides,
});
const ready = (boundTuple = tuple) => ({
  transport: observation(boundTuple, 'transport', 'ready'),
  live: observation(boundTuple, 'live', 'ready', { evidence_class: 'live-probe' }),
  qualification: observation(boundTuple, 'qualification', 'ready'),
});

assert.deepStrictEqual(normalizeProviderTuple(tuple), tuple);
assert.notStrictEqual(providerTupleDigest(tuple), providerTupleDigest(otherWallet));

const fresh = evaluateProviderReadiness({
  tuple,
  observations: ready(),
  now: NOW,
});
assert.strictEqual(fresh.usable_now, true);
assert.strictEqual(fresh.probe_required, false);
assert.deepStrictEqual(fresh.blocking_reasons, []);
assert.strictEqual(fresh.axes.transport.status, 'ready');
assert.strictEqual(fresh.axes.live.status, 'ready');
assert.strictEqual(fresh.axes.qualification.status, 'ready');

const stale = evaluateProviderReadiness({
  tuple,
  observations: {
    ...ready(),
    transport: observation(tuple, 'transport', 'ready', {
      observed_at: '2026-07-27T11:00:00.000Z',
      ttl_seconds: 60,
    }),
  },
  now: NOW,
});
assert.strictEqual(stale.usable_now, false);
assert.strictEqual(stale.probe_required, true);
assert.strictEqual(stale.axes.transport.status, 'unknown');
assert.strictEqual(stale.axes.transport.freshness, 'stale');
assert.strictEqual(stale.axes.transport.observed_status, 'ready');
assert(!stale.blocking_reasons.some((item) => item.axis === 'transport'));

const missing = evaluateProviderReadiness({
  tuple,
  observations: {
    transport: ready().transport,
    qualification: ready().qualification,
  },
  now: NOW,
});
assert.strictEqual(missing.axes.live.status, 'unknown');
assert.strictEqual(missing.axes.live.freshness, 'missing');
assert.strictEqual(missing.probe_required, true);

const matrix = [
  ['transport', 'missing_binary'],
  ['live', 'auth_failed'],
  ['live', 'quota_exhausted'],
  ['qualification', 'unqualified'],
];
for (const [axis, reason] of matrix) {
  const observations = ready();
  observations[axis] = observation(tuple, axis, 'blocked', {
    evidence_class: axis === 'qualification' ? 'scorecard' : 'safe-surface',
    reason,
  });
  const decision = evaluateProviderReadiness({ tuple, observations, now: NOW });
  assert.strictEqual(decision.usable_now, false);
  assert.strictEqual(decision.probe_required, false);
  assert(decision.blocking_reasons.some(
    (item) => item.axis === axis && item.reason === reason,
  ));
  for (const independentAxis of ['transport', 'live', 'qualification']) {
    if (independentAxis !== axis) {
      assert.strictEqual(decision.axes[independentAxis].status, 'ready');
    }
  }
}

const withFallbacks = evaluateProviderReadiness({
  tuple,
  observations: {
    ...ready(),
    live: observation(tuple, 'live', 'blocked', {
      evidence_class: 'live-probe',
      reason: 'quota_exhausted',
    }),
  },
  now: NOW,
  fallbacks: [
    { tuple: otherWallet, observations: ready(otherWallet) },
    {
      tuple: { ...tuple, endpoint: 'wallet-c' },
      observations: {
        ...ready({ ...tuple, endpoint: 'wallet-c' }),
        qualification: observation(
          { ...tuple, endpoint: 'wallet-c' },
          'qualification',
          'blocked',
          { evidence_class: 'scorecard', reason: 'unqualified' },
        ),
      },
    },
  ],
});
assert.deepStrictEqual(withFallbacks.fallbacks, [otherWallet]);
assert.throws(() => evaluateProviderReadiness({
  tuple,
  observations: {
    ...ready(),
    live: observation(otherWallet, 'live', 'ready'),
  },
  now: NOW,
}), /tuple/i);

console.log('exact_endpoint_identity=true');
console.log('three_axis_independence=true');
console.log('stale_requests_probe=true');
console.log('fallbacks_ordered=true');
NODE
)"
assert_exit_code "$?" "0" "provider readiness pure matrix executes"
for key in exact_endpoint_identity three_axis_independence stale_requests_probe \
  fallbacks_ordered; do
  assert_contains "$OUT" "$key=true" "PRO P1 proves $key"
done

STORE="$TEST_TMP/capability"
CLI="$REPO_ROOT/scripts/engine-capability-state.js"
record_event() {
  local endpoint_json="$1" status="$2" role="${3:-reviewer}"
  node - "$endpoint_json" "$status" "$role" <<'NODE' | node "$CLI" record --store "$STORE" >/dev/null
const [endpointJson, status, role] = process.argv.slice(2);
const event = {
  schema_version: 1,
  observed_at: '2026-07-27T11:55:00.000Z',
  runner: 'cc-shim',
  model: 'GLM-5.2',
  role,
  runner_version: 'fixture',
  capability: {
    quota: {
      status,
      reset_at: null,
      confidence: 'high',
      evidence: 'fixture',
      ttl_seconds: 600,
    },
  },
};
if (endpointJson !== 'absent') event.endpoint = JSON.parse(endpointJson);
process.stdout.write(`${JSON.stringify(event)}\n`);
NODE
}

record_event absent exhausted
record_event '"wallet-a"' available
record_event '"wallet-b"' exhausted
record_event null limited

LEGACY="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --now 2026-07-27T12:00:00.000Z --store "$STORE")"
WALLET_A="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint wallet-a --now 2026-07-27T12:00:00.000Z --store "$STORE")"
WALLET_B="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint wallet-b --now 2026-07-27T12:00:00.000Z --store "$STORE")"
NO_ENDPOINT="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint none --now 2026-07-27T12:00:00.000Z --store "$STORE")"

assert_contains "$LEGACY" '"endpoint_binding":"ambiguous-legacy"' \
  "legacy capability rows remain explicitly endpoint-ambiguous"
assert_contains "$LEGACY" '"status":"exhausted"' \
  "legacy query preserves the legacy row without assigning it to a wallet"
assert_contains "$WALLET_A" '"endpoint":"wallet-a"' "wallet A identity is emitted"
assert_contains "$WALLET_A" '"status":"available"' "wallet A state remains independent"
assert_contains "$WALLET_B" '"endpoint":"wallet-b"' "wallet B identity is emitted"
assert_contains "$WALLET_B" '"status":"exhausted"' "wallet B state remains independent"
assert_contains "$NO_ENDPOINT" '"endpoint":null' "explicit endpoint-null identity is emitted"
assert_contains "$NO_ENDPOINT" '"status":"limited"' \
  "explicit endpoint-null state does not consume legacy evidence"

REPORT="$(node "$CLI" report --capability quota --now 2026-07-27T12:00:00.000Z \
  --store "$STORE")"
REPORT_COUNT="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).length))" "$REPORT")"
assert_eq "$REPORT_COUNT" "4" "report retains legacy, null, and both endpoint wallets"

finalize_test
