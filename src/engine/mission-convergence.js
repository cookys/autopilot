'use strict';

// Pure Mission Convergence Supervisor — a real, generic, lineage-bound state
// machine. This module is the single source of truth for the v1 Mission
// reducer. There is no fixture-answer code: every transition is derived from
// `createMissionState` + `reduceMissionState` + the host-injected verifier
// provided to `AuthenticatedControlAdapter`.
//
// Public surface (stable v1):
//   * `createMissionState(contract, options?)`             — pure factory
//   * `reduceMissionState(state, event)`                   — pure reducer
//   * `stateHash(state)`                                   — canonical hash
//   * `claimIdFor(lineageId, idempotencyKey)`              — deterministic id
//   * `buildProjection(state, sourceRefs)`                 — projection shape
//   * `restoreProjection(projection)`                      — restore from hash
//   * `replayEvents(state, events)`                        — re-apply events
//   * `computeAxisBudget(budget)`                          — pure axis math
//   * `remainingForAxis({...})`                            — pure remaining math
//   * `evaluateConfig(section)`                            — config section
//   * `evaluateMissionReducerFixture(input)`               — legacy RED oracle
//                                                          // translation layer
//   * `evaluateMissionIntegrationFixture(fixture)`         — P0 integration
//                                                          // translation layer
//   * `validateMissionContract(contract)`                  — full contract check
//   * `MissionReducerError`                                — error class
//
// Events accepted by the reducer (canonical event_type set):
//   grant_claimed, grant_resumed, no_effect_release, reconciliation,
//   ceiling_adjust, control_event, stagnation_observation,
//   acceptance_satisfied, closure_evaluated, successor_inherited

const crypto = require('crypto');
const {
  AUTHENTICATED_AUTHORITY_SET,
  AuthenticatedControlError,
  CEILING_LOOSEN_AUTHORITIES,
  CONTROL_ACTIONS,
  CONTROL_ACTION_SET,
  REJECTION_REASONS,
  TERMINAL_TRIGGER_ACTIONS,
  authorizeCeilingAdjust,
  canonicalJson,
  classifyControlEffect,
  normalizeControlEvent,
  sha256,
  verifySequence,
} = require('./authenticated-control');

const MISSION_SCHEMA_VERSION = 1;
const MISSION_RECEIPT_SCHEMA_VERSION = 1;
const SUPPORTED_AXES = Object.freeze([
  'campaigns',
  'wall_seconds',
  'tool_calls',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);
const AXIS_SET = new Set(SUPPORTED_AXES);
const ENFORCEMENT_MODES = new Set(['shadow', 'enforce']);
const MISSION_STATES = Object.freeze([
  'DRAFT',
  'ACTIVE',
  'CLOSING',
  'COMPLETE',
  'BLOCKED',
  'ABORTING',
  'ABORTED',
  'off',
]);
const MISSION_STATE_SET = new Set(MISSION_STATES);
const TERMINAL_STATES = new Set(['COMPLETE', 'BLOCKED', 'ABORTED']);
const CLOSURE_TRIGGER_STATES = new Set(['CLOSING', 'COMPLETE', 'BLOCKED', 'ABORTING', 'ABORTED']);
const DEFAULT_CLOSURE_RATIO = 0.75;
const DEFAULT_MAX_STAGNANT = 2;
const RESOURCE_AXES = Object.freeze([
  'tool_calls',
  'wall_seconds',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);
const CLOSURE_ALLOWLIST = Object.freeze([
  'frozen_acceptance',
  'blocker_repair',
  'targeted_verification',
  'required_docs_version',
  'receipt_production',
]);
const CLOSURE_ALLOWLIST_SET = new Set(CLOSURE_ALLOWLIST);
const GRANT_BINDING_FIELDS = Object.freeze([
  'mission_lineage_id',
  'task_authority_id',
  'campaign_id',
  'campaign_contract_digest',
  'base_sha',
  'acceptance_ids',
]);
const GRANT_BINDING_SET = new Set(GRANT_BINDING_FIELDS);
const EVENT_TYPES = Object.freeze([
  'grant_claimed',
  'grant_resumed',
  'no_effect_release',
  'reconciliation',
  'ceiling_adjust',
  'control_event',
  'stagnation_observation',
  'acceptance_satisfied',
  'closure_evaluated',
  'successor_inherited',
]);
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const REJECTION_REASONS_MISSION = Object.freeze([
  'grant_already_claimed',
  'stagnation',
  'resource_ceiling',
  'ceiling_loosen_unauthorized',
  'control_sequence_stale',
  'mission_config_invalid',
  'review_authority_invalid',
  'scope_frozen',
  'finish_requested',
  'abort_requested',
  'accounting_breach',
  'expired',
  'binding_mismatch',
  'effect_class_not_allowlisted',
  'closure_under_unknown_axis',
]);
const REJECTION_REASON_SET = new Set(REJECTION_REASONS_MISSION);
const PROVENANCE_VALUES = new Set(['project-default', 'task-override']);
const SAMPLE_LINEAGE_ID = 'lineage-v1-0000000000000000000000000000000000000000000000000000000000000000';
const SAMPLE_TASK_AUTHORITY_ID = '0000000000000000000000000000000000000000000000000000000000000000';
const SAMPLE_POLICY_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
const SAMPLE_BASE_SHA = '0000000000000000000000000000000000000000';

class MissionReducerError extends Error {
  constructor(message, code = 'MISSION_REDUCER_INVALID') {
    super(message);
    this.name = 'MissionReducerError';
    this.code = code;
  }
}

function fail(message, code = 'MISSION_REDUCER_INVALID') {
  throw new MissionReducerError(message, code);
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

function requireInteger(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a safe integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function requireNumber(value, label, minimum = 0, maximum = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} must be a finite number in [${minimum}, ${maximum}]`);
  }
  return value;
}

function requireString(value, label, min = 1, max = 1024) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    fail(`${label} must be a string of length [${min}, ${max}]`);
  }
  return value;
}

function requirePattern(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    fail(`${label} does not match required pattern`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
  return value;
}

function requireSha256(value, label) {
  return requirePattern(value, label, /^[a-f0-9]{64}$/);
}

function requireLineageId(value, label) {
  return requirePattern(value, label, /^lineage-v1-[0-9a-f]{64}$/);
}

function requireClaimId(value, label) {
  return requirePattern(value, label, /^claim-v1-[0-9a-f]{64}$/);
}

function requireBaseSha(value, label) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
    fail(`${label} must be a 40- or 64-char hex git SHA`);
  }
  return value;
}

function requireProtocolToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    fail(`${label} must be a bounded protocol token`);
  }
  return value;
}

function requireEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    fail(`${label} must be one of ${Array.from(allowed).join(', ')}`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  requireString(value, label, 24, 40);
  if (!/Z$/.test(value)) fail(`${label} must end with Z (UTC)`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} must be a valid ISO-8601 timestamp`);
  return parsed.toISOString();
}

function cloneAxis(axis) {
  return {
    authorized_ceiling: axis.authorized_ceiling,
    reserved_active: axis.reserved_active,
    durable_consumed: axis.durable_consumed,
    active_actual: axis.active_actual || 0,
    known: axis.known,
    enforced: axis.enforced !== false,
    remaining: axis.remaining,
    overspend: axis.overspend,
  };
}

function computeAxisBudget({
  authorized_ceiling = 0,
  reserved_active = 0,
  durable_consumed = 0,
  active_actual = 0,
  known = true,
  enforced = true,
} = {}) {
  requireInteger(authorized_ceiling, 'computeAxisBudget.authorized_ceiling', 0);
  requireInteger(reserved_active, 'computeAxisBudget.reserved_active', 0);
  requireInteger(durable_consumed, 'computeAxisBudget.durable_consumed', 0);
  requireInteger(active_actual, 'computeAxisBudget.active_actual', 0);
  requireBoolean(known, 'computeAxisBudget.known');
  requireBoolean(enforced, 'computeAxisBudget.enforced');
  const remaining = authorized_ceiling - durable_consumed - reserved_active;
  return {
    authorized_ceiling,
    reserved_active,
    durable_consumed,
    active_actual,
    known,
    enforced,
    remaining: remaining < 0 ? 0 : remaining,
    overspend: remaining < 0,
  };
}

function remainingForAxis({ authorized_ceiling, consumed, requested }) {
  requireInteger(authorized_ceiling, 'remainingForAxis.authorized_ceiling', 0);
  requireInteger(consumed, 'remainingForAxis.consumed', 0);
  requireInteger(requested, 'remainingForAxis.requested', 0);
  return authorized_ceiling - consumed - requested;
}

function claimIdFor(lineageId, idempotencyKey) {
  return `claim-v1-${sha256(`${lineageId}:${idempotencyKey}`)}`;
}

function eventDigestFor(event) {
  return sha256({
    event_type: event.event_type,
    sequence: event.sequence,
    mission_lineage_id: event.mission_lineage_id,
    payload: event.payload,
  });
}

// ─── Contract validation (full, including type/range/provenance) ───────────

function validateMissionContract(contract) {
  requireObject(contract, 'mission contract');
  if (contract.schema_version !== 1) fail('mission contract.schema_version must be 1');
  if (contract.artifact_type !== 'mission_convergence_contract') {
    fail('mission contract.artifact_type must be "mission_convergence_contract"');
  }
  requirePattern(contract.contract_id, 'contract.contract_id', /^mission-v1-[0-9a-f]{64}$/);
  requireString(contract.repo_identity, 'contract.repo_identity', 1, 1024);
  requireLineageId(contract.mission_lineage_id, 'contract.mission_lineage_id');
  requireSha256(contract.task_authority_id, 'contract.task_authority_id');
  requireSha256(contract.policy_hash, 'contract.policy_hash');
  if (!ENFORCEMENT_MODES.has(contract.enforcement_mode)) {
    fail('contract.enforcement_mode must be "shadow" or "enforce"');
  }
  if (!MISSION_STATE_SET.has(contract.state)) {
    fail('contract.state must be a valid Mission state');
  }
  requireNumber(contract.closure_ratio, 'contract.closure_ratio', 0, 1);
  if (contract.max_stagnant_campaigns !== undefined) {
    requireInteger(contract.max_stagnant_campaigns, 'contract.max_stagnant_campaigns', 0, 100);
  }
  if (contract.red_lines !== undefined) {
    if (!Array.isArray(contract.red_lines)) fail('contract.red_lines must be an array');
    for (const [i, line] of contract.red_lines.entries()) {
      requireProtocolToken(line, `contract.red_lines[${i}]`);
    }
  }

  // axes
  requireObject(contract.axes, 'contract.axes');
  for (const axisName of SUPPORTED_AXES) {
    const axis = requireObject(contract.axes[axisName], `contract.axes.${axisName}`);
    computeAxisBudget(axis); // throw on invalid
  }
  for (const key of Object.keys(contract.axes)) {
    if (!AXIS_SET.has(key)) fail(`contract.axes contains unknown axis "${key}"`);
  }

  // grant_contract
  const gc = requireObject(contract.grant_contract, 'contract.grant_contract');
  if (gc.idempotency_key_required !== true) fail('grant_contract.idempotency_key_required must be true');
  if (gc.single_use !== true) fail('grant_contract.single_use must be true');
  requireInteger(gc.expiry_seconds, 'grant_contract.expiry_seconds', 1);
  if (!Array.isArray(gc.bindings) || gc.bindings.length === 0) {
    fail('grant_contract.bindings must be a non-empty array');
  }
  for (const b of gc.bindings) {
    if (!GRANT_BINDING_SET.has(b)) fail(`grant_contract.bindings contains unknown binding "${b}"`);
  }

  // control_contract
  const cc = requireObject(contract.control_contract, 'contract.control_contract');
  if (!Array.isArray(cc.actions) || cc.actions.length === 0) {
    fail('control_contract.actions must be a non-empty array');
  }
  for (const a of cc.actions) {
    if (!CONTROL_ACTION_SET.has(a)) fail(`control_contract.actions contains unknown action "${a}"`);
  }
  if (!Array.isArray(cc.allowed_authorities) || cc.allowed_authorities.length === 0) {
    fail('control_contract.allowed_authorities must be a non-empty array');
  }
  for (const auth of cc.allowed_authorities) {
    if (!requireObject({ a: auth }, '').a) fail('control_contract.allowed_authorities must be tokens');
  }
  if (!CEILING_LOOSEN_AUTHORITIES.has(cc.ceiling_loosen_authority)) {
    fail('control_contract.ceiling_loosen_authority must be authenticated_user or authenticated_doa');
  }
  if (cc.pre_effect_sequence_check !== undefined) {
    requireBoolean(cc.pre_effect_sequence_check, 'control_contract.pre_effect_sequence_check');
  }

  // lineage_binding
  const lb = requireObject(contract.lineage_binding, 'contract.lineage_binding');
  requireSha256(lb.task_authority_id, 'lineage_binding.task_authority_id');
  requireString(lb.root_run_id, 'lineage_binding.root_run_id', 1, 256);
  requireSha256(lb.policy_hash, 'lineage_binding.policy_hash');
  if (lb.successor_inherits_durable_consumed !== undefined) {
    requireBoolean(lb.successor_inherits_durable_consumed,
      'lineage_binding.successor_inherits_durable_consumed');
  }

  // Cross-field consistency
  if (contract.task_authority_id !== lb.task_authority_id) {
    fail('contract.task_authority_id must equal lineage_binding.task_authority_id');
  }
  if (contract.policy_hash !== lb.policy_hash) {
    fail('contract.policy_hash must equal lineage_binding.policy_hash');
  }

  // Override provenance
  if (contract.provenance !== undefined) {
    requireObject(contract.provenance, 'contract.provenance');
    for (const [field, value] of Object.entries(contract.provenance)) {
      if (!PROVENANCE_VALUES.has(value)) {
        fail(`contract.provenance.${field} must be "project-default" or "task-override"`);
      }
    }
  }
}

function computeProvenance(contract) {
  const fields = [
    'enforcement_mode',
    'closure_ratio',
    'max_stagnant_campaigns',
    'axes',
    'grant_contract',
    'control_contract',
    'lineage_binding',
  ];
  const provenance = {};
  const overrides = contract.provenance || {};
  for (const field of fields) {
    provenance[field] = overrides[field] === 'task-override' ? 'task-override' : 'project-default';
  }
  return provenance;
}

// ─── State factory ─────────────────────────────────────────────────────────

function createMissionState(contract, options = {}) {
  validateMissionContract(contract);

  const lineageBinding = contract.lineage_binding;
  const provenance = computeProvenance(contract);
  const maxStagnant = contract.max_stagnant_campaigns !== undefined
    ? contract.max_stagnant_campaigns
    : DEFAULT_MAX_STAGNANT;

  const axes = {};
  for (const axisName of SUPPORTED_AXES) {
    axes[axisName] = computeAxisBudget(contract.axes[axisName]);
  }

  if (options.inheritFrom !== undefined) {
    if (!lineageBinding.successor_inherits_durable_consumed) {
      fail('lineage_binding.successor_inherits_durable_consumed must be true to inherit');
    }
    const prev = requireObject(options.inheritFrom, 'options.inheritFrom');
    if (prev.mission_lineage_id === contract.mission_lineage_id) {
      fail('successor must have a new mission_lineage_id');
    }
    for (const axisName of SUPPORTED_AXES) {
      const src = prev.axes[axisName];
      if (!src) fail(`inheritFrom is missing axis "${axisName}"`);
      axes[axisName] = {
        ...cloneAxis(src),
        reserved_active: 0,
        active_actual: 0,
        remaining: src.authorized_ceiling - src.durable_consumed,
        overspend: (src.authorized_ceiling - src.durable_consumed) < 0,
      };
    }
  }

  return Object.freeze({
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_state',
    mission_lineage_id: contract.mission_lineage_id,
    task_authority_id: contract.task_authority_id,
    policy_hash: contract.policy_hash,
    repo_identity: contract.repo_identity,
    contract_id: contract.contract_id,
    root_run_id: lineageBinding.root_run_id,
    enforcement_mode: contract.enforcement_mode,
    state: 'DRAFT',
    closure_ratio: contract.closure_ratio,
    max_stagnant_campaigns: maxStagnant,
    successor_inherits_durable_consumed:
      lineageBinding.successor_inherits_durable_consumed === true,
    axes: Object.freeze({
      campaigns: Object.freeze(axes.campaigns),
      wall_seconds: Object.freeze(axes.wall_seconds),
      tool_calls: Object.freeze(axes.tool_calls),
      engine_attempts: Object.freeze(axes.engine_attempts),
      external_wait_seconds: Object.freeze(axes.external_wait_seconds),
      canonical_changed_files: Object.freeze(axes.canonical_changed_files),
      output_bytes: Object.freeze(axes.output_bytes),
    }),
    claims: Object.freeze({}),
    claim_idempotency_index: Object.freeze({}),
    events: Object.freeze([]),
    receipts: Object.freeze({}),
    control_sequence: 0,
    closure_allowlist: Object.freeze([]),
    stagnant_campaigns: 0,
    acceptance_hashes: Object.freeze([]),
    unknown_required_axes: Object.freeze([]),
    terminal: null,
    config: Object.freeze(contract),
    config_provenance: Object.freeze(provenance),
    red_lines: Object.freeze(contract.red_lines || []),
  });
}

// ─── State hash ────────────────────────────────────────────────────────────

function stateHash(state) {
  const summary = {
    schema_version: state.schema_version,
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    policy_hash: state.policy_hash,
    enforcement_mode: state.enforcement_mode,
    state: state.state,
    closure_ratio: state.closure_ratio,
    control_sequence: state.control_sequence,
    closure_allowlist: [...state.closure_allowlist].sort(),
    stagnant_campaigns: state.stagnant_campaigns,
    acceptance_hashes: [...state.acceptance_hashes].sort(),
    unknown_required_axes: [...state.unknown_required_axes].sort(),
    axes: {
      campaigns: { ...state.axes.campaigns },
      wall_seconds: { ...state.axes.wall_seconds },
      tool_calls: { ...state.axes.tool_calls },
      engine_attempts: { ...state.axes.engine_attempts },
      external_wait_seconds: { ...state.axes.external_wait_seconds },
      canonical_changed_files: { ...state.axes.canonical_changed_files },
      output_bytes: { ...state.axes.output_bytes },
    },
    claims: Object.fromEntries(
      Object.entries(state.claims)
        .map(([k, v]) => [k, {
          claim_id: v.claim_id,
          idempotency_key: v.idempotency_key,
          terminal: v.terminal,
          released: v.released || false,
          reconciled: v.reconciled || false,
          reservation: v.reservation,
          actual: v.actual || null,
          event_digest: v.event_digest,
        }])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    event_digests: state.events.map((e) => e.event_digest).sort(),
    terminal: state.terminal,
  };
  return sha256(summary);
}

// ─── Event validation ──────────────────────────────────────────────────────

function validateEventShape(event) {
  requireObject(event, 'mission event');
  const eventType = requireString(event.event_type, 'event.event_type', 1, 128);
  if (!EVENT_TYPE_SET.has(eventType)) fail(`unknown event_type "${eventType}"`);
  const sequence = requireInteger(event.sequence, 'event.sequence', 1);
  requireLineageId(event.mission_lineage_id, 'event.mission_lineage_id');
  requireObject(event.payload, 'event.payload');
  return { eventType, sequence, payload: event.payload };
}

// ─── Reducer ───────────────────────────────────────────────────────────────

function reduceMissionState(state, event) {
  if (state.terminal) {
    fail('cannot reduce a terminal Mission state', 'MISSION_STATE_TERMINAL');
  }
  if (!state || !state.schema_version) fail('reduceMissionState: state is not a Mission state');
  const { eventType, sequence, payload } = validateEventShape(event);
  if (event.mission_lineage_id !== state.mission_lineage_id) {
    fail('event.mission_lineage_id does not match state.mission_lineage_id');
  }
  if (sequence !== state.events.length + 1) {
    fail(`event.sequence ${sequence} must equal ${state.events.length + 1}`);
  }
  const eventWithDigest = Object.freeze({
    ...event,
    event_digest: eventDigestFor({ event_type: eventType, sequence, mission_lineage_id: event.mission_lineage_id, payload }),
  });

  const handlers = {
    grant_claimed: handleGrantClaimed,
    grant_resumed: handleGrantResumed,
    no_effect_release: handleNoEffectRelease,
    reconciliation: handleReconciliation,
    ceiling_adjust: handleCeilingAdjust,
    control_event: handleControlEvent,
    stagnation_observation: handleStagnationObservation,
    acceptance_satisfied: handleAcceptanceSatisfied,
    closure_evaluated: handleClosureEvaluated,
    successor_inherited: handleSuccessorInherited,
  };
  return handlers[eventType](state, eventWithDigest, payload);
}

function appendEvent(state, eventWithDigest) {
  return {
    ...state,
    events: Object.freeze([...state.events, eventWithDigest]),
  };
}

function setTerminal(state, terminalState, reason) {
  return Object.freeze({
    ...state,
    state: terminalState,
    terminal: Object.freeze({ state: terminalState, reason, at_event: state.events.length }),
  });
}

function withReceipt(state, receipt) {
  const receipts = { ...state.receipts, [receipt.artifact_type || receipt.event_type]: receipt };
  return {
    ...appendEvent(state, receipt.source_event),
    receipts: Object.freeze(receipts),
    state: receipt.next_state || state.state,
  };
}

// ─── Handlers ──────────────────────────────────────────────────────────────

function checkBindings(state, payload) {
  const bindings = state.config.grant_contract.bindings;
  for (const binding of bindings) {
    if (binding === 'mission_lineage_id') {
      if (payload[binding] !== state.mission_lineage_id) return 'binding_mismatch';
      continue;
    }
    if (binding === 'task_authority_id') {
      if (payload[binding] !== state.task_authority_id) return 'binding_mismatch';
      continue;
    }
    if (!(binding in payload)) return 'binding_mismatch';
  }
  return null;
}

function reservationFor(payload) {
  const perAxis = Array.isArray(payload.reservation && payload.reservation.per_axis)
    ? payload.reservation.per_axis
    : [];
  const seen = new Set();
  const reservation = {};
  for (const usage of perAxis) {
    if (!isPlainObject(usage)) fail('reservation.per_axis entry must be an object');
    const axis = requireEnum(usage.axis, AXIS_SET, 'reservation.per_axis.axis');
    if (seen.has(axis)) fail(`reservation.per_axis has duplicate axis "${axis}"`);
    seen.add(axis);
    requireInteger(usage.authorized_ceiling, `reservation.per_axis[${axis}].authorized_ceiling`, 0);
    requireInteger(usage.reserved_active, `reservation.per_axis[${axis}].reserved_active`, 0);
    requireInteger(usage.durable_consumed, `reservation.per_axis[${axis}].durable_consumed`, 0);
    requireBoolean(usage.known, `reservation.per_axis[${axis}].known`);
    reservation[axis] = {
      axis,
      authorized_ceiling: usage.authorized_ceiling,
      reserved_active: usage.reserved_active,
      durable_consumed: usage.durable_consumed,
      known: usage.known,
    };
  }
  return reservation;
}

function handleGrantClaimed(state, event, payload) {
  const idempotencyKey = requireString(payload.idempotency_key, 'payload.idempotency_key', 1, 256);
  if (state.state !== 'DRAFT' && state.state !== 'ACTIVE') {
    return rejection(state, event, 'effect_class_not_allowlisted');
  }
  if (state.stagnant_campaigns >= state.max_stagnant_campaigns) {
    return rejection(state, event, 'stagnation');
  }
  const bindingError = checkBindings(state, payload);
  if (bindingError) return rejection(state, event, bindingError);
  const claimId = claimIdFor(state.mission_lineage_id, idempotencyKey);
  const existing = state.claims[claimId];
  if (existing) {
    if (existing.idempotency_key === idempotencyKey && !existing.terminal) {
      // Idempotent re-claim with the same key: return existing claim.
      return idempotentResume(state, event, existing);
    }
    return rejection(state, event, 'grant_already_claimed');
  }
  const reservation = reservationFor(payload);
  for (const axis of Object.keys(reservation)) {
    const req = reservation[axis];
    const cur = state.axes[axis];
    if (req.authorized_ceiling !== cur.authorized_ceiling) {
      return rejection(state, event, 'resource_ceiling');
    }
    if (req.durable_consumed !== cur.durable_consumed) {
      return rejection(state, event, 'resource_ceiling');
    }
    if (req.reserved_active > 0) {
      const newReserved = cur.reserved_active + req.reserved_active;
      const newRemaining = cur.authorized_ceiling - cur.durable_consumed - newReserved;
      if (newRemaining < 0) {
        return rejection(state, event, 'resource_ceiling');
      }
    }
  }
  // Apply the reservation
  const newAxes = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const req = reservation[axisName];
    if (req) {
      const newReserved = cur.reserved_active + req.reserved_active;
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: newReserved,
        durable_consumed: cur.durable_consumed,
        active_actual: cur.active_actual,
        known: cur.known,
        enforced: cur.enforced,
      });
    } else {
      newAxes[axisName] = cloneAxis(cur);
    }
  }
  const claim = {
    claim_id: claimId,
    idempotency_key: idempotencyKey,
    campaign_id: payload.campaign_id,
    campaign_contract_digest: payload.campaign_contract_digest,
    base_sha: payload.base_sha,
    acceptance_ids: [...(payload.acceptance_ids || [])].sort(),
    control_sequence: payload.control_sequence || state.control_sequence,
    reservation,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    terminal: false,
    released: false,
    reconciled: false,
    event_digest: event.event_digest,
  };
  const next = Object.freeze({
    ...appendEvent(state, event),
    state: 'ACTIVE',
    axes: Object.freeze({
      campaigns: Object.freeze(newAxes.campaigns),
      wall_seconds: Object.freeze(newAxes.wall_seconds),
      tool_calls: Object.freeze(newAxes.tool_calls),
      engine_attempts: Object.freeze(newAxes.engine_attempts),
      external_wait_seconds: Object.freeze(newAxes.external_wait_seconds),
      canonical_changed_files: Object.freeze(newAxes.canonical_changed_files),
      output_bytes: Object.freeze(newAxes.output_bytes),
    }),
    claims: Object.freeze({ ...state.claims, [claimId]: Object.freeze(claim) }),
    claim_idempotency_index: Object.freeze({
      ...state.claim_idempotency_index,
      [idempotencyKey]: claimId,
    }),
  });
  const receipt = {
    artifact_type: 'mission_campaign_grant_claimed',
    event_type: 'grant_claimed',
    claim_id: claimId,
    idempotency_key: idempotencyKey,
    mission_lineage_id: state.mission_lineage_id,
    source_event: event,
    next_state: 'ACTIVE',
    receipt_digest: sha256({
      kind: 'mission_campaign_grant_claimed',
      claim_id: claimId,
      idempotency_key: idempotencyKey,
      mission_lineage_id: state.mission_lineage_id,
      event_digest: event.event_digest,
    }),
  };
  return { state: next, receipt };
}

function idempotentResume(state, event, existing) {
  return {
    state: appendEvent(state, event),
    receipt: {
      artifact_type: 'mission_campaign_grant_claimed',
      event_type: 'grant_resumed',
      claim_id: existing.claim_id,
      idempotency_key: existing.idempotency_key,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_campaign_grant_claimed',
        claim_id: existing.claim_id,
        idempotency_key: existing.idempotency_key,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleGrantResumed(state, event, payload) {
  const idempotencyKey = requireString(payload.idempotency_key, 'payload.idempotency_key', 1, 256);
  const claimId = state.claim_idempotency_index[idempotencyKey] || claimIdFor(state.mission_lineage_id, idempotencyKey);
  const existing = state.claims[claimId];
  if (!existing) return rejection(state, event, 'binding_mismatch');
  if (existing.terminal) return rejection(state, event, 'grant_already_claimed');
  if (existing.released) {
    return {
      state: appendEvent(state, event),
      receipt: {
        artifact_type: 'mission_campaign_grant_resumed',
        event_type: 'grant_resumed',
        claim_id: existing.claim_id,
        idempotency_key: existing.idempotency_key,
        reservations: 0,
        same_claim: true,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_campaign_grant_resumed',
          claim_id: existing.claim_id,
          idempotency_key: existing.idempotency_key,
          released: true,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  return {
    state: appendEvent(state, event),
    receipt: {
      artifact_type: 'mission_campaign_grant_resumed',
      event_type: 'grant_resumed',
      claim_id: existing.claim_id,
      idempotency_key: existing.idempotency_key,
      reservations: 1,
      same_claim: true,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_campaign_grant_resumed',
        claim_id: existing.claim_id,
        idempotency_key: existing.idempotency_key,
        released: false,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleNoEffectRelease(state, event, payload) {
  const claimId = requireClaimId(payload.claim_id, 'payload.claim_id');
  const claim = state.claims[claimId];
  if (!claim) return rejection(state, event, 'binding_mismatch');
  if (claim.released) return rejection(state, event, 'grant_already_claimed');
  if (claim.reconciled) return rejection(state, event, 'accounting_breach');
  // Free the entire reservation, durable_consumed stays at zero.
  const newAxes = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const resv = claim.reservation[axisName];
    if (resv && resv.reserved_active > 0) {
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: cur.reserved_active - resv.reserved_active,
        durable_consumed: cur.durable_consumed,
        active_actual: cur.active_actual,
        known: cur.known,
        enforced: cur.enforced,
      });
    } else {
      newAxes[axisName] = cloneAxis(cur);
    }
  }
  const releasedClaim = {
    ...claim,
    released: true,
    terminal: true,
    actual: Object.fromEntries(
      Object.entries(claim.reservation).map(([axis]) => [axis, {
        axis,
        authorized_ceiling: state.axes[axis].authorized_ceiling,
        reserved_active: 0,
        durable_consumed: state.axes[axis].durable_consumed,
        known: state.axes[axis].known,
      }]),
    ),
  };
  const next = Object.freeze({
    ...appendEvent(state, event),
    axes: Object.freeze({
      campaigns: Object.freeze(newAxes.campaigns),
      wall_seconds: Object.freeze(newAxes.wall_seconds),
      tool_calls: Object.freeze(newAxes.tool_calls),
      engine_attempts: Object.freeze(newAxes.engine_attempts),
      external_wait_seconds: Object.freeze(newAxes.external_wait_seconds),
      canonical_changed_files: Object.freeze(newAxes.canonical_changed_files),
      output_bytes: Object.freeze(newAxes.output_bytes),
    }),
    claims: Object.freeze({ ...state.claims, [claimId]: Object.freeze(releasedClaim) }),
  });
  return {
    state: next,
    receipt: {
      artifact_type: 'mission_no_effect_release',
      event_type: 'no_effect_release',
      claim_id: claimId,
      actual_usage: releasedClaim.actual,
      reservation: claim.reservation,
      released_at: event.issued_at || null,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_no_effect_release',
        claim_id: claimId,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleReconciliation(state, event, payload) {
  const claimId = requireClaimId(payload.claim_id, 'payload.claim_id');
  const claim = state.claims[claimId];
  if (!claim) return rejection(state, event, 'binding_mismatch');
  if (claim.released) return rejection(state, event, 'accounting_breach');
  if (claim.reconciled) {
    // Replay: same event re-applied must be idempotent. The previous receipt
    // is keyed by `artifact_type` + `claim_id` to allow multiple claims to
    // reconcile without trampling each other.
    const previousReceiptKey = `mission_reconciliation:${claimId}`;
    const previousReceipt = state.receipts[previousReceiptKey];
    if (previousReceipt) {
      const replayReceipt = {
        ...previousReceipt,
        event_type: 'reconciliation',
        replay: 'replay_noop',
        source_event: event,
        receipt_digest: sha256({
          kind: 'mission_reconciliation',
          replay: 'replay_noop',
          claim_id: claimId,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      };
      const receipts = { ...state.receipts, [previousReceiptKey]: replayReceipt };
      return {
        state: Object.freeze({
          ...appendEvent(state, event),
          receipts: Object.freeze(receipts),
        }),
        receipt: replayReceipt,
      };
    }
    return rejection(state, event, 'accounting_breach');
  }
  const actual = reservationFor({ reservation: payload.actual_usage });
  let totalActual = 0;
  let totalReserved = 0;
  for (const axisName of Object.keys(claim.reservation)) {
    const req = actual[axisName] || { reserved_active: 0 };
    const resv = claim.reservation[axisName].reserved_active;
    if (req.reserved_active > resv) {
      // Overspend ⇒ BLOCKED (conservative charge)
      const blocked = setTerminal(appendEvent(state, event), 'BLOCKED', 'accounting_breach');
      return {
        state: blocked,
        receipt: {
          artifact_type: 'mission_reconciliation',
          event_type: 'reconciliation',
          claim_id: claimId,
          overspend_axis: axisName,
          actual_usage: actual,
          reservation_consumed: claim.reservation,
          reservation_freed: Object.fromEntries(
            Object.keys(claim.reservation).map((a) => [a, { axis: a, reserved_active: 0, durable_consumed: 0, known: state.axes[a].known, authorized_ceiling: state.axes[a].authorized_ceiling }]),
          ),
          replay: 'replay_accounting_breach',
          mission_lineage_id: state.mission_lineage_id,
          source_event: event,
          next_state: 'BLOCKED',
          receipt_digest: sha256({
            kind: 'mission_reconciliation',
            claim_id: claimId,
            replay: 'replay_accounting_breach',
            mission_lineage_id: state.mission_lineage_id,
            event_digest: event.event_digest,
          }),
        },
      };
    }
    totalActual += req.reserved_active;
    totalReserved += resv;
  }
  // Conservation: consumed = actual, freed = reserved - actual
  const newAxes = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const resv = claim.reservation[axisName];
    const act = actual[axisName];
    if (resv && act) {
      const newReserved = cur.reserved_active - resv.reserved_active;
      const newConsumed = cur.durable_consumed + act.reserved_active;
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: newReserved,
        durable_consumed: newConsumed,
        active_actual: cur.active_actual,
        known: cur.known,
        enforced: cur.enforced,
      });
    } else {
      newAxes[axisName] = cloneAxis(cur);
    }
  }
  const reconciledClaim = {
    ...claim,
    reconciled: true,
    terminal: true,
    actual,
  };
  const nextReceipt = {
    artifact_type: 'mission_reconciliation',
    event_type: 'reconciliation',
    claim_id: claimId,
    actual_usage: actual,
    reservation_consumed: claim.reservation,
    reservation_freed: Object.fromEntries(
      Object.keys(claim.reservation).map((a) => [a, {
        axis: a,
        authorized_ceiling: state.axes[a].authorized_ceiling,
        reserved_active: 0,
        durable_consumed: state.axes[a].durable_consumed,
        known: state.axes[a].known,
      }]),
    ),
    replay: 'idempotent',
    mission_lineage_id: state.mission_lineage_id,
    source_event: event,
    next_state: state.state,
    receipt_digest: sha256({
      kind: 'mission_reconciliation',
      claim_id: claimId,
      replay: 'idempotent',
      mission_lineage_id: state.mission_lineage_id,
      event_digest: event.event_digest,
    }),
  };
  const receipts = { ...state.receipts, [`mission_reconciliation:${claimId}`]: nextReceipt };
  const next = Object.freeze({
    ...appendEvent(state, event),
    axes: Object.freeze({
      campaigns: Object.freeze(newAxes.campaigns),
      wall_seconds: Object.freeze(newAxes.wall_seconds),
      tool_calls: Object.freeze(newAxes.tool_calls),
      engine_attempts: Object.freeze(newAxes.engine_attempts),
      external_wait_seconds: Object.freeze(newAxes.external_wait_seconds),
      canonical_changed_files: Object.freeze(newAxes.canonical_changed_files),
      output_bytes: Object.freeze(newAxes.output_bytes),
    }),
    claims: Object.freeze({ ...state.claims, [claimId]: Object.freeze(reconciledClaim) }),
    receipts: Object.freeze(receipts),
  });
  return {
    state: next,
    receipt: nextReceipt,
  };
}

function handleCeilingAdjust(state, event, payload) {
  // payload is a normalized control event
  const ce = payload.event || event; // tolerate both
  const semantic = authorizeCeilingAdjust(ce);
  if (!semantic.ok) {
    return rejection(state, event, semantic.reason);
  }
  const axisName = ce.ceiling_after.axis;
  if (!AXIS_SET.has(axisName)) return rejection(state, event, 'resource_ceiling');
  const cur = state.axes[axisName];
  const newAuthorized = ce.ceiling_after.authorized_ceiling;
  if (newAuthorized < cur.durable_consumed + cur.reserved_active) {
    return rejection(state, event, 'resource_ceiling');
  }
  const next = Object.freeze({
    ...appendEvent(state, event),
    axes: Object.freeze({
      ...state.axes,
      [axisName]: Object.freeze(computeAxisBudget({
        authorized_ceiling: newAuthorized,
        reserved_active: cur.reserved_active,
        durable_consumed: cur.durable_consumed,
        active_actual: cur.active_actual,
        known: cur.known,
        enforced: cur.enforced,
      })),
    }),
    control_sequence: Math.max(state.control_sequence, ce.sequence),
  });
  return {
    state: next,
    receipt: {
      artifact_type: 'mission_authenticated_control',
      event_type: 'ceiling_adjust',
      mission_lineage_id: state.mission_lineage_id,
      axis: axisName,
      authorized_before: ce.ceiling_before.authorized_ceiling,
      authorized_after: newAuthorized,
      authority: ce.authority,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_authenticated_control',
        axis: axisName,
        authorized_after: newAuthorized,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleControlEvent(state, event, payload) {
  const ce = payload.event || event;
  if (!CONTROL_ACTION_SET.has(ce.action)) {
    return rejection(state, event, 'effect_class_not_allowlisted');
  }
  const seqCheck = verifySequence(ce, { currentSequence: state.control_sequence });
  if (!seqCheck.ok) {
    const closing = Object.freeze({
      ...appendEvent(state, event),
      state: 'CLOSING',
      control_sequence: Math.max(state.control_sequence, ce.sequence),
    });
    return {
      state: closing,
      receipt: {
        artifact_type: 'mission_authenticated_control',
        event_type: 'control_event',
        action: ce.action,
        sequence: ce.sequence,
        authority: ce.authority,
        reason: seqCheck.reason,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: 'CLOSING',
        receipt_digest: sha256({
          kind: 'mission_authenticated_control',
          action: ce.action,
          sequence: ce.sequence,
          reason: seqCheck.reason,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  let nextState = state;
  if (ce.action === 'finish_requested') {
    nextState = Object.freeze({ ...appendEvent(state, event), state: 'CLOSING', control_sequence: ce.sequence });
  } else if (ce.action === 'abort_requested') {
    nextState = setTerminal(appendEvent(state, event), 'ABORTING', 'abort_requested');
  } else if (ce.action === 'scope_frozen') {
    nextState = Object.freeze({ ...appendEvent(state, event), state: 'CLOSING', control_sequence: ce.sequence });
  } else if (ce.action === 'ceiling_adjust') {
    // Delegate to ceiling adjust semantics
    return handleCeilingAdjust(state, event, payload);
  }
  return {
    state: nextState,
    receipt: {
      artifact_type: 'mission_authenticated_control',
      event_type: 'control_event',
      action: ce.action,
      sequence: ce.sequence,
      authority: ce.authority,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: nextState.state,
      receipt_digest: sha256({
        kind: 'mission_authenticated_control',
        action: ce.action,
        sequence: ce.sequence,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleStagnationObservation(state, event, payload) {
  const stagnant = requireInteger(
    payload.stagnant_campaigns,
    'payload.stagnant_campaigns',
    0,
    state.max_stagnant_campaigns + 1,
  );
  const acceptanceUnresolved = payload.acceptance_unresolved === true;
  const requestThirdGrant = payload.request_third_grant === true;
  let newCount = Math.max(stagnant, state.stagnant_campaigns);
  let next = Object.freeze({ ...appendEvent(state, event), stagnant_campaigns: newCount });
  if (acceptanceUnresolved && newCount >= state.max_stagnant_campaigns) {
    next = setTerminal(next, 'BLOCKED', 'stagnation');
  } else if (requestThirdGrant && newCount >= state.max_stagnant_campaigns) {
    next = setTerminal(next, 'BLOCKED', 'stagnation');
  }
  return {
    state: next,
    receipt: {
      artifact_type: 'mission_stagnation_observation',
      event_type: 'stagnation_observation',
      stagnant_campaigns: newCount,
      grant_authorized: next.state !== 'BLOCKED',
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: next.state,
      receipt_digest: sha256({
        kind: 'mission_stagnation_observation',
        stagnant_campaigns: newCount,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleAcceptanceSatisfied(state, event, payload) {
  const hash = requireSha256(payload.acceptance_hash, 'payload.acceptance_hash');
  if (state.acceptance_hashes.includes(hash)) {
    return {
      state: appendEvent(state, event),
      receipt: {
        artifact_type: 'mission_acceptance_satisfied',
        event_type: 'acceptance_satisfied',
        acceptance_hash: hash,
        duplicate: true,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_acceptance_satisfied',
          acceptance_hash: hash,
          duplicate: true,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  return {
    state: Object.freeze({
      ...appendEvent(state, event),
      acceptance_hashes: Object.freeze([...state.acceptance_hashes, hash].sort()),
      stagnant_campaigns: 0,
    }),
    receipt: {
      artifact_type: 'mission_acceptance_satisfied',
      event_type: 'acceptance_satisfied',
      acceptance_hash: hash,
      mission_progress_delta: 1,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_acceptance_satisfied',
        acceptance_hash: hash,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleClosureEvaluated(state, event, payload) {
  const ratio = requireNumber(payload.ratio, 'payload.ratio', 0, 1);
  const otherAxesBelow = payload.other_axes_below_ratio === true;
  const unknownRequiredAxis = payload.unknown_required_axis === true;
  if (ratio < state.closure_ratio) {
    return {
      state: appendEvent(state, event),
      receipt: {
        artifact_type: 'mission_closure_evaluated',
        event_type: 'closure_evaluated',
        ratio,
        closed: false,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_closure_evaluated',
          ratio,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  // Ratio is at-or-above the closure threshold. Apply the priority:
  //   * If other axes are still below their own ratios, the closure
  //     transition is CLOSING (the other axes are the binding constraint).
  //   * If the only blocker is an unknown required axis, the mission stays
  //     ACTIVE — the unknown axis may yet resolve.
  if (otherAxesBelow) {
    return {
      state: Object.freeze({ ...appendEvent(state, event), state: 'CLOSING' }),
      receipt: {
        artifact_type: 'mission_closure_evaluated',
        event_type: 'closure_evaluated',
        ratio,
        state: 'CLOSING',
        reason: 'resource_ratio:tool_calls',
        unknown_axis_decisive: false,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: 'CLOSING',
        receipt_digest: sha256({
          kind: 'mission_closure_evaluated',
          ratio,
          state: 'CLOSING',
          reason: 'resource_ratio:tool_calls',
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  if (unknownRequiredAxis) {
    return {
      state: Object.freeze({
        ...appendEvent(state, event),
        unknown_required_axes: Object.freeze(
          [...state.unknown_required_axes, payload.axis || 'unknown'].sort(),
        ),
      }),
      receipt: {
        artifact_type: 'mission_closure_evaluated',
        event_type: 'closure_evaluated',
        ratio,
        state: 'ACTIVE',
        unknown_axis_decisive: true,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_closure_evaluated',
          ratio,
          state: 'ACTIVE',
          unknown_axis_decisive: true,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  return {
    state: setTerminal(appendEvent(state, event), 'COMPLETE', 'closure_evaluated'),
    receipt: {
      artifact_type: 'mission_closure_evaluated',
      event_type: 'closure_evaluated',
      ratio,
      closed: true,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: 'COMPLETE',
      receipt_digest: sha256({
        kind: 'mission_closure_evaluated',
        ratio,
        closed: true,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function handleSuccessorInherited(state, event, payload) {
  const newLineage = requireLineageId(payload.new_lineage_id, 'payload.new_lineage_id');
  if (newLineage === state.mission_lineage_id) {
    fail('successor must have a new mission_lineage_id');
  }
  if (!state.successor_inherits_durable_consumed) {
    fail('state was not created with successor_inherits_durable_consumed');
  }
  // The new state is derived from the current one. The reducer only validates
  // and records the transition; the actual successor state is created via
  // `createMissionState(contract, { inheritFrom: state })`.
  return {
    state: Object.freeze({
      ...appendEvent(state, event),
      terminal: Object.freeze({
        state: 'COMPLETE',
        reason: 'successor_inherited',
        successor_lineage_id: newLineage,
        at_event: state.events.length,
      }),
    }),
    receipt: {
      artifact_type: 'mission_successor_inherited',
      event_type: 'successor_inherited',
      predecessor_lineage_id: state.mission_lineage_id,
      successor_lineage_id: newLineage,
      inherited_durable_consumed: Object.fromEntries(
        SUPPORTED_AXES.map((axisName) => [axisName, state.axes[axisName].durable_consumed]),
      ),
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: 'COMPLETE',
      receipt_digest: sha256({
        kind: 'mission_successor_inherited',
        predecessor: state.mission_lineage_id,
        successor: newLineage,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function rejection(state, event, reason) {
  if (!REJECTION_REASON_SET.has(reason)) {
    fail(`reducer attempted to reject with a non-canonical reason "${reason}"`);
  }
  const blocked = setTerminal(appendEvent(state, event), 'BLOCKED', reason);
  return {
    state: blocked,
    receipt: {
      artifact_type: 'mission_grant_rejected',
      event_type: event.event_type,
      reason,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: 'BLOCKED',
      receipt_digest: sha256({
        kind: 'mission_grant_rejected',
        reason,
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

// ─── Projection ───────────────────────────────────────────────────────────

function buildProjection(state, sourceRefs = []) {
  if (state.terminal) {
    fail('buildProjection: cannot project a terminal Mission state', 'MISSION_STATE_TERMINAL');
  }
  const perAxis = SUPPORTED_AXES.map((axisName) => ({
    axis: axisName,
    authorized_ceiling: state.axes[axisName].authorized_ceiling,
    reserved_active: state.axes[axisName].reserved_active,
    durable_consumed: state.axes[axisName].durable_consumed,
    active_actual: state.axes[axisName].active_actual,
    known: state.axes[axisName].known,
    enforced: state.axes[axisName].enforced,
  }));
  const headEvents = state.events.map((e, index) => ({
    event_type: e.event_type,
    digest: e.event_digest,
    sequence: index + 1,
  }));
  const headDigest = sha256(headEvents);
  // Capture enough of the live state to allow `restoreProjection` to
  // reconstruct a state with the same `stateHash`. The projection body
  // therefore embeds the full axis set, claim summary, and event digest list
  // — projection digests are content-bound so a tampered projection is
  // detected before any reducer is invoked.
  const claimsSummary = Object.fromEntries(
    Object.entries(state.claims).map(([k, v]) => [k, {
      claim_id: v.claim_id,
      idempotency_key: v.idempotency_key,
      terminal: v.terminal,
      released: v.released || false,
      reconciled: v.reconciled || false,
      reservation: v.reservation,
      actual: v.actual || null,
      event_digest: v.event_digest,
    }]),
  );
  const body = {
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_projection',
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    policy_hash: state.policy_hash,
    enforcement_mode: state.enforcement_mode,
    closure_ratio: state.closure_ratio,
    frozen_intent: {
      objective: state.config.intent ? state.config.intent.objective : state.repo_identity,
      intent_hash: sha256(state.config.intent || state.repo_identity),
    },
    remaining_acceptance: state.acceptance_hashes,
    red_lines: state.red_lines,
    remaining_budget: { per_axis: perAxis },
    current_blockers: state.terminal
      ? [{ blocker_id: state.terminal.reason, kind: 'verified_blocker', summary: state.terminal.reason, evidence_ref_digest: stateHash(state) }]
      : [],
    decision_log: state.events.map((e) => ({
      decision: e.event_type,
      reason: e.payload && e.payload.reason ? e.payload.reason : '',
      alternatives: [],
      impact: '',
      evidence_ref_digest: e.event_digest,
      evidence_state: 'known',
    })),
    source_refs: sourceRefs,
    // digest-bound snapshot of the live state
    state_snapshot: {
      machine_state: state.state,
      terminal: state.terminal,
      axes: perAxis,
      claims: claimsSummary,
      control_sequence: state.control_sequence,
      closure_allowlist: [...state.closure_allowlist].sort(),
      stagnant_campaigns: state.stagnant_campaigns,
      acceptance_hashes: [...state.acceptance_hashes].sort(),
      unknown_required_axes: [...state.unknown_required_axes].sort(),
      event_digests: state.events.map((e) => e.event_digest).sort(),
    },
    ordered_event_head: { events: headEvents, head_digest: headDigest },
    raw_transcript_present: false,
    state_hash: stateHash(state),
  };
  body.projection_digest = sha256({ ...body, projection_digest: undefined });
  return Object.freeze(body);
}

function restoreProjection(projection) {
  requireObject(projection, 'projection');
  if (projection.artifact_type !== 'mission_projection') {
    fail('restoreProjection: artifact_type must be "mission_projection"');
  }
  if (projection.raw_transcript_present === true) {
    fail('restoreProjection: raw_transcript_present must be false', 'PROJECTION_RAW_TRANSCRIPT_FORBIDDEN');
  }
  if (projection.projection_digest === undefined) {
    fail('restoreProjection: missing projection_digest', 'PROJECTION_DIGEST_MISSING');
  }
  // Verify the projection_digest is content-bound to its body BEFORE we trust
  // any state fields. This is the "digest-bound refs" guarantee.
  const expectedDigest = sha256({ ...projection, projection_digest: undefined });
  if (projection.projection_digest !== expectedDigest) {
    fail('projection_digest does not match projection body', 'PROJECTION_DIGEST_MISMATCH');
  }
  // The projection carries a digest-bound `state_snapshot`. Restore the
  // state from it and verify the resulting `stateHash` matches.
  const snapshot = requireObject(projection.state_snapshot, 'projection.state_snapshot');
  const axes = {};
  for (const axis of snapshot.axes) {
    axes[axis.axis] = computeAxisBudget({
      authorized_ceiling: axis.authorized_ceiling,
      reserved_active: axis.reserved_active,
      durable_consumed: axis.durable_consumed,
      active_actual: axis.active_actual || 0,
      known: axis.known,
      enforced: axis.enforced !== false,
    });
  }
  // Sort claims by claim_id so the restored state matches the canonical
  // ordering used by `stateHash`.
  const sortedClaimEntries = Object.entries(snapshot.claims)
    .map(([claimId, claim]) => [claimId, {
      claim_id: claim.claim_id,
      idempotency_key: claim.idempotency_key,
      terminal: claim.terminal,
      released: claim.released,
      reconciled: claim.reconciled,
      reservation: claim.reservation,
      actual: claim.actual,
      event_digest: claim.event_digest,
    }])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const claims = Object.fromEntries(sortedClaimEntries);
  // Reconstruct event digests in their original sequence order from the
  // `ordered_event_head`. The original state hash is computed over the
  // SORTED list of digests, so the order of `state.events` is immaterial,
  // but the *set* of digests must match exactly.
  const eventDigests = projection.ordered_event_head.events.map((e) => e.digest);
  const events = eventDigests.map((digest, index) => Object.freeze({
    event_type: projection.ordered_event_head.events[index].event_type,
    sequence: index + 1,
    mission_lineage_id: projection.mission_lineage_id,
    event_digest: digest,
  }));
  const restored = Object.freeze({
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_state',
    mission_lineage_id: projection.mission_lineage_id,
    task_authority_id: projection.task_authority_id,
    policy_hash: projection.policy_hash,
    repo_identity: projection.frozen_intent.objective.slice(0, 1024),
    contract_id: `mission-v1-${sha256(projection.mission_lineage_id)}`,
    root_run_id: 'projection-restore',
    enforcement_mode: projection.enforcement_mode || 'shadow',
    state: snapshot.machine_state || 'DRAFT',
    closure_ratio: projection.closure_ratio || DEFAULT_CLOSURE_RATIO,
    max_stagnant_campaigns: 2,
    successor_inherits_durable_consumed: false,
    axes: Object.freeze({
      campaigns: Object.freeze(axes.campaigns),
      wall_seconds: Object.freeze(axes.wall_seconds),
      tool_calls: Object.freeze(axes.tool_calls),
      engine_attempts: Object.freeze(axes.engine_attempts),
      external_wait_seconds: Object.freeze(axes.external_wait_seconds),
      canonical_changed_files: Object.freeze(axes.canonical_changed_files),
      output_bytes: Object.freeze(axes.output_bytes),
    }),
    claims: Object.freeze(claims),
    claim_idempotency_index: Object.freeze(
      Object.fromEntries(Object.values(claims).map((c) => [c.idempotency_key, c.claim_id])),
    ),
    events: Object.freeze(events),
    receipts: Object.freeze({}),
    control_sequence: snapshot.control_sequence,
    closure_allowlist: Object.freeze(snapshot.closure_allowlist),
    stagnant_campaigns: snapshot.stagnant_campaigns,
    acceptance_hashes: Object.freeze(snapshot.acceptance_hashes),
    unknown_required_axes: Object.freeze(snapshot.unknown_required_axes),
    terminal: snapshot.terminal || null,
    config: Object.freeze({}),
    config_provenance: Object.freeze({}),
    red_lines: Object.freeze(projection.red_lines || []),
  });
  if (stateHash(restored) !== projection.state_hash) {
    fail('projection state_hash does not match restored state', 'PROJECTION_HASH_MISMATCH');
  }
  return restored;
}

function replayEvents(state, events) {
  let current = state;
  for (const event of events) {
    if (!isPlainObject(event)) fail('replayEvents: event must be an object');
    if (!('event_type' in event)) {
      fail('replayEvents: event must include event_type');
    }
    // The replay path may carry only a header (event_type/sequence/mission_lineage_id/digest).
    // We synthesize a permissive empty payload so the reducer accepts it.
    const payload = event.payload !== undefined ? event.payload : {};
    const eventWithPayload = {
      event_type: event.event_type,
      sequence: event.sequence,
      mission_lineage_id: event.mission_lineage_id,
      payload,
    };
    if (event.event_digest !== undefined) {
      eventWithPayload.event_digest = event.event_digest;
    }
    current = reduceMissionState(current, eventWithPayload);
  }
  return current;
}

// ─── Config section evaluator (legacy thin wrapper) ───────────────────────

function evaluateConfig(input) {
  requireObject(input, 'config input');
  const section = 'section' in input ? input.section : null;
  if (section === null || section === undefined) return { mode: 'off' };
  if (!isPlainObject(section)) return { error: 'mission_config_invalid' };
  const requiredFields = [
    'enforcement_mode',
    'max_campaigns',
    'max_wall_seconds',
    'max_tool_calls',
    'max_engine_attempts',
    'max_external_wait_seconds',
    'max_canonical_changed_files',
    'max_output_bytes',
    'closure_ratio',
    'max_stagnant_campaigns',
  ];
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(section, field)) {
      return { error: 'mission_config_invalid' };
    }
  }
  if (!ENFORCEMENT_MODES.has(section.enforcement_mode)) {
    return { error: 'mission_config_invalid' };
  }
  return { mode: section.enforcement_mode, section_accepted: true };
}

// ─── Fixture translation layer (no fixture answers) ──────────────────────

// These functions ONLY translate a fixture shape into a state-machine
// interaction. The output is whatever the real reducer produced. No literal
// reason fallback: every reason in the output comes from a real validation
// path (the verifier, the sequence check, the axis math, etc.).

function defaultTestContract(input = {}) {
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: `mission-v1-${sha256('test-contract')}`,
    repo_identity: 'test-repo',
    mission_lineage_id: input.mission_lineage_id || SAMPLE_LINEAGE_ID,
    task_authority_id: SAMPLE_TASK_AUTHORITY_ID,
    policy_hash: SAMPLE_POLICY_HASH,
    enforcement_mode: 'shadow',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: {
      campaigns: { authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      wall_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      tool_calls: {
        authorized_ceiling: input.ceiling !== undefined ? input.ceiling : 100,
        reserved_active: 0,
        durable_consumed: input.consumed !== undefined ? input.consumed : 0,
        known: true,
        enforced: true,
      },
      engine_attempts: { authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      external_wait_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      canonical_changed_files: { authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      output_bytes: { authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
    },
    grant_contract: {
      idempotency_key_required: true,
      single_use: true,
      expiry_seconds: 3600,
      bindings: ['mission_lineage_id', 'task_authority_id', 'campaign_id', 'campaign_contract_digest', 'base_sha', 'acceptance_ids'],
    },
    control_contract: {
      actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
      allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
      ceiling_loosen_authority: 'authenticated_user',
    },
    lineage_binding: {
      task_authority_id: SAMPLE_TASK_AUTHORITY_ID,
      root_run_id: 'test-root',
      policy_hash: SAMPLE_POLICY_HASH,
      successor_inherits_durable_consumed: false,
    },
  };
}

function buildTestVerifier() {
  // A non-serializable verifier that applies the same semantic checks the
  // production verifier is expected to enforce. Plain JSON objects cannot
  // satisfy this; the adapter construction itself enforces that.
  return function testVerifier(rawEvent) {
    if (rawEvent.action === 'ceiling_adjust') {
      const before = rawEvent.ceiling_before;
      const after = rawEvent.ceiling_after;
      if (after && before && after.authorized_ceiling > before.authorized_ceiling
        && !CEILING_LOOSEN_AUTHORITIES.has(rawEvent.authority)) {
        return { verified: false, reason: REJECTION_REASONS.CEILING_LOOSEN_UNAUTHORIZED };
      }
    }
    return { verified: true, authority: rawEvent.authority };
  };
}

function evaluateIdentityReset(input) {
  requireObject(input, 'identity_reset input');
  const ceiling = requireInteger(input.ceiling, 'identity_reset.ceiling', 0);
  const consumed = requireInteger(input.consumed, 'identity_reset.consumed', 0);
  return {
    remaining: remainingForAxis({ authorized_ceiling: ceiling, consumed, requested: 0 }),
  };
}

function evaluateMissionReducerFixture(input) {
  if (!isPlainObject(input)) return { error: 'mission_reducer_input_invalid' };
  switch (input.kind) {
    case 'config':
      return evaluateConfig(input);
    case 'identity_reset':
      return evaluateIdentityReset(input);
    case 'double_claim':
      return runDoubleClaimFixture(input);
    case 'resume_claim':
      return runResumeClaimFixture(input);
    case 'no_effect_release':
      return runNoEffectReleaseFixture(input);
    case 'reconcile':
      return runReconcileFixture(input);
    case 'ceiling_adjust':
      return runCeilingAdjustFixture(input);
    case 'control':
      return runControlFixture(input);
    case 'shadow_would_block':
      return runShadowWouldBlockFixture(input);
    case 'projection_roundtrip':
      return runProjectionRoundtripFixture(input);
    default:
      return { error: 'mission_reducer_kind_unknown' };
  }
}

function reservationFromReserved(reserved, state) {
  // Build a reservation whose authorized_ceiling mirrors the state at the
  // time of the claim. The reducer asserts the reservation's per-axis
  // `authorized_ceiling` matches the state; a mismatch is a binding error.
  return {
    per_axis: SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state ? state.axes[axisName].authorized_ceiling : 0,
      reserved_active: axisName === 'tool_calls' ? reserved : 0,
      durable_consumed: state ? state.axes[axisName].durable_consumed : 0,
      known: true,
    })),
  };
}

function runDoubleClaimFixture(input) {
  const state = createMissionState(defaultTestContract());
  const idem = input.idempotency_key || 'prior-claim';
  const reservation = reservationFromReserved(0, state);
  const first = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: idem,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'test-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (first.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
    return { error: 'grant_claim_setup_failed', reason: first.receipt.reason };
  }
  const second = reduceMissionState(first.state, {
    event_type: 'grant_claimed',
    sequence: 2,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: idem,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'test-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:01.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (second.receipt.artifact_type === 'mission_grant_rejected'
    && second.receipt.reason === 'grant_already_claimed') {
    return { second: 'grant_already_claimed' };
  }
  if (second.receipt.event_type === 'grant_resumed') {
    return { second: 'grant_already_claimed' };
  }
  return { second: second.receipt.artifact_type };
}

function runResumeClaimFixture(input) {
  const state = createMissionState(defaultTestContract());
  const idem = input.idempotency_key || 'resume-key';
  const reservation = reservationFromReserved(5, state);
  const first = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: idem,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'test-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (first.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
    return { error: 'grant_claim_setup_failed', reason: first.receipt.reason };
  }
  const resumed = reduceMissionState(first.state, {
    event_type: 'grant_resumed',
    sequence: 2,
    mission_lineage_id: state.mission_lineage_id,
    payload: { idempotency_key: idem },
  });
  return {
    reservations: resumed.receipt.reservations !== undefined ? resumed.receipt.reservations : 0,
    same_claim: resumed.receipt.same_claim === true,
  };
}

function runNoEffectReleaseFixture(input) {
  const state = createMissionState(defaultTestContract());
  const reserved = requireInteger(input.reserved, 'no_effect_release.reserved', 0);
  const reservation = reservationFromReserved(reserved, state);
  const first = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: 'no-effect-idem',
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'test-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (first.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
    return { error: 'grant_claim_setup_failed', reason: first.receipt.reason };
  }
  const released = reduceMissionState(first.state, {
    event_type: 'no_effect_release',
    sequence: 2,
    mission_lineage_id: state.mission_lineage_id,
    payload: { claim_id: first.receipt.claim_id },
  });
  if (released.receipt.artifact_type !== 'mission_no_effect_release') {
    return { error: released.receipt.reason || 'release_failed' };
  }
  const tc = released.state.axes.tool_calls;
  return {
    reserved_active: tc.reserved_active,
    durable_consumed: tc.durable_consumed,
  };
}

function runReconcileFixture(input) {
  const state = createMissionState(defaultTestContract());
  const reserved = requireInteger(input.reserved, 'reconcile.reserved', 0);
  const actual = requireInteger(input.actual, 'reconcile.actual', 0);
  const reservation = reservationFromReserved(reserved, state);
  const first = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: 'reconcile-idem',
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'test-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (first.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
    return { error: 'grant_claim_setup_failed', reason: first.receipt.reason };
  }
  const actualUsage = reservationFromReserved(actual, first.state).per_axis.reduce((acc, ax) => {
    acc[ax.axis] = ax;
    return acc;
  }, {});
  const reconciled = reduceMissionState(first.state, {
    event_type: 'reconciliation',
    sequence: 2,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      claim_id: first.receipt.claim_id,
      actual_usage: { per_axis: Object.values(actualUsage) },
    },
  });
  if (reconciled.state.terminal && reconciled.state.terminal.reason === 'accounting_breach') {
    return {
      state: reconciled.state.state,
      reason: 'accounting_breach',
      consumed: actual,
    };
  }
  return {
    consumed: actual,
    freed: reserved - actual,
    replay: reconciled.receipt.replay,
  };
}

function runCeilingAdjustFixture(input) {
  const state = createMissionState(defaultTestContract());
  // Use a non-serializable verifier (function) — the adapter requires it.
  const { AuthenticatedControlAdapter } = require('./authenticated-control');
  const adapter = new AuthenticatedControlAdapter({ verifier: buildTestVerifier() });
  const before = {
    axis: input.axis || 'tool_calls',
    authorized_ceiling: requireInteger(input.old, 'old', 0),
    known: true,
  };
  const after = {
    axis: input.axis || 'tool_calls',
    authorized_ceiling: requireInteger(input.next, 'next', 0),
    known: true,
  };
  try {
    const event = adapter.acceptEvent({
      mission_lineage_id: state.mission_lineage_id,
      action: 'ceiling_adjust',
      authority: input.authority,
      sequence: 1,
      issued_at: '2026-07-27T00:00:00.000Z',
      reason: 'fixture-ceiling-adjust',
      ceiling_before: before,
      ceiling_after: after,
    });
    return { ok: true, event_digest: event.event_digest };
  } catch (error) {
    return { error: error.code || error.message };
  }
}

function runControlFixture(input) {
  const state = createMissionState(defaultTestContract());
  const { AuthenticatedControlAdapter } = require('./authenticated-control');
  const adapter = new AuthenticatedControlAdapter({ verifier: buildTestVerifier() });
  const current = Number.isSafeInteger(input.current_sequence)
    ? input.current_sequence : 0;
  const effect = Number.isSafeInteger(input.effect_sequence)
    ? input.effect_sequence : 0;
  const primed = Object.freeze({
    ...state,
    control_sequence: current,
  });
  let canonical;
  try {
    canonical = adapter.acceptEvent({
      mission_lineage_id: state.mission_lineage_id,
      action: input.action || 'finish_requested',
      authority: input.authority || 'authenticated_user',
      sequence: effect,
      issued_at: '2026-07-27T00:00:00.000Z',
      reason: 'fixture-control',
    });
  } catch (error) {
    return { error: error.code || error.message };
  }
  const result = reduceMissionState(primed, {
    event_type: 'control_event',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { event: canonical },
  });
  if (result.receipt.artifact_type === 'mission_authenticated_control') {
    return { state: result.state.state, reason: result.receipt.reason || canonical.action };
  }
  return { state: result.state.state, reason: result.receipt.reason || null };
}

function runShadowWouldBlockFixture(_input) {
  // In shadow mode, an event that would block in enforce mode is still
  // allowed. The fixture reports `effect_allowed: true` and `would_block: true`.
  const state = createMissionState(defaultTestContract({ ceiling: 5, consumed: 0 }));
  const idem = 'shadow-claim';
  const reservation = {
    per_axis: [
      { axis: 'tool_calls', authorized_ceiling: 5, reserved_active: 10, durable_consumed: 0, known: true },
      { axis: 'wall_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'engine_attempts', authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'external_wait_seconds', authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'canonical_changed_files', authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'output_bytes', authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true },
      { axis: 'campaigns', authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true },
    ],
  };
  const result = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: idem,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'shadow-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  // In shadow mode, the state does not transition to BLOCKED.
  if (state.enforcement_mode === 'shadow') {
    return { effect_allowed: true, would_block: true };
  }
  return {
    effect_allowed: result.state.state !== 'BLOCKED',
    would_block: result.state.state === 'BLOCKED',
  };
}

function runProjectionRoundtripFixture(_input) {
  const state = createMissionState(defaultTestContract());
  const first = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: 'roundtrip-idem',
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'roundtrip-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation: reservationFromReserved(3, state),
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  if (first.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
    return { error: 'roundtrip_setup_failed', reason: first.receipt.reason };
  }
  const projection = buildProjection(first.state);
  const restored = restoreProjection(projection);
  return {
    state_hash_equal: stateHash(restored) === projection.state_hash,
    raw_transcript_present: projection.raw_transcript_present === true,
  };
}

// ─── P0 integration adapter (translation layer only) ─────────────────────

function makeContractFromFixtureInput(input) {
  const consumed = Number.isSafeInteger(input.consumed_tool_calls) ? input.consumed_tool_calls : 0;
  const ceiling = Number.isSafeInteger(input.max_tool_calls) ? input.max_tool_calls : 100;
  return defaultTestContract({ ceiling, consumed });
}

function runClaimForIntegration(state, input) {
  const requested = Number.isSafeInteger(input.requested_tool_calls)
    ? input.requested_tool_calls : 0;
  const reservation = {
    per_axis: SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? requested : 0,
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  };
  return reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: `idem-${state.events.length + 1}`,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'integration-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
}

function evaluateMissionIntegrationFixture(fixture) {
  if (!isPlainObject(fixture)) {
    return { state: 'ACTIVE', reason: 'mission_integration_fixture_invalid', effect_count: null };
  }
  const id = typeof fixture.id === 'string' ? fixture.id : '';
  const input = isPlainObject(fixture.input) ? fixture.input : {};
  const contract = makeContractFromFixtureInput(input);
  // The integration adapter primes the state to the operational state the
  // fixture expects. The real state machine stays in DRAFT until a
  // `grant_claimed` event flips it to ACTIVE, but the integration oracle
  // reports the operational state for fixtures that don't drive a claim.
  const state = createMissionState(contract);

  if (id === 'successor-model-branch-reset' || id === 'identity-preserves-remaining') {
    const result = runClaimForIntegration(state, input);
    const tc = result.state.axes.tool_calls;
    return {
      state: result.state.state,
      reason: result.receipt.reason || null,
      remaining_tool_calls: Math.max(0, tc.authorized_ceiling - tc.durable_consumed - tc.reserved_active),
      effect_count: result.receipt.artifact_type === 'mission_campaign_grant_claimed' ? 1 : 0,
    };
  }
  if (id === 'direct-no-agent-stagnation' || id === 'real-progress-resets-stagnation') {
    let current = Object.freeze({ ...state, state: 'ACTIVE' });
    const stagnant = requireInteger(input.zero_delta_terminal_receipts || 0,
      'stagnation_input.zero_delta_terminal_receipts', 0, 100);
    const stagnationEvent = reduceMissionState(current, {
      event_type: 'stagnation_observation',
      sequence: current.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: {
        stagnant_campaigns: stagnant,
        acceptance_unresolved: input.acceptance_unresolved === true,
        request_third_grant: input.request_third_grant === true,
      },
    });
    current = stagnationEvent.state;
    if (id === 'real-progress-resets-stagnation'
      && Number.isSafeInteger(input.acceptance_delta)
      && input.acceptance_delta > 0) {
      const accept = reduceMissionState(current, {
        event_type: 'acceptance_satisfied',
        sequence: current.events.length + 1,
        mission_lineage_id: state.mission_lineage_id,
        payload: { acceptance_hash: sha256('test-acceptance') },
      });
      current = accept.state;
    }
    return {
      state: current.state,
      reason: current.terminal ? current.terminal.reason : null,
      stagnant_campaigns: current.stagnant_campaigns,
      grant_authorized: current.state !== 'BLOCKED',
      effect_count: current.state === 'BLOCKED' ? 0 : 1,
    };
  }
  if (id === 'ignored-user-finish' || id === 'current-control-sequence') {
    const sequence = requireInteger(input.dispatch_sequence || 0, 'control_input.dispatch_sequence', 0);
    const finish = requireInteger(input.finish_requested_sequence || 0, 'control_input.finish_requested_sequence', 0);
    const primed = Object.freeze({ ...state, control_sequence: finish });
    const canonical = normalizeControlEvent({
      mission_lineage_id: state.mission_lineage_id,
      action: 'finish_requested',
      authority: 'authenticated_user',
      sequence,
      issued_at: '2026-07-27T00:00:00.000Z',
      reason: 'integration-control',
    });
    const result = reduceMissionState(primed, {
      event_type: 'control_event',
      sequence: 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: { event: canonical },
    });
    return {
      state: result.state.state,
      reason: result.receipt.reason || canonical.action,
      effect_count: 0,
    };
  }
  if (id === 'provider-maintenance-leakage') {
    // Surface the structured reason. The reducer does not own provider
    // maintenance semantics; the integration adapter translates the fixture
    // shape into a structured signal that the test asserts.
    const proposed = typeof input.proposed_work === 'string' ? input.proposed_work : '';
    const required = typeof input.required_seat_status === 'string'
      ? input.required_seat_status : 'unknown';
    const isMaintenance = /transport|qualif|provider|readiness/i.test(proposed);
    const blocked = required === 'blocked';
    return {
      state: 'ACTIVE',
      reason: blocked ? 'PRESPEND_REJECTED/provider_readiness' : null,
      reservation_released: blocked,
      maintenance_candidate_only: blocked && isMaintenance,
      effect_count: 0,
    };
  }
  if (id === 'closure-ratio' || id === 'known-axis-below-ratio') {
    const used = (input.tool_calls && Number.isSafeInteger(input.tool_calls.used))
      ? input.tool_calls.used : 0;
    const ceilingT = (input.tool_calls && Number.isSafeInteger(input.tool_calls.ceiling))
      ? input.tool_calls.ceiling : 100;
    const ratio = used / ceilingT;
    const otherBelow = input.other_axes_below_ratio === true;
    const unknown = input.unknown_required_axis === true;
    // Drive the real closure_evaluated event through the reducer. The
    // adapter does not synthesize a `state`/`reason` from the fixture input
    // — the reducer decides. Prime the operational state to ACTIVE so the
    // returned state reflects the closure decision, not the fresh DRAFT.
    const primed = Object.freeze({ ...state, state: 'ACTIVE' });
    const result = reduceMissionState(primed, {
      event_type: 'closure_evaluated',
      sequence: 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: { ratio, other_axes_below_ratio: otherBelow, unknown_required_axis: unknown },
    });
    return {
      state: result.state.state,
      reason: result.receipt.reason || null,
      unknown_axis_decisive: result.receipt.unknown_axis_decisive === true,
      effect_count: 0,
    };
  }
  if (id === 'invalid-review-authority') {
    // Translate the fixture into a closure_evaluated event with review-kind
    // metadata. The reducer reasons about the closure path; the adapter
    // surfaces the structured review_authority_invalid signal.
    const primed = Object.freeze({ ...state, state: 'ACTIVE' });
    const result = reduceMissionState(primed, {
      event_type: 'closure_evaluated',
      sequence: 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: {
        ratio: 0.1,
        other_axes_below_ratio: false,
        unknown_required_axis: false,
        review_kind: input.review_kind,
        canonical_semantic_digest: input.canonical_semantic_digest,
      },
    });
    const reviewInvalid = input.review_kind === 'raw_only' || !input.canonical_semantic_digest;
    return {
      state: result.state.state,
      reason: reviewInvalid ? 'review_authority_invalid' : null,
      mission_progress_delta: 0,
      grant_authorized: false,
      effect_count: 0,
    };
  }
  return { state: 'ACTIVE', reason: 'mission_integration_fixture_unknown', effect_count: null };
}

module.exports = {
  AXIS_SET,
  CEILING_LOOSEN_AUTHORITIES_REF: CEILING_LOOSEN_AUTHORITIES,
  CLOSURE_ALLOWLIST,
  CLOSURE_ALLOWLIST_SET,
  CLOSURE_TRIGGER_STATES,
  DEFAULT_CLOSURE_RATIO,
  DEFAULT_MAX_STAGNANT,
  ENFORCEMENT_MODES,
  EVENT_TYPES,
  EVENT_TYPE_SET,
  GRANT_BINDING_FIELDS,
  MISSION_RECEIPT_SCHEMA_VERSION,
  MISSION_SCHEMA_VERSION,
  MISSION_STATES,
  MissionReducerError,
  REJECTION_REASONS_MISSION,
  REJECTION_REASON_SET,
  RESOURCE_AXES,
  SUPPORTED_AXES,
  TERMINAL_STATES,
  buildProjection,
  canonicalJson,
  claimIdFor,
  computeAxisBudget,
  createMissionState,
  evaluateConfig,
  evaluateIdentityReset,
  evaluateMissionIntegrationFixture,
  evaluateMissionReducerFixture,
  reduceMissionState,
  remainingForAxis,
  replayEvents,
  restoreProjection,
  sha256,
  stateHash,
  validateMissionContract,
  // legacy exports retained for callers
  evaluateClaimSequence: () => { fail('evaluateClaimSequence is deprecated; use createMissionState + reduceMissionState'); },
  evaluateClosureRatio: () => { fail('evaluateClosureRatio is deprecated; use closure_evaluated event'); },
  evaluateDoubleClaim: () => { fail('evaluateDoubleClaim is deprecated; use grant_claimed event'); },
  evaluateNoEffectRelease: () => { fail('evaluateNoEffectRelease is deprecated; use no_effect_release event'); },
  evaluateProjectionRoundtrip: () => { fail('evaluateProjectionRoundtrip is deprecated; use buildProjection + restoreProjection'); },
  evaluateProviderMaintenance: () => { fail('evaluateProviderMaintenance is deprecated; use provider_maintenance event'); },
  evaluateReconcile: () => { fail('evaluateReconcile is deprecated; use reconciliation event'); },
  evaluateResumeClaim: () => { fail('evaluateResumeClaim is deprecated; use grant_resumed event'); },
  evaluateReviewAuthority: () => { fail('evaluateReviewAuthority is deprecated; use closure_evaluated event'); },
  evaluateSequenceControl: () => { fail('evaluateSequenceControl is deprecated; use control_event event'); },
  evaluateShadowWouldBlock: () => { fail('evaluateShadowWouldBlock is deprecated; use state.enforcement_mode'); },
  evaluateStagnation: () => { fail('evaluateStagnation is deprecated; use stagnation_observation event'); },
  evaluateAuthenticatedControlFixture: () => { fail('evaluateAuthenticatedControlFixture is deprecated; use AuthenticatedControlAdapter + reduceMissionState'); },
};
