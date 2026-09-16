'use strict';

// Terminal QC seats are independently selected tuples, not aliases for the
// focused reviewer. A roster-level qualification bit therefore cannot certify
// a different runner/model/effort. The incumbent remains compatible only when
// the sealed seat is exactly that qualified tuple; every other terminal seat
// needs an exact qualified scorecard-ladder row. Path (c) is a recorded
// operator admission for that exact panel index.
const BLIND_DISCOVERY_CAPABLE_RUNNERS = Object.freeze([
  'anthropic-compatible',
  'cc-shim',
  'claude-native',
  'qoderclicn',
]);

function isBlindDiscoveryCapableRunner(runner) {
  return typeof runner === 'string' && BLIND_DISCOVERY_CAPABLE_RUNNERS.includes(runner);
}

function finalPanelSeatQualified(roster, seat, index) {
  if (!roster || !seat) return false;
  const endpoint = (value) => typeof value === 'string' && value.length > 0 ? value : null;
  const incumbent = roster.reviewer_qualified === true
    && roster.reviewer_runner === seat.runner
    && roster.reviewer_engine === seat.model
    && roster.reviewer_effort === seat.effort
    && endpoint(roster.reviewer_endpoint) === endpoint(seat.endpoint);
  if (incumbent) return true;
  if (Array.isArray(roster.override_admitted_seats)
      && Number.isInteger(index)
      && roster.override_admitted_seats.includes(`qc_panel[${index}]`)) {
    return true;
  }
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

module.exports = {
  BLIND_DISCOVERY_CAPABLE_RUNNERS,
  isBlindDiscoveryCapableRunner,
  finalPanelSeatQualified,
};
