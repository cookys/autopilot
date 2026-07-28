'use strict';

const crypto = require('crypto');

const OUTCOMES = new Set([
  'success',
  'exit_failure',
  'timeout',
  'quota',
  'unavailable',
  'interrupted',
]);
const ROOT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'request_binding',
  'outcome',
  'output_digests',
  'private_raw_reference',
  'receipt_digest',
]);
const REQUEST_KEYS = new Set(['runner', 'model', 'operation', 'request_digest']);
const OUTCOME_KEYS = new Set(['classification', 'exit_status', 'signal', 'error_code']);
const OUTPUT_DIGEST_KEYS = new Set(['stdout_sha256', 'stderr_sha256']);
const PRIVATE_REFERENCE_KEYS = new Set(['kind', 'locator', 'digest']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
  return output;
}

function digest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  if (!isRecord(value)
      || Object.keys(value).length !== keys.size
      || Object.keys(value).some((key) => !keys.has(key))) {
    throw new TypeError(`${label} must have the exact required fields`);
  }
}

function sha256Value(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`);
  }
  return value;
}

function normalizePrivateRawReference(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.kind !== 'private-file'
      || typeof value.locator !== 'string'
      || value.locator.length === 0
      || Object.keys(value).some((key) => !new Set(['kind', 'locator', 'digest']).has(key))
      || (value.digest !== undefined
        && value.digest !== null
        && !/^[0-9a-f]{64}$/.test(value.digest))) {
    throw new TypeError('privateRawReference must be a private-file locator with an optional digest');
  }
  return {
    kind: value.kind,
    locator: value.locator,
    digest: value.digest || null,
  };
}

function validateRunnerTransportEnvelope(value) {
  exactKeys(value, ROOT_KEYS, 'runner transport envelope');
  if (value.schema_version !== 1 || value.artifact_type !== 'runner_transport_envelope') {
    throw new TypeError('runner transport envelope has an invalid identity');
  }

  exactKeys(value.request_binding, REQUEST_KEYS, 'runner transport request binding');
  const requestBinding = {
    runner: nonEmpty(value.request_binding.runner, 'runner transport runner'),
    model: nonEmpty(value.request_binding.model, 'runner transport model'),
    operation: nonEmpty(value.request_binding.operation, 'runner transport operation'),
    request_digest: sha256Value(
      value.request_binding.request_digest,
      'runner transport request digest',
    ),
  };

  exactKeys(value.outcome, OUTCOME_KEYS, 'runner transport outcome');
  if (!OUTCOMES.has(value.outcome.classification)
      || (value.outcome.exit_status !== null
        && !Number.isInteger(value.outcome.exit_status))
      || (value.outcome.signal !== null && typeof value.outcome.signal !== 'string')
      || (value.outcome.error_code !== null && typeof value.outcome.error_code !== 'string')) {
    throw new TypeError('runner transport outcome has an invalid value');
  }
  if (value.outcome.classification === 'success'
      && (value.outcome.exit_status !== 0
        || value.outcome.signal !== null
        || value.outcome.error_code !== null)) {
    throw new TypeError('successful runner transport outcome has contradictory fields');
  }
  const outcome = {
    classification: value.outcome.classification,
    exit_status: value.outcome.exit_status,
    signal: value.outcome.signal,
    error_code: value.outcome.error_code,
  };

  exactKeys(value.output_digests, OUTPUT_DIGEST_KEYS, 'runner transport output digests');
  const outputDigests = {
    stdout_sha256: sha256Value(
      value.output_digests.stdout_sha256,
      'runner transport stdout digest',
    ),
    stderr_sha256: sha256Value(
      value.output_digests.stderr_sha256,
      'runner transport stderr digest',
    ),
  };

  if (value.private_raw_reference !== null) {
    exactKeys(
      value.private_raw_reference,
      PRIVATE_REFERENCE_KEYS,
      'runner transport private raw reference',
    );
  }
  const privateRawReference = normalizePrivateRawReference(value.private_raw_reference);
  const body = {
    schema_version: 1,
    artifact_type: 'runner_transport_envelope',
    request_binding: requestBinding,
    outcome,
    output_digests: outputDigests,
    private_raw_reference: privateRawReference,
  };
  const receiptDigest = sha256Value(
    value.receipt_digest,
    'runner transport receipt digest',
  );
  if (digest(body) !== receiptDigest) {
    throw new TypeError('runner transport receipt digest does not match its content');
  }
  return {
    ...body,
    receipt_digest: receiptDigest,
  };
}

function classifyOutcome(child, hints = {}) {
  if (hints.quota === true) return 'quota';
  if (hints.unavailable === true) return 'unavailable';
  if (hints.timedOut === true || (child.error && child.error.code === 'ETIMEDOUT')) {
    return 'timeout';
  }
  if (child.signal) return 'interrupted';
  if (child.error) return 'unavailable';
  return child.status === 0 ? 'success' : 'exit_failure';
}

function createRunnerTransportEnvelope(input = {}) {
  const child = input.child && typeof input.child === 'object' ? input.child : {};
  const runner = nonEmpty(input.runner, 'runner');
  const model = nonEmpty(input.model, 'model');
  const operation = nonEmpty(input.operation, 'operation');
  const argv = Array.isArray(input.argv) && input.argv.every((item) => typeof item === 'string')
    ? [...input.argv]
    : (() => { throw new TypeError('argv must be an array of strings'); })();
  const cwd = nonEmpty(input.cwd, 'cwd');
  const classification = classifyOutcome(child, input.outcomeHints);
  if (!OUTCOMES.has(classification)) {
    throw new TypeError(`unsupported transport outcome: ${classification}`);
  }
  const stdout = Buffer.isBuffer(child.stdout)
    ? child.stdout
    : Buffer.from(String(child.stdout || ''), 'utf8');
  const stderr = Buffer.isBuffer(child.stderr)
    ? child.stderr
    : Buffer.from(String(child.stderr || ''), 'utf8');
  const body = {
    schema_version: 1,
    artifact_type: 'runner_transport_envelope',
    request_binding: {
      runner,
      model,
      operation,
      request_digest: digest({ argv, cwd }),
    },
    outcome: {
      classification,
      exit_status: Number.isInteger(child.status) ? child.status : null,
      signal: typeof child.signal === 'string' ? child.signal : null,
      error_code: child.error && typeof child.error.code === 'string'
        ? child.error.code
        : null,
    },
    output_digests: {
      stdout_sha256: sha256(stdout),
      stderr_sha256: sha256(stderr),
    },
    private_raw_reference: normalizePrivateRawReference(input.privateRawReference),
  };
  return {
    ...body,
    receipt_digest: digest(body),
  };
}

module.exports = {
  OUTCOMES,
  classifyOutcome,
  createRunnerTransportEnvelope,
  validateRunnerTransportEnvelope,
};
