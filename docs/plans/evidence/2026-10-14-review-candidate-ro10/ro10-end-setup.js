#!/usr/bin/env node
// usage: node ro10-setup.js <outdir> <trivial|defect>
// Builds a throwaway repo + externally produced range + adoption contract + seal (shadow, no governance files).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
// The plugin checkout this script lives in (docs/plans/evidence/<dir>/ is four levels below the root);
// AUTOPILOT_ROOT overrides it.
const REPO_ROOT = process.env.AUTOPILOT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const [outDir, kind] = process.argv.slice(2);
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8' }).trim();
fs.rmSync(outDir, { recursive: true, force: true });
const repo = path.join(outDir, 'repo');
fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
git(repo, 'init', '-q');
git(repo, 'config', 'user.email', 'ro10@example.invalid');
git(repo, 'config', 'user.name', 'ro10');
git(repo, 'config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, 'src', 'math.js'),
  'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
fs.writeFileSync(path.join(repo, 'test.js'), "const m = require('./src/math.js');\nif (m.add(2, 1) !== 3) process.exit(1);\n");
fs.writeFileSync(path.join(repo, 'README.md'), 'throwaway repo for BL-0090 RO10\n');
fs.mkdirSync(path.join(repo, '.claude'), { recursive: true });
for (const f of ['dispatch-config.md', 'model-routing-config.md', 'review-loop-config.md']) {
  fs.copyFileSync(path.join(REPO_ROOT, '.claude', f), path.join(repo, '.claude', f));
}
// The implementer seat is unused by review-only but l4 readiness still probes it; the host's grok
// implementer is quota_exhausted today, so this throwaway repo resolves the previous cursor route.
{
  const cfgPath = path.join(repo, '.claude', 'review-loop-config.md');
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg.replace('- implementer_engine: grok-4.7', '- implementer_engine: cursor-grok-4.6-low')
    .replace('- implementer_runner: grok', '- implementer_runner: cursor')
    .replace('- verification_author_present: true', '- verification_author_present: false')
    .replace('- verification_author_engine: Qwen3.8-Max-Preview', '- verification_author_engine:')
    .replace('- verification_author_runner: qoderclicn', '- verification_author_runner:')
    .replace('- verification_author_effort: high', '- verification_author_effort:');
  fs.writeFileSync(cfgPath, cfg);
}
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'base');
const base = git(repo, 'rev-parse', 'HEAD');
const branch = `external/${kind}`;
const wt = path.join(outDir, 'author-wt');
git(repo, 'worktree', 'add', '-q', '-b', branch, wt, base);
if (kind === 'trivial') {
  fs.writeFileSync(path.join(wt, 'src', 'math.js'),
    'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a - b;\n}\nmodule.exports = { add, sub };\n');
} else {
  // planted defect: subtract is implemented as addition, and the spec says it must subtract
  fs.writeFileSync(path.join(wt, 'src', 'math.js'),
    'function add(a, b) {\n  return a + b;\n}\n\nfunction sub(a, b) {\n  return a + b;\n}\nmodule.exports = { add, sub };\n');
}
git(wt, 'add', '-A');
git(wt, 'commit', '-qm', `external ${kind} change`);
const head = git(wt, 'rev-parse', 'HEAD');
git(repo, 'worktree', 'remove', '--force', wt);
const commonDir = fs.realpathSync(path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir')));
const contract = {
  schema_version: 1, ticket: `ro10-${kind}-${Date.now()}`, profile: 'poc', mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`, base_sha: base, branch,
  vertical_acceptance: ['src/math.js exports sub(a, b) that returns a minus b'],
  allowed_path_prefixes: ['src/'], max_changed_files: 3,
  baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5,
  max_repair_generations: 0, max_wall_seconds: 1500, final_panel_reserve_seconds: 0,
  verify_cmd: 'node test.js',
  rubric_ids: ['ICC-RC1'],
  adoption: { head_sha: head },
};
fs.writeFileSync(path.join(outDir, 'contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'spec.md'),
  'Add a function sub(a, b) to src/math.js that returns a minus b, and export it next to add.\n');
const seal = spawnSync(process.execPath, [
  path.join(REPO_ROOT, 'scripts', 'implementation-campaign-check.js'),
  'seal', '--contract', path.join(outDir, 'contract.json'), '--repo', repo,
  '--mission-mode', 'off', '--out', path.join(outDir, 'seal.json'),
], { cwd: repo, encoding: 'utf8' });
process.stdout.write(`${JSON.stringify({ repo, base, head, branch, seal_status: seal.status, seal_out: `${seal.stdout}${seal.stderr}`.slice(0, 400) })}\n`);
