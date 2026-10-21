#!/usr/bin/env node
// run-dcard-v2-campaign.js — dcard-v2 owner-decision campaign (prereg/dcard-v2.json).
// Same cell runner as run-dcard-campaign.js. This row does not re-run the nohook arm:
// dcard already showed the empty hook pack removes the mechanism, and the hook pack
// and markers here are the dcard bytes. Change packs are the change3 overlay.
//
//   run-dcard-v2-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet]
//       [--runner cc|stub] [--arms-dir <dir>] [--prereg <json>]
//
// Cells, serial, resumable per cell via run-skill-onoff-matrix.sh:
//   dcard-owner-decision × {base,change} × 10
//   a2-within-doa        × {base,change} × 5
// Every cell: --check-skill ceo-agent, ONOFF_PROMPT_PREFIX = prereg.invocation_prefix,
// ONOFF_LIB_OVERRIDE = lib-dcard (a2's lib-r2 markers and dcard-markers.sh), timeout 10m.
// The matrix writes <results>.runner-pin. After the matrix, score-dcard.js with this prereg;
// exit code is the scorer's.
// --dry-run lists cells and spends nothing. --check-arms: base and change differ exactly
// and only in allowed_arm_difference.files.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-dcard-v2-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'dcard-v2.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'dcard-v2')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die('usage: run-dcard-v2-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--runner cc|stub] [--arms-dir <dir>]');
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const runner = val('--runner', 'cc');
const model = val('--model', P.model || 'sonnet');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PREFIX = P.invocation_prefix;
if (typeof PREFIX !== 'string' || !PREFIX.trim()) die('prereg.invocation_prefix is missing');
const LIB = path.join(HERE, 'lib-dcard');
const TIMEOUT = '10m';

const GROUPS = [
  { task: 'dcard-owner-decision', arms: [P.arms.off, P.arms.on], reps: P.reps },
  { task: 'a2-within-doa', arms: [P.arms.off, P.arms.on], reps: (P.control && P.control.reps) || 5 },
];

function packFiles(id, manifest) {
  const files = (manifest.packs || {})[id];
  if (!files) throw new Error(`pack not in manifest.json: ${id}`);
  const out = {};
  for (const [rel, digest] of Object.entries(files)) out[rel.slice(id.length + 1)] = digest;
  return out;
}
function asList(v) { return [].concat(v || []); }
function readArm(name) { return JSON.parse(fs.readFileSync(path.join(armsDir, `${name}.json`), 'utf8')); }

function merged(arm, manifest) {
  const out = {};
  for (const [skill, id] of Object.entries(arm.skills || {})) {
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) out[`skills/${skill}/${rel}`] = dig;
  }
  for (const id of asList(arm.files)) {
    for (const [rel, dig] of Object.entries(packFiles(id, manifest))) {
      if (Object.hasOwn(out, rel) && out[rel] !== dig) throw new Error(`path ${rel} conflicts inside arm ${arm.arm}`);
      out[rel] = dig;
    }
  }
  for (const id of asList(arm.fixture_scripts)) packFiles(id, manifest);
  return out;
}

function checkArms() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8'));
  const base = readArm(P.arms.off);
  const change = readArm(P.arms.on);
  const problems = [];
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const mb = merged(base, manifest);
  const mc = merged(change, manifest);
  const differing = [];
  for (const f of new Set([...Object.keys(mb), ...Object.keys(mc)])) if (mb[f] !== mc[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  if (JSON.stringify(base.fixture_scripts) !== JSON.stringify(change.fixture_scripts)) problems.push('fixture_scripts differ between base and change');
  if (JSON.stringify(base.skills) === JSON.stringify(change.skills) && JSON.stringify(base.files) === JSON.stringify(change.files)) problems.push('base and change manifests are identical');
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, differing: [], problems: [e.message] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

if (flag('--dry-run')) {
  const { done, fails } = (() => {
    const doneSet = new Set();
    const failsMap = new Map();
    let text = '';
    try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      const k = `${j.task_id}|${j.arm}|${j.rep}`;
      if (j.failure_class === null || j.failure_class === undefined) doneSet.add(k); else failsMap.set(k, (failsMap.get(k) || 0) + 1);
    }
    return { done: doneSet, fails: failsMap };
  })();
  const rows = [];
  for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
    const key = `${g.task}|${arm}|${rep}`;
    const status = done.has(key) ? 'done' : (fails.get(key) || 0) >= 3 ? 'exhausted' : 'todo';
    rows.push({ status, key });
    console.log(`${status.padEnd(9)} ${key}`);
  }
  console.log(JSON.stringify({
    dry_run: true, row: P.row, model, runner, cells_total: rows.length,
    cells_todo: rows.filter((r) => r.status === 'todo').length,
    invocation_prefix: PREFIX, lib: LIB, timeout: TIMEOUT, check_skill: 'ceo-agent',
  }));
  process.exit(0);
}

if (runner === 'cc') {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message] }; }
  if (!r.ok) die(`--check-arms failed: ${r.problems.join('; ')}`);
}
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const keep = path.join(path.dirname(path.resolve(resultsPath)), 'dcard-v2-cells');
for (const g of GROUPS) {
  console.log(`== task ${g.task}: [${g.arms.join(',')}] x ${g.reps}`);
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix.sh'),
    '--model', model, '--reps', String(g.reps), '--results', path.resolve(resultsPath),
    '--tasks', g.task, '--arms', g.arms.join(','), '--runner', runner, '--arm-manifests', armsDir, '--check-skill', 'ceo-agent'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ONOFF_PROMPT_PREFIX: PREFIX,
      ONOFF_TIMEOUT: process.env.ONOFF_TIMEOUT_OVERRIDE || TIMEOUT,
      ONOFF_LIB_OVERRIDE: LIB,
      ONOFF_KEEP_CELLS_DIR: keep,
    },
  });
  if (r.status !== 0) die(`matrix failed for ${g.task} [${g.arms.join(',')}] (exit ${r.status})`);
}
const s = cp.spawnSync('node', [path.join(HERE, 'score-dcard.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
