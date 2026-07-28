'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');
const { createRunnerTransportEnvelope } = require('../transport/runner-envelope');

const RUNNER = 'kimi';
const MODEL = 'kimi-code/k3';
const REQUIRED_HELP_TOKENS = Object.freeze([
  '--model',
  '--prompt',
  '--output-format',
  '--plan',
]);
const LONG_OPTION_PATTERN = /(^|[^A-Za-z0-9_-])(--[A-Za-z0-9][A-Za-z0-9-]*)(?=$|[\s=,.;:()[\]{}<>])/gm;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buffer(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value || ''), 'utf8');
}

function childErrorCode(child) {
  return child && child.error && typeof child.error.code === 'string'
    ? child.error.code
    : null;
}

function publicFailure(status, error, transportEnvelope = null, privateRawReference = null) {
  return {
    runner: RUNNER,
    model: MODEL,
    status,
    output_digest: null,
    private_raw_reference: privateRawReference,
    transport_envelope: transportEnvelope,
    error,
  };
}

function inspectKimiSurface(options = {}) {
  const bin = typeof options.bin === 'string' && options.bin.length > 0 ? options.bin : RUNNER;
  const execute = typeof options.spawnSync === 'function' ? options.spawnSync : spawnSync;
  const timeout = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : 5000;
  const run = (args) => execute(bin, args, {
    cwd: options.cwd || os.tmpdir(),
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    timeout,
    killSignal: 'SIGKILL',
  });
  const version = run(['--version']);
  if (version.error || version.status !== 0) {
    return {
      ready: false,
      version: null,
      reason: childErrorCode(version) === 'ENOENT'
        ? 'kimi_binary_missing'
        : 'kimi_version_probe_failed',
    };
  }
  const help = run(['--help']);
  if (help.error || help.status !== 0) {
    return { ready: false, version: null, reason: 'kimi_help_probe_failed' };
  }
  const helpText = String(help.stdout || '');
  const helpOptions = new Set(
    [...helpText.matchAll(LONG_OPTION_PATTERN)].map((match) => match[2]),
  );
  const missing = REQUIRED_HELP_TOKENS.filter((token) => !helpOptions.has(token));
  if (missing.length > 0) {
    return {
      ready: false,
      version: String(version.stdout || '').trim() || null,
      reason: 'kimi_required_surface_missing',
    };
  }
  return {
    ready: true,
    version: String(version.stdout || '').trim() || null,
    reason: null,
  };
}

function writePrivateRawArtifact(rawRoot, stdout, stderr) {
  const directory = fs.mkdtempSync(path.join(rawRoot || os.tmpdir(), 'autopilot-kimi-raw-'));
  fs.chmodSync(directory, 0o700);
  const locator = path.join(directory, 'transcript.bin');
  const bytes = Buffer.concat([
    Buffer.from(`stdout-bytes=${stdout.length}\n`, 'utf8'),
    stdout,
    Buffer.from(`\nstderr-bytes=${stderr.length}\n`, 'utf8'),
    stderr,
  ]);
  fs.writeFileSync(locator, bytes, { mode: 0o600 });
  fs.chmodSync(locator, 0o600);
  return {
    kind: 'private-file',
    locator,
    digest: sha256(bytes),
  };
}

function runKimiAuthor(input = {}, options = {}) {
  if (input.model !== MODEL) {
    return publicFailure('precondition_failed', 'kimi_model_must_be_kimi-code_k3');
  }
  if (typeof input.prompt !== 'string' || input.prompt.length === 0) {
    return publicFailure('precondition_failed', 'kimi_prompt_required');
  }
  const timeoutMs = Number.isInteger(input.timeoutMs) && input.timeoutMs > 0
    ? input.timeoutMs
    : 300000;
  const execute = typeof options.spawnSync === 'function' ? options.spawnSync : spawnSync;
  const bin = typeof input.bin === 'string' && input.bin.length > 0 ? input.bin : RUNNER;
  const surface = inspectKimiSurface({
    bin,
    spawnSync: execute,
    timeoutMs: Math.min(timeoutMs, 5000),
    cwd: options.probeCwd || os.tmpdir(),
    env: input.env || options.env || process.env,
  });
  if (!surface.ready) {
    return publicFailure('precondition_failed', surface.reason);
  }

  const scratch = fs.mkdtempSync(path.join(options.scratchRoot || os.tmpdir(), 'autopilot-kimi-cwd-'));
  fs.chmodSync(scratch, 0o700);
  const argv = [
    '--model', MODEL,
    '--prompt', input.prompt,
    '--output-format', 'text',
    '--plan',
  ];
  let child;
  try {
    child = execute(bin, argv, {
      cwd: scratch,
      env: input.env || options.env || process.env,
      encoding: null,
      shell: false,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: Number.isInteger(input.maxBuffer) && input.maxBuffer > 0
        ? input.maxBuffer
        : 16 * 1024 * 1024,
    });
  } catch (error) {
    child = { error, status: null, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const stdout = buffer(child.stdout);
  const stderr = buffer(child.stderr);
  const privateRawReference = writePrivateRawArtifact(options.rawRoot, stdout, stderr);
  const transportEnvelope = createRunnerTransportEnvelope({
    runner: RUNNER,
    model: MODEL,
    operation: 'author',
    argv,
    cwd: scratch,
    child: { ...child, stdout, stderr },
    privateRawReference,
  });
  if (transportEnvelope.outcome.classification !== 'success') {
    const classification = transportEnvelope.outcome.classification;
    const error = classification === 'timeout'
      ? 'kimi_timeout'
      : (childErrorCode(child) === 'ENOENT' ? 'kimi_binary_missing' : 'kimi_runner_failed');
    return publicFailure('runner_failed', error, transportEnvelope, privateRawReference);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
  } catch (_error) {
    return publicFailure(
      'malformed_output',
      'kimi_output_not_utf8',
      transportEnvelope,
      privateRawReference,
    );
  }
  if (text.trim().length === 0) {
    return publicFailure(
      'empty_output',
      'kimi_output_empty',
      transportEnvelope,
      privateRawReference,
    );
  }
  return {
    runner: RUNNER,
    model: MODEL,
    status: 'authored',
    output_digest: sha256(stdout),
    private_raw_reference: privateRawReference,
    transport_envelope: transportEnvelope,
    error: null,
  };
}

module.exports = {
  MODEL,
  REQUIRED_HELP_TOKENS,
  inspectKimiSurface,
  runKimiAuthor,
};
