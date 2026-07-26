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

function normalizePrivateRawReference(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.kind !== 'private-file'
      || typeof value.locator !== 'string'
      || value.locator.length === 0
      || Object.keys(value).some((key) => !new Set(['kind', 'locator', 'digest']).has(key))
      || (value.digest !== undefined && !/^[0-9a-f]{64}$/.test(value.digest))) {
    throw new TypeError('privateRawReference must be a private-file locator with an optional digest');
  }
  return {
    kind: value.kind,
    locator: value.locator,
    digest: value.digest || null,
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
};
