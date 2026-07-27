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
# capability record, pure reducer, projection). Groups 2 and 6 plus the
# `p2-*-present` assertions freeze the exact P2 enforcement/publication surface
# that does not exist yet, so this file exits nonzero on current HEAD for
# explicit missing-P2 acceptance. Dependent subcases are skipped; every
# independent group still runs.
. "$(dirname "$0")/lib.sh"

ARTIFACT="$REPO_ROOT/docs/projects/2026-07-26-mission-convergence-portfolio/mission-p0-codex-enforcement.json"
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
const path = require('path');
const [root, artifactPath, capabilityPath] = process.argv.slice(2);

const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
const engine = require(path.join(root, 'src', 'engine'));
const capabilities = require(path.join(root, 'src', 'harness', 'capabilities'));

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
// binding. Only block-capable / wrapper-required may enable current-Codex
// enforcement; unenforceable-now must not.
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
  // The disposition gate: a pure predicate mapping the recorded outcome to
  // whether current-Codex enforcement may be enabled. block-capable and
  // wrapper-required => true; unenforceable-now => false.
  const gateCandidates = [
    capabilities.codexEnforcementEnabled,
    capabilities.dispositionEnablesEnforcement,
    engine.codexEnforcementEnabled,
    engine.missionCodexEnforcementAllowed,
    m.codexEnforcementEnabled,
  ];
  const gate = gateCandidates.find((fn) => typeof fn === 'function');
  check('p2-disposition-enforcement-gate-present', typeof gate === 'function');
  if (typeof gate === 'function') {
    check('p2-gate-block-capable-allowed', gate('block-capable') === true);
    check('p2-gate-wrapper-required-allowed', gate('wrapper-required') === true);
    check('p2-gate-unenforceable-denied', gate('unenforceable-now') === false);
  } else {
    lines.push('p2-gate-block-capable-allowed\tSKIP');
    lines.push('p2-gate-wrapper-required-allowed\tSKIP');
    lines.push('p2-gate-unenforceable-denied\tSKIP');
  }
});

// ── Group 2 RED: a verified Mission grant must enable the P0-selected
// current-Codex blocking adapter. The capability record itself states P2 must
// still bind Mission identity and control sequence; assert the missing adapter.
group('g2', () => {
  const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
  check('g2-capability-notes-pending-binding', Array.isArray(capability.notes)
    && capability.notes.some((n) => /P2 must still bind Mission identity/.test(n)));
  const adapterCandidates = [
    engine.createCodexMissionBlockAdapter,
    engine.codexMissionEnforcementAdapter,
    engine.createMissionEnforcementAdapter,
    capabilities.createCodexMissionBlockAdapter,
    m.createCodexMissionBlockAdapter,
  ];
  const present = adapterCandidates.some((fn) => typeof fn === 'function');
  check('p2-codex-blocking-adapter-binds-grant-present', present);
  if (!present) {
    lines.push('p2-codex-block-receipt-bound-to-grant\tSKIP');
  }
});

// ── Group 3: authenticated finish/scope/abort fence stale control with zero
// runner/worktree/reviewer effect at the reducer; the closure allowlist is the
// fixed effect-class set and a new grant after a closing control is rejected.
group('g3', () => {
  const adapter = new ac.AuthenticatedControlAdapter({
    verifier: () => ({ verified: true, authority: 'authenticated_user' }),
  });
  // finish_requested -> CLOSING with the control sequence recorded.
  const sFin = m.createMissionState(makeContract());
  const fin = m.reduceMissionState(sFin, controlEvent(sFin, mintControl(adapter, sFin.mission_lineage_id, 'finish_requested', 7)));
  check('g3-finish-closing', fin.state.state === 'CLOSING' && fin.state.control_sequence === 7);
  check('g3-finish-no-terminal', !fin.state.terminal);
  // scope_frozen -> CLOSING.
  const sScope = m.createMissionState(makeContract());
  const scope = m.reduceMissionState(sScope, controlEvent(sScope, mintControl(adapter, sScope.mission_lineage_id, 'scope_frozen', 4)));
  check('g3-scope-closing', scope.state.state === 'CLOSING' && scope.state.control_sequence === 4);
  // abort_requested -> terminal ABORTING.
  const sAbort = m.createMissionState(makeContract());
  const abort = m.reduceMissionState(sAbort, controlEvent(sAbort, mintControl(adapter, sAbort.mission_lineage_id, 'abort_requested', 2)));
  check('g3-abort-terminal', abort.state.terminal && abort.state.terminal.reason === 'abort_requested');
  // Stale sequence (3 < current 7) is fenced to CLOSING with the stale reason
  // and creates no new grant/effect authority.
  const stale = m.reduceMissionState(fin.state, controlEvent(fin.state, mintControl(adapter, fin.state.mission_lineage_id, 'finish_requested', 3)));
  check('g3-stale-fenced', stale.receipt.reason === 'control_sequence_stale'
    && stale.receipt.next_state === 'CLOSING');
  // A new grant claim after a closing control is not allowlisted (zero spawn).
  const postClaim = m.reduceMissionState(fin.state, claimEvent(fin.state, { idempotency_key: 'post-finish', campaign_id: 'c-late' }));
  check('g3-post-control-claim-rejected', postClaim.receipt.artifact_type === 'mission_grant_rejected'
    && postClaim.receipt.reason === 'effect_class_not_allowlisted');
  // Closure allowlist is the fixed effect-class set.
  check('g3-closure-allowlist-fixed', m.CLOSURE_ALLOWLIST.join(',') ===
    'frozen_acceptance,blocker_repair,targeted_verification,required_docs_version,receipt_production');
});

// ── Group 3 RED: the pre-effect stale fence (zero runner/worktree/reviewer
// effect for a stale dispatch) and the receipt-bound closure-allowlist effect
// recorder are P2 surfaces that do not exist yet.
group('g3red', () => {
  const fenceCandidates = [
    engine.fenceStaleMissionEffect,
    engine.missionEffectFence,
    engine.classifyMissionEffectAllowed,
    m.fenceStaleEffect,
  ];
  const fencePresent = fenceCandidates.some((fn) => typeof fn === 'function');
  check('p2-pre-effect-stale-fence-present', fencePresent);
  const closureCandidates = [
    engine.recordClosureAllowlistEffect,
    engine.createClosureAllowlistReceipt,
    m.recordClosureEffect,
  ];
  const closurePresent = closureCandidates.some((fn) => typeof fn === 'function');
  check('p2-closure-allowlist-receipt-binding-present', closurePresent);
  if (!fencePresent) lines.push('p2-stale-dispatch-zero-effect-proven\tSKIP');
  if (!closurePresent) lines.push('p2-closure-effect-receipt-bound\tSKIP');
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
  // Enforce blocks the identical request and creates no claim.
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
  // The terminal Mission state itself carries no task-closeout authority.
  const terminalSerialized = JSON.stringify(state.terminal);
  check('g5-terminal-no-task-closeout', !/can_close|can_merge/.test(terminalSerialized)
    && !/"state"\s*:\s*"DONE"/.test(terminalSerialized));
  // Evidence of the P2 gap: the operational projection cannot represent a
  // terminal Mission today — buildProjection fails closed on terminal state, so
  // no published terminal receipt/projection can say mission_terminal=true.
  let terminalProjectionError = null;
  try { m.buildProjection(state); } catch (error) { terminalProjectionError = error.code; }
  check('g5-no-terminal-projection-path', terminalProjectionError === 'MISSION_STATE_TERMINAL');
});

// ── Group 6 RED: the published terminal receipt/projection interface must say
// mission_terminal=true (without can_close/can_merge/DONE) even when sibling
// lifecycle residue exists. The projection carries no mission_terminal field
// today; assert the exact required publication surface.
group('g6', () => {
  const state = m.createMissionState(makeContract());
  const projection = m.buildProjection(state);
  const hasMissionTerminal = Object.prototype.hasOwnProperty.call(projection, 'mission_terminal')
    || (projection.state_snapshot
      && Object.prototype.hasOwnProperty.call(projection.state_snapshot, 'mission_terminal'));
  check('p2-published-terminal-receipt-mission-terminal-present', hasMissionTerminal);
  const publisherCandidates = [
    engine.publishMissionTerminalReceipt,
    engine.buildMissionTerminalReceipt,
    m.buildMissionTerminalReceipt,
    m.publishTerminalReceipt,
  ];
  const publisherPresent = publisherCandidates.some((fn) => typeof fn === 'function');
  check('p2-terminal-receipt-publisher-present', publisherPresent);
  if (!hasMissionTerminal && !publisherPresent) {
    lines.push('p2-terminal-receipt-with-residue-says-mission-terminal\tSKIP');
  }
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
  g5-two-campaigns-terminal-complete g5-terminal-no-task-closeout \
  g5-no-terminal-projection-path
do
  assert_contains "$OUT" "$id	PASS" "enforcement runtime invariant $id must hold on HEAD"
done

# ── No group may have aborted the harness mid-run. ──
for grp in g1 g2 g3 g3red g4 g5 g6; do
  assert_not_contains "$OUT" "$grp	FAIL	threw" "enforcement group $grp ran to completion"
done

# ── Missing-P2 acceptance: assert the P2 surface PASSES; absent on HEAD so the
# oracle exits nonzero. These go green when P2 publishes the surface. ──
assert_contains "$OUT" "p2-disposition-enforcement-gate-present	PASS" \
  "RED: no disposition->enforcement gate maps block-capable/wrapper-required to enable"
assert_contains "$OUT" "p2-codex-blocking-adapter-binds-grant-present	PASS" \
  "RED: no current-Codex blocking adapter binds a verified Mission grant"
assert_contains "$OUT" "p2-pre-effect-stale-fence-present	PASS" \
  "RED: no pre-effect stale fence stops stale runner/worktree/reviewer effects"
assert_contains "$OUT" "p2-closure-allowlist-receipt-binding-present	PASS" \
  "RED: no receipt-bound closure-allowlist effect recorder exists"
assert_contains "$OUT" "p2-published-terminal-receipt-mission-terminal-present	PASS" \
  "RED: published projection/receipt carries no mission_terminal=true field"
assert_contains "$OUT" "p2-terminal-receipt-publisher-present	PASS" \
  "RED: no published Mission terminal receipt publisher exists"
assert_contains "$OUT" "p2-terminal-receipt-with-residue-says-mission-terminal	SKIP" \
  "dependent subcase skipped while the publication surface is absent"

finalize_test
