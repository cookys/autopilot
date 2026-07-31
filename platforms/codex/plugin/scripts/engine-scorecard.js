#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const transcriptSecrets = require('../hooks/_shared/secret-patterns');
const { expandTilde, ensureDir, sleepMs, acquireLock, releaseLock, withWriteLock, appendRow, toEventId, maxEventId } = require('./lib/jsonl-store');
const {
  buildCapabilityEvidenceReceipt,
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
} = require('../src/engine/capability-evidence');
const {
  ROLE_IDS,
  normalizeRole,
} = require('../src/engine/roles');
const {
  validateEvidenceProducer,
} = require('./engine-capability-state');

const VALID_ROLES = new Set(ROLE_IDS);
const LADDER_ROLES = new Set(['reviewer', 'implementer', 'owner']);
const VALID_VERSION_SOURCES = new Set(['runtime', 'manual']);
const VALID_STATUSES = new Set(['qualified', 'failed', 'expired']);
const VALID_COST_SOURCES = new Set(['measured', 'manual', 'unknown']);
const TRANSCRIPT_PROVIDERS = new Set(['codex', 'grok', 'opencode', 'agy']);
const TRANSCRIPT_EXTENSIONS = new Set(['.json', '.jsonl', '.ndjson']);
const MAX_TRANSCRIPT_FILES = 10000;
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

const REQUIRED_FIELDS = [
  'engine',
  'runner',
  'family',
  'role',
  'model_version',
  'version_source',
  'corpus_version',
  'harness_version',
  'runner_version',
  'prompt_config_hash',
  'date',
  'quality',
  'capability_score',
  'cost',
  'latency',
  'status',
  'qualified_at',
  'expires',
];

const CONFIGURED_IDENTITY_FIELDS = [
  'engine',
  'runner',
  'role',
  'corpus_version',
  'harness_version',
  'runner_version',
  'prompt_config_hash',
];

const HELP_TEXT = `Usage:\n\
  node scripts/engine-scorecard.js record [--file <path>]\n\
  node scripts/engine-scorecard.js current --role <role> [--now <ISO-date>] [--require-evidence] [--scope-file <path>] [--identity-file <path>]\n\
  node scripts/engine-scorecard.js report --role <role> [--key capability|cost] [--now <ISO-date>] [--require-evidence] [--scope-file <path>]\n\
  node scripts/engine-scorecard.js ladder --role <reviewer|implementer|owner> [--implementer-family <family>] [--now <ISO-date>] [--require-evidence] [--scope-file <path>]\n\
  node scripts/engine-scorecard.js import-transcripts --root <codex|grok|opencode|agy>=<path> [--root ...] [--output <path>]\n\
\n  --file <path>  Read one JSON row from this file.\n\
  --role is required for current/report/ladder.\n\
  --key accepts capability (default) or cost.\n\
  --now accepts ISO date; used by current/report/ladder for deterministic TTL checks.\n\
  All disk-backed views are untrusted telemetry: stored qualified rows are projected\n\
    as provisional and report/ladder cannot produce a routing candidate.\n\
  --require-evidence additionally excludes legacy rows and requires --scope-file.\n\
  --scope-file and --identity-file constrain lifecycle evidence to an exact applicability query.\n\
  --implementer-family is optional; if provided, ladder demotes matching family entries.\n\
  verification_author/explorer rows are evidence-only in v1; use current/report, not ladder.\n\
  import-transcripts requires explicit roots and emits aggregate-only, untrusted telemetry;\n\
    it never appends scorecard rows. --output atomically writes the same JSON printed to stdout.\n\
\nExit codes:\n\
  0 = success\n\
  1 = validation error\n\
  2 = usage error / unknown command\n`;

function usage(code) {
  console.log(HELP_TEXT);
  process.exit(code);
}

function failValidation(message) {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function failUsage(message = null) {
  if (message) process.stderr.write(`ERROR: ${message}\n`);
  usage(2);
}

function isHelpToken(token) {
  return token === '-h' || token === '--help' || token === 'help';
}

const SCORECARD_DIR = path.resolve(
  expandTilde(process.env.ENGINE_SCORECARD_DIR || path.join('~', '.autopilot', 'engine-scorecard')),
);
const SCORECARD_FILE = path.join(SCORECARD_DIR, 'scorecard.jsonl');
const LOCK_FILE = path.join(SCORECARD_DIR, '.lock');
const CAPABILITY_DIR = process.env.ENGINE_CAPABILITY_DIR
  ? path.resolve(expandTilde(process.env.ENGINE_CAPABILITY_DIR))
  : process.env.ENGINE_CAPABILITY_FILE
    ? path.dirname(path.resolve(expandTilde(process.env.ENGINE_CAPABILITY_FILE)))
    : path.resolve(expandTilde(path.join('~', '.autopilot', 'engine-capability')));
const CAPABILITY_EVIDENCE_FILE = path.join(CAPABILITY_DIR, 'qualification-evidence.jsonl');

function readTextLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function warnMalformedLine(lineNo, message) {
  process.stderr.write(`WARN: malformed scorecard line ${lineNo}: ${message}\n`);
}

function parseJsonObject(raw, context) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    failValidation(`${context}: invalid JSON (${err.message})`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failValidation(`${context}: expected a JSON object`);
  }
  return parsed;
}

function readStoreRows(silentWarn = false, strict = false) {
  const lines = readTextLines(SCORECARD_FILE);
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        if (strict) throw new Error('not an object');
        if (!silentWarn) warnMalformedLine(i + 1, 'not an object');
        continue;
      }
      rows.push(row);
    } catch (err) {
      if (strict) {
        failValidation(`malformed evidence-required scorecard line ${i + 1}: ${err.message}`);
      }
      if (!silentWarn) warnMalformedLine(i + 1, err.message);
    }
  }

  return rows;
}

function toDateMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' && !value.includes('T')
    ? `${value}T00:00:00Z`
    : String(value);
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function todayMsUtc() {
  return toDateMs(new Date().toISOString().slice(0, 10)) || Date.now();
}

function nowArgToMs(value, required = false) {
  const ms = toDateMs(value);
  if (value === undefined || value === null || value === '') {
    return required ? failValidation('missing --now value') : todayMsUtc();
  }
  if (ms === null) failUsage(`invalid --now date: ${value}`);
  return ms;
}

function identityKey(row) {
  // Invocation-tuple extension (v2.32.25 R1): effort/model are OPTIONAL row fields
  // but distinct values are distinct qualifications (gpt-X@high and gpt-X@xhigh
  // must not collapse to the latest event). They join the KEY (undefined → '')
  // without joining the required-field check — most rows legitimately omit them.
  const tupleExt = ['effort', 'model']
    .map((name) => (row && row[name] !== undefined ? String(row[name]) : ''));
  return CONFIGURED_IDENTITY_FIELDS
    .map((name) => (row && row[name] !== undefined ? String(row[name]) : ''))
    .concat(tupleExt)
    .concat([
      row && row.evidence ? String(row.evidence.scope_hash || '') : '',
      row && row.evidence ? String(row.evidence.identity_hash || '') : '',
    ])
    .join('\u0000');
}

function identityFieldMissing(row) {
  for (const field of CONFIGURED_IDENTITY_FIELDS) {
    if (row[field] === undefined) return field;
  }
  return null;
}

function validateRecordRow(row) {
  const missing = REQUIRED_FIELDS.filter((field) => row[field] === undefined);
  if (missing.length > 0) {
    failValidation(`missing required field(s): ${missing.join(', ')}`);
  }

  if (typeof row.engine !== 'string' || row.engine.trim().length === 0) {
    failValidation('engine must be a non-empty string');
  }

  const canonicalRole = normalizeRole(row.role, { allowLegacy: true });
  if (!canonicalRole) {
    failValidation(`invalid role '${row.role}'`);
  }
  row.role = canonicalRole;

  if (!VALID_VERSION_SOURCES.has(row.version_source)) {
    failValidation(`invalid version_source '${row.version_source}'`);
  }

  // OPTIONAL effort (v2.32.25, family-conflict fallback): when present it names the
  // calibrated reasoning effort of this row's invocation tuple. Only codex-runner
  // consumers require it; absent = "not effort-calibrated" (ladder projects null).
  if (row.effort !== undefined
      && !['low', 'medium', 'high', 'xhigh', 'max'].includes(row.effort)) {
    failValidation(`invalid effort '${row.effort}' (low|medium|high|xhigh|max or omit)`);
  }

  // OPTIONAL model (v2.32.25): the exact --model string for this row's runner when
  // the engine id is a display id rather than a dispatchable model (e.g. engine
  // "claude-haiku" dispatches as claude-native --model "haiku"). Absent = engine id
  // IS the dispatch string.
  if (row.model !== undefined
      && (typeof row.model !== 'string' || row.model.trim().length === 0)) {
    failValidation('model must be a non-empty string when present');
  }

  if (!VALID_STATUSES.has(row.status)) {
    failValidation(`invalid status '${row.status}'`);
  }

  if (!row.cost || typeof row.cost !== 'object' || Array.isArray(row.cost)) {
    failValidation('cost must be an object');
  }

  if (!VALID_COST_SOURCES.has(row.cost.source)) {
    failValidation(`invalid cost.source '${row.cost.source}'`);
  }

  if (row.evidence !== undefined) {
    let evidence;
    try {
      evidence = compileCapabilityEvidence(row.evidence);
    } catch (error) {
      failValidation(`invalid capability evidence: ${error.message}`);
    }
    const identity = evidence.identity;
    const expectedModel = row.model === undefined ? row.engine : row.model;
    const bindings = [
      ['engine', row.engine, identity.model_alias],
      ['runner', row.runner, identity.runner],
      ['family', row.family, identity.family],
      ['model', expectedModel, identity.identity],
      ['model_version', row.model_version, identity.model_version],
      ['runner_version', row.runner_version, identity.runner_version],
      ['harness_version', row.harness_version, identity.harness_version],
      ['prompt_config_hash', row.prompt_config_hash, identity.prompt_config_hash],
      ['effort', row.effort, identity.effort],
      ['role', row.role, evidence.role],
      ['corpus_version', row.corpus_version, evidence.methodology.corpus_version],
    ];
    for (const [field, actual, expected] of bindings) {
      if (actual !== expected) {
        failValidation(`scorecard ${field} does not match capability evidence`);
      }
    }
    const evidenceStatus = evidence.state === 'qualified'
      ? 'qualified' : evidence.state === 'stale' ? 'expired' : 'failed';
    if (row.status !== evidenceStatus) {
      failValidation(`scorecard status does not match capability evidence state '${evidence.state}'`);
    }
    if (row.qualified_at !== evidence.issued_at.slice(0, 10)
        || row.expires !== evidence.expires_at.slice(0, 10)) {
      failValidation('scorecard qualification dates do not match capability evidence');
    }
    row.evidence = evidence;
    if (evidence.source === 'internal_eval') {
      verifyEvidenceStoreAnchor(row, readCapabilityEvidenceRows());
    }
  }
}

function readCapabilityEvidenceRows() {
  const lines = readTextLines(CAPABILITY_EVIDENCE_FILE);
  return lines.map((line, index) => {
    let wrapper;
    try {
      wrapper = JSON.parse(line);
    } catch (error) {
      failValidation(`malformed capability evidence line ${index + 1}: ${error.message}`);
    }
    if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)
        || toEventId(wrapper.event_id) === null
        || typeof wrapper.producer !== 'string'
        || typeof wrapper.transcript_hash !== 'string' || !wrapper.evidence) {
      failValidation(`malformed capability evidence line ${index + 1}: invalid wrapper`);
    }
    let evidence;
    try {
      evidence = compileCapabilityEvidence(wrapper.evidence);
    } catch (error) {
      failValidation(`malformed capability evidence line ${index + 1}: ${error.message}`);
    }
    if (wrapper.transcript_hash !== capabilityEvidenceProducerHash(
      evidence,
      wrapper.producer,
    )) {
      failValidation(`malformed capability evidence line ${index + 1}: producer mismatch`);
    }
    try {
      validateEvidenceProducer(evidence, wrapper.producer);
    } catch (error) {
      failValidation(
        `malformed capability evidence line ${index + 1}: producer mismatch (${error.message})`,
      );
    }
    return {
      event_id: toEventId(wrapper.event_id),
      producer: wrapper.producer,
      transcript_hash: wrapper.transcript_hash,
      evidence,
    };
  });
}

function verifyEvidenceStoreAnchor(row, capabilityRows) {
  const anchor = row.evidence_store;
  if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)
      || Object.keys(anchor).sort().join(',') !== 'event_id,producer,transcript_hash'
      || toEventId(anchor.event_id) === null
      || anchor.producer !== 'engine-qualify-v2'
      || typeof anchor.transcript_hash !== 'string') {
    failValidation('internal evaluation scorecard row lacks a qualifier store anchor');
  }
  const match = capabilityRows.find(
    (wrapper) => wrapper.event_id === toEventId(anchor.event_id),
  );
  if (!match || match.producer !== anchor.producer
      || match.transcript_hash !== anchor.transcript_hash || !match.evidence) {
    failValidation('scorecard qualifier store anchor is missing or mismatched');
  }
  const storedEvidence = match.evidence;
  if (storedEvidence.evidence_id !== row.evidence.evidence_id
      || match.transcript_hash !== capabilityEvidenceProducerHash(
        storedEvidence,
        match.producer,
      )) {
    failValidation('scorecard qualifier store anchor does not bind the evidence');
  }
}

function readEvidenceQueryFile(filePath, label) {
  return parseJsonObject(fs.readFileSync(filePath, 'utf8'), label);
}

function parseCurrentArgs(args) {
  let role = null;
  let now;
  let requireEvidence = false;
  let scope = null;
  let identity = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--now') {
      if (i + 1 >= args.length) failUsage('--now requires a value');
      now = args[++i];
      continue;
    }
    if (arg === '--require-evidence') {
      requireEvidence = true;
      continue;
    }
    if (arg === '--scope-file' || arg === '--identity-file') {
      if (i + 1 >= args.length) failUsage(`${arg} requires a value`);
      const parsed = readEvidenceQueryFile(args[++i], arg.slice(2));
      if (arg === '--scope-file') scope = parsed;
      else identity = parsed;
      requireEvidence = true;
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  const requestedRole = role;
  role = normalizeRole(role, { allowLegacy: true });
  if (!role) failUsage(`invalid role '${requestedRole}'`);
  if (requireEvidence && !scope) {
    failUsage('--require-evidence or --identity-file requires --scope-file');
  }

  const nowMs = now === undefined
    ? (requireEvidence ? Date.now() : todayMsUtc())
    : nowArgToMs(now, false);

  return { role, nowMs, requireEvidence, scope, identity };
}

function parseReportArgs(args) {
  let role = null;
  let key = 'capability';
  let requireEvidence = false;
  let scope = null;
  let identity = null;
  let now;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--key') {
      if (i + 1 >= args.length) failUsage('--key requires a value');
      key = args[++i];
      continue;
    }
    if (arg === '--now') {
      if (i + 1 >= args.length) failUsage('--now requires a value');
      now = args[++i];
      continue;
    }
    if (arg === '--require-evidence') {
      requireEvidence = true;
      continue;
    }
    if (arg === '--scope-file' || arg === '--identity-file') {
      if (i + 1 >= args.length) failUsage(`${arg} requires a value`);
      const parsed = readEvidenceQueryFile(args[++i], arg.slice(2));
      if (arg === '--scope-file') scope = parsed;
      else identity = parsed;
      requireEvidence = true;
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  const requestedRole = role;
  role = normalizeRole(role, { allowLegacy: true });
  if (!role) failUsage(`invalid role '${requestedRole}'`);
  if (key !== 'capability' && key !== 'cost') failUsage(`invalid --key '${key}'`);
  if (requireEvidence && !scope) {
    failUsage('--require-evidence or --identity-file requires --scope-file');
  }

  const nowMs = now === undefined
    ? (requireEvidence ? Date.now() : todayMsUtc())
    : nowArgToMs(now, false);
  return {
    role,
    key,
    nowMs,
    requireEvidence,
    scope,
    identity,
  };
}

function parseLadderArgs(args) {
  let role = null;
  let implementerFamily = null;
  let requireEvidence = false;
  let scope = null;
  let identity = null;
  let now;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--role') {
      if (i + 1 >= args.length) failUsage('--role requires a value');
      role = args[++i];
      continue;
    }

    if (arg === '--implementer-family') {
      if (i + 1 >= args.length) failUsage('--implementer-family requires a value');
      implementerFamily = args[++i];
      continue;
    }
    if (arg === '--now') {
      if (i + 1 >= args.length) failUsage('--now requires a value');
      now = args[++i];
      continue;
    }
    if (arg === '--require-evidence') {
      requireEvidence = true;
      continue;
    }
    if (arg === '--scope-file' || arg === '--identity-file') {
      if (i + 1 >= args.length) failUsage(`${arg} requires a value`);
      const parsed = readEvidenceQueryFile(args[++i], arg.slice(2));
      if (arg === '--scope-file') scope = parsed;
      else identity = parsed;
      requireEvidence = true;
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  if (!role) failUsage('--role is required');
  const requestedRole = role;
  role = normalizeRole(role, { allowLegacy: true });
  if (!role) failUsage(`invalid role '${requestedRole}'`);
  if (!LADDER_ROLES.has(role)) {
    failUsage(`ladder is not enabled for evidence-only role '${role}'; use report`);
  }
  if (requireEvidence && !scope) {
    failUsage('--require-evidence or --identity-file requires --scope-file');
  }

  return {
    role,
    implementerFamily,
    nowMs: now === undefined
      ? (requireEvidence ? Date.now() : todayMsUtc())
      : nowArgToMs(now, false),
    requireEvidence,
    scope,
    identity,
  };
}

function parseRecordArgs(args) {
  let file = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--file') {
      if (i + 1 >= args.length) failUsage('--file requires a path');
      file = args[++i];
      continue;
    }

    failUsage(`unknown option: ${arg}`);
  }

  return { file };
}

function physicalPathWithMissingTail(target) {
  const suffix = [];
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(fs.realpathSync(existing), ...suffix);
}

function isSameOrDescendant(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === ''
    || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

function outputOverlapsTranscriptRoot(output, root) {
  const outputPaths = new Set([output, physicalPathWithMissingTail(output)]);
  const rootPaths = new Set([root, physicalPathWithMissingTail(root)]);
  return [...outputPaths].some((candidate) => (
    [...rootPaths].some((boundary) => isSameOrDescendant(candidate, boundary))
  ));
}

function parseTranscriptImportArgs(args) {
  const roots = [];
  let output = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);
    if (arg === '--root') {
      if (i + 1 >= args.length) failUsage('--root requires provider=path');
      const spec = args[++i];
      const separator = spec.indexOf('=');
      if (separator <= 0 || separator === spec.length - 1) {
        failUsage('--root requires provider=path');
      }
      const provider = spec.slice(0, separator).toLowerCase();
      if (!TRANSCRIPT_PROVIDERS.has(provider)) {
        failUsage(`unsupported transcript provider '${provider}'`);
      }
      const root = path.resolve(expandTilde(spec.slice(separator + 1)));
      roots.push({ provider, root });
      continue;
    }
    if (arg === '--output') {
      if (i + 1 >= args.length) failUsage('--output requires a path');
      output = path.resolve(expandTilde(args[++i]));
      continue;
    }
    failUsage(`unknown option: ${arg}`);
  }
  if (roots.length === 0) failUsage('import-transcripts requires at least one explicit --root');
  const unique = new Map();
  for (const spec of roots) unique.set(`${spec.provider}\0${spec.root}`, spec);
  const sortedRoots = [...unique.values()]
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.root.localeCompare(b.root));
  if (output && sortedRoots.some(({ root }) => outputOverlapsTranscriptRoot(output, root))) {
    failUsage('--output must be outside transcript roots');
  }
  return { roots: sortedRoots, output };
}

function transcriptFiles(root) {
  if (!fs.existsSync(root)) failValidation('transcript root does not exist');
  const result = [];
  const visit = (target) => {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isFile()) {
      if (TRANSCRIPT_EXTENSIONS.has(path.extname(target).toLowerCase())) result.push(target);
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = fs.readdirSync(target, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      visit(path.join(target, entry.name));
      if (result.length > MAX_TRANSCRIPT_FILES) {
        failValidation(`transcript root exceeds ${MAX_TRANSCRIPT_FILES} supported files`);
      }
    }
  };
  visit(root);
  return result;
}

function parseTranscriptFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TRANSCRIPT_BYTES) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    if (path.extname(file).toLowerCase() === '.json') return JSON.parse(raw);
    const rows = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (rows.length === 0) return null;
    return rows.map((line) => JSON.parse(line));
  } catch {
    return null;
  }
}

function safeEngineName(provider, value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const looksLikeSessionId = /^sess(?:ion)?[_-][A-Za-z0-9][A-Za-z0-9_-]{7,}$/i.test(normalized)
    || /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(normalized);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+()/ -]{0,119}$/.test(normalized)
      || /(?:secret|token|password|bearer|api[_ -]?key|credential)/i.test(normalized)
      || looksLikeSessionId
      || transcriptSecrets.scan(normalized).length > 0
      || normalized.includes('/') || normalized.includes('\\')) return null;
  const compactSuffix = '[A-Za-z0-9][A-Za-z0-9._-]*';
  const providerPatterns = {
    codex: new RegExp(`^(?:gpt-|codex-)${compactSuffix}$|^o[0-9]+(?:[._-]${compactSuffix})*$`, 'i'),
    grok: new RegExp(`^grok-${compactSuffix}$`, 'i'),
    opencode: new RegExp(
      `^(?:(?:glm|qwen|minimax|claude|gpt|gemini|deepseek|kimi|grok)-${compactSuffix}`
        + `|o[0-9]+(?:[._-]${compactSuffix})*)$`,
      'i',
    ),
    agy: /^Gemini [0-9]+(?:\.[0-9]+)* (?:Flash|Pro)(?: \((?:Low|Medium|High)\))?$/i,
  };
  return providerPatterns[provider]?.test(normalized) ? normalized : null;
}

function nonEmptyContent(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(nonEmptyContent);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(nonEmptyContent);
}

function finiteMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function transcriptObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function hasDirectField(obj, fields) {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(obj, field));
}

function recognizedTranscriptSchema(provider, parsed) {
  if (provider === 'codex') {
    const records = Array.isArray(parsed) ? parsed : [parsed];
    return records.some((value) => {
      const record = transcriptObject(value);
      if (!record) return false;
      const type = String(record.type || '').toLowerCase();
      const payload = transcriptObject(record.payload);
      if (type === 'session_meta') return payload !== null;
      if (type === 'turn.completed' || type === 'turn.failed') return true;
      if (type === 'event_msg') {
        return payload !== null && String(payload.type || '').toLowerCase() === 'token_count';
      }
      if (type !== 'response_item' || !payload) return false;
      const payloadType = String(payload.type || '').toLowerCase();
      return payloadType === 'message'
        || /^(?:tool|function_call)(?:[._-](?:output|result))?$/.test(payloadType);
    });
  }

  const root = transcriptObject(parsed);
  if (!root) return false;
  const commonFields = [
    'status', 'state', 'completed', 'success', 'usage', 'cost_usd', 'costUSD',
    'tool', 'tool_status', 'tool_state', 'tool_exit_code', 'finish_reason',
    'stop_reason', 'truncated',
  ];
  const providerFields = {
    grok: ['model', 'response_text'],
    opencode: ['modelID', 'messages'],
    agy: ['model', 'output_text'],
  };
  return hasDirectField(root, [...commonFields, ...(providerFields[provider] || [])]);
}

function directCompletion(obj) {
  if (!obj) return null;
  if (typeof obj.completed === 'boolean') return obj.completed;
  if (typeof obj.success === 'boolean') return obj.success;
  const status = String(obj.status || obj.state || '').toLowerCase();
  if (['completed', 'complete', 'success', 'succeeded', 'ok'].includes(status)) return true;
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return false;
  return null;
}

function directTruncation(obj) {
  if (!obj) return false;
  const finishReason = String(obj.finish_reason || obj.stop_reason || '').toLowerCase();
  return obj.truncated === true
    || ['length', 'max_tokens', 'token_limit'].includes(finishReason);
}

function directToolFailure(obj) {
  if (!obj) return false;
  const tool = transcriptObject(obj.tool);
  const status = String(
    (tool && (tool.status || tool.state)) || obj.tool_status || obj.tool_state || '',
  ).toLowerCase();
  const exitCode = tool
    ? finiteMetric(tool.exit_code)
    : finiteMetric(obj.tool_exit_code);
  return ['failed', 'error'].includes(status) || (exitCode !== null && exitCode > 0);
}

function emptyUsageAccumulator() {
  return {
    input: 0,
    output: 0,
    total: 0,
    cost: 0,
    inputSeen: false,
    outputSeen: false,
    totalSeen: false,
    costSeen: false,
  };
}

function addRecognizedUsage(accumulator, value) {
  const usage = transcriptObject(value);
  if (!usage) return;
  const input = finiteMetric(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens);
  const output = finiteMetric(
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens,
  );
  const total = finiteMetric(usage.total_tokens ?? usage.totalTokens);
  const cost = finiteMetric(usage.cost_usd ?? usage.costUSD);
  if (input !== null) { accumulator.input += input; accumulator.inputSeen = true; }
  if (output !== null) { accumulator.output += output; accumulator.outputSeen = true; }
  if (total !== null) { accumulator.total += total; accumulator.totalSeen = true; }
  if (cost !== null) { accumulator.cost += cost; accumulator.costSeen = true; }
}

function inspectCodexTranscript(parsed) {
  const result = {
    engine: 'unknown',
    completion: null,
    hasOutput: false,
    toolFailure: false,
    truncated: false,
    usage: emptyUsageAccumulator(),
  };
  const records = Array.isArray(parsed) ? parsed : [parsed];
  for (const value of records) {
    const record = transcriptObject(value);
    if (!record) continue;
    const type = String(record.type || '').toLowerCase();
    const payload = transcriptObject(record.payload);
    if (type === 'session_meta' && payload && result.engine === 'unknown') {
      result.engine = safeEngineName('codex', payload.model) || 'unknown';
    } else if (type === 'response_item' && payload) {
      const payloadType = String(payload.type || '').toLowerCase();
      if (payloadType === 'message' && String(payload.role || '').toLowerCase() === 'assistant') {
        result.hasOutput = result.hasOutput || nonEmptyContent(payload.content);
      }
      if (/^(?:tool|function_call)(?:[._-](?:output|result))?$/.test(payloadType)) {
        const status = String(payload.status || payload.state || '').toLowerCase();
        const exitCode = finiteMetric(payload.exit_code);
        if (['failed', 'error'].includes(status) || (exitCode !== null && exitCode > 0)) {
          result.toolFailure = true;
        }
      }
    } else if (type === 'event_msg' && payload
        && String(payload.type || '').toLowerCase() === 'token_count') {
      const info = transcriptObject(payload.info);
      addRecognizedUsage(result.usage, info && info.last_token_usage);
    } else if (type === 'turn.completed') {
      result.completion = true;
    } else if (type === 'turn.failed') {
      result.completion = false;
    }
  }
  return result;
}

function inspectRootTranscript(provider, parsed) {
  const root = transcriptObject(parsed);
  const result = {
    engine: 'unknown',
    completion: null,
    hasOutput: false,
    toolFailure: false,
    truncated: false,
    usage: emptyUsageAccumulator(),
  };
  if (!root) return result;
  result.engine = safeEngineName(
    provider,
    provider === 'opencode' ? root.modelID : root.model,
  ) || 'unknown';
  result.completion = directCompletion(root);
  result.toolFailure = directToolFailure(root);
  result.truncated = directTruncation(root);
  if (provider === 'grok') {
    result.hasOutput = nonEmptyContent(root.response_text);
  } else if (provider === 'opencode') {
    if (Array.isArray(root.messages)) {
      result.hasOutput = root.messages.some((value) => {
        const message = transcriptObject(value);
        return message && String(message.role || '').toLowerCase() === 'assistant'
          && nonEmptyContent(message.content);
      });
    }
  } else if (provider === 'agy') {
    result.hasOutput = nonEmptyContent(root.output_text);
  }
  if (provider !== 'agy') {
    addRecognizedUsage(result.usage, root.usage);
    if (!result.usage.costSeen) {
      const rootCost = finiteMetric(root.cost_usd ?? root.costUSD);
      if (rootCost !== null) {
        result.usage.cost += rootCost;
        result.usage.costSeen = true;
      }
    }
  }
  return result;
}

function inspectTranscript(provider, parsed, file, rootHasCalibrationComponent) {
  const inspected = provider === 'codex'
    ? inspectCodexTranscript(parsed)
    : inspectRootTranscript(provider, parsed);

  const pathParts = file.split(path.sep).map((part) => part.toLowerCase());
  let cohort = 'general';
  if (provider === 'opencode' && (rootHasCalibrationComponent
      || pathParts.some((part) => part === 'swe-calibrate'))) {
    cohort = 'swe-calibrate';
  }
  if (inspected.completion === null) inspected.completion = inspected.hasOutput;
  const usage = inspected.usage;
  return {
    provider,
    engine: inspected.engine,
    cohort,
    completed: inspected.completion,
    zeroOutput: !inspected.hasOutput,
    toolFailure: inspected.toolFailure,
    truncated: inspected.truncated,
    tokens: provider === 'agy' ? null : {
      input: usage.inputSeen ? usage.input : null,
      output: usage.outputSeen ? usage.output : null,
      total: usage.totalSeen ? usage.total : null,
    },
    costUsd: provider === 'agy' || !usage.costSeen ? null : usage.cost,
  };
}

function rate(count, total) {
  return total === 0 ? null : Number((count / total).toFixed(6));
}

function aggregateTranscriptSessions(sessions) {
  const grouped = new Map();
  for (const session of sessions) {
    const key = `${session.provider}\0${session.engine}\0${session.cohort}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) => {
      const first = rows[0];
      const tokenRows = rows.filter((row) => row.tokens
        && Object.values(row.tokens).some((value) => value !== null));
      const costRows = rows.filter((row) => row.costUsd !== null);
      const tokens = first.provider === 'agy'
        ? { availability: 'unavailable', reason: 'agy_schema_not_exposed' }
        : tokenRows.length === 0
          ? { availability: 'unavailable', reason: 'source_metric_absent' }
          : {
            availability: 'available',
            observed_samples: tokenRows.length,
            input_tokens_total: tokenRows.some((row) => row.tokens.input !== null)
              ? tokenRows.reduce((sum, row) => sum + (row.tokens.input || 0), 0) : null,
            output_tokens_total: tokenRows.some((row) => row.tokens.output !== null)
              ? tokenRows.reduce((sum, row) => sum + (row.tokens.output || 0), 0) : null,
            total_tokens: tokenRows.some((row) => row.tokens.total !== null)
              ? tokenRows.reduce((sum, row) => sum + (row.tokens.total || 0), 0) : null,
          };
      const cost = first.provider === 'agy'
        ? { availability: 'unavailable', reason: 'agy_schema_not_exposed' }
        : costRows.length === 0
          ? { availability: 'unavailable', reason: 'source_metric_absent' }
          : {
            availability: 'available',
            observed_samples: costRows.length,
            usd_total: Number(costRows.reduce((sum, row) => sum + row.costUsd, 0).toFixed(8)),
          };
      return {
        provider: first.provider,
        engine: first.engine,
        cohort: first.cohort,
        sample_size: rows.length,
        completion_rate: rate(rows.filter((row) => row.completed).length, rows.length),
        zero_output_rate: rate(rows.filter((row) => row.zeroOutput).length, rows.length),
        tool_failure_rate: rate(rows.filter((row) => row.toolFailure).length, rows.length),
        truncation_rate: rate(rows.filter((row) => row.truncated).length, rows.length),
        tokens,
        cost,
      };
    });
}

function cmdImportTranscripts(args) {
  const { roots, output } = parseTranscriptImportArgs(args);
  const sessions = [];
  const coverage = new Map();
  const seenFilesByProvider = new Map();
  for (const { provider, root } of roots) {
    const files = transcriptFiles(root);
    const current = coverage.get(provider) || { candidate_files: 0, parsed_sessions: 0 };
    const seenFiles = seenFilesByProvider.get(provider) || new Set();
    const rootHasCalibrationComponent = root.split(path.sep)
      .some((part) => part.toLowerCase() === 'swe-calibrate');
    for (const file of files) {
      let physicalFile;
      try {
        physicalFile = fs.realpathSync(file);
      } catch {
        physicalFile = path.resolve(file);
      }
      if (seenFiles.has(physicalFile)) continue;
      seenFiles.add(physicalFile);
      current.candidate_files += 1;
      const parsed = parseTranscriptFile(file);
      if (parsed === null) continue;
      if (!recognizedTranscriptSchema(provider, parsed)) continue;
      current.parsed_sessions += 1;
      sessions.push(inspectTranscript(
        provider,
        parsed,
        path.relative(root, file),
        rootHasCalibrationComponent,
      ));
    }
    seenFilesByProvider.set(provider, seenFiles);
    coverage.set(provider, current);
  }
  const sources = [...coverage.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, item]) => ({
      provider,
      candidate_files: item.candidate_files,
      parsed_sessions: item.parsed_sessions,
      schema_coverage_rate: rate(item.parsed_sessions, item.candidate_files),
    }));
  const result = {
    schema_version: 1,
    authority_status: 'untrusted_telemetry',
    admissible: false,
    imported_scorecard_rows: 0,
    sources,
    aggregates: aggregateTranscriptSessions(sessions),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const temp = `${output}.tmp-${process.pid}`;
    fs.writeFileSync(temp, serialized, { mode: 0o600 });
    fs.renameSync(temp, output);
  }
  process.stdout.write(serialized);
}

function currentRowsForRole(role, nowMs, options = {}) {
  const rows = readStoreRows(false, options.requireEvidence === true);
  const capabilityRows = options.requireEvidence ? readCapabilityEvidenceRows() : null;
  const evidenceReceipts = new WeakMap();
  const latest = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const storedRole = normalizeRole(row.role, { allowLegacy: true });
    if (storedRole !== role) continue;
    row.role = storedRole;
    if (row.evidence !== undefined) {
      try {
        row.evidence = compileCapabilityEvidence(row.evidence);
        if (options.requireEvidence && row.evidence.source === 'internal_eval') {
          verifyEvidenceStoreAnchor(row, capabilityRows);
        }
      } catch (error) {
        if (options.requireEvidence) {
          failValidation(`invalid evidence-required scorecard row: ${error.message}`);
        }
        warnMalformedLine(0, `invalid capability evidence (${error.message})`);
        delete row.evidence;
      }
    }
    if (options.requireEvidence && !row.evidence) continue;
    if (row.evidence && options.requireEvidence) {
      let receipt;
      try {
        receipt = evaluateCapabilityEvidence(
          capabilityRows.map((wrapper) => wrapper.evidence),
          {
            role,
            scope: options.scope,
            identity: options.identity || row.evidence.identity,
            evaluation_time: new Date(nowMs).toISOString(),
          },
        );
      } catch (error) {
        failValidation(`invalid capability evidence ledger: ${error.message}`);
      }
      if (!receipt.applicability.applicable) continue;
      evidenceReceipts.set(row, receipt);
    } else if (row.evidence && options.scope) {
      const receipt = buildCapabilityEvidenceReceipt(row.evidence, {
        role,
        scope: options.scope,
        identity: options.identity || row.evidence.identity,
        evaluation_time: new Date(nowMs).toISOString(),
      });
      if (!receipt.applicability.applicable) continue;
    } else if (row.evidence && options.identity) {
      const receipt = buildCapabilityEvidenceReceipt(row.evidence, {
        role,
        scope: row.evidence.scope,
        identity: options.identity,
        evaluation_time: new Date(nowMs).toISOString(),
      });
      if (!receipt.applicability.applicable) continue;
    }

    const missing = identityFieldMissing(row);
    if (missing) {
      if (options.requireEvidence) {
        failValidation(`invalid evidence-required scorecard row: missing ${missing}`);
      }
      warnMalformedLine(0, `configured-identity field missing (${missing})`);
      continue;
    }

    const currentId = toEventId(row.event_id);
    if (currentId === null) {
      if (options.requireEvidence) {
        failValidation('invalid evidence-required scorecard row: invalid event_id');
      }
      warnMalformedLine(0, 'invalid event_id for current view');
      continue;
    }

    const key = identityKey(row);
    const existing = latest.get(key);
    const existingId = existing ? toEventId(existing.event_id) : null;

    if (!existing || existingId === null || currentId > existingId) {
      latest.set(key, row);
    }
  }

  // Invocation-tuple supersede (v2.32.25 R6+R7, shared by current AND ladder):
  // `model` is an alias refinement of the same qualification — the newest event
  // per (FULL configured identity + effort) wins regardless of whether it
  // carries `model`, so a stale model-less row can neither stay selectable in
  // the ladder nor feed `reviewer_qualified` in resolve-review-loop
  // --check-scorecard. The key preserves every configured-identity dimension
  // (corpus/harness/runner_version/prompt hash — R7: rows from different
  // qualification setups must never retire each other) and omits ONLY model;
  // distinct efforts remain distinct rungs (R1).
  const byInvocation = new Map();
  for (const row of latest.values()) {
    const key = CONFIGURED_IDENTITY_FIELDS
      .map((name) => (row[name] !== undefined ? String(row[name]) : ''))
      .concat([row.effort === undefined ? '' : String(row.effort)])
      .concat([
        row.evidence ? row.evidence.scope_hash : '',
        row.evidence ? row.evidence.identity_hash : '',
      ])
      .join('\u0000');
    const existing = byInvocation.get(key);
    if (!existing || (toEventId(row.event_id) || 0) > (toEventId(existing.event_id) || 0)) {
      byInvocation.set(key, row);
    }
  }

  const output = [];

  for (const row of byInvocation.values()) {
    const resolvedEvidenceReceipt = evidenceReceipts.get(row) || null;
    const effectiveStatus = deriveStatus(row, nowMs, resolvedEvidenceReceipt);
    const evidenceBackedStatus = typeof effectiveStatus === 'string'
      ? effectiveStatus : row.status;
    const rowStatus = evidenceBackedStatus === 'qualified'
      ? 'provisional' : evidenceBackedStatus;
    const evidenceReceipt = resolvedEvidenceReceipt || (row.evidence
      ? buildCapabilityEvidenceReceipt(row.evidence, {
        role: row.evidence.role,
        scope: row.evidence.scope,
        identity: row.evidence.identity,
        evaluation_time: new Date(nowMs).toISOString(),
      })
      : null);
    const outputEvidenceReceipt = evidenceReceipt && evidenceReceipt.state === 'qualified'
      ? { ...evidenceReceipt, state: 'provisional' }
      : evidenceReceipt;

    output.push({
      engine: row.engine,
      runner: row.runner,
      role: row.role,
      corpus_version: row.corpus_version,
      harness_version: row.harness_version,
      runner_version: row.runner_version,
      prompt_config_hash: row.prompt_config_hash,
      status: rowStatus,
      capability_score: row.capability_score,
      family: row.family,
      cost: row.cost,
      model_version: row.model_version,
      // optional invocation-tuple fields (v2.32.25) — carried so ladder can project them
      ...(row.effort !== undefined ? { effort: row.effort } : {}),
      ...(row.model !== undefined ? { model: row.model } : {}),
      ...(outputEvidenceReceipt ? {
        evidence_receipt: outputEvidenceReceipt,
        evidence_observed_state: evidenceReceipt.state,
      } : {}),
      authority_status: 'untrusted_telemetry',
      admissible: false,
      observed_status: evidenceBackedStatus,
      event_id: toEventId(row.event_id) || 0,
    });
  }

  return output.sort((a, b) => {
    if (a.engine !== b.engine) return a.engine < b.engine ? -1 : 1;
    if (a.runner !== b.runner) return a.runner < b.runner ? -1 : 1;
    return 0;
  });
}

function deriveStatus(row, nowMs, resolvedEvidenceReceipt = null) {
  if (row.evidence) {
    const receipt = resolvedEvidenceReceipt || buildCapabilityEvidenceReceipt(row.evidence, {
      role: row.evidence.role,
      scope: row.evidence.scope,
      identity: row.evidence.identity,
      evaluation_time: new Date(nowMs).toISOString(),
    });
    if (receipt.state === 'qualified') return 'qualified';
    if (receipt.state === 'stale') return 'expired';
    return 'failed';
  }
  if (row.status !== 'qualified') return row.status;
  const expiresMs = toDateMs(row.expires);
  if (expiresMs === null) return row.status;
  return expiresMs < nowMs ? 'expired' : row.status;
}

function sortByCapability(a, b) {
  const ac = Number(a.capability_score);
  const bc = Number(b.capability_score);
  if (Number.isFinite(ac) && Number.isFinite(bc) && ac !== bc) {
    return bc - ac;
  }
  if (Number.isFinite(ac) && !Number.isFinite(bc)) return -1;
  if (!Number.isFinite(ac) && Number.isFinite(bc)) return 1;
  return 0;
}

// Cost sort value: a row is worst-cost (Infinity, never "free") if its source is
// `unknown` OR either unit price is missing/non-numeric — an unpriced `manual`/`measured`
// row is still unmeasured and must NOT rank as the cheapest (plan: "never rank an
// unmeasured engine as free").
function costSortValue(row) {
  const src = row.cost && row.cost.source;
  const inp = Number(row.cost ? row.cost.usd_per_mtok_input : NaN);
  const out = Number(row.cost ? row.cost.usd_per_mtok_output : NaN);
  if (src === 'unknown' || !Number.isFinite(inp) || !Number.isFinite(out)) return Infinity;
  return inp + out;
}

function rankCost(a, b) {
  const av = costSortValue(a);
  const bv = costSortValue(b);
  if (av !== bv) return av - bv; // Infinity (unmeasured) always sorts last
  return sortByCapability(a, b); // tie (incl. both unmeasured) → capability desc
}

function cmdRecord(args) {
  const { file } = parseRecordArgs(args);
  const raw = file
    ? fs.readFileSync(file, 'utf8')
    : fs.readFileSync(0, 'utf8');
  const parsed = parseJsonObject(raw, 'record input');

  validateRecordRow(parsed);

  const stored = { ...parsed };
  delete stored.event_id;

  const writtenRow = withWriteLock({ storeDir: SCORECARD_DIR, lockFile: LOCK_FILE, name: 'scorecard' }, () => {
    const rows = readStoreRows(true);
    const assigned = maxEventId(rows) + 1;
    const row = { ...stored, event_id: assigned };
    appendRow(SCORECARD_FILE, row);
    return row;
  });

  process.stdout.write(`${JSON.stringify(writtenRow)}\n`);
}

function cmdCurrent(args) {
  const {
    role,
    nowMs,
    requireEvidence,
    scope,
    identity,
  } = parseCurrentArgs(args);
  const rows = currentRowsForRole(role, nowMs, {
    requireEvidence,
    scope,
    identity,
  });
  process.stdout.write(`${JSON.stringify(rows)}\n`);
}

function cmdReport(args) {
  const {
    role,
    key,
    nowMs,
    requireEvidence,
    scope,
    identity,
  } = parseReportArgs(args);
  const rows = currentRowsForRole(role, nowMs, {
    requireEvidence,
    scope,
    identity,
  }).filter((row) => row.status === 'qualified');
  const ranked = rows.slice();

  if (key === 'cost') {
    ranked.sort(rankCost);
  } else {
    ranked.sort(sortByCapability);
  }

  process.stdout.write(`${JSON.stringify(ranked)}\n`);
}

function cmdLadder(args) {
  const {
    role,
    implementerFamily,
    nowMs,
    requireEvidence,
    scope,
    identity,
  } = parseLadderArgs(args);
  // currentRowsForRole already applies the invocation-tuple supersede (R6) —
  // a later failed/expired re-qualification retires the rung before this
  // qualified filter runs (R5 semantics preserved).
  const deduped = currentRowsForRole(role, nowMs, {
    requireEvidence,
    scope,
    identity,
  })
    .filter((row) => row.status === 'qualified')
    .sort(sortByCapability);

  const ladder = deduped.map((row) => ({
    engine: row.engine,
    runner: row.runner,
    family: row.family,
    capability_score: row.capability_score,
    effort: row.effort === undefined ? null : row.effort,
    model: row.model === undefined ? null : row.model,
    same_family: Boolean(implementerFamily && row.family === implementerFamily),
  }));

  if (implementerFamily) {
    ladder.sort((a, b) => {
      if (a.same_family !== b.same_family) {
        return a.same_family ? 1 : -1;
      }
      return sortByCapability(a, b);
    });
  }

  process.stdout.write(`${JSON.stringify(ladder)}\n`);
}

(function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) usage(2);
  if (isHelpToken(argv[0])) usage(0);

  const command = argv[0];
  const commandArgs = argv.slice(1);

  if (command === 'record') cmdRecord(commandArgs);
  else if (command === 'current') cmdCurrent(commandArgs);
  else if (command === 'report') cmdReport(commandArgs);
  else if (command === 'ladder') cmdLadder(commandArgs);
  else if (command === 'import-transcripts') cmdImportTranscripts(commandArgs);
  else failUsage(`unknown subcommand '${command}'`);
})();
