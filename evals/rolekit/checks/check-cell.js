#!/usr/bin/env node
'use strict';
// check-cell.js -- the machine check for one cell. No model call, Node built-ins only.
//   check-cell.js --role <role> --task-dir <tasks/role/id> --answer <answer.json> [--workdir <dir>] [--evals-dir <dir>]
// Prints one JSON line {role, task, pass, score, parse_ok, detail} and exits 0 (pass) / 1 (fail) / 2 (usage or infra).
// A cell fails (exit 1) when the answer is wrong, malformed or missing a key: that is the model's miss.
// Exit 2 is reserved for instrument problems (missing task files, unreadable answer path, oracle cannot run): the runner
// records those as infra, never as a miss. The scoring rules per role are in README.md "Machine checks".
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonEmpty = (x) => (typeof x === 'string' && x.trim() !== '') || (Array.isArray(x) && x.length > 0);
const res = (pass, score, detail) => ({ pass: !!pass, score, detail });

// ---- reviewer: caught = FIX verdict + a critical/major finding that matches the case predicate and cites a real diff line
function diffLines(diffText) { // file -> [[start,end]] new-side hunk ranges
  const out = {}; let file = null;
  for (const line of diffText.split('\n')) {
    let m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m) { file = m[1]; out[file] = out[file] || []; continue; }
    m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m && file) { const s = +m[1]; const n = m[2] === undefined ? 1 : +m[2]; out[file].push([s, s + Math.max(n, 1) - 1]); }
  }
  return out;
}
function predicateMatches(pred, text) {
  const low = text.toLowerCase();
  return pred.any_of.some((g) => (g.all_of ? g.all_of.every((t) => low.includes(String(t).toLowerCase())) : g.regex ? new RegExp(g.regex, 'i').test(text) : false));
}
function checkReviewer(ans, taskDir) {
  const pred = readJson(path.join(taskDir, 'expected.json'));
  const ranges = diffLines(fs.readFileSync(path.join(taskDir, 'input/change.diff'), 'utf8'));
  if (!Array.isArray(ans.findings) || typeof ans.verdict !== 'string') return res(false, 0, 'shape: verdict or findings missing');
  const must = ans.findings.filter((f) => isObj(f) && /^(critical|major)$/i.test(String(f.severity)));
  const cites = (f) => (ranges[f.file] || []).some(([a, b]) => Number.isInteger(f.line) && f.line >= a && f.line <= b);
  const valid = must.filter(cites);
  const falseMust = must.length - valid.filter((f) => predicateMatches(pred, String(f.claim || ''))).length;
  const fix = /FIX|BLOCK|REJECT/i.test(ans.verdict) && !/SHIP-AS-IS/i.test(ans.verdict);
  const caught = fix && valid.some((f) => predicateMatches(pred, String(f.claim || '')));
  return res(caught, caught ? 1 : 0, `caught=${caught} false_must_fix=${falseMust} cited_ok=${valid.length}/${must.length}`);
}

// ---- implementer: the task's own oracle in the workdir + report shape + red/green evidence + no protected path touched
function checkImplementer(ans, taskDir, workdir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  if (!workdir || !fs.existsSync(workdir)) { const e = new Error('implementer check needs --workdir'); e.infra = true; throw e; }
  const shapeOk = isObj(ans) && typeof ans.status === 'string' && Array.isArray(ans.files_changed)
    && isObj(ans.red_evidence) && isObj(ans.green_evidence)
    && Number.isInteger(ans.red_evidence.exit_code) && ans.red_evidence.exit_code !== 0
    && Number.isInteger(ans.green_evidence.exit_code) && ans.green_evidence.exit_code === 0
    && nonEmpty(ans.red_evidence.command) && nonEmpty(ans.green_evidence.command);
  let changed;
  try { changed = cp.execFileSync('git', ['-C', workdir, 'status', '--porcelain'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3).trim().replace(/^"|"$/g, '')); }
  catch (e) { const er = new Error(`git status failed in workdir: ${e.message}`); er.infra = true; throw er; }
  const touchedProtected = changed.filter((c) => exp.protected.some((p) => c === p || c.startsWith(`${p}/`)));
  const oracle = path.join(workdir, 'oracle.sh');
  if (!fs.existsSync(oracle)) fs.copyFileSync(path.join(taskDir, 'oracle.sh'), oracle);
  const r = cp.spawnSync(exp.oracle[0], exp.oracle.slice(1), { cwd: workdir, encoding: 'utf8', timeout: 120000 });
  if (r.error) { const er = new Error(`oracle could not run: ${r.error.message}`); er.infra = true; throw er; }
  fs.rmSync(oracle, { force: true }); // the oracle copy is the harness's, not the candidate's
  const pass = r.status === 0 && shapeOk && touchedProtected.length === 0;
  return res(pass, pass ? 1 : 0, `oracle_rc=${r.status} shape_ok=${shapeOk} protected_touched=${JSON.stringify(touchedProtected)}`);
}

// ---- verifier: regenerate the frozen va case from its seed and grade the plan with the va grader (twin execution)
function checkVerifier(ans, taskDir, evalsDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const gen = require(path.join(evalsDir, 'va-eval-generator.js'));
  const grader = require(path.join(evalsDir, 'va-eval-grader.js'));
  const admin = gen.generateAdministration(exp.seed);
  const c = admin.trials[exp.trial].cases.find((x) => x.case_id === exp.case_id);
  const crypto = require('crypto');
  if (!c || crypto.createHash('sha256').update(c.envelope).digest('hex') !== exp.envelope_sha256) { const e = new Error('verifier case drifted from the frozen envelope'); e.infra = true; throw e; }
  const g = grader.gradeCase(c, ans);
  if (g.outcome === 'infra_fail' || g.outcome === 'transport_fail') { const e = new Error(`grader abort ${g.outcome}: ${g.detail}`); e.infra = true; throw e; }
  return res(g.outcome === 'pass', g.outcome === 'pass' ? 1 : 0, `va_outcome=${g.outcome}${g.detail ? `:${g.detail}` : ''}`);
}

// ---- planner: six elements, runnable acceptance, scope exists, parallel-safe scopes, coverage, dependency order
function globPrefix(s) { return String(s).replace(/\*.*$/, ''); }
function checkPlanner(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const repoDir = path.join(taskDir, 'input');
  const errs = [];
  const sts = Array.isArray(ans.subtasks) ? ans.subtasks : [];
  if (sts.length < exp.min_subtasks) errs.push(`subtasks<${exp.min_subtasks}`);
  if (!Array.isArray(ans.risks) || ans.risks.length === 0 || !ans.risks.every((r) => isObj(r) && nonEmpty(r.risk) && /^(mitigated|accepted|deferred)$/.test(String(r.disposition)))) errs.push('risks: each needs risk + disposition mitigated|accepted|deferred');
  const ids = new Set();
  for (const s of sts) {
    if (!isObj(s) || !nonEmpty(s.id) || ids.has(s.id)) { errs.push('subtask id missing or duplicate'); continue; }
    ids.add(s.id);
    for (const k of ['goal', 'scope', 'input', 'output', 'acceptance', 'boundaries']) if (!nonEmpty(s[k])) errs.push(`${s.id}: ${k} empty`);
    const acc = Array.isArray(s.acceptance) ? s.acceptance : [];
    if (!acc.some((a) => exp.acceptance_command_heads.includes(String(a).trim().split(/\s+/)[0]))) errs.push(`${s.id}: no runnable acceptance command`);
    for (const p of Array.isArray(s.scope) ? s.scope : []) {
      const rel = globPrefix(p).replace(/\/$/, '') || '.';
      if (!fs.existsSync(path.join(repoDir, rel)) && !fs.existsSync(path.join(repoDir, path.dirname(rel)))) errs.push(`${s.id}: scope ${p} not under the repo`);
    }
  }
  const dep = (a, b) => (a.depends_on || []).includes(b.id) || (b.depends_on || []).includes(a.id);
  for (const s of sts) for (const d of s.depends_on || []) if (!ids.has(d)) errs.push(`${s.id}: depends_on unknown ${d}`);
  for (let i = 0; i < sts.length; i += 1) for (let j = i + 1; j < sts.length; j += 1) {
    const a = sts[i]; const b = sts[j];
    if (!isObj(a) || !isObj(b) || dep(a, b)) continue;
    const overlap = (a.scope || []).some((x) => (b.scope || []).some((y) => globPrefix(x).startsWith(globPrefix(y)) || globPrefix(y).startsWith(globPrefix(x))));
    if (overlap) errs.push(`${a.id}/${b.id}: parallel subtasks share scope`);
  }
  const scopes = sts.flatMap((s) => (Array.isArray(s.scope) ? s.scope : [])).map(String);
  for (const need of exp.must_cover) if (!scopes.some((p) => globPrefix(p).startsWith(need) || need.startsWith(globPrefix(p)) && globPrefix(p) !== '')) errs.push(`uncovered: ${need}`);
  if (exp.require_dependency && !sts.some((s) => (s.depends_on || []).length > 0)) errs.push('no dependency edge between stages');
  // acyclic
  const state = {}; const byId = Object.fromEntries(sts.filter(isObj).map((s) => [s.id, s]));
  const cyc = (id) => { if (state[id] === 1) return true; if (state[id] === 2) return false; state[id] = 1; for (const d of (byId[id] && byId[id].depends_on) || []) if (byId[d] && cyc(d)) return true; state[id] = 2; return false; };
  if (Object.keys(byId).some(cyc)) errs.push('dependency cycle');
  return res(errs.length === 0, errs.length === 0 ? 1 : 0, errs.length ? errs.join('; ') : 'ok');
}

// ---- debugger: root cause file + line window + claim wording; >=2 hypotheses with evidence; the repo untouched
function checkDebugger(ans, taskDir, workdir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const rc = isObj(ans.root_cause) ? ans.root_cause : {};
  const hyp = Array.isArray(ans.hypotheses) ? ans.hypotheses : [];
  const fileOk = typeof rc.file === 'string' && rc.file.replace(/^\.?\//, '') === exp.root_cause_file;
  const lineOk = Number.isInteger(rc.line) && rc.line >= exp.line_min && rc.line <= exp.line_max;
  const claimOk = new RegExp(exp.claim_regex, 'i').test(String(rc.claim || ''));
  const hypOk = hyp.length >= exp.min_hypotheses && hyp.every((h) => isObj(h) && nonEmpty(h.claim) && /^(confirmed|refuted|open)$/.test(String(h.status))) && hyp.some((h) => h.status === 'confirmed') && Array.isArray(ans.evidence) && ans.evidence.length > 0;
  let clean = true;
  if (workdir) { try { clean = cp.execFileSync('git', ['-C', workdir, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === ''; } catch (e) { const er = new Error(`git status failed: ${e.message}`); er.infra = true; throw er; } }
  const decoyPick = exp.decoy_file && rc.file === exp.decoy_file;
  const pass = fileOk && lineOk && claimOk && hypOk && clean;
  return res(pass, pass ? 1 : 0, `file=${fileOk} line=${lineOk} claim=${claimOk} hyp=${hypOk} repo_clean=${clean} decoy_blamed=${!!decoyPick}`);
}

// ---- explorer: every answer found/absent as expected; every citation is a real line holding the quoted text
function checkExplorer(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const repoDir = path.join(taskDir, 'input');
  const got = Array.isArray(ans.answers) ? ans.answers : [];
  let ok = 0; const notes = [];
  for (const q of exp.questions) {
    const a = got.find((x) => isObj(x) && x.q === q.id);
    if (!a || a.found !== q.expect_found) { notes.push(`${q.id}: found mismatch`); continue; }
    const cites = Array.isArray(a.citations) ? a.citations : [];
    if (!q.expect_found) { if (cites.length === 0) ok += 1; else notes.push(`${q.id}: citations on an absent thing`); continue; }
    const good = cites.some((c) => {
      if (!isObj(c) || typeof c.file !== 'string' || !Number.isInteger(c.line)) return false;
      const p = path.join(repoDir, c.file);
      if (!p.startsWith(`${repoDir}${path.sep}`) || !fs.existsSync(p)) return false;
      const text = fs.readFileSync(p, 'utf8').split('\n')[c.line - 1];
      return typeof text === 'string' && c.file === q.file && new RegExp(q.needle).test(text) && String(c.quote || '').trim() !== '' && text.includes(String(c.quote).trim());
    });
    if (good) ok += 1; else notes.push(`${q.id}: no valid citation`);
  }
  const score = ok / exp.questions.length;
  return res(ok === exp.questions.length, score, notes.length ? notes.join('; ') : 'ok');
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const role = opt('--role'); const taskDir = opt('--task-dir'); const answer = opt('--answer');
  const out = (o, rc) => { process.stdout.write(`${JSON.stringify({ role, task: taskDir && path.basename(taskDir), ...o })}\n`); process.exit(rc); };
  if (!role || !taskDir || !answer) { console.error('usage: check-cell.js --role R --task-dir D --answer A.json [--workdir W] [--evals-dir E]'); process.exit(2); }
  let ans;
  try { ans = readJson(answer); } catch (e) {
    if (!fs.existsSync(answer)) out({ pass: false, score: 0, parse_ok: false, detail: 'infra: answer file missing' }, 2);
    out({ pass: false, score: 0, parse_ok: false, detail: `answer is not JSON: ${e.message}` }, 1);
  }
  if (!isObj(ans)) out({ pass: false, score: 0, parse_ok: false, detail: 'answer is not a JSON object' }, 1);
  const fns = { reviewer: checkReviewer, implementer: checkImplementer, verifier: checkVerifier, planner: checkPlanner, debugger: checkDebugger, explorer: checkExplorer };
  if (!fns[role]) { console.error(`unknown role ${role}`); process.exit(2); }
  try {
    const extra = role === 'verifier' ? (opt('--evals-dir') || path.join(__dirname, '..', '..')) : opt('--workdir');
    const r = fns[role](ans, path.resolve(taskDir), extra);
    out({ ...r, parse_ok: true }, r.pass ? 0 : 1);
  } catch (e) {
    if (e.infra) out({ pass: false, score: 0, parse_ok: true, detail: `infra: ${e.message}` }, 2);
    throw e;
  }
}
if (require.main === module) main();
module.exports = { checkReviewer, checkImplementer, checkVerifier, checkPlanner, checkDebugger, checkExplorer, diffLines, predicateMatches };
