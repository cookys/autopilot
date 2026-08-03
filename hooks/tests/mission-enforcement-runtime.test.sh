#!/usr/bin/env bash
# Mission P2 — enforcement and publication runtime oracle (RED).
#
# This oracle freezes the enforcement/publication behavior Mission P2 must add
# on top of the shipped P1 reducer, the P0 Codex enforcement disposition, and
# the current-Codex capability record. It is a verification artifact: it does
# NOT modify product code, and it never treats an unknown command, a usage
# message, a missing file, or a generic nonzero exit as a passing P2 behavior.
#
# Groups 1/3/4/5 exercise REAL existing exports (recorded P0 disposition,
# capability record, pure reducer, projection). Groups 2/6 plus the canonical
# P2 export assertions freeze the exact enforcement/publication surface that
# does not exist yet, so this file exits nonzero on current HEAD for explicit
# missing-P2 acceptance. Dependent subcases are skipped; every independent
# group still runs.
. "$(dirname "$0")/lib.sh"

ARTIFACT="$REPO_ROOT/docs/projects/_archive/2026-07-26-mission-convergence-portfolio/mission-p0-codex-enforcement.json"
CAPABILITY="$REPO_ROOT/src/harness/capabilities/codex.json"
assert_file_exists "$ARTIFACT" "recorded P0 Codex enforcement disposition exists"
assert_file_exists "$CAPABILITY" "current-Codex capability record exists"

# ─── Anti-cheating: these oracles must be regular files, never symlinks ─────
ANTI_CHEAT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const targets = [
  path.join(root, 'hooks', 'tests', 'mission-icc-runtime.test.sh'),
  path.join(root, 'hooks', 'tests', 'mission-enforcement-runtime.test.sh'),
];
for (const target of targets) {
  let stat;
  try { stat = fs.lstatSync(target); } catch { continue; }
  if (stat.isSymbolicLink()) {
    console.log(`symlink ${path.basename(target)}`);
    process.exitCode = 1;
  }
}
console.log('anti-cheat-checked');
NODE
)"
assert_exit_code "$?" "0" "oracle files are regular files (lstat, never follow symlinks)"
assert_contains "$ANTI_CHEAT" "anti-cheat-checked" "lstat anti-cheat sweep ran"
assert_not_contains "$ANTI_CHEAT" "symlink " "no oracle is a symlink"

OUT="$(node - "$REPO_ROOT" "$ARTIFACT" "$CAPABILITY" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const [root, artifactPath, capabilityPath] = process.argv.slice(2);

const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
const engine = require(path.join(root, 'src', 'engine'));
const missionCli = require(path.join(root, 'src', 'mission', 'cli'));

const lines = [];
function check(id, cond) { lines.push(`${id}\t${cond ? 'PASS' : 'FAIL'}`); }
function group(name, fn) {
  try { fn(); } catch (error) {
    lines.push(`${name}\tFAIL\tthrew ${error && error.code ? error.code : error}`);
  }
}
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

// Shared reducer fixtures (mirror the frozen P1 integration oracle shapes).
function makeContract(over = {}) {
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: 'mission-v1-' + m.sha256('test'),
    repo_identity: 'r',
    mission_lineage_id: 'lineage-v1-' + m.sha256('L'),
    task_authority_id: m.sha256('TA'),
    policy_hash: m.sha256('P'),
    enforcement_mode: 'shadow',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: {
      campaigns: { authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      wall_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      tool_calls: { authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      engine_attempts: { authorized_ceiling: 50, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      external_wait_seconds: { authorized_ceiling: 1000, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      canonical_changed_files: { authorized_ceiling: 10, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
      output_bytes: { authorized_ceiling: 1024, reserved_active: 0, durable_consumed: 0, known: true, enforced: true },
    },
    grant_contract: { idempotency_key_required: true, single_use: true, expiry_seconds: 3600, bindings: ['mission_lineage_id', 'task_authority_id', 'campaign_id', 'campaign_contract_digest', 'base_sha', 'acceptance_ids'] },
    control_contract: { actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'], allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'], ceiling_loosen_authority: 'authenticated_user' },
    lineage_binding: { task_authority_id: m.sha256('TA'), root_run_id: 'root-1', policy_hash: m.sha256('P'), successor_inherits_durable_consumed: true },
    ...over,
  };
}
function reservation(state, reserved) {
  return {
    per_axis: m.SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? reserved : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  };
}
function claimEvent(state, opts) {
  return {
    event_type: 'grant_claimed',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: {
      idempotency_key: opts.idempotency_key,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      campaign_id: opts.campaign_id || 'c1',
      campaign_contract_digest: m.sha256('P'),
      base_sha: '0000000000000000000000000000000000000000',
      acceptance_ids: ['acc-1'],
      reservation: reservation(state, opts.reserved || 5),
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  };
}
function controlEvent(state, canonical) {
  return {
    event_type: 'control_event',
    sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { event: canonical },
  };
}
function mintControl(adapter, lineage, action, sequence) {
  return adapter.acceptEvent({
    mission_lineage_id: lineage,
    action,
    authority: 'authenticated_user',
    sequence,
    issued_at: '2026-07-27T00:00:00.000Z',
    reason: 'oracle',
  });
}

// ── Group 1: validate the ACTUAL recorded P0 disposition schema, digest, and
// binding; then evaluate enforcement disposition through the canonical export.
group('g1', () => {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
  check('g1-disposition-schema', artifact.schema_version === 1
    && artifact.artifact_type === 'codex_enforcement_probe');
  const allowed = new Set(['block-capable', 'wrapper-required', 'unenforceable-now']);
  check('g1-outcome-enum', allowed.has(artifact.codex_enforcement_outcome));
  check('g1-outcome-block-capable', artifact.codex_enforcement_outcome === 'block-capable');
  check('g1-evidence-blocked-not-created', artifact.evidence
    && artifact.evidence.hook_invoked === true
    && artifact.evidence.request_bound === true
    && artifact.evidence.blocked_target_created === false);
  check('g1-execution-digests-bound', artifact.evidence
    && isHex64(artifact.evidence.stdout_sha256)
    && isHex64(artifact.evidence.stderr_sha256));
  check('g1-capability-binding', capability.id === 'codex'
    && capability.capabilities
    && new Set(['verified', 'warning', 'unverified']).has(capability.capabilities.blocking_gate));
  const artifactDigest = m.sha256(artifact);
  check('p2-capability-probe-digest-bound',
    capability.mission_enforcement_probe_digest === artifactDigest);

  // Canonical P2 export: evaluateCodexEnforcementDisposition
  const evaluate = engine.evaluateCodexEnforcementDisposition;
  check('p2-evaluate-codex-enforcement-disposition-present', typeof evaluate === 'function');
  if (typeof evaluate === 'function') {
    // block-capable and wrapper-required may enforce
    const blockResult = evaluate({
      artifact, capability, expected_harness_id: 'codex',
    });
    check('p2-disposition-block-capable-may-enforce', blockResult
      && blockResult.enforceable === true && isHex64(blockResult.receipt_digest));
    const wrapperArtifact = { ...artifact, codex_enforcement_outcome: 'wrapper-required' };
    const wrapperCapability = {
      ...capability,
      mission_enforcement_probe_digest: m.sha256(wrapperArtifact),
    };
    const wrapperResult = evaluate({
      artifact: wrapperArtifact,
      capability: wrapperCapability,
      expected_harness_id: 'codex',
    });
    check('p2-disposition-wrapper-required-may-enforce',
      wrapperResult && wrapperResult.enforceable === true);
    // unenforceable-now may NOT enforce
    const unenforceable = { ...artifact, codex_enforcement_outcome: 'unenforceable-now' };
    const unenforceableCapability = {
      ...capability,
      mission_enforcement_probe_digest: m.sha256(unenforceable),
    };
    const unResult = evaluate({
      artifact: unenforceable,
      capability: unenforceableCapability,
      expected_harness_id: 'codex',
    });
    check('p2-disposition-unenforceable-denied',
      unResult && unResult.enforceable === false);
    // malformed artifact may NOT enforce
    const malformedArtifact = { schema_version: 99 };
    const malformedResult = evaluate({
      artifact: malformedArtifact,
      capability: {
        ...capability,
        mission_enforcement_probe_digest: m.sha256(malformedArtifact),
      },
      expected_harness_id: 'codex',
    });
    check('p2-disposition-malformed-denied',
      malformedResult && malformedResult.enforceable === false);
    // digest mismatch may NOT enforce
    const digestMismatch = { ...artifact, evidence: { ...artifact.evidence, stdout_sha256: '0'.repeat(64) } };
    const digestResult = evaluate({
      artifact: digestMismatch,
      capability,
      expected_harness_id: 'codex',
    });
    check('p2-disposition-digest-mismatch-denied',
      digestResult && digestResult.enforceable === false);
    // identity mismatch may NOT enforce
    const identityMismatchCap = { ...capability, id: 'not-codex' };
    const identityResult = evaluate({
      artifact,
      capability: identityMismatchCap,
      expected_harness_id: 'codex',
    });
    check('p2-disposition-identity-mismatch-denied',
      identityResult && identityResult.enforceable === false);
    // unsupported harness may NOT enforce
    const unsupportedCap = { ...capability, harness_level: 'H0' };
    const unsupportedResult = evaluate({
      artifact,
      capability: unsupportedCap,
      expected_harness_id: 'codex',
    });
    check('p2-disposition-unsupported-harness-denied',
      unsupportedResult && unsupportedResult.enforceable === false);
  } else {
    lines.push('p2-disposition-block-capable-may-enforce\tSKIP');
    lines.push('p2-disposition-wrapper-required-may-enforce\tSKIP');
    lines.push('p2-disposition-unenforceable-denied\tSKIP');
    lines.push('p2-disposition-malformed-denied\tSKIP');
    lines.push('p2-disposition-digest-mismatch-denied\tSKIP');
    lines.push('p2-disposition-identity-mismatch-denied\tSKIP');
    lines.push('p2-disposition-unsupported-harness-denied\tSKIP');
  }
});

// ── Group 2: the verified Mission grant must enable the P0-selected
// current-Codex blocking adapter via createCodexMissionEnforcementAdapter.
// The adapter must bind verified claim, lineage, control sequence, P0
// disposition digest, and request identity; mismatches block before effect.
group('g2', () => {
  const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  check('g2-capability-notes-pending-binding', Array.isArray(capability.notes)
    && capability.notes.some((n) => /P2 must still bind Mission identity/.test(n)));

  const createAdapter = engine.createCodexMissionEnforcementAdapter;
  check('p2-codex-mission-enforcement-adapter-present', typeof createAdapter === 'function');
  const evaluate = engine.evaluateCodexEnforcementDisposition;
  if (typeof createAdapter === 'function' && typeof evaluate === 'function') {
    const missionState = m.createMissionState(makeContract({ enforcement_mode: 'enforce' }));
    const claimed = m.reduceMissionState(
      missionState,
      claimEvent(missionState, { idempotency_key: 'codex-g2', campaign_id: 'codex-g2' }),
    );
    const dispositionReceipt = evaluate({
      artifact, capability, expected_harness_id: 'codex',
    });
    const binding = {
      mission_state: claimed.state,
      grant_receipt: claimed.receipt,
      disposition_receipt: dispositionReceipt,
      request_identity: 'codex',
    };
    const adapter = createAdapter(binding);
    check('p2-adapter-returns-object', adapter !== null && typeof adapter === 'object');

    // Correct binding passes through to the injected effect
    const effectCalls = [];
    const effect = () => { effectCalls.push('ran'); return { blocked: false }; };
    const validRequest = {
      claim_id: claimed.receipt.claim_id,
      mission_lineage_id: claimed.state.mission_lineage_id,
      control_sequence: claimed.state.control_sequence,
      disposition_digest: dispositionReceipt.receipt_digest,
      request_identity: 'codex',
    };
    if (typeof adapter.enforce === 'function') {
      adapter.enforce(validRequest, effect);
      check('p2-adapter-valid-request-effect-runs', effectCalls.length === 1);
    } else if (typeof adapter.evaluate === 'function') {
      adapter.evaluate(validRequest, effect);
      check('p2-adapter-valid-request-effect-runs', effectCalls.length === 1);
    } else {
      check('p2-adapter-valid-request-effect-runs', false);
    }

    // Mismatched lineage blocks BEFORE the injected effect
    const mismatchCalls = [];
    const mismatchEffect = () => { mismatchCalls.push('ran'); return { blocked: false }; };
    const badLineage = { ...validRequest, mission_lineage_id: 'wrong-lineage' };
    if (typeof adapter.enforce === 'function') {
      adapter.enforce(badLineage, mismatchEffect);
    } else if (typeof adapter.evaluate === 'function') {
      adapter.evaluate(badLineage, mismatchEffect);
    }
    check('p2-adapter-lineage-mismatch-blocks-before-effect', mismatchCalls.length === 0);

    // Mismatched control sequence blocks before effect
    const seqCalls = [];
    const seqEffect = () => { seqCalls.push('ran'); };
    const badSeq = { ...validRequest, control_sequence: 999 };
    if (typeof adapter.enforce === 'function') {
      adapter.enforce(badSeq, seqEffect);
    } else if (typeof adapter.evaluate === 'function') {
      adapter.evaluate(badSeq, seqEffect);
    }
    check('p2-adapter-sequence-mismatch-blocks-before-effect', seqCalls.length === 0);

    // Mismatched disposition digest blocks before effect
    const digCalls = [];
    const digEffect = () => { digCalls.push('ran'); };
    const badDigest = { ...validRequest, disposition_digest: 'f'.repeat(64) };
    if (typeof adapter.enforce === 'function') {
      adapter.enforce(badDigest, digEffect);
    } else if (typeof adapter.evaluate === 'function') {
      adapter.evaluate(badDigest, digEffect);
    }
    check('p2-adapter-digest-mismatch-blocks-before-effect', digCalls.length === 0);

    // Mismatched request identity blocks before effect
    const idCalls = [];
    const idEffect = () => { idCalls.push('ran'); };
    const badIdentity = { ...validRequest, request_identity: 'not-codex' };
    if (typeof adapter.enforce === 'function') {
      adapter.enforce(badIdentity, idEffect);
    } else if (typeof adapter.evaluate === 'function') {
      adapter.evaluate(badIdentity, idEffect);
    }
    check('p2-adapter-identity-mismatch-blocks-before-effect', idCalls.length === 0);

    // Exact effect-call counts: only the single valid request ran the effect
    check('p2-adapter-exact-effect-call-count', effectCalls.length === 1
      && mismatchCalls.length === 0 && seqCalls.length === 0
      && digCalls.length === 0 && idCalls.length === 0);

    const forgedDisposition = {
      ...dispositionReceipt,
      receipt_digest: m.sha256('caller-forged-disposition'),
    };
    let forgedDispositionRejected = false;
    try {
      const forgedAdapter = createAdapter({
        ...binding,
        disposition_receipt: forgedDisposition,
      });
      forgedDispositionRejected = !forgedAdapter
        || forgedAdapter.rejected === true
        || typeof forgedAdapter.enforce !== 'function';
    } catch (_error) { forgedDispositionRejected = true; }
    check('p2-adapter-forged-disposition-rejected', forgedDispositionRejected);

    // A genuine disposition must be identity-attested, not tagged with a
    // reflectable own Symbol that a caller can copy onto another object.
    const dispositionSymbols = Object.getOwnPropertySymbols(dispositionReceipt);
    check('p2-disposition-has-no-reflectable-attestation-symbol',
      dispositionSymbols.length === 0);
    let reflectedCloneRejected = false;
    try {
      const reflectedClone = Object.create(
        Object.getPrototypeOf(dispositionReceipt),
        Object.getOwnPropertyDescriptors(dispositionReceipt),
      );
      const reflectedAdapter = createAdapter({
        ...binding,
        disposition_receipt: reflectedClone,
      });
      reflectedCloneRejected = !reflectedAdapter
        || reflectedAdapter.rejected === true
        || typeof reflectedAdapter.enforce !== 'function';
    } catch (_error) { reflectedCloneRejected = true; }
    check('p2-adapter-reflected-disposition-clone-rejected', reflectedCloneRejected);

    // The caller must not choose the identity to which a genuine Codex
    // disposition is bound. It is derived from the attested harness receipt.
    const attackerAdapter = createAdapter({
      ...binding,
      request_identity: 'attacker-controlled',
    });
    const attackerCalls = [];
    if (attackerAdapter && typeof attackerAdapter.enforce === 'function') {
      attackerAdapter.enforce({
        ...validRequest,
        request_identity: 'attacker-controlled',
      }, () => { attackerCalls.push('ran'); });
    }
    check('p2-adapter-caller-cannot-select-request-identity',
      attackerCalls.length === 0);

    const forgedGrant = {
      ...claimed.receipt,
      binding_digest: m.sha256('caller-forged-grant'),
    };
    let forgedGrantRejected = false;
    try {
      const forgedAdapter = createAdapter({
        ...binding,
        grant_receipt: forgedGrant,
      });
      forgedGrantRejected = !forgedAdapter
        || forgedAdapter.rejected === true
        || typeof forgedAdapter.enforce !== 'function';
    } catch (_error) { forgedGrantRejected = true; }
    check('p2-adapter-forged-grant-rejected', forgedGrantRejected);
  } else {
    lines.push('p2-adapter-returns-object\tSKIP');
    lines.push('p2-adapter-valid-request-effect-runs\tSKIP');
    lines.push('p2-adapter-lineage-mismatch-blocks-before-effect\tSKIP');
    lines.push('p2-adapter-sequence-mismatch-blocks-before-effect\tSKIP');
    lines.push('p2-adapter-digest-mismatch-blocks-before-effect\tSKIP');
    lines.push('p2-adapter-identity-mismatch-blocks-before-effect\tSKIP');
    lines.push('p2-adapter-exact-effect-call-count\tSKIP');
    lines.push('p2-adapter-forged-disposition-rejected\tSKIP');
    lines.push('p2-disposition-has-no-reflectable-attestation-symbol\tSKIP');
    lines.push('p2-adapter-reflected-disposition-clone-rejected\tSKIP');
    lines.push('p2-adapter-caller-cannot-select-request-identity\tSKIP');
    lines.push('p2-adapter-forged-grant-rejected\tSKIP');
  }
});

// ── Group 3: authenticated finish/scope/abort fence stale control with zero
// runner/worktree/reviewer effect at the reducer; the closure allowlist is the
// fixed effect-class set and a new grant after a closing control is rejected.
group('g3', () => {
  const adapter = new ac.AuthenticatedControlAdapter({
    verifier: () => ({ verified: true, authority: 'authenticated_user' }),
  });
  const sFin = m.createMissionState(makeContract());
  const fin = m.reduceMissionState(sFin, controlEvent(sFin, mintControl(adapter, sFin.mission_lineage_id, 'finish_requested', 7)));
  check('g3-finish-closing', fin.state.state === 'CLOSING' && fin.state.control_sequence === 7);
  check('g3-finish-no-terminal', !fin.state.terminal);
  const sScope = m.createMissionState(makeContract());
  const scope = m.reduceMissionState(sScope, controlEvent(sScope, mintControl(adapter, sScope.mission_lineage_id, 'scope_frozen', 4)));
  check('g3-scope-closing', scope.state.state === 'CLOSING' && scope.state.control_sequence === 4);
  const sAbort = m.createMissionState(makeContract());
  const abort = m.reduceMissionState(sAbort, controlEvent(sAbort, mintControl(adapter, sAbort.mission_lineage_id, 'abort_requested', 2)));
  // ABORTING is intermediate (not TERMINAL_STATES); control_sequence advances once.
  check('g3-abort-terminal', abort.state.state === 'ABORTING'
    && !abort.state.terminal
    && abort.state.control_sequence === 2);
  const stale = m.reduceMissionState(fin.state, controlEvent(fin.state, mintControl(adapter, fin.state.mission_lineage_id, 'finish_requested', 3)));
  check('g3-stale-fenced', stale.receipt.reason === 'control_sequence_stale'
    && stale.receipt.next_state === 'CLOSING');
  const postClaim = m.reduceMissionState(fin.state, claimEvent(fin.state, { idempotency_key: 'post-finish', campaign_id: 'c-late' }));
  check('g3-post-control-claim-rejected', postClaim.receipt.artifact_type === 'mission_grant_rejected'
    && postClaim.receipt.reason === 'effect_class_not_allowlisted');
  check('g3-closure-allowlist-fixed', m.CLOSURE_ALLOWLIST.join(',') ===
    'frozen_acceptance,blocker_repair,targeted_verification,required_docs_version,receipt_production');
});

// ── Group 4: shadow rollback never blocks the injected live effect and
// preserves exact requested/remaining would-block evidence; enforce blocks the
// identical request and creates no claim.
group('g4', () => {
  const overReservation = (state) => ({
    per_axis: m.SUPPORTED_AXES.map((axisName) => ({
      axis: axisName,
      authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? 200 : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed,
      known: true,
    })),
  });
  const sShadow = m.createMissionState(makeContract());
  const sh = m.reduceMissionState(sShadow, {
    event_type: 'grant_claimed', sequence: 1, mission_lineage_id: sShadow.mission_lineage_id,
    payload: {
      idempotency_key: 'shadow-over', mission_lineage_id: sShadow.mission_lineage_id,
      task_authority_id: sShadow.task_authority_id, campaign_id: 'c1',
      campaign_contract_digest: sShadow.policy_hash,
      base_sha: '0000000000000000000000000000000000000000', acceptance_ids: ['acc-1'],
      reservation: overReservation(sShadow),
      issued_at: '2026-07-27T00:00:00.000Z', expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  check('g4-shadow-does-not-block', sh.state.state === 'DRAFT' && !sh.state.terminal);
  const shadowClaim = sh.receipt.claim_id ? sh.state.claims[sh.receipt.claim_id] : null;
  check('g4-shadow-live-effect-granted', !!shadowClaim && shadowClaim.shadow_would_block === true);
  check('g4-shadow-evidence-exact', sh.receipt.evidence
    && sh.receipt.evidence.axis === 'tool_calls'
    && sh.receipt.evidence.requested === 200
    && typeof sh.receipt.evidence.remaining_before === 'number'
    && typeof sh.receipt.evidence.remaining_after === 'number');
  const sEnforce = m.createMissionState(makeContract({ enforcement_mode: 'enforce' }));
  const ef = m.reduceMissionState(sEnforce, {
    event_type: 'grant_claimed', sequence: 1, mission_lineage_id: sEnforce.mission_lineage_id,
    payload: {
      idempotency_key: 'enforce-over', mission_lineage_id: sEnforce.mission_lineage_id,
      task_authority_id: sEnforce.task_authority_id, campaign_id: 'c1',
      campaign_contract_digest: sEnforce.policy_hash,
      base_sha: '0000000000000000000000000000000000000000', acceptance_ids: ['acc-1'],
      reservation: overReservation(sEnforce),
      issued_at: '2026-07-27T00:00:00.000Z', expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  check('g4-enforce-blocks-identical', ef.state.state === 'BLOCKED'
    && ef.state.terminal && ef.state.terminal.reason === 'resource_ceiling');
  check('g4-enforce-creates-no-claim', Object.keys(ef.state.claims).length === 0);
});

// ── Group 5: a reducer-driven two-campaign path using real valid events reaches
// a terminal state; the projection reflects the terminal without any
// can_close / can_merge / DONE task-closeout claim.
group('g5', () => {
  let state = m.createMissionState(makeContract());
  const accHash = m.sha256('acceptance-1');
  const driveCampaign = (campaignId, key) => {
    const claimed = m.reduceMissionState(state, claimEvent(state, { idempotency_key: key, campaign_id: campaignId, reserved: 5 }));
    state = claimed.state;
    const claimId = claimed.receipt.claim_id;
    const accepted = m.reduceMissionState(state, {
      event_type: 'acceptance_satisfied', sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id, payload: { acceptance_hash: accHash },
    });
    state = accepted.state;
    const actualUsage = { per_axis: m.SUPPORTED_AXES.map((axisName) => ({
      axis: axisName, authorized_ceiling: state.axes[axisName].authorized_ceiling,
      reserved_active: axisName === 'tool_calls' ? 5 : (axisName === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axisName].durable_consumed, known: true,
    })) };
    const reconciled = m.reduceMissionState(state, {
      event_type: 'reconciliation', sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id, payload: { claim_id: claimId, actual_usage: actualUsage },
    });
    state = reconciled.state;
  };
  driveCampaign('c1', 'two-camp-1');
  driveCampaign('c2', 'two-camp-2');
  const closure = m.reduceMissionState(state, {
    event_type: 'closure_evaluated', sequence: state.events.length + 1,
    mission_lineage_id: state.mission_lineage_id,
    payload: { ratio: 0.9, other_axes_below_ratio: false, unknown_required_axis: false },
  });
  state = closure.state;
  check('g5-two-campaigns-terminal-complete', state.state === 'COMPLETE'
    && state.terminal && state.terminal.reason === 'closure_evaluated');
  const terminalSerialized = JSON.stringify(state.terminal);
  check('g5-terminal-no-task-closeout', !/can_close|can_merge/.test(terminalSerialized)
    && !/"state"\s*:\s*"DONE"/.test(terminalSerialized));

  // Nonterminal buildProjection must explicitly expose mission_terminal=false.
  const freshState = m.createMissionState(makeContract());
  const projection = m.buildProjection(freshState);
  const hasNonterminalFlag = Object.prototype.hasOwnProperty.call(projection, 'mission_terminal')
    && projection.mission_terminal === false;
  check('p2-nonterminal-projection-mission-terminal-false', hasNonterminalFlag);

  // Canonical P2 export: buildMissionTerminalReceipt
  const buildReceipt = engine.buildMissionTerminalReceipt;
  check('p2-build-mission-terminal-receipt-present', typeof buildReceipt === 'function');
  if (typeof buildReceipt === 'function') {
    const residuePayload = { lifecycle_residue: ['sibling-campaign-1'] };
    const residue = {
      ...residuePayload,
      residue_digest: m.sha256(residuePayload),
    };
    const receipt = buildReceipt(state, residue);
    check('p2-terminal-receipt-mission-terminal-true', receipt
      && receipt.mission_terminal === true);
    check('p2-terminal-receipt-no-task-closeout', receipt
      && !/can_close|can_merge/.test(JSON.stringify(receipt))
      && !/"state"\s*:\s*"DONE"/.test(JSON.stringify(receipt)));
    check('p2-terminal-receipt-schema-version', receipt
      && receipt.schema_version === 1);
    check('p2-terminal-receipt-digests', receipt
      && isHex64(receipt.state_digest || receipt.terminal_digest));
    check('p2-terminal-receipt-residue-binding', receipt
      && (receipt.residue_digest === residue.residue_digest
        || (receipt.residue && receipt.residue.residue_digest === residue.residue_digest)));
    let tamperedResidueRejected = false;
    try {
      const result = buildReceipt(state, {
        ...residue,
        lifecycle_residue: ['different-sibling'],
      });
      tamperedResidueRejected = !result || result.rejected === true;
    } catch (_error) { tamperedResidueRejected = true; }
    check('p2-terminal-receipt-tampered-residue-rejected', tamperedResidueRejected);
  } else {
    lines.push('p2-terminal-receipt-mission-terminal-true\tSKIP');
    lines.push('p2-terminal-receipt-no-task-closeout\tSKIP');
    lines.push('p2-terminal-receipt-schema-version\tSKIP');
    lines.push('p2-terminal-receipt-digests\tSKIP');
    lines.push('p2-terminal-receipt-residue-binding\tSKIP');
    lines.push('p2-terminal-receipt-tampered-residue-rejected\tSKIP');
  }
});

// ── Group 6: fenceMissionEffect and recordMissionClosureEffect — the pre-effect
// stale fence proves zero runner/worktree/reviewer effect for stale dispatches;
// the closure recorder accepts allowlisted effects and rejects stale/non-listed.
group('g6', () => {
  const fence = engine.fenceMissionEffect;
  check('p2-fence-mission-effect-present', typeof fence === 'function');
  if (typeof fence === 'function') {
    const auth = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const controlled = (action, sequence) => {
      const initial = m.createMissionState(makeContract());
      return m.reduceMissionState(
        initial,
        controlEvent(initial, mintControl(
          auth,
          initial.mission_lineage_id,
          action,
          sequence,
        )),
      );
    };
    const finish = controlled('finish_requested', 7);
    const scope = controlled('scope_frozen', 4);
    const abort = controlled('abort_requested', 9);
    const runnerCalls = [];
    const worktreeCalls = [];
    const reviewerCalls = [];
    const effects = {
      runner: () => { runnerCalls.push('ran'); },
      worktree: () => { worktreeCalls.push('ran'); },
      reviewer: () => { reviewerCalls.push('ran'); },
    };
    fence({
      mission_state: finish.state,
      control_receipt: finish.receipt,
      request: {
        control_sequence: 2,
        effect_class: 'targeted_verification',
        effect_kind: 'runner',
      },
      effects,
    });
    check('p2-fence-stale-finish-zero-effects', runnerCalls.length === 0
      && worktreeCalls.length === 0 && reviewerCalls.length === 0);
    fence({
      mission_state: scope.state,
      control_receipt: scope.receipt,
      request: {
        control_sequence: 1,
        effect_class: 'targeted_verification',
        effect_kind: 'worktree',
      },
      effects,
    });
    check('p2-fence-stale-scope-zero-effects', runnerCalls.length === 0
      && worktreeCalls.length === 0 && reviewerCalls.length === 0);
    fence({
      mission_state: abort.state,
      control_receipt: abort.receipt,
      request: {
        control_sequence: 3,
        effect_class: 'targeted_verification',
        effect_kind: 'reviewer',
      },
      effects,
    });
    check('p2-fence-stale-abort-zero-effects', runnerCalls.length === 0
      && worktreeCalls.length === 0 && reviewerCalls.length === 0);
    const current = fence({
      mission_state: finish.state,
      control_receipt: finish.receipt,
      request: {
        control_sequence: 7,
        effect_class: 'targeted_verification',
        effect_kind: 'runner',
      },
      effects,
    });
    check('p2-fence-current-effect-runs', current && current.permitted === true
      && runnerCalls.length === 1 && worktreeCalls.length === 0
      && reviewerCalls.length === 0);
  } else {
    lines.push('p2-fence-stale-finish-zero-effects\tSKIP');
    lines.push('p2-fence-stale-scope-zero-effects\tSKIP');
    lines.push('p2-fence-stale-abort-zero-effects\tSKIP');
    lines.push('p2-fence-current-effect-runs\tSKIP');
  }

  const record = engine.recordMissionClosureEffect;
  check('p2-record-mission-closure-effect-present', typeof record === 'function');
  if (typeof record === 'function') {
    const auth = new ac.AuthenticatedControlAdapter({
      verifier: () => ({ verified: true, authority: 'authenticated_user' }),
    });
    const initial = m.createMissionState(makeContract());
    const finish = m.reduceMissionState(
      initial,
      controlEvent(initial, mintControl(
        auth,
        initial.mission_lineage_id,
        'finish_requested',
        7,
      )),
    );
    const allowlisted = {
      effect_class: 'frozen_acceptance',
      control_sequence: 7,
      evidence_ref_digest: m.sha256('closure-evidence'),
    };
    const receipt = record(finish.state, allowlisted);
    check('p2-closure-allowlisted-effect-accepted', receipt !== null
      && typeof receipt === 'object'
      && receipt.effect_class === 'frozen_acceptance');
    check('p2-closure-receipt-content-bound', receipt
      && isHex64(receipt.receipt_digest || receipt.content_digest)
      && receipt.evidence_ref_digest === allowlisted.evidence_ref_digest
      && receipt.mission_state_hash === m.stateHash(finish.state));
    // Rejects a stale effect
    let staleRejected = false;
    try {
      const staleResult = record(finish.state, {
        ...allowlisted,
        control_sequence: 2,
      });
      staleRejected = staleResult === null || staleResult === false
        || (staleResult && staleResult.rejected === true);
    } catch (e) { staleRejected = true; }
    check('p2-closure-stale-effect-rejected', staleRejected);
    // Rejects a non-allowlisted effect class
    let nonListedRejected = false;
    try {
      const nonListedResult = record(finish.state, {
        ...allowlisted,
        effect_class: 'arbitrary_spawn',
      });
      nonListedRejected = nonListedResult === null || nonListedResult === false
        || (nonListedResult && nonListedResult.rejected === true);
    } catch (e) { nonListedRejected = true; }
    check('p2-closure-non-allowlisted-rejected', nonListedRejected);
  } else {
    lines.push('p2-closure-allowlisted-effect-accepted\tSKIP');
    lines.push('p2-closure-receipt-content-bound\tSKIP');
    lines.push('p2-closure-stale-effect-rejected\tSKIP');
    lines.push('p2-closure-non-allowlisted-rejected\tSKIP');
  }
});

// ── Group 7: the machine CLI must never mint its own authenticated-user
// authority. Control requires a host-injected, already authenticated adapter;
// without one the command fails before persisting state.
group('g7', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-p2-cli-control-'));
  const statePath = path.join(dir, 'state.json');
  const outPath = path.join(dir, 'next.json');
  const state = m.createMissionState(makeContract({ enforcement_mode: 'enforce' }));
  fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  let stdout = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    stdout += String(chunk);
    return true;
  };
  let code;
  try {
    code = missionCli.runMissionCli([
      'control',
      '--state', statePath,
      '--out', outPath,
      '--action', 'finish_requested',
      '--sequence', '1',
      '--authority', 'authenticated_user',
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  let payload = null;
  try { payload = JSON.parse(stdout); } catch (_error) { payload = null; }
  check('p2-cli-control-without-host-auth-rejected',
    code === 1
      && !fs.existsSync(outPath)
      && payload
      && payload.status === 'rejected'
      && payload.code === 'mission_control_authentication_required');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Group 8: abort finalization CLI — reducer transition, fail-closed write,
// idempotent ABORTED re-entry, and terminal receipt only after finalization.
group('g8', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-abort-finalize-cli-'));
  const statePath = path.join(dir, 'state.json');
  const outPath = path.join(dir, 'aborted.json');
  const rejectOut = path.join(dir, 'rejected-out.json');

  const adapter = new ac.AuthenticatedControlAdapter({
    verifier: () => ({ verified: true, authority: 'authenticated_user' }),
  });
  const initial = m.createMissionState(makeContract({ enforcement_mode: 'enforce' }));
  const aborting = m.reduceMissionState(
    initial,
    controlEvent(initial, mintControl(adapter, initial.mission_lineage_id, 'abort_requested', 4)),
  );
  check('g8-abort-control-sequence', aborting.state.state === 'ABORTING'
    && aborting.state.control_sequence === 4
    && !aborting.state.terminal);
  fs.writeFileSync(statePath, `${JSON.stringify(aborting.state)}\n`, { mode: 0o600 });

  // Live-claim rejection writes nothing.
  const livePath = path.join(dir, 'live.json');
  const claimed = m.reduceMissionState(initial, claimEvent(initial, { idempotency_key: 'cli-live' }));
  const abortingLive = m.reduceMissionState(
    claimed.state,
    controlEvent(claimed.state, mintControl(adapter, claimed.state.mission_lineage_id, 'abort_requested', 6)),
  );
  fs.writeFileSync(livePath, `${JSON.stringify(abortingLive.state)}\n`, { mode: 0o600 });
  let liveStdout = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { liveStdout += String(chunk); return true; };
  let liveCode;
  try {
    liveCode = missionCli.runMissionCli([
      'finalize-abort', '--state', livePath, '--out', rejectOut,
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  let livePayload = null;
  try { livePayload = JSON.parse(liveStdout); } catch (_e) { livePayload = null; }
  check('g8-cli-reject-live-claim-no-write',
    liveCode === 1
      && !fs.existsSync(rejectOut)
      && livePayload
      && livePayload.status === 'rejected'
      && livePayload.code === 'live_claims_remain');

  // Success path writes ABORTED via the reducer (not raw JSON mutation).
  let okStdout = '';
  process.stdout.write = (chunk) => { okStdout += String(chunk); return true; };
  let okCode;
  try {
    okCode = missionCli.runMissionCli([
      'finalize-abort', '--state', statePath, '--out', outPath,
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  let okPayload = null;
  try { okPayload = JSON.parse(okStdout); } catch (_e) { okPayload = null; }
  const written = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
  check('g8-cli-finalize-success',
    okCode === 0
      && okPayload
      && okPayload.status === 'aborted'
      && okPayload.next_state === 'ABORTED'
      && okPayload.mission_terminal === true
      && written
      && written.state === 'ABORTED'
      && written.terminal
      && written.terminal.reason === 'abort_finalized');

  // Idempotent re-entry of already-ABORTED succeeds and rewrites --out.
  let idempStdout = '';
  process.stdout.write = (chunk) => { idempStdout += String(chunk); return true; };
  let idempCode;
  try {
    idempCode = missionCli.runMissionCli([
      'finalize-abort', '--state', outPath, '--out', outPath,
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  let idempPayload = null;
  try { idempPayload = JSON.parse(idempStdout); } catch (_e) { idempPayload = null; }
  check('g8-cli-idempotent-aborted',
    idempCode === 0
      && idempPayload
      && idempPayload.status === 'aborted'
      && idempPayload.idempotent === true
      && idempPayload.next_state === 'ABORTED');

  // Negative idempotent path: forged/undrained ABORTED must reject and not write.
  function runFinalizeAbort(stateObj, outFile) {
    const inPath = path.join(dir, `neg-${path.basename(outFile)}.json`);
    fs.writeFileSync(inPath, `${JSON.stringify(stateObj)}\n`, { mode: 0o600 });
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
    let captured = '';
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
    let code;
    try {
      code = missionCli.runMissionCli([
        'finalize-abort', '--state', inPath, '--out', outFile,
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }
    let payload = null;
    try { payload = JSON.parse(captured); } catch (_e) { payload = null; }
    return { code, payload, wrote: fs.existsSync(outFile) };
  }

  // Canonical ABORTED helper must accept the real written terminal.
  const helperOk = m.evaluateCanonicalAbortedTerminal(written);
  check('g8-canonical-aborted-helper-accepts',
    helperOk && helperOk.ok === true);

  // Live claim under otherwise-canonical ABORTED (event binding intact).
  // Inject a real unreleased claim into a reducer-produced ABORTED so the
  // drain check — not a weaker forged terminal marker — owns the rejection.
  const liveClaimed = m.reduceMissionState(
    initial,
    claimEvent(initial, { idempotency_key: 'cli-aborted-live' }),
  );
  const abortedLive = JSON.parse(JSON.stringify(written));
  abortedLive.claims = JSON.parse(JSON.stringify(liveClaimed.state.claims));
  const liveNegOut = path.join(dir, 'neg-live-out.json');
  const liveNeg = runFinalizeAbort(abortedLive, liveNegOut);
  check('g8-cli-reject-aborted-live-claim-no-write',
    liveNeg.code === 1
      && liveNeg.wrote === false
      && liveNeg.payload
      && liveNeg.payload.status === 'rejected'
      && liveNeg.payload.code === 'live_claims_remain');

  // Nonzero reserved_active under forged ABORTED.
  const abortedReserved = JSON.parse(JSON.stringify(written));
  abortedReserved.axes.tool_calls.reserved_active = 3;
  const reservedNegOut = path.join(dir, 'neg-reserved-out.json');
  const reservedNeg = runFinalizeAbort(abortedReserved, reservedNegOut);
  check('g8-cli-reject-aborted-reserved-no-write',
    reservedNeg.code === 1
      && reservedNeg.wrote === false
      && reservedNeg.payload
      && reservedNeg.payload.status === 'rejected'
      && reservedNeg.payload.code === 'resource_axes_not_drained');

  // Nonzero active_actual under forged ABORTED.
  const abortedActive = JSON.parse(JSON.stringify(written));
  abortedActive.axes.tool_calls.active_actual = 2;
  const activeNegOut = path.join(dir, 'neg-active-out.json');
  const activeNeg = runFinalizeAbort(abortedActive, activeNegOut);
  check('g8-cli-reject-aborted-active-no-write',
    activeNeg.code === 1
      && activeNeg.wrote === false
      && activeNeg.payload
      && activeNeg.payload.status === 'rejected'
      && activeNeg.payload.code === 'resource_axes_not_drained');

  // Forged/noncanonical terminal marker under ABORTED.
  const abortedForged = JSON.parse(JSON.stringify(written));
  abortedForged.terminal = { state: 'ABORTED', reason: 'forged_terminal', at_event: 1 };
  const forgedNegOut = path.join(dir, 'neg-forged-out.json');
  const forgedNeg = runFinalizeAbort(abortedForged, forgedNegOut);
  check('g8-cli-reject-forged-aborted-terminal-no-write',
    forgedNeg.code === 1
      && forgedNeg.wrote === false
      && forgedNeg.payload
      && forgedNeg.payload.status === 'rejected'
      && forgedNeg.payload.code === 'noncanonical_abort_terminal');

  // Drained ABORTED with correct reason but forged at_event / final event / lineage.
  const abortedForgedAt = JSON.parse(JSON.stringify(written));
  abortedForgedAt.terminal = {
    state: 'ABORTED',
    reason: 'abort_finalized',
    at_event: 999,
  };
  const forgedAtOut = path.join(dir, 'neg-forged-at-out.json');
  const forgedAtNeg = runFinalizeAbort(abortedForgedAt, forgedAtOut);
  check('g8-cli-reject-forged-aborted-at-event-no-write',
    forgedAtNeg.code === 1
      && forgedAtNeg.wrote === false
      && forgedAtNeg.payload
      && forgedAtNeg.payload.status === 'rejected'
      && forgedAtNeg.payload.code === 'noncanonical_abort_terminal');
  check('g8-canonical-rejects-forged-at-event',
    m.evaluateCanonicalAbortedTerminal(abortedForgedAt).ok === false
      && m.evaluateCanonicalAbortedTerminal(abortedForgedAt).reason === 'noncanonical_abort_terminal');

  const abortedForgedEvt = JSON.parse(JSON.stringify(written));
  const lastForged = abortedForgedEvt.events[abortedForgedEvt.events.length - 1];
  lastForged.event_type = 'stagnation_observation';
  lastForged.event_digest = m.sha256({
    event_type: lastForged.event_type,
    sequence: lastForged.sequence,
    mission_lineage_id: lastForged.mission_lineage_id,
    payload: lastForged.payload,
  });
  check('g8-canonical-rejects-forged-final-event',
    m.evaluateCanonicalAbortedTerminal(abortedForgedEvt).ok === false
      && m.evaluateCanonicalAbortedTerminal(abortedForgedEvt).reason === 'noncanonical_abort_terminal');

  const abortedForgedLin = JSON.parse(JSON.stringify(written));
  const lastLin = abortedForgedLin.events[abortedForgedLin.events.length - 1];
  lastLin.mission_lineage_id = 'lineage-v1-' + 'a'.repeat(64);
  lastLin.event_digest = m.sha256({
    event_type: lastLin.event_type,
    sequence: lastLin.sequence,
    mission_lineage_id: lastLin.mission_lineage_id,
    payload: lastLin.payload,
  });
  check('g8-canonical-rejects-forged-lineage',
    m.evaluateCanonicalAbortedTerminal(abortedForgedLin).ok === false
      && m.evaluateCanonicalAbortedTerminal(abortedForgedLin).reason === 'noncanonical_abort_terminal');

  // Terminal receipt accepted only after finalization.
  const residuePayload = { lifecycle_residue: ['g8-cleanup'] };
  const residue = { ...residuePayload, residue_digest: m.sha256(residuePayload) };
  let abortingReceiptRejected = false;
  try {
    m.buildMissionTerminalReceipt(aborting.state, residue);
  } catch (_e) { abortingReceiptRejected = true; }
  const terminalReceipt = m.buildMissionTerminalReceipt(written, residue);
  check('g8-terminal-receipt-after-finalize',
    abortingReceiptRejected
      && terminalReceipt
      && terminalReceipt.mission_terminal === true
      && terminalReceipt.artifact_type === 'mission_terminal_receipt');

  // Forged ABORTED must not mint a terminal receipt.
  let forgedReceiptRejected = false;
  try {
    m.buildMissionTerminalReceipt(abortedForgedAt, residue);
  } catch (_e) { forgedReceiptRejected = true; }
  check('g8-terminal-receipt-rejects-forged-aborted', forgedReceiptRejected);

  // Malformed legacy ABORTING terminal bindings remain irreducible.
  function expectLegacyTerminal(id, mutator) {
    const baseLegacy = {
      ...JSON.parse(JSON.stringify(aborting.state)),
      control_sequence: 0,
      terminal: {
        state: 'ABORTING',
        reason: 'abort_requested',
        at_event: aborting.state.events.length,
      },
    };
    const bad = mutator(JSON.parse(JSON.stringify(baseLegacy)));
    let rejected = false;
    let code = null;
    try {
      m.reduceMissionState(bad, {
        event_type: 'abort_finalized',
        sequence: bad.events.length + 1,
        mission_lineage_id: bad.mission_lineage_id,
        payload: {},
      });
    } catch (e) {
      rejected = true;
      code = e.code;
    }
    check(id, rejected && code === 'MISSION_STATE_TERMINAL');
  }
  // Valid real legacy (control_sequence 0 + abort_requested terminal) finalizes.
  const realLegacy = {
    ...JSON.parse(JSON.stringify(aborting.state)),
    control_sequence: 0,
    terminal: {
      state: 'ABORTING',
      reason: 'abort_requested',
      at_event: aborting.state.events.length,
    },
  };
  const legacyFinalized = m.reduceMissionState(realLegacy, {
    event_type: 'abort_finalized',
    sequence: realLegacy.events.length + 1,
    mission_lineage_id: realLegacy.mission_lineage_id,
    payload: {},
  });
  check('g8-legacy-zero-control-sequence-finalizes',
    legacyFinalized.state.state === 'ABORTED'
      && legacyFinalized.state.terminal
      && legacyFinalized.state.terminal.reason === 'abort_finalized'
      && m.evaluateCanonicalAbortedTerminal(legacyFinalized.state).ok === true);
  expectLegacyTerminal('g8-legacy-rejects-wrong-reason', (s) => {
    s.terminal.reason = 'forged_reason';
    return s;
  });
  expectLegacyTerminal('g8-legacy-rejects-wrong-at-event', (s) => {
    s.terminal.at_event = 1;
    // When at_event is wrong relative to events.length, still irreducible.
    if (s.events.length === 1) s.terminal.at_event = 0;
    return s;
  });
  expectLegacyTerminal('g8-legacy-rejects-wrong-nested-action', (s) => {
    const last = s.events[s.events.length - 1];
    last.payload.event.action = 'finish_requested';
    last.event_digest = m.sha256({
      event_type: last.event_type,
      sequence: last.sequence,
      mission_lineage_id: last.mission_lineage_id,
      payload: last.payload,
    });
    return s;
  });

  // receipt CLI must not mutate state; terminal receipt needs bound residue.
  const residuePath = path.join(dir, 'residue.json');
  fs.writeFileSync(residuePath, `${JSON.stringify(residue)}\n`, { mode: 0o600 });
  const receiptStateBefore = fs.readFileSync(outPath, 'utf8');
  let receiptStdout = '';
  process.stdout.write = (chunk) => { receiptStdout += String(chunk); return true; };
  let receiptCode;
  try {
    receiptCode = missionCli.runMissionCli([
      'receipt', '--state', outPath, '--residue', residuePath,
    ]);
  } finally {
    process.stdout.write = originalWrite;
  }
  let receiptPayload = null;
  try { receiptPayload = JSON.parse(receiptStdout); } catch (_e) { receiptPayload = null; }
  check('g8-receipt-cli-no-mutate',
    receiptCode === 0
      && fs.readFileSync(outPath, 'utf8') === receiptStateBefore
      && receiptPayload
      && receiptPayload.status === 'terminal'
      && receiptPayload.mission_terminal === true
      && receiptPayload.receipt
      && receiptPayload.receipt.mission_terminal === true);

  fs.rmSync(dir, { recursive: true, force: true });
});

for (const line of lines) console.log(line);
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "enforcement runtime oracle node harness executes every group"

# ── Independent groups must hold on current HEAD (real exports + reducer). ──
for id in \
  g1-disposition-schema g1-outcome-enum g1-outcome-block-capable \
  g1-evidence-blocked-not-created g1-execution-digests-bound g1-capability-binding \
  g2-capability-notes-pending-binding \
  g3-finish-closing g3-finish-no-terminal g3-scope-closing g3-abort-terminal \
  g3-stale-fenced g3-post-control-claim-rejected g3-closure-allowlist-fixed \
  g4-shadow-does-not-block g4-shadow-live-effect-granted g4-shadow-evidence-exact \
  g4-enforce-blocks-identical g4-enforce-creates-no-claim \
  g5-two-campaigns-terminal-complete g5-terminal-no-task-closeout
do
  assert_contains "$OUT" "$id	PASS" "enforcement runtime invariant $id must hold on HEAD"
done

# ── No group may have aborted the harness mid-run. ──
for grp in g1 g2 g3 g4 g5 g6 g7 g8; do
  assert_not_contains "$OUT" "$grp	FAIL	threw" "enforcement group $grp ran to completion"
done

# ── Missing-P2 acceptance: assert the canonical P2 surface PASSES; absent on
# HEAD so the oracle exits nonzero. These go green when P2 ships the surface. ──
assert_contains "$OUT" "p2-evaluate-codex-enforcement-disposition-present	PASS" \
  "RED: evaluateCodexEnforcementDisposition not exported from engine"
assert_contains "$OUT" "p2-capability-probe-digest-bound	PASS" \
  "RED: Codex capability does not bind the exact P0 enforcement artifact digest"
assert_contains "$OUT" "p2-codex-mission-enforcement-adapter-present	PASS" \
  "RED: createCodexMissionEnforcementAdapter not exported from engine"
assert_contains "$OUT" "p2-fence-mission-effect-present	PASS" \
  "RED: fenceMissionEffect not exported from engine"
assert_contains "$OUT" "p2-record-mission-closure-effect-present	PASS" \
  "RED: recordMissionClosureEffect not exported from engine"
assert_contains "$OUT" "p2-build-mission-terminal-receipt-present	PASS" \
  "RED: buildMissionTerminalReceipt not exported from engine"
assert_contains "$OUT" "p2-nonterminal-projection-mission-terminal-false	PASS" \
  "RED: nonterminal buildProjection does not expose mission_terminal=false"

for id in \
  p2-disposition-block-capable-may-enforce \
  p2-disposition-wrapper-required-may-enforce \
  p2-disposition-unenforceable-denied p2-disposition-malformed-denied \
  p2-disposition-digest-mismatch-denied p2-disposition-identity-mismatch-denied \
  p2-disposition-unsupported-harness-denied \
  p2-adapter-returns-object p2-adapter-valid-request-effect-runs \
  p2-adapter-lineage-mismatch-blocks-before-effect \
  p2-adapter-sequence-mismatch-blocks-before-effect \
  p2-adapter-digest-mismatch-blocks-before-effect \
  p2-adapter-identity-mismatch-blocks-before-effect \
  p2-adapter-exact-effect-call-count p2-adapter-forged-disposition-rejected \
  p2-disposition-has-no-reflectable-attestation-symbol \
  p2-adapter-reflected-disposition-clone-rejected \
  p2-adapter-caller-cannot-select-request-identity \
  p2-adapter-forged-grant-rejected \
  p2-fence-stale-finish-zero-effects p2-fence-stale-scope-zero-effects \
  p2-fence-stale-abort-zero-effects p2-fence-current-effect-runs \
  p2-closure-allowlisted-effect-accepted p2-closure-receipt-content-bound \
  p2-closure-stale-effect-rejected p2-closure-non-allowlisted-rejected \
  p2-terminal-receipt-mission-terminal-true p2-terminal-receipt-no-task-closeout \
  p2-terminal-receipt-schema-version p2-terminal-receipt-digests \
  p2-terminal-receipt-residue-binding p2-terminal-receipt-tampered-residue-rejected \
  p2-cli-control-without-host-auth-rejected \
  g8-abort-control-sequence g8-cli-reject-live-claim-no-write g8-cli-finalize-success \
  g8-cli-idempotent-aborted g8-canonical-aborted-helper-accepts \
  g8-cli-reject-aborted-live-claim-no-write g8-cli-reject-aborted-reserved-no-write \
  g8-cli-reject-aborted-active-no-write g8-cli-reject-forged-aborted-terminal-no-write \
  g8-cli-reject-forged-aborted-at-event-no-write g8-canonical-rejects-forged-at-event \
  g8-canonical-rejects-forged-final-event g8-canonical-rejects-forged-lineage \
  g8-terminal-receipt-after-finalize g8-terminal-receipt-rejects-forged-aborted \
  g8-legacy-zero-control-sequence-finalizes g8-legacy-rejects-wrong-reason \
  g8-legacy-rejects-wrong-at-event g8-legacy-rejects-wrong-nested-action \
  g8-receipt-cli-no-mutate
do
  assert_contains "$OUT" "$id	PASS" "Mission P2 enforcement behavior $id must pass"
done

finalize_test
