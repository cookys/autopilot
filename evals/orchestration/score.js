#!/usr/bin/env node
// score.js — scoring + adherence report

'use strict';

const fs = require('fs');
const readline = require('readline');

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

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      data.push(obj);
    } catch (e) {
      console.error(`Warning: Failed to parse line as JSON: ${line}`);
    }
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

  for (const row of data) {
    const taskId = row.task_id || 'unknown';
    const arm = (row.arm || 'off').toLowerCase();
    
    if (!taskStats[taskId]) {
      taskStats[taskId] = {
        on: { count: 0, pass_count: 0, decoy_count: 0, decoy_total: 0, fidelity_count: 0, fidelity_total: 0 },
        off: { count: 0, pass_count: 0, decoy_count: 0, decoy_total: 0, fidelity_count: 0, fidelity_total: 0 }
      };
    }

    const t = taskStats[taskId][arm];
    if (t) {
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

    const a = armStats[arm];
    if (a) {
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

main().catch(console.error);
