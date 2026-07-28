#!/usr/bin/env bash
set -uo pipefail

TEST_NAME="mission-policy-graph"
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];
const owner = require(path.join(root, 'src/engine/owner-kernel'));
const missionPolicy = require(path.join(root, 'src/engine/mission-policy'));
const graphApi = require(path.join(root, 'src/engine/mission-execution-graph'));
const graphChecker = require(path.join(root, 'scripts/mission-execution-graph-check'));
const campaignChecker = require(path.join(root, 'scripts/implementation-campaign-check'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => owner.sha256(typeof value === 'string' ? value : owner.canonicalJson(value));

function policySection(overrides = {}) {
  return {
    schema_version: 1,
    enforcement_mode: 'enforce',
    max_campaigns: 8,
    max_wall_seconds: 10000,
    max_tool_calls: 1000,
    max_engine_attempts: 100,
    max_external_wait_seconds: 500,
    max_canonical_changed_files: 100,
    max_output_bytes: 1000000,
    max_deliverables: 8,
    max_parallel: 3,
    max_batches: 2,
    max_graph_depth: 2,
    max_gate_attempts: 12,
    closure_ratio: 1,
    max_stagnant_campaigns: 2,
    ...overrides,
  };
}

const baseGovernance = JSON.parse(fs.readFileSync(
  path.join(root, '.claude/owner-kernel-governance.json'),
  'utf8',
));
delete baseGovernance.mission_convergence;
const legacy = owner.resolveGovernancePolicy(baseGovernance);
assert.equal(legacy.policy_hash, 'ebb355428a0f60be2b52d3842894bab215bf625b3359e0d6d2ba5696dae03ae8');
assert.equal(Object.hasOwn(legacy.policy, 'mission_convergence'), false);
assert.equal(missionPolicy.resolveMissionPolicy(baseGovernance).policy.enforcement_mode, 'off');
assert.throws(
  () => missionPolicy.resolveMissionPolicy({ mission_convergence: { enforcement_mode: 'shadow' } }),
  /schema_version must equal 1/,
);
assert.throws(
  () => missionPolicy.resolveMissionPolicy({
    ...clone(baseGovernance),
    mission_convergence: { ...policySection(), surprise: 1 },
  }),
  /unsupported key/,
);
assert.throws(
  () => missionPolicy.resolveMissionPolicy({
    ...clone(baseGovernance),
    mission_convergence: 'enforce',
  }),
  /plain object/,
);

const governance = { ...clone(baseGovernance), mission_convergence: policySection() };
const resolvedMission = missionPolicy.resolveMissionPolicy(governance);
assert.equal(resolvedMission.policy.enforcement_mode, 'enforce');
assert.equal(
  resolvedMission.policy_digest,
  missionPolicy.resolveMissionPolicy(clone(governance)).policy_digest,
);
assert.equal(
  missionPolicy.resolveMissionPolicy(governance, {
    taskOverride: { max_deliverables: 4 },
    agentOverride: { max_deliverables: 3 },
  }).policy.max_deliverables,
  3,
);
assert.throws(
  () => missionPolicy.resolveMissionPolicy(governance, {
    taskOverride: { max_deliverables: 9 },
  }),
  (error) => error.code === 'MISSION_POLICY_BROADENED',
);

const adoptionBinding = {
  repo_identity: 'git-common-dir:/repo',
  intent: { objective: 'ship exact acceptance', requirements_hash: hash('requirements') },
  initial_required_acceptance_hashes: [hash('contract'), hash('criteria')],
};
const lineage = missionPolicy.deriveMissionLineageId(adoptionBinding);
assert.equal(lineage, missionPolicy.deriveMissionLineageId({
  ...clone(adoptionBinding),
  initial_required_acceptance_hashes: [...adoptionBinding.initial_required_acceptance_hashes].reverse(),
}));
const existing = {
  repo_identity: adoptionBinding.repo_identity,
  adoption_key: missionPolicy.deriveMissionAdoptionKey(adoptionBinding),
  mission_lineage_id: lineage,
};
assert.equal(
  missionPolicy.resolveMissionLineageAdoption(adoptionBinding, { unresolvedMission: existing }).adopted,
  true,
);
assert.throws(
  () => missionPolicy.resolveMissionLineageAdoption({
    ...adoptionBinding,
    intent: { ...adoptionBinding.intent, objective: 'reword to reset' },
  }, { unresolvedMission: existing }),
  (error) => error.code === 'MISSION_LINEAGE_RESET',
);

const resolvedGovernance = owner.resolveGovernancePolicy(governance);
assert.equal(
  resolvedGovernance.policy.mission_policy_digest,
  resolvedMission.policy_digest,
);
const taskInput = {
  taskId: 'mission-task-one',
  policy: resolvedGovernance.policy,
  policyHash: resolvedGovernance.policy_hash,
  intent: {
    objective: 'ship exact acceptance',
    requirements_hash: hash('requirements'),
    scope: {
      task_classes: ['implementation'],
      domains: ['repository'],
      languages: ['javascript'],
      allowed_tools: [],
      artifact_roots: ['src'],
    },
  },
  acceptance: {
    contract_hash: hash('contract'),
    criteria_hash: hash('criteria'),
    required_evidence: ['tests'],
  },
  redLineAdditions: [],
  effectPermissions: { effects: [] },
  resourceCeiling: {
    max_tokens: 1000,
    max_wall_seconds: 100,
    max_tool_calls: 10,
    max_cost_usd_micros: 0,
    max_grant_ttl_seconds: 60,
  },
  dataEgressRules: [],
  escalationPolicy: {
    on_role_denied: 'block',
    on_scope_mismatch: 'block',
    protected_effects_require_escalation: true,
  },
  finishReceiptSchema: {
    schema_id: 'finish-receipt-v1',
    required_fields: [
      'authority_status',
      'decisions_outside_user_intent',
      'effective_profile',
      'evidence',
    ],
  },
  missionAuthority: {
    repoIdentity: adoptionBinding.repo_identity,
    graphDigest: hash('graph-one'),
  },
};
const authority = owner.freezeTaskAuthorityEnvelope(taskInput);
const authorityLineage = missionPolicy.deriveMissionLineageId({
  repo_identity: adoptionBinding.repo_identity,
  intent: taskInput.intent,
  initial_required_acceptance_hashes: [
    taskInput.acceptance.contract_hash,
    taskInput.acceptance.criteria_hash,
  ],
});
assert.equal(authority.envelope.authority_status, 'shadow');
assert.equal(authority.envelope.mission_policy_digest, resolvedMission.policy_digest);
assert.equal(authority.envelope.mission_graph_digest, hash('graph-one'));
assert.equal(authority.envelope.mission_lineage_id, authorityLineage);
assert.equal(
  owner.freezeTaskAuthorityEnvelope({
    ...taskInput,
    taskId: 'new-ticket-does-not-reset-lineage',
    missionAuthority: { ...taskInput.missionAuthority, graphDigest: hash('graph-two') },
  }).envelope.mission_lineage_id,
  authorityLineage,
);
assert.throws(
  () => owner.freezeTaskAuthorityEnvelope({ ...taskInput, missionPolicyDigest: hash('replacement') }),
  (error) => error.code === 'TASK_AUTHORITY_MISSION_BINDING_REPLACED',
);
assert.throws(
  () => owner.freezeTaskAuthorityEnvelope({ ...taskInput, missionAuthority: undefined }),
  /Mission binding must be a plain object/,
);
const replaced = clone(authority.envelope);
replaced.mission_graph_digest = hash('replacement');
const replacedBody = Object.fromEntries(
  Object.entries(replaced).filter(([key]) => key !== 'task_authority_id'),
);
replaced.task_authority_id = hash(replacedBody);
assert.throws(
  () => owner.verifyTaskAuthorityEnvelope(replaced, {
    expectedPolicy: resolvedGovernance.policy,
    expectedPolicyHash: resolvedGovernance.policy_hash,
    expectedTaskAuthorityId: authority.envelope.task_authority_id,
  }),
  (error) => error.code === 'TASK_AUTHORITY_ANCHOR_MISMATCH',
);

function reservation(overrides = {}) {
  return {
    campaigns: 1,
    wall_seconds: 1000,
    tool_calls: 100,
    engine_attempts: 3,
    external_wait_seconds: 10,
    canonical_changed_files: 10,
    output_bytes: 10000,
    ...overrides,
  };
}
function node(id, dependencies, planId, rubricId, overrides = {}) {
  return {
    id,
    source_plan_ids: [planId],
    source_rubric_ids: [rubricId],
    dependencies,
    acceptance_ids: [`accept-${id}`],
    verification_commands: [`verify-${id}`],
    gate_attempt_budget: 3,
    reservation: reservation(),
    campaign: {
      profile: 'poc',
      allowed_path_prefixes: ['src/'],
      spec: { path: 'src/spec.md', section: 'Workstream A' },
      required_paths: ['src/input.js'],
      output_paths: ['src/output.js'],
      max_changed_files: 10,
      baseline_churn: 100,
      max_growth_ratio: 1.5,
      max_extra_churn: 50,
      max_repair_generations: 2,
      max_wall_seconds: 1000,
    },
    ...overrides,
  };
}
const graph = {
  schema_version: 1,
  artifact_type: 'mission_execution_graph',
  nodes: [
    node('plan-review', [], 'plan-prs', 'RPRS1'),
    node('runtime-control', [], 'plan-runtime', 'RRUNTIME2'),
    node('transcript-retro', [], 'plan-ctr', 'RCTR3'),
    node(
      'release-closeout',
      ['runtime-control', 'plan-review', 'transcript-retro'],
      'plan-close',
      'RCLOSE4',
    ),
  ],
};
const frozenGraph = graphApi.checkMissionGraphCoverage(graph, {
  planIds: ['plan-prs', 'plan-runtime', 'plan-ctr', 'plan-close'],
  rubricIds: ['RPRS1', 'RRUNTIME2', 'RCTR3', 'RCLOSE4'],
}, resolvedMission);
assert.equal(frozenGraph.calculated_depth, 2);
assert.equal(frozenGraph.calculated_batches, 2);
assert.equal(
  frozenGraph.graph_digest,
  graphApi.freezeMissionExecutionGraph(clone(frozenGraph.graph), resolvedMission).graph_digest,
);
const frozenNodeDigest = graphApi.deriveMissionGraphNodeDigest(
  frozenGraph.graph,
  'plan-review',
  resolvedMission,
);
assert.equal(frozenNodeDigest.length, 64);
const changedOutputGraph = clone(graph);
changedOutputGraph.nodes[0].campaign.output_paths = ['src/another-output.js'];
assert.notEqual(
  graphApi.freezeMissionExecutionGraph(changedOutputGraph, resolvedMission).graph_digest,
  frozenGraph.graph_digest,
);
assert.notEqual(
  graphApi.deriveMissionGraphNodeDigest(changedOutputGraph, 'plan-review', resolvedMission),
  frozenNodeDigest,
);
const escapedDispatchGraph = clone(graph);
escapedDispatchGraph.nodes[0].campaign.output_paths = ['docs/invented.md'];
assert.throws(
  () => graphApi.freezeMissionExecutionGraph(escapedDispatchGraph, resolvedMission),
  /inside an allowed path prefix/,
);

let effects = 0;
let incompletePolicyEffects = 0;
assert.throws(
  () => graphApi.admitMissionExecutionGraph({
    graph,
    policy: { enforcement_mode: 'enforce' },
    effect: () => { incompletePolicyEffects += 1; },
  }),
  /schema_version is required/,
);
assert.equal(incompletePolicyEffects, 0);
let prefixBypassEffects = 0;
const prefixBypass = clone(graph);
prefixBypass.nodes[0].campaign.allowed_path_prefixes = ['src/foo/'];
prefixBypass.nodes[0].campaign.spec.path = 'src/foo/spec.md';
prefixBypass.nodes[0].campaign.required_paths = ['src/foo/input.js'];
prefixBypass.nodes[0].campaign.output_paths = ['src/foobar/output.js'];
assert.throws(
  () => graphApi.admitMissionExecutionGraph({
    graph: prefixBypass,
    policy: resolvedMission,
    effect: () => { prefixBypassEffects += 1; },
  }),
  /inside an allowed path prefix/,
);
assert.equal(prefixBypassEffects, 0);
const ambiguousPath = clone(graph);
ambiguousPath.nodes[0].campaign.spec.path = 'src/./spec.md';
assert.throws(
  () => graphApi.freezeMissionExecutionGraph(ambiguousPath, resolvedMission),
  /bounded relative path/,
);
function projectionReject(mutate, pattern) {
  const candidate = clone(graph);
  mutate(candidate.nodes[0]);
  assert.throws(
    () => graphApi.freezeMissionExecutionGraph(candidate, resolvedMission),
    pattern,
  );
}
projectionReject(
  (selected) => { selected.source_rubric_ids = ['r-invalid-hash']; },
  /ICC rubric ID contract/,
);
projectionReject(
  (selected) => {
    selected.source_rubric_ids = Array.from({ length: 129 }, (_, index) => `R${index}`);
  },
  /1\.\.128 ICC-compatible IDs/,
);
projectionReject(
  (selected) => {
    selected.acceptance_ids = Array.from({ length: 65 }, (_, index) => `accept-${index}`);
  },
  /at most 64/,
);
projectionReject(
  (selected) => {
    selected.campaign.allowed_path_prefixes = Array.from(
      { length: 129 },
      (_, index) => `src/prefix-${index}`,
    );
  },
  /at most 128/,
);
projectionReject(
  (selected) => { selected.campaign.max_changed_files = 4097; },
  /1\.\.4096/,
);
projectionReject(
  (selected) => { selected.campaign.baseline_churn = 0; },
  /1\.\.10000000/,
);
projectionReject(
  (selected) => { selected.campaign.baseline_churn = 10000001; },
  /1\.\.10000000/,
);
projectionReject(
  (selected) => { selected.campaign.max_growth_ratio = 1.5001; },
  /1\.\.1\.5/,
);
projectionReject(
  (selected) => { selected.campaign.max_extra_churn = 5000001; },
  /0\.\.5000000/,
);
projectionReject(
  (selected) => { selected.campaign.max_extra_churn = 51; },
  /ratio-derived ceiling 50/,
);
projectionReject(
  (selected) => { selected.campaign.max_repair_generations = 3; },
  /0\.\.2/,
);
projectionReject(
  (selected) => { selected.campaign.max_wall_seconds = 3601; },
  /1\.\.3600/,
);
projectionReject(
  (selected) => {
    selected.verification_commands = ['x'.repeat(2048), 'y'.repeat(2048)];
  },
  /projection exceeds 4096/,
);
projectionReject(
  (selected) => { selected.reservation.tool_calls = 0; },
  /tool_calls.*1\.\./,
);
projectionReject(
  (selected) => { selected.reservation.engine_attempts = 0; },
  /engine_attempts.*1\.\.3/,
);
projectionReject(
  (selected) => { selected.reservation.engine_attempts = 4; },
  /engine_attempts.*1\.\.3/,
);
projectionReject(
  (selected) => { selected.reservation.output_bytes = 0; },
  /output_bytes.*1\.\./,
);
const oversized = {
  ...graph,
  nodes: Array.from({ length: 34 }, (_, index) => (
    node(`node-${index}`, [], `plan-${index}`, `R-${index}`)
  )),
};
assert.throws(
  () => graphApi.admitMissionExecutionGraph({
    graph: oversized,
    policy: resolvedMission,
    effect: () => { effects += 1; },
  }),
  (error) => error.code === 'MISSION_GRAPH_DELIVERABLE_LIMIT',
);
assert.equal(effects, 0);

const aggregateOverflow = clone(graph);
aggregateOverflow.nodes[0].reservation.tool_calls = 800;
assert.throws(
  () => graphApi.freezeMissionExecutionGraph(aggregateOverflow, resolvedMission),
  (error) => error.code === 'MISSION_GRAPH_RESERVATION_LIMIT',
);
const gateOverflow = clone(graph);
gateOverflow.nodes[0].gate_attempt_budget = 10;
assert.throws(
  () => graphApi.freezeMissionExecutionGraph(gateOverflow, resolvedMission),
  (error) => error.code === 'MISSION_GRAPH_GATE_LIMIT',
);
const cycle = clone(graph);
cycle.nodes[0].dependencies = ['release-closeout'];
assert.throws(
  () => graphApi.freezeMissionExecutionGraph(cycle, resolvedMission),
  (error) => error.code === 'MISSION_GRAPH_CYCLE',
);
assert.throws(
  () => graphApi.checkMissionGraphCoverage(graph, {
    planIds: ['plan-prs', 'plan-runtime', 'plan-ctr', 'invented'],
    rubricIds: ['RPRS1', 'RRUNTIME2', 'RCTR3', 'RCLOSE4'],
  }, resolvedMission),
  (error) => error.code === 'MISSION_GRAPH_PLAN_COVERAGE',
);

const governancePath = path.join(tmp, 'governance.json');
const graphPath = path.join(tmp, 'graph.json');
const sourceRoot = path.join(tmp, 'source-root');
fs.mkdirSync(sourceRoot);
const sourcesPath = path.join(sourceRoot, 'sources.json');
const repoPath = path.join(tmp, 'repo');
fs.mkdirSync(path.join(repoPath, '.claude'), { recursive: true });
fs.writeFileSync(governancePath, JSON.stringify(governance));
fs.writeFileSync(
  path.join(repoPath, '.claude/owner-kernel-governance.json'),
  JSON.stringify(governance),
);
const sourceFiles = [
  { plan: 'plan-a.md', rubric: 'rubric-a.md', planBytes: '# Plan A\n', rubricBytes: '## R1 Ready\n' },
  { plan: 'plan-b.md', rubric: 'rubric-b.md', planBytes: '# Plan B\n', rubricBytes: '- R2: Safe\n' },
];
for (const source of sourceFiles) {
  fs.writeFileSync(path.join(sourceRoot, source.plan), source.planBytes);
  fs.writeFileSync(path.join(sourceRoot, source.rubric), source.rubricBytes);
}
const sourceManifest = {
  schema_version: 1,
  sources: sourceFiles.map((source) => ({
    plan_path: source.plan,
    rubric_path: source.rubric,
    plan_sha256: hash(source.planBytes),
    rubric_sha256: hash(source.rubricBytes),
  })),
};
fs.writeFileSync(sourcesPath, JSON.stringify(sourceManifest));
const derivedCoverage = graphChecker.loadSourceCoverageManifest(sourcesPath);
const checkerGraph = {
  schema_version: 1,
  artifact_type: 'mission_execution_graph',
  nodes: [
    node('source-a', [], derivedCoverage.planIds[0], derivedCoverage.rubricIds[0]),
    node('source-b', [], derivedCoverage.planIds[1], derivedCoverage.rubricIds[1]),
  ],
};
fs.writeFileSync(graphPath, JSON.stringify(checkerGraph));
const checked = graphChecker.inspect({
  governance: governancePath,
  graph: graphPath,
  sources: sourcesPath,
});
assert.equal(checked.status, 'READY');
const omittedSourceGraph = clone(checkerGraph);
omittedSourceGraph.nodes.pop();
fs.writeFileSync(graphPath, JSON.stringify(omittedSourceGraph));
assert.throws(
  () => graphChecker.inspect({ governance: governancePath, graph: graphPath, sources: sourcesPath }),
  /coverage is not exact/,
);
const inventedGraph = clone(checkerGraph);
inventedGraph.nodes[0].source_plan_ids = [`plan-${hash('invented')}`];
fs.writeFileSync(graphPath, JSON.stringify(inventedGraph));
assert.throws(
  () => graphChecker.inspect({ governance: governancePath, graph: graphPath, sources: sourcesPath }),
  /coverage is not exact/,
);
const changedRubric = '## R1 Ready with changed semantics\n';
fs.writeFileSync(path.join(sourceRoot, sourceFiles[0].rubric), changedRubric);
const changedRubricManifest = clone(sourceManifest);
changedRubricManifest.sources[0].rubric_sha256 = hash(changedRubric);
fs.writeFileSync(sourcesPath, JSON.stringify(changedRubricManifest));
const changedRubricCoverage = graphChecker.loadSourceCoverageManifest(sourcesPath);
assert.notDeepEqual(changedRubricCoverage.rubricIds, derivedCoverage.rubricIds);
fs.writeFileSync(graphPath, JSON.stringify(checkerGraph));
assert.throws(
  () => graphChecker.inspect({ governance: governancePath, graph: graphPath, sources: sourcesPath }),
  /coverage is not exact/,
);
fs.writeFileSync(
  path.join(sourceRoot, sourceFiles[0].rubric),
  '## R1 Ready\n- R1: Duplicate\n',
);
const duplicateManifest = clone(sourceManifest);
duplicateManifest.sources[0].rubric_sha256 = hash('## R1 Ready\n- R1: Duplicate\n');
fs.writeFileSync(sourcesPath, JSON.stringify(duplicateManifest));
assert.throws(() => graphChecker.loadSourceCoverageManifest(sourcesPath), /duplicate rubric IDs/);
fs.writeFileSync(path.join(sourceRoot, sourceFiles[0].rubric), sourceFiles[0].rubricBytes);
fs.writeFileSync(sourcesPath, JSON.stringify(sourceManifest));
fs.appendFileSync(path.join(sourceRoot, sourceFiles[0].plan), 'drift\n');
assert.throws(() => graphChecker.loadSourceCoverageManifest(sourcesPath), /content digest drifted/);
fs.writeFileSync(path.join(sourceRoot, sourceFiles[0].plan), sourceFiles[0].planBytes);
const outsideRubric = path.join(tmp, 'outside-rubric.md');
fs.writeFileSync(outsideRubric, '## R9 Outside\n');
fs.symlinkSync(outsideRubric, path.join(sourceRoot, 'escape-rubric.md'));
fs.writeFileSync(sourcesPath, JSON.stringify({
  schema_version: 1,
  sources: [{
    plan_path: sourceFiles[0].plan,
    rubric_path: 'escape-rubric.md',
    plan_sha256: hash(sourceFiles[0].planBytes),
    rubric_sha256: hash('## R9 Outside\n'),
  }],
}));
assert.throws(() => graphChecker.loadSourceCoverageManifest(sourcesPath), /escapes the source manifest root/);
fs.symlinkSync(path.join(sourceRoot, sourceFiles[0].plan), path.join(sourceRoot, 'alias-plan.md'));
fs.writeFileSync(sourcesPath, JSON.stringify({
  schema_version: 1,
  sources: [
    sourceManifest.sources[0],
    {
      ...sourceManifest.sources[1],
      plan_path: 'alias-plan.md',
      plan_sha256: hash(sourceFiles[0].planBytes),
    },
  ],
}));
assert.throws(() => graphChecker.loadSourceCoverageManifest(sourcesPath), /real targets must be unique/);
assert.equal(
  campaignChecker.projectMissionPolicy(repoPath).policy_digest,
  resolvedMission.policy_digest,
);
const malformedRepo = path.join(tmp, 'malformed-repo');
fs.mkdirSync(path.join(malformedRepo, '.claude'), { recursive: true });
const malformedGovernance = { schema_version: 1, governance: {} };
fs.writeFileSync(
  path.join(malformedRepo, '.claude/owner-kernel-governance.json'),
  JSON.stringify(malformedGovernance),
);
assert.throws(() => owner.resolveGovernancePolicy(malformedGovernance), /default_mode/);
assert.throws(() => campaignChecker.projectMissionPolicy(malformedRepo), /default_mode/);

const policySchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/mission-policy.schema.json')));
const graphSchema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/mission-execution-graph.schema.json')));
assert.equal(policySchema.properties.max_deliverables.minimum, undefined);
assert.equal(graphSchema.$defs.node.properties.gate_attempt_budget.minimum, 1);
assert.equal(graphSchema.$defs.node.properties.source_rubric_ids.maxItems, 128);
assert.equal(
  graphSchema.$defs.node.properties.source_rubric_ids.items.pattern,
  '^[A-Za-z][A-Za-z0-9_-]*[0-9]+$',
);
assert.equal(graphSchema.$defs.node.properties.acceptance_ids.maxItems, 64);
assert.equal(graphSchema.$defs.campaign.properties.allowed_path_prefixes.maxItems, 128);
assert.equal(graphSchema.$defs.campaign.properties.max_changed_files.maximum, 4096);
assert.equal(graphSchema.$defs.campaign.properties.baseline_churn.minimum, 1);
assert.equal(graphSchema.$defs.campaign.properties.max_growth_ratio.maximum, 1.5);
assert.equal(graphSchema.$defs.campaign.properties.max_extra_churn.maximum, 5000000);
assert.equal(graphSchema.$defs.campaign.properties.max_wall_seconds.maximum, 3600);
assert.equal(graphSchema.$defs.reservation.properties.engine_attempts.maximum, 3);
const authoritySchema = JSON.parse(fs.readFileSync(
  path.join(root, 'schemas/task-authority-envelope.schema.json'),
));
for (const field of [
  'mission_lineage_id',
  'mission_policy_digest',
  'mission_graph_digest',
]) {
  assert.ok(authoritySchema.properties[field]);
  assert.equal(authoritySchema.required.includes(field), false);
}

console.log(JSON.stringify({
  legacy_policy_hash_unchanged: true,
  policy_digest_shared: true,
  lineage_reset_rejected: true,
  authority_binding_frozen: true,
  graph_ready: true,
  oversized_effect_count: effects,
  incomplete_policy_effect_count: incompletePolicyEffects,
  prefix_bypass_effect_count: prefixBypassEffects,
}));
NODE
)"
EXIT=$?

assert_exit_code "$EXIT" "0" "Mission policy/authority/graph contract passes"
assert_contains "$OUT" '"legacy_policy_hash_unchanged":true' "legacy policy hash remains byte-identical"
assert_contains "$OUT" '"policy_digest_shared":true' "shared policy resolver is stable"
assert_contains "$OUT" '"lineage_reset_rejected":true' "unresolved lineage cannot reset by rewording"
assert_contains "$OUT" '"authority_binding_frozen":true' "TaskAuthority freezes Mission bindings"
assert_contains "$OUT" '"graph_ready":true' "four-node graph passes exact deterministic coverage"
assert_contains "$OUT" '"oversized_effect_count":0' "34-node graph rejects before effects"
assert_contains "$OUT" '"incomplete_policy_effect_count":0' "incomplete policy rejects before effects"
assert_contains "$OUT" '"prefix_bypass_effect_count":0' "path-prefix sibling bypass rejects before effects"

finalize_test
