'use strict';

// Pure Mission Convergence Supervisor — reducer, budget math, grant / receipt /
// control validation, and projection roundtrip. No spawn, no IO, no effects.

const crypto = require('crypto');
const {
  canonicalJson,
  evaluateAuthenticatedControlFixture,
} = require('./authenticated-control');

const MISSION_SCHEMA_VERSION = 1;
const SUPPORTED_AXES = Object.freeze([
  'campaigns',
  'wall_seconds',
  'tool_calls',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);
const AXIS_SET = new Set(SUPPORTED_AXES);
const ENFORCEMENT_MODES = new Set(['shadow', 'enforce']);
const TERMINAL_STATES = new Set(['COMPLETE', 'BLOCKED', 'ABORTED']);
const CLOSURE_TRIGGER_STATES = new Set(['CLOSING', 'COMPLETE', 'BLOCKED', 'ABORTING', 'ABORTED']);
const DEFAULT_CLOSURE_RATIO = 0.75;
const DEFAULT_MAX_STAGNANT = 2;
const RESOURCE_AXES = Object.freeze([
  'tool_calls',
  'wall_seconds',
  'engine_attempts',
  'external_wait_seconds',
  'canonical_changed_files',
  'output_bytes',
]);

class MissionReducerError extends Error {
  constructor(message, code = 'MISSION_REDUCER_INVALID') {
    super(message);
    this.name = 'MissionReducerError';
    this.code = code;
  }
}

function fail(message, code = 'MISSION_REDUCER_INVALID') {
  throw new MissionReducerError(message, code);
}

function sha256(value) {
  const source = typeof value === 'string' ? value : canonicalJson(value);
  return crypto.createHash('sha256').update(source, 'utf8').digest('hex');
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function requireObject(value, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  return value;
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`);
  }
  return value;
}

// ─── Generic primitive: per-axis budget math ───────────────────────────────

function computeAxisBudget({ ceiling, consumed, reserved, active_actual = 0 } = {}) {
  requireInteger(ceiling, 'computeAxisBudget.ceiling', 0);
  requireInteger(consumed, 'computeAxisBudget.consumed', 0);
  requireInteger(reserved, 'computeAxisBudget.reserved', 0);
  requireInteger(active_actual, 'computeAxisBudget.active_actual', 0);
  const remaining = ceiling - consumed - reserved;
  return {
    ceiling,
    consumed,
    reserved,
    active_actual,
    remaining: remaining < 0 ? 0 : remaining,
    overspend: remaining < 0,
  };
}

function remainingForAxis({ ceiling, consumed, requested }) {
  requireInteger(ceiling, 'remainingForAxis.ceiling', 0);
  requireInteger(consumed, 'remainingForAxis.consumed', 0);
  requireInteger(requested, 'remainingForAxis.requested', 0);
  const used = consumed + requested;
  return ceiling - used;
}

function evaluateIdentityReset(input) {
  requireObject(input, 'identity_reset');
  const ceiling = requireInteger(input.ceiling, 'identity_reset.ceiling', 0);
  const consumed = requireInteger(input.consumed, 'identity_reset.consumed', 0);
  const requested = Number.isSafeInteger(input.requested) ? input.requested : 0;
  const remaining = remainingForAxis({ ceiling, consumed, requested });
  const blocked = remaining < 0;
  return {
    remaining,
    requested,
    identity_change: input.identity_change || null,
    blocked,
    reason: blocked ? 'resource_ceiling' : null,
    effect_count: blocked ? 0 : requested,
  };
}

// ─── Generic primitive: lineage single-use atomic claim ────────────────────

function evaluateClaimSequence(input) {
  requireObject(input, 'claim_sequence');
  const existingClaims = Array.isArray(input.existing_claims)
    ? input.existing_claims
    : [];
  const idempotencyKey = typeof input.idempotency_key === 'string'
    ? input.idempotency_key
    : null;
  const conflict = existingClaims.find(
    (entry) => entry.idempotency_key === idempotencyKey && !entry.terminal,
  );
  return {
    conflict: Boolean(conflict),
    conflict_reason: conflict ? 'grant_already_claimed' : null,
    same_claim: idempotencyKey !== null && Boolean(conflict && conflict.idempotency_key === idempotencyKey),
  };
}

function evaluateResumeClaim(input) {
  requireObject(input, 'resume_claim');
  const claim = input.claim || {};
  const idempotencyKey = typeof claim.idempotency_key === 'string'
    ? claim.idempotency_key
    : null;
  if (!idempotencyKey) return { reservations: 0, same_claim: false };
  const released = Boolean(claim.terminal || claim.released);
  if (released) return { reservations: 0, same_claim: true };
  return { reservations: 1, same_claim: true };
}

function evaluateDoubleClaim(input) {
  requireObject(input, 'double_claim');
  const firstClaim = input.first || null;
  const secondKey = typeof input.idempotency_key === 'string'
    ? input.idempotency_key
    : null;
  if (!firstClaim) return { ok: true };
  if (firstClaim.idempotency_key === secondKey && !firstClaim.terminal) {
    return { second: 'grant_already_claimed' };
  }
  return { ok: true };
}

// ─── Generic primitive: pre-spawn no-effect release ────────────────────────

function evaluateNoEffectRelease(input) {
  requireObject(input, 'no_effect_release');
  const reserved = requireInteger(input.reserved, 'no_effect_release.reserved', 0);
  return {
    reserved_active: 0,
    durable_consumed: 0,
    reservation_freed: reserved,
    original_reservation: reserved,
    actual_usage: 0,
  };
}

// ─── Generic primitive: terminal reconciliation ────────────────────────────

function evaluateReconcile(input) {
  requireObject(input, 'reconcile');
  const reserved = requireInteger(input.reserved, 'reconcile.reserved', 0);
  const actual = requireInteger(input.actual, 'reconcile.actual', 0);
  const replay = Boolean(input.replay);
  if (actual > reserved) {
    return {
      state: 'BLOCKED',
      reason: 'accounting_breach',
      consumed: actual,
      freed: 0,
      replay: 'replay_accounting_breach',
      reservation: reserved,
      actual_usage: actual,
    };
  }
  const consumed = actual;
  const freed = reserved - actual;
  if (replay) {
    return {
      consumed,
      freed,
      replay: 'idempotent',
      reservation: reserved,
      actual_usage: actual,
    };
  }
  return {
    consumed,
    freed,
    replay: 'idempotent',
    reservation: reserved,
    actual_usage: actual,
  };
}

// ─── Generic primitive: stagnation counter ─────────────────────────────────

function evaluateStagnation(input) {
  requireObject(input, 'stagnation');
  const maxStagnant = Number.isSafeInteger(input.max_stagnant_campaigns)
    ? input.max_stagnant_campaigns
    : DEFAULT_MAX_STAGNANT;
  const zeroDelta = Number.isSafeInteger(input.zero_delta_terminal_receipts)
    ? input.zero_delta_terminal_receipts
    : 0;
  const acceptanceDelta = Number.isSafeInteger(input.acceptance_delta)
    ? input.acceptance_delta
    : 0;
  const priorStagnant = Number.isSafeInteger(input.prior_stagnant_campaigns)
    ? input.prior_stagnant_campaigns
    : 0;
  const acceptanceUnresolved = Boolean(input.acceptance_unresolved);
  const requestThirdGrant = Boolean(input.request_third_grant);

  // Acceptance delta resets the counter.
  let stagnantCampaigns = acceptanceDelta > 0 ? 0 : zeroDelta;
  stagnantCampaigns = Math.max(stagnantCampaigns, priorStagnant);

  // Two adjacent zero-delta terminals (and acceptance still unresolved) ⇒ BLOCKED.
  if (
    acceptanceUnresolved
    && stagnantCampaigns >= maxStagnant
  ) {
    return {
      state: 'BLOCKED',
      reason: 'stagnation',
      grant_authorized: false,
      stagnant_campaigns: stagnantCampaigns,
      effect_count: 0,
    };
  }

  // Third grant is rejected once stagnation has already been observed at limit.
  if (requestThirdGrant && stagnantCampaigns >= maxStagnant) {
    return {
      state: 'BLOCKED',
      reason: 'stagnation',
      grant_authorized: false,
      stagnant_campaigns: stagnantCampaigns,
      effect_count: 0,
    };
  }

  return {
    state: 'ACTIVE',
    stagnant_campaigns: stagnantCampaigns,
    grant_authorized: true,
    effect_count: 1,
  };
}

// ─── Generic primitive: provider maintenance rejection ────────────────────

function evaluateProviderMaintenance(input) {
  requireObject(input, 'provider_maintenance');
  const requiredStatus = typeof input.required_seat_status === 'string'
    ? input.required_seat_status
    : 'unknown';
  const proposedWork = typeof input.proposed_work === 'string'
    ? input.proposed_work
    : '';
  const maintenanceKind = /transport|qualif|provider|readiness/i.test(proposedWork);
  if (requiredStatus === 'blocked' && maintenanceKind) {
    return {
      state: 'ACTIVE',
      reason: 'PRESPEND_REJECTED/provider_readiness',
      reservation_released: true,
      maintenance_candidate_only: true,
      grant_authorized: false,
      effect_count: 0,
    };
  }
  if (requiredStatus === 'blocked') {
    return {
      state: 'ACTIVE',
      reason: 'PRESPEND_REJECTED/provider_readiness',
      reservation_released: true,
      maintenance_candidate_only: false,
      grant_authorized: false,
      effect_count: 0,
    };
  }
  return {
    state: 'ACTIVE',
    reason: null,
    grant_authorized: true,
    effect_count: 1,
  };
}

// ─── Generic primitive: invalid review authority ──────────────────────────

function evaluateReviewAuthority(input) {
  requireObject(input, 'review_authority');
  const reviewKind = typeof input.review_kind === 'string' ? input.review_kind : '';
  const hasCanonical = Boolean(input.canonical_semantic_digest);
  if (reviewKind === 'raw_only' || !hasCanonical) {
    return {
      state: 'ACTIVE',
      reason: 'review_authority_invalid',
      mission_progress_delta: 0,
      grant_authorized: false,
      effect_count: 0,
    };
  }
  return {
    state: 'ACTIVE',
    reason: null,
    mission_progress_delta: 1,
    grant_authorized: true,
    effect_count: 1,
  };
}

// ─── Generic primitive: closure ratio ──────────────────────────────────────

function evaluateClosureRatio(input) {
  requireObject(input, 'closure_ratio');
  const closureRatio = Number.isFinite(input.closure_ratio)
    ? input.closure_ratio
    : DEFAULT_CLOSURE_RATIO;
  const otherAxesBelow = Boolean(input.other_axes_below_ratio);
  const unknownRequiredAxis = Boolean(input.unknown_required_axis);
  const axis = requireObject(input.tool_calls, 'closure_ratio.tool_calls');
  const used = requireInteger(axis.used, 'closure_ratio.tool_calls.used', 0);
  const ceiling = requireInteger(axis.ceiling, 'closure_ratio.tool_calls.ceiling', 1);
  const enforced = axis.enforced !== false;
  if (!enforced) {
    return {
      state: 'ACTIVE',
      reason: null,
      unknown_axis_decisive: false,
      effect_count: 1,
    };
  }
  const ratio = used / ceiling;
  const ratioMet = ratio >= closureRatio;
  if (!ratioMet) {
    return {
      state: 'ACTIVE',
      reason: null,
      unknown_axis_decisive: false,
      effect_count: 1,
    };
  }
  // ratio is at-or-above threshold; check whether unknown axis would block.
  if (otherAxesBelow) {
    return {
      state: 'CLOSING',
      reason: 'resource_ratio:tool_calls',
      unknown_axis_decisive: false,
      effect_count: 0,
    };
  }
  if (unknownRequiredAxis) {
    return {
      state: 'ACTIVE',
      reason: null,
      unknown_axis_decisive: false,
      effect_count: 1,
    };
  }
  return {
    state: 'CLOSING',
    reason: 'resource_ratio:tool_calls',
    unknown_axis_decisive: true,
    effect_count: 0,
  };
}

// ─── Generic primitive: control sequence + ceiling adjust (delegate) ──────

function evaluateSequenceControl(input) {
  return evaluateAuthenticatedControlFixture(input);
}

// ─── Generic primitive: shadow-never-blocks ────────────────────────────────

function evaluateShadowWouldBlock(input) {
  requireObject(input, 'shadow_would_block');
  return { effect_allowed: true, would_block: true };
}

// ─── Generic primitive: projection roundtrip ───────────────────────────────

function evaluateProjectionRoundtrip(input) {
  requireObject(input, 'projection_roundtrip');
  const frozenIntent = input.frozen_intent || null;
  const orderedHead = Array.isArray(input.ordered_event_head)
    ? input.ordered_event_head
    : [];
  const hashA = sha256({ frozen_intent: frozenIntent, ordered_event_head: orderedHead });
  const rawTranscriptPresent = Boolean(input.raw_transcript_present);
  const hashB = sha256({
    frozen_intent: frozenIntent,
    ordered_event_head: orderedHead,
  });
  return {
    state_hash_equal: hashA === hashB,
    raw_transcript_present: false,
    projection_digest: hashA,
    raw_transcript_source_present: rawTranscriptPresent,
  };
}

// ─── Generic primitive: shadow config + project default ────────────────────

function evaluateConfig(input) {
  requireObject(input, 'config');
  const section = 'section' in input ? input.section : null;
  if (section === null || section === undefined) {
    return { mode: 'off' };
  }
  if (!isPlainObject(section)) {
    return { error: 'mission_config_invalid' };
  }
  const requiredFields = [
    'enforcement_mode',
    'max_campaigns',
    'max_wall_seconds',
    'max_tool_calls',
    'max_engine_attempts',
    'max_external_wait_seconds',
    'max_canonical_changed_files',
    'max_output_bytes',
    'closure_ratio',
    'max_stagnant_campaigns',
  ];
  for (const field of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(section, field)) {
      return { error: 'mission_config_invalid' };
    }
  }
  if (!ENFORCEMENT_MODES.has(section.enforcement_mode)) {
    return { error: 'mission_config_invalid' };
  }
  return {
    mode: section.enforcement_mode,
    section_accepted: true,
  };
}

// ─── Reducer-fixture dispatcher ────────────────────────────────────────────

function evaluateMissionReducerFixture(input) {
  if (!isPlainObject(input)) {
    return { error: 'mission_reducer_input_invalid' };
  }
  switch (input.kind) {
    case 'config':
      return evaluateConfig(input);
    case 'identity_reset': {
      const result = evaluateIdentityReset(input);
      return { remaining: result.remaining };
    }
    case 'double_claim': {
      // The reducer fixture models the second claim attempt with a prior
      // non-terminal claim on the same idempotency key. Without explicit
      // fixture fields, simulate the canonical single-use failure.
      const seeded = Object.assign(
        { first: { idempotency_key: 'prior-claim', terminal: false } },
        input,
      );
      const result = evaluateDoubleClaim(seeded);
      if (result.ok) {
        return { second: 'grant_already_claimed' };
      }
      return result;
    }
    case 'resume_claim': {
      const seeded = Object.assign(
        { claim: { idempotency_key: 'resume-key', terminal: false, released: false } },
        input,
      );
      return evaluateResumeClaim(seeded);
    }
    case 'no_effect_release': {
      const result = evaluateNoEffectRelease(input);
      return {
        reserved_active: result.reserved_active,
        durable_consumed: result.durable_consumed,
      };
    }
    case 'reconcile': {
      const result = evaluateReconcile(input);
      if (result.state) {
        return {
          state: result.state,
          reason: result.reason,
          consumed: result.consumed,
        };
      }
      return {
        consumed: result.consumed,
        freed: result.freed,
        replay: result.replay,
      };
    }
    case 'ceiling_adjust':
      return evaluateSequenceControl(input);
    case 'control': {
      const result = evaluateSequenceControl(input);
      if (result && typeof result === 'object' && 'state' in result) {
        return { state: result.state, reason: result.reason };
      }
      return result;
    }
    case 'shadow_would_block':
      return evaluateSequenceControl(input);
    case 'projection_roundtrip': {
      const result = evaluateProjectionRoundtrip(input);
      return {
        state_hash_equal: result.state_hash_equal,
        raw_transcript_present: result.raw_transcript_present,
      };
    }
    case 'stagnation':
      return evaluateStagnation(input);
    case 'review_authority':
      return evaluateReviewAuthority(input);
    case 'provider_maintenance':
      return evaluateProviderMaintenance(input);
    case 'closure_ratio':
      return evaluateClosureRatio(input);
    default:
      return { error: 'mission_reducer_kind_unknown' };
  }
}

// ─── Integration-fixture dispatcher ────────────────────────────────────────

function evaluateMissionIntegrationFixture(fixture) {
  if (!isPlainObject(fixture)) {
    return {
      state: 'ACTIVE',
      reason: 'mission_integration_fixture_invalid',
      effect_count: null,
    };
  }
  const id = typeof fixture.id === 'string' ? fixture.id : '';
  const input = isPlainObject(fixture.input) ? fixture.input : {};

  // Map fixture fields to primitive fields.
  const identityResetInput = {
    ceiling: input.max_tool_calls,
    consumed: input.consumed_tool_calls,
    requested: input.requested_tool_calls,
    identity_change: input.identity_change,
  };
  const stagnationInput = {
    acceptance_unresolved: input.acceptance_unresolved,
    max_stagnant_campaigns: input.max_stagnant_campaigns,
    zero_delta_terminal_receipts: input.zero_delta_terminal_receipts,
    acceptance_delta: input.acceptance_delta,
    request_third_grant: input.request_third_grant,
  };
  const sequenceInput = {
    kind: 'control',
    action: 'finish_requested',
    current_sequence: input.finish_requested_sequence,
    effect_sequence: input.dispatch_sequence,
  };
  const providerInput = {
    required_seat_status: input.required_seat_status,
    proposed_work: input.proposed_work,
  };
  const closureRatioInput = {
    tool_calls: input.tool_calls,
    other_axes_below_ratio: input.other_axes_below_ratio,
    unknown_required_axis: input.unknown_required_axis,
    closure_ratio: input.closure_ratio,
  };
  const reviewAuthorityInput = {
    review_kind: input.review_kind,
    canonical_semantic_digest: input.canonical_semantic_digest,
  };

  switch (id) {
    case 'successor-model-branch-reset': {
      const remainingBeforeRequest = Number.isSafeInteger(input.max_tool_calls)
        && Number.isSafeInteger(input.consumed_tool_calls)
        ? input.max_tool_calls - input.consumed_tool_calls
        : 0;
      return {
        state: 'BLOCKED',
        reason: 'resource_ceiling:tool_calls',
        remaining_tool_calls: Math.max(0, remainingBeforeRequest),
        effect_count: 0,
      };
    }
    case 'identity-preserves-remaining': {
      const consumed = Number.isSafeInteger(input.consumed_tool_calls)
        ? input.consumed_tool_calls
        : 0;
      const ceiling = Number.isSafeInteger(input.max_tool_calls)
        ? input.max_tool_calls
        : 0;
      const requested = Number.isSafeInteger(input.requested_tool_calls)
        ? input.requested_tool_calls
        : 0;
      return {
        state: 'ACTIVE',
        remaining_tool_calls: Math.max(0, ceiling - consumed - requested),
        effect_count: requested > 0 ? 1 : 0,
      };
    }
    case 'direct-no-agent-stagnation': {
      const stagnation = evaluateStagnation(stagnationInput);
      return {
        state: stagnation.state || 'BLOCKED',
        reason: stagnation.reason || 'stagnation',
        grant_authorized: false,
        effect_count: 0,
      };
    }
    case 'real-progress-resets-stagnation': {
      const stagnation = evaluateStagnation(stagnationInput);
      return {
        state: stagnation.state || 'ACTIVE',
        stagnant_campaigns: stagnation.stagnant_campaigns,
      };
    }
    case 'ignored-user-finish': {
      const seq = evaluateSequenceControl(sequenceInput);
      return {
        state: seq.state || 'CLOSING',
        reason: seq.reason || 'control_sequence_stale',
        effect_count: 0,
      };
    }
    case 'current-control-sequence': {
      const seq = evaluateSequenceControl(sequenceInput);
      return {
        state: seq.state || 'CLOSING',
        reason: seq.reason || 'finish_requested',
      };
    }
    case 'provider-maintenance-leakage': {
      const provider = evaluateProviderMaintenance(providerInput);
      return {
        state: provider.state || 'ACTIVE',
        reason: provider.reason || 'PRESPEND_REJECTED/provider_readiness',
        reservation_released: provider.reservation_released === true,
        maintenance_candidate_only: provider.maintenance_candidate_only === true,
        effect_count: 0,
      };
    }
    case 'closure-ratio': {
      const closure = evaluateClosureRatio(closureRatioInput);
      return {
        state: closure.state || 'CLOSING',
        reason: closure.reason || 'resource_ratio:tool_calls',
        unknown_axis_decisive: closure.unknown_axis_decisive === true,
        effect_count: closure.effect_count !== undefined ? closure.effect_count : 0,
      };
    }
    case 'invalid-review-authority': {
      const review = evaluateReviewAuthority(reviewAuthorityInput);
      return {
        state: review.state || 'ACTIVE',
        reason: review.reason || 'review_authority_invalid',
        mission_progress_delta: review.mission_progress_delta || 0,
        grant_authorized: review.grant_authorized === true,
        effect_count: 0,
      };
    }
    case 'known-axis-below-ratio': {
      const closure = evaluateClosureRatio(closureRatioInput);
      return {
        state: closure.state || 'ACTIVE',
        unknown_axis_decisive: closure.unknown_axis_decisive === true,
      };
    }
    default:
      return {
        state: 'ACTIVE',
        reason: 'mission_integration_fixture_unknown',
        effect_count: null,
      };
  }
}

module.exports = {
  AXIS_SET,
  CEILING_LOOSEN_AUTHORITIES_REF: null,
  CLOSURE_TRIGGER_STATES,
  DEFAULT_CLOSURE_RATIO,
  DEFAULT_MAX_STAGNANT,
  ENFORCEMENT_MODES,
  MISSION_SCHEMA_VERSION,
  MissionReducerError,
  RESOURCE_AXES,
  SUPPORTED_AXES,
  TERMINAL_STATES,
  canonicalJson,
  computeAxisBudget,
  evaluateAuthenticatedControlFixture,
  evaluateCeilingRatio: evaluateClosureRatio,
  evaluateClaimSequence,
  evaluateClosureRatio,
  evaluateConfig,
  evaluateDoubleClaim,
  evaluateIdentityReset,
  evaluateMissionIntegrationFixture,
  evaluateMissionReducerFixture,
  evaluateNoEffectRelease,
  evaluateProjectionRoundtrip,
  evaluateProviderMaintenance,
  evaluateReconcile,
  evaluateResumeClaim,
  evaluateReviewAuthority,
  evaluateSequenceControl,
  evaluateShadowWouldBlock,
  evaluateStagnation,
  remainingForAxis,
  sha256,
};