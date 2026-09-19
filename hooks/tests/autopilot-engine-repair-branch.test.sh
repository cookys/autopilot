#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
# Mission harness injects root-run / reconcile receipts that must not poison unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/docs/plans" "$REPO/.claude" "$REPO/src"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "repair-branch@example.invalid"
git -C "$REPO" config user.name "Repair Branch Test"
write_mission_governance "$REPO/.claude/owner-kernel-governance.json" shadow
printf '## Strict bridge\nFrozen authority.\n' > "$REPO/docs/plans/spec.md"
printf 'required\n' > "$REPO/required.txt"
printf 'seed\n' > "$REPO/src/out.txt"
printf '%s\n' \
  '- implementer_engine: fixture-implementer' \
  '- implementer_runner: fixture' \
  '- reviewer_engine: claude-opus-4-6' \
  '- reviewer_runner: cc-shim' > "$REPO/.claude/review-loop-config.md"
printf '.autopilot/\n' > "$REPO/.gitignore"
git -C "$REPO" add .
git -C "$REPO" commit -qm "base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
PROMPT="$TEST_TMP/prompt.txt"
printf 'Implement the strict repair-branch fixture.\n' > "$PROMPT"

SUITE="$TEST_TMP/repair-branch-suite.js"
cat > "$SUITE" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, promptFile, tmp] = process.argv.slice(2);
const {
  AutopilotEngine,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const projection = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'));
const { sealSessionMarker } = require(path.join(root, 'hooks', 'tests', 'lib', 'session-marker'));
const enginePath = path.join(root, 'src', 'engine', 'autopilot-engine.js');
const engineSrc = fs.readFileSync(enginePath, 'utf8');
assert.ok(
  engineSrc.includes('return expectedBranch({'),
  'buildRepairBranchName must delegate to projection expectedBranch',
);
function buildRepairBranchName({ branch, round, previousCommit }) {
  return projection.expectedBranch({
    campaignBranch: branch,
    base: previousCommit,
    generation: round - 1,
  });
}

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
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1,
  in_rail_review: 'single',
  qc_panel_seats_complete: true,
  qc_panel_seats: seats,
  override_admitted_seats: ['qc_panel[0]'],
};

function branchFromArgs(args) {
  const idx = args.indexOf('--branch');
  return idx >= 0 ? args[idx + 1] : null;
}

function findingFor(id) {
  return {
    id,
    claim: 'src/out.txt needs a repair',
    severity: '🟠',
    source: 'product_review',
    evidence: {
      digest: 'e'.repeat(64),
      classification: 'actionable',
      kind: 'trace',
      trace_chain: ['contract.vertical_acceptance[0]'],
      confirmed_by: 'operator',
    },
    disposition: {
      disposition: 'must-fix-now',
      acceptance_id: 'vertical_acceptance[0]',
      deferral_harm: 'unfixed acceptance remains',
    },
    adjudication_authority: {
      authority: 'depth-0',
      actor_id: 'operator',
      review_digest: 'd'.repeat(64),
    },
  };
}

function writeStrictCampaign({ ticket, branch, rootRunId, maxWall = 7200 }) {
  const dir = path.join(tmp, `${ticket}-campaign`);
  fs.mkdirSync(dir, { recursive: true });
  const campaignPath = path.join(dir, 'campaign.json');
  const sealPath = path.join(dir, 'campaign.seal.json');
  const campaign = {
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: '1'.repeat(64),
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch,
    vertical_acceptance: ['strict projection is enforced'],
    allowed_path_prefixes: ['docs', 'required.txt', 'src'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: maxWall,
    verify_cmd: 'test -f src/out.txt',
    rubric_ids: ['R1'],
    mission_runtime: {
      schema_version: 1,
      root_run_id: rootRunId,
      mission_lineage_id: `lineage-v1-${crypto.createHash('sha256').update(ticket).digest('hex')}`,
      mission_policy_digest: '2'.repeat(64),
      mission_graph_digest: '3'.repeat(64),
      graph_node_id: `${ticket}-node`,
      graph_node_digest: '4'.repeat(64),
    },
    strict_dispatch: {
      schema_version: 1,
      spec: { path: 'docs/plans/spec.md', section: 'Strict bridge' },
      required_paths: ['docs/plans/spec.md', 'required.txt'],
      output_paths: ['src/out.txt'],
      allowed_path_prefixes: ['docs', 'required.txt', 'src'],
      budget: {
        max_changed_files: 4,
        max_wall_seconds: maxWall,
        max_output_bytes: 4096,
        max_tool_calls: 10,
        max_engine_attempts: 2,
      },
      verification_commands: ['test -f src/out.txt'],
    },
  };
  const bytes = `${JSON.stringify(campaign, null, 2)}\n`;
  fs.writeFileSync(campaignPath, bytes);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', campaignPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return { campaign, campaignPath, sealPath, digest };
}

function writeLooseCampaign({ ticket, branch, maxWall = 7200 }) {
  const dir = path.join(tmp, `${ticket}-campaign`);
  fs.mkdirSync(dir, { recursive: true });
  const campaignPath = path.join(dir, 'campaign.json');
  const sealPath = path.join(dir, 'campaign.seal.json');
  fs.writeFileSync(campaignPath, `${JSON.stringify({
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch,
    vertical_acceptance: ['non-strict repair branch control'],
    allowed_path_prefixes: ['src/'],
    max_changed_files: 5,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: maxWall,
    verify_cmd: 'true',
    rubric_ids: ['NS1'],
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', campaignPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  return { campaignPath, sealPath };
}

function resetCampaignResidue() {
  const autopilot = path.join(repo, '.autopilot');
  if (fs.existsSync(autopilot)) {
    for (const name of fs.readdirSync(autopilot)) {
      if (name === 'session-mode') continue;
      fs.rmSync(path.join(autopilot, name), { recursive: true, force: true });
    }
  }
}

function makeWorktree(ticket, branch) {
  const worktree = path.join(tmp, `${ticket}-wt`);
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' });
  } catch (_e) {}
  git('worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.writeFileSync(path.join(worktree, 'src', 'out.txt'), `${ticket}\n`);
  execFileSync('git', ['-C', worktree, 'add', 'src/out.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', ticket]);
  const candidate = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  return { worktree, candidate, tree };
}

function transport({ branch, baseSha, commit, tree, worktree, reused = false }) {
  return {
    error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
    result: {
      status: 'committed',
      runner: 'fixture',
      model: 'fixture-implementer',
      branch,
      base: baseSha,
      commit,
      tree_sha: tree,
      files_changed: 1,
      insertions: 1,
      deletions: 0,
      worktree,
      worktree_reused: reused,
      agent_log: '/tmp/impl-log',
      error: null,
      contained: true,
      containment: 'plain',
      dispatcher_called: true,
      model_calls: 1,
    },
  };
}

function runLoop({
  ticket, branch, campaignPath, sealPath, worktree, candidate, tree,
  strictEnv = null, park = false, resume = false, authority = null,
  authorizeRepair = true, expectRound1Only = false,
}) {
  const calls = [];
  let implCalls = 0;
  const findingId = `${ticket}-1`;
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-26T00:00:04.000Z',
    campaignIntake(input) {
      const control = runCampaignIntake(input, {
        readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
        contextGate: () => ({ owner: 'context_window', status: 'ready' }),
        occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      });
      if (control && control.status === 'admitted' && control.contract
          && control.contract.mission_runtime) {
        const { mission_runtime: _missionRuntime, ...contract } = control.contract;
        return { ...control, contract };
      }
      return control;
    },
    campaignScopeChecker() {
      return {
        passed: true,
        verdict: 'PASS',
        changed_files: ['src/out.txt'],
        total_churn: 1,
        receipt_digest: 'd'.repeat(64),
      };
    },
    campaignAdjudicator() {
      if (park && !resume) {
        return {
          registry_complete: false,
          reason: 'missing disposition authority',
          must_fix_now: [],
          follow_up: [],
          rejected: [],
        };
      }
      if (expectRound1Only || implCalls >= 2 || !authorizeRepair) {
        return {
          registry_complete: true,
          repair_gate_passed: true,
          registry_digest: '1'.repeat(64),
          must_fix_now: [],
          follow_up: [],
          rejected: [],
        };
      }
      return {
        registry_complete: true,
        repair_gate_passed: true,
        registry_digest: '1'.repeat(64),
        must_fix_now: [findingFor(findingId)],
        follow_up: [],
        rejected: [],
      };
    },
    repairPromptWriter(input) {
      const dest = `${input.promptFile}.repair-${input.round}`;
      fs.writeFileSync(dest, `repair round ${input.round}\n`);
      return dest;
    },
    implementationDispatcher(args) {
      implCalls += 1;
      const dispatchedBranch = branchFromArgs(args);
      let unit = null;
      let unitDigest = null;
      let campaignDigest = null;
      const cIdx = args.indexOf('--contract-file');
      if (cIdx >= 0) {
        const contractPath = args[cIdx + 1];
        const unitBytes = fs.readFileSync(contractPath);
        unit = JSON.parse(unitBytes);
        unitDigest = crypto.createHash('sha256').update(unitBytes).digest('hex');
        campaignDigest = unit.campaign_projection
          && unit.campaign_projection.campaign_contract_sha256;
      }
      calls.push({ branch: dispatchedBranch, args: [...args], unit, roundHint: implCalls });
      const payload = transport({
        branch: dispatchedBranch,
        baseSha: implCalls === 1 ? base : candidate,
        commit: candidate,
        tree,
        worktree,
        reused: implCalls > 1,
      });
      payload.result.campaign_contract_sha256 = campaignDigest;
      payload.result.contract_sha256 = unitDigest;
      payload.result.unit_contract_sha256 = unitDigest;
      payload.result.unit_id = unit && unit.unit_id;
      payload.result.run_id = unit && unit.campaign_projection && unit.campaign_projection.campaign_id;
      payload.result.go = 'GO';
      payload.result.boundary = 'ok';
      payload.result.acceptance = 'ok';
      return payload;
    },
    reviewDispatcher() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          runner: 'cc-shim',
          model: 'claude-opus-4-6',
          status: 'reviewed',
          verdict: expectRound1Only ? 'SHIP-AS-IS' : 'FIX-THEN-SHIP',
          findings: expectRound1Only ? '' : `🟠 [${findingId}] src/out.txt needs a repair`,
          raw_log: '/tmp/review-log',
          error: null,
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
    gitWorktreeRemove() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    repairLineageCleanupTransaction() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner({ verifyCmd }) {
      return {
        error: null, status: 0, signal: null, stdout: 'GREEN\n', stderr: '',
        executed_argv: ['/bin/sh', '-c', verifyCmd],
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
    promptFile,
    branch,
    base,
    roster,
    campaignContract: campaignPath,
    campaignSeal: sealPath,
    resume,
    campaignDispositionAuthority: authority,
    implementationOptions: strictEnv ? { env: strictEnv } : undefined,
    verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
    verificationEnvAllowlist: ['CI'],
  });
  return { result, calls };
}

const expectedRepair = (campaignBranch, commit) => (
  `${campaignBranch}-repair-r2-${commit.slice(0, 7)}`
);

if (process.env.REPAIR_BRANCH_PARK_B) {
  const side = JSON.parse(fs.readFileSync(process.env.REPAIR_BRANCH_PARK_B, 'utf8'));
  sealSessionMarker({
    root: side.root,
    dir: path.join(side.repo, '.autopilot', 'session-mode'),
    repoRoot: side.repo,
    contract: side.campaignPath,
    level: 'l6',
  });
  const parked = runLoop({
    ticket: side.ticket,
    branch: side.branch,
    campaignPath: side.campaignPath,
    sealPath: side.sealPath,
    worktree: side.worktree,
    candidate: side.candidate,
    tree: side.tree,
    strictEnv: {
      PATH: process.env.PATH || '',
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: 'mission-root-repair-b',
      AUTOPILOT_DISPATCH_DEPTH: '1',
    },
    park: true,
    authorizeRepair: false,
  });
  console.log(`b_park_status=${parked.result.status}`);
  console.log(`b_park_phase=${parked.result.phase}`);
  assert.ok(
    String(parked.result.status).toLowerCase().includes('disposition')
      || String(parked.result.phase).toLowerCase().includes('disposition'),
    `case b park: ${JSON.stringify({
      status: parked.result.status, phase: parked.result.phase, reason: parked.result.reason,
    }).slice(0, 1200)}`,
  );
  fs.writeFileSync(side.sidecarPath, `${JSON.stringify({
    ...side,
    campaignId: parked.result.campaign_control && parked.result.campaign_control.campaign_id,
    contractDigest: parked.result.campaign_control && parked.result.campaign_control.contract_digest,
    repairBranch: expectedRepair(side.branch, side.candidate),
  })}\n`);
  process.exit(0);
}

if (process.env.REPAIR_BRANCH_RESUME_B) {
  const side = JSON.parse(fs.readFileSync(process.env.REPAIR_BRANCH_RESUME_B, 'utf8'));
  sealSessionMarker({
    root: side.root,
    dir: path.join(side.repo, '.autopilot', 'session-mode'),
    repoRoot: side.repo,
    contract: side.campaignPath,
    level: 'l6',
  });
  const authority = {
    schema_version: 1,
    artifact_type: 'campaign_disposition_authority',
    authority: 'depth-0',
    actor_id: 'operator',
    campaign_id: side.campaignId,
    contract_digest: side.contractDigest,
    reviews: [{
      review_digest: 'd'.repeat(64),
      decisions: [{
        finding_id: 'strict-repair-b-1',
        evidence: {
          kind: 'trace',
          trace_chain: ['contract.vertical_acceptance[0]'],
          confirmed_by: 'operator',
        },
        disposition: {
          disposition: 'must-fix-now',
          acceptance_id: 'vertical_acceptance[0]',
          deferral_harm: 'unfixed acceptance remains',
        },
      }],
    }],
  };
  const caseB = runLoop({
    ticket: side.ticket,
    branch: side.branch,
    campaignPath: side.campaignPath,
    sealPath: side.sealPath,
    worktree: side.worktree,
    candidate: side.candidate,
    tree: side.tree,
    strictEnv: {
      PATH: process.env.PATH || '',
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: 'mission-root-repair-b',
      AUTOPILOT_DISPATCH_DEPTH: '1',
    },
    resume: true,
    authority,
    authorizeRepair: true,
  });
  const caseBReason = String(caseB.result.reason || '');
  console.log(`b_status=${caseB.result.status}`);
  console.log(`b_phase=${caseB.result.phase}`);
  console.log(`b_reason=${caseBReason}`);
  console.log(`b_calls=${caseB.calls.map((c) => c.branch).join(',')}`);
  console.log(`b_literal=${caseBReason.includes('caller branch disagrees with campaign stage')}`);
  console.log(`b_rejection=${caseB.result.campaign_control && caseB.result.campaign_control.rejection && caseB.result.campaign_control.rejection.code}`);
  // RED at ff6037bf: resume+disposition repair blocked with
  // "caller branch disagrees with campaign stage (expected feat/strict-repair-b-repair-r2-<sha7>)"
  // and dispatched no implementer (b_calls empty).
  assert.ok(caseB.calls.length >= 1, `case b dispatch count ${caseB.calls.length} ${caseBReason}`);
  assert.strictEqual(caseB.calls[0].branch, side.repairBranch);
  assert.ok(!caseBReason.includes('caller branch disagrees with campaign stage'), caseBReason);
  process.exit(0);
}

// --- strict in-run repair (a) ---
const strictA = writeStrictCampaign({
  ticket: 'strict-repair-a',
  branch: 'feat/strict-repair-a',
  rootRunId: 'mission-root-repair-a',
});
resetCampaignResidue();
sealSessionMarker({
  root,
  dir: path.join(repo, '.autopilot', 'session-mode'),
  repoRoot: repo,
  contract: strictA.campaignPath,
  level: 'l6',
});
const wtA = makeWorktree('strict-repair-a', 'feat/strict-repair-a');
const caseA = runLoop({
  ticket: 'strict-repair-a',
  branch: 'feat/strict-repair-a',
  campaignPath: strictA.campaignPath,
  sealPath: strictA.sealPath,
  ...wtA,
  strictEnv: {
    PATH: process.env.PATH || '',
    AUTOPILOT_PARENT_RUN_ID: 'foreman',
    AUTOPILOT_ROOT_RUN_ID: 'mission-root-repair-a',
    AUTOPILOT_DISPATCH_DEPTH: '1',
  },
  authorizeRepair: true,
});
const caseAReason = String(caseA.result.reason || '');
const caseARepairBranch = expectedRepair('feat/strict-repair-a', wtA.candidate);
console.log(`a_status=${caseA.result.status}`);
console.log(`a_phase=${caseA.result.phase}`);
console.log(`a_reason=${caseAReason}`);
console.log(`a_calls=${caseA.calls.map((c) => c.branch).join(',')}`);
console.log(`a_literal=${caseAReason.includes('caller branch disagrees with campaign stage')}`);
// RED at ff6037bf: in-run repair blocked with
// "caller branch disagrees with campaign stage (expected feat/strict-repair-a-repair-r2-<sha7>)"
// and only dispatched feat/strict-repair-a.
assert.ok(caseA.calls.length >= 2, `case a dispatch count ${caseA.calls.length} ${caseAReason}`);
assert.strictEqual(caseA.calls[0].branch, 'feat/strict-repair-a');
assert.strictEqual(caseA.calls[1].branch, caseARepairBranch);
assert.ok(!caseAReason.includes('caller branch disagrees with campaign stage'), caseAReason);

// --- strict park + disposition resume (b) ---
const strictB = writeStrictCampaign({
  ticket: 'strict-repair-b',
  branch: 'feat/strict-repair-b',
  rootRunId: 'mission-root-repair-b',
});
resetCampaignResidue();
sealSessionMarker({
  root,
  dir: path.join(repo, '.autopilot', 'session-mode'),
  repoRoot: repo,
  contract: strictB.campaignPath,
  level: 'l6',
});
const wtB = makeWorktree('strict-repair-b', 'feat/strict-repair-b');
const parkSidecar = path.join(tmp, 'repair-b-park.json');
const sidecarPath = path.join(tmp, 'repair-b-sidecar.json');
fs.writeFileSync(parkSidecar, `${JSON.stringify({
  repo, promptFile, base, tmp, root,
  campaignPath: strictB.campaignPath,
  sealPath: strictB.sealPath,
  branch: 'feat/strict-repair-b',
  ticket: 'strict-repair-b',
  worktree: wtB.worktree,
  candidate: wtB.candidate,
  tree: wtB.tree,
  sidecarPath,
})}\n`);
const parkOut = execFileSync(process.execPath, process.argv.slice(1), {
  encoding: 'utf8',
  env: { ...process.env, REPAIR_BRANCH_PARK_B: parkSidecar },
});
process.stdout.write(parkOut);
console.log('b_sidecar=true');
const resumeB = execFileSync(process.execPath, process.argv.slice(1), {
  encoding: 'utf8',
  env: {
    ...process.env,
    REPAIR_BRANCH_RESUME_B: sidecarPath,
  },
});
process.stdout.write(resumeB);

// --- non-strict control ---
resetCampaignResidue();
const loose = writeLooseCampaign({
  ticket: 'loose-repair',
  branch: 'feat/loose-repair',
});
const wtL = makeWorktree('loose-repair', 'feat/loose-repair');
const caseN = runLoop({
  ticket: 'loose-repair',
  branch: 'feat/loose-repair',
  campaignPath: loose.campaignPath,
  sealPath: loose.sealPath,
  ...wtL,
  authorizeRepair: true,
});
console.log(`n_status=${caseN.result.status}`);
console.log(`n_calls=${caseN.calls.map((c) => c.branch).join(',')}`);
console.log(`n_reason=${caseN.result.reason || ''}`);
// RED at ff6037bf: non-strict managed repair dispatches the campaign identity
// branch on both rounds (feat/loose-repair,feat/loose-repair) — no -repair-r2-.
assert.ok(caseN.calls.length >= 2, `non-strict dispatch count ${caseN.calls.length} reason=${caseN.result.reason}`);
assert.strictEqual(caseN.calls[0].branch, 'feat/loose-repair');
assert.strictEqual(caseN.calls[1].branch, 'feat/loose-repair');

// --- strict round-1 control ---
const strict1 = writeStrictCampaign({
  ticket: 'strict-round1',
  branch: 'feat/strict-round1',
  rootRunId: 'mission-root-round1',
});
resetCampaignResidue();
sealSessionMarker({
  root,
  dir: path.join(repo, '.autopilot', 'session-mode'),
  repoRoot: repo,
  contract: strict1.campaignPath,
  level: 'l6',
});
const wt1 = makeWorktree('strict-round1', 'feat/strict-round1');
const case1 = runLoop({
  ticket: 'strict-round1',
  branch: 'feat/strict-round1',
  campaignPath: strict1.campaignPath,
  sealPath: strict1.sealPath,
  ...wt1,
  strictEnv: {
    PATH: process.env.PATH || '',
    AUTOPILOT_PARENT_RUN_ID: 'foreman',
    AUTOPILOT_ROOT_RUN_ID: 'mission-root-round1',
    AUTOPILOT_DISPATCH_DEPTH: '1',
  },
  expectRound1Only: true,
  authorizeRepair: false,
});
console.log(`r1_status=${case1.result.status}`);
console.log(`r1_calls=${case1.calls.map((c) => c.branch).join(',')}`);
console.log(`r1_reason=${case1.result.reason || ''}`);
assert.ok(case1.calls.length >= 1, `round1 dispatch ${case1.calls.length} ${case1.result.reason}`);
assert.strictEqual(case1.calls[0].branch, 'feat/strict-round1');
assert.ok(!String(case1.calls[0].branch).includes('-repair-r'), case1.calls[0].branch);

// --- parity pin generations 1..3 ---
const real = 'abcdef1234567890'.repeat(3).slice(0, 40);
for (const generation of [1, 2, 3]) {
  for (const previous of [real, null]) {
    const round = generation + 1;
    const fromHelper = buildRepairBranchName({
      branch: 'feat/parity',
      round,
      previousCommit: previous,
    });
    const fromExpected = projection.expectedBranch({
      campaignBranch: 'feat/parity',
      base: previous,
      generation,
    });
    console.log(`parity_g${generation}_${previous ? 'real' : 'null'}=${fromHelper}`);
    assert.strictEqual(fromHelper, fromExpected);
  }
}

console.log('repair_branch_suite=true');
NODE
OUT="$(node "$SUITE" "$REPO_ROOT" "$REPO" "$BASE" "$PROMPT" "$TEST_TMP" < /dev/null)"
EXIT=$?
echo "$OUT"
assert_exit_code "$EXIT" "0" "repair-branch suite process exits 0: $OUT"
assert_contains "$OUT" "repair_branch_suite=true" "repair-branch suite completed"
