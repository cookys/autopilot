'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelError } = require('./errors');

function stateError(message) {
  throw new OwnerKernelError(message, 'INVALID_OWNER_EVENT_STATE');
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    stateError(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNullableString(value, label) {
  if (value !== null) assertString(value, label);
  return value;
}

function assertHash(value, label) {
  if (!isSha256(value)) stateError(`${label} must be a SHA-256 digest`);
  return value;
}

function assertInteger(value, label, minimum = 1) {
  if (!Number.isInteger(value) || value < minimum) stateError(`${label} must be an integer >= ${minimum}`);
  return value;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) stateError(`${label} must be an object`);
  return value;
}

function assertOnlyKeys(value, keys, label) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) stateError(`${label} has unsupported key "${key}"`);
  }
}

function assertArrayOfHashes(value, label) {
  if (!Array.isArray(value)) stateError(`${label} must be an array`);
  const seen = new Set();
  return value.map((item, index) => {
    assertHash(item, `${label}[${index}]`);
    const lower = item.toLowerCase();
    if (seen.has(lower)) stateError(`${label} has duplicate hash`);
    seen.add(lower);
    return lower;
  });
}

function makeInitialState(header) {
  return {
    schema_version: 1,
    run_id: header.run_id,
    policy_hash: header.policy_hash,
    contract_hash: header.contract_hash,
    witness_stream_id: header.witness_stream_id,
    capability_nonce_commitment: header.capability_nonce_commitment,
    sequence: 0,
    event_head: null,
    witness_head: null,
    status: 'intake',
    terminal_reason: null,
    current_intent_id: null,
    intents: {},
    decisions: {},
    approvals: {},
    active_principal: null,
    blocked_since: null,
    block_reasons: [],
    last_checkpoint: null,
  };
}

function stateProjection(state) {
  return cloneCanonical({
    schema_version: state.schema_version,
    run_id: state.run_id,
    policy_hash: state.policy_hash,
    contract_hash: state.contract_hash,
    witness_stream_id: state.witness_stream_id,
    capability_nonce_commitment: state.capability_nonce_commitment,
    sequence: state.sequence,
    event_head: state.event_head,
    witness_head: state.witness_head,
    status: state.status,
    terminal_reason: state.terminal_reason,
    current_intent_id: state.current_intent_id,
    intents: state.intents,
    decisions: state.decisions,
    approvals: state.approvals,
    active_principal: state.active_principal,
    blocked_since: state.blocked_since,
    block_reasons: state.block_reasons,
    last_checkpoint: state.last_checkpoint,
  });
}

function cloneState(state) {
  return cloneCanonical(stateProjection(state));
}

function ownerRosterEntry(policy, identity) {
  return policy.owner_roster.find((entry) => entry.identity === identity) || null;
}

function approvalReason(decisionId) {
  return `approval:${decisionId}`;
}

function addBlockReason(state, reason, timestamp) {
  if (!state.block_reasons.includes(reason)) state.block_reasons.push(reason);
  if (state.status !== 'complete') {
    state.status = 'blocked';
    if (!state.blocked_since) state.blocked_since = timestamp;
  }
}

function clearBlockReason(state, reason) {
  state.block_reasons = state.block_reasons.filter((item) => item !== reason);
  if (state.status !== 'complete' && state.block_reasons.length === 0) {
    state.blocked_since = null;
    state.status = state.active_principal ? 'decide' : 'intake';
  }
}

function validateIntentPayload(payload, state) {
  assertObject(payload, 'intent payload');
  assertOnlyKeys(payload, new Set([
    'intent_id',
    'text',
    'envelope_hash',
    'explicit_action_hashes',
    'supersedes_intent_id',
  ]), 'intent payload');
  const intentId = assertString(payload.intent_id, 'intent payload.intent_id');
  if (state.intents[intentId]) stateError(`intent "${intentId}" already exists`);
  assertString(payload.text, 'intent payload.text');
  assertHash(payload.envelope_hash, 'intent payload.envelope_hash');
  const explicitActionHashes = assertArrayOfHashes(payload.explicit_action_hashes, 'intent payload.explicit_action_hashes');
  const expectedSupersedes = state.current_intent_id;
  if (payload.supersedes_intent_id !== expectedSupersedes) {
    stateError('intent payload.supersedes_intent_id must match current intent');
  }
  return {
    intent_id: intentId,
    text: payload.text,
    envelope_hash: payload.envelope_hash.toLowerCase(),
    explicit_action_hashes: explicitActionHashes,
    supersedes_intent_id: expectedSupersedes,
  };
}

function validatePrincipalChangePayload(payload, state, policy) {
  assertObject(payload, 'principal_change payload');
  assertOnlyKeys(payload, new Set([
    'from_principal_id',
    'to_principal_id',
    'reason',
    'resolver_outcome',
    'attestation',
  ]), 'principal_change payload');
  const expectedFrom = state.active_principal ? state.active_principal.identity : null;
  if (payload.from_principal_id !== expectedFrom) {
    stateError('principal_change from_principal_id does not match active principal');
  }
  assertNullableString(payload.to_principal_id, 'principal_change payload.to_principal_id');
  assertString(payload.reason, 'principal_change payload.reason');
  assertString(payload.resolver_outcome, 'principal_change payload.resolver_outcome');
  if (payload.to_principal_id === null) {
    if (payload.attestation !== null) stateError('principal_change to null must carry null attestation');
    return { to: null };
  }
  const rosterEntry = ownerRosterEntry(policy, payload.to_principal_id);
  if (!rosterEntry) stateError('principal_change target is outside frozen owner roster');
  const attestation = assertObject(payload.attestation, 'principal_change payload.attestation');
  if (canonicalJson(attestation) !== canonicalJson(rosterEntry.attestation)) {
    stateError('principal_change attestation does not match frozen owner roster');
  }
  return { to: rosterEntry };
}

function decisionContent(payload) {
  return {
    decision_id: payload.decision_id,
    intent_id: payload.intent_id,
    principal_id: payload.principal_id,
    owner_turn_hash: payload.owner_turn_hash,
    action_class: payload.action_class,
    action_descriptor: payload.action_descriptor,
    action_descriptor_hash: payload.action_descriptor_hash,
    requested_max_uses: payload.requested_max_uses,
  };
}

function validateDecisionPayload(payload, state, policy) {
  assertObject(payload, 'decision payload');
  assertOnlyKeys(payload, new Set([
    'decision_id',
    'intent_id',
    'principal_id',
    'owner_turn_hash',
    'action_class',
    'action_descriptor',
    'action_descriptor_hash',
    'requested_max_uses',
    'requires_approval',
    'decision_content_hash',
    'intent_relation',
  ]), 'decision payload');
  const decisionId = assertString(payload.decision_id, 'decision payload.decision_id');
  if (state.decisions[decisionId]) stateError(`decision "${decisionId}" already exists`);
  if (!state.active_principal || payload.principal_id !== state.active_principal.identity) {
    stateError('decision principal must equal current active owner');
  }
  if (payload.intent_id !== state.current_intent_id || !state.intents[payload.intent_id]) {
    stateError('decision must bind the current user intent');
  }
  assertHash(payload.owner_turn_hash, 'decision payload.owner_turn_hash');
  if (!Object.prototype.hasOwnProperty.call(policy.approval_policy, payload.action_class)) {
    stateError('decision action_class is not in the frozen policy');
  }
  assertObject(payload.action_descriptor, 'decision payload.action_descriptor');
  const calculatedActionHash = sha256(canonicalJson(payload.action_descriptor));
  if (payload.action_descriptor_hash !== calculatedActionHash) {
    stateError('decision action_descriptor_hash does not match action_descriptor');
  }
  const rule = policy.approval_policy[payload.action_class];
  assertInteger(payload.requested_max_uses, 'decision payload.requested_max_uses');
  if (payload.requested_max_uses > rule.max_uses
    || (payload.action_class === 'irreversible' && payload.requested_max_uses !== 1)) {
    stateError('decision requested_max_uses exceeds frozen policy');
  }
  if (payload.requires_approval !== rule.requires_approval) {
    stateError('decision requires_approval does not match frozen policy');
  }
  const expectedDecisionHash = sha256(canonicalJson(decisionContent(payload)));
  if (payload.decision_content_hash !== expectedDecisionHash) {
    stateError('decision_content_hash does not match bound decision content');
  }
  const intent = state.intents[payload.intent_id];
  const expectedRelation = intent.explicit_action_hashes.includes(payload.action_descriptor_hash)
    ? 'explicit'
    : 'derived';
  if (payload.intent_relation !== expectedRelation) {
    stateError('decision intent_relation must be mechanically derived from user intent');
  }
  return {
    decision_id: decisionId,
    intent_id: payload.intent_id,
    principal_id: payload.principal_id,
    owner_turn_hash: payload.owner_turn_hash.toLowerCase(),
    action_class: payload.action_class,
    action_descriptor: cloneCanonical(payload.action_descriptor),
    action_descriptor_hash: payload.action_descriptor_hash.toLowerCase(),
    requested_max_uses: payload.requested_max_uses,
    requires_approval: payload.requires_approval,
    decision_content_hash: payload.decision_content_hash.toLowerCase(),
    intent_relation: expectedRelation,
    suspended: false,
    approved_uses: 0,
  };
}

function validateApprovalPayload(payload, state, policy) {
  assertObject(payload, 'approval payload');
  assertOnlyKeys(payload, new Set(['approval_id', 'decision_id', 'decision_content_hash', 'max_uses', 'envelope_hash']), 'approval payload');
  const approvalId = assertString(payload.approval_id, 'approval payload.approval_id');
  if (state.approvals[approvalId]) stateError(`approval "${approvalId}" already exists`);
  const decision = state.decisions[payload.decision_id];
  if (!decision) stateError('approval references an unknown decision');
  if (decision.suspended || decision.intent_id !== state.current_intent_id) {
    stateError('approval references a suspended decision');
  }
  if (!decision.requires_approval) stateError('approval references a decision that does not require approval');
  if (payload.decision_content_hash !== decision.decision_content_hash) {
    stateError('approval decision_content_hash does not exactly match decision');
  }
  assertInteger(payload.max_uses, 'approval payload.max_uses');
  const rule = policy.approval_policy[decision.action_class];
  if (payload.max_uses !== decision.requested_max_uses || payload.max_uses > rule.max_uses
    || (decision.action_class === 'irreversible' && payload.max_uses !== 1)) {
    stateError('approval max_uses does not exactly match the frozen decision policy');
  }
  assertHash(payload.envelope_hash, 'approval payload.envelope_hash');
  return {
    approval_id: approvalId,
    decision_id: payload.decision_id,
    decision_content_hash: payload.decision_content_hash.toLowerCase(),
    max_uses: payload.max_uses,
    envelope_hash: payload.envelope_hash.toLowerCase(),
  };
}

function validateSuspensionPayload(payload, state) {
  assertObject(payload, 'suspension payload');
  assertOnlyKeys(payload, new Set(['suspension_id', 'intent_id', 'decision_ids', 'reason']), 'suspension payload');
  const suspensionId = assertString(payload.suspension_id, 'suspension payload.suspension_id');
  assertString(payload.intent_id, 'suspension payload.intent_id');
  assertString(payload.reason, 'suspension payload.reason');
  if (!Array.isArray(payload.decision_ids) || payload.decision_ids.length === 0) {
    stateError('suspension payload.decision_ids must be a non-empty array');
  }
  const seen = new Set();
  for (const decisionId of payload.decision_ids) {
    assertString(decisionId, 'suspension payload.decision_ids item');
    if (seen.has(decisionId)) stateError('suspension payload.decision_ids has duplicates');
    seen.add(decisionId);
  }
  return { suspension_id: suspensionId, intent_id: payload.intent_id, decision_ids: [...seen], reason: payload.reason };
}

function validateEvidencePayload(payload) {
  assertObject(payload, 'evidence payload');
  assertOnlyKeys(payload, new Set(['evidence_id', 'attestation_ref', 'artifact_hashes']), 'evidence payload');
  assertString(payload.evidence_id, 'evidence payload.evidence_id');
  const ref = assertObject(payload.attestation_ref, 'evidence payload.attestation_ref');
  assertOnlyKeys(ref, new Set(['uri', 'sha256']), 'evidence payload.attestation_ref');
  assertString(ref.uri, 'evidence payload.attestation_ref.uri');
  assertHash(ref.sha256, 'evidence payload.attestation_ref.sha256');
  assertArrayOfHashes(payload.artifact_hashes, 'evidence payload.artifact_hashes');
}

function validateAbortPayload(payload, emitter) {
  assertObject(payload, 'abort payload');
  assertOnlyKeys(payload, new Set(['reason']), 'abort payload');
  assertString(payload.reason, 'abort payload.reason');
  if (emitter.kind === 'kernel' && payload.reason !== 'blocked_timeout') {
    stateError('kernel abort may only represent blocked_timeout');
  }
}

function validateCheckpointPayload(payload, state) {
  assertObject(payload, 'checkpoint payload');
  assertOnlyKeys(payload, new Set(['checkpoint_id', 'ledger_head', 'state_projection', 'state_projection_hash']), 'checkpoint payload');
  assertString(payload.checkpoint_id, 'checkpoint payload.checkpoint_id');
  if (payload.ledger_head !== state.event_head) stateError('checkpoint ledger_head must equal the pre-checkpoint ledger head');
  const projection = assertObject(payload.state_projection, 'checkpoint payload.state_projection');
  assertHash(payload.state_projection_hash, 'checkpoint payload.state_projection_hash');
  if (payload.state_projection_hash !== sha256(canonicalJson(projection))) {
    stateError('checkpoint state_projection_hash does not match projection');
  }
  if (canonicalJson(projection) !== canonicalJson(stateProjection(state))) {
    stateError('checkpoint state_projection is not the deterministic current state');
  }
}

function validateTranslationPayload(payload) {
  assertObject(payload, 'translation_used payload');
  assertOnlyKeys(payload, new Set(['translation_id', 'source', 'target']), 'translation_used payload');
  assertString(payload.translation_id, 'translation_used payload.translation_id');
  assertHash(payload.source, 'translation_used payload.source');
  assertHash(payload.target, 'translation_used payload.target');
}

function validateAcceptancePayload(payload) {
  assertObject(payload, 'acceptance payload');
  assertOnlyKeys(payload, new Set(['acceptance_id', 'candidate_hashes']), 'acceptance payload');
  assertString(payload.acceptance_id, 'acceptance payload.acceptance_id');
  assertArrayOfHashes(payload.candidate_hashes, 'acceptance payload.candidate_hashes');
}

function applyEvent(previousState, event, policy) {
  const state = cloneState(previousState);
  if (state.status === 'complete') stateError('cannot append an event after terminal completion');
  if (event.sequence !== state.sequence + 1 || event.prev_event_hash !== state.event_head) {
    stateError('event sequence or previous hash does not match current state');
  }
  if (event.run_id !== state.run_id || event.policy_hash !== state.policy_hash || event.contract_hash !== state.contract_hash) {
    stateError('event does not match current run policy or contract');
  }

  switch (event.type) {
    case 'intent': {
      const intent = validateIntentPayload(event.payload, state);
      for (const decision of Object.values(state.decisions)) {
        if (!decision.suspended && decision.intent_id !== intent.intent_id) {
          decision.suspended = true;
          decision.approved_uses = 0;
          clearBlockReason(state, approvalReason(decision.decision_id));
        }
      }
      state.intents[intent.intent_id] = intent;
      state.current_intent_id = intent.intent_id;
      if (state.active_principal && state.block_reasons.length === 0) state.status = 'decide';
      break;
    }
    case 'principal_change': {
      const change = validatePrincipalChangePayload(event.payload, state, policy);
      if (change.to === null) {
        state.active_principal = null;
        addBlockReason(state, 'owner_unavailable', event.emitted_at);
      } else {
        state.active_principal = cloneCanonical(change.to);
        clearBlockReason(state, 'owner_unavailable');
        if (!state.current_intent_id) state.status = 'intake';
      }
      break;
    }
    case 'decision': {
      const decision = validateDecisionPayload(event.payload, state, policy);
      state.decisions[decision.decision_id] = decision;
      if (decision.requires_approval) addBlockReason(state, approvalReason(decision.decision_id), event.emitted_at);
      break;
    }
    case 'approval': {
      const approval = validateApprovalPayload(event.payload, state, policy);
      state.approvals[approval.approval_id] = approval;
      state.decisions[approval.decision_id].approved_uses = approval.max_uses;
      clearBlockReason(state, approvalReason(approval.decision_id));
      break;
    }
    case 'suspension': {
      const suspension = validateSuspensionPayload(event.payload, state);
      for (const decisionId of suspension.decision_ids) {
        const decision = state.decisions[decisionId];
        if (!decision || decision.intent_id === state.current_intent_id) {
          stateError('suspension must name a prior-intent decision');
        }
        decision.suspended = true;
        decision.approved_uses = 0;
        clearBlockReason(state, approvalReason(decisionId));
      }
      break;
    }
    case 'evidence':
      validateEvidencePayload(event.payload);
      break;
    case 'checkpoint':
      validateCheckpointPayload(event.payload, state);
      state.last_checkpoint = {
        checkpoint_id: event.payload.checkpoint_id,
        ledger_head: event.payload.ledger_head,
        state_projection_hash: event.payload.state_projection_hash,
      };
      break;
    case 'translation_used':
      validateTranslationPayload(event.payload);
      break;
    case 'abort':
      validateAbortPayload(event.payload, event.emitter);
      state.status = 'complete';
      state.terminal_reason = event.emitter.kind === 'user' ? 'user_abort' : 'timeout_abort';
      state.blocked_since = null;
      state.block_reasons = [];
      break;
    case 'acceptance':
      validateAcceptancePayload(event.payload);
      state.status = 'complete';
      state.terminal_reason = 'accepted';
      state.blocked_since = null;
      state.block_reasons = [];
      break;
    default:
      stateError(`unsupported owner event type "${event.type}"`);
  }

  state.sequence = event.sequence;
  state.event_head = event.event_hash;
  state.witness_head = event.witness.witness_head;
  return state;
}

function replayEvents(header, events, policy) {
  let state = makeInitialState(header);
  for (const event of events) {
    state = applyEvent(state, event, policy);
  }
  return state;
}

function deriveDisclosure(state) {
  const decisions = Object.values(state.decisions)
    .filter((decision) => decision.intent_relation === 'derived')
    .sort((left, right) => left.decision_id.localeCompare(right.decision_id))
    .map((decision) => ({
      decision_id: decision.decision_id,
      principal_id: decision.principal_id,
      intent_id: decision.intent_id,
      action_descriptor: decision.action_descriptor,
      action_descriptor_hash: decision.action_descriptor_hash,
      decision_content_hash: decision.decision_content_hash,
      action_class: decision.action_class,
      status: decision.suspended ? 'superseded' : 'active',
    }));
  return cloneCanonical({
    run_id: state.run_id,
    current_intent_id: state.current_intent_id,
    decisions,
  });
}

module.exports = {
  applyEvent,
  decisionContent,
  deriveDisclosure,
  makeInitialState,
  replayEvents,
  stateProjection,
};
