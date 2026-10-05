#!/usr/bin/env bash
# Mods P1W W1h review fix — engine-driven proof that the REAL adjudicate closure appends proxy
# decision rows. Reuses the campaign-repair-engine-at-file-cap fixture (real engine + intake + real
# adjudicator with real depth-0 authority; fake model/git adapters). Stage 2 adjudicates finding
# cap-1; with AUTOPILOT_ROOT_RUN_ID set the default per-repo ledger must hold the decision rows.
# Negative control: `.git/autopilot` is a regular file so the ledger write fails; the engine must
# still adjudicate and dispatch the repair.
# RED (before the closure was wrapped/driven): see run-w/w1h/red2.txt.
# W4 repair (root stamp): RED before the fix = 10 passed, 3 failed (campaign root, job root leak, sidecar count).
TEST_NAME="decision-ledger-engine-adjudicate"
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_PROXY_DECISION_LEDGER 2>/dev/null || true

scenario() {
  local name="$1" neg="$2"
  local T="$TEST_TMP/$name"; mkdir -p "$T"
  local REPO="$T/repo"
  mkdir -p "$REPO/.claude" "$REPO/dist"
  git -C "$REPO" init -q -b develop
  git -C "$REPO" config user.email "w1h@example.invalid"
  git -C "$REPO" config user.name "W1h Test"
  write_mission_governance "$REPO/.claude/owner-kernel-governance.json" shadow
  printf '.autopilot/\n' > "$REPO/.gitignore"
  printf 'base\n' > "$REPO/dist/out.txt"
  git -C "$REPO" add .
  git -C "$REPO" commit -qm base
  local BASE; BASE="$(git -C "$REPO" rev-parse HEAD)"
local DRIVER="$T/driver.js"
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
NODE
  local OUT1 OUT2
  OUT1="$(node "$DRIVER" "$REPO_ROOT" "$REPO" "$BASE" "$T" 1 < /dev/null 2>&1)"
  if [ "$neg" = 1 ]; then mkdir -p "$REPO/.git/autopilot"; rm -rf "$REPO/.git/autopilot/ledger"; printf 'blocked\n' > "$REPO/.git/autopilot/ledger"; fi
  OUT2="$(AUTOPILOT_ROOT_RUN_ID=job-minted-w4 node "$DRIVER" "$REPO_ROOT" "$REPO" "$BASE" "$T" 2 < /dev/null 2>&1)"
  echo "$OUT1"; echo "$OUT2"
  assert_contains "$OUT1" "e1_phase=AWAITING_DISPOSITION" "$name: first pass parks for disposition"
  assert_contains "$OUT2" "e2_repair_dispatched=true" "$name: adjudication completed and the repair was dispatched"
  LEDGER="$REPO/.git/autopilot/ledger/decisions.jsonl"; LEDGER_DIR_AS_FILE="$REPO/.git/autopilot/ledger"
}
scenario pos 0
assert_file_exists "$LEDGER" "engine adjudicate wrote the default per-repo ledger"
assert_eq "$(grep -c '"kind":"decision"' "$LEDGER" 2>/dev/null)" "1" "exactly one decision row for the single adjudicated finding"
assert_contains "$(cat "$LEDGER" 2>/dev/null)" '"decision_id":"adj-' "row has an adjudication decision_id"
# W4 repair: the session/env root (here a minted job root) must NOT win; the campaign root does.
CAMP_ROOT="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).campaignId)' "$TEST_TMP/pos/sidecar.json")"
assert_contains "$CAMP_ROOT" "campaign" "fixture campaign id is readable (guards the assertion below)"
assert_contains "$(cat "$LEDGER" 2>/dev/null)" "\"root_run_id\":\"$CAMP_ROOT\"" "row carries the campaign root, not the session job root"
assert_eq "$(grep -c 'job-minted-w4' "$LEDGER" 2>/dev/null)" "0" "session job root never reaches the row"
SIDE_OUT="$(node -e '
const fs=require("fs");const {buildDecisionsSidecar}=require(process.argv[1]+"/src/status/decisions-sidecar.js");
const rows=fs.readFileSync(process.argv[2],"utf8").split("\n").filter(Boolean).map(JSON.parse);
const id=rows[0].repo_identity;
const s=(root)=>buildDecisionsSidecar({scope:{project_key:"k",repo_identity:id,root_run_id:root},ledgers:[{source:"ledger_default",rows}],runs:[]}).count;
console.log("campaign_scope="+s(process.argv[3])+" job_scope="+s("job-minted-w4"));
' "$REPO_ROOT" "$LEDGER" "$CAMP_ROOT")"
assert_contains "$SIDE_OUT" "campaign_scope=1 job_scope=0" "decisions sidecar for the campaign scope counts the engine row"
assert_contains "$(cat "$LEDGER" 2>/dev/null)" '"refs":["cap-1"' "row refs the finding"
scenario neg 1
assert_file_exists "$LEDGER_DIR_AS_FILE" "negative control: ledger path stayed an unwritable file (write really failed)"
finalize_test
