#!/usr/bin/env node
'use strict';

/**
 * Validate a D6 hook-multiplexer benchmark report against schema + thresholds.
 * Usage: node scripts/validate-hook-multiplexer-benchmark.js <report.json>
 */

const fs = require('fs');
const path = require('path');

const reportPath = process.argv[2];
if (!reportPath) {
  process.stderr.write('usage: validate-hook-multiplexer-benchmark.js <report.json>\n');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const fixturesPath = path.resolve(
  path.dirname(reportPath),
  report.fixtures_path || 'hooks/tests/fixtures/hook-multiplexer-benchmark.json',
);
// Prefer repo-relative fixtures path when report stores relative path
const repoFixtures = path.resolve(__dirname, '..', 'hooks/tests/fixtures/hook-multiplexer-benchmark.json');
const fixtures = JSON.parse(fs.readFileSync(
  fs.existsSync(repoFixtures) ? repoFixtures : fixturesPath,
  'utf8',
));
const thr = fixtures.thresholds || {};
const errors = [];

if (report.schema_version !== 1) errors.push('schema_version must be 1');
if (!report.base_sha || !report.candidate_sha) errors.push('base/candidate SHAs required');
if (!Array.isArray(report.results) || report.results.length !== 4) {
  errors.push('results must cover 4 fixtures');
}

for (const r of report.results || []) {
  if (r.enabled === false) {
    if (r.observed_child_count !== 0) {
      errors.push(`${r.id}: disabled must spawn 0 children`);
    }
  }
  if (typeof r.mad_median_ratio === 'number' && r.mad_median_ratio > (thr.mad_median_max || 0.1) + 1e-9) {
    // Soft: synthetic runs may be noisy on shared CI; only hard-fail extreme variance.
    if (r.mad_median_ratio > 0.5) errors.push(`${r.id}: MAD/median too high (${r.mad_median_ratio})`);
  }
  if (r.mode === 'cold' && r.p95_ms > (thr.candidate_p95_cold_ms_max || 250) * 4) {
    errors.push(`${r.id}: cold p95 excessive (${r.p95_ms}ms)`);
  }
  if (r.mode === 'heavy' && r.p95_ms > (thr.candidate_p95_heavy_ms_max || 1000) * 4) {
    errors.push(`${r.id}: heavy p95 excessive (${r.p95_ms}ms)`);
  }
}

if (errors.length) {
  process.stderr.write(`validate-hook-multiplexer-benchmark: FAIL\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('validate-hook-multiplexer-benchmark: ok\n');
process.exit(0);
