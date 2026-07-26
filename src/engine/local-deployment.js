'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');
const {
  canonicalJson,
  sha256,
} = require('./owner-kernel/canonical');
const {
  loadEndpointsEnv,
} = require('../../scripts/lib/load-endpoints-env');

const LOCAL_ENGINE_ROSTER_SCHEMA_VERSION = 1;
const LOCAL_DEPLOYMENT_OBSERVATION_SCHEMA_VERSION = 1;
const LOCAL_RUNTIME_PROTOCOL = 'openai-compatible';
const LOCAL_ROLES = new Set(['author', 'reviewer']);
const RUNTIMES = new Set(['autopilot-contract', 'generic-openai', 'ollama']);
const SHA256 = /^[a-f0-9]{64}$/iu;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_ROSTER = path.join(os.homedir(), '.autopilot', 'local-engines.json');

class LocalDeploymentError extends Error {
  constructor(message, code = 'LOCAL_DEPLOYMENT_ERROR') {
    super(message);
    this.code = code;
  }
}

function fail(message, code) {
  throw new LocalDeploymentError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  return value;
}

function exactKeys(value, fields, label, code = 'INVALID_LOCAL_ENGINE_CONFIG') {
  const expected = fields.slice().sort();
  const actual = Object.keys(value).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} fields differ from the schema`, code);
  }
}

function token(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    fail(`${label} must be a bounded protocol token`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  return value;
}

function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(
      `${label} must be an integer between ${minimum} and ${maximum}`,
      'INVALID_LOCAL_ENGINE_CONFIG',
    );
  }
  return value;
}

function nullablePath(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,511}$/u.test(value)
      || value.includes('..') || value.includes('//')) {
    fail(`${label} must be a bounded absolute HTTP path`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  return value;
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname).toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1'
    || normalized === '::1' || normalized === '[::1]';
}

function normalizeBaseUrl(value, credentialEndpoint, label = 'base_url') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} is not a URL`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail(`${label} has unsupported URL components`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) {
    fail(
      `${label} must use authenticated TLS outside loopback`,
      'INSECURE_LOCAL_ENGINE_ENDPOINT',
    );
  }
  if (!loopback && (!credentialEndpoint || parsed.protocol !== 'https:')) {
    fail(
      `${label} requires an endpoint credential reference outside loopback`,
      'INSECURE_LOCAL_ENGINE_ENDPOINT',
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/u, '') || '/';
  return Object.freeze({
    url: parsed.toString().replace(/\/$/u, ''),
    loopback,
    protocol: parsed.protocol,
    hostname: parsed.hostname,
  });
}

function normalizeRosterEndpoint(raw, index) {
  const label = `local engine roster.endpoints[${index}]`;
  const value = plainObject(raw, label);
  exactKeys(value, [
    'id',
    'protocol',
    'runtime',
    'model',
    'base_url',
    'credential_endpoint',
    'roles',
    'identity_path',
    'capacity_path',
    'chat_path',
    'cancel_path',
    'request_timeout_ms',
    'recovery_timeout_ms',
    'max_tokens',
    'min_headroom_bytes',
    'configured_concurrency',
  ], label);
  const credentialEndpoint = value.credential_endpoint === null
    ? null : token(value.credential_endpoint, `${label}.credential_endpoint`);
  const base = normalizeBaseUrl(value.base_url, credentialEndpoint, `${label}.base_url`);
  if (value.protocol !== LOCAL_RUNTIME_PROTOCOL) {
    fail(`${label}.protocol must be ${LOCAL_RUNTIME_PROTOCOL}`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  if (!RUNTIMES.has(value.runtime)) {
    fail(`${label}.runtime is unsupported`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  if (!Array.isArray(value.roles) || value.roles.length === 0) {
    fail(`${label}.roles must be a non-empty array`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  const roles = value.roles.map((role) => token(role, `${label}.roles`)).sort();
  if (new Set(roles).size !== roles.length
      || roles.some((role) => !LOCAL_ROLES.has(role))) {
    fail(
      `${label}.roles may contain only author/reviewer without duplicates`,
      'INVALID_LOCAL_ENGINE_CONFIG',
    );
  }
  const configuredConcurrency = integer(
    value.configured_concurrency,
    `${label}.configured_concurrency`,
    1,
    1,
  );
  if (value.runtime === 'autopilot-contract'
      && (value.identity_path === null || value.capacity_path === null
        || value.cancel_path === null)) {
    fail(
      `${label} contract runtime requires identity, capacity, and cancel paths`,
      'INVALID_LOCAL_ENGINE_CONFIG',
    );
  }
  return Object.freeze({
    id: token(value.id, `${label}.id`),
    protocol: value.protocol,
    runtime: value.runtime,
    model: token(value.model, `${label}.model`),
    base_url: base.url,
    credential_endpoint: credentialEndpoint,
    roles: Object.freeze(roles),
    identity_path: nullablePath(value.identity_path, `${label}.identity_path`),
    capacity_path: nullablePath(value.capacity_path, `${label}.capacity_path`),
    chat_path: nullablePath(value.chat_path, `${label}.chat_path`),
    cancel_path: nullablePath(value.cancel_path, `${label}.cancel_path`),
    request_timeout_ms: integer(
      value.request_timeout_ms,
      `${label}.request_timeout_ms`,
      100,
      600_000,
    ),
    recovery_timeout_ms: integer(
      value.recovery_timeout_ms,
      `${label}.recovery_timeout_ms`,
      100,
      120_000,
    ),
    max_tokens: integer(value.max_tokens, `${label}.max_tokens`, 1, 1_000_000),
    min_headroom_bytes: integer(
      value.min_headroom_bytes,
      `${label}.min_headroom_bytes`,
      0,
    ),
    configured_concurrency: configuredConcurrency,
    loopback: base.loopback,
    transport_security: base.loopback
      ? (base.protocol === 'https:' ? 'loopback_tls' : 'loopback')
      : 'authenticated_tls',
  });
}

function normalizeRoster(raw) {
  const value = plainObject(raw, 'local engine roster');
  exactKeys(value, ['schema_version', 'endpoints'], 'local engine roster');
  if (value.schema_version !== LOCAL_ENGINE_ROSTER_SCHEMA_VERSION
      || !Array.isArray(value.endpoints)) {
    fail('local engine roster has an invalid schema version or endpoints list',
      'INVALID_LOCAL_ENGINE_CONFIG');
  }
  const endpoints = value.endpoints.map(normalizeRosterEndpoint);
  const ids = endpoints.map((endpoint) => endpoint.id);
  if (new Set(ids).size !== ids.length) {
    fail('local engine roster endpoint ids must be unique', 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  return Object.freeze({
    schema_version: LOCAL_ENGINE_ROSTER_SCHEMA_VERSION,
    endpoints: Object.freeze(endpoints.sort((left, right) => left.id.localeCompare(right.id))),
  });
}

function loadLocalEngineRoster(rosterPath = DEFAULT_ROSTER) {
  const resolved = path.resolve(rosterPath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (error) {
    fail(`local engine roster is unavailable: ${error.code || error.message}`, 'ROSTER_UNAVAILABLE');
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0) {
    fail(
      'local engine roster must be a regular file not writable by group/other',
      'ROSTER_UNTRUSTED',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    fail(`local engine roster is not valid JSON: ${error.message}`, 'INVALID_LOCAL_ENGINE_CONFIG');
  }
  return Object.freeze({
    path: resolved,
    roster_hash: sha256(canonicalJson(parsed)),
    roster: normalizeRoster(parsed),
  });
}

function findRosterEndpoint(rosterRecord, endpointId) {
  const endpoint = rosterRecord.roster.endpoints.find((entry) => entry.id === endpointId);
  if (!endpoint) fail(`local engine endpoint not found: ${endpointId}`, 'ENDPOINT_NOT_FOUND');
  return endpoint;
}

function resolveEndpointCredential(endpoint, options = {}) {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  let tokenValue = '';
  if (endpoint.credential_endpoint) {
    loadEndpointsEnv({ env, cwd, warn: options.warn || (() => {}) });
    const key = endpoint.credential_endpoint.toUpperCase();
    if (!/^[A-Z0-9_]+$/u.test(key)) {
      fail('credential endpoint name is invalid', 'INVALID_LOCAL_ENGINE_CONFIG');
    }
    const urlName = `AUTOPILOT_ENDPOINT_${key}_URL`;
    const tokenName = `AUTOPILOT_ENDPOINT_${key}_TOKEN`;
    const protectedUrl = env[urlName] || '';
    tokenValue = env[tokenName] || '';
    if (!protectedUrl || !tokenValue) {
      fail(
        `protected endpoint ${endpoint.credential_endpoint} is incomplete`,
        'ENDPOINT_CREDENTIAL_UNAVAILABLE',
      );
    }
    const normalizedProtected = normalizeBaseUrl(
      protectedUrl,
      endpoint.credential_endpoint,
      urlName,
    );
    if (normalizedProtected.url !== endpoint.base_url) {
      fail(
        'roster URL differs from the protected endpoint URL',
        'ENDPOINT_IDENTITY_MISMATCH',
      );
    }
  }
  return Object.freeze({
    baseUrl: endpoint.base_url,
    token: tokenValue,
    authenticated: Boolean(tokenValue),
  });
}

function requestJson(options) {
  return new Promise((resolve, reject) => {
    const target = new URL(options.path, `${options.baseUrl}/`);
    const base = new URL(options.baseUrl);
    if (target.origin !== base.origin) {
      reject(new LocalDeploymentError(
        'local engine request path changes endpoint origin',
        'ENDPOINT_ORIGIN_ESCAPE',
      ));
      return;
    }
    const body = options.body === undefined || options.body === null
      ? null : JSON.stringify(options.body);
    const transport = target.protocol === 'https:' ? https : http;
    const headers = {
      accept: 'application/json',
      connection: 'close',
      ...(body ? {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    };
    const started = Date.now();
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: true,
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => {
      request.destroy();
      finish(new LocalDeploymentError('local engine request aborted', 'REQUEST_ABORTED'));
    };
    const timer = setTimeout(() => {
      request.destroy();
      finish(new LocalDeploymentError('local engine request timed out', 'REQUEST_TIMEOUT'));
    }, options.timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
        return;
      }
      options.signal.addEventListener('abort', abort, { once: true });
    }
    request.once('error', (error) => {
      finish(new LocalDeploymentError(
        `local engine request failed: ${error.code || error.message}`,
        'ENDPOINT_UNAVAILABLE',
      ));
    });
    request.once('response', (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > (options.maxBytes || MAX_HTTP_RESPONSE_BYTES)) {
          response.destroy();
          finish(new LocalDeploymentError(
            'local engine response exceeded its byte limit',
            'RESPONSE_TOO_LARGE',
          ));
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => {
        const source = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish(new LocalDeploymentError(
            `local engine HTTP status ${response.statusCode}`,
            'ENDPOINT_HTTP_ERROR',
          ));
          return;
        }
        let value;
        try {
          value = JSON.parse(source);
        } catch {
          finish(new LocalDeploymentError(
            'local engine response is not JSON',
            'ENDPOINT_PROTOCOL_ERROR',
          ));
          return;
        }
        finish(null, Object.freeze({
          value,
          headers: Object.freeze({ ...response.headers }),
          status: response.statusCode,
          latencyMs: Math.max(0, Date.now() - started),
          responseBytes: bytes,
        }));
      });
    });
    if (body) request.end(body);
    else request.end();
  });
}

function normalizeRuntimeIdentity(raw, endpoint) {
  const value = plainObject(raw, 'runtime identity');
  exactKeys(value, [
    'schema_version',
    'runtime',
    'runtime_version',
    'model',
    'weights_sha256',
    'quantization',
    'tokenizer_binding',
    'chat_template_sha256',
    'tool_parser_binding',
    'context_window',
    'hardware_fingerprint',
    'configured_memory_bytes',
  ], 'runtime identity', 'IDENTITY_UNVERIFIABLE');
  if (value.schema_version !== 1 || value.runtime !== endpoint.runtime
      || value.model !== endpoint.model) {
    fail('runtime identity differs from the roster binding', 'ENDPOINT_IDENTITY_MISMATCH');
  }
  for (const [name, rawDigest] of [
    ['weights_sha256', value.weights_sha256],
    ['tokenizer_binding', value.tokenizer_binding],
    ['chat_template_sha256', value.chat_template_sha256],
    ['hardware_fingerprint', value.hardware_fingerprint],
  ]) {
    if (!SHA256.test(rawDigest)) {
      fail(`runtime identity.${name} must be a SHA-256 digest`, 'IDENTITY_UNVERIFIABLE');
    }
  }
  const identity = {
    schema_version: 1,
    runtime: token(value.runtime, 'runtime identity.runtime'),
    runtime_version: token(value.runtime_version, 'runtime identity.runtime_version'),
    model: token(value.model, 'runtime identity.model'),
    weights_sha256: value.weights_sha256.toLowerCase(),
    quantization: token(value.quantization, 'runtime identity.quantization'),
    tokenizer_binding: value.tokenizer_binding.toLowerCase(),
    chat_template_sha256: value.chat_template_sha256.toLowerCase(),
    tool_parser_binding: token(
      value.tool_parser_binding,
      'runtime identity.tool_parser_binding',
    ),
    context_window: integer(
      value.context_window,
      'runtime identity.context_window',
      1,
      100_000_000,
    ),
    hardware_fingerprint: value.hardware_fingerprint.toLowerCase(),
    configured_memory_bytes: integer(
      value.configured_memory_bytes,
      'runtime identity.configured_memory_bytes',
      1,
    ),
  };
  return Object.freeze(identity);
}

function normalizeCapacityObservation(raw, endpoint, observedAt) {
  const value = plainObject(raw, 'capacity observation');
  exactKeys(value, [
    'schema_version',
    'available_memory_bytes',
    'queue_depth',
    'active_requests',
    'generation_slots',
  ], 'capacity observation', 'CAPACITY_UNVERIFIABLE');
  if (value.schema_version !== 1) {
    fail('capacity observation schema version is invalid', 'CAPACITY_UNVERIFIABLE');
  }
  return Object.freeze({
    schema_version: 1,
    endpoint_id: endpoint.id,
    observed_at: observedAt,
    available_memory_bytes: integer(
      value.available_memory_bytes,
      'capacity observation.available_memory_bytes',
      0,
    ),
    queue_depth: integer(value.queue_depth, 'capacity observation.queue_depth', 0),
    active_requests: integer(
      value.active_requests,
      'capacity observation.active_requests',
      0,
    ),
    generation_slots: integer(
      value.generation_slots,
      'capacity observation.generation_slots',
      1,
    ),
  });
}

async function acquireContractIdentity(endpoint, credential) {
  const response = await requestJson({
    baseUrl: credential.baseUrl,
    path: endpoint.identity_path,
    token: credential.token,
    timeoutMs: endpoint.request_timeout_ms,
  });
  return Object.freeze({
    identity: normalizeRuntimeIdentity(response.value, endpoint),
    latencyMs: response.latencyMs,
    adapter: 'autopilot-contract-v1',
  });
}

function findOllamaContextWindow(modelInfo) {
  const entries = Object.entries(modelInfo || {}).filter(([key, value]) => (
    key.endsWith('.context_length') && Number.isSafeInteger(value) && value > 0
  ));
  return entries.length === 1 ? entries[0][1] : null;
}

async function acquireOllamaIdentity(endpoint, credential) {
  const [tags, show, version] = await Promise.all([
    requestJson({
      baseUrl: credential.baseUrl,
      path: '/api/tags',
      token: credential.token,
      timeoutMs: endpoint.request_timeout_ms,
    }),
    requestJson({
      baseUrl: credential.baseUrl,
      path: '/api/show',
      method: 'POST',
      body: { name: endpoint.model },
      token: credential.token,
      timeoutMs: endpoint.request_timeout_ms,
    }),
    requestJson({
      baseUrl: credential.baseUrl,
      path: '/api/version',
      token: credential.token,
      timeoutMs: endpoint.request_timeout_ms,
    }),
  ]);
  const models = tags.value && Array.isArray(tags.value.models) ? tags.value.models : [];
  const model = models.find((entry) => (
    entry && (entry.name === endpoint.model || entry.model === endpoint.model)
  ));
  const digest = model && typeof model.digest === 'string'
    ? model.digest.replace(/^sha256:/u, '') : '';
  const quantization = show.value && show.value.details
    ? show.value.details.quantization_level : '';
  const template = show.value && show.value.template;
  const modelInfo = show.value && show.value.model_info;
  const runtimeVersion = version.value && version.value.version;
  const contextWindow = findOllamaContextWindow(modelInfo);
  if (!SHA256.test(digest) || typeof quantization !== 'string' || !quantization
      || typeof template !== 'string' || !template
      || !modelInfo || typeof modelInfo !== 'object'
      || typeof runtimeVersion !== 'string' || !TOKEN.test(runtimeVersion)
      || contextWindow === null) {
    fail(
      'Ollama did not expose a stable weight/quant/template/runtime binding',
      'IDENTITY_UNVERIFIABLE',
    );
  }
  fail(
    'Ollama identity is semantically observed but hardware binding is unavailable',
    'IDENTITY_UNVERIFIABLE',
  );
}

async function acquireGenericOpenAiIdentity(endpoint, credential) {
  const response = await requestJson({
    baseUrl: credential.baseUrl,
    path: '/v1/models',
    token: credential.token,
    timeoutMs: endpoint.request_timeout_ms,
  });
  const models = response.value && Array.isArray(response.value.data)
    ? response.value.data.map((entry) => entry && entry.id).filter(Boolean) : [];
  if (!models.includes(endpoint.model)) {
    fail('generic OpenAI endpoint did not report the roster model', 'ENDPOINT_IDENTITY_MISMATCH');
  }
  fail(
    'generic OpenAI model labels do not bind weights, quantization, templates, or runtime',
    'IDENTITY_UNVERIFIABLE',
  );
}

async function acquireRuntimeIdentity(endpoint, credential) {
  if (endpoint.runtime === 'autopilot-contract') {
    return acquireContractIdentity(endpoint, credential);
  }
  if (endpoint.runtime === 'ollama') {
    return acquireOllamaIdentity(endpoint, credential);
  }
  return acquireGenericOpenAiIdentity(endpoint, credential);
}

async function observeCapacity(endpoint, credential, observedAt = new Date().toISOString()) {
  if (!endpoint.capacity_path) {
    fail('endpoint exposes no capacity observation path', 'CAPACITY_UNVERIFIABLE');
  }
  const response = await requestJson({
    baseUrl: credential.baseUrl,
    path: endpoint.capacity_path,
    token: credential.token,
    timeoutMs: endpoint.request_timeout_ms,
  });
  return Object.freeze({
    observation: normalizeCapacityObservation(response.value, endpoint, observedAt),
    latencyMs: response.latencyMs,
  });
}

function fingerprintRuntime(endpoint, identity) {
  const semanticBinding = {
    schema_version: 1,
    protocol: endpoint.protocol,
    runtime: identity.runtime,
    model: identity.model,
    weights_sha256: identity.weights_sha256,
    quantization: identity.quantization,
    tokenizer_binding: identity.tokenizer_binding,
    chat_template_sha256: identity.chat_template_sha256,
    tool_parser_binding: identity.tool_parser_binding,
    context_window: identity.context_window,
  };
  const operationalBinding = {
    schema_version: 1,
    endpoint_id: endpoint.id,
    base_url_hash: sha256(endpoint.base_url),
    transport_security: endpoint.transport_security,
    runtime: identity.runtime,
    runtime_version: identity.runtime_version,
    hardware_fingerprint: identity.hardware_fingerprint,
    configured_memory_bytes: identity.configured_memory_bytes,
    configured_concurrency: endpoint.configured_concurrency,
    cancellation_contract: endpoint.cancel_path ? 'ack-and-recovery-v1' : 'unavailable',
  };
  return Object.freeze({
    semantic_binding: Object.freeze(semanticBinding),
    semantic_fingerprint: sha256(canonicalJson(semanticBinding)),
    operational_binding: Object.freeze(operationalBinding),
    operational_fingerprint: sha256(canonicalJson(operationalBinding)),
  });
}

function verifyIndependentNetworkBoundary(raw, fingerprint, verifier) {
  if (typeof verifier !== 'function') {
    return Object.freeze({
      state: raw.loopback ? 'local_endpoint' : 'authenticated_endpoint',
      independent: false,
      evidence_hash: null,
    });
  }
  const receipt = verifier(Object.freeze({
    endpoint_fingerprint: fingerprint.semantic_fingerprint,
    operational_fingerprint: fingerprint.operational_fingerprint,
  }));
  if (!receipt || receipt.ok !== true || receipt.independent !== true
      || receipt.endpoint_fingerprint !== fingerprint.semantic_fingerprint
      || receipt.operational_fingerprint !== fingerprint.operational_fingerprint
      || !SHA256.test(receipt.observation_hash)) {
    fail('independent network boundary verifier rejected the endpoint', 'OFFLINE_UNVERIFIED');
  }
  return Object.freeze({
    state: 'offline_verified',
    independent: true,
    evidence_hash: receipt.observation_hash.toLowerCase(),
  });
}

async function probeLocalDeployment(options) {
  const rosterRecord = loadLocalEngineRoster(options.rosterPath || DEFAULT_ROSTER);
  const endpoint = findRosterEndpoint(rosterRecord, options.endpointId);
  const credential = resolveEndpointCredential(endpoint, options);
  const observedAt = options.observedAt || new Date().toISOString();
  const started = Date.now();
  const identityResult = await acquireRuntimeIdentity(endpoint, credential);
  const capacityResult = await observeCapacity(endpoint, credential, observedAt);
  const fingerprints = fingerprintRuntime(endpoint, identityResult.identity);
  const containment = verifyIndependentNetworkBoundary(
    endpoint,
    fingerprints,
    options.networkBoundaryVerifier,
  );
  const capacityHash = sha256(canonicalJson(capacityResult.observation));
  const dispatchEligible = Boolean(
    endpoint.chat_path && endpoint.cancel_path && endpoint.capacity_path
      && capacityResult.observation.generation_slots >= endpoint.configured_concurrency,
  );
  return Object.freeze({
    schema_version: LOCAL_DEPLOYMENT_OBSERVATION_SCHEMA_VERSION,
    status: 'identity_verified',
    endpoint_id: endpoint.id,
    roster_hash: rosterRecord.roster_hash,
    runtime_adapter: identityResult.adapter,
    roles: endpoint.roles,
    semantic_fingerprint: fingerprints.semantic_fingerprint,
    operational_fingerprint: fingerprints.operational_fingerprint,
    identity: identityResult.identity,
    capacity_observation: capacityResult.observation,
    capacity_observation_hash: capacityHash,
    network_containment: containment,
    dispatch_eligible: dispatchEligible,
    slo_observation: {
      schema_version: 1,
      observed_at: observedAt,
      probe_wall_time_ms: Math.max(0, Date.now() - started),
      identity_latency_ms: identityResult.latencyMs,
      capacity_latency_ms: capacityResult.latencyMs,
      operational_fingerprint: fingerprints.operational_fingerprint,
      capacity_observation_hash: capacityHash,
    },
    resource_scope: {
      lease_scope: 'autopilot_only',
      external_load_controlled: false,
      configured_concurrency: endpoint.configured_concurrency,
    },
  });
}

function leaseRoot(options = {}) {
  return path.resolve(
    options.leaseDir
      || process.env.AUTOPILOT_LOCAL_LEASE_DIR
      || path.join(os.homedir(), '.autopilot', 'local-engines', 'leases'),
  );
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireEndpointLease(endpoint, operationalFingerprint, options = {}) {
  const root = leaseRoot(options);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const lockPath = path.join(root, `${endpoint.id}.lock`);
  const tokenValue = crypto.randomBytes(24).toString('hex');
  const attempt = () => {
    fs.mkdirSync(lockPath, { mode: 0o700 });
    fs.writeFileSync(path.join(lockPath, 'lease.json'), `${canonicalJson({
      schema_version: 1,
      endpoint_id: endpoint.id,
      pid: process.pid,
      token: tokenValue,
      operational_fingerprint: operationalFingerprint,
      acquired_at: new Date().toISOString(),
    })}\n`, { mode: 0o600, flag: 'wx' });
  };
  try {
    attempt();
  } catch (error) {
    if (error.code !== 'EEXIST') {
      fail(`cannot acquire endpoint lease: ${error.code}`, 'LEASE_IO_ERROR');
    }
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(path.join(lockPath, 'lease.json'), 'utf8'));
    } catch {
      fail('endpoint lease is corrupt and requires operator recovery', 'LEASE_CORRUPT');
    }
    if (processIsAlive(existing.pid)) {
      fail('endpoint already has an active Autopilot lease', 'LEASE_BUSY');
    }
    const stalePath = `${lockPath}.stale-${crypto.randomBytes(8).toString('hex')}`;
    try {
      fs.renameSync(lockPath, stalePath);
      fs.rmSync(stalePath, { recursive: true, force: true });
      attempt();
    } catch (recoveryError) {
      fail(
        `cannot recover stale endpoint lease: ${recoveryError.code || recoveryError.message}`,
        'LEASE_BUSY',
      );
    }
  }
  let released = false;
  return Object.freeze({
    endpoint_id: endpoint.id,
    operational_fingerprint: operationalFingerprint,
    release() {
      if (released) return false;
      let current;
      try {
        current = JSON.parse(fs.readFileSync(path.join(lockPath, 'lease.json'), 'utf8'));
      } catch {
        fail('endpoint lease disappeared before release', 'LEASE_OWNERSHIP_LOST');
      }
      if (current.token !== tokenValue || current.pid !== process.pid) {
        fail('endpoint lease ownership changed before release', 'LEASE_OWNERSHIP_LOST');
      }
      const tombstone = `${lockPath}.release-${tokenValue}`;
      try {
        fs.renameSync(lockPath, tombstone);
        fs.rmSync(tombstone, { recursive: true, force: true });
      } catch (error) {
        fail(`cannot release endpoint lease: ${error.code}`, 'LEASE_IO_ERROR');
      }
      released = true;
      return true;
    },
  });
}

function assertCapacityHeadroom(endpoint, observation) {
  if (observation.available_memory_bytes < endpoint.min_headroom_bytes) {
    fail('local endpoint has insufficient observed memory headroom', 'CAPACITY_HEADROOM_LOW');
  }
  if (observation.active_requests >= observation.generation_slots
      || observation.queue_depth > 0) {
    fail('local endpoint reports no immediately available generation slot', 'CAPACITY_BUSY');
  }
  return true;
}

module.exports = {
  DEFAULT_ROSTER,
  LOCAL_DEPLOYMENT_OBSERVATION_SCHEMA_VERSION,
  LOCAL_ENGINE_ROSTER_SCHEMA_VERSION,
  LOCAL_ROLES,
  LocalDeploymentError,
  acquireEndpointLease,
  acquireRuntimeIdentity,
  assertCapacityHeadroom,
  findRosterEndpoint,
  fingerprintRuntime,
  isLoopbackHostname,
  loadLocalEngineRoster,
  normalizeCapacityObservation,
  normalizeRoster,
  normalizeRuntimeIdentity,
  observeCapacity,
  probeLocalDeployment,
  requestJson,
  resolveEndpointCredential,
  verifyIndependentNetworkBoundary,
};
