'use strict';

const crypto = require('crypto');

const { canonicalJson, cloneCanonical, isSha256, sha256 } = require('./canonical');
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
  stateProjection,
} = require('./state');
const { assertWitnessAdapter, verifyReceiptShape } = require('./witness');

const INTERNALS = new WeakMap();
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
      payload,
      prevEventHash: internal.state.event_head,
    });

    // Validate the state transition before consuming an external witness sequence.
    applyEvent(internal.state, {
      ...provisional,
      witness: { witness_head: internal.state.witness_head },
    }, internal.policy);

    const receipt = internal.witness.append({
      run_id: internal.header.run_id,
      stream_id: internal.witness.streamId,
      sequence: provisional.sequence,
      event_hash: provisional.event_hash,
      previous_witness_head: internal.state.witness_head,
      type,
    });
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

class OwnerKernel {
  constructor({ header, policy, contract, state, events, witness, adapters, clock, capabilityNonce }) {
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
      appending: false,
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
    const header = createLedgerHeader({
      runId,
      policy: resolvedPolicy.policy,
      policyHash: resolvedPolicy.policy_hash,
      contract: frozenContract.contract,
      contractHash: frozenContract.contract_hash,
      witnessStreamId: witness.streamId,
      capabilityNonceCommitment: sha256(nonce),
      createdAt,
    });
    const kernel = new OwnerKernel({
      header,
      policy: resolvedPolicy.policy,
      contract: frozenContract.contract,
      state: {
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
      },
      events: [],
      witness,
      adapters,
      clock,
      capabilityNonce: nonce,
    });
    kernel.captureIntent(initialIntentEnvelope);
    return {
      kernel,
      owner_capability: kernel.activateOwner(initialOwnerId, 'initial_intake'),
    };
  }

  static resume({ ledger, witness, adapters, clock, allowTestWitness = false, nonceFactory }) {
    assertWitnessAdapter(witness, { allowTestWitness });
    requireAdapter(adapters, 'userInputVerifier');
    requireAdapter(adapters, 'ownerTurnVerifier');
    requireAdapter(adapters, 'principalResolver');
    requireAdapter(adapters, 'qualificationVerifier');
    const verified = verifyLedger(ledger, { witness, requireWitness: true });
    const resumedReplay = replayFromLatestCheckpoint(ledger, verified);
    const nonce = typeof nonceFactory === 'function'
      ? nonceFactory()
      : crypto.randomBytes(32).toString('hex');
    if (typeof nonce !== 'string' || nonce.length < 32) {
      throw new OwnerKernelError('nonceFactory must return a high-entropy string', 'INVALID_CAPABILITY_NONCE');
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
    });
    let ownerCapability = null;
    if (verified.state.active_principal && verified.state.status !== 'complete') {
      const now = nowIso(clock);
      const principal = assertCurrentQualification(kernel, 'resume', now);
      ownerCapability = makeCapability(kernel, principal, now);
    }
    return { kernel, owner_capability: ownerCapability };
  }

  captureIntent(envelope) {
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
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    const capabilityRecord = assertCapability(this, capability, now);
    const principal = assertCurrentQualification(this, 'decision', now);
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
    const rule = internal.policy.approval_policy[actionClass];
    if (!rule) throw new OwnerKernelError('decision action_class is outside the frozen policy', 'UNKNOWN_ACTION_CLASS');
    const decisionId = nextIdentifier(internal, 'decision');
    const actionDescriptorHash = sha256(canonicalJson(actionDescriptor));
    const decisionPayload = {
      decision_id: decisionId,
      intent_id: internal.state.current_intent_id,
      principal_id: principal.identity,
      owner_turn_hash: trustedTurn.envelope_hash,
      action_class: actionClass,
      action_descriptor: cloneCanonical(actionDescriptor),
      action_descriptor_hash: actionDescriptorHash,
      requested_max_uses: maxUses,
      requires_approval: rule.requires_approval,
    };
    decisionPayload.decision_content_hash = sha256(canonicalJson(decisionContent(decisionPayload)));
    decisionPayload.intent_relation = internal.state.intents[decisionPayload.intent_id]
      .explicit_action_hashes.includes(actionDescriptorHash)
      ? 'explicit'
      : 'derived';
    return appendInternal(this, {
      type: 'decision',
      emitter: { kind: 'owner', identity: principal.identity, channel: trustedTurn.channel },
      payload: decisionPayload,
    });
  }

  submitApproval(envelope) {
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
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const trusted = requireVerifiedEnvelope(
      requireAdapter(internal.adapters, 'userInputVerifier')(envelope, 'abort', { run_id: internal.header.run_id }),
      'user abort envelope',
      { expectedKind: 'abort', runId: internal.header.run_id },
    );
    return appendInternal(this, {
      type: 'abort',
      emitter: { kind: 'user', identity: trusted.identity, channel: trusted.channel },
      payload: { reason: trusted.payload.reason },
      skipAutomaticCheckpoint: true,
    });
  }

  recordEvidence(request) {
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
    beforeOperation(this);
    const internal = INTERNALS.get(this);
    const now = nowIso(internal.clock);
    assertCurrentQualification(this, 'checkpoint', now);
    return appendCheckpointInternal(this, 'manual');
  }

  checkBlockedTimeout() {
    return checkTimeout(this);
  }

  startBlockedTimeoutMonitor({
    pollMilliseconds = 60000,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    onError = null,
  } = {}) {
    const internal = INTERNALS.get(this);
    if (internal.policy.max_blocked_duration_seconds === 0) return () => {};
    if (!Number.isInteger(pollMilliseconds) || pollMilliseconds < 1000
      || typeof setIntervalFn !== 'function' || typeof clearIntervalFn !== 'function'
      || (onError !== null && typeof onError !== 'function')) {
      throw new OwnerKernelError('timeout monitor requires integer pollMilliseconds >= 1000 and timer functions', 'INVALID_TIMEOUT_MONITOR');
    }
    if (internal.timeoutMonitor) return internal.timeoutMonitor.stop;
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
    const stop = () => {
      const current = INTERNALS.get(this).timeoutMonitor;
      if (current) {
        clearIntervalFn(current.timer);
        INTERNALS.get(this).timeoutMonitor = null;
      }
    };
    internal.timeoutMonitor = { timer, stop };
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
