'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { TextDecoder } = require('util');
const {
  canonicalJson,
  cloneCanonical,
  isSha256,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
const { normalizeTaskAuthorityEnvelope } = require('./owner-kernel/task-authority');
const { normalizeRoleExecutionGrant } = require('./execution-profile');
const {
  DEFAULT_REPO_ROOT,
  buildProfileBundle,
  loadProfileCatalog,
  normalizeActiveSlice,
  readProfileBundle,
  renderExecutionCapsule,
} = require('./profile-payload');
const {
  assertJsonValue,
  preflightJsonSource,
} = require('../../scripts/validate-json-schema');

const PROFILE_RUNTIME_SCHEMA_VERSION = 1;
const PROFILE_RUNTIME_RUNNER = 'claude-bare-probe';
const MEASUREMENT_PROMPT = 'Return exactly OK.';
const EXECUTION_PROMPT = 'Evaluate the rendered role grant and return its required evidence.';
const MAX_RUNNER_OUTPUT_BYTES = 16 * 1024 * 1024;
const REQUIRED_CLAUDE_FLAGS = Object.freeze([
  '--bare',
  '--disable-slash-commands',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--verbose',
]);
const ROUTING_ENVIRONMENT_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
]);

function runtimeError(message, code = 'INVALID_PROFILE_RUNTIME') {
  throw new OwnerKernelError(message, code);
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function strictObject(value, label) {
  try {
    assertJsonValue(value, label);
  } catch (error) {
    runtimeError(error.message, error.code || 'INVALID_PROFILE_RUNTIME');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype
      && Object.getPrototypeOf(value) !== null)) {
    runtimeError(`${label} must be a plain JSON object`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    runtimeError(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function safeInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    runtimeError(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function boundedString(value, label, maximum = 4096) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > maximum) {
    runtimeError(`${label} must be a non-empty string no longer than ${maximum} characters`);
  }
  return value;
}

function readStrictJson(file, label) {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
    preflightJsonSource(source, label);
    return JSON.parse(source);
  } catch (error) {
    runtimeError(`${label} is unreadable: ${error.message}`, error.code || 'PROFILE_RUNTIME_UNREADABLE');
  }
}

function writeExclusive(file, source, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, source, { encoding: 'utf8', flag: 'wx', mode });
}

function writeJsonExclusive(file, value) {
  writeExclusive(file, `${JSON.stringify(value, null, 2)}\n`);
}

function workspaceIdentity(workspaceRoot) {
  let root;
  let stat;
  try {
    root = fs.realpathSync(path.resolve(boundedString(
      workspaceRoot,
      'profile runtime workspace',
      4096,
    )));
    stat = fs.statSync(root, { bigint: true });
  } catch (error) {
    runtimeError(
      `profile runtime workspace is unavailable: ${error.message}`,
      'PROFILE_WORKSPACE_UNAVAILABLE',
    );
  }
  if (!stat.isDirectory()) {
    runtimeError('profile runtime workspace must be a directory', 'PROFILE_WORKSPACE_UNAVAILABLE');
  }
  const body = {
    root,
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
  };
  return cloneCanonical({ ...body, workspace_id: sha256(canonicalJson(body)) });
}

function normalizeWorkspace(raw) {
  const value = strictObject(raw, 'profile runtime workspace identity');
  exactKeys(
    value,
    new Set(['root', 'device', 'inode', 'workspace_id']),
    'profile runtime workspace identity',
  );
  boundedString(value.root, 'profile runtime workspace identity.root', 4096);
  if (!/^[0-9]+$/u.test(value.device) || !/^[0-9]+$/u.test(value.inode)
    || !isSha256(value.workspace_id)) {
    runtimeError('profile runtime workspace identity is invalid', 'PROFILE_WORKSPACE_DRIFT');
  }
  const current = workspaceIdentity(value.root);
  if (canonicalJson(value) !== canonicalJson(current)) {
    runtimeError('profile runtime workspace identity drifted', 'PROFILE_WORKSPACE_DRIFT');
  }
  return current;
}

function runtimeFileSet(profile, measured = false, outcome = null, locked = false) {
  const names = [
    'envelope.json',
    'grant.json',
    'hook-policy.json',
    'manifest.json',
    'profile.md',
    'runtime.json',
    'system-prompt.md',
  ];
  if (profile === 'guided') names.push('slice.json');
  if (measured) names.push('measurement.json');
  if (outcome === 'success') names.push('run-receipt.json');
  if (outcome === 'failure') names.push('failure-receipt.json');
  if (locked) names.push('launch.lock');
  return names.sort();
}

function listRuntimeFiles(root) {
  const files = [];
  function visit(relative = '') {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
      else runtimeError('profile runtime may contain only regular files', 'PROFILE_RUNTIME_EXTRA_FILES');
    }
  }
  visit();
  return files.sort();
}

function assertRuntimeFileSet(root, profile, measured = false, outcome = null, locked = false) {
  const actual = listRuntimeFiles(root);
  const expected = runtimeFileSet(profile, measured, outcome, locked);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    runtimeError('profile runtime contains missing or extra files', 'PROFILE_RUNTIME_EXTRA_FILES');
  }
}

function runtimeBody({
  envelope,
  grant,
  rendered,
  bundle,
  declaredMeasurement,
  workspace,
}) {
  const body = {
    schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
    artifact_kind: 'autopilot_profile_runtime',
    runner: PROFILE_RUNTIME_RUNNER,
    effective_profile: grant.effective_profile,
    task_authority_id: envelope.task_authority_id,
    grant_id: grant.grant_id,
    bundle_id: bundle.manifest.bundle_id,
    capsule_sha256: sha256(rendered.capsule),
    declared_context_measurement: cloneCanonical(declaredMeasurement),
    context_ceiling_tokens: rendered.context_budget.ceiling_tokens,
    hook_policy_sha256: bundle.hooks.hook_policy_id,
    invariant_hook_set_sha256: bundle.hooks.invariant_hook_set_hash,
    workspace: cloneCanonical(workspace),
    launch_contract: {
      purpose: 'no_effect_context_isolation_probe',
      fresh_process: true,
      one_shot: true,
      session_persistence: false,
      skill_catalog: false,
      hooks_enabled: false,
      tools_enabled: false,
      effects_enabled: false,
      fallback_allowed: false,
      external_witness_required: true,
      required_flags: [...REQUIRED_CLAUDE_FLAGS],
    },
  };
  return cloneCanonical({ ...body, runtime_id: sha256(canonicalJson(body)) });
}

function assertProbeOnlyGrant(grant) {
  if (grant.model_identity.runner !== PROFILE_RUNTIME_RUNNER) {
    runtimeError(
      `role grant runner must be ${PROFILE_RUNTIME_RUNNER}`,
      'PROFILE_RUNNER_IDENTITY_MISMATCH',
    );
  }
  if (grant.allowed_tools.length !== 0
    || (grant.capability_scope.tool_surface || []).length !== 0
    || (grant.effect_subset.effects || []).length !== 0) {
    runtimeError(
      'claude bare profile probe accepts no tools or effects',
      'PROFILE_RUNTIME_EFFECTFUL_GRANT',
    );
  }
}

function createProfileRuntime({
  out,
  envelope: rawEnvelope,
  grant: rawGrant,
  activeSlice,
  declaredControlTokens,
  tokenSource,
  usableContextTokens,
  workspaceRoot,
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const target = path.resolve(boundedString(out, 'profile runtime output', 4096));
  if (fs.existsSync(target)) {
    runtimeError('profile runtime output already exists', 'PROFILE_RUNTIME_EXISTS');
  }
  const envelope = normalizeTaskAuthorityEnvelope(rawEnvelope);
  const grant = normalizeRoleExecutionGrant(rawGrant, envelope);
  assertProbeOnlyGrant(grant);
  const usable = safeInteger(usableContextTokens, 'usable context tokens', 1);
  if (usable !== grant.context_budget.max_input_tokens) {
    runtimeError(
      'usable context tokens must equal the role grant input-token ceiling',
      'PROFILE_CONTEXT_BUDGET_MISMATCH',
    );
  }
  const normalizedSlice = grant.effective_profile === 'guided'
    ? normalizeActiveSlice(activeSlice)
    : activeSlice;
  const bundle = buildProfileBundle(grant.effective_profile, repoRoot);
  const declaredMeasurement = {
    tokens: safeInteger(declaredControlTokens, 'declared control tokens', 1),
    source: boundedString(tokenSource, 'token source', 160),
    exact: true,
  };
  const rendered = renderExecutionCapsule({
    bundle,
    envelope,
    grant,
    activeSlice: normalizedSlice,
    tokenCounter: () => declaredMeasurement,
    usableContextTokens: usable,
    repoRoot,
  });
  const workspace = workspaceIdentity(workspaceRoot);
  const runtime = runtimeBody({
    envelope,
    grant,
    rendered,
    bundle,
    declaredMeasurement,
    workspace,
  });
  try {
    fs.mkdirSync(target, { mode: 0o700 });
    writeJsonExclusive(path.join(target, 'runtime.json'), runtime);
    writeJsonExclusive(path.join(target, 'manifest.json'), bundle.manifest);
    writeExclusive(path.join(target, 'profile.md'), bundle.payload);
    writeJsonExclusive(path.join(target, 'hook-policy.json'), bundle.hooks);
    writeExclusive(path.join(target, 'system-prompt.md'), rendered.capsule);
    writeJsonExclusive(path.join(target, 'envelope.json'), envelope);
    writeJsonExclusive(path.join(target, 'grant.json'), grant);
    if (grant.effective_profile === 'guided') {
      writeJsonExclusive(path.join(target, 'slice.json'), normalizedSlice);
    }
    assertRuntimeFileSet(target, grant.effective_profile);
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (error instanceof OwnerKernelError) throw error;
    runtimeError(`profile runtime write failed: ${error.message}`, 'PROFILE_RUNTIME_WRITE');
  }
  return loadProfileRuntime(target, repoRoot);
}

function loadProfileRuntime(runtimeRoot, repoRoot = DEFAULT_REPO_ROOT) {
  let root;
  try {
    root = fs.realpathSync(runtimeRoot);
  } catch (error) {
    runtimeError(`profile runtime is unavailable: ${error.message}`, 'PROFILE_RUNTIME_UNREADABLE');
  }
  const runtime = strictObject(
    readStrictJson(path.join(root, 'runtime.json'), 'profile runtime manifest'),
    'profile runtime manifest',
  );
  exactKeys(runtime, new Set([
    'schema_version',
    'artifact_kind',
    'runner',
    'effective_profile',
    'task_authority_id',
    'grant_id',
    'bundle_id',
    'capsule_sha256',
    'declared_context_measurement',
    'context_ceiling_tokens',
    'hook_policy_sha256',
    'invariant_hook_set_sha256',
    'workspace',
    'launch_contract',
    'runtime_id',
  ]), 'profile runtime manifest');
  if (runtime.schema_version !== PROFILE_RUNTIME_SCHEMA_VERSION
    || runtime.artifact_kind !== 'autopilot_profile_runtime'
    || runtime.runner !== PROFILE_RUNTIME_RUNNER
    || !['guided', 'autonomous'].includes(runtime.effective_profile)
    || !isSha256(runtime.runtime_id)) {
    runtimeError('profile runtime manifest has an unsupported shape');
  }
  const success = fs.existsSync(path.join(root, 'run-receipt.json'));
  const failure = fs.existsSync(path.join(root, 'failure-receipt.json'));
  if (success && failure) {
    runtimeError('profile runtime has conflicting terminal receipts', 'PROFILE_RUNTIME_RECEIPT_DRIFT');
  }
  const measured = fs.existsSync(path.join(root, 'measurement.json'));
  const outcome = success ? 'success' : (failure ? 'failure' : null);
  const completed = outcome !== null;
  const locked = fs.existsSync(path.join(root, 'launch.lock'));
  if (completed && !measured) runtimeError('completed runtime lacks measurement evidence');
  if (locked && (!measured || completed)) {
    runtimeError('profile runtime has an invalid launch reservation');
  }
  assertRuntimeFileSet(root, runtime.effective_profile, measured, outcome, locked);

  const bundle = readProfileBundle(root, repoRoot);
  const envelope = normalizeTaskAuthorityEnvelope(
    readStrictJson(path.join(root, 'envelope.json'), 'runtime envelope'),
  );
  const grant = normalizeRoleExecutionGrant(
    readStrictJson(path.join(root, 'grant.json'), 'runtime grant'),
    envelope,
  );
  assertProbeOnlyGrant(grant);
  const activeSlice = runtime.effective_profile === 'guided'
    ? readStrictJson(path.join(root, 'slice.json'), 'runtime active slice')
    : undefined;
  const declared = strictObject(runtime.declared_context_measurement, 'declared context measurement');
  exactKeys(declared, new Set(['tokens', 'source', 'exact']), 'declared context measurement');
  const rendered = renderExecutionCapsule({
    bundle,
    envelope,
    grant,
    activeSlice,
    tokenCounter: () => declared,
    usableContextTokens: grant.context_budget.max_input_tokens,
    repoRoot,
  });
  const workspace = normalizeWorkspace(runtime.workspace);
  const expected = runtimeBody({
    envelope,
    grant,
    rendered,
    bundle,
    declaredMeasurement: declared,
    workspace,
  });
  if (canonicalJson(runtime) !== canonicalJson(expected)
    || fs.readFileSync(path.join(root, 'system-prompt.md'), 'utf8') !== rendered.capsule) {
    runtimeError('profile runtime does not match its canonical inputs', 'PROFILE_RUNTIME_DRIFT');
  }
  return {
    root,
    runtime: cloneCanonical(runtime),
    bundle,
    envelope,
    grant,
    activeSlice: activeSlice === undefined ? undefined : cloneCanonical(activeSlice),
    rendered,
    workspace,
    measured,
    completed,
    outcome,
    locked,
  };
}

function executableIdentity(binary, cwd) {
  let resolved;
  try {
    resolved = fs.realpathSync(binary);
  } catch (error) {
    runtimeError(`runner binary is unavailable: ${error.message}`, 'PROFILE_RUNNER_UNAVAILABLE');
  }
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) runtimeError('runner binary must be a regular file', 'PROFILE_RUNNER_UNAVAILABLE');
  const version = spawnSync(resolved, ['--version'], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  if (version.status !== 0 || version.signal || version.error) {
    runtimeError('runner version probe failed', 'PROFILE_RUNNER_UNAVAILABLE');
  }
  return cloneCanonical({
    path: resolved,
    binary_sha256: sha256Bytes(fs.readFileSync(resolved)),
    version_sha256: sha256(`${version.stdout || ''}${version.stderr || ''}`),
  });
}

function resolveProviderRoute(destination, transport, environment = process.env) {
  boundedString(destination, 'profile runner destination', 256);
  boundedString(transport, 'profile runner transport', 128);
  if (environment.AUTOPILOT_PROFILE_TEST_RUNNER === '1') {
    if (transport !== 'test-fixture') {
      runtimeError('test runner requires test-fixture transport', 'PROFILE_EGRESS_IDENTITY_MISMATCH');
    }
    const body = { kind: 'test_fixture', destination, transport };
    return cloneCanonical({ ...body, route_id: sha256(canonicalJson(body)) });
  }
  const configured = ROUTING_ENVIRONMENT_KEYS.filter((key) => {
    const value = environment[key];
    return typeof value === 'string' && value.trim() !== '' && value !== '0'
      && value.toLowerCase() !== 'false';
  });
  if (configured.length > 0) {
    runtimeError(
      `claude bare probe does not verify routed provider environment: ${configured.join(', ')}`,
      'PROFILE_EGRESS_IDENTITY_MISMATCH',
    );
  }
  if (transport !== 'anthropic-api' || destination !== 'https://api.anthropic.com') {
    runtimeError(
      'claude bare probe supports only the direct Anthropic API route',
      'PROFILE_EGRESS_IDENTITY_MISMATCH',
    );
  }
  if (typeof environment.ANTHROPIC_API_KEY !== 'string'
    || environment.ANTHROPIC_API_KEY.trim() === '') {
    runtimeError(
      'claude bare probe requires ANTHROPIC_API_KEY',
      'PROFILE_RUNNER_CREDENTIAL_UNAVAILABLE',
    );
  }
  const body = { kind: 'direct_anthropic_api', destination, transport };
  return cloneCanonical({ ...body, route_id: sha256(canonicalJson(body)) });
}

function usageInputTokens(raw, label) {
  strictObject(raw, label);
  const candidates = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && value.usage && typeof value.usage === 'object') {
      candidates.push(value.usage);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(raw);
  const totals = candidates.map((usage, index) => {
    const input = safeInteger(usage.input_tokens, `${label}.usage[${index}].input_tokens`);
    const creation = usage.cache_creation_input_tokens === undefined
      ? 0
      : safeInteger(
        usage.cache_creation_input_tokens,
        `${label}.usage[${index}].cache_creation_input_tokens`,
      );
    const read = usage.cache_read_input_tokens === undefined
      ? 0
      : safeInteger(
        usage.cache_read_input_tokens,
        `${label}.usage[${index}].cache_read_input_tokens`,
      );
    return input + creation + read;
  });
  if (totals.length === 0) {
    runtimeError(`${label} lacks harness input-token usage`, 'PROFILE_TOKEN_MEASUREMENT_REQUIRED');
  }
  return Math.max(...totals);
}

function reportedModels(raw) {
  const models = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) {
      if (typeof value.model === 'string' && value.model.trim() !== '') {
        models.add(value.model);
      }
      if (value.modelUsage && typeof value.modelUsage === 'object'
        && !Array.isArray(value.modelUsage)) {
        for (const model of Object.keys(value.modelUsage)) {
          if (model.trim() !== '') models.add(model);
        }
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(raw);
  return [...models].sort();
}

function assertExactReportedModel(raw, runtime, label) {
  const models = reportedModels(raw);
  if (canonicalJson(models) !== canonicalJson([runtime.grant.model_identity.identity])) {
    runtimeError(
      `${label} does not report the exact granted model identity`,
      'PROFILE_RUNNER_IDENTITY_MISMATCH',
    );
  }
  return models[0];
}

function claudeArgs(runtime, model, systemPrompt, outputFormat = 'json') {
  return [
    '-p',
    '--bare',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--verbose',
    '--output-format',
    outputFormat,
    '--model',
    model,
    '--system-prompt-file',
    systemPrompt,
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
  ];
}

function invokeClaude(binary, args, input, cwd, timeoutMs) {
  const result = spawnSync(binary, args, {
    cwd,
    input,
    timeout: timeoutMs,
    maxBuffer: MAX_RUNNER_OUTPUT_BYTES,
    env: { ...process.env, AUTOPILOT_PROFILE_RUNTIME: '1' },
  });
  if (result.error || result.signal || result.status !== 0) {
    runtimeError(
      `profile runner failed (${result.signal || result.status || result.error.message})`,
      'PROFILE_RUNNER_FAILED',
    );
  }
  try {
    return {
      ...result,
      stdout: new TextDecoder('utf-8', { fatal: true }).decode(result.stdout),
      stderr: new TextDecoder('utf-8', { fatal: true }).decode(result.stderr),
    };
  } catch (error) {
    runtimeError(
      `profile runner output is not valid UTF-8: ${error.message}`,
      'PROFILE_RUNNER_OUTPUT_INVALID',
    );
  }
}

function parseRunnerJson(source, label) {
  try {
    preflightJsonSource(source, label);
    return JSON.parse(source);
  } catch (error) {
    runtimeError(`${label} is not strict JSON: ${error.message}`, 'PROFILE_RUNNER_OUTPUT_INVALID');
  }
}

function assertRunnerEgress(grant, destination, transport) {
  const allowed = grant.egress_subset.some((entry) => (
    entry.data_class === 'task_prompt'
    && entry.route_class === 'runner'
    && entry.destination === destination
    && entry.transport === transport
  ));
  if (!allowed) {
    runtimeError(
      'role grant does not allow task_prompt egress to this runner destination',
      'PROFILE_EGRESS_DENIED',
    );
  }
}

function runTokenPair(runtime, identity, model, timeoutMs) {
  const baselinePath = path.join(runtime.root, '.baseline-system-prompt');
  fs.writeFileSync(baselinePath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  let baseline;
  let profiled;
  try {
    baseline = invokeClaude(
      identity.path,
      claudeArgs(runtime, model, baselinePath),
      MEASUREMENT_PROMPT,
      runtime.workspace.root,
      timeoutMs,
    );
    profiled = invokeClaude(
      identity.path,
      claudeArgs(runtime, model, path.join(runtime.root, 'system-prompt.md')),
      MEASUREMENT_PROMPT,
      runtime.workspace.root,
      timeoutMs,
    );
  } finally {
    fs.rmSync(baselinePath, { force: true });
  }
  const baselineJson = parseRunnerJson(baseline.stdout, 'baseline runner output');
  const profileJson = parseRunnerJson(profiled.stdout, 'profile runner output');
  const baselineModel = assertExactReportedModel(
    baselineJson,
    runtime,
    'baseline runner output',
  );
  const profileModel = assertExactReportedModel(
    profileJson,
    runtime,
    'profile runner output',
  );
  if (baselineModel !== profileModel) {
    runtimeError('token probe model identity changed between arms', 'PROFILE_RUNNER_IDENTITY_MISMATCH');
  }
  const baselineTokens = usageInputTokens(baselineJson, 'baseline runner output');
  const profileTokens = usageInputTokens(profileJson, 'profile runner output');
  const controlTokens = profileTokens - baselineTokens;
  if (!Number.isSafeInteger(controlTokens) || controlTokens < 1) {
    runtimeError('harness input-token delta is not positive', 'PROFILE_TOKEN_DELTA_MISMATCH');
  }
  if (controlTokens !== runtime.runtime.declared_context_measurement.tokens) {
    runtimeError(
      'harness input-token delta differs from the prepared exact measurement',
      'PROFILE_TOKEN_DELTA_MISMATCH',
    );
  }
  if (controlTokens > runtime.runtime.context_ceiling_tokens) {
    runtimeError(
      `profile control context ${controlTokens} exceeds ${runtime.runtime.context_ceiling_tokens}`,
      'PROFILE_CONTEXT_BUDGET_EXCEEDED',
    );
  }
  return cloneCanonical({
    exact_model: profileModel,
    baseline_input_tokens: baselineTokens,
    profile_input_tokens: profileTokens,
    control_tokens: controlTokens,
    baseline_output_sha256: sha256(baseline.stdout),
    profile_output_sha256: sha256(profiled.stdout),
  });
}

function measureProfileRuntime({
  runtimeRoot,
  binary,
  model,
  destination,
  transport = 'anthropic-api',
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const runtime = loadProfileRuntime(runtimeRoot, repoRoot);
  if (runtime.measured) runtimeError('profile runtime was already measured', 'PROFILE_RUNTIME_ALREADY_MEASURED');
  if (model !== runtime.grant.model_identity.model_alias) {
    runtimeError('runner model does not match the role grant alias', 'PROFILE_RUNNER_IDENTITY_MISMATCH');
  }
  assertRunnerEgress(runtime.grant, destination, transport);
  const route = resolveProviderRoute(destination, transport);
  const identity = executableIdentity(binary, runtime.workspace.root);
  const timeoutMs = Math.min(runtime.grant.resource_budget.max_wall_seconds * 1000, 300000);
  const observed = runTokenPair(runtime, identity, model, timeoutMs);
  const body = {
    schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
    artifact_kind: 'autopilot_profile_measurement',
    runtime_id: runtime.runtime.runtime_id,
    runner: PROFILE_RUNTIME_RUNNER,
    requested_model: model,
    reported_model: observed.exact_model,
    destination,
    transport,
    provider_route_id: route.route_id,
    workspace_id: runtime.workspace.workspace_id,
    exact: true,
    source: 'harness_reported_input_delta',
    baseline_input_tokens: observed.baseline_input_tokens,
    profile_input_tokens: observed.profile_input_tokens,
    control_tokens: observed.control_tokens,
    usable_context_tokens: runtime.grant.context_budget.max_input_tokens,
    binary_sha256: identity.binary_sha256,
    version_sha256: identity.version_sha256,
    baseline_output_sha256: observed.baseline_output_sha256,
    profile_output_sha256: observed.profile_output_sha256,
  };
  const measurement = cloneCanonical({
    ...body,
    measurement_id: sha256(canonicalJson(body)),
  });
  writeJsonExclusive(path.join(runtime.root, 'measurement.json'), measurement);
  loadProfileRuntime(runtime.root, repoRoot);
  return measurement;
}

function normalizeMeasurement(raw, runtime) {
  const measurement = strictObject(raw, 'profile runtime measurement');
  exactKeys(measurement, new Set([
    'schema_version',
    'artifact_kind',
    'runtime_id',
    'runner',
    'requested_model',
    'reported_model',
    'destination',
    'transport',
    'provider_route_id',
    'workspace_id',
    'exact',
    'source',
    'baseline_input_tokens',
    'profile_input_tokens',
    'control_tokens',
    'usable_context_tokens',
    'binary_sha256',
    'version_sha256',
    'baseline_output_sha256',
    'profile_output_sha256',
    'measurement_id',
  ]), 'profile runtime measurement');
  const body = { ...measurement };
  delete body.measurement_id;
  const baselineTokens = safeInteger(
    measurement.baseline_input_tokens,
    'profile runtime measurement.baseline_input_tokens',
  );
  const profileTokens = safeInteger(
    measurement.profile_input_tokens,
    'profile runtime measurement.profile_input_tokens',
    1,
  );
  const controlTokens = safeInteger(
    measurement.control_tokens,
    'profile runtime measurement.control_tokens',
    1,
  );
  const usableTokens = safeInteger(
    measurement.usable_context_tokens,
    'profile runtime measurement.usable_context_tokens',
    1,
  );
  if (measurement.schema_version !== PROFILE_RUNTIME_SCHEMA_VERSION
    || measurement.artifact_kind !== 'autopilot_profile_measurement'
    || measurement.runtime_id !== runtime.runtime.runtime_id
    || measurement.runner !== PROFILE_RUNTIME_RUNNER
    || measurement.requested_model !== runtime.grant.model_identity.model_alias
    || measurement.reported_model !== runtime.grant.model_identity.identity
    || measurement.workspace_id !== runtime.workspace.workspace_id
    || measurement.exact !== true
    || measurement.source !== 'harness_reported_input_delta'
    || !isSha256(measurement.provider_route_id)
    || !isSha256(measurement.binary_sha256)
    || !isSha256(measurement.version_sha256)
    || !isSha256(measurement.baseline_output_sha256)
    || !isSha256(measurement.profile_output_sha256)
    || !isSha256(measurement.measurement_id)
    || measurement.measurement_id !== sha256(canonicalJson(body))
    || profileTokens - baselineTokens !== controlTokens
    || controlTokens !== runtime.runtime.declared_context_measurement.tokens
    || controlTokens > runtime.runtime.context_ceiling_tokens
    || usableTokens !== runtime.grant.context_budget.max_input_tokens) {
    runtimeError('profile runtime measurement is invalid', 'PROFILE_MEASUREMENT_DRIFT');
  }
  boundedString(measurement.destination, 'profile runtime measurement.destination', 256);
  boundedString(measurement.transport, 'profile runtime measurement.transport', 128);
  assertRunnerEgress(runtime.grant, measurement.destination, measurement.transport);
  return cloneCanonical(measurement);
}

function acquireLaunchLock(runtime, measurement, startedAt) {
  const lock = {
    schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
    runtime_id: runtime.runtime.runtime_id,
    measurement_id: measurement.measurement_id,
    started_at: startedAt,
  };
  try {
    writeJsonExclusive(path.join(runtime.root, 'launch.lock'), lock);
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      runtimeError('profile runtime is already running', 'PROFILE_RUNTIME_ALREADY_RUNNING');
    }
    throw error;
  }
}

function summarizeRunnerStream(source, runtime) {
  const lines = source.split(/\r?\n/u).filter((line) => line.trim() !== '');
  const eventTypes = Object.create(null);
  const models = new Set();
  let finalUsage = null;
  let terminalResults = 0;
  function inspectCapability(value) {
    if (!value || typeof value !== 'object') return false;
    if (!Array.isArray(value) && typeof value.type === 'string'
      && /(tool_use|tool_result|hook)/iu.test(value.type)) return true;
    return Object.values(value).some(inspectCapability);
  }
  for (const [index, line] of lines.entries()) {
    const event = strictObject(
      parseRunnerJson(line, `profile runner event ${index}`),
      `profile runner event ${index}`,
    );
    if (inspectCapability(event)) {
      runtimeError(
        'no-effect profile probe emitted a tool or hook event',
        'PROFILE_RUNTIME_EFFECT_SURFACE',
      );
    }
    const type = typeof event.type === 'string'
      && /^[A-Za-z0-9_.:-]{1,64}$/u.test(event.type)
      ? event.type
      : 'unknown';
    eventTypes[type] = (eventTypes[type] || 0) + 1;
    if (type === 'result') {
      terminalResults += 1;
      if (event.is_error === true) {
        runtimeError('profile runner returned an error result', 'PROFILE_RUNNER_FAILED');
      }
    }
    for (const model of reportedModels(event)) models.add(model);
    try {
      const tokens = usageInputTokens(event, `profile runner event ${index}`);
      finalUsage = Math.max(finalUsage || 0, tokens);
    } catch (error) {
      if (!(error instanceof OwnerKernelError)
        || error.code !== 'PROFILE_TOKEN_MEASUREMENT_REQUIRED') throw error;
    }
  }
  if (lines.length === 0 || terminalResults !== 1 || finalUsage === null) {
    runtimeError(
      'profile runner stream lacks exactly one terminal result with input-token usage',
      'PROFILE_RUNNER_OUTPUT_INVALID',
    );
  }
  const observedModels = [...models].sort();
  if (canonicalJson(observedModels) !== canonicalJson([runtime.grant.model_identity.identity])) {
    runtimeError(
      'profile runner stream does not bind the exact granted model',
      'PROFILE_RUNNER_IDENTITY_MISMATCH',
    );
  }
  if (finalUsage > runtime.grant.context_budget.max_input_tokens) {
    runtimeError('profile runner exceeded the granted input-token ceiling', 'PROFILE_CONTEXT_BUDGET_EXCEEDED');
  }
  return cloneCanonical({
    lines: lines.length,
    event_types: eventTypes,
    final_input_tokens: finalUsage,
    reported_model: observedModels[0],
  });
}

function failureReceipt(runtime, measurement, startedAt, stage, error) {
  const completedAt = new Date().toISOString();
  const body = {
    schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
    artifact_kind: 'autopilot_profile_failure_receipt',
    runtime_id: runtime.runtime.runtime_id,
    measurement_id: measurement.measurement_id,
    runner: PROFILE_RUNTIME_RUNNER,
    requested_model: measurement.requested_model,
    reported_model: measurement.reported_model,
    destination: measurement.destination,
    transport: measurement.transport,
    provider_route_id: measurement.provider_route_id,
    workspace_id: runtime.workspace.workspace_id,
    started_at: startedAt,
    completed_at: completedAt,
    failure_stage: stage,
    error_code: error && error.code ? error.code : 'PROFILE_RUNTIME_FAILURE',
    process_may_have_started: true,
    one_shot: true,
    terminal_witness: false,
    external_witness_required: true,
    fallback_used: false,
  };
  return cloneCanonical({
    ...body,
    failure_receipt_id: sha256(canonicalJson(body)),
  });
}

function runProfileRuntime({
  runtimeRoot,
  binary,
  model,
  destination,
  transport = 'anthropic-api',
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const runtime = loadProfileRuntime(runtimeRoot, repoRoot);
  if (!runtime.measured) runtimeError('profile runtime requires harness measurement before launch', 'PROFILE_RUNTIME_UNMEASURED');
  if (runtime.completed) runtimeError('profile runtime is one-shot and already completed', 'PROFILE_RUNTIME_ALREADY_USED');
  if (runtime.locked) runtimeError('profile runtime is already running', 'PROFILE_RUNTIME_ALREADY_RUNNING');
  const measurement = normalizeMeasurement(
    readStrictJson(path.join(runtime.root, 'measurement.json'), 'profile runtime measurement'),
    runtime,
  );
  if (model !== measurement.requested_model || destination !== measurement.destination
    || transport !== measurement.transport) {
    runtimeError('launch identity differs from measured identity', 'PROFILE_RUNNER_IDENTITY_MISMATCH');
  }
  assertRunnerEgress(runtime.grant, destination, transport);
  const route = resolveProviderRoute(destination, transport);
  if (route.route_id !== measurement.provider_route_id) {
    runtimeError('provider route changed after measurement', 'PROFILE_EGRESS_IDENTITY_MISMATCH');
  }
  const timeoutMs = Math.min(runtime.grant.resource_budget.max_wall_seconds * 1000, 3600000);
  const startedAt = new Date().toISOString();
  acquireLaunchLock(runtime, measurement, startedAt);
  let terminalWritten = false;
  let stage = 'runner_identity';
  let receipt;
  let observation;
  try {
    const identity = executableIdentity(binary, runtime.workspace.root);
    if (identity.binary_sha256 !== measurement.binary_sha256
      || identity.version_sha256 !== measurement.version_sha256) {
      runtimeError('runner binary changed after measurement', 'PROFILE_RUNNER_IDENTITY_MISMATCH');
    }
    stage = 'measurement_replay';
    const replay = runTokenPair(runtime, identity, model, Math.min(timeoutMs, 300000));
    stage = 'probe_execution';
    const result = invokeClaude(
      identity.path,
      claudeArgs(runtime, model, path.join(runtime.root, 'system-prompt.md'), 'stream-json'),
      EXECUTION_PROMPT,
      runtime.workspace.root,
      timeoutMs,
    );
    stage = 'stream_validation';
    const stream = summarizeRunnerStream(result.stdout, runtime);
    const completedAt = new Date().toISOString();
    const body = {
      schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
      artifact_kind: 'autopilot_profile_run_receipt',
      runtime_id: runtime.runtime.runtime_id,
      measurement_id: measurement.measurement_id,
      runner: PROFILE_RUNTIME_RUNNER,
      requested_model: model,
      reported_model: stream.reported_model,
      destination,
      transport,
      provider_route_id: route.route_id,
      workspace_id: runtime.workspace.workspace_id,
      started_at: startedAt,
      completed_at: completedAt,
      purpose: 'no_effect_context_isolation_probe',
      process_observed: true,
      terminal_result_observed: true,
      terminal_witness: false,
      external_witness_required: true,
      exit_code: result.status,
      signal: null,
      one_shot: true,
      session_persistence: false,
      skill_catalog: false,
      hooks_enabled: false,
      tools_enabled: false,
      effects_enabled: false,
      fallback_used: false,
      command_flags: [...REQUIRED_CLAUDE_FLAGS],
      replay_control_tokens: replay.control_tokens,
      event_count: stream.lines,
      event_types: stream.event_types,
      final_input_tokens: stream.final_input_tokens,
      stdout_sha256: sha256(result.stdout),
      stderr_sha256: sha256(result.stderr),
    };
    receipt = cloneCanonical({ ...body, receipt_id: sha256(canonicalJson(body)) });
    writeJsonExclusive(path.join(runtime.root, 'run-receipt.json'), receipt);
    terminalWritten = true;
    observation = cloneCanonical({
      schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
      status: 'observed',
      evidence_kind: 'same_process_runner_observation',
      observation_id: sha256(canonicalJson({
        receipt_id: receipt.receipt_id,
        nonce: crypto.randomBytes(32).toString('hex'),
      })),
      runtime_id: receipt.runtime_id,
      receipt_id: receipt.receipt_id,
      measurement_id: receipt.measurement_id,
      active_profile: runtime.runtime.effective_profile,
      process_observed: true,
      terminal_result_observed: true,
      terminal_witness: false,
      external_witness_required: true,
      no_effect_probe: true,
      inactive_loader_disabled_by_flags: true,
    });
  } catch (error) {
    if (!terminalWritten) {
      const failed = failureReceipt(runtime, measurement, startedAt, stage, error);
      try {
        writeJsonExclusive(path.join(runtime.root, 'failure-receipt.json'), failed);
        terminalWritten = true;
      } catch {
        terminalWritten = false;
      }
    }
    throw error;
  } finally {
    if (terminalWritten) fs.rmSync(path.join(runtime.root, 'launch.lock'), { force: true });
  }
  loadProfileRuntime(runtime.root, repoRoot);
  return { receipt, observation };
}

function normalizeReceipt(raw, runtime, measurement) {
  const receipt = strictObject(raw, 'profile runtime receipt');
  exactKeys(receipt, new Set([
    'schema_version',
    'artifact_kind',
    'runtime_id',
    'measurement_id',
    'runner',
    'requested_model',
    'reported_model',
    'destination',
    'transport',
    'provider_route_id',
    'workspace_id',
    'started_at',
    'completed_at',
    'purpose',
    'process_observed',
    'terminal_result_observed',
    'terminal_witness',
    'external_witness_required',
    'exit_code',
    'signal',
    'one_shot',
    'session_persistence',
    'skill_catalog',
    'hooks_enabled',
    'tools_enabled',
    'effects_enabled',
    'fallback_used',
    'command_flags',
    'replay_control_tokens',
    'event_count',
    'event_types',
    'final_input_tokens',
    'stdout_sha256',
    'stderr_sha256',
    'receipt_id',
  ]), 'profile runtime receipt');
  const eventTypes = strictObject(receipt.event_types, 'profile runtime receipt.event_types');
  const eventCount = safeInteger(receipt.event_count, 'profile runtime receipt.event_count', 1);
  const eventTotal = Object.entries(eventTypes).reduce((sum, [type, count]) => {
    if (!/^[A-Za-z0-9_.:-]{1,64}$/u.test(type)) {
      runtimeError('profile runtime receipt has an invalid event type', 'PROFILE_RUNTIME_RECEIPT_DRIFT');
    }
    return sum + safeInteger(count, `profile runtime receipt.event_types.${type}`, 1);
  }, 0);
  const started = Date.parse(receipt.started_at);
  const completed = Date.parse(receipt.completed_at);
  const body = { ...receipt };
  delete body.receipt_id;
  if (receipt.schema_version !== PROFILE_RUNTIME_SCHEMA_VERSION
    || receipt.artifact_kind !== 'autopilot_profile_run_receipt'
    || !isSha256(receipt.receipt_id)
    || receipt.receipt_id !== sha256(canonicalJson(body))
    || receipt.runtime_id !== runtime.runtime.runtime_id
    || receipt.measurement_id !== measurement.measurement_id
    || receipt.runner !== PROFILE_RUNTIME_RUNNER
    || receipt.requested_model !== measurement.requested_model
    || receipt.reported_model !== measurement.reported_model
    || receipt.destination !== measurement.destination
    || receipt.transport !== measurement.transport
    || receipt.provider_route_id !== measurement.provider_route_id
    || receipt.workspace_id !== runtime.workspace.workspace_id
    || !Number.isFinite(started)
    || !Number.isFinite(completed)
    || completed < started
    || receipt.purpose !== 'no_effect_context_isolation_probe'
    || receipt.process_observed !== true
    || receipt.terminal_result_observed !== true
    || receipt.terminal_witness !== false
    || receipt.external_witness_required !== true
    || receipt.exit_code !== 0
    || receipt.signal !== null
    || receipt.one_shot !== true
    || receipt.session_persistence !== false
    || receipt.skill_catalog !== false
    || receipt.hooks_enabled !== false
    || receipt.tools_enabled !== false
    || receipt.effects_enabled !== false
    || receipt.fallback_used !== false
    || canonicalJson(receipt.command_flags) !== canonicalJson(REQUIRED_CLAUDE_FLAGS)
    || receipt.replay_control_tokens !== measurement.control_tokens
    || eventCount !== eventTotal
    || eventTypes.result !== 1
    || !Number.isSafeInteger(receipt.final_input_tokens)
    || receipt.final_input_tokens < 1
    || receipt.final_input_tokens > runtime.grant.context_budget.max_input_tokens
    || !isSha256(receipt.stdout_sha256)
    || !isSha256(receipt.stderr_sha256)) {
    runtimeError('profile runtime receipt is invalid', 'PROFILE_RUNTIME_RECEIPT_DRIFT');
  }
  return cloneCanonical(receipt);
}

function normalizeFailureReceipt(raw, runtime, measurement) {
  const receipt = strictObject(raw, 'profile runtime failure receipt');
  exactKeys(receipt, new Set([
    'schema_version',
    'artifact_kind',
    'runtime_id',
    'measurement_id',
    'runner',
    'requested_model',
    'reported_model',
    'destination',
    'transport',
    'provider_route_id',
    'workspace_id',
    'started_at',
    'completed_at',
    'failure_stage',
    'error_code',
    'process_may_have_started',
    'one_shot',
    'terminal_witness',
    'external_witness_required',
    'fallback_used',
    'failure_receipt_id',
  ]), 'profile runtime failure receipt');
  const body = { ...receipt };
  delete body.failure_receipt_id;
  const started = Date.parse(receipt.started_at);
  const completed = Date.parse(receipt.completed_at);
  if (receipt.schema_version !== PROFILE_RUNTIME_SCHEMA_VERSION
    || receipt.artifact_kind !== 'autopilot_profile_failure_receipt'
    || receipt.runtime_id !== runtime.runtime.runtime_id
    || receipt.measurement_id !== measurement.measurement_id
    || receipt.runner !== PROFILE_RUNTIME_RUNNER
    || receipt.requested_model !== measurement.requested_model
    || receipt.reported_model !== measurement.reported_model
    || receipt.destination !== measurement.destination
    || receipt.transport !== measurement.transport
    || receipt.provider_route_id !== measurement.provider_route_id
    || receipt.workspace_id !== runtime.workspace.workspace_id
    || !Number.isFinite(started)
    || !Number.isFinite(completed)
    || completed < started
    || !/^[a-z_]{3,64}$/u.test(receipt.failure_stage)
    || !/^[A-Z0-9_]{3,96}$/u.test(receipt.error_code)
    || receipt.process_may_have_started !== true
    || receipt.one_shot !== true
    || receipt.terminal_witness !== false
    || receipt.external_witness_required !== true
    || receipt.fallback_used !== false
    || !isSha256(receipt.failure_receipt_id)
    || receipt.failure_receipt_id !== sha256(canonicalJson(body))) {
    runtimeError('profile runtime failure receipt is invalid', 'PROFILE_RUNTIME_RECEIPT_DRIFT');
  }
  return cloneCanonical(receipt);
}

function scanInactiveProfile(runtime, measurement, terminalReceipt, repoRoot) {
  const catalog = loadProfileCatalog(repoRoot);
  const inactive = runtime.runtime.effective_profile === 'guided' ? 'autonomous' : 'guided';
  const inactiveBody = catalog.bodies[inactive].trimEnd();
  const inactiveHash = catalog.components.profiles[inactive].sha256;
  const outcome = runtime.outcome;
  for (const relative of runtimeFileSet(
    runtime.runtime.effective_profile,
    true,
    outcome,
  )) {
    const source = fs.readFileSync(path.join(runtime.root, relative), 'utf8');
    if (source.includes(inactiveBody) || source.includes(inactiveHash)
      || source.includes(`component:${inactive}`)) {
      runtimeError('profile runtime exposes inactive profile material', 'INACTIVE_PROFILE_VISIBLE');
    }
  }
  return Boolean(measurement && terminalReceipt);
}

function verifyProfileRuntime(runtimeRoot, repoRoot = DEFAULT_REPO_ROOT) {
  const runtime = loadProfileRuntime(runtimeRoot, repoRoot);
  if (!runtime.measured || !runtime.completed) {
    runtimeError('profile runtime lacks measurement or terminal receipt', 'PROFILE_RUNTIME_INCOMPLETE');
  }
  const measurement = normalizeMeasurement(
    readStrictJson(path.join(runtime.root, 'measurement.json'), 'profile runtime measurement'),
    runtime,
  );
  const terminalReceipt = runtime.outcome === 'success'
    ? normalizeReceipt(
      readStrictJson(path.join(runtime.root, 'run-receipt.json'), 'profile runtime receipt'),
      runtime,
      measurement,
    )
    : normalizeFailureReceipt(
      readStrictJson(
        path.join(runtime.root, 'failure-receipt.json'),
        'profile runtime failure receipt',
      ),
      runtime,
      measurement,
    );
  scanInactiveProfile(runtime, measurement, terminalReceipt, repoRoot);
  return cloneCanonical({
    schema_version: PROFILE_RUNTIME_SCHEMA_VERSION,
    status: runtime.outcome === 'success' ? 'structural_only' : 'failed',
    evidence_kind: 'unwitnessed_runtime_artifacts',
    execution_outcome: runtime.outcome,
    runtime_id: runtime.runtime.runtime_id,
    receipt_id: runtime.outcome === 'success' ? terminalReceipt.receipt_id : null,
    failure_receipt_id: runtime.outcome === 'failure'
      ? terminalReceipt.failure_receipt_id
      : null,
    measurement_id: measurement.measurement_id,
    active_profile: runtime.runtime.effective_profile,
    control_tokens: measurement.control_tokens,
    ceiling_tokens: runtime.runtime.context_ceiling_tokens,
    invariant_hook_set_hash: runtime.bundle.hooks.invariant_hook_set_hash,
    configured_hook_count: runtime.bundle.hooks.invariant_effect_hooks.length
      + runtime.bundle.hooks.guidance_hooks.length,
    hooks_executed: false,
    tools_enabled: false,
    effects_enabled: false,
    process_observed: false,
    terminal_witness: false,
    external_witness_required: true,
    inactive_profile_absent_from_artifacts: true,
    inactive_loader_disabled_by_contract: true,
  });
}

module.exports = {
  MAX_RUNNER_OUTPUT_BYTES,
  EXECUTION_PROMPT,
  MEASUREMENT_PROMPT,
  PROFILE_RUNTIME_RUNNER,
  PROFILE_RUNTIME_SCHEMA_VERSION,
  REQUIRED_CLAUDE_FLAGS,
  assertRuntimeFileSet,
  createProfileRuntime,
  executableIdentity,
  loadProfileRuntime,
  measureProfileRuntime,
  resolveProviderRoute,
  runProfileRuntime,
  usageInputTokens,
  verifyProfileRuntime,
  workspaceIdentity,
};
