'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CAMPAIGN_STATES,
  canonicalDigest,
  normalizeCampaignArtifactReference,
  reduceCampaignState,
  validateInitialCampaignState,
} = require('../engine/implementation-campaign');
const { projectCampaignStatus } = require('./status');

const TERMINAL = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
  CAMPAIGN_STATES.TERMINAL_STOP,
]);
const RUN_LEDGER_STAGE_STATES = new Set([
  'leased',
  'committed',
  'reviewed',
  'verified',
  'merged',
  'stale_ignored',
  'quarantined',
  'dead',
]);
const NONLIVE_STAGE_STATES = new Set([
  'committed',
  'reviewed',
  'verified',
  'merged',
  'stale_ignored',
  'quarantined',
  'dead',
]);
const ALLOWED_STAGE_TRANSITIONS = Object.freeze({
  leased: new Set(['committed', 'reviewed', 'verified', 'merged', 'stale_ignored', 'dead']),
  committed: new Set(['reviewed', 'stale_ignored', 'dead']),
  reviewed: new Set(['verified', 'stale_ignored', 'dead']),
  verified: new Set(['merged', 'stale_ignored', 'dead']),
  stale_ignored: new Set(['stale_ignored', 'quarantined', 'dead']),
  quarantined: new Set(['stale_ignored', 'quarantined', 'dead']),
  dead: new Set(['stale_ignored', 'quarantined', 'dead']),
});
const EXIT_SUCCESS = 0;
const INTAKE_ARTIFACT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'campaign_id',
  'contract_digest',
  'initial_state',
  'initial_state_digest',
]);
const EVENT_ARTIFACT_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'campaign_id',
  'contract_digest',
  'event',
]);
const DURABLE_EVENT_ARTIFACT_KEYS = new Set([
  ...EVENT_ARTIFACT_KEYS,
  'artifact_reference',
]);

function hasExactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function defaultCampaignLedgerPath(cwd) {
  const common = spawnSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (common.error || common.status !== 0) {
    throw new Error('default campaign ledger requires a Git repository');
  }
  const raw = String(common.stdout || '').trim();
  const candidate = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (_error) {
    throw new Error('default campaign ledger Git common directory is unreadable');
  }
  return path.join(canonical, 'autopilot', 'implementation-campaign.jsonl');
}

function parseArgs(argv, cwd) {
  const command = argv[0];
  if (!new Set(['inspect', 'resume', 'status']).has(command)) {
    return { error: `unknown campaign subcommand: ${command || '<missing>'}` };
  }
  const output = {
    command,
    campaignId: null,
    ledger: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--campaign-id' || flag === '--ledger') {
      if (!value) return { error: `${flag} requires a value` };
      if (flag === '--campaign-id') output.campaignId = value;
      if (flag === '--ledger') output.ledger = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    return { error: `unknown campaign option: ${flag}` };
  }
  if (!output.campaignId) return { error: '--campaign-id is required' };
  if (!output.ledger) {
    try {
      output.ledger = defaultCampaignLedgerPath(cwd);
    } catch (error) {
      return { error: error.message || String(error) };
    }
  }
  return output;
}

/**
 * Rotation-aware oldest-to-live ledger view (mirrors scripts/run-ledger.sh
 * ledger_scan_files). Segments ${ledger}.N … ${ledger}.1 (oldest retained first),
 * then the live ledger. Last-write semantics: later segments / later lines win.
 */
function ledgerScanFiles(ledger) {
  if (typeof ledger !== 'string' || ledger.length === 0) {
    throw new Error('campaign ledger path is required');
  }
  const maxRotRaw = process.env.RUN_LEDGER_MAX_ROTATIONS;
  const maxRot = maxRotRaw === undefined || maxRotRaw === ''
    ? 4
    : Number(maxRotRaw);
  const limit = Number.isFinite(maxRot) && maxRot >= 0 ? Math.floor(maxRot) : 4;
  const files = [];
  for (let idx = limit; idx >= 1; idx -= 1) {
    const segment = `${ledger}.${idx}`;
    if (fs.existsSync(segment)) files.push(segment);
  }
  if (fs.existsSync(ledger)) files.push(ledger);
  return files;
}

function loadRows(ledger) {
  const files = ledgerScanFiles(ledger);
  if (files.length === 0) return [];
  const rows = [];
  let totalBytes = 0;
  let lineNo = 0;
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    totalBytes += bytes.length;
    if (totalBytes > 64 * 1024 * 1024) throw new Error('campaign ledger exceeds 64 MiB');
    const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim() !== '');
    for (const line of lines) {
      lineNo += 1;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `campaign ledger line ${lineNo} (${path.basename(file)}) is invalid JSON: ${error.message}`,
        );
      }
    }
  }
  return rows;
}

function parsePayload(row) {
  if (typeof row.payload !== 'string') return row.payload;
  try {
    return JSON.parse(row.payload);
  } catch (error) {
    throw new Error(`campaign ledger contains invalid JSON payload: ${error.message}`);
  }
}

function validateCampaignStageHistory(stageRows, intake, campaignId) {
  if (stageRows.length === 0) {
    throw new Error('campaign ledger intake root has no stage history');
  }
  if (!Number.isSafeInteger(intake.generation)
      || intake.generation < 1
      || typeof intake.nonce !== 'string'
      || intake.nonce.length === 0
      || !stageRows.some((row) => row.state === 'leased'
        && row.generation === intake.generation
        && row.nonce === intake.nonce)) {
    throw new Error('campaign ledger intake root is not bound to its generation lease');
  }
  let latest = null;
  const generations = new Map();
  for (const row of stageRows) {
    if (!Number.isSafeInteger(row.generation)
        || row.generation < 1
        || typeof row.nonce !== 'string'
        || row.nonce.length === 0
        || !RUN_LEDGER_STAGE_STATES.has(row.state)
        || row.resources !== `campaign:${campaignId}`) {
      throw new Error('campaign ledger latest stage evidence is malformed');
    }
    if (row.state === 'leased') {
      // Rotation carry-forward re-materializes the latest leased row onto the
      // live segment; treat identical generation+nonce as last-write no-op.
      if (latest
          && latest.state === 'leased'
          && latest.generation === row.generation
          && latest.nonce === row.nonce) {
        generations.set(row.generation, row);
        latest = row;
        continue;
      }
      if ((!latest && row.generation !== 1)
          || generations.has(row.generation)
          || (latest && row.generation !== latest.generation + 1)
          || (latest
            && latest.state === 'leased'
            && processLiveness(latest) !== 'dead')) {
        throw new Error('campaign ledger lease generation chain is invalid');
      }
      if (!Number.isSafeInteger(row.pid)
          || row.pid <= 0
          || !Number.isSafeInteger(row.start_time)
          || row.start_time <= 0) {
        throw new Error('campaign ledger live lease identity is malformed');
      }
      generations.set(row.generation, row);
      latest = row;
      continue;
    }
    const prior = generations.get(row.generation);
    if (!prior
        || prior !== latest
        || prior.nonce !== row.nonce
        || row.transition_from !== prior.state
        || !ALLOWED_STAGE_TRANSITIONS[prior.state]
        || !ALLOWED_STAGE_TRANSITIONS[prior.state].has(row.state)) {
      throw new Error('campaign ledger stage transition chain is invalid');
    }
    generations.set(row.generation, row);
    latest = row;
  }
  return latest;
}

function validateCampaignJournalLease(row, currentLease) {
  if (!currentLease
      || currentLease.state !== 'leased'
      || row.stage !== 'campaign'
      || row.generation !== currentLease.generation
      || row.nonce !== currentLease.nonce) {
    throw new Error('campaign ledger journal is not bound to the active generation lease');
  }
}

function projectCampaign(rows, campaignId) {
  const owned = rows.filter((row) => row && row.run_id === campaignId);
  const intakes = owned.filter(
    (row) => row.kind === 'journal' && row.op === 'campaign_intake',
  );
  if (intakes.length === 0) return null;
  // Last-write across rotated segments (and rotation carry-forward) may
  // re-materialize the same intake root on the live segment. Prefer the
  // newest row; reject only when multiple intakes disagree.
  const intake = intakes[intakes.length - 1];
  if (intakes.length > 1) {
    const digests = new Set(intakes.map((row) => {
      try {
        const payload = parsePayload(row);
        return typeof payload.initial_state_digest === 'string'
          ? payload.initial_state_digest
          : JSON.stringify(payload);
      } catch (_error) {
        return `invalid:${row.ts || ''}:${row.idempotency_key || ''}`;
      }
    }));
    if (digests.size !== 1) {
      throw new Error('campaign ledger must contain exactly one intake root');
    }
  }
  const intakePayload = parsePayload(intake);
  if (!hasExactKeys(intakePayload, INTAKE_ARTIFACT_KEYS)
      || intakePayload.schema_version !== 1
      || intakePayload.artifact_type !== 'implementation_campaign_intake'
      || intakePayload.campaign_id !== campaignId
      || !intakePayload.initial_state
      || intakePayload.initial_state.campaign_id !== campaignId
      || intakePayload.contract_digest !== intakePayload.initial_state.contract_digest
      || typeof intakePayload.initial_state_digest !== 'string'
      || !/^[0-9a-f]{64}$/.test(intakePayload.initial_state_digest)
      || canonicalDigest(intakePayload.initial_state) !== intakePayload.initial_state_digest) {
    throw new Error('campaign ledger contains an invalid intake state binding');
  }
  validateInitialCampaignState(intakePayload.initial_state);
  const stageRows = owned.filter((row) => row.kind === 'stage' && row.stage === 'campaign');
  const latestLease = validateCampaignStageHistory(stageRows, intake, campaignId);
  let state = intakePayload.initial_state;
  let currentLease = null;
  let lastArtifactReference = null;
  let candidateReference = null;
  let initialCandidateReference = null;
  let lifecycleReceiptRef = null;
  for (const row of owned) {
    if (row.kind === 'stage' && row.stage === 'campaign') {
      if (row.state === 'leased') {
        currentLease = row;
      } else if (currentLease
          && row.generation === currentLease.generation
          && row.nonce === currentLease.nonce) {
        currentLease = row;
      }
      continue;
    }
    if (row === intake) {
      validateCampaignJournalLease(row, currentLease);
      continue;
    }
    if (row.kind !== 'journal' || row.op !== 'campaign_event') {
      continue;
    }
    const payload = parsePayload(row);
    if (!(hasExactKeys(payload, EVENT_ARTIFACT_KEYS)
        || hasExactKeys(payload, DURABLE_EVENT_ARTIFACT_KEYS))
        || payload.schema_version !== 1
        || payload.artifact_type !== 'implementation_campaign_event'
        || payload.campaign_id !== campaignId
        || payload.contract_digest !== state.contract_digest) {
      throw new Error('campaign ledger contains an invalid event wrapper binding');
    }
    validateCampaignJournalLease(row, currentLease);
    state = reduceCampaignState(state, payload.event);
    if (TERMINAL.has(state.phase)) {
      const reference = Object.prototype.hasOwnProperty.call(
        payload.event.payload,
        'lifecycle_receipt_ref',
      )
        ? payload.event.payload.lifecycle_receipt_ref
        : 'unknown';
      if (!(reference === 'unknown'
          || (
            reference
            && typeof reference === 'object'
            && !Array.isArray(reference)
            && Object.keys(reference).length === 3
            && typeof reference.path === 'string'
            && reference.path.length > 0
            && reference.root_run_id === campaignId
            && typeof reference.receipt_digest === 'string'
            && /^[0-9a-f]{64}$/u.test(reference.receipt_digest)
          ))) {
        throw new Error('campaign terminal lifecycle receipt reference is invalid');
      }
      lifecycleReceiptRef = reference;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'artifact_reference')) {
      const reference = payload.artifact_reference;
      if (reference !== null) {
        try {
          normalizeCampaignArtifactReference(reference);
        } catch (error) {
          throw new Error(`campaign ledger event artifact reference is invalid: ${error.message}`);
        }
      }
      if (reference
          && reference.kind === 'git_candidate'
          && reference.writer_fence.campaign_id !== campaignId) {
        throw new Error('campaign ledger candidate writer fence belongs to another campaign');
      }
      if (reference !== null
          && canonicalDigest(reference) !== payload.event.output_artifact_digest) {
        throw new Error('campaign ledger event artifact reference digest is invalid');
      }
      if (reference !== null) lastArtifactReference = reference;
      if (reference && reference.kind === 'git_candidate') {
        candidateReference = reference;
        if (!initialCandidateReference) initialCandidateReference = reference;
      }
    }
  }
  return {
    schema_version: 1,
    campaign_id: campaignId,
    initial_state: intakePayload.initial_state,
    state,
    latest_lease: latestLease,
    durable_event_count: state.event_count,
    ledger_row_count: owned.length,
    last_artifact_reference: lastArtifactReference,
    candidate_reference: candidateReference,
    initial_candidate_reference: initialCandidateReference,
    lifecycle_receipt_ref: lifecycleReceiptRef,
  };
}

function processStartTime(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const startTicks = Number(fields[19]);
    const btimeLine = fs.readFileSync('/proc/stat', 'utf8')
      .split('\n')
      .find((line) => line.startsWith('btime '));
    const ticksResult = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' });
    const bootTime = Number(btimeLine && btimeLine.split(/\s+/)[1]);
    const ticks = Number(String(ticksResult.stdout || '').trim());
    if (Number.isFinite(startTicks) && Number.isFinite(bootTime)
        && Number.isFinite(ticks) && ticks > 0) {
      return Math.floor(bootTime + (startTicks / ticks));
    }
  } catch (_error) {
    // Fall through to the portable ps projection.
  }
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error || result.status !== 0) return null;
  const parsed = Date.parse(String(result.stdout || '').trim());
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function processLiveness(lease) {
  if (!lease) return 'dead';
  if (NONLIVE_STAGE_STATES.has(lease.state)) return 'dead';
  if (lease.state !== 'leased') return 'unknown';
  if (!Number.isInteger(lease.pid) || lease.pid <= 0) return 'unknown';
  try {
    process.kill(lease.pid, 0);
  } catch (error) {
    if (error && error.code === 'ESRCH') return 'dead';
    return 'unknown';
  }
  if (!Number.isSafeInteger(lease.start_time) || lease.start_time <= 0) return 'unknown';
  const currentStart = processStartTime(lease.pid);
  if (currentStart === null) return 'unknown';
  return currentStart === lease.start_time ? 'alive' : 'dead';
}

function campaignResumeEligibility(projection, observedAt) {
  const liveness = processLiveness(projection.latest_lease);
  if (TERMINAL.has(projection.state.phase)) {
    return { status: 'terminal', reason: 'campaign is already terminal', reason_code: 'terminal' };
  }
  if (liveness === 'alive') {
    return { status: 'blocked', reason: 'campaign already has a live lease', reason_code: 'live_lease' };
  }
  if (liveness === 'unknown') {
    return {
      status: 'blocked',
      reason: 'campaign lease liveness cannot be verified',
      reason_code: 'lease_unknown',
    };
  }
  if (projection.state.live_lease !== null) {
    return {
      status: 'blocked',
      reason: 'durable campaign state still owns a mutation lease',
      reason_code: 'campaign_state_lease_open',
    };
  }
  const hasCandidate = projection.candidate_reference
    && projection.candidate_reference.kind === 'git_candidate';
  const hasBoundReview = projection.last_artifact_reference
    && projection.last_artifact_reference.kind === 'product_review'
    && canonicalDigest(projection.last_artifact_reference)
      === projection.state.last_output_artifact_digest;
  const resumePhaseSupported = projection.state.phase === CAMPAIGN_STATES.PREPARED
    || (projection.state.phase === CAMPAIGN_STATES.VERTICAL_VERIFICATION && hasCandidate)
    || (projection.state.phase === CAMPAIGN_STATES.ADJUDICATING
      && hasCandidate
      && hasBoundReview);
  if (!resumePhaseSupported) {
    return {
      status: 'blocked',
      reason: `campaign resume from ${projection.state.phase} is not yet supported`,
      reason_code: 'campaign_resume_phase_unsupported',
    };
  }
  if (projection.state.usage.changed_files >= projection.state.limits.max_changed_files) {
    return {
      status: 'blocked',
      reason: 'campaign changed-file budget is exhausted',
      reason_code: 'campaign_file_budget_exhausted',
    };
  }
  if (projection.state.usage.churn >= projection.state.limits.max_churn) {
    return {
      status: 'blocked',
      reason: 'campaign churn budget is exhausted',
      reason_code: 'campaign_churn_budget_exhausted',
    };
  }
  const startedAt = Date.parse(projection.state.started_at);
  const now = Date.parse(observedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt
      || Math.floor((now - startedAt) / 1000) >= projection.state.limits.max_wall_seconds) {
    return {
      status: 'blocked',
      reason: 'campaign wall-clock budget is exhausted or unverifiable',
      reason_code: 'campaign_wall_budget_exhausted',
    };
  }
  return { status: 'resumable', reason: null, reason_code: null };
}

function runCampaignCli(argv, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const parsed = parseArgs(argv, cwd);
  if (parsed.error) {
    process.stderr.write(`campaign: ${parsed.error}\n`);
    return 2;
  }
  let projection;
  let rows;
  try {
    rows = loadRows(parsed.ledger);
    projection = projectCampaign(rows, parsed.campaignId);
  } catch (error) {
    process.stderr.write(`campaign: ${error.message}\n`);
    return 1;
  }
  if (!projection) {
    process.stdout.write(`${JSON.stringify({
      status: 'not_found',
      campaign_id: parsed.campaignId,
    })}\n`);
    return 1;
  }
  if (parsed.command === 'inspect') {
    process.stdout.write(`${JSON.stringify({
      status: 'found',
      ...projection,
    })}\n`);
    return EXIT_SUCCESS;
  }
  const now = typeof options.now === 'function'
    ? options.now()
    : new Date().toISOString();
  if (parsed.command === 'status') {
    process.stdout.write(`${JSON.stringify({
      status: 'found',
      ...projectCampaignStatus(projection, rows, now, { processLiveness }),
    })}\n`);
    return EXIT_SUCCESS;
  }
  const eligibility = campaignResumeEligibility(projection, now);
  process.stdout.write(`${JSON.stringify({
    status: eligibility.status,
    reason: eligibility.reason,
    reason_code: eligibility.reason_code,
    campaign_id: parsed.campaignId,
    contract_digest: projection.state.contract_digest,
    phase: projection.state.phase,
    generation: projection.state.generation,
    resume_required: eligibility.status === 'resumable',
  })}\n`);
  return eligibility.status === 'resumable' ? EXIT_SUCCESS : 1;
}

module.exports = {
  campaignResumeEligibility,
  defaultCampaignLedgerPath,
  ledgerScanFiles,
  loadRows,
  parseArgs,
  processLiveness,
  projectCampaign,
  runCampaignCli,
};
