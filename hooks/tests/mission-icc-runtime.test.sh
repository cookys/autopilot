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
# exports; they must hold on current HEAD. Group 5 plus the two `p2-missing-*`
# assertions freeze the exact P2 binding surface that does not exist yet, so
# this file exits nonzero on current HEAD for explicit missing-P2 acceptance.
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
  try { stat = fs.lstatSync(target); } catch { continue; } // sibling not authored yet
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

// ── Group 3: a contract/PRO/context/WLB rejection AFTER the claim preserves a
// unique owning rejection, releases exactly one claim-bound zero-usage receipt,
// keeps an exact step order, and spawns no generation/review effect.
group('g3', () => {
  const releaseCalls = [];
  const adapters = {
    missionClaim: () => ({ owner: 'mission', status: 'claimed', claim_id: 'mission-claim-g3' }),
    releaseMission: (arg) => { releaseCalls.push(arg); return { owner: 'mission_release', status: 'released' }; },
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'rejected', code: 'oracle_wlb_reject', reason: 'oracle occupancy rejection' }),
  };
  const control = runCampaignIntake(intakeInput(), adapters);
  const owners = (control.steps || []).map((s) => s.owner);
  const receipt = control.pre_spend_no_effect_receipt;
  check('g3-blocked', control.status === 'blocked');
  check('g3-unique-owning-rejection', control.rejection && control.rejection.owner === 'worktree_lifecycle'
    && control.rejection.code === 'oracle_wlb_reject');
  check('g3-exactly-one-release', releaseCalls.length === 1);
  check('g3-release-bound-to-claim', releaseCalls.length === 1
    && releaseCalls[0].missionClaim && releaseCalls[0].missionClaim.claim_id === 'mission-claim-g3');
  check('g3-receipt-is-no-effect', receipt && receipt.artifact_type === 'pre_spend_no_effect');
  check('g3-receipt-bound-to-claim', receipt && receipt.claim_id === 'mission-claim-g3');
  check('g3-receipt-zero-usage', receipt
    && receipt.actual_usage.model_attempts === 0
    && receipt.actual_usage.worktrees_created === 0);
  check('g3-receipt-binds-rejection-digest', receipt
    && receipt.owning_rejection.owner === 'worktree_lifecycle'
    && /^[0-9a-f]{64}$/.test(receipt.owning_rejection.digest || ''));
  check('g3-exact-step-order', owners.join(',') === 'mission,campaign_contract,provider_readiness,context_window,worktree_lifecycle,mission_release');
  check('g3-no-generation-effect', !owners.includes('campaign_generation'));
  check('g3-no-campaign-id', typeof control.campaign_id !== 'string');
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
  // Unknown claim id (a receipt that does not bind any Mission claim) fails
  // closed as binding_mismatch — the reducer never re-runs ICC judgment.
  const unknown = m.reduceMissionState(r2.state, {
    event_type: 'reconciliation', sequence: r2.state.events.length + 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: { claim_id: m.claimIdFor(s0.mission_lineage_id, 'never-claimed'), actual_usage: actualUsage },
  });
  check('g4-unknown-claim-fails-closed', unknown.receipt.artifact_type === 'mission_grant_rejected'
    && unknown.receipt.reason === 'binding_mismatch');
});

// ── Group 4 RED: the P2 ICC->Mission terminal receipt binding validator that
// must fail closed on changed usage / changed digest / changed lineage does not
// exist yet. Assert its exact required callable presence; skip the dependent
// behavior subcase while every independent group still runs.
group('g4red', () => {
  const candidates = [
    engine.validateCampaignTerminalReceipt,
    engine.bindCampaignTerminalReceipt,
    engine.createCampaignTerminalReceiptBinder,
    m.validateCampaignTerminalReceipt,
  ];
  const present = candidates.some((fn) => typeof fn === 'function');
  check('p2-terminal-receipt-binding-validator-present', present);
  if (!present) {
    lines.push('p2-terminal-receipt-changed-usage-fails-closed\tSKIP');
  }
});

// ── Group 5 RED: the actual AutopilotEngine / engine implement-review DI seam
// cannot bind a content-bound Mission grant today. In an enforce-mode project
// the sealed-contract validator rejects every contract because enforced grant
// verification is not integrated, and the intake's default mission adapter
// rejects with mission_grant_unavailable. P2 must make the enforce seam admit a
// content-bound grant; assert the missing surface precisely.
group('g5', () => {
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
  // P2 acceptance: a valid enforce contract carrying a 64-hex mission_grant_ref
  // must seal with zero contract errors. Current HEAD always emits the
  // "unavailable until Mission integration" error, so this is RED.
  check('p2-enforce-contract-sealable', errors.length === 0);
  check('p2-enforce-not-generic-rejection', !errors.some((e) => /unknown field|missing required field/.test(e)));
});

// ── Group 5 RED (adapter factory): no published adapter wires campaign intake's
// missionClaim/releaseMission to the real Mission reducer. Assert the exact
// required export presence; skip the dependent full-admission subcase.
group('g5red', () => {
  const candidates = [
    engine.createMissionGrantAdapters,
    engine.createMissionClaimAdapter,
    engine.missionGrantAdapter,
    engine.bindMissionGrant,
  ];
  const present = candidates.some((fn) => typeof fn === 'function');
  check('p2-mission-grant-adapter-factory-present', present);
  if (!present) {
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
  g3-blocked g3-unique-owning-rejection g3-exactly-one-release \
  g3-release-bound-to-claim g3-receipt-is-no-effect g3-receipt-bound-to-claim \
  g3-receipt-zero-usage g3-receipt-binds-rejection-digest g3-exact-step-order \
  g3-no-generation-effect g3-no-campaign-id \
  g4-reconcile-once-consumes-actual g4-exact-replay-idempotent \
  g4-replay-no-second-charge g4-unknown-claim-fails-closed
do
  assert_contains "$OUT" "$id	PASS" "ICC runtime invariant $id must hold on HEAD"
done

# ── A group must not have aborted the harness mid-run. ──
for grp in g1 g2 g3 g4 g4red g5 g5red; do
  assert_not_contains "$OUT" "$grp	FAIL	threw" "ICC group $grp ran to completion"
done

# ── Missing-P2 acceptance: these freeze the exact required P2 binding surface.
# Each asserts the P2 behavior PASSES; on current HEAD the surface is absent so
# the assertion fails and this oracle exits nonzero. When P2 lands they go green.
assert_contains "$OUT" "p2-enforce-contract-sealable	PASS" \
  "RED: enforce-mode campaign contract is not sealable until Mission P2 binding"
assert_contains "$OUT" "p2-enforce-not-generic-rejection	PASS" \
  "RED is the intended Mission-integration gap, not a malformed contract"
assert_contains "$OUT" "p2-mission-grant-adapter-factory-present	PASS" \
  "RED: no published adapter binds intake missionClaim/releaseMission to the Mission reducer"
assert_contains "$OUT" "p2-terminal-receipt-binding-validator-present	PASS" \
  "RED: no ICC->Mission terminal receipt binding validator exists"
assert_contains "$OUT" "p2-real-adapter-drives-intake-admission	SKIP" \
  "dependent subcase skipped while the adapter surface is absent"

finalize_test
