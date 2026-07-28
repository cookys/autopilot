'use strict';

const TERMINAL = new Set([
  'TERMINAL_READY',
  'TERMINAL_FOLLOW_UP',
  'TERMINAL_STOP',
]);
const COMPLETED = new Set([
  'committed',
  'reviewed',
  'verified',
  'merged',
]);
const FAILED = new Set([
  'stale_ignored',
  'quarantined',
  'dead',
]);
const NONLIVE = new Set([...COMPLETED, ...FAILED]);

function latestLeafStages(rows, campaignId) {
  const latest = new Map();
  for (const row of rows) {
    if (!row || row.kind !== 'stage' || row.run_id !== campaignId
        || row.stage === 'campaign' || typeof row.stage !== 'string') {
      continue;
    }
    latest.delete(row.stage);
    latest.set(row.stage, row);
  }
  return [...latest.values()];
}

function defaultLeaseLiveness(lease) {
  if (!lease || NONLIVE.has(lease.state)) return 'dead';
  return lease.state === 'leased' ? 'unknown' : 'unknown';
}

function projectCampaignStatus(projection, rows = [], observedAt, options = {}) {
  if (!projection || !projection.state) {
    throw new Error('campaign status requires a durable campaign projection');
  }
  const state = projection.state;
  const liveness = typeof options.processLiveness === 'function'
    ? options.processLiveness
    : defaultLeaseLiveness;
  const leafStages = latestLeafStages(rows, state.campaign_id);
  const campaignLiveness = liveness(projection.latest_lease);
  const leafSnapshots = leafStages.map((row) => ({ row, liveness: liveness(row) }));
  const liveLeaves = leafSnapshots.filter((item) => item.liveness === 'alive');
  const unknownLeaves = leafSnapshots.filter((item) => item.liveness === 'unknown');
  const deadLeaves = leafSnapshots.filter((item) => (
    FAILED.has(item.row.state)
    || (item.row.state === 'leased' && item.liveness === 'dead')
  ));
  const terminal = TERMINAL.has(state.phase);
  let activity;
  const campaignLeaseCompleted = projection.latest_lease
    && COMPLETED.has(projection.latest_lease.state);
  if (campaignLiveness === 'alive' || liveLeaves.length > 0) activity = 'active';
  else if (terminal && campaignLeaseCompleted) activity = 'completed';
  else if (terminal) activity = 'dead';
  else if (state.phase === 'PREPARED' && state.event_count === 0) activity = 'idle';
  else activity = 'dead';

  const observed = Date.parse(observedAt);
  const started = Date.parse(state.started_at);
  const elapsed = Number.isFinite(observed) && Number.isFinite(started) && observed >= started
    ? Math.floor((observed - started) / 1000)
    : state.limits.max_wall_seconds;
  const baseline = state.limits.baseline_churn;
  const ratio = Number.isFinite(baseline) && baseline > 0
    ? Number((state.usage.churn / baseline).toFixed(4))
    : null;
  return {
    schema_version: 1,
    artifact_type: 'implementation_campaign_status',
    campaign_id: state.campaign_id,
    ticket: state.ticket,
    profile: state.profile,
    phase: state.phase,
    activity,
    generation: state.generation,
    repair_generations_remaining: Math.max(
      0,
      state.limits.max_repair_generations - state.generation,
    ),
    wall_seconds_remaining: Math.max(0, state.limits.max_wall_seconds - elapsed),
    growth: {
      files: state.usage.changed_files,
      churn: state.usage.churn,
      ratio,
    },
    last_artifact: state.last_output_artifact_digest || null,
    terminal_reason: state.terminal_reason,
    lifecycle_receipt_ref: terminal
      ? (projection.lifecycle_receipt_ref || 'unknown')
      : null,
    leaf_runs: {
      total: leafStages.length,
      live: liveLeaves.length,
      completed: leafSnapshots.filter((item) => COMPLETED.has(item.row.state)).length,
      dead: deadLeaves.length,
      unknown: unknownLeaves.length,
      latest_stage: leafStages.length > 0 ? leafStages.at(-1).stage : null,
    },
  };
}

module.exports = {
  latestLeafStages,
  projectCampaignStatus,
};
