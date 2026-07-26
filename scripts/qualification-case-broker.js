#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const process = require('process');
const { spawn } = require('child_process');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');

const BWRAP_PATH = '/usr/bin/bwrap';
const SCHEMA_VERSION = 1;
const BROKER_PROTOCOL = 'qualification-case-broker-v1';
const CLIENT_PROTOCOL = 'qualification-case-client-v1';
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SOCKET_MESSAGE_BYTES = MAX_DIFF_BYTES + 64 * 1024;
const MAX_TIMEOUT_MS = 600_000;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const FORBIDDEN_PROVIDER_ENV = new Set([
  'BASH_ENV',
  'CDPATH',
  'ENV',
  'HOME',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_OPTIONS',
  'NODE_PATH',
  'OLDPWD',
  'PATH',
  'PWD',
  'SHELLOPTS',
  'SHLVL',
  'TEMP',
  'TMP',
  'TMPDIR',
  '_',
]);

const CLIENT_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  "const net = require('net');",
  `const MAX_DIFF_BYTES = ${MAX_DIFF_BYTES};`,
  `const MAX_RESPONSE_BYTES = ${MAX_PROVIDER_OUTPUT_BYTES + 64 * 1024};`,
  'function fail(message) { process.stderr.write(`${message}\\n`); process.exit(1); }',
  "const diff = fs.readFileSync(0, 'utf8');",
  "if (Buffer.byteLength(diff) > MAX_DIFF_BYTES) fail('case diff exceeds client bound');",
  'const request = {',
  '  schema_version: 1,',
  '  request_id: process.env.CASE_REQUEST_ID,',
  '  role: process.env.CASE_ROLE,',
  "  payload: { format: 'unified_diff', content: diff },",
  '};',
  "const socket = net.createConnection('/broker/case.sock');",
  "socket.setEncoding('utf8');",
  'let response = "";',
  'let settled = false;',
  'const timer = setTimeout(() => {',
  "  if (!settled) { settled = true; socket.destroy(); fail('case broker response timeout'); }",
  '}, Number(process.env.CASE_CLIENT_TIMEOUT_MS));',
  "socket.once('connect', () => socket.write(`${JSON.stringify(request)}\\n`));",
  "socket.on('data', (chunk) => {",
  '  response += chunk;',
  '  if (Buffer.byteLength(response) > MAX_RESPONSE_BYTES) {',
  "    settled = true; socket.destroy(); fail('case broker response exceeds client bound');",
  '  }',
  '});',
  "socket.once('end', () => {",
  '  if (settled) return;',
  '  settled = true;',
  '  clearTimeout(timer);',
  '  const line = response.trim();',
  "  if (!line || line.includes('\\n')) fail('case broker returned an invalid frame');",
  '  try { JSON.parse(line); } catch { fail("case broker returned malformed JSON"); }',
  '  process.stdout.write(`${line}\\n`);',
  '});',
  "socket.once('error', (error) => {",
  '  if (settled) return;',
  '  settled = true;',
  '  clearTimeout(timer);',
  '  fail(`case broker socket failed: ${error.code || error.message}`);',
  '});',
  '',
].join('\n');

const HELP = `Usage:
  node scripts/qualification-case-broker.js run
    --role <reviewer|owner> --provider <provider-id> --model <exact-model-id>
    --provider-cmd '<trusted host adapter command>'
    [--provider-env <name>] [--timeout-ms <n>]

Reads exactly one bounded unified diff from stdin. A fresh, networkless bubblewrap client sends
that diff over a per-case Unix socket to this host broker. The broker invokes the provider
adapter once with a scrubbed environment and a case-only JSON request. Provider output must be:
{"schema_version":1,"provider":"...","model":"...","output":"..."}

The broker never retries an ambiguous request. Its receipt binds the request/response hashes,
exact returned identity, timeout, and broker policy without persisting prompt or output bodies.
`;

class BrokerError extends Error {
  constructor(message, code = 'broker_error') {
    super(message);
    this.code = code;
  }
}

function hasExactKeys(value, keys) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
    && Object.keys(value).sort().join('\0') === keys.slice().sort().join('\0');
}

function byteHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) {
    throw new BrokerError(`${label} must be a bounded protocol token`, 'invalid_argument');
  }
  return value;
}

function requireInteger(value, label, minimum, maximum) {
  if (!/^[0-9]+$/u.test(String(value))) {
    throw new BrokerError(`${label} must be an integer`, 'invalid_argument');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BrokerError(
      `${label} must be between ${minimum} and ${maximum}`,
      'invalid_argument',
    );
  }
  return parsed;
}

function parseArgs(argv) {
  if (argv.length === 0 || ['-h', '--help', 'help'].includes(argv[0])) {
    return { help: true };
  }
  if (argv[0] !== 'run') {
    throw new BrokerError(`unknown subcommand: ${argv[0]}`, 'invalid_argument');
  }
  const options = {
    providerEnvironment: [],
    timeoutMs: 300_000,
  };
  const scalar = new Map([
    ['--role', 'role'],
    ['--provider', 'provider'],
    ['--model', 'model'],
    ['--provider-cmd', 'providerCmd'],
    ['--timeout-ms', 'timeoutMs'],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--provider-env') {
      if (index + 1 >= argv.length) {
        throw new BrokerError('--provider-env requires a value', 'invalid_argument');
      }
      options.providerEnvironment.push(argv[++index]);
      continue;
    }
    const name = scalar.get(argument);
    if (!name) throw new BrokerError(`unknown argument: ${argument}`, 'invalid_argument');
    if (index + 1 >= argv.length) {
      throw new BrokerError(`${argument} requires a value`, 'invalid_argument');
    }
    options[name] = argv[++index];
  }
  for (const name of ['role', 'provider', 'model', 'providerCmd']) {
    if (!options[name]) {
      throw new BrokerError(
        `--${name.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`)} is required`,
        'invalid_argument',
      );
    }
  }
  return normalizeOptions(options);
}

function normalizeOptions(raw) {
  const role = requireToken(raw.role, 'role');
  if (!['reviewer', 'owner'].includes(role)) {
    throw new BrokerError('role must be reviewer or owner', 'invalid_argument');
  }
  const providerCmd = String(raw.providerCmd || '');
  if (providerCmd.trim().length === 0 || providerCmd.length > 16_384
      || providerCmd.includes('\0')) {
    throw new BrokerError(
      'providerCmd must be a bounded trusted-host command',
      'invalid_argument',
    );
  }
  const providerEnvironment = [...new Set(raw.providerEnvironment || [])].map((name) => {
    if (!ENV_NAME.test(name) || FORBIDDEN_PROVIDER_ENV.has(name)
        || name.startsWith('AUTOPILOT_') || name.startsWith('ENGINE_')
        || name.startsWith('CALIBRATION_') || name.startsWith('CASE_')) {
      throw new BrokerError(
        `provider environment contains forbidden name ${name}`,
        'invalid_argument',
      );
    }
    if (!Object.hasOwn(process.env, name)) {
      throw new BrokerError(
        `provider environment variable ${name} is not set`,
        'invalid_argument',
      );
    }
    return name;
  }).sort();
  return Object.freeze({
    role,
    provider: requireToken(raw.provider, 'provider'),
    model: requireToken(raw.model, 'model'),
    providerCmd,
    providerEnvironment,
    timeoutMs: requireInteger(
      raw.timeoutMs === undefined ? 300_000 : raw.timeoutMs,
      'timeoutMs',
      100,
      MAX_TIMEOUT_MS,
    ),
  });
}

async function readBoundedStdin(maximumBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBytes) {
      throw new BrokerError(
        `case diff exceeds ${maximumBytes} bytes`,
        'request_too_large',
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validateDiff(diff) {
  if (typeof diff !== 'string') {
    throw new BrokerError('case diff must be a string', 'invalid_request');
  }
  const bytes = Buffer.byteLength(diff);
  if (bytes === 0) throw new BrokerError('case diff must not be empty', 'invalid_request');
  if (bytes > MAX_DIFF_BYTES) {
    throw new BrokerError(
      `case diff exceeds ${MAX_DIFF_BYTES} bytes`,
      'request_too_large',
    );
  }
  if (diff.includes('\0')) {
    throw new BrokerError('case diff must not contain NUL bytes', 'invalid_request');
  }
  return diff;
}

function validateCaseRequest(value, expected) {
  if (!hasExactKeys(value, ['schema_version', 'request_id', 'role', 'payload'])
      || value.schema_version !== SCHEMA_VERSION
      || value.request_id !== expected.requestId
      || value.role !== expected.role
      || !hasExactKeys(value.payload, ['format', 'content'])
      || value.payload.format !== 'unified_diff'
      || value.payload.content !== expected.diff) {
    throw new BrokerError(
      'sandbox client request differs from its exact host binding',
      'request_binding_mismatch',
    );
  }
  validateDiff(value.payload.content);
  return value;
}

function parseProviderResponse(stdout, expected) {
  const source = String(stdout).trim();
  if (!source || source.includes('\n')) {
    throw new BrokerError(
      'provider response must be one JSON object',
      'malformed_provider_response',
    );
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new BrokerError('provider response is not JSON', 'malformed_provider_response');
  }
  if (!hasExactKeys(value, ['schema_version', 'provider', 'model', 'output'])
      || value.schema_version !== SCHEMA_VERSION
      || typeof value.output !== 'string'
      || Buffer.byteLength(value.output) > MAX_PROVIDER_OUTPUT_BYTES) {
    throw new BrokerError(
      'provider response has an invalid shape',
      'malformed_provider_response',
    );
  }
  requireToken(value.provider, 'returned provider');
  requireToken(value.model, 'returned model');
  if (value.provider !== expected.provider || value.model !== expected.model) {
    const error = new BrokerError(
      'provider returned a different exact identity',
      'provider_identity_mismatch',
    );
    error.returnedIdentityHash = sha256(canonicalJson({
      provider: value.provider,
      model: value.model,
    }));
    error.responseHash = sha256(canonicalJson(value));
    throw error;
  }
  return Object.freeze({
    value,
    responseHash: sha256(canonicalJson(value)),
    returnedIdentityHash: sha256(canonicalJson({
      provider: value.provider,
      model: value.model,
    })),
  });
}

function killProcessTree(child) {
  if (!child || !Number.isSafeInteger(child.pid)) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The child may already have exited.
    }
  }
}

function runChild(command, args, options, limits = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let oversized = false;
    const stdoutLimit = limits.stdout || MAX_PROVIDER_OUTPUT_BYTES;
    const stderrLimit = limits.stderr || 256 * 1024;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, limits.timeoutMs);
    child.once('error', (error) => finish(error));
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) {
        oversized = true;
        killProcessTree(child);
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= stderrLimit) stderr.push(chunk);
    });
    child.once('close', (status, signal) => {
      finish(null, {
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderrHash: byteHash(Buffer.concat(stderr)),
        timedOut,
        oversized,
      });
    });
    child.stdin.once('error', () => {});
    child.stdin.end(options.input || '');
  });
}

function providerEnvironment(options, providerRoot) {
  const environment = {
    HOME: providerRoot,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    PATH: process.env.PATH || '/usr/bin:/bin',
    TMPDIR: providerRoot,
  };
  for (const name of options.providerEnvironment) {
    environment[name] = process.env[name];
  }
  return environment;
}

async function executeProvider(options, providerRoot, providerRequest) {
  const result = await runChild(
    '/usr/bin/bash',
    ['-c', options.providerCmd],
    {
      cwd: providerRoot,
      env: providerEnvironment(options, providerRoot),
      input: `${canonicalJson(providerRequest)}\n`,
    },
    {
      timeoutMs: options.timeoutMs,
      stdout: MAX_PROVIDER_OUTPUT_BYTES + 64 * 1024,
      stderr: 256 * 1024,
    },
  );
  if (result.timedOut) {
    throw new BrokerError('provider request timed out ambiguously', 'provider_timeout');
  }
  if (result.oversized) {
    throw new BrokerError('provider response exceeded its bound', 'provider_output_too_large');
  }
  if (result.signal || result.status !== 0) {
    const error = new BrokerError(
      `provider adapter exited unsuccessfully (${result.status ?? result.signal})`,
      'provider_process_failed',
    );
    error.stderrHash = result.stderrHash;
    throw error;
  }
  return parseProviderResponse(result.stdout, options);
}

function sandboxArguments(paths, requestId, role, timeoutMs) {
  return [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-net',
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--dir', '/case',
    '--dir', '/broker',
    '--dir', '/work',
    '--dir', '/work/home',
    '--ro-bind', process.execPath, '/case/node',
    '--ro-bind', paths.clientPath, '/case/client.js',
    '--bind', paths.socketRoot, '/broker',
    '--chdir', '/work',
    '--clearenv',
    '--setenv', 'CASE_REQUEST_ID', requestId,
    '--setenv', 'CASE_ROLE', role,
    '--setenv', 'CASE_CLIENT_TIMEOUT_MS', String(timeoutMs + 5_000),
    '--setenv', 'HOME', '/work/home',
    '--setenv', 'NO_COLOR', '1',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'TMPDIR', '/tmp',
    '/case/node', '/case/client.js',
  ];
}

function receiptFor(options, policyHash, requestHash, outcome) {
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    protocol: BROKER_PROTOCOL,
    status: outcome.status,
    request_hash: requestHash,
    response_hash: outcome.responseHash || null,
    expected_identity_hash: sha256(canonicalJson({
      provider: options.provider,
      model: options.model,
    })),
    returned_identity_hash: outcome.returnedIdentityHash || null,
    provider: options.provider,
    model: options.model,
    timeout_ms: options.timeoutMs,
    policy_hash: policyHash,
    attempt_count: 1,
    max_attempts: 1,
    socket_request_count: 1,
  });
}

function failedResponse(error, receipt = null) {
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    status: 'failed',
    output: null,
    error: {
      code: error && error.code ? error.code : 'broker_error',
    },
    receipt,
  });
}

function successfulResponse(output, receipt) {
  return Object.freeze({
    schema_version: SCHEMA_VERSION,
    status: 'ok',
    output,
    error: null,
    receipt,
  });
}

async function runBrokerCase(rawOptions, rawDiff) {
  const options = normalizeOptions(rawOptions);
  const diff = validateDiff(rawDiff);
  let bwrapStat;
  try {
    bwrapStat = fs.lstatSync(BWRAP_PATH);
  } catch {
    throw new BrokerError('bubblewrap is unavailable', 'sandbox_unavailable');
  }
  if (!bwrapStat.isFile() || bwrapStat.isSymbolicLink() || (bwrapStat.mode & 0o111) === 0) {
    throw new BrokerError('bubblewrap is not a trusted executable', 'sandbox_unavailable');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-case-broker-'));
  const socketRoot = path.join(tempRoot, 'socket');
  const providerRoot = path.join(tempRoot, 'provider');
  const clientPath = path.join(tempRoot, 'client.js');
  fs.mkdirSync(socketRoot, { mode: 0o700 });
  fs.mkdirSync(providerRoot, { mode: 0o700 });
  fs.writeFileSync(clientPath, CLIENT_SOURCE, { mode: 0o600 });
  const socketPath = path.join(socketRoot, 'case.sock');
  const requestId = crypto.randomBytes(24).toString('hex');
  const policyHash = sha256(canonicalJson({
    protocol: BROKER_PROTOCOL,
    client_protocol: CLIENT_PROTOCOL,
    client_hash: sha256(CLIENT_SOURCE),
    broker_hash: byteHash(fs.readFileSync(__filename)),
    sandbox: 'bubblewrap-networkless-single-unix-socket-v1',
    bwrap_path: BWRAP_PATH,
    provider_command_hash: sha256(options.providerCmd),
    provider_environment_names: options.providerEnvironment,
    provider: options.provider,
    model: options.model,
    role: options.role,
    timeout_ms: options.timeoutMs,
    max_attempts: 1,
    max_diff_bytes: MAX_DIFF_BYTES,
    max_provider_output_bytes: MAX_PROVIDER_OUTPUT_BYTES,
  }));

  let server;
  let transactionResolve;
  let transactionReject;
  const transaction = new Promise((resolve, reject) => {
    transactionResolve = resolve;
    transactionReject = reject;
  });
  let accepted = false;

  try {
    server = net.createServer({ allowHalfOpen: true }, (socket) => {
      if (accepted) {
        socket.destroy();
        return;
      }
      accepted = true;
      server.close();
      socket.setEncoding('utf8');
      let source = '';
      let handled = false;
      const respond = (response) => {
        if (handled) return;
        handled = true;
        const serialized = `${canonicalJson(response)}\n`;
        socket.end(serialized);
        transactionResolve(response);
      };
      socket.on('data', (chunk) => {
        if (handled) return;
        source += chunk;
        if (Buffer.byteLength(source) > MAX_SOCKET_MESSAGE_BYTES) {
          respond(failedResponse(new BrokerError(
            'sandbox client request exceeded its bound',
            'request_too_large',
          )));
          return;
        }
        const newline = source.indexOf('\n');
        if (newline === -1) return;
        if (source.slice(newline + 1).trim().length !== 0) {
          respond(failedResponse(new BrokerError(
            'sandbox client sent more than one request',
            'multiple_requests',
          )));
          return;
        }
        let request;
        try {
          request = JSON.parse(source.slice(0, newline));
          validateCaseRequest(request, { requestId, role: options.role, diff });
        } catch (error) {
          respond(failedResponse(
            error instanceof BrokerError
              ? error
              : new BrokerError('sandbox request is malformed', 'invalid_request'),
          ));
          return;
        }
        const providerRequest = {
          schema_version: SCHEMA_VERSION,
          request_id: requestId,
          role: options.role,
          payload: request.payload,
          response_contract: {
            schema_version: SCHEMA_VERSION,
            format: 'json-text',
          },
        };
        const requestHash = sha256(canonicalJson(providerRequest));
        executeProvider(options, providerRoot, providerRequest).then((providerResult) => {
          const receipt = receiptFor(options, policyHash, requestHash, {
            status: 'completed',
            responseHash: providerResult.responseHash,
            returnedIdentityHash: providerResult.returnedIdentityHash,
          });
          respond(successfulResponse(providerResult.value.output, receipt));
        }).catch((error) => {
          const receipt = receiptFor(options, policyHash, requestHash, {
            status: 'failed',
            responseHash: error.responseHash || null,
            returnedIdentityHash: error.returnedIdentityHash || null,
          });
          respond(failedResponse(error, receipt));
        });
      });
      socket.once('error', (error) => {
        if (!handled) transactionReject(error);
      });
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });

    const client = runChild(
      BWRAP_PATH,
      sandboxArguments(
        { clientPath, socketRoot },
        requestId,
        options.role,
        options.timeoutMs,
      ),
      {
        cwd: providerRoot,
        env: {
          HOME: providerRoot,
          LANG: 'C.UTF-8',
          LC_ALL: 'C.UTF-8',
          PATH: '/usr/bin:/bin',
          TMPDIR: providerRoot,
        },
        input: diff,
      },
      {
        timeoutMs: options.timeoutMs + 10_000,
        stdout: MAX_PROVIDER_OUTPUT_BYTES + 128 * 1024,
        stderr: 256 * 1024,
      },
    );

    let transactionTimer;
    const guardedTransaction = Promise.race([
      transaction,
      new Promise((_, reject) => {
        transactionTimer = setTimeout(() => {
          reject(new BrokerError(
            'one-shot broker transaction did not complete',
            'broker_transaction_timeout',
          ));
        }, options.timeoutMs + 15_000);
      }),
    ]);
    let clientResult;
    let brokerResponse;
    try {
      [clientResult, brokerResponse] = await Promise.all([client, guardedTransaction]);
    } finally {
      clearTimeout(transactionTimer);
    }
    if (clientResult.timedOut) {
      throw new BrokerError('sandbox client timed out', 'sandbox_timeout');
    }
    if (clientResult.oversized) {
      throw new BrokerError('sandbox client output exceeded its bound', 'sandbox_output_too_large');
    }
    if (clientResult.signal || clientResult.status !== 0) {
      throw new BrokerError(
        `sandbox client failed (${clientResult.status ?? clientResult.signal})`,
        'sandbox_failed',
      );
    }
    let clientResponse;
    try {
      clientResponse = JSON.parse(clientResult.stdout.trim());
    } catch {
      throw new BrokerError('sandbox client returned malformed output', 'sandbox_failed');
    }
    if (canonicalJson(clientResponse) !== canonicalJson(brokerResponse)) {
      throw new BrokerError(
        'sandbox response differs from the host transaction',
        'response_binding_mismatch',
      );
    }
    return brokerResponse;
  } finally {
    if (server) {
      try {
        server.close();
      } catch {
        // The one-shot server may already be closed.
      }
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(HELP);
      return 0;
    }
    const diff = await readBoundedStdin(MAX_DIFF_BYTES);
    const result = await runBrokerCase(options, diff);
    process.stdout.write(`${canonicalJson(result)}\n`);
    return result.status === 'ok' ? 0 : 1;
  } catch (error) {
    const brokerError = error instanceof BrokerError
      ? error
      : new BrokerError(error.message || 'broker failed');
    process.stdout.write(`${canonicalJson(failedResponse(brokerError))}\n`);
    if (brokerError.code === 'invalid_argument') process.stderr.write(HELP);
    return brokerError.code === 'invalid_argument' ? 2 : 1;
  }
}

if (require.main === module) {
  main().then((status) => {
    process.exitCode = status;
  }).catch((error) => {
    process.stderr.write(`qualification-case-broker: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BROKER_PROTOCOL,
  BrokerError,
  CLIENT_PROTOCOL,
  CLIENT_SOURCE,
  MAX_DIFF_BYTES,
  MAX_PROVIDER_OUTPUT_BYTES,
  normalizeOptions,
  parseProviderResponse,
  runBrokerCase,
  sandboxArguments,
};
