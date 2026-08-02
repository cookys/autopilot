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
const { createProviderReadinessReceipt } = require(path.join(root, 'src', 'readiness', 'receipt'));
const {
  createQualificationProvider,
  qualifyExactRoleNow,
} = require(path.join(root, 'src', 'readiness', 'qualification-provider'));

const lines = [];
const check = (id, value) => lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
const sha = (value) => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : mission.canonicalJson(value),
).digest('hex');
const readinessIssuedAt = '2026-07-28T00:00:00.000Z';
const readinessPolicy = {
  receipt_ttl_seconds: 600,
  fallback_family_constraint: 'different',
};
const readinessTuples = [
  { role: 'implementer', runner: 'codex', model: 'gpt-5.3-codex-spark', effort: 'high', endpoint: null },
  { role: 'verification_author', runner: 'agy', model: 'gemini-2.5-pro', effort: 'high', endpoint: null },
  { role: 'qc', runner: 'codex', model: 'gpt-5.5', effort: 'xhigh', endpoint: null },
];
const qualificationProvider = createQualificationProvider({ qualify: (tuple) => (
  readinessTuples.some((candidate) => JSON.stringify(candidate) === JSON.stringify(tuple))
) });
const readinessObservation = (tuple, axis) => ({
  schema_version: 1,
  artifact_type: 'provider_axis_observation',
  tuple,
  axis,
  status: 'ready',
  observed_at: readinessIssuedAt,
  ttl_seconds: 600,
  evidence_class: 'fixture-probe',
  reason: null,
});
const readinessRoster = readinessTuples.map((tuple) => ({
  seat_id: tuple.role,
  required: true,
  family: tuple.runner === 'agy' ? 'google' : 'openai',
  tuple,
  observations: Object.fromEntries(
    ['transport', 'live', 'qualification'].map((axis) => [
      axis,
      axis === 'qualification'
        ? qualifyExactRoleNow(qualificationProvider, tuple, readinessIssuedAt, 600)
        : readinessObservation(tuple, axis),
    ]),
  ),
  fallbacks: [],
}));
const readinessReceipt = createProviderReadinessReceipt({
  roster: readinessRoster,
  policy: readinessPolicy,
  now: readinessIssuedAt,
});
const readinessAdapters = {
  providerReadiness: () => ({
    receipt: readinessReceipt,
    roster: readinessRoster,
    policy: readinessPolicy,
  }),
  qualificationProvider,
};
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
    ...readinessAdapters,
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
      dispatcher_called: false,
      model_calls: 0,
      mutation_attempts: 0,
      gate_attempts: 0,
      resources_created: 0,
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
    min_panel_size: 1,
    required_review_families: 1,
    cross_family_required: false,
    reviewer_qualified: true,
    qc_panel_seats_complete: true,
    qc_panel_seats: [{
      role: 'qc',
      runner: 'codex',
      model: 'fixture-reviewer',
      effort: 'medium',
      endpoint: null,
      family: 'fixture',
    }],
  };
  const missionRootRunId = intake.contract
    && intake.contract.mission_runtime
    && intake.contract.mission_runtime.root_run_id;
  // Exact prompt observation for joint budget: create the real prompt file the
  // Engine/composition path will stat (PROMPT_BYTES_UNOBSERVED if missing).
  const missionPromptPath = path.join(temp, 'prompt.txt');
  fs.writeFileSync(missionPromptPath, 'mission runtime v2 implementer prompt\n', 'utf8');
  const loopInput = {
    promptFile: missionPromptPath,
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
  const controllerRecoveryWt = path.join(temp, 'controller-recovery-worktree');
  const controllerRecoveryBranch = 'controller-recovery-oracle';
  execFileSync('git', [
    '-C', repo,
    'worktree', 'add', '-q',
    '-b', controllerRecoveryBranch,
    controllerRecoveryWt,
    granted.payload.base_sha,
  ]);
  let noAdapterBuilds = 0;
  const noAdapterEngine = new AutopilotEngine({
    cwd: controllerRecoveryWt,
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

  // True canonical producer → Engine → persisted authority → restart attach →
  // PostCompact CLI. This is the positive recovery oracle; no authority body is
  // manually authored by the test.
  let recoveryAttachAdapterBuilds = 0;
  const recoveryAttachEngine = new AutopilotEngine({
    cwd: controllerRecoveryWt,
    clock: () => '2026-07-28T00:00:01.750Z',
    missionCampaignStore: store,
    missionAdapterFactory: () => {
      recoveryAttachAdapterBuilds += 1;
      return {
        missionClaim: () => ({
          owner: 'mission',
          status: 'claimed',
          claim_id: granted.payload.claim_id,
        }),
        // Intentionally no releaseMission: keep the canonical claim active so
        // this restart remains a recoverable nonterminal controller.
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
  const recoveryAttachResult = recoveryAttachEngine.runImplementationReviewLoop(loopInput);
  check('controller-restart-attaches-same-workorder',
    recoveryAttachResult.status === 'blocked'
    && recoveryAttachAdapterBuilds === 1
    && !/controller attach recovery|controller_worktree_mismatch/i.test(
      recoveryAttachResult.reason || '',
    ));
  const workOrder = require(path.join(root, 'src', 'engine', 'work-order'));
  const controllerRootRunId = durableLeafControl.campaign_id;
  const controllerGraphNode = durableLeafControl.contract.mission_runtime.graph_node_id;
  const controllerMissionClaim = store.load().claims[
    durableLeafControl.mission_claim.claim_id
  ];
  const controllerAttempt = controllerMissionClaim
    && controllerMissionClaim.graph_attempt;
  const controllerRecords = workOrder.listWorkOrders(common, controllerRootRunId)
    .filter((entry) => entry.work_order
      && entry.work_order.role === 'controller'
      && entry.work_order.graph_node === controllerGraphNode
      && entry.work_order.attempt === controllerAttempt);
  const exactControllerRecord = controllerRecords.length === 1
    && !controllerRecords[0].error ? controllerRecords[0] : null;
  check('controller-recovery-production-artifacts-bound',
    exactControllerRecord !== null
    && exactControllerRecord.work_order.worktree === controllerRecoveryWt
    && exactControllerRecord.work_order.branch === controllerRecoveryBranch
    && fs.existsSync(exactControllerRecord.work_order.paths.durable)
    && fs.existsSync(exactControllerRecord.work_order.paths.checkpoint)
    && fs.existsSync(exactControllerRecord.work_order.paths.manifest)
    && fs.existsSync(exactControllerRecord.work_order.paths.receipt)
    && fs.existsSync(exactControllerRecord.work_order.paths.mission)
    && fs.realpathSync(exactControllerRecord.work_order.paths.mission)
      === fs.realpathSync(store.state_path)
    && fs.existsSync(`${exactControllerRecord.work_order.paths.ledger}.1`));
  const postcompact = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'compaction-rehydrate.js'),
    'postcompact-adapter',
    '--git-cwd', controllerRecoveryWt,
    '--root-run-id', controllerRootRunId,
    '--graph-node', controllerGraphNode,
    '--attempt', String(controllerAttempt),
  ], { encoding: 'utf8' });
  let postcompactBody = null;
  try {
    postcompactBody = JSON.parse(postcompact.stdout);
  } catch (_error) {
    postcompactBody = null;
  }
  check('controller-postcompact-real-linked-positive',
    postcompact.status === 0
    && postcompactBody
    && postcompactBody.status === 'ready'
    && postcompactBody.production_hook_wired === false
    && postcompactBody.reconcile
    && postcompactBody.reconcile.action === 'attach_active'
    && postcompactBody.reconcile.authority_sources_checked.includes(
      'canonical_mission_state_claim',
    ));

  // Real managed composition path: constructor-owned Mission store + default
  // releaseCampaignAdmission. Adapters are built exactly once at intake and
  // the same object is threaded into release (never rebuilt).
  let zeroEffectAdapterBuilds = 0;
  let retainedIntakeAdapters = null;
  let retainedReleaseAdapters = null;
  const defaultFactory = mission.createMissionCampaignAdapters;
  const zeroEffectEngine = new AutopilotEngine({
    cwd: controllerRecoveryWt,
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
  const disposedControllerRecords = workOrder.listWorkOrders(common, controllerRootRunId)
    .filter((entry) => entry.work_order
      && entry.work_order.role === 'controller'
      && entry.work_order.graph_node === controllerGraphNode
      && entry.work_order.attempt === controllerAttempt);
  const disposedControllerRecord = disposedControllerRecords.length === 1
    && !disposedControllerRecords[0].error ? disposedControllerRecords[0] : null;
  const disposedControllerClassification = disposedControllerRecord
    ? workOrder.classifyWorkOrder(disposedControllerRecord.work_order, {
      gitCwd: controllerRecoveryWt,
      workOrderPath: disposedControllerRecord.path,
      requireBoundEvidence: true,
    })
    : null;
  check('controller-zero-effect-exact-aborted-disposition',
    disposedControllerRecord !== null
    && disposedControllerRecord.work_order.disposition === 'consumed'
    && disposedControllerRecord.work_order.terminal_status === 'aborted'
    && disposedControllerClassification
    && disposedControllerClassification.classification === 'consume_terminal'
    && disposedControllerClassification.terminal_status === 'aborted'
    && disposedControllerClassification.success === false);

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
    ...readinessAdapters,
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
  // Canonical Mission producer → ordinary Engine intake/composition → Mission
  // terminal reconciliation → exact consumed controller Work Order. External
  // adapters perform real Git mutation/checkout observations; no authority
  // state, terminal receipt, or progress receipt is authored by this fixture.
  const successControllerWt = path.join(temp, 'controller-success-worktree');
  const successControllerBranch = 'controller-success-oracle';
  execFileSync('git', [
    '-C', repo,
    'worktree', 'add', '-q',
    '-b', successControllerBranch,
    successControllerWt,
    regranted.payload.base_sha,
  ]);
  const successContract = JSON.parse(
    fs.readFileSync(regranted.payload.contract_path, 'utf8'),
  );
  let successImplementationCalls = 0;
  let successReviewCalls = 0;
  let successVerificationCalls = 0;
  let successClock = '2026-07-28T00:00:40.000Z';
  const dispatchArg = (args, flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : null;
  };
  const materializeRetainedDispatchOwnership = ({
    args,
    dispatchOptions,
    worktree,
  }) => {
    const dispatchBranch = dispatchArg(args, '--branch');
    const dispatchBase = dispatchArg(args, '--base');
    const dispatchRunId = dispatchArg(args, '--run-id');
    const retentionOwner = dispatchArg(args, '--retain-owner');
    const retentionReason = dispatchArg(args, '--retain-reason');
    const retentionExpiresAt = dispatchArg(args, '--retain-until');
    const dispatchEnv = dispatchOptions && dispatchOptions.env;
    const rootRunId = dispatchEnv
      && dispatchEnv.AUTOPILOT_WORKTREE_ROOT_RUN_ID;
    const rawLoopId = (dispatchEnv && (
      dispatchEnv.AUTOPILOT_LOOP_ID
      || dispatchEnv.AUTOPILOT_PARENT_RUN_ID
    )) || dispatchRunId;
    const sanitizeIdentity = (value) => String(value || '')
      .replace(/[^A-Za-z0-9._-]/g, '-');
    if (!args.includes('--keep-worktree')
        || !dispatchBranch
        || !/^[0-9a-f]{40,64}$/.test(dispatchBase || '')
        || !dispatchRunId
        || !rootRunId
        || !retentionOwner
        || !retentionReason
        || !/^[1-9][0-9]*$/.test(retentionExpiresAt || '')) {
      throw new Error('managed dispatcher fixture did not receive exact retention authority');
    }
    const excludePath = path.join(common, 'info', 'exclude');
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const existingExcludes = fs.existsSync(excludePath)
      ? fs.readFileSync(excludePath, 'utf8').split('\n')
      : [];
    const missingExcludes = [
      '.autopilot-worktree',
      '.autopilot-worktree.lock',
    ].filter((entry) => !existingExcludes.includes(entry));
    if (missingExcludes.length > 0) {
      fs.appendFileSync(excludePath, `${missingExcludes.join('\n')}\n`);
    }
    fs.writeFileSync(path.join(worktree, '.autopilot-worktree'), [
      'created_at=1',
      `branch=${dispatchBranch}`,
      `base_sha=${dispatchBase}`,
      `run_id=${sanitizeIdentity(dispatchRunId)}`,
      `root_run_id=${sanitizeIdentity(rootRunId)}`,
      `loop_id=${sanitizeIdentity(rawLoopId)}`,
      'retention=lease',
      `retention_owner=${retentionOwner}`,
      `retention_reason_sha256=${sha(retentionReason)}`,
      `retention_expires_at=${retentionExpiresAt}`,
      'schema=2',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(worktree, '.autopilot-worktree.lock'), '');
  };
  const { verificationArgv } = require(
    path.join(root, 'src', 'engine', 'campaign-verification'),
  );
  const successEngine = new AutopilotEngine({
    cwd: successControllerWt,
    clock: () => successClock,
    missionCampaignStore: store,
    providerReadinessAuthority: readinessAdapters.providerReadiness,
    qualificationProvider,
    missionAdapterFactory: (options) => ({
      ...mission.createMissionCampaignAdapters(options),
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    }),
    implementationDispatcher(args, dispatchOptions) {
      successImplementationCalls += 1;
      if (successImplementationCalls > 2) {
        throw new Error('two-node Mission must dispatch at most one implementation per node');
      }
      const unitIndex = args.indexOf('--contract-file');
      if (unitIndex < 0 || !args[unitIndex + 1]) {
        throw new Error('managed implementation did not receive projected unit contract');
      }
      const unitPath = args[unitIndex + 1];
      const unitBytes = fs.readFileSync(unitPath);
      const unit = JSON.parse(unitBytes.toString('utf8'));
      const successImplementerWt = path.join(
        temp,
        `implementer-success-worktree-${successImplementationCalls}`,
      );
      const successAgentLog = path.join(
        temp,
        `implementer-success-${successImplementationCalls}.log`,
      );
      execFileSync('git', [
        '-C', successControllerWt,
        'worktree', 'add', '-q',
        '-b', unit.campaign_projection.branch,
        successImplementerWt,
        unit.base_sha,
      ]);
      materializeRetainedDispatchOwnership({
        args,
        dispatchOptions,
        worktree: successImplementerWt,
      });
      fs.appendFileSync(
        path.join(successImplementerWt, 'src', 'value.txt'),
        `${unit.campaign_projection.graph_node_id}-engine-success\n`,
      );
      execFileSync('git', ['-C', successImplementerWt, 'add', 'src/value.txt']);
      execFileSync('git', [
        '-C', successImplementerWt,
        'commit', '-qm', `${unit.campaign_projection.graph_node_id} success`,
      ]);
      const commit = execFileSync(
        'git',
        ['-C', successImplementerWt, 'rev-parse', 'HEAD'],
        { encoding: 'utf8' },
      ).trim();
      fs.writeFileSync(successAgentLog, 'successful implementation transcript\n');
      const unitDigest = crypto.createHash('sha256').update(unitBytes).digest('hex');
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: 'committed',
          runner: unit.campaign_projection.runner,
          model: unit.campaign_projection.model,
          branch: unit.campaign_projection.branch,
          base: unit.base_sha,
          commit,
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: successImplementerWt,
          worktree_reused: false,
          agent_log: successAgentLog,
          error: null,
          run_id: unit.campaign_projection.campaign_id,
          dispatch_id: `dispatch-${unit.unit_id}`,
          resource_id: successImplementerWt,
          provider: 'fixture-provider',
          provider_session_id: null,
          prompt_bytes: fs.statSync(missionPromptPath).size,
          usage: { input_tokens: null },
          campaign_contract_sha256:
            unit.campaign_projection.campaign_contract_sha256,
          contract_sha256: unitDigest,
          unit_contract_sha256: unitDigest,
          unit_id: unit.unit_id,
          go: 'GO',
          boundary: 'ok',
          acceptance: 'ok',
        },
      };
    },
    reviewDispatcher() {
      successReviewCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'codex',
          model: 'fixture-reviewer',
          status: 'reviewed',
          verdict: 'SHIP-AS-IS',
          findings: '',
          raw_log: null,
          error: null,
        },
      };
    },
    verifyCommandRunner({ verifyCmd }) {
      successVerificationCalls += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: 'verified\n',
        stderr: '',
        executed_argv: verificationArgv(verifyCmd),
      };
    },
  });
  const successResult = successEngine.runImplementationReviewLoop({
    promptFile: missionPromptPath,
    branch: regranted.payload.branch,
    base: regranted.payload.base_sha,
    roster,
    campaignManaged: true,
    campaignContract: regranted.payload.contract_path,
    campaignSeal: regranted.payload.seal_path,
    implementationOptions: {
      env: {
        ...process.env,
        AUTOPILOT_ROOT_RUN_ID:
          successContract.mission_runtime.root_run_id,
      },
    },
  });
  const terminal = successResult.campaign_control
    && successResult.campaign_control.mission_terminal_reconciliation;
  check('engine-terminal-ready-through-production-composition',
    successResult.status === 'converged'
    && successResult.phase === 'campaign_terminal_ready'
    && successImplementationCalls === 1
    && successReviewCalls === 2
    && successVerificationCalls === 2);
  check('engine-terminal-ready-applied', terminal && terminal.status === 'applied');
  check('engine-terminal-binds-both-campaign-identities', terminal
    && terminal.receipt
    && terminal.receipt.icc_campaign_id === regrantIntake.campaign_id
    && terminal.receipt.mission_campaign_id === regranted.payload.mission_campaign_id
    && terminal.receipt.raw_campaign_contract_digest === regrantIntake.contract_digest);
  const successControllerRecords = workOrder.listWorkOrders(
    common,
    regrantIntake.campaign_id,
  ).filter((entry) => entry.work_order
    && entry.work_order.role === 'controller'
    && entry.work_order.graph_node === 'runtime-control'
    && entry.work_order.attempt === regranted.payload.graph_attempt);
  const successControllerRecord = successControllerRecords.length === 1
    && !successControllerRecords[0].error ? successControllerRecords[0] : null;
  const successControllerClassification = successControllerRecord
    ? workOrder.classifyWorkOrder(successControllerRecord.work_order, {
      gitCwd: successControllerWt,
      workOrderPath: successControllerRecord.path,
      requireBoundEvidence: true,
    })
    : null;
  check('controller-success-consumed-classifies-terminal',
    successControllerRecord !== null
    && successControllerRecord.work_order.disposition === 'consumed'
    && successControllerRecord.work_order.terminal_status === 'success'
    && successControllerClassification
    && successControllerClassification.classification === 'consume_terminal'
    && successControllerClassification.success === true);
  const successTranscript = successControllerRecord
    && successControllerRecord.work_order.controller
    && successControllerRecord.work_order.controller.transcript_audit;
  check('controller-terminal-transcript-exact-production-authority',
    successTranscript
    && successTranscript.explains_all === true
    && successTranscript.blocks_terminal === false
    && successTranscript.problems.length === 0
    && successTranscript.expected_counts.dispatches === 1
    && successTranscript.expected_counts.resources === 1
    && successTranscript.expected_counts.gates === 4
    && successTranscript.expected_counts.effect_results === 4
    && [
      'controller_work_order',
      'dispatch_manifest_index',
      'dispatch_result_index',
      'rotation_aware_controller_ledger',
    ].every((source) => successTranscript.authority_sources_checked.includes(source)));
  const successProgressReceipts = successControllerRecord
    && successControllerRecord.work_order.controller
    && successControllerRecord.work_order.controller.progress_receipts;
  const zeroProgress = successProgressReceipts && successProgressReceipts[0];
  const successProgress = successProgressReceipts && successProgressReceipts.at(-1);
  check('controller-progress-real-multinode-zero-of-two',
    zeroProgress
    && zeroProgress.deliverable_count === 2
    && zeroProgress.completed_deliverables.length === 0
    && zeroProgress.remaining_deliverables.join(',')
      === 'release-closeout,runtime-control');
  check('controller-progress-real-multinode-one-of-two',
    successProgress
    && successProgress.deliverable_count === 2
    && successProgress.completed_deliverables.join(',') === 'runtime-control'
    && successProgress.remaining_deliverables.join(',') === 'release-closeout'
    && successProgress.frozen_denominator_digest
      === successControllerRecord.work_order.controller.frozen_denominator.digest);
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
  const terminalReplayInput = {
    ...terminalInput,
    observedAt: terminal.receipt.observed_at,
  };
  const terminalReplay = runtime.reconcileMissionCampaignTerminal(terminalReplayInput);
  check('terminal-exact-replay-noop', terminalReplay.status === 'replay_noop');
  const laterClockReplay = runtime.reconcileMissionCampaignTerminal({
    ...terminalReplayInput,
    now: '2026-07-29T12:00:00.000Z',
  });
  check('terminal-replay-stable-across-later-clock',
    laterClockReplay.status === 'replay_noop'
    && laterClockReplay.receipt.receipt_digest === terminal.receipt.receipt_digest);
  const terminalConflict = runtime.reconcileMissionCampaignTerminal({
    ...terminalReplayInput,
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
  const closeoutContract = JSON.parse(
    fs.readFileSync(grant3.payload.contract_path, 'utf8'),
  );
  successClock = '2026-07-28T00:04:30.000Z';
  const closeoutResult = successEngine.runImplementationReviewLoop({
    promptFile: missionPromptPath,
    branch: grant3.payload.branch,
    base: grant3.payload.base_sha,
    roster,
    campaignManaged: true,
    campaignContract: grant3.payload.contract_path,
    campaignSeal: grant3.payload.seal_path,
    implementationOptions: {
      env: {
        ...process.env,
        AUTOPILOT_ROOT_RUN_ID:
          closeoutContract.mission_runtime.root_run_id,
      },
    },
  });
  const closeoutTerminal = closeoutResult.campaign_control
    && closeoutResult.campaign_control.mission_terminal_reconciliation;
  check('engine-second-node-production-composition',
    closeoutResult.status === 'converged'
    && closeoutResult.phase === 'campaign_terminal_ready'
    && closeoutTerminal
    && closeoutTerminal.status === 'applied'
    && successImplementationCalls === 2
    && successReviewCalls === 4
    && successVerificationCalls === 4);
  const closeoutRootRunId = closeoutResult.campaign_control
    && closeoutResult.campaign_control.campaign_id;
  const closeoutControllerRecords = closeoutRootRunId
    ? workOrder.listWorkOrders(common, closeoutRootRunId)
      .filter((entry) => entry.work_order
        && entry.work_order.role === 'controller'
        && entry.work_order.graph_node === 'release-closeout'
        && entry.work_order.attempt === grant3.payload.graph_attempt)
    : [];
  const closeoutControllerRecord = closeoutControllerRecords.length === 1
    && !closeoutControllerRecords[0].error ? closeoutControllerRecords[0] : null;
  const closeoutClassification = closeoutControllerRecord
    ? workOrder.classifyWorkOrder(closeoutControllerRecord.work_order, {
      gitCwd: successControllerWt,
      workOrderPath: closeoutControllerRecord.path,
      requireBoundEvidence: true,
    })
    : null;
  const closeoutProgressReceipts = closeoutControllerRecord
    && closeoutControllerRecord.work_order.controller.progress_receipts;
  const closeoutInitialProgress = closeoutProgressReceipts
    && closeoutProgressReceipts[0];
  const closeoutFinalProgress = closeoutProgressReceipts
    && closeoutProgressReceipts.at(-1);
  const completedMissionState = store.load();
  check('controller-progress-real-multinode-two-of-two',
    closeoutControllerRecord
    && closeoutClassification
    && closeoutClassification.classification === 'consume_terminal'
    && closeoutClassification.success === true
    && closeoutInitialProgress
    && closeoutInitialProgress.completed_deliverables.join(',') === 'runtime-control'
    && closeoutInitialProgress.remaining_deliverables.join(',') === 'release-closeout'
    && closeoutFinalProgress
    && closeoutFinalProgress.deliverable_count === 2
    && closeoutFinalProgress.completed_deliverables.join(',')
      === 'release-closeout,runtime-control'
    && closeoutFinalProgress.remaining_deliverables.length === 0);
  check('controller-progress-frozen-denominator-unchanged',
    exactControllerRecord
    && postcompactBody
    && postcompactBody.status === 'ready'
    && zeroProgress
    && successProgress
    && closeoutInitialProgress
    && closeoutFinalProgress
    && exactControllerRecord.work_order.controller.frozen_denominator.digest
      === zeroProgress.frozen_denominator_digest
    && zeroProgress.frozen_denominator_digest
      === successProgress.frozen_denominator_digest
    && zeroProgress.frozen_denominator_digest
      === closeoutInitialProgress.frozen_denominator_digest
    && zeroProgress.frozen_denominator_digest
      === closeoutFinalProgress.frozen_denominator_digest
    && completedMissionState.state === 'COMPLETE'
    && completedMissionState.terminal
    && completedMissionState.terminal.state === 'COMPLETE');

  // Keep the concurrent terminal/stagnation oracle independent from the
  // completed production path above so a deliberately blocking race cannot
  // stand in for (or contaminate) 2/2 progress evidence.
  const stagnationRepo = path.join(temp, 'stagnation-repo');
  fs.mkdirSync(path.join(stagnationRepo, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(stagnationRepo, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q', stagnationRepo]);
  execFileSync('git', [
    '-C', stagnationRepo, 'config', 'user.email', 'stagnation@example.invalid',
  ]);
  execFileSync('git', [
    '-C', stagnationRepo, 'config', 'user.name', 'Stagnation Oracle',
  ]);
  fs.writeFileSync(path.join(stagnationRepo, 'src', 'value.txt'), [
    '## Runtime control',
    'base',
    '## Release closeout',
    '',
  ].join('\n'));
  fs.writeFileSync(
    path.join(stagnationRepo, '.claude', 'owner-kernel-governance.json'),
    `${JSON.stringify(projectGovernance)}\n`,
  );
  execFileSync('git', ['-C', stagnationRepo, 'add', '.']);
  execFileSync('git', ['-C', stagnationRepo, 'commit', '-qm', 'base']);
  const stagnationCommonRaw = execFileSync(
    'git',
    ['-C', stagnationRepo, 'rev-parse', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim();
  const stagnationCommon = fs.realpathSync(
    path.isAbsolute(stagnationCommonRaw)
      ? stagnationCommonRaw : path.join(stagnationRepo, stagnationCommonRaw),
  );
  const stagnationRepoIdentity = `git-common-dir:${stagnationCommon}`;
  const stagnationIntent = {
    ...intent,
    objective: 'exercise independent terminal stagnation recovery',
  };
  const stagnationBinding = {
    repo_identity: stagnationRepoIdentity,
    intent: stagnationIntent,
    initial_required_acceptance_hashes: [
      acceptance.contract_hash,
      acceptance.criteria_hash,
    ].sort(),
  };
  const stagnationAdoptionKey = sha(stagnationBinding);
  const stagnationAuthority = {
    ...authority,
    task_id: 'stagnation-runtime-task',
    task_authority_id: sha('stagnation-task-authority'),
    policy_hash: sha('stagnation-owner-policy'),
    intent: stagnationIntent,
    mission_lineage_id: `lineage-v1-${stagnationAdoptionKey}`,
  };
  const stagnationPrepared = runtime.prepareMissionRuntimeForTest({
    repo: stagnationRepo,
    taskAuthority: stagnationAuthority,
    authoritativeGovernance: projectGovernance,
    executionGraph: graph,
    preparedAt: '2026-07-28T10:00:00.000Z',
  }, dependencies);
  const stagnationPreparedPath = path.join(temp, 'stagnation-prepared.json');
  fs.writeFileSync(
    stagnationPreparedPath,
    `${JSON.stringify(stagnationPrepared.receipt, null, 2)}\n`,
  );
  const stagnationStore = runtime.openPreparedMissionStateStore({
    repo: stagnationRepo,
    preparedReceipt: stagnationPrepared.receipt,
  });
  const stagnationIcc = (grant) => {
    const bytes = fs.readFileSync(grant.contract_path);
    const contract = JSON.parse(bytes.toString('utf8'));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const { campaignIdFor } = require(
      path.join(root, 'src', 'engine', 'implementation-campaign'),
    );
    return {
      campaignId: campaignIdFor(stagnationRepoIdentity, contract.ticket, digest),
      contractDigest: digest,
    };
  };
  const stagnationPrerequisite = runtime.grantMissionCampaign({
    repo: stagnationRepo,
    preparedReceipt: stagnationPrepared.receipt,
    nodeId: 'runtime-control',
    now: '2026-07-28T10:00:01.000Z',
  });
  const prerequisiteIcc = stagnationIcc(stagnationPrerequisite);
  const prerequisiteTerminal = runtime.reconcileMissionCampaignTerminal({
    store: stagnationStore,
    grantRef: stagnationPrerequisite.mission_grant_ref,
    claimId: stagnationPrerequisite.claim_id,
    iccCampaignId: prerequisiteIcc.campaignId,
    rawCampaignContractDigest: prerequisiteIcc.contractDigest,
    outcome: 'ready',
    possiblyEffectful: true,
    observedAt: '2026-07-28T10:00:02.000Z',
  });
  if (prerequisiteTerminal.status !== 'applied') {
    throw new Error(`stagnation prerequisite failed: ${JSON.stringify(prerequisiteTerminal)}`);
  }
  const stagnationGrant1 = runtime.grantMissionCampaign({
    repo: stagnationRepo,
    preparedReceipt: stagnationPrepared.receipt,
    nodeId: 'release-closeout',
    now: '2026-07-28T10:01:00.000Z',
  });
  const stagnationIcc1 = stagnationIcc(stagnationGrant1);
  const stagnationFirst = runtime.reconcileMissionCampaignTerminal({
    store: stagnationStore,
    grantRef: stagnationGrant1.mission_grant_ref,
    claimId: stagnationGrant1.claim_id,
    iccCampaignId: stagnationIcc1.campaignId,
    rawCampaignContractDigest: stagnationIcc1.contractDigest,
    outcome: 'follow_up',
    possiblyEffectful: true,
    observedAt: '2026-07-28T10:02:00.000Z',
  });
  if (stagnationFirst.status !== 'applied'
      || stagnationStore.load().stagnant_campaigns !== 1) {
    throw new Error(`stagnation first terminal failed: ${JSON.stringify(stagnationFirst)}`);
  }
  const stagnationGrant2 = runtime.grantMissionCampaign({
    repo: stagnationRepo,
    preparedReceipt: stagnationPrepared.receipt,
    nodeId: 'release-closeout',
    now: '2026-07-28T10:03:00.000Z',
  });
  const stagnationIcc2 = stagnationIcc(stagnationGrant2);
  const thirdTerminalBase = {
    grantRef: stagnationGrant2.mission_grant_ref,
    claimId: stagnationGrant2.claim_id,
    iccCampaignId: stagnationIcc2.campaignId,
    rawCampaignContractDigest: stagnationIcc2.contractDigest,
    possiblyEffectful: true,
    observedAt: '2026-07-28T10:04:00.000Z',
  };
  const secondState = stagnationStore.load();
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
    stagnationRepo,
    stagnationPreparedPath,
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
  const recoveredRace = runtime.recoverPendingTerminals(stagnationStore);
  check('terminal-race-recovers-journal-before-cas',
    recoveredRace.status === 'recovered');
  check('second-zero-delta-terminal-blocks-mission',
    stagnationStore.load().state === 'BLOCKED'
    && stagnationStore.load().stagnant_campaigns === 2);
  let afterStagnationError = null;
  try {
    runtime.grantMissionCampaign({
      repo: stagnationRepo,
      preparedReceipt: stagnationPrepared.receipt,
      nodeId: 'release-closeout',
    });
  } catch (error) {
    afterStagnationError = error;
  }
  check('next-grant-rejects-after-stagnation',
    afterStagnationError
    && /stagnation|terminal/i.test(
      `${afterStagnationError.code || ''} ${afterStagnationError.message || ''}`,
    ));
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
  zero-effect-adapter-missing-mission-code controller-restart-attaches-same-workorder \
  controller-recovery-production-artifacts-bound controller-postcompact-real-linked-positive \
  zero-effect-adapters-built-once zero-effect-release-threads-exact-adapter-object \
  durable-zero-effect-blocks durable-zero-effect-records-intent-only \
  durable-zero-effect-releases-admission durable-zero-effect-mission-release-via-trusted-adapter \
  durable-zero-effect-lease-marked-dead durable-zero-effect-emits-mission-no-effect-release \
  durable-zero-effect-stagnation-unchanged durable-zero-effect-graph-restored-pending \
  durable-zero-effect-no-terminal-reconcile durable-zero-effect-non-terminal-result \
  controller-zero-effect-exact-aborted-disposition \
  durable-zero-effect-permits-next-graph-attempt \
  engine-terminal-ready-through-production-composition \
  engine-terminal-ready-applied engine-terminal-binds-both-campaign-identities \
  controller-success-consumed-classifies-terminal \
  controller-terminal-transcript-exact-production-authority \
  controller-progress-real-multinode-zero-of-two \
  controller-progress-real-multinode-one-of-two \
  engine-second-node-production-composition \
  controller-progress-real-multinode-two-of-two \
  controller-progress-frozen-denominator-unchanged \
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
