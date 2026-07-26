'use strict';

const crypto = require('crypto');

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
const {
  actionFootprintHash,
  assertSynchronousCoordinatorVerification,
  canonicalFamilyId,
  classifyContractLeg,
  currentActionCandidateAudit,
  evaluateAcceptancePredicate,
  isDurableActionChallengeBlock,
  isQualifiedChallengeCurrent,
  normalizeAcceptanceAuthority,
  normalizeAcceptanceSnapshot,
  requireAcceptanceAuthority,
} = require('./acceptance');
const {
  normalizeActionAuthority,
  assertIndependentAuthorityBindings,
  normalizeActionCancellationResult,
  normalizeActionDescriptor,
  normalizeActionExecutionResult,
  normalizeExecutionAuthorization,
  normalizeExecutionPermit,
  normalizeVerifiedActionOutcome,
} = require('./actions');
const { OwnerKernelBlockedError, OwnerKernelError } = require('./errors');
const { buildEvent, prepareEvent } = require('./events');
const {
  createLedgerHeader,
  replayFromLatestCheckpoint,
  serializeLedger,
  verifyLedger,
} = require('./ledger');
const { freezeAcceptanceContract, resolveGovernancePolicy } = require('./policy');
const { freezeTaskAuthorityEnvelope } = require('./task-authority');
const { createSemanticAuthorityHeader } = require('./semantic-authority');
const {
  resolveRoleExecutionGrant,
  verifyRoleExecutionGrant,
} = require('../execution-profile');
const {
  actionReconciliationHash,
  applyEvent,
  decisionContent,
  deriveDisclosure,
  makeInitialState,
  stateProjection,
} = require('./state');
const { assertWitnessAdapter, normalizeWitnessBinding, verifyReceiptShape } = require('./witness');

const INTERNALS = new WeakMap();
const DEFAULT_ACTION_TIMEOUT_MILLISECONDS = 300000;
const DEFAULT_CANCELLATION_TIMEOUT_MILLISECONDS = 30000;
const CAPABILITIES = new WeakMap();

function nowIso(clock) {
  const value = typeof clock === 'function' ? clock() : new Date();
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new OwnerKernelError('Owner Kernel clock returned an invalid timestamp', 'INVALID_CLOCK');
  }
  return parsed.toISOString();
}

function requireAdapter(adapters, name) {
  if (!adapters || typeof adapters[name] !== 'function') {
    throw new OwnerKernelError(`Owner Kernel requires adapters.${name}()`, 'TRUSTED_ADAPTER_REQUIRED');
  }
  return adapters[name];
}

function isPlainDataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainDataObject(value, label) {
  if (!isPlainDataObject(value)) {
    throw new OwnerKernelError(`${label} must be a plain data object`, 'INVALID_ROLE_AUTHORITY_INPUT');
  }
  return value;
}

function requireOnlyDataKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new OwnerKernelError(
        `${label} has unsupported key "${key}"`,
        'INVALID_ROLE_AUTHORITY_INPUT',
      );
    }
  }
}

function requireProtocolToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new OwnerKernelError(
      `${label} must be a bounded protocol token`,
      'INVALID_ROLE_AUTHORITY_INPUT',
    );
  }
  return value;
}

function requireVerifiedEnvelope(result, label, { expectedKind, runId, principalId } = {}) {
  if (!result || typeof result !== 'object' || result.ok !== true) {
    throw new OwnerKernelError(`${label} was not verified by the trusted adapter`, 'UNVERIFIED_ENVELOPE');
  }
  if (expectedKind && result.kind !== expectedKind) {
    throw new OwnerKernelError(`${label} kind does not match the requested event`, 'UNVERIFIED_ENVELOPE');
  }
  if (typeof result.identity !== 'string' || result.identity.length === 0
    || typeof result.channel !== 'string' || result.channel.length === 0
    || !isSha256(result.envelope_hash)
    || !result.payload || typeof result.payload !== 'object' || Array.isArray(result.payload)) {
    throw new OwnerKernelError(`${label} returned an invalid trusted envelope`, 'UNVERIFIED_ENVELOPE');
  }
  if (runId && result.run_id !== runId) {
    throw new OwnerKernelError(`${label} is not bound to the current run`, 'UNVERIFIED_ENVELOPE');
  }
  if (principalId && (result.principal_id !== principalId || result.identity !== principalId)) {
    throw new OwnerKernelError(`${label} is not bound to the current owner principal`, 'UNVERIFIED_ENVELOPE');
  }
  return {
    identity: result.identity,
    channel: result.channel,
    envelope_hash: result.envelope_hash.toLowerCase(),
    payload: cloneCanonical(result.payload),
  };
}

function makeCapability(kernel, principal, issuedAt) {
  const internal = INTERNALS.get(kernel);
  const expiry = Math.min(
    new Date(principal.attestation.expires_at).getTime(),
    new Date(issuedAt).getTime() + (internal.policy.capability_ttl_seconds * 1000),
  );
  if (expiry <= new Date(issuedAt).getTime()) {
    throw new OwnerKernelBlockedError('qualified owner attestation has expired', 'OWNER_ATTESTATION_EXPIRED');
  }
  const capability = Object.freeze({});
  CAPABILITIES.set(capability, {
    kernel,
    runId: internal.header.run_id,
    principalId: principal.identity,
    nonce: internal.capabilityNonce,
    expiresAt: new Date(expiry).toISOString(),
  });
  return capability;
}

function invalidateCapabilities(kernel) {
  // Capabilities are never enumerated or serialized. A changing nonce invalidates every old reference.
  const internal = INTERNALS.get(kernel);
  internal.capabilityNonce = crypto.randomBytes(32).toString('hex');
}

function assertCapability(kernel, capability, now) {
  const internal = INTERNALS.get(kernel);
  const record = CAPABILITIES.get(capability);
  if (!record || record.kernel !== kernel || record.runId !== internal.header.run_id
    || record.nonce !== internal.capabilityNonce) {
    throw new OwnerKernelBlockedError('owner decision requires the current in-memory owner capability', 'OWNER_CAPABILITY_REQUIRED');
  }
  if (!internal.state.active_principal || internal.state.active_principal.identity !== record.principalId) {
    throw new OwnerKernelBlockedError('owner capability no longer matches the active principal', 'OWNER_CAPABILITY_REVOKED');
  }
  if (new Date(record.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new OwnerKernelBlockedError('owner capability has expired', 'OWNER_CAPABILITY_EXPIRED');
  }
  return record;
}

function nextIdentifier(internal, prefix) {
  return `${prefix}-${internal.state.sequence + 1}`;
}

function verifyPrincipalResolution(internal, { candidateId, reason }) {
  const resolver = requireAdapter(internal.adapters, 'principalResolver');
  const fromPrincipalId = internal.state.active_principal ? internal.state.active_principal.identity : null;
  const response = resolver({
    run_id: internal.header.run_id,
    from_principal_id: fromPrincipalId,
    candidate_id: candidateId,
    reason,
    policy_hash: internal.header.policy_hash,
  });
  if (!response || typeof response !== 'object') {
    throw new OwnerKernelError('principalResolver returned an invalid response', 'UNVERIFIED_PRINCIPAL');
  }
  if (response.run_id !== internal.header.run_id || response.from_principal_id !== fromPrincipalId) {
    throw new OwnerKernelError('principalResolver response is not bound to the current run and principal', 'UNVERIFIED_PRINCIPAL');
  }
  if (response.ok !== true) {
    return {
      to_principal_id: null,
      reason,
      resolver_outcome: typeof response.outcome === 'string' ? response.outcome : 'roster_exhausted',
      attestation: null,
    };
  }
  if (response.identity !== candidateId) {
    throw new OwnerKernelError('principalResolver selected an identity other than the requested frozen roster candidate', 'UNVERIFIED_PRINCIPAL');
  }
  const principal = internal.policy.owner_roster.find((entry) => entry.identity === candidateId);
  if (!principal) {
    throw new OwnerKernelError('principalResolver selected an identity outside the frozen owner roster', 'UNVERIFIED_PRINCIPAL');
  }
  if (response.attestation_sha256 !== principal.attestation.sha256) {
    throw new OwnerKernelError('principalResolver attestation does not match the frozen owner roster', 'UNVERIFIED_PRINCIPAL');
  }
  if (new Date(principal.attestation.expires_at).getTime() <= new Date(nowIso(internal.clock)).getTime()) {
    return {
      to_principal_id: null,
      reason,
      resolver_outcome: 'attestation_expired',
      attestation: null,
    };
  }
  return {
    to_principal_id: principal.identity,
    reason,
    resolver_outcome: typeof response.outcome === 'string' ? response.outcome : 'qualified',
    attestation: cloneCanonical(principal.attestation),
  };
}

function assertCurrentQualification(kernel, operation, now) {
  const internal = INTERNALS.get(kernel);
  const principal = internal.state.active_principal;
  if (!principal) {
    throw new OwnerKernelBlockedError('no active qualified owner principal is available', 'OWNER_UNAVAILABLE');
  }
  const currentTime = new Date(now).getTime();
  let verified = false;
  if (new Date(principal.attestation.expires_at).getTime() > currentTime) {
    const verifier = requireAdapter(internal.adapters, 'qualificationVerifier');
    const response = verifier({
      run_id: internal.header.run_id,
      principal: cloneCanonical(principal),
      operation,
      policy_hash: internal.header.policy_hash,
    });
    verified = Boolean(response
      && response.ok === true
      && response.run_id === internal.header.run_id
      && response.principal_id === principal.identity
      && response.attestation_sha256 === principal.attestation.sha256);
  }
  if (verified) return principal;

  appendInternal(kernel, {
    type: 'principal_change',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-qualification' },
    payload: {
      from_principal_id: principal.identity,
      to_principal_id: null,
      reason: 'qualification_failed',
      resolver_outcome: 'qualification_failed',
      attestation: null,
    },
    skipAutomaticCheckpoint: true,
  });
  invalidateCapabilities(kernel);
  throw new OwnerKernelBlockedError('owner qualification failed and authority was revoked', 'OWNER_QUALIFICATION_FAILED');
}

function hasActionAuthority(internal) {
  return internal.actionAuthority !== null;
}

function qualifiedActionChallengeCandidates(internal, actionDescriptorHash, evaluatedAt) {
  if (!internal.state.challenge_evidence) return [];
  const audit = currentActionCandidateAudit(internal.state);
  if (audit === null) return [];
  const intentId = internal.state.current_intent_id;
  return Object.values(internal.state.challenge_evidence)
    .filter((challenge) => (
      challenge.finding === 'clear'
      && challenge.candidate_set_hash === audit.candidate_set_hash
      && isQualifiedChallengeCurrent(internal.state, challenge, evaluatedAt, {
        scope: 'action',
        scopeId: actionDescriptorHash,
        candidateSetHash: audit.candidate_set_hash,
        intentId,
      })
    ))
    .filter((challenge) => !Object.values(internal.state.challenge_evidence).some((candidate) => (
      candidate.finding === 'blocking'
      && isDurableActionChallengeBlock(candidate, {
        scopeId: actionDescriptorHash,
        candidateSetHash: challenge.candidate_set_hash,
        intentId,
      })
    )))
    .sort((left, right) => (
      left.challenge_id.localeCompare(right.challenge_id)
      || left.candidate_set_hash.localeCompare(right.candidate_set_hash)
    ));
}

function hasQualifiedActionChallenge(internal, decision, evaluatedAt) {
  if (!decision.action_challenge_id || !decision.action_challenge_candidate_set_hash) return false;
  const audit = currentActionCandidateAudit(internal.state);
  if (audit === null || audit.candidate_set_hash !== decision.action_challenge_candidate_set_hash) return false;
  const challenge = internal.state.challenge_evidence
    && internal.state.challenge_evidence[decision.action_challenge_id];
  if (!challenge || challenge.finding !== 'clear' || !isQualifiedChallengeCurrent(
    internal.state,
    challenge,
    evaluatedAt,
    {
      scope: 'action',
      scopeId: decision.action_descriptor_hash,
      candidateSetHash: decision.action_challenge_candidate_set_hash,
      intentId: internal.state.current_intent_id,
    },
  )) return false;
  return !Object.values(internal.state.challenge_evidence).some((candidate) => (
    candidate.finding === 'blocking'
    && isDurableActionChallengeBlock(candidate, {
      scopeId: decision.action_descriptor_hash,
      candidateSetHash: decision.action_challenge_candidate_set_hash,
      intentId: internal.state.current_intent_id,
    })
  ));
}

function assessAuthorityHostCapability(authority, {
  runId,
  policyHash,
  operation,
  now,
  actionContext = null,
}) {
  const probeNonce = crypto.randomBytes(32).toString('hex');
  const probeNonceCommitment = sha256(probeNonce);
  if (new Date(authority.capability.expires_at).getTime() <= new Date(now).getTime()) {
    return {
      ok: false,
      observed_capability_hash: authority.capability_hash,
      observation_hash: null,
      probe_nonce_commitment: probeNonceCommitment,
      reason: 'host_capability_expired',
    };
  }
  let response;
  try {
    response = authority.host_capability_probe({
      run_id: runId,
      operation,
      policy_hash: policyHash,
      host_capability: cloneCanonical(authority.capability),
      host_capability_hash: authority.capability_hash,
      probe_nonce: probeNonce,
      ...(actionContext === null ? {} : cloneCanonical(actionContext)),
    });
  } catch (_error) {
    return {
      ok: false,
      observed_capability_hash: null,
      observation_hash: null,
      probe_nonce_commitment: probeNonceCommitment,
      reason: 'host_capability_verifier_error',
    };
  }
  if (!isPlainDataObject(response)
    || !Object.prototype.hasOwnProperty.call(response, 'run_id')
    || !Object.prototype.hasOwnProperty.call(response, 'host_capability_hash')
    || !Object.prototype.hasOwnProperty.call(response, 'observation_hash')
    || !Object.prototype.hasOwnProperty.call(response, 'probe_nonce')
    || !Object.prototype.hasOwnProperty.call(response, 'ok')
    || response.run_id !== runId) {
    return {
      ok: false,
      observed_capability_hash: null,
      observation_hash: null,
      probe_nonce_commitment: probeNonceCommitment,
      reason: 'host_capability_verifier_unbound',
    };
  }
  const observedHash = isSha256(response.host_capability_hash)
    ? response.host_capability_hash.toLowerCase()
    : null;
  const observationHash = isSha256(response.observation_hash)
    ? response.observation_hash.toLowerCase()
    : null;
  if (response.ok === true && response.probe_nonce === probeNonce
    && observedHash === authority.capability_hash && observationHash !== null) {
    let executionPermit = null;
      if (operation === 'pre_action') {
        try {
          executionPermit = normalizeExecutionPermit(response.execution_permit, {
            runId,
            witnessStreamId: actionContext && actionContext.witness_stream_id,
            witnessBindingHash: actionContext && actionContext.witness_binding_hash,
            authorityHash: actionContext && actionContext.authority_hash,
            claimId: actionContext && actionContext.claim_id,
            preActionWitnessHead: actionContext && actionContext.pre_action_witness_head,
            hostCapabilityHash: authority.capability_hash,
            actionDescriptorHash: actionContext && actionContext.action_descriptor_hash,
            executorBindingHash: actionContext && actionContext.executor_binding_hash,
            audienceIdentity: actionContext && actionContext.audience_identity,
            hostCapabilityVerifierBinding: authority.host_capability_verifier_binding,
            now,
          });
      } catch (_error) {
        return {
          ok: false,
          observed_capability_hash: observedHash,
          observation_hash: observationHash,
          probe_nonce_commitment: probeNonceCommitment,
          reason: 'host_execution_permit_invalid',
        };
      }
      }
      let executionAuthorization = null;
      if (operation === 'post_claim') {
        try {
          executionAuthorization = normalizeExecutionAuthorization(response.execution_authorization, {
            runId,
            witnessStreamId: actionContext && actionContext.witness_stream_id,
            witnessBindingHash: actionContext && actionContext.witness_binding_hash,
            authorityHash: actionContext && actionContext.authority_hash,
            claimId: actionContext && actionContext.claim_id,
            claimEventHash: actionContext && actionContext.claim_event_hash,
            claimWitnessHead: actionContext && actionContext.claim_witness_head,
            claimEmittedAt: actionContext && actionContext.claim_emitted_at,
            executionPermit: actionContext && actionContext.execution_permit,
            executionPermitHash: actionContext && actionContext.execution_permit_hash,
            hostCapabilityHash: authority.capability_hash,
            actionDescriptorHash: actionContext && actionContext.action_descriptor_hash,
            executorBindingHash: actionContext && actionContext.executor_binding_hash,
            audienceIdentity: actionContext && actionContext.audience_identity,
            hostCapabilityVerifierBinding: authority.host_capability_verifier_binding,
            now,
          });
        } catch (_error) {
          return {
            ok: false,
            observed_capability_hash: observedHash,
            observation_hash: observationHash,
            probe_nonce_commitment: probeNonceCommitment,
            reason: 'host_execution_authorization_invalid',
          };
        }
      }
      return {
      ok: true,
      observation_hash: observationHash,
      probe_nonce_commitment: probeNonceCommitment,
      ...(executionPermit === null ? {} : {
        execution_permit: executionPermit,
        execution_permit_hash: sha256(canonicalJson(executionPermit)),
      }),
      ...(executionAuthorization === null ? {} : {
        execution_authorization: executionAuthorization,
        execution_authorization_hash: sha256(canonicalJson(executionAuthorization)),
      }),
    };
  }
  return {
    ok: false,
    observed_capability_hash: observedHash,
    observation_hash: observationHash,
    probe_nonce_commitment: probeNonceCommitment,
    reason: typeof response.reason === 'string' && response.reason.length > 0
      ? 'host_capability_verifier_rejected'
      : 'host_capability_verifier_invalid',
  };
}

function assessHostCapability(kernel, operation, now, actionContext = null) {
  const internal = INTERNALS.get(kernel);
  if (!hasActionAuthority(internal)) return { ok: true, observation_hash: null };
  return assessAuthorityHostCapability(internal.actionAuthority, {
    runId: internal.header.run_id,
    policyHash: internal.header.policy_hash,
    operation,
    now,
    actionContext,
  });
}

function appendCapabilityRegression(kernel, assessment) {
  const internal = INTERNALS.get(kernel);
  if (!hasActionAuthority(internal) || internal.state.status === 'complete'
    || internal.state.block_reasons.includes('host_capability_regression')) {
    return null;
  }
  return appendInternal(kernel, {
    type: 'evidence',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-host-capability' },
    payload: {
      evidence_id: nextIdentifier(internal, 'evidence'),
      evidence_kind: 'capability_regression',
      expected_capability_hash: internal.actionAuthority.capability_hash,
      observed_capability_hash: assessment.observed_capability_hash,
      observation_hash: assessment.observation_hash,
      probe_nonce_commitment: assessment.probe_nonce_commitment,
      reason: assessment.reason,
    },
    skipAutomaticCheckpoint: true,
  });
}

function assertCurrentHostCapability(kernel, operation, now, {
  recordFailure = true,
  actionContext = null,
} = {}) {
  const internal = INTERNALS.get(kernel);
  if (!hasActionAuthority(internal)) return null;
  if (internal.state.block_reasons.includes('host_capability_regression')) {
    throw new OwnerKernelBlockedError(
      'host capability was previously revoked; explicit revalidation is required',
      'HOST_CAPABILITY_REVALIDATION_REQUIRED',
    );
  }
  const assessment = assessHostCapability(kernel, operation, now, actionContext);
  if (assessment.ok) return assessment;
  if (recordFailure) appendCapabilityRegression(kernel, assessment);
  throw new OwnerKernelBlockedError(
    'current host capability does not match the intake-frozen authority',
    'HOST_CAPABILITY_REGRESSION',
  );
}

function assertCurrentWitnessHead(kernel) {
  const internal = INTERNALS.get(kernel);
  if (typeof internal.witness.getHead !== 'function') {
    throw new OwnerKernelBlockedError(
      'action authority requires a witness adapter getHead() probe',
      'WITNESS_HEAD_REQUIRED',
    );
  }
  const externalHead = internal.witness.getHead();
  if (externalHead !== null && !isSha256(externalHead)) {
    throw new OwnerKernelBlockedError('witness getHead() returned an invalid head', 'WITNESS_HEAD_INVALID');
  }
  const normalizedHead = externalHead === null ? null : externalHead.toLowerCase();
  if (normalizedHead !== internal.state.witness_head) {
    throw new OwnerKernelBlockedError(
      'Kernel ledger head does not equal the current external witness head',
      'WITNESS_HEAD_STALE',
    );
  }
  return normalizedHead;
}

function actionUseLimit(decision) {
  return decision.requires_approval ? decision.approved_uses : decision.requested_max_uses;
}

function hasPendingActionClaim(internal) {
  return hasActionAuthority(internal)
    && Object.values(internal.state.action_claims).some((claim) => claim.outcome === null);
}

function assertNoPendingActionClaim(kernel, operation) {
  const internal = INTERNALS.get(kernel);
  if (hasPendingActionClaim(internal)) {
    throw new OwnerKernelBlockedError(
      `${operation} is blocked until the unresolved host action is durably reconciled`,
      'ACTION_CLAIM_RECOVERY_REQUIRED',
    );
  }
}

function awaitWithAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const rejectAbort = () => reject(new OwnerKernelBlockedError(
      'the host action was cancelled before a durable receipt was returned',
      'ACTION_ABORTED',
    ));
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener('abort', rejectAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', rejectAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', rejectAbort);
        reject(error);
      },
    );
  });
}

function invokeWithAbort(invoke, signal) {
  if (signal.aborted) {
    return Promise.reject(new OwnerKernelBlockedError(
      'the host action was cancelled before crossing the host boundary',
      'ACTION_ABORTED',
    ));
  }
  return awaitWithAbort(Promise.resolve().then(() => {
    if (signal.aborted) {
      throw new OwnerKernelBlockedError(
        'the host action was cancelled before crossing the host boundary',
        'ACTION_ABORTED',
      );
    }
    return invoke();
  }), signal);
}

function awaitWithTimeout(promise, timeoutMilliseconds) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new OwnerKernelBlockedError(
        'the action boundary did not acknowledge cancellation before the cancellation deadline',
        'ACTION_CANCELLATION_UNCONFIRMED',
      ));
    }, timeoutMilliseconds);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function actionBoundary(internal) {
  const broker = internal.actionAuthority.capability.broker;
  if (broker !== null) {
    return {
      broker,
      execute: internal.actionAuthority.executor.broker.execute,
      cancel: internal.actionAuthority.executor.broker.cancel,
      audience_identity: broker.identity,
      boundary_attestation_hash: broker.attestation_hash,
    };
  }
  return {
    broker: null,
    execute: internal.actionAuthority.executor.execute,
    cancel: internal.actionAuthority.executor.cancel,
    audience_identity: internal.actionAuthority.executor.identity,
    boundary_attestation_hash: internal.actionAuthority.executor.attestation_hash,
  };
}

function requestActionAbort(activeAction, reason, abortEnvelopeHash = null) {
  if (activeAction.abort_reason !== null) return false;
  activeAction.abort_reason = reason;
  activeAction.abort_envelope_hash = abortEnvelopeHash;
  activeAction.abortController.abort();
  // A host verifier can synchronously re-enter userAbort() while issuing the final
  // authorization. Wait until that issuance settles so revocation binds the token it issued.
  if (activeAction.phase !== 'post_claim_authorizing'
    && typeof activeAction.request_boundary_cancellation === 'function') {
    activeAction.request_boundary_cancellation();
  }
  return true;
}

function appendAbortRequestInternal(kernel, trusted) {
  const internal = INTERNALS.get(kernel);
  if (!internal.header.acceptance_authority || internal.state.abort_request !== null) return null;
  return appendInternal(kernel, {
    type: 'abort_request',
    emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
    payload: { reason: trusted.payload.reason, envelope_hash: trusted.envelope_hash },
    skipAutomaticCheckpoint: true,
  });
}

function normalizeActionTimeoutMilliseconds(value) {
  if (value === undefined) return DEFAULT_ACTION_TIMEOUT_MILLISECONDS;
  if (!Number.isInteger(value) || value < 1000 || value > 3600000) {
    throw new OwnerKernelError(
      'action timeout must be an integer between 1000 and 3600000 milliseconds',
      'INVALID_ACTION_TIMEOUT',
    );
  }
  return value;
}

function normalizeAcceptanceTimeoutMilliseconds(value) {
  if (value === undefined) return 300000;
  if (!Number.isInteger(value) || value < 1000 || value > 3600000) {
    throw new OwnerKernelError(
      'acceptance timeout must be an integer between 1000 and 3600000 milliseconds',
      'INVALID_ACCEPTANCE_TIMEOUT',
    );
  }
  return value;
}

function awaitAcceptanceTimeout(promise, timeoutMilliseconds, { onTimeout = null, message = null } = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (onTimeout) {
        Promise.resolve().then(onTimeout).catch(() => {
          // The host coordinator owns durable cancellation; a late cleanup failure must not
          // turn a timed-out caller into a false successful acceptance.
        });
      }
      reject(new OwnerKernelBlockedError(
        message || 'the host acceptance coordinator did not return before the transaction deadline',
        'ACCEPTANCE_TRANSACTION_TIMEOUT',
      ));
    }, timeoutMilliseconds);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function makeAcceptanceAttempt(internal, {
  expectedEventHead,
  expectedWitnessHead,
  attemptStartedAt,
} = {}) {
  const attemptId = `acceptance-attempt-${crypto.randomBytes(16).toString('hex')}`;
  const attemptHash = sha256(canonicalJson({
    run_id: internal.header.run_id,
    policy_hash: internal.header.policy_hash,
    contract_hash: internal.header.contract_hash,
    coordinator_binding_hash: internal.acceptanceAuthority.binding_hash,
    attempt_id: attemptId,
    expected_event_head: expectedEventHead,
    expected_witness_head: expectedWitnessHead,
    intent_id: internal.state.current_intent_id,
    attempt_started_at: attemptStartedAt,
  }));
  return {
    attempt_id: attemptId,
    attempt_hash: attemptHash,
    expected_event_head: expectedEventHead,
    expected_witness_head: expectedWitnessHead,
    intent_id: internal.state.current_intent_id,
    attempt_started_at: attemptStartedAt,
  };
}

function coordinatorCancellationRequest(internal, attempt, {
  transactionId = null,
  fence = null,
  reason,
} = {}) {
  return {
    run_id: internal.header.run_id,
    coordinator_binding_hash: internal.acceptanceAuthority.binding_hash,
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    transaction_id: transactionId,
    fence,
    reason,
  };
}

function requireCoordinatorAbortDisposition(value, attempt) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.ok !== true || value.attempt_id !== attempt.attempt_id
    || value.attempt_hash !== attempt.attempt_hash
    || !['queued', 'accepted', 'cancelled'].includes(value.disposition)) {
    throw new OwnerKernelError(
      'acceptance coordinator did not return a valid durable abort-ordering disposition',
      'ACCEPTANCE_COORDINATOR_REJECTED',
    );
  }
  return value;
}

async function normalizeCoordinatorResolution(internal, attempt, value, {
  allowedDispositions = ['released', 'cancelled', 'aborted'],
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.ok !== true || value.run_id !== internal.header.run_id
    || value.attempt_id !== attempt.attempt_id || value.attempt_hash !== attempt.attempt_hash
    || !allowedDispositions.includes(value.disposition)
    || !value.coordinator_resolution || typeof value.coordinator_resolution !== 'object'
    || Array.isArray(value.coordinator_resolution)) {
    throw new OwnerKernelError(
      'acceptance coordinator did not return a final resolution bound to the active attempt',
      'ACCEPTANCE_COORDINATOR_REJECTED',
    );
  }
  const commitment = cloneCanonical(value.coordinator_resolution);
  const expected = {
    run_id: internal.header.run_id,
    coordinator_binding_hash: internal.acceptanceAuthority.binding_hash,
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    disposition: value.disposition,
    coordinator_resolution: commitment,
  };
  const verified = assertSynchronousCoordinatorVerification(
    internal.acceptanceAuthority.verifyResolution(expected),
    'acceptance coordinator verifyResolution()',
  );
  if (verified !== true && (!verified || verified.ok !== true)) {
    throw new OwnerKernelError(
      'acceptance coordinator resolution commitment did not verify independently',
      'ACCEPTANCE_COORDINATOR_REJECTED',
    );
  }
  return {
    disposition: value.disposition,
    coordinator_resolution: commitment,
    resolution_hash: sha256(canonicalJson(commitment)),
  };
}

async function appendAcceptanceResolutionInternal(kernel, attempt, {
  disposition,
  coordinatorResolution,
} = {}) {
  const internal = INTERNALS.get(kernel);
  if (!internal.state.acceptance_attempt || internal.state.acceptance_attempt.status !== 'pending') return null;
  if (!['released', 'cancelled', 'aborted'].includes(disposition)) {
    throw new OwnerKernelError('acceptance attempt resolution requires a final non-terminal disposition', 'ACCEPTANCE_COORDINATOR_REJECTED');
  }
  if (!coordinatorResolution || coordinatorResolution.disposition !== disposition
    || !coordinatorResolution.coordinator_resolution
    || !isSha256(coordinatorResolution.resolution_hash)) {
    throw new OwnerKernelError('acceptance attempt resolution requires a verified coordinator commitment', 'ACCEPTANCE_COORDINATOR_REJECTED');
  }
  return appendInternal(kernel, {
    type: 'acceptance_resolution',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-acceptance:${internal.acceptanceAuthority.binding.identity}` },
    payload: {
      attempt_id: attempt.attempt_id,
      attempt_hash: attempt.attempt_hash,
      disposition,
      resolution_hash: coordinatorResolution.resolution_hash,
      coordinator_resolution: coordinatorResolution.coordinator_resolution,
    },
    skipAutomaticCheckpoint: true,
  });
}

function appendLateUserAbortControl(kernel, abort) {
  const internal = INTERNALS.get(kernel);
  if (!abort || internal.state.status !== 'complete' || internal.state.terminal_reason !== 'accepted') {
    return null;
  }
  const attempt = internal.state.acceptance_attempt;
  const acceptance = internal.state.acceptance;
  if (!attempt || attempt.status !== 'accepted' || !acceptance || !acceptance.coordinator_commitment) {
    throw new OwnerKernelBlockedError(
      'accepted terminal state is missing the coordinator proof needed to record a late user abort',
      'ACCEPTANCE_CONTROL_UNRESOLVED',
    );
  }
  return appendInternal(kernel, {
    type: 'terminal_control',
    emitter: { kind: 'user', identity: abort.identity, channel: abort.channel },
    payload: {
      control_id: nextIdentifier(internal, 'terminal-control'),
      kind: 'late_user_abort',
      reason: abort.reason,
      envelope_hash: abort.envelope_hash,
      attempt_id: attempt.attempt_id,
      attempt_hash: attempt.attempt_hash,
      acceptance_id: acceptance.acceptance_id,
      coordinator_commitment_hash: sha256(canonicalJson(acceptance.coordinator_commitment)),
    },
    skipAutomaticCheckpoint: true,
  });
}

function verifyOwnerOperation(kernel, { capability, ownerTurnEnvelope, operation }) {
  const internal = INTERNALS.get(kernel);
  const now = nowIso(internal.clock);
  const capabilityRecord = assertCapability(kernel, capability, now);
  const principal = assertCurrentQualification(kernel, operation, now);
  const trustedTurn = requireVerifiedEnvelope(
    requireAdapter(internal.adapters, 'ownerTurnVerifier')(ownerTurnEnvelope, {
      run_id: internal.header.run_id,
      principal_id: principal.identity,
    }),
    `${operation} owner turn envelope`,
    { runId: internal.header.run_id, principalId: principal.identity },
  );
  if (trustedTurn.identity !== capabilityRecord.principalId || trustedTurn.identity !== principal.identity) {
    throw new OwnerKernelBlockedError(`${operation} owner turn does not bind the active principal`, 'OWNER_TURN_MISMATCH');
  }
  return { now, principal, trustedTurn };
}

function archiveVerifiedEvidence(kernel, verifiedPayload) {
  const internal = INTERNALS.get(kernel);
  const archived = requireAdapter(internal.adapters, 'evidenceArchiver')({
    run_id: internal.header.run_id,
    verified_evidence: cloneCanonical(verifiedPayload),
  });
  if (!archived || typeof archived !== 'object' || typeof archived.uri !== 'string' || !isSha256(archived.sha256)) {
    throw new OwnerKernelError('evidenceArchiver did not return a durable content-addressed reference', 'EVIDENCE_ARCHIVE_FAILED');
  }
  return { uri: archived.uri, sha256: archived.sha256.toLowerCase() };
}

function settlePendingActionClaimForResume(kernel) {
  const internal = INTERNALS.get(kernel);
  const pending = Object.values(internal.state.action_claims || {}).filter((claim) => claim.outcome === null);
  if (pending.length === 0) return null;
  if (pending.length !== 1 || !internal.header.acceptance_authority || !hasActionAuthority(internal)) {
    throw new OwnerKernelBlockedError(
      'an unresolved host action claim requires durable recovery before another Kernel can resume the run',
      'ACTION_CLAIM_RECOVERY_REQUIRED',
    );
  }
  const claim = pending[0];
  const verified = requireVerifiedEnvelope(
    requireAdapter(internal.adapters, 'pendingActionReconciler')({
      run_id: internal.header.run_id,
      authority_hash: internal.header.authority_hash,
      claim_id: claim.claim_id,
      claim: cloneCanonical(claim),
      witness_stream_id: internal.header.witness_stream_id,
      claim_event_hash: claim.claim_event_hash,
      claim_witness_head: claim.claim_witness_head,
    }, { run_id: internal.header.run_id }),
    'pending action reconciliation result',
    { runId: internal.header.run_id },
  );
  const receiptBinding = internal.actionAuthority.receipt_verifier_binding;
  if (verified.identity !== receiptBinding.identity
    || verified.payload.attestation_sha256 !== receiptBinding.attestation_hash
    || verified.payload.verification_path !== 'pending_action_reconciliation'
    || verified.payload.claim_id !== claim.claim_id || !isSha256(verified.payload.reconciliation_hash)) {
    throw new OwnerKernelError(
      'pending action reconciliation is not independently bound to the frozen receipt verifier and claim',
      'UNVERIFIED_ACTION_RECONCILIATION',
    );
  }
  return appendInternal(kernel, {
    type: 'evidence',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-pending-recovery:${verified.channel}` },
    payload: {
      evidence_id: nextIdentifier(internal, 'evidence'),
      evidence_kind: 'action_outcome',
      claim_id: claim.claim_id,
      decision_id: claim.decision_id,
      outcome: 'unknown',
      receipt_ref: null,
      broker_receipt: null,
      executor_binding_hash: claim.executor_binding_hash,
      execution_permit_hash: claim.execution_permit_hash,
      execution_authorization_hash: null,
      authorization_id: null,
      claim_event_hash: claim.claim_event_hash,
      claim_witness_head: claim.claim_witness_head,
      permit_state: null,
      boundary_effect_id: null,
      boundary_state_version: null,
      boundary_attestation_hash: null,
      effect_at: null,
      cancellation: null,
      observed_action_descriptor_hash: null,
      error_code: 'pending_claim_recovered_unknown',
      recovery_ref: archiveVerifiedEvidence(kernel, verified.payload),
      reconciliation_hash: verified.payload.reconciliation_hash,
    },
  });
}

function assertActionControlPlaneUnlocked(kernel, operation) {
  const internal = INTERNALS.get(kernel);
  if (internal.state.status === 'complete') {
    throw new OwnerKernelBlockedError(
      `${operation} cannot proceed after terminal completion`,
      'TERMINAL_COMPLETION',
    );
  }
  if (internal.state.acceptance_attempt && internal.state.acceptance_attempt.status === 'pending') {
    throw new OwnerKernelBlockedError(
      `${operation} cannot proceed until the durable acceptance attempt is resolved`,
      'ACCEPTANCE_RECOVERY_REQUIRED',
    );
  }
  if (internal.acceptanceLock) {
    throw new OwnerKernelBlockedError(
      `${operation} cannot be ordered while the serializable acceptance transaction is in flight`,
      'ACCEPTANCE_CONTROL_LOCKED',
    );
  }
  if (hasActionAuthority(internal) && internal.actionLock) {
    throw new OwnerKernelBlockedError(
      `${operation} cannot be ordered while an authorized host action is in flight`,
      'ACTION_CONTROL_LOCKED',
    );
  }
  assertNoPendingActionClaim(kernel, operation);
}

function assertActionDecisionUsable(kernel, decisionId) {
  const internal = INTERNALS.get(kernel);
  const decision = internal.state.decisions[decisionId];
  if (!decision) throw new OwnerKernelBlockedError('action decision does not exist', 'ACTION_DECISION_UNKNOWN');
  if (decision.suspended || decision.intent_id !== internal.state.current_intent_id) {
    throw new OwnerKernelBlockedError('action decision is suspended or superseded', 'ACTION_DECISION_SUSPENDED');
  }
  if (!Number.isInteger(decision.claimed_uses) || decision.claimed_uses < 0
    || decision.claimed_uses >= actionUseLimit(decision)) {
    throw new OwnerKernelBlockedError('action decision has no remaining authorized use', 'ACTION_USE_EXHAUSTED');
  }
  assertNoPendingActionClaim(kernel, 'action execution');
  if (internal.state.block_reasons.length > 0) {
    throw new OwnerKernelBlockedError('action execution is blocked pending unresolved governance state', 'ACTION_BLOCKED');
  }
  return decision;
}

function shouldCheckpoint(internal) {
  const lastCheckpointIndex = internal.events.reduce((last, event, index) => (
    event.type === 'checkpoint' ? index : last
  ), -1);
  const closedSinceCheckpoint = internal.events
    .slice(lastCheckpointIndex + 1)
    .filter((event) => event.type !== 'checkpoint').length;
  return closedSinceCheckpoint >= internal.policy.checkpoint_interval_closed_events;
}

function appendInternal(kernel, { type, emitter, payload, skipAutomaticCheckpoint = false }) {
  const internal = INTERNALS.get(kernel);
  if (internal.appending) {
    throw new OwnerKernelError('Owner Kernel append is not re-entrant', 'APPEND_REENTRANCY_BLOCKED');
  }
  internal.appending = true;
  let event;
  let checkpointDue = false;
  try {
    const emittedAt = nowIso(internal.clock);
    const provisional = prepareEvent({
      sequence: internal.state.sequence + 1,
      runId: internal.header.run_id,
      type,
      emittedAt,
      emitter,
      policyHash: internal.header.policy_hash,
      contractHash: internal.header.contract_hash,
      authorityHash: internal.header.authority_hash,
      acceptanceAuthorityHash: internal.header.acceptance_authority_hash,
      semanticAuthorityHash: internal.header.semantic_authority_hash,
      payload,
      prevEventHash: internal.state.event_head,
    });

    // Validate the state transition before consuming an external witness sequence.
    applyEvent(internal.state, {
      ...provisional,
      witness: { witness_head: internal.state.witness_head },
    }, internal.policy);

    const witnessAppendRequest = {
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      sequence: provisional.sequence,
      event_hash: provisional.event_hash,
      previous_witness_head: internal.state.witness_head,
      type,
    };
    const receipt = internal.requireCompareAndAppend
      ? internal.witness.appendIfHead({
        ...witnessAppendRequest,
        expected_witness_head: internal.state.witness_head,
      })
      : internal.witness.append(witnessAppendRequest);
    verifyReceiptShape(receipt, {
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      sequence: provisional.sequence,
      event_hash: provisional.event_hash,
      previous_witness_head: internal.state.witness_head,
    });
    if (!internal.witness.verify(receipt)) {
      throw new OwnerKernelError('witness did not verify its own appended receipt', 'WITNESS_REJECTED');
    }
    event = buildEvent({
      sequence: provisional.sequence,
      runId: provisional.run_id,
      type: provisional.type,
      emittedAt: provisional.emitted_at,
      emitter: provisional.emitter,
      policyHash: provisional.policy_hash,
      contractHash: provisional.contract_hash,
      authorityHash: provisional.authority_hash,
      acceptanceAuthorityHash: provisional.acceptance_authority_hash,
      semanticAuthorityHash: provisional.semantic_authority_hash,
      payload: provisional.payload,
      prevEventHash: provisional.prev_event_hash,
      witness: receipt,
    });
    internal.state = applyEvent(internal.state, event, internal.policy);
    internal.events.push(event);
    checkpointDue = !skipAutomaticCheckpoint && type !== 'checkpoint' && shouldCheckpoint(internal);
  } finally {
    internal.appending = false;
  }
  if (checkpointDue && hasActionAuthority(internal)) {
    const checkpointNow = nowIso(internal.clock);
    assertCurrentWitnessHead(kernel);
    assertCurrentHostCapability(kernel, 'checkpoint', checkpointNow);
  }
  if (checkpointDue) appendCheckpointInternal(kernel, 'event_interval');
  return cloneCanonical(event);
}

async function appendBatchInternal(kernel, entries, { batchId, appendBatch = null } = {}) {
  const internal = INTERNALS.get(kernel);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new OwnerKernelError('Owner Kernel batch append requires one or more entries', 'INVALID_OWNER_BATCH');
  }
  if (internal.appending) {
    throw new OwnerKernelError('Owner Kernel append is not re-entrant', 'APPEND_REENTRANCY_BLOCKED');
  }
  if (typeof internal.witness.appendBatchIfHead !== 'function') {
    throw new OwnerKernelBlockedError(
      'serializable acceptance requires an atomic witness appendBatchIfHead operation',
      'WITNESS_BATCH_REQUIRED',
    );
  }
  if (typeof internal.witness.verifyBatch !== 'function') {
    throw new OwnerKernelBlockedError(
      'serializable acceptance requires witness atomic batch receipt verification',
      'WITNESS_BATCH_REQUIRED',
    );
  }
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(batchId)) {
    throw new OwnerKernelError('Owner Kernel batch append requires a bounded batch_id', 'INVALID_OWNER_BATCH');
  }
  internal.appending = true;
  try {
    const provisionalEvents = [];
    let previousEventHash = internal.state.event_head;
    for (const [index, entry] of entries.entries()) {
      const payload = typeof entry.payload === 'function'
        ? entry.payload({
          previous_event: provisionalEvents.length === 0 ? null : provisionalEvents[provisionalEvents.length - 1],
          sequence: internal.state.sequence + index + 1,
        })
        : entry.payload;
      const provisional = prepareEvent({
        sequence: internal.state.sequence + index + 1,
        runId: internal.header.run_id,
        type: entry.type,
        emittedAt: nowIso(internal.clock),
        emitter: entry.emitter,
        policyHash: internal.header.policy_hash,
        contractHash: internal.header.contract_hash,
        authorityHash: internal.header.authority_hash,
        acceptanceAuthorityHash: internal.header.acceptance_authority_hash,
        semanticAuthorityHash: internal.header.semantic_authority_hash,
        payload,
        prevEventHash: previousEventHash,
      });
      provisionalEvents.push(provisional);
      previousEventHash = provisional.event_hash;
    }

    // State validation needs the same batch envelope that the authoritative witness will
    // attach. Build the whole immutable event set first, then replay it with deterministic
    // synthetic receipts. This catches an invalid terminal pair before coordinator.commit().
    const batchEventHashes = provisionalEvents.map((event) => event.event_hash);
    const validationBatchCommitment = sha256(canonicalJson({
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      batch_id: batchId,
      expected_witness_head: internal.state.witness_head,
      event_hashes: batchEventHashes,
    }));
    let simulatedState = internal.state;
    let simulatedWitnessHead = internal.state.witness_head;
    for (const [index, provisional] of provisionalEvents.entries()) {
      const receiptBase = {
        run_id: internal.header.run_id,
        stream_id: internal.witness.streamId,
        sequence: provisional.sequence,
        event_hash: provisional.event_hash,
        previous_witness_head: simulatedWitnessHead,
      };
      const validationWitnessHead = sha256(canonicalJson(receiptBase));
      simulatedState = applyEvent(simulatedState, {
        ...provisional,
        witness: {
          ...receiptBase,
          witness_head: validationWitnessHead,
          batch_id: batchId,
          batch_index: index,
          batch_size: provisionalEvents.length,
          batch_event_hashes: [...batchEventHashes],
          batch_commitment: validationBatchCommitment,
        },
      }, internal.policy, { preflight: true });
      simulatedWitnessHead = validationWitnessHead;
    }
    const batchRequest = {
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      expected_witness_head: internal.state.witness_head,
      batch_id: batchId,
      batch_commitment: validationBatchCommitment,
      events: provisionalEvents.map((event) => ({
        sequence: event.sequence,
        event_hash: event.event_hash,
        type: event.type,
      })),
    };
    const response = appendBatch === null
      ? await internal.witness.appendBatchIfHead(batchRequest)
      : await appendBatch(batchRequest, provisionalEvents);
    if (!response || typeof response !== 'object' || !Array.isArray(response.receipts)
      || response.receipts.length !== provisionalEvents.length) {
      throw new OwnerKernelError('witness atomic batch returned invalid receipts', 'INVALID_WITNESS_RECEIPT');
    }
    let previousWitnessHead = internal.state.witness_head;
    const events = provisionalEvents.map((provisional, index) => {
      const receipt = response.receipts[index];
      verifyReceiptShape(receipt, {
        run_id: internal.header.run_id,
        stream_id: internal.witness.streamId,
        sequence: provisional.sequence,
        event_hash: provisional.event_hash,
        previous_witness_head: previousWitnessHead,
      });
      if (receipt.batch_id !== batchId || receipt.batch_index !== index
        || receipt.batch_size !== provisionalEvents.length
        || receipt.batch_commitment !== validationBatchCommitment
        || canonicalJson(receipt.batch_event_hashes) !== canonicalJson(batchEventHashes)) {
        throw new OwnerKernelError('witness atomic batch receipt does not bind the requested immutable event set', 'INVALID_WITNESS_RECEIPT');
      }
      if (!internal.witness.verify(receipt)) {
        throw new OwnerKernelError('witness did not verify an atomic batch receipt', 'WITNESS_REJECTED');
      }
      previousWitnessHead = receipt.witness_head;
      return buildEvent({
        sequence: provisional.sequence,
        runId: provisional.run_id,
        type: provisional.type,
        emittedAt: provisional.emitted_at,
        emitter: provisional.emitter,
        policyHash: provisional.policy_hash,
        contractHash: provisional.contract_hash,
        authorityHash: provisional.authority_hash,
        acceptanceAuthorityHash: provisional.acceptance_authority_hash,
        semanticAuthorityHash: provisional.semantic_authority_hash,
        payload: provisional.payload,
        prevEventHash: provisional.prev_event_hash,
        witness: receipt,
      });
    });
    if (!internal.witness.verifyBatch(events.map((event) => event.witness))) {
      throw new OwnerKernelError('witness did not verify an atomic acceptance batch receipt set', 'WITNESS_REJECTED');
    }
    for (const event of events) {
      internal.state = applyEvent(internal.state, event, internal.policy);
      internal.events.push(event);
    }
    return events.map((event) => cloneCanonical(event));
  } finally {
    internal.appending = false;
  }
}

async function importAcceptedAttemptBatch(kernel, response) {
  const internal = INTERNALS.get(kernel);
  const attempt = internal.state.acceptance_attempt;
  if (!attempt || attempt.status !== 'pending') {
    throw new OwnerKernelBlockedError('there is no pending acceptance attempt to recover', 'ACCEPTANCE_RECOVERY_REQUIRED');
  }
  if (!response || typeof response !== 'object' || response.ok !== true
    || response.run_id !== internal.header.run_id
    || response.attempt_id !== attempt.attempt_id || response.attempt_hash !== attempt.attempt_hash
    || response.disposition !== 'accepted' || response.lease_released !== true
    || !Array.isArray(response.event_records) || response.event_records.length !== 2
    || !Array.isArray(response.receipts) || response.receipts.length !== 2
    || !response.coordinator_commitment || typeof response.coordinator_commitment !== 'object') {
    throw new OwnerKernelBlockedError(
      'acceptance coordinator cannot reconstruct one exact accepted terminal batch for the durable attempt',
      'ACCEPTANCE_RECOVERY_REQUIRED',
    );
  }
  const provisionalEvents = response.event_records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new OwnerKernelBlockedError('coordinator recovery batch contains an invalid event record', 'ACCEPTANCE_RECOVERY_REQUIRED');
    }
    const rebuilt = prepareEvent({
      sequence: record.sequence,
      runId: record.run_id,
      type: record.type,
      emittedAt: record.emitted_at,
      emitter: record.emitter,
      policyHash: record.policy_hash,
      contractHash: record.contract_hash,
      authorityHash: record.authority_hash,
      acceptanceAuthorityHash: record.acceptance_authority_hash,
      semanticAuthorityHash: record.semantic_authority_hash,
      payload: record.payload,
      prevEventHash: record.prev_event_hash,
    });
    if (canonicalJson(rebuilt) !== canonicalJson(record)
      || rebuilt.sequence !== internal.state.sequence + index + 1
      || (index === 0 && rebuilt.prev_event_hash !== internal.state.event_head)
      || (index > 0 && rebuilt.prev_event_hash !== response.event_records[index - 1].event_hash)) {
      throw new OwnerKernelBlockedError('coordinator recovery batch is not the exact next ledger event chain', 'ACCEPTANCE_RECOVERY_REQUIRED');
    }
    return rebuilt;
  });
  if (provisionalEvents[0].type !== 'acceptance' || provisionalEvents[1].type !== 'complete') {
    throw new OwnerKernelBlockedError('coordinator recovery batch is not one terminal acceptance pair', 'ACCEPTANCE_RECOVERY_REQUIRED');
  }
  const firstPayload = provisionalEvents[0].payload;
  const receipts = response.receipts.map((receipt, index) => {
    const provisional = provisionalEvents[index];
    const expectedPrevious = index === 0
      ? internal.state.witness_head
      : response.receipts[index - 1].witness_head;
    verifyReceiptShape(receipt, {
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      sequence: provisional.sequence,
      event_hash: provisional.event_hash,
      previous_witness_head: expectedPrevious,
    });
    if (!internal.witness.verify(receipt)) {
      throw new OwnerKernelBlockedError('coordinator recovery batch has an unverifiable witness receipt', 'ACCEPTANCE_RECOVERY_REQUIRED');
    }
    return cloneCanonical(receipt);
  });
  if (!internal.witness.verifyBatch(receipts)
    || canonicalJson(receipts[0].coordinator_commitment) !== canonicalJson(response.coordinator_commitment)
    || canonicalJson(receipts[1].coordinator_commitment) !== canonicalJson(response.coordinator_commitment)) {
    throw new OwnerKernelBlockedError('coordinator recovery batch does not contain one verified immutable coordinator commitment', 'ACCEPTANCE_RECOVERY_REQUIRED');
  }
  const batch = {
    batch_id: receipts[0].batch_id,
    batch_commitment: receipts[0].batch_commitment,
    expected_witness_head: internal.state.witness_head,
    events: provisionalEvents.map((event) => ({
      sequence: event.sequence,
      event_hash: event.event_hash,
      type: event.type,
    })),
  };
  const verifiedCommit = assertSynchronousCoordinatorVerification(internal.acceptanceAuthority.verifyCommit({
    run_id: internal.header.run_id,
    coordinator_binding_hash: internal.acceptanceAuthority.binding_hash,
    attempt_id: attempt.attempt_id,
    attempt_hash: attempt.attempt_hash,
    transaction_id: firstPayload.transaction_id,
    fence: firstPayload.fence,
    expected_event_head: firstPayload.evaluated_event_head,
    expected_witness_head: firstPayload.evaluated_witness_head,
    expected_intent_id: firstPayload.intent_id,
    snapshot_hash: firstPayload.snapshot_hash,
    snapshot_at: firstPayload.snapshot_at,
    batch,
    disposition: 'accepted',
    coordinator_commitment: response.coordinator_commitment,
    receipts,
    event_records: cloneCanonical(provisionalEvents),
  }), 'acceptance coordinator verifyCommit()');
  if (verifiedCommit !== true && (!verifiedCommit || verifiedCommit.ok !== true)) {
    throw new OwnerKernelBlockedError('coordinator recovery batch commit proof did not verify independently', 'ACCEPTANCE_RECOVERY_REQUIRED');
  }
  const events = provisionalEvents.map((provisional, index) => buildEvent({
    sequence: provisional.sequence,
    runId: provisional.run_id,
    type: provisional.type,
    emittedAt: provisional.emitted_at,
    emitter: provisional.emitter,
    policyHash: provisional.policy_hash,
    contractHash: provisional.contract_hash,
    authorityHash: provisional.authority_hash,
    acceptanceAuthorityHash: provisional.acceptance_authority_hash,
    semanticAuthorityHash: provisional.semantic_authority_hash,
    payload: provisional.payload,
    prevEventHash: provisional.prev_event_hash,
    witness: receipts[index],
  }));
  for (const event of events) {
    internal.state = applyEvent(internal.state, event, internal.policy);
    internal.events.push(event);
  }
  return events.map((event) => cloneCanonical(event));
}

function appendCheckpointInternal(kernel, reason) {
  const internal = INTERNALS.get(kernel);
  const projection = stateProjection(internal.state);
  return appendInternal(kernel, {
    type: 'checkpoint',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-checkpoint' },
    payload: {
      checkpoint_id: nextIdentifier(internal, 'checkpoint'),
      ledger_head: internal.state.event_head,
      state_projection: projection,
      state_projection_hash: sha256(canonicalJson(projection)),
      // `reason` is intentionally not serialized: checkpoint state must be byte-identical across replay.
    },
    skipAutomaticCheckpoint: true,
  });
}

function checkTimeout(kernel) {
  const internal = INTERNALS.get(kernel);
  if (internal.acceptanceLock) return false;
  if (hasActionAuthority(internal) && internal.actionLock) return false;
  if (internal.state.status !== 'blocked' || internal.policy.max_blocked_duration_seconds === 0) return false;
  const blockedAt = new Date(internal.state.blocked_since).getTime();
  const now = new Date(nowIso(internal.clock)).getTime();
  if (now - blockedAt < internal.policy.max_blocked_duration_seconds * 1000) return false;
  appendInternal(kernel, {
    type: 'abort',
    emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-timeout' },
    payload: { reason: 'blocked_timeout' },
    skipAutomaticCheckpoint: true,
  });
  return true;
}

function beforeOperation(kernel) {
  const internal = INTERNALS.get(kernel);
  if (internal.recoveryOnly) {
    throw new OwnerKernelBlockedError(
      'this resumed Kernel is recovery-only; resume again with the intake-frozen action authority after acceptance recovery completes',
      'ACCEPTANCE_RECOVERY_REQUIRED',
    );
  }
  if (internal.state.status === 'complete') {
    throw new OwnerKernelBlockedError('the Owner Kernel run is already terminal', 'TERMINAL_COMPLETION');
  }
  if (checkTimeout(kernel)) {
    throw new OwnerKernelBlockedError('blocked duration elapsed; Kernel recorded timeout abort', 'BLOCKED_TIMEOUT');
  }
}

function mintDecisionInternal(kernel, {
  capability,
  ownerTurnEnvelope,
  actionClass,
  actionDescriptor,
  maxUses = 1,
  requireActionAuthority = false,
}) {
  if (requireActionAuthority) assertActionControlPlaneUnlocked(kernel, 'action decision mint');
  beforeOperation(kernel);
  const internal = INTERNALS.get(kernel);
  const now = nowIso(internal.clock);
  if (requireActionAuthority) {
    if (!hasActionAuthority(internal)) {
      throw new OwnerKernelBlockedError('action decisions require an authority-enabled Kernel run', 'ACTION_AUTHORITY_REQUIRED');
    }
    assertCurrentWitnessHead(kernel);
    assertCurrentHostCapability(kernel, 'decision', now);
    assertNoPendingActionClaim(kernel, 'action decision mint');
  } else if (hasActionAuthority(internal)) {
    throw new OwnerKernelBlockedError(
      'authority-enabled runs require mintActionDecision() for catalog-classified actions',
      'ACTION_AUTHORITY_REQUIRED',
    );
  }
  const capabilityRecord = assertCapability(kernel, capability, now);
  const principal = assertCurrentQualification(kernel, 'decision', now);
  const trustedTurn = requireVerifiedEnvelope(
    requireAdapter(internal.adapters, 'ownerTurnVerifier')(ownerTurnEnvelope, {
      run_id: internal.header.run_id,
      principal_id: principal.identity,
    }),
    'owner turn envelope',
    { runId: internal.header.run_id, principalId: principal.identity },
  );
  if (trustedTurn.identity !== capabilityRecord.principalId || trustedTurn.identity !== principal.identity) {
    throw new OwnerKernelBlockedError('owner turn envelope does not bind the active principal', 'OWNER_TURN_MISMATCH');
  }
  let canonicalDescriptor = cloneCanonical(actionDescriptor);
  let canonicalActionClass = actionClass;
  if (requireActionAuthority) {
    canonicalDescriptor = normalizeActionDescriptor(internal.policy, actionDescriptor, {
      declaredActionClass: actionClass,
    });
    canonicalActionClass = canonicalDescriptor.action_class;
  }
  const rule = internal.policy.approval_policy[canonicalActionClass];
  if (!rule) throw new OwnerKernelError('decision action_class is outside the frozen policy', 'UNKNOWN_ACTION_CLASS');
  const decisionId = nextIdentifier(internal, 'decision');
  const actionDescriptorHash = sha256(canonicalJson(canonicalDescriptor));
  const decisionPayload = {
    decision_id: decisionId,
    intent_id: internal.state.current_intent_id,
    principal_id: principal.identity,
    owner_turn_hash: trustedTurn.envelope_hash,
    action_class: canonicalActionClass,
    action_descriptor: canonicalDescriptor,
    action_descriptor_hash: actionDescriptorHash,
    requested_max_uses: maxUses,
    requires_approval: rule.requires_approval,
  };
  if (requireActionAuthority) {
    const catalogEntry = internal.policy.action_catalog.find((entry) => entry.id === canonicalDescriptor.catalog_id);
    if (!catalogEntry) {
      throw new OwnerKernelBlockedError('action descriptor catalog entry is unavailable', 'ACTION_CLASSIFICATION_BLOCKED');
    }
    if (catalogEntry.requires_challenge && internal.state.acceptance_version !== 2) {
      throw new OwnerKernelBlockedError(
        'this legacy ledger cannot authorize a challenge-required action without a schema_version 2 acceptance protocol',
        'ACTION_CHALLENGE_PROTOCOL_REQUIRED',
      );
    }
    if (catalogEntry.requires_challenge && internal.state.acceptance_version === 2) {
      const challenge = qualifiedActionChallengeCandidates(internal, actionDescriptorHash, now)[0] || null;
      if (challenge === null) {
        throw new OwnerKernelBlockedError(
          'this frozen catalog action requires a current qualified independent challenge before authorization',
          'ACTION_CHALLENGE_REQUIRED',
        );
      }
      decisionPayload.action_challenge_id = challenge.challenge_id;
      decisionPayload.action_challenge_candidate_set_hash = challenge.candidate_set_hash;
    }
  }
  decisionPayload.decision_content_hash = sha256(canonicalJson(decisionContent(decisionPayload)));
  decisionPayload.intent_relation = internal.state.intents[decisionPayload.intent_id]
    .explicit_action_hashes.includes(actionDescriptorHash)
    ? 'explicit'
    : 'derived';
  return appendInternal(kernel, {
    type: 'decision',
    emitter: { kind: 'owner', identity: principal.identity, channel: trustedTurn.channel },
    payload: decisionPayload,
  });
}

class OwnerKernel {
  constructor({
    header,
    policy,
    contract,
    state,
    events,
    witness,
    adapters,
    clock,
    capabilityNonce,
    actionAuthority = null,
    acceptanceAuthority = null,
    recoveryOnly = false,
  }) {
    INTERNALS.set(this, {
      header,
      policy,
      contract,
      state,
      events,
      witness,
      adapters: adapters || {},
      clock: clock || (() => new Date()),
      capabilityNonce,
      actionAuthority,
      acceptanceAuthority,
      recoveryOnly,
      requireCompareAndAppend: Boolean(
        header.authority || header.acceptance_authority || header.semantic_authority,
      ),
      appending: false,
      acceptanceLock: false,
      acceptanceTransaction: null,
      actionLock: false,
      activeAction: null,
      timeoutMonitor: null,
    });
  }

  static start({
    runId,
    governanceConfig,
    modeOverride,
    acceptanceContract,
    initialIntentEnvelope,
    initialOwnerId,
    witness,
    adapters,
    clock,
    allowTestWitness = false,
    actionAuthority = null,
    allowTestActionExecutor = false,
    acceptanceAuthority = null,
    allowTestAcceptanceCoordinator = false,
    semanticAuthority = null,
    nonceFactory,
  }) {
    assertWitnessAdapter(witness, { allowTestWitness });
    requireAdapter(adapters, 'userInputVerifier');
    requireAdapter(adapters, 'ownerTurnVerifier');
    requireAdapter(adapters, 'principalResolver');
    requireAdapter(adapters, 'qualificationVerifier');
    const resolvedPolicy = resolveGovernancePolicy(governanceConfig, { modeOverride });
    const frozenContract = freezeAcceptanceContract(acceptanceContract);
    if (resolvedPolicy.policy.action_catalog.some((entry) => entry.requires_challenge)
      && frozenContract.contract.schema_version !== 2) {
      throw new OwnerKernelBlockedError(
        'challenge-required catalog actions require a schema_version 2 acceptance protocol',
        'ACTION_CHALLENGE_PROTOCOL_REQUIRED',
      );
    }
    const nonce = typeof nonceFactory === 'function'
      ? nonceFactory()
      : crypto.randomBytes(32).toString('hex');
    if (typeof nonce !== 'string' || nonce.length < 32) {
      throw new OwnerKernelError('nonceFactory must return a high-entropy string', 'INVALID_CAPABILITY_NONCE');
    }
    const createdAt = nowIso(clock);
    let normalizedActionAuthority = null;
    let normalizedAcceptanceAuthority = null;
    let intakeAssessment = null;
    if (resolvedPolicy.policy.action_catalog.length > 0) {
      if (!actionAuthority) {
        throw new OwnerKernelBlockedError(
          'a frozen action catalog requires an enforced host action authority at intake',
          'ACTION_AUTHORITY_REQUIRED',
        );
      }
      normalizedActionAuthority = normalizeActionAuthority(resolvedPolicy.policy, actionAuthority, {
        allowTestExecutor: allowTestActionExecutor,
        now: new Date(createdAt),
      });
    } else if (actionAuthority !== null && actionAuthority !== undefined) {
      throw new OwnerKernelError(
        'actionAuthority is not allowed when the frozen governance catalog is empty',
        'ACTION_CLASSIFICATION_BLOCKED',
      );
    }
    if (frozenContract.contract.schema_version === 2) {
      if (!acceptanceAuthority) {
        throw new OwnerKernelBlockedError(
          'a schema_version 2 acceptance contract requires an enforced host acceptance coordinator at intake',
          'ACCEPTANCE_COORDINATOR_REQUIRED',
        );
      }
      normalizedAcceptanceAuthority = normalizeAcceptanceAuthority(acceptanceAuthority, {
        allowTestCoordinator: allowTestAcceptanceCoordinator,
      });
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBatch: true,
        requireBinding: true,
      });
      const initialWitnessHead = witness.getHead();
      if (initialWitnessHead !== null && !isSha256(initialWitnessHead)) {
        throw new OwnerKernelBlockedError('witness getHead() returned an invalid head', 'WITNESS_HEAD_INVALID');
      }
      if (initialWitnessHead !== null) {
        throw new OwnerKernelBlockedError(
          'a new acceptance-enabled Kernel run requires an empty external witness stream',
          'WITNESS_HEAD_STALE',
        );
      }
    } else if (acceptanceAuthority !== null && acceptanceAuthority !== undefined) {
      throw new OwnerKernelError(
        'acceptanceAuthority is only allowed for a schema_version 2 acceptance contract',
        'ACCEPTANCE_COORDINATOR_MISMATCH',
      );
    }
    if (normalizedActionAuthority !== null) {
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBinding: true,
      });
      const initialWitnessHead = witness.getHead();
      if (initialWitnessHead !== null && !isSha256(initialWitnessHead)) {
        throw new OwnerKernelBlockedError('witness getHead() returned an invalid head', 'WITNESS_HEAD_INVALID');
      }
      if (initialWitnessHead !== null) {
        throw new OwnerKernelBlockedError(
          'a new authority-enabled Kernel run requires an empty external witness stream',
          'WITNESS_HEAD_STALE',
        );
      }
      const witnessBinding = normalizeWitnessBinding(witness);
      assertIndependentAuthorityBindings([
        { role: 'host capability verifier', binding: normalizedActionAuthority.host_capability_verifier_binding },
        { role: 'executor', binding: normalizedActionAuthority.executor_binding },
        { role: 'receipt verifier', binding: normalizedActionAuthority.receipt_verifier_binding },
        { role: 'witness', binding: witnessBinding },
        ...(normalizedActionAuthority.capability.broker === null
          ? []
          : [{ role: 'broker', binding: normalizedActionAuthority.capability.broker }]),
      ], { label: 'action authority witness binding' });
      intakeAssessment = assessAuthorityHostCapability(normalizedActionAuthority, {
        runId,
        policyHash: resolvedPolicy.policy_hash,
        operation: 'intake',
        now: createdAt,
      });
      if (!intakeAssessment.ok) {
        throw new OwnerKernelBlockedError(
          'host capability verification failed before autonomous intake',
          'HOST_CAPABILITY_BLOCKED',
        );
      }
    }
    if (normalizedAcceptanceAuthority !== null) {
      const bindings = [
        { role: 'acceptance coordinator', binding: normalizedAcceptanceAuthority.binding },
        { role: 'witness', binding: normalizeWitnessBinding(witness) },
      ];
      if (normalizedActionAuthority !== null) {
        bindings.push(
          { role: 'host capability verifier', binding: normalizedActionAuthority.host_capability_verifier_binding },
          { role: 'executor', binding: normalizedActionAuthority.executor_binding },
          { role: 'receipt verifier', binding: normalizedActionAuthority.receipt_verifier_binding },
          ...(normalizedActionAuthority.capability.broker === null
            ? []
            : [{ role: 'broker', binding: normalizedActionAuthority.capability.broker }]),
        );
      }
      assertIndependentAuthorityBindings(bindings, { label: 'acceptance coordinator binding' });
    }
    if (semanticAuthority !== null && semanticAuthority !== undefined) {
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBinding: true,
      });
      const initialWitnessHead = witness.getHead();
      if (initialWitnessHead !== null && !isSha256(initialWitnessHead)) {
        throw new OwnerKernelBlockedError('witness getHead() returned an invalid head', 'WITNESS_HEAD_INVALID');
      }
      if (initialWitnessHead !== null) {
        throw new OwnerKernelBlockedError(
          'a new semantic-authority Kernel run requires an empty external witness stream',
          'WITNESS_HEAD_STALE',
        );
      }
    }
    const header = createLedgerHeader({
      runId,
      policy: resolvedPolicy.policy,
      policyHash: resolvedPolicy.policy_hash,
      contract: frozenContract.contract,
      contractHash: frozenContract.contract_hash,
      witnessStreamId: witness.streamId,
      capabilityNonceCommitment: sha256(nonce),
      createdAt,
      authority: normalizedActionAuthority === null ? null : {
        schema_version: 1,
        host_capability: normalizedActionAuthority.capability,
        host_capability_hash: normalizedActionAuthority.capability_hash,
        host_capability_verifier_binding: normalizedActionAuthority.host_capability_verifier_binding,
        host_capability_verifier_binding_hash: normalizedActionAuthority.host_capability_verifier_binding_hash,
        executor_binding: normalizedActionAuthority.executor_binding,
        executor_binding_hash: normalizedActionAuthority.executor_binding_hash,
        receipt_verifier_binding: normalizedActionAuthority.receipt_verifier_binding,
        receipt_verifier_binding_hash: normalizedActionAuthority.receipt_verifier_binding_hash,
        witness_binding: normalizeWitnessBinding(witness),
        witness_binding_hash: sha256(canonicalJson(normalizeWitnessBinding(witness))),
        intake_observation_hash: intakeAssessment.observation_hash,
        intake_probe_nonce_commitment: intakeAssessment.probe_nonce_commitment,
      },
      acceptanceAuthority: normalizedAcceptanceAuthority === null ? null : {
        binding: normalizedAcceptanceAuthority.binding,
        binding_hash: normalizedAcceptanceAuthority.binding_hash,
        witness_binding: normalizeWitnessBinding(witness),
        witness_binding_hash: sha256(canonicalJson(normalizeWitnessBinding(witness))),
      },
      semanticAuthority,
      witness,
    });
    const kernel = new OwnerKernel({
      header,
      policy: resolvedPolicy.policy,
      contract: frozenContract.contract,
      state: makeInitialState(header),
      events: [],
      witness,
      adapters,
      clock,
      capabilityNonce: nonce,
      actionAuthority: normalizedActionAuthority,
      acceptanceAuthority: normalizedAcceptanceAuthority,
    });
    kernel.captureIntent(initialIntentEnvelope);
    const ownerCapability = kernel.activateOwner(initialOwnerId, 'initial_intake');
    kernel.startBlockedTimeoutMonitor({ auto: true });
    return {
      kernel,
      owner_capability: ownerCapability,
    };
  }

  static resume({
    ledger,
    witness,
    adapters,
    clock,
    allowTestWitness = false,
    actionAuthority = null,
    allowTestActionExecutor = false,
    acceptanceAuthority = null,
    allowTestAcceptanceCoordinator = false,
    semanticAuthority = null,
    nonceFactory,
  }) {
    assertWitnessAdapter(witness, { allowTestWitness });
    requireAdapter(adapters, 'userInputVerifier');
    requireAdapter(adapters, 'ownerTurnVerifier');
    requireAdapter(adapters, 'principalResolver');
    requireAdapter(adapters, 'qualificationVerifier');
    const verified = verifyLedger(ledger, {
      witness,
      requireWitness: true,
      acceptanceAuthority,
      allowTestAcceptanceCoordinator,
      allowWitnessAheadForPendingAttempt: true,
    });
    const resumedReplay = replayFromLatestCheckpoint(ledger, verified);
    let normalizedAcceptanceAuthority = null;
    if (verified.header.acceptance_authority) {
      if (!acceptanceAuthority) {
        throw new OwnerKernelBlockedError(
          'resuming an acceptance-enabled ledger requires the intake-frozen acceptance coordinator',
          'ACCEPTANCE_COORDINATOR_REQUIRED',
        );
      }
      normalizedAcceptanceAuthority = normalizeAcceptanceAuthority(acceptanceAuthority, {
        allowTestCoordinator: allowTestAcceptanceCoordinator,
      });
      if (normalizedAcceptanceAuthority.binding_hash !== verified.header.acceptance_authority.binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed acceptance coordinator does not exactly match the intake-frozen binding',
          'ACCEPTANCE_COORDINATOR_MISMATCH',
        );
      }
    } else if (acceptanceAuthority !== null && acceptanceAuthority !== undefined) {
      throw new OwnerKernelError(
        'legacy ledger has no acceptance authority header and cannot be resumed with one',
        'ACCEPTANCE_COORDINATOR_MISMATCH',
      );
    }
    let normalizedSemanticAuthority = null;
    if (verified.header.semantic_authority) {
      if (!semanticAuthority) {
        throw new OwnerKernelBlockedError(
          'resuming a semantic-authority ledger requires the intake-frozen semantic route',
          'SEMANTIC_AUTHORITY_REQUIRED',
        );
      }
      normalizedSemanticAuthority = createSemanticAuthorityHeader(semanticAuthority, witness);
      if (canonicalJson(normalizedSemanticAuthority) !== canonicalJson(verified.header.semantic_authority)) {
        throw new OwnerKernelBlockedError(
          'resumed semantic route does not exactly match the intake-frozen authority',
          'SEMANTIC_AUTHORITY_MISMATCH',
        );
      }
    } else if (semanticAuthority !== null && semanticAuthority !== undefined) {
      throw new OwnerKernelError(
        'legacy ledger has no semantic authority header and cannot be resumed with one',
        'SEMANTIC_AUTHORITY_MISMATCH',
      );
    }
    if (verified.header.authority && !verified.header.acceptance_authority
      && Object.values(resumedReplay.state.action_claims).some((claim) => claim.outcome === null)) {
      throw new OwnerKernelBlockedError(
        'an unresolved host action claim requires durable recovery before another Kernel can resume the run',
        'ACTION_CLAIM_RECOVERY_REQUIRED',
      );
    }
    const nonce = typeof nonceFactory === 'function'
      ? nonceFactory()
      : crypto.randomBytes(32).toString('hex');
    if (typeof nonce !== 'string' || nonce.length < 32) {
      throw new OwnerKernelError('nonceFactory must return a high-entropy string', 'INVALID_CAPABILITY_NONCE');
    }
    if (verified.header.authority || verified.header.acceptance_authority
      || verified.header.semantic_authority) {
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBatch: Boolean(verified.header.acceptance_authority),
        requireBinding: true,
      });
    }
    if (verified.header.authority) {
      if (sha256(canonicalJson(normalizeWitnessBinding(witness)))
        !== verified.header.authority.witness_binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed witness does not exactly match the intake-frozen authority binding',
          'WITNESS_BINDING_MISMATCH',
        );
      }
    }
    if (verified.header.acceptance_authority
      && sha256(canonicalJson(normalizeWitnessBinding(witness)))
        !== verified.header.acceptance_authority.witness_binding_hash) {
      throw new OwnerKernelBlockedError(
        'resumed witness does not exactly match the intake-frozen acceptance authority binding',
        'WITNESS_BINDING_MISMATCH',
      );
    }
    if (verified.header.semantic_authority
      && sha256(canonicalJson(normalizeWitnessBinding(witness)))
        !== verified.header.semantic_authority.witness_binding_hash) {
      throw new OwnerKernelBlockedError(
        'resumed witness does not exactly match the intake-frozen semantic authority binding',
        'WITNESS_BINDING_MISMATCH',
      );
    }
    // Timeout is a terminal-only path: it must run before requiring a live executor or host probe.
    // This preserves the ordered timeout abort even when a previously valid authority has since expired.
    const timeoutKernel = new OwnerKernel({
      header: verified.header,
      policy: verified.policy,
      contract: verified.contract,
      state: resumedReplay.state,
      events: ledger.events.map((event) => cloneCanonical(event)),
      witness,
      adapters,
      clock,
      capabilityNonce: nonce,
      actionAuthority: null,
      acceptanceAuthority: normalizedAcceptanceAuthority,
      recoveryOnly: Boolean(resumedReplay.state.acceptance_attempt
        && resumedReplay.state.acceptance_attempt.status === 'pending'),
    });
    if (resumedReplay.state.acceptance_attempt
      && resumedReplay.state.acceptance_attempt.status === 'pending') {
      return {
        kernel: timeoutKernel,
        owner_capability: null,
        acceptance_recovery: timeoutKernel.recoverAcceptanceAttempt(),
      };
    }
    if (verified.header.authority || verified.header.acceptance_authority
      || verified.header.semantic_authority) {
      assertCurrentWitnessHead(timeoutKernel);
    }
    if (resumedReplay.state.status === 'complete') {
      return { kernel: timeoutKernel, owner_capability: null };
    }
    if (checkTimeout(timeoutKernel)) {
      return { kernel: timeoutKernel, owner_capability: null };
    }
    let normalizedActionAuthority = null;
    if (verified.header.authority) {
      if (!actionAuthority) {
        throw new OwnerKernelBlockedError(
          'resuming an authority-enabled ledger requires the current host action authority',
          'ACTION_AUTHORITY_REQUIRED',
        );
      }
      normalizedActionAuthority = normalizeActionAuthority(verified.policy, actionAuthority, {
        allowTestExecutor: allowTestActionExecutor,
        now: new Date(nowIso(clock)),
      });
      if (normalizedActionAuthority.capability_hash !== verified.header.authority.host_capability_hash) {
        throw new OwnerKernelBlockedError(
          'resumed host capability does not exactly match the intake-frozen authority',
          'HOST_CAPABILITY_REGRESSION',
        );
      }
      if (normalizedActionAuthority.executor_binding_hash !== verified.header.authority.executor_binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed executor does not exactly match the intake-frozen authority binding',
          'ACTION_EXECUTOR_MISMATCH',
        );
      }
      if (normalizedActionAuthority.host_capability_verifier_binding_hash
        !== verified.header.authority.host_capability_verifier_binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed host capability verifier does not exactly match the intake-frozen authority binding',
          'HOST_CAPABILITY_VERIFIER_MISMATCH',
        );
      }
      if (normalizedActionAuthority.receipt_verifier_binding_hash
        !== verified.header.authority.receipt_verifier_binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed receipt verifier does not exactly match the intake-frozen authority binding',
          'ACTION_RECEIPT_VERIFIER_MISMATCH',
        );
      }
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBinding: true,
      });
    } else if (actionAuthority !== null && actionAuthority !== undefined) {
      throw new OwnerKernelError(
        'legacy ledger has no action authority header and cannot be resumed with one',
        'ACTION_AUTHORITY_MISMATCH',
      );
    }
    const kernel = new OwnerKernel({
      header: verified.header,
      policy: verified.policy,
      contract: verified.contract,
      state: resumedReplay.state,
      events: ledger.events.map((event) => cloneCanonical(event)),
      witness,
      adapters,
      clock,
      capabilityNonce: nonce,
      actionAuthority: normalizedActionAuthority,
      acceptanceAuthority: normalizedAcceptanceAuthority,
    });
    if (verified.header.authority
      && Object.values(INTERNALS.get(kernel).state.action_claims).some((claim) => claim.outcome === null)) {
      assertCurrentWitnessHead(kernel);
      settlePendingActionClaimForResume(kernel);
    }
    if (INTERNALS.get(kernel).state.status !== 'complete') kernel.startBlockedTimeoutMonitor({ auto: true });
    if (normalizedActionAuthority !== null) {
      assertCurrentWitnessHead(kernel);
      const assessment = assessHostCapability(kernel, 'resume', nowIso(clock));
      if (!assessment.ok) {
        appendCapabilityRegression(kernel, assessment);
        return { kernel, owner_capability: null };
      }
    }
    let ownerCapability = null;
    if (verified.state.active_principal && verified.state.status !== 'complete') {
      const now = nowIso(clock);
      const principal = assertCurrentQualification(kernel, 'resume', now);
      ownerCapability = makeCapability(kernel, principal, now);
    }
    return { kernel, owner_capability: ownerCapability };
  }

  async recoverAcceptanceAttempt({ timeoutMilliseconds } = {}) {
    const internal = INTERNALS.get(this);
    const authority = requireAcceptanceAuthority(internal);
    const attempt = internal.state.acceptance_attempt;
    const timeout = normalizeAcceptanceTimeoutMilliseconds(timeoutMilliseconds);
    if (!attempt || attempt.status !== 'pending') {
      return cloneCanonical({ recovered: false, reason: 'no_pending_attempt' });
    }
    if (internal.acceptanceLock) {
      throw new OwnerKernelBlockedError('acceptance attempt recovery is already in progress', 'ACCEPTANCE_RECOVERY_IN_PROGRESS');
    }
    internal.acceptanceLock = true;
    internal.acceptanceTransaction = {
      phase: 'recovering',
      attempt: cloneCanonical(attempt),
      snapshot: null,
      abort: null,
    };
    try {
      const recoveryRequest = {
        run_id: internal.header.run_id,
        coordinator_binding_hash: authority.binding_hash,
        attempt_id: attempt.attempt_id,
        attempt_hash: attempt.attempt_hash,
        expected_event_head: internal.state.event_head,
        expected_witness_head: internal.state.witness_head,
        reason: 'resume_durable_attempt_recovery',
      };
      const response = await awaitAcceptanceTimeout(
        Promise.resolve().then(() => authority.resolveAttempt(recoveryRequest)),
        timeout,
        {
          onTimeout: () => authority.cancel(coordinatorCancellationRequest(internal, attempt, {
            reason: 'recovery_resolve_timeout',
          })),
          message: 'the host acceptance coordinator did not resolve the pending durable attempt before recovery timed out',
        },
      );
      const durableAbort = internal.state.abort_request === null ? null : {
        identity: internal.state.abort_request.identity,
        channel: internal.state.abort_request.channel,
        reason: internal.state.abort_request.reason,
        envelope_hash: internal.state.abort_request.envelope_hash,
      };
      if (response && response.disposition === 'accepted') {
        const events = await importAcceptedAttemptBatch(this, response);
        assertCurrentWitnessHead(this);
        const queuedAbort = (internal.acceptanceTransaction && internal.acceptanceTransaction.abort) || durableAbort;
        const lateAbort = queuedAbort
          ? appendLateUserAbortControl(this, queuedAbort)
          : null;
        return cloneCanonical({ recovered: true, disposition: 'accepted', events, late_abort: lateAbort });
      }
      const resolution = await normalizeCoordinatorResolution(internal, attempt, response, {
        allowedDispositions: ['released', 'cancelled', 'aborted'],
      });
      const event = await appendAcceptanceResolutionInternal(this, attempt, {
        disposition: resolution.disposition,
        coordinatorResolution: resolution,
      });
      let abort = null;
      const queuedAbort = (internal.acceptanceTransaction && internal.acceptanceTransaction.abort) || durableAbort;
      if (queuedAbort) {
        if (internal.state.abort_request === null) {
          appendInternal(this, {
            type: 'abort_request',
            emitter: { kind: 'user', identity: queuedAbort.identity, channel: queuedAbort.channel },
            payload: { reason: queuedAbort.reason, envelope_hash: queuedAbort.envelope_hash },
            skipAutomaticCheckpoint: true,
          });
        }
        abort = appendInternal(this, {
          type: 'abort',
          emitter: { kind: 'user', identity: queuedAbort.identity, channel: queuedAbort.channel },
          payload: { reason: queuedAbort.reason },
          skipAutomaticCheckpoint: true,
        });
      }
      assertCurrentWitnessHead(this);
      return cloneCanonical({ recovered: true, disposition: resolution.disposition, event, abort });
    } finally {
      internal.acceptanceLock = false;
      internal.acceptanceTransaction = null;
    }
  }

  captureIntent(envelope) {
    assertActionControlPlaneUnlocked(this, 'intent capture');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'userInputVerifier')(envelope, 'intent', { run_id: internal.header.run_id }),
      'user input envelope',
      { expectedKind: 'intent', runId: internal.header.run_id },
    );
    const previousIntent = internal.state.current_intent_id;
    const newlySupersededDecisionIds = Object.values(internal.state.decisions)
      .filter((decision) => !decision.suspended && decision.intent_id === previousIntent)
      .map((decision) => decision.decision_id);
    const event = appendInternal(this, {
      type: 'intent',
      emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
      payload: {
        intent_id: nextIdentifier(internal, 'intent'),
        text: trusted.payload.text,
        envelope_hash: trusted.envelope_hash,
        explicit_action_hashes: trusted.payload.explicit_action_hashes || [],
        supersedes_intent_id: previousIntent,
      },
    });
    if (newlySupersededDecisionIds.length > 0) {
      appendInternal(this, {
        type: 'suspension',
        emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-intent-derivation' },
        payload: {
          suspension_id: nextIdentifier(internal, 'suspension'),
          intent_id: internal.state.current_intent_id,
          decision_ids: newlySupersededDecisionIds,
          reason: 'intent_superseded',
        },
      });
    }
    return event;
  }

  activateOwner(candidateId, reason = 'owner_reinstantiation') {
    assertActionControlPlaneUnlocked(this, 'owner activation');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const resolution = verifyPrincipalResolution(internal, { candidateId, reason });
    appendInternal(this, {
      type: 'principal_change',
      emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-roster-resolution' },
      payload: {
        from_principal_id: internal.state.active_principal ? internal.state.active_principal.identity : null,
        ...resolution,
      },
    });
    invalidateCapabilities(this);
    if (!internal.state.active_principal) {
      throw new OwnerKernelBlockedError('frozen owner roster could not provide a qualified principal', 'OWNER_ROSTER_EXHAUSTED');
    }
    const now = nowIso(internal.clock);
    assertCurrentQualification(this, 'principal_change', now);
    return makeCapability(this, internal.state.active_principal, now);
  }

  mintDecision({ capability, ownerTurnEnvelope, actionClass, actionDescriptor, maxUses = 1 }) {
    return mintDecisionInternal(this, {
      capability,
      ownerTurnEnvelope,
      actionClass,
      actionDescriptor,
      maxUses,
    });
  }

  mintActionDecision({ capability, ownerTurnEnvelope, actionDescriptor, actionClass = null, maxUses = 1 }) {
    return mintDecisionInternal(this, {
      capability,
      ownerTurnEnvelope,
      actionClass,
      actionDescriptor,
      maxUses,
      requireActionAuthority: true,
    });
  }

  async executeAuthorizedAction({ decisionId, action, timeoutMilliseconds } = {}) {
    assertActionControlPlaneUnlocked(this, 'action execution');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    if (!hasActionAuthority(internal)) {
      throw new OwnerKernelBlockedError('action execution requires an authority-enabled Kernel run', 'ACTION_AUTHORITY_REQUIRED');
    }
    if (internal.actionLock) {
      throw new OwnerKernelBlockedError('another action is already crossing the host action boundary', 'ACTION_LOCKED');
    }
    const actionTimeout = normalizeActionTimeoutMilliseconds(timeoutMilliseconds);
    internal.actionLock = true;
    const abortController = new AbortController();
    const activeAction = {
      abortController,
      abort_reason: null,
      abort_envelope_hash: null,
      claim_id: null,
      phase: 'pre_claim',
      timeout: null,
      cancellation: null,
      request_boundary_cancellation: null,
      pending_abort_request: null,
    };
    internal.activeAction = activeAction;
    try {
      const now = nowIso(internal.clock);
      const preActionWitnessHead = assertCurrentWitnessHead(this);
      const principal = assertCurrentQualification(this, 'pre_action', now);
      const decision = assertActionDecisionUsable(this, decisionId);
      if (decision.principal_id !== principal.identity) {
        throw new OwnerKernelBlockedError(
          'action decision was minted by a principal that is no longer active',
          'ACTION_PRINCIPAL_CHANGED',
        );
      }
      let observedDescriptor;
      try {
        observedDescriptor = normalizeActionDescriptor(internal.policy, action, {
          declaredActionClass: decision.action_class,
        });
      } catch (error) {
        throw new OwnerKernelBlockedError(
          `observed action is not classified by the authorized descriptor: ${error.message}`,
          'ACTION_RECONCILIATION_FAILED',
        );
      }
      if (canonicalJson(observedDescriptor) !== canonicalJson(decision.action_descriptor)) {
        throw new OwnerKernelBlockedError(
          'observed action does not exactly match the authorized descriptor',
          'ACTION_RECONCILIATION_FAILED',
        );
      }
      const catalogEntry = internal.policy.action_catalog.find((entry) => entry.id === observedDescriptor.catalog_id);
      if (!catalogEntry) {
        throw new OwnerKernelBlockedError('action descriptor catalog entry is unavailable', 'ACTION_CLASSIFICATION_BLOCKED');
      }
      if (catalogEntry.requires_challenge) {
        if (!hasQualifiedActionChallenge(internal, decision, now)) {
          throw new OwnerKernelBlockedError(
            'this frozen catalog action requires challenge evidence from a qualified independent challenger before execution',
            'ACTION_CHALLENGE_REQUIRED',
          );
        }
      }
      const boundary = actionBoundary(internal);
      const claimId = nextIdentifier(internal, 'action-claim');
      const hostProbe = assertCurrentHostCapability(this, 'pre_action', now, {
        actionContext: {
          witness_stream_id: internal.header.witness_stream_id,
          witness_binding_hash: internal.header.authority.witness_binding_hash,
          authority_hash: internal.header.authority_hash,
          claim_id: claimId,
          pre_action_witness_head: preActionWitnessHead,
          action_descriptor_hash: decision.action_descriptor_hash,
          executor_binding_hash: internal.actionAuthority.executor_binding_hash,
          audience_identity: boundary.audience_identity,
        },
      });
      if (abortController.signal.aborted) {
        throw new OwnerKernelBlockedError('the host action was cancelled before its claim could be witnessed', 'ACTION_ABORTED');
      }
      activeAction.claim_id = claimId;
      activeAction.phase = 'claim_committing';
      const claim = appendInternal(this, {
        type: 'evidence',
        emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-action-claim' },
        payload: {
          evidence_id: nextIdentifier(internal, 'evidence'),
          evidence_kind: 'action_claim',
          claim_id: claimId,
          decision_id: decision.decision_id,
          decision_content_hash: decision.decision_content_hash,
          action_descriptor_hash: decision.action_descriptor_hash,
          claimed_use: decision.claimed_uses + 1,
          host_capability_hash: internal.actionAuthority.capability_hash,
          host_observation_hash: hostProbe.observation_hash,
          host_probe_nonce_commitment: hostProbe.probe_nonce_commitment,
          execution_permit_id: hostProbe.execution_permit.permit_id,
          execution_permit_hash: hostProbe.execution_permit_hash,
          executor_binding_hash: internal.actionAuthority.executor_binding_hash,
          pre_action_witness_head: preActionWitnessHead,
          action_challenge_id: decision.action_challenge_id || null,
          action_challenge_candidate_set_hash: decision.action_challenge_candidate_set_hash || null,
        },
        skipAutomaticCheckpoint: true,
      });
      if (activeAction.pending_abort_request !== null) {
        appendAbortRequestInternal(this, activeAction.pending_abort_request);
      }
      activeAction.phase = 'post_claim';
      let outcome;
      let executionAuthorization = null;
      let executionAuthorizationHash = null;
      let cancellation = null;
      const cancellationRequest = (authorizationHash, authorizationId) => {
        const request = {
          run_id: internal.header.run_id,
          authority_hash: internal.header.authority_hash,
          claim_id: claimId,
          claim_event_hash: claim.event_hash,
          execution_permit_id: hostProbe.execution_permit.permit_id,
          execution_permit_hash: hostProbe.execution_permit_hash,
          execution_authorization_hash: authorizationHash,
          authorization_id: authorizationId,
          reason: activeAction.abort_reason || 'action_aborted',
          abort_envelope_hash: activeAction.abort_envelope_hash,
        };
        return { request, requestHash: sha256(canonicalJson(request)) };
      };
      activeAction.request_boundary_cancellation = () => {
        if (activeAction.cancellation !== null) return activeAction.cancellation;
        // Freeze the first cancellation's authorization tuple. A re-entrant user abort can
        // arrive while the post-claim verifier is issuing an authorization; the broker must
        // receive and attest to exactly the same tuple that is later recorded in the ledger.
        const cancellationAuthorization = executionAuthorization === null
          ? null
          : cloneCanonical(executionAuthorization);
        const cancellationAuthorizationHash = executionAuthorizationHash;
        const cancellationAuthorizationId = cancellationAuthorization === null
          ? null
          : cancellationAuthorization.authorization_id;
        const { request, requestHash } = cancellationRequest(
          cancellationAuthorizationHash,
          cancellationAuthorizationId,
        );
        activeAction.cancellation = awaitWithTimeout(
          Promise.resolve().then(() => boundary.cancel({
            operation: 'revoke_claim_authorizations',
            run_id: internal.header.run_id,
            witness_stream_id: internal.header.witness_stream_id,
            witness_binding: cloneCanonical(internal.header.authority.witness_binding),
            witness_binding_hash: internal.header.authority.witness_binding_hash,
            authority_hash: internal.header.authority_hash,
            policy_hash: internal.header.policy_hash,
            claim_id: claimId,
            claim: cloneCanonical(claim),
            claim_event_hash: claim.event_hash,
            claim_witness_head: claim.witness.witness_head,
            claim_emitted_at: claim.emitted_at,
            execution_permit: cloneCanonical(hostProbe.execution_permit),
            execution_permit_id: hostProbe.execution_permit.permit_id,
            execution_permit_hash: hostProbe.execution_permit_hash,
            execution_authorization: cancellationAuthorization,
            execution_authorization_hash: cancellationAuthorizationHash,
            authorization_id: cancellationAuthorizationId,
            cancellation_request: cloneCanonical(request),
            cancellation_request_hash: requestHash,
            broker: boundary.broker === null ? null : cloneCanonical(boundary.broker),
            execution_route: boundary.broker === null ? 'executor' : 'broker',
          })),
          Math.min(DEFAULT_CANCELLATION_TIMEOUT_MILLISECONDS, Math.max(1000, actionTimeout)),
        ).then(async (result) => {
          const acknowledged = normalizeActionCancellationResult(result, {
            broker: boundary.broker,
            runId: internal.header.run_id,
            claimId,
            executionPermitId: hostProbe.execution_permit.permit_id,
            executionPermitHash: hostProbe.execution_permit_hash,
            executionAuthorizationHash: cancellationAuthorizationHash,
            authorizationId: cancellationAuthorizationId,
            cancellationRequestHash: requestHash,
            boundaryAttestationHash: boundary.boundary_attestation_hash,
            authorizationIssuedAt: cancellationAuthorization === null
              ? null
              : cancellationAuthorization.issued_at,
            authorizationExpiresAt: cancellationAuthorization === null
              ? null
              : cancellationAuthorization.expires_at,
            now: nowIso(internal.clock),
          });
          const verified = await awaitWithTimeout(
            Promise.resolve().then(() => internal.actionAuthority.receipt_verifier({
              operation: 'verify_cancellation',
              run_id: internal.header.run_id,
              claim_id: claimId,
              claim_event_hash: claim.event_hash,
              claim_witness_head: claim.witness.witness_head,
              execution_permit_id: hostProbe.execution_permit.permit_id,
              execution_permit_hash: hostProbe.execution_permit_hash,
              execution_authorization_hash: cancellationAuthorizationHash,
              authorization_id: cancellationAuthorizationId,
              cancellation_request: cloneCanonical(request),
              cancellation_request_hash: requestHash,
              acknowledgement: cloneCanonical(result),
              broker: boundary.broker === null ? null : cloneCanonical(boundary.broker),
            })),
            Math.min(DEFAULT_CANCELLATION_TIMEOUT_MILLISECONDS, Math.max(1000, actionTimeout)),
          );
          const independentlyVerified = normalizeActionCancellationResult(verified, {
            broker: boundary.broker,
            runId: internal.header.run_id,
            claimId,
            executionPermitId: hostProbe.execution_permit.permit_id,
            executionPermitHash: hostProbe.execution_permit_hash,
            executionAuthorizationHash: cancellationAuthorizationHash,
            authorizationId: cancellationAuthorizationId,
            cancellationRequestHash: requestHash,
            boundaryAttestationHash: boundary.boundary_attestation_hash,
            authorizationIssuedAt: cancellationAuthorization === null
              ? null
              : cancellationAuthorization.issued_at,
            authorizationExpiresAt: cancellationAuthorization === null
              ? null
              : cancellationAuthorization.expires_at,
            now: nowIso(internal.clock),
          });
          if (canonicalJson(independentlyVerified) !== canonicalJson(acknowledged)) {
            throw new OwnerKernelBlockedError(
              'the independent receipt verifier did not confirm the boundary cancellation acknowledgement',
              'ACTION_CANCELLATION_UNCONFIRMED',
            );
          }
          return {
            ...acknowledged,
            reason: request.reason,
            abort_envelope_hash: request.abort_envelope_hash,
            execution_authorization_hash: request.execution_authorization_hash,
            authorization_id: request.authorization_id,
          };
        }).catch(() => {
          return ({
          request_hash: requestHash,
          reason: request.reason,
          abort_envelope_hash: request.abort_envelope_hash,
          execution_authorization_hash: request.execution_authorization_hash,
          authorization_id: request.authorization_id,
          state: 'unconfirmed',
          receipt_ref: null,
          broker_receipt: null,
          boundary_effect_id: null,
          boundary_state_version: null,
          attestation_hash: null,
          received_at: null,
          effect_at: null,
          });
        });
        return activeAction.cancellation;
      };
      try {
        // A second head probe closes the interval between the claim CAS and post-claim authorization.
        assertCurrentWitnessHead(this);
        if (abortController.signal.aborted) {
          throw new OwnerKernelBlockedError('the host action was cancelled before post-claim authorization', 'ACTION_ABORTED');
        }
        activeAction.phase = 'post_claim_authorizing';
        const postClaimNow = nowIso(internal.clock);
        const postClaimProbe = assertCurrentHostCapability(this, 'post_claim', postClaimNow, {
          recordFailure: false,
          actionContext: {
            witness_stream_id: internal.header.witness_stream_id,
            witness_binding_hash: internal.header.authority.witness_binding_hash,
            authority_hash: internal.header.authority_hash,
            claim_id: claimId,
            claim_event_hash: claim.event_hash,
            claim_witness_head: claim.witness.witness_head,
            claim_emitted_at: claim.emitted_at,
            execution_permit: cloneCanonical(hostProbe.execution_permit),
            execution_permit_hash: hostProbe.execution_permit_hash,
            action_descriptor_hash: decision.action_descriptor_hash,
            executor_binding_hash: internal.actionAuthority.executor_binding_hash,
            audience_identity: boundary.audience_identity,
          },
        });
        executionAuthorization = postClaimProbe.execution_authorization;
        executionAuthorizationHash = postClaimProbe.execution_authorization_hash;
        activeAction.phase = 'post_claim';
        const authorizationNow = nowIso(internal.clock);
        const authorizationRemainingMilliseconds = new Date(executionAuthorization.expires_at).getTime()
          - new Date(authorizationNow).getTime();
        if (authorizationRemainingMilliseconds <= 0) {
          throw new OwnerKernelBlockedError(
            'post-claim execution authorization expired before the host boundary could run',
            'ACTION_AUTHORIZATION_EXPIRED',
          );
        }
        if (abortController.signal.aborted) {
          throw new OwnerKernelBlockedError('the host action was cancelled before crossing the host boundary', 'ACTION_ABORTED');
        }
        activeAction.timeout = setTimeout(() => {
          requestActionAbort(activeAction, 'action_timeout');
        }, Math.min(actionTimeout, authorizationRemainingMilliseconds));
        // The broker/executor must independently compare this witnessed head at its durable consume point.
        assertCurrentWitnessHead(this);
        const result = await invokeWithAbort(() => boundary.execute({
          run_id: internal.header.run_id,
          witness_stream_id: internal.header.witness_stream_id,
          witness_binding: cloneCanonical(internal.header.authority.witness_binding),
          witness_binding_hash: internal.header.authority.witness_binding_hash,
          authority_hash: internal.header.authority_hash,
          policy_hash: internal.header.policy_hash,
          decision_id: decision.decision_id,
          decision_content_hash: decision.decision_content_hash,
          claim_id: claimId,
          action: cloneCanonical(action),
          action_descriptor: cloneCanonical(observedDescriptor),
          action_descriptor_hash: decision.action_descriptor_hash,
          host_capability_hash: internal.actionAuthority.capability_hash,
          claim: cloneCanonical(claim),
          claim_event_hash: claim.event_hash,
          claim_witness_head: claim.witness.witness_head,
          claim_emitted_at: claim.emitted_at,
          execution_permit: cloneCanonical(hostProbe.execution_permit),
          execution_permit_id: hostProbe.execution_permit.permit_id,
          execution_permit_hash: hostProbe.execution_permit_hash,
          execution_authorization: cloneCanonical(executionAuthorization),
          execution_authorization_hash: executionAuthorizationHash,
          authorization_id: executionAuthorization.authorization_id,
          execution_deadline: executionAuthorization.expires_at,
          executor_binding: cloneCanonical(internal.actionAuthority.executor_binding),
          executor_binding_hash: internal.actionAuthority.executor_binding_hash,
          broker: boundary.broker === null ? null : cloneCanonical(boundary.broker),
          execution_route: boundary.broker === null ? 'executor' : 'broker',
          pre_action_witness_head: preActionWitnessHead,
          abort_signal: abortController.signal,
        }), abortController.signal);
        if (abortController.signal.aborted) {
          throw new OwnerKernelBlockedError('the host action was cancelled before its boundary result was reconciled', 'ACTION_ABORTED');
        }
        const receipt = normalizeActionExecutionResult(
          internal.policy,
          decision.action_descriptor,
          result,
          {
            broker: boundary.broker,
            executionPermitHash: hostProbe.execution_permit_hash,
            executionAuthorizationHash,
            authorizationId: executionAuthorization.authorization_id,
            claimEventHash: claim.event_hash,
            claimWitnessHead: claim.witness.witness_head,
            authorizationIssuedAt: executionAuthorization.issued_at,
            authorizationExpiresAt: executionAuthorization.expires_at,
            boundaryAttestationHash: boundary.boundary_attestation_hash,
            now: nowIso(internal.clock),
          },
        );
        const verifiedResult = await invokeWithAbort(() => internal.actionAuthority.receipt_verifier({
          run_id: internal.header.run_id,
          claim_id: claimId,
          claim_event_hash: claim.event_hash,
          claim_witness_head: claim.witness.witness_head,
          claim_emitted_at: claim.emitted_at,
          policy_hash: internal.header.policy_hash,
          action_descriptor: cloneCanonical(observedDescriptor),
          action_descriptor_hash: decision.action_descriptor_hash,
          executor_binding: cloneCanonical(internal.actionAuthority.executor_binding),
          executor_binding_hash: internal.actionAuthority.executor_binding_hash,
          execution_permit_id: hostProbe.execution_permit.permit_id,
          execution_permit_hash: hostProbe.execution_permit_hash,
          execution_authorization_hash: executionAuthorizationHash,
          authorization_id: executionAuthorization.authorization_id,
          broker: boundary.broker === null ? null : cloneCanonical(boundary.broker),
          receipt: cloneCanonical(receipt),
          abort_signal: abortController.signal,
        }), abortController.signal);
        if (abortController.signal.aborted) {
          throw new OwnerKernelBlockedError(
            'the host action was cancelled before receipt verification completed',
            'ACTION_ABORTED',
          );
        }
        outcome = {
          ...normalizeVerifiedActionOutcome(internal.policy, decision.action_descriptor, verifiedResult, {
          runId: internal.header.run_id,
          claimId,
          executorBindingHash: internal.actionAuthority.executor_binding_hash,
          executionPermitHash: hostProbe.execution_permit_hash,
          executionAuthorizationHash,
          authorizationId: executionAuthorization.authorization_id,
          claimEventHash: claim.event_hash,
          claimWitnessHead: claim.witness.witness_head,
          receipt,
          broker: boundary.broker,
          boundaryAttestationHash: boundary.boundary_attestation_hash,
          now: nowIso(internal.clock),
          }),
          cancellation: null,
        };
      } catch (_error) {
        if (!abortController.signal.aborted) {
          requestActionAbort(activeAction, 'action_boundary_ambiguous');
        }
        if (activeAction.request_boundary_cancellation !== null) {
          cancellation = await activeAction.request_boundary_cancellation();
        }
        // A claim is never rolled back after the host boundary. A missing or malformed
        // executor result is durable unknown evidence, never implicit success or retry.
        outcome = {
          outcome: 'unknown',
          receipt_ref: null,
          broker_receipt: null,
          executor_binding_hash: internal.actionAuthority.executor_binding_hash,
          execution_permit_hash: hostProbe.execution_permit_hash,
          execution_authorization_hash: executionAuthorizationHash,
          authorization_id: executionAuthorization === null ? null : executionAuthorization.authorization_id,
          claim_event_hash: claim.event_hash,
          claim_witness_head: claim.witness.witness_head,
          permit_state: null,
          boundary_effect_id: null,
          boundary_state_version: null,
          boundary_attestation_hash: null,
          effect_at: null,
          cancellation,
          observed_action_descriptor_hash: null,
          error_code: activeAction.abort_reason || (abortController.signal.aborted
            ? 'action_aborted'
            : 'executor_exception'),
        };
      }
      let outcomeEvent;
      try {
        // Once the verified outcome enters the witness append, that append is the action's
        // linearization point. Re-entrant aborts must not start a contradictory cancellation.
        activeAction.phase = 'outcome_committing';
        outcomeEvent = appendInternal(this, {
          type: 'evidence',
          emitter: {
            kind: 'kernel',
            identity: 'owner-kernel',
            channel: `kernel-action-executor:${internal.actionAuthority.executor.identity}`,
          },
          payload: {
            evidence_id: nextIdentifier(internal, 'evidence'),
            evidence_kind: 'action_outcome',
            claim_id: claimId,
            decision_id: decision.decision_id,
            ...outcome,
          },
        });
      } catch (error) {
        if (internal.state.action_outcomes[claimId]) throw error;
        throw new OwnerKernelBlockedError(
          `action was claimed but its outcome could not be witnessed; acceptance is fail-closed: ${error.message}`,
          'ACTION_OUTCOME_WITNESS_FAILED',
        );
      }
      activeAction.phase = 'outcome_committed';
      if (activeAction.pending_abort_request && internal.state.abort_request === null) {
        appendAbortRequestInternal(this, activeAction.pending_abort_request);
      }
      if (internal.state.abort_request) {
        const abortRequest = internal.state.abort_request;
        const abort = appendInternal(this, {
          type: 'abort',
          emitter: { kind: 'user', identity: abortRequest.identity, channel: abortRequest.channel },
          payload: { reason: abortRequest.reason },
          skipAutomaticCheckpoint: true,
        });
        return { claim, outcome: outcomeEvent, abort };
      }
      return { claim, outcome: outcomeEvent };
    } finally {
      if (activeAction.timeout !== null) clearTimeout(activeAction.timeout);
      internal.activeAction = null;
      internal.actionLock = false;
    }
  }

  revalidateHostCapability() {
    assertActionControlPlaneUnlocked(this, 'host capability revalidation');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    if (!hasActionAuthority(internal)) {
      throw new OwnerKernelBlockedError('host capability revalidation requires an authority-enabled Kernel run', 'ACTION_AUTHORITY_REQUIRED');
    }
    assertCurrentWitnessHead(this);
    const assessment = assessHostCapability(this, 'revalidate', nowIso(internal.clock));
    if (!assessment.ok) {
      appendCapabilityRegression(this, assessment);
      throw new OwnerKernelBlockedError(
        'host capability did not recover to the exact intake-frozen authority',
        'HOST_CAPABILITY_REGRESSION',
      );
    }
    if (!internal.state.block_reasons.includes('host_capability_regression')) return null;
    return appendInternal(this, {
      type: 'evidence',
      emitter: { kind: 'kernel', identity: 'owner-kernel', channel: 'kernel-host-capability' },
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        evidence_kind: 'capability_revalidated',
        expected_capability_hash: internal.actionAuthority.capability_hash,
        observation_hash: assessment.observation_hash,
        probe_nonce_commitment: assessment.probe_nonce_commitment,
      },
    });
  }

  submitApproval(envelope) {
    assertActionControlPlaneUnlocked(this, 'approval submission');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'userInputVerifier')(envelope, 'approval', { run_id: internal.header.run_id }),
      'user approval envelope',
      { expectedKind: 'approval', runId: internal.header.run_id },
    );
    return appendInternal(this, {
      type: 'approval',
      emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
      payload: {
        approval_id: nextIdentifier(internal, 'approval'),
        decision_id: trusted.payload.decision_id,
        decision_content_hash: trusted.payload.decision_content_hash,
        max_uses: trusted.payload.max_uses,
        envelope_hash: trusted.envelope_hash,
      },
    });
  }

  userAbort(envelope) {
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'userInputVerifier')(envelope, 'abort', { run_id: internal.header.run_id }),
      'user abort envelope',
      { expectedKind: 'abort', runId: internal.header.run_id },
    );
    if (internal.state.status === 'complete') {
      if (internal.state.terminal_reason === 'accepted' && internal.header.acceptance_authority) {
        const event = appendLateUserAbortControl(this, {
          identity: trusted.identity,
          channel: trusted.channel,
          reason: trusted.payload.reason,
          envelope_hash: trusted.envelope_hash,
        });
        return cloneCanonical({ post_terminal: true, terminal_reason: 'accepted', event });
      }
      return cloneCanonical({ post_terminal: true, terminal_reason: internal.state.terminal_reason });
    }
    if (internal.acceptanceLock) {
      if (!internal.acceptanceTransaction) {
        throw new OwnerKernelBlockedError(
          'acceptance control transaction is unavailable; host recovery is required before another terminal decision',
          'ACCEPTANCE_CONTROL_UNRESOLVED',
        );
      }
      const transaction = internal.acceptanceTransaction;
      const queuedAbort = {
        identity: trusted.identity,
        channel: trusted.channel,
        reason: trusted.payload.reason,
        envelope_hash: trusted.envelope_hash,
      };
      // Store before crossing the coordinator boundary. A synchronous re-entry from commit()
      // cannot make this authenticated abort disappear if the coordinator rejects/throws.
      transaction.abort = queuedAbort;
      // A batch commit cannot be interrupted to insert a third witnessed event. Persist the
      // request immediately whenever the ledger is not already inside that atomic append;
      // the finally path persists a re-entrant request as soon as the batch returns.
      if (!internal.appending) appendAbortRequestInternal(this, trusted);
      const request = {
        ...coordinatorCancellationRequest(internal, transaction.attempt, {
          transactionId: transaction.snapshot && transaction.snapshot.transaction_id,
          fence: transaction.snapshot && transaction.snapshot.fence,
          reason: 'user_abort',
        }),
        user_abort: cloneCanonical(queuedAbort),
      };
      transaction.abort_order = Promise.resolve(internal.acceptanceAuthority.requestAbort(request)).then((value) => {
        const disposition = requireCoordinatorAbortDisposition(value, transaction.attempt);
        transaction.abort_disposition = disposition;
        if (disposition.disposition === 'accepted') {
          return cloneCanonical({ post_terminal: true, terminal_reason: 'accepted' });
        }
        return cloneCanonical({ acceptance_abort_queued: true, attempt_id: transaction.attempt.attempt_id });
      });
      return transaction.abort_order;
    }
    if (internal.state.acceptance_attempt && internal.state.acceptance_attempt.status === 'pending') {
      const attempt = internal.state.acceptance_attempt;
      const queuedAbort = {
        identity: trusted.identity,
        channel: trusted.channel,
        reason: trusted.payload.reason,
        envelope_hash: trusted.envelope_hash,
      };
      appendAbortRequestInternal(this, trusted);
      const orderingRequest = {
        ...coordinatorCancellationRequest(internal, attempt, { reason: 'user_abort_after_interruption' }),
        user_abort: cloneCanonical(queuedAbort),
      };
      return Promise.resolve(internal.acceptanceAuthority.requestAbort(orderingRequest)).then(async (value) => {
        const disposition = requireCoordinatorAbortDisposition(value, attempt);
        const recovery = await this.recoverAcceptanceAttempt();
        return cloneCanonical({
          acceptance_abort_queued: disposition.disposition !== 'accepted',
          attempt_id: attempt.attempt_id,
          recovery,
        });
      });
    }
    if (hasActionAuthority(internal) && internal.actionLock) {
      if (!internal.activeAction || !internal.activeAction.abortController) {
        throw new OwnerKernelBlockedError('the in-flight host action cannot be cancelled safely', 'ACTION_ABORT_UNAVAILABLE');
      }
      if (internal.activeAction.phase === 'claim_committing') {
        if (internal.header.acceptance_authority) internal.activeAction.pending_abort_request = trusted;
        requestActionAbort(internal.activeAction, 'user_abort_requested', trusted.envelope_hash);
        return cloneCanonical({
          cancellation_requested: true,
          claim_id: internal.activeAction.claim_id,
          claim_commit_in_progress: true,
        });
      }
      if (internal.activeAction.phase === 'pre_claim') {
        requestActionAbort(internal.activeAction, 'user_abort_requested', trusted.envelope_hash);
        return appendInternal(this, {
          type: 'abort',
          emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
          payload: { reason: trusted.payload.reason },
          skipAutomaticCheckpoint: true,
        });
      }
      if (internal.activeAction.phase === 'outcome_committing') {
        if (internal.header.acceptance_authority) internal.activeAction.pending_abort_request = trusted;
        return cloneCanonical({
          cancellation_requested: Boolean(internal.header.acceptance_authority),
          claim_id: internal.activeAction.claim_id,
          outcome_commit_in_progress: true,
        });
      }
      if (internal.activeAction.phase === 'post_claim_authorizing') {
        if (internal.header.acceptance_authority) appendAbortRequestInternal(this, trusted);
        requestActionAbort(internal.activeAction, 'user_abort_requested', trusted.envelope_hash);
        return cloneCanonical({
          cancellation_requested: true,
          claim_id: internal.activeAction.claim_id,
          postclaim_authorization_pending: true,
        });
      }
      if (internal.header.acceptance_authority) appendAbortRequestInternal(this, trusted);
      requestActionAbort(internal.activeAction, 'user_abort_requested', trusted.envelope_hash);
      return cloneCanonical({
        cancellation_requested: true,
        claim_id: internal.activeAction.claim_id,
      });
    }
    assertActionControlPlaneUnlocked(this, 'user abort');
    beforeOperation(this);
    return appendInternal(this, {
      type: 'abort',
      emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
      payload: { reason: trusted.payload.reason },
      skipAutomaticCheckpoint: true,
    });
  }

  recordEvidence(request) {
    assertActionControlPlaneUnlocked(this, 'evidence recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const verifier = requireAdapter(internal.adapters, 'evidenceVerifier');
    const archiver = requireAdapter(internal.adapters, 'evidenceArchiver');
    const verified = requireVerifiedEnvelope(
      verifier(request, { run_id: internal.header.run_id }),
      'evidence attestation',
      { runId: internal.header.run_id },
    );
    if (verified.payload.emitter_kind !== 'kernel' && verified.payload.emitter_kind !== 'runner') {
      throw new OwnerKernelError('evidence verifier must classify the emitter as kernel or runner', 'UNVERIFIED_EVIDENCE');
    }
    if (verified.payload.emitter_kind === 'kernel') {
      if (verified.identity !== 'owner-kernel' || verified.payload.verification_path !== 'kernel_verify') {
        throw new OwnerKernelError('kernel evidence must come from the Kernel verify path', 'UNVERIFIED_EVIDENCE');
      }
    } else {
      const runner = internal.policy.trusted_runner_roster.find((entry) => entry.identity === verified.identity);
      if (!runner || verified.payload.verification_path !== 'trusted_runner'
        || verified.payload.attestation_sha256 !== runner.attestation.sha256) {
        throw new OwnerKernelError('runner evidence is not bound to the frozen trusted-runner roster', 'UNVERIFIED_EVIDENCE');
      }
    }
    const archived = archiver({
      run_id: internal.header.run_id,
      verified_evidence: cloneCanonical(verified.payload),
    });
    if (!archived || typeof archived !== 'object' || typeof archived.uri !== 'string' || !isSha256(archived.sha256)) {
      throw new OwnerKernelError('evidenceArchiver did not return a durable content-addressed reference', 'EVIDENCE_ARCHIVE_FAILED');
    }
    return appendInternal(this, {
      type: 'evidence',
      emitter: {
        kind: verified.payload.emitter_kind === 'kernel' ? 'kernel' : 'runner',
        identity: verified.identity,
        channel: verified.channel,
      },
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        attestation_ref: { uri: archived.uri, sha256: archived.sha256.toLowerCase() },
        artifact_hashes: verified.payload.artifact_hashes,
      },
    });
  }

  recordVerification(request) {
    assertActionControlPlaneUnlocked(this, 'verification recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    requireAcceptanceAuthority(internal);
    const intentId = internal.state.current_intent_id;
    const verified = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'verificationVerifier')(request, {
        run_id: internal.header.run_id,
        contract_hash: internal.header.contract_hash,
        intent_id: intentId,
      }),
      'verification result',
      { runId: internal.header.run_id },
    );
    if (verified.payload.intent_id !== intentId) {
      throw new OwnerKernelError('verification result is not bound to the current user intent', 'UNVERIFIED_EVIDENCE');
    }
    let emitter;
    if (verified.payload.emitter_kind === 'kernel') {
      if (verified.identity !== 'owner-kernel' || verified.payload.verification_path !== 'kernel_verify') {
        throw new OwnerKernelError('Kernel verification is not bound to the Kernel verification path', 'UNVERIFIED_EVIDENCE');
      }
      emitter = { kind: 'kernel', identity: verified.identity, channel: verified.channel };
    } else if (verified.payload.emitter_kind === 'runner') {
      const runner = internal.policy.trusted_runner_roster.find((entry) => entry.identity === verified.identity);
      if (!runner || verified.payload.verification_path !== 'trusted_runner'
        || verified.payload.attestation_sha256 !== runner.attestation.sha256) {
        throw new OwnerKernelError('verification runner is not bound to the frozen trusted-runner roster', 'UNVERIFIED_EVIDENCE');
      }
      emitter = { kind: 'runner', identity: verified.identity, channel: verified.channel };
    } else {
      throw new OwnerKernelError('verification result must classify a Kernel or trusted runner emitter', 'UNVERIFIED_EVIDENCE');
    }
    return appendInternal(this, {
      type: 'evidence',
      emitter,
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        evidence_kind: 'verification',
        verification_id: verified.payload.verification_id,
        intent_id: verified.payload.intent_id,
        leg_id: verified.payload.leg_id,
        outcome: verified.payload.outcome,
        command_hash: verified.payload.command_hash,
        candidate_artifacts: verified.payload.candidate_artifacts,
        candidate_set_hash: verified.payload.candidate_set_hash,
        exit_code: verified.payload.exit_code,
        stdout_hash: verified.payload.stdout_hash,
        stderr_hash: verified.payload.stderr_hash,
        executed_at: verified.payload.executed_at,
        source_attestation_hash: verified.payload.emitter_kind === 'runner'
          ? verified.payload.attestation_sha256
          : null,
        attestation_ref: archiveVerifiedEvidence(this, verified.payload),
      },
    });
  }

  recordChallenge(envelope) {
    assertActionControlPlaneUnlocked(this, 'challenge recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    requireAcceptanceAuthority(internal);
    const intentId = internal.state.current_intent_id;
    const verified = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'challengeVerifier')(envelope, {
        run_id: internal.header.run_id,
        contract_hash: internal.header.contract_hash,
        intent_id: intentId,
        active_principal_id: internal.state.active_principal && internal.state.active_principal.identity,
      }),
      'challenge result',
      { runId: internal.header.run_id },
    );
    if (verified.payload.intent_id !== intentId) {
      throw new OwnerKernelError('challenge result is not bound to the current user intent', 'UNVERIFIED_CHALLENGE');
    }
    const challenger = internal.policy.challenger_roster.find((entry) => entry.identity === verified.identity);
    if (!challenger || verified.payload.verification_path !== 'qualified_challenge'
      || verified.payload.attestation_sha256 !== challenger.attestation.sha256) {
      throw new OwnerKernelError('challenge result is not bound to the frozen qualified challenger roster', 'UNVERIFIED_CHALLENGE');
    }
    let subjectFamily;
    try {
      subjectFamily = canonicalFamilyId(verified.payload.subject_family, 'challenge subject_family');
    } catch (error) {
      throw new OwnerKernelError(error.message, 'UNVERIFIED_CHALLENGE');
    }
    const provenance = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'artifactProvenanceVerifier')({
        run_id: internal.header.run_id,
        contract_hash: internal.header.contract_hash,
        candidate_artifacts: verified.payload.candidate_artifacts,
        candidate_set_hash: verified.payload.candidate_set_hash,
        intent_id: intentId,
        subject_identity: verified.payload.subject_identity,
        subject_family: subjectFamily,
      }, { run_id: internal.header.run_id, intent_id: intentId }),
      'challenge artifact provenance',
      { runId: internal.header.run_id },
    );
    const authority = requireAcceptanceAuthority(internal);
    if (provenance.identity !== authority.binding.identity
      || provenance.payload.verification_path !== 'artifact_provenance'
      || provenance.payload.attestation_sha256 !== authority.binding.attestation_hash
      || provenance.payload.candidate_set_hash !== verified.payload.candidate_set_hash
      || provenance.payload.intent_id !== intentId
      || provenance.payload.subject_identity !== verified.payload.subject_identity
      || provenance.payload.subject_family !== subjectFamily) {
      throw new OwnerKernelError('challenge artifact provenance is not independently bound to the frozen coordinator and subject', 'UNVERIFIED_CHALLENGE');
    }
    return appendInternal(this, {
      type: 'evidence',
      emitter: { kind: 'challenger', identity: verified.identity, channel: verified.channel },
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        evidence_kind: 'challenge',
        challenge_id: verified.payload.challenge_id,
        intent_id: verified.payload.intent_id,
        scope: verified.payload.scope,
        scope_id: verified.payload.scope_id,
        finding: verified.payload.finding,
        candidate_artifacts: verified.payload.candidate_artifacts,
        candidate_set_hash: verified.payload.candidate_set_hash,
        subject_identity: verified.payload.subject_identity,
        subject_family: subjectFamily,
        subject_provenance_hash: sha256(canonicalJson(provenance.payload)),
        subject_provenance_ref: archiveVerifiedEvidence(this, provenance.payload),
        result_hash: verified.payload.result_hash,
        reviewed_at: verified.payload.reviewed_at,
        challenger_attestation_hash: verified.payload.attestation_sha256,
        attestation_ref: archiveVerifiedEvidence(this, verified.payload),
      },
    });
  }

  recordAuditReconciliation(request) {
    assertActionControlPlaneUnlocked(this, 'audit reconciliation recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const authority = requireAcceptanceAuthority(internal);
    const actionFootprint = actionFootprintHash(internal.state);
    const evaluatedEventHead = internal.state.event_head;
    const evaluatedWitnessHead = internal.state.witness_head;
    const intentId = internal.state.current_intent_id;
    const verified = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'auditVerifier')(request, {
        run_id: internal.header.run_id,
        contract_hash: internal.header.contract_hash,
        coordinator_binding_hash: authority.binding_hash,
        action_footprint_hash: actionFootprint,
        evaluated_event_head: evaluatedEventHead,
        evaluated_witness_head: evaluatedWitnessHead,
        intent_id: intentId,
      }),
      'audit reconciliation result',
      { runId: internal.header.run_id },
    );
    if (verified.identity !== authority.binding.identity
      || verified.payload.attestation_sha256 !== authority.binding.attestation_hash
      || verified.payload.verification_path !== 'acceptance_audit') {
      throw new OwnerKernelError('audit reconciliation is not bound to the intake-frozen acceptance coordinator', 'UNVERIFIED_AUDIT');
    }
    if (verified.payload.action_footprint_hash !== actionFootprint
      || verified.payload.evaluated_event_head !== evaluatedEventHead
      || verified.payload.evaluated_witness_head !== evaluatedWitnessHead
      || verified.payload.intent_id !== intentId) {
      throw new OwnerKernelError('audit reconciliation does not cover the exact current action footprint and control heads', 'UNVERIFIED_AUDIT');
    }
    return appendInternal(this, {
      type: 'evidence',
      emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-audit:${verified.channel}` },
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        evidence_kind: 'audit_reconciliation',
        audit_head: verified.payload.audit_head,
        intent_id: verified.payload.intent_id,
        candidate_artifacts: verified.payload.candidate_artifacts,
        candidate_set_hash: verified.payload.candidate_set_hash,
        complete: verified.payload.complete,
        action_claim_ids: verified.payload.action_claim_ids,
        action_footprint_hash: verified.payload.action_footprint_hash,
        evaluated_event_head: verified.payload.evaluated_event_head,
        evaluated_witness_head: verified.payload.evaluated_witness_head,
        coordinator_binding_hash: authority.binding_hash,
        coordinator_attestation_hash: authority.binding.attestation_hash,
        attestation_ref: archiveVerifiedEvidence(this, verified.payload),
        observed_at: verified.payload.observed_at,
      },
    });
  }

  delegate({ capability, ownerTurnEnvelope, decisionId, dispatchEnvelope }) {
    assertActionControlPlaneUnlocked(this, 'delegation');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    if (!internal.header.semantic_authority) requireAcceptanceAuthority(internal);
    const { principal, trustedTurn } = verifyOwnerOperation(this, {
      capability,
      ownerTurnEnvelope,
      operation: 'delegation',
    });
    const decision = internal.state.decisions[decisionId];
    if (!decision) throw new OwnerKernelBlockedError('delegation decision does not exist', 'DELEGATION_DECISION_UNKNOWN');
    if (internal.state.block_reasons.length > 0
      || decision.delegation_count >= internal.policy.max_delegate_per_decision) {
      throw new OwnerKernelBlockedError(
        'delegation is blocked until a new authenticated decision resets the delegation budget',
        'DELEGATION_BUDGET_EXHAUSTED',
      );
    }
    const verified = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'delegationVerifier')(dispatchEnvelope, {
        run_id: internal.header.run_id,
        decision_id: decisionId,
        decision_content_hash: decision.decision_content_hash,
        ...(internal.header.semantic_authority ? {
          semantic_route_hash: internal.header.semantic_authority.route_hash,
          worker_binding: cloneCanonical(
            internal.header.semantic_authority.route.worker_binding,
          ),
        } : {}),
      }),
      'delegation dispatch',
      { runId: internal.header.run_id },
    );
    if (internal.header.semantic_authority) {
      const boundWorker = internal.header.semantic_authority.route.worker_binding;
      const boundWorkerHash = sha256(canonicalJson(boundWorker));
      if (verified.identity !== boundWorker.identity
        || verified.payload.worker_identity !== boundWorker.identity
        || verified.payload.worker_binding_hash !== boundWorkerHash) {
        throw new OwnerKernelBlockedError(
          'semantic delegation verifier does not match the intake-frozen worker binding',
          'DELEGATION_WORKER_MISMATCH',
        );
      }
    }
    return appendInternal(this, {
      type: 'delegation',
      emitter: { kind: 'owner', identity: principal.identity, channel: trustedTurn.channel },
      payload: {
        delegation_id: nextIdentifier(internal, 'delegation'),
        decision_id: decisionId,
        decision_content_hash: decision.decision_content_hash,
        dispatch_hash: verified.payload.dispatch_hash,
        worker_identity: verified.payload.worker_identity,
        worker_family: verified.payload.worker_family,
        delegation_count: (decision.delegation_count || 0) + 1,
      },
    });
  }

  recover({ capability, ownerTurnEnvelope, decisionId, reason, sourceEvidenceIds }) {
    assertActionControlPlaneUnlocked(this, 'recovery');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    requireAcceptanceAuthority(internal);
    const { principal, trustedTurn } = verifyOwnerOperation(this, {
      capability,
      ownerTurnEnvelope,
      operation: 'recovery',
    });
    const decision = internal.state.decisions[decisionId];
    if (!decision) throw new OwnerKernelBlockedError('recovery decision does not exist', 'RECOVERY_DECISION_UNKNOWN');
    if (internal.state.block_reasons.length > 0
      || decision.recovery_count >= internal.policy.max_recover_cycles) {
      throw new OwnerKernelBlockedError(
        'recovery is blocked until a new authenticated decision resets the recovery budget',
        'RECOVERY_BUDGET_EXHAUSTED',
      );
    }
    return appendInternal(this, {
      type: 'recovery',
      emitter: { kind: 'owner', identity: principal.identity, channel: trustedTurn.channel },
      payload: {
        recovery_id: nextIdentifier(internal, 'recovery'),
        decision_id: decisionId,
        decision_content_hash: decision.decision_content_hash,
        reason,
        source_evidence_ids: sourceEvidenceIds,
        recovery_count: (decision.recovery_count || 0) + 1,
      },
    });
  }

  reconcileActionClaim(claimId) {
    assertActionControlPlaneUnlocked(this, 'action reconciliation');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    requireAcceptanceAuthority(internal);
    if (!hasActionAuthority(internal)) {
      throw new OwnerKernelBlockedError('action reconciliation requires an authority-enabled Kernel run', 'ACTION_AUTHORITY_REQUIRED');
    }
    const claim = internal.state.action_claims[claimId];
    if (!claim || claim.outcome !== 'unknown') {
      throw new OwnerKernelBlockedError('action reconciliation requires a durably unknown action claim', 'ACTION_RECONCILIATION_PENDING');
    }
    const outcome = internal.state.action_outcomes[claimId];
    if (!outcome || outcome.outcome !== 'unknown' || !isSha256(outcome.outcome_event_hash)
      || !isSha256(outcome.outcome_witness_head)) {
      throw new OwnerKernelBlockedError('action reconciliation requires one witnessed unknown action outcome', 'ACTION_RECONCILIATION_PENDING');
    }
    if (!isSha256(outcome.execution_authorization_hash) || typeof outcome.authorization_id !== 'string') {
      throw new OwnerKernelBlockedError(
        'action reconciliation cannot convert an unknown claim that never held a witnessed post-claim authorization into success',
        'ACTION_RECONCILIATION_UNAUTHORIZED',
      );
    }
    const receiptBinding = internal.actionAuthority.receipt_verifier_binding;
    const verified = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'actionReconciliationVerifier')({
        run_id: internal.header.run_id,
        policy_hash: internal.header.policy_hash,
        authority_hash: internal.header.authority_hash,
        claim_id: claimId,
        claim: cloneCanonical(claim),
        outcome: cloneCanonical(outcome),
        claim_event_hash: claim.claim_event_hash,
        claim_witness_head: claim.claim_witness_head,
        execution_permit_hash: claim.execution_permit_hash,
        original_outcome_hash: sha256(canonicalJson(outcome)),
        original_outcome_event_hash: outcome.outcome_event_hash,
        original_outcome_witness_head: outcome.outcome_witness_head,
        receipt_verifier_binding_hash: internal.actionAuthority.receipt_verifier_binding_hash,
        receipt_verifier_attestation_hash: receiptBinding.attestation_hash,
      }, { run_id: internal.header.run_id }),
      'action reconciliation result',
      { runId: internal.header.run_id },
    );
    if (verified.identity !== receiptBinding.identity
      || verified.payload.attestation_sha256 !== receiptBinding.attestation_hash
      || verified.payload.verification_path !== 'action_reconciliation') {
      throw new OwnerKernelError('action reconciliation is not independently bound to the receipt verifier', 'UNVERIFIED_ACTION_RECONCILIATION');
    }
    const payload = verified.payload;
    const originalOutcomeHash = sha256(canonicalJson(outcome));
    if (payload.claim_id !== claimId
      || payload.claim_event_hash !== claim.claim_event_hash
      || payload.claim_witness_head !== claim.claim_witness_head
      || payload.execution_permit_hash !== claim.execution_permit_hash
      || payload.original_outcome_hash !== originalOutcomeHash
      || payload.original_outcome_event_hash !== outcome.outcome_event_hash
      || payload.original_outcome_witness_head !== outcome.outcome_witness_head
      || payload.observed_action_descriptor_hash !== claim.action_descriptor_hash) {
      throw new OwnerKernelError(
        'action reconciliation does not exactly bind the requested claim, permit, prior unknown outcome, and descriptor',
        'UNVERIFIED_ACTION_RECONCILIATION',
      );
    }
    const reconciliationProof = {
      run_id: internal.header.run_id,
      policy_hash: internal.header.policy_hash,
      authority_hash: internal.header.authority_hash,
      claim_id: claimId,
      claim_event_hash: claim.claim_event_hash,
      claim_witness_head: claim.claim_witness_head,
      execution_permit_hash: claim.execution_permit_hash,
      original_outcome_hash: originalOutcomeHash,
      original_outcome_event_hash: outcome.outcome_event_hash,
      original_outcome_witness_head: outcome.outcome_witness_head,
      execution_authorization_hash: payload.execution_authorization_hash,
      authorization_id: payload.authorization_id,
      resolution: payload.resolution,
      observed_action_descriptor_hash: claim.action_descriptor_hash,
      receipt_ref: payload.receipt_ref,
      broker_receipt: payload.broker_receipt === undefined ? null : payload.broker_receipt,
      boundary_effect_id: payload.boundary_effect_id,
      boundary_state_version: payload.boundary_state_version,
      boundary_attestation_hash: payload.boundary_attestation_hash,
      effect_at: payload.effect_at,
      receipt_verifier_binding_hash: internal.actionAuthority.receipt_verifier_binding_hash,
      receipt_verifier_attestation_hash: receiptBinding.attestation_hash,
      reconciled_at: payload.reconciled_at,
    };
    const expectedReconciliationHash = actionReconciliationHash(reconciliationProof);
    if (payload.reconciliation_hash !== expectedReconciliationHash) {
      throw new OwnerKernelError('action reconciliation hash does not bind its complete receipt-verifier proof', 'UNVERIFIED_ACTION_RECONCILIATION');
    }
    return appendInternal(this, {
      type: 'evidence',
      emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-action-reconcile:${verified.channel}` },
      payload: {
        evidence_id: nextIdentifier(internal, 'evidence'),
        evidence_kind: 'action_reconciliation',
        claim_id: claimId,
        resolution: payload.resolution,
        reconciliation_hash: payload.reconciliation_hash,
        claim_event_hash: claim.claim_event_hash,
        claim_witness_head: claim.claim_witness_head,
        execution_permit_hash: claim.execution_permit_hash,
        original_outcome_hash: originalOutcomeHash,
        original_outcome_event_hash: outcome.outcome_event_hash,
        original_outcome_witness_head: outcome.outcome_witness_head,
        execution_authorization_hash: payload.execution_authorization_hash,
        authorization_id: payload.authorization_id,
        receipt_ref: payload.receipt_ref,
        broker_receipt: payload.broker_receipt === undefined ? null : payload.broker_receipt,
        observed_action_descriptor_hash: claim.action_descriptor_hash,
        boundary_effect_id: payload.boundary_effect_id,
        boundary_state_version: payload.boundary_state_version,
        boundary_attestation_hash: payload.boundary_attestation_hash,
        effect_at: payload.effect_at,
        receipt_verifier_binding_hash: internal.actionAuthority.receipt_verifier_binding_hash,
        receipt_verifier_attestation_hash: receiptBinding.attestation_hash,
        attestation_ref: archiveVerifiedEvidence(this, payload),
        reconciled_at: payload.reconciled_at,
      },
    });
  }

  async accept({ capability, timeoutMilliseconds } = {}) {
    assertActionControlPlaneUnlocked(this, 'acceptance');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    if (internal.state.status === 'complete') {
      throw new OwnerKernelBlockedError('a terminal Owner Kernel run cannot accept again', 'TERMINAL_COMPLETION');
    }
    const authority = requireAcceptanceAuthority(internal);
    const timeout = normalizeAcceptanceTimeoutMilliseconds(timeoutMilliseconds);
    const initialNow = nowIso(internal.clock);
    assertCapability(this, capability, initialNow);
    const initialPrincipal = assertCurrentQualification(this, 'acceptance', initialNow);
    // The acceptance API has no model-authored payload. The coordinator owns the attempt lifecycle,
    // including cancellation tombstones and the single terminal batch linearization.
    let expectedEventHead = null;
    let expectedWitnessHead = null;
    let attempt = null;
    let transaction = null;
    let snapshot = null;
    let outcome = 'failed';
    let failure = null;
    let acquired = false;
    let leaseClosed = false;
    let releaseConfirmed = false;
    let coordinatorResolution = null;
    let commitStarted = false;
    let result = null;
    let thrown = null;
    const persistQueuedAbortRequest = () => {
      if (!transaction || !transaction.abort || internal.state.abort_request !== null
        || internal.state.status === 'complete') return null;
      const abort = transaction.abort;
      return appendInternal(this, {
        type: 'abort_request',
        emitter: { kind: 'user', identity: abort.identity, channel: abort.channel },
        payload: { reason: abort.reason, envelope_hash: abort.envelope_hash },
        skipAutomaticCheckpoint: true,
      });
    };
    const appendQueuedAbort = () => {
      if (!transaction || !transaction.abort) return null;
      const abort = transaction.abort;
      if (internal.state.status === 'complete') {
        return appendLateUserAbortControl(this, abort);
      }
      persistQueuedAbortRequest();
      if (internal.state.acceptance_attempt && internal.state.acceptance_attempt.status === 'pending') {
        throw new OwnerKernelBlockedError(
          'user abort remains pending until the acceptance coordinator records a final resolution',
          'ACCEPTANCE_CONTROL_UNRESOLVED',
        );
      }
      const event = appendInternal(this, {
        type: 'abort',
        emitter: { kind: 'user', identity: abort.identity, channel: abort.channel },
        payload: { reason: abort.reason },
        skipAutomaticCheckpoint: true,
      });
      transaction.abort = null;
      outcome = 'aborted';
      result = { accepted: false, aborted: true, event };
      return event;
    };
    try {
      const acceptanceNow = nowIso(internal.clock);
      assertCurrentWitnessHead(this);
      if (hasActionAuthority(internal)) assertCurrentHostCapability(this, 'acceptance', acceptanceNow);
      if (internal.state.status === 'complete') {
        throw new OwnerKernelBlockedError(
          'an authenticated user abort was recorded before the acceptance attempt began',
          'ACCEPTANCE_ABORT_ORDERED',
        );
      }
      const attemptStartedAt = acceptanceNow;
      attempt = makeAcceptanceAttempt(internal, {
        expectedEventHead: internal.state.event_head,
        expectedWitnessHead: internal.state.witness_head,
        attemptStartedAt,
      });
      transaction = {
        phase: 'recording_attempt',
        attempt,
        snapshot: null,
        abort: null,
      };
      internal.acceptanceTransaction = transaction;
      internal.acceptanceLock = true;
      appendInternal(this, {
        type: 'acceptance_attempt',
        emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-acceptance:${authority.binding.identity}` },
        payload: {
          attempt_id: attempt.attempt_id,
          attempt_hash: attempt.attempt_hash,
          coordinator_binding_hash: authority.binding_hash,
          expected_event_head: attempt.expected_event_head,
          expected_witness_head: attempt.expected_witness_head,
          intent_id: attempt.intent_id,
          attempt_started_at: attempt.attempt_started_at,
        },
        skipAutomaticCheckpoint: true,
      });
      expectedEventHead = internal.state.event_head;
      expectedWitnessHead = internal.state.witness_head;
      transaction.phase = 'acquiring';
      if (transaction.abort !== null) {
        outcome = 'aborted';
        throw new OwnerKernelBlockedError(
          'an authenticated user abort is ordered before acceptance acquisition',
          'ACCEPTANCE_ABORT_ORDERED',
        );
      }
      const acquireRequest = {
        run_id: internal.header.run_id,
        policy_hash: internal.header.policy_hash,
        contract_hash: internal.header.contract_hash,
        coordinator_binding_hash: authority.binding_hash,
        attempt_id: attempt.attempt_id,
        attempt_hash: attempt.attempt_hash,
        expected_intent_id: internal.state.current_intent_id,
        expected_event_head: expectedEventHead,
        expected_witness_head: expectedWitnessHead,
        attempt_started_at: attempt.attempt_started_at,
        timeout_milliseconds: timeout,
      };
      const acquirePromise = Promise.resolve().then(() => authority.acquire(acquireRequest));
      const rawSnapshot = await awaitAcceptanceTimeout(acquirePromise, timeout, {
        onTimeout: () => {
          const cancellation = coordinatorCancellationRequest(internal, attempt, { reason: 'acquire_timeout' });
          Promise.resolve(authority.cancel(cancellation)).catch(() => {});
          // A late grant must be released once. The tombstone prevents it becoming usable.
          acquirePromise.then((lateSnapshot) => Promise.resolve(authority.release({
            ...cancellation,
            transaction_id: lateSnapshot && lateSnapshot.transaction_id ? lateSnapshot.transaction_id : null,
            fence: lateSnapshot && lateSnapshot.fence ? lateSnapshot.fence : null,
            outcome: 'acquire_timeout',
          })).catch(() => {})).catch(() => {});
        },
      });
      acquired = true;
      transaction.lease_hint = rawSnapshot;
      snapshot = normalizeAcceptanceSnapshot(rawSnapshot, {
        runId: internal.header.run_id,
        attemptId: attempt.attempt_id,
        attemptHash: attempt.attempt_hash,
        expectedIntentId: attempt.intent_id,
        expectedEventHead,
        expectedWitnessHead,
      });
      transaction.snapshot = snapshot;
      transaction.phase = 'preflight';
      if (transaction.abort !== null) {
        outcome = 'aborted';
      }
      if (transaction.abort !== null) {
        throw new OwnerKernelBlockedError(
          'an authenticated user abort is ordered before acceptance preflight',
          'ACCEPTANCE_ABORT_ORDERED',
        );
      }
      if (result !== null) return result;
      const now = nowIso(internal.clock);
      assertCapability(this, capability, now);
      const principal = assertCurrentQualification(this, 'acceptance', now);
      if (principal.identity !== initialPrincipal.identity) {
        throw new OwnerKernelBlockedError('acceptance principal changed while the candidate lock was held', 'ACCEPTANCE_PRINCIPAL_CHANGED');
      }
      assertCurrentWitnessHead(this);
      if (hasActionAuthority(internal)) assertCurrentHostCapability(this, 'acceptance', now);
      const predicate = evaluateAcceptancePredicate(internal.state, snapshot);
      if (!predicate.ok) {
        failure = predicate;
        outcome = predicate.disposition;
      } else {
        const legProjectionHash = sha256(canonicalJson(
        internal.contract.legs.map((leg) => classifyContractLeg(leg)),
        ));
        const disclosureHash = sha256(canonicalJson(deriveDisclosure(internal.state)));
        const predicateHash = sha256(canonicalJson({
        predicate_version: 1,
        evaluated_event_head: snapshot.control_event_head,
        evaluated_witness_head: snapshot.control_witness_head,
        candidate_set_hash: snapshot.candidate_set_hash,
        delivered_set_hash: snapshot.delivered_set_hash,
        audit_head: snapshot.audit_head,
        intent_id: snapshot.intent_id,
        leg_projection_hash: legProjectionHash,
        disclosure_hash: disclosureHash,
        principal_id: principal.identity,
        principal_attestation_hash: principal.attestation.sha256,
        }));
        if (transaction.abort !== null) {
          outcome = 'aborted';
          throw new OwnerKernelBlockedError('an authenticated user abort is ordered before acceptance commit', 'ACCEPTANCE_ABORT_ORDERED');
        }
        transaction.phase = 'committing';
        const acceptanceId = nextIdentifier(internal, 'acceptance');
        const batchId = `acceptance-batch-${crypto.randomBytes(16).toString('hex')}`;
        const acceptanceEvents = await appendBatchInternal(this, [
        {
          type: 'acceptance',
          emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-acceptance:${authority.binding.identity}` },
          payload: {
            acceptance_id: acceptanceId,
            attempt_id: attempt.attempt_id,
            attempt_hash: attempt.attempt_hash,
            attempt_started_at: attempt.attempt_started_at,
            transaction_id: snapshot.transaction_id,
            coordinator_binding_hash: authority.binding_hash,
            fence: snapshot.fence,
            snapshot_hash: snapshot.snapshot_hash,
            snapshot_at: snapshot.snapshot_at,
            intent_id: snapshot.intent_id,
            candidate_artifacts: snapshot.candidate_artifacts,
            candidate_set_hash: snapshot.candidate_set_hash,
            delivered_artifacts: snapshot.delivered_artifacts,
            delivered_set_hash: snapshot.delivered_set_hash,
            audit_head: snapshot.audit_head,
            evaluated_event_head: snapshot.control_event_head,
            evaluated_witness_head: snapshot.control_witness_head,
            principal_id: principal.identity,
            principal_attestation_hash: principal.attestation.sha256,
            leg_projection_hash: legProjectionHash,
            disclosure_hash: disclosureHash,
            predicate_hash: predicateHash,
          },
        },
        {
          type: 'complete',
          emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-acceptance:${authority.binding.identity}` },
          payload: ({ previous_event: previousEvent }) => ({
            acceptance_id: acceptanceId,
            acceptance_event_hash: previousEvent.event_hash,
            terminal_reason: 'accepted',
          }),
        },
        ], {
          batchId,
          appendBatch: async (batchRequest, provisionalEvents) => {
            const commitRequest = {
              run_id: internal.header.run_id,
              policy_hash: internal.header.policy_hash,
              contract_hash: internal.header.contract_hash,
              coordinator_binding_hash: authority.binding_hash,
              attempt_id: attempt.attempt_id,
              attempt_hash: attempt.attempt_hash,
              transaction_id: snapshot.transaction_id,
              fence: snapshot.fence,
              expected_event_head: expectedEventHead,
              expected_witness_head: expectedWitnessHead,
              expected_intent_id: attempt.intent_id,
              attempt_started_at: attempt.attempt_started_at,
              snapshot_hash: snapshot.snapshot_hash,
              snapshot_at: snapshot.snapshot_at,
              batch: batchRequest,
              provisional_events: cloneCanonical(provisionalEvents),
            };
            let committed;
            try {
              // The atomic preflight above has passed. From this point only the coordinator
              // can determine whether the terminal batch committed or must be recovered.
              commitStarted = true;
              committed = await awaitAcceptanceTimeout(authority.commit(commitRequest), timeout, {
                onTimeout: () => authority.cancel(coordinatorCancellationRequest(internal, attempt, {
                  transactionId: snapshot.transaction_id,
                  fence: snapshot.fence,
                  reason: 'commit_timeout',
                })),
              });
            } catch (error) {
              if (error && error.code === 'ACCEPTANCE_TRANSACTION_TIMEOUT') {
                committed = await awaitAcceptanceTimeout(authority.resolveAttempt({
                  ...coordinatorCancellationRequest(internal, attempt, {
                    transactionId: snapshot.transaction_id,
                    fence: snapshot.fence,
                    reason: 'resolve_after_commit_timeout',
                  }),
                  expected_event_head: expectedEventHead,
                  expected_witness_head: expectedWitnessHead,
                }), timeout, {
                  onTimeout: () => authority.cancel(coordinatorCancellationRequest(internal, attempt, {
                    transactionId: snapshot.transaction_id,
                    fence: snapshot.fence,
                    reason: 'resolve_timeout',
                  })),
                });
              } else {
                throw error;
              }
            }
            if (!committed || typeof committed !== 'object'
              || committed.run_id !== internal.header.run_id
              || committed.attempt_id !== attempt.attempt_id
              || committed.attempt_hash !== attempt.attempt_hash
              || committed.transaction_id !== snapshot.transaction_id
              || committed.fence !== snapshot.fence) {
              throw new OwnerKernelError('acceptance coordinator commit is not bound to the active attempt and fence', 'ACCEPTANCE_COORDINATOR_REJECTED');
            }
            if (committed.disposition === 'aborted' || committed.disposition === 'cancelled') {
              if (!transaction.abort && committed.user_abort && typeof committed.user_abort === 'object') {
                transaction.abort = cloneCanonical(committed.user_abort);
              }
              throw new OwnerKernelBlockedError('the acceptance coordinator ordered abort before the terminal batch', 'ACCEPTANCE_ABORT_ORDERED');
            }
            if (committed.disposition !== 'accepted' || committed.lease_released !== true
              || !Array.isArray(committed.receipts)
              || !Array.isArray(committed.event_records)
              || canonicalJson(committed.event_records) !== canonicalJson(provisionalEvents)
              || !committed.coordinator_commitment || typeof committed.coordinator_commitment !== 'object'
              || Array.isArray(committed.coordinator_commitment)) {
              throw new OwnerKernelError('acceptance coordinator did not attest one released accepted batch', 'ACCEPTANCE_COORDINATOR_REJECTED');
            }
            const commitVerification = assertSynchronousCoordinatorVerification(authority.verifyCommit({
              ...commitRequest,
              disposition: 'accepted',
              coordinator_commitment: cloneCanonical(committed.coordinator_commitment),
              receipts: cloneCanonical(committed.receipts),
            }), 'acceptance coordinator verifyCommit()');
            if (commitVerification !== true && (!commitVerification || commitVerification.ok !== true)) {
              throw new OwnerKernelError('acceptance coordinator commit commitment did not verify independently', 'ACCEPTANCE_COORDINATOR_REJECTED');
            }
            if (committed.receipts.some((receipt) => !receipt
              || canonicalJson(receipt.coordinator_commitment) !== canonicalJson(committed.coordinator_commitment))) {
              throw new OwnerKernelError('acceptance coordinator commitment is absent from its immutable witness batch', 'ACCEPTANCE_COORDINATOR_REJECTED');
            }
            leaseClosed = true;
            return { receipts: committed.receipts };
          },
        });
        outcome = 'accepted';
        result = { accepted: true, acceptance: acceptanceEvents[0], complete: acceptanceEvents[1] };
      }
    } catch (error) {
      if (error && error.code === 'ACCEPTANCE_ABORT_ORDERED' && transaction && transaction.abort !== null) {
        outcome = 'aborted';
      } else {
        thrown = error;
      }
    } finally {
      if (transaction) transaction.phase = 'releasing';
      try {
        persistQueuedAbortRequest();
        if (transaction && transaction.abort_order) {
          try {
            await awaitAcceptanceTimeout(transaction.abort_order, timeout);
          } catch (_error) {
            // The signed abort_request already exists. resolveAttempt()/release() below is the
            // authoritative recovery path when the ordering acknowledgement is lost.
          }
        }
        if (acquired && !leaseClosed) {
          const leaseHint = transaction && transaction.lease_hint && typeof transaction.lease_hint === 'object'
            ? transaction.lease_hint
            : null;
          const releaseResponse = await awaitAcceptanceTimeout(authority.release({
            ...coordinatorCancellationRequest(internal, attempt, {
              transactionId: snapshot && snapshot.transaction_id
                ? snapshot.transaction_id
                : (leaseHint && typeof leaseHint.transaction_id === 'string' ? leaseHint.transaction_id : null),
              fence: snapshot && snapshot.fence
                ? snapshot.fence
                : (leaseHint && isSha256(leaseHint.fence) ? leaseHint.fence : null),
              reason: 'release',
            }),
            outcome,
          }), timeout, {
            onTimeout: () => authority.cancel(coordinatorCancellationRequest(internal, attempt, {
              transactionId: snapshot && snapshot.transaction_id,
              fence: snapshot && snapshot.fence,
              reason: 'release_timeout',
            })),
          });
          if (releaseResponse && releaseResponse.disposition === 'accepted') {
            const events = await importAcceptedAttemptBatch(this, releaseResponse);
            leaseClosed = true;
            result = { accepted: true, acceptance: events[0], complete: events[1], recovered: true };
          } else {
            coordinatorResolution = await normalizeCoordinatorResolution(internal, attempt, releaseResponse, {
              allowedDispositions: ['released', 'cancelled', 'aborted'],
            });
          }
          releaseConfirmed = true;
        } else if (attempt && !leaseClosed) {
          const resolutionResponse = await awaitAcceptanceTimeout(authority.resolveAttempt({
            ...coordinatorCancellationRequest(internal, attempt, {
              transactionId: snapshot && snapshot.transaction_id,
              fence: snapshot && snapshot.fence,
              reason: transaction && transaction.abort ? 'resolve_user_abort' : 'resolve_after_acceptance_failure',
            }),
            expected_event_head: internal.state.event_head,
            expected_witness_head: internal.state.witness_head,
          }), timeout, {
            onTimeout: () => authority.cancel(coordinatorCancellationRequest(internal, attempt, {
              transactionId: snapshot && snapshot.transaction_id,
              fence: snapshot && snapshot.fence,
              reason: 'resolve_timeout',
            })),
          });
          if (resolutionResponse && resolutionResponse.disposition === 'accepted') {
            const events = await importAcceptedAttemptBatch(this, resolutionResponse);
            leaseClosed = true;
            result = { accepted: true, acceptance: events[0], complete: events[1], recovered: true };
          } else {
            coordinatorResolution = await normalizeCoordinatorResolution(internal, attempt, resolutionResponse, {
              allowedDispositions: ['released', 'cancelled', 'aborted'],
            });
          }
          releaseConfirmed = true;
        }
      } catch (error) {
        if (attempt && !commitStarted) {
          Promise.resolve(authority.cancel(coordinatorCancellationRequest(internal, attempt, {
            transactionId: snapshot && snapshot.transaction_id,
            fence: snapshot && snapshot.fence,
            reason: 'release_failed',
          }))).catch(() => {});
        }
        if (thrown === null && result === null) thrown = error;
      } finally {
        if (attempt && !leaseClosed && releaseConfirmed && coordinatorResolution
          && internal.state.status !== 'complete') {
          try {
            await appendAcceptanceResolutionInternal(this, attempt, {
              disposition: coordinatorResolution.disposition,
              coordinatorResolution,
            });
          } catch (error) {
            if (thrown === null) thrown = error;
          }
        }
        if (transaction && transaction.abort !== null) {
          try {
            appendQueuedAbort();
          } catch (error) {
            if (thrown === null) thrown = error;
          }
        }
        if (failure !== null && internal.state.status !== 'complete' && result === null && thrown === null) {
          appendInternal(this, {
            type: 'evidence',
            emitter: { kind: 'kernel', identity: 'owner-kernel', channel: `kernel-acceptance:${authority.binding.identity}` },
            payload: {
              evidence_id: nextIdentifier(internal, 'evidence'),
              evidence_kind: 'acceptance_failure',
              failure_id: nextIdentifier(internal, 'acceptance-failure'),
              disposition: failure.disposition,
              reasons: failure.reasons,
              snapshot_hash: snapshot.snapshot_hash,
              candidate_set_hash: snapshot.candidate_set_hash,
              audit_head: snapshot.audit_head,
            },
          });
        }
        if (internal.state.acceptance_attempt && internal.state.acceptance_attempt.status === 'pending'
          && thrown === null && result === null) {
          thrown = new OwnerKernelBlockedError(
            'acceptance attempt remains unresolved after coordinator recovery; resume recovery is required',
            'ACCEPTANCE_RECOVERY_REQUIRED',
          );
        }
        if (result && (result.recovered === true || result.aborted === true)) {
          // The durable coordinator/witness result supersedes a transient transport or
          // batch-response failure once it has been imported or terminalized locally.
          thrown = null;
        }
        internal.acceptanceTransaction = null;
        internal.acceptanceLock = false;
      }
    }
    if (thrown !== null) throw thrown;
    if (result !== null) return result;
    return { accepted: false, disposition: failure.disposition, reasons: failure.reasons };
  }

  freezeTaskAuthority({ capability, taskAuthorityInput }) {
    assertActionControlPlaneUnlocked(this, 'task authority freeze');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    assertCapability(this, capability, now);
    assertCurrentQualification(this, 'task_authority_freeze', now);
    assertCurrentWitnessHead(this);
    const input = requirePlainDataObject(taskAuthorityInput, 'task authority input');
    const frozen = freezeTaskAuthorityEnvelope({
      ...cloneCanonical(input),
      policy: internal.policy,
      policyHash: internal.header.policy_hash,
    });
    const currentId = internal.state.current_task_authority_id;
    if (currentId !== undefined && currentId !== null) {
      const existing = internal.state.task_authorities[currentId];
      if (existing.task_authority_id !== frozen.envelope.task_authority_id
        || existing.task_authority_hash !== frozen.envelope_hash) {
        throw new OwnerKernelBlockedError(
          'the current intent already has a different witnessed task authority',
          'TASK_AUTHORITY_CONFLICT',
        );
      }
      const event = internal.events.find((candidate) => (
        candidate.type === 'task_authority_frozen'
        && candidate.payload.task_authority_id === currentId
      ));
      return cloneCanonical({
        status: 'shadow_anchored',
        authority_status: 'shadow',
        envelope: existing.envelope,
        envelope_hash: existing.task_authority_hash,
        event,
      });
    }
    const event = appendInternal(this, {
      type: 'task_authority_frozen',
      emitter: {
        kind: 'kernel',
        identity: 'owner-kernel',
        channel: 'kernel-task-authority',
      },
      payload: {
        intent_id: internal.state.current_intent_id,
        task_authority_id: frozen.envelope.task_authority_id,
        task_authority_hash: frozen.envelope_hash,
        envelope: frozen.envelope,
      },
    });
    return cloneCanonical({
      status: 'shadow_anchored',
      authority_status: 'shadow',
      ...frozen,
      event,
    });
  }

  issueRoleGrant({ capability, grantRequest }) {
    assertActionControlPlaneUnlocked(this, 'role grant issuance');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    assertCapability(this, capability, now);
    assertCurrentQualification(this, 'role_grant_issue', now);
    assertCurrentWitnessHead(this);
    if (internal.state.task_authority_version !== 1
      || internal.state.current_task_authority_id === null) {
      throw new OwnerKernelBlockedError(
        'role grant issuance requires a witnessed current task authority',
        'TASK_AUTHORITY_REQUIRED',
      );
    }
    const request = requirePlainDataObject(grantRequest, 'role grant request');
    requireOnlyDataKeys(request, new Set([
      'dispatchId',
      'role',
      'risk',
      'capabilityScope',
      'allowedTools',
      'allowedArtifacts',
      'requestedEffects',
      'requestedEgress',
      'requiredEvidence',
      'resourceBudget',
      'contextBudget',
      'topology',
      'assurance',
      'evaluationTime',
      'expiresAt',
    ]), 'role grant request');
    const canonicalRequest = cloneCanonical(request);
    const dispatchId = requireProtocolToken(canonicalRequest.dispatchId, 'role grant dispatch id');
    const role = requireProtocolToken(canonicalRequest.role, 'role grant role');
    if (typeof canonicalRequest.evaluationTime !== 'string'
      || Number.isNaN(Date.parse(canonicalRequest.evaluationTime))
      || new Date(canonicalRequest.evaluationTime).toISOString() !== now) {
      throw new OwnerKernelError(
        'role grant evaluation time must equal the trusted Kernel clock',
        'INVALID_ROLE_AUTHORITY_INPUT',
      );
    }
    const taskAuthorityId = internal.state.current_task_authority_id;
    const requestHash = sha256(canonicalJson({
      task_authority_id: taskAuthorityId,
      request: canonicalRequest,
    }));
    const existing = Object.values(internal.state.role_grants)
      .find((entry) => entry.dispatch_id === dispatchId);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new OwnerKernelBlockedError(
          'dispatch id was already witnessed for a different role grant request',
          'ROLE_GRANT_REPLAY_CONFLICT',
        );
      }
      const event = internal.events.find((candidate) => (
        candidate.type === 'role_grant_issued'
        && candidate.payload.grant_id === existing.grant_id
      ));
      return cloneCanonical({
        status: 'shadow_issued',
        authority_status: 'shadow',
        grant: existing.grant,
        event,
      });
    }

    const verifier = requireAdapter(internal.adapters, 'roleCapabilityVerifier');
    const rawVerification = verifier({
      run_id: internal.header.run_id,
      policy_hash: internal.header.policy_hash,
      task_authority_id: taskAuthorityId,
      dispatch_id: dispatchId,
      role,
      capability_scope: cloneCanonical(canonicalRequest.capabilityScope),
      risk: canonicalRequest.risk,
      evaluation_time: canonicalRequest.evaluationTime,
    });
    const verification = requirePlainDataObject(
      rawVerification,
      'trusted role capability verification',
    );
    requireOnlyDataKeys(verification, new Set([
      'ok',
      'run_id',
      'task_authority_id',
      'dispatch_id',
      'role',
      'role_eligibility',
      'capability_state',
      'model_identity',
      'evidence',
      'evidence_store_anchor',
      'identity',
      'channel',
    ]), 'trusted role capability verification');
    if (verification.ok !== true
      || verification.run_id !== internal.header.run_id
      || verification.task_authority_id !== taskAuthorityId
      || verification.dispatch_id !== dispatchId
      || verification.role !== role
      || typeof verification.identity !== 'string' || verification.identity.length === 0
      || typeof verification.channel !== 'string' || verification.channel.length === 0) {
      throw new OwnerKernelBlockedError(
        'trusted role capability verifier did not bind the current run, task, dispatch, and role',
        'UNVERIFIED_ROLE_CAPABILITY',
      );
    }
    const evidence = Array.isArray(verification.evidence) ? verification.evidence : [];
    const anchor = requirePlainDataObject(
      verification.evidence_store_anchor,
      'trusted capability evidence store anchor',
    );
    requireOnlyDataKeys(anchor, new Set([
      'schema_version',
      'authority_kind',
      'run_nonce_hash',
      'store_head_hash',
      'query_hash',
      'receipts_hash',
      'evidence_ids',
    ]), 'trusted capability evidence store anchor');
    const expectedQueryHash = sha256(canonicalJson({
      task_authority_id: taskAuthorityId,
      dispatch_id: dispatchId,
      role,
      capability_scope: canonicalRequest.capabilityScope,
      model_identity: verification.model_identity,
      capability_state: verification.capability_state,
      evaluation_time: canonicalRequest.evaluationTime,
    }));
    const evidenceIds = evidence.map((receipt) => receipt && receipt.evidence_id).sort();
    if (anchor.schema_version !== 1
      || anchor.authority_kind !== 'session_local'
      || !isSha256(anchor.run_nonce_hash)
      || !isSha256(anchor.store_head_hash)
      || anchor.query_hash !== expectedQueryHash
      || anchor.receipts_hash !== sha256(canonicalJson(evidence))
      || !Array.isArray(anchor.evidence_ids)
      || canonicalJson(anchor.evidence_ids) !== canonicalJson(evidenceIds)
      || evidenceIds.some((id) => !isSha256(id))) {
      throw new OwnerKernelBlockedError(
        'trusted role capability verifier did not bind evidence to its store and exact query',
        'UNVERIFIED_ROLE_CAPABILITY',
      );
    }
    const trustedReceiptIds = new Set(evidenceIds);
    const candidate = resolveRoleExecutionGrant({
      ...canonicalRequest,
      envelope: internal.state.task_authorities[taskAuthorityId].envelope,
      roleEligibility: verification.role_eligibility,
      capabilityState: verification.capability_state,
      modelIdentity: verification.model_identity,
      evidence,
    }, {
      evidenceVerifier: (receipt) => trustedReceiptIds.has(receipt.evidence_id),
    });
    if (candidate.status !== 'candidate') return candidate;
    const capabilityVerificationHash = sha256(canonicalJson(verification));
    const event = appendInternal(this, {
      type: 'role_grant_issued',
      emitter: {
        kind: 'kernel',
        identity: 'owner-kernel',
        channel: `kernel-role-grant:${verification.channel}`,
      },
      payload: {
        task_authority_id: taskAuthorityId,
        grant_id: candidate.grant.grant_id,
        dispatch_id: candidate.grant.dispatch_id,
        request_hash: requestHash,
        capability_verification_hash: capabilityVerificationHash,
        grant: candidate.grant,
      },
    });
    return cloneCanonical({
      status: 'shadow_issued',
      authority_status: 'shadow',
      grant: candidate.grant,
      event,
    });
  }

  revokeRoleGrant({ capability, grantId, reason = 'owner_revoked' }) {
    assertActionControlPlaneUnlocked(this, 'role grant revocation');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    const principal = assertCapability(this, capability, now);
    assertCurrentQualification(this, 'role_grant_revoke', now);
    assertCurrentWitnessHead(this);
    if (!isSha256(grantId)) {
      throw new OwnerKernelError('role grant id must be a SHA-256 digest', 'INVALID_ROLE_GRANT');
    }
    const grant = internal.state.role_grants && internal.state.role_grants[grantId.toLowerCase()];
    if (!grant || grant.status !== 'active') {
      throw new OwnerKernelBlockedError('role grant is unknown or already revoked', 'ACTIVE_GRANT_REVOKED');
    }
    const normalizedReason = requireProtocolToken(reason, 'role grant revocation reason');
    return appendInternal(this, {
      type: 'role_grant_revoked',
      emitter: {
        kind: 'kernel',
        identity: 'owner-kernel',
        channel: 'kernel-role-grant-revocation',
      },
      payload: {
        grant_id: grant.grant_id,
        reason: normalizedReason,
        observation_hash: sha256(canonicalJson({
          principal_id: principal.principalId,
          reason: normalizedReason,
          revoked_at: now,
        })),
      },
    });
  }

  assertRoleGrantActive({ grantId, operationContext = {} }) {
    assertActionControlPlaneUnlocked(this, 'role grant operation gate');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    assertCurrentWitnessHead(this);
    if (!isSha256(grantId)) {
      throw new OwnerKernelError('role grant id must be a SHA-256 digest', 'INVALID_ROLE_GRANT');
    }
    const normalizedGrantId = grantId.toLowerCase();
    const record = internal.state.role_grants && internal.state.role_grants[normalizedGrantId];
    if (!record || record.status !== 'active') {
      throw new OwnerKernelBlockedError(
        'the exact witnessed role grant is unknown or revoked',
        'ACTIVE_GRANT_REVOKED',
      );
    }
    if (record.task_authority_id !== internal.state.current_task_authority_id) {
      throw new OwnerKernelBlockedError(
        'the role grant parent is no longer current',
        'ACTIVE_GRANT_REVOKED',
      );
    }
    const context = requirePlainDataObject(operationContext, 'role grant operation context');
    const operationContextHash = sha256(canonicalJson(context));
    const evaluationTime = nowIso(internal.clock);
    const observer = requireAdapter(internal.adapters, 'roleCapabilityObserver');
    const rawObservation = observer({
      run_id: internal.header.run_id,
      policy_hash: internal.header.policy_hash,
      task_authority_id: record.task_authority_id,
      grant_id: record.grant_id,
      dispatch_id: record.dispatch_id,
      role: record.grant.role,
      model_identity: cloneCanonical(record.grant.model_identity),
      operation_context_hash: operationContextHash,
      evaluation_time: evaluationTime,
    });
    const observation = requirePlainDataObject(
      rawObservation,
      'trusted live role capability observation',
    );
    requireOnlyDataKeys(observation, new Set([
      'ok',
      'run_id',
      'task_authority_id',
      'grant_id',
      'operation_context_hash',
      'evaluation_time',
      'capability_state',
      'identity_hash',
      'semantic_fingerprint',
      'containment_fingerprint',
      'critical_miss',
      'probe_regression',
      'identity',
      'channel',
    ]), 'trusted live role capability observation');
    if (observation.ok !== true
      || observation.run_id !== internal.header.run_id
      || observation.task_authority_id !== record.task_authority_id
      || observation.grant_id !== record.grant_id
      || observation.operation_context_hash !== operationContextHash
      || observation.evaluation_time !== evaluationTime
      || typeof observation.identity !== 'string' || observation.identity.length === 0
      || typeof observation.channel !== 'string' || observation.channel.length === 0) {
      throw new OwnerKernelBlockedError(
        'trusted role capability observer did not bind the exact operation and ledger grant',
        'UNVERIFIED_ROLE_CAPABILITY',
      );
    }
    const parent = internal.state.task_authorities[record.task_authority_id];
    try {
      verifyRoleExecutionGrant(record.grant, parent.envelope, {
        expectedGrantId: record.grant_id,
        expectedTaskAuthorityId: record.task_authority_id,
        evaluationTime,
        identityHash: observation.identity_hash,
        semanticFingerprint: observation.semantic_fingerprint,
        containmentFingerprint: observation.containment_fingerprint,
        capabilityState: observation.capability_state,
        criticalMiss: observation.critical_miss,
        probeRegression: observation.probe_regression,
      });
    } catch (error) {
      if (!error || error.code !== 'ACTIVE_GRANT_REVOKED') throw error;
      let reason = 'capability_drift';
      if (/expired/.test(error.message)) reason = 'expired';
      else if (/exact identity/.test(error.message)) reason = 'identity_drift';
      else if (/semantic identity/.test(error.message)) reason = 'semantic_fingerprint_drift';
      else if (/containment/.test(error.message)) reason = 'containment_fingerprint_drift';
      else if (/Critical miss/.test(error.message)) reason = 'critical_miss';
      else if (/probe regression/.test(error.message)) reason = 'probe_regression';
      const event = appendInternal(this, {
        type: 'role_grant_revoked',
        emitter: {
          kind: 'kernel',
          identity: 'owner-kernel',
          channel: `kernel-role-grant-observer:${observation.channel}`,
        },
        payload: {
          grant_id: record.grant_id,
          reason,
          observation_hash: sha256(canonicalJson(observation)),
        },
      });
      throw new OwnerKernelBlockedError(
        `${error.message}; revocation witnessed at ${event.event_hash}`,
        'ACTIVE_GRANT_REVOKED',
      );
    }
    return cloneCanonical({
      status: 'active',
      authority_status: 'shadow',
      grant: record.grant,
      issuance_event_hash: record.issuance_event_hash,
      observation_hash: sha256(canonicalJson(observation)),
    });
  }

  recordTranslation(translationEnvelope) {
    assertActionControlPlaneUnlocked(this, 'translation recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'translationVerifier')(translationEnvelope, { run_id: internal.header.run_id }),
      'translation envelope',
      { runId: internal.header.run_id },
    );
    if (!isSha256(trusted.payload.source) || !isSha256(trusted.payload.target)) {
      throw new OwnerKernelError('translation verifier did not return source and target hashes', 'UNVERIFIED_TRANSLATION');
    }
    const hasTranslationId = Object.prototype.hasOwnProperty.call(trusted.payload, 'translation_id');
    const translationId = hasTranslationId ? trusted.payload.translation_id : nextIdentifier(internal, 'translation');
    if (typeof translationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(translationId)) {
      throw new OwnerKernelError('translation verifier returned an invalid translation_id', 'UNVERIFIED_TRANSLATION');
    }
    const hasInvocationId = Object.prototype.hasOwnProperty.call(trusted.payload, 'invocation_id');
    const invocationId = hasInvocationId ? trusted.payload.invocation_id : null;
    if (hasInvocationId && (typeof invocationId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(invocationId))) {
      throw new OwnerKernelError('translation verifier returned an invalid invocation_id', 'UNVERIFIED_TRANSLATION');
    }
    const hasSourceDetail = Object.prototype.hasOwnProperty.call(trusted.payload, 'source_detail');
    const hasTargetDetail = Object.prototype.hasOwnProperty.call(trusted.payload, 'target_detail');
    if (hasSourceDetail !== hasTargetDetail) {
      throw new OwnerKernelError('translation verifier must return both source_detail and target_detail', 'UNVERIFIED_TRANSLATION');
    }
    const payload = {
      translation_id: translationId,
      ...(hasInvocationId ? { invocation_id: invocationId } : {}),
      source: trusted.payload.source.toLowerCase(),
      target: trusted.payload.target.toLowerCase(),
      ...(hasSourceDetail ? {
        source_detail: cloneCanonical(trusted.payload.source_detail),
        target_detail: cloneCanonical(trusted.payload.target_detail),
      } : {}),
    };
    if (hasSourceDetail && (sha256(canonicalJson(payload.source_detail)) !== payload.source
      || sha256(canonicalJson(payload.target_detail)) !== payload.target)) {
      throw new OwnerKernelError('translation verifier detail hashes do not match source and target', 'UNVERIFIED_TRANSLATION');
    }
    const existing = internal.events.find((event) => event.type === 'translation_used'
      && event.payload.translation_id === translationId);
    if (existing) {
      if (canonicalJson(existing.payload) !== canonicalJson(payload)) {
        throw new OwnerKernelError(
          'translation_id was already witnessed with different source or target',
          'TRANSLATION_REPLAY_CONFLICT',
        );
      }
      return cloneCanonical(existing);
    }
    return appendInternal(this, {
      type: 'translation_used',
      emitter: { kind: 'translation', identity: trusted.identity, channel: trusted.channel },
      payload,
    });
  }

  checkpoint() {
    assertActionControlPlaneUnlocked(this, 'checkpoint');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    assertCurrentQualification(this, 'checkpoint', now);
    if (hasActionAuthority(internal)) {
      assertCurrentWitnessHead(this);
      assertCurrentHostCapability(this, 'checkpoint', now);
    }
    return appendCheckpointInternal(this, 'manual');
  }

  checkBlockedTimeout() {
    assertActionControlPlaneUnlocked(this, 'blocked timeout check');
    return checkTimeout(this);
  }

  startBlockedTimeoutMonitor({
    pollMilliseconds = 60000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    onError = null,
    auto = false,
  } = {}) {
    const internal = INTERNALS.get(this);
    if (internal.policy.max_blocked_duration_seconds === 0) return () => {};
    if (!Number.isInteger(pollMilliseconds) || pollMilliseconds < 1000
      || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
      || (onError !== null && typeof onError !== 'function') || typeof auto !== 'boolean') {
      throw new OwnerKernelError('timeout monitor requires integer pollMilliseconds >= 1000 and timer functions', 'INVALID_TIMEOUT_MONITOR');
    }
    if (internal.timeoutMonitor) {
      if (!internal.timeoutMonitor.auto || auto) return internal.timeoutMonitor.stop;
      internal.timeoutMonitor.stop();
    }
    const tick = () => {
      try {
        checkTimeout(this);
      } catch (error) {
        if (internal.timeoutMonitor) {
          internal.timeoutMonitor.last_error = error && error.message ? error.message : String(error);
        }
        if (onError) onError(error);
      } finally {
        if (INTERNALS.get(this).state.status === 'complete') this.stopBlockedTimeoutMonitor();
      }
    };
    const timer = setIntervalFn(tick, pollMilliseconds);
    if (timer && typeof timer.unref === 'function') timer.unref();
    const stop = () => {
      const current = INTERNALS.get(this).timeoutMonitor;
      if (current) {
        clearIntervalFn(current.timer);
        INTERNALS.get(this).timeoutMonitor = null;
      }
    };
    internal.timeoutMonitor = { timer, stop, auto };
    return stop;
  }

  stopBlockedTimeoutMonitor() {
    const internal = INTERNALS.get(this);
    if (internal.timeoutMonitor) internal.timeoutMonitor.stop();
  }

  getState() {
    checkTimeout(this);
    return stateProjection(INTERNALS.get(this).state);
  }

  getLedger() {
    const internal = INTERNALS.get(this);
    return {
      header: cloneCanonical(internal.header),
      events: internal.events.map((event) => cloneCanonical(event)),
    };
  }

  serializeLedger() {
    return serializeLedger(this.getLedger());
  }

  disclosure() {
    return deriveDisclosure(INTERNALS.get(this).state);
  }
}

module.exports = {
  OwnerKernel,
};
