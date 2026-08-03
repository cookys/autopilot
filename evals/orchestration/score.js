#!/usr/bin/env node
// score.js — scoring + adherence report

'use strict';

const fs = require('fs');
const readline = require('readline');
const VALID_FAILURE_CLASSES = new Set(['capability_fail', 'infra_fail']);
const VALID_FAILURE_CAUSES = new Map([
  ['capability_fail', new Set(['oracle_rejected'])],
  ['infra_fail', new Set([
    'runner_timeout',
    'authentication',
    'runner_error',
    'empty_output',
    'missing_oracle',
    'oracle_error',
  ])],
]);
const OPTIONAL_BOOLEAN_FIELDS = [
  'decoy_respected',
  'fidelity_ok',
  'adjudication_valid',
  'patterns_named',
  'probe_evidence_present',
];

function usage() {
  console.log('Usage: node score.js <results.jsonl>');
  process.exit(1);
}

function printTable(title, headers, rows) {
  console.log(`\n=== ${title} ===`);
  const colWidths = headers.map((h, i) => {
    let max = h.length;
    for (const r of rows) {
      if (r[i] !== undefined && r[i] !== null) {
        max = Math.max(max, String(r[i]).length);
      }
    }
    return max + 2;
  });

  const printRow = (cells) => {
    const formatted = cells.map((c, i) => {
      const s = String(c === null || c === undefined ? '-' : c);
      return s.padEnd(colWidths[i]);
    });
    console.log(formatted.join('| '));
  };

  printRow(headers);
  console.log(colWidths.map(w => '-'.repeat(w)).join('+ '));
  for (const r of rows) {
    printRow(r);
  }
}

function rowError(rowNumber, message) {
  return new Error(`Error: row ${rowNumber} ${message}`);
}

function validateRow(row, rowNumber) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)
      || Object.getPrototypeOf(row) !== Object.prototype) {
    throw rowError(rowNumber, 'must be a plain object');
  }
  if (typeof row.task_id !== 'string' || row.task_id.trim().length === 0) {
    throw rowError(rowNumber, 'has invalid task_id');
  }
  if (row.arm !== 'on' && row.arm !== 'off') {
    throw rowError(rowNumber, 'has invalid arm (expected on|off)');
  }
  if (typeof row.oracle_pass !== 'boolean') {
    throw rowError(rowNumber, 'has invalid oracle_pass (expected boolean)');
  }
  for (const field of OPTIONAL_BOOLEAN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)
        && row[field] !== null && typeof row[field] !== 'boolean') {
      throw rowError(rowNumber, `has invalid ${field} (expected boolean|null)`);
    }
  }

  if (row.oracle_pass === false) {
    if (!VALID_FAILURE_CLASSES.has(row.failure_class)) {
      throw rowError(rowNumber, 'has invalid failure_class (expected capability_fail|infra_fail)');
    }
    const causes = VALID_FAILURE_CAUSES.get(row.failure_class);
    if (typeof row.failure_cause !== 'string' || row.failure_cause.trim().length === 0
        || !causes.has(row.failure_cause)) {
      throw rowError(rowNumber, 'has invalid failure_cause for failure_class');
    }
  } else if (row.failure_class != null || row.failure_cause != null) {
    throw rowError(rowNumber, 'is successful but carries failure metadata');
  }
}

async function main() {
  const args = process.argv.slice(2);
  let inputStream = process.stdin;

  if (args.length > 0) {
    if (args[0] === '-h' || args[0] === '--help') {
      usage();
    }
    if (!fs.existsSync(args[0])) {
      console.error(`Error: File not found: ${args[0]}`);
      process.exit(1);
    }
    inputStream = fs.createReadStream(args[0]);
  }

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });

  const data = [];
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(`Error: line ${lineNumber} is not valid JSON`);
    }
    validateRow(obj, lineNumber);
    data.push(obj);
  }

  if (data.length === 0) {
    console.log('No results to score.');
    process.exit(0);
  }

  // Aggregation maps
  // task_id -> arm -> { count, pass_count, decoy_count, decoy_total, fidelity_count, fidelity_total }
  const taskStats = {};
  // arm -> { count, adj_count, pattern_count, probe_count }
  const armStats = {
    on: { count: 0, adj_count: 0, pattern_count: 0, probe_count: 0 },
    off: { count: 0, adj_count: 0, pattern_count: 0, probe_count: 0 }
  };
  const excludedInfra = new Map();

  for (const row of data) {
    const taskId = row.task_id || 'unknown';
    const arm = (row.arm || 'off').toLowerCase();
    
    if (!taskStats[taskId]) {
      taskStats[taskId] = {
        on: { count: 0, pass_count: 0, decoy_count: 0, decoy_total: 0, fidelity_count: 0, fidelity_total: 0 },
        off: { count: 0, pass_count: 0, decoy_count: 0, decoy_total: 0, fidelity_count: 0, fidelity_total: 0 }
      };
    }

    const isInfraFailure = row.oracle_pass === false && row.failure_class === 'infra_fail';
    if (isInfraFailure) {
      const cause = typeof row.failure_cause === 'string' && row.failure_cause.length > 0
        ? row.failure_cause : 'unspecified';
      const key = `${arm}\u0000${cause}`;
      excludedInfra.set(key, (excludedInfra.get(key) || 0) + 1);
    }

    const t = taskStats[taskId][arm];
    if (t) {
      if (!isInfraFailure) {
        t.count++;
        if (row.oracle_pass === true) t.pass_count++;
        if (row.decoy_respected !== null && row.decoy_respected !== undefined) {
          t.decoy_total++;
          if (row.decoy_respected === true) t.decoy_count++;
        }
        if (row.fidelity_ok !== null && row.fidelity_ok !== undefined) {
          t.fidelity_total++;
          if (row.fidelity_ok === true) t.fidelity_count++;
        }
      }
    }

    const a = armStats[arm];
    if (a && !isInfraFailure) {
      a.count++;
      if (row.adjudication_valid === true) a.adj_count++;
      if (row.patterns_named === true) a.pattern_count++;
      if (row.probe_evidence_present === true) a.probe_count++;
    }
  }

  // Print Per-Task Table
  const taskHeaders = ['Task ID', 'Arm', 'Runs', 'Oracle Pass Rate', 'Decoy Respected', 'Fidelity OK'];
  const taskRows = [];

  for (const [taskId, arms] of Object.entries(taskStats)) {
    for (const arm of ['on', 'off']) {
      const stats = arms[arm];
      if (stats.count === 0) continue;
      
      const passRate = `${((stats.pass_count / stats.count) * 100).toFixed(1)}% (${stats.pass_count}/${stats.count})`;
      
      const decoyRate = stats.decoy_total > 0 
        ? `${((stats.decoy_count / stats.decoy_total) * 100).toFixed(1)}% (${stats.decoy_count}/${stats.decoy_total})`
        : '-';

      const fidelityRate = stats.fidelity_total > 0
        ? `${((stats.fidelity_count / stats.fidelity_total) * 100).toFixed(1)}% (${stats.fidelity_count}/${stats.fidelity_total})`
        : '-';

      taskRows.push([
        taskId,
        arm.toUpperCase(),
        stats.count,
        passRate,
        decoyRate,
        fidelityRate
      ]);
    }
  }
  printTable('PER-TASK ON-VS-OFF OUTCOMES', taskHeaders, taskRows);

  const infraRows = [...excludedInfra.entries()]
    .map(([key, count]) => {
      const [arm, cause] = key.split('\u0000');
      return [arm.toUpperCase(), cause, count];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  printTable(
    'EXCLUDED INFRASTRUCTURE FAILURES',
    ['Arm', 'Cause', 'Excluded Runs'],
    infraRows.length > 0 ? infraRows : [['-', 'none', 0]],
  );

  // Print Adherence Report
  const adjHeaders = ['Arm', 'Total Runs', 'Adjudication Valid', 'Patterns Named', 'Probe Evidence Present'];
  const adjRows = [];
  for (const arm of ['on', 'off']) {
    const stats = armStats[arm];
    if (stats.count === 0) continue;
    adjRows.push([
      arm.toUpperCase(),
      stats.count,
      `${((stats.adj_count / stats.count) * 100).toFixed(1)}% (${stats.adj_count}/${stats.count})`,
      `${((stats.pattern_count / stats.count) * 100).toFixed(1)}% (${stats.pattern_count}/${stats.count})`,
      `${((stats.probe_count / stats.count) * 100).toFixed(1)}% (${stats.probe_count}/${stats.count})`
    ]);
  }
  printTable('ADHERENCE REPORT', adjHeaders, adjRows);

  console.log('\nHonest footer: pilot n is tiny — pipeline validation, not lift evidence.\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Error: unexpected scoring failure');
  process.exitCode = 1;
});
