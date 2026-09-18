'use strict';
// Freeze chain for mission blind-review-panel-station-2026-09-18:
// sources sha → graph ids → graph check → routing → legacy reconcile → task authority.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = '/home/cookys/projects/autopilot';
const slug = process.env.NODE === 'packet' ? 'blind-review-shared-packet-2026-09-18' : 'blind-review-panel-station-2026-09-18';
const planRel = 'plans/2026-09-18-blind-review-panel-station.md';
const rubricRel = 'plans/2026-09-18-blind-review-panel-station.rubric.md';
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const planSha = sha(path.join(root, 'docs', planRel));
const rubricSha = sha(path.join(root, 'docs', rubricRel));

const sourcesPath = path.join(root, 'docs', `mission-${slug}-sources.json`);
fs.writeFileSync(sourcesPath, `${JSON.stringify({
  schema_version: 1,
  sources: [{ plan_path: planRel, rubric_path: rubricRel, plan_sha256: planSha, rubric_sha256: rubricSha }],
}, null, 2)}\n`);

const { loadSourceCoverageManifest } = require(path.join(root, 'scripts', 'mission-execution-graph-check.js'));
const coverage = loadSourceCoverageManifest(sourcesPath);
const planIds = [...coverage.plan_ids || coverage.planIds || []];
const rubricIds = [...coverage.rubric_ids || coverage.rubricIds || []];
if (!planIds.length || !rubricIds.length) {
  console.error(JSON.stringify(Object.keys(coverage)));
  throw new Error('coverage shape unexpected');
}

// One plan file yields ONE source plan id and the graph checker requires each plan id to map to exactly one
// node, so the two deliverables ship as two lineages from the same plan bytes: NODE=station (first) and
// NODE=packet (after the station merge). Rubric coverage is a graph-level mapping rule (all ids, once), not
// the node's acceptance.
const NODE = process.env.NODE || 'station';
const allNodes = [{
    id: 'panel-review-station',
    acceptance_ids: ['station', 'station-safety', 'knob', 'no-regression', 'scope-integrity'],
    campaign: {
      allowed_path_prefixes: [
        '.claude', 'docs', 'hooks/tests', 'platforms/codex/plugin/project-config-template', 'platforms/codex/plugin/references',
        'platforms/codex/plugin/schemas', 'platforms/codex/plugin/scripts', 'platforms/codex/plugin/skills', 'platforms/codex/plugin/src',
        'project-config-template', 'references', 'schemas', 'scripts', 'skills', 'src',
      ],
      baseline_churn: 3000,
      max_changed_files: 27,
      max_extra_churn: 1500,
      max_growth_ratio: 1.5,
      max_repair_generations: 2,
      max_wall_seconds: 7200,
      final_panel_reserve_seconds: 900,
      full_suite_reuse: true,
      output_paths: [
        'src/engine/campaign-composition.js', 'platforms/codex/plugin/src/engine/campaign-composition.js',
        'src/engine/autopilot-engine.js', 'platforms/codex/plugin/src/engine/autopilot-engine.js',
        'src/engine/campaign-intake.js', 'platforms/codex/plugin/src/engine/campaign-intake.js',
        'src/engine/resolve-review-loop.js', 'platforms/codex/plugin/src/engine/resolve-review-loop.js',
        'scripts/resolve-review-loop.sh', 'platforms/codex/plugin/scripts/resolve-review-loop.sh',
        'schemas/review-loop-contract.schema.json', 'platforms/codex/plugin/schemas/review-loop-contract.schema.json',
        'schemas/implementation-campaign-receipt.schema.json', 'platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json',
        'hooks/tests/implementation-campaign-routing.test.sh', 'hooks/tests/autopilot-engine.test.sh',
        'hooks/tests/implementation-campaign-state.test.sh', 'hooks/tests/resolve-review-loop.test.sh',
        'references/blind-dispatch.md', 'platforms/codex/plugin/references/blind-dispatch.md',
        '.claude/review-loop-config.md', 'project-config-template/review-loop-config.md', 'platforms/codex/plugin/project-config-template/review-loop-config.md',
        'skills/l5/references/hetero-impl-loop.md', 'platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md',
        'docs/BACKLOG.md',
      ],
      authorized_creates: [],
      profile: 'high',
      required_paths: ['src/engine/campaign-composition.js', 'src/engine/autopilot-engine.js', 'src/engine/campaign-intake.js', 'scripts/resolve-review-loop.sh'],
      spec: { path: 'docs/plans/2026-09-18-blind-review-panel-station.md', section: '1. Ruling and shape' },
    },
    dependencies: [],
    gate_attempt_budget: 6,
    reservation: {
      campaigns: 1, canonical_changed_files: 27, engine_attempts: 3, external_wait_seconds: 1800,
      output_bytes: 3000000, tool_calls: 300, wall_seconds: 7200,
    },
    source_plan_ids: planIds,
    source_rubric_ids: rubricIds.sort(),
    verification_commands: [
      'bash hooks/tests/implementation-campaign-routing.test.sh',
      'bash hooks/tests/autopilot-engine.test.sh',
      'bash hooks/tests/implementation-campaign-state.test.sh',
      'bash hooks/tests/implementation-campaign-receipt.test.sh',
      'bash hooks/tests/qc-panel-honesty.test.sh',
      'bash hooks/tests/resolve-review-loop.test.sh',
      'bash hooks/tests/review-packet.test.sh',
      'bash hooks/tests/review-runner.test.sh',
      'bash hooks/tests/implementation-campaign-dogfood.test.sh',
      'bash hooks/tests/mission-runtime-v2.test.sh',
      'node scripts/check-js-syntax.js',
      'bash scripts/sync-codex-plugin-skills.sh --check',
      'node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md',
    ],
  }, {
    id: 'shared-packet',
    acceptance_ids: ['packet-once', 'tree-hash-batch', 'no-regression', 'scope-integrity'],
    campaign: {
      allowed_path_prefixes: [
        'docs', 'hooks/tests', 'platforms/codex/plugin/references', 'platforms/codex/plugin/src', 'references', 'src',
      ],
      baseline_churn: 1500,
      max_changed_files: 13,
      max_extra_churn: 750,
      max_growth_ratio: 1.5,
      max_repair_generations: 2,
      max_wall_seconds: 7200,
      final_panel_reserve_seconds: 900,
      full_suite_reuse: true,
      output_paths: [
        'src/runners/review.js', 'platforms/codex/plugin/src/runners/review.js',
        'src/runners/review-packet.js', 'platforms/codex/plugin/src/runners/review-packet.js',
        'src/engine/autopilot-engine.js', 'platforms/codex/plugin/src/engine/autopilot-engine.js',
        'hooks/tests/review-packet.test.sh', 'hooks/tests/review-runner.test.sh', 'hooks/tests/autopilot-engine.test.sh',
        'references/blind-dispatch.md', 'platforms/codex/plugin/references/blind-dispatch.md',
        'docs/BACKLOG.md',
      ],
      authorized_creates: [],
      profile: 'high',
      required_paths: ['src/runners/review.js', 'src/runners/review-packet.js', 'src/engine/autopilot-engine.js'],
      spec: { path: 'docs/plans/2026-09-18-blind-review-panel-station.md', section: '1. Ruling and shape' },
    },
    dependencies: ['panel-review-station'],
    gate_attempt_budget: 6,
    reservation: {
      campaigns: 1, canonical_changed_files: 13, engine_attempts: 3, external_wait_seconds: 1800,
      output_bytes: 3000000, tool_calls: 300, wall_seconds: 7200,
    },
    source_plan_ids: planIds,
    source_rubric_ids: rubricIds.sort(),
    verification_commands: [
      'bash hooks/tests/implementation-campaign-routing.test.sh',
      'bash hooks/tests/autopilot-engine.test.sh',
      'bash hooks/tests/implementation-campaign-state.test.sh',
      'bash hooks/tests/implementation-campaign-receipt.test.sh',
      'bash hooks/tests/qc-panel-honesty.test.sh',
      'bash hooks/tests/resolve-review-loop.test.sh',
      'bash hooks/tests/review-packet.test.sh',
      'bash hooks/tests/review-runner.test.sh',
      'bash hooks/tests/implementation-campaign-dogfood.test.sh',
      'bash hooks/tests/mission-runtime-v2.test.sh',
      'node scripts/check-js-syntax.js',
      'bash scripts/sync-codex-plugin-skills.sh --check',
      'node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md',
    ],
  }];
const graph = {
  artifact_type: 'mission_execution_graph',
  schema_version: 1,
  nodes: [NODE === 'packet' ? { ...allNodes[1], dependencies: [] } : allNodes[0]],
};
const graphPath = path.join(root, 'docs', `mission-${slug}-execution-graph.json`);
fs.writeFileSync(graphPath, `${JSON.stringify(graph, null, 1)}\n`);

const mirrorRoots = execFileSync('bash', [path.join(root, 'scripts/sync-codex-plugin-skills.sh'), '--mirror-roots-json'], { cwd: root, encoding: 'utf8' });
const mrPath = path.join(process.env.SCRATCH, 'mirror-roots.json');
fs.writeFileSync(mrPath, mirrorRoots);
const check = JSON.parse(execFileSync('node', [
  path.join(root, 'scripts/mission-execution-graph-check.js'),
  '--graph', graphPath, '--governance', path.join(root, '.claude/owner-kernel-governance.json'),
  '--sources', sourcesPath, '--mirror-roots', mrPath,
], { cwd: root, encoding: 'utf8' }));
console.log('graph-check', check.status, check.graph_digest, check.rejection || '');
if (check.status !== 'READY') process.exit(1);

fs.writeFileSync(path.join(root, '.claude/mission-routing-config.json'), `${JSON.stringify({
  schema_version: 1,
  graph_path: `docs/mission-${slug}-execution-graph.json`,
  sources_path: `docs/mission-${slug}-sources.json`,
}, null, 2)}\n`);

const reconcile = execFileSync('node', [
  path.join(root, 'scripts/mission-terminal-reconcile.js'), 'legacy', '--repo-root', root,
  '--graph-digest', check.graph_digest,
], { cwd: root, encoding: 'utf8' });
console.log('reconcile', reconcile.trim().slice(0, 300));

const kernel = require(path.join(root, 'src/engine/owner-kernel'));
const governance = JSON.parse(fs.readFileSync(path.join(root, '.claude/owner-kernel-governance.json'), 'utf8'));
const policy = kernel.resolveGovernancePolicy(governance);
const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
const commonAbs = path.resolve(root, common);
const frozen = kernel.freezeTaskAuthorityEnvelope({
  taskId: slug,
  policy: policy.policy,
  policyHash: policy.policy_hash,
  intent: {
    objective: 'Ship docs/plans/2026-09-18-blind-review-panel-station.md (cut 2-C): with a sealed panel the implementation loop reviews through the panel (no single seat, repair rounds re-panel, terminal panel reused, station choice sealed in the snapshot), and one review packet per candidate is built once, materialised privately per seat and tree-hashed in one batch.',
    requirements_hash: planSha,
    scope: {
      allowed_tools: ['bash', 'git', 'node'],
      artifact_roots: ['docs', 'hooks', 'platforms', 'references', 'scripts', 'skills', 'src'],
      domains: ['autopilot', 'integration'],
      languages: ['javascript', 'shell'],
      task_classes: ['implementation', 'verification'],
    },
  },
  acceptance: { contract_hash: planSha, criteria_hash: rubricSha, required_evidence: ['mirror-parity', 'review', 'tests'] },
  resourceCeiling: { max_cost_usd_micros: 50000000, max_grant_ttl_seconds: 3600, max_tokens: 1000000, max_tool_calls: 1500, max_wall_seconds: 36000 },
  escalationPolicy: { on_role_denied: 'block', on_scope_mismatch: 'block', protected_effects_require_escalation: true },
  finishReceiptSchema: { schema_id: 'mission-finish-v1', required_fields: ['authority_status', 'decisions_outside_user_intent', 'effective_profile', 'evidence'] },
  effectPermissions: { effects: [] },
  dataEgressRules: [],
  missionAuthority: { repoIdentity: `git-common-dir:${commonAbs}`, graphDigest: check.graph_digest },
});
const authPath = path.join(root, 'docs', `mission-${slug}-task-authority.json`);
fs.writeFileSync(authPath, `${JSON.stringify(frozen.envelope, null, 2)}\n`);
console.log('authority', frozen.envelope.task_authority_id, frozen.envelope.mission_lineage_id);
