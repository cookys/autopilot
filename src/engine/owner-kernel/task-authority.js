'use strict';

const path = require('path');
const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const {
  ASSURANCE_PROFILES,
  DATA_EGRESS_MODES,
  GUIDANCE_PROFILES,
  TOPOLOGY_PREFERENCES,
} = require('./policy');
const { ROLES } = require('../roles');

const TASK_AUTHORITY_SCHEMA_VERSION = 1;
const AUTHORITY_STATUS = 'shadow';
const ACTION_CLASS_ORDER = Object.freeze([
  'read_only',
  'reversible',
  'external',
  'irreversible',
]);
const DATA_CLASSES = new Set([
  'task_prompt',
  'source',
  'diff',
  'artifact',
  'test_log',
  'telemetry_metadata',
  'benchmark_metadata',
]);
const ROUTE_CLASSES = new Set([
  'runner',
  'reviewer',
  'tool',
  'telemetry',
  'benchmark_refresh',
]);
const EGRESS_EFFECTS = new Set(['allow', 'deny']);
const PAYLOAD_CLASSIFICATIONS = new Set([
  'public',
  'metadata',
  'task',
  'source',
  'sensitive',
]);
const PAYLOAD_CLASSIFICATION_RANK = Object.freeze({
  public: 0,
  metadata: 1,
  task: 2,
  source: 3,
  sensitive: 4,
});
const EGRESS_MODE_RANK = Object.freeze({
  'local-only': 0,
  allowlisted: 1,
  online: 2,
});
const REQUIRED_RECEIPT_FIELDS = Object.freeze([
  'authority_status',
  'decisions_outside_user_intent',
  'effective_profile',
  'evidence',
]);

function authorityError(message, code = 'INVALID_TASK_AUTHORITY') {
  throw new OwnerKernelError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    authorityError(`${label} must be a plain object`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) authorityError(`${label} has unsupported key "${key}"`);
  }
}

function nonEmptyString(value, label, max = 4096) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    authorityError(`${label} must be a non-empty string no longer than ${max} characters`);
  }
  return value;
}

function token(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    authorityError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function sha(value, label) {
  if (!isSha256(value)) authorityError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    authorityError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    authorityError(`${label} must be one of ${Array.from(allowed).join(', ')}`);
  }
  return value;
}

function tokenList(value, label, options = {}) {
  if (!Array.isArray(value) || (options.nonEmpty && value.length === 0)) {
    authorityError(`${label} must be ${options.nonEmpty ? 'a non-empty' : 'an'} array`);
  }
  const seen = new Set();
  const normalized = value.map((item, index) => {
    const result = token(item, `${label}[${index}]`);
    if (seen.has(result)) authorityError(`${label} must not contain duplicates`);
    seen.add(result);
    return result;
  });
  return normalized.sort();
}

function relativePath(value, label) {
  nonEmptyString(value, label, 512);
  if (path.isAbsolute(value) || value.includes('\\') || /[*?\0]/.test(value)) {
    authorityError(`${label} must be a bounded POSIX relative path without wildcards`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    authorityError(`${label} escapes the task artifact root`);
  }
  return normalized.replace(/\/+$/, '');
}

function pathList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    authorityError(`${label} must be a non-empty array`);
  }
  const normalized = value.map((item, index) => relativePath(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    authorityError(`${label} must not contain duplicates`);
  }
  return normalized.sort();
}

function normalizeIntent(raw) {
  const value = plainObject(raw, 'task intent');
  onlyKeys(value, new Set(['objective', 'requirements_hash', 'scope']), 'task intent');
  const scope = plainObject(value.scope, 'task intent.scope');
  onlyKeys(
    scope,
    new Set(['task_classes', 'domains', 'languages', 'allowed_tools', 'artifact_roots']),
    'task intent.scope',
  );
  return {
    objective: nonEmptyString(value.objective, 'task intent.objective', 16384),
    requirements_hash: sha(value.requirements_hash, 'task intent.requirements_hash'),
    scope: {
      task_classes: tokenList(scope.task_classes, 'task intent.scope.task_classes', { nonEmpty: true }),
      domains: tokenList(scope.domains, 'task intent.scope.domains', { nonEmpty: true }),
      languages: tokenList(scope.languages, 'task intent.scope.languages', { nonEmpty: true }),
      allowed_tools: tokenList(scope.allowed_tools, 'task intent.scope.allowed_tools'),
      artifact_roots: pathList(scope.artifact_roots, 'task intent.scope.artifact_roots'),
    },
  };
}

function normalizeAcceptance(raw) {
  const value = plainObject(raw, 'task acceptance');
  onlyKeys(value, new Set(['contract_hash', 'criteria_hash', 'required_evidence']), 'task acceptance');
  return {
    contract_hash: sha(value.contract_hash, 'task acceptance.contract_hash'),
    criteria_hash: sha(value.criteria_hash, 'task acceptance.criteria_hash'),
    required_evidence: tokenList(
      value.required_evidence,
      'task acceptance.required_evidence',
      { nonEmpty: true },
    ),
  };
}

function normalizeApprovalProjection(raw, actionClass, label) {
  const value = plainObject(raw, label);
  onlyKeys(value, new Set(['requires_approval', 'max_uses']), label);
  if (typeof value.requires_approval !== 'boolean') {
    authorityError(`${label}.requires_approval must be boolean`);
  }
  const maxUses = integer(value.max_uses, `${label}.max_uses`, 1);
  if (actionClass === 'irreversible' && (!value.requires_approval || maxUses !== 1)) {
    authorityError(`${label} cannot weaken the irreversible approval boundary`);
  }
  return {
    requires_approval: value.requires_approval,
    max_uses: maxUses,
  };
}

function normalizeEffectPermissions(raw, policy) {
  const value = plainObject(raw, 'effect permissions');
  onlyKeys(value, new Set(['effects']), 'effect permissions');
  if (!Array.isArray(value.effects)) authorityError('effect permissions.effects must be an array');
  const catalog = new Map(policy.policy.action_catalog.map((entry) => [entry.id, entry]));
  const seen = new Set();
  const effects = value.effects.map((entry, index) => {
    const label = `effect permissions.effects[${index}]`;
    const effect = plainObject(entry, label);
    onlyKeys(effect, new Set(['id', 'roles', 'destinations']), label);
    const id = token(effect.id, `${label}.id`);
    if (seen.has(id)) authorityError('effect permissions.effects has duplicate id');
    seen.add(id);
    const catalogEntry = catalog.get(id);
    if (!catalogEntry) {
      authorityError(
        `${label}.id is not present in the frozen action catalog`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
    const roles = tokenList(effect.roles, `${label}.roles`, { nonEmpty: true });
    for (const role of roles) enumValue(role, ROLES, `${label}.roles`);
    const blockedBy = catalogEntry.blocked_by_red_lines || [];
    const activeBlock = blockedBy.find((redLine) => (
      (policy.policy.red_lines || []).includes(redLine)
    ));
    if (activeBlock !== undefined) {
      authorityError(
        `${label}.id is blocked by frozen red line "${activeBlock}"`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
    const approval = normalizeApprovalProjection(
      policy.policy.approval_policy[catalogEntry.action_class],
      catalogEntry.action_class,
      `resolved governance policy.approval_policy.${catalogEntry.action_class}`,
    );
    return {
      id,
      operation: catalogEntry.operation,
      tool_class: catalogEntry.tool_class,
      action_class: catalogEntry.action_class,
      roles,
      destinations: tokenList(effect.destinations, `${label}.destinations`, { nonEmpty: true }),
      requires_approval: approval.requires_approval,
      max_uses: approval.max_uses,
      requires_mediator: catalogEntry.requires_mediator,
      requires_challenge: catalogEntry.requires_challenge,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { effects };
}

function normalizeFrozenEffectPermissions(raw) {
  const value = plainObject(raw, 'effect permissions');
  onlyKeys(value, new Set(['effects']), 'effect permissions');
  if (!Array.isArray(value.effects)) authorityError('effect permissions.effects must be an array');
  const seen = new Set();
  const effects = value.effects.map((entry, index) => {
    const label = `effect permissions.effects[${index}]`;
    const effect = plainObject(entry, label);
    onlyKeys(effect, new Set([
      'id',
      'operation',
      'tool_class',
      'action_class',
      'roles',
      'destinations',
      'requires_approval',
      'max_uses',
      'requires_mediator',
      'requires_challenge',
    ]), label);
    const id = token(effect.id, `${label}.id`);
    if (seen.has(id)) authorityError('effect permissions.effects has duplicate id');
    seen.add(id);
    const roles = tokenList(effect.roles, `${label}.roles`, { nonEmpty: true });
    for (const role of roles) enumValue(role, ROLES, `${label}.roles`);
    for (const field of [
      'requires_approval',
      'requires_mediator',
      'requires_challenge',
    ]) {
      if (typeof effect[field] !== 'boolean') authorityError(`${label}.${field} must be boolean`);
    }
    const actionClass = enumValue(
      effect.action_class,
      new Set(ACTION_CLASS_ORDER),
      `${label}.action_class`,
    );
    const approval = normalizeApprovalProjection({
      requires_approval: effect.requires_approval,
      max_uses: effect.max_uses,
    }, actionClass, label);
    return {
      id,
      operation: token(effect.operation, `${label}.operation`),
      tool_class: token(effect.tool_class, `${label}.tool_class`),
      action_class: actionClass,
      roles,
      destinations: tokenList(effect.destinations, `${label}.destinations`, { nonEmpty: true }),
      requires_approval: approval.requires_approval,
      max_uses: approval.max_uses,
      requires_mediator: effect.requires_mediator,
      requires_challenge: effect.requires_challenge,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return { effects };
}

function normalizeResourceCeiling(raw) {
  const value = plainObject(raw, 'resource ceiling');
  onlyKeys(value, new Set([
    'max_tokens',
    'max_wall_seconds',
    'max_tool_calls',
    'max_cost_usd_micros',
    'max_grant_ttl_seconds',
  ]), 'resource ceiling');
  return {
    max_tokens: integer(value.max_tokens, 'resource ceiling.max_tokens', 1),
    max_wall_seconds: integer(value.max_wall_seconds, 'resource ceiling.max_wall_seconds', 1),
    max_tool_calls: integer(value.max_tool_calls, 'resource ceiling.max_tool_calls', 1),
    max_cost_usd_micros: integer(
      value.max_cost_usd_micros,
      'resource ceiling.max_cost_usd_micros',
    ),
    max_grant_ttl_seconds: integer(
      value.max_grant_ttl_seconds,
      'resource ceiling.max_grant_ttl_seconds',
      1,
    ),
  };
}

function normalizeDestination(value, label) {
  nonEmptyString(value, label, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)) {
    authorityError(`${label} must be an exact non-secret destination token`);
  }
  return value;
}

function normalizeEgressRules(raw, mode) {
  if (!Array.isArray(raw)) authorityError('data egress rules must be an array');
  const seen = new Set();
  return raw.map((entry, index) => {
    const label = `data egress rules[${index}]`;
    const value = plainObject(entry, label);
    onlyKeys(
      value,
      new Set([
        'data_class',
        'route_class',
        'destination',
        'transport',
        'effect',
        'max_payload_classification',
      ]),
      label,
    );
    const rule = {
      data_class: enumValue(value.data_class, DATA_CLASSES, `${label}.data_class`),
      route_class: enumValue(value.route_class, ROUTE_CLASSES, `${label}.route_class`),
      destination: normalizeDestination(value.destination, `${label}.destination`),
      transport: normalizeDestination(value.transport, `${label}.transport`),
      effect: enumValue(value.effect, EGRESS_EFFECTS, `${label}.effect`),
      max_payload_classification: enumValue(
        value.max_payload_classification,
        PAYLOAD_CLASSIFICATIONS,
        `${label}.max_payload_classification`,
      ),
    };
    if (mode === 'local-only' && rule.effect === 'allow'
      && (!rule.destination.startsWith('local:')
        || !rule.transport.startsWith('local:'))) {
      authorityError('local-only egress may allow only exact local destinations and transports');
    }
    const key = canonicalJson(rule);
    if (seen.has(key)) authorityError('data egress rules must not contain duplicates');
    seen.add(key);
    return rule;
  }).sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function normalizeEscalationPolicy(raw) {
  const value = plainObject(raw, 'escalation policy');
  onlyKeys(
    value,
    new Set(['on_role_denied', 'on_scope_mismatch', 'protected_effects_require_escalation']),
    'escalation policy',
  );
  const dispositions = new Set(['block', 'escalate']);
  if (typeof value.protected_effects_require_escalation !== 'boolean') {
    authorityError('escalation policy.protected_effects_require_escalation must be boolean');
  }
  return {
    on_role_denied: enumValue(
      value.on_role_denied,
      dispositions,
      'escalation policy.on_role_denied',
    ),
    on_scope_mismatch: enumValue(
      value.on_scope_mismatch,
      dispositions,
      'escalation policy.on_scope_mismatch',
    ),
    protected_effects_require_escalation: value.protected_effects_require_escalation,
  };
}

function normalizeFinishReceiptSchema(raw) {
  const value = plainObject(raw, 'finish receipt schema');
  onlyKeys(value, new Set(['schema_id', 'required_fields']), 'finish receipt schema');
  const requiredFields = tokenList(
    value.required_fields,
    'finish receipt schema.required_fields',
    { nonEmpty: true },
  );
  for (const required of REQUIRED_RECEIPT_FIELDS) {
    if (!requiredFields.includes(required)) {
      authorityError(`finish receipt schema.required_fields must include "${required}"`);
    }
  }
  return {
    schema_id: token(value.schema_id, 'finish receipt schema.schema_id'),
    required_fields: requiredFields,
  };
}

function normalizePolicy(policy, policyHash) {
  const value = plainObject(policy, 'resolved governance policy');
  const expectedHash = sha(policyHash, 'resolved governance policy hash');
  if (sha256(canonicalJson(value)) !== expectedHash) {
    authorityError('resolved governance policy hash does not match the policy');
  }
  return {
    policy: value,
    policy_hash: expectedHash,
    guidance_profile: enumValue(
      value.guidance_profile === undefined ? 'guided' : value.guidance_profile,
      GUIDANCE_PROFILES,
      'resolved governance policy.guidance_profile',
    ),
    assurance_profile: enumValue(
      value.assurance_profile === undefined ? 'conservative' : value.assurance_profile,
      ASSURANCE_PROFILES,
      'resolved governance policy.assurance_profile',
    ),
    topology_preference: enumValue(
      value.topology_preference === undefined ? 'auto' : value.topology_preference,
      TOPOLOGY_PREFERENCES,
      'resolved governance policy.topology_preference',
    ),
    data_egress: enumValue(
      value.data_egress === undefined ? 'allowlisted' : value.data_egress,
      DATA_EGRESS_MODES,
      'resolved governance policy.data_egress',
    ),
  };
}

function normalizeExecutionPreferences(policy, rawOverrides = {}) {
  const overrides = plainObject(rawOverrides, 'task overrides');
  onlyKeys(
    overrides,
    new Set(['guidance_profile', 'assurance_profile', 'topology_preference', 'data_egress']),
    'task overrides',
  );
  const guidanceProfile = overrides.guidance_profile === undefined
    ? policy.guidance_profile
    : enumValue(
      overrides.guidance_profile,
      GUIDANCE_PROFILES,
      'task overrides.guidance_profile',
    );
  const assuranceProfile = overrides.assurance_profile === undefined
    ? policy.assurance_profile
    : enumValue(
      overrides.assurance_profile,
      ASSURANCE_PROFILES,
      'task overrides.assurance_profile',
    );
  if (policy.assurance_profile === 'conservative' && assuranceProfile !== 'conservative') {
    authorityError('task assurance override cannot weaken the project default');
  }
  const topologyPreference = overrides.topology_preference === undefined
    ? policy.topology_preference
    : enumValue(
      overrides.topology_preference,
      TOPOLOGY_PREFERENCES,
      'task overrides.topology_preference',
    );
  const dataEgress = overrides.data_egress === undefined
    ? policy.data_egress
    : enumValue(overrides.data_egress, DATA_EGRESS_MODES, 'task overrides.data_egress');
  if (EGRESS_MODE_RANK[dataEgress] > EGRESS_MODE_RANK[policy.data_egress]) {
    authorityError('task data egress override cannot broaden the project default');
  }
  return {
    guidance_profile: guidanceProfile,
    guidance_source: overrides.guidance_profile === undefined
      ? 'project-default' : 'task-override',
    assurance_profile: assuranceProfile,
    assurance_source: overrides.assurance_profile === undefined
      ? 'project-default' : 'task-override',
    topology_preference: topologyPreference,
    topology_source: overrides.topology_preference === undefined
      ? 'project-default' : 'task-override',
    data_egress: dataEgress,
    data_egress_source: overrides.data_egress === undefined
      ? 'project-default' : 'task-override',
  };
}

function normalizeFrozenExecutionPreferences(raw) {
  const value = plainObject(raw, 'task authority execution preferences');
  onlyKeys(value, new Set([
    'guidance_profile',
    'guidance_source',
    'assurance_profile',
    'assurance_source',
    'topology_preference',
    'topology_source',
    'data_egress',
    'data_egress_source',
  ]), 'task authority execution preferences');
  const sources = new Set(['project-default', 'task-override']);
  return {
    guidance_profile: enumValue(
      value.guidance_profile,
      GUIDANCE_PROFILES,
      'task authority execution preferences.guidance_profile',
    ),
    guidance_source: enumValue(
      value.guidance_source,
      sources,
      'task authority execution preferences.guidance_source',
    ),
    assurance_profile: enumValue(
      value.assurance_profile,
      ASSURANCE_PROFILES,
      'task authority execution preferences.assurance_profile',
    ),
    assurance_source: enumValue(
      value.assurance_source,
      sources,
      'task authority execution preferences.assurance_source',
    ),
    topology_preference: enumValue(
      value.topology_preference,
      TOPOLOGY_PREFERENCES,
      'task authority execution preferences.topology_preference',
    ),
    topology_source: enumValue(
      value.topology_source,
      sources,
      'task authority execution preferences.topology_source',
    ),
    data_egress: enumValue(
      value.data_egress,
      DATA_EGRESS_MODES,
      'task authority execution preferences.data_egress',
    ),
    data_egress_source: enumValue(
      value.data_egress_source,
      sources,
      'task authority execution preferences.data_egress_source',
    ),
  };
}

function taskAuthorityBody(raw) {
  const value = plainObject(raw, 'task authority input');
  onlyKeys(value, new Set([
    'taskId',
    'policy',
    'policyHash',
    'intent',
    'acceptance',
    'redLineAdditions',
    'effectPermissions',
    'resourceCeiling',
    'dataEgressRules',
    'escalationPolicy',
    'finishReceiptSchema',
    'taskOverrides',
  ]), 'task authority input');
  const policy = normalizePolicy(value.policy, value.policyHash);
  const executionPreferences = normalizeExecutionPreferences(
    policy,
    value.taskOverrides === undefined ? {} : value.taskOverrides,
  );
  const projectRedLines = tokenList(
    policy.policy.red_lines === undefined ? [] : policy.policy.red_lines,
    'resolved governance policy.red_lines',
  );
  const additions = tokenList(
    value.redLineAdditions === undefined ? [] : value.redLineAdditions,
    'task red line additions',
  );
  return {
    schema_version: TASK_AUTHORITY_SCHEMA_VERSION,
    task_id: token(value.taskId, 'task id'),
    policy_hash: policy.policy_hash,
    authority_status: AUTHORITY_STATUS,
    intent: normalizeIntent(value.intent),
    acceptance: normalizeAcceptance(value.acceptance),
    red_lines: [...new Set([...projectRedLines, ...additions])].sort(),
    effect_permissions: normalizeEffectPermissions(value.effectPermissions, policy),
    resource_ceiling: normalizeResourceCeiling(value.resourceCeiling),
    data_egress_policy: {
      mode: executionPreferences.data_egress,
      rules: normalizeEgressRules(value.dataEgressRules, executionPreferences.data_egress),
    },
    escalation_policy: normalizeEscalationPolicy(value.escalationPolicy),
    finish_receipt_schema: normalizeFinishReceiptSchema(value.finishReceiptSchema),
    execution_preferences: executionPreferences,
  };
}

function freezeTaskAuthorityEnvelope(raw) {
  const body = taskAuthorityBody(raw);
  const taskAuthorityId = sha256(canonicalJson(body));
  const envelope = cloneCanonical({
    ...body,
    task_authority_id: taskAuthorityId,
  });
  return {
    envelope,
    envelope_hash: sha256(canonicalJson(envelope)),
  };
}

function normalizeTaskAuthorityEnvelope(raw) {
  const value = plainObject(raw, 'task authority envelope');
  onlyKeys(value, new Set([
    'schema_version',
    'task_authority_id',
    'task_id',
    'policy_hash',
    'authority_status',
    'intent',
    'acceptance',
    'red_lines',
    'effect_permissions',
    'resource_ceiling',
    'data_egress_policy',
    'escalation_policy',
    'finish_receipt_schema',
    'execution_preferences',
  ]), 'task authority envelope');
  if (value.schema_version !== TASK_AUTHORITY_SCHEMA_VERSION) {
    authorityError(`task authority envelope.schema_version must equal ${TASK_AUTHORITY_SCHEMA_VERSION}`);
  }
  if (value.authority_status !== AUTHORITY_STATUS) {
    authorityError('task authority envelope cannot claim active Owner Kernel authority');
  }
  const executionPreferences = normalizeFrozenExecutionPreferences(value.execution_preferences);
  const normalizedBody = {
    schema_version: TASK_AUTHORITY_SCHEMA_VERSION,
    task_id: token(value.task_id, 'task authority envelope.task_id'),
    policy_hash: sha(value.policy_hash, 'task authority envelope.policy_hash'),
    authority_status: AUTHORITY_STATUS,
    intent: normalizeIntent(value.intent),
    acceptance: normalizeAcceptance(value.acceptance),
    red_lines: tokenList(value.red_lines, 'task authority envelope.red_lines'),
    effect_permissions: normalizeFrozenEffectPermissions(value.effect_permissions),
    resource_ceiling: normalizeResourceCeiling(value.resource_ceiling),
    data_egress_policy: {
      mode: enumValue(
        value.data_egress_policy && value.data_egress_policy.mode,
        DATA_EGRESS_MODES,
        'task authority envelope.data_egress_policy.mode',
      ),
      rules: normalizeEgressRules(
        value.data_egress_policy && value.data_egress_policy.rules,
        value.data_egress_policy && value.data_egress_policy.mode,
      ),
    },
    escalation_policy: normalizeEscalationPolicy(value.escalation_policy),
    finish_receipt_schema: normalizeFinishReceiptSchema(value.finish_receipt_schema),
    execution_preferences: executionPreferences,
  };
  if (normalizedBody.data_egress_policy.mode !== executionPreferences.data_egress) {
    authorityError('task authority egress policy does not match its frozen execution preference');
  }
  const rawBody = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'task_authority_id'),
  );
  if (canonicalJson(rawBody) !== canonicalJson(normalizedBody)) {
    authorityError('task authority envelope is not canonical');
  }
  const expectedId = sha256(canonicalJson(normalizedBody));
  if (sha(value.task_authority_id, 'task authority envelope.task_authority_id') !== expectedId) {
    authorityError('task authority envelope id does not match canonical content');
  }
  return cloneCanonical(value);
}

function verifyTaskAuthorityEnvelope(raw, anchors) {
  const envelope = normalizeTaskAuthorityEnvelope(raw);
  const trusted = plainObject(anchors, 'task authority trusted anchors');
  onlyKeys(
    trusted,
    new Set(['expectedPolicy', 'expectedPolicyHash', 'expectedTaskAuthorityId']),
    'task authority trusted anchors',
  );
  const policy = normalizePolicy(trusted.expectedPolicy, trusted.expectedPolicyHash);
  const expectedTaskAuthorityId = sha(
    trusted.expectedTaskAuthorityId,
    'task authority trusted anchors.expectedTaskAuthorityId',
  );
  if (envelope.task_authority_id !== expectedTaskAuthorityId) {
    authorityError(
      'task authority envelope does not match the trusted ledger authority id',
      'TASK_AUTHORITY_ANCHOR_MISMATCH',
    );
  }
  if (envelope.policy_hash !== policy.policy_hash) {
    authorityError(
      'task authority envelope does not match the trusted policy hash',
      'TASK_AUTHORITY_ANCHOR_MISMATCH',
    );
  }
  for (const redLine of policy.policy.red_lines || []) {
    if (!envelope.red_lines.includes(redLine)) {
      authorityError(
        `task authority envelope omits frozen red line "${redLine}"`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
  }

  const preferences = envelope.execution_preferences;
  const preferenceChecks = [
    ['guidance', 'guidance_profile', policy.guidance_profile],
    ['assurance', 'assurance_profile', policy.assurance_profile],
    ['topology', 'topology_preference', policy.topology_preference],
    ['data egress', 'data_egress', policy.data_egress],
  ];
  for (const [label, field, projectDefault] of preferenceChecks) {
    if (preferences[`${field.replace(/_profile$|_preference$/, '')}_source`] === 'project-default'
      && preferences[field] !== projectDefault) {
      authorityError(
        `task authority ${label} project-default projection drifted`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
  }
  if (policy.assurance_profile === 'conservative'
    && preferences.assurance_profile !== 'conservative') {
    authorityError(
      'task authority assurance weakens the trusted project default',
      'TASK_AUTHORITY_BROADENS_POLICY',
    );
  }
  if (EGRESS_MODE_RANK[preferences.data_egress] > EGRESS_MODE_RANK[policy.data_egress]) {
    authorityError(
      'task authority data egress broadens the trusted project default',
      'TASK_AUTHORITY_BROADENS_POLICY',
    );
  }

  const catalog = new Map(policy.policy.action_catalog.map((entry) => [entry.id, entry]));
  for (const effect of envelope.effect_permissions.effects) {
    const catalogEntry = catalog.get(effect.id);
    if (!catalogEntry) {
      authorityError(
        `task authority effect "${effect.id}" is absent from the trusted action catalog`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
    const approval = policy.policy.approval_policy[catalogEntry.action_class];
    const projection = {
      operation: catalogEntry.operation,
      tool_class: catalogEntry.tool_class,
      action_class: catalogEntry.action_class,
      requires_approval: approval.requires_approval,
      max_uses: approval.max_uses,
      requires_mediator: catalogEntry.requires_mediator,
      requires_challenge: catalogEntry.requires_challenge,
    };
    for (const [field, expected] of Object.entries(projection)) {
      if (effect[field] !== expected) {
        authorityError(
          `task authority effect "${effect.id}" drifted from trusted catalog field "${field}"`,
          'TASK_AUTHORITY_BROADENS_POLICY',
        );
      }
    }
    const activeBlock = (catalogEntry.blocked_by_red_lines || [])
      .find((redLine) => envelope.red_lines.includes(redLine));
    if (activeBlock !== undefined) {
      authorityError(
        `task authority effect "${effect.id}" is blocked by red line "${activeBlock}"`,
        'TASK_AUTHORITY_BROADENS_POLICY',
      );
    }
  }
  return envelope;
}

function egressTuple(rule) {
  return canonicalJson({
    data_class: rule.data_class,
    route_class: rule.route_class,
    destination: rule.destination,
    transport: rule.transport,
  });
}

function egressDecision(policy, request) {
  const value = plainObject(request, 'egress request');
  onlyKeys(
    value,
    new Set([
      'data_class',
      'route_class',
      'destination',
      'transport',
      'payload_classification',
    ]),
    'egress request',
  );
  const normalized = {
    data_class: enumValue(value.data_class, DATA_CLASSES, 'egress request.data_class'),
    route_class: enumValue(value.route_class, ROUTE_CLASSES, 'egress request.route_class'),
    destination: normalizeDestination(value.destination, 'egress request.destination'),
    transport: normalizeDestination(value.transport, 'egress request.transport'),
    payload_classification: enumValue(
      value.payload_classification,
      PAYLOAD_CLASSIFICATIONS,
      'egress request.payload_classification',
    ),
  };
  const tuple = egressTuple(normalized);
  const matches = policy.rules.filter((rule) => egressTuple(rule) === tuple);
  if (matches.some((rule) => rule.effect === 'deny')) return 'deny';
  if (matches.some((rule) => rule.effect === 'allow'
    && PAYLOAD_CLASSIFICATION_RANK[normalized.payload_classification]
      <= PAYLOAD_CLASSIFICATION_RANK[rule.max_payload_classification])) return 'allow';
  return 'deny';
}

function actionClassRank(value) {
  const rank = ACTION_CLASS_ORDER.indexOf(value);
  if (rank < 0) authorityError(`unknown action class "${value}"`);
  return rank;
}

module.exports = {
  ACTION_CLASS_ORDER,
  AUTHORITY_STATUS,
  DATA_CLASSES,
  EGRESS_MODE_RANK,
  PAYLOAD_CLASSIFICATIONS,
  PAYLOAD_CLASSIFICATION_RANK,
  REQUIRED_RECEIPT_FIELDS,
  ROLES,
  ROUTE_CLASSES,
  TASK_AUTHORITY_SCHEMA_VERSION,
  actionClassRank,
  egressDecision,
  egressTuple,
  freezeTaskAuthorityEnvelope,
  normalizeDestination,
  normalizeEgressRules,
  normalizeTaskAuthorityEnvelope,
  verifyTaskAuthorityEnvelope,
};
