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
      // Absent outputs require explicit create authority under Mission admission.
      authorized_creates: [`docs/output-${index}.txt`],
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

// Missing create authority — Mission default is strict (absent outputs need creates).
const missingCreate = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/new-output.js'],
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
});
assert.strictEqual(withCreate.ok, true);

// Version mirror incomplete without generator.
const mirror = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js'],
  outputPaths: ['src/plugin.json'],
  authorizedCreates: ['src/plugin.json'],
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
  authorizedCreates: ['src/plugin.json'],
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

const baseSha = 'a'.repeat(40);
const acceptance = 'b'.repeat(64);
const liveBytes = { 'src/exists.js': 'ok\n', 'src/required.js': 'req\n' };
// Mismatched no-op bytes reject (must not accept shape-only receipts).
const noopMismatch = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js', 'src/required.js'],
  outputPaths: ['src/exists.js'],
  baseSha,
  currentBytesByPath: liveBytes,
  noOpReceipt: {
    base_sha: baseSha,
    acceptance_digest: acceptance,
    current_bytes: { 'src/exists.js': 'WRONG\n', 'src/required.js': 'req\n' },
  },
});
assert.strictEqual(noopMismatch.ok, false);
assert.ok(noopMismatch.reasons.some((r) => r.code === 'NOOP_BYTES_MISMATCH'));

// Digest-bound no-op adoption spends zero attempts when bytes bind exactly.
const noop = admitExecutableMissionDelta({
  repoRoot: tmp,
  allowedPathPrefixes: ['src'],
  requiredPaths: ['src/exists.js', 'src/required.js'],
  outputPaths: ['src/exists.js'],
  baseSha,
  currentBytesByPath: liveBytes,
  noOpReceipt: {
    base_sha: baseSha,
    acceptance_digest: acceptance,
    current_bytes: liveBytes,
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

# Production admitMissionRouting path: version-mirror closure + historical replay.
E2E_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const {
  admitMissionRouting,
  CANONICAL_VERSION_MIRROR_CLOSURE,
  CANONICAL_VERSION_MIRROR_GENERATOR,
  verifyVersionMirrorClosure,
} = require(path.join(root, 'scripts/mission-routing-admission'));
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));

// Complete sync-version closure required — caller-chosen subsets fail closed.
assert.equal(
  verifyVersionMirrorClosure(
    [...CANONICAL_VERSION_MIRROR_CLOSURE],
    CANONICAL_VERSION_MIRROR_GENERATOR,
  ).ok,
  true,
);
assert.equal(
  verifyVersionMirrorClosure(
    [CANONICAL_VERSION_MIRROR_CLOSURE[0]],
    CANONICAL_VERSION_MIRROR_GENERATOR,
  ).ok,
  false,
);
assert.equal(
  verifyVersionMirrorClosure(['src/not-a-mirror.js'], CANONICAL_VERSION_MIRROR_GENERATOR).ok,
  false,
);
assert.equal(
  verifyVersionMirrorClosure([CANONICAL_VERSION_MIRROR_CLOSURE[0]], null).ok,
  false,
);

// Build a tiny enforceable repo and graph that declares a version mirror wrongly.
const repo = path.join(tmp, 'e2e-mission-repo');
fs.mkdirSync(path.join(repo, 'docs', 'sources'), { recursive: true });
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
fs.writeFileSync(path.join(repo, 'docs', 'sources', 'plan-0.md'), '# Phase 0-0: coverage only\n');
const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude/owner-kernel-governance.json'), 'utf8'));
gov.mission_convergence = {
  schema_version: 1,
  enforcement_mode: 'enforce',
  max_campaigns: 8,
  max_wall_seconds: 7200,
  max_tool_calls: 1000,
  max_engine_attempts: 100,
  max_external_wait_seconds: 600,
  max_canonical_changed_files: 100,
  max_output_bytes: 1000000,
  max_deliverables: 8,
  max_parallel: 3,
  max_batches: 4,
  max_graph_depth: 4,
  max_gate_attempts: 16,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(path.join(repo, '.claude', 'owner-kernel-governance.json'), `${JSON.stringify(gov, null, 2)}\n`);
// Minimal sources + graph via routing config would need full inspect pipeline.
// Directly exercise validateExecutableDeltaAtAdmission through admitExecutableMissionDelta
// with production mirror helpers already covered above.
// Historical replay on production path: sealed historical evidence file.
const histPath = path.join(tmp, 'hist-evidence.json');
const outputs = { 'docs/sources/plan-0.md': '# Phase 0-0: coverage only\n' };
const histBody = { outputs };
const hist = { outputs, digest: sha256(canonicalJson(histBody)) };
fs.writeFileSync(histPath, `${JSON.stringify(hist)}\n`);

const { validateExecutableDeltaAtAdmission } = require(path.join(root, 'scripts/mission-routing-admission'));
// Graph with version_mirror_paths outside canonical closure must reject.
assert.throws(() => {
  validateExecutableDeltaAtAdmission(repo, {
    nodes: [{
      id: 'n1',
      campaign: {
        allowed_path_prefixes: ['docs'],
        required_paths: ['docs/sources/plan-0.md'],
        output_paths: ['docs/sources/plan-0.md'],
        version_mirror_paths: ['docs/not-a-version-mirror.md'],
        version_mirror_generator: CANONICAL_VERSION_MIRROR_GENERATOR,
        authorized_creates: [],
      },
    }],
  }, { baseSha: 'a'.repeat(40) });
}, (e) => e.code === 'MISSION_GRAPH_DELTA_INVALID');

// Historical replay without no-op rejects on the real validation rail.
assert.throws(() => {
  validateExecutableDeltaAtAdmission(repo, {
    nodes: [{
      id: 'n1',
      campaign: {
        allowed_path_prefixes: ['docs'],
        required_paths: ['docs/sources/plan-0.md'],
        output_paths: ['docs/sources/plan-0.md'],
        authorized_creates: [],
      },
    }],
  }, {
    baseSha: 'a'.repeat(40),
    historicalEvidencePath: histPath,
    allowTestCallerEvidence: true,
  });
}, (e) => /HISTORICAL_OUTPUT_REPLAY|executable delta rejected/i.test(e.message));

// Bound no-op with sealed receipt spends zero attempts.
const noopBody = {
  base_sha: 'a'.repeat(40),
  acceptance_digest: 'b'.repeat(64),
  current_bytes: { 'docs/sources/plan-0.md': '# Phase 0-0: coverage only\n' },
};
const noop = { ...noopBody, digest: sha256(canonicalJson(noopBody)) };
const noopPath = path.join(tmp, 'noop-receipt.json');
fs.writeFileSync(noopPath, `${JSON.stringify(noop)}\n`);
// Should not throw when no-op is bound.
validateExecutableDeltaAtAdmission(repo, {
  nodes: [{
    id: 'n1',
    campaign: {
      allowed_path_prefixes: ['docs'],
      required_paths: ['docs/sources/plan-0.md'],
      output_paths: ['docs/sources/plan-0.md'],
      authorized_creates: [],
    },
  }],
}, {
  baseSha: 'a'.repeat(40),
  historicalEvidencePath: histPath,
  noopReceiptPath: noopPath,
  allowTestCallerEvidence: true,
});

console.log(JSON.stringify({
  version_mirror_closure_real: true,
  historical_replay_real_rail: true,
  noop_bound_real_rail: true,
}));
NODE
)"
assert_exit_code "$?" "0" "production Mission admission rail matrix exits zero"
assert_contains "$E2E_OUT" '"version_mirror_closure_real":true' "version mirror closure on real rail"
assert_contains "$E2E_OUT" '"historical_replay_real_rail":true' "historical replay on real rail"
assert_contains "$E2E_OUT" '"noop_bound_real_rail":true' "bound no-op on real rail"

# Ordinary production no-op + session-mode + registry-only historical rejection.
enable_legacy_scorecard_test_projection
ORDINARY_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const {
  admitMissionRouting,
  loadDurableMissionEvidence,
} = require(path.join(root, 'scripts/mission-routing-admission'));
const {
  contentBoundRubricId,
} = require(path.join(root, 'scripts/mission-execution-graph-check'));
const {
  freezeMissionExecutionGraph,
} = require(path.join(root, 'src', 'engine', 'mission-execution-graph'));
const { sha256, canonicalJson } = require(path.join(root, 'src/engine/owner-kernel/canonical'));
const wo = require(path.join(root, 'src/engine/work-order'));
const ctrl = require(path.join(root, 'src/engine/controller-execution'));
const mission = require(path.join(root, 'src/engine/mission-convergence'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const {
  campaignIdFor,
} = require(path.join(root, 'src/engine/implementation-campaign'));
const {
  AutopilotEngine,
} = require(path.join(root, 'src/engine/autopilot-engine'));
const {
  buildMissionZeroDiffReceipt,
  deriveCampaignDispatchUnit,
} = require(path.join(root, 'src/engine/campaign-dispatch-projection'));

const repo = path.join(tmp, 'ordinary-noop-repo');
const dispatchModel = 'Gemini 3.5 Flash (High)';
fs.mkdirSync(path.join(repo, 'docs', 'sources'), { recursive: true });
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
execFileSync('git', ['-C', repo, 'init', '-q']);
execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
fs.writeFileSync(path.join(repo, '.claude', 'review-loop-config.md'), [
  `- implementer_engine: ${dispatchModel}`,
  '- implementer_effort: high',
  '- implementer_runner: agy',
  '- implementer_endpoint:',
].join('\n') + '\n');
const scoreDir = path.join(tmp, 'ordinary-engine-scores');
const capabilityDir = path.join(tmp, 'ordinary-engine-capabilities');
fs.mkdirSync(scoreDir, { recursive: true });
fs.mkdirSync(capabilityDir, { recursive: true });
const engineScorePath = path.join(tmp, 'ordinary-engine-score.json');
const engineCapabilityPath = path.join(tmp, 'ordinary-engine-capability.json');
fs.writeFileSync(engineScorePath, `${JSON.stringify({
  engine: dispatchModel,
  runner: 'agy',
  family: 'google',
  role: 'implementer',
  model_version: 'fixture-v1',
  version_source: 'manual',
  corpus_version: 'fixture@1',
  harness_version: 'dispatch-hetero@fixture',
  runner_version: 'agy fixture',
  prompt_config_hash: 'sha256:fixture',
  date: '2026-07-30',
  quality: { corpus_pass: '10/10', false_pass_critical: 0, specificity: '3/3' },
  capability_score: 0.9,
  cost: {
    source: 'manual',
    usd_per_mtok_input: 0,
    usd_per_mtok_output: 0,
    sample_tokens: 0,
  },
  latency: { sample_wall_time_s: 0 },
  status: 'qualified',
  qualified_at: '2026-07-30',
  expires: '2099-01-01',
}, null, 2)}\n`);
fs.writeFileSync(engineCapabilityPath, `${JSON.stringify({
  schema_version: 1,
  observed_at: new Date().toISOString(),
  runner: 'agy',
  model: dispatchModel,
  role: 'implementer',
  effort: 'high',
  endpoint: null,
  runner_version: 'agy fixture',
  capability: {
    quota: {
      status: 'available',
      confidence: 'high',
      ttl_seconds: 3600,
      reset_at: null,
      evidence: 'fixture',
    },
  },
}, null, 2)}\n`);
process.env.ENGINE_SCORECARD_DIR = scoreDir;
process.env.ENGINE_CAPABILITY_DIR = capabilityDir;
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-scorecard.js'),
  'record',
  '--file',
  engineScorePath,
], { env: process.env, stdio: 'ignore' });
execFileSync(process.execPath, [
  path.join(root, 'scripts', 'engine-capability-state.js'),
  'record',
  '--file',
  engineCapabilityPath,
], { env: process.env, stdio: 'ignore' });
const planBody = '# Phase 0-0: ordinary noop coverage\n';
const rubricBody = '- R1: exact ordinary no-op authority\n';
const planBodyN2 = '# Phase 0-1: ordinary remaining coverage\n';
const rubricBodyN2 = '- R2: exact one-of-many authority\n';
fs.writeFileSync(path.join(repo, 'docs', 'sources', 'plan-0.md'), planBody);
fs.writeFileSync(path.join(repo, 'docs', 'sources', 'rubric-0.md'), rubricBody);
fs.writeFileSync(path.join(repo, 'docs', 'sources', 'plan-1.md'), planBodyN2);
fs.writeFileSync(path.join(repo, 'docs', 'sources', 'rubric-1.md'), rubricBodyN2);
const planDigest = sha256(planBody);
const rubricDigest = sha256(rubricBody);
const planId = `plan-${planDigest}`;
const rubricId = contentBoundRubricId(planDigest, rubricDigest, 'R1');
const planDigestN2 = sha256(planBodyN2);
const rubricDigestN2 = sha256(rubricBodyN2);
const planIdN2 = `plan-${planDigestN2}`;
const rubricIdN2 = contentBoundRubricId(planDigestN2, rubricDigestN2, 'R2');

// One canonical graph is consumed by both the Mission runtime and ordinary
// routing/session admission. No manually authored registry/state/journal.
const graph = {
  schema_version: 1,
  artifact_type: 'mission_execution_graph',
  nodes: ['n1', 'n2'].map((id, index) => ({
    id,
    source_plan_ids: [index === 0 ? planId : planIdN2],
    source_rubric_ids: [index === 0 ? rubricId : rubricIdN2],
    dependencies: index === 0 ? [] : ['n1'],
    acceptance_ids: [`ordinary-noop-ready-${id}`],
    verification_commands: ['true'],
    // Initial review generation + one allowed repair generation.
    gate_attempt_budget: 2,
    reservation: {
      campaigns: 1,
      wall_seconds: 100,
      tool_calls: 3,
      engine_attempts: 2,
      external_wait_seconds: 0,
      canonical_changed_files: 1,
      output_bytes: 1024,
    },
    campaign: {
      profile: 'poc',
      allowed_path_prefixes: ['docs'],
      max_changed_files: 1,
      baseline_churn: 10,
      max_growth_ratio: 1.5,
      max_extra_churn: 5,
      max_repair_generations: 1,
      max_wall_seconds: 100,
      spec: {
        path: `docs/sources/plan-${index}.md`,
        section: index === 0
          ? 'Phase 0-0: ordinary noop coverage'
          : 'Phase 0-1: ordinary remaining coverage',
      },
      required_paths: [`docs/sources/plan-${index}.md`],
      output_paths: [`docs/sources/plan-${index}.md`],
    },
  })),
};
const govSrc = path.join(root, '.claude', 'owner-kernel-governance.json');
const gov = JSON.parse(fs.readFileSync(govSrc, 'utf8'));
const policy = {
  schema_version: 1,
  enforcement_mode: 'enforce',
  max_campaigns: 4,
  max_wall_seconds: 400,
  max_tool_calls: 20,
  max_engine_attempts: 8,
  max_external_wait_seconds: 10,
  max_canonical_changed_files: 4,
  max_output_bytes: 4096,
  max_deliverables: 2,
  max_parallel: 1,
  max_batches: 2,
  max_graph_depth: 2,
  max_gate_attempts: 4,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
const frozenGraph = freezeMissionExecutionGraph(graph, policy);
const canonicalGraph = frozenGraph.graph;
gov.mission_convergence = policy;
fs.writeFileSync(path.join(repo, '.claude', 'owner-kernel-governance.json'),
  `${JSON.stringify(gov, null, 2)}\n`);
fs.writeFileSync(path.join(repo, '.claude', 'mission-routing-config.json'),
  `${JSON.stringify({
    schema_version: 1,
    graph_path: 'docs/graph.json',
    sources_path: 'docs/sources.json',
  }, null, 2)}\n`);
fs.writeFileSync(
  path.join(repo, 'docs', 'graph.json'),
  `${JSON.stringify(canonicalGraph, null, 2)}\n`,
);
fs.writeFileSync(path.join(repo, 'docs', 'sources.json'), `${JSON.stringify({
  schema_version: 1,
  sources: [
    {
      plan_path: 'sources/plan-0.md',
      rubric_path: 'sources/rubric-0.md',
      plan_sha256: planDigest,
      rubric_sha256: rubricDigest,
    },
    {
      plan_path: 'sources/plan-1.md',
      rubric_path: 'sources/rubric-1.md',
      plan_sha256: planDigestN2,
      rubric_sha256: rubricDigestN2,
    },
  ],
}, null, 2)}\n`);
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'init']);
const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const common = wo.resolveGitCommonDir(repo);
assert.ok(common);

// Canonical TaskAuthority → prepare → grant → terminal reconciliation.
const repoIdentity = `git-common-dir:${common}`;
const policyDig = sha256(canonicalJson(policy));
const graphDig = frozenGraph.graph_digest;
const intent = {
  objective: 'prove ordinary producer-to-dispatch no-op',
  requirements_hash: sha256('ordinary-noop-requirements'),
  scope: {
    task_classes: ['implementation'],
    domains: ['autopilot'],
    languages: ['javascript'],
    allowed_tools: ['git'],
    artifact_roots: ['docs'],
  },
};
const acceptance = {
  contract_hash: sha256('ordinary-noop-contract'),
  criteria_hash: sha256('ordinary-noop-criteria'),
  required_evidence: ['tests'],
};
const adoptionBinding = {
  repo_identity: repoIdentity,
  intent,
  initial_required_acceptance_hashes: [
    acceptance.contract_hash,
    acceptance.criteria_hash,
  ].sort(),
};
const adoptionKey = sha256(canonicalJson(adoptionBinding));
const lineage = `lineage-v1-${adoptionKey}`;
const authority = {
  schema_version: 1,
  task_id: 'ordinary-noop-task',
  task_authority_id: sha256('ordinary-noop-task-authority'),
  policy_hash: sha256('ordinary-noop-owner-policy'),
  authority_status: 'shadow',
  intent,
  acceptance,
  mission_lineage_id: lineage,
  mission_policy_digest: policyDig,
  mission_graph_digest: graphDig,
};
const dependencies = {
  resolveMissionPolicy: () => ({ policy, policy_digest: policyDig }),
  freezeMissionExecutionGraph: () => ({
    graph: canonicalGraph,
    graph_digest: graphDig,
    calculated_depth: frozenGraph.calculated_depth,
    calculated_batches: frozenGraph.calculated_batches,
  }),
  deriveMissionAdoptionKey: (binding) => sha256(canonicalJson(binding)),
  deriveMissionLineageId: (binding) => `lineage-v1-${sha256(canonicalJson(binding))}`,
};
process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';
const prepared = runtime.prepareMissionRuntimeForTest({
  repo,
  taskAuthority: authority,
  authoritativeGovernance: gov,
  executionGraph: canonicalGraph,
  preparedAt: '2026-07-30T00:00:00.000Z',
}, dependencies);
const grant = runtime.grantMissionCampaign({
  repo,
  preparedReceipt: prepared.receipt,
  nodeId: 'n1',
  now: '2026-07-30T00:00:01.000Z',
});
const campaignBytes = fs.readFileSync(grant.contract_path);
const strictContractDigest = crypto.createHash('sha256').update(campaignBytes).digest('hex');
const campaignContract = JSON.parse(campaignBytes.toString('utf8'));
const iccId = campaignIdFor(repoIdentity, campaignContract.ticket, strictContractDigest);
const store = runtime.openPreparedMissionStateStore({
  repo,
  preparedReceipt: prepared.receipt,
});
const reconciled = runtime.reconcileMissionCampaignTerminal({
  store,
  grantRef: grant.mission_grant_ref,
  claimId: grant.claim_id,
  iccCampaignId: iccId,
  rawCampaignContractDigest: strictContractDigest,
  outcome: 'ready',
  possiblyEffectful: true,
  observedAt: '2026-07-30T00:00:02.000Z',
});
assert.strictEqual(reconciled.status, 'applied');
const term = reconciled.receipt;
const state = store.load();
mission.validateMissionState(state);
const claim = state.claims[grant.claim_id];
assert.ok(claim && claim.terminal === true && claim.reconciled === true);

const missionRoot = path.join(common, 'autopilot', 'mission');
const journalPath = path.join(
  missionRoot,
  'journals',
  adoptionKey,
  `${grant.claim_id}.applied.json`,
);
assert.deepStrictEqual(JSON.parse(fs.readFileSync(journalPath, 'utf8')), term);
const acceptanceDigest = sha256('ordinary-noop-acceptance');
const verificationDigest = sha256('ordinary-noop-verification');
const evidenceBinding = {
  repo_identity: repoIdentity,
  mission_lineage_id: state.mission_lineage_id,
  mission_policy_digest: state.mission_policy_digest,
  mission_graph_digest: state.mission_graph_digest,
  graph_node_id: claim.graph_node_id,
  graph_attempt: claim.graph_attempt,
  mission_claim_id: claim.claim_id,
  mission_campaign_id: claim.campaign_id,
  icc_campaign_id: iccId,
  campaign_contract_digest: claim.campaign_contract_digest,
  strict_contract_digest: strictContractDigest,
  base_sha: claim.base_sha,
  acceptance_digest: acceptanceDigest,
  verification_digest: verificationDigest,
};
const historical = ctrl.buildHistoricalOutputsAtCommit({
  gitCwd: repo,
  acceptedCommit: baseSha,
  paths: ['docs/sources/plan-0.md'],
  binding: evidenceBinding,
});
const histRecord = historical.record;
const histDigest = historical.digest;
const pathDig = historical.outputs['docs/sources/plan-0.md'];
const noop = ctrl.buildNoOpReceipt({
  baseSha,
  acceptanceDigest,
  pathByteDigests: historical.outputs,
  binding: {
    ...evidenceBinding,
    accepted_commit: baseSha,
  },
});
const noopCanonicalBody = { ...noop };
delete noopCanonicalBody.digest;
assert.strictEqual(
  noop.digest,
  sha256(canonicalJson(noopCanonicalBody)),
  'producer receipt must use the production loader canonical digest',
);
const frozen = ctrl.buildFrozenDenominator({
  projectId: campaignContract.mission_runtime.root_run_id,
  graphDigest: graphDig,
  deliverableIds: ['n1', 'n2'],
  nodeId: 'n1',
});
const ctrlState = ctrl.emptyControllerState({
  frozen_denominator: frozen,
  historical_outputs: histRecord,
  historical_outputs_digest: histDigest,
  noop_receipt: noop,
  completed_deliverables: ['n1'],
  phase: 'COMPLETED',
  next_action: 'terminal',
  accepted_commit: baseSha,
});

// Exact consumed-success Work Order: real durable/checkpoint bytes plus the
// exact L6 terminal receipt file required by the production classifier.
const authorityDir = path.join(tmp, 'ordinary-noop-authority');
fs.mkdirSync(authorityDir, { recursive: true });
const durablePath = path.join(authorityDir, 'controller-durable.json');
const checkpointPath = path.join(authorityDir, 'controller-checkpoint.json');
const terminalPath = path.join(authorityDir, 'controller-terminal.json');
fs.writeFileSync(durablePath, `${JSON.stringify(ctrlState, null, 2)}\n`);
fs.writeFileSync(checkpointPath, `${JSON.stringify({
  controller_digest: ctrlState.controller_digest,
  mission_terminal_receipt_digest: term.receipt_digest,
}, null, 2)}\n`);
const workOrderId = `wo-${iccId}-n1-a1`;
const controllerTerminal = wo.buildControllerTerminalReceipt({
  terminalStatus: 'success',
  rootRunId: iccId,
  workOrderId,
  graphNode: 'n1',
  campaignId: iccId,
  acceptedCommit: baseSha,
  controller: ctrlState,
  issuedAt: '2026-07-30T00:00:00.000Z',
});
fs.writeFileSync(terminalPath, `${JSON.stringify(controllerTerminal, null, 2)}\n`);
const activeWritten = wo.createOrUpdateWorkOrder(common, {
  root_run_id: iccId,
  graph_node: 'n1',
  attempt: 1,
  role: 'controller',
  next_action: 'continue',
  branch: 'main',
  base_sha: baseSha,
  worktree: repo,
  paths: {
    durable: durablePath,
    checkpoint: checkpointPath,
    receipt: terminalPath,
  },
  controller: ctrlState,
}, { bindArtifacts: true });
assert.strictEqual(activeWritten.status, 'written', JSON.stringify(activeWritten));
const written = wo.updateWorkOrderLifecycle(common, {
  path: activeWritten.path,
}, {
  next_action: 'terminal',
  expected_receipt: {
    path: terminalPath,
    digest: controllerTerminal.digest,
  },
  terminal_status: 'success',
  disposition: 'consumed',
  accepted_commit: baseSha,
}, {
  expectedGeneration: activeWritten.work_order.generation,
  expectedCasToken: activeWritten.work_order.cas_token,
  expectedControllerDigest: activeWritten.work_order.controller.controller_digest,
  bindArtifacts: true,
  preserveOwner: true,
  gitCwd: repo,
});
assert.strictEqual(written.status, 'written');
assert.strictEqual(
  wo.classifyWorkOrder(written.work_order, {
    gitCwd: repo,
    workOrderPath: written.path,
    requireBoundEvidence: true,
  }).classification,
  'consume_terminal',
);

// loadDurableMissionEvidence ordinary registry path (no allowTestCallerEvidence).
const loaded = loadDurableMissionEvidence(repo, {
  enforceEvidence: true,
  missionGraphDigest: graphDig,
  missionPolicyDigest: policyDig,
  missionLineageId: lineage,
  graphNodeId: 'n1',
});
assert.ok(loaded.historicalOutputs);
assert.ok(loaded.noOpReceipt);
assert.strictEqual(loaded.noOpReceipt.dispatcher_called, false);

// Exact no-op via admitExecutableMissionDelta ordinary evidence (not test seams).
const { admitExecutableMissionDelta } = ctrl;
const delta = admitExecutableMissionDelta({
  repoRoot: repo,
  allowedPathPrefixes: ['docs'],
  requiredPaths: ['docs/sources/plan-0.md'],
  outputPaths: ['docs/sources/plan-0.md'],
  authorizedCreates: [],
  historicalOutputs: loaded.historicalOutputs,
  currentBytesByPath: { 'docs/sources/plan-0.md': pathDig },
  noOpReceipt: loaded.noOpReceipt,
  baseSha,
  strictOutputCreates: true,
});
assert.strictEqual(delta.ok, true);
assert.strictEqual(delta.noop, true);
assert.strictEqual(delta.dispatcher_called, false);
assert.strictEqual(delta.mutation_attempts, 0);
assert.strictEqual(delta.gate_attempts, 0);

// Ordinary routing consumes the canonical Mission/WO evidence per node.
const routed = admitMissionRouting({
  repoRoot: repo,
  entryLevel: 'l6',
});
assert.strictEqual(routed.status, 'READY', JSON.stringify(routed));
assert.strictEqual(routed.noop_short_circuit, true, JSON.stringify(routed));
assert.strictEqual(routed.dispatcher_called, null);
assert.strictEqual(routed.mutation_attempts, null);
assert.strictEqual(routed.gate_attempts, null);
assert.strictEqual(routed.resources_created, null);
assert.strictEqual(routed.noop_adoptions.length, 1);
assert.strictEqual(routed.noop_adoptions[0].noop_receipt_digest, noop.digest);

// session-mode seals that exact adoption; dispatch consumes it before runner
// discovery or worktree creation.
const sessionCli = path.join(root, 'scripts/session-mode.js');
const sessDir = path.join(tmp, 'session-markers');
fs.mkdirSync(sessDir, { recursive: true });
const sessionEnv = {
  ...process.env,
  AUTOPILOT_SESSION_MODE_DIR: sessDir,
  CLAUDE_CODE_SESSION_ID: 'ordinary-noop-sess',
};
const sess = spawnSync(process.execPath, [
  sessionCli, 'set', '--level', 'l6', '--repo-root', repo,
], {
  encoding: 'utf8',
  env: sessionEnv,
});
assert.strictEqual(sess.status, 0, sess.stderr || sess.stdout);
const sessBody = JSON.parse(sess.stdout);
assert.strictEqual(sessBody.ok, true);
assert.strictEqual(sessBody.level, 'l6');
assert.strictEqual(sessBody.mission_noop.noop_short_circuit, true);
assert.strictEqual(sessBody.mission_noop.noop_adoptions.length, 1);
assert.strictEqual(sessBody.mission_noop.dispatcher_called, null);
assert.strictEqual(
  sessBody.mission_noop.noop_adoptions[0].noop_receipt_digest,
  noop.digest,
);

const zeroDiffReceipt = buildMissionZeroDiffReceipt({
  missionNoopAdoption: routed.noop_adoptions[0],
  campaignContract,
  campaignContractSha256: strictContractDigest,
  campaignId: iccId,
  branch: grant.branch,
  base: grant.base_sha,
  runner: 'agy',
  model: dispatchModel,
  stage: 'campaign-implementation',
  rootRunId: campaignContract.mission_runtime.root_run_id,
});
const unit = deriveCampaignDispatchUnit({
  campaignContract,
  campaignContractSha256: strictContractDigest,
  campaignId: iccId,
  branch: grant.branch,
  base: grant.base_sha,
  runner: 'agy',
  model: dispatchModel,
  stage: 'campaign-implementation',
  rootRunId: campaignContract.mission_runtime.root_run_id,
  zeroDiffReceipt,
});
const unitPath = path.join(authorityDir, 'dispatch-unit.json');
fs.writeFileSync(unitPath, `${JSON.stringify(unit, null, 2)}\n`);
const promptPath = path.join(authorityDir, 'prompt.txt');
fs.writeFileSync(promptPath, 'this runner must never execute\n');
const runnerSentinel = path.join(authorityDir, 'runner-called');
const runnerStub = path.join(authorityDir, 'runner-stub.sh');
fs.writeFileSync(runnerStub, `#!/usr/bin/env bash
touch "${runnerSentinel}"
exit 99
`);
fs.chmodSync(runnerStub, 0o755);
const worktreesBefore = execFileSync(
  'git',
  ['-C', repo, 'worktree', 'list', '--porcelain'],
  { encoding: 'utf8' },
);
const dispatch = spawnSync('bash', [
  path.join(root, 'scripts', 'dispatch-hetero.sh'),
  '--branch', grant.branch,
  '--base', grant.base_sha,
  '--prompt-file', promptPath,
  '--runner', 'agy',
  '--agy-bin', runnerStub,
  '--model', dispatchModel,
  '--campaign-contract', grant.contract_path,
  '--campaign-contract-sha256', strictContractDigest,
  '--campaign-seal', grant.seal_path,
  '--strict-contract',
  '--contract-file', unitPath,
  '--run-id', iccId,
  '--stage', 'campaign-implementation',
], {
  cwd: repo,
  encoding: 'utf8',
  env: {
    ...sessionEnv,
    AUTOPILOT_PARENT_RUN_ID: 'ordinary-noop-parent',
    AUTOPILOT_ROOT_RUN_ID: campaignContract.mission_runtime.root_run_id,
    AUTOPILOT_DISPATCH_MANIFEST: '0',
  },
});
assert.strictEqual(dispatch.status, 0, `${dispatch.stdout}\n${dispatch.stderr}`);
const dispatchReceipt = JSON.parse(dispatch.stdout);
assert.strictEqual(dispatchReceipt.status, 'no_op');
assert.strictEqual(dispatchReceipt.runner, 'sealed-zero-diff-admission');
assert.strictEqual(dispatchReceipt.dispatcher_called, false);
assert.strictEqual(dispatchReceipt.mutation_attempts, 0);
assert.strictEqual(dispatchReceipt.gate_attempts, 0);
assert.strictEqual(dispatchReceipt.resources_created, 0);
assert.strictEqual(dispatchReceipt.worktree, null);
assert.strictEqual(fs.existsSync(runnerSentinel), false);
assert.strictEqual(
  execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  }),
  worktreesBefore,
);

// Production bridge: ordinary registry/Work Order admission is re-derived by
// Engine, sealed into the projected unit, parsed from the real shell boundary,
// and never invokes the provider runner.
const engineResult = new AutopilotEngine({ cwd: repo }).implementTask({
  promptFile: promptPath,
  branch: grant.branch,
  base: grant.base_sha,
  roster: {
    implementer_engine: dispatchModel,
    implementer_effort: 'high',
    implementer_runner: 'agy',
  },
  runId: iccId,
  implementationRound: 1,
  implementationStage: 'campaign-implementation',
  campaignContractFile: grant.contract_path,
  campaignContractDigest: strictContractDigest,
  campaignSealFile: grant.seal_path,
  extraImplementationArgs: ['--agy-bin', runnerStub],
  implementationOptions: {
    cwd: repo,
    env: {
      ...sessionEnv,
      AUTOPILOT_PARENT_RUN_ID: 'ordinary-noop-engine-parent',
      AUTOPILOT_ROOT_RUN_ID: campaignContract.mission_runtime.root_run_id,
      AUTOPILOT_DISPATCH_MANIFEST: '0',
    },
  },
});
assert.strictEqual(engineResult.status, 'no_op', JSON.stringify(engineResult));
assert.strictEqual(engineResult.phase, 'sealed_zero_diff');
assert.strictEqual(engineResult.dispatcher_called, false);
assert.strictEqual(engineResult.model_calls, 0);
assert.strictEqual(engineResult.implementation.runner, 'sealed-zero-diff-admission');
assert.strictEqual(
  engineResult.implementation.zero_diff_receipt_digest,
  zeroDiffReceipt.digest,
);
assert.strictEqual(fs.existsSync(runnerSentinel), false);
assert.strictEqual(
  execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  }),
  worktreesBefore,
);

// Complete the second canonical node and persist its independently bound
// no-op authority. Only now may the whole admission declare zero dispatch.
const grantN2 = runtime.grantMissionCampaign({
  repo,
  preparedReceipt: prepared.receipt,
  nodeId: 'n2',
  now: '2026-07-30T00:00:03.000Z',
});
const campaignBytesN2 = fs.readFileSync(grantN2.contract_path);
const strictContractDigestN2 = crypto.createHash('sha256')
  .update(campaignBytesN2).digest('hex');
const campaignContractN2 = JSON.parse(campaignBytesN2.toString('utf8'));
const iccIdN2 = campaignIdFor(
  repoIdentity,
  campaignContractN2.ticket,
  strictContractDigestN2,
);
const reconciledN2 = runtime.reconcileMissionCampaignTerminal({
  store,
  grantRef: grantN2.mission_grant_ref,
  claimId: grantN2.claim_id,
  iccCampaignId: iccIdN2,
  rawCampaignContractDigest: strictContractDigestN2,
  outcome: 'ready',
  possiblyEffectful: true,
  observedAt: '2026-07-30T00:00:04.000Z',
});
assert.strictEqual(reconciledN2.status, 'applied');
const termN2 = reconciledN2.receipt;
const stateN2 = store.load();
const claimN2 = stateN2.claims[grantN2.claim_id];
const evidenceBindingN2 = {
  repo_identity: repoIdentity,
  mission_lineage_id: stateN2.mission_lineage_id,
  mission_policy_digest: stateN2.mission_policy_digest,
  mission_graph_digest: stateN2.mission_graph_digest,
  graph_node_id: claimN2.graph_node_id,
  graph_attempt: claimN2.graph_attempt,
  mission_claim_id: claimN2.claim_id,
  mission_campaign_id: claimN2.campaign_id,
  icc_campaign_id: iccIdN2,
  campaign_contract_digest: claimN2.campaign_contract_digest,
  strict_contract_digest: strictContractDigestN2,
  base_sha: claimN2.base_sha,
  acceptance_digest: acceptanceDigest,
  verification_digest: verificationDigest,
};
const historicalN2 = ctrl.buildHistoricalOutputsAtCommit({
  gitCwd: repo,
  acceptedCommit: baseSha,
  paths: ['docs/sources/plan-1.md'],
  binding: evidenceBindingN2,
});
const noopN2 = ctrl.buildNoOpReceipt({
  baseSha,
  acceptanceDigest,
  pathByteDigests: historicalN2.outputs,
  binding: {
    ...evidenceBindingN2,
    accepted_commit: baseSha,
  },
});
const frozenN2 = ctrl.buildFrozenDenominator({
  projectId: campaignContractN2.mission_runtime.root_run_id,
  graphDigest: graphDig,
  deliverableIds: ['n1', 'n2'],
  nodeId: 'n1',
});
assert.strictEqual(frozenN2.digest, frozen.digest);
const ctrlStateN2 = ctrl.emptyControllerState({
  frozen_denominator: frozenN2,
  historical_outputs: historicalN2.record,
  historical_outputs_digest: historicalN2.digest,
  noop_receipt: noopN2,
  completed_deliverables: ['n1', 'n2'],
  phase: 'COMPLETED',
  next_action: 'terminal',
  accepted_commit: baseSha,
});
const authorityDirN2 = path.join(tmp, 'ordinary-noop-authority-n2');
fs.mkdirSync(authorityDirN2, { recursive: true });
const durablePathN2 = path.join(authorityDirN2, 'controller-durable.json');
const checkpointPathN2 = path.join(authorityDirN2, 'controller-checkpoint.json');
const terminalPathN2 = path.join(authorityDirN2, 'controller-terminal.json');
fs.writeFileSync(durablePathN2, `${JSON.stringify(ctrlStateN2, null, 2)}\n`);
fs.writeFileSync(checkpointPathN2, `${JSON.stringify({
  controller_digest: ctrlStateN2.controller_digest,
  mission_terminal_receipt_digest: termN2.receipt_digest,
}, null, 2)}\n`);
const workOrderIdN2 = `wo-${iccIdN2}-n2-a1`;
const controllerTerminalN2 = wo.buildControllerTerminalReceipt({
  terminalStatus: 'success',
  rootRunId: iccIdN2,
  workOrderId: workOrderIdN2,
  graphNode: 'n2',
  campaignId: iccIdN2,
  acceptedCommit: baseSha,
  controller: ctrlStateN2,
  issuedAt: '2026-07-30T00:00:05.000Z',
});
fs.writeFileSync(
  terminalPathN2,
  `${JSON.stringify(controllerTerminalN2, null, 2)}\n`,
);
const activeWrittenN2 = wo.createOrUpdateWorkOrder(common, {
  root_run_id: iccIdN2,
  graph_node: 'n2',
  attempt: 1,
  role: 'controller',
  next_action: 'continue',
  branch: 'main',
  base_sha: baseSha,
  worktree: repo,
  paths: {
    durable: durablePathN2,
    checkpoint: checkpointPathN2,
    receipt: terminalPathN2,
  },
  controller: ctrlStateN2,
}, { bindArtifacts: true });
assert.strictEqual(
  activeWrittenN2.status,
  'written',
  JSON.stringify(activeWrittenN2),
);
const writtenN2 = wo.updateWorkOrderLifecycle(common, {
  path: activeWrittenN2.path,
}, {
  next_action: 'terminal',
  expected_receipt: {
    path: terminalPathN2,
    digest: controllerTerminalN2.digest,
  },
  terminal_status: 'success',
  disposition: 'consumed',
  accepted_commit: baseSha,
}, {
  expectedGeneration: activeWrittenN2.work_order.generation,
  expectedCasToken: activeWrittenN2.work_order.cas_token,
  expectedControllerDigest:
    activeWrittenN2.work_order.controller.controller_digest,
  bindArtifacts: true,
  preserveOwner: true,
  gitCwd: repo,
});
assert.strictEqual(writtenN2.status, 'written');
assert.strictEqual(
  wo.classifyWorkOrder(writtenN2.work_order, {
    gitCwd: repo,
    workOrderPath: writtenN2.path,
    requireBoundEvidence: true,
  }).classification,
  'consume_terminal',
);
const allRouted = admitMissionRouting({
  repoRoot: repo,
  entryLevel: 'l6',
});
assert.strictEqual(allRouted.noop_adoptions.length, 2);
assert.strictEqual(allRouted.dispatcher_called, false);
assert.strictEqual(allRouted.mutation_attempts, 0);
assert.strictEqual(allRouted.gate_attempts, 0);
assert.strictEqual(allRouted.resources_created, 0);
const allSess = spawnSync(process.execPath, [
  sessionCli, 'set', '--level', 'l6', '--repo-root', repo,
], {
  encoding: 'utf8',
  env: sessionEnv,
});
assert.strictEqual(allSess.status, 0, allSess.stderr || allSess.stdout);
const allSessBody = JSON.parse(allSess.stdout);
assert.strictEqual(allSessBody.mission_noop.noop_adoptions.length, 2);
assert.strictEqual(allSessBody.mission_noop.dispatcher_called, false);
assert.strictEqual(allSessBody.mission_noop.mutation_attempts, 0);
assert.strictEqual(allSessBody.mission_noop.gate_attempts, 0);
assert.strictEqual(allSessBody.mission_noop.resources_created, 0);
const zeroDiffReceiptN2 = buildMissionZeroDiffReceipt({
  missionNoopAdoption: allRouted.noop_adoptions.find(
    (entry) => entry.graph_node_id === 'n2',
  ),
  campaignContract: campaignContractN2,
  campaignContractSha256: strictContractDigestN2,
  campaignId: iccIdN2,
  branch: grantN2.branch,
  base: grantN2.base_sha,
  runner: 'agy',
  model: dispatchModel,
  stage: 'campaign-implementation',
  rootRunId: campaignContractN2.mission_runtime.root_run_id,
});
const unitN2 = deriveCampaignDispatchUnit({
  campaignContract: campaignContractN2,
  campaignContractSha256: strictContractDigestN2,
  campaignId: iccIdN2,
  branch: grantN2.branch,
  base: grantN2.base_sha,
  runner: 'agy',
  model: dispatchModel,
  stage: 'campaign-implementation',
  rootRunId: campaignContractN2.mission_runtime.root_run_id,
  zeroDiffReceipt: zeroDiffReceiptN2,
});
const unitPathN2 = path.join(authorityDirN2, 'dispatch-unit.json');
fs.writeFileSync(unitPathN2, `${JSON.stringify(unitN2, null, 2)}\n`);
const dispatchN2 = spawnSync('bash', [
  path.join(root, 'scripts', 'dispatch-hetero.sh'),
  '--branch', grantN2.branch,
  '--base', grantN2.base_sha,
  '--prompt-file', promptPath,
  '--runner', 'agy',
  '--agy-bin', runnerStub,
  '--model', dispatchModel,
  '--campaign-contract', grantN2.contract_path,
  '--campaign-contract-sha256', strictContractDigestN2,
  '--campaign-seal', grantN2.seal_path,
  '--strict-contract',
  '--contract-file', unitPathN2,
  '--run-id', iccIdN2,
  '--stage', 'campaign-implementation',
], {
  cwd: repo,
  encoding: 'utf8',
  env: {
    ...sessionEnv,
    AUTOPILOT_PARENT_RUN_ID: 'ordinary-noop-parent',
    AUTOPILOT_ROOT_RUN_ID: campaignContractN2.mission_runtime.root_run_id,
    AUTOPILOT_DISPATCH_MANIFEST: '0',
  },
});
assert.strictEqual(dispatchN2.status, 0, `${dispatchN2.stdout}\n${dispatchN2.stderr}`);
const dispatchReceiptN2 = JSON.parse(dispatchN2.stdout);
assert.strictEqual(dispatchReceiptN2.status, 'no_op');
assert.strictEqual(dispatchReceiptN2.runner, 'sealed-zero-diff-admission');
assert.strictEqual(dispatchReceiptN2.dispatcher_called, false);
assert.strictEqual(
  dispatchReceiptN2.zero_diff_receipt_digest,
  zeroDiffReceiptN2.digest,
);
assert.strictEqual(fs.existsSync(runnerSentinel), false);

// Ambient canonical ready history cannot degrade to "first run" when its
// bound controller Work Order disappears: that would replay an effectful node.
const missingWoBytes = fs.readFileSync(written.path);
fs.unlinkSync(written.path);
assert.throws(() => {
  admitMissionRouting({
    repoRoot: repo,
    entryLevel: 'l6',
  });
}, (e) => e && e.code === 'MISSION_EVIDENCE_MISSING'
  && /Work Order/i.test(String(e.message)));
const missingWoMarkerDir = path.join(tmp, 'missing-wo-session-markers');
const missingWoSession = spawnSync(process.execPath, [
  sessionCli, 'set', '--level', 'l6', '--repo-root', repo,
], {
  encoding: 'utf8',
  env: {
    ...sessionEnv,
    AUTOPILOT_SESSION_MODE_DIR: missingWoMarkerDir,
    CLAUDE_CODE_SESSION_ID: 'missing-wo-routing-session',
  },
});
assert.strictEqual(missingWoSession.status, 2);
assert.match(missingWoSession.stderr, /Mission routing rejected:.*Work Order/i);
assert.strictEqual(
  fs.existsSync(missingWoMarkerDir)
    && fs.readdirSync(missingWoMarkerDir).some((name) => name.endsWith('.json')),
  false,
  'session-mode must not mint a marker when registry terminal Work Order authority is missing',
);
fs.writeFileSync(written.path, missingWoBytes);

// A canonical terminal+reconciled claim makes its applied journal mandatory.
// Deleting that receipt must fail closed rather than replay as a first run.
fs.unlinkSync(journalPath);
assert.throws(() => {
  loadDurableMissionEvidence(repo, {
    enforceEvidence: true,
    missionGraphDigest: graphDig,
    graphNodeId: 'n1',
  });
}, (e) => e && e.code === 'MISSION_EVIDENCE_MISSING'
  && /applied terminal (journal|receipt)/i.test(String(e.message)));

// Foreign graph digest on terminal when present again must fail closed.
fs.writeFileSync(
  journalPath,
  `${JSON.stringify({ ...term, mission_graph_digest: '9'.repeat(64) })}\n`,
);
assert.throws(() => {
  loadDurableMissionEvidence(repo, {
    enforceEvidence: true,
    missionGraphDigest: graphDig,
    graphNodeId: 'n1',
  });
}, (e) => e && e.code === 'MISSION_EVIDENCE_CORRUPT'
  && /foreign|graph|terminal/i.test(String(e.message)));

// Corrupt registry is a separate fail-closed oracle, not a substitute for the
// foreign-terminal assertion above.
// Corrupt registry: break JSON.
fs.writeFileSync(path.join(missionRoot, 'registry.json'), '{not-json');
assert.throws(() => {
  loadDurableMissionEvidence(repo, { enforceEvidence: true });
}, (e) => e && (e.code === 'MISSION_EVIDENCE_CORRUPT' || /registry|JSON|corrupt/i.test(String(e.message))));

console.log(JSON.stringify({
  ordinary_registry_noop: true,
  ordinary_noop_zero_spend: true,
  ordinary_one_of_many_node_scoped: true,
  ordinary_all_satisfied_zero_spend: true,
  ordinary_dispatch_runner_not_called: true,
  ordinary_dispatch_worktree_not_created: true,
  ordinary_engine_shell_bridge: true,
  ambient_ready_missing_wo_fail_closed: true,
  ordinary_missing_terminal_fail_closed: true,
  ordinary_corrupt_registry_fail_closed: true,
  session_mode_ordinary_cli: true,
  dispatcher_called: false,
  mutation_attempts: 0,
  gate_attempts: 0,
  resources_created: 0,
}));
NODE
)"
assert_exit_code "$?" "0" "ordinary Mission registry/session no-op path exits zero"
assert_contains "$ORDINARY_OUT" '"ordinary_registry_noop":true' "ordinary registry no-op loaded"
assert_contains "$ORDINARY_OUT" '"ordinary_noop_zero_spend":true' "ordinary no-op zero spend"
assert_contains "$ORDINARY_OUT" '"ordinary_one_of_many_node_scoped":true' "one-of-many no-op stays node scoped"
assert_contains "$ORDINARY_OUT" '"ordinary_all_satisfied_zero_spend":true' "all-satisfied admission is zero spend"
assert_contains "$ORDINARY_OUT" '"ordinary_dispatch_runner_not_called":true' "ordinary no-op bypasses runner"
assert_contains "$ORDINARY_OUT" '"ordinary_dispatch_worktree_not_created":true' "ordinary no-op creates no worktree"
assert_contains "$ORDINARY_OUT" '"ordinary_engine_shell_bridge":true' \
  "ordinary Work Order authority reaches Engine and the real dispatch shell"
assert_contains "$ORDINARY_OUT" '"ambient_ready_missing_wo_fail_closed":true' \
  "ambient canonical ready history with missing Work Order fails closed"
assert_contains "$ORDINARY_OUT" '"ordinary_corrupt_registry_fail_closed":true' "corrupt registry fails closed"
assert_contains "$ORDINARY_OUT" '"session_mode_ordinary_cli":true' "session-mode ordinary CLI"
assert_contains "$ORDINARY_OUT" '"dispatcher_called":false' "dispatcher_called false"
assert_contains "$ORDINARY_OUT" '"mutation_attempts":0' "zero mutation attempts"
assert_contains "$ORDINARY_OUT" '"gate_attempts":0' "zero gate attempts"

finalize_test
