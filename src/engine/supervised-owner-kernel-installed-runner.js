'use strict';
// Node-side installed U5 runner.
// Production path: real installed host route only. Engine sink and acceptance
// stay disabled. No in-process completed fallback, crash-window simulation,
// caller-supplied route inputs, effect/witness callbacks, driveSession, or
// createInProcessProbeHost. Simulation belongs in test fixture code only.
const {
  canonicalJson,
  cloneCanonical,
  sha256,
} = require('./owner-kernel/canonical');
const { OwnerKernelError } = require('./owner-kernel/errors');
const {
  AUTHORITY_DISCLOSURE,
  FIXED_PROBE,
  compileInstalledProfile,
  normalizeInstalledBinding,
  normalizeInstalledResult,
  rejectCallerControlledFields,
} = require('./supervised-owner-kernel-installed-contract');
const RUNNER_KIND = 'p37_installed_runner_result';
function runnerError(message, code = 'INSTALLED_RUNNER_ERROR') {
  throw new OwnerKernelError(message, code);}
function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    runnerError(`${label} must be a plain object`);}
  return value;}
function durableBindingFromInstalled(installedBinding) {
  const binding = normalizeInstalledBinding(installedBinding);
  const five = {
    worker: binding.service_bindings.worker,
    broker: binding.service_bindings.broker,
    receipt_verifier: binding.service_bindings.receipt_verifier,
    witness: binding.service_bindings.witness,
    coordinator: binding.service_bindings.coordinator,};
  return cloneCanonical({
    schema_version: 1,
    kind: 'p36_durable_state_binding',
    install_binding_hash: binding.install_binding_hash,
    run_binding_hash: binding.run_binding_hash,
    substrate_abi_hash: binding.durable_abi_hash,
    substrate_plan_hash: sha256(canonicalJson({
      kind: 'p37_installed_substrate_plan_bridge',
      install_binding_hash: binding.install_binding_hash,
      cohort_id: binding.cohort_id,
      generation: binding.generation,
    })),
    durable_abi_hash: binding.durable_abi_hash,
    cohort_id: binding.cohort_id,
    generation: binding.generation,
    service_bindings: five,
  });}
function buildInstalledResult({
  profile,
  outcome,
  status,
  sentinelRestored,
  auditMaterial,
}) {
  const material = {
    schema_version: 1,
    kind: 'p37_installed_run_probe_result',
    status,
    outcome,
    profile_hash: profile.profile_hash,
    install_binding_hash: profile.binding.install_binding_hash,
    run_binding_hash: profile.binding.run_binding_hash,
    cohort_id: profile.binding.cohort_id,
    generation: profile.binding.generation,
    probe_catalog_id: FIXED_PROBE.catalog_id,
    effect_replayed: false,
    sentinel_restored: sentinelRestored === true,
    authority: cloneCanonical(AUTHORITY_DISCLOSURE),
    audit_hash: sha256(canonicalJson(auditMaterial)),};
  material.result_hash = sha256(canonicalJson(material));
  return normalizeInstalledResult(material);}
async function runInstalledProbe(options = {}) {
  assertObject(options, 'runInstalledProbe options');
  rejectCallerControlledFields(options, 'runInstalledProbe options');
  if (options.engine_sink != null && options.engine_sink !== 'disabled') {
    runnerError('U5 keeps the installed Engine sink disabled', 'ENGINE_SINK_DISABLED');}
  if (options.acceptance != null && options.acceptance !== 'not_available') {
    runnerError('U5 keeps acceptance unavailable', 'ACCEPTANCE_DISABLED');}
  // Reject simulation and caller-route knobs at the production surface.
  if (
    options.simulateCrashWindow != null
    || options.requestId != null
  ) {
    runnerError(
      'installed probe rejects production crash-window simulation; use contract crash helpers in tests only',
      'INSTALLED_ROUTE_REQUIRED',);}
  const installedBinding = normalizeInstalledBinding(options.binding);
  const profile = options.profile
    ? compileInstalledProfile({ binding: installedBinding, ...options.profile })
    : compileInstalledProfile({ binding: installedBinding });
  // Production export accepts no caller-supplied route inputs, effect/witness
  // callbacks, driveSession hooks, or in-process probe hosts.
  if (
    options.routeInputs != null
    || options.governanceConfig != null
    || options.acceptanceContract != null
    || options.durableBinding != null
    || options.witnessInvoke != null
    || options.effectInvoke != null
    || options.driveSession != null
    || options.modeOverride != null
    || options.capabilityProbedAt != null
    || options.capabilityExpiresAt != null
    || options.kernelOptions != null
  ) {
    runnerError(
      'installed probe rejects caller-supplied route, callback, or session inputs; use the real installed host',
      'INSTALLED_ROUTE_REQUIRED',);}
  // No missing-route branch may return completed. Simulation is test-only.
  runnerError(
    'installed probe requires the real installed host route; in-process completed fallback is disabled',
    'INSTALLED_ROUTE_REQUIRED',);}
function createInstalledRunner(options = {}) {
  assertObject(options, 'createInstalledRunner options');
  const binding = normalizeInstalledBinding(options.binding);
  const profile = compileInstalledProfile({ binding });
  return Object.freeze({
    profile,
    binding,
    authority: cloneCanonical(AUTHORITY_DISCLOSURE),
    fixed_probe: cloneCanonical(FIXED_PROBE),
    async runProbe(runOptions = {}) {
      return runInstalledProbe({
        ...options,
        ...runOptions,
        binding,
        profile,
      });
    },
  });}
module.exports = {
  RUNNER_KIND,
  buildInstalledResult,
  createInstalledRunner,
  durableBindingFromInstalled,
  runInstalledProbe,};
