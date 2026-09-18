'use strict';
// Freeze chain for mission blind-review-panel-parallel-2026-09-18:
// sources sha → graph ids → graph check → routing → legacy reconcile → task authority.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = '/home/cookys/projects/autopilot';
const slug = 'blind-review-panel-parallel-2026-09-18';
const planRel = 'plans/2026-09-18-blind-review-panel-parallel.md';
const rubricRel = 'plans/2026-09-18-blind-review-panel-parallel.rubric.md';
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

const graph = {
  artifact_type: 'mission_execution_graph',
  schema_version: 1,
  nodes: [{
    id: slug,
    acceptance_ids: ['fanout', 'batch-identity', 'panel-order', 'panel-timeout', 'pocket', 'verify-once', 'no-regression', 'scope-integrity'],
    campaign: {
      allowed_path_prefixes: [
        'CLAUDE.md', 'docs', 'hooks/tests', 'platforms/codex/plugin/references', 'platforms/codex/plugin/schemas',
        'platforms/codex/plugin/scripts', 'platforms/codex/plugin/skills', 'platforms/codex/plugin/src', 'references',
        'schemas', 'scripts', 'skills', 'src',
      ],
      baseline_churn: 3200,
      max_changed_files: 35,
      max_extra_churn: 1600,
      max_growth_ratio: 1.5,
      max_repair_generations: 2,
      max_wall_seconds: 7200,
      output_paths: [
        'scripts/lib/review-fanout.js', 'platforms/codex/plugin/scripts/lib/review-fanout.js',
        'src/runners/review.js', 'platforms/codex/plugin/src/runners/review.js',
        'src/engine/autopilot-engine.js', 'platforms/codex/plugin/src/engine/autopilot-engine.js',
        'src/engine/campaign-intake.js', 'platforms/codex/plugin/src/engine/campaign-intake.js',
        'src/engine/mission-execution-graph.js', 'platforms/codex/plugin/src/engine/mission-execution-graph.js',
        'src/engine/mission-convergence.js', 'platforms/codex/plugin/src/engine/mission-convergence.js',
        'src/engine/campaign-dispatch-projection.js', 'platforms/codex/plugin/src/engine/campaign-dispatch-projection.js',
        'schemas/mission-execution-graph.schema.json', 'platforms/codex/plugin/schemas/mission-execution-graph.schema.json',
        'schemas/implementation-campaign-contract.schema.json', 'platforms/codex/plugin/schemas/implementation-campaign-contract.schema.json',
        'schemas/implementation-campaign-receipt.schema.json', 'platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json',
        'hooks/tests/review-runner.test.sh', 'hooks/tests/autopilot-engine.test.sh', 'hooks/tests/implementation-campaign-dogfood.test.sh',
        'hooks/tests/implementation-campaign-routing.test.sh', 'hooks/tests/implementation-campaign-receipt.test.sh',
        'hooks/tests/campaign-dispatch-projection.test.sh', 'hooks/tests/mission-convergence.test.sh',
        'references/blind-dispatch.md', 'platforms/codex/plugin/references/blind-dispatch.md',
        'skills/l5/references/hetero-impl-loop.md', 'platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md',
        'docs/scripts-inventory.md', 'CLAUDE.md', 'docs/BACKLOG.md',
      ],
      authorized_creates: ['scripts/lib/review-fanout.js', 'platforms/codex/plugin/scripts/lib/review-fanout.js'],
      profile: 'high',
      required_paths: ['src/runners/review.js', 'src/engine/autopilot-engine.js', 'src/engine/campaign-intake.js', 'hooks/tests/autopilot-engine.test.sh', 'hooks/tests/review-runner.test.sh'],
      spec: { path: 'docs/plans/2026-09-18-blind-review-panel-parallel.md', section: '1. Ruling and shape' },
    },
    dependencies: [],
    gate_attempt_budget: 6,
    reservation: {
      campaigns: 1, canonical_changed_files: 35, engine_attempts: 3, external_wait_seconds: 1800,
      output_bytes: 3000000, tool_calls: 300, wall_seconds: 7200,
    },
    source_plan_ids: planIds,
    source_rubric_ids: rubricIds.sort(),
    verification_commands: [
      'bash hooks/tests/implementation-campaign-routing.test.sh',
      'bash hooks/tests/implementation-campaign-state.test.sh',
      'bash hooks/tests/resolve-review-loop-qc-panel-rejection.test.sh',
      'bash hooks/tests/dispatch-review.test.sh',
      'AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh',
      'bash hooks/tests/qc-panel-honesty.test.sh',
      'bash hooks/tests/implementation-campaign-dogfood.test.sh',
      'bash hooks/tests/resolve-review-loop.test.sh',
      'node scripts/check-js-syntax.js', 'node scripts/check-contract-schema.js',
      'bash scripts/sync-codex-plugin-skills.sh --check',
      'node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md',
    ],
  }],
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
    objective: 'Ship docs/plans/2026-09-18-blind-review-panel-parallel.md (cut 2-A): full_suite reuses an identity-equal green verification receipt, final-panel seats run concurrently below the synchronous composer through one fan-out helper with seat-index-ordered artifacts, and a sealed panel pocket keeps the panel from starving on the leftover wall.',
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
