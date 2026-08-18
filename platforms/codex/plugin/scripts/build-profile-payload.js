#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { TextDecoder } = require('util');
const {
  PROFILE_NAMES,
  buildProfileBundle,
  loadProfileCatalog,
  readProfileBundle,
} = require('../src/engine/profile-payload');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const {
  canonicalizeProjectedSkillSource,
  extractRuleCandidates,
  validateRuleInventory,
} = require('./measure-profile-context');
const { preflightJsonSource } = require('./validate-json-schema');

const EXIT_SUCCESS = 0;
const HELP = `Usage:
  node scripts/build-profile-payload.js build --profile <guided|autonomous> --out <new-dir> [--repo <root>]
  node scripts/build-profile-payload.js check --profile <guided|autonomous> --bundle <dir> [--repo <root>]
  node scripts/build-profile-payload.js catalog --check [--repo <root>]
  node scripts/build-profile-payload.js migration --out <new-json-file> [--repo <root>]
  node scripts/build-profile-payload.js snapshot --out <new-dir> [--repo <root>]

The build command writes a new three-file artifact containing core, one profile, and hook policy.
Existing output paths are rejected. The catalog command verifies rule ownership, migration, and the
guided compatibility baseline.
`;

class ProfileBuildError extends Error {
  constructor(message, code = 'PROFILE_BUILD_ERROR') {
    super(message);
    this.name = 'ProfileBuildError';
    this.code = code;
  }
}

function fail(message, code) {
  throw new ProfileBuildError(message, code);
}

function parseArgs(argv) {
  const command = argv[2];
  if (!command || ['-h', '--help', 'help'].includes(command)) return { help: true };
  const options = {};
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') return { help: true };
    if (!argument.startsWith('--')) fail(`unexpected argument: ${argument}`, 'USAGE_ERROR');
    const key = argument.slice(2).replace(/-/gu, '_');
    if (key === 'check') {
      if (options.check !== undefined) fail('duplicate option --check', 'USAGE_ERROR');
      options.check = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(`${argument} requires a value`, 'USAGE_ERROR');
    }
    if (options[key] !== undefined) fail(`duplicate option ${argument}`, 'USAGE_ERROR');
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

function assertOptions(options, allowed) {
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    fail(
      `unsupported option(s): ${unknown.map((key) => `--${key.replace(/_/gu, '-')}`).join(', ')}`,
      'USAGE_ERROR',
    );
  }
}

function requireOption(options, name) {
  if (typeof options[name] !== 'string' || options[name].length === 0) {
    fail(`--${name.replace(/_/gu, '-')} is required`, 'USAGE_ERROR');
  }
  return options[name];
}

function resolveRepo(options) {
  const root = path.resolve(options.repo || path.join(__dirname, '..'));
  let real;
  try {
    real = fs.realpathSync(root);
  } catch (error) {
    fail(`repository root is unreadable: ${error.message}`, 'PROFILE_REPO_UNREADABLE');
  }
  if (!fs.statSync(real).isDirectory()) fail('repository root must be a directory');
  return real;
}

const MIGRATION_TARGETS = Object.freeze({
  core: {
    runtime_owner: 'TaskAuthorityEnvelope+profiles/core.md',
    disposition: 'typed_authority_or_core_capsule',
  },
  guided: {
    runtime_owner: 'skills/dev-flow/SKILL.md+profiles/guided.md',
    disposition: 'guided_host_or_current_slice',
  },
  autonomous: {
    runtime_owner: 'profiles/autonomous.md',
    disposition: 'autonomous_guidance',
  },
  assurance: {
    runtime_owner: 'RoleExecutionGrant.assurance+required_evidence+invariant_hooks',
    disposition: 'typed_assurance_or_invariant_hook',
  },
  topology: {
    runtime_owner: 'RoleExecutionGrant.topology+skills/l3-l6',
    disposition: 'typed_topology_or_front_door',
  },
  obsolete: {
    runtime_owner: null,
    disposition: 'removed',
  },
});

function readUtf8(file, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  } catch (error) {
    fail(`${label} is not readable UTF-8: ${error.message}`, 'PROFILE_SOURCE_DRIFT');
  }
}

function readStrictJson(file, label) {
  const source = readUtf8(file, label);
  try {
    preflightJsonSource(source, label);
    return { source, value: JSON.parse(source) };
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`, error.code || 'PROFILE_SOURCE_DRIFT');
  }
}

function inRange(occurrence, range) {
  return occurrence.path === range.path
    && occurrence.line >= range.start_line
    && occurrence.line <= range.end_line;
}

function buildRuleMigration(repoRoot) {
  const inventoryRecord = readStrictJson(
    path.join(repoRoot, 'profiles', 'rule-inventory.json'),
    'rule inventory',
  );
  const inventorySource = inventoryRecord.source;
  const inventory = inventoryRecord.value;
  const validated = validateRuleInventory(
    'profiles/rule-inventory.json',
    repoRoot,
    'profiles/rule-source-manifest.json',
  );
  const occurrences = [];
  for (const sourceEntry of inventory.sources) {
    const source = canonicalizeProjectedSkillSource(
      readUtf8(path.join(repoRoot, sourceEntry.path), sourceEntry.path),
      repoRoot,
      sourceEntry.path,
    );
    for (const unit of extractRuleCandidates(source)) {
      const segment = sourceEntry.segments.find(
        (candidate) => unit.line >= candidate.start_line && unit.line <= candidate.end_line,
      );
      if (!segment) fail('validated inventory lost a rule owner', 'PROFILE_SOURCE_DRIFT');
      occurrences.push({
        path: sourceEntry.path,
        line: unit.line,
        content_hash: unit.content_hash,
        segment_id: segment.id,
        category: segment.category,
      });
    }
  }
  const grouped = new Map();
  for (const occurrence of occurrences) {
    if (!grouped.has(occurrence.content_hash)) grouped.set(occurrence.content_hash, []);
    grouped.get(occurrence.content_hash).push(occurrence);
  }
  const mappings = [];
  for (const [contentHash, candidates] of grouped.entries()) {
    let owner = candidates[0];
    if (candidates.length > 1) {
      const duplicate = inventory.duplicate_rule_sets.find((entry) => (
        candidates.some((candidate) => inRange(candidate, entry.owner))
        && candidates.every((candidate) => inRange(candidate, entry.owner)
          || entry.aliases.some((alias) => inRange(candidate, alias)))
      ));
      if (!duplicate) fail('validated duplicate rule lost its owner', 'PROFILE_SOURCE_DRIFT');
      owner = candidates.find((candidate) => inRange(candidate, duplicate.owner));
    }
    const target = MIGRATION_TARGETS[owner.category];
    mappings.push({
      rule_id: sha256(canonicalJson({
        content_hash: contentHash,
        path: owner.path,
        line: owner.line,
      })),
      source: {
        path: owner.path,
        line: owner.line,
        content_hash: contentHash,
        segment_id: owner.segment_id,
      },
      aliases: candidates
        .filter((candidate) => candidate !== owner)
        .map((candidate) => ({ path: candidate.path, line: candidate.line }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line),
      category: owner.category,
      runtime_owner: target.runtime_owner,
      disposition: target.disposition,
    });
  }
  mappings.sort((left, right) => (
    left.source.path.localeCompare(right.source.path) || left.source.line - right.source.line
  ));
  if (mappings.length !== validated.canonical_rules) {
    fail('rule migration cardinality differs from validated inventory', 'PROFILE_SOURCE_DRIFT');
  }
  return {
    schema_version: 1,
    inventory_sha256: sha256(inventorySource),
    canonical_rule_count: validated.canonical_rules,
    mappings,
  };
}

function writeRuleMigration(outPath, migration) {
  const target = path.resolve(outPath);
  if (fs.existsSync(target)) fail('migration output already exists', 'PROFILE_OUTPUT_EXISTS');
  const parent = fs.realpathSync(path.dirname(target));
  if (!fs.statSync(parent).isDirectory()) fail('migration output parent must be a directory');
  const rows = migration.mappings
    .map((mapping) => `    ${JSON.stringify(mapping)}`)
    .join(',\n');
  const source = [
    '{',
    `  "schema_version": ${migration.schema_version},`,
    `  "inventory_sha256": ${JSON.stringify(migration.inventory_sha256)},`,
    `  "canonical_rule_count": ${migration.canonical_rule_count},`,
    '  "mappings": [',
    rows,
    '  ]',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(target, source, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return target;
}

function baselineRecord(repoRoot) {
  const baselinePath = path.join(
    repoRoot,
    'docs',
    'projects',
    '_archive',
    '2026-07-26-capability-adaptive-profiles',
    'p0-context-baseline.json',
  );
  return readStrictJson(baselinePath, 'P0 context baseline').value;
}

function baselineSourceEntries(baseline) {
  if (!baseline.source_surface || !Array.isArray(baseline.source_surface.files)
    || baseline.source_surface.files.length === 0) {
    fail(
      'P0 context baseline lacks a fixed source universe',
      'PROFILE_GUIDED_BASELINE_UNAVAILABLE',
    );
  }
  const entries = baseline.source_surface.files;
  const paths = entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.path !== 'string'
      || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u.test(entry.path)
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      fail(
        `P0 context baseline source ${index} is invalid`,
        'PROFILE_GUIDED_BASELINE_UNAVAILABLE',
      );
    }
    return entry.path;
  });
  if (new Set(paths).size !== paths.length) {
    fail(
      'P0 context baseline source universe contains duplicates',
      'PROFILE_GUIDED_BASELINE_UNAVAILABLE',
    );
  }
  return entries;
}

function baselineSnapshotPath(root, sourcePath) {
  return path.join(root, `${sha256(sourcePath)}.txt`);
}

function writeBaselineSnapshots(outPath, repoRoot) {
  const target = path.resolve(outPath);
  if (fs.existsSync(target)) fail('snapshot output already exists', 'PROFILE_OUTPUT_EXISTS');
  const baseline = baselineRecord(repoRoot);
  const entries = baselineSourceEntries(baseline);
  try {
    fs.mkdirSync(target, { mode: 0o700 });
    for (const entry of entries) {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(execFileSync(
        'git',
        ['show', `${baseline.base.commit}:${entry.path}`],
        { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
      ));
      if (sha256(source) !== entry.sha256) {
        fail(
          `P0 source snapshot hash drifted for ${entry.path}`,
          'PROFILE_GUIDED_BASELINE_UNAVAILABLE',
        );
      }
      const file = baselineSnapshotPath(target, entry.path);
      fs.writeFileSync(file, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}

// Successor-universe rule (dev-flow-contract-card P4, Board-approved 2026-08-18):
// the guided baseline may additionally be satisfied from dev-flow's own references
// tree, so the superset check proves rules were RELOCATED, not lost. Any other
// extra source path is still universe drift.
const GUIDED_EXTENDED_UNIVERSE = /^skills\/dev-flow\/references\/[A-Za-z0-9._-]+\.md$/u;

function loadGuidedDispositions(repoRoot) {
  const file = path.join(repoRoot, 'profiles', 'guided-baseline-dispositions.json');
  const doc = readStrictJson(file, 'guided baseline dispositions').value;
  if (!doc || doc.schema_version !== 1
    || doc.artifact_type !== 'guided_baseline_dispositions'
    || !Array.isArray(doc.dispositions)) {
    fail(
      'guided baseline dispositions file is invalid',
      'PROFILE_GUIDED_DISPOSITION_INVALID',
    );
  }
  const seen = new Set();
  for (const entry of doc.dispositions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.content_hash !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.content_hash)
      || !['removed', 'rewritten'].includes(entry.disposition)
      || typeof entry.rationale !== 'string' || entry.rationale.trim() === ''
      || (entry.disposition === 'rewritten'
        && (!Array.isArray(entry.successor_hashes) || entry.successor_hashes.length === 0
          || entry.successor_hashes.some((h) => typeof h !== 'string' || !/^[a-f0-9]{64}$/u.test(h))))
      || (entry.disposition === 'removed' && 'successor_hashes' in entry)) {
      fail(
        'guided baseline disposition entry is invalid',
        'PROFILE_GUIDED_DISPOSITION_INVALID',
      );
    }
    if (seen.has(entry.content_hash)) {
      fail(
        `duplicate guided baseline disposition for ${entry.content_hash}`,
        'PROFILE_GUIDED_DISPOSITION_INVALID',
      );
    }
    seen.add(entry.content_hash);
  }
  return doc.dispositions;
}

function validateGuidedCompatibility(repoRoot, inventory) {
  const file = path.join(repoRoot, 'profiles', 'guided-compatibility.json');
  const record = readStrictJson(file, 'guided compatibility record').value;
  const baseline = baselineRecord(repoRoot);
  const expected = {
    schema_version: 1,
    baseline_commit: baseline.base.commit,
    baseline_canonical_rules: baseline.rule_inventory.canonical_rules,
    compatibility_host: 'main_plugin_guided',
    lifecycle_owner: 'skills/dev-flow/SKILL.md',
    adaptive_worker_runtime: 'fresh_child_process_only',
    source_retention_evidence: 'content_hash_multiset',
    runtime_behavior_status: 'unverified_until_effectful_transport_witness',
    golden_trace_status: 'not_claimed',
    active_slice_fields: ['slice_id', 'objective', 'dependencies', 'inputs', 'outputs', 'acceptance'],
    required_relation: 'current_rule_multiset_superset_of_baseline_modulo_explicit_dispositions',
    dispositions_file: 'profiles/guided-baseline-dispositions.json',
  };
  if (canonicalJson(record) !== canonicalJson(expected)) {
    fail('guided compatibility record drifted', 'PROFILE_GUIDED_COMPATIBILITY_DRIFT');
  }
  const dispositions = loadGuidedDispositions(repoRoot);
  const baselineFiles = baselineSourceEntries(baseline);
  const baselinePaths = baselineFiles.map((entry) => entry.path);
  const inventoryPaths = inventory.sources.map((entry) => entry.path);
  const inventoryPathSet = new Set(inventoryPaths);
  const baselinePathSet = new Set(baselinePaths);
  if (baselinePaths.some((p) => !inventoryPathSet.has(p))) {
    fail(
      'current inventory source universe lost a P0 baseline source',
      'PROFILE_GUIDED_SOURCE_UNIVERSE_DRIFT',
    );
  }
  for (const extra of inventoryPaths.filter((p) => !baselinePathSet.has(p))) {
    if (!GUIDED_EXTENDED_UNIVERSE.test(extra)) {
      fail(
        `inventory source ${extra} is outside the guided successor universe`,
        'PROFILE_GUIDED_SOURCE_UNIVERSE_DRIFT',
      );
    }
  }
  const currentCounts = new Map();
  for (const entry of inventory.sources) {
    const source = canonicalizeProjectedSkillSource(
      readUtf8(path.join(repoRoot, entry.path), entry.path),
      repoRoot,
      entry.path,
    );
    for (const unit of extractRuleCandidates(source)) {
      currentCounts.set(unit.content_hash, (currentCounts.get(unit.content_hash) || 0) + 1);
    }
  }
  const requiredCounts = new Map();
  for (const entry of baselineFiles) {
    const source = readUtf8(
      baselineSnapshotPath(path.join(repoRoot, 'profiles', 'p0-sources'), entry.path),
      `guided baseline snapshot ${entry.path}`,
    );
    if (sha256(source) !== entry.sha256) {
      fail(
        `guided baseline source hash drifted for ${entry.path}`,
        'PROFILE_GUIDED_BASELINE_UNAVAILABLE',
      );
    }
    for (const unit of extractRuleCandidates(source)) {
      requiredCounts.set(unit.content_hash, (requiredCounts.get(unit.content_hash) || 0) + 1);
    }
  }
  const dispositionByHash = new Map(dispositions.map((entry) => [entry.content_hash, entry]));
  for (const [contentHash, count] of requiredCounts.entries()) {
    const shortfall = count - (currentCounts.get(contentHash) || 0);
    if (shortfall <= 0) continue;
    const disposition = dispositionByHash.get(contentHash);
    if (!disposition) {
      fail(
        `guided compatibility lost baseline rule ${contentHash}`,
        'PROFILE_GUIDED_COMPATIBILITY_DRIFT',
      );
    }
    if (disposition.disposition === 'rewritten') {
      for (const successor of disposition.successor_hashes) {
        if ((currentCounts.get(successor) || 0) < 1) {
          fail(
            `rewritten baseline rule ${contentHash} names absent successor ${successor}`,
            'PROFILE_GUIDED_DISPOSITION_SUCCESSOR_MISSING',
          );
        }
      }
    }
    // 'removed' discharges the shortfall loudly via the recorded rationale.
  }
  // Dead-disposition check: an entry whose baseline rule is NOT actually short is
  // stale accounting — it would silently pre-authorize a future deletion.
  for (const entry of dispositions) {
    const required = requiredCounts.get(entry.content_hash) || 0;
    if (required === 0) {
      fail(
        `guided baseline disposition targets a hash not in the baseline: ${entry.content_hash}`,
        'PROFILE_GUIDED_DISPOSITION_DEAD',
      );
    }
    const shortfall = required - (currentCounts.get(entry.content_hash) || 0);
    if (shortfall <= 0) {
      fail(
        `guided baseline disposition is dead (rule still present): ${entry.content_hash}`,
        'PROFILE_GUIDED_DISPOSITION_DEAD',
      );
    }
  }
  return record;
}

function validateSourceOwnership(repoRoot) {
  const loaded = loadProfileCatalog(repoRoot);
  const inventory = validateRuleInventory(
    'profiles/rule-inventory.json',
    repoRoot,
    'profiles/rule-source-manifest.json',
  );
  if (canonicalJson(inventory.category_totals)
      !== canonicalJson(loaded.catalog.category_totals)) {
    fail('current rule category totals drifted from the profile catalog', 'PROFILE_SOURCE_DRIFT');
  }
  const expectedMigration = buildRuleMigration(repoRoot);
  const migration = readStrictJson(
    path.join(repoRoot, 'profiles', 'rule-migration.json'),
    'rule migration',
  ).value;
  if (canonicalJson(migration) !== canonicalJson(expectedMigration)) {
    fail('rule-level migration map drifted from the inventory', 'PROFILE_RULE_MIGRATION_DRIFT');
  }
  validateGuidedCompatibility(repoRoot, readStrictJson(
    path.join(repoRoot, 'profiles', 'rule-inventory.json'),
    'rule inventory',
  ).value);
  const sourceMapPath = path.join(repoRoot, 'profiles', 'profile-source-map.json');
  const sourceMap = readStrictJson(sourceMapPath, 'profile source map').value;
  const expectedOwners = MIGRATION_TARGETS;
  if (!sourceMap || sourceMap.schema_version !== 1
    || sourceMap.inventory !== 'profiles/rule-inventory.json'
    || sourceMap.source_manifest !== 'profiles/rule-source-manifest.json'
    || sourceMap.artifact_strategy
      !== 'generated_profile_specific_payloads_from_canonical_source'
    || canonicalJson(sourceMap.categories) !== canonicalJson(expectedOwners)) {
    fail('profile source map does not preserve current ownership', 'PROFILE_SOURCE_DRIFT');
  }
  return { loaded, inventory };
}

function assertExactBundleFiles(bundleRoot) {
  let files;
  try {
    files = fs.readdirSync(bundleRoot, { withFileTypes: true });
  } catch (error) {
    fail(`bundle directory is unreadable: ${error.message}`, 'PROFILE_BUNDLE_UNREADABLE');
  }
  const names = files.map((entry) => entry.name).sort();
  if (files.some((entry) => !entry.isFile())
    || canonicalJson(names)
      !== canonicalJson(['hook-policy.json', 'manifest.json', 'profile.md'])) {
    fail(
      'profile bundle must contain only hook-policy.json, manifest.json, and profile.md',
      'PROFILE_BUNDLE_EXTRA_FILES',
    );
  }
}

function writeBundle(outPath, bundle) {
  const target = path.resolve(outPath);
  if (fs.existsSync(target)) {
    fail('build output already exists; refusing to merge profile artifacts', 'PROFILE_OUTPUT_EXISTS');
  }
  const parent = path.dirname(target);
  let parentReal;
  try {
    parentReal = fs.realpathSync(parent);
  } catch (error) {
    fail(`build output parent is unreadable: ${error.message}`, 'PROFILE_OUTPUT_PARENT');
  }
  if (!fs.statSync(parentReal).isDirectory()) fail('build output parent must be a directory');
  try {
    fs.mkdirSync(target, { mode: 0o700 });
    fs.writeFileSync(
      path.join(target, 'manifest.json'),
      `${JSON.stringify(bundle.manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(target, 'profile.md'),
      bundle.payload,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    fs.writeFileSync(
      path.join(target, 'hook-policy.json'),
      `${JSON.stringify(bundle.hooks, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    if (error && error.code === 'EEXIST') {
      fail('build output already exists; refusing to merge profile artifacts', 'PROFILE_OUTPUT_EXISTS');
    }
    fail(`profile artifact write failed: ${error.message}`, 'PROFILE_OUTPUT_WRITE');
  }
  return target;
}

function run(argv = process.argv) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    return EXIT_SUCCESS;
  }
  const { command, options } = parsed;
  if (command === 'migration') {
    assertOptions(options, new Set(['out', 'repo']));
    const repoRoot = resolveRepo(options);
    const target = writeRuleMigration(
      requireOption(options, 'out'),
      buildRuleMigration(repoRoot),
    );
    process.stdout.write(`${JSON.stringify({
      status: 'built',
      output: target,
    }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (command === 'snapshot') {
    assertOptions(options, new Set(['out', 'repo']));
    const repoRoot = resolveRepo(options);
    const target = writeBaselineSnapshots(requireOption(options, 'out'), repoRoot);
    process.stdout.write(`${JSON.stringify({
      status: 'built',
      output: target,
    }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (command === 'catalog') {
    assertOptions(options, new Set(['check', 'repo']));
    if (options.check !== true) fail('catalog requires --check', 'USAGE_ERROR');
    const repoRoot = resolveRepo(options);
    const { loaded, inventory } = validateSourceOwnership(repoRoot);
    process.stdout.write(`${JSON.stringify({
      status: 'valid',
      inventory_sha256: loaded.catalog.inventory_sha256,
      canonical_rules: inventory.canonical_rules,
      category_totals: inventory.category_totals,
    }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (command === 'build') {
    assertOptions(options, new Set(['profile', 'out', 'repo']));
    const repoRoot = resolveRepo(options);
    validateSourceOwnership(repoRoot);
    const profile = requireOption(options, 'profile');
    if (!PROFILE_NAMES.includes(profile)) fail('--profile must be guided or autonomous', 'USAGE_ERROR');
    const target = writeBundle(
      requireOption(options, 'out'),
      buildProfileBundle(profile, repoRoot),
    );
    const checked = readProfileBundle(target, repoRoot);
    assertExactBundleFiles(target);
    process.stdout.write(`${JSON.stringify({
      status: 'built',
      effective_profile: profile,
      bundle_id: checked.manifest.bundle_id,
      output: target,
    }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  if (command === 'check') {
    assertOptions(options, new Set(['profile', 'bundle', 'repo']));
    const repoRoot = resolveRepo(options);
    validateSourceOwnership(repoRoot);
    const profile = requireOption(options, 'profile');
    if (!PROFILE_NAMES.includes(profile)) fail('--profile must be guided or autonomous', 'USAGE_ERROR');
    const bundleRoot = path.resolve(requireOption(options, 'bundle'));
    assertExactBundleFiles(bundleRoot);
    const bundle = readProfileBundle(bundleRoot, repoRoot);
    if (bundle.manifest.effective_profile !== profile) {
      fail('bundle does not contain the requested active profile', 'PROFILE_BUNDLE_MISMATCH');
    }
    process.stdout.write(`${JSON.stringify({
      status: 'valid',
      effective_profile: profile,
      bundle_id: bundle.manifest.bundle_id,
    }, null, 2)}\n`);
    return EXIT_SUCCESS;
  }
  fail(`unknown command: ${command}`, 'USAGE_ERROR');
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const code = error && error.code ? error.code : 'UNEXPECTED_ERROR';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = code === 'USAGE_ERROR' ? 2 : 1;
  }
}

module.exports = {
  ProfileBuildError,
  assertExactBundleFiles,
  buildRuleMigration,
  parseArgs,
  run,
  validateGuidedCompatibility,
  validateSourceOwnership,
  writeBaselineSnapshots,
  writeBundle,
};
