'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CAMPAIGN_STATES,
  CAMPAIGN_EVENTS,
  NON_SUCCESS_DURABLE_STATES,
  canonicalDigest,
  resolveCampaignEventLeaseIdentity,
  normalizeCampaignArtifactReference,
  reduceCampaignState,
  validateInitialCampaignState,
} = require('../engine/implementation-campaign');
const { projectCampaignStatus } = require('./status');
const RUN_LEDGER = path.resolve(__dirname, '..', '..', 'scripts', 'run-ledger.sh');

const TERMINAL = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
  CAMPAIGN_STATES.TERMINAL_STOP,
]);
// Durable non-success waits: projectable and resumable without fabricating mutation_failed.
const DURABLE_WAIT = new Set([
  CAMPAIGN_STATES.BOUNDARY_REJECTED,
  CAMPAIGN_STATES.AWAITING_DISPOSITION,
  CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION,
  ...NON_SUCCESS_DURABLE_STATES,
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
  if (!new Set(['inspect', 'resume', 'status', 'terminalize']).has(command)) {
    return { error: `unknown campaign subcommand: ${command || '<missing>'}` };
  }
  const output = {
    command,
    campaignId: null,
    ledger: null,
    leafManifest: null,
    now: null,
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
    if (flag === '--leaf-manifest') {
      if (!value) return { error: `${flag} requires a value` };
      output.leafManifest = path.resolve(cwd, value);
      index += 1;
      continue;
    }
    if (flag === '--now') {
      if (!value) return { error: `${flag} requires a value` };
      output.now = value;
      index += 1;
      continue;
    }
    return { error: `unknown campaign option: ${flag}` };
  }
  if (output.command === 'terminalize' && !output.leafManifest) {
    return { error: '--leaf-manifest is required' };
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
  if (typeof ledger !== 'string' || ledger.length === 0) {
    throw new Error('campaign ledger path is required');
  }
  const snapshot = spawnSync('bash', [RUN_LEDGER, 'snapshot', '--ledger', ledger], {
    encoding: null,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: (64 * 1024 * 1024) + (1024 * 1024),
  });
  if (snapshot.error || snapshot.status !== 0) {
    throw new Error(
      `campaign ledger snapshot failed: ${
        snapshot.error
          ? snapshot.error.message
          : Buffer.from(snapshot.stderr || '').toString('utf8').trim()
      }`,
    );
  }
  const bytes = Buffer.from(snapshot.stdout || '');
  if (bytes.length === 0) return [];
  if (bytes.length > 64 * 1024 * 1024) throw new Error('campaign ledger exceeds 64 MiB');
  const rows = [];
  let lineNo = 0;
  const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim() !== '');
  for (const line of lines) {
    lineNo += 1;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`campaign ledger snapshot line ${lineNo} is invalid JSON: ${error.message}`);
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
  const rotationRootFor = (row) => Buffer.from(JSON.stringify(
    Object.fromEntries(Object.entries(row).filter(
      ([key]) => key !== '_rotation_carry' && key !== '_rotation_root',
    )),
  )).toString('base64');
  const seenRotationRoots = new Set();
  const owned = [];
  for (const row of rows.filter((entry) => entry && entry.run_id === campaignId)) {
    if (row.kind !== 'journal') {
      owned.push(row);
      continue;
    }
    const root = row._rotation_carry === true ? row._rotation_root : rotationRootFor(row);
    if (row._rotation_carry === true && seenRotationRoots.has(root)) continue;
    seenRotationRoots.add(root);
    owned.push(row);
  }
  const intakes = owned.filter(
    (row) => row.kind === 'journal' && row.op === 'campaign_intake',
  );
  if (intakes.length === 0) return null;
  // Rotation carry rows have explicit provenance. Collapse only those
  // mechanically generated copies; two manually journaled intake roots remain
  // ambiguous and fail closed even when their payloads happen to agree.
  const originalIntakes = intakes.filter((row) => row._rotation_carry !== true);
  if (originalIntakes.length > 1) {
    throw new Error('campaign ledger must contain exactly one intake root');
  }
  const intake = intakes[intakes.length - 1];
  if (originalIntakes.length === 0) {
    const carryRoots = new Set(intakes.map((row) => row._rotation_root).filter(Boolean));
    if (carryRoots.size !== 1 || intakes.some((row) => row._rotation_carry !== true)) {
      throw new Error('campaign ledger must contain exactly one intake root');
    }
  } else if (intakes.length > 1) {
    const originalRoot = rotationRootFor(originalIntakes[0]);
    if (intakes.some((row) => (
      row._rotation_carry === true && row._rotation_root !== originalRoot
    ))) {
      throw new Error('campaign ledger must contain exactly one intake root');
    }
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
    // First-class durable non-success projections (parseable, digest-bound).
    boundary_rejected: state.boundary_rejected || null,
    awaiting_disposition: state.awaiting_disposition || null,
    convergence_budget: state.convergence_budget || null,
    durable_wait: DURABLE_WAIT.has(state.phase),
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

function campaignTerminalizeEligibility(projection, evidence, _now) {
  const manifest = evidence && evidence.manifest;
  const phase = projection && projection.state ? projection.state.phase : null;
  if (TERMINAL.has(phase)) {
    return {
      status: 'blocked',
      reason_code: 'campaign_already_terminal',
      reason: 'campaign is already terminal',
    };
  }
  const liveness = processLiveness(projection && projection.latest_lease);
  if (liveness === 'alive') {
    return {
      status: 'blocked',
      reason_code: 'campaign_lease_live',
      reason: 'campaign lease is still alive',
    };
  }
  if (liveness === 'unknown') {
    return {
      status: 'blocked',
      reason_code: 'campaign_lease_unknown',
      reason: 'campaign lease liveness is unknown',
    };
  }
  const manifestEnds = manifest
    && typeof manifest === 'object'
    && !Array.isArray(manifest)
    && typeof manifest.ended_at === 'string'
    && manifest.ended_at.length > 0;
  if (!manifestEnds) {
    return {
      status: 'blocked',
      reason_code: 'campaign_leaf_manifest_open',
      reason: 'leaf manifest missing or malformed',
    };
  }
  // qc 2026-08-31 (gpt-5.6-sol 🟠 verified): the manifest is caller-selected,
  // so it must name THIS campaign and carry the authoritative worktree path —
  // otherwise any ended manifest could terminalize an unrelated campaign whose
  // (unrecorded) worktree still exists.
  const manifestIdentities = [manifest.root_run_id, manifest.run_id]
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (!manifestIdentities.includes(projection && projection.campaign_id)) {
    return {
      status: 'blocked',
      reason_code: 'campaign_leaf_manifest_mismatch',
      reason: 'leaf manifest does not name this campaign (root_run_id / run_id)',
    };
  }
  const manifestWorktree = manifest.worktree;
  if (typeof manifestWorktree !== 'string' || manifestWorktree.length === 0) {
    return {
      status: 'blocked',
      reason_code: 'campaign_leaf_manifest_open',
      reason: 'leaf manifest lacks an authoritative worktree path',
    };
  }
  if (fs.existsSync(manifestWorktree)) {
    return {
      status: 'blocked',
      reason_code: 'campaign_worktree_present',
      reason: 'leaf manifest worktree is still present',
    };
  }
  const repairLineage = projection && projection.candidate_reference && projection.candidate_reference.repair_lineage;
  const worktree = repairLineage && repairLineage.worktree;
  if (typeof worktree === 'string' && worktree.length > 0 && fs.existsSync(worktree)) {
    return {
      status: 'blocked',
      reason_code: 'campaign_worktree_present',
      reason: 'campaign candidate worktree is still present',
    };
  }
  return {
    status: 'eligible',
    reason_code: null,
    reason: null,
  };
}

function buildTerminalizeMutationFailedEvent(projection, now, reason) {
  const state = projection.state;
  const observedAt = typeof now === 'string' && now.length > 0 ? now : new Date().toISOString();
  const reasonText = typeof reason === 'string' && reason.length > 0 ? reason : 'campaign dead leaf terminalization';
  const leaseIdentity = resolveCampaignEventLeaseIdentity(state, CAMPAIGN_EVENTS.MUTATION_FAILED);
  const elapsedWallSeconds = Number.isFinite(Date.parse(state.started_at))
    && Number.isFinite(Date.parse(observedAt))
      ? Math.floor((Date.parse(observedAt) - Date.parse(state.started_at)) / 1000)
      : 0;
  const base = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_failure',
    campaign_id: projection.campaign_id,
    contract_digest: state.contract_digest,
    generation: state.generation,
    phase: state.phase,
    reason: reasonText,
      possibly_effectful: true,
      observed_at: observedAt,
  };
  const receiptDigest = canonicalDigest(base);
  const generationCandidates = Array.from(new Set([
    leaseIdentity.generation,
    state.generation,
  ].filter((value) => Number.isSafeInteger(value))));
  let candidateNextState = null;
  let event = null;
  let lastError = null;
  for (const generation of generationCandidates) {
    const candidate = {
      schema_version: 1,
      event_type: CAMPAIGN_EVENTS.MUTATION_FAILED,
      campaign_id: projection.campaign_id,
      contract_digest: state.contract_digest,
      generation,
      stage_identity: leaseIdentity.stage_identity,
      idempotency_key: `terminalize:${projection.campaign_id}`,
      input_artifact_digest: state.last_output_artifact_digest,
      output_artifact_digest: canonicalDigest({
        kind: 'campaign_terminal',
        digest: receiptDigest,
      }),
      timestamp: observedAt,
      payload: {
        reason: reasonText,
        failure_receipt_digest: receiptDigest,
        possibly_effectful: true,
      },
      usage: {
        repair_generations: generation,
        elapsed_wall_seconds: elapsedWallSeconds > 0 ? elapsedWallSeconds : 0,
        changed_files: state.usage && Number.isFinite(state.usage.changed_files)
          ? state.usage.changed_files
          : 0,
        churn: state.usage && Number.isFinite(state.usage.churn)
          ? state.usage.churn
          : 0,
      },
    };
    try {
      candidateNextState = reduceCampaignState(state, candidate);
      event = candidate;
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!(error && error.code === 'GENERATION_MISMATCH')) {
        throw error;
      }
    }
  }
  if (!event || !candidateNextState) {
    throw lastError || new Error('terminalize event was rejected by campaign reducer');
  }
  const nextState = candidateNextState;
  if (nextState.phase !== CAMPAIGN_STATES.TERMINAL_STOP || nextState.live_lease !== null) {
    throw new Error('terminalize event did not reduce to terminal stop with lease released');
  }
  return {
    event,
    nextState,
    receiptBody: base,
    receiptDigest,
  };
}

function writeCampaignTerminalizeSummary(ledgerPath, projection, built) {
  const summaryPath = path.join(
    path.dirname(path.resolve(ledgerPath)),
    `${projection.campaign_id}.terminalize-summary.json`,
  );
  if (fs.existsSync(summaryPath)) {
    return { path: summaryPath, written: false };
  }
  const summary = {
    artifact_type: 'campaign_terminalize_summary',
    campaign_id: projection.campaign_id,
    receipt: built.receiptBody,
    event: built.event,
    phase: built.nextState.phase,
    generation: built.nextState.generation,
  };
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return { path: summaryPath, written: true };
}

// qc 2026-08-31 (gpt-5.6-sol 🟠 verified): the terminal event is journaled
// BEFORE the summary is written, so a crash between the two leaves a terminal
// campaign with no summary and every retry answers campaign_already_terminal.
// Retry therefore backfills an absent summary from the durable journal.
function backfillCampaignTerminalizeSummary(ledgerPath, projection, rows) {
  const summaryPath = path.join(
    path.dirname(path.resolve(ledgerPath)),
    `${projection.campaign_id}.terminalize-summary.json`,
  );
  if (fs.existsSync(summaryPath)) {
    return { path: summaryPath, written: false };
  }
  let lastEvent = null;
  for (const row of (rows || []).filter((entry) => entry && entry.run_id === projection.campaign_id)) {
    let payload = null;
    try { payload = parsePayload(row); } catch (_error) { payload = null; }
    if (payload && payload.event) lastEvent = payload.event;
  }
  const summary = {
    artifact_type: 'campaign_terminalize_summary',
    campaign_id: projection.campaign_id,
    receipt: null,
    event: lastEvent,
    phase: projection.state.phase,
    generation: projection.state.generation,
    backfilled: true,
  };
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return { path: summaryPath, written: true };
}

function persistTerminalizeMutationFailedEvent(ledger, projection, built, commandNow) {
  const generation = projection.latest_lease && projection.latest_lease.generation;
  const nonce = projection.latest_lease && projection.latest_lease.nonce;
  if (!Number.isSafeInteger(generation) || typeof nonce !== 'string') {
    throw new Error('campaign terminalize requires a live lease generation identity');
  }
  const payload = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_event',
    campaign_id: projection.campaign_id,
    contract_digest: projection.state.contract_digest,
    event: built.event,
    artifact_reference: null,
  };
  if (!hasExactKeys(payload, DURABLE_EVENT_ARTIFACT_KEYS) && !hasExactKeys(payload, EVENT_ARTIFACT_KEYS)) {
    throw new Error('internal terminalize event wrapper validation failed');
  }
  const result = spawnSync('bash', [
    RUN_LEDGER,
    'journal-add',
    '--ledger', path.resolve(ledger),
    '--run-id', projection.campaign_id,
    '--stage', 'campaign',
    '--generation', String(generation),
    '--nonce', nonce,
    '--idempotency-key', `terminalize:${projection.campaign_id}:${commandNow}`,
    '--op', 'campaign_event',
    '--payload', JSON.stringify(payload),
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: (64 * 1024 * 1024) + (1024 * 1024),
  });
  if (result.error || result.status !== 0) {
    throw new Error(`campaign terminalize journal append failed: ${
      result.error
        ? result.error.message
        : Buffer.from(result.stderr || '').toString('utf8').trim()
    }`);
  }
  return {
    id: built.event.idempotency_key,
    generation,
    nonce,
    status: 'applied',
  };
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
  const durableWait = DURABLE_WAIT.has(projection.state.phase);
  // boundary_rejected is always durable-resumable. Possibly-effectful candidates keep
  // candidate_ref; exact replay/no-op adoption spends no new model or gate attempt.
  const boundaryResumable = projection.state.phase === CAMPAIGN_STATES.BOUNDARY_REJECTED;
  const dispositionResumable = projection.state.phase === CAMPAIGN_STATES.AWAITING_DISPOSITION
    && Boolean(projection.state.awaiting_disposition
      && projection.state.awaiting_disposition.findings_digest);
  const resumePhaseSupported = projection.state.phase === CAMPAIGN_STATES.PREPARED
    || (projection.state.phase === CAMPAIGN_STATES.VERTICAL_VERIFICATION && hasCandidate)
    || (projection.state.phase === CAMPAIGN_STATES.ADJUDICATING
      && hasCandidate
      && hasBoundReview)
    || boundaryResumable
    || dispositionResumable
    || (durableWait && projection.state.phase
      === CAMPAIGN_STATES.AWAITING_CONVERGENCE_ADJUDICATION);
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
  if (parsed.command === 'terminalize') {
    let manifest = null;
    try {
      const rawManifest = fs.readFileSync(parsed.leafManifest, 'utf8');
      manifest = JSON.parse(rawManifest);
    } catch (_error) {
      manifest = null;
    }
    const evidence = { manifest };
    const eligibility = campaignTerminalizeEligibility(projection, evidence, now);
    if (eligibility.status === 'blocked') {
      const rejection = {
        status: 'rejected',
        reason_code: eligibility.reason_code,
        reason: eligibility.reason,
        campaign_id: parsed.campaignId,
        phase: projection.state.phase,
      };
      if (eligibility.reason_code === 'campaign_already_terminal') {
        try {
          const backfill = backfillCampaignTerminalizeSummary(parsed.ledger, projection, rows);
          rejection.summary_path = backfill.path;
          rejection.summary_backfilled = backfill.written;
        } catch (error) {
          rejection.summary_backfill_error = error.message;
        }
      }
      process.stdout.write(`${JSON.stringify(rejection)}\n`);
      return 1;
    }
    const built = buildTerminalizeMutationFailedEvent(projection, now, 'campaign dead leaf terminalization');
    try {
      const journal = persistTerminalizeMutationFailedEvent(parsed.ledger, projection, built, now);
      const summary = writeCampaignTerminalizeSummary(parsed.ledger, projection, built);
      process.stdout.write(`${JSON.stringify({
        status: 'terminalized',
        campaign_id: parsed.campaignId,
        phase: built.nextState.phase,
        generation: built.nextState.generation,
        lease_released: built.nextState.live_lease === null,
        journal,
        summary_path: summary.path,
        summary_written: summary.written,
      })}\n`);
      return EXIT_SUCCESS;
    } catch (error) {
      process.stderr.write(`campaign: ${error.message}\n`);
      return 1;
    }
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
    durable_wait: Boolean(projection.durable_wait),
    boundary_rejected: projection.boundary_rejected || null,
    awaiting_disposition: projection.awaiting_disposition || null,
    // Exact replay / no-op adoption must not spend a new model or gate attempt.
    no_op_resume_eligible: eligibility.status === 'resumable'
      && (projection.state.phase === CAMPAIGN_STATES.BOUNDARY_REJECTED
        || projection.state.phase === CAMPAIGN_STATES.AWAITING_DISPOSITION)
      && true,
    mutation_attempts_on_resume: 0,
    gate_attempts_on_resume: 0,
  })}\n`);
  return eligibility.status === 'resumable' ? EXIT_SUCCESS : 1;
}

module.exports = {
  campaignResumeEligibility,
  campaignTerminalizeEligibility,
  backfillCampaignTerminalizeSummary,
  buildTerminalizeMutationFailedEvent,
  writeCampaignTerminalizeSummary,
  DURABLE_WAIT,
  defaultCampaignLedgerPath,
  ledgerScanFiles,
  loadRows,
  parseArgs,
  TERMINAL,
  processLiveness,
  projectCampaign,
  runCampaignCli,
};
