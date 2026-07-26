'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CAMPAIGN_STATES,
  reduceCampaignState,
} = require('../engine/implementation-campaign');

const TERMINAL = new Set([
  CAMPAIGN_STATES.TERMINAL_READY,
  CAMPAIGN_STATES.TERMINAL_FOLLOW_UP,
  CAMPAIGN_STATES.TERMINAL_STOP,
]);
const EXIT_SUCCESS = 0;

function parseArgs(argv, cwd) {
  const command = argv[0];
  if (!new Set(['inspect', 'resume']).has(command)) {
    return { error: `unknown campaign subcommand: ${command || '<missing>'}` };
  }
  const output = {
    command,
    campaignId: null,
    ledger: path.join(cwd, '.autopilot', 'run-ledger.jsonl'),
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

function projectCampaign(rows, campaignId) {
  const owned = rows.filter((row) => row && row.run_id === campaignId);
  const intake = owned.find((row) => {
    const payload = parsePayload(row);
    return row.kind === 'journal'
      && row.op === 'campaign_intake'
      && payload
      && payload.artifact_type === 'implementation_campaign_intake';
  });
  if (!intake) return null;
  const intakePayload = parsePayload(intake);
  let state = intakePayload.initial_state;
  for (const row of owned) {
    const payload = parsePayload(row);
    if (row.kind !== 'journal'
        || row.op !== 'campaign_event'
        || !payload
        || payload.artifact_type !== 'implementation_campaign_event') {
      continue;
    }
    state = reduceCampaignState(state, payload.event);
  }
  const stageRows = owned.filter((row) => row.kind === 'stage' && row.stage === 'campaign');
  return {
    schema_version: 1,
    campaign_id: campaignId,
    state,
    latest_lease: stageRows.length > 0 ? stageRows[stageRows.length - 1] : null,
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
  if (!lease || lease.state !== 'leased' || !Number.isInteger(lease.pid) || lease.pid <= 0) {
    return 'dead';
  }
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
  loadRows,
  parseArgs,
  processLiveness,
  projectCampaign,
  runCampaignCli,
};
