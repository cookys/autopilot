#!/usr/bin/env node
'use strict';

/**
 * Validate D8 Grok implementer A/B report against frozen seed/tasks constraints.
 * Usage: node scripts/validate-grok-implementer-ab.js --report <file>
 *        [--seed evals/grok-implementer-ab/seed.json]
 *        [--tasks evals/grok-implementer-ab/tasks.json]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const reportPath = arg('--report');
if (!reportPath) {
  process.stderr.write('usage: validate-grok-implementer-ab.js --report <file>\n');
  process.exit(2);
}
const repo = path.resolve(__dirname, '..');
const seedPath = arg('--seed', path.join(repo, 'evals/grok-implementer-ab/seed.json'));
const tasksPath = arg('--tasks', path.join(repo, 'evals/grok-implementer-ab/tasks.json'));

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const tasksDoc = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
const errors = [];

if (report.schema_version !== 1) errors.push('schema_version must be 1');
if (report.seed !== seed.seed) errors.push('seed mismatch vs frozen seed.json');
if (report.pairs !== seed.initial_pairs && report.pairs !== seed.max_pairs) {
  errors.push(`pairs ${report.pairs} not in {${seed.initial_pairs}, ${seed.max_pairs}}`);
}
if (report.provider_sessions > seed.max_provider_sessions) {
  errors.push(`provider_sessions ${report.provider_sessions} > max ${seed.max_provider_sessions}`);
}
if (!Array.isArray(report.exclusions)) errors.push('exclusions must be array');
// Silent drops forbidden: every non-extension initial task must appear once.
const expectedIds = (tasksDoc.tasks || [])
  .filter((t) => !t.extension)
  .slice(0, seed.initial_pairs)
  .map((t) => t.id)
  .sort();
const gotIds = (report.pair_results || []).map((p) => p.task_id).sort();
if (JSON.stringify(expectedIds) !== JSON.stringify(gotIds.slice(0, expectedIds.length))
    && report.pairs === seed.initial_pairs) {
  // For initial-30 runs, exact task set required.
  const missing = expectedIds.filter((id) => !gotIds.includes(id));
  if (missing.length) errors.push(`missing tasks (no silent drop): ${missing.join(',')}`);
}
for (const p of report.pair_results || []) {
  if (!p.arms || !p.arms.A || !p.arms.B) {
    errors.push(`pair ${p.task_id}: missing arm (no imputation of missing arms)`);
  }
}
const decisions = new Set(['tune-medium', 'tune-high', 'no-change', 'indeterminate']);
if (!decisions.has(report.decision)) errors.push(`invalid decision: ${report.decision}`);

// Digests must match frozen files when present.
const seedDigest = crypto.createHash('sha256').update(fs.readFileSync(seedPath)).digest('hex');
const tasksDigest = crypto.createHash('sha256').update(fs.readFileSync(tasksPath)).digest('hex');
if (report.seed_digest && report.seed_digest !== seedDigest) {
  errors.push('seed_digest does not match frozen seed.json');
}
if (report.tasks_digest && report.tasks_digest !== tasksDigest) {
  errors.push('tasks_digest does not match frozen tasks.json');
}

if (errors.length) {
  process.stderr.write(`validate-grok-implementer-ab: FAIL\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`validate-grok-implementer-ab: ok decision=${report.decision}\n`);
process.exit(0);
