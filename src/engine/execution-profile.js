'use strict';

const path = require('path');
const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
const {
  normalizeCapabilityEvidenceReceipt,
} = require('./capability-evidence');
const PROFILE_CATALOG = require('../../profiles/profile-catalog.json');
const {
  AUTHORITY_STATUS,
  DATA_CLASSES,
  PAYLOAD_CLASSIFICATIONS,
  ROLES,
  ROUTE_CLASSES,
  egressDecision,
  egressTuple,
  normalizeDestination,
  normalizeTaskAuthorityEnvelope,
} = require('./owner-kernel/task-authority');

const ROLE_EXECUTION_GRANT_SCHEMA_VERSION = 1;
const ROLE_ELIGIBILITY = new Set(['eligible', 'provisional', 'ineligible']);
const ROLE_ADMISSIONS = new Set(['shadow_candidate', 'shadow_provisional']);
const CAPABILITY_STATES = new Set([
  'unknown',
  'provisional',
  'qualified',
  'degraded',
  'stale',
  'revoked',
]);
const RISKS = new Set(['low', 'medium', 'high', 'protected']);
const TOPOLOGIES = new Set(['inline', 'foreman', 'heterogeneous']);
const PROVISIONAL_ROLES = new Set(['implementer', 'verification_author', 'explorer']);
const PROTECTED_ROLES = new Set(['owner', 'reviewer']);
const LIMITED_CAPABILITY_STATES = new Set(['unknown', 'provisional', 'degraded', 'stale']);
const ASSURANCE_RANK = Object.freeze({ standard: 0, conservative: 1 });
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2, protected: 3 });
const EFFECT_RISK_FLOOR = Object.freeze({ external: 'high', irreversible: 'protected' });

function grantError(message, code = 'INVALID_ROLE_GRANT') {
  throw new OwnerKernelError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    grantError(`${label} must be a plain object`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) grantError(`${label} has unsupported key "${key}"`);
  }
}

function token(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    grantError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function sha(value, label) {
  if (!isSha256(value)) grantError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function isoTimestamp(value, label) {
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    grantError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    grantError(`${label} must be one of ${Array.from(allowed).join(', ')}`);
  }
  return value;
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    grantError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function tokenList(value, label, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    grantError(`${label} must be ${options.nonEmpty ? 'a non-empty' : 'an'} array`);
  }
  const normalized = value.map((item, index) => token(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    grantError(`${label} must not contain duplicates`);
  }
  return normalized.sort();
}

function subset(requested, ceiling, label) {
  const allowed = new Set(ceiling);
  for (const value of requested) {
    if (!allowed.has(value)) {
      grantError(`${label} broadens the parent task authority`, 'GRANT_BROADENS_AUTHORITY');
    }
  }
  return requested;
}

function relativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || path.isAbsolute(value) || value.includes('\\') || /[*?\0]/.test(value)) {
    grantError(`${label} must be a bounded POSIX relative path`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    grantError(`${label} escapes the task artifact root`);
  }
  return normalized.replace(/\/+$/, '');
}

function pathList(value, label) {
  if (!Array.isArray(value)) grantError(`${label} must be an array`);
  const normalized = value.map((item, index) => relativePath(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    grantError(`${label} must not contain duplicates`);
  }
  return normalized.sort();
}

function pathSubset(requested, roots, label) {
  for (const requestedPath of requested) {
    if (!roots.some((root) => requestedPath === root || requestedPath.startsWith(`${root}/`))) {
      grantError(`${label} broadens the parent task authority`, 'GRANT_BROADENS_AUTHORITY');
    }
  }
  return requested;
}

function normalizeScope(raw, envelope) {
  const value = plainObject(raw, 'capability scope');
  onlyKeys(
    value,
    new Set(['task_classes', 'domains', 'languages', 'tool_surface']),
    'capability scope',
  );
  const parent = envelope.intent.scope;
  return {
    task_classes: subset(
      tokenList(value.task_classes, 'capability scope.task_classes', { nonEmpty: true }),
      parent.task_classes,
      'capability scope.task_classes',
    ),
    domains: subset(
      tokenList(value.domains, 'capability scope.domains', { nonEmpty: true }),
      parent.domains,
      'capability scope.domains',
    ),
    languages: subset(
      tokenList(value.languages, 'capability scope.languages', { nonEmpty: true }),
      parent.languages,
      'capability scope.languages',
    ),
    tool_surface: subset(
      tokenList(value.tool_surface, 'capability scope.tool_surface'),
      parent.allowed_tools,
      'capability scope.tool_surface',
    ),
  };
}

function normalizeModelIdentity(raw) {
  const value = plainObject(raw, 'model identity');
  onlyKeys(value, new Set([
    'identity',
    'model_alias',
    'model_version',
    'family',
    'runner',
    'runner_version',
    'harness_version',
    'effort',
    'prompt_config_hash',
    'semantic_fingerprint',
    'containment_fingerprint',
    'identity_resolved',
  ]), 'model identity');
  if (typeof value.identity_resolved !== 'boolean') {
    grantError('model identity.identity_resolved must be boolean');
  }
  return {
    identity: token(value.identity, 'model identity.identity'),
    model_alias: token(value.model_alias, 'model identity.model_alias'),
    model_version: token(value.model_version, 'model identity.model_version'),
    family: token(value.family, 'model identity.family'),
    runner: token(value.runner, 'model identity.runner'),
    runner_version: token(value.runner_version, 'model identity.runner_version'),
    harness_version: token(value.harness_version, 'model identity.harness_version'),
    effort: token(value.effort, 'model identity.effort'),
    prompt_config_hash: sha(
      value.prompt_config_hash,
      'model identity.prompt_config_hash',
    ),
    semantic_fingerprint: sha(
      value.semantic_fingerprint,
      'model identity.semantic_fingerprint',
    ),
    containment_fingerprint: sha(
      value.containment_fingerprint,
      'model identity.containment_fingerprint',
    ),
    identity_resolved: value.identity_resolved,
  };
}

function normalizeEvidence(
  raw,
  capabilityState,
  role,
  scope,
  modelIdentity,
  trustedEvidenceVerifier,
) {
  if (!Array.isArray(raw)) grantError('evidence must be an array');
  const seen = new Set();
  const expectedIdentityHash = sha256(canonicalJson(modelIdentity));
  return raw.map((entry, index) => {
    const label = `evidence[${index}]`;
    let normalized;
    try {
      normalized = normalizeCapabilityEvidenceReceipt(entry, {
        verify: trustedEvidenceVerifier,
      });
    } catch (error) {
      grantError(`${label} is not a valid lifecycle receipt: ${error.message}`);
    }
    if (seen.has(normalized.evidence_id)) grantError('evidence must not contain duplicate ids');
    seen.add(normalized.evidence_id);
    if (normalized.role !== role) grantError(`${label}.role does not match the dispatch role`);
    if (normalized.scope_hash !== sha256(canonicalJson(scope))) {
      grantError(`${label}.scope_hash does not match the capability scope`);
    }
    if (normalized.grant_identity_hash !== expectedIdentityHash) {
      grantError(`${label}.grant_identity_hash does not match the exact model identity`);
    }
    if (normalized.identity_hash !== expectedIdentityHash) {
      grantError(`${label}.identity_hash does not match the exact deployment identity`);
    }
    if (normalized.state !== capabilityState) {
      grantError(`${label}.state does not match capabilityState`);
    }
    if (Date.parse(normalized.expires_at) <= Date.parse(normalized.observed_at)) {
      grantError(`${label}.expires_at must be later than observed_at`);
    }
    return normalized;
  }).sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
}

function admissionDecision({ role, roleEligibility, capabilityState, risk, identityResolved }) {
  if (!identityResolved) return ['unresolved_identity'];
  if (roleEligibility === 'ineligible') return ['role_ineligible'];
  if (capabilityState === 'revoked') return ['capability_revoked'];
  if (roleEligibility === 'provisional'
    && (PROTECTED_ROLES.has(role) || !PROVISIONAL_ROLES.has(role))) {
    return ['provisional_role_not_admitted'];
  }
  if (roleEligibility === 'provisional' && risk !== 'low') {
    return ['provisional_scope_requires_low_risk'];
  }
  if (roleEligibility === 'provisional' && capabilityState !== 'provisional') {
    return ['provisional_admission_requires_provisional_evidence'];
  }
  if (capabilityState === 'provisional' && roleEligibility !== 'provisional') {
    return ['provisional_capability_requires_provisional_admission'];
  }
  if (PROTECTED_ROLES.has(role) && capabilityState !== 'qualified') {
    return ['protected_role_requires_qualified_capability'];
  }
  if (LIMITED_CAPABILITY_STATES.has(capabilityState)
    && (risk === 'high' || risk === 'protected')) {
    return ['limited_capability_not_admitted_for_risk'];
  }
  return [];
}

function normalizeEffects(requested, envelope, role, risk) {
  if (!Array.isArray(requested)) grantError('requested effects must be an array');
  const byId = new Map(envelope.effect_permissions.effects.map((effect) => [effect.id, effect]));
  const seen = new Set();
  const effects = requested.map((entry, index) => {
    const label = `requested effects[${index}]`;
    const value = plainObject(entry, label);
    onlyKeys(value, new Set(['id', 'destinations']), label);
    const id = token(value.id, `${label}.id`);
    if (seen.has(id)) grantError('requested effects must not contain duplicate ids');
    seen.add(id);
    const effect = byId.get(id);
    if (!effect || !effect.roles.includes(role)) {
      grantError(
        `requested effect "${id}" is not authorized for role "${role}"`,
        'GRANT_BROADENS_AUTHORITY',
      );
    }
    const riskFloor = EFFECT_RISK_FLOOR[effect.action_class];
    if (riskFloor !== undefined && RISK_RANK[risk] < RISK_RANK[riskFloor]) {
      grantError(
        `requested effect "${id}" requires risk "${riskFloor}" or stricter`,
        'EFFECT_RISK_UNDERCLASSIFIED',
      );
    }
    return {
      id,
      operation: effect.operation,
      tool_class: effect.tool_class,
      action_class: effect.action_class,
      destinations: subset(
        tokenList(value.destinations, `${label}.destinations`, { nonEmpty: true }),
        effect.destinations,
        `${label}.destinations`,
      ),
      requires_approval: effect.requires_approval,
      max_uses: effect.max_uses,
      requires_mediator: effect.requires_mediator,
      requires_challenge: effect.requires_challenge,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { effects };
}

function normalizeEgressSubset(requested, envelope) {
  if (!Array.isArray(requested)) grantError('requested egress must be an array');
  const seen = new Set();
  return requested.map((entry, index) => {
    const label = `requested egress[${index}]`;
    const value = plainObject(entry, label);
    onlyKeys(
      value,
      new Set([
        'data_class',
        'route_class',
        'destination',
        'transport',
        'payload_classification',
      ]),
      label,
    );
    if (egressDecision(envelope.data_egress_policy, value) !== 'allow') {
      grantError(`${label} is not allowed by the parent policy`, 'GRANT_BROADENS_AUTHORITY');
    }
    const normalized = {
      data_class: value.data_class,
      route_class: value.route_class,
      destination: value.destination,
      transport: value.transport,
      payload_classification: value.payload_classification,
    };
    const key = egressTuple(normalized);
    if (seen.has(key)) grantError('requested egress must not contain duplicates');
    seen.add(key);
    return normalized;
  }).sort((left, right) => egressTuple(left).localeCompare(egressTuple(right)));
}

function normalizeResourceBudget(raw, envelope) {
  const value = plainObject(raw, 'resource budget');
  const fields = [
    ['max_tokens', 1],
    ['max_wall_seconds', 1],
    ['max_tool_calls', 1],
    ['max_cost_usd_micros', 0],
  ];
  onlyKeys(value, new Set(fields.map(([field]) => field)), 'resource budget');
  const normalized = {};
  for (const [field, minimum] of fields) {
    normalized[field] = integer(value[field], `resource budget.${field}`, minimum);
    if (normalized[field] > envelope.resource_ceiling[field]) {
      grantError(
        `resource budget.${field} broadens the parent task authority`,
        'GRANT_BROADENS_AUTHORITY',
      );
    }
  }
  return normalized;
}

function normalizeContextBudget(raw, resourceBudget) {
  const value = plainObject(raw, 'context budget');
  onlyKeys(value, new Set(['max_input_tokens', 'max_control_tokens']), 'context budget');
  const maxInput = integer(value.max_input_tokens, 'context budget.max_input_tokens', 1);
  const maxControl = integer(value.max_control_tokens, 'context budget.max_control_tokens', 1);
  if (maxInput > resourceBudget.max_tokens) {
    grantError('context budget exceeds the role token budget', 'GRANT_BROADENS_AUTHORITY');
  }
  const controlCeiling = Math.min(2000, Math.floor(maxInput * 0.05));
  if (maxControl > controlCeiling) {
    grantError('context budget exceeds min(2000, 5% of max input tokens)');
  }
  return { max_input_tokens: maxInput, max_control_tokens: maxControl };
}

function resolveTopology(requested, envelope) {
  const topology = enumValue(requested, TOPOLOGIES, 'topology');
  const preference = envelope.execution_preferences.topology_preference;
  if (preference !== 'auto' && topology !== preference) {
    grantError('topology does not match the frozen task preference', 'GRANT_BROADENS_AUTHORITY');
  }
  return topology;
}

function validateGrantInputStructure(value, {
  role,
  capabilityState,
  modelIdentity,
  trustedEvidenceVerifier,
}) {
  const scope = plainObject(value.capabilityScope, 'capability scope');
  onlyKeys(
    scope,
    new Set(['task_classes', 'domains', 'languages', 'tool_surface']),
    'capability scope',
  );
  const normalizedScope = {
    task_classes: tokenList(scope.task_classes, 'capability scope.task_classes', { nonEmpty: true }),
    domains: tokenList(scope.domains, 'capability scope.domains', { nonEmpty: true }),
    languages: tokenList(scope.languages, 'capability scope.languages', { nonEmpty: true }),
    tool_surface: tokenList(scope.tool_surface, 'capability scope.tool_surface'),
  };
  const evidence = normalizeEvidence(
    value.evidence,
    capabilityState,
    role,
    normalizedScope,
    modelIdentity,
    trustedEvidenceVerifier,
  );
  tokenList(value.allowedTools, 'allowed tools');
  pathList(value.allowedArtifacts, 'allowed artifacts');
  tokenList(value.requiredEvidence, 'required evidence');

  if (!Array.isArray(value.requestedEffects)) grantError('requested effects must be an array');
  const effectIds = new Set();
  value.requestedEffects.forEach((entry, index) => {
    const label = `requested effects[${index}]`;
    const effect = plainObject(entry, label);
    onlyKeys(effect, new Set(['id', 'destinations']), label);
    const effectId = token(effect.id, `${label}.id`);
    if (effectIds.has(effectId)) grantError('requested effects must not contain duplicate ids');
    effectIds.add(effectId);
    tokenList(effect.destinations, `${label}.destinations`, { nonEmpty: true });
  });
  if (!Array.isArray(value.requestedEgress)) grantError('requested egress must be an array');
  const egressTuples = new Set();
  value.requestedEgress.forEach((entry, index) => {
    const label = `requested egress[${index}]`;
    const egress = plainObject(entry, label);
    onlyKeys(egress, new Set([
      'data_class',
      'route_class',
      'destination',
      'transport',
      'payload_classification',
    ]), label);
    enumValue(egress.data_class, DATA_CLASSES, `${label}.data_class`);
    enumValue(egress.route_class, ROUTE_CLASSES, `${label}.route_class`);
    normalizeDestination(egress.destination, `${label}.destination`);
    normalizeDestination(egress.transport, `${label}.transport`);
    enumValue(
      egress.payload_classification,
      PAYLOAD_CLASSIFICATIONS,
      `${label}.payload_classification`,
    );
    const tuple = egressTuple(egress);
    if (egressTuples.has(tuple)) grantError('requested egress must not contain duplicates');
    egressTuples.add(tuple);
  });

  const resource = plainObject(value.resourceBudget, 'resource budget');
  const resourceFields = [
    ['max_tokens', 1],
    ['max_wall_seconds', 1],
    ['max_tool_calls', 1],
    ['max_cost_usd_micros', 0],
  ];
  onlyKeys(resource, new Set(resourceFields.map(([field]) => field)), 'resource budget');
  const normalizedResource = {};
  for (const [field, minimum] of resourceFields) {
    normalizedResource[field] = integer(resource[field], `resource budget.${field}`, minimum);
  }
  normalizeContextBudget(value.contextBudget, normalizedResource);
  enumValue(value.topology, TOPOLOGIES, 'topology');
  enumValue(value.assurance, new Set(Object.keys(ASSURANCE_RANK)), 'assurance');
  const issuedAt = isoTimestamp(value.evaluationTime, 'evaluation time');
  const expiresAt = isoTimestamp(value.expiresAt, 'expires at');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    grantError('role grant expiry must be later than its evaluation time');
  }
  if (['qualified', 'provisional'].includes(capabilityState) && evidence.length === 0) {
    grantError(`${capabilityState} capability state requires scoped evidence`);
  }
  for (const record of evidence) {
    if (Date.parse(record.observed_at) > Date.parse(issuedAt)
        || Date.parse(record.issued_at) > Date.parse(issuedAt)) {
      grantError('evidence issued_at/observed_at cannot be later than the explicit evaluation time');
    }
    if (['qualified', 'provisional'].includes(capabilityState)
      && Date.parse(record.expires_at) <= Date.parse(issuedAt)) {
      grantError(`${capabilityState} evidence must be fresh at the explicit evaluation time`);
    }
    if (Date.parse(record.expires_at) < Date.parse(expiresAt)) {
      grantError('role grant cannot outlive its capability evidence');
    }
  }
}

function profileProjection(envelope, capabilityState) {
  const requested = envelope.execution_preferences.guidance_profile;
  const autonomous = requested !== 'guided' && capabilityState === 'qualified';
  const effectiveProfile = autonomous ? 'autonomous' : 'guided';
  const reason = requested === 'guided'
    ? 'project/task requested guided compatibility'
    : autonomous
      ? `qualified capability admitted for ${requested} guidance`
      : `capability state ${capabilityState} requires guided`;
  return {
    requested_profile: requested,
    effective_profile: effectiveProfile,
    profile_reason: reason,
    profile_hash: PROFILE_CATALOG.profiles[effectiveProfile].sha256,
  };
}

function resolveRoleExecutionGrantCandidate(raw, options = {}) {
  const value = plainObject(raw, 'role grant input');
  onlyKeys(value, new Set([
    'envelope',
    'dispatchId',
    'role',
    'roleEligibility',
    'capabilityState',
    'risk',
    'capabilityScope',
    'modelIdentity',
    'evidence',
    'allowedTools',
    'allowedArtifacts',
    'requestedEffects',
    'requestedEgress',
    'requiredEvidence',
    'resourceBudget',
    'contextBudget',
    'topology',
    'assurance',
    'evaluationTime',
    'expiresAt',
  ]), 'role grant input');
  const envelope = normalizeTaskAuthorityEnvelope(value.envelope);
  const role = enumValue(value.role, ROLES, 'role');
  const roleEligibility = enumValue(
    value.roleEligibility,
    ROLE_ELIGIBILITY,
    'role eligibility',
  );
  const capabilityState = enumValue(
    value.capabilityState,
    CAPABILITY_STATES,
    'capability state',
  );
  const risk = enumValue(value.risk, RISKS, 'risk');
  const modelIdentity = normalizeModelIdentity(value.modelIdentity);
  const dispatchId = token(value.dispatchId, 'dispatch id');
  validateGrantInputStructure(value, {
    role,
    capabilityState,
    modelIdentity,
    trustedEvidenceVerifier: options.evidenceVerifier,
  });
  const capabilityScope = normalizeScope(value.capabilityScope, envelope);
  const evidence = normalizeEvidence(
    value.evidence,
    capabilityState,
    role,
    capabilityScope,
    modelIdentity,
    options.evidenceVerifier,
  );
  const allowedTools = subset(
    tokenList(value.allowedTools, 'allowed tools'),
    capabilityScope.tool_surface,
    'allowed tools',
  );
  const allowedArtifacts = pathSubset(
    pathList(value.allowedArtifacts, 'allowed artifacts'),
    envelope.intent.scope.artifact_roots,
    'allowed artifacts',
  );
  const effectSubset = normalizeEffects(value.requestedEffects, envelope, role, risk);
  const egressSubset = normalizeEgressSubset(value.requestedEgress, envelope);
  const requiredEvidence = [...new Set([
    ...envelope.acceptance.required_evidence,
    ...tokenList(value.requiredEvidence, 'required evidence'),
  ])].sort();
  const resourceBudget = normalizeResourceBudget(value.resourceBudget, envelope);
  const contextBudget = normalizeContextBudget(value.contextBudget, resourceBudget);
  const topology = resolveTopology(value.topology, envelope);
  const assurance = enumValue(
    value.assurance,
    new Set(Object.keys(ASSURANCE_RANK)),
    'assurance',
  );
  const parentAssurance = envelope.execution_preferences.assurance_profile;
  if (ASSURANCE_RANK[assurance] < ASSURANCE_RANK[parentAssurance]) {
    grantError(
      'role grant assurance cannot weaken the task authority',
      'GRANT_BROADENS_AUTHORITY',
    );
  }
  const issuedAt = isoTimestamp(value.evaluationTime, 'evaluation time');
  const expiresAt = isoTimestamp(value.expiresAt, 'expires at');
  if (['qualified', 'provisional'].includes(capabilityState) && evidence.length === 0) {
    grantError(`${capabilityState} capability state requires scoped evidence`);
  }
  for (const record of evidence) {
    if (Date.parse(record.observed_at) > Date.parse(issuedAt)
        || Date.parse(record.issued_at) > Date.parse(issuedAt)) {
      grantError('evidence issued_at/observed_at cannot be later than the explicit evaluation time');
    }
    if (['qualified', 'provisional'].includes(capabilityState)
      && Date.parse(record.expires_at) <= Date.parse(issuedAt)) {
      grantError(`${capabilityState} evidence must be fresh at the explicit evaluation time`);
    }
  }
  const ttlMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (ttlMs <= 0
    || ttlMs > envelope.resource_ceiling.max_grant_ttl_seconds * 1000) {
    grantError(
      'role grant expiry exceeds the task grant TTL ceiling',
      'GRANT_BROADENS_AUTHORITY',
    );
  }
  if (evidence.some((record) => Date.parse(record.expires_at) < Date.parse(expiresAt))) {
    grantError('role grant cannot outlive its capability evidence');
  }
  const denialReasons = admissionDecision({
    role,
    roleEligibility,
    capabilityState,
    risk,
    identityResolved: modelIdentity.identity_resolved,
  });
  const protectedEffects = effectSubset.effects.filter((effect) => (
    effect.requires_approval
    || effect.requires_mediator
    || effect.requires_challenge
    || (envelope.escalation_policy.protected_effects_require_escalation
      && ['external', 'irreversible'].includes(effect.action_class))
  ));
  denialReasons.push(...protectedEffects.map(
    (effect) => `effect_requires_owner_kernel_authorization:${effect.id}`,
  ));
  if (denialReasons.length > 0) {
    const roleDenied = denialReasons.some((reason) => !reason.startsWith(
      'effect_requires_owner_kernel_authorization:',
    ));
    return cloneCanonical({
      schema_version: ROLE_EXECUTION_GRANT_SCHEMA_VERSION,
      status: 'denied',
      authority_status: AUTHORITY_STATUS,
      parent_task_authority_id: envelope.task_authority_id,
      dispatch_id: dispatchId,
      role,
      role_admission: 'denied',
      requested_profile: envelope.execution_preferences.guidance_profile,
      effective_profile: null,
      disposition: protectedEffects.length > 0
        ? 'escalate'
        : roleDenied
          ? envelope.escalation_policy.on_role_denied
          : envelope.escalation_policy.on_scope_mismatch,
      reasons: denialReasons.sort(),
    });
  }
  const profile = profileProjection(envelope, capabilityState);
  const body = {
    schema_version: ROLE_EXECUTION_GRANT_SCHEMA_VERSION,
    parent_task_authority_id: envelope.task_authority_id,
    authority_status: AUTHORITY_STATUS,
    dispatch_id: dispatchId,
    role,
    capability_scope: capabilityScope,
    role_admission: roleEligibility === 'provisional'
      ? 'shadow_provisional' : 'shadow_candidate',
    ...profile,
    model_identity: modelIdentity,
    evidence,
    risk,
    capability_state: capabilityState,
    assurance,
    topology,
    allowed_tools: allowedTools,
    allowed_artifacts: allowedArtifacts,
    effect_subset: effectSubset,
    egress_subset: egressSubset,
    required_evidence: requiredEvidence,
    resource_budget: resourceBudget,
    context_budget: contextBudget,
    authority_projection: {
      red_lines_hash: sha256(canonicalJson(envelope.red_lines)),
      acceptance_hash: sha256(canonicalJson(envelope.acceptance)),
      egress_policy_hash: sha256(canonicalJson(envelope.data_egress_policy)),
      effect_permissions_hash: sha256(canonicalJson(envelope.effect_permissions)),
    },
    revocation_binding: {
      identity_hash: sha256(canonicalJson(modelIdentity)),
      semantic_fingerprint: modelIdentity.semantic_fingerprint,
      containment_fingerprint: modelIdentity.containment_fingerprint,
    },
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
  const grant = cloneCanonical({
    ...body,
    grant_id: sha256(canonicalJson(body)),
  });
  return {
    schema_version: ROLE_EXECUTION_GRANT_SCHEMA_VERSION,
    status: 'candidate',
    authority_status: AUTHORITY_STATUS,
    trust: 'unanchored_structural_projection',
    grant,
  };
}

function resolveRoleExecutionGrant(raw, options = {}) {
  try {
    return resolveRoleExecutionGrantCandidate(raw, options);
  } catch (error) {
    if (!error || !['GRANT_BROADENS_AUTHORITY', 'EFFECT_RISK_UNDERCLASSIFIED'].includes(
      error.code,
    )) {
      throw error;
    }
    const value = plainObject(raw, 'role grant input');
    const envelope = normalizeTaskAuthorityEnvelope(value.envelope);
    return cloneCanonical({
      schema_version: ROLE_EXECUTION_GRANT_SCHEMA_VERSION,
      status: 'denied',
      authority_status: AUTHORITY_STATUS,
      parent_task_authority_id: envelope.task_authority_id,
      dispatch_id: token(value.dispatchId, 'dispatch id'),
      role: enumValue(value.role, ROLES, 'role'),
      role_admission: 'denied',
      requested_profile: envelope.execution_preferences.guidance_profile,
      effective_profile: null,
      disposition: envelope.escalation_policy.on_scope_mismatch,
      reasons: [
        error.code === 'EFFECT_RISK_UNDERCLASSIFIED'
          ? 'effect_risk_underclassified'
          : 'scope_broadens_task_authority',
      ],
    });
  }
}

function compileRoleExecutionGrant(raw, options = {}) {
  const result = resolveRoleExecutionGrant(raw, options);
  if (result.status !== 'candidate') {
    grantError(
      `role dispatch denied: ${result.reasons.join(', ')}`,
      'ROLE_ADMISSION_DENIED',
    );
  }
  return result.grant;
}

function normalizeRoleExecutionGrant(rawGrant, envelopeRaw) {
  const envelope = normalizeTaskAuthorityEnvelope(envelopeRaw);
  const grant = plainObject(rawGrant, 'role execution grant');
  onlyKeys(grant, new Set([
    'schema_version',
    'grant_id',
    'parent_task_authority_id',
    'authority_status',
    'dispatch_id',
    'role',
    'capability_scope',
    'role_admission',
    'requested_profile',
    'effective_profile',
    'profile_reason',
    'profile_hash',
    'model_identity',
    'evidence',
    'risk',
    'capability_state',
    'assurance',
    'topology',
    'allowed_tools',
    'allowed_artifacts',
    'effect_subset',
    'egress_subset',
    'required_evidence',
    'resource_budget',
    'context_budget',
    'authority_projection',
    'revocation_binding',
    'issued_at',
    'expires_at',
  ]), 'role execution grant');
  const replayReceipts = new Set((grant.evidence || []).map((receipt) => canonicalJson(receipt)));
  const reconstructed = compileRoleExecutionGrant({
    envelope,
    dispatchId: grant.dispatch_id,
    role: grant.role,
    roleEligibility: grant.role_admission === 'shadow_provisional' ? 'provisional' : 'eligible',
    capabilityState: grant.capability_state,
    risk: grant.risk,
    capabilityScope: grant.capability_scope,
    modelIdentity: grant.model_identity,
    evidence: grant.evidence,
    allowedTools: grant.allowed_tools,
    allowedArtifacts: grant.allowed_artifacts,
    requestedEffects: grant.effect_subset && grant.effect_subset.effects.map((effect) => ({
      id: effect.id,
      destinations: effect.destinations,
    })),
    requestedEgress: grant.egress_subset,
    requiredEvidence: grant.required_evidence,
    resourceBudget: grant.resource_budget,
    contextBudget: grant.context_budget,
    topology: grant.topology,
    assurance: grant.assurance,
    evaluationTime: grant.issued_at,
    expiresAt: grant.expires_at,
  }, {
    evidenceVerifier: (receipt) => replayReceipts.has(canonicalJson(receipt)),
  });
  if (canonicalJson(grant) !== canonicalJson(reconstructed)) {
    grantError('role execution grant is not the canonical parent-bound projection');
  }
  return cloneCanonical(grant);
}

function verifyRoleExecutionGrant(rawGrant, envelopeRaw, trustedObservation) {
  const envelope = normalizeTaskAuthorityEnvelope(envelopeRaw);
  const grant = normalizeRoleExecutionGrant(rawGrant, envelope);
  const live = plainObject(trustedObservation, 'trusted role grant observation');
  onlyKeys(live, new Set([
    'expectedGrantId',
    'expectedTaskAuthorityId',
    'evaluationTime',
    'identityHash',
    'semanticFingerprint',
    'containmentFingerprint',
    'capabilityState',
    'criticalMiss',
    'probeRegression',
  ]), 'trusted role grant observation');
  const expectedGrantId = sha(live.expectedGrantId, 'trusted observation.expectedGrantId');
  const expectedTaskAuthorityId = sha(
    live.expectedTaskAuthorityId,
    'trusted observation.expectedTaskAuthorityId',
  );
  if (grant.grant_id !== expectedGrantId
    || grant.parent_task_authority_id !== expectedTaskAuthorityId
    || envelope.task_authority_id !== expectedTaskAuthorityId) {
    grantError(
      'role execution grant does not match the trusted ledger anchor',
      'ROLE_GRANT_ANCHOR_MISMATCH',
    );
  }
  if (Date.parse(isoTimestamp(live.evaluationTime, 'live evaluation time'))
      >= Date.parse(grant.expires_at)) {
    grantError('role execution grant is expired', 'ACTIVE_GRANT_REVOKED');
  }
  const liveCapabilityState = enumValue(
    live.capabilityState,
    CAPABILITY_STATES,
    'live capability state',
  );
  if (liveCapabilityState !== grant.capability_state) {
    grantError('role execution grant capability state drifted', 'ACTIVE_GRANT_REVOKED');
  }
  if (liveCapabilityState === 'revoked') {
    grantError('role execution grant capability is revoked', 'ACTIVE_GRANT_REVOKED');
  }
  if (live.criticalMiss !== undefined && typeof live.criticalMiss !== 'boolean') {
    grantError('trusted observation.criticalMiss must be boolean');
  }
  if (live.probeRegression !== undefined && typeof live.probeRegression !== 'boolean') {
    grantError('trusted observation.probeRegression must be boolean');
  }
  if (live.criticalMiss === true) {
    grantError('role execution grant observed a Critical miss', 'ACTIVE_GRANT_REVOKED');
  }
  if (live.probeRegression === true) {
    grantError('role execution grant observed a probe regression', 'ACTIVE_GRANT_REVOKED');
  }
  if (sha(live.identityHash, 'live identity hash')
      !== grant.revocation_binding.identity_hash) {
    grantError('role execution grant exact identity drifted', 'ACTIVE_GRANT_REVOKED');
  }
  if (sha(live.semanticFingerprint, 'live semantic fingerprint')
      !== grant.revocation_binding.semantic_fingerprint) {
    grantError('role execution grant semantic identity drifted', 'ACTIVE_GRANT_REVOKED');
  }
  if (sha(live.containmentFingerprint, 'live containment fingerprint')
      !== grant.revocation_binding.containment_fingerprint) {
    grantError('role execution grant containment drifted', 'ACTIVE_GRANT_REVOKED');
  }
  return cloneCanonical(grant);
}

module.exports = {
  CAPABILITY_STATES,
  PROTECTED_ROLES,
  PROVISIONAL_ROLES,
  RISKS,
  ROLE_ADMISSIONS,
  ROLE_ELIGIBILITY,
  ROLE_EXECUTION_GRANT_SCHEMA_VERSION,
  TOPOLOGIES,
  compileRoleExecutionGrant,
  normalizeRoleExecutionGrant,
  resolveRoleExecutionGrant,
  verifyRoleExecutionGrant,
};
