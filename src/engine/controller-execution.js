'use strict';

/**
 * Controller Execution Discipline — project-level controller authority helpers.
 * Extends schema-2 Work Order / campaign / Mission rails without a parallel tracker.
 * Optional controller fields live outside workOrderCanonicalBody so schema-2 digests
 * remain valid; integrity is bound by controller_digest when present.
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

function checkJointRepairBudget(usage, limits, { beforeSpend = true } = {}) {
  const u = { ...emptyBudgetUsage(), ...(usage || {}) };
  const lim = defaultBudgetLimits(limits || {});
  const exceeded = [];
  for (const axis of REPAIR_BUDGET_AXES) {
    if (axis === 'fresh_input_tokens') {
      if (u.fresh_input_tokens == null) {
        // unobserved: never treat as zero; only enforce when both observed and limited
        continue;
      }
      if (lim.fresh_input_tokens != null && u.fresh_input_tokens > lim.fresh_input_tokens) {
        exceeded.push(axis);
      }
      continue;
    }
    const used = Number(u[axis] || 0);
    const limit = lim[axis];
    if (Number.isSafeInteger(limit) && used > limit) exceeded.push(axis);
  }
  if (exceeded.length === 0) {
    return {
      ok: true,
      status: 'within_budget',
      exceeded: [],
      usage: u,
      limits: lim,
      allow_spend: true,
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
    reason: `joint repair budget exceeded on ${exceeded.join(',')}; stop before ${beforeSpend ? 'model/checkout' : 'further'} spend`,
  };
}

function applyBudgetUsage(usage, delta = {}) {
  const next = { ...emptyBudgetUsage(), ...(usage || {}) };
  if (Number.isSafeInteger(delta.model_calls)) next.model_calls += delta.model_calls;
  if (Number.isSafeInteger(delta.fresh_input_bytes)) next.fresh_input_bytes += delta.fresh_input_bytes;
  if (delta.fresh_input_tokens === null || delta.fresh_input_tokens === undefined) {
    // leave unobserved
  } else if (Number.isSafeInteger(delta.fresh_input_tokens)) {
    next.fresh_input_tokens = (next.fresh_input_tokens == null ? 0 : next.fresh_input_tokens)
      + delta.fresh_input_tokens;
    next.unobserved_axes = (next.unobserved_axes || []).filter((a) => a !== 'fresh_input_tokens');
    if (!next.observable_axes.includes('fresh_input_tokens')) {
      next.observable_axes = [...next.observable_axes, 'fresh_input_tokens'];
    }
  }
  if (Number.isSafeInteger(delta.elapsed_wall_ms)) next.elapsed_wall_ms += delta.elapsed_wall_ms;
  if (Number.isSafeInteger(delta.owned_worktrees)) next.owned_worktrees += delta.owned_worktrees;
  if (Number.isSafeInteger(delta.finding_recurrence)) {
    next.finding_recurrence += delta.finding_recurrence;
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

function appendRepairTicket(workOrderController, ticket) {
  const ctrl = isObj(workOrderController)
    ? JSON.parse(JSON.stringify(workOrderController))
    : emptyControllerState();
  if (!Array.isArray(ctrl.repair_tickets)) ctrl.repair_tickets = [];
  if (!isStr(ticket && ticket.ticket_id)) fail('INVALID_REPAIR_TICKET', 'ticket_id required');
  if (ctrl.repair_tickets.some((t) => t.ticket_id === ticket.ticket_id)) {
    fail('DUPLICATE_REPAIR_TICKET', `repair ticket ${ticket.ticket_id} already exists`);
  }
  // Successor identity is forbidden — ticket appends to same work order only.
  if (ticket.successor_work_order_id) {
    fail('SUCCESSOR_IDENTITY_FORBIDDEN', 'repair must not create a successor work-order identity');
  }
  const entry = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: REPAIR_TICKET_ARTIFACT,
    ticket_id: ticket.ticket_id,
    generation: ticket.generation,
    finding_ids: Array.isArray(ticket.finding_ids) ? [...ticket.finding_ids].sort() : [],
    reuse_lineage: ticket.reuse_lineage !== false,
    non_reuse_receipt: ticket.non_reuse_receipt || null,
    authorized_at: ticket.authorized_at || nowIso(),
    resource_lineage: ticket.resource_lineage || null,
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
  };
  state.controller_digest = controllerStateDigest(state);
  return state;
}

function controllerStateDigest(state) {
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
  const known = resource.identity_known !== false;
  const terminal = resource.terminal === true;
  const active = resource.active === true;
  const clean = resource.clean === true || (!dirty && known && !unique);

  if (active) {
    return { disposition: 'active', release: false, blocks_dispatch: false };
  }
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

function buildResourceDebtState(inventory = []) {
  const open = [];
  const released = [];
  for (const item of inventory) {
    const cls = classifyResourceOutcome(item);
    const row = {
      resource_id: item.resource_id || item.worktree || item.branch || sha256Json(item).slice(0, 16),
      kind: item.kind || 'worktree',
      path: item.path || item.worktree || null,
      disposition: cls.disposition,
      blocks_dispatch: cls.blocks_dispatch,
      recovery_bundle_digest: item.recovery_bundle_digest || null,
      reason: cls.reason || null,
    };
    if (cls.release && isStr(row.recovery_bundle_digest)) {
      released.push(row);
    } else if (cls.blocks_dispatch || !cls.release) {
      open.push(row);
    } else {
      // clean release still requires a verifiable recovery bundle
      open.push({
        ...row,
        disposition: 'disposition_blocked',
        blocks_dispatch: true,
        reason: 'release requires verifiable recovery bundle/receipt',
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
  if (Number(currentOwned) >= Number(highWater)) {
    return {
      ok: false,
      allow_checkout: false,
      allow_runner: false,
      effects: 0,
      reason: `owned worktree high-water ${highWater} reached (${currentOwned})`,
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

function adoptOrphanLeaf({
  controllerDead,
  leafResult,
  branchTip,
  branchTree,
  baseAncestryOk,
  scopeOk,
  churnOk,
  worktreeDigest,
  generation,
  alreadyAdopted = false,
}) {
  if (alreadyAdopted) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'orphan leaf already adopted once for this generation',
      code: 'ADOPTION_ALREADY_CONSUMED',
      duplicate_mutation: 0,
    };
  }
  if (controllerDead !== true) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'controller death not proven; refuse adoption',
      code: 'CONTROLLER_NOT_PROVEN_DEAD',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  if (!isObj(leafResult) || leafResult.committed !== true) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'leaf result not a committed implementation/repair outcome',
      code: 'LEAF_RESULT_AMBIGUOUS',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  const leafCommit = isStr(leafResult.commit)
    ? leafResult.commit
    : (isStr(leafResult.candidate_ref) ? leafResult.candidate_ref : null);
  if (!isCanonicalGitObjectId(leafCommit)
      || !isCanonicalGitObjectId(branchTip)
      || !isCanonicalGitObjectId(branchTree)
      || !isCanonicalSha256(worktreeDigest)) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'orphan adoption requires canonical full git object IDs and sha256 worktree digest',
      code: 'ADOPTION_BINDING_INCOMPLETE',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  // Leaf result tip must bind exactly to the branch tip — placeholders/mismatches stop.
  if (leafCommit !== branchTip) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'leaf result commit does not bind to branch tip',
      code: 'ADOPTION_LEAF_TIP_MISMATCH',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  if (baseAncestryOk !== true || scopeOk !== true || churnOk !== true) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'base ancestry, scope, or churn binding failed',
      code: 'ADOPTION_BINDING_FAILED',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    return {
      ok: false,
      status: 'stopped',
      reason: 'generation binding required',
      code: 'ADOPTION_GENERATION_INVALID',
      preserve_evidence: true,
      duplicate_mutation: 0,
    };
  }
  const receipt = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: ADOPTION_RECEIPT_ARTIFACT,
    branch_tip: branchTip,
    branch_tree: branchTree,
    worktree_digest: worktreeDigest,
    generation,
    leaf_commit: leafCommit,
    adopted_at: nowIso(),
    duplicate_mutation: 0,
  };
  receipt.digest = sha256Json(receipt);
  return {
    ok: true,
    status: 'adopted',
    receipt,
    advance_campaign: true,
    duplicate_mutation: 0,
    generation,
  };
}

function runPostCompactAdapter(input = {}) {
  // Host-neutral recovery gate. Does not write production Codex manifests or
  // overwrite user-owned hook-probe files.
  const {
    reconcileFn,
    rootRunId,
    gitCwd,
    durable = null,
    resourceInventory = [],
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
  const reconcile = reconcileFn({
    gitCwd,
    root_run_id: rootRunId,
    durable,
    requireBoundEvidence: true,
  });
  const debt = buildResourceDebtState(resourceInventory);
  const body = {
    schema_version: CONTROLLER_SCHEMA,
    artifact_type: POSTCOMPACT_ADAPTER_ARTIFACT,
    root_run_id: rootRunId,
    reconcile_status: reconcile && reconcile.status,
    reconcile_reason_code: reconcile && reconcile.reason_code || null,
    resource_debt_blocks: debt.blocks_dispatch,
    resource_debt_digest: debt.digest,
    production_hook_wired: false,
    probe_evidence_accepted: probeEvidenceAccepted === true,
    hook_probe_files_touched: false,
    issued_at: nowIso(),
  };
  body.digest = sha256Json(body);
  const blocked = (reconcile && reconcile.status !== 'reconciled') || debt.blocks_dispatch;
  return {
    status: blocked ? 'reject' : 'ready',
    reason_code: blocked
      ? (debt.blocks_dispatch ? 'resource_debt_open' : (reconcile.reason_code || 'reconcile_failed'))
      : null,
    reason: blocked
      ? (debt.blocks_dispatch
        ? 'resource debt blocks managed dispatch after compaction'
        : (reconcile.reason || 'reconcile failed'))
      : 'PostCompact recovery gate ready',
    receipt: body,
    reconcile,
    resource_debt: debt,
    production_hook_wired: false,
    duplicate_dispatch: 0,
  };
}

/**
 * Mission executable-delta admission (pre-spend).
 * Separates allowed-to-change, required-to-change, and authorized creates.
 */
function readPathBytes(repoRoot, relativePath) {
  if (!isStr(repoRoot) || !isStr(relativePath)) return null;
  const abs = path.join(repoRoot, relativePath);
  try {
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return fs.readFileSync(abs, 'utf8');
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
    // Closure: every listed mirror path must appear in outputs or required.
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

  // Historical-output replay: same bytes as a prior terminal receipt without new work.
  if (isObj(historicalOutputs) && isObj(currentBytesByPath) && !noOpReceipt) {
    const histKeys = Object.keys(historicalOutputs).sort();
    const same = histKeys.length > 0 && histKeys.every((k) => (
      currentBytesByPath[k] === historicalOutputs[k]
    ));
    if (same && histKeys.some((k) => outputs.includes(k) || required.includes(k))) {
      reasons.push({
        code: 'HISTORICAL_OUTPUT_REPLAY',
        reason: 'historical output bytes would be replayed without bound no-op adoption',
      });
    }
  }

  // Digest-bound no-op adoption: no mutation/gate attempt when preconditions hold.
  // Requires canonical base SHA, acceptance digest, and exact current bytes for
  // every required/output path — never invent zero/empty evidence.
  if (isObj(noOpReceipt)) {
    const relevantPaths = [...new Set([...required, ...outputs])].sort();
    const receiptBytes = noOpReceipt.current_bytes;
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
    if (!isObj(receiptBytes)) {
      reasons.push({
        code: 'NOOP_BINDING_INCOMPLETE',
        reason: 'no-op current_bytes must be an object of path→string bindings',
      });
      noopOk = false;
    } else {
      const receiptKeys = Object.keys(receiptBytes).sort();
      // Exact key set: no missing, no extra.
      if (JSON.stringify(receiptKeys) !== JSON.stringify(relevantPaths)) {
        reasons.push({
          code: 'NOOP_BYTES_MISMATCH',
          reason: 'no-op current_bytes keys must exactly equal required+output paths',
        });
        noopOk = false;
      }
      for (const p of receiptKeys) {
        if (typeof receiptBytes[p] !== 'string') {
          reasons.push({
            code: 'NOOP_BYTES_MISMATCH',
            path: p,
            reason: 'no-op current_bytes values must be strings (absent evidence is not zero)',
          });
          noopOk = false;
          continue;
        }
        if (isObj(currentBytesByPath)) {
          if (!Object.prototype.hasOwnProperty.call(currentBytesByPath, p)
              || currentBytesByPath[p] !== receiptBytes[p]) {
            reasons.push({
              code: 'NOOP_BYTES_MISMATCH',
              path: p,
              reason: 'no-op current_bytes disagree with supplied currentBytesByPath',
            });
            noopOk = false;
          }
        }
        if (isStr(repoRoot)) {
          const live = readPathBytes(repoRoot, p);
          if (live === null || live !== receiptBytes[p]) {
            reasons.push({
              code: 'NOOP_BYTES_MISMATCH',
              path: p,
              reason: 'no-op current_bytes disagree with mechanical repository bytes',
            });
            noopOk = false;
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

function rebuildTranscriptAudit({ rootRunId, workOrderId, auditEvents = [], dispatches = [], resources = [], gates = [], repairs = [], dispositions = [] }) {
  if (!isStr(rootRunId) || !isStr(workOrderId)) {
    fail('AUDIT_IDS_REQUIRED', 'root_run_id and work_order_id required for transcript audit');
  }
  const rows = [];
  for (const d of dispatches) {
    rows.push({
      kind: 'dispatch',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...d,
    });
  }
  for (const r of resources) {
    rows.push({
      kind: 'resource_creator',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...r,
    });
  }
  for (const g of gates) {
    rows.push({
      kind: 'gate_return',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...g,
    });
  }
  for (const t of repairs) {
    rows.push({
      kind: 'repair_authorization',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...t,
    });
  }
  for (const d of dispositions) {
    rows.push({
      kind: 'disposition',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...d,
    });
  }
  for (const e of auditEvents) {
    rows.push({
      kind: 'audit_event',
      root_run_id: rootRunId,
      work_order_id: workOrderId,
      ...e,
    });
  }
  const openDebt = dispositions.filter((d) => d.blocks_dispatch === true);
  return {
    root_run_id: rootRunId,
    work_order_id: workOrderId,
    rows,
    explains_all: rows.length > 0,
    blocks_next_dispatch: openDebt.length > 0,
    open_debt: openDebt,
    digest: sha256Json({ rootRunId, workOrderId, rows }),
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
  appendRepairTicket,
  emptyControllerState,
  controllerStateDigest,
  attachControllerState,
  requireFullDiffBeforeRepair,
  recordFullDiffBarrier,
  classifyBoundaryRejected,
  classifyMissingDisposition,
  classifyResourceOutcome,
  buildResourceDebtState,
  admitHighWater,
  adoptOrphanLeaf,
  runPostCompactAdapter,
  admitExecutableMissionDelta,
  rebuildTranscriptAudit,
};
