#!/usr/bin/env bash
# campaign-intake-rejection-release.test.sh — a rejected intake that leaves a
# live unused claim must emit stranded_claim + exact recovery; never
# no_effect_release; next grant stays blocked with the same recovery until
# an explicit withdraw --never-started.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [root, temp] = process.argv.slice(2);
process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';
let runtime = null;
try {
  runtime = require(path.join(root, 'src', 'mission', 'runtime'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { runCampaignIntake, buildStrandedClaim } = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const { runMissionCli } = require(path.join(root, 'src', 'mission', 'cli'));

const lines = [];
const check = (id, value) => lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
let oracleFlushed = false;
function flushOracle() {
  if (oracleFlushed) return;
  oracleFlushed = true;
  for (const line of lines) console.log(line);
}
process.on('uncaughtException', (error) => {
  lines.push('oracle-ran-to-completion\tFAIL');
  flushOracle();
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

const sha = (value) => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : mission.canonicalJson(value),
).digest('hex');

check('runtime-module-present', runtime !== null);

if (runtime) {
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'campaign-intake-rejection-release@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Campaign Intake Rejection Release Oracle']);
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), ['## Solo node', 'base', ''].join('\n'));

  const policy = {
    schema_version: 1,
    enforcement_mode: 'enforce',
    max_campaigns: 4,
    max_wall_seconds: 1000,
    max_tool_calls: 20,
    max_engine_attempts: 8,
    max_external_wait_seconds: 100,
    max_canonical_changed_files: 10,
    max_output_bytes: 4096,
    max_stagnant_campaigns: 4,
    max_deliverables: 1,
    max_parallel: 1,
    max_batches: 1,
    max_graph_depth: 1,
    max_gate_attempts: 4,
    closure_ratio: 0.75,
  };
  const projectGovernance = JSON.parse(fs.readFileSync(
    path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8',
  ));
  projectGovernance.mission_convergence = policy;
  fs.writeFileSync(
    path.join(repo, '.claude', 'owner-kernel-governance.json'),
    `${JSON.stringify(projectGovernance)}\n`,
  );
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
  const policyDigest = sha(policy);

  const graph = {
    schema_version: 1,
    artifact_type: 'mission_execution_graph',
    nodes: [{
      id: 'solo-node',
      source_plan_ids: ['MISSION'],
      source_rubric_ids: ['MISSIONR1'],
      dependencies: [],
      acceptance_ids: ['solo-ready'],
      verification_commands: ['node fixture.js'],
      gate_attempt_budget: 2,
      reservation: {
        campaigns: 1, wall_seconds: 100, tool_calls: 3, engine_attempts: 2,
        external_wait_seconds: 0, canonical_changed_files: 2, output_bytes: 1024,
      },
      campaign: {
        profile: 'poc',
        allowed_path_prefixes: ['src/'],
        spec: { path: 'src/value.txt', section: 'Solo node' },
        required_paths: ['src/value.txt'],
        output_paths: ['src/value.txt'],
        max_changed_files: 2,
        baseline_churn: 10,
        max_growth_ratio: 1.5,
        max_extra_churn: 5,
        max_repair_generations: 1,
        max_wall_seconds: 100,
      },
    }],
  };
  const graphDigest = sha(graph);
  const intent = {
    objective: 'ship the frozen open-claim fixture',
    requirements_hash: sha('requirements'),
    scope: {
      task_classes: ['implementation'],
      domains: ['autopilot'],
      languages: ['javascript'],
      allowed_tools: ['git'],
      artifact_roots: ['src'],
    },
  };
  const acceptance = {
    contract_hash: sha('acceptance-contract'),
    criteria_hash: sha('acceptance-criteria'),
    required_evidence: ['tests'],
  };
  const adoptionBinding = {
    repo_identity: null,
    intent,
    initial_required_acceptance_hashes: [acceptance.contract_hash, acceptance.criteria_hash].sort(),
  };
  const commonRaw = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const common = fs.realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw));
  const repoIdentity = `git-common-dir:${common}`;
  adoptionBinding.repo_identity = repoIdentity;
  const adoptionKey = sha(adoptionBinding);
  const lineage = `lineage-v1-${adoptionKey}`;
  const authority = {
    schema_version: 1,
    task_id: 'solo-task',
    task_authority_id: sha('task-authority'),
    policy_hash: sha('owner-policy'),
    authority_status: 'shadow',
    intent,
    acceptance,
    mission_lineage_id: lineage,
    mission_policy_digest: policyDigest,
    mission_graph_digest: graphDigest,
  };
  const dependencies = {
    resolveMissionPolicy: () => ({ policy, policy_digest: policyDigest }),
    freezeMissionExecutionGraph: () => ({
      graph, graph_digest: graphDigest, calculated_depth: 1, calculated_batches: 1,
    }),
    deriveMissionAdoptionKey: (binding) => sha(binding),
    deriveMissionLineageId: (binding) => `lineage-v1-${sha(binding)}`,
  };

  function runCli(args) {
    let stdout = ''; let stderr = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (v, enc, cb) => {
      stdout += typeof v === 'string' ? v : v.toString();
      if (typeof enc === 'function') return origWrite(v, enc);
      return origWrite(v, enc, cb);
    };
    let code;
    try {
      code = runMissionCli(args, {
        cwd: repo,
        testOnlyDependencies: dependencies,
        stdout: { write: (v) => { stdout += v; } },
        stderr: { write: (v) => { stderr += v; } },
      });
    } finally {
      process.stdout.write = origWrite;
    }
    let payload = null;
    try { payload = JSON.parse(stdout); } catch (_error) { payload = null; }
    return { code, stdout, stderr, payload };
  }

  const preparedPath = path.join(temp, 'prepared.json');
  const prepared = runtime.prepareMissionRuntimeForTest({
    repo, taskAuthority: authority, executionGraph: graph,
    authoritativeGovernance: projectGovernance, preparedAt: '2026-08-31T00:00:00.000Z',
  }, dependencies);
  fs.writeFileSync(preparedPath, `${JSON.stringify(prepared.receipt, null, 2)}\n`);

  const grant1 = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:00:01.000Z']);
  check('attempt1-claimed', grant1.code === 0 && grant1.payload && grant1.payload.status === 'claimed');

  const statePath = path.join(common, 'autopilot', 'mission', 'states', `${adoptionKey}.json`);
  const ledgerPath = path.join(common, 'autopilot', 'implementation-campaign.jsonl');
  const claimId = grant1.payload && grant1.payload.claim_id;
  const liveBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).claims[claimId];

  // HEAD moves while claim A stays open.
  fs.appendFileSync(path.join(repo, 'src', 'value.txt'), 'moved-on\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'unrelated work landed while the claim stayed open']);
  const newHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

  const adapters = {
    ...mission.createMissionCampaignAdapters({
      store: mission.createFileBackedMissionStateStore(statePath),
      grant_ref: grant1.payload.mission_grant_ref,
      mission_subject_digest: grant1.payload.mission_subject_digest,
      campaign_id: grant1.payload.mission_campaign_id,
    }),
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    claimGeneration: () => ({
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: 'rejection-release-oracle',
      ledger: ledgerPath,
      stage_identity: 'campaign-implementation',
    }),
  };
  const intake = runCampaignIntake({
    repo,
    contractPath: grant1.payload.contract_path,
    sealPath: grant1.payload.seal_path,
    promptFile: path.join(temp, 'prompt.txt'),
    branch: grant1.payload.branch,
    base: newHead,
    observedAt: '2026-08-31T00:05:00.000Z',
  }, adapters);

  const dump = JSON.stringify(intake);
  // RED at <base sha>: intake result/steps named neither claim A nor recovery.
  check('mismatch-rejects', intake.status === 'blocked'
    && intake.rejection && intake.rejection.code === 'mission_grant_ref_mismatch');
  // RED at base: result/journal carried no stranded_claim / no recovery naming claim A.
  check('stranded-claim-emitted',
    intake.stranded_claim
    && intake.stranded_claim.claim_id === claimId
    && intake.stranded_claim.resolution === 'absent'
    && typeof intake.stranded_claim.recovery === 'string'
    && intake.stranded_claim.recovery.includes('mission withdraw')
    && intake.stranded_claim.recovery.includes('--never-started true')
    && intake.stranded_claim.recovery.includes(claimId));
  check('stranded-claim-journaled',
    Array.isArray(intake.steps)
    && intake.steps.some((step) => step && step.status === 'stranded_claim'
      && step.stranded_claim && step.stranded_claim.claim_id === claimId));
  check('no-no-effect-release',
    !/no_effect_release/.test(dump)
    && intake.pre_spend_no_effect_receipt === null);
  const liveAfterIntake = JSON.parse(fs.readFileSync(statePath, 'utf8')).claims[claimId];
  check('claim-a-still-live',
    liveAfterIntake && liveAfterIntake.released !== true && liveAfterIntake.terminal !== true
    && liveAfterIntake.graph_node_id === 'solo-node'
    && liveAfterIntake.reservation);
  check('helper-shape-matches', (() => {
    const expected = buildStrandedClaim({
      claim: liveBefore, repo, statePath, campaignLedgerPath: ledgerPath,
    });
    return expected
      && intake.stranded_claim.recovery === expected.recovery
      && intake.stranded_claim.resolution === expected.resolution;
  })());

  const blocked = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:06:00.000Z']);
  check('open-claim-blocks-not-replays', blocked.code !== 0
    && blocked.payload && blocked.payload.status === 'rejected'
    && blocked.payload.code === 'attempt_blocked_by_open_claim'
    && blocked.payload.claim_id === claimId
    && blocked.payload.recovery === intake.stranded_claim.recovery);
  // RED at base: attempt_blocked_by_open_claim named claim A with no recovery field.

  // ticket_present variant: plant an ICC intake root for the claim ticket.
  const ticket = liveBefore.campaign_contract_draft && liveBefore.campaign_contract_draft.ticket;
  const v1Id = `campaign-v1-${sha('ticket-root')}`;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.writeFileSync(ledgerPath, `${JSON.stringify({
    kind: 'journal',
    op: 'campaign_intake',
    run_id: v1Id,
    payload: {
      schema_version: 1,
      artifact_type: 'implementation_campaign_intake',
      campaign_id: v1Id,
      contract_digest: sha('d'),
      initial_state: { campaign_id: v1Id, ticket, phase: 'running' },
      initial_state_digest: sha('e'),
    },
  })}\n`);
  const ticketStranded = buildStrandedClaim({
    claim: liveBefore, repo, statePath, campaignLedgerPath: ledgerPath,
  });
  check('ticket-present-recovery',
    ticketStranded
    && ticketStranded.resolution === 'ticket_present'
    && ticketStranded.recovery.includes('campaign terminalize')
    && ticketStranded.recovery.includes(v1Id));

  fs.unlinkSync(ledgerPath);
  execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), 'init', '--ledger', ledgerPath]);
  const withdrawn = runCli([
    'withdraw',
    '--state', statePath,
    '--out', statePath,
    '--claim-id', claimId,
    '--campaign-ledger', ledgerPath,
    '--never-started', 'true',
  ]);
  check('withdraw-never-started-frees',
    withdrawn.code === 0
    && withdrawn.payload && withdrawn.payload.status === 'withdrawn'
    && JSON.parse(fs.readFileSync(statePath, 'utf8')).claims[claimId].released === true);

  const grant2 = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:07:00.000Z']);
  check('grant-after-withdraw-claims',
    grant2.code === 0 && grant2.payload && grant2.payload.status === 'claimed'
    && grant2.payload.claim_id !== claimId);
}

lines.push('oracle-ran-to-completion\tPASS');
flushOracle();
if (lines.some((line) => line.endsWith('\tFAIL'))) process.exitCode = 1;
NODE
)"
assert_exit_code "$?" "0" "Campaign intake rejection-release oracle executes"

for id in \
  runtime-module-present \
  attempt1-claimed \
  mismatch-rejects \
  stranded-claim-emitted \
  stranded-claim-journaled \
  no-no-effect-release \
  claim-a-still-live \
  helper-shape-matches \
  open-claim-blocks-not-replays \
  ticket-present-recovery \
  withdraw-never-started-frees \
  grant-after-withdraw-claims \
  oracle-ran-to-completion
do
  assert_contains "$OUT" "$id	PASS" "RED: $id"
done

finalize_test
