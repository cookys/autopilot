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
const sent = path.join(tmp, 'sent');
fs.mkdirSync(sent);
for (const b of ['kimi', 'grok', 'agy', 'codex', 'claude', 'cursor', 'opencode']) {
  fs.writeFileSync(path.join(sent, b), '#!/bin/sh\necho SENTINEL "$0"\nexit 99\n', { mode: 0o755 });
}
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
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
fs.writeFileSync(small, 'Engine: kimi | Role: implementer | Lane: x | Size: S\nScope: docs/a.md, src/util/fmt.js\nbody\n');
fs.writeFileSync(diff, 'diff --git a/x b/x\n');

function env(extra = {}) {
  const e = { ...process.env, PATH: `${sent}:/usr/bin:/bin:/usr/local/bin`, HOME: home, CLAUDE_CONFIG_DIR: path.join(tmp, 'cc'), ...extra };
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'AUTOPILOT_TASK_READS_TRANSCRIPT', 'AUTOPILOT_TASK_CLASS']) delete e[k];
  return { ...e, ...extra };
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

test('class 3 core: size above S, or a core dir from the repo config', () => {
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'M' }).cls, 'core-size');
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_SIZE: 'XL' }).cls, 'core-size');
  const core = path.join(tmp, 'corerepo');
  fs.mkdirSync(path.join(core, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(core, '.claude', 'cn-model-gate.json'), JSON.stringify({ core_dirs: ['lib/engine/**'] }));
  assert.equal(gate.check({ ...K, env: { ...OK, AUTOPILOT_TASK_SCOPE: 'lib/engine/run.js' }, cwd: core }).cls, 'core-dir');
  assert.equal(gate.check({ ...K, env: OK, cwd: core }).allowed, true, 'a non-core path in the same repo is allowed');
});

test('class 4 novel: plan/design/brainstorm/architecture/plan_review/research roles, or a novel marker', () => {
  for (const r of ['plan', 'design', 'brainstorm', 'architecture', 'plan_review', 'research']) {
    assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_ROLE: r }).cls, 'novel', r);
  }
  assert.equal(cls(K, { ...OK, AUTOPILOT_TASK_NOVEL: '1' }).cls, 'novel');
  const nov = path.join(tmp, 'novel.md'); fs.writeFileSync(nov, 'Role: implementer | Size: S\nNovel: yes\nScope: a.md\n');
  assert.equal(cls(K, {}, { files: [nov] }).cls, 'novel');
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

test('dispatch-review: marked kimi refused, marked grok passes the gate, unmarked kimi passes the gate', () => {
  const a = (runner, model, spec) => [path.join(S, 'dispatch-review.sh'), '--runner', runner, '--model', model, '--diff-file', diff, '--spec-file', spec];
  let r = run('bash', a('kimi', 'kimi-code-k3', marked));
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', a('grok', 'grok-4.7', marked));
  assert.doesNotMatch(out(r), BARRED);
  r = run('bash', a('kimi', 'kimi-code-k3', plain));
  assert.match(out(r), /cn_model_dispatch_barred moonshot unknown-size/, 'fail closed without a size');
  r = run('bash', a('kimi', 'kimi-code-k3', small));
  assert.doesNotMatch(out(r), BARRED, 'XS/S, diff paths are the scope');
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
  let r = run('bash', a(marked));
  assert.equal(r.status, 2); assert.match(out(r), BARRED); assert.doesNotMatch(out(r), /SENTINEL/);
  r = run('bash', a(plain));
  assert.match(out(r), /cn_model_dispatch_barred moonshot unknown-size/);
  r = run('bash', a(small));
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
  assert.doesNotMatch(out(r), BARRED, 'XS/S with the pack diff as scope is not gated');
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

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

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
  assert.deepEqual(gate.localEndpoints(), ['qwen_local']);
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

test('(e) local qwen still hits transcript, core-size, novel and sensitive', () => {
  const auto = path.join(tmp, 'autopilot');
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  assert.equal(gate.check({ ...LOCAL, env: OK, files: [marked], cwd: auto }).cls, 'transcript');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_SIZE: 'M' }, cwd: auto }).cls, 'core-size');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_NOVEL: '1' }, cwd: auto }).cls, 'novel');
  assert.equal(gate.check({ ...LOCAL, env: { ...OK, AUTOPILOT_TASK_SCOPE: '.env' }, cwd: auto }).cls, 'sensitive');
});

test('(f) local_deny_repos bars revival and aaa-race, and a repo may only add names', () => {
  const LOCAL = { runner: 'cc-shim', model: 'Qwen3.8-27B-QUASAR-NVFP4', endpoint: 'qwen_local' };
  const allow = { ...OK, AUTOPILOT_TASK_CLASS: 'log-summary' };
  for (const name of ['revival-world-city-war', 'aaa-race-3']) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    const g = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: dir, encoding: 'utf8' });
    assert.equal(g.status, 0, g.stderr);
    const c = gate.check({ ...LOCAL, env: allow, cwd: dir });
    assert.equal(c.cls, 'local-deny-repo', name);
    assert.equal(c.line, 'cn_model_dispatch_barred alibaba local-deny-repo (01M7E2A1, d-1dfcf757)');
  }
  assert.equal(gate.check({ ...LOCAL, env: OK, cwd: path.join(tmp, 'revival-world-city-war') }).cls, 'local-deny-repo', 'deny wins over a missing class');
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
  const cleared = path.join(tmp, 'revival-cleared');
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
