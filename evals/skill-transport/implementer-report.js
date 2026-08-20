#!/usr/bin/env node
'use strict';

// Deterministic Phase-2 fold. This is the only implementation-arm decision path:
// it consumes bounded JSONL evidence and applies the pre-registered H1 rules.

const fs = require('fs');

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    if (key === '--json') { out.json = true; continue; }
    if (i + 1 >= argv.length) throw new Error(`${key} requires a value`);
    out[key.slice(2)] = argv[++i];
  }
  return out;
}

function fail(message) {
  process.stderr.write(`implementer-report: ${message}\n`);
  process.exit(2);
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function comparableTokens(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  const cacheRaw = usage.cache_read_input_tokens ?? usage.cached_input_tokens ?? 0;
  const cache = Number(cacheRaw);
  if (![input, output, cache].every(finiteNonnegative) || cache > input) return null;
  return input - cache + output;
}

let opts;
try { opts = argsOf(process.argv.slice(2)); } catch (error) { fail(error.message); }
if (!opts.in) fail('usage: implementer-report.js --in <matrix.jsonl> [--expected-pairs 8] [--json]');
const expectedPairs = Number(opts['expected-pairs'] ?? 8);
if (!Number.isInteger(expectedPairs) || expectedPairs < 1) fail('--expected-pairs must be a positive integer');

let source;
try { source = fs.readFileSync(opts.in, 'utf8'); } catch (error) { fail(`cannot read ${opts.in}: ${error.message}`); }
const rows = [];
for (const [index, line] of source.split('\n').entries()) {
  if (!line.trim()) continue;
  try { rows.push(JSON.parse(line)); }
  catch (error) { fail(`invalid JSON on line ${index + 1}`); }
}

const terminal = new Set(['completed', 'infra_failed', 'invalid']);
const keys = new Set();
const tasks = new Map();
const errors = [];
for (const row of rows) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('row is not an object'); continue; }
  const expectedKey = `${row.engine}|${row.arm}|${row.task}`;
  if (row.cell_key !== expectedKey) errors.push(`bad cell_key: ${row.cell_key ?? '<missing>'}`);
  if (keys.has(row.cell_key)) errors.push(`duplicate cell_key: ${row.cell_key}`);
  keys.add(row.cell_key);
  if (!['nopack', 'pack'].includes(row.arm)) errors.push(`invalid arm: ${row.arm}`);
  if (!terminal.has(row.status)) errors.push(`non-terminal status for ${row.cell_key}`);
  if (!Array.isArray(row.defect_fingerprints)) errors.push(`missing defect_fingerprints for ${row.cell_key}`);
  const uniqueDefects = new Set(Array.isArray(row.defect_fingerprints) ? row.defect_fingerprints : []);
  if (uniqueDefects.size !== (row.defect_fingerprints || []).length) errors.push(`duplicate defect fingerprint in ${row.cell_key}`);
  if (!tasks.has(row.task)) tasks.set(row.task, {});
  if (tasks.get(row.task)[row.arm]) errors.push(`duplicate task arm: ${row.task}/${row.arm}`);
  tasks.get(row.task)[row.arm] = row;
}

const engineTuples = new Set(rows.map(r => `${r.runner ?? ''}|${r.engine ?? ''}|${r.effort ?? ''}`));
const reviewerTuples = new Set(rows.map(r => `${r.reviewer_runner ?? ''}|${r.reviewer_model ?? ''}|${r.reviewer_effort ?? ''}`));
const seeds = new Set(rows.map(r => String(r.seed)));
const armCounts = {
  nopack: rows.filter(r => r.arm === 'nopack').length,
  pack: rows.filter(r => r.arm === 'pack').length,
};

let validPairs = 0;
const perTask = [];
for (const task of [...tasks.keys()].sort()) {
  const pair = tasks.get(task);
  const a = pair.nopack;
  const b = pair.pack;
  const sameTuple = Boolean(a && b)
    && a.engine === b.engine && a.runner === b.runner && a.effort === b.effort
    && a.reviewer_runner === b.reviewer_runner && a.reviewer_model === b.reviewer_model
    && a.reviewer_effort === b.reviewer_effort && a.seed === b.seed;
  const valid = Boolean(a && b && a.status === 'completed' && b.status === 'completed' && sameTuple);
  if (valid) validPairs += 1;
  perTask.push({
    task,
    nopack_status: a?.status ?? null,
    pack_status: b?.status ?? null,
    nopack_defects: a ? new Set(a.defect_fingerprints).size : null,
    pack_defects: b ? new Set(b.defect_fingerprints).size : null,
    valid_pair: valid,
  });
}

const defectTotals = { nopack: 0, pack: 0 };
for (const row of rows) {
  if (row.status === 'completed' && ['nopack', 'pack'].includes(row.arm)) {
    defectTotals[row.arm] += new Set(row.defect_fingerprints).size;
  }
}
const defectDelta = defectTotals.nopack - defectTotals.pack;

let costRatio = null;
const allUsageComparable = rows.length === expectedPairs * 2
  && rows.every(row => row.status === 'completed' && comparableTokens(row.usage) !== null);
if (allUsageComparable) {
  const sums = { nopack: 0, pack: 0 };
  for (const row of rows) sums[row.arm] += comparableTokens(row.usage);
  if (sums.nopack > 0) costRatio = sums.pack / sums.nopack;
}

const structurallyComplete = errors.length === 0
  && rows.length === expectedPairs * 2
  && tasks.size === expectedPairs
  && armCounts.nopack === expectedPairs
  && armCounts.pack === expectedPairs
  && engineTuples.size === 1
  && reviewerTuples.size === 1
  && seeds.size === 1;

let decision = 'no_capability_verdict';
if (structurallyComplete && validPairs === expectedPairs) {
  if (defectDelta <= 0) decision = 'h1_confirmed_keep_off';
  else if (defectDelta >= 2 && costRatio !== null && costRatio <= 1.5) decision = 'h1_refuted_open_followup';
  else decision = 'inconclusive_keep_off';
}

const report = {
  schema_version: 1,
  source: opts.in,
  expected_pairs: expectedPairs,
  rows: rows.length,
  unique_terminal_keys: keys.size,
  task_count: tasks.size,
  arm_counts: armCounts,
  terminal_counts: {
    completed: rows.filter(r => r.status === 'completed').length,
    infra_failed: rows.filter(r => r.status === 'infra_failed').length,
    invalid: rows.filter(r => r.status === 'invalid').length,
  },
  implementer_tuples: [...engineTuples].sort(),
  reviewer_tuples: [...reviewerTuples].sort(),
  seeds: [...seeds].sort(),
  structurally_complete: structurallyComplete,
  consistency_errors: errors,
  valid_pairs: validPairs,
  per_task: perTask,
  defects: {
    nopack: defectTotals.nopack,
    pack: defectTotals.pack,
    delta_nopack_minus_pack: defectDelta,
  },
  comparable_cost_ratio_pack_over_nopack: costRatio,
  decision,
};

if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  const lines = [
    'SKILL-TRANSPORT IMPLEMENTER A/B — deterministic report',
    `source: ${opts.in}`,
    `rows: ${rows.length}/${expectedPairs * 2}; unique keys: ${keys.size}; structurally complete: ${structurallyComplete}`,
    `terminal: completed=${report.terminal_counts.completed} infra_failed=${report.terminal_counts.infra_failed} invalid=${report.terminal_counts.invalid}`,
    `valid pairs: ${validPairs}/${expectedPairs}`,
    `defects: nopack=${defectTotals.nopack} pack=${defectTotals.pack} D=${defectDelta}`,
    `comparable cost ratio (pack/nopack): ${costRatio === null ? 'null' : costRatio.toFixed(3)}`,
    `decision: ${decision}`,
    '',
    'task\tnopack_status\tpack_status\tnopack_defects\tpack_defects\tvalid_pair',
    ...perTask.map(r => [r.task, r.nopack_status, r.pack_status, r.nopack_defects, r.pack_defects, r.valid_pair].join('\t')),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exit(structurallyComplete ? 0 : 1);
