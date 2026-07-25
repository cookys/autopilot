'use strict';

// Host-resident P3.0 bridge. It is deliberately ledger-only: no action catalog,
// action authority, or v2 acceptance coordinator can enter this runtime.

const { canonicalJson, cloneCanonical } = require('./canonical');
const { OwnerKernelError } = require('./errors');
const { OwnerKernel } = require('./kernel');
const { verifyLedger } = require('./ledger');
const { resolveGovernancePolicy } = require('./policy');
const {
  createShadowTranslationEnvelope,
  deriveTranslationStatus,
  translateLegacyLevel,
  verifyShadowTranslationEnvelope,
} = require('./compatibility');

const SHADOW_TRANSLATION_CONTRACT_ID = 'owner-kernel-shadow-telemetry-v1';
const SHADOW_TRANSLATION_LEVEL = 'l3';
const SHADOW_ALLOWED_EVENT_TYPES = new Set([
  'intent',
  'principal_change',
  'translation_used',
  'checkpoint',
]);
const RUNTIMES = new WeakMap();

function shadowError(message, code = 'SHADOW_TRANSLATION_BLOCKED') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    shadowError(`${label} must be a plain data object`, 'INVALID_SHADOW_TRANSLATION');
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) shadowError(`${label} has unsupported key "${key}"`, 'INVALID_SHADOW_TRANSLATION');
  }
}

function shadowContract(policyHash) {
  return {
    schema_version: 1,
    contract_id: SHADOW_TRANSLATION_CONTRACT_ID,
    legs: [{
      id: 'translation-telemetry',
      kind: 'non_executable',
      artifact_hashes: [policyHash],
    }],
  };
}

function assertShadowPolicy(policy) {
  if (!Array.isArray(policy.action_catalog) || policy.action_catalog.length !== 0) {
    shadowError(
      'shadow translation requires an empty action_catalog; it cannot receive action authority',
      'SHADOW_ACTION_AUTHORITY_FORBIDDEN',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(policy, 'red_lines')
    || !Object.prototype.hasOwnProperty.call(policy, 'assurance_profile')) {
    shadowError(
      'shadow translation requires an explicit P3 red_lines and assurance_profile policy',
      'SHADOW_POLICY_REQUIRED',
    );
  }
}

function assertShadowWitness(witness, { expectedHead } = {}) {
  if (!witness || typeof witness !== 'object'
    || typeof witness.streamId !== 'string' || witness.streamId.length === 0
    || (witness.trustTier !== 'external' && witness.trustTier !== 'test')
    || typeof witness.appendIfHead !== 'function'
    || typeof witness.getHead !== 'function'
    || typeof witness.verify !== 'function') {
    shadowError(
      'shadow translation requires an external/test witness with appendIfHead(), getHead(), and verify()',
      'SHADOW_WITNESS_COMPARE_AND_APPEND_REQUIRED',
    );
  }
  const actualHead = witness.getHead();
  if (actualHead !== expectedHead) {
    shadowError(
      'shadow translation witness head does not match the durable ledger head',
      'SHADOW_WITNESS_HEAD_STALE',
    );
  }
  return witness;
}

function compareAndAppendWitness(witness) {
  return {
    streamId: witness.streamId,
    trustTier: witness.trustTier,
    identity: witness.identity,
    attestation_hash: witness.attestation_hash,
    protocol_version: witness.protocol_version,
    append(request) {
      return witness.appendIfHead({
        ...request,
        expected_witness_head: request.previous_witness_head,
      });
    },
    appendIfHead: witness.appendIfHead.bind(witness),
    getHead: witness.getHead.bind(witness),
    verify: witness.verify.bind(witness),
  };
}

function wrapAdapters(adapters, { policy, policyHash }) {
  const source = assertPlainObject(adapters, 'shadow translation adapters');
  if (typeof source.translationVerifier !== 'function') {
    shadowError('shadow translation requires adapters.translationVerifier()', 'TRUSTED_ADAPTER_REQUIRED');
  }
  const hostTranslationVerifier = source.translationVerifier;
  return {
    ...source,
    translationVerifier(envelope, context) {
      const verified = hostTranslationVerifier(envelope, context);
      if (!verified || typeof verified !== 'object' || verified.ok !== true) return verified;
      const mapping = verifyShadowTranslationEnvelope(envelope, {
        runId: context && context.run_id,
        policy,
        policyHash,
      });
      return {
        ...verified,
        payload: mapping,
      };
    },
  };
}

function assertShadowHeader(header) {
  assertPlainObject(header, 'shadow translation ledger.header');
  for (const field of [
    'authority',
    'authority_hash',
    'acceptance_authority',
    'acceptance_authority_hash',
  ]) {
    if (Object.prototype.hasOwnProperty.call(header, field)) {
      shadowError('shadow translation ledger cannot contain action or acceptance authority', 'SHADOW_AUTHORITY_FORBIDDEN');
    }
  }
  assertShadowPolicy(header.policy);
  if (canonicalJson(header.acceptance_contract) !== canonicalJson(shadowContract(header.policy_hash))) {
    shadowError('ledger does not use the exact shadow translation contract', 'SHADOW_TRANSLATION_LEDGER_REQUIRED');
  }
}

function assertShadowTranslationEvent(event, { runId, policy, policyHash, seenTranslationIds }) {
  const payload = assertPlainObject(event.payload, 'shadow translation event payload');
  assertOnlyKeys(payload, new Set([
    'translation_id',
    'invocation_id',
    'source',
    'target',
    'source_detail',
    'target_detail',
  ]), 'shadow translation event payload');
  for (const field of ['translation_id', 'invocation_id', 'source', 'target', 'source_detail', 'target_detail']) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) {
      shadowError(`shadow translation event payload requires ${field}`, 'SHADOW_TRANSLATION_DETAILS_REQUIRED');
    }
  }
  if (seenTranslationIds.has(payload.translation_id)) {
    shadowError('shadow translation ledger repeats a translation_id', 'SHADOW_TRANSLATION_REPLAY_CONFLICT');
  }
  const source = payload.source_detail;
  const target = payload.target_detail;
  const verified = verifyShadowTranslationEnvelope({
    schema_version: 1,
    run_id: runId,
    invocation_id: payload.invocation_id,
    translation_id: payload.translation_id,
    level: source && source.legacy_level,
    flags: source && source.overrides,
    policy_hash: target && target.policy_hash,
    source: payload.source,
    target: payload.target,
    source_detail: source,
    target_detail: target,
  }, { runId, policy, policyHash });
  if (source.legacy_level !== SHADOW_TRANSLATION_LEVEL) {
    shadowError(
      `shadow translation ledger is limited to ${SHADOW_TRANSLATION_LEVEL} until the live engine bridge exists`,
      'SHADOW_TRANSLATION_LEVEL_BLOCKED',
    );
  }
  if (verified.invocation_id !== payload.invocation_id) {
    shadowError('shadow translation invocation binding is invalid', 'SHADOW_TRANSLATION_REPLAY_CONFLICT');
  }
  seenTranslationIds.add(payload.translation_id);
}

function assertShadowLedger(ledger, witness) {
  const verified = verifyLedger(ledger, { witness, requireWitness: true });
  const { header, policy, state } = verified;
  assertShadowHeader(header);
  if (witness.streamId !== header.witness_stream_id) {
    shadowError(
      'shadow translation witness stream does not match the ledger witness stream',
      'SHADOW_WITNESS_STREAM_MISMATCH',
    );
  }
  const expectedHead = ledger.events.length === 0
    ? null
    : ledger.events[ledger.events.length - 1].witness.witness_head;
  assertShadowWitness(witness, { expectedHead });
  let sawIntent = false;
  let sawPrincipalChange = false;
  const seenTranslationIds = new Set();
  for (const event of ledger.events) {
    if (!SHADOW_ALLOWED_EVENT_TYPES.has(event.type)) {
      shadowError(`shadow translation ledger does not permit ${event.type} events`, 'SHADOW_LEDGER_EVENT_FORBIDDEN');
    }
    if (event.type === 'intent') {
      if (sawIntent || sawPrincipalChange) {
        shadowError('shadow translation ledger permits exactly one initial intent', 'SHADOW_LEDGER_EVENT_FORBIDDEN');
      }
      sawIntent = true;
      continue;
    }
    if (event.type === 'principal_change') {
      if (!sawIntent || sawPrincipalChange) {
        shadowError('shadow translation ledger permits exactly one initial principal_change', 'SHADOW_LEDGER_EVENT_FORBIDDEN');
      }
      sawPrincipalChange = true;
      continue;
    }
    if (event.type === 'checkpoint') {
      if (!sawIntent) {
        shadowError('shadow translation checkpoint cannot precede initial intent', 'SHADOW_LEDGER_EVENT_FORBIDDEN');
      }
      continue;
    }
    if (!sawPrincipalChange) {
      shadowError('shadow translation cannot precede initial owner activation', 'SHADOW_LEDGER_EVENT_FORBIDDEN');
    }
    assertShadowTranslationEvent(event, {
      runId: header.run_id,
      policy,
      policyHash: header.policy_hash,
      seenTranslationIds,
    });
  }
  if (!sawIntent || !sawPrincipalChange || state.status !== 'decide'
    || !state.active_principal || !state.current_intent_id) {
    shadowError('shadow translation ledger has an invalid lifecycle state', 'SHADOW_LEDGER_STATE_INVALID');
  }
  return verified;
}

function witnessAssurance(witness) {
  return witness.trustTier === 'external'
    ? 'external_receipt_not_eligible_for_alias_retirement'
    : 'test_only_not_eligible_for_alias_retirement';
}

function resultFor(event, translation, idempotent, witness) {
  return cloneCanonical({
    status: 'shadow_recorded',
    idempotent,
    translation,
    event,
    witness_receipt: event.witness,
    legacy_execution_authority: 'unchanged',
    owner_kernel_authority: 'shadow',
    acceptance: 'not_available',
    witness_assurance: witnessAssurance(witness),
    alias_retirement_eligible: false,
  });
}

function matchingTranslationEvent(events, payload) {
  const existing = events.find((event) => event.type === 'translation_used'
    && event.payload && event.payload.translation_id === payload.translation_id);
  if (!existing) return null;
  const expected = {
    translation_id: payload.translation_id,
    invocation_id: payload.invocation_id,
    source: payload.source,
    target: payload.target,
    source_detail: payload.source_detail,
    target_detail: payload.target_detail,
  };
  const actual = {
    translation_id: existing.payload.translation_id,
    ...(Object.prototype.hasOwnProperty.call(existing.payload, 'invocation_id')
      ? { invocation_id: existing.payload.invocation_id }
      : {}),
    source: existing.payload.source,
    target: existing.payload.target,
    ...(Object.prototype.hasOwnProperty.call(existing.payload, 'source_detail')
      ? { source_detail: existing.payload.source_detail }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(existing.payload, 'target_detail')
      ? { target_detail: existing.payload.target_detail }
      : {}),
  };
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    shadowError(
      'a witnessed translation ID already exists with different frozen source or target',
      'SHADOW_TRANSLATION_REPLAY_CONFLICT',
    );
  }
  return existing;
}

class ShadowTranslationRuntime {
  static start({
    runId,
    governanceConfig,
    modeOverride,
    initialIntentEnvelope,
    initialOwnerId,
    witness,
    adapters,
    clock,
    allowTestWitness = false,
    nonceFactory,
    actionAuthority,
    acceptanceAuthority,
  } = {}) {
    if (actionAuthority !== undefined || acceptanceAuthority !== undefined) {
      shadowError(
        'shadow translation never accepts actionAuthority or acceptanceAuthority',
        'SHADOW_AUTHORITY_FORBIDDEN',
      );
    }
    assertShadowWitness(witness, { expectedHead: null });
    const resolved = resolveGovernancePolicy(governanceConfig, { modeOverride });
    assertShadowPolicy(resolved.policy);
    const protectedWitness = compareAndAppendWitness(witness);
    const started = OwnerKernel.start({
      runId,
      governanceConfig,
      modeOverride,
      acceptanceContract: shadowContract(resolved.policy_hash),
      initialIntentEnvelope,
      initialOwnerId,
      witness: protectedWitness,
      adapters: wrapAdapters(adapters, {
        policy: resolved.policy,
        policyHash: resolved.policy_hash,
      }),
      clock,
      allowTestWitness,
      nonceFactory,
    });
    const verified = assertShadowLedger(started.kernel.getLedger(), witness);
    const runtime = new ShadowTranslationRuntime();
    RUNTIMES.set(runtime, {
      kernel: started.kernel,
      witness,
      run_id: verified.header.run_id,
      policy: verified.policy,
      policy_hash: verified.header.policy_hash,
    });
    return {
      runtime,
      run_id: runId,
      policy_hash: resolved.policy_hash,
      owner_kernel_authority: 'shadow',
      acceptance: 'not_available',
      witness_assurance: witnessAssurance(witness),
      alias_retirement_eligible: false,
    };
  }

  static resume({
    ledger,
    witness,
    adapters,
    clock,
    allowTestWitness = false,
    nonceFactory,
    actionAuthority,
    acceptanceAuthority,
  } = {}) {
    if (actionAuthority !== undefined || acceptanceAuthority !== undefined) {
      shadowError(
        'shadow translation never accepts actionAuthority or acceptanceAuthority',
        'SHADOW_AUTHORITY_FORBIDDEN',
      );
    }
    assertPlainObject(ledger, 'shadow translation ledger');
    assertPlainObject(ledger.header, 'shadow translation ledger.header');
    const verified = assertShadowLedger(ledger, witness);
    const header = verified.header;
    const expectedHead = ledger.events.length === 0
      ? null
      : ledger.events[ledger.events.length - 1].witness.witness_head;
    assertShadowWitness(witness, { expectedHead });
    const protectedWitness = compareAndAppendWitness(witness);
    const resumed = OwnerKernel.resume({
      ledger,
      witness: protectedWitness,
      adapters: wrapAdapters(adapters, {
        policy: header.policy,
        policyHash: header.policy_hash,
      }),
      clock,
      allowTestWitness,
      nonceFactory,
    });
    assertShadowLedger(resumed.kernel.getLedger(), witness);
    const runtime = new ShadowTranslationRuntime();
    RUNTIMES.set(runtime, {
      kernel: resumed.kernel,
      witness,
      run_id: header.run_id,
      policy: header.policy,
      policy_hash: header.policy_hash,
    });
    return {
      runtime,
      run_id: header.run_id,
      policy_hash: header.policy_hash,
      owner_kernel_authority: 'shadow',
      acceptance: 'not_available',
      witness_assurance: witnessAssurance(witness),
      alias_retirement_eligible: false,
    };
  }

  recordLevelTranslation({ level, invocationId, flags = {} } = {}) {
    const internal = RUNTIMES.get(this);
    if (!internal) shadowError('shadow translation runtime is not initialized', 'SHADOW_TRANSLATION_RUNTIME_REQUIRED');
    const ledger = internal.kernel.getLedger();
    assertShadowLedger(ledger, internal.witness);
    if (level !== SHADOW_TRANSLATION_LEVEL) {
      shadowError(
        `shadow translation is limited to ${SHADOW_TRANSLATION_LEVEL} until the live engine bridge exists`,
        'SHADOW_TRANSLATION_LEVEL_BLOCKED',
      );
    }
    const translation = translateLegacyLevel({
      level,
      flags,
      policy: internal.policy,
      policyHash: internal.policy_hash,
    });
    const envelope = createShadowTranslationEnvelope({
      runId: internal.run_id,
      invocationId,
      translation,
    });
    const existing = matchingTranslationEvent(ledger.events, envelope);
    if (existing) {
      assertShadowLedger(ledger, internal.witness);
      return resultFor(existing, translation, true, internal.witness);
    }
    const event = internal.kernel.recordTranslation(envelope);
    assertShadowLedger(internal.kernel.getLedger(), internal.witness);
    return resultFor(event, translation, false, internal.witness);
  }

  status() {
    const internal = RUNTIMES.get(this);
    if (!internal) shadowError('shadow translation runtime is not initialized', 'SHADOW_TRANSLATION_RUNTIME_REQUIRED');
    const ledger = internal.kernel.getLedger();
    assertShadowLedger(ledger, internal.witness);
    return cloneCanonical({
      status: 'shadow',
      run_id: internal.run_id,
      policy_hash: internal.policy_hash,
      translations: deriveTranslationStatus(ledger.events),
      owner_kernel_authority: 'shadow',
      acceptance: 'not_available',
      witness_assurance: witnessAssurance(internal.witness),
      alias_retirement_eligible: false,
    });
  }

  serializeLedger() {
    const internal = RUNTIMES.get(this);
    if (!internal) shadowError('shadow translation runtime is not initialized', 'SHADOW_TRANSLATION_RUNTIME_REQUIRED');
    assertShadowLedger(internal.kernel.getLedger(), internal.witness);
    return internal.kernel.serializeLedger();
  }
}

module.exports = {
  SHADOW_TRANSLATION_CONTRACT_ID,
  SHADOW_TRANSLATION_LEVEL,
  ShadowTranslationRuntime,
  shadowContract,
};
