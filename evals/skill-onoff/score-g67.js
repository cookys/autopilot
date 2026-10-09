#!/usr/bin/env node
// score-g67.js — mechanical scorer for the pre-registered stage-graph-g67 row (prereg/stage-graph-g67.{json,md}).
// score-p1w.js does not fit: its thresholds are aggregate counts over all primary tasks, this row's ship rule is
// per task (ON >= on_min_reps, OFF <= off_max_reps). Thresholds live in the prereg JSON; this script only applies
// them. It aggregates recorded rows only (no transcripts), so it can be re-run on a committed results file.
//
// Usage: score-g67.js --prereg <prereg/stage-graph-g67.json> --results <file.jsonl>
// A cell passes iff its row has failure_class null and markers[<task marker>] === true.
// Order of judgement (a vacuous or invalid instrument can never reach exit 0):
//   1. mixed model / mixed or unpinned runner version (cc rows) ....... INSTRUMENT-INVALID  exit 5
//   2. arm integrity: >1 arm_manifest_sha256 per arm, off == on, or a prereg-pinned sha not matched ... exit 5
//   3. any (task, arm, rep) cell without a clean row (missing or only infra_fail rows) ....... STOP exit 4
//      (a rerun that produced a clean row clears it: the rule is "rerun that cell", not "discard the campaign")
//   4. manipulation check (V1): the task's skill invoked in >= v1_min_invoked_ratio of each arm's cells
//      ........................................................... INSTRUMENT-INVALID exit 5
//   5. ship rule: every task has ON passes >= on_min_reps AND OFF passes <= off_max_reps ... SHIP exit 0 / NOT-SHIP exit 3
// Exit 2 = usage / unreadable input. stdout: ONE JSON object {row, verdict, reasons[], counts{}, changes{}}.
'use strict';
const fs = require('fs');

const argv = process.argv.slice(2);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const preregPath = val('--prereg');
const resultsPath = val('--results');
if (!preregPath || !resultsPath) { console.error('usage: score-g67.js --prereg <file.json> --results <file.jsonl>'); process.exit(2); }
let P;
let rows;
try {
  P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
  rows = fs.readFileSync(resultsPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
} catch (e) { console.error(`score-g67: unreadable input: ${e.message}`); process.exit(2); }

const OFF = P.arms.off;
const ON = P.arms.on;
const T = P.thresholds;
const taskIds = Object.keys(P.tasks);
const emit = (code, verdict, reasons, counts, changes) => {
  process.stdout.write(`${JSON.stringify({ row: P.row, verdict, reasons, counts: counts || {}, changes: changes || {} })}\n`);
  process.exit(code);
};

const mine = rows.filter((r) => taskIds.includes(r.task_id) && [OFF, ON].includes(r.arm));
const models = [...new Set(mine.map((r) => r.model))];
const cc = mine.filter((r) => r.runner === 'cc');
const versions = [...new Set(cc.map((r) => r.runner_version))];
if (models.length > 1) emit(5, 'INSTRUMENT-INVALID', [`mixed models: ${models.join(', ')}`]);
if (models.length === 1 && models[0] !== P.model) emit(5, 'INSTRUMENT-INVALID', [`model ${models[0]} != registered ${P.model}`]);
if (versions.length > 1) emit(5, 'INSTRUMENT-INVALID', [`mixed runner versions: ${versions.join(' | ')}`]);
if (versions.length === 1 && P.runner_version_pin && versions[0] !== P.runner_version_pin) emit(5, 'INSTRUMENT-INVALID', [`runner ${versions[0]} != registered pin ${P.runner_version_pin}`]);

// arm integrity (rows stamp the sha256 of the manifest they ran under)
const shaOf = (arm) => [...new Set(mine.filter((r) => r.arm === arm && r.arm_manifest_sha256).map((r) => r.arm_manifest_sha256))];
const offSha = shaOf(OFF);
const onSha = shaOf(ON);
if (offSha.length > 1 || onSha.length > 1) emit(5, 'INSTRUMENT-INVALID', [`more than one arm manifest per arm (off ${offSha.length}, on ${onSha.length})`]);
if (offSha.length === 1 && onSha.length === 1 && offSha[0] === onSha[0]) emit(5, 'INSTRUMENT-INVALID', ['off and on ran under the same arm manifest']);
for (const [arm, got] of [[OFF, offSha], [ON, onSha]]) {
  const pinned = P.arm_manifests && P.arm_manifests[arm] && P.arm_manifests[arm].sha256;
  if (pinned && got.length === 1 && got[0] !== pinned) emit(5, 'INSTRUMENT-INVALID', [`${arm} arm manifest sha ${got[0]} != registered ${pinned}`]);
}

// completeness
const clean = new Map();
for (const r of mine) if (r.failure_class === null || r.failure_class === undefined) clean.set(`${r.task_id}|${r.arm}|${r.rep}`, r);
const missing = [];
for (const t of taskIds) for (const arm of [OFF, ON]) for (let rep = 1; rep <= P.reps; rep++) if (!clean.has(`${t}|${arm}|${rep}`)) missing.push(`${t}|${arm}|${rep}`);
const failedRows = mine.filter((r) => r.failure_class).length;
if (missing.length) emit(4, 'STOP', [`${missing.length} cell(s) without a clean row — rerun them: ${missing.join(', ')}`], { missing: missing.length, infra_fail_rows: failedRows });

// V1 manipulation check
const invoked = (arm) => {
  let inv = 0;
  let n = 0;
  for (const t of taskIds) for (let rep = 1; rep <= P.reps; rep++) { n++; if (clean.get(`${t}|${arm}|${rep}`).skill_invoked === true) inv++; }
  return { inv, n };
};
const vOff = invoked(OFF);
const vOn = invoked(ON);
const need = (v) => Math.ceil(v.n * T.v1_min_invoked_ratio);
const counts = { tasks: {}, v1: { off: vOff, on: vOn } };
if (vOff.inv < need(vOff) || vOn.inv < need(vOn)) emit(5, 'INSTRUMENT-INVALID', [`V1: the task skill was not invoked in enough cells (off ${vOff.inv}/${vOff.n}, on ${vOn.inv}/${vOn.n}, need ${T.v1_min_invoked_ratio}) — no content judgement`], counts);

// ship rule
const reasons = [];
const taskOk = {};
for (const t of taskIds) {
  const marker = P.tasks[t].marker;
  const pass = (arm) => { let n = 0; for (let rep = 1; rep <= P.reps; rep++) if (clean.get(`${t}|${arm}|${rep}`).markers && clean.get(`${t}|${arm}|${rep}`).markers[marker] === true) n++; return n; };
  const on = pass(ON);
  const off = pass(OFF);
  counts.tasks[t] = { marker, on, off };
  taskOk[t] = on >= T.on_min_reps && off <= T.off_max_reps;
  if (on < T.on_min_reps) reasons.push(`${t}: ON ${on}/${P.reps} < ${T.on_min_reps}`);
  if (off > T.off_max_reps) reasons.push(`${t}: OFF ${off}/${P.reps} > ${T.off_max_reps}`);
}
const changes = {};
for (const [name, ids] of Object.entries(P.changes || {})) changes[name] = ids.every((t) => taskOk[t]) ? 'holds' : 'fails';
const ship = taskIds.every((t) => taskOk[t]);
emit(ship ? 0 : 3, ship ? 'SHIP' : 'NOT-SHIP', ship ? ['every task: ON >= on_min_reps and OFF <= off_max_reps'] : reasons, counts, changes);
