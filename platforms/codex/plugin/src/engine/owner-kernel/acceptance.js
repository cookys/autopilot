'use strict';

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const { OwnerKernelBlockedError, OwnerKernelError } = require('./errors');

function acceptanceError(message, code = 'INVALID_ACCEPTANCE_AUTHORITY') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    acceptanceError(`${label} must be a plain data object`);
  }
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) acceptanceError(`${label} has unsupported key "${key}"`);
  }
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    acceptanceError(`${label} must be a non-empty protocol token`);
  }
  return value;
}

function canonicalFamilyId(value, label = 'family') {
  if (typeof value !== 'string') acceptanceError(`${label} must be a canonical family identifier`);
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._:-]{1,128}$/.test(normalized)) {
    acceptanceError(`${label} must be a canonical family identifier`);
  }
  return normalized;
}

function requireTimestamp(value, label) {
  if (typeof value !== 'string' || !/Z$/.test(value) || Number.isNaN(new Date(value).getTime())) {
    acceptanceError(`${label} must be a UTC ISO-8601 timestamp`);
  }
  return new Date(value).toISOString();
}

function normalizeHashSet(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    acceptanceError(`${label} must be a ${allowEmpty ? '' : 'non-empty '}array`);
  }
  const hashes = value.map((item, index) => {
    if (!isSha256(item)) acceptanceError(`${label}[${index}] must be a SHA-256 digest`);
    return item.toLowerCase();
  });
  const ordered = [...new Set(hashes)].sort();
  if (ordered.length !== hashes.length) acceptanceError(`${label} must not contain duplicate hashes`);
  return ordered;
}

function sameHashSet(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeArtifactManifest(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    acceptanceError(`${label} must be a non-empty array`);
  }
  const ids = new Set();
  const manifest = value.map((raw, index) => {
    const item = assertPlainObject(raw, `${label}[${index}]`);
    rejectUnknownKeys(item, new Set(['id', 'sha256']), `${label}[${index}]`);
    const id = requireToken(item.id, `${label}[${index}].id`);
    if (ids.has(id)) acceptanceError(`${label} must not contain duplicate artifact IDs`);
    if (!isSha256(item.sha256)) acceptanceError(`${label}[${index}].sha256 must be a SHA-256 digest`);
    ids.add(id);
    return { id, sha256: item.sha256.toLowerCase() };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return manifest;
}

function manifestHash(manifest) {
  return sha256(canonicalJson(manifest));
}

function sameManifest(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function normalizeAcceptanceAuthority(raw, { allowTestCoordinator = false } = {}) {
  const value = assertPlainObject(raw, 'acceptance authority');
  rejectUnknownKeys(value, new Set([
    'identity',
    'trustTier',
    'attestation_hash',
    'protocol_version',
    'acquire',
    'commit',
    'requestAbort',
    'cancel',
    'resolveAttempt',
    'verifyCommit',
    'verifyResolution',
    'release',
  ]), 'acceptance authority');
  if (value.trustTier !== 'external' && value.trustTier !== 'test') {
    acceptanceError('acceptance authority.trustTier must be external or test');
  }
  if (value.trustTier === 'test' && !allowTestCoordinator) {
    acceptanceError(
      'test acceptance coordinators require explicit allowTestAcceptanceCoordinator',
      'ACCEPTANCE_COORDINATOR_REQUIRED',
    );
  }
  if (!isSha256(value.attestation_hash)) {
    acceptanceError('acceptance authority.attestation_hash must be a SHA-256 digest');
  }
  if (value.protocol_version !== 2 || typeof value.acquire !== 'function'
    || typeof value.commit !== 'function' || typeof value.requestAbort !== 'function'
    || typeof value.cancel !== 'function' || typeof value.resolveAttempt !== 'function'
    || typeof value.verifyCommit !== 'function' || typeof value.verifyResolution !== 'function'
    || typeof value.release !== 'function') {
    acceptanceError(
      'acceptance authority requires protocol_version 2 plus acquire(), commit(), requestAbort(), cancel(), resolveAttempt(), verifyCommit(), verifyResolution(), and release()',
    );
  }
  const binding = {
    identity: requireToken(value.identity, 'acceptance authority.identity'),
    trust_tier: value.trustTier,
    attestation_hash: value.attestation_hash.toLowerCase(),
    protocol_version: 2,
  };
  return {
    binding,
    binding_hash: sha256(canonicalJson(binding)),
    acquire: value.acquire,
    commit: value.commit,
    requestAbort: value.requestAbort,
    cancel: value.cancel,
    resolveAttempt: value.resolveAttempt,
    verifyCommit: value.verifyCommit,
    verifyResolution: value.verifyResolution,
    release: value.release,
  };
}

function normalizeAcceptanceAuthorityHeader(raw) {
  if (raw === undefined || raw === null) return null;
  const value = assertPlainObject(raw, 'ledger acceptance authority');
  rejectUnknownKeys(value, new Set([
    'binding',
    'binding_hash',
    'witness_binding',
    'witness_binding_hash',
  ]), 'ledger acceptance authority');
  const binding = assertPlainObject(value.binding, 'ledger acceptance authority.binding');
  rejectUnknownKeys(binding, new Set(['identity', 'trust_tier', 'attestation_hash', 'protocol_version']), 'ledger acceptance authority.binding');
  if (binding.trust_tier !== 'external' && binding.trust_tier !== 'test') {
    acceptanceError('ledger acceptance authority trust tier is invalid');
  }
  const normalized = {
    identity: requireToken(binding.identity, 'ledger acceptance authority identity'),
    trust_tier: binding.trust_tier,
    attestation_hash: isSha256(binding.attestation_hash)
      ? binding.attestation_hash.toLowerCase()
      : null,
    protocol_version: binding.protocol_version,
  };
  if (normalized.attestation_hash === null || normalized.protocol_version !== 2) {
    acceptanceError('ledger acceptance authority binding is invalid');
  }
  const bindingHash = sha256(canonicalJson(normalized));
  if (value.binding_hash !== bindingHash) {
    acceptanceError('ledger acceptance authority binding_hash does not match binding');
  }
  const witnessBinding = assertPlainObject(value.witness_binding, 'ledger acceptance authority.witness_binding');
  rejectUnknownKeys(
    witnessBinding,
    new Set(['identity', 'attestation_hash', 'protocol_version']),
    'ledger acceptance authority.witness_binding',
  );
  const normalizedWitnessBinding = {
    identity: requireToken(witnessBinding.identity, 'ledger acceptance authority witness identity'),
    attestation_hash: isSha256(witnessBinding.attestation_hash)
      ? witnessBinding.attestation_hash.toLowerCase()
      : null,
    protocol_version: witnessBinding.protocol_version,
  };
  if (normalizedWitnessBinding.attestation_hash === null || normalizedWitnessBinding.protocol_version !== 1) {
    acceptanceError('ledger acceptance authority witness binding is invalid');
  }
  const witnessBindingHash = sha256(canonicalJson(normalizedWitnessBinding));
  if (value.witness_binding_hash !== witnessBindingHash) {
    acceptanceError('ledger acceptance authority witness_binding_hash does not match witness_binding');
  }
  return {
    binding: normalized,
    binding_hash: bindingHash,
    witness_binding: normalizedWitnessBinding,
    witness_binding_hash: witnessBindingHash,
  };
}

function normalizeAcceptanceSnapshot(raw, {
  runId,
  attemptId,
  attemptHash,
  expectedIntentId,
  expectedEventHead,
  expectedWitnessHead,
} = {}) {
  const value = assertPlainObject(raw, 'acceptance coordinator snapshot');
  rejectUnknownKeys(value, new Set([
    'ok',
    'run_id',
    'attempt_id',
    'attempt_hash',
    'intent_id',
    'transaction_id',
    'fence',
    'candidate_artifacts',
    'delivered_artifacts',
    'audit_head',
    'control_event_head',
    'control_witness_head',
    'snapshot_at',
    'snapshot_hash',
  ]), 'acceptance coordinator snapshot');
  if (value.ok !== true || value.run_id !== runId
    || value.attempt_id !== attemptId || value.attempt_hash !== attemptHash
    || value.intent_id !== expectedIntentId) {
    acceptanceError('acceptance coordinator snapshot is not bound to the current run', 'ACCEPTANCE_COORDINATOR_REJECTED');
  }
  const candidateArtifacts = normalizeArtifactManifest(
    value.candidate_artifacts,
    'acceptance coordinator candidate_artifacts',
  );
  const deliveredArtifacts = normalizeArtifactManifest(
    value.delivered_artifacts,
    'acceptance coordinator delivered_artifacts',
  );
  if (!sameManifest(candidateArtifacts, deliveredArtifacts)) {
    acceptanceError('acceptance coordinator candidate and delivered manifests must match', 'ACCEPTANCE_CANDIDATE_DRIFT');
  }
  if (!isSha256(value.fence) || !isSha256(value.audit_head)
    || (value.control_event_head !== null && !isSha256(value.control_event_head))
    || (value.control_witness_head !== null && !isSha256(value.control_witness_head))
    || !isSha256(value.snapshot_hash)) {
    acceptanceError('acceptance coordinator snapshot has invalid hash bindings');
  }
  const normalized = {
    attempt_id: requireToken(value.attempt_id, 'acceptance coordinator attempt_id'),
    attempt_hash: isSha256(value.attempt_hash)
      ? value.attempt_hash.toLowerCase()
      : null,
    intent_id: requireToken(value.intent_id, 'acceptance coordinator intent_id'),
    transaction_id: requireToken(value.transaction_id, 'acceptance coordinator transaction_id'),
    fence: value.fence.toLowerCase(),
    candidate_artifacts: candidateArtifacts,
    delivered_artifacts: deliveredArtifacts,
    candidate_set_hash: manifestHash(candidateArtifacts),
    delivered_set_hash: manifestHash(deliveredArtifacts),
    audit_head: value.audit_head.toLowerCase(),
    control_event_head: value.control_event_head === null ? null : value.control_event_head.toLowerCase(),
    control_witness_head: value.control_witness_head === null ? null : value.control_witness_head.toLowerCase(),
    snapshot_at: requireTimestamp(value.snapshot_at, 'acceptance coordinator snapshot_at'),
  };
  if (normalized.attempt_hash === null) {
    acceptanceError('acceptance coordinator attempt_hash must be a SHA-256 digest');
  }
  const expectedHash = sha256(canonicalJson({ run_id: runId, ...normalized }));
  if (value.snapshot_hash.toLowerCase() !== expectedHash) {
    acceptanceError('acceptance coordinator snapshot_hash does not match its snapshot');
  }
  if (normalized.control_event_head !== expectedEventHead
    || normalized.control_witness_head !== expectedWitnessHead) {
    acceptanceError('acceptance coordinator snapshot did not drain the current control head', 'ACCEPTANCE_CONTROL_STALE');
  }
  return { ...normalized, snapshot_hash: expectedHash };
}

function contractArtifactIds(contract) {
  if (contract.schema_version !== 2) {
    acceptanceError('serializable acceptance requires an opt-in schema_version 2 contract', 'ACCEPTANCE_CONTRACT_V2_REQUIRED');
  }
  return contract.artifacts.map((artifact) => artifact.id).sort();
}

function classifyContractLeg(leg) {
  const derivedKind = Object.prototype.hasOwnProperty.call(leg, 'command') ? 'executable' : 'non_executable';
  return {
    id: leg.id,
    kind: derivedKind,
    ...(derivedKind === 'executable' ? { command_hash: sha256(leg.command) } : {}),
    artifact_ids: Array.isArray(leg.artifact_ids) ? [...leg.artifact_ids].sort() : [],
    // Until a contract-risk classifier is bound to frozen policy, every v2 leg requires
    // independent review. Command presence selects verification, never a review waiver.
    challenge_required: true,
  };
}

function deriveActionFootprint(state) {
  const claims = Object.values(state.action_claims || {}).sort((left, right) => (
    left.claim_id.localeCompare(right.claim_id)
  ));
  return claims.map((claim) => {
    const outcome = state.action_outcomes && state.action_outcomes[claim.claim_id]
      ? state.action_outcomes[claim.claim_id]
      : null;
    const reconciliation = state.action_reconciliations && state.action_reconciliations[claim.claim_id]
      ? state.action_reconciliations[claim.claim_id]
      : null;
    return {
      claim_id: claim.claim_id,
      claim_event_hash: claim.claim_event_hash || null,
      action_descriptor_hash: claim.action_descriptor_hash,
      outcome: claim.outcome,
      outcome_hash: outcome === null ? null : sha256(canonicalJson(outcome)),
      reconciliation_hash: reconciliation === null ? null : reconciliation.reconciliation_hash,
      reconciliation_resolution: reconciliation === null ? null : reconciliation.resolution,
    };
  });
}

function actionFootprintHash(state) {
  return sha256(canonicalJson(deriveActionFootprint(state)));
}

function currentActionCandidateAudit(state) {
  const audits = Object.values(state.audit_reconciliations || {});
  if (audits.length === 0) return null;
  const latest = [...audits].sort((left, right) => {
    const sequence = (right.audit_sequence || 0) - (left.audit_sequence || 0);
    if (sequence !== 0) return sequence;
    return right.audit_head.localeCompare(left.audit_head);
  })[0];
  if (!latest || latest.complete !== true
    || latest.intent_id !== state.current_intent_id
    || latest.action_footprint_hash !== actionFootprintHash(state)) {
    return null;
  }
  return latest;
}

function isDurableActionChallengeBlock(challenge, {
  scopeId = null,
  candidateSetHash = null,
  intentId = null,
} = {}) {
  // Challenge evidence is qualified and attestation-bound when it is witnessed. A blocking
  // action finding remains a veto for that frozen intent/descriptor/candidate tuple; letting
  // it vanish when its challenger later expires would turn expiry into an authorization bypass.
  if (!challenge || challenge.finding !== 'blocking' || challenge.scope !== 'action') return false;
  if (scopeId !== null && challenge.scope_id !== scopeId) return false;
  if (candidateSetHash !== null && challenge.candidate_set_hash !== candidateSetHash) return false;
  if (intentId !== null && challenge.intent_id !== intentId) return false;
  return true;
}

function effectiveActionSuccess(state, claim) {
  if (claim.outcome === 'succeeded') return true;
  if (claim.outcome !== 'unknown') return false;
  const outcome = state.action_outcomes && state.action_outcomes[claim.claim_id];
  const reconciliation = state.action_reconciliations && state.action_reconciliations[claim.claim_id];
  return Boolean(outcome && reconciliation
    && outcome.outcome === 'unknown'
    && reconciliation.resolution === 'succeeded'
    && reconciliation.claim_id === claim.claim_id
    && reconciliation.claim_event_hash === claim.claim_event_hash
    && reconciliation.claim_witness_head === claim.claim_witness_head
    && reconciliation.execution_permit_hash === claim.execution_permit_hash
    && reconciliation.original_outcome_hash === sha256(canonicalJson(outcome))
    && reconciliation.original_outcome_event_hash === outcome.outcome_event_hash
    && reconciliation.original_outcome_witness_head === outcome.outcome_witness_head
    && reconciliation.observed_action_descriptor_hash === claim.action_descriptor_hash);
}

function isQualifiedChallengeCurrent(state, challenge, evaluatedAt, {
  scope = null,
  scopeId = null,
  candidateSetHash = null,
  intentId = null,
} = {}) {
  if (!challenge || !state.active_principal || typeof evaluatedAt !== 'string') return false;
  if ((scope !== null && challenge.scope !== scope)
    || (scopeId !== null && challenge.scope_id !== scopeId)
    || (candidateSetHash !== null && challenge.candidate_set_hash !== candidateSetHash)) {
    return false;
  }
  if (intentId !== null && challenge.intent_id !== intentId) return false;
  const challenger = (state.acceptance_challenger_roster || []).find((entry) => (
    entry.identity === challenge.challenger_identity
  ));
  if (!challenger || challenger.attestation.sha256 !== challenge.challenger_attestation_hash) return false;
  const at = new Date(evaluatedAt).getTime();
  if (Number.isNaN(at)
    || new Date(challenger.attestation.issued_at).getTime() > at
    || new Date(challenger.attestation.expires_at).getTime() <= at) {
    return false;
  }
  const owner = state.active_principal;
  let challengerFamily;
  let ownerFamily;
  let subjectFamily;
  try {
    challengerFamily = canonicalFamilyId(challenger.family, 'challenger family');
    ownerFamily = canonicalFamilyId(owner.family, 'owner family');
    subjectFamily = canonicalFamilyId(challenge.subject_family, 'challenge subject_family');
  } catch (_error) {
    return false;
  }
  return challenger.identity !== owner.identity
    && challengerFamily !== ownerFamily
    && challenger.identity !== challenge.subject_identity
    && challengerFamily !== subjectFamily
    && owner.identity !== challenge.subject_identity
    && ownerFamily !== subjectFamily;
}

function evaluateAcceptancePredicate(state, snapshot) {
  const reasons = [];
  const contract = state.acceptance_contract;
  if (contract.schema_version !== 2) {
    return { ok: false, reasons: ['acceptance_contract_v2_required'], disposition: 'blocked' };
  }
  const candidateSetHash = snapshot.candidate_set_hash;
  const snapshotTime = new Date(snapshot.snapshot_at).getTime();
  const candidateIds = snapshot.candidate_artifacts.map((artifact) => artifact.id).sort();
  if (!state.active_principal) reasons.push('owner_unavailable');
  // A local abort request stops the live Kernel before it asks the coordinator to commit.
  // During replay/recovery, however, a coordinator-signed accepted batch is the authoritative
  // ordering result; it may legitimately have linearized before a locally witnessed request.
  if (state.block_reasons.length > 0) reasons.push('unresolved_block');
  if (canonicalJson(candidateIds) !== canonicalJson(contractArtifactIds(contract))) reasons.push('candidate_contract_drift');
  if (!sameManifest(snapshot.candidate_artifacts, snapshot.delivered_artifacts)) reasons.push('delivery_candidate_drift');
  const audit = state.audit_reconciliations[snapshot.audit_head];
  if (!audit || !audit.complete || audit.candidate_set_hash !== candidateSetHash
    || audit.action_footprint_hash !== actionFootprintHash(state)
    || audit.intent_id !== state.current_intent_id
    || !state.acceptance_attempt
    || audit.audit_event_hash !== state.acceptance_attempt.expected_event_head
    || audit.audit_witness_head !== state.acceptance_attempt.expected_witness_head
    || new Date(audit.observed_at).getTime() > snapshotTime) {
    reasons.push('audit_reconciliation_missing');
  }
  if (state.active_principal && (new Date(state.active_principal.attestation.issued_at).getTime() > snapshotTime
    || new Date(state.active_principal.attestation.expires_at).getTime() <= snapshotTime)) {
    reasons.push('owner_attestation_not_current');
  }
  for (const claim of Object.values(state.action_claims || {})) {
    if (!effectiveActionSuccess(state, claim)) reasons.push(`non_successful_action_claim:${claim.claim_id}`);
  }
  for (const leg of contract.legs) {
    const classification = classifyContractLeg(leg);
    if (classification.kind !== leg.kind) {
      reasons.push(`contract_leg_classification:${leg.id}`);
      continue;
    }
    if (classification.kind === 'executable') {
      const evidence = state.verification_evidence[leg.id];
      if (!evidence || evidence.outcome !== 'green'
        || evidence.command_hash !== classification.command_hash
        || evidence.candidate_set_hash !== candidateSetHash
        || evidence.intent_id !== state.current_intent_id
        || new Date(evidence.executed_at).getTime() > snapshotTime) {
        reasons.push(`verification_missing:${leg.id}`);
      }
    }
    const qualified = Object.values(state.challenge_evidence).some((challenge) => (
      challenge.finding === 'clear'
      && new Date(challenge.reviewed_at).getTime() <= snapshotTime
      && isQualifiedChallengeCurrent(state, challenge, snapshot.snapshot_at, {
        scope: 'contract_leg',
        scopeId: leg.id,
        candidateSetHash,
        intentId: state.current_intent_id,
      })
    ));
    if (!qualified) reasons.push(`challenge_missing:${leg.id}`);
  }
  for (const challenge of Object.values(state.challenge_evidence)) {
    // A qualified blocking finding is a durable veto for its reviewed candidate. It does
    // not become ignorable merely because the reviewer later expires or the owner rotates.
    if (challenge.candidate_set_hash === candidateSetHash && challenge.finding === 'blocking') {
      reasons.push(`challenge_blocking:${challenge.challenge_id}`);
    }
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  const blocked = uniqueReasons.some((reason) => (
    reason === 'owner_unavailable'
    || reason === 'user_abort_requested'
    || reason === 'unresolved_block'
    || reason === 'audit_reconciliation_missing'
    || reason.startsWith('non_successful_action_claim:')
  ));
  return {
    ok: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    disposition: blocked ? 'blocked' : 'recover',
  };
}

function requireAcceptanceAuthority(internal) {
  if (!internal.acceptanceAuthority) {
    throw new OwnerKernelBlockedError(
      'acceptance requires an intake-frozen external acceptance coordinator',
      'ACCEPTANCE_COORDINATOR_REQUIRED',
    );
  }
  return internal.acceptanceAuthority;
}

function assertSynchronousCoordinatorVerification(value, label = 'acceptance coordinator verifier') {
  if (value && typeof value.then === 'function') {
    acceptanceError(
      `${label} must return a synchronous verification result so authoritative ledger replay remains deterministic`,
      'ACCEPTANCE_COORDINATOR_REJECTED',
    );
  }
  return value;
}

module.exports = {
  actionFootprintHash,
  assertSynchronousCoordinatorVerification,
  canonicalFamilyId,
  classifyContractLeg,
  contractArtifactIds,
  currentActionCandidateAudit,
  deriveActionFootprint,
  effectiveActionSuccess,
  evaluateAcceptancePredicate,
  isDurableActionChallengeBlock,
  isQualifiedChallengeCurrent,
  manifestHash,
  normalizeAcceptanceAuthority,
  normalizeAcceptanceAuthorityHeader,
  normalizeArtifactManifest,
  normalizeAcceptanceSnapshot,
  normalizeHashSet,
  requireAcceptanceAuthority,
  sameManifest,
  sameHashSet,
};
