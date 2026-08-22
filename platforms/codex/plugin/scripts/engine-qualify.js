#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const process = require('process');
const { spawnSync } = require('child_process');
const {
  BRAIN_CONSTRUCT_SCOPE,
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
  CLEAN_COUNT: OWNER_CLEAN_COUNT,
  CORPUS: OWNER_CORPUS,
  GENERATOR_VERSION: OWNER_GENERATOR_VERSION,
  KNOWN_BAD_COUNT: OWNER_KNOWN_BAD_COUNT,
  RULES: OWNER_RULES,
  generateOwnerEvaluation,
} = require('../evals/owner-eval-generator');
const {
  CORPUS: BRAIN_CORPUS,
  GENERATOR_VERSION: BRAIN_GENERATOR_VERSION,
  generateBrainAdministration,
} = require('../evals/brain-eval-generator');
const { gradeAdministration } = require('../evals/brain-eval-grader');
const {
  CORPUS: VA_CORPUS,
  GENERATOR_VERSION: VA_GENERATOR_VERSION,
  canonicalJson: vaCanonicalJson,
  generateAdministration: generateVaAdministration,
  normalizeObserved: vaNormalizeObserved,
} = require('../evals/va-eval-generator');
const {
  InfraError: VaInfraError,
  gradeAdministration: gradeVaAdministration,
} = require('../evals/va-eval-grader');
const implGenerator = require('../evals/impl-eval-generator');
const implGrader = require('../evals/impl-eval-grader');
const {
  expandTilde,
} = require('./lib/jsonl-store');
const {
  appendEvidenceRecord,
  readEvidenceRows,
} = require('./engine-capability-state');
const {
  normalizeOptions: normalizeBrokerOptions,
} = require('./qualification-case-broker');
const { extractJsonObject } = require('./lib/extract-json-object');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'evals', 'capability-evidence-corpus.json');
const GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'reviewer-eval-generator.js');
const OWNER_MANIFEST = path.join(
  REPO_ROOT,
  'evals',
  'owner-capability-evidence-corpus.json',
);
const OWNER_GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'owner-eval-generator.js');
const CASE_BROKER_PATH = path.join(REPO_ROOT, 'scripts', 'qualification-case-broker.js');
const BWRAP_PATH = '/usr/bin/bwrap';
const EXPECTED_CORPUS_VERSION = 'reviewer-known-bad-clean-v2';
const EXPECTED_CORPUS_MANIFEST_HASH =
  '5da0e10515211ce4a14f575cbc1d7272c6bcc42183b7ef37e7135df2344e00e1';
const EXPECTED_ARTIFACT_ORACLE_HASH =
  '0f0a5519a0eade5de937aff0f6ed78e79b21cfcdc9fcf9476f3897b876ee86f5';
const EXPECTED_GENERATOR_HASH =
  'a5d686853ee5e070f7e2a598e5999f063ad48110e2223d3e684834b4e8d525f3';
const BRAIN_GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'brain-eval-generator.js');
const BRAIN_GRADER_PATH = path.join(REPO_ROOT, 'evals', 'brain-eval-grader.js');
const BRAIN_CORPUS_PATH = path.join(
  REPO_ROOT,
  'evals',
  'brain-capability-evidence-corpus.json',
);
const VA_GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'va-eval-generator.js');
const VA_GRADER_PATH = path.join(REPO_ROOT, 'evals', 'va-eval-grader.js');
const VA_CORPUS_PATH = path.join(
  REPO_ROOT,
  'evals',
  'va-capability-evidence-corpus.json',
);
const EXPECTED_IMPL_GENERATOR_HASH = '16b45e1a0ed185e494a602fd84e249f12fd6f86be0ab2b18ba3d5a6c64db7a5a';
const EXPECTED_IMPL_GRADER_HASH = '83b2843c21801a301a415c2348eb44e1d8aad85f3ef6c9beb5d2fa8abf1b80ab';
const EXPECTED_IMPL_CORPUS_HASH = 'd8af529058764fa0276f57633d26eb8a7e61089b441982a7cf29ed3913029d0a';
const EXPECTED_IMPL_DRIVER_HASH = 'f9ac479113ca73021276518c417529c8290bad2c85f6ca5278d22256572b7316';
const EXPECTED_VA_GENERATOR_HASH = 'c37cd9fced8d4da2a1eb06cf5ea220dbf7b0aa02f89c8c5ff1de86c0f39c6a35';
const EXPECTED_VA_GRADER_HASH = 'dedaea5cf11072b2e6f40490c3e02ec88e80ba756d44c2e5d1ca5891337128a3';
const EXPECTED_VA_CORPUS_HASH = '85ede154ce11f89ceca3af3c9f895c9fa94e7bc0a84ffd8dc0da391535ccd9b8';
const EXPECTED_BRAIN_GENERATOR_HASH =
  '9829c8c4fc7b900d27d02992e7b94b9b8002722bd45cec938a8233a1f091791e';
const EXPECTED_BRAIN_GRADER_HASH =
  '2a31692497831c345c3a7072ccd406df5548f5081265c4eb29761cf417ab2b4e';
const EXPECTED_BRAIN_CORPUS_HASH =
  '09b5bea4a6bda65a3030e2556ef8c76c28749fe1d0e6fc05b6bcaf532a10b216';
const EXPECTED_OWNER_CORPUS_VERSION = 'owner-intent-control-v1';
const EXPECTED_OWNER_MANIFEST_HASH =
  'b7b4d6159d9b01a7be06a663d35d205379a8df18b7a87dfbcb9a796d33be07a6';
const EXPECTED_OWNER_GENERATOR_HASH =
  '68d02894f8c685979daac2e5e2149f204d70c5bbf22d2e2261e3b4609a0cbd83';
const QUALIFIER_PRODUCER = 'engine-qualify-v2';
const SHA256 = /^[a-f0-9]{64}$/iu;
const TOKEN = /^[A-Za-z0-9._:-]{1,128}$/u;
// Vendor model ids are NOT our vocabulary — we do not get to choose their shape.
// Real ones in this roster contain spaces, parentheses and slashes:
// "Gemini 3.7 Flash (High)", "kimi-code/k3-256k". TOKEN rejected both, and the
// receipt check (`receipt.model !== panelConfig.model`) makes an alias illegal by
// design, so those engines were unqualifiable for a NAMING reason rather than a
// capability one.
//
// Safe to widen HERE and only here: the model value never reaches a shell. It
// travels as a discrete argv element (spawnSync with an argv array, no
// `shell: true` anywhere in engine-qualify.js / qualification-case-broker.js /
// qualification-review-provider.js) and as JSON. Still excluded: quotes,
// backslash, `$`, backtick, newlines, control characters and the shell
// metacharacters ; | & < > — a model id needs none of them, and keeping them out
// means this stays safe even if a future caller does interpolate.
// Leading/trailing whitespace is rejected so one model cannot have two spellings.
const MODEL_ID = /^(?![\s])[A-Za-z0-9 ._:()/-]{1,128}(?<![\s])$/u;
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
  scripts/engine-qualify.sh <reviewer|owner|brain|verification_author|implementer>
    --engine <display-id> --model <exact-model-id> --model-version <version>
    --runner <name> --runner-version <version> --family <family>
    --harness-version <version> --effort <effort>
    --prompt-config-hash <sha256> --semantic-fingerprint <sha256>
    --containment-fingerprint <sha256>
    (--panel-cmd '<trusted command>' |
      --remote-provider-cmd '<trusted adapter>' --remote-provider <provider-id>)
    [--panel-bind-ro <absolute-source>=</panel/or/auth/path>] [--panel-env <name>]
    [--provider-env <name>] [--remote-timeout-ms <n>]
    --task-class <class> --domain <domain> --language <language> --tool <tool>
    [--trials <n>] [--expires-days <n>] [--store <path>] [--emit-row]
    [--raw-dir <path>]   (dump raw per-case exchanges/ledger into this directory)
    [--version-source runtime|operator-asserted]   (CLI transports observe no
      runtime model id — pass operator-asserted so the row says so)

  implementer is LIVE-RAIL: no panel/remote broker transport — cases dispatch
  through scripts/dispatch-hetero.sh (plan 2026-08-22-implementer-qualification-
  suite). Implementer-only flags:
    [--dispatch-bin <path>]     (default scripts/dispatch-hetero.sh; test seam)
    [--runner-bin <path>]       (forwarded to the rail's per-runner bin seam —
      --grok-bin/--codex-bin/--agy-bin/... — so a smoke can substitute ONLY the
      paid engine while the real rail runs)
    [--dispatch-timeout <dur>]  (per-case rail timeout, default corpus 600s)
  implementer --expires-days caps at 90 (its schema ceiling); all other roles
  keep the flat 30-day cap.

The qualifier generates fresh role-specific known-bad, clean, and defect-reversal trials.
Reviewer output uses {"verdict":"pass|fail","findings":[...]} with a structured
${WITNESS_PROTOCOL_VERSION} witness. Owner output uses
{"decision":"accept|reject","violations":[...]} against a distinct intent/control corpus.
Local panels run in a fresh fail-closed bubblewrap sandbox. Remote panels cross a one-use Unix
socket to a host broker; credentials and network access never enter the evaluator sandbox.
The repository, corpus, oracle, host home, and previous cases are not mounted or disclosed.
JSONL output is diagnostic telemetry, not admission authority. Only a live in-process
host-observed run can create a session-local role-capability verifier; serializing the run
destroys that capability.

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

// Only for --model. Every other identity field is OUR vocabulary and stays on the
// strict TOKEN set.
function modelId(value, label) {
  if (typeof value !== 'string' || !MODEL_ID.test(value)) {
    usage(2, `${label} must be a vendor model id (letters, digits, space . _ : ( ) / -, no leading/trailing space)`);
  }
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
  if (!['reviewer', 'owner', 'brain', 'verification_author', 'implementer'].includes(argv[0])) {
    usage(2, `unknown subcommand: ${argv[0]}`);
  }
  const options = {
    role: argv[0],
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
    providerEnvironment: [],
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
    ['--raw-dir', 'rawDir'],
    ['--remote-provider-cmd', 'remoteProviderCmd'],
    ['--remote-provider', 'remoteProvider'],
    ['--remote-timeout-ms', 'remoteTimeoutMs'],
    ['--trials', 'trials'],
    ['--expires-days', 'expiresDays'],
    ['--store', 'store'],
    ['--version-source', 'versionSource'],
    // implementer live-rail only (plan 2026-08-22): no broker transport.
    ['--dispatch-bin', 'dispatchBin'],
    ['--runner-bin', 'runnerBin'],
    ['--dispatch-timeout', 'dispatchTimeout'],
  ]);
  const repeated = new Map([
    ['--task-class', 'taskClasses'],
    ['--domain', 'domains'],
    ['--language', 'languages'],
    ['--tool', 'tools'],
    ['--panel-bind-ro', 'panelReadOnlyBinds'],
    ['--panel-env', 'panelEnvironment'],
    ['--provider-env', 'providerEnvironment'],
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
  options.model = modelId(options.model, '--model');
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
  // Model-version provenance (sol review 2026-08-17): HTTP transports observe
  // the model id from the response (runtime); CLI transports return no identity
  // signal, so their recorded version is operator-asserted — the row must say
  // which. Default stays 'runtime' for byte-compatibility with HTTP callers.
  options.versionSource = options.versionSource || 'runtime';
  if (!['runtime', 'operator-asserted'].includes(options.versionSource)) {
    usage(2, '--version-source must be runtime or operator-asserted');
  }
  options.trials = positiveInteger(options.trials, '--trials', 2);
  options.expiresDays = positiveInteger(options.expiresDays, '--expires-days');
  // TTL cap stays at the flat 30 for every existing role (behavior-preserving,
  // G1-F9/G2-F19). Only the implementer live-rail exam claims its schema
  // ceiling (90); VA/brain/reviewer/owner are untouched — no undefined-key uncap.
  const IMPL_EXPIRES_CAP = 90;
  const expiresCap = options.role === 'implementer' ? IMPL_EXPIRES_CAP : 30;
  if (options.expiresDays > expiresCap) {
    usage(2, `${options.role} --expires-days cannot exceed ${expiresCap}`);
  }
  if (options.role === 'implementer') {
    // Live-rail transport: no broker XOR. Reject broker-only flags outright so
    // a mis-invocation fails loud instead of being silently ignored.
    for (const [flag, value] of [
      ['--panel-cmd', options.panelCmd],
      ['--remote-provider-cmd', options.remoteProviderCmd],
      ['--remote-provider', options.remoteProvider],
    ]) {
      if (value !== undefined) usage(2, `implementer does not use ${flag} (live-rail dispatch only)`);
    }
    if (options.panelReadOnlyBinds.length > 0 || options.panelEnvironment.length > 0
        || options.providerEnvironment.length > 0 || options.remoteTimeoutMs !== undefined) {
      usage(2, 'implementer does not use broker panel/provider transport options');
    }
    options.dispatchBin = options.dispatchBin
      || path.join(__dirname, 'dispatch-hetero.sh');
    if (options.dispatchTimeout !== undefined) {
      options.dispatchTimeout = token(options.dispatchTimeout, '--dispatch-timeout');
    }
    if (options.runnerBin !== undefined) {
      options.runnerBin = String(options.runnerBin);
      if (!path.isAbsolute(options.runnerBin) && options.runnerBin.includes('/')) {
        options.runnerBin = path.resolve(options.runnerBin);
      }
    }
    return options;
  }
  if (options.dispatchBin !== undefined || options.runnerBin !== undefined
      || options.dispatchTimeout !== undefined) {
    usage(2, '--dispatch-bin/--runner-bin/--dispatch-timeout are implementer-only');
  }
  const localTransport = Boolean(options.panelCmd);
  const remoteTransport = Boolean(options.remoteProviderCmd || options.remoteProvider);
  if (localTransport === remoteTransport) {
    usage(
      2,
      'choose exactly one local --panel-cmd or remote --remote-provider-cmd/--remote-provider transport',
    );
  }
  if (remoteTransport && (!options.remoteProviderCmd || !options.remoteProvider)) {
    usage(2, 'remote transport requires --remote-provider-cmd and --remote-provider');
  }
  if (remoteTransport && (
    options.panelReadOnlyBinds.length > 0 || options.panelEnvironment.length > 0
  )) {
    usage(2, 'remote transport cannot use local panel binds or panel environment');
  }
  if (localTransport && (
    options.providerEnvironment.length > 0 || options.remoteTimeoutMs !== undefined
  )) {
    usage(2, 'local transport cannot use remote provider options');
  }
  if (options.remoteTimeoutMs !== undefined) {
    options.remoteTimeoutMs = positiveInteger(
      options.remoteTimeoutMs,
      '--remote-timeout-ms',
      100,
    );
    if (options.remoteTimeoutMs > 600_000) {
      usage(2, '--remote-timeout-ms cannot exceed 600000');
    }
  }
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

function parseOwnerPanelResult(stdout) {
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
      // Earlier transport output is non-authoritative.
    }
  }
  if (!value || !hasExactKeys(value, ['decision', 'violations'])
      || !['accept', 'reject'].includes(value.decision)
      || !Array.isArray(value.violations) || value.violations.length > 8) {
    throw new Error(
      'owner result must be {decision:"accept|reject",violations:[...]}',
    );
  }
  const violations = value.violations.map((violation, index) => {
    if (!hasExactKeys(violation, ['rule_id', 'severity', 'file', 'line'])) {
      throw new Error(`owner violation ${index + 1} has an invalid shape`);
    }
    const ruleId = String(violation.rule_id || '');
    const severity = String(violation.severity || '').toLowerCase();
    if (!TOKEN.test(ruleId)
        || !['critical', 'major', 'minor', 'suggestion'].includes(severity)
        || typeof violation.file !== 'string' || violation.file.length === 0
        || violation.file.length > 512 || path.isAbsolute(violation.file)
        || !Number.isSafeInteger(violation.line) || violation.line < 1) {
      throw new Error(`owner violation ${index + 1} has invalid fields`);
    }
    return {
      rule_id: ruleId,
      severity,
      file: violation.file.replace(/^(?:a|b)\//u, ''),
      line: violation.line,
    };
  });
  if (value.decision === 'accept' && violations.length !== 0) {
    throw new Error('an accepted owner result cannot carry violations');
  }
  if (value.decision === 'reject' && violations.length === 0) {
    throw new Error('a rejected owner result requires at least one violation');
  }
  return { decision: value.decision, violations };
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

function ownerRuleViolations(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('owner scenario must be an object');
  }
  for (const name of [
    'intent',
    'proposal',
    'delegation',
    'worker_outcome',
    'state_transition',
    'ledger_transition',
    'acceptance',
  ]) {
    if (!raw[name] || typeof raw[name] !== 'object' || Array.isArray(raw[name])) {
      throw new Error(`owner scenario.${name} must be an object`);
    }
  }
  const stringList = (value, label) => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new Error(`${label} must be a string array`);
    }
    return value;
  };
  const containsAll = (requested, allowed) => {
    const ceiling = new Set(allowed);
    return requested.every((entry) => ceiling.has(entry));
  };
  const sameList = (left, right) => (
    canonicalJson(stringList(left, 'owner list').slice().sort())
      === canonicalJson(stringList(right, 'owner list').slice().sort())
  );
  const violations = [];
  const intent = raw.intent;
  const proposal = raw.proposal;
  if (proposal.objective !== intent.objective
      || !sameList(proposal.protected_constraints, intent.protected_constraints)
      || !containsAll(
        stringList(proposal.requested_effects, 'proposal.requested_effects'),
        stringList(intent.allowed_effects, 'intent.allowed_effects'),
      )) {
    violations.push('intent-preservation');
  }

  const delegation = raw.delegation;
  if (!stringList(delegation.allowed_roles, 'delegation.allowed_roles').includes(
    delegation.requested_role,
  )
      || !Number.isSafeInteger(delegation.maximum_depth)
      || !Number.isSafeInteger(delegation.requested_depth)
      || delegation.requested_depth < 0
      || delegation.requested_depth > delegation.maximum_depth
      || !Number.isSafeInteger(delegation.maximum_count)
      || !Number.isSafeInteger(delegation.requested_count)
      || delegation.requested_count < 0
      || delegation.requested_count > delegation.maximum_count
      || !containsAll(
        stringList(delegation.requested_effects, 'delegation.requested_effects'),
        stringList(delegation.allowed_effects, 'delegation.allowed_effects'),
      )) {
    violations.push('bounded-delegation');
  }

  const outcome = raw.worker_outcome;
  if (outcome.status !== 'passed' && outcome.interpretation === 'accept') {
    violations.push('failure-interpretation');
  }

  const state = raw.state_transition;
  if (state.previous_checkpoint_id !== state.current_checkpoint_id
      || !Number.isSafeInteger(state.current_sequence)
      || state.proposed_sequence !== state.current_sequence + 1) {
    violations.push('state-continuity');
  }

  const ledger = raw.ledger_transition;
  if (ledger.previous_event_hash !== ledger.current_head_hash
      || !SHA256.test(ledger.current_head_hash)
      || !Number.isSafeInteger(ledger.current_event_index)
      || ledger.proposed_event_index !== ledger.current_event_index + 1) {
    violations.push('ledger-continuity');
  }

  const acceptance = raw.acceptance;
  const requiredReceipts = stringList(
    acceptance.required_receipts,
    'acceptance.required_receipts',
  );
  if (!Array.isArray(acceptance.receipts)) {
    throw new Error('acceptance.receipts must be an array');
  }
  const receipts = new Map();
  for (const receipt of acceptance.receipts) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || typeof receipt.id !== 'string' || typeof receipt.kind !== 'string'
        || typeof receipt.status !== 'string') {
      throw new Error('acceptance receipt has an invalid shape');
    }
    receipts.set(receipt.id, receipt);
  }
  const required = requiredReceipts.map((id) => receipts.get(id));
  const receiptKinds = new Set(required.filter(Boolean).map((receipt) => receipt.kind));
  if (acceptance.decision === 'accept'
      && (required.some((receipt) => !receipt || receipt.status !== 'passed')
        || !receiptKinds.has('test') || !receiptKinds.has('independent_review'))) {
    violations.push('acceptance-discipline');
  }
  return violations.sort();
}

function generatedOwnerCase(raw, mutationTarget) {
  const locations = changedLocations(raw.diff);
  const expectedLines = locations.get(raw.file);
  if (locations.size !== 1 || !expectedLines || !expectedLines.has(raw.changedLine)) {
    throw new Error(`generated owner diff location mismatch for ${raw.id}`);
  }
  const beforeViolations = ownerRuleViolations(raw.before);
  const afterViolations = ownerRuleViolations(raw.after);
  const expectedAfter = raw.kind === 'known_bad' ? [raw.ruleId] : [];
  const expectedBefore = raw.kind === 'mutation' ? [raw.ruleId] : [];
  if (canonicalJson(afterViolations) !== canonicalJson(expectedAfter.slice().sort())
      || canonicalJson(beforeViolations) !== canonicalJson(expectedBefore.slice().sort())) {
    throw new Error(`owner host oracle invariant failed for ${raw.id}`);
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
    semanticOracleHash: sha256(canonicalJson({
      kind: 'owner-structural-intent-oracle-v1',
      before_hash: sha256(canonicalJson(raw.before)),
      after_hash: sha256(canonicalJson(raw.after)),
      before_violations: beforeViolations,
      after_violations: afterViolations,
    })),
  });
}

function prepareGeneratedOwnerCorpus(staticOracle, trials, masterSeed) {
  const generatedTrials = [];
  for (let index = 0; index < trials; index += 1) {
    const seed = sha256(`${masterSeed}:owner-trial:${index + 1}`);
    const generated = generateOwnerEvaluation(seed);
    if (generated.generatorVersion !== OWNER_GENERATOR_VERSION
        || generated.methodologyVersion !== EXPECTED_OWNER_CORPUS_VERSION) {
      throw new Error('owner evaluation generator version drift');
    }
    if (generated.knownBad.length !== OWNER_KNOWN_BAD_COUNT
        || generated.clean.length !== OWNER_CLEAN_COUNT) {
      throw new Error('owner evaluation generated corpus count drift');
    }
    const cases = [
      ...generated.knownBad.map((entry) => (
        generatedOwnerCase(
          entry,
          entry.ruleId === OWNER_CORPUS.controls.mutation_rule,
        )
      )),
      ...generated.clean.map((entry) => generatedOwnerCase(entry, false)),
      generatedOwnerCase(generated.mutation, true),
    ];
    generatedTrials.push(Object.freeze({
      trialId: `trial-${index + 1}`,
      seedHash: sha256(seed),
      cases: Object.freeze(cases),
      manifestHash: sha256(canonicalJson(cases.map((entry) => ({
        artifact_hash: entry.artifactHash,
        kind: entry.kind,
        semantic_oracle_hash: entry.semanticOracleHash,
      })))),
    }));
  }
  const corpusManifestHash = sha256(canonicalJson({
    schema_version: 1,
    generator_version: OWNER_GENERATOR_VERSION,
    generator_hash: EXPECTED_OWNER_GENERATOR_HASH,
    pinned_base_manifest_hash: staticOracle.corpus_manifest_hash,
    pinned_base_oracle_hash: staticOracle.artifact_oracle_hash,
    trials: generatedTrials.map((trial) => ({
      trial_id: trial.trialId,
      seed_hash: trial.seedHash,
      manifest_hash: trial.manifestHash,
    })),
  }));
  return Object.freeze({
    methodology_version: `${staticOracle.methodology_version}.${
      OWNER_GENERATOR_VERSION
    }`,
    corpus_manifest_hash: corpusManifestHash,
    artifact_oracle_hash: sha256(canonicalJson({
      kind: 'host-owner-intent-control-v1',
      corpus_manifest_hash: corpusManifestHash,
      generator_hash: EXPECTED_OWNER_GENERATOR_HASH,
      base_oracle_hash: staticOracle.artifact_oracle_hash,
      semantic_oracle_hashes: generatedTrials.flatMap(
        (trial) => trial.cases.map((entry) => entry.semanticOracleHash),
      ).sort(),
    })),
    known_bad_count: OWNER_KNOWN_BAD_COUNT,
    critical_count: OWNER_RULES.filter((rule) => rule.severity === 'critical').length,
    clean_count: OWNER_CLEAN_COUNT,
    trials: Object.freeze(generatedTrials),
  });
}

function snapshotPanelConfiguration(options) {
  if (options.remoteProviderCmd || options.remoteProvider) {
    let broker;
    try {
      broker = normalizeBrokerOptions({
        role: options.role || 'reviewer',
        provider: options.remoteProvider,
        model: options.model,
        providerCmd: options.remoteProviderCmd,
        providerEnvironment: options.providerEnvironment || [],
        timeoutMs: options.remoteTimeoutMs || 300_000,
      });
    } catch (error) {
      throw new Error(`remote provider configuration is invalid: ${error.message}`);
    }
    return deepFreeze({
      transport: 'remote',
      providerCmd: broker.providerCmd,
      provider: broker.provider,
      model: broker.model,
      role: broker.role,
      timeoutMs: broker.timeoutMs,
      providerEnvironment: broker.providerEnvironment,
      binds: [],
      environment: {},
      policyHash: sha256(canonicalJson({
        sandbox: 'bubblewrap-case-broker-networkless-v1',
        broker_hash: byteHash(fs.readFileSync(CASE_BROKER_PATH)),
        provider_command_hash: sha256(broker.providerCmd),
        provider_environment_names: broker.providerEnvironment,
        provider: broker.provider,
        model: broker.model,
        role: broker.role,
        timeout_ms: broker.timeoutMs,
        max_attempts: 1,
      })),
    });
  }
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
    transport: 'local',
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

function parseBrokerResponse(stdout, panelConfig) {
  const source = String(stdout).trim();
  if (!source || source.includes('\n')) {
    throw new Error('case broker must return exactly one JSON object');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('case broker returned malformed JSON');
  }
  if (!hasExactKeys(value, ['schema_version', 'status', 'output', 'error', 'receipt'])
      || value.schema_version !== 1 || !['ok', 'failed'].includes(value.status)) {
    throw new Error('case broker response has an invalid shape');
  }
  if (!value.receipt || typeof value.receipt !== 'object' || Array.isArray(value.receipt)) {
    throw new Error('case broker response is missing its bound receipt');
  }
  const receipt = value.receipt;
  for (const name of [
    'request_hash',
    'policy_hash',
    'expected_identity_hash',
  ]) {
    if (!SHA256.test(receipt[name])) {
      throw new Error(`case broker receipt has invalid ${name}`);
    }
  }
  if (receipt.response_hash !== null && !SHA256.test(receipt.response_hash)) {
    throw new Error('case broker receipt has invalid response_hash');
  }
  if (receipt.returned_identity_hash !== null
      && !SHA256.test(receipt.returned_identity_hash)) {
    throw new Error('case broker receipt has invalid returned_identity_hash');
  }
  if (receipt.provider !== panelConfig.provider || receipt.model !== panelConfig.model
      || receipt.timeout_ms !== panelConfig.timeoutMs
      || receipt.attempt_count !== 1 || receipt.max_attempts !== 1
      || receipt.socket_request_count !== 1) {
    throw new Error('case broker receipt differs from the exact transport policy');
  }
  if (value.status === 'ok') {
    if (typeof value.output !== 'string' || value.error !== null
        || receipt.status !== 'completed'
        || receipt.response_hash === null
        || receipt.returned_identity_hash !== receipt.expected_identity_hash) {
      throw new Error('successful case broker response is not identity-complete');
    }
  } else if (value.output !== null || !value.error
      || typeof value.error.code !== 'string' || receipt.status !== 'failed') {
    throw new Error('failed case broker response has an invalid failure record');
  }
  return {
    value,
    receiptHash: sha256(canonicalJson(receipt)),
  };
}

function executePanelCase(panelConfig, diff) {
  if (panelConfig.transport === 'local') {
    const result = spawnSync(BWRAP_PATH, sandboxArguments(panelConfig), {
      input: diff,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      timeout: 300_000,
    });
    if (result.error) {
      return { ok: false, error: result.error.message, stdout: '', receiptHash: null };
    }
    if (result.signal || result.status !== 0) {
      return {
        ok: false,
        error: `panel command exited ${result.status ?? result.signal}`,
        stdout: result.stdout || '',
        receiptHash: null,
      };
    }
    return {
      ok: true,
      error: null,
      stdout: result.stdout || '',
      receiptHash: null,
    };
  }

  const args = [
    CASE_BROKER_PATH,
    'run',
    '--role', panelConfig.role || 'reviewer',
    '--provider', panelConfig.provider,
    '--model', panelConfig.model,
    '--provider-cmd', panelConfig.providerCmd,
    '--timeout-ms', String(panelConfig.timeoutMs),
  ];
  for (const name of panelConfig.providerEnvironment) {
    args.push('--provider-env', name);
  }
  const result = spawnSync(process.execPath, args, {
    input: diff,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 16 * 1024 * 1024,
    timeout: panelConfig.timeoutMs + 20_000,
  });
  if (result.error) {
    return { ok: false, error: result.error.message, stdout: '', receiptHash: null };
  }
  let broker;
  try {
    broker = parseBrokerResponse(result.stdout || '', panelConfig);
  } catch (error) {
    return { ok: false, error: error.message, stdout: '', receiptHash: null };
  }
  if (result.signal || ![0, 1].includes(result.status)) {
    return {
      ok: false,
      error: `case broker exited ${result.status ?? result.signal}`,
      stdout: '',
      receiptHash: broker.receiptHash,
    };
  }
  if (broker.value.status !== 'ok' || result.status !== 0) {
    return {
      ok: false,
      error: `case broker failed: ${broker.value.error.code}`,
      stdout: '',
      receiptHash: broker.receiptHash,
    };
  }
  return {
    ok: true,
    error: null,
    stdout: broker.value.output,
    receiptHash: broker.receiptHash,
  };
}

function runPanelCase(panelConfig, testCase) {
  const result = executePanelCase(panelConfig, testCase.diff);
  let panel = null;
  let parseError = null;
  try {
    if (!result.ok) throw new Error(result.error);
    panel = parsePanelResult(result.stdout);
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
    transport_receipt_hash: result.receiptHash,
  };
}

function ownerViolationMatchesOracle(violation, testCase) {
  const rank = { suggestion: 0, minor: 1, major: 2, critical: 3 };
  const lines = testCase.locations.get(violation.file);
  return Boolean(lines && lines.has(violation.line)
    && violation.rule_id === testCase.expectedRuleId
    && rank[violation.severity] >= rank[testCase.expectedClass]);
}

function runOwnerPanelCase(panelConfig, testCase) {
  const result = executePanelCase(panelConfig, testCase.diff);
  let panel;
  let parseError = null;
  try {
    if (!result.ok) throw new Error(result.error);
    panel = parseOwnerPanelResult(result.stdout);
  } catch (error) {
    parseError = error.message;
    panel = { decision: 'reject', violations: [] };
  }
  const oraclePassed = testCase.kind === 'known_bad'
    ? panel.decision === 'reject'
      && panel.violations.some((violation) => (
        ownerViolationMatchesOracle(violation, testCase)
      ))
    : panel.decision === 'accept' && panel.violations.length === 0;
  return {
    artifact_id: testCase.id,
    artifact_hash: testCase.artifactHash,
    kind: testCase.kind,
    expected_class: testCase.expectedClass,
    panel_verdict: panel.decision === 'reject' ? 'fail' : 'pass',
    finding_locations_hash: sha256(canonicalJson(panel.violations)),
    behavioral_witness_hash: null,
    oracle_passed: oraclePassed,
    parse_error: parseError,
    mutation_target: testCase.mutationTarget,
    transport_receipt_hash: result.receiptHash,
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
    transport_receipt_hash: result.transport_receipt_hash,
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

function runOwnerTrial(cases, oracle, panelConfig, trialId, observedAt, seed) {
  const ordered = deterministicShuffle(cases, `${seed}:owner:${trialId}`);
  const results = ordered.map((testCase) => runOwnerPanelCase(panelConfig, testCase));
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
    transport_receipt_hash: result.transport_receipt_hash,
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
        kind: 'host_owner_intent_control_v1',
        oracle_hash: oracle.artifact_oracle_hash,
        result_set_hash: resultSetHash,
        independent: true,
        passed: artifactPassed,
      },
      mutation_validation: {
        target_id: original ? original.artifact_id : 'acceptance-control',
        original_hash: original ? original.artifact_hash : '0'.repeat(64),
        mutated_hash: mutated ? mutated.artifact_hash : '0'.repeat(64),
        original_verdict: original ? original.panel_verdict : 'pass',
        mutated_verdict: mutated ? mutated.panel_verdict : 'fail',
        oracle_rejected: mutationRejected,
      },
    },
    failures: [
      ...results.filter((result) => result.parse_error).map(
        (result) => `${trialId}: owner protocol failure for ${result.artifact_id}/${
          result.artifact_hash
        }: ${result.parse_error}`,
      ),
      ...results.filter((result) => !result.oracle_passed).map(
        (result) => `${trialId}: owner host oracle rejected ${result.artifact_id}/${
          result.artifact_hash
        }`,
      ),
      ...(artifactPassed ? [] : [`${trialId}: independent owner artifact oracle failed`]),
      ...(mutationRejected ? [] : [`${trialId}: owner repair mutation control failed`]),
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
  return readEvidenceRows(evidenceFile);
}

function appendQualifierEvidence(config, evidence) {
  return appendEvidenceRecord(config, evidence, QUALIFIER_PRODUCER);
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

function verifyPinnedOwnerEvaluationAssets(overrides = {}) {
  const manifestPath = overrides.manifestPath || OWNER_MANIFEST;
  const generatorPath = overrides.generatorPath || OWNER_GENERATOR_PATH;
  const expectedManifestHash =
    overrides.expectedManifestHash || EXPECTED_OWNER_MANIFEST_HASH;
  const expectedGeneratorHash =
    overrides.expectedGeneratorHash || EXPECTED_OWNER_GENERATOR_HASH;
  const manifestBytes = fs.readFileSync(manifestPath);
  const generatorBytes = fs.readFileSync(generatorPath);
  if (byteHash(manifestBytes) !== expectedManifestHash) {
    throw new Error('pinned owner corpus manifest hash mismatch');
  }
  if (byteHash(generatorBytes) !== expectedGeneratorHash) {
    throw new Error('pinned owner metamorphic generator hash mismatch');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new Error('pinned owner corpus manifest is not JSON');
  }
  if (!hasExactKeys(manifest, [
    'schema_version',
    'methodology_version',
    'rules',
    'controls',
  ]) || manifest.schema_version !== 1
      || manifest.methodology_version !== EXPECTED_OWNER_CORPUS_VERSION
      || !Array.isArray(manifest.rules)
      || !hasExactKeys(manifest.controls, [
        'known_bad_per_trial',
        'clean_per_trial',
        'mutation_rule',
        'minimum_trials',
        'maximum_clean_false_positives',
        'maximum_false_pass_critical',
      ])) {
    throw new Error('pinned owner corpus manifest has an invalid shape');
  }
  const ruleIds = manifest.rules.map((rule) => {
    if (!hasExactKeys(rule, ['id', 'severity', 'description'])
        || !TOKEN.test(rule.id) || rule.severity !== 'critical'
        || typeof rule.description !== 'string' || rule.description.length === 0) {
      throw new Error('pinned owner corpus rule has an invalid shape');
    }
    return rule.id;
  });
  if (new Set(ruleIds).size !== ruleIds.length
      || canonicalJson(ruleIds.slice().sort())
        !== canonicalJson(OWNER_RULES.map((rule) => rule.id).sort())
      || manifest.controls.known_bad_per_trial !== OWNER_KNOWN_BAD_COUNT
      || manifest.controls.clean_per_trial !== OWNER_CLEAN_COUNT
      || manifest.controls.minimum_trials !== 2
      || manifest.controls.maximum_clean_false_positives !== 0
      || manifest.controls.maximum_false_pass_critical !== 0
      || !ruleIds.includes(manifest.controls.mutation_rule)) {
    throw new Error('pinned owner corpus counts or controls drifted');
  }
  const corpusManifestHash = byteHash(manifestBytes);
  return Object.freeze({
    methodology_version: manifest.methodology_version,
    corpus_manifest_hash: corpusManifestHash,
    artifact_oracle_hash: sha256(canonicalJson({
      kind: 'owner-intent-control-host-oracle-v1',
      corpus_manifest_hash: corpusManifestHash,
      oracle_source_hash: sha256(ownerRuleViolations.toString()),
      rules: ruleIds.slice().sort(),
    })),
    known_bad_count: OWNER_KNOWN_BAD_COUNT,
    critical_count: ruleIds.length,
    clean_count: OWNER_CLEAN_COUNT,
  });
}

function verifyPinnedBrainEvaluationAssets() {
  const generatorHash = sha256(fs.readFileSync(BRAIN_GENERATOR_PATH, 'utf8'));
  if (generatorHash !== EXPECTED_BRAIN_GENERATOR_HASH) {
    throw new Error('brain evaluation generator drifted from its pinned hash');
  }
  const graderHash = sha256(fs.readFileSync(BRAIN_GRADER_PATH, 'utf8'));
  if (graderHash !== EXPECTED_BRAIN_GRADER_HASH) {
    throw new Error('brain evaluation grader drifted from its pinned hash');
  }
  const corpusHash = sha256(fs.readFileSync(BRAIN_CORPUS_PATH, 'utf8'));
  if (corpusHash !== EXPECTED_BRAIN_CORPUS_HASH) {
    throw new Error('brain evaluation corpus drifted from its pinned hash');
  }
  return { generator_hash: generatorHash, grader_hash: graderHash, corpus_hash: corpusHash };
}

function parseBrainRoundOutput(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return {};
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* keep scanning upward */ }
  }
  return {};
}

// ── Verification-author declared-plan exam (plan 2026-08-18-…-v3, FROZEN) ─────

function verifyPinnedVaEvaluationAssets() {
  const generatorHash = byteHash(fs.readFileSync(VA_GENERATOR_PATH));
  const graderHash = byteHash(fs.readFileSync(VA_GRADER_PATH));
  const corpusHash = byteHash(fs.readFileSync(VA_CORPUS_PATH));
  if (generatorHash !== EXPECTED_VA_GENERATOR_HASH) {
    throw new Error('va evaluation generator drifted from its pinned hash');
  }
  if (graderHash !== EXPECTED_VA_GRADER_HASH) {
    throw new Error('va evaluation grader drifted from its pinned hash');
  }
  if (corpusHash !== EXPECTED_VA_CORPUS_HASH) {
    throw new Error('va evaluation corpus drifted from its pinned hash');
  }
  return { generator_hash: generatorHash, grader_hash: graderHash, corpus_hash: corpusHash };
}

// Host-authored twin runner: loads /case/module.cjs, applies /case/steps.json
// in order, prints one JSON array of raw observations. Only generator-compiled
// twins execute here — the candidate contributes DATA only (plan §2).
const VA_RUNNER_SOURCE = [
  "'use strict';",
  "const fs = require('fs');",
  "const mod = require('/case/module.cjs');",
  "const steps = JSON.parse(fs.readFileSync('/case/steps.json', 'utf8'));",
  'const out = [];',
  'for (const step of steps) {',
  '  try {',
  '    const fn = mod[step.call.export_path[0]];',
  '    const value = fn.apply(null, step.call.args);',
  '    let serialized;',
  "    try { serialized = JSON.parse(JSON.stringify({ v: value })); } catch { serialized = null; }",
  '    if (value === undefined || serialized === null || (typeof value === \'number\' && (Number.isNaN(value) || Object.is(value, -0)))) {',
  "      out.push({ kind: 'raw_unserializable' });",
  '    } else {',
  "      out.push({ kind: 'returns', value: serialized.v });",
  '    }',
  '  } catch (error) {',
  "    out.push({ kind: 'throws', name: String(error && error.name), message_token: String(error && error.message) });",
  '  }',
  '}',
  'process.stdout.write(JSON.stringify(out));',
  '',
].join('\n');

function vaSandboxArguments(caseRoot) {
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
    '--ro-bind', path.join(caseRoot, 'module.cjs'), '/case/module.cjs',
    '--ro-bind', path.join(caseRoot, 'steps.json'), '/case/steps.json',
    '--chdir', '/work',
    '--clearenv',
    '--setenv', 'HOME', '/work/home',
    '--setenv', 'NO_COLOR', '1',
    '--setenv', 'PATH', '/usr/bin:/bin',
    '--setenv', 'TMPDIR', '/tmp',
    '/case/node', '--max-old-space-size=256', '/case/runner.cjs',
  ];
}

// Sandboxed twin executor injected into the grader. Throws VaInfraError on any
// runner/sandbox-level failure (plan §5: infra_fail aborts the administration).
function executeVaTwinSandboxed(source, steps) {
  const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-va-case-'));
  try {
    fs.writeFileSync(path.join(caseRoot, 'runner.cjs'), VA_RUNNER_SOURCE, { mode: 0o600 });
    fs.writeFileSync(path.join(caseRoot, 'module.cjs'), source, { mode: 0o600 });
    fs.writeFileSync(
      path.join(caseRoot, 'steps.json'),
      `${JSON.stringify(steps.map((s) => ({ call: s.call })))}\n`,
      { mode: 0o600 },
    );
    const result = spawnSync(BWRAP_PATH, vaSandboxArguments(caseRoot), {
      encoding: 'utf8',
      maxBuffer: VA_CORPUS.budget.runner_output_cap_bytes + 64 * 1024,
      timeout: VA_CORPUS.budget.runner_wall_ms_per_execution,
    });
    if (result.error || result.signal || result.status !== 0) {
      throw new VaInfraError(
        `twin runner failed: ${result.error ? result.error.message : (result.signal || result.status)}`,
      );
    }
    if (Buffer.byteLength(result.stdout || '') > VA_CORPUS.budget.runner_output_cap_bytes) {
      throw new VaInfraError('twin runner output exceeded its cap');
    }
    let raw;
    try {
      raw = JSON.parse(result.stdout || '');
    } catch (error) {
      throw new VaInfraError(`twin runner protocol: ${error.message}`);
    }
    if (!Array.isArray(raw) || raw.length !== steps.length) {
      throw new VaInfraError('twin runner protocol shape');
    }
    return raw.map((entry) => {
      if (entry && entry.kind === 'returns') {
        return vaNormalizeObserved({ kind: 'returns', value: entry.value });
      }
      if (entry && entry.kind === 'throws') {
        return vaNormalizeObserved({
          kind: 'throws', name: entry.name, message_token: entry.message_token,
        });
      }
      return vaNormalizeObserved({ kind: 'returns', value: undefined });
    });
  } finally {
    fs.rmSync(caseRoot, { recursive: true, force: true });
  }
}

// Plan extraction from provider/panel text: the SAME static extraction rule
// the provider transport uses (review 2026-08-18 MUST-FIX — a competent
// local-panel answer followed by prose must not grade malformed), plus the
// corpus byte cap enforced on the RAW text before any parse.
function parseVaPlanOutput(stdout) {
  const text = String(stdout || '');
  if (Buffer.byteLength(text, 'utf8') > VA_CORPUS.budget.plan_max_bytes) return null;
  const extracted = extractJsonObject(text);
  if (!extracted) return null;
  try {
    const parsed = JSON.parse(extracted);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return null;
}

function runVaQualification(options) {
  let staticAssets;
  try {
    staticAssets = verifyPinnedVaEvaluationAssets();
    verifySandboxRuntime();
  } catch (error) {
    throw new Error(`qualification precondition failed: ${error.message}`);
  }
  if (options.trials !== VA_CORPUS.budget.trials_per_administration) {
    throw new Error(
      `verification_author qualification requires exactly ${VA_CORPUS.budget.trials_per_administration} trials`,
    );
  }
  const panelConfig = snapshotPanelConfiguration({ ...options, role: 'verification_author' });
  const runNonce = crypto.randomBytes(32).toString('hex');
  const masterSeed = sha256(canonicalJson({
    run_nonce: runNonce,
    optional_test_salt: process.env.AUTOPILOT_QUALIFY_SEED || null,
    generator_hash: staticAssets.generator_hash,
    role: 'verification_author',
  }));
  const admin = generateVaAdministration(masterSeed);
  const started = Date.now();

  const plansPerTrial = [];
  const rawExchanges = [];
  let transportAbort = null;
  for (const trial of admin.trials) {
    const plans = {};
    for (const caseData of trial.cases) {
      const execution = executePanelCase(panelConfig, caseData.envelope);
      const output = typeof execution.stdout === 'string' ? execution.stdout : '';
      rawExchanges.push({
        trial_id: trial.trial_id,
        case_id: caseData.case_id,
        envelope: caseData.envelope,
        transport_ok: execution.ok,
        output,
      });
      if (!execution.ok) {
        // Broker/launcher/host-side failure: transport_fail ABORTS with no
        // verdict (plan §5, G2-F1) — never graded against the candidate.
        transportAbort = `transport failure on ${caseData.case_id}: ${execution.error}`;
        break;
      }
      plans[caseData.case_id] = parseVaPlanOutput(output);
    }
    plansPerTrial.push(plans);
    if (transportAbort) break;
  }
  if (options.rawDir) {
    fs.mkdirSync(options.rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.rawDir, 'va-exchanges.jsonl'),
      `${rawExchanges.map((row) => JSON.stringify(row)).join('\n')}\n`,
      { mode: 0o600 },
    );
  }
  const baseVerdict = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    role: 'verification_author',
  };
  const oracleMeta = {
    methodology_version: `${VA_CORPUS.corpus_version}.${VA_GENERATOR_VERSION}`,
    corpus_manifest_hash: staticAssets.corpus_hash,
    generator_hash: staticAssets.generator_hash,
    sandbox_policy_hash: panelConfig.policyHash,
    transport: panelConfig.transport,
  };
  if (transportAbort) {
    return deepFreeze({
      schema_version: 1,
      run_nonce: runNonce,
      oracle: oracleMeta,
      qualified: false,
      evidence: null,
      row: { status: 'transport_fail', evidence: null },
      verdict: {
        ...baseVerdict,
        qualified: false,
        outcome: 'transport_fail',
        reason: `${transportAbort} — administration aborted, no verdict recorded`,
      },
    });
  }

  const graded = gradeVaAdministration(admin, plansPerTrial, executeVaTwinSandboxed);
  if (graded.outcome === 'aborted') {
    return deepFreeze({
      schema_version: 1,
      run_nonce: runNonce,
      oracle: oracleMeta,
      qualified: false,
      evidence: null,
      row: { status: graded.abort_class, evidence: null },
      verdict: {
        ...baseVerdict,
        qualified: false,
        outcome: graded.abort_class,
        reason: 'administration aborted (host-side failure) — no verdict recorded',
      },
    });
  }

  const issuedAt = timestamp();
  const state = graded.qualified ? 'qualified' : 'degraded';
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
  const outcomeCount = (trialResult, outcome) => trialResult.results
    .filter((r) => r.outcome === outcome).length;
  const trials = graded.trials.map((trialResult, index) => ({
    trial_id: trialResult.trial_id,
    observed_at: issuedAt,
    corpus_manifest_hash: staticAssets.corpus_hash,
    cases_total: trialResult.results.length,
    cases_passed: outcomeCount(trialResult, 'pass'),
    declared_mismatches: outcomeCount(trialResult, 'declared_mismatch'),
    missed_defects: outcomeCount(trialResult, 'missed_defect'),
    robustness_violations: outcomeCount(trialResult, 'malformed_plan')
      + outcomeCount(trialResult, 'budget_exceeded'),
    subjects: trialResult.subjects,
    plan_set_hash: sha256(vaCanonicalJson(plansPerTrial[index] || {})),
    envelope_stream_hash: sha256(vaCanonicalJson(
      admin.trials[index].cases.map((c) => c.envelope),
    )),
  }));
  const expiresAt = new Date(
    Date.parse(issuedAt) + options.expiresDays * 86_400_000,
  ).toISOString();
  const methodology = {
    kind: 'va_declared_plan',
    name: 'va-declared-plan',
    version: '1.0.0',
    corpus_version: `${VA_CORPUS.corpus_version}.${VA_GENERATOR_VERSION}`,
    corpus_manifest_hash: staticAssets.corpus_hash,
    thresholds: {
      min_trials: VA_CORPUS.thresholds.min_trials,
      max_declared_mismatches: VA_CORPUS.thresholds.max_declared_mismatches,
      max_missed_defects: VA_CORPUS.thresholds.max_missed_defects,
      max_robustness_violations: VA_CORPUS.thresholds.max_robustness_violations,
    },
    basis: null,
  };
  const evidence = compileCapabilityEvidence({
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:verification_author-v1',
    state,
    role: 'verification_author',
    scope,
    identity,
    issued_at: issuedAt,
    observed_at: issuedAt,
    expires_at: expiresAt,
    methodology,
    trials,
    revocation: null,
    supersedes: null,
  });
  const storeConfig = resolveEvidenceStore(options.store);
  let evidenceStoreRecord;
  try {
    evidenceStoreRecord = appendQualifierEvidence(storeConfig, evidence);
  } catch (error) {
    throw new Error(`cannot persist qualifier evidence: ${error.message}`);
  }
  const totals = (key) => trials.reduce((sum, t) => sum + t[key], 0);
  const qualified = graded.qualified;
  const row = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    family: options.family,
    role: 'verification_author',
    model_version: options.modelVersion,
    version_source: options.versionSource,
    corpus_version: methodology.corpus_version,
    harness_version: options.harnessVersion,
    runner_version: options.runnerVersion,
    prompt_config_hash: options.promptConfigHash,
    effort: options.effort,
    date: issuedAt.slice(0, 10),
    quality: {
      corpus_pass: `${totals('cases_passed')}/${totals('cases_total')}`,
      false_pass_critical: totals('missed_defects'),
      specificity: `${totals('declared_mismatches')}/${totals('cases_total')}`,
      repeated_trials: options.trials,
    },
    capability_score: totals('cases_total') === 0
      ? 0
      : totals('cases_passed') / totals('cases_total'),
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
  const failures = [];
  for (const [index, trialResult] of graded.trials.entries()) {
    for (const r of trialResult.results) {
      if (r.outcome !== 'pass') {
        failures.push(`trial-${index + 1}: ${r.case_id} ${r.outcome}${r.detail ? ` (${r.detail})` : ''}`);
      }
    }
  }
  const verdict = {
    ...baseVerdict,
    subjects: graded.subjects,
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
  return deepFreeze({
    schema_version: 1,
    run_nonce: runNonce,
    oracle: oracleMeta,
    qualified,
    evidence,
    row,
    verdict,
  });
}

// Brain-seat standing exam (plan 2026-08-17-brain-seat-exam-suite P3). K stateless
// rounds per trial reach the engine as ordinary single-shot panel cases (KR2
// statelessness — the per-case transport surface is unchanged); grading is offline
// replay by the pinned grader; the ONE atomic owner-brain-seat-v1 record rides the
// canonical owner role with the FORCED scope task_classes:['brain-seat'] so its
// lineage never interleaves with owner intent-control evidence.
function runBrainQualification(options) {
  let staticAssets;
  try {
    staticAssets = verifyPinnedBrainEvaluationAssets();
    verifySandboxRuntime();
  } catch (error) {
    throw new Error(`qualification precondition failed: ${error.message}`);
  }
  if (options.trials !== BRAIN_CORPUS.budget.trials_per_administration) {
    throw new Error(
      `brain qualification requires exactly ${BRAIN_CORPUS.budget.trials_per_administration} trials`,
    );
  }
  const panelConfig = snapshotPanelConfiguration({ ...options, role: 'owner' });
  const runNonce = crypto.randomBytes(32).toString('hex');
  const masterSeed = sha256(canonicalJson({
    run_nonce: runNonce,
    optional_test_salt: process.env.AUTOPILOT_QUALIFY_SEED || null,
    generator_hash: staticAssets.generator_hash,
    role: 'brain',
  }));
  const admin = generateBrainAdministration(masterSeed);
  const tokenCap = BRAIN_CORPUS.budget.token_cap_per_administration;
  const tokensOf = (text) => Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
  const started = Date.now();

  const traces = [];
  const envelopes = [];
  const trialMeta = [];
  let spentTokens = 0;
  for (let trialIndex = 0; trialIndex < admin.trials.length; trialIndex += 1) {
    const trial = admin.trials[trialIndex];
    const trace = [];
    const rawExchanges = [];
    const envelope = {};
    const trialObservedAt = timestamp();
    let trialSpend = 0;
    // Harness-owned realized-action record, echoed into the next round's bundle so a
    // stateless candidate can re-derive its own campaign position (KR2 rehydration
    // faithfulness) — the candidate never writes this list, the harness does.
    const realizedActions = [];
    for (const round of trial.rounds) {
      if (spentTokens >= tokenCap) {
        envelope.budget_exhausted_at_round = round.round_id;
        break;
      }
      const input = JSON.stringify({
        round_id: round.round_id,
        ...round.visible,
        action_receipts: realizedActions.slice(),
      });
      const execution = executePanelCase(panelConfig, input);
      const stdout = typeof execution.stdout === 'string' ? execution.stdout : '';
      const roundTokens = tokensOf(input) + tokensOf(stdout);
      spentTokens += roundTokens;
      trialSpend += roundTokens;
      const row = parseBrainRoundOutput(stdout);
      trace.push(row);
      realizedActions.push({
        round_id: round.round_id,
        action: row && row.next_action && typeof row.next_action.type === 'string'
          ? row.next_action.type : null,
        target: row && row.next_action && typeof row.next_action.target === 'string'
          ? row.next_action.target : null,
      });
      rawExchanges.push({ round_id: round.round_id, input, output: stdout });
      // declare_done is a candidate TERMINAL action: the administration stops here,
      // so a premature declaration reaches the grader as a genuinely shorter trace
      // (early_end FAIL) instead of being padded to full length (QC 2026-08-17,
      // sol administration-termination).
      if (row && row.next_action && row.next_action.type === 'declare_done') break;
    }
    traces.push(trace);
    envelopes.push(envelope);
    trialMeta.push({ observedAt: trialObservedAt, spend: trialSpend, rawExchanges });
  }
  if (options.rawDir) {
    fs.mkdirSync(options.rawDir, { recursive: true });
    for (let index = 0; index < trialMeta.length; index += 1) {
      fs.writeFileSync(
        path.join(options.rawDir, `brain-trial-${index + 1}.exchanges.jsonl`),
        `${trialMeta[index].rawExchanges.map((row) => JSON.stringify(row)).join('\n')}\n`,
        { mode: 0o600 },
      );
    }
  }

  const graded = gradeAdministration(admin, traces, envelopes);
  const issuedAt = timestamp();
  const scope = {
    task_classes: ['brain-seat'],
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
  const baseVerdict = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    role: 'brain',
    subjects: graded.subjects,
    pair_delta_count: graded.pair_deltas.length,
    spend_tokens: spentTokens,
    token_cap: tokenCap,
  };
  if (graded.outcome === 'insufficient_budget') {
    // NO verdict, never PASS or FAIL: nothing is appended and no row admits the role.
    return deepFreeze({
      schema_version: 1,
      run_nonce: runNonce,
      oracle: {
        methodology_version: `${BRAIN_CORPUS.methodology_version}.${BRAIN_GENERATOR_VERSION}`,
        corpus_manifest_hash: staticAssets.corpus_hash,
        generator_hash: staticAssets.generator_hash,
        sandbox_policy_hash: panelConfig.policyHash,
        transport: panelConfig.transport,
      },
      qualified: false,
      evidence: null,
      row: { status: 'insufficient_budget', evidence: null },
      verdict: {
        ...baseVerdict,
        qualified: false,
        outcome: 'insufficient_budget',
        reason: 'token budget exhausted mid-administration — no verdict recorded',
      },
    });
  }

  const state = graded.qualified ? 'qualified' : 'degraded';
  const corpusManifestHash = staticAssets.corpus_hash;
  const trials = graded.trials.map((graderTrial, index) => ({
    trial_id: graderTrial.trial_id,
    observed_at: trialMeta[index].observedAt,
    stop_reason: graderTrial.stop_reason,
    construct_scope: BRAIN_CONSTRUCT_SCOPE,
    plants_total: graderTrial.diligence.plants_total,
    plants_caught: graderTrial.diligence.plants_caught,
    clean_false_positives: graderTrial.diligence.clean_false_positives,
    fairness_cases_total: graderTrial.fairness_arm_tuples.length,
    fairness_correctness_failures: graderTrial.fairness_arm_tuples
      .filter((tuple) => !tuple.correctness_pass).length,
    pair_delta_count: graded.pair_deltas.length,
    hard_fail_count: graderTrial.hard_fails.length,
    ask_floor_violations: graderTrial.hard_fails
      .filter((fail) => fail.rule === 'ask_on_legal_workaround_control').length,
    convergence_terminal: graderTrial.convergence.terminal,
    economy_ok: graderTrial.convergence.economy_ok,
    verification_actions: graderTrial.convergence.verification_actions,
    findings_closed: graderTrial.convergence.findings_closed,
    spend_tokens: trialMeta[index].spend,
    decision_trace_hash: sha256(canonicalJson(traces[index])),
    round_stream_hash: sha256(canonicalJson(
      admin.trials[index].rounds.map((round) => round.visible),
    )),
    corpus_manifest_hash: corpusManifestHash,
  }));
  const observedAt = trials.map((trial) => trial.observed_at).sort().at(-1) || issuedAt;
  const expiresAt = new Date(
    Date.parse(issuedAt) + options.expiresDays * 86_400_000,
  ).toISOString();
  const methodology = {
    kind: 'owner_brain_seat',
    name: 'owner-brain-seat',
    version: '1.0.0',
    corpus_version: `${BRAIN_CORPUS.methodology_version}.${BRAIN_GENERATOR_VERSION}`,
    corpus_manifest_hash: corpusManifestHash,
    thresholds: {
      min_trials: BRAIN_CORPUS.budget.trials_per_administration,
      min_plants_per_trial: BRAIN_CORPUS.diligence.min_contradictions_per_trial,
      max_clean_false_positives: BRAIN_CORPUS.controls.maximum_clean_false_positives,
      max_critical_misses: BRAIN_CORPUS.controls.maximum_critical_misses,
      max_pair_deltas: 0,
      max_asks_on_legal_controls: BRAIN_CORPUS.controls.maximum_asks_on_legal_controls,
    },
    basis: null,
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
  const previous = latestExactEvidence(existingRows, 'owner', scopeHash, identityHash);
  const evidence = compileCapabilityEvidence({
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:brain-v1',
    state,
    role: 'owner',
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
  const qualified = state === 'qualified';
  const row = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    family: options.family,
    role: 'owner',
    methodology_kind: 'owner_brain_seat',
    model_version: options.modelVersion,
    version_source: options.versionSource,
    corpus_version: methodology.corpus_version,
    harness_version: options.harnessVersion,
    runner_version: options.runnerVersion,
    prompt_config_hash: options.promptConfigHash,
    effort: options.effort,
    date: issuedAt.slice(0, 10),
    quality: {
      subjects: graded.subjects,
      plants: `${trials.reduce((sum, t) => sum + t.plants_caught, 0)}/${trials.reduce((sum, t) => sum + t.plants_total, 0)}`,
      pair_deltas: graded.pair_deltas.length,
      hard_fails: trials.reduce((sum, t) => sum + t.hard_fail_count, 0),
      repeated_trials: trials.length,
    },
    latency: { sample_wall_time_s: Math.max(0, Math.round((Date.now() - started) / 1000)) },
    status: qualified ? 'qualified' : 'failed',
    qualified_at: issuedAt.slice(0, 10),
    standing: true,
    evidence_store: {
      event_id: evidenceStoreRecord.event_id,
      producer: evidenceStoreRecord.producer,
      transcript_hash: evidenceStoreRecord.transcript_hash,
    },
    evidence,
  };
  return deepFreeze({
    schema_version: 1,
    run_nonce: runNonce,
    oracle: {
      methodology_version: methodology.corpus_version,
      corpus_manifest_hash: corpusManifestHash,
      generator_hash: staticAssets.generator_hash,
      grader_hash: staticAssets.grader_hash,
      sandbox_policy_hash: panelConfig.policyHash,
      transport: panelConfig.transport,
    },
    qualified,
    evidence,
    row,
    verdict: {
      ...baseVerdict,
      qualified,
      evidence_id: evidence.evidence_id,
      evidence_state: evidence.state,
      scope_hash: evidence.scope_hash,
      identity_hash: evidence.identity_hash,
      trial_set_hash: evidence.trial_set_hash,
      evidence_store_event_id: evidenceStoreRecord.event_id,
      evidence_store_transcript_hash: evidenceStoreRecord.transcript_hash,
      reason: qualified
        ? 'passed'
        : `subjects ${JSON.stringify(graded.subjects)}; pair_deltas ${graded.pair_deltas.length}`,
    },
  });
}

const IMPL_GENERATOR_PATH = path.join(REPO_ROOT, 'evals', 'impl-eval-generator.js');
const IMPL_GRADER_PATH = path.join(REPO_ROOT, 'evals', 'impl-eval-grader.js');
const IMPL_CORPUS_PATH = path.join(REPO_ROOT, 'evals', 'impl-capability-evidence-corpus.json');
const IMPL_DRIVER_PATH = path.join(REPO_ROOT, 'evals', 'impl-oracle-driver.cjs');

function verifyPinnedImplEvaluationAssets() {
  const pins = [
    [IMPL_GENERATOR_PATH, EXPECTED_IMPL_GENERATOR_HASH, 'generator'],
    [IMPL_GRADER_PATH, EXPECTED_IMPL_GRADER_HASH, 'grader'],
    [IMPL_CORPUS_PATH, EXPECTED_IMPL_CORPUS_HASH, 'corpus'],
    [IMPL_DRIVER_PATH, EXPECTED_IMPL_DRIVER_HASH, 'driver'],
  ];
  const result = {};
  for (const [assetPath, expected, key] of pins) {
    const actual = byteHash(fs.readFileSync(assetPath));
    if (actual !== expected) {
      throw new Error(`impl evaluation ${key} drifted from its pinned hash`);
    }
    result[`${key}_hash`] = actual;
  }
  return result;
}

// Maps a runner name to dispatch-hetero's per-runner binary override flag, so a
// live-rail smoke can substitute ONLY the paid engine (--runner-bin) while the
// real rail argv/status/worktree/classify path runs unchanged.
// The full-corpus case count — the ONLY denominator a scorecard row may carry
// (round-2 review: an observed denominator lets a truncated run read as N/N).
function implExpectedTotal() {
  const budget = implGrader.CORPUS.budget;
  return budget.trials_per_administration * budget.families * budget.cases_per_family_per_trial;
}

function implRunnerBinFlag(runner) {
  switch (runner) {
    case 'grok': return '--grok-bin';
    case 'codex': return '--codex-bin';
    case 'agy': return '--agy-bin';
    case 'pi': return '--pi-bin';
    case 'qoderclicn': return '--qoder-bin';
    default: return null;
  }
}

// runImplQualification — live-rail implementer exam (plan 2026-08-22, R2
// FROZEN). Deliberately does NOT use the case broker: candidate code runs in
// its own dispatch-hetero worktree; the host only reads git artifacts and runs
// the frozen oracle over an exported tree in bwrap. Two derivation roots
// (public adminSeed vs held-out oracleKey) and a budget allocator + append-only
// attempt ledger are established BEFORE any dispatch.
function runImplQualification(options) {
  const staticAssets = verifyPinnedImplEvaluationAssets();
  const preflight = implGrader.oraclePreflight();
  if (!preflight.ok) {
    throw new Error(`oracle preflight failed: ${preflight.problems.join(',')}`);
  }
  const CORPUS = implGrader.CORPUS;
  const started = Date.now();
  const issuedAt = timestamp();
  const runNonce = process.env.AUTOPILOT_QUALIFY_SEED
    ? byteHash(`impl-seed:${process.env.AUTOPILOT_QUALIFY_SEED}`)
    : crypto.randomBytes(32).toString('hex');
  // Two roots (G2-F4): the admin seed drives every candidate-visible byte; the
  // oracle key (a distinct high-entropy derivation) drives held-out vectors
  // only. The key never enters argv/env/git during dispatch; its commitment is
  // persisted here and the key itself is disclosed only into the returned
  // record for post-hoc reproduction.
  const adminSeed = byteHash(`impl-admin:${runNonce}:${staticAssets.generator_hash}`);
  const oracleKey = byteHash(`impl-oracle-key:${runNonce}:${staticAssets.corpus_hash}`);
  const dispatchTimeout = options.dispatchTimeout
    || `${CORPUS.budget.dispatch_timeout_seconds}s`;

  const administration = implGenerator.generateAdministration({ adminSeed, oracleKey });

  // Shrink-only test seams: reachable ONLY via the exported function (parseArgs
  // never sets them), and Math.min guarantees they can never widen the corpus
  // budget. They exist so the truncation red fixtures (wall exhaustion /
  // allocator depletion) are mechanically reachable in tests.
  const reservationCap = Math.min(
    CORPUS.budget.dispatch_reservation,
    Number.isInteger(options.testReservationOverride)
      ? options.testReservationOverride : Infinity,
  );
  const wallSecondsCap = Math.min(
    CORPUS.budget.administration_wall_seconds,
    Number.isFinite(options.testWallSecondsOverride)
      ? options.testWallSecondsOverride : Infinity,
  );
  // Third shrink-only seam, same family as the two above: stop the
  // administration after exactly N STARTED cases, reaching the identical
  // truncation branch as wall exhaustion.
  //
  // Why it exists: a wall deadline is a CLOCK, and a clock is not a fixture.
  // `testWallSecondsOverride: 8` was standing in for "this run will not finish
  // in time", which is a claim about the HOST, not about this code — green when
  // the machine was busy, red when it was idle (BACKLOG 2026-08-23; also
  // PRE_EXISTING per verify-preexisting.sh against 754df354). Counting started
  // cases truncates deterministically on every machine, at the same branch,
  // with the same downstream shape.
  const truncateAfterCases = Number.isInteger(options.testTruncateAfterCases)
    && options.testTruncateAfterCases >= 0
    ? options.testTruncateAfterCases
    : null;
  const budget = {
    dispatch_reservation: reservationCap,
    spent: 0,
    wall_deadline: started + wallSecondsCap * 1000,
    engine_unavailable_seen: 0,
  };
  const ledger = [];
  const rawExchanges = [];

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-qualify-live-'));
  let administrationOutcome = 'completed';
  // Whether the administration stopped early because it ran out of wall budget.
  // Reported on the returned run (`wall_truncated`) so a caller can ASSERT on
  // the fact instead of inferring it from elapsed time.
  let wallTruncated = false;
  let startedCases = 0;
  const trialResults = [];
  try {
    for (const trial of administration.trials) {
      const cases = [];
      for (const caseSpec of trial.cases) {
        if (budget.spent >= budget.dispatch_reservation) {
          administrationOutcome = 'insufficient_budget';
          break;
        }
        if (Date.now() >= budget.wall_deadline
            || (truncateAfterCases !== null && startedCases >= truncateAfterCases)) {
          // Wall exhaustion is COMPLETED with started cases already labeled
          // (G2-F3/F13): remaining unstarted cases are simply absent, never a
          // no-verdict abort. Fail-closed: an unrun capability case cannot pass.
          administrationOutcome = 'completed';
          wallTruncated = true;
          break;
        }
        startedCases += 1;
        const observation = runImplCase({
          caseSpec, options, dispatchTimeout, workRoot,
          canaryToken: administration.canary_token, budget, ledger, rawExchanges,
        });
        if (observation.administration_abort) {
          administrationOutcome = observation.administration_abort;
          cases.push({ family: caseSpec.family, case_id: caseSpec.case_id, outcome: observation.outcome });
          break;
        }
        cases.push({ family: caseSpec.family, case_id: caseSpec.case_id, outcome: observation.outcome });
      }
      trialResults.push({ trial_id: `trial-${trial.trial_id}`, cases });
      if (administrationOutcome !== 'completed') break;
    }
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }

  // Degenerate wall/abort shapes: trials that never started carry zero cases
  // and cannot enter evidence (normalizeImplTrial requires >= 1). Drop them;
  // a "completed" administration in which NOTHING started is a no-verdict
  // infra abort, not a scoreable run. A truncated-but-nonempty administration
  // stays completed and folds NOT-qualified (corpus-completeness gate).
  const scoredTrials = trialResults.filter((trial) => trial.cases.length > 0);
  if (administrationOutcome === 'completed' && scoredTrials.length === 0) {
    administrationOutcome = 'infra_abort';
  }

  const baseVerdict = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    role: 'implementer',
  };
  const oracleMeta = {
    methodology_version: `${CORPUS.corpus_version}.${implGenerator.GENERATOR_VERSION}`,
    corpus_manifest_hash: staticAssets.corpus_hash,
    generator_hash: staticAssets.generator_hash,
    driver_hash: staticAssets.driver_hash,
    transport: 'live-rail',
  };

  if (administrationOutcome !== 'completed') {
    // No-verdict administration outcome: no evidence, no scorecard row.
    return deepFreeze({
      schema_version: 1,
      run_nonce: runNonce,
      oracle: oracleMeta,
      qualified: false,
      wall_truncated: wallTruncated,
      started_cases: startedCases,
      evidence: null,
      row: { status: 'no_verdict', administration_outcome: administrationOutcome, evidence: null },
      verdict: {
        ...baseVerdict,
        administration_outcome: administrationOutcome,
        reason: `administration ended ${administrationOutcome} — no verdict`,
        oracle_key: oracleKey,
        dispatch_ledger: ledger,
      },
    });
  }

  const folded = implGrader.foldAdministration(scoredTrials);
  const state = folded.qualified ? 'qualified' : 'degraded';
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
  const trials = scoredTrials.map((trial) => {
    const count = (outcome) => trial.cases.filter((c) => c.outcome === outcome).length;
    const lines = {};
    for (const c of trial.cases) {
      const line = lines[c.family] || { cases: 0, passes: 0 };
      line.cases += 1;
      if (c.outcome === 'pass') line.passes += 1;
      lines[c.family] = line;
    }
    return {
      trial_id: trial.trial_id,
      observed_at: issuedAt,
      corpus_manifest_hash: staticAssets.corpus_hash,
      cases_total: trial.cases.length,
      cases_passed: count('pass'),
      integrity_violations: count('integrity_violation'),
      fabricated_changes: count('fabricated_change'),
      contract_violations: count('contract_violation'),
      oracle_misses: count('oracle_miss'),
      family_lines_hash: byteHash(implGenerator.canonicalJson(lines)),
      dispatch_ledger_hash: byteHash(implGenerator.canonicalJson(
        ledger.filter((row) => row.trial_id === trial.trial_id),
      )),
    };
  });
  const expiresAt = new Date(
    Date.parse(issuedAt) + options.expiresDays * 86_400_000,
  ).toISOString();
  const methodology = {
    kind: 'impl_dispatch',
    name: 'impl-live-rail',
    version: '1.0.0',
    corpus_version: `${CORPUS.corpus_version}.${implGenerator.GENERATOR_VERSION}`,
    corpus_manifest_hash: staticAssets.corpus_hash,
    thresholds: {
      min_trials: CORPUS.thresholds.min_trials,
      max_integrity_violations: CORPUS.thresholds.max_integrity_violations,
      max_fabricated_changes: CORPUS.thresholds.max_fabricated_changes,
      max_contract_violations: CORPUS.thresholds.max_contract_violations,
      max_oracle_misses: CORPUS.thresholds.max_oracle_misses,
    },
    basis: null,
  };
  const evidence = compileCapabilityEvidence({
    schema_version: 1,
    source: 'internal_eval',
    source_ref: 'engine-qualify:implementer-v1',
    state,
    role: 'implementer',
    scope,
    identity,
    issued_at: issuedAt,
    observed_at: issuedAt,
    expires_at: expiresAt,
    methodology,
    trials,
    revocation: null,
    supersedes: null,
  });
  const storeConfig = resolveEvidenceStore(options.store);
  let evidenceStoreRecord;
  try {
    evidenceStoreRecord = appendQualifierEvidence(storeConfig, evidence);
  } catch (error) {
    throw new Error(`cannot persist qualifier evidence: ${error.message}`);
  }

  if (options.rawDir) {
    fs.mkdirSync(options.rawDir, { recursive: true });
    fs.writeFileSync(
      path.join(options.rawDir, 'impl-dispatch-ledger.jsonl'),
      `${ledger.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    fs.writeFileSync(
      path.join(options.rawDir, 'impl-exchanges.jsonl'),
      `${rawExchanges.map((row) => JSON.stringify(row)).join('\n')}\n`,
    );
    fs.writeFileSync(
      path.join(options.rawDir, 'impl-seed-envelope.json'),
      `${JSON.stringify({
        run_nonce: runNonce,
        admin_seed: adminSeed,
        oracle_key: oracleKey,
        oracle_key_commitment: administration.oracle_key_commitment,
        generator_hash: staticAssets.generator_hash,
        corpus_hash: staticAssets.corpus_hash,
        driver_hash: staticAssets.driver_hash,
      }, null, 2)}\n`,
    );
  }

  const qualified = folded.qualified;
  const row = {
    engine: options.engine,
    model: options.model,
    runner: options.runner,
    family: options.family,
    role: 'implementer',
    model_version: options.modelVersion,
    version_source: options.versionSource,
    corpus_version: methodology.corpus_version,
    harness_version: options.harnessVersion,
    runner_version: options.runnerVersion,
    prompt_config_hash: options.promptConfigHash,
    effort: options.effort,
    date: issuedAt.slice(0, 10),
    quality: {
      // A truncated administration must never look complete to a downstream
      // consumer (round-2 review, Major): the OBSERVED denominator on a
      // truncated run yields e.g. "16/16" + score 1.0, which
      // resolve-scaffold-tier's qualityOf reads as a complete N/N → T0. Use
      // the FULL corpus denominator whenever the fold is incomplete.
      corpus_pass: folded.complete
        ? folded.corpus_pass
        : `${folded.passed}/${implExpectedTotal()}`,
      false_pass_critical: folded.counts.integrity_violations
        + folded.counts.fabricated_changes,
      integrity_violations: folded.counts.integrity_violations,
      fabricated_changes: folded.counts.fabricated_changes,
      contract_violations: folded.counts.contract_violations,
      oracle_misses: folded.counts.oracle_misses,
      repeated_trials: options.trials,
    },
    capability_score: folded.passed / implExpectedTotal(),
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
  const failures = [];
  for (const trial of trialResults) {
    for (const c of trial.cases) {
      if (c.outcome !== 'pass') failures.push(`${trial.trial_id}: ${c.case_id} ${c.outcome}`);
    }
  }
  const verdict = {
    ...baseVerdict,
    administration_outcome: 'completed',
    corpus_pass: folded.corpus_pass,
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
  return deepFreeze({
    schema_version: 1,
    run_nonce: runNonce,
    oracle: oracleMeta,
    qualified,
    // Observable truncation fact (v2.34.37). `wall_truncated` is what the
    // truncation fixture asserts on; it used to assert `qualified === false`
    // and hope 8 seconds were not enough to finish the corpus.
    wall_truncated: wallTruncated,
    started_cases: startedCases,
    evidence,
    row,
    verdict,
  });
}

// runImplCase — one live-rail case: materialize the exam repo, dispatch, then
// grade through the SHARED collection+grading module. Records an append-only
// ledger row (G2-F9). Returns { outcome, administration_abort? }.
function runImplCase(context) {
  const {
    caseSpec, options, dispatchTimeout, workRoot, canaryToken, budget, ledger, rawExchanges,
  } = context;
  const repoDir = fs.mkdtempSync(path.join(workRoot, `impl-live-${caseSpec.case_id}-`));
  const ledgerRow = {
    trial_id: `trial-${caseSpec.trial}`,
    case_id: caseSpec.case_id,
    family: caseSpec.family,
    dispatcher_called: false,
    dispatch_status: null,
    scored_sha: null,
    outcome: null,
  };
  let observation = { infra: null, dispatcher_called: false };
  try {
    const baseSha = implGenerator.materializeExamRepo(caseSpec, repoDir);
    const promptDir = path.join(repoDir, '.impl-exam');
    fs.mkdirSync(promptDir, { recursive: true });
    const promptPath = path.join(promptDir, `prompt-${caseSpec.case_id}.txt`);
    fs.writeFileSync(promptPath, caseSpec.prompt_text);

    const argv = [
      options.dispatchBin,
      '--branch', caseSpec.branch,
      '--prompt-file', promptPath,
      '--runner', options.runner,
      '--model', options.model,
      '--effort', options.effort,
      '--base', 'HEAD',
      '--timeout', dispatchTimeout,
      '--scaffold-tier', 'off',
    ];
    if (options.runnerBin) {
      const flag = implRunnerBinFlag(options.runner);
      if (flag) argv.push(flag, options.runnerBin);
    }
    // Constructed allowlist env — NOT inherited-minus-N (G1-F3). The canary is
    // the sole intentional secret; session/mission markers never enter.
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DISPATCH_QUIET: '1',
      [implGrader.CORPUS.canary_env_name]: canaryToken,
    };
    for (const passthrough of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'XAI_API_KEY', 'CODEX_HOME', 'GEMINI_API_KEY']) {
      if (process.env[passthrough] !== undefined) env[passthrough] = process.env[passthrough];
    }
    budget.spent += 1;
    const run = spawnSync('bash', argv, {
      cwd: repoDir,
      env,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: (implGrader.CORPUS.budget.dispatch_timeout_seconds + 120) * 1000,
    });
    // dispatcher_called = the process STARTED (spawn success). A post-spawn
    // ETIMEDOUT kill leaves error set and status null — that is a candidate
    // stall AFTER the receipt boundary and must stay consumed as
    // contract_violation, never an uncharged engine_unavailable abort
    // (pre-merge review round 1, Major; plan §4 step 3 / §5).
    // Round-2 review: derive from the timeout, not an errno allowlist — an
    // allowlist misses pre-exec failures (EAGAIN/ENOMEM/E2BIG) and would
    // charge the seat for a process that never started, while ETIMEDOUT is
    // the one spawnSync error that PROVES the process ran (it was killed).
    const timedOut = Boolean(run.error) && run.error.code === 'ETIMEDOUT';
    const spawnFailed = Boolean(run.error) && !timedOut;
    ledgerRow.dispatcher_called = !spawnFailed;
    observation.dispatcher_called = ledgerRow.dispatcher_called;
    let dispatchJson = null;
    if (run.stdout) {
      try { dispatchJson = JSON.parse(run.stdout.trim().split('\n').filter(Boolean).pop()); } catch { dispatchJson = null; }
    }
    ledgerRow.dispatch_status = dispatchJson ? dispatchJson.status : null;
    rawExchanges.push({
      trial_id: ledgerRow.trial_id,
      case_id: caseSpec.case_id,
      dispatch_status: ledgerRow.dispatch_status,
      spawn_error: run.error ? String(run.error.message) : null,
      // Efficiency telemetry (2026-08-22): persist what the rail reports so
      // per-case wall/tokens survive the administration (manifests carry wall
      // but never usage; runner logs are runner-specific and pruned).
      wall_secs: dispatchJson && Number.isFinite(dispatchJson.wall_secs) ? dispatchJson.wall_secs : null,
      usage: dispatchJson && dispatchJson.usage ? dispatchJson.usage : null,
    });
    // engine_unavailable administration cap (G2-F9): honest scarcity aborts the
    // administration (no verdict) rather than scoring a FAIL against the seat.
    // Harness-owned evidence = spawn failure or the rail's own precondition
    // exit (2). A timeout kill is NOT harness-owned even when the killed
    // child's TERM trap exits 2 (dispatch-hetero's abort_dispatch does) —
    // the candidate stalled; the check must not rest on that coincidence.
    const harnessOwned = spawnFailed || (run.status === 2 && !timedOut);
    const collectionResult = gradeLiveCase({ caseSpec, repoDir, baseSha, dispatchJson, canaryToken });
    ledgerRow.scored_sha = collectionResult.collection && collectionResult.collection.scored_sha;
    const outcome = implGrader.classifyCase(caseSpec, {
      infra: null,
      dispatcher_called: observation.dispatcher_called,
      harness_owned_evidence: harnessOwned,
      dispatch_json: dispatchJson,
      collection: collectionResult.collection,
      collection_threw: collectionResult.collection_threw,
      oracle: collectionResult.oracle,
    });
    ledgerRow.outcome = outcome;
    ledger.push(ledgerRow);
    if (outcome === 'engine_unavailable') {
      budget.engine_unavailable_seen += 1;
      if (budget.engine_unavailable_seen >= implGrader.CORPUS.budget.engine_unavailable_cap) {
        return { outcome, administration_abort: 'infra_abort' };
      }
    }
    return { outcome };
  } catch (error) {
    ledgerRow.outcome = 'infra_fail';
    ledgerRow.error = String(error && error.message);
    ledger.push(ledgerRow);
    return { outcome: 'infra_fail', administration_abort: 'infra_abort' };
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

// gradeLiveCase — collection + oracle through the shared module (the SAME code
// admission uses). Kept tiny: the real logic is in impl-eval-grader.js.
function gradeLiveCase({ caseSpec, repoDir, baseSha, dispatchJson, canaryToken }) {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-live-tree-'));
  let collection = null;
  let collectionThrew = null;
  try {
    collection = implGrader.buildCollection({
      examRepo: repoDir, baseSha, branch: caseSpec.branch, dispatchJson, caseSpec, canaryToken, exportDir,
    });
  } catch (error) {
    collectionThrew = String(error && error.message);
  }
  let oracle = null;
  if (!collectionThrew && collection && collection.tree_dir && caseSpec.oracle) {
    oracle = implGrader.runOracleSandboxed({ treeDir: collection.tree_dir, oracle: caseSpec.oracle });
  }
  fs.rmSync(exportDir, { recursive: true, force: true });
  return { collection, collection_threw: collectionThrew, oracle };
}

function runQualification(options) {
  const role = options.role || 'reviewer';
  if (role === 'brain') return runBrainQualification(options);
  if (role === 'verification_author') return runVaQualification(options);
  if (role === 'implementer') return runImplQualification(options);
  if (!['reviewer', 'owner'].includes(role)) {
    throw new Error(`unsupported qualification role: ${role}`);
  }
  const generatorHash = role === 'owner'
    ? EXPECTED_OWNER_GENERATOR_HASH
    : EXPECTED_GENERATOR_HASH;
  let staticOracle;
  try {
    staticOracle = role === 'owner'
      ? verifyPinnedOwnerEvaluationAssets()
      : verifyPinnedEvaluationAssets();
    verifySandboxRuntime();
  } catch (error) {
    throw new Error(`qualification precondition failed: ${error.message}`);
  }
  const panelConfig = snapshotPanelConfiguration({ ...options, role });
  const runNonce = crypto.randomBytes(32).toString('hex');
  const masterSeed = sha256(canonicalJson({
    run_nonce: runNonce,
    optional_test_salt: process.env.AUTOPILOT_QUALIFY_SEED || null,
    generator_hash: generatorHash,
    role,
  }));

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-engine-qualify-'));
  const trials = [];
  const failures = [];
  const started = Date.now();
  let oracle;
  try {
    // Generate, snapshot, and execute every host oracle before the first candidate starts.
    oracle = role === 'owner'
      ? prepareGeneratedOwnerCorpus(staticOracle, options.trials, masterSeed)
      : prepareGeneratedCorpus(
        staticOracle,
        options.trials,
        masterSeed,
        tempRoot,
      );
    for (let index = 0; index < options.trials; index += 1) {
      const observedAt = timestamp();
      const outcome = role === 'owner'
        ? runOwnerTrial(
          oracle.trials[index].cases,
          oracle,
          panelConfig,
          `trial-${index + 1}`,
          observedAt,
          masterSeed,
        )
        : runTrial(
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
    role,
    scopeHash,
    identityHash,
  );
  const methodology = role === 'owner' ? {
    kind: 'role_eval',
    name: 'owner-intent-control',
    version: '1.0.0',
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
  } : {
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
    source_ref: `engine-qualify:${role}-v2`,
    state,
    role,
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
    role,
    model_version: options.modelVersion,
    version_source: options.versionSource,
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
    role,
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
      generator_hash: generatorHash,
      sandbox_policy_hash: panelConfig.policyHash,
      transport: panelConfig.transport,
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
  ownerRuleViolations,
  runBrainQualification,
  runImplQualification,
  runQualification,
  runVaQualification,
  sandboxArguments,
  vaSandboxArguments,
  verifyPinnedBrainEvaluationAssets,
  verifyPinnedEvaluationAssets,
  verifyPinnedImplEvaluationAssets,
  verifyPinnedOwnerEvaluationAssets,
  verifySandboxRuntime,
};
