#!/usr/bin/env node
'use strict';
// carryover.js — whether each old 150-record sample still appears in the new replay.
// Usage: node docs/plans/evidence/2026-10-19-test-integrity-replay-v2/carryover.js
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const OLDDIR = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay`;
const DIR = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay-v2`;
const old = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${OLDDIR}/replay.json.gz`)).toString('utf8'));
const idx = JSON.parse(fs.readFileSync(`${OLDDIR}/sample.idx.json`, 'utf8'));
const cur = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${DIR}/replay.json.gz`)).toString('utf8'));
const groupSet = new Set(cur.records.map((r) => `${r.merge_sha}\t${r.file}\t${r.kind}`));
const detailSet = new Set(cur.records.map((r) => `${r.merge_sha}\t${r.file}\t${r.kind}\t${r.detail}`));
const rows = [];
const lines = [];
let groupYes = 0;
let exactYes = 0;
idx.forEach((oldIndex, n) => {
  const r = old.records[oldIndex];
  const gkey = `${r.merge_sha}\t${r.file}\t${r.kind}`;
  const group = groupSet.has(gkey);
  const exact = detailSet.has(`${gkey}\t${r.detail}`);
  if (group) groupYes += 1;
  if (exact) exactYes += 1;
  const row = {
    n,
    old_index: oldIndex,
    kind: r.kind,
    file: r.file,
    merge8: r.merge_sha.slice(0, 8),
    group_still_reported: group,
    exact_still_reported: exact,
  };
  rows.push(row);
  lines.push(`${n} ${oldIndex} ${r.kind} ${r.file} ${row.merge8} group=${group ? 'yes' : 'no'} exact=${exact ? 'yes' : 'no'}`);
});
lines.push(`totals sample=${idx.length} group_still_reported=${groupYes} exact_still_reported=${exactYes}`);
fs.writeFileSync(`${DIR}/carryover.txt`, `${lines.join('\n')}\n`);
fs.writeFileSync(`${DIR}/carryover.json`, `${JSON.stringify({ totals: { sample: idx.length, group_still_reported: groupYes, exact_still_reported: exactYes }, rows }, null, 2)}\n`);
process.stdout.write(`carryover group=${groupYes} exact=${exactYes} of ${idx.length}\n`);
