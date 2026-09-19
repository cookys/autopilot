#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
# Mission harness injects root-run / reconcile receipts that must not poison unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

# RED at 2042c2b1: post-hand wall re-check left the campaign blocked with
# the mutation lease still held (no terminal event, empty salvage path).
WALL_REPO="$TEST_TMP/wall-expiry-repo"
mkdir -p "$WALL_REPO/.claude" "$WALL_REPO/dist"
git -C "$WALL_REPO" init -q -b develop
git -C "$WALL_REPO" config user.email "engine-test@example.invalid"
git -C "$WALL_REPO" config user.name "Engine Test"
write_mission_governance "$WALL_REPO/.claude/owner-kernel-governance.json" shadow
printf 'base\n' > "$WALL_REPO/dist/out.txt"
git -C "$WALL_REPO" add .
git -C "$WALL_REPO" commit -qm base
WALL_BASE="$(git -C "$WALL_REPO" rev-parse HEAD)"

WALL_OUT="$(node - "$REPO_ROOT" "$WALL_REPO" "$WALL_BASE" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, tmp] = process.argv.slice(2);
const { AutopilotEngine, runCampaignIntake, buildImplementationArgs } = require(path.join(root, 'src', 'engine'));
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

function sealContract({ ticket, maxWallSeconds, prompt }) {
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
  fs.writeFileSync(promptFile, `${prompt}\n`);
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch,
    vertical_acceptance: ['panel parallel'],
    allowed_path_prefixes: ['dist/'],
    max_changed_files: 5,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: maxWallSeconds,
    verify_cmd: 'true',
    rubric_ids: ['ICC-KILL-057'],
    final_panel_reserve_seconds: 0,
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  return { branch, worktree, candidate, tree, contractPath, sealPath, promptFile };
}

function inspectCampaign(campaignId) {
  return execFileSync(process.execPath, [
    path.join(root, 'bin', 'autopilot.js'),
    'campaign', 'inspect',
    '--campaign-id', campaignId,
  ], { cwd: repo, encoding: 'utf8' });
}

function statusCampaign(campaignId) {
  return execFileSync(process.execPath, [
    path.join(root, 'bin', 'autopilot.js'),
    'campaign', 'status',
    '--campaign-id', campaignId,
  ], { cwd: repo, encoding: 'utf8' });
}

// (a) hand returns implemented; clock jumps past wall on the next re-check.
{
  const ticket = 'wall-after-hand';
  const fixture = sealContract({ ticket, maxWallSeconds: 2, prompt: 'wall after hand' });
  let handReturned = false;
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => (handReturned
      ? '2026-09-19T00:00:30.000Z'
      : '2026-09-19T00:00:00.000Z'),
    campaignIntake(input) {
      return runCampaignIntake(input, {
        readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
        contextGate: () => ({ owner: 'context_window', status: 'ready' }),
        occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      });
    },
    campaignScopeChecker() {
      return { passed: true, changed_files: ['dist/out.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
    },
    implementationDispatcher(args) {
      handReturned = true;
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          status: 'committed', runner: 'fixture', model: 'fixture-implementer',
          branch: fixture.branch, base, commit: fixture.candidate, files_changed: 1,
          insertions: 1, deletions: 0, worktree: fixture.worktree, agent_log: '/tmp/impl-log',
          error: null, possibly_effectful: true, dispatcher_called: true, model_calls: 1,
        },
      };
    },
    reviewDispatcher() {
      throw new Error('review must not run after wall expiry');
    },
    diffProvider() { return fixture.promptFile; },
    gitWorktreeAdd() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        worktree: fixture.worktree, parent: null, commit: fixture.candidate,
        observed_commit: fixture.candidate, observed_tree_sha: fixture.tree, detached: true,
      };
    },
    gitWorktreeRemove() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
    repairLineageCleanupTransaction() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        executed_argv: ['/bin/sh', '-c', 'true'],
      };
    },
  });
  const result = engine.runImplementationReviewLoop({
    promptFile: fixture.promptFile, branch: fixture.branch, base, roster,
    campaignContract: fixture.contractPath, campaignSeal: fixture.sealPath,
    campaignDispositionPolicy: 'acceptance-bound',
    verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
    verificationEnvAllowlist: ['CI'],
  });
  const summary = JSON.stringify(result);
  const state = result.campaign_control && result.campaign_control.initial_state;
  const lastEvent = result.campaign_control && result.campaign_control.terminal_event;
  const receipt = result.campaign_control && result.campaign_control.failure_receipt;
  console.log(`a_status=${result.status}`);
  console.log(`a_phase=${result.phase}`);
  console.log(`a_reason=${result.reason}`);
  console.log(`a_summary_bytes=${Buffer.byteLength(summary)}`);
  console.log(`a_live_lease=${state && state.live_lease === null ? 'null' : JSON.stringify(state && state.live_lease)}`);
  console.log(`a_last_event=${lastEvent && lastEvent.event_type}`);
  console.log(`a_receipt_commit=${receipt && receipt.candidate && receipt.candidate.commit}`);
  console.log(`a_receipt_branch=${receipt && receipt.candidate && receipt.candidate.branch}`);
  console.log(`a_wall_stage=${receipt && receipt.wall && receipt.wall.stage}`);
  const inspect = inspectCampaign(result.campaign_control.campaign_id);
  const status = JSON.parse(statusCampaign(result.campaign_control.campaign_id));
  assert.ok(inspect.includes('TERMINAL_STOP'), inspect.slice(0, 800));
  console.log(`a_inspect_terminal=true`);
  console.log(`a_activity=${status.activity}`);
}

// (b) wall already exhausted before the first dispatch.
{
  const ticket = 'wall-before-dispatch';
  const fixture = sealContract({ ticket, maxWallSeconds: 2, prompt: 'wall before dispatch' });
  let dispatcherCalls = 0;
  let admitted = false;
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => (admitted
      ? '2026-09-19T01:00:30.000Z'
      : '2026-09-19T01:00:00.000Z'),
    campaignIntake(input) {
      const result = runCampaignIntake(input, {
        readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
        contextGate: () => ({ owner: 'context_window', status: 'ready' }),
        occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      });
      admitted = true;
      return result;
    },
    campaignScopeChecker() {
      return { passed: true, changed_files: ['dist/out.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
    },
    implementationDispatcher() {
      dispatcherCalls += 1;
      throw new Error('implementation dispatcher must not run when wall is already exhausted');
    },
    reviewDispatcher() {
      throw new Error('review must not run when wall is already exhausted');
    },
    diffProvider() { return fixture.promptFile; },
    gitWorktreeAdd() {
      throw new Error('worktree must not be created when wall is already exhausted');
    },
    gitWorktreeRemove() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
    repairLineageCleanupTransaction() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner() {
      throw new Error('verify must not run when wall is already exhausted');
    },
  });
  const result = engine.runImplementationReviewLoop({
    promptFile: fixture.promptFile, branch: fixture.branch, base, roster,
    campaignContract: fixture.contractPath, campaignSeal: fixture.sealPath,
    campaignDispositionPolicy: 'acceptance-bound',
    verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
    verificationEnvAllowlist: ['CI'],
  });
  const state = result.campaign_control && result.campaign_control.initial_state;
  const lastEvent = result.campaign_control && result.campaign_control.terminal_event;
  const receipt = result.campaign_control && result.campaign_control.failure_receipt;
  console.log(`b_status=${result.status}`);
  console.log(`b_phase=${result.phase}`);
  console.log(`b_dispatcher_calls=${dispatcherCalls}`);
  console.log(`b_last_event=${lastEvent && lastEvent.event_type}`);
  console.log(`b_live_lease=${state && state.live_lease === null ? 'null' : JSON.stringify(state && state.live_lease)}`);
  console.log(`b_wall_stage=${receipt && receipt.wall && receipt.wall.stage}`);
}

// (c) builder-managed --timeout; extra args cannot smuggle it.
{
  const implRoster = {
    implementer_runner: 'fixture',
    implementer_engine: 'fixture-implementer',
    implementer_effort: 'high',
  };
  const withTimeout = buildImplementationArgs({
    roster: implRoster,
    promptFile: path.join(tmp, 'c.prompt'),
    branch: 'feat/c',
    base,
    cwd: tmp,
    timeoutSeconds: 17,
  });
  fs.writeFileSync(path.join(tmp, 'c.prompt'), 'c\n');
  console.log(`c_args=${withTimeout.join(' ')}`);
  try {
    buildImplementationArgs({
      roster: implRoster,
      promptFile: path.join(tmp, 'c.prompt'),
      branch: 'feat/c',
      base,
      cwd: tmp,
      extraImplementationArgs: ['--timeout', '5m'],
    });
    console.log('c_extra_timeout=accepted');
  } catch (error) {
    console.log(`c_extra_timeout=${error.message}`);
  }
}
NODE
)"
WALL_EXIT=$?
assert_eq "0" "$WALL_EXIT" "wall-expiry managed loop process exits 0"
# RED at 2042c2b1: a_status=blocked a_phase=scope a_reason=campaign wall-clock
# ceiling exceeded; last_event=mutation_failed without wall/candidate on the
# receipt. b_status=blocked b_phase=campaign_wall_budget b_last_event=undefined
# b_dispatcher_calls=0. c_extra_timeout=accepted and no --timeout on argv.
assert_contains "$WALL_OUT" "a_status=wall_expired" \
  "GREEN: post-hand wall expiry surfaces wall_expired (RED at 2042c2b1: blocked/scope)"
assert_contains "$WALL_OUT" "a_phase=TERMINAL_STOP" \
  "GREEN: phase is journaled terminal"
assert_contains "$WALL_OUT" "a_last_event=mutation_failed" \
  "GREEN: last event MUTATION_FAILED when the hand may have committed"
assert_contains "$WALL_OUT" "a_live_lease=null" \
  "GREEN: live_lease released"
assert_contains "$WALL_OUT" "a_inspect_terminal=true" \
  "campaign inspect projects TERMINAL_STOP"
assert_contains "$WALL_OUT" "a_activity=" \
  "status projection emits activity"
SUMMARY_BYTES="$(printf '%s\n' "$WALL_OUT" | sed -n 's/^a_summary_bytes=//p' | tail -n 1)"
test "${SUMMARY_BYTES:-0}" -gt 0
assert_eq "0" "$?" "summary JSON on stdout is complete (never 0 bytes)"
ACTIVITY="$(printf '%s\n' "$WALL_OUT" | sed -n 's/^a_activity=//p' | tail -n 1)"
case "$ACTIVITY" in
  completed|terminal) ;;
  *) fail "activity must be completed|terminal, got ${ACTIVITY:-<empty>} (never dead)" ;;
esac
assert_contains "$WALL_OUT" "a_receipt_commit=" \
  "failure receipt names the retained candidate commit"
assert_not_contains "$WALL_OUT" "a_receipt_commit=undefined" \
  "candidate commit is bound on the wall-expiry receipt"
assert_contains "$WALL_OUT" "a_wall_stage=verify" \
  "GREEN: post-hand wall receipt names stage verify"
assert_contains "$WALL_OUT" "b_dispatcher_calls=0" \
  "GREEN: no dispatcher call when wall is already exhausted"
assert_contains "$WALL_OUT" "b_last_event=terminal_stop" \
  "GREEN: TERMINAL_STOP when no lease is live"
assert_contains "$WALL_OUT" "b_status=wall_expired" \
  "GREEN: pre-dispatch wall expiry surfaces wall_expired"
assert_contains "$WALL_OUT" "b_wall_stage=implement" \
  "GREEN: pre-dispatch stage is implement"
assert_contains "$WALL_OUT" "--timeout 17s" \
  "buildImplementationArgs emits builder-managed --timeout"
assert_contains "$WALL_OUT" "c_extra_timeout=extra args cannot override --timeout" \
  "caller-supplied --timeout in extra args is rejected"

finalize_test
