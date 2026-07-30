'use strict';

const { canonicalDigest } = require('./campaign-verification');
const {
  AWAITING_DISPOSITION,
  AWAITING_CONVERGENCE,
  BOUNDARY_REJECTED,
  classifyBoundaryRejected,
  classifyMissingDisposition,
  requireFullDiffBeforeRepair,
  recordFullDiffBarrier,
  emptyControllerState,
  checkJointRepairBudget,
  applyBudgetUsage,
  appendRepairTicket,
  recordGateEntry,
  findReusableGate,
  buildProgressReceipt,
  controllerStateDigest,
  rebuildTranscriptAudit,
  admitControllerEffects,
  buildHistoricalOutputsAtCommit,
  buildNoOpReceipt,
} = require('./controller-execution');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isCanonicalSha256 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const REVIEW_AUTHORITY_KEYS = [
  'schema_version',
  'artifact_type',
  'candidate_ref',
  'candidate_tree_sha',
  'base_sha',
  'diff_digest',
  'spec_digest',
  'review_input_digest',
  'reviewer',
];

function validateReviewAuthority(authority, reviewPayload) {
  const reviewer = authority && authority.reviewer;
  const reviewerKeys = ['runner', 'model', 'effort', 'endpoint'];
  if (!isObj(authority)
      || Object.keys(authority).sort().join('\0')
        !== [...REVIEW_AUTHORITY_KEYS].sort().join('\0')
      || authority.schema_version !== 1
      || authority.artifact_type !== 'controller_full_diff_review_input'
      || !isStr(authority.candidate_ref)
      || !isStr(authority.candidate_tree_sha)
      || !isStr(authority.base_sha)
      || !isCanonicalSha256(authority.diff_digest)
      || !isCanonicalSha256(authority.spec_digest)
      || !isCanonicalSha256(authority.review_input_digest)
      || authority.review_input_digest !== canonicalDigest(reviewPayload)
      || !isObj(reviewer)
      || Object.keys(reviewer).sort().join('\0') !== reviewerKeys.sort().join('\0')
      || !isStr(reviewer.runner)
      || !isStr(reviewer.model)
      || !isStr(reviewer.effort)
      || (reviewer.endpoint !== null && !isStr(reviewer.endpoint))) {
    throw new CampaignCompositionError(
      'REVIEW_AUTHORITY_INVALID',
      'full-diff reservation requires exact candidate/base/tree/diff/spec/input and reviewer authority',
    );
  }
  return authority;
}

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

function noDispatchContradictions(mutation) {
  if (!isObj(mutation) || mutation.dispatcher_called !== false) return [];
  const contradictions = [];
  const allowedStatus = mutation.status === 'no_op'
    || mutation.status === 'precondition_failed';
  if (!allowedStatus) contradictions.push('status');
  if (mutation.committed === true) contradictions.push('committed');
  for (const field of ['commit', 'candidate_ref', 'tip', 'tree_sha', 'worktree']) {
    if (isStr(mutation[field])) contradictions.push(field);
  }
  for (const [field, expected] of [
    ['model_calls', 0],
    ['mutation_attempts', 0],
    ['gate_attempts', 0],
    ['resources_created', 0],
  ]) {
    if (mutation[field] !== expected) contradictions.push(field);
  }
  for (const field of ['files_changed', 'insertions', 'deletions', 'churn']) {
    if (mutation[field] !== undefined
        && mutation[field] !== null
        && mutation[field] !== 0) {
      contradictions.push(field);
    }
  }
  if (Array.isArray(mutation.resource_inventory_delta)
      && mutation.resource_inventory_delta.length > 0) {
    contradictions.push('resource_inventory_delta');
  }
  if (isObj(mutation.writer_fence)) contradictions.push('writer_fence');
  if (mutation.status === 'no_op'
      && !isCanonicalSha256(mutation.zero_diff_receipt_digest)) {
    contradictions.push('zero_diff_receipt_digest');
  }
  const nested = [
    mutation.raw && mutation.raw.implementation,
    mutation.raw && mutation.raw.implementation
      && mutation.raw.implementation.implementation,
  ].filter(isObj);
  for (const evidence of nested) {
    for (const field of ['commit', 'candidate_ref', 'tip', 'worktree']) {
      if (isStr(evidence[field])) contradictions.push(`raw.${field}`);
    }
    for (const field of ['files_changed', 'insertions', 'deletions']) {
      if (evidence[field] !== undefined
          && evidence[field] !== null
          && evidence[field] !== 0) {
        contradictions.push(`raw.${field}`);
      }
    }
    if (evidence.dispatcher_called !== undefined
        && evidence.dispatcher_called !== false) {
      contradictions.push('raw.dispatcher_called');
    }
  }
  return [...new Set(contradictions)].sort();
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

function awaitingDisposition(reason, trace, detail = {}) {
  return {
    status: AWAITING_DISPOSITION,
    phase: AWAITING_DISPOSITION,
    reason,
    trace,
    resumable: true,
    durable_wait: true,
    terminalize: false,
    final_panel_count: 0,
    campaign_event: 'AWAITING_DISPOSITION',
    ...detail,
  };
}

function boundaryRejected(boundary, trace, detail = {}) {
  return {
    status: BOUNDARY_REJECTED,
    phase: BOUNDARY_REJECTED,
    reason: boundary.boundary_reason,
    boundary_reason: boundary.boundary_reason,
    boundary_code: boundary.boundary_code,
    candidate_ref: boundary.candidate_ref,
    possibly_effectful: boundary.possibly_effectful,
    mutation_failed: false,
    unknown_status: false,
    durable_wait: true,
    terminalize: false,
    campaign_event: 'BOUNDARY_REJECTED',
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
  const prepareReview = typeof adapters.prepareReview === 'function'
    ? adapters.prepareReview : null;
  const adjudicate = requireAdapter(adapters, 'adjudicate');
  const convergence = requireAdapter(adapters, 'convergence');
  const finalPanel = requireAdapter(adapters, 'finalPanel');

  const trace = [];
  const followUps = [];
  const rejectedFindings = [];
  const findingRegistry = new Map();
  const resume = input.resume || null;
  // Durable phases the controller may resume without re-dispatching implementer.
  const resumablePhases = new Set([
    'VERTICAL_VERIFICATION',
    'ADJUDICATING',
    'AWAITING_DISPOSITION',
    AWAITING_DISPOSITION,
    'AWAITING_CONVERGENCE_ADJUDICATION',
    AWAITING_CONVERGENCE,
    'BOUNDARY_REJECTED',
    BOUNDARY_REJECTED,
    'DISPOSITION_RESUMED',
  ]);
  // Awaiting-disposition resume may reuse bound candidate without re-implementation.
  // Awaiting-convergence requires explicit adjudication authority (not auto no-op).
  // Boundary-rejected is durable non-success (not labeled exact no-op unless bound).
  if (resume !== null
      && (!resume
        || !resumablePhases.has(resume.phase)
        || !Number.isSafeInteger(resume.repair_generation)
        || resume.repair_generation < 0
        || !resume.candidate
        || typeof resume.candidate !== 'object'
        || (resume.candidate.committed !== true
          && resume.phase !== BOUNDARY_REJECTED
          && resume.phase !== 'BOUNDARY_REJECTED'))) {
    throw new CampaignCompositionError(
      'INVALID_RESUME_CHECKPOINT',
      'campaign resume requires a bound durable checkpoint with sealed candidate state',
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
  // generation → authoritative full-diff barrier (focused cannot impersonate)
  let fullDiffBarriers = isObj(input.fullDiffBarriers)
    ? { ...input.fullDiffBarriers }
    : {};
  if (resume && isObj(resume.full_diff_barriers)) {
    fullDiffBarriers = { ...fullDiffBarriers, ...resume.full_diff_barriers };
  }
  const resumeFindings = Array.isArray(resume && resume.findings)
    ? resume.findings
    : null;

  // Durable controller authority on this campaign (also CAS-bound on Work Order).
  let controller = emptyControllerState(
    isObj(input.controller) ? input.controller
      : (resume && isObj(resume.controller) ? resume.controller : {}),
  );
  if (isObj(input.frozenDenominator) && !controller.frozen_denominator) {
    controller.frozen_denominator = input.frozenDenominator;
    controller.controller_digest = controllerStateDigest(controller);
  }
  if (isObj(input.repairBudgetLimits)) {
    controller.repair_budget_limits = {
      ...controller.repair_budget_limits,
      ...input.repairBudgetLimits,
    };
    controller.controller_digest = controllerStateDigest(controller);
  }
  const persistController = (next) => {
    controller = next;
    controller.controller_digest = controllerStateDigest(controller);
    if (typeof adapters.onControllerUpdate === 'function') {
      // Propagation: persistence callback errors must stop external effects.
      adapters.onControllerUpdate(controller);
    }
  };

  if (resume && (resume.phase === AWAITING_CONVERGENCE
      || resume.phase === 'AWAITING_CONVERGENCE_ADJUDICATION')) {
    const receipt = resume.convergence_adjudication_receipt;
    const expectedKeys = [
      'schema_version',
      'artifact_type',
      'outcome',
      'root_run_id',
      'work_order_id',
      'controller_digest',
      'budget_usage_digest',
      'issued_at',
      'digest',
    ].sort();
    const body = isObj(receipt) ? { ...receipt } : null;
    if (body) delete body.digest;
    if (!isObj(receipt)
        || Object.keys(receipt).sort().join('\0') !== expectedKeys.join('\0')
        || receipt.schema_version !== 1
        || receipt.artifact_type !== 'controller_convergence_adjudication_receipt'
        || receipt.outcome !== 'resume_authorized'
        || receipt.root_run_id !== (input.rootRunId || null)
        || receipt.work_order_id !== (input.workOrderId || null)
        || receipt.controller_digest !== controller.controller_digest
        || receipt.budget_usage_digest !== canonicalDigest(controller.repair_budget_usage)
        || !isStr(receipt.issued_at)
        || !isStr(receipt.digest)
        || receipt.digest !== canonicalDigest(body)) {
      throw new CampaignCompositionError(
        'CONVERGENCE_ADJUDICATION_REQUIRED',
        'awaiting-convergence resume requires an exact digest-bound adjudication receipt',
      );
    }
    const prior = Array.isArray(controller.resume_receipts)
      ? controller.resume_receipts : [];
    if (!prior.some((item) => item.digest === receipt.digest)) {
      persistController({
        ...controller,
        resume_receipts: [...prior, receipt],
        audit_events: [
          ...(controller.audit_events || []),
          {
            event: 'convergence_adjudication_consumed',
            root_run_id: input.rootRunId || null,
            work_order_id: input.workOrderId || null,
            at: receipt.issued_at,
            digest: receipt.digest,
          },
        ],
      });
    }
  }

  // Durable campaign reducer events (production emission site).
  const emitCampaignEvent = (eventType, payload = {}) => {
    if (typeof adapters.onCampaignEvent === 'function') {
      adapters.onCampaignEvent({
        event_type: eventType,
        generation: repairGeneration,
        payload,
        controller,
        candidate,
      });
    }
  };

  const preEffectAdmit = (wouldCreateWorktree = false) => {
    if (typeof adapters.preEffectAdmit === 'function') {
      return adapters.preEffectAdmit({
        controller,
        wouldCreateWorktree,
        baseSha: input.baseSha || null,
      });
    }
    // Default: mechanical debt/high-water/transcript when gitCwd is available.
    if (!isStr(input.gitCwd) && !isStr(input.repo)) {
      return { ok: true };
    }
    return admitControllerEffects({
      gitCwd: input.gitCwd || input.repo,
      controller,
      rootRunId: input.rootRunId || null,
      graphNode: input.graphNode || null,
      attempt: input.attempt || null,
      workOrderId: input.workOrderId || null,
      workOrderGeneration: input.workOrderGeneration || null,
      workOrderCasToken: input.workOrderCasToken || null,
      expectedWorkOrderDigest: input.expectedWorkOrderDigest || null,
      expectedControllerDigest: input.expectedControllerDigest || null,
      wouldCreateWorktree,
      baseSha: input.baseSha || null,
    });
  };

  const persistEffectObservation = (effectGate) => {
    if (!isObj(effectGate) || !Array.isArray(effectGate.inventory)) return;
    persistController({
      ...controller,
      resource_inventory: effectGate.inventory,
      resource_debt: effectGate.debt || controller.resource_debt,
      inventory_observation_digest: effectGate.inventory_digest || null,
      repair_budget_usage: {
        ...controller.repair_budget_usage,
        owned_worktrees: Number.isSafeInteger(effectGate.owned_worktrees)
          ? effectGate.owned_worktrees
          : controller.repair_budget_usage.owned_worktrees,
      },
      transcript_audit: effectGate.audit || null,
    });
  };

  const effectInputBytes = (payload) => Buffer.byteLength(
    JSON.stringify(payload == null ? null : payload),
    'utf8',
  );

  const admitEffect = ({
    stage,
    wouldCreateWorktree = false,
    modelCalls = 0,
    freshInputBytes = 0,
  }) => {
    const effectGate = preEffectAdmit(wouldCreateWorktree);
    persistEffectObservation(effectGate);
    if (!effectGate.ok) {
      return {
        ok: false,
        code: effectGate.code || 'PRE_EFFECT_REJECTED',
        reason: effectGate.reason || `pre-effect authority rejected ${stage}`,
        gate: effectGate,
      };
    }
    const startedAtMs = Number.isSafeInteger(controller.started_at_ms)
      ? controller.started_at_ms
      : Date.now();
    const projectedOwned = (Number.isSafeInteger(effectGate.owned_worktrees)
      ? effectGate.owned_worktrees
      : Number(controller.repair_budget_usage.owned_worktrees || 0))
      + (wouldCreateWorktree ? 1 : 0);
    const budget = checkJointRepairBudget(
      controller.repair_budget_usage,
      controller.repair_budget_limits,
      {
        beforeSpend: true,
        projectedDelta: {
          model_calls: modelCalls,
          fresh_input_bytes: freshInputBytes,
          fresh_input_tokens: null,
          elapsed_wall_ms: Math.max(0, Date.now() - startedAtMs),
          owned_worktrees: projectedOwned,
          finding_recurrence: 0,
        },
      },
    );
    if (!budget.allow_spend) {
      return {
        ok: false,
        code: 'JOINT_REPAIR_BUDGET_EXCEEDED',
        reason: budget.reason,
        budget,
      };
    }
    return { ok: true, gate: effectGate, budget };
  };

  const reserveEffectInvocation = ({
    stage,
    effectKind,
    inputIdentity,
    authority,
  }) => {
    if (!isStr(stage)
        || !isStr(effectKind)
        || !isCanonicalSha256(inputIdentity)
        || !isObj(authority)) {
      throw new CampaignCompositionError(
        'EFFECT_RESERVATION_IDENTITY_MISSING',
        'effect reservation requires exact stage, kind, and input identity',
      );
    }
    const reservations = (controller.audit_events || []).filter((event) => (
      isObj(event)
      && event.event === 'controller_effect_reserved'
      && event.stage === stage
      && event.effect_kind === effectKind
      && event.input_identity === inputIdentity
      && isCanonicalSha256(event.reservation_identity)
    ));
    const latest = reservations.at(-1) || null;
    if (latest) {
      const invocation = (controller.audit_events || []).find((event) => (
        isObj(event)
        && event.event === 'controller_effect_invoked'
        && event.reservation_identity === latest.reservation_identity
        && isCanonicalSha256(event.effect_identity)
      ));
      const completed = invocation && (controller.audit_events || []).some((event) => (
        isObj(event)
        && event.event === 'controller_effect_result'
        && event.invocation_identity === invocation.effect_identity
      ));
      if (!completed) {
        return {
          ok: false,
          pending: true,
          code: 'EFFECT_RESERVATION_PENDING',
          reason: `${stage} has a durable in-flight reservation; reconcile it instead of replaying the effect`,
          reservation_identity: latest.reservation_identity,
        };
      }
    }
    const invocationOrdinal = reservations.length + 1;
    const reservationBody = {
      schema_version: 1,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
      stage,
      effect_kind: effectKind,
      generation: repairGeneration,
      invocation_ordinal: invocationOrdinal,
      input_identity: inputIdentity,
      authority,
    };
    const reservationIdentity = canonicalDigest(reservationBody);
    const eventBody = {
      event: 'controller_effect_reserved',
      stage,
      effect_kind: effectKind,
      input_identity: inputIdentity,
      reservation_identity: reservationIdentity,
      invocation_ordinal: invocationOrdinal,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
      generation: repairGeneration,
      authority,
    };
    persistController({
      ...controller,
      audit_events: [
        ...(controller.audit_events || []),
        {
          ...eventBody,
          at: new Date().toISOString(),
          digest: canonicalDigest(eventBody),
        },
      ],
    });
    return {
      ok: true,
      reservation_identity: reservationIdentity,
      invocation_ordinal: invocationOrdinal,
    };
  };

  const chargeEffect = ({
    stage,
    effectKind,
    resultIdentity,
    reservationIdentity = null,
    modelCalls = 0,
    freshInputBytes = 0,
    freshInputTokens = null,
  }) => {
    if (!isStr(stage)
        || !isStr(effectKind)
        || !isCanonicalSha256(resultIdentity)) {
      throw new CampaignCompositionError(
        'EFFECT_IDENTITY_MISSING',
        `${stage || 'controller effect'} requires an exact kind and result identity`,
      );
    }
    const startedAtMs = Number.isSafeInteger(controller.started_at_ms)
      ? controller.started_at_ms
      : Date.now();
    const usage = applyBudgetUsage(controller.repair_budget_usage, {
      model_calls: modelCalls,
      fresh_input_bytes: freshInputBytes,
      fresh_input_tokens: freshInputTokens,
      elapsed_wall_ms: Math.max(0, Date.now() - startedAtMs),
    });
    const invocationOrdinal = (controller.audit_events || []).filter((event) => (
      isObj(event)
      && event.event === 'controller_effect_invoked'
      && event.stage === stage
    )).length + 1;
    const invocationIdentity = canonicalDigest({
      schema_version: 1,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
      stage,
      effect_kind: effectKind,
      generation: repairGeneration,
      invocation_ordinal: invocationOrdinal,
      result_identity: resultIdentity,
    });
    const eventBody = {
      event: 'controller_effect_invoked',
      stage,
      effect_kind: effectKind,
      effect_identity: invocationIdentity,
      result_identity: resultIdentity,
      invocation_ordinal: invocationOrdinal,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
      model_calls: modelCalls,
      fresh_input_bytes: freshInputBytes,
      generation: repairGeneration,
      ...(isCanonicalSha256(reservationIdentity)
        ? { reservation_identity: reservationIdentity } : {}),
    };
    persistController({
      ...controller,
      repair_budget_usage: usage,
      audit_events: [
        ...(controller.audit_events || []),
        {
          ...eventBody,
          at: new Date().toISOString(),
          digest: canonicalDigest(eventBody),
        },
      ],
    });
    return invocationIdentity;
  };
  const persistGateResult = (gate, invocationIdentity, invocationResultIdentity) => {
    if (!isObj(gate) || !isObj(gate.entry) || !isStr(gate.entry.gate_id)) {
      throw new CampaignCompositionError(
        'GATE_RESULT_IDENTITY_MISSING',
        'executed gate result requires an exact gate identity',
      );
    }
    if (!isCanonicalSha256(invocationIdentity)
        || !isCanonicalSha256(invocationResultIdentity)) {
      throw new CampaignCompositionError(
        'GATE_INVOCATION_IDENTITY_MISSING',
        'executed gate result requires exact invocation and result identities',
      );
    }
    const effectResultDigest = canonicalDigest({
      gate_id: gate.entry.gate_id,
      kind: gate.entry.kind,
      owner: gate.entry.owner,
      root_run_id: gate.entry.root_run_id,
      work_order_id: gate.entry.work_order_id,
      input_digest: gate.entry.input_digest,
      started_at: gate.entry.started_at,
      finished_at: gate.entry.finished_at,
      result: gate.entry.result,
    });
    const resultEventBody = {
      event: 'controller_effect_result',
      effect_kind: 'gate',
      effect_identity: gate.entry.gate_id,
      invocation_identity: invocationIdentity,
      invocation_result_identity: invocationResultIdentity,
      effect_result_digest: effectResultDigest,
      input_digest: gate.entry.input_digest,
      stage: gate.entry.kind,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
    };
    persistController({
      ...controller,
      gate_journal: gate.journal,
      audit_events: [
        ...(controller.audit_events || []),
        {
          ...resultEventBody,
          at: gate.entry.finished_at,
          digest: canonicalDigest(resultEventBody),
        },
      ],
    });
  };
  const persistSupplementalEffectResult = ({
    effectKind,
    invocationIdentity,
    resultIdentity,
    stage,
    result,
  }) => {
    if (!isStr(effectKind)
        || !isStr(stage)
        || !isCanonicalSha256(invocationIdentity)
        || !isCanonicalSha256(resultIdentity)
        || !isObj(result)) {
      throw new CampaignCompositionError(
        'EFFECT_RESULT_IDENTITY_MISSING',
        'supplemental effect result requires exact kind, stage, identity, and receipt',
      );
    }
    const resultEventBody = {
      event: 'controller_effect_result',
      effect_kind: effectKind,
      effect_identity: resultIdentity,
      invocation_identity: invocationIdentity,
      invocation_result_identity: resultIdentity,
      effect_result_digest: canonicalDigest(result),
      stage,
      root_run_id: input.rootRunId || null,
      work_order_id: input.workOrderId || null,
    };
    persistController({
      ...controller,
      audit_events: [
        ...(controller.audit_events || []),
        {
          ...resultEventBody,
          at: new Date().toISOString(),
          digest: canonicalDigest(resultEventBody),
        },
      ],
    });
  };

  const appendRoundProgress = (phase, blockedReason = null) => {
    if (!isObj(controller.frozen_denominator)) return;
    try {
      // Completed deliverables only from durable controller / Mission-derived state.
      // Never accept caller input.completedDeliverables as authority.
      const completed = Array.isArray(controller.completed_deliverables)
        ? controller.completed_deliverables
        : (Array.isArray(controller.progress_receipts)
          && controller.progress_receipts.length > 0
          ? (controller.progress_receipts[controller.progress_receipts.length - 1]
            .completed_deliverables || [])
          : []);
      const activeProcess = isObj(input.activeProcess)
        && Number.isInteger(input.activeProcess.pid)
        ? input.activeProcess
        : (isObj(controller.process_parentage)
          ? controller.process_parentage
          : { pid: process.pid });
      const receipt = buildProgressReceipt({
        frozenDenominator: controller.frozen_denominator,
        completedDeliverables: completed,
        generation: repairGeneration,
        activeProcess,
        blockedReason,
        gateState: controller.gate_journal || null,
        resourceDebtState: controller.resource_debt || null,
        phase,
        workOrderId: input.workOrderId || null,
        rootRunId: input.rootRunId || null,
      });
      const next = {
        ...controller,
        phase,
        progress_receipts: [...(controller.progress_receipts || []), receipt],
        audit_events: [
          ...(controller.audit_events || []),
          {
            event: 'progress_receipt_appended',
            root_run_id: input.rootRunId || null,
            work_order_id: input.workOrderId || null,
            at: receipt.issued_at,
            digest: receipt.digest,
            phase,
          },
        ],
      };
      persistController(next);
    } catch (error) {
      // Progress receipt failure is fail-closed — surface to caller.
      throw new CampaignCompositionError(
        error.code || 'PROGRESS_RECEIPT_FAILED',
        error.message || String(error),
      );
    }
  };

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

  const mutate = (
    kind,
    repairFindings = [],
    reviewInputMode = 'full_diff_generation',
  ) => {
    // Joint repair budget: project the next model call + observable axes.
    // used == limit must block this positive projected delta.
    // Mechanically stat prompt bytes — missing observation fails closed.
    let promptBytes = null;
    if (Number.isSafeInteger(input.promptBytes) && input.promptBytes >= 0) {
      promptBytes = input.promptBytes;
    } else if (isStr(input.promptFile)) {
      try {
        const st = require('fs').statSync(input.promptFile);
        if (!st.isFile()) {
          throw new CampaignCompositionError(
            'PROMPT_BYTES_UNOBSERVED',
            'prompt path is not a regular file',
          );
        }
        promptBytes = st.size;
      } catch (error) {
        if (error instanceof CampaignCompositionError) throw error;
        throw new CampaignCompositionError(
          'PROMPT_BYTES_UNOBSERVED',
          `prompt bytes unobserved: ${error.message || String(error)}`,
        );
      }
    } else if (input.promptBytes === 0) {
      promptBytes = 0;
    } else {
      // Fail closed: cannot invent prompt size. Explicit 0 is an observation;
      // omission is not.
      throw new CampaignCompositionError(
        'PROMPT_BYTES_UNOBSERVED',
        'prompt bytes require promptFile or exact promptBytes observation',
      );
    }
    const startedAtMs = Number.isSafeInteger(controller.started_at_ms)
      ? controller.started_at_ms
      : Date.now();
    if (!Number.isSafeInteger(controller.started_at_ms)) {
      persistController({ ...controller, started_at_ms: startedAtMs });
    }
    const findingRecurrenceDelta = Array.isArray(repairFindings)
      ? repairFindings.filter((f) => f && (f.recurring === true || f.occurrence >= 2)).length
      : 0;
    const projectedDelta = {
      model_calls: 1,
      fresh_input_bytes: promptBytes,
      // Tokens remain unobserved until a provider reports them (null, never 0).
      fresh_input_tokens: null,
      // Absolute wall from digest-bound start.
      elapsed_wall_ms: Math.max(0, Date.now() - startedAtMs),
      // Absolute owned worktrees: composition projects current; +1 via preEffectAdmit.
      owned_worktrees: Number.isSafeInteger(controller.repair_budget_usage
        && controller.repair_budget_usage.owned_worktrees)
        ? controller.repair_budget_usage.owned_worktrees
        : 0,
      finding_recurrence: findingRecurrenceDelta,
    };
    const budgetCheck = checkJointRepairBudget(
      controller.repair_budget_usage,
      controller.repair_budget_limits,
      { beforeSpend: true, projectedDelta },
    );
    if (!budgetCheck.allow_spend) {
      const waitAuditBody = {
        event: AWAITING_CONVERGENCE,
        root_run_id: input.rootRunId || null,
        work_order_id: input.workOrderId || null,
        exceeded: budgetCheck.exceeded,
        projected: projectedDelta,
        generation: repairGeneration,
      };
      const next = {
        ...controller,
        phase: AWAITING_CONVERGENCE,
        next_action: 'await_convergence_adjudication',
        audit_events: [
          ...(controller.audit_events || []),
          {
            ...waitAuditBody,
            at: new Date().toISOString(),
            digest: canonicalDigest(waitAuditBody),
          },
        ],
      };
      persistController(next);
      appendRoundProgress(AWAITING_CONVERGENCE, budgetCheck.reason);
      const budgetReceiptDigest = canonicalDigest({
        usage: controller.repair_budget_usage,
        limits: controller.repair_budget_limits,
        exceeded: budgetCheck.exceeded,
        projected: projectedDelta,
      });
      emitCampaignEvent('AWAITING_CONVERGENCE', {
        reason: budgetCheck.reason,
        exceeded_axes: budgetCheck.exceeded,
        budget_receipt_digest: budgetReceiptDigest,
      });
      return {
        stop: {
          status: AWAITING_CONVERGENCE,
          phase: AWAITING_CONVERGENCE,
          reason: budgetCheck.reason,
          exceeded: budgetCheck.exceeded,
          controller,
          trace,
          final_panel_count: 0,
          awaiting_convergence_adjudication: true,
          durable_wait: true,
          terminalize: false,
          campaign_event: 'AWAITING_CONVERGENCE',
          budget_receipt_digest: budgetReceiptDigest,
        },
      };
    }
    if (kind !== 'initial') {
      // repairGeneration was already advanced; the full-diff barrier belongs to
      // the candidate generation that authorized this repair (prior generation).
      const barrierGeneration = Math.max(0, repairGeneration - 1);
      const barrier = requireFullDiffBeforeRepair({
        generation: barrierGeneration,
        fullDiffBarriers,
        focusedOnly: reviewInputMode === 'focused_delta_round'
          && !(fullDiffBarriers[String(barrierGeneration)]
            && fullDiffBarriers[String(barrierGeneration)].success === true),
        verticalFailed: kind === 'vertical_repair',
      });
      if (!barrier.allow_repair) {
        return {
          stop: blocked(
            'full_diff_before_repair',
            barrier.reason,
            trace,
            {
              candidate,
              full_diff_barrier_required: true,
              code: barrier.code,
            },
          ),
        };
      }
      // Deterministic/idempotent repair ticket from sealed inputs — never wall-clock.
      try {
        const withTicket = appendRepairTicket(controller, {
          generation: repairGeneration,
          finding_ids: repairFindings.map((f) => f.id || f.finding_id).filter(Boolean),
          review_digest: (lastReview && (lastReview.review_digest || lastReview.receipt_digest))
            || null,
          reuse_lineage: true,
          root_run_id: input.rootRunId || null,
          work_order_id: input.workOrderId || null,
        });
        persistController(withTicket);
      } catch (error) {
        return {
          stop: blocked(
            'repair_ticket',
            error.message || String(error),
            trace,
            { code: error.code || 'REPAIR_TICKET_FAILED', controller },
          ),
        };
      }
    }
    const repairFindingIds = repairFindings.map((finding) => finding.id);
    const mutationAdmission = admitEffect({
      stage: kind === 'initial' ? 'implementation' : 'repair',
      wouldCreateWorktree: kind === 'initial',
      modelCalls: 1,
      freshInputBytes: promptBytes,
    });
    if (!mutationAdmission.ok) {
      return {
        stop: blocked(
          mutationAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
          mutationAdmission.reason,
          trace,
          {
            code: mutationAdmission.code,
            durable_wait: true,
            terminalize: false,
            controller,
          },
        ),
      };
    }
    const mutation = requireReceipt(implement({
      kind,
      repair_generation: repairGeneration,
      repair_finding_ids: repairFindingIds,
      repair_findings: repairFindings,
      review_input_mode: reviewInputMode,
      previous_candidate: candidate,
      controller,
    }), 'implement');
    const noDispatchConflicts = noDispatchContradictions(mutation);
    if (noDispatchConflicts.length > 0) {
      let chargedUsage;
      try {
        chargedUsage = applyBudgetUsage(controller.repair_budget_usage, {
          model_calls: Number.isSafeInteger(mutation.model_calls)
            && mutation.model_calls >= 0
            ? Math.max(1, mutation.model_calls) : 1,
          fresh_input_bytes: Number.isSafeInteger(mutation.fresh_input_bytes)
            && mutation.fresh_input_bytes >= 0
            ? mutation.fresh_input_bytes : promptBytes,
          fresh_input_tokens: mutation.fresh_input_tokens == null
            ? null : mutation.fresh_input_tokens,
          elapsed_wall_ms: Number.isSafeInteger(mutation.elapsed_wall_ms)
            && mutation.elapsed_wall_ms >= 0
            ? mutation.elapsed_wall_ms
            : Math.max(0, Date.now() - startedAtMs),
          finding_recurrence: findingRecurrenceDelta,
        });
      } catch (error) {
        return {
          stop: blocked(
            'dispatcher_outcome_authority',
            error.message || String(error),
            trace,
            {
              code: error.code || 'INVALID_DISPATCH_USAGE',
              candidate,
              controller,
            },
          ),
        };
      }
      const rejectionBody = {
        event: 'dispatcher_no_effect_claim_rejected',
        root_run_id: input.rootRunId || null,
        work_order_id: input.workOrderId || null,
        generation: repairGeneration,
        contradictions: noDispatchConflicts,
      };
      persistController({
        ...controller,
        repair_budget_usage: chargedUsage,
        audit_events: [
          ...(controller.audit_events || []),
          {
            ...rejectionBody,
            at: new Date().toISOString(),
            digest: canonicalDigest(rejectionBody),
          },
        ],
      });
      return {
        stop: blocked(
          'dispatcher_outcome_authority',
          `dispatcher_called:false contradicts effect evidence: ${
            noDispatchConflicts.join(', ')
          }`,
          trace,
          {
            code: 'DISPATCHER_NO_EFFECT_CONTRADICTION',
            candidate,
            controller,
            charged: true,
          },
        ),
      };
    }
    if (Array.isArray(mutation.resource_inventory_delta)
        && mutation.resource_inventory_delta.length > 0) {
      const resources = new Map(
        (controller.resource_inventory || []).map((item) => [
          item && (item.resource_id || item.path || item.worktree),
          item,
        ]),
      );
      for (const item of mutation.resource_inventory_delta) {
        if (!isObj(item)
            || (item.root_run_id != null && item.root_run_id !== (input.rootRunId || null))
            || (item.work_order_id != null
              && item.work_order_id !== (input.workOrderId || null))) {
          return {
            stop: blocked(
              'resource_identity',
              'resource inventory delta is foreign to the exact controller tuple',
              trace,
              { controller },
            ),
          };
        }
        const key = item && (item.resource_id || item.path || item.worktree);
        if (isStr(key)) {
          resources.set(key, {
            ...item,
            root_run_id: input.rootRunId || null,
            work_order_id: input.workOrderId || null,
          });
        }
      }
      persistController({
        ...controller,
        resource_inventory: [...resources.values()].filter(Boolean),
      });
    }
    // Count spend only when the effect was actually invoked.
    // dispatcher_called === false (precondition / zero-effect) consumes zero.
    if (mutation.dispatcher_called !== false
        && mutation.phase !== 'awaiting_convergence_adjudication') {
      const ownedAbs = Number.isSafeInteger(mutation.owned_worktrees_current)
        ? mutation.owned_worktrees_current
        : null;
      const spent = applyBudgetUsage(controller.repair_budget_usage, {
        model_calls: Number.isSafeInteger(mutation.model_calls)
          ? mutation.model_calls
          : (mutation.dispatcher_called === false ? 0 : 1),
        fresh_input_bytes: Number.isSafeInteger(mutation.fresh_input_bytes)
          ? mutation.fresh_input_bytes
          : promptBytes,
        fresh_input_tokens: (mutation.fresh_input_tokens === undefined
          || mutation.fresh_input_tokens === null)
          ? null
          : mutation.fresh_input_tokens,
        // Absolute wall reading from start — applyBudgetUsage takes max, not sum.
        elapsed_wall_ms: Number.isSafeInteger(mutation.elapsed_wall_ms)
          ? mutation.elapsed_wall_ms
          : Math.max(0, Date.now() - startedAtMs),
        finding_recurrence: findingRecurrenceDelta,
        ...(ownedAbs === null
          ? {}
          : { owned_worktrees_absolute: ownedAbs }),
      });
      const rawImplementation = mutation.raw && mutation.raw.implementation;
      const dispatchRecordBody = {
        kind: kind === 'initial' ? 'implementation' : 'repair',
        root_run_id: input.rootRunId || null,
        work_order_id: input.workOrderId || null,
        generation: repairGeneration,
        dispatcher_called: mutation.dispatcher_called !== false,
        model_calls: Number.isSafeInteger(mutation.model_calls)
          ? mutation.model_calls
          : (mutation.dispatcher_called === false ? 0 : 1),
        prompt_bytes: promptBytes,
        run_id: rawImplementation && rawImplementation.run_id || null,
        dispatch_id: rawImplementation && rawImplementation.dispatch_id || null,
        provider: rawImplementation
          && (rawImplementation.provider || rawImplementation.runner) || null,
        runner: rawImplementation && rawImplementation.runner || null,
        model: rawImplementation && rawImplementation.model || null,
        provider_session_id:
          rawImplementation && rawImplementation.provider_session_id || null,
        resource_id: rawImplementation
          && (rawImplementation.resource_id || rawImplementation.worktree) || null,
        result_receipt_digest: mutation.writer_fence
          && mutation.writer_fence.receipt_digest || null,
      };
      const dispatchAuditBody = {
        event: 'controller_effect_invoked',
        stage: dispatchRecordBody.kind,
        effect_kind: 'dispatch',
        root_run_id: input.rootRunId || null,
        work_order_id: input.workOrderId || null,
        run_id: dispatchRecordBody.run_id,
        dispatch_id: dispatchRecordBody.dispatch_id,
        provider: dispatchRecordBody.provider,
        runner: dispatchRecordBody.runner,
        model: dispatchRecordBody.model,
        provider_session_id: dispatchRecordBody.provider_session_id,
        resource_identity: dispatchRecordBody.resource_id,
        result_receipt_digest: dispatchRecordBody.result_receipt_digest,
        model_calls: dispatchRecordBody.model_calls,
        fresh_input_bytes: promptBytes,
        generation: repairGeneration,
      };
      const dispatchRecord = {
        ...dispatchRecordBody,
        at: new Date().toISOString(),
        digest: canonicalDigest(dispatchRecordBody),
      };
      dispatchAuditBody.effect_identity = dispatchRecord.digest;
      persistController({
        ...controller,
        repair_budget_usage: spent,
        dispatch_records: [
          ...(controller.dispatch_records || []),
          dispatchRecord,
        ],
        audit_events: [
          ...(controller.audit_events || []),
          {
            ...dispatchAuditBody,
            at: new Date().toISOString(),
            digest: canonicalDigest(dispatchAuditBody),
          },
        ],
      });
    }
    if (mutation.no_op === true
        && mutation.status === 'no_op'
        && mutation.dispatcher_called === false
        && mutation.model_calls === 0
        && mutation.mutation_attempts === 0
        && mutation.gate_attempts === 0
        && mutation.resources_created === 0
        && isCanonicalSha256(mutation.zero_diff_receipt_digest)) {
      persistController({
        ...controller,
        phase: 'SEALED_ZERO_DIFF',
        next_action: 'release_no_effect_admission',
      });
      trace.push('sealed_zero_diff_noop');
      return {
        stop: {
          status: 'no_op',
          phase: 'sealed_zero_diff',
          reason: null,
          no_op: true,
          dispatcher_called: false,
          mutation_attempts: 0,
          gate_attempts: 0,
          resources_created: 0,
          zero_diff_receipt_digest: mutation.zero_diff_receipt_digest,
          controller,
          trace,
          terminalize: false,
        },
      };
    }
    try {
      appendRoundProgress(kind === 'initial' ? 'IMPLEMENTING' : 'REPAIRING');
    } catch (error) {
      return {
        stop: blocked(
          'progress_receipt',
          error.message || String(error),
          trace,
          { code: error.code || 'PROGRESS_RECEIPT_FAILED', controller },
        ),
      };
    }
    trace.push(kind === 'initial' ? 'implement' : 'repair');
    const boundary = classifyBoundaryRejected(mutation);
    if (boundary) {
      if (mutation.committed === true || boundary.candidate_ref) {
        candidate = mutation.committed === true ? mutation : {
          ...mutation,
          committed: Boolean(boundary.candidate_ref),
          commit: boundary.candidate_ref,
        };
      }
      const bound = boundaryRejected(boundary, trace, {
        candidate,
        controller,
        durable_wait: true,
        terminalize: false,
      });
      appendRoundProgress(BOUNDARY_REJECTED, bound.reason);
      emitCampaignEvent('BOUNDARY_REJECTED', {
        reason: bound.reason,
        boundary_reason: bound.boundary_reason,
        candidate_ref: bound.candidate_ref,
        boundary_receipt_digest: canonicalDigest({
          candidate_ref: bound.candidate_ref,
          boundary_reason: bound.boundary_reason,
          boundary_code: bound.boundary_code,
        }),
      });
      persistController({
        ...controller,
        phase: BOUNDARY_REJECTED,
        next_action: 'await_boundary_disposition',
      });
      return { stop: { ...bound, controller } };
    }
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

  // Awaiting-disposition resume: one-shot reuse of bound candidate/verification/
  // full-diff review/gates/findings; call only the missing disposition authority.
  let dispositionOnlyResume = Boolean(
    resume
    && (resume.phase === AWAITING_DISPOSITION
      || resume.phase === 'AWAITING_DISPOSITION'),
  );
  let dispositionResumedEmitted = false;
  if (dispositionOnlyResume) {
    trace.push('resume_disposition_only');
    candidate = resume.candidate;
    if (!isObj(resume.verification) || !isStr(resume.verification.receipt_digest)) {
      throw new CampaignCompositionError(
        'DISPOSITION_RESUME_INCOMPLETE',
        'awaiting-disposition resume requires persisted verification receipt',
      );
    }
    if (!isObj(resume.review) || !isStr(resume.review.review_digest)) {
      throw new CampaignCompositionError(
        'DISPOSITION_RESUME_INCOMPLETE',
        'awaiting-disposition resume requires persisted full-diff review payload',
      );
    }
    verification = resume.verification;
    lastReview = resume.review;
    if (isObj(resume.full_diff_barriers)) {
      fullDiffBarriers = { ...fullDiffBarriers, ...resume.full_diff_barriers };
    }
  } else if (resume) {
    trace.push(resume.phase === 'ADJUDICATING'
      ? 'resume_replay_bound_review'
      : 'resume_adopt_candidate');
  } else {
    const mutationResult = mutate('initial');
    if (mutationResult.stop) return mutationResult.stop;
  }

  // Authoritative full-diff for the current candidate generation. Focused
  // delta may supplement but never replaces this barrier.
  // Production gate reuse: identical green full-diff input reuses the journal
  // entry without calling the review adapter again.
  const ensureFullDiffBarrier = (verticalFailed = false) => {
    const candidateRef = candidate && (candidate.commit || candidate.tree_sha) || null;
    // Gate journal key binds generation + candidate + sealed inputs — never
    // generation alone (early-return without candidate match is forbidden).
    const gateInput = {
      generation: repairGeneration,
      candidate_ref: candidateRef,
      base_sha: candidate && candidate.base_sha || input.baseSha || null,
      contract_digest: input.campaignContractDigest || null,
      strict_contract_digest: input.strictContractDigest || null,
      graph_node_id: input.graphNodeId || null,
      work_order_id: input.workOrderId || null,
      root_run_id: input.rootRunId || null,
      verification_receipt_digest: verification && verification.receipt_digest || null,
      vertical_failed: verticalFailed === true,
    };
    const reusable = findReusableGate(controller.gate_journal, 'full_diff_review', gateInput);
    if (reusable && reusable.result && reusable.result.success === true) {
      trace.push('full_diff_gate_reused');
      fullDiffBarriers = recordFullDiffBarrier(fullDiffBarriers, repairGeneration, {
        success: true,
        review_digest: reusable.result.review_digest || null,
        candidate_ref: candidateRef,
        base_sha: gateInput.base_sha,
      });
      lastReview = {
        reviewed: true,
        success: true,
        review_input_mode: 'full_diff_generation',
        review_digest: reusable.result.review_digest || null,
        findings: reusable.result.findings || '[]',
        verdict: reusable.result.verdict || null,
        gate_reused: true,
      };
      return { stop: null, review: lastReview };
    }
    // Reservation identity must survive restart/gate reuse.  The reusable
    // verification object carries transport-only fields (gate_reused and gate
    // timestamps) that were absent on the original invocation, so bind and
    // review the durable verification facts rather than those replay markers.
    const reviewVerification = isObj(verification) ? {
      passed: verification.passed === true,
      receipt_digest: isStr(verification.receipt_digest)
        ? verification.receipt_digest : null,
      ...(typeof verification.retriable === 'boolean'
        ? { retriable: verification.retriable } : {}),
      ...(isStr(verification.phase) ? { phase: verification.phase } : {}),
      ...(isStr(verification.reason) ? { reason: verification.reason } : {}),
    } : null;
    const reviewPayload = {
      candidate,
      verification: reviewVerification,
      repair_generation: repairGeneration,
      scope: 'full_diff',
      review_input_mode: 'full_diff_generation',
      vertical_failed: verticalFailed === true,
    };
    const preparedReview = prepareReview
      ? requireReceipt(prepareReview(reviewPayload), 'prepareReview')
      : {
        authority: {
          schema_version: 1,
          artifact_type: 'controller_full_diff_review_input',
          candidate_ref: candidateRef || 'unbound-candidate',
          candidate_tree_sha: candidate && candidate.tree_sha
            ? candidate.tree_sha : 'unbound-tree',
          base_sha: gateInput.base_sha || 'unbound-base',
          diff_digest: canonicalDigest({
            synthetic_diff: {
              base_sha: gateInput.base_sha || null,
              candidate_ref: candidateRef,
              candidate_tree_sha: candidate && candidate.tree_sha || null,
            },
          }),
          spec_digest: canonicalDigest({
            prompt_file: input.promptFile || null,
            contract_digest: input.campaignContractDigest || null,
          }),
          review_input_digest: canonicalDigest(reviewPayload),
          reviewer: {
            runner: input.reviewerRunner || 'synthetic-reviewer',
            model: input.reviewerModel || 'synthetic-reviewer',
            effort: input.reviewerEffort || 'synthetic',
            endpoint: input.reviewerEndpoint || null,
          },
        },
        diff_file: null,
        spec_file: input.promptFile || null,
      };
    const reviewAuthority = validateReviewAuthority(
      preparedReview.authority,
      reviewPayload,
    );
    const reviewInputBytes = effectInputBytes(reviewPayload);
    const reviewAdmission = admitEffect({
      stage: 'full_diff_review',
      wouldCreateWorktree: false,
      modelCalls: 1,
      freshInputBytes: reviewInputBytes,
    });
    if (!reviewAdmission.ok) {
      return {
        stop: blocked(
          reviewAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
          reviewAdmission.reason,
          trace,
          {
            code: reviewAdmission.code,
            candidate,
            durable_wait: true,
            terminalize: false,
            controller,
          },
        ),
      };
    }
    const reviewReservation = reserveEffectInvocation({
      stage: 'full_diff_review',
      effectKind: 'gate',
      inputIdentity: canonicalDigest({
        gate_input: gateInput,
        review_payload: reviewPayload,
        review_authority: reviewAuthority,
      }),
      authority: reviewAuthority,
    });
    if (!reviewReservation.ok) {
      persistController({
        ...controller,
        phase: 'AWAITING_EFFECT_RECONCILIATION',
        next_action: 'reconcile_full_diff_review',
      });
      return {
        stop: blocked(
          'effect_reconciliation',
          reviewReservation.reason,
          trace,
          {
            code: reviewReservation.code,
            reservation_identity: reviewReservation.reservation_identity,
            candidate,
            durable_wait: true,
            terminalize: false,
            controller,
          },
        ),
      };
    }
    const fullDiff = requireReceipt(review({
      ...reviewPayload,
      prepared_review: preparedReview,
      reservation_identity: reviewReservation.reservation_identity,
    }), 'review');
    const fullDiffResultIdentity = canonicalDigest(fullDiff);
    const fullDiffInvocationIdentity = chargeEffect({
      stage: 'full_diff_review',
      effectKind: 'gate',
      resultIdentity: fullDiffResultIdentity,
      reservationIdentity: reviewReservation.reservation_identity,
      modelCalls: Number.isSafeInteger(fullDiff.model_calls) ? fullDiff.model_calls : 1,
      freshInputBytes: Number.isSafeInteger(fullDiff.fresh_input_bytes)
        ? fullDiff.fresh_input_bytes : reviewInputBytes,
      freshInputTokens: Number.isSafeInteger(fullDiff.fresh_input_tokens)
        ? fullDiff.fresh_input_tokens : null,
    });
    trace.push('full_diff_review');
    const fullDiffSuccess = (fullDiff.reviewed === true || fullDiff.success === true)
      && fullDiff.review_input_mode !== 'focused_delta_round'
      && fullDiff.focused_only !== true;
    const priorLiveGates = Array.isArray(controller.gate_journal && controller.gate_journal.entries)
      ? controller.gate_journal.entries.filter((e) => (
        e.kind === 'full_diff_review'
        && e.result
        && e.result.success === true
        && !e.invalidated
      ))
      : [];
    const gate = recordGateEntry(controller.gate_journal, {
      kind: 'full_diff_review',
      owner: 'depth-0',
      input: gateInput,
      result: {
        success: fullDiffSuccess,
        review_digest: fullDiff.review_digest || fullDiff.receipt_digest || null,
        findings: fullDiff.findings || null,
        verdict: fullDiff.verdict || null,
      },
      startedAt: fullDiff.started_at || new Date().toISOString(),
      finishedAt: fullDiff.finished_at || new Date().toISOString(),
      invalidateReason: fullDiffSuccess && priorLiveGates.length > 0
        ? `generation ${repairGeneration} supersedes prior full-diff gate`
        : null,
    });
    persistGateResult(gate, fullDiffInvocationIdentity, fullDiffResultIdentity);
    if (fullDiff.reviewed !== true && fullDiff.success !== true) {
      // Accept either reviewed=true (legacy) or success=true (controller barrier).
      if (fullDiff.review_input_mode === 'focused_delta_round' || fullDiff.focused_only === true) {
        return {
          stop: blocked(
            'full_diff_before_repair',
            'focused-only verdict cannot satisfy the generation full-diff barrier',
            trace,
            { candidate, full_diff_barrier_required: true },
          ),
        };
      }
      return {
        stop: blocked(
          fullDiff.phase || 'full_diff_review',
          fullDiff.reason || 'authoritative full-diff review unavailable',
          trace,
          { candidate },
        ),
      };
    }
    if (fullDiff.review_input_mode === 'focused_delta_round' || fullDiff.focused_only === true) {
      return {
        stop: blocked(
          'full_diff_before_repair',
          'focused-only verdict cannot satisfy the generation full-diff barrier',
          trace,
          { candidate, full_diff_barrier_required: true },
        ),
      };
    }
    fullDiffBarriers = recordFullDiffBarrier(fullDiffBarriers, repairGeneration, {
      success: true,
      review_digest: fullDiff.review_digest || fullDiff.receipt_digest || null,
      candidate_ref: candidateRef,
      base_sha: gateInput.base_sha,
    });
    persistController({
      ...controller,
      full_diff_barriers: fullDiffBarriers,
    });
    lastReview = fullDiff;
    return { stop: null, review: fullDiff };
  };

  for (;;) {
    if (!dispositionOnlyResume) {
    // Lookup reusable focused verification BEFORE the effect (never verify then search).
    {
      const vInput = {
        generation: repairGeneration,
        candidate_ref: candidate && (candidate.commit || candidate.tree_sha) || null,
        base_sha: candidate && candidate.base_sha || input.baseSha || null,
        contract_digest: input.campaignContractDigest || null,
        work_order_id: input.workOrderId || null,
        root_run_id: input.rootRunId || null,
      };
      const reusableV = findReusableGate(controller.gate_journal, 'focused_verification', vInput);
      if (reusableV && reusableV.result && reusableV.result.success === true) {
        verification = {
          passed: true,
          receipt_digest: reusableV.result.receipt_digest || null,
          gate_reused: true,
          started_at: reusableV.started_at,
          finished_at: reusableV.finished_at,
        };
        trace.push('focused_verification_gate_reused');
      } else {
        const wouldSpendModel = input.verificationSpendsModelCall === true
          || (typeof adapters.verifyWouldSpendModelCall === 'function'
            && adapters.verifyWouldSpendModelCall() === true);
        const verifyAdmission = admitEffect({
          stage: 'focused_verification',
          // Production verification uses a detached checkout.  A custom
          // adapter can explicitly prove it does not via this flag.
          wouldCreateWorktree: input.verificationCreatesWorktree !== false,
          modelCalls: wouldSpendModel ? 1 : 0,
          freshInputBytes: 0,
        });
        if (!verifyAdmission.ok) {
          return blocked(
            verifyAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
            verifyAdmission.reason,
            trace,
            {
              code: verifyAdmission.code,
              candidate,
              durable_wait: true,
              terminalize: false,
              controller,
            },
          );
        }
        verification = requireReceipt(verify({
          candidate,
          repair_generation: repairGeneration,
        }), 'verify');
        const verificationResultIdentity = canonicalDigest(verification);
        const verificationInvocationIdentity = chargeEffect({
          stage: 'focused_verification',
          effectKind: 'gate',
          resultIdentity: verificationResultIdentity,
          modelCalls: wouldSpendModel ? 1 : 0,
          freshInputBytes: 0,
          freshInputTokens: Number.isSafeInteger(verification.fresh_input_tokens)
            ? verification.fresh_input_tokens : null,
        });
        const priorLiveV = Array.isArray(controller.gate_journal && controller.gate_journal.entries)
          ? controller.gate_journal.entries.filter((e) => (
            e.kind === 'focused_verification'
            && e.result
            && e.result.success === true
            && !e.invalidated
          ))
          : [];
        let vInvalidate = null;
        if (verification.passed === true && priorLiveV.length > 0) {
          vInvalidate = `generation ${repairGeneration} supersedes prior focused verification`;
        }
        const vGate = recordGateEntry(controller.gate_journal, {
          kind: 'focused_verification',
          owner: 'depth-0',
          input: vInput,
          result: {
            success: verification.passed === true,
            receipt_digest: verification.receipt_digest || null,
          },
          startedAt: verification.started_at || new Date().toISOString(),
          finishedAt: verification.finished_at || new Date().toISOString(),
          invalidateReason: vInvalidate,
        });
        persistGateResult(
          vGate,
          verificationInvocationIdentity,
          verificationResultIdentity,
        );
        trace.push('verify');
      }
    }
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
      // Contract: first candidate still gets authoritative full-diff before any repair,
      // including when vertical verification failed.
      const barrierResult = ensureFullDiffBarrier(true);
      if (barrierResult.stop) return barrierResult.stop;
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
      }], 'full_diff_generation');
      if (mutationResult.stop) return mutationResult.stop;
      continue;
    }

    // Authoritative full-diff is the generation barrier. Adapters may still
    // return the legacy `reviewed` shape; focused_delta_round alone cannot pass.
    const barrierResult = ensureFullDiffBarrier(false);
    if (barrierResult.stop) return barrierResult.stop;
    if (lastReview && !lastReview.review_input_mode) {
      lastReview.review_input_mode = 'full_diff_generation';
    }
    // Optional focused supplement never replaces the barrier and is not one of
    // the frozen four authoritative gate kinds.  Do not mislabel it as the
    // joint-review panel merely to gain reuse.
    if (typeof adapters.focusedReview === 'function') {
      const focusedPayload = {
        candidate,
        verification,
        repair_generation: repairGeneration,
        scope: 'focused',
        review_input_mode: 'focused_delta_round',
      };
      const focusedInputBytes = effectInputBytes(focusedPayload);
      const focusedAdmission = admitEffect({
        stage: 'focused_review_supplement',
        wouldCreateWorktree: false,
        modelCalls: 1,
        freshInputBytes: focusedInputBytes,
      });
      if (!focusedAdmission.ok) {
        return blocked(
          focusedAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
          focusedAdmission.reason,
          trace,
          {
            code: focusedAdmission.code,
            candidate,
            durable_wait: true,
            terminalize: false,
            controller,
          },
        );
      }
      const focused = requireReceipt(
        adapters.focusedReview(focusedPayload),
        'focusedReview',
      );
      const focusedResultIdentity = canonicalDigest(focused);
      const focusedInvocationIdentity = chargeEffect({
        stage: 'focused_review_supplement',
        effectKind: 'supplemental_review',
        resultIdentity: focusedResultIdentity,
        modelCalls: Number.isSafeInteger(focused.model_calls) ? focused.model_calls : 1,
        freshInputBytes: Number.isSafeInteger(focused.fresh_input_bytes)
          ? focused.fresh_input_bytes : focusedInputBytes,
        freshInputTokens: Number.isSafeInteger(focused.fresh_input_tokens)
          ? focused.fresh_input_tokens : null,
      });
      persistSupplementalEffectResult({
        effectKind: 'supplemental_review',
        invocationIdentity: focusedInvocationIdentity,
        resultIdentity: focusedResultIdentity,
        stage: 'focused_review_supplement',
        result: focused,
      });
      trace.push('focused_review_supplement');
      if (focused && (focused.reviewed === true || focused.success === true)) {
        lastReview = {
          ...lastReview,
          focused_supplement: focused,
          review_input_mode: 'full_diff_generation',
        };
      }
    }

    // Full suite only when the adapter is present and the suite actually runs.
    if (typeof adapters.fullSuite === 'function') {
      const sInput = {
        generation: repairGeneration,
        candidate_ref: candidate && (candidate.commit || candidate.tree_sha) || null,
        base_sha: candidate && candidate.base_sha || input.baseSha || null,
        contract_digest: input.campaignContractDigest || null,
        strict_contract_digest: input.strictContractDigest || null,
        work_order_id: input.workOrderId || null,
        root_run_id: input.rootRunId || null,
        command_digest: input.fullSuiteCommandDigest || null,
        suite: 'full',
      };
      if (!isCanonicalSha256(sInput.command_digest)) {
        return blocked(
          'full_suite',
          'full suite requires the canonical sealed verification-command digest before effects',
          trace,
          {
            code: 'FULL_SUITE_COMMAND_DIGEST_MISSING',
            candidate,
            terminalize: false,
          },
        );
      }
      const reusableS = findReusableGate(controller.gate_journal, 'full_suite', sInput);
      const reusableCommandBound = reusableS
        && reusableS.result
        && reusableS.result.command_digest === sInput.command_digest;
      if (reusableS
          && reusableS.result
          && reusableS.result.success === true
          && reusableCommandBound) {
        trace.push('full_suite_gate_reused');
      } else {
        const suiteAdmission = admitEffect({
          stage: 'full_suite',
          wouldCreateWorktree: input.fullSuiteCreatesWorktree !== false,
          modelCalls: 0,
          freshInputBytes: 0,
        });
        if (!suiteAdmission.ok) {
          return blocked(
            suiteAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
            suiteAdmission.reason,
            trace,
            {
              code: suiteAdmission.code,
              candidate,
              durable_wait: true,
              terminalize: false,
              controller,
            },
          );
        }
        const suite = requireReceipt(adapters.fullSuite({
          candidate,
          verification,
          repair_generation: repairGeneration,
        }), 'fullSuite');
        const suiteResultIdentity = canonicalDigest(suite);
        const suiteInvocationIdentity = chargeEffect({
          stage: 'full_suite',
          effectKind: 'gate',
          resultIdentity: suiteResultIdentity,
          modelCalls: Number.isSafeInteger(suite.model_calls) ? suite.model_calls : 0,
          freshInputBytes: Number.isSafeInteger(suite.fresh_input_bytes)
            ? suite.fresh_input_bytes : 0,
          freshInputTokens: Number.isSafeInteger(suite.fresh_input_tokens)
            ? suite.fresh_input_tokens : null,
        });
        trace.push(suite.executed === true ? 'full_suite' : 'full_suite_setup');
        const priorLiveS = Array.isArray(controller.gate_journal && controller.gate_journal.entries)
          ? controller.gate_journal.entries.filter((e) => (
            e.kind === 'full_suite'
            && e.result && e.result.success === true
            && !e.invalidated
          ))
          : [];
        const commandBound = isCanonicalSha256(sInput.command_digest)
          && suite.command_digest === sInput.command_digest;
        const suiteSuccess = suite.executed === true
          && suite.passed === true
          && commandBound;
        const sGate = recordGateEntry(controller.gate_journal, {
          kind: 'full_suite',
          owner: 'depth-0',
          input: sInput,
          result: {
            success: suiteSuccess,
            receipt_digest: suite.receipt_digest || null,
            command_digest: suite.command_digest || null,
          },
          startedAt: suite.started_at || new Date().toISOString(),
          finishedAt: suite.finished_at || new Date().toISOString(),
          invalidateReason: suiteSuccess && priorLiveS.length > 0
            ? `generation ${repairGeneration} supersedes prior full suite`
            : null,
        });
        persistGateResult(sGate, suiteInvocationIdentity, suiteResultIdentity);
        if (!suiteSuccess) {
          return blocked(
            'full_suite',
            !commandBound
              ? 'full suite result does not bind the sealed verification command'
              : (suite.reason || 'full suite did not execute and pass'),
            trace,
            { candidate, suite },
          );
        }
      }
    }

    } // end !dispositionOnlyResume (verify + full-diff + focused)

    // Resume path may re-bind prior findings awaiting disposition.
    const reviewForAdjudication = resumeFindings
      && (resume.phase === AWAITING_DISPOSITION
        || resume.phase === 'AWAITING_DISPOSITION'
        || dispositionOnlyResume)
      ? { ...lastReview, findings: resumeFindings }
      : lastReview;

    const adjudication = requireReceipt(adjudicate({
      review: reviewForAdjudication,
      repair_generation: repairGeneration,
      final: false,
      disposition_only: dispositionOnlyResume === true,
    }), 'adjudicate');
    if (dispositionOnlyResume && !dispositionResumedEmitted) {
      if (adjudication.registry_complete !== true
          || !isStr(adjudication.registry_digest)) {
        return blocked(
          'disposition_resume',
          'DISPOSITION_RESUMED requires a complete registry and real registry_digest',
          trace,
          { candidate, adjudication, resumable: false },
        );
      }
      emitCampaignEvent('DISPOSITION_RESUMED', {
        registry_complete: adjudication.registry_complete === true,
        registry_digest: adjudication.registry_digest,
      });
      dispositionResumedEmitted = true;
      // One-shot: subsequent loop iterations are ordinary post-adjudication flow.
      dispositionOnlyResume = false;
    }
    trace.push('adjudicate');
    if (adjudication.registry_complete !== true) {
      // Closed enum only: identity-invalid findings never enter resumable wait.
      // Free-text /authority|disposition/ matching is forbidden (false wait escape).
      const identityInvalid = adjudication.error_code === 'FINDING_IDENTITY_INVALID'
        || adjudication.error_code === 'INVALID_FINDING_IDENTITY';
      if (identityInvalid) {
        return blocked(
          'adjudication',
          adjudication.reason || 'malformed or identity-mismatched findings remain fail-closed',
          trace,
          {
            candidate,
            adjudication,
            code: adjudication.error_code,
            resumable: false,
          },
        );
      }
      const missing = classifyMissingDisposition({
        findings: adjudication.findings
          || (reviewForAdjudication && reviewForAdjudication.findings)
          || [],
        dispositionAuthority: adjudication.disposition_authority || null,
        findingsIdentityOk: true,
      });
      // Incomplete registry without identity failure is a durable disposition wait:
      // - exact AWAITING_DISPOSITION from classifyMissingDisposition
      // - closed AUTHORITY_REQUIRED enum
      // - missing disposition_authority on an incomplete registry (no free-text match)
      // Hard-fail classifications remain blocked. Never invent terminal success.
      const incompleteIsDurableWait = missing.status === AWAITING_DISPOSITION
        || adjudication.error_code === 'AUTHORITY_REQUIRED'
        || (missing.status !== 'hard_fail'
          && adjudication.disposition_authority == null);
      if (incompleteIsDurableWait) {
        const wait = awaitingDisposition(
          adjudication.reason || missing.reason || 'awaiting disposition authority',
          trace,
          {
            candidate,
            verification,
            review: lastReview,
            findings: missing.findings || adjudication.must_fix_now || [],
            repair_generations: repairGeneration,
            full_diff_barriers: fullDiffBarriers,
            work_order_resumable: true,
            controller,
          },
        );
        emitCampaignEvent('AWAITING_DISPOSITION', {
          reason: wait.reason,
          findings_digest: canonicalDigest(wait.findings || []),
          candidate_ref: candidate && (candidate.commit || candidate.tree_sha) || null,
        });
        appendRoundProgress(AWAITING_DISPOSITION, wait.reason);
        persistController({
          ...controller,
          phase: AWAITING_DISPOSITION,
          next_action: 'await_disposition_authority',
          unresolved_findings: wait.findings || [],
          verification_receipt: verification || null,
          review_payload: lastReview || null,
          findings_snapshot: wait.findings || [],
          full_diff_barriers: fullDiffBarriers,
          // Exact candidate lineage for production one-shot disposition resume.
          candidate: candidate || null,
          accepted_commit: candidate && (candidate.commit || null),
        });
        return wait;
      }
      return blocked(
        'adjudication',
        adjudication.reason || 'finding registry is incomplete',
        trace,
        { candidate, adjudication },
      );
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
    // Repair may use focused delta for the prompt, but the generation barrier
    // was already recorded as full_diff above.
    repairGeneration += 1;
    const mutationResult = mutate(
      'review_repair',
      mustFix,
      lastReview.review_input_mode || 'full_diff_generation',
    );
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

  // Final joint review/panel: lookup exact input before effect.
  let terminalReview;
  {
    const jInput = {
      generation: repairGeneration,
      candidate_ref: candidate && (candidate.commit || candidate.tree_sha) || null,
      base_sha: candidate && candidate.base_sha || input.baseSha || null,
      contract_digest: input.campaignContractDigest || null,
      strict_contract_digest: input.strictContractDigest || null,
      graph_node_id: input.graphNodeId || null,
      work_order_id: input.workOrderId || null,
      root_run_id: input.rootRunId || null,
      verification_receipt_digest: verification && verification.receipt_digest || null,
      panel: true,
      min_panel_size: minPanelSize,
    };
    const reusableJ = findReusableGate(controller.gate_journal, 'joint_review', jInput);
    if (reusableJ && reusableJ.result && reusableJ.result.success === true
        && Array.isArray(reusableJ.result.seat_receipts)
        && reusableJ.result.seat_receipts.length >= minPanelSize) {
      const reusablePanelCount = reusableJ.result.seat_receipts
        .filter((seat) => seat && seat.status === 'reviewed').length;
      terminalReview = {
        ...reusableJ.result,
        reviewed: true,
        success: true,
        gate_reused: true,
        sealed_min_panel_size: Number.isSafeInteger(
          reusableJ.result.sealed_min_panel_size,
        )
          ? reusableJ.result.sealed_min_panel_size
          : minPanelSize,
        final_panel_count: Number.isSafeInteger(reusableJ.result.final_panel_count)
          ? reusableJ.result.final_panel_count
          : reusablePanelCount,
        final_panel_seat_receipts: reusableJ.result.seat_receipts,
      };
      trace.push('final_panel_gate_reused');
    } else {
      const panelPayload = {
        candidate,
        verification,
        focused_review: lastReview,
        repair_generation: repairGeneration,
      };
      const panelInputBytes = effectInputBytes(panelPayload);
      const panelAdmission = admitEffect({
        stage: 'joint_review',
        wouldCreateWorktree: false,
        modelCalls: minPanelSize,
        freshInputBytes: panelInputBytes,
      });
      if (!panelAdmission.ok) {
        return blocked(
          panelAdmission.budget ? AWAITING_CONVERGENCE : 'resource_debt',
          panelAdmission.reason,
          trace,
          {
            code: panelAdmission.code,
            candidate,
            durable_wait: true,
            terminalize: false,
            controller,
          },
        );
      }
      terminalReview = requireReceipt(finalPanel(panelPayload), 'finalPanel');
      const panelResultIdentity = canonicalDigest(terminalReview);
      const panelInvocationIdentity = chargeEffect({
        stage: 'joint_review',
        effectKind: 'gate',
        resultIdentity: panelResultIdentity,
        modelCalls: Number.isSafeInteger(terminalReview.model_calls)
          ? terminalReview.model_calls : minPanelSize,
        freshInputBytes: Number.isSafeInteger(terminalReview.fresh_input_bytes)
          ? terminalReview.fresh_input_bytes : panelInputBytes,
        freshInputTokens: Number.isSafeInteger(terminalReview.fresh_input_tokens)
          ? terminalReview.fresh_input_tokens : null,
      });
      trace.push('final_panel');
      const panelValidationEarly = validateFinalPanelReceipt(terminalReview, minPanelSize);
      const priorLiveJ = Array.isArray(controller.gate_journal && controller.gate_journal.entries)
        ? controller.gate_journal.entries.filter((e) => (
          e.kind === 'joint_review'
          && e.result && e.result.success === true
          && !e.invalidated
          && e.input && e.input.panel === true
        ))
        : [];
      const jGate = recordGateEntry(controller.gate_journal, {
        kind: 'joint_review',
        owner: 'depth-0',
        input: jInput,
        result: {
          success: panelValidationEarly.passed === true,
          sealed_min_panel_size: panelValidationEarly.sealed_min_panel_size,
          final_panel_count: panelValidationEarly.final_panel_count,
          seat_receipts: panelValidationEarly.final_panel_seat_receipts || [],
          review_digest: terminalReview.review_digest || terminalReview.receipt_digest || null,
        },
        startedAt: terminalReview.started_at || new Date().toISOString(),
        finishedAt: terminalReview.finished_at || new Date().toISOString(),
        invalidateReason: panelValidationEarly.passed === true && priorLiveJ.length > 0
          ? `generation ${repairGeneration} supersedes prior final panel`
          : null,
      });
      persistGateResult(jGate, panelInvocationIdentity, panelResultIdentity);
    }
  }
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
  const terminal = {
    ...receiptBody,
    receipt_digest: canonicalDigest(receiptBody),
  };
  // Mission-backed READY is not complete until the Mission terminal journal
  // applies.  The Engine appends COMPLETED only after that reconciliation.
  // Standalone campaigns and nonterminal follow-up retain their local progress.
  if (status !== 'ready' || !isStr(input.missionLineageId)) {
    try {
      appendRoundProgress(status === 'ready' ? 'COMPLETED' : 'FOLLOW_UP');
    } catch (error) {
      return blocked(
        'progress_receipt',
        error.message || String(error),
        trace,
        { code: error.code || 'PROGRESS_RECEIPT_FAILED', controller },
      );
    }
  }

  // Persist historical_outputs / noop_receipt on the same controller Work Order
  // before Mission terminal reconciliation (F4/F5).
  const internalMetadata = {};
  if (status === 'ready'
      && isStr(input.gitCwd || input.repo)
      && candidate
      && isStr(candidate.commit)
      && Array.isArray(input.historicalOutputPaths)
      && input.historicalOutputPaths.length > 0) {
    try {
      const hist = buildHistoricalOutputsAtCommit({
        gitCwd: input.gitCwd || input.repo,
        acceptedCommit: candidate.commit,
        paths: input.historicalOutputPaths,
        binding: {
          repo_identity: input.repoIdentity || null,
          mission_lineage_id: input.missionLineageId || null,
          mission_policy_digest: input.missionPolicyDigest || null,
          mission_graph_digest: input.missionGraphDigest || null,
          graph_node_id: input.graphNodeId || null,
          graph_attempt: input.graphAttempt || null,
          mission_claim_id: input.missionClaimId || null,
          mission_campaign_id: input.missionCampaignId || null,
          icc_campaign_id: input.rootRunId || input.workOrderId || null,
          campaign_contract_digest: input.campaignContractDigest || null,
          strict_contract_digest: input.strictContractDigest || null,
          base_sha: input.baseSha || candidate.base_sha || null,
          acceptance_digest: terminal.receipt_digest,
          verification_digest: verification && verification.receipt_digest,
        },
      });
      const noop = buildNoOpReceipt({
        // No-op adoption is evaluated against the later admission HEAD.  Bind
        // that to the accepted commit, while historical_outputs.base_sha keeps
        // the original Mission claim base separately.
        baseSha: candidate.commit,
        acceptanceDigest: terminal.receipt_digest,
        pathByteDigests: hist.outputs,
        binding: {
          repo_identity: input.repoIdentity || null,
          mission_lineage_id: input.missionLineageId || null,
          mission_policy_digest: input.missionPolicyDigest || null,
          mission_graph_digest: input.missionGraphDigest || null,
          graph_node_id: input.graphNodeId || null,
          graph_attempt: input.graphAttempt || null,
          mission_claim_id: input.missionClaimId || null,
          mission_campaign_id: input.missionCampaignId || null,
          icc_campaign_id: input.rootRunId || null,
          campaign_contract_digest: input.campaignContractDigest || null,
          strict_contract_digest: input.strictContractDigest || null,
          accepted_commit: candidate.commit,
          verification_digest: verification && verification.receipt_digest,
        },
      });
      // Persist the full historical record; digest is over that closed body only.
      persistController({
        ...controller,
        phase: status === 'ready' ? 'COMPLETED' : controller.phase,
        next_action: status === 'ready' ? 'terminal' : controller.next_action,
        accepted_commit: candidate.commit,
        historical_outputs: hist.record,
        historical_outputs_digest: hist.digest,
        noop_receipt: noop,
        verification_receipt: verification || null,
        review_payload: lastReview || null,
      });
      internalMetadata.historical_outputs_digest = hist.digest;
      internalMetadata.historical_outputs = hist.record;
      internalMetadata.noop_receipt_digest = noop.digest;
    } catch (error) {
      return blocked(
        'historical_outputs',
        error.message || String(error),
        trace,
        { code: error.code || 'HISTORICAL_OUTPUTS_FAILED', controller },
      );
    }
  } else {
    // Terminalize controller phase on success even without historical path set.
    persistController({
      ...controller,
      phase: status === 'ready' ? 'COMPLETED' : 'FOLLOW_UP',
      next_action: status === 'ready' ? 'terminal' : 'follow_up',
      accepted_commit: candidate && candidate.commit ? candidate.commit : null,
      verification_receipt: verification || null,
      review_payload: lastReview || null,
    });
  }

  // Controller metadata stays off the exact terminal receipt key set so LSM /
  // task-status validators remain backward compatible. Callers that need the
  // barrier map / controller CAS payload can pass includeControllerMeta: true.
  if (input.includeControllerMeta === true) {
    internalMetadata.full_diff_barriers = fullDiffBarriers;
    internalMetadata.controller = controller;
    internalMetadata.controller_state = controller;
  }
  // Internal return metadata remains directly readable by the Engine but is
  // deliberately non-enumerable: JSON/schema/digest consumers see the exact
  // sealed implementation_campaign_terminal receipt and no post-seal fields.
  for (const [key, value] of Object.entries(internalMetadata)) {
    Object.defineProperty(terminal, key, {
      value,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return terminal;
}

module.exports = {
  CampaignCompositionError,
  runCampaignComposition,
  validateFinalPanelReceipt,
  AWAITING_DISPOSITION,
  AWAITING_CONVERGENCE,
  BOUNDARY_REJECTED,
};
