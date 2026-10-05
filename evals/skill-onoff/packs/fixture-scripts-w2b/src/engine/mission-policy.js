'use strict';

const { canonicalJson, cloneCanonical, sha256 } = require('./owner-kernel/canonical');

const MISSION_POLICY_SCHEMA_VERSION = 1;
const MODES = new Set(['off', 'shadow', 'enforce']);
const MODE_RANK = Object.freeze({ off: 0, shadow: 1, enforce: 2 });
const CEILING_FIELDS = Object.freeze([
  'max_campaigns',
  'max_wall_seconds',
  'max_tool_calls',
  'max_engine_attempts',
  'max_external_wait_seconds',
  'max_canonical_changed_files',
  'max_output_bytes',
  'max_deliverables',
  'max_parallel',
  'max_batches',
  'max_graph_depth',
  'max_gate_attempts',
]);
const MISSION_POLICY_FIELDS = Object.freeze([
  'schema_version',
  'enforcement_mode',
  ...CEILING_FIELDS,
  'closure_ratio',
  'max_stagnant_campaigns',
]);
const REQUIRED_FIELDS = new Set(MISSION_POLICY_FIELDS);
const OVERRIDE_FIELDS = new Set(MISSION_POLICY_FIELDS.filter((field) => field !== 'schema_version'));

class MissionPolicyError extends Error {
  constructor(message, code = 'INVALID_MISSION_POLICY') {
    super(message);
    this.name = 'MissionPolicyError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new MissionPolicyError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null)) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function rejectUnknown(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unsupported key "${key}"`);
  }
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function normalizeCompleteSection(raw) {
  const section = plainObject(raw, 'mission_convergence');
  rejectUnknown(section, REQUIRED_FIELDS, 'mission_convergence');
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(section, field)) {
      fail(`mission_convergence.${field} is required`);
    }
  }
  if (section.schema_version !== MISSION_POLICY_SCHEMA_VERSION) {
    fail(`mission_convergence.schema_version must equal ${MISSION_POLICY_SCHEMA_VERSION}`);
  }
  if (!MODES.has(section.enforcement_mode) || section.enforcement_mode === 'off') {
    fail('mission_convergence.enforcement_mode must be shadow or enforce when configured');
  }
  const normalized = {
    schema_version: MISSION_POLICY_SCHEMA_VERSION,
    enforcement_mode: section.enforcement_mode,
  };
  for (const field of CEILING_FIELDS) {
    const minimum = field.startsWith('max_graph_')
      || ['max_deliverables', 'max_parallel', 'max_batches', 'max_gate_attempts'].includes(field)
      ? 1 : 0;
    normalized[field] = safeInteger(section[field], `mission_convergence.${field}`, minimum);
  }
  if (typeof section.closure_ratio !== 'number'
      || !Number.isFinite(section.closure_ratio)
      || section.closure_ratio < 0
      || section.closure_ratio > 1) {
    fail('mission_convergence.closure_ratio must be a finite number in 0..1');
  }
  normalized.closure_ratio = section.closure_ratio;
  normalized.max_stagnant_campaigns = safeInteger(
    section.max_stagnant_campaigns,
    'mission_convergence.max_stagnant_campaigns',
  );
  return normalized;
}

function normalizeOverride(raw, label) {
  if (raw === undefined || raw === null) return null;
  const value = plainObject(raw, label);
  rejectUnknown(value, OVERRIDE_FIELDS, label);
  return value;
}

function tighten(base, raw, label) {
  const override = normalizeOverride(raw, label);
  if (!override) return base;
  const next = { ...base };
  if (override.enforcement_mode !== undefined) {
    if (!MODES.has(override.enforcement_mode)
        || MODE_RANK[override.enforcement_mode] < MODE_RANK[base.enforcement_mode]) {
      fail(`${label}.enforcement_mode may only tighten project policy`, 'MISSION_POLICY_BROADENED');
    }
    next.enforcement_mode = override.enforcement_mode;
  }
  for (const field of CEILING_FIELDS) {
    if (override[field] === undefined) continue;
    const minimum = field.startsWith('max_graph_')
      || ['max_deliverables', 'max_parallel', 'max_batches', 'max_gate_attempts'].includes(field)
      ? 1 : 0;
    safeInteger(override[field], `${label}.${field}`, minimum);
    if (override[field] > base[field]) {
      fail(`${label}.${field} may only lower the project ceiling`, 'MISSION_POLICY_BROADENED');
    }
    next[field] = override[field];
  }
  if (override.closure_ratio !== undefined) {
    if (typeof override.closure_ratio !== 'number'
        || !Number.isFinite(override.closure_ratio)
        || override.closure_ratio < base.closure_ratio
        || override.closure_ratio > 1) {
      fail(`${label}.closure_ratio may only increase the project threshold`, 'MISSION_POLICY_BROADENED');
    }
    next.closure_ratio = override.closure_ratio;
  }
  if (override.max_stagnant_campaigns !== undefined) {
    safeInteger(override.max_stagnant_campaigns, `${label}.max_stagnant_campaigns`);
    if (override.max_stagnant_campaigns > base.max_stagnant_campaigns) {
      fail(`${label}.max_stagnant_campaigns may only lower the project limit`, 'MISSION_POLICY_BROADENED');
    }
    next.max_stagnant_campaigns = override.max_stagnant_campaigns;
  }
  return next;
}

function resolveMissionPolicy(authoritativeGovernance, options = {}) {
  const root = plainObject(authoritativeGovernance, 'authoritative governance');
  rejectUnknown(
    root,
    new Set(['schema_version', 'governance', 'mission_convergence']),
    'authoritative governance',
  );
  if (root.schema_version !== 1) {
    fail('authoritative governance.schema_version must equal 1');
  }
  plainObject(root.governance, 'authoritative governance.governance');
  const hasSection = Object.prototype.hasOwnProperty.call(root, 'mission_convergence');
  if (!hasSection) {
    if (options.taskOverride !== undefined || options.agentOverride !== undefined) {
      fail('Mission overrides cannot enable a project whose policy is off', 'MISSION_POLICY_BROADENED');
    }
    const policy = Object.freeze({
      schema_version: MISSION_POLICY_SCHEMA_VERSION,
      enforcement_mode: 'off',
    });
    return {
      policy,
      policy_digest: sha256(canonicalJson(policy)),
    };
  }
  let policy = normalizeCompleteSection(root.mission_convergence);
  policy = tighten(policy, options.taskOverride, 'task Mission override');
  policy = tighten(policy, options.agentOverride, 'agent Mission override');
  const canonical = cloneCanonical(policy);
  return {
    policy: Object.freeze(canonical),
    policy_digest: sha256(canonicalJson(canonical)),
  };
}

function validateEffectiveMissionPolicy(rawPolicy) {
  const normalized = normalizeCompleteSection(rawPolicy);
  if (canonicalJson(rawPolicy) !== canonicalJson(normalized)) {
    fail('effective Mission policy must be canonical');
  }
  return Object.freeze(cloneCanonical(normalized));
}

function deriveMissionAdoptionKey(binding) {
  const value = plainObject(binding, 'Mission lineage binding');
  const fields = new Set([
    'repo_identity',
    'intent',
    'initial_required_acceptance_hashes',
  ]);
  rejectUnknown(value, fields, 'Mission lineage binding');
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail(`Mission lineage binding.${field} is required`);
    }
  }
  if (typeof value.repo_identity !== 'string' || value.repo_identity.length === 0) {
    fail('Mission lineage binding.repo_identity must be non-empty');
  }
  plainObject(value.intent, 'Mission lineage binding.intent');
  if (!Array.isArray(value.initial_required_acceptance_hashes)
      || value.initial_required_acceptance_hashes.length === 0) {
    fail('Mission lineage binding.initial_required_acceptance_hashes must be non-empty');
  }
  const hashes = value.initial_required_acceptance_hashes.map((digest, index) => {
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      fail(`Mission lineage binding.initial_required_acceptance_hashes[${index}] must be a SHA-256 digest`);
    }
    return digest;
  }).sort();
  if (new Set(hashes).size !== hashes.length) {
    fail('Mission lineage binding.initial_required_acceptance_hashes must not contain duplicates');
  }
  return sha256(canonicalJson(cloneCanonical({
    repo_identity: value.repo_identity,
    intent: value.intent,
    initial_required_acceptance_hashes: hashes,
  })));
}

function deriveMissionLineageId(binding) {
  return `lineage-v1-${deriveMissionAdoptionKey(binding)}`;
}

function resolveMissionLineageAdoption(candidateBinding, options = {}) {
  const adoptionKey = deriveMissionAdoptionKey(candidateBinding);
  const lineageId = `lineage-v1-${adoptionKey}`;
  const existing = options.unresolvedMission;
  if (!existing) {
    return { adoption_key: adoptionKey, mission_lineage_id: lineageId, adopted: false };
  }
  const value = plainObject(existing, 'unresolved Mission');
  if (value.repo_identity !== candidateBinding.repo_identity) {
    fail('unresolved Mission belongs to a different canonical repository', 'MISSION_REPO_MISMATCH');
  }
  if (value.adoption_key === adoptionKey && value.mission_lineage_id === lineageId) {
    return { adoption_key: adoptionKey, mission_lineage_id: lineageId, adopted: true };
  }
  fail(
    'one unresolved Mission already exists for this repository; semantic rewording cannot reset lineage',
    'MISSION_LINEAGE_RESET',
  );
}

module.exports = {
  MISSION_POLICY_FIELDS,
  MISSION_POLICY_SCHEMA_VERSION,
  MissionPolicyError,
  deriveMissionAdoptionKey,
  deriveMissionLineageId,
  resolveMissionLineageAdoption,
  resolveMissionPolicy,
  validateEffectiveMissionPolicy,
};
