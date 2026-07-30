#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const { resolveMissionPolicy } = require('../src/engine/mission-policy');
const { inspect: inspectGraph } = require('./mission-execution-graph-check');
const { admitExecutableMissionDelta } = require('../src/engine/controller-execution');

const LEVELS = new Set(['l3', 'l4', 'l5', 'l6']);
const FALLBACKS = new Set(['none', 'solo', 'precondition_failed']);
const TOPOLOGIES = Object.freeze({
  l3: 'inline',
  l4: 'foreman',
  l5: 'heterogeneous-implementer',
  l6: 'heterogeneous-full-dispatch',
});

class MissionRoutingAdmissionError extends Error {
  constructor(message, code = 'MISSION_ROUTING_REJECTED') {
    super(message);
    this.name = 'MissionRoutingAdmissionError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new MissionRoutingAdmissionError(message, code);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid readable JSON: ${error.message}`);
  }
}

function canonicalRepo(repoRoot) {
  const requested = path.resolve(repoRoot || process.cwd());
  let root;
  let commonDir;
  try {
    root = fs.realpathSync(execFileSync(
      'git',
      ['-C', requested, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim());
    const authoredCommonDir = execFileSync(
      'git',
      ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    commonDir = fs.realpathSync(authoredCommonDir);
  } catch (error) {
    fail(`repository identity is unavailable: ${error.message}`, 'MISSION_REPO_UNAVAILABLE');
  }
  return {
    root,
    repo_identity: `git-common-dir:${commonDir}`,
  };
}

function boundedArtifact(root, authoredPath, label) {
  if (typeof authoredPath !== 'string' || authoredPath.length === 0
      || path.isAbsolute(authoredPath) || authoredPath.includes('\\')
      || path.posix.normalize(authoredPath) !== authoredPath
      || authoredPath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`${label} must be a bounded repository-relative path`);
  }
  const candidate = path.resolve(root, authoredPath);
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    fail(`${label} is not readable: ${error.message}`);
  }
  if (!canonical.startsWith(`${root}${path.sep}`) || !fs.statSync(canonical).isFile()) {
    fail(`${label} must resolve to a regular file inside the repository`);
  }
  return canonical;
}

function loadRoutingConfig(root) {
  const configPath = path.join(root, '.claude', 'mission-routing-config.json');
  const config = readJson(configPath, 'Mission routing config');
  if (!config || typeof config !== 'object' || Array.isArray(config)
      || config.schema_version !== 1
      || typeof config.graph_path !== 'string'
      || typeof config.sources_path !== 'string'
      || Object.keys(config).some((key) => !new Set([
        'schema_version',
        'graph_path',
        'sources_path',
      ]).has(key))) {
    fail('Mission routing config must contain only schema_version, graph_path, and sources_path');
  }
  return {
    graph: boundedArtifact(root, config.graph_path, 'Mission routing graph_path'),
    sources: boundedArtifact(root, config.sources_path, 'Mission routing sources_path'),
  };
}

function normalizeRoute(entryLevel, fallback = 'none') {
  if (!LEVELS.has(entryLevel)) fail(`Mission routing level "${entryLevel}" is unsupported`);
  if (!FALLBACKS.has(fallback)) fail(`Mission routing fallback "${fallback}" is unsupported`);
  if (fallback !== 'none' && entryLevel === 'l3') {
    fail('l3 cannot degrade to itself');
  }
  const effectiveLevel = fallback === 'none' ? entryLevel : 'l3';
  return {
    entry_level: entryLevel,
    effective_level: effectiveLevel,
    topology: fallback === 'none' ? TOPOLOGIES[entryLevel] : TOPOLOGIES.l3,
    fallback_reason: fallback,
  };
}

function observeMarker(markerFile, repoIdentity) {
  if (!markerFile) return { status: 'not_observed' };
  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.resolve(markerFile), 'utf8'));
  } catch (error) {
    return {
      status: error.code === 'ENOENT' ? 'absent' : 'corrupt',
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !LEVELS.has(value.level)
      || typeof value.expires_at !== 'string'
      || !Number.isFinite(Date.parse(value.expires_at))) {
    return { status: 'corrupt' };
  }
  if (Date.parse(value.expires_at) <= Date.now()) return { status: 'expired' };
  let markerIdentity = null;
  if (typeof value.repo_root === 'string') {
    try {
      markerIdentity = canonicalRepo(value.repo_root).repo_identity;
    } catch (_error) {
      markerIdentity = null;
    }
  }
  if (markerIdentity !== repoIdentity) return { status: 'foreign' };
  return { status: 'active', level: value.level };
}

function governancePolicy(root) {
  const governancePath = path.join(root, '.claude', 'owner-kernel-governance.json');
  if (!fs.existsSync(governancePath)) {
    return {
      governance_path: null,
      resolution: {
        policy: Object.freeze({ schema_version: 1, enforcement_mode: 'off' }),
        policy_digest: null,
      },
    };
  }
  const governance = readJson(governancePath, 'authoritative governance');
  return {
    governance_path: governancePath,
    resolution: resolveMissionPolicy(governance),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// CommonMark ATX: at most 3 leading ASCII spaces. Four-space indent is code.
function atxHeadingMatchesSection(line, section) {
  if (typeof line !== 'string' || typeof section !== 'string') return false;
  return new RegExp(`^ {0,3}#{1,6}\\s+${escapeRegExp(section)}\\s*$`).test(line);
}

// Git object IDs: SHA-1 (40) or SHA-256 (64), lowercase hex only.
function isAuthoritativeGitObjectId(baseSha) {
  return typeof baseSha === 'string' && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(baseSha);
}

function resolveAuthoritativeHead(repoRoot) {
  let baseSha;
  try {
    baseSha = execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch (error) {
    fail(
      `unable to resolve authoritative base for graph specs: ${error.message}`,
      'MISSION_GRAPH_SPEC_INVALID',
    );
  }
  if (!isAuthoritativeGitObjectId(baseSha)) {
    fail('authoritative base SHA is invalid for graph spec validation', 'MISSION_GRAPH_SPEC_INVALID');
  }
  return baseSha;
}

// Pre-spend gate at Mission admission: every frozen node must reference a
// base-tree path whose exact heading matches campaign.spec.section at the
// caller-bound base SHA (resolved once per admission operation).
function validateGraphSpecsAtBase(repoRoot, graph, baseSha) {
  if (!isAuthoritativeGitObjectId(baseSha)) {
    fail('authoritative base SHA is invalid for graph spec validation', 'MISSION_GRAPH_SPEC_INVALID');
  }
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    const spec = node && node.campaign && node.campaign.spec;
    if (!spec || typeof spec.path !== 'string' || typeof spec.section !== 'string') {
      fail(
        `graph node ${node && node.id} campaign.spec.path/section is required`,
        'MISSION_GRAPH_SPEC_INVALID',
      );
    }
    let specText;
    try {
      specText = execFileSync(
        'git',
        ['-C', repoRoot, 'show', `${baseSha}:${spec.path}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (_error) {
      fail(
        `graph node ${node.id} spec.path missing at base (${spec.path})`,
        'MISSION_GRAPH_SPEC_INVALID',
      );
    }
    if (!String(specText).split(/\r?\n/).some((line) => (
      atxHeadingMatchesSection(line, spec.section)
    ))) {
      fail(
        `graph node ${node.id} missing heading '${spec.section}' in ${spec.path}`,
        'MISSION_GRAPH_SPEC_INVALID',
      );
    }
  }
}

const VERSION_MIRROR_BASENAMES = new Set([
  'plugin.json',
  '.claude-plugin/plugin.json',
  'platforms/codex/plugin/plugin.json',
  'platforms/codex/.agents/plugins/marketplace.json',
]);

function collectVersionMirrorPaths(paths) {
  return paths.filter((p) => (
    VERSION_MIRROR_BASENAMES.has(p)
    || p.endsWith('/plugin.json')
    || p.endsWith('marketplace.json')
  ));
}

// Pre-spend executable delta: allowed vs required vs creates, version-mirror
// generator closure, and rejection of typo/nonexistent outputs.
function validateExecutableDeltaAtAdmission(repoRoot, graph, options = {}) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  for (const node of nodes) {
    const campaign = node && node.campaign;
    if (!campaign) {
      fail(`graph node ${node && node.id} missing campaign`, 'MISSION_GRAPH_DELTA_INVALID');
    }
    const authorizedCreates = Array.isArray(campaign.authorized_creates)
      ? campaign.authorized_creates
      : (Array.isArray(options.authorizedCreates) ? options.authorizedCreates : []);
    const outputPaths = Array.isArray(campaign.output_paths) ? campaign.output_paths : [];
    const requiredPaths = Array.isArray(campaign.required_paths) ? campaign.required_paths : [];
    const versionMirrors = collectVersionMirrorPaths([...requiredPaths, ...outputPaths]);
    const delta = admitExecutableMissionDelta({
      repoRoot,
      allowedPathPrefixes: campaign.allowed_path_prefixes || [],
      requiredPaths,
      outputPaths,
      authorizedCreates,
      versionMirrorPaths: versionMirrors,
      versionMirrorGenerator: versionMirrors.length > 0
        ? (campaign.version_mirror_generator || options.versionMirrorGenerator || null)
        : null,
      historicalOutputs: options.historicalOutputs || null,
      currentBytesByPath: options.currentBytesByPath || null,
      noOpReceipt: options.noOpReceipt || null,
      baseSha: options.baseSha || null,
    });
    if (!delta.ok) {
      fail(
        `graph node ${node.id} executable delta rejected: ${delta.reason}`,
        'MISSION_GRAPH_DELTA_INVALID',
      );
    }
    if (delta.noop === true) {
      node._noop_adoption = {
        dispatcher_called: false,
        mutation_attempts: 0,
        gate_attempts: 0,
      };
    }
  }
}

function buildAdmission({ repoIdentity, policy, graphResult }) {
  const coverage = graphResult.coverage;
  const sourcesDigest = sha256(canonicalJson({
    plan_ids: coverage.plan_ids,
    rubric_ids: coverage.rubric_ids,
    authoring_unit_ids: coverage.authoring_unit_ids,
  }));
  const body = {
    schema_version: 1,
    artifact_type: 'mission_routing_admission',
    authority_status: policy.policy.enforcement_mode,
    repo_identity: repoIdentity,
    mission_policy_digest: policy.policy_digest,
    mission_graph_digest: graphResult.graph_digest,
    sources_digest: sourcesDigest,
    deliverable_count: graphResult.deliverables,
    source_authoring_unit_count: coverage.authoring_unit_count,
    critical_path: graphResult.calculated_depth,
    batch_count: graphResult.calculated_batches,
    reservation_totals: graphResult.reservation_totals,
  };
  return {
    ...body,
    admission_digest: sha256(canonicalJson(body)),
  };
}

function admitMissionRouting(options = {}) {
  const repo = canonicalRepo(options.repoRoot);
  const route = normalizeRoute(options.entryLevel, options.fallback);
  const marker = observeMarker(options.markerFile, repo.repo_identity);
  const policy = governancePolicy(repo.root);
  if (policy.resolution.policy.enforcement_mode === 'off') {
    const legacy = {
      status: 'LEGACY',
      enforced: false,
      admitted: true,
      would_block: false,
      route,
      marker,
      admission: null,
    };
    if (typeof options.effect === 'function') legacy.effect_result = options.effect(legacy);
    return legacy;
  }

  let graphResult;
  try {
    const artifacts = loadRoutingConfig(repo.root);
    graphResult = inspectGraph({
      governance: policy.governance_path,
      graph: artifacts.graph,
      sources: artifacts.sources,
    });
    if (graphResult.policy_digest !== policy.resolution.policy_digest) {
      fail(
        'authoritative Mission policy changed during admission',
        'MISSION_POLICY_DRIFT',
      );
    }
    // Pre-spend: resolve HEAD once per admission, then validate frozen graph
    // specs against that exact SHA using the already-checked routing graph.
    const admissionBaseSha = resolveAuthoritativeHead(repo.root);
    const graphJson = readJson(artifacts.graph, 'Mission execution graph');
    validateGraphSpecsAtBase(
      repo.root,
      graphJson,
      admissionBaseSha,
    );
    validateExecutableDeltaAtAdmission(repo.root, graphJson, {
      baseSha: admissionBaseSha,
      authorizedCreates: options.authorizedCreates,
      versionMirrorGenerator: options.versionMirrorGenerator || 'scripts/sync-version.js',
      historicalOutputs: options.historicalOutputs,
      currentBytesByPath: options.currentBytesByPath,
      noOpReceipt: options.noOpReceipt,
    });
  } catch (error) {
    if (policy.resolution.policy.enforcement_mode === 'enforce') throw error;
    const shadowFailure = {
      status: 'SHADOW',
      enforced: false,
      admitted: false,
      would_block: true,
      would_block_reason: error.message,
      route,
      marker,
      admission: null,
    };
    if (typeof options.effect === 'function') {
      shadowFailure.effect_result = options.effect(shadowFailure);
    }
    return shadowFailure;
  }

  const admission = buildAdmission({
    repoIdentity: repo.repo_identity,
    policy: policy.resolution,
    graphResult,
  });
  const result = {
    status: policy.resolution.policy.enforcement_mode === 'enforce' ? 'READY' : 'SHADOW',
    enforced: policy.resolution.policy.enforcement_mode === 'enforce',
    admitted: true,
    would_block: false,
    route,
    marker,
    admission,
  };
  if (typeof options.effect === 'function') result.effect_result = options.effect(result);
  return result;
}

function usage() {
  return [
    'Usage:',
    '  mission-routing-admission.js --repo-root <repo> --level l3|l4|l5|l6',
    '    [--fallback none|solo|precondition_failed] [--marker <session-marker.json>]',
  ].join('\n');
}

function parse(argv) {
  const options = { fallback: 'none' };
  const fields = new Map([
    ['--repo-root', 'repoRoot'],
    ['--level', 'entryLevel'],
    ['--fallback', 'fallback'],
    ['--marker', 'markerFile'],
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const field = fields.get(argv[index]);
    if (!field || argv[index + 1] === undefined) fail(`invalid argument: ${argv[index] || ''}`);
    options[field] = argv[index + 1];
  }
  if (!options.repoRoot || !options.entryLevel) fail('--repo-root and --level are required');
  return options;
}

function main() {
  try {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(admitMissionRouting(parse(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`mission-routing-admission: ${error.message}\n`);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  MissionRoutingAdmissionError,
  admitMissionRouting,
  atxHeadingMatchesSection,
  isAuthoritativeGitObjectId,
  normalizeRoute,
  observeMarker,
  validateExecutableDeltaAtAdmission,
  validateGraphSpecsAtBase,
  collectVersionMirrorPaths,
};
