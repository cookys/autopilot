#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  BrokerError,
  MAX_DIFF_BYTES,
  runBrokerCase,
  sandboxArguments,
} = require('./qualification-case-broker');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-case-broker-test-'));
let assertions = 0;

function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function setEnvironment(values) {
  for (const [name, value] of Object.entries(values)) process.env[name] = value;
}

function brokerOptions(providerScript, overrides = {}) {
  return {
    role: 'reviewer',
    provider: 'fake-provider',
    model: 'fake-model-exact',
    providerCmd: `${shellQuote(process.execPath)} ${shellQuote(providerScript)}`,
    providerEnvironment: [
      'FAKE_BROKER_LOG',
      'FAKE_BROKER_MODE',
      'FAKE_BROKER_MODEL',
      'FAKE_BROKER_PROVIDER',
      'FAKE_BROKER_SECRET',
    ],
    timeoutMs: 2_000,
    ...overrides,
  };
}

const providerScript = path.join(tempRoot, 'fake-provider.js');
fs.writeFileSync(providerScript, [
  "'use strict';",
  "const fs = require('fs');",
  "let source = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (chunk) => { source += chunk; });",
  "process.stdin.on('end', () => {",
  "  const request = JSON.parse(source);",
  "  fs.appendFileSync(process.env.FAKE_BROKER_LOG, `${JSON.stringify({",
  '    request,',
  '    ambient_secret_visible: Object.hasOwn(process.env, "AMBIENT_BROKER_SECRET"),',
  '    secret_visible: process.env.FAKE_BROKER_SECRET === "broker-secret-value",',
  "  })}\\n`);",
  "  const mode = process.env.FAKE_BROKER_MODE;",
  "  if (mode === 'timeout') { setTimeout(() => {}, 60_000); return; }",
  "  if (mode === 'malformed') { process.stdout.write('not-json'); return; }",
  "  if (mode === 'oversized') { process.stdout.write('x'.repeat(3 * 1024 * 1024)); return; }",
  '  process.stdout.write(JSON.stringify({',
  '    schema_version: 1,',
  '    provider: process.env.FAKE_BROKER_PROVIDER,',
  '    model: process.env.FAKE_BROKER_MODEL,',
  "    output: JSON.stringify({ verdict: 'pass', findings: [] }),",
  '  }));',
  '});',
  '',
].join('\n'));

const logPath = path.join(tempRoot, 'provider.jsonl');
setEnvironment({
  AMBIENT_BROKER_SECRET: 'must-not-cross',
  FAKE_BROKER_LOG: logPath,
  FAKE_BROKER_MODE: 'pass',
  FAKE_BROKER_MODEL: 'fake-model-exact',
  FAKE_BROKER_PROVIDER: 'fake-provider',
  FAKE_BROKER_SECRET: 'broker-secret-value',
});

async function main() {
  const sandboxArgs = sandboxArguments(
    {
      clientPath: '/tmp/case-only/client.js',
      socketRoot: '/tmp/case-only/socket',
    },
    'a'.repeat(48),
    'reviewer',
    2_000,
  );
  equal(
    sandboxArgs.filter((value) => value === '--unshare-net').length,
    1,
    'the sandbox always gets a private network namespace',
  );
  const writableBinds = sandboxArgs.reduce((entries, value, index) => (
    value === '--bind'
      ? [...entries, [sandboxArgs[index + 1], sandboxArgs[index + 2]]]
      : entries
  ), []);
  equal(
    writableBinds,
    [['/tmp/case-only/socket', '/broker']],
    'the one-case socket directory is the sandbox only writable host bind',
  );
  check(
    !sandboxArgs.some((value) => value.includes(process.cwd())),
    'the evaluator sandbox receives no repository path',
  );

  const firstDiff = [
    'diff --git a/a.js b/a.js',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1 +1 @@',
    '-const value = 1;',
    '+const value = 2;',
    '',
  ].join('\n');
  const first = await runBrokerCase(brokerOptions(providerScript), firstDiff);
  equal(first.status, 'ok', 'a valid provider response completes');
  equal(
    first.output,
    '{"verdict":"pass","findings":[]}',
    'only the provider output crosses back to the evaluator',
  );
  equal(first.receipt.attempt_count, 1, 'the broker performs one attempt');
  equal(first.receipt.max_attempts, 1, 'ambiguous retries are disabled');
  equal(first.receipt.socket_request_count, 1, 'one socket carries one request');
  equal(first.receipt.status, 'completed', 'the receipt records completion');
  check(/^[a-f0-9]{64}$/u.test(first.receipt.request_hash), 'request hash is bound');
  check(/^[a-f0-9]{64}$/u.test(first.receipt.response_hash), 'response hash is bound');
  check(/^[a-f0-9]{64}$/u.test(first.receipt.policy_hash), 'policy hash is bound');
  equal(
    first.receipt.expected_identity_hash,
    first.receipt.returned_identity_hash,
    'the exact returned provider/model identity is bound',
  );
  check(
    !canonicalJson(first).includes('broker-secret-value'),
    'credentials never enter broker output or receipts',
  );

  const firstLog = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  equal(firstLog.length, 1, 'the provider is invoked exactly once');
  equal(
    Object.keys(firstLog[0].request).sort(),
    ['payload', 'request_id', 'response_contract', 'role', 'schema_version'],
    'the remote adapter receives only the case protocol',
  );
  equal(
    Object.keys(firstLog[0].request.payload).sort(),
    ['content', 'format'],
    'the payload has no corpus, oracle, repository, prior-case, or authority fields',
  );
  equal(firstLog[0].request.payload.content, firstDiff, 'the request carries the exact diff');
  equal(firstLog[0].ambient_secret_visible, false, 'ambient host secrets are scrubbed');
  equal(firstLog[0].secret_visible, true, 'explicit provider credentials remain host-side');
  check(
    !/(?:repo|corpus|oracle|prior|authority)/iu.test(
      Object.keys(firstLog[0].request).join(' '),
    ),
    'forbidden evaluator metadata is absent',
  );
  const expectedRequestHash = sha256(canonicalJson(firstLog[0].request));
  equal(first.receipt.request_hash, expectedRequestHash, 'receipt binds the exact provider request');

  const secondDiff = firstDiff.replace('value = 2', 'value = 3');
  const second = await runBrokerCase(brokerOptions(providerScript), secondDiff);
  equal(second.status, 'ok', 'a second case gets a fresh broker');
  const logs = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  equal(logs.length, 2, 'each case invokes a fresh provider process once');
  check(
    logs[0].request.request_id !== logs[1].request.request_id,
    'case request identifiers do not carry across cases',
  );
  equal(
    logs[1].request.payload.content,
    secondDiff,
    'the second request contains no first-case state',
  );
  check(
    !logs[1].request.payload.content.includes('value = 2'),
    'prior case content is not disclosed',
  );

  process.env.FAKE_BROKER_MODEL = 'wrong-model';
  const mismatch = await runBrokerCase(brokerOptions(providerScript), firstDiff);
  equal(mismatch.status, 'failed', 'identity mismatch fails closed');
  equal(
    mismatch.error.code,
    'provider_identity_mismatch',
    'identity mismatch has a stable error name',
  );
  check(
    mismatch.receipt.returned_identity_hash
      !== mismatch.receipt.expected_identity_hash,
    'identity mismatch binds both identities',
  );
  check(
    /^[a-f0-9]{64}$/u.test(mismatch.receipt.response_hash),
    'identity mismatch still binds the returned response',
  );

  process.env.FAKE_BROKER_MODEL = 'fake-model-exact';
  process.env.FAKE_BROKER_MODE = 'malformed';
  const malformed = await runBrokerCase(brokerOptions(providerScript), firstDiff);
  equal(malformed.status, 'failed', 'malformed provider output fails closed');
  equal(
    malformed.error.code,
    'malformed_provider_response',
    'malformed output has a stable error name',
  );
  equal(malformed.receipt.response_hash, null, 'unparseable output cannot claim a response hash');

  process.env.FAKE_BROKER_MODE = 'timeout';
  const timeoutStarted = Date.now();
  const timeout = await runBrokerCase(
    brokerOptions(providerScript, { timeoutMs: 150 }),
    firstDiff,
  );
  equal(timeout.status, 'failed', 'provider timeout fails closed');
  equal(timeout.error.code, 'provider_timeout', 'timeout has a stable error name');
  equal(timeout.receipt.attempt_count, 1, 'timeout is never retried ambiguously');
  check(Date.now() - timeoutStarted < 5_000, 'timeout kills the provider process promptly');

  process.env.FAKE_BROKER_MODE = 'oversized';
  const oversized = await runBrokerCase(brokerOptions(providerScript), firstDiff);
  equal(oversized.status, 'failed', 'oversized provider output fails closed');
  equal(
    oversized.error.code,
    'provider_output_too_large',
    'oversized output has a stable error name',
  );

  let requestTooLarge = null;
  try {
    await runBrokerCase(
      brokerOptions(providerScript),
      `diff --git a/a b/a\n${'x'.repeat(MAX_DIFF_BYTES)}`,
    );
  } catch (error) {
    requestTooLarge = error;
  }
  check(requestTooLarge instanceof BrokerError, 'oversized request is rejected before dispatch');
  equal(requestTooLarge.code, 'request_too_large', 'oversized request has a stable error name');

  process.stdout.write(`qualification case broker: ${assertions} assertions passed\n`);
}

main().finally(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
