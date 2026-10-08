'use strict';

// Authenticated control authority for the Mission Convergence Supervisor.
//
// Architectural contract (v1):
//   * The adapter is a verifier bridge: the only path from a raw control event
//     to a canonical control event is `acceptEvent`, and that path MUST call
//     a host-injected, non-serializable verifier callback bound at adapter
//     construction. The constructor verifier is authoritative: acceptEvent
//     ignores any caller-supplied verifier override.
//   * A successful acceptEvent freezes the canonical event object and records
//     its OBJECT IDENTITY in a module-private WeakSet. The adapter never
//     hands out a capability/token/getter. The canonical event is the only
//     bearer of authority.
//   * The reducer-facing surface is a single narrow function
//     `consumeAuthenticatedControlEvent(event)` that:
//       1. checks the object is the exact frozen object currently in the
//          module-private WeakSet (object identity, not field match);
//       2. atomically REMOVES the entry (single-use);
//       3. returns a sanitized, deep-frozen semantic snapshot.
//     Copying fields, Reflect.ownKeys, JSON roundtrip, reusing a receipt,
//     or replaying an already-consumed canonical event all fail closed:
//     the WeakSet entry is gone or never existed, so consume returns
//     `{ ok: false, reason: 'unauthenticated' }`.
//   * No public symbol, token, mint function, or registry is exposed. The
//     registry is closure-private; no caller can add or inspect entries.
//   * The adapter normalizes the event (shape, lineage, action, sequence)
//     and attaches an `event_digest`. The adapter does NOT apply semantic
//     policy (e.g. ceiling loosening). That is the reducer's job.
//
// No fixture-answer code lives in this module. The legacy
// `evaluateAuthenticatedControlFixture` switch is GONE — the state machine in
// `mission-convergence.js` is the only source of truth.

const crypto = require('crypto');

const CONTROL_SCHEMA_VERSION = 1;
const CONTROL_ACTIONS = Object.freeze([
  'ceiling_adjust',
  'scope_frozen',
  'finish_requested',
  'abort_requested',
]);
const CONTROL_ACTION_SET = new Set(CONTROL_ACTIONS);
const CONTROL_AUTHORITIES = Object.freeze([
  'authenticated_user',
  'authenticated_doa',
  'agent',
  'owner_kernel',
]);
const AUTHENTICATED_AUTHORITY_SET = new Set([
  'authenticated_user',
  'authenticated_doa',
]);
const CEILING_LOOSEN_AUTHORITIES = new Set([
  'authenticated_user',
  'authenticated_doa',
]);
const TERMINAL_TRIGGER_ACTIONS = new Set([
  'finish_requested',
  'abort_requested',
]);
// Stable reason tokens returned by the verifier or by the reducer sequence
// check. The adapter never falls back to a literal string outside this set.
const REJECTION_REASONS = Object.freeze({
  AUTHENTICATED_CONTROL_INVALID: 'authenticated_control_input_invalid',
  AUTHENTICATED_CONTROL_VERIFIER_MISSING: 'authenticated_control_verifier_missing',
  AUTHENTICATED_CONTROL_VERIFIER_NON_SERIALIZABLE: 'authenticated_control_verifier_non_serializable',
  AUTHENTICATED_CONTROL_VERIFIER_REJECTED: 'authenticated_control_verifier_rejected',
  AUTHENTICATED_CONTROL_AUTHORITY_OVERRIDE_MISMATCH: 'authenticated_control_authority_override_mismatch',
  CONTROL_SEQUENCE_STALE: 'control_sequence_stale',
  CEILING_LOOSEN_UNAUTHORIZED: 'ceiling_loosen_unauthorized',
});
const REJECTION_REASON_SET = new Set(Object.values(REJECTION_REASONS));

class AuthenticatedControlError extends Error {
  constructor(message, code = REJECTION_REASONS.AUTHENTICATED_CONTROL_INVALID) {
    super(message);
    this.name = 'AuthenticatedControlError';
    this.code = code;
  }
}

function fail(message, code = REJECTION_REASONS.AUTHENTICATED_CONTROL_INVALID) {
  throw new AuthenticatedControlError(message, code);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  return value;
}

function requireNonEmptyString(value, label, max = 4096) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail(`${label} must be a non-empty string no longer than ${max} characters`);
  }
  return value;
}

function requireProtocolToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    fail(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !/Z$/.test(value)) {
    fail(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return parsed.toISOString();
}

function canonicalJson(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  // Symbols and functions are non-serializable by design. They must never
  // reach a digest or a serialized channel — fail closed rather than
  // fabricate a string representation.
  fail('canonicalJson: unsupported type');
}

function sha256(value) {
  const source = typeof value === 'string' ? value : canonicalJson(value);
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function requireShape(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unsupported key "${key}"`);
  }
}

function requireLineageId(value, label) {
  requireNonEmptyString(value, label, 256);
  if (!/^lineage-v1-[0-9a-f]{64}$/.test(value)) {
    fail(`${label} must match lineage-v1-{sha256}`);
  }
  return value;
}

function requireStableReason(value, label) {
  requireNonEmptyString(value, label, 128);
  if (!REJECTION_REASON_SET.has(value)) {
    fail(`${label} must be a stable reason token drawn from the protocol set`);
  }
  return value;
}

function normalizeAxisUsage(raw, label) {
  if (raw === null || raw === undefined) return null;
  requireObject(raw, label);
  requireShape(raw, new Set(['axis', 'authorized_ceiling', 'known']), label);
  requireProtocolToken(raw.axis, `${label}.axis`);
  requireInteger(raw.authorized_ceiling, `${label}.authorized_ceiling`, 0);
  if (typeof raw.known !== 'boolean') fail(`${label}.known must be boolean`);
  return {
    axis: raw.axis,
    authorized_ceiling: raw.authorized_ceiling,
    known: raw.known,
  };
}

function normalizeControlEvent(raw) {
  const value = requireObject(raw, 'authenticated control event');
  requireShape(
    value,
    new Set([
      'mission_lineage_id',
      'action',
      'authority',
      'sequence',
      'issued_at',
      'reason',
      'ceiling_before',
      'ceiling_after',
    ]),
    'authenticated control event',
  );
  const action = requireProtocolToken(value.action, 'authenticated control event.action');
  if (!CONTROL_ACTION_SET.has(action)) {
    fail(`authenticated control event.action "${action}" is not a known control action`);
  }
  const authority = requireProtocolToken(value.authority, 'authenticated control event.authority');
  if (!CONTROL_AUTHORITIES.includes(authority)) {
    fail(`authenticated control event.authority must be one of ${CONTROL_AUTHORITIES.join(', ')}`);
  }
  if (action !== 'ceiling_adjust') {
    if (value.ceiling_before !== undefined && value.ceiling_before !== null) {
      fail('authenticated control event.ceiling_before is only allowed for ceiling_adjust');
    }
    if (value.ceiling_after !== undefined && value.ceiling_after !== null) {
      fail('authenticated control event.ceiling_after is only allowed for ceiling_adjust');
    }
  }
  const event = {
    mission_lineage_id: requireLineageId(
      value.mission_lineage_id,
      'authenticated control event.mission_lineage_id',
    ),
    action,
    authority,
    sequence: requireInteger(value.sequence, 'authenticated control event.sequence', 1),
    issued_at: requireIsoTimestamp(
      value.issued_at,
      'authenticated control event.issued_at',
    ),
    reason: requireNonEmptyString(
      value.reason,
      'authenticated control event.reason',
      4096,
    ),
    ceiling_before: action === 'ceiling_adjust'
      ? normalizeAxisUsage(value.ceiling_before, 'authenticated control event.ceiling_before')
      : null,
    ceiling_after: action === 'ceiling_adjust'
      ? normalizeAxisUsage(value.ceiling_after, 'authenticated control event.ceiling_after')
      : null,
  };
  event.event_digest = sha256({
    mission_lineage_id: event.mission_lineage_id,
    action: event.action,
    authority: event.authority,
    sequence: event.sequence,
    issued_at: event.issued_at,
    reason: event.reason,
    ceiling_before: event.ceiling_before,
    ceiling_after: event.ceiling_after,
  });
  return event;
}

// ─── Verifier gating ───────────────────────────────────────────────────────
//
// A non-serializable verifier is required. We accept exactly:
//   * a `function` value, or
//   * an object exposing a synchronous `verify(rawEvent)` method.
//
// Plain JSON objects, strings, numbers, and undefined are rejected. The check
// is structural — functions and methods do not survive `JSON.stringify`, so
// the verifier cannot be smuggled through a serializable channel.

function isNonSerializableVerifier(candidate) {
  if (typeof candidate === 'function') return true;
  if (candidate && typeof candidate === 'object'
    && Object.getPrototypeOf(candidate) !== Object.prototype
    && Object.getPrototypeOf(candidate) !== null) {
    return typeof candidate.verify === 'function';
  }
  return false;
}

function validateVerifier(verifier, label) {
  if (verifier === undefined || verifier === null) {
    fail(`${label} is required: pass a non-serializable verifier callback`, REJECTION_REASONS.AUTHENTICATED_CONTROL_VERIFIER_MISSING);
  }
  if (!isNonSerializableVerifier(verifier)) {
    fail(
      `${label} must be a non-serializable verifier (function or object with a verify method); plain JSON objects are not accepted`,
      REJECTION_REASONS.AUTHENTICATED_CONTROL_VERIFIER_NON_SERIALIZABLE,
    );
  }
  return verifier;
}

function invokeVerifier(verifier, rawEvent) {
  if (typeof verifier === 'function') return verifier(rawEvent);
  return verifier.verify(rawEvent);
}

// ─── Module-private event-identity registry ────────────────────────────────
//
// The WeakSet stores the exact frozen canonical-event object identity minted
// by a successful `acceptEvent` call. It is closed over the module exports
// and is NEVER exported: no caller can `add`, `has`, or `delete` entries
// directly, and no caller can iterate. Object identity is the only
// authentication key — a copied object, a JSON roundtrip, a Reflect.ownKeys
// snapshot, or a previously-consumed canonical event all fail `consume`
// because none of them are the exact frozen object the registry holds.
//
// Note: WeakSet keys must be objects (the spec disallows primitives). The
// canonical event is always a frozen object, so this is the right primitive.
// The previous design's "Symbol in WeakSet" was a Node-version-specific
// accident — Symbols are primitives per spec, and a stricter runtime would
// have rejected it silently. The new design uses object identity, which is
// both spec-correct and matches the host-boundary attestation model.

const AUTHENTICATED_EVENT_REGISTRY = new WeakSet();

function recordCanonicalEvent(canonical) {
  AUTHENTICATED_EVENT_REGISTRY.add(canonical);
  return canonical;
}

function registryHas(canonical) {
  return AUTHENTICATED_EVENT_REGISTRY.has(canonical);
}

function registryDelete(canonical) {
  return AUTHENTICATED_EVENT_REGISTRY.delete(canonical);
}

// ─── Adapter ───────────────────────────────────────────────────────────────

class AuthenticatedControlAdapter {
  constructor({ source, verifier } = {}) {
    // The verifier is mandatory at construction. The adapter cannot be built
    // without a non-serializable verifier, so there is no path by which a
    // caller can construct an adapter and then synthesize authority events
    // out of thin air.
    this.source = typeof source === 'string' && source.length > 0
      ? source
      : 'host-boundary';
    this._verifier = validateVerifier(verifier, 'AuthenticatedControlAdapter.verifier');
  }

  get verifier() {
    return this._verifier;
  }

  // The ONLY path from a raw event to a canonical event. The constructor
  // verifier is authoritative: any extra arguments (a "verifier override",
  // a "policy hint", etc.) are ignored. The caller cannot bypass the host
  // verifier by passing a second function — only the constructor-bound
  // verifier runs.
  acceptEvent(rawEvent) {
    if (!isPlainObject(rawEvent)) {
      fail('acceptEvent requires a raw event object', REJECTION_REASONS.AUTHENTICATED_CONTROL_INVALID);
    }
    const decision = invokeVerifier(this._verifier, rawEvent);
    if (!isPlainObject(decision)) {
      fail('verifier must return a plain object decision', REJECTION_REASONS.AUTHENTICATED_CONTROL_INVALID);
    }
    if (decision.verified === true) {
      if (typeof decision.authority === 'string'
        && decision.authority !== rawEvent.authority) {
        fail(
          'verifier authority override must match the raw event authority',
          REJECTION_REASONS.AUTHENTICATED_CONTROL_AUTHORITY_OVERRIDE_MISMATCH,
        );
      }
      const canonical = normalizeControlEvent(rawEvent);
      // Freeze the canonical event so its identity is stable for the
      // registry check. Object.freeze is irreversible from the caller's
      // perspective; combined with the WeakSet, it gives single-use
      // event-identity attestation: a caller that mutates a copy, fields,
      // or JSON-roundtrips the event cannot produce an object the
      // registry still holds.
      Object.freeze(canonical);
      recordCanonicalEvent(canonical);
      return canonical;
    }
    const reason = requireStableReason(
      decision.reason || REJECTION_REASONS.AUTHENTICATED_CONTROL_VERIFIER_REJECTED,
      'verifier decision.reason',
    );
    fail(
      `verifier rejected the event: ${reason}`,
      reason,
    );
  }
}

// ─── Reducer-facing single-use consume ─────────────────────────────────────
//
// This is the ONLY exported function that authenticates a canonical event
// for the reducer. It returns a sanitized deep-frozen semantic snapshot —
// the original canonical event stays in the caller's hands (now "spent"),
// but the registry entry has been removed. Replaying the same canonical
// event against `consume` returns `{ ok: false, reason: 'unauthenticated' }`.
//
// Snapshot shape (no symbols, no functions, no provenance fields):
//   {
//     mission_lineage_id, action, authority, sequence, issued_at, reason,
//     ceiling_before, ceiling_after, event_digest,
//   }
// The snapshot is the only event-shaped object that may enter state.events,
// receipts, projections, or digest inputs.

function buildSanitizedSnapshot(canonical) {
  let ceilingBefore = null;
  let ceilingAfter = null;
  if (canonical.ceiling_before) {
    ceilingBefore = Object.freeze({
      axis: canonical.ceiling_before.axis,
      authorized_ceiling: canonical.ceiling_before.authorized_ceiling,
      known: canonical.ceiling_before.known,
    });
  }
  if (canonical.ceiling_after) {
    ceilingAfter = Object.freeze({
      axis: canonical.ceiling_after.axis,
      authorized_ceiling: canonical.ceiling_after.authorized_ceiling,
      known: canonical.ceiling_after.known,
    });
  }
  return Object.freeze({
    mission_lineage_id: canonical.mission_lineage_id,
    action: canonical.action,
    authority: canonical.authority,
    sequence: canonical.sequence,
    issued_at: canonical.issued_at,
    reason: canonical.reason,
    ceiling_before: ceilingBefore,
    ceiling_after: ceilingAfter,
    event_digest: canonical.event_digest,
  });
}

function consumeAuthenticatedControlEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, reason: 'unauthenticated' };
  }
  if (!Object.isFrozen(event)) {
    return { ok: false, reason: 'unauthenticated' };
  }
  if (!registryHas(event)) {
    return { ok: false, reason: 'unauthenticated' };
  }
  // Single-use: remove the registry entry before returning the sanitized
  // snapshot. Any subsequent attempt to authenticate the same event — by
  // the reducer, by a re-driven replay, or by a forged second pass — will
  // see an empty registry slot and fail closed.
  registryDelete(event);
  return { ok: true, event: buildSanitizedSnapshot(event) };
}

// `isAuthenticatedAdapterCapability` is the narrow predicate the reducer
// still uses to decide whether a candidate object is "trusted" without
// consuming it. It returns true only for the exact frozen canonical object
// the registry holds at the time of the call. A capability-mint object
// field (a copied object, a forged `{ mint, symbol }`, a JSON roundtrip)
// has no identity in the WeakSet, so the predicate returns false.
//
// Note: this predicate does NOT remove the entry; that is
// `consumeAuthenticatedControlEvent`'s job. The reducer must consume — not
// merely predicate-check — before mutating state.
function isAuthenticatedAdapterCapability(candidate) {
  if (candidate === null || typeof candidate !== 'object') return false;
  if (Array.isArray(candidate)) return false;
  if (!Object.isFrozen(candidate)) return false;
  return registryHas(candidate);
}

// ─── Pure semantic helpers (no fixtures) ──────────────────────────────────

function verifySequence(event, options = {}) {
  const currentSequence = requireInteger(
    options.currentSequence,
    'verifySequence.currentSequence',
    0,
  );
  if (event.sequence < currentSequence) {
    return {
      ok: false,
      reason: REJECTION_REASONS.CONTROL_SEQUENCE_STALE,
      message: `effect_sequence ${event.sequence} precedes current_sequence ${currentSequence}`,
    };
  }
  return { ok: true };
}

function authorizeCeilingAdjust(event) {
  if (event.action !== 'ceiling_adjust') return { ok: true };
  const before = event.ceiling_before;
  const after = event.ceiling_after;
  if (!before || !after) {
    return {
      ok: false,
      reason: 'ceiling_axis_missing',
      message: 'ceiling_adjust requires both ceiling_before and ceiling_after',
    };
  }
  if (before.axis !== after.axis) {
    return {
      ok: false,
      reason: 'ceiling_axis_mismatch',
      message: 'ceiling_before.axis must equal ceiling_after.axis',
    };
  }
  const loosening = after.authorized_ceiling > before.authorized_ceiling;
  if (loosening && !CEILING_LOOSEN_AUTHORITIES.has(event.authority)) {
    return {
      ok: false,
      reason: REJECTION_REASONS.CEILING_LOOSEN_UNAUTHORIZED,
      message: `authority "${event.authority}" cannot loosen Mission ceilings`,
    };
  }
  return { ok: true };
}

function classifyControlEffect(event, options = {}) {
  const seqCheck = verifySequence(event, options);
  if (!seqCheck.ok) return seqCheck;
  const authCheck = authorizeCeilingAdjust(event);
  if (!authCheck.ok) return authCheck;
  return { ok: true };
}

module.exports = {
  AUTHENTICATED_AUTHORITY_SET,
  AuthenticatedControlAdapter,
  AuthenticatedControlError,
  CEILING_LOOSEN_AUTHORITIES,
  CONTROL_ACTIONS,
  CONTROL_ACTION_SET,
  CONTROL_AUTHORITIES,
  CONTROL_SCHEMA_VERSION,
  REJECTION_REASONS,
  REJECTION_REASON_SET,
  TERMINAL_TRIGGER_ACTIONS,
  authorizeCeilingAdjust,
  canonicalJson,
  classifyControlEffect,
  consumeAuthenticatedControlEvent,
  isAuthenticatedAdapterCapability,
  isNonSerializableVerifier,
  normalizeControlEvent,
  sha256,
  validateVerifier,
  verifySequence,
};
