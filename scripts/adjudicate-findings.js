#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const process = require('process');
const crypto = require('crypto');
const { expandTilde, ensureDir, sleepMs, acquireLock, releaseLock, withWriteLock, appendRow, toEventId, maxEventId } = require('./lib/jsonl-store');

const HELP_TEXT = `Usage:
  node scripts/adjudicate-findings.js add --store <path> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js probe --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js refute --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js trace --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js dispose --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js status --store <path> [--id <finding-id>] [--json] [--now <ISO-date>]
  node scripts/adjudicate-findings.js gate --store <path> --ids <id1,id2,...> [--now <ISO-date>]
  node scripts/adjudicate-findings.js repair-gate --store <path> --ids <id1,id2,...> [--now <ISO-date>]
  node scripts/adjudicate-findings.js completeness --store <path> [--json] [--now <ISO-date>]

Options:
  --store <path>       Path to the JSONL store file or directory (required).
  --id <finding-id>    ID of the finding to probe, refute, trace, or dispose.
  --ids <id1,id2,...>  Comma-separated list of finding IDs to check for gate / repair-gate.
  --file <path>        Read input JSON from file instead of stdin.
  --json               Output status / completeness report in JSON format.
  --now <ISO-date>     Use this ISO-8601 UTC timestamp for deterministic tests.

Disposition (dispose): exactly one of must-fix-now | follow-up | reject-out-of-scope.
  must-fix-now: requires (acceptance_id|rubric_id|task_surface) + deferral_harm
  follow-up: requires context + trigger
  reject-out-of-scope: requires rationale

gate: exit 0 iff every id is actionable (backward-compatible claim check).
repair-gate: exit 0 iff every id is actionable AND disposed must-fix-now
  without conflict/missing/malformed disposition (severity is orthogonal).
  Subset --ids alone is NOT completeness — run completeness before fix
  dispatch and before final acceptance.
completeness: fail-closed all-blocking gate over the full registry.
  Enumerates every actionable Critical (🔴) / Major (🟠); fails on missing
  or conflicting disposition; distinguishes must-fix-now from
  follow-up/reject IDs; rejects --ids (caller subsets are never complete).

Exit codes:
  0 = success
  1 = validation / schema / transition error, malformed JSON, gate fail
  2 = usage error / unknown subcommand
`;

const BLOCKING_SEVERITIES = new Set(['🔴', '🟠']);

const VALID_DISPOSITIONS = new Set(['must-fix-now', 'follow-up', 'reject-out-of-scope']);

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

function isValidISO8601(value) {
  if (typeof value !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  if (!regex.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function resolveStoreConfig(options) {
  if (!options.store) {
    failUsage('Option --store <path> is required');
  }
  const resolvedPath = path.resolve(expandTilde(options.store));
  let storeFile, storeDir;
  try {
    if (fs.existsSync(resolvedPath)) {
      if (!fs.statSync(resolvedPath).isDirectory()) {
        storeFile = resolvedPath;
        storeDir = path.dirname(storeFile);
      } else {
        storeDir = resolvedPath;
        storeFile = path.join(storeDir, 'findings.jsonl');
      }
    } else {
      if (resolvedPath.endsWith('.jsonl')) {
        storeFile = resolvedPath;
        storeDir = path.dirname(storeFile);
      } else {
        storeDir = resolvedPath;
        storeFile = path.join(storeDir, 'findings.jsonl');
      }
    }
  } catch {
    if (resolvedPath.endsWith('.jsonl')) {
      storeFile = resolvedPath;
      storeDir = path.dirname(storeFile);
    } else {
      storeDir = resolvedPath;
      storeFile = path.join(storeDir, 'findings.jsonl');
    }
  }
  const lockFile = path.join(storeDir, '.lock');
  return { storeDir, storeFile, lockFile };
}

function readStoreRows(storeFile) {
  if (!fs.existsSync(storeFile)) return [];
  const lines = readTextLines(storeFile);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    try {
      const row = JSON.parse(line);
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        failValidation(`malformed JSON in store at line ${i + 1}`);
      }
      rows.push(row);
    } catch (err) {
      failValidation(`malformed JSON in store at line ${i + 1} (${err.message})`);
    }
  }
  return rows;
}

function getObservedAt(options) {
  if (options.now) {
    if (!isValidISO8601(options.now)) {
      failUsage(`invalid --now date: ${options.now}`);
    }
    return options.now;
  }
  return new Date().toISOString();
}

function validateStoreEvent(ev, lineNo) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) {
    failValidation(`store event at line ${lineNo} must be a JSON object`);
  }
  const rootAllowed = new Set(['event_id', 'observed_at', 'finding_id', 'type']);
  const typeFields = {
    add: new Set(['claim', 'severity', 'source', 'status']),
    probe: new Set(['probe_cmd', 'expected_signature', 'observed_output_digest', 'observed_output_head', 'observed_matches_expected', 'status']),
    refute: new Set(['mutation_desc', 'mutation_probe_output_digest', 'mutation_probe_output_head', 'probe_fired_under_mutation', 'vacuous_probe', 'status']),
    trace: new Set(['trace_chain', 'confirmed_by', 'status']),
    disposition: new Set([
      'disposition', 'acceptance_id', 'rubric_id', 'task_surface', 'deferral_harm',
      'context', 'trigger', 'rationale'
    ])
  };

  if (!ev.type || !typeFields[ev.type]) {
    failValidation(`store event at line ${lineNo} has invalid type: ${ev.type}`);
  }

  const allowed = new Set([...rootAllowed, ...typeFields[ev.type]]);
  for (const key of Object.keys(ev)) {
    if (!allowed.has(key)) {
      failValidation(`unknown field '${key}' in store event at line ${lineNo}`);
    }
  }

  if (!Number.isInteger(ev.event_id) || ev.event_id <= 0) {
    failValidation(`invalid event_id at line ${lineNo}`);
  }
  if (!isValidISO8601(ev.observed_at)) {
    failValidation(`invalid observed_at at line ${lineNo}`);
  }
  if (typeof ev.finding_id !== 'string' || ev.finding_id.trim().length === 0) {
    failValidation(`invalid finding_id at line ${lineNo}`);
  }

  if (ev.type === 'add') {
    if (typeof ev.claim !== 'string' || ev.claim.trim().length === 0) {
      failValidation(`invalid claim at line ${lineNo}`);
    }
    const validSeverities = new Set(['🔴', '🟠', '🟡', '🔵']);
    if (!validSeverities.has(ev.severity)) {
      failValidation(`invalid severity at line ${lineNo}`);
    }
    if (typeof ev.source !== 'string' || ev.source.trim().length === 0) {
      failValidation(`invalid source at line ${lineNo}`);
    }
    if (ev.status !== 'UNPROBED') {
      failValidation(`add event must have status UNPROBED at line ${lineNo}`);
    }
  } else if (ev.type === 'probe') {
    if (typeof ev.probe_cmd !== 'string' || ev.probe_cmd.trim().length === 0) {
      failValidation(`invalid probe_cmd at line ${lineNo}`);
    }
    if (typeof ev.expected_signature !== 'string' || ev.expected_signature.trim().length === 0) {
      failValidation(`invalid expected_signature at line ${lineNo}`);
    }
    if (typeof ev.observed_output_digest !== 'string') {
      failValidation(`invalid observed_output_digest at line ${lineNo}`);
    }
    if (typeof ev.observed_output_head !== 'string' || ev.observed_output_head.length > 400) {
      failValidation(`invalid observed_output_head at line ${lineNo}`);
    }
    if (typeof ev.observed_matches_expected !== 'boolean') {
      failValidation(`invalid observed_matches_expected at line ${lineNo}`);
    }
    if (ev.status !== 'REPRODUCED' && ev.status !== 'UNPROBED') {
      failValidation(`invalid status for probe event at line ${lineNo}`);
    }
  } else if (ev.type === 'refute') {
    if (typeof ev.mutation_desc !== 'string' || ev.mutation_desc.trim().length === 0) {
      failValidation(`invalid mutation_desc at line ${lineNo}`);
    }
    if (typeof ev.mutation_probe_output_digest !== 'string') {
      failValidation(`invalid mutation_probe_output_digest at line ${lineNo}`);
    }
    if (typeof ev.mutation_probe_output_head !== 'string' || ev.mutation_probe_output_head.length > 400) {
      failValidation(`invalid mutation_probe_output_head at line ${lineNo}`);
    }
    if (typeof ev.probe_fired_under_mutation !== 'boolean') {
      failValidation(`invalid probe_fired_under_mutation at line ${lineNo}`);
    }
    if (typeof ev.vacuous_probe !== 'boolean') {
      failValidation(`invalid vacuous_probe at line ${lineNo}`);
    }
    if (ev.status !== 'REFUTED' && ev.status !== 'UNPROBED') {
      failValidation(`invalid status for refute event at line ${lineNo}`);
    }
  } else if (ev.type === 'trace') {
    if (!Array.isArray(ev.trace_chain) || ev.trace_chain.length === 0 || !ev.trace_chain.every(x => typeof x === 'string' && x.trim().length > 0)) {
      failValidation(`invalid trace_chain at line ${lineNo}`);
    }
    if (typeof ev.confirmed_by !== 'string' || ev.confirmed_by.trim().length === 0) {
      failValidation(`invalid confirmed_by at line ${lineNo}`);
    }
    if (ev.status !== 'PROOF_BY_TRACE') {
      failValidation(`invalid status for trace event at line ${lineNo}`);
    }
  } else if (ev.type === 'disposition') {
    validateDispositionFields(ev, `store event at line ${lineNo}`);
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateDispositionFields(obj, label) {
  if (!VALID_DISPOSITIONS.has(obj.disposition)) {
    failValidation(`invalid disposition at ${label}: must be one of must-fix-now|follow-up|reject-out-of-scope`);
  }
  const disposition = obj.disposition;
  if (disposition === 'must-fix-now') {
    const hasSurface = nonEmptyString(obj.acceptance_id)
      || nonEmptyString(obj.rubric_id)
      || nonEmptyString(obj.task_surface);
    if (!hasSurface) {
      failValidation(`must-fix-now requires acceptance_id, rubric_id, or task_surface at ${label}`);
    }
    if (!nonEmptyString(obj.deferral_harm)) {
      failValidation(`must-fix-now requires deferral_harm at ${label}`);
    }
    // Foreign evidence keys for other dispositions are not allowed (fail closed).
    if (obj.context !== undefined || obj.trigger !== undefined || obj.rationale !== undefined) {
      failValidation(`must-fix-now must not carry follow-up/reject evidence fields at ${label}`);
    }
  } else if (disposition === 'follow-up') {
    if (!nonEmptyString(obj.context)) {
      failValidation(`follow-up requires context at ${label}`);
    }
    if (!nonEmptyString(obj.trigger)) {
      failValidation(`follow-up requires trigger at ${label}`);
    }
    if (
      obj.acceptance_id !== undefined || obj.rubric_id !== undefined
      || obj.task_surface !== undefined || obj.deferral_harm !== undefined
      || obj.rationale !== undefined
    ) {
      failValidation(`follow-up must not carry must-fix-now/reject evidence fields at ${label}`);
    }
  } else if (disposition === 'reject-out-of-scope') {
    if (!nonEmptyString(obj.rationale)) {
      failValidation(`reject-out-of-scope requires rationale at ${label}`);
    }
    if (
      obj.acceptance_id !== undefined || obj.rubric_id !== undefined
      || obj.task_surface !== undefined || obj.deferral_harm !== undefined
      || obj.context !== undefined || obj.trigger !== undefined
    ) {
      failValidation(`reject-out-of-scope must not carry must-fix-now/follow-up evidence fields at ${label}`);
    }
  }
}

function getFindingsState(events) {
  const findings = {};
  for (const ev of events) {
    const fid = ev.finding_id;
    if (ev.type === 'add') {
      findings[fid] = {
        finding_id: fid,
        claim: ev.claim,
        severity: ev.severity,
        source: ev.source,
        status: 'UNPROBED',
        actionable: false,
        disposition: null,
        disposition_conflict: false,
        disposition_values: [],
        events: [ev]
      };
    } else {
      if (!findings[fid]) {
        continue;
      }
      findings[fid].events.push(ev);

      if (ev.type === 'probe') {
        if (ev.observed_matches_expected) {
          findings[fid].status = 'REPRODUCED';
          findings[fid].actionable = true;
        }
      } else if (ev.type === 'refute') {
        if (ev.probe_fired_under_mutation) {
          findings[fid].status = 'REFUTED';
          findings[fid].actionable = false;
        }
      } else if (ev.type === 'trace') {
        findings[fid].status = 'PROOF_BY_TRACE';
        findings[fid].actionable = true;
      } else if (ev.type === 'disposition') {
        findings[fid].disposition_values.push(ev.disposition);
        const unique = new Set(findings[fid].disposition_values);
        findings[fid].disposition_conflict = unique.size > 1;
        // Latest disposition is current when no conflict; conflict fails closed at repair-gate.
        findings[fid].disposition = findings[fid].disposition_conflict
          ? null
          : ev.disposition;
      }
    }
  }
  return findings;
}

/** repair-eligible: actionable claim + single must-fix-now disposition. Severity orthogonal. */
function isRepairEligible(state) {
  if (!state || !state.actionable) return false;
  if (state.disposition_conflict) return false;
  if (state.disposition !== 'must-fix-now') return false;
  return true;
}

/** Actionable Critical/Major — must have exactly one disposition for completeness. */
function isBlockingActionable(state) {
  return !!(state && state.actionable && BLOCKING_SEVERITIES.has(state.severity));
}

/**
 * All-blocking completeness over the registry (not a caller-selected subset).
 * Every actionable Critical/Major must have exactly one non-conflicting disposition.
 */
function evaluateCompleteness(findings) {
  const mustFixNow = [];
  const followUpOrReject = [];
  const missingDisposition = [];
  const conflictingDisposition = [];

  const blocking = Object.values(findings)
    .filter((f) => isBlockingActionable(f))
    .sort((a, b) => a.finding_id.localeCompare(b.finding_id));

  for (const state of blocking) {
    if (state.disposition_conflict) {
      conflictingDisposition.push(state.finding_id);
      continue;
    }
    if (!state.disposition) {
      missingDisposition.push(state.finding_id);
      continue;
    }
    if (state.disposition === 'must-fix-now') {
      mustFixNow.push(state.finding_id);
    } else if (
      state.disposition === 'follow-up'
      || state.disposition === 'reject-out-of-scope'
    ) {
      followUpOrReject.push(state.finding_id);
    } else {
      missingDisposition.push(state.finding_id);
    }
  }

  const ok = missingDisposition.length === 0 && conflictingDisposition.length === 0;
  return {
    complete: ok,
    blocking_count: blocking.length,
    must_fix_now_ids: mustFixNow,
    follow_up_or_reject_ids: followUpOrReject,
    missing_disposition_ids: missingDisposition,
    conflicting_disposition_ids: conflictingDisposition
  };
}

function statusPayload(state) {
  return {
    finding_id: state.finding_id,
    status: state.status,
    severity: state.severity,
    actionable: state.actionable,
    disposition: state.disposition,
    disposition_conflict: state.disposition_conflict === true,
    repair_eligible: isRepairEligible(state)
  };
}

function checkTransition(currentStatus, newStatus) {
  if (currentStatus === newStatus) return;
  if (currentStatus === 'UNPROBED') {
    if (newStatus === 'REPRODUCED' || newStatus === 'REFUTED' || newStatus === 'PROOF_BY_TRACE') {
      return;
    }
  }
  failValidation(`invalid status transition from ${currentStatus} to ${newStatus}`);
}

function readInputJson(options) {
  let raw;
  if (options.file) {
    const resolvedPath = path.resolve(expandTilde(options.file));
    if (!fs.existsSync(resolvedPath)) {
      failValidation(`File does not exist: ${options.file}`);
    }
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } else {
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch (err) {
      failValidation(`Failed to read from stdin: ${err.message}`);
    }
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    failValidation(`malformed JSON: ${err.message}`);
  }
}

function validateInputJson(input, command) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    failValidation('Input must be a JSON object');
  }

  if (command === 'add') {
    const allowed = new Set(['finding_id', 'claim', 'severity', 'source']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        if (key === 'status') {
          failValidation('Initial status is always UNPROBED; input carrying a status is rejected');
        }
        failValidation(`unknown field in input: ${key}`);
      }
    }
    for (const key of allowed) {
      if (!(key in input)) {
        failValidation(`missing required field in input: ${key}`);
      }
    }
    if (typeof input.finding_id !== 'string' || input.finding_id.trim().length === 0) {
      failValidation('finding_id must be a non-empty string');
    }
    if (typeof input.claim !== 'string' || input.claim.trim().length === 0) {
      failValidation('claim must be a non-empty string');
    }
    const validSeverities = new Set(['🔴', '🟠', '🟡', '🔵']);
    if (!validSeverities.has(input.severity)) {
      failValidation('severity must be a valid emoji (🔴, 🟠, 🟡, 🔵)');
    }
    if (typeof input.source !== 'string' || input.source.trim().length === 0) {
      failValidation('source must be a non-empty string');
    }
  } else if (command === 'probe') {
    const allowed = new Set(['probe_cmd', 'expected_signature', 'observed_output', 'observed_matches_expected']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        failValidation(`unknown field in input: ${key}`);
      }
    }
    for (const key of allowed) {
      if (!(key in input)) {
        failValidation(`missing required field in input: ${key}`);
      }
    }
    if (typeof input.probe_cmd !== 'string' || input.probe_cmd.trim().length === 0) {
      failValidation('probe_cmd must be a non-empty string');
    }
    if (typeof input.expected_signature !== 'string' || input.expected_signature.trim().length === 0) {
      failValidation('expected_signature must be a non-empty string');
    }
    if (typeof input.observed_output !== 'string') {
      failValidation('observed_output must be a string');
    }
    if (typeof input.observed_matches_expected !== 'boolean') {
      failValidation('observed_matches_expected must be a boolean');
    }
  } else if (command === 'refute') {
    const allowed = new Set(['mutation_desc', 'mutation_probe_output', 'probe_fired_under_mutation']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        failValidation(`unknown field in input: ${key}`);
      }
    }
    for (const key of allowed) {
      if (!(key in input)) {
        failValidation(`missing required field in input: ${key}`);
      }
    }
    if (typeof input.mutation_desc !== 'string' || input.mutation_desc.trim().length === 0) {
      failValidation('mutation_desc must be a non-empty string');
    }
    if (typeof input.mutation_probe_output !== 'string') {
      failValidation('mutation_probe_output must be a string');
    }
    if (typeof input.probe_fired_under_mutation !== 'boolean') {
      failValidation('probe_fired_under_mutation must be a boolean');
    }
  } else if (command === 'trace') {
    const allowed = new Set(['trace_chain', 'confirmed_by']);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        failValidation(`unknown field in input: ${key}`);
      }
    }
    for (const key of allowed) {
      if (!(key in input)) {
        failValidation(`missing required field in input: ${key}`);
      }
    }
    if (!Array.isArray(input.trace_chain) || input.trace_chain.length === 0) {
      failValidation('trace_chain must be a non-empty array');
    }
    for (let i = 0; i < input.trace_chain.length; i++) {
      if (typeof input.trace_chain[i] !== 'string' || input.trace_chain[i].trim().length === 0) {
        failValidation(`trace_chain[${i}] must be a non-empty string`);
      }
    }
    if (typeof input.confirmed_by !== 'string' || input.confirmed_by.trim().length === 0) {
      failValidation('confirmed_by must be a non-empty string');
    }
  } else if (command === 'dispose') {
    const allowed = new Set([
      'disposition', 'acceptance_id', 'rubric_id', 'task_surface', 'deferral_harm',
      'context', 'trigger', 'rationale'
    ]);
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        failValidation(`unknown field in input: ${key}`);
      }
    }
    if (!('disposition' in input)) {
      failValidation('missing required field in input: disposition');
    }
    validateDispositionFields(input, 'input');
  }
}

function parseCommandLineArgs(argv) {
  const options = {};
  const args = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        options[key] = argv[++i];
      } else {
        options[key] = true;
      }
    } else {
      args.push(arg);
    }
  }

  return { command: args[0], options, args };
}

const COMMAND_ALLOWED_FLAGS = {
  add: new Set(['store', 'file', 'now']),
  probe: new Set(['store', 'id', 'file', 'now']),
  refute: new Set(['store', 'id', 'file', 'now']),
  trace: new Set(['store', 'id', 'file', 'now']),
  dispose: new Set(['store', 'id', 'file', 'now']),
  status: new Set(['store', 'id', 'json', 'now']),
  gate: new Set(['store', 'ids', 'now']),
  'repair-gate': new Set(['store', 'ids', 'now']),
  // completeness intentionally omits --ids: caller subsets are never "complete"
  completeness: new Set(['store', 'json', 'now'])
};

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage(2);
  if (isHelpToken(argv[0])) usage(0);

  const { command, options } = parseCommandLineArgs(argv);

  if (!command) failUsage('No subcommand specified');
  if (!COMMAND_ALLOWED_FLAGS[command]) {
    failUsage(`Unknown subcommand: ${command}`);
  }

  // Validate command-line options
  const allowed = COMMAND_ALLOWED_FLAGS[command];
  const valueTakingOptions = new Set(['store', 'file', 'id', 'ids', 'now']);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      failUsage(`Unknown option: --${key} for command ${command}`);
    }
    if (valueTakingOptions.has(key) && options[key] === true) {
      failUsage(`Option --${key} requires a value`);
    }
  }

  if (!options.store) {
    failUsage('Option --store <path> is required');
  }

  if (command === 'status') {
    const { storeFile } = resolveStoreConfig(options);
    const rows = readStoreRows(storeFile);
    for (let i = 0; i < rows.length; i++) {
      validateStoreEvent(rows[i], i + 1);
    }
    const findings = getFindingsState(rows);

    if (options.id) {
      const fid = options.id;
      const state = findings[fid];
      if (!state) {
        failValidation(`Finding with id ${fid} does not exist in store`);
      }
      if (options.json) {
        process.stdout.write(JSON.stringify(statusPayload(state)) + '\n');
      } else {
        process.stdout.write(
          `${fid} ${state.status} ${state.actionable} ${state.disposition || '-'} ${isRepairEligible(state)}\n`
        );
      }
    } else {
      if (options.json) {
        const list = Object.values(findings).map(f => statusPayload(f));
        process.stdout.write(JSON.stringify(list) + '\n');
      } else {
        for (const f of Object.values(findings)) {
          process.stdout.write(
            `${f.finding_id} ${f.status} ${f.actionable} ${f.disposition || '-'} ${isRepairEligible(f)}\n`
          );
        }
      }
    }
    process.exit(0);
  }

  if (command === 'completeness') {
    // Fail closed if caller tries to pass a subset (flag not allowed above; belt).
    if (options.ids !== undefined) {
      failUsage('completeness rejects --ids; it enumerates the full registry');
    }
    const { storeFile } = resolveStoreConfig(options);
    const rows = readStoreRows(storeFile);
    for (let i = 0; i < rows.length; i++) {
      validateStoreEvent(rows[i], i + 1);
    }
    const findings = getFindingsState(rows);
    const report = evaluateCompleteness(findings);
    if (options.json) {
      process.stdout.write(JSON.stringify(report) + '\n');
    } else {
      process.stdout.write(
        [
          `complete=${report.complete}`,
          `blocking=${report.blocking_count}`,
          `must-fix-now=${report.must_fix_now_ids.join(',') || '-'}`,
          `follow-up-or-reject=${report.follow_up_or_reject_ids.join(',') || '-'}`,
          `missing=${report.missing_disposition_ids.join(',') || '-'}`,
          `conflict=${report.conflicting_disposition_ids.join(',') || '-'}`
        ].join(' ') + '\n'
      );
    }
    if (!report.complete) {
      const parts = [];
      if (report.missing_disposition_ids.length) {
        parts.push(`missing disposition: ${report.missing_disposition_ids.join(', ')}`);
      }
      if (report.conflicting_disposition_ids.length) {
        parts.push(`conflicting disposition: ${report.conflicting_disposition_ids.join(', ')}`);
      }
      process.stderr.write(
        `ERROR: blocking completeness failed (${parts.join('; ')}). ` +
        'Every actionable Critical/Major needs exactly one disposition.\n'
      );
      process.exit(1);
    }
    process.exit(0);
  }

  if (command === 'gate' || command === 'repair-gate') {
    if (!options.ids) {
      failUsage('Option --ids <id1,id2,...> is required');
    }
    const { storeFile } = resolveStoreConfig(options);
    const rows = readStoreRows(storeFile);
    for (let i = 0; i < rows.length; i++) {
      validateStoreEvent(rows[i], i + 1);
    }
    const findings = getFindingsState(rows);

    const ids = options.ids.split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      failUsage(`No ids specified for ${command}`);
    }

    if (command === 'gate') {
      // Backward-compatible: claim-real check only (actionable).
      const nonActionable = [];
      for (const id of ids) {
        const state = findings[id];
        if (!state || !state.actionable) {
          nonActionable.push(id);
        }
      }

      if (nonActionable.length > 0) {
        process.stdout.write(nonActionable.join(',') + '\n');
        process.stderr.write(`ERROR: Non-actionable findings: ${nonActionable.join(', ')}\n`);
        process.exit(1);
      } else {
        process.exit(0);
      }
    }

    // repair-gate: actionable + must-fix-now disposition without conflict.
    // NOTE: --ids is a selected fix set, NOT registry completeness. Callers
    // MUST run `completeness` before fix dispatch and before acceptance.
    const blocked = [];
    for (const id of ids) {
      const state = findings[id];
      if (!isRepairEligible(state)) {
        blocked.push(id);
      }
    }
    if (blocked.length > 0) {
      process.stdout.write(blocked.join(',') + '\n');
      process.stderr.write(
        `ERROR: Not repair-eligible (need actionable + must-fix-now disposition): ${blocked.join(', ')}\n`
      );
      process.exit(1);
    }
    process.exit(0);
  }

  // Commands that write to store
  if (command === 'probe' || command === 'refute' || command === 'trace' || command === 'dispose') {
    if (!options.id) {
      failUsage(`Option --id <finding-id> is required for command ${command}`);
    }
  }

  const { storeDir, storeFile, lockFile } = resolveStoreConfig(options);
  const observedAt = getObservedAt(options);

  const input = readInputJson(options);
  validateInputJson(input, command);

  const writtenRow = withWriteLock({ storeDir, lockFile, name: 'findings' }, () => {
    const rows = readStoreRows(storeFile);
    for (let i = 0; i < rows.length; i++) {
      validateStoreEvent(rows[i], i + 1);
    }

    const findings = getFindingsState(rows);
    const fid = command === 'add' ? input.finding_id : options.id;

    if (command === 'add') {
      if (findings[fid]) {
        failValidation(`Duplicate finding_id: ${fid} already exists in store`);
      }
    } else {
      if (!findings[fid]) {
        failValidation(`Finding with id ${fid} does not exist in store`);
      }
    }

    const currentStatus = findings[fid] ? findings[fid].status : 'UNPROBED';
    let newStatus = 'UNPROBED';
    let eventSpecificData = {};

    if (command === 'add') {
      newStatus = 'UNPROBED';
      eventSpecificData = {
        claim: input.claim,
        severity: input.severity,
        source: input.source,
        status: newStatus
      };
    } else if (command === 'probe') {
      newStatus = input.observed_matches_expected ? 'REPRODUCED' : 'UNPROBED';

      const digest = crypto.createHash('sha256').update(input.observed_output).digest('hex');
      const head = input.observed_output.slice(0, 400);

      eventSpecificData = {
        probe_cmd: input.probe_cmd,
        expected_signature: input.expected_signature,
        observed_output_digest: digest,
        observed_output_head: head,
        observed_matches_expected: input.observed_matches_expected,
        status: newStatus
      };
    } else if (command === 'refute') {
      const findingObj = findings[fid];
      const hasFailedProbe = findingObj.events.some(
        ev => ev.type === 'probe' && ev.observed_matches_expected === false
      );
      if (!hasFailedProbe) {
        failValidation(`refute requires a prior probe record for ${fid} whose observed_matches_expected was false`);
      }

      newStatus = input.probe_fired_under_mutation ? 'REFUTED' : 'UNPROBED';

      const digest = crypto.createHash('sha256').update(input.mutation_probe_output).digest('hex');
      const head = input.mutation_probe_output.slice(0, 400);

      eventSpecificData = {
        mutation_desc: input.mutation_desc,
        mutation_probe_output_digest: digest,
        mutation_probe_output_head: head,
        probe_fired_under_mutation: input.probe_fired_under_mutation,
        vacuous_probe: !input.probe_fired_under_mutation,
        status: newStatus
      };
    } else if (command === 'trace') {
      const findingObj = findings[fid];
      if (input.confirmed_by === findingObj.source) {
        failValidation(`reject same-source confirmation: confirmed_by must differ from finding source (${findingObj.source})`);
      }

      newStatus = 'PROOF_BY_TRACE';
      eventSpecificData = {
        trace_chain: input.trace_chain,
        confirmed_by: input.confirmed_by,
        status: newStatus
      };
    } else if (command === 'dispose') {
      // Disposition does not change claim status; it is orthogonal to severity/actionable.
      newStatus = currentStatus;
      eventSpecificData = { disposition: input.disposition };
      if (input.disposition === 'must-fix-now') {
        if (input.acceptance_id !== undefined) eventSpecificData.acceptance_id = input.acceptance_id;
        if (input.rubric_id !== undefined) eventSpecificData.rubric_id = input.rubric_id;
        if (input.task_surface !== undefined) eventSpecificData.task_surface = input.task_surface;
        eventSpecificData.deferral_harm = input.deferral_harm;
      } else if (input.disposition === 'follow-up') {
        eventSpecificData.context = input.context;
        eventSpecificData.trigger = input.trigger;
      } else if (input.disposition === 'reject-out-of-scope') {
        eventSpecificData.rationale = input.rationale;
      }
    }

    if (command !== 'dispose') {
      checkTransition(currentStatus, newStatus);
    }

    const assigned = maxEventId(rows) + 1;
    const eventType = command === 'dispose' ? 'disposition' : command;
    const newEvent = {
      event_id: assigned,
      observed_at: observedAt,
      finding_id: fid,
      type: eventType,
      ...eventSpecificData
    };

    ensureDir(storeDir);
    appendRow(storeFile, newEvent);
    return newEvent;
  });

  process.stdout.write(`${JSON.stringify(writtenRow)}\n`);
  process.exit(0);
}

if (require.main === module) {
  main();
}
