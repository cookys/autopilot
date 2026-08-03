#!/usr/bin/env bash
# ICC P4: hermetic 057 miniature-repository convergence dogfood.
. "$(dirname "$0")/lib.sh"
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

REPO="$TEST_TMP/057-repo"
mkdir -p "$REPO/.claude" "$REPO/assets"
git -C "$REPO" init -q -b develop
git -C "$REPO" config user.email 057@example.invalid
git -C "$REPO" config user.name "ICC 057 Dogfood"
write_mission_governance "$REPO/.claude/owner-kernel-governance.json" shadow
printf 'alpha\n' >"$REPO/assets/source.txt"
git -C "$REPO" add .
git -C "$REPO" commit -qm "057 base"
BASE="$(git -C "$REPO" rev-parse HEAD)"

OUT="$(node - "$REPO_ROOT" "$REPO" "$TEST_TMP" "$BASE" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, tmp, base] = process.argv.slice(2);
const {
  adjudicateCampaignReview,
  CampaignCompositionError,
  compileCampaignDispositionPolicy,
  completeCampaignAdmission,
  runCampaignComposition,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
function finalPanelReceipt(review = {}) {
  const seat = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_final_panel_seat',
    seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: review.verdict || 'SHIP-AS-IS',
    review_digest: review.review_digest || 'f'.repeat(64), reason: null,
  };
  seat.receipt_digest = canonicalDigest(seat);
  return {
    ...review,
    reviewed: true,
    sealed_min_panel_size: 1,
    final_panel_count: 1,
    final_panel_seat_receipts: [seat],
  };
}
const policy = compileCampaignDispositionPolicy('acceptance-bound');
const readiness = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};

function contract(ticket, profile, acceptance, branch) {
  const commonRaw = git('rev-parse', '--git-common-dir');
  const common = fs.realpathSync(path.resolve(repo, commonRaw));
  return {
    schema_version: 1,
    ticket,
    profile,
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch,
    vertical_acceptance: acceptance,
    allowed_path_prefixes: ['dist/'],
    max_changed_files: 5,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 120,
    verify_cmd: 'node verify.js',
    rubric_ids: ['ICC-057'],
  };
}

function sealContract(name, value) {
  const contractPath = path.join(tmp, `${name}.json`);
  const sealPath = path.join(tmp, `${name}.seal.json`);
  fs.writeFileSync(contractPath, `${JSON.stringify(value, null, 2)}\n`);
  try {
    execFileSync(process.execPath, [
      path.join(root, 'scripts', 'implementation-campaign-check.js'),
      'seal', '--contract', contractPath, '--repo', repo,
      '--mission-mode', 'shadow', '--out', sealPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const stdout = error.stdout ? String(error.stdout) : '';
    const stderr = error.stderr ? String(error.stderr) : '';
    throw new Error(`seal ${name} rejected:\n${stdout}${stderr}`);
  }
  return { contractPath, sealPath };
}

// Case 3: another ticket or another sealed contract cannot resume/acquire 057.
const intakeContract = contract('057', 'poc', ['transformed asset exists'], 'feat/057-intake');
const intakeFiles = sealContract('057-intake', intakeContract);
const control = runCampaignIntake({
  repo,
  ...intakeFiles,
  promptFile: path.join(repo, 'assets', 'source.txt'),
  branch: intakeContract.branch,
  base,
  roster: { implementer_engine: 'fixture' },
  observedAt: '2026-07-28T00:00:00.000Z',
}, readiness);
assert.strictEqual(control.status, 'admitted');
const otherTicket = sealContract(
  '058-intake',
  contract('058', 'poc', ['transformed asset exists'], 'feat/057-intake'),
);
const ticketResume = runCampaignIntake({
  repo,
  ...otherTicket,
  promptFile: path.join(repo, 'assets', 'source.txt'),
  branch: 'feat/057-intake',
  base,
  roster: { implementer_engine: 'fixture' },
  resume: true,
  observedAt: '2026-07-28T00:00:01.000Z',
}, readiness);
assert.strictEqual(ticketResume.rejection.code, 'campaign_resume_not_found');
const changedContract = sealContract(
  '057-changed',
  contract('057', 'poc', ['different frozen acceptance'], 'feat/057-intake'),
);
const contractResume = runCampaignIntake({
  repo,
  ...changedContract,
  promptFile: path.join(repo, 'assets', 'source.txt'),
  branch: 'feat/057-intake',
  base,
  roster: { implementer_engine: 'fixture' },
  resume: true,
  observedAt: '2026-07-28T00:00:02.000Z',
}, readiness);
assert.strictEqual(contractResume.rejection.code, 'campaign_resume_not_found');
completeCampaignAdmission({ repo, campaignControl: control });

function checkout(branch) {
  git('checkout', '-qB', branch, base);
}

function commitCandidate(message, mutate) {
  mutate();
  git('add', 'dist');
  git('commit', '-qm', message);
  const commit = git('rev-parse', 'HEAD');
  return {
    committed: true,
    commit,
    tree_sha: git('rev-parse', 'HEAD^{tree}'),
    branch: git('branch', '--show-current'),
    writer_fence: { receipt_digest: sha(`fence:${commit}`) },
  };
}

function review(findings, generation, scope) {
  const selected = typeof findings === 'function' ? findings(generation, scope) : findings;
  const encoded = JSON.stringify(selected);
  return {
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: encoded,
    review_digest: sha(`${scope}:${generation}:${encoded}`),
  };
}

function adjudicator(contractValue) {
  return ({ review: receipt }) => adjudicateCampaignReview({
    review: receipt,
    dispositionAuthority: policy({ review: receipt, contract: contractValue }),
    now: '2026-07-28T00:00:10.000Z',
  });
}

function pocAdjudicator({ review: receipt }) {
  const findings = JSON.parse(receipt.findings);
  return adjudicateCampaignReview({
    review: receipt,
    dispositionAuthority: {
      authority: 'depth-0',
      actor_id: 'owner/057-dogfood',
      review_digest: receipt.review_digest,
      decisions: findings.map((finding) => ({
        finding_id: finding.finding_id,
        evidence: {
          kind: 'trace',
          trace_chain: [`057-dogfood:${finding.finding_id}`],
          confirmed_by: 'owner/057-dogfood',
        },
        disposition: finding.finding_id === relevant.finding_id
          ? {
            disposition: 'must-fix-now',
            acceptance_id: 'vertical_acceptance[1]',
            deferral_harm: 'the frozen checksum acceptance remains unsatisfied',
          }
          : {
            disposition: 'follow-up',
            context: 'device publication is outside this POC vertical slice',
            trigger: 'a future contract explicitly authorizes publication scope',
            proposed_backlog_title: 'Add authenticated device publication',
          },
      })),
    },
    now: '2026-07-28T00:00:10.000Z',
  });
}

const relevant = {
  finding_id: '057-checksum',
  claim: 'checksum accompanies transformed asset',
  severity: '🟠',
  source: '057-review',
};
const publication = {
  finding_id: '057-publication-auth',
  claim: 'authenticated device publication',
  severity: '🟠',
  source: '057-review',
};

// Case 1: POC vertical slice + one relevant repair; publication is bounded follow-up.
checkout('feat/057-poc');
const pocContract = contract(
  '057',
  'poc',
  ['transformed asset exists', 'checksum accompanies transformed asset'],
  'feat/057-poc',
);
let pocFinalPanels = 0;
const pocKinds = [];
const poc = runCampaignComposition({ promptBytes: 0,
  maxRepairGenerations: 2,
  minPanelSize: 1,
}, {
  preflight: () => ({ passed: true }),
  implement({ kind }) {
    pocKinds.push(kind);
    if (kind === 'initial') {
      return commitCandidate('057 vertical asset', () => {
        fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
        fs.writeFileSync(
          path.join(repo, 'dist', 'output.txt'),
          fs.readFileSync(path.join(repo, 'assets', 'source.txt'), 'utf8').toUpperCase(),
        );
      });
    }
    return commitCandidate('057 relevant checksum repair', () => {
      const bytes = fs.readFileSync(path.join(repo, 'dist', 'output.txt'));
      fs.writeFileSync(path.join(repo, 'dist', 'output.sha256'), `${sha(bytes)}\n`);
    });
  },
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: sha('poc-green') }),
  review: ({ repair_generation: generation, scope }) => review(
    generation === 0 ? [relevant, publication] : [publication],
    generation,
    scope,
  ),
  adjudicate: pocAdjudicator,
  convergence: () => ({ passed: true }),
  finalPanel({ repair_generation: generation }) {
    pocFinalPanels += 1;
    return finalPanelReceipt(review([publication], generation, 'final'));
  },
});
assert.strictEqual(poc.status, 'follow_up');
assert.strictEqual(poc.repair_generations, 1);
assert.deepStrictEqual(pocKinds, ['initial', 'review_repair']);
assert.strictEqual(poc.follow_up.length, 1);
assert.strictEqual(poc.follow_up[0].id, publication.finding_id);
assert.strictEqual(poc.final_panel_count, 1);
assert.strictEqual(pocFinalPanels, 1);

// Case 2: generation three is rejected before any adapter/model spend.
let modelSpend = 0;
const spend = () => {
  modelSpend += 1;
  return { passed: true };
};
assert.throws(() => runCampaignComposition({ promptBytes: 0,
  maxRepairGenerations: 2,
  minPanelSize: 1,
  resume: {
    phase: 'VERTICAL_VERIFICATION',
    repair_generation: 3,
    candidate: { ...poc, committed: true, tree_sha: git('rev-parse', 'HEAD^{tree}') },
  },
}, {
  preflight: spend,
  implement: spend,
  scopeCheck: spend,
  verify: spend,
  review: spend,
  adjudicate: spend,
  convergence: spend,
  finalPanel: spend,
}), (error) => error instanceof CampaignCompositionError
  && error.code === 'REPAIR_BUDGET_EXCEEDED');
assert.strictEqual(modelSpend, 0);

// Case 4: the same publication claim becomes must-fix only when production acceptance names it.
checkout('feat/057-production');
const productionContract = contract(
  '057-production',
  'production',
  ['transformed asset exists', 'authenticated device publication'],
  'feat/057-production',
);
const productionRepairs = [];
const production = runCampaignComposition({ promptBytes: 0, maxRepairGenerations: 2, minPanelSize: 1 }, {
  preflight: () => ({ passed: true }),
  implement({ kind, repair_finding_ids: findingIds }) {
    if (kind !== 'initial') productionRepairs.push(...findingIds);
    return commitCandidate(`057 production ${kind}`, () => {
      fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'dist', 'output.txt'), 'ALPHA\n');
      if (kind !== 'initial') {
        fs.writeFileSync(path.join(repo, 'dist', 'publication-auth.json'), '{"required":true}\n');
      }
    });
  },
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ passed: true, receipt_digest: sha('production-green') }),
  review: ({ repair_generation: generation, scope }) =>
    review(generation === 0 ? [publication] : [], generation, scope),
  adjudicate: adjudicator(productionContract),
  convergence: () => ({ passed: true }),
  finalPanel: ({ repair_generation: generation }) => finalPanelReceipt(review([], generation, 'final')),
});
assert.strictEqual(production.status, 'ready');
assert.deepStrictEqual(productionRepairs, [publication.finding_id]);

// Dated compatibility rail remains explicit in the ship artifact.
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const legacyCommit = git('rev-parse', 'HEAD');
const legacyRoster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
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
};
const legacyEngine = new AutopilotEngine({
  cwd: repo,
  implementationDispatcher(args) {
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
        base: args[args.indexOf('--base') + 1],
        commit: legacyCommit,
        files_changed: 1,
        insertions: 1,
        deletions: 0,
        worktree: repo,
        agent_log: null,
        error: null,
      },
    };
  },
  reviewDispatcher() {
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
  diffProvider: () => path.join(repo, 'assets', 'source.txt'),
});
const legacy = legacyEngine.runImplementationReviewLoop({
  legacyUnmanaged: true,
  promptFile: path.join(repo, 'assets', 'source.txt'),
  branch: 'feat/057-production',
  base,
  roster: legacyRoster,
  noVerifyFirst: true,
});
assert.strictEqual(legacy.status, 'converged');
assert.strictEqual(legacy.campaign_control.status, 'legacy_unmanaged');
assert.strictEqual(legacy.campaign_control.removal_release, 'v2.35.0');
assert.strictEqual(legacy.campaign_control.removal_deadline, '2026-08-31');
assert.strictEqual(legacy.campaign_control.full_enforcement, false);

let invalidLifecycleComposerCalls = 0;
let invalidLifecycleImplementationCalls = 0;
let invalidLifecycleReviewCalls = 0;
let invalidLifecycleRelease = null;
const invalidLifecycleEngine = new AutopilotEngine({
  cwd: repo,
  campaignIntake: () => control,
  campaignLifecycleInspector: () => ({ status: 'stale' }),
  campaignAdmissionReleaser({ rejection }) {
    invalidLifecycleRelease = rejection;
    return { status: 'released' };
  },
  campaignComposer() {
    invalidLifecycleComposerCalls += 1;
    throw new Error('invalid lifecycle receipt must block before composition');
  },
  implementationDispatcher() {
    invalidLifecycleImplementationCalls += 1;
    throw new Error('invalid lifecycle receipt must block before implementation');
  },
  reviewDispatcher() {
    invalidLifecycleReviewCalls += 1;
    throw new Error('invalid lifecycle receipt must block before review');
  },
});
const invalidLifecycle = invalidLifecycleEngine.runImplementationReviewLoop({
  promptFile: path.join(repo, 'assets', 'source.txt'),
  branch: intakeContract.branch,
  base,
  roster: legacyRoster,
  campaignContract: intakeFiles.contractPath,
  campaignSeal: intakeFiles.sealPath,
  lifecycleReceipt: path.join(tmp, 'invalid-lifecycle.json'),
});
assert.strictEqual(invalidLifecycle.status, 'blocked');
assert.strictEqual(invalidLifecycle.phase, 'campaign_lifecycle_receipt');
assert.strictEqual(invalidLifecycle.campaign_control.admission_release.status, 'released');
assert.strictEqual(invalidLifecycleRelease.code, 'campaign_lifecycle_receipt_invalid');
assert.strictEqual(invalidLifecycleComposerCalls, 0);
assert.strictEqual(invalidLifecycleImplementationCalls, 0);
assert.strictEqual(invalidLifecycleReviewCalls, 0);

console.log('poc_bounded_follow_up=true');
console.log('generation_three_pre_spend=true');
console.log('cross_ticket_contract_resume_rejected=true');
console.log('production_acceptance_controls_publication=true');
console.log('allowed_legacy_terminal_disclosed=true');
console.log('invalid_lifecycle_releases_no_effect=true');
console.log(`lifecycle_root=${control.campaign_id}`);
NODE
)"
assert_exit_code "$?" "0" "057 composition/intake dogfood exits zero"
for key in poc_bounded_follow_up generation_three_pre_spend \
  cross_ticket_contract_resume_rejected production_acceptance_controls_publication \
  allowed_legacy_terminal_disclosed invalid_lifecycle_releases_no_effect; do
  assert_contains "$OUT" "$key=true" "057 dogfood proves $key"
done

# Case 5 crosses a real process boundary after the engine durably records the committed mutation.
KILL_BRANCH="feat/057-kill-resume"
KILL_WORKTREE="$TEST_TMP/057-kill-resume-worktree"
# The controller owns the clean base checkout. The implementation candidate is
# a distinct registered worktree, matching the production ownership topology.
git -C "$REPO" checkout -qB controller/057-kill-resume "$BASE"
git -C "$REPO" worktree add -q -b "$KILL_BRANCH" "$KILL_WORKTREE" "$BASE"
mkdir -p "$KILL_WORKTREE/dist"
printf 'committed exactly once\n' >"$KILL_WORKTREE/dist/kill-resume.txt"
git -C "$KILL_WORKTREE" add dist/kill-resume.txt
git -C "$KILL_WORKTREE" commit -qm "057 kill-resume candidate"
KILL_COMMIT="$(git -C "$KILL_WORKTREE" rev-parse HEAD)"
KILL_TREE="$(git -C "$KILL_WORKTREE" rev-parse HEAD^{tree})"
KILL_CONTRACT="$TEST_TMP/057-kill-resume.json"
KILL_SEAL="$TEST_TMP/057-kill-resume.seal.json"
KILL_PROMPT="$TEST_TMP/057-kill-resume.prompt"
KILL_COUNT="$TEST_TMP/057-kill-resume.count"
COMMON_RAW="$(git -C "$REPO" rev-parse --git-common-dir)"
COMMON_DIR="$(realpath "$REPO/$COMMON_RAW")"
printf 'resume committed mutation without implementing twice\n' >"$KILL_PROMPT"
node - "$KILL_CONTRACT" "$COMMON_DIR" "$BASE" "$KILL_BRANCH" <<'NODE'
const fs = require('fs');
const [target, commonDir, base, branch] = process.argv.slice(2);
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  ticket: '057-kill-resume',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`,
  base_sha: base,
  branch,
  vertical_acceptance: ['resume verifies the committed candidate'],
  allowed_path_prefixes: ['dist/'],
  max_changed_files: 5,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node verify.js',
  rubric_ids: ['ICC-KILL-057'],
}, null, 2)}\n`);
NODE
KILL_SEAL_OUT="$(node "$REPO_ROOT/scripts/implementation-campaign-check.js" seal \
  --contract "$KILL_CONTRACT" --repo "$REPO" --mission-mode shadow \
  --out "$KILL_SEAL" 2>&1)"
assert_exit_code "$?" "0" "kill-resume campaign seals: $KILL_SEAL_OUT"
if [ ! -s "$KILL_SEAL" ]; then
  finalize_test
fi

set +e
KILL_OUT="$(node - "$REPO_ROOT" "$REPO" "$KILL_WORKTREE" "$KILL_CONTRACT" "$KILL_SEAL" \
  "$KILL_PROMPT" "$BASE" "$KILL_BRANCH" "$KILL_COMMIT" "$KILL_COUNT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const [
  root, repo, candidateWorktree, contractPath, sealPath, promptFile, base, branch,
  candidate, countPath,
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
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: [{
    role: 'qc', runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
  }],
};
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-28T01:00:00.000Z',
  campaignIntake(input) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  campaignScopeChecker() {
    return {
      passed: true,
      changed_files: ['dist/kill-resume.txt'],
      total_churn: 1,
      receipt_digest: 'd'.repeat(64),
    };
  },
  campaignPostCommitCheckpoint(checkpoint) {
    fs.writeFileSync(`${countPath}.checkpoint`, `${JSON.stringify(checkpoint)}\n`);
    process.kill(process.pid, 'SIGKILL');
  },
});
engine.implementTask = () => {
  const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) : 0;
  fs.writeFileSync(countPath, `${count + 1}\n`);
  return {
    status: 'committed',
    dispatcher_called: true,
    implementation: {
      commit: candidate,
      worktree: candidateWorktree,
      run_id: 'run-057-kill-resume',
      dispatch_id: 'dispatch-057-kill-resume',
      provider: 'fixture',
      runner: 'fixture',
      model: 'fixture-implementer',
      provider_session_id: null,
      provider_session_reused: false,
      worktree_reused: false,
      insertions: 1,
      deletions: 0,
    },
    implementationResult: { error: null, signal: null, status: 0 },
    ledger: [],
  };
};
const unexpectedKillResult = engine.runImplementationReviewLoop({
  promptFile,
  branch,
  base,
  roster,
  campaignContract: contractPath,
  campaignSeal: sealPath,
  verificationEnv: { PATH: process.env.PATH || '', CI: '057-kill' },
  verificationEnvAllowlist: ['CI'],
});
throw new Error(
  `post-commit kill checkpoint did not terminate the process: ${
    JSON.stringify(unexpectedKillResult)
  }`,
);
NODE
)"
KILL_EXIT=$?
set -e
assert_exit_code "$KILL_EXIT" "137" \
  "real engine process receives SIGKILL immediately after its durable committed-mutation checkpoint"
if [ ! -s "$KILL_COUNT" ] || [ ! -s "$KILL_COUNT.checkpoint" ]; then
  finalize_test
fi
assert_eq "$(tr -d '\n' <"$KILL_COUNT")" "1" \
  "first engine process invokes implementation exactly once"
assert_contains "$(cat "$KILL_COUNT.checkpoint")" '"phase":"VERTICAL_VERIFICATION"' \
  "kill checkpoint observes the durable post-mutation reducer phase"

RESUME_OUT="$(node - "$REPO_ROOT" "$REPO" "$KILL_WORKTREE" "$KILL_CONTRACT" "$KILL_SEAL" \
  "$KILL_PROMPT" "$BASE" "$KILL_BRANCH" "$KILL_COMMIT" "$KILL_TREE" "$KILL_COUNT" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [
  root, repo, candidateWorktree, contractPath, sealPath, promptFile, base, branch,
  candidate, tree, countPath,
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
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: [{
    role: 'qc', runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
  }],
};
let implementationCalls = 0;
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => '2026-07-28T01:00:05.000Z',
  campaignIntake(input) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  implementationDispatcher() {
    implementationCalls += 1;
    throw new Error('resume must not repeat implementation');
  },
  reviewDispatcher() {
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
        findings: '[]',
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
      worktree: candidateWorktree,
      parent: null,
      commit: candidate,
      observed_commit: candidate,
      observed_tree_sha: tree,
      detached: true,
    };
  },
  gitWorktreeRemove() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  repairLineageCleanupTransaction({ record }) {
    if (record.worktree !== candidateWorktree
        || record.branch !== branch
        || record.expected_tip !== candidate) {
      throw new Error('cleanup transaction did not receive the exact candidate worktree');
    }
    require('child_process').execFileSync(
      'git',
      ['-C', repo, 'worktree', 'remove', record.worktree],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
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
});
const result = engine.runImplementationReviewLoop({
  promptFile,
  branch,
  base,
  roster,
  campaignContract: contractPath,
  campaignSeal: sealPath,
  campaignDispositionPolicy: 'acceptance-bound',
  resume: true,
  verificationEnv: { PATH: process.env.PATH || '', CI: '057-kill' },
  verificationEnvAllowlist: ['CI'],
});
assert.strictEqual(result.status, 'converged', JSON.stringify(result));
assert.strictEqual(implementationCalls, 0);
assert.strictEqual(Number(fs.readFileSync(countPath, 'utf8')), 1);
assert.strictEqual(result.campaign_control.initial_state.phase, 'TERMINAL_READY');
console.log('kill_resume_adopts_commit=true');
NODE
)"
assert_exit_code "$?" "0" "new engine process resumes the real durable campaign journal"
assert_contains "$RESUME_OUT" "kill_resume_adopts_commit=true" \
  "resume adopts the committed candidate and leaves implementation count unchanged"

# Case 6 uses the public WLB issuer/inspector, then hands the exact nonzero receipt to ICC and LSM.
LIFECYCLE_ROOT="$(node - "$REPO_ROOT" "$TEST_TMP/057-intake.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, contractPath] = process.argv.slice(2);
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const state = icc.createCampaignState({
  contract,
  contractDigest: icc.canonicalDigest(contract),
  repoIdentity: contract.repo_identity,
  startedAt: '2026-07-28T00:00:00.000Z',
});
process.stdout.write(state.campaign_id);
NODE
)"
WT="$TEST_TMP/057-owned-worktree"
git -C "$REPO" checkout -q develop
git -C "$REPO" worktree add -q -b hetero/057-residue "$WT" develop
{
  printf 'created_at=%s\n' "$(date +%s)"
  printf 'branch=%s\n' hetero/057-residue
  printf 'base_sha=%s\n' "$BASE"
  printf 'run_id=%s\n' 057-leaf
  printf 'root_run_id=%s\n' "$LIFECYCLE_ROOT"
  printf 'loop_id=%s\n' 057-loop
  printf 'schema=2\n'
} >"$WT/.autopilot-worktree"
: >"$WT/.autopilot-worktree.lock"
printf 'dirty\n' >"$WT/residue.txt"
WORKTREE_SCAN="$TEST_TMP/057-worktree-scan.json"
BRANCH_RESULT="$TEST_TMP/057-branch-result.json"
LIFECYCLE_RECEIPT="$TEST_TMP/057-lifecycle.json"
bash "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" scan \
  --repo "$REPO" --root-run-id "$LIFECYCLE_ROOT" >"$WORKTREE_SCAN"
bash "$REPO_ROOT/scripts/reap-dispatch-branches.sh" reap \
  --repo "$REPO" --into develop --inventory-file "$WORKTREE_SCAN" --yes >"$BRANCH_RESULT"
node "$REPO_ROOT/scripts/lifecycle-residue-receipt.js" issue \
  --repo "$REPO" --root-run-id "$LIFECYCLE_ROOT" \
  --worktree-result "$WORKTREE_SCAN" --branch-result "$BRANCH_RESULT" \
  --out "$LIFECYCLE_RECEIPT"

HANDOFF_OUT="$(node - "$REPO_ROOT" "$REPO" "$LIFECYCLE_ROOT" "$LIFECYCLE_RECEIPT" \
  "$TEST_TMP/057-intake.json" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, campaignId, receiptPath, contractPath] = process.argv.slice(2);
const { inspectLifecycleReceipt } = require(
  path.join(root, 'scripts', 'lifecycle-residue-receipt'),
);
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const verificationApi = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const { runCampaignComposition } = require(
  path.join(root, 'src', 'engine', 'campaign-composition'),
);
function finalPanelReceipt(review = {}) {
  const seat = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_final_panel_seat',
    seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: review.verdict || 'SHIP-AS-IS',
    review_digest: review.review_digest || 'f'.repeat(64), reason: null,
  };
  seat.receipt_digest = verificationApi.canonicalDigest(seat);
  return {
    ...review,
    reviewed: true,
    sealed_min_panel_size: 1,
    final_panel_count: 1,
    final_panel_seat_receipts: [seat],
  };
}
const { projectCampaignStatus } = require(path.join(root, 'src', 'campaign', 'status'));
const { buildTaskStatus } = require(path.join(root, 'src', 'status', 'task-status'));
const inspected = inspectLifecycleReceipt({ repo, rootRunId: campaignId, receipt: receiptPath });
assert.strictEqual(inspected.status, 'valid');
assert.strictEqual(inspected.zero_residue, false);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const repoIdentity = contract.repo_identity;
const lifecycleRef = {
  path: receiptPath,
  root_run_id: campaignId,
  receipt_digest: inspected.receipt_digest,
};

// Rebuild the exact admitted ICC identity and produce all LSM inputs through canonical builders.
const contractDigest = icc.canonicalDigest(contract);
let campaignState = icc.createCampaignState({
  contract,
  contractDigest,
  repoIdentity,
  startedAt: '2026-07-28T00:00:00.000Z',
});
assert.strictEqual(campaignState.campaign_id, campaignId);
const candidateCommit = execFileSync(
  'git', ['-C', repo, 'rev-parse', 'develop'], { encoding: 'utf8' },
).trim();
const candidateTree = execFileSync(
  'git', ['-C', repo, 'rev-parse', 'develop^{tree}'], { encoding: 'utf8' },
).trim();
const writerFence = verificationApi.createWriterFence({
  campaignId,
  stageIdentity: '057-lifecycle-implementer',
  candidateCommit,
  candidateTreeSha: candidateTree,
  implementationResult: {
    status: 'committed',
    implementation: { commit: candidateCommit },
    implementationResult: { status: 0, signal: null, error: null },
  },
});
const candidate = icc.normalizeCampaignArtifactReference({
  kind: 'git_candidate',
  commit: candidateCommit,
  tree_sha: candidateTree,
  branch: contract.branch,
  base: contract.base_sha,
  writer_fence: writerFence,
  repair_lineage: {
    lineage_id: campaignId,
    branch: contract.branch,
    worktree: repo,
    provider_session_id: null,
    provider_session_reused: false,
    provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
    worktree_reused: false,
    worktree_instance_id: 'b'.repeat(64),
    cleanup_epoch: 1,
    cleanup_receipt_id: null,
    generation: 0,
    inherited_churn: 0,
    delta_churn: 0,
    retention_owner: campaignId,
    retention_reason: 'implementation-campaign-repair-lineage',
    retention_expires_at: 2000000000,
    terminal_worktree_disposition: 'active',
    transcript_reused: false,
    transcript_source_digest: 'a'.repeat(64),
    review_input_mode: 'full_diff_generation',
    new_input_bytes: 0,
    new_input_tokens: null,
    input_token_measurement: 'unavailable',
    finding_occurrences: [],
    accepted_invariant_ids: [],
    accepted_invariants: [],
    accepted_invariants_source_commit: null,
    accepted_invariants_digest: null,
    prior_review_finding_ids: [],
    previous_repair_finding_count: null,
    non_reduction_rounds: 0,
    repair_scope_paths: ['dist/kill-resume.txt'],
    repair_scope_seal: null,
  },
});
const verificationRequest = verificationApi.createVerificationRequest({
  treeSha: candidateTree,
  verifyCmd: contract.verify_cmd,
  env: { PATH: '/usr/bin', CI: '057-lifecycle' },
  envAllowlist: ['CI'],
});
const checkoutAttestation = verificationApi.createDetachedCheckoutAttestation({
  candidateCommit,
  candidateTreeSha: candidateTree,
  worktreeResult: {
    error: null,
    signal: null,
    status: 0,
    detached: true,
    commit: candidateCommit,
    observed_commit: candidateCommit,
    observed_tree_sha: candidateTree,
    worktree: '/tmp/057-lifecycle-verification',
  },
});
const verificationReceipt = verificationApi.createVerificationReceipt({
  campaignId,
  request: verificationRequest,
  exitStatus: 0,
  startedAt: '2026-07-28T00:00:02.000Z',
  endedAt: '2026-07-28T00:00:03.000Z',
  writerFence,
  checkoutAttestation,
  executedArgv: verificationApi.verificationArgv(contract.verify_cmd),
  stdout: 'ok\n',
});
const terminal = runCampaignComposition({ promptBytes: 0,
  maxRepairGenerations: 0,
  minPanelSize: 1,
  lifecycleReceiptRef: lifecycleRef,
}, {
  preflight: () => ({ passed: true }),
  implement: () => ({ ...candidate, committed: true }),
  scopeCheck: () => ({ passed: true }),
  verify: () => ({ ...verificationReceipt, passed: true }),
  review: () => ({
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: '[]',
    review_digest: mission.sha256('057-review'),
  }),
  adjudicate: () => ({
    registry_complete: true,
    repair_gate_passed: true,
    registry_digest: mission.sha256('057-registry'),
    must_fix_now: [], follow_up: [], rejected: [],
  }),
  convergence: () => ({ passed: true }),
  finalPanel: () => finalPanelReceipt({
    reviewed: true,
    verdict: 'SHIP-AS-IS',
    findings: '[]',
    review_digest: mission.sha256('057-final-review'),
  }),
});
assert.deepStrictEqual(terminal.lifecycle_receipt_ref, lifecycleRef);

const events = [];
function applyEvent(eventType, output, payload, second) {
  const event = {
    schema_version: 1,
    event_type: eventType,
    campaign_id: campaignId,
    contract_digest: contractDigest,
    generation: 0,
    idempotency_key: `057:${eventType}`,
    input_artifact_digest: campaignState.last_output_artifact_digest,
    output_artifact_digest: output,
    timestamp: `2026-07-28T00:00:0${second}.000Z`,
    stage_identity: '057-lifecycle-implementer',
    usage: {
      repair_generations: 0,
      elapsed_wall_seconds: second,
      changed_files: second === 1 ? 0 : 1,
      churn: second === 1 ? 0 : 2,
    },
    payload,
  };
  events.push(event);
  campaignState = icc.reduceCampaignState(campaignState, event);
}
applyEvent(
  icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
  mission.sha256('057-implementation-started'),
  { sealed_contract: true },
  1,
);
applyEvent(
  icc.CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED,
  mission.sha256('057-implementation-completed'),
  { scope_check_passed: true, scope_check_digest: mission.sha256('057-scope') },
  2,
);
applyEvent(
  icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
  verificationReceipt.receipt_digest,
  { passed: true, evidence_digest: verificationReceipt.receipt_digest },
  3,
);
applyEvent(
  icc.CAMPAIGN_EVENTS.REVIEW_COMPLETED,
  mission.sha256('057-review-completed'),
  { review_digest: mission.sha256('057-review') },
  4,
);
applyEvent(
  icc.CAMPAIGN_EVENTS.TERMINAL_READY,
  terminal.receipt_digest,
  {
    registry_complete: true,
    registry_digest: mission.sha256('057-registry'),
    convergence_digest: mission.sha256('057-convergence'),
    lifecycle_receipt_ref: lifecycleRef,
    reason: '057 product acceptance satisfied',
  },
  5,
);
const campaignBundle = {
  contract,
  events,
  state: campaignState,
  terminal_receipt: terminal,
  verification_receipt: verificationReceipt,
  candidate,
};
const campaignStatus = projectCampaignStatus({
  state: campaignState,
  latest_lease: { state: 'verified' },
  lifecycle_receipt_ref: lifecycleRef,
}, [], '2026-07-28T00:00:20.000Z');
assert.strictEqual(campaignStatus.activity, 'completed');
assert.deepStrictEqual(campaignStatus.lifecycle_receipt_ref, lifecycleRef);

const rootRunId = campaignId;
const policyHash = mission.sha256('057-lifecycle-policy');
const authorityId = mission.sha256('057-lifecycle-authority');
const missionContract = {
  schema_version: 1,
  artifact_type: 'mission_convergence_contract',
  contract_id: `mission-v1-${mission.sha256('057-lifecycle-contract')}`,
  repo_identity: repoIdentity,
  mission_lineage_id: `lineage-v1-${mission.sha256('057-lifecycle-lineage')}`,
  task_authority_id: authorityId,
  policy_hash: policyHash,
  enforcement_mode: 'shadow',
  state: 'DRAFT',
  closure_ratio: 0.75,
  max_stagnant_campaigns: 2,
  axes: Object.fromEntries(mission.SUPPORTED_AXES.map((axis) => [axis, {
    authorized_ceiling: axis === 'output_bytes' ? 4096 : 1000,
    reserved_active: 0,
    durable_consumed: 0,
    known: true,
    enforced: true,
  }])),
  grant_contract: {
    idempotency_key_required: true,
    single_use: true,
    expiry_seconds: 3600,
    bindings: [
      'mission_lineage_id',
      'task_authority_id',
      'campaign_id',
      'campaign_contract_digest',
      'base_sha',
      'acceptance_ids',
    ],
  },
  control_contract: {
    actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
    allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
    ceiling_loosen_authority: 'authenticated_user',
  },
  lineage_binding: {
    task_authority_id: authorityId,
    root_run_id: rootRunId,
    policy_hash: policyHash,
    successor_inherits_durable_consumed: true,
  },
};
function reservation(state, toolCalls) {
  return {
    per_axis: mission.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: state.axes[axis].authorized_ceiling,
      reserved_active: axis === 'tool_calls' ? toolCalls : (axis === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axis].durable_consumed,
      known: true,
    })),
  };
}
let missionState = mission.createMissionState(missionContract);
const claimed = mission.reduceMissionState(missionState, {
  event_type: 'grant_claimed',
  sequence: 1,
  mission_lineage_id: missionState.mission_lineage_id,
  payload: {
    idempotency_key: '057-lifecycle-claim',
    mission_lineage_id: missionState.mission_lineage_id,
    task_authority_id: missionState.task_authority_id,
    campaign_id: 'mission-campaign-057',
    campaign_contract_digest: contractDigest,
    base_sha: contract.base_sha,
    acceptance_ids: ['057-lifecycle-acceptance'],
    reservation: reservation(missionState, 5),
    issued_at: '2026-07-28T00:00:00.000Z',
    expires_at: '2026-07-28T01:00:00.000Z',
  },
});
missionState = claimed.state;
missionState = mission.reduceMissionState(missionState, {
  event_type: 'acceptance_satisfied',
  sequence: 2,
  mission_lineage_id: missionState.mission_lineage_id,
  payload: { acceptance_hash: mission.sha256('057-lifecycle-acceptance') },
}).state;
missionState = mission.reduceMissionState(missionState, {
  event_type: 'reconciliation',
  sequence: 3,
  mission_lineage_id: missionState.mission_lineage_id,
  payload: {
    claim_id: claimed.receipt.claim_id,
    actual_usage: reservation(missionState, 5),
  },
}).state;
missionState = mission.reduceMissionState(missionState, {
  event_type: 'closure_evaluated',
  sequence: 4,
  mission_lineage_id: missionState.mission_lineage_id,
  payload: { ratio: 0.9, other_axes_below_ratio: false, unknown_required_axis: false },
}).state;
const missionResidueBody = { lifecycle_residue: [] };
const missionResidue = {
  ...missionResidueBody,
  residue_digest: mission.sha256(missionResidueBody),
};
const missionTerminal = mission.buildMissionTerminalReceipt(missionState, missionResidue);
const missionClaim = missionState.claims[claimed.receipt.claim_id];

const task = buildTaskStatus({
  repo,
  root_run_id: rootRunId,
  observed_at: '2026-07-28T00:00:20.000Z',
  goal: '057 lifecycle handoff',
  phase: 'campaign-terminal',
  mission: { state: missionState, terminal_receipt: missionTerminal },
  campaigns: [campaignBundle],
  lifecycle_receipt_path: receiptPath,
  integration: {
    target_ref: null, consumer_ref: null, remote_ref: null,
    push_required: false, required_consumer_update: false,
  },
  merge_preflight: null,
  merge_execution: null,
}, {
  resolveRepoIdentity: () => repoIdentity,
  inspectLifecycleReceipt: ({ repo: target, rootRunId, receipt }) =>
    inspectLifecycleReceipt({ repo: target, rootRunId, receipt }),
  resolveCampaignBinding: () => ({
    status: 'valid',
    claim_id: missionClaim.claim_id,
    mission_campaign_id: missionClaim.campaign_id,
    icc_campaign_id: campaignId,
    binding_digest: missionClaim.binding_digest,
  }),
  resolveRef: () => null,
  isAncestor: () => null,
  treeForCommit: () => null,
});
if (task.campaigns_terminal !== true) {
  console.error(`lsm_campaign_diagnostic=${JSON.stringify(task.evidence.campaigns)}`);
}
assert.strictEqual(task.mission_terminal, true);
assert.strictEqual(task.campaigns_terminal, true);
assert.strictEqual(task.acceptance_verdict, 'accepted');
assert.strictEqual(task.zero_residue, false);
assert.strictEqual(task.can_close, false);
console.log('lifecycle_handoff_product_terminal=true');
console.log('downstream_lsm_can_close_false=true');
NODE
)"
assert_exit_code "$?" "0" "057 public WLB→ICC→LSM handoff exits zero"
assert_contains "$HANDOFF_OUT" "lifecycle_handoff_product_terminal=true" \
  "campaign remains terminal with nonzero WLB residue"
assert_contains "$HANDOFF_OUT" "downstream_lsm_can_close_false=true" \
  "LSM alone retains can_close=false"

# ---------------------------------------------------------------------------
# Rotation-aware active campaign view (PRO-P3-U5N class): force rotation while
# a campaign lease is live; status/inspect must remain found and heartbeats must
# still bind to the original lease/generation (duplicate dispatch = 0).
# ---------------------------------------------------------------------------
ROT_OUT="$(
  RUN_LEDGER_MAX_BYTES=450 RUN_LEDGER_MAX_ROTATIONS=4 \
  node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const {
  loadRows,
  projectCampaign,
  runCampaignCli,
} = require(path.join(root, 'src', 'campaign', 'cli'));
const {
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
} = require(path.join(root, 'src', 'engine', 'implementation-campaign'));

const rl = path.join(root, 'scripts', 'run-ledger.sh');
const ledger = path.join(tmp, 'rotation-campaign.jsonl');
const runLedger = (...args) => execFileSync('bash', [rl, ...args], {
  encoding: 'utf8',
  env: {
    ...process.env,
    RUN_LEDGER_MAX_BYTES: '700',
    RUN_LEDGER_MAX_ROTATIONS: '8',
  },
}).trim();

const repoIdentity = 'git-common-dir:/tmp/rotation-fixture';
const contract = {
  ticket: 'rot-057',
  profile: 'poc',
  max_repair_generations: 1,
  max_wall_seconds: 600,
  max_changed_files: 5,
  baseline_churn: 10,
  max_extra_churn: 40,
};
const contractDigest = canonicalDigest(contract);
const campaignId = campaignIdFor(repoIdentity, contract.ticket, contractDigest);
const initialState = createCampaignState({
  contract,
  contractDigest,
  repoIdentity,
  startedAt: '2026-07-28T12:00:00.000Z',
});
assert.strictEqual(initialState.campaign_id, campaignId);

runLedger('init', '--ledger', ledger);
const acquire = JSON.parse(runLedger(
  'stage-acquire', '--ledger', ledger,
  '--run-id', campaignId, '--stage', 'campaign',
  '--pid', String(process.pid),
  '--resources', `campaign:${campaignId}`,
));
const gen = acquire.generation;
const nonce = acquire.nonce;
const intakePayload = {
  schema_version: 1,
  artifact_type: 'implementation_campaign_intake',
  campaign_id: campaignId,
  contract_digest: initialState.contract_digest,
  initial_state: initialState,
  initial_state_digest: canonicalDigest(initialState),
};
runLedger(
  'journal-add', '--ledger', ledger,
  '--run-id', campaignId, '--stage', 'campaign',
  '--generation', String(gen), '--nonce', nonce,
  '--idempotency-key', `intake:${campaignId}`,
  '--op', 'campaign_intake',
  '--payload', JSON.stringify(intakePayload),
);

// Force rotation by padding other runs until the live segment rolls.
for (let i = 0; i < 8; i += 1) {
  runLedger(
    'stage-acquire', '--ledger', ledger,
    '--run-id', `pad-${i}`, '--stage', `pad${i}`,
    '--pid', String(process.pid),
  );
}
assert.ok(fs.existsSync(`${ledger}.1`), 'rotation segment .1 exists');

// Heartbeat after rotation (lease may live only in .1).
const hb = JSON.parse(runLedger(
  'stage-heartbeat', '--ledger', ledger,
  '--run-id', campaignId, '--stage', 'campaign',
  '--generation', String(gen), '--nonce', nonce,
  '--pid', String(process.pid),
));
assert.strictEqual(hb.kind, 'heartbeat');
assert.strictEqual(hb.generation, gen);
assert.strictEqual(hb.nonce, nonce);

const rows = loadRows(ledger);
const projection = projectCampaign(rows, campaignId);
assert.ok(projection, 'campaign still projectable after rotation');
assert.strictEqual(projection.campaign_id, campaignId);
assert.strictEqual(projection.latest_lease.generation, gen);
assert.strictEqual(projection.latest_lease.nonce, nonce);

const prevExit = process.exitCode;
const chunks = [];
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => {
  chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  return true;
};
const statusRc = runCampaignCli(
  ['status', '--campaign-id', campaignId, '--ledger', ledger],
  { cwd: tmp, now: () => '2026-07-28T12:01:00.000Z' },
);
process.stdout.write = origWrite;
const statusOut = chunks.join('');
assert.strictEqual(statusRc, 0, `campaign status rc=${statusRc} out=${statusOut}`);
const status = JSON.parse(statusOut.trim().split('\n').pop());
assert.strictEqual(status.status, 'found', JSON.stringify(status));
assert.strictEqual(status.campaign_id, campaignId);

// Absent id remains not_found.
const missingChunks = [];
process.stdout.write = (chunk) => {
  missingChunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
  return true;
};
const missingRc = runCampaignCli(
  ['status', '--campaign-id', 'campaign-does-not-exist', '--ledger', ledger],
  { cwd: tmp },
);
process.stdout.write = origWrite;
const missing = JSON.parse(missingChunks.join('').trim().split('\n').pop());
assert.strictEqual(missingRc, 1);
assert.strictEqual(missing.status, 'not_found');

// Repeated rotation keeps one carried copy per retained segment/root instead of
// recursively carrying prior copies (which used to grow exponentially).
for (let i = 8; i < 48; i += 1) {
  runLedger(
    'stage-acquire', '--ledger', ledger,
    '--run-id', `pad-${i}`, '--stage', `pad${i}`,
    '--pid', String(process.pid),
  );
}
const afterManyRotations = loadRows(ledger);
const intakeRows = afterManyRotations.filter(
  (row) => row.run_id === campaignId && row.op === 'campaign_intake',
);
assert.ok(intakeRows.length <= 9, `bounded retained intake carries: ${intakeRows.length}`);
assert.strictEqual(
  new Set(intakeRows.filter((row) => row._rotation_carry).map((row) => row._rotation_root)).size,
  1,
);
assert.ok(projectCampaign(afterManyRotations, campaignId));

// A second producer-authored intake remains ambiguous even when its payload is
// byte-identical; only rows marked by the rotation writer are deduplicated.
runLedger(
  'journal-add', '--ledger', ledger,
  '--run-id', campaignId, '--stage', 'campaign',
  '--generation', String(gen), '--nonce', nonce,
  '--idempotency-key', `manual-duplicate:${campaignId}`,
  '--op', 'campaign_intake',
  '--payload', JSON.stringify(intakePayload),
);
assert.throws(
  () => projectCampaign(loadRows(ledger), campaignId),
  /exactly one intake root/,
);

console.log('rotation_campaign_found=true');
console.log(`rotation_generation_stable=${gen}`);
console.log('rotation_duplicate_dispatch=0');
console.log(`rotation_intake_rows_bounded=${intakeRows.length}`);
console.log('manual_duplicate_intake_rejected=true');
if (prevExit !== undefined) process.exitCode = prevExit;
NODE
)"
assert_exit_code "$?" "0" "rotation-aware campaign dogfood exits zero"
assert_contains "$ROT_OUT" "rotation_campaign_found=true" "campaign remains found after forced rotation"
assert_contains "$ROT_OUT" "rotation_duplicate_dispatch=0" "rotation path records zero duplicate dispatch"
assert_contains "$ROT_OUT" "manual_duplicate_intake_rejected=true" "manual duplicate intake remains fail-closed"

finalize_test
