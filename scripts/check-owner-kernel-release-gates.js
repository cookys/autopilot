#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');
const {
  assertWitnessAdapter,
  verifyReceiptShape,
} = require('../src/engine/owner-kernel/witness');

const USAGE = `Usage:
  node scripts/check-owner-kernel-release-gates.js --project <project-dir> [--repo-root <dir>] [--check]

Reports mechanical KR8, KR10, and alias-retirement readiness. With --check, exits
non-zero when disposition is HOLD. Never redefines KR metrics or fabricates
elapsed production telemetry.`;

const KR8_DEFINITION = Object.freeze({
  id: 'KR8',
  text: 'zero observed false acceptance, zero observed missed red-line escalation, and at least 30% fewer mandatory model-review dispatches than the P0 legacy baseline of 6',
  baseline_mandatory_model_review_dispatches: 6,
  min_reduction_ratio: 0.3,
});

const KR10_DEFINITION = Object.freeze({
  id: 'KR10',
  text: 'executed post-P3 load-bearing surface count must be strictly below both the legacy baseline (42) and the projected post-P3 target (51)',
  baseline_surface_count: 42,
  projected_post_p3_surface_count: 51,
});

const ALIAS_DEFINITION = Object.freeze({
  id: 'alias_retirement',
  text: 'aliases /l3-/l6 may be removed only after one shipped compatibility cycle and 14 complete witnessed production days with zero translation_used events, zero unresolved translation deltas, and a deterministic scan confirming callers migrated',
  required_witnessed_days: 14,
  levels: ['l3', 'l4', 'l5', 'l6'],
});

const FROZEN_SURFACE_ENUMERATION = Object.freeze({
  skills: Object.freeze([
    'l5', 'ceo-agent', 'dev-flow', 'finish-flow', 'quality-pipeline',
  ]),
  scripts: Object.freeze([
    'resolve-review-loop.sh',
    'dispatch-hetero.sh',
    'dispatch-review.sh',
    'run-ledger.sh',
    'lib/worktree-reap.sh',
    'lib/json-emit.sh',
    'load-endpoints-env.sh',
    'lib/prune-tmp-residue.sh',
    'lib/output-quiescence.sh',
    'lib/dispatch-detach.sh',
    'dispatch-status.js',
    'dispatch-contract.js',
    'check-disjointness.sh',
    'engine-scorecard.js',
    'session-mode.js',
    'watch-foreman.js',
    'resolve-dispatch.sh',
    'check-loop-convergence.js',
    'reap-dispatch-branches.sh',
    'probe-diff-domain.sh',
    'owner-kernel.js',
  ]),
  engine_modules: Object.freeze([
    'autopilot-engine.js',
    'index.js',
    'resolve-review-loop.js',
    path.join('..', 'runners', 'implementer.js'),
    path.join('..', 'runners', 'review.js'),
    path.join('owner-kernel', 'index.js'),
    path.join('owner-kernel', 'policy.js'),
    path.join('owner-kernel', 'events.js'),
    path.join('owner-kernel', 'state.js'),
    path.join('owner-kernel', 'kernel.js'),
    path.join('owner-kernel', 'acceptance.js'),
    path.join('owner-kernel', 'actions.js'),
    path.join('owner-kernel', 'compatibility.js'),
    'supervised-owner-kernel-installed-engine.js',
  ]),
  schemas: Object.freeze([
    'dispatch-unit-contract.schema.json',
    'review-loop-contract.schema.json',
    'owner-event.schema.json',
  ]),
  hooks_default_on: Object.freeze([
    'audit-log',
    'failure-escalation',
    'intent-capture',
    'log-error',
    'reload-watch',
    'session-handoff',
    'session-start',
    'state-checkpoint',
    'suggest-compact',
    'version-drift-check',
  ]),
});

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    project: null,
    repoRoot: path.resolve(__dirname, '..'),
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--project' || arg === '--repo-root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`);
      if (arg === '--project') options.project = value;
      else options.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }
    fail(`unknown argument: ${arg}`);
  }
  if (!options.project) fail(`missing required --project <project-dir>\n${USAGE}`);
  return options;
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function resolveProjectDir(repoRoot, projectArg) {
  const candidates = [
    path.resolve(projectArg),
    path.resolve(repoRoot, projectArg),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  fail(`project directory not found: ${projectArg}`);
}

function isNonEmptySha256(value) {
  return typeof value === 'string'
    && /^[a-f0-9]{64}$/i.test(value)
    && value !== '0'.repeat(64)
    && value !== 'f'.repeat(64);
}

/**
 * Independent installed authority paths only — never project-local journals
 * co-located with the evidence under evaluation. Project telemetry/journal
 * files, their hashes, timestamps, signer IDs, and migration flags are
 * untrusted inputs and cannot supply a parallel trust root.
 *
 * Authority is loaded from independently configured state:
 *   1. AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY (absolute path)
 *   2. ~/.autopilot/trusted-installed-witness-authority.json
 *   3. ~/.autopilot/installed-witness-authority.json
 *
 * Every configured path is realpath-resolved (symlinks followed) before read.
 * Any authority file whose resolved path lies inside repoRoot or the project
 * trust boundary is rejected, regardless of configured spelling (including
 * outside-symlink-into-repo).
 *
 * Production authority requires an independently provisioned external witness
 * adapter (trustTier === 'external'). Serialized caller-authored JSON plus a
 * replayed MemoryWitness (test-tier) never becomes production authority —
 * allowTestWitness is never used for release evidence. Absent an external
 * adapter/anchor the CLI honestly HOLDs.
 */
function isPathInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedParent === resolvedChild) return true;
  const prefix = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : `${resolvedParent}${path.sep}`;
  return resolvedChild.startsWith(prefix);
}

/**
 * Resolve a configured path through every symlink via realpath before trust
 * decisions. Missing paths return null (candidate skipped).
 */
function resolveAuthorityPathReal(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  try {
    return fs.realpathSync(filePath);
  } catch (_error) {
    return null;
  }
}

function independentAuthorityCandidates(projectDir, repoRoot) {
  const candidates = [];
  const envPath = process.env.AUTOPILOT_TRUSTED_INSTALLED_WITNESS_AUTHORITY;
  if (typeof envPath === 'string' && envPath.trim()) {
    candidates.push(path.resolve(envPath.trim()));
  }
  const home = process.env.HOME || process.env.USERPROFILE || null;
  if (home) {
    candidates.push(path.join(home, '.autopilot', 'trusted-installed-witness-authority.json'));
    candidates.push(path.join(home, '.autopilot', 'installed-witness-authority.json'));
  }
  // Deliberately omit projectDir / production-telemetry sibling paths — those
  // are evidence-adjacent and cannot independently authenticate the evidence.
  void projectDir;
  void repoRoot;
  return candidates;
}

function loadTrustedInstalledWitnessAuthority(projectDir, repoRoot) {
  const projectResolved = path.resolve(projectDir);
  const repoResolved = repoRoot ? path.resolve(repoRoot) : null;
  const candidates = independentAuthorityCandidates(projectDir, repoRoot);
  let config = null;
  let configPath = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.includes(`${path.sep}${path.sep}`)) continue;
    // Resolve configured spelling and every symlink before reading.
    const resolvedCandidate = resolveAuthorityPathReal(candidate);
    if (!resolvedCandidate) continue;
    // Reject any authority whose realpath is inside the repo trust boundary
    // or project evidence boundary, regardless of configured spelling
    // (covers in-repo paths and outside-symlink-into-repo).
    if (repoResolved && isPathInside(repoResolved, resolvedCandidate)) {
      continue;
    }
    if (isPathInside(projectResolved, resolvedCandidate)) {
      continue;
    }
    // Also refuse unresolved spelling that lands inside project (belt+suspenders
    // when realpath is outside but spelling was project-relative weirdness).
    if (isPathInside(projectResolved, candidate)
      || (repoResolved && isPathInside(repoResolved, candidate))) {
      continue;
    }
    const data = readJsonIfExists(resolvedCandidate);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      config = data;
      configPath = resolvedCandidate;
      break;
    }
  }
  if (!config) {
    return {
      ok: false,
      reason: 'independently configured installed witness authority/configuration is absent; '
        + 'project-local telemetry/journal files, hashes, timestamps, signer IDs, and migration '
        + 'flags are untrusted and cannot supply their own trust root',
      authority: null,
      stream_id: null,
      config_path: null,
    };
  }
  const kind = config.kind;
  if (kind !== 'trusted_installed_witness_authority'
    && kind !== 'p37_installed_witness_authority') {
    return {
      ok: false,
      reason: 'trusted installed witness authority kind is unsupported',
      authority: null,
      stream_id: null,
      config_path: configPath,
    };
  }
  const streamId = config.stream_id;
  if (typeof streamId !== 'string' || streamId.length === 0) {
    return {
      ok: false,
      reason: 'trusted installed witness authority is missing stream_id binding',
      authority: null,
      stream_id: null,
      config_path: configPath,
    };
  }
  const journal = Array.isArray(config.receipts)
    ? config.receipts
    : (Array.isArray(config.receipt_journal) ? config.receipt_journal : null);
  if (!journal) {
    return {
      ok: false,
      reason: 'trusted installed witness authority is missing receipt journal',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }

  // Production authority requires an independently provisioned external witness
  // adapter module (absolute path outside repo/project). Replaying a caller-
  // authored JSON journal into MemoryWitness is never production authority and
  // must not use allowTestWitness for release evidence.
  const adapterModuleRaw = config.external_adapter_module
    || config.external_witness_adapter_module
    || null;
  if (typeof adapterModuleRaw !== 'string' || !adapterModuleRaw.trim()) {
    return {
      ok: false,
      reason: 'independently provisioned external witness adapter/anchor is absent; '
        + 'serialized caller-authored JSON and a replayed MemoryWitness cannot become '
        + 'production authority (allowTestWitness is forbidden for release evidence); '
        + 'CLI HOLDs until an external adapter is provisioned',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  const adapterModuleCandidate = path.resolve(adapterModuleRaw.trim());
  const adapterModuleReal = resolveAuthorityPathReal(adapterModuleCandidate);
  if (!adapterModuleReal) {
    return {
      ok: false,
      reason: 'external witness adapter module path is not resolvable',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  if (repoResolved && isPathInside(repoResolved, adapterModuleReal)) {
    return {
      ok: false,
      reason: 'external witness adapter module must not resolve inside the repo trust boundary',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  if (isPathInside(projectResolved, adapterModuleReal)) {
    return {
      ok: false,
      reason: 'external witness adapter module must not resolve inside the project evidence boundary',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }

  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const adapterExports = require(adapterModuleReal);
    const factory = typeof adapterExports.createAuthority === 'function'
      ? adapterExports.createAuthority
      : (typeof adapterExports.createWitness === 'function'
        ? adapterExports.createWitness
        : null);
    if (!factory) {
      throw new Error(
        'external witness adapter must export createAuthority() or createWitness()',
      );
    }
    const witness = factory({
      streamId,
      receipts: journal,
      receipt_journal: journal,
      config,
      config_path: configPath,
    });
    // Never allowTestWitness for release evidence — external trustTier only.
    const authority = assertWitnessAdapter(witness, {
      allowTestWitness: false,
      requireBinding: true,
    });
    if (authority.trustTier !== 'external') {
      throw new Error(
        'release-evidence authority must have trustTier "external"; '
        + 'MemoryWitness/test-tier adapters are not production authority',
      );
    }
    // Authority-issued append timestamps (evidence body cannot choose these).
    // Prefer adapter-provided map; otherwise harvest append_timestamp fields
    // from the independently provisioned journal entries only when the adapter
    // also re-emits them via getAppendTimestamp / appendTimestamps.
    const appendTimestamps = new Map();
    if (typeof authority.getAppendTimestamp === 'function') {
      for (const entry of journal) {
        if (!entry || typeof entry !== 'object') continue;
        const head = typeof entry.witness_head === 'string'
          ? entry.witness_head.toLowerCase()
          : null;
        if (!head) continue;
        const ts = authority.getAppendTimestamp(entry);
        if (typeof ts === 'string' && !Number.isNaN(new Date(ts).getTime())) {
          appendTimestamps.set(head, ts);
        }
      }
    } else if (authority.appendTimestamps instanceof Map) {
      for (const [head, ts] of authority.appendTimestamps.entries()) {
        if (typeof head === 'string' && typeof ts === 'string') {
          appendTimestamps.set(head.toLowerCase(), ts);
        }
      }
    } else {
      // Harvest only authority-journal fields the adapter verified by replaying
      // them into its own state. Adapter must set appendTimestamps or
      // getAppendTimestamp — body-only observation timestamps are rejected later.
      for (const entry of journal) {
        if (!entry || typeof entry !== 'object') continue;
        const head = typeof entry.witness_head === 'string'
          ? entry.witness_head.toLowerCase()
          : null;
        const ts = typeof entry.append_timestamp === 'string'
          ? entry.append_timestamp
          : null;
        if (head && ts && !Number.isNaN(new Date(ts).getTime()) && /Z$/.test(ts)) {
          appendTimestamps.set(head, ts);
        }
      }
    }
    return {
      ok: true,
      reason: null,
      authority,
      stream_id: streamId,
      config_path: configPath,
      append_timestamps: appendTimestamps,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `external witness adapter failed to load as production authority: ${error.message}`,
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
}

/**
 * Verify a receipt against the persisted trusted installed witness authority.
 * Never constructs a fresh MemoryWitness from telemetry-controlled stream_id.
 */
function verifyWithTrustedInstalledWitnessAuthority(receipt, {
  expectedPreviousHead = undefined,
  trustedAuthority = null,
} = {}) {
  if (!trustedAuthority || !trustedAuthority.ok || !trustedAuthority.authority) {
    throw new Error(
      'witness receipt cannot be authenticated without persisted trusted installed '
      + 'witness authority/configuration (telemetry-stream-derived fresh witnesses '
      + 'are rejected)',
    );
  }
  verifyReceiptShape(receipt);
  if (expectedPreviousHead !== undefined) {
    const prev = receipt.previous_witness_head;
    if (expectedPreviousHead === null) {
      if (prev !== null && prev !== undefined && prev !== '') {
        throw new Error('first receipt previous_witness_head must be null');
      }
    } else if (typeof prev !== 'string'
      || prev.toLowerCase() !== expectedPreviousHead.toLowerCase()) {
      throw new Error(
        'receipt previous_witness_head does not continue the authoritative chain',
      );
    }
  }
  if (typeof receipt.stream_id !== 'string' || receipt.stream_id.length === 0) {
    throw new Error('witness receipt stream_id is required for authority verification');
  }
  if (receipt.stream_id !== trustedAuthority.stream_id) {
    throw new Error(
      'witness receipt stream_id does not match persisted trusted installed witness authority binding',
    );
  }
  const authority = trustedAuthority.authority;
  if (!authority.verify(receipt)) {
    throw new Error(
      'witness receipt is not authenticated by the trusted installed witness-authority API '
      + '(telemetry-supplied hashes and signer bindings cannot self-authenticate; '
      + 'only receipts recorded in the persisted trusted journal are accepted)',
    );
  }
  return true;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Host-clock UTC calendar days strictly before today. Day labels inside the
 * evidence package are untrusted; the required window is derived only from the
 * verifier host clock (authenticated timestamp outside the evidence).
 */
function requiredWitnessedDayKeys(nowMs = Date.now()) {
  const todayUtc = new Date(nowMs).toISOString().slice(0, 10);
  const [year, month, day] = todayUtc.split('-').map((part) => Number(part));
  const keys = [];
  for (let offset = 1; offset <= ALIAS_DEFINITION.required_witnessed_days; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1, day - offset));
    keys.push(date.toISOString().slice(0, 10));
  }
  return keys.reverse();
}

/**
 * Mechanically execute the deterministic caller-migration scan against the repo.
 * Self-hashed migration bodies and boolean flags in telemetry are not proof.
 */
function executeDeterministicCallerMigrationScan(repoRoot) {
  const callersMigrated = [];
  const remaining = [];
  for (const level of ALIAS_DEFINITION.levels) {
    const skillPath = path.join(repoRoot, 'skills', level, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      callersMigrated.push(level);
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(skillPath, 'utf8');
    } catch (error) {
      return {
        complete: false,
        reason: `caller migration scan failed reading skills/${level}: ${error.message}`,
        callers_migrated: callersMigrated,
        remaining: [...ALIAS_DEFINITION.levels],
      };
    }
    // Compatibility stubs may remain, but lifecycle/trust routing prose means
    // callers have not finished migrating off the alias surface.
    if (/lifecycle|trust.?boundary|owner.?kernel|dispatch.?hetero|ceo-agent|dev-flow/i.test(body)
      && body.length > 400) {
      remaining.push(level);
    } else {
      callersMigrated.push(level);
    }
  }
  if (remaining.length > 0) {
    return {
      complete: false,
      reason: `deterministic caller migration scan found residual alias lifecycle/trust prose `
        + `in: ${remaining.join(',')}`,
      callers_migrated: callersMigrated,
      remaining,
    };
  }
  return {
    complete: true,
    reason: null,
    callers_migrated: callersMigrated,
    remaining: [],
  };
}

function measureSkillMember(repoRoot, name) {
  const skillPath = path.join(repoRoot, 'skills', name, 'SKILL.md');
  if (!fs.existsSync(skillPath)) {
    return { ok: false, error: `skills/${name}/SKILL.md missing` };
  }
  let body;
  try {
    body = fs.readFileSync(skillPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `skills/${name} read failed: ${error.message}` };
  }
  if (!body.includes('name:') && !body.startsWith('---')) {
    return { ok: false, error: `skills/${name} SKILL.md failed frontmatter parse` };
  }
  if (!body.includes(name) && !/name:\s*[^\n]+/.test(body)) {
    return { ok: false, error: `skills/${name} SKILL.md missing name field evidence` };
  }
  return { ok: true };
}

function measureScriptMember(repoRoot, name) {
  const scriptPath = path.join(repoRoot, 'scripts', name);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, error: `scripts/${name} missing` };
  }
  let body;
  try {
    body = fs.readFileSync(scriptPath, 'utf8');
  } catch (error) {
    return { ok: false, error: `scripts/${name} read failed: ${error.message}` };
  }
  if (body.length < 8) {
    return { ok: false, error: `scripts/${name} empty or unparseable` };
  }
  if (name.endsWith('.js')) {
    const checked = spawnSync(process.execPath, ['--check', scriptPath], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    if (checked.error) {
      return { ok: false, error: `scripts/${name} execution check failed: ${checked.error.message}` };
    }
    if (checked.status !== 0) {
      return {
        ok: false,
        error: `scripts/${name} parse/execution evidence failed (exit ${checked.status})`,
      };
    }
  } else if (name.endsWith('.sh')) {
    const checked = spawnSync('bash', ['-n', scriptPath], {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    if (checked.error) {
      return {
        ok: false,
        error: `scripts/${name} bash -n evidence failed: ${checked.error.message}`,
      };
    }
    if (checked.status !== 0) {
      return {
        ok: false,
        error: `scripts/${name} bash -n parse evidence failed (exit ${checked.status}): `
          + `${(checked.stderr || checked.stdout || '').trim()}`,
      };
    }
  } else if (name.endsWith('.py') || !path.extname(name)) {
    if (!body.startsWith('#!') && !body.includes('set -') && !body.includes('#!/')) {
      if (body.trim().length < 16) {
        return { ok: false, error: `scripts/${name} failed measurement (too short)` };
      }
    }
  }
  return { ok: true };
}

function measureEngineMember(repoRoot, name) {
  const modulePath = path.join(repoRoot, 'src', 'engine', name);
  if (!fs.existsSync(modulePath)) {
    return { ok: false, error: `src/engine/${name} missing` };
  }
  try {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    const loaded = require(modulePath);
    if (loaded == null || (typeof loaded !== 'object' && typeof loaded !== 'function')) {
      return { ok: false, error: `src/engine/${name} loaded empty module` };
    }
  } catch (error) {
    return { ok: false, error: `src/engine/${name} require/parse failed: ${error.message}` };
  }
  return { ok: true };
}

function measureSchemaMember(repoRoot, name) {
  const schemaPath = path.join(repoRoot, 'schemas', name);
  if (!fs.existsSync(schemaPath)) {
    return { ok: false, error: `schemas/${name} missing` };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: `schemas/${name} parsed to non-object` };
    }
  } catch (error) {
    return { ok: false, error: `schemas/${name} JSON parse failed: ${error.message}` };
  }
  return { ok: true };
}

/**
 * Mechanically derive executed load-bearing membership. A fixed candidate list
 * is a seed only — never the complete executed surface. Dependency/require
 * graph, hooks inventory, and installed sink exports expand membership so
 * additions or renames cannot evade counting. HOLD if complete membership
 * cannot be established.
 */
function discoverExecutedMembership(repoRoot) {
  const errors = [];
  const skills = new Set(FROZEN_SURFACE_ENUMERATION.skills);
  const scripts = new Set(FROZEN_SURFACE_ENUMERATION.scripts);
  const engineModules = new Set(FROZEN_SURFACE_ENUMERATION.engine_modules);
  const schemas = new Set(FROZEN_SURFACE_ENUMERATION.schemas);
  const hooks = new Set(FROZEN_SURFACE_ENUMERATION.hooks_default_on);

  // Mechanical hooks membership from hooks.json wiring (default-on + wired).
  const hooksJsonPath = path.join(repoRoot, 'hooks', 'hooks.json');
  let hooksJsonPresent = false;
  if (fs.existsSync(hooksJsonPath)) {
    hooksJsonPresent = true;
    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      const hookBlob = JSON.stringify(hooksJson);
      const hookStemRe = /hooks\/([A-Za-z0-9._-]+)\.(?:js|sh)/g;
      let match;
      while ((match = hookStemRe.exec(hookBlob)) !== null) {
        if (!match[1].startsWith('_')) hooks.add(match[1]);
      }
    } catch (error) {
      errors.push(`hooks.json mechanical membership failed: ${error.message}`);
    }
  }

  // Mechanical engine membership via require-graph from installed roots.
  const engineRootDir = path.join(repoRoot, 'src', 'engine');
  const engineRoots = [
    'supervised-owner-kernel-installed-engine.js',
    path.join('owner-kernel', 'index.js'),
    'index.js',
  ];
  const visited = new Set();
  function walkEngineRequires(relModule) {
    const normalized = relModule.replace(/\\/g, '/');
    if (visited.has(normalized)) return;
    visited.add(normalized);
    const abs = path.join(engineRootDir, normalized);
    if (!fs.existsSync(abs)) return;
    engineModules.add(normalized);
    let body;
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch (error) {
      errors.push(`engine require-graph read failed for ${normalized}: ${error.message}`);
      return;
    }
    const requireRe = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let reqMatch;
    while ((reqMatch = requireRe.exec(body)) !== null) {
      const target = reqMatch[1];
      if (!target.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(normalized), target))
        .replace(/\\/g, '/');
      // Stay inside src/engine (and runners sibling referenced by frozen seed).
      let candidate = resolved;
      if (!candidate.endsWith('.js')) {
        if (fs.existsSync(path.join(engineRootDir, `${candidate}.js`))) {
          candidate = `${candidate}.js`;
        } else if (fs.existsSync(path.join(engineRootDir, candidate, 'index.js'))) {
          candidate = path.join(candidate, 'index.js').replace(/\\/g, '/');
        } else {
          continue;
        }
      }
      if (candidate.startsWith('..')) {
        // Allow ../runners/* as frozen seed does.
        const fromSrc = path.normalize(path.join('engine', candidate)).replace(/\\/g, '/');
        if (fromSrc.startsWith('runners/')) {
          engineModules.add(path.join('..', fromSrc).replace(/\\/g, '/'));
        }
        continue;
      }
      walkEngineRequires(candidate);
    }
  }
  if (fs.existsSync(engineRootDir)) {
    for (const root of engineRoots) {
      walkEngineRequires(root);
    }
  }

  // Mechanical scripts membership: seed + scripts required by owner-kernel /
  // release-gate / installed host paths (basename scan of scripts/ that the
  // installed engine surface references).
  const scriptsDir = path.join(repoRoot, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    // Always include owner-kernel CLI and release-gate checker if present.
    for (const extra of [
      'owner-kernel.js',
      'check-owner-kernel-release-gates.js',
      'check-hook-inventory.js',
    ]) {
      if (fs.existsSync(path.join(scriptsDir, extra))) scripts.add(extra);
    }
  }

  // Installed sink export membership (cannot rename-evade).
  const installedEnginePath = path.join(
    repoRoot,
    'src',
    'engine',
    'supervised-owner-kernel-installed-engine.js',
  );
  let includesInstalledEngine = false;
  if (fs.existsSync(installedEnginePath)) {
    engineModules.add('supervised-owner-kernel-installed-engine.js');
    try {
      const resolved = require.resolve(installedEnginePath);
      delete require.cache[resolved];
      const installed = require(installedEnginePath);
      if (installed.INSTALLED_ENGINE_SINK_ID === 'engine-implementation-dispatch-v1') {
        includesInstalledEngine = true;
      } else {
        errors.push('installed-engine surface failed export measurement for fixed sink id');
      }
    } catch (error) {
      errors.push(`installed-engine export measurement failed: ${error.message}`);
    }
  }

  // Hook inventory / hooks.json must corroborate complete membership whenever
  // a hooks/ tree is present. Sparse measurement trees without hooks/ may use
  // seed membership only (removed members reduce cardinality). A production
  // tree that has hooks/ but cannot derive membership HOLDs.
  const inventoryScript = path.join(repoRoot, 'scripts', 'check-hook-inventory.js');
  const hooksTreePresent = fs.existsSync(path.join(repoRoot, 'hooks'));
  let inventoryComplete = false;
  if (fs.existsSync(inventoryScript)) {
    const inventory = spawnSync(
      process.execPath,
      [inventoryScript],
      { encoding: 'utf8', cwd: repoRoot },
    );
    if (inventory.error) {
      errors.push(`hooks inventory execution failed: ${inventory.error.message}`);
    } else if (inventory.status !== 0) {
      errors.push(`hooks inventory exited ${inventory.status}; complete membership cannot be established`);
    } else {
      inventoryComplete = true;
      const out = `${inventory.stdout || ''}\n${inventory.stderr || ''}`;
      for (const line of out.split('\n')) {
        if (/default-on|DEFAULT_ON|default_on/i.test(line)) {
          let stemMatch;
          const localRe = /\b([a-z][a-z0-9-]{2,})\b/g;
          while ((stemMatch = localRe.exec(line)) !== null) {
            const stem = stemMatch[1];
            if (stem === 'default' || stem === 'hooks') continue;
            const jsPath = path.join(repoRoot, 'hooks', `${stem}.js`);
            const shPath = path.join(repoRoot, 'hooks', `${stem}.sh`);
            if (fs.existsSync(jsPath) || fs.existsSync(shPath)) hooks.add(stem);
          }
        }
      }
    }
  } else if (hooksJsonPresent) {
    inventoryComplete = true;
  } else if (!hooksTreePresent) {
    // Sparse tree without hooks/ — seed-only membership is complete for the
    // surfaces that exist; cannot hide a real hooks tree this way.
    inventoryComplete = true;
  } else {
    errors.push(
      'hooks/ tree present but hooks.json and check-hook-inventory.js are absent; '
      + 'complete hook membership cannot be established',
    );
  }

  // Schema seed remains; discover any owner-kernel related schemas present.
  const schemasDir = path.join(repoRoot, 'schemas');
  if (fs.existsSync(schemasDir)) {
    try {
      for (const name of fs.readdirSync(schemasDir)) {
        if (/owner|dispatch-unit-contract|review-loop-contract/.test(name) && name.endsWith('.json')) {
          schemas.add(name);
        }
      }
    } catch (error) {
      errors.push(`schemas mechanical membership failed: ${error.message}`);
    }
  }

  const complete = errors.length === 0 && inventoryComplete;
  return {
    complete,
    errors,
    skills: [...skills],
    scripts: [...scripts],
    engine_modules: [...engineModules],
    schemas: [...schemas],
    hooks_default_on: [...hooks],
    includes_installed_engine: includesInstalledEngine,
  };
}

function countExecutedLoadBearingSurfaces(repoRoot) {
  // KR10 mechanically derives the currently executed load-bearing surface
  // membership (dependency/hook/sink graph + inventory). A fixed candidate list
  // is never treated as the complete executed surface. Thresholds stay frozen
  // at 42 and 51. Incomplete membership discovery HOLDs.
  const measurementErrors = [];
  const nonexecuted = [];

  const discovered = discoverExecutedMembership(repoRoot);
  if (!discovered.complete) {
    for (const error of discovered.errors) {
      measurementErrors.push(`KR10 complete membership cannot be established: ${error}`);
    }
    if (discovered.errors.length === 0) {
      measurementErrors.push(
        'KR10 complete membership cannot be established; HOLD without substitution',
      );
    }
  } else {
    // Propagate non-fatal discovery notes only when complete.
    for (const error of discovered.errors) {
      measurementErrors.push(error);
    }
  }

  const skillEvidence = [];
  for (const name of discovered.skills) {
    const result = measureSkillMember(repoRoot, name);
    if (!result.ok) nonexecuted.push({ bucket: 'skills', name, reason: result.error });
    else skillEvidence.push(name);
  }
  const skillsEntry = skillEvidence.length;

  const scriptEvidence = [];
  for (const name of discovered.scripts) {
    const result = measureScriptMember(repoRoot, name);
    if (!result.ok) nonexecuted.push({ bucket: 'scripts', name, reason: result.error });
    else scriptEvidence.push(name);
  }
  const scripts = scriptEvidence.length;

  const engineEvidence = [];
  for (const name of discovered.engine_modules) {
    const result = measureEngineMember(repoRoot, name);
    if (!result.ok) nonexecuted.push({ bucket: 'engine_modules', name, reason: result.error });
    else engineEvidence.push(name);
  }
  const engineModules = engineEvidence.length;

  const includesInstalledEngine = discovered.includes_installed_engine === true;
  if (!includesInstalledEngine
    && !nonexecuted.some((entry) => entry.name === 'supervised-owner-kernel-installed-engine.js')) {
    // Ensure missing installed engine reduces cardinality explicitly.
    if (!discovered.engine_modules.includes('supervised-owner-kernel-installed-engine.js')) {
      nonexecuted.push({
        bucket: 'installed_engine',
        name: 'supervised-owner-kernel-installed-engine.js',
        reason: 'missing from mechanical membership',
      });
    }
  }

  const schemaEvidence = [];
  for (const name of discovered.schemas) {
    const result = measureSchemaMember(repoRoot, name);
    if (!result.ok) nonexecuted.push({ bucket: 'schemas', name, reason: result.error });
    else schemaEvidence.push(name);
  }
  const schemas = schemaEvidence.length;

  const hookEvidence = [];
  for (const name of discovered.hooks_default_on) {
    const jsPath = path.join(repoRoot, 'hooks', `${name}.js`);
    const shPath = path.join(repoRoot, 'hooks', `${name}.sh`);
    const hookPath = fs.existsSync(jsPath) ? jsPath : (fs.existsSync(shPath) ? shPath : null);
    if (!hookPath) {
      nonexecuted.push({ bucket: 'hooks', name, reason: 'missing' });
      continue;
    }
    let body;
    try {
      body = fs.readFileSync(hookPath, 'utf8');
    } catch (error) {
      measurementErrors.push(`hooks/${name} read failed: ${error.message}`);
      continue;
    }
    if (!body || body.trim().length < 8) {
      nonexecuted.push({ bucket: 'hooks', name, reason: 'empty or trivial body' });
      continue;
    }
    if (hookPath.endsWith('.js')) {
      const parsed = spawnSync(
        process.execPath,
        ['--check', hookPath],
        { encoding: 'utf8', cwd: repoRoot },
      );
      if (parsed.error || parsed.status !== 0) {
        measurementErrors.push(
          `hooks/${name} execution/parse evidence failed: `
          + `${parsed.error ? parsed.error.message : (parsed.stderr || 'syntax check failed')}`,
        );
        continue;
      }
    } else if (hookPath.endsWith('.sh')) {
      if (!/^#!/.test(body)) {
        measurementErrors.push(`hooks/${name} shell hook missing shebang`);
        continue;
      }
      const parsed = spawnSync('bash', ['-n', hookPath], {
        encoding: 'utf8',
        cwd: repoRoot,
      });
      if (parsed.error || parsed.status !== 0) {
        measurementErrors.push(
          `hooks/${name} bash -n parse evidence failed: `
          + `${parsed.error ? parsed.error.message : (parsed.stderr || 'bash -n failed')}`,
        );
        continue;
      }
    } else {
      measurementErrors.push(`hooks/${name} has unsupported extension for KR10 parse evidence`);
      continue;
    }
    hookEvidence.push(name);
  }
  const hooks = hookEvidence.length;

  const total = measurementErrors.length === 0
    ? skillsEntry + scripts + engineModules + schemas + hooks
    : null;

  return {
    skills: skillsEntry,
    scripts,
    engine_modules: engineModules,
    schemas,
    hooks_default_on: hooks,
    total,
    measurement_errors: measurementErrors,
    nonexecuted_members: nonexecuted,
    membership_complete: discovered.complete && measurementErrors.length === 0,
    method: 'mechanically derived executed load-bearing surface membership from dependency/hook/sink graph + inventory (fixed candidate list is seed only, not complete surface); complete membership required or HOLD; removed/nonexecuted members reduce measured cardinality; thresholds remain frozen at 42 and 51; includes supervised-owner-kernel-installed-engine.js when executed; no KR redefinition',
    includes_installed_engine_module: includesInstalledEngine,
    catalog_membership: {
      skills: [...FROZEN_SURFACE_ENUMERATION.skills],
      scripts: [...FROZEN_SURFACE_ENUMERATION.scripts],
      engine_modules: [...FROZEN_SURFACE_ENUMERATION.engine_modules],
      schemas: [...FROZEN_SURFACE_ENUMERATION.schemas],
      hooks_default_on: [...FROZEN_SURFACE_ENUMERATION.hooks_default_on],
    },
    discovered_membership: {
      skills: [...discovered.skills],
      scripts: [...discovered.scripts],
      engine_modules: [...discovered.engine_modules],
      schemas: [...discovered.schemas],
      hooks_default_on: [...discovered.hooks_default_on],
    },
    // Keep frozen_membership key for back-compat report consumers (catalog seed only).
    frozen_membership: {
      skills: [...FROZEN_SURFACE_ENUMERATION.skills],
      scripts: [...FROZEN_SURFACE_ENUMERATION.scripts],
      engine_modules: [...FROZEN_SURFACE_ENUMERATION.engine_modules],
      schemas: [...FROZEN_SURFACE_ENUMERATION.schemas],
      hooks_default_on: [...FROZEN_SURFACE_ENUMERATION.hooks_default_on],
    },
    measured_membership: {
      skills: skillEvidence,
      scripts: scriptEvidence,
      engine_modules: engineEvidence,
      schemas: schemaEvidence,
      hooks_default_on: hookEvidence,
    },
    bucket_completeness: {
      skills: skillEvidence.length === discovered.skills.length,
      scripts: scriptEvidence.length === discovered.scripts.length,
      engine_modules: engineEvidence.length === discovered.engine_modules.length,
      schemas: schemaEvidence.length === discovered.schemas.length,
      hooks: hookEvidence.length === discovered.hooks_default_on.length,
      installed_engine: includesInstalledEngine,
      membership_discovery: discovered.complete,
    },
  };
}

function authenticateProductionProvenance(data, trustedAuthority) {
  // A filename or parseable JSON is not production provenance. Require a
  // content-bound witness receipt authenticated by the persisted trusted
  // installed witness authority.
  const provenance = data && data.production_provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return {
      ok: false,
      reason: 'production-named JSON lacks authenticated production_provenance; '
        + 'a filename or parseable JSON is not production provenance',
    };
  }
  if (!trustedAuthority || !trustedAuthority.ok) {
    return {
      ok: false,
      reason: 'production provenance cannot be authenticated without independently configured '
        + 'installed witness authority state (project-local journals/telemetry are untrusted)',
    };
  }
  const receipt = provenance.witness_receipt;
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return {
      ok: false,
      reason: 'production_provenance.witness_receipt is missing',
    };
  }
  try {
    verifyWithTrustedInstalledWitnessAuthority(receipt, {
      trustedAuthority,
    });
  } catch (error) {
    return {
      ok: false,
      reason: `production provenance receipt failed trusted authority verification: ${error.message}`,
    };
  }
  // Body (counters + baseline fields) must be content-bound to the receipt
  // event_hash. A trusted receipt alone is not enough: event_hash must equal
  // the canonical KR8 body hash. When evidence_body_hash is present it must
  // also equal that same body hash — equality with event_hash alone is not a
  // binding (that would allow an unrelated trusted receipt to pass).
  const body = {
    observed_false_acceptances: data.observed_false_acceptances,
    observed_missed_red_line_escalations: data.observed_missed_red_line_escalations,
    candidate_mandatory_review_dispatches: data.candidate_mandatory_review_dispatches,
    baseline_mandatory_review_dispatches: data.baseline_mandatory_review_dispatches == null
      ? KR8_DEFINITION.baseline_mandatory_model_review_dispatches
      : data.baseline_mandatory_review_dispatches,
  };
  const bodyHash = sha256(canonicalJson(body));
  const eventHash = typeof receipt.event_hash === 'string' ? receipt.event_hash.toLowerCase() : '';
  const explicit = typeof provenance.evidence_body_hash === 'string'
    ? provenance.evidence_body_hash.toLowerCase()
    : null;
  if (eventHash !== bodyHash) {
    return {
      ok: false,
      reason: 'production provenance receipt event_hash is not bound to KR8 evidence body',
    };
  }
  if (explicit && explicit !== bodyHash) {
    return {
      ok: false,
      reason: 'production provenance evidence_body_hash does not match KR8 evidence body',
    };
  }
  return { ok: true, reason: null };
}

function loadKr8Evidence(projectDir, trustedAuthority = null) {
  const reasons = [];
  const productionTelemetryPaths = [
    path.join(projectDir, 'p3', 'production-telemetry', 'kr8.json'),
    path.join(projectDir, 'production-telemetry', 'kr8.json'),
    path.join(projectDir, 'p3', 'dogfood', 'kr8.json'),
  ];
  for (const candidate of productionTelemetryPaths) {
    const data = readJsonIfExists(candidate);
    if (!data) continue;

    const falseRaw = data.observed_false_acceptances;
    const missedRaw = data.observed_missed_red_line_escalations;
    const candidateRaw = data.candidate_mandatory_review_dispatches;
    // Negative/non-integer counters always HOLD and cannot fund KR8 PASS.
    if (!isNonNegativeInteger(falseRaw)
      || !isNonNegativeInteger(missedRaw)
      || !isNonNegativeInteger(candidateRaw)) {
      reasons.push(
        'KR8 counters must be non-negative integers; negative/non-integer counters '
        + 'always HOLD and cannot fund KR8 PASS',
      );
      return {
        source: 'untrusted_production_named_json',
        path: path.relative(projectDir, candidate),
        observed_false_acceptances: falseRaw,
        observed_missed_red_line_escalations: missedRaw,
        baseline_mandatory_review_dispatches:
          KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
        candidate_mandatory_review_dispatches: candidateRaw,
        telemetry_reported_baseline: data.baseline_mandatory_review_dispatches == null
          ? null
          : Number(data.baseline_mandatory_review_dispatches),
        reasons,
      };
    }

    const provenance = authenticateProductionProvenance(data, trustedAuthority);
    if (!provenance.ok) {
      reasons.push(provenance.reason);
      return {
        source: 'untrusted_production_named_json',
        path: path.relative(projectDir, candidate),
        observed_false_acceptances: falseRaw,
        observed_missed_red_line_escalations: missedRaw,
        baseline_mandatory_review_dispatches:
          KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
        candidate_mandatory_review_dispatches: candidateRaw,
        telemetry_reported_baseline: data.baseline_mandatory_review_dispatches == null
          ? null
          : Number(data.baseline_mandatory_review_dispatches),
        reasons,
      };
    }

    const reportedBaseline = data.baseline_mandatory_review_dispatches;
    if (reportedBaseline != null
      && Number(reportedBaseline) !== KR8_DEFINITION.baseline_mandatory_model_review_dispatches) {
      reasons.push(
        `production telemetry baseline_mandatory_review_dispatches=${reportedBaseline} `
        + `conflicts with frozen KR8 baseline ${KR8_DEFINITION.baseline_mandatory_model_review_dispatches}; `
        + 'conflicting baseline is a blocker and must never replace the frozen baseline',
      );
    }
    return {
      source: 'production_telemetry',
      path: path.relative(projectDir, candidate),
      observed_false_acceptances: falseRaw,
      observed_missed_red_line_escalations: missedRaw,
      baseline_mandatory_review_dispatches:
        KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
      candidate_mandatory_review_dispatches: candidateRaw,
      telemetry_reported_baseline: reportedBaseline == null ? null : Number(reportedBaseline),
      reasons,
    };
  }

  const spikeSummary = readJsonIfExists(path.join(
    projectDir,
    'p0',
    'spike',
    'evidence-2026-07-23-hardened-r2',
    'run',
    'summaries',
    'acceptance.json',
  ));
  if (spikeSummary) {
    reasons.push(
      'only fixture/spike KR8 evidence is present; production installed dogfood telemetry is required for release',
    );
    return {
      source: 'fixture_spike_not_production',
      path: 'p0/spike/evidence-2026-07-23-hardened-r2/run/summaries/acceptance.json',
      observed_false_acceptances: Number(spikeSummary.observed_false_acceptances),
      observed_missed_red_line_escalations: Number(spikeSummary.observed_missed_red_line_escalations),
      baseline_mandatory_review_dispatches:
        KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
      candidate_mandatory_review_dispatches: Number(
        spikeSummary.candidate_mandatory_review_dispatches,
      ),
      telemetry_reported_baseline: null,
      reasons,
    };
  }

  reasons.push('no KR8 evidence file found under production or spike paths');
  return {
    source: 'missing',
    path: null,
    observed_false_acceptances: null,
    observed_missed_red_line_escalations: null,
    baseline_mandatory_review_dispatches: KR8_DEFINITION.baseline_mandatory_model_review_dispatches,
    candidate_mandatory_review_dispatches: null,
    telemetry_reported_baseline: null,
    reasons,
  };
}

function evaluateKr8(evidence) {
  const blocking = [...evidence.reasons];
  let status = 'HOLD';
  let reduction = null;
  const baseline = KR8_DEFINITION.baseline_mandatory_model_review_dispatches;
  if (evidence.baseline_mandatory_review_dispatches !== baseline) {
    blocking.push(
      `KR8 baseline must remain frozen at ${baseline}; got ${evidence.baseline_mandatory_review_dispatches}`,
    );
  }
  if (evidence.source === 'missing') {
    blocking.push('KR8 cannot pass without mechanical evidence');
  } else if (evidence.source === 'fixture_spike_not_production') {
    if (Number.isFinite(evidence.candidate_mandatory_review_dispatches) && baseline > 0) {
      reduction = 1 - (evidence.candidate_mandatory_review_dispatches / baseline);
    }
    blocking.push('KR8 fixture arithmetic is not production telemetry and cannot fund release');
  } else if (evidence.source === 'untrusted_production_named_json') {
    blocking.push(
      'production-named JSON without authenticated production provenance cannot fund KR8 PASS',
    );
  } else {
    if (!isNonNegativeInteger(evidence.observed_false_acceptances)
      || !isNonNegativeInteger(evidence.observed_missed_red_line_escalations)
      || !isNonNegativeInteger(evidence.candidate_mandatory_review_dispatches)) {
      blocking.push(
        'KR8 counters must be non-negative integers; negative/non-integer counters always HOLD',
      );
    } else {
      const falseOk = evidence.observed_false_acceptances === 0;
      const missedOk = evidence.observed_missed_red_line_escalations === 0;
      if (!falseOk) {
        blocking.push(`observed_false_acceptances=${evidence.observed_false_acceptances}`);
      }
      if (!missedOk) {
        blocking.push(
          `observed_missed_red_line_escalations=${evidence.observed_missed_red_line_escalations}`,
        );
      }
      if (baseline <= 0) {
        blocking.push('mandatory model-review dispatch counts are incomplete');
      } else {
        reduction = 1 - (evidence.candidate_mandatory_review_dispatches / baseline);
        if (reduction < KR8_DEFINITION.min_reduction_ratio) {
          blocking.push(
            `mandatory model-review reduction ${(reduction * 100).toFixed(1)}% is below 30%`,
          );
        }
      }
    }
    if (blocking.length === 0) status = 'PASS';
  }
  return {
    id: 'KR8',
    definition: KR8_DEFINITION,
    evidence,
    reduction_ratio: reduction,
    status,
    blocking_reasons: blocking,
  };
}

function evaluateKr10(surface) {
  const blocking = [];
  if (surface.measurement_errors && surface.measurement_errors.length > 0) {
    for (const error of surface.measurement_errors) {
      blocking.push(`KR10 measurement failure: ${error}`);
    }
    return {
      id: 'KR10',
      definition: KR10_DEFINITION,
      measured_surface: surface,
      status: 'HOLD',
      blocking_reasons: blocking,
    };
  }
  if (surface.membership_complete !== true) {
    blocking.push(
      'KR10 complete executed membership cannot be established mechanically; HOLD without substitution',
    );
  }
  if (!surface.includes_installed_engine_module) {
    blocking.push(
      'KR10 mechanical membership must include supervised-owner-kernel-installed-engine.js',
    );
  }
  const measured = surface.total;
  if (!Number.isFinite(measured)) {
    blocking.push('KR10 measured surface total is not finite; HOLD without substitution');
  } else {
    if (!(measured < KR10_DEFINITION.baseline_surface_count)) {
      blocking.push(
        `measured surface count ${measured} is not strictly below baseline ${KR10_DEFINITION.baseline_surface_count}`,
      );
    }
    if (!(measured < KR10_DEFINITION.projected_post_p3_surface_count)) {
      blocking.push(
        `measured surface count ${measured} is not strictly below projected ${KR10_DEFINITION.projected_post_p3_surface_count}`,
      );
    }
    if (measured >= KR10_DEFINITION.baseline_surface_count) {
      blocking.push(
        'KR10 remains the executed-module cardinality gate; definition is not revised after measurement',
      );
    }
  }
  return {
    id: 'KR10',
    definition: KR10_DEFINITION,
    measured_surface: surface,
    status: blocking.length === 0 ? 'PASS' : 'HOLD',
    blocking_reasons: blocking,
  };
}

function evaluateAliasRetirement(repoRoot, projectDir, trustedAuthority = null) {
  const blocking = [];
  const present = [];
  const missing = [];
  for (const level of ALIAS_DEFINITION.levels) {
    const skillPath = path.join(repoRoot, 'skills', level, 'SKILL.md');
    if (fs.existsSync(skillPath)) present.push(level);
    else missing.push(level);
  }
  const nonblockingNotes = [];
  if (missing.length > 0) {
    nonblockingNotes.push(
      `compatibility aliases missing (informational): ${missing.join(',')}`,
    );
  } else {
    nonblockingNotes.push(
      'compatibility aliases /l3-/l6 are still present (nonblocking; deletion not authorized yet)',
    );
  }

  // Alias authenticity comes only from independently configured installed
  // witness authority state; project-local telemetry/journals cannot self-trust.
  if (!trustedAuthority || !trustedAuthority.ok) {
    blocking.push(
      'alias retirement requires independently configured installed witness authority state; '
      + (trustedAuthority && trustedAuthority.reason
        ? trustedAuthority.reason
        : 'independent trusted authority state is absent'),
    );
  }

  // Mechanical migration scan always runs; self-hashed telemetry flags are not proof.
  const migrationScan = executeDeterministicCallerMigrationScan(repoRoot);

  const productionTelemetry = readJsonIfExists(path.join(
    projectDir,
    'p3',
    'production-telemetry',
    'alias-retirement.json',
  )) || readJsonIfExists(path.join(
    projectDir,
    'production-telemetry',
    'alias-retirement.json',
  ));

  let witnessedDays = 0;
  let translationUsed = null;
  let unresolvedDeltas = null;
  let telemetrySource = 'missing';
  let shippedCompatibilityCycle = false;
  let deterministicCallerMigration = false;
  let dayRecords = null;

  if (productionTelemetry) {
    telemetrySource = 'production_telemetry';
    witnessedDays = Number(productionTelemetry.witnessed_zero_use_days || 0);
    translationUsed = Number(productionTelemetry.translation_used_events ?? NaN);
    unresolvedDeltas = Number(productionTelemetry.unresolved_translation_deltas ?? NaN);

    const cycleId = productionTelemetry.compatibility_cycle_id;
    const cycleReceipt = productionTelemetry.compatibility_cycle_ship_receipt;
    const cycleReceiptBody = productionTelemetry.compatibility_cycle_receipt_body;
    // Telemetry-supplied signer IDs / bindings / keys / callbacks are untrusted and
    // are never read as a trust root (alias-receipt-self-authentication).
    let cycleReceiptBound = false;
    let authorityAuthenticated = false;
    let verifiedCycleReceipt = null;
    if (typeof cycleId === 'string'
      && /^[a-z0-9][a-z0-9._-]{2,128}$/i.test(cycleId)
      && cycleReceiptBody && typeof cycleReceiptBody === 'object'
      && !Array.isArray(cycleReceiptBody)
      && cycleReceiptBody.compatibility_cycle_id === cycleId
      && cycleReceipt && typeof cycleReceipt === 'object'
      && !Array.isArray(cycleReceipt)
      && productionTelemetry.shipped_compatibility_cycle === true) {
      try {
        // Day-zero genesis receipt has null previous head. Authentication comes
        // exclusively from the persisted trusted installed witness-authority —
        // never from a telemetry-stream-derived fresh MemoryWitness.
        verifyWithTrustedInstalledWitnessAuthority(cycleReceipt, {
          expectedPreviousHead: null,
          trustedAuthority,
        });
        // Body must be content-bound to the receipt event_hash (not free-form).
        const bodyHash = sha256(canonicalJson(cycleReceiptBody));
        if (cycleReceipt.event_hash.toLowerCase() !== bodyHash.toLowerCase()) {
          throw new Error(
            'compatibility cycle receipt event_hash is not bound to receipt body',
          );
        }
        verifiedCycleReceipt = cycleReceipt;
        cycleReceiptBound = true;
        authorityAuthenticated = true;
      } catch (_error) {
        cycleReceiptBound = false;
        verifiedCycleReceipt = null;
        authorityAuthenticated = false;
      }
    }
    shippedCompatibilityCycle = cycleReceiptBound;
    if (!shippedCompatibilityCycle) {
      blocking.push(
        'shipped compatibility cycle evidence missing or incomplete '
        + '(require compatibility_cycle_ship_receipt authenticated by the persisted '
        + 'trusted installed witness-authority API via assertWitnessAdapter + witness.verify; '
        + 'reject telemetry self-authentication, self-computable heads, telemetry-derived '
        + 'fresh MemoryWitness, and self-asserted booleans)',
      );
    }

    // Caller migration OR semantics: completion is established by EITHER a
    // mechanically executed migration scan OR installed-authority authentication.
    // Do not require an untrusted telemetry completion flag, and do not require
    // both alternatives simultaneously. Self-hashed flags alone are never proof.
    const migrationHash = productionTelemetry.caller_migration_scan_hash;
    const migrationBody = productionTelemetry.caller_migration_scan_body;
    const migrationReceipt = productionTelemetry.caller_migration_witness_receipt;
    let migrationAuthorityAuthenticated = false;
    if (migrationBody && typeof migrationBody === 'object' && !Array.isArray(migrationBody)
      && isNonEmptySha256(migrationHash)
      && migrationBody.complete === true
      && Array.isArray(migrationBody.callers_migrated)
      && migrationReceipt && typeof migrationReceipt === 'object'
      && !Array.isArray(migrationReceipt)
      && trustedAuthority && trustedAuthority.ok) {
      try {
        verifyWithTrustedInstalledWitnessAuthority(migrationReceipt, {
          trustedAuthority,
        });
        const bodyHash = sha256(canonicalJson(migrationBody)).toLowerCase();
        if (migrationReceipt.event_hash.toLowerCase() !== bodyHash
          || migrationHash.toLowerCase() !== bodyHash) {
          throw new Error('migration receipt event_hash is not bound to migration scan body');
        }
        migrationAuthorityAuthenticated = true;
      } catch (_error) {
        migrationAuthorityAuthenticated = false;
      }
    }
    // OR: mechanical scan complete OR authority-authenticated migration body.
    // Untrusted caller_migration_complete / deterministic_caller_migration flags
    // never participate in the success predicate.
    deterministicCallerMigration = migrationScan.complete === true
      || migrationAuthorityAuthenticated === true;
    const selfHashedOnly = migrationBody && typeof migrationBody === 'object'
      && isNonEmptySha256(migrationHash)
      && sha256(canonicalJson(migrationBody)).toLowerCase() === migrationHash.toLowerCase()
      && productionTelemetry.deterministic_caller_migration === true
      && !deterministicCallerMigration;
    if (selfHashedOnly) {
      blocking.push(
        'self-hashed deterministic_caller_migration:true is not proof; '
        + 'caller migration must be mechanically executed or authenticated by independent '
        + 'installed authority (require caller_migration_witness_receipt bound to scan body)',
      );
    }
    if (!deterministicCallerMigration) {
      blocking.push(
        'deterministic caller migration evidence missing or incomplete '
        + '(require mechanical migration scan complete OR authority-authenticated '
        + 'caller_migration_witness_receipt bound to caller_migration_scan_body; '
        + 'reject self-asserted booleans, untrusted telemetry completion flags, '
        + 'and self-hashed bodies alone; do not require both alternatives simultaneously)'
        + (migrationScan.reason ? `; scan: ${migrationScan.reason}` : ''),
      );
    }

    dayRecords = Array.isArray(productionTelemetry.witnessed_day_records)
      ? productionTelemetry.witnessed_day_records
      : null;

    // Required day window comes only from the verifier host clock — not from
    // backdated day labels inside the evidence package. Each day receipt must
    // bind an authority-issued append timestamp that the evidence body cannot
    // choose; that timestamp must fall on the exact claimed host-clock UTC day.
    // Body-chosen observation_timestamp fields alone never satisfy the window.
    const requiredDays = requiredWitnessedDayKeys(Date.now());
    const requiredDaySet = new Set(requiredDays);
    const authorityAppendTimestamps = trustedAuthority && trustedAuthority.append_timestamps
      ? trustedAuthority.append_timestamps
      : new Map();

    if (!dayRecords || dayRecords.length < ALIAS_DEFINITION.required_witnessed_days) {
      blocking.push(
        `full witnessed 14-day production evidence missing; `
        + `have ${dayRecords ? dayRecords.length : 0} day records, `
        + `require ${ALIAS_DEFINITION.required_witnessed_days} (scalar day count alone is insufficient)`,
      );
    } else if (!shippedCompatibilityCycle || !verifiedCycleReceipt || !authorityAuthenticated) {
      blocking.push(
        '14-day witnessed chain cannot be validated without a trusted-authority shipped-cycle receipt',
      );
    } else {
      const validDays = [];
      // Day one must continue the shipped-cycle receipt head (bind first day to
      // the trusted-authority-verified compatibility-cycle receipt).
      let previousWitnessHead = verifiedCycleReceipt.witness_head.toLowerCase();
      for (const day of dayRecords) {
        if (!day || typeof day !== 'object') continue;
        if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) continue;
        // Reject backdated or future day labels outside the host-clock window.
        if (!requiredDaySet.has(day.day)) continue;
        if (day.translation_used_events !== 0 || day.unresolved_translation_deltas !== 0) continue;
        const dayReceipt = day.witness_receipt;
        if (!dayReceipt || typeof dayReceipt !== 'object' || Array.isArray(dayReceipt)) continue;
        try {
          verifyWithTrustedInstalledWitnessAuthority(dayReceipt, {
            expectedPreviousHead: previousWitnessHead,
            trustedAuthority,
          });
        } catch (_error) {
          continue;
        }
        if (day.witness_head
          && day.witness_head.toLowerCase() !== dayReceipt.witness_head.toLowerCase()) {
          continue;
        }
        // Authority-issued append timestamp: from the trusted authority adapter /
        // journal map only. Evidence-body observation_timestamp cannot choose it.
        const receiptHead = dayReceipt.witness_head.toLowerCase();
        let appendTs = null;
        if (typeof trustedAuthority.authority.getAppendTimestamp === 'function') {
          appendTs = trustedAuthority.authority.getAppendTimestamp(dayReceipt);
        } else if (authorityAppendTimestamps.has(receiptHead)) {
          appendTs = authorityAppendTimestamps.get(receiptHead);
        }
        if (typeof appendTs !== 'string'
          || !/Z$/.test(appendTs)
          || Number.isNaN(new Date(appendTs).getTime())) {
          continue;
        }
        const appendDayKey = new Date(appendTs).toISOString().slice(0, 10);
        // Timestamp must fall on the exact claimed required UTC day — a
        // today-created backdated chain (labels past, appends today) cannot pass.
        if (appendDayKey !== day.day) continue;
        if (!requiredDaySet.has(appendDayKey)) continue;
        // Day body is content-bound without a free-choice observation timestamp.
        // Authority-issued append timestamp is outside the body the caller hashes.
        const dayBodyHash = sha256(canonicalJson({
          day: day.day,
          translation_used_events: 0,
          unresolved_translation_deltas: 0,
          prior_witness_head: previousWitnessHead,
        }));
        const eventHash = dayReceipt.event_hash.toLowerCase();
        if (eventHash !== dayBodyHash.toLowerCase()) {
          continue;
        }
        validDays.push({
          day: day.day,
          append_timestamp: appendTs,
          witness_head: dayReceipt.witness_head.toLowerCase(),
          event_hash: eventHash,
        });
        previousWitnessHead = dayReceipt.witness_head.toLowerCase();
      }
      const validDaySet = new Set(validDays.map((day) => day.day));
      const missingRequired = requiredDays.filter((day) => !validDaySet.has(day));
      if (missingRequired.length > 0 || validDays.length < ALIAS_DEFINITION.required_witnessed_days) {
        blocking.push(
          `only ${validDays.length} complete witnessed day records with trusted-authority receipt chain `
          + `and authority-issued append timestamps bound to the shipped-cycle receipt `
          + `over the host-clock required window `
          + `(${requiredDays[0]}..${requiredDays[requiredDays.length - 1]}); `
          + `require ${ALIAS_DEFINITION.required_witnessed_days} `
          + '(backdated labels, fourteen-created-today chains, body-chosen observation timestamps, '
          + 'and shape-only fabricated chains are rejected; authority-issued append timestamps '
          + 'must fall on the exact claimed required UTC day)',
        );
      }
      const distinctDays = new Set(validDays.map((day) => day.day));
      if (distinctDays.size !== validDays.length) {
        blocking.push(
          'duplicate production days rejected; require 14 distinct complete witnessed days',
        );
      }
      if (distinctDays.size < ALIAS_DEFINITION.required_witnessed_days) {
        blocking.push(
          `only ${distinctDays.size} distinct complete production days in the host-clock window; `
          + `require ${ALIAS_DEFINITION.required_witnessed_days}`,
        );
      }
      const distinctHeads = new Set(validDays.map((day) => day.witness_head));
      if (distinctHeads.size !== validDays.length) {
        blocking.push(
          'duplicate or arbitrary repeated witness heads rejected across production days',
        );
      }
      const distinctEvents = new Set(validDays.map((day) => day.event_hash));
      if (distinctEvents.size !== validDays.length) {
        blocking.push(
          'duplicate or self-computable shaped event hashes rejected across production days',
        );
      }
      if (witnessedDays !== validDays.length || witnessedDays !== distinctDays.size) {
        blocking.push(
          `scalar witnessed_zero_use_days=${witnessedDays} does not match `
          + `validated distinct day-record count ${distinctDays.size}; refusing scalar-only trust`,
        );
      }
    }
    if (translationUsed !== 0) {
      blocking.push(`translation_used_events=${translationUsed} (require 0)`);
    }
    if (unresolvedDeltas !== 0) {
      blocking.push(`unresolved_translation_deltas=${unresolvedDeltas} (require 0)`);
    }
  } else {
    blocking.push(
      'no production alias-retirement telemetry; refusing to manufacture 14 elapsed days or promote fixture telemetry',
    );
  }

  const fixtureTelemetry = readJsonIfExists(path.join(
    projectDir,
    'p0',
    'fixtures',
    'alias-retirement-fixture.json',
  ));
  if (fixtureTelemetry) {
    blocking.push(
      'fixture alias telemetry is present and intentionally excluded from production retirement evidence',
    );
  }

  return {
    id: 'alias_retirement',
    definition: ALIAS_DEFINITION,
    aliases_present: present,
    aliases_missing: missing,
    aliases_present_nonblocking: true,
    nonblocking_notes: nonblockingNotes,
    telemetry_source: telemetrySource,
    trusted_authority_present: Boolean(trustedAuthority && trustedAuthority.ok),
    trusted_authority_path: trustedAuthority && trustedAuthority.config_path
      ? trustedAuthority.config_path
      : null,
    witnessed_zero_use_days: witnessedDays,
    translation_used_events: translationUsed,
    unresolved_translation_deltas: unresolvedDeltas,
    shipped_compatibility_cycle: shippedCompatibilityCycle,
    deterministic_caller_migration: deterministicCallerMigration,
    mechanical_caller_migration_scan: migrationScan,
    status: blocking.length === 0 ? 'PASS' : 'HOLD',
    blocking_reasons: blocking,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const repoRoot = options.repoRoot;
  const projectDir = resolveProjectDir(repoRoot, options.project);
  const trustedAuthority = loadTrustedInstalledWitnessAuthority(projectDir, repoRoot);
  const surface = countExecutedLoadBearingSurfaces(repoRoot);
  const kr8 = evaluateKr8(loadKr8Evidence(projectDir, trustedAuthority));
  const kr10 = evaluateKr10(surface);
  const alias = evaluateAliasRetirement(repoRoot, projectDir, trustedAuthority);

  const blocking = [
    ...kr8.blocking_reasons.map((reason) => `KR8: ${reason}`),
    ...kr10.blocking_reasons.map((reason) => `KR10: ${reason}`),
    ...alias.blocking_reasons.map((reason) => `alias_retirement: ${reason}`),
  ];
  const disposition = blocking.length === 0 ? 'PASS' : 'HOLD';
  const material = {
    schema_version: 1,
    kind: 'owner_kernel_release_gate_report',
    project: path.relative(repoRoot, projectDir) || projectDir,
    disposition,
    kr8,
    kr10,
    alias_retirement: alias,
    blocking_reasons: blocking,
    notes: [
      'KR definitions are frozen by the parent plan and are not redefined by this checker',
      'KR8 always uses frozen baseline 6; conflicting production telemetry is a blocker',
      'KR8 requires authenticated production provenance; a filename or parseable JSON is not production provenance',
      'KR10 mechanically derives executed load-bearing membership from dependency/hook/sink graph + inventory; fixed candidate lists are seed only; incomplete membership HOLDs; thresholds stay frozen at 42 and 51',
      'alias authenticity comes only from independently provisioned external witness adapter + installed authority state',
      'serialized caller-authored JSON and replayed MemoryWitness never become production authority; allowTestWitness is forbidden for release evidence',
      'day evidence requires authority-issued append timestamps in the host-clock window; body-chosen observation timestamps cannot forge elapsed days',
      'project-local telemetry/journal files, hashes, timestamps, signer IDs, and migration flags are untrusted inputs',
      'self-hashed deterministic_caller_migration is not proof; migration is mechanical OR authority-authenticated (not both required; telemetry completion flags are untrusted)',
      'fixture telemetry is never promoted to production telemetry',
      'this checker never deletes compatibility aliases',
      'present compatibility aliases are nonblocking; only unmet retirement prerequisites HOLD',
      'P4 role qualification is out of scope',
    ],
  };
  material.report_hash = sha256(canonicalJson(material));
  process.stdout.write(`${JSON.stringify(material, null, 2)}\n`);
  if (options.check && disposition === 'HOLD') {
    process.exitCode = 1;
  }
}

main();
