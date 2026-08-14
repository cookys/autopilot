'use strict';

/**
 * Shadow terminal observer — the Owner Kernel forms a second opinion on task closure,
 * changes nothing, and records whether it agreed.
 *
 * WHY THIS SHAPE
 * --------------
 * The obvious implementation is to compare the kernel's verdict against `can_close` by
 * deriving the kernel's checks FROM `can_close`. That produces perfect agreement forever,
 * because it is the same conclusion restated — a tautology wearing the costume of a
 * measurement. It would populate the divergence monitor with evidence that proves nothing
 * and would read, to anyone downstream, as a validated shadow.
 *
 * So this observer builds its obligations from the RAW evidence the status aggregation
 * consumed (mission terminality, campaign terminality, acceptance verdict, integration),
 * never from the predicate it is judging. Four obligations are structurally equivalent to
 * legacy's operands and should agree; one is NOT:
 *
 *     evidence-bound-to-artifact
 *
 * Legacy closes a task on operand truth. The Owner Kernel additionally requires the
 * evidence to be bound to a named final artifact — a claim with nothing anchored to it is
 * not a completed claim. That asymmetry is the point: it is where a real divergence can
 * appear, and where the kernel's stricter contract earns or loses its keep.
 *
 * FAIL-OPEN, DELIBERATELY
 * -----------------------
 * The kernel is in shadow: legacy holds authority. So every failure here is swallowed and
 * the caller's result is returned untouched. This is the OPPOSITE of the terminal issuer's
 * fail-closed rule, and the difference is authority: a component that decides must fail
 * closed; a component that only watches must never be able to break what it watches.
 */

const { freezeChecks, issueTerminal, TERMINAL_COMPLETE } = require('../engine/owner-kernel/terminal');

const ENTRY_PATH = '/status-task';

/** Obligations derived from raw evidence, in a fixed order so the freeze hash is stable. */
function obligationsFor(taskStatus) {
  const evidence = taskStatus && typeof taskStatus === 'object' ? taskStatus : {};
  const integration = (evidence.evidence && evidence.evidence.integration) || {};
  const target = evidence.integration_target || {};

  // An artifact is "bound" when integration names a concrete merged target — a commit or
  // ref the evidence attaches to. A truthy flag with nothing named is not a binding.
  const artifactBound = Boolean(
    (typeof target.commit === 'string' && target.commit.length > 0)
    || (typeof target.sha === 'string' && target.sha.length > 0)
    || (typeof integration.merge_commit === 'string' && integration.merge_commit.length > 0),
  );

  return [
    { id: 'mission-terminal', satisfied: evidence.mission_terminal === true },
    { id: 'campaigns-terminal', satisfied: evidence.campaigns_terminal === true },
    { id: 'acceptance-accepted', satisfied: evidence.acceptance_verdict === 'accepted' },
    { id: 'product-merged', satisfied: integration.product_merged === true },
    // Kernel-only obligation. Legacy has no equivalent operand.
    { id: 'evidence-bound-to-artifact', satisfied: artifactBound },
  ];
}

/**
 * Form the shadow verdict and report it. Never throws, never mutates taskStatus.
 *
 * @param {object} taskStatus  The authoritative status result (read-only).
 * @param {object} [deps]
 * @param {function} [deps.record]  Sink for the observation; injected for testing.
 * @returns {object|null} the observation, or null when it could not be formed.
 */
function observeShadowTerminal(taskStatus, deps = {}) {
  try {
    const obligations = obligationsFor(taskStatus);
    const frozen = freezeChecks(obligations.map((o) => ({ id: o.id })));
    const terminal = issueTerminal({
      frozen,
      results: obligations.map((o) => ({ id: o.id, satisfied: o.satisfied })),
      // The artifact obligation above already decides bindingness; passing a non-empty
      // object here keeps that decision in ONE place instead of splitting it across two.
      artifact: { source: 'status-task' },
    });

    const shadowDecision = terminal.status === TERMINAL_COMPLETE ? 'close' : 'hold';
    const legacyDecision = taskStatus && taskStatus.can_close === true ? 'close' : 'hold';
    const agreed = shadowDecision === legacyDecision;

    // A divergence is only self-explaining when the kernel is stricter for a reason it can
    // name. Anything else is left unexplained on purpose — the monitor must not receive an
    // invented rationale.
    let reason = null;
    if (!agreed && shadowDecision === 'hold') {
      const kernelOnly = terminal.unsatisfied.filter((id) => id === 'evidence-bound-to-artifact');
      if (kernelOnly.length > 0 && terminal.unsatisfied.length === kernelOnly.length) {
        reason = 'kernel-only obligation unmet: evidence is not bound to a named artifact';
      }
    }

    const observation = {
      entry_path: ENTRY_PATH,
      shadow_decision: shadowDecision,
      legacy_decision: legacyDecision,
      agreed,
      reason,
      unsatisfied: terminal.unsatisfied,
      checks_hash: frozen.checks_hash,
    };

    if (typeof deps.record === 'function') deps.record(observation);
    return observation;
  } catch (_error) {
    // Shadow observation must never affect the authoritative answer.
    return null;
  }
}

module.exports = { observeShadowTerminal, obligationsFor, ENTRY_PATH };
