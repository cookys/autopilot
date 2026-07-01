'use strict';

const fs = require('fs');
const path = require('path');
const { redact, scan } = require('../../hooks/_shared/secret-patterns');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CAPABILITY_DIR = path.join(__dirname, 'capabilities');
const DAY_MS = 24 * 60 * 60 * 1000;

const STATUSES = new Set(['verified', 'warning', 'unverified', 'unavailable']);
const HARNESS_LEVEL_ORDER = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5'];
const HARNESS_LEVELS = new Set(HARNESS_LEVEL_ORDER);
const CAPABILITY_VALUES = new Set(['verified', 'warning', 'unverified', 'unavailable', 'known-existing-host', 'not-applicable']);
const RECORD_FIELDS = new Set([
  'id',
  'display_name',
  'kind',
  'status',
  'harness_level',
  'last_checked_at',
  'verified_at',
  'expires_at',
  'evidence',
  'capabilities',
  'auth_domains',
  'notes',
]);
const EVIDENCE_FIELDS = new Set(['source', 'command', 'result']);
const AUTH_DOMAIN_KEY_RE = /^[a-z0-9][a-z0-9_:-]*$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDurationDays(value) {
  const raw = String(value == null ? '' : value).trim();
  const match = raw.match(/^(\d+)(?:d|day|days)?$/);
  if (!match) {
    throw new Error(`invalid duration: ${value}`);
  }
  return Number.parseInt(match[1], 10);
}

function validCalendarDate(year, month, day, field, value) {
  const baseMs = Date.UTC(year, month - 1, day);
  const base = new Date(baseMs);
  if (
    base.getUTCFullYear() !== year ||
    base.getUTCMonth() !== month - 1 ||
    base.getUTCDate() !== day
  ) {
    throw new Error(`${field} must be a valid calendar date: ${value}`);
  }
  return baseMs;
}

function parseDateMs(value, field, options = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty date string`);
  }
  const raw = value.trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const isoDateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})[Tt]/);

  if (dateOnly) {
    const year = Number.parseInt(dateOnly[1], 10);
    const month = Number.parseInt(dateOnly[2], 10);
    const day = Number.parseInt(dateOnly[3], 10);
    const baseMs = validCalendarDate(year, month, day, field, raw);
    return options.dateOnlyEnd ? baseMs + DAY_MS : baseMs;
  }

  if (!isoDateTime) {
    throw new Error(`${field} must be YYYY-MM-DD or ISO-8601 date-time`);
  }

  validCalendarDate(
    Number.parseInt(isoDateTime[1], 10),
    Number.parseInt(isoDateTime[2], 10),
    Number.parseInt(isoDateTime[3], 10),
    field,
    raw,
  );
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    throw new Error(`${field} must be a valid date-time: ${raw}`);
  }
  return ms;
}

function requireString(record, field, sourceFile = '') {
  if (typeof record[field] !== 'string' || record[field].trim() === '') {
    const prefix = sourceFile ? `${sourceFile}: ` : '';
    throw new Error(`${prefix}${field} must be a non-empty string`);
  }
}

function harnessLevelRank(level) {
  const rank = HARNESS_LEVEL_ORDER.indexOf(level);
  if (rank === -1) {
    throw new Error(`unknown harness level: ${level}`);
  }
  return rank;
}

function validateRequiredLevel(level) {
  if (!HARNESS_LEVELS.has(level)) {
    throw new Error(`required_level must be one of ${HARNESS_LEVEL_ORDER.join(', ')}`);
  }
  return level;
}

function requiredCapabilitiesForLevel(level) {
  const rank = harnessLevelRank(level);
  const required = [];
  if (rank >= harnessLevelRank('H2')) required.push('read_only_dispatch');
  if (rank >= harnessLevelRank('H3')) required.push('mutation_dispatch');
  if (rank >= harnessLevelRank('H4')) required.push('blocking_gate');
  if (rank >= harnessLevelRank('H5')) required.push('maintenance_loop');
  return required;
}

function assertNoSecrets(value, field, sourceFile) {
  const hits = scan(value);
  if (hits.length > 0) {
    throw new Error(`${sourceFile}: ${field} contains secret-shaped value (${hits.map((hit) => hit.name).join(', ')})`);
  }
}

function redactStrings(value) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactStrings);
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = redactStrings(item);
    }
    return output;
  }
  return value;
}

function validateCapabilityRecord(record, sourceFile = '<memory>') {
  if (!isPlainObject(record)) {
    throw new Error(`${sourceFile}: capability record must be an object`);
  }
  assertNoSecrets(JSON.stringify(record), 'record', sourceFile);
  for (const field of Object.keys(record)) {
    if (!RECORD_FIELDS.has(field)) {
      throw new Error(`${sourceFile}: unknown field: ${field}`);
    }
  }

  for (const field of ['id', 'display_name', 'kind', 'status', 'harness_level', 'last_checked_at', 'expires_at']) {
    requireString(record, field, sourceFile);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(record.id)) {
    throw new Error(`${sourceFile}: id must be lowercase kebab-case`);
  }
  if (!STATUSES.has(record.status)) {
    throw new Error(`${sourceFile}: status must be one of ${[...STATUSES].join(', ')}`);
  }
  if (!HARNESS_LEVELS.has(record.harness_level)) {
    throw new Error(`${sourceFile}: harness_level must be one of ${[...HARNESS_LEVELS].join(', ')}`);
  }

  const lastCheckedMs = parseDateMs(record.last_checked_at, `${sourceFile}: last_checked_at`);
  const expiresMs = parseDateMs(record.expires_at, `${sourceFile}: expires_at`, { dateOnlyEnd: true });
  if (lastCheckedMs > expiresMs) {
    throw new Error(`${sourceFile}: last_checked_at must be <= expires_at`);
  }

  let verifiedAtMs = null;
  if (record.verified_at !== null && record.verified_at !== undefined) {
    verifiedAtMs = parseDateMs(record.verified_at, `${sourceFile}: verified_at`);
    if (verifiedAtMs > lastCheckedMs) {
      throw new Error(`${sourceFile}: verified_at must be <= last_checked_at`);
    }
  }
  if (record.status === 'verified' && verifiedAtMs === null) {
    throw new Error(`${sourceFile}: verified_at is required when status is verified`);
  }
  if (!isPlainObject(record.evidence)) {
    throw new Error(`${sourceFile}: evidence must be an object`);
  }
  for (const field of Object.keys(record.evidence)) {
    if (!EVIDENCE_FIELDS.has(field)) {
      throw new Error(`${sourceFile}: evidence unknown field: ${field}`);
    }
  }
  for (const field of ['source', 'command', 'result']) {
    requireString(record.evidence, field, `${sourceFile}: evidence`);
    assertNoSecrets(record.evidence[field], `evidence.${field}`, sourceFile);
  }
  if (!isPlainObject(record.capabilities)) {
    throw new Error(`${sourceFile}: capabilities must be an object`);
  }
  for (const [capability, value] of Object.entries(record.capabilities)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${sourceFile}: capabilities.${capability} must be a non-empty string`);
    }
    if (!CAPABILITY_VALUES.has(value)) {
      throw new Error(`${sourceFile}: capabilities.${capability} must be one of ${[...CAPABILITY_VALUES].join(', ')}`);
    }
  }

  if (record.auth_domains !== undefined) {
    if (!isPlainObject(record.auth_domains)) {
      throw new Error(`${sourceFile}: auth_domains must be an object when present`);
    }
    for (const [domain, value] of Object.entries(record.auth_domains)) {
      if (!AUTH_DOMAIN_KEY_RE.test(domain)) {
        throw new Error(`${sourceFile}: auth_domains key must be lowercase token: ${domain}`);
      }
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${sourceFile}: auth_domains.${domain} must be a non-empty string`);
      }
      if (!CAPABILITY_VALUES.has(value)) {
        throw new Error(`${sourceFile}: auth_domains.${domain} must be one of ${[...CAPABILITY_VALUES].join(', ')}`);
      }
    }
  }

  const levelRank = harnessLevelRank(record.harness_level);
  if (record.capabilities.mutation_dispatch === 'verified' && levelRank < harnessLevelRank('H3')) {
    throw new Error(`${sourceFile}: mutation_dispatch cannot be verified below H3`);
  }
  if (record.capabilities.blocking_gate === 'verified' && levelRank < harnessLevelRank('H4')) {
    throw new Error(`${sourceFile}: blocking_gate cannot be verified below H4`);
  }

  if (record.notes !== undefined && !Array.isArray(record.notes)) {
    throw new Error(`${sourceFile}: notes must be an array when present`);
  }
  if (record.notes) {
    record.notes.forEach((note, index) => {
      if (typeof note !== 'string' || note.trim() === '') {
        throw new Error(`${sourceFile}: notes.${index} must be a non-empty string`);
      }
      assertNoSecrets(note, `notes.${index}`, sourceFile);
    });
  }

  return record;
}

function resolveCapabilityDir(options = {}) {
  const hasOptionDir = Object.prototype.hasOwnProperty.call(options, 'dir');
  const hasEnvDir = Object.prototype.hasOwnProperty.call(process.env, 'AUTOPILOT_HARNESS_CAPABILITY_DIR');
  const dir = hasOptionDir
    ? options.dir
    : (hasEnvDir ? process.env.AUTOPILOT_HARNESS_CAPABILITY_DIR : DEFAULT_CAPABILITY_DIR);

  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new Error('capability directory must be a non-empty path');
  }
  return dir;
}

function listCapabilityFiles(dir = DEFAULT_CAPABILITY_DIR) {
  if (!fs.existsSync(dir)) {
    throw new Error(`capability directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
  if (files.length === 0) {
    throw new Error(`capability directory has no JSON records: ${dir}`);
  }
  return files;
}

function loadCapabilityRecords(options = {}) {
  const dir = resolveCapabilityDir(options);
  const records = listCapabilityFiles(dir).map((file) => {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
    const record = validateCapabilityRecord(parsed, file);
    return {
      ...record,
      source_file: path.relative(REPO_ROOT, file),
    };
  });

  const seen = new Map();
  for (const record of records) {
    if (seen.has(record.id)) {
      throw new Error(`duplicate capability id "${record.id}" in ${record.source_file} and ${seen.get(record.id)}`);
    }
    seen.set(record.id, record.source_file);
  }
  return records;
}

function summarizeRecords(records) {
  const summary = {
    total: records.length,
    verified: 0,
    warning: 0,
    unverified: 0,
    unavailable: 0,
    stale: 0,
    ready: 0,
    not_ready: 0,
    attention: 0,
  };
  for (const record of records) {
    if (Object.prototype.hasOwnProperty.call(summary, record.status)) {
      summary[record.status] += 1;
    }
    if (record.stale) summary.stale += 1;
    if (record.ready_for_required_level) {
      summary.ready += 1;
    } else {
      summary.not_ready += 1;
    }
    if (record.needs_attention) summary.attention += 1;
  }
  return summary;
}

function buildCapabilityReport(options = {}) {
  const staleAfterValue = Object.prototype.hasOwnProperty.call(options, 'staleAfter')
    ? options.staleAfter
    : (Object.prototype.hasOwnProperty.call(options, 'staleAfterDays') ? options.staleAfterDays : '14d');
  const staleAfterDays = parseDurationDays(staleAfterValue);
  const requiredLevel = validateRequiredLevel(Object.prototype.hasOwnProperty.call(options, 'requiredLevel') ? options.requiredLevel : 'H3');
  const nowValue = Object.prototype.hasOwnProperty.call(options, 'now')
    ? options.now
    : (Object.prototype.hasOwnProperty.call(process.env, 'AUTOPILOT_HARNESS_NOW') ? process.env.AUTOPILOT_HARNESS_NOW : new Date().toISOString());
  const nowMs = parseDateMs(nowValue, 'now');
  const generatedAt = new Date(nowMs).toISOString();
  const capabilityDir = resolveCapabilityDir(options);
  const rawRecords = loadCapabilityRecords({ dir: capabilityDir });

  const records = rawRecords.map((record) => {
    const lastCheckedMs = parseDateMs(record.last_checked_at, `${record.id}: last_checked_at`);
    const expiresMs = parseDateMs(record.expires_at, `${record.id}: expires_at`, { dateOnlyEnd: true });
    const verifiedAtMs = record.verified_at ? parseDateMs(record.verified_at, `${record.id}: verified_at`) : null;
    const ageDays = lastCheckedMs > nowMs ? 0 : Math.floor((nowMs - lastCheckedMs) / DAY_MS);
    const staleReasons = [];
    const readinessReasons = [];

    if (record.status !== 'verified') {
      staleReasons.push(`status:${record.status}`);
    }
    if (nowMs >= expiresMs) staleReasons.push('ttl_expired');
    if (ageDays >= staleAfterDays) staleReasons.push(`older_than_${staleAfterDays}d`);
    if (lastCheckedMs > nowMs) staleReasons.push('last_checked_in_future');
    if (verifiedAtMs !== null && verifiedAtMs > nowMs) staleReasons.push('verified_at_in_future');

    if (harnessLevelRank(record.harness_level) < harnessLevelRank(requiredLevel)) {
      readinessReasons.push(`level_below_${requiredLevel}`);
    }
    for (const capability of requiredCapabilitiesForLevel(requiredLevel)) {
      if (record.capabilities[capability] !== 'verified') {
        readinessReasons.push(`${capability}_not_verified`);
      }
    }

    const stale = staleReasons.length > 0;
    for (const reason of staleReasons) {
      readinessReasons.push(reason);
    }
    const readyForRequiredLevel = readinessReasons.length === 0;

    return {
      ...redactStrings(record),
      age_days: ageDays,
      stale_after_days: staleAfterDays,
      required_level: requiredLevel,
      stale,
      stale_reasons: staleReasons,
      ready_for_required_level: readyForRequiredLevel,
      readiness_reasons: readinessReasons,
      needs_attention: stale || !readyForRequiredLevel,
    };
  });

  return {
    generated_at: generatedAt,
    stale_after_days: staleAfterDays,
    required_level: requiredLevel,
    capability_dir: path.relative(REPO_ROOT, capabilityDir),
    summary: summarizeRecords(records),
    records,
  };
}

function formatWarning(report, options = {}) {
  const limit = Number.isInteger(options.limit) ? options.limit : 5;
  const attention = report.records.filter((record) => record.needs_attention);
  if (attention.length === 0) {
    return `AUTOPILOT_HARNESS_OK no stale or ${report.required_level}-unready harness capability records\n`;
  }

  const lines = [
    `AUTOPILOT_HARNESS_ATTENTION count=${attention.length} stale_after_days=${report.stale_after_days} required_level=${report.required_level}`,
  ];
  for (const record of attention.slice(0, limit)) {
    const reasons = [...new Set([...record.stale_reasons, ...record.readiness_reasons])];
    lines.push(`- ${record.id}: ${reasons.join(', ')}; last_checked=${record.last_checked_at}; level=${record.harness_level}`);
  }
  if (attention.length > limit) {
    lines.push(`- ... ${attention.length - limit} more`);
  }
  lines.push('Run a harness survey/spike before H3+ dispatch, gating, or hook changes.');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  DEFAULT_CAPABILITY_DIR,
  buildCapabilityReport,
  formatWarning,
  listCapabilityFiles,
  loadCapabilityRecords,
  parseDurationDays,
  requiredCapabilitiesForLevel,
  resolveCapabilityDir,
  validateRequiredLevel,
  validateCapabilityRecord,
};
