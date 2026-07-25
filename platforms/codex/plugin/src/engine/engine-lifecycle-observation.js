'use strict';

const fs = require('fs');

const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');

const ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION = 1;
const OBSERVABLE_LEGACY_LEVELS = new Set(['l5', 'l6']);
const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const OBSERVABLE_ENGINE_UNITS = new Set([
  'classify_diff_risk',
  'dispatch_implementation',
  'dispatch_review',
  'engine_unavailable_policy',
  'prepare_implementation',
  'prepare_implementation_loop',
  'prepare_review',
  'ratchet_select',
  'resolve_roster',
  'resume_implementation',
  'resume_precheck',
  'reviewer_family',
  'reviewer_family_fallback',
  'reviewer_qualification',
  'tier_reviewer_unqualified',
  'verify_first_signal',
  'verify_round',
]);
const OBSERVABLE_ENGINE_STATUSES = new Set([
  'blocked',
  'branch_update_blocked',
  'classified',
  'committed',
  'dirty',
  'engine_unavailable',
  'escalate',
  'failed',
  'failure',
  'misplaced_writes',
  'no_op',
  'no_verdict',
  'passed',
  'precondition_failed',
  'question_suspected',
  'resolved',
  'resumed',
  'resume_invalid',
  'reviewed',
  'reverted',
  'selected',
  'solo-fallback',
  'unknown',
  'unused',
  'wait-reset',
]);
const OBSERVABLE_TERMINAL_STATUSES = new Set(['blocked', 'converged', 'non_converged']);

const OBSERVATION_DISCLOSURE = Object.freeze({
  owner_kernel_authority: 'none',
  legacy_execution_authority: 'unchanged',
  acceptance: 'not_available',
  alias_retirement_eligible: false,
  observation_assurance: 'unverified_host_observation_not_eligible_for_alias_retirement',
});

function observationError(message, code = 'INVALID_ENGINE_LIFECYCLE_OBSERVATION') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw observationError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw observationError(`${label} must be a plain object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw observationError(`${label} has unsupported key "${key}"`);
    }
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw observationError(`${label} must match ${TOKEN_PATTERN}`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw observationError(`${label} must be a positive integer`);
  }
  return value;
}

function normalizeEngineLifecycleObservationConfig(raw) {
  const value = assertPlainObject(raw, 'lifecycleObservation');
  assertOnlyKeys(value, new Set([
    'engineRunId',
    'invocationId',
    'legacyLevel',
    'policyHash',
  ]), 'lifecycleObservation');
  const engineRunId = requireToken(value.engineRunId, 'lifecycleObservation.engineRunId');
  const invocationId = requireToken(value.invocationId, 'lifecycleObservation.invocationId');
  if (typeof value.legacyLevel !== 'string' || !OBSERVABLE_LEGACY_LEVELS.has(value.legacyLevel)) {
    throw observationError('lifecycleObservation.legacyLevel must be l5 or l6');
  }
  if (!isSha256(value.policyHash)) {
    throw observationError('lifecycleObservation.policyHash must be a SHA-256 digest');
  }
  return Object.freeze({
    engine_run_id: engineRunId,
    invocation_id: invocationId,
    legacy_level: value.legacyLevel,
    policy_hash: value.policyHash.toLowerCase(),
  });
}

function assertLifecycleObserver(observer) {
  if (!observer || typeof observer !== 'object' || Array.isArray(observer)) {
    throw observationError('lifecycleObserver must be an object');
  }
  const value = observer;
  for (const method of ['open', 'appendIfHead', 'close']) {
    if (typeof value[method] !== 'function') {
      throw observationError(`lifecycleObserver.${method} must be a function`);
    }
  }
  return value;
}

function normalizeObservationReceipt(raw, expected, label, { allowNullHead = false } = {}) {
  const value = assertPlainObject(raw, label);
  const expectedKeys = Object.keys(expected);
  assertOnlyKeys(value, new Set([...expectedKeys, 'observation_head']), label);
  for (const key of expectedKeys) {
    if (value[key] !== expected[key]) {
      throw observationError(`${label}.${key} does not match the request`);
    }
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'observation_head')) {
    throw observationError(`${label} requires observation_head`);
  }
  if (value.observation_head === null && allowNullHead) {
    return null;
  }
  if (!isSha256(value.observation_head)) {
    throw observationError(`${label}.observation_head must be a SHA-256 digest`);
  }
  return value.observation_head.toLowerCase();
}

function hashText(value) {
  return sha256(typeof value === 'string' ? value : '');
}

function copyKnownOrHash(record, key, value, allowed) {
  if (typeof value === 'string' && allowed.has(value)) {
    record[key] = value;
    return;
  }
  record[key] = 'unknown';
  record[`${key}_hash`] = hashText(value);
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && /Z$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function copyInteger(record, entry, key, { minimum = 0 } = {}) {
  if (Number.isInteger(entry[key]) && entry[key] >= minimum) {
    record[key] = entry[key];
  }
}

function copyNullableInteger(record, entry, key) {
  if (entry[key] === null || (Number.isInteger(entry[key]) && entry[key] >= 0)) {
    record[key] = entry[key];
  }
}

function copyBoolean(record, entry, key) {
  if (typeof entry[key] === 'boolean') record[key] = entry[key];
}

function copyGitSha(record, entry, key) {
  if (typeof entry[key] === 'string' && GIT_SHA_PATTERN.test(entry[key])) {
    record[key] = entry[key].toLowerCase();
  }
}

function sanitizeEngineLedgerEntry(raw) {
  const entry = assertPlainObject(raw, 'AutopilotEngine ledger entry');
  const record = {
    schema_version: ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
    record_type: 'engine_ledger_entry',
    entry_hash: sha256(canonicalJson(entry)),
  };
  copyKnownOrHash(record, 'unit', entry.unit, OBSERVABLE_ENGINE_UNITS);
  copyKnownOrHash(record, 'status', entry.status, OBSERVABLE_ENGINE_STATUSES);
  if (isIsoTimestamp(entry.started_at)) record.started_at = new Date(entry.started_at).toISOString();
  if (isIsoTimestamp(entry.ended_at)) record.ended_at = new Date(entry.ended_at).toISOString();

  copyInteger(record, entry, 'round', { minimum: 0 });
  copyInteger(record, entry, 'best_round', { minimum: 0 });
  copyInteger(record, entry, 'wall_secs', { minimum: 0 });
  for (const key of [
    'exit_status',
    'setup_exit_status',
    'cleanup_exit_status',
    'branch_update_exit_status',
  ]) {
    copyNullableInteger(record, entry, key);
  }
  for (const key of [
    'verify_pass',
    'ratchet_reverted',
    'reviewer_qualified',
    'reconcile_by_ledger',
    'contained',
  ]) {
    copyBoolean(record, entry, key);
  }
  for (const key of ['base', 'commit', 'selected_commit', 'best_commit']) {
    copyGitSha(record, entry, key);
  }
  for (const key of ['runner', 'model', 'run_id', 'usage', 'branch', 'misplaced_write_evidence']) {
    if (Object.prototype.hasOwnProperty.call(entry, key) && entry[key] !== null && entry[key] !== undefined) {
      record[`${key}_hash`] = sha256(canonicalJson(entry[key]));
    }
  }
  return cloneCanonical(record);
}

function sanitizeImplementationResult(result, round) {
  const implementation = result && result.implementation && typeof result.implementation === 'object'
    ? result.implementation
    : null;
  const record = {
    schema_version: ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
    record_type: 'implementation_outcome',
    round: requirePositiveInteger(round, 'implementation observation round'),
    phase_hash: hashText(result && result.phase),
  };
  copyKnownOrHash(record, 'dispatch_status', result && result.status, OBSERVABLE_ENGINE_STATUSES);
  if (!implementation) return cloneCanonical(record);
  if (typeof implementation.runner === 'string') record.runner_hash = hashText(implementation.runner);
  if (typeof implementation.model === 'string') record.model_hash = hashText(implementation.model);
  if (typeof implementation.run_id === 'string') record.run_id_hash = hashText(implementation.run_id);
  if (typeof implementation.usage !== 'undefined') record.usage_hash = sha256(canonicalJson(implementation.usage));
  if (Number.isInteger(implementation.wall_secs) && implementation.wall_secs >= 0) {
    record.wall_secs = implementation.wall_secs;
  }
  for (const key of ['base', 'commit']) copyGitSha(record, implementation, key);
  for (const key of ['files_changed', 'insertions', 'deletions']) {
    copyInteger(record, implementation, key);
  }
  copyBoolean(record, implementation, 'contained');
  if (typeof implementation.containment === 'string') record.containment_hash = hashText(implementation.containment);
  return cloneCanonical(record);
}

function sanitizeReviewResult(result, round) {
  const review = result && result.review && typeof result.review === 'object' ? result.review : null;
  const record = {
    schema_version: ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
    record_type: 'review_outcome',
    round: requirePositiveInteger(round, 'review observation round'),
    phase_hash: hashText(result && result.phase),
  };
  copyKnownOrHash(record, 'dispatch_status', result && result.status, OBSERVABLE_ENGINE_STATUSES);
  if (!review) return cloneCanonical(record);
  if (typeof review.runner === 'string') record.runner_hash = hashText(review.runner);
  if (typeof review.model === 'string') record.model_hash = hashText(review.model);
  copyKnownOrHash(record, 'review_status', review.status, OBSERVABLE_ENGINE_STATUSES);
  if (review.verdict === 'SHIP-AS-IS' || review.verdict === 'FIX-THEN-SHIP' || review.verdict === null) {
    record.verdict = review.verdict;
  }
  if (typeof review.findings === 'string') record.findings_hash = hashText(review.findings);
  if (typeof review.raw_log === 'string') record.raw_log_hash = hashText(review.raw_log);
  if (typeof review.error === 'string') record.error_hash = hashText(review.error);
  return cloneCanonical(record);
}

function terminalKind(status) {
  if (status === 'converged') return 'engine_converged';
  if (status === 'non_converged') return 'engine_non_converged';
  return 'engine_blocked';
}

function sanitizeTerminalResult(result) {
  const status = typeof result.status === 'string' && OBSERVABLE_TERMINAL_STATUSES.has(result.status)
    ? result.status
    : 'unknown';
  const record = {
    schema_version: ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
    record_type: 'engine_terminal',
    terminal: terminalKind(status),
    status,
    phase_hash: hashText(result.phase),
    result_hash: sha256(canonicalJson({
      status,
      phase: typeof result.phase === 'string' ? result.phase : null,
      rounds: Number.isInteger(result.rounds) ? result.rounds : null,
      verdict: result.verdict === 'SHIP-AS-IS' || result.verdict === 'FIX-THEN-SHIP' || result.verdict === null
        ? result.verdict
        : null,
    })),
    ...OBSERVATION_DISCLOSURE,
  };
  if (Number.isInteger(result.rounds) && result.rounds >= 0) record.rounds = result.rounds;
  if (result.verdict === 'SHIP-AS-IS' || result.verdict === 'FIX-THEN-SHIP' || result.verdict === null) {
    record.verdict = result.verdict;
  }
  return cloneCanonical(record);
}

function promptHash(promptFile) {
  if (typeof promptFile !== 'string' || promptFile.length === 0) {
    throw observationError('promptFile is required for lifecycle observation');
  }
  return sha256(fs.readFileSync(promptFile, 'utf8'));
}

class EngineLifecycleObservationSession {
  constructor({ observer, config, promptFile, base, branch, verifyCmd, expectedEngineRunId } = {}) {
    this.observer = observer;
    this.config = config;
    this.promptFile = promptFile;
    this.base = base;
    this.branch = branch;
    this.verifyCmd = verifyCmd;
    this.expectedEngineRunId = expectedEngineRunId;
    this.head = null;
    this.seenHeads = new Set();
    this.sequence = 0;
    this.entryCount = 0;
    this.state = 'not_started';
    this.failureStage = null;
    this.terminalRecorded = false;
    this.finalized = false;
    this.detachLedger = null;
  }

  fail(stage) {
    this.failureStage = stage;
    this.state = this.state === 'open' || this.sequence > 0 || this.entryCount > 0 ? 'partial' : 'failed';
  }

  start() {
    try {
      this.config = normalizeEngineLifecycleObservationConfig(this.config);
      this.observer = assertLifecycleObserver(this.observer);
      if (this.expectedEngineRunId !== undefined && this.expectedEngineRunId !== null) {
        const expectedRunId = requireToken(this.expectedEngineRunId, 'runImplementationReviewLoop.runId');
        if (this.config.engine_run_id !== expectedRunId) {
          throw observationError('lifecycleObservation.engineRunId must match runImplementationReviewLoop.runId');
        }
      }
      if (typeof this.base !== 'string' || !GIT_SHA_PATTERN.test(this.base)) {
        throw observationError('lifecycle observation requires an immutable 40-character base SHA');
      }
      if (typeof this.branch !== 'string' || this.branch.length === 0) {
        throw observationError('lifecycle observation requires a branch');
      }
      const envelope = {
        schema_version: ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
        record_type: 'engine_lifecycle_open',
        ...this.config,
        base: this.base.toLowerCase(),
        branch_hash: hashText(this.branch),
        prompt_hash: promptHash(this.promptFile),
        ...(typeof this.verifyCmd === 'string' ? { verify_command_hash: hashText(this.verifyCmd) } : {}),
        ...OBSERVATION_DISCLOSURE,
      };
      const envelopeHash = sha256(canonicalJson(envelope));
      const response = this.observer.open({
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        envelope: cloneCanonical(envelope),
        envelope_hash: envelopeHash,
      });
      this.head = normalizeObservationReceipt(response, {
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        envelope_hash: envelopeHash,
      }, 'lifecycleObserver.open response', { allowNullHead: true });
      if (this.head !== null) this.seenHeads.add(this.head);
      this.state = 'open';
    } catch (_error) {
      this.fail('open');
    }
  }

  append(record) {
    if (this.state !== 'open') return;
    try {
      const normalized = cloneCanonical(record);
      const sequence = this.sequence + 1;
      const recordHash = sha256(canonicalJson(normalized));
      const previousHead = this.head;
      const response = this.observer.appendIfHead({
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        sequence,
        expected_observation_head: previousHead,
        record: normalized,
        record_hash: recordHash,
      });
      const nextHead = normalizeObservationReceipt(response, {
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        sequence,
        previous_observation_head: previousHead,
        record_hash: recordHash,
      }, 'lifecycleObserver.appendIfHead response');
      this.advanceHead(nextHead, 'lifecycleObserver.appendIfHead');
      this.sequence = sequence;
      this.entryCount += 1;
    } catch (_error) {
      this.fail('append');
    }
  }

  advanceHead(nextHead, operation) {
    if (nextHead === this.head) {
      throw observationError(`${operation} did not advance the observation head`);
    }
    if (this.seenHeads.has(nextHead)) {
      throw observationError(`${operation} replayed an earlier observation head`);
    }
    this.seenHeads.add(nextHead);
    this.head = nextHead;
  }

  observe(sanitizer) {
    if (this.state !== 'open') return;
    try {
      this.append(sanitizer());
    } catch (_error) {
      this.fail('append');
    }
  }

  observeLedgerEntry(entry) {
    this.observe(() => sanitizeEngineLedgerEntry(entry));
  }

  observeImplementationResult(result, round) {
    this.observe(() => sanitizeImplementationResult(result, round));
  }

  observeReviewResult(result, round) {
    this.observe(() => sanitizeReviewResult(result, round));
  }

  attach(ledger) {
    if (!Array.isArray(ledger) || this.detachLedger) return;
    try {
      const originalPush = ledger.push;
      const session = this;
      Object.defineProperty(ledger, 'push', {
        configurable: true,
        enumerable: false,
        writable: true,
        value(...entries) {
          const length = originalPush.apply(this, entries);
          for (const entry of entries) session.observeLedgerEntry(entry);
          return length;
        },
      });
      this.detachLedger = () => {
        delete ledger.push;
        this.detachLedger = null;
      };
    } catch (_error) {
      this.fail('attach');
    }
  }

  close(result) {
    if (this.state !== 'open' || this.terminalRecorded) return;
    try {
      const terminal = sanitizeTerminalResult(result);
      const sequence = this.sequence + 1;
      const terminalHash = sha256(canonicalJson(terminal));
      const previousHead = this.head;
      const response = this.observer.close({
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        sequence,
        expected_observation_head: previousHead,
        terminal,
        terminal_hash: terminalHash,
      });
      const nextHead = normalizeObservationReceipt(response, {
        engine_run_id: this.config.engine_run_id,
        invocation_id: this.config.invocation_id,
        sequence,
        previous_observation_head: previousHead,
        terminal_hash: terminalHash,
      }, 'lifecycleObserver.close response');
      this.advanceHead(nextHead, 'lifecycleObserver.close');
      this.sequence = sequence;
      this.terminalRecorded = true;
      this.state = 'observed';
    } catch (_error) {
      this.fail('close');
    }
  }

  snapshot() {
    return cloneCanonical({
      status: this.state,
      entry_count: this.entryCount,
      terminal_recorded: this.terminalRecorded,
      ...(this.failureStage ? { failure_stage: this.failureStage } : {}),
      ...OBSERVATION_DISCLOSURE,
    });
  }

  finalize(result) {
    if (!this.finalized) {
      this.close(result);
      try {
        if (this.detachLedger) this.detachLedger();
      } catch (_error) {
        this.fail('detach');
      }
      this.finalized = true;
    }
    return {
      ...result,
      lifecycle_observation: this.snapshot(),
    };
  }
}

function createEngineLifecycleObservationSession(options = {}) {
  if (!Object.prototype.hasOwnProperty.call(options, 'config') || options.config === undefined) {
    return null;
  }
  const session = new EngineLifecycleObservationSession(options);
  session.start();
  return session;
}

module.exports = {
  ENGINE_LIFECYCLE_OBSERVATION_SCHEMA_VERSION,
  OBSERVATION_DISCLOSURE,
  EngineLifecycleObservationSession,
  createEngineLifecycleObservationSession,
  normalizeEngineLifecycleObservationConfig,
};
