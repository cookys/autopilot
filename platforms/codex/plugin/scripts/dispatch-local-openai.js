#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  egressDecision,
  normalizeTaskAuthorityEnvelope,
} = require('../src/engine/owner-kernel/task-authority');
const {
  DEFAULT_ROSTER,
  LocalDeploymentError,
  acquireEndpointLease,
  acquireRuntimeIdentity,
  assertCapacityHeadroom,
  findRosterEndpoint,
  fingerprintRuntime,
  loadLocalEngineRoster,
  observeCapacity,
  requestJson,
  resolveEndpointCredential,
} = require('../src/engine/local-deployment');
const {
  appendRow,
  ensureDir,
  withWriteLock,
} = require('./lib/jsonl-store');

const MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TELEMETRY = path.join(
  os.homedir(),
  '.autopilot',
  'local-engines',
  'telemetry.jsonl',
);
const RISKS = new Set(['low', 'medium', 'high', 'protected']);
const ROLES = new Set(['author', 'reviewer']);

const HELP = `Usage:
  node scripts/dispatch-local-openai.js run
    --endpoint <id> --role <author|reviewer> --prompt-file <path>
    --envelope <task-authority-envelope.json> --risk <low|medium|high|protected>
    [--roster <path>] [--telemetry <path>] [--lease-dir <path>]

This is a raw author/reviewer transport only. It exposes no repository tools and sends no tool
definitions. The exact TaskAuthorityEnvelope egress tuple must allow the request. The adapter
acquires a one-slot Autopilot lease, checks live capacity, binds identity before and after the
generation, requires exact response model/request identity, and verifies resource recovery.
On timeout or ambiguous transport failure it requires server cancellation acknowledgement plus
queue/memory recovery; otherwise the endpoint is quarantined. Telemetry is metadata-only.

CLI dispatch cannot reconstruct qualified local assurance from disk, so high/protected work
fails closed. A trusted host may call runLocalDispatch with a live localAssuranceVerifier.
`;

function parseArgs(argv) {
  if (!argv[2] || ['help', '--help', '-h'].includes(argv[2])) return { help: true };
  if (argv[2] !== 'run') {
    throw new LocalDeploymentError(`unknown command: ${argv[2]}`, 'INVALID_ARGUMENT');
  }
  const options = {
    rosterPath: DEFAULT_ROSTER,
    telemetryPath: DEFAULT_TELEMETRY,
    leaseDir: null,
  };
  const names = new Map([
    ['--endpoint', 'endpointId'],
    ['--role', 'role'],
    ['--prompt-file', 'promptFile'],
    ['--envelope', 'envelopeFile'],
    ['--risk', 'risk'],
    ['--roster', 'rosterPath'],
    ['--telemetry', 'telemetryPath'],
    ['--lease-dir', 'leaseDir'],
  ]);
  for (let index = 3; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) {
      throw new LocalDeploymentError(
        `unknown argument: ${argv[index]}`,
        'INVALID_ARGUMENT',
      );
    }
    if (index + 1 >= argv.length) {
      throw new LocalDeploymentError(`${argv[index]} requires a value`, 'INVALID_ARGUMENT');
    }
    options[name] = argv[++index];
  }
  for (const name of ['endpointId', 'role', 'promptFile', 'envelopeFile', 'risk']) {
    if (!options[name]) {
      throw new LocalDeploymentError(
        `--${name.replace(/[A-Z]/gu, (value) => `-${value.toLowerCase()}`)} is required`,
        'INVALID_ARGUMENT',
      );
    }
  }
  if (!ROLES.has(options.role)) {
    throw new LocalDeploymentError('--role must be author or reviewer', 'INVALID_ARGUMENT');
  }
  if (!RISKS.has(options.risk)) {
    throw new LocalDeploymentError('--risk is invalid', 'INVALID_ARGUMENT');
  }
  return options;
}

function readRegularFile(file, label, maximumBytes = null) {
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    throw new LocalDeploymentError(
      `${label} is unavailable: ${error.code || error.message}`,
      'INPUT_UNAVAILABLE',
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new LocalDeploymentError(`${label} must be a regular file`, 'INPUT_UNTRUSTED');
  }
  if (maximumBytes !== null && (stat.size === 0 || stat.size > maximumBytes)) {
    throw new LocalDeploymentError(
      `${label} must contain 1..${maximumBytes} bytes`,
      'INPUT_SIZE_INVALID',
    );
  }
  return fs.readFileSync(resolved, 'utf8');
}

function readEnvelope(file) {
  let parsed;
  try {
    parsed = JSON.parse(readRegularFile(file, 'task authority envelope'));
  } catch (error) {
    if (error instanceof LocalDeploymentError) throw error;
    throw new LocalDeploymentError(
      `task authority envelope is invalid JSON: ${error.message}`,
      'INVALID_AUTHORITY_ENVELOPE',
    );
  }
  try {
    return normalizeTaskAuthorityEnvelope(parsed.envelope || parsed);
  } catch (error) {
    throw new LocalDeploymentError(
      `task authority envelope is invalid: ${error.message}`,
      'INVALID_AUTHORITY_ENVELOPE',
    );
  }
}

function egressRequest(endpoint, role) {
  return Object.freeze({
    data_class: role === 'reviewer' ? 'diff' : 'task_prompt',
    route_class: role === 'reviewer' ? 'reviewer' : 'runner',
    destination: `local:${endpoint.id}`,
    transport: 'local:openai-compatible',
    payload_classification: role === 'reviewer' ? 'source' : 'task',
  });
}

function enforceEgress(envelope, endpoint, role) {
  const request = egressRequest(endpoint, role);
  if (egressDecision(envelope.data_egress_policy, request) !== 'allow') {
    throw new LocalDeploymentError(
      'TaskAuthorityEnvelope denies the exact local endpoint egress tuple',
      'EGRESS_DENIED',
    );
  }
  return request;
}

function verifyHighRiskAssurance(options, endpoint, fingerprints) {
  if (!['high', 'protected'].includes(options.risk)) return null;
  if (typeof options.localAssuranceVerifier !== 'function') {
    throw new LocalDeploymentError(
      'high-risk local-only work requires a live qualified local assurance verifier',
      'LOCAL_ASSURANCE_REQUIRED',
    );
  }
  const request = Object.freeze({
    endpoint_id: endpoint.id,
    role: options.role,
    risk: options.risk,
    semantic_fingerprint: fingerprints.semantic_fingerprint,
    operational_fingerprint: fingerprints.operational_fingerprint,
  });
  const receipt = options.localAssuranceVerifier(request);
  if (!receipt || receipt.ok !== true || receipt.capability_state !== 'qualified'
      || receipt.endpoint_id !== endpoint.id
      || receipt.role !== options.role
      || receipt.semantic_fingerprint !== fingerprints.semantic_fingerprint
      || receipt.operational_fingerprint !== fingerprints.operational_fingerprint) {
    throw new LocalDeploymentError(
      'live local assurance verifier rejected the exact deployment',
      'LOCAL_ASSURANCE_REJECTED',
    );
  }
  return Object.freeze({
    receipt_hash: sha256(canonicalJson(receipt)),
    capability_state: 'qualified',
  });
}

function chatRequest(endpoint, role, prompt, requestId) {
  return Object.freeze({
    model: endpoint.model,
    max_tokens: endpoint.max_tokens,
    stream: false,
    messages: [
      {
        role: 'system',
        content: role === 'reviewer'
          ? 'Review the supplied text. Return review text only. Do not call tools.'
          : 'Produce the requested artifact text only. Do not call tools.',
      },
      { role: 'user', content: prompt },
    ],
    metadata: {
      autopilot_request_id: requestId,
      autopilot_role: role,
    },
  });
}

function parseChatResponse(raw, endpoint, requestId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || raw.model !== endpoint.model || raw.request_id !== requestId
      || !Array.isArray(raw.choices) || raw.choices.length !== 1) {
    throw new LocalDeploymentError(
      'local generation response lacks exact model/request identity',
      'GENERATION_IDENTITY_MISMATCH',
    );
  }
  const message = raw.choices[0] && raw.choices[0].message;
  const toolCalls = message && message.tool_calls;
  const functionCall = message && message.function_call;
  if (!message || typeof message.content !== 'string' || message.content.length === 0
      || (toolCalls !== undefined && toolCalls !== null
        && (!Array.isArray(toolCalls) || toolCalls.length > 0))
      || (functionCall !== undefined && functionCall !== null)) {
    throw new LocalDeploymentError(
      'local generation response is not raw tool-free text',
      'GENERATION_PROTOCOL_ERROR',
    );
  }
  return Object.freeze({
    content: message.content,
    responseHash: sha256(canonicalJson(raw)),
    usage: raw.usage && typeof raw.usage === 'object' ? {
      prompt_tokens: Number.isSafeInteger(raw.usage.prompt_tokens)
        ? raw.usage.prompt_tokens : null,
      completion_tokens: Number.isSafeInteger(raw.usage.completion_tokens)
        ? raw.usage.completion_tokens : null,
    } : { prompt_tokens: null, completion_tokens: null },
  });
}

function capacityRecovered(baseline, current, endpoint) {
  return current.active_requests <= baseline.active_requests
    && current.queue_depth <= baseline.queue_depth
    && current.available_memory_bytes >= baseline.available_memory_bytes
    && current.available_memory_bytes >= endpoint.min_headroom_bytes;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForRecovery(endpoint, credential, baseline) {
  const deadline = Date.now() + endpoint.recovery_timeout_ms;
  let latest = null;
  while (Date.now() <= deadline) {
    const observed = await observeCapacity(endpoint, credential);
    latest = observed.observation;
    if (capacityRecovered(baseline, latest, endpoint)) return latest;
    await sleep(50);
  }
  const error = new LocalDeploymentError(
    'local endpoint did not recover queue/resource state',
    'RESOURCE_RECOVERY_UNCONFIRMED',
  );
  error.latestCapacity = latest;
  throw error;
}

async function cancelAndRecover(endpoint, credential, requestId, baseline) {
  if (!endpoint.cancel_path) {
    throw new LocalDeploymentError(
      'local endpoint exposes no cancellation acknowledgement path',
      'CANCELLATION_UNCONFIRMED',
    );
  }
  let response;
  try {
    response = await requestJson({
      baseUrl: credential.baseUrl,
      path: endpoint.cancel_path,
      method: 'POST',
      body: { request_id: requestId },
      token: credential.token,
      timeoutMs: endpoint.recovery_timeout_ms,
    });
  } catch {
    throw new LocalDeploymentError(
      'local endpoint cancellation request was not acknowledged',
      'CANCELLATION_UNCONFIRMED',
    );
  }
  const value = response.value;
  if (!value || value.schema_version !== 1 || value.request_id !== requestId
      || value.cancelled !== true || value.queue_released !== true) {
    throw new LocalDeploymentError(
      'local endpoint returned an invalid cancellation acknowledgement',
      'CANCELLATION_UNCONFIRMED',
    );
  }
  const capacity = await waitForRecovery(endpoint, credential, baseline);
  return Object.freeze({
    acknowledgement_hash: sha256(canonicalJson(value)),
    recovered_capacity_hash: sha256(canonicalJson(capacity)),
  });
}

function telemetryConfig(file) {
  const resolved = path.resolve(file || DEFAULT_TELEMETRY);
  return {
    storeFile: resolved,
    storeDir: path.dirname(resolved),
    lockFile: `${resolved}.lock`,
  };
}

function writeTelemetry(file, row) {
  const config = telemetryConfig(file);
  ensureDir(config.storeDir);
  withWriteLock({
    ...config,
    name: 'local engine telemetry',
  }, () => appendRow(config.storeFile, row));
}

function telemetryRow(context) {
  return Object.freeze({
    schema_version: 1,
    observed_at: new Date().toISOString(),
    endpoint_id: context.endpoint.id,
    role: context.role,
    risk: context.risk,
    status: context.status,
    reason: context.reason || null,
    semantic_fingerprint: context.fingerprints.semantic_fingerprint,
    operational_fingerprint: context.fingerprints.operational_fingerprint,
    request_hash: context.requestHash,
    response_hash: context.responseHash || null,
    prompt_bytes: context.promptBytes,
    response_bytes: context.responseBytes || 0,
    prompt_tokens: context.usage ? context.usage.prompt_tokens : null,
    completion_tokens: context.usage ? context.usage.completion_tokens : null,
    wall_time_ms: context.wallTimeMs,
    cancellation_receipt_hash: context.cancellationReceiptHash || null,
    bodies_persisted: false,
    resource_scope: 'autopilot_only',
  });
}

async function runLocalDispatch(options) {
  const started = Date.now();
  if (!options || typeof options !== 'object' || Array.isArray(options)
      || !ROLES.has(options.role) || !RISKS.has(options.risk)
      || typeof options.endpointId !== 'string' || options.endpointId.length === 0) {
    throw new LocalDeploymentError(
      'local dispatch requires an exact endpoint, role, and risk',
      'INVALID_ARGUMENT',
    );
  }
  const rosterRecord = loadLocalEngineRoster(options.rosterPath || DEFAULT_ROSTER);
  const endpoint = findRosterEndpoint(rosterRecord, options.endpointId);
  if (!endpoint.roles.includes(options.role)) {
    throw new LocalDeploymentError(
      `local endpoint is not allowlisted for role ${options.role}`,
      'ROLE_NOT_ALLOWLISTED',
    );
  }
  if (!endpoint.chat_path || !endpoint.capacity_path || !endpoint.cancel_path) {
    throw new LocalDeploymentError(
      'local endpoint lacks the dispatch/cancel/capacity control contract',
      'ENDPOINT_NOT_DISPATCH_ELIGIBLE',
    );
  }
  const envelope = options.envelope
    ? normalizeTaskAuthorityEnvelope(options.envelope)
    : readEnvelope(options.envelopeFile);
  const egress = enforceEgress(envelope, endpoint, options.role);
  const prompt = options.prompt === undefined
    ? readRegularFile(options.promptFile, 'prompt file', MAX_PROMPT_BYTES)
    : options.prompt;
  if (typeof prompt !== 'string' || Buffer.byteLength(prompt) < 1
      || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
    throw new LocalDeploymentError('prompt is empty or too large', 'INPUT_SIZE_INVALID');
  }
  const credential = resolveEndpointCredential(endpoint, options);
  const preIdentity = await acquireRuntimeIdentity(endpoint, credential);
  const fingerprints = fingerprintRuntime(endpoint, preIdentity.identity);
  const assurance = verifyHighRiskAssurance(options, endpoint, fingerprints);
  const lease = acquireEndpointLease(endpoint, fingerprints.operational_fingerprint, {
    leaseDir: options.leaseDir,
  });
  const requestId = crypto.randomBytes(24).toString('hex');
  const request = chatRequest(endpoint, options.role, prompt, requestId);
  const requestHash = sha256(canonicalJson(request));
  let baseline;
  let responseHash = null;
  let responseBytes = 0;
  let usage = null;
  let cancellation = null;
  let status = 'failed';
  let reason = null;
  try {
    const capacity = await observeCapacity(endpoint, credential);
    baseline = capacity.observation;
    assertCapacityHeadroom(endpoint, baseline);
    let response;
    try {
      response = await requestJson({
        baseUrl: credential.baseUrl,
        path: endpoint.chat_path,
        method: 'POST',
        body: request,
        token: credential.token,
        timeoutMs: endpoint.request_timeout_ms,
        maxBytes: MAX_RESPONSE_BYTES,
        headers: { 'x-autopilot-request-id': requestId },
      });
    } catch (error) {
      try {
        cancellation = await cancelAndRecover(endpoint, credential, requestId, baseline);
      } catch (cancelError) {
        cancelError.causeCode = error.code || 'GENERATION_TRANSPORT_FAILED';
        throw cancelError;
      }
      const cancelled = new LocalDeploymentError(
        `local generation failed and was cancelled: ${error.code || error.message}`,
        'GENERATION_CANCELLED',
      );
      cancelled.cancellation = cancellation;
      throw cancelled;
    }
    const parsed = parseChatResponse(response.value, endpoint, requestId);
    responseHash = parsed.responseHash;
    responseBytes = response.responseBytes;
    usage = parsed.usage;
    await waitForRecovery(endpoint, credential, baseline);
    const postIdentity = await acquireRuntimeIdentity(endpoint, credential);
    const postFingerprints = fingerprintRuntime(endpoint, postIdentity.identity);
    if (postFingerprints.semantic_fingerprint !== fingerprints.semantic_fingerprint
        || postFingerprints.operational_fingerprint
          !== fingerprints.operational_fingerprint) {
      throw new LocalDeploymentError(
        'local deployment identity changed during generation',
        'ENDPOINT_HOT_SWAP',
      );
    }
    status = 'completed';
    const receipt = Object.freeze({
      schema_version: 1,
      status,
      endpoint_id: endpoint.id,
      role: options.role,
      risk: options.risk,
      request_id_hash: sha256(requestId),
      request_hash: requestHash,
      response_hash: responseHash,
      semantic_fingerprint: fingerprints.semantic_fingerprint,
      operational_fingerprint: fingerprints.operational_fingerprint,
      egress_hash: sha256(canonicalJson(egress)),
      assurance_receipt_hash: assurance ? assurance.receipt_hash : null,
      lease_scope: 'autopilot_only',
      external_load_controlled: false,
      bodies_persisted: false,
    });
    writeTelemetry(options.telemetryPath, telemetryRow({
      endpoint,
      role: options.role,
      risk: options.risk,
      status,
      fingerprints,
      requestHash,
      responseHash,
      promptBytes: Buffer.byteLength(prompt),
      responseBytes,
      usage,
      wallTimeMs: Math.max(0, Date.now() - started),
    }));
    return Object.freeze({
      schema_version: 1,
      status,
      output: parsed.content,
      receipt,
    });
  } catch (error) {
    reason = error.code || 'LOCAL_DISPATCH_FAILED';
    if ([
      'CANCELLATION_UNCONFIRMED',
      'RESOURCE_RECOVERY_UNCONFIRMED',
      'ENDPOINT_HOT_SWAP',
      'GENERATION_IDENTITY_MISMATCH',
      'GENERATION_PROTOCOL_ERROR',
    ].includes(reason)) {
      status = 'quarantined';
    } else if (reason === 'GENERATION_CANCELLED') {
      status = 'cancelled';
      cancellation = error.cancellation || cancellation;
    } else {
      status = 'failed';
    }
    writeTelemetry(options.telemetryPath, telemetryRow({
      endpoint,
      role: options.role,
      risk: options.risk,
      status,
      reason,
      fingerprints,
      requestHash,
      responseHash,
      promptBytes: Buffer.byteLength(prompt),
      responseBytes,
      usage,
      wallTimeMs: Math.max(0, Date.now() - started),
      cancellationReceiptHash: cancellation
        ? sha256(canonicalJson(cancellation)) : null,
    }));
    error.dispatchStatus = status;
    throw error;
  } finally {
    lease.release();
  }
}

function exitFor(error) {
  if (error.code === 'INVALID_ARGUMENT') return 2;
  if (error.dispatchStatus === 'quarantined') return 3;
  return 1;
}

async function run(argv = process.argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (rawError) {
    const error = rawError instanceof LocalDeploymentError
      ? rawError
      : new LocalDeploymentError(rawError.message || 'local dispatch failed');
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      status: 'failed',
      output: null,
      reason: error.code,
    })}\n`);
    return exitFor(error);
  }
  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    const result = await runLocalDispatch(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (rawError) {
    const error = rawError instanceof LocalDeploymentError
      ? rawError
      : new LocalDeploymentError(rawError.message || 'local dispatch failed');
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      status: error.dispatchStatus || 'failed',
      output: null,
      reason: error.code,
    })}\n`);
    return exitFor(error);
  }
}

if (require.main === module) {
  run().then((status) => {
    process.exitCode = status;
  }).catch((error) => {
    process.stderr.write(`dispatch-local-openai: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  cancelAndRecover,
  enforceEgress,
  parseArgs,
  parseChatResponse,
  run,
  runLocalDispatch,
  telemetryRow,
  verifyHighRiskAssurance,
  waitForRecovery,
};
