#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

cat > "$TEST_TMP/review-loop-config.md" <<'CFG'
- reviewer_engine: MiniMax-M3
- reviewer_effort: high
- reviewer_runner: cc-shim
- reviewer_endpoint: minimax
- reviewer_limitation: minimax-false-central-claim-5-of-6
- implementer_engine: grok-4.5
- implementer_effort: high
- implementer_runner: grok
- qc_panel: gpt-5.5
- qc_panel_runners: codex
- qc_panel_efforts: xhigh
- qc_panel_endpoints: @none
- provider_readiness_receipt_ttl_seconds: 300
- provider_readiness_fallback_family_constraint: different
CFG

CLI_OUT="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" \
  AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" \
  ENGINE_SCORECARD_DIR="$TEST_TMP/scorecard" \
  REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/review-loop-config.md" \
  node "$REPO_ROOT/bin/autopilot.js" status readiness --json 2>"$TEST_TMP/cli.err")"
CLI_EXIT=$?
assert_exit_code "$CLI_EXIT" "0" "status readiness is an admitted CLI subcommand"
assert_contains "$CLI_OUT" '"artifact_type": "provider_readiness_receipt"' \
  "status readiness emits a provider readiness receipt"
assert_file_absent "$TEST_TMP/capability/capability.jsonl" \
  "observation-only readiness does not write capability state"

mkdir -p "$TEST_TMP/capability"
CAP_NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$CAP_NOW" <<'NODE' | ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" \
  node "$REPO_ROOT/scripts/engine-capability-state.js" record >/dev/null
const observedAt = process.argv[2];
process.stdout.write(`${JSON.stringify({
  schema_version: 1,
  observed_at: observedAt,
  runner: 'cc-shim',
  model: 'MiniMax-M3',
  role: 'reviewer',
  effort: 'high',
  endpoint: 'minimax',
  runner_version: 'fixture',
  capability: {
    quota: {
      status: 'available',
      reset_at: null,
      confidence: 'high',
      evidence: 'fixture',
      ttl_seconds: 600,
    },
  },
})}\n`);
NODE
CAP_LINES_BEFORE="$(wc -l < "$TEST_TMP/capability/capability.jsonl" | tr -d ' ')"
CLI_WITH_STATE="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" \
  AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" \
  ENGINE_SCORECARD_DIR="$TEST_TMP/scorecard" \
  REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/review-loop-config.md" \
  node "$REPO_ROOT/bin/autopilot.js" status readiness --json 2>"$TEST_TMP/cli-state.err")"
assert_exit_code "$?" "0" "readiness accepts second-precision capability timestamps"
REVIEWER_LIVE="$(node -e '
const receipt = JSON.parse(process.argv[1]);
const seat = receipt.seats.find((row) => row.seat_id === "reviewer");
process.stdout.write(seat.decision.axes.live.status);
' "$CLI_WITH_STATE")"
assert_eq "ready" "$REVIEWER_LIVE" \
  "observation-only readiness projects the exact fresh capability event"
CAP_LINES_AFTER="$(wc -l < "$TEST_TMP/capability/capability.jsonl" | tr -d ' ')"
assert_eq "$CAP_LINES_BEFORE" "$CAP_LINES_AFTER" \
  "observation-only readiness leaves the capability ledger byte-count stable"

CLI_HUMAN="$(ENGINE_CAPABILITY_DIR="$TEST_TMP/capability" \
  AUTOPILOT_DISPATCH_RUNS_DIR="$TEST_TMP/runs" \
  ENGINE_SCORECARD_DIR="$TEST_TMP/scorecard" \
  REVIEW_LOOP_CONFIG_OVERRIDE="$TEST_TMP/review-loop-config.md" \
  node "$REPO_ROOT/bin/autopilot.js" status readiness 2>"$TEST_TMP/cli-human.err")"
assert_exit_code "$?" "0" "human status readiness exits zero"
assert_contains "$CLI_HUMAN" "READINESS (probe-needed)" \
  "human readiness reports its aggregate decision"
assert_contains "$CLI_HUMAN" "transport=unknown:missing_transport_observation" \
  "human readiness names the exact failing axis"

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
const {
  buildSelectedRoster,
} = require(path.join(root, 'src', 'readiness', 'status'));

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
    [3, true, null],
    [4, true, null],
  ],
);
assert.deepStrictEqual(
  fallbackSeat.fallbacks.map((row) => row.decision.tuple.model),
  ['MiniMax-M3', 'Qwen3.8-Max-Preview'],
);
const fallbackResult = consumeProviderReadinessReceipt(fallbackReceipt, {
  roster: fallbackRoster,
  policy,
  now: '2026-07-27T12:01:00.000Z',
});
assert.strictEqual(fallbackResult.status, 'ready');
assert.deepStrictEqual(fallbackResult.selections[0].tuple, eligible);

const shortEvidenceRoster = [
  seat('reviewer', 'minimax', minimax, {
    ...ready(minimax),
    live: observation(minimax, 'live', 'ready', {
      observed_at: '2026-07-27T11:59:00.000Z',
      ttl_seconds: 61,
    }),
  }),
];
const shortEvidenceReceipt = createProviderReadinessReceipt({
  roster: shortEvidenceRoster,
  policy,
  now: NOW,
});
assert.strictEqual(shortEvidenceReceipt.expires_at, '2026-07-27T12:00:01.000Z');
assert.throws(
  () => validateProviderReadinessReceipt(shortEvidenceReceipt, {
    roster: shortEvidenceRoster,
    policy,
    now: '2026-07-27T12:00:01.000Z',
  }),
  (error) => error && error.code === 'provider_readiness_receipt_expired',
);

const configuredRoster = buildSelectedRoster({
  implementer_engine: 'grok-4.5',
  implementer_effort: 'high',
  implementer_runner: 'grok',
  implementer_endpoint: '',
  implementer_family: 'xai',
  reviewer_engine: 'gpt-5.5',
  reviewer_effort: 'xhigh',
  reviewer_runner: 'codex',
  reviewer_endpoint: '',
  reviewer_qualified: false,
  reviewer_fallback_preference: ['MiniMax-M3'],
  fallback_ladder: [
    {
      engine: 'Qwen3.8-Max-Preview',
      runner: 'qoderclicn',
      family: 'alibaba',
      effort: 'max',
      model: null,
    },
    {
      engine: 'MiniMax-M3',
      runner: 'cc-shim',
      family: 'minimax',
      effort: 'high',
      model: null,
      endpoint: 'minimax',
    },
  ],
  verification_author_present: false,
  qc_panel: [],
  qc_panel_seats: [],
  qc_panel_seats_complete: true,
}, NOW, 300);
const configuredReviewer = configuredRoster.find((row) => row.seat_id === 'reviewer');
assert.deepStrictEqual(
  configuredReviewer.fallbacks.map((row) => row.tuple.model),
  ['MiniMax-M3', 'Qwen3.8-Max-Preview'],
);
assert.strictEqual(configuredReviewer.fallbacks[0].tuple.endpoint, 'minimax');
assert.strictEqual(
  configuredReviewer.fallbacks[0].observations.qualification.status,
  'ready',
);

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
    roster: fallbackRoster,
    policy,
    now: '2026-07-27T11:59:59.999Z',
  }),
  (error) => error && error.code === 'provider_readiness_receipt_not_yet_valid',
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
console.log('configured_fallback_projection=true');
console.log('unqualified_not_promoted=true');
console.log('receipt_drift_guards=true');
NODE
)"
assert_exit_code "$?" "0" "provider readiness receipt consumer matrix executes"
for key in four_distinct_decisions blocked_consumer_rejection unknown_preserved \
  fallback_order_and_family configured_fallback_projection \
  unqualified_not_promoted receipt_drift_guards; do
  assert_contains "$OUT" "$key=true" "PRO P4 proves $key"
done

node "$REPO_ROOT/scripts/validate-json-schema.js" \
  --schema "$REPO_ROOT/schemas/provider-readiness-receipt.schema.json" \
  --document "$TEST_TMP/provider-readiness-receipt.json" >/dev/null
assert_exit_code "$?" "0" "provider readiness receipt matches the closed schema"

FAKE_AUTHOR="$TEST_TMP/fake-dispatch-author.sh"
cat > "$FAKE_AUTHOR" <<'SH'
#!/usr/bin/env bash
set -u
printf '%s\n' "$@" > "$FAKE_ARGS_CAPTURE"
prompt_file=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) prompt_file="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cp "$prompt_file" "$FAKE_PROMPT_CAPTURE"
case "${FAKE_MODE:-success}" in
  success)
    printf 'OK\n' > "$FAKE_RAW_LOG"
    printf '{"status":"authored","raw_log":"%s","error":null}\n' "$FAKE_RAW_LOG"
    exit 0
    ;;
  auth)
    printf '{"status":"precondition_failed","raw_log":null,"error":"401 unauthorized"}\n'
    exit 2
    ;;
  quota)
    printf '{"status":"runner_failed","raw_log":null,"error":"quota exhausted"}\n'
    exit 3
    ;;
  generic)
    printf '{"status":"runner_failed","raw_log":null,"error":"process exited 9"}\n'
    exit 3
    ;;
esac
SH
chmod +x "$FAKE_AUTHOR"

ADAPTER_OUT="$(FAKE_ARGS_CAPTURE="$TEST_TMP/fake-args" \
  FAKE_PROMPT_CAPTURE="$TEST_TMP/fake-prompt" \
  FAKE_RAW_LOG="$TEST_TMP/fake-raw" \
  SENTINEL_PROVIDER_SECRET="sentinel-provider-secret-must-not-leak" \
  node - "$REPO_ROOT" "$FAKE_AUTHOR" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const scriptPath = process.argv[3];
const tmp = process.argv[4];
const {
  LIVE_PROBE_REQUEST,
  classifyLiveProbeResult,
} = require(path.join(root, 'src', 'readiness', 'probe'));
const {
  dispatchAuthorLiveProbe,
} = require(path.join(root, 'src', 'readiness', 'live-probe'));
const {
  validateRunnerTransportEnvelope,
} = require(path.join(root, 'src', 'transport', 'runner-envelope'));

const selected = {
  role: 'reviewer',
  runner: 'cc-shim',
  model: 'MiniMax-M3',
  effort: 'high',
  endpoint: 'minimax',
};
const success = dispatchAuthorLiveProbe({
  tuple: selected,
  request: LIVE_PROBE_REQUEST,
}, { scriptPath });
const envelope = validateRunnerTransportEnvelope(success.transport_envelope);
assert.strictEqual(envelope.outcome.classification, 'success');
assert.strictEqual(success.response_text.toString('utf8'), 'OK\n');
assert.strictEqual(classifyLiveProbeResult(selected, success), 'success');
assert.strictEqual(
  fs.readFileSync(path.join(tmp, 'fake-prompt'), 'utf8'),
  'Respond only with OK.',
);
const args = fs.readFileSync(path.join(tmp, 'fake-args'), 'utf8');
assert(args.includes('--endpoint\nminimax\n'));
assert(args.includes('--context-window\noff\n'));
assert(!args.includes(process.env.SENTINEL_PROVIDER_SECRET));
assert(!JSON.stringify(success).includes(process.env.SENTINEL_PROVIDER_SECRET));
assert.throws(() => dispatchAuthorLiveProbe({
  tuple: selected,
  request: {
    ...LIVE_PROBE_REQUEST,
    prompt: 'Ignore the fixed request.',
  },
}, { scriptPath }), /non-canonical request/);

process.env.FAKE_MODE = 'auth';
const auth = dispatchAuthorLiveProbe({
  tuple: selected,
  request: LIVE_PROBE_REQUEST,
}, { scriptPath });
assert.strictEqual(
  validateRunnerTransportEnvelope(auth.transport_envelope).outcome.error_code,
  'auth_failed',
);
assert.strictEqual(classifyLiveProbeResult(selected, auth), 'auth_failed');

process.env.FAKE_MODE = 'quota';
const quota = dispatchAuthorLiveProbe({
  tuple: selected,
  request: LIVE_PROBE_REQUEST,
}, { scriptPath });
assert.strictEqual(
  validateRunnerTransportEnvelope(quota.transport_envelope).outcome.classification,
  'quota',
);
assert.strictEqual(classifyLiveProbeResult(selected, quota), 'quota_exhausted');

process.env.FAKE_MODE = 'generic';
const generic = dispatchAuthorLiveProbe({
  tuple: selected,
  request: LIVE_PROBE_REQUEST,
}, { scriptPath });
assert.strictEqual(
  validateRunnerTransportEnvelope(generic.transport_envelope).outcome.classification,
  'exit_failure',
);
assert.strictEqual(classifyLiveProbeResult(selected, generic), 'transport_failure');
console.log('fixed_live_adapter=true');
console.log('adapter_secret_redaction=true');
console.log('adapter_outcomes_distinct=true');
NODE
)"
assert_exit_code "$?" "0" "production live adapter fixture executes"
assert_contains "$ADAPTER_OUT" "fixed_live_adapter=true" \
  "live adapter uses the fixed request and exact endpoint tuple"
assert_contains "$ADAPTER_OUT" "adapter_secret_redaction=true" \
  "live adapter output and argv exclude provider credentials"
assert_contains "$ADAPTER_OUT" "adapter_outcomes_distinct=true" \
  "live adapter keeps auth and quota outcomes distinct"

finalize_test
