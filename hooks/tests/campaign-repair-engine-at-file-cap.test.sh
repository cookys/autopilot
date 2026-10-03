#!/usr/bin/env bash
# Engine-level proof for the changed-file-cap repair gate: a campaign whose first pass used the
# whole file budget (usage == max_changed_files == 1) parks at AWAITING_DISPOSITION; the real
# engine's disposition resume must pass intake AND the implement closure's
# campaignMutationBudgetStatus({repair: kind !== 'initial'}) and dispatch the repair. The first
# pass (kind 'initial') at the cap stays blocked (direct call on the real engine function).
# Real engine + real intake + real ledger; only the model/git/verify adapters are fakes (same
# scaffold as autopilot-engine-park-reserve.test.sh).
# Mutation: forcing `repair: false` at the closure call site makes the repair resume stop at
# `campaign_wall_budget` with the implementer never dispatched (see RED lines in the commit).
TEST_NAME="campaign-repair-engine-at-file-cap"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/.claude" "$REPO/dist"
git -C "$REPO" init -q -b develop
git -C "$REPO" config user.email "engine-file-cap@example.invalid"
git -C "$REPO" config user.name "Engine File Cap Test"
write_mission_governance "$REPO/.claude/owner-kernel-governance.json" shadow
printf '.autopilot/\n' > "$REPO/.gitignore"
printf 'base\n' > "$REPO/dist/out.txt"
git -C "$REPO" add .
git -C "$REPO" commit -qm base
BASE="$(git -C "$REPO" rev-parse HEAD)"

DRIVER="$TEST_TMP/driver.js"
cat > "$DRIVER" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, tmp, stage] = process.argv.slice(2);
const sidePath = path.join(tmp, 'sidecar.json');
const engineMod = require(path.join(root, 'src', 'engine'));
const { AutopilotEngine, runCampaignIntake } = engineMod;
const { campaignMutationBudgetStatus } = require(path.join(root, 'src', 'engine', 'autopilot-engine'));
const { loadRows, projectCampaign } = require(path.join(root, 'src', 'campaign', 'cli'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const common = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-common-dir')));
const seats = [{
  role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic',
}];
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim',
  reviewer_qualified: true, implementer_engine: 'fixture-implementer', implementer_effort: 'high',
  implementer_runner: 'fixture', loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1, in_rail_review: 'single', qc_panel_seats_complete: true,
  qc_panel_seats: seats, override_admitted_seats: ['qc_panel[0]'],
};
const ticket = 'file-cap-engine';
const branch = `feat/${ticket}`;
const worktree = path.join(tmp, `${ticket}-wt`);
const contractPath = path.join(tmp, 'campaign.json');
const sealPath = path.join(tmp, 'campaign.seal.json');
const promptFile = path.join(tmp, 'prompt.txt');
let candidate; let tree;
if (stage === '1') {
  git('worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.writeFileSync(path.join(worktree, 'dist', 'out.txt'), `${ticket}\n`);
  execFileSync('git', ['-C', worktree, 'add', 'dist/out.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', ticket]);
  candidate = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  tree = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  fs.writeFileSync(promptFile, 'file cap\n');
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1, ticket, profile: 'poc', mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`, base_sha: base, branch,
    vertical_acceptance: ['repair at the file cap'], allowed_path_prefixes: ['dist/'],
    max_changed_files: 1, baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5,
    max_repair_generations: 2, max_wall_seconds: 7200, verify_cmd: 'true',
    rubric_ids: ['CAP-E1'], final_panel_reserve_seconds: 0,
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });


  candidate = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} else {
  ({ candidate, tree } = JSON.parse(fs.readFileSync(sidePath, 'utf8')));
}
let implCalls = 0;
let reviewMode = 'park';
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-26T00:00:10.000Z',
  campaignIntake(input) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  campaignScopeChecker() {
    return { passed: true, verdict: 'PASS', changed_files: ['dist/out.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
  },
  // Stage 1 parks for a disposition; stage 2 uses the REAL adjudicator with the real authority.
  ...(stage === '1' ? {
    campaignAdjudicator() {
      return { registry_complete: false, reason: 'missing disposition authority', must_fix_now: [], follow_up: [], rejected: [] };
    },
  } : {}),
  implementationDispatcher() {
    implCalls += 1;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        status: 'committed', runner: 'fixture', model: 'fixture-implementer', branch, base,
        commit: candidate, tree_sha: tree, files_changed: 1, insertions: 1, deletions: 0,
        worktree, agent_log: '/tmp/impl-log', error: null, contained: true, containment: 'plain',
        dispatcher_called: true, model_calls: 1, wall_secs: 1,
      },
    };
  },
  reviewDispatcher() {
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        runner: 'cc-shim', model: 'claude-opus-4-6', status: 'reviewed', verdict: 'FIX-THEN-SHIP',
        findings: JSON.stringify([{ finding_id: 'cap-1', claim: 'MUST-FIX dist/out.txt needs a repair', severity: '🟠', source: 'fixture' }]), raw_log: '/tmp/review-log', error: null,
      },
    };
  },
  diffProvider() { return promptFile; },
  gitWorktreeAdd() {
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', worktree, parent: null,
      commit: candidate, observed_commit: candidate, observed_tree_sha: tree, detached: true,
    };
  },
  gitWorktreeRemove() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
  repairLineageCleanupTransaction() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
  verifyCommandRunner() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '', executed_argv: ['/bin/sh', '-c', 'true'] };
  },
  gitRevParse(input) {
    const spec = input && input.spec;
    if (spec === 'HEAD' || spec === candidate) return candidate;
    if (spec === 'HEAD^{tree}' || spec === `${candidate}^{tree}`) return tree;
    return git('rev-parse', spec || 'HEAD');
  },
});
const common_args = {
  promptFile, branch, base, roster, campaignContract: contractPath, campaignSeal: sealPath,
  verificationEnv: { PATH: process.env.PATH || '', CI: ticket }, verificationEnvAllowlist: ['CI'],
};
if (stage === '1') {
  // ---- 1. first pass touches the whole budget and parks ---------------------------------
  const first = engine.runImplementationReviewLoop(common_args);
  const campaignId = first.campaign_control && first.campaign_control.campaign_id;
  console.log(`e1_status=${first.status}`);
  const proj = projectCampaign(loadRows(first.campaign_control.generation_claim.ledger), campaignId);
  console.log(`e1_phase=${proj.state.phase} usage=${proj.state.usage.changed_files} cap=${proj.state.limits.max_changed_files}`);
  console.log(`e1_impl_calls=${implCalls}`);
  fs.writeFileSync(sidePath, JSON.stringify({
    candidate, tree, campaignId, contractDigest: first.campaign_control.contract_digest,
    reviewDigest: proj.last_artifact_reference.digest,
  }));
  process.exit(0);
}
// ---- 2. (separate process: the first run's lease is dead) disposition resume at usage == cap
const side = JSON.parse(fs.readFileSync(sidePath, 'utf8'));
const authority = {
  schema_version: 1, artifact_type: 'campaign_disposition_authority', authority: 'depth-0',
  actor_id: 'operator', campaign_id: side.campaignId, contract_digest: side.contractDigest,
  reviews: [{
    review_digest: side.reviewDigest,
    decisions: [{
      finding_id: 'cap-1',
      evidence: { kind: 'trace', trace_chain: ['contract.vertical_acceptance[0]'], confirmed_by: 'operator' },
      disposition: { disposition: 'must-fix-now', acceptance_id: 'vertical_acceptance[0]', deferral_harm: 'unfixed acceptance remains' },
    }],
  }],
};
engine.campaignDispositionProvider = engineMod.compileCampaignDispositionProvider(authority);
const resumed = engine.runImplementationReviewLoop({
  ...common_args, resume: true, campaignDispositionAuthority: authority,
});
console.log(`e2_phase=${resumed.phase} status=${resumed.status} rejection=${resumed.campaign_control && resumed.campaign_control.rejection && resumed.campaign_control.rejection.code}`);
console.log(`e2_reason=${String(resumed.reason).slice(0, 400)}`);
console.log(`e2_repair_dispatched=${implCalls > 0}`);
console.log(`e2_budget_blocked=${resumed.phase === 'campaign_wall_budget'}`);
// ---- 3. the real engine function, per dispatch kind, at usage == cap ------------------
const control = {
  status: 'admitted',
  contract: {},
  initial_state: {
    started_at: '2026-07-26T00:00:00.000Z', phase: 'AWAITING_DISPOSITION',
    usage: { changed_files: 1, churn: 0, elapsed_wall_seconds: 0 },
    limits: { max_changed_files: 1, max_churn: 100, max_wall_seconds: 7200 },
  },
};
const at = '2026-07-26T00:00:10.000Z';
console.log(`e3_initial_at_cap=${campaignMutationBudgetStatus(control, at).axis}`);
console.log(`e3_initial_explicit_at_cap=${campaignMutationBudgetStatus(control, at, { repair: false }).axis}`);
console.log(`e3_repair_at_cap=${campaignMutationBudgetStatus(control, at, { repair: true }).axis}`);
control.initial_state.usage.changed_files = 2;
console.log(`e3_repair_over_cap=${campaignMutationBudgetStatus(control, at, { repair: true }).axis}`);
NODE
OUT1="$(node "$DRIVER" "$REPO_ROOT" "$REPO" "$BASE" "$TEST_TMP" 1 < /dev/null 2>&1)"; EXIT1=$?
OUT2="$(node "$DRIVER" "$REPO_ROOT" "$REPO" "$BASE" "$TEST_TMP" 2 < /dev/null 2>&1)"; EXIT=$?
OUT="$OUT1
$OUT2"
echo "$OUT"
assert_eq "0" "$EXIT1" "engine file-cap stage 1 exits 0"
assert_eq "0" "$EXIT" "engine file-cap stage 2 exits 0"
assert_contains "$OUT" "e1_phase=AWAITING_DISPOSITION usage=1 cap=1" "first pass used the whole file budget and parked for disposition"
assert_contains "$OUT" "e1_impl_calls=1" "first pass dispatched the implementer once"
assert_contains "$OUT" "e2_repair_dispatched=true" "disposition resume at usage == cap dispatches the repair (engine gate admits repair)"
assert_contains "$OUT" "e2_budget_blocked=false" "repair resume is not stopped by the mutation budget"
assert_contains "$OUT" "e3_initial_at_cap=changed_files" "first pass at the cap is blocked (default kind)"
assert_contains "$OUT" "e3_initial_explicit_at_cap=changed_files" "first pass at the cap is blocked (repair:false)"
assert_contains "$OUT" "e3_repair_at_cap=null" "repair at the cap is admitted by the real engine function"
assert_contains "$OUT" "e3_repair_over_cap=changed_files" "repair over the cap is blocked"
finalize_test
