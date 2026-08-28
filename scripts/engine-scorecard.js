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
  // CAPABILITY_ROLE_IDS / normalizeCapabilityRole (plan 2026-08-28-consult-
  // discuss-qualification.md §2.6): record/current/seat-status validate role
  // input against the qualification-evidence namespace (adds consult/discuss).
  // `normalizeRole` stays imported AND re-exported byte-identical below because
  // resolve-scaffold-tier.js consumes THIS module's `normalizeRole` export for
  // execution-authority scaffold-tier admission — that must never widen.
  CAPABILITY_ROLE_IDS,
  normalizeCapabilityRole,
} = require('../src/engine/roles');
const {
  validateEvidenceProducer,
} = require('./engine-capability-state');
const {
  canonicalJson,
  sha256,
} = require('../src/engine/owner-kernel/canonical');

const VALID_ROLES = new Set(ROLE_IDS);
const LADDER_ROLES = new Set(['reviewer', 'implementer', 'owner']);
// `manual` is the legacy spelling (all 34 pre-2026-08-20 rows use it) and stays
// accepted so history keeps validating. `operator-asserted` is what
// engine-qualify.sh's --version-source actually emits, and without it EVERY
// CLI-transport qualification row was unrecordable: the qualifier passed, then
// `engine-scorecard.js record` rejected its own emitted row. Two spellings for
// one concept is not ideal — but rewriting evidence rows is worse. New rows
// should use `operator-asserted`.
// `official-default` (v2.34.36) marks a row that arrived by ADOPTION of the
// shipped official qualification defaults rather than by a local
// administration. It says how the row got into THIS store; the original
// administration's own version_source is preserved under
// row.provenance.administration_version_source. It is disclosure, not
// authority — no admission path branches on it.
const VALID_VERSION_SOURCES = new Set(['runtime', 'manual', 'operator-asserted', 'official-default']);
// `expired` stays a legal INPUT status (rows written before the 2026-08-22
// no-confidence-decay cut may still legitimately carry it on disk) but the
// projection (deriveStatus, below) never PRODUCES it any more — a stale/
// past-expires row now derives `qualified` with `expiry_warning: true`
// instead. Calendar dates are advisory-only everywhere; see
// references/strike-decay.md.
const VALID_STATUSES = new Set(['qualified', 'failed', 'expired']);
const VALID_COST_SOURCES = new Set(['measured', 'manual', 'unknown']);
// --- strike-decay projection (2026-08-22 no-confidence-decay P1) ------------------
// Closed registries, frozen contract §2.7.3. The strike STORE (write path,
// validation-at-write, dedup-idempotent append, invalidation) is owned by
// engine-capability-state.js; this file owns the read-time PROJECTION only —
// it never writes strikes.jsonl.
const STRIKE_WRITER_ALLOWLIST = new Set([
  'fuse', 'conformance_audit', 'dispatch_hetero_failclosed', 'qualification_admin',
]);
const CRITICAL_REEXAM_PREDICATES = new Set([
  'security_canary_disclosure', 'protected_test_tampering', 'evidence_hash_manipulation',
]);
const ORDINARY_STRIKE_THRESHOLD = 3;
const STRIKE_POLICY_VERSION = 2;
const SEAT_TOKEN_RE = /^[A-Za-z0-9._@:-]+$/;
// Engine token uses the CANONICAL vendor model-id charset (src/engine/capability-evidence.js
// `modelId`, :129-141) — NOT the narrower SEAT_TOKEN_RE below. Real vendor ids contain
// spaces, parens and slashes ("Gemini 3.5 Flash (High)", "kimi-code/k3-256k"); runner and
// role stay internal enumerations and keep the narrower charset. Both engine-scorecard.js
// (read side) and engine-capability-state.js (write side, `seat-hash`) MUST apply this same
// regex to the engine field so both sides hash the identical set — a divergence here
// silently orphans strikes from their projection.
const ENGINE_TOKEN_RE = /^(?![\s])[A-Za-z0-9 ._:()/-]{1,128}(?<![\s])$/u;
const HEX64_RE = /^[0-9a-f]{64}$/i;
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
  node scripts/engine-scorecard.js seat-status --engine <token> --runner <token> --role <role> [--now <ISO-date>]\n\
\n  --file <path>  Read one JSON row from this file.\n\
  --role is required for current/report/ladder/seat-status.\n\
  --key accepts capability (default) or cost.\n\
  --now accepts ISO date; used by current/report/ladder/seat-status for deterministic TTL checks.\n\
  All disk-backed views are untrusted telemetry: stored qualified rows are projected\n\
    as provisional and report/ladder cannot produce a routing candidate.\n\
  --require-evidence additionally excludes legacy rows and requires --scope-file.\n\
  --scope-file and --identity-file constrain lifecycle evidence to an exact applicability query.\n\
  --implementer-family is optional; if provided, ladder demotes matching family entries.\n\
  verification_author/explorer rows are evidence-only in v1; use current/report, not ladder.\n\
  import-transcripts requires explicit roots and emits aggregate-only, untrusted telemetry;\n\
    it never appends scorecard rows. --output atomically writes the same JSON printed to stdout.\n\
  seat-status prints the §2.7.5 admission projection for one engine+runner+role seat:\n\
    admission_status/expiry_warning/strikes_since_pass/critical_trigger/would_requalify/\n\
    strike_threshold/strike_policy_version/rejected_strikes, plus seat_hash and the\n\
    baseline (baseline_event_id/baseline_qualified_at). Calendar dates never gate admission;\n\
    AUTOPILOT_STRIKE_ENFORCEMENT=enforce arms ordinary-strike requalification (shadow by default).\n\
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

// Start of the UTC day containing `ms`. Used ONLY by computeExpiryWarning, whose
// right-hand side (`expires`) is contractually DATE-ONLY (:342) — a date-vs-date
// comparison must not become time-of-day sensitive. It is deliberately NOT the
// default clock: see nowArgToMs.
function startOfUtcDayMsOf(ms) {
  if (!Number.isFinite(ms)) return ms;
  const iso = new Date(ms).toISOString().slice(0, 10);
  const floor = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(floor) ? floor : ms;
}

// v2.34.37: the DEFAULT clock is the real instant, not UTC midnight.
//
// It used to be `todayMsUtc()` — Date.now() truncated to the start of the current
// UTC day — and every instant comparison downstream inherited that truncation,
// which made the projection read the *past* for up to 24h after every midnight:
//
//   (a) an evidence receipt issued later the same UTC day (issued_at
//       2026-08-22T20:00Z, evaluation_time 2026-08-22T00:00Z) is not yet valid,
//       so deriveStatus refuses it, findSeatBaseline picks no baseline, and
//       `seat-status` answers `no_record` for a seat that has a QUALIFIED row on
//       disk (reproduced: scorecard events 153/154/155 on their administration
//       day; `--now <next day>` flipped the same rows to `qualified`).
//   (b) foldSeatStrikes' countable window is `observedMs <= nowMs`, so every
//       strike written later the same UTC day was REJECTED — strike enforcement
//       was a silent no-op for up to 24h after each midnight. Reproduced: three
//       strikes stamped at the wall instant projected
//       `rejected_strikes: 3 / strikes_since_pass: 0` under the default clock and
//       `strikes_since_pass: 3 / would_requalify: true` under an explicit future
//       `--now`. `dispatch-contract.js` never passes `--now`, so this was the
//       production path.
//
// An EXPLICIT `--now` is still honoured verbatim: a date-only value keeps meaning
// start-of-that-day (toDateMs), a full timestamp keeps meaning that instant. Only
// the default changed. The pinned pass-instant tiebreak (a strike stamped at
// exactly the baseline instant does not count — `observedMs > baselineMs` is
// strict; calendar-teeth-negative "tie1") is untouched: this function never
// participates in that comparison's right-hand side.
function nowArgToMs(value, required = false) {
  const ms = toDateMs(value);
  if (value === undefined || value === null || value === '') {
    return required ? failValidation('missing --now value') : Date.now();
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

  const canonicalRole = normalizeCapabilityRole(row.role, { allowLegacy: true });
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
  // `none` is a real, distinct state — the transport has NO effort dimension at
  // all (http /v1/messages, agy where effort is baked into the model name, kimi
  // whose config exposes only `[thinking] enabled`). That is not the same as
  // omitting the field, which means "unknown/unrecorded". Collapsing the two
  // would lose the fact that the tuple was checked and found effort-less.
  if (row.effort !== undefined
      && !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(row.effort)) {
    failValidation(`invalid effort '${row.effort}' (none|low|medium|high|xhigh|max or omit)`);
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
    // Calendar tooth (a) pulled 2026-08-22: a `stale` evidence receipt is
    // advisory-only (surfaced as expiry_warning at read time), never an
    // admission downgrade — so a stale-receipt row now expects `qualified`.
    // Rows recorded before this cut may still legitimately carry the literal
    // `expired` string for a stale receipt; accepted on input for replay
    // idempotency, never produced by the projection going forward.
    const evidenceStatus = evidence.state === 'qualified' || evidence.state === 'stale'
      ? 'qualified' : 'failed';
    const evidenceStatusOk = row.status === evidenceStatus
      || (evidence.state === 'stale' && row.status === 'expired');
    if (!evidenceStatusOk) {
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
  role = normalizeCapabilityRole(role, { allowLegacy: true });
  if (!role) failUsage(`invalid role '${requestedRole}'`);
  if (requireEvidence && !scope) {
    failUsage('--require-evidence or --identity-file requires --scope-file');
  }

  // Default clock = real instant for every command (v2.34.37, was UTC-midnight
  // truncated unless --require-evidence). See nowArgToMs.
  const nowMs = nowArgToMs(now, false);

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
  role = normalizeCapabilityRole(role, { allowLegacy: true });
  if (!role) failUsage(`invalid role '${requestedRole}'`);
  if (key !== 'capability' && key !== 'cost') failUsage(`invalid --key '${key}'`);
  if (requireEvidence && !scope) {
    failUsage('--require-evidence or --identity-file requires --scope-file');
  }

  // Default clock = real instant for every command (v2.34.37, was UTC-midnight
  // truncated unless --require-evidence). See nowArgToMs.
  const nowMs = nowArgToMs(now, false);
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
  role = normalizeCapabilityRole(role, { allowLegacy: true });
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
    // Default clock = real instant for every command (v2.34.37, was UTC-midnight
    // truncated unless --require-evidence). See nowArgToMs.
    nowMs: nowArgToMs(now, false),
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

const SESSION_IDENTIFIER_FRAGMENT = /(?:^|[^A-Za-z0-9])sess(?:ion)?[_-][A-Za-z0-9][A-Za-z0-9_-]{7,}(?=$|[^A-Za-z0-9])/i;
const UUID_IDENTIFIER_FRAGMENT = /(?:^|[^A-Za-z0-9])[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}(?=$|[^A-Za-z0-9])/i;
const CODEX_ENGINE_NAMES = new Set([
  'gpt-5.3-codex-spark',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'o1',
  'o1-mini',
  'o1-preview',
  'o1-pro',
  'o3',
  'o3-mini',
  'o3-pro',
  'o4-mini',
]);
const GROK_ENGINE_NAMES = new Set([
  'grok-4.5',
  'grok-4.5-fast',
  'grok-composer-2.5-fast',
]);
const OPENCODE_ENGINE_NAMES = new Set([
  ...CODEX_ENGINE_NAMES,
  ...GROK_ENGINE_NAMES,
  'glm-4.6',
  'glm-4.7',
  'glm-5.2',
  'qwen-3.8',
  'minimax-m2.7',
  'minimax-m3',
  'claude-3-haiku-20240307',
  'claude-3-5-sonnet',
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'gemini-1.5',
  'gemini-3-flash',
  'gemini-3.5-flash',
  'deepseek-r1',
  'deepseek-v3',
  'kimi-k2.5',
]);

function safeEngineName(provider, value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:+()/ -]{0,119}$/.test(normalized)
      || /(?:secret|token|password|bearer|api[_ -]?key|credential)/i.test(normalized)
      || SESSION_IDENTIFIER_FRAGMENT.test(normalized)
      || UUID_IDENTIFIER_FRAGMENT.test(normalized)
      || transcriptSecrets.scan(normalized).length > 0
      || normalized.includes('/') || normalized.includes('\\')) return null;
  const key = normalized.toLowerCase();
  const admitted = provider === 'codex'
    ? CODEX_ENGINE_NAMES.has(key)
    : provider === 'grok'
      ? GROK_ENGINE_NAMES.has(key)
      : provider === 'opencode'
        ? OPENCODE_ENGINE_NAMES.has(key)
        : provider === 'agy'
          ? /^Gemini 3\.6 (?:Flash|Pro)(?: \((?:Low|Medium|High)\))?$/i.test(normalized)
          : false;
  return admitted ? normalized : null;
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

function agyDispatchUsage(root) {
  if (!root || root.runner !== 'agy'
      || !['reviewed', 'committed'].includes(root.status)
      || !safeEngineName('agy', root.model)) return null;
  const usage = transcriptObject(root.usage);
  const keys = usage ? Object.keys(usage).sort() : [];
  const expected = [
    'cache_read_tokens',
    'input_tokens',
    'output_tokens',
    'source',
    'total_tokens',
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expected)
      || usage.source !== 'agy-json') return null;
  for (const key of expected.filter((field) => field !== 'source')) {
    if (!Number.isSafeInteger(usage[key]) || usage[key] < 0) return null;
  }
  return usage;
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
    evidenceClass: 'transcript',
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
    const dispatchUsage = agyDispatchUsage(root);
    if (dispatchUsage) {
      result.completion = true;
      result.hasOutput = true;
      result.evidenceClass = 'dispatch-result';
      addRecognizedUsage(result.usage, dispatchUsage);
    } else {
      result.hasOutput = nonEmptyContent(root.output_text);
    }
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
    evidenceClass: inspected.evidenceClass || 'transcript',
    completed: inspected.completion,
    zeroOutput: !inspected.hasOutput,
    toolFailure: inspected.toolFailure,
    truncated: inspected.truncated,
    tokens: provider === 'agy' && inspected.evidenceClass !== 'dispatch-result' ? null : {
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
    const key = `${session.provider}\0${session.engine}\0${session.cohort}\0${session.evidenceClass}`;
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
      const historicalAgy = first.provider === 'agy' && first.evidenceClass === 'transcript';
      const tokens = historicalAgy
        ? { availability: 'unavailable', reason: 'transcript_schema_not_exposed' }
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
      const cost = historicalAgy
        ? { availability: 'unavailable', reason: 'transcript_schema_not_exposed' }
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
        evidence_class: first.evidenceClass,
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
    const storedRole = normalizeCapabilityRole(row.role, { allowLegacy: true });
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

    // Strike-decay projection (frozen contract §2.7.5): pair-scoped to this
    // row's own engine+runner+role seat — the only admission authority.
    const seatProjection = computeSeatProjection(row.engine, row.runner, row.role, nowMs).projection;

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
      // §2.7.5 projection fields. expiry_warning is THIS row's own `expires`
      // (advisory-only, never gates admission_status).
      admission_status: seatProjection.admission_status,
      expiry_warning: computeExpiryWarning(row.expires, nowMs),
      strikes_since_pass: seatProjection.strikes_since_pass,
      critical_trigger: seatProjection.critical_trigger,
      would_requalify: seatProjection.would_requalify,
      strike_threshold: seatProjection.strike_threshold,
      strike_policy_version: seatProjection.strike_policy_version,
      rejected_strikes: seatProjection.rejected_strikes,
      // Present only when this seat's baseline is an adopted official default
      // AND the seat is requalify_required. Advisory operator guidance; no
      // consumer gates on it (dispatch-contract.js reads admission_status).
      ...(seatProjection.remedy === undefined ? {} : { remedy: seatProjection.remedy }),
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
    // Calendar tooth (a) pulled 2026-08-22 (no-confidence-decay P1): a stale
    // evidence receipt is advisory-only — surfaced as `expiry_warning` in the
    // projection, never a downgrade to `expired`. See references/strike-decay.md.
    if (receipt.state === 'stale') return 'qualified';
    return 'failed';
  }
  if (row.status !== 'qualified') return row.status;
  // Calendar tooth (a) pulled 2026-08-22: `expires` never flips a qualified
  // row to `expired` here. It is surfaced separately as `expiry_warning`
  // (computeExpiryWarning, below) and plays no part in admission.
  return row.status;
}

// --- strike-decay projection helpers (frozen contract §2.7) -----------------------

function isHex64(value) {
  return typeof value === 'string' && HEX64_RE.test(value);
}

function seatToken(value) {
  return typeof value === 'string' && SEAT_TOKEN_RE.test(value.trim()) ? value.trim() : null;
}

// Engine field only: canonical vendor model-id charset, see ENGINE_TOKEN_RE comment above.
function engineToken(value) {
  return typeof value === 'string' && ENGINE_TOKEN_RE.test(value.trim()) ? value.trim() : null;
}

// Two independent call sites derive the same seat_hash (this file's read-time
// projection, and engine-capability-state.js's `seat-hash` write-time helper)
// from the identical two-line algorithm and the identical canonicalJson/sha256
// primitives — never by shelling out cross-script. A seat_hash mismatch
// between the two would silently orphan every strike from its projection.
function seatIdentityHash(engine, runner, role) {
  return sha256(canonicalJson({ engine: String(engine), runner: String(runner), role: String(role) }));
}

// `expires` is a DATE, not an instant — so this stays a date-vs-date comparison.
// The default clock became the real instant in v2.34.37 (nowArgToMs); without the
// floor here, an advisory-only warning would newly fire on the expiry date itself
// (00:00:00.001Z onward) rather than the day after, and would answer differently
// for `--now 2026-08-24` vs `--now 2026-08-24T10:00:00Z`. Neither is a defect the
// clock fix set out to change, and expiry is advisory-only either way
// (references/strike-decay.md: calendar tooth (a) is pulled).
function computeExpiryWarning(expiresValue, nowMs) {
  const ms = toDateMs(expiresValue);
  return ms !== null && ms < startOfUtcDayMsOf(nowMs);
}

// Start-of-day instant for a DATE-ONLY string (qualified_at is pinned date-only, :342).
// Used only as the fold threshold fallback below — matches toDateMs (start-of-day),
// the same granularity row selection/sorting already uses, so ties resolve by event_id.
function startOfDayMs(dateValue) {
  if (typeof dateValue !== 'string' || dateValue.length < 10) return null;
  // `qualified_at` is contractually date-only (:342), but rows recorded without
  // an `evidence` field (manual/legacy) are not schema-bound to that shape at
  // write time — take only the date portion so a stray full timestamp here
  // still yields the intended start of its calendar day, not an invalid string.
  const datePart = dateValue.slice(0, 10);
  const ms = Date.parse(`${datePart}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

// BLOCKER 5 fix (2026-08-22 review repair): the fold threshold must be an INSTANT,
// not a date. `qualified_at` is date-only (:342), but a `critical_reexam_trigger` (or
// any strike) can be stamped same-day, after the pass, with a full timestamp — and the
// fold compares observedMs > baselineMs (foldSeatStrikes). Using date-only start-of-day
// as the threshold left every same-day-after-pass strike still counting against a seat
// whose administration just passed, defeating the operator's only remedy.
//
// FINDING 2 fix (2026-08-22 second review repair): the first cut of this fallback
// used END of the pass date, which is FAIL-OPEN — a critical strike recorded later
// that same day, after a same-day pass, fell inside the [start, end] window and was
// silently treated as pre-pass and cleared. That is exactly backwards for the ONE
// class that enforces regardless of the shadow flag. Every modern administration
// carries `evidence.issued_at` (an exact instant, preferred above and unaffected by
// this fallback); only legacy DATE-ONLY rows (no evidence, or evidence without
// issued_at) reach this fallback, and for those the safe direction is to count the
// strike, not clear it. Fix: fall back to START of the pass date instead — any
// same-day strike (any instant that day, at or after 00:00:00.000Z) is treated as
// AFTER the baseline and counts. This still preserves the pinned pass-instant
// tiebreak (brainSeatStatus / :1580 validObserved): a strike stamped at exactly the
// `issued_at` instant on the full-timestamp path still fails `observedMs >
// baselineMs` (strict) — that tiebreak is unaffected by this fallback, which only
// ever engages when there is no `issued_at` to be strict about.
function baselineInstantMs(row, evidence) {
  if (evidence && typeof evidence.issued_at === 'string') {
    const ms = Date.parse(evidence.issued_at);
    if (Number.isFinite(ms)) return ms;
  }
  return startOfDayMs(row.qualified_at);
}

// Baseline = the newest scorecard row for this seat (engine+runner+role, NOT
// full configured identity) whose derived status is `qualified` — calendar
// plays no part (deriveStatus above never emits `expired`) — ordered by
// qualified_at then event_id. Scans the RAW store (not the current/latest-per-
// identity collapse) because a seat's true qualification history spans every
// configured-identity variant (corpus/harness/runner_version churn) that ever
// passed under this engine+runner+role.
function findSeatBaseline(engine, runner, role, nowMs, allRows) {
  let best = null;
  for (const row of allRows) {
    if (!row || typeof row !== 'object') continue;
    if (row.engine !== engine || row.runner !== runner) continue;
    const storedRole = normalizeCapabilityRole(row.role, { allowLegacy: true });
    if (storedRole !== role) continue;
    let evidence = row.evidence;
    if (evidence !== undefined) {
      try {
        evidence = compileCapabilityEvidence(evidence);
      } catch {
        continue;
      }
    }
    const status = deriveStatus({ ...row, evidence }, nowMs);
    if (status !== 'qualified') continue;
    const qMs = toDateMs(row.qualified_at);
    if (qMs === null) continue;
    const eid = toEventId(row.event_id) || 0;
    if (!best || qMs > best.qMs || (qMs === best.qMs && eid > best.eid)) {
      const instantMs = baselineInstantMs(row, evidence);
      best = {
        qMs,
        eid,
        qualified_at: row.qualified_at,
        event_id: eid,
        expires: row.expires,
        instantMs: instantMs === null ? qMs : instantMs,
        // Adoption provenance (v2.34.36). Present only on rows copied in from
        // the shipped official defaults by scripts/adopt-qualification-defaults.js.
        // It is DISCLOSURE, never authority: nothing here participates in the
        // admission decision — it only lets a requalify_required verdict name
        // the operator's remedy (references/qualification-defaults.md).
        provenance: (row.provenance && typeof row.provenance === 'object' && !Array.isArray(row.provenance))
          ? row.provenance
          : null,
      };
    }
  }
  return best;
}

// Fold, in the frozen-contract order (§2.7.5, plan 2026-08-22-no-confidence-decay):
// countable-strike validation -> invalidation subtraction -> dedup -> tallies.
// `schema_version: 1` rows (legacy brain-seat strikes) are ignored entirely —
// they feed brainSeatStatus in engine-capability-state.js only.
function foldSeatStrikes(seatHashValue, baselineQMs, nowMs) {
  const strikesFile = path.join(CAPABILITY_DIR, 'strikes.jsonl');
  const lines = fs.existsSync(strikesFile)
    ? fs.readFileSync(strikesFile, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0)
    : [];

  let rejected = 0;
  const parsedRows = [];
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      // Unparseable JSON is a rejected strike, not a crash — we cannot tell
      // whether it targeted this seat, so it counts against every seat query
      // (evidence-discipline §4: corrupt rows never silently vanish).
      rejected += 1;
      continue;
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rejected += 1;
      continue;
    }
    if (row.schema_version !== 2) continue; // legacy v1 or unrecognized — ignored entirely
    if (row.seat_hash !== seatHashValue) continue; // not this seat's row
    parsedRows.push(row);
  }

  // Countable-strike validation (contract step 2). An unauthorised writer,
  // missing receipt, malformed artifact hash, invalid class/predicate, or a
  // timestamp outside the (baseline, now] window can never inflate the count
  // — every such row is EXCLUDED and tallied into rejected_strikes.
  const countable = new Map(); // event_id -> { class, dedup_key }
  for (const row of parsedRows) {
    if (row.kind !== 'strike') continue;
    const eid = toEventId(row.event_id);
    const validClass = row.class === 'ordinary_strike' || row.class === 'critical_reexam_trigger';
    const validPredicate = row.class === 'critical_reexam_trigger'
      ? CRITICAL_REEXAM_PREDICATES.has(row.predicate_id)
      : (row.predicate_id === null || row.predicate_id === undefined);
    const validWriter = typeof row.writer === 'string' && STRIKE_WRITER_ALLOWLIST.has(row.writer);
    const validReceipt = typeof row.receipt_ref === 'string' && row.receipt_ref.length > 0;
    const validArtifact = isHex64(row.artifact_sha256);
    const validDedup = typeof row.dedup_key === 'string' && row.dedup_key.length > 0;
    const observedMs = Date.parse(row.observed_at);
    // PINNED tiebreak (brainSeatStatus, engine-capability-state.js): a strike
    // stamped at EXACTLY the pass instant does not count — strictly-greater.
    const validObserved = Number.isFinite(observedMs)
      && observedMs > baselineQMs
      && observedMs <= nowMs;

    if (eid === null || !validClass || !validPredicate || !validWriter
        || !validReceipt || !validArtifact || !validDedup || !validObserved) {
      rejected += 1;
      continue;
    }
    countable.set(eid, { class: row.class, dedup_key: row.dedup_key });
  }

  // Invalidation subtraction (contract step 3): only an allowlisted writer
  // with all three mechanical proof fields well-formed may remove exactly one
  // countable strike, matched by event_id on the same seat. A structurally
  // invalid invalidation removes nothing and is itself rejected.
  for (const row of parsedRows) {
    if (row.kind !== 'strike_invalidated') continue;
    const validWriter = typeof row.writer === 'string' && STRIKE_WRITER_ALLOWLIST.has(row.writer);
    const validProofArtifact = isHex64(row.proof_artifact_sha256);
    const validProofDetector = typeof row.proof_detector_id === 'string'
      && SEAT_TOKEN_RE.test(row.proof_detector_id.trim());
    const targetEventId = toEventId(row.invalidates_event_id);
    const validTarget = targetEventId !== null;
    // FINDING 3 fix (2026-08-22 review repair): two additional read-validation
    // conditions before an invalidation is honoured. Cross-seat deletion is
    // already impossible via the seat_hash-scoped parsedRows filter above —
    // deliberately not touched here (panel: do not "improve" it).
    const ownEventId = toEventId(row.event_id);
    // 1. observed_at must be well-formed AND within (baseline, now] — same
    //    window discipline as a countable strike; an invalidation stamped
    //    before the current baseline or in the future is not honoured.
    const observedMs = Date.parse(row.observed_at);
    const validObserved = Number.isFinite(observedMs)
      && observedMs > baselineQMs
      && observedMs <= nowMs;
    // 2. invalidates_event_id must be strictly less than the invalidation
    //    row's own event_id — a strike cannot be invalidated before it exists.
    const validOrder = ownEventId !== null && validTarget && targetEventId < ownEventId;

    if (!validWriter || !validProofArtifact || !validProofDetector || !validTarget
        || !validObserved || !validOrder) {
      rejected += 1;
      continue;
    }
    countable.delete(targetEventId);
  }

  // Dedup (contract step 4 — FINDING 1 fix, 2026-08-22 review repair): the key
  // is (seat_hash, dedup_key, class), matching the write side exactly
  // (engine-capability-state.js `appendStrike`, "BLOCKER 4 fix" comment).
  // seat_hash is already the filter scope above, so here the composite is
  // (dedup_key, class). Deduping on dedup_key ALONE was class-blind: an
  // ordinary_strike that reached the store first (lower event_id) would
  // silently hide a later critical_reexam_trigger sharing the same
  // dedup_key — exactly the one class that ENFORCES regardless of the
  // shadow flag. Two rows of the SAME class sharing a dedup_key still
  // collapse to one (retry idempotency preserved); two rows of DIFFERENT
  // classes sharing a dedup_key are independent root incidents and both
  // survive dedup.
  const lowestByDedupKey = new Map();
  for (const [eid, info] of countable.entries()) {
    const key = JSON.stringify([info.class, info.dedup_key]);
    const existing = lowestByDedupKey.get(key);
    if (existing === undefined || eid < existing) lowestByDedupKey.set(key, eid);
  }
  const keepIds = new Set(lowestByDedupKey.values());

  let strikesSincePass = 0;
  let criticalTrigger = false;
  for (const [eid, info] of countable.entries()) {
    if (!keepIds.has(eid)) continue;
    if (info.class === 'critical_reexam_trigger') criticalTrigger = true;
    else if (info.class === 'ordinary_strike') strikesSincePass += 1;
  }

  return { strikesSincePass, criticalTrigger, rejected };
}

function strikeEnforcementMode() {
  return process.env.AUTOPILOT_STRIKE_ENFORCEMENT === 'enforce' ? 'enforce' : 'shadow';
}

// The ONLY admission authority (frozen contract §2.7.5). Computed fresh at
// read time from the append-only stores — never mutates a stored row.
function computeSeatProjection(engine, runner, role, nowMs) {
  const seatHashValue = seatIdentityHash(engine, runner, role);
  const allRows = readStoreRows(true);
  const baseline = findSeatBaseline(engine, runner, role, nowMs, allRows);

  const projection = {
    admission_status: baseline ? 'qualified' : 'no_record',
    expiry_warning: baseline ? computeExpiryWarning(baseline.expires, nowMs) : false,
    strikes_since_pass: 0,
    critical_trigger: false,
    would_requalify: false,
    strike_threshold: ORDINARY_STRIKE_THRESHOLD,
    strike_policy_version: STRIKE_POLICY_VERSION,
    rejected_strikes: 0,
  };

  if (baseline) {
    const fold = foldSeatStrikes(seatHashValue, baseline.instantMs, nowMs);
    projection.strikes_since_pass = fold.strikesSincePass;
    projection.critical_trigger = fold.criticalTrigger;
    projection.rejected_strikes = fold.rejected;
    projection.would_requalify = projection.strikes_since_pass >= ORDINARY_STRIKE_THRESHOLD;
    if (projection.critical_trigger
        || (projection.would_requalify && strikeEnforcementMode() === 'enforce')) {
      projection.admission_status = 'requalify_required';
    }
    // An ADOPTED OFFICIAL DEFAULT that has accumulated no-confidence must tell
    // the operator the way out, because the way out is different from a
    // self-qualified seat's: re-adopting the same default changes nothing (it
    // is the same administration), so the only re-baseline is a fresh LOCAL
    // administration. Additive and advisory — admission_status is untouched.
    if (projection.admission_status === 'requalify_required'
        && baseline.provenance
        && baseline.provenance.kind === 'official-default') {
      const cmd = typeof baseline.provenance.self_qualify_command === 'string'
        && baseline.provenance.self_qualify_command.length > 0
        ? baseline.provenance.self_qualify_command
        : `scripts/engine-qualify.sh ${role} --engine ${engine} --runner ${runner}`;
      projection.remedy = `This seat routes on an ADOPTED OFFICIAL DEFAULT (official event ${
        baseline.provenance.official_event_id === undefined ? 'unknown' : baseline.provenance.official_event_id
      }), which has now accumulated mechanical no-confidence in YOUR environment. Re-adopting the same default cannot clear it — it is the same administration. Re-baseline with a fresh local administration: ${cmd}`;
    }
  }

  return {
    seat_hash: seatHashValue,
    baseline_event_id: baseline ? baseline.event_id : null,
    baseline_qualified_at: baseline ? baseline.qualified_at : null,
    projection,
  };
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

function parseSeatStatusArgs(args) {
  let engine = null;
  let runner = null;
  let role = null;
  let now;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (isHelpToken(arg)) usage(0);

    if (arg === '--engine') {
      if (i + 1 >= args.length) failUsage('--engine requires a value');
      engine = args[++i];
      continue;
    }
    if (arg === '--runner') {
      if (i + 1 >= args.length) failUsage('--runner requires a value');
      runner = args[++i];
      continue;
    }
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
    failUsage(`unknown option: ${arg}`);
  }

  if (!engine) failUsage('--engine is required');
  if (!runner) failUsage('--runner is required');
  if (!role) failUsage('--role is required');

  const engineTok = engineToken(engine);
  if (!engineTok) failUsage(`invalid --engine token '${engine}'`);
  const runnerToken = seatToken(runner);
  if (!runnerToken) failUsage(`invalid --runner token '${runner}'`);

  const requestedRole = role;
  const canonicalRole = normalizeCapabilityRole(role, { allowLegacy: true });
  if (!canonicalRole) failUsage(`invalid role '${requestedRole}'`);
  const roleToken = seatToken(canonicalRole);
  if (!roleToken) failUsage(`invalid --role token '${canonicalRole}'`);

  const nowMs = nowArgToMs(now);

  return { engine: engineTok, runner: runnerToken, role: roleToken, nowMs };
}

function cmdSeatStatus(args) {
  const { engine, runner, role, nowMs } = parseSeatStatusArgs(args);
  const result = computeSeatProjection(engine, runner, role, nowMs);
  process.stdout.write(`${JSON.stringify({
    ...result.projection,
    seat_hash: result.seat_hash,
    baseline_event_id: result.baseline_event_id,
    baseline_qualified_at: result.baseline_qualified_at,
  })}\n`);
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

function main() {
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
  else if (command === 'seat-status') cmdSeatStatus(commandArgs);
  else failUsage(`unknown subcommand '${command}'`);
}

if (require.main === module) {
  main();
}

// BLOCKER 2 (2026-08-22 review repair): resolve-scaffold-tier.js needs the SAME
// admission projection this file computes (strike-decay.md's only admission
// authority) rather than a third hand-rolled copy of the fold. Exported for that
// reuse — SCORECARD_DIR/CAPABILITY_DIR are resolved once at require time from
// ENGINE_SCORECARD_DIR/ENGINE_CAPABILITY_DIR, so a caller that wants a specific
// store must set those env vars BEFORE requiring this module (see
// resolve-scaffold-tier.js's own comment at its require site).
module.exports = {
  computeSeatProjection,
  seatIdentityHash,
  engineToken,
  seatToken,
  // Execution-role normalizer, byte-identical behavior: resolve-scaffold-tier.js
  // depends on this staying scoped to ROLE_IDS (never consult/discuss).
  normalizeRole,
  // Capability-role normalizer, additive export for consumers that validate
  // against the qualification-evidence namespace (e.g. D7's seat-status gate).
  normalizeCapabilityRole,
};
