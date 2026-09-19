#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
# Mission harness injects root-run / reconcile receipts that must not poison unit tests.
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
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));

const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: [{
    role: 'qc',
    runner: 'fixture',
    model: 'fixture-reviewer',
    effort: 'high',
    endpoint: null,
    family: 'fixture',
  }],
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 2,
  loop_convergence_verdict: 'SHIP-AS-IS',
  cross_family_required: false,
};

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeRepo(name) {
  const repo = path.join(testTmp, name, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'boundary-resume@example.invalid']);
  git(repo, ['config', 'user.name', 'Boundary Resume']);
  fs.writeFileSync(path.join(repo, 'src', 'seed.txt'), `${name}\n`);
  fs.writeFileSync(path.join(repo, 'fixture.js'), 'process.exit(0);\n');
  git(repo, ['add', 'src/seed.txt', 'fixture.js']);
  git(repo, ['commit', '-qm', 'fixture']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const commonRaw = git(repo, ['rev-parse', '--git-common-dir']);
  const commonDir = fs.realpathSync(
    path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw),
  );
  const branch = `impl/${name}`;
  const contract = campaignLedgerContract({
    repoIdentity: `git-common-dir:${commonDir}`,
    ticket: `boundary-resume-${name}`,
    baseSha: base,
    branch,
  });
  const contractPath = path.join(testTmp, name, 'campaign.json');
  const sealPath = path.join(testTmp, name, 'campaign.seal.json');
  const promptFile = path.join(testTmp, name, 'prompt.txt');
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  fs.writeFileSync(sealPath, '{}\n');
  fs.writeFileSync(promptFile, 'bounded implementation\n');
  const opened = openCampaignLedger({
    root,
    repo,
    ledger: path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'),
    contract,
    startedAt: '2026-08-30T00:00:00.000Z',
  });
  return {
    repo, base, branch, contract, contractPath, sealPath, promptFile, opened, commonDir,
  };
}

function durableManagedControl(fx, extraClaim = {}) {
  return {
    ...fx.opened.control,
    contract_path: fx.contractPath,
    seal_path: fx.sealPath,
    full_enforcement: false,
    shadow_axes: ['mission'],
    steps: [],
    initial_state: {
      ...fx.opened.control.initial_state,
      phase: 'BOUNDARY_REJECTED',
      event_count: 1,
      live_lease: null,
      boundary_rejected: {
        reason: 'scope',
        candidate_ref: null,
        receipt_digest: 'a'.repeat(64),
      },
    },
    generation_claim: {
      ...fx.opened.control.generation_claim,
      durable_journal: true,
      resume_candidate: null,
      resume_review_digest: null,
      ...extraClaim,
    },
  };
}

const fxRed = makeRepo('red-no-candidate');
let implCallsRed = 0;
const red = new AutopilotEngine({
  cwd: fxRed.repo,
  clock: () => '2026-08-30T00:00:01.000Z',
  campaignIntake() {
    return durableManagedControl(fxRed);
  },
  campaignAdmissionReleaser() {
    return { status: 'released' };
  },
  implementationDispatcher() {
    implCallsRed += 1;
    throw new Error('implementation must not dispatch');
  },
}).runImplementationReviewLoop({
  promptFile: fxRed.promptFile,
  branch: fxRed.branch,
  base: fxRed.base,
  roster,
  campaignContract: fxRed.contractPath,
  campaignSeal: fxRed.sealPath,
});
console.log(`red_status=${red.status}`);
console.log(`red_reason=${red.reason}`);
console.log(`red_impl_calls=${implCallsRed}`);
console.log(`red_phase=${red.phase}`);

const fxGreen = makeRepo('green-candidate');
const worktree = path.join(testTmp, 'green-candidate', 'wt');
execFileSync('git', ['-C', fxGreen.repo, 'worktree', 'add', '-q', '-b', fxGreen.branch, worktree, fxGreen.base]);
fs.writeFileSync(path.join(worktree, 'src', 'out.txt'), 'ok\n');
execFileSync('git', ['-C', worktree, 'add', 'src/out.txt']);
execFileSync('git', ['-C', worktree, 'commit', '-qm', 'candidate']);
const commit = git(worktree, ['rev-parse', 'HEAD']);
const tree = git(worktree, ['rev-parse', 'HEAD^{tree}']);
const { createWriterFence } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const instanceId = require('crypto').createHash('sha256').update(worktree).digest('hex');
const lineage = {
  lineage_id: fxGreen.opened.campaignId,
  branch: fxGreen.branch,
  worktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: instanceId,
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: 0,
  inherited_churn: 0,
  delta_churn: 2,
  retention_owner: fxGreen.opened.campaignId,
  retention_reason: 'implementation-campaign-repair-lineage',
  retention_expires_at: 2000000000,
  terminal_worktree_disposition: 'active',
  transcript_reused: false,
  transcript_source_digest: 'a'.repeat(64),
  review_input_mode: 'full_diff_generation',
  new_input_bytes: 17,
  new_input_tokens: 23,
  input_token_measurement: 'provider_reported',
  finding_occurrences: [],
  accepted_invariant_ids: [],
  accepted_invariants: [],
  accepted_invariants_source_commit: null,
  accepted_invariants_digest: null,
  prior_review_finding_ids: [],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/out.txt'],
  repair_scope_seal: null,
};
const fence = createWriterFence({
  campaignId: fxGreen.opened.campaignId,
  stageIdentity: 'campaign-implementation',
  candidateCommit: commit,
  candidateTreeSha: tree,
  implementationResult: {
    status: 'committed',
    implementation: { commit },
    implementationResult: { error: null, signal: null, status: 0 },
  },
});
const resumeCandidate = {
  committed: true,
  commit,
  tree_sha: tree,
  branch: fxGreen.branch,
  writer_fence: fence,
  repair_lineage: lineage,
  scope_implementation_sha: commit,
};
let implCallsGreen = 0;
let reviewCalls = 0;
const journalEvents = [];
const green = new AutopilotEngine({
  cwd: fxGreen.repo,
  clock: () => '2026-08-30T00:00:01.000Z',
  campaignIntake() {
    return durableManagedControl(fxGreen, { resume_candidate: resumeCandidate });
  },
  campaignAdmissionReleaser() {
    return { status: 'released' };
  },
  campaignEventAppender(input) {
    journalEvents.push(input.eventType);
    if (input.eventType === 'terminal_stop' || input.eventType === 'mutation_failed') {
      journalEvents.push(input.eventType);
    } else {
      journalEvents.push(input.eventType);
    }
    return {
      status: 'appended',
      event: { event_type: input.eventType, timestamp: '2026-08-30T00:00:01.000Z' },
      state: {
        ...input.campaignControl.initial_state,
        phase: input.eventType === 'vertical_verified' ? 'REVIEWING'
          : input.eventType === 'review_completed' ? 'ADJUDICATING'
            : input.campaignControl.initial_state.phase,
      },
    };
  },
  implementationDispatcher() {
    implCallsGreen += 1;
    throw new Error('resume must not re-dispatch implementation');
  },
  diffProvider() { return diff; },
  reviewDispatcher() {
    reviewCalls += 1;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        runner: 'fixture', model: 'fixture-reviewer', status: 'reviewed',
        verdict: 'SHIP-AS-IS', findings: '[]', raw_log: '/tmp/l', error: null,
      },
    };
  },
}).runImplementationReviewLoop({
  promptFile: fxGreen.promptFile,
  branch: fxGreen.branch,
  base: fxGreen.base,
  roster,
  campaignContract: fxGreen.contractPath,
  campaignSeal: fxGreen.sealPath,
  resume: true,
});
console.log(`green_status=${green.status}`);
console.log(`green_impl_calls=${implCallsGreen}`);
console.log(`green_review_calls=${reviewCalls}`);
console.log(`green_terminal_stop=${journalEvents.includes('terminal_stop')}`);
console.log(`green_reason=${green.reason || ''}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "boundary resume engine suite process exits 0"
# RED at base 14168cad: status=blocked reason='campaign resume from BOUNDARY_REJECTED cannot dispatch implementation'
assert_contains "$OUT" "red_status=blocked" "no-candidate BOUNDARY_REJECTED resume is blocked"
assert_contains "$OUT" "red_reason=no candidate — re-dispatch is a new attempt" \
  "no-candidate message is honest (RED at base 14168cad: cannot dispatch implementation)"
assert_contains "$OUT" "red_impl_calls=0" "no-candidate path dispatches nothing"
assert_contains "$OUT" "green_impl_calls=0" "recorded candidate resume does not re-dispatch implementation"
assert_contains "$OUT" "green_review_calls=2" "recorded candidate resume runs review"
assert_contains "$OUT" "green_terminal_stop=false" "recorded candidate resume journals no TERMINAL_STOP"
echo "$OUT"
