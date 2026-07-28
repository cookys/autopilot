'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  inspectSealedCampaignContract,
  projectMissionMode,
} = require('../../scripts/implementation-campaign-check');
const {
  CAMPAIGN_EVENTS,
  CAMPAIGN_STATES,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
  normalizeCampaignArtifactReference,
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
  const elapsed = Math.floor((Date.parse(observedAt) - Date.parse(state.started_at)) / 1000);
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
  const startedMs = Date.parse(existingState.started_at);
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
      elapsed_wall_seconds: Math.floor((observedMs - startedMs) / 1000),
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
  if (tip.error || tip.status !== 0 || String(tip.stdout || '').trim() !== reference.commit
      || tree.error || tree.status !== 0
      || String(tree.stdout || '').trim() !== reference.tree_sha
      || ancestry.error || ancestry.status !== 0) {
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
    ]).has(existing.state.phase);
    const resumePhaseSupported = existing.state.phase === CAMPAIGN_STATES.PREPARED
      || resumableCandidatePhase;
    if (!resumePhaseSupported) {
      return rejected(
        'campaign_generation',
        'campaign_resume_phase_unsupported',
        `campaign resume from ${existing.state.phase} is unavailable until phase-aware dispatch ships`,
      );
    }
    if (resumableCandidatePhase) {
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
          || canonicalDigest(reviewReference) !== existing.state.last_output_artifact_digest) {
        return rejected(
          'campaign_generation',
          'campaign_resume_review_invalid',
          'adjudication resume requires the exact durable focused-review digest',
        );
      }
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
      steps: [missionClaim, rejection, release],
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
    generation_claim: generation,
    full_enforcement: shadowAxes.length === 0,
    shadow_axes: shadowAxes,
    steps,
    pre_spend_no_effect_receipt: null,
  };
}

module.exports = {
  appendCampaignEvent,
  CampaignIntakeError,
  buildNoEffectReceipt,
  completeCampaignAdmission,
  defaultCampaignSealPath,
  releaseCampaignAdmission,
  runCampaignIntake,
};
