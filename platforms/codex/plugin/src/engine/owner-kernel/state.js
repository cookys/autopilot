'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { normalizeFrozenActionDescriptor, receiptIsWithinBrokerRoot } = require('./actions');
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

function assertNullableTimestamp(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    stateError(`${label} must be null or a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
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
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    stateError(`${label} must be a plain data object`);
  }
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
  const state = {
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
  if (header.authority) {
    state.authority_version = 1;
    state.authority_hash = header.authority_hash;
    state.host_capability_hash = header.authority.host_capability_hash;
    state.authority_host_capability_verifier_binding_hash = header.authority.host_capability_verifier_binding_hash;
    state.authority_executor_binding_hash = header.authority.executor_binding_hash;
    state.authority_executor_attestation_hash = header.authority.executor_binding.attestation_hash;
    state.authority_broker = cloneCanonical(header.authority.host_capability.broker);
    state.authority_witness_binding_hash = header.authority.witness_binding_hash;
    state.intake_observation_hash = header.authority.intake_observation_hash;
    state.intake_probe_nonce_commitment = header.authority.intake_probe_nonce_commitment;
    state.action_claims = {};
    state.action_outcomes = {};
  }
  return state;
}

function stateProjection(state) {
  const projection = {
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
  };
  if (state.authority_version !== undefined) {
    projection.authority_version = state.authority_version;
    projection.authority_hash = state.authority_hash;
    projection.host_capability_hash = state.host_capability_hash;
    projection.authority_host_capability_verifier_binding_hash = state.authority_host_capability_verifier_binding_hash;
    projection.authority_executor_binding_hash = state.authority_executor_binding_hash;
    projection.authority_executor_attestation_hash = state.authority_executor_attestation_hash;
    projection.authority_broker = state.authority_broker;
    projection.authority_witness_binding_hash = state.authority_witness_binding_hash;
    projection.intake_observation_hash = state.intake_observation_hash;
    projection.intake_probe_nonce_commitment = state.intake_probe_nonce_commitment;
    projection.action_claims = state.action_claims;
    projection.action_outcomes = state.action_outcomes;
  }
  return cloneCanonical(projection);
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

function actionFailureReason(claimId) {
  return `action_outcome:${claimId}`;
}

function hasActionAuthority(state) {
  return state.authority_version === 1;
}

function hasPendingActionClaim(state) {
  return hasActionAuthority(state) && Object.values(state.action_claims).some((claim) => claim.outcome === null);
}

function revokePendingActionClaims(state, predicate, reason) {
  if (!hasActionAuthority(state)) return;
  for (const claim of Object.values(state.action_claims)) {
    if (claim.outcome !== null || !predicate(claim)) continue;
    claim.outcome = 'revoked';
    state.action_outcomes[claim.claim_id] = {
      claim_id: claim.claim_id,
      outcome: 'revoked',
      receipt_ref: null,
      broker_receipt: null,
      executor_binding_hash: claim.executor_binding_hash,
      execution_permit_hash: claim.execution_permit_hash,
      observed_action_descriptor_hash: null,
      error_code: reason,
    };
  }
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
  let normalizedDescriptor = cloneCanonical(payload.action_descriptor);
  if (hasActionAuthority(state)) {
    try {
      normalizedDescriptor = normalizeFrozenActionDescriptor(policy, payload.action_descriptor);
    } catch (error) {
      stateError(`authority decision action descriptor is invalid: ${error.message}`);
    }
    if (canonicalJson(payload.action_descriptor) !== canonicalJson(normalizedDescriptor)) {
      stateError('authority decision action_descriptor is not the canonical frozen catalog descriptor');
    }
    if (payload.action_class !== normalizedDescriptor.action_class) {
      stateError('authority decision action_class must equal the canonical action descriptor class');
    }
  }
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
    action_descriptor: normalizedDescriptor,
    action_descriptor_hash: payload.action_descriptor_hash.toLowerCase(),
    requested_max_uses: payload.requested_max_uses,
    requires_approval: payload.requires_approval,
    decision_content_hash: payload.decision_content_hash.toLowerCase(),
    intent_relation: expectedRelation,
    suspended: false,
    approved_uses: 0,
    ...(hasActionAuthority(state) ? { claimed_uses: 0 } : {}),
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
  if (hasActionAuthority(state)
    && Object.values(state.approvals).some((approval) => approval.decision_id === payload.decision_id)) {
    stateError('approval decision already has an active exact approval');
  }
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

function assertNullableHash(value, label) {
  if (value === null) return null;
  return assertHash(value, label).toLowerCase();
}

function validateReceiptRef(value, label, { required = false } = {}) {
  if (value === null) {
    if (required) stateError(`${label} is required`);
    return null;
  }
  const ref = assertObject(value, label);
  assertOnlyKeys(ref, new Set(['uri', 'sha256']), label);
  assertString(ref.uri, `${label}.uri`);
  assertHash(ref.sha256, `${label}.sha256`);
  return { uri: ref.uri, sha256: ref.sha256.toLowerCase() };
}

function validateBrokerReceipt(value, state, label, { required = false } = {}) {
  const broker = state.authority_broker;
  if (broker === null) {
    if (value !== null) stateError(`${label} is not allowed without an intake-frozen broker`);
    return null;
  }
  if (value === null) {
    if (required) stateError(`${label} is required for brokered execution`);
    return null;
  }
  const receipt = assertObject(value, label);
  assertOnlyKeys(receipt, new Set(['identity', 'broker_uid']), label);
  if (receipt.identity !== broker.identity || receipt.broker_uid !== broker.broker_uid) {
    stateError(`${label} does not exactly match the intake-frozen broker`);
  }
  return { identity: broker.identity, broker_uid: broker.broker_uid };
}

function actionUseLimit(decision) {
  return decision.requires_approval ? decision.approved_uses : decision.requested_max_uses;
}

function validateActionClaimEvidence(payload, state, emitter) {
  if (!hasActionAuthority(state)) stateError('action claims require an authority-enabled ledger');
  if (emitter.kind !== 'kernel') stateError('action claims can only be minted by the Kernel');
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'claim_id',
    'decision_id',
    'decision_content_hash',
    'action_descriptor_hash',
    'claimed_use',
    'host_capability_hash',
    'host_observation_hash',
    'host_probe_nonce_commitment',
    'execution_permit_id',
    'execution_permit_hash',
    'executor_binding_hash',
    'pre_action_witness_head',
  ]), 'action_claim evidence payload');
  assertString(payload.evidence_id, 'action_claim evidence payload.evidence_id');
  const claimId = assertString(payload.claim_id, 'action_claim evidence payload.claim_id');
  if (state.action_claims[claimId]) stateError(`action claim "${claimId}" already exists`);
  const decision = state.decisions[payload.decision_id];
  if (!decision || decision.suspended || decision.intent_id !== state.current_intent_id) {
    stateError('action claim requires a current, unsuspended decision');
  }
  if (payload.decision_content_hash !== decision.decision_content_hash
    || payload.action_descriptor_hash !== decision.action_descriptor_hash) {
    stateError('action claim does not exactly bind the authorized decision');
  }
  if (hasPendingActionClaim(state)) {
    stateError('action claim cannot mint while another host action remains unresolved');
  }
  assertInteger(decision.claimed_uses, 'action claim decision.claimed_uses', 0);
  assertInteger(actionUseLimit(decision), 'action claim decision authorized uses', 0);
  assertInteger(payload.claimed_use, 'action_claim evidence payload.claimed_use');
  if (payload.claimed_use !== decision.claimed_uses + 1
    || payload.claimed_use > actionUseLimit(decision)) {
    stateError('action claim use is exhausted or does not advance exactly one authorized use');
  }
  if (payload.host_capability_hash !== state.host_capability_hash) {
    stateError('action claim host capability hash does not match the intake-frozen authority');
  }
  assertHash(payload.host_observation_hash, 'action_claim evidence payload.host_observation_hash');
  assertHash(payload.host_probe_nonce_commitment, 'action_claim evidence payload.host_probe_nonce_commitment');
  assertString(payload.execution_permit_id, 'action_claim evidence payload.execution_permit_id');
  assertHash(payload.execution_permit_hash, 'action_claim evidence payload.execution_permit_hash');
  if (payload.executor_binding_hash !== state.authority_executor_binding_hash) {
    stateError('action claim executor binding hash does not match the intake-frozen authority');
  }
  const preActionWitnessHead = assertNullableHash(
    payload.pre_action_witness_head,
    'action_claim evidence payload.pre_action_witness_head',
  );
  if (preActionWitnessHead !== state.witness_head) {
    stateError('action claim pre_action_witness_head does not match the fully ingested witness head');
  }
  return {
    claim_id: claimId,
    decision_id: decision.decision_id,
    decision_content_hash: decision.decision_content_hash,
    action_descriptor_hash: decision.action_descriptor_hash,
    claimed_use: payload.claimed_use,
    host_capability_hash: state.host_capability_hash,
    host_observation_hash: payload.host_observation_hash.toLowerCase(),
    host_probe_nonce_commitment: payload.host_probe_nonce_commitment.toLowerCase(),
    execution_permit_id: payload.execution_permit_id,
    execution_permit_hash: payload.execution_permit_hash.toLowerCase(),
    executor_binding_hash: state.authority_executor_binding_hash,
    pre_action_witness_head: preActionWitnessHead,
    outcome: null,
  };
}

function validateActionCancellation(payload, state, claim, eventEmittedAt) {
  if (payload === null) return null;
  const value = assertObject(payload, 'action_outcome evidence payload.cancellation');
  assertOnlyKeys(value, new Set([
    'request_hash',
    'reason',
    'abort_envelope_hash',
    'execution_authorization_hash',
    'authorization_id',
    'state',
    'receipt_ref',
    'broker_receipt',
    'boundary_effect_id',
    'boundary_state_version',
    'attestation_hash',
    'received_at',
    'effect_at',
  ]), 'action_outcome evidence payload.cancellation');
  assertHash(value.request_hash, 'action_outcome evidence payload.cancellation.request_hash');
  assertString(value.reason, 'action_outcome evidence payload.cancellation.reason');
  const abortEnvelopeHash = assertNullableHash(
    value.abort_envelope_hash,
    'action_outcome evidence payload.cancellation.abort_envelope_hash',
  );
  const cancellationAuthorizationHash = assertNullableHash(
    value.execution_authorization_hash,
    'action_outcome evidence payload.cancellation.execution_authorization_hash',
  );
  const cancellationAuthorizationId = assertNullableString(
    value.authorization_id,
    'action_outcome evidence payload.cancellation.authorization_id',
  );
  if ((cancellationAuthorizationHash === null) !== (cancellationAuthorizationId === null)) {
    stateError('action cancellation authorization hash and ID must be present together');
  }
  const expectedRequestHash = sha256(canonicalJson({
    run_id: state.run_id,
    authority_hash: state.authority_hash,
    claim_id: claim.claim_id,
    claim_event_hash: state.event_head,
    execution_permit_id: claim.execution_permit_id,
    execution_permit_hash: claim.execution_permit_hash,
    execution_authorization_hash: cancellationAuthorizationHash,
    authorization_id: cancellationAuthorizationId,
    reason: value.reason,
    abort_envelope_hash: abortEnvelopeHash,
  }));
  if (value.request_hash !== expectedRequestHash) {
    stateError('action cancellation request hash is not bound to its claim, authorization, and authenticated abort origin');
  }
  if (!['revoked', 'not_started', 'completed', 'unknown', 'unconfirmed'].includes(value.state)) {
    stateError('action_outcome evidence payload.cancellation.state is invalid');
  }
  if (value.state === 'unconfirmed') {
    if (value.receipt_ref !== null || value.broker_receipt !== null || value.boundary_effect_id !== null
      || value.boundary_state_version !== null || value.attestation_hash !== null || value.received_at !== null
      || value.effect_at !== null) {
      stateError('unconfirmed action cancellation must not claim a broker/executor acknowledgement');
    }
    return {
      request_hash: value.request_hash.toLowerCase(),
      reason: value.reason,
      abort_envelope_hash: abortEnvelopeHash,
      execution_authorization_hash: cancellationAuthorizationHash,
      authorization_id: cancellationAuthorizationId,
      state: 'unconfirmed',
      receipt_ref: null,
      broker_receipt: null,
      boundary_effect_id: null,
      boundary_state_version: null,
      attestation_hash: null,
      received_at: null,
      effect_at: null,
    };
  }
  const receipt = validateReceiptRef(
    value.receipt_ref,
    'action_outcome evidence payload.cancellation.receipt_ref',
    { required: true },
  );
  if (!receiptIsWithinBrokerRoot(receipt, state.authority_broker)) {
    stateError('action cancellation acknowledgement receipt is outside the intake-frozen broker receipt root');
  }
  const brokerReceipt = validateBrokerReceipt(
    value.broker_receipt,
    state,
    'action_outcome evidence payload.cancellation.broker_receipt',
    { required: state.authority_broker !== null },
  );
  const expectedAttestation = state.authority_broker === null
    ? state.authority_executor_attestation_hash
    : state.authority_broker.attestation_hash;
  if (value.attestation_hash !== expectedAttestation) {
    stateError('action cancellation acknowledgement attestation does not match the intake-frozen boundary');
  }
  const boundaryEffectId = assertNullableString(
    value.boundary_effect_id,
    'action_outcome evidence payload.cancellation.boundary_effect_id',
  );
  if (value.state === 'completed' && boundaryEffectId === null) {
    stateError('completed action cancellation acknowledgement requires boundary_effect_id');
  }
  const effectAt = assertNullableTimestamp(
    value.effect_at,
    'action_outcome evidence payload.cancellation.effect_at',
  );
  if (value.state === 'completed') {
    if (cancellationAuthorizationHash === null || cancellationAuthorizationId === null || effectAt === null) {
      stateError('completed action cancellation acknowledgement requires a post-claim authorization and effect timestamp');
    }
  } else if (effectAt !== null) {
    stateError('non-completed action cancellation acknowledgement must not claim an effect timestamp');
  }
  const boundaryStateVersion = value.boundary_state_version === null
    ? null
    : assertInteger(value.boundary_state_version, 'action_outcome evidence payload.cancellation.boundary_state_version');
  if (boundaryStateVersion === null) {
    stateError('confirmed action cancellation acknowledgement requires boundary_state_version');
  }
  const receivedAt = assertNullableTimestamp(
    value.received_at,
    'action_outcome evidence payload.cancellation.received_at',
  );
  if (receivedAt === null) stateError('confirmed action cancellation acknowledgement requires received_at');
  if (new Date(receivedAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('action cancellation acknowledgement cannot be received after its witnessed outcome');
  }
  if (effectAt !== null && (new Date(effectAt).getTime() > new Date(receivedAt).getTime()
    || new Date(effectAt).getTime() > new Date(eventEmittedAt).getTime())) {
    stateError('action cancellation effect cannot occur after its acknowledgement or witnessed outcome');
  }
  return {
    request_hash: value.request_hash.toLowerCase(),
    reason: value.reason,
    abort_envelope_hash: abortEnvelopeHash,
    execution_authorization_hash: cancellationAuthorizationHash,
    authorization_id: cancellationAuthorizationId,
    state: value.state,
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: boundaryStateVersion,
    attestation_hash: expectedAttestation,
    received_at: receivedAt,
    effect_at: effectAt,
  };
}

function validateActionOutcomeEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasActionAuthority(state)) stateError('action outcomes require an authority-enabled ledger');
  if (emitter.kind !== 'kernel') stateError('action outcomes can only be minted by the Kernel');
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'claim_id',
    'decision_id',
    'outcome',
    'receipt_ref',
    'broker_receipt',
    'executor_binding_hash',
    'execution_permit_hash',
    'execution_authorization_hash',
    'authorization_id',
    'claim_event_hash',
    'claim_witness_head',
    'permit_state',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
    'cancellation',
    'observed_action_descriptor_hash',
    'error_code',
  ]), 'action_outcome evidence payload');
  assertString(payload.evidence_id, 'action_outcome evidence payload.evidence_id');
  const claimId = assertString(payload.claim_id, 'action_outcome evidence payload.claim_id');
  const claim = state.action_claims[claimId];
  if (!claim || claim.outcome !== null || state.action_outcomes[claimId]) {
    stateError('action outcome must settle exactly one pending action claim');
  }
  if (payload.decision_id !== claim.decision_id) {
    stateError('action outcome decision_id does not match its claim');
  }
  if (!['succeeded', 'failed', 'unknown'].includes(payload.outcome)) {
    stateError('action outcome must be succeeded, failed, or unknown');
  }
  if (payload.executor_binding_hash !== state.authority_executor_binding_hash
    || payload.executor_binding_hash !== claim.executor_binding_hash) {
    stateError('action outcome executor binding hash does not match its intake-frozen claim');
  }
  if (payload.execution_permit_hash !== claim.execution_permit_hash) {
    stateError('action outcome execution permit hash does not match its host action claim');
  }
  if (payload.claim_event_hash !== state.event_head || payload.claim_witness_head !== state.witness_head) {
    stateError('action outcome must bind the immediately preceding witnessed action claim');
  }
  const authorizationHash = assertNullableHash(
    payload.execution_authorization_hash,
    'action_outcome evidence payload.execution_authorization_hash',
  );
  const authorizationId = assertNullableString(payload.authorization_id, 'action_outcome evidence payload.authorization_id');
  const permitState = assertNullableString(payload.permit_state, 'action_outcome evidence payload.permit_state');
  const boundaryEffectId = assertNullableString(
    payload.boundary_effect_id,
    'action_outcome evidence payload.boundary_effect_id',
  );
  const boundaryStateVersion = payload.boundary_state_version === null
    ? null
    : assertInteger(payload.boundary_state_version, 'action_outcome evidence payload.boundary_state_version');
  const boundaryAttestation = assertNullableHash(
    payload.boundary_attestation_hash,
    'action_outcome evidence payload.boundary_attestation_hash',
  );
  const effectAt = assertNullableTimestamp(payload.effect_at, 'action_outcome evidence payload.effect_at');
  if (effectAt !== null && new Date(effectAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('action outcome effect cannot occur after its witnessed outcome');
  }
  const hasAuthorization = authorizationHash !== null || authorizationId !== null;
  if ((authorizationHash === null) !== (authorizationId === null)) {
    stateError('action outcome execution authorization hash and ID must be present together');
  }
  const hasEffectRecord = permitState !== null || boundaryEffectId !== null || boundaryStateVersion !== null
    || boundaryAttestation !== null || effectAt !== null;
  if (hasEffectRecord) {
    const expectedBoundaryAttestation = state.authority_broker === null
      ? state.authority_executor_attestation_hash
      : state.authority_broker.attestation_hash;
    if (authorizationHash === null || authorizationId === null || permitState !== 'consumed'
      || boundaryEffectId === null || boundaryStateVersion === null || boundaryAttestation !== expectedBoundaryAttestation
      || effectAt === null) {
      stateError('a consumed action boundary record must carry complete authorization, effect, and attestation bindings');
    }
  }
  if (payload.outcome !== 'unknown' && !hasEffectRecord) {
    stateError('known action outcomes require a consumed post-claim execution authorization');
  }
  const receipt = validateReceiptRef(
    payload.receipt_ref,
    'action_outcome evidence payload.receipt_ref',
    { required: payload.outcome !== 'unknown' },
  );
  const brokerReceipt = validateBrokerReceipt(
    payload.broker_receipt,
    state,
    'action_outcome evidence payload.broker_receipt',
    { required: payload.outcome !== 'unknown' && state.authority_broker !== null },
  );
  if (receipt !== null && !receiptIsWithinBrokerRoot(receipt, state.authority_broker)) {
    stateError('action outcome receipt is outside the intake-frozen broker receipt root');
  }
  const cancellation = validateActionCancellation(
    payload.cancellation,
    state,
    claim,
    eventEmittedAt,
  );
  if (cancellation !== null && payload.outcome !== 'unknown') {
    stateError('a cancelled action can only settle as unknown');
  }
  if (cancellation !== null && cancellation.state !== 'unconfirmed') {
    if ((cancellation.state === 'revoked' || cancellation.state === 'not_started') && hasEffectRecord) {
      stateError('a revoked or not-started cancellation acknowledgement cannot coexist with a consumed effect record');
    }
    if (cancellation.state === 'completed') {
      if (hasEffectRecord && (cancellation.boundary_effect_id !== boundaryEffectId
        || cancellation.boundary_state_version < boundaryStateVersion
        || cancellation.effect_at !== effectAt)) {
        stateError('a completed cancellation acknowledgement must order after and identify the consumed boundary effect');
      }
    }
  }
  const observedHash = assertNullableHash(
    payload.observed_action_descriptor_hash,
    'action_outcome evidence payload.observed_action_descriptor_hash',
  );
  if (payload.outcome === 'succeeded' && observedHash !== claim.action_descriptor_hash) {
    stateError('successful action outcome must reconcile to the exact authorized action descriptor');
  }
  if (observedHash !== null && observedHash !== claim.action_descriptor_hash) {
    stateError('action outcome observed descriptor does not match its claim');
  }
  if (payload.error_code !== undefined && payload.error_code !== null) {
    assertString(payload.error_code, 'action_outcome evidence payload.error_code');
  }
  return {
    claim_id: claimId,
    outcome: payload.outcome,
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    executor_binding_hash: state.authority_executor_binding_hash,
    execution_permit_hash: claim.execution_permit_hash,
    execution_authorization_hash: authorizationHash,
    authorization_id: authorizationId,
    claim_event_hash: state.event_head,
    claim_witness_head: state.witness_head,
    permit_state: permitState,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: boundaryStateVersion,
    boundary_attestation_hash: boundaryAttestation,
    effect_at: effectAt,
    cancellation,
    observed_action_descriptor_hash: observedHash,
    ...(payload.error_code === undefined || payload.error_code === null ? {} : { error_code: payload.error_code }),
  };
}

function validateCapabilityEvidence(payload, state, emitter, kind) {
  if (!hasActionAuthority(state)) stateError(`${kind} evidence requires an authority-enabled ledger`);
  if (emitter.kind !== 'kernel') stateError(`${kind} evidence can only be minted by the Kernel`);
  const allowed = kind === 'capability_regression'
    ? new Set([
      'evidence_id',
      'evidence_kind',
      'expected_capability_hash',
      'observed_capability_hash',
      'observation_hash',
      'probe_nonce_commitment',
      'reason',
    ])
    : new Set([
      'evidence_id',
      'evidence_kind',
      'expected_capability_hash',
      'observation_hash',
      'probe_nonce_commitment',
    ]);
  assertOnlyKeys(payload, allowed, `${kind} evidence payload`);
  assertString(payload.evidence_id, `${kind} evidence payload.evidence_id`);
  if (payload.expected_capability_hash !== state.host_capability_hash) {
    stateError(`${kind} evidence expected capability hash does not match intake authority`);
  }
  if (kind === 'capability_revalidated') {
    assertHash(payload.observation_hash, `${kind} evidence payload.observation_hash`);
  } else {
    assertNullableHash(payload.observation_hash, `${kind} evidence payload.observation_hash`);
  }
  assertHash(payload.probe_nonce_commitment, `${kind} evidence payload.probe_nonce_commitment`);
  if (kind === 'capability_regression') {
    assertNullableHash(payload.observed_capability_hash, `${kind} evidence payload.observed_capability_hash`);
    assertString(payload.reason, `${kind} evidence payload.reason`);
  }
}

function validateEvidencePayload(payload, state, emitter, eventEmittedAt) {
  assertObject(payload, 'evidence payload');
  const kind = payload.evidence_kind;
  if (kind === 'action_claim') return { kind, value: validateActionClaimEvidence(payload, state, emitter) };
  if (kind === 'action_outcome') {
    return { kind, value: validateActionOutcomeEvidence(payload, state, emitter, eventEmittedAt) };
  }
  if (kind === 'capability_regression' || kind === 'capability_revalidated') {
    validateCapabilityEvidence(payload, state, emitter, kind);
    return { kind, value: null };
  }
  assertOnlyKeys(payload, new Set(['evidence_id', 'attestation_ref', 'artifact_hashes']), 'evidence payload');
  assertString(payload.evidence_id, 'evidence payload.evidence_id');
  const ref = assertObject(payload.attestation_ref, 'evidence payload.attestation_ref');
  assertOnlyKeys(ref, new Set(['uri', 'sha256']), 'evidence payload.attestation_ref');
  assertString(ref.uri, 'evidence payload.attestation_ref.uri');
  assertHash(ref.sha256, 'evidence payload.attestation_ref.sha256');
  assertArrayOfHashes(payload.artifact_hashes, 'evidence payload.artifact_hashes');
  return { kind: 'generic', value: null };
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

function validateAcceptancePayload(payload, state) {
  assertObject(payload, 'acceptance payload');
  assertOnlyKeys(payload, new Set(['acceptance_id', 'candidate_hashes']), 'acceptance payload');
  assertString(payload.acceptance_id, 'acceptance payload.acceptance_id');
  assertArrayOfHashes(payload.candidate_hashes, 'acceptance payload.candidate_hashes');
  if (hasActionAuthority(state)) {
    for (const claim of Object.values(state.action_claims)) {
      if (claim.outcome !== 'succeeded') {
        stateError('acceptance cannot proceed while an action claim is pending, failed, or unknown');
      }
    }
  }
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
  if (hasActionAuthority(state)) {
    if (!Object.prototype.hasOwnProperty.call(event, 'authority_hash')
      || event.authority_hash !== state.authority_hash) {
      stateError('event authority_hash does not match the intake-frozen authority');
    }
  } else if (Object.prototype.hasOwnProperty.call(event, 'authority_hash')) {
    stateError('legacy event must not contain authority_hash');
  }
  if (hasPendingActionClaim(state)
    && (event.type !== 'evidence' || event.payload.evidence_kind !== 'action_outcome')) {
    stateError('only an action outcome may settle an unresolved host action claim');
  }

  switch (event.type) {
    case 'intent': {
      const intent = validateIntentPayload(event.payload, state);
      const supersededDecisionIds = new Set();
      for (const decision of Object.values(state.decisions)) {
        if (!decision.suspended && decision.intent_id !== intent.intent_id) {
          decision.suspended = true;
          decision.approved_uses = 0;
          supersededDecisionIds.add(decision.decision_id);
          clearBlockReason(state, approvalReason(decision.decision_id));
        }
      }
      revokePendingActionClaims(
        state,
        (claim) => supersededDecisionIds.has(claim.decision_id),
        'intent_superseded',
      );
      state.intents[intent.intent_id] = intent;
      state.current_intent_id = intent.intent_id;
      if (state.active_principal && state.block_reasons.length === 0) state.status = 'decide';
      break;
    }
    case 'principal_change': {
      const change = validatePrincipalChangePayload(event.payload, state, policy);
      revokePendingActionClaims(state, () => true, 'principal_changed');
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
      const suspendedDecisionIds = new Set(suspension.decision_ids);
      revokePendingActionClaims(
        state,
        (claim) => suspendedDecisionIds.has(claim.decision_id),
        'decision_suspended',
      );
      break;
    }
    case 'evidence': {
      const evidence = validateEvidencePayload(event.payload, state, event.emitter, event.emitted_at);
      if (evidence.kind === 'action_claim') {
        state.action_claims[evidence.value.claim_id] = evidence.value;
        state.decisions[evidence.value.decision_id].claimed_uses = evidence.value.claimed_use;
      } else if (evidence.kind === 'action_outcome') {
        const claim = state.action_claims[evidence.value.claim_id];
        claim.outcome = evidence.value.outcome;
        state.action_outcomes[evidence.value.claim_id] = evidence.value;
        if (evidence.value.outcome !== 'succeeded') {
          addBlockReason(state, actionFailureReason(evidence.value.claim_id), event.emitted_at);
        }
      } else if (evidence.kind === 'capability_regression') {
        revokePendingActionClaims(state, () => true, 'host_capability_regression');
        addBlockReason(state, 'host_capability_regression', event.emitted_at);
      } else if (evidence.kind === 'capability_revalidated') {
        clearBlockReason(state, 'host_capability_regression');
      }
      break;
    }
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
      validateAcceptancePayload(event.payload, state);
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
