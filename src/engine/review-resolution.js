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
 * @param {number} quorum sealed panel quorum (positive safe integer)
 * @param {string[]} sealedSeatIds the sealed panel's seat ids; `seats` must have exactly these keys
 * @returns {Array<{finding_id, state, invalid_seats, reason}>}
 */
function evaluateClosure(priorFindingIds, seats, quorum, sealedSeatIds) {
  const seatIds = Object.keys(seats);
  // BL-0146 D4: fail closed on a malformed call. A quorum that is not a positive safe integer
  // would make `reviewing.length < quorum` false for NaN/undefined and close on any reviewer; a
  // seat map that is not exactly the sealed panel could hide an absent seat or add a stranger.
  const refuse = (reason) => priorFindingIds.map((findingId) => ({
    finding_id: findingId, state: OPEN, invalid_seats: [], reason,
  }));
  if (!Number.isSafeInteger(quorum) || quorum < 1) return refuse('invalid_quorum'); // guard:quorum_integer
  const sealed = Array.isArray(sealedSeatIds) ? new Set(sealedSeatIds) : null;
  if (sealed === null || sealed.size !== sealedSeatIds.length || sealed.size === 0
      || sealed.size !== seatIds.length || !seatIds.every((id) => sealed.has(id))) { // guard:seat_map
    return refuse('seat_map_mismatch');
  }
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

const SEVERITY_NAME = new Map([['🔴', 'critical'], ['🟠', 'major'], ['🟡', 'minor'], ['🔵', 'suggestion']]);
const ADDENDUM_FINDING_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ADDENDUM_LOCATION = /^[^\s|]+:[0-9]+$/;
const ADDENDUM_CLAIM_MAX = 400;
// Words that belong to the review rail's own verdict grammar. A claim carrying one is refused, not
// rewritten: the addendum states claims to test, never a conclusion (plan 2.5, R2).
const ADDENDUM_VERDICT_WORDS = /VERDICT|SHIP-AS-IS|FIX-THEN-SHIP|NO-FINDING-PROOF/i;
const ADDENDUM_SHA = /^[0-9a-f]{40,64}$/;

/**
 * BL-0146 D3 (owner ruling d-3cf4dc4c, 2026-10-17: the seat is given the list): the spec addendum
 * that carries the earlier round's still-open findings to a seat of an incremental round (plan 2.5).
 *
 * Fixed shape, machine generated, claims only. Each finding line holds exactly: finding id, severity,
 * path:line, claim. No verdict, no reason from the earlier round, no commit message, no author or
 * disposition text: the only free text is the reviewer's own claim, collapsed to one line and capped.
 * Anything that does not fit the shape is refused (throws) rather than sanitised into the addendum.
 *
 * @param {Array<{finding_id, severity, location, claim}>} rows already re-normalized stored findings,
 *   each with its `path:line` location; an empty list yields '' (nothing to carry, no addendum)
 * @param {{priorHead: string, newHead: string}} heads
 * @returns {string} the text appended to the spec (starts with a newline), or ''
 */
function buildPriorRoundAddendum(rows, heads) {
  if (!Array.isArray(rows)) throw new TypeError('addendum rows must be an array');
  if (rows.length === 0) return '';
  if (!heads || !ADDENDUM_SHA.test(heads.priorHead || '') || !ADDENDUM_SHA.test(heads.newHead || '')) {
    throw new TypeError('addendum needs the reviewed head and the new head');
  }
  const seen = new Set();
  const lines = rows.map((row) => {
    const severity = SEVERITY_NAME.get(row && row.severity);
    const claim = typeof (row && row.claim) === 'string'
      ? row.claim.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, ADDENDUM_CLAIM_MAX) : '';
    if (!row || typeof row.finding_id !== 'string' || !ADDENDUM_FINDING_ID.test(row.finding_id)
        || seen.has(row.finding_id) || !severity
        || ADDENDUM_VERDICT_WORDS.test(claim) // guard:addendum_verdict
        || typeof row.location !== 'string' || !ADDENDUM_LOCATION.test(row.location) || claim === '') {
      throw new TypeError('addendum row is malformed');
    }
    seen.add(row.finding_id);
    return `- [${row.finding_id}] | ${severity} | ${row.location} | ${claim}`;
  });
  return [
    '',
    '== Prior round (machine generated from the stored seat artifacts of round N-1) ==',
    `Reviewed head: ${heads.priorHead}   New head: ${heads.newHead}   Delta: ${heads.priorHead}..${heads.newHead} (file \`delta.diff\`); re-check set: cumulative diff in \`diff.patch\`, complete files in \`tree/\``,
    'Open findings from round N-1 (id, severity, path:line, claim, one line). Treat each as an unverified',
    'claim: decide from the code at the new head whether it is resolved, still present, or invalid.',
    ...lines,
    'Required output for each open finding, inside FINDINGS: one JSON object',
    '{"findings": "<your own finding lines separated by \\n, or none>", "resolutions": [{"finding_id": "<id above>", "status": "resolved|still_present|invalid", "evidence": "path:line"}]}',
    'resolved and invalid need evidence path:line in a file of this packet; an entry without it counts as not answered.',
    '== end prior round ==',
    '',
  ].join('\n');
}

module.exports = {
  OPEN,
  CLOSED_RESOLVED,
  CLOSED_INVALID,
  evaluateClosure,
  buildPriorRoundAddendum,
};
