#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const { expandTilde, ensureDir, sleepMs, acquireLock, releaseLock, withWriteLock, appendRow, toEventId, maxEventId } = require('./lib/jsonl-store');
const {
  BRAIN_CONSTRUCT_SCOPE,
  BRAIN_METHODOLOGY_KIND,
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
  normalizeIdentity,
} = require('../src/engine/capability-evidence');
const {
  canonicalJson,
  isSha256,
  sha256,
} = require('../src/engine/owner-kernel/canonical');

const EVIDENCE_PRODUCERS = new Set([
  'engine-qualify-v2',
  'operator-record-v1',
  'trusted-observation-v1',
  'aa-import-v1',
]);
const ENDPOINT_NAME_RE = /^[A-Za-z0-9_]{1,128}$/;
const ENDPOINT_NULL_SELECTOR = '@none';

const HELP_TEXT = `Usage:
  node scripts/engine-capability-state.js record [--file <path>] [--store <path>]
  node scripts/engine-capability-state.js current --runner <runner> --model <model> --role <role> [--effort <effort>] [--endpoint <name|@none>] [--role-scope pool|exact] [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js report --capability <name> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js record-evidence [--file <path>] [--store <path>]
  node scripts/engine-capability-state.js current-evidence --role <role> --scope-file <path> --identity-file <path> [--observation-file <path>] [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js report-evidence --role <role> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js prune [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js classify-error [--string <text>] [--file <path>] [--exit-code <code>]
  node scripts/engine-capability-state.js strike --identity-file <path> --source <fuse|conformance_audit> --receipt-ref <token> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js brain-status --identity-file <path> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js strike-seat --engine <token> --runner <token> --role <token> --class ordinary_strike|critical_reexam_trigger [--predicate-id <id>] --cause-class engine_output|runner_delivery|ambiguous --writer <allowlisted> --dedup-key <string> --detector-id <token> --detector-version <token> --artifact-sha256 <64hex> --receipt-ref <string> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js invalidate-strike --engine <token> --runner <token> --role <token> --invalidates-event-id <int> --proof-artifact-sha256 <64hex> --proof-detector-id <token> --writer <allowlisted> --dedup-key <string> --detector-id <token> --detector-version <token> --artifact-sha256 <64hex> --receipt-ref <string> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js seat-hash --engine <token> --runner <token> --role <token> [--effort <effort>]

Options:
  --file <path>        Read event JSON from file (for record) or classify error from file.
  --store <path>       Override capability store directory or file.
  --now <ISO-date>     Use this ISO-8601 UTC timestamp for deterministic tests.
  --runner <runner>    Specify runner name.
  --model <model>      Specify model name.
  --role <role>        Specify role.
  --effort <effort>    Select one exact effort partition. Omit only for legacy rows.
  --endpoint <value>   Select one exact endpoint wallet; "@none" means explicit endpoint:null.
                       Omit only for backward-compatible legacy ambiguous rows.
  --role-scope <scope> Quota merge scope for current: account pool (default) or exact role.
  --capability <name>  Specify capability name (default: quota).
  --scope-file <path>  Read an exact capability scope JSON object.
  --identity-file <path>  Read an exact deployment identity JSON object.
  --observation-file <path>  Read an optional revocation observation into telemetry.
  --string <text>      String to classify for classify-error.
  --exit-code <code>   Exit code to classify for classify-error.
  --engine <token>     Seat identity engine token (strike-seat / invalidate-strike / seat-hash).
                       Seat identity is engine+runner+role+effort; omit --effort ONLY for legacy
                       rows recorded before effort partitioning — omitting is not a wildcard, and a
                       strike written without it lands on a different seat than an effort-bearing
                       projection reads.
  --class <name>       ordinary_strike | critical_reexam_trigger (strike-seat).
  --predicate-id <id>  Required iff --class critical_reexam_trigger; must be a registered predicate.
  --cause-class <name> engine_output | runner_delivery | ambiguous (strike-seat).
  --writer <id>        Allowlisted writer id (strike-seat / invalidate-strike).
  --dedup-key <string> Root-incident-scoped idempotency key (strike-seat / invalidate-strike).
  --detector-id <token>       Detector identity (strike-seat / invalidate-strike).
  --detector-version <token>  Detector version (strike-seat / invalidate-strike).
  --artifact-sha256 <hex>     sha256 of the detecting artifact (strike-seat / invalidate-strike).
  --invalidates-event-id <n>  event_id of the v2 strike row being invalidated (invalidate-strike).
  --proof-artifact-sha256 <hex>  sha256 of the mechanical proof of detector defect (invalidate-strike).
  --proof-detector-id <token>    Detector that produced the proof (invalidate-strike).

Exit codes:
  0 = success
  1 = validation / classification error
  2 = usage error / unknown command

Evidence JSONL and CLI output are untrusted telemetry. A stored qualified evaluation is projected
as provisional and cannot admit a role; only a session-local host capability from the live
qualifier can produce an authoritative qualification.
`;

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

function readTextLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function warnMalformedLine(lineNo, message) {
  process.stderr.write(`WARN: malformed capability line ${lineNo}: ${message}\n`);
}

function toDateMs(value) {
  if (value === undefined || value === null || value === '') return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function isValidISO8601(value) {
  if (typeof value !== 'string') return false;
  // A simple regex check for ISO-8601 format requiring timezone
  const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  if (!regex.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

// Validation logic matching the JSON schema exactly
function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    failValidation('Event must be a JSON object');
  }

  const rootAllowed = new Set([
    'schema_version',
    'event_id',
    'observed_at',
    'runner',
    'model',
    'role',
    'effort',
    'endpoint',
    'runner_version',
    'capability'
  ]);
  for (const key of Object.keys(event)) {
    if (!rootAllowed.has(key)) {
      failValidation(`unknown key at event root: ${key}`);
    }
  }

  if (event.schema_version !== 1) {
    failValidation(`schema_version must be 1 (got ${event.schema_version})`);
  }

  if (!isValidISO8601(event.observed_at)) {
    failValidation('observed_at must be a valid ISO-8601 UTC date string');
  }

  if (typeof event.runner !== 'string' || event.runner.trim().length === 0) {
    failValidation('runner must be a non-empty string');
  }

  if (typeof event.model !== 'string' || event.model.trim().length === 0) {
    failValidation('model must be a non-empty string');
  }

  if (typeof event.role !== 'string' || event.role.trim().length === 0) {
    failValidation('role must be a non-empty string');
  }

  if (Object.prototype.hasOwnProperty.call(event, 'effort')
      && (typeof event.effort !== 'string'
        || !/^[A-Za-z0-9._:-]{1,128}$/.test(event.effort))) {
    failValidation('effort must be a bounded classification code');
  }

  if (Object.prototype.hasOwnProperty.call(event, 'endpoint')
      && event.endpoint !== null
      && (typeof event.endpoint !== 'string'
        || !ENDPOINT_NAME_RE.test(event.endpoint))) {
    failValidation('endpoint must be a bounded endpoint name or null');
  }

  if (event.runner_version !== undefined && event.runner_version !== null && typeof event.runner_version !== 'string') {
    failValidation('runner_version must be a string or null');
  }

  if (!event.capability || typeof event.capability !== 'object' || Array.isArray(event.capability)) {
    failValidation('capability must be an object');
  }

  const capAllowed = new Set(['quota', 'skill_transport', 'context_window']);
  for (const key of Object.keys(event.capability)) {
    if (!capAllowed.has(key)) {
      failValidation(`unknown key in capability: ${key}`);
    }
  }

  const quota = event.capability.quota;
  if (!quota || typeof quota !== 'object' || Array.isArray(quota)) {
    failValidation('capability.quota must be an object');
  }

  const quotaAllowed = new Set(['status', 'reset_at', 'confidence', 'evidence', 'ttl_seconds']);
  for (const key of Object.keys(quota)) {
    if (!quotaAllowed.has(key)) {
      failValidation(`unknown key in capability.quota: ${key}`);
    }
  }

  const validStatuses = new Set(['available', 'limited', 'exhausted', 'unknown']);
  if (!validStatuses.has(quota.status)) {
    failValidation(`invalid quota status: ${quota.status}`);
  }

  const validConfidences = new Set(['high', 'medium', 'low']);
  if (!validConfidences.has(quota.confidence)) {
    failValidation(`invalid quota confidence: ${quota.confidence}`);
  }

  if (!Number.isInteger(quota.ttl_seconds) || quota.ttl_seconds < 0) {
    failValidation('quota.ttl_seconds must be a non-negative integer');
  }

  if (quota.reset_at !== undefined && quota.reset_at !== null) {
    if (!isValidISO8601(quota.reset_at)) {
      failValidation('quota.reset_at must be a valid ISO-8601 UTC date string or null');
    }
  }

  if (quota.evidence !== undefined && quota.evidence !== null && typeof quota.evidence !== 'string') {
    failValidation('quota.evidence must be a string or null');
  }

  const skill = event.capability.skill_transport;
  if (skill !== undefined) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      failValidation('capability.skill_transport must be an object');
    }

    const skillAllowed = new Set(['native', 'prompt_pack', 'last_bench_id', 'native_observed_at', 'prompt_pack_observed_at']);
    for (const key of Object.keys(skill)) {
      if (!skillAllowed.has(key)) {
        failValidation(`unknown key in capability.skill_transport: ${key}`);
      }
    }

    const validSkillStates = new Set(['supported', 'unsupported', 'unknown']);
    if (!validSkillStates.has(skill.native)) {
      failValidation(`invalid skill_transport.native state: ${skill.native}`);
    }

    if (!validSkillStates.has(skill.prompt_pack)) {
      failValidation(`invalid skill_transport.prompt_pack state: ${skill.prompt_pack}`);
    }

    if (skill.last_bench_id !== undefined && skill.last_bench_id !== null && typeof skill.last_bench_id !== 'string') {
      failValidation('skill_transport.last_bench_id must be a string or null');
    }

    // Output-only per-field observation times: allowed on input for round-trip parity with the
    // merged `current` output, but must satisfy the schema's nullable-string contract. (gpt-5.5 P6 F4 r3)
    for (const k of ['native_observed_at', 'prompt_pack_observed_at']) {
      if (skill[k] !== undefined && skill[k] !== null && typeof skill[k] !== 'string') {
        failValidation(`skill_transport.${k} must be a string or null`);
      }
    }
  }

  // context_window — optional dimension, same posture as skill_transport: absent is
  // fine, `null` total_tokens means "observed nothing" and never clobbers a valid
  // reading during the merge.
  const ctxWindow = event.capability.context_window;
  if (ctxWindow !== undefined) {
    if (!ctxWindow || typeof ctxWindow !== 'object' || Array.isArray(ctxWindow)) {
      failValidation('capability.context_window must be an object');
    }
    const ctxAllowed = new Set(['total_tokens', 'evidence', 'observed_at']);
    for (const key of Object.keys(ctxWindow)) {
      if (!ctxAllowed.has(key)) {
        failValidation(`unknown key in capability.context_window: ${key}`);
      }
    }
    if (ctxWindow.total_tokens !== undefined && ctxWindow.total_tokens !== null) {
      if (!Number.isInteger(ctxWindow.total_tokens) || ctxWindow.total_tokens < 1) {
        failValidation('context_window.total_tokens must be a positive integer or null');
      }
    }
    if (ctxWindow.evidence !== undefined && ctxWindow.evidence !== null && typeof ctxWindow.evidence !== 'string') {
      failValidation('context_window.evidence must be a string or null');
    }
    // Output-only on the merged `current` view; accepted on input for round-trip parity.
    if (ctxWindow.observed_at !== undefined && ctxWindow.observed_at !== null && typeof ctxWindow.observed_at !== 'string') {
      failValidation('context_window.observed_at must be a string or null');
    }
  }
}

function resolveStoreConfig(options) {
  let storeFile = process.env.ENGINE_CAPABILITY_FILE;
  let storeDir = process.env.ENGINE_CAPABILITY_DIR;

  if (options.store) {
    const resolvedPath = path.resolve(expandTilde(options.store));
    try {
      if (fs.existsSync(resolvedPath)) {
        if (!fs.statSync(resolvedPath).isDirectory()) {
          storeFile = resolvedPath;
          storeDir = path.dirname(storeFile);
        } else {
          storeDir = resolvedPath;
          storeFile = path.join(storeDir, 'capability.jsonl');
        }
      } else {
        if (resolvedPath.endsWith('.jsonl')) {
          storeFile = resolvedPath;
          storeDir = path.dirname(storeFile);
        } else {
          storeDir = resolvedPath;
          storeFile = path.join(storeDir, 'capability.jsonl');
        }
      }
    } catch {
      if (resolvedPath.endsWith('.jsonl')) {
        storeFile = resolvedPath;
        storeDir = path.dirname(storeFile);
      } else {
        storeDir = resolvedPath;
        storeFile = path.join(storeDir, 'capability.jsonl');
      }
    }
  } else {
    if (storeDir) {
      storeDir = path.resolve(expandTilde(storeDir));
      storeFile = storeFile ? path.resolve(expandTilde(storeFile)) : path.join(storeDir, 'capability.jsonl');
    } else {
      storeDir = path.resolve(expandTilde(path.join('~', '.autopilot', 'engine-capability')));
      storeFile = storeFile ? path.resolve(expandTilde(storeFile)) : path.join(storeDir, 'capability.jsonl');
    }
  }
  const lockFile = path.join(storeDir, '.lock');
  const evidenceFile = path.join(storeDir, 'qualification-evidence.jsonl');
  // Strike ledger (brain-seat revocation, plan 2026-08-17-brain-seat-exam-suite KR3b):
  // a separately named ledger in the SAME store dir, serialized under the SAME lock.
  const strikesFile = path.join(storeDir, 'strikes.jsonl');
  return { storeDir, storeFile, evidenceFile, strikesFile, lockFile };
}

function readStoreRows(storeFile, silentWarn = false) {
  const lines = readTextLines(storeFile);
  const rows = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        if (!silentWarn) warnMalformedLine(i + 1, 'not an object');
        continue;
      }
      rows.push(row);
    } catch (err) {
      if (!silentWarn) warnMalformedLine(i + 1, err.message);
    }
  }

  return rows;
}

function readEvidenceRows(evidenceFile) {
  const lines = readTextLines(evidenceFile);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const wrapper = JSON.parse(lines[index]);
      const eventId = wrapper && toEventId(wrapper.event_id);
      if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)
          || eventId === null || !wrapper.evidence
          || !EVIDENCE_PRODUCERS.has(wrapper.producer)
          || !isSha256(wrapper.transcript_hash)
          || Object.keys(wrapper).some((key) => ![
            'event_id',
            'producer',
            'transcript_hash',
            'evidence',
          ].includes(key))) {
        throw new Error('expected an integrity-wrapped {event_id,producer,transcript_hash,evidence} object');
      }
      const evidence = compileCapabilityEvidence(wrapper.evidence);
      if (wrapper.transcript_hash !== capabilityEvidenceProducerHash(
        evidence,
        wrapper.producer,
      )) {
        throw new Error('evidence producer transcript hash mismatch');
      }
      validateEvidenceProducer(evidence, wrapper.producer);
      rows.push({
        event_id: eventId,
        producer: wrapper.producer,
        transcript_hash: wrapper.transcript_hash,
        evidence,
      });
    } catch (error) {
      throw new Error(`malformed capability evidence line ${index + 1}: ${error.message}`);
    }
  }
  return rows;
}

function evidenceStoreHead(rows) {
  return sha256(canonicalJson(rows.map((row) => ({
    event_id: row.event_id,
    producer: row.producer,
    transcript_hash: row.transcript_hash,
    evidence_id: row.evidence.evidence_id,
    evidence_hash: row.evidence.evidence_hash,
  }))));
}

function evidenceResolution(rows, receipt, evaluationTime) {
  const wrapper = rows.find((row) => row.evidence.evidence_id === receipt.evidence_id);
  const telemetryReceipt = receipt.state === 'qualified'
    ? { ...receipt, state: 'provisional' }
    : receipt;
  if (!wrapper) {
    return {
      authority_status: 'untrusted_telemetry',
      admissible: false,
      observed_state: receipt.state,
      receipt: telemetryReceipt,
      store_anchor: null,
    };
  }
  return {
    authority_status: 'untrusted_telemetry',
    admissible: false,
    observed_state: receipt.state,
    receipt: telemetryReceipt,
    store_anchor: {
      schema_version: 1,
      authority_status: 'untrusted_telemetry',
      producer: wrapper.producer,
      event_id: wrapper.event_id,
      evidence_id: wrapper.evidence.evidence_id,
      transcript_hash: wrapper.transcript_hash,
      store_head_hash: evidenceStoreHead(rows),
      query_hash: sha256(canonicalJson({
        role: receipt.role,
        requested_scope_hash: receipt.applicability.requested_scope_hash,
        requested_identity_hash: receipt.applicability.requested_identity_hash,
        evaluation_time: evaluationTime,
      })),
    },
  };
}

function readJsonObject(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    failValidation(`${label}: invalid JSON (${error.message})`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failValidation(`${label}: expected a JSON object`);
  }
  return value;
}

function appendEvidenceRows(config, rows) {
  ensureDir(config.storeDir);
  const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  try {
    fs.appendFileSync(config.evidenceFile, content, { mode: 0o600 });
    fs.chmodSync(config.storeDir, 0o700);
    fs.chmodSync(config.evidenceFile, 0o600);
  } catch (error) {
    throw new Error(`cannot append and secure capability evidence store: ${error.message}`);
  }
}

function exactTokenList(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index]);
}

function validateAaImportEvidence(evidence) {
  const expectedTask = evidence.role === 'implementer'
    ? 'code_implementation' : 'repository_exploration';
  if (!['implementer', 'explorer'].includes(evidence.role)) {
    throw new Error('aa-import-v1 may write only implementer/explorer evidence');
  }
  if (evidence.source !== 'external_prior'
      || !['provisional', 'degraded'].includes(evidence.state)) {
    throw new Error('aa-import-v1 may write only provisional/degraded external_prior evidence');
  }
  if (evidence.source_ref !== 'artificial-analysis-api-v2'
      || evidence.methodology.kind !== 'external_prior'
      || evidence.methodology.name !== 'artificial-analysis-model-prior'
      || evidence.methodology.version !== '1.0.0') {
    throw new Error('aa-import-v1 requires canonical Artificial Analysis provenance');
  }
  if (evidence.identity.runner !== 'aa-model-level'
      || evidence.identity.runner_version !== 'api-v2'
      || evidence.identity.harness_version !== 'unresolved'
      || evidence.identity.effort !== 'unresolved'
      || evidence.identity.identity_resolved !== false) {
    throw new Error('aa-import-v1 requires an unresolved model-level Artificial Analysis identity');
  }
  if (!exactTokenList(evidence.scope.task_classes, [expectedTask])
      || !exactTokenList(evidence.scope.domains, ['general'])
      || !exactTokenList(evidence.scope.languages, ['und'])
      || !exactTokenList(evidence.scope.tool_surface, ['model-level-benchmark'])) {
    throw new Error('aa-import-v1 evidence has an unsupported role scope');
  }
  const expectedDimensions = evidence.role === 'implementer'
    ? ['agentic_index', 'coding_index']
    : ['agentic_index', 'intelligence_index'];
  if (!exactTokenList(evidence.methodology.basis.dimensions, expectedDimensions)
      || !evidence.methodology.basis.cohort.startsWith('aa-index-v')) {
    throw new Error('aa-import-v1 evidence has an unsupported methodology basis');
  }
  const applicability = evidence.methodology.basis.applicability;
  const requiredApplicability = [
    'benchmark-language-unresolved',
    'cloud-model-level',
    'deployment-unresolved',
    'harness-unresolved',
    'precision-unresolved',
    'proxy-only',
    'runner-unresolved',
  ];
  if (requiredApplicability.some((entry) => !applicability.includes(entry))
      || (evidence.state === 'degraded'
        && (!applicability.includes('candidate-retired')
          || ![
            'below_candidate_floor',
            'model_identity_changed',
            'model_missing_current_cohort',
          ].some((entry) => applicability.includes(entry))))
      || (evidence.state === 'provisional' && applicability.includes('candidate-retired'))) {
    throw new Error('aa-import-v1 evidence has unsupported applicability metadata');
  }
}

function validateEvidenceProducer(evidence, producer) {
  if (!EVIDENCE_PRODUCERS.has(producer)) {
    throw new Error(`unsupported capability evidence producer '${producer}'`);
  }
  if (evidence.source === 'internal_eval' && producer !== 'engine-qualify-v2') {
    throw new Error('internal evaluation evidence requires engine-qualify-v2');
  }
  if (producer === 'aa-import-v1') validateAaImportEvidence(evidence);
}

function restoreEvidenceAppend(config, existed, originalSize) {
  try {
    if (existed) {
      fs.truncateSync(config.evidenceFile, originalSize);
    } else if (fs.existsSync(config.evidenceFile)) {
      fs.unlinkSync(config.evidenceFile);
    }
  } catch (rollbackError) {
    throw new Error(`capability evidence rollback failed: ${rollbackError.message}`);
  }
}

function appendEvidenceRecords(config, rawEvidenceRecords, producer, transaction = {}) {
  if (!EVIDENCE_PRODUCERS.has(producer)) {
    throw new Error(`unsupported capability evidence producer '${producer}'`);
  }
  if (!Array.isArray(rawEvidenceRecords) || rawEvidenceRecords.length === 0) {
    throw new Error('capability evidence batch must be a non-empty array');
  }
  const evidenceRecords = rawEvidenceRecords.map((record) => compileCapabilityEvidence(record));
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)
      || Object.keys(transaction).some((key) => !['commit', 'rollback'].includes(key))
      || (transaction.commit !== undefined && typeof transaction.commit !== 'function')
      || (transaction.rollback !== undefined && typeof transaction.rollback !== 'function')
      || Boolean(transaction.commit) !== Boolean(transaction.rollback)) {
    throw new Error(
      'capability evidence transaction must contain paired commit and rollback callbacks',
    );
  }
  for (const evidence of evidenceRecords) validateEvidenceProducer(evidence, producer);

  return withWriteLock({
    storeDir: config.storeDir,
    lockFile: config.lockFile,
    name: 'capability evidence',
  }, () => {
    const rows = readEvidenceRows(config.evidenceFile);
    const byEvidenceId = new Map(rows.map((row) => [row.evidence.evidence_id, row]));
    const result = [];
    const newRows = [];
    let nextEventId = maxEventId(rows) + 1;

    for (const evidence of evidenceRecords) {
      let wrapper = byEvidenceId.get(evidence.evidence_id);
      if (wrapper && wrapper.producer !== producer) {
        throw new Error(
          `capability evidence ${evidence.evidence_id} is owned by producer '${wrapper.producer}'`,
        );
      }
      if (!wrapper) {
        wrapper = {
          event_id: nextEventId,
          producer,
          transcript_hash: capabilityEvidenceProducerHash(evidence, producer),
          evidence,
        };
        nextEventId += 1;
        rows.push(wrapper);
        newRows.push(wrapper);
        byEvidenceId.set(evidence.evidence_id, wrapper);
      }
      result.push(wrapper);
    }

    const allEvidence = rows.map((row) => row.evidence);
    for (const evidence of evidenceRecords) {
      evaluateCapabilityEvidence(
        allEvidence,
        {
          role: evidence.role,
          scope: evidence.scope,
          identity: evidence.identity,
          evaluation_time: evidence.issued_at,
        },
      );
    }

    if (rows.length !== byEvidenceId.size) {
      throw new Error('capability evidence ledger contains duplicate evidence ids');
    }
    const existed = fs.existsSync(config.evidenceFile);
    const originalSize = existed ? fs.statSync(config.evidenceFile).size : 0;
    let published = false;
    try {
      if (transaction.commit) {
        transaction.commit(result);
        published = true;
      }
      if (newRows.length > 0) appendEvidenceRows(config, newRows);
    } catch (error) {
      const rollbackErrors = [];
      if (newRows.length > 0) {
        try {
          restoreEvidenceAppend(config, existed, originalSize);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError.message);
        }
      }
      if (published) {
        try {
          transaction.rollback();
        } catch (rollbackError) {
          rollbackErrors.push(`publication rollback failed: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new Error(`${error.message}; ${rollbackErrors.join('; ')}`);
      }
      throw error;
    }
    return result;
  });
}

function appendEvidenceRecord(config, evidence, producer) {
  return appendEvidenceRecords(config, [evidence], producer)[0];
}

// --- brain-seat strike ledger (plan 2026-08-17-brain-seat-exam-suite KR3b) --------
// Strikes are identity_hash-keyed revocation events, NOT capability evidence: they
// live in strikes.jsonl beside the evidence ledger, serialized under the same lock,
// and are counted by brainSeatStatus against the newest qualified brain record.

const STRIKE_SOURCES = new Set(['fuse', 'conformance_audit']);
const STRIKE_FIELDS = new Set([
  'schema_version', 'event_id', 'identity_hash', 'source', 'observed_at', 'receipt_ref',
]);

function identityHashOf(rawIdentity) {
  return sha256(canonicalJson(normalizeIdentity(rawIdentity)));
}

function validateStrikeV1Shape(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)
      || row.schema_version !== 1
      || toEventId(row.event_id) === null
      || !isSha256(row.identity_hash)
      || !STRIKE_SOURCES.has(row.source)
      || typeof row.observed_at !== 'string' || Number.isNaN(Date.parse(row.observed_at))
      || typeof row.receipt_ref !== 'string' || row.receipt_ref.length === 0
      || Object.keys(row).some((key) => !STRIKE_FIELDS.has(key))) {
    throw new Error('invalid strike row shape');
  }
  return row;
}

// --- strike STORE v2 (plan 2026-08-22-no-confidence-decay §2.7, P0) ---------------
// Pair-scoped (engine+runner+role) seat strikes, closed registries, dedup-idempotent
// append, mechanically-proven invalidation. v1 rows above are untouched and keep
// feeding brainSeatStatus ONLY; v2 rows never enter that fold. event_id stays
// monotonic across BOTH schemas in the same file (readStrikeRows returns both).

const SEAT_TOKEN_RE = /^[A-Za-z0-9._@:-]+$/;

// FOURTH copy of the model-id charset (src/engine/capability-evidence.js `modelId`,
// plus engine-qualify.js and qualification-case-broker.js — see that file's comment
// at capability-evidence.js:129-141). MUST stay byte-identical to the other three:
// they hand the same value to each other, so a narrower set anywhere kills a
// legitimate identity at whichever hop happens to check last. This is what BLOCKER 1
// of the 2026-08-22 review repair exists to fix — the old SEAT_TOKEN_RE above
// rejected real vendor engine ids ("Gemini 3.5 Flash (High)", "kimi-code/k3-256k"),
// which made dispatch-hetero.sh's default seat's strike writer silently inert
// (fail-soft wrapper swallowed the ERROR). Applied to the `engine` token ONLY:
// `runner` and `role` are internal enumerations (agy/codex/grok/cc-shim/pi/
// qoderclicn; implementer/reviewer/...), not vendor-controlled strings, so they
// keep the narrower SEAT_TOKEN_RE deliberately.
const ENGINE_TOKEN_RE = /^(?![\s])[A-Za-z0-9 ._:()/-]{1,128}(?<![\s])$/u;

// Closed registries — exact names/values frozen by the plan §2.7.3. Exported for
// P1 (engine-scorecard.js projection) and any other consumer to import rather than
// re-declare.
const STRIKE_WRITER_ALLOWLIST = Object.freeze(['fuse', 'conformance_audit', 'dispatch_hetero_failclosed', 'qualification_admin']);
const CRITICAL_REEXAM_PREDICATES = Object.freeze(['security_canary_disclosure', 'protected_test_tampering', 'evidence_hash_manipulation']);
const EXTERNAL_CAUSE_EXCLUSIONS = Object.freeze(['quota', 'user_abort', 'infra_outage', 'pre_dispatch_host_abort']);
const ORDINARY_STRIKE_THRESHOLD = 3;
const STRIKE_POLICY_VERSION = 2;

// Not a closed exclusion registry (that's EXTERNAL_CAUSE_EXCLUSIONS, writer-side,
// used by dispatch-hetero.sh in P4) — this is just the row-schema enum for `cause_class`.
const STRIKE_CAUSE_CLASSES = Object.freeze(['engine_output', 'runner_delivery', 'ambiguous']);
const STRIKE_CLASSES = Object.freeze(['ordinary_strike', 'critical_reexam_trigger']);
const STRIKE_KINDS = Object.freeze(['strike', 'strike_invalidated']);

const STRIKE_FIELDS_V2 = new Set([
  'schema_version', 'event_id', 'kind', 'seat_hash', 'engine', 'runner', 'role',
  'class', 'predicate_id', 'cause_class', 'writer', 'dedup_key',
  'detector_id', 'detector_version', 'artifact_sha256', 'receipt_ref', 'observed_at',
  'invalidates_event_id', 'proof_artifact_sha256', 'proof_detector_id',
]);

function isValidSeatToken(value) {
  return typeof value === 'string' && value.length > 0 && SEAT_TOKEN_RE.test(value);
}

// The engine token is a vendor model id, not an internal enumeration — it gets the
// wide ENGINE_TOKEN_RE (BLOCKER 1). runner/role stay on isValidSeatToken/SEAT_TOKEN_RE.
function isValidEngineToken(value) {
  return typeof value === 'string' && value.length > 0 && ENGINE_TOKEN_RE.test(value);
}

function normalizeSeatToken(raw, label) {
  if (typeof raw !== 'string') throw new Error(`${label} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`${label} must be non-empty`);
  if (!SEAT_TOKEN_RE.test(trimmed)) throw new Error(`${label} must match ${SEAT_TOKEN_RE}`);
  return trimmed;
}

function normalizeEngineToken(raw, label) {
  if (typeof raw !== 'string') throw new Error(`${label} must be a string`);
  // Vendor ids may legitimately contain internal spaces/parens/slashes but not
  // leading/trailing whitespace — trim only outer whitespace, same as normalizeSeatToken.
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error(`${label} must be non-empty`);
  if (!ENGINE_TOKEN_RE.test(trimmed)) throw new Error(`${label} must match ${ENGINE_TOKEN_RE}`);
  return trimmed;
}

// Seat identity: engine+runner+role, plus `effort` WHEN PRESENT. NOT model_version/endpoint.
//
// Effort joins the seat because it is a different qualification, not a different setting: real
// data — grok-4.6@high FAILED (23/24, one integrity violation, 2026-08-21) and grok-4.6@low
// QUALIFIED (24/24, 2026-08-24) — collapsed to ONE seat under a 3-field identity, latest-wins,
// so a failed high seat could inherit a passing low seat's standing.
//
// It is included ONLY when present, and that is load-bearing, not tidiness: an absent effort
// produces byte-identically the old three-key object, so every seat_hash already recorded stays
// valid and no strike is orphaned from its projection. Legacy rows are their own partition —
// the same "omit only for legacy rows" rule `current --effort` already uses, not a second rule.
//
// engine-scorecard.js's seatIdentityHash MUST stay identical to this; a divergence silently
// detaches every strike from the seat it was recorded against.
function normalizeSeatIdentity({ engine, runner, role, effort }) {
  return {
    engine: normalizeEngineToken(engine, 'engine'),
    runner: normalizeSeatToken(runner, 'runner'),
    role: normalizeSeatToken(role, 'role'),
    ...(effort === undefined || effort === null
      ? {}
      : { effort: normalizeSeatToken(effort, 'effort') }),
  };
}

function seatHashOf(seatIdentity) {
  return sha256(canonicalJson(normalizeSeatIdentity(seatIdentity)));
}

function validateStrikeV2Shape(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('invalid strike row shape');
  }
  if (Object.keys(row).some((key) => !STRIKE_FIELDS_V2.has(key))) {
    throw new Error('invalid strike row shape: unexpected key');
  }
  for (const key of STRIKE_FIELDS_V2) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      throw new Error(`invalid strike row shape: missing key ${key}`);
    }
  }
  if (row.schema_version !== 2) throw new Error('invalid strike row shape: schema_version');
  if (toEventId(row.event_id) === null) throw new Error('invalid strike row shape: event_id');
  if (!STRIKE_KINDS.includes(row.kind)) throw new Error('invalid strike row shape: kind');
  if (!isSha256(row.seat_hash)) throw new Error('invalid strike row shape: seat_hash');
  if (!isValidEngineToken(row.engine) || !isValidSeatToken(row.runner) || !isValidSeatToken(row.role)) {
    throw new Error('invalid strike row shape: engine/runner/role');
  }
  if (!STRIKE_CLASSES.includes(row.class)) throw new Error('invalid strike row shape: class');
  if (row.class === 'critical_reexam_trigger') {
    if (typeof row.predicate_id !== 'string' || !CRITICAL_REEXAM_PREDICATES.includes(row.predicate_id)) {
      throw new Error('invalid strike row shape: predicate_id must be a registered predicate for critical_reexam_trigger');
    }
  } else if (row.predicate_id !== null) {
    throw new Error('invalid strike row shape: predicate_id must be null unless class is critical_reexam_trigger');
  }
  if (!STRIKE_CAUSE_CLASSES.includes(row.cause_class)) {
    throw new Error('invalid strike row shape: cause_class');
  }
  if (!isValidSeatToken(row.writer)) throw new Error('invalid strike row shape: writer');
  if (typeof row.dedup_key !== 'string' || row.dedup_key.length === 0) {
    throw new Error('invalid strike row shape: dedup_key');
  }
  if (!isValidSeatToken(row.detector_id) || !isValidSeatToken(row.detector_version)) {
    throw new Error('invalid strike row shape: detector_id/detector_version');
  }
  if (!isSha256(row.artifact_sha256)) throw new Error('invalid strike row shape: artifact_sha256');
  if (typeof row.receipt_ref !== 'string' || row.receipt_ref.length === 0) {
    throw new Error('invalid strike row shape: receipt_ref');
  }
  if (typeof row.observed_at !== 'string' || Number.isNaN(Date.parse(row.observed_at))) {
    throw new Error('invalid strike row shape: observed_at');
  }
  if (row.kind === 'strike_invalidated') {
    if (toEventId(row.invalidates_event_id) === null) {
      throw new Error('invalid strike row shape: invalidates_event_id required for strike_invalidated');
    }
    if (!isSha256(row.proof_artifact_sha256)) {
      throw new Error('invalid strike row shape: proof_artifact_sha256 required for strike_invalidated');
    }
    if (!isValidSeatToken(row.proof_detector_id)) {
      throw new Error('invalid strike row shape: proof_detector_id required for strike_invalidated');
    }
  } else {
    if (row.invalidates_event_id !== null) {
      throw new Error('invalid strike row shape: invalidates_event_id must be null for kind strike');
    }
    if (row.proof_artifact_sha256 !== null) {
      throw new Error('invalid strike row shape: proof_artifact_sha256 must be null for kind strike');
    }
    if (row.proof_detector_id !== null) {
      throw new Error('invalid strike row shape: proof_detector_id must be null for kind strike');
    }
  }
  return row;
}

function readStrikeRows(strikesFile) {
  const lines = readTextLines(strikesFile);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    let row;
    try {
      row = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(`malformed strike line ${index + 1}: ${error.message}`);
    }
    try {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error('invalid strike row shape');
      }
      if (row.schema_version === 1) {
        validateStrikeV1Shape(row);
      } else if (row.schema_version === 2) {
        validateStrikeV2Shape(row);
      } else {
        throw new Error('unsupported schema_version');
      }
    } catch (error) {
      throw new Error(`malformed strike line ${index + 1}: ${error.message}`);
    }
    rows.push(row);
  }
  return rows;
}

// BLOCKER 6 fix: readStrikeRows (above) is STRICT — any invalid line throws — which
// is correct for a hand-authored / newly-written row, but production callers
// (append paths, brain-status) must not be permanently bricked by ONE prior corrupt
// line, since the throw was previously swallowed by dispatch-hetero.sh's fail-soft
// wrapper with no operator signal, disabling strike writing for EVERY seat. This
// reader skips-and-warns invalid lines (stderr, naming the line number) instead of
// throwing, while still deriving a correct, monotonic next event_id.
//
// Monotonicity under a corrupt/unreadable line: the strikes file is append-only and
// every append computes its event_id from a scan of the file at that instant, so
// rows land in the file in strictly increasing event_id order. A corrupt line
// therefore can only ever be "between" two readable event_ids that already bound it
// (any later readable row already has a higher event_id), UNLESS the corrupt line is
// the last line in the file with nothing after it to bound it. To cover that case too,
// this reader salvages `event_id` from any line that is valid JSON (even if the rest
// of the row fails shape validation, e.g. missing required keys) — that is the common
// real-world corruption shape (a partially-written or hand-edited row) and is exactly
// what BLOCKER 6's repro line `{"schema_version":2,"event_id":99,"kind":"strike"}`
// looks like. Only a line that is not even valid JSON (rare — mid-write torn line)
// cannot contribute an event_id; that residual risk is accepted and documented rather
// than silently ignored — the WARN names the exact line for an operator to inspect.
function readStrikeRowsLenient(strikesFile) {
  const lines = readTextLines(strikesFile);
  const rows = [];
  let maxSeenEventId = 0;
  for (let index = 0; index < lines.length; index += 1) {
    let raw;
    try {
      raw = JSON.parse(lines[index]);
    } catch (error) {
      process.stderr.write(`WARN: skipping unparseable strike line ${index + 1}: ${error.message}\n`);
      continue;
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const salvagedId = toEventId(raw.event_id);
      if (salvagedId !== null && salvagedId > maxSeenEventId) maxSeenEventId = salvagedId;
    }
    try {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid strike row shape');
      }
      if (raw.schema_version === 1) {
        validateStrikeV1Shape(raw);
      } else if (raw.schema_version === 2) {
        validateStrikeV2Shape(raw);
      } else {
        throw new Error('unsupported schema_version');
      }
    } catch (error) {
      process.stderr.write(`WARN: skipping malformed strike line ${index + 1}: ${error.message}\n`);
      continue;
    }
    rows.push(raw);
  }
  return { rows, maxSeenEventId };
}

function appendStrikeRecord(config, { identity, source, receiptRef, observedAt }) {
  if (!STRIKE_SOURCES.has(source)) {
    throw new Error(`strike source must be one of ${[...STRIKE_SOURCES].join('|')}`);
  }
  if (typeof receiptRef !== 'string' || receiptRef.trim().length === 0) {
    throw new Error('strike receipt_ref is required');
  }
  const identityHash = identityHashOf(identity);
  const observed = observedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(observed))) throw new Error('strike observed_at must be ISO-8601');
  return withWriteLock({
    storeDir: config.storeDir,
    lockFile: config.lockFile,
    name: 'capability strikes',
  }, () => {
    const { maxSeenEventId } = readStrikeRowsLenient(config.strikesFile);
    const row = {
      schema_version: 1,
      event_id: maxSeenEventId + 1,
      identity_hash: identityHash,
      source,
      observed_at: observed,
      receipt_ref: receiptRef.trim(),
    };
    appendRow(config.strikesFile, row);
    return row;
  });
}

// --- strike STORE v2 append/invalidate ---------------------------------------------

function normalizeStrikeClass(raw) {
  if (!STRIKE_CLASSES.includes(raw)) {
    throw new Error(`class must be one of ${STRIKE_CLASSES.join('|')}`);
  }
  return raw;
}

function normalizeCauseClass(raw) {
  if (!STRIKE_CAUSE_CLASSES.includes(raw)) {
    throw new Error(`cause_class must be one of ${STRIKE_CAUSE_CLASSES.join('|')}`);
  }
  return raw;
}

function normalizePredicateId(raw, klass) {
  if (klass === 'critical_reexam_trigger') {
    if (typeof raw !== 'string' || !CRITICAL_REEXAM_PREDICATES.includes(raw)) {
      throw new Error(`predicate_id must be one of ${CRITICAL_REEXAM_PREDICATES.join('|')} when class is critical_reexam_trigger`);
    }
    return raw;
  }
  if (raw !== null && raw !== undefined && raw !== '') {
    throw new Error('predicate_id must be omitted unless class is critical_reexam_trigger');
  }
  return null;
}

// `requireAllowlisted` is always true for both v2 append paths in this cut (P0
// enforces the allowlist at write time for strike AND strike_invalidated); a
// hand-written row bypassing the CLI can still land an un-allowlisted writer,
// which is why readStrikeRows/validateStrikeV2Shape do NOT re-check membership —
// that exclusion is the P1 projection's job (rejected_strikes), not a shape error.
function normalizeWriter(raw) {
  const token = normalizeSeatToken(raw, 'writer');
  if (!STRIKE_WRITER_ALLOWLIST.includes(token)) {
    throw new Error(`writer must be one of ${STRIKE_WRITER_ALLOWLIST.join('|')}`);
  }
  return token;
}

function normalizeNonEmptyString(raw, label) {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error(`${label} is required`);
  return raw;
}

function normalizeStrikeSha256(raw, label) {
  if (!isSha256(raw)) throw new Error(`${label} must be a 64-character hex sha256`);
  return raw.toLowerCase();
}

function normalizeStrikeObservedAt(raw) {
  const observed = raw || new Date().toISOString();
  if (typeof observed !== 'string' || Number.isNaN(Date.parse(observed))) {
    throw new Error('observed_at must be ISO-8601');
  }
  return observed;
}

function normalizeEventIdRef(raw, label) {
  const n = toEventId(raw);
  if (n === null || n < 1) throw new Error(`${label} must be a positive integer event id`);
  return n;
}

// Dedup-idempotent v2 strike append (§2.7.5 step 3 / plan §3 P0 bullet 1): a second
// append sharing (seat_hash, dedup_key) with an existing kind:'strike' row does NOT
// write a second line — it returns the existing row with `deduplicated: true` added
// only to the return value (never persisted).
// FINDING 4 fix (2026-08-22 review repair, dedup POISONING): only a row that
// would be COUNTABLE at read time is allowed to reserve a dedup key. Without
// this, a structurally-valid but non-allowlisted hand-written row (e.g.
// writer: "operator") could sit in the file, be excluded by the projection's
// read-time validation (rejected_strikes), and STILL match the write-side
// dedup lookup below — silently swallowing the real writer's legitimate
// strike as a no-op. A row that would not count must not be able to block
// one that would.
//
// Re-derives (does NOT import — same discipline as the model-id charset
// coupling documented at capability-evidence.js:129-141) the subset of
// scripts/engine-scorecard.js `foldSeatStrikes`' countable-strike predicate
// (P1, ~L1541-1550: validWriter / validReceipt / validArtifact) that a
// write-time row can evaluate WITHOUT the baseline/now window a read-time
// fold has and a write does not (no `validObserved` check here — this
// function only decides dedup-key eligibility, not final admission). The
// remaining projection checks (validClass, validPredicate, validDedup, valid
// event_id, and overall row shape) are already guaranteed for every row this
// function sees, because `rows` comes from readStrikeRowsLenient, which only
// yields rows that already passed validateStrikeV2Shape — a row failing
// those could not appear in `rows` at all.
//
// Fields validated here, exactly matching foldSeatStrikes' local names:
//   - writer         -> must be in STRIKE_WRITER_ALLOWLIST     (validWriter)
//   - receipt_ref     -> non-empty string                       (validReceipt)
//   - artifact_sha256 -> well-formed 64-hex sha256               (validArtifact)
//
// MUST stay in sync with foldSeatStrikes' validWriter/validReceipt/
// validArtifact checks in scripts/engine-scorecard.js: if that predicate
// changes, update this one in the same commit.
function isReadTimeCountableStrikeRow(row) {
  return typeof row.writer === 'string' && STRIKE_WRITER_ALLOWLIST.includes(row.writer)
    && typeof row.receipt_ref === 'string' && row.receipt_ref.length > 0
    && isSha256(row.artifact_sha256);
}

function appendStrikeSeatRecord(config, input) {
  const seatIdentity = normalizeSeatIdentity(input);
  const seatHash = seatHashOf(seatIdentity);
  const klass = normalizeStrikeClass(input.klass);
  const predicateId = normalizePredicateId(input.predicateId, klass);
  const causeClass = normalizeCauseClass(input.causeClass);
  const writer = normalizeWriter(input.writer);
  const dedupKey = normalizeNonEmptyString(input.dedupKey, 'dedup_key');
  const detectorId = normalizeSeatToken(input.detectorId, 'detector_id');
  const detectorVersion = normalizeSeatToken(input.detectorVersion, 'detector_version');
  const artifactSha256 = normalizeStrikeSha256(input.artifactSha256, 'artifact_sha256');
  const receiptRef = normalizeNonEmptyString(input.receiptRef, 'receipt_ref');
  const observedAt = normalizeStrikeObservedAt(input.observedAt);

  return withWriteLock({
    storeDir: config.storeDir,
    lockFile: config.lockFile,
    name: 'capability strikes',
  }, () => {
    const { rows, maxSeenEventId } = readStrikeRowsLenient(config.strikesFile);
    // Dedup key is (seat_hash, dedup_key, class) — BLOCKER 4 fix. Matching on
    // (seat_hash, dedup_key) alone was class-blind: an ordinary_strike already
    // holding a dedup_key silently swallowed a later critical_reexam_trigger
    // sharing that key, dropping the one class that ENFORCES today. A true
    // repeat of the SAME class still dedups to one line.
    //
    // FINDING 4 fix: the match ALSO requires the existing row to be
    // read-time-countable (isReadTimeCountableStrikeRow, above) — a
    // non-allowlisted or otherwise never-counted row must not be able to
    // reserve the key and suppress the legitimate strike.
    const existing = rows.find((row) => row.schema_version === 2
      && row.kind === 'strike'
      && row.seat_hash === seatHash
      && row.dedup_key === dedupKey
      && row.class === klass
      && isReadTimeCountableStrikeRow(row));
    if (existing) {
      return { row: existing, deduplicated: true };
    }
    const row = {
      schema_version: 2,
      event_id: maxSeenEventId + 1,
      kind: 'strike',
      seat_hash: seatHash,
      engine: seatIdentity.engine,
      runner: seatIdentity.runner,
      role: seatIdentity.role,
      class: klass,
      predicate_id: predicateId,
      cause_class: causeClass,
      writer,
      dedup_key: dedupKey,
      detector_id: detectorId,
      detector_version: detectorVersion,
      artifact_sha256: artifactSha256,
      receipt_ref: receiptRef,
      observed_at: observedAt,
      invalidates_event_id: null,
      proof_artifact_sha256: null,
      proof_detector_id: null,
    };
    validateStrikeV2Shape(row);
    appendRow(config.strikesFile, row);
    return { row, deduplicated: false };
  });
}

// `strike_invalidated` requires mechanical proof of detector defect (ADR-0001; no
// free-form rescind) and is rejected unless `invalidates_event_id` names an existing
// v2 kind:'strike' row for the SAME seat_hash. Its own class/predicate_id/cause_class
// are not independently supplied by the CLI (the frozen contract's invalidate-strike
// surface carries no --class/--predicate-id/--cause-class flags) — this cut copies
// them from the strike being invalidated, since the invalidation is a correction of
// that judgment, not an independent new one. Documented deviation: the frozen
// contract shows these keys on every v2 row but is silent on their source for a
// strike_invalidated row.
function appendStrikeInvalidation(config, input) {
  const seatIdentity = normalizeSeatIdentity(input);
  const seatHash = seatHashOf(seatIdentity);
  const invalidatesEventId = normalizeEventIdRef(input.invalidatesEventId, 'invalidates_event_id');
  const proofArtifactSha256 = normalizeStrikeSha256(input.proofArtifactSha256, 'proof_artifact_sha256');
  const proofDetectorId = normalizeSeatToken(input.proofDetectorId, 'proof_detector_id');
  const writer = normalizeWriter(input.writer);
  const dedupKey = normalizeNonEmptyString(input.dedupKey, 'dedup_key');
  const detectorId = normalizeSeatToken(input.detectorId, 'detector_id');
  const detectorVersion = normalizeSeatToken(input.detectorVersion, 'detector_version');
  const artifactSha256 = normalizeStrikeSha256(input.artifactSha256, 'artifact_sha256');
  const receiptRef = normalizeNonEmptyString(input.receiptRef, 'receipt_ref');
  const observedAt = normalizeStrikeObservedAt(input.observedAt);

  return withWriteLock({
    storeDir: config.storeDir,
    lockFile: config.lockFile,
    name: 'capability strikes',
  }, () => {
    const { rows, maxSeenEventId } = readStrikeRowsLenient(config.strikesFile);
    const target = rows.find((row) => row.schema_version === 2
      && row.kind === 'strike'
      && row.seat_hash === seatHash
      && toEventId(row.event_id) === invalidatesEventId);
    if (!target) {
      throw new Error(`invalidates_event_id ${invalidatesEventId} does not refer to an existing v2 strike row for this seat`);
    }
    const row = {
      schema_version: 2,
      event_id: maxSeenEventId + 1,
      kind: 'strike_invalidated',
      seat_hash: seatHash,
      engine: seatIdentity.engine,
      runner: seatIdentity.runner,
      role: seatIdentity.role,
      class: target.class,
      predicate_id: target.predicate_id,
      cause_class: target.cause_class,
      writer,
      dedup_key: dedupKey,
      detector_id: detectorId,
      detector_version: detectorVersion,
      artifact_sha256: artifactSha256,
      receipt_ref: receiptRef,
      observed_at: observedAt,
      invalidates_event_id: invalidatesEventId,
      proof_artifact_sha256: proofArtifactSha256,
      proof_detector_id: proofDetectorId,
    };
    validateStrikeV2Shape(row);
    appendRow(config.strikesFile, row);
    return row;
  });
}

const STRIKE_REVOCATION_THRESHOLD = 3;

function brainSeatStatus(config, rawIdentity, nowIso) {
  const identityHash = identityHashOf(rawIdentity);
  const evidenceRows = fs.existsSync(config.evidenceFile)
    ? readEvidenceRows(config.evidenceFile)
    : [];
  // Pass baseline = the newest QUALIFIED owner_brain_seat record for this identity.
  // Ordered fold (Board 2026-08-17): failed / insufficient_budget administrations
  // are recorded but never revoke; only strikes do; a later pass re-baselines.
  let baseline = null;
  for (const wrapper of evidenceRows) {
    const evidence = wrapper.evidence;
    if (evidence.role !== 'owner') continue;
    if (evidence.methodology.kind !== BRAIN_METHODOLOGY_KIND) continue;
    if (!Array.isArray(evidence.scope.task_classes)
        || evidence.scope.task_classes.length !== 1
        || evidence.scope.task_classes[0] !== 'brain-seat') continue;
    if (evidence.identity_hash !== identityHash) continue;
    if (evidence.state !== 'qualified') continue;
    if (nowIso && Date.parse(evidence.observed_at) > Date.parse(nowIso)) continue;
    if (!baseline
        || Date.parse(evidence.observed_at) > Date.parse(baseline.evidence.observed_at)
        || (Date.parse(evidence.observed_at) === Date.parse(baseline.evidence.observed_at)
          && wrapper.event_id > baseline.event_id)) {
      baseline = wrapper;
    }
  }
  // PINNED tiebreak: a strike stamped at EXACTLY the pass instant does not count —
  // the administration that issued the pass is still concluding at that timestamp,
  // so pass-instant strikes are pre-pass by construction (strictly-greater fold;
  // behavior pinned by test, QC 2026-08-17 sol strike-store-order adjudication).
  const strikes = readStrikeRowsLenient(config.strikesFile).rows.filter((row) => {
    // v2 seat-strike rows (§2.7.2) are a separate ledger entry shape and must never
    // leak into the brain-seat fold — explicit schema_version gate, not reliance on
    // v2 rows lacking identity_hash.
    if (row.schema_version !== 1) return false;
    if (row.identity_hash !== identityHash) return false;
    if (nowIso && Date.parse(row.observed_at) > Date.parse(nowIso)) return false;
    return baseline ? Date.parse(row.observed_at) > Date.parse(baseline.evidence.observed_at) : true;
  });
  let status = 'no_record';
  if (baseline) {
    status = strikes.length >= STRIKE_REVOCATION_THRESHOLD
      ? 'requalification_required'
      : 'qualified';
  }
  const baselineTrial = baseline && Array.isArray(baseline.evidence.trials)
    ? baseline.evidence.trials[0] : null;
  return {
    schema_version: 1,
    artifact_type: 'brain_seat_status',
    identity_hash: identityHash,
    status,
    strikes_since_pass: baseline ? strikes.length : 0,
    strike_threshold: STRIKE_REVOCATION_THRESHOLD,
    baseline_evidence_id: baseline ? baseline.evidence.evidence_id : null,
    baseline_observed_at: baseline ? baseline.evidence.observed_at : null,
    construct_scope: baselineTrial ? baselineTrial.construct_scope : BRAIN_CONSTRUCT_SCOPE,
  };
}

function buildObservedRevocation(target, observation, observedAt) {
  let reason = null;
  if (observation.identity_hash !== target.identity_hash) {
    reason = 'semantic_identity_drift';
  } else if (observation.critical_miss === true) {
    reason = 'critical_miss';
  } else if (observation.probe_regression === true) {
    reason = 'probe_regression';
  }
  if (reason === null) return null;
  const observationHash = sha256(canonicalJson(observation));
  return compileCapabilityEvidence({
    schema_version: 1,
    source: 'runtime_probe',
    source_ref: `current-evidence:${reason}`,
    state: 'revoked',
    role: target.role,
    scope: target.scope,
    identity: target.identity,
    issued_at: observedAt,
    observed_at: observedAt,
    expires_at: new Date(Date.parse(observedAt) + 86_400_000).toISOString(),
    methodology: {
      kind: 'runtime_probe',
      name: 'owner-kernel-runtime-observation',
      version: '1.0.0',
      corpus_version: null,
      corpus_manifest_hash: null,
      thresholds: null,
      basis: {
        cohort: 'exact-session-observation',
        cohort_hash: sha256(canonicalJson({
          role: target.role,
          scope_hash: target.scope_hash,
          identity_hash: target.identity_hash,
        })),
        observation_hash: observationHash,
        dimensions: [reason],
        applicability: ['exact-identity', 'exact-scope'],
      },
    },
    trials: [],
    revocation: {
      reason,
      observation_hash: observationHash,
      target_evidence_id: target.evidence_id,
    },
    supersedes: target.evidence_id,
  });
}

function currentEvidenceRows(rows, role, nowIso) {
  const groups = new Map();
  for (const wrapper of rows) {
    const evidence = wrapper.evidence;
    if (evidence.role !== role) continue;
    const key = `${evidence.role}\u0000${evidence.scope_hash}\u0000${evidence.identity_hash}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(wrapper);
  }
  return Array.from(groups.values()).map((group) => {
    const newest = group.reduce(
      (winner, row) => (row.event_id > winner.event_id ? row : winner),
      group[0],
    );
    const receipt = evaluateCapabilityEvidence(group.map((row) => row.evidence), {
      role: newest.evidence.role,
      scope: newest.evidence.scope,
      identity: newest.evidence.identity,
      evaluation_time: nowIso,
    });
    return {
      event_id: newest.event_id,
      ...evidenceResolution(rows, receipt, nowIso),
    };
  }).sort((left, right) => left.event_id - right.event_id);
}

function endpointRowKey(row) {
  if (!Object.prototype.hasOwnProperty.call(row, 'endpoint')) return 'legacy';
  if (row.endpoint === null) return 'exact:null';
  if (typeof row.endpoint !== 'string' || !ENDPOINT_NAME_RE.test(row.endpoint)) {
    return `invalid:${toEventId(row.event_id) || 0}`;
  }
  return `exact:${row.endpoint}`;
}

function endpointSelection(raw, supplied) {
  if (!supplied) {
    return { key: 'legacy', endpoint: null, binding: 'ambiguous-legacy' };
  }
  if (raw === ENDPOINT_NULL_SELECTOR) {
    return { key: 'exact:null', endpoint: null, binding: 'exact' };
  }
  if (typeof raw !== 'string' || !ENDPOINT_NAME_RE.test(raw)) {
    failUsage('--endpoint must be a canonical name or "@none"');
  }
  return { key: `exact:${raw}`, endpoint: raw, binding: 'exact' };
}

function effortRowKey(row) {
  if (!Object.prototype.hasOwnProperty.call(row, 'effort')) return 'legacy';
  if (typeof row.effort !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(row.effort)) {
    return `invalid:${toEventId(row.event_id) || 0}`;
  }
  return `exact:${row.effort}`;
}

function effortSelection(raw, supplied) {
  if (!supplied) {
    return { key: 'legacy', effort: null, binding: 'ambiguous-legacy' };
  }
  if (typeof raw !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(raw)) {
    failUsage('--effort must be a bounded classification code');
  }
  return { key: `exact:${raw}`, effort: raw, binding: 'exact' };
}

// Logic to merge events per runner, model, role, effort and endpoint identity.
function mergeCurrentState(
  rows,
  runner,
  model,
  role,
  nowMs,
  endpoint = endpointSelection(null, false),
  effort = effortSelection(null, false),
  quotaRoleScope = 'pool',
) {
  let mergedQuota = null;
  let mergedSkill = null;
  // context_window is merged ROLE-AGNOSTICALLY (like quota, unlike skill_transport):
  // a model's window is a property of the model, not of the seat it is dispatched into.
  let mergedCtx = null;

  for (const row of rows) {
    if (row.runner !== runner || row.model !== model
        || endpointRowKey(row) !== endpoint.key
        || effortRowKey(row) !== effort.key) {
      continue;
    }

    // Process capability.quota — ROLE-AGNOSTIC: quota is a per-MODEL pool (subscription
    // pools and endpoint wallets are account-level, not role-level). Keying the merge on
    // role fragmented the pool: a live 'available' probe recorded under role=reviewer
    // could never clear a stale-but-unexpired 'exhausted' recorded under role=implementer
    // (2026-07-17 grok incident, events 13 vs 15). skill_transport below stays role-keyed.
    if (row.capability && row.capability.quota
        && (quotaRoleScope === 'pool' || row.role === role)) {
      const q = row.capability.quota;
      const observedMs = toDateMs(row.observed_at) || nowMs;
      const ttlMs = q.ttl_seconds * 1000;
      const isExpired = (observedMs + ttlMs) <= nowMs;

      let status = q.status;
      let confidence = q.confidence;
      let reset_at = q.reset_at;
      let evidence = q.evidence;
      let ttl_seconds = q.ttl_seconds;

      // Expired medium/low quota is ignored — but must NOT `continue` (that would also
      // skip the skill_transport in this SAME row, a real bug once a bench event carries
      // both quota and skill_transport). Guard only the quota merge. (gpt-5.5 batch2 R2 M1)
      const quotaIgnored = isExpired && confidence !== 'high';
      if (isExpired && confidence === 'high') {
        status = 'unknown'; // Expired high becomes unknown
      }
      if (!quotaIgnored) {
      const candidate = {
        status,
        confidence,
        reset_at,
        evidence,
        ttl_seconds,
        isExpired,
        observedMs,
        observedAt: row.observed_at,
        sourceRole: row.role,
        eventId: toEventId(row.event_id) || 0
      };

      if (!mergedQuota) {
        mergedQuota = candidate;
      } else {
        let overwrite = false;
        const isRealSignal = (s) => s === 'available' || s === 'limited' || s === 'exhausted';
        const hasValidRealSignal = isRealSignal(mergedQuota.status) && !mergedQuota.isExpired;

        if (candidate.status === 'unknown' && hasValidRealSignal) {
          overwrite = false;
        } else {
          if (candidate.isExpired) {
            // If candidate is expired (high), it can only overwrite if existing is also expired and candidate has higher eventId
            if (mergedQuota.isExpired && candidate.eventId > mergedQuota.eventId) {
              overwrite = true;
            }
          } else {
            // Candidate is NOT expired
            if (mergedQuota.isExpired) {
              overwrite = true; // Non-expired wins over expired
            } else {
              // Both non-expired
              if (candidate.confidence === 'high') {
                if (mergedQuota.confidence === 'high') {
                  if (candidate.eventId > mergedQuota.eventId) {
                    overwrite = true;
                  }
                } else {
                  overwrite = true;
                }
              } else if (mergedQuota.confidence !== 'high') {
                if (candidate.eventId > mergedQuota.eventId) {
                  overwrite = true; // Newer medium/low beats older medium/low
                }
              }
            }
          }
        }

        if (overwrite) {
          mergedQuota = candidate;
        }
      }
      } // end if (!quotaIgnored)
    }

    // Process capability.skill_transport — merge PER FIELD (native and prompt_pack
    // INDEPENDENTLY): a native-only bench must NOT clobber a prior prompt_pack result and
    // vice versa. For each field, the latest event whose value is not 'unknown' wins;
    // last_bench_id follows the latest skill event overall. (gpt-5.5 batch2 R2 M1)
    if (row.role === role && row.capability && row.capability.skill_transport) {
      const s = row.capability.skill_transport;
      const eid = toEventId(row.event_id) || 0;
      if (!mergedSkill) {
        mergedSkill = {
          native: null,
          nativeEventId: -1,
          nativeObservedAt: null,
          prompt_pack: null,
          promptEventId: -1,
          promptObservedAt: null,
          last_bench_id: null,
          eventId: -1,
          observedAt: null,
        };
      }
      if (s.native !== undefined && s.native !== 'unknown' && eid > mergedSkill.nativeEventId) {
        mergedSkill.native = s.native;
        mergedSkill.nativeEventId = eid;
        // Carry the observed_at of the event that actually set native, NOT the merged
        // aggregate observed_at (which follows the latest event of ANY field). A fresh
        // quota-only event must not make a stale native signal look fresh. (gpt-5.5 P6 F4)
        mergedSkill.nativeObservedAt = row.observed_at || null;
      }
      if (s.prompt_pack !== undefined && s.prompt_pack !== 'unknown' && eid > mergedSkill.promptEventId) {
        mergedSkill.prompt_pack = s.prompt_pack;
        mergedSkill.promptEventId = eid;
        mergedSkill.promptObservedAt = row.observed_at || null;
      }
      if (eid >= mergedSkill.eventId) {
        mergedSkill.eventId = eid;
        mergedSkill.observedAt = row.observed_at || null;
        mergedSkill.last_bench_id = (s.last_bench_id !== undefined ? s.last_bench_id : null);
      }
    }

    // Process capability.context_window — latest event carrying a non-null total_tokens
    // wins. A null reading means "observed nothing" and must never clobber a valid
    // window, mirroring the 'unknown' discipline used for skill_transport.
    if (row.capability && row.capability.context_window) {
      const c = row.capability.context_window;
      const eid = toEventId(row.event_id) || 0;
      if (!mergedCtx) {
        mergedCtx = { total_tokens: null, eventId: -1, observedAt: null, evidence: null };
      }
      if (c.total_tokens !== undefined && c.total_tokens !== null && eid > mergedCtx.eventId) {
        mergedCtx.total_tokens = c.total_tokens;
        mergedCtx.eventId = eid;
        mergedCtx.observedAt = row.observed_at || null;
        mergedCtx.evidence = (c.evidence !== undefined ? c.evidence : null);
      }
    }
  }

  // Construct final merged output
  const quotaStatus = mergedQuota ? mergedQuota.status : 'unknown';
  const quotaConfidence = mergedQuota ? mergedQuota.confidence : 'low';
  const quotaResetAt = mergedQuota ? mergedQuota.reset_at : null;
  const quotaEvidence = mergedQuota ? mergedQuota.evidence : null;
  const quotaTtlSeconds = mergedQuota ? mergedQuota.ttl_seconds : 0;

  const skillNative = (mergedSkill && mergedSkill.native !== null) ? mergedSkill.native : 'unknown';
  const skillPromptPack = (mergedSkill && mergedSkill.prompt_pack !== null) ? mergedSkill.prompt_pack : 'unknown';
  const skillLastBenchId = mergedSkill ? mergedSkill.last_bench_id : null;

  // Keep time provenance on the winning exact-wallet candidates. A global event-id
  // lookup could borrow observed_at from another endpoint when a hand-edited store
  // contains duplicate IDs.
  const finalCandidate = [mergedQuota, mergedSkill, mergedCtx]
    .filter((candidate) => candidate && candidate.eventId > 0)
    .reduce((latest, candidate) => (
      !latest || candidate.eventId > latest.eventId ? candidate : latest
    ), null);
  const finalEventId = finalCandidate ? finalCandidate.eventId : 1;
  const finalObserved = finalCandidate && finalCandidate.observedAt
    ? finalCandidate.observedAt
    : new Date(nowMs).toISOString();

  return {
    schema_version: 1,
    event_id: finalEventId,
    observed_at: finalObserved,
    runner,
    model,
    role,
    effort: effort.effort,
    effort_binding: effort.binding,
    endpoint: endpoint.endpoint,
    endpoint_binding: endpoint.binding,
    runner_version: null,
    capability: {
      quota: {
        status: quotaStatus,
        reset_at: quotaResetAt,
        confidence: quotaConfidence,
        evidence: quotaEvidence,
        ttl_seconds: quotaTtlSeconds,
        observed_at: mergedQuota ? mergedQuota.observedAt : null,
        event_id: mergedQuota ? mergedQuota.eventId : null,
        // Output-only (not part of the recorded event schema): which role's observation
        // won the role-agnostic per-model merge. Provenance for cross-role clears.
        source_role: mergedQuota ? mergedQuota.sourceRole : null
      },
      skill_transport: {
        native: skillNative,
        prompt_pack: skillPromptPack,
        last_bench_id: skillLastBenchId,
        // Per-field observation times (output-only; not part of the recorded event schema).
        // Consumers gating on freshness MUST use these, not the aggregate observed_at. (gpt-5.5 P6 F4)
        native_observed_at: (mergedSkill && mergedSkill.native !== null) ? mergedSkill.nativeObservedAt : null,
        prompt_pack_observed_at: (mergedSkill && mergedSkill.prompt_pack !== null) ? mergedSkill.promptObservedAt : null
      },
      context_window: {
        total_tokens: mergedCtx ? mergedCtx.total_tokens : null,
        evidence: mergedCtx ? mergedCtx.evidence : null,
        // Per-field observation time (output-only). A consumer sizing a dispatch should
        // treat a stale window as suspect, so it must not read the aggregate observed_at.
        observed_at: (mergedCtx && mergedCtx.total_tokens !== null) ? mergedCtx.observedAt : null
      }
    }
  };
}

function parseCommandLineArgs(argv) {
  const command = argv[0];
  const commandOptions = new Map([
    ['record', new Set(['file', 'store'])],
    ['current', new Set([
      'runner',
      'model',
      'role',
      'effort',
      'endpoint',
      'role-scope',
      'now',
      'store',
    ])],
    ['report', new Set(['capability', 'now', 'store'])],
    ['record-evidence', new Set(['file', 'store'])],
    ['current-evidence', new Set([
      'role',
      'scope-file',
      'identity-file',
      'observation-file',
      'now',
      'store',
    ])],
    ['report-evidence', new Set(['role', 'now', 'store'])],
    ['prune', new Set(['now', 'store'])],
    ['classify-error', new Set(['string', 'file', 'exit-code'])],
    ['strike', new Set(['identity-file', 'source', 'receipt-ref', 'now', 'store'])],
    ['brain-status', new Set(['identity-file', 'now', 'store'])],
    ['strike-seat', new Set([
      'engine', 'runner', 'role', 'effort', 'class', 'predicate-id', 'cause-class', 'writer',
      'dedup-key', 'detector-id', 'detector-version', 'artifact-sha256', 'receipt-ref',
      'now', 'store',
    ])],
    ['invalidate-strike', new Set([
      'engine', 'runner', 'role', 'effort', 'invalidates-event-id',
      'proof-artifact-sha256', 'proof-detector-id',
      'writer', 'dedup-key', 'detector-id', 'detector-version',
      'artifact-sha256', 'receipt-ref', 'now', 'store',
    ])],
    ['seat-hash', new Set(['engine', 'runner', 'role', 'effort'])],
  ]);
  const allowed = commandOptions.get(command);
  if (!allowed) return { command, options: {} };
  const options = {};
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      failUsage(`unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (!allowed.has(key)) failUsage(`unknown option for ${command}: ${arg}`);
    if (Object.prototype.hasOwnProperty.call(options, key)) {
      failUsage(`duplicate option: ${arg}`);
    }
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) {
      failUsage(`${arg} requires a value`);
    }
    options[key] = argv[++i];
  }

  return { command, options };
}

function classifyErrorContent(content) {
  const text = String(content).toLowerCase();

  // quota_exhausted: billing/quota limit hit
  if (
    text.includes('quota exceeded') ||
    text.includes('exceeded your current quota') ||
    text.includes('exceeded quota') ||
    text.includes('usage limit') ||
    text.includes('hit your usage limit') ||
    text.includes('out of credits') ||
    text.includes('credits exhausted') ||
    text.includes('insufficient credits') ||
    text.includes('insufficient funds') ||
    text.includes('insufficient_funds') ||
    text.includes('billing hard limit') ||
    text.includes('free tier limit') ||
    text.includes('run out of credits') ||
    text.includes('quota limit') ||
    text.includes('billing quota')
  ) {
    return 'quota_exhausted';
  }
  // payment/balance phrases need a numeric HTTP-error shape so bare prose
  // ("the payment required field on the checkout form", "payment required status
  // update") is not misclassified. Require \b402\b or status[ :=]4xx / error 4xx —
  // bare "status"/"error"/"http" substrings alone are too wide (A01 D1).
  const hasNumericHttpQuotaCtx = /\b402\b/.test(text)
    || /\bstatus\s*[:=]\s*4\d\d\b/i.test(text)
    || /\berror\s*[:(]?\s*4\d\d\b/i.test(text)
    || /\bhttp(?:\s+status)?\s*[:=]?\s*4\d\d\b/i.test(text);
  if ((text.includes('balance exhausted') || text.includes('payment required')) && hasNumericHttpQuotaCtx) {
    return 'quota_exhausted';
  }

  // rate_limited: too many requests (429)
  if (
    text.includes('rate limit') ||
    text.includes('ratelimit') ||
    text.includes('too many requests') ||
    text.includes('429') ||
    text.includes('request limit') ||
    text.includes('request_limit') ||
    text.includes('tpm limit') ||
    text.includes('rpm limit')
  ) {
    return 'rate_limited';
  }

  // overloaded: provider capacity / overload (529), NOT same as quota/reset signal
  if (
    text.includes('overloaded') ||
    text.includes('overload') ||
    text.includes('529') ||
    text.includes('service unavailable') ||
    text.includes('temporary overload') ||
    text.includes('capacity') ||
    text.includes('temporarily overloaded') ||
    text.includes('server overloaded')
  ) {
    return 'overloaded';
  }

  // auth_failed: bad API key / auth error
  if (
    text.includes('api key') ||
    text.includes('auth') ||
    text.includes('authentication') ||
    text.includes('unauthorized') ||
    text.includes('401') ||
    text.includes('invalid key') ||
    text.includes('credentials') ||
    text.includes('permission denied') ||
    text.includes('invalid_api_key') ||
    text.includes('key not found')
  ) {
    return 'auth_failed';
  }

  // network_failed: timeouts, connection errors
  if (
    text.includes('network') ||
    text.includes('connect') ||
    text.includes('timeout') ||
    text.includes('socket') ||
    text.includes('dns') ||
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('connection timed out') ||
    text.includes('read timeout') ||
    text.includes('gateway timeout') ||
    text.includes('504')
  ) {
    return 'network_failed';
  }

  return 'unknown';
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(2);
  if (isHelpToken(argv[0])) usage(0);

  const { command, options } = parseCommandLineArgs(argv);

  if (!command) failUsage('No subcommand specified');

  const nowMs = options.now ? toDateMs(options.now) : Date.now();
  if (options.now && nowMs === null) {
    failUsage(`invalid --now date: ${options.now}`);
  }

  if (command === 'record') {
    const rawInput = options.file
      ? fs.readFileSync(options.file, 'utf8')
      : fs.readFileSync(0, 'utf8');

    let event;
    try {
      event = JSON.parse(rawInput);
    } catch (err) {
      failValidation(`record input: invalid JSON (${err.message})`);
    }

    validateEvent(event);

    const { storeDir, storeFile, lockFile } = resolveStoreConfig(options);

    const storedRow = { ...event };
    delete storedRow.event_id;

    const writtenRow = withWriteLock({ storeDir, lockFile, name: 'capability' }, () => {
      const rows = readStoreRows(storeFile, true);
      const assigned = maxEventId(rows) + 1;
      const row = { ...storedRow, event_id: assigned };
      ensureDir(storeDir);
      appendRow(storeFile, row);
      return row;
    });

    process.stdout.write(`${JSON.stringify(writtenRow)}\n`);
    process.exit(0);
  }

  if (command === 'record-evidence') {
    const rawInput = options.file
      ? fs.readFileSync(options.file, 'utf8')
      : fs.readFileSync(0, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(rawInput);
    } catch (error) {
      failValidation(`record-evidence input: invalid JSON (${error.message})`);
    }
    let evidence;
    try {
      evidence = compileCapabilityEvidence(parsed);
    } catch (error) {
      failValidation(`record-evidence input: ${error.message}`);
    }
    if (evidence.source === 'internal_eval' || evidence.state === 'qualified') {
      failValidation(
        'record-evidence cannot mint internal/qualified evidence; run engine-qualify instead',
      );
    }
    const config = resolveStoreConfig(options);
    let written;
    try {
      written = appendEvidenceRecord(config, evidence, 'operator-record-v1');
    } catch (error) {
      failValidation(`qualification evidence store: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify(written)}\n`);
    process.exit(0);
  }

  if (command === 'strike') {
    if (!options['identity-file'] || !options.source || !options['receipt-ref']) {
      failUsage('strike requires --identity-file, --source, and --receipt-ref');
    }
    const identity = readJsonObject(options['identity-file'], 'identity file');
    const config = resolveStoreConfig(options);
    let row;
    try {
      row = appendStrikeRecord(config, {
        identity,
        source: options.source,
        receiptRef: options['receipt-ref'],
        observedAt: options.now,
      });
    } catch (error) {
      failValidation(`strike ledger: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify({ schema_version: 1, artifact_type: 'brain_seat_strike', ...row })}\n`);
    process.exit(0);
  }

  if (command === 'brain-status') {
    if (!options['identity-file']) failUsage('brain-status requires --identity-file');
    const identity = readJsonObject(options['identity-file'], 'identity file');
    const config = resolveStoreConfig(options);
    let status;
    try {
      status = brainSeatStatus(config, identity, options.now || null);
    } catch (error) {
      failValidation(`brain-status: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify(status)}\n`);
    process.exit(0);
  }

  if (command === 'strike-seat') {
    const required = ['engine', 'runner', 'role', 'class', 'cause-class', 'writer', 'dedup-key', 'detector-id', 'detector-version', 'artifact-sha256', 'receipt-ref'];
    for (const key of required) {
      if (!options[key]) failUsage(`strike-seat requires --${key}`);
    }
    const config = resolveStoreConfig(options);
    let result;
    try {
      result = appendStrikeSeatRecord(config, {
        engine: options.engine,
        runner: options.runner,
        role: options.role,
        // Without this a strike lands on the LEGACY seat hash while an effort-partitioned seat's
        // projection reads a different one — the strike would be recorded and never counted.
        effort: options.effort,
        klass: options.class,
        predicateId: Object.prototype.hasOwnProperty.call(options, 'predicate-id') ? options['predicate-id'] : null,
        causeClass: options['cause-class'],
        writer: options.writer,
        dedupKey: options['dedup-key'],
        detectorId: options['detector-id'],
        detectorVersion: options['detector-version'],
        artifactSha256: options['artifact-sha256'],
        receiptRef: options['receipt-ref'],
        observedAt: options.now,
      });
    } catch (error) {
      failValidation(`strike-seat: ${error.message}`);
    }
    const output = result.deduplicated ? { ...result.row, deduplicated: true } : result.row;
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exit(0);
  }

  if (command === 'invalidate-strike') {
    const required = ['engine', 'runner', 'role', 'invalidates-event-id', 'proof-artifact-sha256', 'proof-detector-id', 'writer', 'dedup-key', 'detector-id', 'detector-version', 'artifact-sha256', 'receipt-ref'];
    for (const key of required) {
      if (!options[key]) failUsage(`invalidate-strike requires --${key}`);
    }
    const config = resolveStoreConfig(options);
    let row;
    try {
      row = appendStrikeInvalidation(config, {
        engine: options.engine,
        runner: options.runner,
        role: options.role,
        invalidatesEventId: options['invalidates-event-id'],
        proofArtifactSha256: options['proof-artifact-sha256'],
        proofDetectorId: options['proof-detector-id'],
        writer: options.writer,
        dedupKey: options['dedup-key'],
        detectorId: options['detector-id'],
        detectorVersion: options['detector-version'],
        artifactSha256: options['artifact-sha256'],
        receiptRef: options['receipt-ref'],
        observedAt: options.now,
      });
    } catch (error) {
      failValidation(`invalidate-strike: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify(row)}\n`);
    process.exit(0);
  }

  if (command === 'seat-hash') {
    if (!options.engine || !options.runner || !options.role) {
      failUsage('seat-hash requires --engine, --runner, and --role');
    }
    let hash;
    try {
      hash = seatHashOf({
        engine: options.engine,
        runner: options.runner,
        role: options.role,
        // Omitted --effort is the legacy partition, not a default — passing undefined
        // reproduces the pre-effort hash byte-for-byte.
        effort: options.effort,
      });
    } catch (error) {
      failValidation(`seat-hash: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify({ seat_hash: hash })}\n`);
    process.exit(0);
  }

  if (command === 'current-evidence') {
    if (!options.role || !options['scope-file'] || !options['identity-file']) {
      failUsage('--role, --scope-file, and --identity-file are required for current-evidence');
    }
    const scope = readJsonObject(options['scope-file'], 'scope file');
    const identity = readJsonObject(options['identity-file'], 'identity file');
    const observation = options['observation-file']
      ? readJsonObject(options['observation-file'], 'observation file') : undefined;
    const config = resolveStoreConfig(options);
    let rows;
    try {
      rows = readEvidenceRows(config.evidenceFile);
    } catch (error) {
      failValidation(`qualification evidence store: ${error.message}`);
    }
    const evaluationTime = new Date(nowMs).toISOString();
    let result;
    try {
      const base = evaluateCapabilityEvidence(
        rows.map((row) => row.evidence),
        {
          role: options.role,
          scope,
          identity,
          evaluation_time: evaluationTime,
        },
      );
      if (observation !== undefined && base.state === 'qualified') {
        const target = rows.find((row) => row.evidence.evidence_id === base.evidence_id);
        const revocation = target
          ? buildObservedRevocation(target.evidence, observation, evaluationTime)
          : null;
        if (revocation) {
          appendEvidenceRecord(config, revocation, 'trusted-observation-v1');
          rows = readEvidenceRows(config.evidenceFile);
        }
      }
      const receipt = evaluateCapabilityEvidence(
        rows.map((row) => row.evidence),
        {
          role: options.role,
          scope,
          identity,
          evaluation_time: evaluationTime,
        },
      );
      result = evidenceResolution(rows, receipt, evaluationTime);
    } catch (error) {
      failValidation(`current-evidence query: ${error.message}`);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(0);
  }

  if (command === 'report-evidence') {
    if (!options.role) failUsage('--role is required for report-evidence');
    const { evidenceFile } = resolveStoreConfig(options);
    let rows;
    try {
      rows = readEvidenceRows(evidenceFile);
    } catch (error) {
      failValidation(`qualification evidence store: ${error.message}`);
    }
    const output = currentEvidenceRows(
      rows,
      options.role,
      new Date(nowMs).toISOString(),
    );
    process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exit(0);
  }

  if (command === 'current') {
    if (!options.runner || !options.model || !options.role) {
      failUsage('--runner, --model, and --role are required for current');
    }

    const { storeFile } = resolveStoreConfig(options);
    const rows = readStoreRows(storeFile, true);

    const selectedEndpoint = endpointSelection(
      options.endpoint,
      Object.prototype.hasOwnProperty.call(options, 'endpoint'),
    );
    const selectedEffort = effortSelection(
      options.effort,
      Object.prototype.hasOwnProperty.call(options, 'effort'),
    );
    const roleScope = options['role-scope'] || 'pool';
    if (roleScope !== 'pool' && roleScope !== 'exact') {
      failUsage('--role-scope must be "pool" or "exact"');
    }
    const merged = mergeCurrentState(
      rows,
      options.runner,
      options.model,
      options.role,
      nowMs,
      selectedEndpoint,
      selectedEffort,
      roleScope,
    );
    process.stdout.write(`${JSON.stringify(merged)}\n`);
    process.exit(0);
  }

  if (command === 'report') {
    const capability = options.capability || 'quota';
    if (capability !== 'quota') {
      failUsage(`Only capability 'quota' is supported for report in Batch 1`);
    }

    const { storeFile } = resolveStoreConfig(options);
    const rows = readStoreRows(storeFile, true);

    // Group rows by (runner, model, effort, endpoint identity). Quota remains role-agnostic
    // only inside one exact wallet+effort pool. Legacy rows retain an ambiguous group.
    const groups = new Map();
    for (const row of rows) {
      const endpointKey = endpointRowKey(row);
      if (endpointKey.startsWith('invalid:')) continue;
      const effortKey = effortRowKey(row);
      if (effortKey.startsWith('invalid:')) continue;
      const key = `${row.runner}\u0000${row.model}\u0000${effortKey}\u0000${endpointKey}`;
      const selection = endpointKey === 'legacy'
        ? endpointSelection(null, false)
        : endpointSelection(
          row.endpoint === null ? ENDPOINT_NULL_SELECTOR : row.endpoint,
          true,
        );
      const effort = effortKey === 'legacy'
        ? effortSelection(null, false)
        : effortSelection(row.effort, true);
      groups.set(key, {
        runner: row.runner,
        model: row.model,
        endpoint: selection,
        effort,
      });
    }

    const mergedList = [];
    for (const {
      runner,
      model,
      endpoint,
      effort,
    } of groups.values()) {
      // First pass (role null) resolves the winning quota observation; the emitted row's
      // role echoes that observation's source role, and skill_transport follows it.
      const probe = mergeCurrentState(
        rows,
        runner,
        model,
        null,
        nowMs,
        endpoint,
        effort,
      );
      const q = probe.capability && probe.capability.quota;
      if (q && q.status !== 'unknown') {
        const merged = (q.source_role != null)
          ? mergeCurrentState(
            rows,
            runner,
            model,
            q.source_role,
            nowMs,
            endpoint,
            effort,
          )
          : probe;
        mergedList.push(merged);
      }
    }

    // Sort by runner, model, role
    mergedList.sort((a, b) => {
      if (a.runner !== b.runner) return a.runner < b.runner ? -1 : 1;
      if (a.model !== b.model) return a.model < b.model ? -1 : 1;
      const aEffort = a.effort_binding === 'ambiguous-legacy'
        ? '' : String(a.effort);
      const bEffort = b.effort_binding === 'ambiguous-legacy'
        ? '' : String(b.effort);
      if (aEffort !== bEffort) return aEffort < bEffort ? -1 : 1;
      const aEndpoint = a.endpoint_binding === 'ambiguous-legacy'
        ? '' : String(a.endpoint);
      const bEndpoint = b.endpoint_binding === 'ambiguous-legacy'
        ? '' : String(b.endpoint);
      if (aEndpoint !== bEndpoint) return aEndpoint < bEndpoint ? -1 : 1;
      if (a.role !== b.role) return a.role < b.role ? -1 : 1;
      return 0;
    });

    process.stdout.write(`${JSON.stringify(mergedList)}\n`);
    process.exit(0);
  }

  if (command === 'prune') {
    const { storeDir, storeFile, lockFile } = resolveStoreConfig(options);
    if (!fs.existsSync(storeFile)) {
      process.stdout.write(`Pruned 0 events (store file does not exist)\n`);
      process.exit(0);
    }

    let prunedCount = 0;
    withWriteLock({ storeDir, lockFile, name: 'capability' }, () => {
      const rows = readStoreRows(storeFile, true);
      const keptRows = [];

      // Group rows by endpoint too; one wallet must never protect or prune another wallet's
      // observations. Find the latest event for each exact key, AND the latest
      // carrier of each skill_transport field. A row can hold the latest native / prompt_pack
      // signal while a later quota-only row has a higher event_id — pruning it purely on quota
      // TTL expiry would silently revert that skill signal to unknown. Protect the latest
      // carrier of each field (mirrors mergeCurrentState's per-field selection). (gpt-5.5 P6 F2)
      const latestEvents = new Map();
      const latestNative = new Map();
      const latestPrompt = new Map();
      for (const row of rows) {
        const key = `${row.runner}\u0000${row.model}\u0000${row.role}\u0000${effortRowKey(row)}\u0000${endpointRowKey(row)}`;
        const currentId = toEventId(row.event_id) || 0;
        const existingId = latestEvents.get(key) || 0;
        if (currentId > existingId) {
          latestEvents.set(key, currentId);
        }
        const st = row.capability && row.capability.skill_transport;
        if (st) {
          if (st.native !== undefined && st.native !== 'unknown' && currentId > (latestNative.get(key) || 0)) {
            latestNative.set(key, currentId);
          }
          if (st.prompt_pack !== undefined && st.prompt_pack !== 'unknown' && currentId > (latestPrompt.get(key) || 0)) {
            latestPrompt.set(key, currentId);
          }
        }
      }

      for (const row of rows) {
        const key = `${row.runner}\u0000${row.model}\u0000${row.role}\u0000${effortRowKey(row)}\u0000${endpointRowKey(row)}`;
        const currentId = toEventId(row.event_id) || 0;
        const isLatest = latestEvents.get(key) === currentId;
        const isSkillCarrier =
          (currentId > 0 && latestNative.get(key) === currentId) ||
          (currentId > 0 && latestPrompt.get(key) === currentId);

        let expired = false;
        if (row.capability && row.capability.quota) {
          const q = row.capability.quota;
          const observedMs = toDateMs(row.observed_at) || nowMs;
          const ttlMs = q.ttl_seconds * 1000;
          expired = (observedMs + ttlMs) <= nowMs;
        }

        // Keep it if not expired, OR it is the latest event for that key, OR it holds the
        // latest native / prompt_pack signal for that key.
        if (!expired || isLatest || isSkillCarrier) {
          keptRows.push(row);
        } else {
          prunedCount += 1;
        }
      }

      const out = keptRows.length ? keptRows.map(r => JSON.stringify(r)).join('\n') + '\n' : '';
      fs.writeFileSync(storeFile, out, { mode: 0o600 });
    });

    process.stdout.write(`Pruned ${prunedCount} events\n`);
    process.exit(0);
  }

  if (command === 'classify-error') {
    let inputString = options.string || '';
    if (options.file) {
      try {
        inputString = fs.readFileSync(options.file, 'utf8');
      } catch (err) {
        process.stderr.write(`ERROR: failed to read file ${options.file}: ${err.message}\n`);
        process.exit(1);
      }
    } else if (!options.string && options['exit-code'] === undefined) {
      // Read from stdin if no option is specified
      try {
        inputString = fs.readFileSync(0, 'utf8');
      } catch {
        // Ignored
      }
    }

    let classification = classifyErrorContent(inputString);

    if (classification === 'unknown' && options['exit-code'] !== undefined) {
      const ec = Number(options['exit-code']);
      // Let's assume some common exit codes if text is unknown
      if (ec === 124 || ec === 143) {
        classification = 'network_failed'; // Timeout is typically network_failed
      } else if (ec === 429) {
        classification = 'rate_limited';
      } else if (ec === 503 || ec === 529) {
        classification = 'overloaded';
      } else if (ec === 401 || ec === 403) {
        classification = 'auth_failed';
      }
    }

    process.stdout.write(`${classification}\n`);
    process.exit(0);
  }

  failUsage(`unknown subcommand '${command}'`);
}

if (require.main === module) {
  main();
}

module.exports = {
  appendEvidenceRecord,
  appendEvidenceRecords,
  appendStrikeRecord,
  appendStrikeSeatRecord,
  appendStrikeInvalidation,
  brainSeatStatus,
  readEvidenceRows,
  readStrikeRows,
  readStrikeRowsLenient,
  resolveStoreConfig,
  seatHashOf,
  normalizeSeatIdentity,
  validateStrikeV2Shape,
  validateEvidenceProducer,
  STRIKE_WRITER_ALLOWLIST,
  CRITICAL_REEXAM_PREDICATES,
  EXTERNAL_CAUSE_EXCLUSIONS,
  ORDINARY_STRIKE_THRESHOLD,
  STRIKE_POLICY_VERSION,
};
