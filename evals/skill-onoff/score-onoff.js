#!/usr/bin/env node
// score-onoff.js — mechanical scorer for the skill ON/OFF campaign.
// Implements the PRE-REGISTERED rules frozen in
// docs/plans/2026-08-18-dev-flow-contract-card.md §4 (V1 manipulation check /
// V2 sensitivity gate / V3 non-inferiority / verdict map). The final ship decision is a
// Board read of the printed table — these rules are clamps against motivated reasoning.
//
// Usage: score-onoff.js --results <file.jsonl> [--json]
// Exit codes: 0 SHIP-GATE-MET · 3 ITERATE-CARD · 4 ABORT-RECORD · 5 INSTRUMENT-INVALID
//             2 usage/input error.
// A vacuous FULL≈OFF dataset can NEVER exit 0 (V2 runs before V3 unconditionally).

'use strict';
const fs = require('fs');

// ── frozen family map: family → [task, [required marker names]] ──
const FAMILIES = {
  F1: {
    label: 'sizing/workflow-selection',
    tasks: {
      'd1-s-tiny-feature': ['f1_s_no_tracking'],
      'd2-l-multimodule': ['f1_session_sha', 'f1_plan_file', 'f1_project_readme'],
      'd7-fix-vs-l-boundary': ['f1_stays_fix_no_tracking'],
    },
  },
  F3: {
    label: 'branch discipline',
    tasks: {
      'd3-fix-known-bug': ['f3_fix_branch_flow'],
      'd4-hotfix': ['f3_hotfix_compound'],
      'd7-fix-vs-l-boundary': ['f3_fix_branch_flow'],
    },
  },
  F4: { label: 'maintenance ledger', tasks: { 'd3-fix-known-bug': ['f4_maintenance_ledger'] } },
  F5: {
    label: 'verification contract',
    tasks: {
      'd3-fix-known-bug': ['f5_red_before_edit'],
      'd5-verify-contract': ['f5_red_before_edit', 'f5_green_after_edit'],
    },
  },
  F6: {
    label: 'quality gate',
    tasks: {
      'd1-s-tiny-feature': ['f6_gate_before_commit'],
      'd3-fix-known-bug': ['f6_gate_before_commit'],
      'd6-quality-gate': ['f6_gate_before_commit'],
    },
  },
};
const ARMS = ['full', 'card', 'off'];
const REPS = 3;
const ALL_TASKS = [...new Set(Object.values(FAMILIES).flatMap((f) => Object.keys(f.tasks)))];

function margins(n) {
  // V2 load-bearing margin / V3 non-inferiority margin, per frozen rules.
  if (n >= 9) return { v2: 3, v3: 2 };
  return { v2: 2, v3: 1 };
}

const args = process.argv.slice(2);
const ri = args.indexOf('--results');
if (ri < 0 || !args[ri + 1]) {
  console.error('usage: score-onoff.js --results <file.jsonl> [--json]');
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
const infraCount = { full: 0, card: 0, off: 0 };
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
for (const [fid, fam] of Object.entries(FAMILIES)) {
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
for (const [fid, fam] of Object.entries(FAMILIES)) {
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
for (const arm of ['full', 'card']) {
  let eff = 0;
  let invoked = 0;
  for (const task of ALL_TASKS)
    for (let rep = 1; rep <= REPS; rep++) {
      if (excludedPairs.has(`${task}|${rep}`)) continue;
      const row = ok.get(`${task}|${arm}|${rep}`);
      if (!row) continue;
      eff += 1;
      if (row.skill_invoked_devflow === true) invoked += 1;
    }
  v1[arm] = { invoked, eff, pass: eff > 0 && invoked >= Math.ceil((eff * 2) / 3) };
}
const v1pass = v1.full.pass && v1.card.pass;

// ── V2 sensitivity gate ──
const loadBearing = [];
for (const [fid, s] of Object.entries(score)) {
  const m = margins(s.n);
  if (s.full - s.off >= m.v2) loadBearing.push(fid);
}
const v2pass = loadBearing.length >= 4;

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
  verdict = `INSTRUMENT-INVALID (V2: only ${loadBearing.length}/5 families load-bearing — vacuous)`;
  exit = 5;
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
      { ...s, label: FAMILIES[fid].label, load_bearing: loadBearing.includes(fid) },
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
  console.log(`V1 full=${v1.full.invoked}/${v1.full.eff} card=${v1.card.invoked}/${v1.card.eff} pass=${v1pass}`);
  console.log(`V2 load-bearing=${loadBearing.join(',') || 'none'} pass=${v2pass}`);
  console.log(`VERDICT: ${verdict}`);
}
process.exit(exit);
