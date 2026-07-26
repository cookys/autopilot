#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const process = require('process');
const { spawnSync } = require('child_process');
const {
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
  verifyEvaluationCorpus,
} = require('../src/engine/capability-evidence');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  CLEAN_COUNT,
  GENERATOR_VERSION,
  KNOWN_BAD_COUNT,
  PINNED_CLEAN_COUNT,
  PINNED_KNOWN_BAD_COUNT,
  RULES,
  generateReviewerEvaluation,
} = require('../evals/reviewer-eval-generator');
const {
  appendRow,
  ensureDir,
  expandTilde,
  maxEventId,
  toEventId,
  withWriteLock,
} = require('./lib/jsonl-store');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'evals', 'capability-evidence-corpus.json');
const GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'reviewer-eval-generator.js');
const BWRAP_PATH = '/usr/bin/bwrap';
const EXPECTED_CORPUS_VERSION = 'reviewer-known-bad-clean-v2';
const EXPECTED_CORPUS_MANIFEST_HASH =
  '5da0e10515211ce4a14f575cbc1d7272c6bcc42183b7ef37e7135df2344e00e1';
const EXPECTED_ARTIFACT_ORACLE_HASH =
  '0f0a5519a0eade5de937aff0f6ed78e79b21cfcdc9fcf9476f3897b876ee86f5';
const EXPECTED_GENERATOR_HASH =
  'a5d686853ee5e070f7e2a598e5999f063ad48110e2223d3e684834b4e8d525f3';
const QUALIFIER_PRODUCER = 'engine-qualify-v2';
const SHA256 = /^[a-f0-9]{64}$/iu;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SANDBOX_DESTINATION = /^\/(?:panel|auth)(?:\/[A-Za-z0-9._-]+)+$/u;
const WITNESS_PROTOCOL_VERSION = 'behavioral-call-v1';
const MAX_WITNESS_BYTES = 16 * 1024;
const FORBIDDEN_PANEL_ENV = new Set([
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
const WITNESS_RUNNER_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  'function emit(value) { process.stdout.write(JSON.stringify(value)); }',
  '(async () => {',
  "  const witness = JSON.parse(fs.readFileSync('/case/witness.json', 'utf8'));",
  '  for (const [name, value] of Object.entries(witness.environment)) process.env[name] = value;',
  '  try {',
  "    let callable = require('/case/target.cjs');",
  '    for (const segment of witness.export_path) callable = callable[segment];',
  "    if (typeof callable !== 'function') throw new TypeError('witness export is not callable');",
  '    const value = await callable(...witness.args);',
  "    if (value === undefined || typeof value === 'function' || typeof value === 'symbol'",
  "        || typeof value === 'bigint') {",
  "      emit({ kind: 'unsupported_return' });",
  '    } else {',
  "      emit({ kind: 'returns', value });",
  '    }',
  '  } catch (error) {',
  "    emit({ kind: 'throws', name: error && error.name ? String(error.name) : 'Error' });",
  '  }',
  '})().catch(() => { process.exitCode = 1; });',
  '',
].join('\n');
const HOST_OBSERVED_RUNS = new WeakSet();
const ACTIVE_SESSION_RUNS = new Map();

const HELP = `Usage:
  scripts/engine-qualify.sh reviewer
    --engine <display-id> --model <exact-model-id> --model-version <version>
    --runner <name> --runner-version <version> --family <family>
    --harness-version <version> --effort <effort>
    --prompt-config-hash <sha256> --semantic-fingerprint <sha256>
    --containment-fingerprint <sha256> --panel-cmd '<trusted command>'
    [--panel-bind-ro <absolute-source>=</panel/or/auth/path>] [--panel-env <name>]
    --task-class <class> --domain <domain> --language <language> --tool <tool>
    [--trials <n>] [--expires-days <n>] [--store <path>] [--emit-row]

The qualifier generates fresh metamorphic known-bad, clean, and defect-reversal trials. Each
panel process reads one diff on stdin inside a new fail-closed bubblewrap sandbox. It must emit
{"verdict":"pass|fail","findings":[...]}; failing findings include rule_id, severity, file,
line, and a structured ${WITNESS_PROTOCOL_VERSION} witness. The host executes that witness
against before/after code in a separate no-network sandbox and accepts it only when the stated
behavior holds before and fails after. Bind only the panel runtime/auth inputs it needs. The
repository, evaluation oracle, host home, and previous cases are not mounted. JSONL output is
diagnostic telemetry, not admission authority. Only a live in-process host-observed run can
create a session-local role-capability verifier; serializing the run destroys that capability.

Exit codes:
  0 = qualification passed
  1 = qualification failed
  2 = usage/precondition error
`;

function usage(code, message = null) {
  if (message) process.stderr.write(`engine-qualify: ${message}\n`);
  (code === 0 ? process.stdout : process.stderr).write(HELP);
  process.exit(code);
}

function token(value, label) {
  if (typeof value !== 'string' || !TOKEN.test(value)) usage(2, `${label} must be a protocol token`);
  return value;
}

function digest(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) usage(2, `${label} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function byteHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function positiveInteger(value, label, minimum = 1) {
  if (!/^[0-9]+$/u.test(String(value))) usage(2, `${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    usage(2, `${label} must be >= ${minimum}`);
  }
  return parsed;
}

function parseArgs(argv) {
  if (argv.length === 0) usage(2);
  if (['-h', '--help', 'help'].includes(argv[0])) usage(0);
  if (argv[0] !== 'reviewer') usage(2, `unknown subcommand: ${argv[0]}`);
  const options = {
    trials: 2,
    expiresDays: 30,
    store: null,
    emitRow: false,
    taskClasses: [],
    domains: [],
    languages: [],
    tools: [],
    panelReadOnlyBinds: [],
    panelEnvironment: [],
  };
  const scalar = new Map([
    ['--engine', 'engine'],
    ['--model', 'model'],
    ['--model-version', 'modelVersion'],
    ['--runner', 'runner'],
    ['--runner-version', 'runnerVersion'],
    ['--family', 'family'],
    ['--harness-version', 'harnessVersion'],
    ['--effort', 'effort'],
    ['--prompt-config-hash', 'promptConfigHash'],
    ['--semantic-fingerprint', 'semanticFingerprint'],
    ['--containment-fingerprint', 'containmentFingerprint'],
    ['--panel-cmd', 'panelCmd'],
    ['--trials', 'trials'],
    ['--expires-days', 'expiresDays'],
    ['--store', 'store'],
  ]);
  const repeated = new Map([
    ['--task-class', 'taskClasses'],
    ['--domain', 'domains'],
    ['--language', 'languages'],
    ['--tool', 'tools'],
    ['--panel-bind-ro', 'panelReadOnlyBinds'],
    ['--panel-env', 'panelEnvironment'],
  ]);
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--emit-row') {
      options.emitRow = true;
      continue;
    }
    if (['-h', '--help'].includes(arg)) usage(0);
    const scalarName = scalar.get(arg);
    const repeatedName = repeated.get(arg);
    if (!scalarName && !repeatedName) usage(2, `unknown argument: ${arg}`);
    if (index + 1 >= argv.length) usage(2, `missing value for ${arg}`);
    const value = argv[++index];
    if (scalarName) options[scalarName] = value;
    else options[repeatedName].push(value);
  }
  for (const name of [
    'engine',
    'model',
    'modelVersion',
    'runner',
    'runnerVersion',
    'family',
    'harnessVersion',
    'effort',
    'promptConfigHash',
    'semanticFingerprint',
    'containmentFingerprint',
    'panelCmd',
  ]) {
    if (!options[name]) usage(2, `--${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  for (const [name, option] of [
    ['taskClasses', '--task-class'],
    ['domains', '--domain'],
    ['languages', '--language'],
    ['tools', '--tool'],
  ]) {
    if (options[name].length === 0) usage(2, `${option} is required`);
    options[name] = [...new Set(options[name].map((value) => token(value, option)))].sort();
  }
  options.engine = token(options.engine, '--engine');
  options.model = token(options.model, '--model');
  options.modelVersion = token(options.modelVersion, '--model-version');
  options.runner = token(options.runner, '--runner');
  options.runnerVersion = token(options.runnerVersion, '--runner-version');
  options.family = token(options.family, '--family');
  options.harnessVersion = token(options.harnessVersion, '--harness-version');
  options.effort = token(options.effort, '--effort');
  options.promptConfigHash = digest(options.promptConfigHash, '--prompt-config-hash');
  options.semanticFingerprint = digest(options.semanticFingerprint, '--semantic-fingerprint');
  options.containmentFingerprint = digest(
    options.containmentFingerprint,
    '--containment-fingerprint',
  );
  options.panelReadOnlyBinds = options.panelReadOnlyBinds.map(
    (value) => parseReadOnlyBind(value),
  );
  const bindDestinations = options.panelReadOnlyBinds.map((bind) => bind.destination);
  if (new Set(bindDestinations).size !== bindDestinations.length) {
    usage(2, '--panel-bind-ro destinations must be unique');
  }
  options.panelEnvironment = [...new Set(options.panelEnvironment.map((name) => {
    if (!ENV_NAME.test(name)) usage(2, '--panel-env must be an environment variable name');
    if (FORBIDDEN_PANEL_ENV.has(name)
        || name.startsWith('AUTOPILOT_') || name.startsWith('ENGINE_')
        || name.startsWith('CALIBRATION_')) {
      usage(2, `--panel-env cannot expose host control variable ${name}`);
    }
    if (!Object.hasOwn(process.env, name)) usage(2, `--panel-env ${name} is not set`);
    return name;
  }))].sort();
  options.trials = positiveInteger(options.trials, '--trials', 2);
  options.expiresDays = positiveInteger(options.expiresDays, '--expires-days');
  if (options.expiresDays > 30) usage(2, 'reviewer --expires-days cannot exceed 30');
  return options;
}

function parseReadOnlyBind(value) {
  try {
    return normalizeReadOnlyBind(value);
  } catch (error) {
    usage(2, error.message);
  }
}

function normalizeReadOnlyBind(value) {
  const separator = String(value).lastIndexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--panel-bind-ro must be <absolute-source>=</panel/or/auth/path>');
  }
  const sourceInput = value.slice(0, separator);
  const destination = value.slice(separator + 1);
  if (!path.isAbsolute(sourceInput) || !SANDBOX_DESTINATION.test(destination)
      || destination.split('/').includes('..')) {
    throw new Error('--panel-bind-ro has an invalid source or sandbox destination');
  }
  let source;
  let stat;
  try {
    source = fs.realpathSync(sourceInput);
    stat = fs.lstatSync(source);
  } catch {
    throw new Error(`--panel-bind-ro source does not exist: ${sourceInput}`);
  }
  if ((!stat.isFile() && !stat.isDirectory()) || stat.isSymbolicLink()) {
    throw new Error('--panel-bind-ro source must resolve to a regular file or directory');
  }
  if (source === REPO_ROOT || source.startsWith(`${REPO_ROOT}${path.sep}`)
      || REPO_ROOT.startsWith(`${source}${path.sep}`)) {
    throw new Error('--panel-bind-ro cannot expose the repository or one of its ancestors');
  }
  return Object.freeze({ source, destination, directory: stat.isDirectory() });
}

function timestamp() {
  const supplied = process.env.AUTOPILOT_QUALIFY_NOW;
  if (supplied) {
    const parsed = Date.parse(supplied);
    if (!/Z$/u.test(supplied) || Number.isNaN(parsed)) {
      usage(2, 'AUTOPILOT_QUALIFY_NOW must be an ISO-8601 UTC timestamp');
    }
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function verifySandboxRuntime(binaryPath = BWRAP_PATH) {
  let stat;
  try {
    stat = fs.lstatSync(binaryPath);
  } catch {
    throw new Error(`required reviewer sandbox is unavailable: ${binaryPath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) {
    throw new Error(
      `required reviewer sandbox is not an executable regular file: ${binaryPath}`,
    );
  }
  const probe = spawnSync(binaryPath, [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-net',
    '--ro-bind', '/usr', '/usr',
    '--symlink', 'usr/bin', '/bin',
    '--symlink', 'usr/lib', '/lib',
    '--symlink', 'usr/lib64', '/lib64',
    '--proc', '/proc',
    '--dev', '/dev',
    '--tmpfs', '/tmp',
    '--dir', '/work',
    '--chdir', '/work',
    '--clearenv',
    '/bin/true',
  ], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `required reviewer sandbox failed its isolation probe: ${
        probe.error ? probe.error.message : String(probe.stderr || '').trim()
      }`,
    );
  }
  return true;
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join('\0') === keys.slice().sort().join('\0');
}

function normalizeWitnessJson(value, label, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 256 || depth > 8) {
    throw new Error(`${label} exceeds the witness structure limit`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4096) throw new Error(`${label} string is too long`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label} number must be finite`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 32) throw new Error(`${label} array is too large`);
    return value.map((entry, index) => (
      normalizeWitnessJson(entry, `${label}[${index}]`, state, depth + 1)
    ));
  }
  if (!value || typeof value !== 'object'
      || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must contain only JSON values`);
  }
  const keys = Object.keys(value);
  if (keys.length > 32) throw new Error(`${label} object is too large`);
  const normalized = {};
  for (const key of keys.sort()) {
    if (!TOKEN.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) {
      throw new Error(`${label} has an invalid object key`);
    }
    normalized[key] = normalizeWitnessJson(
      value[key],
      `${label}.${key}`,
      state,
      depth + 1,
    );
  }
  return normalized;
}

function normalizeBehavioralWitness(raw, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !hasExactKeys(raw, [
        'protocol',
        'export_path',
        'args',
        'environment',
        'expectation',
      ])) {
    throw new Error(`${label} has an invalid shape`);
  }
  if (raw.protocol !== WITNESS_PROTOCOL_VERSION) {
    throw new Error(`${label}.protocol must be ${WITNESS_PROTOCOL_VERSION}`);
  }
  if (!Array.isArray(raw.export_path) || raw.export_path.length > 8
      || raw.export_path.some((segment) => !TOKEN.test(segment))) {
    throw new Error(`${label}.export_path must be a bounded token path`);
  }
  if (!Array.isArray(raw.args) || raw.args.length > 16) {
    throw new Error(`${label}.args must be a bounded array`);
  }
  if (!raw.environment || typeof raw.environment !== 'object'
      || Array.isArray(raw.environment)
      || Object.getPrototypeOf(raw.environment) !== Object.prototype
      || Object.keys(raw.environment).length > 8) {
    throw new Error(`${label}.environment must be a bounded object`);
  }
  const environment = {};
  for (const name of Object.keys(raw.environment).sort()) {
    const value = raw.environment[name];
    if (!ENV_NAME.test(name) || FORBIDDEN_PANEL_ENV.has(name)
        || typeof value !== 'string' || value.length > 4096) {
      throw new Error(`${label}.environment has an invalid entry`);
    }
    environment[name] = value;
  }
  if (!raw.expectation || typeof raw.expectation !== 'object'
      || Array.isArray(raw.expectation)) {
    throw new Error(`${label}.expectation must be an object`);
  }
  let expectation;
  if (raw.expectation.kind === 'throws') {
    if (!hasExactKeys(raw.expectation, ['kind'])) {
      throw new Error(`${label}.expectation throws has unsupported fields`);
    }
    expectation = { kind: 'throws' };
  } else if (raw.expectation.kind === 'returns') {
    if (!hasExactKeys(raw.expectation, ['kind', 'value'])) {
      throw new Error(`${label}.expectation returns requires one value`);
    }
    expectation = {
      kind: 'returns',
      value: normalizeWitnessJson(
        raw.expectation.value,
        `${label}.expectation.value`,
      ),
    };
  } else {
    throw new Error(`${label}.expectation.kind must be throws or returns`);
  }
  const witness = {
    protocol: WITNESS_PROTOCOL_VERSION,
    export_path: raw.export_path.slice(),
    args: normalizeWitnessJson(raw.args, `${label}.args`),
    environment,
    expectation,
  };
  if (Buffer.byteLength(canonicalJson(witness)) > MAX_WITNESS_BYTES) {
    throw new Error(`${label} exceeds ${MAX_WITNESS_BYTES} bytes`);
  }
  return deepFreeze(witness);
}

function parsePanelResult(stdout) {
  const lines = String(stdout).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  let value = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        value = parsed;
        break;
      }
    } catch {
      // Earlier transport output is allowed; the last parseable JSON object is authoritative.
    }
  }
  if (!value || Object.keys(value).some((key) => !['verdict', 'findings'].includes(key))
      || !['pass', 'fail'].includes(value.verdict) || !Array.isArray(value.findings)
      || value.findings.length > 8) {
    throw new Error('panel result must be {verdict:"pass|fail",findings:[...]}');
  }
  const findings = value.findings.map((finding, index) => {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
        || Object.keys(finding).some((key) => ![
          'rule_id',
          'severity',
          'file',
          'line',
          'witness',
        ].includes(key))) {
      throw new Error(`panel finding ${index + 1} has an invalid shape`);
    }
    const ruleId = String(finding.rule_id || '');
    const severity = String(finding.severity || '').toLowerCase();
    if (!TOKEN.test(ruleId)
        || !['critical', 'major', 'minor', 'suggestion'].includes(severity)
        || typeof finding.file !== 'string' || finding.file.length === 0
        || finding.file.length > 512 || path.isAbsolute(finding.file)
        || !Number.isSafeInteger(finding.line) || finding.line < 1) {
      throw new Error(`panel finding ${index + 1} has invalid fields`);
    }
    return {
      rule_id: ruleId,
      severity,
      file: finding.file.replace(/^(?:a|b)\//u, ''),
      line: finding.line,
      witness: normalizeBehavioralWitness(
        finding.witness,
        `panel finding ${index + 1}.witness`,
      ),
    };
  });
  if (value.verdict === 'pass' && findings.length !== 0) {
    throw new Error('a passing panel result cannot carry findings');
  }
  if (value.verdict === 'fail' && findings.length === 0) {
    throw new Error('a failing panel result requires at least one finding');
  }
  return { verdict: value.verdict, findings };
}

function changedLocations(diff) {
  const files = new Map();
  let file = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of String(diff).split(/\r?\n/u)) {
    if (line.startsWith('+++ ')) {
      const candidate = line.slice(4).split('\t')[0].replace(/^(?:a|b)\//u, '');
      file = candidate === '/dev/null' ? null : candidate;
      if (file && !files.has(file)) files.set(file, new Set());
      continue;
    }
    const hunk = line.match(/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (!file || line.startsWith('--- ') || line.startsWith('diff ')
        || line.startsWith('index ')) {
      continue;
    }
    if (line.startsWith('+')) {
      files.get(file).add(newLine);
      newLine += 1;
    } else if (line.startsWith('-')) {
      files.get(file).add(oldLine);
      oldLine += 1;
    } else if (!line.startsWith('\\')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return files;
}

function findingMatchesOracleMetadata(finding, testCase) {
  const rank = { suggestion: 0, minor: 1, major: 2, critical: 3 };
  const lines = testCase.locations.get(finding.file);
  return Boolean(lines && lines.has(finding.line)
    && finding.rule_id === testCase.expectedRuleId
    && rank[finding.severity] >= rank[testCase.expectedClass]);
}

function deterministicShuffle(cases, seed) {
  return cases.slice().sort((left, right) => {
    const leftKey = sha256(`${seed}:${left.artifactHash}`);
    const rightKey = sha256(`${seed}:${right.artifactHash}`);
    return leftKey.localeCompare(rightKey);
  });
}

function runSemanticOracle(testCase, oracleRoot) {
  const caseRoot = path.join(oracleRoot, testCase.id);
  fs.mkdirSync(caseRoot, { recursive: true });
  const beforePath = path.join(caseRoot, 'before.cjs');
  const afterPath = path.join(caseRoot, 'after.cjs');
  const testPath = path.join(caseRoot, 'oracle.cjs');
  fs.writeFileSync(beforePath, testCase.beforeSource, { mode: 0o600 });
  fs.writeFileSync(afterPath, testCase.afterSource, { mode: 0o600 });
  fs.writeFileSync(testPath, testCase.testSource, { mode: 0o600 });
  const execute = (target) => spawnSync(process.execPath, [testPath, target], {
    cwd: caseRoot,
    env: {
      HOME: caseRoot,
      NO_COLOR: '1',
      PATH: '/usr/bin:/bin',
      TMPDIR: caseRoot,
    },
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  const before = execute(beforePath);
  const after = execute(afterPath);
  if (before.error || after.error || before.signal || after.signal) {
    throw new Error(`semantic oracle execution failed for ${testCase.id}`);
  }
  const observed = {
    before_passed: before.status === 0,
    after_passed: after.status === 0,
  };
  const expected = testCase.kind === 'known_bad'
    ? { before_passed: true, after_passed: false }
    : testCase.kind === 'clean'
      ? { before_passed: true, after_passed: true }
      : { before_passed: false, after_passed: true };
  if (observed.before_passed !== expected.before_passed
      || observed.after_passed !== expected.after_passed) {
    throw new Error(
      `semantic oracle invariant failed for ${testCase.id}: ${canonicalJson(observed)}`,
    );
  }
  return Object.freeze({
    ...testCase,
    semanticOracleHash: sha256(canonicalJson({
      kind: 'node-executable-invariant-v1',
      before_hash: sha256(testCase.beforeSource),
      after_hash: sha256(testCase.afterSource),
      test_hash: sha256(testCase.testSource),
      witness_call_hash: testCase.witnessCall
        ? sha256(canonicalJson(testCase.witnessCall)) : null,
      expected,
      observed,
    })),
  });
}

function generatedCase(raw, mutationTarget) {
  const locations = changedLocations(raw.diff);
  const expectedLines = locations.get(raw.file);
  if (locations.size !== 1 || !expectedLines || !expectedLines.has(raw.changedLine)) {
    throw new Error(`generated diff location mismatch for ${raw.id}`);
  }
  return Object.freeze({
    id: raw.id,
    kind: raw.kind,
    expectedClass: raw.severity,
    expectedRuleId: raw.ruleId,
    artifactHash: sha256(raw.diff),
    diff: raw.diff,
    locations,
    mutationTarget,
    beforeSource: raw.beforeSource,
    afterSource: raw.afterSource,
    testSource: raw.testSource,
    witnessCall: raw.witnessCall || null,
  });
}

function prepareGeneratedCorpus(staticOracle, trials, masterSeed, tempRoot) {
  const generatedTrials = [];
  const oracleRoot = path.join(tempRoot, 'host-oracle');
  for (let index = 0; index < trials; index += 1) {
    const seed = sha256(`${masterSeed}:trial:${index + 1}`);
    const generated = generateReviewerEvaluation(seed);
    if (generated.generatorVersion !== GENERATOR_VERSION) {
      throw new Error('reviewer evaluation generator version drift');
    }
    if (generated.knownBad.length !== KNOWN_BAD_COUNT
        || generated.clean.length !== CLEAN_COUNT) {
      throw new Error('reviewer evaluation generated corpus count drift');
    }
    const rawCases = [
      ...generated.knownBad.map((entry, caseIndex) => (
        generatedCase(entry, caseIndex === 0)
      )),
      ...generated.clean.map((entry) => generatedCase(entry, false)),
      generatedCase(generated.mutation, true),
    ];
    const cases = rawCases.map((entry) => runSemanticOracle(
      entry,
      path.join(oracleRoot, `trial-${index + 1}`),
    ));
    generatedTrials.push(Object.freeze({
      trialId: `trial-${index + 1}`,
      seedHash: sha256(seed),
      cases: Object.freeze(cases),
      manifestHash: sha256(canonicalJson(cases.map((entry) => ({
        artifact_hash: entry.artifactHash,
        kind: entry.kind,
        semantic_oracle_hash: entry.semanticOracleHash,
        witness_call_hash: entry.witnessCall
          ? sha256(canonicalJson(entry.witnessCall)) : null,
      })))),
    }));
  }
  const corpusManifestHash = sha256(canonicalJson({
    schema_version: 1,
    generator_version: GENERATOR_VERSION,
    generator_hash: EXPECTED_GENERATOR_HASH,
    pinned_base_manifest_hash: staticOracle.corpus_manifest_hash,
    pinned_base_oracle_hash: staticOracle.artifact_oracle_hash,
    trials: generatedTrials.map((trial) => ({
      trial_id: trial.trialId,
      seed_hash: trial.seedHash,
      manifest_hash: trial.manifestHash,
    })),
  }));
  return Object.freeze({
    methodology_version: `${staticOracle.methodology_version}.${GENERATOR_VERSION}`,
    corpus_manifest_hash: corpusManifestHash,
    artifact_oracle_hash: sha256(canonicalJson({
      kind: 'host-executable-metamorphic-witness-v3',
      corpus_manifest_hash: corpusManifestHash,
      generator_hash: EXPECTED_GENERATOR_HASH,
      witness_protocol: WITNESS_PROTOCOL_VERSION,
      witness_runner_hash: sha256(WITNESS_RUNNER_SOURCE),
      semantic_oracle_hashes: generatedTrials.flatMap(
        (trial) => trial.cases.map((entry) => entry.semanticOracleHash),
      ).sort(),
    })),
    known_bad_count: KNOWN_BAD_COUNT,
    critical_count: RULES.filter((rule) => rule.severity === 'critical').length,
    clean_count: CLEAN_COUNT,
    trials: Object.freeze(generatedTrials),
  });
}

function snapshotPanelConfiguration(options) {
  if (typeof options.panelCmd !== 'string' || options.panelCmd.trim().length === 0
      || options.panelCmd.length > 16_384 || options.panelCmd.includes('\0')) {
    throw new Error('panelCmd must be a non-empty trusted-host shell command');
  }
  const binds = (options.panelReadOnlyBinds || []).map((raw) => {
    if (typeof raw === 'string') return normalizeReadOnlyBind(raw);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('panelReadOnlyBinds entries must be bind strings or objects');
    }
    return normalizeReadOnlyBind(`${raw.source}=${raw.destination}`);
  });
  const destinations = binds.map((bind) => bind.destination);
  if (new Set(destinations).size !== destinations.length) {
    throw new Error('panelReadOnlyBinds destinations must be unique');
  }
  const environment = {};
  for (const name of options.panelEnvironment || []) {
    if (!ENV_NAME.test(name) || FORBIDDEN_PANEL_ENV.has(name)
        || name.startsWith('AUTOPILOT_')
        || name.startsWith('ENGINE_') || name.startsWith('CALIBRATION_')) {
      throw new Error(`panelEnvironment contains forbidden name ${name}`);
    }
    if (!Object.hasOwn(process.env, name)) {
      throw new Error(`panelEnvironment variable ${name} is not set`);
    }
    environment[name] = process.env[name];
  }
  return deepFreeze({
    panelCmd: options.panelCmd,
    binds,
    environment,
    policyHash: sha256(canonicalJson({
      sandbox: 'bubblewrap-case-isolation-v4-domain-bound-witness',
      command_hash: sha256(options.panelCmd),
      witness_protocol: WITNESS_PROTOCOL_VERSION,
      witness_runner_hash: sha256(WITNESS_RUNNER_SOURCE),
      binds: binds.map((bind) => ({
        source_hash: bind.directory
          ? sha256(`directory:${bind.source}`)
          : byteHash(fs.readFileSync(bind.source)),
        destination: bind.destination,
        directory: bind.directory,
      })),
      environment_names: Object.keys(environment).sort(),
    })),
  });
}

function sandboxDirectories(binds) {
  const directories = new Set(['/panel', '/auth', '/work', '/work/home']);
  for (const bind of binds) {
    let current = path.posix.dirname(bind.destination);
    while (current === '/panel' || current.startsWith('/panel/')
        || current === '/auth' || current.startsWith('/auth/')) {
      directories.add(current);
      current = path.posix.dirname(current);
    }
  }
  return [...directories].sort((left, right) => {
    const depth = (value) => value.split('/').length;
    return depth(left) - depth(right) || left.localeCompare(right);
  });
}

function sandboxArguments(panelConfig) {
  const args = [
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
  ];
  for (const directory of sandboxDirectories(panelConfig.binds)) {
    args.push('--dir', directory);
  }
  for (const bind of panelConfig.binds) {
    args.push('--ro-bind', bind.source, bind.destination);
  }
  args.push(
    '--chdir', '/work',
    '--clearenv',
    '--setenv', 'HOME', '/work/home',
    '--setenv', 'NO_COLOR', '1',
    '--setenv', 'PATH', '/usr/bin:/bin:/panel',
    '--setenv', 'TMPDIR', '/tmp',
  );
  for (const [name, value] of Object.entries(panelConfig.environment)) {
    args.push('--setenv', name, value);
  }
  args.push('/usr/bin/bash', '-c', panelConfig.panelCmd);
  return args;
}

function witnessSandboxArguments(caseRoot, targetPath) {
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
    '--dir', '/work',
    '--dir', '/work/home',
    '--ro-bind', process.execPath, '/case/node',
    '--ro-bind', path.join(caseRoot, 'runner.cjs'), '/case/runner.cjs',
    '--ro-bind', path.join(caseRoot, 'witness.json'), '/case/witness.json',
    '--ro-bind', targetPath, '/case/target.cjs',
    '--chdir', '/work',
    '--clearenv',
    '--setenv', 'HOME', '/work/home',
    '--setenv', 'NO_COLOR', '1',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'TMPDIR', '/tmp',
    '/case/node', '/case/runner.cjs',
  ];
}

function parseWitnessOutcome(stdout) {
  const lines = String(stdout).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  let value = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        value = parsed;
        break;
      }
    } catch {
      // Generated target logging is non-authoritative; the runner result is the last JSON object.
    }
  }
  if (!value || !['returns', 'throws', 'unsupported_return'].includes(value.kind)) {
    throw new Error('behavioral witness runner returned an invalid outcome');
  }
  if (value.kind === 'returns') {
    if (!hasExactKeys(value, ['kind', 'value'])) {
      throw new Error('behavioral witness return outcome has an invalid shape');
    }
    return {
      kind: 'returns',
      value: normalizeWitnessJson(value.value, 'behavioral witness outcome'),
    };
  }
  if (value.kind === 'throws') {
    if (!hasExactKeys(value, ['kind', 'name'])
        || typeof value.name !== 'string' || value.name.length > 128) {
      throw new Error('behavioral witness throw outcome has an invalid shape');
    }
    return { kind: 'throws', name: value.name };
  }
  if (!hasExactKeys(value, ['kind'])) {
    throw new Error('behavioral witness unsupported outcome has an invalid shape');
  }
  return { kind: 'unsupported_return' };
}

function witnessExpectationMatches(outcome, expectation) {
  if (expectation.kind === 'throws') return outcome.kind === 'throws';
  return outcome.kind === 'returns'
    && canonicalJson(outcome.value) === canonicalJson(expectation.value);
}

function witnessCallMatchesDomain(testCase, witness) {
  if (!testCase.witnessCall) return false;
  return canonicalJson({
    export_path: witness.export_path,
    args: witness.args,
    environment: witness.environment,
  }) === canonicalJson(testCase.witnessCall);
}

function runBehavioralWitness(testCase, witness) {
  if (!witnessCallMatchesDomain(testCase, witness)) {
    throw new Error('behavioral witness call is outside the generated case domain');
  }
  const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-review-witness-'));
  try {
    fs.writeFileSync(
      path.join(caseRoot, 'runner.cjs'),
      WITNESS_RUNNER_SOURCE,
      { mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(caseRoot, 'witness.json'),
      `${canonicalJson(witness)}\n`,
      { mode: 0o600 },
    );
    const beforePath = path.join(caseRoot, 'before.cjs');
    const afterPath = path.join(caseRoot, 'after.cjs');
    fs.writeFileSync(beforePath, testCase.beforeSource, { mode: 0o600 });
    fs.writeFileSync(afterPath, testCase.afterSource, { mode: 0o600 });
    const execute = (targetPath) => {
      const result = spawnSync(
        BWRAP_PATH,
        witnessSandboxArguments(caseRoot, targetPath),
        {
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          timeout: 5_000,
        },
      );
      if (result.error || result.signal || result.status !== 0) {
        throw new Error(
          `behavioral witness execution failed: ${
            result.error ? result.error.message : String(result.stderr || '').trim()
          }`,
        );
      }
      return parseWitnessOutcome(result.stdout || '');
    };
    const before = execute(beforePath);
    const after = execute(afterPath);
    const beforeMatched = witnessExpectationMatches(before, witness.expectation);
    const afterMatched = witnessExpectationMatches(after, witness.expectation);
    return Object.freeze({
      passed: beforeMatched && !afterMatched,
      resultHash: sha256(canonicalJson({
        protocol: WITNESS_PROTOCOL_VERSION,
        witness_hash: sha256(canonicalJson(witness)),
        before,
        after,
        before_matched: beforeMatched,
        after_matched: afterMatched,
      })),
    });
  } finally {
    fs.rmSync(caseRoot, { recursive: true, force: true });
  }
}

function runPanelCase(panelConfig, testCase) {
  const result = spawnSync(BWRAP_PATH, sandboxArguments(panelConfig), {
    input: testCase.diff,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
  });
  let panel = null;
  let parseError = null;
  try {
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`panel command exited ${result.status}`);
    panel = parsePanelResult(result.stdout || '');
  } catch (error) {
    parseError = error.message;
    panel = { verdict: 'fail', findings: [] };
  }
  let oraclePassed;
  let witnessResult = null;
  let witnessError = null;
  if (testCase.kind === 'known_bad') {
    if (panel.verdict === 'fail') {
      for (const finding of panel.findings) {
        if (!findingMatchesOracleMetadata(finding, testCase)) continue;
        try {
          const observed = runBehavioralWitness(testCase, finding.witness);
          if (observed.passed) {
            witnessResult = observed;
            break;
          }
        } catch (error) {
          witnessError = error.message;
        }
      }
    }
    oraclePassed = Boolean(witnessResult && witnessResult.passed);
  } else {
    oraclePassed = panel.verdict === 'pass' && panel.findings.length === 0;
  }
  return {
    artifact_id: testCase.id,
    artifact_hash: testCase.artifactHash,
    kind: testCase.kind,
    expected_class: testCase.expectedClass,
    panel_verdict: panel.verdict,
    finding_locations_hash: sha256(canonicalJson(panel.findings.map((finding) => ({
      severity: finding.severity,
      rule_id: finding.rule_id,
      file: finding.file,
      line: finding.line,
      witness_hash: sha256(canonicalJson(finding.witness)),
    })))),
    behavioral_witness_hash: witnessResult ? witnessResult.resultHash : null,
    oracle_passed: oraclePassed,
    parse_error: parseError || witnessError,
    mutation_target: testCase.mutationTarget,
  };
}

function runTrial(cases, oracle, panelConfig, trialId, observedAt, seed) {
  const ordered = deterministicShuffle(cases, `${seed}:${trialId}`);
  const results = ordered.map((testCase) => runPanelCase(panelConfig, testCase));
  const knownBad = results.filter((result) => result.kind === 'known_bad');
  const clean = results.filter((result) => result.kind === 'clean');
  const critical = knownBad.filter((result) => result.expected_class === 'critical');
  const original = knownBad.find((result) => result.mutation_target);
  const mutated = results.find((result) => result.kind === 'mutation');
  const resultSetHash = sha256(canonicalJson(results.map((result) => ({
    artifact_hash: result.artifact_hash,
    panel_verdict: result.panel_verdict,
    finding_locations_hash: result.finding_locations_hash,
    oracle_passed: result.oracle_passed,
  })).sort((left, right) => left.artifact_hash.localeCompare(right.artifact_hash))));
  const artifactPassed = results.every((result) => result.oracle_passed);
  const mutationRejected = Boolean(
    original && mutated && original.oracle_passed && mutated.oracle_passed
      && original.panel_verdict === 'fail' && mutated.panel_verdict === 'pass',
  );
  return {
    trial: {
      trial_id: trialId,
      observed_at: observedAt,
      known_bad_total: knownBad.length,
      known_bad_caught: knownBad.filter((result) => result.oracle_passed).length,
      critical_total: critical.length,
      false_pass_critical: critical.filter(
        (result) => result.panel_verdict !== 'fail',
      ).length,
      clean_total: clean.length,
      clean_false_positives: clean.filter((result) => !result.oracle_passed).length,
      corpus_manifest_hash: oracle.corpus_manifest_hash,
      artifact_oracle: {
        kind: 'host_executable_metamorphic_witness_v3',
        oracle_hash: oracle.artifact_oracle_hash,
        result_set_hash: resultSetHash,
        independent: true,
        passed: artifactPassed,
      },
      mutation_validation: {
        target_id: original ? original.artifact_id : 'known-bad-01',
        original_hash: original ? original.artifact_hash : '0'.repeat(64),
        mutated_hash: mutated ? mutated.artifact_hash : '0'.repeat(64),
        original_verdict: original ? original.panel_verdict : 'pass',
        mutated_verdict: mutated ? mutated.panel_verdict : 'fail',
        oracle_rejected: mutationRejected,
      },
    },
    failures: [
      ...results.filter((result) => result.parse_error).map(
        (result) => `${trialId}: panel protocol failure for ${result.artifact_id}/${
          result.artifact_hash
        }: ${result.parse_error}`,
      ),
      ...results.filter((result) => !result.oracle_passed).map(
        (result) => `${trialId}: artifact oracle rejected ${result.artifact_id}/${
          result.artifact_hash
        }`,
      ),
      ...(artifactPassed ? [] : [`${trialId}: independent artifact oracle failed`]),
      ...(mutationRejected ? [] : [`${trialId}: defect-reversal mutation control failed`]),
    ],
  };
}

function resolveEvidenceStore(storeOption) {
  const requestedDir = storeOption || process.env.ENGINE_CAPABILITY_DIR;
  const requestedFile = process.env.ENGINE_CAPABILITY_FILE;
  let storeDir;
  if (requestedDir) {
    const resolved = path.resolve(expandTilde(requestedDir));
    storeDir = resolved.endsWith('.jsonl') ? path.dirname(resolved) : resolved;
  } else if (requestedFile) {
    storeDir = path.dirname(path.resolve(expandTilde(requestedFile)));
  } else {
    storeDir = path.resolve(expandTilde(path.join('~', '.autopilot', 'engine-capability')));
  }
  const evidenceFile = path.join(storeDir, 'qualification-evidence.jsonl');
  return {
    storeDir,
    evidenceFile,
    lockFile: path.join(storeDir, '.lock'),
  };
}

function readTelemetryEvidenceRows(evidenceFile) {
  if (!fs.existsSync(evidenceFile)) return [];
  const lines = fs.readFileSync(evidenceFile, 'utf8').split(/\r?\n/u).filter(Boolean);
  return lines.map((line, index) => {
    let wrapper;
    try {
      wrapper = JSON.parse(line);
    } catch (error) {
      throw new Error(`malformed capability evidence line ${index + 1}: ${error.message}`);
    }
    const eventId = wrapper && toEventId(wrapper.event_id);
    if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)
        || eventId === null || !wrapper.evidence
        || !['engine-qualify-v2', 'operator-record-v1', 'trusted-observation-v1'].includes(
          wrapper.producer,
        )
        || !SHA256.test(wrapper.transcript_hash || '')) {
      throw new Error(`malformed capability evidence line ${index + 1}: invalid wrapper`);
    }
    const evidence = compileCapabilityEvidence(wrapper.evidence);
    if (wrapper.transcript_hash !== capabilityEvidenceProducerHash(
      evidence,
      wrapper.producer,
    )) {
      throw new Error(`malformed capability evidence line ${index + 1}: transcript mismatch`);
    }
    if (evidence.source === 'internal_eval' && wrapper.producer !== QUALIFIER_PRODUCER) {
      throw new Error(
        `malformed capability evidence line ${index + 1}: untrusted internal evaluation`,
      );
    }
    return {
      event_id: eventId,
      producer: wrapper.producer,
      transcript_hash: wrapper.transcript_hash,
      evidence,
    };
  });
}

function appendQualifierEvidence(config, evidence) {
  return withWriteLock({
    storeDir: config.storeDir,
    lockFile: config.lockFile,
    name: 'capability evidence qualifier',
  }, () => {
    const rows = readTelemetryEvidenceRows(config.evidenceFile);
    const existing = rows.find((row) => row.evidence.evidence_id === evidence.evidence_id);
    if (existing) return existing;
    evaluateCapabilityEvidence(
      [...rows.map((row) => row.evidence), evidence],
      {
        role: evidence.role,
        scope: evidence.scope,
        identity: evidence.identity,
        evaluation_time: evidence.issued_at,
      },
    );
    const wrapper = {
      event_id: maxEventId(rows) + 1,
      producer: QUALIFIER_PRODUCER,
      transcript_hash: capabilityEvidenceProducerHash(evidence, QUALIFIER_PRODUCER),
      evidence,
    };
    ensureDir(config.storeDir);
    appendRow(config.evidenceFile, wrapper);
    fs.chmodSync(config.storeDir, 0o700);
    fs.chmodSync(config.evidenceFile, 0o600);
    return wrapper;
  });
}

function latestExactEvidence(rows, role, scopeHash, identityHash) {
  return rows.filter((row) => (
    row.evidence.role === role
    && row.evidence.scope_hash === scopeHash
    && row.evidence.identity_hash === identityHash
  )).sort((left, right) => {
    const observed = Date.parse(right.evidence.observed_at)
      - Date.parse(left.evidence.observed_at);
    return observed || right.event_id - left.event_id;
  })[0] || null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function verifyPinnedEvaluationAssets(overrides = {}) {
  const root = overrides.root || REPO_ROOT;
  const generatorPath = overrides.generatorPath || GENERATOR_PATH;
  const manifestPath = overrides.manifestPath || DEFAULT_MANIFEST;
  const expectedGeneratorHash = overrides.expectedGeneratorHash || EXPECTED_GENERATOR_HASH;
  const expectedManifestHash =
    overrides.expectedManifestHash || EXPECTED_CORPUS_MANIFEST_HASH;
  const expectedArtifactOracleHash =
    overrides.expectedArtifactOracleHash || EXPECTED_ARTIFACT_ORACLE_HASH;
  const generatorHash = byteHash(fs.readFileSync(generatorPath));
  if (generatorHash !== expectedGeneratorHash) {
    throw new Error('pinned metamorphic generator hash mismatch');
  }
  const oracle = verifyEvaluationCorpus({
    root,
    manifest_path: manifestPath,
    mutation_control: true,
  });
  if (oracle.methodology_version !== EXPECTED_CORPUS_VERSION) {
    throw new Error(`pinned corpus methodology must be ${EXPECTED_CORPUS_VERSION}`);
  }
  if (oracle.corpus_manifest_hash !== expectedManifestHash
      || oracle.artifact_oracle_hash !== expectedArtifactOracleHash) {
    throw new Error('pinned base corpus or oracle hash mismatch');
  }
  if (oracle.known_bad_count !== PINNED_KNOWN_BAD_COUNT
      || oracle.clean_count !== PINNED_CLEAN_COUNT) {
    throw new Error('pinned base corpus count differs from the metamorphic generator');
  }
  return oracle;
}

function runQualification(options) {
  let staticOracle;
  try {
    staticOracle = verifyPinnedEvaluationAssets();
    verifySandboxRuntime();
  } catch (error) {
    throw new Error(`qualification precondition failed: ${error.message}`);
  }
  const panelConfig = snapshotPanelConfiguration(options);
  const runNonce = crypto.randomBytes(32).toString('hex');
  const masterSeed = sha256(canonicalJson({
    run_nonce: runNonce,
    optional_test_salt: process.env.AUTOPILOT_QUALIFY_SEED || null,
    generator_hash: EXPECTED_GENERATOR_HASH,
  }));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-engine-qualify-'));
  const trials = [];
  const failures = [];
  const started = Date.now();
  let oracle;
  try {
    // Generate, snapshot, and execute every host oracle before the first candidate starts.
    oracle = prepareGeneratedCorpus(
      staticOracle,
      options.trials,
      masterSeed,
      tempRoot,
    );
    for (let index = 0; index < options.trials; index += 1) {
      const observedAt = timestamp();
      const outcome = runTrial(
        oracle.trials[index].cases,
        oracle,
        panelConfig,
        `trial-${index + 1}`,
        observedAt,
        masterSeed,
      );
      const trial = outcome.trial;
      failures.push(...outcome.failures);
      if (trial.known_bad_total !== oracle.known_bad_count
          || trial.clean_total !== oracle.clean_count) {
        failures.push(`trial-${index + 1}: corpus sample count mismatch`);
      }
      if (trial.known_bad_caught !== trial.known_bad_total) {
        failures.push(`trial-${index + 1}: known-bad sensitivity miss`);
      }
      if (trial.false_pass_critical !== 0) {
        failures.push(`trial-${index + 1}: false-pass-on-Critical=${trial.false_pass_critical}`);
      }
      if (trial.clean_false_positives !== 0) {
        failures.push(`trial-${index + 1}: clean false positives=${trial.clean_false_positives}`);
      }
      if (!trial.artifact_oracle.passed) {
        failures.push(`trial-${index + 1}: artifact oracle did not pass`);
      }
      if (!trial.mutation_validation.oracle_rejected) {
        failures.push(`trial-${index + 1}: mutation validation did not reject a vacuous panel`);
      }
      trials.push(trial);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const issuedAt = timestamp();
  const observedAt = trials.map((trial) => trial.observed_at).sort().at(-1) || issuedAt;
  const expiresAt = new Date(
    Date.parse(issuedAt) + options.expiresDays * 86_400_000,
  ).toISOString();
  const state = failures.length === 0 ? 'qualified' : 'degraded';
  const scope = {
    task_classes: options.taskClasses,
    domains: options.domains,
    languages: options.languages,
    tool_surface: options.tools,
  };
  const identity = {
    identity: options.model,
    model_alias: options.engine,
    model_version: options.modelVersion,
    family: options.family,
    runner: options.runner,
    runner_version: options.runnerVersion,
    harness_version: options.harnessVersion,
    effort: options.effort,
    prompt_config_hash: options.promptConfigHash,
    semantic_fingerprint: options.semanticFingerprint,
    containment_fingerprint: options.containmentFingerprint,
    identity_resolved: true,
  };
  const storeConfig = resolveEvidenceStore(options.store);
  let existingRows;
  try {
    existingRows = readTelemetryEvidenceRows(storeConfig.evidenceFile);
  } catch (error) {
    throw new Error(`capability evidence store failed closed: ${error.message}`);
  }
  const scopeHash = sha256(canonicalJson(scope));
  const identityHash = sha256(canonicalJson(identity));
  const previous = latestExactEvidence(
    existingRows,
    'reviewer',
    scopeHash,
    identityHash,
  );
  const methodology = {
    kind: 'role_eval',
    name: 'reviewer-metamorphic-executable',
    version: '4.1.0',
    corpus_version: oracle.methodology_version,
    corpus_manifest_hash: oracle.corpus_manifest_hash,
    thresholds: {
      min_trials: options.trials,
      min_known_bad_cases: oracle.known_bad_count,
      min_critical_cases: oracle.critical_count,
      max_false_pass_critical: 0,
      min_clean_cases: oracle.clean_count,
      max_clean_false_positives: 0,
    },
    basis: null,
  };
  const evidence = compileCapabilityEvidence({
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:reviewer-v2',
    state,
    role: 'reviewer',
    scope,
    identity,
    issued_at: issuedAt,
    observed_at: observedAt,
    expires_at: expiresAt,
    methodology,
    trials,
    revocation: null,
    supersedes: previous ? previous.evidence.evidence_id : null,
  });
  let evidenceStoreRecord;
  try {
    evidenceStoreRecord = appendQualifierEvidence(storeConfig, evidence);
  } catch (error) {
    throw new Error(`cannot persist qualifier evidence: ${error.message}`);
  }
  const caught = trials.reduce((sum, trial) => sum + trial.known_bad_caught, 0);
  const knownBadTotal = trials.reduce((sum, trial) => sum + trial.known_bad_total, 0);
  const falsePassCritical = trials.reduce(
    (sum, trial) => sum + trial.false_pass_critical,
    0,
  );
  const cleanFalse = trials.reduce((sum, trial) => sum + trial.clean_false_positives, 0);
  const cleanTotal = trials.reduce((sum, trial) => sum + trial.clean_total, 0);
  const qualified = state === 'qualified';
  const row = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    family: options.family,
    role: 'reviewer',
    model_version: options.modelVersion,
    version_source: 'runtime',
    corpus_version: methodology.corpus_version,
    harness_version: options.harnessVersion,
    runner_version: options.runnerVersion,
    prompt_config_hash: options.promptConfigHash,
    effort: options.effort,
    date: issuedAt.slice(0, 10),
    quality: {
      corpus_pass: `${caught}/${knownBadTotal}`,
      false_pass_critical: falsePassCritical,
      specificity: `${cleanFalse}/${cleanTotal}`,
      repeated_trials: options.trials,
    },
    capability_score: knownBadTotal === 0 ? 0 : caught / knownBadTotal,
    cost: {
      source: 'unknown',
      usd_per_mtok_input: 0,
      usd_per_mtok_output: 0,
      sample_tokens: 0,
    },
    latency: { sample_wall_time_s: Math.max(0, Math.round((Date.now() - started) / 1000)) },
    status: qualified ? 'qualified' : 'failed',
    qualified_at: issuedAt.slice(0, 10),
    expires: expiresAt.slice(0, 10),
    evidence_store: {
      event_id: evidenceStoreRecord.event_id,
      producer: evidenceStoreRecord.producer,
      transcript_hash: evidenceStoreRecord.transcript_hash,
    },
    evidence,
  };
  const verdict = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    role: 'reviewer',
    qualified,
    evidence_id: evidence.evidence_id,
    evidence_state: evidence.state,
    scope_hash: evidence.scope_hash,
    identity_hash: evidence.identity_hash,
    trial_set_hash: evidence.trial_set_hash,
    evidence_store_event_id: evidenceStoreRecord.event_id,
    evidence_store_transcript_hash: evidenceStoreRecord.transcript_hash,
    reason: qualified ? 'passed' : failures.join('; '),
  };
  const runResult = deepFreeze({
    schema_version: 1,
    run_nonce: runNonce,
    oracle: {
      methodology_version: oracle.methodology_version,
      corpus_manifest_hash: oracle.corpus_manifest_hash,
      artifact_oracle_hash: oracle.artifact_oracle_hash,
      generator_hash: EXPECTED_GENERATOR_HASH,
      sandbox_policy_hash: panelConfig.policyHash,
    },
    qualified,
    evidence,
    row,
    verdict,
  });
  const activeRunKey = [
    runResult.verdict.role,
    runResult.evidence.scope_hash,
    runResult.evidence.identity_hash,
  ].join(':');
  ACTIVE_SESSION_RUNS.set(activeRunKey, runResult);
  if (qualified) HOST_OBSERVED_RUNS.add(runResult);
  return runResult;
}

function createSessionRoleCapabilityVerifier(runResult, expectedRequest) {
  const activeRunKey = runResult && runResult.evidence && runResult.verdict
    ? [
      runResult.verdict.role,
      runResult.evidence.scope_hash,
      runResult.evidence.identity_hash,
    ].join(':')
    : null;
  if (!HOST_OBSERVED_RUNS.has(runResult) || runResult.qualified !== true
      || ACTIVE_SESSION_RUNS.get(activeRunKey) !== runResult) {
    throw new Error(
      'session capability authority requires this process live host-observed qualification run',
    );
  }
  if (!expectedRequest || typeof expectedRequest !== 'object'
      || Array.isArray(expectedRequest)) {
    throw new Error('session capability authority requires one exact Owner Kernel request');
  }
  const evidence = runResult.evidence;
  const runNonceHash = sha256(runResult.run_nonce);
  const expectedRequestBinding = sha256(canonicalJson(expectedRequest));
  const sessionHeadHash = sha256(canonicalJson({
    kind: 'session-local-capability-authority-v1',
    run_nonce_hash: runNonceHash,
    expected_request_hash: expectedRequestBinding,
    evidence_id: evidence.evidence_id,
    scope_hash: evidence.scope_hash,
    identity_hash: evidence.identity_hash,
    corpus_manifest_hash: runResult.oracle.corpus_manifest_hash,
    artifact_oracle_hash: runResult.oracle.artifact_oracle_hash,
    generator_hash: runResult.oracle.generator_hash,
    sandbox_policy_hash: runResult.oracle.sandbox_policy_hash,
    trial_set_hash: evidence.trial_set_hash,
  }));
  let response = null;

  return Object.freeze(function sessionRoleCapabilityVerifier(request) {
    if (ACTIVE_SESSION_RUNS.get(activeRunKey) !== runResult) {
      throw new Error('session qualification was superseded by a newer exact-scope run');
    }
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      throw new Error('session capability verifier requires a host request object');
    }
    const requestBinding = sha256(canonicalJson(request));
    if (requestBinding !== expectedRequestBinding) {
      throw new Error('session capability verifier request differs from its exact host binding');
    }
    if (response) return response;

    const receipt = evaluateCapabilityEvidence([evidence], {
      role: request.role,
      scope: request.capability_scope,
      identity: evidence.identity,
      evaluation_time: request.evaluation_time,
    });
    if (!receipt.applicability.applicable || receipt.state !== 'qualified') {
      throw new Error('session qualification is not applicable to the requested role and scope');
    }
    const receipts = [receipt];
    response = deepFreeze({
      ok: true,
      run_id: request.run_id,
      task_authority_id: request.task_authority_id,
      dispatch_id: request.dispatch_id,
      role: request.role,
      role_eligibility: 'eligible',
      capability_state: 'qualified',
      model_identity: evidence.identity,
      evidence: receipts,
      evidence_store_anchor: {
        schema_version: 1,
        authority_kind: 'session_local',
        run_nonce_hash: runNonceHash,
        store_head_hash: sessionHeadHash,
        query_hash: sha256(canonicalJson({
          task_authority_id: request.task_authority_id,
          dispatch_id: request.dispatch_id,
          role: request.role,
          capability_scope: request.capability_scope,
          model_identity: evidence.identity,
          capability_state: 'qualified',
          evaluation_time: request.evaluation_time,
        })),
        receipts_hash: sha256(canonicalJson(receipts)),
        evidence_ids: receipts.map((entry) => entry.evidence_id).sort(),
      },
      identity: 'engine-qualify-session-v1',
      channel: `session-capability:${runNonceHash.slice(0, 24)}`,
    });
    return response;
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let runResult;
  try {
    runResult = runQualification(options);
  } catch (error) {
    usage(2, error.message);
  }
  const verdict = {
    ...runResult.verdict,
    evaluation_passed: runResult.qualified,
    admitted: false,
    authority_status: 'untrusted_telemetry',
  };
  delete verdict.qualified;
  if (options.emitRow) {
    process.stdout.write(`${JSON.stringify(runResult.row)}\n`);
    process.stderr.write(`${JSON.stringify(verdict)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
  }
  process.exit(runResult.qualified ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  createSessionRoleCapabilityVerifier,
  runQualification,
  verifyPinnedEvaluationAssets,
  verifySandboxRuntime,
};
