'use strict';

// Authenticated control authority for the Mission Convergence Supervisor.
//
// Architectural contract (v1):
//   * The adapter is a verifier bridge: the only path from a raw control event
//     to a canonical control event is `acceptEvent`, and that path must call a
//     host-injected, non-serializable verifier callback. The adapter never
//     fabricates an `authority` field on its own; arbitrary callers cannot
//     mint `authenticated_user` events by calling helper methods.
//   * The verifier is non-serializable on purpose. A plain JSON object
//     verifier is rejected: the only accepted shapes are `function` values
//     (including arrow functions, async functions, and bound methods) and
//     object values that expose a synchronous `verify(rawEvent)` method
//     whose presence is itself a non-serializable marker (functions and
//     methods are not preserved by `JSON.stringify`).
//   * The verifier returns a verdict:
//        { verified: true,  authority }            // accept, optional authority
//                                                   // override must match event
//        { verified: false, reason }              // reject with stable reason
//     The reason, when present, is a bounded protocol token drawn from a known
//     set; the adapter does not invent a fallback string.
//   * The adapter normalizes the event (shape, lineage, action, sequence) and
//     attaches an `event_digest`. The adapter does NOT apply semantic policy
//     (e.g. ceiling loosening). That is the reducer's job. Two-layer
//     separation: verifier = source authenticity; reducer = state semantics.
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
  // Symbols and functions are non-serializable by design (the adapter
  // capability is a symbol). They must never reach a digest or a serialized
  // channel — fail closed rather than fabricate a string representation.
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
    // Class instance or exotic object: method presence is the marker.
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

// ─── Adapter ───────────────────────────────────────────────────────────────

// The capability registry is module-private. It is NEVER exported: no caller
// can obtain the WeakSet, so no caller can `add` an arbitrary capability and
// forge adapter authority. The only public surface is the narrow predicate
// `isAuthenticatedAdapterCapability`, whose closure owns the private WeakSet
// and answers a single yes/no validation question for the reducer.
const ADAPTER_CAPABILITY_REGISTRY = new WeakSet();

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
    // Mint an unforgeable process-local capability. The capability is the
    // ONLY way an event can acquire authenticated_user/DOA authority over
    // the reducer. The symbol lives in a WeakSet keyed by the adapter
    // instance; serialization (JSON.stringify) drops the symbol, so the
    // capability cannot travel through a serializable channel. The
    // capability object intentionally holds NO reference back to the
    // adapter instance — that would create a self-cycle in any caller
    // that serializes the canonical event.
    this._capabilitySymbol = Symbol('AuthenticatedControlAdapter.capability');
    ADAPTER_CAPABILITY_REGISTRY.add(this._capabilitySymbol);
    this._capability = Object.freeze({
      mint: 'AuthenticatedControlAdapter',
      symbol: this._capabilitySymbol,
    });
  }

  get verifier() {
    return this._verifier;
  }

  get capability() {
    return this._capability;
  }

  // The ONLY path from a raw event to a canonical event. The verifier is the
  // gatekeeper. The adapter normalizes AFTER the verifier approves, so a
  // rejected event never reaches the reducer. `acceptEvent` does NOT allow
  // a caller to override the constructor-injected verifier — the verifier
  // is bound at adapter construction and is the only authority over the
  // adapter's canonicalization.
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
      // Attach the unforgeable capability as a NON-ENUMERABLE property so the
      // reducer can validate it via direct access, while JSON.stringify,
      // object spread, Object.keys, and canonicalJson all omit it. The
      // capability can never travel through a serializable channel or reach a
      // digest input.
      Object.defineProperty(canonical, '_adapter_capability', {
        value: this._capability,
        enumerable: false,
        writable: false,
        configurable: false,
      });
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

// ─── Pure semantic helpers (no fixtures) ──────────────────────────────────
//
// These functions encapsulate the semantic checks the reducer needs. They
// take already-normalized events and return either `{ ok: true }` or a stable
// rejection reason. They do NOT inspect raw event shapes (that is the
// adapter's job) and they do NOT contain a fixture dispatch.

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

function isAuthenticatedAdapterCapability(capability) {
  if (!capability || typeof capability !== 'object') return false;
  if (typeof capability.mint !== 'string') return false;
  if (typeof capability.symbol !== 'symbol') return false;
  return ADAPTER_CAPABILITY_REGISTRY.has(capability.symbol);
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
  isAuthenticatedAdapterCapability,
  isNonSerializableVerifier,
  normalizeControlEvent,
  sha256,
  validateVerifier,
  verifySequence,
};
