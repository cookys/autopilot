#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  EXACT_TOKEN_SOURCE,
  PROFILE_NAMES,
  REQUIRED_TRACE_STAGES,
  loadProfileCatalog,
  readProfileBundle,
} = require('../src/engine/profile-payload');
const { verifyProfileRuntime } = require('../src/engine/profile-runtime');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const { readJson } = require('./validate-json-schema');

const EXIT_SUCCESS = 0;
const HELP = `Usage:
  node scripts/check-profile-isolation.js --prose-only [--repo <root>]
  node scripts/check-profile-isolation.js --runtime <completed-probe-dir> [--repo <root>]
  node scripts/check-profile-isolation.js --trace <trace.json> --bundle <dir> [--repo <root>]

The runtime form validates rehashable no-effect probe artifacts and never supplies an execution
witness. The caller-authored trace form checks adapter conformance only. Neither form qualifies an
effectful transport or satisfies an independently witnessed cutover gate.
`;

class ProfileIsolationError extends Error {
  constructor(message, code = 'PROFILE_ISOLATION_FAILED') {
    super(message);
    this.name = 'ProfileIsolationError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProfileIsolationError(message, code);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    fail(`${label} must be a plain object`, 'INVALID_PROFILE_TRACE');
  }
  return value;
}

function onlyKeys(value, allowed, label) {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      fail(`${label} has unsupported key "${String(key)}"`, 'INVALID_PROFILE_TRACE');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true
      || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail(`${label}.${key} must be an enumerable data property`, 'INVALID_PROFILE_TRACE');
    }
  }
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`, 'INVALID_PROFILE_TRACE');
  }
  return value;
}

function countOccurrences(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= source.length - needle.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) break;
    count += 1;
    index = found + needle.length;
  }
  return count;
}

function lintGuidanceText(name, body) {
  if (!PROFILE_NAMES.includes(name) || typeof body !== 'string' || body.length === 0) {
    fail('guidance prose lint requires a named non-empty profile', 'PROFILE_PROSE_DRIFT');
  }
  const forbidden = [
    [/\bpermissions?\b/iu, 'permission semantics'],
    [/\bapprovals?\b/iu, 'approval semantics'],
    [/\breviewers?\b/iu, 'reviewer semantics'],
    [/\bverifiers?\b/iu, 'verifier semantics'],
    [/\btools?\b/iu, 'tool semantics'],
    [/\bdouble[- ]check\b/iu, 'double-check choreography'],
    [/\bre[- ]verify\b/iu, 're-verification choreography'],
    [/\bself[- ]review\b/iu, 'self-review choreography'],
    [
      /\b(?:ignore|override|relax|weaken|expand|broaden|bypass|change|grant)\b.{0,64}\b(?:red lines?|effects?|assurance|admission|egress|acceptance|scope)\b/iu,
      'authority-changing semantics',
    ],
    [
      /\b(?:red lines?|effects?|assurance|admission|egress|acceptance|scope)\b.{0,64}\b(?:ignore|override|relax|weaken|expand|broaden|bypass|change|grant)\b/iu,
      'authority-changing semantics',
    ],
  ];
  for (const [pattern, description] of forbidden) {
    if (pattern.test(body)) {
      fail(
        `${name} guidance contains forbidden ${description}`,
        'PROFILE_PROSE_AUTHORITY_LEAK',
      );
    }
  }
  return true;
}

function lintGuidanceBodies(repoRoot) {
  const loaded = loadProfileCatalog(repoRoot);
  for (const name of PROFILE_NAMES) lintGuidanceText(name, loaded.bodies[name]);
  const guidedFields = [
    '`slice_id`',
    '`objective`',
    '`dependencies`',
    '`inputs`',
    '`outputs`',
    '`acceptance`',
  ];
  if (guidedFields.some((field) => countOccurrences(loaded.bodies.guided, field) !== 1)) {
    fail('guided profile must declare each six-field slice key exactly once', 'PROFILE_PROSE_DRIFT');
  }
  const coreTerms = [
    'task intent',
    'acceptance contract',
    'red lines',
    'effect boundaries',
    'resource ceilings',
    'evidence requirements',
    'escalation outcomes',
    'final receipt',
  ];
  if (coreTerms.some((term) => !loaded.bodies.core.includes(term))) {
    fail('core capsule is missing a required invariant category', 'PROFILE_PROSE_DRIFT');
  }
  return {
    core_sha256: loaded.components.core.sha256,
    profile_hashes: Object.fromEntries(PROFILE_NAMES.map((name) => [
      name,
      loaded.components.profiles[name].sha256,
    ])),
  };
}

function validateLoaderAttempt(raw, label, activeProfile, inactiveProfile, bundleId) {
  const attempt = plainObject(raw, label);
  onlyKeys(
    attempt,
    new Set(['requested_profile', 'decision', 'loaded', 'loaded_bundle_id']),
    label,
  );
  if (!PROFILE_NAMES.includes(attempt.requested_profile)) {
    fail(`${label}.requested_profile is invalid`, 'INVALID_PROFILE_TRACE');
  }
  if (attempt.requested_profile === inactiveProfile) {
    if (attempt.decision !== 'fresh_session_required'
      || attempt.loaded !== false || attempt.loaded_bundle_id !== null) {
      fail(
        `${label} did not deny the inactive profile loader`,
        'INACTIVE_PROFILE_LOADABLE',
      );
    }
    return 'inactive_denied';
  }
  if (attempt.requested_profile !== activeProfile
    || !['load', 'reuse'].includes(attempt.decision)
    || attempt.loaded !== true || attempt.loaded_bundle_id !== bundleId) {
    fail(`${label} has an invalid active-profile load result`, 'INVALID_PROFILE_TRACE');
  }
  return 'active_loaded';
}

function analyzeTrace(rawTrace, bundle, repoRoot) {
  const trace = plainObject(rawTrace, 'profile trace');
  onlyKeys(trace, new Set([
    'schema_version',
    'integrity',
    'terminal_result_claimed',
    'active_profile',
    'bundle_id',
    'stages',
    'token_measurement',
  ]), 'profile trace');
  if (trace.schema_version !== 1 || trace.integrity !== 'complete'
    || trace.terminal_result_claimed !== true) {
    fail(
      'profile trace requires schema_version 1, complete integrity, and a claimed terminal result',
      'INCOMPLETE_PROFILE_TRACE',
    );
  }
  const activeProfile = trace.active_profile;
  if (!PROFILE_NAMES.includes(activeProfile)
    || activeProfile !== bundle.manifest.effective_profile
    || trace.bundle_id !== bundle.manifest.bundle_id) {
    fail('profile trace does not match the selected bundle', 'PROFILE_TRACE_BUNDLE_MISMATCH');
  }
  const inactiveProfile = PROFILE_NAMES.find((name) => name !== activeProfile);
  const loaded = loadProfileCatalog(repoRoot);
  const coreBody = loaded.bodies.core;
  const activeBody = loaded.bodies[activeProfile];
  const inactiveBody = loaded.bodies[inactiveProfile];
  const inactiveHash = loaded.components.profiles[inactiveProfile].sha256;
  const inactiveMarker = `<!-- component:${inactiveProfile} sha256:`;
  if (!Array.isArray(trace.stages) || trace.stages.length !== REQUIRED_TRACE_STAGES.length) {
    fail('profile trace must contain exactly four lifecycle stages', 'INCOMPLETE_PROFILE_TRACE');
  }
  const seenStages = new Set();
  const stageSummaries = [];
  for (let index = 0; index < trace.stages.length; index += 1) {
    const label = `profile trace.stages[${index}]`;
    const stage = plainObject(trace.stages[index], label);
    onlyKeys(stage, new Set(['stage', 'developer_prompt', 'loader_attempts']), label);
    if (!REQUIRED_TRACE_STAGES.includes(stage.stage) || seenStages.has(stage.stage)) {
      fail(`${label}.stage is missing, duplicate, or unsupported`, 'INCOMPLETE_PROFILE_TRACE');
    }
    seenStages.add(stage.stage);
    if (typeof stage.developer_prompt !== 'string' || stage.developer_prompt.length === 0) {
      fail(`${label}.developer_prompt must be non-empty`, 'INVALID_PROFILE_TRACE');
    }
    if (countOccurrences(stage.developer_prompt, bundle.payload) !== 1
      || countOccurrences(stage.developer_prompt, coreBody.trimEnd()) !== 1
      || countOccurrences(stage.developer_prompt, activeBody.trimEnd()) !== 1) {
      fail(
        `${label} does not contain core plus exactly one active profile`,
        'ACTIVE_PROFILE_CARDINALITY',
      );
    }
    if (stage.developer_prompt.includes(inactiveBody.trimEnd())
      || stage.developer_prompt.includes(inactiveHash)
      || stage.developer_prompt.includes(inactiveMarker)) {
      fail(`${label} exposes inactive profile content`, 'INACTIVE_PROFILE_VISIBLE');
    }
    if (!Array.isArray(stage.loader_attempts)) {
      fail(`${label}.loader_attempts must be an array`, 'INVALID_PROFILE_TRACE');
    }
    const outcomes = stage.loader_attempts.map((attempt, attemptIndex) => validateLoaderAttempt(
      attempt,
      `${label}.loader_attempts[${attemptIndex}]`,
      activeProfile,
      inactiveProfile,
      bundle.manifest.bundle_id,
    ));
    if (outcomes.filter((outcome) => outcome === 'inactive_denied').length !== 1) {
      fail(
        `${label} must contain one inactive-loader denial probe`,
        'INACTIVE_PROFILE_LOADER_UNPROBED',
      );
    }
    stageSummaries.push({
      stage: stage.stage,
      developer_prompt_sha256: sha256(stage.developer_prompt),
      inactive_loader_denied: true,
    });
  }
  if (REQUIRED_TRACE_STAGES.some((stage) => !seenStages.has(stage))) {
    fail('profile trace is missing a required lifecycle stage', 'INCOMPLETE_PROFILE_TRACE');
  }

  const measurement = plainObject(trace.token_measurement, 'profile trace.token_measurement');
  onlyKeys(measurement, new Set([
    'exact',
    'source',
    'baseline_input_tokens',
    'profile_input_tokens',
    'control_tokens',
    'usable_context_tokens',
  ]), 'profile trace.token_measurement');
  if (measurement.exact !== true || typeof measurement.source !== 'string'
    || !EXACT_TOKEN_SOURCE.test(measurement.source)) {
    fail('profile trace lacks an exact token source', 'PROFILE_TOKEN_MEASUREMENT_REQUIRED');
  }
  const baseline = safeInteger(
    measurement.baseline_input_tokens,
    'profile trace.token_measurement.baseline_input_tokens',
  );
  const profiled = safeInteger(
    measurement.profile_input_tokens,
    'profile trace.token_measurement.profile_input_tokens',
    1,
  );
  const control = safeInteger(
    measurement.control_tokens,
    'profile trace.token_measurement.control_tokens',
    1,
  );
  const usable = safeInteger(
    measurement.usable_context_tokens,
    'profile trace.token_measurement.usable_context_tokens',
    1,
  );
  if (profiled <= baseline || profiled - baseline !== control) {
    fail('profile token delta does not equal control_tokens', 'PROFILE_TOKEN_DELTA_MISMATCH');
  }
  const ceiling = Math.min(2000, Math.floor(usable * 0.05));
  if (control > ceiling) {
    fail(
      `profile control context ${control} exceeds ${ceiling}`,
      'PROFILE_CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return {
    schema_version: 1,
    status: 'conformance_only',
    evidence_kind: 'caller_authored_trace',
    active_profile: activeProfile,
    bundle_id: bundle.manifest.bundle_id,
    stages: stageSummaries,
    token_measurement: {
      exact: true,
      source: measurement.source,
      control_tokens: control,
      ceiling_tokens: ceiling,
    },
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (['-h', '--help', 'help'].includes(argument)) return { help: true };
    if (!argument.startsWith('--')) fail(`unexpected argument: ${argument}`, 'USAGE_ERROR');
    const key = argument.slice(2).replace(/-/gu, '_');
    if (key === 'prose_only') {
      if (options.prose_only !== undefined) fail('duplicate option --prose-only', 'USAGE_ERROR');
      options.prose_only = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${argument} requires a value`, 'USAGE_ERROR');
    }
    if (options[key] !== undefined) fail(`duplicate option ${argument}`, 'USAGE_ERROR');
    options[key] = value;
    index += 1;
  }
  return { options };
}

function run(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return EXIT_SUCCESS;
  }
  const options = parsed.options || {};
  const allowed = new Set(['prose_only', 'runtime', 'trace', 'bundle', 'repo']);
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`unsupported option --${unknown[0]}`, 'USAGE_ERROR');
  const repoRoot = path.resolve(options.repo || path.join(__dirname, '..'));
  const prose = lintGuidanceBodies(repoRoot);
  if (options.prose_only === true) {
    if (options.runtime !== undefined
      || options.trace !== undefined || options.bundle !== undefined) {
      fail('--prose-only cannot be combined with runtime or trace inputs', 'USAGE_ERROR');
    }
    process.stdout.write(`${JSON.stringify({ status: 'valid', ...prose }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (typeof options.runtime === 'string') {
    if (options.trace !== undefined || options.bundle !== undefined) {
      fail('--runtime cannot be combined with --trace or --bundle', 'USAGE_ERROR');
    }
    const result = verifyProfileRuntime(path.resolve(options.runtime), repoRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (typeof options.trace !== 'string' || typeof options.bundle !== 'string') {
    fail('--runtime or both --trace and --bundle are required', 'USAGE_ERROR');
  }
  const bundle = readProfileBundle(path.resolve(options.bundle), repoRoot);
  const result = analyzeTrace(readJson(path.resolve(options.trace), 'profile trace'), bundle, repoRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return EXIT_SUCCESS;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const code = error && error.code ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === 'USAGE_ERROR' ? 2 : 1;
  }
}

module.exports = {
  ProfileIsolationError,
  analyzeTrace,
  countOccurrences,
  lintGuidanceBodies,
  lintGuidanceText,
  parseArgs,
  run,
};
