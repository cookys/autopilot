#!/usr/bin/env node
'use strict';
// stats.js — counts for the filtered replay versus the old 1101-record replay.
// Usage: node docs/plans/evidence/2026-10-19-test-integrity-replay-v2/stats.js
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay-v2`;
const cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${DIR}/replay.json.gz`)).toString('utf8'));
const groups = new Map();
for (const r of cur.records) {
  const key = `${r.merge_sha}\t${r.file}\t${r.kind}`;
  groups.set(key, (groups.get(key) || 0) + 1);
}
const byKind = cur.counts_by_kind;
const stats = {
  total_remaining_records: cur.records.length,
  by_kind: byKind,
  ranges_scanned: cur.ranges_scanned,
  ranges_with_violations: cur.ranges_with_violations,
  errors: cur.errors.length,
  old_total: 1101,
  remaining_versus_old_1101: cur.records.length - 1101,
  groups: [...groups.entries()].map(([key, count]) => {
    const [merge_sha, file, kind] = key.split('\t');
    return { merge_sha, file, kind, count };
  }).sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
};
fs.writeFileSync(`${DIR}/stats.json`, `${JSON.stringify(stats, null, 2)}\n`);
const lines = [];
lines.push(`total_remaining_records ${stats.total_remaining_records}`);
lines.push(`old_total 1101`);
lines.push(`remaining_versus_old_1101 ${stats.remaining_versus_old_1101}`);
lines.push(`ranges_scanned ${stats.ranges_scanned}`);
lines.push(`ranges_with_violations ${stats.ranges_with_violations}`);
lines.push(`errors ${stats.errors}`);
lines.push('by_kind');
for (const [k, v] of Object.entries(byKind).sort()) lines.push(`  ${k} ${v}`);
lines.push('groups merge file kind count');
for (const g of stats.groups) lines.push(`${g.merge_sha.slice(0, 8)} ${g.count} ${g.kind} ${g.file}`);
fs.writeFileSync(`${DIR}/stats.txt`, `${lines.join('\n')}\n`);
process.stdout.write(`stats records=${stats.total_remaining_records} groups=${stats.groups.length}\n`);
