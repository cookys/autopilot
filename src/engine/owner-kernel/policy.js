'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { normalizeActionCatalog } = require('./actions');
const { OwnerKernelError } = require('./errors');

const GOVERNANCE_SCHEMA_VERSION = 1;
const SUPPORTED_MODES = new Set(['owner-led', 'milestone-led']);
const ACTION_CLASSES = new Set(['read_only', 'reversible', 'external', 'irreversible']);

function fail(message) {
  throw new OwnerKernelError(message, 'INVALID_GOVERNANCE_POLICY');
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function requireProtocolToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    fail(`${label} must be a bounded protocol token`);
  }
  return value;
}

function normalizeFamily(value, label) {
  const family = requireNonEmptyString(value, label).trim().toLowerCase();
  if (!/^[a-z0-9._:-]{1,128}$/.test(family)) {
    fail(`${label} must be a canonical family identifier`);
  }
  return family;
}

function requireIsoTimestamp(value, label) {
  requireNonEmptyString(value, label);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !/Z$/.test(value)) {
    fail(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return parsed.toISOString();
}

function requirePositiveInteger(value, label, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) {
    fail(`${label} must be an integer >= ${minimum}`);
  }
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail(`${label} has unsupported key "${key}"`);
    }
  }
}

function normalizeAttestation(raw, label) {
  const value = requireObject(raw, label);
  rejectUnknownKeys(value, new Set(['issuer', 'uri', 'sha256', 'issued_at', 'expires_at']), label);
  const normalized = {
    issuer: requireNonEmptyString(value.issuer, `${label}.issuer`),
    uri: requireNonEmptyString(value.uri, `${label}.uri`),
    sha256: requireNonEmptyString(value.sha256, `${label}.sha256`).toLowerCase(),
    issued_at: requireIsoTimestamp(value.issued_at, `${label}.issued_at`),
    expires_at: requireIsoTimestamp(value.expires_at, `${label}.expires_at`),
  };
  if (!isSha256(normalized.sha256)) {
    fail(`${label}.sha256 must be a SHA-256 hex digest`);
  }
  if (new Date(normalized.expires_at).getTime() <= new Date(normalized.issued_at).getTime()) {
    fail(`${label}.expires_at must be later than issued_at`);
  }
  return normalized;
}

function normalizeRosterEntry(raw, label, role) {
  const value = requireObject(raw, label);
  rejectUnknownKeys(value, new Set([
    'identity',
    'model_alias',
    'model_version',
    'family',
    'runner',
    'role',
    'attestation',
  ]), label);
  if (value.role !== role) {
    fail(`${label}.role must equal "${role}"`);
  }
  return {
    identity: requireNonEmptyString(value.identity, `${label}.identity`),
    model_alias: requireNonEmptyString(value.model_alias, `${label}.model_alias`),
    model_version: typeof value.model_version === 'string' ? value.model_version : null,
    family: normalizeFamily(value.family, `${label}.family`),
    runner: requireNonEmptyString(value.runner, `${label}.runner`),
    role,
    attestation: normalizeAttestation(value.attestation, `${label}.attestation`),
  };
}

function normalizeRoster(raw, label, role) {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`${label} must be a non-empty array`);
  }
  const seen = new Set();
  const result = raw.map((entry, index) => {
    const normalized = normalizeRosterEntry(entry, `${label}[${index}]`, role);
    if (seen.has(normalized.identity)) {
      fail(`${label} has duplicate identity "${normalized.identity}"`);
    }
    seen.add(normalized.identity);
    return normalized;
  });
  return result.sort((left, right) => left.identity.localeCompare(right.identity));
}

function normalizeApprovalRule(raw, label, actionClass) {
  const value = requireObject(raw, label);
  rejectUnknownKeys(value, new Set(['requires_approval', 'max_uses']), label);
  if (typeof value.requires_approval !== 'boolean') {
    fail(`${label}.requires_approval must be boolean`);
  }
  const maxUses = requirePositiveInteger(value.max_uses, `${label}.max_uses`);
  if (actionClass === 'irreversible' && (!value.requires_approval || maxUses !== 1)) {
    fail('approval_policy.irreversible must require approval with max_uses 1');
  }
  return {
    requires_approval: value.requires_approval,
    max_uses: maxUses,
  };
}

function normalizeApprovalPolicy(raw) {
  const value = requireObject(raw, 'governance.approval_policy');
  rejectUnknownKeys(value, ACTION_CLASSES, 'governance.approval_policy');
  const normalized = {};
  for (const actionClass of ACTION_CLASSES) {
    if (!Object.prototype.hasOwnProperty.call(value, actionClass)) {
      fail(`governance.approval_policy.${actionClass} is required`);
    }
    normalized[actionClass] = normalizeApprovalRule(
      value[actionClass],
      `governance.approval_policy.${actionClass}`,
      actionClass,
    );
  }
  return normalized;
}

function resolveGovernancePolicy(config, options = {}) {
  const root = requireObject(config, 'governance config');
  rejectUnknownKeys(root, new Set(['schema_version', 'governance']), 'governance config');
  if (root.schema_version !== GOVERNANCE_SCHEMA_VERSION) {
    fail(`governance config.schema_version must equal ${GOVERNANCE_SCHEMA_VERSION}`);
  }

  const governance = requireObject(root.governance, 'governance');
  rejectUnknownKeys(governance, new Set([
    'default_mode',
    'owner_roster',
    'challenger_roster',
    'trusted_runner_roster',
    'approval_policy',
    'capability_ttl_seconds',
    'checkpoint_interval_closed_events',
    'max_blocked_duration_seconds',
    'action_catalog',
    'max_recover_cycles',
    'max_delegate_per_decision',
  ]), 'governance');

  const defaultMode = requireNonEmptyString(governance.default_mode, 'governance.default_mode');
  if (!SUPPORTED_MODES.has(defaultMode)) {
    fail(`governance.default_mode must be one of ${Array.from(SUPPORTED_MODES).join(', ')}`);
  }
  const hasModeOverride = options.modeOverride !== undefined && options.modeOverride !== null;
  const mode = hasModeOverride
    ? requireNonEmptyString(options.modeOverride, 'mode override')
    : defaultMode;
  if (!SUPPORTED_MODES.has(mode)) {
    fail(`mode override must be one of ${Array.from(SUPPORTED_MODES).join(', ')}`);
  }

  const maxBlockedDuration = governance.max_blocked_duration_seconds === undefined
    ? 86400
    : governance.max_blocked_duration_seconds;
  if (maxBlockedDuration !== 0) {
    requirePositiveInteger(maxBlockedDuration, 'governance.max_blocked_duration_seconds', 3600);
  }

  const resolved = {
    schema_version: GOVERNANCE_SCHEMA_VERSION,
    project_default_mode: defaultMode,
    mode,
    mode_source: hasModeOverride ? 'run-override' : 'project-default',
    owner_roster: normalizeRoster(governance.owner_roster, 'governance.owner_roster', 'owner'),
    challenger_roster: normalizeRoster(governance.challenger_roster, 'governance.challenger_roster', 'challenger'),
    trusted_runner_roster: normalizeRoster(
      governance.trusted_runner_roster,
      'governance.trusted_runner_roster',
      'trusted_runner',
    ),
    approval_policy: normalizeApprovalPolicy(governance.approval_policy),
    capability_ttl_seconds: requirePositiveInteger(
      governance.capability_ttl_seconds,
      'governance.capability_ttl_seconds',
      1,
    ),
    checkpoint_interval_closed_events: requirePositiveInteger(
      governance.checkpoint_interval_closed_events === undefined
        ? 100
        : governance.checkpoint_interval_closed_events,
      'governance.checkpoint_interval_closed_events',
      1,
    ),
    max_blocked_duration_seconds: maxBlockedDuration,
    action_catalog: normalizeActionCatalog(governance.action_catalog),
    max_recover_cycles: requirePositiveInteger(
      governance.max_recover_cycles === undefined ? 3 : governance.max_recover_cycles,
      'governance.max_recover_cycles',
      1,
    ),
    max_delegate_per_decision: requirePositiveInteger(
      governance.max_delegate_per_decision === undefined ? 3 : governance.max_delegate_per_decision,
      'governance.max_delegate_per_decision',
      1,
    ),
  };

  const normalized = cloneCanonical(resolved);
  return {
    policy: normalized,
    policy_hash: sha256(canonicalJson(normalized)),
  };
}

function freezeAcceptanceContract(raw) {
  const contract = requireObject(raw, 'acceptance contract');
  if (contract.schema_version === 2) return freezeAcceptanceContractV2(contract);
  rejectUnknownKeys(contract, new Set(['schema_version', 'contract_id', 'legs']), 'acceptance contract');
  if (contract.schema_version !== 1) {
    throw new OwnerKernelError('acceptance contract.schema_version must equal 1 or 2', 'INVALID_ACCEPTANCE_CONTRACT');
  }
  const contractId = requireNonEmptyString(contract.contract_id, 'acceptance contract.contract_id');
  if (!Array.isArray(contract.legs) || contract.legs.length === 0) {
    throw new OwnerKernelError('acceptance contract.legs must be a non-empty array', 'INVALID_ACCEPTANCE_CONTRACT');
  }
  const ids = new Set();
  const legs = contract.legs.map((rawLeg, index) => {
    const leg = requireObject(rawLeg, `acceptance contract.legs[${index}]`);
    rejectUnknownKeys(leg, new Set(['id', 'kind', 'command', 'artifact_hashes']), `acceptance contract.legs[${index}]`);
    const id = requireNonEmptyString(leg.id, `acceptance contract.legs[${index}].id`);
    if (ids.has(id)) {
      throw new OwnerKernelError(`acceptance contract has duplicate leg id "${id}"`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    ids.add(id);
    const kind = requireNonEmptyString(leg.kind, `acceptance contract.legs[${index}].kind`);
    if (kind !== 'executable' && kind !== 'non_executable') {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].kind is unsupported`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    if (kind === 'executable' && (typeof leg.command !== 'string' || leg.command.trim().length === 0)) {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].command must be non-empty for executable legs`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    if (kind === 'non_executable' && Object.prototype.hasOwnProperty.call(leg, 'command')) {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].command is not allowed for non_executable legs`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    if (!Array.isArray(leg.artifact_hashes) || leg.artifact_hashes.length === 0) {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].artifact_hashes must be non-empty`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    const artifactHashes = leg.artifact_hashes.map((hash, artifactIndex) => {
      if (!isSha256(hash)) {
        throw new OwnerKernelError(
          `acceptance contract.legs[${index}].artifact_hashes[${artifactIndex}] must be a SHA-256 hex digest`,
          'INVALID_ACCEPTANCE_CONTRACT',
        );
      }
      return hash.toLowerCase();
    });
    return {
      id,
      kind,
      ...(kind === 'executable' ? { command: leg.command } : {}),
      artifact_hashes: artifactHashes,
    };
  });
  const frozen = cloneCanonical({ schema_version: 1, contract_id: contractId, legs });
  return {
    contract: frozen,
    contract_hash: sha256(canonicalJson(frozen)),
  };
}

function freezeAcceptanceContractV2(contract) {
  rejectUnknownKeys(contract, new Set(['schema_version', 'contract_id', 'artifacts', 'legs']), 'acceptance contract');
  const contractId = requireNonEmptyString(contract.contract_id, 'acceptance contract.contract_id');
  if (!Array.isArray(contract.artifacts) || contract.artifacts.length === 0) {
    throw new OwnerKernelError('acceptance contract.artifacts must be a non-empty array', 'INVALID_ACCEPTANCE_CONTRACT');
  }
  if (!Array.isArray(contract.legs) || contract.legs.length === 0) {
    throw new OwnerKernelError('acceptance contract.legs must be a non-empty array', 'INVALID_ACCEPTANCE_CONTRACT');
  }
  const artifactIds = new Set();
  const artifacts = contract.artifacts.map((rawArtifact, index) => {
    const artifact = requireObject(rawArtifact, `acceptance contract.artifacts[${index}]`);
    rejectUnknownKeys(artifact, new Set(['id', 'target']), `acceptance contract.artifacts[${index}]`);
    const id = requireProtocolToken(artifact.id, `acceptance contract.artifacts[${index}].id`);
    if (artifactIds.has(id)) {
      throw new OwnerKernelError(`acceptance contract has duplicate artifact id "${id}"`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    if (typeof artifact.target !== 'string' || artifact.target.trim().length === 0 || /[*?]/.test(artifact.target)) {
      throw new OwnerKernelError(
        `acceptance contract.artifacts[${index}].target must be a bounded non-wildcard target`,
        'INVALID_ACCEPTANCE_CONTRACT',
      );
    }
    artifactIds.add(id);
    return { id, target: artifact.target };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const legIds = new Set();
  const legs = contract.legs.map((rawLeg, index) => {
    const leg = requireObject(rawLeg, `acceptance contract.legs[${index}]`);
    rejectUnknownKeys(leg, new Set(['id', 'kind', 'command', 'artifact_ids']), `acceptance contract.legs[${index}]`);
    const id = requireProtocolToken(leg.id, `acceptance contract.legs[${index}].id`);
    if (legIds.has(id)) {
      throw new OwnerKernelError(`acceptance contract has duplicate leg id "${id}"`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    legIds.add(id);
    const hasCommand = Object.prototype.hasOwnProperty.call(leg, 'command');
    const derivedKind = hasCommand ? 'executable' : 'non_executable';
    if (leg.kind !== derivedKind) {
      throw new OwnerKernelError(
        `acceptance contract.legs[${index}].kind must be mechanically derived from command presence`,
        'INVALID_ACCEPTANCE_CONTRACT',
      );
    }
    if (hasCommand && (typeof leg.command !== 'string' || leg.command.trim().length === 0)) {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].command must be non-empty`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    if (!Array.isArray(leg.artifact_ids) || leg.artifact_ids.length === 0) {
      throw new OwnerKernelError(`acceptance contract.legs[${index}].artifact_ids must be a non-empty array`, 'INVALID_ACCEPTANCE_CONTRACT');
    }
    const seen = new Set();
    const artifactIdsForLeg = leg.artifact_ids.map((artifactId, artifactIndex) => {
      const value = requireProtocolToken(
        artifactId,
        `acceptance contract.legs[${index}].artifact_ids[${artifactIndex}]`,
      );
      if (!artifactIds.has(value)) {
        throw new OwnerKernelError(
          `acceptance contract.legs[${index}].artifact_ids references unknown artifact "${value}"`,
          'INVALID_ACCEPTANCE_CONTRACT',
        );
      }
      if (seen.has(value)) {
        throw new OwnerKernelError(`acceptance contract.legs[${index}].artifact_ids has duplicate artifact id`, 'INVALID_ACCEPTANCE_CONTRACT');
      }
      seen.add(value);
      return value;
    }).sort();
    return {
      id,
      kind: derivedKind,
      ...(hasCommand ? { command: leg.command } : {}),
      artifact_ids: artifactIdsForLeg,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const referencedArtifactIds = new Set(legs.flatMap((leg) => leg.artifact_ids));
  for (const artifact of artifacts) {
    if (!referencedArtifactIds.has(artifact.id)) {
      throw new OwnerKernelError(
        `acceptance contract artifact "${artifact.id}" is not covered by any acceptance leg`,
        'INVALID_ACCEPTANCE_CONTRACT',
      );
    }
  }
  const frozen = cloneCanonical({ schema_version: 2, contract_id: contractId, artifacts, legs });
  return {
    contract: frozen,
    contract_hash: sha256(canonicalJson(frozen)),
  };
}

module.exports = {
  ACTION_CLASSES,
  GOVERNANCE_SCHEMA_VERSION,
  SUPPORTED_MODES,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
};
