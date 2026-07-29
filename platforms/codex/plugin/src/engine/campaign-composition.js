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

const FINAL_PANEL_SEAT_KEYS = [
  'schema_version',
  'artifact_type',
  'seat_index',
  'runner',
  'model',
  'effort',
  'endpoint',
  'family',
  'status',
  'verdict',
  'review_digest',
  'reason',
  'receipt_digest',
];
const FINAL_PANEL_FAILURE_STATUSES = new Set([
  'no_verdict',
  'transport_failed',
  'parser_failed',
  'precondition_failed',
]);

function hasExactKeys(value, keys) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validateFinalPanelReceipt(receipt, expectedMinimum) {
  const detail = {
    sealed_min_panel_size: expectedMinimum,
    final_panel_count: 0,
    final_panel_seat_receipts: Array.isArray(receipt?.final_panel_seat_receipts)
      ? receipt.final_panel_seat_receipts
      : [],
  };
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.sealed_min_panel_size !== expectedMinimum
      || !Array.isArray(receipt.final_panel_seat_receipts)) {
    return { passed: false, reason: 'final_panel_metadata_incomplete', ...detail };
  }
  const tuples = new Set();
  let firstFailure = null;
  for (const seat of receipt.final_panel_seat_receipts) {
    if (!hasExactKeys(seat, FINAL_PANEL_SEAT_KEYS)
        || seat.schema_version !== 1
        || seat.artifact_type !== 'implementation_campaign_final_panel_seat'
        || !Number.isSafeInteger(seat.seat_index)
        || seat.seat_index < 1
        || !['runner', 'model', 'effort', 'family']
          .every((key) => typeof seat[key] === 'string' && seat[key].length > 0)
        || !(seat.endpoint === null
          || (typeof seat.endpoint === 'string' && seat.endpoint.length > 0))) {
      return { passed: false, reason: 'final_panel_metadata_incomplete', ...detail };
    }
    const { receipt_digest: receiptDigest, ...body } = seat;
    if (!/^[0-9a-f]{64}$/u.test(receiptDigest)
        || canonicalDigest(body) !== receiptDigest) {
      return { passed: false, reason: 'final_panel_receipt_digest_mismatch', ...detail };
    }
    const tuple = [
      seat.runner,
      seat.model,
      seat.effort,
      seat.endpoint === null ? 'null' : seat.endpoint,
      seat.family,
    ].join('\u0000');
    if (tuples.has(tuple)) {
      return { passed: false, reason: 'final_panel_duplicate_tuple', ...detail };
    }
    tuples.add(tuple);
    if (seat.status === 'reviewed') {
      if (typeof seat.verdict !== 'string' || seat.verdict.length === 0
          || !/^[0-9a-f]{64}$/u.test(seat.review_digest || '')
          || seat.reason !== null) {
        return { passed: false, reason: 'final_panel_metadata_incomplete', ...detail };
      }
      detail.final_panel_count += 1;
    } else if (FINAL_PANEL_FAILURE_STATUSES.has(seat.status)
        && seat.verdict === null
        && seat.review_digest === null
        && seat.reason === `final_panel_seat_${seat.status}`) {
      firstFailure ||= seat.reason;
    } else {
      return { passed: false, reason: 'final_panel_metadata_incomplete', ...detail };
    }
  }
  if (receipt.final_panel_count !== detail.final_panel_count) {
    return { passed: false, reason: 'final_panel_count_mismatch', ...detail };
  }
  if (firstFailure) return { passed: false, reason: firstFailure, ...detail };
  if (detail.final_panel_count < expectedMinimum) {
    return { passed: false, reason: 'final_panel_below_minimum', ...detail };
  }
  if (receipt.reviewed !== true) {
    return { passed: false, reason: 'final_panel_not_reviewed', ...detail };
  }
  return { passed: true, ...detail };
}

function normalizeLifecycleReceiptRef(value) {
  if (value === undefined || value === null || value === 'unknown') return 'unknown';
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 3
      || typeof value.path !== 'string' || value.path.length === 0
      || typeof value.root_run_id !== 'string' || value.root_run_id.length === 0
      || !/^[0-9a-f]{64}$/u.test(value.receipt_digest || '')) {
    throw new CampaignCompositionError(
      'INVALID_LIFECYCLE_RECEIPT_REF',
      'campaign lifecycle receipt reference must be exact or unknown',
    );
  }
  return { ...value };
}

function validateRetainedFinding(item, classification) {
  if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || item.id.length === 0
      || typeof item.claim !== 'string' || item.claim.length === 0
      || !new Set(['🔴', '🟠', '🟡', '🔵']).has(item.severity)
      || typeof item.source !== 'string' || item.source.length === 0) {
    return `${classification} finding identity is incomplete`;
  }
  const expectedEvidence = classification === 'rejected' ? null : 'actionable';
  if (!item.evidence
      || typeof item.evidence !== 'object'
      || !/^[0-9a-f]{64}$/.test(item.evidence.digest || '')
      || !new Set(['actionable', 'refuted']).has(item.evidence.classification)
      || (expectedEvidence && item.evidence.classification !== expectedEvidence)) {
    return `${classification} finding ${item.id} lacks bound evidence`;
  }
  const authority = item.adjudication_authority;
  if (!authority
      || typeof authority !== 'object'
      || !new Set(['depth-0', 'deterministic-policy']).has(authority.authority)
      || typeof authority.actor_id !== 'string'
      || authority.actor_id.length === 0
      || !/^[0-9a-f]{64}$/.test(authority.review_digest || '')) {
    return `${classification} finding ${item.id} lacks adjudication authority`;
  }
  const disposition = item.disposition;
  if (classification === 'must_fix_now') {
    if (!disposition || disposition.disposition !== 'must-fix-now') {
      return `must_fix_now finding ${item.id} lacks a must-fix disposition`;
    }
  } else if (classification === 'follow_up') {
    if (!disposition
        || disposition.disposition !== 'follow-up'
        || typeof disposition.context !== 'string'
        || disposition.context.length === 0
        || typeof disposition.trigger !== 'string'
        || disposition.trigger.length === 0
        || typeof disposition.proposed_backlog_title !== 'string'
        || disposition.proposed_backlog_title.length === 0) {
      return `follow_up finding ${item.id} lacks a complete follow-up disposition`;
    }
  } else if (item.evidence.classification === 'actionable'
      && (!disposition || disposition.disposition !== 'reject-out-of-scope')) {
    return `rejected finding ${item.id} lacks a rejection disposition`;
  }
  return null;
}

function runCampaignComposition(input = {}, adapters = {}) {
  const maxRepairs = input.maxRepairGenerations;
  if (!Number.isSafeInteger(maxRepairs) || maxRepairs < 0) {
    throw new CampaignCompositionError(
      'INVALID_REPAIR_CAP',
      'maxRepairGenerations must be a non-negative safe integer',
    );
  }
  const minPanelSize = input.minPanelSize;
  if (!Number.isSafeInteger(minPanelSize) || minPanelSize < 1) {
    throw new CampaignCompositionError(
      'INVALID_PANEL_MINIMUM',
      'minPanelSize must be an explicitly sealed positive safe integer',
    );
  }
  const lifecycleReceiptRef = normalizeLifecycleReceiptRef(input.lifecycleReceiptRef);
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
  const rejectedFindings = [];
  const findingRegistry = new Map();
  const resume = input.resume || null;
  const resumablePhases = new Set(['VERTICAL_VERIFICATION', 'ADJUDICATING']);
  if (resume !== null
      && (!resume
        || !resumablePhases.has(resume.phase)
        || !Number.isSafeInteger(resume.repair_generation)
        || resume.repair_generation < 0
        || !resume.candidate
        || typeof resume.candidate !== 'object'
        || resume.candidate.committed !== true)) {
    throw new CampaignCompositionError(
      'INVALID_RESUME_CHECKPOINT',
      'campaign resume requires one committed VERTICAL_VERIFICATION candidate',
    );
  }
  if (resume && resume.repair_generation > maxRepairs) {
    throw new CampaignCompositionError(
      'REPAIR_BUDGET_EXCEEDED',
      'campaign resume repair generation exceeds the frozen repair ceiling',
    );
  }
  let repairGeneration = resume ? resume.repair_generation : 0;
  let candidate = resume ? resume.candidate : null;
  let verification = null;
  let lastReview = null;

  const stableFindingDigest = (finding) => {
    const stable = { ...finding };
    if (stable.adjudication_authority) {
      const { review_digest: _reviewDigest, ...authority } = stable.adjudication_authority;
      stable.adjudication_authority = authority;
    }
    return canonicalDigest(stable);
  };
  const retainAdjudication = (adjudication) => {
    const groups = [
      ['must_fix_now', adjudication.must_fix_now, null],
      ['follow_up', adjudication.follow_up, followUps],
      ['rejected', adjudication.rejected, rejectedFindings],
    ];
    for (const [classification, items, target] of groups) {
      if (!Array.isArray(items)) {
        return { passed: false, reason: `${classification} findings must be an array` };
      }
      for (const item of items) {
        const invalid = validateRetainedFinding(item, classification);
        if (invalid) return { passed: false, reason: invalid };
        const digest = stableFindingDigest(item);
        const prior = findingRegistry.get(item.id);
        if (prior) {
          if (prior.classification !== classification || prior.digest !== digest) {
            return {
              passed: false,
              reason: `finding ${item.id} has conflicting cross-round dispositions`,
            };
          }
          continue;
        }
        findingRegistry.set(item.id, { classification, digest });
        if (target) target.push(item);
      }
    }
    return { passed: true };
  };

  const gate = requireReceipt(preflight(), 'preflight');
  trace.push('preflight');
  if (gate.passed !== true) return blocked('preflight', gate.reason || 'preflight rejected', trace);

  const mutate = (kind, repairFindings = []) => {
    const repairFindingIds = repairFindings.map((finding) => finding.id);
    const mutation = requireReceipt(implement({
      kind,
      repair_generation: repairGeneration,
      repair_finding_ids: repairFindingIds,
      repair_findings: repairFindings,
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

  if (resume) {
    trace.push(resume.phase === 'ADJUDICATING'
      ? 'resume_replay_bound_review'
      : 'resume_adopt_candidate');
  } else {
    const mutationResult = mutate('initial');
    if (mutationResult.stop) return mutationResult.stop;
  }

  for (;;) {
    verification = requireReceipt(verify({
      candidate,
      repair_generation: repairGeneration,
    }), 'verify');
    trace.push('verify');
    if (verification.passed !== true) {
      if (verification.retriable === false) {
        return blocked(
          verification.phase || 'vertical_verification',
          verification.reason || 'verification infrastructure blocked',
          trace,
          { candidate, verification, repair_generations: repairGeneration },
        );
      }
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
      const mutationResult = mutate('vertical_repair', [{
        id: 'vertical-acceptance',
        claim: verification.reason || 'contract verification did not pass',
      }]);
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
    const retention = retainAdjudication(adjudication);
    if (retention.passed !== true) {
      return blocked('adjudication_conflict', retention.reason, trace);
    }
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
    const mutationResult = mutate('review_repair', mustFix);
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
  const finalPanelValidation = validateFinalPanelReceipt(terminalReview, minPanelSize);
  if (finalPanelValidation.passed !== true) {
    return blocked(
      'final_panel',
      finalPanelValidation.reason,
      trace,
      finalPanelValidation,
    );
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
  const finalRetention = retainAdjudication(finalAdjudication);
  if (finalRetention.passed !== true) {
    return blocked('final_adjudication', finalRetention.reason, trace);
  }
  const finalMustFix = Array.isArray(finalAdjudication.must_fix_now)
    ? finalAdjudication.must_fix_now
    : [];
  const status = finalMustFix.length === 0 && followUps.length === 0
    ? 'ready'
    : 'follow_up';
  const receiptBody = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_terminal',
    status,
    candidate_tree_sha: candidate.tree_sha,
    verification_receipt_digest: verification.receipt_digest,
    repair_generations: repairGeneration,
    sealed_min_panel_size: minPanelSize,
    final_panel_count: finalPanelValidation.final_panel_count,
    final_panel_seat_receipts: finalPanelValidation.final_panel_seat_receipts,
    follow_up: followUps,
    rejected_findings: rejectedFindings,
    unresolved_final_findings: finalMustFix,
    lifecycle_receipt_ref: lifecycleReceiptRef,
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
  validateFinalPanelReceipt,
};
