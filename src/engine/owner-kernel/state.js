'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const {
  actionFootprintHash,
  canonicalFamilyId,
  classifyContractLeg,
  currentActionCandidateAudit,
  evaluateAcceptancePredicate,
  isDurableActionChallengeBlock,
  isQualifiedChallengeCurrent,
  manifestHash,
  normalizeArtifactManifest,
  sameManifest,
} = require('./acceptance');
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

function assertProtocolToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    stateError(`${label} must be a bounded protocol token`);
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
    state.authority_receipt_verifier_binding_hash = header.authority.receipt_verifier_binding_hash;
    state.authority_receipt_verifier_attestation_hash = header.authority.receipt_verifier_binding.attestation_hash;
    state.authority_broker = cloneCanonical(header.authority.host_capability.broker);
    state.authority_witness_binding_hash = header.authority.witness_binding_hash;
    state.intake_observation_hash = header.authority.intake_observation_hash;
    state.intake_probe_nonce_commitment = header.authority.intake_probe_nonce_commitment;
    state.action_claims = {};
    state.action_outcomes = {};
  }
  if (header.acceptance_authority) {
    state.acceptance_version = 2;
    state.acceptance_authority_commitment = header.acceptance_authority_hash;
    state.acceptance_authority_hash = header.acceptance_authority.binding_hash;
    state.acceptance_authority_binding = cloneCanonical(header.acceptance_authority.binding);
    state.acceptance_contract = cloneCanonical(header.acceptance_contract);
    state.acceptance_challenger_roster = cloneCanonical(header.policy.challenger_roster);
    state.acceptance_trusted_runner_roster = cloneCanonical(header.policy.trusted_runner_roster);
    state.verification_evidence = {};
    state.challenge_evidence = {};
    state.audit_reconciliations = {};
    state.action_reconciliations = {};
    state.delegations = {};
    state.recoveries = {};
    state.abort_request = null;
    state.acceptance_attempt = null;
    state.acceptance = null;
    state.terminal_controls = [];
    state.acceptance_failures = {};
  }
  if (header.semantic_authority) {
    state.semantic_authority_version = 1;
    state.semantic_authority_hash = header.semantic_authority_hash;
    state.semantic_route_hash = header.semantic_authority.route_hash;
    state.semantic_kernel_binding = cloneCanonical(header.semantic_authority.route.kernel_binding);
    if (!state.delegations) state.delegations = {};
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
    projection.authority_receipt_verifier_binding_hash = state.authority_receipt_verifier_binding_hash;
    projection.authority_receipt_verifier_attestation_hash = state.authority_receipt_verifier_attestation_hash;
    projection.authority_broker = state.authority_broker;
    projection.authority_witness_binding_hash = state.authority_witness_binding_hash;
    projection.intake_observation_hash = state.intake_observation_hash;
    projection.intake_probe_nonce_commitment = state.intake_probe_nonce_commitment;
    projection.action_claims = state.action_claims;
    projection.action_outcomes = state.action_outcomes;
  }
  if (state.acceptance_version !== undefined) {
    projection.acceptance_version = state.acceptance_version;
    projection.acceptance_authority_commitment = state.acceptance_authority_commitment;
    projection.acceptance_authority_hash = state.acceptance_authority_hash;
    projection.acceptance_authority_binding = state.acceptance_authority_binding;
    projection.acceptance_contract = state.acceptance_contract;
    projection.acceptance_challenger_roster = state.acceptance_challenger_roster;
    projection.acceptance_trusted_runner_roster = state.acceptance_trusted_runner_roster;
    projection.verification_evidence = state.verification_evidence;
    projection.challenge_evidence = state.challenge_evidence;
    projection.audit_reconciliations = state.audit_reconciliations;
    projection.action_reconciliations = state.action_reconciliations;
    projection.delegations = state.delegations;
    projection.recoveries = state.recoveries;
    projection.abort_request = state.abort_request;
    projection.acceptance_attempt = state.acceptance_attempt;
    projection.acceptance = state.acceptance;
    projection.terminal_controls = state.terminal_controls;
    projection.acceptance_failures = state.acceptance_failures;
  }
  if (state.semantic_authority_version !== undefined) {
    projection.semantic_authority_version = state.semantic_authority_version;
    projection.semantic_authority_hash = state.semantic_authority_hash;
    projection.semantic_route_hash = state.semantic_route_hash;
    projection.semantic_kernel_binding = state.semantic_kernel_binding;
    projection.delegations = state.delegations;
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

function hasAcceptanceProtocol(state) {
  return state.acceptance_version === 2;
}

function hasSemanticAuthority(state) {
  return state.semantic_authority_version === 1;
}

function hasDelegationProtocol(state) {
  return hasAcceptanceProtocol(state) || hasSemanticAuthority(state);
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

function validatePrincipalChangePayload(payload, state, policy, emitter) {
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('principal_change must be minted by the fixed Owner Kernel identity');
  }
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
  const content = {
    decision_id: payload.decision_id,
    intent_id: payload.intent_id,
    principal_id: payload.principal_id,
    owner_turn_hash: payload.owner_turn_hash,
    action_class: payload.action_class,
    action_descriptor: payload.action_descriptor,
    action_descriptor_hash: payload.action_descriptor_hash,
    requested_max_uses: payload.requested_max_uses,
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'action_challenge_id')) {
    content.action_challenge_id = payload.action_challenge_id;
    content.action_challenge_candidate_set_hash = payload.action_challenge_candidate_set_hash;
  }
  return content;
}

function validateDecisionPayload(payload, state, policy, emitter, eventEmittedAt) {
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
    'action_challenge_id',
    'action_challenge_candidate_set_hash',
    'requires_approval',
    'decision_content_hash',
    'intent_relation',
  ]), 'decision payload');
  const decisionId = assertString(payload.decision_id, 'decision payload.decision_id');
  if (state.decisions[decisionId]) stateError(`decision "${decisionId}" already exists`);
  if (!state.active_principal || payload.principal_id !== state.active_principal.identity) {
    stateError('decision principal must equal current active owner');
  }
  if (emitter.kind !== 'owner' || emitter.identity !== state.active_principal.identity) {
    stateError('decision emitter must equal the current active owner');
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
  let actionChallengeId = null;
  let actionChallengeCandidateSetHash = null;
  if (hasActionAuthority(state)) {
    const catalogEntry = policy.action_catalog.find((entry) => entry.id === normalizedDescriptor.catalog_id);
    if (!catalogEntry) stateError('authority decision action descriptor is outside the frozen action catalog');
    const hasChallengeBinding = Object.prototype.hasOwnProperty.call(payload, 'action_challenge_id')
      || Object.prototype.hasOwnProperty.call(payload, 'action_challenge_candidate_set_hash');
    if (catalogEntry.requires_challenge && hasAcceptanceProtocol(state)) {
      if (!hasChallengeBinding) {
        stateError('challenge-required authority decisions require a frozen schema_version 2 action challenge');
      }
      actionChallengeId = assertString(payload.action_challenge_id, 'decision payload.action_challenge_id');
      actionChallengeCandidateSetHash = assertHash(
        payload.action_challenge_candidate_set_hash,
        'decision payload.action_challenge_candidate_set_hash',
      ).toLowerCase();
      const challenge = state.challenge_evidence[actionChallengeId];
      if (!challenge || challenge.finding !== 'clear' || !isQualifiedChallengeCurrent(
        state,
        challenge,
        eventEmittedAt,
        {
          scope: 'action',
          scopeId: payload.action_descriptor_hash,
          candidateSetHash: actionChallengeCandidateSetHash,
          intentId: state.current_intent_id,
        },
      )) {
        stateError('decision action challenge is not a current qualified clear finding for the frozen descriptor and candidate');
      }
      const audit = currentActionCandidateAudit(state);
      if (audit === null || audit.candidate_set_hash !== actionChallengeCandidateSetHash) {
        stateError('decision action challenge candidate is not bound to the latest complete current coordinator audit');
      }
      const hasBlockingChallenge = Object.values(state.challenge_evidence).some((candidate) => (
        candidate.finding === 'blocking'
        && isDurableActionChallengeBlock(candidate, {
          scopeId: payload.action_descriptor_hash,
          candidateSetHash: actionChallengeCandidateSetHash,
          intentId: state.current_intent_id,
        })
      ));
      if (hasBlockingChallenge) {
        stateError('decision action challenge candidate has a qualified blocking finding');
      }
    } else if (catalogEntry.requires_challenge) {
      if (hasChallengeBinding) {
        stateError('an action challenge binding requires a schema_version 2 acceptance protocol');
      }
    } else if (hasChallengeBinding) {
      stateError('an action challenge binding is only allowed for a catalog action that requires challenge');
    }
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
    ...(actionChallengeId === null ? {} : {
      action_challenge_id: actionChallengeId,
      action_challenge_candidate_set_hash: actionChallengeCandidateSetHash,
    }),
    suspended: false,
    approved_uses: 0,
    ...(hasActionAuthority(state) ? { claimed_uses: 0 } : {}),
    ...(hasDelegationProtocol(state) ? { delegation_count: 0 } : {}),
    ...(hasAcceptanceProtocol(state) ? { recovery_count: 0 } : {}),
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

function validateActionClaimEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasActionAuthority(state)) stateError('action claims require an authority-enabled ledger');
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('action claims can only be minted by the fixed Owner Kernel identity');
  }
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
    'action_challenge_id',
    'action_challenge_candidate_set_hash',
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
  const hasClaimChallengeBinding = Object.prototype.hasOwnProperty.call(payload, 'action_challenge_id')
    || Object.prototype.hasOwnProperty.call(payload, 'action_challenge_candidate_set_hash');
  let actionChallengeId = null;
  let actionChallengeCandidateSetHash = null;
  if (decision.action_challenge_id) {
    if (!hasClaimChallengeBinding
      || payload.action_challenge_id !== decision.action_challenge_id
      || payload.action_challenge_candidate_set_hash !== decision.action_challenge_candidate_set_hash) {
      stateError('action claim must exactly carry the decision-frozen action challenge binding');
    }
    actionChallengeId = decision.action_challenge_id;
    actionChallengeCandidateSetHash = decision.action_challenge_candidate_set_hash;
    const challenge = state.challenge_evidence && state.challenge_evidence[actionChallengeId];
    if (!challenge || challenge.finding !== 'clear' || !isQualifiedChallengeCurrent(
      state,
      challenge,
      eventEmittedAt,
      {
        scope: 'action',
        scopeId: decision.action_descriptor_hash,
        candidateSetHash: actionChallengeCandidateSetHash,
        intentId: state.current_intent_id,
      },
    )) {
      stateError('action claim action challenge is no longer a qualified current clear finding');
    }
    const audit = currentActionCandidateAudit(state);
    if (audit === null || audit.candidate_set_hash !== actionChallengeCandidateSetHash) {
      stateError('action claim action challenge candidate is no longer bound to the latest complete current coordinator audit');
    }
    const hasBlockingChallenge = Object.values(state.challenge_evidence).some((candidate) => (
      candidate.finding === 'blocking'
      && isDurableActionChallengeBlock(candidate, {
        scopeId: decision.action_descriptor_hash,
        candidateSetHash: actionChallengeCandidateSetHash,
        intentId: state.current_intent_id,
      })
    ));
    if (hasBlockingChallenge) {
      stateError('action claim candidate has a qualified blocking action challenge');
    }
  } else if (hasClaimChallengeBinding
    && (payload.action_challenge_id !== null || payload.action_challenge_candidate_set_hash !== null)) {
    stateError('action claim challenge fields must be null when its decision has no challenge requirement');
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
    ...(actionChallengeId === null ? {} : {
      action_challenge_id: actionChallengeId,
      action_challenge_candidate_set_hash: actionChallengeCandidateSetHash,
    }),
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
    claim_event_hash: hasAcceptanceProtocol(state) ? claim.claim_event_hash : state.event_head,
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
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('action outcomes can only be minted by the fixed Owner Kernel identity');
  }
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
    'recovery_ref',
    'reconciliation_hash',
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
  if (hasAcceptanceProtocol(state)) {
    if (payload.claim_event_hash !== claim.claim_event_hash || payload.claim_witness_head !== claim.claim_witness_head) {
      stateError('action outcome must bind its exact witnessed action claim');
    }
  } else if (payload.claim_event_hash !== state.event_head || payload.claim_witness_head !== state.witness_head) {
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
  const recoveryRef = payload.recovery_ref === undefined || payload.recovery_ref === null
    ? null
    : validateReceiptRef(payload.recovery_ref, 'action_outcome evidence payload.recovery_ref', { required: true });
  const reconciliationHash = payload.reconciliation_hash === undefined || payload.reconciliation_hash === null
    ? null
    : assertHash(payload.reconciliation_hash, 'action_outcome evidence payload.reconciliation_hash').toLowerCase();
  if ((recoveryRef === null) !== (reconciliationHash === null)) {
    stateError('action outcome recovery reference and reconciliation hash must be present together');
  }
  if (payload.outcome !== 'unknown' && recoveryRef !== null) {
    stateError('only an unknown action outcome may carry durable pending-claim recovery evidence');
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
    claim_event_hash: hasAcceptanceProtocol(state) ? claim.claim_event_hash : state.event_head,
    claim_witness_head: hasAcceptanceProtocol(state) ? claim.claim_witness_head : state.witness_head,
    permit_state: permitState,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: boundaryStateVersion,
    boundary_attestation_hash: boundaryAttestation,
    effect_at: effectAt,
    cancellation,
    observed_action_descriptor_hash: observedHash,
    ...(recoveryRef === null ? {} : {
      recovery_ref: recoveryRef,
      reconciliation_hash: reconciliationHash,
    }),
    ...(payload.error_code === undefined || payload.error_code === null ? {} : { error_code: payload.error_code }),
  };
}

function validateCapabilityEvidence(payload, state, emitter, kind) {
  if (!hasActionAuthority(state)) stateError(`${kind} evidence requires an authority-enabled ledger`);
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError(`${kind} evidence can only be minted by the fixed Owner Kernel identity`);
  }
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

function assertTimestamp(value, label) {
  const normalized = assertNullableTimestamp(value, label);
  if (normalized === null) stateError(`${label} must be a UTC ISO-8601 timestamp`);
  return normalized;
}

function validateEvidenceArchive(value, label) {
  return validateReceiptRef(value, label, { required: true });
}

function actionReconciliationProof({
  run_id,
  policy_hash,
  authority_hash,
  claim_id,
  claim_event_hash,
  claim_witness_head,
  execution_permit_hash,
  original_outcome_hash,
  original_outcome_event_hash,
  original_outcome_witness_head,
  execution_authorization_hash,
  authorization_id,
  resolution,
  observed_action_descriptor_hash,
  receipt_ref,
  broker_receipt,
  boundary_effect_id,
  boundary_state_version,
  boundary_attestation_hash,
  effect_at,
  receipt_verifier_binding_hash,
  receipt_verifier_attestation_hash,
  reconciled_at,
}) {
  return {
    schema_version: 1,
    run_id,
    policy_hash,
    authority_hash,
    claim_id,
    claim_event_hash,
    claim_witness_head,
    execution_permit_hash,
    original_outcome_hash,
    original_outcome_event_hash,
    original_outcome_witness_head,
    execution_authorization_hash,
    authorization_id,
    resolution,
    observed_action_descriptor_hash,
    receipt_ref,
    broker_receipt,
    boundary_effect_id,
    boundary_state_version,
    boundary_attestation_hash,
    effect_at,
    receipt_verifier_binding_hash,
    receipt_verifier_attestation_hash,
    reconciled_at,
  };
}

function actionReconciliationHash(value) {
  return sha256(canonicalJson(actionReconciliationProof(value)));
}

function acceptanceArtifactManifest(state, value, label) {
  if (!hasAcceptanceProtocol(state)) stateError(`${label} requires a schema_version 2 acceptance contract`);
  let manifest;
  try {
    manifest = normalizeArtifactManifest(value, label);
  } catch (error) {
    stateError(error.message);
  }
  const expectedIds = state.acceptance_contract.artifacts.map((artifact) => artifact.id).sort();
  const actualIds = manifest.map((artifact) => artifact.id);
  if (canonicalJson(actualIds) !== canonicalJson(expectedIds)) {
    stateError(`${label} must contain the exact frozen acceptance artifact ID set`);
  }
  return manifest;
}

function validateVerificationEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasAcceptanceProtocol(state)) stateError('verification evidence requires a schema_version 2 acceptance contract');
  if (emitter.kind !== 'kernel' && emitter.kind !== 'runner') {
    stateError('verification evidence must be minted by the Kernel or a trusted runner');
  }
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'verification_id',
    'intent_id',
    'leg_id',
    'outcome',
    'command_hash',
    'candidate_artifacts',
    'candidate_set_hash',
    'exit_code',
    'stdout_hash',
    'stderr_hash',
    'executed_at',
    'source_attestation_hash',
    'attestation_ref',
  ]), 'verification evidence payload');
  assertString(payload.evidence_id, 'verification evidence payload.evidence_id');
  const verificationId = assertString(payload.verification_id, 'verification evidence payload.verification_id');
  if (payload.intent_id !== state.current_intent_id) {
    stateError('verification evidence must bind the current user intent');
  }
  const leg = state.acceptance_contract.legs.find((item) => item.id === payload.leg_id);
  if (!leg || leg.kind !== 'executable') stateError('verification evidence must bind an executable frozen contract leg');
  if (payload.outcome !== 'green' && payload.outcome !== 'red') {
    stateError('verification evidence outcome must be green or red');
  }
  const commandHash = assertHash(payload.command_hash, 'verification evidence payload.command_hash').toLowerCase();
  if (commandHash !== sha256(leg.command)) stateError('verification evidence command_hash does not match frozen command bytes');
  const manifest = acceptanceArtifactManifest(state, payload.candidate_artifacts, 'verification evidence payload.candidate_artifacts');
  const candidateSetHash = assertHash(payload.candidate_set_hash, 'verification evidence payload.candidate_set_hash').toLowerCase();
  if (candidateSetHash !== manifestHash(manifest)) stateError('verification evidence candidate_set_hash does not match artifact manifest');
  if (!Number.isInteger(payload.exit_code)) stateError('verification evidence exit_code must be an integer');
  if ((payload.outcome === 'green' && payload.exit_code !== 0) || (payload.outcome === 'red' && payload.exit_code === 0)) {
    stateError('verification evidence outcome must match exit_code');
  }
  assertHash(payload.stdout_hash, 'verification evidence payload.stdout_hash');
  assertHash(payload.stderr_hash, 'verification evidence payload.stderr_hash');
  const executedAt = assertTimestamp(payload.executed_at, 'verification evidence payload.executed_at');
  const sourceAttestationHash = assertNullableHash(
    payload.source_attestation_hash,
    'verification evidence payload.source_attestation_hash',
  );
  const archive = validateEvidenceArchive(payload.attestation_ref, 'verification evidence payload.attestation_ref');
  if (emitter.kind === 'runner') {
    const runner = state.acceptance_trusted_runner_roster.find((entry) => entry.identity === emitter.identity);
    if (!runner || sourceAttestationHash !== runner.attestation.sha256) {
      stateError('verification evidence runner is outside the frozen trusted-runner roster');
    }
    if (new Date(runner.attestation.issued_at).getTime() > new Date(executedAt).getTime()
      || new Date(runner.attestation.expires_at).getTime() <= new Date(executedAt).getTime()) {
      stateError('verification evidence executed_at is outside the runner attestation window');
    }
  } else if (emitter.identity !== 'owner-kernel' || sourceAttestationHash !== null) {
    stateError('Kernel verification evidence must use the owner-kernel identity');
  }
  if (new Date(executedAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('verification evidence cannot execute after it is witnessed');
  }
  return {
    verification_id: verificationId,
    intent_id: state.current_intent_id,
    leg_id: leg.id,
    outcome: payload.outcome,
    command_hash: commandHash,
    candidate_artifacts: manifest,
    candidate_set_hash: candidateSetHash,
    exit_code: payload.exit_code,
    stdout_hash: payload.stdout_hash.toLowerCase(),
    stderr_hash: payload.stderr_hash.toLowerCase(),
    executed_at: executedAt,
    source_attestation_hash: sourceAttestationHash,
    attestation_ref: archive,
  };
}

function validateChallengeEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasAcceptanceProtocol(state)) stateError('challenge evidence requires a schema_version 2 acceptance contract');
  if (emitter.kind !== 'challenger') stateError('challenge evidence must name a qualified challenger emitter');
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'challenge_id',
    'intent_id',
    'scope',
    'scope_id',
    'finding',
    'candidate_artifacts',
    'candidate_set_hash',
    'subject_identity',
    'subject_family',
    'subject_provenance_hash',
    'subject_provenance_ref',
    'result_hash',
    'reviewed_at',
    'challenger_attestation_hash',
    'attestation_ref',
  ]), 'challenge evidence payload');
  assertString(payload.evidence_id, 'challenge evidence payload.evidence_id');
  const challengeId = assertString(payload.challenge_id, 'challenge evidence payload.challenge_id');
  if (payload.intent_id !== state.current_intent_id) {
    stateError('challenge evidence must bind the current user intent');
  }
  if (state.challenge_evidence[challengeId]) stateError(`challenge evidence "${challengeId}" already exists`);
  if (payload.scope !== 'contract_leg' && payload.scope !== 'action') stateError('challenge evidence scope is invalid');
  const scopeId = assertString(payload.scope_id, 'challenge evidence payload.scope_id');
  if (payload.scope === 'contract_leg') {
    if (!state.acceptance_contract.legs.some((leg) => leg.id === scopeId)) {
      stateError('challenge evidence references an unknown acceptance contract leg');
    }
  } else if (!isSha256(scopeId)) {
    stateError('action challenge evidence scope_id must be an action descriptor hash');
  }
  if (payload.finding !== 'clear' && payload.finding !== 'blocking') {
    stateError('challenge evidence finding must be clear or blocking');
  }
  const manifest = acceptanceArtifactManifest(state, payload.candidate_artifacts, 'challenge evidence payload.candidate_artifacts');
  const candidateSetHash = assertHash(payload.candidate_set_hash, 'challenge evidence payload.candidate_set_hash').toLowerCase();
  if (candidateSetHash !== manifestHash(manifest)) stateError('challenge evidence candidate_set_hash does not match artifact manifest');
  const challenger = state.acceptance_challenger_roster.find((entry) => entry.identity === emitter.identity);
  if (!challenger) stateError('challenge evidence challenger is outside the frozen challenger roster');
  const subjectIdentity = assertString(payload.subject_identity, 'challenge evidence payload.subject_identity');
  let subjectFamily;
  try {
    subjectFamily = canonicalFamilyId(payload.subject_family, 'challenge evidence payload.subject_family');
  } catch (error) {
    stateError(error.message);
  }
  if (!state.active_principal || challenger.identity === state.active_principal.identity
    || challenger.family === state.active_principal.family || challenger.identity === subjectIdentity
    || challenger.family === subjectFamily || state.active_principal.identity === subjectIdentity
    || state.active_principal.family === subjectFamily) {
    stateError('challenge evidence is not independent from the active owner or artifact subject');
  }
  const reviewedAt = assertTimestamp(payload.reviewed_at, 'challenge evidence payload.reviewed_at');
  if (new Date(challenger.attestation.issued_at).getTime() > new Date(reviewedAt).getTime()
    || new Date(challenger.attestation.expires_at).getTime() <= new Date(reviewedAt).getTime()) {
    stateError('challenge evidence reviewed_at is outside the challenger attestation window');
  }
  if (new Date(reviewedAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('challenge evidence cannot be reviewed after it is witnessed');
  }
  const resultHash = assertHash(payload.result_hash, 'challenge evidence payload.result_hash').toLowerCase();
  if (payload.challenger_attestation_hash !== challenger.attestation.sha256) {
    stateError('challenge evidence attestation does not match the frozen challenger roster');
  }
  const archive = validateEvidenceArchive(payload.attestation_ref, 'challenge evidence payload.attestation_ref');
  const subjectProvenanceHash = assertHash(
    payload.subject_provenance_hash,
    'challenge evidence subject_provenance_hash',
  ).toLowerCase();
  const subjectProvenanceRef = validateEvidenceArchive(
    payload.subject_provenance_ref,
    'challenge evidence subject_provenance_ref',
  );
  return {
    challenge_id: challengeId,
    intent_id: state.current_intent_id,
    scope: payload.scope,
    scope_id: scopeId,
    finding: payload.finding,
    candidate_artifacts: manifest,
    candidate_set_hash: candidateSetHash,
    subject_identity: subjectIdentity,
    subject_family: subjectFamily,
    subject_provenance_hash: subjectProvenanceHash,
    subject_provenance_ref: subjectProvenanceRef,
    result_hash: resultHash,
    reviewed_at: reviewedAt,
    challenger_identity: challenger.identity,
    challenger_attestation_hash: challenger.attestation.sha256,
    attestation_ref: archive,
  };
}

function validateAuditReconciliationEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasAcceptanceProtocol(state)) stateError('audit reconciliation requires a schema_version 2 acceptance contract');
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('audit reconciliation must be Kernel-witnessed');
  }
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'audit_head',
    'intent_id',
    'candidate_artifacts',
    'candidate_set_hash',
    'complete',
    'action_claim_ids',
    'action_footprint_hash',
    'evaluated_event_head',
    'evaluated_witness_head',
    'coordinator_binding_hash',
    'coordinator_attestation_hash',
    'attestation_ref',
    'observed_at',
  ]), 'audit reconciliation evidence payload');
  assertString(payload.evidence_id, 'audit reconciliation evidence payload.evidence_id');
  if (payload.coordinator_binding_hash !== state.acceptance_authority_hash
    || payload.coordinator_attestation_hash !== state.acceptance_authority_binding.attestation_hash) {
    stateError('audit reconciliation is not bound to the intake-frozen acceptance coordinator');
  }
  const auditHead = assertHash(payload.audit_head, 'audit reconciliation evidence payload.audit_head').toLowerCase();
  if (payload.intent_id !== state.current_intent_id) {
    stateError('audit reconciliation must bind the current user intent');
  }
  if (state.audit_reconciliations[auditHead]) stateError('audit reconciliation evidence audit_head already exists');
  const manifest = acceptanceArtifactManifest(state, payload.candidate_artifacts, 'audit reconciliation evidence payload.candidate_artifacts');
  const candidateSetHash = assertHash(payload.candidate_set_hash, 'audit reconciliation evidence payload.candidate_set_hash').toLowerCase();
  if (candidateSetHash !== manifestHash(manifest)) stateError('audit reconciliation candidate_set_hash does not match artifact manifest');
  if (payload.complete !== true) stateError('audit reconciliation must attest complete normalized coverage');
  if (!Array.isArray(payload.action_claim_ids)) stateError('audit reconciliation action_claim_ids must be an array');
  const claimed = [...new Set(payload.action_claim_ids)].sort();
  if (claimed.length !== payload.action_claim_ids.length || claimed.some((value) => typeof value !== 'string' || value.length === 0)) {
    stateError('audit reconciliation action_claim_ids must be unique non-empty strings');
  }
  const expectedClaims = Object.keys(state.action_claims || {}).sort();
  if (canonicalJson(claimed) !== canonicalJson(expectedClaims)) {
    stateError('audit reconciliation must account for every observed action claim exactly once');
  }
  const footprintHash = assertHash(
    payload.action_footprint_hash,
    'audit reconciliation action_footprint_hash',
  ).toLowerCase();
  if (footprintHash !== actionFootprintHash(state)) {
    stateError('audit reconciliation action footprint does not match the witnessed control state');
  }
  const evaluatedEventHead = assertNullableHash(
    payload.evaluated_event_head,
    'audit reconciliation evaluated_event_head',
  );
  const evaluatedWitnessHead = assertNullableHash(
    payload.evaluated_witness_head,
    'audit reconciliation evaluated_witness_head',
  );
  if (evaluatedEventHead !== state.event_head || evaluatedWitnessHead !== state.witness_head) {
    stateError('audit reconciliation must bind the exact witnessed control head it covers');
  }
  const archive = validateEvidenceArchive(payload.attestation_ref, 'audit reconciliation evidence payload.attestation_ref');
  const observedAt = assertTimestamp(payload.observed_at, 'audit reconciliation evidence payload.observed_at');
  if (new Date(observedAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('audit reconciliation cannot be observed after it is witnessed');
  }
  return {
    audit_head: auditHead,
    intent_id: state.current_intent_id,
    candidate_artifacts: manifest,
    candidate_set_hash: candidateSetHash,
    complete: true,
    action_claim_ids: claimed,
    action_footprint_hash: footprintHash,
    evaluated_event_head: evaluatedEventHead,
    evaluated_witness_head: evaluatedWitnessHead,
    attestation_ref: archive,
    observed_at: observedAt,
  };
}

function validateActionReconciliationEvidence(payload, state, emitter, eventEmittedAt) {
  if (!hasAcceptanceProtocol(state) || !hasActionAuthority(state)) {
    stateError('action reconciliation requires an authority-enabled schema_version 2 run');
  }
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('action reconciliation must be Kernel-witnessed');
  }
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'claim_id',
    'resolution',
    'reconciliation_hash',
    'claim_event_hash',
    'claim_witness_head',
    'execution_permit_hash',
    'original_outcome_hash',
    'original_outcome_event_hash',
    'original_outcome_witness_head',
    'execution_authorization_hash',
    'authorization_id',
    'receipt_ref',
    'broker_receipt',
    'observed_action_descriptor_hash',
    'boundary_effect_id',
    'boundary_state_version',
    'boundary_attestation_hash',
    'effect_at',
    'receipt_verifier_binding_hash',
    'receipt_verifier_attestation_hash',
    'attestation_ref',
    'reconciled_at',
  ]), 'action reconciliation evidence payload');
  assertString(payload.evidence_id, 'action reconciliation evidence payload.evidence_id');
  const claimId = assertString(payload.claim_id, 'action reconciliation evidence payload.claim_id');
  const claim = state.action_claims[claimId];
  if (!claim || claim.outcome !== 'unknown' || state.action_reconciliations[payload.claim_id]) {
    stateError('action reconciliation may only resolve one durably unknown claim');
  }
  const outcome = state.action_outcomes[claimId];
  if (!outcome || outcome.outcome !== 'unknown'
    || !isSha256(outcome.outcome_event_hash) || !isSha256(outcome.outcome_witness_head)) {
    stateError('action reconciliation requires one witnessed unknown action outcome');
  }
  if (outcome.cancellation
    && (outcome.cancellation.state === 'revoked' || outcome.cancellation.state === 'not_started')) {
    stateError('action reconciliation cannot contradict a confirmed no-effect cancellation');
  }
  if (payload.resolution !== 'succeeded') {
    stateError('action reconciliation may only attest an independently proven success');
  }
  const claimEventHash = assertHash(payload.claim_event_hash, 'action reconciliation evidence payload.claim_event_hash').toLowerCase();
  const claimWitnessHead = assertHash(payload.claim_witness_head, 'action reconciliation evidence payload.claim_witness_head').toLowerCase();
  if (claimEventHash !== claim.claim_event_hash || claimWitnessHead !== claim.claim_witness_head) {
    stateError('action reconciliation must bind the exact witnessed action claim');
  }
  const executionPermitHash = assertHash(
    payload.execution_permit_hash,
    'action reconciliation evidence payload.execution_permit_hash',
  ).toLowerCase();
  if (executionPermitHash !== claim.execution_permit_hash) {
    stateError('action reconciliation execution permit does not match its original claim');
  }
  const originalOutcomeHash = assertHash(
    payload.original_outcome_hash,
    'action reconciliation evidence payload.original_outcome_hash',
  ).toLowerCase();
  if (originalOutcomeHash !== sha256(canonicalJson(outcome))) {
    stateError('action reconciliation does not bind the exact prior unknown outcome');
  }
  const originalOutcomeEventHash = assertHash(
    payload.original_outcome_event_hash,
    'action reconciliation evidence payload.original_outcome_event_hash',
  ).toLowerCase();
  const originalOutcomeWitnessHead = assertHash(
    payload.original_outcome_witness_head,
    'action reconciliation evidence payload.original_outcome_witness_head',
  ).toLowerCase();
  if (originalOutcomeEventHash !== outcome.outcome_event_hash
    || originalOutcomeWitnessHead !== outcome.outcome_witness_head) {
    stateError('action reconciliation does not bind the witnessed prior unknown outcome record');
  }
  const authorizationHash = assertHash(
    payload.execution_authorization_hash,
    'action reconciliation evidence payload.execution_authorization_hash',
  ).toLowerCase();
  const authorizationId = assertProtocolToken(
    payload.authorization_id,
    'action reconciliation evidence payload.authorization_id',
  );
  if (outcome.execution_authorization_hash === null || outcome.authorization_id === null
    || outcome.execution_authorization_hash !== authorizationHash
    || outcome.authorization_id !== authorizationId) {
    stateError('action reconciliation authorization does not match the original unknown outcome');
  }
  const observed = assertNullableHash(
    payload.observed_action_descriptor_hash,
    'action reconciliation evidence payload.observed_action_descriptor_hash',
  );
  if (observed !== claim.action_descriptor_hash) {
    stateError('action reconciliation must exactly match its frozen descriptor');
  }
  const receipt = validateReceiptRef(
    payload.receipt_ref,
    'action reconciliation evidence payload.receipt_ref',
    { required: true },
  );
  if (!receiptIsWithinBrokerRoot(receipt, state.authority_broker)) {
    stateError('action reconciliation receipt is outside the intake-frozen broker receipt root');
  }
  const brokerReceipt = validateBrokerReceipt(
    payload.broker_receipt,
    state,
    'action reconciliation evidence payload.broker_receipt',
    { required: state.authority_broker !== null },
  );
  const boundaryEffectId = assertProtocolToken(
    payload.boundary_effect_id,
    'action reconciliation evidence payload.boundary_effect_id',
  );
  const boundaryStateVersion = assertInteger(
    payload.boundary_state_version,
    'action reconciliation evidence payload.boundary_state_version',
  );
  const expectedBoundaryAttestation = state.authority_broker === null
    ? state.authority_executor_attestation_hash
    : state.authority_broker.attestation_hash;
  const boundaryAttestationHash = assertHash(
    payload.boundary_attestation_hash,
    'action reconciliation evidence payload.boundary_attestation_hash',
  ).toLowerCase();
  if (boundaryAttestationHash !== expectedBoundaryAttestation) {
    stateError('action reconciliation boundary attestation does not match the intake-frozen execution boundary');
  }
  const effectAt = assertTimestamp(payload.effect_at, 'action reconciliation evidence payload.effect_at');
  if (outcome.cancellation && outcome.cancellation.state === 'completed'
    && (outcome.cancellation.boundary_effect_id !== boundaryEffectId
      || outcome.cancellation.boundary_state_version > boundaryStateVersion
      || outcome.cancellation.effect_at !== effectAt)) {
    stateError('action reconciliation must preserve the completed cancellation boundary effect ordering');
  }
  const receiptVerifierBindingHash = assertHash(
    payload.receipt_verifier_binding_hash,
    'action reconciliation evidence payload.receipt_verifier_binding_hash',
  ).toLowerCase();
  const receiptVerifierAttestationHash = assertHash(
    payload.receipt_verifier_attestation_hash,
    'action reconciliation evidence payload.receipt_verifier_attestation_hash',
  ).toLowerCase();
  if (receiptVerifierBindingHash !== state.authority_receipt_verifier_binding_hash
    || receiptVerifierAttestationHash !== state.authority_receipt_verifier_attestation_hash) {
    stateError('action reconciliation is not bound to the intake-frozen receipt verifier');
  }
  const reconciledAt = assertTimestamp(payload.reconciled_at, 'action reconciliation evidence payload.reconciled_at');
  if (new Date(effectAt).getTime() > new Date(reconciledAt).getTime()
    || new Date(reconciledAt).getTime() > new Date(eventEmittedAt).getTime()) {
    stateError('action reconciliation effect and reconciliation timestamps must precede the witnessed evidence');
  }
  const reconciliationHash = assertHash(
    payload.reconciliation_hash,
    'action reconciliation evidence payload.reconciliation_hash',
  ).toLowerCase();
  const expectedReconciliationHash = actionReconciliationHash({
    run_id: state.run_id,
    policy_hash: state.policy_hash,
    authority_hash: state.authority_hash,
    claim_id: claimId,
    claim_event_hash: claimEventHash,
    claim_witness_head: claimWitnessHead,
    execution_permit_hash: executionPermitHash,
    original_outcome_hash: originalOutcomeHash,
    original_outcome_event_hash: originalOutcomeEventHash,
    original_outcome_witness_head: originalOutcomeWitnessHead,
    execution_authorization_hash: authorizationHash,
    authorization_id: authorizationId,
    resolution: payload.resolution,
    observed_action_descriptor_hash: observed,
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: boundaryStateVersion,
    boundary_attestation_hash: boundaryAttestationHash,
    effect_at: effectAt,
    receipt_verifier_binding_hash: receiptVerifierBindingHash,
    receipt_verifier_attestation_hash: receiptVerifierAttestationHash,
    reconciled_at: reconciledAt,
  });
  if (reconciliationHash !== expectedReconciliationHash) {
    stateError('action reconciliation hash does not match its complete immutable proof');
  }
  return {
    claim_id: claimId,
    resolution: payload.resolution,
    reconciliation_hash: reconciliationHash,
    claim_event_hash: claimEventHash,
    claim_witness_head: claimWitnessHead,
    execution_permit_hash: executionPermitHash,
    original_outcome_hash: originalOutcomeHash,
    original_outcome_event_hash: originalOutcomeEventHash,
    original_outcome_witness_head: originalOutcomeWitnessHead,
    execution_authorization_hash: authorizationHash,
    authorization_id: authorizationId,
    receipt_ref: receipt,
    broker_receipt: brokerReceipt,
    observed_action_descriptor_hash: observed,
    boundary_effect_id: boundaryEffectId,
    boundary_state_version: boundaryStateVersion,
    boundary_attestation_hash: boundaryAttestationHash,
    effect_at: effectAt,
    receipt_verifier_binding_hash: receiptVerifierBindingHash,
    receipt_verifier_attestation_hash: receiptVerifierAttestationHash,
    attestation_ref: validateEvidenceArchive(payload.attestation_ref, 'action reconciliation evidence payload.attestation_ref'),
    reconciled_at: reconciledAt,
  };
}

function validateAcceptanceFailureEvidence(payload, state, emitter) {
  if (!hasAcceptanceProtocol(state) || emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel') {
    stateError('acceptance failure evidence must be Kernel-witnessed in a schema_version 2 run');
  }
  assertOnlyKeys(payload, new Set([
    'evidence_id',
    'evidence_kind',
    'failure_id',
    'disposition',
    'reasons',
    'snapshot_hash',
    'candidate_set_hash',
    'audit_head',
  ]), 'acceptance failure evidence payload');
  assertString(payload.evidence_id, 'acceptance failure evidence payload.evidence_id');
  const failureId = assertString(payload.failure_id, 'acceptance failure evidence payload.failure_id');
  if (state.acceptance_failures[failureId]) stateError(`acceptance failure "${failureId}" already exists`);
  if (payload.disposition !== 'recover' && payload.disposition !== 'blocked') {
    stateError('acceptance failure disposition must be recover or blocked');
  }
  if (!Array.isArray(payload.reasons) || payload.reasons.length === 0
    || payload.reasons.some((reason) => typeof reason !== 'string' || reason.length === 0)) {
    stateError('acceptance failure reasons must be a non-empty string array');
  }
  const reasons = [...new Set(payload.reasons)].sort();
  if (reasons.length !== payload.reasons.length) stateError('acceptance failure reasons must be unique');
  return {
    failure_id: failureId,
    disposition: payload.disposition,
    reasons,
    snapshot_hash: assertHash(payload.snapshot_hash, 'acceptance failure evidence payload.snapshot_hash').toLowerCase(),
    candidate_set_hash: assertHash(payload.candidate_set_hash, 'acceptance failure evidence payload.candidate_set_hash').toLowerCase(),
    audit_head: assertHash(payload.audit_head, 'acceptance failure evidence payload.audit_head').toLowerCase(),
  };
}

function validateEvidencePayload(payload, state, emitter, eventEmittedAt) {
  assertObject(payload, 'evidence payload');
  const kind = payload.evidence_kind;
  if (kind === 'action_claim') return { kind, value: validateActionClaimEvidence(payload, state, emitter, eventEmittedAt) };
  if (kind === 'action_outcome') {
    return { kind, value: validateActionOutcomeEvidence(payload, state, emitter, eventEmittedAt) };
  }
  if (kind === 'capability_regression' || kind === 'capability_revalidated') {
    validateCapabilityEvidence(payload, state, emitter, kind);
    return { kind, value: null };
  }
  if (kind === 'verification') return { kind, value: validateVerificationEvidence(payload, state, emitter, eventEmittedAt) };
  if (kind === 'challenge') return { kind, value: validateChallengeEvidence(payload, state, emitter, eventEmittedAt) };
  if (kind === 'audit_reconciliation') {
    return { kind, value: validateAuditReconciliationEvidence(payload, state, emitter, eventEmittedAt) };
  }
  if (kind === 'action_reconciliation') return { kind, value: validateActionReconciliationEvidence(payload, state, emitter, eventEmittedAt) };
  if (kind === 'acceptance_failure') return { kind, value: validateAcceptanceFailureEvidence(payload, state, emitter) };
  assertOnlyKeys(payload, new Set(['evidence_id', 'attestation_ref', 'artifact_hashes']), 'evidence payload');
  assertString(payload.evidence_id, 'evidence payload.evidence_id');
  const ref = assertObject(payload.attestation_ref, 'evidence payload.attestation_ref');
  assertOnlyKeys(ref, new Set(['uri', 'sha256']), 'evidence payload.attestation_ref');
  assertString(ref.uri, 'evidence payload.attestation_ref.uri');
  assertHash(ref.sha256, 'evidence payload.attestation_ref.sha256');
  assertArrayOfHashes(payload.artifact_hashes, 'evidence payload.artifact_hashes');
  return { kind: 'generic', value: null };
}

function validateAbortPayload(payload, state, emitter) {
  assertObject(payload, 'abort payload');
  assertOnlyKeys(payload, new Set(['reason']), 'abort payload');
  assertString(payload.reason, 'abort payload.reason');
  if (emitter.kind === 'kernel' && payload.reason !== 'blocked_timeout') {
    stateError('kernel abort may only represent blocked_timeout');
  }
  if (hasAcceptanceProtocol(state) && state.acceptance_attempt
    && state.acceptance_attempt.status === 'pending') {
    stateError('terminal abort requires a coordinator-finalized acceptance attempt');
  }
}

function validateTerminalControlPayload(payload, state, emitter) {
  if (!hasAcceptanceProtocol(state) || state.status !== 'complete' || state.terminal_reason !== 'accepted'
    || emitter.kind !== 'user') {
    stateError('terminal_control is only allowed for a user abort observed after accepted completion');
  }
  assertObject(payload, 'terminal_control payload');
  assertOnlyKeys(payload, new Set([
    'control_id',
    'kind',
    'reason',
    'envelope_hash',
    'attempt_id',
    'attempt_hash',
    'acceptance_id',
    'coordinator_commitment_hash',
  ]), 'terminal_control payload');
  const controlId = assertString(payload.control_id, 'terminal_control payload.control_id');
  if (state.terminal_controls.some((control) => control.control_id === controlId)) {
    stateError(`terminal_control "${controlId}" already exists`);
  }
  if (payload.kind !== 'late_user_abort') stateError('terminal_control kind is invalid');
  if (!state.acceptance || !state.acceptance_attempt
    || state.acceptance_attempt.status !== 'accepted'
    || payload.attempt_id !== state.acceptance_attempt.attempt_id
    || payload.attempt_hash !== state.acceptance_attempt.attempt_hash
    || payload.acceptance_id !== state.acceptance.acceptance_id) {
    stateError('terminal_control does not bind the accepted attempt');
  }
  const commitmentHash = assertHash(
    payload.coordinator_commitment_hash,
    'terminal_control payload.coordinator_commitment_hash',
  ).toLowerCase();
  if (!state.acceptance.coordinator_commitment
    || commitmentHash !== sha256(canonicalJson(state.acceptance.coordinator_commitment))) {
    stateError('terminal_control does not bind the accepted coordinator commitment');
  }
  return {
    control_id: controlId,
    kind: 'late_user_abort',
    reason: assertString(payload.reason, 'terminal_control payload.reason'),
    envelope_hash: assertHash(payload.envelope_hash, 'terminal_control payload.envelope_hash').toLowerCase(),
    attempt_id: state.acceptance_attempt.attempt_id,
    attempt_hash: state.acceptance_attempt.attempt_hash,
    acceptance_id: state.acceptance.acceptance_id,
    coordinator_commitment_hash: commitmentHash,
    identity: emitter.identity,
    channel: emitter.channel,
  };
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
  assertOnlyKeys(payload, new Set([
    'translation_id',
    'invocation_id',
    'source',
    'target',
    'source_detail',
    'target_detail',
  ]), 'translation_used payload');
  assertProtocolToken(payload.translation_id, 'translation_used payload.translation_id');
  if (Object.prototype.hasOwnProperty.call(payload, 'invocation_id')) {
    assertProtocolToken(payload.invocation_id, 'translation_used payload.invocation_id');
  }
  assertHash(payload.source, 'translation_used payload.source');
  assertHash(payload.target, 'translation_used payload.target');
  const hasSourceDetail = Object.prototype.hasOwnProperty.call(payload, 'source_detail');
  const hasTargetDetail = Object.prototype.hasOwnProperty.call(payload, 'target_detail');
  if (hasSourceDetail !== hasTargetDetail) {
    stateError('translation_used payload details must include both source_detail and target_detail');
  }
  if (hasSourceDetail) {
    assertObject(payload.source_detail, 'translation_used payload.source_detail');
    assertObject(payload.target_detail, 'translation_used payload.target_detail');
    if (sha256(canonicalJson(payload.source_detail)) !== payload.source.toLowerCase()
      || sha256(canonicalJson(payload.target_detail)) !== payload.target.toLowerCase()) {
      stateError('translation_used payload detail hashes do not match source and target');
    }
  }
}

function validateDelegationPayload(payload, state, policy, emitter) {
  if (!hasDelegationProtocol(state)) {
    stateError('delegation requires acceptance authority or semantic delegation authority');
  }
  assertObject(payload, 'delegation payload');
  assertOnlyKeys(payload, new Set([
    'delegation_id',
    'decision_id',
    'decision_content_hash',
    'dispatch_hash',
    'worker_identity',
    'worker_family',
    'delegation_count',
  ]), 'delegation payload');
  const delegationId = assertString(payload.delegation_id, 'delegation payload.delegation_id');
  if (state.delegations[delegationId]) stateError(`delegation "${delegationId}" already exists`);
  const decision = state.decisions[payload.decision_id];
  if (!decision || decision.suspended || decision.intent_id !== state.current_intent_id) {
    stateError('delegation must bind a current unsuspended decision');
  }
  if (!state.active_principal || emitter.kind !== 'owner'
    || emitter.identity !== state.active_principal.identity
    || emitter.identity !== decision.principal_id) {
    stateError('delegation emitter must equal the current decision owner');
  }
  if (payload.decision_content_hash !== decision.decision_content_hash) {
    stateError('delegation decision_content_hash does not match current decision');
  }
  if (decision.delegation_count >= policy.max_delegate_per_decision) {
    stateError('delegation budget is exhausted; a new authenticated decision is required');
  }
  if (payload.delegation_count !== decision.delegation_count + 1) {
    stateError('delegation_count must increase monotonically for the decision');
  }
  return {
    delegation_id: delegationId,
    decision_id: decision.decision_id,
    dispatch_hash: assertHash(payload.dispatch_hash, 'delegation payload.dispatch_hash').toLowerCase(),
    worker_identity: assertString(payload.worker_identity, 'delegation payload.worker_identity'),
    worker_family: assertString(payload.worker_family, 'delegation payload.worker_family'),
    delegation_count: payload.delegation_count,
    exhausted: payload.delegation_count >= policy.max_delegate_per_decision,
  };
}

function validateRecoveryPayload(payload, state, policy, emitter) {
  if (!hasAcceptanceProtocol(state)) stateError('recovery requires a schema_version 2 acceptance contract');
  assertObject(payload, 'recovery payload');
  assertOnlyKeys(payload, new Set([
    'recovery_id',
    'decision_id',
    'decision_content_hash',
    'reason',
    'source_evidence_ids',
    'recovery_count',
  ]), 'recovery payload');
  const recoveryId = assertString(payload.recovery_id, 'recovery payload.recovery_id');
  if (state.recoveries[recoveryId]) stateError(`recovery "${recoveryId}" already exists`);
  const decision = state.decisions[payload.decision_id];
  if (!decision || decision.suspended || decision.intent_id !== state.current_intent_id) {
    stateError('recovery must bind a current unsuspended decision');
  }
  if (!state.active_principal || emitter.kind !== 'owner'
    || emitter.identity !== state.active_principal.identity
    || emitter.identity !== decision.principal_id) {
    stateError('recovery emitter must equal the current decision owner');
  }
  if (payload.decision_content_hash !== decision.decision_content_hash) {
    stateError('recovery decision_content_hash does not match current decision');
  }
  if (decision.recovery_count >= policy.max_recover_cycles) {
    stateError('recovery budget is exhausted; a new authenticated decision is required');
  }
  if (payload.recovery_count !== decision.recovery_count + 1) {
    stateError('recovery_count must increase monotonically for the decision');
  }
  if (!Array.isArray(payload.source_evidence_ids) || payload.source_evidence_ids.length === 0) {
    stateError('recovery source_evidence_ids must be a non-empty array');
  }
  const sourceEvidenceIds = [...new Set(payload.source_evidence_ids)].sort();
  if (sourceEvidenceIds.length !== payload.source_evidence_ids.length
    || sourceEvidenceIds.some((value) => typeof value !== 'string' || value.length === 0)) {
    stateError('recovery source_evidence_ids must be unique non-empty strings');
  }
  return {
    recovery_id: recoveryId,
    decision_id: decision.decision_id,
    reason: assertString(payload.reason, 'recovery payload.reason'),
    source_evidence_ids: sourceEvidenceIds,
    recovery_count: payload.recovery_count,
    exhausted: payload.recovery_count >= policy.max_recover_cycles,
  };
}

function validateAbortRequestPayload(payload, state, emitter) {
  if (!hasAcceptanceProtocol(state) || emitter.kind !== 'user') {
    stateError('abort_request requires a schema_version 2 run and authenticated user emitter');
  }
  assertObject(payload, 'abort_request payload');
  assertOnlyKeys(payload, new Set(['reason', 'envelope_hash']), 'abort_request payload');
  if (state.abort_request !== null) stateError('only one unresolved authenticated abort_request may exist');
  return {
    reason: assertString(payload.reason, 'abort_request payload.reason'),
    envelope_hash: assertHash(payload.envelope_hash, 'abort_request payload.envelope_hash').toLowerCase(),
    identity: emitter.identity,
    channel: emitter.channel,
  };
}

function acceptanceAttemptHash(state, {
  attemptId,
  expectedEventHead,
  expectedWitnessHead,
  intentId,
  attemptStartedAt,
}) {
  return sha256(canonicalJson({
    run_id: state.run_id,
    policy_hash: state.policy_hash,
    contract_hash: state.contract_hash,
    coordinator_binding_hash: state.acceptance_authority_hash,
    attempt_id: attemptId,
    expected_event_head: expectedEventHead,
    expected_witness_head: expectedWitnessHead,
    intent_id: intentId,
    attempt_started_at: attemptStartedAt,
  }));
}

function validateAcceptanceAttemptPayload(payload, state, event) {
  if (!hasAcceptanceProtocol(state)) stateError('acceptance_attempt requires a schema_version 2 acceptance contract');
  assertV2AcceptanceEmitter(event.emitter, state);
  if (state.acceptance_attempt && state.acceptance_attempt.status === 'pending') {
    stateError('a serializable acceptance attempt is already pending');
  }
  if (state.status !== 'decide' && state.status !== 'observe') {
    stateError('acceptance_attempt may only begin from decide or observe');
  }
  assertObject(payload, 'acceptance_attempt payload');
  assertOnlyKeys(payload, new Set([
    'attempt_id',
    'attempt_hash',
    'coordinator_binding_hash',
    'expected_event_head',
    'expected_witness_head',
    'intent_id',
    'attempt_started_at',
  ]), 'acceptance_attempt payload');
  const attemptId = assertProtocolToken(payload.attempt_id, 'acceptance_attempt payload.attempt_id');
  const attemptHash = assertHash(payload.attempt_hash, 'acceptance_attempt payload.attempt_hash').toLowerCase();
  const attemptStartedAt = assertTimestamp(
    payload.attempt_started_at,
    'acceptance_attempt payload.attempt_started_at',
  );
  if (payload.coordinator_binding_hash !== state.acceptance_authority_hash
    || payload.expected_event_head !== state.event_head
    || payload.expected_witness_head !== state.witness_head
    || payload.intent_id !== state.current_intent_id) {
    stateError('acceptance_attempt is not bound to the current coordinator, intent, and witness heads');
  }
  const expected = acceptanceAttemptHash(state, {
    attemptId,
    expectedEventHead: state.event_head,
    expectedWitnessHead: state.witness_head,
    intentId: state.current_intent_id,
    attemptStartedAt,
  });
  if (attemptHash !== expected) stateError('acceptance_attempt hash does not match its frozen control binding');
  return {
    attempt_id: attemptId,
    attempt_hash: attemptHash,
    coordinator_binding_hash: state.acceptance_authority_hash,
    expected_event_head: state.event_head,
    expected_witness_head: state.witness_head,
    intent_id: state.current_intent_id,
    attempt_started_at: attemptStartedAt,
    status: 'pending',
  };
}

function validateAcceptanceResolutionPayload(payload, state, event) {
  if (!hasAcceptanceProtocol(state)) stateError('acceptance_resolution requires a schema_version 2 acceptance contract');
  assertV2AcceptanceEmitter(event.emitter, state);
  const attempt = state.acceptance_attempt;
  if (!attempt || attempt.status !== 'pending') {
    stateError('acceptance_resolution requires one pending serializable acceptance attempt');
  }
  assertObject(payload, 'acceptance_resolution payload');
  assertOnlyKeys(payload, new Set([
    'attempt_id',
    'attempt_hash',
    'disposition',
    'resolution_hash',
    'coordinator_resolution',
  ]), 'acceptance_resolution payload');
  if (payload.attempt_id !== attempt.attempt_id || payload.attempt_hash !== attempt.attempt_hash) {
    stateError('acceptance_resolution does not bind the pending attempt');
  }
  if (!['released', 'cancelled', 'aborted'].includes(payload.disposition)) {
    stateError('acceptance_resolution disposition is invalid');
  }
  const coordinatorResolution = assertObject(
    payload.coordinator_resolution,
    'acceptance_resolution payload.coordinator_resolution',
  );
  assertOnlyKeys(coordinatorResolution, new Set([
    'protocol_version',
    'run_id',
    'coordinator_binding_hash',
    'attempt_id',
    'attempt_hash',
    'transaction_id',
    'fence',
    'disposition',
    'issued_at',
    'attestation_hash',
    'signature',
  ]), 'acceptance_resolution payload.coordinator_resolution');
  if (coordinatorResolution.protocol_version !== 1
    || coordinatorResolution.run_id !== state.run_id
    || coordinatorResolution.coordinator_binding_hash !== state.acceptance_authority_hash
    || coordinatorResolution.attempt_id !== attempt.attempt_id
    || coordinatorResolution.attempt_hash !== attempt.attempt_hash
    || coordinatorResolution.disposition !== payload.disposition
    || coordinatorResolution.attestation_hash !== state.acceptance_authority_binding.attestation_hash
    || typeof coordinatorResolution.signature !== 'string' || coordinatorResolution.signature.length === 0) {
    stateError('acceptance_resolution coordinator commitment is not bound to the pending coordinator attempt');
  }
  if (coordinatorResolution.transaction_id !== null) {
    assertProtocolToken(coordinatorResolution.transaction_id, 'acceptance_resolution coordinator transaction_id');
  }
  if (coordinatorResolution.fence !== null) {
    assertHash(coordinatorResolution.fence, 'acceptance_resolution coordinator fence');
  }
  assertTimestamp(coordinatorResolution.issued_at, 'acceptance_resolution coordinator issued_at');
  const resolutionHash = assertHash(
    payload.resolution_hash,
    'acceptance_resolution payload.resolution_hash',
  ).toLowerCase();
  if (resolutionHash !== sha256(canonicalJson(coordinatorResolution))) {
    stateError('acceptance_resolution hash does not match its coordinator commitment');
  }
  return {
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    disposition: payload.disposition,
    resolution_hash: resolutionHash,
    coordinator_resolution: cloneCanonical(coordinatorResolution),
  };
}

function acceptancePredicateHash(state, snapshot, legProjectionHash, disclosureHash) {
  return sha256(canonicalJson({
    predicate_version: 1,
    evaluated_event_head: snapshot.control_event_head,
    evaluated_witness_head: snapshot.control_witness_head,
    candidate_set_hash: snapshot.candidate_set_hash,
    delivered_set_hash: snapshot.delivered_set_hash,
    audit_head: snapshot.audit_head,
    intent_id: snapshot.intent_id,
    leg_projection_hash: legProjectionHash,
    disclosure_hash: disclosureHash,
    principal_id: state.active_principal.identity,
    principal_attestation_hash: state.active_principal.attestation.sha256,
  }));
}

function validateLegacyAcceptancePayload(payload, emitter) {
  if (emitter.kind !== 'kernel' && emitter.kind !== 'runner') {
    stateError('legacy acceptance must be minted by the Kernel or a trusted runner');
  }
  assertObject(payload, 'legacy acceptance payload');
  assertOnlyKeys(payload, new Set(['acceptance_id', 'candidate_hashes']), 'legacy acceptance payload');
  assertString(payload.acceptance_id, 'legacy acceptance payload.acceptance_id');
  assertArrayOfHashes(payload.candidate_hashes, 'legacy acceptance payload.candidate_hashes');
}

function assertV2AcceptanceEmitter(emitter, state) {
  if (emitter.kind !== 'kernel' || emitter.identity !== 'owner-kernel'
    || emitter.channel !== `kernel-acceptance:${state.acceptance_authority_binding.identity}`) {
    stateError('serializable acceptance events must be minted by the bound Owner Kernel acceptance channel');
  }
}

function validateCoordinatorCommitment(value, state, witness) {
  const commitment = assertObject(value, 'serializable acceptance coordinator commitment');
  assertOnlyKeys(commitment, new Set([
    'protocol_version',
    'run_id',
    'coordinator_binding_hash',
    'attempt_id',
    'attempt_hash',
    'transaction_id',
    'fence',
    'expected_event_head',
    'expected_witness_head',
    'intent_id',
    'snapshot_hash',
    'snapshot_at',
    'batch_id',
    'batch_commitment',
    'batch_event_hashes',
    'disposition',
    'issued_at',
    'attestation_hash',
    'signature',
  ]), 'serializable acceptance coordinator commitment');
  const attempt = state.acceptance_attempt;
  if (!attempt || attempt.status !== 'pending'
    || commitment.protocol_version !== 1
    || commitment.run_id !== state.run_id
    || commitment.coordinator_binding_hash !== state.acceptance_authority_hash
    || commitment.attempt_id !== attempt.attempt_id
    || commitment.attempt_hash !== attempt.attempt_hash
    || commitment.expected_event_head !== state.event_head
    || commitment.expected_witness_head !== state.witness_head
    || commitment.intent_id !== state.current_intent_id
    || commitment.batch_id !== witness.batch_id
    || commitment.batch_commitment !== witness.batch_commitment
    || canonicalJson(commitment.batch_event_hashes) !== canonicalJson(witness.batch_event_hashes)
    || commitment.disposition !== 'accepted'
    || commitment.attestation_hash !== state.acceptance_authority_binding.attestation_hash
    || typeof commitment.signature !== 'string' || commitment.signature.length === 0) {
    stateError('serializable acceptance coordinator commitment is not bound to the pending attempt and witness batch');
  }
  assertProtocolToken(commitment.transaction_id, 'serializable acceptance coordinator transaction_id');
  assertHash(commitment.fence, 'serializable acceptance coordinator fence');
  assertHash(commitment.snapshot_hash, 'serializable acceptance coordinator snapshot_hash');
  assertTimestamp(commitment.snapshot_at, 'serializable acceptance coordinator snapshot_at');
  assertTimestamp(commitment.issued_at, 'serializable acceptance coordinator issued_at');
  return cloneCanonical(commitment);
}

function validateAcceptanceBatchWitness(event, state, { complete = false, preflight = false } = {}) {
  const witness = assertObject(event.witness, 'serializable acceptance witness receipt');
  const batchId = assertString(witness.batch_id, 'serializable acceptance witness batch_id');
  const batchIndex = assertInteger(witness.batch_index, 'serializable acceptance witness batch_index', 0);
  if (witness.batch_size !== 2 || !Array.isArray(witness.batch_event_hashes)
    || witness.batch_event_hashes.length !== 2
    || witness.batch_event_hashes.some((hash) => !isSha256(hash))) {
    stateError('serializable acceptance requires a two-event atomic witness batch receipt');
  }
  const eventHashes = witness.batch_event_hashes.map((hash) => hash.toLowerCase());
  if (new Set(eventHashes).size !== 2 || !isSha256(witness.batch_commitment)) {
    stateError('serializable acceptance witness batch commitment is invalid');
  }
  if (!complete) {
    if (batchIndex !== 0 || eventHashes[0] !== event.event_hash) {
      stateError('acceptance must be the first event in its atomic witness batch');
    }
    const coordinatorCommitment = preflight
      ? null
      : validateCoordinatorCommitment(witness.coordinator_commitment, state, witness);
    return {
      batch_id: batchId,
      batch_commitment: witness.batch_commitment.toLowerCase(),
      batch_event_hashes: eventHashes,
      coordinator_commitment: coordinatorCommitment,
    };
  }
  if (batchIndex !== 1 || state.acceptance.batch_id !== batchId
    || state.acceptance.batch_commitment !== witness.batch_commitment.toLowerCase()
    || canonicalJson(state.acceptance.batch_event_hashes) !== canonicalJson(eventHashes)
    || (state.acceptance.coordinator_commitment !== null
      && canonicalJson(state.acceptance.coordinator_commitment) !== canonicalJson(witness.coordinator_commitment))
    || eventHashes[0] !== state.event_head || eventHashes[1] !== event.event_hash) {
    stateError('complete must be the second receipt in the same atomic acceptance batch');
  }
  return null;
}

function validateAcceptancePayload(payload, state, event, { preflight = false } = {}) {
  const emitter = event.emitter;
  if (!hasAcceptanceProtocol(state)) {
    validateLegacyAcceptancePayload(payload, emitter);
    return { legacy: true };
  }
  assertV2AcceptanceEmitter(emitter, state);
  const batch = validateAcceptanceBatchWitness(event, state, { preflight });
  if (state.status !== 'decide' && state.status !== 'observe') {
    stateError('acceptance may only begin from decide or observe');
  }
  assertObject(payload, 'acceptance payload');
  assertOnlyKeys(payload, new Set([
    'acceptance_id',
    'attempt_id',
    'attempt_hash',
    'attempt_started_at',
    'transaction_id',
    'coordinator_binding_hash',
    'fence',
    'snapshot_hash',
    'snapshot_at',
    'intent_id',
    'candidate_artifacts',
    'candidate_set_hash',
    'delivered_artifacts',
    'delivered_set_hash',
    'audit_head',
    'evaluated_event_head',
    'evaluated_witness_head',
    'principal_id',
    'principal_attestation_hash',
    'leg_projection_hash',
    'disclosure_hash',
    'predicate_hash',
  ]), 'acceptance payload');
  const acceptanceId = assertString(payload.acceptance_id, 'acceptance payload.acceptance_id');
  const attempt = state.acceptance_attempt;
  if (!attempt || attempt.status !== 'pending'
    || payload.attempt_id !== attempt.attempt_id
    || payload.attempt_hash !== attempt.attempt_hash
    || payload.attempt_started_at !== attempt.attempt_started_at) {
    stateError('acceptance payload does not bind the current durable acceptance attempt');
  }
  const manifest = acceptanceArtifactManifest(state, payload.candidate_artifacts, 'acceptance payload.candidate_artifacts');
  const delivered = acceptanceArtifactManifest(state, payload.delivered_artifacts, 'acceptance payload.delivered_artifacts');
  const candidateSetHash = assertHash(payload.candidate_set_hash, 'acceptance payload.candidate_set_hash').toLowerCase();
  const deliveredSetHash = assertHash(payload.delivered_set_hash, 'acceptance payload.delivered_set_hash').toLowerCase();
  if (candidateSetHash !== manifestHash(manifest) || deliveredSetHash !== manifestHash(delivered)
    || !sameManifest(manifest, delivered)) {
    stateError('acceptance payload candidate and delivered manifests are not exactly bound');
  }
  if (payload.evaluated_event_head !== state.event_head || payload.evaluated_witness_head !== state.witness_head) {
    stateError('acceptance payload does not bind the exact latest witnessed ledger head');
  }
  if (payload.coordinator_binding_hash !== state.acceptance_authority_hash) {
    stateError('acceptance coordinator binding does not match the intake-frozen authority');
  }
  if (payload.principal_id !== state.active_principal.identity
    || payload.principal_attestation_hash !== state.active_principal.attestation.sha256) {
    stateError('acceptance payload principal is not the active qualified principal');
  }
  const snapshot = {
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    intent_id: assertProtocolToken(payload.intent_id, 'acceptance payload.intent_id'),
    transaction_id: assertString(payload.transaction_id, 'acceptance payload.transaction_id'),
    fence: assertHash(payload.fence, 'acceptance payload.fence').toLowerCase(),
    snapshot_hash: assertHash(payload.snapshot_hash, 'acceptance payload.snapshot_hash').toLowerCase(),
    snapshot_at: assertTimestamp(payload.snapshot_at, 'acceptance payload.snapshot_at'),
    candidate_artifacts: manifest,
    candidate_set_hash: candidateSetHash,
    delivered_artifacts: delivered,
    delivered_set_hash: deliveredSetHash,
    audit_head: assertHash(payload.audit_head, 'acceptance payload.audit_head').toLowerCase(),
    control_event_head: state.event_head,
    control_witness_head: state.witness_head,
  };
  if (snapshot.intent_id !== attempt.intent_id || snapshot.intent_id !== state.current_intent_id) {
    stateError('acceptance snapshot does not bind the current durable intent');
  }
  const snapshotAt = new Date(snapshot.snapshot_at).getTime();
  if (snapshotAt < new Date(attempt.attempt_started_at).getTime()
    || snapshotAt > new Date(event.emitted_at).getTime()) {
    stateError('acceptance snapshot_at is outside the durable attempt and terminal event window');
  }
  const { snapshot_hash: suppliedSnapshotHash, ...snapshotForHash } = snapshot;
  const expectedSnapshotHash = sha256(canonicalJson({ run_id: state.run_id, ...snapshotForHash }));
  if (suppliedSnapshotHash !== expectedSnapshotHash) {
    stateError('acceptance payload snapshot_hash does not match the coordinator-bound snapshot');
  }
  const coordinatorCommitment = batch.coordinator_commitment;
  if (coordinatorCommitment !== null && (coordinatorCommitment.transaction_id !== snapshot.transaction_id
    || coordinatorCommitment.fence !== snapshot.fence
    || coordinatorCommitment.snapshot_hash !== suppliedSnapshotHash
    || coordinatorCommitment.snapshot_at !== snapshot.snapshot_at
    || coordinatorCommitment.intent_id !== snapshot.intent_id
    || coordinatorCommitment.issued_at > event.emitted_at
    || new Date(coordinatorCommitment.snapshot_at).getTime() > new Date(coordinatorCommitment.issued_at).getTime())) {
    stateError('acceptance coordinator commitment does not bind the exact terminal snapshot');
  }
  const projection = state.acceptance_contract.legs.map((leg) => classifyContractLeg(leg));
  const legProjectionHash = sha256(canonicalJson(projection));
  if (payload.leg_projection_hash !== legProjectionHash) {
    stateError('acceptance payload leg_projection_hash does not match frozen contract classification');
  }
  const disclosureHash = sha256(canonicalJson(deriveDisclosure(state)));
  if (payload.disclosure_hash !== disclosureHash) stateError('acceptance disclosure_hash does not match validated owner events');
  const predicate = evaluateAcceptancePredicate(state, snapshot);
  if (!predicate.ok) {
    stateError(`acceptance predicate is false: ${predicate.reasons.join(', ')}`);
  }
  const predicateHash = acceptancePredicateHash(state, snapshot, legProjectionHash, disclosureHash);
  if (payload.predicate_hash !== predicateHash) stateError('acceptance predicate_hash does not match the evaluated snapshot');
  return {
    acceptance_id: acceptanceId,
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    transaction_id: snapshot.transaction_id,
    candidate_artifacts: manifest,
    candidate_set_hash: candidateSetHash,
    audit_head: snapshot.audit_head,
    predicate_hash: predicateHash,
    ...batch,
  };
}

function validateCompletePayload(payload, state, event, { preflight = false } = {}) {
  const emitter = event.emitter;
  if (!hasAcceptanceProtocol(state) || state.status !== 'accept' || state.acceptance === null) {
    stateError('complete must immediately follow a valid acceptance event');
  }
  assertV2AcceptanceEmitter(emitter, state);
  validateAcceptanceBatchWitness(event, state, { complete: true, preflight });
  assertObject(payload, 'complete payload');
  assertOnlyKeys(payload, new Set(['acceptance_id', 'acceptance_event_hash', 'terminal_reason']), 'complete payload');
  if (payload.acceptance_id !== state.acceptance.acceptance_id
    || payload.acceptance_event_hash !== state.event_head || payload.terminal_reason !== 'accepted') {
    stateError('complete payload does not bind the immediately preceding acceptance event');
  }
}

function applyEvent(previousState, event, policy, { preflight = false } = {}) {
  const state = cloneState(previousState);
  if (state.status === 'complete' && event.type !== 'terminal_control') {
    stateError('cannot append an event after terminal completion');
  }
  if (state.status === 'accept' && event.type !== 'complete') {
    stateError('only complete may follow the transient acceptance event');
  }
  if (state.acceptance_attempt && state.acceptance_attempt.status === 'pending'
    && !['acceptance', 'acceptance_resolution', 'abort_request', 'abort'].includes(event.type)) {
    stateError('only terminal acceptance control events may follow a pending acceptance attempt');
  }
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
  if (hasAcceptanceProtocol(state)) {
    if (!Object.prototype.hasOwnProperty.call(event, 'acceptance_authority_hash')
      || event.acceptance_authority_hash !== state.acceptance_authority_commitment) {
      stateError('event acceptance_authority_hash does not match the intake-frozen acceptance authority');
    }
  } else if (Object.prototype.hasOwnProperty.call(event, 'acceptance_authority_hash')) {
    stateError('legacy event must not contain acceptance_authority_hash');
  }
  if (hasPendingActionClaim(state)
    && ((event.type !== 'evidence' || event.payload.evidence_kind !== 'action_outcome')
      && event.type !== 'abort_request')) {
    stateError('only an action outcome may settle an unresolved host action claim');
  }

  switch (event.type) {
    case 'acceptance_attempt': {
      state.acceptance_attempt = validateAcceptanceAttemptPayload(event.payload, state, event);
      break;
    }
    case 'acceptance_resolution': {
      const resolution = validateAcceptanceResolutionPayload(event.payload, state, event);
      state.acceptance_attempt = {
        ...state.acceptance_attempt,
        status: resolution.disposition,
        resolution_hash: resolution.resolution_hash,
      };
      if (state.block_reasons.length === 0) {
        state.status = state.active_principal ? 'observe' : 'intake';
      }
      break;
    }
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
      const change = validatePrincipalChangePayload(event.payload, state, policy, event.emitter);
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
      const decision = validateDecisionPayload(event.payload, state, policy, event.emitter, event.emitted_at);
      state.decisions[decision.decision_id] = decision;
      if (hasDelegationProtocol(state)) {
        state.block_reasons = state.block_reasons.filter((reason) => (
          !reason.startsWith('delegation_exhausted:')
          && (!hasAcceptanceProtocol(state) || !reason.startsWith('recovery_exhausted:'))
        ));
        if (state.block_reasons.length === 0) {
          state.blocked_since = null;
          state.status = 'decide';
        }
      }
      if (decision.requires_approval) addBlockReason(state, approvalReason(decision.decision_id), event.emitted_at);
      else if (hasDelegationProtocol(state) && state.block_reasons.length === 0) state.status = 'decide';
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
        state.action_claims[evidence.value.claim_id] = {
          ...evidence.value,
          ...(hasAcceptanceProtocol(state) ? {
            claim_event_hash: event.event_hash,
            claim_witness_head: event.witness.witness_head,
          } : {}),
        };
        state.decisions[evidence.value.decision_id].claimed_uses = evidence.value.claimed_use;
      } else if (evidence.kind === 'action_outcome') {
        const claim = state.action_claims[evidence.value.claim_id];
        claim.outcome = evidence.value.outcome;
        state.action_outcomes[evidence.value.claim_id] = {
          ...evidence.value,
          outcome_event_hash: event.event_hash,
          outcome_witness_head: event.witness.witness_head,
        };
        if (evidence.value.outcome !== 'succeeded') {
          addBlockReason(state, actionFailureReason(evidence.value.claim_id), event.emitted_at);
        }
      } else if (evidence.kind === 'capability_regression') {
        revokePendingActionClaims(state, () => true, 'host_capability_regression');
        addBlockReason(state, 'host_capability_regression', event.emitted_at);
      } else if (evidence.kind === 'capability_revalidated') {
        clearBlockReason(state, 'host_capability_regression');
      } else if (evidence.kind === 'verification') {
        state.verification_evidence[evidence.value.leg_id] = evidence.value;
        if (state.block_reasons.length === 0) {
          state.status = 'observe';
          state.blocked_since = null;
        }
      } else if (evidence.kind === 'challenge') {
        state.challenge_evidence[evidence.value.challenge_id] = evidence.value;
        if (state.block_reasons.length === 0) {
          state.status = 'observe';
          state.blocked_since = null;
        }
      } else if (evidence.kind === 'audit_reconciliation') {
        state.audit_reconciliations[evidence.value.audit_head] = {
          ...evidence.value,
          // The auditor evaluates the immediately preceding state; this event is the
          // durable witness point that later acceptance attempts must follow exactly.
          audit_event_hash: event.event_hash,
          audit_witness_head: event.witness.witness_head,
          audit_sequence: event.sequence,
        };
        if (state.block_reasons.length === 0) {
          state.status = 'observe';
          state.blocked_since = null;
        }
      } else if (evidence.kind === 'action_reconciliation') {
        state.action_reconciliations[evidence.value.claim_id] = evidence.value;
        clearBlockReason(state, actionFailureReason(evidence.value.claim_id));
        if (state.block_reasons.length === 0) {
          state.status = 'observe';
          state.blocked_since = null;
        }
      } else if (evidence.kind === 'acceptance_failure') {
        state.acceptance_failures[evidence.value.failure_id] = evidence.value;
        if (evidence.value.disposition === 'blocked') {
          // Predicate failure is a point-in-time diagnostic, not an unresolvable synthetic
          // block. Subsequent witnessed proof can make a new candidate evaluable.
          state.status = 'blocked';
          state.blocked_since = event.emitted_at;
        } else if (state.block_reasons.length === 0) {
          state.status = 'recover';
        }
      }
      break;
    }
    case 'delegation': {
      const delegation = validateDelegationPayload(event.payload, state, policy, event.emitter);
      state.delegations[delegation.delegation_id] = delegation;
      state.decisions[delegation.decision_id].delegation_count = delegation.delegation_count;
      if (delegation.exhausted) addBlockReason(state, `delegation_exhausted:${delegation.decision_id}`, event.emitted_at);
      else state.status = 'delegate';
      break;
    }
    case 'recovery': {
      const recovery = validateRecoveryPayload(event.payload, state, policy, event.emitter);
      state.recoveries[recovery.recovery_id] = recovery;
      state.decisions[recovery.decision_id].recovery_count = recovery.recovery_count;
      if (recovery.exhausted) addBlockReason(state, `recovery_exhausted:${recovery.decision_id}`, event.emitted_at);
      else state.status = 'recover';
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
      validateAbortPayload(event.payload, state, event.emitter);
      if (hasAcceptanceProtocol(state) && hasPendingActionClaim(state)) {
        stateError('terminal abort must wait for the pending action claim outcome');
      }
      state.status = 'complete';
      state.terminal_reason = event.emitter.kind === 'user' ? 'user_abort' : 'timeout_abort';
      state.blocked_since = null;
      state.block_reasons = [];
      break;
    case 'terminal_control': {
      const control = validateTerminalControlPayload(event.payload, state, event.emitter);
      state.terminal_controls.push(control);
      break;
    }
    case 'abort_request':
      state.abort_request = validateAbortRequestPayload(event.payload, state, event.emitter);
      break;
    case 'acceptance': {
      const acceptance = validateAcceptancePayload(event.payload, state, event, { preflight });
      if (acceptance.legacy) {
        state.status = 'complete';
        state.terminal_reason = 'accepted';
        state.blocked_since = null;
        state.block_reasons = [];
      } else {
        state.status = 'accept';
        state.acceptance = acceptance;
        state.acceptance_attempt = {
          ...state.acceptance_attempt,
          status: 'accepted',
          acceptance_id: acceptance.acceptance_id,
        };
      }
      break;
    }
    case 'complete':
      validateCompletePayload(event.payload, state, event, { preflight });
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
  actionReconciliationHash,
  actionReconciliationProof,
  applyEvent,
  decisionContent,
  deriveDisclosure,
  makeInitialState,
  replayEvents,
  stateProjection,
};
