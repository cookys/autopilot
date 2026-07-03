#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const process = require('process');
const crypto = require('crypto');

const HELP_TEXT = `Usage:
  node scripts/adjudicate-findings.js add --store <path> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js probe --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js refute --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js trace --store <path> --id <finding-id> [--file <path>] [--now <ISO-date>]
  node scripts/adjudicate-findings.js status --store <path> [--id <finding-id>] [--json] [--now <ISO-date>]
  node scripts/adjudicate-findings.js gate --store <path> --ids <id1,id2,...> [--now <ISO-date>]

Options:
  --store <path>       Path to the JSONL store file or directory (required).
  --id <finding-id>    ID of the finding to probe, refute, or trace.
  --ids <id1,id2,...>  Comma-separated list of finding IDs to check for gate.
  --file <path>        Read input JSON from file instead of stdin.
  --json               Output status in JSON format.
  --now <ISO-date>     Use this ISO-8601 UTC timestamp for deterministic tests.

Exit codes:
  0 = success
  1 = validation / schema / transition error, malformed JSON
  2 = usage error / unknown subcommand
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

function expandTilde(raw) {
  if (!raw) return raw;
  if (raw === '~') return os.homedir();
  if (raw.startsWith(`~${path.sep}`)) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function readTextLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function toEventId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function maxEventId(rows) {
  let max = 0;
  for (const row of rows) {
    const id = toEventId(row.event_id);
    if (id !== null && id > max) max = id;
  }
  return max;
}

function isValidISO8601(value) {
  if (typeof value !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  if (!regex.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function pidStringAlive(content) {
  const pid = Number(content);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    return false;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, ms));
}

function acquireLock(storeDir, lockFile) {
  ensureDir(storeDir);
  const deadline = Date.now() + 8000;
  let delayMs = 5;

  while (true) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder;
      try { holder = fs.readFileSync(lockFile, 'utf8').trim(); } catch { continue; }
      if (!pidStringAlive(holder)) {
        const stolen = `${lockFile}.stale.${process.pid}.${process.hrtime.bigint()}`;
        try {
          fs.renameSync(lockFile, stolen);
          let stolenContent = '';
          try { stolenContent = fs.readFileSync(stolen, 'utf8').trim(); } catch { }
          if (stolenContent === holder && !pidStringAlive(stolenContent)) {
            fs.unlinkSync(stolen);
          } else {
            try { fs.linkSync(stolen, lockFile); } catch { }
            try { fs.unlinkSync(stolen); } catch { }
          }
        } catch { }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for findings lock (held by a live process)');
      }
      sleepMs(delayMs);
      delayMs = Math.min(delayMs * 2, 50);
    }
  }
}

function releaseLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch {
  }
}

function withWriteLock(storeDir, lockFile, callback) {
  acquireLock(storeDir, lockFile);
  try {
    return callback();
  } finally {
    releaseLock(lockFile);
  }
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

function appendRow(storeFile, row) {
  const line = `${JSON.stringify(row)}\n`;
  fs.appendFileSync(storeFile, line, { mode: 0o600 });
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
    trace: new Set(['trace_chain', 'confirmed_by', 'status'])
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
      }
    }
  }
  return findings;
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
  status: new Set(['store', 'id', 'json', 'now']),
  gate: new Set(['store', 'ids', 'now'])
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
        process.stdout.write(JSON.stringify({
          finding_id: fid,
          status: state.status,
          actionable: state.actionable
        }) + '\n');
      } else {
        process.stdout.write(`${fid} ${state.status} ${state.actionable}\n`);
      }
    } else {
      if (options.json) {
        const list = Object.values(findings).map(f => ({
          finding_id: f.finding_id,
          status: f.status,
          actionable: f.actionable
        }));
        process.stdout.write(JSON.stringify(list) + '\n');
      } else {
        for (const f of Object.values(findings)) {
          process.stdout.write(`${f.finding_id} ${f.status} ${f.actionable}\n`);
        }
      }
    }
    process.exit(0);
  }

  if (command === 'gate') {
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
      failUsage('No ids specified for gate');
    }
    
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

  // Commands that write to store
  if (command === 'probe' || command === 'refute' || command === 'trace') {
    if (!options.id) {
      failUsage(`Option --id <finding-id> is required for command ${command}`);
    }
  }

  const { storeDir, storeFile, lockFile } = resolveStoreConfig(options);
  const observedAt = getObservedAt(options);

  const input = readInputJson(options);
  validateInputJson(input, command);

  const writtenRow = withWriteLock(storeDir, lockFile, () => {
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
    }
    
    checkTransition(currentStatus, newStatus);
    
    const assigned = maxEventId(rows) + 1;
    const newEvent = {
      event_id: assigned,
      observed_at: observedAt,
      finding_id: fid,
      type: command,
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
