#!/usr/bin/env node
// score-dc.js — mechanical scorer for the dev-flow card campaign (row "dc", BL-0044). Derived from score-onoff.js:
// the family map, reps, V2 floor and informational families come from a FROZEN prereg (prereg/dc.json) instead of constants;
// V1 reads the row's `skill_invoked` (rows of arm-manifest cells carry it). Same V1/V2/V3 + verdict map as the frozen rules.
// Implements the PRE-REGISTERED rules frozen in
// docs/plans/_archive/2026/08/2026-08-18-dev-flow-contract-card.md §4 (V1 manipulation check /
// V2 sensitivity gate / V3 non-inferiority / verdict map). The final ship decision is a
// Board read of the printed table — these rules are clamps against motivated reasoning.
//
// Usage: score-dc.js --prereg <prereg/dc.json> --results <file.jsonl> [--json] [--arms full,off]
// Exit codes: 0 SHIP-GATE-MET · 3 ITERATE-CARD · 4 ABORT-RECORD · 5 INSTRUMENT-INVALID
//             2 usage/input error.
// A vacuous FULL≈OFF dataset can NEVER exit 0 (V2 runs before V3 unconditionally).

'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
const pi = args.indexOf('--prereg');
if (pi < 0 || !args[pi + 1]) {
  console.error('usage: score-dc.js --prereg <prereg/dc.json> --results <file.jsonl> [--json] [--arms full,off]');
  process.exit(2);
}
let PREREG;
try { PREREG = JSON.parse(fs.readFileSync(args[pi + 1], 'utf8')); } catch (e) { console.error(`unreadable prereg: ${e.message}`); process.exit(2); }
// families: counted (V2) · informational: scored and printed, never counted toward V2 (documented-only rules)
const FAMILIES = PREREG.families;
const INFO = PREREG.informational || {};
const ALLF = { ...FAMILIES, ...INFO };
const armsArg = args.indexOf('--arms');
const ARMS = armsArg >= 0 ? args[armsArg + 1].split(',') : PREREG.arms;
const REPS = PREREG.reps;
const MIN_LB = PREREG.min_load_bearing;
const NFAM = Object.keys(FAMILIES).length;
const ALL_TASKS = [...new Set(Object.values(ALLF).flatMap((f) => Object.keys(f.tasks)))];

function margins(n) {
  // V2 load-bearing margin / V3 non-inferiority margin, per frozen rules.
  if (n >= 9) return { v2: 3, v3: 2 };
  return { v2: 2, v3: 1 };
}

const ri = args.indexOf('--results');
if (ri < 0 || !args[ri + 1]) {
  console.error('usage: score-dc.js --prereg <file> --results <file.jsonl> [--json] [--arms a,b]');
  process.exit(2);
}
const asJson = args.includes('--json');
let rows;
try {
  rows = fs
    .readFileSync(args[ri + 1], 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
} catch (e) {
  console.error(`unreadable results: ${e.message}`);
  process.exit(2);
}

// ── single-model block (mixed models invalidate) ──
const models = [...new Set(rows.map((r) => r.model))];
if (models.length > 1) {
  console.error(`INSTRUMENT-INVALID: mixed models in one block: ${models.join(', ')}`);
  process.exit(5);
}
const versions = [...new Set(rows.filter((r) => r.runner === 'cc').map((r) => r.runner_version))];
if (versions.length > 1) {
  console.error(`INSTRUMENT-INVALID: runner_version drift mid-block: ${versions.join(' | ')}`);
  process.exit(5);
}

// ── per-cell resolution: a cell is OK if any row succeeded; infra-only = missing ──
const ok = new Map(); // "task|arm|rep" → row
const infraCount = Object.fromEntries(ARMS.map((a) => [a, 0]));
for (const r of rows) {
  const key = `${r.task_id}|${r.arm}|${r.rep}`;
  if (r.failure_class === null || r.failure_class === undefined) {
    ok.set(key, r);
  } else if (infraCount[r.arm] !== undefined) {
    infraCount[r.arm] += 1;
  }
}
// >10% of an arm's cells ending infra_fail (unresolved) invalidates the block
const cellsPerArm = ALL_TASKS.length * REPS;
for (const arm of ARMS) {
  let unresolved = 0;
  for (const task of ALL_TASKS)
    for (let rep = 1; rep <= REPS; rep++) if (!ok.has(`${task}|${arm}|${rep}`)) unresolved++;
  if (unresolved > cellsPerArm * 0.1) {
    console.error(
      `INSTRUMENT-INVALID: arm '${arm}' has ${unresolved}/${cellsPerArm} unresolved cells (>10%)`,
    );
    process.exit(5);
  }
}

// ── paired exclusion: a (task,rep) missing in ANY arm is excluded from ALL arms ──
const excludedPairs = new Set();
for (const task of ALL_TASKS)
  for (let rep = 1; rep <= REPS; rep++)
    if (!ARMS.every((arm) => ok.has(`${task}|${arm}|${rep}`))) excludedPairs.add(`${task}|${rep}`);

// families losing ≥2 pairs invalidate the block
for (const [fid, fam] of Object.entries(ALLF)) {
  let lost = 0;
  for (const task of Object.keys(fam.tasks))
    for (let rep = 1; rep <= REPS; rep++) if (excludedPairs.has(`${task}|${rep}`)) lost++;
  if (lost >= 2) {
    console.error(`INSTRUMENT-INVALID: family ${fid} lost ${lost} pairs to paired exclusion`);
    process.exit(5);
  }
}

// ── family scores per arm ──
const score = {}; // fid → {arm → count}, plus n
for (const [fid, fam] of Object.entries(ALLF)) {
  score[fid] = { n: 0, full: 0, card: 0, off: 0 };
  for (const task of Object.keys(fam.tasks)) {
    for (let rep = 1; rep <= REPS; rep++) {
      if (excludedPairs.has(`${task}|${rep}`)) continue;
      score[fid].n += 1;
      for (const arm of ARMS) {
        const row = ok.get(`${task}|${arm}|${rep}`);
        const need = fam.tasks[task];
        if (row && need.every((m) => row.markers && row.markers[m] === true)) score[fid][arm] += 1;
      }
    }
  }
}

// ── V1 manipulation check ──
const v1 = {};
for (const arm of ARMS.filter((a) => a !== 'off')) {
  let eff = 0;
  let invoked = 0;
  for (const task of ALL_TASKS)
    for (let rep = 1; rep <= REPS; rep++) {
      if (excludedPairs.has(`${task}|${rep}`)) continue;
      const row = ok.get(`${task}|${arm}|${rep}`);
      if (!row) continue;
      eff += 1;
      if (row.skill_invoked === true) invoked += 1;
    }
  v1[arm] = { invoked, eff, pass: eff > 0 && invoked >= Math.ceil((eff * 2) / 3) };
}
const v1pass = ARMS.filter((a) => a !== 'off').every((a) => v1[a].pass);

// ── V2 sensitivity gate ──
const loadBearing = [];
for (const [fid, s] of Object.entries(score)) {
  if (!FAMILIES[fid]) continue;
  const m = margins(s.n);
  if (s.full - s.off >= m.v2) loadBearing.push(fid);
}
const v2pass = loadBearing.length >= MIN_LB;

// ── V3 non-inferiority (only meaningful if V1∧V2) ──
const v3fails = [];
for (const fid of loadBearing) {
  const s = score[fid];
  const m = margins(s.n);
  const nonInferior = s.card >= s.full - m.v3;
  const beatsAbsence = s.card - s.off >= Math.ceil((s.full - s.off) / 2);
  if (!(nonInferior && beatsAbsence)) v3fails.push(fid);
}

let verdict;
let exit;
if (!v1pass) {
  verdict = 'INSTRUMENT-INVALID (V1: dev-flow routing failure — no content judgment recorded)';
  exit = 5;
} else if (!v2pass) {
  verdict = `INSTRUMENT-INVALID (V2: only ${loadBearing.length}/${NFAM} families load-bearing — vacuous)`;
  exit = 5;
} else if (!ARMS.includes('card')) {
  verdict = `V2-PHASE-PASS (${loadBearing.length}/${NFAM} load-bearing; run the card arm, V3 not evaluated)`;
  exit = 0;
} else if (v3fails.length === 0) {
  verdict = 'SHIP-GATE-MET';
  exit = 0;
} else if (v3fails.length <= 2) {
  verdict = `ITERATE-CARD (V3 failed on: ${v3fails.join(', ')})`;
  exit = 3;
} else {
  verdict = `ABORT-RECORD (V3 failed on: ${v3fails.join(', ')})`;
  exit = 4;
}

const report = {
  model: models[0] || null,
  runner_version: versions[0] || null,
  excluded_pairs: [...excludedPairs],
  families: Object.fromEntries(
    Object.entries(score).map(([fid, s]) => [
      fid,
      { ...s, label: ALLF[fid].label, informational: !FAMILIES[fid], load_bearing: loadBearing.includes(fid) },
    ]),
  ),
  v1,
  v2: { load_bearing: loadBearing, pass: v2pass },
  v3: { failed_families: v3fails },
  verdict,
};
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`model=${report.model} runner=${report.runner_version}`);
  console.log(`excluded pairs: ${report.excluded_pairs.length ? report.excluded_pairs.join(', ') : 'none'}`);
  console.log('family                          n  FULL CARD  OFF  load-bearing');
  for (const [fid, s] of Object.entries(report.families)) {
    console.log(
      `${(fid + ' ' + s.label).padEnd(30)} ${String(s.n).padStart(2)}  ${String(s.full).padStart(4)} ${String(s.card).padStart(4)} ${String(s.off).padStart(4)}  ${s.load_bearing}`,
    );
  }
  console.log(`V1 ${Object.entries(v1).map(([a, v]) => `${a}=${v.invoked}/${v.eff}`).join(' ')} pass=${v1pass}`);
  console.log(`V2 load-bearing=${loadBearing.join(',') || 'none'} pass=${v2pass}`);
  console.log(`VERDICT: ${verdict}`);
}
process.exit(exit);
