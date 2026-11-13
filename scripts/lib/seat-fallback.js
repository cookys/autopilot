#!/usr/bin/env node
'use strict';

/**
 * seat-fallback.js — canonical seat retreat order & implementer-family inference
 * (PM 01M7AHAM). Single source of truth shared by dispatch-review.sh,
 * dispatch-hetero.sh, and src/engine/autopilot-engine.js, reading
 * scripts/lib/pace-roles.json and scripts/lib/noncq-pools.json.
 *
 * Rules:
 *   - Reviewer retreat walks `fallback.reviewer` in pace-roles.json:
 *     hydrogen (agy, gemini-4-hydrogen-high) -> glm (cc-shim --endpoint glm, glm-5.3)
 *     -> agyclaude (agy, claude-opus-5-5-medium).
 *   - Implementer retreat walks `priority.implementer` in pace-roles.json joined
 *     with noncq-pools.json + `role_models.implementer` (agy -> glm -> agyclaude).
 *   - `codex` never appears as an automatic retreat target for either seat.
 *   - Family guard skips rungs matching known implementer families; when
 *     implementer family is `unknown`, the family guard skips nothing (and GLM
 *     remains eligible).
 *   - `inferImplementerFamily` never assumes `openai` when no dispatch record
 *     exists; it returns `unknown`.
 *
 * Node >= 20.10, built-ins only.
 */

const fs = require('fs');
const path = require('path');
const { familyOfEngine } = require('./stage-write');
const { runsDir: defaultRunsDir } = require('./runtime-paths');
const { recordedImplementerEngines } = require('./review-family-gate');
const { sameEngine } = require('./engine-spelling');

const DEFAULT_ROLES_PATH = path.join(__dirname, 'pace-roles.json');
const DEFAULT_POOLS_PATH = path.join(__dirname, 'noncq-pools.json');

const KNOWN_FAMILIES = new Set([
  'minimax', 'moonshot', 'zhipu', 'xai', 'openai',
  'anthropic', 'alibaba', 'deepseek', 'meituan', 'reflection', 'google',
]);

function readJsonSafe(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_err) {
    return null;
  }
}

/**
 * Normalize a family token, pool key, or engine name into a canonical family.
 */
function normalizeFamily(value) {
  if (!value || typeof value !== 'string') return 'unknown';
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';
  const lower = trimmed.toLowerCase();
  if (lower === 'unknown') return 'unknown';
  if (lower === 'agyclaude' || lower === 'anthropic') return 'anthropic';
  if (lower === 'agy' || lower === 'hydrogen' || lower === 'carbon' || lower === 'argon' || lower === 'google') {
    return 'google';
  }
  if (lower === 'glm' || lower === 'zhipu') return 'zhipu';
  if (lower === 'codex' || lower === 'openai') return 'openai';
  if (lower === 'grok' || lower === 'xai') return 'xai';
  if (KNOWN_FAMILIES.has(lower)) return lower;
  const parsed = stripRungModel(trimmed);
  const fam = familyOfEngine(parsed);
  return fam || 'unknown';
}

function stripRungModel(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim();
  const atIdx = s.indexOf('@');
  if (atIdx !== -1) s = s.slice(0, atIdx);
  const slashIdx = s.indexOf('/');
  if (slashIdx !== -1) s = s.slice(0, slashIdx);
  return s.trim();
}

function splitFamilies(raw) {
  const out = new Set();
  const items = Array.isArray(raw) ? raw : String(raw || '').split(',');
  for (const item of items) {
    const fam = normalizeFamily(item);
    if (fam && fam !== 'unknown') out.add(fam);
  }
  return out;
}

function isCodexRung(rung) {
  if (!rung || typeof rung !== 'object') return false;
  const runner = String(rung.runner || '').trim().toLowerCase();
  const key = String(rung.key || '').trim().toLowerCase();
  const endpoint = String(rung.endpoint || '').trim().toLowerCase();
  return runner === 'codex' || key === 'codex' || endpoint === 'codex';
}

function matchesFailedSeat(rung, opts) {
  if (!opts || typeof opts !== 'object') return false;
  const failedRunner = opts.failedRunner ? String(opts.failedRunner).trim() : '';
  const failedModel = opts.failedModel ? String(opts.failedModel).trim() : '';
  const failedEndpoint = opts.failedEndpoint ? String(opts.failedEndpoint).trim() : '';
  const failedKey = opts.failedKey ? String(opts.failedKey).trim() : '';
  if (!failedRunner && !failedModel && !failedEndpoint && !failedKey) return false;
  if (failedKey && rung.key && rung.key === failedKey) return true;
  if (failedRunner && rung.runner !== failedRunner) return false;
  if (failedEndpoint && (rung.endpoint || '') !== failedEndpoint) return false;
  if (failedModel && !sameEngine(rung.model || '', failedModel)) return false;
  return Boolean(failedModel || failedEndpoint || failedRunner);
}

function normalizeRung(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (isCodexRung(entry)) return null;
  const model = String(entry.model || entry.engine || '').trim();
  const runner = String(entry.runner || '').trim();
  if (!model || !runner) return null;
  const effort = String(entry.effort || 'high').trim() || 'high';
  const endpoint = entry.endpoint ? String(entry.endpoint).trim() : null;
  const key = entry.key ? String(entry.key).trim() : model;
  const family = normalizeFamily(entry.family || model);
  return { key, runner, model, effort, endpoint, family };
}

function buildPoolIndex(roles, poolsDoc) {
  const index = new Map();
  const addPool = (keyHint, entry) => {
    if (!entry || typeof entry !== 'object') return;
    const key = String(entry.key || keyHint || '').trim();
    if (!key) return;
    if (!index.has(key)) index.set(key, entry);
  };
  if (Array.isArray(poolsDoc)) {
    for (const entry of poolsDoc) addPool(entry && entry.key, entry);
  } else if (poolsDoc && typeof poolsDoc === 'object') {
    for (const [k, v] of Object.entries(poolsDoc)) addPool(k, v);
  }
  if (roles && roles.pools && typeof roles.pools === 'object') {
    for (const [k, v] of Object.entries(roles.pools)) addPool(k, v);
  }
  return index;
}

/**
 * Ordered reviewer fallback rungs from pace-roles.json `fallback.reviewer`.
 * Never returns `codex`; skips rungs whose family matches `implementerFamily`.
 * When `implementerFamily` is `unknown`, skips nothing (GLM stays eligible).
 */
function reviewerFallbackChain(opts = {}) {
  const roles = readJsonSafe(opts.rolesPath || DEFAULT_ROLES_PATH);
  const rawList = roles && roles.fallback && Array.isArray(roles.fallback.reviewer)
    ? roles.fallback.reviewer
    : [];
  const forbidden = splitFamilies(opts.implementerFamily);
  const excluded = new Set(Array.isArray(opts.excludeKeys) ? opts.excludeKeys : []);
  const out = [];
  for (const raw of rawList) {
    const rung = normalizeRung(raw);
    if (!rung) continue;
    if (excluded.has(rung.key)) continue;
    if (matchesFailedSeat(rung, opts)) continue;
    if (rung.family !== 'unknown' && forbidden.has(rung.family)) continue;
    out.push(rung);
  }
  return out;
}

/**
 * Ordered implementer fallback rungs from pace-roles.json `priority.implementer`
 * joined with noncq-pools.json + `role_models.implementer`. Never returns `codex`.
 */
function implementerFallbackChain(opts = {}) {
  const roles = readJsonSafe(opts.rolesPath || DEFAULT_ROLES_PATH) || {};
  const poolsDoc = readJsonSafe(opts.poolsPath || DEFAULT_POOLS_PATH) || {};
  const poolIndex = buildPoolIndex(roles, poolsDoc);
  const keys = (roles.priority && Array.isArray(roles.priority.implementer))
    ? roles.priority.implementer
    : (Array.isArray(roles.implementer) ? roles.implementer : []);
  const roleModels = (roles.role_models && roles.role_models.implementer) || {};
  const excluded = new Set(Array.isArray(opts.excludeKeys) ? opts.excludeKeys : []);
  const out = [];
  for (const key of keys) {
    const k = String(key || '').trim();
    if (!k || k === 'codex' || excluded.has(k)) continue;
    const pool = poolIndex.get(k);
    if (!pool) continue;
    const model = roleModels[k] || pool.model;
    const rung = normalizeRung({
      key: k,
      runner: pool.runner,
      endpoint: pool.endpoint || null,
      model,
      effort: pool.effort || 'high',
      family: pool.family || model,
    });
    if (!rung) continue;
    if (matchesFailedSeat(rung, opts)) continue;
    out.push(rung);
  }
  return out;
}

function selectImplementerFallback(opts = {}) {
  return implementerFallbackChain(opts)[0] || null;
}

function selectReviewerFallback(opts = {}) {
  return reviewerFallbackChain(opts)[0] || null;
}

function formatRung(rung) {
  if (!rung) return '';
  const epSuffix = rung.endpoint ? `@${rung.runner}#${rung.endpoint}` : `@${rung.runner}`;
  return `${rung.model}/${rung.effort}${epSuffix}`;
}

function toContractRung(rung) {
  if (!rung) return null;
  return {
    engine: rung.model,
    effort: rung.effort,
    runner: rung.runner,
    endpoint: rung.endpoint || null,
    key: rung.key,
    family: rung.family,
  };
}

function extractFamiliesFromChain(chain) {
  if (!chain || typeof chain !== 'object') return [];
  const fams = [];
  if (!Array.isArray(chain)) {
    if (typeof chain.implementer_family === 'string') {
      for (const f of splitFamilies(chain.implementer_family)) fams.push(f);
    }
    if (chain.implementer && typeof chain.implementer.family === 'string') {
      for (const f of splitFamilies(chain.implementer.family)) fams.push(f);
    }
    for (const eng of [
      chain.implementer_engine,
      chain.engine,
      chain.model,
      chain.implementer && chain.implementer.engine,
      chain.implementer && chain.implementer.model,
    ]) {
      const f = normalizeFamily(eng);
      if (f !== 'unknown') fams.push(f);
    }
  }
  const entries = Array.isArray(chain)
    ? chain
    : (Array.isArray(chain.entries) ? [chain, ...chain.entries] : [chain]);
  for (const eng of recordedImplementerEngines(entries)) {
    const f = normalizeFamily(eng);
    if (f !== 'unknown') fams.push(f);
  }
  return fams;
}

function resolveMaybe(p) {
  if (!p || typeof p !== 'string') return '';
  try { return path.resolve(p); } catch (_e) { return p; }
}

/**
 * Infer implementer family from recorded dispatch artifacts (`chain.json`,
 * matching run manifests in `runsDir`, or `<git-common-dir>/autopilot/dispatch-branches.jsonl`).
 * Never assumes `openai`; returns `'unknown'` when nothing is recorded.
 */
function inferImplementerFamily(opts = {}) {
  const env = opts.env || process.env;
  const collected = [];
  let source = 'none';
  const pushFam = (raw, src) => {
    const f = normalizeFamily(raw);
    if (f && f !== 'unknown') {
      if (!collected.includes(f)) collected.push(f);
      if (source === 'none') source = src;
    }
  };

  // 1. Explicit chainFile or AUTOPILOT_CHAIN_FILE
  const chainCandidates = [];
  if (opts.chainFile) chainCandidates.push({ path: opts.chainFile, label: 'chain_file' });
  if (env.AUTOPILOT_CHAIN_FILE && env.AUTOPILOT_CHAIN_FILE !== opts.chainFile) {
    chainCandidates.push({ path: env.AUTOPILOT_CHAIN_FILE, label: 'env_chain_file' });
  }
  const worktreeChain = opts.worktree ? path.join(opts.worktree, '.autopilot', 'chain.json') : '';
  const cwdChain = opts.cwd ? path.join(opts.cwd, '.autopilot', 'chain.json') : '';
  if (worktreeChain) chainCandidates.push({ path: worktreeChain, label: 'worktree_chain' });
  if (cwdChain && cwdChain !== worktreeChain) chainCandidates.push({ path: cwdChain, label: 'cwd_chain' });

  for (const cand of chainCandidates) {
    const chain = readJsonSafe(cand.path);
    const fams = extractFamiliesFromChain(chain);
    if (fams.length > 0) {
      for (const f of fams) pushFam(f, cand.label);
      return { family: collected.join(','), source };
    }
  }

  // 2. Dispatch run manifests in runsDir matched by runId / diffFile / worktree / branch
  const rDir = opts.runsDir || defaultRunsDir(env);
  const runId = opts.runId || env.AUTOPILOT_RUN_ID || '';
  const normDiff = resolveMaybe(opts.diffFile);
  const normWt = resolveMaybe(opts.worktree);
  const branch = opts.branch ? String(opts.branch).trim() : '';
  if (rDir && (runId || normDiff || normWt || branch)) {
    try {
      const files = fs.readdirSync(rDir).filter((f) => f.endsWith('.json'));
      files.sort().reverse();
      for (const file of files) {
        const doc = readJsonSafe(path.join(rDir, file));
        if (!doc || typeof doc !== 'object') continue;
        const matchRun = Boolean(runId && doc.run_id === runId);
        const matchDiff = Boolean(normDiff && doc.diff_file && resolveMaybe(doc.diff_file) === normDiff);
        const matchWt = Boolean(normWt && doc.worktree && resolveMaybe(doc.worktree) === normWt);
        const matchBr = Boolean(branch && doc.branch && doc.branch === branch);
        if (!matchRun && !matchDiff && !matchWt && !matchBr) continue;
        if (doc.implementer_family) pushFam(doc.implementer_family, 'runs_dir');
        if (doc.role === 'implementer' || doc.stage === 'implement' || doc.implementer_engine) {
          pushFam(doc.implementer_engine || doc.model || doc.engine || doc.served_by, 'runs_dir');
        } else if (doc.served_by && !doc.reviewer_engine) {
          pushFam(doc.served_by, 'runs_dir');
        }
        if (collected.length > 0) return { family: collected.join(','), source };
      }
    } catch (_err) {
      // runsDir missing or unreadable -> fall through cleanly
    }
  }

  // 3. dispatch-branches.jsonl ledger matched by worktree or branch
  const ledgerPath = opts.branchLedgerFile
    || (opts.gitCommonDir ? path.join(opts.gitCommonDir, 'autopilot', 'dispatch-branches.jsonl') : '');
  if (ledgerPath && (normWt || branch)) {
    try {
      const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        let row = null;
        try { row = JSON.parse(lines[i]); } catch (_e) { continue; }
        if (!row || typeof row !== 'object') continue;
        const matchWt = Boolean(normWt && row.worktree && resolveMaybe(row.worktree) === normWt);
        const matchBr = Boolean(branch && row.branch && row.branch === branch);
        if (!matchWt && !matchBr) continue;
        if (row.implementer_family) pushFam(row.implementer_family, 'branch_ledger');
        pushFam(row.model || row.engine || row.served_by, 'branch_ledger');
        if (collected.length > 0) return { family: collected.join(','), source };
      }
    } catch (_err) {
      // ledger missing or unreadable -> fall through cleanly
    }
  }

  return { family: 'unknown', source: 'none' };
}

function parseCliArgs(argv) {
  const cmd = argv[2] || '';
  const opts = {};
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : '');
    switch (a) {
      case '--implementer-family': opts.implementerFamily = next(); break;
      case '--failed-runner': opts.failedRunner = next(); break;
      case '--failed-model': opts.failedModel = next(); break;
      case '--failed-endpoint': opts.failedEndpoint = next(); break;
      case '--failed-key': opts.failedKey = next(); break;
      case '--roles': opts.rolesPath = next(); break;
      case '--pools': opts.poolsPath = next(); break;
      case '--chain-file': opts.chainFile = next(); break;
      case '--runs-dir': opts.runsDir = next(); break;
      case '--branch-ledger': opts.branchLedgerFile = next(); break;
      case '--git-common-dir': opts.gitCommonDir = next(); break;
      case '--diff-file': opts.diffFile = next(); break;
      case '--branch': opts.branch = next(); break;
      case '--worktree': opts.worktree = next(); break;
      case '--cwd': opts.cwd = next(); break;
      case '--run-id': opts.runId = next(); break;
      case '--all': opts.all = true; break;
      default: break;
    }
  }
  return { cmd, opts };
}

if (require.main === module) {
  const { cmd, opts } = parseCliArgs(process.argv);
  if (cmd === 'reviewer') {
    const chain = reviewerFallbackChain(opts);
    process.stdout.write(JSON.stringify(opts.all ? chain : (chain[0] || null)) + '\n');
  } else if (cmd === 'implementer') {
    const chain = implementerFallbackChain(opts);
    process.stdout.write(JSON.stringify(opts.all ? chain : (chain[0] || null)) + '\n');
  } else if (cmd === 'infer-family') {
    process.stdout.write(JSON.stringify(inferImplementerFamily(opts)) + '\n');
  } else {
    process.stderr.write('usage: seat-fallback.js <reviewer|implementer|infer-family> [options]\n');
    process.exit(2);
  }
}

module.exports = {
  normalizeFamily,
  splitFamilies,
  reviewerFallbackChain,
  implementerFallbackChain,
  selectReviewerFallback,
  selectImplementerFallback,
  inferImplementerFamily,
  formatRung,
  toContractRung,
  isCodexRung,
};
