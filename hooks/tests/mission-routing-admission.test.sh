#!/usr/bin/env bash
set -uo pipefail

TEST_NAME="mission-routing-admission"
. "$(dirname "$0")/lib.sh"
# Ambient mission harness env must not poison hermetic unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const root = process.argv[2];
const tmp = process.argv[3];
const {
  admitMissionRouting,
  atxHeadingMatchesSection,
  isAuthoritativeGitObjectId,
} = require(path.join(root, 'scripts/mission-routing-admission'));
const {
  contentBoundRubricId,
  inspect: inspectMissionGraph,
} = require(path.join(root, 'scripts/mission-execution-graph-check'));
const {
  verifyMissionRoutingProjection,
} = require(path.join(root, 'scripts/session-mode'));
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));

// Graph-spec base SHA gate: accept Git SHA-1 (40) and SHA-256 (64) only.
assert.equal(isAuthoritativeGitObjectId('a'.repeat(40)), true);
assert.equal(isAuthoritativeGitObjectId('b'.repeat(64)), true);
assert.equal(isAuthoritativeGitObjectId('c'.repeat(39)), false);
assert.equal(isAuthoritativeGitObjectId('d'.repeat(41)), false);
assert.equal(isAuthoritativeGitObjectId('e'.repeat(63)), false);
assert.equal(isAuthoritativeGitObjectId('f'.repeat(65)), false);
assert.equal(isAuthoritativeGitObjectId('A'.repeat(40)), false);
assert.equal(isAuthoritativeGitObjectId(null), false);

// ATX headings allow 0..3 leading ASCII spaces; four spaces is code, not a heading.
assert.equal(atxHeadingMatchesSection('## Phase 0', 'Phase 0'), true);
assert.equal(atxHeadingMatchesSection('   ## Phase 0', 'Phase 0'), true);
assert.equal(atxHeadingMatchesSection('    ## Phase 0', 'Phase 0'), false);
assert.equal(atxHeadingMatchesSection('\t## Phase 0', 'Phase 0'), false);
assert.equal(atxHeadingMatchesSection('## Other', 'Phase 0'), false);

const routes = [
  ['l3', 'none'],
  ['l4', 'none'],
  ['l5', 'none'],
  ['l6', 'none'],
  ['l4', 'solo'],
  ['l4', 'precondition_failed'],
  ['l5', 'solo'],
  ['l5', 'precondition_failed'],
  ['l6', 'solo'],
  ['l6', 'precondition_failed'],
];
const admissions = routes.map(([entryLevel, fallback]) => admitMissionRouting({
  repoRoot: root,
  entryLevel,
  fallback,
}));
const normalizedAdmissionFacts = admissions.map((entry) => {
  const { admission_digest: _digest, ...facts } = entry.admission;
  return facts;
});
assert.equal(
  new Set(admissions.map((entry) => entry.admission.admission_digest)).size,
  1,
  'routing topology must not change the sealed admission digest',
);
assert.deepEqual(
  normalizedAdmissionFacts,
  Array.from({ length: routes.length }, () => normalizedAdmissionFacts[0]),
  'routing topology must not change normalized admission facts',
);
assert.deepEqual(
  admissions.map((entry) => entry.route.effective_level),
  ['l3', 'l4', 'l5', 'l6', 'l3', 'l3', 'l3', 'l3', 'l3', 'l3'],
);
assert.ok(admissions.every((entry) => entry.status === 'READY' && entry.enforced));
const dogfood = admissions[0].admission;
const routingConfig = JSON.parse(fs.readFileSync(
  path.join(root, '.claude', 'mission-routing-config.json'),
  'utf8',
));
const currentGraph = inspectMissionGraph({
  graph: path.join(root, routingConfig.graph_path),
  governance: path.join(root, '.claude', 'owner-kernel-governance.json'),
  sources: path.join(root, routingConfig.sources_path),
});
assert.equal(dogfood.deliverable_count, currentGraph.deliverables);
assert.equal(dogfood.source_authoring_unit_count, currentGraph.coverage.authoring_unit_count);
assert.equal(dogfood.critical_path, currentGraph.calculated_depth);
assert.equal(dogfood.batch_count, currentGraph.calculated_batches);
assert.equal(dogfood.mission_graph_digest, currentGraph.graph_digest);
assert.deepEqual(dogfood.reservation_totals, currentGraph.reservation_totals);

const markerDir = path.join(tmp, 'markers');
const markerEnv = {
  ...process.env,
  AUTOPILOT_SESSION_MODE_DIR: markerDir,
  CLAUDE_CODE_SESSION_ID: 'routing-session',
};
function setMode(args) {
  return JSON.parse(execFileSync(
    process.execPath,
    [path.join(root, 'scripts/session-mode.js'), 'set', '--repo-root', root, ...args],
    { encoding: 'utf8', env: markerEnv },
  ));
}
const firstMarker = setMode(['--level', 'l6']);
assert.equal(
  firstMarker.mission_routing.admission.admission_digest,
  dogfood.admission_digest,
);
const projectedIdentity = {
  repo_identity: dogfood.repo_identity,
  mission_policy_digest: dogfood.mission_policy_digest,
  mission_graph_digest: dogfood.mission_graph_digest,
};
assert.equal(verifyMissionRoutingProjection(firstMarker, projectedIdentity).valid, true);
assert.match(
  verifyMissionRoutingProjection(firstMarker, {
    ...projectedIdentity,
    mission_graph_digest: hash('different graph'),
  }).reason,
  /mission_graph_digest/,
);
const openMarker = clone(firstMarker);
openMarker.mission_routing.admission.unsealed = true;
assert.match(
  verifyMissionRoutingProjection(openMarker, projectedIdentity).reason,
  /admission shape/,
);
const fallbackMarker = setMode([
  '--level', 'l3',
  '--entry-level', 'l6',
  '--fallback', 'precondition_failed',
]);
assert.equal(fallbackMarker.entry_level, 'l6');
assert.equal(fallbackMarker.level, 'l3');
assert.equal(
  fallbackMarker.mission_routing.admission.admission_digest,
  dogfood.admission_digest,
);

const markerPath = path.join(markerDir, 'routing-session.json');
fs.writeFileSync(markerPath, 'not-json\n');
const afterCorrupt = setMode(['--level', 'l5']);
assert.equal(afterCorrupt.mission_routing.prior_marker_status, 'corrupt');
assert.equal(
  afterCorrupt.mission_routing.admission.admission_digest,
  dogfood.admission_digest,
);
fs.writeFileSync(markerPath, JSON.stringify({
  level: 'l6',
  repo_root: root,
  expires_at: '2020-01-01T00:00:00.000Z',
}));
const afterExpired = setMode(['--level', 'l4']);
assert.equal(afterExpired.mission_routing.prior_marker_status, 'expired');
assert.equal(
  afterExpired.mission_routing.admission.admission_digest,
  dogfood.admission_digest,
);

const repo = path.join(tmp, 'synthetic-repo');
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.mkdirSync(path.join(repo, 'docs', 'sources'), { recursive: true });
execFileSync('git', ['init', '-q', repo]);
const governance = JSON.parse(fs.readFileSync(
  path.join(root, '.claude', 'owner-kernel-governance.json'),
  'utf8',
));
governance.mission_convergence = {
  ...governance.mission_convergence,
  max_campaigns: 4,
  max_wall_seconds: 400,
  max_tool_calls: 40,
  max_engine_attempts: 8,
  max_external_wait_seconds: 20,
  max_canonical_changed_files: 40,
  max_output_bytes: 4000,
  max_deliverables: 4,
  max_parallel: 4,
  max_batches: 1,
  max_graph_depth: 1,
  max_gate_attempts: 4,
};
const governancePath = path.join(repo, '.claude', 'owner-kernel-governance.json');
fs.writeFileSync(governancePath, `${JSON.stringify(governance, null, 2)}\n`);
fs.writeFileSync(path.join(repo, '.claude', 'mission-routing-config.json'), `${JSON.stringify({
  schema_version: 1,
  graph_path: 'docs/graph.json',
  sources_path: 'docs/sources.json',
}, null, 2)}\n`);

const manifest = { schema_version: 1, sources: [] };
const planIds = [];
const rubricIds = [];
for (let sourceIndex = 0; sourceIndex < 4; sourceIndex += 1) {
  const headingCount = sourceIndex < 2 ? 9 : 8;
  const plan = Array.from(
    { length: headingCount },
    (_unused, headingIndex) => `## Phase ${sourceIndex}-${headingIndex}: coverage only`,
  ).join('\n') + '\n';
  const rubric = '- R1: bounded deliverable acceptance\n';
  const planName = `sources/plan-${sourceIndex}.md`;
  const rubricName = `sources/rubric-${sourceIndex}.md`;
  fs.writeFileSync(path.join(repo, 'docs', planName), plan);
  fs.writeFileSync(path.join(repo, 'docs', rubricName), rubric);
  const planHash = hash(plan);
  const rubricHash = hash(rubric);
  manifest.sources.push({
    plan_path: planName,
    rubric_path: rubricName,
    plan_sha256: planHash,
    rubric_sha256: rubricHash,
  });
  planIds.push(`plan-${planHash}`);
  rubricIds.push(contentBoundRubricId(planHash, rubricHash, 'R1'));
}
fs.writeFileSync(
  path.join(repo, 'docs', 'sources.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
function graphNode(index) {
  return {
    id: `deliverable-${index}`,
    source_plan_ids: [planIds[index]],
    source_rubric_ids: [rubricIds[index]],
    dependencies: [],
    acceptance_ids: [`accept-${index}`],
    verification_commands: [`verify-${index}`],
    gate_attempt_budget: 1,
    reservation: {
      campaigns: 1,
      wall_seconds: 100,
      tool_calls: 10,
      engine_attempts: 2,
      external_wait_seconds: 5,
      canonical_changed_files: 10,
      output_bytes: 1000,
    },
    campaign: {
      profile: 'poc',
      allowed_path_prefixes: ['docs'],
      max_changed_files: 1,
      baseline_churn: 10,
      max_growth_ratio: 1.5,
      max_extra_churn: 5,
      max_repair_generations: 0,
      max_wall_seconds: 100,
      spec: { path: `docs/sources/plan-${index}.md`, section: `Phase ${index}-0: coverage only` },
      required_paths: [`docs/sources/plan-${index}.md`],
      output_paths: [`docs/output-${index}.txt`],
    },
  };
}
const graphPath = path.join(repo, 'docs', 'graph.json');
const boundedGraph = {
  schema_version: 1,
  artifact_type: 'mission_execution_graph',
  nodes: [0, 1, 2, 3].map(graphNode),
};
fs.writeFileSync(graphPath, `${JSON.stringify(boundedGraph, null, 2)}\n`);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'mission-routing@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'Mission Routing Oracle']);
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'synthetic mission sources']);
const compressed = admitMissionRouting({ repoRoot: repo, entryLevel: 'l6' });
assert.equal(compressed.admission.source_authoring_unit_count, 34);
assert.equal(compressed.admission.deliverable_count, 4);

const checkerModulePath = require.resolve(path.join(root, 'scripts/mission-execution-graph-check'));
const routingModulePath = require.resolve(path.join(root, 'scripts/mission-routing-admission'));
const checkerModule = require(checkerModulePath);
const originalInspect = checkerModule.inspect;
checkerModule.inspect = (options) => ({
  ...originalInspect(options),
  policy_digest: hash('policy changed during admission'),
});
delete require.cache[routingModulePath];
const driftAwareAdmission = require(routingModulePath).admitMissionRouting;
assert.throws(
  () => driftAwareAdmission({ repoRoot: repo, entryLevel: 'l3' }),
  (error) => error.code === 'MISSION_POLICY_DRIFT',
);
checkerModule.inspect = originalInspect;
delete require.cache[routingModulePath];

let effects = 0;
const oversized = clone(boundedGraph);
oversized.nodes = Array.from({ length: 34 }, (_unused, index) => ({
  ...clone(boundedGraph.nodes[0]),
  id: `phase-${index}`,
}));
fs.writeFileSync(graphPath, `${JSON.stringify(oversized, null, 2)}\n`);
assert.throws(
  () => admitMissionRouting({
    repoRoot: repo,
    entryLevel: 'l3',
    effect: () => { effects += 1; },
  }),
  /34 deliverables; policy allows 4/,
);
assert.equal(effects, 0);
const rejectedMarkerDir = path.join(tmp, 'rejected-markers');
const rejectedMarker = spawnSync(
  process.execPath,
  [
    path.join(root, 'scripts/session-mode.js'),
    'set',
    '--level', 'l6',
    '--repo-root', repo,
  ],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTOPILOT_SESSION_MODE_DIR: rejectedMarkerDir,
      CLAUDE_CODE_SESSION_ID: 'oversized-routing-session',
    },
  },
);
assert.equal(rejectedMarker.status, 2);
assert.match(rejectedMarker.stderr, /34 deliverables; policy allows 4/);
assert.equal(fs.existsSync(rejectedMarkerDir), false);

const deep = clone(boundedGraph);
deep.nodes[1].dependencies = ['deliverable-0'];
deep.nodes[2].dependencies = ['deliverable-1'];
deep.nodes[3].dependencies = ['deliverable-2'];
fs.writeFileSync(graphPath, `${JSON.stringify(deep, null, 2)}\n`);
assert.throws(
  () => admitMissionRouting({
    repoRoot: repo,
    entryLevel: 'l4',
    effect: () => { effects += 1; },
  }),
  /max_graph_depth/,
);
assert.equal(effects, 0);

const overspent = clone(boundedGraph);
overspent.nodes[0].reservation.tool_calls = 11;
fs.writeFileSync(graphPath, `${JSON.stringify(overspent, null, 2)}\n`);
assert.throws(
  () => admitMissionRouting({
    repoRoot: repo,
    entryLevel: 'l5',
    fallback: 'solo',
    effect: () => { effects += 1; },
  }),
  /aggregate tool_calls reservation exceeds/,
);
assert.equal(effects, 0);

governance.mission_convergence.enforcement_mode = 'shadow';
fs.writeFileSync(governancePath, `${JSON.stringify(governance, null, 2)}\n`);
const shadow = admitMissionRouting({
  repoRoot: repo,
  entryLevel: 'l6',
  fallback: 'precondition_failed',
  effect: () => { effects += 1; return 'shadow-effect'; },
});
assert.equal(shadow.status, 'SHADOW');
assert.equal(shadow.admitted, false);
assert.equal(shadow.would_block, true);
assert.equal(shadow.admission, null);
assert.equal(shadow.effect_result, 'shadow-effect');
assert.equal(effects, 1);

delete governance.mission_convergence;
fs.writeFileSync(governancePath, `${JSON.stringify(governance, null, 2)}\n`);
fs.unlinkSync(path.join(repo, '.claude', 'mission-routing-config.json'));
const legacy = admitMissionRouting({
  repoRoot: repo,
  entryLevel: 'l3',
  effect: () => { effects += 1; return 'legacy-effect'; },
});
assert.equal(legacy.status, 'LEGACY');
assert.equal(legacy.admission, null);
assert.equal(legacy.effect_result, 'legacy-effect');
assert.equal(effects, 2);

const repoBootstrap = fs.readFileSync(path.join(root, '.claude', 'dev-flow-config.md'), 'utf8');
const admissionOffset = repoBootstrap.indexOf('node scripts/mission-routing-admission.js');
const branchOffset = repoBootstrap.indexOf('git checkout -b');
assert.ok(admissionOffset >= 0 && branchOffset > admissionOffset);
assert.doesNotMatch(repoBootstrap, /Phases \(extracted from plan\)/);

console.log(JSON.stringify({
  route_matrix_one_admission: true,
  marker_bypass_rejected: true,
  marker_projection_binding: true,
  policy_drift_rejected: true,
  repo_bootstrap_admission_first: true,
  headings_34_deliverables_4: true,
  oversized_effect_count: 0,
  oversized_marker_effect_count: 0,
  depth_effect_count: 0,
  reservation_effect_count: 0,
  shadow_honest: true,
  legacy_compatible: true,
}));
NODE
)"
EXIT=$?

assert_exit_code "$EXIT" "0" "Mission routing admission matrix passes"
assert_contains "$OUT" '"route_matrix_one_admission":true' "L3-L6 and fallback reuse one admission"
assert_contains "$OUT" '"marker_bypass_rejected":true' "corrupt and expired markers cannot bypass admission"
assert_contains "$OUT" '"marker_projection_binding":true' "marker projection binds exact repo, policy, and graph identity"
assert_contains "$OUT" '"policy_drift_rejected":true' "mid-admission policy drift rejects before effects"
assert_contains "$OUT" '"repo_bootstrap_admission_first":true' "repo bootstrap admits Mission before branch creation"
assert_contains "$OUT" '"headings_34_deliverables_4":true' "34 source headings compress into four deliverables"
assert_contains "$OUT" '"oversized_effect_count":0' "34-node graph rejects before effects"
assert_contains "$OUT" '"oversized_marker_effect_count":0' "34-node graph rejects before session marker effects"
assert_contains "$OUT" '"depth_effect_count":0' "critical-path overflow rejects before effects"
assert_contains "$OUT" '"reservation_effect_count":0' "aggregate reservation overflow rejects before effects"
assert_contains "$OUT" '"shadow_honest":true' "shadow reports would-block without claiming authority"
assert_contains "$OUT" '"legacy_compatible":true' "off mode preserves legacy behavior"

# Executable mission delta admission (output path / create / mirror / replay / no-op).
DELTA_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const [root] = process.argv.slice(2);
const { admitExecutableMissionDelta } = require(path.join(root, 'src/engine/controller-execution'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-delta-'));
fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'src', 'exists.js'), 'ok\n');
fs.writeFileSync(path.join(tmp, 'src', 'required.js'), 'req\n');

// Typo / nonexistent required path without create auth.
const typo = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/does-not-exist.js'],
  outputPaths: ['src/exists.js'],
});
assert.strictEqual(typo.ok, false);
assert.ok(typo.reasons.some((r) => r.code === 'REQUIRED_PATH_MISSING'));

// Missing create authority in strict mode.
const missingCreate = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/new-output.js'],
  strictOutputCreates: true,
});
assert.strictEqual(missingCreate.ok, false);
assert.ok(missingCreate.reasons.some((r) => r.code === 'OUTPUT_MISSING_CREATE_AUTH'));

// Explicit create authority accepts absent output.
const withCreate = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/new-output.js'],
  authorizedCreates: ['src/new-output.js'],
  strictOutputCreates: true,
});
assert.strictEqual(withCreate.ok, true);

// Version mirror incomplete without generator.
const mirror = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/plugin.json'],
  versionMirrorPaths: ['src/plugin.json'],
  versionMirrorGenerator: null,
});
assert.strictEqual(mirror.ok, false);
assert.ok(mirror.reasons.some((r) => r.code === 'VERSION_MIRROR_GENERATOR_MISSING'));

const mirrorOk = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/plugin.json'],
  versionMirrorPaths: ['src/plugin.json'],
  versionMirrorGenerator: 'scripts/sync-version.js',
});
assert.strictEqual(mirrorOk.ok, true);

// Historical replay rejected without no-op binding.
const hist = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/exists.js'],
  historicalOutputs: { 'src/exists.js': 'ok\n' },
  currentBytesByPath: { 'src/exists.js': 'ok\n' },
});
assert.strictEqual(hist.ok, false);
assert.ok(hist.reasons.some((r) => r.code === 'HISTORICAL_OUTPUT_REPLAY'));

// Digest-bound no-op adoption spends zero attempts.
const noop = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/exists.js'],
  baseSha: 'a'.repeat(40),
  noOpReceipt: {
    base_sha: 'a'.repeat(40),
    acceptance_digest: 'b'.repeat(64),
    current_bytes: { 'src/exists.js': 'ok\n' },
  },
});
assert.strictEqual(noop.ok, true);
assert.strictEqual(noop.noop, true);
assert.strictEqual(noop.dispatcher_called, false);
assert.strictEqual(noop.mutation_attempts, 0);
assert.strictEqual(noop.gate_attempts, 0);

// Narrow required-change set accepted.
const narrow = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/required.js'],
  outputPaths: ['src/exists.js'],
});
assert.strictEqual(narrow.ok, true);
assert.strictEqual(narrow.narrow_required_ok, true);

console.log(JSON.stringify({
  typo_rejected: true,
  missing_create_rejected: true,
  create_accepted: true,
  version_mirror_gated: true,
  historical_replay_rejected: true,
  noop_zero_spend: true,
  narrow_required_ok: true,
}));
NODE
)"
assert_exit_code "$?" "0" "executable mission delta matrix exits zero"
assert_contains "$DELTA_OUT" '"typo_rejected":true' "typo/missing required rejected"
assert_contains "$DELTA_OUT" '"missing_create_rejected":true' "missing create authority rejected"
assert_contains "$DELTA_OUT" '"create_accepted":true' "authorized create accepted"
assert_contains "$DELTA_OUT" '"version_mirror_gated":true' "version mirror generator gated"
assert_contains "$DELTA_OUT" '"historical_replay_rejected":true' "historical replay rejected"
assert_contains "$DELTA_OUT" '"noop_zero_spend":true' "no-op adoption zero spend"
assert_contains "$DELTA_OUT" '"narrow_required_ok":true' "narrow required set accepted"

finalize_test
