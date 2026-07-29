#!/usr/bin/env bash
# Durable Mission prepare/grant v2 + terminal reconciliation oracle.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [root, temp] = process.argv.slice(2);
let runtime = null;
try {
  runtime = require(path.join(root, 'src', 'mission', 'runtime'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { runMissionCli } = require(path.join(root, 'src', 'mission', 'cli'));
const { runCampaignIntake } = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const { AutopilotEngine } = require(path.join(root, 'src', 'engine', 'autopilot-engine'));

const lines = [];
const check = (id, value) => lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
const sha = (value) => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : mission.canonicalJson(value),
).digest('hex');
const repo = path.join(temp, 'repo');
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'mission-runtime@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Mission Runtime Oracle']);
fs.writeFileSync(path.join(repo, 'src', 'value.txt'), [
  '## Runtime control',
  'base',
  '## Release closeout',
  '',
].join('\n'));

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
  max_stagnant_campaigns: 2,
  max_deliverables: 2,
  max_parallel: 1,
  max_batches: 2,
  max_graph_depth: 2,
  // runtime-control (4) + release-closeout (2); TOCTOU re-grants need the headroom.
  max_gate_attempts: 8,
  closure_ratio: 0.75,
};
const projectGovernance = JSON.parse(fs.readFileSync(
  path.join(root, '.claude', 'owner-kernel-governance.json'),
  'utf8',
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
  nodes: [
    {
      id: 'runtime-control',
      source_plan_ids: ['MISSION'],
      source_rubric_ids: ['MISSIONR1'],
      dependencies: [],
      acceptance_ids: ['runtime-ready'],
      verification_commands: ['node fixture.js', 'node second-fixture.js'],
      // Extra budget: original grant + TOCTOU re-grant + post-zero-effect re-grant.
      gate_attempt_budget: 1,
      reservation: {
        campaigns: 1, wall_seconds: 100, tool_calls: 3, engine_attempts: 2,
        external_wait_seconds: 0, canonical_changed_files: 2, output_bytes: 1024,
      },
      campaign: {
        profile: 'poc',
        allowed_path_prefixes: ['src/'],
        spec: { path: 'src/value.txt', section: 'Runtime control' },
        required_paths: ['src/value.txt'],
        output_paths: ['src/value.txt'],
        max_changed_files: 2,
        baseline_churn: 10,
        max_growth_ratio: 1.5,
        max_extra_churn: 5,
        max_repair_generations: 1,
        max_wall_seconds: 100,
      },
    },
    {
      id: 'release-closeout',
      source_plan_ids: ['MISSION'],
      source_rubric_ids: ['MISSIONR2'],
      dependencies: ['runtime-control'],
      acceptance_ids: ['release-ready'],
      verification_commands: ['node fixture.js'],
      gate_attempt_budget: 2,
      reservation: {
        campaigns: 1, wall_seconds: 100, tool_calls: 3, engine_attempts: 2,
        external_wait_seconds: 0, canonical_changed_files: 2, output_bytes: 1024,
      },
      campaign: {
        profile: 'poc',
        allowed_path_prefixes: ['src/'],
        spec: { path: 'src/value.txt', section: 'Release closeout' },
        required_paths: ['src/value.txt'],
        output_paths: ['src/value.txt'],
        max_changed_files: 2,
        baseline_churn: 10,
        max_growth_ratio: 1.5,
        max_extra_churn: 5,
        max_repair_generations: 1,
        max_wall_seconds: 100,
      },
    },
  ],
};
const graphDigest = sha(graph);
const intent = {
  objective: 'ship the frozen Mission runtime',
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
const commonRaw = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], {
  encoding: 'utf8',
}).trim();
const common = fs.realpathSync(path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw));
const repoIdentity = `git-common-dir:${common}`;
const runtimeRoot = path.join(common, 'autopilot', 'mission');
const registryPath = path.join(runtimeRoot, 'registry.json');
const registryLock = path.join(runtimeRoot, 'registry.lock');
const adoptionBinding = {
  repo_identity: repoIdentity,
  intent,
  initial_required_acceptance_hashes: [
    acceptance.contract_hash,
    acceptance.criteria_hash,
  ].sort(),
};
const adoptionKey = sha(adoptionBinding);
const lineage = `lineage-v1-${adoptionKey}`;
const authority = {
  schema_version: 1,
  task_id: 'runtime-task',
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
    graph,
    graph_digest: graphDigest,
    calculated_depth: 2,
    calculated_batches: 2,
  }),
  deriveMissionAdoptionKey: (binding) => sha(binding),
  deriveMissionLineageId: (binding) => `lineage-v1-${sha(binding)}`,
};

function runCli(args) {
  let stdout = '';
  let stderr = '';
  const code = runMissionCli(args, {
    cwd: repo,
    testOnlyDependencies: dependencies,
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  });
  let payload = null;
  try { payload = JSON.parse(stdout); } catch (_error) { payload = null; }
  return { code, stdout, stderr, payload };
}

check('runtime-module-present', runtime !== null);
check('prepare-api-present', runtime && typeof runtime.prepareMissionRuntime === 'function');
check('prepare-test-seam-explicit',
  runtime && typeof runtime.prepareMissionRuntimeForTest === 'function');
check('grant-api-present', runtime && typeof runtime.grantMissionCampaign === 'function');
check('prepared-store-api-present',
  runtime && typeof runtime.openPreparedMissionStateStore === 'function');
check('terminal-api-present',
  runtime && typeof runtime.reconcileMissionCampaignTerminal === 'function');
const rootHelp = spawnSync(process.execPath, [path.join(root, 'bin', 'autopilot.js'), '--help'], {
  encoding: 'utf8',
});
check('engine-cli-advertises-prepared-receipt', rootHelp.status === 0
  && rootHelp.stdout.includes('--mission-prepared <receipt>')
  && !rootHelp.stdout.includes('--mission-state <file>'));
const arbitraryCliState = spawnSync(process.execPath, [
  path.join(root, 'bin', 'autopilot.js'),
  'engine', 'implement-review', '--mission-state', path.join(temp, 'attacker-state.json'),
], { encoding: 'utf8' });
check('engine-cli-rejects-arbitrary-state-path', arbitraryCliState.status === 2
  && arbitraryCliState.stderr.includes('--mission-state is not accepted'));

if (runtime) {
  const authorityPath = path.join(temp, 'authority.json');
  const graphPath = path.join(temp, 'graph.json');
  const preparedPath = path.join(temp, 'prepared.json');
  fs.writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

  let disabledTestSeamRejected = false;
  try {
    runtime.prepareMissionRuntimeForTest({
      repo,
      taskAuthority: authority,
      executionGraph: graph,
      authoritativeGovernance: {},
    }, dependencies);
  } catch (error) {
    disabledTestSeamRejected = error.code === 'MISSION_RUNTIME_TEST_SEAM_DISABLED';
  }
  check('test-seam-requires-explicit-process-opt-in', disabledTestSeamRejected);
  process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';

  // Invalid frozen heading must fail before Mission state/grant exists.
  const badHeadingGraph = JSON.parse(JSON.stringify(graph));
  badHeadingGraph.nodes[0].campaign.spec.section = 'Missing Heading That Does Not Exist';
  const badHeadingDigest = sha(badHeadingGraph);
  const badHeadingAuthority = {
    ...authority,
    mission_graph_digest: badHeadingDigest,
  };
  const badHeadingDeps = {
    ...dependencies,
    freezeMissionExecutionGraph: () => ({
      graph: badHeadingGraph,
      graph_digest: badHeadingDigest,
      calculated_depth: 2,
      calculated_batches: 2,
    }),
  };
  let badHeadingError = null;
  try {
    runtime.prepareMissionRuntimeForTest({
      repo,
      taskAuthority: badHeadingAuthority,
      authoritativeGovernance: projectGovernance,
      executionGraph: badHeadingGraph,
      preparedAt: '2026-07-28T00:00:00.000Z',
    }, badHeadingDeps);
  } catch (error) {
    badHeadingError = error;
  }
  check('prepare-rejects-missing-spec-heading',
    badHeadingError
    && badHeadingError.code === 'MISSION_GRAPH_SPEC_INVALID'
    && /missing heading/.test(badHeadingError.message)
    && !fs.existsSync(registryPath));

  // Four-space indented ATX is code, not a heading — pre-spend must reject.
  const indentedHeadingGraph = JSON.parse(JSON.stringify(graph));
  // Keep section name that exists only under 4-space indent in the fixture file.
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), [
    '    ## Runtime control',
    'base',
    '    ## Release closeout',
    '',
  ].join('\n'));
  execFileSync('git', ['-C', repo, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'indent headings as code']);
  let indentedHeadingError = null;
  try {
    runtime.prepareMissionRuntimeForTest({
      repo,
      taskAuthority: authority,
      authoritativeGovernance: projectGovernance,
      executionGraph: graph,
      preparedAt: '2026-07-28T00:00:00.500Z',
    }, dependencies);
  } catch (error) {
    indentedHeadingError = error;
  }
  check('prepare-rejects-four-space-indented-heading',
    indentedHeadingError
    && indentedHeadingError.code === 'MISSION_GRAPH_SPEC_INVALID'
    && /missing heading/.test(indentedHeadingError.message));
  // Restore real ATX headings for the rest of the oracle.
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), [
    '## Runtime control',
    'base',
    '## Release closeout',
    '',
  ].join('\n'));
  execFileSync('git', ['-C', repo, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'restore atx headings']);

  let productionInjectionRejected = false;
  try {
    runtime.prepareMissionRuntime({
      repo,
      taskAuthority: authority,
      executionGraph: graph,
      authoritativeGovernance: {},
      dependencies,
    });
  } catch (error) {
    productionInjectionRejected = error.code === 'MISSION_RUNTIME_DEPENDENCY_INJECTION_REJECTED';
  }
  check('production-prepare-rejects-dependency-injection', productionInjectionRejected);

  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(registryLock, `${JSON.stringify({
    schema_version: 1,
    pid: 2147483646,
    process_start: '1',
    created_at: '2026-07-27T00:00:00.000Z',
    nonce: 'a'.repeat(32),
  })}\n`);
  const prepared = runCli([
    'prepare', '--repo', repo, '--authority', authorityPath,
    '--graph', graphPath, '--out', preparedPath,
  ]);
  check('cli-prepare-created', prepared.code === 0
    && prepared.payload && prepared.payload.status === 'prepared');
  check('stale-dead-process-lock-recovered',
    prepared.code === 0 && !fs.existsSync(registryLock));

  const selfStat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const processStart = selfStat.slice(selfStat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  fs.writeFileSync(registryLock, `${JSON.stringify({
    schema_version: 1,
    pid: process.pid,
    process_start: processStart,
    created_at: new Date().toISOString(),
    nonce: 'b'.repeat(32),
  })}\n`);
  const previousLockTimeout = process.env.AUTOPILOT_MISSION_LOCK_TIMEOUT_MS;
  process.env.AUTOPILOT_MISSION_LOCK_TIMEOUT_MS = '25';
  const liveLock = runCli([
    'prepare', '--repo', repo, '--authority', authorityPath,
    '--graph', graphPath, '--out', `${preparedPath}.locked`,
  ]);
  if (previousLockTimeout === undefined) {
    delete process.env.AUTOPILOT_MISSION_LOCK_TIMEOUT_MS;
  } else {
    process.env.AUTOPILOT_MISSION_LOCK_TIMEOUT_MS = previousLockTimeout;
  }
  check('live-lock-not-reaped', liveLock.code !== 0
    && /MISSION_RUNTIME_LOCKED|timed out acquiring/.test(liveLock.stderr + liveLock.stdout)
    && fs.existsSync(registryLock));
  fs.unlinkSync(registryLock);

  const adopted = runCli([
    'prepare', '--repo', repo, '--authority', authorityPath,
    '--graph', graphPath, '--out', `${preparedPath}.second`,
  ]);
  check('cli-prepare-adopts-same-lineage', adopted.code === 0
    && adopted.payload && adopted.payload.adopted === true
    && adopted.payload.mission_lineage_id === lineage);

  const originalRegistry = fs.readFileSync(registryPath, 'utf8');
  const registryWithExtra = JSON.parse(originalRegistry);
  registryWithExtra.unexpected = true;
  fs.writeFileSync(registryPath, `${JSON.stringify(registryWithExtra, null, 2)}\n`);
  let extraRegistryRejected = false;
  try {
    runtime.openPreparedMissionStateStore({
      repo,
      preparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
    });
  } catch (error) {
    extraRegistryRejected = error.code === 'MISSION_REGISTRY_INVALID';
  }
  check('registry-rejects-extra-fields', extraRegistryRejected);
  fs.writeFileSync(registryPath, originalRegistry);

  const otherAuthority = {
    ...authority,
    task_authority_id: sha('other-authority'),
    intent: { ...intent, objective: 'different unresolved mission' },
  };
  const otherBinding = {
    ...adoptionBinding,
    intent: otherAuthority.intent,
  };
  otherAuthority.mission_lineage_id = `lineage-v1-${sha(otherBinding)}`;
  const otherPath = path.join(temp, 'other-authority.json');
  fs.writeFileSync(otherPath, `${JSON.stringify(otherAuthority, null, 2)}\n`);
  const reset = runCli([
    'prepare', '--repo', repo, '--authority', otherPath,
    '--graph', graphPath, '--out', `${preparedPath}.reset`,
  ]);
  check('cli-prepare-blocks-unresolved-reset', reset.code !== 0
    && /UNRESOLVED_MISSION_EXISTS|MISSION_LINEAGE_RESET/.test(reset.stderr + reset.stdout));

  const granted = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check('cli-grant-claimed', granted.code === 0
    && granted.payload && granted.payload.status === 'claimed');
  check('cli-grant-writes-sealed-contract', granted.payload
    && fs.existsSync(granted.payload.contract_path)
    && fs.existsSync(granted.payload.seal_path));
  const grantedContract = JSON.parse(fs.readFileSync(granted.payload.contract_path, 'utf8'));
  check('grant-projects-frozen-runtime-contract',
    grantedContract.mission_runtime
    && grantedContract.mission_runtime.root_run_id === `mission-${adoptionKey.slice(0, 24)}`
    && grantedContract.mission_runtime.mission_lineage_id === lineage
    && grantedContract.mission_runtime.mission_policy_digest === policyDigest
    && grantedContract.mission_runtime.mission_graph_digest === graphDigest
    && grantedContract.mission_runtime.graph_node_id === 'runtime-control'
    && grantedContract.mission_runtime.graph_node_digest === sha(graph.nodes[0]));
  check('grant-projects-strict-dispatch-from-graph',
    grantedContract.strict_dispatch
    && grantedContract.strict_dispatch.spec.path === 'src/value.txt'
    && grantedContract.strict_dispatch.output_paths.join(',') === 'src/value.txt'
    && grantedContract.strict_dispatch.budget.max_tool_calls === 3
    && grantedContract.strict_dispatch.budget.max_engine_attempts === 2
    && grantedContract.strict_dispatch.verification_commands.join(',')
      === graph.nodes[0].verification_commands.join(','));
  const canonicalCampaignCheck = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'check',
    '--contract', granted.payload.contract_path,
    '--repo', repo,
    '--mission-mode', 'enforce',
    '--seal', granted.payload.seal_path,
  ], { encoding: 'utf8' });
  check('grant-artifacts-pass-canonical-icc-checker',
    canonicalCampaignCheck.status === 0);
  const replay = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check('cli-grant-exact-replay', replay.code === 0
    && replay.payload && replay.payload.status === 'replay'
    && replay.payload.claim_id === granted.payload.claim_id);
  const originalSeal = fs.readFileSync(granted.payload.seal_path, 'utf8');
  const alteredSeal = JSON.parse(originalSeal);
  alteredSeal.graph_node_id = 'forged-node';
  fs.writeFileSync(granted.payload.seal_path, `${JSON.stringify(alteredSeal, null, 2)}\n`);
  const sealTamper = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:00.000Z',
  ]);
  check('grant-replay-rejects-tampered-seal', sealTamper.code !== 0
    && /ARTIFACT_CONFLICT|seal conflicts/.test(sealTamper.stderr + sealTamper.stdout));
  fs.writeFileSync(granted.payload.seal_path, originalSeal);
  const store = runtime.openPreparedMissionStateStore({
    repo,
    preparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
  });
  // TOCTOU: one authoritative base per grant attempt — draft cannot re-read HEAD,
  // and heading must exist at that exact SHA (not merely on some later commit).
  check('campaign-draft-api-present', typeof runtime.campaignDraftFor === 'function');
  check('validate-graph-specs-api-present',
    typeof runtime.validateGraphSpecsAtBase === 'function');
  const boundBaseSha = granted.payload.base_sha;
  check('grant-seals-validated-base-sha',
    typeof boundBaseSha === 'string'
    && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(boundBaseSha)
    && boundBaseSha === grantedContract.base_sha);
  runtime.validateGraphSpecsAtBase(repo, { nodes: [graph.nodes[0]] }, boundBaseSha);
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), 'no-atx-headings-at-this-head\n');
  execFileSync('git', ['-C', repo, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'move HEAD without ATX headings']);
  const movedHeadSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  check('toctou-head-moved-from-bound-base',
    movedHeadSha !== boundBaseSha);
  const draftPinned = runtime.campaignDraftFor({
    state: store.load(),
    node: graph.nodes[0],
    adoptionKey,
    attempt: 99,
    repoInfo: runtime.canonicalRepository(repo),
    baseSha: boundBaseSha,
  });
  check('draft-pins-bound-base-not-current-head',
    draftPinned.base_sha === boundBaseSha
    && draftPinned.base_sha !== movedHeadSha);
  // Current HEAD lacks headings, but the bound base still has them.
  let boundBaseStillValid = true;
  try {
    runtime.validateGraphSpecsAtBase(repo, { nodes: [graph.nodes[0]] }, boundBaseSha);
  } catch (_error) {
    boundBaseStillValid = false;
  }
  check('bound-base-still-has-heading-after-head-move', boundBaseStillValid);
  let movedHeadRejected = false;
  try {
    runtime.validateGraphSpecsAtBase(repo, { nodes: [graph.nodes[0]] }, movedHeadSha);
  } catch (error) {
    movedHeadRejected = error.code === 'MISSION_GRAPH_SPEC_INVALID'
      && /missing heading/.test(error.message || '');
  }
  check('moved-head-missing-heading-rejected', movedHeadRejected);
  // Free the live pre-spawn claim so grant can attempt a new claim and hit
  // the heading gate at the moved HEAD (not dependency/replay short-circuits).
  const releaseAdapters = mission.createMissionCampaignAdapters({
    store,
    grant_ref: granted.payload.mission_grant_ref,
  });
  const preSpawnRelease = releaseAdapters.releaseMission({
    missionClaim: { claim_id: granted.payload.claim_id },
  });
  check('toctou-pre-spawn-release-for-regrant',
    preSpawnRelease && preSpawnRelease.status === 'released');
  const claimsBeforeBadGrant = Object.keys(store.load().claims).length;
  const controlSequenceBeforeBadGrant = store.load().control_sequence;
  const grantAtMovedHead = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:05.000Z',
  ]);
  check('grant-rejects-heading-absent-at-exact-base',
    grantAtMovedHead.code !== 0
    && /MISSION_GRAPH_SPEC_INVALID|missing heading/.test(
      grantAtMovedHead.stderr + grantAtMovedHead.stdout,
    ));
  const afterBadGrant = store.load();
  check('grant-heading-miss-no-claim-mutation',
    Object.keys(afterBadGrant.claims).length === claimsBeforeBadGrant
    && afterBadGrant.control_sequence === controlSequenceBeforeBadGrant
    && !Object.values(afterBadGrant.claims).some(
      (claim) => claim.graph_node_id === 'runtime-control' && !claim.released,
    ));
  // Restore headings at a new HEAD so later grants still use then-current HEAD.
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), [
    '## Runtime control',
    'base',
    '## Release closeout',
    '',
  ].join('\n'));
  execFileSync('git', ['-C', repo, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'restore ATX headings at new HEAD']);
  const restoredHeadSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  check('later-grant-uses-then-current-head-not-prepare-base',
    restoredHeadSha !== boundBaseSha);
  const grantAfterRestore = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:06.000Z',
  ]);
  check('post-restore-grant-binds-then-current-head',
    grantAfterRestore.code === 0
    && grantAfterRestore.payload
    && grantAfterRestore.payload.status === 'claimed'
    && grantAfterRestore.payload.base_sha === restoredHeadSha
    && grantAfterRestore.payload.claim_id !== granted.payload.claim_id);
  // Subsequent intake/zero-effect paths must use the live re-grant binding.
  const originalGrantedClaimId = granted.payload.claim_id;
  Object.assign(granted, grantAfterRestore);

  const once = store.load();
  const liveClaims = Object.values(once.claims).filter((claim) => !claim.released);
  check('same-node-reserved-once', once.axes.tool_calls.reserved_active === 3
    && liveClaims.length === 1
    && liveClaims[0].graph_node_id === 'runtime-control'
    && liveClaims[0].claim_id === granted.payload.claim_id
    && liveClaims[0].claim_id !== originalGrantedClaimId);
  check('state-preserves-distinct-policy-anchors',
    once.policy_hash === authority.policy_hash
    && once.mission_policy_digest === policyDigest
    && once.policy_hash !== once.mission_policy_digest);

  const forgedPrepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  forgedPrepared.mission_lineage_id = `lineage-v1-${sha('forged')}`;
  const forgedPath = path.join(temp, 'prepared-forged.json');
  fs.writeFileSync(forgedPath, `${JSON.stringify(forgedPrepared, null, 2)}\n`);
  const forged = runCli([
    'grant', '--repo', repo, '--prepared', forgedPath, '--node', 'runtime-control',
  ]);
  check('forged-prepared-rejected', forged.code !== 0);
  const reboundPrepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  reboundPrepared.policy_hash = sha('attacker-full-policy');
  reboundPrepared.intent_hash = sha('attacker-intent');
  reboundPrepared.initial_required_acceptance_hashes = [sha('attacker-acceptance')];
  const reboundBody = { ...reboundPrepared };
  delete reboundBody.receipt_digest;
  reboundPrepared.receipt_digest = sha(reboundBody);
  const reboundPath = path.join(temp, 'prepared-rebound.json');
  fs.writeFileSync(reboundPath, `${JSON.stringify(reboundPrepared, null, 2)}\n`);
  const rebound = runCli([
    'grant', '--repo', repo, '--prepared', reboundPath, '--node', 'runtime-control',
  ]);
  check('recomputed-unkeyed-prepared-bindings-rejected', rebound.code !== 0
    && /PREPARE_RECEIPT_INVALID/.test(rebound.stderr + rebound.stdout));
  const extraPrepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  extraPrepared.unexpected = true;
  const extraBody = { ...extraPrepared };
  delete extraBody.receipt_digest;
  extraPrepared.receipt_digest = sha(extraBody);
  const extraPath = path.join(temp, 'prepared-extra.json');
  fs.writeFileSync(extraPath, `${JSON.stringify(extraPrepared, null, 2)}\n`);
  const extraReceipt = runCli([
    'grant', '--repo', repo, '--prepared', extraPath, '--node', 'runtime-control',
  ]);
  check('recomputed-prepared-extra-field-rejected', extraReceipt.code !== 0
    && /PREPARE_RECEIPT_INVALID/.test(extraReceipt.stderr + extraReceipt.stdout));
  const arbitraryState = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath, '--node', 'runtime-control',
    '--state', path.join(temp, 'alternate-state.json'),
  ]);
  check('enforce-arbitrary-state-rejected', arbitraryState.code !== 0);
  const callerIdentity = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath, '--node', 'runtime-control',
    '--idempotency-key', 'attacker-selected-identity',
  ]);
  check('prepared-grant-rejects-caller-identity-flags', callerIdentity.code !== 0
    && /unsupported flags/.test(callerIdentity.stderr + callerIdentity.stdout));

  const adapters = {
    ...mission.createMissionCampaignAdapters({
      store,
      grant_ref: granted.payload.mission_grant_ref,
      mission_subject_digest: granted.payload.mission_subject_digest,
      campaign_id: granted.payload.mission_campaign_id,
    }),
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    claimGeneration: () => ({
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: 'runtime-oracle',
      ledger: path.join(common, 'autopilot', 'oracle.jsonl'),
      stage_identity: 'campaign-implementation',
    }),
  };
  const intake = runCampaignIntake({
    repo,
    contractPath: granted.payload.contract_path,
    sealPath: granted.payload.seal_path,
    promptFile: path.join(temp, 'prompt.txt'),
    branch: granted.payload.branch,
    base: granted.payload.base_sha,
    observedAt: '2026-07-28T00:00:01.000Z',
  }, adapters);
  check('sealed-v2-engine-intake-admitted', intake.status === 'admitted'
    && intake.mission_claim
    && intake.mission_claim.claim_id === granted.payload.claim_id);
  check('intake-keeps-both-campaign-identities', intake.status === 'admitted'
    && /^campaign-v1-/.test(intake.campaign_id)
    && intake.mission_claim.campaign_id === granted.payload.mission_campaign_id);

  // Durable zero-effect leaf after IMPLEMENTATION_STARTED: release Mission
  // admission without terminal receipt, stagnation, or MUTATION_FAILED.
  // Engine supplies trusted adapters to the default releaseCampaignAdmission.
  const stagnationBeforeZeroEffect = store.load().stagnant_campaigns;
  const durableLeafEvents = [];
  let durableTerminalReconcileCalls = 0;
  let durableLeafControl = {
    ...intake,
    generation_claim: {
      ...(intake.generation_claim || {}),
      durable_journal: true,
      resume_candidate: null,
      resume_review_digest: null,
      generation: intake.generation_claim && intake.generation_claim.generation
        ? intake.generation_claim.generation
        : 1,
      nonce: (intake.generation_claim && intake.generation_claim.nonce)
        || 'runtime-zero-effect',
      ledger: (intake.generation_claim && intake.generation_claim.ledger)
        || path.join(common, 'autopilot', 'oracle.jsonl'),
      stage_identity: (intake.generation_claim && intake.generation_claim.stage_identity)
        || 'campaign-implementation',
    },
    steps: Array.isArray(intake.steps)
      ? intake.steps.map((entry) => (
        entry.owner === 'mission'
          ? {
            ...entry,
            status: 'claimed',
            claim_id: granted.payload.claim_id,
          }
          : entry
      ))
      : [{
        owner: 'mission',
        status: 'claimed',
        claim_id: granted.payload.claim_id,
      }],
  };
  fs.mkdirSync(path.dirname(durableLeafControl.generation_claim.ledger), { recursive: true });
  // Ensure a live generation lease so admission release can mark it dead after Mission.
  const ledgerScript = path.join(root, 'scripts', 'run-ledger.sh');
  const runLedgerJson = (args) => {
    const result = spawnSync('bash', [ledgerScript, ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || `run-ledger exited ${result.status}`);
    }
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
  };
  if (!fs.existsSync(durableLeafControl.generation_claim.ledger)) {
    runLedgerJson(['init', '--ledger', durableLeafControl.generation_claim.ledger]);
  }
  const acquireLeaseFor = (control) => {
    const acquiredLease = runLedgerJson([
      'stage-acquire',
      '--ledger', control.generation_claim.ledger,
      '--run-id', control.campaign_id,
      '--stage', 'campaign',
      '--pid', String(process.pid),
      '--resources', `campaign:${control.campaign_id}`,
      '--exclusive-live',
    ]);
    return {
      ...control,
      generation_claim: {
        ...control.generation_claim,
        generation: acquiredLease.generation,
        nonce: acquiredLease.nonce,
        stage_identity: `run-ledger:${acquiredLease.generation}:${acquiredLease.nonce}`,
      },
    };
  };
  durableLeafControl = acquireLeaseFor(durableLeafControl);
  const preparedControlForEngine = () => ({
    ...durableLeafControl,
    initial_state: {
      ...durableLeafControl.initial_state,
      phase: 'PREPARED',
      generation: 0,
      event_count: 0,
      live_lease: null,
    },
  });
  const zeroEffectLeaf = {
    error: null,
    status: 2,
    signal: null,
    stdout: '',
    stderr: '',
    parseError: null,
    result: {
      status: 'precondition_failed',
      runner: 'fixture',
      model: 'fixture-implementer',
      branch: granted.payload.branch,
      base: granted.payload.base_sha,
      commit: null,
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      worktree: null,
      agent_log: null,
      error: 'fixture zero-effect precondition',
    },
  };
  const roster = {
    implementer_engine: 'fixture-implementer',
    implementer_runner: 'codex',
    implementer_effort: 'medium',
    reviewer_engine: 'fixture-reviewer',
    reviewer_runner: 'codex',
    reviewer_effort: 'medium',
    verify_first: false,
    loop_max_rounds: 2,
    loop_convergence_verdict: 'SHIP-AS-IS',
  };
  const missionRootRunId = intake.contract
    && intake.contract.mission_runtime
    && intake.contract.mission_runtime.root_run_id;
  const loopInput = {
    promptFile: path.join(temp, 'prompt.txt'),
    branch: granted.payload.branch,
    base: granted.payload.base_sha,
    roster,
    campaignContract: granted.payload.contract_path,
    implementationOptions: {
      env: {
        ...process.env,
        AUTOPILOT_ROOT_RUN_ID: missionRootRunId,
      },
    },
  };

  const intentOnlyAppender = (input, events) => {
    if (events) events.push(input.eventType);
    const state = input.campaignControl.initial_state;
    if (input.eventType === 'implementation_started') {
      return {
        status: 'appended',
        event: { event_type: input.eventType, timestamp: input.observedAt },
        state: {
          ...state,
          phase: 'IMPLEMENTING',
          generation: 0,
          event_count: 1,
          usage: state.usage || {
            repair_generations: 0,
            changed_files: 0,
            churn: 0,
            elapsed_wall_seconds: 0,
          },
          live_lease: {
            stage_identity: input.stageIdentity,
            generation: 0,
            acquired_at: input.observedAt,
          },
        },
      };
    }
    throw new Error(`unexpected durable leaf event ${input.eventType}`);
  };

  // Grant-ref mismatch: sealed binding used for adapters differs from the
  // admitted control contract. Fail closed without releasing Mission/campaign.
  const sealedGrantRef = granted.payload.mission_grant_ref;
  const mismatchGrantRef = 'f'.repeat(64);
  check('mismatch-fixture-differs-from-seal',
    typeof sealedGrantRef === 'string'
    && sealedGrantRef.length === 64
    && sealedGrantRef !== mismatchGrantRef);
  let mismatchAdapterBuilds = 0;
  const stagnationBeforeMismatch = store.load().stagnant_campaigns;
  const claimReleasedBeforeMismatch = Boolean(
    store.load().claims[granted.payload.claim_id]
    && store.load().claims[granted.payload.claim_id].released,
  );
  const mismatchEngine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-28T00:00:01.250Z',
    missionCampaignStore: store,
    missionAdapterFactory: (options) => {
      mismatchAdapterBuilds += 1;
      return mission.createMissionCampaignAdapters(options);
    },
    campaignIntake() {
      const control = preparedControlForEngine();
      return {
        ...control,
        contract: {
          ...control.contract,
          mission_grant_ref: mismatchGrantRef,
        },
      };
    },
    campaignEventAppender() {
      throw new Error('grant-ref mismatch must not start composition');
    },
    implementationDispatcher() {
      throw new Error('grant-ref mismatch must not dispatch implementation');
    },
  });
  const mismatchResult = mismatchEngine.runImplementationReviewLoop(loopInput);
  const afterMismatch = store.load();
  check('grant-ref-mismatch-blocks-intake',
    mismatchResult.status === 'blocked'
    && mismatchResult.phase === 'campaign_intake'
    && /mission_grant_ref/.test(mismatchResult.reason || '')
    && mismatchResult.campaign_control
    && mismatchResult.campaign_control.rejection
    && mismatchResult.campaign_control.rejection.code === 'mission_grant_ref_mismatch');
  check('grant-ref-mismatch-builds-adapters-once',
    mismatchAdapterBuilds === 1);
  check('grant-ref-mismatch-does-not-release-mission',
    afterMismatch.claims[granted.payload.claim_id]
    && afterMismatch.claims[granted.payload.claim_id].released === claimReleasedBeforeMismatch
    && afterMismatch.claims[granted.payload.claim_id].released !== true);
  check('grant-ref-mismatch-keeps-campaign-lease-live',
    !mismatchResult.campaign_control
    || !mismatchResult.campaign_control.admission_release
    || mismatchResult.campaign_control.admission_release.status !== 'released');
  check('grant-ref-mismatch-stagnation-unchanged',
    afterMismatch.stagnant_campaigns === stagnationBeforeMismatch);
  // Prove the generation lease remains live after mismatch (exclusive-live acquire fails).
  let mismatchLeaseStillLive = false;
  try {
    runLedgerJson([
      'stage-acquire',
      '--ledger', durableLeafControl.generation_claim.ledger,
      '--run-id', durableLeafControl.campaign_id,
      '--stage', 'campaign',
      '--pid', String(process.pid),
      '--resources', `campaign:${durableLeafControl.campaign_id}`,
      '--exclusive-live',
    ]);
  } catch (error) {
    mismatchLeaseStillLive = /already has a live lease/.test(error.message || '');
  }
  check('grant-ref-mismatch-generation-lease-still-live', mismatchLeaseStillLive);

  // Fail-closed: enforce precheck needs a store, but adapter factory
  // omits releaseMission so admission release fails closed.
  let noAdapterBuilds = 0;
  const noAdapterEngine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-28T00:00:01.500Z',
    missionCampaignStore: store,
    missionAdapterFactory: () => {
      noAdapterBuilds += 1;
      return {
        missionClaim: () => ({
          owner: 'mission',
          status: 'claimed',
          claim_id: granted.payload.claim_id,
        }),
        // intentionally no releaseMission
      };
    },
    campaignIntake() {
      return preparedControlForEngine();
    },
    campaignEventAppender: (input) => intentOnlyAppender(input),
    implementationDispatcher() {
      return zeroEffectLeaf;
    },
  });
  const noAdapterResult = noAdapterEngine.runImplementationReviewLoop(loopInput);
  check('zero-effect-adapter-factory-once', noAdapterBuilds === 1);
  const noAdapterRelease = noAdapterResult.campaign_control
    && noAdapterResult.campaign_control.admission_release;
  check('zero-effect-adapter-missing-blocks-release',
    noAdapterResult.status === 'blocked'
    && noAdapterRelease
    && noAdapterRelease.status === 'blocked');
  check('zero-effect-adapter-missing-keeps-lease-live',
    noAdapterRelease
    && noAdapterRelease.campaign_generation_release
    && noAdapterRelease.campaign_generation_release.status === 'rejected'
    && noAdapterRelease.campaign_generation_release.code === 'mission_release_incomplete');
  check('zero-effect-adapter-missing-mission-code',
    noAdapterRelease
    && noAdapterRelease.mission_release
    && (
      noAdapterRelease.mission_release.code === 'mission_release_adapter_missing'
      || noAdapterRelease.mission_release.code === 'mission_state_store_required'
    ));

  // Real managed composition path: constructor-owned Mission store + default
  // releaseCampaignAdmission. Adapters are built exactly once at intake and
  // the same object is threaded into release (never rebuilt).
  let zeroEffectAdapterBuilds = 0;
  let retainedIntakeAdapters = null;
  let retainedReleaseAdapters = null;
  const defaultFactory = mission.createMissionCampaignAdapters;
  const zeroEffectEngine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-28T00:00:02.000Z',
    missionCampaignStore: store,
    missionAdapterFactory: (options) => {
      zeroEffectAdapterBuilds += 1;
      const adapters = defaultFactory(options);
      if (zeroEffectAdapterBuilds === 1) retainedIntakeAdapters = adapters;
      return adapters;
    },
    campaignIntake(input, adapters) {
      retainedIntakeAdapters = adapters || retainedIntakeAdapters;
      return preparedControlForEngine();
    },
    campaignAdmissionReleaser(input, adapters) {
      retainedReleaseAdapters = adapters;
      const { releaseCampaignAdmission } = require(
        path.join(root, 'src', 'engine', 'campaign-intake'),
      );
      return releaseCampaignAdmission(input, adapters || {});
    },
    campaignEventAppender(input) {
      return intentOnlyAppender(input, durableLeafEvents);
    },
    missionTerminalReconciler() {
      durableTerminalReconcileCalls += 1;
      throw new Error('zero-effect leaf must not terminal-reconcile Mission');
    },
    campaignAdmissionCompleter() {
      return { status: 'completed' };
    },
    implementationDispatcher() {
      return zeroEffectLeaf;
    },
  });
  const zeroEffectResult = zeroEffectEngine.runImplementationReviewLoop(loopInput);
  check('zero-effect-adapters-built-once', zeroEffectAdapterBuilds === 1);
  check('zero-effect-release-threads-exact-adapter-object',
    retainedIntakeAdapters !== null
    && retainedReleaseAdapters !== null
    && retainedIntakeAdapters === retainedReleaseAdapters);
  const afterZeroEffect = store.load();
  const zeroEffectEvents = (afterZeroEffect.events || []).map((event) => event.event_type);
  const zeroRelease = zeroEffectResult.campaign_control
    && zeroEffectResult.campaign_control.admission_release;
  check('durable-zero-effect-blocks', zeroEffectResult.status === 'blocked');
  check('durable-zero-effect-records-intent-only',
    durableLeafEvents.join(',') === 'implementation_started');
  check('durable-zero-effect-releases-admission',
    zeroRelease && zeroRelease.status === 'released');
  check('durable-zero-effect-mission-release-via-trusted-adapter',
    zeroRelease
    && zeroRelease.mission_release
    && zeroRelease.mission_release.status === 'released');
  check('durable-zero-effect-lease-marked-dead',
    zeroRelease
    && zeroRelease.campaign_generation_release
    && zeroRelease.campaign_generation_release.status === 'released');
  check('durable-zero-effect-emits-mission-no-effect-release',
    zeroEffectEvents.includes('no_effect_release')
    && afterZeroEffect.claims[granted.payload.claim_id]
    && afterZeroEffect.claims[granted.payload.claim_id].released === true);
  check('durable-zero-effect-stagnation-unchanged',
    afterZeroEffect.stagnant_campaigns === stagnationBeforeZeroEffect);
  // Attempt identity remains monotonic across no_effect_release. The durable
  // graph progress records ordinal 2, while the gate budget slot is restored.
  check('durable-zero-effect-graph-restored-pending',
    afterZeroEffect.graph_progress['runtime-control'].status === 'pending'
    && afterZeroEffect.graph_progress['runtime-control'].active_claim_id === null
    && afterZeroEffect.graph_progress['runtime-control'].attempts === 2);
  check('durable-zero-effect-no-terminal-reconcile',
    durableTerminalReconcileCalls === 0
    && !zeroEffectEvents.includes('reconciliation')
    && !(zeroEffectResult.campaign_control
      && zeroEffectResult.campaign_control.terminal_failure));
  check('durable-zero-effect-non-terminal-result',
    zeroEffectResult.status === 'blocked'
    && zeroEffectResult.phase !== 'campaign_terminal_reconciliation'
    && !(zeroEffectResult.campaign_control
      && zeroEffectResult.campaign_control.terminal_failure));

  const regrantAfterRelease = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:00:30.000Z',
  ]);
  check('durable-zero-effect-permits-next-graph-attempt',
    regrantAfterRelease.code === 0
    && regrantAfterRelease.payload
    && regrantAfterRelease.payload.graph_attempt === 3
    && regrantAfterRelease.payload.claim_id
    && regrantAfterRelease.payload.claim_id !== granted.payload.claim_id);
  const regranted = regrantAfterRelease;
  const regrantAdapters = {
    ...mission.createMissionCampaignAdapters({
      store,
      grant_ref: regranted.payload.mission_grant_ref,
      mission_subject_digest: regranted.payload.mission_subject_digest,
      campaign_id: regranted.payload.mission_campaign_id,
    }),
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    claimGeneration: () => ({
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: 'runtime-oracle-regrant',
      ledger: path.join(common, 'autopilot', 'oracle-regrant.jsonl'),
      stage_identity: 'campaign-implementation',
    }),
  };
  const regrantIntake = runCampaignIntake({
    repo,
    contractPath: regranted.payload.contract_path,
    sealPath: regranted.payload.seal_path,
    promptFile: path.join(temp, 'prompt.txt'),
    branch: regranted.payload.branch,
    base: regranted.payload.base_sha,
    observedAt: '2026-07-28T00:00:31.000Z',
  }, regrantAdapters);
  check('regrant-intake-admitted', regrantIntake.status === 'admitted'
    && regrantIntake.mission_claim
    && regrantIntake.mission_claim.claim_id === regranted.payload.claim_id);

  const terminalInput = {
    store,
    grantRef: regranted.payload.mission_grant_ref,
    claimId: regranted.payload.claim_id,
    iccCampaignId: regrantIntake.campaign_id,
    rawCampaignContractDigest: regrantIntake.contract_digest,
    outcome: 'ready',
    possiblyEffectful: true,
    observedAt: '2026-07-28T00:01:00.000Z',
  };
  const unfrozenTerminalTime = runtime.reconcileMissionCampaignTerminal({
    ...terminalInput,
    observedAt: undefined,
  });
  check('terminal-requires-frozen-observed-at',
    unfrozenTerminalTime.status === 'rejected'
    && unfrozenTerminalTime.reason === 'MISSION_TERMINAL_TIMESTAMP_REQUIRED');
  const terminalEngine = new AutopilotEngine({
    cwd: repo,
    missionPreparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
  });
  const terminal = terminalEngine.reconcileManagedMissionTerminal({
    campaignControl: regrantIntake,
    outcome: 'ready',
    observedAt: terminalInput.observedAt,
    cwd: repo,
  });
  check('engine-terminal-ready-applied', terminal.status === 'applied');
  check('engine-terminal-binds-both-campaign-identities', terminal.receipt
    && terminal.receipt.icc_campaign_id === regrantIntake.campaign_id
    && terminal.receipt.mission_campaign_id === regranted.payload.mission_campaign_id
    && terminal.receipt.raw_campaign_contract_digest === regrantIntake.contract_digest);
  const afterTerminal = store.load();
  check('unknown-usage-charges-conservative-reservation',
    afterTerminal.axes.tool_calls.durable_consumed === 3
    && afterTerminal.axes.tool_calls.reserved_active === 0);
  check('terminal-ready-satisfies-acceptance-without-stagnation',
    afterTerminal.stagnant_campaigns === 0
    && afterTerminal.graph_progress['runtime-control'].status === 'ready');
  const conflictingPending = {
    ...terminal.receipt,
    outcome: 'follow_up',
  };
  const conflictingPendingBody = { ...conflictingPending };
  delete conflictingPendingBody.receipt_digest;
  conflictingPending.receipt_digest = sha(conflictingPendingBody);
  const duplicatePendingPath = path.join(
    runtimeRoot,
    'journals',
    adoptionKey,
    `${regranted.payload.claim_id}.pending.json`,
  );
  fs.writeFileSync(duplicatePendingPath, `${JSON.stringify(conflictingPending, null, 2)}\n`);
  const appliedPendingConflict = runtime.reconcileMissionCampaignTerminal(terminalInput);
  check('applied-pending-journal-conflict-rejected',
    appliedPendingConflict.status === 'rejected'
    && appliedPendingConflict.reason === 'terminal_receipt_conflict');
  fs.unlinkSync(duplicatePendingPath);
  const terminalReplay = runtime.reconcileMissionCampaignTerminal(terminalInput);
  check('terminal-exact-replay-noop', terminalReplay.status === 'replay_noop');
  const laterClockReplay = runtime.reconcileMissionCampaignTerminal({
    ...terminalInput,
    now: '2026-07-29T12:00:00.000Z',
  });
  check('terminal-replay-stable-across-later-clock',
    laterClockReplay.status === 'replay_noop'
    && laterClockReplay.receipt.receipt_digest === terminal.receipt.receipt_digest);
  const terminalConflict = runtime.reconcileMissionCampaignTerminal({
    ...terminalInput,
    outcome: 'follow_up',
  });
  check('terminal-conflicting-replay-rejected', terminalConflict.status === 'rejected');
  const readyRedispatch = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'runtime-control', '--now', '2026-07-28T00:01:30.000Z',
  ]);
  check('ready-graph-node-cannot-redispatch', readyRedispatch.code !== 0
    && /GRAPH_NODE_COMPLETE|already ready/.test(readyRedispatch.stderr + readyRedispatch.stdout));

  const grant2 = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'release-closeout', '--now', '2026-07-28T00:02:00.000Z',
  ]);
  const grant2State = store.load();
  const grant2TerminalBase = {
    state: grant2State,
    grantRef: grant2.payload.mission_grant_ref,
    claimId: grant2.payload.claim_id,
    iccCampaignId: `campaign-v1-${sha('second-icc')}`,
    rawCampaignContractDigest: sha('second-raw'),
    possiblyEffectful: true,
    observedAt: '2026-07-28T00:03:00.000Z',
  };
  const readyWithoutAcceptance = runtime.createCampaignTerminalReceipt({
    ...grant2TerminalBase,
    outcome: 'ready',
  });
  readyWithoutAcceptance.satisfied_acceptance_hashes = [];
  const readyWithoutAcceptanceBody = { ...readyWithoutAcceptance };
  delete readyWithoutAcceptanceBody.receipt_digest;
  readyWithoutAcceptance.receipt_digest = sha(readyWithoutAcceptanceBody);
  const followUpWithAcceptance = runtime.createCampaignTerminalReceipt({
    ...grant2TerminalBase,
    outcome: 'follow_up',
  });
  followUpWithAcceptance.satisfied_acceptance_hashes = [
    ...grant2State.claims[grant2.payload.claim_id].acceptance_hashes,
  ];
  const followUpWithAcceptanceBody = { ...followUpWithAcceptance };
  delete followUpWithAcceptanceBody.receipt_digest;
  followUpWithAcceptance.receipt_digest = sha(followUpWithAcceptanceBody);
  check('terminal-acceptance-projection-is-exact',
    mission.applyMissionCampaignReceipt(grant2State, readyWithoutAcceptance).status === 'rejected'
    && mission.applyMissionCampaignReceipt(grant2State, followUpWithAcceptance).status
      === 'rejected');
  let nonUtcTerminalRejected = false;
  try {
    runtime.createCampaignTerminalReceipt({
      ...grant2TerminalBase,
      outcome: 'follow_up',
      observedAt: '2026-07-28T01:03:00.000+01:00',
    });
  } catch (error) {
    nonUtcTerminalRejected = error.code === 'MISSION_TERMINAL_INVALID';
  }
  check('terminal-requires-utc-observed-at', nonUtcTerminalRejected);
  const secondTerminal = runtime.reconcileMissionCampaignTerminal({
    store,
    grantRef: grant2.payload.mission_grant_ref,
    claimId: grant2.payload.claim_id,
    iccCampaignId: `campaign-v1-${sha('second-icc')}`,
    rawCampaignContractDigest: sha('second-raw'),
    outcome: 'follow_up',
    possiblyEffectful: true,
    observedAt: '2026-07-28T00:03:00.000Z',
  });
  check('first-zero-delta-terminal-increments-stagnation',
    secondTerminal.status === 'applied' && store.load().stagnant_campaigns === 1);
  const grant3 = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'release-closeout', '--now', '2026-07-28T00:04:00.000Z',
  ]);
  const thirdTerminalBase = {
    grantRef: grant3.payload.mission_grant_ref,
    claimId: grant3.payload.claim_id,
    iccCampaignId: `campaign-v1-${sha('third-icc')}`,
    rawCampaignContractDigest: sha('third-raw'),
    possiblyEffectful: true,
    observedAt: '2026-07-28T00:05:00.000Z',
  };
  const secondState = store.load();
  const raceReceiptA = runtime.createCampaignTerminalReceipt({
    ...thirdTerminalBase,
    state: secondState,
    outcome: 'follow_up',
  });
  const raceReceiptB = runtime.createCampaignTerminalReceipt({
    ...thirdTerminalBase,
    state: secondState,
    outcome: 'blocked',
  });
  const raceDir = path.join(temp, 'terminal-race');
  fs.mkdirSync(raceDir, { recursive: true });
  const raceWorker = path.join(raceDir, 'worker.js');
  const barrier = path.join(raceDir, 'go');
  const receiptAPath = path.join(raceDir, 'receipt-a.json');
  const receiptBPath = path.join(raceDir, 'receipt-b.json');
  const outputAPath = path.join(raceDir, 'output-a.json');
  const outputBPath = path.join(raceDir, 'output-b.json');
  fs.writeFileSync(receiptAPath, JSON.stringify(raceReceiptA));
  fs.writeFileSync(receiptBPath, JSON.stringify(raceReceiptB));
  fs.writeFileSync(raceWorker, String.raw`'use strict';
const fs = require('fs');
const path = require('path');
const [root, repo, preparedPath, barrier, receiptPath, outputPath] = process.argv.slice(2);
const runtime = require(path.join(root, 'src', 'mission', 'runtime'));
const store = runtime.openPreparedMissionStateStore({
  repo,
  preparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
});
const deadline = Date.now() + 5000;
while (!fs.existsSync(barrier)) {
  if (Date.now() >= deadline) throw new Error('terminal race barrier timeout');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
}
const result = store.journalTerminal(JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
fs.writeFileSync(outputPath, JSON.stringify(result));
`);
  execFileSync('bash', [
    '-c',
    [
      '"$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8" &',
      'left=$!',
      '"$1" "$2" "$3" "$4" "$5" "$6" "$9" "${10}" &',
      'right=$!',
      'sleep 0.05',
      ': > "$6"',
      'wait "$left"',
      'wait "$right"',
    ].join('\n'),
    'terminal-race',
    process.execPath,
    raceWorker,
    root,
    repo,
    preparedPath,
    barrier,
    receiptAPath,
    outputAPath,
    receiptBPath,
    outputBPath,
  ]);
  const raceResults = [
    JSON.parse(fs.readFileSync(outputAPath, 'utf8')).status,
    JSON.parse(fs.readFileSync(outputBPath, 'utf8')).status,
  ].sort();
  check('terminal-race-first-writer-wins',
    raceResults.join(',') === 'conflict,journaled');
  const recoveredRace = runtime.recoverPendingTerminals(store);
  check('terminal-race-recovers-journal-before-cas',
    recoveredRace.status === 'recovered');
  check('second-zero-delta-terminal-blocks-mission',
    store.load().state === 'BLOCKED'
    && store.load().stagnant_campaigns === 2);
  const afterStagnation = runCli([
    'grant', '--repo', repo, '--prepared', preparedPath,
    '--node', 'release-closeout',
  ]);
  check('next-grant-rejects-after-stagnation', afterStagnation.code !== 0
    && /stagnation|terminal/i.test(afterStagnation.stdout + afterStagnation.stderr));
}

const failed = lines.filter((line) => line.endsWith('\tFAIL'));
for (const line of lines) console.log(line);
if (failed.length > 0) {
  process.stderr.write(`mission-runtime-v2 failures:\n${failed.join('\n')}\n`);
  process.exitCode = 1;
}
NODE
)"
assert_exit_code "$?" "0" "Mission runtime v2 oracle executes"

for id in \
  runtime-module-present prepare-api-present prepare-test-seam-explicit \
  production-prepare-rejects-dependency-injection grant-api-present prepared-store-api-present \
  test-seam-requires-explicit-process-opt-in prepare-rejects-missing-spec-heading \
  prepare-rejects-four-space-indented-heading \
  terminal-api-present engine-cli-advertises-prepared-receipt \
  engine-cli-rejects-arbitrary-state-path cli-prepare-created cli-prepare-adopts-same-lineage \
  stale-dead-process-lock-recovered live-lock-not-reaped registry-rejects-extra-fields \
  cli-prepare-blocks-unresolved-reset cli-grant-claimed \
  cli-grant-writes-sealed-contract grant-projects-frozen-runtime-contract \
  grant-projects-strict-dispatch-from-graph grant-artifacts-pass-canonical-icc-checker \
  campaign-draft-api-present validate-graph-specs-api-present \
  grant-seals-validated-base-sha toctou-head-moved-from-bound-base \
  draft-pins-bound-base-not-current-head bound-base-still-has-heading-after-head-move \
  moved-head-missing-heading-rejected grant-rejects-heading-absent-at-exact-base \
  grant-heading-miss-no-claim-mutation later-grant-uses-then-current-head-not-prepare-base \
  toctou-pre-spawn-release-for-regrant post-restore-grant-binds-then-current-head \
  cli-grant-exact-replay \
  grant-replay-rejects-tampered-seal same-node-reserved-once \
  state-preserves-distinct-policy-anchors forged-prepared-rejected \
  recomputed-unkeyed-prepared-bindings-rejected recomputed-prepared-extra-field-rejected \
  enforce-arbitrary-state-rejected prepared-grant-rejects-caller-identity-flags \
  sealed-v2-engine-intake-admitted intake-keeps-both-campaign-identities \
  grant-ref-mismatch-blocks-intake grant-ref-mismatch-builds-adapters-once \
  grant-ref-mismatch-does-not-release-mission grant-ref-mismatch-keeps-campaign-lease-live \
  grant-ref-mismatch-stagnation-unchanged grant-ref-mismatch-generation-lease-still-live \
  zero-effect-adapter-factory-once \
  zero-effect-adapter-missing-blocks-release zero-effect-adapter-missing-keeps-lease-live \
  zero-effect-adapter-missing-mission-code \
  zero-effect-adapters-built-once zero-effect-release-threads-exact-adapter-object \
  durable-zero-effect-blocks durable-zero-effect-records-intent-only \
  durable-zero-effect-releases-admission durable-zero-effect-mission-release-via-trusted-adapter \
  durable-zero-effect-lease-marked-dead durable-zero-effect-emits-mission-no-effect-release \
  durable-zero-effect-stagnation-unchanged durable-zero-effect-graph-restored-pending \
  durable-zero-effect-no-terminal-reconcile durable-zero-effect-non-terminal-result \
  durable-zero-effect-permits-next-graph-attempt \
  engine-terminal-ready-applied engine-terminal-binds-both-campaign-identities \
  unknown-usage-charges-conservative-reservation \
  terminal-requires-frozen-observed-at \
  terminal-ready-satisfies-acceptance-without-stagnation terminal-exact-replay-noop \
  applied-pending-journal-conflict-rejected \
  terminal-replay-stable-across-later-clock \
  terminal-conflicting-replay-rejected ready-graph-node-cannot-redispatch \
  terminal-acceptance-projection-is-exact terminal-requires-utc-observed-at \
  first-zero-delta-terminal-increments-stagnation second-zero-delta-terminal-blocks-mission \
  terminal-race-first-writer-wins terminal-race-recovers-journal-before-cas \
  next-grant-rejects-after-stagnation
do
  assert_contains "$OUT" "$id	PASS" "Mission runtime v2 invariant $id"
done

finalize_test
