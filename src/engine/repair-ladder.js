'use strict';
// Repair ladder (P6D corrective gate KR3, plan R2' 2026-08-21).
//
// The failure class this closes: a campaign gate rejects a candidate
// (BOUNDARY_REJECTED, candidate preserved), and the controller's next move is
// WORKFLOW EXPANSION — formal failure terminalization, Mission successor,
// abort finalization — instead of the minute-scale local artifact repair the
// durable-wait resume path already offers. Measured cost: the 2026-08-21 P6D
// incident (docs/projects/2026-08-21-p6d-orchestration-incident/).
//
// Shape rules (G2-adjudicated):
//   * The FIRST observation of a boundary rejection is never gated — recording
//     evidence is not expansion. The gate fires only when a campaign ADMITTED
//     in BOUNDARY_REJECTED (initial_state.phase) with a preserved candidate is
//     being converted to a terminal, or when Mission claims carrying an
//     unreleased repair lock are drained/aborted/succeeded.
//   * Repair evidence = the failed gate RERAN: a later outcome whose verdict
//     changed (ready/follow_up), or named extras strictly shrank against the
//     recorded prior failure (slice-2 precision path).
//   * Bypass = ENGINE-DERIVED terminal evidence only (closed enum below).
//     Controller-supplied reasons/free text NEVER satisfy the predicate; they
//     may attach for audit.
//   * No P6D constants. Without a boundary every helper is a no-op — zero
//     behavior change for unaffected flows.
//   * STATELESS by ruling of the 2026-08-21 pre-merge review: the durable
//     claim-bound lock variant shipped here first and was killed as a 🔴 —
//     its release path was unreachable in production, making the lock a
//     permanent Mission deadlock ("a lock with no reachable unlock is a worse
//     failure mode than the expansion it prevents"). The refusal at the
//     terminalization edge carries the whole gate; re-introducing durable
//     state requires the release-path design first (BACKLOG).

const ENGINE_TERMINAL_BYPASS = Object.freeze(new Set([
  'wall_budget_exhausted',
  'deadline_exhausted',
  'timeout',
  'unavailable',
  'interrupted',
]));

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

// Boundary evidence extracted from campaign durable state (initial_state at
// admission) — the compared-against side of every receipt.
function extractBoundaryEvidence(initialState) {
  if (!isObj(initialState)) return null;
  if (initialState.phase !== 'BOUNDARY_REJECTED') return null;
  const boundary = isObj(initialState.boundary_rejected)
    ? initialState.boundary_rejected
    : null;
  const candidateRef = (boundary && (boundary.candidate_ref || boundary.commit)) || null;
  if (!isStr(candidateRef)) return null; // nothing repairable preserved
  // Field mapping follows the DURABLE state shape the reducer actually writes
  // ({reason, candidate_ref, receipt_digest} — implementation-campaign.js):
  // reason → boundary_reason, receipt_digest → failure_output_sha256. The
  // named-extras strict-shrink branch stays future-only until the slice-2
  // structured-extras spine lands (fields absent today → branch inert).
  return Object.freeze({
    candidate_ref: candidateRef,
    boundary_code: (boundary && (boundary.boundary_code || boundary.code)) || 'scope_or_budget_boundary',
    boundary_reason: (boundary && (boundary.boundary_reason || boundary.reason)) || null,
    failure_output_sha256: (boundary
      && (boundary.failure_output_sha256 || boundary.receipt_digest)) || null,
    named_extras: Array.isArray(boundary && boundary.named_extras)
      ? Object.freeze([...boundary.named_extras].sort())
      : null,
  });
}

function strictSubset(after, before) {
  if (!Array.isArray(after) || !Array.isArray(before)) return false;
  const beforeSet = new Set(before);
  return after.length < before.length && after.every((p) => beforeSet.has(p));
}

// rerun: { outcome, named_extras?, prior_failure_output_sha256? }
function rerunRepairs(boundary, rerun) {
  if (!isObj(boundary) || !isObj(rerun)) return false;
  if (rerun.outcome === 'ready' || rerun.outcome === 'follow_up') return true; // verdict changed
  if (Array.isArray(rerun.named_extras) && Array.isArray(boundary.named_extras)) {
    if (isStr(boundary.failure_output_sha256)
        && rerun.prior_failure_output_sha256 !== boundary.failure_output_sha256) {
      return false; // unbound rerun cannot claim the shrink
    }
    return strictSubset(rerun.named_extras, boundary.named_extras);
  }
  return false;
}

// terminalEvidence: { source: 'engine', classification } — callers may ONLY
// construct this from engine-computed states, never from argv/controller text.
function engineTerminalBypass(terminalEvidence) {
  return isObj(terminalEvidence)
    && terminalEvidence.source === 'engine'
    && ENGINE_TERMINAL_BYPASS.has(terminalEvidence.classification);
}

function refusal(boundary, context) {
  return Object.freeze({
    ok: false,
    code: 'MISSION_REPAIR_REQUIRED',
    reason: `${context}: candidate ${boundary.candidate_ref} was boundary-rejected `
      + `(${boundary.boundary_code}) and no repair attempt has been made`,
    remedy: 'cheapest local repair: resume the SAME campaign (durable-wait resume '
      + 'preserves the candidate), fix the artifact (e.g. amend the commit), and rerun '
      + 'the failed gate. Workflow expansion unlocks only after a rerun whose verdict '
      + 'changed or whose named extras strictly shrank.',
    boundary,
  });
}

// The single predicate every edge consults.
function evaluateRepairLadder({ boundary, rerun = null, terminalEvidence = null, context = 'repair ladder' }) {
  if (!isObj(boundary)) return Object.freeze({ ok: true, reason: 'no boundary evidence' });
  if (engineTerminalBypass(terminalEvidence)) {
    return Object.freeze({ ok: true, reason: `engine terminal bypass: ${terminalEvidence.classification}` });
  }
  if (rerunRepairs(boundary, rerun)) {
    return Object.freeze({ ok: true, reason: 'repair receipt satisfied' });
  }
  return refusal(boundary, context);
}

module.exports = {
  ENGINE_TERMINAL_BYPASS,
  evaluateRepairLadder,
  extractBoundaryEvidence,
};
