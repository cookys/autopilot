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
elapsed production telemetry.

Production trust roots are fixed installation paths under /etc/autopilot only
(not env, HOME, project, or CLI flags).`;

/** Fixed installation-controlled production trust roots (never caller-selected). */
const PRODUCTION_AUTHORITY_PATH =
  '/etc/autopilot/trusted-installed-witness-authority.json';
const PRODUCTION_ADAPTER_BINDING_PATH =
  '/etc/autopilot/trusted-witness-adapter-binding.json';

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
 * Production CLI trust roots are fixed installation-controlled paths only:
 *   - /etc/autopilot/trusted-installed-witness-authority.json
 *   - /etc/autopilot/trusted-witness-adapter-binding.json
 * Env, HOME, project, CLI flags, and serialized evidence cannot select authority.
 * Paths must be regular, root-owned, not group/other-writable, non-symlink files
 * with similarly owned parents. Hermetic tests may inject trust paths only via
 * evaluateReleaseGatesFixture({ trust: { authorityPath, adapterBindingPath,
 * skipInstallationOwnershipChecks } }) — test-only; always forces overall HOLD.
 * Production evaluateReleaseGates never accepts trust injection.
 *
 * Adapter module identity + integrity pin come only from the deployment binding
 * (never from authority journal selecting adapter_module/digest). Binding must
 * not supply anchored_append_timestamps; elapsed-day evidence is adapter-owned
 * after receipt verify. allowTestWitness is never used for release evidence.
 */
function isPathInside(parent, child) {
  // Callers must pass already-canonical (realpath) boundaries when used for
  // trust decisions. path.resolve alone is insufficient for symlink roots.
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  if (resolvedParent === resolvedChild) return true;
  const prefix = resolvedParent.endsWith(path.sep)
    ? resolvedParent
    : `${resolvedParent}${path.sep}`;
  return resolvedChild.startsWith(prefix);
}

/**
 * Canonicalize a project/repo trust-boundary root with realpath. Symlinked
 * --project / --repo-root must not make co-located trust material appear external.
 * Missing or un-realpathable roots fail closed.
 */
function canonicalizeBoundaryRoot(rootPath, label) {
  if (typeof rootPath !== 'string' || !rootPath.trim()) {
    return {
      ok: false,
      path: null,
      reason: `${label} boundary root is missing; cannot authenticate release evidence`,
    };
  }
  try {
    return { ok: true, path: fs.realpathSync(rootPath), reason: null };
  } catch (error) {
    return {
      ok: false,
      path: null,
      reason: `${label} boundary root cannot be realpathed; HOLD without treating path.resolve spelling as external: ${error.message}`,
    };
  }
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

function fileSha256Hex(filePath) {
  const body = fs.readFileSync(filePath);
  return require('crypto').createHash('sha256').update(body).digest('hex');
}

/**
 * Production authority candidates: fixed /etc path only.
 * Env/HOME/project are never consulted on the production path.
 */
function productionAuthorityCandidates() {
  return [PRODUCTION_AUTHORITY_PATH];
}

/**
 * Production adapter binding candidates: fixed /etc path only.
 */
function productionAdapterBindingCandidates() {
  return [PRODUCTION_ADAPTER_BINDING_PATH];
}

/**
 * Installation trust path checks: regular file, not symlink, root-owned,
 * not group/other writable; parents similarly root-owned and not group/other writable.
 */
function assertSecureInstallationPath(filePath, label) {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (error) {
    return {
      ok: false,
      reason: `${label} is absent at fixed installation path ${filePath}: ${error.message}`,
    };
  }
  if (st.isSymbolicLink()) {
    return { ok: false, reason: `${label} must not be a symlink: ${filePath}` };
  }
  if (!st.isFile()) {
    return { ok: false, reason: `${label} must be a regular file: ${filePath}` };
  }
  if (typeof st.uid === 'number' && st.uid !== 0) {
    return {
      ok: false,
      reason: `${label} must be root-owned (uid 0); got uid ${st.uid}`,
    };
  }
  if ((st.mode & 0o022) !== 0) {
    return {
      ok: false,
      reason: `${label} must not be group/other writable (mode ${ (st.mode & 0o777).toString(8) })`,
    };
  }
  let dir = path.dirname(filePath);
  for (let depth = 0; depth < 64; depth += 1) {
    let dst;
    try {
      dst = fs.lstatSync(dir);
    } catch (_error) {
      break;
    }
    if (dst.isSymbolicLink()) {
      return {
        ok: false,
        reason: `${label} parent path component must not be a symlink: ${dir}`,
      };
    }
    if (typeof dst.uid === 'number' && dst.uid !== 0) {
      return {
        ok: false,
        reason: `${label} parent ${dir} must be root-owned (uid 0); got uid ${dst.uid}`,
      };
    }
    if ((dst.mode & 0o022) !== 0) {
      return {
        ok: false,
        reason: `${label} parent ${dir} must not be group/other writable`,
      };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { ok: true, reason: null };
}

/**
 * Load deployment-provisioned adapter binding (path + sha256 pin).
 * Production uses fixed /etc path only. Hermetic tests may inject trust paths
 * via options.trust (never from CLI argv/env).
 */
function loadTrustedWitnessAdapterBinding(projectDir, repoRoot, options = {}) {
  const trust = options.trust && typeof options.trust === 'object' ? options.trust : {};
  const skipOwnership = trust.skipInstallationOwnershipChecks === true;
  const projectBoundary = canonicalizeBoundaryRoot(projectDir, 'project');
  if (!projectBoundary.ok) {
    return {
      ok: false,
      reason: projectBoundary.reason,
      binding: null,
      binding_path: null,
    };
  }
  let repoResolved = null;
  if (repoRoot) {
    const repoBoundary = canonicalizeBoundaryRoot(repoRoot, 'repo');
    if (!repoBoundary.ok) {
      return {
        ok: false,
        reason: repoBoundary.reason,
        binding: null,
        binding_path: null,
      };
    }
    repoResolved = repoBoundary.path;
  }
  const projectResolved = projectBoundary.path;
  const candidates = typeof trust.adapterBindingPath === 'string' && trust.adapterBindingPath.trim()
    ? [path.resolve(trust.adapterBindingPath.trim())]
    : productionAdapterBindingCandidates();
  for (const candidate of candidates) {
    if (!candidate) continue;
    // Prefer lstat-based secure checks before following links for production.
    if (!skipOwnership) {
      const secure = assertSecureInstallationPath(candidate, 'adapter binding');
      if (!secure.ok) {
        return {
          ok: false,
          reason: secure.reason,
          binding: null,
          binding_path: null,
        };
      }
    }
    const resolved = resolveAuthorityPathReal(candidate);
    if (!resolved) continue;
    if (!skipOwnership && resolved !== path.resolve(candidate)) {
      // realpath differed from spelling without lstat catching it
      return {
        ok: false,
        reason: 'adapter binding path resolved through unexpected link; refuse',
        binding: null,
        binding_path: null,
      };
    }
    if (repoResolved && isPathInside(repoResolved, resolved)) continue;
    if (isPathInside(projectResolved, resolved)) continue;
    if (isPathInside(projectResolved, candidate)
      || (repoResolved && isPathInside(repoResolved, candidate))) {
      continue;
    }
    const data = readJsonIfExists(resolved);
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    if (data.kind !== 'trusted_installed_witness_adapter_binding'
      && data.kind !== 'p37_installed_witness_adapter_binding') {
      return {
        ok: false,
        reason: 'trusted witness adapter binding kind is unsupported',
        binding: null,
        binding_path: resolved,
      };
    }
    const adapterRaw = data.adapter_module;
    const pin = data.adapter_sha256;
    if (typeof adapterRaw !== 'string' || !adapterRaw.trim()) {
      return {
        ok: false,
        reason: 'trusted witness adapter binding is missing adapter_module',
        binding: null,
        binding_path: resolved,
      };
    }
    if (typeof pin !== 'string' || !/^[a-f0-9]{64}$/i.test(pin)) {
      return {
        ok: false,
        reason: 'trusted witness adapter binding is missing a valid adapter_sha256 pin',
        binding: null,
        binding_path: resolved,
      };
    }
    const adapterCandidate = path.resolve(adapterRaw.trim());
    const adapterReal = resolveAuthorityPathReal(adapterCandidate);
    if (!adapterReal) {
      return {
        ok: false,
        reason: 'trusted witness adapter module path is not resolvable',
        binding: null,
        binding_path: resolved,
      };
    }
    if (repoResolved && isPathInside(repoResolved, adapterReal)) {
      return {
        ok: false,
        reason: 'trusted witness adapter module must not resolve inside the repo trust boundary',
        binding: null,
        binding_path: resolved,
      };
    }
    if (isPathInside(projectResolved, adapterReal)) {
      return {
        ok: false,
        reason: 'trusted witness adapter module must not resolve inside the project evidence boundary',
        binding: null,
        binding_path: resolved,
      };
    }
    let actualPin;
    try {
      actualPin = fileSha256Hex(adapterReal);
    } catch (error) {
      return {
        ok: false,
        reason: `trusted witness adapter module cannot be hashed: ${error.message}`,
        binding: null,
        binding_path: resolved,
      };
    }
    if (actualPin.toLowerCase() !== pin.toLowerCase()) {
      return {
        ok: false,
        reason: 'trusted witness adapter module sha256 pin mismatch; refusing to require() unpinned adapter',
        binding: null,
        binding_path: resolved,
      };
    }
    if (Object.prototype.hasOwnProperty.call(data, 'anchored_append_timestamps')) {
      return {
        ok: false,
        reason: 'adapter binding must not supply anchored_append_timestamps; '
          + 'elapsed-day timestamps must come from adapter-owned authenticated append-time state only',
        binding: null,
        binding_path: resolved,
      };
    }
    // Also secure-check the adapter module path in production.
    if (!skipOwnership) {
      const adapterSecure = assertSecureInstallationPath(
        path.resolve(String(data.adapter_module || '').trim()),
        'adapter module',
      );
      if (!adapterSecure.ok) {
        return {
          ok: false,
          reason: adapterSecure.reason,
          binding: null,
          binding_path: resolved,
        };
      }
    }
    const bindingAuthorityId = data.authority_id;
    if (typeof bindingAuthorityId !== 'string'
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(bindingAuthorityId)) {
      return {
        ok: false,
        reason: 'trusted witness adapter binding is missing a non-empty bounded authority_id',
        binding: null,
        binding_path: resolved,
      };
    }
    return {
      ok: true,
      reason: null,
      binding: {
        authority_id: bindingAuthorityId,
        adapter_module: adapterReal,
        adapter_sha256: pin.toLowerCase(),
      },
      binding_path: resolved,
    };
  }
  return {
    ok: false,
    reason: 'deployment-provisioned trusted witness adapter binding is absent at fixed '
      + 'installation path; env/HOME/project cannot supply the binding; '
      + 'CLI HOLDs until /etc/autopilot/trusted-witness-adapter-binding.json is provisioned',
    binding: null,
    binding_path: null,
  };
}

function stripCallerAppendTimestamps(journal) {
  return journal.map((entry) => sanitizeReceiptForTimestampLookup(entry));
}

/**
 * Remove free-choice time fields from a receipt before adapter timestamp lookup.
 * Caller-controlled append_timestamp / observation fields must never be visible
 * to getAppendTimestamp after verify.
 */
function sanitizeReceiptForTimestampLookup(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return receipt;
  const clone = { ...receipt };
  delete clone.append_timestamp;
  delete clone.observation_timestamp;
  delete clone.observed_at;
  delete clone.appended_at;
  delete clone.witnessed_at;
  delete clone.issued_at;
  delete clone.timestamp;
  delete clone.time;
  return clone;
}

function loadTrustedInstalledWitnessAuthority(projectDir, repoRoot, options = {}) {
  const trust = options.trust && typeof options.trust === 'object' ? options.trust : {};
  const skipOwnership = trust.skipInstallationOwnershipChecks === true;
  const projectBoundary = canonicalizeBoundaryRoot(projectDir, 'project');
  if (!projectBoundary.ok) {
    return {
      ok: false,
      reason: projectBoundary.reason,
      authority: null,
      stream_id: null,
      config_path: null,
    };
  }
  let repoResolved = null;
  if (repoRoot) {
    const repoBoundary = canonicalizeBoundaryRoot(repoRoot, 'repo');
    if (!repoBoundary.ok) {
      return {
        ok: false,
        reason: repoBoundary.reason,
        authority: null,
        stream_id: null,
        config_path: null,
      };
    }
    repoResolved = repoBoundary.path;
  }
  const projectResolved = projectBoundary.path;
  const candidates = typeof trust.authorityPath === 'string' && trust.authorityPath.trim()
    ? [path.resolve(trust.authorityPath.trim())]
    : productionAuthorityCandidates();
  let config = null;
  let configPath = null;
  for (const candidate of candidates) {
    if (!candidate || candidate.includes(`${path.sep}${path.sep}`)) continue;
    if (!skipOwnership) {
      const secure = assertSecureInstallationPath(candidate, 'installed witness authority');
      if (!secure.ok) {
        return {
          ok: false,
          reason: secure.reason,
          authority: null,
          stream_id: null,
          config_path: null,
        };
      }
    }
    const resolvedCandidate = resolveAuthorityPathReal(candidate);
    if (!resolvedCandidate) continue;
    if (repoResolved && isPathInside(repoResolved, resolvedCandidate)) {
      continue;
    }
    if (isPathInside(projectResolved, resolvedCandidate)) {
      continue;
    }
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
      reason: 'installation-controlled installed witness authority is absent at fixed path '
        + `${PRODUCTION_AUTHORITY_PATH}; env/HOME/project cannot supply authority; `
        + 'project-local telemetry/journal files are untrusted and cannot supply their own trust root',
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
  if (config.external_adapter_module != null
    || config.external_witness_adapter_module != null
    || config.adapter_module != null
    || config.adapter_sha256 != null) {
    return {
      ok: false,
      reason: 'authority/project config must not select adapter_module or adapter_sha256; '
        + 'adapter identity and integrity pin come only from the deployment-provisioned '
        + 'trusted witness adapter binding',
      authority: null,
      stream_id: typeof config.stream_id === 'string' ? config.stream_id : null,
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

  const adapterBinding = loadTrustedWitnessAdapterBinding(projectDir, repoRoot, options);
  if (!adapterBinding.ok || !adapterBinding.binding) {
    return {
      ok: false,
      reason: adapterBinding.reason
        || 'deployment-provisioned trusted witness adapter binding is absent',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  const authorityId = config.authority_id;
  if (typeof authorityId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(authorityId)) {
    return {
      ok: false,
      reason: 'installed authority config is missing a non-empty bounded authority_id',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  if (typeof adapterBinding.binding.authority_id !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(adapterBinding.binding.authority_id)) {
    return {
      ok: false,
      reason: 'deployment adapter binding is missing a non-empty bounded authority_id',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }
  if (adapterBinding.binding.authority_id !== authorityId) {
    return {
      ok: false,
      reason: 'authority_id in authority config does not exactly match deployment adapter binding',
      authority: null,
      stream_id: streamId,
      config_path: configPath,
    };
  }

  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const adapterExports = require(adapterBinding.binding.adapter_module);
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
    const strippedJournal = stripCallerAppendTimestamps(journal);
    // Never pass binding-supplied timestamps. Adapter must own append-time state
    // (e.g. module-local authenticated store), not caller journal fields.
    const witness = factory({
      streamId,
      receipts: strippedJournal,
      receipt_journal: strippedJournal,
      authority_id: authorityId,
      adapter_sha256: adapterBinding.binding.adapter_sha256,
    });
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
    if (typeof authority.getAppendTimestamp !== 'function') {
      throw new Error(
        'release-evidence authority must expose getAppendTimestamp() over adapter-owned '
        + 'anchored state; journal-harvested timestamps are forbidden',
      );
    }
    return {
      ok: true,
      reason: null,
      authority,
      stream_id: streamId,
      config_path: configPath,
      adapter_binding_path: adapterBinding.binding_path,
      adapter_module: adapterBinding.binding.adapter_module,
      adapter_sha256: adapterBinding.binding.adapter_sha256,
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
  const retired = [...ALIAS_DEFINITION.levels];
  const scanContract = Object.freeze({
    id: 'p37-alias-caller-residual-scan-v2',
    method: 'git-ls-files-tracked-residual',
    tokens: retired.flatMap((level) => [`/${level}`, `autopilot:${level}`]),
    retired_alias_set: retired,
  });
  const scanContractDigest = sha256(canonicalJson(scanContract));

  let revision = null;
  const rev = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (rev.error || rev.status !== 0 || typeof rev.stdout !== 'string' || !rev.stdout.trim()) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan requires a readable git HEAD revision '
        + `(rev-parse failed: ${(rev.stderr || rev.error || 'unknown').toString().trim()})`,
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      revision: null,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  revision = rev.stdout.trim();

  // Untracked paths mean the scan manifest is not revision-complete → HOLD.
  const lsOthers = spawnSync(
    'git',
    ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard', '-z'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  if (lsOthers.error || lsOthers.status !== 0) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan failed git ls-files --others '
        + `(${(lsOthers.stderr || lsOthers.error || 'unknown').toString().trim()})`,
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      untracked: [],
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  const untrackedRaw = lsOthers.stdout || Buffer.alloc(0);
  const untracked = untrackedRaw.length === 0
    ? []
    : untrackedRaw.toString('utf8').split('\0').filter(Boolean).map((p) => p.replace(/\\/g, '/'));
  if (untracked.length > 0) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan found untracked paths; '
        + 'scan manifest is not revision-complete (HEAD-bound tracked inventory required): '
        + untracked.slice(0, 20).join(','),
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      untracked: untracked.slice(0, 200),
      untracked_count: untracked.length,
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }

  const lsTracked = spawnSync(
    'git',
    ['-C', repoRoot, 'ls-files', '-z'],
    { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
  );
  if (lsTracked.error || lsTracked.status !== 0) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan failed git ls-files '
        + `(${(lsTracked.stderr || lsTracked.error || 'unknown').toString().trim()})`,
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  const rawList = lsTracked.stdout || Buffer.alloc(0);
  const files = rawList.length === 0
    ? []
    : rawList.toString('utf8').split('\0').filter(Boolean);
  if (files.length === 0) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan found zero tracked files; incomplete manifest',
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }

  // Exact compatibility definition files/mirrors only (not whole definition trees).
  // Justification: these ARE the alias skill definitions; residual tokens inside
  // them are definitional, not active callers.
  function isExactAliasDefinition(relPath) {
    const n = relPath.replace(/\\/g, '/');
    for (const level of retired) {
      if (n === `skills/${level}/SKILL.md`
        || n === `platforms/codex/plugin/skills/${level}/SKILL.md`) {
        return true;
      }
    }
    return false;
  }

  // Historical / archive / scenario-test surfaces — mechanically enumerated.
  // Justification: archives and fixtures preserve historical /l3-/l6 mentions;
  // scenario tests intentionally exercise residual tokens; neither is an
  // active production caller that must migrate before alias retirement.
  function isHistoricalArchiveOrScenarioTest(relPath) {
    const n = relPath.replace(/\\/g, '/');
    if (n.includes('/_archive/') || n.startsWith('_archive/')) return true;
    if (n.includes('/hooks/tests/') || n.startsWith('hooks/tests/')) return true;
    if (n.includes('/fixtures/') || n.startsWith('fixtures/')) return true;
    if (n.includes('/evals/') || n.startsWith('evals/')) return true;
    if (/\.test\.(js|sh|ts|mjs|cjs)$/.test(n)) return true;
    if (/\/tests?\//.test(`/${n}`)) return true;
    return false;
  }

  // Generated / binary surfaces — mechanically enumerated.
  // Justification: binary assets cannot carry text callers; known generated
  // vendor trees are not operator-authored active surfaces.
  function isGeneratedOrBinary(relPath) {
    const n = relPath.replace(/\\/g, '/');
    if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz|tgz|xz|bin|o|so|dylib|wasm|mp4|webm|svg)$/i.test(n)) {
      return true;
    }
    if (n.includes('/node_modules/') || n.startsWith('node_modules/')) return true;
    if (n.includes('/.git/') || n.startsWith('.git/')) return true;
    return false;
  }

  // Inventory EVERY tracked text file in the canonical revision except the
  // mechanically enumerated exclusions above. Root manifests (plugin.json,
  // package.json, settings.example.json, …) are in scope — an allowlist of
  // path prefixes previously let active /l3-/l6 callers hide in unlisted roots.
  function isScannableCallerSurface(relPath) {
    const n = relPath.replace(/\\/g, '/');
    if (isExactAliasDefinition(n)) return false;
    if (isHistoricalArchiveOrScenarioTest(n)) return false;
    if (isGeneratedOrBinary(n)) return false;
    return true;
  }

  // Canonical invocation spellings: /l3-/l6 and autopilot:l3-autopilot:l6.
  const tokenRe = /(^|[^A-Za-z0-9_/])(\/l[3-6]|autopilot:l[3-6])(?=[^A-Za-z0-9_]|$)/g;

  function retiredLevelFromToken(token) {
    if (typeof token !== 'string') return null;
    if (/^\/l[3-6]$/.test(token)) return token.slice(1);
    if (/^autopilot:l[3-6]$/.test(token)) return token.slice('autopilot:'.length);
    return null;
  }

  // Index and tracked worktree must exact-match HEAD so reported revision and
  // scanned bytes are the same immutable tree. Staged/unstaged edits HOLD.
  const porcelain = spawnSync(
    'git',
    ['-C', repoRoot, 'status', '--porcelain', '-uno'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (porcelain.error || porcelain.status !== 0) {
    return {
      complete: false,
      reason: 'mechanical caller migration scan failed git status --porcelain '
        + `(${(porcelain.stderr || porcelain.error || 'unknown').toString().trim()})`,
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  const dirtyLines = (porcelain.stdout || '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  if (dirtyLines.length > 0) {
    const dirtyPaths = dirtyLines.map((line) => line.replace(/^\s*[MADRCU?! ]{1,2}\s+/, '').trim());
    return {
      complete: false,
      reason: 'mechanical caller migration scan requires index and tracked worktree to exact-match HEAD; '
        + `dirty paths: ${dirtyPaths.slice(0, 20).join(',')}`,
      callers_migrated: [],
      remaining: [...retired],
      residuals: [],
      dirty_paths: dirtyPaths.slice(0, 200),
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }

  const residuals = [];
  const remainingSet = new Set();
  for (const rel of files) {
    if (!isScannableCallerSurface(rel)) continue;
    // Read candidate bytes from HEAD only — never mutable worktree content.
    const show = spawnSync(
      'git',
      ['-C', repoRoot, 'show', `${revision}:${rel}`],
      { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
    );
    if (show.error || show.status !== 0) {
      return {
        complete: false,
        reason: `mechanical caller migration scan failed reading HEAD blob ${rel} `
          + `at ${revision}: ${(show.stderr || show.error || 'unknown').toString().trim()}`,
        callers_migrated: [],
        remaining: [...retired],
        residuals: [],
        revision,
        scan_contract: scanContract.id,
        scan_contract_digest: scanContractDigest,
        retired_alias_set: retired,
      };
    }
    const body = (show.stdout || Buffer.alloc(0)).toString('utf8');
    const lines = body.split(/\r?\n/);
    for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
      const line = lines[lineNo];
      tokenRe.lastIndex = 0;
      let match;
      while ((match = tokenRe.exec(line)) !== null) {
        const token = match[2];
        const level = retiredLevelFromToken(token);
        if (!level || !retired.includes(level)) continue;
        remainingSet.add(level);
        residuals.push({
          path: rel.replace(/\\/g, '/'),
          line: lineNo + 1,
          token,
          level,
        });
      }
    }
  }

  const remaining = retired.filter((level) => remainingSet.has(level));
  const callersMigrated = retired.filter((level) => !remainingSet.has(level));

  if (residuals.length > 0) {
    return {
      complete: false,
      reason: `deterministic tracked residual scan found active /l3-/l6 callers `
        + `(${residuals.length} hits across ${remaining.join(',') || 'unknown'})`,
      callers_migrated: callersMigrated,
      remaining,
      residuals: residuals.slice(0, 200),
      residual_count: residuals.length,
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  if (callersMigrated.length !== retired.length
    || retired.some((level) => !callersMigrated.includes(level))) {
    return {
      complete: false,
      reason: 'mechanical scan did not clear the exact retired alias set l3,l4,l5,l6',
      callers_migrated: callersMigrated,
      remaining: retired.filter((level) => !callersMigrated.includes(level)),
      residuals: [],
      revision,
      scan_contract: scanContract.id,
      scan_contract_digest: scanContractDigest,
      retired_alias_set: retired,
    };
  }
  return {
    complete: true,
    reason: null,
    callers_migrated: callersMigrated,
    remaining: [],
    residuals: [],
    residual_count: 0,
    revision,
    scan_contract: scanContract.id,
    scan_contract_digest: scanContractDigest,
    retired_alias_set: retired,
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
 * Derive executed load-bearing membership from authoritative execution
 * manifests / runtime graphs / inventory present in the repo.
 *
 * A fixed seed list, filename/name heuristic, or literal-relative-require scan
 * alone must NEVER report membership_complete=true. Every counted bucket needs
 * an authoritative source. Dynamic/unresolved dependencies, missing manifests,
 * or unresolvable references set membership_complete=false and HOLD.
 */
function discoverExecutedMembership(repoRoot) {
  const errors = [];
  const bucketSources = {};
  const skills = new Set();
  const scripts = new Set();
  const engineModules = new Set();
  const schemas = new Set();
  const hooks = new Set();

  // --- hooks: authoritative hooks.json + opt-in-manifest (same contract as inventory)
  const hooksJsonPath = path.join(repoRoot, 'hooks', 'hooks.json');
  const optInPath = path.join(repoRoot, 'hooks', 'opt-in-manifest.json');
  const hooksTreePresent = fs.existsSync(path.join(repoRoot, 'hooks'));
  if (fs.existsSync(hooksJsonPath) && fs.existsSync(optInPath)) {
    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      const manifest = JSON.parse(fs.readFileSync(optInPath, 'utf8'));
      const wired = new Set();
      const eventMap = hooksJson.hooks || {};
      for (const event of Object.keys(eventMap)) {
        for (const matcher of eventMap[event] || []) {
          for (const h of matcher.hooks || []) {
            const cmd = h.command || '';
            const m = cmd.match(/hooks\/([A-Za-z0-9_-]+)\.(js|sh)/);
            if (m) wired.add(m[1]);
          }
        }
      }
      const optInList = Array.isArray(manifest.opt_in) ? manifest.opt_in : [];
      const optIn = new Set(optInList);
      for (const stem of optInList) {
        if (!wired.has(stem)) {
          errors.push(`opt-in hook "${stem}" not wired in hooks.json; membership unresolved`);
        }
      }
      for (const stem of wired) {
        if (!optIn.has(stem)) hooks.add(stem);
      }
      const inventoryScript = path.join(repoRoot, 'scripts', 'check-hook-inventory.js');
      if (fs.existsSync(inventoryScript)) {
        const inventory = spawnSync(
          process.execPath,
          [inventoryScript],
          { encoding: 'utf8', cwd: repoRoot },
        );
        if (inventory.error) {
          errors.push(`hooks inventory execution failed: ${inventory.error.message}`);
        } else if (inventory.status !== 0) {
          errors.push(
            `hooks inventory exited ${inventory.status}; complete membership cannot be established`,
          );
        }
      }
      bucketSources.hooks = 'hooks.json+opt-in-manifest.json(+inventory)';
    } catch (error) {
      errors.push(`hooks authoritative membership failed: ${error.message}`);
    }
  } else if (!hooksTreePresent) {
    bucketSources.hooks = 'absent-hooks-tree';
  } else {
    errors.push(
      'hooks bucket has no authoritative membership source '
      + '(require hooks.json + opt-in-manifest.json)',
    );
  }

  // --- engine: runtime require.cache graph from installed roots (not text seed)
  const engineRootDir = path.join(repoRoot, 'src', 'engine');
  let includesInstalledEngine = false;
  if (fs.existsSync(engineRootDir)) {
    const engineRoots = [
      path.join(engineRootDir, 'supervised-owner-kernel-installed-engine.js'),
      path.join(engineRootDir, 'owner-kernel', 'index.js'),
    ];
    const loadedAbs = new Set();
    let dynamicUnresolved = false;
    for (const rootAbs of engineRoots) {
      if (!fs.existsSync(rootAbs)) continue;
      try {
        const resolved = require.resolve(rootAbs);
        delete require.cache[resolved];
        for (const key of Object.keys(require.cache)) {
          if (key.startsWith(engineRootDir + path.sep) || key === engineRootDir) {
            delete require.cache[key];
          }
        }
        require(rootAbs);
        for (const key of Object.keys(require.cache)) {
          if (key.startsWith(engineRootDir + path.sep) || key === rootAbs) {
            loadedAbs.add(key);
            continue;
          }
          const runnersDir = path.join(repoRoot, 'src', 'runners');
          if (key.startsWith(runnersDir + path.sep)) {
            loadedAbs.add(key);
          }
        }
      } catch (error) {
        errors.push(`engine runtime graph load failed for ${path.basename(rootAbs)}: ${error.message}`);
      }
    }
    for (const abs of loadedAbs) {
      if (abs.startsWith(engineRootDir + path.sep)) {
        engineModules.add(path.relative(engineRootDir, abs).replace(/\\/g, '/'));
      } else {
        const runnersDir = path.join(repoRoot, 'src', 'runners');
        if (abs.startsWith(runnersDir + path.sep)) {
          engineModules.add(
            path.join('..', 'runners', path.relative(runnersDir, abs)).replace(/\\/g, '/'),
          );
        }
      }
      try {
        const body = fs.readFileSync(abs, 'utf8');
        if (/require\s*\(\s*[^'"`\s]/.test(body)
          || /require\s*\(\s*[`'"][^'"`]*\$\{/.test(body)
          || /require\s*\(\s*[^)]+\+/.test(body)) {
          dynamicUnresolved = true;
          errors.push(
            `engine module ${path.basename(abs)} has dynamic/unresolved require form; `
            + 'membership_complete cannot be true',
          );
        }
      } catch (_error) {
        dynamicUnresolved = true;
        errors.push(`engine module source unreadable for dynamic-require scan: ${abs}`);
      }
    }
    if (engineModules.size === 0) {
      errors.push('engine bucket runtime graph produced zero members');
    } else {
      // require.cache is eager-only observation; it cannot prove complete
      // conditional/lazy dependencies. Always incomplete for membership_complete.
      bucketSources.engine_modules = 'runtime-require-cache-eager-only(incomplete)';
      errors.push(
        'engine membership from require.cache is eager-only and cannot prove complete '
        + 'conditional/lazy dependencies; membership_complete cannot be true',
      );
      if (dynamicUnresolved) {
        // already recorded per-module dynamic errors
      }
    }
    const installedEnginePath = path.join(
      engineRootDir,
      'supervised-owner-kernel-installed-engine.js',
    );
    if (fs.existsSync(installedEnginePath)) {
      try {
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
  } else {
    bucketSources.engine_modules = 'absent-engine-tree';
  }

  // --- skills: only authoritative *execution* membership. Presence of
  // skills/*/SKILL.md is not executed cardinality. Without a complete
  // execution manifest, do not count skills and mark incomplete.
  const skillsDir = path.join(repoRoot, 'skills');
  if (fs.existsSync(skillsDir)) {
    errors.push(
      'skills bucket lacks a complete authoritative execution membership manifest; '
      + 'skills/*/SKILL.md inventory is not executed cardinality',
    );
    // Deliberately leave skills empty so unused skill files never inflate count.
    bucketSources.skills = 'incomplete-no-execution-manifest';
  } else {
    bucketSources.skills = 'absent-skills-tree';
  }

  // --- schemas: only authoritative execution membership (not every *.json).
  const schemasDir = path.join(repoRoot, 'schemas');
  if (fs.existsSync(schemasDir)) {
    errors.push(
      'schemas bucket lacks a complete authoritative execution membership manifest; '
      + 'schemas/*.json inventory is not executed cardinality',
    );
    bucketSources.schemas = 'incomplete-no-execution-manifest';
  } else {
    bucketSources.schemas = 'absent-schemas-tree';
  }

  // --- scripts: hooks.json script refs + known execution entrypoints
  const scriptsDir = path.join(repoRoot, 'scripts');
  if (fs.existsSync(scriptsDir) && fs.existsSync(hooksJsonPath)) {
    try {
      const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
      const blob = JSON.stringify(hooksJson);
      const re = /scripts\/([A-Za-z0-9._\/-]+\.(?:js|sh))/g;
      let m;
      while ((m = re.exec(blob)) !== null) {
        if (fs.existsSync(path.join(scriptsDir, m[1]))) scripts.add(m[1]);
      }
      for (const entry of [
        'owner-kernel.js',
        'check-owner-kernel-release-gates.js',
        'check-hook-inventory.js',
      ]) {
        if (fs.existsSync(path.join(scriptsDir, entry))) scripts.add(entry);
      }
      if (scripts.size === 0) {
        errors.push('scripts bucket has no resolvable authoritative members from hooks/entrypoints');
      } else {
        bucketSources.scripts = 'hooks.json-script-refs+entrypoint-inventory';
      }
    } catch (error) {
      errors.push(`scripts authoritative membership failed: ${error.message}`);
    }
  } else if (!fs.existsSync(scriptsDir)) {
    bucketSources.scripts = 'absent-scripts-tree';
  } else {
    errors.push(
      'scripts bucket has no authoritative membership source '
      + '(require hooks.json script references or known entrypoints with hooks tree)',
    );
  }

  const requiredBucketKeys = ['hooks', 'engine_modules', 'skills', 'schemas', 'scripts'];
  for (const key of requiredBucketKeys) {
    if (!bucketSources[key]) {
      errors.push(`bucket ${key} has no authoritative membership source`);
    }
  }
  const complete = errors.length === 0
    && requiredBucketKeys.every((key) => Boolean(bucketSources[key]))
    && !Object.values(bucketSources).some((value) => /incomplete/i.test(String(value)));

  return {
    complete,
    errors,
    skills: [...skills],
    scripts: [...scripts],
    engine_modules: [...engineModules],
    schemas: [...schemas],
    hooks_default_on: [...hooks],
    includes_installed_engine: includesInstalledEngine,
    bucket_sources: bucketSources,
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
  // Discovery incompleteness is reported via membership_complete / evaluateKr10.
  // Do not null measured totals for incompleteness alone — still count observed
  // executed members, but never claim complete membership.
  const discoveryIncompleteness = [];
  if (!discovered.complete) {
    for (const error of discovered.errors) {
      discoveryIncompleteness.push(
        `KR10 complete membership cannot be established: ${error}`,
      );
    }
    if (discovered.errors.length === 0) {
      discoveryIncompleteness.push(
        'KR10 complete membership cannot be established; HOLD without substitution',
      );
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
    discovery_incompleteness: discoveryIncompleteness,
    bucket_sources: discovered.bucket_sources || {},

    method: 'authoritative execution membership only; skills/schemas tree inventory and require.cache eager graph cannot set membership_complete; incomplete/dynamic/lazy HOLD; thresholds frozen at 42 and 51; no KR redefinition',
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
  }
  if (Array.isArray(surface.discovery_incompleteness)) {
    for (const error of surface.discovery_incompleteness) {
      blocking.push(error);
    }
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
    // Frozen definition remains in force even when membership is incomplete.
    blocking.push(
      `measured surface count is not strictly below baseline ${KR10_DEFINITION.baseline_surface_count}`,
    );
    blocking.push(
      'KR10 remains the executed-module cardinality gate; definition is not revised after measurement',
    );
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
    } else if (surface.membership_complete !== true) {
      // Incomplete membership: still restate frozen definition even when partial
      // measured total is below thresholds (must not redefine/waive KR10).
      blocking.push(
        'KR10 remains the executed-module cardinality gate; definition is not revised after measurement',
      );
      // Keep baseline wording present for incomplete HOLD reports.
      blocking.push(
        `measured surface count ${measured} is not strictly below baseline ${KR10_DEFINITION.baseline_surface_count} `
        + 'without complete membership (incomplete membership cannot fund a KR10 PASS)',
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

    // Caller migration AND semantics: the deterministic mechanical residual
    // caller scan of the current revision is MANDATORY. Authority-authenticated
    // migration bodies may corroborate but never replace residual l3-l6 clearance.
    // Self-hashed flags alone are never proof.
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
    // Mechanical scan is MANDATORY for retirement — authority evidence may
    // supplement but never replace residual-caller clearance of l3-l6.
    if (migrationScan.complete !== true) {
      blocking.push(
        'deterministic mechanical caller migration scan is mandatory and incomplete '
        + '(authority-authenticated migration bodies cannot bypass residual l3-l6 callers)'
        + (migrationScan.reason ? `; scan: ${migrationScan.reason}` : ''),
      );
      deterministicCallerMigration = false;
    } else if (Array.isArray(migrationScan.remaining) && migrationScan.remaining.length > 0) {
      blocking.push(
        `mechanical caller migration scan found residual aliases: ${migrationScan.remaining.join(',')}`,
      );
      deterministicCallerMigration = false;
    } else {
      // Scan cleared all aliases; optional authority evidence may corroborate.
      deterministicCallerMigration = true;
      if (migrationBody && migrationAuthorityAuthenticated) {
        const migrated = migrationBody.callers_migrated;
        if (!Array.isArray(migrated)
          || ALIAS_DEFINITION.levels.some((level) => !migrated.includes(level))
          || migrated.length < ALIAS_DEFINITION.levels.length) {
          blocking.push(
            'authority-authenticated migration body must list exact retired alias set l3,l4,l5,l6; '
            + 'incomplete alias sets are rejected (mechanical scan still required)',
          );
        }
      }
    }
    void migrationAuthorityAuthenticated;
    const selfHashedOnly = migrationBody && typeof migrationBody === 'object'
      && isNonEmptySha256(migrationHash)
      && sha256(canonicalJson(migrationBody)).toLowerCase() === migrationHash.toLowerCase()
      && productionTelemetry.deterministic_caller_migration === true
      && migrationScan.complete !== true;
    if (selfHashedOnly) {
      blocking.push(
        'self-hashed deterministic_caller_migration:true is not proof; '
        + 'mechanical scan of current revision for residual l3-l6 callers is mandatory',
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
      // Cycle append timestamp from adapter-owned anchored state (sanitized receipt).
      let cycleAppendTs = null;
      if (typeof trustedAuthority.authority.getAppendTimestamp === 'function') {
        cycleAppendTs = trustedAuthority.authority.getAppendTimestamp(
          sanitizeReceiptForTimestampLookup(verifiedCycleReceipt),
        );
      }
      if (typeof cycleAppendTs !== 'string'
        || !/Z$/.test(cycleAppendTs)
        || Number.isNaN(new Date(cycleAppendTs).getTime())) {
        blocking.push(
          'compatibility-cycle receipt lacks adapter-owned anchored append timestamp; '
          + 'cycle timestamp must precede the first required witnessed day',
        );
      } else {
        const cycleDayKey = new Date(cycleAppendTs).toISOString().slice(0, 10);
        const firstRequiredDay = requiredDays[0];
        // Cycle must strictly precede the first required UTC day window.
        if (cycleDayKey >= firstRequiredDay) {
          blocking.push(
            `compatibility-cycle append timestamp day ${cycleDayKey} does not precede first required day ${firstRequiredDay}; `
            + 'cycle-after-window and same-day cycle starts are rejected',
          );
        }
      }
      // Index day records by UTC day for requiredDays-order validation.
      const recordsByDay = new Map();
      for (const day of dayRecords) {
        if (!day || typeof day !== 'object') continue;
        if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) continue;
        if (!recordsByDay.has(day.day)) recordsByDay.set(day.day, day);
      }
      // Day one must continue the shipped-cycle receipt head (bind first day to
      // the trusted-authority-verified compatibility-cycle receipt).
      let previousWitnessHead = verifiedCycleReceipt.witness_head.toLowerCase();
      let previousAppendMs = cycleAppendTs && !Number.isNaN(new Date(cycleAppendTs).getTime())
        ? new Date(cycleAppendTs).getTime()
        : null;
      // Walk requiredDays in host-clock order — not caller record order.
      for (const requiredDay of requiredDays) {
        const day = recordsByDay.get(requiredDay);
        if (!day) continue;
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
        if (typeof trustedAuthority.authority.getAppendTimestamp !== 'function') {
          continue;
        }
        const timestampReceipt = sanitizeReceiptForTimestampLookup(dayReceipt);
        const appendTs = trustedAuthority.authority.getAppendTimestamp(timestampReceipt);
        if (typeof appendTs !== 'string'
          || !/Z$/.test(appendTs)
          || Number.isNaN(new Date(appendTs).getTime())) {
          continue;
        }
        const appendMs = new Date(appendTs).getTime();
        const appendDayKey = new Date(appendTs).toISOString().slice(0, 10);
        // Timestamp must fall on the exact claimed required UTC day.
        if (appendDayKey !== requiredDay) continue;
        // Strictly increasing authenticated append timestamps in requiredDays order.
        if (previousAppendMs != null && !(appendMs > previousAppendMs)) {
          continue;
        }
        const dayBodyHash = sha256(canonicalJson({
          day: requiredDay,
          translation_used_events: 0,
          unresolved_translation_deltas: 0,
          prior_witness_head: previousWitnessHead,
        }));
        const eventHash = dayReceipt.event_hash.toLowerCase();
        if (eventHash !== dayBodyHash.toLowerCase()) {
          continue;
        }
        validDays.push({
          day: requiredDay,
          append_timestamp: appendTs,
          append_ms: appendMs,
          witness_head: dayReceipt.witness_head.toLowerCase(),
          event_hash: eventHash,
        });
        previousWitnessHead = dayReceipt.witness_head.toLowerCase();
        previousAppendMs = appendMs;
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
          + '(backdated labels, fourteen-created-today chains, cycle-after-window, nonmonotonic/out-of-order day timestamps, journal-harvested timestamps, pass-through getAppendTimestamp, body-chosen observation timestamps, '
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

function evaluateReleaseGatesCore(input = {}, { fixtureMode = false, trust = null } = {}) {
  const repoRootArg = input.repoRoot || input.repo_root || path.resolve(__dirname, '..');
  const projectArg = input.project || input.projectDir || input.project_dir;
  if (!projectArg) {
    throw new Error('evaluateReleaseGates requires project');
  }
  const repoBoundary = canonicalizeBoundaryRoot(repoRootArg, 'repo');
  if (!repoBoundary.ok) {
    throw new Error(repoBoundary.reason);
  }
  const repoRoot = repoBoundary.path;
  const projectDirRaw = resolveProjectDir(repoRoot, projectArg);
  const projectBoundary = canonicalizeBoundaryRoot(projectDirRaw, 'project');
  if (!projectBoundary.ok) {
    throw new Error(projectBoundary.reason);
  }
  const projectDir = projectBoundary.path;
  const trustOptions = fixtureMode && trust && typeof trust === 'object'
    ? { trust }
    : { trust: null };
  const trustedAuthority = loadTrustedInstalledWitnessAuthority(
    projectDir,
    repoRoot,
    trustOptions,
  );
  const surface = countExecutedLoadBearingSurfaces(repoRoot);
  const kr8 = evaluateKr8(loadKr8Evidence(projectDir, trustedAuthority));
  const kr10 = evaluateKr10(surface);
  const alias = evaluateAliasRetirement(repoRoot, projectDir, trustedAuthority);

  const blocking = [
    ...kr8.blocking_reasons.map((reason) => `KR8: ${reason}`),
    ...kr10.blocking_reasons.map((reason) => `KR10: ${reason}`),
    ...alias.blocking_reasons.map((reason) => `alias_retirement: ${reason}`),
  ];
  let disposition = blocking.length === 0 ? 'PASS' : 'HOLD';
  const notes = [
    'KR definitions are frozen by the parent plan and are not redefined by this checker',
    'KR8 always uses frozen baseline 6; conflicting production telemetry is a blocker',
    'KR8 requires authenticated production provenance; a filename or parseable JSON is not production provenance',
    'KR10 derives executed membership only from authoritative manifests/runtime graphs/inventory; fixed seed/heuristics/literal-require-scan never set membership_complete; incomplete/dynamic HOLD; thresholds stay frozen at 42 and 51',
    'production trust roots are fixed /etc/autopilot paths only (not env/HOME/project); adapter binding must not supply timestamps; allowTestWitness forbidden for release evidence',
    'day evidence requires adapter-owned anchored append timestamps via getAppendTimestamp after verify; journal harvest and pass-through timestamps cannot forge elapsed days',
    'project-local telemetry/journal files, hashes, timestamps, signer IDs, and migration flags are untrusted inputs',
    'self-hashed deterministic_caller_migration is not proof; mechanical scan of residual l3-l6 callers on current revision is MANDATORY (authority evidence supplements but never replaces)',
    'fixture telemetry is never promoted to production telemetry',
    'this checker never deletes compatibility aliases',
    'present compatibility aliases are nonblocking; only unmet retirement prerequisites HOLD',
    'P4 role qualification is out of scope',
  ];
  if (fixtureMode) {
    // Test-only seam: never a production-shaped PASS, even when components are positive.
    const fixtureBlocker = 'test-only fixture evaluator; not production authorization '
      + '(evaluateReleaseGatesFixture cannot authorize release PASS)';
    blocking.push(fixtureBlocker);
    disposition = 'HOLD';
    notes.push(fixtureBlocker);
  }
  const material = {
    schema_version: 1,
    kind: fixtureMode
      ? 'owner_kernel_release_gate_fixture_report'
      : 'owner_kernel_release_gate_report',
    project: path.relative(repoRoot, projectDir) || projectDir,
    disposition,
    fixture_mode: fixtureMode === true,
    kr8,
    kr10,
    alias_retirement: alias,
    blocking_reasons: blocking,
    notes,
  };
  material.report_hash = sha256(canonicalJson(material));
  return material;
}

/**
 * Production evaluator: fixed /etc trust roots + real ownership checks only.
 * Never accepts trust injection paths or skipInstallationOwnershipChecks.
 */
function evaluateReleaseGates(input = {}) {
  if (input && (input.trust != null || input.trustedAuthority != null
    || input.authorityPath != null || input.adapterBindingPath != null
    || input.skipInstallationOwnershipChecks != null)) {
    throw new Error(
      'evaluateReleaseGates rejects trust injection; production uses fixed /etc trust roots only. '
      + 'Hermetic tests must call evaluateReleaseGatesFixture (test-only, forces HOLD)',
    );
  }
  return evaluateReleaseGatesCore(input, { fixtureMode: false, trust: null });
}

/**
 * Explicit test-only seam. May inject trust paths and skip ownership checks for
 * component oracles, but ALWAYS labels fixture/test-only and forces overall HOLD.
 * Cannot return an ordinary production-shaped PASS.
 */
function evaluateReleaseGatesFixture(input = {}) {
  const trust = input && input.trust && typeof input.trust === 'object'
    ? input.trust
    : null;
  return evaluateReleaseGatesCore(input, { fixtureMode: true, trust });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  // Production CLI: fixed installation trust roots only — never env/HOME/argv trust paths.
  let material;
  try {
    material = evaluateReleaseGates({
      project: options.project,
      repoRoot: options.repoRoot,
    });
  } catch (error) {
    fail(error.message || String(error), 2);
  }
  process.stdout.write(`${JSON.stringify(material, null, 2)}\n`);
  if (options.check && material.disposition === 'HOLD') {
    process.exitCode = 1;
  }
}

module.exports = {
  PRODUCTION_AUTHORITY_PATH,
  PRODUCTION_ADAPTER_BINDING_PATH,
  evaluateReleaseGates,
  // Only injectable seam: always forces fixture/test-only overall HOLD.
  evaluateReleaseGatesFixture,
  executeDeterministicCallerMigrationScan,
  evaluateKr8,
  evaluateKr10,
  assertSecureInstallationPath,
  // evaluateAliasRetirement and production trust loaders are intentionally not
  // exported — they accept or load authority material and must not be a public
  // composition surface for caller-crafted trustedAuthority bypass.
};

if (require.main === module) {
  main();
}
