'use strict';
// scripts/qc-evidence-status.test.js — P7c: the qc fact (scripts/qc-evidence-status.js) and the watcher publisher
// (src/status/qc-fact.js). Fixture repos with a real upstream; the decision itself is scripts/lib/qc-evidence.sh, the same
// file .githooks/pre-push sources (hooks/tests/qc-gate.test.sh covers the hook side of it).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { computeQcStatus } = require('./qc-evidence-status');
const { createQcPublisher } = require('../src/status/qc-fact');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-status-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_e) { /* best effort */ } });

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@local',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@local', GIT_CEILING_DIRECTORIES: os.tmpdir(),
};
function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function commit(cwd, file, msg) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.appendFileSync(path.join(cwd, file), 'x\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', msg);
  return git(cwd, 'rev-parse', 'HEAD');
}
let n = 0;
// a work clone with an upstream (origin/main) holding one pushed base commit
function fixture() {
  n += 1;
  const bare = path.join(tmp, `origin${n}.git`);
  const work = path.join(tmp, `work${n}`);
  git(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
  git(tmp, 'clone', '-q', bare, work);
  git(work, 'checkout', '-q', '-b', 'main');
  commit(work, 'README.md', 'base');
  git(work, 'push', '-q', '-u', 'origin', 'main');
  return work;
}
function withConfig(text, fn) {
  const cfg = path.join(tmp, `cfg${n}.md`);
  fs.writeFileSync(cfg, text);
  const prev = process.env.QC_GATE_CONFIG_OVERRIDE;
  process.env.QC_GATE_CONFIG_OVERRIDE = cfg;
  try { return fn(); } finally { if (prev === undefined) delete process.env.QC_GATE_CONFIG_OVERRIDE; else process.env.QC_GATE_CONFIG_OVERRIDE = prev; }
}
const BLOCK_TRAILER = '- mode: block\n- protected_paths: skills/,scripts/\n- evidence: trailer\n';

test('Q1 nothing new since the upstream -> not_needed', () => {
  const work = fixture();
  const s = withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work }));
  assert.equal(s.state, 'not_needed');
  assert.match(s.range, /^[0-9a-f]+\.\.HEAD$/);
  assert.equal(s.protected_files_count, 0);
  assert.equal(s.mode, 'block');
});

test('Q2 only a non-protected path changed -> not_needed', () => {
  const work = fixture();
  commit(work, 'docs/a.md', 'docs only');
  const s = withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work }));
  assert.deepEqual([s.state, s.protected_files_count, s.evidence], ['not_needed', 0, null]);
});

test('Q3 protected change without a trailer -> owed, counting the protected files', () => {
  const work = fixture();
  commit(work, 'scripts/a.sh', 'touch scripts');
  commit(work, 'skills/x/SKILL.md', 'touch skills');
  commit(work, 'docs/a.md', 'docs');
  const s = withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work }));
  assert.deepEqual([s.state, s.protected_files_count, s.evidence], ['owed', 2, null]);
});

test('Q4 a QC-Verdict: PASS trailer anywhere in the range -> ok, evidence trailer', () => {
  const work = fixture();
  commit(work, 'scripts/a.sh', 'touch scripts');
  commit(work, 'docs/a.md', 'docs\n\nQC-Verdict: PASS (reviewer x, 2026-10-06)');
  const s = withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work }));
  assert.deepEqual([s.state, s.protected_files_count, s.evidence], ['ok', 1, 'trailer']);
});

test('Q5 artifact mode: a trailer does not count, .qc/<sha>.verdict.json does', () => {
  const work = fixture();
  const cfg = '- mode: block\n- protected_paths: scripts/\n- evidence: artifact\n';
  const sha = commit(work, 'scripts/a.sh', 'touch scripts\n\nQC-Verdict: PASS (x)');
  assert.equal(withConfig(cfg, () => computeQcStatus({ repo: work })).state, 'owed');
  fs.mkdirSync(path.join(work, '.qc'));
  fs.writeFileSync(path.join(work, '.qc', `${sha}.verdict.json`), '{}\n');
  const s = withConfig(cfg, () => computeQcStatus({ repo: work }));
  assert.deepEqual([s.state, s.evidence], ['ok', 'artifact']);
});

test('Q6 no upstream and no origin/HEAD -> unknown; not a git repo -> unknown', () => {
  n += 1;
  const lone = path.join(tmp, `lone${n}`);
  fs.mkdirSync(lone);
  git(lone, 'init', '-q', '-b', 'main');
  commit(lone, 'scripts/a.sh', 'touch scripts');
  const s = withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: lone }));
  assert.deepEqual([s.state, s.range, s.evidence], ['unknown', null, null]);
  const plain = path.join(tmp, `plain${n}`);
  fs.mkdirSync(plain);
  assert.equal(computeQcStatus({ repo: plain }).state, 'unknown');
});

test('Q7 mode off -> not_needed even with an unreviewed protected change', () => {
  const work = fixture();
  commit(work, 'scripts/a.sh', 'touch scripts');
  const s = withConfig('- mode: off\n- protected_paths: scripts/\n', () => computeQcStatus({ repo: work }));
  assert.deepEqual([s.state, s.mode], ['not_needed', 'off']);
});

test('Q8 CLI prints one JSON object with the data contract keys', () => {
  const work = fixture();
  commit(work, 'scripts/a.sh', 'touch scripts');
  const r = spawnSync('node', [path.join(__dirname, 'qc-evidence-status.js'), '--repo', work], {
    encoding: 'utf8', env: { ...process.env, QC_GATE_CONFIG_OVERRIDE: (() => { const c = path.join(tmp, 'cli.md'); fs.writeFileSync(c, BLOCK_TRAILER); return c; })() },
  });
  assert.equal(r.status, 0);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(o).sort(), ['evidence', 'mode', 'protected_files_count', 'range', 'schema', 'state']);
  assert.equal(o.state, 'owed');
});

test('Q9 the hook and the fact agree: same fixture, hook blocks exactly when the fact says owed', () => {
  const work = fixture();
  const sha = commit(work, 'scripts/a.sh', 'touch scripts');
  const base = git(work, 'rev-parse', 'origin/main');
  fs.mkdirSync(path.join(work, '.githooks'), { recursive: true });
  const root = path.join(__dirname, '..');
  fs.mkdirSync(path.join(work, 'scripts', 'lib'), { recursive: true });
  for (const f of ['resolve-qc-gate.sh', 'lib/json-emit.sh', 'lib/resolve-config.sh', 'lib/qc-evidence.sh']) fs.copyFileSync(path.join(root, 'scripts', f), path.join(work, 'scripts', f));
  fs.copyFileSync(path.join(root, '.githooks', 'pre-push'), path.join(work, '.githooks', 'pre-push'));
  git(work, 'config', 'autopilot.testIdentityGate', 'off');
  const hook = () => withConfig(BLOCK_TRAILER, () => spawnSync('bash', ['.githooks/pre-push'], {
    cwd: work, input: `refs/heads/main ${sha} refs/heads/main ${base}\n`, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
  }).status);
  assert.equal(withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work })).state, 'owed');
  assert.equal(hook(), 1);
  git(work, 'commit', '-q', '--allow-empty', '-m', 'review\n\nQC-Verdict: PASS (x)');
  const sha2 = git(work, 'rev-parse', 'HEAD');
  assert.equal(withConfig(BLOCK_TRAILER, () => computeQcStatus({ repo: work })).state, 'ok');
  const status = withConfig(BLOCK_TRAILER, () => spawnSync('bash', ['.githooks/pre-push'], {
    cwd: work, input: `refs/heads/main ${sha2} refs/heads/main ${base}\n`, encoding: 'utf8', env: { ...process.env, ...GIT_ENV },
  }).status);
  assert.equal(status, 0);
});

test('Q10 publisher writes <key>.qc.json, rewrites on change, throttles rechecks, tolerates a failing compute', () => {
  const runsDir = path.join(tmp, 'runs');
  fs.mkdirSync(runsDir);
  let state = 'owed';
  let calls = 0;
  const logs = [];
  const pub = createQcPublisher({
    runsDir, key: 'k1', repo: '/x', getIdentity: () => 'git-common-dir:/x/.git',
    writeAtomic: (f, t) => fs.writeFileSync(f, t), log: (m) => logs.push(m),
    compute: () => { calls += 1; if (state === 'boom') throw new Error('boom'); return { state, range: 'a..HEAD', protected_files_count: 1, evidence: state === 'ok' ? 'trailer' : null, mode: 'block' }; },
  });
  const file = path.join(runsDir, 'k1.qc.json');
  pub.publish({ nowMs: 1000000 });
  const first = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual([first.schema, first.state, first.scope.root_run_id, first.scope.project_key], ['autopilot.qc-status/1', 'owed', null, 'k1']);
  pub.publish({ nowMs: 1000000 + 5000 });
  assert.equal(calls, 1, 'rechecks are throttled');
  state = 'ok';
  pub.publish({ nowMs: 1000000 + 40000 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).state, 'ok');
  state = 'boom';
  pub.publish({ nowMs: 1000000 + 90000 });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).state, 'ok', 'a failed compute leaves the last fact');
  assert.equal(logs.length, 1);
});
