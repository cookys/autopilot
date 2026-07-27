'use strict';

const crypto = require('crypto');
const {
  AXES,
  evaluateProviderReadiness,
  normalizeProviderTuple,
} = require('./provider-readiness');

const ROOT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'issued_at',
  'expires_at',
  'roster_digest',
  'policy_digest',
  'observation_digest',
  'overall_status',
  'seats',
  'receipt_digest',
]);
const POLICY_KEYS = new Set([
  'receipt_ttl_seconds',
  'fallback_family_constraint',
]);
const ROSTER_SEAT_KEYS = new Set([
  'seat_id',
  'required',
  'family',
  'tuple',
  'observations',
  'fallbacks',
]);
const ROSTER_FALLBACK_KEYS = new Set([
  'family',
  'tuple',
  'observations',
]);
const RECEIPT_SEAT_KEYS = new Set([
  'seat_id',
  'required',
  'family',
  'decision',
  'fallbacks',
  'selected',
  'status',
  'failing_axes',
]);
const RECEIPT_FALLBACK_KEYS = new Set([
  'order',
  'family',
  'eligible',
  'exclusion_reason',
  'decision',
]);
const SELECTED_KEYS = new Set([
  'source',
  'fallback_order',
  'family',
  'tuple',
]);
const FAILING_AXIS_KEYS = new Set(['axis', 'status', 'reason']);
const RECEIPT_TTL_MAX_SECONDS = 86400;
const STATUS_VALUES = new Set(['usable', 'probe-needed', 'blocked']);
const FAMILY_CONSTRAINTS = new Set(['any', 'different']);
const DIGEST_RE = /^[0-9a-f]{64}$/;
const CODE_RE = /^[A-Za-z0-9._:-]{1,128}$/;

class ProviderReadinessReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderReadinessReceiptError';
    this.code = code;
  }
}

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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function canonicalDigest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function boundedCode(value, label) {
  if (typeof value !== 'string' || !CODE_RE.test(value)) {
    throw new TypeError(`${label} must be a bounded classification code`);
  }
  return value;
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

function normalizePolicy(value) {
  exactKeys(value, POLICY_KEYS, 'provider readiness policy');
  if (!Number.isSafeInteger(value.receipt_ttl_seconds)
      || value.receipt_ttl_seconds < 1
      || value.receipt_ttl_seconds > RECEIPT_TTL_MAX_SECONDS) {
    throw new TypeError(
      `provider readiness receipt_ttl_seconds must be between 1 and ${RECEIPT_TTL_MAX_SECONDS}`,
    );
  }
  if (!FAMILY_CONSTRAINTS.has(value.fallback_family_constraint)) {
    throw new TypeError('provider readiness fallback_family_constraint is unsupported');
  }
  return {
    receipt_ttl_seconds: value.receipt_ttl_seconds,
    fallback_family_constraint: value.fallback_family_constraint,
  };
}

function normalizeFallback(value, primaryRole, index) {
  exactKeys(value, ROSTER_FALLBACK_KEYS, `provider readiness fallback ${index}`);
  const tuple = normalizeProviderTuple(value.tuple);
  if (tuple.role !== primaryRole) {
    throw new TypeError('provider readiness fallback role must match its primary seat');
  }
  if (!isRecord(value.observations)) {
    throw new TypeError('provider readiness fallback observations must be an object');
  }
  return {
    family: boundedCode(value.family, 'provider readiness fallback family'),
    tuple,
    observations: value.observations,
  };
}

function normalizeRoster(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('provider readiness roster must be a non-empty array');
  }
  const seenSeats = new Set();
  const seenTuples = new Set();
  return value.map((rawSeat, seatIndex) => {
    exactKeys(rawSeat, ROSTER_SEAT_KEYS, `provider readiness roster seat ${seatIndex}`);
    const seatId = boundedCode(rawSeat.seat_id, 'provider readiness seat_id');
    if (seenSeats.has(seatId)) {
      throw new TypeError('provider readiness roster contains a duplicate seat_id');
    }
    seenSeats.add(seatId);
    if (typeof rawSeat.required !== 'boolean') {
      throw new TypeError('provider readiness seat required must be boolean');
    }
    const tuple = normalizeProviderTuple(rawSeat.tuple);
    if (!isRecord(rawSeat.observations)) {
      throw new TypeError('provider readiness seat observations must be an object');
    }
    if (!Array.isArray(rawSeat.fallbacks)) {
      throw new TypeError('provider readiness seat fallbacks must be an array');
    }
    const fallbacks = rawSeat.fallbacks.map(
      (fallback, fallbackIndex) => normalizeFallback(
        fallback,
        tuple.role,
        fallbackIndex,
      ),
    );
    for (const candidate of [tuple, ...fallbacks.map((item) => item.tuple)]) {
      const tupleDigest = canonicalDigest(candidate);
      if (seenTuples.has(tupleDigest)) {
        throw new TypeError('provider readiness roster contains a duplicate exact tuple');
      }
      seenTuples.add(tupleDigest);
    }
    return {
      seat_id: seatId,
      required: rawSeat.required,
      family: boundedCode(rawSeat.family, 'provider readiness seat family'),
      tuple,
      observations: rawSeat.observations,
      fallbacks,
    };
  });
}

function rosterProjection(roster) {
  return roster.map((seat) => ({
    seat_id: seat.seat_id,
    required: seat.required,
    family: seat.family,
    tuple: seat.tuple,
    fallbacks: seat.fallbacks.map((fallback, index) => ({
      order: index + 1,
      family: fallback.family,
      tuple: fallback.tuple,
    })),
  }));
}

function evaluate(tuple, observations, now) {
  return evaluateProviderReadiness({ tuple, observations, now });
}

function familyAllowed(primaryFamily, fallbackFamily, policy) {
  if (policy.fallback_family_constraint === 'any') return true;
  return primaryFamily !== 'unknown'
    && fallbackFamily !== 'unknown'
    && primaryFamily !== fallbackFamily;
}

function selectedCandidate(source, fallbackOrder, family, tuple) {
  return {
    source,
    fallback_order: fallbackOrder,
    family,
    tuple,
  };
}

function buildReceiptSeat(seat, policy, now) {
  const decision = evaluate(seat.tuple, seat.observations, now);
  const evaluatedFallbacks = seat.fallbacks.map((fallback, index) => {
    const fallbackDecision = evaluate(fallback.tuple, fallback.observations, now);
    const allowed = familyAllowed(seat.family, fallback.family, policy);
    const eligible = allowed && fallbackDecision.usable_now;
    return {
      order: index + 1,
      family: fallback.family,
      eligible,
      exclusion_reason: eligible
        ? null
        : (allowed ? 'not_usable' : 'family_constraint'),
      decision: fallbackDecision,
    };
  });

  let selected = null;
  if (decision.usable_now) {
    selected = selectedCandidate('primary', null, seat.family, decision.tuple);
  } else if (decision.blocking_reasons.length > 0) {
    const firstEligible = evaluatedFallbacks.find((fallback) => fallback.eligible);
    if (firstEligible) {
      selected = selectedCandidate(
        'fallback',
        firstEligible.order,
        firstEligible.family,
        firstEligible.decision.tuple,
      );
    }
  }

  const status = selected
    ? 'usable'
    : (decision.probe_required ? 'probe-needed' : 'blocked');
  const eligibleFallbacks = evaluatedFallbacks.filter((fallback) => fallback.eligible);
  const failingAxes = AXES
    .filter((axis) => decision.axes[axis].status !== 'ready')
    .map((axis) => ({
      axis,
      status: decision.axes[axis].status,
      reason: decision.axes[axis].reason,
    }));

  return {
    seat_id: seat.seat_id,
    required: seat.required,
    family: seat.family,
    decision,
    fallbacks: eligibleFallbacks,
    selected,
    status,
    failing_axes: failingAxes,
  };
}

function overallStatus(seats) {
  const required = seats.filter((seat) => seat.required);
  if (required.some((seat) => seat.status === 'blocked')) return 'blocked';
  if (required.some((seat) => seat.status === 'probe-needed')) return 'probe-needed';
  return 'usable';
}

function observationProjection(seats) {
  return seats.map((seat) => ({
    seat_id: seat.seat_id,
    decision_digest: seat.decision.decision_digest,
    fallback_decision_digests: seat.fallbacks.map(
      (fallback) => fallback.decision.decision_digest,
    ),
  }));
}

function earliestFreshEvidenceExpiry(seats) {
  let earliest = null;
  const decisions = [];
  for (const seat of seats) {
    decisions.push(seat.decision);
    for (const fallback of seat.fallbacks) decisions.push(fallback.decision);
  }
  for (const decision of decisions) {
    for (const axis of AXES) {
      const observation = decision.axes[axis];
      if (observation.freshness !== 'fresh' || observation.observed_at === null) continue;
      const expires = Date.parse(observation.observed_at) + (observation.ttl_seconds * 1000);
      if (Number.isSafeInteger(expires) && (earliest === null || expires < earliest)) {
        earliest = expires;
      }
    }
  }
  return earliest;
}

function createProviderReadinessReceipt(input = {}) {
  if (!isRecord(input)
      || Object.keys(input).length !== 3
      || !Object.prototype.hasOwnProperty.call(input, 'roster')
      || !Object.prototype.hasOwnProperty.call(input, 'policy')
      || !Object.prototype.hasOwnProperty.call(input, 'now')) {
    throw new TypeError('provider readiness receipt input has an invalid shape');
  }
  const issuedMs = parseInstant(input.now, 'provider readiness receipt now');
  const policy = normalizePolicy(input.policy);
  const roster = normalizeRoster(input.roster);
  const policyExpiresMs = issuedMs + (policy.receipt_ttl_seconds * 1000);
  if (!Number.isSafeInteger(policyExpiresMs)) {
    throw new TypeError('provider readiness receipt expiry is outside the safe time range');
  }
  const seats = roster.map((seat) => buildReceiptSeat(seat, policy, input.now));
  const evidenceExpiresMs = earliestFreshEvidenceExpiry(seats);
  const expiresMs = evidenceExpiresMs === null
    ? policyExpiresMs
    : Math.min(policyExpiresMs, evidenceExpiresMs);
  const body = {
    schema_version: 1,
    artifact_type: 'provider_readiness_receipt',
    issued_at: input.now,
    expires_at: new Date(expiresMs).toISOString(),
    roster_digest: canonicalDigest(rosterProjection(roster)),
    policy_digest: canonicalDigest(policy),
    observation_digest: canonicalDigest(observationProjection(seats)),
    overall_status: overallStatus(seats),
    seats,
  };
  return {
    ...body,
    receipt_digest: canonicalDigest(body),
  };
}

function receiptError(code, message) {
  throw new ProviderReadinessReceiptError(code, message);
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) {
    receiptError('provider_readiness_receipt_invalid', `${label} must be a SHA-256 digest`);
  }
}

function validateReceiptShape(receipt) {
  try {
    exactKeys(receipt, ROOT_KEYS, 'provider readiness receipt');
  } catch (error) {
    receiptError('provider_readiness_receipt_invalid', error.message);
  }
  if (receipt.schema_version !== 1
      || receipt.artifact_type !== 'provider_readiness_receipt'
      || !STATUS_VALUES.has(receipt.overall_status)
      || !Array.isArray(receipt.seats)) {
    receiptError('provider_readiness_receipt_invalid', 'provider readiness receipt identity is invalid');
  }
  try {
    parseInstant(receipt.issued_at, 'provider readiness receipt issued_at');
    parseInstant(receipt.expires_at, 'provider readiness receipt expires_at');
  } catch (error) {
    receiptError('provider_readiness_receipt_invalid', error.message);
  }
  for (const [label, value] of [
    ['roster_digest', receipt.roster_digest],
    ['policy_digest', receipt.policy_digest],
    ['observation_digest', receipt.observation_digest],
    ['receipt_digest', receipt.receipt_digest],
  ]) {
    assertDigest(value, `provider readiness receipt ${label}`);
  }
  for (const [index, seat] of receipt.seats.entries()) {
    try {
      exactKeys(seat, RECEIPT_SEAT_KEYS, `provider readiness receipt seat ${index}`);
      boundedCode(seat.seat_id, 'provider readiness receipt seat_id');
      boundedCode(seat.family, 'provider readiness receipt seat family');
      if (typeof seat.required !== 'boolean'
          || !STATUS_VALUES.has(seat.status)
          || !Array.isArray(seat.fallbacks)
          || !Array.isArray(seat.failing_axes)) {
        throw new TypeError('provider readiness receipt seat has an invalid value');
      }
      if (seat.selected !== null) {
        exactKeys(seat.selected, SELECTED_KEYS, 'provider readiness selected candidate');
        normalizeProviderTuple(seat.selected.tuple);
      }
      for (const fallback of seat.fallbacks) {
        exactKeys(fallback, RECEIPT_FALLBACK_KEYS, 'provider readiness receipt fallback');
      }
      for (const failingAxis of seat.failing_axes) {
        exactKeys(failingAxis, FAILING_AXIS_KEYS, 'provider readiness receipt failing axis');
      }
    } catch (error) {
      receiptError('provider_readiness_receipt_invalid', error.message);
    }
  }
}

function validateProviderReadinessReceipt(receipt, context = {}) {
  validateReceiptShape(receipt);
  if (!isRecord(context)
      || Object.keys(context).length !== 3
      || !Object.prototype.hasOwnProperty.call(context, 'roster')
      || !Object.prototype.hasOwnProperty.call(context, 'policy')
      || !Object.prototype.hasOwnProperty.call(context, 'now')) {
    receiptError(
      'provider_readiness_receipt_invalid',
      'provider readiness receipt validation context has an invalid shape',
    );
  }

  let roster;
  let policy;
  let nowMs;
  try {
    roster = normalizeRoster(context.roster);
    policy = normalizePolicy(context.policy);
    nowMs = parseInstant(context.now, 'provider readiness receipt validation now');
  } catch (error) {
    receiptError('provider_readiness_receipt_invalid', error.message);
  }
  const expectedRosterDigest = canonicalDigest(rosterProjection(roster));
  if (receipt.roster_digest !== expectedRosterDigest) {
    receiptError(
      'provider_readiness_roster_drift',
      'provider readiness receipt roster does not match the expected exact roster',
    );
  }
  const expectedPolicyDigest = canonicalDigest(policy);
  if (receipt.policy_digest !== expectedPolicyDigest) {
    receiptError(
      'provider_readiness_policy_drift',
      'provider readiness receipt policy does not match the expected policy',
    );
  }

  const expectedSeatIds = roster.map((seat) => seat.seat_id);
  const receiptSeatIds = receipt.seats.map((seat) => seat.seat_id);
  if (canonicalDigest(receiptSeatIds) !== canonicalDigest(expectedSeatIds)) {
    receiptError(
      'provider_readiness_receipt_incomplete',
      'provider readiness receipt does not contain the complete ordered roster',
    );
  }

  const { receipt_digest: suppliedDigest, ...body } = receipt;
  if (canonicalDigest(body) !== suppliedDigest) {
    receiptError(
      'provider_readiness_receipt_content_mismatch',
      'provider readiness receipt digest does not match its content',
    );
  }

  const expected = createProviderReadinessReceipt({
    roster: context.roster,
    policy: context.policy,
    now: receipt.issued_at,
  });
  if (receipt.observation_digest !== expected.observation_digest) {
    receiptError(
      'provider_readiness_observation_drift',
      'provider readiness receipt observations do not match current evidence',
    );
  }
  if (receipt.receipt_digest !== expected.receipt_digest) {
    receiptError(
      'provider_readiness_receipt_content_mismatch',
      'provider readiness receipt decision content is not canonical',
    );
  }
  if (Date.parse(receipt.issued_at) > nowMs) {
    receiptError(
      'provider_readiness_receipt_not_yet_valid',
      'provider readiness receipt was issued in the future',
    );
  }
  if (Date.parse(receipt.expires_at) <= nowMs) {
    receiptError(
      'provider_readiness_receipt_expired',
      'provider readiness receipt has expired',
    );
  }
  return receipt;
}

function consumeProviderReadinessReceipt(receipt, context) {
  const validated = validateProviderReadinessReceipt(receipt, context);
  if (validated.overall_status === 'blocked') {
    receiptError(
      'provider_readiness_blocked',
      'provider readiness receipt contains a blocked required seat',
    );
  }
  if (validated.overall_status === 'probe-needed') {
    return {
      status: 'unknown',
      receipt_digest: validated.receipt_digest,
      selections: [],
    };
  }
  return {
    status: 'ready',
    receipt_digest: validated.receipt_digest,
    selections: validated.seats
      .filter((seat) => seat.selected !== null)
      .map((seat) => ({
        seat_id: seat.seat_id,
        required: seat.required,
        ...seat.selected,
      })),
  };
}

module.exports = {
  ProviderReadinessReceiptError,
  RECEIPT_TTL_MAX_SECONDS,
  canonicalDigest,
  consumeProviderReadinessReceipt,
  createProviderReadinessReceipt,
  validateProviderReadinessReceipt,
};
