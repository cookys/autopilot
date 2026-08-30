'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { isImmutableGitSha } = require('../lib/common');
const {
  contractDigest: repairScopeContractDigest,
  evaluate: evaluateRepairScope,
} = require('../../scripts/check-repair-scope');

const { resolveReviewLoopJson } = require('./resolve-review-loop');
const {
  applyImplementerLadder,
  repairRoundFromImplementationRound,
  unitClassFromContract,
} = require('./implementer-ladder');
const { dispatchReviewJson } = require('../runners/review');
const { dispatchImplementJson } = require('../runners/implementer');
const { createEngineLifecycleObservationSession } = require('./engine-lifecycle-observation');
const {
  consumeStrictL5ProviderReadiness,
  isStrictL5ProviderReadinessAuthority,
} = require('../readiness/provider-bootstrap');
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
  stateHash: missionStateHash,
  validateMissionState,
} = require('./mission-convergence');
const {
  openPreparedMissionStateStore,
  reconcileMissionCampaignTerminal,
} = require('../mission/runtime');
const { runCampaignComposition } = require('./campaign-composition');
const {
  emptyControllerState,
  buildFrozenDenominator,
  buildProgressReceipt,
  buildRecoveryReceipt,
  checkJointRepairBudget,
  controllerStateDigest,
  rebuildTranscriptAudit,
  reconstructOwnedInventory,
  buildResourceDebtState,
} = require('./controller-execution');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const {
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  campaignIdFor,
  repairLineageCleanupId,
  resolveCampaignEventLeaseIdentity,
} = require('./implementation-campaign');
const repairLadder = require('./repair-ladder');
const {
  missionCampaignIdFor,
  missionSubjectDigest,
} = require('./mission-campaign-identity');
const { normalizeProductReviewFindings } = require('./product-review-normalizer');
const {
  worktreeInstanceId: repairWorktreeInstanceId,
} = require('./repair-lineage-cleanup');
const {
  canonicalDigest: campaignCanonicalDigest,
  createDetachedCheckoutAttestation,
  createLedgerReconciliationReceipt,
  createVerificationReceipt,
  createVerificationRequest,
  createWriterFence,
  environmentFingerprint,
  reusableGreenReceipt,
  verificationArgv,
} = require('./campaign-verification');
const { adjudicateCampaignReview } = require('./campaign-adjudication');
const { evaluateLoopConvergence } = require('../../scripts/check-loop-convergence');
const {
  inspectLifecycleReceipt,
} = require('../../scripts/lifecycle-residue-receipt');
const {
  buildMissionZeroDiffReceipt,
  hasCampaignDispatchAuthority,
  normalizeCampaignAuthority,
  writeCampaignDispatchUnit,
} = require('./campaign-dispatch-projection');
const { admitMissionRouting } = require('../../scripts/mission-routing-admission');
const {
  devFlowAdmissionRejection,
  validateManagedDevFlowAdmission,
  campaignCarriesMissionProjection,
} = require('../../scripts/session-mode');
const {
  admitContinuation,
  loadMatchingRunsFromManifestDir,
  workOrder,
} = require('./continuation-admission');

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
  // Lifecycle update / WO terminalization failures are fail-closed: never surface as committed.
  if (result.lifecycle_error) {
    return `work order lifecycle update failed: ${result.lifecycle_error}`;
  }
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

function campaignStrictResultBlocked(result, expected) {
  if (!expected || !result || result.status !== 'committed') return null;
  const expectedUnitId = expected.contract.unit_id;
  const required = {
    campaign_contract_sha256: expected.campaign_contract_sha256,
    contract_sha256: expected.contract_sha256,
    unit_contract_sha256: expected.contract_sha256,
    unit_id: expectedUnitId,
    go: 'GO',
    boundary: 'ok',
    acceptance: 'ok',
    branch: expected.branch,
    base: expected.base,
    run_id: expected.campaign_id,
    runner: expected.contract.campaign_projection.runner,
    model: expected.contract.campaign_projection.model,
  };
  for (const [field, value] of Object.entries(required)) {
    if (result[field] !== value) {
      return `managed strict implementation result has invalid ${field}`;
    }
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

function validateReviewRoster(roster, options = {}) {
  if (!roster || typeof roster !== 'object') {
    throw new TypeError('review roster is required');
  }
  for (const field of ['reviewer_runner', 'reviewer_engine', 'reviewer_effort']) {
    if (typeof roster[field] !== 'string' || roster[field].length === 0) {
      throw new TypeError(`review roster field ${field} is required`);
    }
  }
  if (options.requireTerminalPanel !== true) return roster;
  if (!Number.isSafeInteger(roster.min_panel_size) || roster.min_panel_size < 1) {
    throw new TypeError('managed review roster min_panel_size must be an integer >= 1');
  }
  if (roster.qc_panel_seats_complete !== true) {
    throw new TypeError('managed review roster requires complete exact QC seat metadata');
  }
  if (!Array.isArray(roster.qc_panel_seats)
      || roster.qc_panel_seats.length < roster.min_panel_size) {
    throw new TypeError('managed review roster exact QC seats must satisfy min_panel_size');
  }
  for (const [index, seat] of roster.qc_panel_seats.entries()) {
    const fields = seat && typeof seat === 'object' && !Array.isArray(seat)
      ? Object.keys(seat)
      : [];
    const valid = fields.length === 6
      && fields.every((field) => [
        'role', 'runner', 'model', 'effort', 'endpoint', 'family',
      ].includes(field))
      && seat.role === 'qc'
      && typeof seat.runner === 'string' && seat.runner.length > 0
      && typeof seat.model === 'string' && seat.model.length > 0
      && typeof seat.effort === 'string' && seat.effort.length > 0
      && typeof seat.family === 'string' && seat.family.length > 0
      && (seat.endpoint === null
        || (typeof seat.endpoint === 'string' && /^[A-Za-z0-9_]+$/.test(seat.endpoint)));
    if (!valid) {
      throw new TypeError(`managed review roster qc_panel_seats[${index}] is invalid`);
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
  campaignSealFile = null,
  campaignUnitContractFile = null,
  campaignRunId = null,
  campaignStage = null,
  keepWorktree = false,
  reuseWorktree = null,
  expectedWorktreeInstanceId = null,
  resumeSessionId = null,
  retentionOwner = null,
  retentionReason = null,
  retentionExpiresAt = null,
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
    '--campaign-seal',
    '--strict-contract',
    '--contract-file',
    '--keep-worktree',
    '--reuse-worktree',
    '--expected-worktree-instance',
    '--resume-session',
    '--retain-owner',
    '--retain-reason',
    '--retain-until',
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
  if (campaignSealFile !== null
      && (typeof campaignSealFile !== 'string' || campaignSealFile.length === 0)) {
    throw new TypeError('campaignSealFile must be a non-empty string');
  }
  if (campaignUnitContractFile !== null
      && (typeof campaignUnitContractFile !== 'string'
        || campaignUnitContractFile.length === 0)) {
    throw new TypeError('campaignUnitContractFile must be a non-empty string');
  }
  const campaignBoundaryFields = [
    campaignContractFile,
    campaignContractDigest,
    campaignSealFile,
  ].filter((value) => value !== null).length;
  if (campaignBoundaryFields !== 0 && campaignBoundaryFields !== 3) {
    throw new TypeError(
      'campaignContractFile, campaignContractDigest, and campaignSealFile must be supplied together',
    );
  }
  if (campaignUnitContractFile !== null && campaignBoundaryFields !== 3) {
    throw new TypeError('campaignUnitContractFile requires the sealed campaign boundary');
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
  const normalizedDispatchIdentity = normalizeDispatchIdentity(
    dispatchIdentity,
    'dispatchIdentity',
  );
  appendDispatchIdentity(args, normalizedDispatchIdentity);
  if (campaignContractFile && normalizedDispatchIdentity === null) {
    if (typeof campaignRunId !== 'string' || campaignRunId.length === 0
        || typeof campaignStage !== 'string' || campaignStage.length === 0) {
      throw new TypeError(
        'managed campaign dispatch requires campaignRunId and campaignStage',
      );
    }
    args.push('--run-id', campaignRunId, '--stage', campaignStage);
  }
  if (campaignContractFile) {
    args.push('--campaign-contract', path.resolve(cwd || process.cwd(), campaignContractFile));
    args.push('--campaign-contract-sha256', campaignContractDigest);
    args.push('--campaign-seal', path.resolve(cwd || process.cwd(), campaignSealFile));
  }
  if (campaignUnitContractFile) {
    args.push('--strict-contract');
    args.push('--contract-file', path.resolve(
      cwd || process.cwd(),
      campaignUnitContractFile,
    ));
  }
  if (reuseWorktree !== null) {
    if (typeof reuseWorktree !== 'string' || !path.isAbsolute(reuseWorktree)) {
      throw new TypeError('reuseWorktree must be an absolute path');
    }
    args.push('--reuse-worktree', reuseWorktree);
    if (typeof expectedWorktreeInstanceId !== 'string'
        || !/^[0-9a-f]{64}$/.test(expectedWorktreeInstanceId)) {
      throw new TypeError(
        'expectedWorktreeInstanceId must be a lowercase SHA-256 digest when reusing a worktree',
      );
    }
    args.push('--expected-worktree-instance', expectedWorktreeInstanceId);
  } else if (expectedWorktreeInstanceId !== null) {
    throw new TypeError('expectedWorktreeInstanceId requires reuseWorktree');
  }
  if (resumeSessionId !== null) {
    if (typeof resumeSessionId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          resumeSessionId,
        )) {
      throw new TypeError('resumeSessionId must be a lowercase UUID');
    }
    args.push('--resume-session', resumeSessionId);
  }
  if (keepWorktree === true) {
    if (typeof retentionOwner !== 'string'
        || !/^[A-Za-z0-9._-]+$/.test(retentionOwner)) {
      throw new TypeError('retentionOwner must match [A-Za-z0-9._-]+');
    }
    if (typeof retentionReason !== 'string' || retentionReason.trim().length === 0) {
      throw new TypeError('retentionReason must be a non-empty string');
    }
    if (!Number.isSafeInteger(retentionExpiresAt) || retentionExpiresAt <= 0) {
      throw new TypeError('retentionExpiresAt must be a positive epoch second');
    }
    args.push(
      '--keep-worktree',
      '--retain-owner',
      retentionOwner,
      '--retain-reason',
      retentionReason,
      '--retain-until',
      String(retentionExpiresAt),
    );
  }
  args.push(...extraImplementationArgs);
  return args;
}

function deriveCampaignLifecycleRoot({
  campaignContractFile,
  campaignContractDigest,
  campaignSealFile,
  runId,
  cwd,
}) {
  const contractPath = path.resolve(cwd || process.cwd(), campaignContractFile);
  const sealPath = path.resolve(cwd || process.cwd(), campaignSealFile);
  let contract;
  let contractBytes;
  let seal;
  try {
    contractBytes = fs.readFileSync(contractPath);
    contract = JSON.parse(contractBytes.toString('utf8'));
    seal = JSON.parse(fs.readFileSync(sealPath, 'utf8'));
  } catch (error) {
    throw new TypeError(`managed campaign authority is unreadable: ${error.message}`);
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
  const strictAuthority = hasCampaignDispatchAuthority(contract);
  if (strictAuthority) {
    const actualDigest = crypto.createHash('sha256').update(contractBytes).digest('hex');
    if (actualDigest !== campaignContractDigest
        || !seal
        || seal.contract_sha256 !== campaignContractDigest) {
      throw new TypeError('managed campaign contract digest does not match its seal');
    }
  }
  // Durable ICC / run / worktree identity is always campaign-v1 from raw contract
  // bytes. Mission-v2 seal identity is validated separately and never substituted.
  const expected = campaignIdFor(repoIdentity, contract.ticket, campaignContractDigest);
  if (typeof expected !== 'string' || !/^campaign-v1-[0-9a-f]{64}$/.test(expected)) {
    throw new TypeError('managed campaign ICC identity is invalid');
  }
  let missionCampaignId = null;
  if (seal && seal.identity_scheme === 'mission-subject-v2') {
    let recomputedSubject;
    let recomputedMissionId;
    try {
      recomputedSubject = missionSubjectDigest(contract);
      recomputedMissionId = missionCampaignIdFor(
        repoIdentity,
        contract.ticket,
        recomputedSubject,
      );
    } catch (error) {
      throw new TypeError(
        `managed campaign Mission-v2 identity cannot be recomputed: ${error.message}`,
      );
    }
    if (seal.mission_subject_digest !== recomputedSubject
        || seal.campaign_id !== recomputedMissionId) {
      throw new TypeError(
        'managed campaign Mission-v2 seal identity does not match sealed contract',
      );
    }
    missionCampaignId = recomputedMissionId;
  }
  if (runId !== expected) {
    throw new TypeError(
      'managed campaign run id does not match the sealed contract identity',
    );
  }
  return {
    campaign_id: expected,
    mission_campaign_id: missionCampaignId,
    contract,
    root_run_id: strictAuthority ? contract.mission_runtime.root_run_id : expected,
    strict: strictAuthority,
  };
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

// Terminal QC seats are independently selected tuples, not aliases for the
// focused reviewer. A roster-level qualification bit therefore cannot certify
// a different runner/model/effort. The incumbent remains compatible only when
// the sealed seat is exactly that qualified tuple; every other terminal seat
// needs an exact qualified scorecard-ladder row.
function finalPanelSeatQualified(roster, seat) {
  if (!roster || !seat) return false;
  const endpoint = (value) => typeof value === 'string' && value.length > 0 ? value : null;
  const incumbent = roster.reviewer_qualified === true
    && roster.reviewer_runner === seat.runner
    && roster.reviewer_engine === seat.model
    && roster.reviewer_effort === seat.effort
    && endpoint(roster.reviewer_endpoint) === endpoint(seat.endpoint);
  if (incumbent) return true;
  if (!Array.isArray(roster.fallback_ladder)) return false;
  return roster.fallback_ladder.some((row) => {
    if (!row || typeof row !== 'object') return false;
    const rowModel = typeof row.model === 'string' && row.model.length > 0
      ? row.model
      : row.engine;
    return row.runner === seat.runner
      && rowModel === seat.model
      && row.effort === seat.effort
      && endpoint(row.endpoint) === endpoint(seat.endpoint)
      && (typeof row.family !== 'string' || row.family === seat.family);
  });
}

// Terminal panel decorrelation is a roster-level invariant. A pinned seat is an
// immutable invocation tuple, so sharing the implementer's family is permitted
// for that individual seat; the sealed panel as a whole must still contain the
// required number of distinct reviewer families and at least one family known
// to differ from a known implementer. A multi-seat terminal panel must span at
// least two reviewer families even when a low-risk roster's configured family
// floor is one; explicit single-seat/min=1 operation remains compatible.
// Unknown implementers preserve the resolver's pigeonhole rule.
function terminalPanelCrossFamilySatisfied(roster, seats) {
  if (!roster || !Array.isArray(seats)) return false;
  if (roster.cross_family_required === false) return true;
  const configuredRequired = Number.isSafeInteger(roster.required_review_families)
    && roster.required_review_families >= 1
    ? roster.required_review_families
    : 1;
  const panelRequiresDiversity = seats.length > 1
    || (Number.isSafeInteger(roster.min_panel_size) && roster.min_panel_size > 1);
  const required = panelRequiresDiversity ? Math.max(2, configuredRequired) : configuredRequired;
  const families = new Set();
  for (const seat of seats) {
    if (!seat || typeof seat.family !== 'string' || seat.family.length === 0) continue;
    const derived = modelFamilyOfEngine(seat.model);
    families.add(derived === 'unknown' ? seat.family : derived);
  }
  if (families.size < required) return false;
  const implementerFamily = modelFamilyOfEngine(roster.implementer_engine);
  if (implementerFamily === 'unknown') return required < 2 || families.size >= required;
  return [...families].some((family) => family !== implementerFamily);
}

// Stable codes for managed-strict sealed root-identity precondition failures.
// Zero-effect release after IMPLEMENTATION_STARTED is gated on these codes —
// never on prepare shape or free-text reason alone.
const MANAGED_STRICT_ROOT_IDENTITY_CODES = new Set([
  'managed_strict_root_identity_missing',
  'managed_strict_root_identity_malformed',
  'managed_strict_root_identity_mismatch',
]);
// Same pattern as campaign-dispatch-projection ROOT_RUN_ID (kept local so the
// prepare classifier does not import non-exported projection internals).
const MANAGED_STRICT_ROOT_RUN_ID = /^[A-Za-z0-9._-]+$/;

function classifyManagedStrictRootIdentity(env, sealedRootRunId) {
  if (!Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_ROOT_RUN_ID')) {
    return {
      code: 'managed_strict_root_identity_missing',
      reason: 'managed strict implementation requires AUTOPILOT_ROOT_RUN_ID',
    };
  }
  const value = env.AUTOPILOT_ROOT_RUN_ID;
  if (typeof value !== 'string'
      || value.length === 0
      || value.trim() !== value
      || !MANAGED_STRICT_ROOT_RUN_ID.test(value)) {
    return {
      code: 'managed_strict_root_identity_malformed',
      reason: 'managed strict implementation AUTOPILOT_ROOT_RUN_ID is malformed',
    };
  }
  if (value !== sealedRootRunId) {
    return {
      code: 'managed_strict_root_identity_mismatch',
      reason: 'managed strict implementation root run id disagrees with sealed campaign',
    };
  }
  return null;
}

function isNeverDispatchedPrepareRejection(result) {
  // Narrow zero-effect proof: only sealed root-identity prepare rejections
  // with mechanical dispatcher_called === false and null implementation fields.
  // Same-shaped prepare failures with any other/absent code, absent or
  // ambiguous proof, or any dispatcher call remain possibly effectful.
  return Boolean(result)
    && result.status === 'blocked'
    && result.phase === 'prepare_implementation'
    && result.implementationResult === null
    && result.implementation === null
    && result.dispatcher_called === false
    && MANAGED_STRICT_ROOT_IDENTITY_CODES.has(result.code);
}

function zeroEffectLeafFacts(result) {
  const leaf = result && result.implementation;
  if (leaf && typeof leaf === 'object' && !Array.isArray(leaf)) {
    if (leaf.status === 'no_op') {
      return {
        status: leaf.status,
        runner: leaf.runner,
        model: leaf.model,
        commit: leaf.commit,
        worktree: leaf.worktree,
        agent_log: leaf.agent_log,
        files_changed: leaf.files_changed,
        insertions: leaf.insertions,
        deletions: leaf.deletions,
        dispatcher_called: leaf.dispatcher_called,
        mutation_attempts: leaf.mutation_attempts,
        gate_attempts: leaf.gate_attempts,
        resources_created: leaf.resources_created,
        zero_diff_receipt_digest: leaf.zero_diff_receipt_digest,
      };
    }
    return {
      status: leaf.status,
      commit: leaf.commit,
      worktree: leaf.worktree,
      agent_log: leaf.agent_log,
      files_changed: leaf.files_changed,
      insertions: leaf.insertions,
      deletions: leaf.deletions,
      dispatcher_called: leaf.dispatcher_called,
      model_calls: leaf.model_calls,
      mutation_attempts: leaf.mutation_attempts,
      gate_attempts: leaf.gate_attempts,
      resources_created: leaf.resources_created,
    };
  }
  // Sealed root-identity prepare rejections (missing/malformed/mismatched
  // AUTOPILOT_ROOT_RUN_ID with dispatcher_called === false) produce no leaf;
  // synthesize the exact zero-effect shape so ICC + Mission release can bind
  // deterministic leaf facts. Message text alone never qualifies.
  if (isNeverDispatchedPrepareRejection(result)) {
    return {
      status: 'precondition_failed',
      commit: null,
      worktree: null,
      agent_log: null,
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      dispatcher_called: false,
      model_calls: 0,
      mutation_attempts: 0,
      gate_attempts: 0,
      resources_created: 0,
    };
  }
  return null;
}

function isExactZeroEffectPreconditionLeaf(leaf) {
  return Boolean(leaf)
    && typeof leaf === 'object'
    && !Array.isArray(leaf)
    && leaf.status === 'precondition_failed'
    && leaf.commit === null
    && leaf.worktree === null
    && leaf.agent_log === null
    && leaf.files_changed === 0
    && leaf.insertions === 0
    && leaf.deletions === 0
    && leaf.dispatcher_called === false
    && leaf.model_calls === 0
    && leaf.mutation_attempts === 0
    && leaf.gate_attempts === 0
    && leaf.resources_created === 0;
}

function isExactSealedZeroDiffLeaf(leaf, unitContract = null) {
  const expectedReceipt = unitContract
    && unitContract.output
    && unitContract.output.zero_diff_receipt;
  return Boolean(leaf)
    && typeof leaf === 'object'
    && !Array.isArray(leaf)
    && leaf.status === 'no_op'
    && leaf.runner === 'sealed-zero-diff-admission'
    && leaf.model === null
    && leaf.commit === null
    && leaf.worktree === null
    && leaf.dispatcher_called === false
    && leaf.files_changed === 0
    && leaf.insertions === 0
    && leaf.deletions === 0
    && leaf.mutation_attempts === 0
    && leaf.gate_attempts === 0
    && leaf.resources_created === 0
    && isObj(expectedReceipt)
    && isStr(expectedReceipt.digest)
    && leaf.zero_diff_receipt_digest === expectedReceipt.digest;
}

function dispatcherUsageAuthorityViolation(result) {
  if (!isObj(result)) return null;
  for (const field of [
    'model_calls',
    'fresh_input_bytes',
    'fresh_input_tokens',
    'finding_recurrence',
    'elapsed_wall_ms',
    'owned_worktrees_current',
    'mutation_attempts',
    'gate_attempts',
    'resources_created',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(result, field)
        || result[field] === null) continue;
    if (!Number.isSafeInteger(result[field]) || result[field] < 0) {
      return `${field} must be a nonnegative safe integer when reported`;
    }
  }
  if (isObj(result.usage)
      && Object.prototype.hasOwnProperty.call(result.usage, 'input_tokens')
      && result.usage.input_tokens !== null
      && (!Number.isSafeInteger(result.usage.input_tokens)
        || result.usage.input_tokens < 0)) {
    return 'usage.input_tokens must be null or a nonnegative safe integer';
  }
  return null;
}

function isCampaignPreSpendRejection(result) {
  if (!result || result.status !== 'blocked') return false;
  if (isNeverDispatchedPrepareRejection(result)) {
    return true;
  }
  return isExactZeroEffectPreconditionLeaf(result.implementation);
}

function isIntentOnlyImplementationStartedState(state, claim) {
  if (!state || typeof state !== 'object') return false;
  if (state.generation !== 0
      || state.event_count !== 1
      || state.phase !== CAMPAIGN_STATES.IMPLEMENTING
      || !state.live_lease
      || typeof state.live_lease !== 'object'
      || state.live_lease.generation !== 0
      || state.live_lease.stage_identity !== 'campaign-mutation:0') {
    return false;
  }
  if (!state.usage
      || state.usage.changed_files !== 0
      || state.usage.churn !== 0) {
    return false;
  }
  if (claim && claim.resume_candidate) return false;
  if (claim && claim.resume_review_digest) return false;
  return true;
}

function isExactZeroEffectLeafProof(leafProof) {
  const leaf = zeroEffectLeafFacts(leafProof);
  return isExactZeroEffectPreconditionLeaf(leaf)
    || isExactSealedZeroDiffLeaf(leaf, leafProof && leafProof.unit_contract);
}

function isCampaignAdmissionReleasable(state, claim, leafProof) {
  // Missing campaign state fails closed — never treat unknown as releasable.
  if (!state || typeof state !== 'object') return false;
  // Classic pre-intent admission: PREPARED, no events, no live lease.
  if (state.event_count === 0
      && state.phase === CAMPAIGN_STATES.PREPARED
      && state.live_lease === null) {
    return true;
  }
  // Post-IMPLEMENTATION_STARTED durable release requires the exact zero-effect
  // leaf proof (dispatcher precondition_failed, or sealed root-identity
  // prepare with dispatcher_called === false and synthesized null-mutation
  // facts) plus intent-only journal state.
  return isExactZeroEffectLeafProof(leafProof)
    && isIntentOnlyImplementationStartedState(state, claim);
}

function buildCampaignPreSpendRejection({
  owner,
  code,
  reason,
  result = null,
}) {
  const rejection = {
    owner,
    status: 'rejected',
    code,
    reason,
  };
  const leaf = zeroEffectLeafFacts(result);
  if (leaf) rejection.zero_effect_leaf = leaf;
  return rejection;
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

function createRepairScopeSeal({ findingIds, allowedPaths, sourceCommit }) {
  const body = {
    schema: 1,
    finding_ids: [...new Set(findingIds)].sort(),
    allowed_paths: [...new Set(allowedPaths)].sort(),
    source_commit: sourceCommit,
  };
  return Object.freeze({
    ...body,
    seal_digest: campaignCanonicalDigest(body),
  });
}

function repairScopeSealValid(seal) {
  if (!isPlainObject(seal)) return false;
  const { seal_digest: sealDigest, ...body } = seal;
  return body.schema === 1
    && Array.isArray(body.finding_ids)
    && body.finding_ids.length > 0
    && Array.isArray(body.allowed_paths)
    && body.allowed_paths.length > 0
    && body.finding_ids.every((item, index) => typeof item === 'string'
      && item.length > 0
      && (index === 0 || body.finding_ids[index - 1] < item))
    && body.allowed_paths.every((item, index) => typeof item === 'string'
      && item.length > 0
      && !path.isAbsolute(item)
      && !item.split('/').includes('..')
      && (index === 0 || body.allowed_paths[index - 1] < item))
    && isImmutableGitSha(body.source_commit)
    && /^[0-9a-f]{64}$/.test(sealDigest || '')
    && campaignCanonicalDigest(body) === sealDigest;
}

function findingBoundRepairPaths(findings, allowedPrefixes) {
  const prefixes = allowedPrefixes.map((prefix) => (
    prefix.endsWith('/') ? prefix : `${prefix}/`
  ));
  const allPaths = new Set();
  for (const finding of findings) {
    const findingPaths = new Set();
    const evidence = `${finding.claim || ''}\n${finding.source || ''}`;
    for (const match of evidence.matchAll(
      /(?:^|[\s`'"(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)(?=[:#]?\d*(?:[\s`'",)]|$))/gu,
    )) {
      const candidate = match[1];
      if (candidate.split('/').includes('..')
          || path.isAbsolute(candidate)
          || !prefixes.some((prefix) => candidate.startsWith(prefix))) continue;
      findingPaths.add(candidate);
      allPaths.add(candidate);
    }
    if (findingPaths.size === 0) {
      throw new Error(
        `finding ${finding.finding_id || finding.id} has no explicit allowed repair path`,
      );
    }
  }
  return [...allPaths].sort();
}

function defaultCampaignRepairChangedPaths({ repo, base, head }) {
  const result = spawnSync(
    'git',
    ['-C', repo, 'diff', '--name-only', '-z', base, head, '--'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const blocked = worktreeResultBlocked(result);
  if (blocked) return { status: 'blocked', reason: blocked, paths: [] };
  return {
    status: 'ok',
    reason: null,
    paths: String(result.stdout || '').split('\0').filter(Boolean).sort(),
  };
}

function remediationFallback(reason) {
  return {
    schema_version: 1,
    artifact_type: 'review_remediation_check',
    status: 'needs_full_review',
    authority: 'non_authoritative',
    whole_candidate_pass: false,
    gate_clear: false,
    fallback_to_full_blind_review: true,
    reason,
  };
}

function defaultRemediationChecker({ deltaFile, resultFile }) {
  const delta = JSON.parse(fs.readFileSync(deltaFile, 'utf8'));
  const findings = Array.isArray(delta.finding_contracts) ? delta.finding_contracts.map((finding) => ({
    finding_id: finding.finding_id,
    status: 'needs_full_review',
    evidence: 'default checker makes no independent resolution claim',
  })) : [];
  const result = {
    schema_version: 1,
    artifact_type: 'review_remediation_result',
    authority: 'non_authoritative',
    whole_candidate_pass: false,
    gate_clear: false,
    previous_commit: delta.previous_commit,
    current_commit: delta.current_commit,
    delta_digest: delta.delta_digest,
    finding_contract_digest: delta.finding_contract_digest,
    findings,
  };
  fs.writeFileSync(resultFile, `${JSON.stringify(result)}\n`, { mode: 0o600 });
}

function runRemediationCheckerBoundary(checker, {
  repo, previousCommit, currentCommit, previousFindings, currentFindings,
}) {
  if (!isImmutableGitSha(previousCommit) || !isImmutableGitSha(currentCommit)
      || previousCommit === currentCommit) {
    return remediationFallback('remediation checker requires two distinct immutable commits');
  }
  if (!Array.isArray(previousFindings) || previousFindings.length === 0) {
    return remediationFallback('no complete prior finding contracts available');
  }
  const allowedKeys = ['claim', 'finding_id', 'severity', 'source'];
  const freezeContracts = (items, label, allowEmpty = false) => {
    if (!Array.isArray(items) || (!allowEmpty && items.length === 0)) return null;
    const seen = new Set();
    const out = items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || Object.keys(item).sort().join(',') !== allowedKeys.join(',')
          || seen.has(item.finding_id)) return null;
      seen.add(item.finding_id);
      return Object.freeze({
        finding_id: item.finding_id,
        claim: item.claim,
        severity: item.severity,
        source: item.source,
      });
    });
    return out.some((item) => !item) ? null : Object.freeze(out);
  };
  const contracts = freezeContracts(previousFindings, 'prior');
  const currentContracts = freezeContracts(currentFindings, 'current', true);
  if (!contracts) return remediationFallback('prior review findings are not named contract objects');
  if (!currentContracts) return remediationFallback('current review findings are not named contract objects');
  const currentById = new Map(currentContracts.map((item) => [item.finding_id, item]));
  if (contracts.some((finding) => {
    const current = currentById.get(finding.finding_id);
    return !current || allowedKeys.some((key) => current[key] !== finding[key]);
  })) return remediationFallback('current review does not preserve exact frozen prior finding identities');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-remediation-check-'));
  const findingsFile = path.join(tempDir, 'findings.json');
  const deltaFile = path.join(tempDir, 'delta.json');
  const checkerDir = path.join(tempDir, 'checker');
  try {
    fs.writeFileSync(findingsFile, `${JSON.stringify({ findings: contracts })}\n`, { mode: 0o600 });
    const script = resolveScriptPath('scripts/diff-since-last-round.sh');
    const built = spawnSync('bash', [
      script, 'remediation', '--previous', previousCommit, '--current', currentCommit,
      '--findings-file', findingsFile, '--repo', repo, '--out', deltaFile,
    ], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const delta = fs.existsSync(deltaFile) ? parseJsonFromLastLine(fs.readFileSync(deltaFile, 'utf8')) : null;
    if (!delta || built.error || built.status !== 0 || delta.status !== 'ready') {
      return remediationFallback((delta && delta.reason) || 'remediation delta is not ready for named checking');
    }
    fs.mkdirSync(checkerDir, { mode: 0o700 });
    const safeDeltaFile = path.join(checkerDir, 'delta.json');
    const safeContractsFile = path.join(checkerDir, 'finding-contracts.json');
    const resultFile = path.join(checkerDir, 'result.json');
    fs.copyFileSync(deltaFile, safeDeltaFile); fs.chmodSync(safeDeltaFile, 0o600);
    fs.writeFileSync(safeContractsFile, `${JSON.stringify({ prior: delta.finding_contracts })}\n`, { mode: 0o600 });
    const originalCwd = process.cwd();
    let checkerResult;
    try {
      process.chdir(checkerDir);
      checkerResult = checker({
        deltaFile: safeDeltaFile,
        findingContractsFile: safeContractsFile,
        resultFile,
        cwd: checkerDir,
      });
    } finally {
      process.chdir(originalCwd);
    }
    if (checkerResult && typeof checkerResult === 'object') {
      fs.writeFileSync(resultFile, `${JSON.stringify(checkerResult)}\n`, { mode: 0o600 });
    }
    const checked = spawnSync('bash', [
      script, 'check-remediation', '--delta-file', safeDeltaFile, '--result-file', resultFile,
      '--repo', repo,
    ], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const result = parseJsonFromLastLine(checked.stdout);
    if (!result || checked.error || checked.status !== 0) {
      return remediationFallback((result && result.reason) || 'named remediation checker did not produce a valid receipt');
    }
    return result;
  } catch (error) {
    return remediationFallback(error.message || String(error));
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
  }
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

function bindCampaignScopeReceipt({
  receipt,
  candidate,
  campaignContractSha256,
}) {
  const campaignDigest = candidate && candidate.campaign_contract_sha256;
  const unitDigest = candidate && candidate.unit_contract_sha256;
  if (!campaignDigest && !unitDigest) return receipt;
  if (!/^[0-9a-f]{64}$/.test(campaignDigest || '')
      || !/^[0-9a-f]{64}$/.test(unitDigest || '')
      || campaignDigest !== campaignContractSha256) {
    throw new TypeError('campaign scope receipt digest chain is invalid');
  }
  const { receipt_digest: _priorDigest, ...body } = receipt;
  const bound = {
    ...body,
    campaign_contract_sha256: campaignDigest,
    unit_contract_sha256: unitDigest,
  };
  return {
    ...bound,
    receipt_digest: campaignCanonicalDigest(bound),
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

function gitText(cwd, args) {
  const child = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ...child,
    stdout: String(child.stdout || '').trim(),
    stderr: String(child.stderr || '').trim(),
  };
}

function defaultGitWorktreeRemove({
  worktree,
  cwd,
  expectedBranch,
  expectedTip,
  expectedRootRunId,
  expectedRetentionOwner,
  expectedRetentionReason,
  expectedRetentionExpiresAt,
  expectedWorktreeInstanceId,
  allowMissingAfterIntent = false,
}) {
  if (!cwd || typeof cwd !== 'string') {
    return {
      error: new Error('git worktree remove requires repository cwd'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    };
  }
  const strictIdentity = [
    expectedBranch,
    expectedTip,
    expectedRootRunId,
    expectedRetentionOwner,
    expectedRetentionReason,
    expectedRetentionExpiresAt,
  ].some((value) => value !== undefined && value !== null);
  if (!strictIdentity) {
    const status = gitText(worktree, ['status', '--porcelain']);
    if (status.error || status.signal || status.status !== 0
        || status.stdout.length > 0) {
      return {
        error: status.error || null,
        status: status.status === 0 ? 1 : status.status,
        signal: status.signal || null,
        stdout: status.stdout || '',
        stderr: status.stderr || 'worktree is dirty',
      };
    }
    return gitText(cwd, ['worktree', 'remove', path.resolve(worktree)]);
  }
  if (!fs.existsSync(worktree) && allowMissingAfterIntent) {
    const tip = gitText(cwd, ['rev-parse', '--verify', `refs/heads/${expectedBranch}`]);
    if (!tip.error && !tip.signal && tip.status === 0 && tip.stdout === expectedTip) {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        recovered_after_intent: true,
      };
    }
  }
  const requiredStrings = {
    expectedBranch,
    expectedTip,
    expectedRootRunId,
    expectedRetentionOwner,
    expectedRetentionReason,
  };
  for (const [field, value] of Object.entries(requiredStrings)) {
    if (typeof value !== 'string' || value.length === 0) {
      return {
        error: new Error(`git worktree remove requires ${field}`),
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
      };
    }
  }
  const cleanupInput = {
    cwd,
    worktree,
    expectedBranch,
    expectedTip,
    expectedRootRunId,
    expectedRetentionOwner,
    expectedRetentionReason,
    expectedRetentionExpiresAt,
    expectedWorktreeInstanceId,
  };
  const locked = spawnSync('flock', [
    '-x',
    path.join(path.resolve(worktree), '.autopilot-worktree.lock'),
    process.execPath,
    path.join(__dirname, 'repair-lineage-cleanup.js'),
    JSON.stringify(cleanupInput),
  ], {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    error: locked.error || null,
    status: locked.status,
    signal: locked.signal || null,
    stdout: locked.stdout || '',
    stderr: locked.stderr || '',
  };
}

function defaultRepairLineageCleanupJournal({ cwd, cleanupId, action, record = null }) {
  const common = gitText(cwd, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]);
  if (common.error || common.signal || common.status !== 0) {
    return { status: 'blocked', reason: 'cannot resolve cleanup journal directory' };
  }
  const journalDir = path.join(common.stdout, 'autopilot');
  const journalPath = path.join(journalDir, 'repair-lineage-cleanup.jsonl');
  let rows = [];
  try {
    if (fs.existsSync(journalPath)) {
      rows = fs.readFileSync(journalPath, 'utf8').trim().split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    }
  } catch (error) {
    return { status: 'blocked', reason: `cleanup journal is invalid: ${error.message}` };
  }
  const matching = rows.filter((row) => row.cleanup_id === cleanupId);
  if (record) {
    const validMatching = matching.every((row) => {
      if (!row || row.schema !== 1
          || !new Set(['intent', 'removed_clean']).has(row.action)
          || row.cleanup_id !== cleanupId
          || row.lineage_id !== record.lineage_id
          || row.branch !== record.branch
          || row.worktree !== record.worktree
          || row.expected_tip !== record.expected_tip
          || row.cleanup_epoch !== record.cleanup_epoch
          || row.worktree_instance_id !== record.worktree_instance_id
          || row.retention_owner !== record.retention_owner
          || row.retention_reason !== record.retention_reason
          || row.retention_expires_at !== record.retention_expires_at
          || !/^[0-9a-f]{64}$/.test(row.record_digest || '')) return false;
      const { record_digest: recordDigest, ...body } = row;
      return campaignCanonicalDigest(body) === recordDigest;
    });
    const duplicateAction = new Set(matching.map((row) => row.action)).size
      !== matching.length;
    if (!validMatching || duplicateAction) {
      return { status: 'blocked', reason: 'cleanup journal identity or digest is invalid' };
    }
  }
  if (action === 'inspect') {
    if (!record) {
      return { status: 'blocked', reason: 'cleanup journal inspection requires exact identity' };
    }
    const completionRecorded = matching.some((row) => row.action === 'removed_clean');
    if (completionRecorded && fs.existsSync(record.worktree)) {
      return {
        status: 'blocked',
        reason: 'cleanup completion exists while retained worktree is still present',
      };
    }
    return {
      status: 'ok',
      intent_recorded: matching.some((row) => row.action === 'intent'),
      completion_recorded: completionRecorded,
    };
  }
  if (!new Set(['intent', 'removed_clean']).has(action) || !record) {
    return { status: 'blocked', reason: 'cleanup journal append request is invalid' };
  }
  if (matching.some((row) => row.action === action)) {
    return { status: 'ok', already_recorded: true };
  }
  const row = {
    schema: 1,
    cleanup_id: cleanupId,
    action,
    ...record,
  };
  row.record_digest = campaignCanonicalDigest(row);
  try {
    fs.mkdirSync(journalDir, { recursive: true, mode: 0o700 });
    const fd = fs.openSync(journalPath, 'a', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(row)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return { status: 'blocked', reason: `cannot append cleanup journal: ${error.message}` };
  }
  return { status: 'ok', record_digest: row.record_digest };
}

function defaultRepairLineageCleanupTransaction({ cwd, cleanupId, record }) {
  const common = gitText(cwd, [
    'rev-parse', '--path-format=absolute', '--git-common-dir',
  ]);
  if (common.error || common.signal || common.status !== 0) {
    return {
      error: new Error('cannot resolve cleanup transaction directory'),
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
    };
  }
  const transactionDir = path.join(common.stdout, 'autopilot');
  fs.mkdirSync(transactionDir, { recursive: true, mode: 0o700 });
  const child = spawnSync('flock', [
    '-x',
    path.join(transactionDir, 'repair-lineage-cleanup.transaction.lock'),
    process.execPath,
    path.join(__dirname, 'repair-lineage-cleanup-transaction.js'),
    JSON.stringify({
      cwd,
      cleanupId,
      record,
      cleanupHelper: path.join(__dirname, 'repair-lineage-cleanup.js'),
    }),
  ], {
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

function namedReviewFindings(review) {
  let findings = null;
  if (review && review.review && Object.prototype.hasOwnProperty.call(review.review, 'findings')) {
    findings = review.review.findings;
  } else if (review && Object.prototype.hasOwnProperty.call(review, 'findings')) {
    findings = review.findings;
  }
  if (typeof findings === 'string') {
    const normalized = normalizeProductReviewFindings(findings);
    if (normalized.status !== 'normalized') return null;
    findings = normalized.findings;
  }
  if (!Array.isArray(findings)) return null;
  // Freeze a detached copy before the named checker sees ordinary dispatch
  // output; later review normalization cannot mutate the checker contract.
  try {
    const detached = JSON.parse(JSON.stringify(findings));
    const freezeDeep = (value) => {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
      Object.freeze(value);
      for (const child of Object.values(value)) freezeDeep(child);
      return value;
    };
    return freezeDeep(detached);
  } catch (_error) {
    return null;
  }
}

function verificationRank(verifyPass) {
  return verifyPass === true ? 1 : 0;
}

// A controller/journal block after a real dispatch must not report the summary of
// a run that never happened. The ledger's dispatch_implementation entries and the
// durable controller's own budget accounting are the record of what was actually
// spent; the top-level summary reads them rather than defaulting to zero.
function observedDispatchTruth(ledger, controller) {
  const entries = Array.isArray(ledger)
    ? ledger.filter((entry) => entry && entry.unit === 'dispatch_implementation')
    : [];
  const budget = controller && typeof controller === 'object'
    && controller.repair_budget_usage && typeof controller.repair_budget_usage === 'object'
    ? controller.repair_budget_usage
    : null;
  const modelCalls = budget && Number.isSafeInteger(budget.model_calls)
    ? budget.model_calls
    : 0;
  let commit = null;
  for (let index = entries.length - 1; index >= 0 && commit === null; index -= 1) {
    if (typeof entries[index].commit === 'string' && entries[index].commit.length >= 7) {
      commit = entries[index].commit;
    }
  }
  if (commit === null && controller && typeof controller === 'object') {
    if (typeof controller.accepted_commit === 'string'
        && controller.accepted_commit.length >= 7) {
      commit = controller.accepted_commit;
    } else if (controller.candidate && typeof controller.candidate === 'object'
        && typeof controller.candidate.commit === 'string'
        && controller.candidate.commit.length >= 7) {
      commit = controller.candidate.commit;
    }
  }
  return {
    dispatcher_called: entries.length > 0 || modelCalls > 0,
    model_calls: modelCalls,
    dispatch_attempts: entries.length,
    commit,
  };
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
      // An honest commit already carried on the result (a controller/journal
      // block that read it back off the ledger) outranks a null default.
      commit: state.bestCommit || (result.implementation && result.implementation.implementation
        ? result.implementation.implementation.commit
        : null)
        || (typeof result.commit === 'string' ? result.commit : null),
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
  unresolvedFindingIds = [],
  acceptedInvariants = [],
      noRegressionAssertions = [],
      reviewInputMode = 'full_diff_generation',
      acceptedInvariantsSourceCommit = null,
      acceptedInvariantsDigest = null,
      repairScopeSeal = null,
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
    `review_input_mode: ${reviewInputMode}`,
    `unresolved_finding_ids: ${JSON.stringify(unresolvedFindingIds)}`,
    `accepted_invariants: ${JSON.stringify(acceptedInvariants)}`,
    `accepted_invariants_source_commit: ${acceptedInvariantsSourceCommit}`,
    `accepted_invariants_digest: ${acceptedInvariantsDigest}`,
    `no_regression_assertions: ${JSON.stringify(noRegressionAssertions)}`,
    `repair_scope_seal: ${JSON.stringify(repairScopeSeal)}`,
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
    this.reviewPostProviderHook = typeof options.reviewPostProviderHook === 'function'
      ? options.reviewPostProviderHook : null;
    this.implementationDispatcher = options.implementationDispatcher || dispatchImplementJson;
    this.diffProvider = options.diffProvider || defaultDiffProvider;
    this.repairPromptWriter = options.repairPromptWriter || defaultRepairPromptWriter;
    this.remediationChecker = options.remediationChecker || defaultRemediationChecker;
    this.verifyCommandRunner = options.verifyCommandRunner || defaultVerifyCommandRunner;
    this.gitWorktreeAdd = options.gitWorktreeAdd || defaultGitWorktreeAdd;
    this.gitWorktreeRemove = options.gitWorktreeRemove || defaultGitWorktreeRemove;
    this.repairLineageCleanupTransaction = options.repairLineageCleanupTransaction
      || defaultRepairLineageCleanupTransaction;
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
    this.campaignRepairChangedPaths = options.campaignRepairChangedPaths
      || defaultCampaignRepairChangedPaths;
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
      ? path.resolve(this.cwd, options.missionStatePath)
      : null;
    this.missionPreparedReceiptPath = typeof options.missionPreparedReceiptPath === 'string'
      && options.missionPreparedReceiptPath.length > 0
      ? path.resolve(this.cwd, options.missionPreparedReceiptPath)
      : null;
    this.missionPreparedReceipt = isPlainObject(options.missionPreparedReceipt)
      ? options.missionPreparedReceipt
      : null;
    this.missionPreparedError = null;
    this.missionStoreAuthority = 'none';
    if (this.missionPreparedReceiptPath || this.missionPreparedReceipt) {
      try {
        const preparedReceipt = this.missionPreparedReceipt || JSON.parse(
          fs.readFileSync(this.missionPreparedReceiptPath, 'utf8'),
        );
        this.missionCampaignStore = openPreparedMissionStateStore({
          repo: this.cwd,
          preparedReceipt,
        });
        this.missionPreparedReceipt = preparedReceipt;
        this.missionStoreAuthority = 'prepared_registry';
      } catch (error) {
        this.missionCampaignStore = null;
        this.missionPreparedError = error;
        this.missionStoreAuthority = 'invalid_prepared';
      }
    } else if (options.missionCampaignStore
        && typeof options.missionCampaignStore === 'object'
        && typeof options.missionCampaignStore.load === 'function'
        && typeof options.missionCampaignStore.save === 'function') {
      this.missionCampaignStore = options.missionCampaignStore;
      this.missionStoreAuthority = 'host_injected';
    } else if (this.missionStatePath) {
      this.missionCampaignStore = createFileBackedMissionStateStore(this.missionStatePath);
      this.missionStoreAuthority = 'legacy_state_path';
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
    this.missionTerminalReconciler = typeof options.missionTerminalReconciler === 'function'
      ? options.missionTerminalReconciler
      : reconcileMissionCampaignTerminal;
    this.providerReadinessAuthority = typeof options.providerReadinessAuthority === 'function'
      ? options.providerReadinessAuthority : null;
    this.qualificationProvider = options.qualificationProvider || null;
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
    const missionAdapters = this.missionAdapterFactory({
      ...extra,
      store: hasAtomicStore ? store : undefined,
      grant: isPlainObject(grant) ? grant : (isPlainObject(extra.grant) ? extra.grant : grant),
      grant_ref: hasGrantRef
        ? grantRef
        : (typeof extra.grant_ref === 'string' ? extra.grant_ref : undefined),
    });
    return {
      ...missionAdapters,
      ...(this.providerReadinessAuthority ? {
        providerReadiness: this.providerReadinessAuthority,
        qualificationProvider: this.qualificationProvider,
      } : {}),
    };
  }

  readCampaignContract(contractPath, cwd) {
    if (typeof contractPath !== 'string' || contractPath.length === 0) return null;
    const absolute = path.isAbsolute(contractPath)
      ? contractPath
      : path.resolve(cwd || this.cwd, contractPath);
    try {
      const value = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      return isPlainObject(value) ? value : null;
    } catch (_error) {
      return null;
    }
  }

  readCampaignMissionGrantRef(contractPath, cwd) {
    const value = this.readCampaignContract(contractPath, cwd);
    if (!value) return null;
    const ref = value.mission_grant_ref;
    return typeof ref === 'string' && /^[0-9a-f]{64}$/.test(ref) ? ref : null;
  }

  rawCampaignContractDigest(contractPath, cwd) {
    if (typeof contractPath !== 'string' || contractPath.length === 0) return null;
    const absolute = path.isAbsolute(contractPath)
      ? contractPath
      : path.resolve(cwd || this.cwd, contractPath);
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
    } catch (_error) {
      return null;
    }
  }

  reconcileManagedMissionTerminal({
    campaignControl,
    outcome,
    observedAt,
    cwd,
  }) {
    const claim = campaignControl && campaignControl.mission_claim;
    const contract = campaignControl && campaignControl.contract;
    if (!contract || !contract.mission_runtime) {
      return { status: 'not_applicable' };
    }
    if (!claim) return { status: 'rejected', reason: 'mission_claim_missing' };
    const store = this.missionCampaignStore;
    if (!store
        || typeof store.load !== 'function'
        || typeof store.save !== 'function'
        || typeof store.journalTerminal !== 'function'
        || typeof store.markTerminalApplied !== 'function') {
      return { status: 'rejected', reason: 'terminal_journal_store_required' };
    }
    const rawDigest = this.rawCampaignContractDigest(
      campaignControl.contract_path,
      cwd,
    );
    if (!rawDigest) {
      return { status: 'rejected', reason: 'campaign_contract_digest_unavailable' };
    }
    if (rawDigest !== campaignControl.contract_digest) {
      return { status: 'rejected', reason: 'campaign_contract_changed_before_terminal' };
    }
    return this.missionTerminalReconciler({
      store,
      grantRef: contract.mission_grant_ref,
      claimId: claim.claim_id,
      iccCampaignId: campaignControl.campaign_id,
      rawCampaignContractDigest: rawDigest,
      outcome,
      possiblyEffectful: true,
      observedAt,
    });
  }

  completeManagedCampaignTerminal({
    campaignControl,
    outcome,
    observedAt,
    cwd,
  }) {
    let missionTerminal;
    try {
      missionTerminal = this.reconcileManagedMissionTerminal({
        campaignControl,
        outcome,
        observedAt,
        cwd,
      });
    } catch (error) {
      missionTerminal = {
        status: 'rejected',
        reason: error.code || error.message || String(error),
      };
    }
    campaignControl.mission_terminal_reconciliation = missionTerminal;

    let completion;
    try {
      completion = this.campaignAdmissionCompleter({
        repo: cwd,
        campaignControl,
      });
    } catch (error) {
      completion = {
        status: 'blocked',
        reason: error.code || error.message || String(error),
      };
    }
    campaignControl.completion = completion;

    if (!new Set(['applied', 'replay_noop', 'not_applicable']).has(missionTerminal.status)) {
      return {
        status: 'blocked',
        phase: 'mission_terminal_reconciliation',
        reason: missionTerminal.reason || 'Mission terminal reconciliation failed',
      };
    }
    if (!completion || completion.status !== 'completed') {
      return {
        status: 'blocked',
        phase: 'campaign_terminal_completion',
        reason: (completion && (completion.reason || completion.error))
          || 'campaign admission completion failed',
      };
    }
    return {
      status: 'completed',
      mission_terminal_reconciliation: missionTerminal,
      completion,
    };
  }

  terminalizeManagedCampaignFailure({
    campaignControl,
    reason,
    phase,
    cwd,
    observedAt = null,
    repairLineage = null,
  }) {
    const state = campaignControl && campaignControl.initial_state;
    if (!campaignControl || campaignControl.status !== 'admitted'
        || !state || !campaignControl.generation_claim
        || campaignControl.generation_claim.durable_journal !== true) {
      return { status: 'not_applicable' };
    }
    const possiblyEffectful = state.event_count > 0
      || state.phase !== CAMPAIGN_STATES.PREPARED
      || state.live_lease !== null;
    if (!possiblyEffectful) return { status: 'no_effect' };
    // Repair ladder (KR3, plan R2' 2026-08-21; STATELESS form after the
    // 2026-08-21 pre-merge review killed the durable-lock variant — a lock
    // with no reachable release is a worse failure mode than the expansion it
    // prevents). A campaign ADMITTED in BOUNDARY_REJECTED whose candidate is
    // GIT-VERIFIABLE (intake bound resume_candidate) is repairable in place;
    // converting it to a terminal without a repair attempt is the P6D failure
    // class and is refused, explanation-first. When intake could NOT bind a
    // verifiable candidate (e.g. a scope rejection that journaled no git
    // artifact), local repair is structurally impossible and terminalization
    // proceeds — refusing would deadlock a legitimately dead campaign.
    // First observations are untouched (fresh failures arrive here with
    // initial_state.phase != BOUNDARY_REJECTED).
    const ladderBoundary = repairLadder.extractBoundaryEvidence(state);
    // Production shape: intake attaches resume bindings to the GENERATION-CLAIM
    // object (campaign-intake.js — surfaced as campaignControl.generation_claim),
    // the same path every other engine reader uses. Only the GIT-BOUND
    // resume_candidate counts: resume_durable_wait.candidate_ref is a recorded
    // reducer string (boundary.candidate_ref first, git commit only third) and
    // admitting it would reinstate the no-git-object livelock the R2 review
    // traced. Recorded-ref-without-git-object therefore terminalizes freely.
    const ladderRepairable = Boolean(campaignControl.generation_claim
      && campaignControl.generation_claim.resume_candidate);
    if (ladderBoundary && ladderRepairable) {
      const ladder = repairLadder.evaluateRepairLadder({
        boundary: ladderBoundary,
        rerun: campaignControl.repair_rerun || null,
        terminalEvidence: campaignControl.engine_terminal_evidence || null,
        context: 'campaign failure terminalization',
      });
      if (!ladder.ok) {
        return {
          status: 'rejected',
          code: ladder.code,
          reason: ladder.reason,
          remedy: ladder.remedy,
        };
      }
    }
    const terminalAt = observedAt || this.now();
    const terminalReason = typeof reason === 'string' && reason.trim().length > 0
      ? reason
      : 'managed campaign stopped after a possibly-effectful attempt';
    const receiptBody = {
      schema_version: 1,
      artifact_type: 'implementation_campaign_failure',
      campaign_id: campaignControl.campaign_id,
      contract_digest: campaignControl.contract_digest,
      generation: state.generation,
      phase: typeof phase === 'string' && phase.length > 0 ? phase : state.phase,
      reason: terminalReason,
      possibly_effectful: true,
      observed_at: terminalAt,
      repair_lineage_disposition: repairLineage
        ? repairLineage.terminal_worktree_disposition
        : null,
    };
    const receiptDigest = campaignCanonicalDigest(receiptBody);
    const hasLiveLease = state.live_lease !== null;
    const terminalEventType = hasLiveLease
      ? CAMPAIGN_EVENTS.MUTATION_FAILED
      : CAMPAIGN_EVENTS.TERMINAL_STOP;
    const terminalIdentity = resolveCampaignEventLeaseIdentity(
      state,
      terminalEventType,
      {
        generation: state.generation,
        stageIdentity: `campaign-terminal-stop:${state.generation}`,
      },
    );
    let appended;
    try {
      appended = this.campaignEventAppender({
        repo: cwd,
        campaignControl,
        observedAt: terminalAt,
        eventType: terminalEventType,
        generation: terminalIdentity.generation,
        stageIdentity: terminalIdentity.stage_identity,
        payload: hasLiveLease
          ? {
            reason: terminalReason,
            failure_receipt_digest: receiptDigest,
            possibly_effectful: true,
          }
          : {
            reason: terminalReason,
            stop_receipt_digest: receiptDigest,
          },
        artifactReference: {
          kind: 'campaign_terminal',
          digest: receiptDigest,
          ...(repairLineage ? {
            repair_lineage: { ...repairLineage },
          } : {}),
        },
      });
    } catch (error) {
      return {
        status: 'blocked',
        phase: 'campaign_terminal_journal',
        reason: error.code || error.message || String(error),
      };
    }
    if (!appended || appended.status !== 'appended' || !appended.state || !appended.event) {
      return {
        status: 'blocked',
        phase: 'campaign_terminal_journal',
        reason: 'campaign event appender did not return durable terminal state',
      };
    }
    campaignControl.initial_state = appended.state;
    campaignControl.terminal_event = appended.event;
    campaignControl.failure_receipt = {
      ...receiptBody,
      receipt_digest: receiptDigest,
    };
    const completed = this.completeManagedCampaignTerminal({
      campaignControl,
      outcome: 'blocked',
      observedAt: appended.event.timestamp,
      cwd,
    });
    return completed.status === 'completed'
      ? { ...completed, status: 'terminalized', event: appended.event }
      : completed;
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
    const reservationIdentity = input.reservationIdentity || null;

    if (reservationIdentity !== null
        && !/^[0-9a-f]{64}$/.test(reservationIdentity)) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_review', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_review',
        reason: 'review reservation identity must be a canonical sha256 digest',
        verdict: null,
        roster,
        resolveResult,
        reviewResult: null,
        review: null,
        reviewArgs,
        ledger,
      };
    }

    let rosterArgs = Object.prototype.hasOwnProperty.call(input, 'rosterArgs')
      ? input.rosterArgs
      : ['--check-scorecard'];
    // Cascade producer (four-layer P2): a caller re-dispatching review after a round that
    // ended no_verdict/ambiguous passes that status; the resolver elevates computed risk to
    // high so the SAME families/cross-family escalation path seats a fresh disjoint-family
    // reviewer instead of retrying the identical seat. Absent/none = byte-identical resolution.
    if (input.priorStatus !== undefined && input.priorStatus !== null && input.priorStatus !== 'none') {
      if (input.priorStatus !== 'no_verdict' && input.priorStatus !== 'ambiguous') {
        throw new TypeError('priorStatus must be none|no_verdict|ambiguous');
      }
      rosterArgs = [...rosterArgs, '--prior-status', input.priorStatus];
    }
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
      input.pinReviewerTuple !== true
      &&
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
    }) && input.pinReviewerTuple !== true) {
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
    let reviewOptions;
    try {
      reviewOptions = {
        ...(input.reviewOptions || {}),
      };
      if (reservationIdentity !== null) {
        reviewOptions.env = {
          ...((isObj(reviewOptions.env) && reviewOptions.env) || process.env),
          AUTOPILOT_EFFECT_RESERVATION_ID: reservationIdentity,
        };
        reviewOptions.idempotencyKey = reservationIdentity;
      }
      reviewResult = this.reviewDispatcher(reviewArgs, reviewOptions);
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
    if (this.reviewPostProviderHook) {
      this.reviewPostProviderHook({
        reservation_identity: reservationIdentity,
        review_args: reviewArgs,
        review_options: reviewOptions,
        provider_result: reviewResult,
      });
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
    if (Object.prototype.hasOwnProperty.call(input, 'zeroDiffReceipt')) {
      const startedAt = this.now();
      ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', startedAt));
      return {
        status: 'blocked',
        phase: 'prepare_implementation',
        code: 'CALLER_ZERO_DIFF_AUTHORITY_FORBIDDEN',
        reason: 'zero-diff authority must come from ordinary durable Mission admission',
        dispatcher_called: false,
        roster,
        resolveResult,
        implementationResult: null,
        implementationArgs: null,
        implementation: null,
        ledger,
      };
    }

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

    const implementationBaseEnv = Object.prototype.hasOwnProperty.call(
      implementationOptionsInput,
      'env',
    )
      ? implementationOptionsInput.env
      : process.env;
    let resolvedImplementationStage;
    let campaignLifecycleRoot = null;
    let campaignAuthority = null;
    let campaignUnit = null;
    let campaignSealedScope = null;
    try {
      resolvedImplementationStage = resolveImplementationLedgerStage({
        implementationStage: input.implementationStage,
        implementationRound: input.implementationRound,
        runId: input.runId,
      });
      if (input.campaignContractFile) {
        campaignAuthority = deriveCampaignLifecycleRoot({
          campaignContractFile: input.campaignContractFile,
          campaignContractDigest: input.campaignContractDigest,
          campaignSealFile: input.campaignSealFile,
          runId: input.runId,
          cwd: resolvedTaskCwd,
        });
        campaignLifecycleRoot = campaignAuthority.campaign_id;
        {
          const ladderSelection = applyImplementerLadder(roster, {
            unitClass: unitClassFromContract(campaignAuthority.contract),
            repairRound: repairRoundFromImplementationRound(input.implementationRound),
          });
          roster = ladderSelection.roster;
        }
        if (!implementationBaseEnv || typeof implementationBaseEnv !== 'object'
            || Array.isArray(implementationBaseEnv)) {
          throw new TypeError('managed implementation env must be an object');
        }
        if (campaignAuthority.strict) {
          const strictAuthority = normalizeCampaignAuthority(campaignAuthority.contract);
          campaignSealedScope = {
            allow_paths: [...strictAuthority.allowedPaths],
            max_files: strictAuthority.maxChangedFiles,
            max_diff_lines: strictAuthority.maxDiffLines,
          };
          const identityRejection = classifyManagedStrictRootIdentity(
            implementationBaseEnv,
            campaignAuthority.root_run_id,
          );
          if (identityRejection) {
            const blockedAt = this.now();
            ledger.push(this.ledgerEntry('prepare_implementation', 'blocked', blockedAt, {
              rejection_code: identityRejection.code,
              dispatcher_called: false,
            }));
            return {
              status: 'blocked',
              phase: 'prepare_implementation',
              code: identityRejection.code,
              reason: identityRejection.reason,
              // Mechanical never-dispatched proof — required for zero-effect
              // release; do not infer from null implementation fields alone.
              dispatcher_called: false,
              roster,
              resolveResult,
              implementationResult: null,
              implementationArgs: null,
              implementation: null,
              ledger,
            };
          }
          let missionZeroDiffReceipt = null;
          const missionRoutingConfig = path.join(
            resolvedTaskCwd,
            '.claude',
            'mission-routing-config.json',
          );
          if (projectMissionMode(resolvedTaskCwd) === 'enforce'
              && fs.existsSync(missionRoutingConfig)) {
            const missionRouting = admitMissionRouting({
              repoRoot: resolvedTaskCwd,
              entryLevel: 'l6',
              fallback: 'none',
            });
            const missionAdoption = Array.isArray(missionRouting.noop_adoptions)
              ? missionRouting.noop_adoptions.find((item) => (
                item && item.graph_node_id
                  === campaignAuthority.contract.mission_runtime.graph_node_id
              )) : null;
            if (missionAdoption) {
              missionZeroDiffReceipt = buildMissionZeroDiffReceipt({
                missionNoopAdoption: missionAdoption,
                campaignContract: campaignAuthority.contract,
                campaignContractSha256: input.campaignContractDigest,
                campaignId: campaignAuthority.campaign_id,
                branch: input.branch,
                base: input.base,
                runner: roster.implementer_runner,
                model: roster.implementer_engine,
                stage: resolvedImplementationStage,
                rootRunId: implementationBaseEnv.AUTOPILOT_ROOT_RUN_ID,
              });
            }
          }
          campaignUnit = writeCampaignDispatchUnit({
            campaignContract: campaignAuthority.contract,
            campaignContractSha256: input.campaignContractDigest,
            campaignId: campaignAuthority.campaign_id,
            branch: input.branch,
            base: input.base,
            runner: roster.implementer_runner,
            model: roster.implementer_engine,
            stage: resolvedImplementationStage,
            rootRunId: implementationBaseEnv.AUTOPILOT_ROOT_RUN_ID,
            ...(missionZeroDiffReceipt
              ? { zeroDiffReceipt: missionZeroDiffReceipt } : {}),
          });
        }
      }
      {
        const ladderSelection = applyImplementerLadder(roster, {
          unitClass: unitClassFromContract(
            campaignAuthority && campaignAuthority.contract
              ? campaignAuthority.contract
              : null,
          ),
          repairRound: repairRoundFromImplementationRound(input.implementationRound),
        });
        roster = ladderSelection.roster;
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
        campaignSealFile: input.campaignSealFile || null,
        campaignUnitContractFile: campaignUnit ? campaignUnit.contract_path : null,
        campaignRunId: input.runId || null,
        campaignStage: resolvedImplementationStage,
        keepWorktree: input.keepWorktree === true,
        reuseWorktree: input.reuseWorktree || null,
        resumeSessionId: input.resumeSessionId || null,
        retentionOwner: input.retentionOwner || null,
        retentionReason: input.retentionReason || null,
        retentionExpiresAt: input.retentionExpiresAt || null,
        expectedWorktreeInstanceId: input.expectedWorktreeInstanceId || null,
      });
    } catch (error) {
      if (campaignUnit) {
        try {
          campaignUnit.cleanup();
        } catch (_cleanupError) {
          // The original pre-dispatch rejection remains authoritative.
        }
      }
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
    let continuationWorkOrderRef = null;
    let continuationCommonDir = null;

    // Pre-dispatch continuation admission (Work Order v2 + mandatory PostCompact).
    // Work Order create/claim is unconditional for active Mission/root before any
    // branch/worktree/runner effects; controller identity is this engine process.
    {
      const ck = input.continuationCheckpoint || input.continuation_checkpoint || null;
      const ckPath = input.continuationCheckpointPath || input.continuation_checkpoint_path
        || process.env.AUTOPILOT_CONTINUATION_CHECKPOINT || null;
      const dur = input.continuationDurable || input.continuation_durable || null;
      const durPath = input.continuationDurablePath || input.continuation_durable_path
        || process.env.AUTOPILOT_CONTINUATION_DURABLE || null;
      const identityRoot = (campaignAuthority && campaignAuthority.root_run_id)
        || (implementationBaseEnv && implementationBaseEnv.AUTOPILOT_ROOT_RUN_ID)
        || process.env.AUTOPILOT_ROOT_RUN_ID || process.env.AUTOPILOT_MISSION_ROOT_RUN_ID
        || input.rootRunId || input.root_run_id || null;
      const gitCwdForCont = resolvedTaskCwd || this.cwd || process.cwd();
      const commonDirForCont = workOrder.resolveGitCommonDir(gitCwdForCont);
      continuationCommonDir = commonDirForCont;
      // Exact-root only — never enumerate with null root (global scan banned).
      let nonterminalWOs = [];
      const rootOk = typeof identityRoot === 'string' && identityRoot.length > 0;
      if (commonDirForCont && rootOk) {
        try {
          // Controller-authority Work Orders share the campaign root but are not
          // implementer continuation claims — exclude them so they never force
          // reconcile_receipt_missing for ordinary implementation dispatches.
          nonterminalWOs = workOrder.listNonterminalWorkOrders(commonDirForCont, identityRoot)
            .filter((entry) => !(
              entry
              && entry.work_order
              && entry.work_order.role === 'controller'
            ));
        } catch (enumErr) {
          const err = new Error(`work order root enumeration failed: ${enumErr.message || String(enumErr)}`);
          err.code = 'work_order_enum_failed';
          throw err;
        }
      } else if (commonDirForCont && !rootOk
          && (input.missionActive === true || process.env.AUTOPILOT_MISSION_ROOT_RUN_ID)) {
        const err = new Error('root_run_id is mandatory for mission/root work order enumeration');
        err.code = 'root_run_id_required';
        throw err;
      }
      // Active-root Work Orders force reconcile. Bare campaignAuthority alone must NOT —
      // campaign-dispatch-projection and other Mission callers without WOs keep working.
      const hasActiveRootWorkOrders = nonterminalWOs.length > 0;
      const missionActive = Boolean(
        input.missionActive === true
        || hasActiveRootWorkOrders
        || (process.env.AUTOPILOT_MISSION_ROOT_RUN_ID && hasActiveRootWorkOrders),
      );
      const hasCont = Boolean(ck || ckPath || dur || durPath
        || input.continuationMatchingRuns || input.continuation_matching_runs
        || process.env.AUTOPILOT_CONTINUATION_STRICT === '1'
        || process.env.AUTOPILOT_RECONCILE_RECEIPT
        || input.reconcileReceipt || input.reconcileReceiptPath
        || hasActiveRootWorkOrders
        || input.missionActive === true);
      if (hasCont) {
        const manifestDir = input.continuationManifestDir || process.env.AUTOPILOT_DISPATCH_RUNS_DIR
          || path.join(process.env.TMPDIR || '/tmp', 'autopilot-dispatch-runs');
        const matchingRuns = Array.isArray(input.continuationMatchingRuns)
          ? input.continuationMatchingRuns
          : Array.isArray(input.continuation_matching_runs)
            ? input.continuation_matching_runs
            : loadMatchingRunsFromManifestDir(manifestDir, {
              root_run_id: identityRoot, branch: input.branch,
              stage: resolvedImplementationStage, base_sha: input.base,
            });
        let narrative = input.continuationNarrative || input.continuation_narrative || null;
        if (!narrative && process.env.AUTOPILOT_CONTINUATION_NARRATIVE) {
          try { narrative = JSON.parse(process.env.AUTOPILOT_CONTINUATION_NARRATIVE); }
          catch (_e) { narrative = null; }
        }
        const controllerId = workOrder.captureProcessIdentity(process.pid);
        const admission = admitContinuation({
          identity: {
            root_run_id: identityRoot, branch: input.branch,
            stage: resolvedImplementationStage, base_sha: input.base,
          },
          checkpoint: ck, checkpointPath: ckPath, durable: dur, durablePath: durPath,
          narrative, matchingRuns, requireIdentity: true,
          strictMatch: process.env.AUTOPILOT_CONTINUATION_STRICT === '1'
            || input.strictContinuationMatch === true,
          gitCwd: gitCwdForCont, requireCommitInRepo: Boolean(gitCwdForCont),
          reconcileReceipt: input.reconcileReceipt || input.reconcile_receipt || null,
          reconcileReceiptPath: input.reconcileReceiptPath || input.reconcile_receipt_path
            || process.env.AUTOPILOT_RECONCILE_RECEIPT || null,
          requireReconcile: missionActive, missionActive,
          // Unconditional WO claim for active Mission/root — not only durable input.
          createWorkOrder: Boolean(dur || durPath || missionActive),
          claimWorkOrder: Boolean(dur || durPath || missionActive),
          graph_node: resolvedImplementationStage || 'implement',
          terminalReceipt: input.terminalReceipt || null,
          terminalReceiptPath: input.terminalReceiptPath || process.env.AUTOPILOT_TERMINAL_RECEIPT || null,
          owner: controllerId, ownerPid: controllerId.pid, controllerPid: controllerId.pid,
          ledgerPath: input.ledgerPath || process.env.AUTOPILOT_LEDGER_PATH || null,
          missionPath: input.missionPath || process.env.AUTOPILOT_MISSION_PATH || null,
          sealedScope: campaignSealedScope,
        });
        if (admission.status === 'reject' || admission.status === 'not_found') {
          const err = new Error(admission.reason || admission.reason_code || 'continuation admission rejected');
          err.code = admission.reason_code || 'continuation_admission_rejected';
          err.continuation_admission = admission;
          throw err;
        }
        if (admission.work_order || admission.work_order_path || admission.attached_run_id) {
          continuationWorkOrderRef = {
            path: admission.work_order_path || null,
            root_run_id: admission.root_run_id || identityRoot,
            graph_node: resolvedImplementationStage || 'implement',
            attempt: 1,
            work_order_id: admission.attached_run_id
              || (admission.work_order && admission.work_order.work_order_id) || null,
          };
        }
        if (admission.action === 'attach_active' || admission.action === 'attach_existing'
            || admission.action === 'consume_terminal' || admission.action === 'resume_terminal') {
          if (commonDirForCont && continuationWorkOrderRef) {
            const term = admission.terminal_status || null;
            const isConsume = admission.action === 'consume_terminal'
              || admission.action === 'resume_terminal';
            // Attach must not replace a live controller with this short-lived engine
            // process identity; only consume/terminal paths rewrite disposition.
            // Lifecycle update failures must not be swallowed.
            const life = workOrder.updateWorkOrderLifecycle(commonDirForCont, continuationWorkOrderRef, {
              ...(isConsume ? {
                owner: controllerId,
                terminal_status: term || 'aborted', disposition: 'consumed',
              } : { disposition: null }),
            }, { preserveOwner: !isConsume, bumpGeneration: isConsume, bindArtifacts: false });
            if (life && life.status === 'reject' && life.reason_code !== 'not_found') {
              const err = new Error(life.reason || 'work order lifecycle update failed on attach/consume');
              err.code = life.reason_code || 'work_order_lifecycle_failed';
              err.lifecycle = life;
              throw err;
            }
          }
          if (typeof this.cleanup === 'function') {
            try { this.cleanup(); } catch (_e) { /* attach authoritative */ }
          }
          const outStatus = (admission.action === 'consume_terminal'
            || admission.action === 'resume_terminal') ? 'consumed' : 'attached';
          const commit = admission.accepted_commit === 'none' ? null : admission.accepted_commit;
          const implResult = {
            status: outStatus, runner: 'continuation-admission', model: null,
            branch: input.branch, base: input.base, commit,
            files_changed: 0, insertions: 0, deletions: 0, worktree: null, agent_log: null, error: null,
            run_id: admission.attached_run_id, root_run_id: admission.root_run_id,
            phase_cursor: admission.phase_cursor, next_action: admission.next_action, duplicate_dispatch: 0,
          };
          return {
            status: outStatus, phase: 'continuation_admission', reason: admission.reason,
            reason_code: admission.reason_code, continuation_admission: admission, duplicate_dispatch: 0,
            root_run_id: admission.root_run_id, phase_cursor: admission.phase_cursor,
            accepted_commit: admission.accepted_commit, next_action: admission.next_action,
            attached_run_id: admission.attached_run_id,
            classification: admission.classification || admission.action,
            terminal_status: admission.terminal_status || null, roster, resolveResult,
            implementationResult: {
              status: 0, signal: null, stdout: '', stderr: '', result: implResult, parseError: null,
            },
            implementationArgs,
            implementation: {
              status: outStatus, commit, branch: input.branch, base: input.base,
              run_id: admission.attached_run_id, root_run_id: admission.root_run_id,
              phase_cursor: admission.phase_cursor, next_action: admission.next_action,
              duplicate_dispatch: 0,
            },
            ledger,
          };
        }
        // dispatch_new: transfer real runner identity + heartbeat before effects.
        if (commonDirForCont && continuationWorkOrderRef && admission.action === 'dispatch_new') {
          const life = workOrder.updateWorkOrderLifecycle(commonDirForCont, continuationWorkOrderRef, {
            owner: controllerId, runner: controllerId, next_action: admission.next_action || 'dispatch',
          }, { preserveOwner: false, bumpGeneration: false, bindArtifacts: false });
          if (!life || life.status !== 'written') {
            const err = new Error((life && life.reason) || 'work order lifecycle transfer failed before dispatch effects');
            err.code = (life && life.reason_code) || 'work_order_lifecycle_failed';
            err.lifecycle = life;
            throw err;
          }
        }
      }
    }

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
        campaignAuthority && campaignAuthority.strict
          ? campaignAuthority.root_run_id
          : (implementationBaseEnv.AUTOPILOT_ROOT_RUN_ID || managedTraceParent)
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


    let campaignUnitCleanupError = null;
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
    } finally {
      if (campaignUnit) {
        try {
          campaignUnit.cleanup();
        } catch (error) {
          campaignUnitCleanupError = error.message || String(error);
        }
      }
      // Terminal/receipt/heartbeat updates on every dispatch exit path — check result.
      if (continuationCommonDir && continuationWorkOrderRef) {
        const parsedExit = implementationResult && implementationResult.result
          ? implementationResult.result : null;
        const exitStatus = implementationResult && implementationResult.error
          ? 'failed'
          : (parsedExit && (parsedExit.status === 'failed' || parsedExit.status === 'error')
            ? 'failed'
            : (parsedExit && (parsedExit.status === 'success' || parsedExit.status === 'attached'
              || parsedExit.status === 'ok')
              ? 'success'
              : (implementationResult && implementationResult.status === 0 ? 'success' : 'failed')));
        const receiptPath = (parsedExit && parsedExit.receipt_path)
          || input.terminalReceiptPath || process.env.AUTOPILOT_TERMINAL_RECEIPT || null;
        const runnerId = workOrder.captureProcessIdentity(process.pid);
        const patch = {
          owner: runnerId, runner: runnerId, terminal_status: exitStatus, disposition: 'consumed',
        };
        if (receiptPath) {
          let dig = null;
          try {
            const raw = workOrder.readJsonIfPresent(receiptPath);
            if (raw) {
              const body = { ...raw }; delete body.digest;
              dig = workOrder.sha256Json(body);
            }
          } catch (_e) { dig = null; }
          if (!dig) {
            // Fail closed: terminal exit without a digest-bound receipt cannot be persisted as success.
            if (!implementationResult) implementationResult = { status: 1, error: 'terminal_receipt_digest_missing' };
            else implementationResult.error = implementationResult.error || 'terminal_receipt_digest_missing';
          } else {
            patch.expected_receipt = {
              path: receiptPath, digest: dig, artifact_type: workOrder.TERMINAL_RECEIPT_ARTIFACT,
            };
            patch.paths = { receipt: receiptPath };
          }
        }
        const life = workOrder.updateWorkOrderLifecycle(
          continuationCommonDir, continuationWorkOrderRef, patch,
          { preserveOwner: false, bumpGeneration: true, bindArtifacts: false },
        );
        if (!life || life.status !== 'written') {
          // Fail closed: lifecycle/update failure is always blocked — never leave committed.
          const code = (life && (life.reason_code || life.reason)) || 'work_order_lifecycle_failed';
          if (!implementationResult) {
            implementationResult = {
              status: 1, signal: null, stdout: '', stderr: '', result: null,
              parseError: null, error: code, lifecycle_error: code,
            };
          } else {
            implementationResult.lifecycle_error = code;
            if (implementationResult.status === 0) implementationResult.status = 1;
            if (implementationResult.result && implementationResult.result.status === 'committed') {
              implementationResult.result = {
                ...implementationResult.result,
                status: 'failed',
                error: implementationResult.result.error || code,
              };
            }
          }
        }
      }
    }
    // Fault-injection hook: tests force lifecycle failure after a committed dispatch.
    if (process.env.AUTOPILOT_FAULT_INJECT_LIFECYCLE === '1' && implementationResult) {
      implementationResult.lifecycle_error = implementationResult.lifecycle_error
        || 'fault_inject_lifecycle_update';
      if (implementationResult.status === 0) implementationResult.status = 1;
      if (implementationResult.result && implementationResult.result.status === 'committed') {
        implementationResult.result = {
          ...implementationResult.result,
          status: 'failed',
          error: implementationResult.result.error || 'fault_inject_lifecycle_update',
        };
      }
    }
    let blockedReason = implementationResultBlocked(implementationResult);
    let parsed = implementationResult && implementationResult.result ? implementationResult.result : null;
    let reconciledByLedger = false;
    let reconcileDetails = null;
    if (!blockedReason && campaignUnitCleanupError) {
      blockedReason = `campaign dispatch-unit cleanup failed: ${campaignUnitCleanupError}`;
    }
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
    const usageAuthorityViolation = dispatcherUsageAuthorityViolation(parsed);
    if (!blockedReason && campaignUnit && parsed && parsed.status === 'committed') {
      blockedReason = campaignStrictResultBlocked(parsed, {
        campaign_contract_sha256: input.campaignContractDigest,
        contract_sha256: campaignUnit.contract_sha256,
        contract: campaignUnit.contract,
        campaign_id: campaignAuthority.campaign_id,
        branch: input.branch,
        base: input.base,
      });
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
        runner: parsed ? parsed.runner : roster.implementer_runner,
        model: parsed ? parsed.model : roster.implementer_engine,
        implementer_ladder_rung: Number.isInteger(roster.implementer_ladder_rung)
          ? roster.implementer_ladder_rung
          : null,
        implementer_effort: roster.implementer_effort,
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

    if (usageAuthorityViolation) {
      return {
        status: 'blocked',
        phase: 'dispatcher_outcome_authority',
        reason: `invalid dispatcher usage evidence: ${usageAuthorityViolation}`,
        roster,
        resolveResult,
        implementationResult,
        implementationArgs,
        implementation: parsed,
        dispatcher_called: true,
        // The rail was invoked. Reject its forged observation and charge one
        // conservative call rather than silently normalizing the supplied value.
        model_calls: 1,
        ledger,
      };
    }

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
        dispatcher_called: true,
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
        dispatcher_called: true,
        ledger,
      };
    }

    if (!parsed || parsed.status !== 'committed') {
      if (parsed
          && isExactSealedZeroDiffLeaf(parsed, campaignUnit && campaignUnit.contract)) {
        return {
          status: 'no_op',
          phase: 'sealed_zero_diff',
          reason: null,
          roster,
          resolveResult,
          implementationResult,
          implementationArgs,
          implementation: parsed,
          dispatcher_called: false,
          model_calls: 0,
          zero_effect: true,
          unit_contract: campaignUnit.contract,
          ledger,
        };
      }
      if (parsed && isExactZeroEffectPreconditionLeaf(parsed)) {
        return {
          status: 'blocked',
          phase: 'precondition_failed',
          reason: parsed.error || parsed.reason || 'dispatcher precondition rejected',
          roster,
          resolveResult,
          implementationResult,
          implementationArgs,
          implementation: parsed,
          dispatcher_called: false,
          model_calls: 0,
          zero_effect: true,
          ledger,
        };
      }
      if (parsed && parsed.dispatcher_called === false) {
        return {
          status: 'blocked',
          phase: 'dispatcher_outcome_authority',
          reason: 'dispatcher_called:false contradicts non-zero or non-closed outcome evidence',
          roster,
          resolveResult,
          implementationResult,
          implementationArgs,
          implementation: parsed,
          // The exemption is rejected. Charge conservatively as an invoked rail.
          dispatcher_called: true,
          model_calls: Number.isSafeInteger(parsed.model_calls)
            && parsed.model_calls >= 0 ? Math.max(1, parsed.model_calls) : 1,
          ledger,
        };
      }
      // Preserve boundary_rejected as a first-class non-success outcome with
      // candidate reference and exact boundary reason — never collapse to
      // unknown status or fabricated mutation-failure evidence.
      if (parsed && parsed.status === 'boundary_rejected') {
        return {
          status: 'boundary_rejected',
          phase: 'boundary_rejected',
          reason: parsed.error || parsed.reason || 'boundary rejected',
          boundary_reason: parsed.error || parsed.reason || 'boundary rejected',
          boundary_code: parsed.boundary_code || 'scope_or_budget_boundary',
          candidate_ref: parsed.commit || parsed.candidate_ref || parsed.tip || null,
          possibly_effectful: Boolean(parsed.commit || parsed.candidate_ref || parsed.tip),
          mutation_failed: false,
          unknown_status: false,
          roster,
          resolveResult,
          implementationResult,
          implementationArgs,
          implementation: parsed,
          dispatcher_called: true,
          model_calls: Number.isSafeInteger(parsed.model_calls)
            && parsed.model_calls >= 0 ? parsed.model_calls : 1,
          ledger,
        };
      }
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
        dispatcher_called: true,
        model_calls: Number.isSafeInteger(parsed && parsed.model_calls)
          && parsed.model_calls >= 0 ? parsed.model_calls : 1,
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
      dispatcher_called: true,
      model_calls: Number.isSafeInteger(parsed.model_calls)
        && parsed.model_calls >= 0 ? parsed.model_calls : 1,
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
    const repairFindingOccurrences = new Map();
    const acceptedInvariantIds = new Set();
    let previousRepairFindingCount = null;
    let nonReductionRounds = 0;
    const noRegressionAssertions = Array.isArray(campaignControl.contract.vertical_acceptance)
      ? [...campaignControl.contract.vertical_acceptance]
      : [];
    const campaignStartedAtEpoch = Math.floor(
      Date.parse(campaignControl.initial_state.started_at) / 1000,
    );
    const retentionExpiresAt = campaignStartedAtEpoch
      + campaignControl.contract.max_wall_seconds;
    const repairLineage = {
      lineage_id: campaignControl.campaign_id,
      branch,
      worktree: null,
      provider_session_id: null,
      provider_session_reused: false,
      provider_session_non_reuse_reason: null,
      worktree_reused: false,
      worktree_instance_id: null,
      cleanup_epoch: 0,
      cleanup_receipt_id: null,
      generation: campaignControl.initial_state.generation,
      inherited_churn: campaignControl.initial_state.usage.churn,
      delta_churn: 0,
      retention_owner: campaignControl.campaign_id,
      retention_reason: 'implementation-campaign-repair-lineage',
      retention_expires_at: retentionExpiresAt,
      terminal_worktree_disposition: 'active',
      transcript_reused: false,
      transcript_source_digest: campaignCanonicalDigest({
        status: 'not_dispatched',
      }),
      review_input_mode: 'full_diff_generation',
      new_input_bytes: 0,
      new_input_tokens: null,
      input_token_measurement: 'unavailable',
      finding_occurrences: [],
      accepted_invariant_ids: [],
      accepted_invariants: [],
      accepted_invariants_source_commit: null,
      accepted_invariants_digest: null,
      prior_review_finding_ids: [],
      previous_repair_finding_count: null,
      non_reduction_rounds: 0,
      repair_scope_paths: [],
      repair_scope_seal: null,
    };
    const durableJournal = campaignControl.generation_claim.durable_journal === true;
    const resumeCandidate = campaignControl.generation_claim.resume_candidate || null;
    const resumeReviewDigest = campaignControl.generation_claim.resume_review_digest || null;
    let scopeSession = null;
    let currentBase = base;
    let repairPromptFile = promptFile;
    let latestReview = null;
    let latestAdjudication = null;
    let latestVerification = null;
    let priorReviewFindingIds = new Set();
    let implementationRound = 0;
    let resumeSetupError = null;
    let lifecycleSetupError = null;
    let lifecycleReceiptRef = 'unknown';
    const syncRepairFindingState = () => {
      repairLineage.finding_occurrences = [...repairFindingOccurrences.entries()]
        .map(([findingId, occurrences]) => ({
          finding_id: findingId,
          occurrences,
        }))
        .sort((left, right) => left.finding_id.localeCompare(right.finding_id));
      repairLineage.accepted_invariant_ids = [...acceptedInvariantIds].sort();
      repairLineage.prior_review_finding_ids = [...priorReviewFindingIds].sort();
      repairLineage.previous_repair_finding_count = previousRepairFindingCount;
      repairLineage.non_reduction_rounds = nonReductionRounds;
    };
    const postDispatchLineageFailure = (reason) => {
      repairLineage.terminal_worktree_disposition = repairLineage.worktree === null
        ? 'not_created_failed_dispatch'
        : 'retained_failed_dispatch';
      return {
        committed: false,
        phase: 'campaign_repair_lineage',
        reason,
        repair_lineage: { ...repairLineage },
      };
    };
    const recordAcceptedVerificationInvariants = (sourceCommit) => {
      acceptedInvariantIds.clear();
      for (const assertion of noRegressionAssertions) {
        acceptedInvariantIds.add(
          `acceptance:${crypto.createHash('sha256').update(assertion).digest('hex')}`,
        );
      }
      repairLineage.accepted_invariants = [...noRegressionAssertions];
      repairLineage.accepted_invariants_source_commit = sourceCommit;
      repairLineage.accepted_invariants_digest = campaignCanonicalDigest({
        schema: 1,
        assertions: repairLineage.accepted_invariants,
        source_commit: sourceCommit,
      });
      syncRepairFindingState();
    };

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
        if (!resumeCandidate.repair_lineage
            || resumeCandidate.repair_lineage.lineage_id !== campaignControl.campaign_id
            || resumeCandidate.repair_lineage.branch !== branch
            || typeof resumeCandidate.repair_lineage.worktree !== 'string'
            || !path.isAbsolute(resumeCandidate.repair_lineage.worktree)) {
          throw new Error('campaign resume is missing exact repair resource lineage');
        }
        Object.assign(
          repairLineage,
          JSON.parse(JSON.stringify(resumeCandidate.repair_lineage)),
          {
            worktree_reused: true,
            generation: campaignControl.initial_state.generation,
          },
        );
        if (!Number.isSafeInteger(repairLineage.cleanup_epoch)
            || repairLineage.cleanup_epoch < 0) {
          throw new Error('campaign resume has an invalid cleanup epoch');
        }
        if (repairLineage.worktree_instance_id !== null
            && !/^[0-9a-f]{64}$/.test(repairLineage.worktree_instance_id)) {
          throw new Error('campaign resume has an invalid worktree instance identity');
        }
        for (const item of resumeCandidate.repair_lineage.finding_occurrences || []) {
          repairFindingOccurrences.set(item.finding_id, item.occurrences);
        }
        for (const findingId of
          resumeCandidate.repair_lineage.accepted_invariant_ids || []) {
          acceptedInvariantIds.add(findingId);
        }
        priorReviewFindingIds = new Set(
          resumeCandidate.repair_lineage.prior_review_finding_ids || [],
        );
        previousRepairFindingCount =
          resumeCandidate.repair_lineage.previous_repair_finding_count;
        nonReductionRounds = resumeCandidate.repair_lineage.non_reduction_rounds || 0;
        syncRepairFindingState();
      } catch (error) {
        resumeSetupError = error.message || String(error);
      }
    }

    const prepareReview = ({
      candidate,
      scope,
      repair_generation: repairGeneration,
      reviewRoster = roster,
      review_input_mode: reviewInputMode = null,
      vertical_failed: verticalFailed = false,
      verification = null,
    }) => {
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
        return { prepared: false, reason: error.message || String(error) };
      }
      const specFile = promptFile;
      let diffDigest;
      let specDigest;
      try {
        diffDigest = crypto.createHash('sha256')
          .update(fs.readFileSync(diffFile)).digest('hex');
        specDigest = crypto.createHash('sha256')
          .update(fs.readFileSync(specFile)).digest('hex');
      } catch (error) {
        return { prepared: false, reason: error.message || String(error) };
      }
      const reviewPayload = {
        candidate,
        verification,
        repair_generation: repairGeneration,
        scope,
        review_input_mode: reviewInputMode,
        vertical_failed: verticalFailed === true,
      };
      return {
        prepared: true,
        authority: {
          schema_version: 1,
          artifact_type: 'controller_full_diff_review_input',
          candidate_ref: candidate && (candidate.commit || candidate.tree_sha),
          candidate_tree_sha: candidate && candidate.tree_sha,
          base_sha: candidate && candidate.base_sha || base,
          diff_digest: diffDigest,
          spec_digest: specDigest,
          review_input_digest: campaignCanonicalDigest(reviewPayload),
          reviewer: {
            runner: reviewRoster.reviewer_runner,
            model: reviewRoster.reviewer_engine,
            effort: reviewRoster.reviewer_effort,
            endpoint: reviewRoster.reviewer_endpoint || null,
          },
        },
        diff_file: path.resolve(diffFile),
        spec_file: path.resolve(specFile),
        blind_discovery: true,
        prior_findings_included: false,
        full_diff_required: true,
      };
    };

    const performReview = ({
      candidate,
      verification = null,
      scope,
      repair_generation: repairGeneration,
      review_input_mode: reviewInputMode = null,
      vertical_failed: verticalFailed = false,
      reviewRoster = roster,
      reviewStage = null,
      pinReviewerTuple = false,
      prepared_review: preparedReview = null,
      reservation_identity: reservationIdentity = null,
    }) => {
      const prepared = preparedReview || prepareReview({
        candidate,
        verification,
        scope,
        repair_generation: repairGeneration,
        review_input_mode: reviewInputMode,
        vertical_failed: verticalFailed,
        reviewRoster,
      });
      if (!isObj(prepared)
          || prepared.prepared !== true
          || !isObj(prepared.authority)
          || !isStr(prepared.diff_file)
          || !isStr(prepared.spec_file)) {
        return {
          reviewed: false,
          reason: prepared && prepared.reason
            ? prepared.reason : 'full-diff review preparation is incomplete',
        };
      }
      const authority = prepared.authority;
      const reviewPayload = {
        candidate,
        verification,
        repair_generation: repairGeneration,
        scope,
        review_input_mode: reviewInputMode,
        vertical_failed: verticalFailed === true,
      };
      let observedDiffDigest;
      let observedSpecDigest;
      try {
        observedDiffDigest = crypto.createHash('sha256')
          .update(fs.readFileSync(prepared.diff_file)).digest('hex');
        observedSpecDigest = crypto.createHash('sha256')
          .update(fs.readFileSync(prepared.spec_file)).digest('hex');
      } catch (error) {
        return { reviewed: false, reason: error.message || String(error) };
      }
      if (authority.candidate_ref !== (candidate && (candidate.commit || candidate.tree_sha))
          || authority.candidate_tree_sha !== (candidate && candidate.tree_sha)
          || authority.base_sha !== (candidate && candidate.base_sha || base)
          || authority.diff_digest !== observedDiffDigest
          || authority.spec_digest !== observedSpecDigest
          || authority.review_input_digest !== campaignCanonicalDigest(reviewPayload)
          || !isObj(authority.reviewer)
          || authority.reviewer.runner !== reviewRoster.reviewer_runner
          || authority.reviewer.model !== reviewRoster.reviewer_engine
          || authority.reviewer.effort !== reviewRoster.reviewer_effort
          || authority.reviewer.endpoint !== (reviewRoster.reviewer_endpoint || null)) {
        return {
          reviewed: false,
          reason: 'prepared full-diff authority drifted before provider invocation',
        };
      }
      const diffFile = prepared.diff_file;
      const budgetAt = this.now();
      const budget = campaignWallBudgetStatus(campaignControl, budgetAt);
      if (budget.exhausted) {
        return {
          reviewed: false,
          phase: 'campaign_wall_budget',
          reason: 'campaign wall budget exhausted before review',
        };
      }
      const previousReviewForRemediation = repairGeneration > 0 ? latestReview : null;
      let reviewed = this.reviewDiff({
        diffFile,
        specFile: promptFile,
        roster: reviewRoster,
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
        reviewStage: reviewStage || (scope === 'final'
          ? 'campaign-final-review'
          : `campaign-review#r${repairGeneration + 1}`
        ),
        reviewOptions: {
          ...(input.reviewOptions || {}),
          cwd: loopCwd,
          blindDiscovery: true,
        },
        requireQualifiedReviewer: scope === 'final' ? true : requireQualifiedReviewer,
        pinReviewerTuple,
        reservationIdentity,
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
      if (repairGeneration > 0 && previousReviewForRemediation) {
        const priorFindings = namedReviewFindings(previousReviewForRemediation);
        const currentFindings = namedReviewFindings(reviewed);
        let remediationCheck;
        if (!priorFindings || !currentFindings) {
          remediationCheck = {
            schema_version: 1,
            artifact_type: 'review_remediation_check',
            status: 'needs_full_review',
            authority: 'non_authoritative',
            whole_candidate_pass: false,
            gate_clear: false,
            fallback_to_full_blind_review: true,
            reason: !currentFindings
              ? 'current full-review findings are missing or malformed'
              : 'prior full-review findings are missing or malformed',
          };
        } else try {
          remediationCheck = runRemediationCheckerBoundary(this.remediationChecker, {
            repo: loopCwd,
            previousCommit: currentBase,
            currentCommit: candidate.commit,
            previousFindings: priorFindings,
            currentFindings,
            repairGeneration,
          });
        } catch (error) {
          remediationCheck = {
            schema_version: 1,
            artifact_type: 'review_remediation_check',
            status: 'needs_full_review',
            authority: 'non_authoritative',
            whole_candidate_pass: false,
            gate_clear: false,
            fallback_to_full_blind_review: true,
            reason: error.message || String(error),
          };
        }
        reviewed = {
          ...reviewed,
          remediation_check: remediationCheck && typeof remediationCheck === 'object'
            ? remediationCheck
            : {
              schema_version: 1,
              artifact_type: 'review_remediation_check',
              status: 'needs_full_review',
              authority: 'non_authoritative',
              whole_candidate_pass: false,
              gate_clear: false,
              fallback_to_full_blind_review: true,
              reason: 'remediation checker returned no receipt',
            },
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
        priorReviewFindingIds = new Set(
          normalized.findings.map((finding) => finding.finding_id),
        );
        syncRepairFindingState();
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
              repair_lineage: { ...repairLineage },
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
        review_input_mode: 'full_diff_generation',
        blind_discovery: true,
        prior_findings_included: false,
        full_diff_required: true,
        raw: reviewed,
      };
    };

    const finalPanelSeatReceipt = (seat, seatIndex, outcome) => {
      const isReviewed = outcome && outcome.reviewed === true;
      let status = 'no_verdict';
      if (!isReviewed && outcome && outcome.phase === 'product_review_normalization') {
        status = 'parser_failed';
      } else if (!isReviewed && outcome && outcome.raw && outcome.raw.reviewResult
          && (outcome.raw.reviewResult.error || outcome.raw.reviewResult.signal
            || outcome.raw.reviewResult.status !== 0)) {
        status = 'transport_failed';
      } else if (!isReviewed && outcome && outcome.phase === 'reviewer_qualification') {
        status = 'precondition_failed';
      }
      const body = {
        schema_version: 1,
        artifact_type: 'implementation_campaign_final_panel_seat',
        seat_index: seatIndex + 1,
        runner: seat.runner,
        model: seat.model,
        effort: seat.effort,
        endpoint: seat.endpoint === undefined ? null : seat.endpoint,
        family: seat.family,
        status: isReviewed ? 'reviewed' : status,
        verdict: isReviewed ? outcome.verdict : null,
        review_digest: isReviewed ? outcome.review_digest : null,
        reason: isReviewed ? null : `final_panel_seat_${status}`,
      };
      return { ...body, receipt_digest: campaignCanonicalDigest(body) };
    };

    const performFinalPanel = (reviewInput) => {
      const minPanelSize = roster.min_panel_size;
      const seats = roster.qc_panel_seats_complete === true
        && Array.isArray(roster.qc_panel_seats)
        ? roster.qc_panel_seats
        : null;
      if (!Number.isSafeInteger(minPanelSize) || minPanelSize < 1 || !seats) {
        return {
          reviewed: false,
          sealed_min_panel_size: minPanelSize,
          final_panel_count: 0,
          final_panel_seat_receipts: [],
        };
      }
      if (!terminalPanelCrossFamilySatisfied(roster, seats)) {
        return {
          reviewed: false,
          sealed_min_panel_size: minPanelSize,
          final_panel_count: 0,
          final_panel_seat_receipts: [],
        };
      }
      const outcomes = seats.map((seat, index) => {
        const reviewRoster = {
          ...roster,
          reviewer_runner: seat.runner,
          reviewer_engine: seat.model,
          reviewer_effort: seat.effort,
          reviewer_endpoint: seat.endpoint || '',
          reviewer_qualified: finalPanelSeatQualified(roster, seat),
        };
        const outcome = finalPanelSeatQualified(roster, seat)
          ? performReview({
            ...reviewInput,
            scope: 'final',
            reviewRoster,
            reviewStage: `campaign-final-review#seat-${index + 1}`,
            pinReviewerTuple: true,
          })
          : {
            reviewed: false,
            phase: 'reviewer_qualification',
            reason: 'final panel seat is not an exact qualified reviewer tuple',
          };
        return { seat, outcome };
      });
      const seatReceipts = outcomes.map(({ seat, outcome }, index) =>
        finalPanelSeatReceipt(seat, index, outcome));
      const reviewedOutcomes = outcomes.filter(({ outcome }) => outcome.reviewed === true);
      const mergedFindings = [];
      const findingIds = new Map();
      let findingsConsistent = true;
      for (const { outcome } of reviewedOutcomes) {
        let items;
        try {
          items = outcome.findings && outcome.findings.trim().length > 0
            ? JSON.parse(outcome.findings)
            : [];
        } catch (_error) {
          findingsConsistent = false;
          break;
        }
        for (const item of items) {
          const prior = findingIds.get(item.finding_id);
          const digest = campaignCanonicalDigest(item);
          if (prior && prior !== digest) {
            findingsConsistent = false;
            break;
          }
          if (!prior) {
            findingIds.set(item.finding_id, digest);
            mergedFindings.push(item);
          }
        }
        if (!findingsConsistent) break;
      }
      const allReviewed = reviewedOutcomes.length === outcomes.length;
      return {
        reviewed: allReviewed && findingsConsistent,
        verdict: allReviewed && findingsConsistent ? 'SHIP-AS-IS' : null,
        findings: JSON.stringify(mergedFindings),
        review_digest: allReviewed && findingsConsistent
          ? (reviewedOutcomes.length === 1
            ? reviewedOutcomes[0].outcome.review_digest
            : campaignCanonicalDigest(seatReceipts.map((seat) => seat.review_digest)))
          : null,
        sealed_min_panel_size: minPanelSize,
        final_panel_count: reviewedOutcomes.length,
        final_panel_seat_receipts: seatReceipts,
      };
    };

    const maxRepairGenerations = Math.min(
      campaignControl.contract.max_repair_generations,
      Math.max(0, roster.loop_max_rounds - 1),
    );
    const resumableProviderSession = roster.implementer_runner === 'grok';
    // Durable controller authority: frozen denominator + joint budget.
    // Mission-backed campaigns freeze the entire trusted admitted graph from the
    // Mission store (not caller-injected graph_node_ids / admitted_graph fields —
    // those are forbidden by the closed campaign schema).
    // Standalone campaigns use the single ticket. Controller WO is rooted by
    // campaign_id (never collides with Mission continuation WOs rooted by Mission).
    let frozenDeliverableIds = [
      (campaignControl.contract.mission_runtime
        && campaignControl.contract.mission_runtime.graph_node_id)
      || campaignControl.contract.ticket
      || 'deliverable',
    ];
    let frozenGraphDigest = (campaignControl.contract.mission_runtime
      && campaignControl.contract.mission_runtime.mission_graph_digest)
      || campaignCanonicalDigest({ campaign_id: campaignControl.campaign_id });
    let exactMissionClaim = null;
    let exactMissionState = null;
    let missionCompletedDeliverables = [];
    if (campaignControl.contract.mission_runtime) {
      const runtime = campaignControl.contract.mission_runtime;
      const store = this.missionCampaignStore;
      if (store && typeof store.load === 'function') {
        let missionState = null;
        try {
          missionState = store.load();
        } catch (error) {
          throw new Error(
            `mission campaign store load failed for frozen denominator: ${
              error.message || String(error)
            }`,
          );
        }
        if (!isObj(missionState) || !isObj(missionState.execution_graph)) {
          throw new Error(
            'Mission-backed campaign requires durable execution_graph on Mission state',
          );
        }
        try {
          validateMissionState(missionState);
          missionStateHash(missionState);
        } catch (error) {
          throw new Error(
            `Mission-backed campaign state failed canonical validation: ${
              error.message || String(error)
            }`,
          );
        }
        const graph = missionState.execution_graph;
        missionCompletedDeliverables = Object.entries(missionState.graph_progress || {})
          .filter(([, progress]) => isObj(progress) && progress.status === 'ready')
          .map(([nodeId]) => nodeId)
          .sort();
        // Canonical Mission producer stores mission_graph_digest on state
        // (mission-convergence), not a foreign nested graph.digest field.
        const sealedGraphDigest = runtime.mission_graph_digest;
        if (!isStr(sealedGraphDigest) || !/^[0-9a-f]{64}$/.test(sealedGraphDigest)) {
          throw new Error(
            'Mission-backed campaign requires sealed mission_graph_digest for frozen denominator',
          );
        }
        const stateGraphDigest = isStr(missionState.mission_graph_digest)
          ? missionState.mission_graph_digest
          : null;
        if (!isStr(stateGraphDigest) || !/^[0-9a-f]{64}$/.test(stateGraphDigest)) {
          throw new Error(
            'Mission store requires exact mission_graph_digest for frozen denominator',
          );
        }
        if (sealedGraphDigest !== stateGraphDigest) {
          throw new Error(
            'Mission store mission_graph_digest does not match sealed mission_graph_digest',
          );
        }
        // Nested graph_digest (when freezeMissionExecutionGraph embedded it) must agree.
        if (isStr(graph.graph_digest) && graph.graph_digest !== stateGraphDigest) {
          throw new Error(
            'Mission execution_graph.graph_digest does not match mission_graph_digest',
          );
        }
        const liveGraphDigest = stateGraphDigest;
        // Bind actual closed-schema authorities (not unreachable mission_runtime
        // extras like repo_identity/icc_campaign_id which schema rejects).
        // Sources: contract.repo_identity, mission_grant_ref, campaign_control.mission_claim,
        // Mission store lineage/policy/graph/claims, ICC campaign_id.
        const sealedRepoIdentity = isStr(campaignControl.contract.repo_identity)
          ? campaignControl.contract.repo_identity
          : (isStr(campaignControl.repo_identity) ? campaignControl.repo_identity : null);
        if (!isStr(sealedRepoIdentity)
            || !isStr(missionState.repo_identity)
            || sealedRepoIdentity !== missionState.repo_identity) {
          throw new Error('Mission store repo_identity does not match sealed campaign contract');
        }
        if (!isStr(runtime.mission_lineage_id)) {
          throw new Error('Mission-backed campaign missing sealed mission_lineage_id');
        }
        if (!isStr(missionState.mission_lineage_id)
            || runtime.mission_lineage_id !== missionState.mission_lineage_id) {
          throw new Error('Mission store lineage does not match sealed mission_runtime');
        }
        if (!isStr(runtime.mission_policy_digest)) {
          throw new Error('Mission-backed campaign missing sealed mission_policy_digest');
        }
        // Exact canonical producer field is mission_policy_digest (not policy_digest).
        if (!isStr(missionState.mission_policy_digest)
            || runtime.mission_policy_digest !== missionState.mission_policy_digest) {
          throw new Error(
            'Mission store mission_policy_digest does not match sealed mission_runtime',
          );
        }
        // Grant reference from sealed contract (required under Mission enforce).
        const sealedGrant = isStr(campaignControl.contract.mission_grant_ref)
          ? campaignControl.contract.mission_grant_ref
          : (isStr(campaignControl.mission_grant_ref) ? campaignControl.mission_grant_ref : null);
        if (!isStr(sealedGrant)) {
          throw new Error('Mission-backed campaign missing sealed mission_grant_ref');
        }
        // Exact claim binding by sealed claim_id (never scan-by-node optional attempt).
        const claim = isObj(campaignControl.mission_claim) ? campaignControl.mission_claim : null;
        if (!claim || !isStr(claim.claim_id) || !isStr(claim.campaign_id)) {
          throw new Error(
            'Mission-backed campaign requires an exact claimed claim_id + campaign_id',
          );
        }
        const claimMatch = isObj(missionState.claims)
          ? missionState.claims[claim.claim_id]
          : null;
        if (!isObj(claimMatch)) {
          throw new Error('Mission claim_id not found in Mission state claims');
        }
        if (claimMatch.claim_id !== claim.claim_id
            || claimMatch.campaign_id !== claim.campaign_id
            || claimMatch.mission_lineage_id !== missionState.mission_lineage_id
            || claimMatch.mission_lineage_id !== runtime.mission_lineage_id
            || claimMatch.task_authority_id !== missionState.task_authority_id
            || claimMatch.graph_node_id !== runtime.graph_node_id
            || !Number.isSafeInteger(claimMatch.graph_attempt)
            || claimMatch.graph_attempt < 1
            || claimMatch.base_sha !== campaignControl.contract.base_sha
            || claimMatch.binding_digest !== sealedGrant) {
          throw new Error('Mission claim canonical binding tuple does not match sealed authority');
        }
        const expectedSubject = missionSubjectDigest(campaignControl.contract);
        if (claimMatch.campaign_contract_digest !== expectedSubject
            || (isStr(claimMatch.mission_subject_digest)
              && claimMatch.mission_subject_digest !== expectedSubject)) {
          throw new Error('Mission claim contract subject does not match sealed campaign');
        }
        if (claimMatch.terminal === true
            || claimMatch.released === true
            || claimMatch.reconciled === true) {
          throw new Error('Mission claim is not live for campaign effects');
        }
        if (isObj(missionState.graph_progress)
            && isObj(missionState.graph_progress[runtime.graph_node_id])
            && missionState.graph_progress[runtime.graph_node_id].active_claim_id
              !== claim.claim_id) {
          throw new Error('Mission graph progress does not bind the active exact claim');
        }
        exactMissionClaim = claimMatch;
        exactMissionState = JSON.parse(JSON.stringify(missionState));
        // Any adapter-projected binding must equal the durable claim; omission
        // is tolerated only for fields the canonical intake projection does not
        // expose.  Aliases are never consulted.
        for (const field of [
          'mission_lineage_id',
          'task_authority_id',
          'graph_node_id',
          'graph_attempt',
          'base_sha',
          'campaign_contract_digest',
          'mission_subject_digest',
        ]) {
          if (Object.prototype.hasOwnProperty.call(claim, field)
              && claim[field] !== claimMatch[field]) {
            throw new Error(`Mission intake claim ${field} does not match stored claim`);
          }
        }
        // ICC campaign root is campaignControl.campaign_id (never a forbidden runtime field).
        let expectedIccCampaignId;
        try {
          expectedIccCampaignId = campaignIdFor(
            sealedRepoIdentity,
            campaignControl.contract.ticket,
            campaignControl.contract_digest,
          );
        } catch (error) {
          throw new Error(
            `Mission-backed campaign has invalid ICC identity inputs: ${
              error.message || String(error)
            }`,
          );
        }
        if (!isStr(campaignControl.campaign_id)
            || campaignControl.campaign_id !== expectedIccCampaignId) {
          throw new Error('Mission-backed campaign ICC campaign_id is not canonical');
        }
        // Bind exact sealed graph node and recompute digest over its canonical shape
        // (same representation as mission-convergence expectedRuntime.graph_node_digest).
        if (isStr(runtime.graph_node_id) && isStr(runtime.graph_node_digest)) {
          const liveNode = Array.isArray(graph.nodes)
            ? graph.nodes.find((n) => n && n.id === runtime.graph_node_id)
            : null;
          if (!liveNode) {
            throw new Error('sealed graph_node_id absent from Mission execution_graph');
          }
          const { sha256, canonicalJson } = require('./owner-kernel/canonical');
          const liveNodeDigest = sha256(canonicalJson(liveNode));
          if (liveNodeDigest !== runtime.graph_node_digest) {
            throw new Error('Mission graph node digest does not match sealed graph_node_digest');
          }
        }
        const nodes = Array.isArray(graph.nodes)
          ? graph.nodes.map((n) => n && n.id).filter((id) => isStr(id))
          : [];
        if (nodes.length === 0) {
          throw new Error('Mission execution_graph has no node IDs for frozen denominator');
        }
        frozenDeliverableIds = [...new Set(nodes)].sort();
        frozenGraphDigest = liveGraphDigest;
      } else if (campaignControl.contract.mission_runtime) {
        // Mission-backed without store: fail closed (no silent single-node synthetic).
        throw new Error(
          'Mission-backed campaign requires atomic Mission campaign store for frozen denominator',
        );
      }
    }
    const missionRuntimeAuthority = campaignControl.contract.mission_runtime || null;
    const frozenDenominator = buildFrozenDenominator({
      // A Mission-wide denominator must remain byte-identical as execution
      // advances across node-specific ICC campaigns. The ICC campaign ID and
      // current node are progress coordinates, not denominator identity.
      projectId: (missionRuntimeAuthority && missionRuntimeAuthority.root_run_id)
        || campaignControl.campaign_id,
      graphDigest: frozenGraphDigest,
      deliverableIds: frozenDeliverableIds,
      nodeId: frozenDeliverableIds[0],
    });
    // Load/create one controller Work Order before the first external effect.
    const {
      createOrUpdateWorkOrder,
      resolveGitCommonDir,
      listWorkOrders,
      workOrderPath,
      captureProcessParentage,
      writeAtomicJson,
      buildControllerTerminalReceipt,
      validateBoundArtifacts,
      readJsonStrict,
      observeControllerLedger,
    } = require('./work-order');
    const controllerRootRunId = campaignControl.campaign_id;
    const controllerGraphNode = (campaignControl.contract.mission_runtime
      && campaignControl.contract.mission_runtime.graph_node_id)
      || campaignControl.contract.ticket
      || 'controller';
    const controllerAttempt = exactMissionClaim
      && Number.isSafeInteger(exactMissionClaim.graph_attempt)
      && exactMissionClaim.graph_attempt > 0
      ? exactMissionClaim.graph_attempt : 1;
    const controllerWorkOrderId = `wo-${controllerRootRunId}-${controllerGraphNode}-a${controllerAttempt}`;
    const controllerFrozenBase = base || currentBase || null;
    const controllerSealedScope = {
      allow_paths: [...campaignControl.contract.allowed_path_prefixes],
      max_files: campaignControl.contract.max_changed_files,
      max_diff_lines: Math.max(1, Math.min(
        Math.floor(
          campaignControl.contract.baseline_churn
            * campaignControl.contract.max_growth_ratio,
        ),
        campaignControl.contract.baseline_churn
          + campaignControl.contract.max_extra_churn,
      )),
    };
    const controllerAuthorityId = campaignCanonicalDigest({
      root_run_id: controllerRootRunId,
      graph_node: controllerGraphNode,
      attempt: controllerAttempt,
      work_order_id: controllerWorkOrderId,
    });
    let controllerWorkOrder = null;
    let controllerWorkOrderPath = null;
    let priorTerminalController = null;
    // Corrupt/ambiguous/foreign/tampered exact controller records must stop
    // before effects — never catch-and-reseed into a "fresh" controller.
    {
      const commonDir = resolveGitCommonDir(loopCwd);
      if (commonDir) {
        let listed;
        try {
          listed = listWorkOrders(commonDir, controllerRootRunId);
        } catch (error) {
          const err = new Error(
            `controller Work Order enumeration failed: ${error.message || String(error)}`,
          );
          err.code = 'controller_work_order_list_failed';
          throw err;
        }
        // Fail closed on corrupt/tampered controller-role records (or unreadable
        // files that share the controller graph node name). Other roles may
        // coexist under the same root without blocking attach.
        const controllerIntegrity = listed.filter((e) => {
          if (!e.error) return false;
          if (!e.work_order) {
            // Unreadable JSON under this root — refuse silent reseed.
            return true;
          }
          return e.work_order.role === 'controller'
            || e.work_order.graph_node === controllerGraphNode;
        });
        if (controllerIntegrity.length > 0) {
          const first = controllerIntegrity[0];
          const detail = isObj(first.error) ? first.error : {};
          const err = new Error(
            detail.reason
              || first.reason
              || 'controller Work Order integrity failure',
          );
          err.code = detail.reason_code || first.reason_code || 'controller_work_order_integrity';
          throw err;
        }
        const nodeControllers = listed.filter((e) => e.work_order
          && !e.error
          && e.work_order.graph_node === controllerGraphNode
          && e.work_order.role === 'controller');
        const recordIsTerminal = (record) => {
          const recordController = isObj(record && record.controller)
            ? record.controller : null;
          return Boolean(record && (
            record.disposition === 'consumed'
            || record.disposition === 'stale_dispositioned'
            || (isStr(record.terminal_status)
              && !['running', 'active', 'none'].includes(record.terminal_status))
            || (recordController && (
              recordController.phase === 'COMPLETED'
              || recordController.phase === 'TERMINAL'
              || recordController.next_action === 'terminal'
            ))
          ));
        };
        const matches = nodeControllers.filter((e) => (
          e.work_order.attempt === controllerAttempt
          && e.work_order.work_order_id === controllerWorkOrderId
        ));
        if (matches.length > 1) {
          const err = new Error(
            'ambiguous controller Work Orders for exact campaign root/node/attempt; refuse reseed',
          );
          err.code = 'controller_work_order_ambiguous';
          throw err;
        }
        const blockingPrior = nodeControllers.filter((e) => (
          !matches.includes(e) && !recordIsTerminal(e.work_order)
        ));
        if (blockingPrior.length > 0) {
          const err = new Error(
            'a prior controller attempt remains nonterminal; refuse a new attempt',
          );
          err.code = 'controller_prior_attempt_nonterminal';
          throw err;
        }
        const terminalHistory = nodeControllers
          .filter((e) => !matches.includes(e) && recordIsTerminal(e.work_order))
          .sort((left, right) => (
            Number(right.work_order.attempt || 0) - Number(left.work_order.attempt || 0)
          ));
        priorTerminalController = terminalHistory.length > 0
          && isObj(terminalHistory[0].work_order.controller)
          ? terminalHistory[0].work_order.controller : null;
        if (matches.length === 1) {
          controllerWorkOrder = matches[0].work_order;
          controllerWorkOrderPath = matches[0].path;
        }
      }
    }
    // Active controller-bearing Work Order attaches the exact durable record.
    // Resume always attaches. Non-resume of an active (nonterminal) controller
    // still attaches — never reseed or replenish frozen budget limits/usage.
    // Terminal WO preserves historical_outputs while seeding a new operational
    // budget from the sealed contract only (never raises prior frozen limits).
    const priorController = controllerWorkOrder && isObj(controllerWorkOrder.controller)
      ? controllerWorkOrder.controller
      : null;
    const priorTerminal = Boolean(
      controllerWorkOrder
      && (
        controllerWorkOrder.disposition === 'consumed'
        || controllerWorkOrder.disposition === 'stale_dispositioned'
        || (isStr(controllerWorkOrder.terminal_status)
          && !['running', 'active', null, undefined].includes(controllerWorkOrder.terminal_status)
          && controllerWorkOrder.terminal_status !== 'none')
        || (priorController && (
          priorController.phase === 'COMPLETED'
          || priorController.phase === 'TERMINAL'
          || priorController.next_action === 'terminal'
        ))
      ),
    );
    const resumingController = Boolean(
      resumeCandidate
      && !resumeSetupError
      && priorController,
    );
    if (controllerWorkOrder && priorTerminal) {
      const err = new Error(
        'the exact controller Work Order attempt is already terminal; refuse new effects',
      );
      err.code = 'controller_work_order_already_terminal';
      throw err;
    }
    // Attach exact state whenever prior controller exists and is not terminal,
    // or when explicitly resuming. Never catch-and-reseed over active state.
    const attachingExistingController = Boolean(
      priorController && (resumingController || !priorTerminal),
    );
    // Frozen joint limits from sealed campaign only — never arbitrary floor or
    // attach-time replenishment (R3).
    const defaultBudgetLimitsSeed = {
      // Per generation: one implement/repair, one full-diff review, and at
      // most one focused supplement; final joint panel consumes its sealed
      // seat count once.  This is derived from the frozen pipeline, not an
      // attach-time floor/replenishment.
      model_calls: ((maxRepairGenerations + 1) * 3) + roster.min_panel_size,
      fresh_input_bytes: Number.isSafeInteger(campaignControl.contract.max_prompt_bytes)
        ? campaignControl.contract.max_prompt_bytes
        : 50_000_000,
      fresh_input_tokens: null,
      elapsed_wall_ms: Number.isSafeInteger(campaignControl.contract.max_wall_seconds)
        ? campaignControl.contract.max_wall_seconds * 1000
        : 3_600_000,
      owned_worktrees: Number.isSafeInteger(
        campaignControl.contract.max_owned_worktrees,
      ) ? campaignControl.contract.max_owned_worktrees : 4,
      finding_recurrence: Number.isSafeInteger(
        campaignControl.contract.max_finding_recurrence,
      ) ? campaignControl.contract.max_finding_recurrence : 2,
    };
    const sealedTempCapacity = Number.isSafeInteger(
      campaignControl.contract.temp_capacity_limit,
    ) ? campaignControl.contract.temp_capacity_limit : null;
    let campaignController;
    if (attachingExistingController) {
      // Existing-controller attach: mechanical recovery/reconciliation before
      // any persistence or external effect. A direct attach is not authority.
      {
        const {
          reconcilePostCompact,
        } = require('./work-order');
        const { runPostCompactAdapter } = require('./controller-execution');
        const commonDir = resolveGitCommonDir(loopCwd);
        if (!commonDir) {
          const err = new Error(
            'existing controller attach requires resolvable git-common-dir for recovery',
          );
          err.code = 'controller_attach_recovery_failed';
          throw err;
        }
        const expectedPath = workOrderPath(
          commonDir,
          controllerRootRunId,
          controllerGraphNode,
          controllerAttempt,
        );
        if (path.resolve(controllerWorkOrderPath) !== path.resolve(expectedPath)
            || controllerWorkOrder.work_order_id !== controllerWorkOrderId
            || controllerWorkOrder.attempt !== controllerAttempt) {
          const err = new Error(
            'existing controller Work Order path/id/attempt does not match canonical tuple',
          );
          err.code = 'controller_work_order_mismatch';
          throw err;
        }
        let registeredControllerWorktree = controllerWorkOrder.worktree;
        try {
          registeredControllerWorktree = fs.realpathSync(controllerWorkOrder.worktree);
        } catch (_error) {
          // Recovery below emits the exact missing/registration reason.
        }
        let currentControllerWorktree = loopCwd;
        try {
          currentControllerWorktree = fs.realpathSync(loopCwd);
        } catch (_error) {
          // Recovery below emits the exact missing/registration reason.
        }
        if (!isStr(controllerWorkOrder.worktree)
            || registeredControllerWorktree !== currentControllerWorktree) {
          const err = new Error(
            'existing controller attach must continue in the exact registered Work Order '
              + `worktree (registered=${registeredControllerWorktree || '<missing>'}, `
              + `current=${currentControllerWorktree}, attempt=${controllerAttempt}, `
              + `claim=${exactMissionClaim && exactMissionClaim.claim_id}, `
              + `work_order=${controllerWorkOrderId})`,
          );
          err.code = 'controller_worktree_mismatch';
          throw err;
        }
        let recovery;
        try {
          recovery = runPostCompactAdapter({
            reconcileFn: reconcilePostCompact,
            rootRunId: controllerRootRunId,
            graphNode: controllerGraphNode,
            attempt: controllerAttempt,
            workOrderId: controllerWorkOrderId,
            gitCwd: loopCwd,
            workOrder: controllerWorkOrder,
          });
        } catch (error) {
          const err = new Error(
            `controller attach recovery threw: ${error.message || String(error)}`,
          );
          err.code = 'controller_attach_recovery_failed';
          throw err;
        }
        const recoveryOk = isObj(recovery) && recovery.status === 'ready';
        if (!recoveryOk) {
          const err = new Error(
            `controller attach recovery not reconciled: ${
              (recovery && (recovery.reason || recovery.reason_code)) || 'missing'
            }`,
          );
          err.code = (recovery && recovery.reason_code) || 'controller_attach_recovery_failed';
          throw err;
        }
      }
      // Exact prior controller authority including frozen limits and usage.
      campaignController = emptyControllerState(priorController);
      if (!Number.isSafeInteger(campaignController.started_at_ms)) {
        campaignController.started_at_ms = Date.now();
        campaignController.controller_digest = controllerStateDigest(campaignController);
      }
      if (sealedTempCapacity != null
          && !Number.isSafeInteger(campaignController.temp_capacity_limit)) {
        campaignController.temp_capacity_limit = sealedTempCapacity;
        campaignController.controller_digest = controllerStateDigest(campaignController);
      }
    } else {
      const historicalController = priorController || priorTerminalController;
      campaignController = emptyControllerState({
        frozen_denominator: frozenDenominator,
        original_dispatch_run: campaignControl.campaign_id,
        started_at_ms: Date.now(),
        historical_outputs: historicalController
          ? historicalController.historical_outputs : null,
        historical_outputs_digest: historicalController
          ? historicalController.historical_outputs_digest : null,
        noop_receipt: historicalController ? historicalController.noop_receipt : null,
        completed_deliverables: missionCompletedDeliverables,
        repair_budget_limits: defaultBudgetLimitsSeed,
        temp_capacity_limit: sealedTempCapacity,
      });
    }
    if (!campaignController.frozen_denominator) {
      campaignController.frozen_denominator = frozenDenominator;
      campaignController.controller_digest = controllerStateDigest(campaignController);
    }
    if (missionCompletedDeliverables.length > 0) {
      campaignController.completed_deliverables = [...new Set([
        ...(campaignController.completed_deliverables || []),
        ...missionCompletedDeliverables,
      ])].sort();
      campaignController.controller_digest = controllerStateDigest(campaignController);
    }
    if (!attachingExistingController
        && (!Array.isArray(campaignController.progress_receipts)
          || campaignController.progress_receipts.length === 0)) {
      const initialProgress = buildProgressReceipt({
        frozenDenominator: campaignController.frozen_denominator,
        deliverableId: controllerGraphNode,
        completedDeliverables: campaignController.completed_deliverables || [],
        generation: Number.isSafeInteger(campaignControl.initial_state.generation)
          ? campaignControl.initial_state.generation : 0,
        activeProcess: { pid: process.pid },
        gateState: campaignController.gate_journal || null,
        resourceDebtState: campaignController.resource_debt || null,
        phase: campaignController.phase || 'PREPARED',
        workOrderId: controllerWorkOrderId,
        rootRunId: controllerRootRunId,
      });
      campaignController.progress_receipts = [initialProgress];
      campaignController.audit_events = [
        ...(campaignController.audit_events || []),
        {
          event: 'progress_receipt_appended',
          root_run_id: controllerRootRunId,
          work_order_id: controllerWorkOrderId,
          at: initialProgress.issued_at,
          digest: initialProgress.digest,
          phase: initialProgress.phase,
        },
      ];
      campaignController.controller_digest = controllerStateDigest(campaignController);
    }
    // Resume: persisted frozen denominator must equal the mechanically loaded one.
    if (resumingController
        && isObj(campaignController.frozen_denominator)
        && campaignController.frozen_denominator.digest !== frozenDenominator.digest) {
      throw new Error(
        'controller frozen denominator digests drifted from Mission graph on resume; refuse effects',
      );
    }
    const refreshExactMissionAuthority = () => {
      if (!exactMissionState) return null;
      const store = this.missionCampaignStore;
      if (!store || typeof store.load !== 'function') {
        const err = new Error(
          'controller Mission authority refresh requires the canonical Mission store',
        );
        err.code = 'controller_mission_state_refresh_failed';
        throw err;
      }
      let live;
      try {
        live = store.load();
        validateMissionState(live);
        missionStateHash(live);
      } catch (error) {
        const err = new Error(
          `canonical Mission authority refresh failed: ${error.message || String(error)}`,
        );
        err.code = 'controller_mission_state_refresh_failed';
        throw err;
      }
      const priorState = exactMissionState;
      const priorClaim = exactMissionClaim;
      const liveClaim = priorClaim && isObj(live.claims)
        ? live.claims[priorClaim.claim_id] : null;
      for (const field of [
        'mission_lineage_id',
        'mission_policy_digest',
        'mission_graph_digest',
        'task_authority_id',
        'repo_identity',
      ]) {
        if (live[field] !== priorState[field]) {
          const err = new Error(`canonical Mission ${field} changed during controller execution`);
          err.code = 'controller_mission_identity_drift';
          throw err;
        }
      }
      if (!isObj(liveClaim)) {
        const err = new Error('canonical Mission claim disappeared during controller execution');
        err.code = 'controller_mission_claim_missing';
        throw err;
      }
      for (const field of [
        'claim_id',
        'campaign_id',
        'mission_lineage_id',
        'task_authority_id',
        'graph_node_id',
        'graph_attempt',
        'base_sha',
        'campaign_contract_digest',
        'mission_subject_digest',
        'binding_digest',
      ]) {
        if (liveClaim[field] !== priorClaim[field]) {
          const err = new Error(`canonical Mission claim ${field} changed during controller execution`);
          err.code = 'controller_mission_claim_drift';
          throw err;
        }
      }
      const refreshed = JSON.parse(JSON.stringify(live));
      exactMissionState = refreshed;
      exactMissionClaim = refreshed.claims[priorClaim.claim_id];
      return exactMissionState;
    };
    const persistControllerWorkOrder = (nextController, lifecyclePatch = null) => {
      const commonDir = resolveGitCommonDir(loopCwd);
      if (!commonDir) {
        const err = new Error(
          'controller Work Order requires a resolvable Git common dir; refuse silent non-durable authority',
        );
        err.code = 'controller_work_order_common_dir_missing';
        throw err;
      }
      if (!isStr(controllerFrozenBase)
          || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(controllerFrozenBase)) {
        const err = new Error(
          'controller Work Order requires an immutable frozen base commit',
        );
        err.code = 'controller_frozen_base_missing';
        throw err;
      }
      const processParentage = captureProcessParentage(process.pid);
      if (!isObj(processParentage)
          || !Array.isArray(processParentage.relationships)
          || processParentage.relationships.length === 0) {
        const err = new Error(
          'controller Work Order requires a complete observed process parent chain',
        );
        err.code = 'controller_process_parentage_missing';
        throw err;
      }
      const priorParentage = isObj(nextController)
        && isObj(nextController.process_parentage)
        ? nextController.process_parentage : null;
      const sameCurrentOwner = priorParentage
        && isObj(priorParentage.owner)
        && priorParentage.owner.pid === processParentage.owner.pid
        && priorParentage.owner.process_start_time
          === processParentage.owner.process_start_time
        && priorParentage.owner.pgid === processParentage.owner.pgid
        && priorParentage.owner.sid === processParentage.owner.sid;
      const persistedController = emptyControllerState({
        ...(nextController || {}),
        process_parentage: sameCurrentOwner ? priorParentage : processParentage,
      });
      campaignController = persistedController;
      campaignControl.controller = persistedController;
      // Real durable checkpoint/state files before any external effect. Digests
      // bind into the Work Order body — invented paths with bindArtifacts:false
      // are not recoverably attachable authority.
      const authorityRoot = path.join(
        commonDir,
        'autopilot',
        'controller-authority',
        controllerAuthorityId,
      );
      const nextGeneration = controllerWorkOrder
        ? controllerWorkOrder.generation + 1 : 1;
      const authorityDir = path.join(
        authorityRoot,
        `g${nextGeneration}-${persistedController.controller_digest}`,
      );
      const durablePath = path.join(authorityDir, 'controller-durable.json');
      const checkpointPath = path.join(authorityDir, 'controller-checkpoint.json');
      const ledgerPath = path.join(authorityDir, 'controller-ledger.jsonl');
      const manifestPath = path.join(authorityDir, 'controller-dispatch-manifests.json');
      const resultIndexPath = path.join(authorityDir, 'controller-dispatch-results.json');
      let missionPath = null;
      let missionStateAuthority = null;
      if (exactMissionState) {
        const storeStatePath = this.missionCampaignStore
          && isStr(this.missionCampaignStore.state_path)
          ? this.missionCampaignStore.state_path : null;
        if (storeStatePath) {
          let reobservedMissionState;
          try {
            reobservedMissionState = this.missionCampaignStore.load();
          } catch (error) {
            const err = new Error(
              `canonical Mission state reobservation failed: ${error.message || String(error)}`,
            );
            err.code = 'controller_mission_state_reobserve_failed';
            throw err;
          }
          if (missionStateHash(reobservedMissionState)
              !== missionStateHash(exactMissionState)) {
            const err = new Error(
              'canonical Mission state changed between intake and controller persistence',
            );
            err.code = 'controller_mission_state_cas_drift';
            throw err;
          }
          missionPath = fs.realpathSync(storeStatePath);
          missionStateAuthority = 'canonical_file_store';
        } else {
          // Compatibility-only initial execution for synthetic stores. The
          // snapshot is digest-bound, but recovery rejects it because it cannot
          // reobserve a canonical file-backed Mission store.
          missionPath = path.join(authorityDir, 'mission-state-snapshot.json');
          missionStateAuthority = 'controller_bound_snapshot';
        }
      }
      const writtenAt = new Date().toISOString();
      const durableBody = {
        schema_version: 1,
        artifact_type: 'controller_durable_state',
        root_run_id: controllerRootRunId,
        graph_node: controllerGraphNode,
        attempt: controllerAttempt,
        work_order_id: controllerWorkOrderId,
        mission_lineage_id: exactMissionState
          ? exactMissionState.mission_lineage_id : null,
        mission_policy_digest: exactMissionState
          ? exactMissionState.mission_policy_digest : null,
        mission_graph_digest: exactMissionState
          ? exactMissionState.mission_graph_digest : null,
        mission_state_digest: exactMissionState
          ? missionStateHash(exactMissionState) : null,
        mission_state_authority: missionStateAuthority,
        mission_claim_id: exactMissionClaim ? exactMissionClaim.claim_id : null,
        mission_campaign_id: exactMissionClaim ? exactMissionClaim.campaign_id : null,
        icc_campaign_id: campaignControl.campaign_id,
        graph_attempt: exactMissionClaim ? exactMissionClaim.graph_attempt : null,
        task_authority_id: exactMissionState
          ? exactMissionState.task_authority_id : null,
        repo_identity: exactMissionState ? exactMissionState.repo_identity : null,
        campaign_id: campaignControl.campaign_id,
        controller_digest: persistedController.controller_digest,
        phase: persistedController.phase || null,
        accepted_commit: persistedController.accepted_commit || null,
        frozen_denominator: persistedController.frozen_denominator || null,
        repair_budget_limits: persistedController.repair_budget_limits || null,
        repair_budget_usage: persistedController.repair_budget_usage || null,
        written_at: writtenAt,
      };
      const checkpointBody = {
        schema_version: 1,
        artifact_type: 'controller_checkpoint',
        root_run_id: controllerRootRunId,
        graph_node: controllerGraphNode,
        attempt: controllerAttempt,
        work_order_id: controllerWorkOrderId,
        controller: persistedController,
        written_at: writtenAt,
      };
      const manifestBody = {
        schema_version: 1,
        artifact_type: 'controller_dispatch_manifest_index',
        root_run_id: controllerRootRunId,
        graph_node: controllerGraphNode,
        attempt: controllerAttempt,
        work_order_id: controllerWorkOrderId,
        controller_digest: persistedController.controller_digest,
        entries: persistedController.dispatch_records || [],
        written_at: writtenAt,
      };
      const resultIndexBody = {
        schema_version: 1,
        artifact_type: 'controller_dispatch_result_index',
        root_run_id: controllerRootRunId,
        graph_node: controllerGraphNode,
        attempt: controllerAttempt,
        work_order_id: controllerWorkOrderId,
        controller_digest: persistedController.controller_digest,
        entries: persistedController.resource_inventory || [],
        written_at: writtenAt,
      };
      fs.mkdirSync(authorityDir, { recursive: true, mode: 0o700 });
      writeAtomicJson(durablePath, durableBody);
      writeAtomicJson(checkpointPath, checkpointBody);
      writeAtomicJson(manifestPath, manifestBody);
      writeAtomicJson(resultIndexPath, resultIndexBody);
      if (missionPath && missionStateAuthority === 'controller_bound_snapshot') {
        writeAtomicJson(missionPath, exactMissionState);
      }
      // Versioned immutable ledger snapshot: preserve the complete prior
      // oldest→live history as an actual rotation segment and write the new
      // heartbeat as the live segment. A failed CAS cannot mutate artifacts
      // bound by the prior Work Order.
      let priorLedgerBytes = '';
      const priorLedgerPath = controllerWorkOrder
        && controllerWorkOrder.paths
        && controllerWorkOrder.paths.ledger;
      if (isStr(priorLedgerPath)) {
        let maxRotations = Number(process.env.RUN_LEDGER_MAX_ROTATIONS || 4);
        if (!Number.isSafeInteger(maxRotations) || maxRotations < 1 || maxRotations > 64) {
          maxRotations = 4;
        }
        for (let index = maxRotations; index >= 1; index -= 1) {
          const segment = `${priorLedgerPath}.${index}`;
          if (fs.existsSync(segment)) priorLedgerBytes += fs.readFileSync(segment, 'utf8');
        }
        if (fs.existsSync(priorLedgerPath)) {
          priorLedgerBytes += fs.readFileSync(priorLedgerPath, 'utf8');
        }
      }
      const heartbeat = {
        schema_version: 1,
        event: 'controller_heartbeat',
        root_run_id: controllerRootRunId,
        work_order_id: controllerWorkOrderId,
        controller_digest: persistedController.controller_digest,
        at: writtenAt,
      };
      if (priorLedgerBytes.length > 0) {
        fs.writeFileSync(
          `${ledgerPath}.1`,
          priorLedgerBytes,
          { encoding: 'utf8', mode: 0o600 },
        );
      }
      fs.writeFileSync(
        ledgerPath,
        `${JSON.stringify(heartbeat)}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      let registeredControllerBranch = 'HEAD';
      try {
        registeredControllerBranch = execFileSync(
          'git',
          ['-C', loopCwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim() || 'HEAD';
      } catch (_error) {
        registeredControllerBranch = 'HEAD';
      }
      const baseFields = {
        work_order_id: controllerWorkOrderId,
        root_run_id: controllerRootRunId,
        graph_node: controllerGraphNode,
        attempt: controllerAttempt,
        role: 'controller',
        // An attached controller generation transfers ownership to this exact
        // live process. Spreading the prior Work Order without replacing owner
        // would retain the dead pre-compaction PID and immediately classify the
        // newly persisted generation as stale.
        owner: {
          ...processParentage.owner,
          kind: 'controller',
        },
        // Work Order branch binds the registered controller checkout, not the
        // separate implementer candidate branch requested by the campaign.
        branch: registeredControllerBranch,
        base_sha: controllerFrozenBase,
        worktree: loopCwd,
        paths: {
          durable: durablePath,
          checkpoint: checkpointPath,
          ledger: ledgerPath,
          manifest: manifestPath,
          receipt: resultIndexPath,
          mission: missionPath,
          ...(isObj(lifecyclePatch) && isObj(lifecyclePatch.paths)
            ? lifecyclePatch.paths
            : {}),
        },
        phase_cursor: persistedController.phase || 'CONTROLLER',
        campaign_phase: persistedController.phase || null,
        next_action: (lifecyclePatch && lifecyclePatch.next_action)
          || persistedController.next_action
          || 'continue',
        accepted_commit: (lifecyclePatch && lifecyclePatch.accepted_commit)
          || persistedController.accepted_commit
          || null,
        sealed_scope: controllerSealedScope,
        controller: persistedController,
        ...(isObj(lifecyclePatch) && lifecyclePatch.terminal_status != null
          ? { terminal_status: lifecyclePatch.terminal_status }
          : {}),
        ...(isObj(lifecyclePatch) && lifecyclePatch.disposition != null
          ? { disposition: lifecyclePatch.disposition }
          : {}),
        ...(isObj(lifecyclePatch) && isObj(lifecyclePatch.expected_receipt)
          ? { expected_receipt: lifecyclePatch.expected_receipt }
          : {}),
      };
      // Mutation of an existing controller WO requires all three CAS expectations.
      // Always bind durable/checkpoint digests so recovery can validate them.
      const opts = controllerWorkOrder
        ? {
          expectedGeneration: controllerWorkOrder.generation,
          expectedCasToken: controllerWorkOrder.cas_token,
          expectedControllerDigest: isObj(controllerWorkOrder.controller)
            ? controllerWorkOrder.controller.controller_digest
            : null,
          bindArtifacts: true,
        }
        : { bindArtifacts: true };
      if (controllerWorkOrder
          && (opts.expectedGeneration == null
            || !isStr(opts.expectedCasToken)
            || opts.expectedControllerDigest == null)) {
        const err = new Error(
          'controller Work Order mutation requires generation, cas_token, and previous controller digest',
        );
        err.code = 'controller_cas_incomplete';
        throw err;
      }
      const written = createOrUpdateWorkOrder(commonDir, {
        ...(controllerWorkOrder || {}),
        ...baseFields,
      }, opts);
      if (written.status === 'reject') {
        const err = new Error(written.reason || 'controller work order CAS reject');
        err.code = written.reason_code || 'cas_conflict';
        throw err;
      }
      controllerWorkOrder = written.work_order;
      controllerWorkOrderPath = written.path;
    };
    const terminalizeControllerWorkOrder = ({
      terminalStatus,
      phase,
      reason,
      controller = null,
      acceptedCommit = null,
      historicalOutputs = null,
      historicalOutputsDigest = null,
      requireCompleteTranscript = false,
    }) => {
      if (!controllerWorkOrder) {
        const err = new Error('controller terminal disposition requires an existing Work Order');
        err.code = 'controller_work_order_missing';
        throw err;
      }
      if (!isStr(terminalStatus)) {
        const err = new Error('controller terminal disposition requires terminal_status');
        err.code = 'controller_terminal_status_missing';
        throw err;
      }
      refreshExactMissionAuthority();
      // Terminal closure reobserves owned Git resources mechanically and
      // persists that exact snapshot into a new active Work Order generation
      // before auditing it. Terminal success never relies on the last model/
      // gate-era inventory array remaining current by assumption.
      const terminalSourceController = controller || campaignController || {};
      const terminalInventory = reconstructOwnedInventory({
        gitCwd: loopCwd,
        controller: terminalSourceController,
        rootRunId: controllerRootRunId,
        baseSha: controllerWorkOrder.base_sha,
        failClosedOnGitError: true,
      });
      if (!terminalInventory.ok) {
        const err = new Error(
          `controller terminal inventory observation failed: ${
            terminalInventory.reason || 'unknown Git observation failure'
          }`,
        );
        err.code = 'controller_terminal_inventory_failed';
        throw err;
      }
      const mechanicallyObservedController = emptyControllerState({
        ...terminalSourceController,
        resource_inventory: terminalInventory.inventory || [],
        resource_debt: buildResourceDebtState(terminalInventory.inventory || [], {
          dispatchRecords: terminalSourceController.dispatch_records || [],
        }),
        inventory_observation_digest: terminalInventory.digest || null,
      });
      persistControllerWorkOrder(mechanicallyObservedController);
      const issuedAt = this.now();
      const terminalAuditBody = {
        event: 'controller_terminal_disposition',
        at: issuedAt,
        terminal_status: terminalStatus,
        phase: phase || null,
        reason: reason || null,
        root_run_id: controllerRootRunId,
        work_order_id: controllerWorkOrder.work_order_id,
      };
      const terminalAudit = {
        ...terminalAuditBody,
        digest: campaignCanonicalDigest(terminalAuditBody),
      };
      const terminalPhase = terminalStatus === 'success' ? 'COMPLETED' : 'TERMINAL';
      const termCtrl = emptyControllerState({
        ...mechanicallyObservedController,
        phase: terminalPhase,
        next_action: 'terminal',
        accepted_commit: acceptedCommit
          || (controller && controller.accepted_commit)
          || (campaignController && campaignController.accepted_commit)
          || null,
        audit_events: [
          ...(((controller || campaignController)
            && (controller || campaignController).audit_events) || []),
          terminalAudit,
        ],
      });
      if (historicalOutputs) {
        termCtrl.historical_outputs = historicalOutputs;
        termCtrl.historical_outputs_digest = historicalOutputsDigest || null;
      } else if (historicalOutputsDigest && !termCtrl.historical_outputs_digest) {
        termCtrl.historical_outputs_digest = historicalOutputsDigest;
      }
      const boundAuthority = validateBoundArtifacts(controllerWorkOrder, {
        gitCwd: loopCwd,
        requireBoundEvidence: true,
      });
      if (!boundAuthority.ok) {
        const err = new Error(
          `controller transcript bound authority invalid: ${boundAuthority.reason}`,
        );
        err.code = boundAuthority.reason_code || 'transcript_authority_invalid';
        throw err;
      }
      const readAuthorityIndex = (key, label) => {
        const indexPath = controllerWorkOrder.paths && controllerWorkOrder.paths[key];
        if (!isStr(indexPath)) {
          const err = new Error(`controller transcript ${label} path is missing`);
          err.code = 'transcript_authority_missing';
          throw err;
        }
        const loaded = readJsonStrict(indexPath);
        if (!loaded.ok || !isObj(loaded.value)) {
          const err = new Error(
            `controller transcript ${label} is unreadable: ${
              loaded.reason || loaded.reason_code || 'invalid JSON'
            }`,
          );
          err.code = loaded.reason_code || 'transcript_authority_invalid';
          throw err;
        }
        return loaded.value;
      };
      const manifestIndex = readAuthorityIndex('manifest', 'dispatch manifest index');
      const resultIndex = readAuthorityIndex('receipt', 'dispatch result index');
      const ledgerObservation = observeControllerLedger(
        controllerWorkOrder.paths && controllerWorkOrder.paths.ledger,
        controllerWorkOrder,
        { requireFresh: true },
      );
      if (!ledgerObservation.ok) {
        const err = new Error(
          `controller transcript ledger authority invalid: ${
            ledgerObservation.reason || ledgerObservation.reason_code
          }`,
        );
        err.code = ledgerObservation.reason_code || 'transcript_authority_invalid';
        throw err;
      }
      const transcript = rebuildTranscriptAudit({
        rootRunId: controllerRootRunId,
        workOrderId: controllerWorkOrder.work_order_id,
        auditEvents: termCtrl.audit_events || [],
        dispatches: termCtrl.dispatch_records || [],
        resources: termCtrl.resource_inventory || [],
        gates: (termCtrl.gate_journal && termCtrl.gate_journal.entries) || [],
        repairs: termCtrl.repair_tickets || [],
        resumes: termCtrl.resume_receipts || [],
        dispositions: (termCtrl.resource_debt && termCtrl.resource_debt.open) || [],
        workOrder: controllerWorkOrder,
        manifestIndex,
        resultIndex,
        ledgerObservation,
      });
      if (requireCompleteTranscript
          && transcript.blocks_terminal === true) {
        const err = new Error(
          `controller transcript audit blocks terminal: ${
            (transcript.problems || []).join('; ')
            || 'unresolved mechanically observed resource debt'
          }`,
        );
        err.code = 'transcript_incomplete';
        throw err;
      }
      termCtrl.transcript_audit = transcript;
      termCtrl.controller_digest = controllerStateDigest(termCtrl);
      const { classifyWorkOrder } = require('./work-order');
      const terminalCommonDir = resolveGitCommonDir(loopCwd);
      if (!terminalCommonDir) {
        const err = new Error('controller terminal receipt requires Git common dir');
        err.code = 'controller_terminal_common_dir_missing';
        throw err;
      }
      const terminalDir = path.join(
        terminalCommonDir,
        'autopilot',
        'controller-authority',
        controllerAuthorityId,
        'terminal',
      );
      const receiptPath = path.join(
        terminalDir,
        `${terminalStatus}-${termCtrl.controller_digest}.json`,
      );
      const terminalReceipt = buildControllerTerminalReceipt({
        terminalStatus,
        rootRunId: controllerRootRunId,
        workOrderId: controllerWorkOrder.work_order_id,
        graphNode: controllerGraphNode,
        campaignId: campaignControl.campaign_id,
        acceptedCommit: termCtrl.accepted_commit || null,
        controller: termCtrl,
        issuedAt,
      });
      writeAtomicJson(receiptPath, terminalReceipt);
      persistControllerWorkOrder(termCtrl, {
        terminal_status: terminalStatus,
        disposition: 'consumed',
        next_action: 'terminal',
        accepted_commit: termCtrl.accepted_commit,
        expected_receipt: {
          path: receiptPath,
          digest: terminalReceipt.digest,
          artifact_type: terminalReceipt.artifact_type,
        },
        paths: {
          receipt: receiptPath,
        },
      });
      const classified = classifyWorkOrder(controllerWorkOrder, {
        gitCwd: loopCwd,
        workOrderPath: controllerWorkOrderPath,
        requireBoundEvidence: true,
      });
      if (!classified
          || classified.classification !== 'consume_terminal'
          || classified.terminal_status !== terminalStatus
          || (terminalStatus === 'success' && classified.success !== true)
          || (terminalStatus !== 'success' && classified.success !== false)) {
        const err = new Error(
          `controller terminal Work Order failed exact classification: ${
            (classified && (classified.reason || classified.classification)) || 'unclassified'
          }`,
        );
        err.code = (classified && classified.reason_code)
          || 'controller_terminal_classification_failed';
        throw err;
      }
      campaignController = termCtrl;
      campaignControl.controller = termCtrl;
      return {
        controller: termCtrl,
        work_order: controllerWorkOrder,
        classification: classified,
        receipt_path: receiptPath,
      };
    };
    // Create/load controller WO before first external effect.
    try {
      persistControllerWorkOrder(campaignController);
      if (attachingExistingController) {
        const { classifyWorkOrder } = require('./work-order');
        const attached = classifyWorkOrder(controllerWorkOrder, {
          gitCwd: loopCwd,
          workOrderPath: controllerWorkOrderPath,
          requireBoundEvidence: true,
        });
        if (!attached || attached.classification !== 'attach_active') {
          const err = new Error(
            `controller owner transfer did not become attach_active: ${
              (attached && (attached.reason || attached.classification)) || 'unclassified'
            }`,
          );
          err.code = (attached && attached.reason_code) || 'controller_attach_transfer_failed';
          throw err;
        }
      }
    } catch (error) {
      releaseCampaignNoEffect({
        owner: 'controller_work_order',
        status: 'rejected',
        code: error.code || 'controller_work_order_persist_failed',
        reason: error.message || String(error),
      });
      throw error;
    }
    campaignControl.controller = campaignController;
    campaignControl.controller_work_order_id = controllerWorkOrder
      && controllerWorkOrder.work_order_id;
    campaignControl.controller_work_order_path = controllerWorkOrderPath;
    // Freeze the exact verification command/environment and terminal reviewer
    // roster before composition. Gate keys and the effects they authorize must
    // observe the same material inputs even if ambient process state changes.
    const verificationEnvironment = { ...(input.verificationEnv || process.env) };
    const verificationEnvAllowlist = Array.isArray(input.verificationEnvAllowlist)
      ? [...input.verificationEnvAllowlist] : undefined;
    const verificationArgvHash = campaignCanonicalDigest(verificationArgv(verifyCmd));
    const verificationEnvFingerprint = environmentFingerprint(
      verificationEnvironment,
      verificationEnvAllowlist,
    );
    const jointReviewRosterDigest = campaignCanonicalDigest(roster);
    const composition = this.campaignComposer({
      maxRepairGenerations,
      minPanelSize: roster.min_panel_size,
      lifecycleReceiptRef,
      controller: campaignController,
      frozenDenominator,
      includeControllerMeta: true,
      workOrderId: controllerWorkOrder && controllerWorkOrder.work_order_id,
      rootRunId: controllerRootRunId,
      gitCwd: loopCwd,
      promptFile,
      resume: (() => {
        // Production resume authority is the controller Work Order — not
        // optional generation_claim resume_* fields that intake never produces.
        const claim = campaignControl.generation_claim || {};
        const fromController = attachingExistingController && priorController
          ? {
            phase: priorController.phase || campaignControl.initial_state.phase,
            repair_generation: Number.isSafeInteger(priorController.repair_generation)
              ? priorController.repair_generation
              : campaignControl.initial_state.generation,
            candidate: resumeCandidate
              || priorController.candidate
              || null,
            controller: campaignController,
            verification: priorController.verification_receipt
              || claim.resume_verification
              || null,
            review: priorController.review_payload
              || claim.resume_review
              || null,
            findings: priorController.findings_snapshot
              || priorController.unresolved_findings
              || claim.resume_findings
              || null,
            full_diff_barriers: priorController.full_diff_barriers
              || claim.resume_full_diff_barriers
              || null,
            convergence_adjudication_receipt:
              priorController.convergence_adjudication_receipt
              || claim.resume_convergence_adjudication_receipt
              || null,
          }
          : null;
        if (resumeCandidate && !resumeSetupError
            && isObj(resumeCandidate)
            && (resumeCandidate.committed === true
              || isStr(resumeCandidate.commit)
              || isStr(resumeCandidate.tree_sha))) {
          const sealedCandidate = resumeCandidate.committed === true
            ? resumeCandidate
            : { ...resumeCandidate, committed: true };
          // Resume phase must be a composition-resumable durable phase — never
          // a raw PREPARED/IMPLEMENTING campaign phase from the journal alone.
          const resumable = new Set([
            'VERTICAL_VERIFICATION', 'ADJUDICATING',
            'AWAITING_DISPOSITION', 'awaiting_disposition',
            'AWAITING_CONVERGENCE_ADJUDICATION', 'awaiting_convergence_adjudication',
            'BOUNDARY_REJECTED', 'boundary_rejected', 'DISPOSITION_RESUMED',
          ]);
          const rawPhase = (fromController && fromController.phase)
            || claim.resume_phase
            || campaignControl.initial_state.phase
            || null;
          const phase = resumable.has(rawPhase) ? rawPhase : 'ADJUDICATING';
          return {
            phase,
            repair_generation: Number.isSafeInteger(
              fromController && fromController.repair_generation,
            ) ? fromController.repair_generation
              : (Number.isSafeInteger(campaignControl.initial_state.generation)
                ? campaignControl.initial_state.generation : 0),
            candidate: sealedCandidate,
            controller: campaignController,
            verification: (fromController && fromController.verification)
              || claim.resume_verification
              || null,
            review: (fromController && fromController.review)
              || claim.resume_review
              || null,
            findings: (fromController && fromController.findings)
              || claim.resume_findings
              || null,
            full_diff_barriers: (fromController && fromController.full_diff_barriers)
              || claim.resume_full_diff_barriers
              || null,
            convergence_adjudication_receipt:
              (fromController && fromController.convergence_adjudication_receipt)
              || claim.resume_convergence_adjudication_receipt
              || null,
          };
        }
        // Disposition-only resume from durable controller wait phase.
        // Require a sealed committed candidate (or boundary) before opening resume.
        if (fromController
            && (fromController.phase === 'awaiting_disposition'
              || fromController.phase === 'AWAITING_DISPOSITION'
              || fromController.phase === 'awaiting_convergence_adjudication'
              || fromController.phase === 'AWAITING_CONVERGENCE')
            && isObj(fromController.candidate)
            && (fromController.candidate.committed === true
              || fromController.phase === 'boundary_rejected'
              || fromController.phase === 'BOUNDARY_REJECTED')
            && isObj(fromController.verification)
            && isObj(fromController.review)) {
          return fromController;
        }
        return null;
      })(),
      historicalOutputPaths: (() => {
        const sd = campaignControl.contract.strict_dispatch || {};
        const paths = [
          ...(Array.isArray(sd.output_paths) ? sd.output_paths : []),
          ...(Array.isArray(sd.required_paths) ? sd.required_paths : []),
          ...(Array.isArray(sd.required_change_paths) ? sd.required_change_paths : []),
          ...(Array.isArray(campaignControl.contract.output_paths)
            ? campaignControl.contract.output_paths : []),
        ];
        return [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))];
      })(),
      repoIdentity: campaignControl.contract.repo_identity || null,
      missionLineageId: (campaignControl.contract.mission_runtime
        && campaignControl.contract.mission_runtime.mission_lineage_id) || null,
      missionPolicyDigest: (campaignControl.contract.mission_runtime
        && campaignControl.contract.mission_runtime.mission_policy_digest) || null,
      missionGraphDigest: (campaignControl.contract.mission_runtime
        && campaignControl.contract.mission_runtime.mission_graph_digest) || null,
      graphNodeId: (campaignControl.contract.mission_runtime
        && campaignControl.contract.mission_runtime.graph_node_id) || null,
      graphAttempt: exactMissionClaim && exactMissionClaim.graph_attempt,
      missionClaimId: exactMissionClaim && exactMissionClaim.claim_id,
      missionCampaignId: exactMissionClaim && exactMissionClaim.campaign_id,
      campaignContractDigest: exactMissionClaim
        ? exactMissionClaim.campaign_contract_digest
        : (campaignControl.contract_digest || null),
      strictContractDigest: campaignControl.contract_digest || null,
      fullSuiteCommandDigest: campaignCanonicalDigest(verifyCmd),
      verificationArgvHash,
      verificationEnvFingerprint,
      fullSuiteArgvHash: verificationArgvHash,
      fullSuiteEnvFingerprint: verificationEnvFingerprint,
      jointReviewRosterDigest,
      requireGateMaterialAuthority: true,
      baseSha: exactMissionClaim
        ? exactMissionClaim.base_sha
        : (base || currentBase || null),
    }, {
      onControllerUpdate: (nextController) => {
        persistControllerWorkOrder(nextController);
      },
      onCampaignEvent: ({
        event_type: eventType,
        generation,
        payload,
        artifact_reference: artifactReference,
      }) => {
        // Map composition event names onto the durable campaign reducer.
        const typeMap = {
          BOUNDARY_REJECTED: CAMPAIGN_EVENTS.BOUNDARY_REJECTED,
          AWAITING_DISPOSITION: CAMPAIGN_EVENTS.AWAITING_DISPOSITION,
          DISPOSITION_RESUMED: CAMPAIGN_EVENTS.DISPOSITION_RESUMED,
          AWAITING_CONVERGENCE: CAMPAIGN_EVENTS.AWAITING_CONVERGENCE,
        };
        const mapped = typeMap[eventType] || eventType;
        // Lease-bound events (BOUNDARY_REJECTED, AWAITING_CONVERGENCE, …) are
        // fenced against the live mutation lease and RELEASE it on reduction. A
        // synthesized `controller-<event>:<gen>` identity is not the lease owner,
        // so the reducer answers LEASE_FENCED and the journal strands mid-mutation
        // with the lease held. Take the identity from the durable lease, exactly
        // as the terminal-failure path does.
        const identity = resolveCampaignEventLeaseIdentity(
          campaignControl.initial_state,
          mapped,
          {
            generation: Number.isSafeInteger(generation) ? generation : 0,
            stageIdentity: `controller-${String(mapped).toLowerCase()}:${generation || 0}`,
          },
        );
        try {
          recordCampaignEvent({
            eventType: mapped,
            generation: identity.generation,
            stageIdentity: identity.stage_identity,
            payload: payload || {},
            // Without this the appender derives output_artifact_digest from the
            // stage identity instead, and BOUNDARY_REJECTED — whose reducer
            // branch compares it against canonicalDigest({kind:
            // 'campaign_boundary_rejected', digest: boundary_receipt_digest}) —
            // is refused with BOUNDARY_EVIDENCE_REQUIRED, leaving the campaign
            // in IMPLEMENTING with the mutation lease still held.
            artifactReference: artifactReference || null,
          });
        } catch (error) {
          // Event journal failure must stop effects.
          const err = new Error(error.message || String(error));
          err.code = error.code || 'campaign_event_journal';
          throw err;
        }
      },
      preEffectAdmit: ({ controller: c, wouldCreateWorktree, baseSha: effectBaseSha }) => {
        const {
          admitControllerEffects,
        } = require('./controller-execution');
        return admitControllerEffects({
          gitCwd: loopCwd,
          controller: c || campaignController,
          rootRunId: controllerRootRunId,
          graphNode: controllerGraphNode,
          attempt: controllerAttempt,
          workOrderId: controllerWorkOrder && controllerWorkOrder.work_order_id,
          workOrderGeneration: controllerWorkOrder && controllerWorkOrder.generation,
          workOrderCasToken: controllerWorkOrder && controllerWorkOrder.cas_token,
          expectedWorkOrderDigest: controllerWorkOrder && controllerWorkOrder.digest,
          expectedControllerDigest: controllerWorkOrder
            && controllerWorkOrder.controller
            && controllerWorkOrder.controller.controller_digest,
          wouldCreateWorktree: wouldCreateWorktree === true,
          baseSha: effectBaseSha || base || null,
        });
      },
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
        review_input_mode: reviewInputMode = 'full_diff_generation',
        controller: implementController,
      }) => {
        // Joint repair budget (durable controller) before any model/checkout spend.
        const joint = checkJointRepairBudget(
          (implementController || campaignController).repair_budget_usage,
          (implementController || campaignController).repair_budget_limits,
          { beforeSpend: true, projectedDelta: { model_calls: 1 } },
        );
        if (!joint.allow_spend) {
          return {
            committed: false,
            phase: 'awaiting_convergence_adjudication',
            reason: joint.reason,
            awaiting_convergence_adjudication: true,
            exceeded: joint.exceeded,
            controller: implementController || campaignController,
          };
        }
        const budgetAt = this.now();
        const budget = campaignMutationBudgetStatus(campaignControl, budgetAt);
        if (budget.exhausted) {
          return {
            committed: false,
            phase: 'campaign_wall_budget',
            reason: 'campaign mutation budget exhausted',
          };
        }
        const candidateImplementationRound = implementationRound + 1;
        const currentBranch = branch;
        let authorizedFindingState = null;
        if (kind !== 'initial') {
          if (!new Set(['full_diff_generation', 'focused_delta_round']).has(
            reviewInputMode,
          )) {
            return {
              committed: false,
              phase: 'campaign_review_input_mode',
              reason: 'repair review input mode is invalid',
            };
          }
          repairLineage.review_input_mode = reviewInputMode;
          const normalizedFindingIds = [...new Set(
            (Array.isArray(findingIds) ? findingIds : []).filter(
              (findingId) => typeof findingId === 'string' && findingId.length > 0,
            ),
          )].sort();
          const repeatedFindingIds = normalizedFindingIds.filter(
            (findingId) => (repairFindingOccurrences.get(findingId) || 0) >= 2,
          );
          const nextNonReductionRounds = previousRepairFindingCount !== null
            ? (normalizedFindingIds.length >= previousRepairFindingCount
              ? nonReductionRounds + 1
              : 0)
            : nonReductionRounds;
          const findingReductionStalled = nextNonReductionRounds >= 2;
          if (repeatedFindingIds.length > 0 || findingReductionStalled) {
            return {
              committed: false,
              phase: 'awaiting_convergence_adjudication',
              reason: repeatedFindingIds.length > 0
                ? `recurring finding lineage exhausted: ${repeatedFindingIds.join(',')}`
                : 'finding set did not measurably shrink across two repair rounds',
              awaiting_convergence_adjudication: true,
              recurring_finding_ids: repeatedFindingIds,
              non_reduction_rounds: nextNonReductionRounds,
            };
          }
          if (!Array.isArray(repairLineage.repair_scope_paths)
              || repairLineage.repair_scope_paths.length === 0) {
            return {
              committed: false,
              phase: 'campaign_repair_scope_seal',
              reason: 'repair scope cannot be sealed without initial changed paths',
            };
          }
          let findingPaths;
          try {
            findingPaths = findingBoundRepairPaths(
              repairFindings,
              campaignControl.contract.allowed_path_prefixes,
            );
          } catch (error) {
            return {
              committed: false,
              phase: 'campaign_repair_scope_seal',
              reason: error.message || String(error),
            };
          }
          repairLineage.repair_scope_seal = createRepairScopeSeal({
            findingIds: normalizedFindingIds,
            allowedPaths: findingPaths,
            sourceCommit: currentBase,
          });
          repairLineage.repair_scope_paths = findingPaths;
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
              round: candidateImplementationRound,
              base,
              previousCommit: currentBase,
              commit: currentBase,
              review: repairReview,
              unresolvedFindingIds: normalizedFindingIds,
              acceptedInvariants: repairLineage.accepted_invariants,
              acceptedInvariantsSourceCommit:
                repairLineage.accepted_invariants_source_commit,
              acceptedInvariantsDigest: repairLineage.accepted_invariants_digest,
              noRegressionAssertions,
              reviewInputMode,
              repairScopeSeal: repairLineage.repair_scope_seal,
            });
          } catch (error) {
            return {
              committed: false,
              phase: 'campaign_repair_prompt',
              reason: error.message || String(error),
            };
          }
          authorizedFindingState = {
            findingIds: normalizedFindingIds,
            nonReductionRounds: nextNonReductionRounds,
          };
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
          implementationRound: candidateImplementationRound,
          implementationStage: 'campaign-implementation',
          campaignContractFile: campaignControl.contract_path,
          campaignContractDigest: campaignControl.contract_digest,
          campaignSealFile: campaignControl.seal_path,
          resultJson: input.resultJson,
          gitDir: input.gitDir,
          extraImplementationArgs: Object.prototype.hasOwnProperty.call(
            input,
            'extraImplementationArgs',
          ) ? input.extraImplementationArgs : [],
          keepWorktree: true,
          reuseWorktree: candidateImplementationRound > 1
            ? repairLineage.worktree
            : null,
          expectedWorktreeInstanceId: candidateImplementationRound > 1
            ? repairLineage.worktree_instance_id
            : null,
          resumeSessionId: resumableProviderSession && candidateImplementationRound > 1
            ? repairLineage.provider_session_id
            : null,
          retentionOwner: campaignControl.campaign_id,
          retentionReason: 'implementation-campaign-repair-lineage',
          retentionExpiresAt,
          implementationOptions: {
            ...(input.implementationOptions || {}),
            cwd: loopCwd,
          },
        });
        ledger.push(...implementation.ledger);
        implementationChain.push(implementation);
        if (implementation.status === 'no_op'
            && implementation.dispatcher_called === false
            && isExactSealedZeroDiffLeaf(
              implementation.implementation,
              implementation.unit_contract,
            )) {
          return {
            committed: false,
            no_op: true,
            status: 'no_op',
            phase: 'sealed_zero_diff',
            reason: null,
            dispatcher_called: false,
            model_calls: 0,
            fresh_input_bytes: 0,
            fresh_input_tokens: null,
            mutation_attempts: 0,
            gate_attempts: 0,
            resources_created: 0,
            zero_diff_receipt_digest:
              implementation.implementation.zero_diff_receipt_digest,
            raw: implementation,
          };
        }
        if (implementation.status === 'blocked'
            && implementation.dispatcher_called === false
            && isExactZeroEffectPreconditionLeaf(implementation.implementation)) {
          const leaf = implementation.implementation;
          return {
            committed: false,
            status: 'precondition_failed',
            phase: implementation.phase || 'precondition_failed',
            reason: implementation.reason || 'implementation precondition failed',
            commit: null,
            worktree: null,
            agent_log: null,
            files_changed: 0,
            insertions: 0,
            deletions: 0,
            dispatcher_called: false,
            model_calls: 0,
            fresh_input_bytes: 0,
            fresh_input_tokens: null,
            mutation_attempts: 0,
            gate_attempts: 0,
            resources_created: 0,
            raw: implementation,
          };
        }
        if (implementation.dispatcher_called !== true) {
          return {
            committed: false,
            phase: implementation.phase || 'prepare_implementation',
            reason: implementation.reason || 'implementation was not dispatched',
          };
        }
        implementationRound = candidateImplementationRound;
        if (authorizedFindingState) {
          previousRepairFindingCount = authorizedFindingState.findingIds.length;
          nonReductionRounds = authorizedFindingState.nonReductionRounds;
          for (const findingId of authorizedFindingState.findingIds) {
            repairFindingOccurrences.set(
              findingId,
              (repairFindingOccurrences.get(findingId) || 0) + 1,
            );
          }
          syncRepairFindingState();
        }
        const dispatched = implementation.implementation;
        repairLineage.cleanup_epoch += 1;
        if (dispatched && typeof dispatched.worktree === 'string'
            && path.isAbsolute(dispatched.worktree)) {
          if (repairLineage.worktree !== null
              && dispatched.worktree !== repairLineage.worktree) {
            return postDispatchLineageFailure(
              'repair dispatch changed retained worktree identity',
            );
          }
          repairLineage.worktree = dispatched.worktree;
          repairLineage.worktree_reused = dispatched.worktree_reused === true;
          let dispatchedInstanceId;
          try {
            dispatchedInstanceId = repairWorktreeInstanceId(dispatched.worktree);
          } catch (error) {
            return postDispatchLineageFailure(
              `cannot attest retained worktree instance: ${error.message}`,
            );
          }
          if (repairLineage.worktree_instance_id !== null
              && repairLineage.worktree_reused
              && dispatchedInstanceId !== repairLineage.worktree_instance_id) {
            return postDispatchLineageFailure(
              'reused worktree changed filesystem instance identity',
            );
          }
          repairLineage.worktree_instance_id = dispatchedInstanceId;
        }
        if (dispatched && typeof dispatched.provider_session_id === 'string'
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
              dispatched.provider_session_id,
            )) {
          if (repairLineage.provider_session_id !== null
              && dispatched.provider_session_id !== repairLineage.provider_session_id) {
            return postDispatchLineageFailure(
              'repair dispatch changed provider session identity',
            );
          }
          repairLineage.provider_session_id = dispatched.provider_session_id;
          repairLineage.provider_session_reused =
            dispatched.provider_session_reused === true;
          repairLineage.transcript_reused = repairLineage.provider_session_reused;
        }
        if (implementation.status !== 'committed') {
          repairLineage.terminal_worktree_disposition = repairLineage.worktree === null
            ? 'not_created_failed_dispatch'
            : 'retained_failed_dispatch';
          if (implementation.status === 'boundary_rejected') {
            const boundaryCandidate = implementation.candidate_ref
              || (dispatched && (
                dispatched.commit || dispatched.candidate_ref || dispatched.tip
              ))
              || null;
            return {
              committed: false,
              status: 'boundary_rejected',
              phase: 'boundary_rejected',
              reason: implementation.boundary_reason
                || implementation.reason
                || 'boundary rejected',
              boundary_reason: implementation.boundary_reason
                || implementation.reason
                || 'boundary rejected',
              boundary_code: implementation.boundary_code
                || 'scope_or_budget_boundary',
              candidate_ref: boundaryCandidate,
              possibly_effectful: implementation.possibly_effectful === true
                || boundaryCandidate !== null,
              mutation_failed: false,
              unknown_status: false,
              dispatcher_called: implementation.dispatcher_called === true,
              model_calls: implementation.model_calls,
              repair_lineage: { ...repairLineage },
              raw: implementation,
            };
          }
          return {
            committed: false,
            phase: implementation.phase || 'dispatch_implementation',
            reason: implementation.reason || `implementation status ${implementation.status}`,
            dispatcher_called: implementation.dispatcher_called === true,
            model_calls: implementation.model_calls,
            repair_lineage: { ...repairLineage },
            raw: implementation,
          };
        }
        const commit = implementation.implementation.commit;
        if (typeof dispatched.worktree !== 'string'
              || !path.isAbsolute(dispatched.worktree)) {
          return postDispatchLineageFailure(
            'retained implementation worktree identity is missing',
          );
        }
        if (resumableProviderSession
            && (typeof dispatched.provider_session_id !== 'string'
              || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                dispatched.provider_session_id,
              ))) {
          return postDispatchLineageFailure(
            'Grok implementation did not return a resumable provider session',
          );
        }
        if (repairLineage.worktree !== null
            && dispatched.worktree !== repairLineage.worktree) {
          return postDispatchLineageFailure(
            'repair dispatch changed retained worktree identity',
          );
        }
        if (resumableProviderSession && repairLineage.provider_session_id !== null
            && dispatched.provider_session_id !== repairLineage.provider_session_id) {
          return postDispatchLineageFailure(
            'repair dispatch changed provider session identity',
          );
        }
        repairLineage.worktree = dispatched.worktree;
        repairLineage.provider_session_id = resumableProviderSession
          ? dispatched.provider_session_id
          : null;
        repairLineage.provider_session_reused = resumableProviderSession
          && dispatched.provider_session_reused === true;
        repairLineage.provider_session_non_reuse_reason = resumableProviderSession
          ? null
          : `runner_resume_not_verified:${roster.implementer_runner}`;
        repairLineage.worktree_reused = dispatched.worktree_reused === true;
        repairLineage.transcript_reused = repairLineage.provider_session_reused;
        repairLineage.transcript_source_digest = campaignCanonicalDigest(
          fs.readFileSync(repairPromptFile, 'utf8'),
        );
        repairLineage.new_input_bytes += fs.statSync(repairPromptFile).size;
        const inputTokens = dispatched.usage
          && Number.isSafeInteger(dispatched.usage.input_tokens)
          ? dispatched.usage.input_tokens
          : null;
        if (inputTokens !== null) {
          repairLineage.new_input_tokens =
            (repairLineage.new_input_tokens || 0) + inputTokens;
          repairLineage.input_token_measurement = 'provider_reported';
        }
        repairLineage.generation = repairGeneration;
        repairLineage.delta_churn += Number.isSafeInteger(dispatched.insertions)
          && Number.isSafeInteger(dispatched.deletions)
          ? dispatched.insertions + dispatched.deletions
          : 0;
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
          owned_worktrees_current: repairLineage.worktree ? 1 : 0,
          resource_inventory_delta: repairLineage.worktree ? [{
            resource_id: repairLineage.worktree,
            kind: 'worktree',
            path: repairLineage.worktree,
            worktree: repairLineage.worktree,
            branch: currentBranch,
            tip: commit,
            base_sha: base,
            identity_known: true,
            active: true,
            terminal: true,
            terminal_receipt_digest: writerFence.receipt_digest,
          }] : [],
          writer_fence: writerFence,
          dispatcher_called: implementation.dispatcher_called === true,
          model_calls: Number.isSafeInteger(implementation.model_calls)
            && implementation.model_calls >= 0
            ? implementation.model_calls
            : (Number.isSafeInteger(dispatched.model_calls)
              && dispatched.model_calls >= 0 ? dispatched.model_calls : 1),
          mutation_attempts: Number.isSafeInteger(dispatched.mutation_attempts)
            && dispatched.mutation_attempts >= 0 ? dispatched.mutation_attempts : 1,
          gate_attempts: Number.isSafeInteger(dispatched.gate_attempts)
            && dispatched.gate_attempts >= 0 ? dispatched.gate_attempts : 0,
          resources_created: Number.isSafeInteger(dispatched.resources_created)
            && dispatched.resources_created >= 0
            ? dispatched.resources_created
            : (repairLineage.worktree ? 1 : 0),
          ...(writerFence.campaign_contract_sha256 ? {
            campaign_contract_sha256: writerFence.campaign_contract_sha256,
            unit_contract_sha256: writerFence.unit_contract_sha256,
          } : {}),
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
        try {
          const changedFiles = Array.isArray(receipt.changed_files)
            ? [...new Set(receipt.changed_files)].sort()
            : [];
          if (receipt.passed === true && checkpoint === 'after_initial_mutation') {
            repairLineage.repair_scope_paths = changedFiles;
          }
          if (receipt.passed === true && checkpoint === 'after_repair_mutation') {
            if (!repairScopeSealValid(repairLineage.repair_scope_seal)) {
              throw new Error('repair scope seal is missing or invalid');
            }
            const delta = this.campaignRepairChangedPaths({
              repo: loopCwd,
              base: repairLineage.repair_scope_seal.source_commit,
              head: candidate.commit,
            });
            if (!delta || delta.status !== 'ok' || !Array.isArray(delta.paths)) {
              throw new Error(
                delta && delta.reason
                  ? delta.reason
                  : 'cannot resolve repair delta paths',
              );
            }
            const allowed = new Set(repairLineage.repair_scope_seal.allowed_paths);
            const unauthorized = delta.paths.filter((file) => !allowed.has(file));
            if (unauthorized.length > 0) {
              throw new Error(
                `repair changed paths outside its finding-bound seal: ${unauthorized.join(',')}`,
              );
            }
          }
          receipt = bindCampaignScopeReceipt({
            receipt,
            candidate,
            campaignContractSha256: campaignControl.contract_digest,
          });
        } catch (error) {
          return {
            ...receipt,
            passed: false,
            reason: error.message || String(error),
            phase: 'campaign_scope_digest',
          };
        }
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
            const completionIdentity = resolveCampaignEventLeaseIdentity(
              state,
              eventType,
              { generation: state.generation },
            );
            recordCampaignEvent({
              eventType,
              generation: completionIdentity.generation,
              stageIdentity: completionIdentity.stage_identity,
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
                repair_lineage: { ...repairLineage },
                ...(candidate.campaign_contract_sha256 ? {
                  campaign_contract_sha256: candidate.campaign_contract_sha256,
                  unit_contract_sha256: candidate.unit_contract_sha256,
                } : {}),
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
        const request = createVerificationRequest({
          treeSha: candidate.tree_sha,
          verifyCmd,
          env: verificationEnvironment,
          envAllowlist: verificationEnvAllowlist,
        });
        const cached = verificationCache.get(request.request_digest);
        if (reusableGreenReceipt(cached, request)) {
          recordAcceptedVerificationInvariants(candidate.commit);
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
              env: verificationEnvironment,
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
        if (receipt.verdict === 'GREEN') {
          verificationCache.set(request.request_digest, receipt);
          recordAcceptedVerificationInvariants(candidate.commit);
        }
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
      fullSuite: ({ candidate, repair_generation: repairGeneration }) => {
        // The sealed verify command is the campaign's complete declared
        // command set.  Run it again as the authoritative full-suite gate on
        // a fresh detached checkout; a focused/cached verification receipt
        // cannot impersonate this execution.
        // The full-suite command is the exact command admitted from the sealed
        // campaign contract. An ambient/caller fullSuiteCommand is never
        // executable authority (including a trivially successful "true").
        const fullSuiteCmd = verifyCmd;
        const suiteRequest = createVerificationRequest({
          treeSha: candidate.tree_sha,
          verifyCmd: fullSuiteCmd,
          env: verificationEnvironment,
          envAllowlist: verificationEnvAllowlist,
        });
        const startedAt = this.now();
        let addResult = null;
        let worktree = null;
        let parent = null;
        let worktreeAdded = false;
        let checkoutAttestation = null;
        let suiteResult = null;
        let setupReason = null;
        let cleanupReason = null;
        try {
          addResult = this.gitWorktreeAdd({
            commit: candidate.commit,
            cwd: loopCwd,
            round: repairGeneration + 1001,
            branch: candidate.branch,
          });
          worktree = addResult && addResult.worktree;
          parent = addResult && addResult.parent;
          setupReason = worktreeResultBlocked(addResult);
          if (!setupReason) {
            worktreeAdded = true;
            checkoutAttestation = createDetachedCheckoutAttestation({
              candidateCommit: candidate.commit,
              candidateTreeSha: candidate.tree_sha,
              worktreeResult: addResult,
            });
            suiteResult = this.verifyCommandRunner({
              verifyCmd: fullSuiteCmd,
              cwd: worktree,
              env: verificationEnvironment,
              round: repairGeneration + 1001,
              commit: candidate.commit,
              branch: candidate.branch,
              fullSuite: true,
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
                round: repairGeneration + 1001,
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
                round: repairGeneration + 1001,
                commit: candidate.commit,
                branch: candidate.branch,
                reason: 'campaign_full_suite_parent_cleanup',
              });
            } catch (error) {
              cleanupReason = cleanupReason || error.message || String(error);
            }
          }
        }
        const executed = !setupReason && isObj(suiteResult);
        const blockedReason = executed ? verifyResultBlocked(suiteResult) : setupReason;
        const executedArgvHash = executed
          && Array.isArray(suiteResult.executed_argv)
          && suiteResult.executed_argv.every((part) => typeof part === 'string')
          ? campaignCanonicalDigest(suiteResult.executed_argv)
          : null;
        const runnerArgvAttested = executedArgvHash === suiteRequest.argv_hash;
        const passed = executed
          && !blockedReason
          && suiteResult.status === 0
          && runnerArgvAttested
          && !cleanupReason;
        const body = {
          schema_version: 1,
          artifact_type: 'campaign_full_suite_receipt',
          campaign_id: campaignControl.campaign_id,
          candidate_commit: candidate.commit,
          candidate_tree_sha: candidate.tree_sha,
          command_digest: campaignCanonicalDigest(fullSuiteCmd),
          argv_hash: executedArgvHash,
          env_fingerprint: suiteRequest.env_fingerprint,
          request_digest: runnerArgvAttested ? suiteRequest.request_digest : null,
          runner_argv_attested: runnerArgvAttested,
          checkout_attestation_digest: checkoutAttestation
            ? checkoutAttestation.receipt_digest : null,
          executed,
          exit_status: executed && Number.isInteger(suiteResult.status)
            ? suiteResult.status : null,
          passed,
          setup_reason: blockedReason || null,
          cleanup_reason: cleanupReason || null,
          reason: passed
            ? null
            : (blockedReason
              || (!runnerArgvAttested ? 'full suite runner argv attestation failed' : null)
              || cleanupReason
              || 'full suite failed'),
          started_at: startedAt,
          finished_at: this.now(),
        };
        return {
          ...body,
          receipt_digest: campaignCanonicalDigest(body),
        };
      },
      review: (reviewInput) => performReview(reviewInput),
      prepareReview: (reviewInput) => prepareReview(reviewInput),
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
      finalPanel: (reviewInput) => performFinalPanel(reviewInput),
    });

    if (composition.status === 'no_op'
        && composition.no_op === true
        && composition.dispatcher_called === false
        && composition.mutation_attempts === 0
        && composition.gate_attempts === 0
        && composition.resources_created === 0
        && isStr(composition.zero_diff_receipt_digest)) {
      const noOpImplementation = implementationChain.at(-1) || null;
      const release = releaseCampaignNoEffect(buildCampaignPreSpendRejection({
        owner: 'sealed_zero_diff',
        code: 'campaign_zero_diff_adopted',
        reason: 'sealed zero-diff receipt satisfied the required-change node',
        result: noOpImplementation,
      }), { leafProof: noOpImplementation });
      if (!release || release.status !== 'released') {
        return {
          status: 'blocked',
          phase: 'campaign_admission_release',
          reason: (release && (release.reason || release.error))
            || 'sealed zero-diff no-effect release failed closed',
          rounds: implementationChain.length,
          roster,
          resolveResult,
          implementation: noOpImplementation,
          implementationChain,
          reviewChain,
          campaign_receipt: composition,
          ledger,
        };
      }
      try {
        terminalizeControllerWorkOrder({
          terminalStatus: 'aborted',
          phase: 'sealed_zero_diff',
          reason: 'no new campaign effect; prior exact bytes adopted',
          controller: composition.controller || campaignController,
          acceptedCommit: null,
        });
      } catch (error) {
        return {
          status: 'blocked',
          phase: 'controller_work_order_terminalize',
          reason: error.message || String(error),
          rounds: implementationChain.length,
          roster,
          resolveResult,
          implementation: noOpImplementation,
          implementationChain,
          reviewChain,
          campaign_receipt: composition,
          ledger,
        };
      }
      return {
        status: 'no_op',
        phase: 'sealed_zero_diff',
        reason: null,
        rounds: implementationChain.length,
        verdict: null,
        roster,
        resolveResult,
        base,
        implementation: noOpImplementation,
        review: null,
        implementationChain,
        reviewChain,
        campaign_receipt: composition,
        dispatcher_called: false,
        mutation_attempts: 0,
        gate_attempts: 0,
        resources_created: 0,
        zero_diff_receipt_digest: composition.zero_diff_receipt_digest,
        ledger,
      };
    }

    // Durable controller waits: do not terminalize/release; return resumable status.
    const {
      AWAITING_DISPOSITION: durableAwaitDisposition,
      AWAITING_CONVERGENCE: durableAwaitConvergence,
      BOUNDARY_REJECTED: durableBoundaryRejected,
    } = require('./controller-execution');
    const durableWaitStatuses = new Set([
      'awaiting_disposition',
      'awaiting_convergence_adjudication',
      'boundary_rejected',
      durableAwaitDisposition,
      durableAwaitConvergence,
      durableBoundaryRejected,
    ]);
    if (durableWaitStatuses.has(composition.status)
        || composition.durable_wait === true
        || composition.terminalize === false
        || composition.awaiting_convergence_adjudication === true) {
      // Persist controller phase on the same nonterminal Work Order.
      if (composition.controller && typeof composition.controller === 'object') {
        try {
          // onControllerUpdate already ran inside composition; re-bind for return.
          campaignControl.controller = composition.controller;
        } catch (_e) { /* already persisted or not */ }
      }
      return {
        status: composition.status === 'boundary_rejected' ? 'blocked' : composition.status,
        phase: composition.phase || composition.status,
        reason: composition.reason,
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
        controller: composition.controller || campaignController,
        durable_wait: true,
        resumable: true,
        ledger,
      };
    }

    if (!new Set(['ready', 'follow_up']).has(composition.status)) {
      const finalImplementation = implementationChain.at(-1) || null;
      let controllerTerminalStatus = null;
      const soleInitialPreSpend = implementationChain.length === 0
        || (implementationChain.length === 1
          && isCampaignPreSpendRejection(finalImplementation));
      // Exact zero-effect after sole initial leaf (durable only): either a
      // dispatcher precondition_failed with null mutation facts, or a sealed
      // root-identity prepare_implementation rejection (explicit code +
      // dispatcher_called === false). Ambiguous / post-dispatch / other-code
      // prepare failures remain fail-closed possibly effectful.
      const soleInitialExactZeroEffectLeaf = implementationChain.length === 1
        && isExactZeroEffectLeafProof(finalImplementation);
      if (!durableJournal && soleInitialPreSpend) {
        releaseCampaignNoEffect(buildCampaignPreSpendRejection({
          owner: 'campaign_composition',
          code: 'campaign_pre_effect_blocked',
          reason: composition.reason || 'campaign composition blocked before mutation',
          result: finalImplementation,
        }), { leafProof: finalImplementation });
      } else if (durableJournal && soleInitialExactZeroEffectLeaf) {
        // Durable journals record IMPLEMENTATION_STARTED before dispatch. When
        // the sole initial leaf is the exact fail-closed zero-effect shape,
        // release Mission/ICC admission instead of terminalizing as effectful.
        const rejection = buildCampaignPreSpendRejection({
          owner: 'campaign_composition',
          code: 'campaign_pre_effect_blocked',
          reason: composition.reason || 'campaign composition blocked before mutation',
          result: finalImplementation,
        });
        const release = releaseCampaignNoEffect(rejection, {
          leafProof: finalImplementation,
        });
        if (!release || release.status !== 'released') {
          return {
            status: 'blocked',
            phase: 'campaign_admission_release',
            reason: (release && (release.reason || release.error))
              || 'zero-effect leaf release failed closed',
            rounds: implementationChain.length,
            verdict: latestReview ? latestReview.verdict : null,
            roster,
            resolveResult,
            base,
            implementation: finalImplementation,
            review: latestReview,
            implementationChain,
            reviewChain,
            campaign_receipt: composition,
            ledger,
          };
        }
        controllerTerminalStatus = 'aborted';
      } else if (durableJournal) {
        if (repairLineage.terminal_worktree_disposition === 'active') {
          repairLineage.terminal_worktree_disposition =
            repairLineage.worktree === null
              ? 'not_created_failed_dispatch'
              : 'retained_failed_dispatch';
        }
        const failure = this.terminalizeManagedCampaignFailure({
          campaignControl,
          reason: composition.reason,
          phase: composition.phase,
          cwd: loopCwd,
          repairLineage,
        });
        campaignControl.terminal_failure = failure;
        if (failure.status === 'rejected') {
          return {
            status: 'blocked',
            phase: 'campaign_repair_required',
            reason: failure.reason,
            remedy: failure.remedy || null,
            rounds: implementationChain.length,
            roster,
            resolveResult,
            implementationChain,
            reviewChain,
            campaign_receipt: composition,
            ledger,
          };
        }
        if (failure.status === 'no_effect') {
          const release = releaseCampaignNoEffect(buildCampaignPreSpendRejection({
            owner: 'campaign_composition',
            code: 'campaign_pre_effect_blocked',
            reason: composition.reason || 'campaign composition blocked before mutation',
            result: finalImplementation,
          }), { leafProof: finalImplementation });
          if (!release || release.status !== 'released') {
            return {
              status: 'blocked',
              phase: 'campaign_admission_release',
              reason: (release && (release.reason || release.error))
                || 'no-effect campaign release failed closed',
              rounds: implementationChain.length,
              verdict: latestReview ? latestReview.verdict : null,
              roster,
              resolveResult,
              base,
              implementation: finalImplementation,
              review: latestReview,
              implementationChain,
              reviewChain,
              campaign_receipt: composition,
              ledger,
            };
          }
          controllerTerminalStatus = 'aborted';
        } else if (failure.status !== 'terminalized') {
          return {
            status: 'blocked',
            phase: failure.phase || 'campaign_terminal_reconciliation',
            reason: failure.reason || 'managed campaign failure terminalization failed',
            rounds: implementationChain.length,
            verdict: latestReview ? latestReview.verdict : null,
            roster,
            resolveResult,
            base,
            implementation: finalImplementation,
            review: latestReview,
            implementationChain,
            reviewChain,
            campaign_receipt: composition,
            ledger,
          };
        } else {
          controllerTerminalStatus = 'failed';
        }
      }
      if (controllerTerminalStatus !== null) {
        try {
          terminalizeControllerWorkOrder({
            terminalStatus: controllerTerminalStatus,
            phase: composition.phase || 'campaign_non_success',
            reason: composition.reason || 'managed campaign ended without success',
            controller: composition.controller || campaignController,
            acceptedCommit: composition.controller
              && composition.controller.accepted_commit,
          });
        } catch (error) {
          return {
            status: 'blocked',
            phase: 'controller_work_order_terminalize',
            reason: error.message || String(error),
            rounds: implementationChain.length,
            verdict: latestReview ? latestReview.verdict : null,
            roster,
            resolveResult,
            base,
            implementation: finalImplementation,
            review: latestReview,
            implementationChain,
            reviewChain,
            campaign_receipt: composition,
            ledger,
          };
        }
      }
    }

    if (new Set(['ready', 'follow_up']).has(composition.status)
        && repairLineage.worktree !== null) {
      const cleanupId = repairLineageCleanupId({
        lineageId: repairLineage.lineage_id,
        branch: repairLineage.branch,
        worktree: repairLineage.worktree,
        expectedTip: currentBase,
        cleanupEpoch: repairLineage.cleanup_epoch,
        worktreeInstanceId: repairLineage.worktree_instance_id,
      });
      const cleanupRecord = {
        lineage_id: repairLineage.lineage_id,
        branch: repairLineage.branch,
        worktree: repairLineage.worktree,
        expected_tip: currentBase,
        cleanup_epoch: repairLineage.cleanup_epoch,
        worktree_instance_id: repairLineage.worktree_instance_id,
        retention_owner: repairLineage.retention_owner,
        retention_reason: repairLineage.retention_reason,
        retention_expires_at: repairLineage.retention_expires_at,
      };
      const transaction = this.repairLineageCleanupTransaction({
        cwd: loopCwd,
        cleanupId,
        record: cleanupRecord,
      });
      const transactionBlocked = worktreeResultBlocked(transaction);
      if (transactionBlocked) {
        repairLineage.terminal_worktree_disposition =
          'blocked_dirty_or_unverifiable';
        return {
          status: 'blocked',
          phase: 'campaign_repair_lineage_cleanup',
          reason: transactionBlocked,
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
          repair_lineage: repairLineage,
          ledger,
        };
      }
      repairLineage.terminal_worktree_disposition = 'removed_clean';
      repairLineage.cleanup_receipt_id = cleanupId;
      try {
        const recoveryReceipt = buildRecoveryReceipt({
          resourceId: repairLineage.worktree,
          path: repairLineage.worktree,
          branch: repairLineage.branch,
          tip: currentBase,
          evidenceKind: 'clean_release',
          gitCwd: loopCwd,
          baseSha: base,
          removed: true,
        });
        const priorResources = Array.isArray(campaignController.resource_inventory)
          ? campaignController.resource_inventory : [];
        const recoveredResource = {
          resource_id: repairLineage.worktree,
          kind: 'worktree',
          path: repairLineage.worktree,
          worktree: repairLineage.worktree,
          root_run_id: controllerRootRunId,
          work_order_id: controllerWorkOrderId,
          branch: recoveryReceipt.branch,
          tip: recoveryReceipt.tip,
          clean: recoveryReceipt.outcome.clean,
          dirty: recoveryReceipt.outcome.dirty,
          unique: recoveryReceipt.outcome.unique,
          terminal: recoveryReceipt.outcome.terminal,
          identity_known: recoveryReceipt.outcome.identity_known,
          active: false,
          recovery_receipt: recoveryReceipt,
        };
        const updatedResources = priorResources
          .filter((item) => item
            && (item.resource_id || item.path || item.worktree) !== repairLineage.worktree);
        updatedResources.push(recoveredResource);
        const recoveredController = emptyControllerState({
          ...(campaignController || composition.controller || {}),
          resource_inventory: updatedResources,
          recovery_receipts: [
            ...((campaignController && campaignController.recovery_receipts) || []),
            recoveryReceipt,
          ],
        });
        persistControllerWorkOrder(recoveredController);
        campaignController = recoveredController;
      } catch (error) {
        return {
          status: 'blocked',
          phase: 'campaign_repair_lineage_recovery_receipt',
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
          repair_lineage: repairLineage,
          ledger,
        };
      }
    }

    // Boundary and wait outcomes remain resumable/nonterminal. Ready and
    // follow_up are both Mission terminal outcomes and receive an exact,
    // classifier-validated controller Work Order disposition.
    const compositionImplCommit = (implementationChain.at(-1) && implementationChain.at(-1).commit)
      || null;
    let missionTerminalCompleted = false;
    let missionTerminalOutcomeCompleted = false;
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
        const terminalObservedAt = this.now();
        const appended = recordCampaignEvent({
          eventType: terminalEvent,
          generation: campaignControl.initial_state.generation,
          stageIdentity: `campaign-terminal:${campaignControl.initial_state.generation}`,
          payload,
          artifactReference: {
            kind: 'campaign_terminal',
            digest: composition.receipt_digest,
            repair_lineage: { ...repairLineage },
          },
          observedAt: terminalObservedAt,
        });
        campaignControl.terminal_event = appended.event;
        const completed = this.completeManagedCampaignTerminal({
          campaignControl,
          outcome: composition.status,
          observedAt: appended.event.timestamp,
          cwd: loopCwd,
        });
        if (completed.status !== 'completed') {
          return {
            status: 'blocked',
            phase: completed.phase,
            reason: completed.reason,
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
        refreshExactMissionAuthority();
        missionTerminalOutcomeCompleted = completed.status === 'completed';
        missionTerminalCompleted = composition.status === 'ready'
          && completed.status === 'completed';
        // After Mission terminal success, advance multi-node progress on controller.
        if (missionTerminalCompleted && campaignController
            && isObj(campaignController.frozen_denominator)) {
          const nodeId = (campaignControl.contract.mission_runtime
            && campaignControl.contract.mission_runtime.graph_node_id)
            || campaignControl.contract.ticket
            || null;
          if (isStr(nodeId)) {
            const prior = Array.isArray(campaignController.completed_deliverables)
              ? campaignController.completed_deliverables : [];
            const nextCompleted = [...new Set([...prior, nodeId])].sort();
            const progressed = emptyControllerState({
              ...campaignController,
              completed_deliverables: nextCompleted,
              phase: 'COMPLETED',
              next_action: 'terminal',
              accepted_commit: (composition.controller
                && composition.controller.accepted_commit)
                || compositionImplCommit
                || null,
            });
            const completionProgress = buildProgressReceipt({
              frozenDenominator: progressed.frozen_denominator,
              deliverableId: nodeId,
              completedDeliverables: nextCompleted,
              generation: Number.isSafeInteger(campaignControl.initial_state.generation)
                ? campaignControl.initial_state.generation : 0,
              activeProcess: isObj(progressed.process_parentage)
                ? progressed.process_parentage : { pid: process.pid },
              gateState: progressed.gate_journal || null,
              resourceDebtState: progressed.resource_debt || null,
              phase: 'COMPLETED',
              workOrderId: controllerWorkOrder && controllerWorkOrder.work_order_id,
              rootRunId: controllerRootRunId,
            });
            progressed.progress_receipts = [
              ...(progressed.progress_receipts || []),
              completionProgress,
            ];
            progressed.audit_events = [
              ...(progressed.audit_events || []),
              {
                event: 'progress_receipt_appended',
                root_run_id: controllerRootRunId,
                work_order_id: controllerWorkOrder.work_order_id,
                at: completionProgress.issued_at,
                digest: completionProgress.digest,
                phase: 'COMPLETED',
              },
            ];
            progressed.controller_digest = controllerStateDigest(progressed);
            if (composition.historical_outputs) {
              progressed.historical_outputs = composition.historical_outputs;
              progressed.historical_outputs_digest = composition.historical_outputs_digest
                || null;
            }
            try {
              persistControllerWorkOrder(progressed);
              campaignController = progressed;
            } catch (error) {
              const progressError = new Error(
                `controller completion progress persistence failed: ${
                  error.message || String(error)
                }`,
              );
              progressError.code = 'controller_progress_persist_failed';
              throw progressError;
            }
          }
        }
      } catch (error) {
        return {
          status: 'blocked',
          phase: error.code === 'controller_progress_persist_failed'
            ? 'controller_completion_progress'
            : (String(error.code || '').startsWith('controller_mission_')
              ? 'controller_mission_authority_refresh'
              : 'campaign_terminal_journal'),
          reason: error.message || String(error),
          // BL-4: a journal/persistence block after a real dispatch must surface
          // what actually ran, never a zeroed summary.
          ...observedDispatchTruth(
            ledger,
            campaignController || (campaignControl && campaignControl.controller) || null,
          ),
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

    // Consume the same Work Order only after exact Mission terminal reconciliation.
    if (missionTerminalOutcomeCompleted
        && controllerWorkOrder
        && typeof terminalizeControllerWorkOrder === 'function') {
      try {
        terminalizeControllerWorkOrder({
          terminalStatus: composition.status === 'ready'
            ? 'success' : 'terminal_follow_up',
          phase: composition.status === 'ready'
            ? 'campaign_terminal_ready' : 'campaign_terminal_follow_up',
          reason: composition.status === 'ready'
            ? 'campaign acceptance verified'
            : 'campaign completed with bounded follow-up',
          controller: campaignController || composition.controller,
          acceptedCommit: (composition.controller && composition.controller.accepted_commit)
            || compositionImplCommit
            || null,
          historicalOutputs: composition.historical_outputs || null,
          historicalOutputsDigest: composition.historical_outputs_digest || null,
          requireCompleteTranscript: composition.status === 'ready',
        });
      } catch (_termErr) {
        return {
          status: 'blocked',
          phase: 'controller_work_order_terminalize',
          reason: _termErr.message || String(_termErr),
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
      repair_lineage: repairLineage,
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
    let strictL5ProviderReadiness = null;
    const verifyState = {
      verifyCmdProvided,
      verifyFirstSignalUnused: false,
      convergenceReason: null,
      ratchetRevertedRounds: 0,
      advisoryFindings: [],
      bestCommit: null,
    };
    const finish = (result) => {
      const withStrictReadiness = strictL5ProviderReadiness
        ? { ...result, strict_l5_provider_readiness: strictL5ProviderReadiness }
        : result;
      const controlled = campaignControl
        ? { ...withStrictReadiness, campaign_control: campaignControl }
        : withStrictReadiness;
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
    if (campaignRequested
        && campaignCarriesMissionProjection(input.campaignContract, loopCwd)) {
      const admission = validateManagedDevFlowAdmission({
        repoRoot: loopCwd,
        effectiveLevel: String(process.env.AUTOPILOT_LEVEL || '').toLowerCase(),
        campaignContract: input.campaignContract,
      });
      if (!admission.valid) {
        const startedAt = this.now();
        ledger.push(this.ledgerEntry('dev_flow_admission', 'blocked', startedAt, {
          rejection_code: 'DEV_FLOW_ADMISSION_REQUIRED_OR_STALE',
        }));
        return finish({
          ...devFlowAdmissionRejection(admission.reason),
          rounds: 0,
          verdict: null,
          roster: null,
          resolveResult: null,
          implementation: null,
          review: null,
          implementationChain: [],
          reviewChain: [],
          ledger,
        });
      }
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
      validateReviewRoster(roster, { requireTerminalPanel: campaignRequested });
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

    if (isStrictL5ProviderReadinessAuthority(this.providerReadinessAuthority)) {
      const startedAt = this.now();
      try {
        const bundle = this.providerReadinessAuthority({ roster });
        strictL5ProviderReadiness = consumeStrictL5ProviderReadiness(
          this.providerReadinessAuthority,
          bundle,
          { roster, now: this.now() },
        );
        // A consumed host-owned strict-L5 receipt is the authoritative
        // qualification for this managed invocation. Project it onto the
        // in-memory roster so the later final-review gate does not consult a
        // stale disk-scorecard boolean (non-strict flows keep their old path).
        if (roster.reviewer_qualified !== true) {
          roster = { ...roster, reviewer_qualified: true };
        }
        ledger.push(this.ledgerEntry('strict_l5_provider_readiness', 'ready', startedAt, {
          policy_digest: strictL5ProviderReadiness.policy_digest,
          roster_digest: strictL5ProviderReadiness.roster_digest,
          observation_digest: strictL5ProviderReadiness.observation_digest,
          claim_ids: strictL5ProviderReadiness.claim_ids,
        }));
      } catch (error) {
        ledger.push(this.ledgerEntry('strict_l5_provider_readiness', 'blocked', startedAt, {
          rejection_code: error.code || 'strict_l5_provider_readiness_invalid',
        }));
        return finish({
          status: 'blocked',
          phase: 'provider_readiness',
          reason: error.message || String(error),
          rounds: 0,
          verdict: null,
          roster,
          resolveResult,
          implementation: null,
          review: null,
          implementationChain: [],
          reviewChain: [],
          dispatcher_called: false,
          model_calls: 0,
          ledger,
        });
      }
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

    // A consumed strict-L5 host qualification supersedes the legacy disk
    // scorecard projection. Non-strict flows retain the existing fail-closed
    // reviewer_qualified/fallback-ladder preflight unchanged.
    if (requireQualifiedReviewer
        && !strictL5ProviderReadiness
        && !reviewerQualificationViable(roster)) {
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

    // Constructor-owned Mission adapters: built exactly once for campaign
    // intake from the sealed mission_grant_ref, then threaded unchanged into
    // releaseCampaignAdmission. Never rebuild; never accept runtime adapters.
    let trustedMissionAdapters = null;
    let trustedMissionGrantRef = null;

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
        // Bind grant_ref only from the sealed campaign contract on disk — never
        // from admitted runtime control or caller-supplied adapter payloads.
        const missionGrantRef = this.readCampaignMissionGrantRef(
          input.campaignContract,
          loopCwd,
        );
        if (typeof missionGrantRef === 'string' && /^[0-9a-f]{64}$/.test(missionGrantRef)) {
          trustedMissionGrantRef = missionGrantRef;
        }
        const preliminaryContract = this.readCampaignContract(
          input.campaignContract,
          loopCwd,
        );
        if (!intake && missionMode === 'enforce') {
          const store = this.missionCampaignStore;
          const hasAtomicStore = store !== null
            && typeof store === 'object'
            && typeof store.load === 'function'
            && typeof store.save === 'function';
          const requiresDurableRuntime = Boolean(
            preliminaryContract && preliminaryContract.mission_runtime,
          );
          const hasTerminalJournal = hasAtomicStore
            && typeof store.journalTerminal === 'function'
            && typeof store.markTerminalApplied === 'function';
          if (this.missionPreparedError) {
            intake = {
              status: 'blocked',
              reason: `enforce-mode Mission prepared receipt is invalid: ${
                this.missionPreparedError.message || String(this.missionPreparedError)
              }`,
              rejection: {
                owner: 'mission',
                code: this.missionPreparedError.code || 'mission_prepared_receipt_invalid',
                reason: 'Mission prepared receipt failed canonical registry validation',
              },
              steps: [],
            };
          } else if (this.missionStoreAuthority === 'legacy_state_path') {
            intake = {
              status: 'blocked',
              reason: 'enforce-mode Mission cannot trust an arbitrary state path',
              rejection: {
                owner: 'mission',
                code: 'mission_prepared_receipt_required',
                reason: 'use the canonical Mission prepared receipt and Git common-dir registry',
              },
              steps: [],
            };
          } else if (!hasAtomicStore) {
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
          } else if (requiresDurableRuntime && !hasTerminalJournal) {
            intake = {
              status: 'blocked',
              reason: 'durable Mission v2 campaign requires a terminal journal store',
              rejection: {
                owner: 'mission',
                code: 'mission_terminal_journal_required',
                reason: 'Mission terminal reconciliation requires the canonical Git common-dir journal',
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
          // Build once for this managed loop; release reuses this exact object.
          trustedMissionAdapters = this.buildMissionCampaignAdapters({
            grant_ref: trustedMissionGrantRef,
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
          }, trustedMissionAdapters || undefined);
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
      if (strictL5ProviderReadiness) {
        campaignControl.strict_l5_provider_readiness = strictL5ProviderReadiness;
      }
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
      // Fail closed when the admitted control's grant ref differs from the
      // sealed binding used to construct trusted adapters. Do not release.
      const admittedGrantRef = intake.contract
        && typeof intake.contract.mission_grant_ref === 'string'
        && /^[0-9a-f]{64}$/.test(intake.contract.mission_grant_ref)
        ? intake.contract.mission_grant_ref
        : null;
      if (trustedMissionGrantRef !== null || admittedGrantRef !== null) {
        if (trustedMissionGrantRef === null
            || admittedGrantRef === null
            || admittedGrantRef !== trustedMissionGrantRef) {
          const mismatchReason = 'admitted campaign mission_grant_ref does not match sealed Mission grant binding';
          campaignControl = {
            ...intake,
            status: 'blocked',
            reason: mismatchReason,
            rejection: {
              owner: 'mission',
              code: 'mission_grant_ref_mismatch',
              reason: mismatchReason,
            },
          };
          ledger.push(this.ledgerEntry(
            'campaign_intake',
            'blocked',
            this.now(),
            {
              campaign_id: intake.campaign_id || null,
              rejection_owner: 'mission',
              rejection_code: 'mission_grant_ref_mismatch',
            },
          ));
          return finish({
            status: 'blocked',
            phase: 'campaign_intake',
            reason: mismatchReason,
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
      }
      if (!isObj(intake.contract)
          || !isStr(intake.contract.verify_cmd)) {
        return finish({
          status: 'blocked',
          phase: 'campaign_verification_authority',
          reason: 'admitted campaign is missing its sealed verification command',
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
      if (verifyCmdProvided && verifyCmd !== intake.contract.verify_cmd) {
        ledger.push(this.ledgerEntry(
          'campaign_verification_authority',
          'blocked',
          this.now(),
          { rejection_code: 'campaign_verify_command_mismatch' },
        ));
        return finish({
          status: 'blocked',
          phase: 'campaign_verification_authority',
          reason: 'caller verifyCmd does not exactly match sealed campaign verification authority',
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
      // From this point onward the sole executable verification authority is
      // the exact command projected from the admitted sealed campaign.
      verifyCmd = intake.contract.verify_cmd;
      verifyCmdProvided = true;
      verifyState.verifyCmdProvided = true;
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

    const releaseCampaignNoEffect = (rejection, options = {}) => {
      if (!campaignControl || campaignControl.status !== 'admitted') return null;
      const state = campaignControl.initial_state;
      const claim = campaignControl.generation_claim || null;
      const leafProof = options && options.leafProof ? options.leafProof : null;
      if (!isCampaignAdmissionReleasable(state, claim, leafProof)) {
        return {
          status: 'blocked',
          error: 'campaign_effect_possible',
        };
      }
      const releaseStartedAt = this.now();
      let release;
      try {
        // Thread the exact constructor-owned adapter object from intake.
        // Never rebuild; never fall back to runtime contract/adapters.
        const liveGrantRef = campaignControl.contract
          && typeof campaignControl.contract.mission_grant_ref === 'string'
          && /^[0-9a-f]{64}$/.test(campaignControl.contract.mission_grant_ref)
          ? campaignControl.contract.mission_grant_ref
          : null;
        if (trustedMissionGrantRef !== null || liveGrantRef !== null) {
          if (trustedMissionGrantRef === null
              || liveGrantRef === null
              || liveGrantRef !== trustedMissionGrantRef) {
            release = {
              status: 'blocked',
              error: 'mission_grant_ref_mismatch',
              reason: 'campaign mission_grant_ref does not match sealed Mission grant binding',
            };
          }
        }
        if (!release) {
          release = this.campaignAdmissionReleaser({
            repo: loopCwd,
            campaignControl,
            rejection,
            observedAt: releaseStartedAt,
          }, trustedMissionAdapters || undefined);
        }
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
    // Durable controller wait phases are resumable without re-implementation.
    const durableResumablePhases = new Set([
      CAMPAIGN_STATES.VERTICAL_VERIFICATION,
      CAMPAIGN_STATES.ADJUDICATING,
      CAMPAIGN_STATES.AWAITING_DISPOSITION,
      CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION,
      CAMPAIGN_STATES.BOUNDARY_REJECTED,
      'awaiting_disposition',
      'awaiting_convergence_adjudication',
      'boundary_rejected',
      'DISPOSITION_RESUMED',
    ]);
    if (campaignControl
        && campaignControl.status === 'admitted'
        && campaignControl.initial_state.phase !== CAMPAIGN_STATES.PREPARED
        && (!durableResumablePhases.has(campaignControl.initial_state.phase)
          || !durableResumeCandidate)) {
      const rejection = {
        owner: 'campaign_generation',
        status: 'rejected',
        code: 'campaign_resume_phase_unsupported',
        reason: `campaign resume from ${campaignControl.initial_state.phase} cannot dispatch implementation`,
      };
      const terminalFailure = this.terminalizeManagedCampaignFailure({
        campaignControl,
        reason: rejection.reason,
        phase: 'campaign_resume',
        cwd: loopCwd,
      });
      campaignControl.terminal_failure = terminalFailure;
      if (terminalFailure.status === 'rejected') {
        rejection.code = terminalFailure.code || rejection.code;
        rejection.reason = terminalFailure.reason;
        rejection.remedy = terminalFailure.remedy || null;
      }
      if (new Set(['no_effect', 'not_applicable']).has(terminalFailure.status)) {
        releaseCampaignNoEffect(rejection);
      }
      return finish({
        status: 'blocked',
        phase: terminalFailure.status === 'rejected'
          ? 'campaign_repair_required'
          : (terminalFailure.status === 'blocked'
            ? terminalFailure.phase : 'campaign_resume'),
        reason: terminalFailure.status === 'blocked'
          ? terminalFailure.reason : rejection.reason,
        remedy: rejection.remedy || null,
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
      try {
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
      } catch (error) {
        const failureAt = this.now();
        const code = error && error.code
          ? error.code : 'controller_execution_authority_failed';
        // BL-4: the block is about the CONTROLLER, not about the dispatcher. If a
        // real dispatch already ran, saying dispatcher_called:false / commit:null
        // / model_calls:0 tells a foreman reading only the summary that nothing
        // ran — the exact wrong conclusion. Read the ledger and the controller.
        const observed = observedDispatchTruth(
          ledger,
          (campaignControl && campaignControl.controller) || null,
        );
        ledger.push(this.ledgerEntry(
          'controller_execution_authority',
          'blocked',
          failureAt,
          { rejection_code: code, dispatcher_called: observed.dispatcher_called },
        ));
        return finish({
          status: 'blocked',
          phase: 'controller_execution_authority',
          code,
          reason: error && error.message ? error.message : String(error),
          dispatcher_called: observed.dispatcher_called,
          model_calls: observed.model_calls,
          dispatch_attempts: observed.dispatch_attempts,
          commit: observed.commit,
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
          campaignSealFile: campaignControl && campaignControl.status === 'admitted'
            ? campaignControl.seal_path
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
          const rejection = buildCampaignPreSpendRejection({
            owner: 'implementation_dispatch',
            code: 'campaign_leaf_pre_spend_rejected',
            reason: implementation.reason || `implementation status ${implementation.status}`,
            result: implementation,
          });
          releaseCampaignNoEffect(rejection, { leafProof: implementation });
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

      const previousReviewForRemediation = round > 1 ? review : null;
      review = this.reviewDiff({
        priorStatus: round === 1 ? input.priorStatus : undefined,
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
          blindDiscovery: true,
        },
        requireQualifiedReviewer,
      });
      if (round > 1 && previousReviewForRemediation) {
        const priorFindings = namedReviewFindings(previousReviewForRemediation);
        const currentFindings = namedReviewFindings(review);
        let remediationCheck;
        if (!priorFindings || !currentFindings) {
          remediationCheck = {
            schema_version: 1,
            artifact_type: 'review_remediation_check',
            status: 'needs_full_review',
            authority: 'non_authoritative',
            whole_candidate_pass: false,
            gate_clear: false,
            fallback_to_full_blind_review: true,
            reason: !currentFindings
              ? 'current full-review findings are missing or malformed'
              : 'prior full-review findings are missing or malformed',
          };
        } else try {
          remediationCheck = runRemediationCheckerBoundary(this.remediationChecker, {
            repo: loopCwd,
            previousCommit: nextBase,
            currentCommit: commit,
            previousFindings: priorFindings,
            currentFindings,
            repairGeneration: round - 1,
          });
        } catch (error) {
          remediationCheck = {
            schema_version: 1,
            artifact_type: 'review_remediation_check',
            status: 'needs_full_review',
            authority: 'non_authoritative',
            whole_candidate_pass: false,
            gate_clear: false,
            fallback_to_full_blind_review: true,
            reason: error.message || String(error),
          };
        }
        if (!remediationCheck || typeof remediationCheck !== 'object') {
          remediationCheck = {
            schema_version: 1,
            artifact_type: 'review_remediation_check',
            status: 'needs_full_review',
            authority: 'non_authoritative',
            whole_candidate_pass: false,
            gate_clear: false,
            fallback_to_full_blind_review: true,
            reason: 'remediation checker returned no receipt',
          };
        }
        // Keep this receipt outside the reviewer authority digest. It is a
        // dispatcher-side annotation and can never make a full review pass.
        review = { ...review, remediation_check: remediationCheck };
      }
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
  AutopilotEngine,
  _defaultRemediationChecker: defaultRemediationChecker,
  _runRemediationCheckerBoundary: runRemediationCheckerBoundary,
  bindCampaignScopeReceipt,
  buildImplementationArgs,
  buildReviewArgs,
  implementationResultBlocked,
  reviewLoopResultBlocked,
  reviewResultBlocked,
  finalPanelSeatQualified,
  terminalPanelCrossFamilySatisfied,
  validateExtraReviewArgs,
  validateExtraArgs,
  tempNameSegment,
  validateReviewRoster,
  validateImplementerRoster,
};
