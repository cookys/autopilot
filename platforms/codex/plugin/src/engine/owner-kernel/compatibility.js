'use strict';

// The compatibility table is intentionally pure. It translates legacy entry
// syntax into an advisory topology preference; it never mints events or grants
// execution, decision, or acceptance authority.

const { canonicalJson, cloneCanonical, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const { ASSURANCE_PROFILES } = require('./policy');

const LEVEL_TRANSLATION_SCHEMA_VERSION = 1;
const LEGACY_LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);

const LEVEL_TOPOLOGIES = Object.freeze({
  l3: Object.freeze({
    entry: 'l3',
    execution: 'inline',
    foreman: false,
    implementation: 'session',
    verification_authoring: 'depth0',
    hetero_implementation: false,
    hetero_verification_authoring: false,
  }),
  l4: Object.freeze({
    entry: 'l4',
    execution: 'foreman',
    foreman: true,
    implementation: 'foreman',
    verification_authoring: 'depth0',
    hetero_implementation: false,
    hetero_verification_authoring: false,
  }),
  l5: Object.freeze({
    entry: 'l5',
    execution: 'foreman',
    foreman: true,
    implementation: 'hetero',
    verification_authoring: 'depth0',
    hetero_implementation: true,
    hetero_verification_authoring: false,
  }),
  l6: Object.freeze({
    entry: 'l6',
    execution: 'foreman',
    foreman: true,
    implementation: 'hetero',
    verification_authoring: 'hetero',
    hetero_implementation: true,
    hetero_verification_authoring: true,
  }),
});

function compatibilityError(message, code = 'INVALID_LEVEL_TRANSLATION') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    compatibilityError(`${label} must be a plain data object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) compatibilityError(`${label} has unsupported key "${key}"`);
  }
}

function assertToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    compatibilityError(`${label} must be a bounded protocol token`);
  }
  return value;
}

function normalizeRedLines(value, label) {
  if (!Array.isArray(value)) compatibilityError(`${label} must be an array`);
  const seen = new Set();
  const normalized = value.map((entry, index) => {
    const token = assertToken(entry, `${label}[${index}]`);
    if (seen.has(token)) compatibilityError(`${label} must not contain duplicate values`);
    seen.add(token);
    return token;
  });
  return normalized.sort();
}

function normalizeFlags(value = {}, level) {
  const flags = assertPlainObject(value, 'translation flags');
  assertOnlyKeys(flags, new Set(['expand', 'solo', 'red_line_additions']), 'translation flags');
  const expand = flags.expand === undefined ? false : flags.expand;
  const solo = flags.solo === undefined ? false : flags.solo;
  if (typeof expand !== 'boolean') compatibilityError('translation flags.expand must be boolean');
  if (typeof solo !== 'boolean') compatibilityError('translation flags.solo must be boolean');
  if (solo && level === 'l3') {
    compatibilityError('translation flags.solo is not valid for l3', 'LEVEL_FLAG_INVALID');
  }
  return {
    expand,
    solo,
    red_line_additions: normalizeRedLines(
      flags.red_line_additions === undefined ? [] : flags.red_line_additions,
      'translation flags.red_line_additions',
    ),
  };
}

function normalizePolicy(policy, policyHash) {
  const value = assertPlainObject(policy, 'resolved governance policy');
  if (typeof value.mode !== 'string' || !['owner-led', 'milestone-led'].includes(value.mode)) {
    compatibilityError('resolved governance policy.mode is invalid');
  }
  if (typeof value.project_default_mode !== 'string'
    || !['owner-led', 'milestone-led'].includes(value.project_default_mode)) {
    compatibilityError('resolved governance policy.project_default_mode is invalid');
  }
  if (typeof policyHash !== 'string' || !/^[0-9a-f]{64}$/i.test(policyHash)) {
    compatibilityError('resolved governance policy hash must be a SHA-256 digest');
  }
  if (sha256(canonicalJson(value)) !== policyHash.toLowerCase()) {
    compatibilityError('resolved governance policy hash does not match the canonical policy');
  }
  const assuranceProfile = value.assurance_profile === undefined ? 'standard' : value.assurance_profile;
  if (!ASSURANCE_PROFILES.has(assuranceProfile)) {
    compatibilityError('resolved governance policy.assurance_profile is invalid');
  }
  return {
    mode: value.mode,
    project_default_mode: value.project_default_mode,
    red_lines: normalizeRedLines(value.red_lines === undefined ? [] : value.red_lines, 'resolved governance policy.red_lines'),
    assurance_profile: assuranceProfile,
    policy_hash: policyHash.toLowerCase(),
  };
}

function topologyFor(level, solo) {
  if (!solo) return cloneCanonical(LEVEL_TOPOLOGIES[level]);
  return {
    ...cloneCanonical(LEVEL_TOPOLOGIES.l3),
    entry: level,
    degraded_from: level,
  };
}

function translateLegacyLevel({ level, flags = {}, policy, policyHash }) {
  if (!LEGACY_LEVELS.has(level)) {
    compatibilityError(`legacy level must be one of ${Array.from(LEGACY_LEVELS).join(', ')}`, 'LEVEL_UNKNOWN');
  }
  const normalizedFlags = normalizeFlags(flags, level);
  const normalizedPolicy = normalizePolicy(policy, policyHash);
  const effectiveRedLines = [...new Set([
    ...normalizedPolicy.red_lines,
    ...normalizedFlags.red_line_additions,
  ])].sort();
  const source = {
    schema_version: LEVEL_TRANSLATION_SCHEMA_VERSION,
    kind: 'legacy-level',
    legacy_level: level,
    overrides: normalizedFlags,
  };
  const target = {
    schema_version: LEVEL_TRANSLATION_SCHEMA_VERSION,
    topology: topologyFor(level, normalizedFlags.solo),
    scope: normalizedFlags.expand ? 'expand' : 'hold',
    governance_mode: normalizedPolicy.mode,
    project_default_mode: normalizedPolicy.project_default_mode,
    policy_hash: normalizedPolicy.policy_hash,
    red_lines: effectiveRedLines,
    red_lines_hash: sha256(canonicalJson(effectiveRedLines)),
    assurance_profile: normalizedPolicy.assurance_profile,
    owner_kernel_authority: 'none',
    shadow_telemetry: level === 'l3' ? 'eligible' : 'not_available',
    acceptance: 'not_available',
  };
  return cloneCanonical({
    schema_version: LEVEL_TRANSLATION_SCHEMA_VERSION,
    source,
    target,
    source_hash: sha256(canonicalJson(source)),
    target_hash: sha256(canonicalJson(target)),
  });
}

function assertTranslation(translation) {
  const value = assertPlainObject(translation, 'level translation');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'source',
    'target',
    'source_hash',
    'target_hash',
  ]), 'level translation');
  if (value.schema_version !== LEVEL_TRANSLATION_SCHEMA_VERSION) {
    compatibilityError(`level translation.schema_version must equal ${LEVEL_TRANSLATION_SCHEMA_VERSION}`);
  }
  assertPlainObject(value.source, 'level translation.source');
  assertPlainObject(value.target, 'level translation.target');
  if (sha256(canonicalJson(value.source)) !== value.source_hash
    || sha256(canonicalJson(value.target)) !== value.target_hash) {
    compatibilityError('level translation hashes do not match canonical source and target');
  }
  return cloneCanonical(value);
}

function translationId(runId, invocationId, sourceHash) {
  assertToken(runId, 'translation run_id');
  assertToken(invocationId, 'translation invocation_id');
  if (typeof sourceHash !== 'string' || !/^[0-9a-f]{64}$/i.test(sourceHash)) {
    compatibilityError('translation source hash must be a SHA-256 digest');
  }
  return `translation-${sha256(canonicalJson({
    run_id: runId,
    invocation_id: invocationId,
    source_hash: sourceHash.toLowerCase(),
  }))}`;
}

function createShadowTranslationEnvelope({ runId, invocationId, translation }) {
  const normalized = assertTranslation(translation);
  const level = normalized.source.legacy_level;
  if (!LEGACY_LEVELS.has(level)) compatibilityError('level translation source legacy_level is invalid');
  const overrides = normalizeFlags(normalized.source.overrides, level);
  return cloneCanonical({
    schema_version: LEVEL_TRANSLATION_SCHEMA_VERSION,
    run_id: assertToken(runId, 'translation run_id'),
    invocation_id: assertToken(invocationId, 'translation invocation_id'),
    translation_id: translationId(runId, invocationId, normalized.source_hash),
    level,
    flags: overrides,
    policy_hash: normalized.target.policy_hash,
    source: normalized.source_hash,
    target: normalized.target_hash,
    source_detail: normalized.source,
    target_detail: normalized.target,
  });
}

function verifyShadowTranslationEnvelope(envelope, { runId, policy, policyHash }) {
  const value = assertPlainObject(envelope, 'shadow translation envelope');
  assertOnlyKeys(value, new Set([
    'schema_version',
    'run_id',
    'invocation_id',
    'translation_id',
    'level',
    'flags',
    'policy_hash',
    'source',
    'target',
    'source_detail',
    'target_detail',
  ]), 'shadow translation envelope');
  if (value.schema_version !== LEVEL_TRANSLATION_SCHEMA_VERSION) {
    compatibilityError(`shadow translation envelope.schema_version must equal ${LEVEL_TRANSLATION_SCHEMA_VERSION}`);
  }
  if (value.run_id !== runId) compatibilityError('shadow translation envelope is not bound to the current run');
  const invocationId = assertToken(value.invocation_id, 'shadow translation envelope.invocation_id');
  const expected = translateLegacyLevel({
    level: value.level,
    flags: value.flags,
    policy,
    policyHash,
  });
  const expectedId = translationId(runId, invocationId, expected.source_hash);
  if (value.translation_id !== expectedId
    || value.policy_hash !== expected.target.policy_hash
    || value.source !== expected.source_hash
    || value.target !== expected.target_hash
    || canonicalJson(value.source_detail) !== canonicalJson(expected.source)
    || canonicalJson(value.target_detail) !== canonicalJson(expected.target)) {
    compatibilityError('shadow translation envelope does not match the frozen compatibility mapping');
  }
  return cloneCanonical({
    translation_id: expectedId,
    invocation_id: invocationId,
    source: expected.source_hash,
    target: expected.target_hash,
    source_detail: expected.source,
    target_detail: expected.target,
  });
}

function deriveTranslationStatus(events) {
  if (!Array.isArray(events)) compatibilityError('translation status events must be an array');
  const entries = events
    .filter((event) => event && event.type === 'translation_used' && event.payload)
    .sort((left, right) => left.sequence - right.sequence);
  if (entries.length === 0) return { count: 0, latest: null };
  const event = entries[entries.length - 1];
  const payload = event.payload;
  const hasDetails = Object.prototype.hasOwnProperty.call(payload, 'source_detail')
    && Object.prototype.hasOwnProperty.call(payload, 'target_detail');
  return cloneCanonical({
    count: entries.length,
    latest: {
      translation_id: payload.translation_id,
      source_hash: payload.source,
      target_hash: payload.target,
      ...(hasDetails ? {
        source: payload.source_detail,
        target: payload.target_detail,
      } : {}),
      event_hash: event.event_hash,
      sequence: event.sequence,
      witness_receipt: event.witness,
    },
  });
}

module.exports = {
  ASSURANCE_PROFILES,
  LEGACY_LEVELS,
  LEVEL_TOPOLOGIES,
  LEVEL_TRANSLATION_SCHEMA_VERSION,
  createShadowTranslationEnvelope,
  deriveTranslationStatus,
  normalizeRedLines,
  translateLegacyLevel,
  verifyShadowTranslationEnvelope,
};
