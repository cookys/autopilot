#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  checkMissionGraphCoverage,
} = require('../src/engine/mission-execution-graph');
const { resolveMissionPolicy } = require('../src/engine/mission-policy');
const LAYOUT = require('./lib/repo-layout.js');

function usage() {
  return [
    'Usage:',
    '  mission-execution-graph-check.js --graph <json> --governance <json>',
    '    --sources <frozen-source-manifest.json> [--mirror-roots <json>] [--repo-root <dir>]',
    '',
    '  --repo-root: defaults to `git rev-parse --show-toplevel`. Any node whose',
    '    campaign.spec.path is docs/plans/<stem>.md (active, not _archive) must have a',
    '    docs/projects/INDEX.md row with Version "active" (spec_plan_unregistered if not) —',
    '    auto-allowed when the repo has no docs/projects/INDEX.md at all.',
    '',
    '  --mirror-roots {"root": "<mirror root>", "dirs": [...]} (scripts/sync-codex-plugin-skills.sh',
    '    --mirror-roots-json): every node output_path under a mirrored dir must be accompanied by',
    '    its <root>/<path> mirror in the same output_paths. The mirror set is a REPO property;',
    '    the graph author enumerates what they are thinking about. Refusing here is free; the',
    '    boundary rejection after a paid implementation round is not (BACKLOG 2026-09-12).',
  ].join('\n');
}

function parse(argv) {
  const options = {};
  const allowed = new Map([
    ['--graph', 'graph'],
    ['--governance', 'governance'],
    ['--sources', 'sources'],
    ['--mirror-roots', 'mirrorRoots'],
    ['--repo-root', 'repoRoot'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = allowed.get(argv[index]);
    if (!key || argv[index + 1] === undefined) throw new Error(`invalid argument: ${argv[index] || ''}`);
    options[key] = argv[index + 1];
  }
  if (!options.graph || !options.governance || !options.sources) {
    throw new Error('--graph, --governance, and --sources are required');
  }
  return options;
}

function gitToplevel(dir) {
  try {
    return require('child_process').execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

// A node's campaign.spec.path under docs/plans/ (not _archive) is a plan the campaign is
// authored against; it must carry the same docs/projects/INDEX.md `active` registration as
// any other live plan (shares the lookup with scripts/check-plan-graduation.js's own
// plan_unregistered gate — see that script's planIndexRegistration/registerTemplateRow).
// Auto-allowed (no refusal) when the target repo has no docs/projects/INDEX.md at all.
function checkSpecPlanRegistration(graph, repoRoot) {
  const plansRel = LAYOUT.pathFor(repoRoot, 'plans_dir');
  const indexRel = LAYOUT.pathFor(repoRoot, 'projects_index');
  const indexPath = path.join(repoRoot, indexRel);
  if (!fs.existsSync(indexPath)) return;
  const gate = require('./check-plan-graduation.js');
  const plansDir = path.join(repoRoot, plansRel);
  const specPathRe = new RegExp(`^${plansRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)\\.md(?:#.*)?$`);
  const missing = [];
  for (const [index, node] of (graph.nodes || []).entries()) {
    const specPath = node && node.campaign && node.campaign.spec && node.campaign.spec.path;
    if (typeof specPath !== 'string') continue;
    const m = specPath.match(specPathRe);
    if (!m) continue;
    const stem = m[1];
    if (stem.startsWith('_archive')) continue; // archived — out of the registry's scope
    const registration = gate.planIndexRegistration(repoRoot, stem);
    if (!registration.indexExists || registration.activeRow) continue;
    const row = gate.registerTemplateRow(repoRoot, plansDir, path.join(plansDir, '_archive'), stem);
    const label = `graph.nodes[${index}]${node && node.id ? `(${node.id})` : ''}`;
    missing.push(`${label}.campaign.spec.path (${specPath}) has no ${indexRel} row `
      + `with Version "active" — paste: ${row}`);
  }
  if (missing.length > 0) {
    throw new Error(`spec_plan_unregistered: ${missing.join('; ')}`);
  }
}

function readJson(file, label) {
  const target = path.resolve(file);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid readable JSON: ${error.message}`);
  }
  return value;
}

function sha256(bytes) {
  return require('crypto').createHash('sha256').update(bytes).digest('hex');
}

function contentBoundRubricId(planHash, rubricHash, rubricId) {
  const digest = sha256(`${planHash}:${rubricHash}:${rubricId}`);
  return `R${BigInt(`0x${digest}`).toString(10)}`;
}

// opts.repoRoot (REQUIRED unless opts.noLayout): the caller's repo. Its layout registry decides the manifest
// base and the manifest must lie inside it (MANIFEST_OUTSIDE_REPO otherwise); nothing is inferred from the
// manifest. opts.noLayout is the one explicit fixture mode (only code can pass it): the base is the manifest's own
// directory, still checked by containedPath.
function loadSourceCoverageManifest(manifestPath, opts) {
  // Step 1, before the manifest is opened: the caller's repoRoot validates the LITERAL and the physical path
  // (LAYOUT.manifestBase). A manifest outside the repo is refused without a single read of its bytes.
  const repoRootForBase = (opts && opts.noLayout) ? null : (opts && opts.repoRoot);
  if (!(opts && opts.noLayout) && !repoRootForBase) {
    const missing = new Error('loadSourceCoverageManifest: opts.repoRoot is required');
    missing.code = 'MANIFEST_REPO_ROOT_REQUIRED';
    throw missing;
  }
  const literalManifest = path.resolve(manifestPath);
  const baseDir = repoRootForBase ? LAYOUT.manifestBase(repoRootForBase, literalManifest).base : null;
  // Step 2: only now canonicalise and read.
  let canonicalManifest;
  try {
    canonicalManifest = fs.realpathSync(manifestPath);
  } catch (error) {
    throw new Error(`source manifest is not readable: ${error.message}`);
  }
  const manifest = readJson(canonicalManifest, 'source manifest');
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.sources)
      || manifest.sources.length === 0
      || Object.keys(manifest).some((key) => !new Set(['schema_version', 'sources']).has(key))) {
    throw new Error('source manifest must be a versioned non-empty source set');
  }
  let root = path.dirname(canonicalManifest);
  if (baseDir) {
    try { root = fs.realpathSync(baseDir); } catch {
      const missing = new Error(`source manifest base ${baseDir} does not exist`);
      missing.code = 'MANIFEST_BASE_INVALID';
      throw missing;
    }
  }
  const planIds = [];
  const rubricIds = [];
  const authoringUnitIds = [];
  const seenRealTargets = new Set();
  for (const [index, source] of manifest.sources.entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)
        || Object.keys(source).some((key) => !new Set([
          'plan_path',
          'rubric_path',
          'plan_sha256',
          'rubric_sha256',
        ]).has(key))) {
      throw new Error(`source manifest.sources[${index}] is invalid`);
    }
    for (const field of ['plan_path', 'rubric_path', 'plan_sha256', 'rubric_sha256']) {
      if (typeof source[field] !== 'string' || source[field].length === 0) {
        throw new Error(`source manifest.sources[${index}].${field} is required`);
      }
    }
    // One containment check for every reader (repo-layout containedPath); an escape is thrown, never repaired.
    const resolveUnderBase = (field, authored) => {
      try {
        return repoRootForBase
          ? LAYOUT.resolveManifestPath(repoRootForBase, literalManifest, authored)
          : LAYOUT.containedPath(root, authored);
      } catch (error) {
        if (error.code === 'MANIFEST_PATH_ESCAPE') {
          const wrapped = new Error(error.kind === 'symlink'
            ? `source manifest.sources[${index}].${field} escapes the source manifest root`
            : `source manifest.sources[${index}].${field} must stay under the manifest root`);
          wrapped.code = error.code;
          throw wrapped;
        }
        throw error;
      }
    };
    const planPath = resolveUnderBase('plan_path', source.plan_path);
    const rubricPath = resolveUnderBase('rubric_path', source.rubric_path);
    const canonicalTargets = [];
    for (const [field, target] of [['plan_path', planPath], ['rubric_path', rubricPath]]) {
      let targetStat;
      let canonicalTarget;
      try {
        targetStat = fs.lstatSync(target);
        canonicalTarget = fs.realpathSync(target);
      } catch (error) {
        throw new Error(`source manifest.sources[${index}].${field} is not readable`);
      }
      if (!targetStat.isFile() && !targetStat.isSymbolicLink()) {
        throw new Error(`source manifest.sources[${index}].${field} must resolve to a regular file`);
      }
      if (!canonicalTarget.startsWith(`${root}${path.sep}`)) {
        throw new Error(`source manifest.sources[${index}].${field} escapes the source manifest root`);
      }
      if (!fs.statSync(canonicalTarget).isFile()) {
        throw new Error(`source manifest.sources[${index}].${field} must resolve to a regular file`);
      }
      if (seenRealTargets.has(canonicalTarget)) {
        throw new Error('source manifest real targets must be unique');
      }
      seenRealTargets.add(canonicalTarget);
      canonicalTargets.push(canonicalTarget);
    }
    const planBytes = fs.readFileSync(canonicalTargets[0]);
    const rubricBytes = fs.readFileSync(canonicalTargets[1]);
    const planHash = sha256(planBytes);
    const rubricHash = sha256(rubricBytes);
    if (planHash !== source.plan_sha256 || rubricHash !== source.rubric_sha256) {
      throw new Error(`source manifest.sources[${index}] content digest drifted`);
    }
    const planId = `plan-${planHash}`;
    planIds.push(planId);
    for (const [lineIndex, line] of planBytes.toString('utf8').split(/\r?\n/).entries()) {
      if (/^#{2,6}\s+(?:(?:Phase)\s*[0-9]+|P[0-9]+)(?:\s|[-—:·（(]|$)/i.test(line)) {
        authoringUnitIds.push(`u-${sha256(`${planHash}:${lineIndex + 1}:${line}`)}`);
      }
    }
    const rubricTokens = [];
    for (const line of rubricBytes.toString('utf8').split(/\r?\n/)) {
      const heading = line.match(/^#{2,6}\s+(R[0-9]+)(?:\s|$)/);
      const bullet = line.match(/^\s*-\s+(R[0-9]+)\s*:/);
      const plain = line.match(/^\s*(R[0-9]+)\s*:/);
      if (heading) rubricTokens.push(heading[1]);
      if (bullet) rubricTokens.push(bullet[1]);
      if (plain) rubricTokens.push(plain[1]);
    }
    if (rubricTokens.length === 0) throw new Error(`source manifest.sources[${index}] has no rubric IDs`);
    if (new Set(rubricTokens).size !== rubricTokens.length) {
      throw new Error(`source manifest.sources[${index}] has duplicate rubric IDs`);
    }
    rubricIds.push(...rubricTokens.map((rubricId) => (
      contentBoundRubricId(planHash, rubricHash, rubricId)
    )));
  }
  if (new Set(planIds).size !== planIds.length) throw new Error('source manifest has duplicate plan content');
  return {
    planIds: planIds.sort(),
    rubricIds: rubricIds.sort(),
    authoringUnitIds: authoringUnitIds.sort(),
  };
}

function loadMirrorRoots(file) {
  const value = readJson(file, 'mirror roots');
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.root !== 'string' || value.root.length === 0 || value.root.startsWith('/')
      || value.root.includes('..') || !Array.isArray(value.dirs) || value.dirs.length === 0
      || value.dirs.some((d) => typeof d !== 'string' || d.length === 0 || d.startsWith('/') || d.includes('..'))
      || Object.keys(value).some((key) => !new Set(['root', 'dirs']).has(key))) {
    throw new Error('mirror roots must be {"root": "<relative dir>", "dirs": [<relative dir>, ...]}');
  }
  const root = value.root.replace(/\/+$/, '');
  const dirs = value.dirs.map((d) => d.replace(/\/+$/, ''));
  if (dirs.some((d) => d === root || d.startsWith(`${root}/`) || root.startsWith(`${d}/`))) {
    throw new Error('mirror roots: root and dirs must not nest');
  }
  return { root, dirs };
}

// A node that may write under a mirrored dir must also own the mirror path, or the round is
// discarded at the boundary AFTER the implementation was paid for. Exact-path rule: prefix
// membership is not enough anywhere else in this checker and is not enough here.
function checkOutputPathMirrors(graph, mirrorRoots) {
  const missing = [];
  for (const [index, node] of (graph.nodes || []).entries()) {
    const label = `graph.nodes[${index}]${node && node.id ? `(${node.id})` : ''}`;
    const campaign = node && node.campaign && typeof node.campaign === 'object' ? node.campaign : null;
    const outputs = campaign && Array.isArray(campaign.output_paths) ? campaign.output_paths : [];
    const set = new Set(outputs);
    for (const out of outputs) {
      if (typeof out !== 'string') continue;
      if (out === mirrorRoots.root || out.startsWith(`${mirrorRoots.root}/`)) continue;
      const dir = mirrorRoots.dirs.find((d) => out === d || out.startsWith(`${d}/`));
      if (!dir) continue;
      const mirror = `${mirrorRoots.root}/${out}`;
      if (!set.has(mirror)) missing.push(`${label}.campaign.output_paths lacks the codex mirror of ${out} (${mirror})`);
    }
  }
  if (missing.length > 0) throw new Error(`output_paths must enumerate every codex mirror: ${missing.join('; ')}`);
}

function inspect(options) {
  const governance = readJson(options.governance, 'governance');
  // BL-0081: a caller that already holds the parsed graph passes it, so the bytes
  // it validates are the bytes it inspected -- a second read of the path could
  // see a different file. A copy keeps the inspected object out of the caller's reach.
  const graph = options.graphObject !== undefined
    ? JSON.parse(JSON.stringify(options.graphObject))
    : readJson(options.graph, 'graph');
  const missionPolicy = resolveMissionPolicy(governance);
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : (gitToplevel(process.cwd()) || process.cwd());
  const coverage = loadSourceCoverageManifest(options.sources, { repoRoot: options.layoutRoot || repoRoot });
  const mirrorRoots = options.mirrorRoots ? loadMirrorRoots(options.mirrorRoots) : null;
  if (mirrorRoots) checkOutputPathMirrors(graph, mirrorRoots);
  checkSpecPlanRegistration(graph, repoRoot);
  const result = checkMissionGraphCoverage(graph, coverage, missionPolicy);
  const reservationTotals = Object.fromEntries([
    'campaigns',
    'wall_seconds',
    'tool_calls',
    'engine_attempts',
    'external_wait_seconds',
    'canonical_changed_files',
    'output_bytes',
  ].map((field) => [
    field,
    result.graph.nodes.reduce((total, node) => total + node.reservation[field], 0),
  ]));
  return {
    status: 'READY',
    policy_digest: missionPolicy.policy_digest,
    graph_digest: result.graph_digest,
    deliverables: result.graph.nodes.length,
    calculated_depth: result.calculated_depth,
    calculated_batches: result.calculated_batches,
    reservation_totals: reservationTotals,
    mirror_rule: mirrorRoots ? { root: mirrorRoots.root, dirs: mirrorRoots.dirs, status: 'satisfied' } : null,
    coverage: result.coverage ? {
      ...result.coverage,
      authoring_unit_count: coverage.authoringUnitIds.length,
      authoring_unit_ids: coverage.authoringUnitIds,
    } : null,
  };
}

function main() {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(inspect(parse(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`mission-execution-graph-check: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  contentBoundRubricId,
  inspect,
  loadSourceCoverageManifest,
  loadMirrorRoots,
  checkOutputPathMirrors,
  checkSpecPlanRegistration,
};
