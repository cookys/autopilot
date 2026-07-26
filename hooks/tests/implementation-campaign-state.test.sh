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
    campaign_id: campaignIdFor('git-common-dir:/fixture', 'icc-p1'),
    contract_digest: D,
    generation,
    idempotency_key: overrides.key || `event-${sequence}`,
    input_artifact_digest: overrides.input || D,
    output_artifact_digest: overrides.output || D,
    timestamp: `2026-07-26T00:00:${String(sequence).padStart(2, '0')}.000Z`,
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
  state = apply(state, E.IMPLEMENTATION_COMPLETED, 0, { scope_check_passed: true }, {
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
state = apply(state, E.IMPLEMENTATION_COMPLETED, 0, { scope_check_passed: true }, {
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
  repair_gate_passed: true,
}, { changed: 1, churn: 2 });
state = apply(state, E.REPAIR_STARTED, 1, { sealed_contract: true }, {
  changed: 1,
  churn: 2,
});
state = apply(state, E.REPAIR_COMPLETED, 1, { scope_check_passed: true }, {
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
const terminalEvent = event(E.TERMINAL_READY, 1, { reason: 'acceptance verified' }, {
  changed: 2,
  churn: 4,
});
state = reduceCampaignState(state, terminalEvent);
assert.strictEqual(state.phase, S.TERMINAL_READY);
assert.strictEqual(state.generation, 1);
assert.strictEqual(reduceCampaignState(state, terminalEvent), state);

sequence = 0;
const resumed = apply(initial(), E.RESUMED, 0, {});
assert.strictEqual(resumed.phase, S.PREPARED);
assert.strictEqual(resumed.event_count, 1);

let followUp = adjudicating();
followUp = apply(
  followUp,
  E.TERMINAL_FOLLOW_UP,
  0,
  { reason: 'bounded follow-up required' },
  { changed: 1, churn: 2 },
);
assert.strictEqual(followUp.phase, S.TERMINAL_FOLLOW_UP);

sequence = 0;
const stopped = apply(
  initial(),
  E.TERMINAL_STOP,
  0,
  { reason: 'operator stop' },
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
expectCode('SCOPE_CHECK_REQUIRED', () => apply(
  leased,
  E.IMPLEMENTATION_COMPLETED,
  0,
  { scope_check_passed: false },
));

sequence = 0;
let vertical = apply(initial(), E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
vertical = apply(vertical, E.IMPLEMENTATION_COMPLETED, 0, { scope_check_passed: true });
expectCode('VERTICAL_EVIDENCE_REQUIRED', () => apply(
  vertical,
  E.VERTICAL_VERIFIED,
  0,
  { passed: true, evidence_digest: 'bad' },
));

let adjudicated = adjudicating();
expectCode('REGISTRY_INCOMPLETE', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  { registry_complete: false, repair_gate_passed: true },
  { changed: 1, churn: 2 },
));
expectCode('REPAIR_GATE_REQUIRED', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  { registry_complete: true, repair_gate_passed: false },
  { changed: 1, churn: 2 },
));

const noRepairContract = { ...contract, max_repair_generations: 0 };
adjudicated = adjudicating(noRepairContract);
expectCode('REPAIR_BUDGET_EXCEEDED', () => apply(
  adjudicated,
  E.REPAIR_AUTHORIZED,
  1,
  { registry_complete: true, repair_gate_passed: true },
  { changed: 1, churn: 2 },
));

sequence = 0;
let progressed = apply(initial(), E.IMPLEMENTATION_STARTED, 0, { sealed_contract: true });
progressed = apply(progressed, E.IMPLEMENTATION_COMPLETED, 0, { scope_check_passed: true }, {
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

console.log('valid_terminal=true');
console.log('valid_resume=true');
console.log('valid_follow_up=true');
console.log('valid_stop=true');
console.log('idempotent_terminal=true');
console.log('skipped_phase_rejected=true');
console.log('unsealed_mutation_rejected=true');
console.log('second_live_lease_rejected=true');
console.log('scope_gate_required=true');
console.log('vertical_evidence_required=true');
console.log('registry_completeness_required=true');
console.log('repair_gate_required=true');
console.log('repair_ceiling_enforced=true');
console.log('resume_budget_reset_rejected=true');
console.log('resume_clock_reset_rejected=true');
console.log('idempotency_conflict_rejected=true');
NODE
)"
PURE_EXIT=$?
assert_exit_code "$PURE_EXIT" "0" "pure campaign state-table process exits zero"
for key in valid_terminal valid_resume valid_follow_up valid_stop \
  idempotent_terminal skipped_phase_rejected \
  unsealed_mutation_rejected second_live_lease_rejected scope_gate_required \
  vertical_evidence_required registry_completeness_required repair_gate_required \
  repair_ceiling_enforced resume_budget_reset_rejected resume_clock_reset_rejected \
  idempotency_conflict_rejected; do
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
const path = require('path');
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
const { AutopilotEngine, runCampaignIntake } = require(path.join(root, 'src', 'engine'));
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
  campaignManaged: true,
  campaignContract: path.join(repo, 'missing-contract.json'),
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
console.log(`missing_phase=${missing.phase}`);
console.log(`missing_rounds=${missing.rounds}`);
console.log(`drift_phase=${drifted.phase}`);
console.log(`drift_code=${drifted.campaign_control.rejection.code}`);
console.log(`runner_calls=${markers.runner}`);
console.log(`worktree_calls=${markers.worktree}`);

const campaignId = `campaign-v1-${'c'.repeat(64)}`;
const campaignLedger = path.join(repo, '.autopilot', 'identity-ledger.jsonl');
let implementationArgs = null;
let reviewArgs = null;
const identityEngine = new AutopilotEngine({
  cwd: repo,
  campaignIntake() {
    return {
      status: 'admitted',
      reason: null,
      campaign_id: campaignId,
      contract_digest: 'c'.repeat(64),
      contract: {
        verify_cmd: 'fixture verify',
        max_repair_generations: 2,
      },
      generation_claim: {
        ledger: campaignLedger,
        generation: 1,
        nonce: 'identity',
        stage_identity: 'run-ledger:1:identity',
      },
      full_enforcement: false,
      shadow_axes: ['mission'],
      steps: [],
    };
  },
  implementationDispatcher(args) {
    implementationArgs = args;
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
        branch: 'impl/icc-p1-intake',
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
    reviewArgs = args;
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
  verifyCommandRunner() {
    return {
      error: null,
      status: 0,
      signal: null,
      stdout: '',
      stderr: '',
    };
  },
});
const identityResult = identityEngine.runImplementationReviewLoop({
  promptFile,
  branch: 'impl/icc-p1-intake',
  base,
  roster,
  campaignManaged: true,
  campaignContract: contractPath,
});
console.log(`identity_status=${identityResult.status}`);
const argValue = (args, flag) => args[args.indexOf(flag) + 1];
console.log(`implementation_ledger=${argValue(implementationArgs, '--ledger')}`);
console.log(`implementation_run_id=${argValue(implementationArgs, '--run-id')}`);
console.log(`implementation_stage=${argValue(implementationArgs, '--stage')}`);
console.log(`review_ledger=${argValue(reviewArgs, '--ledger')}`);
console.log(`review_run_id=${argValue(reviewArgs, '--run-id')}`);
console.log(`review_stage=${argValue(reviewArgs, '--stage')}`);
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
assert_contains "$INTAKE_OUT" "rejected=blocked" "readiness rejection blocks intake"
assert_contains "$INTAKE_OUT" "release_calls=1" "post-claim rejection releases Mission exactly once"
assert_contains "$INTAKE_OUT" "no_effect_zero=0" "pre-spend receipt records zero model attempts"
assert_contains "$INTAKE_OUT" "adapter_fault=readiness_adapter_invalid" \
  "sibling adapter faults fail closed under their owning code"
assert_contains "$INTAKE_OUT" "adapter_fault_release_calls=1" \
  "adapter faults still release a claimed Mission exactly once"
assert_contains "$INTAKE_OUT" "missing_phase=campaign_intake" \
  "missing managed contract blocks at campaign intake"
assert_contains "$INTAKE_OUT" "missing_rounds=0" "missing contract blocks before round one"
assert_contains "$INTAKE_OUT" "drift_phase=campaign_intake" \
  "invalid sealed contract blocks at campaign intake"
assert_contains "$INTAKE_OUT" "drift_code=campaign_contract_drift" \
  "invalid seal marker preserves the owning rejection code"
assert_contains "$INTAKE_OUT" "runner_calls=0" "missing contract spawns no runner"
assert_contains "$INTAKE_OUT" "worktree_calls=0" "invalid or missing contract creates no worktree"
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
  "review_ledger=$SBX/.autopilot/identity-ledger.jsonl" \
  "managed review receives the campaign ledger"
assert_contains "$INTAKE_OUT" \
  "review_run_id=campaign-v1-" \
  "managed review receives the campaign run identity"
assert_contains "$INTAKE_OUT" \
  "review_stage=campaign-review#r1" \
  "managed review receives a round-specific campaign stage identity"

CAMPAIGN_LEDGER="$TEST_TMP/campaign-ledger.jsonl"
DEFAULT_INTAKE_OUT="$(node - "$REPO_ROOT" "$SBX" "$CONTRACT" "$SEAL" "$PROMPT" \
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
  roster: { implementer_engine: 'fixture-implementer' },
}, {
  now: () => '2026-07-26T00:00:00.000Z',
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
console.log(JSON.stringify(result));
NODE
)"
DEFAULT_INTAKE_EXIT=$?
assert_exit_code "$DEFAULT_INTAKE_EXIT" "0" "default generation claim writes a durable ledger"
CAMPAIGN_ID="$(node -e \
  'const v=JSON.parse(process.argv[1]); process.stdout.write(v.campaign_id || "")' \
  "$DEFAULT_INTAKE_OUT")"
assert_neq "$CAMPAIGN_ID" "" "default intake returns a campaign id"

INSPECT_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign inspect \
  --campaign-id "$CAMPAIGN_ID" --ledger "$CAMPAIGN_LEDGER" 2>&1)"
assert_exit_code "$?" "0" "campaign inspect reads the durable intake"
assert_contains "$INSPECT_OUT" '"status":"found"' "campaign inspect returns found"
assert_contains "$INSPECT_OUT" '"phase":"PREPARED"' "campaign inspect projects the initial state"

RESUME_OUT="$(node "$REPO_ROOT/bin/autopilot.js" campaign resume \
  --campaign-id "$CAMPAIGN_ID" --ledger "$CAMPAIGN_LEDGER" 2>&1)"
assert_exit_code "$?" "0" "campaign resume accepts a dead prior process lease"
assert_contains "$RESUME_OUT" '"status":"resumable"' "campaign resume is machine-readable"
assert_contains "$RESUME_OUT" '"resume_required":true' "campaign resume preserves generation state"

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
