'use strict';

// BL-0146 D3: explicit closure of prior open findings on an incremental return (plan 2.5).
// Pure function over normalized seat results. Silence never closes: a finding closes only when
// EVERY sealed-panel seat explicitly answers resolved|invalid with path:line evidence and none says
// still_present. A null seat entry (absent / no verdict) or a seat that omits the id keeps it open.

const OPEN = 'open';
const CLOSED_RESOLVED = 'closed_resolved';
const CLOSED_INVALID = 'closed_invalid';

function seatAnswer(result, findingId) {
  if (!result || result.status !== 'normalized' || !Array.isArray(result.resolutions)) return null;
  const entry = result.resolutions.find((item) => item.finding_id === findingId);
  if (!entry || entry.addressed !== true) return null;
  return entry.status;
}

/**
 * @param {string[]} priorFindingIds
 * @param {Object<string, object|null>} seats seat id -> normalizeSeatReview result (null = absent)
 *   for EVERY seat of the sealed panel
 * @param {number} quorum sealed panel quorum
 * @returns {Array<{finding_id, state, invalid_seats, reason}>}
 */
function evaluateClosure(priorFindingIds, seats, quorum) {
  const seatIds = Object.keys(seats);
  const reviewing = seatIds.filter((id) => seats[id] && seats[id].status === 'normalized');
  return priorFindingIds.map((findingId) => {
    const answers = seatIds.map((id) => [id, seatAnswer(seats[id], findingId)]);
    const open = (reason) => ({ finding_id: findingId, state: OPEN, invalid_seats: [], reason });
    if (seatIds.length === 0 || reviewing.length < quorum) return open('below_quorum');
    if (answers.some(([, status]) => status === 'still_present')) return open('still_present');
    if (answers.some(([, status]) => status === null)) return open('not_addressed_by_every_seat');
    const invalidSeats = answers.filter(([, status]) => status === 'invalid').map(([id]) => id);
    if (invalidSeats.length === answers.length) {
      return { finding_id: findingId, state: CLOSED_INVALID, invalid_seats: invalidSeats, reason: null };
    }
    return { finding_id: findingId, state: CLOSED_RESOLVED, invalid_seats: invalidSeats, reason: null };
  });
}

/**
 * Interface point for the spec addendum that would carry prior open findings to a seat (plan 2.5).
 * Pending owner ruling d-3cf4dc4c (whether prior findings go to seats at all): until that is decided
 * this never produces an addendum, whatever the input, and the engine does not call it. The enabled
 * path is intentionally not implemented here.
 */
function buildPriorRoundAddendum(_priorFindings, options = {}) {
  if (options.enabled !== true) return '';
  throw new Error('prior-round addendum is not implemented: pending owner decision d-3cf4dc4c');
}

module.exports = {
  OPEN,
  CLOSED_RESOLVED,
  CLOSED_INVALID,
  evaluateClosure,
  buildPriorRoundAddendum,
};
