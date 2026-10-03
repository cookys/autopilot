'use strict';
// Driver for hooks/tests/final-panel-seat-resume-xproc.test.sh: ONE campaign process per
// invocation, so a run and its `--resume` are separate OS processes. The review batch
// dispatcher is the REAL one (real packet build, real fanout) with the dispatch-review.sh
// path pointed at a stub, so the live packet hash and the stored one are the production values.
//   node driver.js <run1|run2> <ctx.json>
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const [phase, ctxPath] = process.argv.slice(2);
const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
const root = ctx.root;
const reviewRunner = require(path.join(root, 'src', 'runners', 'review'));
const realBatch = reviewRunner.dispatchReviewJsonBatch;
reviewRunner.dispatchReviewJsonBatch = (list, opts) => realBatch(
  list.map((item) => ({ ...item, scriptPath: ctx.stub })), opts,
);
process.env.FP_LOG = ctx.log;
process.env.FP_FAIL_MODEL = ctx.failModel || '';
const {
  AutopilotEngine, runCampaignIntake, compileCampaignDispositionPolicy,
} = require(path.join(root, 'src', 'engine'));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const sbx = ctx.sbx;
const tag = ctx.tag;
const branch = `feat/${tag}`;
const worktree = path.join(ctx.tmp, `${tag}-wt`);
const dir = path.join(ctx.tmp, `${tag}-campaign`);
const contractPath = path.join(dir, 'campaign.json');
const sealPath = path.join(dir, 'campaign.seal.json');
const promptFile = path.join(ctx.tmp, `${tag}.prompt`);
const seats = ctx.seats;
let base;
let candidate;
if (phase === 'run1') {
  fs.mkdirSync(path.join(sbx, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(sbx, 'src'), { recursive: true });
  spawnSync('git', ['-C', sbx, 'init', '-q']);
  spawnSync('git', ['-C', sbx, 'config', 'user.email', 'xproc@example.invalid']);
  spawnSync('git', ['-C', sbx, 'config', 'user.name', 'Xproc']);
  const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'));
  gov.mission_convergence = {
    schema_version: 1, enforcement_mode: 'shadow', max_campaigns: 8, max_wall_seconds: 7200,
    max_tool_calls: 1000, max_engine_attempts: 100, max_external_wait_seconds: 600,
    max_canonical_changed_files: 100, max_output_bytes: 1000000, max_deliverables: 8,
    max_parallel: 3, max_batches: 4, max_graph_depth: 4, max_gate_attempts: 16, closure_ratio: 1,
    max_stagnant_campaigns: 2,
  };
  fs.writeFileSync(path.join(sbx, '.claude', 'owner-kernel-governance.json'), `${JSON.stringify(gov, null, 2)}\n`);
  fs.writeFileSync(path.join(sbx, 'src', 'value.txt'), 'base\n');
  execFileSync('git', ['-C', sbx, 'add', '.']);
  execFileSync('git', ['-C', sbx, 'commit', '-qm', 'base']);
  base = git(sbx, 'rev-parse', 'HEAD');
  git(sbx, 'worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `${tag}\n`);
  execFileSync('git', ['-C', worktree, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', tag]);
  candidate = git(worktree, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(ctx.tmp, 'bound.json'), JSON.stringify({ base, candidate }));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(promptFile, 'station\n');
  const common = fs.realpathSync(path.resolve(sbx, git(sbx, 'rev-parse', '--git-common-dir')));
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1, ticket: tag, profile: 'poc', mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`, base_sha: base, branch,
    vertical_acceptance: ['src/value.txt must change'],
    allowed_path_prefixes: ['src/'], max_changed_files: 5, baseline_churn: 10,
    max_growth_ratio: 1.5, max_extra_churn: 5, max_repair_generations: 2,
    max_wall_seconds: 600, final_panel_reserve_seconds: 0,
    verify_cmd: 'true', rubric_ids: ['ICC-STATION1'],
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', sbx, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: sbx, encoding: 'utf8' });
} else {
  ({ base, candidate } = JSON.parse(fs.readFileSync(path.join(ctx.tmp, 'bound.json'), 'utf8')));
  if (ctx.promptSalt) fs.appendFileSync(promptFile, `${ctx.promptSalt}\n`);
}
let impl = 0;
const gitWt = ({ commit } = {}) => {
  const useCommit = commit || candidate;
  const verifyWt = path.join(ctx.tmp, `${tag}-verify-${phase}-${String(useCommit).slice(0, 12)}`);
  try { execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', verifyWt], { stdio: 'ignore' }); } catch (_e) {}
  execFileSync('git', ['-C', sbx, 'worktree', 'add', '-q', '--detach', verifyWt, useCommit]);
  return {
    error: null, status: 0, signal: null, stdout: '', stderr: '', worktree: verifyWt, parent: null,
    commit: useCommit, observed_commit: useCommit,
    observed_tree_sha: git(verifyWt, 'rev-parse', 'HEAD^{tree}'), detached: true,
  };
};
const engine = new AutopilotEngine({
  cwd: sbx,
  clock: () => new Date().toISOString(),
  campaignDispositionProvider: compileCampaignDispositionPolicy('acceptance-bound'),
  campaignIntake(input) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    });
  },
  campaignScopeChecker() {
    return { passed: true, changed_files: ['src/value.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
  },
  implementationDispatcher() {
    impl += 1;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        status: 'committed', runner: 'fixture', model: 'fixture-implementer',
        branch, base, commit: candidate, files_changed: 1, insertions: 1, deletions: 0, worktree,
      },
    };
  },
  diffProvider() {
    // the packet builder requires the byte-exact canonical diff of the bound range
    const diffFile = path.join(ctx.tmp, `${tag}-${phase}.diff`);
    fs.writeFileSync(diffFile, execFileSync('git', [
      '-C', sbx, 'diff', '--no-ext-diff', '--no-textconv', `${base}..${candidate}`,
    ]));
    return diffFile;
  },
  gitWorktreeAdd: gitWt,
  gitWorktreeRemove({ worktree: wt } = {}) {
    if (wt) { try { execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }); } catch (_e) {} }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  repairLineageCleanupTransaction({ record }) {
    if (record && record.worktree) {
      execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', record.worktree], { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  verifyCommandRunner() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '', executed_argv: ['/bin/sh', '-c', 'true'] };
  },
});
engine.implementTask = () => {
  impl += 1;
  return {
    status: 'committed', dispatcher_called: true,
    implementation: {
      commit: candidate, worktree, run_id: `run-${tag}`, dispatch_id: `d-${tag}`, provider: 'fixture',
      runner: 'fixture', model: 'fixture-implementer', insertions: 1, deletions: 0,
    },
    implementationResult: { error: null, signal: null, status: 0 },
    ledger: [],
  };
};
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim',
  reviewer_qualified: true, implementer_engine: 'fixture-implementer',
  implementer_effort: 'high', implementer_runner: 'fixture',
  loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: 3,
  qc_panel_seats_complete: true, qc_panel_seats: seats, in_rail_review: 'panel',
  override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
};
const result = engine.runImplementationReviewLoop({
  promptFile, branch, base, roster,
  campaignContract: contractPath, campaignSeal: sealPath,
  campaignDispositionPolicy: 'acceptance-bound',
  verificationEnv: { PATH: process.env.PATH || '', CI: tag },
  verificationEnvAllowlist: ['CI'],
  ...(phase === 'run2' ? { resume: true } : {}),
});
const body = JSON.stringify({
  phase, impl, status: result.status, reason: result.reason || null,
  durable_wait: result.durable_wait === true, result_keys: Object.keys(result),
  result_head: JSON.stringify(result).slice(0, 1500),
});
fs.writeSync(1, `${body}\n`);
