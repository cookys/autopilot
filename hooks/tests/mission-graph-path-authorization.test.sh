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
  [
    'artifact_type',
    'candidates',
    'expected_post_c_bridge',
    'retired_nodes',
    'schema_version',
  ],
);

const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
// Successor graph: active implementation ownership is PRS + CTR only.
// release-closeout is the sequential terminal node; bridge is post-integration historical.
const CLOSEOUT_ID = 'release-closeout';
const activeImplementationNodeIds = new Set(
  graph.nodes.map((node) => node.id).filter((id) => id !== CLOSEOUT_ID),
);
assert.deepEqual(
  [...activeImplementationNodeIds].sort(),
  ['plan-review', 'transcript-retro'],
);
assert.equal(nodes.has('runtime-control'), false);
assert.equal(nodes.has(CLOSEOUT_ID), true);

const retiredNodes = audit.retired_nodes;
assert.equal(typeof retiredNodes, 'object');
assert.ok(retiredNodes['runtime-control'], 'runtime-control retired registry entry retained');
assert.equal(retiredNodes['runtime-control'].max_changed_files, 200);
assert.match(
  retiredNodes['runtime-control'].reason,
  /historical-output_paths|successor|bootstrap/i,
);

/**
 * Classify a candidate or bridge attachment against the successor graph.
 * - active: must be an active implementation node present in the graph
 * - historical: must be listed in retired_nodes (removed-node evidence)
 * - anything else, or an unknown node without classification, fails closed
 */
function classifyAttachment(attachment, label) {
  const nodeId = attachment.node_id;
  const status = attachment.status;
  if (status === 'historical') {
    assert.ok(
      retiredNodes[nodeId],
      `${label}: historical attachment ${nodeId} lacks retired_nodes entry`,
    );
    assert.equal(
      activeImplementationNodeIds.has(nodeId),
      false,
      `${label}: historical node ${nodeId} must not be an active implementation owner`,
    );
    assert.equal(
      nodes.has(nodeId),
      false,
      `${label}: historical node ${nodeId} must not remain in the executable graph`,
    );
    return 'historical';
  }
  if (status === 'active') {
    assert.ok(nodes.has(nodeId), `unknown candidate node ${nodeId}`);
    assert.ok(
      activeImplementationNodeIds.has(nodeId),
      `${label}: active attachment ${nodeId} is not an active implementation node`,
    );
    return 'active';
  }
  // Fail closed: unclassified or unknown node IDs never become active owners.
  if (!nodes.has(nodeId) && !retiredNodes[nodeId]) {
    assert.fail(`unknown candidate node ${nodeId}`);
  }
  assert.fail(`unclassified candidate node ${nodeId}`);
}

// Fail-closed probes: fabricated / unclassified node IDs must not pass.
assert.throws(
  () => classifyAttachment({ node_id: 'fabricated-unknown', status: 'active' }, 'probe'),
  /unknown candidate node fabricated-unknown/,
);
assert.throws(
  () => classifyAttachment({ node_id: 'fabricated-unknown' }, 'probe'),
  /unknown candidate node fabricated-unknown/,
);
assert.throws(
  () => classifyAttachment({ node_id: 'runtime-control' }, 'probe'),
  /unclassified candidate node runtime-control/,
);
assert.throws(
  () => classifyAttachment(
    { node_id: 'runtime-control', status: 'active' },
    'probe',
  ),
  /unknown candidate node runtime-control/,
);

const activeOwners = (candidatePath) => graph.nodes
  .filter((node) => (
    activeImplementationNodeIds.has(node.id)
    && node.campaign.output_paths.includes(candidatePath)
  ))
  .map((node) => node.id)
  .sort();

let rangesChecked = 0;
let excluded = 0;
let historicalCandidates = 0;
let activeCandidates = 0;
const activeOwnerHits = { 'plan-review': 0, 'transcript-retro': 0 };

for (const candidate of audit.candidates) {
  assert.deepEqual(
    Object.keys(candidate).sort(),
    ['evidence_range', 'excluded_paths', 'id', 'node_id', 'observed_paths', 'status'],
  );
  const classification = classifyAttachment(candidate, candidate.id);
  assert.deepEqual(candidate.observed_paths, sortedUnique(candidate.observed_paths));

  let maxChangedFiles;
  if (classification === 'historical') {
    historicalCandidates += 1;
    maxChangedFiles = retiredNodes[candidate.node_id].max_changed_files;
    // Historical evidence is retained but never counted as an active owner.
    for (const candidatePath of candidate.observed_paths) {
      assert.equal(
        activeOwners(candidatePath).includes(candidate.node_id),
        false,
        `${candidate.id}: retired node must not appear as active owner for ${candidatePath}`,
      );
    }
  } else {
    activeCandidates += 1;
    const node = nodes.get(candidate.node_id);
    maxChangedFiles = node.campaign.max_changed_files;
  }
  assert.ok(candidate.observed_paths.length <= maxChangedFiles);

  const excludedPaths = new Set();
  for (const exclusion of candidate.excluded_paths) {
    assert.deepEqual(Object.keys(exclusion).sort(), ['path', 'reason']);
    assert.ok(candidate.observed_paths.includes(exclusion.path));
    assert.match(exclusion.reason, /^Pre-admission /);
    if (classification === 'active') {
      const node = nodes.get(candidate.node_id);
      assert.equal(node.campaign.output_paths.includes(exclusion.path), false);
    }
    assert.equal(excludedPaths.has(exclusion.path), false);
    excludedPaths.add(exclusion.path);
    excluded += 1;
  }

  if (classification === 'active') {
    for (const candidatePath of candidate.observed_paths) {
      if (excludedPaths.has(candidatePath)) continue;
      assert.deepEqual(
        activeOwners(candidatePath),
        [candidate.node_id],
        `${candidate.id} path is not owned exactly by ${candidate.node_id}: ${candidatePath}`,
      );
      activeOwnerHits[candidate.node_id] += 1;
    }
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

assert.equal(historicalCandidates, 2, 'both runtime-control candidates retained as historical');
assert.equal(activeCandidates, 2, 'plan-review and transcript-retro remain active');
assert.ok(activeOwnerHits['plan-review'] > 0, 'PRS exact ownership exercised');
assert.ok(activeOwnerHits['transcript-retro'] > 0, 'CTR exact ownership exercised');
// Retired runtime-control must never appear in active ownership tallies.
assert.equal(
  Object.prototype.hasOwnProperty.call(activeOwnerHits, 'runtime-control'),
  false,
);

const bridge = audit.expected_post_c_bridge;
assert.deepEqual(
  Object.keys(bridge).sort(),
  ['node_id', 'paths', 'status'],
);
assert.equal(bridge.node_id, 'runtime-control');
assert.equal(classifyAttachment(bridge, 'expected_post_c_bridge'), 'historical');
assert.deepEqual(bridge.paths, sortedUnique(bridge.paths));
const bridgeCeiling = retiredNodes[bridge.node_id].max_changed_files;
assert.ok(bridge.paths.length <= bridgeCeiling);
// Post-integration bridge remains authorized as historical evidence only —
// not as active-node path ownership.
for (const bridgePath of bridge.paths) {
  assert.equal(
    activeOwners(bridgePath).includes('runtime-control'),
    false,
    `bridge path must not claim active runtime-control ownership: ${bridgePath}`,
  );
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
  runtime_control_retained_historical: true,
  runtime_control_not_active_owner: true,
  fabricated_unknown_node_fails_closed: true,
  prs_ctr_exact_ownership: true,
  active_implementation_nodes: [...activeImplementationNodeIds].sort(),
  historical_candidates: historicalCandidates,
  active_candidates: activeCandidates,
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
assert_contains "$OUT" '"runtime_control_retained_historical":true' "runtime-control evidence retained as historical"
assert_contains "$OUT" '"runtime_control_not_active_owner":true' "runtime-control is not an active path owner"
assert_contains "$OUT" '"fabricated_unknown_node_fails_closed":true' "fabricated unknown node IDs fail closed"
assert_contains "$OUT" '"prs_ctr_exact_ownership":true' "PRS and CTR exact ownership remain true"
assert_contains "$OUT" '"active_implementation_nodes":["plan-review","transcript-retro"]' "active owners are successor implementation nodes only"

finalize_test
