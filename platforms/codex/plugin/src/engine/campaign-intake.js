'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  canonicalRepoIdentity,
  inspectSealedCampaignContract,
  projectMissionMode,
} = require('../../scripts/implementation-campaign-check');
const {
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  NON_SUCCESS_DURABLE_STATES,
  campaignClockElapsedSeconds,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  normalizeCampaignArtifactReference,
  repairLineageCleanupId,
  reduceCampaignState,
} = require('./implementation-campaign');
const {
  missionCampaignIdFor,
  missionSubjectDigest,
} = require('./mission-campaign-identity');
const {
  loadRows,
  processLiveness,
  projectCampaign,
} = require('../campaign/cli');
const {
  consumeProviderReadinessBeforeSpend,
} = require('../readiness/receipt');
const {
  finalPanelSeatQualified,
  reviewSeatTier,
} = require('./final-panel-qualification');
const repoPreconditions = require('./repo-preconditions');


const RUN_LEDGER = path.resolve(__dirname, '..', '..', 'scripts', 'run-ledger.sh');
const CONTEXT_GATE = path.resolve(__dirname, '..', '..', 'scripts', 'check-context-window.js');

class CampaignIntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampaignIntakeError';
    this.code = code;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function repairLineageCleanupState({ repo, reference, repairLineage }) {
  const cleanupId = repairLineageCleanupId({
    lineageId: repairLineage.lineage_id,
    branch: repairLineage.branch,
    worktree: repairLineage.worktree,
    expectedTip: reference.commit,
    cleanupEpoch: repairLineage.cleanup_epoch,
    worktreeInstanceId: repairLineage.worktree_instance_id,
  });
  const common = spawnSync(
    'git',
    ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (common.error || common.signal || common.status !== 0) return null;
  const journalPath = path.join(
    String(common.stdout || '').trim(),
    'autopilot',
    'repair-lineage-cleanup.jsonl',
  );
  if (!fs.existsSync(journalPath)) return null;
  let rows;
  try {
    rows = fs.readFileSync(journalPath, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => row.cleanup_id === cleanupId);
  } catch (_error) {
    return null;
  }
  const valid = rows.every((row) => {
    if (!row || row.schema !== 1
        || !new Set(['intent', 'removed_clean']).has(row.action)
        || row.lineage_id !== repairLineage.lineage_id
        || row.branch !== repairLineage.branch
        || row.worktree !== repairLineage.worktree
        || row.expected_tip !== reference.commit
        || row.cleanup_epoch !== repairLineage.cleanup_epoch
        || row.worktree_instance_id !== repairLineage.worktree_instance_id
        || row.retention_owner !== repairLineage.retention_owner
        || row.retention_reason !== repairLineage.retention_reason
        || row.retention_expires_at !== repairLineage.retention_expires_at
        || !/^[0-9a-f]{64}$/.test(row.record_digest || '')) return false;
    const { record_digest: recordDigest, ...body } = row;
    return canonicalDigest(body) === recordDigest;
  });
  if (!valid || fs.existsSync(repairLineage.worktree)
      || rows.filter((row) => row.action === 'intent').length !== 1) return null;
  const completions = rows.filter((row) => row.action === 'removed_clean').length;
  if (completions === 0) return 'pending_intent';
  return completions === 1 ? 'completed' : null;
}

function defaultCampaignSealPath(contractPath) {
  const absolute = path.resolve(contractPath);
  return absolute.endsWith('.json')
    ? `${absolute.slice(0, -5)}.seal.json`
    : `${absolute}.seal.json`;
}

function campaignLedgerPathFor(repoIdentity) {
  const prefix = 'git-common-dir:';
  if (typeof repoIdentity !== 'string' || !repoIdentity.startsWith(prefix)) {
    throw new CampaignIntakeError(
      'campaign_repo_identity_invalid',
      'campaign repository identity must name the canonical Git common directory',
    );
  }
  return path.join(
    repoIdentity.slice(prefix.length),
    'autopilot',
    'implementation-campaign.jsonl',
  );
}

function campaignRootDigest(state) {
  return canonicalDigest({
    campaign_id: state.campaign_id,
    contract_digest: state.contract_digest,
    repo_identity: state.repo_identity,
    ticket: state.ticket,
    profile: state.profile,
    limits: state.limits,
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch (_error) {
    return null;
  }
}

function modelFamilyOfEngine(engine) {
  const normalized = String(engine || '').toLowerCase();
  if (/(gpt|codex|o1|o3|o4)/.test(normalized)) return 'openai';
  if (/(claude|opus|sonnet|haiku)/.test(normalized)) return 'anthropic';
  if (/(qwen|qwq|qoder)/.test(normalized)) return 'alibaba';
  if (/(gemini|flash|bison)/.test(normalized)) return 'google';
  if (/(grok|composer)/.test(normalized)) return 'xai';
  if (/(minimax|abab)/.test(normalized)) return 'minimax';
  if (/(glm|zhipu)/.test(normalized)) return 'zhipu';
  return 'unknown';
}

function snapshotSeatRecord(seat) {
  return {
    role: seat && seat.role,
    runner: seat && seat.runner,
    model: seat && seat.model,
    effort: seat && seat.effort,
    endpoint: seat && seat.endpoint === undefined ? null : seat.endpoint,
    family: seat && seat.family,
  };
}

function buildQcPanelSnapshot({
  campaignId,
  contractDigest,
  seats,
  minPanelSize,
  requiredReviewFamilies,
  implementerFamily,
}) {
  const body = {
    schema_version: 1,
    campaign_id: campaignId,
    contract_digest: contractDigest,
    seats: Array.isArray(seats) ? seats.map(snapshotSeatRecord) : [],
    seats_complete: true,
    min_panel_size: minPanelSize,
    required_review_families: requiredReviewFamilies,
    implementer_family: implementerFamily,
  };
  return { ...body, digest: canonicalDigest(body) };
}

function step(owner, status, detail = {}) {
  return {
    owner,
    status,
    ...detail,
  };
}

function rejected(owner, code, reason, detail = {}) {
  return step(owner, 'rejected', {
    code,
    reason,
    ...detail,
  });
}

function requireDecision(value, owner, allowedStatuses) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CampaignIntakeError(
      'invalid_owner_decision',
      `${owner} adapter must return a decision object`,
    );
  }
  if (value.owner !== owner || !allowedStatuses.has(value.status)) {
    throw new CampaignIntakeError(
      'invalid_owner_decision',
      `${owner} adapter returned an invalid owner or status`,
    );
  }
  if (value.status === 'rejected'
      && (typeof value.code !== 'string' || typeof value.reason !== 'string')) {
    throw new CampaignIntakeError(
      'invalid_owner_decision',
      `${owner} rejection must include code and reason`,
    );
  }
  return value;
}

function defaultMissionClaim({ missionMode }) {
  if (missionMode === 'enforce') {
    return rejected(
      'mission',
      'mission_grant_unavailable',
      'Mission grant claiming is unavailable until Mission integration',
    );
  }
  return step('mission', 'unknown', {
    enforcement: missionMode,
    reason: 'Mission supervision is not enforced for this campaign',
  });
}

function defaultReadiness() {
  return step('provider_readiness', 'unknown', {
    enforcement: 'shadow',
    reason: 'provider readiness receipt is not shipped yet',
  });
}

function defaultContextGate({ roster, promptFile, contractPath, repo }) {
  const model = roster && roster.implementer_engine;
  if (typeof model !== 'string' || model.length === 0) {
    return rejected(
      'context_window',
      'implementer_identity_missing',
      'context-window gate requires the resolved implementer identity',
    );
  }
  const result = spawnSync(process.execPath, [
    CONTEXT_GATE,
    '--model',
    model,
    '--file',
    promptFile,
    '--file',
    contractPath,
  ], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const payload = parseJson(result.stdout);
  if (result.error || !payload) {
    return rejected(
      'context_window',
      'context_gate_unavailable',
      result.error ? result.error.message : 'context-window gate emitted invalid output',
    );
  }
  if (result.status !== 0 || payload.blocked === true) {
    return rejected(
      'context_window',
      'context_window_rejected',
      payload.reason || 'context-window gate rejected the campaign',
      { receipt: payload },
    );
  }
  return step('context_window', payload.verdict === 'OK' ? 'ready' : 'unknown', {
    enforcement: payload.verdict === 'OK' ? 'enforce' : 'shadow',
    receipt: payload,
  });
}

function defaultOccupancy() {
  return step('worktree_lifecycle', 'unknown', {
    enforcement: 'shadow',
    reason: 'worktree occupancy admission is not shipped yet',
  });
}

function parseLaunchLine(stdout) {
  const text = String(stdout || '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseJson(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

function firstStderrLine(stderr) {
  for (const line of String(stderr || '').split(/\r?\n/)) {
    if (line.length > 0) return line;
  }
  return '';
}

function defaultCleanroomProbe(input = {}, opts = {}) {
  const repo = path.resolve(input.repo || process.cwd());
  const contractPath = input.contractPath ? path.resolve(input.contractPath) : null;
  const launcher = path.resolve(
    opts.launcher
      || process.env.AUTOPILOT_CLEANROOM_LAUNCHER
      || path.join(__dirname, '..', '..', 'scripts', 'lib', 'cleanroom-launch.sh'),
  );
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 60000;
  const bwrap = opts.bwrap
    || process.env.AUTOPILOT_CLEANROOM_BWRAP
    || '';
  const runner = input.runner || 'codex';
  const denyPaths = [];
  const addDeny = (candidate) => {
    if (candidate == null || String(candidate).length === 0) return;
    const resolved = path.resolve(String(candidate));
    if (resolved === '/' || denyPaths.includes(resolved)) return;
    denyPaths.push(resolved);
  };
  addDeny(repo);
  const gitCommon = spawnSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    cwd: repo,
    env: {
      PATH: process.env.PATH || '',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!gitCommon.error && gitCommon.status === 0) {
    const raw = String(gitCommon.stdout || '').trim();
    if (raw) addDeny(path.isAbsolute(raw) ? raw : path.resolve(repo, raw));
  }
  if (process.env.HOME) addDeny(process.env.HOME);
  if (contractPath) addDeny(path.dirname(contractPath));

  const args = ['--preflight'];
  for (const deny of denyPaths) {
    args.push('--deny-path', deny);
  }
  if (bwrap) args.push('--bwrap', bwrap);

  const result = spawnSync(launcher, args, {
    cwd: repo,
    env: {
      PATH: process.env.PATH || '',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    },
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const detail = {
    runner,
    exit_status: result.status,
    launcher,
    deny_paths: denyPaths,
    launcher_json: parseLaunchLine(result.stdout),
  };

  if (result.error) {
    if (result.error.code === 'ENOENT' && result.status == null) {
      return step('cleanroom_probe', 'unknown', {
        enforcement: 'shadow',
        reason: `launcher not present at ${launcher}`,
        runner,
        exit_status: null,
        launcher,
        deny_paths: denyPaths,
        launcher_json: null,
      });
    }
    if (result.error.code === 'ETIMEDOUT') {
      return rejected(
        'cleanroom_probe',
        'final_panel_seat_cleanroom_unavailable',
        `probe timed out after ${timeoutMs / 1000} s, no diagnostic`,
        {
          ...detail,
          exit_status: null,
          launcher_json: null,
        },
      );
    }
    return rejected(
      'cleanroom_probe',
      'final_panel_seat_cleanroom_unavailable',
      `spawn error ${result.error.code}`,
      { ...detail, launcher_json: null },
    );
  }

  if (result.status === 0) {
    if (detail.launcher_json) {
      return step('cleanroom_probe', 'ready', detail);
    }
    return rejected(
      'cleanroom_probe',
      'final_panel_seat_cleanroom_unavailable',
      'launcher emitted no launch line',
      { ...detail, launcher_json: null },
    );
  }

  const errLine = firstStderrLine(result.stderr);
  const reason = errLine
    ? `exit ${result.status}: ${errLine}`
    : `exit ${result.status}: no diagnostic`;
  return rejected(
    'cleanroom_probe',
    'final_panel_seat_cleanroom_unavailable',
    reason,
    detail,
  );
}

function runLedger(args, repo) {
  const result = spawnSync('bash', [RUN_LEDGER, ...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ...result,
    payload: parseJson(result.stdout),
  };
}

function appendCampaignEvent(input = {}) {
  const control = input.campaignControl;
  const repo = path.resolve(input.repo || process.cwd());
  const claim = control && control.generation_claim;
  const state = control && control.initial_state;
  const observedAt = input.observedAt;
  if (!control || control.status !== 'admitted'
      || !claim || claim.durable_journal !== true
      || !state || typeof observedAt !== 'string'
      || !Number.isFinite(Date.parse(observedAt))
      || typeof input.eventType !== 'string'
      || typeof input.stageIdentity !== 'string'
      || input.stageIdentity.length === 0
      || !input.payload
      || typeof input.payload !== 'object'
      || Array.isArray(input.payload)) {
    throw new CampaignIntakeError(
      'campaign_event_invalid',
      'durable campaign event input is incomplete',
    );
  }
  let artifactReference;
  try {
    artifactReference = normalizeCampaignArtifactReference(input.artifactReference);
  } catch (error) {
    throw new CampaignIntakeError(
      error.code || 'campaign_event_artifact_invalid',
      error.message || String(error),
    );
  }
  if (artifactReference
      && artifactReference.kind === 'git_candidate'
      && artifactReference.writer_fence.campaign_id !== control.campaign_id) {
    throw new CampaignIntakeError(
      'campaign_event_artifact_invalid',
      'campaign candidate writer fence belongs to another campaign',
    );
  }
  if (artifactReference
      && artifactReference.repair_lineage
      && (artifactReference.repair_lineage.lineage_id !== control.campaign_id
        || artifactReference.repair_lineage.branch !== control.contract.branch)) {
    throw new CampaignIntakeError(
      'campaign_event_artifact_invalid',
      'campaign repair lineage belongs to another campaign or branch',
    );
  }
  if (artifactReference
      && artifactReference.kind === 'git_candidate'
      && artifactReference.campaign_contract_sha256
      && artifactReference.campaign_contract_sha256 !== control.contract_digest) {
    throw new CampaignIntakeError(
      'campaign_event_artifact_invalid',
      'campaign candidate digest chain belongs to another contract',
    );
  }
  const generation = Number.isSafeInteger(input.generation)
    ? input.generation
    : state.generation;
  const elapsed = campaignClockElapsedSeconds(state, Date.parse(observedAt));
  const usage = {
    repair_generations: generation,
    elapsed_wall_seconds: elapsed,
    changed_files: input.usage && Number.isSafeInteger(input.usage.changed_files)
      ? input.usage.changed_files
      : state.usage.changed_files,
    churn: input.usage && Number.isSafeInteger(input.usage.churn)
      ? input.usage.churn
      : state.usage.churn,
  };
  const outputDigest = artifactReference
    ? canonicalDigest(artifactReference)
    : canonicalDigest({
      event_type: input.eventType,
      stage_identity: input.stageIdentity,
      generation,
      prior_artifact_digest: state.last_output_artifact_digest,
    });
  const event = {
    schema_version: 1,
    event_type: input.eventType,
    campaign_id: control.campaign_id,
    contract_digest: control.contract_digest,
    generation,
    idempotency_key: input.idempotencyKey || `campaign-event:${canonicalDigest({
      event_type: input.eventType,
      stage_identity: input.stageIdentity,
      generation,
      output_digest: outputDigest,
    })}`,
    input_artifact_digest: state.last_output_artifact_digest,
    output_artifact_digest: outputDigest,
    timestamp: observedAt,
    stage_identity: input.stageIdentity,
    usage,
    payload: input.payload,
  };
  let nextState;
  try {
    nextState = reduceCampaignState(state, event);
  } catch (error) {
    throw new CampaignIntakeError(
      error.code || 'campaign_event_rejected',
      error.message || String(error),
    );
  }
  const wrapper = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_event',
    campaign_id: control.campaign_id,
    contract_digest: control.contract_digest,
    event,
    artifact_reference: artifactReference,
  };
  const journal = runLedger([
    'journal-add',
    '--ledger',
    claim.ledger,
    '--run-id',
    control.campaign_id,
    '--stage',
    'campaign',
    '--generation',
    String(claim.generation),
    '--nonce',
    claim.nonce,
    '--idempotency-key',
    event.idempotency_key,
    '--op',
    'campaign_event',
    '--payload',
    JSON.stringify(wrapper),
  ], repo);
  if (journal.error || journal.status !== 0) {
    throw new CampaignIntakeError(
      'campaign_event_journal_failed',
      journal.error ? journal.error.message : String(journal.stderr || '').trim(),
    );
  }
  return {
    status: 'appended',
    event,
    state: nextState,
    artifact_reference: artifactReference,
  };
}

function completeCampaignAdmission(input = {}) {
  const control = input.campaignControl;
  const repo = path.resolve(input.repo || process.cwd());
  const claim = control && control.generation_claim;
  if (!control || control.status !== 'admitted'
      || !claim || claim.durable_journal !== true) {
    throw new CampaignIntakeError(
      'campaign_completion_invalid',
      'campaign completion requires one durable admitted generation',
    );
  }
  const completed = runLedger([
    'stage-transition',
    '--ledger',
    claim.ledger,
    '--run-id',
    control.campaign_id,
    '--stage',
    'campaign',
    '--generation',
    String(claim.generation),
    '--nonce',
    claim.nonce,
    '--to-state',
    'verified',
    '--idempotency-key',
    `campaign-complete:${claim.generation}:${claim.nonce}`,
  ], repo);
  if (completed.error || completed.status !== 0) {
    throw new CampaignIntakeError(
      'campaign_completion_failed',
      completed.error ? completed.error.message : String(completed.stderr || '').trim(),
    );
  }
  return {
    status: 'completed',
    generation: claim.generation,
    nonce: claim.nonce,
  };
}

function buildResumeEvent({
  campaignId,
  contractDigest,
  existingState,
  idempotencyKey,
  observedAt,
  stageIdentity,
}) {
  const observedMs = Date.parse(observedAt);
  return {
    schema_version: 1,
    event_type: CAMPAIGN_EVENTS.RESUMED,
    campaign_id: campaignId,
    contract_digest: contractDigest,
    generation: existingState.generation,
    idempotency_key: idempotencyKey,
    input_artifact_digest: existingState.last_output_artifact_digest,
    output_artifact_digest: existingState.last_output_artifact_digest,
    timestamp: observedAt,
    stage_identity: stageIdentity,
    usage: {
      ...existingState.usage,
      elapsed_wall_seconds: campaignClockElapsedSeconds(existingState, observedMs),
    },
    payload: {},
  };
}

function abandonCampaignLease({
  campaignId,
  lease,
  ledgerPath,
  repo,
  idempotencyKey = null,
}) {
  return runLedger([
    'stage-transition',
    '--ledger',
    ledgerPath,
    '--run-id',
    campaignId,
    '--stage',
    'campaign',
    '--generation',
    String(lease.generation),
    '--nonce',
    lease.nonce,
    '--to-state',
    'dead',
    '--idempotency-key',
    idempotencyKey || `campaign-abandon:${lease.generation}:${lease.nonce}`,
  ], repo);
}

function verifyResumeCandidate({ projection, repo, base }) {
  const reference = projection.candidate_reference;
  const writerFence = reference && reference.writer_fence;
  const repairLineage = reference && reference.repair_lineage;
  const writerFenceBody = writerFence && { ...writerFence };
  if (writerFenceBody) delete writerFenceBody.receipt_digest;
  if (!reference
      || reference.kind !== 'git_candidate'
      || typeof reference.commit !== 'string'
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(reference.commit)
      || typeof reference.tree_sha !== 'string'
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(reference.tree_sha)
      || typeof reference.branch !== 'string'
      || reference.branch.length === 0
      || reference.base !== base
      || !writerFence
      || writerFence.campaign_id !== projection.state.campaign_id
      || writerFence.candidate_commit !== reference.commit
      || writerFence.candidate_tree_sha !== reference.tree_sha
      || !repairLineage
      || repairLineage.lineage_id !== projection.state.campaign_id
      || repairLineage.branch !== reference.branch
      || typeof repairLineage.worktree !== 'string'
      || !path.isAbsolute(repairLineage.worktree)
      || repairLineage.retention_owner !== projection.state.campaign_id
      || repairLineage.retention_reason !== 'implementation-campaign-repair-lineage'
      || !Number.isSafeInteger(repairLineage.retention_expires_at)
      || repairLineage.retention_expires_at <= 0
      || (repairLineage.provider_session_id !== null
        && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          repairLineage.provider_session_id,
        ))
      || (reference.campaign_contract_sha256
        && (reference.campaign_contract_sha256 !== projection.state.contract_digest
          || reference.campaign_contract_sha256
            !== writerFence.campaign_contract_sha256
          || reference.unit_contract_sha256 !== writerFence.unit_contract_sha256))
      || !/^[0-9a-f]{64}$/.test(writerFence.receipt_digest || '')
      || canonicalDigest(writerFenceBody) !== writerFence.receipt_digest) {
    throw new CampaignIntakeError(
      'campaign_resume_candidate_invalid',
      'durable campaign candidate reference is incomplete or stale',
    );
  }
  const tip = spawnSync(
    'git',
    ['-C', repo, 'rev-parse', '--verify', `${reference.branch}^{commit}`],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const tree = spawnSync(
    'git',
    ['-C', repo, 'rev-parse', '--verify', `${reference.commit}^{tree}`],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const ancestry = spawnSync(
    'git',
    ['-C', repo, 'merge-base', '--is-ancestor', base, reference.commit],
    { stdio: 'ignore' },
  );
  const retainedTip = spawnSync(
    'git',
    ['-C', repairLineage.worktree, 'rev-parse', '--verify', 'HEAD'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const retainedBranch = spawnSync(
    'git',
    ['-C', repairLineage.worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD'],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const retainedWorktreeMatches = !retainedTip.error
    && retainedTip.status === 0
    && String(retainedTip.stdout || '').trim() === reference.commit
    && !retainedBranch.error
    && retainedBranch.status === 0
    && String(retainedBranch.stdout || '').trim() === reference.branch;
  const cleanupState = retainedWorktreeMatches
    ? null
    : !fs.existsSync(repairLineage.worktree)
      ? repairLineageCleanupState({ repo, reference, repairLineage })
      : null;
  if (tip.error || tip.status !== 0 || String(tip.stdout || '').trim() !== reference.commit
      || tree.error || tree.status !== 0
      || String(tree.stdout || '').trim() !== reference.tree_sha
      || ancestry.error || ancestry.status !== 0
      || (!retainedWorktreeMatches
        && !new Set(['pending_intent', 'completed']).has(cleanupState))) {
    throw new CampaignIntakeError(
      'campaign_resume_git_drift',
      'durable campaign candidate does not match current immutable Git truth',
    );
  }
  const initial = projection.initial_candidate_reference || reference;
  return {
    committed: true,
    commit: reference.commit,
    tree_sha: reference.tree_sha,
    branch: reference.branch,
    writer_fence: writerFence,
    ...(reference.campaign_contract_sha256 ? {
      campaign_contract_sha256: reference.campaign_contract_sha256,
      unit_contract_sha256: reference.unit_contract_sha256,
    } : {}),
    scope_implementation_sha: initial.commit,
    repair_lineage: repairLineage,
  };
}

function defaultGenerationClaim({
  campaignId,
  contractDigest,
  initialState,
  ledgerPath,
  repo,
  resume,
  observedAt,
  base,
}) {
  let existing = null;
  let ledgerRows = [];
  let reopenAbandonedClaim = false;
  let resumePreflight = null;
  if (fs.existsSync(ledgerPath)) {
    try {
      ledgerRows = loadRows(ledgerPath);
      existing = projectCampaign(ledgerRows, campaignId);
    } catch (error) {
      return rejected(
        'campaign_generation',
        'campaign_ledger_invalid',
        error.message || String(error),
      );
    }
  }
  if (!existing) {
    const owned = ledgerRows.filter((row) => row && row.run_id === campaignId);
    const orphanedJournals = owned.filter((row) => row.kind === 'journal');
    const stageRows = owned.filter(
      (row) => row.kind === 'stage' && row.stage === 'campaign',
    );
    if (orphanedJournals.length > 0) {
      return rejected(
        'campaign_generation',
        'campaign_orphaned_journal',
        'campaign ledger contains journal evidence without an intake root',
      );
    }
    if (stageRows.length > 0) {
      const latest = stageRows[stageRows.length - 1];
      if (latest.resources !== `campaign:${campaignId}`) {
        return rejected(
          'campaign_generation',
          'campaign_orphaned_claim_invalid',
          'campaign intake claim does not own the canonical campaign resource',
        );
      }
      const liveness = processLiveness(latest);
      if (latest.state === 'leased' && liveness === 'alive') {
        return rejected(
          'campaign_generation',
          'campaign_lease_live',
          'campaign intake claim is still owned by a live process',
        );
      }
      if (latest.state === 'leased' && liveness === 'unknown') {
        return rejected(
          'campaign_generation',
          'campaign_lease_unknown',
          'campaign intake claim liveness cannot be verified',
        );
      }
      if (latest.state === 'dead'
          && latest.transition_from === 'leased'
          && latest.resources === `campaign:${campaignId}`) {
        reopenAbandonedClaim = true;
      } else if (latest.state !== 'leased' || liveness !== 'dead') {
        return rejected(
          'campaign_generation',
          'campaign_orphaned_claim_invalid',
          'campaign ledger contains a non-recoverable claim without an intake root',
        );
      }
    }
  }
  if (existing && resume !== true) {
    return rejected(
      'campaign_generation',
      'campaign_resume_required',
      'durable campaign already exists; explicit resume is required',
    );
  }
  if (!existing && resume === true) {
    return rejected(
      'campaign_generation',
      'campaign_resume_not_found',
      'no durable campaign exists for the sealed contract',
    );
  }
  if (existing) {
    if (existing.state.contract_digest !== contractDigest) {
      return rejected(
        'campaign_generation',
        'campaign_contract_mismatch',
        'durable campaign does not match the sealed contract digest',
      );
    }
    if (campaignRootDigest(existing.initial_state) !== campaignRootDigest(initialState)) {
      return rejected(
        'campaign_generation',
        'campaign_state_contract_mismatch',
        'durable campaign root does not match the sealed contract limits and identity',
      );
    }
    if (new Set([
      CAMPAIGN_STATES.TERMINAL_READY,
      CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
      CAMPAIGN_STATES.TERMINAL_STOP,
    ]).has(existing.state.phase)) {
      return rejected(
        'campaign_generation',
        'campaign_already_terminal',
        'terminal campaign cannot be resumed',
      );
    }
    const liveness = processLiveness(existing.latest_lease);
    if (liveness !== 'dead') {
      return rejected(
        'campaign_generation',
        liveness === 'alive' ? 'campaign_lease_live' : 'campaign_lease_unknown',
        liveness === 'alive'
          ? 'campaign already has a live lease'
          : 'campaign lease liveness cannot be verified',
      );
    }
    if (existing.state.live_lease !== null) {
      return rejected(
        'campaign_generation',
        'campaign_state_lease_open',
        'durable campaign state still owns a mutation lease',
      );
    }
    const resumableCandidatePhase = new Set([
      CAMPAIGN_STATES.VERTICAL_VERIFICATION,
      CAMPAIGN_STATES.ADJUDICATING,
      CAMPAIGN_STATES.BOUNDARY_REJECTED,
      CAMPAIGN_STATES.AWAITING_DISPOSITION,
    ]).has(existing.state.phase);
    const durableWaitPhase = NON_SUCCESS_DURABLE_STATES.has(existing.state.phase);
    const resumePhaseSupported = existing.state.phase === CAMPAIGN_STATES.PREPARED
      || resumableCandidatePhase
      || durableWaitPhase;
    if (!resumePhaseSupported) {
      return rejected(
        'campaign_generation',
        'campaign_resume_phase_unsupported',
        `campaign resume from ${existing.state.phase} is unavailable until phase-aware dispatch ships`,
      );
    }
    // Exact replay / durable-wait no-op adoption: no new model or gate attempt.
    // Possibly-effectful boundary_rejected preserves candidate without fabricating
    // mutation-failure evidence.
    if (durableWaitPhase) {
      const boundary = existing.state.boundary_rejected || null;
      const awaiting = existing.state.awaiting_disposition || null;
      const candidateRef = (boundary && boundary.candidate_ref)
        || (awaiting && awaiting.candidate_ref)
        || (existing.candidate_reference && existing.candidate_reference.commit)
        || null;
      existing.resume_durable_wait = {
        phase: existing.state.phase,
        boundary_rejected: boundary,
        awaiting_disposition: awaiting,
        candidate_ref: candidateRef,
        exact_replay: true,
        dispatcher_called: false,
        mutation_attempts: 0,
        gate_attempts: 0,
        no_op: true,
      };
      // Prefer a bound git candidate when present so later stages can re-attach.
      if (existing.candidate_reference
          && existing.candidate_reference.kind === 'git_candidate') {
        try {
          existing.resume_candidate = verifyResumeCandidate({
            projection: existing,
            repo,
            base,
          });
        } catch (error) {
          return rejected(
            'campaign_generation',
            error.code || 'campaign_resume_candidate_invalid',
            error.message || String(error),
          );
        }
      }
    }
    if (resumableCandidatePhase
        && existing.state.phase !== CAMPAIGN_STATES.BOUNDARY_REJECTED
        && existing.state.phase !== CAMPAIGN_STATES.AWAITING_DISPOSITION
        && existing.state.phase !== CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION) {
      try {
        existing.resume_candidate = verifyResumeCandidate({
          projection: existing,
          repo,
          base,
        });
      } catch (error) {
        return rejected(
          'campaign_generation',
          error.code || 'campaign_resume_candidate_invalid',
          error.message || String(error),
        );
      }
    }
    if (existing.state.phase === CAMPAIGN_STATES.ADJUDICATING) {
      const reviewReference = existing.last_artifact_reference;
      if (!reviewReference
          || reviewReference.kind !== 'product_review'
          || !reviewReference.repair_lineage
          || reviewReference.repair_lineage.lineage_id !== existing.state.campaign_id
          || reviewReference.repair_lineage.branch
            !== existing.resume_candidate.branch
          || reviewReference.repair_lineage.worktree
            !== existing.resume_candidate.repair_lineage.worktree
          || canonicalDigest(reviewReference) !== existing.state.last_output_artifact_digest) {
        return rejected(
          'campaign_generation',
          'campaign_resume_review_invalid',
          'adjudication resume requires the exact durable focused-review digest',
        );
      }
      existing.resume_candidate.repair_lineage = reviewReference.repair_lineage;
      existing.resume_review_digest = reviewReference.digest;
    }
    if (existing.state.usage.changed_files >= existing.state.limits.max_changed_files) {
      return rejected(
        'campaign_generation',
        'campaign_file_budget_exhausted',
        'durable campaign has no changed-file budget remaining',
      );
    }
    if (existing.state.usage.churn >= existing.state.limits.max_churn) {
      return rejected(
        'campaign_generation',
        'campaign_churn_budget_exhausted',
        'durable campaign has no churn budget remaining',
      );
    }
    const preflightEvent = buildResumeEvent({
      campaignId,
      contractDigest,
      existingState: existing.state,
      idempotencyKey: `campaign-resume-preflight:${canonicalDigest({
        campaignId,
        eventCount: existing.state.event_count,
        observedAt,
      })}`,
      observedAt,
      stageIdentity: 'campaign-resume-preflight',
    });
    try {
      resumePreflight = reduceCampaignState(existing.state, preflightEvent);
    } catch (error) {
      return rejected(
        'campaign_generation',
        error.code || 'campaign_resume_invalid',
        error.message || String(error),
      );
    }
    if (resumePreflight.usage.elapsed_wall_seconds
        >= resumePreflight.limits.max_wall_seconds) {
      return rejected(
        'campaign_generation',
        'campaign_wall_budget_exhausted',
        'durable campaign has no wall-clock budget remaining',
      );
    }
  }

  const init = runLedger(['init', '--ledger', ledgerPath], repo);
  if (init.error || init.status !== 0) {
    return rejected(
      'campaign_generation',
      'campaign_ledger_unavailable',
      init.error ? init.error.message : String(init.stderr || '').trim(),
    );
  }
  const acquireArgs = [
    'stage-acquire',
    '--ledger',
    ledgerPath,
    '--run-id',
    campaignId,
    '--stage',
    'campaign',
    '--pid',
    String(process.pid),
    '--resources',
    `campaign:${campaignId}`,
    '--exclusive-live',
  ];
  if (resume === true || reopenAbandonedClaim) acquireArgs.push('--allow-reopen');
  const acquired = runLedger(acquireArgs, repo);
  if (acquired.error || acquired.status !== 0 || !acquired.payload) {
    return rejected(
      'campaign_generation',
      'campaign_lease_rejected',
      acquired.error
        ? acquired.error.message
        : String(acquired.stderr || 'campaign generation lease rejected').trim(),
    );
  }
  const lease = acquired.payload;
  let journalOp = 'campaign_intake';
  let journalIdempotencyKey = `campaign-intake:${contractDigest}`;
  let journalArtifact = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_intake',
    campaign_id: campaignId,
    contract_digest: contractDigest,
    initial_state: initialState,
    initial_state_digest: canonicalDigest(initialState),
  };
  let resumedState = null;
  if (existing) {
    const resumeEvent = buildResumeEvent({
      campaignId,
      contractDigest,
      existingState: existing.state,
      idempotencyKey: `campaign-resume:${lease.generation}:${lease.nonce}`,
      observedAt,
      stageIdentity: `run-ledger:${lease.generation}:${lease.nonce}`,
    });
    try {
      resumedState = reduceCampaignState(existing.state, resumeEvent);
    } catch (error) {
      abandonCampaignLease({
        campaignId,
        lease,
        ledgerPath,
        repo,
      });
      return rejected(
        'campaign_generation',
        error.code || 'campaign_resume_invalid',
        error.message || String(error),
      );
    }
    journalOp = 'campaign_event';
    journalIdempotencyKey = resumeEvent.idempotency_key;
    journalArtifact = {
      schema_version: 1,
      artifact_type: 'implementation_campaign_event',
      campaign_id: campaignId,
      contract_digest: contractDigest,
      event: resumeEvent,
    };
  }
  if (existing && resumePreflight === null) {
    abandonCampaignLease({
      campaignId,
      lease,
      ledgerPath,
      repo,
    });
    return rejected(
      'campaign_generation',
      'campaign_resume_invalid',
      'campaign resume preflight did not produce a durable state',
    );
  }
  const journalPayload = JSON.stringify(journalArtifact);
  const journal = runLedger([
    'journal-add',
    '--ledger',
    ledgerPath,
    '--run-id',
    campaignId,
    '--stage',
    'campaign',
    '--generation',
    String(lease.generation),
    '--nonce',
    lease.nonce,
    '--idempotency-key',
    journalIdempotencyKey,
    '--op',
    journalOp,
    '--payload',
    journalPayload,
  ], repo);
  if (journal.error || journal.status !== 0) {
    abandonCampaignLease({
      campaignId,
      lease,
      ledgerPath,
      repo,
    });
    return rejected(
      'campaign_generation',
      'campaign_journal_rejected',
      journal.error ? journal.error.message : String(journal.stderr || '').trim(),
    );
  }
  return step('campaign_generation', 'claimed', {
    campaign_id: campaignId,
    generation: lease.generation,
    nonce: lease.nonce,
    ledger: ledgerPath,
    stage_identity: `run-ledger:${lease.generation}:${lease.nonce}`,
    resumed_state: resumedState,
    durable_journal: true,
    resume_candidate: existing ? existing.resume_candidate || null : null,
    resume_review_digest: existing ? existing.resume_review_digest || null : null,
    resume_durable_wait: existing ? existing.resume_durable_wait || null : null,
    // Exact durable-wait replay never spends a new model/gate attempt.
    dispatcher_called: existing && existing.resume_durable_wait
      ? false
      : undefined,
    mutation_attempts: existing && existing.resume_durable_wait
      ? 0
      : undefined,
    gate_attempts: existing && existing.resume_durable_wait
      ? 0
      : undefined,
  });
}

function buildNoEffectReceipt({ missionClaim, rejection, campaignDigest, now }) {
  const receipt = {
    schema_version: 1,
    artifact_type: 'pre_spend_no_effect',
    claim_id: missionClaim.claim_id,
    campaign_contract_digest: campaignDigest,
    owning_rejection: {
      owner: rejection.owner,
      code: rejection.code,
      digest: canonicalDigest(rejection),
    },
    actual_usage: {
      model_attempts: 0,
      worktrees_created: 0,
    },
    released_at: now,
  };
  return {
    ...receipt,
    receipt_digest: canonicalDigest(receipt),
  };
}

function releaseCampaignAdmission(input = {}, adapters = {}) {
  const control = input.campaignControl;
  const repo = path.resolve(input.repo || process.cwd());
  const rejection = input.rejection;
  const now = typeof input.observedAt === 'string'
    ? input.observedAt
    : (typeof adapters.now === 'function' ? adapters.now() : new Date().toISOString());
  if (!control || control.status !== 'admitted'
      || !control.generation_claim
      || typeof control.campaign_id !== 'string'
      || typeof control.contract_digest !== 'string') {
    throw new CampaignIntakeError(
      'campaign_release_invalid',
      'campaign admission release requires one admitted campaign control',
    );
  }
  if (!rejection || rejection.status !== 'rejected'
      || typeof rejection.owner !== 'string'
      || typeof rejection.code !== 'string'
      || typeof rejection.reason !== 'string') {
    throw new CampaignIntakeError(
      'campaign_release_invalid',
      'campaign admission release requires one named rejection',
    );
  }
  const claim = control.generation_claim;
  const missionClaim = Array.isArray(control.steps)
    ? control.steps.find((entry) => entry.owner === 'mission')
    : null;
  let missionRelease = null;
  let receipt = missionClaim && missionClaim.status === 'claimed'
    ? buildNoEffectReceipt({
      missionClaim,
      rejection,
      campaignDigest: control.contract_digest,
      now,
    })
    : null;
  const releaseKey = `campaign-admission-release:${claim.generation}:${claim.nonce}`;
  const transitionKey = `campaign-abandon:${claim.generation}:${claim.nonce}`;
  const rejectionDigest = canonicalDigest(rejection);
  let releaseRecorded = false;
  let leaseAlreadyDead = false;
  try {
    const rows = fs.existsSync(claim.ledger) ? loadRows(claim.ledger) : [];
    const releaseRow = rows.find((row) => row
      && row.run_id === control.campaign_id
      && row.kind === 'journal'
      && row.stage === 'campaign'
      && row.generation === claim.generation
      && row.nonce === claim.nonce
      && row.op === 'campaign_admission_release'
      && row.idempotency_key === releaseKey
      && row.status === 'applied');
    if (releaseRow) {
      const artifact = parseJson(releaseRow.payload);
      if (!artifact
          || artifact.schema_version !== 1
          || artifact.artifact_type !== 'campaign_admission_release'
          || artifact.campaign_id !== control.campaign_id
          || artifact.contract_digest !== control.contract_digest
          || artifact.rejection_digest !== rejectionDigest
          || (missionClaim && missionClaim.status === 'claimed'
            && (!artifact.pre_spend_no_effect_receipt
              || artifact.pre_spend_no_effect_receipt.claim_id !== missionClaim.claim_id))) {
        throw new CampaignIntakeError(
          'campaign_release_journal_invalid',
          'durable campaign admission release does not match this rejection',
        );
      }
      releaseRecorded = true;
      receipt = artifact.pre_spend_no_effect_receipt;
    }
    const latestStage = rows
      .filter((row) => row
        && row.run_id === control.campaign_id
        && row.kind === 'stage'
        && row.stage === 'campaign')
      .at(-1);
    leaseAlreadyDead = Boolean(latestStage
      && latestStage.generation === claim.generation
      && latestStage.nonce === claim.nonce
      && latestStage.state === 'dead');
  } catch (error) {
    return {
      status: 'blocked',
      rejection,
      campaign_generation_release: rejected(
        'campaign_generation_release',
        'campaign_release_ledger_invalid',
        error.message || String(error),
      ),
      mission_release: null,
      pre_spend_no_effect_receipt: receipt,
    };
  }
  if (missionClaim && missionClaim.status === 'claimed') {
    if (releaseRecorded) {
      missionRelease = step('mission_release', 'released', { replayed: true });
    } else {
      try {
        if (typeof adapters.releaseMission !== 'function') {
          throw new CampaignIntakeError(
            'mission_release_adapter_missing',
            'claimed Mission admission requires a release adapter',
          );
        }
        missionRelease = requireDecision(
          adapters.releaseMission({
            missionClaim,
            receipt,
            idempotency_key: releaseKey,
          }),
          'mission_release',
          new Set(['released', 'rejected']),
        );
      } catch (error) {
        missionRelease = rejected(
          'mission_release',
          error.code || 'mission_release_failed',
          error.message || String(error),
        );
      }
    }
  }
  if (missionRelease && missionRelease.status !== 'released') {
    return {
      status: 'blocked',
      rejection,
      campaign_generation_release: rejected(
        'campaign_generation_release',
        'mission_release_incomplete',
        'campaign lease remains live until Mission release succeeds',
      ),
      mission_release: missionRelease,
      pre_spend_no_effect_receipt: receipt,
    };
  }
  if (!releaseRecorded) {
    const journalArtifact = {
      schema_version: 1,
      artifact_type: 'campaign_admission_release',
      campaign_id: control.campaign_id,
      contract_digest: control.contract_digest,
      rejection_digest: rejectionDigest,
      pre_spend_no_effect_receipt: receipt,
    };
    const journal = runLedger([
      'journal-add',
      '--ledger',
      claim.ledger,
      '--run-id',
      control.campaign_id,
      '--stage',
      'campaign',
      '--generation',
      String(claim.generation),
      '--nonce',
      claim.nonce,
      '--idempotency-key',
      releaseKey,
      '--op',
      'campaign_admission_release',
      '--payload',
      JSON.stringify(journalArtifact),
    ], repo);
    if (journal.error || journal.status !== 0) {
      return {
        status: 'blocked',
        rejection,
        campaign_generation_release: rejected(
          'campaign_generation_release',
          'campaign_release_journal_failed',
          journal.error ? journal.error.message : String(journal.stderr || '').trim(),
        ),
        mission_release: missionRelease,
        pre_spend_no_effect_receipt: receipt,
      };
    }
  }
  const abandoned = leaseAlreadyDead
    ? { error: null, status: 0, replayed: true }
    : abandonCampaignLease({
      campaignId: control.campaign_id,
      lease: claim,
      ledgerPath: claim.ledger,
      repo,
      idempotencyKey: transitionKey,
    });
  const leaseRelease = abandoned.error || abandoned.status !== 0
    ? rejected(
      'campaign_generation_release',
      'campaign_lease_release_failed',
      abandoned.error
        ? abandoned.error.message
        : String(abandoned.stderr || 'campaign lease release failed').trim(),
    )
    : step('campaign_generation_release', 'released', {
      generation: claim.generation,
      nonce: claim.nonce,
      replayed: releaseRecorded,
    });
  const released = leaseRelease.status === 'released';
  return {
    status: released ? 'released' : 'blocked',
    rejection,
    campaign_generation_release: leaseRelease,
    mission_release: missionRelease,
    pre_spend_no_effect_receipt: receipt,
  };
}

function consumeEnforcedProviderReadiness({ adapters, contract, inspection, roster, now, level }) {
  const bundle = typeof adapters.providerReadiness === 'function'
    ? adapters.providerReadiness({ contract, inspection, roster, now }) : null;
  if (!bundle || !bundle.receipt || !bundle.roster || !bundle.policy) {
    // v2.36.7 (owner ruling 2026-09-06): name the cause and the two legal remedies. The
    // authority is compiled only by the l4/l5/l6 strict host bootstrap (bin/autopilot.js); an l3
    // (or unset) level has none, so an enforce-mode intake under it can only be refused — this
    // is ADR-0001's verification boundary, never an identity check to be waived, and never
    // something a consuming repo should construct by hand.
    // `level` is threaded by the caller (engine input), never read from the environment here —
    // this module is input-determined (review 🟡).
    const levelLabel = typeof level === 'string' && level.length > 0 ? level : '(unset)';
    const cause = typeof adapters.providerReadiness !== 'function'
      ? `no provider-readiness authority was compiled for this run (AUTOPILOT_LEVEL=${levelLabel}; only l4/l5/l6 build the strict host bootstrap)`
      : 'the host readiness authority returned an incomplete bundle';
    throw new CampaignIntakeError(
      'provider_readiness_authority_missing',
      `enforced campaign intake requires host-owned readiness evidence — ${cause}. Remedies: set this rail's mission enforcement_mode to shadow, or run it under /l4, /l5 or /l6 so the host bootstrap compiles. Do not construct a readiness authority by hand.`,
    );
  }
  const result = consumeProviderReadinessBeforeSpend(bundle.receipt, {
    roster: bundle.roster,
    policy: bundle.policy,
    now,
    qualificationProvider: adapters.qualificationProvider,
  });
  if (result.status !== 'ready') {
    throw new CampaignIntakeError(
      'provider_readiness_not_ready',
      'enforced campaign exact-role readiness is not ready',
    );
  }
  return result;
}

function runCampaignIntake(input = {}, adapters = {}) {
  const repo = path.resolve(input.repo || process.cwd());
  const contractPath = input.contractPath && path.resolve(repo, input.contractPath);
  const sealPath = input.sealPath
    ? path.resolve(repo, input.sealPath)
    : (contractPath ? defaultCampaignSealPath(contractPath) : null);
  const requestedLedgerPath = input.ledgerPath
    ? path.resolve(repo, input.ledgerPath)
    : null;
  const now = typeof input.observedAt === 'string'
    ? input.observedAt
    : (typeof adapters.now === 'function' ? adapters.now() : new Date().toISOString());
  const steps = [];
  let qcPanelSnapshot = null;
  // `--campaign-ledger` accepts exactly one value: the canonical Git common-dir
  // ledger. That is pure argv validation and needs no contract, seal, or Mission
  // claim — reject it here, BEFORE the claim adapter runs, so a mistyped flag
  // does not consume a grant attempt (2026-09-14 dogfood: the post-claim check
  // below released with a no-effect receipt, and `mission grant` minted attempt 2).
  // The post-claim check stays as the sealed-identity cross-check.
  if (requestedLedgerPath !== null) {
    let canonicalLedgerPath = null;
    try {
      canonicalLedgerPath = campaignLedgerPathFor(canonicalRepoIdentity(repo));
    } catch (_error) {
      canonicalLedgerPath = null;
    }
    if (canonicalLedgerPath !== null && requestedLedgerPath !== canonicalLedgerPath) {
      const rejection = rejected(
        'campaign_generation',
        'campaign_ledger_path_mismatch',
        'campaign ledger path must be the repository-wide canonical Git common-dir ledger',
      );
      return {
        status: 'blocked',
        reason: rejection.reason,
        rejection,
        steps: [rejection],
        pre_spend_no_effect_receipt: null,
      };
    }
  }
  // Repository facts the contract checker will demand at dispatch (HEAD, work
  // tree, clean tree, pinned base resolves, required paths present at base) are
  // re-derived HERE, before the Mission claim, from the sealed campaign bytes.
  // The checker runs inside dispatch-hetero AFTER the claim, so each of these
  // used to consume an attempt with nothing spent (2026-09-15: a dirty tree,
  // then a NEW file listed in required_paths). Same statement of the rule:
  // src/engine/repo-preconditions.js is what checkPolicy calls too.
  if (contractPath) {
    let sealedContract = null;
    try {
      sealedContract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    } catch (_error) {
      sealedContract = null;
    }
    if (sealedContract && typeof sealedContract === 'object'
        && typeof sealedContract.base_sha === 'string') {
      const strict = sealedContract.strict_dispatch && typeof sealedContract.strict_dispatch === 'object'
        ? sealedContract.strict_dispatch
        : null;
      let reasons = [];
      try {
        reasons = repoPreconditions.repoBaseReasons(repo, sealedContract.base_sha);
        if (reasons.length === 0 && strict && Array.isArray(strict.required_paths)) {
          reasons = repoPreconditions.requiredPathReasons(repo, sealedContract.base_sha, strict.required_paths);
        }
      } catch (error) {
        reasons = [`base: ${error.message || String(error)}`];
      }
      if (reasons.length > 0) {
        const rejection = rejected(
          'campaign_generation',
          'campaign_repo_precondition_failed',
          `repository does not satisfy the sealed contract before the claim: ${reasons.join('; ')}`,
        );
        return {
          status: 'blocked',
          reason: rejection.reason,
          rejection,
          steps: [rejection],
          pre_spend_no_effect_receipt: null,
        };
      }
    }
  }
  const qcSeats = input.roster && Array.isArray(input.roster.qc_panel_seats)
    ? input.roster.qc_panel_seats
    : null;
  const cleanroomProbeSteps = [];
  if (qcSeats && qcSeats.length > 0) {
    const blindFailures = [];
    const cleanroomUnavailable = [];
    const probedRunners = new Map();
    for (let i = 0; i < qcSeats.length; i += 1) {
      const seat = qcSeats[i];
      const endpoint = seat && seat.endpoint != null && String(seat.endpoint).length > 0
        ? seat.endpoint
        : '@none';
      const model = seat && seat.model ? seat.model : '<unspecified>';
      const runner = seat && seat.runner ? seat.runner : '<unspecified>';
      const tier = reviewSeatTier(seat && seat.runner);
      if (tier === 'none') {
        blindFailures.push(
          `qc_panel[${i}] ${model}/${runner}@${endpoint} cannot execute a managed blind-discovery review (runner is not in the enforceable no-tools set anthropic-compatible, cc-shim, claude-native, qoderclicn); replace it with a blind-capable seat or use a cleanroom-tier runner — pins and overrides do not bypass containment`,
        );
        continue;
      }
      if (tier === 'cleanroom') {
        if (!probedRunners.has(runner)) {
          const injected = typeof adapters.cleanroomProbe === 'function';
          const probeFn = injected ? adapters.cleanroomProbe : defaultCleanroomProbe;
          const allowed = injected
            ? new Set(['ready', 'rejected'])
            : new Set(['ready', 'rejected', 'unknown']);
          let decision;
          try {
            decision = requireDecision(
              probeFn({
                runner,
                repo,
                contractPath,
                roster: input.roster,
              }),
              'cleanroom_probe',
              allowed,
            );
          } catch (error) {
            const rejection = rejected(
              'campaign_generation',
              'cleanroom_probe_adapter_invalid',
              error.message || String(error),
            );
            return {
              status: 'blocked',
              reason: rejection.reason,
              rejection,
              steps: [rejection],
              pre_spend_no_effect_receipt: null,
            };
          }
          probedRunners.set(runner, decision);
          // Every probe decision is a receipt step — a rejected probe must still show which
          // launcher answered and what was denied (plan §1.2; second review 🟡).
          cleanroomProbeSteps.push(decision);
        }
        const decision = probedRunners.get(runner);
        if (decision.status === 'rejected') {
          cleanroomUnavailable.push(decision.reason);
        }
      }
    }
    if (blindFailures.length > 0) {
      const rejection = rejected(
        'campaign_generation',
        'final_panel_seat_blind_incompatible',
        blindFailures.join('\n'),
      );
      return {
        status: 'blocked',
        reason: rejection.reason,
        rejection,
        steps: [rejection],
        pre_spend_no_effect_receipt: null,
      };
    }
    if (cleanroomUnavailable.length > 0) {
      const rejection = rejected(
        'campaign_generation',
        'final_panel_seat_cleanroom_unavailable',
        cleanroomUnavailable.join('\n'),
      );
      return {
        status: 'blocked',
        reason: rejection.reason,
        rejection,
        steps: [...cleanroomProbeSteps, rejection],
        pre_spend_no_effect_receipt: null,
      };
    }
    const failures = [];
    for (let i = 0; i < qcSeats.length; i += 1) {
      const seat = qcSeats[i];
      if (!finalPanelSeatQualified(input.roster, seat, i)) {
        const endpoint = seat && seat.endpoint != null && String(seat.endpoint).length > 0
          ? seat.endpoint
          : '@none';
        const model = seat && seat.model ? seat.model : '<unspecified>';
        const runner = seat && seat.runner ? seat.runner : '<unspecified>';
        failures.push(`qc_panel[${i}] ${model}/${runner}@${endpoint}`);
      }
    }
    if (failures.length > 0) {
      const msg = `${failures.join('; ')}; record a standing pin: node scripts/engine-capability-state.js pin-seat --role qc_panel --engine <model> --runner <runner> --effort <effort> --endpoint <endpoint|@none> --reason <text> --operator <who>; or replace the seat with one carrying reviewer evidence`;
      const rejection = rejected('campaign_generation', 'final_panel_seat_unqualified', msg);
      return {
        status: 'blocked',
        reason: rejection.reason,
        rejection,
        steps: [...cleanroomProbeSteps, rejection],
        pre_spend_no_effect_receipt: null,
      };
    }
  }
  let rawContractDigest = null;
  if (contractPath) {
    try {
      rawContractDigest = sha256(fs.readFileSync(contractPath));
    } catch (_error) {
      rawContractDigest = null;
    }
  }

  let missionMode;
  try {
    missionMode = projectMissionMode(repo);
  } catch (error) {
    const rejection = rejected('mission', error.code || 'project_governance_invalid', error.message);
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps: [rejection],
      pre_spend_no_effect_receipt: null,
    };
  }

  const unknownCleanroom = cleanroomProbeSteps.find((s) => s
    && s.owner === 'cleanroom_probe'
    && s.status === 'unknown');
  if (missionMode === 'enforce' && unknownCleanroom) {
    const launchPath = unknownCleanroom.launcher
      || 'unknown';
    const rejection = rejected(
      'campaign_generation',
      'final_panel_seat_cleanroom_unavailable',
      `enforced intake requires a probe decision; launcher not present at ${launchPath}`,
    );
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps: [...cleanroomProbeSteps, rejection],
      pre_spend_no_effect_receipt: null,
    };
  }
  for (const probeStep of cleanroomProbeSteps) {
    steps.push(probeStep);
  }

  if (qcSeats && qcSeats.length > 0 && contractPath && rawContractDigest
      && input.roster && input.roster.qc_panel_seats_complete === true) {
    let sealedTicket = null;
    let snapshotCampaignId = null;
    try {
      const sealed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
      sealedTicket = sealed && typeof sealed.ticket === 'string' ? sealed.ticket : null;
      const identity = canonicalRepoIdentity(repo);
      snapshotCampaignId = campaignIdFor(identity, sealedTicket, rawContractDigest);
    } catch (error) {
      const rejection = rejected(
        'qc_panel_snapshot',
        'qc_panel_snapshot_identity_invalid',
        error.message || String(error),
      );
      return {
        status: 'blocked',
        reason: rejection.reason,
        rejection,
        steps: [...steps, rejection],
        pre_spend_no_effect_receipt: null,
      };
    }
    const requiredFamilies = input.roster
      && Number.isSafeInteger(input.roster.required_review_families)
      && input.roster.required_review_families >= 1
      ? input.roster.required_review_families
      : 1;
    const minSize = input.roster && Number.isSafeInteger(input.roster.min_panel_size)
      ? input.roster.min_panel_size
      : 3;
    const liveSnapshot = buildQcPanelSnapshot({
      campaignId: snapshotCampaignId,
      contractDigest: rawContractDigest,
      seats: qcSeats,
      minPanelSize: minSize,
      requiredReviewFamilies: requiredFamilies,
      implementerFamily: modelFamilyOfEngine(input.roster && input.roster.implementer_engine),
    });
    const snapPath = path.join(path.dirname(contractPath), 'qc_panel_snapshot.json');
    try {
      fs.writeFileSync(snapPath, `${JSON.stringify(liveSnapshot)}\n`, { flag: 'wx' });
      qcPanelSnapshot = liveSnapshot;
    } catch (error) {
      if (!error || error.code !== 'EEXIST') {
        const rejection = rejected(
          'qc_panel_snapshot',
          'qc_panel_snapshot_identity_invalid',
          error && error.message ? error.message : String(error),
        );
        return {
          status: 'blocked',
          reason: rejection.reason,
          rejection,
          steps: [...steps, rejection],
          pre_spend_no_effect_receipt: null,
        };
      }
      let existing;
      try {
        existing = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      } catch (readError) {
        const rejection = rejected(
          'qc_panel_snapshot',
          'qc_panel_snapshot_identity_invalid',
          readError.message || String(readError),
        );
        return {
          status: 'blocked',
          reason: rejection.reason,
          rejection,
          steps: [...steps, rejection],
          pre_spend_no_effect_receipt: null,
        };
      }
      if (!existing || existing.campaign_id !== snapshotCampaignId
          || existing.contract_digest !== rawContractDigest) {
        const rejection = rejected(
          'qc_panel_snapshot',
          'qc_panel_snapshot_identity_invalid',
          'qc_panel_snapshot campaign_id/contract_digest do not match the sealed contract',
        );
        return {
          status: 'blocked',
          reason: rejection.reason,
          rejection,
          steps: [...steps, rejection],
          pre_spend_no_effect_receipt: null,
        };
      }
      qcPanelSnapshot = existing;
    }
    const liveDrift = qcPanelSnapshot.digest !== liveSnapshot.digest;
    steps.push(step('qc_panel_snapshot', 'ready', {
      digest: qcPanelSnapshot.digest,
      seat_count: Array.isArray(qcPanelSnapshot.seats) ? qcPanelSnapshot.seats.length : 0,
      path: snapPath,
      ...(liveDrift ? { live_drift: liveSnapshot.digest } : {}),
    }));
  }

  if (typeof adapters.missionClaim === 'function'
      && typeof adapters.releaseMission !== 'function') {
    const rejection = rejected(
      'mission',
      'mission_adapter_pair_required',
      'Mission claim adapter requires a matching release adapter before claim',
    );
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps: [rejection],
      pre_spend_no_effect_receipt: null,
    };
  }
  // Durable-wait resume preflight: verify a git_candidate against Git BEFORE
  // the Mission claim so a drifted resume cannot burn a grant attempt.
  // ADJUDICATING / VERTICAL_VERIFICATION resumes are not preflighted (R6).
  // Fail-closed: any failure to read the sealed contract or project the ledger
  // is a blocked preflight, never a silent skip into the claim (a skipped check
  // would reinstate the spend the preflight exists to prevent).
  if (input.resume === true) {
    let preflightRejection = null;
    try {
      const identity = canonicalRepoIdentity(repo);
      const preflightLedger = campaignLedgerPathFor(identity);
      if (fs.existsSync(preflightLedger) && rawContractDigest) {
        let sealedTicket = null;
        try {
          const sealed = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
          sealedTicket = sealed && typeof sealed.ticket === 'string'
            ? sealed.ticket
            : null;
        } catch (error) {
          throw new CampaignIntakeError(
            'campaign_resume_candidate_invalid',
            `resume preflight could not read the sealed contract: ${error.message || String(error)}`,
          );
        }
        if (!sealedTicket) {
          throw new CampaignIntakeError(
            'campaign_resume_candidate_invalid',
            'resume preflight requires a sealed contract ticket',
          );
        }
        const campaignId = campaignIdFor(identity, sealedTicket, rawContractDigest);
        let projection = null;
        try {
          projection = projectCampaign(loadRows(preflightLedger), campaignId);
        } catch (error) {
          throw new CampaignIntakeError(
            'campaign_resume_candidate_invalid',
            error.message || String(error),
          );
        }
        if (projection
            && NON_SUCCESS_DURABLE_STATES.has(projection.state.phase)
            && projection.candidate_reference
            && projection.candidate_reference.kind === 'git_candidate') {
          verifyResumeCandidate({
            projection,
            repo,
            base: input.base,
          });
        }
      }
    } catch (error) {
      preflightRejection = rejected(
        'campaign_generation',
        (error && error.code) || 'campaign_resume_candidate_invalid',
        (error && error.message) || String(error),
      );
    }
    if (preflightRejection) {
      return {
        status: 'blocked',
        reason: preflightRejection.reason,
        rejection: preflightRejection,
        steps: [preflightRejection],
        pre_spend_no_effect_receipt: null,
      };
    }
  }
  const missionClaimAdapter = adapters.missionClaim || defaultMissionClaim;
  let missionClaim;
  try {
    missionClaim = requireDecision(missionClaimAdapter({
      missionMode,
      contractDigest: rawContractDigest,
      contractPath,
      base: input.base,
      branch: input.branch,
    }), 'mission', new Set(['claimed', 'unknown', 'rejected']));
  } catch (error) {
    const rejection = rejected(
      'mission',
      error.code || 'mission_claim_adapter_failed',
      error.message || String(error),
    );
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps: [rejection],
      pre_spend_no_effect_receipt: null,
    };
  }
  if (missionClaim.status === 'claimed'
      && (typeof missionClaim.claim_id !== 'string'
        || missionClaim.claim_id.length === 0
        || rawContractDigest === null)) {
    const rejection = rejected(
      'mission',
      'invalid_mission_claim',
      'claimed Mission grant must bind a readable campaign contract digest',
    );
    const receipt = buildNoEffectReceipt({
      missionClaim,
      rejection,
      campaignDigest: rawContractDigest,
      now,
    });
    let release;
    try {
      release = requireDecision(
        adapters.releaseMission({ missionClaim, receipt }),
        'mission_release',
        new Set(['released', 'rejected']),
      );
    } catch (error) {
      release = rejected(
        'mission_release',
        error.code || 'mission_release_failed',
        error.message || String(error),
      );
    }
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps: [...cleanroomProbeSteps, missionClaim, rejection, release],
      pre_spend_no_effect_receipt: receipt,
    };
  }
  steps.push(missionClaim);
  if (missionClaim.status === 'rejected') {
    return {
      status: 'blocked',
      reason: missionClaim.reason,
      rejection: missionClaim,
      steps,
      pre_spend_no_effect_receipt: null,
    };
  }

  const releaseAfterRejection = (rejection) => {
    steps.push(rejection);
    let receipt = null;
    if (missionClaim.status === 'claimed') {
      receipt = buildNoEffectReceipt({
        missionClaim,
        rejection,
        campaignDigest: rawContractDigest,
        now,
      });
      let release;
      try {
        release = adapters.releaseMission({ missionClaim, receipt });
        release = requireDecision(
          release,
          'mission_release',
          new Set(['released', 'rejected']),
        );
      } catch (error) {
        release = rejected(
          'mission_release',
          error.code || 'mission_release_failed',
          error.message || String(error),
        );
      }
      steps.push(release);
    }
    return {
      status: 'blocked',
      reason: rejection.reason,
      rejection,
      steps,
      pre_spend_no_effect_receipt: receipt,
    };
  };

  if (!contractPath || !sealPath) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      'campaign_contract_missing',
      'sealed campaign contract is required before implementation',
    ));
  }

  let inspection;
  try {
    inspection = inspectSealedCampaignContract({
      contractPath,
      repoPath: repo,
      sealPath,
    });
  } catch (error) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      error.code || 'campaign_contract_invalid',
      error.message,
    ));
  }
  if (!inspection.ok) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      inspection.verdict === 'DRIFT' ? 'campaign_contract_drift' : 'campaign_contract_invalid',
      `${inspection.verdict}: ${JSON.stringify(inspection.errors || inspection.drift || [])}`,
      { receipt: inspection },
    ));
  }
  if (rawContractDigest !== inspection.contract_sha256) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      'campaign_contract_changed',
      'campaign contract bytes changed after Mission claim',
    ));
  }
  const contract = inspection.contract;
  // mission-subject-v2: recompute subject + campaign-v2 id from the sealed
  // contract (excluding mission_grant_ref) and require exact seal identity.
  // Raw contract_sha256 above remains final-byte provenance.
  if (inspection.identity_scheme === 'mission-subject-v2') {
    let subject;
    let v2CampaignId;
    try {
      subject = missionSubjectDigest(contract);
      v2CampaignId = missionCampaignIdFor(
        inspection.repo_identity,
        contract.ticket,
        subject,
      );
    } catch (error) {
      return releaseAfterRejection(rejected(
        'campaign_contract',
        'mission_subject_identity_invalid',
        error.message || String(error),
      ));
    }
    if (inspection.mission_subject_digest !== subject
        || inspection.campaign_id !== v2CampaignId) {
      return releaseAfterRejection(rejected(
        'campaign_contract',
        'mission_subject_identity_mismatch',
        'sealed mission-subject-v2 identity does not match recomputed subject/campaign id',
      ));
    }
    if (missionClaim.status === 'claimed') {
      // v2 seal: adapter result must carry exact nonempty campaign-v2 id and
      // the seal's claim_id. Absent/empty is rejection, not compatibility.
      if (typeof missionClaim.campaign_id !== 'string'
          || missionClaim.campaign_id.length === 0
          || missionClaim.campaign_id !== v2CampaignId) {
        return releaseAfterRejection(rejected(
          'mission',
          'mission_campaign_id_mismatch',
          'Mission claim campaign_id does not match sealed campaign-v2 id',
        ));
      }
      if (typeof inspection.claim_id !== 'string'
          || inspection.claim_id.length === 0
          || typeof missionClaim.claim_id !== 'string'
          || missionClaim.claim_id.length === 0
          || missionClaim.claim_id !== inspection.claim_id) {
        return releaseAfterRejection(rejected(
          'mission',
          'mission_claim_id_mismatch',
          'Mission claim_id does not match the sealed grant claim',
        ));
      }
    }
  }
  if (contract.base_sha !== input.base || contract.branch !== input.branch) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      'campaign_binding_mismatch',
      'campaign contract base and branch must match the implementation request',
    ));
  }
  if (input.verifyCmd !== undefined && input.verifyCmd !== null
      && input.verifyCmd !== contract.verify_cmd) {
    return releaseAfterRejection(rejected(
      'campaign_contract',
      'campaign_verify_command_mismatch',
      'implementation verify command must match the sealed campaign contract',
    ));
  }
  steps.push(step('campaign_contract', 'ready', {
    contract_digest: inspection.contract_sha256,
    seal_path: inspection.seal_path,
  }));

  // Enforced ICC may not delegate exact-role authority to a serializable
  // decision adapter. The constructor-owned host must supply both the sealed
  // readiness inputs and the live provider, and consumption occurs before the
  // context, occupancy, generation, branch, worktree, or runner seams.
  if (missionMode === 'enforce') {
    let boundReadiness;
    try {
      boundReadiness = consumeEnforcedProviderReadiness({
        adapters,
        contract,
        inspection,
        roster: input.roster,
        now,
        level: typeof input.level === 'string' ? input.level : undefined,
      });
    } catch (error) {
      return releaseAfterRejection(rejected(
        'provider_readiness',
        error.code || 'provider_readiness_authority_invalid',
        error.message || String(error),
      ));
    }
    steps.push(step('provider_readiness_authority', 'ready', {
      receipt_digest: boundReadiness.receipt_digest,
      qualification_authority: boundReadiness.qualification_authority,
    }));
  }

  const readinessAdapter = adapters.readiness || defaultReadiness;
  let readiness;
  try {
    readiness = requireDecision(
      readinessAdapter({ contract, inspection, roster: input.roster }),
      'provider_readiness',
      new Set(['ready', 'unknown', 'rejected']),
    );
  } catch (error) {
    return releaseAfterRejection(rejected(
      'provider_readiness',
      error.code || 'readiness_adapter_invalid',
      error.message || String(error),
    ));
  }
  if (readiness.status === 'rejected') return releaseAfterRejection(readiness);
  steps.push(readiness);

  const contextAdapter = adapters.contextGate || defaultContextGate;
  let context;
  try {
    context = requireDecision(contextAdapter({
      contract,
      contractPath,
      promptFile: input.promptFile,
      repo,
      roster: input.roster,
    }), 'context_window', new Set(['ready', 'unknown', 'rejected']));
  } catch (error) {
    return releaseAfterRejection(rejected(
      'context_window',
      error.code || 'context_adapter_invalid',
      error.message || String(error),
    ));
  }
  if (context.status === 'rejected') return releaseAfterRejection(context);
  steps.push(context);

  const occupancyAdapter = adapters.occupancy || defaultOccupancy;
  let occupancy;
  try {
    occupancy = requireDecision(
      occupancyAdapter({ contract, inspection, campaignId: campaignIdFor(
        inspection.repo_identity,
        contract.ticket,
        inspection.contract_sha256,
      ) }),
      'worktree_lifecycle',
      new Set(['ready', 'unknown', 'rejected']),
    );
  } catch (error) {
    return releaseAfterRejection(rejected(
      'worktree_lifecycle',
      error.code || 'occupancy_adapter_invalid',
      error.message || String(error),
    ));
  }
  if (occupancy.status === 'rejected') return releaseAfterRejection(occupancy);
  steps.push(occupancy);

  let campaignId;
  let initialState;
  let ledgerPath;
  try {
    campaignId = campaignIdFor(
      inspection.repo_identity,
      contract.ticket,
      inspection.contract_sha256,
    );
    initialState = createCampaignState({
      contract,
      contractDigest: inspection.contract_sha256,
      repoIdentity: inspection.repo_identity,
      startedAt: now,
    });
    ledgerPath = campaignLedgerPathFor(inspection.repo_identity);
  } catch (error) {
    return releaseAfterRejection(rejected(
      'campaign_generation',
      error.code || 'campaign_state_invalid',
      error.message || String(error),
    ));
  }
  if (requestedLedgerPath !== null && requestedLedgerPath !== ledgerPath) {
    return releaseAfterRejection(rejected(
      'campaign_generation',
      'campaign_ledger_path_mismatch',
      'campaign ledger path must be the repository-wide canonical Git common-dir ledger',
    ));
  }
  const claimAdapter = adapters.claimGeneration || defaultGenerationClaim;
  let generation;
  try {
    generation = requireDecision(claimAdapter({
      campaignId,
      contractDigest: inspection.contract_sha256,
      initialState,
      ledgerPath,
      repo,
      resume: input.resume === true,
      observedAt: now,
      base: input.base,
    }), 'campaign_generation', new Set(['claimed', 'rejected']));
  } catch (error) {
    return releaseAfterRejection(rejected(
      'campaign_generation',
      error.code || 'generation_claim_invalid',
      error.message || String(error),
    ));
  }
  if (generation.status === 'claimed'
      && (!Number.isSafeInteger(generation.generation)
        || generation.generation < 1
        || typeof generation.nonce !== 'string'
        || generation.nonce.length === 0
        || typeof generation.ledger !== 'string'
        || generation.ledger.length === 0
        || typeof generation.stage_identity !== 'string'
        || generation.stage_identity.length === 0)) {
    return releaseAfterRejection(rejected(
      'campaign_generation',
      'generation_claim_invalid',
      'campaign generation claim must include generation, nonce, ledger, and stage identity',
    ));
  }
  if (generation.status === 'rejected') return releaseAfterRejection(generation);
  steps.push(generation);

  const shadowAxes = steps
    .filter((entry) => entry.status === 'unknown' || entry.enforcement === 'shadow')
    .map((entry) => entry.owner);
  const durableState = generation.resumed_state || initialState;
  return {
    status: 'admitted',
    reason: null,
    campaign_id: campaignId,
    contract_digest: inspection.contract_sha256,
    contract,
    contract_path: contractPath,
    seal_path: inspection.seal_path,
    initial_state: durableState,
    mission_claim: missionClaim.status === 'claimed' ? missionClaim : null,
    generation_claim: generation,
    full_enforcement: shadowAxes.length === 0,
    shadow_axes: shadowAxes,
    steps,
    qc_panel_snapshot: qcPanelSnapshot,
    pre_spend_no_effect_receipt: null,
  };
}

module.exports = {
  appendCampaignEvent,
  CampaignIntakeError,
  buildNoEffectReceipt,
  buildQcPanelSnapshot,
  completeCampaignAdmission,
  consumeEnforcedProviderReadiness,
  defaultCampaignSealPath,
  defaultCleanroomProbe,
  modelFamilyOfEngine,
  repairLineageCleanupState,
  releaseCampaignAdmission,
  runCampaignIntake,
};
