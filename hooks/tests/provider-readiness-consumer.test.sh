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
  consumeProviderReadinessBeforeSpend,
  createProviderReadinessReceipt,
  validateProviderReadinessReceipt,
} = require(path.join(root, 'src', 'readiness', 'receipt'));
const {
  buildSelectedRoster,
} = require(path.join(root, 'src', 'readiness', 'status'));
const { createQualificationProvider } = require(path.join(root, 'src', 'readiness', 'qualification-provider'));
const { consumeEnforcedProviderReadiness } = require(path.join(root, 'src', 'engine', 'campaign-intake'));

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

const provider = createQualificationProvider({ qualify: (bound) => bound.role === 'reviewer' });
const bound = consumeProviderReadinessBeforeSpend(fallbackReceipt, {
  roster: fallbackRoster,
  policy,
  now: '2026-07-27T12:01:00.000Z',
  qualificationProvider: provider,
});
assert.strictEqual(bound.status, 'ready');
assert.strictEqual(bound.qualification_authority, 'host-injected-exact-role');
assert.throws(() => consumeProviderReadinessBeforeSpend(fallbackReceipt, {
  roster: fallbackRoster,
  policy,
  now: '2026-07-27T12:01:00.000Z',
}), (error) => error.code === 'provider_readiness_qualification_authority_missing');
const iccBound = consumeEnforcedProviderReadiness({
  adapters: {
    providerReadiness: () => ({ receipt: fallbackReceipt, roster: fallbackRoster, policy }),
    qualificationProvider: createQualificationProvider({ qualify: (candidate) => candidate.role === 'reviewer' }),
  },
  contract: {}, inspection: {}, roster: {}, now: '2026-07-27T12:01:00.000Z',
});
assert.strictEqual(iccBound.status, 'ready');

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
console.log('host_authority_pre_spend=true');
console.log('icc_consumes_host_authority=true');
NODE
)"
assert_exit_code "$?" "0" "provider readiness receipt consumer matrix executes"
for key in four_distinct_decisions blocked_consumer_rejection unknown_preserved \
  fallback_order_and_family configured_fallback_projection \
  unqualified_not_promoted receipt_drift_guards host_authority_pre_spend \
  icc_consumes_host_authority; do
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

# D4 strict /l5 trust root: exact frozen policy, canonical roster projection,
# fresh host-owned closures, and the complete pre-dispatch negative matrix.
STRICT_BOOTSTRAP_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const {
  STRICT_L5_CLAIM_IDS,
  STRICT_L5_PROVIDER_POLICY,
  STRICT_L5_PROVIDER_POLICY_DIGEST,
  consumeStrictL5ProviderReadiness,
  createStrictL5ProviderBootstrap,
  deriveStrictL5InvocationPolicy,
  validateStrictL5ProviderPolicy,
} = require(path.join(root, 'src', 'readiness', 'provider-bootstrap'));
const {
  buildSelectedRoster,
} = require(path.join(root, 'src', 'readiness', 'status'));
const {
  qualifyExactRoleNow,
} = require(path.join(root, 'src', 'readiness', 'qualification-provider'));
const {
  canonicalDigest,
  createProviderReadinessReceipt,
} = require(path.join(root, 'src', 'readiness', 'receipt'));
const {
  resolveReviewLoopJson,
} = require(path.join(root, 'src', 'engine', 'resolve-review-loop'));

const NOW = '2026-08-04T08:00:00.000Z';
const clone = (value) => JSON.parse(JSON.stringify(value));
const resolvedResult = resolveReviewLoopJson(['--check-scorecard'], {
  cwd: root,
  env: process.env,
});
assert.strictEqual(resolvedResult.status, 0);
assert.strictEqual(resolvedResult.error, null);
const resolved = resolvedResult.result;

const readyObservation = (tuple, axis, now, ttl) => ({
  schema_version: 1,
  artifact_type: 'provider_axis_observation',
  tuple,
  axis,
  status: 'ready',
  observed_at: now,
  ttl_seconds: ttl,
  evidence_class: axis === 'qualification'
    ? 'host-injected-exact-role'
    : (axis === 'transport' ? 'safe-surface' : 'live-probe'),
  reason: null,
});
const readyCollector = (options) => {
  const ttl = options.resolvedRoster.provider_readiness_receipt_ttl_seconds;
  const roster = buildSelectedRoster(options.resolvedRoster, options.now, ttl);
  for (const seat of roster) {
    for (const candidate of [seat, ...seat.fallbacks]) {
      const qualification = qualifyExactRoleNow(
        options.qualificationProvider,
        candidate.tuple,
        options.now,
        ttl,
      );
      assert(qualification, `fixture tuple must be host-qualified: ${candidate.tuple.model}`);
      candidate.observations = {
        transport: readyObservation(candidate.tuple, 'transport', options.now, ttl),
        live: readyObservation(candidate.tuple, 'live', options.now, ttl),
        qualification,
      };
    }
  }
  const policy = {
    receipt_ttl_seconds: ttl,
    fallback_family_constraint:
      options.resolvedRoster.provider_readiness_fallback_family_constraint,
  };
  return {
    receipt: createProviderReadinessReceipt({ roster, policy, now: options.now }),
    roster,
    policy,
  };
};

assert(Object.isFrozen(STRICT_L5_PROVIDER_POLICY));
assert(STRICT_L5_PROVIDER_POLICY.every((entry) => (
  Object.isFrozen(entry) && Object.isFrozen(entry.tuple)
)));
assert.deepStrictEqual(
  STRICT_L5_PROVIDER_POLICY.map((entry) => entry.claim_id),
  STRICT_L5_CLAIM_IDS,
);
assert.strictEqual(canonicalDigest(STRICT_L5_PROVIDER_POLICY), STRICT_L5_PROVIDER_POLICY_DIGEST);
assert.deepStrictEqual(
  Object.keys(STRICT_L5_PROVIDER_POLICY[0].tuple),
  ['runner', 'model', 'role', 'effort', 'endpoint', 'family'],
);
assert(STRICT_L5_PROVIDER_POLICY.every((entry) => entry.tuple.endpoint === null
  || entry.tuple.endpoint === 'minimax'
  || entry.tuple.endpoint === 'glm'));

const projected = deriveStrictL5InvocationPolicy(resolved);
assert.deepStrictEqual(
  projected.invocation_policy.map((entry) => entry.tuple.role),
  ['implementer', 'qc', 'qc', 'qc', 'reviewer', 'verification_author'],
);
assert.strictEqual(projected.invocation_policy.length, 6);
assert.strictEqual(projected.policy_digest, STRICT_L5_PROVIDER_POLICY_DIGEST);

const bootstrap = createStrictL5ProviderBootstrap({ cwd: root }, {
  resolvedRoster: clone(resolved),
  collectReadiness: readyCollector,
  now: () => NOW,
});
const bundle = bootstrap.providerReadinessAuthority({ roster: bootstrap.roster });
const consumed = consumeStrictL5ProviderReadiness(
  bootstrap.providerReadinessAuthority,
  bundle,
  { roster: bootstrap.roster, now: NOW },
);
assert.strictEqual(consumed.status, 'ready');
assert.strictEqual(consumed.strict_level, 'l5');
assert.strictEqual(consumed.policy_digest, STRICT_L5_PROVIDER_POLICY_DIGEST);
assert.deepStrictEqual(consumed.claim_ids, STRICT_L5_CLAIM_IDS);

// L6 twin: the same strict provider-readiness bootstrap must compile for l6,
// and every receipt/claim field carries the actual level instead of the l5
// literal (BACKLOG "L6 managed campaigns can never satisfy
// reviewer_qualification", 2026-08-30).
const l6Bootstrap = createStrictL5ProviderBootstrap({ cwd: root, level: 'l6' }, {
  resolvedRoster: clone(resolved),
  collectReadiness: readyCollector,
  now: () => NOW,
});
assert.strictEqual(l6Bootstrap.strict_level, 'l6');
const l6Bundle = l6Bootstrap.providerReadinessAuthority({ roster: l6Bootstrap.roster });
assert.strictEqual(l6Bundle.strict_level, 'l6');
const l6Consumed = consumeStrictL5ProviderReadiness(
  l6Bootstrap.providerReadinessAuthority,
  l6Bundle,
  { roster: l6Bootstrap.roster, now: NOW },
);
assert.strictEqual(l6Consumed.status, 'ready');
assert.strictEqual(l6Consumed.strict_level, 'l6');
assert.strictEqual(l6Consumed.policy_digest, STRICT_L5_PROVIDER_POLICY_DIGEST);
assert.deepStrictEqual(l6Consumed.claim_ids, STRICT_L5_CLAIM_IDS);
// An l5-issued bundle must never be consumable through an l6 authority (and
// vice versa) — the level is now part of the coherence check, not decor.
assert.throws(
  () => consumeStrictL5ProviderReadiness(
    l6Bootstrap.providerReadinessAuthority,
    bundle,
    { roster: l6Bootstrap.roster, now: NOW },
  ),
  (error) => error && error.code === 'strict_l5_provider_serialized_replay',
);
assert.throws(
  () => createStrictL5ProviderBootstrap({ cwd: root, level: 'l7' }, {
    resolvedRoster: clone(resolved),
    collectReadiness: readyCollector,
    now: () => NOW,
  }),
  (error) => error && error.code === 'strict_l5_provider_bootstrap_invalid',
);
assert.strictEqual(consumed.selections.length, 6);
assert.strictEqual(bundle.observation_digest, bundle.receipt.observation_digest);

let dispatcherCalls = 0;
const rejectsBeforeDispatch = (callback, code) => {
  const before = dispatcherCalls;
  assert.throws(callback, (error) => error && error.code === code);
  assert.strictEqual(dispatcherCalls, before);
};

const wrongFields = [
  ['runner', 'agy'],
  ['model', 'wrong-model'],
  ['role', 'reviewer'],
  ['effort', 'low'],
  ['endpoint', 'wrong_endpoint'],
  ['family', 'wrong-family'],
];
for (const [field, value] of wrongFields) {
  const candidate = clone(STRICT_L5_PROVIDER_POLICY);
  candidate[3].tuple[field] = value;
  rejectsBeforeDispatch(
    () => validateStrictL5ProviderPolicy(candidate),
    'strict_l5_provider_policy_digest_drift',
  );
}
const omitted = clone(STRICT_L5_PROVIDER_POLICY);
delete omitted[0].tuple.family;
rejectsBeforeDispatch(
  () => validateStrictL5ProviderPolicy(omitted),
  'strict_l5_provider_policy_invalid',
);
const substituted = clone(STRICT_L5_PROVIDER_POLICY);
substituted[0].claim_id = STRICT_L5_CLAIM_IDS[1];
rejectsBeforeDispatch(
  () => validateStrictL5ProviderPolicy(substituted),
  'strict_l5_provider_claim_substitution',
);
rejectsBeforeDispatch(
  () => validateStrictL5ProviderPolicy(STRICT_L5_PROVIDER_POLICY, '0'.repeat(64)),
  'strict_l5_provider_policy_digest_drift',
);
rejectsBeforeDispatch(
  () => validateStrictL5ProviderPolicy([...clone(STRICT_L5_PROVIDER_POLICY)].reverse()),
  'strict_l5_provider_claim_substitution',
);

// Advisory semantics (2026-08-16 retirement plan P4): a non-canonical roster
// derives — it does not reject. The uncertified seat carries claim_id null and
// the derivation reports policy_override with the advisory_default reason.
const unknownTuple = clone(resolved);
unknownTuple.reviewer_engine = 'unknown-reviewer-model';
const advisoryDerived = deriveStrictL5InvocationPolicy(unknownTuple);
assert.ok(advisoryDerived.policy_override, 'advisory derivation must report policy_override');
assert.equal(advisoryDerived.policy_override.reason, 'advisory_default');
assert.equal(advisoryDerived.policy_override.uncertified_seats.length, 1);
assert.equal(advisoryDerived.policy_override.uncertified_seats[0].tuple.model, 'unknown-reviewer-model');
assert.ok(
  advisoryDerived.invocation_policy.some((seat) => seat.claim_id === null),
  'uncertified seat must carry claim_id null, never a borrowed claim',
);

// An operator-configured reason is preserved verbatim in place of advisory_default.
const explicitOverride = clone(unknownTuple);
explicitOverride.strict_l5_policy_override = 'qualifying replacement reviewer';
assert.equal(
  deriveStrictL5InvocationPolicy(explicitOverride).policy_override.reason,
  'qualifying replacement reviewer',
);

// A byte-canonical roster still derives silently: policy_override stays null.
assert.equal(deriveStrictL5InvocationPolicy(clone(resolved)).policy_override, null);
const duplicateTuple = clone(resolved);
duplicateTuple.qc_panel_seats[1] = clone(duplicateTuple.qc_panel_seats[0]);
rejectsBeforeDispatch(
  () => deriveStrictL5InvocationPolicy(duplicateTuple),
  'strict_l5_provider_tuple_duplicate',
);
const fallbackFamily = clone(resolved);
fallbackFamily.fallback_ladder = [{
  engine: 'MiniMax-M3-fallback',
  runner: 'cc-shim',
  model: 'MiniMax-M3-fallback',
  effort: 'high',
  endpoint: 'minimax',
  family: 'minimax',
}];
rejectsBeforeDispatch(
  () => deriveStrictL5InvocationPolicy(fallbackFamily),
  'strict_l5_provider_fallback_family_violation',
);
const incomplete = clone(resolved);
delete incomplete.reviewer_family;
rejectsBeforeDispatch(
  () => deriveStrictL5InvocationPolicy(incomplete),
  'strict_l5_provider_tuple_unresolved',
);
// Post-bootstrap roster substitution is a pipeline-consistency violation, not a
// canonical-policy question: it stays a hard block (roster_drift), because the
// requested roster no longer digest-matches the roster this authority derived.
const rosterDrift = clone(bootstrap.roster);
rosterDrift.qc_panel_seats[0].model = 'drifted-qc';
rejectsBeforeDispatch(
  () => bootstrap.providerReadinessAuthority({ roster: rosterDrift }),
  'strict_l5_provider_roster_drift',
);
rejectsBeforeDispatch(
  () => consumeStrictL5ProviderReadiness(
    bootstrap.providerReadinessAuthority,
    clone(bundle),
    { roster: bootstrap.roster, now: NOW },
  ),
  'strict_l5_provider_serialized_replay',
);

const failedProbe = createStrictL5ProviderBootstrap({ cwd: root }, {
  resolvedRoster: clone(resolved),
  collectReadiness: () => { throw new Error('fixture provider probe failure'); },
  now: () => NOW,
});
rejectsBeforeDispatch(
  () => failedProbe.providerReadinessAuthority({ roster: failedProbe.roster }),
  'strict_l5_provider_probe_failed',
);

const staleResolved = clone(resolved);
staleResolved.provider_readiness_receipt_ttl_seconds = 1;
const stale = createStrictL5ProviderBootstrap({ cwd: root }, {
  resolvedRoster: staleResolved,
  collectReadiness: readyCollector,
  now: () => NOW,
});
const staleBundle = stale.providerReadinessAuthority({ roster: stale.roster });
rejectsBeforeDispatch(
  () => consumeStrictL5ProviderReadiness(
    stale.providerReadinessAuthority,
    staleBundle,
    { roster: stale.roster, now: '2026-08-04T08:00:01.000Z' },
  ),
  'provider_readiness_receipt_expired',
);

const missingQualification = createStrictL5ProviderBootstrap({ cwd: root }, {
  resolvedRoster: clone(resolved),
  collectReadiness: (options) => {
    const collected = readyCollector(options);
    delete collected.roster[0].observations.qualification;
    collected.receipt = createProviderReadinessReceipt({
      roster: collected.roster,
      policy: collected.policy,
      now: options.now,
    });
    return collected;
  },
  now: () => NOW,
});
const missingQualificationBundle = missingQualification.providerReadinessAuthority({
  roster: missingQualification.roster,
});
rejectsBeforeDispatch(
  () => consumeStrictL5ProviderReadiness(
    missingQualification.providerReadinessAuthority,
    missingQualificationBundle,
    { roster: missingQualification.roster, now: NOW },
  ),
  'strict_l5_provider_not_ready',
);

assert.strictEqual(dispatcherCalls, 0);
console.log('strict_policy_exact=true');
console.log('strict_positive_ready=true');
console.log('strict_negative_matrix_zero_dispatch=true');
NODE
)"
assert_exit_code "$?" "0" "strict /l5 provider policy bootstrap is available"
assert_contains "$STRICT_BOOTSTRAP_OUT" "strict_policy_exact=true" \
  "strict /l5 policy is the exact frozen six-claim contract"
assert_contains "$STRICT_BOOTSTRAP_OUT" "strict_positive_ready=true" \
  "strict /l5 accepts a fresh host-owned exact-roster readiness bundle"
assert_contains "$STRICT_BOOTSTRAP_OUT" "strict_negative_matrix_zero_dispatch=true" \
  "strict /l5 negative matrix rejects before workflow dispatch"

finalize_test
