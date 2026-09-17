'use strict';
// Freeze chain for mission blind-review-cleanroom-launcher-2026-09-17:
// sources sha → graph ids → graph check → routing → legacy reconcile → task authority.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = '/home/cookys/projects/autopilot';
const slug = 'blind-review-cleanroom-launcher-2026-09-17';
const planRel = 'plans/2026-09-17-blind-review-cleanroom-launcher.md';
const rubricRel = 'plans/2026-09-17-blind-review-cleanroom-launcher.rubric.md';
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
    acceptance_ids: ['tier-gate', 'launcher-contract', 'boundary', 'preflight', 'no-regression', 'scope-integrity'],
    campaign: {
      allowed_path_prefixes: [
        'CLAUDE.md', 'docs', 'hooks/tests', 'platforms/codex/plugin/references', 'platforms/codex/plugin/scripts',
        'references', 'scripts',
      ],
      baseline_churn: 2400,
      max_changed_files: 14,
      max_extra_churn: 1200,
      max_growth_ratio: 1.5,
      max_repair_generations: 2,
      max_wall_seconds: 7200,
      output_paths: [
        'scripts/lib/cleanroom-launch.sh', 'platforms/codex/plugin/scripts/lib/cleanroom-launch.sh',
        'scripts/dispatch-review.sh', 'platforms/codex/plugin/scripts/dispatch-review.sh',
        'hooks/tests/cleanroom-launch.test.sh', 'hooks/tests/dispatch-review.test.sh',
        'references/blind-dispatch.md', 'platforms/codex/plugin/references/blind-dispatch.md',
        'docs/scripts-inventory.md', 'CLAUDE.md', 'docs/BACKLOG.md',
      ],
      authorized_creates: [
        'scripts/lib/cleanroom-launch.sh', 'platforms/codex/plugin/scripts/lib/cleanroom-launch.sh',
        'hooks/tests/cleanroom-launch.test.sh',
      ],
      profile: 'high',
      required_paths: ['scripts/dispatch-review.sh', 'hooks/tests/dispatch-review.test.sh', 'references/blind-dispatch.md', 'docs/scripts-inventory.md'],
      spec: { path: 'docs/plans/2026-09-17-blind-review-cleanroom-launcher.md', section: '1. Ruling and shape' },
    },
    dependencies: [],
    gate_attempt_budget: 6,
    reservation: {
      campaigns: 1, canonical_changed_files: 14, engine_attempts: 3, external_wait_seconds: 1800,
      output_bytes: 3000000, tool_calls: 300, wall_seconds: 7200,
    },
    source_plan_ids: planIds,
    source_rubric_ids: rubricIds.sort(),
    verification_commands: [
      'bash hooks/tests/dispatch-review.test.sh',
      'AUTOPILOT_HOST_ISOLATION=1 bash hooks/tests/cleanroom-launch.test.sh',
      'bash hooks/tests/review-runner.test.sh',
      'bash hooks/tests/review-packet.test.sh',
      'node scripts/check-js-syntax.js', 'bash scripts/sync-codex-plugin-skills.sh --check',
      'node scripts/check-claude-md-inventory.js',
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
    objective: 'Ship docs/plans/2026-09-17-blind-review-cleanroom-launcher.md (cut 1b-A): scripts/lib/cleanroom-launch.sh runs a tool-capable reviewer inside a bwrap boundary that exposes only the review packet tree, a throwaway seat HOME and the runtime; dispatch-review.sh resolves seat tiers (packet/cleanroom/none) under blind mode and fails closed before any spend; a host-gated isolation suite drives the real launcher with a hostile stub.',
    requirements_hash: planSha,
    scope: {
      allowed_tools: ['bash', 'git', 'node'],
      artifact_roots: ['CLAUDE.md', 'docs', 'hooks', 'platforms', 'references', 'scripts'],
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
