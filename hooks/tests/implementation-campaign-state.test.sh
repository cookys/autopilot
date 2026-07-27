#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

PURE_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const root = process.argv[2];
const {
  CAMPAIGN_EVENTS: E,
  CAMPAIGN_STATES: S,
  CampaignStateError,
  campaignIdFor,
  createCampaignState,
  reduceCampaignState,
  validateInitialCampaignState,
} = require(path.join(root, 'src', 'engine'));

const D = 'a'.repeat(64);
const contract = {
  ticket: 'icc-p1',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 120,
  max_changed_files: 4,
  baseline_churn: 10,
  max_extra_churn: 5,
};
const initial = () => createCampaignState({
  contract,
  contractDigest: D,
  repoIdentity: 'git-common-dir:/fixture',
  startedAt: '2026-07-26T00:00:00.000Z',
});
let sequence = 0;
function event(type, generation, payload = {}, overrides = {}) {
  sequence += 1;
  const elapsed = overrides.elapsed === undefined ? sequence : overrides.elapsed;
  return {
    schema_version: 1,
    event_type: type,
    campaign_id: campaignIdFor('git-common-dir:/fixture', 'icc-p1', D),
    contract_digest: D,
    generation,
    idempotency_key: overrides.key || `event-${sequence}`,
    input_artifact_digest: overrides.input || D,
    output_artifact_digest: overrides.output || D,
    timestamp: overrides.timestamp
      || `2026-07-26T00:00:${String(sequence).padStart(2, '0')}.000Z`,
    stage_identity: overrides.stage || `stage-${generation}`,
    usage: {
      repair_generations: generation,
      elapsed_wall_seconds: elapsed,
      changed_files: overrides.changed === undefined ? 0 : overrides.changed,
      churn: overrides.churn === undefined ? 0 : overrides.churn,
    },
    payload,
  };
}
function apply(state, type, generation, payload, overrides) {
  return reduceCampaignState(state, event(type, generation, payload, overrides));
}
function expectCode(code, fn) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof CampaignStateError);
    assert.strictEqual(error.code, code);
    return;
  }
  assert.fail(`expected ${code}`);
}
function adjudicating(limits = contract) {
  sequence = 0;
  let state = createCampaignState({
    contract: limits,
    contractDigest: D,
    repoIdentity: 'git-common-dir:/fixture',
    startedAt: '2026-07-26T00:00:00.000Z',
  });
  state = apply(state, E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
  state = apply(state, E.IMPLEMENTATION_COMPLETED, 0, {
    scope_check_passed: true,
    scope_check_digest: D,
  }, {
    changed: 1,
    churn: 2,
  });
  state = apply(state, E.VERTICAL_VERIFIED, 0, { passed: true, evidence_digest: D }, {
    changed: 1,
    churn: 2,
  });
  return apply(state, E.REVIEW_COMPLETED, 0, { review_digest: D }, {
    changed: 1,
    churn: 2,
  });
}

sequence = 0;
let state = initial();
state = apply(state, E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
state = apply(state, E.IMPLEMENTATION_COMPLETED, 0, {
  scope_check_passed: true,
  scope_check_digest: D,
}, {
  changed: 1,
  churn: 2,
});
state = apply(state, E.VERTICAL_VERIFIED, 0, { passed: true, evidence_digest: D }, {
  changed: 1,
  churn: 2,
});
state = apply(state, E.REVIEW_COMPLETED, 0, { review_digest: D }, {
  changed: 1,
  churn: 2,
});
state = apply(state, E.REPAIR_AUTHORIZED, 1, {
  registry_complete: true,
  registry_digest: D,
  repair_gate_passed: true,
  repair_gate_digest: D,
}, { changed: 1, churn: 2 });
state = apply(state, E.REPAIR_STARTED, 1, { sealed_contract: true }, {
  changed: 1,
  churn: 2,
});
state = apply(state, E.REPAIR_COMPLETED, 1, {
  scope_check_passed: true,
  scope_check_digest: D,
}, {
  changed: 2,
  churn: 4,
});
state = apply(state, E.VERTICAL_VERIFIED, 1, { passed: true, evidence_digest: D }, {
  changed: 2,
  churn: 4,
});
state = apply(state, E.REVIEW_COMPLETED, 1, { review_digest: D }, {
  changed: 2,
  churn: 4,
});
const terminalEvent = event(E.TERMINAL_READY, 1, {
  reason: 'acceptance verified',
  registry_complete: true,
  registry_digest: D,
  convergence_digest: D,
}, {
  changed: 2,
  churn: 4,
});
state = reduceCampaignState(state, terminalEvent);
assert.strictEqual(state.phase, S.TERMINAL_READY);
assert.strictEqual(state.generation, 1);
assert.strictEqual(reduceCampaignState(state, terminalEvent), state);
assert.notStrictEqual(
  campaignIdFor('git-common-dir:/fixture', 'icc-p1', D),
  campaignIdFor('git-common-dir:/fixture', 'icc-p1', 'b'.repeat(64)),
);
assert.strictEqual(validateInitialCampaignState(initial()), true);
expectCode('INVALID_STATE_IDENTITY', () => validateInitialCampaignState({
  ...initial(),
  campaign_id: `campaign-v1-${'b'.repeat(64)}`,
}));

sequence = 0;
const resumed = apply(initial(), E.RESUMED, 0, {});
assert.strictEqual(resumed.phase, S.PREPARED);
assert.strictEqual(resumed.event_count, 1);
expectCode('RESUME_ARTIFACT_DRIFT', () => apply(
  initial(),
  E.RESUMED,
  0,
  {},
  { output: 'b'.repeat(64) },
));
expectCode('RESUME_GROWTH_DRIFT', () => apply(
  initial(),
  E.RESUMED,
  0,
  {},
  { changed: 1 },
));
expectCode('WALL_BUDGET_EXHAUSTED', () => apply(
  initial(),
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: true },
  {
    elapsed: 120,
    timestamp: '2026-07-26T00:02:00.000Z',
  },
));

let followUp = adjudicating();
followUp = apply(
  followUp,
  E.TERMINAL_FOLLOW_UP,
  0,
  {
    reason: 'bounded follow-up required',
    registry_complete: true,
    registry_digest: D,
    convergence_digest: D,
    follow_up_digest: D,
  },
  { changed: 1, churn: 2 },
);
assert.strictEqual(followUp.phase, S.TERMINAL_FOLLOW_UP);

sequence = 0;
const stopped = apply(
  initial(),
  E.TERMINAL_STOP,
  0,
  { reason: 'operator stop', stop_receipt_digest: D },
);
assert.strictEqual(stopped.phase, S.TERMINAL_STOP);

sequence = 0;
expectCode('INVALID_TRANSITION', () => apply(
  initial(),
  E.REVIEW_COMPLETED,
  0,
  { review_digest: D },
));

sequence = 0;
expectCode('UNSEALED_MUTATION', () => apply(
  initial(),
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: false },
));

sequence = 0;
let leased = apply(initial(), E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
expectCode('LIVE_LEASE_CONFLICT', () => apply(
  leased,
  E.RESUMED,
  0,
  {},
  { stage: 'other-stage' },
));
expectCode('LIVE_LEASE_CONFLICT', () => apply(
  leased,
  E.RESUMED,
  0,
  {},
  { stage: 'stage-0' },
));
expectCode('SCOPE_CHECK_REQUIRED', () => apply(
  leased,
  E.IMPLEMENTATION_COMPLETED,
  0,
  { scope_check_passed: false, scope_check_digest: D },
));

sequence = 0;
let vertical = apply(initial(), E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
vertical = apply(vertical, E.IMPLEMENTATION_COMPLETED, 0, {
  scope_check_passed: true,
  scope_check_digest: D,
});
expectCode('VERTICAL_EVIDENCE_REQUIRED', () => apply(
  vertical,
  E.VERTICAL_VERIFIED,
  0,
  { passed: true, evidence_digest: 'bad' },
));

sequence = 0;
let verticalRepair = apply(initial(), E.IMPLEMENTATION_STARTED, 0, {
  sealed_contract: true,
});
verticalRepair = apply(verticalRepair, E.IMPLEMENTATION_COMPLETED, 0, {
  scope_check_passed: true,
  scope_check_digest: D,
});
verticalRepair = apply(verticalRepair, E.REPAIR_AUTHORIZED, 1, {
  registry_complete: true,
  registry_digest: D,
  repair_gate_passed: true,
  repair_gate_digest: D,
});
assert.strictEqual(verticalRepair.phase, S.REPAIRING);
assert.strictEqual(verticalRepair.generation, 1);

let adjudicated = adjudicating();
expectCode('REGISTRY_INCOMPLETE', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  {
    registry_complete: false,
    registry_digest: D,
    repair_gate_passed: true,
    repair_gate_digest: D,
  },
  { changed: 1, churn: 2 },
));
expectCode('REPAIR_GATE_REQUIRED', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  {
    registry_complete: true,
    registry_digest: D,
    repair_gate_passed: false,
    repair_gate_digest: D,
  },
  { changed: 1, churn: 2 },
));

const noRepairContract = { ...contract, max_repair_generations: 0 };
adjudicated = adjudicating(noRepairContract);
expectCode('REPAIR_BUDGET_EXCEEDED', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  {
    registry_complete: true,
    registry_digest: D,
    repair_gate_passed: true,
    repair_gate_digest: D,
  },
  { changed: 1, churn: 2 },
));

sequence = 0;
let progressed = apply(initial(), E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
progressed = apply(progressed, E.IMPLEMENTATION_COMPLETED, 0, {
  scope_check_passed: true,
  scope_check_digest: D,
}, {
  changed: 1,
  churn: 2,
});
expectCode('BUDGET_RESET', () => apply(
  progressed,
  E.RESUMED,
  0,
  {},
  { changed: 0, churn: 2 },
));
expectCode('WALL_CLOCK_RESET', () => apply(
  progressed,
  E.RESUMED,
  0,
  {},
  { elapsed: 0, changed: 1, churn: 2 },
));

sequence = 0;
const first = event(E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true }, { key: 'same' });
leased = reduceCampaignState(initial(), first);
const conflicting = {
  ...first,
  output_artifact_digest: 'b'.repeat(64),
};
expectCode('IDEMPOTENCY_CONFLICT', () => reduceCampaignState(leased, conflicting));
expectCode('UNKNOWN_FIELD', () => apply(
  initial(),
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: true, unexpected: true },
));
expectCode('ARTIFACT_CHAIN_BROKEN', () => apply(
  initial(),
  E.IMPLEMENTATION_STARTED,
  0,
  { sealed_contract: true },
  { input: 'b'.repeat(64) },
));
adjudicated = adjudicating();
expectCode('REGISTRY_INCOMPLETE', () => apply(
  adjudicated,
  E.TERMINAL_READY,
  0,
  {
    reason: 'invalid incomplete registry',
    registry_complete: false,
    registry_digest: D,
    convergence_digest: D,
  },
  { changed: 1, churn: 2 },
));

console.log('valid_terminal=true');
console.log('contract_digest_namespaces_campaign=true');
console.log('valid_resume=true');
console.log('valid_follow_up=true');
console.log('valid_stop=true');
console.log('idempotent_terminal=true');
console.log('skipped_phase_rejected=true');
console.log('unsealed_mutation_rejected=true');
console.log('second_live_lease_rejected=true');
console.log('scope_gate_required=true');
console.log('vertical_evidence_required=true');
console.log('vertical_repair_authorized=true');
console.log('registry_completeness_required=true');
console.log('repair_gate_required=true');
console.log('repair_ceiling_enforced=true');
console.log('resume_budget_reset_rejected=true');
console.log('resume_clock_reset_rejected=true');
console.log('idempotency_conflict_rejected=true');
console.log('payload_unknown_field_rejected=true');
console.log('artifact_chain_break_rejected=true');
console.log('terminal_registry_required=true');
console.log('initial_identity_recomputed=true');
console.log('resume_authority_preserved=true');
console.log('mutation_requires_remaining_wall_budget=true');
NODE
)"
PURE_EXIT=$?
assert_exit_code "$PURE_EXIT" "0" "pure campaign state-table process exits zero"
for key in valid_terminal contract_digest_namespaces_campaign valid_resume valid_follow_up valid_stop \
  idempotent_terminal skipped_phase_rejected \
  unsealed_mutation_rejected second_live_lease_rejected scope_gate_required \
  vertical_evidence_required vertical_repair_authorized registry_completeness_required repair_gate_required \
  repair_ceiling_enforced resume_budget_reset_rejected resume_clock_reset_rejected \
  idempotency_conflict_rejected payload_unknown_field_rejected \
  artifact_chain_break_rejected terminal_registry_required initial_identity_recomputed \
  resume_authority_preserved mutation_requires_remaining_wall_budget; do
  assert_contains "$PURE_OUT" "$key=true" "pure reducer proves $key"
done

SBX="$TEST_TMP/repo"
mkdir -p "$SBX/.claude"
git -C "$SBX" init -q
git -C "$SBX" config user.email "campaign-state@example.invalid"
git -C "$SBX" config user.name "Campaign State Test"
printf '%s\n' '{"mission_convergence":{"enforcement_mode":"shadow"}}' \
  > "$SBX/.claude/owner-kernel-governance.json"
printf 'fixture\n' > "$SBX/README.md"
git -C "$SBX" add .
git -C "$SBX" commit -qm "fixture"
BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"
COMMON_RAW="$(git -C "$SBX" rev-parse --git-common-dir)"
COMMON_DIR="$(realpath "$SBX/$COMMON_RAW")"
CONTRACT="$TEST_TMP/campaign.json"
SEAL="$TEST_TMP/campaign.seal.json"
PROMPT="$TEST_TMP/prompt.txt"
printf 'bounded implementation\n' > "$PROMPT"
node - "$CONTRACT" "$COMMON_DIR" "$BASE_SHA" <<'NODE'
const fs = require('fs');
const [target, commonDir, base] = process.argv.slice(2);
const contract = {
  schema_version: 1,
  ticket: 'icc-p1-intake',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch: 'impl/icc-p1-intake',
  vertical_acceptance: ['one vertical slice'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['R1'],
};
fs.writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`);
NODE
node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$CONTRACT" --repo "$SBX" --mission-mode shadow --out "$SEAL" >/dev/null
assert_exit_code "$?" "0" "state fixture campaign contract seals"

DRIFT_CONTRACT="$TEST_TMP/drift-campaign.json"
DRIFT_SEAL="$TEST_TMP/drift-campaign.seal.json"
cp "$CONTRACT" "$DRIFT_CONTRACT"
node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$DRIFT_CONTRACT" --repo "$SBX" --mission-mode shadow \
  --out "$DRIFT_SEAL" >/dev/null
node - "$DRIFT_CONTRACT" <<'NODE'
const fs = require('fs');
const target = process.argv[2];
const value = JSON.parse(fs.readFileSync(target, 'utf8'));
value.max_changed_files = 3;
fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
NODE

INTAKE_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" "$BASE_SHA" \
  "$DRIFT_CONTRACT" "$DRIFT_SEAL" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [
  root,
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  driftContract,
  driftSeal,
] = process.argv.slice(2);
const {
  AutopilotEngine,
  campaignIdFor,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
};
const order = [];
const adapters = {
  now: () => '2026-07-26T00:00:00.000Z',
  missionClaim() {
    order.push('mission');
    return { owner: 'mission', status: 'claimed', claim_id: 'claim-1' };
  },
  releaseMission() {
    return { owner: 'mission_release', status: 'released' };
  },
  readiness() {
    order.push('provider_readiness');
    return { owner: 'provider_readiness', status: 'ready' };
  },
  contextGate() {
    order.push('context_window');
    return { owner: 'context_window', status: 'ready' };
  },
  occupancy() {
    order.push('worktree_lifecycle');
    return { owner: 'worktree_lifecycle', status: 'ready' };
  },
  claimGeneration() {
    order.push('campaign_generation');
    return {
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: 'n',
      ledger: path.join(repo, '.autopilot', 'injected-ledger.jsonl'),
      stage_identity: 'run-ledger:1:n',
    };
  },
};
const admitted = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, adapters);
console.log(`ordered=${order.join(',')}`);
console.log(`admitted=${admitted.status}`);
console.log(`step_order=${admitted.steps.map((entry) => entry.owner).join(',')}`);
console.log(`full_enforcement=${admitted.full_enforcement}`);

let unpairedMissionCalls = 0;
const unpaired = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  releaseMission: undefined,
  missionClaim() {
    unpairedMissionCalls += 1;
    return { owner: 'mission', status: 'claimed', claim_id: 'must-not-run' };
  },
});
console.log(`unpaired_code=${unpaired.rejection.code}`);
console.log(`unpaired_mission_calls=${unpairedMissionCalls}`);

let thrownMissionReleaseCalls = 0;
const thrownMission = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  missionClaim() {
    throw new Error('claim adapter failed before returning authority');
  },
  releaseMission() {
    thrownMissionReleaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
});
console.log(`thrown_mission_code=${thrownMission.rejection.code}`);
console.log(`thrown_mission_release_calls=${thrownMissionReleaseCalls}`);

let malformedMissionReleaseCalls = 0;
const malformedMission = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  missionClaim() {
    return { owner: 'mission', status: 'claimed', claim_id: '' };
  },
  releaseMission() {
    malformedMissionReleaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
});
console.log(`malformed_mission_code=${malformedMission.rejection.code}`);
console.log(`malformed_mission_release_calls=${malformedMissionReleaseCalls}`);

const shadowed = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  readiness() {
    return {
      owner: 'provider_readiness',
      status: 'ready',
      enforcement: 'shadow',
    };
  },
});
console.log(`shadow_full_enforcement=${shadowed.full_enforcement}`);
console.log(`shadow_axes=${shadowed.shadow_axes.join(',')}`);

let releaseCalls = 0;
const rejected = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  readiness() {
    return {
      owner: 'provider_readiness',
      status: 'rejected',
      code: 'provider_not_ready',
      reason: 'not ready',
    };
  },
  releaseMission() {
    releaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
});
console.log(`rejected=${rejected.status}`);
console.log(`release_calls=${releaseCalls}`);
console.log(`no_effect_zero=${rejected.pre_spend_no_effect_receipt.actual_usage.model_attempts}`);

let thrownReleaseCalls = 0;
const thrown = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster,
}, {
  ...adapters,
  readiness() {
    throw new Error('adapter fault');
  },
  releaseMission() {
    thrownReleaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
});
console.log(`adapter_fault=${thrown.rejection.code}`);
console.log(`adapter_fault_release_calls=${thrownReleaseCalls}`);

let invalidTimeReleaseCalls = 0;
const invalidTime = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  observedAt: 'not-a-timestamp',
  roster,
}, {
  ...adapters,
  releaseMission() {
    invalidTimeReleaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
});
console.log(`invalid_time_status=${invalidTime.status}`);
console.log(`invalid_time_code=${invalidTime.rejection.code}`);
console.log(`invalid_time_release_calls=${invalidTimeReleaseCalls}`);

const originalContractBytes = fs.readFileSync(contractPath);
const originalSealBytes = fs.readFileSync(sealPath);
let raceReleaseCalls = 0;
let raced;
try {
  raced = runCampaignIntake({
    repo,
    contractPath,
    sealPath,
    promptFile,
    base,
    branch: 'impl/icc-p1-intake',
    roster,
  }, {
    ...adapters,
    missionClaim() {
      const changed = JSON.parse(originalContractBytes.toString('utf8'));
      changed.max_changed_files -= 1;
      fs.writeFileSync(contractPath, `${JSON.stringify(changed, null, 2)}\n`);
      fs.unlinkSync(sealPath);
      const sealed = spawnSync(process.execPath, [
        path.join(root, 'scripts', 'implementation-campaign-check.js'),
        'seal',
        '--contract', contractPath,
        '--repo', repo,
        '--mission-mode', 'shadow',
        '--out', sealPath,
      ], {
        cwd: repo,
        encoding: 'utf8',
      });
      if (sealed.status !== 0) throw new Error(sealed.stderr || 'race seal failed');
      return { owner: 'mission', status: 'claimed', claim_id: 'claim-race' };
    },
    releaseMission() {
      raceReleaseCalls += 1;
      return { owner: 'mission_release', status: 'released' };
    },
  });
} finally {
  fs.writeFileSync(contractPath, originalContractBytes);
  fs.writeFileSync(sealPath, originalSealBytes);
}
console.log(`race_code=${raced.rejection.code}`);
console.log(`race_release_calls=${raceReleaseCalls}`);

const markers = { runner: 0, worktree: 0 };
const engine = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher() {
    markers.runner += 1;
    throw new Error('runner must not start');
  },
  gitWorktreeAdd() {
    markers.worktree += 1;
    throw new Error('worktree must not be created');
  },
});
const missing = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: path.join(repo, 'missing-contract.json'),
});
const omitted = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
});
const drifted = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignManaged: true,
  campaignContract: driftContract,
  campaignSeal: driftSeal,
});
const priorLevel = process.env.AUTOPILOT_LEVEL;
process.env.AUTOPILOT_LEVEL = 'l6';
const prohibitedLegacy = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher() {
    markers.runner += 1;
    throw new Error('L6 legacy runner must not start');
  },
}).runLegacyImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
});
const conflictingMode = engine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
  legacyUnmanaged: true,
});
if (priorLevel === undefined) delete process.env.AUTOPILOT_LEVEL;
else process.env.AUTOPILOT_LEVEL = priorLevel;
let preflightIntakeCalls = 0;
const invalidMax = new AutopilotEngine({
  cwd: repo,
  campaignIntake() {
    preflightIntakeCalls += 1;
    throw new Error('campaign intake must not run after local preflight rejection');
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
  maxRounds: 0,
});
console.log(`missing_phase=${missing.phase}`);
console.log(`missing_rounds=${missing.rounds}`);
console.log(`omitted_phase=${omitted.phase}`);
console.log(`omitted_rounds=${omitted.rounds}`);
console.log(`drift_phase=${drifted.phase}`);
console.log(`drift_code=${drifted.campaign_control.rejection.code}`);
console.log(`legacy_api_status=${prohibitedLegacy.status}`);
console.log(`legacy_api_code=${prohibitedLegacy.campaign_control.status}`);
console.log(`conflicting_mode_status=${conflictingMode.status}`);
console.log(`conflicting_mode_code=${conflictingMode.campaign_control.status}`);
console.log(`runner_calls=${markers.runner}`);
console.log(`worktree_calls=${markers.worktree}`);
console.log(`invalid_max_phase=${invalidMax.phase}`);
console.log(`invalid_max_intake_calls=${preflightIntakeCalls}`);

const campaignId = campaignIdFor(
  admitted.initial_state.repo_identity,
  admitted.contract.ticket,
  'c'.repeat(64),
);
const campaignLedger = path.join(repo, '.autopilot', 'identity-ledger.jsonl');
function campaignControlFixture(nonce, initialState = admitted.initial_state) {
  return {
    status: 'admitted',
    campaign_id: campaignId,
    contract_digest: 'c'.repeat(64),
    contract: {
      ...admitted.contract,
      verify_cmd: 'fixture verify',
      max_repair_generations: 2,
    },
    contract_path: contractPath,
    initial_state: initialState,
    generation_claim: {
      ledger: campaignLedger,
      generation: 1,
      nonce,
      stage_identity: `run-ledger:1:${nonce}`,
    },
    full_enforcement: false,
    shadow_axes: ['mission'],
    steps: [],
  };
}
let phaseResumeImplementationCalls = 0;
let phaseResumeReleaseCalls = 0;
const resumedPastMutation = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return campaignControlFixture('phase-resume', {
      ...admitted.initial_state,
      phase: 'VERTICAL_VERIFICATION',
    });
  },
  campaignAdmissionReleaser() {
    phaseResumeReleaseCalls += 1;
    return { status: 'released' };
  },
  implementationDispatcher() {
    phaseResumeImplementationCalls += 1;
    throw new Error('non-PREPARED resume must not replay implementation');
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
  resume: true,
});
console.log(`phase_resume_status=${resumedPastMutation.status}`);
console.log(`phase_resume_calls=${phaseResumeImplementationCalls}`);
console.log(`phase_resume_release_calls=${phaseResumeReleaseCalls}`);

let fileBudgetImplementationCalls = 0;
let fileBudgetReleaseCalls = 0;
const exhaustedFileState = JSON.parse(JSON.stringify(admitted.initial_state));
exhaustedFileState.usage.changed_files = exhaustedFileState.limits.max_changed_files;
const exhaustedFileBudget = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return campaignControlFixture('file-budget', exhaustedFileState);
  },
  campaignAdmissionReleaser() {
    fileBudgetReleaseCalls += 1;
    return { status: 'released' };
  },
  implementationDispatcher() {
    fileBudgetImplementationCalls += 1;
    throw new Error('file-exhausted campaign must not dispatch implementation');
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
});
console.log(`file_budget_phase=${exhaustedFileBudget.phase}`);
console.log(`file_budget_calls=${fileBudgetImplementationCalls}`);
console.log(`file_budget_release_calls=${fileBudgetReleaseCalls}`);

let churnBudgetImplementationCalls = 0;
const exhaustedChurnState = JSON.parse(JSON.stringify(admitted.initial_state));
exhaustedChurnState.usage.churn = exhaustedChurnState.limits.max_churn;
const exhaustedChurnBudget = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return campaignControlFixture('churn-budget', exhaustedChurnState);
  },
  campaignAdmissionReleaser() {
    return { status: 'released' };
  },
  implementationDispatcher() {
    churnBudgetImplementationCalls += 1;
    throw new Error('churn-exhausted campaign must not dispatch implementation');
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
});
console.log(`churn_budget_phase=${exhaustedChurnBudget.phase}`);
console.log(`churn_budget_calls=${churnBudgetImplementationCalls}`);

let resumeInspectCalls = 0;
let admissionReleaseCalls = 0;
const preconditionEngine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return campaignControlFixture('precondition');
  },
  campaignAdmissionReleaser() {
    admissionReleaseCalls += 1;
    return { status: 'released' };
  },
  implementationDispatcher() {
    return {
      error: null,
      status: 2,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'precondition_failed',
        runner: 'fixture',
        model: 'fixture-implementer',
        branch: 'impl/icc-p1-intake',
        base,
        commit: null,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: null,
        agent_log: null,
        error: 'campaign contract digest changed after intake',
      },
    };
  },
});
const preconditionResult = preconditionEngine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
});
console.log(`precondition_status=${preconditionResult.status}`);
console.log(`precondition_release_calls=${admissionReleaseCalls}`);
console.log(`precondition_release_status=${preconditionResult.campaign_control.admission_release.status}`);

let expiredImplementationCalls = 0;
let expiredReleaseCalls = 0;
const expiredBeforeImplementation = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:02:00.000Z',
  campaignIntake() {
    return campaignControlFixture('wall-expired');
  },
  campaignAdmissionReleaser() {
    expiredReleaseCalls += 1;
    return { status: 'released' };
  },
  implementationDispatcher() {
    expiredImplementationCalls += 1;
    throw new Error('wall-exhausted campaign must not dispatch implementation');
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
});
console.log(`expired_impl_phase=${expiredBeforeImplementation.phase}`);
console.log(`expired_impl_calls=${expiredImplementationCalls}`);
console.log(`expired_release_calls=${expiredReleaseCalls}`);

let reviewClock = '2026-07-26T00:00:01.000Z';
let expiredReviewCalls = 0;
const expiredBeforeReview = new AutopilotEngine({
  cwd: repo,
  clock: () => reviewClock,
  campaignIntake() {
    return campaignControlFixture('review-expired');
  },
  implementationDispatcher(args) {
    reviewClock = '2026-07-26T00:02:00.000Z';
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'fixture',
        model: 'fixture-implementer',
        branch: args[args.indexOf('--branch') + 1],
        base,
        commit: base,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: repo,
        agent_log: null,
        error: null,
      },
    };
  },
  reviewDispatcher() {
    expiredReviewCalls += 1;
    throw new Error('wall-exhausted campaign must not dispatch review');
  },
  diffProvider() {
    return promptFile;
  },
  gitWorktreeAdd() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      worktree: repo,
      parent: null,
      commit: base,
      observed_commit: base,
      observed_tree_sha: spawnSync(
        'git',
        ['rev-parse', `${base}^{tree}`],
        { cwd: repo, encoding: 'utf8' },
      ).stdout.trim(),
      detached: true,
    };
  },
  gitWorktreeRemove() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
  verifyCommandRunner({ verifyCmd }) {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      executed_argv: ['/bin/sh', '-c', verifyCmd],
    };
  },
}).runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignContract: contractPath,
});
console.log(`expired_review_phase=${expiredBeforeReview.phase}`);
console.log(`expired_review_calls=${expiredReviewCalls}`);

const implementationCalls = [];
const implementationEnvs = [];
const reviewCalls = [];
const verificationEnvs = [];
const identityEngine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:01.000Z',
  campaignIntake() {
    return campaignControlFixture('identity');
  },
  implementationDispatcher(args, options) {
    implementationCalls.push(args);
    implementationEnvs.push(options.env || {});
    const dispatchedBranch = args[args.indexOf('--branch') + 1];
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        status: 'committed',
        runner: 'fixture',
        model: 'fixture-implementer',
        branch: dispatchedBranch,
        base,
        commit: base,
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        worktree: repo,
        agent_log: null,
        error: null,
        containment: 'plain',
        contained: true,
      },
    };
  },
  reviewDispatcher(args) {
    reviewCalls.push(args);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      parseError: null,
      result: {
        runner: 'fixture',
        model: 'fixture-reviewer',
        status: 'reviewed',
        verdict: 'SHIP-AS-IS',
        findings: '',
        raw_log: null,
        error: null,
      },
    };
  },
  diffProvider() {
    return promptFile;
  },
  gitWorktreeAdd() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      worktree: repo,
      parent: null,
      commit: base,
      observed_commit: base,
      observed_tree_sha: spawnSync(
        'git',
        ['rev-parse', `${base}^{tree}`],
        { cwd: repo, encoding: 'utf8' },
      ).stdout.trim(),
      detached: true,
    };
  },
  gitWorktreeRemove() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
  verifyCommandRunner({ env, verifyCmd }) {
    verificationEnvs.push(env);
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
      executed_argv: ['/bin/sh', '-c', verifyCmd],
    };
  },
  gitResumeInspect() {
    resumeInspectCalls += 1;
    throw new Error('managed PREPARED resume must not use legacy branch precheck');
  },
});
process.env.AUTOPILOT_AMBIENT_SECRET = 'must-not-enter-restricted-env';
const identityResult = identityEngine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignManaged: true,
  campaignContract: contractPath,
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman-initial',
      AUTOPILOT_ROOT_RUN_ID: 'foreman-initial',
      AUTOPILOT_DISPATCH_DEPTH: '1',
    },
  },
  verificationEnv: {
    PATH: process.env.PATH || '',
    CI: 'identity-test',
  },
  verificationEnvAllowlist: ['CI'],
});
const roundTwoResult = identityEngine.implementTask({
  promptFile,
  branch: 'impl/icc-p1-intake-repair-r2',
  base,
  roster,
  runId: campaignId,
  ledger: campaignLedger,
  implementationRound: 2,
  implementationStage: 'campaign-implementation',
  campaignContractFile: contractPath,
  campaignContractDigest: 'c'.repeat(64),
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman-round-two',
      AUTOPILOT_DISPATCH_DEPTH: '0',
    },
  },
});
const implementationCallsBeforeMismatch = implementationCalls.length;
const mismatchedRootResult = identityEngine.implementTask({
  promptFile,
  branch: 'impl/icc-p1-intake-mismatched-root',
  base,
  roster,
  runId: `campaign-v1-${'d'.repeat(64)}`,
  ledger: campaignLedger,
  implementationRound: 3,
  implementationStage: 'campaign-implementation',
  campaignContractFile: contractPath,
  campaignContractDigest: 'c'.repeat(64),
  implementationOptions: { env: { PATH: process.env.PATH || '' } },
});
const managedResumeResult = identityEngine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignManaged: true,
  campaignContract: contractPath,
  resume: true,
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman-resume',
      AUTOPILOT_ROOT_RUN_ID: 'foreman-resume',
      AUTOPILOT_DISPATCH_DEPTH: '9'.repeat(100),
    },
  },
});
const implementationsBeforeNoSpec = implementationCalls.length;
const managedNoSpecResult = identityEngine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignManaged: true,
  campaignContract: contractPath,
  noReviewSpec: true,
});
console.log(`identity_status=${identityResult.status}`);
console.log(`identity_phase=${identityResult.phase}`);
console.log(`identity_reason=${identityResult.reason}`);
const argValue = (args, flag) => args ? args[args.indexOf(flag) + 1] : '<missing>';
const implementationArgs = implementationCalls[0];
const roundTwoArgs = implementationCalls[1];
const managedResumeArgs = implementationCalls[2];
console.log(`implementation_ledger=${argValue(implementationArgs, '--ledger')}`);
console.log(`implementation_run_id=${argValue(implementationArgs, '--run-id')}`);
console.log(`implementation_stage=${argValue(implementationArgs, '--stage')}`);
console.log(`implementation_contract=${argValue(implementationArgs, '--campaign-contract')}`);
console.log(`implementation_contract_sha=${argValue(implementationArgs, '--campaign-contract-sha256')}`);
console.log(`review_ledger=${argValue(reviewCalls[0], '--ledger')}`);
console.log(`review_run_id=${argValue(reviewCalls[0], '--run-id')}`);
console.log(`review_stage=${argValue(reviewCalls[0], '--stage')}`);
console.log(`final_review_stage=${argValue(reviewCalls[1], '--stage')}`);
console.log(`round_two_status=${roundTwoResult.status}`);
console.log(`round_two_stage=${argValue(roundTwoArgs, '--stage')}`);
console.log(`managed_resume_status=${managedResumeResult.status}`);
console.log(`managed_resume_phase=${managedResumeResult.phase}`);
console.log(`managed_resume_reason=${managedResumeResult.reason}`);
console.log(`managed_resume_stage=${argValue(managedResumeArgs, '--stage')}`);
console.log(`implementation_root=${implementationEnvs[0].AUTOPILOT_ROOT_RUN_ID}`);
console.log(`round_two_root=${implementationEnvs[1].AUTOPILOT_ROOT_RUN_ID}`);
console.log(`managed_resume_root=${implementationEnvs[2].AUTOPILOT_ROOT_RUN_ID}`);
console.log(`implementation_worktree_root=${implementationEnvs[0].AUTOPILOT_WORKTREE_ROOT_RUN_ID}`);
console.log(`round_two_worktree_root=${implementationEnvs[1].AUTOPILOT_WORKTREE_ROOT_RUN_ID}`);
console.log(`managed_resume_worktree_root=${implementationEnvs[2].AUTOPILOT_WORKTREE_ROOT_RUN_ID}`);
console.log(`worktree_roots_exact=${
  implementationEnvs.every((env) => env.AUTOPILOT_WORKTREE_ROOT_RUN_ID === campaignId)
}`);
console.log(`implementation_parent=${implementationEnvs[0].AUTOPILOT_PARENT_RUN_ID}`);
console.log(`implementation_depth=${implementationEnvs[0].AUTOPILOT_DISPATCH_DEPTH}`);
console.log(`round_two_depth=${implementationEnvs[1].AUTOPILOT_DISPATCH_DEPTH}`);
console.log(`managed_resume_depth=${implementationEnvs[2].AUTOPILOT_DISPATCH_DEPTH}`);
console.log(`restricted_env_leak=${
  implementationEnvs.some((env) => Object.hasOwn(env, 'AUTOPILOT_AMBIENT_SECRET'))
}`);
console.log(`mismatched_root_phase=${mismatchedRootResult.phase}`);
console.log(`mismatched_root_reason=${mismatchedRootResult.reason}`);
console.log(`mismatched_root_dispatch_delta=${
  implementationCalls.length - implementationCallsBeforeMismatch - 1
}`);
console.log(`managed_resume_inspect_calls=${resumeInspectCalls}`);
console.log(`identity_verify_env=${verificationEnvs[0].CI}`);
console.log(
  `identity_tree_is_commit=${identityResult.campaign_receipt.candidate_tree_sha === base}`,
);
console.log(`managed_no_spec_phase=${managedNoSpecResult.phase}`);
console.log(`managed_no_spec_rounds=${managedNoSpecResult.rounds}`);
console.log(`managed_no_spec_impl_delta=${implementationCalls.length - implementationsBeforeNoSpec}`);
NODE
)"
INTAKE_EXIT=$?
assert_exit_code "$INTAKE_EXIT" "0" "ordered intake and marker process exits zero"
assert_contains "$INTAKE_OUT" \
  "ordered=mission,provider_readiness,context_window,worktree_lifecycle,campaign_generation" \
  "intake adapters execute in the frozen owner order"
assert_contains "$INTAKE_OUT" \
  "step_order=mission,campaign_contract,provider_readiness,context_window,worktree_lifecycle,campaign_generation" \
  "contract validation occupies the second intake slot"
assert_contains "$INTAKE_OUT" "admitted=admitted" "valid ordered intake admits"
assert_contains "$INTAKE_OUT" "full_enforcement=true" "all-known injected axes advertise full enforcement"
assert_contains "$INTAKE_OUT" "unpaired_code=mission_adapter_pair_required" \
  "Mission claim cannot run without an installed release adapter"
assert_contains "$INTAKE_OUT" "unpaired_mission_calls=0" \
  "Mission adapter pairing fails before a claim side effect"
assert_contains "$INTAKE_OUT" "thrown_mission_code=mission_claim_adapter_failed" \
  "Mission adapter exceptions become an owned pre-spend rejection"
assert_contains "$INTAKE_OUT" "thrown_mission_release_calls=0" \
  "an adapter exception cannot fabricate a confirmed Mission claim to release"
assert_contains "$INTAKE_OUT" "malformed_mission_code=invalid_mission_claim" \
  "malformed claimed Mission metadata fails closed"
assert_contains "$INTAKE_OUT" "malformed_mission_release_calls=1" \
  "a returned malformed claim is compensated exactly once"
assert_contains "$INTAKE_OUT" "shadow_full_enforcement=false" \
  "an explicitly shadowed ready axis cannot advertise full enforcement"
assert_contains "$INTAKE_OUT" "shadow_axes=provider_readiness" \
  "full-enforcement projection names the explicitly shadowed owner"
assert_contains "$INTAKE_OUT" "rejected=blocked" "readiness rejection blocks intake"
assert_contains "$INTAKE_OUT" "release_calls=1" "post-claim rejection releases Mission exactly once"
assert_contains "$INTAKE_OUT" "no_effect_zero=0" "pre-spend receipt records zero model attempts"
assert_contains "$INTAKE_OUT" "adapter_fault=readiness_adapter_invalid" \
  "sibling adapter faults fail closed under their owning code"
assert_contains "$INTAKE_OUT" "adapter_fault_release_calls=1" \
  "adapter faults still release a claimed Mission exactly once"
assert_contains "$INTAKE_OUT" "invalid_time_status=blocked" \
  "invalid campaign clocks become an owned pre-spend rejection"
assert_contains "$INTAKE_OUT" "invalid_time_code=INVALID_TIMESTAMP" \
  "invalid campaign clocks preserve their reducer-owned error code"
assert_contains "$INTAKE_OUT" "invalid_time_release_calls=1" \
  "state-construction rejection releases a claimed Mission exactly once"
assert_contains "$INTAKE_OUT" "race_code=campaign_contract_changed" \
  "contract replacement between Mission claim and inspection fails closed"
assert_contains "$INTAKE_OUT" "race_release_calls=1" \
  "contract replacement releases the stale Mission claim exactly once"
assert_contains "$INTAKE_OUT" "missing_phase=campaign_intake" \
  "missing managed contract blocks at campaign intake"
assert_contains "$INTAKE_OUT" "missing_rounds=0" "missing contract blocks before round one"
assert_contains "$INTAKE_OUT" "omitted_phase=campaign_intake" \
  "direct engine API omission defaults to managed fail-closed intake"
assert_contains "$INTAKE_OUT" "omitted_rounds=0" \
  "direct engine API omission spawns no implementation round"
assert_contains "$INTAKE_OUT" "drift_phase=campaign_intake" \
  "invalid sealed contract blocks at campaign intake"
assert_contains "$INTAKE_OUT" "drift_code=campaign_contract_drift" \
  "invalid seal marker preserves the owning rejection code"
assert_contains "$INTAKE_OUT" "legacy_api_status=blocked" \
  "direct engine API blocks the L6 legacy compatibility rail"
assert_contains "$INTAKE_OUT" "legacy_api_code=legacy_unmanaged_rejected" \
  "direct engine API emits the machine-readable legacy rejection"
assert_contains "$INTAKE_OUT" "conflicting_mode_status=blocked" \
  "direct engine API rejects conflicting managed and legacy inputs"
assert_contains "$INTAKE_OUT" "conflicting_mode_code=campaign_mode_conflict" \
  "managed and legacy input conflict has a stable machine-readable code"
assert_contains "$INTAKE_OUT" "runner_calls=0" "missing contract spawns no runner"
assert_contains "$INTAKE_OUT" "worktree_calls=0" "invalid or missing contract creates no worktree"
assert_contains "$INTAKE_OUT" "invalid_max_phase=prepare_implementation_loop" \
  "invalid loop limits fail during effect-free local preflight"
assert_contains "$INTAKE_OUT" "invalid_max_intake_calls=0" \
  "invalid loop limits cannot acquire a campaign claim or lease"
assert_contains "$INTAKE_OUT" "phase_resume_status=blocked" \
  "a non-PREPARED managed resume blocks until phase-aware dispatch exists"
assert_contains "$INTAKE_OUT" "phase_resume_calls=0" \
  "a completed mutation cannot be replayed by managed resume"
assert_contains "$INTAKE_OUT" "phase_resume_release_calls=1" \
  "unsupported phase resume releases its unused admission"
assert_contains "$INTAKE_OUT" "file_budget_phase=campaign_wall_budget" \
  "changed-file exhaustion blocks at the mutation budget gate"
assert_contains "$INTAKE_OUT" "file_budget_calls=0" \
  "changed-file exhaustion spawns no implementation model"
assert_contains "$INTAKE_OUT" "file_budget_release_calls=1" \
  "changed-file exhaustion releases its unused admission"
assert_contains "$INTAKE_OUT" "churn_budget_phase=campaign_wall_budget" \
  "churn exhaustion blocks at the mutation budget gate"
assert_contains "$INTAKE_OUT" "churn_budget_calls=0" \
  "churn exhaustion spawns no implementation model"
assert_contains "$INTAKE_OUT" "precondition_status=blocked" \
  "leaf precondition failure remains a blocked campaign result"
assert_contains "$INTAKE_OUT" "precondition_release_calls=1" \
  "zero-spend leaf precondition failure releases campaign admission once"
assert_contains "$INTAKE_OUT" "precondition_release_status=released" \
  "campaign control records the terminal admission release result"
assert_contains "$INTAKE_OUT" "expired_impl_phase=campaign_wall_budget" \
  "zero remaining wall budget blocks before implementation dispatch"
assert_contains "$INTAKE_OUT" "expired_impl_calls=0" \
  "wall-budget exhaustion spawns no implementation model"
assert_contains "$INTAKE_OUT" "expired_release_calls=1" \
  "pre-implementation wall exhaustion releases the unused admission"
assert_contains "$INTAKE_OUT" "expired_review_phase=campaign_wall_budget" \
  "wall budget is rechecked after implementation and before review"
assert_contains "$INTAKE_OUT" "expired_review_calls=0" \
  "wall-budget exhaustion spawns no additional review model"
assert_contains "$INTAKE_OUT" "identity_status=converged" \
  "managed campaign completes through identity-capturing dispatchers"
assert_contains "$INTAKE_OUT" \
  "implementation_ledger=$SBX/.autopilot/identity-ledger.jsonl" \
  "managed implementation receives the campaign ledger"
assert_contains "$INTAKE_OUT" \
  "implementation_run_id=campaign-v1-" \
  "managed implementation receives the campaign run identity"
assert_contains "$INTAKE_OUT" \
  "implementation_stage=campaign-implementation" \
  "managed implementation receives a campaign-owned stage identity"
assert_contains "$INTAKE_OUT" \
  "implementation_contract=$CONTRACT" \
  "managed implementation receives the sealed campaign boundary"
assert_contains "$INTAKE_OUT" \
  "implementation_contract_sha=$(printf 'c%.0s' {1..64})" \
  "managed implementation receives the intake-bound contract digest"
assert_contains "$INTAKE_OUT" \
  "review_ledger=$SBX/.autopilot/identity-ledger.jsonl" \
  "managed review receives the campaign ledger"
assert_contains "$INTAKE_OUT" \
  "review_run_id=campaign-v1-" \
  "managed review receives the campaign run identity"
assert_contains "$INTAKE_OUT" \
  "review_stage=campaign-review#r1" \
  "managed review receives a round-specific campaign stage identity"
assert_contains "$INTAKE_OUT" \
  "final_review_stage=campaign-final-review" \
  "managed campaign performs one separately identified final panel"
assert_contains "$INTAKE_OUT" "round_two_status=committed" \
  "managed round-two implementation dispatches successfully"
assert_contains "$INTAKE_OUT" "round_two_stage=campaign-implementation#r2" \
  "managed repair rounds receive distinct implementation stage identities"
assert_contains "$INTAKE_OUT" "managed_resume_status=converged" \
  "managed PREPARED resume continues through campaign implementation"
assert_contains "$INTAKE_OUT" "managed_resume_stage=campaign-implementation" \
  "managed PREPARED resume dispatches the first campaign implementation round"
assert_contains "$INTAKE_OUT" "implementation_root=foreman-initial" \
  "managed implementation preserves the watcher lineage root"
assert_contains "$INTAKE_OUT" "round_two_root=foreman-round-two" \
  "managed repair preserves its current foreman watcher lineage"
assert_contains "$INTAKE_OUT" "managed_resume_root=foreman-resume" \
  "managed resume remains visible to the replacement foreman watcher"
assert_contains "$INTAKE_OUT" "implementation_worktree_root=campaign-v1-" \
  "managed implementation derives resource root from sealed campaign identity"
assert_contains "$INTAKE_OUT" "round_two_worktree_root=campaign-v1-" \
  "managed repair preserves the campaign resource root"
assert_contains "$INTAKE_OUT" "managed_resume_worktree_root=campaign-v1-" \
  "managed resume preserves the original campaign resource root"
assert_contains "$INTAKE_OUT" "worktree_roots_exact=true" \
  "initial, repair, and resume roots equal the sealed campaign identity"
assert_contains "$INTAKE_OUT" "implementation_parent=foreman-initial" \
  "managed implementation starts observable lineage under its foreman"
assert_contains "$INTAKE_OUT" "implementation_depth=1" \
  "managed implementation injects explicit first-leaf depth"
assert_contains "$INTAKE_OUT" "round_two_depth=1" \
  "managed implementation cannot disable budgeting with zero depth"
assert_contains "$INTAKE_OUT" "managed_resume_depth=1" \
  "managed resume repairs malformed inherited depth before dispatch"
assert_contains "$INTAKE_OUT" "restricted_env_leak=false" \
  "managed lineage injection preserves an explicitly restricted dispatcher env"
assert_contains "$INTAKE_OUT" "mismatched_root_phase=prepare_implementation" \
  "well-formed mismatched campaign root blocks before dispatch"
assert_contains "$INTAKE_OUT" \
  "mismatched_root_reason=managed campaign run id does not match the sealed contract identity" \
  "mismatched campaign root rejection names the sealed-identity mismatch"
assert_contains "$INTAKE_OUT" "mismatched_root_dispatch_delta=0" \
  "mismatched campaign root spends no implementation call"
assert_contains "$INTAKE_OUT" "managed_resume_inspect_calls=0" \
  "managed campaign replay does not require the legacy ahead-branch precheck"
assert_contains "$INTAKE_OUT" "identity_verify_env=identity-test" \
  "verification executes with the environment used by its fingerprint"
assert_contains "$INTAKE_OUT" "identity_tree_is_commit=false" \
  "verification identity binds the Git tree object rather than the commit"
assert_contains "$INTAKE_OUT" "managed_no_spec_phase=campaign_review_spec" \
  "managed campaign cannot omit the frozen review specification"
assert_contains "$INTAKE_OUT" "managed_no_spec_rounds=0" \
  "missing managed review specification blocks before round one"
assert_contains "$INTAKE_OUT" "managed_no_spec_impl_delta=0" \
  "missing managed review specification blocks before model spend"

CAMPAIGN_LEDGER="$COMMON_DIR/autopilot/implementation-campaign.jsonl"
DEFAULT_INTAKE_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const [root, repo, contractPath, sealPath, promptFile, base, ledgerPath] = process.argv.slice(2);
const {
  campaignIdFor,
  releaseCampaignAdmission,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const commonInput = {
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  roster: { implementer_engine: 'fixture-implementer' },
};
const adapters = {
  now: () => '2026-07-26T00:00:00.000Z',
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const contractDigest = crypto.createHash('sha256')
  .update(fs.readFileSync(contractPath))
  .digest('hex');
const commonRaw = spawnSync(
  'git',
  ['-C', repo, 'rev-parse', '--git-common-dir'],
  { encoding: 'utf8' },
).stdout.trim();
const commonDir = fs.realpathSync(
  path.isAbsolute(commonRaw) ? commonRaw : path.resolve(repo, commonRaw),
);
const campaignId = campaignIdFor(
  `git-common-dir:${commonDir}`,
  contract.ticket,
  contractDigest,
);
const ledgerScript = path.join(root, 'scripts', 'run-ledger.sh');
function runLedger(args) {
  const result = spawnSync('bash', [ledgerScript, ...args], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `run-ledger exited ${result.status}`);
  }
  return JSON.parse(result.stdout);
}
runLedger(['init', '--ledger', ledgerPath]);
const abandoned = runLedger([
  'stage-acquire',
  '--ledger', ledgerPath,
  '--run-id', campaignId,
  '--stage', 'campaign',
  '--pid', String(process.pid),
  '--resources', `campaign:${campaignId}`,
  '--exclusive-live',
]);
runLedger([
  'stage-transition',
  '--ledger', ledgerPath,
  '--run-id', campaignId,
  '--stage', 'campaign',
  '--generation', String(abandoned.generation),
  '--nonce', abandoned.nonce,
  '--to-state', 'dead',
  '--idempotency-key', 'fixture-journal-abandon',
]);
const alternatePath = path.join(repo, 'alternate-campaign.jsonl');
const alternate = runCampaignIntake({
  ...commonInput,
  ledgerPath: alternatePath,
}, adapters);
const result = runCampaignIntake({
  ...commonInput,
  ledgerPath,
}, adapters);
let durableMissionReleaseCalls = 0;
const claimedControl = {
  ...result,
  steps: result.steps.map((entry) => entry.owner === 'mission'
    ? { owner: 'mission', status: 'claimed', claim_id: 'claim-durable-release' }
    : entry),
};
const releaseAdapters = {
  ...adapters,
  releaseMission() {
    durableMissionReleaseCalls += 1;
    return { owner: 'mission_release', status: 'released' };
  },
};
const admissionRelease = releaseCampaignAdmission({
  repo,
  campaignControl: claimedControl,
  rejection: {
    owner: 'implementation_dispatch',
    status: 'rejected',
    code: 'fixture_pre_spend_rejection',
    reason: 'fixture leaf precondition failed',
  },
  observedAt: '2026-07-26T00:00:00.500Z',
}, releaseAdapters);
const replayedAdmissionRelease = releaseCampaignAdmission({
  repo,
  campaignControl: claimedControl,
  rejection: {
    owner: 'implementation_dispatch',
    status: 'rejected',
    code: 'fixture_pre_spend_rejection',
    reason: 'fixture leaf precondition failed',
  },
  observedAt: '2026-07-26T00:00:01.500Z',
}, releaseAdapters);
console.log(`durable_mission_release_calls=${durableMissionReleaseCalls}`);
console.log(`replayed_release_status=${replayedAdmissionRelease.status}`);
console.log(`replayed_release_receipt_match=${
  replayedAdmissionRelease.pre_spend_no_effect_receipt.receipt_digest
    === admissionRelease.pre_spend_no_effect_receipt.receipt_digest
}`);
const releasedLease = fs.readFileSync(ledgerPath, 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse)
  .filter((row) => row.run_id === campaignId
    && row.kind === 'stage'
    && row.stage === 'campaign')
  .at(-1);
console.log(`replayed_release_lease_state=${releasedLease.state}`);

const crashContractPath = path.join(path.dirname(contractPath), 'crash-campaign.json');
const crashSealPath = path.join(path.dirname(sealPath), 'crash-campaign.seal.json');
const crashContract = {
  ...contract,
  ticket: 'icc-p1-crash',
  branch: 'impl/icc-p1-crash',
};
fs.writeFileSync(crashContractPath, `${JSON.stringify(crashContract, null, 2)}\n`);
const crashSeal = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal',
  '--contract', crashContractPath,
  '--repo', repo,
  '--mission-mode', 'shadow',
  '--out', crashSealPath,
], {
  cwd: repo,
  encoding: 'utf8',
});
if (crashSeal.status !== 0) throw new Error(crashSeal.stderr || 'crash campaign seal failed');
const crashDigest = crypto.createHash('sha256')
  .update(fs.readFileSync(crashContractPath))
  .digest('hex');
const crashCampaignId = campaignIdFor(
  `git-common-dir:${commonDir}`,
  crashContract.ticket,
  crashDigest,
);
const exitedProcess = spawnSync(process.execPath, ['-e', '']);
runLedger([
  'stage-acquire',
  '--ledger', ledgerPath,
  '--run-id', crashCampaignId,
  '--stage', 'campaign',
  '--pid', String(exitedProcess.pid),
  '--resources', `campaign:${crashCampaignId}`,
  '--exclusive-live',
]);
const crashResult = runCampaignIntake({
  ...commonInput,
  contractPath: crashContractPath,
  sealPath: crashSealPath,
  branch: crashContract.branch,
  ledgerPath,
}, adapters);
console.log(`alternate_code=${alternate.rejection.code}`);
console.log(`alternate_exists=${fs.existsSync(alternatePath)}`);
console.log(`recovered_generation=${result.generation_claim.generation}`);
console.log(`admission_release_status=${admissionRelease.status}`);
console.log(`crash_recovered_generation=${crashResult.generation_claim.generation}`);
console.log(JSON.stringify(result));
NODE
)"
DEFAULT_INTAKE_EXIT=$?
assert_exit_code "$DEFAULT_INTAKE_EXIT" "0" "default generation claim writes a durable ledger"
assert_contains "$DEFAULT_INTAKE_OUT" "alternate_code=campaign_ledger_path_mismatch" \
  "alternate ledger paths cannot create an independent campaign authority"
assert_contains "$DEFAULT_INTAKE_OUT" "alternate_exists=false" \
  "alternate ledger rejection occurs before any ledger mutation"
assert_contains "$DEFAULT_INTAKE_OUT" "recovered_generation=2" \
  "a dead pre-journal claim reopens without stranding campaign identity"
assert_contains "$DEFAULT_INTAKE_OUT" "admission_release_status=released" \
  "post-admission zero-spend cleanup durably releases the campaign lease"
assert_contains "$DEFAULT_INTAKE_OUT" "durable_mission_release_calls=1" \
  "replaying a completed release does not call the Mission adapter twice"
assert_contains "$DEFAULT_INTAKE_OUT" "replayed_release_status=released" \
  "a completed admission release replays idempotently"
assert_contains "$DEFAULT_INTAKE_OUT" "replayed_release_receipt_match=true" \
  "release replay returns the originally journaled no-effect receipt"
assert_contains "$DEFAULT_INTAKE_OUT" "replayed_release_lease_state=dead" \
  "release completion and lease transition remain distinct durable operations"
assert_contains "$DEFAULT_INTAKE_OUT" "crash_recovered_generation=2" \
  "a leased intake claim owned by a dead process recovers after the crash window"
CAMPAIGN_ID="$(node -e \
  'const lines=process.argv[1].trim().split("\n"); const v=JSON.parse(lines.at(-1)); process.stdout.write(v.campaign_id || "")' \
  "$DEFAULT_INTAKE_OUT")"
assert_neq "$CAMPAIGN_ID" "" "default intake returns a campaign id"

INSPECT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$CAMPAIGN_LEDGER" 2>&1)"
assert_exit_code "$?" "0" "campaign inspect reads the durable intake"
assert_contains "$INSPECT_OUT" '"status":"found"' "campaign inspect returns found"
assert_contains "$INSPECT_OUT" '"phase":"PREPARED"' "campaign inspect projects the initial state"

DEFAULT_PATH_INSPECT_OUT="$(cd "$SBX" && node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" 2>&1)"
assert_exit_code "$?" "0" "campaign inspect derives the canonical ledger by default"
assert_contains "$DEFAULT_PATH_INSPECT_OUT" '"status":"found"' \
  "default campaign CLI path matches intake's Git-common-dir ledger"

RESUME_OUT="$(node - "$REPO_ROOT" "$SBX" "$CAMPAIGN_ID" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const [root, repo, campaignId, ledger] = process.argv.slice(2);
const { runCampaignCli } = require(path.join(root, 'src', 'campaign', 'cli'));
process.exitCode = runCampaignCli([
  'resume',
  '--campaign-id', campaignId,
  '--ledger', ledger,
], {
  cwd: repo,
  now: () => '2026-07-26T00:00:01.000Z',
});
NODE
)"
assert_exit_code "$?" "0" "campaign resume accepts a dead prior process lease"
assert_contains "$RESUME_OUT" '"status":"resumable"' "campaign resume is machine-readable"
assert_contains "$RESUME_OUT" '"resume_required":true' "campaign resume preserves generation state"

RESUME_INTAKE_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base, ledgerPath] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
const input = {
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  ledgerPath,
  roster: { implementer_engine: 'fixture-implementer' },
};
const implicit = runCampaignIntake({
  ...input,
  observedAt: '2026-07-26T00:00:01.000Z',
}, adapters);
const resumed = runCampaignIntake({
  ...input,
  resume: true,
  observedAt: '2026-07-26T00:00:02.000Z',
}, adapters);
console.log(`implicit_code=${implicit.rejection.code}`);
console.log(`resumed_status=${resumed.status}`);
console.log(`resumed_events=${resumed.initial_state.event_count}`);
console.log(`resumed_elapsed=${resumed.initial_state.usage.elapsed_wall_seconds}`);
NODE
)"
assert_exit_code "$?" "0" "durable resume intake process exits zero"
assert_contains "$RESUME_INTAKE_OUT" "implicit_code=campaign_resume_required" \
  "existing campaign cannot reset through an implicit fresh intake"
assert_contains "$RESUME_INTAKE_OUT" "resumed_status=admitted" \
  "explicit resume reacquires the durable campaign"
assert_contains "$RESUME_INTAKE_OUT" "resumed_events=1" \
  "explicit resume appends a reducer-validated durable event"
assert_contains "$RESUME_INTAKE_OUT" "resumed_elapsed=2" \
  "explicit resume preserves the campaign clock"

MISSING_STAGE_LEDGER="$TEST_TMP/missing-stage-campaign-ledger.jsonl"
node - "$CAMPAIGN_LEDGER" "$MISSING_STAGE_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [source, target, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
const retained = rows.filter(
  (row) => !(row.run_id === campaignId && row.kind === 'stage' && row.stage === 'campaign'),
);
fs.writeFileSync(target, `${retained.map(JSON.stringify).join('\n')}\n`);
NODE
MISSING_STAGE_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$MISSING_STAGE_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects an intake with deleted stage history"
assert_contains "$MISSING_STAGE_OUT" "no stage history" \
  "durable campaign root requires its generation lease evidence"

MALFORMED_LEASE_LEDGER="$TEST_TMP/malformed-lease-campaign-ledger.jsonl"
node - "$CAMPAIGN_LEDGER" "$MALFORMED_LEASE_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [source, target, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
const indexes = rows
  .map((row, index) => ({ row, index }))
  .filter(({ row }) => row.run_id === campaignId
    && row.kind === 'stage'
    && row.stage === 'campaign');
delete rows[indexes.at(-1).index].pid;
fs.writeFileSync(target, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
MALFORMED_LEASE_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$MALFORMED_LEASE_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects a leased stage without process identity"
assert_contains "$MALFORMED_LEASE_OUT" "live lease identity is malformed" \
  "malformed liveness evidence cannot become a dead lease"

UNKNOWN_STAGE_LEDGER="$TEST_TMP/unknown-stage-campaign-ledger.jsonl"
node - "$CAMPAIGN_LEDGER" "$UNKNOWN_STAGE_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [source, target, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(source, 'utf8').trim().split('\n').map(JSON.parse);
const indexes = rows
  .map((row, index) => ({ row, index }))
  .filter(({ row }) => row.run_id === campaignId
    && row.kind === 'stage'
    && row.stage === 'campaign');
rows[indexes.at(-1).index].state = 'mystery';
fs.writeFileSync(target, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
UNKNOWN_STAGE_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign resume \
  --campaign-id "$CAMPAIGN_ID" --ledger "$UNKNOWN_STAGE_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign resume rejects an unknown latest stage state"
assert_contains "$UNKNOWN_STAGE_OUT" "latest stage evidence is malformed" \
  "unknown stage state cannot project as a dead resumable lease"

LEASE_ROWS_BEFORE="$(jq -s --arg id "$CAMPAIGN_ID" \
  '[.[] | select(.kind == "stage" and .run_id == $id and .stage == "campaign")] | length' \
  "$CAMPAIGN_LEDGER")"
EXACT_BUDGET_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base, ledgerPath] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const result = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  ledgerPath,
  resume: true,
  observedAt: '2026-07-26T00:02:00.000Z',
  roster: { implementer_engine: 'fixture-implementer' },
}, {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
console.log(`status=${result.status}`);
console.log(`code=${result.rejection.code}`);
NODE
)"
assert_exit_code "$?" "0" "exact-budget resume intake process exits zero"
assert_contains "$EXACT_BUDGET_OUT" "status=blocked" \
  "resume at the exact wall-clock ceiling is rejected"
assert_contains "$EXACT_BUDGET_OUT" "code=campaign_wall_budget_exhausted" \
  "exact wall-clock exhaustion has a stable campaign-owned rejection code"

OVER_BUDGET_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base, ledgerPath] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const result = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  ledgerPath,
  resume: true,
  observedAt: '2026-07-26T00:03:00.000Z',
  roster: { implementer_engine: 'fixture-implementer' },
}, {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
console.log(`status=${result.status}`);
console.log(`code=${result.rejection.code}`);
NODE
)"
assert_exit_code "$?" "0" "over-budget resume intake process exits zero"
LEASE_ROWS_AFTER="$(jq -s --arg id "$CAMPAIGN_ID" \
  '[.[] | select(.kind == "stage" and .run_id == $id and .stage == "campaign")] | length' \
  "$CAMPAIGN_LEDGER")"
assert_contains "$OVER_BUDGET_OUT" "status=blocked" \
  "over-budget resume is rejected"
assert_contains "$OVER_BUDGET_OUT" "code=WALL_BUDGET_EXCEEDED" \
  "resume preflight preserves the reducer budget verdict"
assert_eq "$LEASE_ROWS_AFTER" "$LEASE_ROWS_BEFORE" \
  "rejected resume preflight does not acquire a durable lease"

SEMANTIC_CORRUPT_LEDGER="$TEST_TMP/semantic-corrupt-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$SEMANTIC_CORRUPT_LEDGER"
node - "$REPO_ROOT" "$SEMANTIC_CORRUPT_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, ledger, campaignId] = process.argv.slice(2);
const { canonicalDigest } = require(path.join(root, 'src', 'engine'));
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const intake = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_intake');
const payload = JSON.parse(intake.payload);
payload.initial_state.usage.changed_files = 1;
payload.initial_state_digest = canonicalDigest(payload.initial_state);
intake.payload = JSON.stringify(payload);
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
SEMANTIC_CORRUPT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$SEMANTIC_CORRUPT_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects a digest-valid forged initial state"
assert_contains "$SEMANTIC_CORRUPT_OUT" "initial campaign usage must start at zero" \
  "campaign projection validates initial-state semantics after digest binding"

WRAPPER_DRIFT_LEDGER="$TEST_TMP/wrapper-drift-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$WRAPPER_DRIFT_LEDGER"
node - "$WRAPPER_DRIFT_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const intake = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_intake');
const payload = JSON.parse(intake.payload);
payload.campaign_id = `campaign-v1-${'b'.repeat(64)}`;
intake.payload = JSON.stringify(payload);
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
WRAPPER_DRIFT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$WRAPPER_DRIFT_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects an intake wrapper identity mismatch"
assert_contains "$WRAPPER_DRIFT_OUT" "invalid intake state binding" \
  "intake wrapper identity is bound to the requested campaign"

DUPLICATE_ROOT_LEDGER="$TEST_TMP/duplicate-root-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$DUPLICATE_ROOT_LEDGER"
node - "$DUPLICATE_ROOT_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const intake = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_intake');
fs.appendFileSync(ledger, `${JSON.stringify(intake)}\n`);
NODE
DUPLICATE_ROOT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$DUPLICATE_ROOT_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects duplicate intake roots"
assert_contains "$DUPLICATE_ROOT_OUT" "exactly one intake root" \
  "campaign projection has one unambiguous durable root"

EVENT_WRAPPER_LEDGER="$TEST_TMP/event-wrapper-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$EVENT_WRAPPER_LEDGER"
node - "$EVENT_WRAPPER_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const event = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_event');
const payload = JSON.parse(event.payload);
payload.contract_digest = 'b'.repeat(64);
event.payload = JSON.stringify(payload);
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
EVENT_WRAPPER_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$EVENT_WRAPPER_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects event wrapper identity drift"
assert_contains "$EVENT_WRAPPER_OUT" "invalid event wrapper binding" \
  "event wrappers stay bound to the durable campaign root"

EVENT_LEASE_LEDGER="$TEST_TMP/event-lease-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$EVENT_LEASE_LEDGER"
node - "$EVENT_LEASE_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const event = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_event');
event.generation += 1;
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
EVENT_LEASE_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$EVENT_LEASE_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect rejects an event from an unowned generation"
assert_contains "$EVENT_LEASE_OUT" "journal is not bound to the active generation lease" \
  "campaign events bind to their exact ledger generation and nonce"

FORGED_TRANSITION_LEDGER="$TEST_TMP/forged-transition-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$FORGED_TRANSITION_LEDGER"
node - "$FORGED_TRANSITION_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const latest = rows
  .filter((row) => row.run_id === campaignId
    && row.kind === 'stage'
    && row.stage === 'campaign')
  .at(-1);
rows.push({
  ...latest,
  state: 'dead',
  generation: latest.generation + 7,
  reason: 'transition',
  transition_from: 'leased',
});
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
FORGED_TRANSITION_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign resume \
  --campaign-id "$CAMPAIGN_ID" --ledger "$FORGED_TRANSITION_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign resume rejects a transition without its generation lease"
assert_contains "$FORGED_TRANSITION_OUT" "stage transition chain is invalid" \
  "a forged terminal row cannot supersede the authoritative lease chain"

ROOT_DRIFT_BACKUP="$TEST_TMP/campaign-root-backup.jsonl"
cp "$CAMPAIGN_LEDGER" "$ROOT_DRIFT_BACKUP"
node - "$REPO_ROOT" "$CAMPAIGN_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, ledger, campaignId] = process.argv.slice(2);
const { canonicalDigest } = require(path.join(root, 'src', 'engine'));
const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
const intake = rows.find((row) => row.run_id === campaignId && row.op === 'campaign_intake');
const payload = JSON.parse(intake.payload);
payload.initial_state.limits.max_wall_seconds += 1;
payload.initial_state_digest = canonicalDigest(payload.initial_state);
intake.payload = JSON.stringify(payload);
fs.writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
NODE
ROOT_DRIFT_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
  "$BASE_SHA" "$CAMPAIGN_LEDGER" <<'NODE'
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base, ledgerPath] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const result = runCampaignIntake({
  repo,
  contractPath,
  sealPath,
  promptFile,
  base,
  branch: 'impl/icc-p1-intake',
  ledgerPath,
  resume: true,
  observedAt: '2026-07-26T00:00:03.000Z',
  roster: { implementer_engine: 'fixture-implementer' },
}, {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
console.log(`status=${result.status}`);
console.log(`code=${result.rejection.code}`);
NODE
)"
ROOT_DRIFT_EXIT=$?
cp "$ROOT_DRIFT_BACKUP" "$CAMPAIGN_LEDGER"
assert_exit_code "$ROOT_DRIFT_EXIT" "0" "campaign root-drift resume process exits zero"
assert_contains "$ROOT_DRIFT_OUT" "status=blocked" \
  "resume rejects a ledger root that differs from the sealed contract"
assert_contains "$ROOT_DRIFT_OUT" "code=campaign_state_contract_mismatch" \
  "campaign root drift preserves a machine-readable rejection code"

CORRUPT_LEDGER="$TEST_TMP/corrupt-campaign-ledger.jsonl"
cp "$CAMPAIGN_LEDGER" "$CORRUPT_LEDGER"
node - "$CORRUPT_LEDGER" "$CAMPAIGN_ID" <<'NODE'
const fs = require('fs');
const [ledger, campaignId] = process.argv.slice(2);
fs.appendFileSync(ledger, `${JSON.stringify({
  kind: 'journal',
  run_id: campaignId,
  stage: 'campaign',
  op: 'campaign_event',
  payload: '{not-json',
})}\n`);
NODE
CORRUPT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$CORRUPT_LEDGER" 2>&1)"
assert_exit_code "$?" "1" "campaign inspect fails closed on a corrupt event payload"
assert_contains "$CORRUPT_OUT" "invalid JSON payload" \
  "campaign projection names corrupt payload evidence"

LIVENESS_OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { processLiveness } = require(path.join(root, 'src', 'campaign', 'cli'));
console.log(processLiveness({
  state: 'leased',
  pid: process.pid,
  start_time: 0,
}));
console.log(processLiveness({
  state: 'leased',
}));
console.log(processLiveness({
  state: 'mystery',
}));
NODE
)"
assert_exit_code "$?" "0" "portable liveness projection process exits zero"
assert_eq "$(printf '%s\n' "$LIVENESS_OUT" | sed -n '1p')" "unknown" \
  "unverifiable live process identity fails closed as unknown"
assert_eq "$(printf '%s\n' "$LIVENESS_OUT" | sed -n '2p')" "unknown" \
  "missing leased process identity fails closed as unknown"
assert_eq "$(printf '%s\n' "$LIVENESS_OUT" | sed -n '3p')" "unknown" \
  "unknown ledger state fails closed as unknown"

ELIGIBILITY_OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const {
  campaignResumeEligibility,
} = require(path.join(root, 'src', 'campaign', 'cli'));
const state = {
  phase: 'PREPARED',
  live_lease: null,
  started_at: '2026-07-26T00:00:00.000Z',
  usage: { changed_files: 0, churn: 0 },
  limits: { max_changed_files: 4, max_churn: 8, max_wall_seconds: 120 },
};
const projection = {
  state,
  latest_lease: { state: 'dead' },
};
const code = (candidate, now = '2026-07-26T00:00:01.000Z') =>
  campaignResumeEligibility(candidate, now).reason_code || 'resumable';
console.log(code(projection));
console.log(code({ ...projection, state: { ...state, live_lease: { generation: 0 } } }));
console.log(code({ ...projection, state: { ...state, phase: 'REVIEWING' } }));
console.log(code({
  ...projection,
  state: { ...state, usage: { ...state.usage, changed_files: 4 } },
}));
console.log(code({
  ...projection,
  state: { ...state, usage: { ...state.usage, churn: 8 } },
}));
console.log(code(projection, '2026-07-26T00:02:00.000Z'));
NODE
)"
assert_exit_code "$?" "0" "campaign resume eligibility table process exits zero"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '1p')" "resumable" \
  "eligible PREPARED campaign remains resumable"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '2p')" \
  "campaign_state_lease_open" "open reducer mutation lease blocks resume projection"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '3p')" \
  "campaign_resume_phase_unsupported" "unsupported reducer phase blocks resume projection"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '4p')" \
  "campaign_file_budget_exhausted" "file cap blocks resume projection"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '5p')" \
  "campaign_churn_budget_exhausted" "churn cap blocks resume projection"
assert_eq "$(printf '%s\n' "$ELIGIBILITY_OUT" | sed -n '6p')" \
  "campaign_wall_budget_exhausted" "wall cap blocks resume projection"

SPACE_LEDGER="$TEST_TMP/space-name-ledger.jsonl"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$SPACE_LEDGER" >/dev/null
node -e "process.title = 'campaign worker'; setTimeout(() => {}, 30000)" &
SPACE_PID=$!
sleep 0.1
SPACE_LEASE="$(bash "$REPO_ROOT/scripts/run-ledger.sh" stage-acquire \
  --ledger "$SPACE_LEDGER" --run-id campaign-space --stage campaign \
  --pid "$SPACE_PID" --resources campaign:space --exclusive-live)"
assert_exit_code "$?" "0" "lease records a process whose kernel name contains spaces"
SPACE_LIVENESS="$(node - "$REPO_ROOT" "$SPACE_LEASE" <<'NODE'
const path = require('path');
const [root, raw] = process.argv.slice(2);
const { processLiveness } = require(path.join(root, 'src', 'campaign', 'cli'));
console.log(processLiveness(JSON.parse(raw)));
NODE
)"
assert_exit_code "$?" "0" "space-name liveness comparison process exits zero"
assert_eq "$SPACE_LIVENESS" "alive" \
  "shell and Node derive the same start time for a process name containing spaces"
kill "$SPACE_PID" 2>/dev/null || true
wait "$SPACE_PID" 2>/dev/null || true

LEDGER="$TEST_TMP/exclusive-ledger.jsonl"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER" >/dev/null
FIRST_LEASE="$(bash "$REPO_ROOT/scripts/run-ledger.sh" stage-acquire \
  --ledger "$LEDGER" --run-id campaign-exclusive --stage campaign \
  --pid "$$" --resources campaign:exclusive --exclusive-live 2>&1)"
assert_exit_code "$?" "0" "exclusive campaign lease acquires once"
SECOND_LEASE="$(bash "$REPO_ROOT/scripts/run-ledger.sh" stage-acquire \
  --ledger "$LEDGER" --run-id campaign-exclusive --stage campaign \
  --pid "$$" --resources campaign:exclusive --exclusive-live 2>&1)"
assert_exit_code "$?" "1" "second live campaign lease is rejected"
assert_contains "$SECOND_LEASE" "already has a live lease" \
  "exclusive ledger rejection names the live lease"

finalize_test
