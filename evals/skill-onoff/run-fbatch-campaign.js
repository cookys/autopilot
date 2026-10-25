#!/usr/bin/env node
// run-fbatch-campaign.js — findings-batch ON/OFF row (plan §4): fb-mid-batch (T1),
// fb-pool (T2), fb-critical-guard (T3, regression), fb-deadman (T4a invalid draft + T4b valid
// completion, one cell, two markers) x {base,change} x 5 (plan v3 §3-4).
//
//   run-fbatch-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--pilot]
//       [--runner stub|cc] [--model haiku|sonnet] [--arms base,change] [--reps N] [--prereg <json>]
//       [--arms-dir <dir>]
//
// --model: cell model. Default = prereg model (sonnet); --pilot defaults to prereg pilot_model
// (haiku, v3 option (b): pilot rates check wiring only and are never reused for V2/V3).
//
// Same flag contract as run-bpack-campaign.js. --dry-run ALSO needs --results (usage error
// otherwise, although it never spawns anything). --dry-run and --check-arms never spend.
// --runner stub scores deterministic stub cells (no model).
// --runner cc runs real `claude -p` cells through the fbatch runner, a pinned copy of the bpack one (run-skill-onoff-matrix-fbatch.sh ->
// run-skill-onoff-eval-fbatch.sh: scratch HOME + scratch CLAUDE_CONFIG_DIR holding only
// .credentials.json, plugin built per cell, turn2.sh second turn). This script only supplies the inputs through
// the runner's own env overlays (ONOFF_PACKS_DIR, ONOFF_TASKS_DIR, ONOFF_PROMPT_PREFIX, ONOFF_TIMEOUT,
// ONOFF_KEEP_CELLS_DIR, --arm-manifests, --check-skill): fbatch/cc-build.js assembles them per run from
// fbatch/arms and fbatch/cc/. One call = one cell, so the stop-loss is checked before every cell. Markers come from
// fbatch/cell.js (the fixture's execution ledger, the cell repo's git state and the filesystem snapshots; prereg
// cc.trace_source); after each call the new rows get row/pilot and the cell's actual cost_usd (total_cost_usd is the
// session's CUMULATIVE spend, CLI 2.1.309: the LAST result of each session_id, summed over sessions, never every result). Stop-loss: refuse when spent + max(the cell's estimate, the largest cell measured so far) exceeds
// ONOFF_MAX_USD, or when spent + (measured/estimated spend ratio of the done cells) x the remaining estimate does (needs
// prereg cc.extrapolate_min_cells measured cells first). HARD cap per cell: prereg cc.cell_ceiling_usd[task]; a cell is
// not dispatched when ONOFF_MAX_USD - spent is below its ceiling, otherwise the runner hands claude
// --max-budget-usd min(remaining, ceiling) (ONOFF_MAX_BUDGET_USD of the bpack runner; a two-turn cell's second turn gets
// what the first left; the CLI checks the budget after a call, so a cell may overshoot by up to one model call, see README). One results file per scope: a cc run refuses a file holding rows of another pilot flag or model (the matrix resume key
// ignores both). The paid run (P1) needs the owner's cap approval.
// --pilot = T1, T2, T4 one rep on both arms (6 cells), not scored.
// ONOFF_MAX_USD default 20; --dry-run exits 1 when the estimate exceeds it.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const L = require('./fbatch/lib');
const B = require('./fbatch/cc-build');
const CELL = require('./fbatch/cell');

const HERE = __dirname;
const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(n);
const die = (m, code = 2) => { console.error(`run-fbatch-campaign: ${m}`); process.exit(code); };
const resultsPath = val('--results');
const USAGE = 'usage: run-fbatch-campaign.js --results <file.jsonl> [--dry-run] [--check-arms] [--pilot] [--runner stub|cc] [--model haiku|sonnet] [--arms base,change] [--reps N]';
if (!resultsPath && !flag('--check-arms')) die(USAGE);
const preregPath = val('--prereg', path.join(HERE, 'prereg', 'findings-batch.json'));
let P;
try { P = JSON.parse(fs.readFileSync(preregPath, 'utf8')); } catch (e) { die(`cannot read prereg ${preregPath}: ${e.message}`); }
const armsDir = path.resolve(val('--arms-dir', path.join(HERE, 'fbatch', 'arms')));
const runner = val('--runner', 'stub');
if (!['cc', 'stub'].includes(runner)) die('runner must be cc|stub');
const PILOT = flag('--pilot');
const MODEL = val('--model', PILOT ? (P.pilot_model || P.model) : P.model);
if (!['haiku', 'sonnet'].includes(MODEL)) die('--model must be haiku|sonnet');
if (PILOT && (val('--reps') !== undefined || val('--arms') !== undefined)) die('--pilot fixes its own reps and arms; do not pass --reps/--arms');

function parseReps() {
  const raw = val('--reps');
  if (raw === undefined) return P.reps || 5;
  if (!/^[0-9]+$/.test(String(raw)) || Number(raw) < 1) die('--reps must be a positive integer');
  return Number(raw);
}
function parseArms() {
  const arms = String(val('--arms', 'base,change')).split(',').map((s) => s.trim()).filter(Boolean);
  if (!arms.length) die('--arms must name at least one arm');
  for (const a of arms) if (!['base', 'change'].includes(a)) die(`unknown arm: ${a}`);
  return arms;
}
const cellCost = (task) => (P.cost_per_cell_usd || {})[task] ?? 0.19;
function maxUsd() {
  const raw = process.env.ONOFF_MAX_USD;
  if (raw === undefined || String(raw).trim() === '') return P.max_usd_default || 20;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(String(raw).trim()) || Number(raw) <= 0) die('usage: ONOFF_MAX_USD must be a positive number');
  return Number(raw);
}

// SCOPE OF THIS LINT: it only catches an accidental mention of a FINDINGS file in an arm. It does NOT stop a
// deliberate evasion (letter-spaced "F I N D I N G S", or an indirect reference such as "write the report to the
// filename just mentioned"); text matching cannot judge meaning and the regex is not to be extended further
// (depth-0 ruling, gen 8). The real protection is the post-run check on each paid cell (fbatch/cell.js: a path whose name
// contains "findings" that was not in the cell repo, the scratch HOME or the cell TMPDIR before the agent started, or a
// Write/Edit target that contains it, invalidates the cell); see evals/skill-onoff/README.md.
// Whitelist design: any FINDINGS-file token in an arm is a problem unless its whole clause is an approved sentence.
const FINDINGS_FILE_TOKEN = /(?<![\w.-])[\w.-]*findings[\w.-]*\.[\w-]+|findings\s+(report\s+)?(file|doc|document)s?\b|findings\s+report\b/i;
const norm = (t) => t.replace(/\s+/g, ' ').trim();
const clauseKey = (c) => norm(c).toLowerCase().replace(/^([-*]|\d+[.)])?\s*/, '').replace(/[.\s]+$/, '');
// Split on lines BEFORE whitespace normalisation: a bullet line starts a new clause; a plain line continues the
// previous one (so a sentence wrapped across lines stays whole); a blank line ends it.
function lineClauses(txt) {
  const out = []; let cur = null;
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) { cur = null; continue; }
    if (/^\s*([-*]|\d+[.)])\s+/.test(line) || cur === null) { cur = [line]; out.push(cur); } else cur.push(line);
  }
  return out.map((c) => c.join(' '));
}
const APPROVED_CLAUSES = new Set([
  'Never write a FINDINGS file',
  'Do not create a FINDINGS file',
  'Never ask a Claude subagent to write a FINDINGS file',
  'Depth 0 writes them to the registry (a name that is not a report-shaped FINDINGS file)',
].map(clauseKey));

function checkArms() {
  const problems = [];
  const a = L.loadArms(armsDir);
  const allowed = new Set((P.allowed_arm_difference || {}).files || []);
  const names = new Set([...Object.keys(a.base), ...Object.keys(a.change)]);
  const differing = [];
  for (const f of names) if (a.base[f] !== a.change[f]) differing.push(f);
  for (const f of differing) if (!allowed.has(f)) problems.push(`${f} differs between base and change but is not a registered change`);
  for (const f of allowed) if (!differing.includes(f)) problems.push(`${f} is registered as changed but does not differ`);
  // The late-input rule: no arm may ask a Claude subagent to Write a FINDINGS file.
  for (const arm of ['base', 'change']) {
    for (const [f, txt] of Object.entries(a[arm])) {
      // Collapse newlines/runs of spaces first, so a token or sentence split across lines cannot hide.
      for (const clause of lineClauses(txt).flatMap((c) => norm(c).split(/;|\.(?=\s|$)/))) {
        if (!(FINDINGS_FILE_TOKEN.test(clause) || /\bFINDINGS\b/.test(clause))) continue;
        if (APPROVED_CLAUSES.has(clauseKey(clause))) continue;
        problems.push(`${arm}/${f}: mentions a FINDINGS file outside the approved sentences: ${clause.trim()}`);
      }
    }
  }
  if (!/text/.test(a.change['code-review.md'] || '')) problems.push('change arm must say lanes return findings as text');
  return { ok: problems.length === 0, differing: differing.sort(), problems };
}

if (flag('--check-arms')) {
  let r;
  try { r = checkArms(); } catch (e) { r = { ok: false, problems: [e.message], differing: [] }; }
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 2);
}

const REPS = parseReps();
const ARMS = parseArms();
const GROUPS = PILOT
  ? P.pilot_tasks.map((task) => ({ task, arms: ['base', 'change'], reps: 1 }))
  : P.tasks.map((task) => ({ task, arms: ARMS, reps: REPS }));
const CAP = maxUsd();
// A pilot run reads pilot rows of its own model; the formal run reads only non-pilot rows of the formal model.


function readRows() {
  let text = '';
  try { text = fs.readFileSync(resultsPath, 'utf8'); } catch { /* new file */ }
  const rows = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { /* skip */ } }
  return rows;
}

// Formal-run view: pilot rows and rows from another model are never counted (pilot rates are never reused for V2/V3).
const scoredRows = () => readRows().filter((j) => (PILOT ? j.pilot === true : j.pilot !== true) && j.model === MODEL);

if (flag('--dry-run')) {
  const done = new Set(scoredRows().filter((j) => !j.failure_class).map((j) => `${j.task_id}|${j.arm}|${j.rep}`));
  const keys = [];
  for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
    const key = `${g.task}|${arm}|${rep}`;
    keys.push(key);
    console.log(`${done.has(key) ? 'done' : 'todo'}`.padEnd(9) + ` ${key}`);
  }
  const cost = Number(keys.reduce((s, k) => s + cellCost(k.split('|')[0]), 0).toFixed(2));
  console.log(JSON.stringify({
    dry_run: true, pilot: PILOT, row: P.row, model: MODEL, runner, cells_total: keys.length,
    cells_todo: keys.filter((k) => !done.has(k)).length, cost_estimate_usd: cost,
    cost_basis: 'two-turn T1/T2 cells 0.30, single-turn T3/T4 cells 0.19 (plan §4); the pilot average replaces this',
    max_usd: CAP,
  }));
  if (cost > CAP + 1e-9) die(`spend cap: estimate ${cost.toFixed(2)} USD exceeds ONOFF_MAX_USD ${CAP.toFixed(2)} USD`, 1);
  process.exit(0);
}

// ---- --runner cc ---------------------------------------------------------------------------
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const money = (n) => Number(n.toFixed(2));
const rowCost = (j) => { const v = num(j.cost_usd); return v === null ? cellCost(j.task_id) : v; };
const spentUsd = () => readRows().filter((j) => typeof j.task_id === 'string' && (!j.row || j.row === P.row)).reduce((s, j) => s + rowCost(j), 0);

function runCc() {
  const CC = P.cc || {};
  const stop = (msg, code, dir) => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); die(msg, code); };
  if (typeof CC.invocation_prefix !== 'string' || !CC.invocation_prefix.trim() || !CC.skill) die('prereg.cc.invocation_prefix / cc.skill missing');
  if (cp.spawnSync('bash', ['-c', 'command -v claude'], { stdio: 'ignore' }).status !== 0) die('claude is not on PATH');
  const chk0 = checkArms();
  if (!chk0.ok) die(`--check-arms failed: ${chk0.problems.join('; ')}`);
  const ver = String(cp.spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout || '').split('\n')[0].trim();
  if (!ver) die('claude --version printed nothing; cannot pin the runner', 3);
  // Version pin: with cc.runner_version_pin set, any other `claude --version` first line is REFUSED before the first cell (exit 3);
  // the matrix then also records/checks the version in <results>.runner-pin before every cell (BL-0113, same as bpack).
  if (CC.runner_version_pin && ver !== CC.runner_version_pin) die(`runner version '${ver}' differs from prereg cc.runner_version_pin '${CC.runner_version_pin}'`, 3);
  const foreign = readRows().filter((j) => (j.pilot === true) !== PILOT || j.model !== MODEL);
  if (foreign.length) die(`results file holds ${foreign.length} row(s) of another scope (pilot flag or model); use one results file per pilot and per formal model, the matrix resume key ignores both`);
  const abs = path.resolve(resultsPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const stateOf = () => {
    const ok = new Set(); const fails = new Map();
    for (const j of readRows()) {
      const k = `${j.task_id}|${j.arm}|${j.rep}`;
      if (j.failure_class === null || j.failure_class === undefined) ok.add(k); else fails.set(k, (fails.get(k) || 0) + 1);
    }
    return { ok, fails };
  };
  const todoCost = () => {
    const { ok, fails } = stateOf(); let c = 0;
    for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
      const k = `${g.task}|${arm}|${rep}`;
      if (!ok.has(k) && (fails.get(k) || 0) < 3) c += cellCost(g.task);
    }
    return c;
  };
  const ceilings = CC.cell_ceiling_usd || {};
  for (const g of GROUPS) if (!(typeof ceilings[g.task] === 'number' && ceilings[g.task] > 0)) die(`prereg cc.cell_ceiling_usd.${g.task} missing or not a positive number`);
  const startEstimate = todoCost();
  const spent0 = spentUsd();
  if (spent0 + startEstimate > CAP + 1e-9) die(`spend cap: spent ${money(spent0)} USD + remaining estimate ${money(startEstimate)} USD exceeds ONOFF_MAX_USD ${money(CAP)} USD`, 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbatch-cc-'));
  const bd = B.build({ armsDir, outDir: dir });
  const keep = `${abs}.cells`;
  const minCells = CC.extrapolate_min_cells || 2;
  // A cell's spend is the sum over sessions of the LAST result's total_cost_usd (cumulative per session: adding every result
  // would count a resumed session's earlier spend again) ONLY when every turn that ran ended with a trustworthy one. The runner marks a cell cost_unknown when a turn did not (killed by the timeout, no result event, a missing or
  // non-numeric total_cost_usd); a transcript with no cost at all is the same case. Such a cell is charged its whole
  // ceiling (the most the --max-budget-usd cap lets it spend): never less than what may have been spent.
  const costOfKept = (j) => {
    if (j.cost_unknown !== true) {
      try {
        const c = CELL.transcriptCost(path.join(keep, j.task_id, j.arm, String(j.rep), 'transcript.jsonl'));
        if (c.turns.length) return { cost_usd: c.total, cost_turns: c.turns, cost_sessions: c.sessions };
      } catch { /* no transcript kept */ }
    }
    return { cost_usd: ceilings[j.task_id], cost_unknown: true, cost_estimated: true };
  };
  const patchRows = (before) => {
    const buf = fs.readFileSync(abs);
    const head = buf.subarray(0, before).toString('utf8');
    const tail = buf.subarray(before).toString('utf8').split('\n').filter((l) => l.trim()).map((l) => {
      let j; try { j = JSON.parse(l); } catch { return l; }
      // A cell where the agent wrote a FINDINGS-named file is invalid whatever its markers say (README: post-run check).
      const bad = !j.failure_class && j.markers && j.markers.findings_write === true;
      // markers.sh could not read the cell's evidence (ledger, git state, snapshots): the runner swallows that exit status, so it is an infra row here.
      const refused = !j.failure_class && j.markers && j.markers.cell_error === true;
      return JSON.stringify({ row: P.row, pilot: PILOT, ...j, ...(bad ? { failure_class: 'invalid_cell', failure_cause: 'findings_write' } : {}), ...(refused ? { failure_class: 'infra_fail', failure_cause: 'marker_error' } : {}), ...costOfKept(j) });
    });
    fs.writeFileSync(abs, head + (tail.length ? `${tail.join('\n')}\n` : ''));
  };
  // One matrix call = one cell (--reps N skips the done reps 1..N-1; --arms names the single arm), and the stop-loss
  // is checked, with the real cost of every earlier cell already in the results file, before EVERY cell:
  //   projected = spent + max(this cell's estimate, the largest cell measured so far) must stay <= ONOFF_MAX_USD;
  //   extrapolated = spent + (measured/estimated ratio of the measured cells) x the remaining estimate likewise.
  for (const g of GROUPS) for (let rep = 1; rep <= g.reps; rep++) for (const arm of g.arms) {
    const { ok, fails } = stateOf();
    const key = `${g.task}|${arm}|${rep}`;
    if (ok.has(key) || (fails.get(key) || 0) >= 3) continue;
    const spent = spentUsd();
    const measured = readRows().filter((j) => num(j.cost_usd) !== null && !j.cost_estimated);
    const worst = Math.max(cellCost(g.task), ...measured.map((j) => j.cost_usd));
    if (spent + worst > CAP + 1e-9) stop(`spend cap: spent ${money(spent)} USD so far; next cell ${key} may cost ${money(worst)} USD (its estimate or the largest cell measured so far); cap ${money(CAP)} USD; refusing to dispatch`, 1, dir);
    // Hard cap: a cell whose ceiling does not fit in what is left is not dispatched; one that fits runs under
    // --max-budget-usd min(remaining, ceiling), so its own spend cannot pass the ceiling.
    const remaining = CAP - spent;
    const ceiling = ceilings[g.task];
    if (remaining + 1e-9 < ceiling) stop(`spend cap: ${money(remaining)} USD left of ONOFF_MAX_USD ${money(CAP)} USD is below the ${money(ceiling)} USD cell ceiling of ${key}; refusing to dispatch`, 1, dir);
    const budget = Number(Math.min(remaining, ceiling).toFixed(4));
    if (measured.length >= minCells) {
      const est = measured.reduce((s, j) => s + cellCost(j.task_id), 0);
      const act = measured.reduce((s, j) => s + j.cost_usd, 0);
      const scale = est > 0 ? act / est : 1;
      const projected = spent + scale * todoCost();
      if (projected > CAP + 1e-9) stop(`spend extrapolation: spent ${money(spent)} USD; ${measured.length} measured cells cost ${scale.toFixed(2)}x their estimate; projected total ${money(projected)} USD exceeds ONOFF_MAX_USD ${money(CAP)} USD; refusing to dispatch ${key}`, 1, dir);
    }
    console.log(`== cell ${key} (budget ${budget} USD)`);
    const before = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    const r = cp.spawnSync('bash', [path.join(HERE, 'run-skill-onoff-matrix-fbatch.sh'),
      '--model', MODEL, '--reps', String(rep), '--results', abs, '--tasks', g.task, '--arms', arm,
      '--runner', 'cc', '--arm-manifests', bd.armManifestsDir, '--check-skill', CC.skill], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ONOFF_PROMPT_PREFIX: CC.invocation_prefix,
        ONOFF_TIMEOUT: CC.timeout || '10m', // the prereg value only: an env override would silently change the cells
        ONOFF_PACKS_DIR: bd.packsDir,
        ONOFF_TASKS_DIR: bd.tasksDir,
        ONOFF_KEEP_CELLS_DIR: keep,
        ONOFF_MAX_BUDGET_USD: String(budget),
        ONOFF_SINGLE_REP: '1', // the matrix runs exactly this cell: no hidden retry of an earlier rep outside the budget check above
        ONOFF_CELL_TMPDIR: '1',
      },
    });
    patchRows(before);
    if (r.status !== 0) stop(`matrix failed for ${key} (exit ${r.status})`, [3, 4].includes(r.status) ? r.status : 2, dir);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ runner: 'cc', pilot: PILOT, model: MODEL, spent_usd: money(spentUsd()), max_usd: CAP }));
  if (PILOT) { console.log('pilot done: cc cells, not scored (a partial grid cannot PASS; pilot rates check wiring only).'); process.exit(0); }
  const s = cp.spawnSync('node', [path.join(HERE, 'score-fbatch.js'), '--prereg', preregPath, '--results', abs, '--arms-dir', armsDir, '--model', MODEL, '--reps', String(REPS)], { encoding: 'utf8' });
  process.stderr.write(s.stderr || '');
  process.stdout.write(s.stdout || '');
  process.exit(s.status === null ? 2 : s.status);
}
if (runner === 'cc') runCc();
const chk = checkArms();
if (!chk.ok) die(`--check-arms failed: ${chk.problems.join('; ')}`);
const arms = L.loadArms(armsDir);
fs.mkdirSync(path.dirname(path.resolve(resultsPath)), { recursive: true });
const have = new Set(scoredRows().filter((j) => !j.failure_class).map((j) => `${j.task_id}|${j.arm}|${j.rep}`));
for (const g of GROUPS) for (const arm of g.arms) for (let rep = 1; rep <= g.reps; rep++) {
  if (have.has(`${g.task}|${arm}|${rep}`)) continue;
  const { markers } = L.stubCell(g.task, arm, L.armText(arms[arm]));
  fs.appendFileSync(resultsPath, `${JSON.stringify({ row: P.row, pilot: PILOT, model: MODEL, task_id: g.task, arm, rep, runner: 'stub', failure_class: null, skill_invoked: true, cost_usd: 0, markers })}\n`);
}
if (PILOT) { console.log('pilot done: stub cells, not scored (a partial grid cannot PASS).'); process.exit(0); }
const controls = L.negativeControls(arms);
const v = L.verdict(scoredRows(), controls, REPS, P.row);
console.log(JSON.stringify({ controls, ...v }));
process.exit(v.verdict === 'PASS' ? 0 : 1);
