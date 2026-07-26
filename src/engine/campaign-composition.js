'use strict';

const { canonicalDigest } = require('./campaign-verification');

class CampaignCompositionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CampaignCompositionError';
    this.code = code;
  }
}

function requireAdapter(adapters, name) {
  if (typeof adapters[name] !== 'function') {
    throw new CampaignCompositionError('ADAPTER_MISSING', `campaign adapter "${name}" is required`);
  }
  return adapters[name];
}

function requireReceipt(receipt, label) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new CampaignCompositionError('INVALID_RECEIPT', `${label} must return a receipt object`);
  }
  return receipt;
}

function blocked(phase, reason, trace, detail = {}) {
  return {
    status: 'blocked',
    phase,
    reason,
    trace,
    final_panel_count: 0,
    ...detail,
  };
}

function runCampaignComposition(input = {}, adapters = {}) {
  const maxRepairs = input.maxRepairGenerations;
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new CampaignCompositionError(
      'INVALID_REPAIR_CAP',
      'maxRepairGenerations must be a non-negative safe integer',
    );
  }
  const preflight = requireAdapter(adapters, 'preflight');
  const implement = requireAdapter(adapters, 'implement');
  const scopeCheck = requireAdapter(adapters, 'scopeCheck');
  const verify = requireAdapter(adapters, 'verify');
  const review = requireAdapter(adapters, 'review');
  const adjudicate = requireAdapter(adapters, 'adjudicate');
  const convergence = requireAdapter(adapters, 'convergence');
  const finalPanel = requireAdapter(adapters, 'finalPanel');

  const trace = [];
  const followUps = [];
  const followUpDigests = new Set();
  let repairGeneration = 0;
  let candidate = null;
  let verification = null;
  let lastReview = null;

  const retainFollowUps = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      const digest = canonicalDigest(item);
      if (followUpDigests.has(digest)) continue;
      followUpDigests.add(digest);
      followUps.push(item);
    }
  };

  const gate = requireReceipt(preflight(), 'preflight');
  trace.push('preflight');
  if (gate.passed !== true) return blocked('preflight', gate.reason || 'preflight rejected', trace);

  const mutate = (kind, repairFindingIds = []) => {
    const mutation = requireReceipt(implement({
      kind,
      repair_generation: repairGeneration,
      repair_finding_ids: repairFindingIds,
      previous_candidate: candidate,
    }), 'implement');
    trace.push(kind === 'initial' ? 'implement' : 'repair');
    if (mutation.committed !== true) {
      return {
        stop: blocked(
          mutation.phase || 'implementation',
          mutation.reason || 'mutation failed',
          trace,
        ),
      };
    }
    candidate = mutation;
    const scope = requireReceipt(scopeCheck({
      checkpoint: kind === 'initial' ? 'after_initial_mutation' : 'after_repair_mutation',
      candidate,
      repair_generation: repairGeneration,
    }), 'scopeCheck');
    trace.push('scope_after_mutation');
    if (scope.passed !== true) {
      return { stop: blocked('scope', scope.reason || 'scope gate tripped', trace, { candidate }) };
    }
    return { stop: null };
  };

  let mutationResult = mutate('initial');
  if (mutationResult.stop) return mutationResult.stop;

  for (;;) {
    verification = requireReceipt(verify({
      candidate,
      repair_generation: repairGeneration,
    }), 'verify');
    trace.push('verify');
    if (verification.passed !== true) {
      if (repairGeneration >= maxRepairs) {
        return blocked(
          'vertical_verification',
          'vertical acceptance absent at repair ceiling',
          trace,
          { candidate, verification, repair_generations: repairGeneration },
        );
      }
      const beforeRepair = requireReceipt(scopeCheck({
        checkpoint: 'before_repair',
        candidate,
        repair_generation: repairGeneration,
      }), 'scopeCheck');
      trace.push('scope_before_repair');
      if (beforeRepair.passed !== true) {
        return blocked('scope', beforeRepair.reason || 'pre-repair scope gate tripped', trace);
      }
      const receipt = requireReceipt(convergence({
        repair_generation: repairGeneration,
        next_repair_generation: repairGeneration + 1,
        reason: 'vertical_acceptance',
      }), 'convergence');
      trace.push('convergence');
      if (receipt.passed !== true) {
        return blocked('convergence', receipt.reason || 'convergence gate tripped', trace);
      }
      repairGeneration += 1;
      mutationResult = mutate('vertical_repair', ['vertical-acceptance']);
      if (mutationResult.stop) return mutationResult.stop;
      continue;
    }

    lastReview = requireReceipt(review({
      candidate,
      verification,
      repair_generation: repairGeneration,
      scope: 'focused',
    }), 'review');
    trace.push('focused_review');
    if (lastReview.reviewed !== true) {
      return blocked(
        lastReview.phase || 'focused_review',
        lastReview.reason || 'focused review unavailable',
        trace,
      );
    }
    const adjudication = requireReceipt(adjudicate({
      review: lastReview,
      repair_generation: repairGeneration,
      final: false,
    }), 'adjudicate');
    trace.push('adjudicate');
    if (adjudication.registry_complete !== true) {
      return blocked('adjudication', adjudication.reason || 'finding registry is incomplete', trace);
    }
    retainFollowUps(adjudication.follow_up);
    const mustFix = Array.isArray(adjudication.must_fix_now)
      ? adjudication.must_fix_now
      : [];
    if (mustFix.length === 0) break;
    if (adjudication.repair_gate_passed !== true) {
      return blocked('repair_gate', 'must-fix findings did not pass repair-gate', trace);
    }
    if (repairGeneration >= maxRepairs) {
      return blocked(
        'repair_budget',
        'must-fix findings remain at repair ceiling',
        trace,
        { must_fix_now: mustFix },
      );
    }
    const beforeRepair = requireReceipt(scopeCheck({
      checkpoint: 'before_repair',
      candidate,
      repair_generation: repairGeneration,
    }), 'scopeCheck');
    trace.push('scope_before_repair');
    if (beforeRepair.passed !== true) {
      return blocked('scope', beforeRepair.reason || 'pre-repair scope gate tripped', trace);
    }
    const receipt = requireReceipt(convergence({
      repair_generation: repairGeneration,
      next_repair_generation: repairGeneration + 1,
      reason: 'review_findings',
      must_fix_now: mustFix,
    }), 'convergence');
    trace.push('convergence');
    if (receipt.passed !== true) {
      return blocked('convergence', receipt.reason || 'convergence gate tripped', trace);
    }
    repairGeneration += 1;
    mutationResult = mutate('review_repair', mustFix.map((finding) => finding.id));
    if (mutationResult.stop) return mutationResult.stop;
  }

  const beforeAcceptance = requireReceipt(scopeCheck({
    checkpoint: 'before_acceptance',
    candidate,
    repair_generation: repairGeneration,
  }), 'scopeCheck');
  trace.push('scope_before_acceptance');
  if (beforeAcceptance.passed !== true) {
    return blocked('scope', beforeAcceptance.reason || 'acceptance scope gate tripped', trace);
  }
  const convergenceReceipt = requireReceipt(convergence({
    repair_generation: repairGeneration,
    next_repair_generation: null,
    reason: 'acceptance',
  }), 'convergence');
  trace.push('convergence');
  if (convergenceReceipt.passed !== true) {
    return blocked('convergence', convergenceReceipt.reason || 'convergence gate tripped', trace);
  }

  const terminalReview = requireReceipt(finalPanel({
    candidate,
    verification,
    focused_review: lastReview,
    repair_generation: repairGeneration,
  }), 'finalPanel');
  trace.push('final_panel');
  if (terminalReview.reviewed !== true) {
    return blocked('final_panel', terminalReview.reason || 'final panel unavailable', trace);
  }
  const finalAdjudication = requireReceipt(adjudicate({
    review: terminalReview,
    repair_generation: repairGeneration,
    final: true,
  }), 'adjudicate');
  trace.push('final_adjudicate');
  if (finalAdjudication.registry_complete !== true) {
    return blocked('final_adjudication', 'final finding registry is incomplete', trace);
  }
  retainFollowUps(finalAdjudication.follow_up);
  const finalMustFix = Array.isArray(finalAdjudication.must_fix_now)
    ? finalAdjudication.must_fix_now
    : [];
  const status = finalMustFix.length === 0 ? 'ready' : 'follow_up';
  const receiptBody = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_terminal',
    status,
    candidate_tree_sha: candidate.tree_sha,
    verification_receipt_digest: verification.receipt_digest,
    repair_generations: repairGeneration,
    final_panel_count: 1,
    follow_up: followUps,
    unresolved_final_findings: finalMustFix,
    trace,
  };
  return {
    ...receiptBody,
    receipt_digest: canonicalDigest(receiptBody),
  };
}

module.exports = {
  CampaignCompositionError,
  runCampaignComposition,
};
