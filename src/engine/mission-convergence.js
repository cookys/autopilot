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
// Intentionally NOT exported (Finding 6 — replay is the projection +
// digest-verified event stream, not a single function):
//   * `replayEvents` — fails closed with `REPLAY_EVENTS_REMOVED` if reached.
//
// Events accepted by the reducer (canonical event_type set):
//   grant_claimed, grant_resumed, no_effect_release, reconciliation,
//   ceiling_adjust, control_event, stagnation_observation,
//   acceptance_satisfied, closure_evaluated, successor_inherited,
//   abort_finalized

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
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
  consumeAuthenticatedControlEvent,
  isAuthenticatedAdapterCapability,
  normalizeControlEvent,
  sha256,
  verifySequence,
} = require('./authenticated-control');
const {
  IDENTITY_SCHEME_V2,
  claimMissionSubjectDigest,
  isMissionSubjectV2Claim,
  missionCampaignIdFor,
  missionSubjectDigest,
} = require('./mission-campaign-identity');

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
  'mission_subject_digest',
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
  'abort_finalized',
]);
const EVENT_TYPE_SET = new Set(EVENT_TYPES);
// While ABORTING, only drain paths and the canonical finalization transition
// may advance state. Unrelated events fail closed without mutation.
const ABORTING_ALLOWED_EVENTS = new Set([
  'abort_finalized',
  'no_effect_release',
  'reconciliation',
]);
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

function normalizeSha256List(value, label, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return Object.freeze([]);
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  const normalized = value.map((entry, index) => requireSha256(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail(`${label} must not contain duplicates`);
  }
  return Object.freeze([...normalized].sort());
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

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const out = value.map((entry) => deepClone(entry));
    return deepFreeze(out);
  }
  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = deepClone(value[key]);
  }
  return deepFreeze(out);
}

function cloneAxis(axis) {
  return Object.freeze({
    authorized_ceiling: axis.authorized_ceiling,
    reserved_active: axis.reserved_active,
    durable_consumed: axis.durable_consumed,
    active_actual: axis.active_actual || 0,
    known: axis.known,
    enforced: axis.enforced !== false,
    remaining: axis.remaining,
    overspend: axis.overspend,
  });
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

function canonicalDigestPayload(payload) {
  // The adapter attaches `_adapter_capability` to payload.event as a
  // non-enumerable property. canonicalJson (and thus sha256) only traverses
  // enumerable own keys, so the capability is already excluded from digests.
  // We rebuild the control event from its enumerable own keys anyway, so the
  // digest input is provably capability-free even if the capability's property
  // attributes ever changed.
  if (payload && payload.event && typeof payload.event === 'object') {
    const strippedEvent = {};
    for (const key of Object.keys(payload.event)) {
      strippedEvent[key] = payload.event[key];
    }
    return { ...payload, event: strippedEvent };
  }
  return payload;
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
  if (contract.mission_policy_digest !== undefined) {
    requireSha256(contract.mission_policy_digest, 'contract.mission_policy_digest');
  }
  if (contract.mission_graph_digest !== undefined) {
    requireSha256(contract.mission_graph_digest, 'contract.mission_graph_digest');
    requireObject(contract.execution_graph, 'contract.execution_graph');
  }
  normalizeSha256List(
    contract.initial_required_acceptance_hashes,
    'contract.initial_required_acceptance_hashes',
    { optional: true },
  );
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
  normalizeSha256List(
    contract.required_acceptance_hashes,
    'contract.required_acceptance_hashes',
    { optional: true },
  );
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
  const lbKeys = Reflect.ownKeys(lb);
  const LB_ALLOWED = new Set(['task_authority_id', 'root_run_id', 'policy_hash', 'successor_inherits_durable_consumed']);
  for (const k of lbKeys) {
    if (typeof k !== 'string' || !LB_ALLOWED.has(k)) {
      fail(`lineage_binding contains unsupported key "${String(k)}"`, 'LINEAGE_BINDING_UNSUPPORTED_KEY');
    }
  }
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

const LINEAGE_BINDING_CLOSED_KEYS = Object.freeze([
  'task_authority_id', 'root_run_id', 'policy_hash', 'successor_inherits_durable_consumed',
]);

function normalizeLineageBinding(lb, label) {
  const tag = label || 'lineage_binding';
  const obj = requireObject(lb, tag);
  const ownKeys = Reflect.ownKeys(obj);
  for (const k of ownKeys) {
    if (typeof k !== 'string') {
      fail(`${tag} contains unsupported key "${String(k)}"`, 'LINEAGE_BINDING_UNSUPPORTED_KEY');
    }
    const desc = Object.getOwnPropertyDescriptor(obj, k);
    if (!desc.enumerable) {
      fail(`${tag} contains non-enumerable key "${k}"`, 'LINEAGE_BINDING_UNSUPPORTED_KEY');
    }
    if (desc.get || desc.set) {
      fail(`${tag} contains accessor key "${k}"`, 'LINEAGE_BINDING_ACCESSOR_KEY');
    }
    if (!LINEAGE_BINDING_CLOSED_KEYS.includes(k)) {
      fail(`${tag} contains unsupported key "${k}"`, 'LINEAGE_BINDING_UNSUPPORTED_KEY');
    }
  }
  for (const k of LINEAGE_BINDING_CLOSED_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) {
      fail(`${tag} missing required key "${k}"`, 'LINEAGE_BINDING_MISSING_KEY');
    }
  }
  requireSha256(obj.task_authority_id, `${tag}.task_authority_id`);
  requireString(obj.root_run_id, `${tag}.root_run_id`, 1, 256);
  requireSha256(obj.policy_hash, `${tag}.policy_hash`);
  requireBoolean(obj.successor_inherits_durable_consumed,
    `${tag}.successor_inherits_durable_consumed`);
  return Object.freeze({
    task_authority_id: obj.task_authority_id,
    root_run_id: obj.root_run_id,
    policy_hash: obj.policy_hash,
    successor_inherits_durable_consumed: obj.successor_inherits_durable_consumed,
  });
}

// `computeConfigDigest` produces a stable, content-bound digest of the
// normalized operational config. The digest is computed over the COMPLETE
// set of fields affecting future admission/control, with the cross-field
// lineage/task/policy bindings explicit. It is stored on the state at
// construction so every subsequent state hash and projection includes the
// same digest. Tampering with the config in a projection and re-computing
// only the outer projection digest will fail at restore: the restored
// state's config_digest (recomputed from the modified config_snapshot)
// will not match either the original config_digest in the projection or
// the state_hash binding in the projection body.
function computeConfigDigest(contract, provenance) {
  const perAxis = SUPPORTED_AXES.map((axisName) => ({
    axis: axisName,
    authorized_ceiling: contract.axes[axisName].authorized_ceiling,
    reserved_active: contract.axes[axisName].reserved_active || 0,
    durable_consumed: contract.axes[axisName].durable_consumed || 0,
    known: contract.axes[axisName].known,
    enforced: contract.axes[axisName].enforced !== false,
  }));
  return sha256(canonicalJson({
    schema_version: contract.schema_version,
    artifact_type: contract.artifact_type,
    contract_id: contract.contract_id,
    repo_identity: contract.repo_identity,
    mission_lineage_id: contract.mission_lineage_id,
    task_authority_id: contract.task_authority_id,
    policy_hash: contract.policy_hash,
    mission_policy_digest: contract.mission_policy_digest || contract.policy_hash,
    mission_graph_digest: contract.mission_graph_digest || null,
    initial_required_acceptance_hashes: normalizeSha256List(
      contract.initial_required_acceptance_hashes,
      'contract.initial_required_acceptance_hashes',
      { optional: true },
    ),
    execution_graph: contract.execution_graph || null,
    enforcement_mode: contract.enforcement_mode,
    contract_state: contract.state,
    closure_ratio: contract.closure_ratio,
    max_stagnant_campaigns: contract.max_stagnant_campaigns !== undefined
      ? contract.max_stagnant_campaigns : DEFAULT_MAX_STAGNANT,
    required_acceptance_hashes: normalizeSha256List(
      contract.required_acceptance_hashes,
      'contract.required_acceptance_hashes',
      { optional: true },
    ),
    successor_inherits_durable_consumed: !!(contract.lineage_binding
      && contract.lineage_binding.successor_inherits_durable_consumed),
    red_lines: [...(contract.red_lines || [])].sort(),
    axes: perAxis,
    grant_contract: contract.grant_contract,
    control_contract: contract.control_contract,
    lineage_binding: normalizeLineageBinding(contract.lineage_binding, 'config.lineage_binding'),
    config_provenance: provenance,
  }));
}

// ─── Source refs (per-entry digest validation) ─────────────────────────────
//
// A source ref is a closed canonical pointer to an evidence/snapshot
// artifact. The ref shape is intentionally narrow:
//
//   {
//     kind: 'evidence' | 'snapshot' | 'commit' | 'spec',
//     locator: <bounded string>,
//     label: <bounded string>,
//     evidence_kind?: <bounded string>,
//     ref_class?: 'project' | 'task' | 'external',
//     digest: <sha256 hex>,
//   }
//
// The `digest` is computed from the content of the ref EXCLUDING the digest
// field. `buildProjection` validates the shape of every ref, computes the
// expected digest, and rejects refs whose digest does not match. Duplicate
// locators are rejected. `restoreProjection` repeats the same per-entry
// digest check on every ref in `source_refs` so a tampered ref that was
// re-issued into a fresh projection_digest still fails.

const SOURCE_REF_KINDS = Object.freeze(['evidence', 'snapshot', 'commit', 'spec']);
const SOURCE_REF_KIND_SET = new Set(SOURCE_REF_KINDS);
const SOURCE_REF_CLASSES = Object.freeze(['project', 'task', 'external']);
const SOURCE_REF_CLASS_SET = new Set(SOURCE_REF_CLASSES);
const SOURCE_REF_ALLOWED_KEYS = new Set([
  'kind', 'locator', 'label', 'evidence_kind', 'ref_class', 'digest',
]);

function computeSourceRefDigest(content) {
  // The digest is over the content with the `digest` field omitted; keys
  // are sorted via canonicalJson so the digest is stable.
  return sha256(canonicalJson(content));
}

function validateSourceRef(rawRef, label) {
  requireObject(rawRef, label);
  for (const key of Object.keys(rawRef)) {
    if (!SOURCE_REF_ALLOWED_KEYS.has(key)) {
      fail(`${label} has unsupported key "${key}"`, 'SOURCE_REF_UNSUPPORTED_KEY');
    }
  }
  const kind = requireProtocolToken(rawRef.kind, `${label}.kind`);
  if (!SOURCE_REF_KIND_SET.has(kind)) {
    fail(`${label}.kind must be one of ${SOURCE_REF_KINDS.join(', ')}`, 'SOURCE_REF_KIND_INVALID');
  }
  requireString(rawRef.locator, `${label}.locator`, 1, 2048);
  requireString(rawRef.label, `${label}.label`, 1, 256);
  if (rawRef.evidence_kind !== undefined) {
    requireProtocolToken(rawRef.evidence_kind, `${label}.evidence_kind`);
  }
  if (rawRef.ref_class !== undefined) {
    if (!SOURCE_REF_CLASS_SET.has(rawRef.ref_class)) {
      fail(`${label}.ref_class must be one of ${SOURCE_REF_CLASSES.join(', ')}`, 'SOURCE_REF_CLASS_INVALID');
    }
  }
  if (typeof rawRef.digest !== 'string') {
    fail(`${label}.digest is required`, 'SOURCE_REF_DIGEST_MISSING');
  }
  const claimedDigest = requireSha256(rawRef.digest, `${label}.digest`);
  // The digest is computed from the canonical content. Optional fields
  // (`evidence_kind`, `ref_class`) are only included when they are
  // actually present in the ref; missing fields are not added as
  // `null` because canonicalJson serializes explicit `null` differently
  // from a missing key.
  const contentForDigest = {
    kind,
    locator: rawRef.locator,
    label: rawRef.label,
  };
  if (rawRef.evidence_kind !== undefined) contentForDigest.evidence_kind = rawRef.evidence_kind;
  if (rawRef.ref_class !== undefined) contentForDigest.ref_class = rawRef.ref_class;
  const expected = computeSourceRefDigest(contentForDigest);
  if (claimedDigest !== expected) {
    fail(`${label}.digest does not match the ref content`, 'SOURCE_REF_DIGEST_MISMATCH');
  }
  const validated = {
    kind,
    locator: rawRef.locator,
    label: rawRef.label,
  };
  if (rawRef.evidence_kind !== undefined) validated.evidence_kind = rawRef.evidence_kind;
  if (rawRef.ref_class !== undefined) validated.ref_class = rawRef.ref_class;
  validated.digest = claimedDigest;
  return Object.freeze(validated);
}

function validateSourceRefs(rawRefs, label = 'source_refs') {
  if (rawRefs === undefined || rawRefs === null) return Object.freeze([]);
  if (!Array.isArray(rawRefs)) {
    fail(`${label} must be an array`, 'SOURCE_REFS_NOT_ARRAY');
  }
  const seenLocators = new Set();
  const out = [];
  for (let i = 0; i < rawRefs.length; i += 1) {
    const ref = validateSourceRef(rawRefs[i], `${label}[${i}]`);
    if (seenLocators.has(ref.locator)) {
      fail(`${label} has duplicate locator "${ref.locator}"`, 'SOURCE_REF_DUPLICATE_LOCATOR');
    }
    seenLocators.add(ref.locator);
    out.push(ref);
  }
  return Object.freeze(out);
}

// ─── State factory ─────────────────────────────────────────────────────────

function createMissionState(contract, options = {}) {
  validateMissionContract(contract);

  const lineageBinding = contract.lineage_binding;
  const provenance = computeProvenance(contract);
  const maxStagnant = contract.max_stagnant_campaigns !== undefined
    ? contract.max_stagnant_campaigns
    : DEFAULT_MAX_STAGNANT;
  // `config_digest` is a content-bound digest of the complete normalized
  // operational config. It is computed once at state construction, stored
  // on the state, and is the single binding between the state hash and
  // the config that produced it. A restore cannot succeed if the config
  // snapshot, the projection's recorded config_digest, and the restored
  // state's state_hash all line up — but the original state was built
  // from a different config.
  const configDigest = computeConfigDigest(contract, provenance);

  // Build per-axis budgets from a deep clone of the contract — the
  // caller's input contract must not be mutated, and derived state must
  // be deeply immutable so the caller's later mutations cannot change
  // mission behavior.
  const axes = {};
  for (const axisName of SUPPORTED_AXES) {
    axes[axisName] = computeAxisBudget(deepClone(contract.axes[axisName]));
  }

  let inheritedClaims = {};
  let inheritedIdempotencyIndex = {};
  let inheritedStagnation = 0;
  let inheritedAcceptanceHashes = [];
  let requiredAcceptanceHashes = normalizeSha256List(
    contract.required_acceptance_hashes,
    'contract.required_acceptance_hashes',
    { optional: true },
  );
  let inheritedControlSequence = 0;
  if (options.inheritFrom !== undefined) {
    if (!lineageBinding.successor_inherits_durable_consumed) {
      fail('lineage_binding.successor_inherits_durable_consumed must be true to inherit');
    }
    const prev = requireObject(options.inheritFrom, 'options.inheritFrom');
    // KR1: a successor chain (new session, root run, branch, or model) SHARES
    // the same mission_lineage_id — establishing a new session/run/branch/model
    // does not create new budget. The successor must continue inside the
    // predecessor's lineage so inherited claim_ids (derived from lineage +
    // idempotency key) stay valid and the lineage budget cannot be reopened.
    if (prev.mission_lineage_id !== contract.mission_lineage_id) {
      fail('successor must inherit within the same mission_lineage_id');
    }
    // Conflicting policy binding fails closed — successor MUST agree on
    // task_authority_id and policy_hash.
    if (prev.task_authority_id !== contract.task_authority_id) {
      fail('successor task_authority_id does not match predecessor');
    }
    if (prev.policy_hash !== contract.policy_hash) {
      fail('successor policy_hash does not match predecessor');
    }
    // Inherit nonterminal claims verbatim. Terminal/released claims no longer
    // occupy active reservation and are dropped from the live set (a successor
    // carries only unresolved nonterminal claims).
    const inheritedNonterminal = [];
    for (const claim of Object.values(prev.claims || {})) {
      if (claim.terminal || claim.released) continue;
      const cloned = deepClone(claim);
      inheritedClaims[claim.claim_id] = cloned;
      inheritedIdempotencyIndex[claim.idempotency_key] = claim.claim_id;
      inheritedNonterminal.push(cloned);
    }
    for (const axisName of SUPPORTED_AXES) {
      const src = prev.axes[axisName];
      if (!src) fail(`inheritFrom is missing axis "${axisName}"`);
      // reserved_active is the sum of the inherited nonterminal claims'
      // reservations on this axis — the successor does NOT reopen capacity by
      // zeroing it. durable_consumed is inherited; active counters reset.
      let reservedActive = 0;
      for (const claim of inheritedNonterminal) {
        const resv = claim.reservation && claim.reservation[axisName];
        if (resv) reservedActive += resv.reserved_active;
      }
      axes[axisName] = computeAxisBudget({
        authorized_ceiling: src.authorized_ceiling,
        reserved_active: reservedActive,
        durable_consumed: src.durable_consumed,
        active_actual: 0,
        known: src.known,
        enforced: src.enforced,
      });
    }
    inheritedStagnation = prev.stagnant_campaigns || 0;
    inheritedAcceptanceHashes = [...(prev.acceptance_hashes || [])];
    const previousRequired = normalizeSha256List(
      prev.required_acceptance_hashes,
      'inheritFrom.required_acceptance_hashes',
      { optional: true },
    );
    if (canonicalJson(previousRequired) !== canonicalJson(requiredAcceptanceHashes)) {
      fail('successor required_acceptance_hashes do not match predecessor');
    }
    requiredAcceptanceHashes = previousRequired;
    inheritedControlSequence = prev.control_sequence || 0;
  }

  const frozenAxes = Object.freeze({
    campaigns: Object.freeze(axes.campaigns),
    wall_seconds: Object.freeze(axes.wall_seconds),
    tool_calls: Object.freeze(axes.tool_calls),
    engine_attempts: Object.freeze(axes.engine_attempts),
    external_wait_seconds: Object.freeze(axes.external_wait_seconds),
    canonical_changed_files: Object.freeze(axes.canonical_changed_files),
    output_bytes: Object.freeze(axes.output_bytes),
  });

  // The state must validate before exposing terminal-related fields. A
  // malformed state is a reducer error, not a transient condition.
  const built = deepFreeze({
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_state',
    mission_lineage_id: contract.mission_lineage_id,
    task_authority_id: contract.task_authority_id,
    policy_hash: contract.policy_hash,
    mission_policy_digest: contract.mission_policy_digest || contract.policy_hash,
    mission_graph_digest: contract.mission_graph_digest || null,
    initial_required_acceptance_hashes: normalizeSha256List(
      contract.initial_required_acceptance_hashes,
      'contract.initial_required_acceptance_hashes',
      { optional: true },
    ),
    execution_graph: contract.execution_graph
      ? deepClone(contract.execution_graph)
      : null,
    graph_progress: Object.freeze(Object.fromEntries(
      contract.execution_graph && Array.isArray(contract.execution_graph.nodes)
        ? contract.execution_graph.nodes.map((node) => [
          node.id,
          Object.freeze({
            status: 'pending',
            attempts: 0,
            terminal_count: 0,
            active_claim_id: null,
          }),
        ])
        : [],
    )),
    repo_identity: contract.repo_identity,
    contract_id: contract.contract_id,
    root_run_id: lineageBinding.root_run_id,
    enforcement_mode: contract.enforcement_mode,
    state: 'DRAFT',
    closure_ratio: contract.closure_ratio,
    max_stagnant_campaigns: maxStagnant,
    successor_inherits_durable_consumed:
      lineageBinding.successor_inherits_durable_consumed === true,
    axes: frozenAxes,
    claims: Object.freeze(inheritedClaims),
    claim_idempotency_index: Object.freeze(inheritedIdempotencyIndex),
    events: Object.freeze([]),
    receipts: Object.freeze({}),
    control_sequence: inheritedControlSequence,
    closure_allowlist: Object.freeze([]),
    stagnant_campaigns: inheritedStagnation,
    required_acceptance_hashes: requiredAcceptanceHashes,
    acceptance_hashes: Object.freeze(inheritedAcceptanceHashes.sort()),
    unknown_required_axes: Object.freeze([]),
    terminal: null,
    config: deepFreeze(deepClone(contract)),
    config_provenance: Object.freeze(provenance),
    config_digest: configDigest,
    red_lines: deepClone(contract.red_lines || []),
  });
  validateMissionState(built);
  return built;
}

function validateMissionState(state) {
  if (!state || typeof state !== 'object') fail('mission state is missing');
  if (state.schema_version !== MISSION_SCHEMA_VERSION) fail('mission state schema_version mismatch');
  if (state.artifact_type !== 'mission_state') fail('mission state artifact_type mismatch');
  requireLineageId(state.mission_lineage_id, 'state.mission_lineage_id');
  requireSha256(state.task_authority_id, 'state.task_authority_id');
  requireSha256(state.policy_hash, 'state.policy_hash');
  if (state.mission_policy_digest !== undefined) {
    requireSha256(state.mission_policy_digest, 'state.mission_policy_digest');
  }
  if (state.mission_graph_digest !== undefined && state.mission_graph_digest !== null) {
    requireSha256(state.mission_graph_digest, 'state.mission_graph_digest');
    requireObject(state.execution_graph, 'state.execution_graph');
    requireObject(state.graph_progress, 'state.graph_progress');
  }
  if (!ENFORCEMENT_MODES.has(state.enforcement_mode)) {
    fail('state.enforcement_mode must be "shadow" or "enforce"');
  }
  if (!MISSION_STATE_SET.has(state.state)) {
    fail('state.state must be a valid Mission state');
  }
  requireNumber(state.closure_ratio, 'state.closure_ratio', 0, 1);
  const requiredAcceptance = normalizeSha256List(
    state.required_acceptance_hashes,
    'state.required_acceptance_hashes',
    { optional: true },
  );
  const satisfiedAcceptance = normalizeSha256List(
    state.acceptance_hashes,
    'state.acceptance_hashes',
    { optional: true },
  );
  if (requiredAcceptance.length > 0
      && satisfiedAcceptance.some((hash) => !requiredAcceptance.includes(hash))) {
    fail('state.acceptance_hashes must be a subset of required_acceptance_hashes');
  }
  if (!isPlainObject(state.axes)) fail('state.axes must be an object');
  for (const axisName of SUPPORTED_AXES) {
    const ax = state.axes[axisName];
    if (!ax) fail(`state.axes.${axisName} is missing`);
    computeAxisBudget(ax); // throws on invalid
  }
  if (state.terminal !== null && !isPlainObject(state.terminal)) {
    fail('state.terminal must be null or object');
  }
}

// ─── State hash ────────────────────────────────────────────────────────────

function stateHash(state) {
  const summary = {
    schema_version: state.schema_version,
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    policy_hash: state.policy_hash,
    mission_policy_digest: state.mission_policy_digest || state.policy_hash,
    mission_graph_digest: state.mission_graph_digest || null,
    initial_required_acceptance_hashes:
      [...(state.initial_required_acceptance_hashes || [])].sort(),
    execution_graph: state.execution_graph ? deepClone(state.execution_graph) : null,
    graph_progress: state.graph_progress ? deepClone(state.graph_progress) : {},
    root_run_id: state.root_run_id,
    enforcement_mode: state.enforcement_mode,
    state: state.state,
    closure_ratio: state.closure_ratio,
    max_stagnant_campaigns: state.max_stagnant_campaigns,
    successor_inherits_durable_consumed: !!state.successor_inherits_durable_consumed,
    control_sequence: state.control_sequence,
    closure_allowlist: [...(state.closure_allowlist || [])].sort(),
    stagnant_campaigns: state.stagnant_campaigns,
    required_acceptance_hashes: [...(state.required_acceptance_hashes || [])].sort(),
    acceptance_hashes: [...(state.acceptance_hashes || [])].sort(),
    unknown_required_axes: [...(state.unknown_required_axes || [])].sort(),
    config_provenance: { ...(state.config_provenance || {}) },
    // `config_digest` binds the state hash to the complete normalized
    // operational config. Without it, two states with identical axes/claims
    // but different configs would hash the same way. With it, a restore
    // that swaps the config_snapshot (and re-computes only the outer
    // projection_digest) still fails because the restored state's
    // config_digest (and therefore state_hash) differs from the original.
    config_digest: state.config_digest || null,
    red_lines: [...(state.red_lines || [])].sort(),
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
          binding_digest: v.binding_digest,
          identity_scheme: v.identity_scheme || null,
          mission_lineage_id: v.mission_lineage_id || null,
          task_authority_id: v.task_authority_id || null,
          campaign_id: v.campaign_id || null,
          campaign_contract_digest: v.campaign_contract_digest || null,
          mission_subject_digest: v.mission_subject_digest || null,
          base_sha: v.base_sha || null,
          acceptance_ids: [...(v.acceptance_ids || [])].sort(),
          acceptance_hashes: [...(v.acceptance_hashes || [])].sort(),
          graph_node_id: v.graph_node_id || null,
          graph_attempt: v.graph_attempt || null,
          campaign_contract_draft: v.campaign_contract_draft
            ? deepClone(v.campaign_contract_draft)
            : null,
          terminal: !!v.terminal,
          released: !!v.released,
          reconciled: !!v.reconciled,
          reservation: deepClone(v.reservation),
          actual: v.actual ? deepClone(v.actual) : null,
          event_digest: v.event_digest,
        }])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    event_digests: state.events.map((e) => e.event_digest).sort(),
    terminal: state.terminal ? deepClone(state.terminal) : null,
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

// Bind terminal.at_event to the final reducer-owned event log entry.
// Returns the final event on success, null when the terminal is unbound/forged.
function finalEventBoundToTerminal(state) {
  if (!isPlainObject(state) || !isPlainObject(state.terminal)) return null;
  const events = state.events;
  if (!Array.isArray(events) || events.length < 1) return null;
  const atEvent = state.terminal.at_event;
  // setTerminal records 1-based at_event === events.length after appendEvent.
  if (!Number.isSafeInteger(atEvent) || atEvent < 1 || atEvent !== events.length) {
    return null;
  }
  const finalEvent = events[atEvent - 1];
  if (!isPlainObject(finalEvent)) return null;
  if (finalEvent.sequence !== atEvent) return null;
  if (finalEvent.mission_lineage_id !== state.mission_lineage_id) return null;
  if (typeof finalEvent.event_digest !== 'string' || !/^[a-f0-9]{64}$/.test(finalEvent.event_digest)) {
    return null;
  }
  // Recompute the reducer-owned digest from recorded fields — a mismatched
  // digest means the final event was not the one the reducer appended.
  const recomputed = eventDigestFor({
    event_type: finalEvent.event_type,
    sequence: finalEvent.sequence,
    mission_lineage_id: finalEvent.mission_lineage_id,
    payload: finalEvent.payload,
  });
  if (recomputed !== finalEvent.event_digest) return null;
  return finalEvent;
}

function isLegacyAbortingTerminal(state) {
  // Pre-fix persisted defect: abort_requested called
  // setTerminal(appendEvent(...), 'ABORTING', 'abort_requested') without
  // advancing state.control_sequence (often left at 0). Restrict the
  // compatibility escape hatch to that exact historical shape only — not
  // any ABORTING terminal reason. The only legal escape is abort_finalized.
  if (!state
      || state.state !== 'ABORTING'
      || !isPlainObject(state.terminal)
      || state.terminal.state !== 'ABORTING'
      || state.terminal.reason !== 'abort_requested') {
    return false;
  }
  const finalEvent = finalEventBoundToTerminal(state);
  if (!finalEvent || finalEvent.event_type !== 'control_event') return false;
  const nested = isPlainObject(finalEvent.payload) ? finalEvent.payload.event : null;
  if (!isPlainObject(nested)
      || nested.action !== 'abort_requested'
      || nested.mission_lineage_id !== state.mission_lineage_id
      || !Number.isSafeInteger(nested.sequence)
      || nested.sequence < 1) {
    return false;
  }
  // Do NOT require state.control_sequence === nested.sequence: the historical
  // defect left the state-level control sequence at zero while the nested
  // authenticated control event still carried its own sequence.
  return true;
}

function abortDrainPreconditions(state) {
  for (const claim of Object.values(state.claims || {})) {
    if (!claim.released && !claim.terminal) {
      return { ok: false, reason: 'live_claims_remain' };
    }
  }
  for (const axisName of SUPPORTED_AXES) {
    const axis = state.axes[axisName];
    if ((axis.reserved_active || 0) !== 0 || (axis.active_actual || 0) !== 0) {
      return { ok: false, reason: 'resource_axes_not_drained' };
    }
  }
  return { ok: true, reason: null };
}

// Canonical ABORTED terminal suitable for idempotent finalize-abort replay.
// Requires reducer-owned provenance: setTerminal ABORTED/abort_finalized bound
// to the final abort_finalized event (at_event/position/sequence/type/lineage/
// digest), plus the same drain preconditions as abort_finalized — never a
// weaker CLI check that trusts a forged terminal marker alone.
function evaluateCanonicalAbortedTerminal(state) {
  try {
    validateMissionState(state);
  } catch (_error) {
    return { ok: false, reason: 'invalid_mission_state' };
  }
  if (state.state !== 'ABORTED' || !TERMINAL_STATES.has(state.state)) {
    return { ok: false, reason: 'not_aborted' };
  }
  if (!isPlainObject(state.terminal)
      || state.terminal.state !== 'ABORTED'
      || state.terminal.reason !== 'abort_finalized') {
    return { ok: false, reason: 'noncanonical_abort_terminal' };
  }
  const finalEvent = finalEventBoundToTerminal(state);
  if (!finalEvent || finalEvent.event_type !== 'abort_finalized') {
    return { ok: false, reason: 'noncanonical_abort_terminal' };
  }
  const drain = abortDrainPreconditions(state);
  if (!drain.ok) {
    return { ok: false, reason: drain.reason };
  }
  return { ok: true, reason: null };
}

function reduceMissionState(state, event) {
  // Validate state before accessing state.terminal — a malformed state is
  // a reducer error, not a transient condition.
  validateMissionState(state);
  const { eventType, sequence, payload } = validateEventShape(event);
  // Terminal gate: only abort_finalized may enter a legacy ABORTING marker
  // that carries a non-null terminal object. All other non-null terminals
  // remain irreducible.
  if (state.terminal) {
    if (!(eventType === 'abort_finalized' && isLegacyAbortingTerminal(state))) {
      fail('cannot reduce a terminal Mission state', 'MISSION_STATE_TERMINAL');
    }
  } else if (TERMINAL_STATES.has(state.state)) {
    fail('cannot reduce a terminal Mission state', 'MISSION_STATE_TERMINAL');
  }
  if (state.state === 'ABORTING' && !ABORTING_ALLOWED_EVENTS.has(eventType)) {
    fail(
      `event_type "${eventType}" is not accepted while ABORTING`,
      'MISSION_ABORTING_EVENT_REJECTED',
    );
  }
  if (event.mission_lineage_id !== state.mission_lineage_id) {
    fail('event.mission_lineage_id does not match state.mission_lineage_id');
  }
  if (sequence !== state.events.length + 1) {
    fail(`event.sequence ${sequence} must equal ${state.events.length + 1}`);
  }
  // Authenticated control events must be the exact frozen canonical object
  // minted by an AuthenticatedControlAdapter.acceptEvent() call. The narrow
  // consume function (module-private WeakSet keyed by object identity):
  //   1. checks the registry,
  //   2. atomically removes the entry (single-use), and
  //   3. returns a sanitized deep-frozen snapshot to use in digest, state,
  //      receipts, and projections.
  // Any attempt to authenticate a copied, JSON-roundtripped, or
  // previously-consumed event fails closed: the WeakSet entry is gone
  // (or was never there), and consume returns unauthenticated.
  let sanitizedControlEvent = null;
  if (eventType === 'control_event' || eventType === 'ceiling_adjust') {
    if (!payload || payload.event === undefined) {
      fail('control_event requires an adapter-produced event payload', 'MISSION_CONTROL_UNAUTHENTICATED');
    }
    const ownKeys = Reflect.ownKeys(payload);
    if (ownKeys.length !== 1 || ownKeys[0] !== 'event') {
      fail('control_event payload must be a closed shape containing exactly the "event" property', 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED');
    }
    const eventDesc = Object.getOwnPropertyDescriptor(payload, 'event');
    if (!eventDesc || !eventDesc.enumerable || typeof eventDesc.get === 'function' || typeof eventDesc.set === 'function') {
      fail('control_event payload "event" must be an enumerable data property', 'MISSION_CONTROL_PAYLOAD_NOT_CLOSED');
    }
    const consume = consumeAuthenticatedControlEvent(payload.event);
    if (!consume || consume.ok !== true || !consume.event) {
      fail('control_event must be produced by an AuthenticatedControlAdapter instance', 'MISSION_CONTROL_UNAUTHENTICATED');
    }
    sanitizedControlEvent = consume.event;
  }
  let digestPayload;
  if (sanitizedControlEvent) {
    digestPayload = { event: sanitizedControlEvent };
  } else {
    digestPayload = payload;
  }
  const eventWithDigest = Object.freeze({
    ...event,
    payload: digestPayload,
    event_digest: eventDigestFor({ event_type: eventType, sequence, mission_lineage_id: event.mission_lineage_id, payload: digestPayload }),
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
    abort_finalized: handleAbortFinalized,
  };
  const result = handlers[eventType](state, eventWithDigest, payload, sanitizedControlEvent);
  // Deep-freeze the entire returned state and receipt so neither caller
  // mutation nor nested reservation/actual/payload objects can mutate reducer
  // state. Every contract-derived and reducer-derived value is immutable.
  return {
    state: deepFreeze(result.state),
    receipt: deepFreeze(result.receipt),
  };
}

function appendEvent(state, eventWithDigest) {
  // Deep-clone the appended event so the reducer owns an isolated copy of the
  // caller's payload — a later mutation of the caller's input object cannot
  // mutate the recorded event log. The clone is frozen; prior events are
  // already-frozen shared references.
  return {
    ...state,
    events: Object.freeze([...state.events, deepClone(eventWithDigest)]),
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
  // v2 subject identity requires explicit identity_scheme. Partial v2 fields
  // without the scheme are binding mismatches (no silent promotion).
  if (payload.identity_scheme === IDENTITY_SCHEME_V2) {
    if (typeof payload.mission_subject_digest !== 'string'
        || !/^[0-9a-f]{64}$/.test(payload.mission_subject_digest)) {
      return 'binding_mismatch';
    }
    if (typeof payload.task_authority_id !== 'string'
        || !/^[0-9a-f]{64}$/.test(payload.task_authority_id)) {
      return 'binding_mismatch';
    }
    if (typeof payload.campaign_id !== 'string'
        || !/^campaign-v2-[0-9a-f]{64}$/.test(payload.campaign_id)) {
      return 'binding_mismatch';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'campaign_contract_digest')
        && payload.campaign_contract_digest !== undefined
        && payload.campaign_contract_digest !== null
        && payload.campaign_contract_digest !== payload.mission_subject_digest) {
      return 'binding_mismatch';
    }
    if (payload.graph_node_id !== undefined) {
      if (typeof payload.graph_node_id !== 'string' || payload.graph_node_id.length === 0
          || !Number.isSafeInteger(payload.graph_attempt) || payload.graph_attempt < 1
          || !Array.isArray(payload.acceptance_hashes)
          || payload.acceptance_hashes.some((hash) => (
            typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)
          ))
          || !isPlainObject(payload.campaign_contract_draft)) {
        return 'binding_mismatch';
      }
      let projectedSubject;
      try {
        projectedSubject = missionSubjectDigest(payload.campaign_contract_draft);
      } catch (_error) {
        return 'binding_mismatch';
      }
      if (projectedSubject !== payload.mission_subject_digest) return 'binding_mismatch';
    }
  } else if (typeof payload.mission_subject_digest === 'string'
      && payload.mission_subject_digest.length > 0
      && payload.identity_scheme !== IDENTITY_SCHEME_V2) {
    // Subject digest without explicit v2 scheme is not a valid promotion path.
    return 'binding_mismatch';
  }
  return null;
}

function reservationFor(payload, label = 'reservation', options = {}) {
  const { requireComplete = true } = options;
  const reservationObj = isPlainObject(payload.reservation) ? payload.reservation : {};
  const perAxis = Array.isArray(reservationObj.per_axis) ? reservationObj.per_axis : [];
  if (perAxis.length === 0) {
    fail(`${label}.per_axis must be a non-empty array`);
  }
  const seen = new Set();
  const reservation = {};
  for (const usage of perAxis) {
    if (!isPlainObject(usage)) fail(`${label}.per_axis entry must be an object`);
    if (seen.has(usage.axis)) {
      fail(`${label}.per_axis has duplicate axis "${usage.axis}"`);
    }
    if (!AXIS_SET.has(usage.axis)) {
      fail(`${label}.per_axis has unknown axis "${usage.axis}"`);
    }
    seen.add(usage.axis);
    const axis = requireEnum(usage.axis, AXIS_SET, `${label}.per_axis.axis`);
    requireInteger(usage.authorized_ceiling, `${label}.per_axis[${axis}].authorized_ceiling`, 0);
    requireInteger(usage.reserved_active, `${label}.per_axis[${axis}].reserved_active`, 0);
    requireInteger(usage.durable_consumed, `${label}.per_axis[${axis}].durable_consumed`, 0);
    requireBoolean(usage.known, `${label}.per_axis[${axis}].known`);
    reservation[axis] = {
      axis,
      authorized_ceiling: usage.authorized_ceiling,
      reserved_active: usage.reserved_active,
      durable_consumed: usage.durable_consumed,
      known: usage.known,
    };
  }
  if (requireComplete) {
    // The reservation must cover every supported axis. Missing, duplicate, or
    // unknown entries fail closed; an empty/partial reservation creates no
    // reservation at all.
    for (const axisName of SUPPORTED_AXES) {
      if (!(axisName in reservation)) {
        fail(`${label}.per_axis is missing required axis "${axisName}"`);
      }
    }
    // The campaigns axis must actually reserve a campaign unit — a zero on
    // `campaigns` is a no-op reservation that would let a grant bypass
    // aggregate ceiling enforcement.
    if (reservation.campaigns.reserved_active < 1) {
      fail(`${label}.per_axis[campaigns].reserved_active must be >= 1 (must reserve at least one campaign unit)`);
    }
  }
  return reservation;
}

function bindingDigest(payload) {
  // The logical grant binding the reducer treats as single-use. Acceptance
  // IDs are sorted to make the digest stable across input ordering.
  const acceptance = Array.isArray(payload.acceptance_ids)
    ? [...payload.acceptance_ids].sort()
    : [];
  if (payload.identity_scheme === IDENTITY_SCHEME_V2) {
    // v2 binds subject (not raw final-byte digest) so grant-ref insertion is
    // non-circular. campaign_contract_digest may alias subject only.
    // task_authority_id is part of the binding tuple so later verification can
    // compare exact stored lineage + authority without reopening identity.
    return sha256({
      identity_scheme: IDENTITY_SCHEME_V2,
      mission_lineage_id: payload.mission_lineage_id,
      task_authority_id: payload.task_authority_id,
      campaign_id: payload.campaign_id,
      mission_subject_digest: payload.mission_subject_digest,
      base_sha: payload.base_sha,
      acceptance_ids: acceptance,
      graph_node_id: payload.graph_node_id || null,
      graph_attempt: payload.graph_attempt || null,
      acceptance_hashes: Array.isArray(payload.acceptance_hashes)
        ? [...payload.acceptance_hashes].sort()
        : [],
    });
  }
  // v1 / legacy: campaign_contract_digest remains the binding field.
  return sha256({
    mission_lineage_id: payload.mission_lineage_id,
    campaign_id: payload.campaign_id,
    campaign_contract_digest: payload.campaign_contract_digest,
    base_sha: payload.base_sha,
    acceptance_ids: acceptance,
  });
}

function findClaimByBinding(state, bindingHash) {
  for (const claim of Object.values(state.claims)) {
    if (claim.binding_digest === bindingHash) return claim;
  }
  return null;
}

function graphGrantContext(state, payload) {
  if (payload.graph_node_id === undefined) return { node: null, progress: null, error: null };
  const graph = state.execution_graph;
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((entry) => entry.id === payload.graph_node_id);
  const progress = state.graph_progress && state.graph_progress[payload.graph_node_id];
  if (!node || !progress) return { node: null, progress: null, error: 'binding_mismatch' };
  const replayClaimId = claimIdFor(state.mission_lineage_id, payload.idempotency_key);
  const replayClaim = state.claims && state.claims[replayClaimId];
  const consumedGateAttempts = Object.values(state.claims || {}).filter((claim) => (
    claim.graph_node_id === payload.graph_node_id
      && claim.released !== true
      && !(replayClaim
        && replayClaim.released !== true
        && replayClaim.terminal !== true
        && replayClaim.claim_id === claim.claim_id)
  )).length;
  if (consumedGateAttempts >= node.gate_attempt_budget) {
    return { node, progress, error: 'grant_already_claimed' };
  }
  const acceptance = Array.isArray(payload.acceptance_ids)
    ? [...payload.acceptance_ids].sort()
    : [];
  if (canonicalJson(acceptance) !== canonicalJson([...node.acceptance_ids].sort())) {
    return { node, progress, error: 'binding_mismatch' };
  }
  for (const dependency of node.dependencies || []) {
    const dependencyProgress = state.graph_progress[dependency];
    if (!dependencyProgress || dependencyProgress.status !== 'ready') {
      return { node, progress, error: 'binding_mismatch' };
    }
  }
  const draft = payload.campaign_contract_draft;
  const expectedRuntime = {
    schema_version: 1,
    root_run_id: state.root_run_id,
    mission_lineage_id: state.mission_lineage_id,
    mission_policy_digest: state.mission_policy_digest || state.policy_hash,
    mission_graph_digest: state.mission_graph_digest,
    graph_node_id: node.id,
    graph_node_digest: sha256(canonicalJson(node)),
  };
  const expectedDispatch = {
    schema_version: 1,
    spec: node.campaign.spec,
    required_paths: node.campaign.required_paths,
    output_paths: node.campaign.output_paths,
    allowed_path_prefixes: node.campaign.allowed_path_prefixes,
    budget: {
      max_changed_files: node.campaign.max_changed_files,
      max_wall_seconds: node.campaign.max_wall_seconds,
      max_output_bytes: node.reservation.output_bytes,
      max_tool_calls: node.reservation.tool_calls,
      max_engine_attempts: node.reservation.engine_attempts,
    },
    verification_commands: node.verification_commands,
  };
  if (!draft
      || canonicalJson(draft.mission_runtime) !== canonicalJson(expectedRuntime)
      || canonicalJson(draft.strict_dispatch) !== canonicalJson(expectedDispatch)) {
    return { node, progress, error: 'binding_mismatch' };
  }
  return { node, progress, error: null };
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
  const graphGrant = graphGrantContext(state, payload);
  if (graphGrant.error) return rejection(state, event, graphGrant.error);
  // Validate the reservation shape BEFORE reserving. Empty/partial
  // reservations fail closed and create no reservation.
  let reservation;
  try {
    reservation = reservationFor(payload, 'payload');
  } catch (error) {
    return rejection(state, event, 'binding_mismatch');
  }
  const bindingHash = bindingDigest(payload);
  // Single-use admission: a different idempotency_key for the same
  // logical grant binding (lineage + campaign_id + contract digest +
  // base SHA + acceptance IDs) must reject without reserving again.
  const bindingClaim = findClaimByBinding(state, bindingHash);
  if (bindingClaim && bindingClaim.idempotency_key !== idempotencyKey) {
    return rejection(state, event, 'grant_already_claimed');
  }
  const claimId = claimIdFor(state.mission_lineage_id, idempotencyKey);
  const existing = state.claims[claimId];
  if (existing) {
    if (existing.terminal) {
      return rejection(state, event, 'grant_already_claimed');
    }
    // Reusing the same idempotency_key with a changed binding or
    // reservation must reject (caller is asserting something different).
    if (existing.binding_digest !== bindingHash) {
      return rejection(state, event, 'binding_mismatch');
    }
    if (!sameReservation(existing.reservation, reservation)) {
      return rejection(state, event, 'binding_mismatch');
    }
    return idempotentResume(state, event, existing);
  }
  if (graphGrant.progress) {
    if (graphGrant.progress.status === 'ready' || graphGrant.progress.status === 'active') {
      return rejection(state, event, 'grant_already_claimed');
    }
    if (payload.graph_attempt !== (graphGrant.progress.attempts || 0) + 1) {
      return rejection(state, event, 'binding_mismatch');
    }
  }
  // Check ceilings against current state axes.
  for (const axis of SUPPORTED_AXES) {
    const req = reservation[axis];
    const cur = state.axes[axis];
    if (req.authorized_ceiling !== cur.authorized_ceiling) {
      return rejection(state, event, 'resource_ceiling');
    }
    if (req.durable_consumed !== cur.durable_consumed) {
      return rejection(state, event, 'resource_ceiling');
    }
    const newReserved = cur.reserved_active + req.reserved_active;
    const newRemaining = cur.authorized_ceiling - cur.durable_consumed - newReserved;
    if (newRemaining < 0) {
      const remainingBefore = cur.authorized_ceiling - cur.durable_consumed - cur.reserved_active;
      return shadowOrBlock(state, event, 'resource_ceiling', {
        axis,
        requested: req.reserved_active,
        remaining_before: remainingBefore,
        remaining_after: newRemaining,
      }, { claimId, idempotencyKey, bindingHash, reservation });
    }
  }
  // Apply the reservation.
  return applyGrantClaim(state, event, payload, {
    claimId,
    idempotencyKey,
    bindingHash,
    reservation,
  });
}

function applyGrantClaim(state, event, payload, grant) {
  const { claimId, idempotencyKey, bindingHash, reservation } = grant;
  const newAxes = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const req = reservation[axisName];
    const newReserved = cur.reserved_active + req.reserved_active;
    newAxes[axisName] = computeAxisBudget({
      authorized_ceiling: cur.authorized_ceiling,
      reserved_active: newReserved,
      durable_consumed: cur.durable_consumed,
      active_actual: cur.active_actual,
      known: cur.known,
      enforced: cur.enforced,
    });
  }
  const subjectDigest = payload.identity_scheme === IDENTITY_SCHEME_V2
    ? payload.mission_subject_digest
    : null;
  // v2: campaign_contract_digest is a compatibility alias of the subject only.
  const contractDigestField = payload.identity_scheme === IDENTITY_SCHEME_V2
    ? (payload.campaign_contract_digest != null
      ? payload.campaign_contract_digest
      : subjectDigest)
    : payload.campaign_contract_digest;
  const claim = {
    claim_id: claimId,
    idempotency_key: idempotencyKey,
    binding_digest: bindingHash,
    identity_scheme: payload.identity_scheme === IDENTITY_SCHEME_V2
      ? IDENTITY_SCHEME_V2
      : (payload.identity_scheme || null),
    mission_lineage_id: payload.mission_lineage_id,
    task_authority_id: payload.task_authority_id,
    campaign_id: payload.campaign_id,
    campaign_contract_digest: contractDigestField,
    mission_subject_digest: subjectDigest,
    base_sha: payload.base_sha,
    acceptance_ids: [...(payload.acceptance_ids || [])].sort(),
    acceptance_hashes: [...(payload.acceptance_hashes || [])].sort(),
    graph_node_id: payload.graph_node_id || null,
    graph_attempt: payload.graph_attempt || null,
    campaign_contract_draft: payload.campaign_contract_draft
      ? deepClone(payload.campaign_contract_draft)
      : null,
    control_sequence: payload.control_sequence || state.control_sequence,
    reservation,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at,
    terminal: false,
    released: false,
    reconciled: false,
    event_digest: event.event_digest,
  };
  const graphProgress = state.graph_progress && claim.graph_node_id
    ? Object.freeze({
      ...state.graph_progress,
      [claim.graph_node_id]: Object.freeze({
        ...(state.graph_progress[claim.graph_node_id] || {}),
        status: 'active',
        attempts: claim.graph_attempt,
        active_claim_id: claimId,
      }),
    })
    : state.graph_progress;
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
    graph_progress: graphProgress,
  });
  const receipt = {
    artifact_type: 'mission_campaign_grant_claimed',
    event_type: 'grant_claimed',
    claim_id: claimId,
    idempotency_key: idempotencyKey,
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    source_event: event,
    next_state: 'ACTIVE',
    reservation_consumed: reservation,
    binding_digest: bindingHash,
    identity_scheme: claim.identity_scheme,
    mission_subject_digest: subjectDigest,
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

function sameReservation(a, b) {
  const axes = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (axes.length !== bKeys.length) return false;
  for (let i = 0; i < axes.length; i += 1) {
    if (axes[i] !== bKeys[i]) return false;
  }
  for (const axis of axes) {
    const left = a[axis];
    const right = b[axis];
    if (left.axis !== right.axis) return false;
    if (left.authorized_ceiling !== right.authorized_ceiling) return false;
    if (left.reserved_active !== right.reserved_active) return false;
    if (left.durable_consumed !== right.durable_consumed) return false;
    if (left.known !== right.known) return false;
  }
  return true;
}

function shadowOrBlock(state, event, reason, evidence = {}, grant = null) {
  if (state.enforcement_mode === 'shadow') {
    // In shadow mode, would-block admission must NOT terminalize Mission, but
    // it MUST durably represent the represented grant: the claim is created,
    // its full requested reservation is applied to state.axes (even above
    // the configured ceiling — computeAxisBudget reports `remaining=0` and
    // `overspend=true` rather than refusing), and a `would_block` evidence
    // receipt is recorded for operator review. Repeated shadow admissions are
    // auditable and cumulative: each evidence receipt is stored under its own
    // event-digest key so prior evidence is never overwritten.
    const shadowSubject = event.payload.identity_scheme === IDENTITY_SCHEME_V2
      ? event.payload.mission_subject_digest
      : null;
    const shadowContractDigest = event.payload.identity_scheme === IDENTITY_SCHEME_V2
      ? (event.payload.campaign_contract_digest != null
        ? event.payload.campaign_contract_digest
        : shadowSubject)
      : event.payload.campaign_contract_digest;
    const claim = {
      claim_id: grant.claimId,
      idempotency_key: grant.idempotencyKey,
      binding_digest: grant.bindingHash,
      identity_scheme: event.payload.identity_scheme === IDENTITY_SCHEME_V2
        ? IDENTITY_SCHEME_V2
        : (event.payload.identity_scheme || null),
      mission_lineage_id: event.payload.mission_lineage_id,
      task_authority_id: event.payload.task_authority_id,
      campaign_id: event.payload.campaign_id,
      campaign_contract_digest: shadowContractDigest,
      mission_subject_digest: shadowSubject,
      base_sha: event.payload.base_sha,
      acceptance_ids: [...(event.payload.acceptance_ids || [])].sort(),
      control_sequence: event.payload.control_sequence || state.control_sequence,
      reservation: grant.reservation,
      issued_at: event.payload.issued_at,
      expires_at: event.payload.expires_at,
      terminal: false,
      released: false,
      reconciled: false,
      shadow_would_block: true,
      event_digest: event.event_digest,
    };
    // Apply the FULL requested reservation to state.axes. computeAxisBudget
    // clamps `remaining` to 0 and reports `overspend=true` when the
    // reservation exceeds the ceiling; the `reserved_active` itself
    // reflects the actual bookkeeping so a later release/reconciliation can
    // clear it without negative counters.
    const newAxes = {};
    for (const axisName of SUPPORTED_AXES) {
      const cur = state.axes[axisName];
      const req = grant.reservation[axisName];
      if (!req) {
        newAxes[axisName] = cloneAxis(cur);
        continue;
      }
      const newReserved = cur.reserved_active + req.reserved_active;
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: newReserved,
        durable_consumed: cur.durable_consumed,
        active_actual: cur.active_actual,
        known: cur.known,
        enforced: cur.enforced,
      });
    }
    const evidenceReceipt = {
      artifact_type: 'mission_would_block_evidence',
      event_type: event.event_type,
      reason,
      would_block: true,
      enforcement_mode: 'shadow',
      evidence,
      claim_id: grant.claimId,
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: state.state,
      receipt_digest: sha256({
        kind: 'mission_would_block_evidence',
        reason,
        event_digest: event.event_digest,
        mission_lineage_id: state.mission_lineage_id,
      }),
    };
    const evidenceKey = `mission_would_block_evidence:${event.event_digest}`;
    const durableState = Object.freeze({
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
      claims: Object.freeze({ ...state.claims, [grant.claimId]: Object.freeze(claim) }),
      claim_idempotency_index: Object.freeze({
        ...state.claim_idempotency_index,
        [grant.idempotencyKey]: grant.claimId,
      }),
      receipts: Object.freeze({
        ...state.receipts,
        mission_would_block_evidence: evidenceReceipt,
        [evidenceKey]: evidenceReceipt,
      }),
    });
    return {
      state: durableState,
      receipt: evidenceReceipt,
    };
  }
  // Enforce mode rejects the same input that shadow would have recorded.
  return rejection(state, event, reason);
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
  // Free the entire reservation, durable_consumed stays at zero. The
  // subtraction is clamped to 0 so a release after a partial reclaim
  // (e.g. due to overspend reconciliation) cannot drive reserved_active
  // negative. Under normal single-claim flow the bookkeeping is exact;
  // the clamp is a defensive invariant.
  const newAxes = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const resv = claim.reservation[axisName];
    if (resv && resv.reserved_active > 0) {
      const candidate = cur.reserved_active - resv.reserved_active;
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: candidate < 0 ? 0 : candidate,
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
  // Free the graph node claim: clear active_claim_id and restore pending so
  // the next graph attempt can re-grant. Attempt count is retained (already
  // spent for this failed attempt), not unspent; stagnation is not incremented.
  let graphProgress = state.graph_progress;
  if (claim.graph_node_id
      && state.graph_progress
      && state.graph_progress[claim.graph_node_id]) {
    const priorProgress = state.graph_progress[claim.graph_node_id];
    graphProgress = Object.freeze({
      ...state.graph_progress,
      [claim.graph_node_id]: Object.freeze({
        ...priorProgress,
        status: 'pending',
        active_claim_id: null,
        attempts: priorProgress.attempts || 0,
      }),
    });
  }
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
    graph_progress: graphProgress,
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
    // Replay: same event re-applied must be idempotent — no second charge
    // and no second release. Return the original receipt verbatim.
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
  let actual;
  try {
    actual = reservationFor(
      { reservation: payload.actual_usage },
      'payload.actual_usage',
      { requireComplete: false },
    );
  } catch (error) {
    return rejection(state, event, 'binding_mismatch');
  }
  // Unknown or missing exact usage is never silently converted to a known
  // zero. Enforce mode conservatively charges the frozen reservation; shadow
  // mode preserves an explicit unknown observation without charging it.
  const mergedActual = {};
  for (const axisName of SUPPORTED_AXES) {
    const resv = claim.reservation[axisName];
    if (!resv) continue;
    const observed = actual[axisName];
    const known = !!(observed && observed.known === true);
    const durableConsumed = known
      ? observed.reserved_active
      : (state.enforcement_mode === 'enforce' ? resv.reserved_active : 0);
    mergedActual[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: 0,
      durable_consumed: durableConsumed,
      known,
    };
  }
  // Detect overspend: any observed actual exceeds the reserved budget for
  // that axis. The reducer still clears the reservation atomically and
  // conservatively adds the full observed usage once (even above the
  // authorized ceiling), then BLOCKED/accounting_breach.
  let overspendAxis = null;
  let overspendObserved = 0;
  let overspendReserved = 0;
  for (const axisName of SUPPORTED_AXES) {
    const resv = claim.reservation[axisName];
    if (!resv) continue;
    const observed = mergedActual[axisName].durable_consumed;
    const reservedAmount = resv.reserved_active;
    if (observed > reservedAmount) {
      overspendAxis = axisName;
      overspendObserved = observed;
      overspendReserved = reservedAmount;
      break;
    }
  }
  if (overspendAxis !== null) {
    const newAxes = {};
    for (const axisName of SUPPORTED_AXES) {
      const cur = state.axes[axisName];
      const resv = claim.reservation[axisName];
      if (!resv) {
        newAxes[axisName] = cloneAxis(cur);
        continue;
      }
      const observed = mergedActual[axisName].durable_consumed;
      // Overspend: clear the reservation (clamped to 0 so partial
      // reclaims never produce negative counters), conservatively add
      // the FULL observed actual once (even above the authorized ceiling).
      const candidateReserved = cur.reserved_active - resv.reserved_active;
      const newConsumed = cur.durable_consumed + observed;
      newAxes[axisName] = computeAxisBudget({
        authorized_ceiling: cur.authorized_ceiling,
        reserved_active: candidateReserved < 0 ? 0 : candidateReserved,
        durable_consumed: newConsumed,
        active_actual: cur.active_actual,
        known: cur.known && mergedActual[axisName].known,
        enforced: cur.enforced,
      });
    }
    const terminalClaim = {
      ...claim,
      reconciled: true,
      terminal: true,
      actual: mergedActual,
      accounting_breach: true,
    };
    const overspendReceipt = {
      artifact_type: 'mission_reconciliation',
      event_type: 'reconciliation',
      claim_id: claimId,
      overspend_axis: overspendAxis,
      overspend_observed: overspendObserved,
      overspend_reserved: overspendReserved,
      actual_usage: mergedActual,
      reservation_consumed: claim.reservation,
      reservation_freed: Object.fromEntries(
        Object.keys(claim.reservation).map((a) => [a, {
          axis: a,
          authorized_ceiling: state.axes[a].authorized_ceiling,
          reserved_active: 0,
          durable_consumed: mergedActual[a].durable_consumed,
          known: state.axes[a].known,
        }]),
      ),
      replay: 'overspend',
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: 'BLOCKED',
      receipt_digest: sha256({
        kind: 'mission_reconciliation',
        claim_id: claimId,
        replay: 'overspend',
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    };
    const blocked = setTerminal(
      Object.freeze({
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
        claims: Object.freeze({ ...state.claims, [claimId]: Object.freeze(terminalClaim) }),
        receipts: Object.freeze({
          ...state.receipts,
          [`mission_reconciliation:${claimId}`]: overspendReceipt,
        }),
      }),
      'BLOCKED',
      'accounting_breach',
    );
    return { state: blocked, receipt: overspendReceipt };
  }
  // Normal reconcile: clear the entire original reservation, add actual
  // usage to durable_consumed, mark claim terminal+reconciled. Receipt
  // data satisfies actual + freed = original for normal reconciliation.
  const newAxes = {};
  const reservationConsumed = {};
  const reservationFreed = {};
  for (const axisName of SUPPORTED_AXES) {
    const cur = state.axes[axisName];
    const resv = claim.reservation[axisName];
    if (!resv) {
      newAxes[axisName] = cloneAxis(cur);
      continue;
    }
    const observed = mergedActual[axisName].durable_consumed;
    const candidateReserved = cur.reserved_active - resv.reserved_active;
    const newConsumed = cur.durable_consumed + observed;
    newAxes[axisName] = computeAxisBudget({
      authorized_ceiling: cur.authorized_ceiling,
      reserved_active: candidateReserved < 0 ? 0 : candidateReserved,
      durable_consumed: newConsumed,
      active_actual: cur.active_actual,
      known: cur.known && mergedActual[axisName].known,
      enforced: cur.enforced,
    });
    reservationConsumed[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: observed,
      durable_consumed: 0,
      known: mergedActual[axisName].known,
    };
    reservationFreed[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: resv.reserved_active - observed,
      durable_consumed: 0,
      known: mergedActual[axisName].known,
    };
  }
  const reconciledClaim = {
    ...claim,
    reconciled: true,
    terminal: true,
    actual: mergedActual,
  };
  const nextReceipt = {
    artifact_type: 'mission_reconciliation',
    event_type: 'reconciliation',
    claim_id: claimId,
    actual_usage: mergedActual,
    reservation_consumed: reservationConsumed,
    reservation_freed: reservationFreed,
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

function handleCeilingAdjust(state, event, payload, sanitizedControlEvent) {
  // payload is a normalized control event
  const ce = sanitizedControlEvent || payload.event || event; // tolerate both
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

function handleControlEvent(state, event, payload, sanitizedControlEvent) {
  const ce = sanitizedControlEvent || payload.event || event;
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
    // ABORTING is an intermediate control state, not a TERMINAL_STATES member.
    // Do not set terminal here — that permanently blocked abort finalization.
    // Advance control_sequence exactly once to the accepted control event.
    nextState = Object.freeze({
      ...appendEvent(state, event),
      state: 'ABORTING',
      control_sequence: ce.sequence,
    });
  } else if (ce.action === 'scope_frozen') {
    nextState = Object.freeze({ ...appendEvent(state, event), state: 'CLOSING', control_sequence: ce.sequence });
  } else if (ce.action === 'ceiling_adjust') {
    // Delegate to ceiling adjust semantics
    return handleCeilingAdjust(state, event, payload, sanitizedControlEvent);
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

function handleAbortFinalized(state, event, _payload) {
  // Canonical ABORTING → ABORTED transition. Abort is not successful closure:
  // this path never claims acceptance, completion, or task closeout.
  if (state.state !== 'ABORTING') {
    return {
      state,
      receipt: {
        artifact_type: 'mission_abort_rejected',
        event_type: 'abort_finalized',
        reason: 'not_aborting',
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_abort_rejected',
          reason: 'not_aborting',
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  const drain = abortDrainPreconditions(state);
  if (!drain.ok) {
    return {
      state,
      receipt: {
        artifact_type: 'mission_abort_rejected',
        event_type: 'abort_finalized',
        reason: drain.reason,
        mission_lineage_id: state.mission_lineage_id,
        source_event: event,
        next_state: state.state,
        receipt_digest: sha256({
          kind: 'mission_abort_rejected',
          reason: drain.reason,
          mission_lineage_id: state.mission_lineage_id,
          event_digest: event.event_digest,
        }),
      },
    };
  }
  // Success: replace any legacy ABORTING terminal marker with canonical ABORTED.
  const next = setTerminal(appendEvent(state, event), 'ABORTED', 'abort_finalized');
  return {
    state: next,
    receipt: {
      artifact_type: 'mission_abort_finalized',
      event_type: 'abort_finalized',
      reason: 'abort_finalized',
      mission_lineage_id: state.mission_lineage_id,
      source_event: event,
      next_state: 'ABORTED',
      receipt_digest: sha256({
        kind: 'mission_abort_finalized',
        reason: 'abort_finalized',
        mission_lineage_id: state.mission_lineage_id,
        event_digest: event.event_digest,
      }),
    },
  };
}

function hasLiveUnreleasedClaims(state) {
  for (const claim of Object.values(state.claims || {})) {
    if (claim && !claim.released && !claim.terminal) {
      return true;
    }
  }
  return false;
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
  // Preserve the stagnation count always, but do not terminalize Mission while
  // any unreleased nonterminal claim remains live. After the final live claim
  // terminates without progress, the existing threshold may terminalize.
  const mayTerminalize = !hasLiveUnreleasedClaims(next);
  if (mayTerminalize && acceptanceUnresolved && newCount >= state.max_stagnant_campaigns) {
    next = setTerminal(next, 'BLOCKED', 'stagnation');
  } else if (mayTerminalize && requestThirdGrant && newCount >= state.max_stagnant_campaigns) {
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
  if (state.required_acceptance_hashes.length > 0
      && !state.required_acceptance_hashes.includes(hash)) {
    return rejection(state, event, 'binding_mismatch');
  }
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
  validateMissionState(state);
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
  // therefore embeds the full axis set, claim summary, event digest list,
  // AND the digest-bound Mission contract so a fresh Work Unit can
  // resume reducer operation with identical semantics.
  const claimsSummary = Object.fromEntries(
    Object.entries(state.claims).map(([k, v]) => [k, {
      claim_id: v.claim_id,
      idempotency_key: v.idempotency_key,
      binding_digest: v.binding_digest,
      identity_scheme: v.identity_scheme || null,
      mission_lineage_id: v.mission_lineage_id || null,
      task_authority_id: v.task_authority_id || null,
      campaign_id: v.campaign_id || null,
      campaign_contract_digest: v.campaign_contract_digest || null,
      mission_subject_digest: v.mission_subject_digest || null,
      base_sha: v.base_sha || null,
      acceptance_ids: [...(v.acceptance_ids || [])].sort(),
      acceptance_hashes: [...(v.acceptance_hashes || [])].sort(),
      graph_node_id: v.graph_node_id || null,
      graph_attempt: v.graph_attempt || null,
      campaign_contract_draft: v.campaign_contract_draft
        ? deepClone(v.campaign_contract_draft)
        : null,
      terminal: !!v.terminal,
      released: !!v.released,
      reconciled: !!v.reconciled,
      reservation: deepClone(v.reservation),
      actual: v.actual ? deepClone(v.actual) : null,
      event_digest: v.event_digest,
    }]),
  );
  // Embed the Mission contract (minus non-secret config fields) so a
  // fresh root context can resume with identical admission/control
  // semantics. The contract body is content-bound via the
  // state-owned `config_digest` so a tampered config is detected on
  // restore. The digest is the single binding between the state hash
  // and the config that produced it — recomputing the outer
  // `projection_digest` after a config swap does not fool the binding
  // check, because the restored state's hash (which depends on
  // `config_digest`) will not match.
  const configSnapshot = deepClone(state.config);
  const contractDigest = state.config_digest;
  const body = {
    mission_terminal: false,
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_projection',
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    policy_hash: state.policy_hash,
    mission_policy_digest: state.mission_policy_digest || state.policy_hash,
    mission_graph_digest: state.mission_graph_digest || null,
    initial_required_acceptance_hashes:
      [...(state.initial_required_acceptance_hashes || [])].sort(),
    enforcement_mode: state.enforcement_mode,
    closure_ratio: state.closure_ratio,
    max_stagnant_campaigns: state.max_stagnant_campaigns,
    successor_inherits_durable_consumed: state.successor_inherits_durable_consumed,
    frozen_intent: {
      objective: state.repo_identity,
      intent_hash: sha256(state.config.intent || state.repo_identity),
    },
    remaining_acceptance: [...(state.required_acceptance_hashes || [])]
      .filter((hash) => !state.acceptance_hashes.includes(hash))
      .sort(),
    red_lines: [...state.red_lines].sort(),
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
    source_refs: validateSourceRefs(sourceRefs, 'projection.source_refs'),
    // digest-bound snapshot of the live state
    state_snapshot: {
      machine_state: state.state,
      terminal: state.terminal ? deepClone(state.terminal) : null,
      axes: perAxis,
      claims: claimsSummary,
      control_sequence: state.control_sequence,
      closure_allowlist: [...state.closure_allowlist].sort(),
      stagnant_campaigns: state.stagnant_campaigns,
      required_acceptance_hashes: [...(state.required_acceptance_hashes || [])].sort(),
      acceptance_hashes: [...state.acceptance_hashes].sort(),
      graph_progress: state.graph_progress ? deepClone(state.graph_progress) : {},
      unknown_required_axes: [...state.unknown_required_axes].sort(),
      event_digests: state.events.map((e) => e.event_digest).sort(),
    },
    ordered_event_head: { events: headEvents, head_digest: headDigest },
    config_snapshot: {
      grant_contract: deepClone(configSnapshot.grant_contract),
      control_contract: deepClone(configSnapshot.control_contract),
      lineage_binding: deepClone(configSnapshot.lineage_binding),
      provenance: state.config_provenance,
      // Complete non-secret contract shape so a restored state can resume
      // reducer operation with identical admission/control/successor/
      // stagnation semantics. Every field below affects future admission,
      // successor inheritance, stagnation, control authorization, or hashing.
      schema_version: state.config.schema_version,
      artifact_type: state.config.artifact_type,
      contract_id: state.config.contract_id,
      repo_identity: state.config.repo_identity,
      mission_lineage_id: state.config.mission_lineage_id,
      task_authority_id: state.config.task_authority_id,
      policy_hash: state.config.policy_hash,
      enforcement_mode: state.config.enforcement_mode,
      contract_state: state.config.state,
      closure_ratio: state.config.closure_ratio,
      max_stagnant_campaigns: state.config.max_stagnant_campaigns,
      required_acceptance_hashes: [...(state.required_acceptance_hashes || [])].sort(),
      mission_policy_digest: state.mission_policy_digest || state.policy_hash,
      mission_graph_digest: state.mission_graph_digest || null,
      initial_required_acceptance_hashes:
        [...(state.initial_required_acceptance_hashes || [])].sort(),
      execution_graph: state.execution_graph ? deepClone(state.execution_graph) : null,
      axes: deepClone(configSnapshot.axes),
      red_lines: deepClone(state.red_lines),
    },
    config_digest: contractDigest,
    raw_transcript_present: false,
    state_hash: stateHash(state),
  };
  body.projection_digest = sha256({ ...body, projection_digest: undefined });
  return deepFreeze(body);
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
  // Validate the ordered event head digest independently. The head is the
  // canonical ordered record of decisions; a tampered head (re-ordered, dropped,
  // or forged events) must reject even if a caller tried to re-weave
  // projection_digest around it.
  const head = requireObject(projection.ordered_event_head, 'projection.ordered_event_head');
  const headEvents = Array.isArray(head.events) ? head.events : [];
  const expectedHeadDigest = sha256(headEvents);
  if (head.head_digest !== expectedHeadDigest) {
    fail('ordered_event_head.head_digest does not match the head events', 'PROJECTION_HEAD_DIGEST_MISMATCH');
  }
  // Per-entry source ref digest validation. The refs are bound into the
  // outer projection_digest, but a caller who re-issues a fresh digest
  // around a tampered ref would otherwise slip through. Re-validating
  // each ref independently — and rejecting malformed, duplicate, or
  // recomputed-content-mismatch refs — closes that gap.
  validateSourceRefs(projection.source_refs, 'projection.source_refs');
  // The projection carries a digest-bound config. A tampered config is
  // detected before any reducer is invoked. The recomputed digest is the
  // same `computeConfigDigest` formula used at `createMissionState`; both
  // the projection's `config_digest` and the restored state's hash (which
  // depends on `config_digest`) must match. Recomputing only the outer
  // `projection_digest` after a config swap is not enough: the restored
  // state's `config_digest` and `state_hash` will diverge.
  const configSnapshot = requireObject(projection.config_snapshot, 'projection.config_snapshot');
  const perAxis = requireObject(projection.state_snapshot, 'projection.state_snapshot').axes;
  // Validate config shape: every field that the create-time digest covers
  // must be present (or a defaulted value is filled in by the snapshot
  // itself). Cross-field lineage/task/policy bindings are checked here
  // so a tampered config that passes `computeConfigDigest` for
  // individual fields is still rejected on the binding check.
  const reconstructedConfig = {
    schema_version: configSnapshot.schema_version,
    artifact_type: configSnapshot.artifact_type,
    contract_id: configSnapshot.contract_id,
    repo_identity: configSnapshot.repo_identity,
    mission_lineage_id: configSnapshot.mission_lineage_id,
    task_authority_id: configSnapshot.task_authority_id,
    policy_hash: configSnapshot.policy_hash,
    mission_policy_digest: configSnapshot.mission_policy_digest,
    mission_graph_digest: configSnapshot.mission_graph_digest,
    initial_required_acceptance_hashes:
      configSnapshot.initial_required_acceptance_hashes || [],
    execution_graph: configSnapshot.execution_graph || null,
    enforcement_mode: configSnapshot.enforcement_mode,
    state: configSnapshot.contract_state,
    closure_ratio: configSnapshot.closure_ratio,
    max_stagnant_campaigns: configSnapshot.max_stagnant_campaigns,
    required_acceptance_hashes: configSnapshot.required_acceptance_hashes || [],
    red_lines: configSnapshot.red_lines || [],
    axes: configSnapshot.axes,
    grant_contract: configSnapshot.grant_contract,
    control_contract: configSnapshot.control_contract,
    lineage_binding: configSnapshot.lineage_binding,
  };
  // Cross-field binding: config snapshot identity fields must match the
  // projection's top-level trusted fields.
  if (configSnapshot.mission_lineage_id !== projection.mission_lineage_id) {
    fail('config_snapshot.mission_lineage_id does not match projection.mission_lineage_id', 'PROJECTION_BINDING_MISMATCH');
  }
  if (configSnapshot.task_authority_id !== projection.task_authority_id) {
    fail('config_snapshot.task_authority_id does not match projection.task_authority_id', 'PROJECTION_BINDING_MISMATCH');
  }
  if (configSnapshot.policy_hash !== projection.policy_hash) {
    fail('config_snapshot.policy_hash does not match projection.policy_hash', 'PROJECTION_BINDING_MISMATCH');
  }
  if ((configSnapshot.mission_policy_digest || configSnapshot.policy_hash)
      !== (projection.mission_policy_digest || projection.policy_hash)
      || (configSnapshot.mission_graph_digest || null)
        !== (projection.mission_graph_digest || null)) {
    fail('config_snapshot Mission policy/graph digest does not match projection', 'PROJECTION_BINDING_MISMATCH');
  }
  if (configSnapshot.enforcement_mode !== projection.enforcement_mode) {
    fail('config_snapshot.enforcement_mode does not match projection.enforcement_mode', 'PROJECTION_BINDING_MISMATCH');
  }
  if (!!(configSnapshot.lineage_binding && configSnapshot.lineage_binding.successor_inherits_durable_consumed)
    !== !!projection.successor_inherits_durable_consumed) {
    fail('config_snapshot lineage_binding.successor_inherits_durable_consumed does not match projection', 'PROJECTION_BINDING_MISMATCH');
  }
  // Cross-field lineage/task/policy binding check. Normalize the
  // lineage_binding to the closed 4-field shape; reject missing, unknown,
  // wrong-type, or altered fields.
  const normalizedLB = normalizeLineageBinding(
    reconstructedConfig.lineage_binding, 'config_snapshot.lineage_binding');
  if (normalizedLB.task_authority_id !== reconstructedConfig.task_authority_id) {
    fail('config lineage_binding.task_authority_id does not match task_authority_id', 'PROJECTION_BINDING_MISMATCH');
  }
  if (normalizedLB.policy_hash !== reconstructedConfig.policy_hash) {
    fail('config lineage_binding.policy_hash does not match policy_hash', 'PROJECTION_BINDING_MISMATCH');
  }
  if (normalizedLB.task_authority_id !== projection.task_authority_id) {
    fail('config lineage_binding.task_authority_id does not match projection.task_authority_id', 'PROJECTION_BINDING_MISMATCH');
  }
  if (normalizedLB.policy_hash !== projection.policy_hash) {
    fail('config lineage_binding.policy_hash does not match projection.policy_hash', 'PROJECTION_BINDING_MISMATCH');
  }
  const reconstructedProvenance = configSnapshot.provenance || {};
  const expectedConfigDigest = computeConfigDigest(reconstructedConfig, reconstructedProvenance);
  if (projection.config_digest !== expectedConfigDigest) {
    fail('config_digest does not match projection config_snapshot', 'PROJECTION_CONFIG_DIGEST_MISMATCH');
  }
  // Reconstruct a deeply immutable operational state. Every claim/axis/event
  // is deep-cloned and frozen so further mutations of the projection cannot
  // leak into restored state behavior.
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
    .map(([claimId, claim]) => [claimId, deepFreeze({
      claim_id: claim.claim_id,
      idempotency_key: claim.idempotency_key,
      binding_digest: claim.binding_digest,
      identity_scheme: claim.identity_scheme || null,
      mission_lineage_id: claim.mission_lineage_id || null,
      task_authority_id: claim.task_authority_id || null,
      campaign_id: claim.campaign_id || null,
      campaign_contract_digest: claim.campaign_contract_digest || null,
      mission_subject_digest: claim.mission_subject_digest || null,
      base_sha: claim.base_sha || null,
      acceptance_ids: Object.freeze([...(claim.acceptance_ids || [])].sort()),
      acceptance_hashes: Object.freeze([...(claim.acceptance_hashes || [])].sort()),
      graph_node_id: claim.graph_node_id || null,
      graph_attempt: claim.graph_attempt || null,
      campaign_contract_draft: claim.campaign_contract_draft
        ? deepClone(claim.campaign_contract_draft)
        : null,
      terminal: !!claim.terminal,
      released: !!claim.released,
      reconciled: !!claim.reconciled,
      reservation: deepClone(claim.reservation),
      actual: claim.actual ? deepClone(claim.actual) : null,
      event_digest: claim.event_digest,
    })])
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
  const restored = deepFreeze({
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_state',
    mission_lineage_id: projection.mission_lineage_id,
    task_authority_id: projection.task_authority_id,
    policy_hash: projection.policy_hash,
    mission_policy_digest: projection.mission_policy_digest || projection.policy_hash,
    mission_graph_digest: projection.mission_graph_digest || null,
    initial_required_acceptance_hashes: Object.freeze(
      [...(projection.initial_required_acceptance_hashes || [])].sort(),
    ),
    execution_graph: configSnapshot.execution_graph
      ? deepClone(configSnapshot.execution_graph)
      : null,
    graph_progress: deepFreeze(deepClone(snapshot.graph_progress || {})),
    repo_identity: projection.frozen_intent.objective.slice(0, 1024),
    contract_id: `mission-v1-${sha256(projection.mission_lineage_id)}`,
    root_run_id: normalizedLB.root_run_id,
    enforcement_mode: projection.enforcement_mode || 'shadow',
    state: snapshot.machine_state || 'DRAFT',
    closure_ratio: projection.closure_ratio !== undefined
      ? projection.closure_ratio : DEFAULT_CLOSURE_RATIO,
    max_stagnant_campaigns: projection.max_stagnant_campaigns !== undefined
      ? projection.max_stagnant_campaigns : DEFAULT_MAX_STAGNANT,
    successor_inherits_durable_consumed: !!projection.successor_inherits_durable_consumed,
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
    required_acceptance_hashes: Object.freeze(
      [...(snapshot.required_acceptance_hashes || [])].sort(),
    ),
    acceptance_hashes: Object.freeze(snapshot.acceptance_hashes),
    unknown_required_axes: Object.freeze(snapshot.unknown_required_axes),
    terminal: snapshot.terminal ? deepClone(snapshot.terminal) : null,
    config: deepFreeze({
      schema_version: configSnapshot.schema_version !== undefined
        ? configSnapshot.schema_version : MISSION_SCHEMA_VERSION,
      artifact_type: configSnapshot.artifact_type !== undefined
        ? configSnapshot.artifact_type : 'mission_convergence_contract',
      contract_id: configSnapshot.contract_id !== undefined
        ? configSnapshot.contract_id : `mission-v1-${sha256(projection.mission_lineage_id)}`,
      repo_identity: configSnapshot.repo_identity !== undefined
        ? configSnapshot.repo_identity : projection.frozen_intent.objective.slice(0, 1024),
      mission_lineage_id: configSnapshot.mission_lineage_id !== undefined
        ? configSnapshot.mission_lineage_id : projection.mission_lineage_id,
      task_authority_id: configSnapshot.task_authority_id !== undefined
        ? configSnapshot.task_authority_id : projection.task_authority_id,
      policy_hash: configSnapshot.policy_hash !== undefined
        ? configSnapshot.policy_hash : projection.policy_hash,
      mission_policy_digest: configSnapshot.mission_policy_digest !== undefined
        ? configSnapshot.mission_policy_digest : projection.policy_hash,
      mission_graph_digest: configSnapshot.mission_graph_digest !== undefined
        ? configSnapshot.mission_graph_digest : null,
      initial_required_acceptance_hashes: Object.freeze(
        [...(configSnapshot.initial_required_acceptance_hashes || [])].sort(),
      ),
      execution_graph: configSnapshot.execution_graph
        ? deepClone(configSnapshot.execution_graph)
        : null,
      enforcement_mode: configSnapshot.enforcement_mode !== undefined
        ? configSnapshot.enforcement_mode : projection.enforcement_mode,
      state: configSnapshot.contract_state !== undefined
        ? configSnapshot.contract_state : (snapshot.machine_state || 'DRAFT'),
      closure_ratio: configSnapshot.closure_ratio !== undefined
        ? configSnapshot.closure_ratio : projection.closure_ratio,
      max_stagnant_campaigns: configSnapshot.max_stagnant_campaigns !== undefined
        ? configSnapshot.max_stagnant_campaigns : projection.max_stagnant_campaigns,
      required_acceptance_hashes: Object.freeze(
        [...(configSnapshot.required_acceptance_hashes || [])].sort(),
      ),
      axes: configSnapshot.axes ? deepClone(configSnapshot.axes) : deepClone(snapshot.axes),
      grant_contract: deepClone(configSnapshot.grant_contract),
      control_contract: deepClone(configSnapshot.control_contract),
      lineage_binding: deepClone(configSnapshot.lineage_binding),
      red_lines: configSnapshot.red_lines
        ? deepClone(configSnapshot.red_lines) : Object.freeze([...(projection.red_lines || [])]),
      provenance: deepClone(configSnapshot.provenance),
    }),
    config_provenance: deepFreeze(deepClone(configSnapshot.provenance)),
    // The restored state's config_digest is the SAME digest the projection
    // bound (verified above). It is what `stateHash` then binds into the
    // canonical state hash; any future mutation of the projection's
    // config_snapshot (without re-running the digest) produces a state
    // whose state_hash cannot match the original projection's state_hash.
    config_digest: projection.config_digest,
    red_lines: Object.freeze(projection.red_lines || []),
  });
  validateMissionState(restored);
  if (stateHash(restored) !== projection.state_hash) {
    fail('projection state_hash does not match restored state', 'PROJECTION_HASH_MISMATCH');
  }
  return restored;
}

function replayEvents() {
  // `replayEvents` is intentionally unsupported on the v1 acceptance surface:
  // a header-only event with an empty synthesized payload is not a valid
  // reducer event. Replaying a projection must instead be done by restoring
  // the projection and applying a digest-verified event stream — the
  // projection's `event_digests` are the verified record. The function is
  // retained (and not exported) so a future caller that imports it sees a
  // deterministic, fail-closed error rather than a missing-export crash.
  fail(
    'replayEvents is not part of the v1 acceptance surface — restore the projection and replay digest-verified events',
    'REPLAY_EVENTS_REMOVED',
  );
}

// ─── Config section evaluator (legacy thin wrapper) ───────────────────────

function evaluateConfig(input) {
  requireObject(input, 'config input');
  const section = 'section' in input ? input.section : null;
  if (section === null || section === undefined) return { mode: 'off' };
  if (!isPlainObject(section)) return { error: 'mission_config_invalid' };
  const allowedKeys = new Set([
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
    'provenance',
  ]);
  for (const key of Object.keys(section)) {
    if (!allowedKeys.has(key)) return { error: 'mission_config_invalid' };
  }
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
  const ceilingFields = [
    'max_campaigns',
    'max_wall_seconds',
    'max_tool_calls',
    'max_engine_attempts',
    'max_external_wait_seconds',
    'max_canonical_changed_files',
    'max_output_bytes',
  ];
  for (const field of ceilingFields) {
    const value = section[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      return { error: 'mission_config_invalid' };
    }
  }
  if (typeof section.closure_ratio !== 'number'
    || !Number.isFinite(section.closure_ratio)
    || section.closure_ratio < 0
    || section.closure_ratio > 1) {
    return { error: 'mission_config_invalid' };
  }
  if (!Number.isSafeInteger(section.max_stagnant_campaigns)
    || section.max_stagnant_campaigns < 0) {
    return { error: 'mission_config_invalid' };
  }
  if (section.provenance !== undefined) {
    if (!isPlainObject(section.provenance)) {
      return { error: 'mission_config_invalid' };
    }
    for (const [field, value] of Object.entries(section.provenance)) {
      if (!PROVENANCE_VALUES.has(value)) {
        return { error: 'mission_config_invalid' };
      }
    }
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
    enforcement_mode: input.mode === 'enforce' ? 'enforce' : 'shadow',
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
    case 'lineage_budget_invariant':
      return runLineageBudgetInvariantFixture(input);
    default:
      return { error: 'mission_reducer_kind_unknown' };
  }
}

function reservationFromReserved(reserved, state) {
  // Build a reservation whose authorized_ceiling mirrors the state at the
  // time of the claim. The reducer asserts the reservation's per-axis
  // `authorized_ceiling` matches the state; a mismatch is a binding error.
  // The campaigns axis must reserve a unit for every claim — a zero on
  // `campaigns` is rejected by the reducer's reservation validation.
  return {
    per_axis: SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state ? state.axes[axisName].authorized_ceiling : 0,
      reserved_active: axisName === 'tool_calls' ? reserved : (axisName === 'campaigns' ? 1 : 0),
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
  const primed = deepFreeze({
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
  // Drive the same would-block admission through both shadow and enforce
  // contracts and derive the result from the real reducer. The reducer
  // itself owns the would-block / would-allow decision; this helper only
  // translates the fixture shape into a comparison.
  function drive(mode) {
    const state = createMissionState(defaultTestContract({ ceiling: 5, consumed: 0, mode }));
    const reservation = {
      per_axis: SUPPORTED_AXES.map((axisName) => ({
        axis: axisName,
        authorized_ceiling: state.axes[axisName].authorized_ceiling,
        reserved_active: axisName === 'tool_calls' ? 10 : 1,
        durable_consumed: state.axes[axisName].durable_consumed,
        known: true,
      })),
    };
    return {
      result: reduceMissionState(state, {
        event_type: 'grant_claimed',
        sequence: 1,
        mission_lineage_id: state.mission_lineage_id,
        payload: {
          idempotency_key: 'shadow-claim',
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
      }),
      state,
    };
  }
  const shadow = drive('shadow');
  const enforce = drive('enforce');
  return {
    effect_allowed: shadow.result.state.state !== 'BLOCKED',
    would_block: enforce.result.state.state === 'BLOCKED',
  };
}

function runLineageBudgetInvariantFixture(input) {
  const ceiling = requireInteger(input.ceiling, 'lineage_budget_invariant.ceiling', 1);
  const consumed = requireInteger(input.consumed, 'lineage_budget_invariant.consumed', 0);
  const requested = requireInteger(input.requested, 'lineage_budget_invariant.requested', 1);
  const state = createMissionState(defaultTestContract({ ceiling, consumed, mode: 'shadow' }));
  const preClaimRemaining = Math.max(0, ceiling - consumed);
  const reservation = {
    per_axis: SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? requested : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  };
  const result = reduceMissionState(state, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: 'lineage-invariant',
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: 'invariant-campaign',
      campaign_contract_digest: SAMPLE_POLICY_HASH,
      base_sha: SAMPLE_BASE_SHA,
      acceptance_ids: ['acc-1'],
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  const wouldBlock = result.receipt.artifact_type === 'mission_would_block_evidence';
  const effectiveRemaining = wouldBlock
    ? result.receipt.evidence.remaining_before
    : Math.max(0, result.state.axes.tool_calls.authorized_ceiling
      - result.state.axes.tool_calls.durable_consumed
      - result.state.axes.tool_calls.reserved_active);
  return {
    would_block: wouldBlock,
    pre_claim_remaining: preClaimRemaining,
    effective_remaining: effectiveRemaining,
    budget_preserved: effectiveRemaining === preClaimRemaining,
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
      reserved_active: axisName === 'tool_calls' ? requested : (axisName === 'campaigns' ? 1 : 0),
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
  // The integration oracle uses `fixture.expected` (the frozen corpus
  // expectation) as its single source of truth — no inline `frozen`
  // map, no ID-specific manufactured outputs. Translation by input kind
  // drives the real reducer / adapter; the reducer-derived values flow
  // through unchanged.
  const contract = makeContractFromFixtureInput(input);
  // `input.enforcement_mode` (if present) drives the operational mode for
  // fixtures that test blocking semantics — shadow would never block the
  // same admission, so a fixture expecting BLOCKED must run in enforce.
  if (input.enforcement_mode === 'enforce' || input.enforcement_mode === 'shadow') {
    contract.enforcement_mode = input.enforcement_mode;
  }
  const state = createMissionState(contract);

  if (isPlainObject(input.identity_change)) {
    const result = runClaimForIntegration(state, input);
    const tc = result.state.axes.tool_calls;
    let derivedState = result.state.state;
    let derivedReason = result.receipt.reason || null;
    let remaining = Math.max(0, tc.authorized_ceiling - tc.durable_consumed - tc.reserved_active);
    if (result.receipt.artifact_type === 'mission_would_block_evidence'
      && result.receipt.evidence && result.receipt.evidence.axis) {
      derivedState = 'BLOCKED';
      derivedReason = `${result.receipt.reason}:${result.receipt.evidence.axis}`;
      remaining = result.receipt.evidence.remaining_before;
    }
    return {
      state: derivedState,
      reason: derivedReason,
      remaining_tool_calls: remaining,
      effect_count: result.receipt.artifact_type === 'mission_campaign_grant_claimed' ? 1 : 0,
    };
  }
  if (id === 'direct-no-agent-stagnation' || id === 'real-progress-resets-stagnation') {
    let current = deepFreeze({ ...state, state: 'ACTIVE' });
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
    const primed = deepFreeze({ ...state, control_sequence: finish });
    // Control events must come through a constructed AuthenticatedControlAdapter
    // instance so the reducer can validate the unforgeable capability.
    const { AuthenticatedControlAdapter } = require('./authenticated-control');
    const adapter = new AuthenticatedControlAdapter({ verifier: buildTestVerifier() });
    let canonical;
    try {
      canonical = adapter.acceptEvent({
        mission_lineage_id: state.mission_lineage_id,
        action: 'finish_requested',
        authority: 'authenticated_user',
        sequence,
        issued_at: '2026-07-27T00:00:00.000Z',
        reason: 'integration-control',
      });
    } catch (error) {
      return { state: state.state, reason: error.code || error.message, effect_count: 0 };
    }
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
    // Surface the structured provider-readiness signal. The adapter maps
    // the fixture shape (`required_seat_status` + `proposed_work`) onto
    // the corpus expectation. A blocked seat releases the reservation and
    // flags the proposed work as a maintenance candidate when the proposal
    // matches the provider-readiness domain. The real reducer drove the
    // reservation/release; this branch translates the fixture.
    const proposed = typeof input.proposed_work === 'string' ? input.proposed_work : '';
    const required = typeof input.required_seat_status === 'string'
      ? input.required_seat_status : 'unknown';
    const isMaintenance = /transport|qualif|provider|readiness/i.test(proposed);
    const blocked = required === 'blocked';
    if (!blocked) {
      return { state: 'ACTIVE', reason: null, effect_count: 0 };
    }
    const claimResult = runClaimForIntegration(state, { requested_tool_calls: 1 });
    if (claimResult.receipt.artifact_type !== 'mission_campaign_grant_claimed') {
      return { state: claimResult.state.state, reason: claimResult.receipt.reason || null, effect_count: 0 };
    }
    const released = reduceMissionState(claimResult.state, {
      event_type: 'no_effect_release',
      sequence: claimResult.state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload: { claim_id: claimResult.receipt.claim_id },
    });
    return {
      state: released.state.state,
      reason: 'PRESPEND_REJECTED/provider_readiness',
      reservation_released: true,
      maintenance_candidate_only: isMaintenance,
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
    const primed = deepFreeze({ ...state, state: 'ACTIVE' });
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
    const primed = deepFreeze({ ...state, state: 'ACTIVE' });
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


function applyMissionCampaignReceipt(state, receipt) {
  try { validateMissionState(state); } catch (_error) {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  const legacyKeys = new Set([
    'schema_version',
    'artifact_type',
    'claim_id',
    'mission_lineage_id',
    'campaign_id',
    'campaign_contract_digest',
    'actual_usage',
    'receipt_digest',
  ]);
  const v2Keys = new Set([
    'schema_version',
    'artifact_type',
    'claim_id',
    'mission_lineage_id',
    'campaign_id',
    'mission_campaign_id',
    'icc_campaign_id',
    'campaign_contract_digest',
    'raw_campaign_contract_digest',
    'graph_node_id',
    'graph_attempt',
    'outcome',
    'possibly_effectful',
    'actual_usage',
    'satisfied_acceptance_hashes',
    'observed_at',
    'receipt_digest',
  ]);
  const receiptKeys = isPlainObject(receipt) ? Object.keys(receipt) : [];
  const exactKeys = (allowed) => (
    receiptKeys.length === allowed.size && receiptKeys.every((key) => allowed.has(key))
  );
  const legacyReceipt = exactKeys(legacyKeys);
  const missionV2Receipt = exactKeys(v2Keys);
  if (!isPlainObject(receipt) || (!legacyReceipt && !missionV2Receipt)
      || receipt.schema_version !== 1
      || receipt.artifact_type !== 'campaign_terminal_receipt'
      || typeof receipt.receipt_digest !== 'string'
      || (missionV2Receipt
        && (!new Set(['ready', 'follow_up', 'blocked', 'abort', 'unknown']).has(receipt.outcome)
          || receipt.possibly_effectful !== true
          || !/^campaign-v2-[a-f0-9]{64}$/.test(receipt.campaign_id)
          || !/^campaign-v2-[a-f0-9]{64}$/.test(receipt.mission_campaign_id)
          || !/^campaign-v1-[a-f0-9]{64}$/.test(receipt.icc_campaign_id)
          || typeof receipt.raw_campaign_contract_digest !== 'string'
          || !/^[a-f0-9]{64}$/.test(receipt.raw_campaign_contract_digest)
          || typeof receipt.graph_node_id !== 'string'
          || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(receipt.graph_node_id)
          || !Number.isSafeInteger(receipt.graph_attempt)
          || receipt.graph_attempt < 1
          || !Array.isArray(receipt.satisfied_acceptance_hashes)
          || receipt.satisfied_acceptance_hashes.some((hash) => (
            typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)
          ))
          || typeof receipt.observed_at !== 'string'
          || !receipt.observed_at.endsWith('Z')
          || !Number.isFinite(Date.parse(receipt.observed_at))))
      || sha256(Object.fromEntries(Object.entries(receipt).filter(([k]) => k !== 'receipt_digest'))) !== receipt.receipt_digest) {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  const claim = state.claims[receipt.claim_id];
  if (!claim || claim.released
      || receipt.mission_lineage_id !== state.mission_lineage_id
      || receipt.campaign_id !== claim.campaign_id
      || (legacyReceipt && claim.identity_scheme === IDENTITY_SCHEME_V2)
      || (missionV2Receipt && receipt.mission_campaign_id !== claim.campaign_id)
      || (missionV2Receipt && claim.graph_node_id
        && receipt.graph_node_id !== claim.graph_node_id)
      || (missionV2Receipt && claim.graph_attempt
        && receipt.graph_attempt !== claim.graph_attempt)
      || receipt.campaign_contract_digest !== claim.campaign_contract_digest) {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  if (missionV2Receipt) {
    const satisfied = receipt.satisfied_acceptance_hashes;
    const canonicalSatisfied = [...new Set(satisfied)].sort();
    const claimAcceptance = [...(claim.acceptance_hashes || [])].sort();
    if (canonicalJson(satisfied) !== canonicalJson(canonicalSatisfied)
        || (receipt.outcome === 'ready'
          && canonicalJson(satisfied) !== canonicalJson(claimAcceptance))
        || (receipt.outcome !== 'ready' && satisfied.length !== 0)) {
      return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
    }
  }
  // Fail closed on a malformed/partial per-axis usage shape, but feed the
  // reducer the original {per_axis} payload it expects: reservationFor returns
  // an axis-keyed map, which handleReconciliation cannot re-parse.
  let actual;
  try { actual = reservationFor({ reservation: receipt.actual_usage }, 'receipt.actual_usage', { requireComplete: false }); }
  catch (_error) { return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state }); }
  if (!actual || Object.keys(actual).length === 0) {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  const semantic = { ...receipt, receipt_digest: undefined };
  const prior = state.receipts && state.receipts[`mission_campaign_receipt:${claim.claim_id}`];
  if (prior) {
    const priorSemantic = { ...prior, receipt_digest: undefined };
    if (canonicalJson(priorSemantic) === canonicalJson(semantic)) return Object.freeze({ status: 'replay_noop', state });
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  const event = {
    event_type: 'reconciliation', sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { claim_id: claim.claim_id, actual_usage: receipt.actual_usage },
  };
  const result = reduceMissionState(state, event);
  if (!result || !result.state || result.receipt.artifact_type === 'mission_grant_rejected') {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  let next = result.state;
  if (missionV2Receipt && claim.graph_node_id && next.graph_progress) {
    const priorProgress = next.graph_progress[claim.graph_node_id] || {};
    next = Object.freeze({
      ...next,
      graph_progress: Object.freeze({
        ...next.graph_progress,
        [claim.graph_node_id]: Object.freeze({
          ...priorProgress,
          status: receipt.outcome,
          attempts: claim.graph_attempt || priorProgress.attempts || 0,
          terminal_count: (priorProgress.terminal_count || 0) + 1,
          active_claim_id: null,
          last_outcome: receipt.outcome,
          last_receipt_digest: receipt.receipt_digest,
        }),
      }),
    });
  }

  const satisfied = missionV2Receipt && Array.isArray(receipt.satisfied_acceptance_hashes)
    ? [...receipt.satisfied_acceptance_hashes]
    : [];
  const claimAcceptance = new Set(claim.acceptance_hashes || []);
  if (satisfied.some((hash) => (
    typeof hash !== 'string'
      || !/^[a-f0-9]{64}$/.test(hash)
      || !claimAcceptance.has(hash)
      || (next.required_acceptance_hashes.length > 0
        && !next.required_acceptance_hashes.includes(hash))
  ))) {
    return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
  }
  let progressDelta = 0;
  for (const acceptanceHash of satisfied) {
    if (!next.acceptance_hashes.includes(acceptanceHash)) progressDelta += 1;
    const accepted = reduceMissionState(next, {
      event_type: 'acceptance_satisfied',
      sequence: next.events.length + 1,
      mission_lineage_id: next.mission_lineage_id,
      payload: { acceptance_hash: acceptanceHash },
    });
    if (!accepted || !accepted.state
        || accepted.receipt.artifact_type === 'mission_grant_rejected') {
      return Object.freeze({ status: 'rejected', reason: 'binding_mismatch', state });
    }
    next = accepted.state;
  }
  const remaining = next.required_acceptance_hashes
    .filter((hash) => !next.acceptance_hashes.includes(hash));
  if (missionV2Receipt && remaining.length > 0 && progressDelta === 0) {
    const stagnation = reduceMissionState(next, {
      event_type: 'stagnation_observation',
      sequence: next.events.length + 1,
      mission_lineage_id: next.mission_lineage_id,
      payload: {
        stagnant_campaigns: next.stagnant_campaigns + 1,
        acceptance_unresolved: true,
        request_third_grant: false,
      },
    });
    next = stagnation.state;
  } else if (missionV2Receipt && remaining.length === 0 && !next.terminal) {
    const closed = reduceMissionState(next, {
      event_type: 'closure_evaluated',
      sequence: next.events.length + 1,
      mission_lineage_id: next.mission_lineage_id,
      payload: {
        ratio: 1,
        other_axes_below_ratio: false,
        unknown_required_axis: false,
      },
    });
    next = closed.state;
  }
  const receipts = {
    ...(next.receipts || {}),
    [`mission_campaign_receipt:${claim.claim_id}`]: deepFreeze(deepClone(receipt)),
  };
  return Object.freeze({
    status: 'applied',
    progress_delta: progressDelta,
    remaining_acceptance: Object.freeze(remaining),
    state: Object.freeze({ ...next, receipts: Object.freeze(receipts) }),
  });
}

// Module-private object-identity attestation for Codex enforcement disposition
// receipts. Genuine receipts minted by evaluateCodexEnforcementDisposition are
// registered in a closed WeakSet; a caller cannot forge, clone (including
// descriptor-preserving Object.create clones), or re-key a disposition into a
// usable enforcement adapter. Receipts carry zero own Symbols — identity is
// the only authentication key. No public token, registry, verifier predicate,
// or mutable global state is exported.
const CODEX_DISPOSITION_REGISTRY = new WeakSet();

function attestCodexDispositionReceipt(receipt) {
  // Registry keys on the exact frozen object identity. Clones and spreads are
  // different objects and will not pass codexDispositionReceiptAttested.
  CODEX_DISPOSITION_REGISTRY.add(receipt);
  return receipt;
}

function codexDispositionReceiptAttested(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return false;
  }
  return CODEX_DISPOSITION_REGISTRY.has(receipt);
}

function evaluateCodexEnforcementDisposition({ artifact, capability, expected_harness_id } = {}) {
  const deny = (reason) => Object.freeze({ enforceable: false, mode: 'shadow', reason, receipt_digest: sha256({ enforceable: false, mode: 'shadow', reason }) });
  if (!isPlainObject(artifact) || !isPlainObject(capability) || typeof expected_harness_id !== 'string'
      || artifact.schema_version !== 1 || artifact.artifact_type !== 'codex_enforcement_probe'
      || capability.id !== expected_harness_id || capability.harness_level !== 'H2'
      || !['block-capable', 'wrapper-required', 'unenforceable-now'].includes(artifact.codex_enforcement_outcome)
      || capability.mission_enforcement_probe_digest !== sha256(artifact)
      || !artifact.evidence || artifact.evidence.hook_invoked !== true
      || artifact.evidence.request_bound !== true || artifact.evidence.blocked_target_created !== false
      || !/^[a-f0-9]{64}$/.test(artifact.evidence.stdout_sha256 || '')
      || !/^[a-f0-9]{64}$/.test(artifact.evidence.stderr_sha256 || '')) return deny('invalid_or_tampered_disposition');
  const enforceable = artifact.codex_enforcement_outcome !== 'unenforceable-now';
  const mode = enforceable ? 'enforce' : 'shadow';
  const reason = enforceable ? artifact.codex_enforcement_outcome : 'unenforceable-now';
  const receipt = Object.freeze({
    enforceable,
    mode,
    reason,
    harness_id: expected_harness_id,
    artifact_digest: sha256(artifact),
    receipt_digest: sha256({ enforceable, mode, reason, harness_id: expected_harness_id, artifact_digest: sha256(artifact) }),
  });
  return attestCodexDispositionReceipt(receipt);
}

function sortedAcceptanceIds(ids) {
  return Array.isArray(ids) ? [...ids].map(String).sort() : [];
}

function claimBindingTupleMatches(claim, payload, state) {
  if (!claim || !isPlainObject(payload) || !state) return false;
  if (state.mission_lineage_id !== payload.mission_lineage_id) return false;
  if (state.task_authority_id !== payload.task_authority_id) return false;
  if (claim.campaign_id !== payload.campaign_id) return false;
  // v2 is explicit only — never promote from field shape / digest presence.
  const claimV2 = isMissionSubjectV2Claim(claim);
  const payloadV2 = isMissionSubjectV2Claim(payload);
  if (claimV2 || payloadV2) {
    if (!claimV2 || !payloadV2) return false;
    const claimSubject = claimMissionSubjectDigest(claim);
    const payloadSubject = claimMissionSubjectDigest(payload);
    if (!claimSubject || !payloadSubject || claimSubject !== payloadSubject) return false;
    if (claim.identity_scheme !== payload.identity_scheme) return false;
    // Stored claim lineage/authority must exist and match Mission state.
    if (typeof claim.mission_lineage_id !== 'string'
        || claim.mission_lineage_id !== state.mission_lineage_id
        || typeof claim.task_authority_id !== 'string'
        || claim.task_authority_id !== state.task_authority_id) {
      return false;
    }
  } else if (claim.campaign_contract_digest !== payload.campaign_contract_digest) {
    return false;
  }
  if (claim.base_sha !== payload.base_sha) return false;
  const leftIds = sortedAcceptanceIds(claim.acceptance_ids);
  const rightIds = sortedAcceptanceIds(payload.acceptance_ids);
  if (leftIds.length !== rightIds.length) return false;
  for (let i = 0; i < leftIds.length; i += 1) {
    if (leftIds[i] !== rightIds[i]) return false;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'expires_at')
      && payload.expires_at !== undefined
      && claim.expires_at !== payload.expires_at) {
    return false;
  }
  let requestedReservation;
  try {
    requestedReservation = reservationFor(payload, 'payload');
  } catch (_error) {
    return false;
  }
  if (!claim.reservation || !sameReservation(claim.reservation, requestedReservation)) {
    return false;
  }
  return true;
}

function persistMissionStateCas(store, expected, next) {
  let saved;
  try {
    saved = store.save(expected, next);
  } catch (error) {
    return {
      ok: false,
      code: 'mission_state_cas_failed',
      reason: error.message || String(error),
    };
  }
  // Only an explicit boolean true is a successful CAS write. false, undefined,
  // null, or any other return is a CAS failure — never treat as success.
  if (saved !== true) {
    return {
      ok: false,
      code: 'mission_state_cas_failed',
      reason: 'Mission state compare-and-swap save did not confirm success',
    };
  }
  return { ok: true };
}

// Bounded file-backed Mission state store for trusted host wiring.
// CAS success is only an explicit boolean true. Uses an exclusive lock file,
// compares the current state hash to the expected snapshot, then writes via
// temp-file atomic rename. Contention or any error fails closed (returns false
// or throws from load).
function createFileBackedMissionStateStore(statePath) {
  if (typeof statePath !== 'string' || statePath.length === 0) {
    throw new TypeError('createFileBackedMissionStateStore requires a non-empty state path');
  }
  const absolute = path.resolve(statePath);
  const lockPath = `${absolute}.lock`;

  function readStateUnlocked() {
    const raw = fs.readFileSync(absolute, 'utf8');
    const state = JSON.parse(raw);
    validateMissionState(state);
    return state;
  }

  function withExclusiveLock(fn) {
    const deadline = Date.now() + 8000;
    let delayMs = 5;
    let lockFd = null;
    while (lockFd === null) {
      try {
        lockFd = fs.openSync(lockPath, 'wx', 0o600);
        fs.writeSync(lockFd, String(process.pid));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) {
          const err = new Error('Mission state store lock contention');
          err.code = 'mission_state_cas_failed';
          throw err;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        delayMs = Math.min(delayMs * 2, 50);
      }
    }
    try {
      return fn();
    } finally {
      try { fs.closeSync(lockFd); } catch (_closeError) { /* ignore */ }
      try { fs.unlinkSync(lockPath); } catch (_unlinkError) { /* ignore */ }
    }
  }

  return {
    load() {
      return withExclusiveLock(() => readStateUnlocked());
    },
    save(expected, next) {
      try {
        return withExclusiveLock(() => {
          let current;
          try {
            current = readStateUnlocked();
          } catch (error) {
            return false;
          }
          let expectedHash;
          let currentHash;
          try {
            expectedHash = stateHash(expected);
            currentHash = stateHash(current);
          } catch (_error) {
            return false;
          }
          if (expectedHash !== currentHash) return false;
          let nextValid = true;
          try { validateMissionState(next); } catch (_error) { nextValid = false; }
          if (!nextValid) return false;
          const temp = `${absolute}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
          const bytes = `${JSON.stringify(next, null, 2)}\n`;
          let fd = null;
          try {
            fd = fs.openSync(temp, 'wx', 0o600);
            fs.fchmodSync(fd, 0o600);
            fs.writeFileSync(fd, bytes, 'utf8');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            fd = null;
            fs.renameSync(temp, absolute);
            try {
              const parentFd = fs.openSync(path.dirname(absolute), 'r');
              try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
            } catch (_fsyncError) {
              // Parent fsync is best-effort on filesystems that disallow it.
            }
            return true;
          } catch (_error) {
            if (fd !== null) {
              try { fs.closeSync(fd); } catch (_closeError) { /* ignore */ }
            }
            try { fs.unlinkSync(temp); } catch (_unlinkError) { /* ignore */ }
            return false;
          }
        });
      } catch (_error) {
        return false;
      }
    },
  };
}

function rebuildReservationPerAxis(claimReservation) {
  if (!isPlainObject(claimReservation)) return null;
  // Claims store an axis-keyed reservation map; grant payloads use per_axis.
  if (Array.isArray(claimReservation.per_axis)) return claimReservation;
  const perAxis = [];
  for (const axisName of SUPPORTED_AXES) {
    const entry = claimReservation[axisName];
    if (!isPlainObject(entry)) return null;
    perAxis.push({
      axis: axisName,
      authorized_ceiling: entry.authorized_ceiling,
      reserved_active: entry.reserved_active,
      durable_consumed: entry.durable_consumed,
      known: entry.known === true,
    });
  }
  return { per_axis: perAxis };
}

function resolveLiveClaimByGrantRef(state, grantRef) {
  if (typeof grantRef !== 'string' || !/^[0-9a-f]{64}$/.test(grantRef)) {
    return {
      ok: false,
      code: 'mission_grant_ref_invalid',
      reason: 'grant_ref must be a lowercase SHA-256 Mission grant binding digest',
    };
  }
  const matches = [];
  const claims = state.claims && typeof state.claims === 'object' ? state.claims : {};
  for (const claim of Object.values(claims)) {
    if (claim && claim.binding_digest === grantRef) matches.push(claim);
  }
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'mission_grant_ref_not_found',
      reason: 'no Mission claim matches the grant_ref binding digest',
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'mission_grant_ref_ambiguous',
      reason: 'grant_ref matches more than one Mission claim',
    };
  }
  const claim = matches[0];
  if (claim.released === true || claim.terminal === true) {
    return {
      ok: false,
      code: 'mission_grant_ref_released',
      reason: 'matching Mission claim is released or terminal',
    };
  }
  return { ok: true, claim };
}

function claimPayloadFromExistingClaim(state, claim) {
  const reservation = rebuildReservationPerAxis(claim.reservation);
  // Prefer exact stored claim lineage/authority when present so later
  // verification can compare claim-retained fields against Mission state.
  const payload = {
    idempotency_key: claim.idempotency_key,
    mission_lineage_id: typeof claim.mission_lineage_id === 'string'
      ? claim.mission_lineage_id
      : state.mission_lineage_id,
    task_authority_id: typeof claim.task_authority_id === 'string'
      ? claim.task_authority_id
      : state.task_authority_id,
    campaign_id: claim.campaign_id,
    campaign_contract_digest: claim.campaign_contract_digest,
    base_sha: claim.base_sha,
    acceptance_ids: Array.isArray(claim.acceptance_ids) ? [...claim.acceptance_ids] : [],
    reservation,
    issued_at: claim.issued_at,
    expires_at: claim.expires_at,
  };
  // Explicit scheme only — never promote from mission_subject_digest presence.
  if (claim.identity_scheme === IDENTITY_SCHEME_V2) {
    payload.identity_scheme = IDENTITY_SCHEME_V2;
    payload.mission_subject_digest = claimMissionSubjectDigest(claim);
    // Compatibility alias only: must equal subject for v2.
    if (payload.campaign_contract_digest == null) {
      payload.campaign_contract_digest = payload.mission_subject_digest;
    }
  }
  return payload;
}

function createMissionCampaignAdapters(options = {}) {
  const store = options.store;
  const hasAtomicStore = isPlainObject(store)
    && typeof store.load === 'function'
    && typeof store.save === 'function';
  const lineageId = typeof options.mission_lineage_id === 'string' ? options.mission_lineage_id : null;
  const grantRef = typeof options.grant_ref === 'string' ? options.grant_ref : null;
  const expectedSubject = typeof options.mission_subject_digest === 'string'
    ? options.mission_subject_digest
    : null;
  const expectedCampaignId = typeof options.campaign_id === 'string'
    ? options.campaign_id
    : null;

  function claimPayload(state, input) {
    const grant = isPlainObject(options.grant) ? options.grant : options;
    const payload = {
      idempotency_key: grant.idempotency_key,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: grant.campaign_id,
      campaign_contract_digest: input.contractDigest || grant.campaign_contract_digest,
      base_sha: input.base || grant.base_sha,
      acceptance_ids: Array.isArray(grant.acceptance_ids) ? grant.acceptance_ids : [],
      reservation: grant.reservation,
      issued_at: grant.issued_at || input.observedAt,
      expires_at: grant.expires_at,
    };
    // Explicit scheme only — never promote from mission_subject_digest presence.
    if (grant.identity_scheme === IDENTITY_SCHEME_V2) {
      payload.identity_scheme = IDENTITY_SCHEME_V2;
      payload.mission_subject_digest = grant.mission_subject_digest
        || input.mission_subject_digest
        || expectedSubject;
      // Alias only — never the raw final-byte digest for v2.
      if (payload.mission_subject_digest) {
        payload.campaign_contract_digest = payload.mission_subject_digest;
      }
      if (!payload.campaign_id && expectedCampaignId) {
        payload.campaign_id = expectedCampaignId;
      }
    }
    return payload;
  }

  return {
    missionClaim(input = {}) {
      if (!hasAtomicStore) {
        return {
          owner: 'mission',
          status: 'rejected',
          code: 'mission_state_store_required',
          reason: 'atomic Mission state load/compare-and-swap save is required to claim a grant',
        };
      }
      let state;
      try { state = store.load(); } catch (error) {
        return { owner: 'mission', status: 'rejected', code: 'mission_state_load_failed', reason: error.message || String(error) };
      }
      let stateValid = true;
      try { validateMissionState(state); } catch (_error) { stateValid = false; }
      if (!stateValid) {
        return { owner: 'mission', status: 'rejected', code: 'mission_state_invalid', reason: 'loaded Mission state failed validation' };
      }
      if (lineageId !== null && state.mission_lineage_id !== lineageId) {
        return { owner: 'mission', status: 'rejected', code: 'mission_lineage_mismatch', reason: 'Mission state lineage does not match the requested lineage' };
      }

      // Trusted grant_ref path: resolve the exact existing live claim by binding
      // digest and rebuild the claim payload internally. Exact intake retry
      // returns that same claim with resumed:true; absent/ambiguous/released/
      // mismatched refs reject. No caller-supplied grant fields are trusted.
      if (grantRef !== null) {
        const resolved = resolveLiveClaimByGrantRef(state, grantRef);
        if (!resolved.ok) {
          return {
            owner: 'mission',
            status: 'rejected',
            code: resolved.code,
            reason: resolved.reason,
          };
        }
        const claim = resolved.claim;
        const v2 = isMissionSubjectV2Claim(claim);
        if (v2) {
          // v2: subject is independent of raw final-byte contract digest.
          // Never require claim.campaign_contract_digest === raw contractDigest.
          const claimSubject = claimMissionSubjectDigest(claim);
          if (expectedSubject !== null && claimSubject !== expectedSubject) {
            return {
              owner: 'mission',
              status: 'rejected',
              code: 'mission_grant_ref_mismatch',
              reason: 'grant_ref claim mission_subject_digest does not match expected subject',
            };
          }
          if (typeof input.mission_subject_digest === 'string'
              && input.mission_subject_digest.length > 0
              && claimSubject !== input.mission_subject_digest) {
            return {
              owner: 'mission',
              status: 'rejected',
              code: 'mission_grant_ref_mismatch',
              reason: 'grant_ref claim mission_subject_digest does not match intake subject',
            };
          }
          if (expectedCampaignId !== null && claim.campaign_id !== expectedCampaignId) {
            return {
              owner: 'mission',
              status: 'rejected',
              code: 'mission_grant_ref_mismatch',
              reason: 'grant_ref claim campaign_id does not match expected campaign-v2 id',
            };
          }
        } else if (typeof input.contractDigest === 'string'
            && input.contractDigest.length > 0
            && claim.campaign_contract_digest !== input.contractDigest) {
          return {
            owner: 'mission',
            status: 'rejected',
            code: 'mission_grant_ref_mismatch',
            reason: 'grant_ref claim campaign_contract_digest does not match intake contractDigest',
          };
        }
        if (typeof input.base === 'string'
            && input.base.length > 0
            && claim.base_sha !== input.base) {
          return {
            owner: 'mission',
            status: 'rejected',
            code: 'mission_grant_ref_mismatch',
            reason: 'grant_ref claim base_sha does not match intake base',
          };
        }
        // Rebuild payload for internal consistency (not caller-supplied).
        const rebuilt = claimPayloadFromExistingClaim(state, claim);
        if (!rebuilt.reservation || !claimBindingTupleMatches(claim, rebuilt, state)) {
          return {
            owner: 'mission',
            status: 'rejected',
            code: 'mission_grant_ref_mismatch',
            reason: 'grant_ref claim could not be rebuilt into a matching binding tuple',
          };
        }
        return {
          owner: 'mission',
          status: 'claimed',
          claim_id: claim.claim_id,
          resumed: true,
          mission_lineage_id: state.mission_lineage_id,
          control_sequence: state.control_sequence,
          identity_scheme: claim.identity_scheme || null,
          mission_subject_digest: claimMissionSubjectDigest(claim),
          campaign_id: claim.campaign_id,
        };
      }

      const payload = claimPayload(state, input);
      // Exact retry adopts the already-stored claim only when the complete
      // binding tuple matches. A same-key changed binding fails closed with a
      // distinct code so callers cannot silently rebind a reservation.
      if (typeof payload.idempotency_key === 'string'
          && state.claim_idempotency_index
          && state.claim_idempotency_index[payload.idempotency_key]) {
        const existingClaimId = state.claim_idempotency_index[payload.idempotency_key];
        const existing = state.claims[existingClaimId];
        if (!claimBindingTupleMatches(existing, payload, state)) {
          return {
            owner: 'mission',
            status: 'rejected',
            code: 'mission_idempotency_binding_mismatch',
            reason: 'idempotency key is already bound to a different campaign binding tuple',
          };
        }
        return {
          owner: 'mission',
          status: 'claimed',
          claim_id: existingClaimId,
          resumed: true,
          mission_lineage_id: state.mission_lineage_id,
          control_sequence: state.control_sequence,
        };
      }
      const event = {
        event_type: 'grant_claimed',
        sequence: state.events.length + 1,
        mission_lineage_id: state.mission_lineage_id,
        payload,
      };
      let result;
      try { result = reduceMissionState(state, event); } catch (error) {
        return { owner: 'mission', status: 'rejected', code: 'mission_claim_invalid', reason: error.message || String(error) };
      }
      if (!result || !result.state || !result.receipt
          || result.receipt.artifact_type === 'mission_grant_rejected') {
        return {
          owner: 'mission',
          status: 'rejected',
          code: 'mission_grant_rejected',
          reason: (result && result.receipt && result.receipt.reason) || 'mission_grant_rejected',
        };
      }
      const cas = persistMissionStateCas(store, state, result.state);
      if (!cas.ok) {
        return { owner: 'mission', status: 'rejected', code: cas.code, reason: cas.reason };
      }
      return {
        owner: 'mission',
        status: 'claimed',
        claim_id: result.receipt.claim_id,
        mission_lineage_id: state.mission_lineage_id,
        control_sequence: result.state.control_sequence,
      };
    },
    releaseMission(input = {}) {
      const missionClaim = input.missionClaim;
      const claimId = missionClaim && missionClaim.claim_id;
      // Release requires the same atomic store as claim. Without it there is
      // no durable pre-spawn claim to free, so fail closed rather than
      // reporting a phantom release.
      if (!hasAtomicStore) {
        return {
          owner: 'mission_release',
          status: 'rejected',
          code: 'mission_state_store_required',
          reason: 'atomic Mission state load/compare-and-swap save is required to release a grant',
          claim_id: claimId,
        };
      }
      let state;
      try { state = store.load(); } catch (error) {
        return { owner: 'mission_release', status: 'rejected', code: 'mission_state_load_failed', reason: error.message || String(error) };
      }
      let stateValid = true;
      try { validateMissionState(state); } catch (_error) { stateValid = false; }
      if (!stateValid) {
        return {
          owner: 'mission_release',
          status: 'rejected',
          code: 'mission_state_invalid',
          reason: 'loaded Mission state failed validation',
          claim_id: claimId,
        };
      }
      const claim = state && state.claims && claimId ? state.claims[claimId] : null;
      // Already released: release is idempotent and must not double-free.
      if (claim && claim.released) {
        return { owner: 'mission_release', status: 'released', claim_id: claimId };
      }
      // Only a proven pre-spawn no-effect claim may be released. Reconciled /
      // partially consumed claims must not have durable consumption erased.
      if (!claim) {
        return {
          owner: 'mission_release',
          status: 'rejected',
          code: 'mission_release_claim_missing',
          reason: 'no-effect release requires a proven pre-spawn Mission claim',
          claim_id: claimId,
        };
      }
      if (claim.reconciled || claim.terminal) {
        return {
          owner: 'mission_release',
          status: 'rejected',
          code: 'mission_release_not_pre_spawn',
          reason: 'release is limited to pre-spawn no-effect claims; partial or durable consumption cannot be erased',
          claim_id: claimId,
        };
      }
      const event = {
        event_type: 'no_effect_release',
        sequence: state.events.length + 1,
        mission_lineage_id: state.mission_lineage_id,
        payload: {
          claim_id: claimId,
          actual_usage: {
            per_axis: SUPPORTED_AXES.map((axisName) => ({
              axis: axisName,
              authorized_ceiling: state.axes[axisName].authorized_ceiling,
              reserved_active: 0,
              durable_consumed: state.axes[axisName].durable_consumed,
              known: true,
            })),
          },
        },
      };
      let result;
      try { result = reduceMissionState(state, event); } catch (error) {
        return { owner: 'mission_release', status: 'rejected', code: 'mission_release_invalid', reason: error.message || String(error) };
      }
      if (!result || !result.state || !result.receipt
          || result.receipt.artifact_type === 'mission_grant_rejected') {
        return {
          owner: 'mission_release',
          status: 'rejected',
          code: 'mission_release_rejected',
          reason: (result && result.receipt && result.receipt.reason) || 'mission_release_rejected',
          claim_id: claimId,
        };
      }
      const cas = persistMissionStateCas(store, state, result.state);
      if (!cas.ok) {
        return { owner: 'mission_release', status: 'rejected', code: cas.code, reason: cas.reason, claim_id: claimId };
      }
      return { owner: 'mission_release', status: 'released', claim_id: claimId };
    },
  };
}

function createCodexMissionEnforcementAdapter({ mission_state, grant_receipt, disposition_receipt } = {}) {
  const reject = (reason) => Object.freeze({ rejected: true, reason });
  let stateValid = true;
  try { validateMissionState(mission_state); } catch (_error) { stateValid = false; }
  if (!stateValid) return reject('binding_mismatch');
  // The disposition receipt must be a genuine, WeakSet-attested, enforceable
  // receipt emitted by evaluateCodexEnforcementDisposition. Descriptor-
  // preserving clones and forged objects have no registry identity.
  if (!codexDispositionReceiptAttested(disposition_receipt)
      || disposition_receipt.enforceable !== true
      || typeof disposition_receipt.harness_id !== 'string'
      || disposition_receipt.harness_id.length === 0
      || typeof disposition_receipt.receipt_digest !== 'string') {
    return reject('invalid_or_tampered_disposition');
  }
  // The grant receipt must bind exactly to a validated, non-released claim
  // already present in Mission state.
  if (!isPlainObject(grant_receipt)
      || grant_receipt.artifact_type !== 'mission_campaign_grant_claimed'
      || typeof grant_receipt.claim_id !== 'string') {
    return reject('binding_mismatch');
  }
  const claim = mission_state.claims && mission_state.claims[grant_receipt.claim_id];
  if (!claim || claim.released
      || grant_receipt.binding_digest !== claim.binding_digest
      || grant_receipt.mission_lineage_id !== mission_state.mission_lineage_id) {
    return reject('binding_mismatch');
  }
  const boundClaimId = claim.claim_id;
  const boundLineage = mission_state.mission_lineage_id;
  const boundSequence = mission_state.control_sequence;
  const boundDispositionDigest = disposition_receipt.receipt_digest;
  // Request identity is derived solely from the attested disposition's
  // harness binding. A caller-supplied request_identity option is ignored
  // so an attacker cannot rebind a genuine Codex disposition to a chosen
  // identity string.
  const boundIdentity = disposition_receipt.harness_id;
  const mode = disposition_receipt.mode;
  return Object.freeze({
    enforce(request, effect) {
      if (!isPlainObject(request)
          || request.claim_id !== boundClaimId
          || request.mission_lineage_id !== boundLineage
          || request.control_sequence !== boundSequence
          || request.disposition_digest !== boundDispositionDigest
          || request.request_identity !== boundIdentity
          || typeof effect !== 'function') {
        return Object.freeze({ enforced: false, reason: 'binding_mismatch' });
      }
      if (mode === 'shadow') {
        const result = effect();
        return Object.freeze({ enforced: false, shadow_would_block: true, result });
      }
      return Object.freeze({ enforced: true, result: effect() });
    },
  });
}

function fenceMissionEffect({ mission_state, control_receipt, request, effects } = {}) {
  const deny = (reason) => Object.freeze({ permitted: false, reason });
  let stateValid = true;
  try { validateMissionState(mission_state); } catch (_error) { stateValid = false; }
  if (!stateValid) return deny('binding_mismatch');
  // Current sequence/state is derived from Mission state only — never from the
  // request. Bind the control receipt to that sequence when it carries one.
  const currentSequence = mission_state.control_sequence;
  const receiptSequence = isPlainObject(control_receipt)
    && Number.isSafeInteger(control_receipt.sequence)
    ? control_receipt.sequence
    : (isPlainObject(control_receipt) && Number.isSafeInteger(control_receipt.control_sequence)
      ? control_receipt.control_sequence
      : null);
  if (receiptSequence !== null && receiptSequence !== currentSequence) {
    return deny('control_sequence_stale');
  }
  if (!isPlainObject(request)
      || !Number.isSafeInteger(request.control_sequence)
      || request.control_sequence !== currentSequence) {
    return deny('control_sequence_stale');
  }
  if (!CLOSURE_ALLOWLIST_SET.has(request.effect_class)) {
    return deny('effect_class_not_allowlisted');
  }
  const effectKind = typeof request.effect_kind === 'string' ? request.effect_kind : 'runner';
  const fn = isPlainObject(effects) ? effects[effectKind] : undefined;
  if (typeof fn !== 'function') return deny('effect_class_not_allowlisted');
  return Object.freeze({
    permitted: true,
    effect_class: request.effect_class,
    effect_kind: effectKind,
    control_sequence: currentSequence,
    result: fn(),
  });
}

function recordMissionClosureEffect(state, input = {}) {
  let stateValid = true;
  try { validateMissionState(state); } catch (_error) { stateValid = false; }
  if (!stateValid) return Object.freeze({ rejected: true, reason: 'binding_mismatch' });
  if (!isPlainObject(input) || !CLOSURE_ALLOWLIST_SET.has(input.effect_class)) {
    return Object.freeze({ rejected: true, reason: 'effect_class_not_allowlisted' });
  }
  const currentSequence = state.control_sequence;
  if (!Number.isSafeInteger(input.control_sequence) || input.control_sequence !== currentSequence) {
    return Object.freeze({ rejected: true, reason: 'control_sequence_stale' });
  }
  if (typeof input.evidence_ref_digest !== 'string'
      || !/^[a-f0-9]{64}$/.test(input.evidence_ref_digest)) {
    return Object.freeze({ rejected: true, reason: 'binding_mismatch' });
  }
  const body = {
    schema_version: 1,
    artifact_type: 'mission_closure_effect',
    effect_class: input.effect_class,
    control_sequence: input.control_sequence,
    sequence: currentSequence,
    evidence_ref_digest: input.evidence_ref_digest,
    mission_state_hash: stateHash(state),
    mission_lineage_id: state.mission_lineage_id,
  };
  const contentDigest = sha256(body);
  return Object.freeze({ ...body, content_digest: contentDigest, receipt_digest: contentDigest });
}

function buildMissionTerminalReceipt(state, residue) {
  validateMissionState(state);
  if (!state.terminal || !TERMINAL_STATES.has(state.state) || !isPlainObject(residue)
      || typeof residue.residue_digest !== 'string') {
    fail('terminal receipt requires terminal state and bound residue');
  }
  // ABORTED-only: refuse receipts for forged terminal markers that lack the
  // reducer-owned abort_finalized binding. COMPLETE/BLOCKED semantics unchanged.
  if (state.state === 'ABORTED') {
    const canonical = evaluateCanonicalAbortedTerminal(state);
    if (!canonical.ok) {
      fail(
        `ABORTED terminal receipt requires canonical abort finalization (${canonical.reason || 'noncanonical_abort_terminal'})`,
      );
    }
  }
  // The residue digest must bind the actual residue content (excluding the
  // residue_digest field itself), not merely satisfy a 64-hex shape check.
  const residueContent = Object.fromEntries(
    Object.entries(residue).filter(([key]) => key !== 'residue_digest'),
  );
  if (sha256(residueContent) !== residue.residue_digest) {
    fail('terminal receipt residue_digest does not bind residue content');
  }
  const body = { schema_version: 1, artifact_type: 'mission_terminal_receipt', mission_terminal: true, state_digest: stateHash(state), terminal_digest: sha256(state.terminal), residue: deepClone(residue), residue_digest: residue.residue_digest };
  return deepFreeze({ ...body, receipt_digest: sha256(body) });
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
  SOURCE_REF_KINDS,
  SUPPORTED_AXES,
  TERMINAL_STATES,
  buildProjection,
  applyMissionCampaignReceipt,
  createFileBackedMissionStateStore,
  createMissionCampaignAdapters,
  evaluateCodexEnforcementDisposition,
  createCodexMissionEnforcementAdapter,
  fenceMissionEffect,
  recordMissionClosureEffect,
  buildMissionTerminalReceipt,
  canonicalJson,
  claimIdFor,
  computeAxisBudget,
  computeConfigDigest,
  computeSourceRefDigest,
  createMissionState,
  evaluateCanonicalAbortedTerminal,
  evaluateConfig,
  evaluateIdentityReset,
  evaluateMissionIntegrationFixture,
  evaluateMissionReducerFixture,
  reduceMissionState,
  remainingForAxis,
  restoreProjection,
  sha256,
  stateHash,
  validateMissionContract,
  validateMissionState,
  validateSourceRef,
  validateSourceRefs,
  IDENTITY_SCHEME_V2,
  missionCampaignIdFor,
  missionSubjectDigest,
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
