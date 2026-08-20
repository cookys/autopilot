'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  evaluateProviderReadiness,
  normalizeProviderTuple,
} = require('./provider-readiness');
const {
  validateRunnerTransportEnvelope,
} = require('../transport/runner-envelope');
const {
  resolveStoreConfig,
} = require('../../scripts/engine-capability-state');
const {
  acquireLock,
  releaseLock,
} = require('../../scripts/lib/jsonl-store');
const {
  loadEndpointsEnv,
} = require('../../scripts/lib/load-endpoints-env');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CAPABILITY_STATE_CLI = path.join(REPO_ROOT, 'scripts', 'engine-capability-state.js');
const ENDPOINT_RESOLVER = path.join(REPO_ROOT, 'scripts', 'resolve-endpoint.sh');
const MAX_PROBE_TTL_SECONDS = 86400;
const EVIDENCE_PREFIX = 'provider_live_probe.minimal_no_effect.';
const INPUT_KEYS = new Set(['tuple', 'now', 'ttl_seconds', 'store']);
const DEPENDENCY_KEYS = new Set(['safeProbe', 'liveProbe']);
const SAFE_RESULT_KEYS = new Set(['status', 'evidence_class', 'reason']);
const LIVE_RESULT_KEYS = new Set(['transport_envelope', 'response_text']);
const SAFE_STATUSES = new Set(['ready', 'blocked', 'unknown']);
const LIVE_OUTCOMES = new Set([
  'success',
  'timeout',
  'transport_failure',
  'auth_failed',
  'quota_exhausted',
  'rate_limited',
  'malformed_response',
  'unavailable',
  'interrupted',
]);
const ERROR_OUTCOMES = new Map([
  ['auth_failed', 'auth_failed'],
  ['unauthorized', 'auth_failed'],
  ['401', 'auth_failed'],
  ['403', 'auth_failed'],
  ['quota', 'quota_exhausted'],
  ['quota_exhausted', 'quota_exhausted'],
  ['rate_limited', 'rate_limited'],
  ['429', 'rate_limited'],
]);
const BINARY_BY_RUNNER = Object.freeze({
  codex: 'codex',
  agy: 'agy',
  grok: 'grok',
  qoderclicn: 'qoderclicn',
  'cc-shim': 'claude',
  'anthropic-compatible': 'claude',
  'claude-native': 'claude',
  kimi: 'kimi',
});
const OUTCOME_POLICY = Object.freeze({
  success: { readiness: 'ready', capability: 'available', confidence: 'high' },
  auth_failed: { readiness: 'blocked', capability: 'unknown', confidence: 'high' },
  quota_exhausted: { readiness: 'blocked', capability: 'exhausted', confidence: 'high' },
  rate_limited: { readiness: 'blocked', capability: 'limited', confidence: 'high' },
  malformed_response: { readiness: 'unknown', capability: 'unknown', confidence: 'high' },
  timeout: { readiness: 'unknown', capability: 'unknown', confidence: 'medium' },
  transport_failure: { readiness: 'unknown', capability: 'unknown', confidence: 'medium' },
  unavailable: { readiness: 'unknown', capability: 'unknown', confidence: 'medium' },
  interrupted: { readiness: 'unknown', capability: 'unknown', confidence: 'medium' },
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactShape(value, allowed, required, label) {
  if (!isRecord(value)
      || Object.keys(value).some((key) => !allowed.has(key))
      || required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} has an invalid shape`);
  }
}

function boundedCode(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new TypeError(`${label} must be a bounded classification code`);
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function digest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function bufferDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function deepFreeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

// The live probe prompt is `Respond only with OK.` — a compliant provider may obey it
// literally and echo the full stop (agy answers `OK.\n`), or wrap the token in quotes or
// newlines. Accepting only the bare token contradicted the prompt that elicits it, so the
// classifier strips packaging and nothing else: surrounding whitespace/quotes and a single
// run of terminal `.`/`!`. `?` is deliberately not stripped (a question is not an
// affirmation), the comparison stays case-sensitive, and it is anchored to the whole
// remainder — a longer sentence that merely contains OK is still malformed, otherwise the
// probe would stop proving the provider answered.
const LIVE_PROBE_EXPECTED_RESPONSE = 'OK';
const LIVE_PROBE_RESPONSE_LEAD = /^[\s"'`‘’“”]+/;
const LIVE_PROBE_RESPONSE_TAIL = /[\s"'`‘’“”.!]+$/;
const LIVE_PROBE_MAX_RESPONSE_BYTES = 256;

function normalizeLiveProbeResponse(value) {
  return value
    .replace(LIVE_PROBE_RESPONSE_LEAD, '')
    .replace(LIVE_PROBE_RESPONSE_TAIL, '');
}

// 4 was too tight and misclassified healthy providers. A model that spends
// output tokens before it emits text — MiniMax-M3 on the `minimax` endpoint,
// measured 2026-08-14 — produces nothing at all within 4 and the seat reports
// `transport_failure`; at 8 and 16 the same tuple answers `OK` every time. The
// budget is what lets the model REACH the answer; the gate itself is unchanged,
// because the response must still normalise to exactly `OK`. 32 buys headroom
// for a longer reasoning preamble at no meaningful cost for a two-token reply.
const LIVE_PROBE_REQUEST_BODY = {
  schema_version: 1,
  operation: 'provider-readiness-live-probe',
  prompt: 'Respond only with OK.',
  effect: 'read-only',
  tools: 'disabled',
  max_output_tokens: 32,
};
const LIVE_PROBE_REQUEST = deepFreeze({
  ...LIVE_PROBE_REQUEST_BODY,
  request_digest: digest(LIVE_PROBE_REQUEST_BODY),
});

function parseInstant(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  const parsed = new Date(value);
  if (parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
}

function normalizeInput(value) {
  exactShape(value, INPUT_KEYS, ['tuple', 'now', 'ttl_seconds'], 'provider probe input');
  const tuple = Object.freeze(normalizeProviderTuple(value.tuple));
  parseInstant(value.now, 'provider probe now');
  if (!Number.isSafeInteger(value.ttl_seconds)
      || value.ttl_seconds < 1
      || value.ttl_seconds > MAX_PROBE_TTL_SECONDS) {
    throw new TypeError(
      `provider probe ttl_seconds must be between 1 and ${MAX_PROBE_TTL_SECONDS}`,
    );
  }
  if (value.store !== undefined
      && (typeof value.store !== 'string'
        || value.store.length === 0
        || /[\u0000-\u001f\u007f]/.test(value.store))) {
    throw new TypeError('provider probe store must be a safe non-empty path');
  }
  return {
    tuple,
    now: value.now,
    ttl_seconds: value.ttl_seconds,
    store: value.store,
  };
}

function normalizeDependencies(value) {
  exactShape(value, DEPENDENCY_KEYS, ['liveProbe'], 'provider probe dependencies');
  if (value.safeProbe !== undefined && typeof value.safeProbe !== 'function') {
    throw new TypeError('provider probe safeProbe must be a function');
  }
  if (typeof value.liveProbe !== 'function') {
    throw new TypeError('provider probe liveProbe must be a function');
  }
  return {
    safeProbe: value.safeProbe || probeSafeSurface,
    liveProbe: value.liveProbe,
  };
}

function normalizeSafeResult(value) {
  exactShape(
    value,
    SAFE_RESULT_KEYS,
    [...SAFE_RESULT_KEYS],
    'safe probe result',
  );
  if (!SAFE_STATUSES.has(value.status)
      || (value.status === 'ready' && value.reason !== null)
      || (value.status !== 'ready' && value.reason === null)) {
    throw new TypeError('safe probe result has an invalid value');
  }
  return {
    status: value.status,
    evidence_class: boundedCode(value.evidence_class, 'safe probe evidence_class'),
    reason: boundedCode(value.reason, 'safe probe reason', true),
  };
}

function providerObservation(tuple, axis, status, now, ttlSeconds, evidenceClass, reason) {
  return {
    schema_version: 1,
    artifact_type: 'provider_axis_observation',
    tuple,
    axis,
    status,
    observed_at: now,
    ttl_seconds: ttlSeconds,
    evidence_class: evidenceClass,
    reason,
  };
}

// A `--version` call is a PROCESS-LAUNCH cost, not a network one: for a bundled
// Node CLI it is dominated by interpreter start plus bundle parse, and it scales
// with how loaded the box is — not with whether the provider works. 5s was below
// the floor for at least one wired runner and turned "slow" into "broken", the
// same wrong-diagnosis shape the live probe hit at 1m (see `live-probe.js`
// `--timeout 3m`). Measured 2026-08-14 on an otherwise busy box, five runs each:
// `kimi --version` 4288/5612/5769/6629/6926 ms — four of five over the old cap —
// against `grok` 125 ms and `agy` 745 ms. The seat then reported
// `safe_probe_timeout` and the whole strict-l5 trust root sat at 6/7 with a
// perfectly healthy engine.
//
// 20s is ~3x the slowest observation, and it costs nothing on a healthy runner:
// the probe returns as soon as the child exits, so grok still answers in 125 ms.
// The gate is unchanged — a non-zero exit is still `binary_probe_failed`, a
// missing binary is still `missing_binary`. This only stops a slow-but-present
// CLI from being recorded as an absent one.
const SAFE_BINARY_PROBE_TIMEOUT_MS = 20000;

function probeSafeSurface({ tuple }) {
  const binary = BINARY_BY_RUNNER[tuple.runner] || tuple.runner;
  const version = spawnSync(binary, ['--version'], {
    cwd: REPO_ROOT,
    env: process.env,
    timeout: SAFE_BINARY_PROBE_TIMEOUT_MS,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (version.error && version.error.code === 'ENOENT') {
    return { status: 'blocked', evidence_class: 'safe-surface', reason: 'missing_binary' };
  }
  if (version.error && version.error.code === 'ETIMEDOUT') {
    return { status: 'unknown', evidence_class: 'safe-surface', reason: 'safe_probe_timeout' };
  }
  if (version.error || version.status !== 0) {
    return { status: 'unknown', evidence_class: 'safe-surface', reason: 'binary_probe_failed' };
  }
  if (tuple.endpoint === null) {
    return { status: 'ready', evidence_class: 'safe-surface', reason: null };
  }

  const endpointEnv = { ...process.env };
  const loaded = loadEndpointsEnv({
    env: endpointEnv,
    cwd: REPO_ROOT,
    warn: () => {},
  });
  if (loaded.rejected) {
    return {
      status: 'blocked',
      evidence_class: 'safe-surface',
      reason: 'endpoint_credentials_rejected',
    };
  }
  const endpoint = spawnSync('bash', [ENDPOINT_RESOLVER, tuple.endpoint], {
    cwd: REPO_ROOT,
    env: endpointEnv,
    timeout: 5000,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  if (endpoint.error && endpoint.error.code === 'ETIMEDOUT') {
    return { status: 'unknown', evidence_class: 'safe-surface', reason: 'safe_probe_timeout' };
  }
  if (endpoint.error || endpoint.status !== 0) {
    return { status: 'blocked', evidence_class: 'safe-surface', reason: 'endpoint_unavailable' };
  }
  return { status: 'ready', evidence_class: 'safe-surface', reason: null };
}

function classifyLiveProbeResult(tupleValue, value) {
  const tuple = normalizeProviderTuple(tupleValue);
  exactShape(value, LIVE_RESULT_KEYS, [...LIVE_RESULT_KEYS], 'live probe result');
  const envelope = validateRunnerTransportEnvelope(value.transport_envelope);
  if (envelope.request_binding.runner !== tuple.runner
      || envelope.request_binding.model !== tuple.model
      || envelope.request_binding.operation !== LIVE_PROBE_REQUEST.operation) {
    throw new TypeError('live probe transport envelope does not match the selected tuple');
  }
  if (typeof value.response_text !== 'string' && !Buffer.isBuffer(value.response_text)) {
    throw new TypeError('live probe response_text must be a string or buffer');
  }
  const responseBuffer = Buffer.isBuffer(value.response_text)
    ? value.response_text
    : Buffer.from(value.response_text, 'utf8');
  if (bufferDigest(responseBuffer) !== envelope.output_digests.stdout_sha256) {
    throw new TypeError('live probe response does not match the transport stdout digest');
  }

  switch (envelope.outcome.classification) {
    case 'success': {
      if (responseBuffer.length > LIVE_PROBE_MAX_RESPONSE_BYTES) return 'malformed_response';
      const response = responseBuffer.toString('utf8');
      return normalizeLiveProbeResponse(response) === LIVE_PROBE_EXPECTED_RESPONSE
        ? 'success'
        : 'malformed_response';
    }
    case 'quota':
      return 'quota_exhausted';
    case 'timeout':
      return 'timeout';
    case 'unavailable':
    case 'exit_failure':
      return ERROR_OUTCOMES.get(envelope.outcome.error_code)
        || (envelope.outcome.classification === 'unavailable'
          ? 'unavailable'
          : 'transport_failure');
    case 'interrupted':
      return 'interrupted';
    default:
      throw new TypeError('live probe transport envelope has an unsupported outcome');
  }
}

function outcomePolicy(outcome) {
  if (!LIVE_OUTCOMES.has(outcome)) {
    throw new TypeError('provider live probe outcome is unsupported');
  }
  return OUTCOME_POLICY[outcome];
}

function evidenceForOutcome(outcome) {
  outcomePolicy(outcome);
  return `${EVIDENCE_PREFIX}${outcome}`;
}

function outcomeFromEvidence(value) {
  if (typeof value !== 'string' || !value.startsWith(EVIDENCE_PREFIX)) return null;
  const outcome = value.slice(EVIDENCE_PREFIX.length);
  return LIVE_OUTCOMES.has(outcome) ? outcome : null;
}

function stateArgs(command, input) {
  const args = [CAPABILITY_STATE_CLI, command];
  if (input.store !== undefined) args.push('--store', input.store);
  return args;
}

function runStateCli(args, options) {
  return spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: 'utf8',
    timeout: 10000,
    ...options,
  });
}

function readCurrentLiveObservation(input) {
  const endpoint = input.tuple.endpoint === null ? '@none' : input.tuple.endpoint;
  const args = stateArgs('current', input);
  args.push(
    '--runner', input.tuple.runner,
    '--model', input.tuple.model,
    '--role', input.tuple.role,
    '--effort', input.tuple.effort,
    '--endpoint', endpoint,
    '--role-scope', 'exact',
    '--now', input.now,
  );
  const child = runStateCli(args, { stdio: ['ignore', 'pipe', 'ignore'] });
  if (child.error || child.status !== 0) {
    throw new Error('provider probe capability read failed');
  }
  let current;
  try {
    current = JSON.parse(child.stdout);
  } catch {
    throw new Error('provider probe capability read returned malformed JSON');
  }

  if (current.runner !== input.tuple.runner
      || current.model !== input.tuple.model
      || current.role !== input.tuple.role
      || current.effort !== input.tuple.effort
      || current.effort_binding !== 'exact'
      || current.endpoint !== input.tuple.endpoint
      || current.endpoint_binding !== 'exact') {
    throw new Error('provider probe capability read returned a mismatched tuple');
  }
  const quota = current && current.capability && current.capability.quota;
  const outcome = quota && outcomeFromEvidence(quota.evidence);
  if (!outcome || !quota.observed_at) {
    return null;
  }
  if (!Number.isSafeInteger(quota.ttl_seconds)
      || quota.ttl_seconds < 1
      || quota.ttl_seconds > MAX_PROBE_TTL_SECONDS
      || !Number.isSafeInteger(quota.event_id)
      || quota.event_id < 1) {
    throw new Error('provider probe capability evidence has invalid provenance');
  }
  const policy = outcomePolicy(outcome);
  const observation = providerObservation(
    input.tuple,
    'live',
    policy.readiness,
    quota.observed_at,
    quota.ttl_seconds,
    'live-probe',
    outcome === 'success' ? null : outcome,
  );
  const evaluated = evaluateProviderReadiness({
    tuple: input.tuple,
    observations: { live: observation },
    now: input.now,
  });
  if (evaluated.axes.live.freshness !== 'fresh') return null;
  if (quota.status !== policy.capability) {
    throw new Error('provider probe capability evidence contradicts its stored status');
  }
  return {
    observation,
    outcome,
    event_id: quota.event_id,
  };
}

function persistLiveObservation(input, outcome, observation) {
  const policy = outcomePolicy(outcome);
  const event = {
    schema_version: 1,
    observed_at: input.now,
    runner: input.tuple.runner,
    model: input.tuple.model,
    role: input.tuple.role,
    effort: input.tuple.effort,
    endpoint: input.tuple.endpoint,
    runner_version: null,
    capability: {
      quota: {
        status: policy.capability,
        reset_at: null,
        confidence: policy.confidence,
        evidence: evidenceForOutcome(outcome),
        ttl_seconds: observation.ttl_seconds,
      },
    },
  };
  const child = runStateCli(stateArgs('record', input), {
    input: `${JSON.stringify(event)}\n`,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  if (child.error || child.status !== 0) {
    throw new Error('provider probe capability persistence failed');
  }
  let stored;
  try {
    stored = JSON.parse(child.stdout);
  } catch {
    throw new Error('provider probe capability persistence returned malformed JSON');
  }
  if (!Number.isSafeInteger(stored.event_id)
      || stored.runner !== input.tuple.runner
      || stored.model !== input.tuple.model
      || stored.role !== input.tuple.role
      || stored.effort !== input.tuple.effort
      || stored.endpoint !== input.tuple.endpoint) {
    throw new Error('provider probe capability persistence returned a mismatched event');
  }
  return {
    recorded: true,
    event_id: stored.event_id,
    event_digest: digest(stored),
  };
}

function resultBody(input, transportObservation, liveObservation, liveProbe, persistence) {
  return {
    tuple: input.tuple,
    observed_at: input.now,
    transport_observation: transportObservation,
    live_observation: liveObservation,
    live_probe: liveProbe,
    persistence,
  };
}

function withExactTupleProbeLock(input, callback) {
  const { storeDir } = resolveStoreConfig({ store: input.store });
  const lockFile = path.join(
    storeDir,
    `.provider-probe-${digest(input.tuple)}.lock`,
  );
  acquireLock({
    storeDir,
    lockFile,
    name: 'provider live probe',
    timeoutMs: 120000,
  });
  try {
    return callback();
  } finally {
    releaseLock(lockFile);
  }
}

function runProviderProbe(value, dependencies = {}) {
  const input = normalizeInput(value);
  const adapters = normalizeDependencies(dependencies);
  let safeRaw;
  try {
    safeRaw = adapters.safeProbe({ tuple: input.tuple, now: input.now });
  } catch {
    throw new Error('provider safe probe adapter failed');
  }
  const safe = normalizeSafeResult(safeRaw);
  const transportObservation = providerObservation(
    input.tuple,
    'transport',
    safe.status,
    input.now,
    input.ttl_seconds,
    safe.evidence_class,
    safe.reason,
  );
  const liveBase = {
    request_digest: LIVE_PROBE_REQUEST.request_digest,
    transport_receipt_digest: null,
  };

  return withExactTupleProbeLock(input, () => {
    const existing = readCurrentLiveObservation(input);
    if (existing) {
      return resultBody(
        input,
        transportObservation,
        existing.observation,
        {
          attempted: false,
          reused: true,
          outcome: existing.outcome,
          ...liveBase,
        },
        {
          recorded: false,
          event_id: existing.event_id,
          event_digest: null,
        },
      );
    }
    if (safe.status !== 'ready') {
      return resultBody(
        input,
        transportObservation,
        null,
        {
          attempted: false,
          reused: false,
          outcome: null,
          ...liveBase,
        },
        {
          recorded: false,
          event_id: null,
          event_digest: null,
        },
      );
    }

    let liveResult;
    try {
      liveResult = adapters.liveProbe({
        tuple: input.tuple,
        request: LIVE_PROBE_REQUEST,
      });
    } catch {
      throw new Error('provider live probe adapter failed before producing a transport envelope');
    }
    const outcome = classifyLiveProbeResult(input.tuple, liveResult);
    const policy = outcomePolicy(outcome);
    const liveObservation = providerObservation(
      input.tuple,
      'live',
      policy.readiness,
      input.now,
      input.ttl_seconds,
      'live-probe',
      outcome === 'success' ? null : outcome,
    );
    const persistence = persistLiveObservation(input, outcome, liveObservation);
    const envelope = validateRunnerTransportEnvelope(liveResult.transport_envelope);
    return resultBody(
      input,
      transportObservation,
      liveObservation,
      {
        attempted: true,
        reused: false,
        outcome,
        request_digest: LIVE_PROBE_REQUEST.request_digest,
        transport_receipt_digest: envelope.receipt_digest,
      },
      persistence,
    );
  });
}

module.exports = {
  LIVE_PROBE_REQUEST,
  MAX_PROBE_TTL_SECONDS,
  classifyLiveProbeResult,
  probeSafeSurface,
  runProviderProbe,
};
