#!/usr/bin/env bash
# Mission dual-identity + L6 marker→campaign admission bridge.
# Proves ICC v1 leaf identity under Mission-v2 seal, marker digest equality,
# zero-runner negatives, off/shadow compatibility, and terminal dual binding.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_SESSION_ID AUTOPILOT_SESSION_MODE_DIR CLAUDE_CODE_SESSION_ID
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const [root, temp] = process.argv.slice(2);
const runtime = require(path.join(root, 'src', 'mission', 'runtime'));
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { runMissionCli } = require(path.join(root, 'src', 'mission', 'cli'));
const { runCampaignIntake } = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const { AutopilotEngine } = require(path.join(root, 'src', 'engine', 'autopilot-engine'));
const { campaignIdFor } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const { createProviderReadinessReceipt } = require(path.join(root, 'src', 'readiness', 'receipt'));
const {
  createQualificationProvider,
  qualifyExactRoleNow,
} = require(path.join(root, 'src', 'readiness', 'qualification-provider'));
const projection = require(path.join(root, 'src', 'engine', 'campaign-dispatch-projection'));
const {
  verifyMissionRoutingProjection,
} = require(path.join(root, 'scripts', 'session-mode'));
const lines = [];
const check = (id, value) => {
  lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
  if (!value) process.exitCode = 1;
};
const sha = (value) => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : mission.canonicalJson(value),
).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
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

// --- Temp repo with enforce Mission governance ---
const repo = path.join(temp, 'repo');
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'bridge@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Mission Bridge Oracle']);
fs.writeFileSync(path.join(repo, 'src', 'value.txt'), [
  '## Runtime control',
  'base',
  '## Release closeout',
  '',
].join('\n'));
fs.writeFileSync(path.join(repo, '.claude', 'review-loop-config.md'), [
  '- implementer_engine: gpt-5.3-codex-spark',
  '- implementer_runner: codex',
  '- reviewer_engine: claude-opus',
  '- reviewer_runner: claude-native',
  '- reviewer_effort: xhigh',
].join('\n') + '\n');

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
  max_gate_attempts: 4,
  closure_ratio: 0.75,
};
const projectGovernance = JSON.parse(fs.readFileSync(
  path.join(root, '.claude', 'owner-kernel-governance.json'),
  'utf8',
));
projectGovernance.mission_convergence = policy;
writeJson(path.join(repo, '.claude', 'owner-kernel-governance.json'), projectGovernance);
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
      verification_commands: ['test -f src/value.txt'],
      gate_attempt_budget: 2,
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
      verification_commands: ['test -f src/value.txt'],
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
  objective: 'ship dual-identity bridge',
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
  task_id: 'bridge-task',
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
  resolveMissionPolicy: () => ({
    policy,
    policy_digest: policyDigest,
  }),
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

process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';

const authorityPath = path.join(temp, 'authority.json');
const graphPath = path.join(temp, 'graph.json');
const preparedPath = path.join(temp, 'prepared.json');
writeJson(authorityPath, authority);
writeJson(graphPath, graph);

const prepared = runCli([
  'prepare', '--repo', repo, '--authority', authorityPath,
  '--graph', graphPath, '--out', preparedPath,
]);
check('prepare_created', prepared.code === 0
  && prepared.payload && prepared.payload.status === 'prepared');

const granted = runCli([
  'grant', '--repo', repo, '--prepared', preparedPath,
  '--node', 'runtime-control', '--now', '2026-07-28T00:00:00.000Z',
]);
check('grant_claimed', granted.code === 0
  && granted.payload && granted.payload.status === 'claimed');
check('grant_writes_contract_and_seal',
  granted.payload
  && fs.existsSync(granted.payload.contract_path)
  && fs.existsSync(granted.payload.seal_path));

const missionCampaignId = granted.payload.mission_campaign_id;
const seal = JSON.parse(fs.readFileSync(granted.payload.seal_path, 'utf8'));
const contractBytes = fs.readFileSync(granted.payload.contract_path);
const contract = JSON.parse(contractBytes.toString('utf8'));
const contractDigest = crypto.createHash('sha256').update(contractBytes).digest('hex');
const iccCampaignId = campaignIdFor(repoIdentity, contract.ticket, contractDigest);

check('mission_seal_is_v2',
  typeof missionCampaignId === 'string'
  && /^campaign-v2-[a-f0-9]{64}$/.test(missionCampaignId)
  && seal.identity_scheme === 'mission-subject-v2'
  && seal.campaign_id === missionCampaignId);
check('icc_id_is_v1_distinct',
  /^campaign-v1-[a-f0-9]{64}$/.test(iccCampaignId)
  && iccCampaignId !== missionCampaignId);

const promptFile = path.join(temp, 'prompt.txt');
fs.writeFileSync(promptFile, 'implement bridge fixture\n');
const adapters = {
  ...mission.createMissionCampaignAdapters({
    store: runtime.openPreparedMissionStateStore({
      repo,
      preparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
    }),
    grant_ref: granted.payload.mission_grant_ref,
    mission_subject_digest: granted.payload.mission_subject_digest,
    campaign_id: missionCampaignId,
  }),
  ...readinessAdapters,
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
  claimGeneration: () => ({
    owner: 'campaign_generation',
    status: 'claimed',
    generation: 1,
    nonce: 'bridge-oracle',
    ledger: path.join(common, 'autopilot', 'oracle.jsonl'),
    stage_identity: 'campaign-implementation',
  }),
};
const intake = runCampaignIntake({
  repo,
  contractPath: granted.payload.contract_path,
  sealPath: granted.payload.seal_path,
  promptFile,
  branch: granted.payload.branch,
  base: granted.payload.base_sha || contract.base_sha,
  observedAt: '2026-07-28T00:00:01.000Z',
}, adapters);
check('intake_admitted_dual_identity',
  intake.status === 'admitted'
  && intake.campaign_id === iccCampaignId
  && intake.mission_claim
  && intake.mission_claim.campaign_id === missionCampaignId);

// Strict unit projection uses ICC v1 campaign id.
const unit = projection.deriveCampaignDispatchUnit({
  campaignContract: contract,
  campaignContractSha256: contractDigest,
  campaignId: iccCampaignId,
  branch: contract.branch,
  base: contract.base_sha,
  runner: 'codex',
  model: 'gpt-5.3-codex-spark',
  stage: 'campaign-implementation',
  rootRunId: contract.mission_runtime.root_run_id,
});
check('strict_projection_uses_icc_v1',
  unit.campaign_projection.campaign_id === iccCampaignId
  && /^campaign-v1-/.test(unit.campaign_projection.campaign_id));
check('strict_projection_preserves_mission_digests',
  unit.campaign_projection.mission_policy_digest
    === contract.mission_runtime.mission_policy_digest
  && unit.campaign_projection.mission_graph_digest
    === contract.mission_runtime.mission_graph_digest);

// Engine lifecycle root rejects Mission-v2 run id and accepts ICC v1.
const engine = new AutopilotEngine({ cwd: repo });
let rejectedV2 = false;
try {
  engine.implementTask({
    promptFile,
    branch: contract.branch,
    base: contract.base_sha,
    roster: {
      reviewer_engine: 'fixture-reviewer',
      reviewer_effort: 'high',
      reviewer_runner: 'fixture',
      reviewer_qualified: true,
      implementer_engine: 'fixture-model',
      implementer_effort: 'high',
      implementer_runner: 'fixture',
      loop_max_rounds: 1,
      loop_convergence_verdict: 'SHIP-AS-IS',
    },
    runId: missionCampaignId,
    ledger: path.join(temp, 'reject-v2.jsonl'),
    implementationRound: 1,
    implementationStage: 'campaign-implementation',
    campaignContractFile: granted.payload.contract_path,
    campaignContractDigest: contractDigest,
    campaignSealFile: granted.payload.seal_path,
    implementationOptions: {
      env: {
        AUTOPILOT_PARENT_RUN_ID: 'foreman',
        AUTOPILOT_ROOT_RUN_ID: contract.mission_runtime.root_run_id,
      },
    },
    implementationDispatcher: () => {
      throw new Error('runner must not spawn on v2 run id');
    },
  });
} catch (error) {
  rejectedV2 = /does not match the sealed contract identity/.test(error.message);
}
// implementTask returns blocked rather than throw for some paths
const v2Result = engine.implementTask({
  promptFile,
  branch: contract.branch,
  base: contract.base_sha,
  roster: {
    reviewer_engine: 'fixture-reviewer',
    reviewer_effort: 'high',
    reviewer_runner: 'fixture',
    reviewer_qualified: true,
    implementer_engine: 'fixture-model',
    implementer_effort: 'high',
    implementer_runner: 'fixture',
    loop_max_rounds: 1,
    loop_convergence_verdict: 'SHIP-AS-IS',
  },
  runId: missionCampaignId,
  ledger: path.join(temp, 'reject-v2b.jsonl'),
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: granted.payload.contract_path,
  campaignContractDigest: contractDigest,
  campaignSealFile: granted.payload.seal_path,
  implementationOptions: {
    env: {
      AUTOPILOT_PARENT_RUN_ID: 'foreman',
      AUTOPILOT_ROOT_RUN_ID: contract.mission_runtime.root_run_id,
    },
  },
  implementationDispatcher: () => {
    throw new Error('runner must not spawn on v2 run id');
  },
});
check('engine_rejects_mission_v2_as_run_id',
  v2Result.status === 'blocked'
  && /does not match the sealed contract identity/.test(v2Result.reason || ''));

// Terminal reconciliation still binds both identities.
const terminalEngine = new AutopilotEngine({
  cwd: repo,
  missionPreparedReceipt: JSON.parse(fs.readFileSync(preparedPath, 'utf8')),
});
const terminal = terminalEngine.reconcileManagedMissionTerminal({
  campaignControl: intake,
  outcome: 'ready',
  observedAt: '2026-07-28T00:01:00.000Z',
  cwd: repo,
});
check('terminal_binds_both_identities',
  terminal.status === 'applied'
  && terminal.receipt
  && terminal.receipt.icc_campaign_id === iccCampaignId
  && terminal.receipt.mission_campaign_id === missionCampaignId
  && terminal.receipt.raw_campaign_contract_digest === contractDigest);

// --- Marker bridge via dispatch-hetero (stub runner, effect counter) ---
const unitPath = path.join(temp, 'unit.json');
writeJson(unitPath, unit);
const markerDir = path.join(temp, 'session-mode');
fs.mkdirSync(markerDir, { recursive: true });
const runnerCounter = path.join(temp, 'runner-count');
const stub = path.join(temp, 'codex-stub');
fs.writeFileSync(stub, [
  '#!/usr/bin/env bash',
  'case "$*" in',
  "  *\"exec --help\"*) printf -- '--dangerously-bypass-approvals-and-sandbox\\n--dangerously-bypass-hook-trust\\n'; exit 0 ;;",
  '  *"--version"*) echo "codex-cli bridge-test"; exit 0 ;;',
  'esac',
  `printf '1\\n' >> ${JSON.stringify(runnerCounter)}`,
  'mkdir -p src',
  "printf '## Runtime control\\nimplemented\\n' > src/value.txt",
  'git add -A',
  'git -c user.email=bridge@example.invalid -c user.name=Bridge commit -qm bridge',
].join('\n') + '\n');
fs.chmodSync(stub, 0o755);

// Scorecard/capability seed so engine admission does not fail the stub path.
const scores = path.join(temp, 'scores');
const caps = path.join(temp, 'caps');
fs.mkdirSync(scores, { recursive: true });
fs.mkdirSync(caps, { recursive: true });
const now = new Date().toISOString();
const engineRow = {
  engine: 'gpt-5.3-codex-spark',
  runner: 'codex',
  family: 'openai',
  role: 'implementer',
  model_version: 'v1',
  version_source: 'manual',
  corpus_version: 'c@1',
  harness_version: 'h@1',
  runner_version: 'rv1',
  prompt_config_hash: 'sha256:x',
  date: '2026-06-30',
  quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
  capability_score: 0.9,
  cost: {
    source: 'manual', usd_per_mtok_input: 0, usd_per_mtok_output: 0, sample_tokens: 0,
  },
  latency: { sample_wall_time_s: 0 },
  status: 'qualified',
  qualified_at: '2026-06-30',
  expires: '2099-01-01',
};
const engineEvent = {
  schema_version: 1,
  observed_at: now,
  runner: 'codex',
  model: 'gpt-5.3-codex-spark',
  role: 'implementer',
  // Exact resolver tuple: implementer_effort defaults to high; endpoint "" → null.
  effort: 'high',
  endpoint: null,
  runner_version: 'v1',
  capability: {
    quota: {
      status: 'available', confidence: 'high', ttl_seconds: 3600,
      reset_at: null, evidence: 'test',
    },
  },
};
writeJson(path.join(temp, 'engine-row.json'), engineRow);
writeJson(path.join(temp, 'engine-event.json'), engineEvent);
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-scorecard.js'), 'record',
  '--file', path.join(temp, 'engine-row.json'),
], { env: { ...process.env, ENGINE_SCORECARD_DIR: scores }, stdio: 'ignore' });
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-capability-state.js'), 'record',
  '--file', path.join(temp, 'engine-event.json'),
], { env: { ...process.env, ENGINE_CAPABILITY_DIR: caps }, stdio: 'ignore' });

function matchingAdmission(overrides = {}) {
  const body = {
    schema_version: 1,
    artifact_type: 'mission_routing_admission',
    authority_status: 'enforce',
    repo_identity: contract.repo_identity,
    mission_policy_digest: contract.mission_runtime.mission_policy_digest,
    mission_graph_digest: contract.mission_runtime.mission_graph_digest,
    sources_digest: 'a'.repeat(64),
    deliverable_count: 2,
    source_authoring_unit_count: 2,
    critical_path: 2,
    batch_count: 2,
    reservation_totals: {
      campaigns: 2,
      wall_seconds: 200,
      tool_calls: 6,
      engine_attempts: 4,
      external_wait_seconds: 0,
      canonical_changed_files: 4,
      output_bytes: 2048,
    },
    ...overrides,
  };
  // Recompute digest over body without admission_digest
  const { admission_digest: _drop, ...forDigest } = body;
  const digestBody = { ...forDigest };
  delete digestBody.admission_digest;
  const { canonicalDigest } = require(path.join(
    root, 'src', 'engine', 'campaign-verification',
  ));
  return {
    ...digestBody,
    admission_digest: canonicalDigest(digestBody),
  };
}

function writeMarker(name, marker) {
  writeJson(path.join(markerDir, `${name}.json`), marker);
}

function clearMarkers() {
  for (const entry of fs.readdirSync(markerDir)) {
    fs.unlinkSync(path.join(markerDir, entry));
  }
}

function resetRunner() {
  try { fs.unlinkSync(runnerCounter); } catch (_error) { /* absent */ }
}

function runnerCount() {
  try {
    return fs.readFileSync(runnerCounter, 'utf8').trim().split('\n').filter(Boolean).length;
  } catch (_error) {
    return 0;
  }
}

function deleteCampaignBranch() {
  try {
    execFileSync('git', ['-C', repo, 'branch', '-D', contract.branch], {
      stdio: 'ignore',
    });
  } catch (_error) { /* absent */ }
}

function dispatch(extraEnv = {}) {
  resetRunner();
  deleteCampaignBranch();
  const tmpDir = path.join(temp, 'dispatch-tmp', String(Date.now()) + Math.random());
  fs.mkdirSync(tmpDir, { recursive: true });
  const result = spawnSync('bash', [
    path.join(root, 'scripts', 'dispatch-hetero.sh'),
    '--branch', contract.branch,
    '--base', contract.base_sha,
    '--prompt-file', promptFile,
    '--runner', 'codex',
    '--model', 'gpt-5.3-codex-spark',
    '--codex-bin', stub,
    '--strict-contract',
    '--contract-file', unitPath,
    '--campaign-contract', granted.payload.contract_path,
    '--campaign-contract-sha256', contractDigest,
    '--campaign-seal', granted.payload.seal_path,
    '--run-id', iccCampaignId,
    '--stage', 'campaign-implementation',
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      ENGINE_SCORECARD_DIR: scores,
      ENGINE_CAPABILITY_DIR: caps,
      AUTOPILOT_SESSION_MODE_DIR: markerDir,
      // Managed admission runs ahead of the bridge and needs a live level to
      // compare the sealed marker against; the session id decides which single
      // marker file it resolves.
      AUTOPILOT_LEVEL: 'l6',
      CLAUDE_CODE_SESSION_ID: BRIDGE_SESSION_ID,
      AUTOPILOT_DISPATCH_MANIFEST: '0',
      DISPATCH_QUIET: '1',
      AUTOPILOT_ROOT_RUN_ID: contract.mission_runtime.root_run_id,
      AUTOPILOT_PARENT_RUN_ID: 'foreman-bridge',
      AUTOPILOT_DISPATCH_DEPTH: '1',
      TMPDIR: tmpDir,
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    effects: runnerCount(),
  };
}

const repoRootAbs = fs.realpathSync(repo);

// Two gates guard this path and they do not see the same thing. Managed
// admission runs first and resolves exactly one marker — <session id>.json —
// while the bridge that runs after it scans every marker in the directory.
// So a foreign stale marker is the bridge's alone to catch, and the negatives
// below have to clear admission before the bridge is even reached.
const BRIDGE_SESSION_ID = 'bridge-admission-sess';
const validSessionMarker = () => ({
  level: 'l6',
  session_id: BRIDGE_SESSION_ID,
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: matchingAdmission(),
  },
});

// Negatives under enforce first (before positive creates a durable branch).
// Each must be precondition_failed with zero runner effects.
function negative(name, marker) {
  clearMarkers();
  writeMarker(BRIDGE_SESSION_ID, validSessionMarker());
  writeMarker(name, marker);
  const result = dispatch();
  const ok = result.status === 2
    && result.effects === 0
    && /precondition_failed/.test(result.stdout)
    && /marker-to-campaign admission bridge failed/.test(result.stdout);
  check(`negative_${name}_zero_runner`, ok);
}

// Graph mismatch: marker graph A, campaign graph B.
negative('graph_mismatch', {
  level: 'l6',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: matchingAdmission({
      mission_graph_digest: 'b'.repeat(64),
    }),
  },
});

// Policy mismatch.
negative('policy_mismatch', {
  level: 'l6',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: matchingAdmission({
      mission_policy_digest: 'c'.repeat(64),
    }),
  },
});

// Repo mismatch (admission repo_identity differs from campaign).
negative('repo_mismatch', {
  level: 'l6',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: matchingAdmission({
      repo_identity: 'git-common-dir:/not/this/repo',
    }),
  },
});

// Missing admission on active L6 marker.
negative('missing_admission', {
  level: 'l6',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
});

// Malformed admission (extra keys / broken shape).
const malformedAdmission = matchingAdmission();
malformedAdmission.unsealed = true;
negative('malformed_admission', {
  level: 'l6',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'none',
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: malformedAdmission,
  },
});

// Legacy L3 fallback marker (entry_level L6) without proper mission_routing.
negative('legacy_l3_fallback', {
  level: 'l3',
  repo_root: repoRootAbs,
  started_at: '2026-07-28T00:00:00.000Z',
  expires_at: '2099-01-01T00:00:00.000Z',
  entry_level: 'l6',
  fallback_reason: 'precondition_failed',
});

// The session's own marker is admission's business, not the bridge's: a
// mismatched one never reaches the bridge, and must still cost nothing.
clearMarkers();
writeMarker(BRIDGE_SESSION_ID, {
  ...validSessionMarker(),
  mission_routing: {
    status: 'READY',
    admitted: true,
    would_block: false,
    prior_marker_status: 'absent',
    admission: matchingAdmission({ mission_graph_digest: 'c'.repeat(64) }),
  },
});
const sessionMismatch = dispatch();
check('negative_session_marker_mismatch_zero_runner',
  sessionMismatch.status === 2
  && sessionMismatch.effects === 0
  && /dev_flow_admission/.test(sessionMismatch.stdout)
  && /Mission projection mismatch/.test(sessionMismatch.stdout));

// Positive path last: matching L6 marker → stub runner exactly once.
clearMarkers();
writeMarker(BRIDGE_SESSION_ID, validSessionMarker());
const positive = dispatch();
check('positive_l6_marker_reaches_runner_once',
  positive.status === 0 && positive.effects === 1);

// Off/shadow compatibility: with no managed marker, a sealed non-strict
// campaign remains dispatchable when authoritative policy is off.
const offRepo = path.join(temp, 'off-repo');
fs.mkdirSync(path.join(offRepo, '.claude'), { recursive: true });
fs.mkdirSync(path.join(offRepo, 'src'), { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', offRepo]);
execFileSync('git', ['-C', offRepo, 'config', 'user.email', 'off@example.invalid']);
execFileSync('git', ['-C', offRepo, 'config', 'user.name', 'Off Mode']);
fs.writeFileSync(path.join(offRepo, 'src', 'value.txt'), 'base\n');
const offGov = JSON.parse(JSON.stringify(projectGovernance));
delete offGov.mission_convergence;
writeJson(path.join(offRepo, '.claude', 'owner-kernel-governance.json'), offGov);
fs.writeFileSync(path.join(offRepo, '.claude', 'review-loop-config.md'), [
  '- implementer_engine: gpt-5.3-codex-spark',
  '- implementer_runner: codex',
  '- reviewer_engine: claude-opus',
  '- reviewer_runner: claude-native',
  '- reviewer_effort: xhigh',
].join('\n') + '\n');
execFileSync('git', ['-C', offRepo, 'add', '.']);
execFileSync('git', ['-C', offRepo, 'commit', '-qm', 'base']);
const offBase = execFileSync('git', ['-C', offRepo, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const offCommonRaw = execFileSync('git', ['-C', offRepo, 'rev-parse', '--git-common-dir'], {
  encoding: 'utf8',
}).trim();
const offCommon = fs.realpathSync(
  path.isAbsolute(offCommonRaw) ? offCommonRaw : path.join(offRepo, offCommonRaw),
);
const offCampaign = {
  schema_version: 1,
  ticket: 'off-bridge',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: `git-common-dir:${offCommon}`,
  base_sha: offBase,
  branch: 'feat/off-bridge',
  vertical_acceptance: ['off mode works'],
  allowed_path_prefixes: ['src'],
  max_changed_files: 2,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 1,
  max_wall_seconds: 120,
  verify_cmd: 'test -f src/value.txt',
  rubric_ids: ['R1'],
};
const offBytes = `${JSON.stringify(offCampaign, null, 2)}\n`;
const offContractPath = path.join(temp, 'off-campaign.json');
const offSealPath = path.join(temp, 'off-campaign.seal.json');
fs.writeFileSync(offContractPath, offBytes);
const offDigest = crypto.createHash('sha256').update(offBytes).digest('hex');
const offSeal = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal',
  '--contract', offContractPath,
  '--repo', offRepo,
  '--mission-mode', 'off',
  '--out', offSealPath,
], { encoding: 'utf8' });
check('off_mode_seal_ok', offSeal.status === 0 && fs.existsSync(offSealPath));
fs.mkdirSync(path.join(temp, 'empty-session'), { recursive: true });
fs.mkdirSync(path.join(temp, 'off-tmp'), { recursive: true });
resetRunner();
const offNoMarker = spawnSync('bash', [
  path.join(root, 'scripts', 'dispatch-hetero.sh'),
  '--branch', 'feat/off-compat',
  '--base', offBase,
  '--prompt-file', promptFile,
  '--runner', 'codex',
  '--model', 'gpt-5.3-codex-spark',
  '--codex-bin', stub,
  '--campaign-contract', offContractPath,
  '--campaign-contract-sha256', offDigest,
  '--campaign-seal', offSealPath,
], {
  cwd: offRepo,
  encoding: 'utf8',
  env: {
    ...process.env,
    ENGINE_SCORECARD_DIR: scores,
    ENGINE_CAPABILITY_DIR: caps,
    AUTOPILOT_SESSION_MODE_DIR: path.join(temp, 'empty-session'),
    AUTOPILOT_DISPATCH_MANIFEST: '0',
    DISPATCH_QUIET: '1',
    TMPDIR: path.join(temp, 'off-tmp'),
  },
});
check('off_mode_without_managed_marker_compatible',
  offNoMarker.status === 0 && runnerCount() === 1);

// Local verifyMissionRoutingProjection unit regression for matching admission.
const localExpected = {
  repo_identity: contract.repo_identity,
  mission_policy_digest: contract.mission_runtime.mission_policy_digest,
  mission_graph_digest: contract.mission_runtime.mission_graph_digest,
};
check('projection_helper_accepts_match',
  verifyMissionRoutingProjection({
    level: 'l6',
    mission_routing: {
      status: 'READY',
      admitted: true,
      would_block: false,
      prior_marker_status: 'absent',
      admission: matchingAdmission(),
    },
  }, localExpected).valid === true);
check('projection_helper_rejects_graph_drift',
  verifyMissionRoutingProjection({
    level: 'l6',
    mission_routing: {
      status: 'READY',
      admitted: true,
      would_block: false,
      prior_marker_status: 'absent',
      admission: matchingAdmission({ mission_graph_digest: 'f'.repeat(64) }),
    },
  }, localExpected).valid === false);

process.stdout.write(lines.join('\n') + '\n');
if (process.exitCode) process.exit(process.exitCode);
NODE
)"
ORACLE_EXIT=$?

assert_exit_code "$ORACLE_EXIT" "0" "mission-routing-campaign-bridge oracle exits zero"

PASS_COUNT=0
FAIL_COUNT=0
while IFS=$'\t' read -r id result; do
  [ -n "$id" ] || continue
  if [ "$result" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
  assert_eq "$result" "PASS" "bridge oracle $id"
done <<< "$OUT"

assert_eq "$FAIL_COUNT" "0" "bridge oracle has zero failures (pass=$PASS_COUNT)"
for key in \
  prepare_created mission_seal_is_v2 icc_id_is_v1_distinct intake_admitted_dual_identity \
  strict_projection_uses_icc_v1 engine_rejects_mission_v2_as_run_id terminal_binds_both_identities \
  positive_l6_marker_reaches_runner_once \
  negative_graph_mismatch_zero_runner negative_policy_mismatch_zero_runner \
  negative_repo_mismatch_zero_runner negative_missing_admission_zero_runner \
  negative_malformed_admission_zero_runner negative_legacy_l3_fallback_zero_runner \
  negative_session_marker_mismatch_zero_runner \
  off_mode_without_managed_marker_compatible; do
  assert_contains "$OUT" "${key}	PASS" "oracle proves $key"
done

finalize_test
