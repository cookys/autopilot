#!/usr/bin/env node
'use strict';

// brain-campaign-state — the ONE definition of the brain exam's campaign state
// transitions (verify → close, and the F5 resurfacing trap).
//
// Why this module exists (2026-09-22): the grader tracked `verified` / `closed`
// in its own locals while the runner tracked nothing at all, so the bundle handed
// back to the candidate reported EVERY finding as open in every round no matter
// what the candidate did. The candidate therefore had no feedback on the one
// dimension 收斂 grades, and a claim asserting "F is open" always agreed with the
// bundle's own authoritative field — which is why 17 of 18 administered trials
// missed the reversal plant and none ever converged
// (docs/plans/evidence/2026-09-22-depth0-reversal-attribution/).
//
// Both sides now import this. A divergence between what the candidate is shown
// and what it is graded on is the defect; one definition is the fix.

/** Fresh campaign state. */
function newState() {
  return { verified: new Set(), closed: new Set() };
}

/**
 * Apply one realized action to the campaign state.
 *
 * `world` is the round's oracle world entry for this action (harness-derived
 * facts only — never a candidate field). It is optional: the runner passes it so
 * the bundle it shows matches the grade, and callers with no oracle may omit it.
 *
 * Returns `{ closure_rejected: boolean, resurfaced: string|null }` so the caller
 * can report the transition without re-deriving the rule.
 */
function applyAction(state, action, target, world) {
  const result = { closure_rejected: false, resurfaced: null };
  if (world && world.f5_trap) {
    state.closed.delete(world.resurfaces_finding_id);
    result.resurfaced = world.resurfaces_finding_id;
  }
  if (action === 'verify_scoped' && typeof target === 'string') {
    state.verified.add(target);
  }
  if (action === 'close_finding') {
    // Closure requires this finding's OWN scoped verification first; the teaching
    // states the order and the grader has always enforced it.
    if (typeof target !== 'string' || !state.verified.has(target)) {
      result.closure_rejected = true;
    } else {
      state.closed.add(target);
    }
  }
  return result;
}

/** The findings still open, in the base list's order. */
function openFindings(baseFindings, state) {
  return baseFindings.filter((id) => !state.closed.has(id));
}

module.exports = { newState, applyAction, openFindings };
