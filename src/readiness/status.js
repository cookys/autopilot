'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const {
  resolveReviewLoopJson,
} = require('../engine/resolve-review-loop');
const {
  evaluateProviderReadiness,
} = require('./provider-readiness');
const {
  createProviderReadinessReceipt,
} = require('./receipt');
const {
  runProviderProbe,
} = require('./probe');
const {
  dispatchAuthorLiveProbe,
} = require('./live-probe');
const {
  qualifyExactRoleNow,
} = require('./qualification-provider');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CAPABILITY_STATE = path.join(REPO_ROOT, 'scripts', 'engine-capability-state.js');
const DEFAULT_RECEIPT_TTL_SECONDS = 300;
const DEFAULT_OBSERVATION_TTL_SECONDS = 600;

function familyOf(model) {
  const value = String(model || '').toLowerCase();
  if (/(gpt|codex|o1|o3|o4)/.test(value)) return 'openai';
  if (/(claude|opus|sonnet|haiku)/.test(value)) return 'anthropic';
  if (/(qwen|qwq)/.test(value)) return 'alibaba';
  if (/(gemini|flash|bison)/.test(value)) return 'google';
  if (/(grok|composer)/.test(value)) return 'xai';
  if (/(minimax|abab)/.test(value)) return 'minimax';
  if (/(glm|zhipu)/.test(value)) return 'zhipu';
  if (/(kimi|moonshot)/.test(value)) return 'moonshot';
  return 'unknown';
}

function resolveConfiguredRunner(runner, model) {
  if (runner !== 'auto') return runner;
  const family = familyOf(model);
  if (family === 'openai') return 'codex';
  if (family === 'xai') return 'grok';
  if (family === 'alibaba') return 'qoderclicn';
  return 'agy';
}

function providerTuple(role, runner, model, effort, endpoint) {
  return {
    role,
    runner: resolveConfiguredRunner(runner, model),
    model,
    effort,
    endpoint: endpoint || null,
  };
}

function missingExactTupleObservation(boundTuple, now) {
  return {
    transport: {
      schema_version: 1,
      artifact_type: 'provider_axis_observation',
      tuple: boundTuple,
      axis: 'transport',
      status: 'blocked',
      observed_at: now,
      ttl_seconds: DEFAULT_OBSERVATION_TTL_SECONDS,
      evidence_class: 'configuration',
      reason: 'incomplete_exact_tuple',
    },
  };
}

function qualificationObservation(boundTuple, now, ttlSeconds) {
  return {
    schema_version: 1,
    artifact_type: 'provider_axis_observation',
    tuple: boundTuple,
    axis: 'qualification',
    status: 'ready',
    observed_at: now,
    ttl_seconds: ttlSeconds,
    evidence_class: 'scorecard-session',
    reason: null,
  };
}

function reviewerFallbacks(resolved, primaryTuple, now, ttlSeconds) {
  const ladder = Array.isArray(resolved.fallback_ladder)
    ? resolved.fallback_ladder
    : [];
  const configuredPreference = resolved.review_risk === 'low'
    && Array.isArray(resolved.reviewer_fallback_preference_low_risk)
    && resolved.reviewer_fallback_preference_low_risk.length > 0
    ? resolved.reviewer_fallback_preference_low_risk
    : resolved.reviewer_fallback_preference;
  const preference = Array.isArray(configuredPreference) ? configuredPreference : [];
  const preferenceRank = new Map(preference.map((engine, index) => [engine, index]));
  const ranked = ladder.map((candidate, index) => ({ candidate, index }));
  ranked.sort((left, right) => {
    const leftRank = preferenceRank.has(left.candidate.engine)
      ? preferenceRank.get(left.candidate.engine)
      : Number.MAX_SAFE_INTEGER;
    const rightRank = preferenceRank.has(right.candidate.engine)
      ? preferenceRank.get(right.candidate.engine)
      : Number.MAX_SAFE_INTEGER;
    return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
  });

  const output = [];
  const seen = new Set([JSON.stringify(primaryTuple)]);
  for (const { candidate } of ranked) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const model = typeof candidate.model === 'string' && candidate.model.length > 0
      ? candidate.model
      : candidate.engine;
    const runner = typeof candidate.runner === 'string' && candidate.runner.length > 0
      ? candidate.runner
      : 'unresolved';
    const effort = typeof candidate.effort === 'string' && candidate.effort.length > 0
      ? candidate.effort
      : 'unknown';
    const endpoint = candidate.endpoint === undefined ? null : candidate.endpoint;
    const complete = typeof model === 'string'
      && model.length > 0
      && /^(?:codex|agy|grok|cc-shim|anthropic-compatible|claude-native|qoderclicn)$/.test(runner)
      && /^(?:low|medium|high|xhigh|max)$/.test(effort)
      && (endpoint === null
        || (typeof endpoint === 'string' && /^[A-Za-z0-9_]+$/.test(endpoint)));
    const boundTuple = providerTuple(
      'reviewer',
      complete ? runner : 'unresolved',
      typeof model === 'string' && model.length > 0 ? model : 'unresolved-model',
      complete ? effort : 'unknown',
      complete ? endpoint : null,
    );
    const key = JSON.stringify(boundTuple);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      family: typeof candidate.family === 'string' && candidate.family.length > 0
        ? candidate.family
        : familyOf(model),
      tuple: boundTuple,
      observations: complete
        ? { qualification: qualificationObservation(boundTuple, now, ttlSeconds) }
        : missingExactTupleObservation(boundTuple, now),
    });
  }
  return output;
}

function buildSelectedRoster(
  resolved,
  now,
  ttlSeconds = DEFAULT_RECEIPT_TTL_SECONDS,
) {
  const seats = [
    {
      seat_id: 'implementer',
      required: true,
      family: resolved.implementer_family || familyOf(resolved.implementer_engine),
      tuple: providerTuple(
        'implementer',
        resolved.implementer_runner,
        resolved.implementer_engine,
        resolved.implementer_effort,
        resolved.implementer_endpoint,
      ),
      observations: {},
      fallbacks: [],
    },
    {
      seat_id: 'reviewer',
      required: true,
      family: familyOf(resolved.reviewer_engine),
      tuple: providerTuple(
        'reviewer',
        resolved.reviewer_runner,
        resolved.reviewer_engine,
        resolved.reviewer_effort,
        resolved.reviewer_endpoint,
      ),
      observations: {},
      fallbacks: [],
    },
  ];
  if (resolved.verification_author_present) {
    seats.push({
      seat_id: 'verification_author',
      required: true,
      family: resolved.verification_author_family
        || familyOf(resolved.verification_author_engine),
      tuple: providerTuple(
        'verification_author',
        resolved.verification_author_runner,
        resolved.verification_author_engine,
        resolved.verification_author_effort,
        resolved.verification_author_endpoint,
      ),
      observations: {},
      fallbacks: [],
    });
  }
  const reviewer = seats.find((seat) => seat.seat_id === 'reviewer');
  reviewer.fallbacks = reviewerFallbacks(
    resolved,
    reviewer.tuple,
    now,
    ttlSeconds,
  );

  if (resolved.qc_panel_seats_complete === true && Array.isArray(resolved.qc_panel_seats)) {
    for (const [index, qcSeat] of resolved.qc_panel_seats.entries()) {
      seats.push({
        seat_id: `qc:${index + 1}`,
        required: true,
        family: qcSeat.family,
        tuple: {
          role: 'qc',
          runner: qcSeat.runner,
          model: qcSeat.model,
          effort: qcSeat.effort,
          endpoint: qcSeat.endpoint,
        },
        observations: {},
        fallbacks: [],
      });
    }
  } else {
    for (const [index, model] of (resolved.qc_panel || []).entries()) {
      const unresolvedTuple = providerTuple('qc', 'unresolved', model, 'unknown', null);
      seats.push({
        seat_id: `qc:${index + 1}`,
        required: true,
        family: familyOf(model),
        tuple: unresolvedTuple,
        observations: missingExactTupleObservation(unresolvedTuple, now),
        fallbacks: [],
      });
    }
  }
  return seats;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || '').trim());
  } catch (_error) {
    return null;
  }
}

function capabilityObservation(boundTuple, now, options = {}) {
  const args = [
    CAPABILITY_STATE,
    'current',
    '--runner', boundTuple.runner,
    '--model', boundTuple.model,
    '--role', boundTuple.role,
    '--effort', boundTuple.effort,
    '--endpoint', boundTuple.endpoint === null ? '@none' : boundTuple.endpoint,
    '--role-scope', 'exact',
    '--now', now,
  ];
  if (options.store) args.push('--store', options.store);
  const child = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
  });
  if (child.error || child.status !== 0) {
    const error = new Error('provider readiness capability-state read failed');
    error.code = 'provider_readiness_capability_state_unavailable';
    throw error;
  }
  const current = parseJson(child.stdout);
  if (!current
      || current.runner !== boundTuple.runner
      || current.model !== boundTuple.model
      || current.role !== boundTuple.role
      || current.effort !== boundTuple.effort
      || current.effort_binding !== 'exact'
      || current.endpoint !== boundTuple.endpoint
      || current.endpoint_binding !== 'exact') {
    const error = new Error('provider readiness capability-state identity mismatch');
    error.code = 'provider_readiness_capability_state_mismatch';
    throw error;
  }
  const quota = current && current.capability && current.capability.quota;
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) {
    const error = new Error('provider readiness capability-state quota is malformed');
    error.code = 'provider_readiness_capability_state_malformed';
    throw error;
  }
  if (quota.observed_at === null) {
    return undefined;
  }
  if (typeof quota.observed_at !== 'string'
      || !Number.isSafeInteger(quota.ttl_seconds)
      || quota.ttl_seconds < 1) {
    const error = new Error('provider readiness capability-state provenance is malformed');
    error.code = 'provider_readiness_capability_state_malformed';
    throw error;
  }
  const observedMs = Date.parse(quota.observed_at);
  if (!Number.isFinite(observedMs)) {
    const error = new Error('provider readiness capability-state timestamp is malformed');
    error.code = 'provider_readiness_capability_state_malformed';
    throw error;
  }
  let status = 'unknown';
  let reason = 'live_unknown';
  if (quota.status === 'available') {
    status = 'ready';
    reason = null;
  } else if (quota.status === 'exhausted') {
    status = 'blocked';
    reason = 'quota_exhausted';
  } else if (quota.status === 'limited') {
    status = 'blocked';
    reason = 'rate_limited';
  }
  return {
    schema_version: 1,
    artifact_type: 'provider_axis_observation',
    tuple: boundTuple,
    axis: 'live',
    status,
    observed_at: new Date(observedMs).toISOString(),
    ttl_seconds: quota.ttl_seconds,
    evidence_class: typeof quota.evidence === 'string'
      && quota.evidence.startsWith('provider_live_probe.')
      ? 'live-probe'
      : 'capability-state',
    reason,
  };
}

function addQualificationObservations(seats, provider, now, ttlSeconds) {
  for (const seat of seats) {
    delete seat.observations.qualification;
    for (const fallback of seat.fallbacks || []) delete fallback.observations.qualification;
  }
  if (!provider) return;
  for (const seat of seats) {
    const observation = qualifyExactRoleNow(provider, seat.tuple, now, ttlSeconds);
    if (observation) seat.observations.qualification = observation;
    for (const fallback of seat.fallbacks || []) {
      const fallbackObservation = qualifyExactRoleNow(
        provider,
        fallback.tuple,
        now,
        ttlSeconds,
      );
      if (fallbackObservation) fallback.observations.qualification = fallbackObservation;
    }
  }
}

function collectCandidateObservation(candidate, now, options) {
  const live = capabilityObservation(candidate.tuple, now, {
    env: options.env,
    store: options.store,
  });
  if (live) candidate.observations.live = live;
}

function probeCandidate(candidate, now, ttlSeconds, options) {
  const result = runProviderProbe({
    tuple: candidate.tuple,
    now,
    ttl_seconds: ttlSeconds,
    ...(options.store ? { store: options.store } : {}),
  }, {
    liveProbe: options.liveProbe || dispatchAuthorLiveProbe,
  });
  candidate.observations.transport = result.transport_observation;
  if (result.live_observation) candidate.observations.live = result.live_observation;
}

function collectProviderReadiness(options = {}) {
  const cwd = options.cwd || process.cwd();
  const now = options.now || new Date().toISOString();
  const env = options.env || process.env;
  const probe = options.probe === true;
  const resolvedResult = resolveReviewLoopJson(['--check-scorecard'], {
    cwd,
    env,
  });
  if (resolvedResult.error
      || resolvedResult.status !== 0
      || resolvedResult.parseError
      || !resolvedResult.result) {
    const error = new Error('provider readiness roster resolution failed');
    error.code = 'provider_readiness_roster_unavailable';
    throw error;
  }
  const resolved = resolvedResult.result;
  const ttlSeconds = Number.isSafeInteger(resolved.provider_readiness_receipt_ttl_seconds)
    ? resolved.provider_readiness_receipt_ttl_seconds
    : DEFAULT_RECEIPT_TTL_SECONDS;
  const policy = {
    receipt_ttl_seconds: ttlSeconds,
    fallback_family_constraint:
      resolved.provider_readiness_fallback_family_constraint || 'different',
  };
  const roster = buildSelectedRoster(resolved, now, ttlSeconds);
  // Disk scorecards and transport probes are telemetry only. Qualification is
  // admitted exclusively through a live, non-serializable host provider.
  addQualificationObservations(
    roster,
    options.qualificationProvider,
    now,
    ttlSeconds,
  );

  for (const seat of roster) {
    if (seat.tuple.runner === 'unresolved') continue;
    collectCandidateObservation(seat, now, {
      env,
      store: options.store,
    });
    if (!probe) continue;
    probeCandidate(seat, now, ttlSeconds, {
      store: options.store,
      liveProbe: options.liveProbe || dispatchAuthorLiveProbe,
    });
  }

  if (probe) {
    for (const seat of roster) {
      const primary = evaluateProviderReadiness({
        tuple: seat.tuple,
        observations: seat.observations,
        now,
      });
      if (primary.blocking_reasons.length === 0) continue;
      for (const fallback of seat.fallbacks) {
        if (fallback.tuple.runner === 'unresolved') continue;
        if (policy.fallback_family_constraint === 'different'
            && (seat.family === 'unknown'
              || fallback.family === 'unknown'
              || seat.family === fallback.family)) {
          continue;
        }
        if (!fallback.observations.qualification
            || fallback.observations.qualification.status !== 'ready') {
          continue;
        }
        collectCandidateObservation(fallback, now, {
          env,
          store: options.store,
        });
        probeCandidate(fallback, now, ttlSeconds, {
          store: options.store,
          liveProbe: options.liveProbe || dispatchAuthorLiveProbe,
        });
        const decision = evaluateProviderReadiness({
          tuple: fallback.tuple,
          observations: fallback.observations,
          now,
        });
        if (decision.usable_now) break;
      }
    }
  }

  return createProviderReadinessReceipt({
    roster,
    policy,
    now,
  });
}

module.exports = {
  buildSelectedRoster,
  collectProviderReadiness,
  familyOf,
  resolveConfiguredRunner,
};
