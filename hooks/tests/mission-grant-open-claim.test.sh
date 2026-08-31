#!/usr/bin/env bash
# mission-grant-open-claim.test.sh — `mission grant --repo --prepared --node`
# (the runtime.js `grantMissionCampaign` CLI surface) must refuse, not
# silently replay, when the target graph node holds an open
# `active_claim_id` whose world has moved since it was granted.
#
# BACKLOG "`mission grant` silently replays a stale claim when the node
# holds an open `active_claim_id`" — fired live 2026-08-30 (lineage
# 420ac261, node `qualification-verdict-stability`): with attempt 1's claim
# still open, `mission grant` returned `status:"replay"` with attempt 1's
# contract — a `base_sha` two merges behind develop and an already-consumed
# branch — instead of refusing.
#
# Root cause (found while diagnosing, not in the reducer): `runtime.js`'s
# `grantMissionCampaign` short-circuits BEFORE calling
# `mission.reduceMissionState` whenever `activeClaimForNode` finds any
# open claim, unconditionally replaying its frozen contract — the pure
# reducer's own `graphGrantContext` refusal (`grant_already_claimed`, see
# `hooks/tests/mission-convergence.test.sh`'s
# `graph-budget-one-different-idempotency-rejects`) is never reached from
# this CLI path. The reducer's rejection path also terminalizes the WHOLE
# Mission (`rejection()` sets `state: 'BLOCKED'`), so the fix must NOT route
# through the reducer for this case — a routine "attempt blocked, please
# withdraw" refusal must not kill the entire mission lineage. The fix
# belongs in `grantMissionCampaign` itself, distinguishing:
#   - an exact, back-to-back re-request while the repo HEAD has not moved
#     since the claim's base was validated -> still a genuine replay
#     (preserves `cli-grant-exact-replay`, mission-runtime-v2.test.sh:539).
#   - the repo HEAD has moved since the open claim's base was validated ->
#     the claim's contract is stale; refuse with a structured
#     `attempt_blocked_by_open_claim` payload (claim_id + campaign_id),
#     never `status:"replay"`.
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
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'mission-grant-open-claim@example.invalid']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Mission Grant Open Claim Oracle']);
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
      // Attempt 1 (opened, blocked while HEAD moved) + attempt 2 headroom.
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
    repo_identity: null, // filled below once repo_identity is known
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
    const code = runMissionCli(args, {
      cwd: repo,
      testOnlyDependencies: dependencies,
      stdout: { write: (v) => { stdout += v; } },
      stderr: { write: (v) => { stderr += v; } },
    });
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

  // --- Invariant: exact-key replay with UNCHANGED HEAD still replays -----
  // (must not regress cli-grant-exact-replay, mission-runtime-v2.test.sh:539)
  const grant1 = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:00:01.000Z']);
  check('attempt1-claimed', grant1.code === 0 && grant1.payload && grant1.payload.status === 'claimed');

  const replaySameHead = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:00:02.000Z']);
  check('exact-replay-preserved-when-head-unchanged',
    replaySameHead.code === 0
    && replaySameHead.payload && replaySameHead.payload.status === 'replay'
    && grant1.payload && replaySameHead.payload.claim_id === grant1.payload.claim_id);

  // --- The exact 2026-08-30 production shape: HEAD moves (a sibling merge,
  // or time passing) while the claim stays open because the campaign died
  // without a terminal receipt -> refuse, never replay.
  fs.appendFileSync(path.join(repo, 'src', 'value.txt'), 'moved-on\n');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'unrelated work landed while the claim stayed open']);

  const blocked = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:05:00.000Z']);
  check('open-claim-blocks-not-replays', blocked.code !== 0
    && blocked.payload && blocked.payload.status === 'rejected');
  check('open-claim-refusal-code', blocked.payload && blocked.payload.code === 'attempt_blocked_by_open_claim');
  check('open-claim-refusal-carries-claim-id',
    blocked.payload && grant1.payload && blocked.payload.claim_id === grant1.payload.claim_id);
  check('open-claim-refusal-carries-campaign-id',
    blocked.payload && grant1.payload && blocked.payload.campaign_id === grant1.payload.mission_campaign_id);
  check('open-claim-refusal-never-replay-status',
    !blocked.payload || blocked.payload.status !== 'replay');

  // A second call with the world still moved must refuse identically
  // (fail-closed retry, not a flaky/one-shot refusal).
  const blockedAgain = runCli(['grant', '--repo', repo, '--prepared', preparedPath, '--node', 'solo-node', '--now', '2026-08-31T00:06:00.000Z']);
  check('open-claim-refusal-repeats',
    blockedAgain.code !== 0
    && blockedAgain.payload && blockedAgain.payload.code === 'attempt_blocked_by_open_claim');
}

lines.push('oracle-ran-to-completion\tPASS');
flushOracle();
if (lines.some((line) => line.endsWith('\tFAIL'))) process.exitCode = 1;
NODE
)"
assert_exit_code "$?" "0" "Mission grant open-claim oracle executes"

for id in \
  runtime-module-present \
  attempt1-claimed \
  exact-replay-preserved-when-head-unchanged \
  open-claim-blocks-not-replays \
  open-claim-refusal-code \
  open-claim-refusal-carries-claim-id \
  open-claim-refusal-carries-campaign-id \
  open-claim-refusal-never-replay-status \
  open-claim-refusal-repeats \
  oracle-ran-to-completion
do
  assert_contains "$OUT" "$id	PASS" "RED: $id"
done

finalize_test
