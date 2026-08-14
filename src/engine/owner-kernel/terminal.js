'use strict';

/**
 * The single terminal-state issuer.
 *
 * WHY THIS EXISTS
 * ---------------
 * The kernel already fails closed internally. What it cannot prevent on its own is a
 * CALLER that catches a failure and quietly completes the work through the legacy path
 * anyway — promotion would then be cosmetic, and the failure mode is invisible: the task
 * appears to succeed, so nobody investigates. A six-seat review named this as the gap
 * that makes autonomous completion untrustworthy (sol, Critical).
 *
 * So terminal state is not something a caller decides. It is computed here, from frozen
 * checks, with exactly two outcomes and no third branch:
 *
 *     every check satisfied  ->  COMPLETE
 *     anything else          ->  BLOCKED
 *
 * "Anything else" is deliberate and total: an empty check set, a tampered check set, a
 * check that threw, an exhausted repair budget, a malformed artifact binding. There is no
 * input to this module that yields neither COMPLETE nor BLOCKED, and no way to obtain
 * COMPLETE except by satisfying every frozen check.
 *
 * WHAT THIS MODULE REFUSES TO DO
 * ------------------------------
 * It never falls back. It never downgrades a BLOCKED into a warning. It never accepts a
 * caller-supplied status. A caller that wants legacy execution after a BLOCKED must make
 * that an explicit, recorded operator decision elsewhere — it cannot be reached by
 * ignoring a return value from here.
 */

const { OwnerKernelError } = require('./errors');
const { canonicalJson, sha256, cloneCanonical } = require('./canonical');

const TERMINAL_COMPLETE = 'COMPLETE';
const TERMINAL_BLOCKED = 'BLOCKED';
const CHECK_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reasons a run is blocked. Closed set — a new reason is a code change, not a string. */
const BLOCKED_REASONS = Object.freeze({
  CHECKS_UNSATISFIED: 'checks_unsatisfied',
  CHECKS_EMPTY: 'checks_empty',
  CHECKS_TAMPERED: 'checks_tampered',
  CHECK_THREW: 'check_threw',
  REPAIR_EXHAUSTED: 'repair_exhausted',
  ARTIFACT_UNBOUND: 'artifact_unbound',
});

/**
 * Freeze the check set before execution.
 *
 * The hash is what makes "every check passed" meaningful: without it, a run could satisfy
 * three checks, drop the fourth, and report completion truthfully against a set nobody
 * agreed to. Freeze at dispatch, verify at issue.
 *
 * @param {Array<{id: string, description?: string}>} checks
 * @returns {{checks: Array, checks_hash: string, frozen_at_sequence: number|null}}
 */
function freezeChecks(checks, { sequence = null } = {}) {
  if (!Array.isArray(checks)) {
    throw new OwnerKernelError('terminal checks must be an array', 'INVALID_TERMINAL_CHECKS');
  }
  const seen = new Set();
  const normalized = checks.map((check, index) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) {
      throw new OwnerKernelError(`terminal check ${index} must be an object`, 'INVALID_TERMINAL_CHECKS');
    }
    if (typeof check.id !== 'string' || !CHECK_ID_PATTERN.test(check.id)) {
      throw new OwnerKernelError(
        `terminal check ${index} needs an id matching ${CHECK_ID_PATTERN}`,
        'INVALID_TERMINAL_CHECKS',
      );
    }
    if (seen.has(check.id)) {
      throw new OwnerKernelError(
        `terminal check id "${check.id}" is duplicated; a set cannot contain the same obligation twice`,
        'INVALID_TERMINAL_CHECKS',
      );
    }
    seen.add(check.id);
    return {
      id: check.id,
      description: typeof check.description === 'string' ? check.description : '',
    };
  });
  return {
    checks: normalized,
    checks_hash: sha256(canonicalJson(normalized)),
    frozen_at_sequence: Number.isInteger(sequence) ? sequence : null,
  };
}

function blocked(reason, unsatisfied, extra = {}) {
  return cloneCanonical({
    status: TERMINAL_BLOCKED,
    reason,
    unsatisfied: unsatisfied.slice().sort(),
    accepted_artifact: null,
    ...extra,
  });
}

/**
 * Issue the terminal state for a run.
 *
 * @param {object} input
 * @param {{checks: Array, checks_hash: string}} input.frozen  From freezeChecks().
 * @param {Array<{id: string, satisfied: boolean, detail?: string}>} input.results
 *   Outcome per check. Every frozen check id must appear exactly once.
 * @param {object|null} input.artifact  The artifact the evidence is bound to. Required for
 *   COMPLETE — completion with nothing bound to it is not completion.
 * @param {number} [input.attempt]      1-based repair attempt.
 * @param {number} [input.maxAttempts]  Repair budget; exhausting it stays BLOCKED.
 * @returns {{status: 'COMPLETE'|'BLOCKED', ...}}  Never throws for a run-level failure —
 *   a failure IS a terminal state. It throws only when its own inputs are malformed,
 *   which is a programming error, not a run outcome.
 */
function issueTerminal({
  frozen,
  results,
  artifact = null,
  attempt = 1,
  maxAttempts = 1,
} = {}) {
  if (!frozen || typeof frozen !== 'object' || !Array.isArray(frozen.checks)
    || typeof frozen.checks_hash !== 'string') {
    throw new OwnerKernelError(
      'issueTerminal requires a frozen check set from freezeChecks()',
      'INVALID_TERMINAL_CHECKS',
    );
  }

  // The frozen set must still hash to what was agreed. A set that changed between freeze
  // and issue cannot fund a completion, however satisfied its members look.
  if (sha256(canonicalJson(frozen.checks)) !== frozen.checks_hash) {
    return blocked(BLOCKED_REASONS.CHECKS_TAMPERED, frozen.checks.map((c) => c.id), {
      checks_hash: frozen.checks_hash,
    });
  }

  // An empty obligation set would make COMPLETE vacuously true. Refuse it.
  if (frozen.checks.length === 0) {
    return blocked(BLOCKED_REASONS.CHECKS_EMPTY, [], { checks_hash: frozen.checks_hash });
  }

  if (!Array.isArray(results)) {
    throw new OwnerKernelError('issueTerminal requires a results array', 'INVALID_TERMINAL_RESULTS');
  }

  const byId = new Map();
  for (const result of results) {
    if (!result || typeof result !== 'object' || typeof result.id !== 'string') {
      throw new OwnerKernelError('each terminal result needs an id', 'INVALID_TERMINAL_RESULTS');
    }
    if (byId.has(result.id)) {
      throw new OwnerKernelError(
        `terminal result "${result.id}" reported twice`,
        'INVALID_TERMINAL_RESULTS',
      );
    }
    byId.set(result.id, result);
  }

  const unsatisfied = [];
  const threw = [];
  for (const check of frozen.checks) {
    const result = byId.get(check.id);
    // A check with no result is unsatisfied. Silence is not consent.
    if (!result) {
      unsatisfied.push(check.id);
      continue;
    }
    if (result.threw === true || result.error) {
      threw.push(check.id);
      unsatisfied.push(check.id);
      continue;
    }
    // Strictly true. A truthy value is not a pass — 'false', 0 and undefined would all
    // sail through a loose check, and each of those is a plausible bug in a caller.
    if (result.satisfied !== true) unsatisfied.push(check.id);
  }

  if (threw.length > 0) {
    return blocked(BLOCKED_REASONS.CHECK_THREW, unsatisfied, {
      checks_hash: frozen.checks_hash,
      threw: threw.slice().sort(),
    });
  }

  if (unsatisfied.length > 0) {
    // Repair is bounded: a caller may re-run the SAME frozen checks up to the budget.
    // Exhausting it is still BLOCKED — the budget buys retries, never leniency.
    const exhausted = Number.isInteger(attempt) && Number.isInteger(maxAttempts)
      && attempt >= maxAttempts;
    return blocked(
      exhausted ? BLOCKED_REASONS.REPAIR_EXHAUSTED : BLOCKED_REASONS.CHECKS_UNSATISFIED,
      unsatisfied,
      { checks_hash: frozen.checks_hash, attempt, max_attempts: maxAttempts, repair_available: !exhausted },
    );
  }

  // Every frozen check is satisfied. Completion additionally requires something to have
  // been completed: evidence must be bound to an artifact, or the claim is unanchored.
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)
    || Object.keys(artifact).length === 0) {
    return blocked(BLOCKED_REASONS.ARTIFACT_UNBOUND, [], { checks_hash: frozen.checks_hash });
  }

  // The ONLY place in this module that produces COMPLETE.
  return cloneCanonical({
    status: TERMINAL_COMPLETE,
    reason: null,
    unsatisfied: [],
    accepted_artifact: artifact,
    checks_hash: frozen.checks_hash,
    attempt,
  });
}

/** True only for a terminal state this module issued as COMPLETE. */
function isComplete(terminal) {
  return Boolean(terminal) && terminal.status === TERMINAL_COMPLETE;
}

module.exports = {
  TERMINAL_COMPLETE,
  TERMINAL_BLOCKED,
  BLOCKED_REASONS,
  freezeChecks,
  issueTerminal,
  isComplete,
};
