'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { isImmutableGitSha } = require('../lib/common');

const { resolveReviewLoopJson } = require('./resolve-review-loop');
const { dispatchReviewJson } = require('../runners/review');
const { dispatchImplementJson } = require('../runners/implementer');

const RUN_LEDGER_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'run-ledger.sh');
const MISPLACEMENT_PATH_PATTERNS = [
  /(^|[\/])\.gemini([\/]|$)/,
  /(^|[\/])\.gemini-[^/\\]+([\/]|$)/,
  /(^|[\/])\.cache[\/](?:.+[\/])?gemini([\/]|$)/,
  /(^|[\/])gemini[\-]scratch([\/]|$)/,
];

function parseJsonFromLastLine(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    // fall through to last-line parse for command outputs that include debug
    // lines before the JSON payload.
  }

  const lines = String(raw).split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch (_error) {
    return null;
  }
}

function runLedgerCommand(scriptPath, args) {
  let child;
  try {
    child = spawnSync('bash', [scriptPath, ...args], {
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_error) {
    return null;
  }
  return {
    result: parseJsonFromLastLine(child.stdout),
    status: child.status,
    error: child.error || null,
    signal: child.signal || null,
  };
}

function isPathLikelyMisplaced(rawPath, cwd) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return false;
  }
  if (!path.isAbsolute(rawPath)) {
    return false;
  }
  const normalized = path.resolve(rawPath);
  const normalizedCwd = cwd && path.resolve(cwd);
  if (normalizedCwd && (normalized === normalizedCwd || normalized.startsWith(`${normalizedCwd}${path.sep}`))) {
    return false;
  }
  const lower = normalized.toLowerCase();
  return MISPLACEMENT_PATH_PATTERNS.some((pattern) => pattern.test(lower));
}

function collectMisplacementEvidence(result, cwd) {
  const evidence = [];
  if (!result || typeof result !== 'object') {
    return evidence;
  }
  const fields = [
    ['worktree', result.worktree],
    ['agent_log', result.agent_log],
    ['error', result.error],
  ];
  for (const [field, value] of fields) {
    if (isPathLikelyMisplaced(value, cwd)) {
      evidence.push(`${field}:${value}`);
    }
  }
  return evidence;
}

function hasNoOpOrCommittedEmptyWrite(result) {
  if (!result || typeof result !== 'object') {
    return false;
  }
  if (result.status === 'no_op') {
    return true;
  }
  if (result.status !== 'committed') {
    return false;
  }
  if (!Number.isInteger(result.files_changed)
    || !Number.isInteger(result.insertions)
    || !Number.isInteger(result.deletions)) {
    return false;
  }
  return result.files_changed === 0 && result.insertions === 0 && result.deletions === 0;
}

function resolveImplementationFromLedger({
  implementationOptions,
  ledger,
  runId,
  stage,
  resultJson,
  gitDir,
  branch,
  base,
  cwd,
}) {
  const ledgerPath = ledger && typeof ledger === 'string' ? ledger : null;
  const resolvedRunId = runId && typeof runId === 'string' ? runId : null;
  const resolvedStage = stage && typeof stage === 'string' ? stage : 'implement';
  const resolvedResultJson = (typeof resultJson === 'string' && resultJson.length > 0)
    ? resultJson
    : path.join(gitDir || cwd || process.cwd(), '.autopilot', 'implementer-result.json');
  const resolvedGitDir = typeof gitDir === 'string' && gitDir.length > 0 ? gitDir : (cwd || process.cwd());

  if (!ledgerPath || !resolvedRunId) {
    return null;
  }

  const reconcile = runLedgerCommand(RUN_LEDGER_SCRIPT, [
    'stage-reconcile',
    '--ledger',
    ledgerPath,
    '--run-id',
    resolvedRunId,
    '--stage',
    resolvedStage,
    '--result-json',
    resolvedResultJson,
    '--git-dir',
    resolvedGitDir,
  ]);
  if (!reconcile || reconcile.error || reconcile.status !== 0 || !reconcile.result) {
    return null;
  }
  const reconcilePayload = reconcile.result;
  if (reconcilePayload.status !== 'resolved' || (reconcilePayload.reason !== 'terminal_state' && reconcilePayload.reason !== 'git_truth')) {
    return null;
  }

  const latest = runLedgerCommand(RUN_LEDGER_SCRIPT, [
    'query-latest',
    '--ledger',
    ledgerPath,
    '--run-id',
    resolvedRunId,
    '--stage',
    resolvedStage,
  ]);
  if (!latest || latest.error || latest.status !== 0 || !latest.result) {
    return null;
  }
  const latestRecord = latest.result;
  const commit = latestRecord.git_sha;
  if (typeof commit !== 'string' || !isImmutableGitSha(commit)) {
    return null;
  }

  return {
    status: 'committed',
    runner: 'run-ledger',
    model: 'run-ledger',
    branch,
    base,
    commit,
    files_changed: 0,
    insertions: 0,
    deletions: 0,
    worktree: latestRecord.worktree || null,
    agent_log: null,
    error: null,
    containment: 'plain',
    contained: true,
    reconcile_by_ledger: true,
    reconcile_status: reconcilePayload.status,
    reconcile_reason: reconcilePayload.reason,
    reconcile_stage: resolvedStage,
    reconcile_run_id: resolvedRunId,
    _reconciled_by_ledger: true,
    _reconciled_run_id: resolvedRunId,
    _reconciled_stage: resolvedStage,
    _reconciled_status: reconcilePayload.status,
    _reconciled_reason: reconcilePayload.reason,
  };
}

function defaultNow() {
  return new Date().toISOString();
}

function normalizeTimestamp(value) {
  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) return value.toISOString();
    return defaultNow();
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    try {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    } catch (_error) {
      return defaultNow();
    }
  }
  return defaultNow();
}

function createClock(clock) {
  if (clock && typeof clock.now === 'function') {
    return () => normalizeTimestamp(clock.now());
  }
  if (typeof clock === 'function') {
    return () => normalizeTimestamp(clock());
  }
  return defaultNow;
}

function reviewLoopResultBlocked(result) {
  if (!result) return 'missing review-loop result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `review-loop terminated by signal ${result.signal}`;
  if (result.status !== 0) return `review-loop exited with status ${result.status}`;
  if (result.parseError) return result.parseError.message || String(result.parseError);
  if (!result.result) return 'review-loop produced no parsed result';
  return null;
}

function reviewResultBlocked(result) {
  if (!result) return 'missing review dispatch result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `review dispatch terminated by signal ${result.signal}`;
  if (result.status !== 0) return `review dispatch exited with status ${result.status}`;
  if (result.parseError) return result.parseError.message || String(result.parseError);
  if (!result.result) return 'review dispatch produced no parsed result';
  if (typeof result.result.status !== 'string') return 'review dispatch result missing status';
  if (result.result.status !== 'reviewed') return `review dispatch result status ${result.result.status}`;
  return null;
}

function implementationResultBlocked(result) {
  if (!result) return 'missing implementation dispatch result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `implementation dispatch terminated by signal ${result.signal}`;
  if (result.status === null || result.status === undefined) {
    return `implementation dispatch exited with status ${result.status}`;
  }
  if (result.parseError) return result.parseError.message || String(result.parseError);
  if (!result.result) return 'implementation dispatch produced no parsed result';
  if (result.result.status === 'committed' && !isImmutableGitSha(result.result.commit)) {
    return 'implementation result commit must be a full immutable git SHA';
  }
  if (result.status !== 0 && result.result.status === 'committed') {
    return `implementation dispatch exited with status ${result.status}`;
  }
  return null;
}

function validateReviewRoster(roster) {
  if (!roster || typeof roster !== 'object') {
    throw new TypeError('review roster is required');
  }
  for (const field of ['reviewer_runner', 'reviewer_engine', 'reviewer_effort']) {
    if (typeof roster[field] !== 'string' || roster[field].length === 0) {
      throw new TypeError(`review roster field ${field} is required`);
    }
  }
  return roster;
}

function validateImplementerRoster(roster) {
  if (!roster || typeof roster !== 'object') {
    throw new TypeError('implementer roster is required');
  }
  for (const field of ['implementer_runner', 'implementer_engine', 'implementer_effort']) {
    if (typeof roster[field] !== 'string' || roster[field].length === 0) {
      throw new TypeError(`implementer roster field ${field} is required`);
    }
  }
  return roster;
}

function validateExtraArgs(extraArgs, reservedSet, label) {
  if (!Array.isArray(extraArgs)) {
    throw new TypeError(`${label} must be an array`);
  }
  for (const arg of extraArgs) {
    if (typeof arg !== 'string') {
      throw new TypeError(`${label} must contain only strings`);
    }
    const key = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (reservedSet.has(key)) {
      throw new TypeError(`extra args cannot override ${key}`);
    }
  }
}

function validateInteger(value, field, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new TypeError(`${field} must be an integer >= ${minimum}`);
  }
}

function buildReviewArgs({ roster, diffFile, specFile, extraReviewArgs = [] }) {
  validateReviewRoster(roster);
  if (!diffFile || typeof diffFile !== 'string') {
    throw new TypeError('diffFile is required');
  }
  validateExtraArgs(extraReviewArgs, new Set(['--runner', '--model', '--diff-file', '--effort', '--spec-file']), 'extraReviewArgs');
  if (extraReviewArgs.some(arg => arg === '--spec-file' || arg.startsWith('--spec-file='))) {
    throw new TypeError('extra args cannot override --spec-file');
  }

  const args = [
    '--runner',
    roster.reviewer_runner,
    '--model',
    roster.reviewer_engine,
    '--diff-file',
    diffFile,
    '--effort',
    roster.reviewer_effort,
  ];
  if (specFile && typeof specFile === 'string') {
    args.push('--spec-file', specFile);
  }
  args.push(...extraReviewArgs);
  return args;
}

function validateExtraReviewArgs(extraReviewArgs) {
  validateExtraArgs(extraReviewArgs, new Set(['--runner', '--model', '--diff-file', '--effort', '--spec-file']), 'extraReviewArgs');
  if (extraReviewArgs.some(arg => arg === '--spec-file' || arg.startsWith('--spec-file='))) {
    throw new TypeError('extra args cannot override --spec-file');
  }
}

function buildImplementationArgs({
  roster,
  promptFile,
  branch,
  base,
  cwd,
  extraImplementationArgs = [],
}) {
  validateImplementerRoster(roster);
  if (!promptFile || typeof promptFile !== 'string') {
    throw new TypeError('promptFile is required');
  }
  if (!branch || typeof branch !== 'string') {
    throw new TypeError('branch is required');
  }
  if (!base || typeof base !== 'string') {
    throw new TypeError('base is required');
  }
  validateExtraArgs(extraImplementationArgs, new Set([
    '--runner',
    '--model',
    '--prompt-file',
    '--branch',
    '--base',
    '--effort',
  ]), 'extraImplementationArgs');

  return [
    '--runner',
    roster.implementer_runner,
    '--model',
    roster.implementer_engine,
    '--prompt-file',
    path.resolve(cwd || process.cwd(), promptFile),
    '--branch',
    branch,
    '--base',
    base,
    '--effort',
    roster.implementer_effort,
    ...extraImplementationArgs,
  ];
}

function buildRepairBranchName({ branch, round, previousCommit }) {
  const short = previousCommit ? previousCommit.slice(0, 7) : 'base';
  return `${branch}-repair-r${round}-${short}`;
}

function tempNameSegment(value) {
  return String(value || 'branch').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'branch';
}


function defaultDiffProvider({ base, commit, branch, round, cwd }) {
  const diffDir = fs.mkdtempSync(path.join(os.tmpdir(), `autopilot-review-loop-${tempNameSegment(branch)}-${round || 0}-`));
  const file = path.join(diffDir, 'range.diff');
  const outFd = fs.openSync(file, 'w');
  let child;
  try {
    child = spawnSync('git', ['diff', '--no-ext-diff', '--no-textconv', `${base}..${commit}`], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', outFd, 'pipe'],
    });
  } finally {
    fs.closeSync(outFd);
  }
  if (child.error) {
    throw child.error;
  }
  if (child.status !== 0) {
    const stderr = child.stderr ? `: ${String(child.stderr).trim()}` : '';
    throw new Error(`git diff failed with status ${child.status}${stderr}`);
  }
  return file;
}

function defaultVerifyCommandRunner({ verifyCmd, cwd }) {
  const child = spawnSync(verifyCmd, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    error: child.error || null,
    status: child.status,
    signal: child.signal || null,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
  };
}

function defaultGitResetHard({ commit, cwd }) {
  const child = spawnSync('git', ['reset', '--hard', commit], {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    error: child.error || null,
    status: child.status,
    signal: child.signal || null,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
  };
}

function verifyResultBlocked(result) {
  if (!result) return 'missing verify command result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `verify command terminated by signal ${result.signal}`;
  return null;
}

function resetResultBlocked(result) {
  if (!result) return 'missing ratchet reset result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `ratchet reset terminated by signal ${result.signal}`;
  if (result.status !== 0) return `ratchet reset exited with status ${result.status}`;
  return null;
}

function collectFindings(review) {
  let findings = null;
  if (review && review.review && Object.prototype.hasOwnProperty.call(review.review, 'findings')) {
    findings = review.review.findings;
  } else if (review && Object.prototype.hasOwnProperty.call(review, 'findings')) {
    findings = review.findings;
  }
  if (Array.isArray(findings)) return findings;
  if (typeof findings === 'string' && findings.length > 0) return [findings];
  return [];
}

function verificationRank(verifyPass) {
  return verifyPass === true ? 1 : 0;
}

function resultWithVerificationFields(result, state) {
  let output = result;
  if (state && state.verifyCmdProvided) {
    output = {
      ...output,
      verify_cmd_provided: true,
      convergence_reason: state.convergenceReason || null,
      ratchet_reverted_rounds: state.ratchetRevertedRounds,
      advisory_findings: state.advisoryFindings,
      commit: state.bestCommit || (result.implementation && result.implementation.implementation
        ? result.implementation.implementation.commit
        : null),
    };
  }
  if (state && state.verifyFirstSignalUnused) {
    output = {
      ...output,
      verify_first_signal_unused: true,
    };
  }
  return output;
}

function defaultRepairPromptWriter({
  promptFile,
  round,
  base,
  previousCommit,
  commit,
  review,
}) {
  const original = fs.readFileSync(promptFile, 'utf8');
  const findings = review && review.review && typeof review.review.findings === 'string'
    ? review.review.findings
    : '';
  const repairPrompt = [
    '---',
    'Repair iteration requested by /l5/l6 implementation loop.',
    `round: ${round}`,
    `base: ${base}`,
    `previous_commit: ${previousCommit}`,
    `failed_commit: ${commit}`,
    `previous_verdict: ${review && review.verdict}`,
    '---',
    '',
    'Reviewer findings:',
    findings || '(no findings text provided)',
    '',
    original,
  ].join('\n');

  const repairDir = fs.mkdtempSync(path.join(os.tmpdir(), `autopilot-repair-prompt-${round || 0}-`));
  const repairFile = path.join(repairDir, 'prompt.txt');
  fs.writeFileSync(repairFile, repairPrompt, 'utf8');
  return repairFile;
}

class AutopilotEngine {
  constructor(options = {}) {
    this.reviewLoopResolver = options.reviewLoopResolver || resolveReviewLoopJson;
    this.reviewDispatcher = options.reviewDispatcher || dispatchReviewJson;
    this.implementationDispatcher = options.implementationDispatcher || dispatchImplementJson;
    this.diffProvider = options.diffProvider || defaultDiffProvider;
    this.repairPromptWriter = options.repairPromptWriter || defaultRepairPromptWriter;
    this.verifyCommandRunner = options.verifyCommandRunner || defaultVerifyCommandRunner;
    this.gitResetHard = options.gitResetHard || defaultGitResetHard;
    this.cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    this.now = createClock(options.clock);
  }

  ledgerEntry(unit, status, startedAt, detail = {}) {
    return {
      unit,
      status,
      started_at: startedAt,
      ended_at: this.now(),
      ...detail,
    };
  }

  resolveRoster(input = {}) {
    const args = Object.prototype.hasOwnProperty.call(input, 'args')
      ? input.args
      : ['--check-scorecard'];
    const options = input.options || {};
    const startedAt = this.now();
    if (!Array.isArray(args)) {
      const error = new TypeError('resolveRoster args must be an array');
      return {
        status: 'blocked',
        reason: error.message,
        result: {
          error,
          status: null,
          signal: null,
          stdout: '',
          stderr: '',
          result: null,
          parseError: null,
        },
        roster: null,
        ledger: [
          this.ledgerEntry('resolve_roster', 'blocked', startedAt, {
            exit_status: null,
          }),
        ],
      };
    }
    let result;
    try {
      result = this.reviewLoopResolver(args, options);
    } catch (error) {
      result = {
        error,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        result: null,
        parseError: null,
      };
    }
    const blockedReason = reviewLoopResultBlocked(result);
    let roster = result && result.result ? result.result : null;
    let reason = blockedReason;
    if (!reason) {
      try {
        validateReviewRoster(roster);
      } catch (error) {
        reason = error.message || String(error);
        roster = null;
      }
    }
    return {
      status: reason ? 'blocked' : 'resolved',
      reason,
      result,
      roster,
      ledger: [
        this.ledgerEntry('resolve_roster', reason ? 'blocked' : 'resolved', startedAt, {
          exit_status: result ? result.status : null,
        }),
      ],
    };
  }

  reviewDiff(input = {}) {
    const ledger = [];
    const requireQualifiedReviewer = input.requireQualifiedReviewer === true;
    let roster = input.roster || null;
    let resolveResult = null;
    let reviewArgs = null;

    if (!input.diffFile || typeof input.diffFile !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: 'diffFile is required',
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    if (!roster) {
      const rosterArgs = Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
        ? input.rosterArgs
        : ['--check-scorecard'];
      const resolved = this.resolveRoster({
        args: rosterArgs,
        options: input.resolverOptions || {},
      });
      ledger.push(...resolved.ledger);
      resolveResult = resolved.result;
      roster = resolved.roster;

      if (resolved.status === 'blocked') {
        return {
          status: 'blocked',
          phase: 'resolve_roster',
          reason: resolved.reason,
          verdict: null,
          roster: null,
          resolveResult,
          reviewResult: null,
          review: null,
          reviewArgs,
          ledger,
        };
      }
    }

    try {
      validateReviewRoster(roster);
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: error.message || String(error),
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    if (requireQualifiedReviewer && roster.reviewer_qualified !== true) {
      const startedAt = this.now();
      ledger.push(
        this.ledgerEntry('reviewer_qualification', 'blocked', startedAt, {
          reviewer_qualified: roster.reviewer_qualified === true,
        }),
      );
      return {
        status: 'blocked',
        phase: 'reviewer_qualification',
        reason: 'reviewer is not qualified or qualification is unknown',
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    try {
      reviewArgs = buildReviewArgs({
        roster,
        diffFile: input.diffFile,
        specFile: input.specFile,
        extraReviewArgs: Object.prototype.hasOwnProperty.call(input, 'extraReviewArgs')
          ? input.extraReviewArgs
          : [],
      });
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: error.message || String(error),
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }
    const startedAt = this.now();
    let reviewResult;
    try {
      reviewResult = this.reviewDispatcher(reviewArgs, input.reviewOptions || {});
    } catch (error) {
      reviewResult = {
        error,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        result: null,
        parseError: null,
      };
    }
    const blockedReason = reviewResultBlocked(reviewResult);
    const parsed = reviewResult && reviewResult.result ? reviewResult.result : null;
    ledger.push(
      this.ledgerEntry('dispatch_review', blockedReason ? 'blocked' : reviewResult.result.status, startedAt, {
        runner: roster.reviewer_runner,
        model: roster.reviewer_engine,
        exit_status: reviewResult ? reviewResult.status : null,
      }),
    );

    if (blockedReason) {
      return {
        status: 'blocked',
        phase: 'dispatch_review',
        reason: blockedReason,
        verdict: null,
        roster,
        resolveResult,
        reviewResult,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    return {
      status: reviewResult.result.status,
      verdict: parsed.verdict,
      roster,
      resolveResult,
      reviewResult,
      review: parsed,
      reviewArgs,
      ledger,
    };
  }

  implementTask(input = {}) {
    const ledger = [];
    let roster = input.roster || null;
    let resolveResult = null;
    let implementationArgs = null;

    if (!input.promptFile || typeof input.promptFile !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: 'promptFile is required',
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }

    if (!input.branch || typeof input.branch !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: 'branch is required',
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }

    if (!input.base || typeof input.base !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: 'base is required',
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }

    const implementationOptionsInput = input.implementationOptions || {};
    const taskCwd = input.cwd
      || implementationOptionsInput.cwd
      || this.cwd
      || process.cwd();
    if (typeof taskCwd !== 'string' || taskCwd.length === 0) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: 'cwd must be a non-empty string',
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }
    const resolvedTaskCwd = path.resolve(taskCwd);

    if (!roster) {
      const rosterArgs = Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
        ? input.rosterArgs
        : ['--check-scorecard'];
      const resolverOptions = {
        ...(input.resolverOptions || {}),
        cwd: Object.prototype.hasOwnProperty.call(input.resolverOptions || {}, 'cwd')
          ? input.resolverOptions.cwd
          : resolvedTaskCwd,
      };
      const resolved = this.resolveRoster({
        args: rosterArgs,
        options: resolverOptions,
      });
      ledger.push(...resolved.ledger);
      resolveResult = resolved.result;
      roster = resolved.roster;

      if (resolved.status === 'blocked') {
        return {
          status: 'blocked',
          phase: 'resolve_roster',
          reason: resolved.reason,
          roster: null,
          resolveResult,
          implementationResult: null,
          implementationArgs,
          implementation: null,
          ledger,
        };
      }
    }

    try {
      validateImplementerRoster(roster);
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: error.message || String(error),
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }

    try {
      implementationArgs = buildImplementationArgs({
        roster,
        promptFile: input.promptFile,
        branch: input.branch,
        base: input.base,
        cwd: resolvedTaskCwd,
        extraImplementationArgs: Object.prototype.hasOwnProperty.call(input, 'extraImplementationArgs')
          ? input.extraImplementationArgs
          : [],
      });
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: error.message || String(error),
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }

    const startedAt = this.now();
    let implementationResult;
    const implementationOptions = {
      ...implementationOptionsInput,
      cwd: resolvedTaskCwd,
    };
    try {
      implementationResult = this.implementationDispatcher(
        implementationArgs,
        implementationOptions,
      );
    } catch (error) {
      implementationResult = {
        error,
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        result: null,
        parseError: null,
      };
    }
    let blockedReason = implementationResultBlocked(implementationResult);
    let parsed = implementationResult && implementationResult.result ? implementationResult.result : null;

    let reconciledByLedger = false;
    let reconcileDetails = null;
    if (blockedReason && (!parsed || implementationResult.result === null)) {
      const recovered = resolveImplementationFromLedger({
        implementationOptions,
        ledger: input.ledger,
        runId: input.runId,
        stage: input.implementationStage,
        resultJson: input.resultJson,
        gitDir: input.gitDir,
        branch: input.branch,
        base: input.base,
        cwd: resolvedTaskCwd,
      });
      if (recovered) {
        blockedReason = null;
        parsed = recovered;
        reconciledByLedger = true;
        reconcileDetails = {
          reconcile_status: recovered._reconciled_status,
          reconcile_reason: recovered._reconciled_reason,
          reconcile_stage: recovered._reconciled_stage,
          reconcile_run_id: recovered._reconciled_run_id,
        };
      }
    }

    const misplacedWriteEvidence = (parsed && hasNoOpOrCommittedEmptyWrite(parsed))
      ? collectMisplacementEvidence(parsed, resolvedTaskCwd)
      : [];
    const misplacedWrites = misplacedWriteEvidence.length > 0;
    const dispatchStatus = blockedReason
      ? 'blocked'
      : (misplacedWrites
        ? 'misplaced_writes'
        : (parsed && parsed.status ? parsed.status : null));

    ledger.push(
      this.ledgerEntry('dispatch_implementation', dispatchStatus || 'blocked', startedAt, {
        runner: parsed ? parsed.runner : null,
        model: parsed ? parsed.model : null,
        base: input.base,
        branch: input.branch,
        commit: parsed ? parsed.commit : null,
        exit_status: implementationResult ? implementationResult.status : null,
        reconcile_by_ledger: reconciledByLedger,
        reconcile_status: reconcileDetails ? reconcileDetails.reconcile_status : null,
        reconcile_reason: reconcileDetails ? reconcileDetails.reconcile_reason : null,
        misplaced_write_evidence: misplacedWriteEvidence.join('|') || null,
      }),
    );

    if (misplacedWrites) {
      const misplacedReason = (
        `implementation writes appear outside --cwd `
        + `(${misplacedWriteEvidence.join(', ')}). `
        + 'likely hardcoded absolute path escaping the target worktree.'
      );
      return {
        status: 'blocked',
        phase: 'misplaced_writes',
        reason: misplacedReason,
        roster,
        resolveResult,
        implementationResult,
        implementationArgs,
        implementation: parsed,
        ledger,
      };
    }

    if (blockedReason) {
      return {
        status: 'blocked',
        phase: 'dispatch_implementation',
        reason: blockedReason,
        roster,
        resolveResult,
        implementationResult,
        implementationArgs,
        implementation: parsed,
        ledger,
      };
    }

    if (!parsed || parsed.status !== 'committed') {
      return {
        status: 'blocked',
        phase: 'dispatch_implementation',
        reason: `implementation status ${parsed && parsed.status ? parsed.status : null}`,
        roster,
        resolveResult,
        implementationResult,
        implementationArgs,
        implementation: parsed,
        ledger,
      };
    }

    return {
      status: parsed.status,
      phase: 'dispatch_implementation',
      reason: null,
      roster,
      resolveResult,
      implementationResult,
      implementationArgs,
      implementation: parsed,
      ledger,
    };
  }

  runImplementationReviewLoop(input = {}) {
    const ledger = [];
    let promptFile = input.promptFile;
    const branch = input.branch;
    const base = input.base;
    let loopCwd = this.cwd;
    const verifyCmdProvided = Object.prototype.hasOwnProperty.call(input, 'verifyCmd')
      && input.verifyCmd !== undefined
      && input.verifyCmd !== null;
    const verifyCmd = input.verifyCmd;
    const noVerifyFirst = input.noVerifyFirst === true;
    const verifyState = {
      verifyCmdProvided,
      verifyFirstSignalUnused: false,
      convergenceReason: null,
      ratchetRevertedRounds: 0,
      advisoryFindings: [],
      bestCommit: null,
    };
    const finish = (result) => resultWithVerificationFields(result, verifyState);

    if (!promptFile || typeof promptFile !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'promptFile is required',
        rounds: 0,
        verdict: null,
        roster: null,
        resolveResult: null,
        ledger,
      });
    }
    if (!branch || typeof branch !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'branch is required',
        rounds: 0,
        verdict: null,
        roster: null,
        resolveResult: null,
        ledger,
      });
    }
    if (!base || typeof base !== 'string') {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'base is required',
        rounds: 0,
        verdict: null,
        roster: null,
        resolveResult: null,
        ledger,
      });
    }
    if (!isImmutableGitSha(base)) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'base must be a full immutable git SHA',
        rounds: 0,
        verdict: null,
        roster: null,
        resolveResult: null,
        ledger,
      });
    }
    if (Object.prototype.hasOwnProperty.call(input, 'cwd') && input.cwd !== undefined && input.cwd !== null) {
      if (typeof input.cwd !== 'string' || input.cwd.length === 0) {
        const startedAt = this.now();
        ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
        return finish({
          status: 'blocked',
          phase: 'prepare_implementation_loop',
          reason: 'cwd must be a non-empty string',
          rounds: 0,
          verdict: null,
          roster: null,
          resolveResult: null,
          ledger,
        });
      }
      loopCwd = path.resolve(input.cwd);
    }
    if (verifyCmdProvided && (typeof verifyCmd !== 'string' || verifyCmd.length === 0)) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'verifyCmd must be a non-empty string',
        rounds: 0,
        verdict: null,
        roster: null,
        resolveResult: null,
        ledger,
      });
    }
    promptFile = path.resolve(loopCwd, promptFile);

    let roster = input.roster || null;
    let resolveResult = null;

    if (!roster) {
      const resolverOptions = {
        ...(input.resolverOptions || {}),
        cwd: Object.prototype.hasOwnProperty.call(input.resolverOptions || {}, 'cwd')
          ? input.resolverOptions.cwd
          : loopCwd,
      };
      const resolved = this.resolveRoster({
        args: Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
          ? input.rosterArgs
          : ['--check-scorecard'],
        options: resolverOptions,
      });
      ledger.push(...resolved.ledger);
      resolveResult = resolved.result;
      roster = resolved.roster;

      if (resolved.status === 'blocked') {
        return finish({
          status: 'blocked',
          phase: 'resolve_roster',
          reason: resolved.reason,
          rounds: 0,
          verdict: null,
          roster: null,
          resolveResult,
          implementation: null,
          review: null,
          ledger,
        });
      }
    }

    if (roster && roster.verify_first === true && !verifyCmdProvided) {
      const startedAt = this.now();
      verifyState.verifyFirstSignalUnused = true;
      ledger.push(this.ledgerEntry('verify_first_signal', 'unused', startedAt));
    }

    try {
      validateReviewRoster(roster);
      validateImplementerRoster(roster);
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: error.message || String(error),
        rounds: 0,
        verdict: null,
        roster,
        resolveResult,
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
        ledger,
      });
    }

    const requireQualifiedReviewer = input.requireQualifiedReviewer === true;
    let maxRounds = roster.loop_max_rounds;
    if (Object.prototype.hasOwnProperty.call(input, 'maxRounds') && input.maxRounds !== undefined && input.maxRounds !== null) {
      if (typeof input.maxRounds === 'string') {
        maxRounds = Number(input.maxRounds);
      } else {
        maxRounds = input.maxRounds;
      }
    }

    try {
      validateInteger(maxRounds, 'maxRounds', 1);
    } catch (error) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: error.message || String(error),
        rounds: 0,
        verdict: null,
        roster,
        resolveResult,
        ledger,
      });
    }

    let convergenceVerdict = roster.loop_convergence_verdict;
    if (Object.prototype.hasOwnProperty.call(input, 'convergenceVerdict')) {
      convergenceVerdict = input.convergenceVerdict;
    }
    if (typeof convergenceVerdict !== 'string' || convergenceVerdict.length === 0) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation_loop', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'prepare_implementation_loop',
        reason: 'convergenceVerdict is required',
        rounds: 0,
        verdict: null,
        roster,
        resolveResult,
        ledger,
      });
    }

    if (requireQualifiedReviewer && roster.reviewer_qualified !== true) {
      const startedAt = this.now();
      ledger.push(
        this.ledgerEntry('reviewer_qualification', 'blocked', startedAt, {
          reviewer_qualified: roster.reviewer_qualified === true,
        }),
      );
      return finish({
        status: 'blocked',
        phase: 'reviewer_qualification',
        reason: 'reviewer is not qualified or qualification is unknown',
        rounds: 0,
        verdict: null,
        roster,
        resolveResult,
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
        ledger,
      });
    }

    const implementationChain = [];
    const reviewChain = [];
    const immutableBase = base;
    let repairPromptFile = promptFile;
    let nextBase = base;
    let implementation = null;
    let review = null;
    let bestVerifyPass = null;
    let bestRound = 0;

    for (let round = 1; round <= maxRounds; round += 1) {
      const currentBranch = round === 1
        ? branch
        : buildRepairBranchName({
          branch,
          round,
          previousCommit: nextBase,
        });

      implementation = this.implementTask({
        promptFile: repairPromptFile,
        branch: currentBranch,
        base: nextBase,
        roster,
        runId: input.runId,
        ledger: input.ledger,
        implementationStage: input.implementationStage,
        resultJson: input.resultJson,
        gitDir: input.gitDir,
        extraImplementationArgs: Object.prototype.hasOwnProperty.call(input, 'extraImplementationArgs')
          ? input.extraImplementationArgs
          : [],
        implementationOptions: {
          ...(input.implementationOptions || {}),
          cwd: loopCwd,
        },
      });
      ledger.push(...implementation.ledger);
      implementationChain.push(implementation);
      if (implementation.status !== 'committed') {
        const implementationPhase = implementation.phase || 'dispatch_implementation';
        return finish({
          status: 'blocked',
          phase: implementationPhase,
          reason: implementation.reason || `implementation status ${implementation.status}`,
          rounds: round,
          verdict: null,
          roster,
          resolveResult,
          implementation,
          review: null,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      const commit = implementation.implementation.commit;
      let currentVerifyPass = null;
      let currentRatchetReverted = false;
      let nextBaseAfterRound = commit;
      if (verifyCmdProvided) {
        const verifyStartedAt = this.now();
        let verifyResult;
        try {
          verifyResult = this.verifyCommandRunner({
            verifyCmd,
            cwd: loopCwd,
            round,
            commit,
            branch: currentBranch,
          });
        } catch (error) {
          verifyResult = {
            error,
            status: null,
            signal: null,
            stdout: '',
            stderr: '',
          };
        }
        const verifyBlockedReason = verifyResultBlocked(verifyResult);
        if (verifyBlockedReason) {
          ledger.push(this.ledgerEntry('verify_round', 'blocked', verifyStartedAt, {
            round,
            commit,
            verify_pass: false,
            exit_status: verifyResult ? verifyResult.status : null,
          }));
          return finish({
            status: 'blocked',
            phase: 'verify_round',
            reason: verifyBlockedReason,
            rounds: round,
            verdict: null,
            roster,
            resolveResult,
            implementation,
            review: null,
            implementationChain,
            reviewChain,
            ledger,
            base,
          });
        }

        currentVerifyPass = verifyResult.status === 0;
        implementation.verify_pass = currentVerifyPass;
        implementation.verify_exit_status = verifyResult.status;
        const isWorseThanBest = bestRound > 0
          && verificationRank(currentVerifyPass) < verificationRank(bestVerifyPass);
        if (!isWorseThanBest) {
          bestRound = round;
          bestVerifyPass = currentVerifyPass;
          verifyState.bestCommit = commit;
        } else {
          currentRatchetReverted = true;
          implementation.ratchet_reverted = true;
          verifyState.ratchetRevertedRounds += 1;
          nextBaseAfterRound = verifyState.bestCommit;
        }
        ledger.push(this.ledgerEntry('verify_round', currentVerifyPass ? 'passed' : 'failed', verifyStartedAt, {
          round,
          commit,
          verify_pass: currentVerifyPass,
          exit_status: verifyResult.status,
          ratchet_reverted: currentRatchetReverted,
          best_round: bestRound,
          best_commit: verifyState.bestCommit,
        }));

        if (currentRatchetReverted) {
          const resetStartedAt = this.now();
          let resetResult;
          try {
            resetResult = this.gitResetHard({
              commit: verifyState.bestCommit,
              cwd: loopCwd,
              round,
              revertedCommit: commit,
            });
          } catch (error) {
            resetResult = {
              error,
              status: null,
              signal: null,
              stdout: '',
              stderr: '',
            };
          }
          const resetBlockedReason = resetResultBlocked(resetResult);
          ledger.push(this.ledgerEntry('ratchet_reset', resetBlockedReason ? 'blocked' : 'reverted', resetStartedAt, {
            round,
            commit,
            reset_to_commit: verifyState.bestCommit,
            exit_status: resetResult ? resetResult.status : null,
          }));
          if (resetBlockedReason) {
            return finish({
              status: 'blocked',
              phase: 'ratchet_reset',
              reason: resetBlockedReason,
              rounds: round,
              verdict: null,
              roster,
              resolveResult,
              implementation,
              review: null,
              implementationChain,
              reviewChain,
              ledger,
              base,
            });
          }
        }
      }
      let diffFile;
      try {
        diffFile = this.diffProvider({
          base: immutableBase,
          commit,
          branch: currentBranch,
          round,
          currentBase: nextBase,
          cwd: loopCwd,
        });
      } catch (error) {
        return finish({
          status: 'blocked',
          phase: 'prepare_review',
          reason: error.message || String(error),
          rounds: round,
          verdict: null,
          roster,
          resolveResult,
          implementation,
          review: null,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      review = this.reviewDiff({
        diffFile,
        specFile: input.noReviewSpec !== true ? promptFile : undefined,
        roster,
        extraReviewArgs: input.extraReviewArgs || [],
        reviewOptions: {
          ...(input.reviewOptions || {}),
          cwd: loopCwd,
        },
        requireQualifiedReviewer,
      });
      ledger.push(...review.ledger);
      reviewChain.push(review);
      if (review.status !== 'reviewed') {
        if (verifyCmdProvided && currentVerifyPass === true && !noVerifyFirst) {
          verifyState.convergenceReason = 'verification';
          return finish({
            status: 'converged',
            phase: 'converged',
            reason: null,
            rounds: round,
            verdict: review.verdict || null,
            roster,
            resolveResult,
            base,
            implementation,
            review,
            implementationChain,
            reviewChain,
            ledger,
          });
        }
        return finish({
          status: 'blocked',
          phase: 'dispatch_review',
          reason: review.reason || `review status ${review.status}`,
          rounds: round,
          verdict: review.verdict || null,
          roster,
          resolveResult,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      if (verifyCmdProvided && currentVerifyPass === true && !noVerifyFirst) {
        if (review.verdict !== convergenceVerdict) {
          verifyState.advisoryFindings.push(...collectFindings(review));
        }
        verifyState.convergenceReason = 'verification';
        return finish({
          status: 'converged',
          phase: 'converged',
          reason: null,
          rounds: round,
          verdict: review.verdict,
          roster,
          resolveResult,
          base,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      if (review.verdict === convergenceVerdict) {
        if (verifyCmdProvided) verifyState.convergenceReason = 'reviewer';
        return finish({
          status: 'converged',
          phase: 'converged',
          reason: null,
          rounds: round,
          verdict: review.verdict,
          roster,
          resolveResult,
          base,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      if (round >= maxRounds) {
        return finish({
          status: 'non_converged',
          phase: 'max_rounds',
          reason: `reached max rounds (${maxRounds}) without convergence`,
          rounds: round,
          verdict: review.verdict,
          roster,
          resolveResult,
          base,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      try {
        repairPromptFile = this.repairPromptWriter({
          promptFile,
          round: round + 1,
          base: immutableBase,
          previousCommit: nextBaseAfterRound,
          commit,
          review,
        });
      } catch (error) {
        return finish({
          status: 'blocked',
          phase: 'prepare_implementation',
          reason: error.message || String(error),
          rounds: round,
          verdict: review.verdict,
          roster,
          resolveResult,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }

      nextBase = nextBaseAfterRound;
    }

    return finish({
      status: 'non_converged',
      phase: 'max_rounds',
      reason: `reached max rounds (${maxRounds}) without convergence`,
      rounds: maxRounds,
      verdict: null,
      roster,
      resolveResult,
      implementationChain,
      reviewChain,
      ledger,
      base,
      implementation,
      review: reviewChain[reviewChain.length - 1] || null,
    });
  }
}

module.exports = {
  AutopilotEngine,
  buildImplementationArgs,
  buildReviewArgs,
  implementationResultBlocked,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  validateExtraReviewArgs,
  validateExtraArgs,
  tempNameSegment,
  validateReviewRoster,
  validateImplementerRoster,
};
