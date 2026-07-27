'use strict';

// Pure module: AuthenticatedControlAdapter interface and sequenced event
// validation for the Mission Convergence Supervisor. Host-injected; chat text
// alone has no authority. Model cannot forge boundary events.

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

class AuthenticatedControlError extends Error {
  constructor(message, code = 'AUTHENTICATED_CONTROL_INVALID') {
    super(message);
    this.name = 'AuthenticatedControlError';
    this.code = code;
  }
}

function fail(message, code = 'AUTHENTICATED_CONTROL_INVALID') {
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
  if (typeof value !== 'object' || Array.isArray(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
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

// Adapter contract: a host binding that returns verified control events.
// Production adapters are host-injected; chat text alone never produces one.
class AuthenticatedControlAdapter {
  constructor({ source } = {}) {
    this.source = typeof source === 'string' && source.length > 0
      ? source
      : 'host-boundary';
  }

  // acceptEvent returns the canonical event if the host marks it verified.
  acceptEvent(rawEvent) {
    return normalizeControlEvent(rawEvent);
  }

  issueCeilingAdjust({
    mission_lineage_id,
    sequence,
    issued_at,
    reason,
    ceiling_before,
    ceiling_after,
  }) {
    return normalizeControlEvent({
      mission_lineage_id,
      action: 'ceiling_adjust',
      authority: 'authenticated_user',
      sequence,
      issued_at,
      reason,
      ceiling_before,
      ceiling_after,
    });
  }

  issueTerminalTrigger({ mission_lineage_id, action, sequence, issued_at, reason }) {
    if (!TERMINAL_TRIGGER_ACTIONS.has(action)) {
      fail(`issueTerminalTrigger only accepts ${Array.from(TERMINAL_TRIGGER_ACTIONS).join(', ')}`);
    }
    return normalizeControlEvent({
      mission_lineage_id,
      action,
      authority: 'authenticated_user',
      sequence,
      issued_at,
      reason,
    });
  }

  issueScopeFrozen({ mission_lineage_id, sequence, issued_at, reason }) {
    return normalizeControlEvent({
      mission_lineage_id,
      action: 'scope_frozen',
      authority: 'authenticated_user',
      sequence,
      issued_at,
      reason,
    });
  }
}

function verifySequence(event, options = {}) {
  const currentSequence = requireInteger(
    options.currentSequence,
    'verifySequence.currentSequence',
    0,
  );
  if (event.sequence < currentSequence) {
    return {
      ok: false,
      reason: 'control_sequence_stale',
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
      reason: 'ceiling_loosen_unauthorized',
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

// Pure reducer adapter used by evaluateMissionReducerFixture:
// evaluates ceiling_adjust / control / shadow_would_block fixtures.
function evaluateAuthenticatedControlFixture(input) {
  if (!isPlainObject(input)) {
    return { error: 'authenticated_control_input_invalid' };
  }
  if (input.kind === 'ceiling_adjust') {
    const authority = input.authority;
    const oldCeiling = input.old;
    const nextCeiling = input.next;
    if (!CONTROL_AUTHORITIES.includes(authority)) {
      return { error: 'authenticated_control_authority_unknown' };
    }
    if (typeof oldCeiling !== 'number' || typeof nextCeiling !== 'number') {
      return { error: 'ceiling_axis_invalid' };
    }
    const loosening = nextCeiling > oldCeiling;
    if (loosening && !CEILING_LOOSEN_AUTHORITIES.has(authority)) {
      return { error: 'ceiling_loosen_unauthorized' };
    }
    return {
      ok: true,
      authority,
      direction: loosening ? 'loosen' : 'tighten',
      ceiling_before: { axis: input.axis || 'tool_calls', authorized_ceiling: oldCeiling, known: true },
      ceiling_after: { axis: input.axis || 'tool_calls', authorized_ceiling: nextCeiling, known: true },
    };
  }
  if (input.kind === 'control') {
    const currentSequence = Number.isSafeInteger(input.current_sequence)
      ? input.current_sequence
      : 0;
    const effectSequence = Number.isSafeInteger(input.effect_sequence)
      ? input.effect_sequence
      : 0;
    if (effectSequence < currentSequence) {
      return {
        state: 'CLOSING',
        reason: 'control_sequence_stale',
        effect_sequence: effectSequence,
        current_sequence: currentSequence,
      };
    }
    if (input.action === 'finish_requested') {
      return { state: 'CLOSING', reason: 'finish_requested' };
    }
    if (input.action === 'abort_requested') {
      return { state: 'ABORTING', reason: 'abort_requested' };
    }
    if (input.action === 'scope_frozen') {
      return { state: 'CLOSING', reason: 'scope_frozen' };
    }
    return { ok: true };
  }
  if (input.kind === 'shadow_would_block') {
    return { effect_allowed: true, would_block: true };
  }
  return { error: 'authenticated_control_kind_unknown' };
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
  TERMINAL_TRIGGER_ACTIONS,
  authorizeCeilingAdjust,
  canonicalJson,
  classifyControlEffect,
  evaluateAuthenticatedControlFixture,
  normalizeControlEvent,
  sha256,
  verifySequence,
};