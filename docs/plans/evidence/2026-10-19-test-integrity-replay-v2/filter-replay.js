#!/usr/bin/env node
'use strict';
// filter-replay.js — keep the 60-merge window out of a wider replay-raw.json and gzip it.
// Usage: node docs/plans/evidence/2026-10-19-test-integrity-replay-v2/filter-replay.js
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay-v2`;
const git60 = execFileSync('git', ['rev-list', '--first-parent', '--merges', '-60', 'a007fa65e'], { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n').filter(Boolean);
const keep = new Set(git60);
const raw = JSON.parse(fs.readFileSync(`${DIR}/replay-raw.json`, 'utf8'));
const records = raw.records.filter((r) => keep.has(r.merge_sha));
const counts = {};
const rangesWith = new Set();
for (const r of records) {
  counts[r.kind] = (counts[r.kind] || 0) + 1;
  rangesWith.add(r.range);
}
const errors = (raw.errors || []).filter((e) => {
  const text = `${e.range || ''} ${e.merge_sha || ''}`;
  return git60.some((sha) => text.includes(sha));
});
const report = {
  count_requested: 60,
  ranges_scanned: 60,
  ranges_with_violations: rangesWith.size,
  counts_by_kind: counts,
  records,
  errors,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
fs.writeFileSync(`${DIR}/replay.json.gz`, zlib.gzipSync(Buffer.from(json)));
fs.unlinkSync(`${DIR}/replay-raw.json`);
process.stdout.write(`filtered records=${records.length} ranges_with_violations=${rangesWith.size} errors=${errors.length}\n`);
