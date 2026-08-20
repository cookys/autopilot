'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');
const { ROLES } = require('./roles');

const CAPABILITY_EVIDENCE_SCHEMA_VERSION = 1;
const SOURCES = new Set([
  'external_prior',
  'self_report',
  'ordinary_receipt',
  'internal_eval',
  'runtime_probe',
]);
const STATES = new Set([
  'unknown',
  'provisional',
  'qualified',
  'degraded',
  'stale',
  'revoked',
]);
const STATE_TIE_PRECEDENCE = Object.freeze({
  unknown: 0,
  provisional: 1,
  qualified: 2,
  stale: 3,
  degraded: 4,
  revoked: 5,
});
const REVOCATION_REASONS = new Set([
  'critical_miss',
  'semantic_identity_drift',
  'probe_regression',
]);
const SOURCE_STATE_CEILINGS = Object.freeze({
  external_prior: new Set(['unknown', 'provisional', 'degraded', 'stale', 'revoked']),
  self_report: new Set(['unknown', 'provisional', 'degraded', 'stale', 'revoked']),
  ordinary_receipt: new Set(['unknown', 'provisional', 'degraded', 'stale', 'revoked']),
  internal_eval: STATES,
  runtime_probe: new Set(['unknown', 'provisional', 'degraded', 'stale', 'revoked']),
});
const MAX_QUALIFIED_TTL_DAYS = Object.freeze({
  owner: 30,
  reviewer: 30,
  implementer: 90,
  verification_author: 60,
  explorer: 90,
});
const METHODOLOGY_KINDS = new Set([
  'role_eval',
  'owner_brain_seat',
  'va_declared_plan',
  'external_prior',
  'runtime_probe',
  'ordinary_receipt',
  'self_report',
]);
// internal_eval carries either the reviewer/owner corpus methodology (role_eval) or
// the brain-seat standing exam (owner_brain_seat, plan 2026-08-17-brain-seat-exam-suite).
const SOURCE_METHODOLOGY_KINDS = Object.freeze({
  external_prior: new Set(['external_prior']),
  self_report: new Set(['self_report']),
  ordinary_receipt: new Set(['ordinary_receipt']),
  internal_eval: new Set(['role_eval', 'owner_brain_seat', 'va_declared_plan']),
  runtime_probe: new Set(['runtime_probe']),
});
// Board 2026-08-17: brain-seat qualification is STANDING — expires_at stays a
// schema-compatible placeholder that never stales this kind and is exempt from the
// qualified-owner TTL ceiling; revocation is strike-based, never clock-based.
const BRAIN_METHODOLOGY_KIND = 'owner_brain_seat';
// Verification-author declared-plan exam (va_declared_plan,
// plan 2026-08-18-verification-author-suite-v3).
const VA_METHODOLOGY_KIND = 'va_declared_plan';
const BRAIN_CONSTRUCT_SCOPE = 'per-round-exam.long-horizon-production-audit';
const BRAIN_STOP_REASONS = new Set(['completed', 'early_end', 'malformed', 'insufficient_budget']);

class CapabilityEvidenceError extends Error {
  constructor(message, code = 'INVALID_CAPABILITY_EVIDENCE') {
    super(message);
    this.name = 'CapabilityEvidenceError';
    this.code = code;
  }
}

function evidenceError(message, code) {
  throw new CapabilityEvidenceError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || (Object.getPrototypeOf(value) !== Object.prototype
        && Object.getPrototypeOf(value) !== null)) {
    evidenceError(`${label} must be a plain object`);
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) evidenceError(`${label} has unsupported key "${key}"`);
  }
}

function requiredKeys(value, required, label) {
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length > 0) evidenceError(`${label} is missing ${missing.join(', ')}`);
}

function token(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    evidenceError(`${label} must be a bounded protocol token`);
  }
  return value;
}

// THIRD copy of the model-id charset (engine-qualify.js, qualification-case-broker.js,
// here). MUST stay byte-identical to the other two: they hand the same value to each
// other, so a narrower set anywhere kills a legitimate identity at whichever hop
// happens to check last. Vendor ids really do contain spaces, parentheses and slashes
// ("Gemini 3.7 Flash (High)", "kimi-code/k3-256k"). Shell metacharacters, quotes,
// backslash and leading/trailing whitespace stay out.
function modelId(value, label) {
  if (typeof value !== 'string'
      || !/^(?![\s])[A-Za-z0-9 ._:()/-]{1,128}(?<![\s])$/u.test(value)) {
    evidenceError(`${label} must be a bounded vendor model id`);
  }
  return value;
}

function digest(value, label) {
  if (!isSha256(value)) evidenceError(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/Z$/u.test(value) || Number.isNaN(Date.parse(value))) {
    evidenceError(`${label} must be an ISO-8601 UTC timestamp`);
  }
  return new Date(value).toISOString();
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    evidenceError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') evidenceError(`${label} must be boolean`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    evidenceError(`${label} must be one of ${Array.from(allowed).join(', ')}`);
  }
  return value;
}

function tokenList(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    evidenceError(`${label} must be ${nonEmpty ? 'a non-empty' : 'an'} array`);
  }
  const normalized = value.map((entry, index) => token(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    evidenceError(`${label} must not contain duplicates`);
  }
  return normalized.sort();
}

function normalizeScope(raw) {
  const value = plainObject(raw, 'capability scope');
  onlyKeys(
    value,
    new Set(['task_classes', 'domains', 'languages', 'tool_surface']),
    'capability scope',
  );
  requiredKeys(
    value,
    ['task_classes', 'domains', 'languages', 'tool_surface'],
    'capability scope',
  );
  return {
    task_classes: tokenList(value.task_classes, 'capability scope.task_classes', { nonEmpty: true }),
    domains: tokenList(value.domains, 'capability scope.domains', { nonEmpty: true }),
    languages: tokenList(value.languages, 'capability scope.languages', { nonEmpty: true }),
    tool_surface: tokenList(value.tool_surface, 'capability scope.tool_surface'),
  };
}

function normalizeIdentity(raw) {
  const value = plainObject(raw, 'capability identity');
  const fields = [
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
  ];
  onlyKeys(value, new Set(fields), 'capability identity');
  requiredKeys(value, fields, 'capability identity');
  return {
    identity: modelId(value.identity, 'capability identity.identity'),
    model_alias: modelId(value.model_alias, 'capability identity.model_alias'),
    model_version: token(value.model_version, 'capability identity.model_version'),
    family: token(value.family, 'capability identity.family'),
    runner: token(value.runner, 'capability identity.runner'),
    runner_version: token(value.runner_version, 'capability identity.runner_version'),
    harness_version: token(value.harness_version, 'capability identity.harness_version'),
    effort: token(value.effort, 'capability identity.effort'),
    prompt_config_hash: digest(
      value.prompt_config_hash,
      'capability identity.prompt_config_hash',
    ),
    semantic_fingerprint: digest(
      value.semantic_fingerprint,
      'capability identity.semantic_fingerprint',
    ),
    containment_fingerprint: digest(
      value.containment_fingerprint,
      'capability identity.containment_fingerprint',
    ),
    identity_resolved: boolean(
      value.identity_resolved,
      'capability identity.identity_resolved',
    ),
  };
}

function grantIdentityProjection(identity) {
  return { ...identity };
}

function normalizeThresholds(raw) {
  const value = plainObject(raw, 'evidence methodology.thresholds');
  const fields = [
    'min_trials',
    'min_known_bad_cases',
    'min_critical_cases',
    'max_false_pass_critical',
    'min_clean_cases',
    'max_clean_false_positives',
  ];
  onlyKeys(value, new Set(fields), 'evidence methodology.thresholds');
  requiredKeys(value, fields, 'evidence methodology.thresholds');
  return {
    min_trials: integer(value.min_trials, 'evidence methodology.thresholds.min_trials', 2),
    min_known_bad_cases: integer(
      value.min_known_bad_cases,
      'evidence methodology.thresholds.min_known_bad_cases',
      1,
    ),
    min_critical_cases: integer(
      value.min_critical_cases,
      'evidence methodology.thresholds.min_critical_cases',
      1,
    ),
    max_false_pass_critical: integer(
      value.max_false_pass_critical,
      'evidence methodology.thresholds.max_false_pass_critical',
    ),
    min_clean_cases: integer(
      value.min_clean_cases,
      'evidence methodology.thresholds.min_clean_cases',
      1,
    ),
    max_clean_false_positives: integer(
      value.max_clean_false_positives,
      'evidence methodology.thresholds.max_clean_false_positives',
    ),
  };
}

function normalizeBrainThresholds(raw) {
  const label = 'evidence methodology.thresholds';
  const value = plainObject(raw, label);
  const fields = [
    'min_trials',
    'min_plants_per_trial',
    'max_clean_false_positives',
    'max_critical_misses',
    'max_pair_deltas',
    'max_asks_on_legal_controls',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  return {
    min_trials: integer(value.min_trials, `${label}.min_trials`, 2),
    min_plants_per_trial: integer(value.min_plants_per_trial, `${label}.min_plants_per_trial`, 1),
    max_clean_false_positives: integer(value.max_clean_false_positives, `${label}.max_clean_false_positives`),
    max_critical_misses: integer(value.max_critical_misses, `${label}.max_critical_misses`),
    max_pair_deltas: integer(value.max_pair_deltas, `${label}.max_pair_deltas`),
    max_asks_on_legal_controls: integer(value.max_asks_on_legal_controls, `${label}.max_asks_on_legal_controls`),
  };
}

function normalizeVaThresholds(raw) {
  const label = 'evidence methodology.thresholds';
  const value = plainObject(raw, label);
  const fields = [
    'min_trials',
    'max_declared_mismatches',
    'max_missed_defects',
    'max_robustness_violations',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  return {
    min_trials: integer(value.min_trials, `${label}.min_trials`, 2),
    max_declared_mismatches: integer(value.max_declared_mismatches, `${label}.max_declared_mismatches`),
    max_missed_defects: integer(value.max_missed_defects, `${label}.max_missed_defects`),
    max_robustness_violations: integer(value.max_robustness_violations, `${label}.max_robustness_violations`),
  };
}

function normalizeMethodologyBasis(raw) {
  if (raw === null) return null;
  const value = plainObject(raw, 'evidence methodology.basis');
  const fields = [
    'cohort',
    'cohort_hash',
    'observation_hash',
    'dimensions',
    'applicability',
  ];
  onlyKeys(value, new Set(fields), 'evidence methodology.basis');
  requiredKeys(value, fields, 'evidence methodology.basis');
  return {
    cohort: token(value.cohort, 'evidence methodology.basis.cohort'),
    cohort_hash: digest(
      value.cohort_hash,
      'evidence methodology.basis.cohort_hash',
    ),
    observation_hash: digest(
      value.observation_hash,
      'evidence methodology.basis.observation_hash',
    ),
    dimensions: tokenList(
      value.dimensions,
      'evidence methodology.basis.dimensions',
      { nonEmpty: true },
    ),
    applicability: tokenList(
      value.applicability,
      'evidence methodology.basis.applicability',
    ),
  };
}

function normalizeMethodology(raw) {
  const value = plainObject(raw, 'evidence methodology');
  const fields = [
    'kind',
    'name',
    'version',
    'corpus_version',
    'corpus_manifest_hash',
    'thresholds',
    'basis',
  ];
  onlyKeys(value, new Set(fields), 'evidence methodology');
  requiredKeys(value, fields, 'evidence methodology');
  const kind = enumValue(
    value.kind,
    METHODOLOGY_KINDS,
    'evidence methodology.kind',
  );
  const methodology = {
    kind,
    name: token(value.name, 'evidence methodology.name'),
    version: token(value.version, 'evidence methodology.version'),
    corpus_version: value.corpus_version === null
      ? null : token(value.corpus_version, 'evidence methodology.corpus_version'),
    corpus_manifest_hash: value.corpus_manifest_hash === null
      ? null : digest(
        value.corpus_manifest_hash,
        'evidence methodology.corpus_manifest_hash',
      ),
    thresholds: value.thresholds === null
      ? null
      : (kind === BRAIN_METHODOLOGY_KIND
        ? normalizeBrainThresholds(value.thresholds)
        : (kind === VA_METHODOLOGY_KIND
          ? normalizeVaThresholds(value.thresholds)
          : normalizeThresholds(value.thresholds))),
    basis: normalizeMethodologyBasis(value.basis),
  };
  if (kind === 'role_eval' || kind === BRAIN_METHODOLOGY_KIND || kind === VA_METHODOLOGY_KIND) {
    if (methodology.corpus_version === null
        || methodology.corpus_manifest_hash === null
        || methodology.thresholds === null
        || methodology.basis !== null) {
      evidenceError(
        `${kind} methodology requires corpus/thresholds and forbids a generic basis`,
      );
    }
  } else if (methodology.corpus_version !== null
      || methodology.corpus_manifest_hash !== null
      || methodology.thresholds !== null
      || methodology.basis === null) {
    evidenceError(
      `${kind} methodology requires a basis and forbids reviewer corpus/threshold fields`,
    );
  }
  return methodology;
}

function normalizeArtifactOracle(raw, label) {
  const value = plainObject(raw, label);
  const fields = ['kind', 'oracle_hash', 'result_set_hash', 'independent', 'passed'];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  return {
    kind: token(value.kind, `${label}.kind`),
    oracle_hash: digest(value.oracle_hash, `${label}.oracle_hash`),
    result_set_hash: digest(value.result_set_hash, `${label}.result_set_hash`),
    independent: boolean(value.independent, `${label}.independent`),
    passed: boolean(value.passed, `${label}.passed`),
  };
}

function normalizeMutationValidation(raw, label) {
  const value = plainObject(raw, label);
  const fields = [
    'target_id',
    'original_hash',
    'mutated_hash',
    'original_verdict',
    'mutated_verdict',
    'oracle_rejected',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  const normalized = {
    target_id: token(value.target_id, `${label}.target_id`),
    original_hash: digest(value.original_hash, `${label}.original_hash`),
    mutated_hash: digest(value.mutated_hash, `${label}.mutated_hash`),
    original_verdict: enumValue(
      value.original_verdict,
      new Set(['pass', 'fail']),
      `${label}.original_verdict`,
    ),
    mutated_verdict: enumValue(
      value.mutated_verdict,
      new Set(['pass', 'fail']),
      `${label}.mutated_verdict`,
    ),
    oracle_rejected: boolean(value.oracle_rejected, `${label}.oracle_rejected`),
  };
  if (normalized.original_hash === normalized.mutated_hash) {
    evidenceError(`${label} must bind a non-noop mutation`);
  }
  if (normalized.oracle_rejected
      && (normalized.original_verdict !== 'fail' || normalized.mutated_verdict !== 'pass')) {
    evidenceError(`${label} claims rejection without fail-to-pass defect mutation behavior`);
  }
  return normalized;
}

function normalizeTrial(raw, index, methodology) {
  const label = `evidence trials[${index}]`;
  const value = plainObject(raw, label);
  const fields = [
    'trial_id',
    'observed_at',
    'known_bad_total',
    'known_bad_caught',
    'critical_total',
    'false_pass_critical',
    'clean_total',
    'clean_false_positives',
    'corpus_manifest_hash',
    'artifact_oracle',
    'mutation_validation',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  const trial = {
    trial_id: token(value.trial_id, `${label}.trial_id`),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
    known_bad_total: integer(value.known_bad_total, `${label}.known_bad_total`, 1),
    known_bad_caught: integer(value.known_bad_caught, `${label}.known_bad_caught`),
    critical_total: integer(value.critical_total, `${label}.critical_total`, 1),
    false_pass_critical: integer(
      value.false_pass_critical,
      `${label}.false_pass_critical`,
    ),
    clean_total: integer(value.clean_total, `${label}.clean_total`, 1),
    clean_false_positives: integer(
      value.clean_false_positives,
      `${label}.clean_false_positives`,
    ),
    corpus_manifest_hash: digest(
      value.corpus_manifest_hash,
      `${label}.corpus_manifest_hash`,
    ),
    artifact_oracle: normalizeArtifactOracle(
      value.artifact_oracle,
      `${label}.artifact_oracle`,
    ),
    mutation_validation: normalizeMutationValidation(
      value.mutation_validation,
      `${label}.mutation_validation`,
    ),
  };
  if (trial.known_bad_caught > trial.known_bad_total) {
    evidenceError(`${label}.known_bad_caught exceeds known_bad_total`);
  }
  if (trial.false_pass_critical > trial.critical_total) {
    evidenceError(`${label}.false_pass_critical exceeds critical_total`);
  }
  if (trial.clean_false_positives > trial.clean_total) {
    evidenceError(`${label}.clean_false_positives exceeds clean_total`);
  }
  if (trial.corpus_manifest_hash !== methodology.corpus_manifest_hash) {
    evidenceError(`${label} does not match the methodology corpus manifest`);
  }
  return trial;
}

function normalizeVaTrial(raw, index, methodology) {
  const label = `evidence trials[${index}]`;
  const value = plainObject(raw, label);
  const fields = [
    'trial_id',
    'observed_at',
    'corpus_manifest_hash',
    'cases_total',
    'cases_passed',
    'declared_mismatches',
    'missed_defects',
    'robustness_violations',
    'subjects',
    'plan_set_hash',
    'envelope_stream_hash',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  const subjects = plainObject(value.subjects, `${label}.subjects`);
  onlyKeys(subjects, new Set(['declared_accuracy', 'sensitivity', 'robustness']), `${label}.subjects`);
  requiredKeys(subjects, ['declared_accuracy', 'sensitivity', 'robustness'], `${label}.subjects`);
  const trial = {
    trial_id: token(value.trial_id, `${label}.trial_id`),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
    corpus_manifest_hash: digest(value.corpus_manifest_hash, `${label}.corpus_manifest_hash`),
    cases_total: integer(value.cases_total, `${label}.cases_total`, 1),
    cases_passed: integer(value.cases_passed, `${label}.cases_passed`),
    declared_mismatches: integer(value.declared_mismatches, `${label}.declared_mismatches`),
    missed_defects: integer(value.missed_defects, `${label}.missed_defects`),
    robustness_violations: integer(value.robustness_violations, `${label}.robustness_violations`),
    subjects: {
      declared_accuracy: boolean(subjects.declared_accuracy, `${label}.subjects.declared_accuracy`),
      sensitivity: boolean(subjects.sensitivity, `${label}.subjects.sensitivity`),
      robustness: boolean(subjects.robustness, `${label}.subjects.robustness`),
    },
    plan_set_hash: digest(value.plan_set_hash, `${label}.plan_set_hash`),
    envelope_stream_hash: digest(value.envelope_stream_hash, `${label}.envelope_stream_hash`),
  };
  if (methodology.corpus_manifest_hash !== null
      && trial.corpus_manifest_hash !== methodology.corpus_manifest_hash) {
    evidenceError(`${label} corpus hash differs from the methodology manifest`);
  }
  return trial;
}

function normalizeBrainTrial(raw, index, methodology) {
  const label = `evidence trials[${index}]`;
  const value = plainObject(raw, label);
  const fields = [
    'trial_id',
    'observed_at',
    'stop_reason',
    'construct_scope',
    'plants_total',
    'plants_caught',
    'clean_false_positives',
    'fairness_cases_total',
    'fairness_correctness_failures',
    'pair_delta_count',
    'hard_fail_count',
    'ask_floor_violations',
    'convergence_terminal',
    'economy_ok',
    'verification_actions',
    'findings_closed',
    'spend_tokens',
    'decision_trace_hash',
    'round_stream_hash',
    'corpus_manifest_hash',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  const trial = {
    trial_id: token(value.trial_id, `${label}.trial_id`),
    observed_at: timestamp(value.observed_at, `${label}.observed_at`),
    stop_reason: enumValue(value.stop_reason, BRAIN_STOP_REASONS, `${label}.stop_reason`),
    construct_scope: token(value.construct_scope, `${label}.construct_scope`),
    plants_total: integer(value.plants_total, `${label}.plants_total`),
    plants_caught: integer(value.plants_caught, `${label}.plants_caught`),
    clean_false_positives: integer(value.clean_false_positives, `${label}.clean_false_positives`),
    fairness_cases_total: integer(value.fairness_cases_total, `${label}.fairness_cases_total`),
    fairness_correctness_failures: integer(
      value.fairness_correctness_failures,
      `${label}.fairness_correctness_failures`,
    ),
    pair_delta_count: integer(value.pair_delta_count, `${label}.pair_delta_count`),
    hard_fail_count: integer(value.hard_fail_count, `${label}.hard_fail_count`),
    ask_floor_violations: integer(value.ask_floor_violations, `${label}.ask_floor_violations`),
    convergence_terminal: boolean(value.convergence_terminal, `${label}.convergence_terminal`),
    economy_ok: boolean(value.economy_ok, `${label}.economy_ok`),
    verification_actions: integer(value.verification_actions, `${label}.verification_actions`),
    findings_closed: integer(value.findings_closed, `${label}.findings_closed`),
    spend_tokens: integer(value.spend_tokens, `${label}.spend_tokens`),
    decision_trace_hash: digest(value.decision_trace_hash, `${label}.decision_trace_hash`),
    round_stream_hash: digest(value.round_stream_hash, `${label}.round_stream_hash`),
    corpus_manifest_hash: digest(value.corpus_manifest_hash, `${label}.corpus_manifest_hash`),
  };
  if (trial.construct_scope !== BRAIN_CONSTRUCT_SCOPE) {
    evidenceError(`${label}.construct_scope must be the pinned honesty clause ${BRAIN_CONSTRUCT_SCOPE}`);
  }
  if (trial.plants_caught > trial.plants_total) {
    evidenceError(`${label}.plants_caught exceeds plants_total`);
  }
  if (trial.fairness_correctness_failures > trial.fairness_cases_total) {
    evidenceError(`${label}.fairness_correctness_failures exceeds fairness_cases_total`);
  }
  if (trial.corpus_manifest_hash !== methodology.corpus_manifest_hash) {
    evidenceError(`${label} does not match the methodology corpus manifest`);
  }
  return trial;
}

function normalizeTrials(raw, methodology) {
  if (!Array.isArray(raw)) evidenceError('evidence trials must be an array');
  if (methodology.kind !== 'role_eval' && methodology.kind !== BRAIN_METHODOLOGY_KIND
      && methodology.kind !== VA_METHODOLOGY_KIND) {
    if (raw.length !== 0) {
      evidenceError(`${methodology.kind} methodology cannot carry reviewer eval trials`);
    }
    return [];
  }
  const trials = raw.map((entry, index) => (methodology.kind === VA_METHODOLOGY_KIND
    ? normalizeVaTrial(entry, index, methodology)
    : (methodology.kind === BRAIN_METHODOLOGY_KIND
      ? normalizeBrainTrial(entry, index, methodology)
      : normalizeTrial(entry, index, methodology))));
  const ids = trials.map((trial) => trial.trial_id);
  if (new Set(ids).size !== ids.length) evidenceError('evidence trials must have unique ids');
  return trials.sort((left, right) => left.trial_id.localeCompare(right.trial_id));
}

function normalizeRevocation(raw, state) {
  if (raw === null) {
    if (state === 'revoked') evidenceError('revoked evidence requires a revocation record');
    return null;
  }
  const value = plainObject(raw, 'evidence revocation');
  const fields = ['reason', 'observation_hash', 'target_evidence_id'];
  onlyKeys(value, new Set(fields), 'evidence revocation');
  requiredKeys(value, fields, 'evidence revocation');
  if (state !== 'revoked') evidenceError('only revoked evidence may carry a revocation record');
  return {
    reason: enumValue(value.reason, REVOCATION_REASONS, 'evidence revocation.reason'),
    observation_hash: digest(
      value.observation_hash,
      'evidence revocation.observation_hash',
    ),
    target_evidence_id: digest(
      value.target_evidence_id,
      'evidence revocation.target_evidence_id',
    ),
  };
}

function enforcePromotion(record) {
  if (record.state !== 'qualified') return;
  if (record.source !== 'internal_eval') {
    evidenceError(`${record.source} cannot produce qualified evidence`, 'EVIDENCE_PROMOTION_DENIED');
  }
  if (!record.identity.identity_resolved) {
    evidenceError('qualified evidence requires an exact resolved identity', 'EVIDENCE_PROMOTION_DENIED');
  }
  if (record.methodology.kind !== 'role_eval'
      && record.methodology.kind !== BRAIN_METHODOLOGY_KIND
      && record.methodology.kind !== VA_METHODOLOGY_KIND) {
    evidenceError(
      'qualified evidence requires a role_eval, owner_brain_seat, or va_declared_plan methodology',
      'EVIDENCE_PROMOTION_DENIED',
    );
  }
  if (record.methodology.kind === BRAIN_METHODOLOGY_KIND) {
    enforceBrainPromotion(record);
    return;
  }
  if (record.methodology.kind === VA_METHODOLOGY_KIND) {
    enforceVaPromotion(record);
    return;
  }
  const thresholds = record.methodology.thresholds;
  if (record.trials.length < thresholds.min_trials || record.trials.length < 2) {
    evidenceError('qualified evidence requires repeated trials', 'EVIDENCE_PROMOTION_DENIED');
  }
  for (const trial of record.trials) {
    if (trial.known_bad_total < thresholds.min_known_bad_cases
        || trial.known_bad_caught !== trial.known_bad_total) {
      evidenceError('known-bad sensitivity floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.critical_total < thresholds.min_critical_cases
        || trial.false_pass_critical > thresholds.max_false_pass_critical
        || (record.role === 'reviewer' && trial.false_pass_critical !== 0)) {
      evidenceError('false-pass-on-Critical floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.clean_total < thresholds.min_clean_cases
        || trial.clean_false_positives > thresholds.max_clean_false_positives) {
      evidenceError('clean-specificity floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (!trial.artifact_oracle.independent || !trial.artifact_oracle.passed) {
      evidenceError('qualified evidence requires an independent artifact oracle', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (!trial.mutation_validation.oracle_rejected) {
      evidenceError('qualified evidence requires live mutation validation', 'EVIDENCE_PROMOTION_DENIED');
    }
  }
}

function enforceVaPromotion(record) {
  if (record.role !== 'verification_author') {
    evidenceError('va_declared_plan evidence must ride the verification_author role', 'EVIDENCE_PROMOTION_DENIED');
  }
  const thresholds = record.methodology.thresholds;
  if (record.trials.length < thresholds.min_trials || record.trials.length < 2) {
    evidenceError('qualified verification-author evidence requires repeated trials', 'EVIDENCE_PROMOTION_DENIED');
  }
  for (const trial of record.trials) {
    if (trial.declared_mismatches > thresholds.max_declared_mismatches
        || !trial.subjects.declared_accuracy) {
      evidenceError('declared-accuracy floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.missed_defects > thresholds.max_missed_defects || !trial.subjects.sensitivity) {
      evidenceError('sensitivity floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.robustness_violations > thresholds.max_robustness_violations
        || !trial.subjects.robustness) {
      evidenceError('robustness floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.cases_passed !== trial.cases_total) {
      evidenceError('qualified verification-author evidence requires every case to pass', 'EVIDENCE_PROMOTION_DENIED');
    }
  }
}

function enforceBrainPromotion(record) {
  if (record.role !== 'owner') {
    evidenceError('brain-seat evidence must ride the owner role', 'EVIDENCE_PROMOTION_DENIED');
  }
  // The forced scope is a KERNEL invariant, not a qualifier courtesy: a qualified
  // brain record under any other scope could establish standing while escaping the
  // brain-seat lineage partition (QC 2026-08-17, sol brain-scope-policy).
  if (record.scope.task_classes.length !== 1 || record.scope.task_classes[0] !== 'brain-seat') {
    evidenceError('qualified brain-seat evidence requires scope task_classes ["brain-seat"]', 'EVIDENCE_PROMOTION_DENIED');
  }
  const thresholds = record.methodology.thresholds;
  if (record.trials.length < thresholds.min_trials || record.trials.length < 2) {
    evidenceError('qualified brain-seat evidence requires repeated trials', 'EVIDENCE_PROMOTION_DENIED');
  }
  for (const trial of record.trials) {
    if (trial.stop_reason !== 'completed') {
      evidenceError('qualified brain-seat evidence requires completed streams', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.plants_total < thresholds.min_plants_per_trial
        || trial.plants_caught !== trial.plants_total) {
      evidenceError('勤勞 plant-detection floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.clean_false_positives > thresholds.max_clean_false_positives) {
      evidenceError('anti-paranoia clean floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.fairness_correctness_failures > thresholds.max_critical_misses) {
      evidenceError('公平 correctness floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.pair_delta_count > thresholds.max_pair_deltas) {
      evidenceError('公平 pair-invariance floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.hard_fail_count !== 0) {
      evidenceError('a hard fail forbids qualified brain-seat evidence', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (trial.ask_floor_violations > thresholds.max_asks_on_legal_controls) {
      evidenceError('containment escalation-precision floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
    if (!trial.convergence_terminal || !trial.economy_ok) {
      evidenceError('收斂 terminal/economy floor was not met', 'EVIDENCE_PROMOTION_DENIED');
    }
  }
}

function compileCapabilityEvidence(raw) {
  const value = plainObject(raw, 'capability evidence');
  const fields = [
    'schema_version',
    'evidence_id',
    'evidence_hash',
    'source',
    'source_ref',
    'state',
    'role',
    'scope',
    'scope_hash',
    'identity',
    'identity_hash',
    'grant_identity_hash',
    'issued_at',
    'observed_at',
    'expires_at',
    'methodology',
    'trials',
    'trial_set_hash',
    'revocation',
    'supersedes',
  ];
  onlyKeys(value, new Set(fields), 'capability evidence');
  requiredKeys(
    value,
    [
      'schema_version',
      'source',
      'source_ref',
      'state',
      'role',
      'scope',
      'identity',
      'issued_at',
      'observed_at',
      'expires_at',
      'methodology',
      'trials',
      'revocation',
      'supersedes',
    ],
    'capability evidence',
  );
  if (value.schema_version !== CAPABILITY_EVIDENCE_SCHEMA_VERSION) {
    evidenceError(`capability evidence schema_version must be ${CAPABILITY_EVIDENCE_SCHEMA_VERSION}`);
  }

  const source = enumValue(value.source, SOURCES, 'capability evidence.source');
  const state = enumValue(value.state, STATES, 'capability evidence.state');
  if (!SOURCE_STATE_CEILINGS[source].has(state)) {
    evidenceError(`${source} cannot produce ${state} evidence`, 'EVIDENCE_PROMOTION_DENIED');
  }
  const scope = normalizeScope(value.scope);
  const identity = normalizeIdentity(value.identity);
  const methodology = normalizeMethodology(value.methodology);
  if (!SOURCE_METHODOLOGY_KINDS[source].has(methodology.kind)) {
    evidenceError(
      `${source} evidence requires ${[...SOURCE_METHODOLOGY_KINDS[source]].join('|')} methodology`,
    );
  }
  const trials = normalizeTrials(value.trials, methodology);
  const issuedAt = timestamp(value.issued_at, 'capability evidence.issued_at');
  const observedAt = timestamp(value.observed_at, 'capability evidence.observed_at');
  const expiresAt = timestamp(value.expires_at, 'capability evidence.expires_at');
  if (Date.parse(observedAt) > Date.parse(issuedAt)) {
    evidenceError('capability evidence observed_at cannot be later than issued_at');
  }
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    evidenceError('capability evidence expires_at must be later than issued_at');
  }
  if (trials.some((trial) => Date.parse(trial.observed_at) > Date.parse(observedAt))) {
    evidenceError('capability evidence trial cannot be later than observed_at');
  }

  const role = enumValue(value.role, ROLES, 'capability evidence.role');
  // Brain-seat standing exemption (Board 2026-08-17): the owner_brain_seat kind is
  // clock-exempt — no TTL ceiling; revocation is strike-based in the state layer.
  if (state === 'qualified' && methodology.kind !== BRAIN_METHODOLOGY_KIND) {
    const ttlDays = (Date.parse(expiresAt) - Date.parse(issuedAt)) / 86_400_000;
    if (ttlDays > MAX_QUALIFIED_TTL_DAYS[role]) {
      evidenceError(`qualified ${role} evidence exceeds its expiry ceiling`);
    }
  }
  const supersedes = value.supersedes === null
    ? null : digest(value.supersedes, 'capability evidence.supersedes');
  const revocation = normalizeRevocation(value.revocation, state);
  const scopeHash = sha256(canonicalJson(scope));
  const identityHash = sha256(canonicalJson(identity));
  const grantIdentityHash = sha256(canonicalJson(grantIdentityProjection(identity)));
  const trialSetHash = sha256(canonicalJson(trials));
  const body = {
    schema_version: CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    source,
    source_ref: token(value.source_ref, 'capability evidence.source_ref'),
    state,
    role,
    scope,
    scope_hash: scopeHash,
    identity,
    identity_hash: identityHash,
    grant_identity_hash: grantIdentityHash,
    issued_at: issuedAt,
    observed_at: observedAt,
    expires_at: expiresAt,
    methodology,
    trials,
    trial_set_hash: trialSetHash,
    revocation,
    supersedes,
  };
  enforcePromotion(body);
  const evidenceHash = sha256(canonicalJson(body));

  const suppliedHashes = [
    ['scope_hash', scopeHash],
    ['identity_hash', identityHash],
    ['grant_identity_hash', grantIdentityHash],
    ['trial_set_hash', trialSetHash],
    ['evidence_id', evidenceHash],
    ['evidence_hash', evidenceHash],
  ];
  for (const [field, expected] of suppliedHashes) {
    if (value[field] !== undefined
        && digest(value[field], `capability evidence.${field}`) !== expected) {
      evidenceError(`capability evidence ${field} does not match its canonical content`);
    }
  }

  return cloneCanonical({
    ...body,
    evidence_id: evidenceHash,
    evidence_hash: evidenceHash,
  });
}

function capabilityEvidenceProducerHash(rawEvidence, producer) {
  const evidence = compileCapabilityEvidence(rawEvidence);
  return sha256(canonicalJson({
    producer: token(producer, 'capability evidence producer'),
    evidence_id: evidence.evidence_id,
    trial_set_hash: evidence.trial_set_hash,
    methodology_hash: sha256(canonicalJson(evidence.methodology)),
  }));
}

function normalizeQuery(raw) {
  const value = plainObject(raw, 'capability evidence query');
  onlyKeys(
    value,
    new Set(['role', 'scope', 'identity', 'evaluation_time', 'observation']),
    'capability evidence query',
  );
  requiredKeys(
    value,
    ['role', 'scope', 'identity', 'evaluation_time'],
    'capability evidence query',
  );
  let observation = null;
  if (value.observation !== undefined && value.observation !== null) {
    const rawObservation = plainObject(value.observation, 'capability evidence observation');
    onlyKeys(
      rawObservation,
      new Set(['identity_hash', 'critical_miss', 'probe_regression']),
      'capability evidence observation',
    );
    requiredKeys(
      rawObservation,
      ['identity_hash', 'critical_miss', 'probe_regression'],
      'capability evidence observation',
    );
    observation = {
      identity_hash: digest(
        rawObservation.identity_hash,
        'capability evidence observation.identity_hash',
      ),
      critical_miss: boolean(
        rawObservation.critical_miss,
        'capability evidence observation.critical_miss',
      ),
      probe_regression: boolean(
        rawObservation.probe_regression,
        'capability evidence observation.probe_regression',
      ),
    };
  }
  const scope = normalizeScope(value.scope);
  const identity = normalizeIdentity(value.identity);
  return {
    role: enumValue(value.role, ROLES, 'capability evidence query.role'),
    scope,
    scope_hash: sha256(canonicalJson(scope)),
    identity,
    identity_hash: sha256(canonicalJson(identity)),
    evaluation_time: timestamp(
      value.evaluation_time,
      'capability evidence query.evaluation_time',
    ),
    observation,
  };
}

function emptyEvaluation(query, reasons) {
  return cloneCanonical({
    schema_version: CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    evidence_id: null,
    evidence_hash: null,
    state: 'unknown',
    role: query.role,
    scope_hash: query.scope_hash,
    identity_hash: query.identity_hash,
    grant_identity_hash: null,
    provenance: null,
    applicability: {
      applicable: false,
      reasons: [...new Set(reasons)].sort(),
      requested_scope_hash: query.scope_hash,
      requested_identity_hash: query.identity_hash,
    },
    issued_at: null,
    observed_at: null,
    expires_at: null,
    methodology_version: null,
    trial_set_hash: null,
    revocation_reason: null,
  });
}

function sameEvidenceGroup(left, right) {
  return left.role === right.role
    && left.scope_hash === right.scope_hash
    && left.identity_hash === right.identity_hash;
}

function validateEvidenceLifecycle(records) {
  const byId = new Map();
  for (const record of records) {
    if (byId.has(record.evidence_id)) {
      evidenceError(
        `capability evidence ledger repeats ${record.evidence_id}`,
        'DUPLICATE_CAPABILITY_EVIDENCE',
      );
    }
    byId.set(record.evidence_id, record);
  }
  for (const record of records) {
    if (record.supersedes !== null) {
      const target = byId.get(record.supersedes);
      if (!target) {
        evidenceError(
          `capability evidence ${record.evidence_id} supersedes an unknown record`,
          'UNRESOLVED_EVIDENCE_REFERENCE',
        );
      }
      if (!sameEvidenceGroup(record, target)
          || Date.parse(target.observed_at) > Date.parse(record.observed_at)) {
        evidenceError(
          `capability evidence ${record.evidence_id} has an invalid supersedes target`,
          'INVALID_EVIDENCE_LINEAGE',
        );
      }
    }
    if (record.state === 'revoked') {
      const target = byId.get(record.revocation.target_evidence_id);
      if (!target || target.state !== 'qualified' || !sameEvidenceGroup(record, target)
          || record.supersedes !== target.evidence_id
          || Date.parse(target.observed_at) > Date.parse(record.observed_at)) {
        evidenceError(
          `revocation ${record.evidence_id} does not target an earlier exact qualification`,
          'INVALID_EVIDENCE_REVOCATION',
        );
      }
    }
  }
  return byId;
}

function descendsFrom(record, ancestorId, byId) {
  const visited = new Set();
  let current = record;
  while (current.supersedes !== null) {
    if (current.supersedes === ancestorId) return true;
    if (visited.has(current.supersedes)) {
      evidenceError('capability evidence lineage contains a cycle', 'INVALID_EVIDENCE_LINEAGE');
    }
    visited.add(current.supersedes);
    current = byId.get(current.supersedes);
    if (!current) return false;
  }
  return false;
}

function evaluateCapabilityEvidence(rawRecords, rawQuery) {
  if (!Array.isArray(rawRecords)) evidenceError('capability evidence records must be an array');
  const records = rawRecords.map((record) => compileCapabilityEvidence(record));
  const byId = validateEvidenceLifecycle(records);
  const query = normalizeQuery(rawQuery);
  const roleRecords = records.filter((record) => record.role === query.role);
  if (roleRecords.length === 0) {
    return emptyEvaluation(query, records.length > 0 ? ['role_mismatch'] : ['no_evidence']);
  }
  const scopeRecords = roleRecords.filter((record) => record.scope_hash === query.scope_hash);
  if (scopeRecords.length === 0) return emptyEvaluation(query, ['scope_mismatch']);
  const exactRecords = scopeRecords.filter(
    (record) => record.identity_hash === query.identity_hash,
  );
  if (exactRecords.length === 0) return emptyEvaluation(query, ['identity_mismatch']);
  const evaluationMs = Date.parse(query.evaluation_time);
  const eligibleRecords = exactRecords.filter((record) => (
    Date.parse(record.issued_at) <= evaluationMs
    && Date.parse(record.observed_at) <= evaluationMs
  ));
  if (eligibleRecords.length === 0) {
    return emptyEvaluation(query, ['evidence_not_yet_valid']);
  }
  eligibleRecords.sort((left, right) => {
    const timeDelta = Date.parse(right.observed_at) - Date.parse(left.observed_at);
    const stateDelta = STATE_TIE_PRECEDENCE[right.state] - STATE_TIE_PRECEDENCE[left.state];
    return timeDelta || stateDelta || right.evidence_id.localeCompare(left.evidence_id);
  });
  const latestQualified = eligibleRecords.find((record) => record.state === 'qualified');
  const restrictiveRecords = eligibleRecords.filter(
    (record) => ['revoked', 'degraded', 'stale'].includes(record.state),
  );
  if (latestQualified) {
    const unboundRestriction = restrictiveRecords.find((record) => (
      Date.parse(record.observed_at) >= Date.parse(latestQualified.observed_at)
      && !descendsFrom(record, latestQualified.evidence_id, byId)
      && !descendsFrom(latestQualified, record.evidence_id, byId)
    ));
    if (unboundRestriction) {
      evidenceError(
        `restrictive evidence ${unboundRestriction.evidence_id} is not bound to the active qualification`,
        'INVALID_EVIDENCE_LINEAGE',
      );
    }
  }
  const latestRestrictive = latestQualified
    ? restrictiveRecords.find((record) => (
      descendsFrom(record, latestQualified.evidence_id, byId)
    ))
    : restrictiveRecords[0];
  let record = eligibleRecords[0];
  if (latestQualified) {
    record = latestRestrictive
      && Date.parse(latestRestrictive.observed_at) >= Date.parse(latestQualified.observed_at)
      ? latestRestrictive
      : latestQualified;
  }
  let state = record.state;
  let revocationReason = record.revocation ? record.revocation.reason : null;
  if (state !== 'revoked'
      && record.methodology.kind !== BRAIN_METHODOLOGY_KIND
      && Date.parse(record.expires_at) <= Date.parse(query.evaluation_time)) {
    state = 'stale';
  }
  if (query.observation) {
    if (query.observation.identity_hash !== query.identity_hash) {
      state = 'revoked';
      revocationReason = 'semantic_identity_drift';
    } else if (query.observation.critical_miss) {
      state = 'revoked';
      revocationReason = 'critical_miss';
    } else if (query.observation.probe_regression) {
      state = 'revoked';
      revocationReason = 'probe_regression';
    }
  }
  return cloneCanonical({
    schema_version: CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    evidence_id: record.evidence_id,
    evidence_hash: record.evidence_hash,
    state,
    role: record.role,
    scope_hash: record.scope_hash,
    identity_hash: record.identity_hash,
    grant_identity_hash: record.grant_identity_hash,
    provenance: {
      source: record.source,
      source_ref: record.source_ref,
      methodology_name: record.methodology.name,
      methodology_version: record.methodology.version,
    },
    applicability: {
      applicable: true,
      reasons: [],
      requested_scope_hash: query.scope_hash,
      requested_identity_hash: query.identity_hash,
    },
    issued_at: record.issued_at,
    observed_at: record.observed_at,
    expires_at: record.expires_at,
    methodology_version: record.methodology.version,
    trial_set_hash: record.trial_set_hash,
    revocation_reason: revocationReason,
  });
}

function buildCapabilityEvidenceReceipt(record, query) {
  return evaluateCapabilityEvidence([record], query);
}

function normalizeCapabilityEvidenceReceipt(raw, options = {}) {
  const value = plainObject(raw, 'capability evidence receipt');
  const fields = [
    'schema_version',
    'evidence_id',
    'evidence_hash',
    'state',
    'role',
    'scope_hash',
    'identity_hash',
    'grant_identity_hash',
    'provenance',
    'applicability',
    'issued_at',
    'observed_at',
    'expires_at',
    'methodology_version',
    'trial_set_hash',
    'revocation_reason',
  ];
  onlyKeys(value, new Set(fields), 'capability evidence receipt');
  requiredKeys(value, fields, 'capability evidence receipt');
  if (value.schema_version !== CAPABILITY_EVIDENCE_SCHEMA_VERSION) {
    evidenceError('capability evidence receipt schema_version must be 1');
  }
  if (value.evidence_id === null || value.evidence_hash === null
      || value.grant_identity_hash === null || value.provenance === null
      || value.issued_at === null || value.observed_at === null
      || value.expires_at === null || value.methodology_version === null
      || value.trial_set_hash === null) {
    evidenceError('capability evidence receipt does not identify applicable evidence');
  }
  const evidenceId = digest(value.evidence_id, 'capability evidence receipt.evidence_id');
  const evidenceHash = digest(value.evidence_hash, 'capability evidence receipt.evidence_hash');
  if (evidenceId !== evidenceHash) {
    evidenceError('capability evidence receipt id and content hash differ');
  }
  const provenance = plainObject(value.provenance, 'capability evidence receipt.provenance');
  onlyKeys(
    provenance,
    new Set(['source', 'source_ref', 'methodology_name', 'methodology_version']),
    'capability evidence receipt.provenance',
  );
  requiredKeys(
    provenance,
    ['source', 'source_ref', 'methodology_name', 'methodology_version'],
    'capability evidence receipt.provenance',
  );
  const applicability = plainObject(
    value.applicability,
    'capability evidence receipt.applicability',
  );
  onlyKeys(
    applicability,
    new Set([
      'applicable',
      'reasons',
      'requested_scope_hash',
      'requested_identity_hash',
    ]),
    'capability evidence receipt.applicability',
  );
  requiredKeys(
    applicability,
    ['applicable', 'reasons', 'requested_scope_hash', 'requested_identity_hash'],
    'capability evidence receipt.applicability',
  );
  const state = enumValue(value.state, STATES, 'capability evidence receipt.state');
  const source = enumValue(
    provenance.source,
    SOURCES,
    'capability evidence receipt.provenance.source',
  );
  if (!SOURCE_STATE_CEILINGS[source].has(state)) {
    evidenceError(`${source} cannot produce ${state} evidence`, 'EVIDENCE_PROMOTION_DENIED');
  }
  if (state === 'qualified' && source !== 'internal_eval') {
    evidenceError(`${source} cannot produce qualified evidence`, 'EVIDENCE_PROMOTION_DENIED');
  }
  const methodVersion = token(
    value.methodology_version,
    'capability evidence receipt.methodology_version',
  );
  const provenanceVersion = token(
    provenance.methodology_version,
    'capability evidence receipt.provenance.methodology_version',
  );
  if (methodVersion !== provenanceVersion) {
    evidenceError('capability evidence receipt methodology versions differ');
  }
  const normalizedApplicability = {
    applicable: boolean(
      applicability.applicable,
      'capability evidence receipt.applicability.applicable',
    ),
    reasons: tokenList(
      applicability.reasons,
      'capability evidence receipt.applicability.reasons',
    ),
    requested_scope_hash: digest(
      applicability.requested_scope_hash,
      'capability evidence receipt.applicability.requested_scope_hash',
    ),
    requested_identity_hash: digest(
      applicability.requested_identity_hash,
      'capability evidence receipt.applicability.requested_identity_hash',
    ),
  };
  if (normalizedApplicability.applicable && normalizedApplicability.reasons.length > 0) {
    evidenceError('applicable capability evidence receipt cannot carry mismatch reasons');
  }
  if (!normalizedApplicability.applicable) {
    evidenceError('inapplicable capability evidence receipt cannot enter a role grant');
  }
  const scopeHash = digest(value.scope_hash, 'capability evidence receipt.scope_hash');
  const identityHash = digest(value.identity_hash, 'capability evidence receipt.identity_hash');
  if (normalizedApplicability.requested_scope_hash !== scopeHash
      || normalizedApplicability.requested_identity_hash !== identityHash) {
    evidenceError('capability evidence receipt applicability hashes do not match its evidence');
  }
  const issuedAt = timestamp(value.issued_at, 'capability evidence receipt.issued_at');
  const observedAt = timestamp(value.observed_at, 'capability evidence receipt.observed_at');
  const expiresAt = timestamp(value.expires_at, 'capability evidence receipt.expires_at');
  if (Date.parse(observedAt) > Date.parse(issuedAt)
      || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    evidenceError('capability evidence receipt has invalid observation/expiry ordering');
  }
  const revocationReason = value.revocation_reason === null
    ? null
    : enumValue(
      value.revocation_reason,
      REVOCATION_REASONS,
      'capability evidence receipt.revocation_reason',
    );
  if (state === 'revoked' && revocationReason === null) {
    evidenceError('revoked capability evidence receipt requires a reason');
  }
  if (state !== 'revoked' && revocationReason !== null) {
    evidenceError('non-revoked capability evidence receipt cannot carry a revocation reason');
  }
  const normalized = cloneCanonical({
    schema_version: CAPABILITY_EVIDENCE_SCHEMA_VERSION,
    evidence_id: evidenceId,
    evidence_hash: evidenceHash,
    state,
    role: enumValue(value.role, ROLES, 'capability evidence receipt.role'),
    scope_hash: scopeHash,
    identity_hash: identityHash,
    grant_identity_hash: digest(
      value.grant_identity_hash,
      'capability evidence receipt.grant_identity_hash',
    ),
    provenance: {
      source,
      source_ref: token(
        provenance.source_ref,
        'capability evidence receipt.provenance.source_ref',
      ),
      methodology_name: token(
        provenance.methodology_name,
        'capability evidence receipt.provenance.methodology_name',
      ),
      methodology_version: provenanceVersion,
    },
    applicability: normalizedApplicability,
    issued_at: issuedAt,
    observed_at: observedAt,
    expires_at: expiresAt,
    methodology_version: methodVersion,
    trial_set_hash: digest(
      value.trial_set_hash,
      'capability evidence receipt.trial_set_hash',
    ),
    revocation_reason: revocationReason,
  });
  if (!options || typeof options.verify !== 'function') {
    evidenceError(
      'capability evidence receipt requires a trusted evidence resolver',
      'UNTRUSTED_CAPABILITY_EVIDENCE',
    );
  }
  let verified = false;
  try {
    verified = options.verify(cloneCanonical(normalized)) === true;
  } catch {
    verified = false;
  }
  if (!verified) {
    evidenceError(
      'capability evidence receipt was not resolved by the trusted evidence store',
      'UNTRUSTED_CAPABILITY_EVIDENCE',
    );
  }
  return normalized;
}

function fileHash(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

function safeCorpusPath(root, relativePath, label) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)
      || relativePath.includes('\\') || relativePath.split('/').includes('..')) {
    evidenceError(`${label} must be a contained POSIX relative path`, 'INVALID_EVAL_CORPUS');
  }
  const rootReal = fs.realpathSync(root);
  const resolved = path.resolve(rootReal, relativePath);
  const real = fs.realpathSync(resolved);
  if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) {
    evidenceError(`${label} escapes the corpus root`, 'INVALID_EVAL_CORPUS');
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    evidenceError(`${label} must identify a regular non-symlink file`, 'INVALID_EVAL_CORPUS');
  }
  return real;
}

function normalizeCorpusEntry(raw, index, kind, root) {
  const label = `corpus ${kind}[${index}]`;
  const value = plainObject(raw, label);
  const fields = [
    'id',
    'class',
    'diff_path',
    'diff_sha256',
    'oracle_path',
    'oracle_sha256',
  ];
  onlyKeys(value, new Set(fields), label);
  requiredKeys(value, fields, label);
  const expectedClass = kind === 'clean'
    ? new Set(['clean']) : new Set(['critical', 'major', 'minor']);
  const entry = {
    id: token(value.id, `${label}.id`),
    class: enumValue(value.class, expectedClass, `${label}.class`),
    diff_path: value.diff_path,
    diff_sha256: digest(value.diff_sha256, `${label}.diff_sha256`),
    oracle_path: value.oracle_path,
    oracle_sha256: digest(value.oracle_sha256, `${label}.oracle_sha256`),
  };
  const diffPath = safeCorpusPath(root, entry.diff_path, `${label}.diff_path`);
  const oraclePath = safeCorpusPath(root, entry.oracle_path, `${label}.oracle_path`);
  const diffContents = fs.readFileSync(diffPath);
  const oracleContents = fs.readFileSync(oraclePath);
  if (fileHash(diffContents) !== entry.diff_sha256
      || fileHash(oracleContents) !== entry.oracle_sha256) {
    evidenceError(`corpus artifact hash mismatch for ${entry.id}`, 'EVAL_CORPUS_DRIFT');
  }
  let oracle;
  try {
    oracle = JSON.parse(oracleContents.toString('utf8'));
  } catch (error) {
    evidenceError(`${label} oracle is invalid JSON: ${error.message}`, 'INVALID_EVAL_CORPUS');
  }
  if (!oracle || typeof oracle !== 'object' || Array.isArray(oracle)
      || oracle.class !== entry.class) {
    evidenceError(`${label} oracle class does not match the manifest`, 'INVALID_EVAL_CORPUS');
  }
  if (kind === 'known_bad'
      && (typeof oracle.defect !== 'string' || oracle.defect.trim().length === 0)) {
    evidenceError(`${label} oracle lacks an independent defect description`, 'INVALID_EVAL_CORPUS');
  }
  return { entry, diffContents };
}

function reverseUnifiedDiff(contents) {
  const input = Buffer.isBuffer(contents) ? contents.toString('utf8') : String(contents);
  const lines = input.split('\n');
  const output = [];
  let changed = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('--- ') && index + 1 < lines.length
        && lines[index + 1].startsWith('+++ ')) {
      output.push(`--- ${lines[index + 1].slice(4)}`);
      output.push(`+++ ${line.slice(4)}`);
      index += 1;
      changed = true;
      continue;
    }
    const hunk = line.match(/^@@ -([0-9]+(?:,[0-9]+)?) \+([0-9]+(?:,[0-9]+)?) @@(.*)$/u);
    if (hunk) {
      output.push(`@@ -${hunk[2]} +${hunk[1]} @@${hunk[3]}`);
      changed = true;
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      output.push(`-${line.slice(1)}`);
      changed = true;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      output.push(`+${line.slice(1)}`);
      changed = true;
      continue;
    }
    output.push(line);
  }
  if (!changed || !output.some((line) => line.startsWith('@@ '))) {
    evidenceError(
      'evaluation corpus mutation target is not a reversible unified diff',
      'VACUOUS_EVAL_ORACLE',
    );
  }
  return output.join('\n');
}

function verifyEvaluationCorpus(raw) {
  const options = plainObject(raw, 'evaluation corpus options');
  onlyKeys(
    options,
    new Set(['root', 'manifest_path', 'mutation_control']),
    'evaluation corpus options',
  );
  requiredKeys(options, ['root', 'manifest_path'], 'evaluation corpus options');
  const root = fs.realpathSync(options.root);
  const manifestPath = fs.realpathSync(options.manifest_path);
  if (manifestPath !== root && !manifestPath.startsWith(`${root}${path.sep}`)) {
    evidenceError('evaluation corpus manifest escapes the root', 'INVALID_EVAL_CORPUS');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    evidenceError(`evaluation corpus manifest is invalid JSON: ${error.message}`, 'INVALID_EVAL_CORPUS');
  }
  plainObject(manifest, 'evaluation corpus manifest');
  onlyKeys(
    manifest,
    new Set(['schema_version', 'methodology_version', 'known_bad', 'clean']),
    'evaluation corpus manifest',
  );
  requiredKeys(
    manifest,
    ['schema_version', 'methodology_version', 'known_bad', 'clean'],
    'evaluation corpus manifest',
  );
  if (manifest.schema_version !== 1) {
    evidenceError('evaluation corpus schema_version must be 1', 'INVALID_EVAL_CORPUS');
  }
  token(manifest.methodology_version, 'evaluation corpus methodology_version');
  if (!Array.isArray(manifest.known_bad) || !Array.isArray(manifest.clean)
      || manifest.known_bad.length === 0 || manifest.clean.length === 0) {
    evidenceError('evaluation corpus requires non-empty known_bad and clean sets', 'INVALID_EVAL_CORPUS');
  }
  const knownBad = manifest.known_bad.map(
    (entry, index) => normalizeCorpusEntry(entry, index, 'known_bad', root),
  );
  const clean = manifest.clean.map(
    (entry, index) => normalizeCorpusEntry(entry, index, 'clean', root),
  );
  const ids = [...knownBad, ...clean].map(({ entry }) => entry.id);
  if (new Set(ids).size !== ids.length) {
    evidenceError('evaluation corpus ids must be unique across both sets', 'INVALID_EVAL_CORPUS');
  }
  const artifactPaths = [...knownBad, ...clean].flatMap(({ entry }) => (
    [entry.diff_path, entry.oracle_path]
  ));
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    evidenceError('evaluation corpus artifact paths must be unique', 'INVALID_EVAL_CORPUS');
  }

  let mutationControl = null;
  if (options.mutation_control === true) {
    const target = knownBad[0];
    const mutatedContents = Buffer.from(reverseUnifiedDiff(target.diffContents), 'utf8');
    const mutatedHash = fileHash(mutatedContents);
    if (mutatedHash === target.entry.diff_sha256) {
      evidenceError('evaluation corpus mutation control was vacuous', 'VACUOUS_EVAL_ORACLE');
    }
    mutationControl = {
      target_id: target.entry.id,
      original_hash: target.entry.diff_sha256,
      mutated_hash: mutatedHash,
      mutated_diff: mutatedContents.toString('utf8'),
      expected_original_verdict: 'fail',
      expected_mutated_verdict: 'pass',
    };
  } else if (options.mutation_control !== undefined && options.mutation_control !== false) {
    evidenceError('evaluation corpus mutation_control must be boolean');
  }

  const manifestHash = sha256(canonicalJson(manifest));
  return cloneCanonical({
    schema_version: 1,
    methodology_version: manifest.methodology_version,
    corpus_manifest_hash: manifestHash,
    artifact_oracle_hash: sha256(canonicalJson({
      corpus_manifest_hash: manifestHash,
      entries: [...knownBad, ...clean].map(({ entry }) => entry),
    })),
    known_bad_count: knownBad.length,
    critical_count: knownBad.filter(({ entry }) => entry.class === 'critical').length,
    clean_count: clean.length,
    known_bad: knownBad.map(({ entry }) => entry),
    clean: clean.map(({ entry }) => entry),
    mutation_control: mutationControl,
  });
}

module.exports = {
  CAPABILITY_EVIDENCE_SCHEMA_VERSION,
  CapabilityEvidenceError,
  BRAIN_CONSTRUCT_SCOPE,
  BRAIN_METHODOLOGY_KIND,
  MAX_QUALIFIED_TTL_DAYS,
  METHODOLOGY_KINDS,
  REVOCATION_REASONS,
  ROLES,
  SOURCES,
  STATES,
  buildCapabilityEvidenceReceipt,
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
  normalizeCapabilityEvidenceReceipt,
  normalizeIdentity,
  normalizeScope,
  reverseUnifiedDiff,
  verifyEvaluationCorpus,
};
