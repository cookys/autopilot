'use strict';

// The next-touch validation suite used to read the Mission artifacts of the
// real 2026-08-03 next-touch-debt-retirement run out of this machine's
// .git/autopilot. Those are not versioned, so a clean clone had nothing to read
// and the suite crashed on ENOENT — permanently red in CI, green only on the
// one machine that happened to hold them.
//
// This builds the equivalent Mission from scratch. The fixture repository is a
// local hardlink clone of the repo under test (~0.3s), which is what makes the
// rest cheap: it carries the real commit history, the real tracked artifacts
// (the archived authorization receipt, the grok A/B evidence), and a Mission
// store of its own, so nothing has to be synthesised except the Mission.
//
// Identity is deliberately borrowed from the tracked archive authorization
// rather than derived: lineage, policy digest, graph digest and adoption key
// are restated as the values that receipt pins. That is what lets the fixture
// reach the same validator branch the real artifacts reached —
// MISSION_GRANT_INVALID at the grant check, rather than tripping the earlier
// binding check and quietly testing something else. The digests cannot be
// recomputed from source: docs/mission-next-touch-debt-retirement-execution-
// graph.json has drifted from what the authorization pins.
//
// The end state is ACTIVE with zero active claims, reached by granting and then
// releasing. Granting alone leaves one active claim and a different rejection.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ARCHIVE_AUTHORIZATION = path.join(
  'docs', 'projects', '_archive', '2026-08-03-next-touch-debt-retirement',
  'evidence', 'authorization.json',
);
const PREPARED_RELATIVE = path.join(
  'autopilot', 'mission', 'next-touch-debt-retirement', 'successor-prepared.json',
);
// findPreparedReceipt filters candidates by a prefix taken from
// authorization.branch, so the fixture has to carry the archived adoption key.
const ADOPTION_KEY = '7e8e6806aee84794b0283f27a1f0b04c47919338d97229242ced28ad891258ee';

function graphFor(nodeId) {
  return {
    schema_version: 1,
    artifact_type: 'mission_execution_graph',
    nodes: [{
      id: nodeId,
      source_plan_ids: ['MISSION'],
      source_rubric_ids: ['MISSIONR1'],
      dependencies: [],
      acceptance_ids: ['next-touch-ready'],
      verification_commands: ['node fixture.js'],
      gate_attempt_budget: 4,
      reservation: {
        campaigns: 1, wall_seconds: 100, tool_calls: 3, engine_attempts: 2,
        external_wait_seconds: 0, canonical_changed_files: 2, output_bytes: 1024,
      },
      campaign: {
        profile: 'poc',
        allowed_path_prefixes: ['src/'],
        spec: { path: 'src/value.txt', section: 'Next touch' },
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
    calculated_batches: 1,
    calculated_depth: 1,
  };
}

/**
 * @param {object} options
 * @param {string} options.root     repo under test — module source and clone source
 * @param {string} options.scratch  writable directory for the clone and inputs
 * @returns {{fixtureRepo, preparedPath, adoptionKey, authorizationPath, missionRoot, repoInfo}}
 */
function buildNextTouchMissionFixture({ root, scratch } = {}) {
  if (!root) throw new TypeError('buildNextTouchMissionFixture requires root');
  if (!scratch) throw new TypeError('buildNextTouchMissionFixture requires scratch');

  const runtime = require(path.join(root, 'src', 'mission', 'runtime'));
  const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
  const missionPolicy = require(path.join(root, 'src', 'engine', 'mission-policy'));
  const missionGraph = require(path.join(root, 'src', 'engine', 'mission-execution-graph'));
  const { runMissionCli } = require(path.join(root, 'src', 'mission', 'cli'));

  const fixtureRepo = path.join(scratch, 'next-touch-mission-fixture');
  execFileSync('git', ['clone', '-q', root, fixtureRepo]);
  execFileSync('git', ['-C', fixtureRepo, 'config', 'user.email', 'fixture@example.invalid']);
  execFileSync('git', ['-C', fixtureRepo, 'config', 'user.name', 'Next Touch Fixture']);
  // The graph node's spec must resolve at the grant base. Commit a file the
  // fixture owns, so a later edit to real repo content cannot break it.
  fs.mkdirSync(path.join(fixtureRepo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRepo, 'src', 'value.txt'), '## Next touch\nbase\n');
  execFileSync('git', ['-C', fixtureRepo, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', fixtureRepo, 'commit', '-qm', 'next-touch fixture spec anchor']);

  const authorizationPath = path.join(fixtureRepo, ARCHIVE_AUTHORIZATION);
  const authorization = JSON.parse(fs.readFileSync(authorizationPath, 'utf8'));
  const graph = graphFor(authorization.graph_node_id);
  const sha = (value) => mission.sha256(
    typeof value === 'string' ? value : mission.canonicalJson(value),
  );
  // One full task-authority envelope serves as both the prepare input and the
  // file left beside the receipt, which is how the historical run had it. The
  // envelope key set is closed, so every field below is required.
  const authority = {
    schema_version: 1,
    task_id: 'next-touch-fixture',
    task_authority_id: sha('next-touch-task-authority'),
    policy_hash: sha('next-touch-owner-policy'),
    authority_status: 'shadow',
    intent: {
      objective: 'next-touch validation fixture',
      requirements_hash: sha('next-touch-requirements'),
      scope: {
        allowed_tools: ['bash', 'git', 'node'],
        artifact_roots: ['hooks', 'scripts', 'src'],
        domains: ['autopilot'],
        languages: ['javascript', 'shell'],
        task_classes: ['implementation', 'verification'],
      },
    },
    acceptance: {
      contract_hash: sha('next-touch-acceptance-contract'),
      criteria_hash: sha('next-touch-acceptance-criteria'),
      required_evidence: ['tests'],
    },
    red_lines: ['no-external-publish', 'no-production-push', 'no-secret-disclosure'],
    effect_permissions: { effects: [] },
    resource_ceiling: {
      max_cost_usd_micros: 50000000,
      max_grant_ttl_seconds: 3600,
      max_tokens: 1000000,
      max_tool_calls: 1500,
      max_wall_seconds: 36000,
    },
    data_egress_policy: { mode: 'local-only', rules: [] },
    escalation_policy: {
      on_role_denied: 'block',
      on_scope_mismatch: 'block',
      protected_effects_require_escalation: true,
    },
    finish_receipt_schema: {
      required_fields: [
        'authority_status', 'decisions_outside_user_intent', 'effective_profile', 'evidence',
      ],
      schema_id: 'mission-finish-v1',
    },
    execution_preferences: {
      assurance_profile: 'conservative',
      assurance_source: 'task-override',
      data_egress: 'local-only',
      data_egress_source: 'task-override',
      guidance_profile: 'guided',
      guidance_source: 'task-override',
      topology_preference: 'heterogeneous',
      topology_source: 'task-override',
    },
    mission_lineage_id: authorization.mission_lineage_id,
    mission_policy_digest: authorization.mission_policy_digest,
    mission_graph_digest: authorization.mission_graph_digest,
  };

  const authorityPath = path.join(scratch, 'next-touch-authority.json');
  const graphPath = path.join(scratch, 'next-touch-graph.json');
  fs.writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 2)}\n`);

  const commonDir = fs.realpathSync(execFileSync(
    'git', ['-C', fixtureRepo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' },
  ).trim());
  const preparedPath = path.join(commonDir, PREPARED_RELATIVE);
  fs.mkdirSync(path.dirname(preparedPath), { recursive: true });
  // The historical run left its task authority next to the receipt, and a
  // later block reads it back as the taskAuthority input for its own prepare.
  fs.writeFileSync(
    path.join(path.dirname(preparedPath), 'task-authority.envelope.json'),
    `${JSON.stringify(authority, null, 2)}\n`,
  );

  const capture = () => {
    let out = '';
    let err = '';
    return {
      stdout: { write: (v) => { out += v; } },
      stderr: { write: (v) => { err += v; } },
      read: () => ({ out, err }),
    };
  };

  const previousSeam = process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS;
  process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';
  const prepareIo = capture();
  const prepareCode = runMissionCli([
    'prepare', '--repo', fixtureRepo, '--authority', authorityPath,
    '--graph', graphPath, '--out', preparedPath,
  ], {
    cwd: fixtureRepo,
    stdout: prepareIo.stdout,
    stderr: prepareIo.stderr,
    // Real producers do the work; only the four identity values are restated
    // as the ones the tracked archive authorization pins.
    testOnlyDependencies: {
      resolveMissionPolicy: (...args) => ({
        ...missionPolicy.resolveMissionPolicy(...args),
        policy_digest: authorization.mission_policy_digest,
      }),
      freezeMissionExecutionGraph: (...args) => ({
        ...missionGraph.freezeMissionExecutionGraph(...args),
        graph_digest: authorization.mission_graph_digest,
      }),
      deriveMissionLineageId: () => authorization.mission_lineage_id,
      deriveMissionAdoptionKey: () => ADOPTION_KEY,
    },
  });
  if (previousSeam === undefined) delete process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS;
  else process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = previousSeam;
  if (prepareCode !== 0) {
    throw new Error(`next-touch fixture prepare failed: ${prepareIo.read().err}`);
  }

  const grantIo = capture();
  const grantCode = runMissionCli([
    'grant', '--repo', fixtureRepo, '--prepared', preparedPath,
    '--node', authorization.graph_node_id, '--now', '2026-08-05T00:00:00.000Z',
  ], { cwd: fixtureRepo, stdout: grantIo.stdout, stderr: grantIo.stderr });
  if (grantCode !== 0) {
    throw new Error(`next-touch fixture grant failed: ${grantIo.read().err}`);
  }

  // Release the claim so the mission stays ACTIVE with zero active claims —
  // the shape the real artifacts had, and the one that reaches the grant check.
  const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
  const store = runtime.openPreparedMissionStateStore({
    repo: fixtureRepo, preparedReceipt: prepared,
  });
  const granted = store.load();
  const claimId = Object.keys(granted.claims || {})[0];
  if (!claimId) throw new Error('next-touch fixture grant produced no claim');
  const released = mission.reduceMissionState(granted, {
    event_type: 'no_effect_release',
    sequence: granted.events.length + 1,
    mission_lineage_id: granted.mission_lineage_id,
    payload: { claim_id: claimId },
  });
  if (released.receipt.artifact_type !== 'mission_no_effect_release') {
    throw new Error(`next-touch fixture release rejected: ${released.receipt.artifact_type}`);
  }
  if (store.save(granted, released.state) !== true) {
    throw new Error('next-touch fixture release did not persist');
  }

  return {
    fixtureRepo,
    preparedPath,
    adoptionKey: ADOPTION_KEY,
    authorizationPath,
    missionRoot: path.join(commonDir, 'autopilot', 'mission'),
    repoInfo: runtime.canonicalRepository(fixtureRepo),
  };
}

// Re-derive the handles for an already-built fixture. The suite builds once and
// passes the repository path down; every later block reads it back through
// this rather than paying for another clone.
function describeNextTouchMissionFixture({ root, fixtureRepo } = {}) {
  if (!root) throw new TypeError('describeNextTouchMissionFixture requires root');
  if (!fixtureRepo) throw new TypeError('describeNextTouchMissionFixture requires fixtureRepo');
  const runtime = require(path.join(root, 'src', 'mission', 'runtime'));
  const repoInfo = runtime.canonicalRepository(fixtureRepo);
  return {
    fixtureRepo,
    repoInfo,
    preparedPath: path.join(repoInfo.common, PREPARED_RELATIVE),
    missionRoot: path.join(repoInfo.common, 'autopilot', 'mission'),
    authorizationPath: path.join(fixtureRepo, ARCHIVE_AUTHORIZATION),
    adoptionKey: ADOPTION_KEY,
  };
}

module.exports = {
  buildNextTouchMissionFixture,
  describeNextTouchMissionFixture,
  ARCHIVE_AUTHORIZATION,
  ADOPTION_KEY,
};
