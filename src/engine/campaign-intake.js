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
  reduceCampaignState,
} = require('./implementation-campaign');
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

function abandonCampaignLease({ campaignId, lease, ledgerPath, repo }) {
  runLedger([
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
    `campaign-abandon:${lease.generation}:${lease.nonce}`,
  ], repo);
}

function defaultGenerationClaim({
  campaignId,
  contractDigest,
  initialState,
  ledgerPath,
  repo,
  resume,
  observedAt,
}) {
  let existing = null;
  let resumePreflight = null;
  if (fs.existsSync(ledgerPath)) {
    try {
      existing = projectCampaign(loadRows(ledgerPath), campaignId);
    } catch (error) {
      return rejected(
        'campaign_generation',
        'campaign_ledger_invalid',
        error.message || String(error),
      );
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
  if (resume === true) acquireArgs.push('--allow-reopen');
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

function runCampaignIntake(input = {}, adapters = {}) {
  const repo = path.resolve(input.repo || process.cwd());
  const contractPath = input.contractPath && path.resolve(repo, input.contractPath);
  const sealPath = input.sealPath
    ? path.resolve(repo, input.sealPath)
    : (contractPath ? defaultCampaignSealPath(contractPath) : null);
  const ledgerPath = path.resolve(
    input.ledgerPath || path.join(repo, '.autopilot', 'run-ledger.jsonl'),
  );
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

  const missionClaimAdapter = adapters.missionClaim || defaultMissionClaim;
  const missionClaim = requireDecision(missionClaimAdapter({
    missionMode,
    contractDigest: rawContractDigest,
    contractPath,
    base: input.base,
    branch: input.branch,
  }), 'mission', new Set(['claimed', 'unknown', 'rejected']));
  if (missionClaim.status === 'claimed'
      && (typeof missionClaim.claim_id !== 'string'
        || missionClaim.claim_id.length === 0
        || rawContractDigest === null)) {
    throw new CampaignIntakeError(
      'invalid_mission_claim',
      'claimed Mission grant must bind a readable campaign contract digest',
    );
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
        release = adapters.releaseMission
          ? adapters.releaseMission({ missionClaim, receipt })
          : step('mission_release', 'unknown', {
            enforcement: 'shadow',
            reason: 'Mission release adapter is not shipped yet',
          });
        release = requireDecision(
          release,
          'mission_release',
          new Set(['released', 'unknown', 'rejected']),
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
  const contract = inspection.contract;
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

  const campaignId = campaignIdFor(
    inspection.repo_identity,
    contract.ticket,
    inspection.contract_sha256,
  );
  const initialState = createCampaignState({
    contract,
    contractDigest: inspection.contract_sha256,
    repoIdentity: inspection.repo_identity,
    startedAt: now,
  });
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
    .filter((entry) => entry.status === 'unknown')
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
  CampaignIntakeError,
  buildNoEffectReceipt,
  defaultCampaignSealPath,
  runCampaignIntake,
};
