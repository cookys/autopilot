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
  endpoint: 'wallet_a',
};
const otherWallet = { ...tuple, endpoint: 'wallet_b' };
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
assert.throws(() => normalizeProviderTuple({
  ...tuple,
  endpoint: 'https://credential-bearing.example',
}), /endpoint/i);
assert.throws(() => normalizeProviderTuple({ ...tuple, role: ' reviewer' }), /role/i);

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

const noObservations = evaluateProviderReadiness({ tuple, now: NOW });
assert.strictEqual(noObservations.usable_now, false);
assert.strictEqual(noObservations.probe_required, true);
assert.deepStrictEqual(
  Object.values(noObservations.axes).map((axis) => axis.status),
  ['unknown', 'unknown', 'unknown'],
);

assert.throws(() => evaluateProviderReadiness({
  tuple,
  observations: {
    ...ready(),
    live: observation(tuple, 'live', 'ready', {
      observed_at: '2026-07-27T12:00:01.000Z',
    }),
  },
  now: NOW,
}), /time window/i);

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
      tuple: { ...tuple, endpoint: 'wallet_c' },
      observations: {
        ...ready({ ...tuple, endpoint: 'wallet_c' }),
        qualification: observation(
          { ...tuple, endpoint: 'wallet_c' },
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
record_event '"wallet_a"' available
record_event '"wallet_b"' exhausted
record_event null limited
record_event '"none"' available

node - "$STORE/capability.jsonl" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
const walletA = rows.find((row) => row.endpoint === 'wallet_a');
const otherWalletDuplicate = {
  ...walletA,
  endpoint: 'wallet_b',
  observed_at: '2026-07-27T11:00:00.000Z',
};
const malformed = {
  ...walletA,
  event_id: 99,
  endpoint: 'bad-name',
};
fs.writeFileSync(
  file,
  `${[otherWalletDuplicate, ...rows, malformed].map(JSON.stringify).join('\n')}\n`,
);
NODE

LEGACY="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --now 2026-07-27T12:00:00.000Z --store "$STORE")"
WALLET_A="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint wallet_a --now 2026-07-27T12:00:00.000Z --store "$STORE")"
WALLET_B="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint wallet_b --now 2026-07-27T12:00:00.000Z --store "$STORE")"
NAMED_NONE="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint none --now 2026-07-27T12:00:00.000Z --store "$STORE")"
NO_ENDPOINT="$(node "$CLI" current --runner cc-shim --model GLM-5.2 --role reviewer \
  --endpoint @none --now 2026-07-27T12:00:00.000Z --store "$STORE")"

assert_contains "$LEGACY" '"endpoint_binding":"ambiguous-legacy"' \
  "legacy capability rows remain explicitly endpoint-ambiguous"
assert_contains "$LEGACY" '"status":"exhausted"' \
  "legacy query preserves the legacy row without assigning it to a wallet"
assert_contains "$WALLET_A" '"endpoint":"wallet_a"' "wallet A identity is emitted"
assert_contains "$WALLET_A" '"status":"available"' "wallet A state remains independent"
assert_contains "$WALLET_A" '"observed_at":"2026-07-27T11:55:00.000Z"' \
  "wallet A time provenance cannot come from a duplicate ID in another wallet"
WALLET_A_QUOTA_OBSERVED="$(node -e '
const row = JSON.parse(process.argv[1]);
process.stdout.write(String(row.capability.quota.observed_at || "missing"));
' "$WALLET_A")"
assert_eq "$WALLET_A_QUOTA_OBSERVED" "2026-07-27T11:55:00.000Z" \
  "live-probe dedupe can read quota-specific observation time"
assert_contains "$WALLET_B" '"endpoint":"wallet_b"' "wallet B identity is emitted"
assert_contains "$WALLET_B" '"status":"exhausted"' "wallet B state remains independent"
assert_contains "$NAMED_NONE" '"endpoint":"none"' \
  "a valid endpoint named none does not collide with the null selector"
assert_contains "$NAMED_NONE" '"status":"available"' \
  "the endpoint named none retains its own state"
assert_contains "$NO_ENDPOINT" '"endpoint":null' "explicit endpoint-null identity is emitted"
assert_contains "$NO_ENDPOINT" '"status":"limited"' \
  "explicit endpoint-null state does not consume legacy evidence"

node - <<'NODE' | node "$CLI" record --store "$STORE" >/dev/null
process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  observed_at: '2026-07-27T11:55:00.000Z',
  runner: 'cc-shim',
  model: 'Empty-Context',
  role: 'reviewer',
  endpoint: 'wallet_a',
  runner_version: 'fixture',
  capability: {
    quota: {
      status: 'unknown',
      reset_at: null,
      confidence: 'medium',
      evidence: 'fixture',
      ttl_seconds: 0,
    },
    context_window: {
      total_tokens: null,
      evidence: null,
    },
  },
})}\n`);
NODE
EMPTY_CONTEXT="$(node "$CLI" current --runner cc-shim --model Empty-Context --role reviewer \
  --endpoint wallet_a --now 2026-07-27T12:00:00.000Z --store "$STORE")"
assert_contains "$EMPTY_CONTEXT" '"event_id":1' \
  "a null-only context candidate preserves the legacy fallback event ID"

REPORT="$(node "$CLI" report --capability quota --now 2026-07-27T12:00:00.000Z \
  --store "$STORE")"
REPORT_COUNT="$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).length))" "$REPORT")"
assert_eq "$REPORT_COUNT" "5" \
  "report retains every valid endpoint identity and ignores a malformed stored row"

PROBE_OUT="$(node - "$REPO_ROOT" "$TEST_TMP/probe-capability" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const store = process.argv[3];
const {
  LIVE_PROBE_REQUEST,
  classifyLiveProbeResult,
  runProviderProbe,
} = require(path.join(root, 'src', 'readiness', 'probe'));
const {
  createRunnerTransportEnvelope,
} = require(path.join(root, 'src', 'transport', 'runner-envelope'));

const tuple = {
  role: 'reviewer',
  runner: 'cc-shim',
  model: 'GLM-5.2',
  effort: 'high',
  endpoint: 'wallet_a',
};
const NOW = '2026-07-27T12:00:00.000Z';
const later = (minutes) => `2026-07-27T12:${String(minutes).padStart(2, '0')}:00.000Z`;
const transport = (boundTuple, kind = 'success') => {
  const child = {
    status: kind === 'success' ? 0 : 1,
    signal: null,
    error: null,
    stdout: kind === 'success' ? 'OK\n' : '',
    stderr: '',
  };
  const outcomeHints = {};
  if (kind === 'timeout') {
    child.status = null;
    child.error = { code: 'ETIMEDOUT' };
    outcomeHints.timedOut = true;
  } else if (kind === 'auth_failed') {
    child.error = { code: 'auth_failed' };
  } else if (kind === 'quota_exhausted') {
    outcomeHints.quota = true;
  }
  return createRunnerTransportEnvelope({
    runner: boundTuple.runner,
    model: boundTuple.model,
    operation: LIVE_PROBE_REQUEST.operation,
    argv: ['fixture-live-probe', '--model', boundTuple.model],
    cwd: '/private/provider-probe',
    child,
    outcomeHints,
  });
};

let safeCalls = 0;
let liveCalls = 0;
const safeProbe = ({ tuple: selected }) => {
  safeCalls += 1;
  assert.deepStrictEqual(selected, tuple);
  return {
    status: 'ready',
    evidence_class: 'safe-surface',
    reason: null,
  };
};
const liveProbe = ({ tuple: selected, request }) => {
  liveCalls += 1;
  assert.strictEqual(selected.runner, tuple.runner);
  assert.deepStrictEqual(request, LIVE_PROBE_REQUEST);
  assert.strictEqual(Object.isFrozen(request), true);
  return {
    transport_envelope: transport(selected),
    response_text: 'OK\n',
  };
};

const first = runProviderProbe({
  tuple,
  now: NOW,
  ttl_seconds: 600,
  store,
}, { safeProbe, liveProbe });
assert.strictEqual(first.transport_observation.status, 'ready');
assert.strictEqual(first.live_observation.status, 'ready');
assert.strictEqual(first.live_probe.attempted, true);
assert.strictEqual(first.live_probe.reused, false);
assert.strictEqual(first.live_probe.outcome, 'success');
assert.strictEqual(first.persistence.recorded, true);
assert.strictEqual(liveCalls, 1);

const insideTtl = runProviderProbe({
  tuple,
  now: later(9),
  ttl_seconds: 600,
  store,
}, { safeProbe, liveProbe });
assert.strictEqual(insideTtl.live_probe.attempted, false);
assert.strictEqual(insideTtl.live_probe.reused, true);
assert.strictEqual(insideTtl.live_observation.status, 'ready');
assert.strictEqual(liveCalls, 1);

const otherWallet = { ...tuple, endpoint: 'wallet_b' };
runProviderProbe({
  tuple: otherWallet,
  now: later(9),
  ttl_seconds: 600,
  store,
}, {
  safeProbe: () => ({
    status: 'ready',
    evidence_class: 'safe-surface',
    reason: null,
  }),
  liveProbe,
});
assert.strictEqual(liveCalls, 2);

const afterTtl = runProviderProbe({
  tuple,
  now: later(11),
  ttl_seconds: 600,
  store,
}, { safeProbe, liveProbe });
assert.strictEqual(afterTtl.live_probe.attempted, true);
assert.strictEqual(afterTtl.live_probe.reused, false);
assert.strictEqual(liveCalls, 3);
assert.strictEqual(safeCalls, 3);

const blocked = runProviderProbe({
  tuple: { ...tuple, endpoint: 'wallet_blocked' },
  now: NOW,
  ttl_seconds: 600,
  store,
}, {
  safeProbe: () => ({
    status: 'blocked',
    evidence_class: 'safe-surface',
    reason: 'missing_binary',
  }),
  liveProbe: () => {
    throw new Error('live probe must not run after a blocked safe surface');
  },
});
assert.strictEqual(blocked.transport_observation.status, 'blocked');
assert.strictEqual(blocked.live_probe.attempted, false);
assert.strictEqual(blocked.live_observation, null);

assert.strictEqual(
  classifyLiveProbeResult(tuple, {
    transport_envelope: transport(tuple, 'timeout'),
    response_text: '',
  }),
  'timeout',
);
assert.strictEqual(
  classifyLiveProbeResult(tuple, {
    transport_envelope: transport(tuple, 'auth_failed'),
    response_text: '',
  }),
  'auth_failed',
);
assert.strictEqual(
  classifyLiveProbeResult(tuple, {
    transport_envelope: transport(tuple, 'quota_exhausted'),
    response_text: '',
  }),
  'quota_exhausted',
);
assert.strictEqual(
  classifyLiveProbeResult(tuple, {
    transport_envelope: transport(tuple, 'exit_failure'),
    response_text: '',
  }),
  'transport_failure',
);
assert.strictEqual(
  classifyLiveProbeResult(tuple, {
    transport_envelope: transport(tuple),
    response_text: 'unexpected',
  }),
  'malformed_response',
);
const forged = transport(tuple);
forged.receipt_digest = '0'.repeat(64);
assert.throws(() => classifyLiveProbeResult(tuple, {
  transport_envelope: forged,
  response_text: 'OK',
}), /digest/i);

const secret = 'sk-PROBE_SENTINEL_0123456789';
const secretResult = runProviderProbe({
  tuple: { ...tuple, endpoint: 'wallet_secret' },
  now: NOW,
  ttl_seconds: 600,
  store,
}, {
  safeProbe: () => ({
    status: 'ready',
    evidence_class: 'safe-surface',
    reason: null,
  }),
  liveProbe: ({ tuple: selected }) => ({
    transport_envelope: transport(selected),
    response_text: `not-ok ${secret}`,
  }),
});
assert.strictEqual(secretResult.live_probe.outcome, 'malformed_response');
assert(!JSON.stringify(secretResult).includes(secret));
const stored = fs.readFileSync(path.join(store, 'capability.jsonl'), 'utf8');
assert(!stored.includes(secret));
assert(stored.includes('provider_live_probe.minimal_no_effect.malformed_response'));
assert.throws(() => runProviderProbe({
  tuple,
  now: NOW,
  ttl_seconds: 600,
  store,
  prompt: secret,
}, { safeProbe, liveProbe }), /shape/i);

console.log('safe_first=true');
console.log('ttl_deduped=true');
console.log('wallets_distinct=true');
console.log('outcomes_distinct=true');
console.log('probe_secret_absent=true');
NODE
)"
assert_exit_code "$?" "0" "PRO P2 bounded probe coordinator executes"
for key in safe_first ttl_deduped wallets_distinct outcomes_distinct \
  probe_secret_absent; do
  assert_contains "$PROBE_OUT" "$key=true" "PRO P2 proves $key"
done

finalize_test
