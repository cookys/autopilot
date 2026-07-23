#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = process.argv[2];
const {
  SupervisedShadowEngineConsumerError,
  buildVerifiedIntakeCapsule,
  createFileShadowEngineConsumer,
  recordForCapsule,
} = require(path.join(root, 'src', 'engine', 'supervised-shadow-engine-consumer'));
const { canonicalJson, sha256 } = require(path.join(root, 'src', 'engine', 'owner-kernel', 'canonical'));

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}
function rejects(fn, code, message) {
  assertions += 1;
  assert.throws(fn, (error) => error instanceof SupervisedShadowEngineConsumerError && error.code === code, message);
}
function digest(label) {
  return sha256(label);
}

function plan(overrides = {}) {
  return {
    schema_version: 1,
    owner_run_id: 'owner-shadow-p35b',
    engine_run_id: 'engine-shadow-p35b',
    invocation_id: 'invocation-shadow-p35b',
    policy_hash: digest('policy'),
    contract_hash: digest('contract'),
    immutable_base: 'a'.repeat(40),
    inputs: {
      workspace_root_hash: digest('workspace-locator-never-persisted'),
      prompt_hash: digest('raw-prompt-never-persisted'),
      branch_hash: digest('raw-branch-never-persisted'),
      verify_command_hash: digest('raw-command-never-persisted'),
    },
    intake_binding_hash: digest('intake-binding'),
    sink_inventory_hash: digest('sink-inventory'),
    bridge_abi_hash: digest('bridge-abi'),
    sink_mappings: [],
    ...overrides,
  };
}

function sourceInput(overrides = {}) {
  const compiled = plan(overrides.plan || {});
  const planHash = sha256(canonicalJson(compiled));
  const shared = {
    intake_binding_hash: compiled.intake_binding_hash,
    sink_inventory_hash: compiled.sink_inventory_hash,
    bridge_abi_hash: compiled.bridge_abi_hash,
    plan_hash: planHash,
    issuer: 'owner-control',
    key_id: 'owner-keyring',
    attestation_hash: digest('attestation'),
    envelope_hash: digest('envelope'),
  };
  return {
    plan: compiled,
    authenticatedReceipt: {
      schema_version: 1,
      status: 'verified_intake',
      owner_kernel_authority: 'none',
      acceptance: 'not_available',
      verification_path: 'host_pinned_authenticated_intake',
      issuer: shared.issuer,
      key_id: shared.key_id,
      attestation_hash: shared.attestation_hash,
      signing_key_id: 'signing-key',
      keyring_epoch: 1,
      envelope_hash: shared.envelope_hash,
      binding_hash: compiled.intake_binding_hash,
      plan_hash: planHash,
      install_binding_hash: digest('install-binding'),
      session_id: 'session-shadow-p35b',
      session_challenge_hash: digest('session-challenge'),
      verified_at_ms: 1760000000000,
      replay_status: 'new',
    },
    bridgeReceipt: {
      verified: true,
      ...shared,
      verification_path: 'host_pinned_authenticated_intake',
    },
    installBindingHash: digest('install-binding'),
  };
}

const capsule = buildVerifiedIntakeCapsule(sourceInput());
const capsuleText = canonicalJson(capsule);
equal(capsule.kind, 'verified_supervised_engine_shadow_intake', 'capsule has the fixed intake kind');
check(!capsuleText.includes('raw-prompt-never-persisted'), 'capsule omits raw prompt text');
check(!capsuleText.includes('workspace-locator-never-persisted'), 'capsule omits raw workspace path');
check(!capsuleText.includes('raw-command-never-persisted'), 'capsule omits raw command text');
equal(capsule.bridge.plan_hash, sha256(canonicalJson(sourceInput().plan)), 'capsule binds the exact compiled plan');

rejects(
  () => buildVerifiedIntakeCapsule({ ...sourceInput(), bridgeReceipt: { ...sourceInput().bridgeReceipt, plan_hash: digest('wrong-plan') } }),
  'SUPERVISED_SHADOW_ENGINE_BINDING_MISMATCH',
  'plan receipt drift is rejected',
);
rejects(
  () => buildVerifiedIntakeCapsule({ ...sourceInput(), installBindingHash: digest('other-install') }),
  'SUPERVISED_SHADOW_ENGINE_BINDING_MISMATCH',
  'install binding drift is rejected',
);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-shadow-engine-'));
fs.chmodSync(temporary, 0o700);
try {
  const consumer = createFileShadowEngineConsumer({ state_directory: temporary });
  const first = consumer.consumeVerifiedIntake(capsule);
  equal(first.status, 'shadow_intake_recorded', 'first verified capsule records a shadow admission');
  equal(first.idempotent, false, 'first record is not marked idempotent');
  equal(first.disclosure.owner_kernel_authority, 'none', 'shadow record has no Kernel authority');
  equal(first.disclosure.effect_authority, 'none', 'shadow record has no effect authority');
  equal(first.disclosure.acceptance, 'not_available', 'shadow record cannot accept');
  equal(first.disclosure.witness_assurance, 'local_verifier_state_not_independent_witness', 'local state is not claimed as an independent witness');
  const second = consumer.consumeVerifiedIntake(capsule);
  equal(second.idempotent, true, 'identical recorded capsule is idempotent');
  equal(second.record_hash, first.record_hash, 'idempotent replay preserves record hash');
  const expected = recordForCapsule(capsule);
  equal(first.record_hash, expected.record_hash, 'public summary binds the deterministic record hash');
  const stateDirectory = path.join(temporary, 'shadow-engine');
  const entries = fs.readdirSync(stateDirectory).sort();
  equal(entries.length, 1, 'successful record leaves one durable state file');
  check(entries[0].endsWith('.recorded.json'), 'durable state is recorded');
  const stateInfo = fs.lstatSync(path.join(stateDirectory, entries[0]));
  equal(stateInfo.mode & 0o777, 0o600, 'durable record is verifier-private');
  const durableText = fs.readFileSync(path.join(stateDirectory, entries[0]), 'utf8');
  check(!durableText.includes('raw-prompt-never-persisted'), 'durable record excludes raw prompt text');
  check(!durableText.includes('workspace-locator-never-persisted'), 'durable record excludes raw workspace path');
  consumer.close();

  const symlinkConsumer = createFileShadowEngineConsumer({ state_directory: temporary });
  fs.unlinkSync(path.join(stateDirectory, entries[0]));
  fs.symlinkSync('/etc/passwd', path.join(stateDirectory, entries[0]));
  rejects(
    () => symlinkConsumer.consumeVerifiedIntake(capsule),
    'SUPERVISED_SHADOW_ENGINE_STATE_UNSAFE',
    'symlinked durable state is rejected before use',
  );
  symlinkConsumer.close();
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

const publishFailureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-shadow-publish-failure-'));
fs.chmodSync(publishFailureRoot, 0o700);
try {
  const consumer = createFileShadowEngineConsumer({ state_directory: publishFailureRoot });
  const originalLinkSync = fs.linkSync;
  fs.linkSync = () => {
    const error = new Error('simulated durable publish failure');
    error.code = 'EIO';
    throw error;
  };
  try {
    rejects(
      () => consumer.consumeVerifiedIntake(capsule),
      'SUPERVISED_SHADOW_ENGINE_STATE_WRITE_FAILED',
      'failed publication returns a typed failure',
    );
  } finally {
    fs.linkSync = originalLinkSync;
  }
  const entries = fs.readdirSync(path.join(publishFailureRoot, 'shadow-engine'));
  equal(entries.length, 0, 'failed publication removes its unpublished temporary state');
  consumer.close();
} finally {
  fs.rmSync(publishFailureRoot, { recursive: true, force: true });
}

const crashRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-shadow-crash-'));
fs.chmodSync(crashRoot, 0o700);
try {
  const crashing = createFileShadowEngineConsumer({
    state_directory: crashRoot,
    after_pending_persisted: () => { throw new Error('simulated verifier interruption'); },
  });
  assert.throws(() => crashing.consumeVerifiedIntake(capsule), /simulated verifier interruption/, 'test hook interrupts after pending fsync');
  assertions += 1;
  crashing.close();
  const recovery = createFileShadowEngineConsumer({ state_directory: crashRoot });
  equal(recovery.recoverPending(), 1, 'restart sweeps the interrupted pending record');
  const interruptedRecord = recordForCapsule(capsule);
  const interruptedPending = {
    schema_version: 1,
    state: 'pending',
    intake_id: interruptedRecord.intake_id,
    capsule,
    capsule_hash: interruptedRecord.capsule_hash,
    record: interruptedRecord,
    record_hash: interruptedRecord.record_hash,
  };
  const stateDirectory = path.join(crashRoot, 'shadow-engine');
  fs.writeFileSync(path.join(stateDirectory, `${interruptedRecord.intake_id}.pending.json`), canonicalJson(interruptedPending), { mode: 0o600 });
  fs.chmodSync(path.join(stateDirectory, `${interruptedRecord.intake_id}.pending.json`), 0o600);
  equal(recovery.recoverPending(), 0, 'restart retains an already persisted recovery-required state');
  check(!fs.existsSync(path.join(stateDirectory, `${interruptedRecord.intake_id}.pending.json`)), 'post-recovery pending residue is removed');
  rejects(
    () => recovery.consumeVerifiedIntake(capsule),
    'SUPERVISED_SHADOW_ENGINE_RECOVERY_REQUIRED',
    'restart never promotes an interrupted shadow record to success',
  );
  const recoveryEntries = fs.readdirSync(stateDirectory).sort();
  equal(recoveryEntries.length, 1, 'recovery leaves one terminal diagnostic state');
  check(recoveryEntries[0].endsWith('.recovery-required.json'), 'interrupted state becomes recovery-required');
  recovery.close();
} finally {
  fs.rmSync(crashRoot, { recursive: true, force: true });
}

const cleanupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-shadow-temp-'));
fs.chmodSync(cleanupRoot, 0o700);
try {
  const consumer = createFileShadowEngineConsumer({ state_directory: cleanupRoot });
  const stateDirectory = path.join(cleanupRoot, 'shadow-engine');
  const temporaryName = `.${'b'.repeat(64)}.pending.json.pending-${'c'.repeat(32)}`;
  fs.writeFileSync(path.join(stateDirectory, temporaryName), '{', { mode: 0o600 });
  fs.chmodSync(path.join(stateDirectory, temporaryName), 0o600);
  equal(consumer.recoverPending(), 0, 'unpublished interrupted temporary is discarded');
  check(!fs.existsSync(path.join(stateDirectory, temporaryName)), 'strict temporary cleanup removes no published state');
  const recorded = consumer.consumeVerifiedIntake(capsule);
  const recordedName = `${recorded.intake_id}.recorded.json`;
  const linkedTemporary = `.${recordedName}.pending-${'d'.repeat(32)}`;
  fs.linkSync(path.join(stateDirectory, recordedName), path.join(stateDirectory, linkedTemporary));
  equal(consumer.recoverPending(), 0, 'restart removes the post-link crash temporary without changing published state');
  check(!fs.existsSync(path.join(stateDirectory, linkedTemporary)), 'post-link crash temporary is removed');
  equal(fs.lstatSync(path.join(stateDirectory, recordedName)).nlink, 1, 'published state retains one link after cleanup');
  const pendingName = `${recorded.intake_id}.pending.json`;
  const recordedState = JSON.parse(fs.readFileSync(path.join(stateDirectory, recordedName), 'utf8'));
  fs.writeFileSync(path.join(stateDirectory, pendingName), canonicalJson({ ...recordedState, state: 'pending' }), { mode: 0o600 });
  fs.chmodSync(path.join(stateDirectory, pendingName), 0o600);
  equal(consumer.recoverPending(), 0, 'restart preserves exact recorded state after a post-record crash');
  check(!fs.existsSync(path.join(stateDirectory, pendingName)), 'post-record pending residue is removed after exact readback');
  const recoveryName = `${recorded.intake_id}.recovery-required.json`;
  fs.writeFileSync(path.join(stateDirectory, recoveryName), canonicalJson({
    schema_version: 1,
    state: 'recovery_required',
    intake_id: recorded.intake_id,
    capsule_hash: recordedState.capsule_hash,
    record_hash: recordedState.record_hash,
    reason: 'pending_shadow_record_after_restart',
  }), { mode: 0o600 });
  fs.chmodSync(path.join(stateDirectory, recoveryName), 0o600);
  rejects(
    () => consumer.recoverPending(),
    'SUPERVISED_SHADOW_ENGINE_STATE_CONFLICT',
    'startup rejects a recorded and recovery-required conflict even without a pending residue',
  );
  consumer.close();
} finally {
  fs.rmSync(cleanupRoot, { recursive: true, force: true });
}

const source = fs.readFileSync(path.join(root, 'src', 'engine', 'supervised-shadow-engine-consumer.js'), 'utf8');
for (const forbidden of [
  "require('./autopilot-engine')",
  "require('./owner-kernel/index')",
  'child_process',
  'spawnSync',
  'execSync',
]) {
  check(!source.includes(forbidden), `shadow consumer has no ${forbidden} effect path`);
}

console.log(`shadow_consumer_assertions=${assertions}`);
console.log('verified_intake_capsule_is_hash_only=true');
console.log('interrupted_shadow_state_is_never_promoted=true');
console.log('shadow_consumer_has_no_engine_or_action_effects=true');
NODE
)"
STATUS=$?

assert_eq "$STATUS" "0" "supervised shadow Engine consumer deterministic fixture exits successfully"
assert_contains "$OUT" "shadow_consumer_assertions=" "shadow consumer executes its assertion matrix"
assert_contains "$OUT" "verified_intake_capsule_is_hash_only=true" "shadow consumer keeps raw intent data out of durable state"
assert_contains "$OUT" "interrupted_shadow_state_is_never_promoted=true" "shadow consumer fails closed after an interruption"
assert_contains "$OUT" "shadow_consumer_has_no_engine_or_action_effects=true" "shadow consumer has no live effect dependency"

finalize_test
