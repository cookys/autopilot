#!/usr/bin/env bash
# campaign resume: a transient final-panel review failure leaves the ICC projection in
# REVIEWING (vertical_verified landed, review_completed did not). That phase must be
# resumable with a bound git candidate, and the changed-file cap must apply only to
# resumes that can write (REVIEWING re-runs review only; every mutation re-checks the
# cap through campaignMutationBudgetStatus).
#
# Fixtures: the eligibility table is pure; the intake and engine blocks run a REAL
# ledger (scripts/run-ledger.sh) and the REAL reducer, reaching REVIEWING the way
# production does (BOUNDARY_REJECTED -> vertical_verified).
#
# RED (measured, with finalize_test in place): src/campaign/cli.js:889 temporarily made
# `false && projection.state.phase === REVIEWING` -> suite exits 1:
#   FAIL REVIEWING + bound git candidate is resumable: 'a_reviewing_with_candidate=resumable' not found
#   FAIL REVIEWING at the changed-file cap resumes (review cannot write): 'a_reviewing_at_cap=resumable' not found
#   FAIL churn cap still blocks a REVIEWING resume: 'a_reviewing_churn_cap=campaign_churn_budget_exhausted' not found
#   FAIL real REVIEWING projection is cli-resumable: 'b_cli_eligibility=resumable' not found
#   FAIL [campaign-resume-reviewing-phase] 20 passed, 4 failed
# (Before this commit the suite never called finalize_test, so it exited 0 whatever failed.)
TEST_NAME="campaign-resume-reviewing-phase"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

DIFF="$TEST_TMP/review.diff"
printf '+const answer = 42;\n' > "$DIFF"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" "$DIFF" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, testTmp, diff] = process.argv.slice(2);
const reviewRunner = require(path.join(root, 'src', 'runners', 'review'));
const realBatch = reviewRunner.dispatchReviewJsonBatch;
const stub = path.join(root, 'hooks', 'tests', 'lib', 'final-panel-seat-xproc-stub-review.sh');
// Patch BEFORE the engine is required: it binds the batch dispatcher at load time.
const reviewLog = path.join(testTmp, 'review-calls.log');
process.env.FP_LOG = reviewLog;
process.env.FP_FAIL_MODEL = '';
reviewRunner.dispatchReviewJsonBatch = (list, opts) => realBatch(
  list.map((item) => ({ ...item, scriptPath: stub })), opts,
);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const { runCampaignIntake, compileCampaignDispositionPolicy } = require(path.join(root, 'src', 'engine'));
const campaignCli = require(path.join(root, 'src', 'campaign', 'cli'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));

// ---- A. eligibility table (pure) -------------------------------------------------
const state = {
  phase: 'REVIEWING',
  live_lease: null,
  started_at: '2026-07-26T00:00:00.000Z',
  usage: { changed_files: 0, churn: 0 },
  limits: { max_changed_files: 4, max_churn: 8, max_wall_seconds: 120 },
};
const gitCandidate = { kind: 'git_candidate', commit: 'a'.repeat(40) };
const base = { state, latest_lease: { state: 'dead' }, candidate_reference: gitCandidate };
const withUsage = (s, files) => ({ ...s, usage: { ...s.usage, changed_files: files } });
const code = (p) => campaignCli.campaignResumeEligibility(p, '2026-07-26T00:00:01.000Z')
  .reason_code || 'resumable';
console.log(`a_reviewing_with_candidate=${code(base)}`);
console.log(`a_reviewing_at_cap=${code({ ...base, state: withUsage(state, 4) })}`);
// negative controls
console.log(`a_reviewing_no_candidate=${code({ ...base, candidate_reference: null })}`);
console.log(`a_reviewing_non_git_candidate=${code({
  ...base, candidate_reference: { kind: 'other' },
})}`);
console.log(`a_prepared_at_cap=${code({
  ...base, state: withUsage({ ...state, phase: 'PREPARED' }, 4),
})}`);
console.log(`a_vertical_at_cap=${code({
  ...base, state: withUsage({ ...state, phase: 'VERTICAL_VERIFICATION' }, 4),
})}`);
console.log(`a_adjudicating_at_cap_unbound=${code({
  ...base, state: withUsage({ ...state, phase: 'ADJUDICATING' }, 4),
})}`);
console.log(`a_reviewing_churn_cap=${code({
  ...base, state: { ...state, usage: { changed_files: 0, churn: 8 } },
})}`);
console.log(`a_implementing=${code({
  ...base, state: { ...state, phase: 'IMPLEMENTING' },
})}`);
console.log(`a_terminal_stop=${code({
  ...base, state: { ...state, phase: 'TERMINAL_STOP' },
})}`);

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
function reviewingFixture(name, { maxChangedFiles = null, usageFiles = null } = {}) {
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
    maxChangedFiles, usageFiles,
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
function toReviewing(fx) {
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
  });
  assert.strictEqual(appended.state.phase, icc.CAMPAIGN_STATES.REVIEWING);
  execFileSync('bash', [
    path.join(root, 'scripts', 'run-ledger.sh'), 'stage-transition',
    '--ledger', fx.ledger, '--run-id', fx.campaignId, '--stage', 'campaign',
    '--generation', String(fx.control.generation_claim.generation),
    '--nonce', fx.control.generation_claim.nonce, '--to-state', 'dead',
    '--idempotency-key', `park:${fx.campaignId}`,
  ], { cwd: fx.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return appended.state;
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

// ---- B. intake claim from a real REVIEWING ledger -----------------------------------
const fxB = reviewingFixture('intake-reviewing');
const reviewingState = toReviewing(fxB);
const projB = campaignCli.projectCampaign(campaignCli.loadRows(fxB.ledger), fxB.campaignId);
console.log(`b_projection_phase=${projB.state.phase}`);
console.log(`b_cli_eligibility=${campaignCli.campaignResumeEligibility(projB, '2026-08-30T00:00:05.000Z').reason_code || 'resumable'}`);
const claimedB = claim(fxB, reviewingState);
console.log(`b_intake_status=${claimedB.status} code=${claimedB.code || claimedB.reason_code || ''}`);
console.log(`b_resume_candidate=${Boolean(claimedB.resume_candidate)}`);

// ---- C. engine resume from REVIEWING: review-only, no implementer, no vertical_verified
const fxC = reviewingFixture('engine-reviewing');
const stateC = toReviewing(fxC);
const worktreeC = fxC.worktree;
const commit = fxC.candidate;
const tree = git(worktreeC, ['rev-parse', 'HEAD^{tree}']);
const { createWriterFence } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const lineage = {
  lineage_id: fxC.campaignId, branch: fxC.branch, worktree: worktreeC,
  provider_session_id: null, provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: require('crypto').createHash('sha256').update(worktreeC).digest('hex'),
  cleanup_epoch: 1, cleanup_receipt_id: null, generation: 0, inherited_churn: 0, delta_churn: 2,
  retention_owner: fxC.campaignId, retention_reason: 'implementation-campaign-repair-lineage',
  retention_expires_at: 2000000000, terminal_worktree_disposition: 'active',
  transcript_reused: false, transcript_source_digest: 'a'.repeat(64),
  review_input_mode: 'full_diff_generation', new_input_bytes: 17, new_input_tokens: 23,
  input_token_measurement: 'provider_reported', finding_occurrences: [],
  accepted_invariant_ids: [], accepted_invariants: [], accepted_invariants_source_commit: null,
  accepted_invariants_digest: null, prior_review_finding_ids: [],
  previous_repair_finding_count: null, non_reduction_rounds: 0,
  repair_scope_paths: ['src/out.txt'], repair_scope_seal: null,
};
const fence = createWriterFence({
  campaignId: fxC.campaignId, stageIdentity: 'campaign-implementation',
  candidateCommit: commit, candidateTreeSha: tree,
  implementationResult: {
    status: 'committed', implementation: { commit },
    implementationResult: { error: null, signal: null, status: 0 },
  },
});
const resumeCandidate = {
  committed: true, commit, tree_sha: tree, branch: fxC.branch, writer_fence: fence,
  repair_lineage: lineage, scope_implementation_sha: commit,
};
let implCalls = 0;
const journal = [];
const resumed = new AutopilotEngine({
  cwd: fxC.repo,
  clock: () => '2026-08-30T00:00:06.000Z',
  campaignDispositionProvider: compileCampaignDispositionPolicy('acceptance-bound'),
  // REAL intake claim + REAL journal + REAL completion over the real REVIEWING ledger.
  campaignIntake(input) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  campaignEventAppender(input) {
    journal.push(input.eventType);
    return intake.appendCampaignEvent(input);
  },
  campaignScopeChecker() {
    return { passed: true, changed_files: ['src/out.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
  },
  // Production's cleanup re-derives the retained worktree's filesystem-instance id and
  // checks a lease marker this fixture does not build; inject the transaction (as the
  // final-panel-seat-xproc driver does) so the resumed run is not blocked by fixture shape.
  repairLineageCleanupTransaction({ record }) {
    if (record && record.worktree) {
      execFileSync('git', ['-C', fxC.repo, 'worktree', 'remove', '--force', record.worktree],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  implementationDispatcher() { implCalls += 1; throw new Error('must not re-dispatch'); },
  // Production's cleanup re-derives the retained worktree's filesystem-instance id and
  // checks a lease marker this fixture does not build; inject the transaction (as the
  // final-panel-seat-xproc driver does) so the resumed run is not blocked by fixture shape.
  repairLineageCleanupTransaction({ record }) {
    if (record && record.worktree) {
      execFileSync('git', ['-C', fxC.repo, 'worktree', 'remove', '--force', record.worktree],
        { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  diffProvider() {
    // the packet builder requires the byte-exact canonical diff of the bound range
    const diffFile = path.join(testTmp, 'engine-reviewing', 'range.diff');
    fs.writeFileSync(diffFile, execFileSync('git', [
      '-C', fxC.repo, 'diff', '--no-ext-diff', '--no-textconv', `${fxC.base}..${commit}`,
    ]));
    return diffFile;
  },
  gitWorktreeAdd({ commit: c } = {}) {
    const useCommit = c || commit;
    const verifyWt = path.join(testTmp, `engine-reviewing-verify-${String(useCommit).slice(0, 12)}`);
    try { git(fxC.repo, ['worktree', 'remove', '--force', verifyWt]); } catch (_e) {}
    git(fxC.repo, ['worktree', 'add', '-q', '--detach', verifyWt, useCommit]);
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', worktree: verifyWt, parent: null,
      commit: useCommit, observed_commit: useCommit,
      observed_tree_sha: git(verifyWt, ['rev-parse', 'HEAD^{tree}']), detached: true,
    };
  },
  gitWorktreeRemove({ worktree: wt } = {}) {
    if (wt) { try { git(fxC.repo, ['worktree', 'remove', '--force', wt]); } catch (_e) {} }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  verifyCommandRunner() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '', executed_argv: ['/bin/sh', '-c', 'node fixture.js'] };
  },
}).runImplementationReviewLoop({
  promptFile: fxC.promptFile, branch: fxC.branch, base: fxC.base, roster,
  campaignContract: fxC.contractPath, campaignSeal: fxC.sealPath, resume: true,
});
console.log(`c_status=${resumed.status} reason=${resumed.reason || ''}`);
console.log(`c_impl_calls=${implCalls}`);
console.log(`c_phase=${resumed.phase || ''}`);
const reviewCalls = fs.existsSync(reviewLog) ? fs.readFileSync(reviewLog, 'utf8').split('\n').filter(Boolean).length : 0;
console.log(`c_review_calls=${reviewCalls > 0}`);
console.log(`c_seat_dispatches=${reviewCalls}`);
console.log(`c_journal_vertical_verified=${journal.includes('vertical_verified')}`);
console.log(`c_journal_terminal=${journal.includes('terminal_stop')}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "reviewing-resume suite process exits 0"
echo "$OUT"
# (a) the transient final-panel failure phase is resumable with a bound candidate
assert_contains "$OUT" "a_reviewing_with_candidate=resumable" \
  "REVIEWING + bound git candidate is resumable"
# (b) the changed-file cap does not block a review-only resume
assert_contains "$OUT" "a_reviewing_at_cap=resumable" \
  "REVIEWING at the changed-file cap resumes (review cannot write)"
# negative controls
assert_contains "$OUT" "a_reviewing_no_candidate=campaign_resume_phase_unsupported" \
  "REVIEWING without a candidate stays blocked"
assert_contains "$OUT" "a_reviewing_non_git_candidate=campaign_resume_phase_unsupported" \
  "REVIEWING with a non-git candidate reference stays blocked"
assert_contains "$OUT" "a_prepared_at_cap=campaign_file_budget_exhausted" \
  "a writing resume (PREPARED) at the cap stays campaign_file_budget_exhausted"
assert_contains "$OUT" "a_vertical_at_cap=campaign_file_budget_exhausted" \
  "a writing resume (VERTICAL_VERIFICATION) at the cap stays blocked"
assert_contains "$OUT" "a_adjudicating_at_cap_unbound=campaign_resume_phase_unsupported" \
  "ADJUDICATING without a bound review stays blocked"
assert_contains "$OUT" "a_reviewing_churn_cap=campaign_churn_budget_exhausted" \
  "churn cap still blocks a REVIEWING resume"
assert_contains "$OUT" "a_implementing=campaign_resume_phase_unsupported" \
  "IMPLEMENTING stays unsupported"
assert_contains "$OUT" "a_terminal_stop=terminal" "a non-transient fault (TERMINAL_STOP) stays terminal"
# real ledger: intake claim + engine
assert_contains "$OUT" "b_projection_phase=REVIEWING" "fixture really reaches REVIEWING in the ledger"
assert_contains "$OUT" "b_cli_eligibility=resumable" "real REVIEWING projection is cli-resumable"
assert_contains "$OUT" "b_intake_status=claimed" "intake claims a REVIEWING resume"
assert_contains "$OUT" "b_resume_candidate=true" "intake binds the resume candidate"
assert_contains "$OUT" "c_impl_calls=0" "REVIEWING resume never re-dispatches the implementer"
assert_contains "$OUT" "c_review_calls=true" "REVIEWING resume re-runs the review"
assert_contains "$OUT" "c_journal_vertical_verified=false" \
  "REVIEWING resume does not re-journal vertical_verified (reducer would reject it)"
assert_contains "$OUT" "c_journal_terminal=false" "REVIEWING resume journals no terminal_stop"
assert_contains "$OUT" "c_seat_dispatches=3" "REVIEWING resume dispatches the 3-seat final panel (real batch dispatcher, stubbed script)"
# The resumed run must get past the old fixture-shape blocks: the repair-lineage cleanup
# (git worktree command) and the completion/seat-admission blocks.
C_STATUS_LINE="$(printf '%s\n' "$OUT" | grep '^c_status=')"
assert_not_contains "$C_STATUS_LINE" "git worktree command" "resumed run is not blocked at the repair-lineage cleanup"
assert_not_contains "$C_STATUS_LINE" "campaign_completion_failed" "resumed run is not blocked at campaign completion"
assert_not_contains "$C_STATUS_LINE" "managed blind-discovery" "resumed run is not blocked at seat admission"
assert_not_contains "$C_STATUS_LINE" "families_below_minimum" "resumed run reached a real quorum"
# KNOWN GAP (see commit report): the run still ends blocked at controller_work_order_terminalize
# ("controller transcript audit blocks terminal"), so the converged status is NOT asserted here.
echo "c_final: $C_STATUS_LINE" >&2
finalize_test
