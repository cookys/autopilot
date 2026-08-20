#!/usr/bin/env node
'use strict';

/** Validate a D6 base-vs-candidate hook-multiplexer benchmark report. */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const reportPath = process.argv[2];
if (!reportPath) {
  process.stderr.write('usage: validate-hook-multiplexer-benchmark.js <report.json>\n');
  process.exit(2);
}

const repo = path.resolve(__dirname, '..');
// Authorization sealed the D6 performance comparison against the last
// pre-multiplexer tree. A report against any later continuation base is not a
// valid performance admission even if its two refs are otherwise distinct.
const D6_BASE_SHA = 'f6805529bdca4cca76f334d8c82c8f2bf141aaf8';
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const canonicalFixturesPath = path.join(repo, 'hooks', 'tests', 'fixtures', 'hook-multiplexer-benchmark.json');
const fixturesText = fs.readFileSync(canonicalFixturesPath, 'utf8');
const fixtures = JSON.parse(fixturesText);
const fixtureById = new Map((fixtures.fixtures || []).map((fixture) => [fixture.id, fixture]));
const errors = [];

function resolveCommit(ref, label) {
  if (typeof ref !== 'string' || ref.length === 0) {
    errors.push(`${label}_ref is required`);
    return null;
  }
  const result = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', `${ref}^{commit}`], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    errors.push(`${label}_ref does not resolve: ${ref}`);
    return null;
  }
  return String(result.stdout || '').trim();
}

if (report.schema_version !== 1) errors.push('schema_version must be 1');
const baseSha = typeof report.base_sha === 'string' ? report.base_sha.toLowerCase() : '';
const candidateSha = typeof report.candidate_sha === 'string' ? report.candidate_sha.toLowerCase() : '';
if (!/^[0-9a-f]{40,64}$/.test(baseSha)) errors.push('base_sha must be a full Git SHA');
if (!/^[0-9a-f]{40,64}$/.test(candidateSha)) errors.push('candidate_sha must be a full Git SHA');
if (baseSha && baseSha !== D6_BASE_SHA) {
  errors.push(`base_sha must equal the authorized D6 baseline ${D6_BASE_SHA}`);
}
if (baseSha && candidateSha && baseSha === candidateSha) {
  errors.push('base_sha and candidate_sha must be distinct');
}
const resolvedBase = resolveCommit(report.base_ref, 'base');
const resolvedCandidate = resolveCommit(report.candidate_ref, 'candidate');
if (resolvedBase && baseSha && resolvedBase !== baseSha) {
  errors.push(`base_sha does not match Git truth for base_ref (${baseSha} != ${resolvedBase})`);
}
if (resolvedCandidate && candidateSha && resolvedCandidate !== candidateSha) {
  errors.push(`candidate_sha does not match Git truth for candidate_ref (${candidateSha} != ${resolvedCandidate})`);
}
if (resolvedBase && resolvedCandidate && resolvedBase === resolvedCandidate) {
  errors.push('base_ref and candidate_ref resolve to the same commit');
}

const expectedFixturesSha = crypto.createHash('sha256').update(fixturesText).digest('hex');
if (report.fixtures_sha256 !== expectedFixturesSha) {
  errors.push('fixtures_sha256 does not match the committed fixture file');
}
if (typeof report.fixtures_path !== 'string'
  || path.normalize(report.fixtures_path) !== 'hooks/tests/fixtures/hook-multiplexer-benchmark.json') {
  errors.push('fixtures_path must identify the committed benchmark fixture');
}
if (report.warmups !== 10) errors.push(`warmups must be 10 (got ${report.warmups})`);
if (report.repetitions !== 50) errors.push(`repetitions must be 50 (got ${report.repetitions})`);

const results = Array.isArray(report.results) ? report.results : [];
if (results.length !== fixtureById.size) {
  errors.push(`results must cover exactly ${fixtureById.size} fixtures`);
}
const seen = new Set();

function expectedOrders(count) {
  return Array.from({ length: count }, (_, index) => (
    index % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
  ));
}

function sameOrders(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function validateSummary(fixture, summary, side, result) {
  if (!summary || typeof summary !== 'object') {
    errors.push(`${result.id}: ${side} summary missing`);
    return;
  }
  if (summary.samples !== 50) errors.push(`${result.id}: ${side} samples must be 50 (got ${summary.samples})`);
  if (summary.nonzero_statuses !== 0) {
    errors.push(`${result.id}: ${side} has non-zero multiplexer exits (${summary.nonzero_statuses})`);
  }
  if (summary.payload_sha256 !== fixture.payload_sha256) {
    errors.push(`${result.id}: ${side} payload hash does not match fixture`);
  }
  if (side === 'candidate' && summary.observed_child_count !== fixture.expected_child_count) {
    errors.push(`${result.id}: ${side} observed child count ${summary.observed_child_count} != ${fixture.expected_child_count}`);
  }
  if (!Number.isSafeInteger(summary.processes_started) || summary.processes_started < 1) {
    errors.push(`${result.id}: ${side} processes_started must be a positive integer`);
  }
  if (summary.process_count_consistent !== true) {
    errors.push(`${result.id}: ${side} process count varied across samples`);
  }
  for (const metric of ['median_ms', 'p95_ms', 'mad_ms', 'mad_median_ratio']) {
    if (typeof summary[metric] !== 'number' || !Number.isFinite(summary[metric]) || summary[metric] < 0) {
      errors.push(`${result.id}: ${side}.${metric} must be a finite non-negative number`);
    }
  }
  const madLimit = fixtures.thresholds && fixtures.thresholds.mad_median_max;
  if (typeof madLimit !== 'number') {
    errors.push(`${result.id}: fixture is missing mad_median_max`);
  } else if (summary.mad_median_ratio > madLimit + 1e-9) {
    errors.push(`${result.id}: ${side} MAD/median ${summary.mad_median_ratio} exceeds ${madLimit}`);
  }
}

for (const result of results) {
  if (!result || typeof result !== 'object') {
    errors.push('each result must be an object');
    continue;
  }
  if (seen.has(result.id)) errors.push(`duplicate result id: ${result.id}`);
  seen.add(result.id);
  const fixture = fixtureById.get(result.id);
  if (!fixture) {
    errors.push(`unknown fixture result: ${result.id}`);
    continue;
  }
  if (result.event !== fixture.event || result.mode !== fixture.mode
    || result.enabled !== (fixture.enabled === true)) {
    errors.push(`${result.id}: fixture identity does not match committed fixture`);
  }
  if (result.expected_child_count !== fixture.expected_child_count) {
    errors.push(`${result.id}: expected_child_count does not match fixture`);
  }
  validateSummary(fixture, result.baseline, 'baseline', result);
  validateSummary(fixture, result.candidate, 'candidate', result);
  if (!result.sampling || result.sampling.strategy !== 'alternating-paired') {
    errors.push(`${result.id}: sampling strategy must be alternating-paired`);
  } else {
    if (!sameOrders(result.sampling.warmups, expectedOrders(10))) {
      errors.push(`${result.id}: warm-up order must alternate baseline/candidate pairs`);
    }
    if (!sameOrders(result.sampling.repetitions, expectedOrders(50))) {
      errors.push(`${result.id}: repetition order must alternate baseline/candidate pairs`);
    }
  }

  const baseline = result.baseline;
  const candidate = result.candidate;
  const ratios = result.ratios;
  if (!ratios || typeof ratios !== 'object') {
    errors.push(`${result.id}: ratios missing`);
    continue;
  }
  for (const metric of ['median', 'p95']) {
    const denominator = baseline && baseline[`${metric}_ms`];
    const expected = denominator > 0 ? candidate[`${metric}_ms`] / denominator : null;
    if (expected === null) {
      if (ratios[metric] !== null) errors.push(`${result.id}: ${metric} ratio must be null when base is zero`);
    } else if (typeof ratios[metric] !== 'number'
      || Math.abs(ratios[metric] - expected) > Math.max(1e-9, expected * 1e-6)) {
      errors.push(`${result.id}: ${metric} ratio is not derived from base/candidate metrics`);
    }
  }

  if (fixture.mode === 'cold' && candidate.p95_ms > (fixtures.thresholds.candidate_p95_cold_ms_max || 250)) {
    errors.push(`${result.id}: candidate cold p95 excessive (${candidate.p95_ms}ms)`);
  }
  if (fixture.mode === 'heavy' && candidate.p95_ms > (fixtures.thresholds.candidate_p95_heavy_ms_max || 1000)) {
    errors.push(`${result.id}: candidate heavy p95 excessive (${candidate.p95_ms}ms)`);
  }
  const ratioLimit = fixture.enabled === true
    ? fixtures.thresholds.candidate_enabled_median_p95_ratio_max
    : fixtures.thresholds.candidate_disabled_median_p95_ratio_max;
  if (typeof ratioLimit !== 'number') {
    errors.push(`${result.id}: missing candidate ratio threshold`);
  } else {
    for (const metric of ['median', 'p95']) {
      if (typeof ratios[metric] === 'number' && ratios[metric] > ratioLimit + 1e-9) {
        errors.push(`${result.id}: candidate ${metric} ratio ${ratios[metric]} exceeds ${ratioLimit}`);
      }
    }
  }
}

for (const fixture of fixtureById.values()) {
  if (!seen.has(fixture.id)) errors.push(`missing result for fixture: ${fixture.id}`);
}

if (errors.length) {
  process.stderr.write(
    `validate-hook-multiplexer-benchmark: FAIL\n${errors.map((error) => `  - ${error}`).join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write('validate-hook-multiplexer-benchmark: ok\n');
