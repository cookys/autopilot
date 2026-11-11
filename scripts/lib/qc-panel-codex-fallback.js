'use strict';

// Runtime codex-quota seat fallback for qc_panel (PM ruling 01M74DH2FF / card d-b155785a).
//
// Invariants:
// - Never mutates qc_panel composition in config or roster resolution.
// - Triggers ONLY when a qc_panel seat on the `codex` runner fails at runtime because
//   codex quota or rate-limit is exhausted, reusing `classifyErrorContent` from
//   `scripts/engine-capability-state.js` (no second classifier).
// - Re-runs that seat at most ONCE on the first eligible substitute from
//   `qc_panel.codex_quota_substitutes` (default: `grok-4.7/high@grok`, then
//   `gemini-4-carbon-high/high@agy`), skipping any substitute whose family equals the
//   implementer's family or fails existing panel cross-family / duplicate-tuple rules.
// - Emits verbatim Traditional Chinese per substituted seat:
//   `codex 額度用完，由 <engine> 代打`

const fs = require('fs');
const { classifyErrorContent } = require('../engine-capability-state');
const { configPath } = require('./config-path');
const { familyOfEngine } = require('./stage-write');
const { familiesOfImplementer } = require('./review-family-gate');
const { resolveRawLog } = require('./raw-log-path');

const DEFAULT_CODEX_QUOTA_SUBSTITUTES = Object.freeze([
  'grok-4.7/high@grok',
  'gemini-4-carbon-high/high@agy',
]);

const QUOTA_FAILURE_CLASSES = new Set(['quota_exhausted', 'rate_limited']);
const RAW_LOG_TAIL_BYTES = 65536;

function parseSubstituteSpec(entry) {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const atIdx = trimmed.indexOf('@');
    if (atIdx <= 0 || atIdx === trimmed.length - 1) return null;
    const left = trimmed.slice(0, atIdx).trim();
    const right = trimmed.slice(atIdx + 1).trim();
    if (!left || !right) return null;

    let engine = left;
    let effort = 'high';
    const slashIdx = left.lastIndexOf('/');
    if (slashIdx !== -1) {
      engine = left.slice(0, slashIdx).trim();
      effort = left.slice(slashIdx + 1).trim() || 'high';
    }
    if (!engine) return null;

    let runner = right;
    let endpoint;
    const colonIdx = right.indexOf(':');
    if (colonIdx !== -1) {
      runner = right.slice(0, colonIdx).trim();
      const ep = right.slice(colonIdx + 1).trim();
      if (ep && ep !== '@none') endpoint = ep;
    }
    if (!runner) return null;

    const family = familyOfEngine(engine);
    return {
      engine,
      runner,
      effort,
      ...(endpoint ? { endpoint } : {}),
      family,
    };
  }

  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const engine = typeof entry.engine === 'string' && entry.engine.trim()
      ? entry.engine.trim()
      : (typeof entry.model === 'string' && entry.model.trim() ? entry.model.trim() : '');
    const runner = typeof entry.runner === 'string' && entry.runner.trim()
      ? entry.runner.trim()
      : '';
    if (!engine || !runner) return null;
    const effort = typeof entry.effort === 'string' && entry.effort.trim()
      ? entry.effort.trim()
      : 'high';
    const endpoint = typeof entry.endpoint === 'string' && entry.endpoint.trim() && entry.endpoint.trim() !== '@none'
      ? entry.endpoint.trim()
      : undefined;
    const family = typeof entry.family === 'string' && entry.family.trim() && entry.family.trim() !== 'unknown'
      ? entry.family.trim()
      : familyOfEngine(engine);
    return {
      engine,
      runner,
      effort,
      ...(endpoint ? { endpoint } : {}),
      family,
    };
  }

  return null;
}

function loadCodexQuotaSubstitutes(options = {}) {
  const cfgFile = options.configFile || configPath();
  if (cfgFile && fs.existsSync(cfgFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      const qcPanelCfg = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed.qc_panel
        : null;
      const configured = qcPanelCfg && typeof qcPanelCfg === 'object' && !Array.isArray(qcPanelCfg)
        ? qcPanelCfg.codex_quota_substitutes
        : undefined;
      if (Array.isArray(configured)) {
        return configured.map(parseSubstituteSpec).filter(Boolean);
      }
    } catch (_err) {
      // Malformed or unreadable config falls back to built-in default substitutes.
    }
  }
  return DEFAULT_CODEX_QUOTA_SUBSTITUTES.map(parseSubstituteSpec).filter(Boolean);
}

function readRawLogTail(rawLogPath, cwd) {
  if (typeof rawLogPath !== 'string' || !rawLogPath.trim()) return '';
  let resolved = rawLogPath.trim();
  try {
    resolved = resolveRawLog(resolved, cwd ? { repoRoot: cwd } : undefined) || resolved;
  } catch (_err) {
    // Keep original path on resolver error.
  }
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size <= 0) return '';
    if (stat.size <= RAW_LOG_TAIL_BYTES) {
      return fs.readFileSync(resolved, 'utf8');
    }
    const fd = fs.openSync(resolved, 'r');
    try {
      const buf = Buffer.alloc(RAW_LOG_TAIL_BYTES);
      const bytesRead = fs.readSync(fd, buf, 0, RAW_LOG_TAIL_BYTES, stat.size - RAW_LOG_TAIL_BYTES);
      return buf.slice(0, bytesRead).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_err) {
    return '';
  }
}

function classifyCodexQuotaFailure({
  runner,
  exitCode = null,
  texts = [],
  rawLogPath = null,
  cwd = null,
} = {}) {
  if (runner !== 'codex') return null;

  const chunks = [];
  if (Array.isArray(texts)) {
    for (const item of texts) {
      if (typeof item === 'string' && item.trim()) {
        chunks.push(item);
      }
    }
  }
  const logText = readRawLogTail(rawLogPath, cwd);
  if (logText) chunks.push(logText);

  for (const chunk of chunks) {
    const classified = classifyErrorContent(chunk);
    if (QUOTA_FAILURE_CLASSES.has(classified)) {
      return { matched: true, reason: classified };
    }
  }

  if (exitCode === 429) {
    return { matched: true, reason: 'rate_limited' };
  }

  return null;
}

function seatEngineOf(seat) {
  if (!seat || typeof seat !== 'object') return '';
  if (typeof seat.engine === 'string' && seat.engine) return seat.engine;
  if (typeof seat.model === 'string' && seat.model) return seat.model;
  return '';
}

function seatFamilyOf(seat) {
  if (!seat || typeof seat !== 'object') return 'unknown';
  const engine = seatEngineOf(seat);
  const derived = engine ? familyOfEngine(engine) : 'unknown';
  if (derived !== 'unknown') return derived;
  if (typeof seat.family === 'string' && seat.family && seat.family !== 'unknown') {
    return seat.family;
  }
  return 'unknown';
}

function normalizeEndpoint(ep) {
  if (typeof ep !== 'string') return '';
  const trimmed = ep.trim();
  return (!trimmed || trimmed === '@none') ? '' : trimmed;
}

function isSameSeatTuple(seatA, seatB) {
  if (!seatA || !seatB) return false;
  return seatA.runner === seatB.runner
    && seatEngineOf(seatA) === seatEngineOf(seatB)
    && normalizeEndpoint(seatA.endpoint) === normalizeEndpoint(seatB.endpoint);
}

function selectCodexQuotaSubstitute({
  failedSeat,
  failedIndex = -1,
  panelSeats = [],
  implementerEngine = '',
  implementerFamily = '',
  crossFamilyRequired = true,
  requiredReviewFamilies = null,
  minPanelSize = null,
  authorFamilyExcluded = false,
  substitutes = null,
  configFile = null,
} = {}) {
  const candidates = Array.isArray(substitutes)
    ? substitutes.map(parseSubstituteSpec).filter(Boolean)
    : loadCodexQuotaSubstitutes(configFile ? { configFile } : {});

  if (candidates.length === 0) return null;

  const implFamilies = new Set();
  if (typeof implementerFamily === 'string' && implementerFamily && implementerFamily !== 'unknown') {
    implFamilies.add(implementerFamily);
  }
  if (typeof implementerEngine === 'string' && implementerEngine.trim()) {
    const parsedImpl = familiesOfImplementer(implementerEngine);
    for (const fam of parsedImpl.families) {
      if (fam && fam !== 'unknown') implFamilies.add(fam);
    }
  }

  const seatsArr = Array.isArray(panelSeats) ? panelSeats : [];
  const otherSeats = seatsArr.filter((s, idx) => {
    if (!s) return false;
    if (Number.isInteger(failedIndex) && failedIndex >= 0) return idx !== failedIndex;
    if (failedSeat && failedSeat.id && s.id) return s.id !== failedSeat.id;
    return s !== failedSeat;
  });

  const otherFamilies = new Set();
  for (const s of otherSeats) {
    const fam = seatFamilyOf(s);
    if (fam !== 'unknown') otherFamilies.add(fam);
  }

  const totalSeats = otherSeats.length + 1;
  const configuredRequired = Number.isSafeInteger(requiredReviewFamilies) && requiredReviewFamilies >= 1
    ? requiredReviewFamilies
    : 1;
  const panelRequiresDiversity = totalSeats > 1
    || (Number.isSafeInteger(minPanelSize) && minPanelSize > 1);
  const requiredDistinct = panelRequiresDiversity
    ? Math.max(2, configuredRequired)
    : configuredRequired;

  for (const cand of candidates) {
    const candFamily = cand.family && cand.family !== 'unknown'
      ? cand.family
      : familyOfEngine(cand.engine);
    if (!candFamily || candFamily === 'unknown') continue;

    // 1. Never pick a substitute whose family equals the implementer's family.
    if (implFamilies.size > 0 && implFamilies.has(candFamily)) continue;

    // 2. Never duplicate an existing seat tuple already in the panel.
    if (otherSeats.some((s) => isSameSeatTuple(s, cand))) continue;

    // 3. Respect existing panel cross-family diversity rules (terminalPanelCrossFamilySatisfied /
    //    resolve-review-loop required_review_families).
    if (crossFamilyRequired !== false) {
      const unionFamilies = new Set(otherFamilies);
      unionFamilies.add(candFamily);
      if (unionFamilies.size < requiredDistinct) continue;
      if (authorFamilyExcluded === true && implFamilies.size > 0) {
        const nonImplCount = [...unionFamilies].filter((f) => !implFamilies.has(f)).length;
        if (nonImplCount < requiredDistinct) continue;
      }
    }

    return {
      engine: cand.engine,
      runner: cand.runner,
      effort: cand.effort || 'high',
      ...(cand.endpoint ? { endpoint: cand.endpoint } : {}),
      family: candFamily,
    };
  }

  return null;
}

function formatSubstituteEngineLabel(substitute) {
  const engine = seatEngineOf(substitute);
  const runner = substitute && typeof substitute.runner === 'string' ? substitute.runner : '';
  return runner ? `${engine}@${runner}` : engine;
}

function formatCodexQuotaNotice(substitute) {
  return `codex 額度用完，由 ${formatSubstituteEngineLabel(substitute)} 代打`;
}

function buildSubstitutionRecord({ originalSeat, substitute, reason }) {
  const origEngine = seatEngineOf(originalSeat);
  const origRunner = originalSeat && typeof originalSeat.runner === 'string' && originalSeat.runner
    ? originalSeat.runner
    : 'codex';
  const origEffort = originalSeat && typeof originalSeat.effort === 'string' && originalSeat.effort
    ? originalSeat.effort
    : undefined;
  const origEndpoint = normalizeEndpoint(originalSeat && originalSeat.endpoint);

  const subEndpoint = normalizeEndpoint(substitute && substitute.endpoint);
  const subFamily = seatFamilyOf(substitute);

  return {
    original_seat: {
      ...(originalSeat && typeof originalSeat.id === 'string' && originalSeat.id ? { id: originalSeat.id } : {}),
      engine: origEngine,
      runner: origRunner,
      ...(origEffort ? { effort: origEffort } : {}),
      ...(origEndpoint ? { endpoint: origEndpoint } : {}),
    },
    substitute: {
      engine: seatEngineOf(substitute),
      runner: substitute.runner,
      effort: substitute.effort || 'high',
      family: subFamily,
      ...(subEndpoint ? { endpoint: subEndpoint } : {}),
    },
    reason,
    notice: formatCodexQuotaNotice(substitute),
  };
}

module.exports = {
  DEFAULT_CODEX_QUOTA_SUBSTITUTES,
  parseSubstituteSpec,
  loadCodexQuotaSubstitutes,
  classifyCodexQuotaFailure,
  selectCodexQuotaSubstitute,
  formatSubstituteEngineLabel,
  formatCodexQuotaNotice,
  buildSubstitutionRecord,
};
