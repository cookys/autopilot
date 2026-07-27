'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { isImmutableGitSha } = require('../lib/common');
const {
  contractDigest: repairScopeContractDigest,
  evaluate: evaluateRepairScope,
} = require('../../scripts/check-repair-scope');

const { resolveReviewLoopJson } = require('./resolve-review-loop');
const { dispatchReviewJson } = require('../runners/review');
const { dispatchImplementJson } = require('../runners/implementer');
const { createEngineLifecycleObservationSession } = require('./engine-lifecycle-observation');
const { AUTOPILOT_ENGINE_CONTROL_SINKS } = require('./supervised-engine-bridge-contract');
const {
  appendCampaignEvent,
  completeCampaignAdmission,
  releaseCampaignAdmission,
  runCampaignIntake,
} = require('./campaign-intake');
const {
  projectMissionMode,
} = require('../../scripts/implementation-campaign-check');
const {
  createFileBackedMissionStateStore,
  createMissionCampaignAdapters,
} = require('./mission-convergence');
const { runCampaignComposition } = require('./campaign-composition');
const {
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  campaignIdFor,
} = require('./implementation-campaign');
const { normalizeProductReviewFindings } = require('./product-review-normalizer');
const {
  canonicalDigest: campaignCanonicalDigest,
  createDetachedCheckoutAttestation,
  createLedgerReconciliationReceipt,
  createVerificationReceipt,
  createVerificationRequest,
  createWriterFence,
  reusableGreenReceipt,
  verificationArgv,
} = require('./campaign-verification');
const { adjudicateCampaignReview } = require('./campaign-adjudication');
const { evaluateLoopConvergence } = require('../../scripts/check-loop-convergence');
const {
  inspectLifecycleReceipt,
} = require('../../scripts/lifecycle-residue-receipt');

const RUN_LEDGER_SCRIPT = path.resolve(__dirname, '..', '..', 'scripts', 'run-ledger.sh');

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

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
  ];
  for (const [field, value] of fields) {
    if (isPathLikelyMisplaced(value, cwd)) {
      evidence.push(`${field}:${value}`);
    }
  }
  return evidence;
}

const IMPLEMENTATION_STAGE_DEFAULT = 'implement';

function normalizeImplementationStage(value) {
  return typeof value === 'string' && value.length > 0 ? value : IMPLEMENTATION_STAGE_DEFAULT;
}

function resolveImplementationLedgerStage(input = {}) {
  const stageBase = normalizeImplementationStage(input.implementationStage);

  if (Number.isInteger(input.implementationRound) && input.implementationRound > 0) {
    return input.implementationRound === 1
      ? stageBase
      : `${stageBase}#r${input.implementationRound}`;
  }

  const runId = input.runId;
  if (typeof runId === 'string' && runId.length > 0) {
    throw new Error(`implementationRound is required to resolve ledger stage for runId "${runId}"`);
  }

  return stageBase;
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
  let reconciliationReceipt;
  try {
    reconciliationReceipt = createLedgerReconciliationReceipt({
      campaignId: resolvedRunId,
      stageIdentity: resolvedStage,
      candidateCommit: commit,
      reconcileResult: reconcilePayload,
      latestRecord,
    });
  } catch (_error) {
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
    reconciliation_receipt: reconciliationReceipt,
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

function resolveScriptPath(relativePath) {
  return path.resolve(__dirname, '..', '..', relativePath);
}

function modelFamilyOfEngine(engine) {
  const normalized = String(engine || '').toLowerCase();
  if (/(gpt|codex|o1|o3|o4)/.test(normalized)) return 'openai';
  if (/(claude|opus|sonnet|haiku)/.test(normalized)) return 'anthropic';
  if (/(qwen|qwq)/.test(normalized)) return 'alibaba';
  if (/(gemini|flash|bison)/.test(normalized)) return 'google';
  if (/(grok|composer)/.test(normalized)) return 'xai';
  if (/(qwen|qoder)/.test(normalized)) return 'alibaba';
  if (/(minimax|abab)/.test(normalized)) return 'minimax';
  if (/(glm|zhipu)/.test(normalized)) return 'zhipu';
  return 'unknown';
}

function sourceTrustForEngine(engine) {
  return ['openai', 'anthropic', 'google'].includes(modelFamilyOfEngine(engine)) ? 'high' : 'low';
}

// Family-conflict fallback (v2.32.25): runners a fallback ladder row may select.
// Validated dispatch-review modes only; 'auto' is rejected (hides the concrete
// invocation) and endpoint-backed runners (cc-shim / anthropic-compatible) stay
// excluded until scorecard rows carry endpoint provenance — substituting them
// without it could silently dispatch the wrong backend.
const FALLBACK_REVIEW_RUNNERS = new Set(['codex', 'agy', 'grok', 'claude-native']);
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Endpoint wiring (v2.32.45): the only reviewer runners that consume a named
// endpoint credential (dispatch-review.sh --endpoint <name> → resolve-endpoint.sh
// → AUTOPILOT_ENDPOINT_<NAME>_{URL,TOKEN} from ~/.autopilot/endpoints.env). Every
// other runner (codex/agy/grok/qoderclicn/claude-native) authenticates natively and gets NO
// --endpoint. The name must be env-var-compatible ([A-Za-z0-9_]+, matching the
// resolve-endpoint.sh contract); anything else (a URL, empty string) is ignored.
const ENDPOINT_CAPABLE_REVIEW_RUNNERS = new Set(['cc-shim', 'anthropic-compatible']);
const VALID_ENDPOINT_NAME = /^[A-Za-z0-9_]+$/;

function ensureDistinctReviewFamily({ implementerEngine, reviewerEngine }) {
  const iFamily = modelFamilyOfEngine(implementerEngine);
  const rFamily = modelFamilyOfEngine(reviewerEngine);
  if (iFamily === 'unknown' || rFamily === 'unknown') return true;
  return iFamily !== rFamily;
}

// Family-conflict fallback selection (v2.32.25 design; extracted v2.32.40).
// Shared by reviewDiff's per-round substitution AND the implement-review
// pre-flight viability check (so the pre-flight can tell whether the loop is
// genuinely unviable vs. rescuable by the per-round fallback). Returns the first
// qualified cross-family ladder row, or null. Every guard fails CLOSED to the
// pre-v2.32.25 hard block:
//   - mode: roster.on_family_conflict must be exactly 'fallback';
//   - provenance: roster.fallback_ladder_implementer_family must equal the ACTUAL
//     implementer's family (a stale ladder computed against a different
//     implementer never selects);
//   - candidate: first ladder row whose ENGINE-derived family (row.family is
//     advisory only) differs from the implementer family and is not unknown, whose
//     DISPATCH model (row.model, defaulting to row.engine) derives the same family
//     (a cross-family display id pairing a same-family model is rejected), whose
//     runner is in the validated dispatch-review allowlist, and — for the codex
//     runner — whose row carries a calibrated effort.
// Preference lists (v2.32.26): HUMAN-ordered engine ids consulted BEFORE raw
// ladder order (a preferred row must still pass every guard); review_risk=low uses
// the _low_risk list when non-empty. implFamily 'unknown' fails closed (returns
// null) — an unclassified implementer must never reach ladder selection.
function selectFamilyConflictFallback({ implementerEngine, roster, reviewRisk }) {
  const implFamily = modelFamilyOfEngine(implementerEngine);
  if (
    implFamily === 'unknown'
    || !roster
    || roster.on_family_conflict !== 'fallback'
    || !Array.isArray(roster.fallback_ladder)
    || typeof roster.fallback_ladder_implementer_family !== 'string'
    || roster.fallback_ladder_implementer_family !== implFamily
  ) {
    return null;
  }
  const rowIsValid = (row) => {
    if (!row || typeof row.engine !== 'string' || typeof row.runner !== 'string') return false;
    const rowFamily = modelFamilyOfEngine(row.engine);
    if (rowFamily === 'unknown' || rowFamily === implFamily) return false;
    const rowModel = typeof row.model === 'string' && row.model ? row.model : row.engine;
    if (modelFamilyOfEngine(rowModel) !== rowFamily) return false;
    if (!FALLBACK_REVIEW_RUNNERS.has(row.runner)) return false;
    if (row.runner === 'codex' && !VALID_EFFORTS.has(row.effort)) return false;
    return true;
  };
  const prefList = (reviewRisk === 'low'
    && Array.isArray(roster.reviewer_fallback_preference_low_risk)
    && roster.reviewer_fallback_preference_low_risk.length > 0)
    ? roster.reviewer_fallback_preference_low_risk
    : (Array.isArray(roster.reviewer_fallback_preference) ? roster.reviewer_fallback_preference : []);
  for (const preferred of prefList) {
    const row = roster.fallback_ladder.find((r) => r && r.engine === preferred && rowIsValid(r));
    if (row) return row;
  }
  for (const row of roster.fallback_ladder) {
    if (rowIsValid(row)) return row;
  }
  return null;
}

function normalizeChecklistList(value) {
  const items = Array.isArray(value) ? value : `${value || ''}`.split(',');
  const normalized = [];
  for (const raw of items) {
    const item = `${raw || ''}`.trim();
    if (item === '') continue;
    if (!normalized.includes(item)) {
      normalized.push(item);
    }
  }
  return normalized;
}

function buildRiskResolverArgs(baseArgs, riskFlags = {}) {
  const args = Array.isArray(baseArgs) ? [...baseArgs] : ['--check-scorecard'];

  if (riskFlags && typeof riskFlags === 'object' && !Array.isArray(riskFlags)) {
    if (riskFlags.source_trust === 'low' || riskFlags.source_trust === 'high') {
      args.push('--source-trust', riskFlags.source_trust);
    }

    if (Number.isInteger(riskFlags.diff_lines) || /^\d+$/.test(`${riskFlags.diff_lines}`)) {
      args.push('--diff-lines', `${Number(riskFlags.diff_lines)}`);
    }

    if (riskFlags.protected_path === 1 || riskFlags.protected_path === '1') {
      args.push('--protected-path', '1');
    } else if (riskFlags.protected_path === 0 || riskFlags.protected_path === '0') {
      args.push('--protected-path', '0');
    }

    if (riskFlags.oracle_available === 0 || riskFlags.oracle_available === '0' || riskFlags.oracle_available === 1 || riskFlags.oracle_available === '1') {
      args.push('--oracle-available', `${riskFlags.oracle_available}`);
    }

    if (riskFlags.security_surface === 0 || riskFlags.security_surface === '0' || riskFlags.security_surface === 1 || riskFlags.security_surface === '1') {
      args.push('--security-surface', `${riskFlags.security_surface}`);
    }
  }

  return args;
}

function defaultClassifyDiffRisk(input = {}) {
  const args = ['--repo', input.repoRoot || process.cwd(), '--diff-file', input.diffFile];
  if (input.sourceTrust) args.push('--source-trust', `${input.sourceTrust}`);
  if (input.oracleAvailable === 0 || input.oracleAvailable === 1) {
    args.push('--oracle-available', `${input.oracleAvailable}`);
  }
  if (input.securitySurface === 0 || input.securitySurface === 1) {
    args.push('--security-surface', `${input.securitySurface}`);
  }
  if (input.rulesFile) {
    args.push('--rules-file', `${input.rulesFile}`);
  }
  if (typeof input.samplingRatio !== 'undefined') {
    args.push('--sampling-ratio', `${input.samplingRatio}`);
  }
  if (typeof input.samplingSeed !== 'undefined') {
    args.push('--sampling-seed', `${input.samplingSeed}`);
  }
  if (input.range) {
    args.push('--range', `${input.range}`);
  }

  const script = resolveScriptPath('scripts/classify-diff-risk.sh');
  const child = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    cwd: input.repoRoot || process.cwd(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (child.error) {
    throw child.error;
  }

  if (child.status !== 0) {
    throw new Error(`classify-diff-risk exited with status ${child.status}`);
  }

  const stdout = String(child.stdout || '').trim();
  if (!stdout) {
    throw new Error('classify-diff-risk returned empty output');
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`classify-diff-risk output was not valid JSON: ${error.message}`);
  }
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

// --- on_engine_unavailable policy wiring (2026-07-17 run E residual) ------------------
// dispatch-hetero (v2.32.53) marks quota/rate/auth/overload worker deaths with status
// engine_unavailable and embeds the classify-error kind in its error string as
// "engine unavailable (<class>): ..." (dispatch-owned format). These helpers map the
// resolver's on_engine_unavailable policy (ask|solo-fallback|wait-reset) to a
// machine-readable action so depth-0/foreman no longer reads raw dispatch JSON and
// applies the policy by hand. Behavior matrix per review-loop-config.md; every
// unrecognized input fails closed to escalate.

function parseEngineUnavailableClass(errorText) {
  if (typeof errorText !== 'string') return null;
  const match = /^engine unavailable \(([a-z_]+)\)/.exec(errorText);
  return match ? match[1] : null;
}

function resolveEngineUnavailableDirective(roster, dispatchStatus, errorText) {
  if (dispatchStatus !== 'engine_unavailable' && dispatchStatus !== 'precondition_failed') {
    return null;
  }
  const raw = roster && typeof roster.on_engine_unavailable === 'string'
    ? roster.on_engine_unavailable
    : null;
  const policy = (raw === 'ask' || raw === 'solo-fallback' || raw === 'wait-reset') ? raw : 'ask';
  let action = 'escalate';
  if (dispatchStatus === 'engine_unavailable') {
    const errorClass = parseEngineUnavailableClass(errorText);
    // Waiting only helps capacity-shaped deaths; auth (and unparseable classes) cannot
    // recover on a timer — escalate regardless of policy.
    const waitable = errorClass === 'quota_exhausted' || errorClass === 'rate_limited' || errorClass === 'overloaded';
    if ((policy === 'wait-reset' || policy === 'solo-fallback') && waitable) {
      action = 'wait-reset';
    }
    return { policy, action, error_class: errorClass, dispatch_status: dispatchStatus };
  }
  // precondition_failed: solo-fallback is the only policy that keeps the run moving
  // ("falls back to --solo inline" is the ORCHESTRATOR's move — the engine surfaces the
  // directive; it cannot implement inline itself). ask and wait-reset both escalate.
  if (policy === 'solo-fallback') {
    action = 'solo-fallback';
  }
  return { policy, action, error_class: null, dispatch_status: dispatchStatus };
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

const DISPATCH_IDENTITY_FLAGS = ['--ledger', '--run-id', '--stage'];

function normalizeDispatchIdentity(identity, label) {
  if (identity === null || identity === undefined) return null;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) {
    throw new TypeError(`${label} must be an object`);
  }
  const normalized = {};
  for (const field of ['ledger', 'runId', 'stage']) {
    if (typeof identity[field] !== 'string' || identity[field].length === 0) {
      throw new TypeError(`${label}.${field} must be a non-empty string`);
    }
    normalized[field] = identity[field];
  }
  return normalized;
}

function appendDispatchIdentity(args, identity) {
  if (!identity) return;
  args.push(
    '--ledger', identity.ledger,
    '--run-id', identity.runId,
    '--stage', identity.stage,
  );
}

function buildReviewArgs({
  roster,
  diffFile,
  specFile,
  extraReviewArgs = [],
  checklists = [],
  dispatchIdentity = null,
}) {
  validateReviewRoster(roster);
  if (!diffFile || typeof diffFile !== 'string') {
    throw new TypeError('diffFile is required');
  }
  validateExtraArgs(extraReviewArgs, new Set([
    '--runner',
    '--model',
    '--diff-file',
    '--effort',
    '--spec-file',
    '--checklists',
    '--endpoint',
    ...DISPATCH_IDENTITY_FLAGS,
  ]), 'extraReviewArgs');
  if (extraReviewArgs.some(arg => arg === '--spec-file' || arg.startsWith('--spec-file='))) {
    throw new TypeError('extra args cannot override --spec-file');
  }
  const identity = normalizeDispatchIdentity(dispatchIdentity, 'dispatchIdentity');

  // `--checklists` is a BUILDER-MANAGED arg (like `--spec-file`): callers may not pass it in
  // extraReviewArgs (it is reserved), the builder injects the classifier-derived list. It is
  // placed FIRST so the risk-triggered checklist is the most visible part of the review args.
  const args = [];
  const normalizedChecklists = normalizeChecklistList(checklists);
  if (normalizedChecklists.length > 0) {
    args.push('--checklists', normalizedChecklists.join(','));
  }
  args.push(
    '--runner',
    roster.reviewer_runner,
    '--model',
    roster.reviewer_engine,
    '--diff-file',
    diffFile,
    '--effort',
    roster.reviewer_effort,
  );
  // Named-endpoint wiring: pass --endpoint ONLY when the effective reviewer runner
  // is endpoint-capable AND the roster carries a valid endpoint name. A substituted
  // family-conflict fallback reviewer has its reviewer_endpoint blanked upstream (in
  // reviewDiff), so it can never inherit the incumbent's endpoint here. --endpoint is
  // builder-managed (reserved in extraReviewArgs alongside --runner/--model/…), so
  // the ONLY source of a passed endpoint is this name-validated roster field; any
  // --endpoint in extraReviewArgs is rejected, never a trusted-caller bypass.
  if (
    ENDPOINT_CAPABLE_REVIEW_RUNNERS.has(roster.reviewer_runner)
    && typeof roster.reviewer_endpoint === 'string'
    && VALID_ENDPOINT_NAME.test(roster.reviewer_endpoint)
  ) {
    args.push('--endpoint', roster.reviewer_endpoint);
  }
  if (specFile && typeof specFile === 'string') {
    args.push('--spec-file', specFile);
  }
  appendDispatchIdentity(args, identity);
  args.push(...extraReviewArgs);
  return args;
}

function validateExtraReviewArgs(extraReviewArgs) {
  validateExtraArgs(extraReviewArgs, new Set([
    '--runner',
    '--model',
    '--diff-file',
    '--effort',
    '--spec-file',
    '--checklists',
    '--endpoint',
    ...DISPATCH_IDENTITY_FLAGS,
  ]), 'extraReviewArgs');
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
  dispatchIdentity = null,
  campaignContractFile = null,
  campaignContractDigest = null,
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
    '--campaign-contract',
    '--campaign-contract-sha256',
    ...DISPATCH_IDENTITY_FLAGS,
  ]), 'extraImplementationArgs');
  if (campaignContractFile !== null
      && (typeof campaignContractFile !== 'string' || campaignContractFile.length === 0)) {
    throw new TypeError('campaignContractFile must be a non-empty string');
  }
  if (campaignContractDigest !== null
      && (typeof campaignContractDigest !== 'string'
        || !/^[0-9a-f]{64}$/.test(campaignContractDigest))) {
    throw new TypeError('campaignContractDigest must be a lowercase SHA-256 digest');
  }
  if ((campaignContractFile === null) !== (campaignContractDigest === null)) {
    throw new TypeError('campaignContractFile and campaignContractDigest must be supplied together');
  }

  const args = [
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
  ];
  appendDispatchIdentity(
    args,
    normalizeDispatchIdentity(dispatchIdentity, 'dispatchIdentity'),
  );
  if (campaignContractFile) {
    args.push('--campaign-contract', path.resolve(cwd || process.cwd(), campaignContractFile));
    args.push('--campaign-contract-sha256', campaignContractDigest);
  }
  args.push(...extraImplementationArgs);
  return args;
}

function deriveCampaignLifecycleRoot({
  campaignContractFile,
  campaignContractDigest,
  runId,
  cwd,
}) {
  const contractPath = path.resolve(cwd || process.cwd(), campaignContractFile);
  let contract;
  try {
    contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  } catch (error) {
    throw new TypeError(`managed campaign contract is unreadable: ${error.message}`);
  }
  const common = spawnSync(
    'git',
    ['-C', cwd || process.cwd(), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (common.error || common.status !== 0) {
    throw new TypeError('managed campaign repository identity is unavailable');
  }
  let commonDir;
  try {
    commonDir = fs.realpathSync(String(common.stdout || '').trim());
  } catch (_error) {
    throw new TypeError('managed campaign Git common directory is unreadable');
  }
  const repoIdentity = `git-common-dir:${commonDir}`;
  if (!contract || contract.repo_identity !== repoIdentity) {
    throw new TypeError('managed campaign contract repository identity does not match cwd');
  }
  const expected = campaignIdFor(
    repoIdentity,
    contract.ticket,
    campaignContractDigest,
  );
  if (runId !== expected) {
    throw new TypeError(
      'managed campaign run id does not match the sealed contract identity',
    );
  }
  return expected;
}

function buildRepairBranchName({ branch, round, previousCommit }) {
  const short = previousCommit ? previousCommit.slice(0, 7) : 'base';
  return `${branch}-repair-r${round}-${short}`;
}

function reviewerQualificationViable(roster) {
  if (roster.reviewer_qualified === true) return true;
  const familyConflict = !ensureDistinctReviewFamily({
    implementerEngine: roster.implementer_engine,
    reviewerEngine: roster.reviewer_engine,
  });
  return familyConflict
    && selectFamilyConflictFallback({
      implementerEngine: roster.implementer_engine,
      roster,
      reviewRisk: typeof roster.review_risk === 'string' ? roster.review_risk : null,
    }) !== null;
}

function isCampaignPreSpendRejection(result) {
  if (!result || result.status !== 'blocked') return false;
  if (result.phase === 'prepare_implementation'
      && result.implementationResult === null
      && result.implementation === null) {
    return true;
  }
  const leaf = result.implementation;
  return leaf
    && leaf.status === 'precondition_failed'
    && leaf.commit === null
    && leaf.worktree === null
    && leaf.files_changed === 0
    && leaf.insertions === 0
    && leaf.deletions === 0;
}

function campaignWallBudgetStatus(control, observedAt) {
  if (!control || control.status !== 'admitted') {
    return { exhausted: false, elapsed_seconds: null };
  }
  const state = control.initial_state;
  const startedAt = state && Date.parse(state.started_at);
  const observed = Date.parse(observedAt);
  const limit = state && state.limits && state.limits.max_wall_seconds;
  if (!Number.isFinite(startedAt)
      || !Number.isFinite(observed)
      || observed < startedAt
      || !Number.isSafeInteger(limit)
      || limit < 0) {
    return { exhausted: true, elapsed_seconds: null };
  }
  const elapsed = Math.floor((observed - startedAt) / 1000);
  return {
    exhausted: elapsed >= limit,
    elapsed_seconds: elapsed,
  };
}

function campaignMutationBudgetStatus(control, observedAt) {
  const wall = campaignWallBudgetStatus(control, observedAt);
  if (wall.exhausted || !control || control.status !== 'admitted') return wall;
  const state = control.initial_state;
  const usage = state && state.usage;
  const limits = state && state.limits;
  if (!usage || !limits) {
    return { exhausted: true, elapsed_seconds: wall.elapsed_seconds, axis: 'state' };
  }
  if (usage.changed_files >= limits.max_changed_files) {
    return { exhausted: true, elapsed_seconds: wall.elapsed_seconds, axis: 'changed_files' };
  }
  if (usage.churn >= limits.max_churn) {
    return { exhausted: true, elapsed_seconds: wall.elapsed_seconds, axis: 'churn' };
  }
  return { ...wall, axis: null };
}

function createCampaignScopeSession({ contract, base, implementationSha }) {
  const allowedNewPaths = contract.allowed_path_prefixes.map((prefix) => (
    prefix.endsWith('/') ? `${prefix}**` : `${prefix}/**`
  ));
  const scopeContract = Object.freeze({
    schema: 1,
    task_id: contract.ticket,
    base_sha: base,
    implementation_sha: implementationSha,
    allowed_path_prefixes: [...contract.allowed_path_prefixes],
    allowed_new_paths: allowedNewPaths,
    baseline_churn: contract.baseline_churn,
    max_growth_ratio: contract.max_growth_ratio,
    max_extra_churn: contract.max_extra_churn,
  });
  return Object.freeze({
    contract: scopeContract,
    seal_digest: repairScopeContractDigest(scopeContract),
    max_changed_files: contract.max_changed_files,
  });
}

function checkCampaignScope({ session, repo, head }) {
  if (!session
      || repairScopeContractDigest(session.contract) !== session.seal_digest) {
    return {
      passed: false,
      verdict: 'TRIP',
      reason: 'campaign scope seal drifted',
    };
  }
  let result;
  try {
    result = evaluateRepairScope(session.contract, repo, head);
  } catch (error) {
    return {
      passed: false,
      verdict: 'TRIP',
      reason: error.message || String(error),
    };
  }
  const fileCapPassed = result.changed_files.length <= session.max_changed_files;
  const body = {
    ...result,
    file_cap: session.max_changed_files,
    file_cap_passed: fileCapPassed,
    seal_digest: session.seal_digest,
  };
  return {
    ...body,
    passed: result.verdict === 'PASS' && fileCapPassed,
    receipt_digest: campaignCanonicalDigest(body),
    reason: result.verdict === 'PASS' && fileCapPassed
      ? null
      : (fileCapPassed ? 'repair scope gate tripped' : 'changed-file cap exceeded'),
  };
}

function defaultCampaignAdjudicator({
  review,
  convergenceVerdict,
  dispositionAuthority,
  now,
}) {
  return adjudicateCampaignReview({
    review,
    convergenceVerdict,
    dispositionAuthority,
    now,
  });
}

function defaultCampaignTreeResolver({ repo, commit }) {
  const child = spawnSync('git', ['rev-parse', '--verify', `${commit}^{tree}`], {
    cwd: repo,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const treeSha = String(child.stdout || '').trim();
  if (child.error || child.signal || child.status !== 0 || !isImmutableGitSha(treeSha)) {
    throw new Error('candidate Git tree could not be resolved from the implementation commit');
  }
  return treeSha;
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

function defaultVerifyCommandRunner({ verifyCmd, cwd, env = process.env }) {
  const [file, ...args] = verificationArgv(verifyCmd);
  const child = spawnSync(file, args, {
    cwd: cwd || process.cwd(),
    env,
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
    executed_argv: [file, ...args],
  };
}

function defaultGitWorktreeAdd({ commit, cwd }) {
  if (!cwd || typeof cwd !== 'string') {
    return {
      error: new Error('git worktree add requires repository cwd'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      worktree: null,
      parent: null,
      commit,
      observed_commit: null,
      observed_tree_sha: null,
      detached: false,
    };
  }
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-verify-wt-'));
  const worktree = path.join(parent, 'wt');
  let child;
  try {
    child = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', worktree, commit], {
      cwd,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return {
      error,
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      worktree,
      parent,
      commit,
      observed_commit: null,
      observed_tree_sha: null,
      detached: false,
    };
  }
  let observedCommit = null;
  let observedTreeSha = null;
  let detached = false;
  if (child.status === 0 && !child.error && !child.signal) {
    const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: worktree,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const tree = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{tree}'], {
      cwd: worktree,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const symbolic = spawnSync('git', ['symbolic-ref', '--quiet', 'HEAD'], {
      cwd: worktree,
      encoding: 'utf8',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!head.error && !head.signal && head.status === 0) {
      observedCommit = String(head.stdout || '').trim();
    }
    if (!tree.error && !tree.signal && tree.status === 0) {
      observedTreeSha = String(tree.stdout || '').trim();
    }
    detached = !symbolic.error && !symbolic.signal && symbolic.status === 1;
  }
  return {
    error: child.error || null,
    status: child.status,
    signal: child.signal || null,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
    worktree,
    parent,
    commit,
    observed_commit: observedCommit,
    observed_tree_sha: observedTreeSha,
    detached,
  };
}

function defaultGitWorktreeRemove({ worktree, cwd }) {
  if (!cwd || typeof cwd !== 'string') {
    return {
      error: new Error('git worktree remove requires repository cwd'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    };
  }
  const child = spawnSync('git', ['worktree', 'remove', '--force', worktree], {
    cwd,
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

function defaultVerifyWorktreeCleanup({ targetPath }) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new TypeError('verify worktree cleanup requires a target path');
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function defaultGitBranchForce({ branch, commit, cwd }) {
  const child = spawnSync('git', ['branch', '-f', branch, commit], {
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

function worktreeResultBlocked(result) {
  if (!result) return 'missing git worktree result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `git worktree command terminated by signal ${result.signal}`;
  if (result.status !== 0) return `git worktree command exited with status ${result.status}`;
  return null;
}

function appendCleanupWarning(current, message) {
  if (!message) return current;
  return current ? `${current}; ${message}` : message;
}

function branchForceResultBlocked(result) {
  if (!result) return 'missing ratchet branch update result';
  if (result.error) return result.error.message || String(result.error);
  if (result.signal) return `ratchet branch update terminated by signal ${result.signal}`;
  if (result.status !== 0) return `ratchet branch update exited with status ${result.status}`;
  return null;
}

// Resume-from-review precheck (v2.32.45): inspect the EXISTING branch WITHOUT any
// mutation. Returns { error, exists, tipSha, baseAncestor } — READ-ONLY git probes
// only (rev-parse + merge-base --is-ancestor). Never deletes, moves, or creates a
// ref. Consumed by runImplementationReviewLoop's --resume path.
function defaultResumeInspect({ base, branch, cwd }) {
  const runGit = (gitArgs) => spawnSync('git', gitArgs, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let rev;
  try {
    // NOTE: no `--` end-of-options here — `git rev-parse` reinterprets post-`--`
    // args as PATHSPECS, so `-- <rev>` fails to resolve the revision (verified).
    // branch originates from the trusted --branch CLI value / resolved roster.
    rev = runGit(['rev-parse', '--verify', '--quiet', `${branch}^{commit}`]);
  } catch (error) {
    return { error, exists: false, tipSha: null, baseAncestor: false };
  }
  if (rev.error) {
    return { error: rev.error, exists: false, tipSha: null, baseAncestor: false };
  }
  if (rev.status !== 0) {
    return { error: null, exists: false, tipSha: null, baseAncestor: false };
  }
  const tipSha = String(rev.stdout || '').trim();
  if (!isImmutableGitSha(tipSha)) {
    return { error: null, exists: false, tipSha: null, baseAncestor: false };
  }

  let anc;
  try {
    anc = runGit(['merge-base', '--is-ancestor', base, branch]);
  } catch (error) {
    return { error, exists: true, tipSha, baseAncestor: false };
  }
  if (anc.error) {
    return { error: anc.error, exists: true, tipSha, baseAncestor: false };
  }
  return { error: null, exists: true, tipSha, baseAncestor: anc.status === 0 };
}

function resumeInspectBlocked(inspect, { base, branch }) {
  if (!inspect) return 'resume inspection produced no result';
  if (inspect.error) {
    return `resume inspection failed: ${inspect.error.message || String(inspect.error)}`;
  }
  if (!inspect.exists || typeof inspect.tipSha !== 'string' || !isImmutableGitSha(inspect.tipSha)) {
    return `resume requested but branch ${branch} does not exist or has no commit`;
  }
  if (!inspect.baseAncestor) {
    return `resume requested but base ${base} is not an ancestor of branch ${branch}`;
  }
  if (inspect.tipSha === base) {
    return `resume requested but branch ${branch} is not ahead of base ${base}`;
  }
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
    this.gitWorktreeAdd = options.gitWorktreeAdd || defaultGitWorktreeAdd;
    this.gitWorktreeRemove = options.gitWorktreeRemove || defaultGitWorktreeRemove;
    this.verifyWorktreeCleanup = options.verifyWorktreeCleanup || defaultVerifyWorktreeCleanup;
    this.gitBranchForce = options.gitBranchForce || defaultGitBranchForce;
    this.gitResumeInspect = options.gitResumeInspect || defaultResumeInspect;
    this.cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    this.now = createClock(options.clock);
    this.classifyDiffRisk = options.classifyDiffRisk || defaultClassifyDiffRisk;
    this.lifecycleObserver = options.lifecycleObserver || null;
    this.campaignIntake = options.campaignIntake || runCampaignIntake;
    this.campaignAdmissionReleaser = options.campaignAdmissionReleaser
      || releaseCampaignAdmission;
    this.campaignEventAppender = options.campaignEventAppender || appendCampaignEvent;
    this.campaignAdmissionCompleter = options.campaignAdmissionCompleter
      || completeCampaignAdmission;
    this.campaignComposer = options.campaignComposer || runCampaignComposition;
    this.campaignAdjudicator = options.campaignAdjudicator || defaultCampaignAdjudicator;
    this.campaignDispositionProvider = options.campaignDispositionProvider || null;
    this.campaignScopeChecker = options.campaignScopeChecker || checkCampaignScope;
    this.campaignTreeResolver = options.campaignTreeResolver || defaultCampaignTreeResolver;
    this.campaignLifecycleInspector = options.campaignLifecycleInspector
      || inspectLifecycleReceipt;
    this.campaignPostCommitCheckpoint = typeof options.campaignPostCommitCheckpoint === 'function'
      ? options.campaignPostCommitCheckpoint
      : null;
    // Trusted Mission campaign adapter configuration. The engine builds
    // adapters internally and passes them as the second argument to
    // campaignIntake — callers never inject a free-form claim predicate.
    // Runtime input to runImplementationReviewLoop cannot override the
    // constructor's store/factory (host-trusted only).
    this.missionStatePath = typeof options.missionStatePath === 'string'
      && options.missionStatePath.length > 0
      ? path.resolve(options.missionStatePath)
      : null;
    if (options.missionCampaignStore
        && typeof options.missionCampaignStore === 'object'
        && typeof options.missionCampaignStore.load === 'function'
        && typeof options.missionCampaignStore.save === 'function') {
      this.missionCampaignStore = options.missionCampaignStore;
    } else if (this.missionStatePath) {
      this.missionCampaignStore = createFileBackedMissionStateStore(this.missionStatePath);
    } else {
      this.missionCampaignStore = null;
    }
    this.missionCampaignGrant = options.missionCampaignGrant || null;
    this.missionCampaignAdapterOptions = isPlainObject(options.missionCampaignAdapterOptions)
      ? options.missionCampaignAdapterOptions
      : {};
    this.missionAdapterFactory = typeof options.missionAdapterFactory === 'function'
      ? options.missionAdapterFactory
      : createMissionCampaignAdapters;
  }

  // Constructor-owned adapters only. Free-form runtime input cannot replace
  // the store or factory; grant_ref is taken from the sealed campaign contract.
  buildMissionCampaignAdapters({ grant_ref: grantRef = null } = {}) {
    const store = this.missionCampaignStore;
    const grant = this.missionCampaignGrant;
    const extra = this.missionCampaignAdapterOptions;
    const hasAtomicStore = store !== null
      && typeof store === 'object'
      && typeof store.load === 'function'
      && typeof store.save === 'function';
    const hasGrantRef = typeof grantRef === 'string' && /^[0-9a-f]{64}$/.test(grantRef);
    if (!hasAtomicStore && grant === null && !hasGrantRef && Object.keys(extra).length === 0) {
      return null;
    }
    return this.missionAdapterFactory({
      ...extra,
      store: hasAtomicStore ? store : undefined,
      grant: isPlainObject(grant) ? grant : (isPlainObject(extra.grant) ? extra.grant : grant),
      grant_ref: hasGrantRef
        ? grantRef
        : (typeof extra.grant_ref === 'string' ? extra.grant_ref : undefined),
    });
  }

  readCampaignMissionGrantRef(contractPath, cwd) {
    if (typeof contractPath !== 'string' || contractPath.length === 0) return null;
    const absolute = path.isAbsolute(contractPath)
      ? contractPath
      : path.resolve(cwd || this.cwd, contractPath);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    } catch (_error) {
      return null;
    }
    if (!isPlainObject(value)) return null;
    const ref = value.mission_grant_ref;
    return typeof ref === 'string' && /^[0-9a-f]{64}$/.test(ref) ? ref : null;
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
    const dynamicReviewRisk = input.dynamicReviewRisk === true;
    let roster = input.roster || null;
    let resolveResult = null;
    let reviewArgs = null;
    let classification = null;
    let reviewRisk = null;
    let riskClassification = null;

    const rosterArgs = Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
      ? input.rosterArgs
      : ['--check-scorecard'];
    const resolverOptions = {
      ...(input.resolverOptions || {}),
      cwd: Object.prototype.hasOwnProperty.call(input.resolverOptions || {}, 'cwd')
        ? input.resolverOptions.cwd
        : this.cwd,
    };

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

    if (!roster || dynamicReviewRisk) {
      let riskAwareArgs = rosterArgs;

      if (dynamicReviewRisk) {
        const classifyInput = {
          repoRoot: resolverOptions.cwd,
          diffFile: input.diffFile,
        };

        if (Object.prototype.hasOwnProperty.call(input, 'sourceTrust')) {
          classifyInput.sourceTrust = input.sourceTrust;
        } else if (roster && roster.implementer_engine) {
          classifyInput.sourceTrust = sourceTrustForEngine(roster.implementer_engine);
        }

        if (Object.prototype.hasOwnProperty.call(input, 'oracleAvailable')) {
          classifyInput.oracleAvailable = input.oracleAvailable;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'securitySurface')) {
          classifyInput.securitySurface = input.securitySurface;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'classifyRulesFile')) {
          classifyInput.rulesFile = input.classifyRulesFile;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'samplingRatio')) {
          classifyInput.samplingRatio = input.samplingRatio;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'samplingSeed')) {
          classifyInput.samplingSeed = input.samplingSeed;
        }

        if (Object.prototype.hasOwnProperty.call(input, 'diffRange')) {
          classifyInput.range = input.diffRange;
        }

        const startedAt = this.now();
        try {
          classification = this.classifyDiffRisk(classifyInput);
        } catch (error) {
          ledger.push(this.ledgerEntry('classify_diff_risk', 'blocked', startedAt));
          return {
            status: 'blocked',
            phase: 'classify_diff_risk',
            reason: error.message || String(error),
            verdict: null,
            roster,
            resolveResult,
            riskClassification: null,
            reviewResult: null,
            review: null,
            reviewArgs,
            ledger,
          };
        }

        ledger.push(this.ledgerEntry('classify_diff_risk', 'classified', startedAt, {
          domains: Array.isArray(classification.domains) ? classification.domains : [],
          checklists: Array.isArray(classification.checklists) ? classification.checklists : [],
          adversarial_review: Boolean(classification.adversarial_review),
          sampling_selected: classification.sampling
            ? Boolean(classification.sampling.selected)
            : false,
        }));

        riskClassification = {
          domains: Array.isArray(classification.domains) ? classification.domains : [],
          checklists: Array.isArray(classification.checklists) ? classification.checklists : [],
          adversarial_review: Boolean(classification.adversarial_review),
          risk_flags: classification.risk_flags || {},
          sampling: classification.sampling || {
            enabled: false,
            ratio: '0',
            bucket: 0,
            selected: false,
            reason: 'classification-unavailable',
          },
        };

        if (classification && classification.risk_flags) {
          riskAwareArgs = buildRiskResolverArgs(rosterArgs, classification.risk_flags);
        }
      }

      const resolved = this.resolveRoster({
        args: riskAwareArgs,
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

    if (!reviewRisk && resolveResult && resolveResult.result && resolveResult.result.review_risk) {
      reviewRisk = resolveResult.result.review_risk;
    }
    // Pre-resolved-roster path (implement-review passes roster with
    // dynamicReviewRisk off): resolveResult stays null, but the roster itself
    // carries the contract's review_risk — read it, or the low-risk tier below
    // is dead on the canonical /l5 loop path (found live 2026-07-13: roster
    // showed review_risk:"low" + both _low_risk keys, reviewer stayed
    // incumbent because reviewRisk was never populated here).
    if (!reviewRisk && roster && typeof roster.review_risk === 'string' && roster.review_risk) {
      reviewRisk = roster.review_risk;
    }

    // Risk-tiered low-risk reviewer overlay (v2.32.23): when the final computed
    // review_risk is LOW and the roster carries BOTH _low_risk keys, the loop
    // reviewer becomes that pair (runner unchanged). High/unknown risk keeps
    // reviewer_engine/reviewer_effort — the fail-safe direction is the stronger
    // incumbent. Derived HERE (after reviewRisk is final, before the family gate
    // and buildReviewArgs) so every downstream consumer sees the effective pair;
    // the returned roster self-documents the substitution (it still carries the
    // _low_risk source keys).
    if (
      reviewRisk === 'low'
      && roster
      && typeof roster.reviewer_engine_low_risk === 'string' && roster.reviewer_engine_low_risk.length > 0
      && typeof roster.reviewer_effort_low_risk === 'string' && roster.reviewer_effort_low_risk.length > 0
    ) {
      const tierIncumbent = {
        reviewer_engine: roster.reviewer_engine,
        reviewer_effort: roster.reviewer_effort,
      };
      roster = {
        ...roster,
        reviewer_engine: roster.reviewer_engine_low_risk,
        reviewer_effort: roster.reviewer_effort_low_risk,
      };
      // Tier qualification tuple check (v2.32.25, closes the "reviewer_qualified
      // doesn't cover the substituted engine" gap): when scorecard data IS present
      // (fallback_ladder emitted by --check-scorecard, the default rosterArgs), the
      // substituted pair must appear in the qualified ladder as an invocation TUPLE —
      // engine + runner, and for the codex runner (the only one that consumes
      // reasoning effort) the row's calibrated effort must match. No matching tuple
      // → revert to the incumbent pair (fail-safe = the stronger reviewer), ledger'd.
      // Rosters without a ladder (no --check-scorecard) are unchecked here — the
      // config owner vouches per scorecard-first.
      if (Array.isArray(roster.fallback_ladder)) {
        const tuple = roster.fallback_ladder.find((row) => row
          && row.engine === roster.reviewer_engine
          && row.runner === roster.reviewer_runner
          && (row.runner !== 'codex' || row.effort === roster.reviewer_effort));
        if (!tuple) {
          ledger.push(this.ledgerEntry('tier_reviewer_unqualified', 'reverted', this.now(), {
            tier_engine: roster.reviewer_engine,
            reverted_to: tierIncumbent.reviewer_engine,
          }));
          roster = { ...roster, ...tierIncumbent };
        }
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

    const implementerEngine = Object.prototype.hasOwnProperty.call(input, 'implementerEngine')
      ? input.implementerEngine
      : roster.implementer_engine;
    if (!ensureDistinctReviewFamily({
      implementerEngine,
      reviewerEngine: roster.reviewer_engine,
    })) {
      // Family-conflict fallback (v2.32.25 design review: gpt-5.5 xhigh REVISE
      // applied): instead of unconditionally hard-blocking — which left the
      // DEFAULT openai×openai roster with a permanently dead in-loop review and
      // convergence riding verify-first alone — walk the qualified cross-family
      // scorecard ladder. Every guard fails CLOSED to the pre-v2.32.25 block:
      //   - mode: roster.on_family_conflict must be exactly 'fallback'
      //     (absent/invalid/'block' → block);
      //   - provenance: roster.fallback_ladder_implementer_family must equal the
      //     ACTUAL implementer's family (a pre-resolved roster may carry a ladder
      //     computed against a different implementer — stale ladder never selects);
      //   - candidate: first ladder row whose ENGINE-derived family (row.family is
      //     advisory only) differs from the implementer family and is not unknown,
      //     whose runner is in the validated dispatch-review allowlist ('auto' and
      //     endpoint-backed runners excluded until rows carry endpoint provenance),
      //     and — for the codex runner — whose row carries a calibrated effort;
      //   - no candidate → block.
      // A selected fallback substitutes engine+runner (+row effort when present;
      // non-codex runners ignore --effort, so an inherited roster effort is inert).
      // Selection extracted to the module-level selectFamilyConflictFallback so
      // the implement-review pre-flight viability check reuses the SAME predicate
      // (see gate below). Behavior here is byte-identical: same guards, same
      // rowIsValid predicate, same preference-list-then-ladder-order walk.
      // implFamily 'unknown' is UNREACHABLE here today (ensureDistinctReviewFamily
      // returns true — no conflict — when either family is unknown), and the helper
      // pins that invariant (unclassified implementer → null → the hard block below).
      const fallbackRow = selectFamilyConflictFallback({ implementerEngine, roster, reviewRisk });
      if (fallbackRow) {
        // row.model = the exact --model dispatch string when the engine id is a
        // display id (e.g. engine "claude-haiku" dispatches as claude-native
        // --model "haiku"); absent = the engine id IS the dispatch string.
        const fallbackModel = typeof fallbackRow.model === 'string' && fallbackRow.model
          ? fallbackRow.model
          : fallbackRow.engine;
        ledger.push(this.ledgerEntry('reviewer_family_fallback', 'selected', this.now(), {
          from_engine: roster.reviewer_engine,
          to_engine: fallbackRow.engine,
          to_model: fallbackModel,
          to_runner: fallbackRow.runner,
        }));
        roster = {
          ...roster,
          reviewer_engine: fallbackModel,
          reviewer_runner: fallbackRow.runner,
          ...(typeof fallbackRow.effort === 'string' && VALID_EFFORTS.has(fallbackRow.effort)
            ? { reviewer_effort: fallbackRow.effort }
            : {}),
          // The fallback row comes from the QUALIFIED ladder (post-R5 a retired
          // rung never surfaces), so the effective reviewer's qualification is
          // certified by the selected row — not by the unused incumbent's
          // reviewer_qualified (gpt-5.5 R6 Minor).
          reviewer_qualified: true,
          // Defense-in-depth (gpt-5.5 R8; LIVE since v2.32.45 — buildReviewArgs now
          // wires roster.reviewer_endpoint into --endpoint for endpoint-capable
          // runners): the incumbent's named endpoint must NOT survive onto a
          // substituted reviewer. Fallback runners (codex/agy/grok/claude-native)
          // are not endpoint-capable, but blanking keeps the invariant explicit and
          // guards against a future endpoint-capable fallback rung.
          ...(Object.prototype.hasOwnProperty.call(roster, 'reviewer_endpoint')
            ? { reviewer_endpoint: '' }
            : {}),
        };
      } else {
        const startedAt = this.now();
        ledger.push(this.ledgerEntry('reviewer_family', 'blocked', startedAt));
        return {
          status: 'blocked',
          phase: 'reviewer_family',
          reason: 'reviewer and implementer must be different families',
          verdict: null,
          roster,
          resolveResult,
          reviewResult: null,
          review: null,
          reviewArgs,
          riskClassification,
          ledger,
        };
      }
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

    const injectedChecklists = (dynamicReviewRisk && classification && Array.isArray(classification.checklists))
      ? classification.checklists
      : [];
    const dispatchIdentity = input.ledger && input.runId
      ? {
        ledger: input.ledger,
        runId: input.runId,
        stage: input.reviewStage || 'review',
      }
      : null;

    try {
      reviewArgs = buildReviewArgs({
        roster,
        diffFile: input.diffFile,
        specFile: input.specFile,
        // Pass the caller value THROUGH (not coerced) so buildReviewArgs' validateExtraArgs
        // surfaces a non-array as "extraReviewArgs must be an array" (pre-R5 contract).
        extraReviewArgs: Object.prototype.hasOwnProperty.call(input, 'extraReviewArgs')
          ? input.extraReviewArgs
          : [],
        checklists: injectedChecklists,
        dispatchIdentity,
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
        riskClassification,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    return {
      status: reviewResult.result.status,
      verdict: parsed.verdict,
      riskClassification,
      reviewRisk,
      roster,
      resolveResult,
      reviewResult,
      review: parsed,
      reviewRisk,
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

    let resolvedImplementationStage;
    let campaignLifecycleRoot = null;
    try {
      resolvedImplementationStage = resolveImplementationLedgerStage({
        implementationStage: input.implementationStage,
        implementationRound: input.implementationRound,
        runId: input.runId,
      });
      if (input.campaignContractFile) {
        campaignLifecycleRoot = deriveCampaignLifecycleRoot({
          campaignContractFile: input.campaignContractFile,
          campaignContractDigest: input.campaignContractDigest,
          runId: input.runId,
          cwd: resolvedTaskCwd,
        });
      }
      implementationArgs = buildImplementationArgs({
        roster,
        promptFile: input.promptFile,
        branch: input.branch,
        base: input.base,
        cwd: resolvedTaskCwd,
        extraImplementationArgs: Object.prototype.hasOwnProperty.call(input, 'extraImplementationArgs')
          ? input.extraImplementationArgs
          : [],
        dispatchIdentity: input.ledger && input.runId
          ? {
            ledger: input.ledger,
            runId: input.runId,
            stage: resolvedImplementationStage,
          }
          : null,
        campaignContractFile: input.campaignContractFile || null,
        campaignContractDigest: input.campaignContractDigest || null,
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
    const implementationBaseEnv = Object.prototype.hasOwnProperty.call(
      implementationOptionsInput,
      'env',
    )
      ? implementationOptionsInput.env
      : process.env;
    if (campaignLifecycleRoot
        && (!implementationBaseEnv || typeof implementationBaseEnv !== 'object'
          || Array.isArray(implementationBaseEnv))) {
      const blockedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', blockedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        reason: 'managed implementation env must be an object',
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs,
        implementation: null,
        ledger,
      };
    }
    const inheritedDispatchDepth = campaignLifecycleRoot
      ? (
        implementationBaseEnv.AUTOPILOT_DISPATCH_DEPTH
        || '1'
      )
      : null;
    const inheritedDispatchDepthText = String(inheritedDispatchDepth);
    const inheritedDispatchDepthNumber = Number(inheritedDispatchDepthText);
    const managedDispatchDepth = campaignLifecycleRoot
      && /^[1-9][0-9]*$/.test(inheritedDispatchDepthText)
      && Number.isSafeInteger(inheritedDispatchDepthNumber)
      && inheritedDispatchDepthNumber <= 1_000_000
      ? inheritedDispatchDepthText
      : '1';
    const managedTraceParent = campaignLifecycleRoot
      ? (
        implementationBaseEnv.AUTOPILOT_PARENT_RUN_ID
        || campaignLifecycleRoot
      )
      : null;
    const managedTraceRoot = campaignLifecycleRoot
      ? (
        implementationBaseEnv.AUTOPILOT_ROOT_RUN_ID
        || managedTraceParent
      )
      : null;
    const implementationOptions = {
      ...implementationOptionsInput,
      cwd: resolvedTaskCwd,
      ...(campaignLifecycleRoot ? {
        env: {
          ...implementationBaseEnv,
          AUTOPILOT_PARENT_RUN_ID: managedTraceParent,
          AUTOPILOT_ROOT_RUN_ID: managedTraceRoot,
          AUTOPILOT_WORKTREE_ROOT_RUN_ID: campaignLifecycleRoot,
          AUTOPILOT_DISPATCH_DEPTH: managedDispatchDepth,
        },
      } : {}),
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
        stage: resolvedImplementationStage,
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

    const misplacedWriteEvidence = parsed
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
        // Observability passthrough (Stage 1): usage parsed from the HARNESS event stream
        // by dispatch-status.js (never worker self-report); null on older dispatchers.
        run_id: parsed && parsed.run_id !== undefined ? parsed.run_id : null,
        usage: parsed && parsed.usage !== undefined ? parsed.usage : null,
        wall_secs: parsed && Number.isInteger(parsed.wall_secs) ? parsed.wall_secs : null,
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
      const engineUnavailable = parsed
        ? resolveEngineUnavailableDirective(roster, parsed.status, parsed.error)
        : null;
      if (engineUnavailable) {
        ledger.push(this.ledgerEntry('engine_unavailable_policy', engineUnavailable.action, this.now(), {
          policy: engineUnavailable.policy,
          error_class: engineUnavailable.error_class,
          dispatch_status: engineUnavailable.dispatch_status,
        }));
      }
      return {
        status: 'blocked',
        phase: 'dispatch_implementation',
        reason: `implementation status ${parsed && parsed.status ? parsed.status : null}`,
        roster,
        resolveResult,
        implementationResult,
        implementationArgs,
        implementation: parsed,
        engine_unavailable: engineUnavailable,
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
    if (input.legacyUnmanaged === true
        && (input.campaignManaged === true || Boolean(input.campaignContract))) {
      const startedAt = this.now();
      return {
        status: 'blocked',
        phase: 'campaign_contract',
        reason: '--legacy-unmanaged conflicts with managed campaign input',
        rounds: 0,
        verdict: null,
        roster: input.roster || null,
        resolveResult: null,
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
        ledger: [
          this.ledgerEntry('campaign_contract', 'blocked', startedAt, {
            rejection_code: 'campaign_mode_conflict',
          }),
        ],
        campaign_control: {
          status: 'campaign_mode_conflict',
          deprecated: true,
          removal_release: 'v2.35.0',
          removal_deadline: '2026-08-31',
        },
      };
    }
    if (input.legacyUnmanaged === true) {
      return this.runLegacyImplementationReviewLoop(input);
    }
    if (input.campaignContract) {
      return this._runImplementationReviewLoop(input);
    }
    return this._runImplementationReviewLoop({
      ...input,
      campaignManaged: true,
    });
  }

  runLegacyImplementationReviewLoop(input = {}) {
    const level = String(process.env.AUTOPILOT_LEVEL || '').toLowerCase();
    if (level === 'l5' || level === 'l6') {
      const startedAt = this.now();
      return {
        status: 'blocked',
        phase: 'campaign_contract',
        reason: '--legacy-unmanaged is prohibited for L5/L6',
        rounds: 0,
        verdict: null,
        roster: input.roster || null,
        resolveResult: null,
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
        ledger: [
          this.ledgerEntry('campaign_contract', 'blocked', startedAt, {
            rejection_code: 'legacy_unmanaged_rejected',
          }),
        ],
        campaign_control: {
          status: 'legacy_unmanaged_rejected',
          deprecated: true,
          removal_release: 'v2.35.0',
          removal_deadline: '2026-08-31',
        },
      };
    }
    return this._runImplementationReviewLoop({
      ...input,
      campaignManaged: false,
      campaignContract: null,
      legacyUnmanaged: true,
    });
  }

  _runManagedCampaignComposition({
    input,
    campaignControl,
    roster,
    resolveResult,
    loopCwd,
    promptFile,
    branch,
    base,
    verifyCmd,
    convergenceVerdict,
    requireQualifiedReviewer,
    ledger,
    releaseCampaignNoEffect,
  }) {
    const implementationChain = [];
    const reviewChain = [];
    const verificationCache = new Map();
    const convergenceArtifacts = [];
    const durableJournal = campaignControl.generation_claim.durable_journal === true;
    const resumeCandidate = campaignControl.generation_claim.resume_candidate || null;
    const resumeReviewDigest = campaignControl.generation_claim.resume_review_digest || null;
    let scopeSession = null;
    let currentBase = base;
    let repairPromptFile = promptFile;
    let latestReview = null;
    let latestAdjudication = null;
    let latestVerification = null;
    let implementationRound = 0;
    let resumeSetupError = null;
    let lifecycleSetupError = null;
    let lifecycleReceiptRef = 'unknown';

    if (input.lifecycleReceipt) {
      const receiptPath = path.resolve(loopCwd, input.lifecycleReceipt);
      try {
        const inspected = this.campaignLifecycleInspector({
          repo: loopCwd,
          rootRunId: campaignControl.campaign_id,
          receipt: receiptPath,
        });
        if (!inspected || inspected.status !== 'valid'
            || !/^[0-9a-f]{64}$/u.test(inspected.receipt_digest || '')) {
          throw new Error('lifecycle receipt is not valid for this campaign root');
        }
        lifecycleReceiptRef = {
          path: receiptPath,
          root_run_id: campaignControl.campaign_id,
          receipt_digest: inspected.receipt_digest,
        };
      } catch (error) {
        lifecycleSetupError = error.message || String(error);
      }
    }
    if (lifecycleSetupError !== null) {
      releaseCampaignNoEffect({
        owner: 'worktree_lifecycle',
        status: 'rejected',
        code: 'campaign_lifecycle_receipt_invalid',
        reason: lifecycleSetupError,
      });
      return {
        status: 'blocked',
        phase: 'campaign_lifecycle_receipt',
        reason: lifecycleSetupError,
        rounds: 0,
        verdict: null,
        roster,
        resolveResult,
        base,
        implementation: null,
        review: null,
        implementationChain,
        reviewChain,
        ledger,
      };
    }

    const recordCampaignEvent = (eventInput) => {
      if (!durableJournal) return null;
      const appended = this.campaignEventAppender({
        repo: loopCwd,
        campaignControl,
        observedAt: this.now(),
        ...eventInput,
      });
      if (!appended || appended.status !== 'appended' || !appended.state) {
        throw new Error('campaign event appender did not return durable state');
      }
      campaignControl.initial_state = appended.state;
      return appended;
    };
    const recordGreenVerification = (receipt, repairGeneration) => {
      if (resumeReviewDigest
          && campaignControl.initial_state.phase === CAMPAIGN_STATES.ADJUDICATING) {
        return;
      }
      recordCampaignEvent({
        eventType: CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
        generation: repairGeneration,
        stageIdentity: `campaign-verification:${repairGeneration}`,
        payload: {
          passed: true,
          evidence_digest: receipt.receipt_digest,
        },
        artifactReference: {
          kind: 'verification_receipt',
          digest: receipt.receipt_digest,
        },
      });
    };

    if (resumeCandidate) {
      try {
        scopeSession = createCampaignScopeSession({
          contract: campaignControl.contract,
          base,
          implementationSha: resumeCandidate.scope_implementation_sha,
        });
        currentBase = resumeCandidate.commit;
        implementationRound = campaignControl.initial_state.generation + 1;
      } catch (error) {
        resumeSetupError = error.message || String(error);
      }
    }

    const performReview = ({ candidate, scope, repair_generation: repairGeneration }) => {
      let diffFile;
      try {
        diffFile = this.diffProvider({
          base,
          commit: candidate.commit,
          branch: candidate.branch,
          round: repairGeneration + 1,
          currentBase,
          cwd: loopCwd,
        });
      } catch (error) {
        return { reviewed: false, reason: error.message || String(error) };
      }
      const budgetAt = this.now();
      const budget = campaignWallBudgetStatus(campaignControl, budgetAt);
      if (budget.exhausted) {
        return {
          reviewed: false,
          phase: 'campaign_wall_budget',
          reason: 'campaign wall budget exhausted before review',
        };
      }
      const reviewed = this.reviewDiff({
        diffFile,
        specFile: promptFile,
        roster,
        rosterArgs: Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
          ? input.rosterArgs
          : ['--check-scorecard'],
        resolverOptions: {
          ...(input.resolverOptions || {}),
          cwd: loopCwd,
        },
        dynamicReviewRisk: false,
        extraReviewArgs: input.extraReviewArgs || [],
        sourceTrust: input.sourceTrust,
        oracleAvailable: input.oracleAvailable,
        securitySurface: input.securitySurface,
        samplingRatio: input.samplingRatio,
        samplingSeed: input.samplingSeed,
        classifyRulesFile: input.classifyRulesFile,
        implementerEngine: roster.implementer_engine,
        runId: campaignControl.campaign_id,
        ledger: campaignControl.generation_claim.ledger,
        reviewStage: scope === 'final'
          ? 'campaign-final-review'
          : `campaign-review#r${repairGeneration + 1}`,
        reviewOptions: {
          ...(input.reviewOptions || {}),
          cwd: loopCwd,
        },
        requireQualifiedReviewer,
      });
      ledger.push(...reviewed.ledger);
      reviewChain.push(reviewed);
      latestReview = reviewed;
      if (reviewed.status !== 'reviewed') {
        return {
          reviewed: false,
          reason: reviewed.reason || `review status ${reviewed.status}`,
          raw: reviewed,
        };
      }
      let findings = reviewed.review && typeof reviewed.review.findings === 'string'
        ? reviewed.review.findings
        : '';
      if (findings.trim().length > 0) {
        const normalized = normalizeProductReviewFindings(findings);
        if (normalized.status !== 'normalized') {
          return {
            reviewed: false,
            phase: 'product_review_normalization',
            reason: normalized.reason,
            raw: reviewed,
          };
        }
        findings = normalized.canonical;
      }
      const reviewDigest = campaignCanonicalDigest({
        verdict: reviewed.verdict,
        findings,
        scope,
        tree_sha: candidate.tree_sha,
      });
      if (scope !== 'final'
          && resumeReviewDigest
          && campaignControl.initial_state.phase === CAMPAIGN_STATES.ADJUDICATING) {
        if (reviewDigest !== resumeReviewDigest) {
          return {
            reviewed: false,
            phase: 'campaign_resume_review',
            reason: 'replayed focused review does not match the durable review digest',
            raw: reviewed,
          };
        }
      } else if (scope !== 'final') {
        try {
          recordCampaignEvent({
            eventType: CAMPAIGN_EVENTS.REVIEW_COMPLETED,
            generation: repairGeneration,
            stageIdentity: `campaign-review:${repairGeneration}`,
            payload: { review_digest: reviewDigest },
            artifactReference: {
              kind: 'product_review',
              digest: reviewDigest,
            },
          });
        } catch (error) {
          return {
            reviewed: false,
            phase: 'campaign_event_journal',
            reason: error.message || String(error),
            raw: reviewed,
          };
        }
      }
      return {
        reviewed: true,
        verdict: reviewed.verdict,
        findings,
        review_digest: reviewDigest,
        raw: reviewed,
      };
    };

    const maxRepairGenerations = Math.min(
      campaignControl.contract.max_repair_generations,
      Math.max(0, roster.loop_max_rounds - 1),
    );
    const composition = this.campaignComposer({
      maxRepairGenerations,
      lifecycleReceiptRef,
      resume: resumeCandidate && !resumeSetupError
        ? {
          phase: campaignControl.initial_state.phase,
          repair_generation: campaignControl.initial_state.generation,
          candidate: resumeCandidate,
        }
        : null,
    }, {
      preflight: () => ({
        passed: resumeSetupError === null && lifecycleSetupError === null,
        reason: resumeSetupError || lifecycleSetupError,
        intake: campaignControl,
      }),
      implement: ({
        kind,
        repair_generation: repairGeneration,
        repair_finding_ids: findingIds,
        repair_findings: repairFindings,
      }) => {
        const budgetAt = this.now();
        const budget = campaignMutationBudgetStatus(campaignControl, budgetAt);
        if (budget.exhausted) {
          if (implementationChain.length === 0) {
            releaseCampaignNoEffect({
              owner: 'campaign_generation',
              status: 'rejected',
              code: 'campaign_budget_exhausted',
              reason: 'campaign has no mutation budget remaining',
            });
          }
          return {
            committed: false,
            phase: 'campaign_wall_budget',
            reason: 'campaign mutation budget exhausted',
          };
        }
        implementationRound += 1;
        const currentBranch = implementationRound === 1
          ? branch
          : buildRepairBranchName({
            branch,
            round: implementationRound,
            previousCommit: currentBase,
          });
        if (kind !== 'initial') {
          const repairReview = {
            verdict: kind === 'vertical_repair'
              ? 'VERTICAL-ACCEPTANCE-FAILED'
              : 'AUTHORIZED-REPAIR',
            review: {
              findings: JSON.stringify(repairFindings),
            },
          };
          try {
            repairPromptFile = this.repairPromptWriter({
              promptFile,
              round: implementationRound,
              base,
              previousCommit: currentBase,
              commit: currentBase,
              review: repairReview,
            });
          } catch (error) {
            return { committed: false, reason: error.message || String(error) };
          }
        }
        try {
          recordCampaignEvent({
            eventType: kind === 'initial'
              ? CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED
              : CAMPAIGN_EVENTS.REPAIR_STARTED,
            generation: repairGeneration,
            stageIdentity: `campaign-mutation:${repairGeneration}`,
            payload: { sealed_contract: true },
            artifactReference: null,
          });
        } catch (error) {
          return {
            committed: false,
            phase: 'campaign_event_journal',
            reason: error.message || String(error),
          };
        }
        const implementation = this.implementTask({
          promptFile: repairPromptFile,
          branch: currentBranch,
          base: currentBase,
          roster,
          runId: campaignControl.campaign_id,
          ledger: campaignControl.generation_claim.ledger,
          implementationRound,
          implementationStage: 'campaign-implementation',
          campaignContractFile: campaignControl.contract_path,
          campaignContractDigest: campaignControl.contract_digest,
          resultJson: input.resultJson,
          gitDir: input.gitDir,
          extraImplementationArgs: Object.prototype.hasOwnProperty.call(
            input,
            'extraImplementationArgs',
          ) ? input.extraImplementationArgs : [],
          implementationOptions: {
            ...(input.implementationOptions || {}),
            cwd: loopCwd,
          },
        });
        ledger.push(...implementation.ledger);
        implementationChain.push(implementation);
        if (implementation.status !== 'committed') {
          if (implementationChain.length === 1 && isCampaignPreSpendRejection(implementation)) {
            releaseCampaignNoEffect({
              owner: 'implementation_dispatch',
              status: 'rejected',
              code: 'campaign_leaf_pre_spend_rejected',
              reason: implementation.reason || 'implementation pre-spend rejection',
            });
          }
          return {
            committed: false,
            reason: implementation.reason || `implementation status ${implementation.status}`,
            raw: implementation,
          };
        }
        const commit = implementation.implementation.commit;
        let treeSha;
        let writerFence;
        try {
          treeSha = this.campaignTreeResolver({
            repo: loopCwd,
            commit,
          });
          writerFence = createWriterFence({
            campaignId: campaignControl.campaign_id,
            stageIdentity: implementationRound === 1
              ? 'campaign-implementation'
              : `campaign-implementation#r${implementationRound}`,
            candidateCommit: commit,
            candidateTreeSha: treeSha,
            implementationResult: implementation,
          });
        } catch (error) {
          return {
            committed: false,
            phase: 'campaign_writer_fence',
            reason: error.message || String(error),
          };
        }
        if (implementationRound === 1) {
          try {
            scopeSession = createCampaignScopeSession({
              contract: campaignControl.contract,
              base,
              implementationSha: commit,
            });
          } catch (error) {
            return { committed: false, reason: error.message || String(error) };
          }
        }
        currentBase = commit;
        return {
          committed: true,
          tree_sha: treeSha,
          commit,
          branch: currentBranch,
          writer_fence: writerFence,
          authorized_repair_finding_ids: findingIds,
          raw: implementation,
        };
      },
      scopeCheck: ({ checkpoint, candidate }) => {
        let receipt = this.campaignScopeChecker({
          session: scopeSession,
          repo: loopCwd,
          head: candidate.commit,
          checkpoint,
        });
        ledger.push(this.ledgerEntry(
          'campaign_scope',
          receipt.passed === true ? 'passed' : 'blocked',
          this.now(),
          {
            checkpoint,
            receipt_digest: receipt.receipt_digest || null,
          },
        ));
        if (durableJournal
            && receipt.passed === true
            && new Set(['after_initial_mutation', 'after_repair_mutation']).has(checkpoint)) {
          try {
            const state = campaignControl.initial_state;
            const eventType = state.phase === CAMPAIGN_STATES.IMPLEMENTING
              ? CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED
              : CAMPAIGN_EVENTS.REPAIR_COMPLETED;
            recordCampaignEvent({
              eventType,
              generation: state.generation,
              stageIdentity: state.live_lease.stage_identity,
              usage: {
                changed_files: Array.isArray(receipt.changed_files)
                  ? receipt.changed_files.length
                  : state.usage.changed_files,
                churn: Number.isSafeInteger(receipt.total_churn)
                  ? receipt.total_churn
                  : state.usage.churn,
              },
              payload: {
                scope_check_passed: true,
                scope_check_digest: receipt.receipt_digest,
              },
              artifactReference: {
                kind: 'git_candidate',
                commit: candidate.commit,
                tree_sha: candidate.tree_sha,
                branch: candidate.branch,
                base,
                writer_fence: candidate.writer_fence,
              },
            });
            if (this.campaignPostCommitCheckpoint) {
              this.campaignPostCommitCheckpoint({
                campaign_id: campaignControl.campaign_id,
                candidate: { ...candidate },
                checkpoint,
                generation: campaignControl.initial_state.generation,
                phase: campaignControl.initial_state.phase,
              });
            }
          } catch (error) {
            receipt = {
              ...receipt,
              passed: false,
              reason: error.message || String(error),
              phase: 'campaign_event_journal',
            };
          }
        }
        return receipt;
      },
      verify: ({ candidate, repair_generation: repairGeneration }) => {
        const budget = campaignWallBudgetStatus(campaignControl, this.now());
        if (budget.exhausted) {
          return {
            passed: false,
            retriable: false,
            phase: 'campaign_wall_budget',
            reason: 'campaign wall budget exhausted before verification',
            receipt_digest: campaignCanonicalDigest({
              tree_sha: candidate.tree_sha,
              elapsed_seconds: budget.elapsed_seconds,
            }),
          };
        }
        const verificationEnv = input.verificationEnv || process.env;
        const request = createVerificationRequest({
          treeSha: candidate.tree_sha,
          verifyCmd,
          env: verificationEnv,
          envAllowlist: input.verificationEnvAllowlist,
        });
        const cached = verificationCache.get(request.request_digest);
        if (reusableGreenReceipt(cached, request)) {
          try {
            recordGreenVerification(cached, repairGeneration);
          } catch (error) {
            return {
              passed: false,
              retriable: false,
              phase: 'campaign_event_journal',
              reason: error.message || String(error),
              receipt_digest: cached.receipt_digest,
            };
          }
          latestVerification = cached;
          return {
            passed: true,
            cached: true,
            receipt_digest: cached.receipt_digest,
            receipt: cached,
          };
        }
        const startedAt = this.now();
        let addResult;
        let worktree = null;
        let parent = null;
        let worktreeAdded = false;
        let checkoutAttestation = null;
        let verifyResult = null;
        let setupReason = null;
        let cleanupReason = null;
        try {
          addResult = this.gitWorktreeAdd({
            commit: candidate.commit,
            cwd: loopCwd,
            round: repairGeneration + 1,
            branch: candidate.branch,
          });
          worktree = addResult && addResult.worktree;
          parent = addResult && addResult.parent;
          setupReason = worktreeResultBlocked(addResult);
          if (!setupReason) {
            worktreeAdded = true;
            try {
              checkoutAttestation = createDetachedCheckoutAttestation({
                candidateCommit: candidate.commit,
                candidateTreeSha: candidate.tree_sha,
                worktreeResult: addResult,
              });
            } catch (error) {
              setupReason = error.message || String(error);
            }
          }
          if (!setupReason) {
            verifyResult = this.verifyCommandRunner({
              verifyCmd,
              cwd: worktree,
              env: verificationEnv,
              round: repairGeneration + 1,
              commit: candidate.commit,
              branch: candidate.branch,
            });
          }
        } catch (error) {
          setupReason = error.message || String(error);
        } finally {
          if (worktree && worktreeAdded) {
            try {
              cleanupReason = worktreeResultBlocked(this.gitWorktreeRemove({
                worktree,
                cwd: loopCwd,
                round: repairGeneration + 1,
                commit: candidate.commit,
                branch: candidate.branch,
              }));
            } catch (error) {
              cleanupReason = error.message || String(error);
            }
          }
          if (parent) {
            try {
              this.verifyWorktreeCleanup({
                targetPath: parent,
                cwd: loopCwd,
                round: repairGeneration + 1,
                commit: candidate.commit,
                branch: candidate.branch,
                reason: 'campaign_verify_parent_cleanup',
              });
            } catch (error) {
              cleanupReason = cleanupReason || error.message || String(error);
            }
          }
        }
        if (setupReason || !verifyResult || verifyResultBlocked(verifyResult)) {
          return {
            passed: false,
            retriable: false,
            phase: 'vertical_verification_setup',
            reason: setupReason || verifyResultBlocked(verifyResult) || 'verification unavailable',
            receipt_digest: campaignCanonicalDigest({
              tree_sha: candidate.tree_sha,
              setup_reason: setupReason,
            }),
          };
        }
        let receipt;
        try {
          receipt = createVerificationReceipt({
            campaignId: campaignControl.campaign_id,
            request,
            exitStatus: verifyResult.status,
            startedAt,
            endedAt: this.now(),
            writerFence: candidate.writer_fence,
            checkoutAttestation,
            executedArgv: verifyResult.executed_argv,
            stdout: verifyResult.stdout,
            stderr: verifyResult.stderr,
          });
        } catch (error) {
          ledger.push(this.ledgerEntry(
            'campaign_verification',
            'blocked',
            startedAt,
            {
              tree_sha: candidate.tree_sha,
              attestation_error: error.message || String(error),
            },
          ));
          return {
            passed: false,
            retriable: false,
            phase: 'verification_attestation',
            reason: error.message || String(error),
            receipt_digest: campaignCanonicalDigest({
              tree_sha: candidate.tree_sha,
              attestation_error: error.message || String(error),
            }),
          };
        }
        if (receipt.verdict === 'GREEN') verificationCache.set(request.request_digest, receipt);
        latestVerification = receipt;
        ledger.push(this.ledgerEntry(
          'campaign_verification',
          receipt.verdict === 'GREEN' ? 'passed' : 'failed',
          startedAt,
          {
            tree_sha: candidate.tree_sha,
            receipt_digest: receipt.receipt_digest,
            cached: false,
            cleanup_warning: cleanupReason,
          },
        ));
        if (receipt.verdict === 'GREEN') {
          try {
            recordGreenVerification(receipt, repairGeneration);
          } catch (error) {
            return {
              passed: false,
              retriable: false,
              phase: 'campaign_event_journal',
              reason: error.message || String(error),
              receipt_digest: receipt.receipt_digest,
              receipt,
            };
          }
        }
        return {
          passed: receipt.verdict === 'GREEN',
          cached: false,
          receipt_digest: receipt.receipt_digest,
          receipt,
        };
      },
      review: (reviewInput) => performReview(reviewInput),
      adjudicate: ({ review, repair_generation: repairGeneration, final }) => {
        let dispositionAuthority = null;
        if (typeof this.campaignDispositionProvider === 'function') {
          try {
            dispositionAuthority = this.campaignDispositionProvider({
              review,
              repairGeneration,
              final,
              contract: campaignControl.contract,
              campaignId: campaignControl.campaign_id,
              contractDigest: campaignControl.contract_digest,
              cwd: loopCwd,
            });
          } catch (error) {
            return {
              registry_complete: false,
              repair_gate_passed: false,
              reason: error.message || String(error),
              must_fix_now: [],
              follow_up: [],
              rejected: [],
            };
          }
        }
        const adjudication = this.campaignAdjudicator({
          review,
          repairGeneration,
          final,
          convergenceVerdict,
          dispositionAuthority,
          contract: campaignControl.contract,
          cwd: loopCwd,
          now: this.now(),
        });
        latestAdjudication = adjudication;
        return adjudication;
      },
      convergence: ({
        repair_generation: repairGeneration,
        next_repair_generation: nextGeneration,
        reason,
      }) => {
        const budget = campaignWallBudgetStatus(campaignControl, this.now());
        convergenceArtifacts.push({
          artifact_generation: repairGeneration + 1,
          tests_executed: true,
          ship_ready: reason === 'acceptance',
          convergence_verdict: reason === 'acceptance' ? 'PASS' : 'REWORK',
        });
        const gate = evaluateLoopConvergence(convergenceArtifacts, {
          // Artifact generation one is the initial candidate; the contract cap
          // counts repairs after that candidate.
          generationCap: maxRepairGenerations + 1,
        });
        let passed = !budget.exhausted && gate.verdict === 'PASS';
        let journalReason = null;
        if (passed && reason !== 'acceptance' && Number.isSafeInteger(nextGeneration)) {
          const registryDigest = reason === 'review_findings'
            && latestAdjudication
            && /^[0-9a-f]{64}$/.test(latestAdjudication.registry_digest || '')
            ? latestAdjudication.registry_digest
            : campaignCanonicalDigest({
              reason,
              verification_receipt_digest: latestVerification
                ? latestVerification.receipt_digest
                : null,
            });
          const repairGateDigest = campaignCanonicalDigest({
            reason,
            registry_digest: registryDigest,
            next_generation: nextGeneration,
          });
          try {
            recordCampaignEvent({
              eventType: CAMPAIGN_EVENTS.REPAIR_AUTHORIZED,
              generation: nextGeneration,
              stageIdentity: `campaign-repair-authorization:${nextGeneration}`,
              payload: {
                registry_complete: true,
                registry_digest: registryDigest,
                repair_gate_passed: true,
                repair_gate_digest: repairGateDigest,
              },
              artifactReference: {
                kind: 'finding_registry',
                digest: registryDigest,
              },
            });
          } catch (error) {
            passed = false;
            journalReason = error.message || String(error);
          }
        }
        return {
          passed,
          reason: passed
            ? null
            : journalReason || 'campaign convergence or wall budget gate tripped',
          generation_cap: maxRepairGenerations + 1,
          next_repair_generation: nextGeneration,
          gate,
        };
      },
      finalPanel: (reviewInput) => performReview({ ...reviewInput, scope: 'final' }),
    });

    if (durableJournal && new Set(['ready', 'follow_up']).has(composition.status)) {
      const terminalEvent = composition.status === 'ready'
        ? CAMPAIGN_EVENTS.TERMINAL_READY
        : CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP;
      const reason = composition.status === 'ready'
        ? 'campaign acceptance verified'
        : 'campaign completed with bounded follow-up';
      const registryDigest = latestAdjudication
        && /^[0-9a-f]{64}$/.test(latestAdjudication.registry_digest || '')
        ? latestAdjudication.registry_digest
        : campaignCanonicalDigest([]);
      const payload = {
        reason,
        registry_complete: true,
        registry_digest: registryDigest,
        convergence_digest: composition.receipt_digest,
        lifecycle_receipt_ref: composition.lifecycle_receipt_ref,
      };
      if (terminalEvent === CAMPAIGN_EVENTS.TERMINAL_FOLLOW_UP) {
        payload.follow_up_digest = campaignCanonicalDigest({
          follow_up: composition.follow_up || [],
          unresolved_final_findings: composition.unresolved_final_findings || [],
        });
      }
      try {
        recordCampaignEvent({
          eventType: terminalEvent,
          generation: campaignControl.initial_state.generation,
          stageIdentity: `campaign-terminal:${campaignControl.initial_state.generation}`,
          payload,
          artifactReference: {
            kind: 'campaign_terminal',
            digest: composition.receipt_digest,
          },
        });
        campaignControl.completion = this.campaignAdmissionCompleter({
          repo: loopCwd,
          campaignControl,
        });
      } catch (error) {
        return {
          status: 'blocked',
          phase: 'campaign_terminal_journal',
          reason: error.message || String(error),
          rounds: implementationChain.length,
          verdict: latestReview ? latestReview.verdict : null,
          roster,
          resolveResult,
          base,
          implementation: implementationChain.at(-1) || null,
          review: latestReview,
          implementationChain,
          reviewChain,
          campaign_receipt: composition,
          ledger,
        };
      }
    }

    const lastImplementation = implementationChain.at(-1) || null;
    const converged = composition.status === 'ready';
    return {
      status: converged ? 'converged' : (
        composition.status === 'follow_up' ? 'follow_up' : 'blocked'
      ),
      phase: converged ? 'campaign_terminal_ready' : composition.phase || 'campaign_terminal',
      reason: converged ? null : composition.reason || 'campaign requires follow-up',
      rounds: implementationChain.length,
      verdict: latestReview ? latestReview.verdict : null,
      roster,
      resolveResult,
      base,
      implementation: lastImplementation,
      review: latestReview,
      implementationChain,
      reviewChain,
      campaign_receipt: composition,
      ledger,
    };
  }

  _runImplementationReviewLoop(input = {}) {
    // Risk-triggered dynamic review is OPT-IN in the loop (default off): the review step
    // reuses the already-resolved roster and stays byte-compatible with the pre-R5 contract
    // unless the caller explicitly passes dynamicReviewRisk: true.
    const dynamicReviewRisk = input.dynamicReviewRisk === true;
    const ledger = [];
    let lifecycleObservation = null;
    let promptFile = input.promptFile;
    const branch = input.branch;
    const base = input.base;
    let loopCwd = this.cwd;
    let verifyCmdProvided = Object.prototype.hasOwnProperty.call(input, 'verifyCmd')
      && input.verifyCmd !== undefined
      && input.verifyCmd !== null;
    let verifyCmd = input.verifyCmd;
    const noVerifyFirst = input.noVerifyFirst === true;
    const campaignRequested = input.campaignManaged === true || Boolean(input.campaignContract);
    let campaignControl = input.legacyUnmanaged === true
      ? {
        status: 'legacy_unmanaged',
        deprecated: true,
        removal_release: 'v2.35.0',
        removal_deadline: '2026-08-31',
        full_enforcement: false,
      }
      : null;
    let campaignMaxRounds = null;
    let campaignDispatchIdentity = null;
    const verifyState = {
      verifyCmdProvided,
      verifyFirstSignalUnused: false,
      convergenceReason: null,
      ratchetRevertedRounds: 0,
      advisoryFindings: [],
      bestCommit: null,
    };
    const finish = (result) => {
      const controlled = campaignControl ? { ...result, campaign_control: campaignControl } : result;
      const output = resultWithVerificationFields(controlled, verifyState);
      return lifecycleObservation ? lifecycleObservation.finalize(output) : output;
    };

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
    if (campaignRequested && input.noReviewSpec === true) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('campaign_review_spec', 'blocked', startedAt));
      return finish({
        status: 'blocked',
        phase: 'campaign_review_spec',
        reason: 'managed campaign review requires the frozen task specification',
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

    if (!campaignRequested) {
      lifecycleObservation = createEngineLifecycleObservationSession({
        observer: this.lifecycleObserver,
        config: input.lifecycleObservation,
        promptFile,
        base,
        branch,
        verifyCmd: verifyCmdProvided ? verifyCmd : null,
        expectedEngineRunId: input.runId,
      });
      if (lifecycleObservation) lifecycleObservation.attach(ledger);
    }

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
    if (Object.prototype.hasOwnProperty.call(input, 'maxRounds')
        && input.maxRounds !== undefined
        && input.maxRounds !== null) {
      maxRounds = typeof input.maxRounds === 'string'
        ? Number(input.maxRounds)
        : input.maxRounds;
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
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
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
        implementation: null,
        review: null,
        implementationChain: [],
        reviewChain: [],
        ledger,
      });
    }

    if (requireQualifiedReviewer && !reviewerQualificationViable(roster)) {
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

    const resumeImplementation = input.resume === true && !campaignRequested;
    let resumeTipSha = null;
    if (resumeImplementation) {
      const startedAt = this.now();
      let inspect;
      try {
        inspect = this.gitResumeInspect({ base, branch, cwd: loopCwd });
      } catch (error) {
        inspect = { error, exists: false, tipSha: null, baseAncestor: false };
      }
      const invalidReason = resumeInspectBlocked(inspect, { base, branch });
      if (invalidReason) {
        ledger.push(this.ledgerEntry('resume_precheck', 'resume_invalid', startedAt, {
          branch,
          base,
        }));
        return finish({
          status: 'blocked',
          phase: 'resume_invalid',
          reason: invalidReason,
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
      resumeTipSha = inspect.tipSha;
      ledger.push(this.ledgerEntry('resume_precheck', 'resumed', startedAt, {
        branch,
        base,
        commit: resumeTipSha,
      }));
    }

    if (campaignRequested) {
      const intakeStartedAt = this.now();
      let intake;
      try {
        // Resolve project Mission enforcement mode. Enforce mode requires a
        // trusted atomic Mission state store and the sealed campaign's
        // mission_grant_ref before any implementation dispatch; missing
        // store/ref fails closed here rather than after spend. Runtime input
        // cannot override the constructor's store/factory.
        let missionMode = 'off';
        try {
          missionMode = projectMissionMode(loopCwd);
        } catch (error) {
          intake = {
            status: 'blocked',
            reason: `campaign intake failed closed: ${error.message || String(error)}`,
            rejection: {
              owner: 'mission',
              code: error.code || 'project_governance_invalid',
              reason: error.message || String(error),
            },
            steps: [],
          };
        }
        const missionGrantRef = this.readCampaignMissionGrantRef(
          input.campaignContract,
          loopCwd,
        );
        if (!intake && missionMode === 'enforce') {
          const store = this.missionCampaignStore;
          const hasAtomicStore = store !== null
            && typeof store === 'object'
            && typeof store.load === 'function'
            && typeof store.save === 'function';
          if (!hasAtomicStore) {
            intake = {
              status: 'blocked',
              reason: 'enforce-mode Mission campaign intake requires an atomic Mission state store',
              rejection: {
                owner: 'mission',
                code: 'mission_state_store_required',
                reason: 'atomic Mission state load/compare-and-swap save is required under enforce mode',
              },
              steps: [],
            };
          } else if (typeof missionGrantRef !== 'string') {
            intake = {
              status: 'blocked',
              reason: 'enforce-mode Mission campaign intake requires mission_grant_ref on the campaign contract',
              rejection: {
                owner: 'mission',
                code: 'mission_grant_ref_required',
                reason: 'sealed campaign contract must carry a content-bound mission_grant_ref under enforce mode',
              },
              steps: [],
            };
          }
        }
        if (!intake) {
          const missionAdapters = this.buildMissionCampaignAdapters({
            grant_ref: missionGrantRef,
          });
          intake = this.campaignIntake({
            repo: loopCwd,
            contractPath: input.campaignContract,
            sealPath: input.campaignSeal,
            ledgerPath: input.campaignLedger,
            promptFile,
            branch,
            base,
            verifyCmd: verifyCmdProvided ? verifyCmd : undefined,
            roster,
            resume: input.resume === true,
            observedAt: intakeStartedAt,
          }, missionAdapters || undefined);
        }
      } catch (error) {
        intake = {
          status: 'blocked',
          reason: `campaign intake failed closed: ${error.message || String(error)}`,
          rejection: {
            owner: 'campaign_intake',
            code: error.code || 'campaign_intake_error',
          },
          steps: [],
        };
      }
      campaignControl = intake;
      ledger.push(this.ledgerEntry(
        'campaign_intake',
        intake.status === 'admitted' ? 'admitted' : 'blocked',
        intakeStartedAt,
        {
          campaign_id: intake.campaign_id || null,
          rejection_owner: intake.rejection ? intake.rejection.owner : null,
          rejection_code: intake.rejection ? intake.rejection.code : null,
        },
      ));
      if (intake.status !== 'admitted') {
        return finish({
          status: 'blocked',
          phase: 'campaign_intake',
          reason: intake.reason || 'campaign intake rejected',
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
      if (!verifyCmdProvided) {
        verifyCmd = intake.contract.verify_cmd;
        verifyCmdProvided = true;
        verifyState.verifyCmdProvided = true;
      }
      campaignMaxRounds = (
        intake.contract.max_repair_generations
        - intake.initial_state.generation
        + 1
      );
      campaignDispatchIdentity = {
        runId: intake.campaign_id,
        ledger: intake.generation_claim.ledger,
      };
      maxRounds = Math.min(maxRounds, campaignMaxRounds);
    }

    // Host-injected observation remains additive and starts only after the
    // campaign pre-spend gate has admitted the exact verification command.
    if (!lifecycleObservation) {
      lifecycleObservation = createEngineLifecycleObservationSession({
        observer: this.lifecycleObserver,
        config: input.lifecycleObservation,
        promptFile,
        base,
        branch,
        verifyCmd: verifyCmdProvided ? verifyCmd : null,
        expectedEngineRunId: campaignDispatchIdentity
          ? campaignDispatchIdentity.runId
          : input.runId,
      });
      if (lifecycleObservation) lifecycleObservation.attach(ledger);
    }

    if (roster && roster.verify_first === true && !verifyCmdProvided) {
      const startedAt = this.now();
      verifyState.verifyFirstSignalUnused = true;
      ledger.push(this.ledgerEntry('verify_first_signal', 'unused', startedAt));
    }

    const releaseCampaignNoEffect = (rejection) => {
      if (!campaignControl || campaignControl.status !== 'admitted') return null;
      const releaseStartedAt = this.now();
      let release;
      try {
        release = this.campaignAdmissionReleaser({
          repo: loopCwd,
          campaignControl,
          rejection,
          observedAt: releaseStartedAt,
        });
      } catch (error) {
        release = {
          status: 'blocked',
          error: error.code || error.message || String(error),
        };
      }
      campaignControl = {
        ...campaignControl,
        admission_release: release,
      };
      ledger.push(this.ledgerEntry(
        'campaign_admission_release',
        release.status === 'released' ? 'released' : 'blocked',
        releaseStartedAt,
      ));
      return release;
    };

    const durableResumeCandidate = campaignControl
      && campaignControl.generation_claim
      && campaignControl.generation_claim.resume_candidate;
    if (campaignControl
        && campaignControl.status === 'admitted'
        && campaignControl.initial_state.phase !== CAMPAIGN_STATES.PREPARED
        && (!new Set([
          CAMPAIGN_STATES.VERTICAL_VERIFICATION,
          CAMPAIGN_STATES.ADJUDICATING,
        ]).has(campaignControl.initial_state.phase)
          || !durableResumeCandidate)) {
      const rejection = {
        owner: 'campaign_generation',
        status: 'rejected',
        code: 'campaign_resume_phase_unsupported',
        reason: `campaign resume from ${campaignControl.initial_state.phase} cannot dispatch implementation`,
      };
      releaseCampaignNoEffect(rejection);
      return finish({
        status: 'blocked',
        phase: 'campaign_resume',
        reason: rejection.reason,
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

    if (campaignControl && campaignControl.status === 'admitted') {
      return finish(this._runManagedCampaignComposition({
        input,
        campaignControl,
        roster,
        resolveResult,
        loopCwd,
        promptFile,
        branch,
        base,
        verifyCmd,
        convergenceVerdict,
        requireQualifiedReviewer,
        ledger,
        releaseCampaignNoEffect,
      }));
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
      const implementationBudgetAt = this.now();
      const implementationBudget = campaignMutationBudgetStatus(
        campaignControl,
        implementationBudgetAt,
      );
      if (implementationBudget.exhausted) {
        const rejection = {
          owner: 'campaign_generation',
          status: 'rejected',
          code: 'campaign_wall_budget_exhausted',
          reason: implementationBudget.axis
            ? `campaign has no ${implementationBudget.axis} budget remaining before implementation dispatch`
            : 'campaign has no wall-clock budget remaining before implementation dispatch',
        };
        ledger.push(this.ledgerEntry(
          'campaign_wall_budget',
          'blocked',
          implementationBudgetAt,
          {
            elapsed_seconds: implementationBudget.elapsed_seconds,
            exhausted_axis: implementationBudget.axis || 'wall',
          },
        ));
        if (implementationChain.length === 0) releaseCampaignNoEffect(rejection);
        return finish({
          status: 'blocked',
          phase: 'campaign_wall_budget',
          reason: rejection.reason,
          rounds: round - 1,
          verdict: null,
          roster,
          resolveResult,
          implementation,
          review,
          implementationChain,
          reviewChain,
          ledger,
        });
      }
      const currentBranch = round === 1
        ? branch
        : buildRepairBranchName({
          branch,
          round,
          previousCommit: nextBase,
        });

      if (round === 1 && resumeImplementation) {
        // Synthesize the round-1 outcome from the already-committed branch tip
        // (validated by the resume precheck above) instead of dispatching the
        // implementer. The shared verify+diff+review code below runs unchanged
        // against base..resumeTipSha. Repair rounds (round > 1) fall through to the
        // normal implementTask dispatch.
        const resumeStartedAt = this.now();
        implementation = {
          status: 'committed',
          phase: 'resume_implementation',
          reason: null,
          roster,
          resolveResult: null,
          implementationResult: null,
          implementationArgs: null,
          implementation: {
            status: 'committed',
            runner: 'resume',
            model: 'resume',
            branch: currentBranch,
            base: nextBase,
            commit: resumeTipSha,
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            worktree: null,
            agent_log: null,
            error: null,
            containment: 'plain',
            contained: true,
          },
          ledger: [this.ledgerEntry('resume_implementation', 'resumed', resumeStartedAt, {
            branch: currentBranch,
            base: nextBase,
            commit: resumeTipSha,
          })],
        };
      } else {
        implementation = this.implementTask({
          promptFile: repairPromptFile,
          branch: currentBranch,
          base: nextBase,
          roster,
          runId: campaignDispatchIdentity
            ? campaignDispatchIdentity.runId
            : input.runId,
          ledger: campaignDispatchIdentity
            ? campaignDispatchIdentity.ledger
            : input.ledger,
          implementationRound: round,
          implementationStage: campaignDispatchIdentity
            ? 'campaign-implementation'
            : input.implementationStage,
          campaignContractFile: campaignControl && campaignControl.status === 'admitted'
            ? campaignControl.contract_path
            : null,
          campaignContractDigest: campaignControl && campaignControl.status === 'admitted'
            ? campaignControl.contract_digest
            : null,
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
      }
      ledger.push(...implementation.ledger);
      implementationChain.push(implementation);
      if (lifecycleObservation) lifecycleObservation.observeImplementationResult(implementation, round);
      if (implementation.status !== 'committed') {
        const implementationPhase = implementation.phase || 'dispatch_implementation';
        if (campaignControl
            && campaignControl.status === 'admitted'
            && isCampaignPreSpendRejection(implementation)) {
          const rejection = {
            owner: 'implementation_dispatch',
            status: 'rejected',
            code: 'campaign_leaf_pre_spend_rejected',
            reason: implementation.reason || `implementation status ${implementation.status}`,
          };
          releaseCampaignNoEffect(rejection);
        }
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
          // Machine-readable on_engine_unavailable directive (additive; null unless the
          // dispatch died engine_unavailable/precondition_failed) — depth-0 acts on
          // action ∈ escalate | solo-fallback | wait-reset instead of re-deriving policy.
          engine_unavailable: implementation.engine_unavailable || null,
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
        let verifyWorktree = null;
        let verifyWorktreeParent = null;
        let verifyWorktreeAdded = false;
        let verifySetupBlockedReason = null;
        let verifyCleanupResult = null;
        let verifyCleanupWarning = null;
        try {
          const worktreeAddResult = this.gitWorktreeAdd({
            commit,
            cwd: loopCwd,
            round,
            branch: currentBranch,
          });
          verifyWorktree = worktreeAddResult ? worktreeAddResult.worktree : null;
          verifyWorktreeParent = worktreeAddResult ? worktreeAddResult.parent : null;
          verifySetupBlockedReason = worktreeResultBlocked(worktreeAddResult);
          if (verifySetupBlockedReason) {
            verifyResult = {
              error: worktreeAddResult && worktreeAddResult.error
                ? worktreeAddResult.error
                : new Error(verifySetupBlockedReason),
              status: worktreeAddResult ? worktreeAddResult.status : null,
              signal: worktreeAddResult ? worktreeAddResult.signal || null : null,
              stdout: worktreeAddResult ? worktreeAddResult.stdout || '' : '',
              stderr: worktreeAddResult ? worktreeAddResult.stderr || '' : '',
            };
          } else {
            verifyWorktreeAdded = true;
            verifyResult = this.verifyCommandRunner({
              verifyCmd,
              cwd: verifyWorktree,
              round,
              commit,
              branch: currentBranch,
            });
          }
        } catch (error) {
          verifyResult = {
            error,
            status: null,
            signal: null,
            stdout: '',
            stderr: '',
          };
        } finally {
          try {
            if (verifyWorktreeAdded && verifyWorktree) {
              try {
                verifyCleanupResult = this.gitWorktreeRemove({
                  worktree: verifyWorktree,
                  cwd: loopCwd,
                  round,
                  commit,
                  branch: currentBranch,
                });
                verifyCleanupWarning = worktreeResultBlocked(verifyCleanupResult);
              } catch (error) {
                verifyCleanupResult = {
                  error,
                  status: null,
                  signal: null,
                  stdout: '',
                  stderr: '',
                };
                verifyCleanupWarning = worktreeResultBlocked(verifyCleanupResult);
              }
              if (verifyCleanupWarning) {
                try {
                  this.verifyWorktreeCleanup({
                    targetPath: verifyWorktree,
                    cwd: loopCwd,
                    round,
                    commit,
                    branch: currentBranch,
                    reason: 'worktree_remove_fallback',
                  });
                } catch (error) {
                  verifyCleanupWarning = appendCleanupWarning(
                    verifyCleanupWarning,
                    `fallback fs cleanup failed: ${error.message}`,
                  );
                }
              }
            }
          } finally {
            if (verifyWorktreeParent) {
              try {
                this.verifyWorktreeCleanup({
                  targetPath: verifyWorktreeParent,
                  cwd: loopCwd,
                  round,
                  commit,
                  branch: currentBranch,
                  reason: 'worktree_parent_cleanup',
                });
              } catch (error) {
                verifyCleanupWarning = appendCleanupWarning(
                  verifyCleanupWarning,
                  `verify worktree parent cleanup failed: ${error.message}`,
                );
              }
            }
          }
        }
        const verifyBlockedReason = verifySetupBlockedReason
          || verifyResultBlocked(verifyResult);
        if (verifyBlockedReason) {
          ledger.push(this.ledgerEntry('verify_round', 'blocked', verifyStartedAt, {
            round,
            commit,
            verify_pass: false,
            exit_status: verifyResult ? verifyResult.status : null,
            verify_worktree: verifyWorktree,
            blocked_reason: verifyBlockedReason,
            setup_exit_status: verifyResult ? verifyResult.status : null,
            cleanup_exit_status: verifyCleanupResult ? verifyCleanupResult.status : null,
            verify_cleanup_warning: verifyCleanupWarning,
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
          verify_worktree: verifyWorktree,
          cleanup_exit_status: verifyCleanupResult ? verifyCleanupResult.status : null,
          verify_cleanup_warning: verifyCleanupWarning,
          ratchet_reverted: currentRatchetReverted,
          best_round: bestRound,
          best_commit: verifyState.bestCommit,
        }));

        if (currentRatchetReverted) {
          const ratchetStartedAt = this.now();
          let branchForceResult;
          try {
            branchForceResult = this.gitBranchForce({
              branch: currentBranch,
              commit: verifyState.bestCommit,
              cwd: loopCwd,
              round,
              revertedCommit: commit,
            });
          } catch (error) {
            branchForceResult = {
              error,
              status: null,
              signal: null,
              stdout: '',
              stderr: '',
            };
          }
          const branchForceBlockedReason = branchForceResultBlocked(branchForceResult);
          ledger.push(this.ledgerEntry('ratchet_select', branchForceBlockedReason ? 'branch_update_blocked' : 'selected', ratchetStartedAt, {
            round,
            commit,
            selected_commit: verifyState.bestCommit,
            branch: currentBranch,
            branch_update_exit_status: branchForceResult ? branchForceResult.status : null,
          }));
          if (branchForceBlockedReason) {
            return finish({
              status: 'blocked',
              phase: 'ratchet_select',
              reason: branchForceBlockedReason,
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

      const reviewBudgetAt = this.now();
      const reviewBudget = campaignWallBudgetStatus(campaignControl, reviewBudgetAt);
      if (reviewBudget.exhausted) {
        ledger.push(this.ledgerEntry(
          'campaign_wall_budget',
          'blocked',
          reviewBudgetAt,
          { elapsed_seconds: reviewBudget.elapsed_seconds },
        ));
        return finish({
          status: 'blocked',
          phase: 'campaign_wall_budget',
          reason: 'campaign has no wall-clock budget remaining before review dispatch',
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
        roster: dynamicReviewRisk ? null : roster,
        rosterArgs: Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
          ? input.rosterArgs
          : ['--check-scorecard'],
        resolverOptions: {
          ...(input.resolverOptions || {}),
          cwd: loopCwd,
        },
        dynamicReviewRisk,
        extraReviewArgs: input.extraReviewArgs || [],
        sourceTrust: input.sourceTrust,
        oracleAvailable: input.oracleAvailable,
        securitySurface: input.securitySurface,
        samplingRatio: input.samplingRatio,
        samplingSeed: input.samplingSeed,
        classifyRulesFile: input.classifyRulesFile,
        implementerEngine: roster && roster.implementer_engine,
        runId: campaignDispatchIdentity
          ? campaignDispatchIdentity.runId
          : input.runId,
        ledger: campaignDispatchIdentity
          ? campaignDispatchIdentity.ledger
          : input.ledger,
        reviewStage: campaignDispatchIdentity
          ? `campaign-review#r${round}`
          : input.reviewStage,
        reviewOptions: {
          ...(input.reviewOptions || {}),
          cwd: loopCwd,
        },
        requireQualifiedReviewer,
      });
      ledger.push(...review.ledger);
      reviewChain.push(review);
      if (lifecycleObservation) lifecycleObservation.observeReviewResult(review, round);
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
  AUTOPILOT_ENGINE_CONTROL_SINKS,
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
