#!/usr/bin/env node
'use strict';

/**
 * Bounded, read-only plan-review controller.
 *
 * The durable budget key is canonical git identity + ticket. session_id,
 * runner, model, cwd and terminal process identity are metadata only and cannot
 * reset the generation or wall-clock budget.
 *
 * Exit codes:
 *   0 accepted READY/CONDITIONAL result
 *   2 usage or local precondition failure
 *   3 policy STOP (cap, deadline, growth, rubric/scope failure)
 *   4 reviewer transport/response failure
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const DISPATCH_AUTHOR = path.join(SCRIPT_DIR, 'dispatch-author.sh');
const RUBRIC_FREEZE = path.join(SCRIPT_DIR, 'rubric-freeze.js');
const DEFAULT_STATE_ROOT = path.join(os.homedir(), '.autopilot', 'plan-review');
const DEFAULTS = Object.freeze({
  maxGenerations: 2,
  maxWallSeconds: 7200,
  growthWarnRatio: 1.25,
  growthStopRatio: 1.5,
  effort: 'xhigh',
  timeout: '5m',
});
const RUNNERS = new Set([
  'codex',
  'agy',
  'grok',
  'cc-shim',
  'anthropic-compatible',
  'claude-native',
  'qoderclicn',
]);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CLASSES = new Set(['decision-now', 'implementation-spike', 'future']);
const SEVERITIES = new Set(['blocking', 'non-blocking']);

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function usage() {
  return `Usage:
  node scripts/dispatch-plan-review.js \\
    --repo-root <repo> --plan-file <plan> --rubric-file <rubric> \\
    --ticket <id> --session-id <id> --generation <1|2|...> \\
    --runner <runner> --model <model> [--effort high] [--timeout 5m] \\
    [--endpoint <name>] \\
    [--deep-runner <runner> --deep-model <model> --deep-effort <effort>] \\
    [--deep-endpoint <name>] [--state-dir <dir>] [--max-generations 2] \\
    [--max-wall-seconds 7200] [--growth-warn-ratio 1.25] \\
    [--growth-stop-ratio 1.50] [--now <ISO-8601>]

The reviewer must return strict JSON:
  {"verdict":"READY|CONDITIONAL|STOP","findings":[...]}

For a blocking finding, the two POC admission booleans must both be true:
  blocks_next_slice_or_immediate_integrity
  cannot_defer_to_spike`;
}

function parseArgs(argv) {
  const opts = {
    effort: DEFAULTS.effort,
    timeout: DEFAULTS.timeout,
    maxGenerations: DEFAULTS.maxGenerations,
    maxWallSeconds: DEFAULTS.maxWallSeconds,
    growthWarnRatio: DEFAULTS.growthWarnRatio,
    growthStopRatio: DEFAULTS.growthStopRatio,
    stateDir: process.env.AUTOPILOT_PLAN_REVIEW_STATE_DIR || DEFAULT_STATE_ROOT,
  };
  const valueFlags = new Map([
    ['--repo-root', 'repoRoot'],
    ['--plan-file', 'planFile'],
    ['--rubric-file', 'rubricFile'],
    ['--ticket', 'ticket'],
    ['--session-id', 'sessionId'],
    ['--generation', 'generation'],
    ['--runner', 'runner'],
    ['--model', 'model'],
    ['--effort', 'effort'],
    ['--timeout', 'timeout'],
    ['--endpoint', 'endpoint'],
    ['--deep-runner', 'deepRunner'],
    ['--deep-model', 'deepModel'],
    ['--deep-effort', 'deepEffort'],
    ['--deep-endpoint', 'deepEndpoint'],
    ['--state-dir', 'stateDir'],
    ['--max-generations', 'maxGenerations'],
    ['--max-wall-seconds', 'maxWallSeconds'],
    ['--growth-warn-ratio', 'growthWarnRatio'],
    ['--growth-stop-ratio', 'growthStopRatio'],
    ['--now', 'now'],
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    const key = valueFlags.get(arg);
    if (!key) throw new CliError(`unknown argument: ${arg}`);
    if (i + 1 >= argv.length || argv[i + 1] === '') {
      throw new CliError(`${arg} requires a non-empty value`);
    }
    opts[key] = argv[++i];
  }

  for (const key of [
    'repoRoot',
    'planFile',
    'rubricFile',
    'ticket',
    'sessionId',
    'generation',
    'runner',
    'model',
  ]) {
    if (opts[key] === undefined || opts[key] === '') {
      throw new CliError(`missing required option: ${key}`);
    }
  }

  opts.generation = parsePositiveInteger(opts.generation, '--generation');
  opts.maxGenerations = parsePositiveInteger(opts.maxGenerations, '--max-generations');
  opts.maxWallSeconds = parsePositiveInteger(opts.maxWallSeconds, '--max-wall-seconds');
  opts.growthWarnRatio = parsePositiveNumber(opts.growthWarnRatio, '--growth-warn-ratio');
  opts.growthStopRatio = parsePositiveNumber(opts.growthStopRatio, '--growth-stop-ratio');
  if (opts.growthWarnRatio >= opts.growthStopRatio) {
    throw new CliError('--growth-warn-ratio must be smaller than --growth-stop-ratio');
  }
  if (opts.maxGenerations > DEFAULTS.maxGenerations) {
    throw new CliError(`--max-generations cannot exceed hard cap ${DEFAULTS.maxGenerations}`);
  }
  if (opts.maxWallSeconds > DEFAULTS.maxWallSeconds) {
    throw new CliError(`--max-wall-seconds cannot exceed hard cap ${DEFAULTS.maxWallSeconds}`);
  }
  if (opts.growthWarnRatio > DEFAULTS.growthWarnRatio) {
    throw new CliError(`--growth-warn-ratio cannot exceed hard cap ${DEFAULTS.growthWarnRatio}`);
  }
  if (opts.growthStopRatio > DEFAULTS.growthStopRatio) {
    throw new CliError(`--growth-stop-ratio cannot exceed hard cap ${DEFAULTS.growthStopRatio}`);
  }
  if (!RUNNERS.has(opts.runner)) {
    throw new CliError(`unsupported --runner: ${opts.runner}`);
  }
  if (!EFFORTS.has(opts.effort)) {
    throw new CliError(`unsupported --effort: ${opts.effort}`);
  }
  opts.timeoutSeconds = parseTimeoutSeconds(opts.timeout);
  if (opts.timeoutSeconds > opts.maxWallSeconds) {
    throw new CliError('--timeout cannot exceed the frozen plan-review wall-clock budget');
  }
  if (!/^[A-Za-z0-9._-]+$/.test(opts.ticket)) {
    throw new CliError('--ticket must match [A-Za-z0-9._-]+');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(opts.sessionId)) {
    throw new CliError('--session-id must match [A-Za-z0-9._:-]+');
  }
  if (opts.endpoint && !/^[A-Za-z0-9_]+$/.test(opts.endpoint)) {
    throw new CliError('--endpoint must match [A-Za-z0-9_]+');
  }
  const hasDeepSeat = ['deepRunner', 'deepModel', 'deepEffort', 'deepEndpoint']
    .some((key) => opts[key] !== undefined);
  if (hasDeepSeat) {
    for (const [key, flag] of [
      ['deepRunner', '--deep-runner'],
      ['deepModel', '--deep-model'],
      ['deepEffort', '--deep-effort'],
    ]) {
      if (!opts[key]) throw new CliError(`${flag} is required for a deep-reviewer seat`);
    }
    if (!RUNNERS.has(opts.deepRunner)) {
      throw new CliError(`unsupported --deep-runner: ${opts.deepRunner}`);
    }
    if (!EFFORTS.has(opts.deepEffort)) {
      throw new CliError(`unsupported --deep-effort: ${opts.deepEffort}`);
    }
    if (opts.deepEndpoint && !/^[A-Za-z0-9_]+$/.test(opts.deepEndpoint)) {
      throw new CliError('--deep-endpoint must match [A-Za-z0-9_]+');
    }
  }
  if (opts.now !== undefined && !Number.isFinite(Date.parse(opts.now))) {
    throw new CliError('--now must be valid ISO-8601');
  }
  if (
    opts.now !== undefined
    && process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1'
  ) {
    throw new CliError('--now is available only under the explicit test seam');
  }

  opts.repoRoot = canonicalDirectory(opts.repoRoot, '--repo-root');
  opts.planFile = canonicalReadableFile(opts.planFile, '--plan-file');
  opts.rubricFile = canonicalReadableFile(opts.rubricFile, '--rubric-file');
  opts.stateDir = path.resolve(opts.stateDir);
  opts.reviewers = [{
    seat: 'chair',
    runner: opts.runner,
    model: opts.model,
    effort: opts.effort,
      endpoint: opts.endpoint,
      timeoutSeconds: opts.timeoutSeconds,
  }];
  if (hasDeepSeat) {
    opts.reviewers.push({
      seat: 'deep',
      runner: opts.deepRunner,
      model: opts.deepModel,
      effort: opts.deepEffort,
      endpoint: opts.deepEndpoint,
      timeoutSeconds: opts.timeoutSeconds,
    });
  }
  return opts;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(`${label} must be a positive integer`);
  }
  return parsed;
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`${label} must be a positive number`);
  }
  return parsed;
}

function parseTimeoutSeconds(value) {
  const raw = String(value || '').trim().toLowerCase();
  let seconds;
  if (/^[1-9][0-9]*s$/.test(raw)) {
    seconds = Number.parseInt(raw.slice(0, -1), 10);
  } else if (/^[1-9][0-9]*m$/.test(raw)) {
    seconds = Number.parseInt(raw.slice(0, -1), 10) * 60;
  } else {
    throw new CliError('--timeout must use positive Ns or Nm syntax');
  }
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    throw new CliError('--timeout is outside the supported range');
  }
  return seconds;
}

function canonicalDirectory(raw, label) {
  let resolved;
  try {
    resolved = fs.realpathSync(raw);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${raw}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new CliError(`${label} must be a directory: ${raw}`);
  }
  return resolved;
}

function canonicalReadableFile(raw, label) {
  let resolved;
  try {
    resolved = fs.realpathSync(raw);
  } catch (error) {
    throw new CliError(`${label} is not readable: ${raw}`);
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new CliError(`${label} must be a regular file: ${raw}`);
  }
  return resolved;
}

function gitOutput(repoRoot, args) {
  const run = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) {
    throw new CliError(`--repo-root must be a git repository: ${repoRoot}`);
  }
  return run.stdout.trim();
}

function canonicalRepoIdentity(repoRoot) {
  const commonRaw = gitOutput(repoRoot, ['rev-parse', '--git-common-dir']);
  const commonPath = path.isAbsolute(commonRaw)
    ? commonRaw
    : path.resolve(repoRoot, commonRaw);
  let canonicalCommon;
  try {
    canonicalCommon = fs.realpathSync(commonPath);
  } catch (error) {
    throw new CliError(`unable to canonicalize git common dir: ${commonPath}`);
  }
  return `git-common-dir:${canonicalCommon}`;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function nowDate(opts) {
  return new Date(opts.now === undefined ? Date.now() : Date.parse(opts.now));
}

function emitAndExit(payload, code) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(code);
}

function atomicWriteJson(filePath, value) {
  const temp = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function withLock(sessionDir, fn) {
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(sessionDir, '.claim.lock');
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw new CliError('plan-review session is busy; generation claim not acquired', 3);
    }
    throw error;
  }
  try {
    return fn();
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function loadState(statePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new CliError(`plan-review state is unreadable: ${statePath}`, 3);
  }
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.claims)) {
    throw new CliError(`plan-review state has an unsupported shape: ${statePath}`, 3);
  }
  return parsed;
}

function freezeRubric(command, rubricFile, sealPath) {
  const args = command === 'seal'
    ? [RUBRIC_FREEZE, 'seal', rubricFile, '--out', sealPath]
    : [RUBRIC_FREEZE, 'check', rubricFile, sealPath, '--json'];
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (run.status !== 0) {
    throw new CliError(
      command === 'seal'
        ? `unable to seal plan-review rubric: ${run.stderr.trim()}`
        : 'frozen plan-review rubric drifted',
      3,
    );
  }
  if (command === 'seal') {
    return JSON.parse(fs.readFileSync(sealPath, 'utf8')).spec_sha256;
  }
  return JSON.parse(run.stdout).spec_sha256;
}

function extractRubricIds(bytes) {
  const text = bytes.toString('utf8');
  const ids = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:(?:#{1,6})\s*|[-*]\s*)?\[?([A-Za-z][A-Za-z0-9_-]*\d+)\]?\s*(?::|[.)-]\s|[—–]\s)/,
    );
    if (match) ids.add(match[1]);
  }
  if (ids.size === 0) {
    throw new CliError(
      'rubric must contain stable IDs such as "- R1: scope" or "## R2 — safety"',
    );
  }
  return ids;
}

function buildPrompt(opts, planBytes, rubricBytes, rubricIds) {
  const nonce = crypto.randomBytes(12).toString('hex');
  return `You are the ${opts.seat || 'chair'} plan-readiness reviewer, not a code reviewer and not a dispatcher.
Review only against the frozen rubric IDs: ${[...rubricIds].join(', ')}.
Current implementation absence is not a defect in a future plan.
Do not request, schedule, or suggest another review generation. The controller owns termination.

Return EXACTLY one JSON object and no markdown:
{
  "verdict": "READY|CONDITIONAL|STOP",
  "findings": [
    {
      "rubric_id": "R1",
      "class": "decision-now|implementation-spike|future",
      "severity": "blocking|non-blocking",
      "evidence": "specific plan section or premise",
      "repair": "smallest bounded repair",
      "blocks_next_slice_or_immediate_integrity": true,
      "cannot_defer_to_spike": true
    }
  ]
}

A finding can block only when it maps to a frozen rubric ID, is class decision-now,
would block the next vertical slice (or cause immediate data/authorization damage),
and cannot safely defer to an implementation spike. Otherwise mark it non-blocking
and classify it implementation-spike or future.

<FROZEN_RUBRIC_${nonce}>
${rubricBytes.toString('utf8')}
</FROZEN_RUBRIC_${nonce}>

<PLAN_UNDER_REVIEW_${nonce}>
${planBytes.toString('utf8')}
</PLAN_UNDER_REVIEW_${nonce}>
`;
}

function normalizeRawModelOutput(raw) {
  return raw
    .replace(/\r/g, '')
    .split('\n')
    .filter((line) => !/^Script (started|done) on /.test(line))
    .join('\n')
    .trim();
}

function dispatchReviewer(opts, prompt, responseEnv) {
  const seam = process.env[responseEnv];
  if (seam) {
    if (process.env.AUTOPILOT_TEST_ALLOW_PLAN_REVIEW_SEAMS !== '1') {
      throw new CliError(
        `${responseEnv} requires explicit test-seam opt-in`,
        4,
      );
    }
    return {
      raw: fs.readFileSync(
        canonicalReadableFile(seam, responseEnv),
        'utf8',
      ),
      transport: {
        status: 'test-seam',
        runner: opts.runner,
        model: opts.model,
      },
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-plan-review-'), {
    encoding: 'utf8',
  });
  fs.chmodSync(tempDir, 0o700);
  const promptPath = path.join(tempDir, 'prompt.txt');
  fs.writeFileSync(promptPath, prompt, { mode: 0o600 });
  try {
    const args = [
      '--runner', opts.runner,
      '--model', opts.model,
      '--prompt-file', promptPath,
      '--effort', opts.effort,
      '--timeout', `${opts.timeoutSeconds}s`,
    ];
    if (opts.endpoint) args.push('--endpoint', opts.endpoint);
    const run = spawnSync(DISPATCH_AUTHOR, args, {
      cwd: tempDir,
      env: {
        ...process.env,
        DISPATCH_QUIET: '1',
        DISPATCH_DETACH: '0',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    let envelope;
    try {
      envelope = JSON.parse(run.stdout.trim());
    } catch (error) {
      throw new CliError(
        `plan reviewer transport returned an invalid envelope (exit ${run.status})`,
        4,
      );
    }
    if (run.status !== 0 || envelope.status !== 'authored' || !envelope.raw_log) {
      throw new CliError(
        `plan reviewer transport failed: ${envelope.error || envelope.status || `exit ${run.status}`}`,
        4,
      );
    }
    if (envelope.runner !== opts.runner || envelope.model !== opts.model) {
      throw new CliError(
        `plan reviewer transport identity mismatch: requested ${opts.runner}/${opts.model}, got ${envelope.runner}/${envelope.model}`,
        4,
      );
    }
    return {
      raw: fs.readFileSync(envelope.raw_log, 'utf8'),
      transport: {
        status: envelope.status,
        runner: envelope.runner,
        model: envelope.model,
        raw_log: envelope.raw_log,
      },
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function validateReviewerResponse(raw, rubricIds) {
  const normalized = normalizeRawModelOutput(raw);
  let response;
  try {
    response = JSON.parse(normalized);
  } catch (error) {
    throw new CliError('plan reviewer response must be one strict JSON object', 4);
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new CliError('plan reviewer response must be a JSON object', 4);
  }
  const unknownTopKeys = Object.keys(response).filter(
    (key) => !['verdict', 'findings'].includes(key),
  );
  if (unknownTopKeys.length) {
    throw new CliError(
      `plan reviewer response has unsupported field(s): ${unknownTopKeys.join(', ')}`,
      4,
    );
  }
  if (!['READY', 'CONDITIONAL', 'STOP'].includes(response.verdict)) {
    throw new CliError('plan reviewer verdict must be READY|CONDITIONAL|STOP', 4);
  }
  if (!Array.isArray(response.findings)) {
    throw new CliError('plan reviewer findings must be an array', 4);
  }

  const findings = [];
  const scopeExpansions = [];
  for (let index = 0; index < response.findings.length; index += 1) {
    const rawFinding = response.findings[index];
    if (!rawFinding || typeof rawFinding !== 'object' || Array.isArray(rawFinding)) {
      throw new CliError(`finding ${index + 1} must be an object`, 4);
    }
    const allowedFindingKeys = new Set([
      'rubric_id',
      'class',
      'severity',
      'evidence',
      'repair',
      'blocks_next_slice_or_immediate_integrity',
      'cannot_defer_to_spike',
    ]);
    const unknownFindingKeys = Object.keys(rawFinding).filter(
      (key) => !allowedFindingKeys.has(key),
    );
    if (unknownFindingKeys.length) {
      throw new CliError(
        `finding ${index + 1} has unsupported field(s): ${unknownFindingKeys.join(', ')}`,
        4,
      );
    }
    for (const key of ['severity', 'evidence', 'repair']) {
      if (typeof rawFinding[key] !== 'string' || rawFinding[key].trim() === '') {
        throw new CliError(`finding ${index + 1} has invalid ${key}`, 4);
      }
    }
    if (!SEVERITIES.has(rawFinding.severity)) {
      throw new CliError(`finding ${index + 1} severity must be blocking|non-blocking`, 4);
    }

    const validRubric = typeof rawFinding.rubric_id === 'string'
      && rubricIds.has(rawFinding.rubric_id);
    const validClass = typeof rawFinding.class === 'string'
      && CLASSES.has(rawFinding.class);
    const scopeExpansionReasons = [];
    if (!validRubric) scopeExpansionReasons.push('missing_or_unfrozen_rubric_id');
    if (!validClass) scopeExpansionReasons.push('missing_or_invalid_class');

    const admittedBlocker = scopeExpansionReasons.length === 0
      && rawFinding.severity === 'blocking'
      && rawFinding.class === 'decision-now'
      && rawFinding.blocks_next_slice_or_immediate_integrity === true
      && rawFinding.cannot_defer_to_spike === true;
    const finding = {
      rubric_id: typeof rawFinding.rubric_id === 'string' ? rawFinding.rubric_id : null,
      class: typeof rawFinding.class === 'string' ? rawFinding.class : null,
      severity: rawFinding.severity,
      evidence: rawFinding.evidence,
      repair: rawFinding.repair,
      blocks_next_slice_or_immediate_integrity:
        rawFinding.blocks_next_slice_or_immediate_integrity === true,
      cannot_defer_to_spike: rawFinding.cannot_defer_to_spike === true,
      admission: scopeExpansionReasons.length
        ? 'scope-expansion'
        : admittedBlocker
          ? 'blocking'
          : 'non-blocking',
      admitted_blocker: admittedBlocker,
    };
    if (scopeExpansionReasons.length) {
      finding.admission_reasons = scopeExpansionReasons;
      scopeExpansions.push(index);
    }
    findings.push(finding);
  }
  return {
    reviewerVerdict: response.verdict,
    findings,
    scopeExpansions,
  };
}

function artifactPath(sessionDir, generation) {
  return path.join(sessionDir, `generation-${String(generation).padStart(2, '0')}.json`);
}

function terminalPolicyArtifact(base, reason, details = {}) {
  return {
    ...base,
    verdict: 'STOP',
    terminal: true,
    policy_reason: reason,
    findings: [],
    ...details,
  };
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`dispatch-plan-review: ${error.message}\n${usage()}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }

  const repoIdentity = canonicalRepoIdentity(opts.repoRoot);
  const sessionKey = sha256(`${repoIdentity}\0${opts.ticket}`);
  const sessionDir = path.join(opts.stateDir, sessionKey);
  const statePath = path.join(sessionDir, 'state.json');
  const sealPath = path.join(sessionDir, 'rubric-seal.json');
  const planBytes = fs.readFileSync(opts.planFile);
  const rubricBytes = fs.readFileSync(opts.rubricFile);
  if (planBytes.length === 0) throw new CliError('plan file must not be empty');
  if (rubricBytes.length === 0) throw new CliError('rubric file must not be empty');
  const rubricIds = extractRubricIds(rubricBytes);
  const planSha = sha256(planBytes);
  const rubricSha = sha256(rubricBytes);
  const now = nowDate(opts);
  const claimId = crypto.randomUUID();
  let state;
  let growthRatio;
  let growthWarning;
  let earlyArtifact = null;
  let earlyExitCode = null;

  try {
    withLock(sessionDir, () => {
      if (!fs.existsSync(statePath)) {
        if (opts.generation !== 1) {
          throw new CliError('new plan-review session must acquire generation 1', 3);
        }
        const sealedSha = freezeRubric('seal', opts.rubricFile, sealPath);
        if (sealedSha !== rubricSha) {
          throw new CliError('rubric seal hash mismatch', 3);
        }
        state = {
          version: 1,
          session_key: sessionKey,
          repo_identity: repoIdentity,
          ticket: opts.ticket,
          rubric_sha256: rubricSha,
          baseline_plan_sha256: planSha,
          baseline_plan_bytes: planBytes.length,
          started_at: now.toISOString(),
          deadline_at: new Date(now.getTime() + opts.maxWallSeconds * 1000).toISOString(),
          max_generations: opts.maxGenerations,
          max_wall_seconds: opts.maxWallSeconds,
          growth_warn_ratio: opts.growthWarnRatio,
          growth_stop_ratio: opts.growthStopRatio,
          next_generation: 1,
          active_claim: null,
          terminal: false,
          terminal_verdict: null,
          claims: [],
          artifacts: [],
        };
        atomicWriteJson(statePath, state);
      } else {
        state = loadState(statePath);
      }

      if (state.repo_identity !== repoIdentity || state.ticket !== opts.ticket) {
        throw new CliError('durable plan-review state identity mismatch', 3);
      }
      if (
        state.max_generations !== opts.maxGenerations
        || state.max_wall_seconds !== opts.maxWallSeconds
        || state.growth_warn_ratio !== opts.growthWarnRatio
        || state.growth_stop_ratio !== opts.growthStopRatio
      ) {
        throw new CliError('plan-review budget differs from the frozen session budget', 3);
      }
      if (state.terminal) {
        throw new CliError(
          `plan-review session already terminal: ${state.terminal_verdict || 'STOP'}`,
          3,
        );
      }
      if (state.active_claim) {
        throw new CliError(
          `plan-review generation ${state.active_claim.generation} is already claimed`,
          3,
        );
      }
      if (opts.generation > state.max_generations) {
        throw new CliError(
          `generation ${opts.generation} exceeds frozen cap ${state.max_generations}`,
          3,
        );
      }
      if (opts.generation !== state.next_generation) {
        throw new CliError(
          `generation ${opts.generation} cannot acquire; next generation is ${state.next_generation}`,
          3,
        );
      }
      if (now.getTime() > Date.parse(state.deadline_at)) {
        const artifact = terminalPolicyArtifact({
          ticket: opts.ticket,
          session_id: opts.sessionId,
          session_key: sessionKey,
          generation: opts.generation,
          rubric_sha256: state.rubric_sha256,
          plan_sha256: planSha,
          plan_bytes: planBytes.length,
        }, 'wall_clock_expired');
        const outPath = path.join(sessionDir, 'terminal-wall-clock.json');
        atomicWriteJson(outPath, artifact);
        state.terminal = true;
        state.terminal_verdict = 'STOP';
        state.terminal_reason = 'wall_clock_expired';
        state.artifacts.push(outPath);
        atomicWriteJson(statePath, state);
        earlyArtifact = artifact;
        earlyExitCode = 3;
        return;
      }

      const checkedSha = freezeRubric('check', opts.rubricFile, sealPath);
      if (checkedSha !== state.rubric_sha256) {
        throw new CliError('frozen rubric hash differs from session state', 3);
      }
      growthRatio = planBytes.length / state.baseline_plan_bytes;
      growthWarning = growthRatio >= state.growth_warn_ratio;
      if (growthRatio > state.growth_stop_ratio) {
        const artifact = terminalPolicyArtifact({
          ticket: opts.ticket,
          session_id: opts.sessionId,
          session_key: sessionKey,
          generation: opts.generation,
          rubric_sha256: state.rubric_sha256,
          plan_sha256: planSha,
          plan_bytes: planBytes.length,
          baseline_plan_bytes: state.baseline_plan_bytes,
          growth_ratio: growthRatio,
          growth_warning: true,
        }, 'plan_growth_hard_stop');
        const outPath = path.join(sessionDir, 'terminal-plan-growth.json');
        atomicWriteJson(outPath, artifact);
        state.terminal = true;
        state.terminal_verdict = 'STOP';
        state.terminal_reason = 'plan_growth_hard_stop';
        state.artifacts.push(outPath);
        atomicWriteJson(statePath, state);
        earlyArtifact = artifact;
        earlyExitCode = 3;
        return;
      }

      const claim = {
        claim_id: claimId,
        generation: opts.generation,
        session_id: opts.sessionId,
        runner: opts.runner,
        model: opts.model,
        effort: opts.effort,
        reviewers: opts.reviewers,
        claimed_at: now.toISOString(),
        plan_sha256: planSha,
        plan_bytes: planBytes.length,
      };
      state.active_claim = claim;
      state.claims.push({ ...claim, status: 'in-flight' });
      atomicWriteJson(statePath, state);
    });
  } catch (error) {
    if (error instanceof CliError) {
      emitAndExit({
        ticket: opts.ticket,
        session_id: opts.sessionId,
        session_key: sessionKey,
        generation: opts.generation,
        verdict: 'STOP',
        terminal: true,
        policy_reason: error.message,
      }, error.exitCode);
    }
    throw error;
  }

  if (earlyArtifact) {
    emitAndExit(earlyArtifact, earlyExitCode);
  }

  let dispatches;
  let reviewed;
  try {
    dispatches = [];
    const reviewedSeats = [];
    for (let index = 0; index < opts.reviewers.length; index += 1) {
      const reviewer = opts.reviewers[index];
      const dispatchNow = opts.now === undefined ? Date.now() : now.getTime();
      const remainingSeconds = Math.floor((Date.parse(state.deadline_at) - dispatchNow) / 1000);
      if (remainingSeconds < 1) {
        throw new CliError('plan-review wall clock expired before reviewer dispatch', 3);
      }
      const boundedReviewer = {
        ...reviewer,
        timeoutSeconds: Math.min(reviewer.timeoutSeconds, remainingSeconds),
      };
      const prompt = buildPrompt(boundedReviewer, planBytes, rubricBytes, rubricIds);
      const responseEnv = index === 0
        ? 'AUTOPILOT_PLAN_REVIEW_RESPONSE_FILE'
        : 'AUTOPILOT_PLAN_REVIEW_DEEP_RESPONSE_FILE';
      const dispatch = dispatchReviewer(boundedReviewer, prompt, responseEnv);
      const seatReview = validateReviewerResponse(dispatch.raw, rubricIds);
      dispatches.push({ seat: reviewer.seat, ...dispatch.transport });
      reviewedSeats.push({
        seat: reviewer.seat,
        verdict: seatReview.reviewerVerdict,
        findings: seatReview.findings.map((finding) => ({
          ...finding,
          reviewer_seat: reviewer.seat,
        })),
        scopeExpansions: seatReview.scopeExpansions,
      });
    }
    reviewed = {
      reviewerVerdict: reviewedSeats[0].verdict,
      reviewerVerdicts: reviewedSeats.map(({ seat, verdict }) => ({ seat, verdict })),
      findings: reviewedSeats.flatMap((seat) => seat.findings),
      scopeExpansions: reviewedSeats.flatMap((seat) => seat.scopeExpansions),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof CliError ? error.exitCode : 4;
    let artifact;
    withLock(sessionDir, () => {
      state = loadState(statePath);
      artifact = terminalPolicyArtifact({
        ticket: opts.ticket,
        session_id: opts.sessionId,
        session_key: sessionKey,
        generation: opts.generation,
        rubric_sha256: state.rubric_sha256,
        plan_sha256: planSha,
        plan_bytes: planBytes.length,
        baseline_plan_bytes: state.baseline_plan_bytes,
        growth_ratio: growthRatio,
        growth_warning: growthWarning,
        runner: opts.runner,
        model: opts.model,
        reviewers: opts.reviewers,
      }, code === 4 ? 'reviewer_transport_or_response_failure' : 'review_policy_failure', {
        error: message,
      });
      const outPath = artifactPath(sessionDir, opts.generation);
      atomicWriteJson(outPath, artifact);
      state.active_claim = null;
      state.terminal = true;
      state.terminal_verdict = 'STOP';
      state.terminal_reason = artifact.policy_reason;
      state.artifacts.push(outPath);
      const claim = state.claims.find((item) => item.claim_id === claimId);
      if (claim) claim.status = 'failed';
      atomicWriteJson(statePath, state);
    });
    emitAndExit(artifact, code);
  }

  const admittedBlockers = reviewed.findings.filter((finding) => finding.admitted_blocker);
  let verdict;
  let terminal;
  let policyReason;
  if (reviewed.scopeExpansions.length > 0) {
    verdict = 'STOP';
    terminal = true;
    policyReason = 'scope_expansion_requires_human_adjudication';
  } else if (admittedBlockers.length > 0 && opts.generation >= state.max_generations) {
    verdict = 'STOP';
    terminal = true;
    policyReason = 'generation_cap_with_open_blockers';
  } else if (admittedBlockers.length > 0) {
    verdict = 'CONDITIONAL';
    terminal = false;
    policyReason = 'admitted_blockers_allow_one_bounded_repair_generation';
  } else if (reviewed.reviewerVerdicts.every((seat) => seat.verdict === 'READY')) {
    verdict = 'READY';
    terminal = true;
    policyReason = 'no_admitted_blockers';
  } else {
    verdict = 'CONDITIONAL';
    terminal = true;
    policyReason = 'reviewer_claim_has_no_admitted_blocker';
  }

  const artifact = {
    ticket: opts.ticket,
    session_id: opts.sessionId,
    session_key: sessionKey,
    generation: opts.generation,
    verdict,
    reviewer_verdict: reviewed.reviewerVerdict,
    terminal,
    policy_reason: policyReason,
    rubric_sha256: state.rubric_sha256,
    plan_sha256: planSha,
    plan_bytes: planBytes.length,
    baseline_plan_bytes: state.baseline_plan_bytes,
    growth_ratio: growthRatio,
    growth_warning: growthWarning,
    runner: dispatches[0].runner,
    model: dispatches[0].model,
    transport_status: dispatches[0].status,
    reviewers: dispatches,
    reviewer_verdicts: reviewed.reviewerVerdicts,
    findings: reviewed.findings,
    scope_expansion_count: reviewed.scopeExpansions.length,
    admitted_blocker_count: admittedBlockers.length,
    next_generation: terminal ? null : opts.generation + 1,
    reviewed_at: now.toISOString(),
  };

  withLock(sessionDir, () => {
    state = loadState(statePath);
    if (!state.active_claim || state.active_claim.claim_id !== claimId) {
      throw new CliError('active plan-review claim changed before completion', 3);
    }
    const outPath = artifactPath(sessionDir, opts.generation);
    atomicWriteJson(outPath, artifact);
    state.active_claim = null;
    state.artifacts.push(outPath);
    const claim = state.claims.find((item) => item.claim_id === claimId);
    if (claim) {
      claim.status = 'complete';
      claim.verdict = verdict;
      claim.artifact = outPath;
    }
    if (terminal) {
      state.terminal = true;
      state.terminal_verdict = verdict;
      state.terminal_reason = policyReason;
    } else {
      state.next_generation = opts.generation + 1;
    }
    atomicWriteJson(statePath, state);
  });

  emitAndExit(artifact, verdict === 'STOP' ? 3 : 0);
}

try {
  main();
} catch (error) {
  if (error instanceof CliError) {
    process.stderr.write(`dispatch-plan-review: ${error.message}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write(`dispatch-plan-review: ${error.stack || error.message || String(error)}\n`);
  process.exit(2);
}
