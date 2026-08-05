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
const { spawnSync } = require('child_process');

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

function resolveCommit(ref, label) {
  if (typeof ref !== 'string' || ref.length === 0) {
    errors.push(`${label} ref is required`);
    return null;
  }
  const result = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
  });
  const resolved = String(result.stdout || '').trim();
  if (result.status !== 0 || !/^[0-9a-f]{40,64}$/.test(resolved)) {
    errors.push(`${label} ref does not resolve to a Git commit: ${ref}`);
    return null;
  }
  return resolved;
}

if (report.schema_version !== 1) errors.push('schema_version must be 1');
// Plan D8 gate: live runner only (offline-synthetic is not acceptance).
if (report.mode !== 'live') {
  errors.push(`mode must be live (got ${report.mode}); offline-synthetic is not an acceptance path`);
}
if (report.seed !== seed.seed) errors.push('seed mismatch vs frozen seed.json');
const resolvedBaseSha = resolveCommit(report.base_ref, 'base');
const resolvedCandidateSha = resolveCommit(report.candidate_ref, 'candidate');
if (!/^[0-9a-f]{40,64}$/.test(String(report.base_sha || ''))) {
  errors.push('base_sha must be a lowercase Git object id');
}
if (!/^[0-9a-f]{40,64}$/.test(String(report.candidate_sha || ''))) {
  errors.push('candidate_sha must be a lowercase Git object id');
}
if (resolvedBaseSha && report.base_sha !== resolvedBaseSha) {
  errors.push('base_sha does not match the resolved base_ref');
}
if (resolvedCandidateSha && report.candidate_sha !== resolvedCandidateSha) {
  errors.push('candidate_sha does not match the resolved candidate_ref');
}
if (report.base_sha && report.base_sha === report.candidate_sha) {
  errors.push('base_sha and candidate_sha must be distinct frozen commits');
}
if (report.runner !== seed.actor.runner) errors.push('runner provenance does not match frozen actor');
const expectedModel = String(seed.actor.model || '').toLowerCase().replace(/\s+/g, '-');
if (String(report.model || '').toLowerCase() !== expectedModel) {
  errors.push('model provenance does not match frozen actor');
}
if (typeof report.runner_version !== 'string' || report.runner_version.length === 0) {
  errors.push('runner_version provenance is required');
}
if (typeof report.provider_version !== 'string' || report.provider_version.length === 0) {
  errors.push('provider_version provenance is required');
}
if (report.pairs !== seed.initial_pairs && report.pairs !== seed.max_pairs) {
  errors.push(`pairs ${report.pairs} not in {${seed.initial_pairs}, ${seed.max_pairs}}`);
}
// Indeterminate at 30 pairs is not terminal — must extend to max_pairs (60).
if (report.decision === 'indeterminate' && report.pairs === seed.initial_pairs) {
  errors.push('indeterminate at initial_pairs is not terminal; extension to max_pairs required');
}
if (report.decision === 'indeterminate') {
  errors.push('indeterminate result remains open; no calibration decision is accepted');
}
if (report.provider_sessions > seed.max_provider_sessions) {
  errors.push(`provider_sessions ${report.provider_sessions} > max ${seed.max_provider_sessions}`);
}
if (!Number.isSafeInteger(report.provider_sessions)
    || !Number.isSafeInteger(report.session_attempts_started)
    || report.provider_sessions !== report.session_attempts_started) {
  errors.push('provider session count must equal the mechanically reserved attempt count');
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
    continue;
  }
  for (const armName of ['A', 'B']) {
    const arm = p.arms[armName];
    if (arm.usable_session !== true) {
      errors.push(`pair ${p.task_id} arm ${armName}: unusable session remains open`);
    }
    if (arm.retry_exhausted === true) {
      errors.push(`pair ${p.task_id} arm ${armName}: retry cap exhausted`);
    }
    if (arm.provenance_ok !== true
        || arm.runner !== report.runner
        || arm.model !== report.model
        || typeof arm.provider_session_id !== 'string'
        || arm.provider_session_id.length === 0
        || arm.runner_version !== report.runner_version
        || arm.provider_version !== report.provider_version) {
      errors.push(`pair ${p.task_id} arm ${armName}: dispatch provenance is missing or mismatched`);
    }
    if (arm.acceptance_ok !== true
        || !Array.isArray(arm.acceptance_results)
        || arm.acceptance_results.length === 0
        || arm.acceptance_results.some((result) => result.exit !== 0)) {
      errors.push(`pair ${p.task_id} arm ${armName}: acceptance commands did not pass`);
    }
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
