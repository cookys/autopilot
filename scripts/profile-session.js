#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  createProfileRuntime,
  measureProfileRuntime,
  runProfileRuntime,
  verifyProfileRuntime,
} = require('../src/engine/profile-runtime');
const { readJson } = require('./validate-json-schema');

const HELP = `Usage:
  node scripts/profile-session.js prepare --envelope <json> --grant <json> --out <new-dir>
    [--slice <json>] --control-tokens <n> --token-source <exact-source>
    --usable-context-tokens <n> --cwd <project> [--repo <autopilot-root>]
  node scripts/profile-session.js measure --runtime <dir> --binary <claude-path> --model <id>
    --destination <id> [--transport anthropic-api] [--repo <autopilot-root>]
  node scripts/profile-session.js run --runtime <dir> --binary <claude-path> --model <id>
    --destination <id> [--transport anthropic-api] [--repo <autopilot-root>]
  node scripts/profile-session.js check --runtime <dir> [--repo <autopilot-root>]

prepare creates a workspace-bound, single-profile Claude --bare probe with no skills, hooks, tools,
or effects. measure executes a paired input-token probe. run repeats that measurement and makes one
no-effect model call. Its result is only a same-process observation. check validates content-free
artifacts but cannot turn caller-rehashable files into witnessed execution evidence.
`;

class ProfileSessionCliError extends Error {
  constructor(message, code = 'PROFILE_SESSION_USAGE') {
    super(message);
    this.name = 'ProfileSessionCliError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProfileSessionCliError(message, code);
}

function parseArgs(argv) {
  const command = argv[2];
  if (!command || ['-h', '--help', 'help'].includes(command)) return { help: true };
  const options = {};
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['-h', '--help'].includes(argument)) return { help: true };
    if (!argument.startsWith('--')) fail(`unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-/gu, '_');
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`${argument} requires a value`);
    if (options[key] !== undefined) fail(`duplicate option ${argument}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function assertOptions(options, allowed) {
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`unsupported option --${unknown[0].replace(/_/gu, '-')}`);
}

function required(options, name) {
  if (typeof options[name] !== 'string' || options[name].trim() === '') {
    fail(`--${name.replace(/_/gu, '-')} is required`);
  }
  return options[name];
}

function positiveInteger(options, name) {
  const raw = required(options, name);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`--${name.replace(/_/gu, '-')} must be a positive safe integer`);
  }
  return value;
}

function resolveRepo(options) {
  const root = path.resolve(options.repo || path.join(__dirname, '..'));
  try {
    return fs.realpathSync(root);
  } catch (error) {
    fail(`repository root is unreadable: ${error.message}`, 'PROFILE_SESSION_REPO');
  }
}

function resolveDirectory(value, label) {
  try {
    const resolved = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(resolved).isDirectory()) fail(`${label} must be a directory`);
    return resolved;
  } catch (error) {
    if (error instanceof ProfileSessionCliError) throw error;
    fail(`${label} is unreadable: ${error.message}`, 'PROFILE_SESSION_PATH');
  }
}

function commonRuntimeOptions(options) {
  return {
    runtimeRoot: resolveDirectory(required(options, 'runtime'), '--runtime'),
    repoRoot: resolveRepo(options),
  };
}

function run(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const { command, options } = parsed;
  if (command === 'prepare') {
    assertOptions(options, new Set([
      'envelope',
      'grant',
      'slice',
      'out',
      'control_tokens',
      'token_source',
      'usable_context_tokens',
      'cwd',
      'repo',
    ]));
    const envelope = readJson(path.resolve(required(options, 'envelope')), 'task authority envelope');
    const grant = readJson(path.resolve(required(options, 'grant')), 'role execution grant');
    const activeSlice = options.slice === undefined
      ? undefined
      : readJson(path.resolve(options.slice), 'active slice');
    const prepared = createProfileRuntime({
      out: path.resolve(required(options, 'out')),
      envelope,
      grant,
      activeSlice,
      declaredControlTokens: positiveInteger(options, 'control_tokens'),
      tokenSource: required(options, 'token_source'),
      usableContextTokens: positiveInteger(options, 'usable_context_tokens'),
      workspaceRoot: resolveDirectory(required(options, 'cwd'), '--cwd'),
      repoRoot: resolveRepo(options),
    });
    process.stdout.write(`${JSON.stringify({
      status: 'prepared',
      runtime_id: prepared.runtime.runtime_id,
      effective_profile: prepared.runtime.effective_profile,
      output: prepared.root,
      measurement_required: true,
      no_effect_probe: true,
      external_witness_required: true,
    }, null, 2)}\n`);
    return 0;
  }
  if (command === 'measure') {
    assertOptions(options, new Set([
      'runtime',
      'binary',
      'model',
      'destination',
      'transport',
      'repo',
    ]));
    const measurement = measureProfileRuntime({
      ...commonRuntimeOptions(options),
      binary: path.resolve(required(options, 'binary')),
      model: required(options, 'model'),
      destination: required(options, 'destination'),
      transport: options.transport || 'anthropic-api',
    });
    process.stdout.write(`${JSON.stringify({
      status: 'measured',
      measurement_id: measurement.measurement_id,
      control_tokens: measurement.control_tokens,
      ceiling_tokens: Math.min(2000, Math.floor(measurement.usable_context_tokens * 0.05)),
      token_source: measurement.source,
    }, null, 2)}\n`);
    return 0;
  }
  if (command === 'run') {
    assertOptions(options, new Set([
      'runtime',
      'binary',
      'model',
      'destination',
      'transport',
      'repo',
    ]));
    const result = runProfileRuntime({
      ...commonRuntimeOptions(options),
      binary: path.resolve(required(options, 'binary')),
      model: required(options, 'model'),
      destination: required(options, 'destination'),
      transport: options.transport || 'anthropic-api',
    });
    process.stdout.write(`${JSON.stringify({
      ...result.observation,
      exit_code: result.receipt.exit_code,
    }, null, 2)}\n`);
    return 0;
  }
  if (command === 'check') {
    assertOptions(options, new Set(['runtime', 'repo']));
    const verdict = verifyProfileRuntime(
      resolveDirectory(required(options, 'runtime'), '--runtime'),
      resolveRepo(options),
    );
    process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
    return 0;
  }
  fail(`unknown command: ${command}`);
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const code = error && error.code ? error.code : 'PROFILE_SESSION_ERROR';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === 'PROFILE_SESSION_USAGE' ? 2 : 1;
  }
}

module.exports = {
  ProfileSessionCliError,
  parseArgs,
  run,
};
