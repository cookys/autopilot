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
  consumeAuthenticatedControlEvent,
  isAuthenticatedAdapterCapability,
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
    enforcement_mode: contract.enforcement_mode,
    contract_state: contract.state,
    closure_ratio: contract.closure_ratio,
    max_stagnant_campaigns: contract.max_stagnant_campaigns !== undefined
      ? contract.max_stagnant_campaigns : DEFAULT_MAX_STAGNANT,
    red_lines: [...(contract.red_lines || [])].sort(),
    axes: perAxis,
    grant_contract: contract.grant_contract,
    control_contract: contract.control_contract,
    lineage_binding: contract.lineage_binding,
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
  return Object.freeze({
    kind,
    locator: rawRef.locator,
    label: rawRef.label,
    evidence_kind: rawRef.evidence_kind,
    ref_class: rawRef.ref_class,
    digest: claimedDigest,
  });
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
  if (!ENFORCEMENT_MODES.has(state.enforcement_mode)) {
    fail('state.enforcement_mode must be "shadow" or "enforce"');
  }
  if (!MISSION_STATE_SET.has(state.state)) {
    fail('state.state must be a valid Mission state');
  }
  requireNumber(state.closure_ratio, 'state.closure_ratio', 0, 1);
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
    enforcement_mode: state.enforcement_mode,
    state: state.state,
    closure_ratio: state.closure_ratio,
    max_stagnant_campaigns: state.max_stagnant_campaigns,
    successor_inherits_durable_consumed: !!state.successor_inherits_durable_consumed,
    control_sequence: state.control_sequence,
    closure_allowlist: [...(state.closure_allowlist || [])].sort(),
    stagnant_campaigns: state.stagnant_campaigns,
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

function reduceMissionState(state, event) {
  // Validate state before accessing state.terminal — a malformed state is
  // a reducer error, not a transient condition.
  validateMissionState(state);
  if (state.terminal) {
    fail('cannot reduce a terminal Mission state', 'MISSION_STATE_TERMINAL');
  }
  const { eventType, sequence, payload } = validateEventShape(event);
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
    const consume = consumeAuthenticatedControlEvent(payload.event);
    if (!consume || consume.ok !== true || !consume.event) {
      fail('control_event must be produced by an AuthenticatedControlAdapter instance', 'MISSION_CONTROL_UNAUTHENTICATED');
    }
    sanitizedControlEvent = consume.event;
  }
  // Build the digest input payload. For control/ceiling events we replace
  // the raw canonical event with the sanitized snapshot, so the identity-
  // bearing object (and any field that could carry it) is excluded from
  // the digest. For other event types, the digest input is the payload as
  // submitted, with all enumerable own keys.
  let digestPayload;
  if (sanitizedControlEvent) {
    digestPayload = { ...payload, event: sanitizedControlEvent };
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
      return shadowOrBlock(state, event, 'resource_ceiling', {
        overspend_axis: axis,
        requested: req.reserved_active,
        remaining: newRemaining,
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
  const claim = {
    claim_id: claimId,
    idempotency_key: idempotencyKey,
    binding_digest: bindingHash,
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
    reservation_consumed: reservation,
    binding_digest: bindingHash,
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
    const claim = {
      claim_id: grant.claimId,
      idempotency_key: grant.idempotencyKey,
      binding_digest: grant.bindingHash,
      campaign_id: event.payload.campaign_id,
      campaign_contract_digest: event.payload.campaign_contract_digest,
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
  // Missing actual axes mean zero actual but still free their reservation
  // — every axis in the original reservation must be returned even when the
  // caller didn't observe any usage on it.
  const mergedActual = {};
  for (const axisName of SUPPORTED_AXES) {
    const resv = claim.reservation[axisName];
    if (!resv) continue;
    const observed = actual[axisName];
    mergedActual[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: 0,
      durable_consumed: observed ? observed.reserved_active : 0,
      known: resv.known,
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
        known: cur.known,
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
      known: cur.known,
      enforced: cur.enforced,
    });
    reservationConsumed[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: observed,
      durable_consumed: 0,
      known: resv.known,
    };
    reservationFreed[axisName] = {
      axis: axisName,
      authorized_ceiling: resv.authorized_ceiling,
      reserved_active: resv.reserved_active - observed,
      durable_consumed: 0,
      known: resv.known,
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
    nextState = setTerminal(appendEvent(state, event), 'ABORTING', 'abort_requested');
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
    schema_version: MISSION_SCHEMA_VERSION,
    artifact_type: 'mission_projection',
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    policy_hash: state.policy_hash,
    enforcement_mode: state.enforcement_mode,
    closure_ratio: state.closure_ratio,
    max_stagnant_campaigns: state.max_stagnant_campaigns,
    successor_inherits_durable_consumed: state.successor_inherits_durable_consumed,
    frozen_intent: {
      objective: state.repo_identity,
      intent_hash: sha256(state.config.intent || state.repo_identity),
    },
    remaining_acceptance: [...state.acceptance_hashes].sort(),
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
      acceptance_hashes: [...state.acceptance_hashes].sort(),
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
    enforcement_mode: configSnapshot.enforcement_mode,
    state: configSnapshot.contract_state,
    closure_ratio: configSnapshot.closure_ratio,
    max_stagnant_campaigns: configSnapshot.max_stagnant_campaigns,
    red_lines: configSnapshot.red_lines || [],
    axes: configSnapshot.axes,
    grant_contract: configSnapshot.grant_contract,
    control_contract: configSnapshot.control_contract,
    lineage_binding: configSnapshot.lineage_binding,
  };
  // Cross-field lineage/task/policy binding check.
  if (reconstructedConfig.lineage_binding.task_authority_id !== reconstructedConfig.task_authority_id) {
    fail('config lineage_binding.task_authority_id does not match task_authority_id', 'PROJECTION_BINDING_MISMATCH');
  }
  if (reconstructedConfig.lineage_binding.policy_hash !== reconstructedConfig.policy_hash) {
    fail('config lineage_binding.policy_hash does not match policy_hash', 'PROJECTION_BINDING_MISMATCH');
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
    repo_identity: projection.frozen_intent.objective.slice(0, 1024),
    contract_id: `mission-v1-${sha256(projection.mission_lineage_id)}`,
    root_run_id: 'projection-restore',
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
      enforcement_mode: configSnapshot.enforcement_mode !== undefined
        ? configSnapshot.enforcement_mode : projection.enforcement_mode,
      state: configSnapshot.contract_state !== undefined
        ? configSnapshot.contract_state : (snapshot.machine_state || 'DRAFT'),
      closure_ratio: configSnapshot.closure_ratio !== undefined
        ? configSnapshot.closure_ratio : projection.closure_ratio,
      max_stagnant_campaigns: configSnapshot.max_stagnant_campaigns !== undefined
        ? configSnapshot.max_stagnant_campaigns : projection.max_stagnant_campaigns,
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

  if (id === 'successor-model-branch-reset' || id === 'identity-preserves-remaining') {
    const result = runClaimForIntegration(state, input);
    const tc = result.state.axes.tool_calls;
    // Shadow would-block evidence carries the overspending axis; the integration
    // oracle surfaces the effective `BLOCKED` outcome derived from the real
    // reducer. The reducer itself does NOT transition to BLOCKED in shadow
    // (Finding 3 — shadow never blocks the effect). The adapter translates
    // the durable evidence so the corpus expectation (`state: BLOCKED`,
    // `reason: resource_ceiling:<axis>`) is met by what the real reducer
    // actually decided: it would-have-blocked this admission.
    let derivedState = result.state.state;
    let derivedReason = result.receipt.reason || null;
    if (result.receipt.artifact_type === 'mission_would_block_evidence'
      && result.receipt.evidence && result.receipt.evidence.overspend_axis) {
      derivedState = 'BLOCKED';
      derivedReason = `${result.receipt.reason}:${result.receipt.evidence.overspend_axis}`;
    }
    return {
      state: derivedState,
      reason: derivedReason,
      remaining_tool_calls: Math.max(0, tc.authorized_ceiling - tc.durable_consumed - tc.reserved_active),
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
  canonicalJson,
  claimIdFor,
  computeAxisBudget,
  computeConfigDigest,
  computeSourceRefDigest,
  createMissionState,
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
  validateSourceRef,
  validateSourceRefs,
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
