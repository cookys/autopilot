'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CAMPAIGN_STATES,
  canonicalDigest,
  reduceCampaignState,
  validateInitialCampaignState,
} = require('../engine/implementation-campaign');

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
  if (!new Set(['inspect', 'resume']).has(command)) {
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

function loadRows(ledger) {
  const bytes = fs.readFileSync(ledger);
  if (bytes.length > 64 * 1024 * 1024) throw new Error('campaign ledger exceeds 64 MiB');
  const lines = bytes.toString('utf8').split('\n').filter((line) => line.trim() !== '');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`campaign ledger line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
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
  if (intakes.length !== 1) {
    throw new Error('campaign ledger must contain exactly one intake root');
  }
  const [intake] = intakes;
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
    if (!hasExactKeys(payload, EVENT_ARTIFACT_KEYS)
        || payload.schema_version !== 1
        || payload.artifact_type !== 'implementation_campaign_event'
        || payload.campaign_id !== campaignId
        || payload.contract_digest !== state.contract_digest) {
      throw new Error('campaign ledger contains an invalid event wrapper binding');
    }
    validateCampaignJournalLease(row, currentLease);
    state = reduceCampaignState(state, payload.event);
  }
  return {
    schema_version: 1,
    campaign_id: campaignId,
    initial_state: intakePayload.initial_state,
    state,
    latest_lease: latestLease,
    durable_event_count: state.event_count,
    ledger_row_count: owned.length,
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

function runCampaignCli(argv, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const parsed = parseArgs(argv, cwd);
  if (parsed.error) {
    process.stderr.write(`campaign: ${parsed.error}\n`);
    return 2;
  }
  let projection;
  try {
    projection = projectCampaign(loadRows(parsed.ledger), parsed.campaignId);
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
  let status = 'resumable';
  let reason = null;
  const liveness = processLiveness(projection.latest_lease);
  if (TERMINAL.has(projection.state.phase)) {
    status = 'terminal';
    reason = 'campaign is already terminal';
  } else if (liveness === 'alive') {
    status = 'blocked';
    reason = 'campaign already has a live lease';
  } else if (liveness === 'unknown') {
    status = 'blocked';
    reason = 'campaign lease liveness cannot be verified';
  }
  process.stdout.write(`${JSON.stringify({
    status,
    reason,
    campaign_id: parsed.campaignId,
    contract_digest: projection.state.contract_digest,
    phase: projection.state.phase,
    generation: projection.state.generation,
    resume_required: status === 'resumable',
  })}\n`);
  return status === 'resumable' ? EXIT_SUCCESS : 1;
}

module.exports = {
  defaultCampaignLedgerPath,
  loadRows,
  parseArgs,
  processLiveness,
  projectCampaign,
  runCampaignCli,
};
