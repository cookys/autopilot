#!/usr/bin/env bash
set -uo pipefail

TEST_NAME="mission-graph-path-authorization"
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = process.argv[2];
const project = path.join(
  root,
  'docs/projects/2026-07-26-mission-convergence-portfolio',
);
const graph = JSON.parse(fs.readFileSync(
  path.join(project, 'mission-execution-graph.json'),
  'utf8',
));
const audit = JSON.parse(fs.readFileSync(
  path.join(project, 'candidate-path-audit.json'),
  'utf8',
));
const sortedUnique = (values) => [...new Set(values)].sort();

assert.equal(audit.schema_version, 1);
assert.equal(audit.artifact_type, 'mission_candidate_path_audit');
assert.deepEqual(
  Object.keys(audit).sort(),
  ['artifact_type', 'candidates', 'expected_post_c_bridge', 'schema_version'],
);

const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const activeNodeIds = new Set(['runtime-control', 'plan-review', 'transcript-retro']);
const activeOwners = (candidatePath) => graph.nodes
  .filter((node) => activeNodeIds.has(node.id) && node.campaign.output_paths.includes(candidatePath))
  .map((node) => node.id)
  .sort();

let rangesChecked = 0;
let excluded = 0;
for (const candidate of audit.candidates) {
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ['evidence_range', 'excluded_paths', 'id', 'node_id', 'observed_paths'],
  );
  const node = nodes.get(candidate.node_id);
  assert.ok(node, `unknown candidate node ${candidate.node_id}`);
  assert.deepEqual(candidate.observed_paths, sortedUnique(candidate.observed_paths));
  assert.ok(candidate.observed_paths.length <= node.campaign.max_changed_files);

  const excludedPaths = new Set();
  for (const exclusion of candidate.excluded_paths) {
    assert.deepEqual(Object.keys(exclusion).sort(), ['path', 'reason']);
    assert.ok(candidate.observed_paths.includes(exclusion.path));
    assert.match(exclusion.reason, /^Pre-admission /);
    assert.equal(node.campaign.output_paths.includes(exclusion.path), false);
    assert.equal(excludedPaths.has(exclusion.path), false);
    excludedPaths.add(exclusion.path);
    excluded += 1;
  }
  for (const candidatePath of candidate.observed_paths) {
    if (excludedPaths.has(candidatePath)) continue;
    assert.deepEqual(
      activeOwners(candidatePath),
      [candidate.node_id],
      `${candidate.id} path is not owned exactly by ${candidate.node_id}: ${candidatePath}`,
    );
  }

  if (candidate.evidence_range) {
    const { base, head } = candidate.evidence_range;
    const available = [base, head].every((revision) => (
      spawnSync('git', ['-C', root, 'rev-parse', '--verify', '--quiet', revision], {
        stdio: 'ignore',
      }).status === 0
    ));
    if (available) {
      const observed = sortedUnique(execFileSync(
        'git',
        ['-C', root, 'diff', '--name-only', `${base}..${head}`],
        { encoding: 'utf8' },
      ).split(/\r?\n/).filter(Boolean));
      assert.deepEqual(observed, candidate.observed_paths);
      rangesChecked += 1;
    }
  }
}

const bridge = audit.expected_post_c_bridge;
assert.deepEqual(Object.keys(bridge).sort(), ['node_id', 'paths']);
assert.equal(bridge.node_id, 'runtime-control');
assert.deepEqual(bridge.paths, sortedUnique(bridge.paths));
const runtime = nodes.get(bridge.node_id);
assert.ok(bridge.paths.length <= runtime.campaign.max_changed_files);
for (const bridgePath of bridge.paths) {
  assert.deepEqual(activeOwners(bridgePath), ['runtime-control']);
}
for (const node of graph.nodes) {
  assert.deepEqual(node.campaign.output_paths, sortedUnique(node.campaign.output_paths));
  assert.ok(node.campaign.output_paths.length <= node.campaign.max_changed_files);
}

console.log(JSON.stringify({
  candidates_authorized_exactly_once: true,
  historical_ranges_consistent: true,
  historical_ranges_recomputed: rangesChecked,
  exclusions_documented: excluded,
  post_c_bridge_authorized: true,
  max_changed_files_respected: true,
}));
NODE
)"
EXIT=$?

assert_exit_code "$EXIT" "0" "candidate path authorization audit passes"
assert_contains "$OUT" '"candidates_authorized_exactly_once":true' "candidate paths have one active-node owner"
assert_contains "$OUT" '"historical_ranges_consistent":true' "available historical ranges match frozen path sets"
assert_contains "$OUT" '"exclusions_documented":5' "pre-admission shared paths have explicit exclusions"
assert_contains "$OUT" '"post_c_bridge_authorized":true' "post-C bridge surfaces are pre-authorized"
assert_contains "$OUT" '"max_changed_files_respected":true' "all output sets stay inside file ceilings"

finalize_test
