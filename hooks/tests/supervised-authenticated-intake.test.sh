#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = process.argv[2];
const {
  AUTOPILOT_ENGINE_CONTROL_SINKS,
  compileSupervisedEngineBridgeContract,
  getAutopilotEngineControlSinkInventory,
  getRequiredActionCatalogBindingIds,
  getSupervisedEngineBridgeAbiHash,
  verifySupervisedEngineBridgeContract,
} = require(path.join(root, 'src', 'engine', 'supervised-engine-bridge-contract'));
const {
  AUTHENTICATED_INTAKE_PURPOSE,
  AUTHENTICATED_INTAKE_V2_PURPOSE,
  AUTHENTICATED_INTAKE_V2_SCHEMA_VERSION,
  AuthenticatedIntakeError,
  createFileReplayStore,
  createHostPinnedTrustedIntakeVerifier,
  createInMemoryReplayStore,
  normalizeAuthenticatedIntakeKeyring,
  verifyHostPinnedAuthenticatedIntake,
} = require(path.join(root, 'src', 'engine', 'supervised-authenticated-intake'));
const {
  canonicalJson,
  freezeAcceptanceContract,
  resolveGovernancePolicy,
  sha256,
} = require(path.join(root, 'src', 'engine', 'owner-kernel'));

const nowBase = 1760000000000;
const hash = (value) => sha256(value);

const requirementBySink = {
  'campaign-intake': ['engine_campaign_intake', 'campaign_control', 'external'],
  'campaign-admission-release': ['engine_campaign_admission_release', 'campaign_control', 'external'],
  'campaign-event-append': ['engine_campaign_event_append', 'campaign_control', 'external'],
  'campaign-admission-complete': ['engine_campaign_admission_complete', 'campaign_control', 'external'],
  'campaign-post-commit-checkpoint': ['engine_campaign_post_commit_checkpoint', 'campaign_control', 'irreversible'],
  'mission-terminal-reconcile': ['engine_mission_terminal_reconcile', 'mission_control', 'external'],
  'review-dispatch': ['engine_review_dispatch', 'model_runner', 'external'],
  'implementation-dispatch': ['engine_implementation_dispatch', 'model_runner', 'external'],
  'diff-provenance': ['engine_diff_materialization', 'filesystem_git', 'reversible'],
  'repair-prompt-write': ['engine_repair_prompt_write', 'filesystem', 'reversible'],
  'verification-execution': ['engine_verification_command', 'shell', 'external'],
  'verify-worktree-add': ['engine_verify_worktree_add', 'git', 'external'],
  'verify-worktree-remove': ['engine_verify_worktree_remove', 'git', 'external'],
  'verify-worktree-cleanup': ['engine_verify_worktree_cleanup', 'filesystem', 'irreversible'],
  'branch-force': ['engine_branch_force', 'git', 'external'],
};

function attestation(identity) {
  return {
    issuer: 'test',
    uri: `test://${identity}`,
    sha256: hash(identity),
    issued_at: '2026-07-23T00:00:00.000Z',
    expires_at: '2027-07-23T00:00:00.000Z',
  };
}

function roster(identity, role) {
  return {
    identity,
    model_alias: identity,
    model_version: '1',
    family: 'test',
    runner: 'test',
    role,
    attestation: attestation(identity),
  };
}

function governanceConfig() {
  return {
    schema_version: 1,
    governance: {
      default_mode: 'owner-led',
      owner_roster: [roster('owner-a', 'owner')],
      challenger_roster: [roster('challenger-a', 'challenger')],
      trusted_runner_roster: [roster('runner-a', 'trusted_runner')],
      approval_policy: {
        read_only: { requires_approval: false, max_uses: 1 },
        reversible: { requires_approval: false, max_uses: 1 },
        external: { requires_approval: true, max_uses: 1 },
        irreversible: { requires_approval: true, max_uses: 1 },
      },
      capability_ttl_seconds: 3600,
      checkpoint_interval_closed_events: 100,
      max_blocked_duration_seconds: 86400,
      action_catalog: AUTOPILOT_ENGINE_CONTROL_SINKS
        .filter((sink) => sink.requires_action_catalog_binding)
        .map((sink) => {
          const [operation, toolClass, actionClass] = requirementBySink[sink.id];
          return {
            id: sink.id,
            operation,
            tool_class: toolClass,
            action_class: actionClass,
            command_required: sink.id === 'verification-execution',
            requires_mediator: true,
            requires_challenge: false,
          };
        }),
    },
  };
}

function acceptanceContract() {
  return {
    schema_version: 2,
    contract_id: 'supervised-authenticated-intake',
    artifacts: [{ id: 'source', target: 'src/engine/autopilot-engine.js' }],
    legs: [{
      id: 'verification',
      kind: 'executable',
      command: 'bash hooks/tests/autopilot-engine.test.sh',
      artifact_ids: ['source'],
    }],
  };
}

function bridgeInput(overrides = {}) {
  return {
    ownerRunId: 'owner-run-p35',
    engineRunId: 'engine-run-p35',
    invocationId: 'invocation-p35',
    governanceConfig: governanceConfig(),
    acceptanceContract: acceptanceContract(),
    immutableBase: 'a'.repeat(40),
    workspaceRoot: path.join(root, 'test-workspace'),
    prompt: 'prompt must remain hash-only',
    branch: 'feat/p35',
    verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
    actionCatalogBindings: Object.fromEntries(getRequiredActionCatalogBindingIds().map((id) => [id, id])),
    ...overrides,
  };
}

function bridgeInputV2(overrides = {}) {
  return {
    schema_version: 2,
    ownerRunId: 'owner-run-p35d',
    engineRunId: 'engine-run-p35d',
    invocationId: 'invocation-p35d',
    governanceConfig: governanceConfig(),
    acceptanceContract: acceptanceContract(),
    immutableBase: 'b'.repeat(40),
    workspaceBinding: {
      registrationId: 'p35d-workspace-main',
      workspaceRootHash: hash('p35d-workspace-root'),
      descriptorBindingHash: hash('p35d-descriptor-binding'),
      ticketHash: hash('p35d-ticket'),
    },
    prompt: 'p35d prompt remains hash-only',
    branch: 'feat/p35d',
    verifyCommand: 'bash hooks/tests/run.sh --parallel 16',
    actionCatalogBindings: Object.fromEntries(getRequiredActionCatalogBindingIds().map((id) => [id, id])),
    ...overrides,
  };
}

function trustedBinding(input) {
  return {
    schema_version: 1,
    owner_run_id: input.ownerRunId,
    engine_run_id: input.engineRunId,
    invocation_id: input.invocationId,
    policy_hash: resolveGovernancePolicy(input.governanceConfig).policy_hash,
    contract_hash: freezeAcceptanceContract(input.acceptanceContract).contract_hash,
    immutable_base: input.immutableBase,
    workspace_root_hash: hash(path.resolve(input.workspaceRoot)),
    prompt_hash: hash(input.prompt),
    branch_hash: hash(input.branch),
    verify_command_hash: hash(input.verifyCommand),
    sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())),
    bridge_abi_hash: getSupervisedEngineBridgeAbiHash(),
  };
}

function trustedBindingV2(input) {
  const workspace = input.workspaceBinding;
  return {
    schema_version: 2,
    owner_run_id: input.ownerRunId,
    engine_run_id: input.engineRunId,
    invocation_id: input.invocationId,
    policy_hash: resolveGovernancePolicy(input.governanceConfig).policy_hash,
    contract_hash: freezeAcceptanceContract(input.acceptanceContract).contract_hash,
    immutable_base: input.immutableBase,
    workspace_registration_id: workspace.registrationId,
    workspace_root_hash: workspace.workspaceRootHash,
    workspace_descriptor_binding_hash: workspace.descriptorBindingHash,
    workspace_ticket_hash: workspace.ticketHash,
    prompt_hash: hash(input.prompt),
    branch_hash: hash(input.branch),
    verify_command_hash: hash(input.verifyCommand),
    sink_inventory_hash: hash(canonicalJson(getAutopilotEngineControlSinkInventory())),
    bridge_abi_hash: getSupervisedEngineBridgeAbiHash(2),
  };
}

const keyPair = crypto.generateKeyPairSync('ed25519');
const publicDer = keyPair.publicKey.export({ format: 'der', type: 'spki' });
const rawKeyring = {
  schema_version: 1,
  issuer: 'owner-control',
  keyring_id: 'owner-keyring-e1',
  keyring_epoch: 1,
  keys: [{
    algorithm: 'ed25519',
    key_id: 'owner-ed25519-a',
    not_before_ms: nowBase - 1000,
    not_after_ms: nowBase + 300000,
    public_key_spki_base64: publicDer.toString('base64url'),
  }],
};
const normalizedKeyring = normalizeAuthenticatedIntakeKeyring(rawKeyring);
const installBindingHash = hash('p35-installed-host');
const session = {
  session_id: 'session-p35',
  session_challenge_hash: hash('root-created-session-challenge'),
};

function makeClaims(input, plan, overrides = {}) {
  const binding = trustedBinding(input);
  return {
    schema_version: 1,
    purpose: AUTHENTICATED_INTAKE_PURPOSE,
    audience: 'autopilot-supervised-host',
    issuer: rawKeyring.issuer,
    signing_key_id: rawKeyring.keys[0].key_id,
    keyring_epoch: rawKeyring.keyring_epoch,
    jti: 'owner-intake-p35',
    issued_at_ms: nowBase - 10,
    not_before_ms: nowBase - 10,
    expires_at_ms: nowBase + 60000,
    session_id: session.session_id,
    session_challenge_hash: session.session_challenge_hash,
    host_install_binding_hash: installBindingHash,
    binding,
    binding_hash: hash(canonicalJson(binding)),
    plan_hash: hash(canonicalJson(plan)),
    ...overrides,
  };
}

function makeV2Claims(input, plan, overrides = {}) {
  const binding = trustedBindingV2(input);
  return {
    schema_version: AUTHENTICATED_INTAKE_V2_SCHEMA_VERSION,
    purpose: AUTHENTICATED_INTAKE_V2_PURPOSE,
    audience: 'autopilot-supervised-host',
    issuer: rawKeyring.issuer,
    signing_key_id: rawKeyring.keys[0].key_id,
    keyring_epoch: rawKeyring.keyring_epoch,
    jti: 'owner-intake-p35d',
    issued_at_ms: nowBase - 10,
    not_before_ms: nowBase - 10,
    expires_at_ms: nowBase + 60000,
    session_id: session.session_id,
    session_challenge_hash: session.session_challenge_hash,
    host_install_binding_hash: installBindingHash,
    binding,
    binding_hash: hash(canonicalJson(binding)),
    plan_hash: hash(canonicalJson(plan)),
    ...overrides,
  };
}

function signClaims(claims, privateKey = keyPair.privateKey) {
  const payload = Buffer.from(canonicalJson(claims), 'utf8');
  const signature = crypto.sign(
    null,
    Buffer.concat([Buffer.from(`${claims.purpose}\n`, 'utf8'), payload]),
    privateKey,
  );
  return {
    schema_version: claims.schema_version,
    protected_payload: payload.toString('base64url'),
    signature: signature.toString('base64url'),
  };
}

function config(replayStore, clock = () => nowBase, extra = {}) {
  return {
    install_binding_hash: installBindingHash,
    keyring: rawKeyring,
    max_clock_rollback_milliseconds: 0,
    max_envelope_lifetime_milliseconds: 120000,
    max_future_skew_milliseconds: 1000,
    now: clock,
    replay_store: replayStore,
    session,
    ...extra,
  };
}

const input = bridgeInput();
const plan = compileSupervisedEngineBridgeContract(input);
const envelope = signClaims(makeClaims(input, plan));
const replayStore = createInMemoryReplayStore();
const context = {
  schema_version: 1,
  intake_binding_hash: plan.intake_binding_hash,
  sink_inventory_hash: plan.sink_inventory_hash,
  bridge_abi_hash: plan.bridge_abi_hash,
  plan_hash: hash(canonicalJson(plan)),
  owner_run_id: input.ownerRunId,
  engine_run_id: input.engineRunId,
  invocation_id: input.invocationId,
};
const result = verifyHostPinnedAuthenticatedIntake(envelope, context, config(replayStore));
assert.equal(result.receipt.status, 'verified_intake');
assert.equal(result.receipt.owner_kernel_authority, 'none');
assert.equal(result.receipt.acceptance, 'not_available');
assert.equal(result.receipt.attestation_hash, normalizedKeyring.attestation_hash);
assert.equal(result.receipt.envelope_hash, hash(canonicalJson(envelope)));
assert.equal(result.receipt.replay_status, 'new');
assert.equal(JSON.stringify(result.receipt).includes(input.prompt), false);
assert.deepEqual(result.bridge_verification.binding, trustedBinding(input));

const unicodeInput = bridgeInput({ prompt: '\u8acb\u9a57\u8b49\u6b64\u7c3d\u540d intake \u7684 UTF-8 canonical bytes' });
const unicodePlan = compileSupervisedEngineBridgeContract(unicodeInput);
const unicodeEnvelope = signClaims(makeClaims(unicodeInput, unicodePlan, { jti: 'owner-intake-p35-unicode' }));
const unicodeContext = {
  schema_version: 1,
  intake_binding_hash: unicodePlan.intake_binding_hash,
  sink_inventory_hash: unicodePlan.sink_inventory_hash,
  bridge_abi_hash: unicodePlan.bridge_abi_hash,
  plan_hash: hash(canonicalJson(unicodePlan)),
  owner_run_id: unicodeInput.ownerRunId,
  engine_run_id: unicodeInput.engineRunId,
  invocation_id: unicodeInput.invocationId,
};
const unicodeBridgeReceipt = verifySupervisedEngineBridgeContract(unicodePlan, unicodeInput, unicodeEnvelope, {
  trustedIntakeVerifier: createHostPinnedTrustedIntakeVerifier(config(createInMemoryReplayStore())),
  trustedIntakeAuthority: normalizedKeyring.authority,
});
assert.equal(unicodeBridgeReceipt.verified, true);
assert.equal(canonicalJson({ bridge_input: unicodeInput }).includes(unicodeInput.prompt), true);

const second = verifyHostPinnedAuthenticatedIntake(envelope, context, config(replayStore));
assert.equal(second.receipt.replay_status, 'idempotent');
assert.equal(second.receipt.verified_at_ms, nowBase);

const bridgeReplay = createInMemoryReplayStore();
const bridgeReceipt = verifySupervisedEngineBridgeContract(plan, input, envelope, {
  trustedIntakeVerifier: createHostPinnedTrustedIntakeVerifier(config(bridgeReplay)),
  trustedIntakeAuthority: normalizedKeyring.authority,
});
assert.equal(bridgeReceipt.verified, true);
assert.equal(bridgeReceipt.key_id, rawKeyring.keyring_id);
assert.equal(bridgeReceipt.attestation_hash, normalizedKeyring.attestation_hash);

const v2Input = bridgeInputV2();
const v2Plan = compileSupervisedEngineBridgeContract(v2Input);
const v2Claims = makeV2Claims(v2Input, v2Plan);
const v2Envelope = signClaims(v2Claims);
const v2Context = {
  schema_version: AUTHENTICATED_INTAKE_V2_SCHEMA_VERSION,
  intake_binding_hash: v2Plan.intake_binding_hash,
  sink_inventory_hash: v2Plan.sink_inventory_hash,
  bridge_abi_hash: v2Plan.bridge_abi_hash,
  plan_hash: hash(canonicalJson(v2Plan)),
  owner_run_id: v2Input.ownerRunId,
  engine_run_id: v2Input.engineRunId,
  invocation_id: v2Input.invocationId,
};
const v2Result = verifyHostPinnedAuthenticatedIntake(
  v2Envelope,
  v2Context,
  config(createInMemoryReplayStore()),
);
assert.equal(v2Result.receipt.schema_version, AUTHENTICATED_INTAKE_V2_SCHEMA_VERSION);
assert.equal(v2Result.receipt.owner_kernel_authority, 'none');
assert.equal(v2Result.receipt.acceptance, 'not_available');
assert.equal(JSON.stringify(v2Result).includes('workspaceRoot'), false);
assert.equal(JSON.stringify(v2Result).includes('/private/raw-path'), false);
const v2BridgeReceipt = verifySupervisedEngineBridgeContract(v2Plan, v2Input, v2Envelope, {
  trustedIntakeVerifier: createHostPinnedTrustedIntakeVerifier(config(createInMemoryReplayStore())),
  trustedIntakeAuthority: normalizedKeyring.authority,
});
assert.equal(v2BridgeReceipt.verified, true);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(
    v2Envelope,
    { ...v2Context, schema_version: 1 },
    config(createInMemoryReplayStore()),
  ),
  /compiled bridge plan|schema_version/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(
    { ...v2Envelope, schema_version: 1 },
    v2Context,
    config(createInMemoryReplayStore()),
  ),
  /does not match protected claims/i,
);
const v2Payload = Buffer.from(canonicalJson(v2Claims), 'utf8');
const v2SignedWithV1Domain = {
  schema_version: AUTHENTICATED_INTAKE_V2_SCHEMA_VERSION,
  protected_payload: v2Payload.toString('base64url'),
  signature: crypto.sign(
    null,
    Buffer.concat([Buffer.from(`${AUTHENTICATED_INTAKE_PURPOSE}\n`, 'utf8'), v2Payload]),
    keyPair.privateKey,
  ).toString('base64url'),
};
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(
    v2SignedWithV1Domain,
    v2Context,
    config(createInMemoryReplayStore()),
  ),
  /signature/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(
    signClaims(makeV2Claims(v2Input, v2Plan, {
      binding: { ...trustedBindingV2(v2Input), workspace_ticket_hash: hash('substituted-ticket') },
      binding_hash: hash(canonicalJson({ ...trustedBindingV2(v2Input), workspace_ticket_hash: hash('substituted-ticket') })),
    })),
    v2Context,
    config(createInMemoryReplayStore()),
  ),
  /compiled bridge plan/i,
);
assert.throws(
  () => verifySupervisedEngineBridgeContract(v2Plan, v2Input, envelope, {
    trustedIntakeVerifier: createHostPinnedTrustedIntakeVerifier(config(createInMemoryReplayStore())),
    trustedIntakeAuthority: normalizedKeyring.authority,
  }),
  /protected claims|schema_version|binding/i,
);

const badSignature = `${envelope.signature.slice(0, -1)}${envelope.signature.endsWith('A') ? 'B' : 'A'}`;
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake({ ...envelope, signature: badSignature }, context, config(createInMemoryReplayStore())),
  AuthenticatedIntakeError,
);
const nonCanonicalPayload = Buffer.from(`{\"audience\":\"autopilot-supervised-host\", ${canonicalJson(makeClaims(input, plan)).slice(1)}`, 'utf8');
const nonCanonicalEnvelope = {
  schema_version: 1,
  protected_payload: nonCanonicalPayload.toString('base64url'),
  signature: crypto.sign(null, Buffer.concat([Buffer.from(`${AUTHENTICATED_INTAKE_PURPOSE}\n`), nonCanonicalPayload]), keyPair.privateKey).toString('base64url'),
};
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(nonCanonicalEnvelope, context, config(createInMemoryReplayStore())),
  /canonical JSON/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { signing_key_id: 'unknown-key' })), context, config(createInMemoryReplayStore())),
  /keyring/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { expires_at_ms: nowBase })), context, config(createInMemoryReplayStore())),
  /expired/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { not_before_ms: nowBase + 2000, issued_at_ms: nowBase + 2000 })), context, config(createInMemoryReplayStore())),
  /not active/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { expires_at_ms: nowBase + 130000 })), context, config(createInMemoryReplayStore())),
  /lifetime/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { session_challenge_hash: hash('wrong') })), context, config(createInMemoryReplayStore())),
  /host session/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { host_install_binding_hash: hash('other-install') })), context, config(createInMemoryReplayStore())),
  /host installation/i,
);
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(makeClaims(input, plan, { plan_hash: hash('different-plan') })), context, config(createInMemoryReplayStore())),
  /compiled bridge plan/i,
);
const conflicting = signClaims(makeClaims(input, plan, {
  issued_at_ms: nowBase - 9,
  not_before_ms: nowBase - 9,
}));
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(conflicting, context, config(replayStore)),
  /conflicts/i,
);
const rollbackStore = createInMemoryReplayStore();
verifyHostPinnedAuthenticatedIntake(envelope, context, config(rollbackStore));
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(
    signClaims(makeClaims(input, plan, { jti: 'owner-intake-clock-rollback' })),
    context,
    config(rollbackStore, () => nowBase - 1),
  ),
  /clock moved backwards/i,
);

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-p35-intake-'));
const replayDirectory = path.join(temporary, 'replay');
fs.mkdirSync(replayDirectory, { mode: 0o700 });
fs.chmodSync(temporary, 0o700);
const fileStore = createFileReplayStore({ state_directory: temporary });
const fileFirst = verifyHostPinnedAuthenticatedIntake(envelope, context, config(fileStore));
const fileSecond = verifyHostPinnedAuthenticatedIntake(envelope, context, config(fileStore));
assert.equal(fileFirst.receipt.replay_status, 'new');
assert.equal(fileSecond.receipt.replay_status, 'idempotent');
const pendingClaims = makeClaims(input, plan, { jti: 'owner-intake-pending' });
const pendingPath = path.join(replayDirectory, `${hash(`${pendingClaims.issuer}\u0000${pendingClaims.jti}`)}.json`);
fs.writeFileSync(pendingPath, canonicalJson({
  schema_version: 1,
  state: 'pending',
  fingerprint: hash('pending'),
  receipt: null,
}), { mode: 0o600 });
assert.throws(
  () => verifyHostPinnedAuthenticatedIntake(signClaims(pendingClaims), context, config(fileStore)),
  /incomplete/i,
);
fs.rmSync(temporary, { recursive: true, force: true });

console.log('ed25519_signature_and_p33_adapter=true');
console.log('canonical_payload_and_pinned_keyring=true');
console.log('unicode_p33_binding_and_canonical_bytes=true');
console.log('session_install_plan_and_binding_bound=true');
console.log('expiry_not_before_ttl_and_clock_rollback_fail_closed=true');
console.log('durable_replay_idempotence_conflict_and_pending_fail_closed=true');
console.log('shadow_receipt_has_no_authority=true');
console.log('descriptor_bound_v2_domain_replay_and_ticket_binding=true');
NODE
)"
STATUS=$?

assert_eq "$STATUS" "0" "authenticated intake verifier fixture exits successfully"
assert_contains "$OUT" "ed25519_signature_and_p33_adapter=true" "real Ed25519 verification feeds the P3.3 adapter"
assert_contains "$OUT" "canonical_payload_and_pinned_keyring=true" "canonical payload and root-pinned keyring are enforced"
assert_contains "$OUT" "unicode_p33_binding_and_canonical_bytes=true" "UTF-8 prompt bytes remain valid through the signed P3.3 binding"
assert_contains "$OUT" "session_install_plan_and_binding_bound=true" "session install and exact bridge bindings are signed"
assert_contains "$OUT" "expiry_not_before_ttl_and_clock_rollback_fail_closed=true" "time-window and clock rollback controls fail closed"
assert_contains "$OUT" "durable_replay_idempotence_conflict_and_pending_fail_closed=true" "replay storage is durable and conflict-safe"
assert_contains "$OUT" "shadow_receipt_has_no_authority=true" "verified intake remains non-authoritative"
assert_contains "$OUT" "descriptor_bound_v2_domain_replay_and_ticket_binding=true" "v2 envelope domain and root ticket commitment reject cross-version substitution"

finalize_test
