#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  LocalDeploymentError,
  acquireEndpointLease,
  findRosterEndpoint,
  loadLocalEngineRoster,
  normalizeRoster,
  probeLocalDeployment,
  resolveEndpointCredential,
} = require('../src/engine/local-deployment');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-local-probe-test-'));
const rosterPath = path.join(tempRoot, 'local-engines.json');
const leaseDir = path.join(tempRoot, 'leases');
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function digest(character) {
  return character.repeat(64);
}

function secretKeys(value) {
  if (Array.isArray(value)) return value.flatMap(secretKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => [
    ...(['token', 'api_key', 'authorization', 'secret'].includes(key.toLowerCase())
      ? [key] : []),
    ...secretKeys(entry),
  ]);
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, 'scripts', 'probe-local-engine.js'),
      ...args,
    ], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

const state = {
  identity: {
    schema_version: 1,
    runtime: 'autopilot-contract',
    runtime_version: 'runtime-1.0.0',
    model: 'local-model-exact',
    weights_sha256: digest('1'),
    quantization: 'q8_0',
    tokenizer_binding: digest('2'),
    chat_template_sha256: digest('3'),
    tool_parser_binding: 'native-tools-v1',
    context_window: 32768,
    hardware_fingerprint: digest('4'),
    configured_memory_bytes: 24_000_000_000,
  },
  capacity: {
    schema_version: 1,
    available_memory_bytes: 12_000_000_000,
    queue_depth: 0,
    active_requests: 0,
    generation_slots: 1,
  },
};

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/identity') {
    json(response, 200, state.identity);
    return;
  }
  if (request.method === 'GET' && request.url === '/capacity') {
    json(response, 200, state.capacity);
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/models') {
    json(response, 200, { object: 'list', data: [{ id: 'local-model-exact' }] });
    return;
  }
  json(response, 404, { error: 'not found' });
});

function endpoint(baseUrl, overrides = {}) {
  return {
    id: 'local-contract',
    protocol: 'openai-compatible',
    runtime: 'autopilot-contract',
    model: 'local-model-exact',
    base_url: baseUrl,
    credential_endpoint: null,
    roles: ['author', 'reviewer'],
    identity_path: '/identity',
    capacity_path: '/capacity',
    chat_path: '/v1/chat/completions',
    cancel_path: '/cancel',
    request_timeout_ms: 500,
    recovery_timeout_ms: 500,
    max_tokens: 1024,
    min_headroom_bytes: 1_000_000_000,
    configured_concurrency: 1,
    ...overrides,
  };
}

function writeRoster(baseUrl, endpoints = [endpoint(baseUrl)]) {
  fs.writeFileSync(rosterPath, `${JSON.stringify({
    schema_version: 1,
    endpoints,
  }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(rosterPath, 0o600);
}

function expectCode(callback, code, message) {
  let observed = null;
  try {
    callback();
  } catch (error) {
    observed = error;
  }
  check(observed instanceof LocalDeploymentError, message);
  equal(observed.code, code, `${message}: stable error code`);
}

async function expectAsyncCode(callback, code, message) {
  let observed = null;
  try {
    await callback();
  } catch (error) {
    observed = error;
  }
  check(observed instanceof LocalDeploymentError, message);
  equal(observed.code, code, `${message}: stable error code`);
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  writeRoster(baseUrl);

  const loaded = loadLocalEngineRoster(rosterPath);
  equal(loaded.roster.endpoints.length, 1, 'non-secret roster loads one endpoint');
  equal(
    loaded.roster.endpoints[0].transport_security,
    'loopback',
    'loopback HTTP is classified explicitly',
  );
  check(
    secretKeys(loaded).length === 0,
    'roster record carries no secret field',
  );

  const first = await probeLocalDeployment({
    rosterPath,
    endpointId: 'local-contract',
    observedAt: '2026-07-26T00:00:00.000Z',
  });
  equal(first.status, 'identity_verified', 'full contract identity verifies');
  equal(first.dispatch_eligible, true, 'complete control contract is dispatch eligible');
  equal(
    first.network_containment.state,
    'local_endpoint',
    'loopback is reported only as local_endpoint by default',
  );
  equal(
    first.network_containment.independent,
    false,
    'loopback does not fabricate offline verification',
  );
  check(/^[a-f0-9]{64}$/u.test(first.semantic_fingerprint), 'semantic fingerprint is bound');
  check(/^[a-f0-9]{64}$/u.test(first.operational_fingerprint), 'operational fingerprint is bound');
  equal(
    first.resource_scope.external_load_controlled,
    false,
    'probe does not claim control over non-Autopilot load',
  );

  const observationPath = path.join(tempRoot, 'observation.json');
  fs.writeFileSync(observationPath, JSON.stringify(first));
  const schemaValidation = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'validate-json-schema.js'),
    '--schema', path.join(root, 'schemas', 'local-deployment-observation.schema.json'),
    '--document', observationPath,
  ], { encoding: 'utf8' });
  equal(schemaValidation.status, 0, 'deployment observation matches its public schema');
  const rosterValidation = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'validate-json-schema.js'),
    '--schema', path.join(root, 'schemas', 'local-engine-roster.schema.json'),
    '--document', rosterPath,
  ], { encoding: 'utf8' });
  equal(rosterValidation.status, 0, 'local roster matches its public schema');

  state.capacity.available_memory_bytes -= 500_000_000;
  const capacityChanged = await probeLocalDeployment({
    rosterPath,
    endpointId: 'local-contract',
    observedAt: '2026-07-26T00:01:00.000Z',
  });
  equal(
    capacityChanged.semantic_fingerprint,
    first.semantic_fingerprint,
    'transient headroom does not churn semantic identity',
  );
  equal(
    capacityChanged.operational_fingerprint,
    first.operational_fingerprint,
    'transient headroom does not churn operational identity',
  );
  check(
    capacityChanged.capacity_observation_hash !== first.capacity_observation_hash,
    'transient capacity remains a separate observation',
  );

  state.identity.quantization = 'q4_k_m';
  const quantized = await probeLocalDeployment({
    rosterPath,
    endpointId: 'local-contract',
  });
  check(
    quantized.semantic_fingerprint !== first.semantic_fingerprint,
    'same model label with a different quantization cannot reuse semantic evidence',
  );
  state.identity.quantization = 'q8_0';

  state.identity.hardware_fingerprint = digest('5');
  const hardwareChanged = await probeLocalDeployment({
    rosterPath,
    endpointId: 'local-contract',
  });
  equal(
    hardwareChanged.semantic_fingerprint,
    first.semantic_fingerprint,
    'hardware change does not mislabel the model semantics',
  );
  check(
    hardwareChanged.operational_fingerprint !== first.operational_fingerprint,
    'hardware change invalidates operational/SLO binding',
  );
  state.identity.hardware_fingerprint = digest('4');

  const offline = await probeLocalDeployment({
    rosterPath,
    endpointId: 'local-contract',
    networkBoundaryVerifier(request) {
      return {
        ok: true,
        independent: true,
        endpoint_fingerprint: request.endpoint_fingerprint,
        operational_fingerprint: request.operational_fingerprint,
        observation_hash: digest('9'),
      };
    },
  });
  equal(
    offline.network_containment.state,
    'offline_verified',
    'only a live independent verifier can upgrade network containment',
  );
  equal(
    offline.network_containment.evidence_hash,
    digest('9'),
    'offline state binds independent evidence',
  );

  const originalIdentity = state.identity;
  state.identity = { ...state.identity };
  delete state.identity.tokenizer_binding;
  await expectAsyncCode(
    () => probeLocalDeployment({ rosterPath, endpointId: 'local-contract' }),
    'IDENTITY_UNVERIFIABLE',
    'missing stable identity component fails closed',
  );
  state.identity = originalIdentity;

  writeRoster(baseUrl, [endpoint(baseUrl, {
    runtime: 'generic-openai',
    identity_path: null,
    capacity_path: null,
    cancel_path: null,
  })]);
  await expectAsyncCode(
    () => probeLocalDeployment({ rosterPath, endpointId: 'local-contract' }),
    'IDENTITY_UNVERIFIABLE',
    'generic model label cannot bind exact deployment identity',
  );
  writeRoster(baseUrl);

  expectCode(
    () => normalizeRoster({
      schema_version: 1,
      endpoints: [endpoint('http://example.com:8080')],
    }),
    'INSECURE_LOCAL_ENGINE_ENDPOINT',
    'non-loopback HTTP is rejected',
  );
  expectCode(
    () => normalizeRoster({
      schema_version: 1,
      endpoints: [endpoint('https://example.com')],
    }),
    'INSECURE_LOCAL_ENGINE_ENDPOINT',
    'non-loopback HTTPS still requires protected credentials',
  );
  expectCode(
    () => normalizeRoster({
      schema_version: 1,
      endpoints: [{
        ...endpoint(baseUrl),
        token: 'secret-must-not-enter-roster',
      }],
    }),
    'INVALID_LOCAL_ENGINE_CONFIG',
    'secret-shaped extra fields are rejected from the roster',
  );
  expectCode(
    () => normalizeRoster({
      schema_version: 1,
      endpoints: [endpoint(baseUrl, { configured_concurrency: 2 })],
    }),
    'INVALID_LOCAL_ENGINE_CONFIG',
    'current local lease contract is explicitly single-capacity',
  );

  writeRoster(baseUrl, [endpoint(baseUrl, { credential_endpoint: 'fake_local' })]);
  const credentialRoster = loadLocalEngineRoster(rosterPath);
  const credentialEndpoint = findRosterEndpoint(credentialRoster, 'local-contract');
  const credentialEnv = {
    AUTOPILOT_ENDPOINT_FAKE_LOCAL_URL: baseUrl,
    AUTOPILOT_ENDPOINT_FAKE_LOCAL_TOKEN: 'protected-token-value',
    AUTOPILOT_ENDPOINTS_ENV: path.join(tempRoot, 'missing-endpoints.env'),
  };
  const credential = resolveEndpointCredential(credentialEndpoint, {
    env: credentialEnv,
    cwd: tempRoot,
  });
  equal(credential.authenticated, true, 'protected endpoint reference resolves auth');
  equal(credential.token, 'protected-token-value', 'auth remains in protected environment');
  check(
    !JSON.stringify(credentialRoster).includes('protected-token-value'),
    'protected token never enters roster data',
  );
  credentialEnv.AUTOPILOT_ENDPOINT_FAKE_LOCAL_URL = `${baseUrl}/different`;
  expectCode(
    () => resolveEndpointCredential(credentialEndpoint, {
      env: credentialEnv,
      cwd: tempRoot,
    }),
    'ENDPOINT_IDENTITY_MISMATCH',
    'protected URL must exactly match the roster URL',
  );
  writeRoster(baseUrl);

  const currentEndpoint = findRosterEndpoint(loadLocalEngineRoster(rosterPath), 'local-contract');
  const firstLease = acquireEndpointLease(
    currentEndpoint,
    first.operational_fingerprint,
    { leaseDir },
  );
  expectCode(
    () => acquireEndpointLease(
      currentEndpoint,
      first.operational_fingerprint,
      { leaseDir },
    ),
    'LEASE_BUSY',
    'parallel Autopilot dispatch cannot acquire a one-slot endpoint twice',
  );
  equal(firstLease.release(), true, 'lease owner releases its slot');
  const nextLease = acquireEndpointLease(
    currentEndpoint,
    first.operational_fingerprint,
    { leaseDir },
  );
  equal(nextLease.release(), true, 'released endpoint can be acquired again');

  const untrustedRoster = path.join(tempRoot, 'untrusted-roster.json');
  fs.copyFileSync(rosterPath, untrustedRoster);
  fs.chmodSync(untrustedRoster, 0o666);
  expectCode(
    () => loadLocalEngineRoster(untrustedRoster),
    'ROSTER_UNTRUSTED',
    'group/world-writable roster is rejected',
  );

  const listCli = await runCli(['list', '--roster', rosterPath]);
  equal(listCli.status, 0, 'probe CLI lists the non-secret roster');
  const listed = JSON.parse(listCli.stdout);
  equal(listed.endpoints.length, 1, 'probe CLI list emits one endpoint');
  check(
    secretKeys(listed).length === 0,
    'probe CLI list emits no protected credential value',
  );

  const probeCli = await runCli([
    'probe',
    '--endpoint', 'local-contract',
    '--roster', rosterPath,
    '--observed-at', '2026-07-26T00:02:00.000Z',
  ]);
  equal(probeCli.status, 0, 'probe CLI completes a bound contract observation');
  equal(
    JSON.parse(probeCli.stdout).status,
    'identity_verified',
    'probe CLI emits the verified state',
  );

  writeRoster(baseUrl, [endpoint(baseUrl, {
    runtime: 'generic-openai',
    identity_path: null,
    capacity_path: null,
    cancel_path: null,
  })]);
  const genericCli = await runCli([
    'probe',
    '--endpoint', 'local-contract',
    '--roster', rosterPath,
  ]);
  equal(genericCli.status, 1, 'unbound generic identity is a bounded CLI failure');
  equal(
    JSON.parse(genericCli.stdout).status,
    'identity_unverifiable',
    'generic CLI result does not fabricate a reusable identity',
  );

  process.stdout.write(`local engine probe: ${assertions} assertions passed\n`);
}

main().finally(() => {
  server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
