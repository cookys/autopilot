#!/usr/bin/env node
'use strict';
// build-tasks.js -- (re)build the frozen pilot task set under evals/rolekit/tasks/ from existing eval assets.
//   build-tasks.js --repo <autopilot checkout> --base <sha> [--out <tasks dir>] [--check]
// Copies the source files into tasks/<role>/<id>/, writes prompt.md + expected.json per task, and writes
// tasks/manifest.json with, per task: source path, git blob/tree sha at --base, sha256 of every frozen file.
// --check rebuilds in memory and fails (exit 2) if anything under --out differs from manifest.json. No model call.
// Node built-ins only (git is called for blob shas). See README.md "Task set".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const repo = path.resolve(opt('--repo', path.join(__dirname, '..', '..')));
const base = opt('--base');
const out = path.resolve(opt('--out', path.join(__dirname, 'tasks')));
const check = argv.includes('--check');
const die = (m) => { console.error(`build-tasks: ${m}`); process.exit(2); };
if (!base || !/^[0-9a-f]{40}$/.test(base)) die('usage: build-tasks.js --repo <dir> --base <40-hex sha> [--out dir] [--check]');

const git = (...a) => cp.execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const objSha = (rel) => git('rev-parse', `${base}:${rel}`);
// Sources are read from the git objects at --base, never from the working tree, so a later move of the source files
// (the relayout) cannot change what this builds.
const readSrc = (rel) => cp.execFileSync('git', ['-C', repo, 'show', `${base}:${rel}`], { maxBuffer: 1 << 26 });
const listSrc = (dirRel) => git('ls-tree', '-r', '--name-only', base, '--', dirRel).split('\n').filter(Boolean);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const KEYS = {
  planner: 'Final answer: one JSON object with top-level keys "summary", "subtasks", "risks".',
  implementer: 'Final answer: one JSON object with top-level keys "status", "files_changed", "red_evidence", "green_evidence".',
  reviewer: 'Final answer: one JSON object with top-level keys "verdict", "findings".',
  verifier: 'Final answer: one JSON object with top-level keys "case_id", "steps".',
  debugger: 'Final answer: one JSON object with top-level keys "evidence", "hypotheses", "root_cause".',
  explorer: 'Final answer: one JSON object with top-level key "answers".',
};

const OT = 'evals/orchestration/tasks';
const SO = 'evals/skill-onoff/tasks';
const VA_GEN = 'evals/va-eval-generator.js';
const NOEDIT = 'Do not modify any file in the repository; this is a read-only task.';
const PROTECTED = ['.git', '.claude', 'run-tests.sh', 'oracle.sh'];

const defs = [];
// reviewer: known-bad diffs + skill-transport predicates
for (const [id, name] of [['kb-01', '01-dropped-error-check'], ['kb-05', '05-off-by-one'], ['kb-09', '09-null-deref']]) {
  defs.push({
    role: 'reviewer', id, sources: [`evals/known-bad/${name}.diff`, `evals/known-bad/${name}.expected.json`, `evals/skill-transport/match/${name}.match.json`],
    files: { 'input/change.diff': `evals/known-bad/${name}.diff`, 'input/known-bad.expected.json': `evals/known-bad/${name}.expected.json`, 'expected.json': `evals/skill-transport/match/${name}.match.json` },
    prompt: 'Review the diff in input/change.diff (it will be appended below). Report only defects the diff introduces. Cite the file and the new-side line number of each finding.',
  });
}
// implementer: engine-orchestration micro repos with their own oracle.sh
for (const t of ['t1-fix-with-decoy', 't4-config-layer', 't11-boundary-fix']) {
  defs.push({
    role: 'implementer', id: t, sources: [`${OT}/${t}`], copyTree: { 'input': `${OT}/${t}/repo` }, files: { 'oracle.sh': `${OT}/${t}/oracle.sh` },
    promptFrom: `${OT}/${t}/task.md`, extra: { protected: PROTECTED, oracle: ['bash', 'oracle.sh'] },
  });
}
// verifier: seed-derived va exam cases (generator pinned by blob sha; envelope pinned by sha256)
for (const family of ['boundary-off-by-one', 'error-path-swallow', 'state-residue']) {
  defs.push({ role: 'verifier', id: `va-${family}`, va: { family, seed: 'rolekit-pilot-v1', trial: 0, caseIndex: 0 }, sources: ['evals/va-eval-generator.js', 'evals/va-eval-grader.js', 'evals/va-capability-evidence-corpus.json'] });
}
// planner: L-size requests from skill-onoff micro repos
const planners = {
  'd2-l-multimodule': { min_subtasks: 2, require_dependency: false },
  'd8-l-two-phase': { min_subtasks: 2, require_dependency: true },
  'dc-l-api': { min_subtasks: 2, require_dependency: false },
};
for (const [t, ex] of Object.entries(planners)) {
  defs.push({
    role: 'planner', id: t, sources: [`${SO}/${t}/task.md`, `${SO}/${t}/repo`], copyTree: { 'input': `${SO}/${t}/repo` },
    promptFrom: `${SO}/${t}/task.md`, promptPrefix: 'Plan this work; do not implement it. Read the repository under input/ before you decide the split.\n\nRequest:\n',
    extra: { must_cover: ['lib/', 'cli.js', 'docs/'], ...ex, acceptance_command_heads: ['bash', 'node', 'npm', 'git', 'test', 'grep', 'python3', 'sh'] },
  });
}
// debugger: known root cause in the same micro repos (read-only diagnosis)
const dbg = {
  't4-config-layer': { file: 'lib/config.js', line_min: 14, line_max: 18, claim_regex: '(precedence|Object\\.assign|order|override|env)', symptom: 'Users changed "port" to 8080 in config/defaults.json but the tool still prints port 3000, and PORT/THEME env vars do not win over the files. A reviewer note blames lib/parser.js.', decoy: 'lib/parser.js' },
  't11-boundary-fix': { file: 'lib/pager.py', line_min: 13, line_max: 15, claim_regex: '(off.by.one|end - 1|end-1|last page|slice)', symptom: 'Paginating a list of 4 items with page size 2: page 2 returns [\'c\'] instead of [\'c\', \'d\'].', decoy: null },
  't15-cache-invalidation': { file: 'keys.py', line_min: 8, line_max: 8, claim_regex: '(key|id|role|collapse|stale)', symptom: 'After an account is promoted from viewer to admin, get_permissions keeps returning the old permissions. service.py looks correct on its own.', decoy: 'service.py' },
};
for (const [t, d] of Object.entries(dbg)) {
  defs.push({
    role: 'debugger', id: t, sources: [`${OT}/${t}/repo`], copyTree: { 'input': `${OT}/${t}/repo` },
    prompt: `Find the root cause of this symptom. ${NOEDIT} Run commands to reproduce and to test each hypothesis; name the file and line of the root cause.\n\nSymptom: ${d.symptom}`,
    extra: { root_cause_file: d.file, line_min: d.line_min, line_max: d.line_max, claim_regex: d.claim_regex, decoy_file: d.decoy, min_hypotheses: 2 },
  });
}
// explorer: located-or-absent questions over the same repos
const exq = {
  't4-config-layer': [
    { id: 'q1', expect_found: true, file: 'lib/config.js', needle: 'Object\\.assign\\(\\{\\}, env, defaults, override\\)', ask: 'Where are the env, defaults and override layers merged into one object?' },
    { id: 'q2', expect_found: true, file: 'lib/parser.js', needle: 'JSON\\.parse', ask: 'Where is a JSON config file parsed?' },
    { id: 'q3', expect_found: false, ask: 'Where is the config schema validated?' }],
  't11-boundary-fix': [
    { id: 'q1', expect_found: true, file: 'lib/pager.py', needle: 'def paginate', ask: 'Where is paginate defined?' },
    { id: 'q2', expect_found: true, file: 'main.py', needle: 'paginate\\(items, page_num, page_size\\)', ask: 'Where is paginate called?' },
    { id: 'q3', expect_found: false, ask: 'Where is a database connection opened?' }],
  't15-cache-invalidation': [
    { id: 'q1', expect_found: true, file: 'keys.py', needle: 'return \\(record\\["id"\\],\\)', ask: 'Where is the cache key built?' },
    { id: 'q2', expect_found: true, file: 'store.py', needle: 'self\\._cache = \\{\\}', ask: 'Where is the cache dictionary created?' },
    { id: 'q3', expect_found: false, ask: 'Where is cache expiry (TTL) implemented?' }],
};
for (const [t, qs] of Object.entries(exq)) {
  defs.push({
    role: 'explorer', id: t, sources: [`${OT}/${t}/repo`], copyTree: { 'input': `${OT}/${t}/repo` },
    prompt: `Answer each question about the repository under input/. ${NOEDIT} For each answer give found=true with at least one citation (file, line, and the exact quoted line), or found=false with no citations when the repository has no such thing. Do not guess.\n\nQuestions:\n${qs.map((q) => `${q.id}. ${q.ask}`).join('\n')}`,
    extra: { questions: qs },
  });
}

function walk(dir) { // frozen output tree
  const res = [];
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) res.push(...walk(p)); else res.push(p);
  }
  return res;
}

function build(target) {
  const manifest = { schema_version: 1, artifact_type: 'rolekit_pilot_tasks', base_sha: base, tasks: [] };
  for (const d of defs) {
    const dir = path.join(target, d.role, d.id);
    fs.mkdirSync(dir, { recursive: true });
    const wr = (rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
    const cpf = (rel, src) => wr(rel, readSrc(src));
    for (const [rel, src] of Object.entries(d.files || {})) cpf(rel, src);
    for (const [rel, src] of Object.entries(d.copyTree || {})) for (const f of listSrc(src)) cpf(path.join(rel, path.relative(src, f)), f);
    let prompt = d.prompt || '';
    if (d.promptFrom) prompt = (d.promptPrefix || '') + readSrc(d.promptFrom).toString('utf8').trimEnd();
    const entry = { role: d.role, id: d.id, dir: `${d.role}/${d.id}`, sources: d.sources.map((s) => ({ path: s, git_object: objSha(s) })) };
    if (d.va) {
      const gdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rkg-'));
      fs.writeFileSync(path.join(gdir, 'va-eval-generator.js'), readSrc(VA_GEN));
      fs.writeFileSync(path.join(gdir, 'va-capability-evidence-corpus.json'), readSrc('evals/va-capability-evidence-corpus.json'));
      const va = require(path.join(gdir, 'va-eval-generator.js'));
      fs.rmSync(gdir, { recursive: true, force: true });
      const admin = va.generateAdministration(d.va.seed);
      const c = admin.trials[d.va.trial].cases.find((x) => x.family === d.va.family && x.case_index === d.va.caseIndex);
      if (!c) die(`no va case for ${d.va.family}`);
      wr('input/envelope.json', c.envelope);
      prompt = 'Write a verification plan for the module described by the envelope in input/envelope.json (appended below). Each step is one call with arguments inside the stated domain and the result you declare the specification demands. Choose calls that would expose a defect in an implementation that deviates from the specification. You cannot see the implementation.';
      wr('expected.json', JSON.stringify({ kind: 'va_case', seed: d.va.seed, trial: d.va.trial, family: d.va.family, case_index: d.va.caseIndex, case_id: c.case_id, envelope_sha256: sha256(Buffer.from(c.envelope)), generator_version: admin.generatorVersion, grader: 'evals/va-eval-grader.js gradeCase' }, null, 2) + '\n');
    } else if (d.extra) {
      wr('expected.json', JSON.stringify({ kind: d.role, ...d.extra }, null, 2) + '\n');
    }
    wr('prompt.md', `${prompt}\n\n${KEYS[d.role]}\n`);
    entry.files = {};
    for (const f of walk(dir)) entry.files[path.relative(dir, f)] = sha256(fs.readFileSync(f));
    manifest.tasks.push(entry);
  }
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (check) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rkb-'));
  const fresh = build(tmp);
  const have = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  if (JSON.stringify(fresh) !== JSON.stringify(have)) die('manifest differs from a fresh build');
  for (const t of have.tasks) for (const [rel, h] of Object.entries(t.files)) {
    const p = path.join(out, t.dir, rel);
    if (!fs.existsSync(p) || sha256(fs.readFileSync(p)) !== h) die(`frozen file changed: ${t.dir}/${rel}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`build-tasks: ok (${have.tasks.length} tasks)`);
} else {
  const m = build(out);
  console.log(`build-tasks: wrote ${m.tasks.length} tasks to ${out}`);
}
