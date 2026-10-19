#!/usr/bin/env node
'use strict';
// sample-v2.js — adjudication sample (seed 20261019 LCG Fisher-Yates) plus truncated diffs.
// Usage: node docs/plans/evidence/2026-10-19-test-integrity-replay-v2/sample-v2.js
const fs = require('fs');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const DIR = `${ROOT}/docs/plans/evidence/2026-10-19-test-integrity-replay-v2`;
const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${DIR}/replay.json.gz`)).toString('utf8'));
let pick;
if (j.records.length <= 150) {
  pick = j.records.map((_, i) => i);
} else {
  let s = 20261019;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const idx = j.records.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const k = Math.floor(rnd() * (i + 1));
    [idx[i], idx[k]] = [idx[k], idx[i]];
  }
  pick = idx.slice(0, 150).sort((a, b) => a - b);
}
const cache = {};
const out = [];
const diffParts = [];
const seenGroup = new Set();
pick.forEach((i, n) => {
  const r = j.records[i];
  const m = r.merge_sha;
  const key = m + r.file;
  if (!cache[key]) {
    try {
      cache[key] = execFileSync('git', ['diff', `${m}^1`, m, '--', r.file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (e) {
      cache[key] = (e.stdout || '').toString();
    }
  }
  if (!seenGroup.has(key)) {
    seenGroup.add(key);
    const truncated = cache[key].split('\n').slice(0, 60).join('\n');
    diffParts.push(`GROUP ${m.slice(0, 8)} ${r.file}\n${truncated}`);
  }
  const d = cache[key].split('\n');
  const add = d.filter((l) => l[0] === '+' && l[1] !== '+').map((l) => l.slice(1).trim());
  const det = (r.detail || '').trim();
  const norm = (x) => x.replace(/\s+/g, '');
  const exact = add.some((a) => norm(a) === norm(det));
  const sim = add.find((a) => a.length > 6 && det.length > 6 && norm(a).includes(norm(det).slice(0, Math.min(20, norm(det).length))));
  out.push(`#${n} i=${i} ${r.kind} ${r.file}:${r.line} m=${m.slice(0, 8)} added=${exact ? 'EXACT' : sim ? 'SIM' : 'no'} nadd=${add.length}\n   - ${det.slice(0, 160)}${sim && !exact ? `\n   + ${sim.slice(0, 160)}` : ''}`);
});
fs.writeFileSync(`${DIR}/sample-v2.txt`, out.join('\n'));
fs.writeFileSync(`${DIR}/sample-v2.idx.json`, JSON.stringify(pick));
fs.writeFileSync(`${DIR}/diffs-v2.txt`, `${diffParts.join('\n')}\n`);
process.stdout.write(`sample ${pick.length} groups ${seenGroup.size}\n`);
