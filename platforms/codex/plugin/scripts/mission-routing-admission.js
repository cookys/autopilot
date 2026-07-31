#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { canonicalJson, sha256 } = require('../src/engine/owner-kernel/canonical');
const mission = require('../src/engine/mission-convergence');
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
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const REGISTRY_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'repo_identity',
  'missions',
]);
const REGISTRY_ENTRY_KEYS = new Set([
  'schema_version',
  'adoption_key',
  'repo_identity',
  'mission_lineage_id',
  'task_authority_id',
  'policy_hash',
  'intent_hash',
  'initial_required_acceptance_hashes',
  'mission_policy_digest',
  'mission_graph_digest',
  'enforcement_mode',
  'prepared_state_hash',
  'state_ref',
]);
const CAMPAIGN_TERMINAL_KEYS = new Set([
  'schema_version',
  'artifact_type',
  'claim_id',
  'mission_lineage_id',
  'campaign_id',
  'mission_campaign_id',
  'icc_campaign_id',
  'campaign_contract_digest',
  'raw_campaign_contract_digest',
  'graph_node_id',
  'graph_attempt',
  'outcome',
  'possibly_effectful',
  'actual_usage',
  'satisfied_acceptance_hashes',
  'observed_at',
  'receipt_digest',
]);

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

// Canonical version-sync closure owned by scripts/sync-version.js — exact
// complete set; not a caller-chosen subset and not derived from campaign paths.
const CANONICAL_VERSION_MIRROR_CLOSURE = Object.freeze([
  '.claude-plugin/plugin.json',
  'plugin.json',
  '.claude-plugin/marketplace.json',
  'README.md',
  'platforms/codex/plugin/.codex-plugin/plugin.json',
  'platforms/codex/.agents/plugins/marketplace.json',
  'README.zh-TW.md',
]);
const CANONICAL_VERSION_MIRROR_GENERATOR = 'scripts/sync-version.js';

function collectVersionMirrorPaths(paths) {
  // Advisory helper for fixtures; real admission uses campaign.version_mirror_paths.
  return (paths || []).filter((p) => CANONICAL_VERSION_MIRROR_CLOSURE.includes(p)
    || p.endsWith('/plugin.json')
    || p.endsWith('marketplace.json'));
}

function verifyVersionMirrorClosure(declaredMirrors, generator) {
  if (!Array.isArray(declaredMirrors) || declaredMirrors.length === 0) {
    return { ok: true };
  }
  if (typeof generator !== 'string' || generator.trim() === '') {
    return {
      ok: false,
      reason: 'version_mirror_paths require a named version_mirror_generator',
    };
  }
  if (generator !== CANONICAL_VERSION_MIRROR_GENERATOR) {
    return {
      ok: false,
      reason: `version_mirror_generator must be ${CANONICAL_VERSION_MIRROR_GENERATOR} (got ${generator})`,
    };
  }
  // For this repo's sync-version.js generator, require the exact complete
  // mirror closure — not a caller-chosen subset.
  const declared = [...new Set(declaredMirrors.map(String))].sort();
  const required = [...CANONICAL_VERSION_MIRROR_CLOSURE].sort();
  if (JSON.stringify(declared) !== JSON.stringify(required)) {
    const missing = required.filter((p) => !declared.includes(p));
    const extra = declared.filter((p) => !required.includes(p));
    return {
      ok: false,
      reason: `version_mirror_paths must equal the complete sync-version closure`
        + (missing.length ? `; missing: ${missing.join(',')}` : '')
        + (extra.length ? `; extra: ${extra.join(',')}` : ''),
    };
  }
  return { ok: true };
}

function readRelevantBytes(repoRoot, paths) {
  // Canonical sha256 of raw file bytes (not UTF-8 text, not base64 guessing).
  const out = {};
  for (const p of paths) {
    const abs = path.join(repoRoot, p);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        out[p] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    } catch (_e) {
      // leave missing
    }
  }
  return out;
}

function hasExactKeys(value, keys) {
  return isObj(value)
    && Object.keys(value).length === keys.size
    && Object.keys(value).every((key) => keys.has(key));
}

function validateCampaignTerminalReceipt(receipt, state) {
  if (!hasExactKeys(receipt, CAMPAIGN_TERMINAL_KEYS)
      || receipt.schema_version !== 1
      || receipt.artifact_type !== 'campaign_terminal_receipt'
      || !SHA256.test(receipt.receipt_digest || '')
      || receipt.receipt_digest !== sha256(canonicalJson(Object.fromEntries(
        Object.entries(receipt).filter(([key]) => key !== 'receipt_digest'),
      )))
      || !isObj(state)
      || !isObj(state.claims)
      || !isObj(state.claims[receipt.claim_id])) {
    return { ok: false, reason: 'terminal Mission receipt shape/digest/claim is invalid' };
  }
  const claim = state.claims[receipt.claim_id];
  const progress = isObj(state.graph_progress)
    ? state.graph_progress[receipt.graph_node_id]
    : null;
  if (receipt.mission_lineage_id !== state.mission_lineage_id
      || receipt.campaign_id !== claim.campaign_id
      || receipt.mission_campaign_id !== claim.campaign_id
      || receipt.campaign_contract_digest !== claim.campaign_contract_digest
      || receipt.graph_node_id !== claim.graph_node_id
      || receipt.graph_attempt !== claim.graph_attempt
      || receipt.possibly_effectful !== true
      || !new Set(['ready', 'follow_up', 'blocked', 'abort', 'unknown']).has(receipt.outcome)
      || !SHA256.test(receipt.raw_campaign_contract_digest || '')
      || !isStr(receipt.icc_campaign_id)
      || claim.terminal !== true
      || claim.reconciled !== true
      || !isObj(progress)
      || progress.status !== receipt.outcome
      || progress.last_receipt_digest !== receipt.receipt_digest) {
    return { ok: false, reason: 'terminal Mission receipt does not match applied claim/state' };
  }
  return { ok: true, claim };
}

function exactEvidenceBinding(record, binding) {
  const required = {
    repo_identity: binding.repoIdentity,
    mission_lineage_id: binding.state.mission_lineage_id,
    mission_policy_digest: binding.state.mission_policy_digest,
    mission_graph_digest: binding.state.mission_graph_digest,
    graph_node_id: binding.terminal.graph_node_id,
    graph_attempt: binding.terminal.graph_attempt,
    mission_claim_id: binding.terminal.claim_id,
    mission_campaign_id: binding.terminal.mission_campaign_id,
    icc_campaign_id: binding.terminal.icc_campaign_id,
    campaign_contract_digest: binding.terminal.campaign_contract_digest,
    strict_contract_digest: binding.terminal.raw_campaign_contract_digest,
  };
  return Object.entries(required).every(([key, value]) => (
    value != null && record[key] === value
  ));
}

function loadControllerEvidenceFromRoot(
  commonDir,
  rootRunId,
  graphNode,
  enforce,
  binding = null,
  gitCwd = null,
) {
  const { classifyWorkOrder, listWorkOrders } = require('../src/engine/work-order');
  const entries = listWorkOrders(commonDir, rootRunId);
  const integrityErrors = entries.filter((e) => e.error || e.reason_code);
  if (integrityErrors.length > 0 && enforce) {
    fail(
      integrityErrors[0].reason || 'controller Work Order integrity failure',
      'MISSION_EVIDENCE_CORRUPT',
    );
  }
  const matches = entries.filter((e) => {
    if (!e.work_order || e.error) return false;
    if (e.work_order.role !== 'controller') return false;
    if (graphNode && e.work_order.graph_node !== graphNode) return false;
    return isObj(e.work_order.controller);
  });
  if (matches.length > 1) {
    fail(
      'ambiguous controller Work Orders for Mission evidence root',
      'MISSION_EVIDENCE_AMBIGUOUS',
    );
  }
  if (matches.length === 0) return { historicalOutputs: null, noOpReceipt: null, workOrder: null };
  if (!binding) {
    if (enforce) {
      fail('controller evidence is missing Mission terminal binding', 'MISSION_EVIDENCE_MISSING');
    }
    return { historicalOutputs: null, noOpReceipt: null, workOrder: null };
  }
  const match = matches[0];
  const wo = matches[0].work_order;
  const classified = classifyWorkOrder(wo, {
    gitCwd,
    workOrderPath: match.path,
    requireBoundEvidence: true,
  });
  if (classified.classification !== 'consume_terminal'
      || classified.success !== true
      || wo.disposition !== 'consumed'
      || wo.terminal_status !== 'success'
      || wo.root_run_id !== binding.terminal.icc_campaign_id
      || wo.graph_node !== binding.terminal.graph_node_id
      || !GIT_OBJECT_ID.test(wo.accepted_commit || '')) {
    if (enforce) {
      fail(
        `controller Work Order is not an exact consumed success: ${
          classified.reason || classified.classification
        }`,
        'MISSION_EVIDENCE_CORRUPT',
      );
    }
    return { historicalOutputs: null, noOpReceipt: null, workOrder: wo };
  }
  let historicalOutputs = null;
  let noOpReceipt = null;
  if (isObj(wo.controller.historical_outputs)
      && isStr(wo.controller.historical_outputs_digest)
      && wo.controller.historical_outputs_digest
        === sha256(canonicalJson(wo.controller.historical_outputs))) {
    // Full historical record: expose path_byte_digests map to delta admission.
    // Legacy map form (path → digest) remains accepted when present.
    const hist = wo.controller.historical_outputs;
    if (hist.artifact_type === 'historical_outputs'
        && hist.accepted_commit === wo.accepted_commit
        && hist.base_sha === binding.claim.base_sha
        && isObj(hist.path_byte_digests)
        && exactEvidenceBinding(hist, binding)) {
      historicalOutputs = hist.path_byte_digests;
    }
  }
  if (isObj(wo.controller.noop_receipt) && isStr(wo.controller.noop_receipt.digest)) {
    const body = { ...wo.controller.noop_receipt };
    delete body.digest;
    if (wo.controller.noop_receipt.digest === sha256(canonicalJson(body))
        && body.artifact_type === 'noop_receipt'
        && exactEvidenceBinding(body, binding)
        && body.accepted_commit === wo.accepted_commit
        && body.base_sha === wo.accepted_commit
        && body.dispatcher_called === false
        && body.mutation_attempts === 0
        && body.gate_attempts === 0
        && isObj(historicalOutputs)
        && canonicalJson(body.path_byte_digests) === canonicalJson(historicalOutputs)
        && body.acceptance_digest
          === wo.controller.historical_outputs.acceptance_digest
        && body.verification_digest
          === wo.controller.historical_outputs.verification_digest) {
      noOpReceipt = wo.controller.noop_receipt;
    }
  }
  if ((!historicalOutputs || !noOpReceipt) && enforce) {
    fail(
      'controller historical/no-op evidence is incomplete or foreign to Mission terminal authority',
      'MISSION_EVIDENCE_CORRUPT',
    );
  }
  return { historicalOutputs, noOpReceipt, workOrder: wo };
}

/**
 * Ordinary production evidence loader:
 *   repo identity → Git common-dir Mission registry/state/journal
 *   → terminal receipt.icc_campaign_id → exactly one controller WO under that root/node.
 * No ambient env, no global Work Order scan, no caller object as authority
 * (unless allowTestCallerEvidence).
 */
function loadDurableMissionEvidence(repoRoot, options = {}) {
  let historicalOutputs = null;
  let noOpReceipt = null;
  let workOrder = null;
  const allowTest = options.allowTestCallerEvidence === true;
  const enforce = options.enforceEvidence === true;

  if (allowTest) {
    if (isObj(options.historicalOutputs)
        && isStr(options.historicalOutputsDigest)
        && options.historicalOutputsDigest === sha256(canonicalJson(options.historicalOutputs))) {
      historicalOutputs = options.historicalOutputs;
    }
    if (isObj(options.noOpReceipt) && isStr(options.noOpReceipt.digest)) {
      const body = { ...options.noOpReceipt };
      delete body.digest;
      if (options.noOpReceipt.digest === sha256(canonicalJson(body))) {
        noOpReceipt = options.noOpReceipt;
      }
    }
  }

  try {
    const { resolveGitCommonDir } = require('../src/engine/work-order');
    const commonDir = resolveGitCommonDir(repoRoot);
    if (!commonDir) {
      if (enforce) {
        fail('git common dir unavailable for Mission evidence', 'MISSION_EVIDENCE_CORRUPT');
      }
      // Non-enforce without common dir: no durable history proven.
      return finalizeMissionEvidence(
        historicalOutputs,
        noOpReceipt,
        workOrder,
        allowTest,
        options,
      );
    }

    // 1) Canonical Mission registry under git-common-dir.
    const missionRoot = path.join(commonDir, 'autopilot', 'mission');
    const registryPath = path.join(missionRoot, 'registry.json');
    let registry = null;
    let registryPresent = false;
    if (fs.existsSync(registryPath)) {
      registryPresent = true;
      try {
        registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      } catch (error) {
        if (enforce) {
          fail(
            `Mission registry unreadable: ${error.message || String(error)}`,
            'MISSION_EVIDENCE_CORRUPT',
          );
        }
      }
    }
    const repoIdentity = `git-common-dir:${commonDir}`;
    if (registryPresent && isObj(registry)) {
      if (!hasExactKeys(registry, REGISTRY_KEYS)
          || registry.schema_version !== 1
          || registry.artifact_type !== 'mission_runtime_registry'
          || registry.repo_identity !== repoIdentity
          || !isObj(registry.missions)) {
        fail('Mission registry is not the canonical runtime registry', 'MISSION_EVIDENCE_CORRUPT');
      }
    }

    let iccCampaignId = isStr(options.iccCampaignId) ? options.iccCampaignId : null;
    let graphNode = isStr(options.graphNodeId) ? options.graphNodeId : null;
    let explicitTerminalReceipt = null;
    let terminalReceipt = null;
    let terminalState = null;
    let terminalClaim = null;

    // Explicit terminal receipt path (production may pass; not required when registry works).
    if (isStr(options.missionTerminalReceiptPath)) {
      try {
        explicitTerminalReceipt = JSON.parse(fs.readFileSync(
          path.resolve(options.missionTerminalReceiptPath),
          'utf8',
        ));
      } catch (error) {
        if (enforce) {
          fail(
            `terminal Mission receipt unreadable: ${error.message || String(error)}`,
            'MISSION_EVIDENCE_CORRUPT',
          );
        }
      }
    }

    // Mechanical registry → canonical state → exact current applied terminal.
    if (registryPresent && isObj(registry)) {
      const sealedGraph = isStr(options.missionGraphDigest) ? options.missionGraphDigest : null;
      const sealedLineage = isStr(options.missionLineageId) ? options.missionLineageId : null;
      const sealedPolicy = isStr(options.missionPolicyDigest) ? options.missionPolicyDigest : null;
      const candidateTerminals = [];
      for (const [adoptionKey, entry] of Object.entries(registry.missions)) {
        if (!SHA256.test(adoptionKey)
            || !hasExactKeys(entry, REGISTRY_ENTRY_KEYS)
            || entry.schema_version !== 1
            || entry.adoption_key !== adoptionKey
            || entry.repo_identity !== repoIdentity
            || entry.state_ref !== path.join('states', `${adoptionKey}.json`)
            || !SHA256.test(entry.mission_policy_digest || '')
            || !SHA256.test(entry.mission_graph_digest || '')) {
          fail(
            `Mission registry entry ${adoptionKey} is noncanonical`,
            'MISSION_EVIDENCE_CORRUPT',
          );
        }
        const statePath = path.join(missionRoot, entry.state_ref);
        if (!fs.existsSync(statePath)) {
          fail(`Mission state missing for ${adoptionKey}`, 'MISSION_EVIDENCE_CORRUPT');
        }
        let state;
        try {
          state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          mission.validateMissionState(state);
          mission.stateHash(state);
        } catch (error) {
          if (enforce) {
            fail(
              `Mission state unreadable for ${adoptionKey}: ${error.message || String(error)}`,
              'MISSION_EVIDENCE_CORRUPT',
            );
          }
          continue;
        }
        if (!isObj(state)
            || state.repo_identity !== repoIdentity
            || state.mission_lineage_id !== entry.mission_lineage_id
            || state.task_authority_id !== entry.task_authority_id
            || state.mission_policy_digest !== entry.mission_policy_digest
            || state.mission_graph_digest !== entry.mission_graph_digest) {
          fail(
            `Mission state ${adoptionKey} does not match registry authority`,
            'MISSION_EVIDENCE_CORRUPT',
          );
        }
        // Bind sealed policy/graph/lineage exactly; foreign canonical missions
        // are ignored rather than allowed to satisfy this graph node.
        if (sealedLineage && sealedLineage !== state.mission_lineage_id) {
          continue; // foreign lineage
        }
        if (sealedPolicy && sealedPolicy !== state.mission_policy_digest) {
          continue;
        }
        if (sealedGraph && sealedGraph !== state.mission_graph_digest) {
          continue;
        }
        const expectedReadyReceiptDigests = new Set();
        for (const [nodeId, progress] of Object.entries(
          isObj(state.graph_progress) ? state.graph_progress : {},
        )) {
          if (graphNode && nodeId !== graphNode) continue;
          if (!isObj(progress) || progress.status !== 'ready') continue;
          if (!SHA256.test(progress.last_receipt_digest || '')) {
            if (enforce) {
              fail(
                `current ready Mission state for ${nodeId} lacks a canonical terminal receipt digest`,
                'MISSION_EVIDENCE_CORRUPT',
              );
            }
            continue;
          }
          const matchingClaim = Object.values(
            isObj(state.claims) ? state.claims : {},
          ).find((claim) => (
            isObj(claim)
              && claim.graph_node_id === nodeId
              && claim.terminal === true
              && claim.reconciled === true
          ));
          if (!matchingClaim) {
            if (enforce) {
              fail(
                `current ready Mission state for ${nodeId} lacks a terminal reconciled claim`,
                'MISSION_EVIDENCE_CORRUPT',
              );
            }
            continue;
          }
          expectedReadyReceiptDigests.add(progress.last_receipt_digest);
        }
        const observedReadyReceiptDigests = new Set();
        const journalDir = path.join(missionRoot, 'journals', adoptionKey);
        if (!fs.existsSync(journalDir)) {
          if (enforce && expectedReadyReceiptDigests.size > 0) {
            fail(
              `current ready Mission state for ${adoptionKey} is missing its applied terminal journal`,
              'MISSION_EVIDENCE_MISSING',
            );
          }
          continue;
        }
        let names;
        try {
          names = fs.readdirSync(journalDir).filter((n) => n.endsWith('.applied.json'));
        } catch (error) {
          if (enforce) {
            fail(
              `Mission journal unreadable for ${adoptionKey}: ${error.message || String(error)}`,
              'MISSION_EVIDENCE_CORRUPT',
            );
          }
          continue;
        }
        for (const name of names) {
          try {
            const rec = JSON.parse(fs.readFileSync(path.join(journalDir, name), 'utf8'));
            if (!isObj(rec) || rec.artifact_type !== 'campaign_terminal_receipt') {
              if (enforce) {
                fail('applied Mission journal is not a campaign terminal receipt',
                  'MISSION_EVIDENCE_CORRUPT');
              }
              continue;
            }
            if (graphNode && rec.graph_node_id !== graphNode) continue;
            const valid = validateCampaignTerminalReceipt(rec, state);
            if (!valid.ok) {
              // Old applied attempts can coexist with a later current terminal;
              // only the receipt bound by graph_progress.last_receipt_digest is
              // current authority.  An explicitly selected invalid receipt OR
              // the currently bound receipt is always corruption; neither may
              // be silently relabelled as harmless history.
              const currentProgress = isStr(rec.graph_node_id)
                && isObj(state.graph_progress)
                ? state.graph_progress[rec.graph_node_id]
                : null;
              const currentReceiptInvalid = isObj(currentProgress)
                && isStr(rec.receipt_digest)
                && currentProgress.last_receipt_digest === rec.receipt_digest;
              if ((explicitTerminalReceipt || currentReceiptInvalid) && enforce) {
                fail(valid.reason, 'MISSION_EVIDENCE_CORRUPT');
              }
              continue;
            }
            if (rec.outcome !== 'ready') continue;
            observedReadyReceiptDigests.add(rec.receipt_digest);
            if (explicitTerminalReceipt
                && rec.receipt_digest !== explicitTerminalReceipt.receipt_digest) {
              continue;
            }
            candidateTerminals.push({ receipt: rec, state, claim: valid.claim });
          } catch (error) {
            if (enforce) {
              fail(
                `terminal journal parse failed: ${error.message || String(error)}`,
                'MISSION_EVIDENCE_CORRUPT',
              );
            }
          }
        }
        const missingReadyReceipt = [...expectedReadyReceiptDigests]
          .find((digest) => !observedReadyReceiptDigests.has(digest));
        if (missingReadyReceipt && enforce) {
          fail(
            `current ready Mission state for ${adoptionKey} is missing applied terminal receipt ${missingReadyReceipt}`,
            'MISSION_EVIDENCE_MISSING',
          );
        }
      }
      if (candidateTerminals.length > 1) {
        if (enforce) {
          fail(
            'ambiguous current ready Mission terminal receipts for graph node',
            'MISSION_EVIDENCE_AMBIGUOUS',
          );
        }
      } else if (candidateTerminals.length === 1) {
        terminalReceipt = candidateTerminals[0].receipt;
        terminalState = candidateTerminals[0].state;
        terminalClaim = candidateTerminals[0].claim;
      }
    }

    if (isObj(terminalReceipt)) {
      if (!iccCampaignId && isStr(terminalReceipt.icc_campaign_id)) {
        iccCampaignId = terminalReceipt.icc_campaign_id;
      }
      if (!graphNode && isStr(terminalReceipt.graph_node_id)) {
        graphNode = terminalReceipt.graph_node_id;
      }
    } else if (explicitTerminalReceipt && enforce) {
      fail(
        'explicit Mission terminal receipt is not the canonical current ready receipt',
        'MISSION_EVIDENCE_FOREIGN',
      );
    }

    const rootRunId = isStr(options.rootRunId) ? options.rootRunId : iccCampaignId;
    // Never fall back to ambient AUTOPILOT_ROOT_RUN_ID.
    if (isStr(rootRunId)) {
      const loaded = loadControllerEvidenceFromRoot(
        commonDir,
        rootRunId,
        graphNode,
        enforce,
        (isObj(terminalReceipt) && isObj(terminalState) && isObj(terminalClaim)) ? {
          repoIdentity,
          state: terminalState,
          claim: terminalClaim,
          terminal: terminalReceipt,
        } : null,
        repoRoot,
      );
      if (!historicalOutputs) historicalOutputs = loaded.historicalOutputs;
      if (!noOpReceipt) noOpReceipt = loaded.noOpReceipt;
      if (!workOrder) workOrder = loaded.workOrder;
      // A canonical ready terminal is durable history, regardless of whether
      // it was discovered from an explicit path or the ordinary registry.
      // Once that history exists, its exact controller Work Order is required:
      // treating a missing WO as "first run" would replay an effectful node.
      if (!loaded.workOrder && enforce && isObj(terminalReceipt)) {
        fail(
          'controller Work Order for Mission terminal evidence not found',
          'MISSION_EVIDENCE_MISSING',
        );
      }
    } else if (enforce && registryPresent && isObj(registry)
        && (Array.isArray(registry.adoptions) ? registry.adoptions.length > 0
          : isObj(registry.missions) ? Object.keys(registry.missions).length > 0
            : Array.isArray(registry.entries) ? registry.entries.length > 0 : false)
        && !terminalReceipt
        && !historicalOutputs) {
      // Registry history exists but no terminal for this sealed binding:
      // that is mechanical proof of no prior accepted output for the node
      // only when we could enumerate journals without finding a match.
      // Corrupt/partial without resolvable icc remains fail-closed only when
      // a terminal was expected (explicit path). First-run proceeds.
    }
  } catch (error) {
    if (error && error.code && String(error.code).startsWith('MISSION_')) throw error;
    if (error instanceof MissionRoutingAdmissionError) throw error;
    if (enforce) {
      fail(
        `Mission evidence load failed: ${error.message || String(error)}`,
        'MISSION_EVIDENCE_CORRUPT',
      );
    }
  }

  return finalizeMissionEvidence(
    historicalOutputs,
    noOpReceipt,
    workOrder,
    allowTest,
    options,
  );
}

function finalizeMissionEvidence(
  historicalOutputs,
  noOpReceipt,
  workOrder,
  allowTest,
  options,
) {
  if (allowTest) {
    if (!historicalOutputs && isStr(options.historicalEvidencePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.resolve(options.historicalEvidencePath), 'utf8'));
        if (isObj(raw) && isObj(raw.outputs) && isStr(raw.digest)
            && raw.digest === sha256(canonicalJson({ outputs: raw.outputs }))) {
          historicalOutputs = raw.outputs;
        }
      } catch (_e) { /* ignore test-path */ }
    }
    if (!noOpReceipt && isStr(options.noopReceiptPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.resolve(options.noopReceiptPath), 'utf8'));
        if (isObj(raw) && isStr(raw.digest)) {
          const body = { ...raw }; delete body.digest;
          if (raw.digest === sha256(canonicalJson(body))) noOpReceipt = raw;
        }
      } catch (_e) { /* ignore test-path */ }
    }
  }
  return { historicalOutputs, noOpReceipt, workOrder };
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isStr(v) {
  return typeof v === 'string' && v.length > 0;
}

// Pre-spend executable delta: allowed vs required vs creates, version-mirror
// generator closure, and rejection of typo/nonexistent outputs.
function validateExecutableDeltaAtAdmission(repoRoot, graph, options = {}) {
  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const durableByNode = {};
  const noopAdoptions = [];
  for (const node of nodes) {
    const campaign = node && node.campaign;
    if (!campaign) {
      fail(`graph node ${node && node.id} missing campaign`, 'MISSION_GRAPH_DELTA_INVALID');
    }
    // Evidence authority is node-scoped.  Never load one terminal/controller
    // pair once and reuse it to satisfy every node in the frozen graph.
    const durable = loadDurableMissionEvidence(repoRoot, {
      ...options,
      graphNodeId: node.id,
    });
    durableByNode[node.id] = durable;
    const authorizedCreates = Array.isArray(campaign.authorized_creates)
      ? campaign.authorized_creates
      : (Array.isArray(options.authorizedCreates) ? options.authorizedCreates : []);
    const outputPaths = Array.isArray(campaign.output_paths) ? campaign.output_paths : [];
    const requiredPaths = Array.isArray(campaign.required_paths) ? campaign.required_paths : [];
    // Explicit graph field only — never derive both sides from the same array.
    const versionMirrors = Array.isArray(campaign.version_mirror_paths)
      ? campaign.version_mirror_paths
      : [];
    const versionGenerator = versionMirrors.length > 0
      ? (campaign.version_mirror_generator || null)
      : null;
    const mirrorCheck = verifyVersionMirrorClosure(versionMirrors, versionGenerator);
    if (!mirrorCheck.ok) {
      fail(
        `graph node ${node.id} version mirror closure rejected: ${mirrorCheck.reason}`,
        'MISSION_GRAPH_DELTA_INVALID',
      );
    }
    // Mechanically read current bytes for required+output paths (authority, not ambient).
    const relevant = [...new Set([...requiredPaths, ...outputPaths])];
    const currentBytesByPath = readRelevantBytes(repoRoot, relevant);
    // Mission admission always enforces strict create authority for absent outputs.
    const delta = admitExecutableMissionDelta({
      repoRoot,
      allowedPathPrefixes: campaign.allowed_path_prefixes || [],
      requiredPaths,
      outputPaths,
      authorizedCreates,
      versionMirrorPaths: versionMirrors,
      versionMirrorGenerator: versionGenerator,
      historicalOutputs: durable.historicalOutputs,
      currentBytesByPath,
      noOpReceipt: durable.noOpReceipt,
      baseSha: options.baseSha || null,
      strictOutputCreates: true,
    });
    if (!delta.ok) {
      fail(
        `graph node ${node.id} executable delta rejected: ${delta.reason}`,
        'MISSION_GRAPH_DELTA_INVALID',
      );
    }
    if (delta.noop === true) {
      const adoption = {
        graph_node_id: node.id,
        dispatcher_called: false,
        mutation_attempts: 0,
        gate_attempts: 0,
        resources_created: 0,
        noop_receipt_digest: isObj(durable.noOpReceipt) && isStr(durable.noOpReceipt.digest)
          ? durable.noOpReceipt.digest
          : null,
        noop_receipt: durable.noOpReceipt,
        source_work_order_id: durable.workOrder && durable.workOrder.work_order_id,
        source_work_order_digest: durable.workOrder && durable.workOrder.digest,
      };
      // Production surface: returned from admission, not a discarded local property.
      node.noop_adoption = adoption;
      noopAdoptions.push(adoption);
    }
  }
  return { noop_adoptions: noopAdoptions, durable_by_node: durableByNode };
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
  let deltaAdmission = { noop_adoptions: [] };
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
    deltaAdmission = validateExecutableDeltaAtAdmission(repo.root, graphJson, {
      baseSha: admissionBaseSha,
      authorizedCreates: options.authorizedCreates,
      // Production: evidence from Mission registry + controller WO only.
      // Test seams require explicit allowTestCallerEvidence.
      allowTestCallerEvidence: options.allowTestCallerEvidence === true,
      enforceEvidence: options.enforceEvidence === true
        || (policy.resolution.policy.enforcement_mode === 'enforce'),
      historicalOutputs: options.historicalOutputs,
      historicalOutputsDigest: options.historicalOutputsDigest,
      currentBytesByPath: options.currentBytesByPath,
      noOpReceipt: options.noOpReceipt,
      historicalEvidencePath: options.historicalEvidencePath,
      noopReceiptPath: options.noopReceiptPath,
      rootRunId: options.rootRunId,
      iccCampaignId: options.iccCampaignId,
      graphNodeId: options.graphNodeId,
      missionTerminalReceiptPath: options.missionTerminalReceiptPath,
      missionGraphDigest: options.missionGraphDigest
        || graphResult.graph_digest
        || (graphJson && (graphJson.digest || graphJson.graph_digest))
        || null,
      missionPolicyDigest: options.missionPolicyDigest
        || policy.resolution.policy_digest
        || null,
      missionLineageId: options.missionLineageId || null,
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
      noop_adoptions: [],
      dispatcher_called: null,
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
  const noopAdoptions = (deltaAdmission && Array.isArray(deltaAdmission.noop_adoptions))
    ? deltaAdmission.noop_adoptions
    : [];
  const allDeliverablesNoop = noopAdoptions.length > 0
    && noopAdoptions.length === graphResult.deliverables;
  const result = {
    status: policy.resolution.policy.enforcement_mode === 'enforce' ? 'READY' : 'SHADOW',
    enforced: policy.resolution.policy.enforcement_mode === 'enforce',
    admitted: true,
    would_block: false,
    route,
    marker,
    admission,
    noop_adoptions: noopAdoptions,
    // Node-scoped adoptions remain available for per-node dispatch bridging.
    // Whole-admission zero-spend is authoritative only when every frozen
    // deliverable has an exact no-op adoption.
    dispatcher_called: allDeliverablesNoop ? false : null,
    mutation_attempts: allDeliverablesNoop ? 0 : null,
    gate_attempts: allDeliverablesNoop ? 0 : null,
    resources_created: allDeliverablesNoop ? 0 : null,
    noop_short_circuit: noopAdoptions.length > 0,
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
  verifyVersionMirrorClosure,
  CANONICAL_VERSION_MIRROR_CLOSURE,
  CANONICAL_VERSION_MIRROR_GENERATOR,
  loadDurableMissionEvidence,
  readRelevantBytes,
};
