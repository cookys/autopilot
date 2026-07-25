'use strict';

const crypto = require('crypto');

const {
  OwnerKernel,
  OwnerKernelBlockedError,
  OwnerKernelError,
  canonicalJson,
  cloneCanonical,
  freezeAcceptanceContract,
  normalizeSemanticRoute,
  resolveGovernancePolicy,
  sha256,
} = require('./owner-kernel');
const {
  DURABLE_STATE_SCHEMA_VERSION,
  normalizeDurableBinding,
  normalizeDurableWitnessResult,
} = require('./supervised-production-substrate-durable-contract');

const SEMANTIC_WITNESS_TRANSPORT_SCHEMA_VERSION = 1;
const SEMANTIC_ROUTE_KIND = 'p37_semantic_witness_route';
const SEMANTIC_RESULT_KIND = 'p37_semantic_witness_transport_result';
const SEMANTIC_ANCHOR_KIND = 'p37_semantic_receipt_anchor_proof';

const HANDOFF_KEYS = new Set([
  'schema_version',
  'kind',
  'handoff_id',
  'p35_install_binding_hash',
  'session_id',
  'session_challenge_hash',
  'intake_protocol_version',
  'ticket_hash',
  'descriptor_binding_hash',
  'workspace_root_hash',
  'immutable_base',
  'issuer',
  'key_id',
  'attestation_hash',
  'gateway_receipt_hash',
  'bridge_plan_hash',
  'bridge_receipt_hash',
  'authenticated_receipt_hash',
  'issued_at_ms',
  'expires_at_ms',
  'handoff_hash',
]);

const CLAIM_KEYS = new Set([
  'schema_version',
  'kind',
  'handoff_id',
  'handoff_hash',
  'claimed_at_ms',
  'p36_install_binding_hash',
  'p36_run_binding_hash',
  'durable_binding_hash',
  'cohort_id',
  'generation',
  'claim_hash',
]);

const RUN_BINDING_KEYS = new Set([
  'schema_version',
  'kind',
  'p36_install_binding_hash',
  'p35_handoff_hash',
  'p35_install_binding_hash',
  'bridge_plan_hash',
  'cohort_id',
  'generation',
  'services',
]);

const SUBSTRATE_PLAN_KEYS = new Set([
  'schema_version',
  'kind',
  'status',
  'intake_protocol_version',
  'owner_kernel_authority',
  'effect_authority',
  'broker_authority',
  'acceptance',
  'intake',
  'service_bindings',
  'service_binding_hash',
  'substrate_abi_hash',
  'witness_operations',
  'coordinator_operations',
  'broker_operations',
  'substrate_plan_hash',
]);

function semanticError(message, code = 'INVALID_SEMANTIC_WITNESS_ROUTE') {
  throw new OwnerKernelError(message, code);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    semanticError(`${label} must be a plain object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) semanticError(`${label} has unsupported key "${key}"`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) semanticError(`${label} is missing ${key}`);
  }
  return value;
}

function requireToken(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    semanticError(`${label} is invalid`);
  }
  return value;
}

function requireHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    semanticError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function requireSafeInteger(value, label, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    semanticError(`${label} is invalid`);
  }
  return value;
}

function without(value, key) {
  const copy = cloneCanonical(value);
  delete copy[key];
  return copy;
}

function normalizeHandoff(raw) {
  const value = assertExactKeys(raw, HANDOFF_KEYS, 'P3.5d handoff');
  if (value.schema_version !== 1 || value.kind !== 'p36_root_verified_intake_handoff'
    || value.intake_protocol_version !== 2) {
    semanticError('P3.5d handoff has an unsupported schema, kind, or intake protocol');
  }
  if (typeof value.immutable_base !== 'string' || !/^[0-9a-f]{40,64}$/.test(value.immutable_base)) {
    semanticError('P3.5d handoff immutable_base is invalid');
  }
  for (const field of [
    'p35_install_binding_hash',
    'session_challenge_hash',
    'ticket_hash',
    'descriptor_binding_hash',
    'workspace_root_hash',
    'attestation_hash',
    'gateway_receipt_hash',
    'bridge_plan_hash',
    'bridge_receipt_hash',
    'authenticated_receipt_hash',
    'handoff_hash',
  ]) requireHash(value[field], `P3.5d handoff ${field}`);
  for (const field of ['handoff_id', 'session_id', 'issuer', 'key_id']) {
    requireToken(value[field], `P3.5d handoff ${field}`);
  }
  requireSafeInteger(value.issued_at_ms, 'P3.5d handoff issued_at_ms');
  requireSafeInteger(value.expires_at_ms, 'P3.5d handoff expires_at_ms', { positive: true });
  if (value.expires_at_ms <= value.issued_at_ms || value.expires_at_ms - value.issued_at_ms > 60000) {
    semanticError('P3.5d handoff lifetime is invalid');
  }
  if (sha256(canonicalJson(without(value, 'handoff_hash'))) !== value.handoff_hash) {
    semanticError('P3.5d handoff hash does not match its canonical material');
  }
  return cloneCanonical(value);
}

function normalizeRunBinding(raw) {
  const value = assertExactKeys(raw, RUN_BINDING_KEYS, 'P3.6 run binding');
  if (value.schema_version !== 1 || value.kind !== 'p36_durable_run_binding') {
    semanticError('P3.6 run binding schema or kind is invalid');
  }
  for (const field of [
    'p36_install_binding_hash',
    'p35_handoff_hash',
    'p35_install_binding_hash',
    'bridge_plan_hash',
  ]) requireHash(value[field], `P3.6 run binding ${field}`);
  requireToken(value.cohort_id, 'P3.6 run binding cohort_id');
  requireSafeInteger(value.generation, 'P3.6 run binding generation', { positive: true });
  if (!Array.isArray(value.services) || value.services.length !== 5) {
    semanticError('P3.6 run binding must contain the five fixed services');
  }
  const roles = new Set();
  const services = value.services.map((rawService) => {
    const service = assertExactKeys(rawService, new Set([
      'role',
      'identity',
      'uid',
      'gid',
      'attestation_hash',
      'unit',
      'cgroup_path',
    ]), 'P3.6 run service');
    const role = requireToken(service.role, 'P3.6 run service role');
    if (roles.has(role)) semanticError('P3.6 run binding repeats a service role');
    roles.add(role);
    requireToken(service.identity, `P3.6 ${role} identity`);
    requireSafeInteger(service.uid, `P3.6 ${role} uid`, { positive: true });
    requireSafeInteger(service.gid, `P3.6 ${role} gid`, { positive: true });
    requireHash(service.attestation_hash, `P3.6 ${role} attestation_hash`);
    requireToken(service.unit, `P3.6 ${role} unit`);
    if (typeof service.cgroup_path !== 'string' || !service.cgroup_path.startsWith('/')) {
      semanticError(`P3.6 ${role} cgroup_path is invalid`);
    }
    return cloneCanonical(service);
  });
  const expectedRoles = ['broker', 'coordinator', 'receipt_verifier', 'witness', 'worker'];
  if (canonicalJson([...roles].sort()) !== canonicalJson(expectedRoles)) {
    semanticError('P3.6 run binding service topology is invalid');
  }
  return cloneCanonical({ ...value, services });
}

function normalizeClaim(raw) {
  const value = assertExactKeys(raw, CLAIM_KEYS, 'P3.5d handoff claim');
  if (value.schema_version !== 1 || value.kind !== 'p36_root_verified_intake_handoff_claim') {
    semanticError('P3.5d handoff claim schema or kind is invalid');
  }
  for (const field of [
    'handoff_hash',
    'p36_install_binding_hash',
    'p36_run_binding_hash',
    'durable_binding_hash',
    'claim_hash',
  ]) requireHash(value[field], `P3.5d handoff claim ${field}`);
  requireToken(value.handoff_id, 'P3.5d handoff claim handoff_id');
  requireToken(value.cohort_id, 'P3.5d handoff claim cohort_id');
  requireSafeInteger(value.claimed_at_ms, 'P3.5d handoff claim claimed_at_ms');
  requireSafeInteger(value.generation, 'P3.5d handoff claim generation', { positive: true });
  if (sha256(canonicalJson(without(value, 'claim_hash'))) !== value.claim_hash) {
    semanticError('P3.5d handoff claim hash does not match its canonical material');
  }
  return cloneCanonical(value);
}

function normalizeSubstratePlan(raw) {
  const value = assertExactKeys(raw, SUBSTRATE_PLAN_KEYS, 'P3.6 substrate plan');
  if (value.schema_version !== 1 || value.kind !== 'p36_effect_disabled_substrate'
    || value.status !== 'effects_disabled'
    || value.intake_protocol_version !== 2
    || value.owner_kernel_authority !== 'none'
    || value.effect_authority !== 'none'
    || value.broker_authority !== 'disabled'
    || value.acceptance !== 'not_available') {
    semanticError('P3.6 substrate plan has an invalid frozen authority disclosure');
  }
  requireHash(value.service_binding_hash, 'P3.6 service binding hash');
  if (sha256(canonicalJson(value.service_bindings)) !== value.service_binding_hash) {
    semanticError('P3.6 service binding hash does not match its canonical material');
  }
  requireHash(value.substrate_plan_hash, 'P3.6 substrate plan hash');
  if (sha256(canonicalJson(without(value, 'substrate_plan_hash'))) !== value.substrate_plan_hash) {
    semanticError('P3.6 substrate plan hash does not match its canonical material');
  }
  return cloneCanonical(value);
}

function assertSourceAgreement({
  handoff,
  claim,
  runBinding,
  durableBinding,
  substratePlan,
  governanceConfig,
  modeOverride,
  acceptanceContract,
}) {
  const resolvedPolicy = resolveGovernancePolicy(governanceConfig, { modeOverride });
  const frozenContract = freezeAcceptanceContract(acceptanceContract);
  const intake = assertPlainObject(substratePlan.intake, 'P3.6 substrate intake');
  const trusted = assertPlainObject(intake.trusted_intake_binding, 'P3.6 trusted intake binding');
  const runBindingHash = sha256(canonicalJson(runBinding));
  const durableBindingHash = sha256(canonicalJson(durableBinding));

  if (claim.handoff_id !== handoff.handoff_id || claim.handoff_hash !== handoff.handoff_hash
    || claim.p36_run_binding_hash !== runBindingHash
    || claim.durable_binding_hash !== durableBindingHash
    || claim.p36_install_binding_hash !== runBinding.p36_install_binding_hash
    || claim.p36_install_binding_hash !== durableBinding.install_binding_hash
    || claim.cohort_id !== durableBinding.cohort_id || claim.generation !== durableBinding.generation) {
    semanticError('exclusive handoff claim does not bind the supplied P3.6 cohort');
  }
  if (claim.claimed_at_ms < handoff.issued_at_ms || claim.claimed_at_ms > handoff.expires_at_ms) {
    semanticError('exclusive handoff claim is outside the verified handoff lifetime');
  }
  if (runBinding.p35_handoff_hash !== handoff.handoff_hash
    || runBinding.p35_install_binding_hash !== handoff.p35_install_binding_hash
    || runBinding.bridge_plan_hash !== handoff.bridge_plan_hash
    || runBinding.cohort_id !== durableBinding.cohort_id
    || runBinding.generation !== durableBinding.generation
    || durableBinding.run_binding_hash !== runBindingHash
    || durableBinding.substrate_plan_hash !== handoff.bridge_plan_hash
    || durableBinding.substrate_abi_hash !== substratePlan.substrate_abi_hash
    || handoff.bridge_plan_hash !== substratePlan.intake.bridge_plan_hash) {
    semanticError('P3.5d, P3.6 run, durable, and substrate bindings disagree');
  }
  if (canonicalJson(substratePlan.service_bindings)
    !== canonicalJson(durableBinding.service_bindings)) {
    semanticError('P3.6 substrate plan service bindings do not match the durable cohort');
  }
  if (trusted.policy_hash !== resolvedPolicy.policy_hash
    || trusted.contract_hash !== frozenContract.contract_hash
    || trusted.workspace_ticket_hash !== handoff.ticket_hash
    || trusted.workspace_descriptor_binding_hash !== handoff.descriptor_binding_hash
    || trusted.workspace_root_hash !== handoff.workspace_root_hash
    || trusted.immutable_base !== handoff.immutable_base
    || intake.install_binding_hash !== handoff.p35_install_binding_hash
    || intake.session_id !== handoff.session_id
    || intake.session_challenge_hash !== handoff.session_challenge_hash
    || intake.issuer !== handoff.issuer
    || intake.key_id !== handoff.key_id
    || intake.attestation_hash !== handoff.attestation_hash
    || intake.envelope_hash !== handoff.gateway_receipt_hash
    || intake.bridge_plan_hash !== handoff.bridge_plan_hash
    || intake.bridge_receipt_hash !== handoff.bridge_receipt_hash
    || intake.authenticated_receipt_hash !== handoff.authenticated_receipt_hash) {
    semanticError('governance or authenticated intake material disagrees with the claimed handoff');
  }
  if (trusted.owner_run_id !== trusted.engine_run_id) {
    semanticError('semantic activation requires one bound owner/engine run id');
  }

  const runByRole = Object.fromEntries(runBinding.services.map((service) => [service.role, service]));
  for (const [role, service] of Object.entries(durableBinding.service_bindings)) {
    const runtime = runByRole[role];
    if (!runtime || runtime.identity !== service.identity || runtime.uid !== service.uid
      || runtime.gid !== service.gid || runtime.attestation_hash !== service.attestation_hash
      || sha256(runtime.cgroup_path) !== service.cgroup_binding_hash) {
      semanticError(`P3.6 ${role} runtime does not match its durable service binding`);
    }
  }
  return { resolvedPolicy, frozenContract, trusted, runBindingHash };
}

function compileSemanticWitnessRoute(options = {}) {
  const input = assertPlainObject(options, 'compileSemanticWitnessRoute options');
  const handoff = normalizeHandoff(input.verifiedHandoff);
  const claim = normalizeClaim(input.handoffClaim);
  const runBinding = normalizeRunBinding(input.runBinding);
  const durableBinding = normalizeDurableBinding(input.durableBinding);
  const substratePlan = normalizeSubstratePlan(input.substratePlan);
  const agreed = assertSourceAgreement({
    handoff,
    claim,
    runBinding,
    durableBinding,
    substratePlan,
    governanceConfig: input.governanceConfig,
    modeOverride: input.modeOverride,
    acceptanceContract: input.acceptanceContract,
  });
  const route = {
    schema_version: 1,
    kind: SEMANTIC_ROUTE_KIND,
    route_version: 1,
    run_id: requireToken(agreed.trusted.owner_run_id, 'semantic route run_id'),
    invocation_id: requireToken(agreed.trusted.invocation_id, 'semantic route invocation_id'),
    handoff_id: handoff.handoff_id,
    handoff_hash: handoff.handoff_hash,
    handoff_issued_at_ms: handoff.issued_at_ms,
    handoff_expires_at_ms: handoff.expires_at_ms,
    handoff_claimed_at_ms: claim.claimed_at_ms,
    descriptor_binding_hash: handoff.descriptor_binding_hash,
    workspace_ticket_hash: handoff.ticket_hash,
    workspace_root_hash: handoff.workspace_root_hash,
    immutable_base: handoff.immutable_base,
    policy_hash: agreed.resolvedPolicy.policy_hash,
    contract_hash: agreed.frozenContract.contract_hash,
    p36_install_binding_hash: durableBinding.install_binding_hash,
    p36_run_binding_hash: agreed.runBindingHash,
    p36_contract_plan_hash: substratePlan.substrate_plan_hash,
    substrate_plan_hash: durableBinding.substrate_plan_hash,
    durable_abi_hash: durableBinding.durable_abi_hash,
    cohort_id: durableBinding.cohort_id,
    generation: durableBinding.generation,
    kernel_binding: input.kernelBinding,
    worker_binding: durableBinding.service_bindings.worker,
    broker_binding: durableBinding.service_bindings.broker,
    receipt_verifier_binding: durableBinding.service_bindings.receipt_verifier,
    witness_binding: durableBinding.service_bindings.witness,
    coordinator_binding: durableBinding.service_bindings.coordinator,
    owner_kernel_authority: 'semantic_only',
    effect_authority: 'none',
    broker_authority: 'disabled',
    acceptance: 'not_available',
  };
  return Object.freeze(normalizeSemanticRoute(route));
}

function assertSemanticRouteFresh(rawRoute, clock) {
  const route = normalizeSemanticRoute(rawRoute);
  const rawNow = typeof clock === 'function' ? clock() : new Date();
  const now = rawNow instanceof Date ? rawNow : new Date(rawNow);
  if (Number.isNaN(now.getTime())) {
    semanticError('semantic activation clock returned an invalid timestamp');
  }
  if (now.getTime() + 1000 < route.handoff_claimed_at_ms
    || now.getTime() > route.handoff_expires_at_ms) {
    throw new OwnerKernelBlockedError(
      'a new semantic authority session requires a fresh exclusively claimed handoff',
      'SEMANTIC_ACTIVATION_EXPIRED',
    );
  }
  return true;
}

function semanticEventPayloadHash(routeHash, request) {
  return sha256(canonicalJson({
    route_hash: routeHash,
    run_id: request.run_id,
    stream_id: request.stream_id,
    sequence: request.sequence,
    event_hash: request.event_hash,
    previous_witness_head: request.previous_witness_head,
  }));
}

function semanticBatchEventPayloadHash(routeHash, request, event, index) {
  return sha256(canonicalJson({
    route_hash: routeHash,
    run_id: request.run_id,
    stream_id: request.stream_id,
    batch_id: request.batch_id,
    batch_commitment: request.batch_commitment,
    batch_index: index,
    batch_size: request.events.length,
    sequence: event.sequence,
    event_hash: event.event_hash,
  }));
}

function normalizeAnchorProof(raw, { routeHash, durableResult }) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'route_hash',
    'request_hash',
    'witness_result_hash',
    'anchor_record_hash',
    'verified',
    'proof_hash',
  ]), 'semantic receipt anchor proof');
  if (value.schema_version !== 1 || value.kind !== SEMANTIC_ANCHOR_KIND || value.verified !== true
    || value.route_hash !== routeHash || value.request_hash !== durableResult.request_hash
    || value.witness_result_hash !== durableResult.result_hash) {
    semanticError('semantic receipt anchor proof does not bind the witness result', 'WITNESS_REJECTED');
  }
  requireHash(value.anchor_record_hash, 'semantic receipt anchor record hash');
  requireHash(value.proof_hash, 'semantic receipt anchor proof hash');
  if (sha256(canonicalJson(without(value, 'proof_hash'))) !== value.proof_hash) {
    semanticError('semantic receipt anchor proof hash is invalid', 'WITNESS_REJECTED');
  }
  return cloneCanonical(value);
}

function normalizeTransportResult(raw, {
  routeHash,
  operation,
  durableBinding,
  request,
  requireAnchor,
}) {
  const value = assertExactKeys(raw, new Set([
    'schema_version',
    'kind',
    'route_hash',
    'operation',
    'request_envelope_hash',
    'witness_result',
    'anchor_proof',
  ]), 'semantic witness transport result');
  if (value.schema_version !== SEMANTIC_WITNESS_TRANSPORT_SCHEMA_VERSION
    || value.kind !== SEMANTIC_RESULT_KIND || value.route_hash !== routeHash
    || value.operation !== operation) {
    semanticError('semantic witness transport result does not match the requested route');
  }
  const envelopeHash = requireHash(value.request_envelope_hash, 'semantic request envelope hash');
  const witnessResult = normalizeDurableWitnessResult(
    durableBinding,
    request,
    envelopeHash,
    value.witness_result,
  );
  let anchorProof = null;
  if (requireAnchor) {
    anchorProof = normalizeAnchorProof(value.anchor_proof, { routeHash, durableResult: witnessResult });
  } else if (value.anchor_proof !== null) {
    semanticError('semantic witness query must not claim a receipt anchor proof');
  }
  return { envelopeHash, witnessResult, anchorProof };
}

function createSemanticWitnessAdapter({
  route: rawRoute,
  durableBinding: rawDurableBinding,
  invoke,
  requestIdFactory = null,
}) {
  if (typeof invoke !== 'function') semanticError('semantic witness adapter requires invoke()');
  const route = normalizeSemanticRoute(rawRoute);
  const durableBinding = normalizeDurableBinding(rawDurableBinding);
  const routeHash = sha256(canonicalJson(route));
  if (route.substrate_plan_hash !== durableBinding.substrate_plan_hash
    || route.p36_install_binding_hash !== durableBinding.install_binding_hash
    || route.p36_run_binding_hash !== durableBinding.run_binding_hash
    || route.durable_abi_hash !== durableBinding.durable_abi_hash
    || route.cohort_id !== durableBinding.cohort_id
    || route.generation !== durableBinding.generation
    || canonicalJson(route.worker_binding) !== canonicalJson(durableBinding.service_bindings.worker)
    || canonicalJson(route.broker_binding) !== canonicalJson(durableBinding.service_bindings.broker)
    || canonicalJson(route.receipt_verifier_binding)
      !== canonicalJson(durableBinding.service_bindings.receipt_verifier)
    || canonicalJson(route.witness_binding) !== canonicalJson(durableBinding.service_bindings.witness)
    || canonicalJson(route.coordinator_binding)
      !== canonicalJson(durableBinding.service_bindings.coordinator)) {
    semanticError('semantic route does not match the durable binding');
  }
  let active = true;
  let queryCounter = 0;

  function nextRequestId(label) {
    queryCounter += 1;
    const generated = requestIdFactory
      ? requestIdFactory({ label, counter: queryCounter })
      : `p37-${label}-${queryCounter}-${crypto.randomBytes(8).toString('hex')}`;
    return requireToken(generated, 'semantic durable request id');
  }

  function call(operation, request, { requireAnchor = false } = {}) {
    if (!active) semanticError('semantic witness adapter has been torn down', 'WITNESS_UNAVAILABLE');
    const raw = invoke(cloneCanonical({
      schema_version: 1,
      kind: 'p37_semantic_witness_transport_request',
      route_hash: routeHash,
      operation,
      request,
    }));
    if (raw && typeof raw.then === 'function') {
      semanticError('semantic witness transport must be synchronous', 'WITNESS_UNAVAILABLE');
    }
    return normalizeTransportResult(raw, {
      routeHash,
      operation,
      durableBinding,
      request,
      requireAnchor,
    });
  }

  function getHeadSnapshot() {
    const request = {
      schema_version: DURABLE_STATE_SCHEMA_VERSION,
      request_id: nextRequestId('head'),
      operation: 'getHead',
      stream_id: route.run_id,
      substrate_plan_hash: route.substrate_plan_hash,
    };
    const result = call('getHead', request).witnessResult;
    return { head: result.head, sequence: result.sequence };
  }

  function getHead() {
    return getHeadSnapshot().head;
  }

  function readReceipt(sequence) {
    const request = {
      schema_version: DURABLE_STATE_SCHEMA_VERSION,
      request_id: nextRequestId('readback'),
      operation: 'readback',
      stream_id: route.run_id,
      from_sequence: sequence,
      limit: 1,
      substrate_plan_hash: route.substrate_plan_hash,
    };
    const result = call('readback', request).witnessResult;
    return result.records.length === 1 ? result.records[0] : null;
  }

  function verifyAnchor(receipt) {
    const request = {
      schema_version: 1,
      route_hash: routeHash,
      stream_id: route.run_id,
      sequence: receipt.sequence,
      event_hash: receipt.event_hash,
      durable_request_hash: receipt.durable_request_hash,
      receipt_anchor_hash: receipt.receipt_anchor_hash,
    };
    const value = assertExactKeys(invoke(cloneCanonical({
      schema_version: 1,
      kind: 'p37_semantic_witness_transport_request',
      route_hash: routeHash,
      operation: 'verifyReceipt',
      request,
    })), new Set([
      'schema_version',
      'kind',
      'route_hash',
      'operation',
      'verified',
      'request_hash',
      'anchor_record_hash',
      'proof_hash',
    ]), 'semantic anchor verification result');
    if (value.schema_version !== 1 || value.kind !== 'p37_semantic_anchor_verification'
      || value.route_hash !== routeHash || value.operation !== 'verifyReceipt'
      || value.verified !== true || value.request_hash !== receipt.durable_request_hash
      || value.anchor_record_hash !== receipt.receipt_anchor_hash) {
      return false;
    }
    requireHash(value.proof_hash, 'semantic anchor verification proof hash');
    return sha256(canonicalJson(without(value, 'proof_hash'))) === value.proof_hash;
  }

  const adapter = {
    streamId: route.run_id,
    trustTier: 'external',
    identity: route.witness_binding.identity,
    attestation_hash: route.witness_binding.attestation_hash,
    protocol_version: 1,
    append() {
      semanticError(
        'semantic authority requires compare-and-append',
        'WITNESS_COMPARE_AND_APPEND_REQUIRED',
      );
    },
    appendIfHead(request) {
      if (!request || request.expected_witness_head !== request.previous_witness_head
        || request.run_id !== route.run_id || request.stream_id !== route.run_id
        || !Number.isSafeInteger(request.sequence) || request.sequence < 1
        || typeof request.event_hash !== 'string') {
        semanticError('semantic append request is invalid', 'INVALID_WITNESS_REQUEST');
      }
      const beforeAppend = getHeadSnapshot();
      if (beforeAppend.head !== request.expected_witness_head
        || request.sequence !== beforeAppend.sequence + 1) {
        semanticError(
          'semantic append does not continue the current durable witness sequence',
          'WITNESS_HEAD_MISMATCH',
        );
      }
      const eventPayloadHash = semanticEventPayloadHash(routeHash, request);
      const durableRequest = {
        schema_version: DURABLE_STATE_SCHEMA_VERSION,
        request_id: `p37-append-${sha256(canonicalJson({
          route_hash: routeHash,
          stream_id: route.run_id,
          sequence: request.sequence,
          event_hash: request.event_hash,
        }))}`,
        operation: 'appendIfHead',
        stream_id: route.run_id,
        expected_head: request.expected_witness_head,
        event_hash: request.event_hash,
        event_payload_hash: eventPayloadHash,
        substrate_plan_hash: route.substrate_plan_hash,
      };
      const normalized = call('appendIfHead', durableRequest, { requireAnchor: true });
      const [record] = normalized.witnessResult.records;
      if (!record || record.sequence !== request.sequence || record.event_hash !== request.event_hash
        || record.previous_head !== request.expected_witness_head
        || record.event_payload_hash !== eventPayloadHash) {
        semanticError('durable witness receipt does not match the Kernel event', 'WITNESS_REJECTED');
      }
      const readback = readReceipt(request.sequence);
      if (!readback || canonicalJson(readback) !== canonicalJson(record) || getHead() !== record.head) {
        semanticError('durable witness did not read back the exact appended receipt', 'WITNESS_REJECTED');
      }
      return {
        run_id: request.run_id,
        stream_id: request.stream_id,
        sequence: request.sequence,
        event_hash: request.event_hash,
        previous_witness_head: request.previous_witness_head,
        witness_head: record.head,
        semantic_route_hash: routeHash,
        durable_request_hash: record.request_hash,
        durable_event_payload_hash: record.event_payload_hash,
        receipt_anchor_hash: normalized.anchorProof.anchor_record_hash,
      };
    },
    appendBatchIfHead(request) {
      if (!request || request.expected_witness_head === undefined
        || request.run_id !== route.run_id || request.stream_id !== route.run_id
        || typeof request.batch_id !== 'string'
        || !Array.isArray(request.events) || request.events.length < 1) {
        semanticError('semantic batch append request is invalid', 'INVALID_WITNESS_REQUEST');
      }
      const eventHashes = request.events.map((event) => event && event.event_hash);
      const firstSequence = request.events[0] && request.events[0].sequence;
      if (!Number.isSafeInteger(firstSequence)
        || firstSequence < 1
        || firstSequence + request.events.length - 1 > Number.MAX_SAFE_INTEGER
        || request.events.some((event, index) => (
          !event
          || event.sequence !== firstSequence + index
          || typeof event.event_hash !== 'string'
          || typeof event.type !== 'string'
        ))) {
        semanticError('semantic batch events must have contiguous safe sequences', 'INVALID_WITNESS_REQUEST');
      }
      const expectedCommitment = sha256(canonicalJson({
        run_id: request.run_id,
        stream_id: request.stream_id,
        batch_id: request.batch_id,
        expected_witness_head: request.expected_witness_head,
        event_hashes: eventHashes,
      }));
      if (request.batch_commitment !== expectedCommitment) {
        semanticError('semantic batch commitment is invalid', 'INVALID_WITNESS_REQUEST');
      }
      const beforeAppend = getHeadSnapshot();
      if (beforeAppend.head !== request.expected_witness_head
        || firstSequence !== beforeAppend.sequence + 1) {
        semanticError(
          'semantic batch does not continue the current durable witness sequence',
          'WITNESS_HEAD_MISMATCH',
        );
      }
      const durableEvents = request.events.map((event, index) => {
        return {
          event_hash: event.event_hash,
          event_payload_hash: semanticBatchEventPayloadHash(routeHash, request, event, index),
        };
      });
      const durableRequest = {
        schema_version: DURABLE_STATE_SCHEMA_VERSION,
        request_id: `p37-batch-${sha256(canonicalJson({
          route_hash: routeHash,
          stream_id: route.run_id,
          batch_id: request.batch_id,
          batch_commitment: expectedCommitment,
        }))}`,
        operation: 'appendBatchIfHead',
        stream_id: route.run_id,
        expected_head: request.expected_witness_head,
        events: durableEvents,
        substrate_plan_hash: route.substrate_plan_hash,
      };
      const normalized = call('appendBatchIfHead', durableRequest, { requireAnchor: true });
      const records = normalized.witnessResult.records;
      if (records.length !== request.events.length || records.some((record, index) => (
        record.sequence !== request.events[index].sequence
        || record.event_hash !== request.events[index].event_hash
        || record.event_payload_hash !== durableEvents[index].event_payload_hash
      ))) {
        semanticError('durable witness batch receipts do not match the Kernel events', 'WITNESS_REJECTED');
      }
      const readback = records.map((record) => readReceipt(record.sequence));
      if (readback.some((record, index) => (
        !record || canonicalJson(record) !== canonicalJson(records[index])
      )) || getHead() !== records[records.length - 1].head) {
        semanticError('durable witness did not read back the exact appended batch', 'WITNESS_REJECTED');
      }
      return {
        receipts: records.map((record, index) => ({
          run_id: request.run_id,
          stream_id: request.stream_id,
          sequence: request.events[index].sequence,
          event_hash: request.events[index].event_hash,
          previous_witness_head: record.previous_head,
          witness_head: record.head,
          batch_id: request.batch_id,
          batch_index: index,
          batch_size: request.events.length,
          batch_event_hashes: [...eventHashes],
          batch_commitment: expectedCommitment,
          ...(request.coordinator_commitment === undefined
            ? {}
            : { coordinator_commitment: cloneCanonical(request.coordinator_commitment) }),
          semantic_route_hash: routeHash,
          durable_request_hash: record.request_hash,
          durable_event_payload_hash: record.event_payload_hash,
          receipt_anchor_hash: normalized.anchorProof.anchor_record_hash,
        })),
      };
    },
    verify(receipt) {
      try {
        if (!active || !receipt || receipt.run_id !== route.run_id || receipt.stream_id !== route.run_id
          || receipt.semantic_route_hash !== routeHash
          || (receipt.batch_id === undefined
            ? semanticEventPayloadHash(routeHash, receipt) !== receipt.durable_event_payload_hash
            : semanticBatchEventPayloadHash(routeHash, {
              run_id: receipt.run_id,
              stream_id: receipt.stream_id,
              batch_id: receipt.batch_id,
              batch_commitment: receipt.batch_commitment,
              events: receipt.batch_event_hashes.map((eventHash, index) => ({
                sequence: receipt.sequence - receipt.batch_index + index,
                event_hash: eventHash,
              })),
            }, {
              sequence: receipt.sequence,
              event_hash: receipt.event_hash,
            }, receipt.batch_index) !== receipt.durable_event_payload_hash)) {
          return false;
        }
        const readback = readReceipt(receipt.sequence);
        if (!readback || readback.head !== receipt.witness_head
          || readback.previous_head !== receipt.previous_witness_head
          || readback.event_hash !== receipt.event_hash
          || readback.event_payload_hash !== receipt.durable_event_payload_hash
          || readback.request_hash !== receipt.durable_request_hash) {
          return false;
        }
        return verifyAnchor(receipt);
      } catch (_error) {
        return false;
      }
    },
    verifyBatch(receipts) {
      if (!Array.isArray(receipts) || receipts.length < 1) return false;
      const first = receipts[0];
      return receipts.every((receipt, index) => (
        receipt
        && receipt.batch_id === first.batch_id
        && receipt.batch_index === index
        && receipt.batch_size === receipts.length
        && receipt.batch_commitment === first.batch_commitment
        && canonicalJson(receipt.batch_event_hashes) === canonicalJson(first.batch_event_hashes)
        && receipt.event_hash === first.batch_event_hashes[index]
        && receipt.durable_request_hash === first.durable_request_hash
        && receipt.receipt_anchor_hash === first.receipt_anchor_hash
        && adapter.verify(receipt)
      ));
    },
    getHead,
    teardown() {
      if (!active) return false;
      active = false;
      const result = invoke(cloneCanonical({
        schema_version: 1,
        kind: 'p37_semantic_witness_transport_request',
        route_hash: routeHash,
        operation: 'teardown',
        request: null,
      }));
      if (!result || result.ok !== true || result.route_hash !== routeHash) {
        semanticError('semantic witness transport teardown failed', 'WITNESS_TEARDOWN_FAILED');
      }
      return true;
    },
  };
  return Object.freeze(adapter);
}

function throwAfterWitnessTeardown(witness, error) {
  try {
    witness.teardown();
  } catch (teardownError) {
    throw new AggregateError(
      [error, teardownError],
      'Owner Kernel session initialization failed and witness teardown also failed',
      { cause: error },
    );
  }
  throw error;
}

function createSemanticWitnessSession(options = {}) {
  const nestedModeOverride = options.kernelOptions && options.kernelOptions.modeOverride;
  if (options.modeOverride !== undefined && nestedModeOverride !== undefined
    && options.modeOverride !== nestedModeOverride) {
    semanticError('semantic session has conflicting mode overrides');
  }
  const modeOverride = options.modeOverride === undefined
    ? nestedModeOverride
    : options.modeOverride;
  const route = compileSemanticWitnessRoute({ ...options, modeOverride });
  assertSemanticRouteFresh(route, options.kernelOptions && options.kernelOptions.clock);
  const witness = createSemanticWitnessAdapter({
    route,
    durableBinding: options.durableBinding,
    invoke: options.invoke,
    requestIdFactory: options.requestIdFactory,
  });
  let started;
  try {
    started = OwnerKernel.start({
      ...options.kernelOptions,
      runId: route.run_id,
      governanceConfig: options.governanceConfig,
      modeOverride,
      acceptanceContract: options.acceptanceContract,
      witness,
      semanticAuthority: route,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  let closed = false;
  return {
    ...started,
    route,
    route_hash: sha256(canonicalJson(route)),
    authority: {
      owner_kernel_authority: 'semantic_only',
      effect_authority: 'none',
      broker_authority: 'disabled',
      acceptance: 'not_available',
    },
    teardown() {
      if (closed) return false;
      started.kernel.stopBlockedTimeoutMonitor();
      witness.teardown();
      closed = true;
      return true;
    },
  };
}

function resumeSemanticWitnessSession(options = {}) {
  const nestedModeOverride = options.kernelOptions && options.kernelOptions.modeOverride;
  if (options.modeOverride !== undefined && nestedModeOverride !== undefined
    && options.modeOverride !== nestedModeOverride) {
    semanticError('semantic resume has conflicting mode overrides');
  }
  const modeOverride = options.modeOverride === undefined
    ? nestedModeOverride
    : options.modeOverride;
  const route = compileSemanticWitnessRoute({ ...options, modeOverride });
  const witness = createSemanticWitnessAdapter({
    route,
    durableBinding: options.durableBinding,
    invoke: options.invoke,
    requestIdFactory: options.requestIdFactory,
  });
  let resumed;
  try {
    resumed = OwnerKernel.resume({
      ...options.kernelOptions,
      ledger: options.ledger,
      witness,
      semanticAuthority: route,
    });
  } catch (error) {
    throwAfterWitnessTeardown(witness, error);
  }
  let closed = false;
  return {
    ...resumed,
    route,
    route_hash: sha256(canonicalJson(route)),
    authority: {
      owner_kernel_authority: 'semantic_only',
      effect_authority: 'none',
      broker_authority: 'disabled',
      acceptance: 'not_available',
    },
    teardown() {
      if (closed) return false;
      resumed.kernel.stopBlockedTimeoutMonitor();
      witness.teardown();
      closed = true;
      return true;
    },
  };
}

module.exports = {
  SEMANTIC_WITNESS_TRANSPORT_SCHEMA_VERSION,
  assertSemanticRouteFresh,
  compileSemanticWitnessRoute,
  createSemanticWitnessAdapter,
  createSemanticWitnessSession,
  resumeSemanticWitnessSession,
  throwAfterWitnessTeardown,
};
