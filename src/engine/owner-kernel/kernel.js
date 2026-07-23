'use strict';

const crypto = require('crypto');

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
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
const {
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

function assertActionControlPlaneUnlocked(kernel, operation) {
  const internal = INTERNALS.get(kernel);
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
      requireCompareAndAppend: Boolean(header.authority),
      appending: false,
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
    nonceFactory,
  }) {
    assertWitnessAdapter(witness, { allowTestWitness });
    requireAdapter(adapters, 'userInputVerifier');
    requireAdapter(adapters, 'ownerTurnVerifier');
    requireAdapter(adapters, 'principalResolver');
    requireAdapter(adapters, 'qualificationVerifier');
    const resolvedPolicy = resolveGovernancePolicy(governanceConfig, { modeOverride });
    const frozenContract = freezeAcceptanceContract(acceptanceContract);
    const nonce = typeof nonceFactory === 'function'
      ? nonceFactory()
      : crypto.randomBytes(32).toString('hex');
    if (typeof nonce !== 'string' || nonce.length < 32) {
      throw new OwnerKernelError('nonceFactory must return a high-entropy string', 'INVALID_CAPABILITY_NONCE');
    }
    const createdAt = nowIso(clock);
    let normalizedActionAuthority = null;
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
    nonceFactory,
  }) {
    assertWitnessAdapter(witness, { allowTestWitness });
    requireAdapter(adapters, 'userInputVerifier');
    requireAdapter(adapters, 'ownerTurnVerifier');
    requireAdapter(adapters, 'principalResolver');
    requireAdapter(adapters, 'qualificationVerifier');
    const verified = verifyLedger(ledger, { witness, requireWitness: true });
    const resumedReplay = replayFromLatestCheckpoint(ledger, verified);
    if (verified.header.authority
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
    if (verified.header.authority) {
      assertWitnessAdapter(witness, {
        allowTestWitness,
        requireCompareAndAppend: true,
        requireBinding: true,
      });
      if (sha256(canonicalJson(normalizeWitnessBinding(witness)))
        !== verified.header.authority.witness_binding_hash) {
        throw new OwnerKernelBlockedError(
          'resumed witness does not exactly match the intake-frozen authority binding',
          'WITNESS_BINDING_MISMATCH',
        );
      }
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
    });
    if (verified.header.authority) assertCurrentWitnessHead(timeoutKernel);
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
    });
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
        throw new OwnerKernelBlockedError(
          'this frozen catalog action requires challenge evidence before execution',
          'ACTION_CHALLENGE_REQUIRED',
        );
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
        },
        skipAutomaticCheckpoint: true,
      });
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
    if (hasActionAuthority(internal) && internal.actionLock) {
      if (!internal.activeAction || !internal.activeAction.abortController) {
        throw new OwnerKernelBlockedError('the in-flight host action cannot be cancelled safely', 'ACTION_ABORT_UNAVAILABLE');
      }
      if (internal.activeAction.phase === 'claim_committing') {
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
        return cloneCanonical({
          cancellation_requested: false,
          claim_id: internal.activeAction.claim_id,
          outcome_commit_in_progress: true,
        });
      }
      if (internal.activeAction.phase === 'post_claim_authorizing') {
        requestActionAbort(internal.activeAction, 'user_abort_requested', trusted.envelope_hash);
        return cloneCanonical({
          cancellation_requested: true,
          claim_id: internal.activeAction.claim_id,
          postclaim_authorization_pending: true,
        });
      }
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

  recordTranslation(translationEnvelope) {
    assertActionControlPlaneUnlocked(this, 'translation recording');
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'translationVerifier')(translationEnvelope, { run_id: internal.header.run_id }),
      'translation envelope',
      { runId: internal.header.run_id },
    );
    return appendInternal(this, {
      type: 'translation_used',
      emitter: { kind: 'translation', identity: trusted.identity, channel: trusted.channel },
      payload: {
        translation_id: nextIdentifier(internal, 'translation'),
        source: trusted.payload.source,
        target: trusted.payload.target,
      },
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
