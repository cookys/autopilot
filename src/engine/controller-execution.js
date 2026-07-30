'use strict';

/**
 * Controller Execution Discipline — project-level controller authority helpers.
 * Extends schema-2 Work Order / campaign / Mission rails without a parallel tracker.
 * When present, controller state is part of the Work Order canonical body and
 * integrity is bound by controller_digest + work-order digest CAS.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONTROLLER_SCHEMA = 1;
const PROGRESS_RECEIPT_ARTIFACT = 'controller_progress_receipt';
const GATE_JOURNAL_ARTIFACT = 'controller_gate_journal';
const RESOURCE_DEBT_ARTIFACT = 'controller_resource_debt';
const REPAIR_TICKET_ARTIFACT = 'controller_repair_ticket';
const ADOPTION_RECEIPT_ARTIFACT = 'controller_orphan_adoption_receipt';
const POSTCOMPACT_ADAPTER_ARTIFACT = 'controller_postcompact_adapter_receipt';

const GATE_KINDS = Object.freeze([
  'full_diff_review',
  'focused_verification',
  'full_suite',
  'joint_review',
]);

const REPAIR_BUDGET_AXES = Object.freeze([
  'model_calls',
  'fresh_input_bytes',
  'fresh_input_tokens',
  'elapsed_wall_ms',
  'owned_worktrees',
  'finding_recurrence',
]);

const RESOURCE_DISPOSITIONS = Object.freeze([
  'active',
  'terminal',
  'aborted',
  'unknown',
  'orphaned',
  'disposition_blocked',
  'released_clean',
  'retained_dirty',
  'retained_unique',
  'retained_unknown',
]);

const AWAITING_CONVERGENCE = 'awaiting_convergence_adjudication';
const AWAITING_DISPOSITION = 'awaiting_disposition';
const BOUNDARY_REJECTED = 'boundary_rejected';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const nowIso = (d = new Date()) => d.toISOString();
const sha256Text = (t) => crypto.createHash('sha256').update(String(t), 'utf8').digest('hex');
const sha256Json = (v) => sha256Text(JSON.stringify(v));

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function emptyBudgetUsage() {
  return {
    model_calls: 0,
    fresh_input_bytes: 0,
    fresh_input_tokens: null, // null = unobserved, never zero-fill
    elapsed_wall_ms: 0,
    owned_worktrees: 0,
    finding_recurrence: 0,
    observable_axes: ['model_calls', 'fresh_input_bytes', 'elapsed_wall_ms', 'owned_worktrees', 'finding_recurrence'],
    unobserved_axes: ['fresh_input_tokens'],
  };
}

function defaultBudgetLimits(overrides = {}) {
  return {
    model_calls: Number.isSafeInteger(overrides.model_calls) ? overrides.model_calls : 32,
    fresh_input_bytes: Number.isSafeInteger(overrides.fresh_input_bytes)
      ? overrides.fresh_input_bytes : 50_000_000,
    fresh_input_tokens: Number.isSafeInteger(overrides.fresh_input_tokens)
      ? overrides.fresh_input_tokens : null, // null = axis not enforced when unobserved
    elapsed_wall_ms: Number.isSafeInteger(overrides.elapsed_wall_ms)
      ? overrides.elapsed_wall_ms : 3_600_000,
    owned_worktrees: Number.isSafeInteger(overrides.owned_worktrees)
      ? overrides.owned_worktrees : 4,
    finding_recurrence: Number.isSafeInteger(overrides.finding_recurrence)
      ? overrides.finding_recurrence : 2,
  };
}

function buildFrozenDenominator({ projectId, graphDigest, deliverableIds, nodeId }) {
  if (!isStr(projectId)) fail('INVALID_DENOMINATOR', 'projectId required');
  if (!isStr(graphDigest) || !/^[0-9a-f]{64}$/.test(graphDigest)) {
    fail('INVALID_DENOMINATOR', 'graphDigest must be sha256 hex');
  }
  if (!Array.isArray(deliverableIds) || deliverableIds.length === 0) {
    fail('INVALID_DENOMINATOR', 'deliverableIds must be a non-empty array');
  }
  const ids = [...new Set(deliverableIds.map(String))].sort();
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    project_id: projectId,
    graph_digest: graphDigest,
    deliverable_ids: ids,
    deliverable_count: ids.length,
    active_node_id: nodeId || ids[0],
  };
  return { ...body, digest: sha256Json(body) };
}

function assertFrozenDenominatorStable(frozen, nextDeliverableIds) {
  if (!isObj(frozen) || !isStr(frozen.digest)) {
    fail('DENOMINATOR_MISSING', 'frozen denominator required');
  }
  if (Array.isArray(nextDeliverableIds)) {
    const next = [...new Set(nextDeliverableIds.map(String))].sort();
    const prior = [...(frozen.deliverable_ids || [])].sort();
    if (JSON.stringify(next) !== JSON.stringify(prior)) {
      fail(
        'DENOMINATOR_MUTATION',
        'findings/retries/tests cannot expand the frozen deliverable denominator',
      );
    }
  }
  const recomputed = sha256Json({
    schema_version: frozen.schema_version,
    project_id: frozen.project_id,
    graph_digest: frozen.graph_digest,
    deliverable_ids: frozen.deliverable_ids,
    deliverable_count: frozen.deliverable_count,
    active_node_id: frozen.active_node_id,
  });
  if (recomputed !== frozen.digest) {
    fail('DENOMINATOR_DIGEST_MISMATCH', 'frozen denominator digest mismatch');
  }
  return true;
}

function emptyGateJournal() {
  return {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: GATE_JOURNAL_ARTIFACT,
    entries: [],
  };
}

function gateInputDigest(kind, input) {
  return sha256Json({ kind, input: input == null ? null : input });
}

// Git object IDs: SHA-1 (40) or SHA-256 (64), lowercase hex only.
function isCanonicalGitObjectId(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(value);
}

function isCanonicalSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function recordGateEntry(journal, {
  kind,
  owner,
  input,
  result,
  startedAt,
  finishedAt,
  invalidateReason = null,
}) {
  if (!GATE_KINDS.includes(kind)) fail('INVALID_GATE_KIND', `unknown gate kind ${kind}`);
  if (!isStr(owner)) fail('INVALID_GATE_OWNER', 'gate owner required');
  if (!isStr(startedAt) || !isStr(finishedAt)) {
    fail('INVALID_GATE_TIMING', 'gate start/finish times required');
  }
  const j = isObj(journal) ? JSON.parse(JSON.stringify(journal)) : emptyGateJournal();
  if (!Array.isArray(j.entries)) j.entries = [];
  const inputDigest = gateInputDigest(kind, input);
  const success = Boolean(result && result.success === true);
  // Reuse matching successful result when inputs are identical and not invalidated.
  const matchingPrior = [...j.entries].reverse().find((e) => (
    e.kind === kind
    && e.input_digest === inputDigest
    && e.result
    && e.result.success === true
    && !e.invalidated
  ));
  if (matchingPrior && success && !invalidateReason) {
    return {
      journal: j,
      reused: true,
      entry: matchingPrior,
      reason: 'matching successful gate result reused',
    };
  }
  // Changed input under the same kind supersedes live successful gates and requires
  // an explicit non-empty invalidation reason. Failed/unrelated kinds are untouched.
  if (success) {
    const liveSameKind = j.entries.filter((e) => (
      e.kind === kind
      && e.result
      && e.result.success === true
      && !e.invalidated
      && e.input_digest !== inputDigest
    ));
    if (liveSameKind.length > 0) {
      if (typeof invalidateReason !== 'string' || invalidateReason.trim().length === 0) {
        fail(
          'GATE_INVALIDATION_REQUIRED',
          `successful ${kind} gate with changed input requires non-empty invalidateReason`,
        );
      }
      for (const entry of liveSameKind) {
        entry.invalidated = true;
        entry.invalidation_reason = invalidateReason;
      }
    } else if (matchingPrior && invalidateReason) {
      // Explicit re-record of the same input with invalidation: supersede the live match.
      matchingPrior.invalidated = true;
      matchingPrior.invalidation_reason = invalidateReason;
    }
  }
  const entry = {
    gate_id: `gate-${kind}-${j.entries.length + 1}`,
    kind,
    owner,
    root_run_id: isObj(input) && isStr(input.root_run_id) ? input.root_run_id : null,
    work_order_id: isObj(input) && isStr(input.work_order_id) ? input.work_order_id : null,
    input_digest: inputDigest,
    started_at: startedAt,
    finished_at: finishedAt,
    result: result || { success: false },
    invalidated: false,
    invalidation_reason: null,
  };
  j.entries.push(entry);
  j.digest = sha256Json({ schema_version: j.schema_version, artifact_type: j.artifact_type, entries: j.entries });
  return { journal: j, reused: false, entry };
}

function findReusableGate(journal, kind, input) {
  if (!isObj(journal) || !Array.isArray(journal.entries)) return null;
  const inputDigest = gateInputDigest(kind, input);
  return journal.entries.find((e) => (
    e.kind === kind
    && e.input_digest === inputDigest
    && e.result
    && e.result.success === true
    && !e.invalidated
  )) || null;
}

// Absolute axes: projected value IS the next absolute reading (not a delta).
const ABSOLUTE_BUDGET_AXES = new Set(['elapsed_wall_ms', 'owned_worktrees']);

function checkJointRepairBudget(usage, limits, {
  beforeSpend = true,
  // Projected positive spend for this next effect. Equality used==limit blocks
  // any positive projected spend on that axis. Absolute axes use projected as
  // the next absolute reading (wall clock from start; live owned worktree count).
  projectedDelta = null,
} = {}) {
  const u = { ...emptyBudgetUsage(), ...(usage || {}) };
  const lim = defaultBudgetLimits(limits || {});
  const projected = isObj(projectedDelta) ? projectedDelta : {};
  const exceeded = [];
  for (const axis of REPAIR_BUDGET_AXES) {
    if (axis === 'fresh_input_tokens') {
      // Unobserved remains null and is never treated as zero.
      if (u.fresh_input_tokens == null
          && (projected.fresh_input_tokens == null
            || projected.fresh_input_tokens === undefined)) {
        continue;
      }
      const usedTokens = u.fresh_input_tokens == null ? 0 : Number(u.fresh_input_tokens);
      const projTokens = Number.isSafeInteger(projected.fresh_input_tokens)
        ? projected.fresh_input_tokens : 0;
      // Only enforce when current usage or projected spend is observed.
      if (u.fresh_input_tokens == null && projTokens === 0) continue;
      if (lim.fresh_input_tokens != null) {
        const next = (u.fresh_input_tokens == null ? 0 : usedTokens) + projTokens;
        // used + positive may reach limit; only > limit rejects.
        // used == limit blocks next positive token spend.
        if (next > lim.fresh_input_tokens
            || (u.fresh_input_tokens != null
              && u.fresh_input_tokens >= lim.fresh_input_tokens
              && projTokens > 0)
            || (u.fresh_input_tokens != null && u.fresh_input_tokens > lim.fresh_input_tokens)) {
          exceeded.push(axis);
        }
      }
      continue;
    }
    const used = Number(u[axis] || 0);
    const proj = Number.isSafeInteger(projected[axis]) ? projected[axis] : 0;
    const limit = lim[axis];
    if (!Number.isSafeInteger(limit)) continue;
    if (ABSOLUTE_BUDGET_AXES.has(axis)) {
      // Projected absolute reading; missing projection uses current used.
      const nextAbs = Number.isSafeInteger(projected[axis]) ? proj : used;
      if (nextAbs > limit || (used >= limit && Number.isSafeInteger(projected[axis])
          && proj > used)) {
        // Absolute can grow only; if already at limit and next reading is higher, block.
        // If nextAbs > limit, block.
        if (nextAbs > limit) exceeded.push(axis);
        else if (used >= limit && proj > used) exceeded.push(axis);
      } else if (used > limit) {
        exceeded.push(axis);
      }
      continue;
    }
    // Cumulative axes: used + proj may reach limit; only > rejects.
    // used == limit blocks next positive delta.
    if (used > limit || (used + proj > limit) || (used >= limit && proj > 0)) {
      exceeded.push(axis);
    }
  }
  if (exceeded.length === 0) {
    return {
      ok: true,
      status: 'within_budget',
      exceeded: [],
      usage: u,
      limits: lim,
      allow_spend: true,
      projected: projectedDelta || null,
    };
  }
  return {
    ok: false,
    status: AWAITING_CONVERGENCE,
    phase: AWAITING_CONVERGENCE,
    exceeded,
    usage: u,
    limits: lim,
    allow_spend: false,
    projected: projectedDelta || null,
    reason: `joint repair budget exceeded on ${exceeded.join(',')}; stop before ${beforeSpend ? 'model/checkout' : 'further'} spend`,
  };
}

function applyBudgetUsage(usage, delta = {}) {
  const next = { ...emptyBudgetUsage(), ...(usage || {}) };
  for (const axis of [
    'model_calls',
    'fresh_input_bytes',
    'elapsed_wall_ms',
    'owned_worktrees',
    'finding_recurrence',
  ]) {
    if (!Number.isSafeInteger(next[axis]) || next[axis] < 0) {
      fail('INVALID_BUDGET_USAGE', `persisted ${axis} must be a nonnegative safe integer`);
    }
  }
  if (next.fresh_input_tokens !== null
      && (!Number.isSafeInteger(next.fresh_input_tokens)
        || next.fresh_input_tokens < 0)) {
    fail(
      'INVALID_BUDGET_USAGE',
      'persisted fresh_input_tokens must be null or a nonnegative safe integer',
    );
  }
  const cumulativeAxes = [
    'model_calls',
    'fresh_input_bytes',
    'finding_recurrence',
  ];
  for (const axis of cumulativeAxes) {
    if (Object.prototype.hasOwnProperty.call(delta, axis)
        && (!Number.isSafeInteger(delta[axis]) || delta[axis] < 0)) {
      fail(
        'INVALID_BUDGET_DELTA',
        `${axis} delta must be a nonnegative safe integer`,
      );
    }
  }
  for (const axis of cumulativeAxes) {
    if (!Object.prototype.hasOwnProperty.call(delta, axis)) continue;
    const value = next[axis] + delta[axis];
    if (!Number.isSafeInteger(value) || value < next[axis]) {
      fail('INVALID_BUDGET_DELTA', `${axis} accumulation overflowed`);
    }
    next[axis] = value;
  }
  if (delta.fresh_input_tokens === null || delta.fresh_input_tokens === undefined) {
    // leave unobserved (never coerce null → 0)
  } else {
    if (!Number.isSafeInteger(delta.fresh_input_tokens)
        || delta.fresh_input_tokens < 0) {
      fail(
        'INVALID_BUDGET_DELTA',
        'fresh_input_tokens delta must be null or a nonnegative safe integer',
      );
    }
    const prior = next.fresh_input_tokens == null ? 0 : next.fresh_input_tokens;
    const value = prior + delta.fresh_input_tokens;
    if (!Number.isSafeInteger(value) || value < prior) {
      fail('INVALID_BUDGET_DELTA', 'fresh_input_tokens accumulation overflowed');
    }
    next.fresh_input_tokens = value;
    next.unobserved_axes = (next.unobserved_axes || []).filter((a) => a !== 'fresh_input_tokens');
    if (!next.observable_axes.includes('fresh_input_tokens')) {
      next.observable_axes = [...next.observable_axes, 'fresh_input_tokens'];
    }
  }
  // Elapsed wall is absolute monotonic ms from digest-bound started_at — never sum.
  if (Object.prototype.hasOwnProperty.call(delta, 'elapsed_wall_ms')) {
    if (!Number.isSafeInteger(delta.elapsed_wall_ms) || delta.elapsed_wall_ms < 0) {
      fail(
        'INVALID_BUDGET_OBSERVATION',
        'elapsed_wall_ms observation must be a nonnegative safe integer',
      );
    }
    next.elapsed_wall_ms = Math.max(next.elapsed_wall_ms, delta.elapsed_wall_ms);
  }
  // Owned worktrees is a monotonic high-water observation. Even an explicitly
  // absolute reading cannot roll persisted usage backwards.
  if (Object.prototype.hasOwnProperty.call(delta, 'owned_worktrees_absolute')) {
    if (!Number.isSafeInteger(delta.owned_worktrees_absolute)
        || delta.owned_worktrees_absolute < 0) {
      fail(
        'INVALID_BUDGET_OBSERVATION',
        'owned_worktrees_absolute must be a nonnegative safe integer',
      );
    }
    next.owned_worktrees = Math.max(
      next.owned_worktrees,
      delta.owned_worktrees_absolute,
    );
  } else if (Object.prototype.hasOwnProperty.call(delta, 'owned_worktrees')) {
    if (!Number.isSafeInteger(delta.owned_worktrees)
        || delta.owned_worktrees < 0) {
      fail(
        'INVALID_BUDGET_OBSERVATION',
        'owned_worktrees observation must be a nonnegative safe integer',
      );
    }
    next.owned_worktrees = Math.max(next.owned_worktrees, delta.owned_worktrees);
  }
  return next;
}

function buildProgressReceipt({
  projectId,
  deliverableId,
  generation,
  activeProcess,
  frozenDenominator,
  completedDeliverables = [],
  remainingDeliverables = null,
  blockedReason = null,
  etaBasis = null,
  gateState = null,
  resourceDebtState = null,
  phase = null,
  workOrderId = null,
  rootRunId = null,
}) {
  assertFrozenDenominatorStable(frozenDenominator);
  const all = frozenDenominator.deliverable_ids;
  const completed = [...new Set(completedDeliverables)].filter((id) => all.includes(id)).sort();
  const remaining = remainingDeliverables != null
    ? [...new Set(remainingDeliverables)].sort()
    : all.filter((id) => !completed.includes(id));
  // Denominator must remain frozen.completed + remaining = all, no expansion.
  const union = [...new Set([...completed, ...remaining])].sort();
  if (JSON.stringify(union) !== JSON.stringify([...all].sort())) {
    fail('PROGRESS_DENOMINATOR_DRIFT', 'progress completed/remaining must partition the frozen denominator');
  }
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: PROGRESS_RECEIPT_ARTIFACT,
    project_id: projectId || frozenDenominator.project_id,
    deliverable_id: deliverableId || frozenDenominator.active_node_id,
    generation: Number.isSafeInteger(generation) ? generation : 0,
    active_process: activeProcess || null,
    completed_deliverables: completed,
    remaining_deliverables: remaining,
    deliverable_count: frozenDenominator.deliverable_count,
    frozen_denominator_digest: frozenDenominator.digest,
    blocked_reason: blockedReason,
    eta_basis: etaBasis || 'frozen_graph_remaining',
    gate_state: gateState,
    resource_debt_state: resourceDebtState,
    phase,
    work_order_id: workOrderId,
    root_run_id: rootRunId,
    issued_at: nowIso(),
  };
  return { ...body, digest: sha256Json(body) };
}

function makeDeterministicRepairTicketId({ generation, findingIds = [], reviewDigest = null }) {
  const findings = Array.isArray(findingIds)
    ? [...findingIds].map(String).filter(Boolean).sort()
    : [];
  return `repair-${sha256Json({
    schema: 1,
    generation: Number.isSafeInteger(generation) ? generation : 0,
    finding_ids: findings,
    review_digest: isStr(reviewDigest) ? reviewDigest : null,
  }).slice(0, 24)}`;
}

function appendRepairTicket(workOrderController, ticket) {
  const ctrl = isObj(workOrderController)
    ? JSON.parse(JSON.stringify(workOrderController))
    : emptyControllerState();
  if (!Array.isArray(ctrl.repair_tickets)) ctrl.repair_tickets = [];
  const findingIds = Array.isArray(ticket && ticket.finding_ids)
    ? [...ticket.finding_ids].map(String).filter(Boolean).sort()
    : [];
  // Deterministic/idempotent ticket id from sealed inputs — never wall-clock.
  const ticketId = isStr(ticket && ticket.ticket_id)
    ? ticket.ticket_id
    : makeDeterministicRepairTicketId({
      generation: ticket && ticket.generation,
      findingIds,
      reviewDigest: ticket && ticket.review_digest,
    });
  const existing = ctrl.repair_tickets.find((t) => t.ticket_id === ticketId);
  if (existing) {
    // Idempotent retry: same sealed inputs reuse the existing ticket.
    return ctrl;
  }
  // Successor identity is forbidden — ticket appends to same work order only.
  if (ticket && ticket.successor_work_order_id) {
    fail('SUCCESSOR_IDENTITY_FORBIDDEN', 'repair must not create a successor work-order identity');
  }
  const entry = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: REPAIR_TICKET_ARTIFACT,
    ticket_id: ticketId,
    generation: ticket && ticket.generation,
    finding_ids: findingIds,
    reuse_lineage: !ticket || ticket.reuse_lineage !== false,
    non_reuse_receipt: (ticket && ticket.non_reuse_receipt) || null,
    authorized_at: (ticket && ticket.authorized_at) || nowIso(),
    resource_lineage: (ticket && ticket.resource_lineage) || null,
    root_run_id: (ticket && ticket.root_run_id) || null,
    work_order_id: (ticket && ticket.work_order_id) || null,
  };
  if (entry.reuse_lineage === false && !isObj(entry.non_reuse_receipt)) {
    fail('NON_REUSE_RECEIPT_REQUIRED', 'non-reuse repair requires a machine-readable disposition receipt');
  }
  entry.digest = sha256Json(entry);
  ctrl.repair_tickets.push(entry);
  ctrl.audit_events = Array.isArray(ctrl.audit_events) ? ctrl.audit_events : [];
  ctrl.audit_events.push({
    event: 'repair_ticket_appended',
    ticket_id: entry.ticket_id,
    root_run_id: entry.root_run_id,
    work_order_id: entry.work_order_id,
    at: entry.authorized_at,
    digest: entry.digest,
  });
  ctrl.controller_digest = controllerStateDigest(ctrl);
  return ctrl;
}

function emptyControllerState(fields = {}) {
  const state = {
    schema_version: CONTROLLER_SCHEMA,
    frozen_denominator: fields.frozen_denominator || null,
    original_dispatch_run: fields.original_dispatch_run || null,
    provider_session: fields.provider_session || null,
    unresolved_findings: Array.isArray(fields.unresolved_findings)
      ? fields.unresolved_findings : [],
    review_verdict: fields.review_verdict || null,
    expires_at: fields.expires_at || null,
    resource_inventory: Array.isArray(fields.resource_inventory)
      ? fields.resource_inventory : [],
    process_parentage: fields.process_parentage || null,
    repair_tickets: Array.isArray(fields.repair_tickets) ? fields.repair_tickets : [],
    audit_events: Array.isArray(fields.audit_events) ? fields.audit_events : [],
    gate_journal: fields.gate_journal || emptyGateJournal(),
    repair_budget_usage: fields.repair_budget_usage || emptyBudgetUsage(),
    repair_budget_limits: fields.repair_budget_limits || defaultBudgetLimits(),
    resource_debt: fields.resource_debt || { open: [], released: [] },
    full_diff_barriers: fields.full_diff_barriers || {},
    progress_receipts: Array.isArray(fields.progress_receipts) ? fields.progress_receipts : [],
    // Terminal evidence digests (byte-bound) — part of controller authority.
    historical_outputs: fields.historical_outputs || null,
    historical_outputs_digest: fields.historical_outputs_digest || null,
    noop_receipt: fields.noop_receipt || null,
    adoption_receipts: Array.isArray(fields.adoption_receipts) ? fields.adoption_receipts : [],
    phase: fields.phase || null,
    next_action: fields.next_action || null,
    // Digest-bound production authority (R2/R4/R5/R7/R9).
    started_at_ms: Number.isSafeInteger(fields.started_at_ms) ? fields.started_at_ms : null,
    dispatch_records: Array.isArray(fields.dispatch_records) ? fields.dispatch_records : [],
    transcript_audit: fields.transcript_audit || null,
    accepted_commit: fields.accepted_commit || null,
    branch: fields.branch || null,
    worktree: fields.worktree || null,
    provider_lineage: fields.provider_lineage || null,
    verification_receipt: fields.verification_receipt || null,
    review_payload: fields.review_payload || null,
    findings_snapshot: fields.findings_snapshot || null,
    candidate: fields.candidate || null,
    completed_deliverables: Array.isArray(fields.completed_deliverables)
      ? fields.completed_deliverables : [],
    inventory_observation_digest: fields.inventory_observation_digest || null,
    recovery_receipts: Array.isArray(fields.recovery_receipts) ? fields.recovery_receipts : [],
    resume_receipts: Array.isArray(fields.resume_receipts) ? fields.resume_receipts : [],
    convergence_adjudication_receipt: fields.convergence_adjudication_receipt || null,
    temp_capacity_limit: Number.isSafeInteger(fields.temp_capacity_limit)
      ? fields.temp_capacity_limit : null,
  };
  state.controller_digest = controllerStateDigest(state);
  return state;
}

function controllerStateDigest(state) {
  // Closed field set only — object-spread extras outside this body are not authority.
  const body = {
    schema_version: state.schema_version,
    frozen_denominator: state.frozen_denominator,
    original_dispatch_run: state.original_dispatch_run,
    provider_session: state.provider_session,
    unresolved_findings: state.unresolved_findings,
    review_verdict: state.review_verdict,
    expires_at: state.expires_at,
    resource_inventory: state.resource_inventory,
    process_parentage: state.process_parentage,
    repair_tickets: state.repair_tickets,
    audit_events: state.audit_events,
    gate_journal: state.gate_journal,
    repair_budget_usage: state.repair_budget_usage,
    repair_budget_limits: state.repair_budget_limits,
    resource_debt: state.resource_debt,
    full_diff_barriers: state.full_diff_barriers,
    progress_receipts: state.progress_receipts,
    historical_outputs: state.historical_outputs,
    historical_outputs_digest: state.historical_outputs_digest,
    noop_receipt: state.noop_receipt,
    adoption_receipts: state.adoption_receipts,
    phase: state.phase,
    next_action: state.next_action,
    started_at_ms: state.started_at_ms,
    dispatch_records: state.dispatch_records,
    transcript_audit: state.transcript_audit,
    accepted_commit: state.accepted_commit,
    branch: state.branch,
    worktree: state.worktree,
    provider_lineage: state.provider_lineage,
    verification_receipt: state.verification_receipt,
    review_payload: state.review_payload,
    findings_snapshot: state.findings_snapshot,
    candidate: state.candidate,
    completed_deliverables: state.completed_deliverables,
    inventory_observation_digest: state.inventory_observation_digest,
    recovery_receipts: state.recovery_receipts,
    resume_receipts: state.resume_receipts,
    convergence_adjudication_receipt: state.convergence_adjudication_receipt,
    temp_capacity_limit: state.temp_capacity_limit,
  };
  return sha256Json(body);
}

function attachControllerState(workOrder, controllerState) {
  if (!isObj(workOrder)) fail('INVALID_WORK_ORDER', 'work order required');
  const next = { ...workOrder };
  next.controller = emptyControllerState(controllerState || workOrder.controller || {});
  return next;
}

function requireFullDiffBeforeRepair({
  generation,
  fullDiffBarriers,
  focusedOnly = false,
  verticalFailed = false,
}) {
  const gen = Number.isSafeInteger(generation) ? generation : 0;
  const barriers = isObj(fullDiffBarriers) ? fullDiffBarriers : {};
  const barrier = barriers[String(gen)] || barriers[gen];
  if (focusedOnly) {
    return {
      ok: false,
      allow_repair: false,
      reason: 'focused-only verdict cannot authorize repair; full-diff barrier required',
      code: 'FULL_DIFF_BARRIER_REQUIRED',
    };
  }
  if (!barrier || barrier.success !== true || barrier.kind !== 'full_diff_review') {
    return {
      ok: false,
      allow_repair: false,
      reason: verticalFailed
        ? 'vertical verification failed but authoritative full-diff review is still required before repair'
        : 'authoritative full-diff review required before repair spend',
      code: 'FULL_DIFF_BARRIER_REQUIRED',
      generation: gen,
    };
  }
  return { ok: true, allow_repair: true, barrier };
}

function recordFullDiffBarrier(barriers, generation, receipt) {
  const next = { ...(barriers || {}) };
  next[String(generation)] = {
    kind: 'full_diff_review',
    success: receipt && receipt.success === true,
    review_digest: receipt && receipt.review_digest || null,
    candidate_ref: receipt && receipt.candidate_ref || null,
    recorded_at: nowIso(),
  };
  return next;
}

function classifyBoundaryRejected(dispatchResult) {
  if (!isObj(dispatchResult)) return null;
  const status = dispatchResult.status || dispatchResult.dispatch_status;
  if (status !== BOUNDARY_REJECTED) return null;
  return {
    status: BOUNDARY_REJECTED,
    phase: BOUNDARY_REJECTED,
    candidate_ref: dispatchResult.commit || dispatchResult.candidate_ref || dispatchResult.tip || null,
    boundary_reason: dispatchResult.error || dispatchResult.reason || dispatchResult.boundary_reason
      || 'boundary rejected',
    boundary_code: dispatchResult.boundary_code || 'scope_or_budget_boundary',
    possibly_effectful: Boolean(dispatchResult.commit || dispatchResult.candidate_ref),
    mutation_failed: false,
    unknown_status: false,
  };
}

function classifyMissingDisposition({ findings, dispositionAuthority, findingsIdentityOk = true }) {
  if (!findingsIdentityOk) {
    return {
      status: 'hard_fail',
      phase: 'adjudication',
      reason: 'malformed or identity-mismatched findings remain fail-closed',
      code: 'FINDING_IDENTITY_INVALID',
      resumable: false,
    };
  }
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) {
    return { status: 'ok', phase: null, resumable: false };
  }
  if (!dispositionAuthority) {
    return {
      status: AWAITING_DISPOSITION,
      phase: AWAITING_DISPOSITION,
      reason: 'valid findings without bound disposition authority; durable resumable wait',
      code: 'AWAITING_DISPOSITION',
      resumable: true,
      findings: list,
    };
  }
  return { status: 'ok', phase: null, resumable: false, dispositionAuthority };
}

function classifyResourceOutcome(resource = {}) {
  const dirty = resource.dirty === true;
  const unique = resource.unique === true;
  // identity_known must be explicit true; missing/undefined is unknown (fail closed).
  const known = resource.identity_known === true;
  const terminal = resource.terminal === true;
  const active = resource.active === true;
  // clean must be explicit true; do not infer from missing dirty/unique observations.
  const clean = resource.clean === true;

  if (!known) {
    return {
      disposition: 'retained_unknown',
      release: false,
      blocks_dispatch: true,
      reason: 'unknown identity residue remains owned',
    };
  }
  if (dirty) {
    return {
      disposition: 'retained_dirty',
      release: false,
      blocks_dispatch: true,
      reason: 'dirty residue remains owned',
    };
  }
  if (unique && !terminal) {
    return {
      disposition: 'retained_unique',
      release: false,
      blocks_dispatch: true,
      reason: 'unique uncommitted/unbundled residue remains owned',
    };
  }
  if (active) {
    return { disposition: 'active', release: false, blocks_dispatch: false };
  }
  if (clean || terminal) {
    return {
      disposition: 'released_clean',
      release: true,
      blocks_dispatch: false,
      reason: 'clean/recoverable residue may be bundled and released',
    };
  }
  return {
    disposition: 'disposition_blocked',
    release: false,
    blocks_dispatch: true,
    reason: 'ambiguous resource outcome',
  };
}

function recoveryBundleIdentityDigest(item) {
  return sha256Json({
    schema_version: CONTROLLER_SCHEMA,
    kind: 'recovery_bundle_binding',
    resource_id: item.resource_id || item.worktree || item.branch || null,
    path: item.path || item.worktree || null,
    branch: item.branch || null,
    tip: item.tip || null,
    outcome: {
      clean: item.clean === true,
      dirty: item.dirty === true,
      unique: item.unique === true,
      terminal: item.terminal === true,
      identity_known: item.identity_known === true,
    },
  });
}

const RECOVERY_RECEIPT_ARTIFACT = 'controller_resource_recovery_receipt';
const RECOVERY_EVIDENCE_KINDS = new Set([
  'clean_release',
  'unique_bundle',
  'terminal_consumed',
]);

/**
 * Mint a recovery receipt from mechanical evidence only.
 * When gitCwd/worktree path is supplied, tip/status are re-read from Git and
 * caller outcome booleans are ignored in favor of observed state.
 */
function buildRecoveryReceipt({
  resourceId,
  path: resourcePath = null,
  branch = null,
  tip = null,
  outcome = {},
  evidenceKind,
  bundleContentDigest = null,
  bundlePath = null,
  gitCwd = null,
  baseSha = null,
  mechanicallyObserved = false,
  removed = false,
  terminalConsumed = false,
  terminalReceiptPath = null,
  terminalReceiptDigest = null,
  terminalWorkOrderPath = null,
}) {
  if (!isStr(resourceId)) fail('INVALID_RECOVERY_RECEIPT', 'resourceId required');
  if (!RECOVERY_EVIDENCE_KINDS.has(evidenceKind)) {
    fail('INVALID_RECOVERY_RECEIPT', `unsupported evidence kind ${evidenceKind}`);
  }
  // Caller booleans never authorize release. mechanicallyObserved / removed /
  // terminalConsumed must be re-proven from Git registration/removal and exact
  // terminal-consumption receipt bytes.
  let observed = {
    clean: false,
    dirty: false,
    unique: false,
    terminal: false,
    identity_known: false,
  };
  let obsBranch = branch;
  let obsTip = tip;
  let provenRemoved = false;
  let provenTerminal = false;
  let terminalAuthority = null;
  let provenMechanical = false;
  const observePath = resourcePath || null;
  const observeRoot = isStr(gitCwd) ? gitCwd : null;

  // Exact terminal-consumption authority: integrity-valid controller Work
  // Order + consumed disposition + its exact closed terminal receipt + a
  // resource row bound to this resource. Arbitrary JSON bytes cannot mint
  // release authority merely by containing terminal_status.
  if (terminalConsumed === true || evidenceKind === 'terminal_consumed') {
    if (!isStr(terminalReceiptPath) || !isCanonicalSha256(terminalReceiptDigest)) {
      fail(
        'INVALID_RECOVERY_RECEIPT',
        'terminal_consumed requires terminalReceiptPath + terminalReceiptDigest',
      );
    }
    if (!isStr(terminalWorkOrderPath) || !fs.existsSync(terminalWorkOrderPath)) {
      fail(
        'INVALID_RECOVERY_RECEIPT',
        'terminal_consumed requires an existing terminalWorkOrderPath',
      );
    }
    if (!fs.existsSync(terminalReceiptPath)) {
      fail('INVALID_RECOVERY_RECEIPT', 'terminal consumption receipt path does not exist');
    }
    try {
      const {
        classifyWorkOrder,
        readJsonStrict,
        validateStoredWorkOrderIntegrity,
      } = require('./work-order');
      const loadedWorkOrder = readJsonStrict(terminalWorkOrderPath);
      if (!loadedWorkOrder.ok || !isObj(loadedWorkOrder.value)) {
        fail(
          'INVALID_RECOVERY_RECEIPT',
          `terminal Work Order unreadable: ${
            loadedWorkOrder.reason || loadedWorkOrder.reason_code || 'invalid JSON'
          }`,
        );
      }
      const terminalWorkOrder = loadedWorkOrder.value;
      const workOrderIntegrity = validateStoredWorkOrderIntegrity(terminalWorkOrder);
      if (!workOrderIntegrity.ok
          || terminalWorkOrder.role !== 'controller'
          || terminalWorkOrder.disposition !== 'consumed'
          || !isStr(terminalWorkOrder.terminal_status)
          || !isObj(terminalWorkOrder.controller)
          || !isObj(terminalWorkOrder.expected_receipt)
          || path.resolve(terminalWorkOrder.expected_receipt.path || '')
            !== path.resolve(terminalReceiptPath)) {
        fail(
          'INVALID_RECOVERY_RECEIPT',
          `terminal Work Order is not exact consumed controller authority: ${
            workOrderIntegrity.reason || 'identity/disposition/receipt binding mismatch'
          }`,
        );
      }
      const raw = fs.readFileSync(terminalReceiptPath);
      const recomputed = crypto.createHash('sha256').update(raw).digest('hex');
      if (recomputed !== terminalReceiptDigest) {
        fail('INVALID_RECOVERY_RECEIPT', 'terminal consumption receipt digest mismatch');
      }
      const parsed = JSON.parse(raw.toString('utf8'));
      const classified = classifyWorkOrder(terminalWorkOrder, {
        terminalReceipt: parsed,
        workOrderPath: terminalWorkOrderPath,
        gitCwd: observeRoot || terminalWorkOrder.worktree || null,
        requireBoundEvidence: true,
      });
      if (classified.classification !== 'consume_terminal'
          || classified.terminal_status !== terminalWorkOrder.terminal_status) {
        fail(
          'INVALID_RECOVERY_RECEIPT',
          `terminal receipt/Work Order did not classify consume_terminal: ${
            classified.reason || classified.classification
          }`,
        );
      }
      const inventory = terminalWorkOrder.controller.resource_inventory;
      const resourceMatches = Array.isArray(inventory)
        ? inventory.filter((item) => (
          isObj(item)
          && (item.resource_id || item.worktree || item.path) === resourceId
          && (item.path || item.worktree || null) === (resourcePath || null)
          && (item.root_run_id == null
            || item.root_run_id === terminalWorkOrder.root_run_id)
          && (item.work_order_id == null
            || item.work_order_id === terminalWorkOrder.work_order_id)
        ))
        : [];
      if (resourceMatches.length !== 1) {
        fail(
          'INVALID_RECOVERY_RECEIPT',
          'terminal Work Order must contain exactly one matching bound resource',
        );
      }
      terminalAuthority = {
        work_order_path: path.resolve(terminalWorkOrderPath),
        work_order_digest: terminalWorkOrder.digest,
        root_run_id: terminalWorkOrder.root_run_id,
        work_order_id: terminalWorkOrder.work_order_id,
        controller_digest: terminalWorkOrder.controller.controller_digest,
        terminal_status: terminalWorkOrder.terminal_status,
        disposition: terminalWorkOrder.disposition,
        terminal_receipt_path: path.resolve(terminalReceiptPath),
        terminal_receipt_raw_digest: recomputed,
        terminal_receipt_digest: parsed.digest,
        resource_binding_digest: sha256Json(resourceMatches[0]),
      };
      provenTerminal = true;
    } catch (error) {
      if (error && error.code === 'INVALID_RECOVERY_RECEIPT') throw error;
      fail(
        'INVALID_RECOVERY_RECEIPT',
        `terminal consumption receipt unreadable: ${error.message || String(error)}`,
      );
    }
  }

  // Mechanical Git worktree registration/removal observation.
  if (isStr(observePath) || removed === true) {
    if (isStr(observePath) && fs.existsSync(observePath)) {
      try {
        const { execFileSync } = require('child_process');
        const st = execFileSync('git', ['-C', observePath, 'status', '--porcelain=v1'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        obsTip = execFileSync('git', ['-C', observePath, 'rev-parse', 'HEAD'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        try {
          const br = execFileSync('git', ['-C', observePath, 'rev-parse', '--abbrev-ref', 'HEAD'], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
          }).trim();
          if (br && br !== 'HEAD') obsBranch = br;
        } catch (_e) { /* detached ok */ }
        // unique: recompute tip vs frozen base (caller unique:false cannot hide commits).
        let unique = false;
        const base = isStr(baseSha) ? baseSha : (isStr(outcome.base_sha) ? outcome.base_sha : null);
        if (isStr(base) && isStr(obsTip)) {
          try {
            const baseFull = execFileSync(
              'git',
              ['-C', observePath, 'rev-parse', `${base}^{commit}`],
              { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
            ).trim();
            if (obsTip.toLowerCase() !== baseFull.toLowerCase()) {
              const headTree = execFileSync(
                'git',
                ['-C', observePath, 'rev-parse', `${obsTip}^{tree}`],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
              ).trim();
              const baseTree = execFileSync(
                'git',
                ['-C', observePath, 'rev-parse', `${baseFull}^{tree}`],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
              ).trim();
              unique = headTree !== baseTree;
            }
          } catch (_e) {
            // Unknown base/tip relationship remains unique-unknown → not clean release.
            unique = true;
          }
        }
        observed = {
          clean: st.trim().length === 0 && unique !== true,
          dirty: st.trim().length > 0,
          unique,
          terminal: provenTerminal,
          identity_known: true,
        };
        provenMechanical = true;
      } catch (error) {
        fail(
          'INVALID_RECOVERY_RECEIPT',
          `mechanical observation failed: ${error.message || String(error)}`,
        );
      }
    } else if (removed === true || (isStr(observePath) && !fs.existsSync(observePath))) {
      // Nonexistent path: only release when Git worktree list proves removal OR
      // an exact terminal receipt was proven. Caller booleans alone never authorize.
      if (!provenTerminal) {
        if (!isStr(observeRoot) || !fs.existsSync(observeRoot)) {
          fail(
            'INVALID_RECOVERY_RECEIPT',
            'nonexistent worktree path requires gitCwd for mechanical removal reobservation',
          );
        }
        try {
          const { execFileSync } = require('child_process');
          const listed = execFileSync(
            'git',
            ['-C', observeRoot, 'worktree', 'list', '--porcelain'],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          );
          const pathStillListed = isStr(observePath)
            && listed.split('\n').some((line) => {
              if (!line.startsWith('worktree ')) return false;
              const p = line.slice('worktree '.length).trim();
              if (p === observePath) return true;
              try {
                return fs.existsSync(p)
                  && fs.existsSync(observePath)
                  && fs.realpathSync(p) === fs.realpathSync(observePath);
              } catch (_e) {
                return false;
              }
            });
          if (pathStillListed) {
            fail(
              'INVALID_RECOVERY_RECEIPT',
              'worktree path still registered in git worktree list',
            );
          }
          if (removed !== true) {
            fail(
              'INVALID_RECOVERY_RECEIPT',
              'nonexistent path requires removed=true with git proof or terminal receipt',
            );
          }
          provenRemoved = true;
          provenMechanical = true;
          observed = {
            clean: true,
            dirty: false,
            unique: false,
            terminal: false,
            identity_known: true,
          };
        } catch (error) {
          if (error && error.code === 'INVALID_RECOVERY_RECEIPT') throw error;
          fail(
            'INVALID_RECOVERY_RECEIPT',
            `mechanical removal reobservation failed: ${error.message || String(error)}`,
          );
        }
      } else {
        // Terminal receipt proven; path may be gone.
        provenMechanical = true;
        observed = {
          clean: true,
          dirty: false,
          unique: false,
          terminal: true,
          identity_known: true,
        };
      }
    }
  }

  // Reject pure caller authority: flags without mechanical/terminal proof.
  if (mechanicallyObserved === true && !provenMechanical) {
    fail(
      'INVALID_RECOVERY_RECEIPT',
      'mechanicallyObserved caller flag is not authority without Git reobservation',
    );
  }
  if (terminalConsumed === true && !provenTerminal) {
    fail(
      'INVALID_RECOVERY_RECEIPT',
      'terminalConsumed caller flag is not authority without receipt reobservation',
    );
  }
  if (removed === true && !provenRemoved && !provenTerminal) {
    fail(
      'INVALID_RECOVERY_RECEIPT',
      'removed caller flag is not authority without Git removal reobservation',
    );
  }
  // Without any mechanical path/root and without proven terminal receipt, fail.
  if (!provenMechanical && !provenTerminal) {
    if (evidenceKind === 'clean_release' || evidenceKind === 'terminal_consumed') {
      fail(
        'INVALID_RECOVERY_RECEIPT',
        'clean_release/terminal_consumed require mechanical Git observation or terminal receipt',
      );
    }
  }
  // Prefer proven flags over caller outcome.
  mechanicallyObserved = provenMechanical;
  removed = provenRemoved;
  terminalConsumed = provenTerminal;
  let bundleDigest = bundleContentDigest;
  if (evidenceKind === 'unique_bundle') {
    if (!isStr(bundlePath)) {
      fail('INVALID_RECOVERY_RECEIPT', 'unique_bundle requires bundle_path');
    }
    // Open exact real file and recompute SHA-256 over raw bytes.
    let realBundle;
    try {
      realBundle = fs.realpathSync(bundlePath);
      if (!fs.statSync(realBundle).isFile()) {
        fail('INVALID_RECOVERY_RECEIPT', 'unique_bundle path is not a regular file');
      }
      bundleDigest = crypto.createHash('sha256').update(fs.readFileSync(realBundle)).digest('hex');
      bundlePath = realBundle;
    } catch (error) {
      fail('INVALID_RECOVERY_RECEIPT', `unique_bundle unreadable: ${error.message || String(error)}`);
    }
  }
  if (evidenceKind === 'clean_release') {
    if (!(observed.clean === true || observed.terminal === true || removed === true)) {
      fail('INVALID_RECOVERY_RECEIPT', 'clean_release requires clean Git state, removal, or terminal consume');
    }
  }
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: RECOVERY_RECEIPT_ARTIFACT,
    resource_id: resourceId,
    path: resourcePath,
    branch: obsBranch,
    tip: obsTip,
    outcome: observed,
    evidence_kind: evidenceKind,
    bundle_path: bundlePath,
    bundle_content_digest: bundleDigest,
    mechanically_observed: mechanicallyObserved === true,
    removed: removed === true,
    terminal_consumed: terminalConsumed === true,
    terminal_authority: terminalAuthority,
  };
  body.resource_identity_digest = recoveryBundleIdentityDigest({
    resource_id: resourceId,
    path: resourcePath,
    worktree: resourcePath,
    branch: obsBranch,
    tip: obsTip,
    ...observed,
  });
  body.digest = sha256Json({ ...body, digest: undefined });
  return body;
}

function validateRecoveryBundle(item) {
  // Prefer structured recovery receipt; bare digest strings are not authority.
  const receipt = isObj(item.recovery_receipt) ? item.recovery_receipt : null;
  if (!receipt) {
    return {
      ok: false,
      reason: 'clean release requires a structured recovery receipt, not a bare digest string',
    };
  }
  if (receipt.schema_version !== CONTROLLER_SCHEMA
      || receipt.artifact_type !== RECOVERY_RECEIPT_ARTIFACT) {
    return { ok: false, reason: 'recovery receipt schema/artifact_type invalid' };
  }
  if (!RECOVERY_EVIDENCE_KINDS.has(receipt.evidence_kind)) {
    return { ok: false, reason: 'recovery receipt evidence_kind unsupported' };
  }
  if (!isCanonicalSha256(receipt.digest)) {
    return { ok: false, reason: 'recovery receipt digest must be canonical sha256' };
  }
  const body = { ...receipt };
  delete body.digest;
  if (sha256Json(body) !== receipt.digest) {
    return { ok: false, reason: 'recovery receipt digest mismatch (forged or tampered)' };
  }
  // Recompute identity from the receipt's own closed body fields, then compare to inventory.
  const receiptIdentity = recoveryBundleIdentityDigest({
    resource_id: receipt.resource_id,
    path: receipt.path,
    worktree: receipt.path,
    branch: receipt.branch,
    tip: receipt.tip,
    clean: receipt.outcome && receipt.outcome.clean === true,
    dirty: receipt.outcome && receipt.outcome.dirty === true,
    unique: receipt.outcome && receipt.outcome.unique === true,
    terminal: receipt.outcome && receipt.outcome.terminal === true,
    identity_known: receipt.outcome && receipt.outcome.identity_known === true,
  });
  if (receipt.resource_identity_digest !== receiptIdentity) {
    return { ok: false, reason: 'recovery receipt resource_identity_digest does not recompute from body' };
  }
  const itemId = item.resource_id || item.worktree || item.branch;
  if (receipt.resource_id !== itemId) {
    return { ok: false, reason: 'recovery receipt resource_id mismatch' };
  }
  const itemPath = item.path || item.worktree || null;
  if ((receipt.path || null) !== (itemPath || null)) {
    return { ok: false, reason: 'recovery receipt path does not match inventory item' };
  }
  if ((receipt.branch || null) !== (item.branch || null)) {
    return { ok: false, reason: 'recovery receipt branch does not match inventory item' };
  }
  if ((receipt.tip || null) !== (item.tip || null)) {
    return { ok: false, reason: 'recovery receipt tip does not match inventory item' };
  }
  // Inventory outcome must match receipt outcome exactly for release.
  const invClean = item.clean === true;
  const invDirty = item.dirty === true;
  const invUnique = item.unique === true;
  const invTerminal = item.terminal === true;
  const invKnown = item.identity_known === true;
  if (receipt.outcome.clean !== invClean
      || receipt.outcome.dirty !== invDirty
      || receipt.outcome.unique !== invUnique
      || receipt.outcome.terminal !== invTerminal
      || receipt.outcome.identity_known !== invKnown) {
    return { ok: false, reason: 'recovery receipt outcome does not match inventory observation' };
  }
  if (receipt.evidence_kind === 'clean_release'
      && receipt.outcome.clean !== true
      && receipt.outcome.terminal !== true
      && receipt.removed !== true) {
    return { ok: false, reason: 'clean_release evidence requires clean/terminal/removed proof' };
  }
  if (receipt.evidence_kind === 'terminal_consumed'
      || receipt.terminal_consumed === true) {
    const authority = receipt.terminal_authority;
    if (!isObj(authority)
        || !isStr(authority.work_order_path)
        || !isCanonicalSha256(authority.work_order_digest)
        || !isStr(authority.root_run_id)
        || !isStr(authority.work_order_id)
        || !isCanonicalSha256(authority.controller_digest)
        || authority.disposition !== 'consumed'
        || !isStr(authority.terminal_status)
        || !isStr(authority.terminal_receipt_path)
        || !isCanonicalSha256(authority.terminal_receipt_raw_digest)
        || !isCanonicalSha256(authority.terminal_receipt_digest)
        || !isCanonicalSha256(authority.resource_binding_digest)) {
      return { ok: false, reason: 'terminal_consumed recovery authority is incomplete' };
    }
    try {
      const {
        classifyWorkOrder,
        readJsonStrict,
        validateStoredWorkOrderIntegrity,
      } = require('./work-order');
      const loaded = readJsonStrict(authority.work_order_path);
      if (!loaded.ok || !isObj(loaded.value)) {
        return { ok: false, reason: 'terminal Work Order is no longer readable' };
      }
      const wo = loaded.value;
      const integrity = validateStoredWorkOrderIntegrity(wo);
      const terminalBytes = fs.readFileSync(authority.terminal_receipt_path);
      const rawDigest = crypto.createHash('sha256').update(terminalBytes).digest('hex');
      const terminal = JSON.parse(terminalBytes.toString('utf8'));
      const classified = classifyWorkOrder(wo, {
        terminalReceipt: terminal,
        workOrderPath: authority.work_order_path,
        gitCwd: wo.worktree || null,
        requireBoundEvidence: true,
      });
      const matches = isObj(wo.controller) && Array.isArray(wo.controller.resource_inventory)
        ? wo.controller.resource_inventory.filter((resource) => (
          isObj(resource)
          && (resource.resource_id || resource.worktree || resource.path) === receipt.resource_id
          && (resource.path || resource.worktree || null) === (receipt.path || null)
        ))
        : [];
      if (!integrity.ok
          || wo.digest !== authority.work_order_digest
          || wo.root_run_id !== authority.root_run_id
          || wo.work_order_id !== authority.work_order_id
          || !isObj(wo.controller)
          || wo.controller.controller_digest !== authority.controller_digest
          || wo.disposition !== authority.disposition
          || wo.terminal_status !== authority.terminal_status
          || rawDigest !== authority.terminal_receipt_raw_digest
          || terminal.digest !== authority.terminal_receipt_digest
          || classified.classification !== 'consume_terminal'
          || matches.length !== 1
          || sha256Json(matches[0]) !== authority.resource_binding_digest) {
        return {
          ok: false,
          reason: 'terminal_consumed recovery authority no longer validates exactly',
        };
      }
    } catch (error) {
      return {
        ok: false,
        reason: `terminal_consumed recovery authority unreadable: ${
          error.message || String(error)
        }`,
      };
    }
  }
  if (receipt.evidence_kind === 'unique_bundle') {
    if (!isStr(receipt.bundle_path) || !isCanonicalSha256(receipt.bundle_content_digest)) {
      return { ok: false, reason: 'unique_bundle requires path and content digest' };
    }
    try {
      const real = fs.realpathSync(receipt.bundle_path);
      if (!fs.statSync(real).isFile()) {
        return { ok: false, reason: 'unique_bundle path is not a regular file' };
      }
      const live = crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex');
      if (live !== receipt.bundle_content_digest) {
        return { ok: false, reason: 'unique_bundle content digest mismatch (forged or swapped)' };
      }
    } catch (error) {
      return { ok: false, reason: `unique_bundle unreadable: ${error.message || String(error)}` };
    }
  }
  return {
    ok: true,
    identity_digest: receiptIdentity,
    receipt_digest: receipt.digest,
  };
}

function buildResourceDebtState(inventory = [], { dispatchRecords = [] } = {}) {
  const open = [];
  const released = [];
  for (const item of inventory) {
    const terminalAuthority = item.terminal === true
      && isCanonicalSha256(item.terminal_receipt_digest)
      && dispatchRecords.some((dispatch) => (
        isObj(dispatch)
        && dispatch.resource_id === (item.resource_id || item.worktree || item.branch || null)
        && dispatch.result_receipt_digest === item.terminal_receipt_digest
      ));
    // A caller boolean cannot waive unique-resource debt. Only a persisted
    // dispatch result receipt bound to this exact resource authorizes the
    // terminal observation used by the classifier.
    const cls = classifyResourceOutcome({
      ...item,
      terminal: terminalAuthority,
    });
    const row = {
      // Never mint a fallback identity while classifying evidence. Missing
      // resource identity remains visibly null and fails transcript closure.
      resource_id: item.resource_id || item.worktree || item.branch || null,
      kind: item.kind || 'worktree',
      path: item.path || item.worktree || null,
      root_run_id: item.root_run_id || null,
      work_order_id: item.work_order_id || null,
      disposition: cls.disposition,
      blocks_dispatch: cls.blocks_dispatch,
      recovery_bundle_digest: item.recovery_bundle_digest || null,
      terminal_receipt_digest: terminalAuthority ? item.terminal_receipt_digest : null,
      reason: cls.reason || null,
    };
    // Never infer clean from missing observation — only explicit clean release path.
    if (cls.release === true && cls.disposition === 'released_clean') {
      const bundle = validateRecoveryBundle(item);
      if (bundle.ok) {
        released.push({
          ...row,
          recovery_identity_digest: bundle.identity_digest,
          recovery_receipt_digest: bundle.receipt_digest,
        });
      } else {
        open.push({
          ...row,
          disposition: 'disposition_blocked',
          blocks_dispatch: true,
          reason: bundle.reason,
        });
      }
    } else if (cls.blocks_dispatch || !cls.release) {
      open.push(row);
    } else {
      open.push({
        ...row,
        disposition: 'disposition_blocked',
        blocks_dispatch: true,
        reason: 'release requires verifiable structured recovery receipt',
      });
    }
  }
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: RESOURCE_DEBT_ARTIFACT,
    open,
    released,
    blocks_dispatch: open.some((r) => r.blocks_dispatch),
  };
  return { ...body, digest: sha256Json(body) };
}

function admitHighWater({
  currentOwned = 0,
  highWater = 4,
  unresolvedDebt = false,
  tempCapacityOk = true,
}) {
  if (unresolvedDebt) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      reason: 'unresolved retained-resource debt blocks new branch/worktree/runner effects',
      code: 'RESOURCE_DEBT_BLOCKS_DISPATCH',
    };
  }
  if (!tempCapacityOk) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      reason: 'insufficient temporary capacity for checkout creation',
      code: 'TEMP_CAPACITY_EXCEEDED',
    };
  }
  // Equality: used == limit is OK for current ownership; only projected > limit blocks.
  // Callers pass currentOwned *after* projecting the next creation (current + delta).
  // Admit projected <= limit; reject projected > limit. Zero resources on rejection.
  if (Number(currentOwned) > Number(highWater)) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      reason: `owned worktree high-water ${highWater} would be exceeded (projected ${currentOwned})`,
      code: 'HIGH_WATER_EXCEEDED',
    };
  }
  return {
    ok: true,
    allow_checkout: true,
    allow_runner: true,
    effects: 0,
    reason: null,
  };
}

/**
 * Mechanical orphan adoption. Prefer the full authority path:
 *   { gitCwd, workOrder, leafResult, branch, baseSha, allowPaths, maxChurn }
 * Boolean proof flags alone never authorize adoption.
 */
function adoptOrphanLeaf(input = {}) {
  // Mechanical path: load process/Git/controller authorities.
  if (isObj(input.workOrder) && isStr(input.gitCwd)) {
    return adoptOrphanLeafMechanical(input);
  }
  // Legacy boolean path is intentionally fail-closed: booleans never authorize.
  if (Object.prototype.hasOwnProperty.call(input, 'controllerDead')
      || Object.prototype.hasOwnProperty.call(input, 'baseAncestryOk')
      || Object.prototype.hasOwnProperty.call(input, 'scopeOk')
      || Object.prototype.hasOwnProperty.call(input, 'churnOk')
      || Object.prototype.hasOwnProperty.call(input, 'alreadyAdopted')) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'boolean proof flags alone never authorize orphan adoption; provide mechanical workOrder+gitCwd authorities',
      code: 'ADOPTION_BOOLEAN_FLAGS_NOT_AUTHORITY',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  return {
    ok: false,
    status: 'stopped',
    reason: 'orphan adoption requires gitCwd + workOrder mechanical authorities',
    code: 'ADOPTION_AUTHORITY_MISSING',
    preserve_evidence: true,
    duplicate_mutation: 0,
  };
}

function adoptOrphanLeafMechanical({
  gitCwd,
  workOrder,
  leafResult,
  branch = null,
  baseSha = null,
  // Sealed scope/churn from Work Order / campaign contract only — not optional CLI.
  sealedScope = null,
  leafWorktree = null,
}) {
  const {
    isCompleteIdentity,
    createOrUpdateWorkOrder,
    resolveGitCommonDir,
    validateControllerProcessParentage,
    validateStoredWorkOrderIntegrity,
  } = require('./work-order');
  const { execFileSync } = require('child_process');
  if (!isObj(workOrder) || !isStr(workOrder.work_order_id)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_WO_MISSING',
      reason: 'exact Work Order required', preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const workOrderIntegrity = validateStoredWorkOrderIntegrity(workOrder);
  if (!workOrderIntegrity.ok) {
    return {
      ok: false, status: 'stopped',
      code: workOrderIntegrity.reason_code || 'ADOPTION_WO_INTEGRITY',
      reason: workOrderIntegrity.reason || 'Work Order integrity validation failed',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const controller = isObj(workOrder.controller) ? workOrder.controller : null;
  if (!controller) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_CONTROLLER_MISSING',
      reason: 'Work Order controller authority required', preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Prior adoption from controller audit — not a flag.
  const priorAdoptions = Array.isArray(controller.adoption_receipts)
    ? controller.adoption_receipts : [];
  if (priorAdoptions.length > 0) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_ALREADY_CONSUMED',
      reason: 'orphan leaf already adopted once for this controller Work Order',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Prove controller death from complete persisted PID/start/PGID/SID + parent chain.
  const owner = isObj(workOrder.owner) ? workOrder.owner : null;
  if (!isCompleteIdentity(owner)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_OWNER_IDENTITY_MISSING',
      reason: 'complete controller owner process identity (pid/start/pgid/sid) required',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Production Engine Work Orders seal process parentage as
  // { owner, relationships:[{ child, parent }], observed_at, digest }. Reuse
  // the canonical recovery validator rather than accepting legacy caller
  // aliases such as chain/parents or skipping parentage entirely.
  const parentage = isObj(controller.process_parentage)
    ? controller.process_parentage : null;
  if (!parentage) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_PARENT_CHAIN_MISSING',
      reason: 'orphan adoption requires canonical digest-bound controller process_parentage',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const parentageValidation = validateControllerProcessParentage(parentage, owner);
  if (!parentageValidation.ok) {
    return {
      ok: false,
      status: 'stopped',
      code: parentageValidation.reason_code === 'process_identity_unknown'
        ? 'CONTROLLER_DEATH_UNKNOWN' : 'ADOPTION_PARENT_CHAIN_INVALID',
      reason: parentageValidation.reason || 'controller process parentage validation failed',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  const live = parentageValidation.owner_live;
  if (live === true) {
    return {
      ok: false, status: 'stopped', code: 'CONTROLLER_NOT_PROVEN_DEAD',
      reason: 'controller owner process is still live under bound identity',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // isProcessLiveStrict returns false for complete-but-dead; incomplete already rejected.
  if (live !== false) {
    return {
      ok: false, status: 'stopped', code: 'CONTROLLER_DEATH_UNKNOWN',
      reason: 'controller death could not be proven',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  if (!isObj(leafResult) || leafResult.committed !== true) {
    return {
      ok: false, status: 'stopped', code: 'LEAF_RESULT_AMBIGUOUS',
      reason: 'leaf result not a committed implementation/repair outcome',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const leafCommit = isStr(leafResult.commit)
    ? leafResult.commit
    : (isStr(leafResult.candidate_ref) ? leafResult.candidate_ref : null);
  if (!isCanonicalGitObjectId(leafCommit)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BINDING_INCOMPLETE',
      reason: 'leaf commit must be a canonical git object id',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Require present canonical leaf-result receipt digest and recompute exactly.
  const claimedDigest = leafResult.digest || leafResult.receipt_digest;
  if (!isCanonicalSha256(claimedDigest)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_LEAF_DIGEST_REQUIRED',
      reason: 'leaf result requires a present canonical receipt digest',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  {
    const body = { ...leafResult };
    delete body.digest;
    delete body.receipt_digest;
    if (sha256Json(body) !== claimedDigest) {
      return {
        ok: false, status: 'stopped', code: 'ADOPTION_LEAF_DIGEST_MISMATCH',
        reason: 'leaf result digest does not recompute',
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
  }
  const branchName = branch || workOrder.branch;
  if (!isStr(branchName)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BRANCH_MISSING',
      reason: 'branch required for tip/tree resolution',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  let branchTip;
  let branchTree;
  try {
    branchTip = execFileSync('git', ['-C', gitCwd, 'rev-parse', branchName], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    branchTree = execFileSync('git', ['-C', gitCwd, 'rev-parse', `${branchTip}^{tree}`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_GIT_RESOLVE_FAILED',
      reason: `cannot resolve branch tip/tree: ${error.message || String(error)}`,
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  if (!isCanonicalGitObjectId(branchTip) || !isCanonicalGitObjectId(branchTree)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BINDING_INCOMPLETE',
      reason: 'branch tip/tree not canonical git object ids',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  if (leafCommit !== branchTip) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_LEAF_TIP_MISMATCH',
      reason: 'leaf result commit does not bind to branch tip',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Require canonical exact sealed base — caller restatement may only equal it.
  if (baseSha != null && baseSha !== workOrder.base_sha) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BASE_OVERRIDE_REJECTED',
      reason: 'caller baseSha disagrees with the canonical Work Order base',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const sealedBase = workOrder.base_sha;
  if (!isCanonicalGitObjectId(sealedBase)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BASE_REQUIRED',
      reason: 'canonical sealed base SHA required for ancestry',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  try {
    execFileSync('git', ['-C', gitCwd, 'merge-base', '--is-ancestor', sealedBase, branchTip], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_e) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_BINDING_FAILED',
      reason: 'base ancestry check failed (merge-base --is-ancestor)',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  // Scope/churn comes only from the digest-bound canonical Work Order field.
  // A caller may restate the value for transport equality but cannot supply or
  // replace missing authority.
  const canonicalScope = isObj(workOrder.sealed_scope)
    ? workOrder.sealed_scope : null;
  if (!canonicalScope
      || !Array.isArray(canonicalScope.allow_paths)
      || canonicalScope.allow_paths.length === 0
      || !Number.isSafeInteger(canonicalScope.max_files)
      || !Number.isSafeInteger(canonicalScope.max_diff_lines)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_SCOPE_NOT_SEALED',
      reason: 'orphan adoption requires canonical sealed_scope on the Work Order',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  if (sealedScope != null
      && JSON.stringify(sealedScope) !== JSON.stringify(canonicalScope)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_SCOPE_OVERRIDE_REJECTED',
      reason: 'caller sealedScope disagrees with the canonical Work Order scope',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const allowPaths = canonicalScope.allow_paths;
  const maxChangedFiles = canonicalScope.max_files;
  const maxDiffLines = canonicalScope.max_diff_lines;
  let changed = [];
  let diffStat = '';
  let observedChurn = 0;
  {
    try {
      changed = execFileSync(
        'git',
        ['-C', gitCwd, 'diff', '--name-only', sealedBase, branchTip],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      ).split('\n').map((l) => l.trim()).filter(Boolean);
      diffStat = execFileSync(
        'git',
        ['-C', gitCwd, 'diff', '--numstat', sealedBase, branchTip],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      return {
        ok: false, status: 'stopped', code: 'ADOPTION_SCOPE_UNREADABLE',
        reason: error.message || String(error),
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
    for (const file of changed) {
      const ok = allowPaths.some((p) => file === p || file.startsWith(`${p}/`));
      if (!ok) {
        return {
          ok: false, status: 'stopped', code: 'ADOPTION_BINDING_FAILED',
          reason: `changed path outside sealed scope: ${file}`,
          preserve_evidence: true, duplicate_mutation: 0,
        };
      }
    }
    if (changed.length > maxChangedFiles) {
      return {
        ok: false, status: 'stopped', code: 'ADOPTION_BINDING_FAILED',
        reason: `changed file count ${changed.length} exceeds max ${maxChangedFiles}`,
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
    for (const line of diffStat.split('\n')) {
      const m = /^(\d+|-)\s+(\d+|-)\s+/.exec(line);
      if (!m) continue;
      if (m[1] !== '-') observedChurn += Number(m[1]);
      if (m[2] !== '-') observedChurn += Number(m[2]);
    }
    if (observedChurn > maxDiffLines) {
      return {
        ok: false, status: 'stopped', code: 'ADOPTION_BINDING_FAILED',
        reason: `diff-line churn ${observedChurn} exceeds max ${maxDiffLines}`,
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
  }
  // Require real registered worktree path — never synthesize from tip/tree alone.
  const wt = leafWorktree || leafResult.worktree || null;
  if (!isStr(wt) || !fs.existsSync(wt)) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_WORKTREE_REQUIRED',
      reason: 'real registered leaf worktree path required for digest binding',
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  let worktreeDigest = null;
  try {
    const status = execFileSync('git', ['-C', wt, 'status', '--porcelain=v1'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const head = execFileSync('git', ['-C', wt, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    worktreeDigest = sha256Json({ head, status, path: fs.realpathSync(wt) });
  } catch (error) {
    return {
      ok: false, status: 'stopped', code: 'ADOPTION_WORKTREE_DIGEST_FAILED',
      reason: error.message || String(error),
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  const generation = Number.isSafeInteger(workOrder.generation) ? workOrder.generation : 0;
  const receipt = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: ADOPTION_RECEIPT_ARTIFACT,
    work_order_id: workOrder.work_order_id,
    root_run_id: workOrder.root_run_id,
    branch_tip: branchTip,
    branch_tree: branchTree,
    base_sha: sealedBase,
    sealed_scope_digest: sha256Json(canonicalScope),
    changed_paths_digest: sha256Json(changed),
    changed_file_count: changed.length,
    diff_line_churn: observedChurn,
    worktree_digest: worktreeDigest,
    generation,
    leaf_commit: leafCommit,
    owner_pid: owner.pid,
    owner_start: owner.process_start_time,
    adopted_at: nowIso(),
    duplicate_mutation: 0,
  };
  receipt.digest = sha256Json(receipt);
  // CAS-append adoption receipt into the same controller Work Order.
  const nextController = {
    ...controller,
    adoption_receipts: [...priorAdoptions, receipt],
    phase: 'ADOPTED_ORPHAN',
    next_action: 'resume_verification',
    audit_events: [
      ...(Array.isArray(controller.audit_events) ? controller.audit_events : []),
      {
        event: 'orphan_adopted',
        root_run_id: workOrder.root_run_id,
        work_order_id: workOrder.work_order_id,
        at: receipt.adopted_at,
        digest: receipt.digest,
        leaf_commit: leafCommit,
      },
    ],
  };
  // controller_digest recomputed by createOrUpdateWorkOrder / caller.
  let persisted = null;
  try {
    const commonDir = resolveGitCommonDir(gitCwd);
    if (!commonDir) {
      return {
        ok: false, status: 'stopped', code: 'ADOPTION_COMMON_DIR_MISSING',
        reason: 'git common dir required for CAS adoption append',
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
    nextController.controller_digest = controllerStateDigest(nextController);
    persisted = createOrUpdateWorkOrder(commonDir, {
      ...workOrder,
      controller: nextController,
      accepted_commit: leafCommit,
      next_action: 'resume_verification',
      campaign_phase: 'ADOPTED_ORPHAN',
    }, {
      expectedGeneration: workOrder.generation,
      expectedCasToken: workOrder.cas_token,
      expectedControllerDigest: controller.controller_digest,
      bindArtifacts: false,
    });
    if (persisted.status === 'reject') {
      return {
        ok: false, status: 'stopped',
        code: persisted.reason_code || 'cas_conflict',
        reason: persisted.reason || 'CAS adopt failed',
        preserve_evidence: true, duplicate_mutation: 0,
      };
    }
  } catch (error) {
    return {
      ok: false, status: 'stopped', code: error.code || 'ADOPTION_PERSIST_FAILED',
      reason: error.message || String(error),
      preserve_evidence: true, duplicate_mutation: 0,
    };
  }
  return {
    ok: true,
    status: 'adopted',
    receipt,
    advance_campaign: true,
    duplicate_mutation: 0,
    generation: persisted.work_order.generation,
    work_order: persisted.work_order,
    work_order_id: persisted.work_order.work_order_id,
    implementer_redispatch: 0,
  };
}

/**
 * Reconstruct current *owned* worktree inventory from Git + controller state.
 * The primary checkout (gitCwd) is never counted as campaign-owned residue.
 * Linked worktrees are owned only when:
 *   - listed on controller.resource_inventory, or
 *   - their path embeds the root_run_id / campaign resource marker.
 */
function reconstructOwnedInventory({
  gitCwd,
  controller = null,
  rootRunId = null,
  manifests = null,
  results = null,
  baseSha = null,
  failClosedOnGitError = true,
} = {}) {
  // Live Git observations replace stale controller rows for the same path.
  // Ownership is closed: controller inventory, root-bound manifests/results, or
  // exact registered worktree identities bound to controller ownership evidence.
  const byPath = new Map();
  const put = (item, { live = false } = {}) => {
    const key = item.path || item.worktree || item.resource_id;
    if (!key) return;
    const prior = byPath.get(key);
    if (prior && !live) return; // do not let stale overwrite live
    byPath.set(key, {
      ...prior,
      ...item,
      live_observed: live === true || Boolean(prior && prior.live_observed === true),
    });
  };
  if (isObj(controller) && Array.isArray(controller.resource_inventory)) {
    for (const item of controller.resource_inventory) {
      put({ ...item, kind: item.kind || 'worktree' }, { live: false });
    }
  }
  // Manifest/result ownership (exact root-bound paths).
  for (const m of Array.isArray(manifests) ? manifests : []) {
    if (isStr(m.worktree) || isStr(m.path)) {
      put({
        resource_id: m.resource_id || m.worktree || m.path,
        kind: 'worktree',
        path: m.worktree || m.path,
        worktree: m.worktree || m.path,
        branch: m.branch || null,
        identity_known: true,
        from_manifest: true,
      }, { live: false });
    }
  }
  for (const r of Array.isArray(results) ? results : []) {
    if (isStr(r.worktree) || isStr(r.path)) {
      put({
        resource_id: r.resource_id || r.worktree || r.path,
        kind: 'worktree',
        path: r.worktree || r.path,
        worktree: r.worktree || r.path,
        branch: r.branch || null,
        tip: r.commit || r.tip || null,
        identity_known: true,
        from_result: true,
      }, { live: false });
    }
  }
  if (!isStr(gitCwd)) {
    const inventory = [...byPath.values()];
    return {
      inventory,
      source: 'controller_only',
      root_run_id: rootRunId,
      digest: sha256Json(inventory),
      ok: true,
    };
  }
  let mainAbs = null;
  try {
    mainAbs = fs.realpathSync(path.resolve(gitCwd));
  } catch (_e) {
    mainAbs = path.resolve(gitCwd);
  }
  try {
    const { execFileSync } = require('child_process');
    const porcelain = execFileSync('git', ['-C', gitCwd, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let current = null;
    const linked = [];
    for (const line of porcelain.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current) linked.push(current);
        current = {
          resource_id: line.slice('worktree '.length),
          kind: 'worktree',
          path: line.slice('worktree '.length),
          worktree: line.slice('worktree '.length),
          identity_known: true,
        };
      } else if (current && line.startsWith('branch ')) {
        current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (current && line.startsWith('HEAD ')) {
        current.tip = line.slice('HEAD '.length);
      } else if (line === '') {
        if (current) linked.push(current);
        current = null;
      }
    }
    if (current) linked.push(current);
    for (const item of linked) {
      let abs = item.path;
      try { abs = fs.realpathSync(item.path); } catch (_e) { /* keep */ }
      if (abs === mainAbs) continue; // primary checkout is not campaign residue
      // Only own if already inventoried/manifest-bound — path containing root id
      // alone is insufficient (depth-0 finding).
      const prior = byPath.has(item.path) || byPath.has(abs);
      if (!prior) continue;
      try {
        const st = execFileSync('git', ['-C', item.path, 'status', '--porcelain=v1'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        item.dirty = st.trim().length > 0;
        item.clean = !item.dirty;
        item.identity_known = true;
        const tip = execFileSync('git', ['-C', item.path, 'rev-parse', 'HEAD'], {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        item.tip = tip;
        const priorItem = byPath.get(item.path) || byPath.get(abs) || {};
        const frozenBase = isCanonicalGitObjectId(priorItem.base_sha)
          ? priorItem.base_sha
          : (isCanonicalGitObjectId(baseSha) ? baseSha : null);
        if (!frozenBase) {
          item.unique = null;
          item.identity_known = false;
          item.unique_reason = 'frozen_base_unavailable';
        } else {
          const resolvedBase = execFileSync(
            'git',
            ['-C', item.path, 'rev-parse', `${frozenBase}^{commit}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
          const tipTree = execFileSync(
            'git',
            ['-C', item.path, 'rev-parse', `${tip}^{tree}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
          const baseTree = execFileSync(
            'git',
            ['-C', item.path, 'rev-parse', `${resolvedBase}^{tree}`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
          ).trim();
          item.base_sha = resolvedBase;
          item.unique = tip !== resolvedBase && tipTree !== baseTree;
        }
      } catch (error) {
        if (failClosedOnGitError) {
          return {
            ok: false,
            inventory: [],
            source: 'git_error',
            reason: error.message || String(error),
            root_run_id: rootRunId,
          };
        }
        item.identity_known = false;
      }
      put(item, { live: true });
    }
  } catch (error) {
    if (failClosedOnGitError) {
      return {
        ok: false,
        inventory: [],
        source: 'git_error',
        reason: error.message || String(error),
        root_run_id: rootRunId,
      };
    }
    const inventory = [...byPath.values()];
    return {
      inventory,
      source: 'controller_partial',
      root_run_id: rootRunId,
      digest: sha256Json(inventory),
      ok: false,
    };
  }
  const inventory = [...byPath.values()];
  return {
    inventory,
    source: 'git_worktree_list',
    root_run_id: rootRunId,
    digest: sha256Json(inventory),
    ok: true,
  };
}

/**
 * Pre-effect admission: debt + high-water + transcript open debt must all clear.
 */
function checkTempCapacity({ gitCwd, tempCapacityLimit = null } = {}) {
  // Mechanically check remaining temp/disk capacity when a limit is configured.
  if (!Number.isSafeInteger(tempCapacityLimit) || tempCapacityLimit <= 0) {
    return { ok: true, unobserved: true };
  }
  try {
    const { execFileSync } = require('child_process');
    const target = isStr(gitCwd) ? gitCwd : process.cwd();
    // df -k P: portable-ish available KB on the volume holding the worktree parent.
    const out = execFileSync('df', ['-kP', target], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = out.trim().split('\n');
    if (lines.length < 2) return { ok: false, reason: 'temp capacity unreadable' };
    const cols = lines[1].trim().split(/\s+/);
    const availKb = Number(cols[3]);
    if (!Number.isFinite(availKb)) return { ok: false, reason: 'temp capacity unparseable' };
    if (availKb < tempCapacityLimit) {
      return {
        ok: false,
        reason: `temp capacity ${availKb}KB below configured limit ${tempCapacityLimit}KB`,
        available_kb: availKb,
      };
    }
    return { ok: true, available_kb: availKb };
  } catch (error) {
    return { ok: false, reason: `temp capacity check failed: ${error.message || String(error)}` };
  }
}

function admitControllerEffectsFromPersisted({
  gitCwd,
  controller,
  rootRunId = null,
  workOrderId = null,
  highWater = 4,
  wouldCreateWorktree = false,
  manifests = null,
  results = null,
  baseSha = null,
}) {
  const reconstructed = reconstructOwnedInventory({
    gitCwd, controller, rootRunId, manifests, results, baseSha, failClosedOnGitError: true,
  });
  if (reconstructed.ok === false) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      code: 'INVENTORY_OBSERVATION_FAILED',
      reason: reconstructed.reason || 'owned inventory reconstruction failed closed',
      inventory: [],
      owned_worktrees: 0,
    };
  }
  const inventory = reconstructed.inventory || [];
  const liveOwned = inventory.filter((i) => i.kind === 'worktree' && i.path).length;
  const debt = buildResourceDebtState(inventory, {
    dispatchRecords: (controller && controller.dispatch_records) || [],
  });
  if (debt.blocks_dispatch) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      code: 'RESOURCE_DEBT_BLOCKS_DISPATCH',
      reason: 'unresolved resource debt blocks new effects',
      debt,
      inventory,
      owned_worktrees: liveOwned,
    };
  }
  // Project next creation: admit projected <= highWater; reject projected > highWater.
  const projectedOwned = liveOwned + (wouldCreateWorktree ? 1 : 0);
  const hwLimit = Number.isSafeInteger(controller && controller.repair_budget_limits
    && controller.repair_budget_limits.owned_worktrees)
    ? controller.repair_budget_limits.owned_worktrees
    : highWater;
  // Mechanically check configured temporary capacity before checkout creation.
  let tempCapacityOk = true;
  if (wouldCreateWorktree) {
    const tempLimit = Number.isSafeInteger(controller && controller.temp_capacity_limit)
      ? controller.temp_capacity_limit
      : null;
    if (tempLimit != null) {
      const temp = checkTempCapacity({ gitCwd, tempCapacityLimit: tempLimit });
      if (!temp.ok) {
        return {
          ok: false,
          allow_checkout: false,
          allow_runner: false,
          effects: 0,
          code: 'TEMP_CAPACITY_EXCEEDED',
          reason: temp.reason,
          debt,
          inventory,
          owned_worktrees: liveOwned,
        };
      }
      tempCapacityOk = temp.ok === true;
    }
  }
  const hw = admitHighWater({
    currentOwned: projectedOwned,
    highWater: hwLimit,
    unresolvedDebt: debt.blocks_dispatch,
    tempCapacityOk,
  });
  if (!hw.ok) {
    return {
      ...hw,
      debt,
      inventory,
      owned_worktrees: liveOwned,
      effects: 0,
    };
  }
  // Transcript audit: preserve mechanically derived blocking classification only.
  if (isStr(rootRunId) && isStr(workOrderId)) {
    const audit = rebuildTranscriptAudit({
      rootRunId,
      workOrderId,
      auditEvents: (controller && controller.audit_events) || [],
      dispatches: (controller && controller.dispatch_records) || [],
      resources: inventory,
      gates: (controller && controller.gate_journal && controller.gate_journal.entries) || [],
      repairs: (controller && controller.repair_tickets) || [],
      resumes: (controller && controller.resume_receipts) || [],
      dispositions: (debt.open || []).map((d) => ({
        ...d,
        // Keep derived classification; do not force every open row to block.
        blocks_dispatch: d.blocks_dispatch === true,
      })),
    });
    if (audit.blocks_next_dispatch) {
      return {
        ok: false,
        allow_checkout: false,
        allow_runner: false,
        effects: 0,
        code: 'TRANSCRIPT_OPEN_DEBT',
        reason: 'transcript audit reports open owned-resource debt',
        audit,
        debt,
        inventory,
        owned_worktrees: liveOwned,
      };
    }
    return {
      ok: true,
      allow_checkout: true,
      allow_runner: true,
      effects: 0,
      debt,
      inventory,
      audit,
      owned_worktrees: liveOwned,
      inventory_digest: reconstructed.digest || null,
    };
  }
  return {
    ok: true,
    allow_checkout: true,
    allow_runner: true,
    effects: 0,
    debt,
    inventory,
    owned_worktrees: liveOwned,
    inventory_digest: reconstructed.digest || null,
  };
}

function controllerEffectAuthorityReject(code, reason, extra = {}) {
  return {
    ok: false,
    allow_checkout: false,
    allow_runner: false,
    effects: 0,
    code,
    reason,
    ...extra,
  };
}

/**
 * Hot-path effect admission is valid only while holding the exact persisted
 * controller Work Order fence.  The caller snapshot is a comparison input, not
 * authority: reload the canonical record under its lock and reject every stale,
 * partial, foreign, or tampered fence before inventory observation or effects.
 */
function admitControllerEffects(input = {}) {
  const {
    gitCwd,
    controller,
    rootRunId = null,
    graphNode = null,
    attempt = null,
    workOrderId = null,
    workOrderGeneration = null,
    workOrderCasToken = null,
    expectedWorkOrderDigest = null,
    expectedControllerDigest = null,
  } = input;
  if (!isStr(gitCwd)
      || !isStr(rootRunId)
      || !isStr(graphNode)
      || !Number.isSafeInteger(attempt)
      || attempt < 1
      || !isStr(workOrderId)
      || !Number.isSafeInteger(workOrderGeneration)
      || workOrderGeneration < 1
      || !isStr(workOrderCasToken)
      || !isCanonicalSha256(expectedWorkOrderDigest)
      || !isCanonicalSha256(expectedControllerDigest)
      || !isObj(controller)) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_WORK_ORDER_FENCE_INCOMPLETE',
      'effect admission requires exact git/root/node/attempt/work-order generation/CAS/digest/controller authority',
    );
  }
  let callerControllerDigest;
  try {
    callerControllerDigest = controllerStateDigest(controller);
  } catch (error) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_SNAPSHOT_INVALID',
      `caller controller snapshot cannot be canonicalized: ${error.message || String(error)}`,
    );
  }
  if (controller.controller_digest !== expectedControllerDigest
      || callerControllerDigest !== expectedControllerDigest) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_SNAPSHOT_DIGEST_MISMATCH',
      'caller controller snapshot does not match the supplied controller digest fence',
    );
  }
  const {
    resolveGitCommonDir,
    workOrderPath,
    readJsonStrict,
    validateStoredWorkOrderIntegrity,
    withWorkOrderLock,
  } = require('./work-order');
  const commonDir = resolveGitCommonDir(gitCwd);
  if (!isStr(commonDir)) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_WORK_ORDER_COMMON_DIR_MISSING',
      'cannot resolve Git common dir for effect admission',
    );
  }
  const exactPath = workOrderPath(commonDir, rootRunId, graphNode, attempt);
  let locked;
  try {
    locked = withWorkOrderLock(exactPath, () => {
      const parsed = readJsonStrict(exactPath);
      if (!parsed.ok || !isObj(parsed.value)) {
        return controllerEffectAuthorityReject(
          parsed.reason_code === 'work_order_unreadable'
            ? 'CONTROLLER_WORK_ORDER_UNREADABLE'
            : 'CONTROLLER_WORK_ORDER_MISSING',
          parsed.reason || 'exact persisted controller Work Order is missing',
          { work_order_path: exactPath },
        );
      }
      const workOrder = parsed.value;
      const integrity = validateStoredWorkOrderIntegrity(workOrder);
      if (!integrity.ok) {
        return controllerEffectAuthorityReject(
          'CONTROLLER_WORK_ORDER_INTEGRITY',
          integrity.reason,
          {
            reason_code: integrity.reason_code,
            work_order_path: exactPath,
          },
        );
      }
      if (workOrder.role !== 'controller'
          || workOrder.root_run_id !== rootRunId
          || workOrder.graph_node !== graphNode
          || workOrder.attempt !== attempt
          || workOrder.work_order_id !== workOrderId) {
        return controllerEffectAuthorityReject(
          'CONTROLLER_WORK_ORDER_IDENTITY_MISMATCH',
          'persisted Work Order does not match the exact controller tuple',
          { work_order_path: exactPath },
        );
      }
      if (workOrder.disposition != null || workOrder.terminal_status != null) {
        return controllerEffectAuthorityReject(
          'CONTROLLER_WORK_ORDER_TERMINAL',
          'terminal or dispositioned controller Work Order cannot authorize new effects',
          { work_order_path: exactPath },
        );
      }
      if (workOrder.generation !== workOrderGeneration
          || workOrder.cas_token !== workOrderCasToken
          || workOrder.digest !== expectedWorkOrderDigest) {
        return controllerEffectAuthorityReject(
          'CONTROLLER_WORK_ORDER_FENCE_STALE',
          'persisted Work Order generation/CAS/digest no longer matches the caller fence',
          { work_order_path: exactPath },
        );
      }
      if (!isObj(workOrder.controller)
          || workOrder.controller.controller_digest !== expectedControllerDigest
          || controllerStateDigest(workOrder.controller) !== expectedControllerDigest
          || JSON.stringify(workOrder.controller) !== JSON.stringify(controller)) {
        return controllerEffectAuthorityReject(
          'CONTROLLER_WORK_ORDER_CONTROLLER_STALE',
          'caller controller snapshot is not the exact current persisted controller',
          { work_order_path: exactPath },
        );
      }
      return admitControllerEffectsFromPersisted({
        ...input,
        controller: workOrder.controller,
        rootRunId: workOrder.root_run_id,
        workOrderId: workOrder.work_order_id,
      });
    });
  } catch (error) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_WORK_ORDER_AUTHORITY_ERROR',
      error.message || String(error),
      { work_order_path: exactPath },
    );
  }
  if (!locked || locked.ok !== true) {
    return controllerEffectAuthorityReject(
      'CONTROLLER_WORK_ORDER_LOCKED',
      (locked && locked.reason) || 'cannot acquire exact controller Work Order lock',
      {
        reason_code: locked && locked.reason_code,
        work_order_path: exactPath,
      },
    );
  }
  return locked.value;
}

function runPostCompactAdapter(input = {}) {
  // Host-neutral recovery gate. Does not write production Codex manifests or
  // overwrite user-owned hook-probe files.
  const {
    reconcileFn,
    rootRunId,
    gitCwd,
    durable = null,
    workOrder = null,
    graphNode = isObj(workOrder) ? workOrder.graph_node : null,
    attempt = isObj(workOrder) ? workOrder.attempt : null,
    workOrderId = isObj(workOrder) ? workOrder.work_order_id : null,
    probeEvidenceAccepted = false,
  } = input;
  if (typeof reconcileFn !== 'function') {
    return {
      status: 'reject',
      reason_code: 'reconcile_fn_required',
      reason: 'PostCompact adapter requires the shared recovery reconcile function',
      production_hook_wired: false,
    };
  }
  if (!isStr(rootRunId)) {
    return {
      status: 'reject',
      reason_code: 'root_run_id_required',
      reason: 'root_run_id required for PostCompact recovery',
      production_hook_wired: false,
    };
  }
  if (!isStr(graphNode) || !Number.isSafeInteger(attempt) || attempt < 1
      || !isStr(workOrderId)
      || !isObj(workOrder)
      || workOrder.role !== 'controller'
      || workOrder.root_run_id !== rootRunId
      || workOrder.graph_node !== graphNode
      || workOrder.attempt !== attempt
      || workOrder.work_order_id !== workOrderId) {
    return {
      status: 'reject',
      reason_code: 'controller_recovery_tuple_required',
      reason: 'PostCompact recovery requires one exact controller root/node/attempt/id tuple',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    };
  }
  // Reconstruct inventory mechanically from the exact controller Work Order and
  // live Git registration. Caller inventory is never substituted as authority;
  // when supplied it is only a digest-equality cross-check against this observation.
  const controller = isObj(workOrder) && isObj(workOrder.controller)
    ? workOrder.controller
    : null;
  if (!controller) {
    return {
      status: 'reject',
      reason_code: 'controller_work_order_missing',
      reason: 'controller Work Order body is missing',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    };
  }
  const reconstructed = reconstructOwnedInventory({
    gitCwd,
    controller,
    rootRunId,
    baseSha: workOrder.base_sha,
    failClosedOnGitError: true,
  });
  if (reconstructed.ok === false) {
    return {
      status: 'reject',
      reason_code: 'inventory_observation_failed',
      reason: reconstructed.reason || 'inventory reconstruction failed',
      production_hook_wired: false,
      duplicate_dispatch: 0,
    };
  }
  const resourceInventory = reconstructed.inventory || [];
  if (Object.prototype.hasOwnProperty.call(input, 'resourceInventory')) {
    const supplied = Array.isArray(input.resourceInventory) ? input.resourceInventory : null;
    const suppliedDigest = input.inventoryDigest || input.inventory_observation_digest || null;
    if (!Array.isArray(supplied)
        || !isCanonicalSha256(suppliedDigest)
        || sha256Json(supplied) !== suppliedDigest
        || suppliedDigest !== (reconstructed.digest || sha256Json(resourceInventory))) {
      return {
        status: 'reject',
        reason_code: 'inventory_crosscheck_mismatch',
        reason: 'caller inventory does not exactly match mechanical Git reconstruction',
        production_hook_wired: false,
        duplicate_dispatch: 0,
      };
    }
  }
  let reconcile;
  try {
    reconcile = reconcileFn({
      gitCwd,
      root_run_id: rootRunId,
      durable,
      requireBoundEvidence: true,
      controllerRecovery: true,
      graph_node: graphNode,
      attempt,
      work_order_id: workOrderId,
    });
  } catch (error) {
    return {
      status: 'reject',
      reason_code: 'reconcile_threw',
      reason: `PostCompact reconcile threw: ${error.message || String(error)}`,
      production_hook_wired: false,
      duplicate_dispatch: 0,
    };
  }
  const debt = buildResourceDebtState(resourceInventory, {
    dispatchRecords: (controller && controller.dispatch_records) || [],
  });
  // Fail-closed: readiness requires an object whose status is exactly 'reconciled'.
  // null/undefined/malformed/any other status never become ready.
  // Capacity uncertainty / partial observation / missing authority never ready.
  // Zero classifications (no controller Work Order for root) never ready.
  const classifications = isObj(reconcile) && Array.isArray(reconcile.classifications)
    ? reconcile.classifications
    : null;
  const hasExactController = isObj(workOrder)
    && workOrder.role === 'controller'
    && isObj(workOrder.controller);
  const exactClassification = Array.isArray(classifications) && classifications.length === 1
    ? classifications[0] : null;
  let reconcileReceiptValid = false;
  let reconcileReceiptReason = null;
  if (isObj(reconcile) && isObj(reconcile.receipt)) {
    try {
      const {
        resolveGitCommonDir,
        validateReconcileReceipt,
      } = require('./work-order');
      const commonDir = resolveGitCommonDir(gitCwd);
      const validated = validateReconcileReceipt(reconcile.receipt, {
        root_run_id: rootRunId,
        commonDir,
        gitCwd,
        requireBoundEvidence: true,
        controllerRecovery: true,
        graph_node: graphNode,
        attempt,
        work_order_id: workOrderId,
      });
      reconcileReceiptValid = validated.ok === true;
      reconcileReceiptReason = validated.ok ? null : validated.reason;
    } catch (error) {
      reconcileReceiptReason = error.message || String(error);
    }
  }
  const reconcileOk = isObj(reconcile)
    && reconcile.status === 'reconciled'
    && Array.isArray(classifications)
    && classifications.length === 1
    && exactClassification.classification === 'attach_active'
    && exactClassification.recovery === true
    && exactClassification.root_run_id === rootRunId
    && exactClassification.graph_node === graphNode
    && exactClassification.attempt === attempt
    && exactClassification.work_order_id === workOrderId
    && exactClassification.work_order_digest === workOrder.digest
    && isCanonicalSha256(exactClassification.recovery_observation_digest)
    && hasExactController
    && reconcileReceiptValid;
  const reconcileFailureCode = !isObj(reconcile)
    ? 'reconcile_missing'
    : (reconcile.status !== 'reconciled'
      ? (reconcile.reason_code || 'reconcile_failed')
      : (Array.isArray(classifications) && classifications.length === 0
        ? 'controller_work_order_missing'
        : (!reconcileReceiptValid
          ? 'reconcile_receipt_invalid'
          : (reconcile.reason_code || 'reconcile_failed'))));
  const recoveryFailureCode = !hasExactController
    ? 'controller_work_order_missing'
    : reconcileFailureCode;
  const recoveryFailureReason = !hasExactController
    || (Array.isArray(classifications) && classifications.length === 0)
    ? 'PostCompact requires exactly one integrity-valid controller Work Order for root'
    : (isObj(reconcile) && reconcile.status !== 'reconciled'
      ? (reconcile.reason || 'reconcile failed')
      : (!reconcileReceiptValid
        ? (reconcileReceiptReason
          || 'PostCompact reconcile receipt failed mechanical validation')
        : (isObj(reconcile)
          ? (reconcile.reason || 'reconcile failed')
          : 'PostCompact reconcile did not return status=reconciled')));
  // Build complete final body first — seal once.  Authority claims are derived
  // only from sources this adapter actually loaded; caller labels cannot make
  // an uninspected ledger/manifest/Mission source authoritative.
  const authorityClaims = [...new Set([
    'controller_work_order',
    'git_worktree_list',
    'reconcile_post_compact',
    ...(isObj(reconcile) && Array.isArray(reconcile.authority_sources_checked)
      ? reconcile.authority_sources_checked : []),
  ])].sort();
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: POSTCOMPACT_ADAPTER_ARTIFACT,
    root_run_id: rootRunId,
    reconcile_status: isObj(reconcile) ? reconcile.status : null,
    reconcile_reason_code: isObj(reconcile)
      ? (reconcileOk ? (reconcile.reason_code || null) : recoveryFailureCode)
      : 'reconcile_missing',
    resource_debt_blocks: debt.blocks_dispatch,
    resource_debt_digest: debt.digest,
    inventory_count: resourceInventory.length,
    production_hook_wired: false,
    probe_evidence_accepted: probeEvidenceAccepted === true,
    hook_probe_files_touched: false,
    authority_sources_checked: authorityClaims,
    issued_at: nowIso(),
  };
  body.digest = sha256Json(body);
  const blocked = !reconcileOk || debt.blocks_dispatch;
  return {
    status: blocked ? 'reject' : 'ready',
    reason_code: blocked
      ? (debt.blocks_dispatch
        ? 'resource_debt_open'
        : recoveryFailureCode)
      : null,
    reason: blocked
      ? (debt.blocks_dispatch
        ? 'resource debt blocks managed dispatch after compaction'
        : recoveryFailureReason)
      : 'PostCompact recovery gate ready',
    receipt: body,
    reconcile: isObj(reconcile) ? reconcile : null,
    resource_debt: debt,
    inventory: resourceInventory,
    production_hook_wired: false,
    duplicate_dispatch: 0,
  };
}

/**
 * Mission executable-delta admission (pre-spend).
 * Separates allowed-to-change, required-to-change, and authorized creates.
 */
function readPathBytes(repoRoot, relativePath) {
  // Returns canonical sha256 of raw file bytes (preferred authority form).
  return pathContentDigest(repoRoot, relativePath);
}

function bytesEqual(a, b) {
  // Exact byte equality only — no base64 guessing, no NFC normalization.
  // Prefer canonical sha256 digests (64-hex). Buffers compare via equals.
  // Plain strings compare as UTF-8 byte sequences of the literal string.
  if (a == null || b == null) return false;
  if (Buffer.isBuffer(a) && Buffer.isBuffer(b)) return a.equals(b);
  if (typeof a === 'string' && typeof b === 'string') {
    // If both look like canonical sha256 digests, compare as digests (hex).
    if (/^[0-9a-f]{64}$/.test(a) && /^[0-9a-f]{64}$/.test(b)) return a === b;
    // Exact string equality (byte-identical UTF-8 of the literal). No base64 decode.
    return a === b;
  }
  if (Buffer.isBuffer(a) && typeof b === 'string') {
    return a.equals(Buffer.from(b, 'utf8'));
  }
  if (typeof a === 'string' && Buffer.isBuffer(b)) {
    return Buffer.from(a, 'utf8').equals(b);
  }
  return false;
}

/** Canonical sha256 of raw file bytes (not UTF-8-normalized text). */
function pathContentDigest(repoRoot, relativePath) {
  if (!isStr(repoRoot) || !isStr(relativePath)) return null;
  const abs = path.join(repoRoot, relativePath);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (_e) {
    return null;
  }
}

function admitExecutableMissionDelta({
  repoRoot,
  allowedPathPrefixes = [],
  requiredPaths = [],
  outputPaths = [],
  authorizedCreates = [],
  versionMirrorPaths = [],
  versionMirrorGenerator = null,
  historicalOutputs = null,
  currentBytesByPath = null,
  noOpReceipt = null,
  baseSha = null,
  // Paths declared outside the sealed required/output sets (typos / phantoms).
  extraDeclaredPaths = [],
  // When true (default for Mission admission), missing output_paths require
  // explicit authorized_creates. Opt out only for isolated lower-level fixtures
  // that cannot reach the Mission admission rail.
  strictOutputCreates = true,
}) {
  const creates = new Set((authorizedCreates || []).map(String));
  const allowed = (allowedPathPrefixes || []).map(String);
  const required = (requiredPaths || []).map(String);
  const outputs = (outputPaths || []).map(String);
  const reasons = [];

  function underAllowed(p) {
    return allowed.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
  }

  for (const p of [...required, ...outputs]) {
    if (!underAllowed(p)) {
      reasons.push({ code: 'PATH_OUTSIDE_ALLOW', path: p });
    }
  }

  // Absent outputs always require explicit authorized_creates under strict mode
  // (Mission admission enables this fail-closed). Existing files may change freely.
  for (const p of outputs) {
    if (!repoRoot) continue;
    const abs = path.join(repoRoot, p);
    const exists = fs.existsSync(abs);
    if (!exists && strictOutputCreates && !creates.has(p)) {
      reasons.push({
        code: 'OUTPUT_MISSING_CREATE_AUTH',
        path: p,
        reason: 'absent output requires explicit authorized create',
      });
    }
  }

  // Required paths must exist unless explicitly authorized as creates.
  for (const p of required) {
    if (!repoRoot) continue;
    const abs = path.join(repoRoot, p);
    if (!fs.existsSync(abs) && !creates.has(p)) {
      reasons.push({
        code: 'REQUIRED_PATH_MISSING',
        path: p,
        reason: 'required path does not exist and is not an authorized create',
      });
    }
  }

  // Explicit phantom/typo paths: not in required/output, do not exist, no create auth.
  for (const p of (extraDeclaredPaths || []).map(String)) {
    if (!repoRoot) continue;
    const abs = path.join(repoRoot, p);
    if (!fs.existsSync(abs) && !creates.has(p) && !outputs.includes(p) && !required.includes(p)) {
      reasons.push({
        code: 'OUTPUT_MISSING_CREATE_AUTH',
        path: p,
        reason: 'nonexistent path lacks create authority',
      });
    }
  }

  if (Array.isArray(versionMirrorPaths) && versionMirrorPaths.length > 0) {
    if (!isStr(versionMirrorGenerator)) {
      reasons.push({
        code: 'VERSION_MIRROR_GENERATOR_MISSING',
        reason: 'version-related outputs require a named generator closure',
      });
    }
    // Path-set closure: every listed mirror must appear in outputs or required.
    // Exact complete sync-version membership is enforced by Mission admission
    // (verifyVersionMirrorClosure), not this lower-level helper.
    for (const mirror of versionMirrorPaths) {
      if (!outputs.includes(mirror) && !required.includes(mirror)) {
        reasons.push({
          code: 'VERSION_MIRROR_INCOMPLETE',
          path: mirror,
          reason: 'version mirror path not closed into required/output set',
        });
      }
    }
  }

  // Historical-output replay: same raw-byte digests as a prior terminal receipt.
  // historicalOutputs values may be sha256 digests or (test seam) raw content strings;
  // currentBytesByPath from production loaders are always sha256 digests.
  if (isObj(historicalOutputs) && isObj(currentBytesByPath) && !noOpReceipt) {
    const histKeys = Object.keys(historicalOutputs).sort();
    const same = histKeys.length > 0 && histKeys.every((k) => {
      const cur = currentBytesByPath[k];
      const hist = historicalOutputs[k];
      if (cur == null || hist == null) return false;
      if (bytesEqual(cur, hist)) return true;
      // If historical is raw content, compare sha256(content) to current digest.
      if (typeof hist === 'string' && isCanonicalSha256(cur) && !isCanonicalSha256(hist)) {
        const histDig = crypto.createHash('sha256')
          .update(Buffer.from(hist, 'utf8'))
          .digest('hex');
        return histDig === cur;
      }
      return false;
    });
    if (same && histKeys.some((k) => outputs.includes(k) || required.includes(k))) {
      reasons.push({
        code: 'HISTORICAL_OUTPUT_REPLAY',
        reason: 'historical output bytes would be replayed without bound no-op adoption',
      });
    }
  }

  // Digest-bound no-op adoption: no mutation/gate attempt when preconditions hold.
  // Prefer closed path_byte_digests (sha256 of raw bytes). current_bytes may
  // carry either digests or exact literal content for fixture seams — live
  // comparison always uses mechanical pathContentDigest when repoRoot is set.
  if (isObj(noOpReceipt)) {
    const relevantPaths = [...new Set([...required, ...outputs])].sort();
    const receiptDigests = isObj(noOpReceipt.path_byte_digests)
      ? noOpReceipt.path_byte_digests
      : null;
    const receiptBytes = isObj(noOpReceipt.current_bytes) ? noOpReceipt.current_bytes : null;
    const binding = receiptDigests || receiptBytes;
    let noopOk = true;
    if (!isCanonicalGitObjectId(noOpReceipt.base_sha)) {
      reasons.push({
        code: 'NOOP_BINDING_INCOMPLETE',
        reason: 'no-op base_sha must be a canonical full git object id',
      });
      noopOk = false;
    } else if (baseSha != null && noOpReceipt.base_sha !== baseSha) {
      reasons.push({
        code: 'NOOP_BINDING_INCOMPLETE',
        reason: 'no-op base_sha does not match admission base',
      });
      noopOk = false;
    }
    if (!isCanonicalSha256(noOpReceipt.acceptance_digest)) {
      reasons.push({
        code: 'NOOP_BINDING_INCOMPLETE',
        reason: 'no-op acceptance_digest must be a canonical sha256 hex digest',
      });
      noopOk = false;
    }
    if (!isObj(binding)) {
      reasons.push({
        code: 'NOOP_BINDING_INCOMPLETE',
        reason: 'no-op requires path_byte_digests or current_bytes path bindings',
      });
      noopOk = false;
    } else {
      const receiptKeys = Object.keys(binding).sort();
      if (JSON.stringify(receiptKeys) !== JSON.stringify(relevantPaths)) {
        reasons.push({
          code: 'NOOP_BYTES_MISMATCH',
          reason: 'no-op path bindings must exactly equal required+output paths',
        });
        noopOk = false;
      }
      for (const p of receiptKeys) {
        if (typeof binding[p] !== 'string') {
          reasons.push({
            code: 'NOOP_BYTES_MISMATCH',
            path: p,
            reason: 'no-op path binding values must be strings',
          });
          noopOk = false;
          continue;
        }
        if (isObj(currentBytesByPath)) {
          if (!Object.prototype.hasOwnProperty.call(currentBytesByPath, p)) {
            reasons.push({
              code: 'NOOP_BYTES_MISMATCH',
              path: p,
              reason: 'no-op binding disagrees with supplied currentBytesByPath',
            });
            noopOk = false;
          } else {
            const cur = currentBytesByPath[p];
            const bnd = binding[p];
            let match = bytesEqual(cur, bnd);
            if (!match && typeof bnd === 'string' && isCanonicalSha256(cur)
                && !isCanonicalSha256(bnd)) {
              match = crypto.createHash('sha256')
                .update(Buffer.from(bnd, 'utf8'))
                .digest('hex') === cur;
            }
            if (!match) {
              reasons.push({
                code: 'NOOP_BYTES_MISMATCH',
                path: p,
                reason: 'no-op binding disagrees with supplied currentBytesByPath',
              });
              noopOk = false;
            }
          }
        }
        if (isStr(repoRoot)) {
          const liveDigest = pathContentDigest(repoRoot, p);
          if (liveDigest === null) {
            reasons.push({
              code: 'NOOP_BYTES_MISMATCH',
              path: p,
              reason: 'no-op path missing from repository',
            });
            noopOk = false;
          } else if (receiptDigests) {
            if (liveDigest !== binding[p]) {
              reasons.push({
                code: 'NOOP_BYTES_MISMATCH',
                path: p,
                reason: 'no-op path_byte_digests disagree with mechanical repository digests',
              });
              noopOk = false;
            }
          } else {
            // current_bytes form: compare sha256 of the bound content to live.
            const boundDigest = isCanonicalSha256(binding[p])
              ? binding[p]
              : crypto.createHash('sha256').update(Buffer.from(binding[p], 'utf8')).digest('hex');
            if (liveDigest !== boundDigest) {
              reasons.push({
                code: 'NOOP_BYTES_MISMATCH',
                path: p,
                reason: 'no-op current_bytes disagree with mechanical repository digests',
              });
              noopOk = false;
            }
          }
        }
      }
    }
    if (noopOk && reasons.length === 0) {
      return {
        ok: true,
        admitted: true,
        noop: true,
        dispatcher_called: false,
        mutation_attempts: 0,
        gate_attempts: 0,
        reason: 'digest-bound no-op adoption; no mutation/gate spend',
        required_paths: required,
        output_paths: outputs,
      };
    }
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      admitted: false,
      noop: false,
      dispatcher_called: false,
      mutation_attempts: 0,
      gate_attempts: 0,
      reasons,
      reason: reasons.map((r) => r.code).join(','),
    };
  }

  return {
    ok: true,
    admitted: true,
    noop: false,
    dispatcher_called: false, // admission only; dispatch is a later effect
    mutation_attempts: 0,
    gate_attempts: 0,
    required_paths: required,
    output_paths: outputs,
    narrow_required_ok: true,
  };
}

/**
 * Hash raw Git bytes at an accepted commit for the exact required/output path set.
 * Returns closed historical_outputs + digest suitable for controller persistence.
 */
function buildHistoricalOutputsAtCommit({
  gitCwd,
  acceptedCommit,
  paths = [],
  binding = {},
} = {}) {
  if (!isStr(gitCwd) || !isCanonicalGitObjectId(acceptedCommit)) {
    fail('HISTORICAL_OUTPUTS_BINDING', 'gitCwd and accepted commit required');
  }
  const pathSet = [...new Set((Array.isArray(paths) ? paths : []).filter(isStr))].sort();
  if (pathSet.length === 0) {
    fail('HISTORICAL_OUTPUTS_BINDING', 'exact path set required for historical outputs');
  }
  const { execFileSync } = require('child_process');
  const outputs = {};
  for (const p of pathSet) {
    try {
      const raw = execFileSync('git', ['-C', gitCwd, 'show', `${acceptedCommit}:${p}`], {
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
      outputs[p] = crypto.createHash('sha256').update(raw).digest('hex');
    } catch (error) {
      fail(
        'HISTORICAL_OUTPUTS_READ_FAILED',
        `cannot hash ${p} at ${acceptedCommit}: ${error.message || String(error)}`,
      );
    }
  }
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: 'historical_outputs',
    accepted_commit: acceptedCommit,
    path_byte_digests: outputs,
    repo_identity: binding.repo_identity || null,
    mission_lineage_id: binding.mission_lineage_id || null,
    mission_policy_digest: binding.mission_policy_digest || null,
    mission_graph_digest: binding.mission_graph_digest || null,
    graph_node_id: binding.graph_node_id || null,
    graph_attempt: binding.graph_attempt || null,
    mission_claim_id: binding.mission_claim_id || null,
    mission_campaign_id: binding.mission_campaign_id || null,
    icc_campaign_id: binding.icc_campaign_id || null,
    campaign_contract_digest: binding.campaign_contract_digest || null,
    strict_contract_digest: binding.strict_contract_digest || null,
    base_sha: binding.base_sha || null,
    acceptance_digest: binding.acceptance_digest || null,
    verification_digest: binding.verification_digest || null,
  };
  // Digest must match Mission admission loader (owner-kernel canonicalJson sha256).
  let digest;
  try {
    const { sha256, canonicalJson } = require('./owner-kernel/canonical');
    digest = sha256(canonicalJson(body));
  } catch (_e) {
    digest = sha256Json(body);
  }
  return {
    outputs,
    record: body,
    digest,
  };
}

/**
 * Bound zero-spend no-op receipt for an already-satisfied node.
 */
function buildNoOpReceipt({
  baseSha,
  acceptanceDigest,
  pathByteDigests,
  binding = {},
} = {}) {
  if (!isCanonicalGitObjectId(baseSha)) {
    fail('NOOP_RECEIPT_BINDING', 'canonical base_sha required');
  }
  if (!isCanonicalSha256(acceptanceDigest)) {
    fail('NOOP_RECEIPT_BINDING', 'canonical acceptance_digest required');
  }
  if (!isObj(pathByteDigests) || Object.keys(pathByteDigests).length === 0) {
    fail('NOOP_RECEIPT_BINDING', 'path_byte_digests required');
  }
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: 'noop_receipt',
    base_sha: baseSha,
    acceptance_digest: acceptanceDigest,
    path_byte_digests: pathByteDigests,
    repo_identity: binding.repo_identity || null,
    mission_lineage_id: binding.mission_lineage_id || null,
    mission_policy_digest: binding.mission_policy_digest || null,
    mission_graph_digest: binding.mission_graph_digest || null,
    graph_node_id: binding.graph_node_id || null,
    graph_attempt: binding.graph_attempt || null,
    mission_claim_id: binding.mission_claim_id || null,
    mission_campaign_id: binding.mission_campaign_id || null,
    icc_campaign_id: binding.icc_campaign_id || null,
    campaign_contract_digest: binding.campaign_contract_digest || null,
    strict_contract_digest: binding.strict_contract_digest || null,
    accepted_commit: binding.accepted_commit || null,
    verification_digest: binding.verification_digest || null,
    dispatcher_called: false,
    mutation_attempts: 0,
    gate_attempts: 0,
  };
  // Mission admission verifies persisted receipts with owner-kernel canonical
  // JSON. Use that exact wire algorithm here so producer and durable consumer
  // cannot disagree merely because object insertion order differs.
  const { canonicalJson, sha256 } = require('./owner-kernel/canonical');
  return { ...body, digest: sha256(canonicalJson(body)) };
}

function rebuildTranscriptAudit({
  rootRunId,
  workOrderId,
  auditEvents = [],
  dispatches = [],
  resources = [],
  gates = [],
  repairs = [],
  dispositions = [],
  resumes = [],
  terminals = [],
  workOrder = null,
  manifestIndex = null,
  resultIndex = null,
  ledgerObservation = null,
}) {
  if (!isStr(rootRunId) || !isStr(workOrderId)) {
    fail('AUDIT_IDS_REQUIRED', 'root_run_id and work_order_id required for transcript audit');
  }
  const { canonicalJson, sha256 } = require('./owner-kernel/canonical');
  const canonicalDigest = (value) => sha256(canonicalJson(value));
  const rows = [];
  const problems = [];
  const observedDigest = (value, label) => {
    try {
      return canonicalDigest(value);
    } catch (error) {
      problems.push(`${label} is not canonical JSON: ${error.message || String(error)}`);
      return null;
    }
  };
  const actual = {
    dispatches: new Map(),
    resources: new Map(),
    gates: new Map(),
    repairs: new Map(),
    dispositions: new Map(),
    resumes: new Map(),
    terminals: new Map(),
    audit_events: new Map(),
  };
  const pushUnique = (bucket, kind, item, identity) => {
    if (!isObj(item)) {
      problems.push(`${kind} row is not an object`);
      return;
    }
    const id = identity;
    if (!isStr(id)) {
      problems.push(`${kind} missing its required explicit identity`);
      return;
    }
    if (actual[bucket].has(id)) {
      problems.push(`duplicate ${kind} identity ${id}`);
      return;
    }
    actual[bucket].set(id, item);
    if (item.root_run_id !== rootRunId || item.work_order_id !== workOrderId) {
      problems.push(
        `${kind} ${id} has foreign or missing controller tuple `
        + `${String(item.root_run_id)}/${String(item.work_order_id)}`,
      );
    }
    let preservedItem;
    try {
      preservedItem = JSON.parse(canonicalJson(item));
    } catch (error) {
      problems.push(`${kind} ${id} is not canonical JSON: ${error.message || String(error)}`);
      try {
        preservedItem = JSON.parse(JSON.stringify(item));
      } catch (_fallbackError) {
        preservedItem = { invalid_evidence: true };
      }
    }
    rows.push({
      ...preservedItem,
      // The evidence's tuple remains untouched. Never stamp requested authority
      // onto an observed row: a missing or foreign tuple must stay visible.
      kind,
      identity: id,
      observed_root_run_id: item.root_run_id ?? null,
      observed_work_order_id: item.work_order_id ?? null,
    });
  };
  for (const d of dispatches) {
    pushUnique('dispatches', 'dispatch', d, isObj(d) ? d.digest : null);
  }
  for (const r of resources) {
    pushUnique('resources', 'resource_creator', r, isObj(r) ? r.resource_id : null);
  }
  for (const g of gates) {
    pushUnique('gates', 'gate_return', g, isObj(g) ? g.gate_id : null);
  }
  for (const t of repairs) {
    pushUnique('repairs', 'repair_authorization', t, isObj(t) ? t.ticket_id : null);
  }
  for (const d of dispositions) {
    pushUnique('dispositions', 'disposition', d, isObj(d) ? d.resource_id : null);
  }
  for (const r of resumes) {
    pushUnique('resumes', 'resume', r, isObj(r) ? r.digest : null);
  }
  for (const t of terminals) {
    pushUnique('terminals', 'terminal', t, isObj(t) ? t.digest : null);
  }
  for (const e of auditEvents) {
    pushUnique('audit_events', 'audit_event', e, isObj(e) ? e.digest : null);
  }

  const authoritySourcesChecked = [];
  let boundWorkOrderController = null;
  const compareCanonicalSource = (label, observed, durable) => {
    const observedValue = observedDigest(observed, `${label} observed body`);
    const durableValue = observedDigest(durable, `${label} durable body`);
    if (observedValue == null || durableValue == null || observedValue !== durableValue) {
      problems.push(`${label} does not match durable authority`);
    }
  };
  if (workOrder != null) {
    if (!isObj(workOrder)
        || workOrder.root_run_id !== rootRunId
        || workOrder.work_order_id !== workOrderId
        || workOrder.role !== 'controller'
        || !isObj(workOrder.controller)) {
      problems.push('canonical controller Work Order authority is missing or foreign');
    } else {
      try {
        const {
          workOrderDigest,
        } = require('./work-order');
        if (!isCanonicalSha256(workOrder.digest)
            || workOrderDigest(workOrder) !== workOrder.digest
            || workOrder.controller.controller_digest
              !== controllerStateDigest(workOrder.controller)) {
          problems.push('canonical controller Work Order integrity mismatch');
        } else {
          authoritySourcesChecked.push('controller_work_order');
          boundWorkOrderController = workOrder.controller;
        }
      } catch (error) {
        problems.push(
          `canonical controller Work Order validation failed: ${
            error.message || String(error)
          }`,
        );
      }
      const snapshot = workOrder.controller;
      compareCanonicalSource(
        'Work Order dispatch records',
        dispatches,
        snapshot.dispatch_records || [],
      );
      compareCanonicalSource(
        'Work Order Git resource inventory',
        resources,
        snapshot.resource_inventory || [],
      );
      compareCanonicalSource(
        'Work Order gate journal',
        gates,
        (snapshot.gate_journal && snapshot.gate_journal.entries) || [],
      );
      compareCanonicalSource(
        'Work Order repair tickets',
        repairs,
        snapshot.repair_tickets || [],
      );
      compareCanonicalSource(
        'Work Order resume receipts',
        resumes,
        snapshot.resume_receipts || [],
      );
      compareCanonicalSource(
        'Work Order resource dispositions',
        dispositions,
        (snapshot.resource_debt && snapshot.resource_debt.open) || [],
      );
      const durableAuditIds = new Set(
        (snapshot.audit_events || [])
          .map((event) => event && event.digest)
          .filter((digest) => isStr(digest)),
      );
      for (const digest of durableAuditIds) {
        if (!actual.audit_events.has(digest)) {
          problems.push(`Work Order reducer/audit event ${digest} is missing`);
        }
      }
    }
  }

  const validateIndex = (label, index, artifactType, entries, sourceName) => {
    if (index == null) return;
    if (!isObj(index)
        || index.schema_version !== 1
        || index.artifact_type !== artifactType
        || index.root_run_id !== rootRunId
        || index.work_order_id !== workOrderId
        || !isCanonicalSha256(index.controller_digest)
        || !Array.isArray(index.entries)
        || !isObj(workOrder)
        || !isObj(workOrder.controller)
        || index.controller_digest !== workOrder.controller.controller_digest) {
      problems.push(`${label} durable authority is malformed or foreign`);
      return;
    }
    compareCanonicalSource(`${label} entries`, entries, index.entries);
    authoritySourcesChecked.push(sourceName);
  };
  validateIndex(
    'dispatch manifest index',
    manifestIndex,
    'controller_dispatch_manifest_index',
    dispatches,
    'dispatch_manifest_index',
  );
  validateIndex(
    'dispatch result/resource index',
    resultIndex,
    'controller_dispatch_result_index',
    resources,
    'dispatch_result_index',
  );
  if (ledgerObservation != null) {
    if (!isObj(ledgerObservation)
        || ledgerObservation.ok !== true
        || !isObj(ledgerObservation.latest)
        || ledgerObservation.latest.root_run_id !== rootRunId
        || ledgerObservation.latest.work_order_id !== workOrderId
        || !isObj(workOrder)
        || !isObj(workOrder.controller)
        || ledgerObservation.latest.controller_digest
          !== workOrder.controller.controller_digest
        || !isCanonicalSha256(ledgerObservation.history_digest)
        || !Number.isSafeInteger(ledgerObservation.event_count)
        || ledgerObservation.event_count < 1) {
      problems.push('rotation-aware controller ledger authority is incomplete or foreign');
    } else {
      authoritySourcesChecked.push('rotation_aware_controller_ledger');
    }
  }

  const expectedSets = {
    dispatches: new Map(),
    resources: new Map(),
    gates: new Map(),
    repairs: new Map(),
    dispositions: new Map(),
    resumes: new Map(),
    terminals: new Map(),
    effect_results: new Map(),
  };
  const observedEffectResults = new Map();
  const addExpected = (bucket, label, id, item, { allowExisting = false } = {}) => {
    if (!isStr(id)) {
      problems.push(`${label} is missing its explicit identity`);
      return;
    }
    if (expectedSets[bucket].has(id)) {
      if (!allowExisting) problems.push(`duplicate expected ${label} identity ${id}`);
      return;
    }
    expectedSets[bucket].set(id, item);
  };
  const addObservedEffectResult = (id, item) => {
    if (!isStr(id)) {
      problems.push('controller effect result is missing invocation_identity');
      return;
    }
    if (observedEffectResults.has(id)) {
      problems.push(`duplicate controller effect result for invocation ${id}`);
      return;
    }
    observedEffectResults.set(id, item);
  };

  // A resumed controller may inherit a candidate resource that was created
  // before this controller Work Order existed, so there is deliberately no
  // local dispatch invocation for it. Such a resource is explained only by an
  // exact recovery receipt sealed inside the integrity-valid Work Order and
  // matched against the independently supplied resource row. The optional
  // inventory array therefore cannot define its own expected set.
  if (boundWorkOrderController
      && Array.isArray(boundWorkOrderController.recovery_receipts)) {
    const recoveredIds = new Set();
    let recoveryAuthorityComplete = true;
    for (const receipt of boundWorkOrderController.recovery_receipts) {
      const resourceId = isObj(receipt) ? receipt.resource_id : null;
      if (!isStr(resourceId) || recoveredIds.has(resourceId)) {
        problems.push(
          !isStr(resourceId)
            ? 'Work Order recovery receipt is missing resource_id'
            : `duplicate Work Order recovery receipt for resource ${resourceId}`,
        );
        recoveryAuthorityComplete = false;
        continue;
      }
      recoveredIds.add(resourceId);
      const resource = actual.resources.get(resourceId);
      if (!resource
          || !isObj(resource.recovery_receipt)
          || observedDigest(
            resource.recovery_receipt,
            `resource ${resourceId} recovery receipt`,
          ) !== observedDigest(
            receipt,
            `Work Order resource ${resourceId} recovery receipt`,
          )) {
        problems.push(
          `Work Order recovery receipt for resource ${resourceId} `
          + 'does not match an exact observed resource receipt',
        );
        recoveryAuthorityComplete = false;
        addExpected('resources', 'recovered resource', resourceId, receipt, {
          allowExisting: true,
        });
        continue;
      }
      const recovery = validateRecoveryBundle(resource);
      if (!recovery.ok || recovery.receipt_digest !== receipt.digest) {
        problems.push(
          `Work Order recovery receipt for resource ${resourceId} is invalid: ${
            recovery.reason || 'digest mismatch'
          }`,
        );
        recoveryAuthorityComplete = false;
      }
      addExpected('resources', 'recovered resource', resourceId, receipt, {
        allowExisting: true,
      });
    }
    if (recoveredIds.size > 0 && recoveryAuthorityComplete) {
      authoritySourcesChecked.push('controller_recovery_receipts');
    }
  }

  for (const event of auditEvents) {
    if (!isObj(event)) continue;
    if (event.event === 'controller_effect_invoked') {
      if (!isStr(event.effect_kind)
          || !isCanonicalSha256(event.effect_identity)) {
        problems.push('controller effect invocation is missing exact kind/identity');
        continue;
      }
      const eventBody = { ...event };
      delete eventBody.at;
      delete eventBody.digest;
      if (!isCanonicalSha256(event.digest)
          || observedDigest(eventBody, 'controller effect invocation') !== event.digest) {
        problems.push(`controller effect invocation ${event.effect_identity} digest mismatch`);
      }
      if (event.effect_kind === 'dispatch') {
        addExpected('dispatches', 'dispatch', event.effect_identity, event);
        if (!isStr(event.resource_identity)) {
          problems.push(`dispatch ${event.effect_identity} is missing resource identity`);
        } else if (!expectedSets.resources.has(event.resource_identity)) {
          expectedSets.resources.set(event.resource_identity, event);
        }
      } else {
        if (!isCanonicalSha256(event.result_identity)
            || !Number.isSafeInteger(event.invocation_ordinal)
            || event.invocation_ordinal < 1) {
          problems.push(
            `controller effect invocation ${event.effect_identity} `
            + 'is missing exact result identity/ordinal',
          );
        } else if (observedDigest({
          schema_version: 1,
          root_run_id: event.root_run_id,
          work_order_id: event.work_order_id,
          stage: event.stage,
          effect_kind: event.effect_kind,
          generation: event.generation,
          invocation_ordinal: event.invocation_ordinal,
          result_identity: event.result_identity,
        }, 'controller effect invocation identity') !== event.effect_identity) {
          problems.push(
            `controller effect invocation ${event.effect_identity} identity mismatch`,
          );
        }
        addExpected('effect_results', 'effect invocation', event.effect_identity, event);
      }
    } else if (event.event === 'controller_effect_result') {
      if (!isStr(event.effect_kind)
          || !isStr(event.effect_identity)
          || !isCanonicalSha256(event.invocation_identity)
          || !isCanonicalSha256(event.invocation_result_identity)
          || !isCanonicalSha256(event.effect_result_digest)) {
        problems.push('controller effect result is missing exact kind/result identity');
        continue;
      }
      const eventBody = { ...event };
      delete eventBody.at;
      delete eventBody.digest;
      if (!isCanonicalSha256(event.digest)
          || observedDigest(eventBody, 'controller effect result') !== event.digest) {
        problems.push(`controller effect result ${event.effect_identity} digest mismatch`);
      }
      addObservedEffectResult(event.invocation_identity, event);
      if (event.effect_kind === 'gate') {
        addExpected('gates', 'gate return', event.effect_identity, event);
      }
    } else if (event.event === 'repair_ticket_appended') {
      addExpected('repairs', 'repair authorization', event.ticket_id, event);
    } else if (event.event === 'convergence_adjudication_consumed') {
      addExpected('resumes', 'resume receipt', event.digest, event);
    } else if (event.event === 'controller_terminal_receipt_recorded') {
      addExpected(
        'terminals',
        'terminal receipt',
        event.terminal_receipt_digest,
        event,
      );
    }
  }

  // Resource dispositions are independently reconstructed from the observed
  // inventory; the persisted debt array is never allowed to define its own
  // expected count or identity set.
  const reconstructedDebt = buildResourceDebtState(
    [...actual.resources.values()],
    { dispatchRecords: [...actual.dispatches.values()] },
  );
  for (const disposition of reconstructedDebt.open) {
    addExpected(
      'dispositions',
      'resource disposition',
      disposition.resource_id,
      disposition,
    );
  }

  const compareSets = (label, expectedMap, actualMap) => {
    for (const id of expectedMap.keys()) {
      if (!actualMap.has(id)) problems.push(`missing ${label} ${id}`);
    }
    for (const id of actualMap.keys()) {
      if (!expectedMap.has(id)) problems.push(`extra unexplained ${label} ${id}`);
    }
  };
  compareSets('dispatch', expectedSets.dispatches, actual.dispatches);
  compareSets('resource', expectedSets.resources, actual.resources);
  compareSets('gate return', expectedSets.gates, actual.gates);
  compareSets('repair authorization', expectedSets.repairs, actual.repairs);
  compareSets('resource disposition', expectedSets.dispositions, actual.dispositions);
  compareSets('resume receipt', expectedSets.resumes, actual.resumes);
  compareSets('terminal receipt', expectedSets.terminals, actual.terminals);
  compareSets('effect result', expectedSets.effect_results, observedEffectResults);

  for (const [id, dispatch] of actual.dispatches) {
    const event = expectedSets.dispatches.get(id);
    const body = isObj(dispatch) ? { ...dispatch } : {};
    delete body.at;
    delete body.digest;
    if (!isCanonicalSha256(id)
        || observedDigest(body, `dispatch ${id} record`) !== id) {
      problems.push(`dispatch ${id} record digest mismatch`);
    }
    if (!isStr(dispatch.run_id)
        || !isStr(dispatch.provider)
        || !isStr(dispatch.resource_id)
        || !isCanonicalSha256(dispatch.result_receipt_digest)) {
      problems.push(
        `dispatch ${id} lacks exact run/provider/resource/result-receipt identity`,
      );
    }
    if (!event) continue;
    const equalFields = [
      ['run_id', dispatch.run_id, event.run_id],
      ['dispatch_id', dispatch.dispatch_id, event.dispatch_id],
      ['provider', dispatch.provider, event.provider],
      ['runner', dispatch.runner, event.runner],
      ['model', dispatch.model, event.model],
      ['provider_session_id', dispatch.provider_session_id, event.provider_session_id],
      ['resource_identity', dispatch.resource_id, event.resource_identity],
      ['result_receipt_digest', dispatch.result_receipt_digest, event.result_receipt_digest],
    ];
    for (const [field, observed, recorded] of equalFields) {
      if (observed !== recorded) {
        problems.push(`dispatch ${id} ${field} does not match independent invocation event`);
      }
    }
  }

  for (const [id, gate] of actual.gates) {
    const event = expectedSets.gates.get(id);
    if (!isStr(gate.kind)
        || !isStr(gate.owner)
        || !isCanonicalSha256(gate.input_digest)
        || !isStr(gate.started_at)
        || !isStr(gate.finished_at)
        || !isObj(gate.result)) {
      problems.push(`gate ${id} is missing exact input/result/timing identity`);
      continue;
    }
    const effectResultDigest = observedDigest({
      gate_id: gate.gate_id,
      kind: gate.kind,
      owner: gate.owner,
      root_run_id: gate.root_run_id,
      work_order_id: gate.work_order_id,
      input_digest: gate.input_digest,
      started_at: gate.started_at,
      finished_at: gate.finished_at,
      result: gate.result,
    }, `gate ${id} result`);
    if (event
        && (event.input_digest !== gate.input_digest
          || event.stage !== gate.kind
          || event.effect_result_digest !== effectResultDigest)) {
      problems.push(`gate ${id} does not match its independent result event`);
    }
  }

  for (const [id, ticket] of actual.repairs) {
    const event = expectedSets.repairs.get(id);
    const body = { ...ticket };
    delete body.digest;
    if (!isCanonicalSha256(ticket.digest) || sha256Json(body) !== ticket.digest) {
      problems.push(`repair authorization ${id} digest mismatch`);
    }
    if (event && event.digest !== ticket.digest) {
      problems.push(`repair authorization ${id} does not match reducer event`);
    }
  }

  for (const [id, resume] of actual.resumes) {
    const event = expectedSets.resumes.get(id);
    const body = { ...resume };
    delete body.digest;
    if (!isCanonicalSha256(resume.digest)
        || observedDigest(body, `resume receipt ${id}`) !== resume.digest) {
      problems.push(`resume receipt ${id} digest mismatch`);
    }
    if (event && event.digest !== resume.digest) {
      problems.push(`resume receipt ${id} does not match reducer event`);
    }
  }

  const dispositionFields = [
    'resource_id',
    'kind',
    'path',
    'root_run_id',
    'work_order_id',
    'disposition',
    'blocks_dispatch',
    'recovery_bundle_digest',
    'terminal_receipt_digest',
    'reason',
  ];
  for (const [id, disposition] of actual.dispositions) {
    const derived = expectedSets.dispositions.get(id);
    if (!derived) continue;
    for (const field of dispositionFields) {
      if ((disposition[field] ?? null) !== (derived[field] ?? null)) {
        problems.push(`resource disposition ${id} ${field} is not mechanically derived`);
      }
    }
  }

  for (const [id, result] of observedEffectResults) {
    const invocation = expectedSets.effect_results.get(id);
    if (!invocation) continue;
    if (result.effect_kind !== invocation.effect_kind
        || result.stage !== invocation.stage
        || result.invocation_identity !== invocation.effect_identity
        || result.invocation_result_identity !== invocation.result_identity) {
      problems.push(`effect result ${id} does not match its invocation`);
    }
  }

  const openDebt = dispositions.filter((d) => isObj(d) && d.blocks_dispatch === true);
  const expected = {
    dispatches: expectedSets.dispatches.size,
    resources: expectedSets.resources.size,
    gates: expectedSets.gates.size,
    repairs: expectedSets.repairs.size,
    dispositions: expectedSets.dispositions.size,
    resumes: expectedSets.resumes.size,
    terminals: expectedSets.terminals.size,
    effect_results: expectedSets.effect_results.size,
  };
  const counted = {
    dispatches: actual.dispatches.size,
    resources: actual.resources.size,
    gates: actual.gates.size,
    repairs: actual.repairs.size,
    dispositions: actual.dispositions.size,
    resumes: actual.resumes.size,
    terminals: actual.terminals.size,
    effect_results: observedEffectResults.size,
  };
  const countsMatch = Object.keys(expected).every((k) => expected[k] === counted[k]);
  const explainsAll = countsMatch && problems.length === 0;
  const blocksTerminal = explainsAll !== true || openDebt.length > 0;
  return {
    root_run_id: rootRunId,
    work_order_id: workOrderId,
    rows,
    explains_all: explainsAll === true,
    expected_counts: expected,
    counted,
    problems,
    blocks_next_dispatch: openDebt.length > 0,
    blocks_terminal: blocksTerminal,
    open_debt: openDebt,
    authority_sources_checked: authoritySourcesChecked,
    digest: canonicalDigest({ rootRunId, workOrderId, rows, expected, counted }),
  };
}

module.exports = {
  CONTROLLER_SCHEMA,
  PROGRESS_RECEIPT_ARTIFACT,
  GATE_JOURNAL_ARTIFACT,
  RESOURCE_DEBT_ARTIFACT,
  REPAIR_TICKET_ARTIFACT,
  ADOPTION_RECEIPT_ARTIFACT,
  POSTCOMPACT_ADAPTER_ARTIFACT,
  RECOVERY_RECEIPT_ARTIFACT,
  RECOVERY_EVIDENCE_KINDS,
  GATE_KINDS,
  REPAIR_BUDGET_AXES,
  RESOURCE_DISPOSITIONS,
  AWAITING_CONVERGENCE,
  AWAITING_DISPOSITION,
  BOUNDARY_REJECTED,
  sha256Json,
  emptyBudgetUsage,
  defaultBudgetLimits,
  buildFrozenDenominator,
  assertFrozenDenominatorStable,
  emptyGateJournal,
  gateInputDigest,
  isCanonicalGitObjectId,
  isCanonicalSha256,
  recordGateEntry,
  findReusableGate,
  checkJointRepairBudget,
  applyBudgetUsage,
  buildProgressReceipt,
  makeDeterministicRepairTicketId,
  appendRepairTicket,
  emptyControllerState,
  controllerStateDigest,
  attachControllerState,
  requireFullDiffBeforeRepair,
  recordFullDiffBarrier,
  classifyBoundaryRejected,
  classifyMissingDisposition,
  classifyResourceOutcome,
  recoveryBundleIdentityDigest,
  buildRecoveryReceipt,
  validateRecoveryBundle,
  buildResourceDebtState,
  admitHighWater,
  adoptOrphanLeaf,
  adoptOrphanLeafMechanical,
  reconstructOwnedInventory,
  admitControllerEffects,
  runPostCompactAdapter,
  admitExecutableMissionDelta,
  buildHistoricalOutputsAtCommit,
  buildNoOpReceipt,
  rebuildTranscriptAudit,
  readPathBytes,
  pathContentDigest,
  bytesEqual,
  checkTempCapacity,
};
