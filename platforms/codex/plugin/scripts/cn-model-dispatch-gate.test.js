'use strict';
// cn-model-dispatch-gate (Fleet task 01M7E2A1, card d-1dfcf757): a barred family is blocked for transcript / sensitive / core / novel / unknown tasks; every rail.
// Nothing real is spawned: PATH is a sentinel dir whose kimi/grok/agy/codex stubs print SENTINEL and exit 99.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const gate = require('./lib/cn-model-dispatch-gate');
require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo

const S = __dirname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tfg-'));
const runsDir = path.join(tmp, 'runs');
const sentinelRuns = path.join(tmp, 'autopilot-dispatch-runs');
fs.mkdirSync(runsDir);
fs.mkdirSync(sentinelRuns);
const sent = path.join(tmp, 'sent');
fs.mkdirSync(sent);
for (const b of ['kimi', 'grok', 'agy', 'codex', 'claude', 'cursor', 'opencode']) {
  fs.writeFileSync(path.join(sent, b), '#!/bin/sh\necho SENTINEL "$0"\nexit 99\n', { mode: 0o755 });
}
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
// Resolver input for in-process checks. A missing endpoints file so the resolver does not open a real one.
// Loopback proves the listed names are the fleet's own gateway. A case overrides the URL or gateway list.
process.env.AUTOPILOT_ENDPOINTS_ENV = path.join(tmp, 'no-endpoints.env');
process.env.AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL = 'http://127.0.0.1:9/v1';
process.env.AUTOPILOT_ENDPOINT_QWEN_LOCAL_TOKEN = 'local-test';
process.env.AUTOPILOT_ENDPOINT_GLM_LOCAL_URL = 'http://127.0.0.1:9/v1';
process.env.AUTOPILOT_ENDPOINT_GLM_LOCAL_TOKEN = 'local-test';
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf8' });
git('init', '-q', '-b', 'develop'); git('commit', '-q', '--allow-empty', '-m', 'i');
const marked = path.join(tmp, 'marked.md');
const plain = path.join(tmp, 'plain.md');
const diff = path.join(tmp, 'd.diff');
fs.writeFileSync(marked, 'Lane: x\nReads-Transcript: yes\nbody\n');
fs.writeFileSync(plain, 'Lane: x\nbody\n');
const small = path.join(tmp, 'small.md');
fs.writeFileSync(small, 'Engine: kimi | Role: implementer | Lane: x | Size: S\nScope: docs/a.md, docs/util/fmt.md\nbody\n');
fs.writeFileSync(diff, 'diff --git a/x b/x\n');

function env(extra = {}) {
  const e = { ...process.env, PATH: `${sent}:/usr/bin:/bin:/usr/local/bin`, HOME: home, CLAUDE_CONFIG_DIR: path.join(tmp, 'cc'), ...extra };
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_TASK_READS_TRANSCRIPT', 'AUTOPILOT_TASK_CLASS', 'AUTOPILOT_CN_GATE_NOW']) delete e[k];
  // After extra: a spawned rail cannot inherit or override the real dispatch-runs ledger.
  return { ...e, ...extra, TMPDIR: tmp, AUTOPILOT_DISPATCH_RUNS_DIR: runsDir };
}
const run = (cmd, args, extra) => spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', env: env(extra), input: '', timeout: 120000 });
const out = (r) => `${r.stdout}${r.stderr}`;
const BARRED = /cn_model_dispatch_barred \w+ [\w-]+ \(01M7E2A1, d-1dfcf757\)/;

const K = { runner: 'kimi', model: 'kimi-code/kimi-for-coding' };
const OK = { AUTOPILOT_TASK_SIZE: 'S', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'docs/a.md' };
const cls = (x, env, extra) => gate.check({ ...x, env, cwd: repo, ...extra });

test('unit: family list and inference (negative controls first)', () => {
  assert.deepEqual([...gate.BARRED_FAMILIES].sort(), ['alibaba', 'deepseek', 'minimax', 'moonshot', 'qoder', 'zhipu']);
  assert.equal(gate.familyOf('cc-shim', 'x', 'glm'), 'zhipu');
  assert.equal(gate.familyOf('anthropic-compatible', 'MiniMax-M3'), 'minimax');
  assert.equal(gate.familyOf('cc-shim', 'Qwen3.8-Max'), 'alibaba');
  assert.equal(gate.familyOf('cc-shim', 'deepseek-v4'), 'deepseek');
  assert.equal(gate.familyOf('qoderclicn', 'x'), 'qoder');
  assert.equal(gate.familyOf('grok', 'grok-4.7'), 'xai');
});

test('class 1 transcript: marked kimi / glm endpoint refused; marked grok allowed', () => {
  let c = cls(K, { ...OK, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' });
  assert.equal(c.allowed, false); assert.equal(c.cls, 'transcript');
  assert.equal(c.line, 'cn_model_dispatch_barred moonshot transcript (01M7E2A1, d-1dfcf757)');
  c = cls({ runner: 'cc-shim', model: 'x', endpoint: 'glm' }, { ...OK, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' });
  assert.equal(c.cls, 'transcript'); assert.equal(c.family, 'zhipu');
  assert.equal(cls(K, OK, { files: [marked] }).cls, 'transcript', 'header marker alone');
  assert.equal(cls({ runner: 'grok', model: 'grok-4.7' }, { AUTOPILOT_TASK_READS_TRANSCRIPT: '1' }).allowed, true);
});

test('class 2 sensitive: scope path or repo name on the list', () => {
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SCOPE: 'docs/a.md, app/.env' }).cls, 'sensitive');
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SCOPE: 'billing/export.js' }).cls, 'sensitive');
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SCOPE: 'data/customers/list.csv' }).cls, 'sensitive');
  const pay = fs.mkdtempSync(path.join(tmp, 'payments-svc-'));
  assert.equal(gate.check({ ...K, env: OK, cwd: pay }).cls, 'sensitive', 'repo name');
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SCOPE: 'secrets-notes.md' }).cls, 'sensitive');
});

function gitRepo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const g = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  const init = g('init', '-q', '-b', 'develop');
  assert.equal(init.status, 0, init.stderr);
  const commit = g('commit', '-q', '--allow-empty', '-m', 'i');
  assert.equal(commit.status, 0, commit.stderr);
  return dir;
}

function briefFile(name, text) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, text);
  return f;
}

test('class 3 core: size above S, or a core dir from the repo config', () => {
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'M' }).cls, 'core-size');
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'XL' }).cls, 'core-size');
  const core = path.join(tmp, 'corerepo');
  fs.mkdirSync(path.join(core, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(core, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['lib/engine/**'] }));
  assert.equal(gate.check({ ...K, env: { ...OK, AUTOPILOT_TASK_SCOPE: 'lib/engine/run.js' }, cwd: core }).cls, 'core-dir');
  assert.equal(gate.check({ ...K, env: OK, cwd: core }).allowed, true, 'a non-core path in the same repo is allowed');
});

test('core-unset: empty core_dirs treats every path as core except the shipped allow list and absent New-Files', () => {
  const bare = gitRepo('core-unset-bare');
  const incident = briefFile('incident.md', 'Size: S\nRole: implementer\nScope: src/cli/install.rs\n');
  const cliIncident = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'check', '--runner', 'kimi', '--model', 'kimi-code', '--cwd', bare, '--prompt-file', incident]);
  assert.notEqual(cliIncident.status, 0);
  assert.match(cliIncident.stderr, /cn_model_dispatch_barred moonshot core-unset/);
  assert.equal(gate.check({ ...K, env: {}, files: [incident], cwd: bare }).cls, 'core-unset');

  const docs = briefFile('allow-docs.md', 'Size: S\nRole: implementer\nScope: docs/plans/x.md\n');
  assert.equal(gate.check({ ...K, env: {}, files: [docs], cwd: bare }).allowed, true);
  const fix = briefFile('allow-fix.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/seat_burn/a.json\n');
  assert.equal(gate.check({ ...K, env: {}, files: [fix], cwd: bare }).allowed, true);
  const neu = briefFile('allow-new.md', 'Size: S\nRole: implementer\nScope: tests/test_new.py\nNew-Files: tests/test_new.py\n');
  assert.equal(fs.existsSync(path.join(bare, 'tests/test_new.py')), false);
  assert.equal(gate.check({ ...K, env: {}, files: [neu], cwd: bare }).allowed, true);

  fs.mkdirSync(path.join(bare, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'tests/test_old.py'), 'x\n');
  const old = briefFile('deny-old.md', 'Size: S\nRole: implementer\nScope: tests/test_old.py\nNew-Files: tests/test_old.py\n');
  assert.equal(gate.check({ ...K, env: {}, files: [old], cwd: bare }).cls, 'core-unset');
  const mixed = briefFile('deny-mixed.md', 'Size: S\nRole: implementer\nScope: docs/a.md, src/b.rs\n');
  assert.equal(gate.check({ ...K, env: {}, files: [mixed], cwd: bare }).cls, 'core-unset');

  const widen = gitRepo('core-unset-widen');
  fs.mkdirSync(path.join(widen, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(widen, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_unset_allow: ['src/**'] }));
  const widened = briefFile('deny-widen.md', 'Size: S\nRole: implementer\nScope: src/b.rs\n');
  assert.equal(gate.check({ ...K, env: {}, files: [widened], cwd: widen }).cls, 'core-unset', 'a repo cannot add to core_unset_allow');

  const set = gitRepo('core-dirs-set');
  fs.mkdirSync(path.join(set, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(set, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['scripts/**'] }));
  assert.equal(gate.check({ ...K, env: { ...OK, AUTOPILOT_TASK_SCOPE: 'src/x.js' }, cwd: set }).allowed, true);
  assert.equal(gate.check({ ...K, env: { ...OK, AUTOPILOT_TASK_SCOPE: 'scripts/y.js' }, cwd: set }).cls, 'core-dir');

  const sens = briefFile('deny-env.md', 'Size: S\nRole: implementer\nScope: docs/.env\n');
  assert.equal(gate.check({ ...K, env: {}, files: [sens], cwd: bare }).cls, 'sensitive');
});

test('core-unset paths: normalise, anchor the allow list, existence under the repo root', () => {
  const bare = gitRepo('core-unset-paths');
  const denied = (name, text) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare }).cls, 'core-unset', name);
  };
  denied('deny-dotdot.md', 'Size: S\nRole: implementer\nScope: docs/../src/x.rs\n');
  denied('deny-src-docs.md', 'Size: S\nRole: implementer\nScope: src/docs/x.rs\n');
  denied('deny-outside.md', 'Size: S\nRole: implementer\nScope: ../outside.rs\nNew-Files: ../outside.rs\n');
  denied('deny-glob.md', 'Size: S\nRole: implementer\nScope: src/*.rs\nNew-Files: src/*.rs\n');
  denied('deny-abs.md', 'Size: S\nRole: implementer\nScope: /src/x.rs\n');
  denied('deny-dotdot-norm.md', 'Size: S\nRole: implementer\nScope: docs/./../src/x.rs\n');

  const sub = path.join(bare, 'src');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'x.rs'), 'fn x() {}\n');
  const cwdFile = briefFile('deny-cwd.md', 'Size: S\nRole: implementer\nScope: src/x.rs\nNew-Files: src/x.rs\n');
  assert.equal(gate.check({ ...K, env: {}, files: [cwdFile], cwd: sub }).cls, 'core-unset', 'existence is under the repo root');
  const cli = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'check', '--runner', 'kimi', '--model', 'kimi-code', '--cwd', sub, '--prompt-file', cwdFile]);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /cn_model_dispatch_barred moonshot core-unset/);

  const allow = (name, text) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare }).allowed, true, name);
  };
  allow('allow-docs-plan.md', 'Size: S\nRole: implementer\nScope: docs/plans/x.md\n');
  allow('allow-dot-docs.md', 'Size: S\nRole: implementer\nScope: ./docs/a.md\n');
  allow('allow-fixtures.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/seat_burn/a.json\n');
  allow('allow-src-fixtures.md', 'Size: S\nRole: implementer\nScope: src/fixtures/a.json\n');
  allow('allow-absent-new.md', 'Size: S\nRole: implementer\nScope: tests/test_new.py\nNew-Files: tests/test_new.py\n');
});

test('core-unset fixtures: data extensions only; docs and absent New-Files stay extension-free', () => {
  const bare = gitRepo('core-unset-ext');
  const denied = (name, text) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare }).cls, 'core-unset', name);
  };
  const allow = (name, text) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare }).allowed, true, name);
  };
  denied('deny-fix-rs.md', 'Size: S\nRole: implementer\nScope: src/fixtures/a.rs\n');
  denied('deny-fix-sh.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/run.sh\n');
  denied('deny-testdata-make.md', 'Size: S\nRole: implementer\nScope: tests/testdata/Makefile\n');
  denied('deny-fixtures-ts.md', 'Size: S\nRole: implementer\nScope: tests/__fixtures__/x.ts\n');
  allow('allow-fix-json.md', 'Size: S\nRole: implementer\nScope: src/fixtures/a.json\n');
  allow('allow-fix-yaml.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/seat_burn/a.yaml\n');
  allow('allow-csv-case.md', 'Size: S\nRole: implementer\nScope: tests/testdata/b.CSV\n');
  allow('allow-snap.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/out.snap\n');
  allow('allow-doc-rs.md', 'Size: S\nRole: implementer\nScope: docs/notes.rs\n');
  allow('allow-docdir.md', 'Size: S\nRole: implementer\nScope: doc/guide\n');
  allow('allow-new-rs.md', 'Size: S\nRole: implementer\nScope: src/fixtures/new.rs\nNew-Files: src/fixtures/new.rs\n');
});

test('core-unset round 4: whitespace and quoted diff paths, symlink components, every Scope and New-Files header', () => {
  const bare = gitRepo('core-unset-r4');
  const denied = (name, text, extra = {}) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare, ...extra }).cls, 'core-unset', name);
  };
  const allow = (name, text, extra = {}) => {
    const f = briefFile(name, text);
    assert.equal(gate.check({ ...K, env: {}, files: [f], cwd: bare, ...extra }).allowed, true, name);
  };

  const wsDiff = briefFile('ws-path.diff', 'diff --git a/src/fixtures/a.json z.rs b/src/fixtures/a.json z.rs\n+++ b/src/fixtures/a.json z.rs\n');
  denied('deny-ws-brief.md', 'Size: S\nRole: implementer\n', { diffFiles: [wsDiff] });
  const quotedDiff = briefFile('quoted-path.diff', '+++ "b/src/fixtures/a\\tb.json"\n');
  denied('deny-quoted-brief.md', 'Size: S\nRole: implementer\n', { diffFiles: [quotedDiff] });

  fs.mkdirSync(path.join(bare, 'src'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'src', 'exist.rs'), 'fn e() {}\n');
  fs.writeFileSync(path.join(bare, 'src', 'exist.json'), '{}\n');
  fs.mkdirSync(path.join(bare, 'docs'), { recursive: true });
  fs.symlinkSync('../src', path.join(bare, 'docs', 'lnk'));
  denied('deny-docs-lnk.md', 'Size: S\nRole: implementer\nScope: docs/lnk/exist.rs\n');
  fs.mkdirSync(path.join(bare, 'tests'), { recursive: true });
  fs.symlinkSync('../src', path.join(bare, 'tests', 'fixtures'));
  denied('deny-tests-fixtures-lnk.md', 'Size: S\nRole: implementer\nScope: tests/fixtures/exist.json\n');
  denied('deny-new-under-lnk.md', 'Size: S\nRole: implementer\nScope: docs/lnk/zz.rs\nNew-Files: docs/lnk/zz.rs\n');
  fs.symlinkSync('missing-target.rs', path.join(bare, 'src', 'dangling.rs'));
  denied('deny-dangling.md', 'Size: S\nRole: implementer\nScope: src/dangling.rs\nNew-Files: src/dangling.rs\n');
  denied('deny-two-scope.md', 'Size: S\nRole: implementer\nScope: docs/a.md\nScope: src/a.rs\n');

  const okDiff = briefFile('ok-paths.diff', 'diff --git a/docs/plans/x.md b/docs/plans/x.md\n+++ b/docs/plans/x.md\t2020-01-01 00:00:00 +0000\ndiff --git a/tests/fixtures/a.json b/tests/fixtures/a.json\n--- a/tests/fixtures/a.json\n+++ b/tests/fixtures/a.json\n');
  const okRepo = gitRepo('core-unset-r4-ok');
  const okBrief = briefFile('allow-normal-diff.md', 'Size: S\nRole: implementer\n');
  assert.equal(gate.check({ ...K, env: {}, files: [okBrief], diffFiles: [okDiff], cwd: okRepo }).allowed, true, 'normal diff docs and fixtures');
  allow('allow-two-docs-scope.md', 'Size: S\nRole: implementer\nScope: docs/a.md\nScope: docs/plans/x.md\n');
});

test('core-unset round 5: CRLF diffs, rename/copy/binary, every field on a header line, lstat only ENOENT is absent', () => {
  const bare = gitRepo('core-unset-r5');
  const brief = 'Size: S\nRole: implementer\nScope: docs/a.md\n';
  const deniedDiff = (name, diffText) => {
    const d = briefFile(`${name}.diff`, diffText);
    const f = briefFile(`${name}.md`, brief);
    assert.equal(gate.check({ ...K, env: {}, files: [f], diffFiles: [d], cwd: bare }).cls, 'core-unset', name);
  };
  deniedDiff('deny-crlf', 'diff --git a/src/a.rs b/src/a.rs\r\n--- a/src/a.rs\r\n+++ b/src/a.rs\r\n');
  deniedDiff('deny-rename-to-src', 'diff --git a/docs/a.md b/src/a.rs\nsimilarity index 100%\nrename from docs/a.md\nrename to src/a.rs\n');
  fs.mkdirSync(path.join(bare, 'src'), { recursive: true });
  fs.writeFileSync(path.join(bare, 'src', 'exist.rs'), 'fn e() {}\n');
  deniedDiff('deny-rename-from-src', 'diff --git a/src/exist.rs b/docs/exist.rs\nsimilarity index 100%\nrename from src/exist.rs\nrename to docs/exist.rs\n');
  deniedDiff('deny-binary-to-src', 'diff --git a/docs/a.png b/src/a.png\nBinary files a/docs/a.png and b/src/a.png differ\n');
  deniedDiff('deny-quoted-diff-git', 'diff --git "a/docs/a.md" "b/src/a.rs"\n');
  const pipeScope = briefFile('deny-pipe-scope.md', 'Size: S\nRole: implementer\nScope: docs/a.md | Scope: src/a.rs\n');
  assert.equal(gate.check({ ...K, env: {}, files: [pipeScope], cwd: bare }).cls, 'core-unset', 'Scope twice on one line');
  const pipeAll = briefFile('deny-pipe-all.md', 'Size: S | Role: implementer | Scope: docs/a.md | Scope: src/a.rs\n');
  assert.equal(gate.check({ ...K, env: {}, files: [pipeAll], cwd: bare }).cls, 'core-unset', 'Scope twice inside a one-line header');

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.log('note: skip chmod 000 core-unset case (running as root)');
  } else {
    const pdir = path.join(bare, 'src', 'p');
    fs.mkdirSync(pdir, { recursive: true });
    fs.chmodSync(pdir, 0);
    try {
      const nf = briefFile('deny-eacces.md', 'Size: S\nRole: implementer\nScope: src/p/new.rs\nNew-Files: src/p/new.rs\n');
      assert.equal(gate.check({ ...K, env: {}, files: [nf], cwd: bare }).cls, 'core-unset', 'EACCES is not absent');
    } finally {
      fs.chmodSync(pdir, 0o755);
    }
  }

  const okRepo = gitRepo('core-unset-r5-ok');
  const lf = briefFile('allow-lf.diff', 'diff --git a/docs/plans/x.md b/docs/plans/x.md\n+++ b/docs/plans/x.md\ndiff --git a/tests/fixtures/a.json b/tests/fixtures/a.json\n--- a/tests/fixtures/a.json\n+++ b/tests/fixtures/a.json\n');
  const lfBrief = briefFile('allow-lf.md', brief);
  assert.equal(gate.check({ ...K, env: {}, files: [lfBrief], diffFiles: [lf], cwd: okRepo }).allowed, true, 'LF diff docs and fixtures');
  const ren = briefFile('allow-rename-docs.diff', 'diff --git a/docs/a.md b/docs/b.md\nsimilarity index 100%\nrename from docs/a.md\nrename to docs/b.md\n');
  assert.equal(gate.check({ ...K, env: {}, files: [lfBrief], diffFiles: [ren], cwd: okRepo }).allowed, true, 'rename inside docs');
  const bothDocs = briefFile('allow-pipe-docs.md', 'Size: S | Role: implementer | Scope: docs/a.md | Scope: docs/b.md\n');
  assert.equal(gate.check({ ...K, env: {}, files: [bothDocs], cwd: okRepo }).allowed, true, 'two docs scopes on one line');
});

test('class 4 novel: plan/design/brainstorm/architecture/research roles, or a novel marker', () => {
  for (const r of ['plan', 'design', 'brainstorm', 'architecture', 'research']) {
    assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_ROLE: r }).cls, 'novel', r);
  }
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_NOVEL: '1' }).cls, 'novel');
  const nov = path.join(tmp, 'novel.md'); fs.writeFileSync(nov, 'Role: implementer | Size: S\nNovel: yes\nScope: docs/a.md\n');
  assert.equal(cls(K, {}, { files: [nov] }).cls, 'novel');
});

test('review-role: barred cloud families refuse a review role at any size; grok and qwen_local do not', () => {
  const rev = { AUTOPILOT_TASK_SIZE: 'XS', AUTOPILOT_TASK_ROLE: 'reviewer', AUTOPILOT_TASK_SCOPE: 'docs/a.md' };
  let c = cls(K, rev);
  assert.equal(c.allowed, false);
  assert.equal(c.cls, 'review-role');
  assert.equal(c.family, 'moonshot');
  assert.equal(c.line, 'cn_model_dispatch_barred moonshot review-role (01M7E2A1, d-1dfcf757)');
  c = cls({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm' }, { ...rev, AUTOPILOT_TASK_ROLE: 'qc' });
  assert.equal(c.allowed, false);
  assert.equal(c.cls, 'review-role');
  assert.equal(c.family, 'zhipu');
  assert.equal(c.line, 'cn_model_dispatch_barred zhipu review-role (01M7E2A1, d-1dfcf757)');
  c = cls({ runner: 'anthropic-compatible', model: 'MiniMax-M3' }, { ...rev, AUTOPILOT_TASK_ROLE: 'plan_review' });
  assert.equal(c.allowed, false);
  assert.equal(c.cls, 'review-role');
  assert.equal(c.family, 'minimax');
  assert.equal(cls({ runner: 'grok', model: 'grok-4.7' }, rev).allowed, true);
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'XS' }).allowed, true, 'implementer XS stays allowed');
  const { AUTOPILOT_TASK_SIZE: _sz, ...noSize } = rev;
  assert.equal(cls(K, noSize).cls, 'review-role', 'a review role is refused even when size is missing');
  assert.equal(cls(K, { ...rev, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' }).cls, 'transcript', 'transcript still wins');
  assert.equal(cls(K, { ...rev, AUTOPILOT_TASK_SCOPE: 'app/.env' }).cls, 'sensitive', 'sensitive still wins');
  const auto = path.join(tmp, 'autopilot-review-role');
  fs.mkdirSync(auto);
  const gi = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: auto, encoding: 'utf8' });
  assert.equal(gi.status, 0, gi.stderr);
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const localOk = gate.check({ ...LOCAL, env: { ...rev, AUTOPILOT_TASK_CLASS: 'test-scaffold' }, cwd: auto, now: '2026-11-17T12:00:00+08:00' });
  assert.equal(localOk.allowed, true, 'qwen_local reviewer with an allowed Task-Class is not review-role');
  assert.notEqual(localOk.cls, 'review-role');
  assert.equal(gate.check({ ...LOCAL, env: { ...rev, AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_CLASS: 'test-scaffold' }, cwd: auto, now: '2026-11-17T12:00:00+08:00' }).allowed, true, 'proven-local served family is not core-size');
  const ext = path.join(tmp, 'review-ext');
  fs.mkdirSync(path.join(ext, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(ext, '.claude', 'cn-model-gate.json'), JSON.stringify({ review_roles: ['auditor'] }));
  assert.equal(gate.check({ ...K, env: { ...OK, AUTOPILOT_TASK_ROLE: 'auditor' }, cwd: ext }).cls, 'review-role', 'repo config unions a review role');
  const cleared = path.join(tmp, 'review-cleared');
  fs.mkdirSync(path.join(cleared, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cleared, '.claude', 'cn-model-gate.json'), JSON.stringify({ review_roles: [] }));
  assert.equal(gate.check({ ...K, env: rev, cwd: cleared }).cls, 'review-role', 'an empty repo list cannot drop a starter review role');
  const ladder = gate.filterLadder(['kimi-code/kimi-for-coding/high@kimi', 'grok-4.7/low@grok'], { env: rev, role: 'reviewer', cwd: repo });
  assert.deepEqual(ladder.kept, ['grok-4.7/low@grok']);
  assert.equal(ladder.barred.length, 1);
  assert.match(ladder.barred[0].line, /cn_model_dispatch_barred moonshot review-role/);
  const cli = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'filter-ladder', '--role', 'reviewer', '--', 'kimi-code/kimi-for-coding/high@kimi', 'grok-4.7/low@grok'], rev);
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim(), 'grok-4.7/low@grok');

  assert.equal(gate.check({ ...K, role: 'reviewer', env: OK, cwd: repo }).cls, 'review-role', 'env AUTOPILOT_TASK_ROLE=implementer cannot lower rail role=reviewer');
  assert.equal(gate.check({ ...K, role: 'reviewer', env: {}, files: [small], cwd: repo }).cls, 'review-role', 'header Role: implementer cannot lower rail role=reviewer');
  assert.equal(gate.check({ ...K, role: 'plan', env: OK, files: [small], cwd: repo }).cls, 'novel', 'env/header Role: implementer cannot lower novel rail role');
  const revHeader = path.join(tmp, 'rev-header.md');
  fs.writeFileSync(revHeader, 'Role: reviewer | Size: S\nScope: docs/a.md\n');
  assert.equal(gate.check({ ...K, role: 'implementer', env: OK, files: [revHeader], cwd: repo }).cls, 'review-role', 'header Role: reviewer cannot be lowered by env/rail implementer');
  const ladderDowngrade = gate.filterLadder(['kimi-code/kimi-for-coding/high@kimi', 'grok-4.7/low@grok'], { env: OK, files: [small], role: 'reviewer', cwd: repo });
  assert.deepEqual(ladderDowngrade.kept, ['grok-4.7/low@grok']);
  assert.match(ladderDowngrade.barred[0].line, /cn_model_dispatch_barred moonshot review-role/);
  const cliDowngrade = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'check', '--runner', 'kimi', '--model', 'kimi-code-k3', '--role', 'reviewer', '--prompt-file', small], OK);
  assert.equal(cliDowngrade.status, 2);
  assert.match(cliDowngrade.stderr, /cn_model_dispatch_barred moonshot review-role/);
});

test('allow: XS/S mechanical edit with a scope and role, from env or header; unbarred families always', () => {
  assert.equal(cls(K, OK).allowed, true);
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'XS' }).allowed, true);
  assert.equal(cls(K, {}, { files: [small] }).allowed, true, 'header Size/Role/Scope');
  assert.equal(cls({ runner: 'grok', model: 'grok-4.7' }, { AUTOPILOT_TASK_SIZE: 'XL', AUTOPILOT_TASK_ROLE: 'plan' }).allowed, true);
  assert.equal(cls({ runner: 'agy', model: 'gemini-4-carbon-low' }, {}).allowed, true);
  assert.equal(cls({ runner: 'kimi', model: 'k', }, { ...OK, AUTOPILOT_TEST_CN_GATE_OFF: '1', AUTOPILOT_TASK_SIZE: 'XL' }).allowed, true, 'test seam');
});

test('fail closed: missing size, role or scope blocks', () => {
  const { AUTOPILOT_TASK_SIZE: _s, ...noSize } = OK;
  assert.equal(cls(K, noSize).cls, 'unknown-size');
  assert.equal(cls(K, {}).cls, 'unknown-size');
  const { AUTOPILOT_TASK_ROLE: _r, ...noRole } = OK;
  assert.equal(cls(K, noRole).cls, 'unknown-role');
  assert.equal(cls(K, noRole, { role: 'implementer' }).allowed, true, 'a rail-implied role fills a missing one');
  const { AUTOPILOT_TASK_SCOPE: _c, ...noScope } = OK;
  assert.equal(cls(K, noScope).cls, 'unknown-scope');
  const dp = path.join(tmp, 'x.diff'); fs.writeFileSync(dp, 'diff --git a/docs/b.md b/docs/b.md\n');
  assert.equal(cls(K, noScope, { diffFiles: [dp] }).allowed, true, 'diff paths are the scope');
  fs.writeFileSync(dp, 'diff --git a/.env b/.env\n');
  assert.equal(cls(K, noScope, { diffFiles: [dp] }).cls, 'sensitive');
});

test('ladder [kimi, grok] with a barred task picks grok; all-barred leaves none', () => {
  const ctx = { env: { ...OK, AUTOPILOT_TASK_SIZE: 'L' }, cwd: repo };
  const r = gate.filterLadder(['kimi-code/kimi-for-coding/high@kimi', 'grok-4.7/low@grok'], ctx);
  assert.deepEqual(r.kept, ['grok-4.7/low@grok']);
  assert.deepEqual(gate.filterLadder(['kimi-code/kimi-for-coding/high@kimi', 'MiniMax-M3.1-Flash/high@cc-shim'], ctx).kept, []);
  const cli = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'filter-ladder', '--', 'kimi-code/kimi-for-coding/high@kimi', 'grok-4.7/low@grok'], { AUTOPILOT_TASK_SIZE: 'L' });
  assert.equal(cli.status, 0); assert.equal(cli.stdout.trim(), 'grok-4.7/low@grok');
  const cli2 = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'filter-ladder', '--', 'kimi-code/kimi-for-coding/high@kimi'], { AUTOPILOT_TASK_SIZE: 'L' });
  assert.equal(cli2.status, 2); assert.match(cli2.stderr, BARRED);
});

const heteroArgs = (f, runner, model, extra = []) => [path.join(S, 'dispatch-hetero.sh'), '--branch', 'b1', '--prompt-file', f, '--runner', runner, '--model', model, ...extra];

test('dispatch-hetero: marked kimi refused (exit 2); marked cc-shim glm refused; marked grok and unmarked kimi pass the gate', () => {
  let r = run('bash', heteroArgs(marked, 'kimi', 'kimi-code/kimi-for-coding'));
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', heteroArgs(plain, 'cc-shim', 'glm-5.3', ['--endpoint', 'glm']), { AUTOPILOT_TASK_READS_TRANSCRIPT: '1' });
  assert.equal(r.status, 2); assert.match(out(r), /cn_model_dispatch_barred zhipu transcript/);
  r = run('bash', heteroArgs(marked, 'grok', 'grok-4.7'));
  assert.doesNotMatch(out(r), BARRED);
  r = run('bash', heteroArgs(plain, 'kimi', 'kimi-code/kimi-for-coding'));
  assert.equal(r.status, 2); assert.match(out(r), /cn_model_dispatch_barred moonshot unknown-size/, 'fail closed without a size');
  r = run('bash', heteroArgs(small, 'kimi', 'kimi-code/kimi-for-coding'));
  assert.doesNotMatch(out(r), BARRED, 'XS/S with scope passes');
  r = run('bash', heteroArgs(small, 'kimi', 'kimi-code/kimi-for-coding'), { AUTOPILOT_TASK_SIZE: 'L' });
  assert.match(out(r), /cn_model_dispatch_barred moonshot core-size/);
});

test('dispatch-review: marked kimi refused, marked grok passes the gate, unmarked kimi is review-role', () => {
  const a = (runner, model, spec) => [path.join(S, 'dispatch-review.sh'), '--runner', runner, '--model', model, '--diff-file', diff, '--spec-file', spec];
  let r = run('bash', a('kimi', 'kimi-code-k3', marked));
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', a('grok', 'grok-4.7', marked));
  assert.doesNotMatch(out(r), BARRED);
  r = run('bash', a('kimi', 'kimi-code-k3', plain));
  assert.match(out(r), /cn_model_dispatch_barred moonshot review-role/, 'a reviewer rail is refused even without a size');
  r = run('bash', a('kimi', 'kimi-code-k3', small));
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred moonshot review-role/, 'a review rail cannot be lowered by header Role: implementer');
  r = run('bash', a('kimi', 'kimi-code-k3', small), OK);
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred moonshot review-role/, 'a review rail cannot be lowered by env AUTOPILOT_TASK_ROLE=implementer');
});

test('dispatch-anthropic-review: non-raw forces reviewer (ignoring --role) and checks --spec-file; --raw honours --role', () => {
  const js = path.join(S, 'dispatch-anthropic-review.js');
  let r = run('node', [js, '--diff-file', diff, '--spec-file', small, '--model', 'MiniMax-M3'], OK);
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred minimax review-role/, 'direct non-raw call without --role defaults to reviewer under implementer env/spec');

  r = run('node', [js, '--diff-file', diff, '--model', 'MiniMax-M3', '--role', 'implementer'], { ...OK, AUTOPILOT_TASK_SIZE: 'XS' });
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred minimax review-role/, 'non-raw call with --role implementer at size XS is still refused as review-role');

  r = run('node', [js, '--diff-file', diff, '--spec-file', marked, '--model', 'MiniMax-M3'], OK);
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred minimax transcript/, 'direct non-raw call checks Reads-Transcript: yes in --spec-file');

  r = run('node', [js, '--raw', '--prompt-file', small, '--model', 'MiniMax-M3', '--base-url', 'http://127.0.0.1:1', '--token-env', 'TEST_UNSET_CN_GATE_TOKEN'], { ...OK, TEST_UNSET_CN_GATE_TOKEN: '' });
  assert.equal(r.status, 2);
  assert.doesNotMatch(out(r), BARRED, '--raw without --role leaves implementer XS/S authoring allowed by the gate');
  assert.match(out(r), /missing auth token in env/);

  r = run('node', [js, '--raw', '--role', 'implementer', '--prompt-file', plain, '--model', 'MiniMax-M3', '--base-url', 'http://127.0.0.1:1', '--token-env', 'TEST_UNSET_CN_GATE_TOKEN'], { AUTOPILOT_TASK_SIZE: 'XS', AUTOPILOT_TASK_SCOPE: 'docs/a.md', TEST_UNSET_CN_GATE_TOKEN: '' });
  assert.equal(r.status, 2);
  assert.doesNotMatch(out(r), BARRED, '--raw honours --role implementer for allowed XS authoring');
  assert.match(out(r), /missing auth token in env/);

  r = run('node', [js, '--raw', '--role', 'reviewer', '--prompt-file', small, '--model', 'MiniMax-M3'], OK);
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred minimax review-role/, '--raw with --role reviewer cannot be lowered by env/header');
});

test('dispatch-author: marked kimi refused, marked grok passes the gate', () => {
  const a = (runner, model) => [path.join(S, 'dispatch-author.sh'), '--runner', runner, '--model', model, '--prompt-file', marked];
  let r = run('bash', a('kimi', 'kimi-code/kimi-for-coding'));
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', a('grok', 'grok-4.7'));
  assert.doesNotMatch(out(r), BARRED);
});

test('dispatch-foreman: marked brief refused (rail is always kimi); unmarked passes the gate', () => {
  const plan = path.join(tmp, 'plan.md'); fs.writeFileSync(plan, 'plan\n');
  const a = (brief) => [path.join(S, 'dispatch-foreman.sh'), '--brief-file', brief, '--plan-file', plan, '--kimi-bin', path.join(sent, 'kimi')];
  const allowKimi = { AUTOPILOT_KIMI_LOCAL_ALLOW: '1' };
  let r = run('bash', a(marked), allowKimi);
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', a(plain), allowKimi);
  assert.match(out(r), /cn_model_dispatch_barred moonshot unknown-size/);
  r = run('bash', a(small), allowKimi);
  assert.doesNotMatch(out(r), BARRED);
});

test('review-jury: marked with --seats kimi,glm,minimax leaves no seat (exit 2); marked grok seat is not barred', () => {
  const pack = path.join(tmp, 'pack.md'); fs.writeFileSync(pack, 'diff --git a/x b/x\n+x\n');
  const j = (seats, outd, extra) => [path.join(S, 'review-jury.js'), 'run', '--pack', pack, '--implementer-family', 'anthropic', '--out', path.join(tmp, outd), '--seats', seats, '--dispatch-bin', path.join(sent, 'grok'), ...(extra || [])];
  let r = run('node', j('kimi,glm,minimax', 'j1'), { AUTOPILOT_TASK_READS_TRANSCRIPT: '1' });
  assert.equal(r.status, 2); assert.match(out(r), BARRED);
  const runJson = JSON.parse(fs.readFileSync(path.join(tmp, 'j1', 'run.json'), 'utf8'));
  for (const n of ['kimi', 'glm', 'minimax']) assert.equal(runJson.seats[n].state, 'barred_family');
  r = run('node', j('kimi,glm,minimax', 'j2'), { AUTOPILOT_TASK_SIZE: 'S' });
  assert.equal(r.status, 2);
  assert.match(out(r), /cn_model_dispatch_barred moonshot review-role/, 'a review seat is refused at size S');
  const rj2 = JSON.parse(fs.readFileSync(path.join(tmp, 'j2', 'run.json'), 'utf8'));
  for (const n of ['kimi', 'glm', 'minimax']) assert.equal(rj2.seats[n].state, 'barred_family');
  r = run('node', j('grok,kimi', 'j3'), { AUTOPILOT_TASK_READS_TRANSCRIPT: '1' });
  const rj = JSON.parse(fs.readFileSync(path.join(tmp, 'j3', 'run.json'), 'utf8'));
  assert.equal(rj.seats.kimi.state, 'barred_family');
  assert.notEqual(rj.seats.grok.state, 'barred_family');
});

test('hetero-review-loop: runSeatDispatch skips a barred seat without spawning', () => {
  const src = fs.readFileSync(path.join(S, 'hetero-review-loop.js'), 'utf8');
  assert.match(src, /cn-model-dispatch-gate/);
  assert.match(src, /seat \$\{seat\.id\} skipped: \$\{tfg\.line\}/);
});

test('dispatch-consult: gate and barred-rung guard are wired', () => {
  const src = fs.readFileSync(path.join(S, 'dispatch-consult.sh'), 'utf8');
  assert.match(src, /cn-model-dispatch-gate\.js" check --role consult --runner "\$CONSULT_RUNNER"/);
  assert.match(src, /barred rung is not a fallback/);
});

test('dispatch-hetero: --runner qoderclicn on a core path is barred before the stub runs', () => {
  const core = path.join(tmp, 'qoder-core');
  fs.mkdirSync(path.join(core, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(core, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['lib/engine/**'] }));
  const g = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: core, encoding: 'utf8' });
  g('init', '-q', '-b', 'develop');
  g('commit', '-q', '--allow-empty', '-m', 'i');
  const stub = path.join(tmp, 'qoder-sentinel');
  fs.writeFileSync(stub, '#!/bin/sh\necho SENTINEL\nexit 99\n', { mode: 0o755 });
  const prompt = path.join(tmp, 'qoder-core.md');
  fs.writeFileSync(prompt, 'Engine: qwen | Role: implementer | Lane: x | Size: S\nScope: lib/engine/run.js\nbody\n');
  const e = env({
    AUTOPILOT_TASK_SIZE: 'S',
    AUTOPILOT_TASK_ROLE: 'implementer',
    AUTOPILOT_TASK_SCOPE: 'lib/engine/run.js',
  });
  delete e.AUTOPILOT_TEST_CN_GATE_OFF;
  const r = spawnSync('bash', [
    path.join(S, 'dispatch-hetero.sh'), '--no-verify-tip', '--branch', 'b-qoder',
    '--prompt-file', prompt, '--runner', 'qoderclicn', '--model', 'x', '--qoder-bin', stub,
  ], { cwd: core, encoding: 'utf8', env: e, input: '', timeout: 60000 });
  const text = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 2);
  assert.match(text, /cn_model_dispatch_barred qoder core-dir/);
  assert.doesNotMatch(text, /SENTINEL/);
});

test.after(() => {
  let leaked = [];
  try {
    leaked = fs.existsSync(sentinelRuns) ? fs.readdirSync(sentinelRuns) : ['missing'];
    assert.deepEqual(leaked, [], `dispatch manifest leaked outside the test runs dir: ${leaked.join(',')}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('(a) qwen_local with size, role and scope but no Task-Class is refused unknown-task-class', () => {
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const c = cls(LOCAL, OK);
  assert.equal(c.allowed, false);
  assert.equal(c.cls, 'unknown-task-class');
  assert.equal(c.family, 'alibaba');
  assert.equal(c.line, 'cn_model_dispatch_barred alibaba unknown-task-class (01M7E2A1, d-1dfcf757)');
});

test('local fleet endpoint (PM 01M7F6TK): qwen_local is not cloud dispatch; cloud Qwen and other families stay barred', () => {
  const core = path.join(tmp, 'corerepo');
  fs.mkdirSync(path.join(core, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(core, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['lib/engine/**'] }));
  const env0 = { ...OK, AUTOPILOT_TASK_SCOPE: 'lib/engine/run.js', AUTOPILOT_TASK_SIZE: 'L', AUTOPILOT_TASK_READS_TRANSCRIPT: '1' };
  const at = (x) => gate.check({ ...x, env: env0, cwd: core });
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  assert.deepEqual(gate.localEndpoints(), ['qwen_local', 'glm_local']);
  assert.equal(at(LOCAL).cls, 'transcript', 'local qwen is not exempt: transcript still bars');
  assert.equal(at(LOCAL).family, 'alibaba');
  assert.equal(at({ runner: 'anthropic-compatible', endpoint: 'qwen_local' }).cls, 'transcript');
  assert.equal(at({ runner: 'cc-shim', model: 'Qwen3.8-Max' }).allowed, false, 'cloud Qwen, no endpoint');
  assert.equal(at({ runner: 'cc-shim', model: 'Qwen3.8-Max', endpoint: 'qwen' }).allowed, false, 'cloud qwen endpoint');
  assert.equal(at({ runner: 'cc-shim', model: 'x', endpoint: 'glm' }).allowed, false);
  assert.equal(at({ ...K, endpoint: 'kimi' }).allowed, false);
  assert.equal(at({ runner: 'cc-shim', model: 'deepseek-v4', endpoint: 'deepseek' }).allowed, false);
  assert.equal(at({ runner: 'anthropic-compatible', model: 'MiniMax-M3', endpoint: 'minimax' }).allowed, false);
  assert.equal(at({ runner: 'qoderclicn', model: 'x' }).allowed, false);
  const mixed = at({ runner: 'cc-shim', model: 'kimi-code/kimi-for-coding', endpoint: 'qwen_local' });
  assert.equal(mixed.allowed, false, 'a cloud kimi model on the local endpoint is still barred');
  assert.equal(mixed.family, 'moonshot');
  const cleanKimi = gate.check({ runner: 'cc-shim', model: 'kimi-code/kimi-for-coding', endpoint: 'qwen_local', env: OK, cwd: repo });
  assert.equal(cleanKimi.allowed, true, 'a different barred family on qwen_local does not take the task-class rule');
  assert.equal(cleanKimi.family, 'moonshot');
});

test('(b) each allowed Task-Class at XS and S on repo autopilot is allowed', () => {
  const auto = path.join(tmp, 'autopilot');
  fs.mkdirSync(auto, { recursive: true });
  const g = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: auto, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  for (const taskClass of ['format-convert', 'log-summary', 'simple-script', 'test-scaffold']) {
    for (const size of ['XS', 'S']) {
      const c = gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_SIZE: size, AUTOPILOT_TASK_CLASS: taskClass }, cwd: auto });
      assert.equal(c.allowed, true, `${taskClass} ${size}`);
      assert.equal(c.family, 'alibaba');
    }
  }
  const header = path.join(tmp, 'class-header.md');
  fs.writeFileSync(header, 'Size: S | Role: implementer | Task-Class: simple-script\nScope: docs/a.md\n');
  assert.equal(gate.check({ ...LOCAL, env: {}, files: [header], cwd: auto }).allowed, true, 'header Task-Class');
});

test('(c) Task-Class refactor is refused task-class', () => {
  const auto = path.join(tmp, 'autopilot');
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const c = gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_CLASS: 'refactor' }, cwd: auto });
  assert.equal(c.allowed, false);
  assert.equal(c.cls, 'task-class');
  assert.equal(c.line, 'cn_model_dispatch_barred alibaba task-class (01M7E2A1, d-1dfcf757)');
});

test('(d) AUTOPILOT_TASK_CLASS overrides a Task-Class header', () => {
  const auto = path.join(tmp, 'autopilot');
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const brief = path.join(tmp, 'refactor-header.md');
  fs.writeFileSync(brief, 'Task-Class: refactor\nSize: S\nRole: implementer\nScope: docs/a.md\n');
  const c = gate.check({ ...LOCAL, env: { AUTOPILOT_TASK_CLASS: 'log-summary' }, files: [brief], cwd: auto });
  assert.equal(c.allowed, true);
  assert.equal(gate.check({ ...LOCAL, env: {}, files: [brief], cwd: auto }).cls, 'task-class', 'header alone is still refactor');
});

test('(e) local qwen still hits transcript, novel and sensitive; core-size does not apply when the URL is loopback', () => {
  const auto = path.join(tmp, 'autopilot');
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  assert.equal(gate.check({ ...LOCAL, env: OK, files: [marked], cwd: auto }).cls, 'transcript');
  const big = gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_CLASS: 'simple-script' }, cwd: auto });
  assert.equal(big.allowed, true, 'implementer core-size on a loopback local endpoint is allowed');
  assert.equal(big.family, 'alibaba');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_NOVEL: '1' }, cwd: auto }).cls, 'novel');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_SCOPE: '.env' }, cwd: auto }).cls, 'sensitive');
});

test('(f) local_deny_repos bars twgameproject and aaa-race, and a repo may only add names', () => {
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const allow = { ...OK, AUTOPILOT_TASK_CLASS: 'log-summary' };
  for (const name of ['twgameproject-main', 'aaa-race-3']) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    const g = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: dir, encoding: 'utf8' });
    assert.equal(g.status, 0, g.stderr);
    const c = gate.check({ ...LOCAL, env: allow, cwd: dir });
    assert.equal(c.cls, 'local-deny-repo', name);
    assert.equal(c.line, 'cn_model_dispatch_barred alibaba local-deny-repo (01M7E2A1, d-1dfcf757)');
  }
  assert.equal(gate.check({ ...LOCAL, env: OK, cwd: path.join(tmp, 'twgameproject-main') }).cls, 'local-deny-repo', 'deny wins over a missing class');
  const extRepo = path.join(tmp, 'deny-ext', 'autopilot');
  fs.mkdirSync(path.join(extRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(extRepo, '.claude', 'cn-model-gate.json'), JSON.stringify({ local_deny_repos: ['autopilot'], local_task_classes: ['extra-class'] }));
  const g = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: extRepo, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  assert.equal(gate.check({ ...LOCAL, env: allow, cwd: extRepo }).cls, 'local-deny-repo', 'repo config adds autopilot');
  const classRepo = path.join(tmp, 'class-ext', 'autopilot');
  fs.mkdirSync(path.join(classRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(classRepo, '.claude', 'cn-model-gate.json'), JSON.stringify({ local_task_classes: ['extra-class'] }));
  const g2 = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: classRepo, encoding: 'utf8' });
  assert.equal(g2.status, 0, g2.stderr);
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_CLASS: 'extra-class' }, cwd: classRepo }).allowed, true, 'repo may add a class');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_CLASS: 'format-convert' }, cwd: classRepo }).allowed, true, 'a starter class cannot be removed');
  const cleared = path.join(tmp, 'aaa-race-cleared');
  fs.mkdirSync(path.join(cleared, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(cleared, '.claude', 'cn-model-gate.json'), JSON.stringify({ local_deny_repos: [] }));
  const g3 = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: cleared, encoding: 'utf8' });
  assert.equal(g3.status, 0, g3.stderr);
  assert.equal(gate.check({ ...LOCAL, env: allow, cwd: cleared }).cls, 'local-deny-repo', 'an empty repo list cannot drop a starter deny');
});

test('(g) cloud qwen and glm results stay the pre-change outputs', () => {
  assert.deepEqual(cls({ runner: 'cc-shim', model: 'Qwen3.8-Max' }, OK), { allowed: true, family: 'alibaba' });
  assert.deepEqual(
    cls({ runner: 'cc-shim', model: 'x', endpoint: 'glm' }, { ...OK, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' }),
    { allowed: false, family: 'zhipu', cls: 'transcript', line: 'cn_model_dispatch_barred zhipu transcript (01M7E2A1, d-1dfcf757)' },
  );
  assert.deepEqual(
    cls({ runner: 'cc-shim', model: 'Qwen3.8-Max' }, { ...OK, AUTOPILOT_TASK_SIZE: 'M' }),
    { allowed: false, family: 'alibaba', cls: 'core-size', line: 'cn_model_dispatch_barred alibaba core-size (01M7E2A1, d-1dfcf757)' },
  );
  assert.deepEqual(
    cls({ runner: 'cc-shim', model: 'Qwen3.8-Max' }, { ...OK, AUTOPILOT_TASK_CLASS: 'refactor' }),
    { allowed: true, family: 'alibaba' },
    'a cloud dispatch ignores Task-Class',
  );
});

test('(h) filter-ladder drops a qwen_local rung when Task-Class is missing', () => {
  const rung = 'Qwen3.8-27B-QUASAR-NVFP4/medium@cc-shim#qwen_local';
  const r = gate.filterLadder([rung, 'grok-4.7/low@grok'], { env: OK, cwd: repo });
  assert.deepEqual(r.kept, ['grok-4.7/low@grok']);
  assert.equal(r.barred.length, 1);
  assert.equal(r.barred[0].line, 'cn_model_dispatch_barred alibaba unknown-task-class (01M7E2A1, d-1dfcf757)');
  const named = gate.filterLadder(['Qwen3.8-27B/medium@qwen_local'], { env: OK, cwd: repo });
  assert.deepEqual(named.kept, []);
  assert.match(named.barred[0].line, /unknown-task-class/);
  const cli = run('node', [path.join(S, 'lib', 'cn-model-dispatch-gate.js'), 'filter-ladder', '--', rung], OK);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /cn_model_dispatch_barred alibaba unknown-task-class \(01M7E2A1, d-1dfcf757\)/);
  const kept = gate.filterLadder([rung], { env: { ...OK, AUTOPILOT_TASK_CLASS: 'test-scaffold' }, cwd: repo });
  assert.deepEqual(kept.kept, [rung]);
});

// Shipped review_local_exceptions only (d-ede04b92, PM 01M7JPZQ). A repo file cannot open,
// extend, or shrink one. Clock is check({ now }) (no env override).
const EXC_BEFORE = '2026-11-17T12:00:00+08:00';
const EXC_JUST_BEFORE = '2026-11-21T23:59:58.999+08:00';
const EXC_UNTIL = '2026-11-21T23:59:59+08:00';
const EXC_AFTER = '2026-11-22T00:00:00+08:00';
const EXC_LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
const EXC_REV = { AUTOPILOT_TASK_SIZE: 'S', AUTOPILOT_TASK_ROLE: 'loop_reviewer', AUTOPILOT_TASK_SCOPE: 'docs/a.md', AUTOPILOT_TASK_CLASS: 'test-scaffold' };

function excRepo(name) {
  const dir = path.join(tmp, 'exc', name);
  fs.mkdirSync(dir, { recursive: true });
  const g = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: dir, encoding: 'utf8' });
  assert.equal(g.status, 0, g.stderr);
  return dir;
}

test('review_local_exceptions: qwen_local review role is allowed only before the shipped until, and a repo cannot extend it', () => {
  const normal = excRepo('autopilot');
  const late = gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: normal, now: EXC_AFTER });
  assert.equal(late.allowed, false);
  assert.equal(late.cls, 'review-role', 'after the shipped until the local served family is review-role');
  assert.equal(late.family, 'alibaba');
  assert.equal(late.line, 'cn_model_dispatch_barred alibaba review-role (01M7E2A1, d-1dfcf757)');
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: normal, now: EXC_UNTIL }).cls, 'review-role', 'now == until is not before until');
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: normal, now: EXC_BEFORE }).allowed, true, 'before expiry a normal repo is allowed');
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: normal, now: EXC_JUST_BEFORE }).allowed, true, 'one millisecond before until is allowed');

  const hangar = excRepo('hangar');
  const denied = gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: hangar, now: EXC_BEFORE });
  assert.equal(denied.cls, 'review-role', 'a denied repo is review-role, not the later local-deny-repo class');
  const { AUTOPILOT_TASK_SIZE: _sz, ...noSize } = EXC_REV;
  assert.equal(gate.check({ ...EXC_LOCAL, env: noSize, cwd: hangar, now: EXC_BEFORE }).cls, 'review-role', 'review-role wins even when size is missing');
  assert.equal(gate.check({ ...EXC_LOCAL, env: { ...EXC_REV, AUTOPILOT_TASK_ROLE: 'implementer' }, cwd: hangar, now: EXC_BEFORE }).cls, 'local-deny-repo', 'a non-review role on a denied repo stays local-deny-repo');

  const extended = excRepo('autopilot-extended');
  fs.mkdirSync(path.join(extended, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(extended, '.claude', 'cn-model-gate.json'), JSON.stringify({
    review_local_exceptions: [{ endpoint: 'qwen_local', until: '2099-01-01T00:00:00+08:00', ref: 'repo' }],
  }));
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: extended, now: EXC_AFTER }).cls, 'review-role', 'a repo cannot extend the shipped until');

  const shrunk = excRepo('autopilot-shrunk');
  fs.mkdirSync(path.join(shrunk, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(shrunk, '.claude', 'cn-model-gate.json'), JSON.stringify({
    review_local_exceptions: [{ endpoint: 'qwen_local', until: '2020-01-01T00:00:00+08:00', ref: 'repo' }],
  }));
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: shrunk, now: EXC_BEFORE }).allowed, true, 'a repo cannot shrink the shipped until');

  const glmRepo = excRepo('autopilot-glm');
  fs.mkdirSync(path.join(glmRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(glmRepo, '.claude', 'cn-model-gate.json'), JSON.stringify({
    review_local_exceptions: [{ endpoint: 'glm', until: '2099-01-01T00:00:00+08:00', ref: 'repo' }],
  }));
  const glm = gate.check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm', env: EXC_REV, cwd: glmRepo, now: EXC_BEFORE });
  assert.equal(glm.allowed, false);
  assert.equal(glm.cls, 'review-role', 'a cloud glm reviewer stays refused');
  assert.equal(glm.family, 'zhipu');

  assert.equal(gate.check({ ...EXC_LOCAL, env: { ...EXC_REV, AUTOPILOT_CN_GATE_NOW: EXC_BEFORE }, cwd: normal, now: 'not-a-date' }).cls, 'review-role', 'an invalid explicit now fails closed and ignores AUTOPILOT_CN_GATE_NOW');
  assert.equal(gate.check({ ...EXC_LOCAL, env: { ...EXC_REV, AUTOPILOT_CN_GATE_NOW: EXC_BEFORE }, cwd: normal, now: EXC_AFTER }).cls, 'review-role', 'AUTOPILOT_CN_GATE_NOW is ignored when now is after expiry');
  const realDateNow = Date.now;
  try {
    Date.now = () => Date.parse(EXC_AFTER);
    assert.equal(gate.check({ ...EXC_LOCAL, env: { ...EXC_REV, AUTOPILOT_CN_GATE_NOW: EXC_BEFORE }, cwd: normal }).cls, 'review-role', 'AUTOPILOT_CN_GATE_NOW is ignored even when now is omitted and the real clock is after expiry');
  } finally {
    Date.now = realDateNow;
  }

  // Runner/model shorthands resolving to qwen_local without an explicit endpoint.
  assert.equal(gate.check({ runner: 'qwen_local', model: 'Qwen3.8-27B-QUASAR-NVFP4', env: EXC_REV, cwd: normal, now: EXC_BEFORE }).allowed, true, 'runner=qwen_local shorthand resolves effective endpoint before expiry');
  assert.equal(gate.check({ runner: 'qwen_local', model: 'Qwen3.8-27B-QUASAR-NVFP4', env: EXC_REV, cwd: normal, now: EXC_AFTER }).cls, 'review-role', 'runner=qwen_local shorthand expires after until');
  assert.equal(gate.check({ runner: 'cc-shim', model: 'qwen_local', env: EXC_REV, cwd: normal, now: EXC_BEFORE }).allowed, true, 'model=qwen_local shorthand resolves effective endpoint before expiry');
  assert.equal(gate.check({ runner: 'cc-shim', model: 'qwen_local', env: EXC_REV, cwd: normal, now: EXC_AFTER }).cls, 'review-role', 'model=qwen_local shorthand expires after until');
  assert.equal(gate.check({ runner: 'qwen_local', model: 'kimi-k2', env: EXC_REV, cwd: normal, now: EXC_BEFORE }).cls, 'review-role', 'other barred family with runner=qwen_local shorthand stays barred');

  const rung = 'Qwen3.8-27B-QUASAR-NVFP4/medium@cc-shim#qwen_local';
  const rungAlias = 'Qwen3.8-27B-QUASAR-NVFP4/medium@qwen_local';
  assert.deepEqual(gate.filterLadder([rung, rungAlias], { env: EXC_REV, cwd: normal, now: EXC_BEFORE }).kept, [rung, rungAlias]);
  const dropped = gate.filterLadder([rung, rungAlias], { env: EXC_REV, cwd: normal, now: EXC_AFTER });
  assert.deepEqual(dropped.kept, []);
  assert.match(dropped.barred[0].line, /cn_model_dispatch_barred alibaba review-role/);
  assert.match(dropped.barred[1].line, /cn_model_dispatch_barred alibaba review-role/);

  const gateMod = path.join(S, 'lib', 'cn-model-dispatch-gate.js');
  const wrapScript = 'const g = require(process.argv[1]); const c = g.check({ runner: process.argv[2], model: process.argv[3], endpoint: process.argv[4], role: "loop_reviewer", cwd: process.argv[5], now: process.argv[6] }); if (!c.allowed) { process.stderr.write(c.line + "\\n"); process.exit(2); }';
  const cliLate = run('node', ['-e', wrapScript, gateMod, 'cc-shim', 'Qwen3.8-27B-QUASAR-NVFP4', 'qwen_local', normal, EXC_AFTER], { ...EXC_REV, AUTOPILOT_CN_GATE_NOW: EXC_BEFORE });
  assert.equal(cliLate.status, 2, cliLate.stderr);
  assert.match(cliLate.stderr, /cn_model_dispatch_barred alibaba review-role \(01M7E2A1, d-1dfcf757\)/);
  const cliOk = run('node', ['-e', wrapScript, gateMod, 'cc-shim', 'Qwen3.8-27B-QUASAR-NVFP4', 'qwen_local', normal, EXC_BEFORE], EXC_REV);
  assert.equal(cliOk.status, 0, cliOk.stderr);
  const cliAliasOk = run('node', ['-e', wrapScript, gateMod, 'qwen_local', 'Qwen3.8-27B-QUASAR-NVFP4', '', normal, EXC_BEFORE], EXC_REV);
  assert.equal(cliAliasOk.status, 0, cliAliasOk.stderr);
});

test('local served family skips core-dir and core-unset (operator via PM, ledger fadf8dc9)', () => {
  const hooksRepo = gitRepo('local-core-hooks');
  fs.mkdirSync(path.join(hooksRepo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(hooksRepo, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['hooks/**'] }));
  const QWEN = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const GLM = { runner: 'cc-shim', model: 'glm-4.6', endpoint: 'glm_local' };
  const base = {
    AUTOPILOT_TASK_SIZE: 'XS',
    AUTOPILOT_TASK_ROLE: 'implementer',
    AUTOPILOT_TASK_SCOPE: 'hooks/foo.sh',
    AUTOPILOT_TASK_CLASS: 'simple-script',
  };
  const qwenCore = gate.check({ ...QWEN, env: base, cwd: hooksRepo });
  assert.equal(qwenCore.allowed, true, 'qwen_local may edit a configured core dir');
  assert.equal(qwenCore.family, 'alibaba');
  const glmCore = gate.check({ ...GLM, env: base, cwd: hooksRepo });
  assert.equal(glmCore.allowed, true, 'glm_local serving GLM may edit a configured core dir');
  assert.equal(glmCore.family, 'zhipu');
  const cloud = gate.check({ runner: 'cc-shim', model: 'Qwen3.8-Max', endpoint: 'qwen', env: base, cwd: hooksRepo });
  assert.equal(cloud.allowed, false);
  assert.equal(cloud.cls, 'core-dir', 'cloud qwen keeps core-dir');
  const kimiOnLocal = gate.check({ runner: 'cc-shim', model: 'kimi-code/kimi-for-coding', endpoint: 'qwen_local', env: base, cwd: hooksRepo });
  assert.equal(kimiOnLocal.cls, 'core-dir', 'a different barred family on qwen_local keeps core-dir');
  assert.equal(kimiOnLocal.family, 'moonshot');
  const big = gate.check({ ...QWEN, env: { ...base, AUTOPILOT_TASK_SIZE: 'M' }, cwd: hooksRepo });
  assert.equal(big.allowed, true, 'proven-local served family is not core-size');
  const bare = gitRepo('local-core-unset');
  fs.mkdirSync(path.join(bare, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(bare, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: [] }));
  const src = gate.check({ ...QWEN, env: { ...base, AUTOPILOT_TASK_SCOPE: 'src/a.js' }, cwd: bare });
  assert.equal(src.allowed, true, 'empty core_dirs does not core-unset a local served family');
  const noClass = gate.check({
    ...QWEN,
    env: { AUTOPILOT_TASK_SIZE: 'XS', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'hooks/foo.sh' },
    cwd: hooksRepo,
  });
  assert.equal(noClass.cls, 'unknown-task-class', 'missing Task-Class still blocks');
});

test('local by URL: loopback, gateway host, external host, cloud CN, model auto, endpoint suffix', () => {
  const auto = path.join(tmp, 'autopilot');
  const impl = { AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'docs/a.md', AUTOPILOT_TASK_CLASS: 'simple-script' };
  const loop = gate.check({
    runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local',
    env: { ...impl, AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'http://127.0.0.2:9/v1' }, cwd: auto,
  });
  assert.equal(loop.allowed, true, '127.0.0.0/8 is loopback even when it is not 127.0.0.1');
  assert.equal(loop.family, 'alibaba');
  const gw = gate.check({
    runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local',
    env: { ...impl, AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'https://fleet-gw.example/v1', AUTOPILOT_LOCAL_GATEWAY_HOSTS: 'fleet-gw.example' },
    cwd: auto,
  });
  assert.equal(gw.allowed, true, 'hostname on local_gateway_hosts is local');
  const ext = gate.check({
    runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local',
    env: { ...impl, AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: 'https://example.com/v1' }, cwd: auto,
  });
  assert.equal(ext.allowed, false);
  assert.equal(ext.cls, 'local_name_external_host');
  assert.equal(ext.line, 'cn_model_dispatch_barred alibaba local_name_external_host (01M7E2A1, d-1dfcf757)');
  const cloud = gate.check({ runner: 'cc-shim', model: 'Qwen3.8-Max', endpoint: 'qwen', env: impl, cwd: auto });
  assert.equal(cloud.allowed, false);
  assert.equal(cloud.cls, 'core-size', 'an external CN endpoint stays core-size');
  const autoModel = gate.check({
    runner: 'cc-shim', model: 'auto', endpoint: 'qwen_local', env: impl, cwd: auto,
  });
  assert.equal(autoModel.allowed, true, 'model auto on a proven-local endpoint is the served family');
  assert.equal(autoModel.family, 'alibaba');
  const suffixed = gate.check({
    runner: 'cc-shim', model: 'auto', endpoint: 'Qwen_Local/Qwen3.8-27B-QUASAR-NVFP4', env: impl, cwd: auto,
  });
  assert.equal(suffixed.allowed, true, 'case and a model suffix still name the local endpoint');
});

test('local by URL: a listed RFC1918 address is local-served; unlisted, public and outside 172.16/12 stay refused', () => {
  const auto = path.join(tmp, 'autopilot');
  const impl = { AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'docs/a.md', AUTOPILOT_TASK_CLASS: 'simple-script' };
  const rfc1918 = [192, 168, 7, 9].join('.');
  const publicIp = [203, 0, 113, 9].join('.');
  const outside172 = [172, 32, 1, 4].join('.');
  const qwen = (host, list) => gate.check({
    runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local',
    env: {
      ...impl,
      AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: `http://${host}:9/v1`,
      ...(list === undefined ? {} : { AUTOPILOT_LOCAL_GATEWAY_HOSTS: list }),
    },
    cwd: auto,
  });
  const listed = qwen(rfc1918, rfc1918);
  assert.equal(listed.allowed, true, 'listed RFC1918 address is local-served');
  assert.equal(listed.family, 'alibaba');
  const unlisted = qwen(rfc1918);
  assert.equal(unlisted.allowed, false);
  assert.equal(unlisted.cls, 'local_name_external_host', 'same RFC1918 address unlisted is refused');
  const pub = qwen(publicIp, publicIp);
  assert.equal(pub.allowed, false);
  assert.equal(pub.cls, 'local_name_external_host', 'listed public IPv4 is refused');
  const out172 = qwen(outside172, outside172);
  assert.equal(out172.allowed, false);
  assert.equal(out172.cls, 'local_name_external_host', 'listed address outside 172.16/12 is refused');
});

test('local by URL: RFC1918 in ~/.autopilot config local_gateway_hosts is local-served; absent, public and unparsable stay refused', () => {
  const auto = path.join(tmp, 'autopilot');
  const cfgFile = path.join(tmp, 'user-gateway-config.json');
  const impl = { AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'docs/a.md', AUTOPILOT_TASK_CLASS: 'simple-script' };
  const rfc1918 = [10, 1, 2, 3].join('.');
  const publicIp = [198, 51, 100, 7].join('.');
  const qwen = (host, body) => {
    fs.writeFileSync(cfgFile, body);
    return gate.check({
      runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local',
      env: {
        ...impl,
        AUTOPILOT_ENDPOINT_QWEN_LOCAL_URL: `http://${host}:9/v1`,
        AUTOPILOT_CONFIG: cfgFile,
      },
      cwd: auto,
    });
  };
  const listed = qwen(rfc1918, JSON.stringify({ local_gateway_hosts: [rfc1918] }));
  assert.equal(listed.allowed, true, 'RFC1918 address listed in the user config is local-served');
  assert.equal(listed.family, 'alibaba');
  const absent = qwen(rfc1918, JSON.stringify({ local_gateway_hosts: [] }));
  assert.equal(absent.allowed, false);
  assert.equal(absent.cls, 'local_name_external_host', 'same address absent from the user config is refused');
  const pub = qwen(publicIp, JSON.stringify({ local_gateway_hosts: [publicIp] }));
  assert.equal(pub.allowed, false);
  assert.equal(pub.cls, 'local_name_external_host', 'public address listed in the user config is refused');
  const bad = qwen(rfc1918, '{');
  assert.equal(bad.allowed, false);
  assert.equal(bad.cls, 'local_name_external_host', 'unparsable user config adds nothing and is refused');
});

// Scoped review exception (PM 01M7XP968Q66): glm_local may act as the non-scoring ThinkSmart UX
// reference reviewer only. repos/roles on an entry narrow it; an entry without them is unchanged.
const GLM_BEFORE = '2026-11-25T12:00:00+08:00';
const GLM_AFTER = '2026-11-29T00:00:00+08:00';
const GLM_LOCAL = { runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm_local' };
const GLM_REF = { AUTOPILOT_TASK_SIZE: 'S', AUTOPILOT_TASK_ROLE: 'ux-reference-reviewer', AUTOPILOT_TASK_SCOPE: 'docs/a.md', AUTOPILOT_TASK_CLASS: 'test-scaffold' };

test('review_local_exceptions: glm_local is a reference reviewer for thinksmart* only, in the shipped window', () => {
  const ts = excRepo('thinksmart-web');
  const other = excRepo('autopilot-glm-ref');
  const ok = gate.check({ ...GLM_LOCAL, env: GLM_REF, cwd: ts, now: GLM_BEFORE });
  assert.equal(ok.allowed, true, 'thinksmart + glm_local + reference role is allowed');
  assert.equal(ok.family, 'zhipu');
  const scoring = gate.check({ ...GLM_LOCAL, env: { ...GLM_REF, AUTOPILOT_TASK_ROLE: 'reviewer' }, cwd: ts, now: GLM_BEFORE });
  assert.equal(scoring.cls, 'review-role', 'a scoring reviewer role stays refused');
  assert.equal(gate.check({ ...GLM_LOCAL, env: { ...GLM_REF, AUTOPILOT_TASK_ROLE: 'qc' }, cwd: ts, now: GLM_BEFORE }).cls, 'review-role');
  assert.equal(gate.check({ ...GLM_LOCAL, env: GLM_REF, cwd: other, now: GLM_BEFORE }).cls, 'review-role', 'another repo is refused');
  assert.equal(gate.check({ ...GLM_LOCAL, env: GLM_REF, cwd: ts, now: GLM_AFTER }).cls, 'review-role', 'past until is refused');
  assert.equal(gate.check({ ...GLM_LOCAL, env: GLM_REF, cwd: ts, now: '2026-11-28T23:59:59+08:00' }).cls, 'review-role', 'now == until is refused');
  assert.equal(gate.check({ ...GLM_LOCAL, env: { ...GLM_REF, AUTOPILOT_TASK_ROLE: 'implementer' }, cwd: ts, now: GLM_BEFORE }).allowed, true, 'implementer role unaffected');
  // a brief Role: header that names a scoring role cannot hide behind the reference env role
  const hdr = briefFile('glm-ref-hdr.md', 'Role: reviewer\nSize: S\nScope: docs/a.md\n');
  assert.equal(gate.check({ ...GLM_LOCAL, env: { ...GLM_REF }, files: [hdr], cwd: ts, now: GLM_BEFORE }).cls, 'review-role', 'a scoring header role still blocks');
  // qwen_local entry without repos/roles behaves as before, on any repo and role
  assert.equal(gate.check({ ...EXC_LOCAL, env: EXC_REV, cwd: other, now: EXC_BEFORE }).allowed, true, 'qwen_local unchanged');
});

// Game repos (operator 2026-11-15 rule: CN models only small mechanical tested work, docs, deps; no
// sensitive data, core code or novel work). revival* and pinball* leave local_deny_repos and sit behind
// local_restricted_repos: Task-Class, Size and no touch of deny_paths, else local-restricted-repo.
const GAME_LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
const GAME_OK = { AUTOPILOT_TASK_SIZE: 'XS', AUTOPILOT_TASK_ROLE: 'implementer', AUTOPILOT_TASK_SCOPE: 'tools/check_names.py', AUTOPILOT_TASK_CLASS: 'test-scaffold' };

test('local_restricted_repos: revival and pinball take only small mechanical work off protected paths', () => {
  const rev = excRepo('revival-world-city-war');
  const pin = excRepo('pinball-table');
  const tw = excRepo('twgameproject-main');
  const blocked = (e, cwd) => gate.check({ ...GAME_LOCAL, env: e, cwd }).cls;
  assert.equal(gate.check({ ...GAME_LOCAL, env: GAME_OK, cwd: rev }).allowed, true, 'revival test-scaffold XS ordinary path');
  assert.equal(gate.check({ ...GAME_LOCAL, env: { ...GAME_OK, AUTOPILOT_TASK_CLASS: 'simple-script', AUTOPILOT_TASK_SIZE: 'S' }, cwd: pin }).allowed, true, 'pinball simple-script S');
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_ROLE: 'tester', AUTOPILOT_TASK_CLASS: 'format-convert' }, rev), 'local-restricted-repo', 'a non-implementer keeps the restricted class list');
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_ROLE: 'tester', AUTOPILOT_TASK_CLASS: 'feature' }, rev), 'task-class', 'a non-implementer keeps the Task-Class whitelist');
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_SIZE: 'M' }, rev), 'local-restricted-repo', 'size M');
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_SIZE: '' }, rev), 'unknown-size', 'missing size is refused');
  for (const bad of ['Content/Maps/a.txt', 'Source/x/hero.uasset', 'Maps/l.umap', 'raw/dump.csv', 'data/raw/x.csv', 'save/player1/s.json', 'x/Fab/pack.json']) {
    const c = gate.check({ ...GAME_LOCAL, env: { ...GAME_OK, AUTOPILOT_TASK_SCOPE: 'tools/a.py, ' + bad }, cwd: rev });
    assert.equal(c.cls, 'local-restricted-repo', bad);
    assert.equal(c.line, 'cn_model_dispatch_barred alibaba local-restricted-repo (01M7E2A1, d-1dfcf757)');
  }
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_SIZE: 'M' }, pin), 'local-restricted-repo', 'pinball size M');
  assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_SCOPE: 'Content/a.txt' }, pin), 'local-restricted-repo', 'pinball Content');
  for (const tc of ['test-scaffold', 'simple-script', 'feature']) {
    assert.equal(blocked({ ...GAME_OK, AUTOPILOT_TASK_CLASS: tc }, tw), 'local-deny-repo', 'twgameproject ' + tc);
  }
  const art = excRepo('autopilot-restricted-control');
  assert.equal(gate.check({ ...GAME_LOCAL, env: { ...GAME_OK, AUTOPILOT_TASK_SIZE: 'M', AUTOPILOT_TASK_SCOPE: 'Content/a.txt' }, cwd: art }).allowed, true, 'an unlisted repo is not restricted');
});

// Trial scope (PM ruling): an implementer in a local_restricted_repos repo needs no Task-Class.
// Size and deny_paths, transcript, sensitive and review-role still apply; other repos and roles are unchanged.
test('local_restricted_repos trial: implementer needs no Task-Class in revival*/pinball*, nowhere else', () => {
  const rev = excRepo('revival-world-city-war');
  const pin = excRepo('pinball-table');
  const tw = excRepo('twgameproject-main');
  const other = excRepo('autopilot-trial-control');
  const { AUTOPILOT_TASK_CLASS: _c, ...noClass } = GAME_OK;
  const chk = (e, cwd, extra) => gate.check({ ...GAME_LOCAL, env: e, cwd, ...extra });
  assert.equal(chk(noClass, rev).allowed, true, 'revival implementer without Task-Class');
  assert.equal(chk(noClass, pin).allowed, true, 'pinball implementer without Task-Class');
  assert.equal(chk({ ...GAME_OK, AUTOPILOT_TASK_CLASS: 'feature' }, rev).allowed, true, 'revival implementer with a non-listed class');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_READS_TRANSCRIPT: '1' }, rev).cls, 'transcript');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_SCOPE: 'tools/a.py, .env' }, rev).cls, 'sensitive');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_ROLE: 'reviewer' }, rev, { now: EXC_AFTER }).cls, 'review-role');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_SIZE: 'M' }, rev).cls, 'local-restricted-repo', 'size still bounded');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_SCOPE: 'Content/a.txt' }, rev).cls, 'local-restricted-repo', 'deny_paths still bound');
  assert.equal(chk({ ...noClass, AUTOPILOT_TASK_ROLE: 'tester' }, rev).cls, 'unknown-task-class', 'another role still needs a class');
  assert.equal(chk(noClass, other).cls, 'unknown-task-class', 'a repo outside the trial still needs a class');
  assert.equal(chk(noClass, tw).cls, 'local-deny-repo', 'twgameproject stays denied');
});
