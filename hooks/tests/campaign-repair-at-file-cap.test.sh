#!/usr/bin/env bash
# campaign repair at the changed-file cap: usage.changed_files is the CUMULATIVE DISTINCT path set
# vs the campaign base (SET, never summed), and the reducer's ceiling is `usage > max`. A campaign
# whose first pass touched every scope path (usage == max) therefore keeps usage at max through a
# repair confined to the same paths, yet the pre-spend checks blocked at `usage >= max`, so a
# repair/disposition resume was unreachable (2nd occurrence; first: CHANGELOG "changed_files 13 >=
# max_changed_files 13"). Repair-type resumes now block pre-spend only at `usage > max`; the first
# pass (PREPARED/IMPLEMENTING), churn, wall and the write-time ceiling are unchanged.
#
# Stages: A pure eligibility table (cli.js) incl. the over-cap and first-pass negatives; B a REAL
# ledger parked in AWAITING_DISPOSITION at the cap -> intake claims it, a repair confined to the
# counted paths completes at usage == cap, a repair adding a path beyond the cap is refused by the
# reducer (usage unchanged), usage never decreases; C cli/intake use ONE shared predicate;
# D the admission advisory (cap == output_paths with repairs allowed).
# RED at 7a239e565caaa42b96dc9c4534f9563f5966c16a (new suite, unmodified src), 22 failed / 13 passed:
#   FAIL AWAITING_DISPOSITION at the cap is resumable: 'a_AWAITING_DISPOSITION_at_cap=resumable' not found
#   FAIL real AWAITING_DISPOSITION at the cap is cli-resumable: 'b_cli_eligibility=resumable' not found
#   FAIL intake admits the disposition resume at the cap: 'b_intake_status=claimed' not found (rejected campaign_file_budget_exhausted)
#   FAIL one shared pre-spend predicate is exported: 'c_helper_exported=true' not found
#   FAIL advisory fires when cap == output_paths and repairs are allowed: 'd_cap_equals_paths_repairs=...' not found
# Mutation: helper reverted to `used >= max` for every phase -> 14 FAIL (all of (a), the real-ledger intake and repair stages).
TEST_NAME="campaign-repair-at-file-cap"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, testTmp] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const campaignCli = require(path.join(root, 'src', 'campaign', 'cli'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));

// ---- A. eligibility table (pure) -------------------------------------------------
const digest = icc.canonicalDigest({ fixture: 'a' });
const review = { kind: 'product_review', digest };
const state = {
  phase: 'AWAITING_DISPOSITION',
  live_lease: null,
  started_at: '2026-07-26T00:00:00.000Z',
  usage: { changed_files: 0, churn: 0 },
  limits: { max_changed_files: 4, max_churn: 8, max_wall_seconds: 120 },
  awaiting_disposition: { findings_digest: digest },
  last_output_artifact_digest: icc.canonicalDigest(review),
};
const gitCandidate = { kind: 'git_candidate', commit: 'a'.repeat(40) };
const baseProj = {
  state, latest_lease: { state: 'dead' }, candidate_reference: gitCandidate,
  last_artifact_reference: review,
};
const at = (phase, files, extra = {}) => ({
  ...baseProj, ...extra,
  state: { ...state, ...(extra.state || {}), phase, usage: { changed_files: files, churn: 0 } },
});
const code = (p) => campaignCli.campaignResumeEligibility(p, '2026-07-26T00:00:01.000Z')
  .reason_code || 'resumable';
for (const phase of ['AWAITING_DISPOSITION', 'BOUNDARY_REJECTED', 'VERTICAL_VERIFICATION', 'ADJUDICATING']) {
  console.log(`a_${phase}_at_cap=${code(at(phase, 4))}`);
  console.log(`a_${phase}_below_cap=${code(at(phase, 3))}`);
  console.log(`a_${phase}_over_cap=${code(at(phase, 5))}`);
}
console.log(`a_PREPARED_at_cap=${code(at('PREPARED', 4))}`);
console.log(`a_PREPARED_below_cap=${code(at('PREPARED', 3))}`);
console.log(`a_IMPLEMENTING_at_cap=${code(at('IMPLEMENTING', 4))}`);
console.log(`a_disposition_churn_cap=${code({
  ...at('AWAITING_DISPOSITION', 4), state: { ...at('AWAITING_DISPOSITION', 4).state, usage: { changed_files: 4, churn: 8 } },
})}`);
console.log(`a_disposition_wall_exhausted=${campaignCli.campaignResumeEligibility(
  at('AWAITING_DISPOSITION', 4), '2026-07-26T01:00:00.000Z').reason_code}`);

// ---- shared fixture -----------------------------------------------------------------
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
function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
// A real ledger whose campaign reaches REVIEWING through BOUNDARY_REJECTED (committed
// candidate bound) -> vertical_verified, exactly the reducer edge production uses.
function reviewingFixture(name, { usageFiles = null } = {}) {
  const repo = path.join(testTmp, name, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'reviewing-resume@example.invalid']);
  git(repo, ['config', 'user.name', 'Reviewing Resume']);
  fs.writeFileSync(path.join(repo, 'src', 'seed.txt'), `${name}\n`);
  fs.writeFileSync(path.join(repo, 'fixture.js'), 'process.exit(0);\n');
  // shadow-mode mission governance so the real campaign seal (used by the real intake) verifies
  const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'));
  gov.mission_convergence = {
    schema_version: 1, enforcement_mode: 'shadow', max_campaigns: 8, max_wall_seconds: 7200,
    max_tool_calls: 1000, max_engine_attempts: 100, max_external_wait_seconds: 600,
    max_canonical_changed_files: 100, max_output_bytes: 1000000, max_deliverables: 8,
    max_parallel: 3, max_batches: 4, max_graph_depth: 4, max_gate_attempts: 16, closure_ratio: 1,
    max_stagnant_campaigns: 2,
  };
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'owner-kernel-governance.json'), `${JSON.stringify(gov, null, 2)}\n`);
  git(repo, ['add', 'src/seed.txt', 'fixture.js', '.claude/owner-kernel-governance.json']);
  git(repo, ['commit', '-qm', 'fixture']);
  const baseSha = git(repo, ['rev-parse', 'HEAD']);
  const commonRaw = git(repo, ['rev-parse', '--git-common-dir']);
  const commonDir = fs.realpathSync(
    path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw),
  );
  const branch = `impl/${name}`;
  const contract = campaignLedgerContract({
    repoIdentity: `git-common-dir:${commonDir}`,
    ticket: `reviewing-resume-${name}`,
    baseSha,
    branch,
  });
  const contractPath = path.join(testTmp, name, 'campaign.json');
  const sealPath = path.join(testTmp, name, 'campaign.seal.json');
  const promptFile = path.join(testTmp, name, 'prompt.txt');
  // The real intake keys the campaign by sha256(contract file bytes); the ledger fixture keys
  // it by canonicalDigest(contract). Writing the canonical compact form makes them one identity.
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v));
  fs.writeFileSync(contractPath, JSON.stringify(canon(contract)));
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  fs.writeFileSync(promptFile, 'bounded implementation\n');
  const opened = openCampaignLedger({
    root, repo,
    ledger: path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'),
    contract, startedAt: '2026-08-30T00:00:00.000Z',
  });
  const worktree = path.join(testTmp, name, 'candidate');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', branch, worktree, baseSha]);
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'src', 'out.txt'), 'x\n');
  execFileSync('git', ['-C', worktree, 'add', 'src/out.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', 'candidate']);
  const candidate = git(worktree, ['rev-parse', 'HEAD']);
  const control = {
    ...opened.control, contract_path: contractPath, seal_path: sealPath,
    full_enforcement: false, shadow_axes: ['mission'], steps: [],
  };
  return {
    repo, base: baseSha, branch, candidate, worktree, contract, contractPath, sealPath,
    promptFile, control, ledger: opened.ledger, campaignId: opened.campaignId, commonDir,
    usageFiles,
  };
}
function boundaryResult(fx) {
  return {
    status: 'boundary_rejected', runner: 'fixture', model: 'fixture-implementer',
    containment: 'plain', contained: true, branch: fx.branch, base: fx.base,
    commit: fx.candidate, files_changed: 1, insertions: 1, deletions: 0,
    worktree: fx.worktree, agent_log: null,
    run_id: `run-${fx.campaignId.slice(0, 8)}`, dispatch_id: `d-${fx.campaignId.slice(0, 8)}`,
    error: "boundary_rejected: changed path 'docs/leak.md' is outside sealed output surface",
    boundary: 'rejected', boundary_code: 'unauthorized_output_path',
    boundary_reason: "boundary_rejected: changed path 'docs/leak.md' is outside sealed output surface",
    candidate_ref: fx.candidate, possibly_effectful: true, mutation_failed: false,
    unknown_status: false, dispatcher_called: true, model_calls: 1, mutation_attempts: 1,
    gate_attempts: 1, resources_created: 1, zero_diff_receipt_digest: null,
  };
}
function toReviewing(fx, { disposition = false } = {}) {
  const { parseImplementationOutput } = require(path.join(root, 'src', 'runners', 'implementer'));
  const stdout = `${JSON.stringify(boundaryResult(fx))}\n`;
  const r = new AutopilotEngine({
    cwd: fx.repo,
    clock: () => '2026-08-30T00:00:01.000Z',
    campaignIntake() { return fx.control; },
    campaignAdmissionReleaser() { return { status: 'released' }; },
    implementationDispatcher() {
      return {
        error: null, status: 0, signal: null, stdout, stderr: '', parseError: null,
        result: parseImplementationOutput(stdout),
      };
    },
  }).runImplementationReviewLoop({
    promptFile: fx.promptFile, branch: fx.branch, base: fx.base, roster,
    campaignContract: fx.contractPath, campaignSeal: fx.sealPath,
  });
  assert.strictEqual(r.phase, 'boundary_rejected');
  const evidence = icc.canonicalDigest({ passed: true, fixture: fx.campaignId });
  const appended = intake.appendCampaignEvent({
    repo: fx.repo,
    campaignControl: fx.control,
    observedAt: '2026-08-30T00:00:02.000Z',
    eventType: icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
    generation: fx.control.initial_state.generation,
    stageIdentity: 'campaign-verification:fixture',
    payload: { passed: true, evidence_digest: evidence },
    artifactReference: { kind: 'verification_receipt', digest: evidence },
    ...(fx.usageFiles === null ? {} : { usage: { changed_files: fx.usageFiles } }),
  });
  assert.strictEqual(appended.state.phase, icc.CAMPAIGN_STATES.REVIEWING);
  let last = appended;
  if (disposition) {
    fx.control.initial_state = appended.state;
    const reviewDigest = icc.canonicalDigest({ fixture: 'product-review', id: fx.campaignId });
    const rc = intake.appendCampaignEvent({
      repo: fx.repo, campaignControl: fx.control, observedAt: '2026-08-30T00:00:03.000Z',
      eventType: icc.CAMPAIGN_EVENTS.REVIEW_COMPLETED,
      generation: fx.control.initial_state.generation,
      stageIdentity: 'campaign-review:fixture',
      payload: { review_digest: reviewDigest },
      artifactReference: { kind: 'product_review', digest: reviewDigest },
    });
    fx.control.initial_state = rc.state;
    last = intake.appendCampaignEvent({
      repo: fx.repo, campaignControl: fx.control, observedAt: '2026-08-30T00:00:04.000Z',
      eventType: icc.CAMPAIGN_EVENTS.AWAITING_DISPOSITION,
      generation: fx.control.initial_state.generation,
      stageIdentity: 'campaign-disposition:fixture',
      payload: {
        reason: 'findings need a disposition',
        findings_digest: icc.canonicalDigest({ fixture: 'findings' }),
        candidate_ref: fx.candidate,
      },
    });
    assert.strictEqual(last.state.phase, icc.CAMPAIGN_STATES.AWAITING_DISPOSITION);
  }
  execFileSync('bash', [
    path.join(root, 'scripts', 'run-ledger.sh'), 'stage-transition',
    '--ledger', fx.ledger, '--run-id', fx.campaignId, '--stage', 'campaign',
    '--generation', String(fx.control.generation_claim.generation),
    '--nonce', fx.control.generation_claim.nonce, '--to-state', 'dead',
    '--idempotency-key', `park:${fx.campaignId}`,
  ], { cwd: fx.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return last.state;
}
function claim(fx, state) {
  return intake.claimCampaignGeneration({
    campaignId: fx.campaignId,
    contractDigest: fx.control.contract_digest,
    initialState: state,
    ledgerPath: fx.ledger,
    repo: fx.repo,
    resume: true,
    observedAt: '2026-08-30T00:00:05.000Z',
    base: fx.base,
  });
}


// ---- B. real ledger: AWAITING_DISPOSITION with the first pass at the cap -------------------
const fxB = reviewingFixture('repair-cap', { usageFiles: 4 });
const stateB = toReviewing(fxB, { disposition: true });
console.log(`b_phase=${stateB.phase} usage_files=${stateB.usage.changed_files} cap=${stateB.limits.max_changed_files}`);
const projB = campaignCli.projectCampaign(campaignCli.loadRows(fxB.ledger), fxB.campaignId);
console.log(`b_cli_eligibility=${campaignCli.campaignResumeEligibility(projB, '2026-08-30T00:00:05.000Z').reason_code || 'resumable'}`);
const claimedB = claim(fxB, stateB);
console.log(`b_intake_status=${claimedB.status} code=${claimedB.code || claimedB.reason_code || ''}`);

// write side: the repair lifecycle on the claimed generation (only when the claim was admitted)
function repairTo(fx, claimed, files, tag) {
  let ctl = { ...fx.control, initial_state: claimed.resumed_state, generation_claim: claimed };
  const app = (input) => {
    const a = intake.appendCampaignEvent({ repo: fx.repo, campaignControl: ctl, ...input });
    ctl = { ...ctl, initial_state: a.state };
    return a;
  };
  const E = icc.CAMPAIGN_EVENTS;
  const g = ctl.initial_state.generation;
  app({
    observedAt: '2026-08-30T00:00:06.000Z', eventType: E.DISPOSITION_RESUMED, generation: g,
    stageIdentity: `disp-${tag}`,
    payload: { registry_complete: true, registry_digest: icc.canonicalDigest({ r: tag }) },
  });
  app({
    observedAt: '2026-08-30T00:00:07.000Z', eventType: E.REPAIR_AUTHORIZED, generation: g + 1,
    stageIdentity: `auth-${tag}`,
    payload: {
      registry_complete: true, registry_digest: icc.canonicalDigest({ r: tag }),
      repair_gate_passed: true, repair_gate_digest: icc.canonicalDigest({ gate: tag }),
    },
  });
  app({
    observedAt: '2026-08-30T00:00:08.000Z', eventType: E.REPAIR_STARTED, generation: g + 1,
    stageIdentity: `campaign-mutation:${g + 1}`, payload: { sealed_contract: true },
  });
  return app({
    observedAt: '2026-08-30T00:00:09.000Z', eventType: E.REPAIR_COMPLETED, generation: g + 1,
    stageIdentity: `campaign-mutation:${g + 1}`, usage: { changed_files: files },
    payload: { scope_check_passed: true, scope_check_digest: icc.canonicalDigest({ s: tag }) },
  });
}
if (claimedB.status === 'claimed') {
  try {
    const done = repairTo(fxB, claimedB, 4, 'same-paths');
    console.log(`a_repair_same_paths phase=${done.state.phase} usage_files=${done.state.usage.changed_files}`);
  } catch (error) { console.log(`a_repair_same_paths ERROR ${error.code || ''} ${error.message}`); }
  // (b) a repair adding a path beyond the cap: reducer refuses, durable usage untouched
  const fxB2 = reviewingFixture('repair-cap-new-path', { usageFiles: 4 });
  const stateB2 = toReviewing(fxB2, { disposition: true });
  const claimedB2 = claim(fxB2, stateB2);
  try {
    repairTo(fxB2, claimedB2, 5, 'new-path');
    console.log('b_repair_new_path=accepted');
  } catch (error) { console.log(`b_repair_new_path=refused code=${error.code}`); }
  const afterB2 = campaignCli.projectCampaign(campaignCli.loadRows(fxB2.ledger), fxB2.campaignId);
  console.log(`b_new_path_usage_after=${afterB2.state.usage.changed_files}`);
  // usage never decreases
  const fxB3 = reviewingFixture('repair-cap-decrease', { usageFiles: 4 });
  const stateB3 = toReviewing(fxB3, { disposition: true });
  const claimedB3 = claim(fxB3, stateB3);
  try {
    repairTo(fxB3, claimedB3, 3, 'decrease');
    console.log('b_repair_decrease=accepted');
  } catch (error) { console.log(`b_repair_decrease=refused code=${error.code}`); }
}

// ---- C. cli and intake share ONE predicate ---------------------------------------------
const cliSrc = fs.readFileSync(path.join(root, 'src', 'campaign', 'cli.js'), 'utf8');
const intakeSrc = fs.readFileSync(path.join(root, 'src', 'engine', 'campaign-intake.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(root, 'src', 'engine', 'autopilot-engine.js'), 'utf8');
const hasHelper = typeof icc.changedFilesPreSpendBlocked === 'function';
console.log(`c_helper_exported=${hasHelper}`);
console.log(`c_cli_uses_helper=${/changedFilesPreSpendBlocked\(/.test(cliSrc)}`);
console.log(`c_intake_uses_helper=${/changedFilesPreSpendBlocked\(/.test(intakeSrc)}`);
console.log(`c_engine_uses_helper=${/changedFilesPreSpendBlocked\(/.test(engineSrc)}`);
if (hasHelper) {
  const rows = [];
  for (const phase of ['PREPARED', 'IMPLEMENTING', 'BOUNDARY_REJECTED', 'VERTICAL_VERIFICATION',
    'ADJUDICATING', 'AWAITING_DISPOSITION', 'REPAIRING', 'REVIEWING']) {
    for (const files of [3, 4, 5]) {
      rows.push(`${phase}:${files}=${icc.changedFilesPreSpendBlocked({
        phase, usage: { changed_files: files }, limits: { max_changed_files: 4 },
      })}`);
    }
  }
  console.log(`c_table=${rows.join(',')}`);
}

// ---- D. admission advisory -------------------------------------------------------------
const adv = intake.campaignAdmissionAdvisories;
console.log(`d_fn=${typeof adv}`);
if (typeof adv === 'function') {
  const mk = (cap, paths, repairs) => adv({
    max_changed_files: cap, max_repair_generations: repairs,
    strict_dispatch: { output_paths: paths },
  }).map((a) => a.code).join('|') || 'none';
  const p3 = ['src/a', 'src/b', 'src/c'];
  console.log(`d_cap_equals_paths_repairs=${mk(3, p3, 2)}`);
  console.log(`d_cap_below_paths_repairs=${mk(2, p3, 1)}`);
  console.log(`d_headroom=${mk(4, p3, 2)}`);
  console.log(`d_no_repairs=${mk(3, p3, 0)}`);
  console.log(`d_no_strict_dispatch=${adv({ max_changed_files: 3, max_repair_generations: 2 }).length}`);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "repair-at-file-cap suite process exits 0"
echo "$OUT"
# A. cli eligibility
for ph in AWAITING_DISPOSITION BOUNDARY_REJECTED VERTICAL_VERIFICATION ADJUDICATING; do
  assert_contains "$OUT" "a_${ph}_at_cap=resumable" "$ph at the cap is resumable (repair stays within the counted paths)"
  assert_contains "$OUT" "a_${ph}_below_cap=resumable" "$ph below the cap stays resumable"
  assert_contains "$OUT" "a_${ph}_over_cap=campaign_file_budget_exhausted" "$ph over the cap is refused pre-spend"
done
assert_contains "$OUT" "a_PREPARED_at_cap=campaign_file_budget_exhausted" "first pass (PREPARED) at the cap stays refused"
assert_contains "$OUT" "a_PREPARED_below_cap=resumable" "first pass below the cap resumes"
assert_contains "$OUT" "a_IMPLEMENTING_at_cap=campaign_resume_phase_unsupported" "IMPLEMENTING at the cap stays unsupported"
assert_contains "$OUT" "a_disposition_churn_cap=campaign_churn_budget_exhausted" "churn cap still blocks a disposition resume at the file cap"
assert_contains "$OUT" "a_disposition_wall_exhausted=campaign_wall_budget_exhausted" "wall budget still blocks a disposition resume"
# B. real ledger
assert_contains "$OUT" "b_phase=AWAITING_DISPOSITION usage_files=4 cap=4" "fixture parks a real ledger in AWAITING_DISPOSITION at the file cap"
assert_contains "$OUT" "b_cli_eligibility=resumable" "real AWAITING_DISPOSITION at the cap is cli-resumable"
assert_contains "$OUT" "b_intake_status=claimed" "intake admits the disposition resume at the cap"
assert_contains "$OUT" "a_repair_same_paths phase=VERTICAL_VERIFICATION usage_files=4" "(a) repair on the counted paths completes; usage stays at the cap"
assert_contains "$OUT" "b_repair_new_path=refused code=FILE_BUDGET_EXCEEDED" "(b) a repair adding a path beyond the cap is refused by the reducer"
assert_contains "$OUT" "b_new_path_usage_after=4" "(b) refused repair leaves durable usage at the cap"
assert_contains "$OUT" "b_repair_decrease=refused code=BUDGET_RESET" "usage never decreases"
# C. shared predicate
assert_contains "$OUT" "c_helper_exported=true" "one shared pre-spend predicate is exported"
assert_contains "$OUT" "c_cli_uses_helper=true" "cli.js uses the shared predicate"
assert_contains "$OUT" "c_intake_uses_helper=true" "campaign-intake.js uses the shared predicate"
assert_contains "$OUT" "c_engine_uses_helper=true" "campaignMutationBudgetStatus uses the shared predicate"
assert_contains "$OUT" "c_table=PREPARED:3=false,PREPARED:4=true,PREPARED:5=true,IMPLEMENTING:3=false,IMPLEMENTING:4=true,IMPLEMENTING:5=true,BOUNDARY_REJECTED:3=false,BOUNDARY_REJECTED:4=false,BOUNDARY_REJECTED:5=true,VERTICAL_VERIFICATION:3=false,VERTICAL_VERIFICATION:4=false,VERTICAL_VERIFICATION:5=true,ADJUDICATING:3=false,ADJUDICATING:4=false,ADJUDICATING:5=true,AWAITING_DISPOSITION:3=false,AWAITING_DISPOSITION:4=false,AWAITING_DISPOSITION:5=true,REPAIRING:3=false,REPAIRING:4=false,REPAIRING:5=true,REVIEWING:3=false,REVIEWING:4=true,REVIEWING:5=true" "predicate table: >= for first pass, > for repair phases"
# D. advisory
assert_contains "$OUT" "d_cap_equals_paths_repairs=campaign_file_cap_no_first_pass_headroom" "advisory fires when cap == output_paths and repairs are allowed"
assert_contains "$OUT" "d_cap_below_paths_repairs=campaign_file_cap_no_first_pass_headroom" "advisory fires when cap < output_paths with repairs"
assert_contains "$OUT" "d_headroom=none" "no advisory with headroom"
assert_contains "$OUT" "d_no_repairs=none" "no advisory without repair generations"
assert_contains "$OUT" "d_no_strict_dispatch=0" "no advisory when the contract carries no output_paths"
finalize_test
