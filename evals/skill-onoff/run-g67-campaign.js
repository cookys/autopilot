#!/usr/bin/env node
// run-g67-campaign.js — one command for the stage-graph-g67 eval (prereg/stage-graph-g67.{md,json}).
//
//   run-g67-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--reps 3]
//       [--runner cc|stub] [--arms-dir <dir>] [--prereg <json>]
//
// Cells: 4 tasks x {off,on} x reps, run serially through run-skill-onoff-matrix.sh (so it is resumable by cell: re-run the
// same command after any interruption; a `failure_class` row re-runs, max 3 recorded attempts per cell). One matrix call
// per task, because the invocation preface, the manipulation-check skill and the per-cell timeout are per task
// (ONOFF_PROMPT_PREFIX / --check-skill / ONOFF_TIMEOUT). ONOFF_TIMEOUT_IS_COMPLETE=1 makes the timeout the registered stop.
// Every row is stamped with arm_manifest_sha256 by run-skill-onoff-eval.sh. Cell artifacts are kept under
// <results dir>/g67-cells/<task>/<arm>/<rep>/ (transcript, g67-extracted.json, markers.env; gitignored).
// After the matrix: score-g67.js and its verdict JSON is printed; exit code = scorer's
// (0 SHIP · 3 NOT-SHIP · 4 STOP · 5 INSTRUMENT-INVALID · 2 usage).
//
// Live preflight (cc runner): `claude --version` must equal the prereg's runner_version_pin and the arm manifests must
// exist and pass --check-arms (off and on differ only in the four registered skills). Run with the pin dir first on
// PATH:  PATH="<runner_pin_path>:$PATH" node evals/skill-onoff/run-g67-campaign.js --results ...
// --dry-run: prints the cell list (done/todo), the pin status and an estimated cost; spends nothing, needs no packs.
// --check-arms: spend-free; compares the frozen off/on packs named by the manifests (needs the packs frozen).
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-g67-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'stage-graph-g67.json'));
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'arms', 'g67')));
const packsDir = process.env.ONOFF_PACKS_DIR || path.join(HERE, 'packs');
if (!resultsPath && !flag('--check-arms')) die('usage: run-g67-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--model sonnet] [--reps 3] [--runner cc|stub]');
const P = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
const runner = val('--runner', 'cc');
const model = val('--model', P.model);
const reps = Number(val('--reps', String(P.reps)));
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
if (runner !== 'stub' && model !== P.model) die(`model must be ${P.model} (the prereg's registered model), got ${model}`);
if (!Number.isInteger(reps) || reps < 1) die('--reps must be a positive integer');
if (runner !== 'stub' && reps !== P.reps) die(`reps must be ${P.reps} (prereg) for a live run, got ${reps}`);
const ARMS = [P.arms.off, P.arms.on];
const TASKS = Object.keys(P.tasks);

// ---- arm integrity: off and on differ ONLY in the registered skills (byte-compare the frozen packs) ----
function packFiles(id, manifest) {
  const files = (manifest.packs || {})[id];
  if (!files) throw new Error(`pack not in manifest.json: ${id}`);
  const out = {};
  for (const [rel, digest] of Object.entries(files)) out[rel.slice(id.length + 1)] = digest;
  return out;
}
function checkArms() {
  const manifest = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8'));
  const arm = (a) => JSON.parse(fs.readFileSync(path.join(armsDir, `${a}.json`), 'utf8'));
  const off = arm(P.arms.off);
  const on = arm(P.arms.on);
  const allowed = new Set(P.allowed_arm_difference.skills);
  const problems = [];
  const differing = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const s of new Set([...Object.keys(off.skills), ...Object.keys(on.skills)])) {
    if (!off.skills[s] || !on.skills[s]) { problems.push(`skill ${s} present in only one arm`); continue; }
    if (same(packFiles(off.skills[s], manifest), packFiles(on.skills[s], manifest))) { if (allowed.has(s)) problems.push(`skill ${s} is registered as changed but its packs are identical`); continue; }
    differing.push(s);
    if (!allowed.has(s)) problems.push(`skill ${s} differs between the arms but is not a registered change`);
  }
  for (const s of allowed) if (!differing.includes(s) && off.skills[s] && on.skills[s] && !problems.some((p) => p.startsWith(`skill ${s} `))) problems.push(`skill ${s} did not differ`);
  const merge = (ids) => Object.assign({}, ...[].concat(ids || []).map((i) => packFiles(i, manifest)));
  if (!same(merge(off.files), merge(on.files))) problems.push('guidance files packs differ between the arms (only the four registered SKILL.md packs may differ)');
  if (!same(off.fixture_scripts, on.fixture_scripts)) problems.push('fixture_scripts lists differ between the arms');
  for (const id of off.fixture_scripts || []) packFiles(id, manifest); // must exist
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}
if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, differing: [], problems: [e.message] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

// ---- pin status ----
function pinStatus() {
  const dir = P.runner_pin_path;
  const s = { pin_path: dir, pin_dir_exists: fs.existsSync(dir), pin_target: null, pin_version: null, path_claude: null, path_claude_version: null, path_matches_pin: false };
  try { s.pin_target = fs.readlinkSync(path.join(dir, 'claude')); } catch { /* absent */ }
  const ver = (bin) => { const r = cp.spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20000 }); return r.status === 0 ? r.stdout.trim().split('\n')[0] : null; };
  if (s.pin_dir_exists) s.pin_version = ver(path.join(dir, 'claude'));
  const w = cp.spawnSync('bash', ['-c', 'command -v claude'], { encoding: 'utf8' });
  s.path_claude = w.status === 0 ? w.stdout.trim() : null;
  if (s.path_claude) s.path_claude_version = ver(s.path_claude);
  s.path_matches_pin = !!s.path_claude_version && s.path_claude_version === P.runner_version_pin;
  s.pin_version_matches_prereg = !!s.pin_version && s.pin_version === P.runner_version_pin;
  return s;
}

// resume state, same rule as the matrix: done = a row with no failure_class; exhausted = 3 failed attempts
function state() {
  const done = new Set();
  const fails = new Map();
  let text = '';
  try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const k = `${j.task_id}|${j.arm}|${j.rep}`;
    if (j.failure_class === null || j.failure_class === undefined) done.add(k); else fails.set(k, (fails.get(k) || 0) + 1);
  }
  return { done, fails };
}
function costBasis() {
  let costs = [];
  try { costs = fs.readFileSync(path.join(HERE, 'results', 'batch-log.txt'), 'utf8').split('\n').map((l) => Number((l.match(/cost=([0-9.]+)/) || [])[1])).filter((x) => x > 0); } catch { /* fall back */ }
  if (!costs.length) return { n: 0, mean: 0.135, max: 0.52, source: 'fallback constants (results/batch-log.txt unreadable)' };
  return { n: costs.length, mean: costs.reduce((a, b) => a + b, 0) / costs.length, max: Math.max(...costs), source: 'results/batch-log.txt (measured sonnet cells of the earlier skill-onoff rows)' };
}
const toSec = (t) => (/m$/.test(t) ? Number(t.slice(0, -1)) * 60 : Number(t.replace(/s$/, '')));

if (flag('--dry-run')) {
  const { done, fails } = state();
  const basis = costBasis();
  const rows = [];
  for (const t of TASKS) for (let rep = 1; rep <= reps; rep++) for (const arm of ARMS) {
    const k = `${t}|${arm}|${rep}`;
    rows.push({ key: k, task: t, status: done.has(k) ? 'done' : (fails.get(k) || 0) >= 3 ? 'exhausted' : 'todo' });
  }
  for (const r of rows) console.log(`${r.status.padEnd(9)} ${r.key}`);
  const todo = rows.filter((r) => r.status === 'todo');
  const wallMax = todo.reduce((n, r) => n + toSec(P.tasks[r.task].timeout), 0);
  const missingManifests = ARMS.filter((a) => !fs.existsSync(path.join(armsDir, `${a}.json`)));
  const missingPacks = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8'));
    for (const a of ARMS) {
      if (!fs.existsSync(path.join(armsDir, `${a}.json`))) continue;
      const m = JSON.parse(fs.readFileSync(path.join(armsDir, `${a}.json`), 'utf8'));
      for (const id of [...Object.values(m.skills), ...[].concat(m.files || []), ...(m.fixture_scripts || [])]) if (!(manifest.packs || {})[id]) missingPacks.push(`${a}:${id}`);
    }
  } catch { /* no manifest */ }
  const summary = {
    dry_run: true, row: P.row, model, reps, results: resultsPath,
    cells_total: rows.length, cells_todo: todo.length, cells_done: rows.filter((r) => r.status === 'done').length, cells_exhausted: rows.filter((r) => r.status === 'exhausted').length,
    per_task_timeout: Object.fromEntries(TASKS.map((t) => [t, P.tasks[t].timeout])),
    wall_clock_minutes: { worst_case_all_cells_hit_timeout: Math.round(wallMax / 60), typical_assumption: '2-4 min per cell (the markers sit in the first minutes; stage-graph cells measured 25-250 s, median 25 s with no timeout)' },
    estimated_cost_usd: { low: +(todo.length * basis.mean).toFixed(2), typical: +(todo.length * basis.mean * 2).toFixed(2), high: +(todo.length * basis.max).toFixed(2) },
    cost_basis: { measured_cells: basis.n, measured_mean_usd: +basis.mean.toFixed(3), measured_max_usd: +basis.max.toFixed(3), source: basis.source, typical_assumption: 'a skill-loading entry cell assumed 2x the measured mean (l4/l5/l6/finish-flow bodies are long; an assumption, not a measurement); low = all at measured mean, high = all at measured max' },
    arm_manifests_missing: missingManifests,
    packs_missing: missingPacks,
    pin: pinStatus(),
  };
  console.log(JSON.stringify(summary));
  process.exit(0);
}

// ---- live (or stub) run ----
for (const a of ARMS) if (!fs.existsSync(path.join(armsDir, `${a}.json`))) die(`arm manifest missing: ${path.join(armsDir, `${a}.json`)}`);
if (runner === 'cc') {
  const pin = pinStatus();
  if (!pin.path_matches_pin) die(`claude on PATH (${pin.path_claude} = ${pin.path_claude_version}) is not the registered pin ${P.runner_version_pin}; put ${P.runner_pin_path} first on PATH`);
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message] }; }
  if (!r.ok) die(`--check-arms failed: ${r.problems.join('; ')}`);
}
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const KEEP_CELLS_DIR = path.join(path.dirname(path.resolve(resultsPath)), 'g67-cells');
for (const t of TASKS) {
  const T = P.tasks[t];
  console.log(`== task ${t}: [${ARMS.join(',')}] x ${reps} reps (prefix "${T.prefix}", check-skill ${T.skill}, timeout ${T.timeout})`);
  const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix.sh'), '--model', model, '--reps', String(reps), '--results', path.resolve(resultsPath),
    '--tasks', t, '--arms', ARMS.join(','), '--runner', runner, '--arm-manifests', armsDir, '--check-skill', T.skill], {
    stdio: 'inherit',
    env: { ...process.env, ONOFF_PROMPT_PREFIX: T.prefix, ONOFF_TIMEOUT: process.env.ONOFF_TIMEOUT_OVERRIDE || T.timeout, ONOFF_TIMEOUT_IS_COMPLETE: '1', ONOFF_KEEP_CELLS_DIR: KEEP_CELLS_DIR },
  });
  if (r.status !== 0) die(`matrix failed for task ${t} (exit ${r.status})`);
}
const s = cp.spawnSync('node', [path.join(HERE, 'score-g67.js'), '--prereg', preregPath, '--results', path.resolve(resultsPath)], { encoding: 'utf8' });
process.stderr.write(s.stderr || '');
process.stdout.write(s.stdout || '');
process.exit(s.status === null ? 2 : s.status);
