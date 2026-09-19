#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

PARK_REPO="$TEST_TMP/park-reserve-repo"
mkdir -p "$PARK_REPO/.claude" "$PARK_REPO/dist"
git -C "$PARK_REPO" init -q -b develop
git -C "$PARK_REPO" config user.email "engine-test@example.invalid"
git -C "$PARK_REPO" config user.name "Engine Test"
write_mission_governance "$PARK_REPO/.claude/owner-kernel-governance.json" shadow
printf '.autopilot/\n' > "$PARK_REPO/.gitignore"
printf 'base\n' > "$PARK_REPO/dist/out.txt"
git -C "$PARK_REPO" add .
git -C "$PARK_REPO" commit -qm base
PARK_BASE="$(git -C "$PARK_REPO" rev-parse HEAD)"

PARK_OUT="$(node - "$REPO_ROOT" "$PARK_REPO" "$PARK_BASE" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, tmp] = process.argv.slice(2);
const { AutopilotEngine, runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const common = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-common-dir')));
const seats = [{
  role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high',
  endpoint: null, family: 'anthropic',
}];
const roster = {
  reviewer_engine: seats[0].model,
  reviewer_effort: 'high',
  reviewer_runner: 'cc-shim',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1,
  in_rail_review: 'single',
  qc_panel_seats_complete: true,
  qc_panel_seats: seats,
  override_admitted_seats: ['qc_panel[0]'],
};
const ticket = 'park-c-reserve';
const branch = `feat/${ticket}`;
const worktree = path.join(tmp, `${ticket}-wt`);
try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' }); } catch (_e) {}
git('worktree', 'add', '-q', '-b', branch, worktree, base);
fs.writeFileSync(path.join(worktree, 'dist', 'out.txt'), `${ticket}\n`);
execFileSync('git', ['-C', worktree, 'add', 'dist/out.txt']);
execFileSync('git', ['-C', worktree, 'commit', '-qm', ticket]);
const candidate = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const tree = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
const contractDir = path.join(tmp, `${ticket}-campaign`);
fs.mkdirSync(contractDir, { recursive: true });
const contractPath = path.join(contractDir, 'campaign.json');
const sealPath = path.join(contractDir, 'campaign.seal.json');
const promptFile = path.join(tmp, `${ticket}.prompt`);
fs.writeFileSync(promptFile, 'park reserve\n');
fs.writeFileSync(contractPath, `${JSON.stringify({
  schema_version: 1,
  ticket,
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${common}`,
  base_sha: base,
  branch,
  vertical_acceptance: ['park names repair round cost'],
  allowed_path_prefixes: ['dist/'],
  max_changed_files: 5,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 7200,
  verify_cmd: 'true',
  rubric_ids: ['PARK-C1'],
  final_panel_reserve_seconds: 0,
}, null, 2)}\n`);
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
], { cwd: repo, encoding: 'utf8' });
let secs = 0;
const iso = () => new Date(Date.parse('2026-07-26T00:00:00.000Z') + secs * 1000).toISOString();
const engine = new AutopilotEngine({
  cwd: repo,
  clock: () => iso(),
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
      verdict: 'PASS',
      changed_files: ['dist/out.txt'],
      total_churn: 1,
      receipt_digest: 'd'.repeat(64),
    };
  },
  campaignAdjudicator() {
    secs = 5435;
    return {
      registry_complete: false,
      reason: 'missing disposition authority',
      must_fix_now: [],
      follow_up: [],
      rejected: [],
    };
  },
  implementationDispatcher() {
    secs = 3601;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        status: 'committed', runner: 'fixture', model: 'fixture-implementer',
        branch, base, commit: candidate, tree_sha: tree,
        files_changed: 1, insertions: 1, deletions: 0,
        worktree, agent_log: '/tmp/impl-log', error: null,
        contained: true, containment: 'plain',
        dispatcher_called: true, model_calls: 1, wall_secs: 3600,
      },
    };
  },
  reviewDispatcher() {
    secs = 5401;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        runner: 'cc-shim', model: 'claude-opus-4-6', status: 'reviewed',
        verdict: 'FIX-THEN-SHIP', findings: '🟠 [park-c-1] dist/out.txt needs a repair',
        raw_log: '/tmp/review-log', error: null,
      },
    };
  },
  diffProvider() { return promptFile; },
  gitWorktreeAdd() {
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '',
      worktree, parent: null, commit: candidate, observed_commit: candidate,
      observed_tree_sha: tree, detached: true,
    };
  },
  gitWorktreeRemove() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
  repairLineageCleanupTransaction() {
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  verifyCommandRunner() {
    secs = 4861;
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '',
      executed_argv: ['/bin/sh', '-c', 'true'],
    };
  },
  gitRevParse(input) {
    const spec = input && input.spec;
    if (spec === 'HEAD' || spec === candidate) return candidate;
    if (spec === 'HEAD^{tree}' || spec === `${candidate}^{tree}`) return tree;
    return git('rev-parse', spec || 'HEAD');
  },
});
const result = engine.runImplementationReviewLoop({
  promptFile, branch, base, roster,
  campaignContract: contractPath, campaignSeal: sealPath,
  verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
  verificationEnvAllowlist: ['CI'],
});
console.log(`status=${result.status}`);
console.log(`phase=${result.phase}`);
console.log(`wall_seconds_remaining=${result.wall_seconds_remaining}`);
console.log(`repair_round_estimate_seconds=${result.repair_round_estimate_seconds}`);
console.log(`repair_round_fits=${result.repair_round_fits}`);
console.log(`campaign_id=${result.campaign_control && result.campaign_control.campaign_id}`);
assert.strictEqual(result.status, 'awaiting_disposition', JSON.stringify({
  status: result.status, phase: result.phase, reason: result.reason,
}).slice(0, 800));
assert.strictEqual(typeof result.wall_seconds_remaining, 'number');
assert.ok(Object.prototype.hasOwnProperty.call(result, 'repair_round_estimate_seconds'));
assert.ok(Object.prototype.hasOwnProperty.call(result, 'repair_round_fits'));
const inspect = execFileSync(process.execPath, [
  path.join(root, 'bin', 'autopilot.js'),
  'campaign', 'inspect',
  '--campaign-id', result.campaign_control.campaign_id,
], { cwd: repo, encoding: 'utf8' });
assert.ok(inspect.includes('awaiting_disposition') || inspect.includes('AWAITING_DISPOSITION'), inspect.slice(0, 800));
assert.ok(inspect.includes('wall_seconds_remaining'), inspect.slice(0, 1200));
assert.ok(inspect.includes('repair_round_estimate_seconds'), inspect.slice(0, 1200));
assert.ok(inspect.includes('repair_round_fits'), inspect.slice(0, 1200));
console.log('inspect_park_fields=true');
NODE
)"
assert_exit_code "$?" "0" "managed park loop: $PARK_OUT"
assert_contains "$PARK_OUT" "status=awaiting_disposition" "managed loop parks at awaiting_disposition"
assert_contains "$PARK_OUT" "inspect_park_fields=true" "campaign inspect carries park estimate fields"

finalize_test
