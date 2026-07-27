#!/usr/bin/env bash
# Mission P2 — ICC binding runtime oracle (RED).
#
# This oracle freezes the runtime behavior Mission P2 must add on top of the
# already-shipped P1 reducer and the ICC ordered intake composition. It is the
# verification author's artifact: it does NOT modify product code and it does
# NOT treat an unknown command, a usage message, a missing file, or a generic
# nonzero exit as evidence of a passing P2 behavior.
#
# Groups 1-4 exercise REAL existing dependency-injection seams and pure reducer
# exports; they must hold on current HEAD. Groups 5-6 plus the canonical P2
# export assertions freeze the exact P2 binding surface that does not exist yet,
# so this file exits nonzero on current HEAD for explicit missing-P2 acceptance.
# Dependent subcases that require the missing surface are skipped; every
# independent group still runs.
. "$(dirname "$0")/lib.sh"

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

# ─── Sandbox 1: shadow-mode repo with one sealed campaign contract ──────────
SBX="$TEST_TMP/icc-shadow-repo"
mkdir -p "$SBX/.claude" "$SBX/src"
git -C "$SBX" init -q
git -C "$SBX" config user.email "mission-p2@example.invalid"
git -C "$SBX" config user.name "Mission P2 Oracle"
printf '%s\n' '{"mission_convergence":{"enforcement_mode":"shadow"}}' \
  > "$SBX/.claude/owner-kernel-governance.json"
printf 'base\n' > "$SBX/src/value.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm "base"
BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
git -C "$SBX" checkout -qb impl/p2-icc
printf 'candidate\n' > "$SBX/src/value.txt"
git -C "$SBX" add .
git -C "$SBX" commit -qm "candidate"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
COMMON_DIR="$(realpath "$SBX/$COMMON_RAW")"
CONTRACT="$TEST_TMP/p2-icc-campaign.json"
SEAL="$TEST_TMP/p2-icc-campaign.seal.json"
PROMPT="$TEST_TMP/p2-icc-prompt.txt"
printf 'mission p2 icc composition oracle\n' > "$PROMPT"
node - "$CONTRACT" "$COMMON_DIR" "$BASE_SHA" <<'NODE'
'use strict';
const fs = require('fs');
const [target, commonDir, base] = process.argv.slice(2);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  ticket: 'mission-p2-icc',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/p2-icc',
  vertical_acceptance: ['oracle verifies the ordered intake composition'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['MISSION-P2-ICC1'],
}, null, 2)}\n`);
NODE
SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --out "$SEAL" 2>&1)"
assert_exit_code "$?" "0" "shadow campaign contract seals for the intake oracle: $SEAL_OUT"

# ─── Sandbox 2: enforce-mode repo (used only for the P2 binding seam) ───────
EBX="$TEST_TMP/icc-enforce-repo"
mkdir -p "$EBX/.claude" "$EBX/src"
git -C "$EBX" init -q
git -C "$EBX" config user.email "mission-p2@example.invalid"
git -C "$EBX" config user.name "Mission P2 Oracle"
printf '%s\n' '{"mission_convergence":{"enforcement_mode":"enforce"}}' \
  > "$EBX/.claude/owner-kernel-governance.json"
printf 'base\n' > "$EBX/src/value.txt"
git -C "$EBX" add .
git -C "$EBX" commit -qm "base"
EBASE_SHA="$(git -C "$EBX" rev-parse HEAD)"

OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" "$BASE_SHA" "$EBX" "$EBASE_SHA" <<'NODE'
'use strict';
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base, enforceRepo, enforceBase] =
  process.argv.slice(2);

const engine = require(path.join(root, 'src', 'engine'));
const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const ac = require(path.join(root, 'src', 'engine', 'authenticated-control'));
const {
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const campaignCheck = require(path.join(root, 'scripts', 'implementation-campaign-check'));

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
function intakeInput() {
  return {
    repo,
    contractPath,
    sealPath,
    promptFile,
    branch: 'impl/p2-icc',
    base,
    roster: { implementer_engine: 'fixture-implementer' },
    observedAt: '2026-07-27T00:00:00.000Z',
  };
}

// ── Group 1: the shared composition claims the Mission grant FIRST, before
// ICC contract, PRO readiness, context window, WLB occupancy, generation.
// Proven with the real runCampaignIntake DI seam and recording adapters.
group('g1', () => {
  const calls = [];
  const adapters = {
    missionClaim: () => { calls.push('mission'); return { owner: 'mission', status: 'claimed', claim_id: 'mission-claim-g1' }; },
    releaseMission: () => ({ owner: 'mission_release', status: 'released' }),
    readiness: () => { calls.push('provider_readiness'); return { owner: 'provider_readiness', status: 'ready' }; },
    contextGate: () => { calls.push('context_window'); return { owner: 'context_window', status: 'ready' }; },
    occupancy: () => { calls.push('worktree_lifecycle'); return { owner: 'worktree_lifecycle', status: 'ready' }; },
  };
  const control = runCampaignIntake(intakeInput(), adapters);
  const owners = (control.steps || []).map((s) => s.owner);
  check('g1-intake-admitted', control.status === 'admitted');
  check('g1-mission-claimed-first', owners[0] === 'mission');
  check('g1-mission-before-contract', owners.indexOf('mission') < owners.indexOf('campaign_contract'));
  check('g1-mission-before-readiness', owners.indexOf('mission') < owners.indexOf('provider_readiness'));
  check('g1-mission-before-context', owners.indexOf('mission') < owners.indexOf('context_window'));
  check('g1-mission-before-occupancy', owners.indexOf('mission') < owners.indexOf('worktree_lifecycle'));
  check('g1-mission-before-generation', owners.indexOf('mission') < owners.indexOf('campaign_generation'));
  check('g1-claim-called-before-review-stages', calls[0] === 'mission');
  check('g1-no-pre-spend-release-on-admit', control.pre_spend_no_effect_receipt === null);
});

// ── Group 2: a Mission claim rejection has ZERO reservation/release/downstream
// effects — no contract/PRO/context/WLB/generation adapter ever runs.
group('g2', () => {
  const calls = [];
  const adapters = {
    missionClaim: () => { calls.push('mission'); return { owner: 'mission', status: 'rejected', code: 'mission_grant_rejected_by_oracle', reason: 'oracle claim rejection' }; },
    releaseMission: () => { calls.push('mission_release'); return { owner: 'mission_release', status: 'released' }; },
    readiness: () => { calls.push('provider_readiness'); return { owner: 'provider_readiness', status: 'ready' }; },
    contextGate: () => { calls.push('context_window'); return { owner: 'context_window', status: 'ready' }; },
    occupancy: () => { calls.push('worktree_lifecycle'); return { owner: 'worktree_lifecycle', status: 'ready' }; },
  };
  const control = runCampaignIntake(intakeInput(), adapters);
  check('g2-blocked', control.status === 'blocked');
  check('g2-rejection-owner-mission', control.rejection && control.rejection.owner === 'mission');
  check('g2-only-mission-ran', calls.length === 1 && calls[0] === 'mission');
  check('g2-no-release-effect', !calls.includes('mission_release'));
  check('g2-no-generation-step', !(control.steps || []).some((s) => s.owner === 'campaign_generation'));
  check('g2-no-pre-spend-receipt', control.pre_spend_no_effect_receipt === null);
  check('g2-no-campaign-id', typeof control.campaign_id !== 'string');
});

// ── Group 3: table-drive all four downstream owners (campaign_contract,
// provider_readiness, context_window, worktree_lifecycle). For each, assert
// exact order, exactly one claim-bound zero-usage release, unique owner
// provenance, and zero generation/spawn/reviewer effect.
group('g3', () => {
  const downstreamOwners = [
    { owner: 'campaign_contract', adapterKey: null },
    { owner: 'provider_readiness', adapterKey: 'readiness' },
    { owner: 'context_window', adapterKey: 'contextGate' },
    { owner: 'worktree_lifecycle', adapterKey: 'occupancy' },
  ];
  const expectedPrefix = ['mission', 'campaign_contract', 'provider_readiness', 'context_window', 'worktree_lifecycle'];

  for (const target of downstreamOwners) {
    const releaseCalls = [];
    const adapters = {
      missionClaim: () => ({ owner: 'mission', status: 'claimed', claim_id: `mc-${target.owner}` }),
      releaseMission: (arg) => { releaseCalls.push(arg); return { owner: 'mission_release', status: 'released' }; },
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    };
    // Inject rejection at the target owner
    if (target.adapterKey) {
      adapters[target.adapterKey] = () => ({
        owner: target.owner, status: 'rejected',
        code: `oracle_reject_${target.owner}`, reason: `oracle ${target.owner} rejection`,
      });
    }
    // For campaign_contract rejection, we use a broken seal path
    const input = target.owner === 'campaign_contract'
      ? { ...intakeInput(), sealPath: '/nonexistent/seal.json' }
      : intakeInput();
    const control = runCampaignIntake(input, adapters);
    const owners = (control.steps || []).map((s) => s.owner);
    const tag = `g3-${target.owner}`;

    check(`${tag}-blocked`, control.status === 'blocked');
    check(`${tag}-unique-owning-rejection`, control.rejection
      && control.rejection.owner === target.owner);
    check(`${tag}-exactly-one-release`, releaseCalls.length === 1);
    check(`${tag}-release-bound-to-claim`, releaseCalls.length === 1
      && releaseCalls[0].missionClaim
      && releaseCalls[0].missionClaim.claim_id === `mc-${target.owner}`);
    // Receipt is zero-usage and bound to the claim
    const receipt = control.pre_spend_no_effect_receipt;
    check(`${tag}-receipt-zero-usage`, receipt
      && receipt.artifact_type === 'pre_spend_no_effect'
      && receipt.claim_id === `mc-${target.owner}`
      && receipt.actual_usage.model_attempts === 0
      && receipt.actual_usage.worktrees_created === 0);
    // Exact step order: prefix up to and including the rejecting owner, then release
    const rejectIdx = expectedPrefix.indexOf(target.owner);
    const expectedOrder = expectedPrefix.slice(0, rejectIdx + 1).concat('mission_release');
    check(`${tag}-exact-step-order`, owners.join(',') === expectedOrder.join(','));
    // Zero generation/spawn/reviewer effect
    check(`${tag}-zero-generation-effect`, !owners.includes('campaign_generation'));
  }
});

// ── Group 4: terminal feedback reconciles once; an exact replay is idempotent;
// the reducer fails closed on an unknown/released claim without re-running ICC.
group('g4', () => {
  const s0 = m.createMissionState(makeContract());
  const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'p2-rec', reserved: 10 }));
  const claimId = a.receipt.claim_id;
  const actualUsage = reservation(a.state, 4);
  const r1 = m.reduceMissionState(a.state, {
    event_type: 'reconciliation', sequence: a.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: claimId, actual_usage: actualUsage },
  });
  check('g4-reconcile-once-consumes-actual', r1.receipt.reservation_consumed
    && r1.receipt.reservation_consumed.tool_calls.reserved_active === 4);
  const r2 = m.reduceMissionState(r1.state, {
    event_type: 'reconciliation', sequence: r1.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: claimId, actual_usage: actualUsage },
  });
  check('g4-exact-replay-idempotent', r2.receipt.replay === 'replay_noop');
  check('g4-replay-no-second-charge', r2.state.axes.tool_calls.durable_consumed === r1.state.axes.tool_calls.durable_consumed);
  const unknown = m.reduceMissionState(r2.state, {
    event_type: 'reconciliation', sequence: r2.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: m.claimIdFor(s0.mission_lineage_id, 'never-claimed'), actual_usage: actualUsage },
  });
  check('g4-unknown-claim-fails-closed', unknown.receipt.artifact_type === 'mission_grant_rejected'
    && unknown.receipt.reason === 'binding_mismatch');
});

// ── Group 5: validateMissionCampaignReceiptBinding — valid receipt feedback
// applies exactly once, exact replay is idempotent, changed actual usage /
// campaign digest / lineage fails closed without a second ICC judgment.
group('g5', () => {
  const validate = engine.validateMissionCampaignReceiptBinding;
  check('p2-validate-mission-campaign-receipt-binding-present', typeof validate === 'function');
  if (typeof validate === 'function') {
    const s0 = m.createMissionState(makeContract());
    const a = m.reduceMissionState(s0, claimEvent(s0, { idempotency_key: 'p2-bind', reserved: 8 }));
    const claimId = a.receipt.claim_id;
    const actualUsage = reservation(a.state, 6);
    const campaignDigest = m.sha256('campaign-contract');
    const receipt = {
      claim_id: claimId,
      mission_lineage_id: s0.mission_lineage_id,
      campaign_digest: campaignDigest,
      actual_usage: actualUsage,
    };
    // Valid receipt applies exactly once
    const first = validate(receipt, a.state);
    check('p2-receipt-valid-applies-once', first
      && (first.valid === true || first.status === 'applied'));
    // Exact replay is idempotent
    const replay = validate(receipt, a.state);
    check('p2-receipt-exact-replay-idempotent', replay
      && (replay.idempotent === true || replay.status === 'replay_noop'));
    // Changed actual usage fails closed
    const changedUsage = {
      ...receipt,
      actual_usage: reservation(a.state, 99),
    };
    const usageResult = validate(changedUsage, a.state);
    check('p2-receipt-changed-usage-fails-closed', usageResult
      && (usageResult.valid === false || usageResult.status === 'binding_mismatch'));
    // Changed campaign digest fails closed
    const changedDigest = { ...receipt, campaign_digest: m.sha256('different') };
    const digestResult = validate(changedDigest, a.state);
    check('p2-receipt-changed-digest-fails-closed', digestResult
      && (digestResult.valid === false || digestResult.status === 'binding_mismatch'));
    // Changed lineage fails closed
    const changedLineage = { ...receipt, mission_lineage_id: 'wrong-lineage' };
    const lineageResult = validate(changedLineage, a.state);
    check('p2-receipt-changed-lineage-fails-closed', lineageResult
      && (lineageResult.valid === false || lineageResult.status === 'binding_mismatch'));
  } else {
    lines.push('p2-receipt-valid-applies-once\tSKIP');
    lines.push('p2-receipt-exact-replay-idempotent\tSKIP');
    lines.push('p2-receipt-changed-usage-fails-closed\tSKIP');
    lines.push('p2-receipt-changed-digest-fails-closed\tSKIP');
    lines.push('p2-receipt-changed-lineage-fails-closed\tSKIP');
  }
});

// ── Group 6: createMissionCampaignAdapters — run the real adapters through
// runCampaignIntake in enforce mode and prove admission or the intended
// downstream owner rejection. Do not treat missing/generic errors as success.
group('g6', () => {
  const createAdapters = engine.createMissionCampaignAdapters;
  check('p2-create-mission-campaign-adapters-present', typeof createAdapters === 'function');
  if (typeof createAdapters === 'function') {
    const repoIdentity = campaignCheck.canonicalRepoIdentity(enforceRepo);
    const objectFormat = campaignCheck.repoObjectFormat(enforceRepo);
    const contract = {
      schema_version: 1,
      ticket: 'mission-p2-enforce',
      profile: 'poc',
      mission_grant_ref: m.sha256('p2-grant'),
      repo_identity: repoIdentity,
      base_sha: enforceBase,
      branch: 'main',
      vertical_acceptance: ['enforce seam admits a content-bound grant'],
      allowed_path_prefixes: ['src/'],
      max_changed_files: 4,
      baseline_churn: 10,
      max_growth_ratio: 1.5,
      max_extra_churn: 5,
      max_repair_generations: 2,
      max_wall_seconds: 120,
      verify_cmd: 'node fixture.js',
      rubric_ids: ['MISSION-P2-ENFORCE1'],
    };
    const errors = campaignCheck.validateContract(contract, {
      repo: enforceRepo,
      repoIdentity,
      objectFormat,
      missionMode: 'enforce',
    });
    check('p2-enforce-contract-sealable', errors.length === 0);
    check('p2-enforce-not-generic-rejection', !errors.some((e) => /unknown field|missing required field/.test(e)));

    // Run the real adapters through runCampaignIntake in enforce mode
    const missionAdapters = createAdapters({
      repo: enforceRepo,
      contract,
      enforcement_mode: 'enforce',
      mission_lineage_id: 'lineage-v1-' + m.sha256('L'),
      task_authority_id: m.sha256('TA'),
    });
    check('p2-adapters-have-mission-claim', typeof missionAdapters.missionClaim === 'function');
    check('p2-adapters-have-release', typeof missionAdapters.releaseMission === 'function');

    const enforceInput = {
      repo: enforceRepo,
      contractPath: contractPath,
      sealPath: sealPath,
      promptFile: promptFile,
      branch: 'main',
      base: enforceBase,
      roster: { implementer_engine: 'fixture-implementer' },
      observedAt: '2026-07-27T00:00:00.000Z',
    };
    const control = runCampaignIntake(enforceInput, missionAdapters);
    // Must be a specific outcome, not a generic error
    const isAdmitted = control.status === 'admitted';
    const isSpecificRejection = control.status === 'blocked'
      && control.rejection
      && typeof control.rejection.owner === 'string'
      && typeof control.rejection.code === 'string'
      && control.rejection.code !== 'mission_grant_unavailable';
    check('p2-real-adapter-drives-intake-admission', isAdmitted || isSpecificRejection);
  } else {
    lines.push('p2-enforce-contract-sealable\tSKIP');
    lines.push('p2-enforce-not-generic-rejection\tSKIP');
    lines.push('p2-adapters-have-mission-claim\tSKIP');
    lines.push('p2-adapters-have-release\tSKIP');
    lines.push('p2-real-adapter-drives-intake-admission\tSKIP');
  }
});

for (const line of lines) console.log(line);
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "ICC runtime oracle node harness executes every group"

# ── Independent groups must hold on current HEAD (real DI seams + reducer). ──
for id in \
  g1-intake-admitted g1-mission-claimed-first g1-mission-before-contract \
  g1-mission-before-readiness g1-mission-before-context g1-mission-before-occupancy \
  g1-mission-before-generation g1-claim-called-before-review-stages \
  g1-no-pre-spend-release-on-admit \
  g2-blocked g2-rejection-owner-mission g2-only-mission-ran g2-no-release-effect \
  g2-no-generation-step g2-no-pre-spend-receipt g2-no-campaign-id \
  g3-campaign_contract-blocked g3-campaign_contract-unique-owning-rejection \
  g3-campaign_contract-exactly-one-release g3-campaign_contract-release-bound-to-claim \
  g3-campaign_contract-receipt-zero-usage g3-campaign_contract-exact-step-order \
  g3-campaign_contract-zero-generation-effect \
  g3-provider_readiness-blocked g3-provider_readiness-unique-owning-rejection \
  g3-provider_readiness-exactly-one-release g3-provider_readiness-release-bound-to-claim \
  g3-provider_readiness-receipt-zero-usage g3-provider_readiness-exact-step-order \
  g3-provider_readiness-zero-generation-effect \
  g3-context_window-blocked g3-context_window-unique-owning-rejection \
  g3-context_window-exactly-one-release g3-context_window-release-bound-to-claim \
  g3-context_window-receipt-zero-usage g3-context_window-exact-step-order \
  g3-context_window-zero-generation-effect \
  g3-worktree_lifecycle-blocked g3-worktree_lifecycle-unique-owning-rejection \
  g3-worktree_lifecycle-exactly-one-release g3-worktree_lifecycle-release-bound-to-claim \
  g3-worktree_lifecycle-receipt-zero-usage g3-worktree_lifecycle-exact-step-order \
  g3-worktree_lifecycle-zero-generation-effect \
  g4-reconcile-once-consumes-actual g4-exact-replay-idempotent \
  g4-replay-no-second-charge g4-unknown-claim-fails-closed
do
  assert_contains "$OUT" "$id	PASS" "ICC runtime invariant $id must hold on HEAD"
done

# ── A group must not have aborted the harness mid-run. ──
for grp in g1 g2 g3 g4 g5 g6; do
  assert_not_contains "$OUT" "$grp	FAIL	threw" "ICC group $grp ran to completion"
done

# ── Missing-P2 acceptance: these freeze the exact required P2 binding surface.
# Each asserts the P2 behavior PASSES; on current HEAD the surface is absent so
# the assertion fails and this oracle exits nonzero. When P2 lands they go green.
assert_contains "$OUT" "p2-validate-mission-campaign-receipt-binding-present	PASS" \
  "RED: validateMissionCampaignReceiptBinding not exported from engine"
assert_contains "$OUT" "p2-create-mission-campaign-adapters-present	PASS" \
  "RED: createMissionCampaignAdapters not exported from engine"

finalize_test
