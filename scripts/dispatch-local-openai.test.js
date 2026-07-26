#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  resolveGovernancePolicy,
} = require('../src/engine/owner-kernel/policy');
const {
  freezeTaskAuthorityEnvelope,
} = require('../src/engine/owner-kernel/task-authority');
const {
  LocalDeploymentError,
} = require('../src/engine/local-deployment');
const {
  runLocalDispatch,
} = require('./dispatch-local-openai');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-local-dispatch-test-'));
const rosterPath = path.join(tempRoot, 'local-engines.json');
const leaseDir = path.join(tempRoot, 'leases');
const telemetryPath = path.join(tempRoot, 'telemetry.jsonl');
let assertions = 0;
const sockets = new Set();

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

function json(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request) {
  let source = '';
  for await (const chunk of request) source += chunk;
  return JSON.parse(source);
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, 'scripts', 'dispatch-local-openai.js'),
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

const baselineCapacity = Object.freeze({
  schema_version: 1,
  available_memory_bytes: 12_000_000_000,
  queue_depth: 0,
  active_requests: 0,
  generation_slots: 1,
});
const baselineIdentity = Object.freeze({
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
});
const state = {
  mode: 'success',
  identity: { ...baselineIdentity },
  capacity: { ...baselineCapacity },
  chatStarted: false,
  chatRequests: [],
  identityReads: 0,
  cancelRequests: [],
};

function restoreCapacity() {
  state.capacity = { ...baselineCapacity };
}

function reset(mode = 'success') {
  state.mode = mode;
  state.identity = { ...baselineIdentity };
  state.capacity = { ...baselineCapacity };
  state.chatStarted = false;
  state.chatRequests = [];
  state.identityReads = 0;
  state.cancelRequests = [];
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/identity') {
      state.identityReads += 1;
      const identity = state.mode === 'hot-swap' && state.chatStarted
        ? { ...state.identity, weights_sha256: digest('8') }
        : state.identity;
      json(response, 200, identity);
      return;
    }
    if (request.method === 'GET' && request.url === '/capacity') {
      json(response, 200, state.capacity);
      return;
    }
    if (request.method === 'POST' && request.url === '/chat') {
      const body = await readJson(request);
      state.chatStarted = true;
      state.chatRequests.push({
        body,
        header_request_id: request.headers['x-autopilot-request-id'],
      });
      state.capacity = {
        ...baselineCapacity,
        available_memory_bytes: 10_000_000_000,
        active_requests: 1,
      };
      if (['timeout', 'cancel-noack', 'no-recovery'].includes(state.mode)) return;
      setTimeout(() => {
        restoreCapacity();
        const message = {
          role: 'assistant',
          content: 'local generated output',
        };
        if (state.mode === 'malformed-tool-call') {
          message.tool_calls = { name: 'unexpected' };
        }
        json(response, 200, {
          id: 'generation-1',
          request_id: body.metadata.autopilot_request_id,
          model: state.mode === 'model-mismatch' ? 'different-model' : body.model,
          choices: [{
            index: 0,
            message,
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 17,
            completion_tokens: 4,
          },
        });
      }, 20);
      return;
    }
    if (request.method === 'POST' && request.url === '/cancel') {
      const body = await readJson(request);
      state.cancelRequests.push(body);
      if (state.mode === 'cancel-noack') {
        json(response, 200, {
          schema_version: 1,
          request_id: body.request_id,
          cancelled: false,
          queue_released: false,
        });
        return;
      }
      if (state.mode !== 'no-recovery') restoreCapacity();
      json(response, 200, {
        schema_version: 1,
        request_id: body.request_id,
        cancelled: true,
        queue_released: true,
      });
      return;
    }
    json(response, 404, { error: 'not found' });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});

function roster(baseUrl, roles = ['author', 'reviewer']) {
  return {
    schema_version: 1,
    endpoints: [{
      id: 'local-contract',
      protocol: 'openai-compatible',
      runtime: 'autopilot-contract',
      model: 'local-model-exact',
      base_url: baseUrl,
      credential_endpoint: null,
      roles,
      identity_path: '/identity',
      capacity_path: '/capacity',
      chat_path: '/chat',
      cancel_path: '/cancel',
      request_timeout_ms: 100,
      recovery_timeout_ms: 300,
      max_tokens: 1024,
      min_headroom_bytes: 11_000_000_000,
      configured_concurrency: 1
    }]
  };
}

function writeRoster(baseUrl, roles) {
  fs.writeFileSync(rosterPath, `${JSON.stringify(roster(baseUrl, roles), null, 2)}\n`, {
    mode: 0o600,
  });
  fs.chmodSync(rosterPath, 0o600);
}

function buildEnvelope(allow = true) {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'),
  );
  const resolved = resolveGovernancePolicy(config);
  const rules = allow ? [
    {
      data_class: 'task_prompt',
      route_class: 'runner',
      destination: 'local:local-contract',
      transport: 'local:openai-compatible',
      effect: 'allow',
      max_payload_classification: 'task',
    },
    {
      data_class: 'diff',
      route_class: 'reviewer',
      destination: 'local:local-contract',
      transport: 'local:openai-compatible',
      effect: 'allow',
      max_payload_classification: 'source',
    },
  ] : [];
  return freezeTaskAuthorityEnvelope({
    taskId: 'local-dispatch-test',
    intent: {
      objective: 'Exercise one bounded local raw model transport.',
      requirements_hash: sha256('local-dispatch-requirements'),
      scope: {
        task_classes: ['generation'],
        domains: ['repository'],
        languages: ['en'],
        allowed_tools: [],
        artifact_roots: ['artifacts'],
      },
    },
    acceptance: {
      contract_hash: sha256('local-dispatch-contract'),
      criteria_hash: sha256('local-dispatch-criteria'),
      required_evidence: ['receipt'],
    },
    redLineAdditions: [],
    effectPermissions: { effects: [] },
    resourceCeiling: {
      max_tokens: 10000,
      max_wall_seconds: 600,
      max_tool_calls: 1,
      max_cost_usd_micros: 0,
      max_grant_ttl_seconds: 300,
    },
    dataEgressRules: rules,
    escalationPolicy: {
      on_role_denied: 'block',
      on_scope_mismatch: 'block',
      protected_effects_require_escalation: true,
    },
    finishReceiptSchema: {
      schema_id: 'finish-receipt-v1',
      required_fields: [
        'evidence',
        'effective_profile',
        'decisions_outside_user_intent',
        'authority_status',
      ],
    },
    taskOverrides: {
      guidance_profile: 'guided',
      assurance_profile: 'conservative',
      topology_preference: 'inline',
      data_egress: 'local-only',
    },
    policy: resolved.policy,
    policyHash: resolved.policy_hash,
  }).envelope;
}

function options(overrides = {}) {
  return {
    rosterPath,
    endpointId: 'local-contract',
    role: 'author',
    risk: 'low',
    envelope: buildEnvelope(true),
    prompt: 'SUPER_SECRET_PROMPT_BODY: produce one bounded artifact',
    telemetryPath,
    leaseDir,
    ...overrides,
  };
}

async function expectCode(callback, code, message, status = null) {
  let observed = null;
  try {
    await callback();
  } catch (error) {
    observed = error;
  }
  check(observed instanceof LocalDeploymentError, message);
  equal(observed.code, code, `${message}: stable error code`);
  if (status !== null) {
    equal(observed.dispatchStatus, status, `${message}: dispatch status`);
  }
  return observed;
}

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  writeRoster(baseUrl);

  reset('success');
  const success = await runLocalDispatch(options());
  equal(success.status, 'completed', 'raw local author dispatch completes');
  equal(success.output, 'local generated output', 'raw model text is returned');
  equal(success.receipt.endpoint_id, 'local-contract', 'receipt binds endpoint id');
  equal(success.receipt.role, 'author', 'receipt binds exact allowlisted role');
  equal(success.receipt.bodies_persisted, false, 'receipt declares metadata-only persistence');
  equal(state.identityReads, 2, 'identity is acquired before and after generation');
  equal(state.chatRequests.length, 1, 'one raw generation request is sent');
  equal(
    state.chatRequests[0].header_request_id,
    state.chatRequests[0].body.metadata.autopilot_request_id,
    'header and body bind one client-generated request id',
  );
  equal(
    Object.hasOwn(state.chatRequests[0].body, 'tools'),
    false,
    'local raw request exposes no tools',
  );
  equal(
    state.chatRequests[0].body.messages.length,
    2,
    'local request contains only minimal system and raw user text',
  );

  const telemetry = fs.readFileSync(telemetryPath, 'utf8').trim().split('\n').map(JSON.parse);
  equal(telemetry.length, 1, 'success writes one metadata telemetry row');
  equal(telemetry[0].bodies_persisted, false, 'telemetry explicitly excludes bodies');
  check(
    !canonicalJson(telemetry).includes('SUPER_SECRET_PROMPT_BODY'),
    'telemetry never persists prompt content',
  );
  check(
    !canonicalJson(telemetry).includes('local generated output'),
    'telemetry never persists response content',
  );
  equal(
    telemetry[0].resource_scope,
    'autopilot_only',
    'telemetry does not claim external load control',
  );

  reset('success');
  const reviewer = await runLocalDispatch(options({
    role: 'reviewer',
    prompt: 'diff --git a/a b/a',
  }));
  equal(reviewer.status, 'completed', 'explicit reviewer allowlist uses the same raw contract');
  equal(reviewer.receipt.role, 'reviewer', 'reviewer receipt cannot masquerade as author');

  reset('success');
  await expectCode(
    () => runLocalDispatch(options({ envelope: buildEnvelope(false) })),
    'EGRESS_DENIED',
    'missing exact egress tuple blocks before dispatch',
  );
  equal(state.chatRequests.length, 0, 'egress denial sends no model request');

  writeRoster(baseUrl, ['author']);
  reset('success');
  await expectCode(
    () => runLocalDispatch(options({ role: 'reviewer' })),
    'ROLE_NOT_ALLOWLISTED',
    'role absent from local roster is denied',
  );
  equal(state.chatRequests.length, 0, 'role denial sends no model request');
  writeRoster(baseUrl);

  reset('success');
  state.capacity.available_memory_bytes = 10_000_000_000;
  await expectCode(
    () => runLocalDispatch(options()),
    'CAPACITY_HEADROOM_LOW',
    'just-in-time memory headroom is enforced',
  );
  equal(state.chatRequests.length, 0, 'headroom denial sends no generation');

  reset('hot-swap');
  await expectCode(
    () => runLocalDispatch(options()),
    'ENDPOINT_HOT_SWAP',
    'pre/post semantic identity drift fails stop',
    'quarantined',
  );

  reset('model-mismatch');
  await expectCode(
    () => runLocalDispatch(options()),
    'GENERATION_IDENTITY_MISMATCH',
    'returned model identity mismatch fails stop',
    'quarantined',
  );

  reset('malformed-tool-call');
  await expectCode(
    () => runLocalDispatch(options()),
    'GENERATION_PROTOCOL_ERROR',
    'non-array tool-call payload cannot bypass the raw tool-free contract',
    'quarantined',
  );

  reset('timeout');
  const cancelled = await expectCode(
    () => runLocalDispatch(options()),
    'GENERATION_CANCELLED',
    'ambiguous timeout requires cancellation before returning',
    'cancelled',
  );
  equal(state.cancelRequests.length, 1, 'timeout invokes one server cancellation');
  check(
    cancelled.cancellation
      && /^[a-f0-9]{64}$/u.test(cancelled.cancellation.acknowledgement_hash),
    'cancellation binds server acknowledgement',
  );
  equal(state.capacity.active_requests, 0, 'cancelled generation recovers active slot');
  equal(state.capacity.queue_depth, 0, 'cancelled generation recovers queue');

  reset('cancel-noack');
  await expectCode(
    () => runLocalDispatch(options()),
    'CANCELLATION_UNCONFIRMED',
    'missing cancellation acknowledgement quarantines endpoint',
    'quarantined',
  );

  reset('no-recovery');
  await expectCode(
    () => runLocalDispatch(options()),
    'RESOURCE_RECOVERY_UNCONFIRMED',
    'acknowledgement without resource recovery quarantines endpoint',
    'quarantined',
  );

  reset('success');
  await expectCode(
    () => runLocalDispatch(options({ risk: 'high' })),
    'LOCAL_ASSURANCE_REQUIRED',
    'high-risk local-only work blocks without live qualified assurance',
  );
  equal(state.chatRequests.length, 0, 'missing high-risk assurance sends no generation');

  reset('success');
  let assuranceRequest = null;
  const highRisk = await runLocalDispatch(options({
    risk: 'high',
    localAssuranceVerifier(request) {
      assuranceRequest = request;
      return {
        ok: true,
        capability_state: 'qualified',
        endpoint_id: request.endpoint_id,
        role: request.role,
        semantic_fingerprint: request.semantic_fingerprint,
        operational_fingerprint: request.operational_fingerprint,
      };
    },
  }));
  equal(highRisk.status, 'completed', 'live exact assurance admits high-risk local dispatch');
  check(assuranceRequest !== null, 'high-risk verifier receives exact deployment binding');
  check(
    /^[a-f0-9]{64}$/u.test(highRisk.receipt.assurance_receipt_hash),
    'high-risk receipt binds the live assurance response',
  );

  const rows = fs.readFileSync(telemetryPath, 'utf8').trim().split('\n').map(JSON.parse);
  check(
    rows.some((row) => row.status === 'quarantined'),
    'metadata telemetry records quarantine without bodies',
  );
  check(
    rows.some((row) => row.status === 'cancelled'
      && /^[a-f0-9]{64}$/u.test(row.cancellation_receipt_hash)),
    'metadata telemetry binds cancellation and recovery',
  );
  check(
    rows.every((row) => row.bodies_persisted === false),
    'every telemetry path remains metadata-only',
  );

  const envelopePath = path.join(tempRoot, 'envelope.json');
  const promptPath = path.join(tempRoot, 'prompt.txt');
  fs.writeFileSync(envelopePath, JSON.stringify(buildEnvelope(true)), { mode: 0o600 });
  fs.writeFileSync(promptPath, 'CLI raw local request', { mode: 0o600 });
  reset('success');
  const cli = await runCli([
    'run',
    '--endpoint', 'local-contract',
    '--role', 'author',
    '--prompt-file', promptPath,
    '--envelope', envelopePath,
    '--risk', 'low',
    '--roster', rosterPath,
    '--telemetry', telemetryPath,
    '--lease-dir', leaseDir,
  ]);
  equal(cli.status, 0, 'dispatch CLI completes the verified raw path');
  equal(JSON.parse(cli.stdout).status, 'completed', 'dispatch CLI emits one success object');

  reset('success');
  const cliHighRisk = await runCli([
    'run',
    '--endpoint', 'local-contract',
    '--role', 'author',
    '--prompt-file', promptPath,
    '--envelope', envelopePath,
    '--risk', 'high',
    '--roster', rosterPath,
    '--telemetry', telemetryPath,
    '--lease-dir', leaseDir,
  ]);
  equal(cliHighRisk.status, 1, 'CLI cannot reconstruct high-risk assurance from disk');
  equal(
    JSON.parse(cliHighRisk.stdout).reason,
    'LOCAL_ASSURANCE_REQUIRED',
    'CLI high-risk denial has a stable reason',
  );

  const cliBad = await runCli(['run', '--role', 'unknown']);
  equal(cliBad.status, 2, 'dispatch CLI invalid arguments exit 2');
  equal(
    JSON.parse(cliBad.stdout).reason,
    'INVALID_ARGUMENT',
    'dispatch CLI invalid arguments emit a stable reason',
  );

  process.stdout.write(`local OpenAI dispatch: ${assertions} assertions passed\n`);
}

main().finally(() => {
  for (const socket of sockets) socket.destroy();
  server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
