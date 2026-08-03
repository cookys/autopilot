'use strict';

const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');
const PROFILE_CATALOG = require('../../profiles/profile-catalog.json');

const PROFILE_CUTOVER_SCHEMA_VERSION = 1;
const GATE_STATES = new Set(['pass', 'fail', 'unverified']);
const EXACT_TOKEN_SOURCE = /^(?:harness_reported_input_delta|exact_tokenizer:[A-Za-z0-9._:-]{1,128})$/u;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/u;

class ProfileCutoverError extends Error {
  constructor(message, code = 'INVALID_PROFILE_CUTOVER_SNAPSHOT') {
    super(message);
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProfileCutoverError(message, code);
}

function strictObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, fields, label) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} fields differ from the contract`);
  }
}

function token(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    fail(`${label} must be a bounded protocol token`);
  }
  return value;
}

function sha(value, label) {
  if (!isSha256(value)) fail(`${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    fail(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    fail(`${label} must be one of ${[...allowed].join(', ')}`);
  }
  return value;
}

function normalizeProfileSource(raw, name) {
  const value = strictObject(raw, `profile_sources.${name}`);
  exactKeys(value, ['profile_hash', 'control_bytes'], `profile_sources.${name}`);
  const normalized = {
    profile_hash: sha(value.profile_hash, `profile_sources.${name}.profile_hash`),
    control_bytes: integer(value.control_bytes, `profile_sources.${name}.control_bytes`, 1),
  };
  const catalog = PROFILE_CATALOG.profiles[name];
  if (normalized.profile_hash !== catalog.sha256
      || normalized.control_bytes !== PROFILE_CATALOG.core.bytes + catalog.bytes) {
    fail(
      `profile_sources.${name} does not match the current canonical profile catalog`,
      'PROFILE_CUTOVER_SOURCE_DRIFT',
    );
  }
  return normalized;
}

function normalizeContextMeasurement(raw, index) {
  const label = `context_measurements[${index}]`;
  const value = strictObject(raw, label);
  exactKeys(value, [
    'host',
    'deployment_identity_hash',
    'measured_at',
    'token_source',
    'guided_control_tokens',
    'autonomous_control_tokens',
    'isolation_receipt_hash',
    'fresh_session_switch',
  ], label);
  return {
    host: token(value.host, `${label}.host`),
    deployment_identity_hash: sha(
      value.deployment_identity_hash,
      `${label}.deployment_identity_hash`,
    ),
    measured_at: timestamp(value.measured_at, `${label}.measured_at`),
    token_source: token(value.token_source, `${label}.token_source`),
    guided_control_tokens: integer(
      value.guided_control_tokens,
      `${label}.guided_control_tokens`,
      1,
    ),
    autonomous_control_tokens: integer(
      value.autonomous_control_tokens,
      `${label}.autonomous_control_tokens`,
      1,
    ),
    isolation_receipt_hash: sha(
      value.isolation_receipt_hash,
      `${label}.isolation_receipt_hash`,
    ),
    fresh_session_switch: boolean(
      value.fresh_session_switch,
      `${label}.fresh_session_switch`,
    ),
  };
}

function normalizeDogfoodReceipt(raw, index) {
  const label = `dogfood_receipts[${index}]`;
  const value = strictObject(raw, label);
  exactKeys(value, [
    'receipt_id',
    'task_id',
    'profile_session_id',
    'risk',
    'profile',
    'status',
    'started_at',
    'completed_at',
    'owner_identity_hash',
    'owner_family',
    'reviewer_family',
    'owner_qualification_receipt_id',
    'owner_qualified_at',
    'owner_qualification_expires_at',
    'independent_acceptance_receipt_hash',
    'acceptance_passed',
    'critical_false_pass_attributed_to_reduction',
    'reviewer_catches',
    'rework_cycles',
    'wall_time_ms',
    'input_tokens',
    'output_tokens',
  ], label);
  const receipt = {
    receipt_id: sha(value.receipt_id, `${label}.receipt_id`),
    task_id: token(value.task_id, `${label}.task_id`),
    profile_session_id: token(value.profile_session_id, `${label}.profile_session_id`),
    risk: enumValue(value.risk, new Set(['low']), `${label}.risk`),
    profile: enumValue(value.profile, new Set(['autonomous']), `${label}.profile`),
    status: enumValue(value.status, new Set(['completed']), `${label}.status`),
    started_at: timestamp(value.started_at, `${label}.started_at`),
    completed_at: timestamp(value.completed_at, `${label}.completed_at`),
    owner_identity_hash: sha(value.owner_identity_hash, `${label}.owner_identity_hash`),
    owner_family: token(value.owner_family, `${label}.owner_family`),
    reviewer_family: token(value.reviewer_family, `${label}.reviewer_family`),
    owner_qualification_receipt_id: sha(
      value.owner_qualification_receipt_id,
      `${label}.owner_qualification_receipt_id`,
    ),
    owner_qualified_at: timestamp(value.owner_qualified_at, `${label}.owner_qualified_at`),
    owner_qualification_expires_at: timestamp(
      value.owner_qualification_expires_at,
      `${label}.owner_qualification_expires_at`,
    ),
    independent_acceptance_receipt_hash: sha(
      value.independent_acceptance_receipt_hash,
      `${label}.independent_acceptance_receipt_hash`,
    ),
    acceptance_passed: boolean(value.acceptance_passed, `${label}.acceptance_passed`),
    critical_false_pass_attributed_to_reduction: boolean(
      value.critical_false_pass_attributed_to_reduction,
      `${label}.critical_false_pass_attributed_to_reduction`,
    ),
    reviewer_catches: integer(value.reviewer_catches, `${label}.reviewer_catches`),
    rework_cycles: integer(value.rework_cycles, `${label}.rework_cycles`),
    wall_time_ms: integer(value.wall_time_ms, `${label}.wall_time_ms`, 1),
    input_tokens: integer(value.input_tokens, `${label}.input_tokens`, 1),
    output_tokens: integer(value.output_tokens, `${label}.output_tokens`, 1),
  };
  if (Date.parse(receipt.completed_at) < Date.parse(receipt.started_at)
      || Date.parse(receipt.owner_qualification_expires_at)
        <= Date.parse(receipt.owner_qualified_at)) {
    fail(`${label} has an invalid time interval`);
  }
  return receipt;
}

function normalizeDogfoodWindow(raw) {
  const value = strictObject(raw, 'dogfood_window');
  exactKeys(value, [
    'status',
    'window_id',
    'started_at',
    'ended_at',
    'dispatched_task_ids',
    'receipt_set_hash',
  ], 'dogfood_window');
  const status = enumValue(value.status, new Set(['observed', 'missing']), 'dogfood_window.status');
  if (!Array.isArray(value.dispatched_task_ids)) {
    fail('dogfood_window.dispatched_task_ids must be an array');
  }
  const taskIds = value.dispatched_task_ids.map((entry, index) => (
    token(entry, `dogfood_window.dispatched_task_ids[${index}]`)
  )).sort();
  if (new Set(taskIds).size !== taskIds.length) {
    fail('dogfood_window.dispatched_task_ids must not contain duplicates');
  }
  if (status === 'missing') {
    if (value.window_id !== null || value.started_at !== null || value.ended_at !== null
        || value.receipt_set_hash !== null || taskIds.length !== 0) {
      fail('missing dogfood window cannot carry observed fields');
    }
    return {
      status,
      window_id: null,
      started_at: null,
      ended_at: null,
      dispatched_task_ids: [],
      receipt_set_hash: null,
    };
  }
  const startedAt = timestamp(value.started_at, 'dogfood_window.started_at');
  const endedAt = timestamp(value.ended_at, 'dogfood_window.ended_at');
  if (Date.parse(endedAt) < Date.parse(startedAt)) {
    fail('dogfood_window has an invalid time interval');
  }
  return {
    status,
    window_id: token(value.window_id, 'dogfood_window.window_id'),
    started_at: startedAt,
    ended_at: endedAt,
    dispatched_task_ids: taskIds,
    receipt_set_hash: sha(value.receipt_set_hash, 'dogfood_window.receipt_set_hash'),
  };
}

function normalizeProfileCutoverSnapshot(raw) {
  const value = strictObject(raw, 'profile cutover snapshot');
  exactKeys(value, [
    'schema_version',
    'observed_at',
    'project_default',
    'candidate_default',
    'rollback',
    'supported_hosts',
    'profile_sources',
    'context_measurements',
    'effectful_guided_compatibility',
    'fallback_tests',
    'critical_false_passes_attributed_to_reduction',
    'assurance_invariance',
    'dogfood_window',
    'dogfood_receipts',
  ], 'profile cutover snapshot');
  if (value.schema_version !== PROFILE_CUTOVER_SCHEMA_VERSION) {
    fail('profile cutover snapshot.schema_version must equal 1');
  }
  const rollback = strictObject(value.rollback, 'rollback');
  exactKeys(rollback, ['setting', 'value'], 'rollback');
  const sources = strictObject(value.profile_sources, 'profile_sources');
  exactKeys(sources, ['guided', 'autonomous'], 'profile_sources');
  const effectful = strictObject(
    value.effectful_guided_compatibility,
    'effectful_guided_compatibility',
  );
  exactKeys(effectful, ['status', 'receipt_hash'], 'effectful_guided_compatibility');
  const effectfulStatus = enumValue(
    effectful.status,
    new Set(['observed', 'missing']),
    'effectful_guided_compatibility.status',
  );
  if ((effectfulStatus === 'observed') !== isSha256(effectful.receipt_hash)) {
    fail('effectful compatibility receipt hash must exist exactly when status is observed');
  }
  const fallback = strictObject(value.fallback_tests, 'fallback_tests');
  exactKeys(fallback, [
    'identity_drift',
    'capability_expiry',
    'capability_demotion',
    'replacement_reresolution',
    'profile_change_fresh_session',
  ], 'fallback_tests');
  const assurance = strictObject(value.assurance_invariance, 'assurance_invariance');
  exactKeys(assurance, [
    'high_risk_assurance_unchanged',
    'cross_family_review',
  ], 'assurance_invariance');
  if (!Array.isArray(value.supported_hosts) || value.supported_hosts.length === 0) {
    fail('supported_hosts must be a non-empty array');
  }
  const supportedHosts = value.supported_hosts.map((host, index) => (
    token(host, `supported_hosts[${index}]`)
  )).sort();
  if (new Set(supportedHosts).size !== supportedHosts.length) {
    fail('supported_hosts must not contain duplicates');
  }
  if (!Array.isArray(value.context_measurements)
      || !Array.isArray(value.dogfood_receipts)) {
    fail('context_measurements and dogfood_receipts must be arrays');
  }
  return cloneCanonical({
    schema_version: PROFILE_CUTOVER_SCHEMA_VERSION,
    observed_at: timestamp(value.observed_at, 'observed_at'),
    project_default: enumValue(
      value.project_default,
      new Set(['guided', 'adaptive']),
      'project_default',
    ),
    candidate_default: enumValue(
      value.candidate_default,
      new Set(['adaptive']),
      'candidate_default',
    ),
    rollback: {
      setting: token(rollback.setting, 'rollback.setting'),
      value: enumValue(rollback.value, new Set(['guided']), 'rollback.value'),
    },
    supported_hosts: supportedHosts,
    profile_sources: {
      guided: normalizeProfileSource(sources.guided, 'guided'),
      autonomous: normalizeProfileSource(sources.autonomous, 'autonomous'),
    },
    context_measurements: value.context_measurements.map(normalizeContextMeasurement),
    effectful_guided_compatibility: {
      status: effectfulStatus,
      receipt_hash: effectfulStatus === 'observed'
        ? effectful.receipt_hash.toLowerCase() : null,
    },
    fallback_tests: Object.fromEntries(Object.entries(fallback).map(([name, state]) => [
      name,
      enumValue(state, GATE_STATES, `fallback_tests.${name}`),
    ])),
    critical_false_passes_attributed_to_reduction: integer(
      value.critical_false_passes_attributed_to_reduction,
      'critical_false_passes_attributed_to_reduction',
    ),
    assurance_invariance: Object.fromEntries(Object.entries(assurance).map(([name, state]) => [
      name,
      enumValue(state, GATE_STATES, `assurance_invariance.${name}`),
    ])),
    dogfood_window: normalizeDogfoodWindow(value.dogfood_window),
    dogfood_receipts: value.dogfood_receipts.map(normalizeDogfoodReceipt),
  });
}

function runLiveVerifier(verifier, input) {
  if (typeof verifier !== 'function') {
    return { ok: false, reason: 'live_verifier_unavailable', evidence_hash: null };
  }
  const normalizedInput = cloneCanonical(input);
  const inputHash = sha256(canonicalJson(normalizedInput));
  let receipt;
  try {
    receipt = verifier(normalizedInput);
  } catch {
    return { ok: false, reason: 'live_verifier_error', evidence_hash: null };
  }
  if (!receipt || receipt.ok !== true || receipt.input_hash !== inputHash
      || !isSha256(receipt.evidence_hash)) {
    return { ok: false, reason: 'live_verifier_rejected', evidence_hash: null };
  }
  return {
    ok: true,
    reason: 'verified',
    evidence_hash: receipt.evidence_hash.toLowerCase(),
  };
}

function gate(id, passed, reason, evidence = {}) {
  return {
    id,
    status: passed ? 'pass' : 'hold',
    reason,
    evidence,
  };
}

function evaluateProfileCutover(raw, options = {}) {
  const snapshot = normalizeProfileCutoverSnapshot(raw);
  const observedAtMs = Date.parse(snapshot.observed_at);
  const verificationHashes = [];
  const gates = [];

  const guidedDefault = snapshot.project_default === 'guided'
    && snapshot.candidate_default === 'adaptive'
    && snapshot.rollback.setting === 'governance.guidance_profile'
    && snapshot.rollback.value === 'guided';
  gates.push(gate(
    'guided_authoritative_and_single_setting_rollback',
    guidedDefault,
    guidedDefault ? 'guided remains authoritative with one-setting rollback'
      : 'project default or rollback contract is not guided',
  ));

  const measurementsByHost = new Map();
  let exactSavings = true;
  let verifiedMeasurements = 0;
  for (const measurement of snapshot.context_measurements) {
    if (measurementsByHost.has(measurement.host)) exactSavings = false;
    measurementsByHost.set(measurement.host, measurement);
    const verified = runLiveVerifier(options.contextMeasurementVerifier, measurement);
    if (!verified.ok) exactSavings = false;
    else {
      verifiedMeasurements += 1;
      verificationHashes.push(verified.evidence_hash);
    }
    if (!EXACT_TOKEN_SOURCE.test(measurement.token_source)
        || measurement.guided_control_tokens <= measurement.autonomous_control_tokens
        || measurement.fresh_session_switch !== true
        || Date.parse(measurement.measured_at) > observedAtMs) {
      exactSavings = false;
    }
  }
  const hostCoverage = snapshot.supported_hosts.every((host) => measurementsByHost.has(host))
    && measurementsByHost.size === snapshot.supported_hosts.length;
  gates.push(gate(
    'exact_context_isolation_and_savings',
    hostCoverage && exactSavings,
    hostCoverage && exactSavings
      ? 'every supported host has a live-verified exact-token isolated measurement'
      : 'supported-host exact-token isolation/savings evidence is incomplete',
    {
      supported_hosts: snapshot.supported_hosts.length,
      verified_measurements: verifiedMeasurements,
    },
  ));

  const compatibility = snapshot.effectful_guided_compatibility.status === 'observed'
    ? runLiveVerifier(
      options.effectfulCompatibilityVerifier,
      snapshot.effectful_guided_compatibility,
    )
    : { ok: false, reason: 'effectful_receipt_missing', evidence_hash: null };
  if (compatibility.ok) verificationHashes.push(compatibility.evidence_hash);
  gates.push(gate(
    'effectful_guided_compatibility',
    compatibility.ok,
    compatibility.ok
      ? 'guided compatibility has an independent effectful witness'
      : compatibility.reason,
  ));

  const fallbackVerification = runLiveVerifier(
    options.lifecycleGateVerifier,
    snapshot.fallback_tests,
  );
  if (fallbackVerification.ok) verificationHashes.push(fallbackVerification.evidence_hash);
  const fallbackPassed = Object.values(snapshot.fallback_tests).every((state) => state === 'pass')
    && fallbackVerification.ok;
  gates.push(gate(
    'fallback_expiry_demotion_and_fresh_session',
    fallbackPassed,
    fallbackPassed ? 'all fallback lifecycle tests passed with a live witness'
      : 'fallback lifecycle tests or their live witness are failed/unverified',
  ));

  const assuranceVerification = runLiveVerifier(
    options.assuranceGateVerifier,
    snapshot.assurance_invariance,
  );
  if (assuranceVerification.ok) verificationHashes.push(assuranceVerification.evidence_hash);
  const assurancePassed = Object.values(snapshot.assurance_invariance)
    .every((state) => state === 'pass') && assuranceVerification.ok;
  gates.push(gate(
    'assurance_invariance',
    assurancePassed,
    assurancePassed ? 'high-risk and cross-family assurance stayed invariant'
      : 'assurance invariance is failed or unverified',
  ));

  const receipts = snapshot.dogfood_receipts;
  const distinctTasks = new Set(receipts.map((receipt) => receipt.task_id));
  const distinctSessions = new Set(receipts.map((receipt) => receipt.profile_session_id));
  const receiptIds = receipts.map((receipt) => receipt.receipt_id).sort();
  const taskIds = receipts.map((receipt) => receipt.task_id).sort();
  const expectedReceiptSetHash = sha256(canonicalJson(receiptIds));
  const windowInput = {
    dogfood_window: snapshot.dogfood_window,
    receipt_ids: receiptIds,
    critical_false_passes_attributed_to_reduction:
      snapshot.critical_false_passes_attributed_to_reduction,
  };
  const windowVerification = snapshot.dogfood_window.status === 'observed'
    ? runLiveVerifier(options.dogfoodWindowVerifier, windowInput)
    : { ok: false, reason: 'dogfood_window_missing', evidence_hash: null };
  if (windowVerification.ok) verificationHashes.push(windowVerification.evidence_hash);
  const windowComplete = windowVerification.ok
    && snapshot.dogfood_window.receipt_set_hash === expectedReceiptSetHash
    && canonicalJson(snapshot.dogfood_window.dispatched_task_ids) === canonicalJson(taskIds)
    && snapshot.dogfood_window.dispatched_task_ids.length >= 5
    && Date.parse(snapshot.dogfood_window.ended_at) <= observedAtMs
    && receipts.every((receipt) => (
      Date.parse(receipt.started_at) >= Date.parse(snapshot.dogfood_window.started_at)
      && Date.parse(receipt.completed_at) <= Date.parse(snapshot.dogfood_window.ended_at)
    ));
  gates.push(gate(
    'complete_dogfood_window',
    windowComplete,
    windowComplete
      ? 'live dogfood manifest covers every dispatched task and terminal receipt'
      : 'complete live-verified dogfood window is unavailable',
    {
      dispatched_tasks: snapshot.dogfood_window.dispatched_task_ids.length,
      terminal_receipts: receipts.length,
    },
  ));
  let ownersVerified = receipts.length >= 5
    && distinctTasks.size === receipts.length
    && distinctSessions.size === receipts.length;
  let receiptsVerified = receipts.length >= 5;
  let decorrelated = receipts.length >= 5;
  for (const receipt of receipts) {
    const qualificationFresh = Date.parse(receipt.owner_qualified_at)
        <= Date.parse(receipt.started_at)
      && Date.parse(receipt.owner_qualification_expires_at)
        >= Math.max(Date.parse(receipt.completed_at), observedAtMs);
    const ownerQuery = {
      owner_identity_hash: receipt.owner_identity_hash,
      owner_qualification_receipt_id: receipt.owner_qualification_receipt_id,
      task_id: receipt.task_id,
      profile_session_id: receipt.profile_session_id,
      observed_at: snapshot.observed_at,
    };
    const owner = runLiveVerifier(options.ownerQualificationVerifier, ownerQuery);
    const independent = runLiveVerifier(options.dogfoodReceiptVerifier, receipt);
    if (!owner.ok || !qualificationFresh) ownersVerified = false;
    else verificationHashes.push(owner.evidence_hash);
    if (!independent.ok) receiptsVerified = false;
    else verificationHashes.push(independent.evidence_hash);
    if (receipt.owner_family === receipt.reviewer_family) decorrelated = false;
  }
  gates.push(gate(
    'five_fresh_qualified_owner_dogfoods',
    ownersVerified,
    ownersVerified
      ? 'at least five distinct low-risk autonomous sessions had fresh qualified owners'
      : 'five distinct live-verified fresh-owner dogfood sessions are not available',
    { receipts: receipts.length, distinct_tasks: distinctTasks.size },
  ));
  gates.push(gate(
    'independent_dogfood_receipts',
    receiptsVerified,
    receiptsVerified
      ? 'every dogfood task has a live-verified independent receipt'
      : 'independent dogfood receipt verification is incomplete',
  ));
  const dogfoodAccepted = receipts.length >= 5
    && receipts.every((receipt) => receipt.acceptance_passed);
  gates.push(gate(
    'dogfood_acceptance',
    dogfoodAccepted,
    dogfoodAccepted
      ? 'every dogfood task passed its independent acceptance contract'
      : 'five independently accepted dogfood tasks are not available',
  ));
  gates.push(gate(
    'decorrelated_review',
    decorrelated,
    decorrelated
      ? 'dogfood owner and reviewer families are decorrelated'
      : 'dogfood review-family decorrelation is incomplete',
  ));

  const zeroCritical = snapshot.critical_false_passes_attributed_to_reduction === 0
    && receipts.every((receipt) => (
      receipt.critical_false_pass_attributed_to_reduction === false
    ));
  gates.push(gate(
    'zero_critical_false_pass_from_profile_reduction',
    zeroCritical,
    zeroCritical ? 'no attributable Critical false pass was observed'
      : 'an attributable Critical false pass blocks cutover',
  ));

  const eligible = gates.every((entry) => entry.status === 'pass');
  const guidedTokens = snapshot.context_measurements.reduce(
    (total, entry) => total + entry.guided_control_tokens,
    0,
  );
  const autonomousTokens = snapshot.context_measurements.reduce(
    (total, entry) => total + entry.autonomous_control_tokens,
    0,
  );
  const metrics = {
    source_control_bytes_saved: snapshot.profile_sources.guided.control_bytes
      - snapshot.profile_sources.autonomous.control_bytes,
    exact_guided_control_tokens: snapshot.context_measurements.length > 0
      ? guidedTokens : null,
    exact_autonomous_control_tokens: snapshot.context_measurements.length > 0
      ? autonomousTokens : null,
    exact_control_tokens_saved: snapshot.context_measurements.length > 0
      ? guidedTokens - autonomousTokens : null,
    dogfood_tasks: receipts.length,
    acceptance_passed: receipts.filter((receipt) => receipt.acceptance_passed).length,
    reviewer_catches: receipts.reduce((total, receipt) => total + receipt.reviewer_catches, 0),
    rework_cycles: receipts.reduce((total, receipt) => total + receipt.rework_cycles, 0),
    wall_time_ms: receipts.reduce((total, receipt) => total + receipt.wall_time_ms, 0),
    input_tokens: receipts.reduce((total, receipt) => total + receipt.input_tokens, 0),
    output_tokens: receipts.reduce((total, receipt) => total + receipt.output_tokens, 0),
  };
  const body = {
    schema_version: PROFILE_CUTOVER_SCHEMA_VERSION,
    authority_status: 'advisory_only',
    apply_automatically: false,
    decision: eligible ? 'eligible_to_enable_adaptive' : 'hold_guided',
    current_default: snapshot.project_default,
    recommended_default: eligible ? 'adaptive' : 'guided',
    evaluated_at: snapshot.observed_at,
    snapshot_hash: sha256(canonicalJson(snapshot)),
    gates,
    metrics,
    rollback: {
      setting: 'governance.guidance_profile',
      value: 'guided',
      changes_task_intent: false,
      changes_authority: false,
    },
    verification_evidence_hashes: [...new Set(verificationHashes)].sort(),
  };
  return cloneCanonical({
    ...body,
    decision_id: sha256(canonicalJson(body)),
  });
}

module.exports = {
  EXACT_TOKEN_SOURCE,
  PROFILE_CUTOVER_SCHEMA_VERSION,
  ProfileCutoverError,
  evaluateProfileCutover,
  normalizeProfileCutoverSnapshot,
};
