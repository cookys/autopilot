#!/usr/bin/env bash
set -u
. "$(dirname "$0")/lib.sh"

node - "$REPO_ROOT" <<'NODE'
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ctrl = require(path.join(root, 'src/engine/controller-execution'));
const wo = require(path.join(root, 'src/engine/work-order'));
const taskRuntime = require(path.join(root, 'src/status/task-runtime'));
assert.deepStrictEqual(taskRuntime.MERGE_PRODUCT_PATH_PREFIXES, [
  'src', 'scripts', 'hooks',
  'platforms/codex/plugin/src', 'platforms/codex/plugin/scripts',
]);
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-git-'));
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'config', 'user.email', 'e1@example.invalid']);
execFileSync('git', ['-C', repo, 'config', 'user.name', 'E1']);
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
fs.writeFileSync(path.join(repo, 'src', 'product.js'), 'base\n');
execFileSync('git', ['-C', repo, 'add', '.']);
execFileSync('git', ['-C', repo, 'commit', '-qm', 'base']);
const baseSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.writeFileSync(path.join(repo, 'src', 'product.js'), 'candidate\n');
execFileSync('git', ['-C', repo, 'commit', '-qam', 'candidate']);
const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const rootId = 'mission-e1-fixture';
const workOrderId = `wo-${rootId}-node-a1`;
const record = {
  schema_version: 1,
  root_run_id: rootId,
  work_order_id: workOrderId,
  accepted_commit: commit,
  dispatch_depth: 2,
  changed_paths: ['src/product.js'],
};
const common = wo.resolveGitCommonDir(repo);
const manifestPath = path.join(common, 'e1-manifest.json');
const persist = (nextRecord) => {
  const controller = ctrl.emptyControllerState({
    frozen_denominator: ctrl.buildFrozenDenominator({ projectId: rootId, graphDigest: 'b'.repeat(64), deliverableIds: ['node'], nodeId: 'node' }),
    dispatch_records: [nextRecord],
  });
  fs.writeFileSync(manifestPath, JSON.stringify({ root_run_id: rootId, work_order_id: workOrderId, controller_digest: controller.controller_digest, entries: [nextRecord] }));
  const workOrder = wo.buildWorkOrder({ root_run_id: rootId, work_order_id: workOrderId, graph_node: 'node', role: 'controller', next_action: 'merge', branch: 'feat/e1', base_sha: baseSha, controller, paths: { manifest: manifestPath } }, { bindArtifacts: true });
  const workOrderFile = wo.workOrderPath(common, rootId, 'node', 1);
  fs.mkdirSync(path.dirname(workOrderFile), { recursive: true });
  wo.writeAtomicJson(workOrderFile, workOrder);
};
const request = { repoRoot: repo, rootRunId: rootId, workOrderId, baseSha, headSha: commit, productPathPrefixes: ['src'] };
persist(record);
assert.strictEqual(ctrl.validateDispatchMergeProvenance(request).ok, true);
assert.strictEqual(ctrl.validateDispatchMergeProvenance({ ...request, commits: [], manifests: [] }).ok, true);
persist({ ...record, dispatch_depth: 0 });
assert.ok(ctrl.validateDispatchMergeProvenance(request).problems.some((item) => item.code === 'PROVENANCE_DEPTH0_PRODUCT_EDIT'));
persist({ ...record, changed_paths: [] });
assert.ok(ctrl.validateDispatchMergeProvenance(request).problems.some((item) => item.code === 'PROVENANCE_PATH_UNBOUND'));
console.log('PASS [backlog-convergence-e1] 5 assertions');

const qp = require(path.join(root, 'src/readiness/qualification-provider'));
const now = '2026-08-02T00:00:00.000Z';
const allowedRoles = new Set(['implementer', 'verification_author', 'qc']);
const provider = qp.createQualificationProvider({ qualify: (tuple) => allowedRoles.has(tuple.role) });
for (const role of allowedRoles) {
  const tuple = { role, runner: 'codex', model: 'gpt-5.6-sol', effort: 'high', endpoint: null };
  const receipt = qp.issueExactRoleQualification(provider, { tuple, now });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(receipt)), {});
  assert.strictEqual(qp.consumeExactRoleQualification(provider, receipt, { tuple, now }).status, 'ready');
  assert.throws(() => qp.consumeExactRoleQualification(provider, receipt, { tuple, now }), /replayed/);
}
const wrongTuple = { role: 'reviewer', runner: 'codex', model: 'gpt-5.6-sol', effort: 'high', endpoint: null };
assert.strictEqual(qp.issueExactRoleQualification(provider, { tuple: wrongTuple, now }), null);
console.log('PASS [backlog-convergence-qualification] 10 assertions');
NODE

# Build the exact historical B/C authority inside an isolated Git common-dir.
# The production selector remains repo-bound: no caller-selected authority path
# or process override is introduced for this fixture.
MISSION_FIXTURE_REPO="$TEST_TMP/legacy-mission-repo"
git clone -q --no-local "$REPO_ROOT" "$MISSION_FIXTURE_REPO"

# Resolve the current graph through the ordinary production admission path
# before the isolated repository has any historical Mission authority.
INITIAL_ADMISSION="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --level l3)"
assert_eq "READY" "$(jq -r '.status' <<<"$INITIAL_ADMISSION")" \
  "clean isolated repository selects production Mission authority"
GRAPH_DIGEST="$(jq -r '.admission.mission_graph_digest' <<<"$INITIAL_ADMISSION")"

node - "$REPO_ROOT" "$MISSION_FIXTURE_REPO" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [root, repo] = process.argv.slice(2);
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { LEGACY } = require(path.join(root, 'scripts', 'mission-terminal-reconcile'));
const executionGraph = JSON.parse(fs.readFileSync(
  path.join(root, 'docs', 'mission-backlog-bc-execution-graph.json'),
  'utf8',
));
assert.strictEqual(executionGraph.graph_digest, LEGACY.graph_digest);
const legacyLineage = `lineage-v1-${LEGACY.adoption_key}`;
const common = fs.realpathSync(execFileSync('git', [
  '-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir',
], { encoding: 'utf8' }).trim());
const repoIdentity = `git-common-dir:${common}`;
const missionRoot = path.join(common, 'autopilot', 'mission');
const stateRef = path.join('states', `${LEGACY.adoption_key}.json`);
const taskAuthorityId = mission.sha256('legacy-terminal-fixture-authority');
const policyHash = mission.sha256('legacy-terminal-fixture-policy');
const missionPolicyDigest = mission.sha256('legacy-terminal-fixture-mission-policy');
const axis = (authorized_ceiling) => ({
  authorized_ceiling,
  reserved_active: 0,
  durable_consumed: 0,
  known: true,
  enforced: true,
});
const state = JSON.parse(JSON.stringify(mission.createMissionState({
  schema_version: 1,
  artifact_type: 'mission_convergence_contract',
  contract_id: `mission-v1-${mission.sha256('legacy-terminal-fixture-contract')}`,
  repo_identity: repoIdentity,
  mission_lineage_id: legacyLineage,
  task_authority_id: taskAuthorityId,
  policy_hash: policyHash,
  mission_policy_digest: missionPolicyDigest,
  mission_graph_digest: executionGraph.graph_digest,
  execution_graph: executionGraph,
  enforcement_mode: 'enforce',
  state: 'DRAFT',
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
  axes: {
    campaigns: axis(10),
    wall_seconds: axis(36000),
    tool_calls: axis(1500),
    engine_attempts: axis(50),
    external_wait_seconds: axis(14400),
    canonical_changed_files: axis(500),
    output_bytes: axis(50000000),
  },
  grant_contract: {
    idempotency_key_required: true,
    single_use: true,
    expiry_seconds: 3600,
    bindings: [
      'mission_lineage_id', 'task_authority_id', 'campaign_id',
      'campaign_contract_digest', 'base_sha', 'acceptance_ids',
    ],
  },
  control_contract: {
    actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
    allowed_authorities: ['authenticated_user'],
    ceiling_loosen_authority: 'authenticated_user',
  },
  lineage_binding: {
    task_authority_id: taskAuthorityId,
    root_run_id: 'legacy-terminal-fixture',
    policy_hash: policyHash,
    successor_inherits_durable_consumed: true,
  },
})));
state.state = 'COMPLETE';
state.graph_progress = Object.fromEntries(LEGACY.terminals.map((terminal) => [
  terminal.graph_node_id,
  {
    status: 'ready',
    attempts: 3,
    terminal_count: 1,
    active_claim_id: null,
    last_outcome: 'ready',
    last_receipt_digest: terminal.receipt_digest,
  },
]));
mission.validateMissionState(state);
assert.strictEqual(state.execution_graph.graph_digest, state.mission_graph_digest);

const usage = {
  per_axis: [
    ['campaigns', 10],
    ['wall_seconds', 36000],
    ['tool_calls', 1500],
    ['engine_attempts', 50],
    ['external_wait_seconds', 14400],
    ['canonical_changed_files', 500],
    ['output_bytes', 50000000],
  ].map(([name, authorized_ceiling]) => ({
    axis: name,
    authorized_ceiling,
    reserved_active: 0,
    durable_consumed: 0,
    known: false,
  })),
};
const receipts = [
  {
    schema_version: 1,
    artifact_type: 'campaign_terminal_receipt',
    claim_id: 'claim-v1-e77cd11c6474fe45a5917965818e27d53bf38be5bfcd48987d5abd2712a3e232',
    mission_lineage_id: 'lineage-v1-baa18c972660cf5a67783e507a83849e4a3c6ccd61ba93bdf29a31ba893d9d3e',
    campaign_id: 'campaign-v2-7751faad571b2bed1b5357e1b7757c8b6a1625c338e16fe88227a7ff409ccc1d',
    mission_campaign_id: 'campaign-v2-7751faad571b2bed1b5357e1b7757c8b6a1625c338e16fe88227a7ff409ccc1d',
    icc_campaign_id: 'campaign-v1-80c477b59fa440d324cc2b98032e101a9a630cc6c5c60057a062e7c1393f3e50',
    campaign_contract_digest: '59d14269f62a87765435859e4d2f74a3e56af788708a105f1404eccfd4bcb521',
    raw_campaign_contract_digest: '4040a3ef498349fbfd685cc8c52181133b227c920c8e818443e6b540216f4475',
    graph_node_id: 'correctness-gates',
    graph_attempt: 3,
    outcome: 'ready',
    possibly_effectful: true,
    actual_usage: usage,
    satisfied_acceptance_hashes: [
      '157f8da6a2da5f53340b8d1dfe133d1ca80c7642bf1043bb4aec0d9cc90a153b',
      '27638cb34058bcae0716405ce6e5e7cdd9835c1ab14d44a2bfa144aa6613afc2',
      '28b64bfec50e7cf2c6210639fcb88ca665ff715750728e3cd8b15ffe0d3434be',
      '3f6c30aa2ad33338485cdf5ea173e4b60d54ff1f2bb17ae90f6a351aec7bc803',
      '60a2686b4c27382bfc9938756b978b7f2e3683478ad49435903a918575526795',
      '6a52cf7da2eb33e6b4aa14a13aa2f73ad7bc31c8e90800c47ef9ff23fad321e0',
      'ad01c5905ac8f16fed1e9d8fadfac3be25b6c14a541556f0712f76c600e19006',
    ],
    observed_at: '2026-07-31T07:52:08.920Z',
    receipt_digest: '3abc74dc35b08b177871854cdb218f7d94bfaf0793ad0704060515753974de16',
  },
  {
    schema_version: 1,
    artifact_type: 'campaign_terminal_receipt',
    claim_id: 'claim-v1-5722fe1082e7bedb1ce459f4ac1863d888f4aafcfa230a69a0eb1ebc3682fd01',
    mission_lineage_id: 'lineage-v1-baa18c972660cf5a67783e507a83849e4a3c6ccd61ba93bdf29a31ba893d9d3e',
    campaign_id: 'campaign-v2-a483b02913c750ddf3d380aece908caa1f988db14fc54c97b10e1e4e61526f3d',
    mission_campaign_id: 'campaign-v2-a483b02913c750ddf3d380aece908caa1f988db14fc54c97b10e1e4e61526f3d',
    icc_campaign_id: 'campaign-v1-28cf3f20d7676a2a9dad182a8c28c3b52f92e720fada00bf35038bcf6e090773',
    campaign_contract_digest: 'c0699e6d317bc2c32c78e3a3fc6aabf7916e099c69c99ea71b1f10d52a3212bf',
    raw_campaign_contract_digest: 'c206dc8bce44b73e358cd76b7337357dd1783f6db5d54ff19e341d587c72d7bb',
    graph_node_id: 'evidence-eval-truth',
    graph_attempt: 3,
    outcome: 'ready',
    possibly_effectful: true,
    actual_usage: usage,
    satisfied_acceptance_hashes: [
      '157f8da6a2da5f53340b8d1dfe133d1ca80c7642bf1043bb4aec0d9cc90a153b',
      '2fe0cb03f06bcaa4d7cf58de444ea8f96add8d49585c9acf0c5100b36680fbe4',
      '50a720353c0aec7cf369b0994c6d12dde4607fc5dae149966943ae543e4e3603',
      '8e7119a7d24fab50dd9cc4fafca0a0cb35ef22e057bec561b6963f9d66689b2c',
      '9b0b74d9bcf02c61476c65152e9c464a227936ac7e0c0db5cc4e35176402ce4c',
      'a1577c915bcd3d1cf0f44cd3641d827543601e7cbc157883e8ad5c0d61072c75',
      'a7d303bcc6e525e35981ea9a36f2f021f79140887ade1f392315aa159153b350',
    ],
    observed_at: '2026-07-31T07:52:08.843Z',
    receipt_digest: 'b17b7d15915ac911960b574c928c588671f0ef1802b2ba3f67a9b580e43bb358',
  },
];
for (const receipt of receipts) {
  const body = { ...receipt };
  delete body.receipt_digest;
  assert.strictEqual(mission.sha256(mission.canonicalJson(body)), receipt.receipt_digest);
  assert.strictEqual(receipt.mission_lineage_id, state.mission_lineage_id);
}

const registry = {
  schema_version: 1,
  artifact_type: 'mission_runtime_registry',
  repo_identity: repoIdentity,
  missions: {
    [LEGACY.adoption_key]: {
      schema_version: 1,
      adoption_key: LEGACY.adoption_key,
      repo_identity: repoIdentity,
      mission_lineage_id: state.mission_lineage_id,
      task_authority_id: state.task_authority_id,
      policy_hash: state.policy_hash,
      intent_hash: mission.sha256('legacy-terminal-fixture-intent'),
      initial_required_acceptance_hashes: [],
      mission_policy_digest: state.mission_policy_digest,
      mission_graph_digest: state.mission_graph_digest,
      enforcement_mode: state.enforcement_mode,
      prepared_state_hash: mission.stateHash(state),
      state_ref: stateRef,
    },
  },
};
const journalDir = path.join(missionRoot, 'journals', LEGACY.adoption_key);
fs.mkdirSync(path.join(missionRoot, 'states'), { recursive: true });
fs.mkdirSync(journalDir, { recursive: true });
fs.writeFileSync(path.join(missionRoot, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
fs.writeFileSync(path.join(missionRoot, stateRef), `${JSON.stringify(state, null, 2)}\n`);
for (const receipt of receipts) {
  fs.writeFileSync(path.join(journalDir, `${receipt.claim_id}.applied.json`),
    `${JSON.stringify(receipt, null, 2)}\n`);
}
NODE

# Production authority selection is not a test seam.
set +e
AUTH_OUT="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --level l3 --authority-store "$TEST_TMP/common" 2>&1)"
AUTH_RC=$?
set -e
assert_eq "2" "$AUTH_RC" "caller-selected authority store is rejected"
assert_contains "$AUTH_OUT" "invalid argument" "authority override rejection is explicit"

set +e
MISSING_DISPOSITION_OUT="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --level l3 2>&1)"
MISSING_DISPOSITION_RC=$?
set -e
assert_eq "2" "$MISSING_DISPOSITION_RC" "legacy authority blocks before canonical disposition"
assert_contains "$MISSING_DISPOSITION_OUT" "exact legacy B/C terminal disposition is missing" \
  "missing legacy disposition fails closed"

FIRST_RECONCILE="$(node "$REPO_ROOT/scripts/mission-terminal-reconcile.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --graph-digest "$GRAPH_DIGEST")"
RECONCILE_OUT="$(node "$REPO_ROOT/scripts/mission-terminal-reconcile.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --graph-digest "$GRAPH_DIGEST")"
assert_eq "1" "$(jq '.writes' <<<"$FIRST_RECONCILE")" "isolated B/C reconciliation writes once"
assert_eq "2" "$(jq '.dispositions | length' <<<"$RECONCILE_OUT")" "exact B/C terminal pair is dispositioned"
assert_eq "0" "$(jq '.writes' <<<"$RECONCILE_OUT")" "durable B/C reconciliation replay is idempotent"
assert_eq "0:0:false" "$(jq -r '[.synthesized_work_orders,.mutated_receipts,.history_rewritten] | join(":")' <<<"$RECONCILE_OUT")" \
  "reconciliation synthesizes no authority and rewrites no history"
POST_RECONCILE_ADMISSION="$(node "$REPO_ROOT/scripts/mission-routing-admission.js" \
  --repo-root "$MISSION_FIXTURE_REPO" --level l3)"
assert_eq "READY" "$(jq -r '.status' <<<"$POST_RECONCILE_ADMISSION")" \
  "canonical disposition restores production Mission admission"

finalize_test
