#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const { expandTilde, ensureDir, sleepMs, acquireLock, releaseLock, withWriteLock, appendRow, toEventId, maxEventId } = require('./lib/jsonl-store');
const {
  capabilityEvidenceProducerHash,
  compileCapabilityEvidence,
  evaluateCapabilityEvidence,
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
  node scripts/engine-capability-state.js current --runner <runner> --model <model> --role <role> [--endpoint <name|@none>] [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js report --capability <name> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js record-evidence [--file <path>] [--store <path>]
  node scripts/engine-capability-state.js current-evidence --role <role> --scope-file <path> --identity-file <path> [--observation-file <path>] [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js report-evidence --role <role> [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js prune [--now <ISO-date>] [--store <path>]
  node scripts/engine-capability-state.js classify-error [--string <text>] [--file <path>] [--exit-code <code>]

Options:
  --file <path>        Read event JSON from file (for record) or classify error from file.
  --store <path>       Override capability store directory or file.
  --now <ISO-date>     Use this ISO-8601 UTC timestamp for deterministic tests.
  --runner <runner>    Specify runner name.
  --model <model>      Specify model name.
  --role <role>        Specify role.
  --endpoint <value>   Select one exact endpoint wallet; "@none" means explicit endpoint:null.
                       Omit only for backward-compatible legacy ambiguous rows.
  --capability <name>  Specify capability name (default: quota).
  --scope-file <path>  Read an exact capability scope JSON object.
  --identity-file <path>  Read an exact deployment identity JSON object.
  --observation-file <path>  Read an optional revocation observation into telemetry.
  --string <text>      String to classify for classify-error.
  --exit-code <code>   Exit code to classify for classify-error.

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
  return { storeDir, storeFile, evidenceFile, lockFile };
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

// Logic to merge events per runner, model, role and exact endpoint identity.
function mergeCurrentState(rows, runner, model, role, nowMs, endpoint = endpointSelection(null, false)) {
  let mergedQuota = null;
  let mergedSkill = null;
  // context_window is merged ROLE-AGNOSTICALLY (like quota, unlike skill_transport):
  // a model's window is a property of the model, not of the seat it is dispatched into.
  let mergedCtx = null;

  for (const row of rows) {
    if (row.runner !== runner || row.model !== model
        || endpointRowKey(row) !== endpoint.key) {
      continue;
    }

    // Process capability.quota — ROLE-AGNOSTIC: quota is a per-MODEL pool (subscription
    // pools and endpoint wallets are account-level, not role-level). Keying the merge on
    // role fragmented the pool: a live 'available' probe recorded under role=reviewer
    // could never clear a stale-but-unexpired 'exhausted' recorded under role=implementer
    // (2026-07-17 grok incident, events 13 vs 15). skill_transport below stays role-keyed.
    if (row.capability && row.capability.quota) {
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
    ['current', new Set(['runner', 'model', 'role', 'endpoint', 'now', 'store'])],
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
  // payment/balance phrases need an error/status co-occurrence so benign prose
  // ("the payment required field on the checkout form") is not misclassified
  const hasErrCtx = text.includes('402') || text.includes('status')
    || text.includes('error') || text.includes('http');
  if ((text.includes('balance exhausted') || text.includes('payment required')) && hasErrCtx) {
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
    const merged = mergeCurrentState(
      rows,
      options.runner,
      options.model,
      options.role,
      nowMs,
      selectedEndpoint,
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

    // Group rows by (runner, model, endpoint identity). Quota remains role-agnostic only
    // inside one exact wallet. Legacy rows retain their own ambiguous group.
    const groups = new Map();
    for (const row of rows) {
      const endpointKey = endpointRowKey(row);
      if (endpointKey.startsWith('invalid:')) continue;
      const key = `${row.runner}\u0000${row.model}\u0000${endpointKey}`;
      const selection = endpointKey === 'legacy'
        ? endpointSelection(null, false)
        : endpointSelection(
          row.endpoint === null ? ENDPOINT_NULL_SELECTOR : row.endpoint,
          true,
        );
      groups.set(key, { runner: row.runner, model: row.model, endpoint: selection });
    }

    const mergedList = [];
    for (const { runner, model, endpoint } of groups.values()) {
      // First pass (role null) resolves the winning quota observation; the emitted row's
      // role echoes that observation's source role, and skill_transport follows it.
      const probe = mergeCurrentState(rows, runner, model, null, nowMs, endpoint);
      const q = probe.capability && probe.capability.quota;
      if (q && q.status !== 'unknown') {
        const merged = (q.source_role != null)
          ? mergeCurrentState(rows, runner, model, q.source_role, nowMs, endpoint)
          : probe;
        mergedList.push(merged);
      }
    }

    // Sort by runner, model, role
    mergedList.sort((a, b) => {
      if (a.runner !== b.runner) return a.runner < b.runner ? -1 : 1;
      if (a.model !== b.model) return a.model < b.model ? -1 : 1;
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
        const key = `${row.runner}\u0000${row.model}\u0000${row.role}\u0000${endpointRowKey(row)}`;
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
        const key = `${row.runner}\u0000${row.model}\u0000${row.role}\u0000${endpointRowKey(row)}`;
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
  readEvidenceRows,
  resolveStoreConfig,
  validateEvidenceProducer,
};
