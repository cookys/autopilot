'use strict';

const crypto = require('crypto');

const AXES = Object.freeze(['transport', 'live', 'qualification']);
const AXIS_SET = new Set(AXES);
const STATUSES = new Set(['ready', 'blocked', 'unknown']);
const TUPLE_KEYS = new Set(['role', 'runner', 'model', 'effort', 'endpoint']);
const ENDPOINT_NAME_RE = /^[A-Za-z0-9_]{1,128}$/;
const OBSERVATION_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'tuple',
  'axis',
  'status',
  'observed_at',
  'ttl_seconds',
  'evidence_class',
  'reason',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)
      || Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))) {
    throw new TypeError(`${label} must have the exact required fields`);
  }
}

function boundedToken(value, label) {
  if (typeof value !== 'string'
      || value.trim().length === 0
      || value !== value.trim()
      || value.length > 256
      || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function boundedCode(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string'
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new TypeError(`${label} must be a bounded classification code`);
  }
  return value;
}

function endpointName(value, label) {
  if (typeof value !== 'string' || !ENDPOINT_NAME_RE.test(value)) {
    throw new TypeError(`${label} must be a canonical endpoint name`);
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

function normalizeProviderTuple(value) {
  exactKeys(value, TUPLE_KEYS, 'provider tuple');
  const endpoint = value.endpoint === null
    ? null
    : endpointName(value.endpoint, 'provider tuple endpoint');
  return {
    role: boundedCode(value.role, 'provider tuple role'),
    runner: boundedCode(value.runner, 'provider tuple runner'),
    model: boundedToken(value.model, 'provider tuple model'),
    effort: boundedCode(value.effort, 'provider tuple effort'),
    endpoint,
  };
}

function providerTupleDigest(value) {
  return digest(normalizeProviderTuple(value));
}

function parseInstant(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp`);
  }
  const parsed = new Date(value);
  if (parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return parsed.getTime();
}

function sameTuple(left, right) {
  return providerTupleDigest(left) === providerTupleDigest(right);
}

function normalizeObservation(value, expectedTuple, expectedAxis, nowMs) {
  if (value === undefined) {
    return {
      status: 'unknown',
      observed_status: null,
      observed_at: null,
      ttl_seconds: 0,
      evidence_class: 'none',
      freshness: 'missing',
      reason: `missing_${expectedAxis}_observation`,
    };
  }
  exactKeys(value, OBSERVATION_KEYS, `${expectedAxis} observation`);
  if (value.schema_version !== 1
      || value.artifact_type !== 'provider_axis_observation'
      || value.axis !== expectedAxis
      || !AXIS_SET.has(value.axis)
      || !STATUSES.has(value.status)
      || !Number.isSafeInteger(value.ttl_seconds)
      || value.ttl_seconds < 0
      || (value.status === 'blocked' && value.reason === null)) {
    throw new TypeError(`${expectedAxis} observation has an invalid identity or value`);
  }
  boundedCode(value.evidence_class, `${expectedAxis} evidence_class`);
  boundedCode(value.reason, `${expectedAxis} reason`, true);
  if (!sameTuple(value.tuple, expectedTuple)) {
    throw new TypeError(`${expectedAxis} observation tuple does not match the selected tuple`);
  }
  const observedMs = parseInstant(value.observed_at, `${expectedAxis} observed_at`);
  const expiresMs = observedMs + (value.ttl_seconds * 1000);
  if (observedMs > nowMs || !Number.isSafeInteger(expiresMs)) {
    throw new TypeError(`${expectedAxis} observation has an invalid time window`);
  }
  const stale = expiresMs <= nowMs;
  return {
    status: stale ? 'unknown' : value.status,
    observed_status: stale ? value.status : null,
    observed_at: value.observed_at,
    ttl_seconds: value.ttl_seconds,
    evidence_class: value.evidence_class,
    freshness: stale ? 'stale' : 'fresh',
    reason: stale ? `stale_${expectedAxis}_observation` : (
      value.reason || (value.status === 'unknown' ? `${expectedAxis}_unknown` : null)
    ),
  };
}

function normalizeObservations(value, tuple, nowMs) {
  if (value === undefined) value = {};
  if (!isRecord(value)) throw new TypeError('provider observations must be an object');
  if (Object.keys(value).some((key) => !AXIS_SET.has(key))) {
    throw new TypeError('provider observations contain an unknown axis');
  }
  return Object.fromEntries(AXES.map((axis) => [
    axis,
    normalizeObservation(value[axis], tuple, axis, nowMs),
  ]));
}

function evaluateOne(tupleValue, observationsValue, now, nowMs) {
  const tuple = normalizeProviderTuple(tupleValue);
  const axes = normalizeObservations(observationsValue, tuple, nowMs);
  const blockingReasons = AXES
    .filter((axis) => axes[axis].status === 'blocked')
    .map((axis) => ({ axis, reason: axes[axis].reason }));
  const body = {
    schema_version: 1,
    artifact_type: 'provider_readiness_decision',
    tuple,
    tuple_digest: providerTupleDigest(tuple),
    observed_at: now,
    axes,
    usable_now: AXES.every((axis) => axes[axis].status === 'ready'),
    probe_required: AXES.some((axis) => axes[axis].status === 'unknown'),
    blocking_reasons: blockingReasons,
    fallbacks: [],
  };
  return {
    ...body,
    decision_digest: digest(body),
  };
}

function evaluateProviderReadiness(input = {}) {
  if (!isRecord(input)
      || Object.keys(input).some((key) => !new Set([
        'tuple',
        'observations',
        'now',
        'fallbacks',
      ]).has(key))) {
    throw new TypeError('provider readiness input has an invalid shape');
  }
  const nowMs = parseInstant(input.now, 'provider readiness now');
  const primary = evaluateOne(input.tuple, input.observations, input.now, nowMs);
  const rawFallbacks = input.fallbacks === undefined ? [] : input.fallbacks;
  if (!Array.isArray(rawFallbacks)) {
    throw new TypeError('provider readiness fallbacks must be an array');
  }
  const seen = new Set([primary.tuple_digest]);
  const eligible = [];
  for (const [index, rawFallback] of rawFallbacks.entries()) {
    if (!isRecord(rawFallback)
        || Object.keys(rawFallback).length !== 2
        || !Object.prototype.hasOwnProperty.call(rawFallback, 'tuple')
        || !Object.prototype.hasOwnProperty.call(rawFallback, 'observations')) {
      throw new TypeError(`provider readiness fallback ${index} has an invalid shape`);
    }
    const decision = evaluateOne(
      rawFallback.tuple,
      rawFallback.observations,
      input.now,
      nowMs,
    );
    if (seen.has(decision.tuple_digest)) {
      throw new TypeError('provider readiness contains a duplicate tuple');
    }
    seen.add(decision.tuple_digest);
    if (decision.usable_now) eligible.push(decision.tuple);
  }
  const { decision_digest: _priorDigest, ...body } = {
    ...primary,
    fallbacks: eligible,
  };
  return {
    ...body,
    decision_digest: digest(body),
  };
}

module.exports = {
  AXES,
  evaluateProviderReadiness,
  normalizeProviderTuple,
  providerTupleDigest,
};
