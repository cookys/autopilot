#!/usr/bin/env node
'use strict';
// check-cell.js -- the machine check for one cell. No model call, Node built-ins only.
//   check-cell.js --role <role> --task-dir <tasks/role/id> --answer <answer.json> [--workdir <dir>]
// Prints one JSON line {role, task, pass, score, parse_ok, detail} and exits:
//   0 pass . 1 the model's miss (wrong, malformed or incomplete answer) . 2 infra (instrument problem).
// Exit 2 covers EVERY failure that is not about the answer: a task file or a pinned dependency that cannot be read or
// loaded or whose digest differs, an unusable workdir, an oracle that cannot run, and any exception the grader did not
// classify. A grader fault is never scored as a miss. The scoring rules per role are in README.md "Machine checks".
//
// Executable dependencies (the va generator, grader and corpus) live in checks/vendor/va/, inside the frozen set, and
// are loaded only after their sha256 matches the pin below; there is no option to load them from anywhere else.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const VA_PINS = Object.freeze({
  'va-capability-evidence-corpus.json': '85ede154ce11f89ceca3af3c9f895c9fa94e7bc0a84ffd8dc0da391535ccd9b8',
  'va-eval-generator.js': 'c37cd9fced8d4da2a1eb06cf5ea220dbf7b0aa02f89c8c5ff1de86c0f39c6a35',
  'va-eval-grader.js': 'dedaea5cf11072b2e6f40490c3e02ec88e80ba756d44c2e5d1ca5891337128a3',
});

const infra = (m) => Object.assign(new Error(m), { infra: true });
const io = (what, fn) => { try { return fn(); } catch (e) { if (e.infra) throw e; throw infra(`${what}: ${e.message}`); } };
const readJson = (f) => io(`read ${path.basename(f)}`, () => JSON.parse(fs.readFileSync(f, 'utf8')));
const readText = (f) => io(`read ${path.basename(f)}`, () => fs.readFileSync(f, 'utf8'));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const nonEmptyStr = (x) => typeof x === 'string' && x.trim() !== '';
const nonEmpty = (x) => nonEmptyStr(x) || (Array.isArray(x) && x.length > 0);
const res = (pass, score, detail) => ({ pass: !!pass, score, detail });
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function loadVa() {
  const dir = path.join(__dirname, 'vendor', 'va');
  for (const [f, pin] of Object.entries(VA_PINS)) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) throw infra(`vendored dependency missing: checks/vendor/va/${f}`);
    if (sha256(fs.readFileSync(p)) !== pin) throw infra(`vendored dependency changed: checks/vendor/va/${f} does not match its pinned sha256`);
  }
  return { gen: require(path.join(dir, 'va-eval-generator.js')), grader: require(path.join(dir, 'va-eval-grader.js')) };
}

// ---- reviewer
function changedLines(diffText) { // file -> new-side positions of added lines and of deletions (the line after the removal)
  const out = {}; let file = null; let oldRem = 0; let newRem = 0; let n = 0;
  for (const line of diffText.split('\n')) {
    if (oldRem <= 0 && newRem <= 0) {
      let m = /^\+\+\+ b\/(.+)$/.exec(line);
      if (m) { file = m[1]; out[file] = out[file] || []; continue; }
      m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (m && file) { oldRem = m[1] === undefined ? 1 : +m[1]; n = +m[2]; newRem = m[3] === undefined ? 1 : +m[3]; }
      continue;
    }
    if (line.startsWith('\\')) continue;
    if (line.startsWith('+')) { out[file].push(n); n += 1; newRem -= 1; }
    else if (line.startsWith('-')) { out[file].push(n); oldRem -= 1; }
    else { n += 1; oldRem -= 1; newRem -= 1; }
  }
  return out;
}
function groupsMatch(groups, text) { // every group needs at least one of its patterns to match
  return groups.every((g) => g.some((re) => new RegExp(re, 'i').test(text)));
}
function checkReviewer(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  if (!Array.isArray(exp.groups) || exp.groups.length < 2) throw infra('expected.json has no groups');
  const changed = changedLines(readText(path.join(taskDir, 'input/change.diff')));
  if (!Array.isArray(ans.findings) || typeof ans.verdict !== 'string') return res(false, 0, 'shape: verdict or findings missing');
  const slack = exp.line_slack === undefined ? 1 : exp.line_slack;
  const must = ans.findings.filter((f) => isObj(f) && /^(critical|major)$/i.test(String(f.severity)));
  const cites = (f) => Number.isInteger(f.line) && (changed[f.file] || []).some((p) => Math.abs(f.line - p) <= slack);
  const hits = must.filter((f) => cites(f) && groupsMatch(exp.groups, String(f.claim || '')));
  const fix = /FIX|BLOCK|REJECT/i.test(ans.verdict) && !/SHIP-AS-IS/i.test(ans.verdict);
  const caught = fix && hits.length > 0;
  return res(caught, caught ? 1 : 0, `caught=${caught} false_must_fix=${must.length - hits.length} matched=${hits.length}/${must.length}`);
}

// ---- implementer: the frozen oracle, run from the harness copy, against a workdir whose base and protected files are pinned
const gitBlob = (buf) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');
function walkFiles(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkFiles(path.join(dir, e.name), path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
}
function checkImplementer(ans, taskDir, workdir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const inputDir = path.join(taskDir, 'input');
  const oracle = path.join(taskDir, 'oracle.sh');
  if (!fs.existsSync(oracle) || !fs.existsSync(inputDir)) throw infra('task oracle.sh or input/ missing');
  if (!workdir || !fs.existsSync(workdir)) throw infra('implementer check needs --workdir');
  const reasons = [];
  if (!fs.existsSync(path.join(workdir, '.git'))) return res(false, 0, 'history destroyed: no .git in the workdir');
  const git = (...a) => { const r = cp.spawnSync('git', ['-C', workdir, ...a], { encoding: 'utf8' }); if (r.status !== 0) throw infra(`git ${a[0]} failed in workdir: ${r.stderr.trim()}`); return r.stdout; };
  const root = git('rev-list', '--max-parents=0', 'HEAD').split('\n').filter(Boolean)[0];
  if (!root) throw infra('workdir has no root commit');
  // the base commit must be exactly the frozen input (the oracles diff against the first commit)
  const want = Object.fromEntries(walkFiles(inputDir).map((f) => [f, gitBlob(fs.readFileSync(path.join(inputDir, f)))]));
  const have = Object.fromEntries(git('ls-tree', '-r', root).split('\n').filter(Boolean).map((l) => { const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(l); return m ? [m[2], m[1]] : [l, '?']; }));
  const baseDiff = [...new Set([...Object.keys(want), ...Object.keys(have)])].filter((k) => want[k] !== have[k]);
  if (baseDiff.length) reasons.push(`base commit is not the frozen input (${baseDiff.slice(0, 3).join(', ')})`);
  // protected paths compare against the frozen input bytes, committed or not
  const touched = [];
  for (const p of exp.protected) {
    if (p === '.git') continue;
    const abs = path.join(workdir, p); const frozen = path.join(inputDir, p);
    if (fs.existsSync(frozen)) { if (!fs.existsSync(abs) || !fs.readFileSync(abs).equals(fs.readFileSync(frozen))) touched.push(p); }
    else if (fs.existsSync(abs)) touched.push(p);
  }
  if (touched.length) reasons.push(`protected path changed: ${touched.join(', ')}`);
  const shapeOk = isObj(ans) && typeof ans.status === 'string' && Array.isArray(ans.files_changed)
    && isObj(ans.red_evidence) && isObj(ans.green_evidence)
    && Number.isInteger(ans.red_evidence.exit_code) && ans.red_evidence.exit_code !== 0
    && Number.isInteger(ans.green_evidence.exit_code) && ans.green_evidence.exit_code === 0
    && nonEmpty(ans.red_evidence.command) && nonEmpty(ans.green_evidence.command);
  if (!shapeOk) reasons.push('report shape or red/green evidence invalid');
  const r = cp.spawnSync('bash', [oracle], { cwd: workdir, encoding: 'utf8', timeout: 120000 });
  if (r.error) throw infra(`oracle could not run: ${r.error.message}`);
  if (r.status !== 0) reasons.push(`oracle rc=${r.status}`);
  return res(reasons.length === 0, reasons.length === 0 ? 1 : 0, reasons.length ? reasons.join('; ') : 'ok');
}

// ---- verifier: regenerate the frozen va case from its seed and grade the plan with the pinned va grader
function checkVerifier(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const { gen, grader } = loadVa();
  const c = io('regenerate va case', () => gen.generateAdministration(exp.seed).trials[exp.trial].cases.find((x) => x.case_id === exp.case_id));
  if (!c || sha256(Buffer.from(c.envelope)) !== exp.envelope_sha256) throw infra('verifier case drifted from the frozen envelope');
  const g = grader.gradeCase(c, ans);
  if (g.outcome === 'infra_fail' || g.outcome === 'transport_fail') throw infra(`grader abort ${g.outcome}: ${g.detail}`);
  return res(g.outcome === 'pass', g.outcome === 'pass' ? 1 : 0, `va_outcome=${g.outcome}${g.detail ? `:${g.detail}` : ''}`);
}

// ---- planner
function normScope(p) { // normalised repo-relative path, or null when it is not a string, is absolute or leaves the repo
  if (typeof p !== 'string' || p.trim() === '') return null;
  const s = path.posix.normalize(p.trim().replace(/\\/g, '/'));
  if (s.startsWith('/') || s === '..' || s.startsWith('../')) return null;
  return s === '.' ? '' : s;
}
const scopeBase = (s) => (s.includes('*') ? s.slice(0, s.indexOf('*')).replace(/[^/]*$/, '') : s);
const segPrefix = (x, y) => x === '' || y === x || y.startsWith(x.endsWith('/') ? x : `${x}/`);
const scopesOverlap = (a, b) => segPrefix(scopeBase(a), scopeBase(b)) || segPrefix(scopeBase(b), scopeBase(a));
function checkPlanner(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const repoDir = path.join(taskDir, 'input');
  if (!fs.existsSync(repoDir)) throw infra('planner input/ missing');
  const errs = [];
  const sts = Array.isArray(ans.subtasks) ? ans.subtasks.filter(isObj) : [];
  if (!Array.isArray(ans.subtasks) || sts.length !== ans.subtasks.length) errs.push('subtasks must be objects');
  if (sts.length < exp.min_subtasks) errs.push(`subtasks<${exp.min_subtasks}`);
  if (!Array.isArray(ans.risks) || ans.risks.length === 0 || !ans.risks.every((r) => isObj(r) && nonEmptyStr(r.risk) && /^(mitigated|accepted|deferred)$/.test(String(r.disposition)))) errs.push('risks: each needs risk + disposition mitigated|accepted|deferred');
  const ids = new Set(); const scopes = new Map();
  for (const s of sts) {
    if (!nonEmptyStr(s.id) || ids.has(s.id)) { errs.push('subtask id missing or duplicate'); continue; }
    ids.add(s.id);
    for (const k of ['goal', 'scope', 'input', 'output', 'acceptance', 'boundaries']) if (!nonEmpty(s[k])) errs.push(`${s.id}: ${k} empty`);
    const acc = Array.isArray(s.acceptance) ? s.acceptance : [];
    if (!acc.some((a) => typeof a === 'string' && exp.acceptance_command_heads.includes(a.trim().split(/\s+/)[0]))) errs.push(`${s.id}: no runnable acceptance command`);
    const norm = [];
    for (const p of Array.isArray(s.scope) ? s.scope : []) {
      const n = normScope(p);
      if (n === null) { errs.push(`${s.id}: scope ${JSON.stringify(p)} is not a repo-relative path`); continue; }
      const base = scopeBase(n).replace(/\/$/, '');
      if (!fs.existsSync(path.join(repoDir, base)) && !fs.existsSync(path.join(repoDir, path.posix.dirname(base)))) errs.push(`${s.id}: scope ${p} not under the repo`);
      norm.push(n);
    }
    scopes.set(s.id, norm);
  }
  const deps = new Map(sts.map((s) => [s.id, Array.isArray(s.depends_on) ? s.depends_on : []]));
  for (const [id, ds] of deps) for (const d of ds) if (!ids.has(d)) errs.push(`${id}: depends_on unknown ${JSON.stringify(d)}`);
  const reach = (from, to, seen = new Set()) => { if (from === to) return true; if (seen.has(from)) return false; seen.add(from); return (deps.get(from) || []).some((d) => reach(d, to, seen)); };
  const ordered = (a, b) => reach(a, b) || reach(b, a);
  const idl = [...ids];
  for (let i = 0; i < idl.length; i += 1) for (let j = i + 1; j < idl.length; j += 1) {
    const [a, b] = [idl[i], idl[j]];
    if (ordered(a, b)) continue;
    if ((scopes.get(a) || []).some((x) => (scopes.get(b) || []).some((y) => scopesOverlap(x, y)))) errs.push(`${a}/${b}: parallel subtasks share scope`);
  }
  const all = [...scopes.values()].flat().map(scopeBase);
  for (const need of exp.must_cover) if (!all.some((p) => p !== '' && (p.startsWith(need) || need.startsWith(p)))) errs.push(`uncovered: ${need}`);
  if (exp.require_dependency && ![...deps.values()].some((d) => d.length > 0)) errs.push('no dependency edge between stages');
  const state = {};
  const cyc = (id) => { if (state[id] === 1) return true; if (state[id] === 2) return false; state[id] = 1; for (const d of deps.get(id) || []) if (deps.has(d) && cyc(d)) return true; state[id] = 2; return false; };
  if (idl.some(cyc)) errs.push('dependency cycle');
  return res(errs.length === 0, errs.length === 0 ? 1 : 0, errs.length ? errs.join('; ') : 'ok');
}

// ---- debugger
function checkDebugger(ans, taskDir, workdir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const rc = isObj(ans.root_cause) ? ans.root_cause : {};
  const hyp = Array.isArray(ans.hypotheses) ? ans.hypotheses : [];
  const ev = Array.isArray(ans.evidence) ? ans.evidence : [];
  const evOk = ev.length > 0 && ev.every((e) => isObj(e) && nonEmptyStr(e.cmd) && nonEmptyStr(e.observation));
  const decided = hyp.filter((h) => isObj(h) && nonEmptyStr(h.claim) && /^(confirmed|refuted)$/.test(String(h.status)));
  const refsOk = decided.every((h) => Number.isInteger(h.evidence_ref) && h.evidence_ref >= 0 && h.evidence_ref < ev.length);
  const fileOk = typeof rc.file === 'string' && rc.file.replace(/^\.?\//, '') === exp.root_cause_file;
  const lineOk = Number.isInteger(rc.line) && rc.line >= exp.line_min && rc.line <= exp.line_max;
  const claimOk = new RegExp(exp.claim_regex, 'i').test(String(rc.claim || ''));
  const hypOk = decided.length >= exp.min_hypotheses && decided.some((h) => h.status === 'confirmed') && refsOk && evOk;
  let clean = true;
  if (workdir) {
    const r = cp.spawnSync('git', ['-C', workdir, 'status', '--porcelain'], { encoding: 'utf8' });
    if (r.status !== 0) throw infra(`git status failed: ${r.stderr.trim()}`);
    clean = r.stdout.trim() === '';
  }
  const pass = fileOk && lineOk && claimOk && hypOk && clean;
  return res(pass, pass ? 1 : 0, `file=${fileOk} line=${lineOk} claim=${claimOk} hyp=${hypOk} repo_clean=${clean} decoy_blamed=${!!(exp.decoy_file && rc.file === exp.decoy_file)}`);
}

// ---- explorer
function checkExplorer(ans, taskDir) {
  const exp = readJson(path.join(taskDir, 'expected.json'));
  const repoDir = path.join(taskDir, 'input');
  if (!fs.existsSync(repoDir)) throw infra('explorer input/ missing');
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
      return typeof text === 'string' && c.file === q.file && new RegExp(q.needle).test(text) && nonEmptyStr(c.quote) && text.includes(String(c.quote).trim());
    });
    if (good) ok += 1; else notes.push(`${q.id}: no valid citation`);
  }
  return res(ok === exp.questions.length, ok / exp.questions.length, notes.length ? notes.join('; ') : 'ok');
}

const ROLE_FNS = { reviewer: checkReviewer, implementer: checkImplementer, verifier: checkVerifier, planner: checkPlanner, debugger: checkDebugger, explorer: checkExplorer };

// Grade one answer object. Throws an Error with .infra = true for instrument problems; any other exception is wrapped as infra.
function grade(role, ans, taskDir, workdir) {
  try { return ROLE_FNS[role](ans, path.resolve(taskDir), workdir); } catch (e) { if (e.infra) throw e; throw infra(`unclassified grader error: ${e.message}`); }
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const role = opt('--role'); const taskDir = opt('--task-dir'); const answer = opt('--answer');
  const out = (o, rc) => { process.stdout.write(`${JSON.stringify({ role, task: taskDir && path.basename(taskDir), ...o })}\n`); process.exit(rc); };
  if (!role || !taskDir || !answer) { console.error('usage: check-cell.js --role R --task-dir D --answer A.json [--workdir W]'); process.exit(2); }
  if (!ROLE_FNS[role]) { console.error(`unknown role ${role}`); process.exit(2); }
  if (!fs.existsSync(answer)) out({ pass: false, score: 0, parse_ok: false, detail: 'infra: answer file missing' }, 2);
  let ans;
  try { ans = JSON.parse(fs.readFileSync(answer, 'utf8')); } catch (e) { out({ pass: false, score: 0, parse_ok: false, detail: `answer is not JSON: ${e.message}` }, 1); }
  if (!isObj(ans)) out({ pass: false, score: 0, parse_ok: false, detail: 'answer is not a JSON object' }, 1);
  try { const r = grade(role, ans, taskDir, opt('--workdir')); out({ ...r, parse_ok: true }, r.pass ? 0 : 1); } catch (e) { out({ pass: false, score: 0, parse_ok: true, detail: `infra: ${e.message}` }, 2); }
}
if (require.main === module) main();
module.exports = { grade, changedLines, groupsMatch, normScope, scopesOverlap, VA_PINS };
