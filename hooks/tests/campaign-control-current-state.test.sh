#!/usr/bin/env bash
# BL-0255 (3.0.0 breaking rename): the admitted campaign control object carries the live
# durable-state projection as `current_state`. It was `initial_state` -- a misnomer, because
# the engine re-seats it from the ledger after every appended event (autopilot-engine.js
# `campaignControl.current_state = appended.state`), so it is the CURRENT state, not the
# intake snapshot. The intake snapshot that really is "initial" stays `initial_state` inside
# the persisted `campaign_intake` journal payload (a different object) and is untouched.
#
# No compatibility alias: control data that carries only the removed `initial_state` field
# must fail loudly (error code campaign_control_legacy_initial_state), never read as "no state".
#
# (a) new name written by the real intake fixture, read by the real appendCampaignEvent and
#     campaignWallBudgetStatus, re-seated across an append -- same behaviour as before the rename.
# (b) legacy-only control data is rejected by appendCampaignEvent, campaignWallBudgetStatus and
#     the engine's intake acceptance, each naming the removed field.
# Negative control: with requireCampaignCurrentState's legacy branch removed, (b) goes red.
# RED at 297f5a120 (base; this file copied onto the unmodified tree) -> 3 passed, 8 failed:
#   FAIL fixture control carries current_state: 'a_has_current_state=true' not found
#   FAIL legacy-only control is rejected by appendCampaignEvent, naming initial_state: 'b_append_legacy=throws:campaign_control_legacy_initial_state:names_old_field=true' not found
#     (base output: b_append_legacy=throws:campaign_event_invalid:names_old_field=false, b_wall_legacy=no-throw)
# Negative control (legacy branch of requireCampaignCurrentState removed): b_* assertions go red.
TEST_NAME="campaign-control-current-state"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, testTmp] = process.argv.slice(2);
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const engine = require(path.join(root, 'src', 'engine', 'autopilot-engine'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const repo = path.join(testTmp, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
git(repo, ['init', '-q']);
git(repo, ['config', 'user.email', 'current-state@example.invalid']);
git(repo, ['config', 'user.name', 'Current State']);
fs.writeFileSync(path.join(repo, 'src', 'seed.txt'), 'seed\n');
git(repo, ['add', 'src/seed.txt']);
git(repo, ['commit', '-qm', 'seed']);
const baseSha = git(repo, ['rev-parse', 'HEAD']);
const commonRaw = git(repo, ['rev-parse', '--git-common-dir']);
const commonDir = fs.realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw));
const contract = campaignLedgerContract({
  repoIdentity: `git-common-dir:${commonDir}`, ticket: 'current-state-rename', baseSha, branch: 'impl/current-state',
});
const opened = openCampaignLedger({
  root, repo, ledger: path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'),
  contract, startedAt: '2026-10-23T00:00:00.000Z',
});
const control = opened.control;

// ---- (a) new name, same behaviour --------------------------------------------------
console.log(`a_has_current_state=${Boolean(control.current_state)}`);
console.log(`a_has_no_initial_state=${!Object.prototype.hasOwnProperty.call(control, 'initial_state')}`);
console.log(`a_phase=${control.current_state && control.current_state.phase}`);
const wall = engine.campaignWallBudgetStatus(control, '2026-10-23T00:01:00.000Z');
console.log(`a_wall=${wall.exhausted}:${wall.elapsed_seconds}`);
const appended = intake.appendCampaignEvent({
  repo,
  campaignControl: control,
  observedAt: '2026-10-23T00:00:01.000Z',
  eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { sealed_contract: true },
});
console.log(`a_append=${appended.status}:${appended.state && appended.state.phase}`);
const reseated = { ...control, current_state: appended.state };
const wall2 = engine.campaignWallBudgetStatus(reseated, '2026-10-23T00:02:00.000Z');
console.log(`a_reseated_wall=${wall2.exhausted}:${wall2.elapsed_seconds}`);

// ---- (b) legacy-only control data fails loudly --------------------------------------
const legacy = { ...control, initial_state: control.current_state };
delete legacy.current_state;
function outcome(fn) {
  try { fn(); return 'no-throw'; } catch (error) {
    const named = /initial_state/.test(error.message) && /3\.0\.0/.test(error.message);
    return `throws:${error.code || 'nocode'}:names_old_field=${named}`;
  }
}
console.log(`b_append_legacy=${outcome(() => intake.appendCampaignEvent({
  repo,
  campaignControl: legacy,
  observedAt: '2026-10-23T00:00:02.000Z',
  eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { sealed_contract: true },
}))}`);
console.log(`b_wall_legacy=${outcome(() => engine.campaignWallBudgetStatus(legacy, '2026-10-23T00:01:00.000Z'))}`);
console.log(`b_helper_legacy=${outcome(() => intake.requireCampaignCurrentState(legacy))}`);
// a control that has neither field is NOT the legacy shape: no throw, state is just absent
console.log(`b_neither=${outcome(() => intake.requireCampaignCurrentState({ status: 'admitted' }))}`);

// engine intake acceptance: an injected intake that returns the legacy shape is blocked
// with the rename message instead of running on a control that has no state.
const promptFile = path.join(testTmp, 'prompt.txt');
fs.writeFileSync(promptFile, 'bounded implementation\n');
const seats = [
  { role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic' },
  { role: 'qc', runner: 'cc-shim', model: 'gpt-5.4', effort: 'high', endpoint: null, family: 'openai' },
  { role: 'qc', runner: 'cc-shim', model: 'glm-4.7', effort: 'high', endpoint: null, family: 'zai' },
];
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim',
  reviewer_qualified: true, implementer_engine: 'fixture-implementer',
  implementer_effort: 'high', implementer_runner: 'fixture',
  loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: 3,
  qc_panel_seats_complete: true, qc_panel_seats: seats, in_rail_review: 'panel',
  override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
};
const eng = new engine.AutopilotEngine({
  cwd: repo,
  clock: () => '2026-10-23T00:00:03.000Z',
  campaignIntake() { return { ...legacy, steps: [] }; },
});
let result;
try {
  result = eng.runImplementationReviewLoop({
    promptFile, branch: 'impl/current-state', base: baseSha,
    roster,
    campaignContract: path.join(testTmp, 'missing-contract.json'),
    campaignSeal: path.join(testTmp, 'missing-seal.json'),
  });
} catch (error) {
  result = { status: 'threw', reason: error.message };
}
const reason = String(result.reason || '');
console.log(`b_engine_reason=${reason}`);
console.log(`b_engine_intake=${result.status}:names_old_field=${/initial_state/.test(reason) && /3\.0\.0/.test(reason)}`);
NODE
)"
echo "$OUT"
assert_contains "$OUT" "a_has_current_state=true" "fixture control carries current_state"
assert_contains "$OUT" "a_has_no_initial_state=true" "fixture control no longer carries initial_state"
assert_contains "$OUT" "a_phase=PREPARED" "current_state is the admitted PREPARED snapshot"
assert_contains "$OUT" "a_wall=false:60" "campaignWallBudgetStatus reads current_state"
assert_contains "$OUT" "a_append=appended:IMPLEMENTING" "appendCampaignEvent reads current_state and reduces"
assert_contains "$OUT" "a_reseated_wall=false:120" "re-seated current_state is read by the next call"
assert_contains "$OUT" "b_append_legacy=throws:campaign_control_legacy_initial_state:names_old_field=true" "legacy-only control is rejected by appendCampaignEvent, naming initial_state"
assert_contains "$OUT" "b_wall_legacy=throws:campaign_control_legacy_initial_state:names_old_field=true" "legacy-only control is rejected by campaignWallBudgetStatus"
assert_contains "$OUT" "b_helper_legacy=throws:campaign_control_legacy_initial_state:names_old_field=true" "requireCampaignCurrentState rejects legacy-only control"
assert_contains "$OUT" "b_neither=no-throw" "a control with neither field is not the legacy shape"
assert_contains "$OUT" "b_engine_intake=blocked:names_old_field=true" "engine intake acceptance blocks a legacy-only control naming the rename"
finalize_test
