'use strict';
/**
 * review-family-gate.js — the cross-family rule of the code-review loop, shared by
 * hetero-review-loop.js (collect, finalize, refinalize) and check-phase-review-receipt.js.
 *
 * Rule: a converged (SHIP-AS-IS) generation needs at least one REVIEWED seat whose model family differs
 * from the family of whoever wrote the diff. Reviewers of the implementer's own family share its blind
 * spots (2026-11-07: generations converged with only Claude seats on Claude-written diffs, unnoticed).
 *
 * Inputs are ledger facts only, re-derived by the checker from the chain it reads from disk:
 *   - chain entries carry `implementer_engine` (collect, required) — family is derived here, never stored;
 *   - the generation's seat records carry `engine`; reviewed status comes from the caller (the sha-verified
 *     seat artifacts in the checker, the collected seat records in finalize);
 *   - the only exception is `same_family_exception: { source, reason }` written by finalize from
 *     --same-family-exception "<source>: <reason>". No environment variable and no other flag reaches this
 *     module; AUTOPILOT_MIN_REVIEWED_SEATS and --allow-seat-gap do not skip it.
 */

const { familyOfEngine } = require('./stage-write');

const DECISION_CARD = /^d-[0-9a-f]{8}$/;
const FLEET_MESSAGE_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// "<source>: <reason>" -> { source, reason } or { error }. source = decision card id or fleet message id.
function parseException(raw) {
  if (typeof raw !== 'string') return { error: 'needs a value of the form "<source>: <reason>"' };
  const idx = raw.indexOf(':');
  if (idx === -1) return { error: 'needs a value of the form "<source>: <reason>" (no colon found)' };
  const source = raw.slice(0, idx).trim();
  const reason = raw.slice(idx + 1).trim();
  if (!DECISION_CARD.test(source) && !FLEET_MESSAGE_ULID.test(source)) {
    return { error: `source '${source}' is neither a decision card id (d-xxxxxxxx, 8 hex) nor a fleet message id (26-char ULID)` };
  }
  if (!reason) return { error: 'needs a non-empty reason after the source' };
  return { source, reason };
}

// Same validation applied to the recorded object form.
function validRecordedException(ex) {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return false;
  return typeof ex.source === 'string' && typeof ex.reason === 'string' && ex.reason.trim().length > 0
    && (DECISION_CARD.test(ex.source) || FLEET_MESSAGE_ULID.test(ex.source));
}

// Families of a comma-separated implementer engine list. unknown families are errors, never defaults.
function familiesOfImplementer(engineList) {
  const engines = String(engineList || '').split(',').map((s) => s.trim()).filter(Boolean);
  const families = engines.map((e) => familyOfEngine(e));
  return { engines, families, unknown: engines.filter((e, i) => families[i] === 'unknown') };
}

// Implementer engines recorded anywhere in the chain (collect writes them on every entry it saves).
function recordedImplementerEngines(chain) {
  const set = new Set();
  for (const e of chain || []) {
    if (e && typeof e.implementer_engine === 'string') {
      for (const x of e.implementer_engine.split(',').map((s) => s.trim()).filter(Boolean)) set.add(x);
    }
  }
  return [...set];
}

function seatFamily(seat) {
  if (!seat || typeof seat !== 'object') return 'unknown';
  const derived = familyOfEngine(seat.engine);
  if (derived !== 'unknown') return derived;
  return typeof seat.family === 'string' && seat.family ? seat.family : 'unknown';
}

/**
 * @param chain        all chain entries
 * @param entry        the generation under test
 * @param reviewedIds  Set of seat ids that really reviewed (caller-derived)
 * @returns { ok, error?, cross_family, seat_families, implementer_families, implementer_engines }
 *   ok=false only when the ledger cannot be evaluated (no implementer record / unknown implementer family).
 */
function evaluate(chain, entry, reviewedIds) {
  const engines = recordedImplementerEngines(chain);
  if (engines.length === 0) {
    return { ok: false, error: 'the chain records no implementer engine (collect --implementer-engine); the cross-family rule cannot be evaluated' };
  }
  const impl = familiesOfImplementer(engines.join(','));
  if (impl.unknown.length > 0) {
    return { ok: false, error: `implementer engine(s) ${impl.unknown.join(', ')} map to no known model family` };
  }
  const implFamilies = [...new Set(impl.families)].sort();
  const seats = Array.isArray(entry && entry.seats) ? entry.seats : [];
  const reviewedFamilies = seats
    .filter((s) => s && typeof s === 'object' && reviewedIds.has(s.id))
    .map(seatFamily);
  const seatFamilies = [...new Set(reviewedFamilies)].sort();
  const cross = reviewedFamilies.some((f) => f !== 'unknown' && !implFamilies.includes(f));
  return { ok: true, cross_family: cross, seat_families: seatFamilies, implementer_families: implFamilies, implementer_engines: engines };
}

// ---- plan review (same rule, different ledger) ------------------------------------------------------------
// The plan-review verdict READY (and the plan-mode receipt check) needs at least one REVIEWED seat whose model
// family is not the depth-0 / author family. Depth-0 here is Claude (anthropic); an unknown family never counts
// as "other". Family is derived from the seat's model/runner (the declared manifest family is only a last resort),
// never stored: dispatch-plan-review.js writes runner+model on each reviewer_verdicts entry and
// check-phase-review-receipt.js Mode B re-derives from those same bytes.
const DEPTH0_FAMILY = 'anthropic';

function planSeatFamily(seat) {
  if (!seat || typeof seat !== 'object') return 'unknown';
  for (const field of [seat.model, seat.runner]) {
    const derived = familyOfEngine(field);
    if (derived !== 'unknown') return derived;
  }
  const declared = typeof seat.family === 'string' ? seat.family : '';
  if (declared && !declared.startsWith('legacy-')) {
    const viaName = familyOfEngine(declared);
    return viaName !== 'unknown' ? viaName : declared;
  }
  return 'unknown';
}

/** @param reviewedSeats seats that really reviewed ({runner, model, family}) */
function evaluatePlan(reviewedSeats) {
  const fams = (reviewedSeats || []).map(planSeatFamily);
  return {
    cross_family: fams.some((f) => f !== 'unknown' && f !== DEPTH0_FAMILY),
    seat_families: [...new Set(fams)].sort(),
    depth0_family: DEPTH0_FAMILY,
  };
}

// A consult result (scripts/dispatch-consult.sh: role "consult", same_family_opinion true when the consult seat is
// Claude-family, incl. the claude-native fallback) is advice, never a review seat. check-phase-review-receipt.js Mode A
// refuses a seat artifact that is one; a review seat artifact is `status: "reviewed"` from dispatch-review.sh, which a
// consult result (status "advised") can never be.
function isConsultResult(seat) {
  return !!seat && typeof seat === 'object' && (seat.role === 'consult' || seat.same_family_opinion === true);
}

function warningFor(res) {
  return {
    code: 'no_cross_family_seat',
    seat_families: res.seat_families,
    implementer_families: res.implementer_families,
  };
}

module.exports = { isConsultResult, DEPTH0_FAMILY, planSeatFamily, evaluatePlan, parseException, validRecordedException, familiesOfImplementer, recordedImplementerEngines, seatFamily, evaluate, warningFor };
