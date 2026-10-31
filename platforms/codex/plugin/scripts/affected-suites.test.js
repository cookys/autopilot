'use strict';
// node --test scripts/affected-suites.test.js
// Builds a throwaway git repo with a fixed layout and checks what the selector picks for a diff.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SEL = process.env.AFFECTED_SUITES_BIN || path.join(__dirname, 'affected-suites.js'); // env: negative control runs the pre-fix selector

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-suites-test-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  const write = (m) => {
    for (const [p, body] of Object.entries(m)) {
      const full = path.join(dir, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (body === null) fs.rmSync(full, { force: true }); else fs.writeFileSync(full, body);
    }
  };
  write(files);
  git('add', '-A'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  return {
    dir, base,
    change(m) { write(m); git('add', '-A'); git('commit', '-qm', 'change'); return git('rev-parse', 'HEAD'); },
    select(head, extra = []) {
      const out = execFileSync('node', [SEL, '--root', dir, '--base', base, '--head', head, '--json', ...extra], { stdio: 'pipe' }).toString();
      return JSON.parse(out);
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const LAYOUT = {
  'scripts/lib/core.js': 'module.exports = 1;\n',
  'scripts/tool.js': "const core = require('./lib/core.js');\nconsole.log(core);\n",
  'scripts/other.js': 'console.log("other");\n',
  'hooks/tests/tool.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/tool.js"\n',
  'hooks/tests/other.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/other.js"\n',
  'hooks/tests/lone.test.sh': '#!/usr/bin/env bash\necho nothing\n',
  'hooks/hooks.json': '{}\n',
  'docs/note.md': 'text\n',
};

test('direct reference: a test that names the changed script is selected, others are not', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/other.js': 'console.log("changed");\n' });
    const out = r.select(head);
    assert.strictEqual(out.mode, 'selective');
    assert.deepStrictEqual(out.suites, ['hooks/tests/other.test.sh']);
    assert.strictEqual(out.schema, 1);
  } finally { r.cleanup(); }
});

test('two-layer chain: shared lib -> script -> test', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/lib/core.js': 'module.exports = 2;\n' });
    const out = r.select(head);
    assert.deepStrictEqual(out.suites, ['hooks/tests/tool.test.sh']);
    assert.deepStrictEqual(out.chains['hooks/tests/tool.test.sh'],
      ['hooks/tests/tool.test.sh', 'scripts/tool.js', 'scripts/lib/core.js']);
  } finally { r.cleanup(); }
});

test('a changed test selects itself', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'hooks/tests/lone.test.sh': '#!/usr/bin/env bash\necho changed\n' });
    assert.deepStrictEqual(r.select(head).suites, ['hooks/tests/lone.test.sh']);
  } finally { r.cleanup(); }
});

test('a deleted script still selects the tests that named it', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/other.js': null });
    assert.deepStrictEqual(r.select(head).suites, ['hooks/tests/other.test.sh']);
  } finally { r.cleanup(); }
});

test('unjudgeable change (hooks.json) => full suite, no guessing', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'hooks/hooks.json': '{"a":1}\n' });
    const out = r.select(head);
    assert.strictEqual(out.mode, 'full');
    assert.deepStrictEqual(out.suites, []);
    assert.match(out.full_reasons[0], /^unjudgeable change: hooks\/hooks\.json/);
    const plain = execFileSync('node', [SEL, '--root', r.dir, '--base', r.base, '--head', head], { stdio: 'pipe' }).toString();
    assert.strictEqual(plain.trim(), 'FULL');
  } finally { r.cleanup(); }
});

test('a directory glob in a test selects it when any file in that directory changes', () => {
  const r = makeRepo({ ...LAYOUT, 'hooks/tests/sweep.test.sh': '#!/usr/bin/env bash\nfor f in scripts/*.js; do node --check "$f"; done\n' });
  try {
    const head = r.change({ 'scripts/other.js': 'console.log("changed");\n' });
    const out = r.select(head);
    assert.ok(out.suites.includes('hooks/tests/sweep.test.sh'));
    assert.ok(out.suites.includes('hooks/tests/other.test.sh'));
  } finally { r.cleanup(); }
});

test('a mention only in a comment is not a dependency', () => {
  const r = makeRepo({ ...LAYOUT, 'hooks/tests/lone.test.sh': '#!/usr/bin/env bash\n# see scripts/other.js\necho nothing\n' });
  try {
    const head = r.change({ 'scripts/other.js': 'console.log("changed");\n' });
    assert.ok(!r.select(head).suites.includes('hooks/tests/lone.test.sh'));
  } finally { r.cleanup(); }
});

test('docs-only change selects nothing and is not full', () => {
  const r = makeRepo(LAYOUT);
  try {
    const out = r.select(r.change({ 'docs/note.md': 'more text\n' }));
    assert.strictEqual(out.mode, 'selective');
    assert.deepStrictEqual(out.suites, []);
  } finally { r.cleanup(); }
});

test('changed code that no suite reaches is reported as unreferenced and forces the full suite', () => {
  const r = makeRepo({ ...LAYOUT, 'scripts/orphan.js': 'x\n' });
  try {
    const out = r.select(r.change({ 'scripts/orphan.js': 'y\n' }));
    assert.deepStrictEqual(out.unreferenced, ['scripts/orphan.js']);
    assert.strictEqual(out.mode, 'full');
    assert.ok(out.full_reasons.some((x) => x.includes('scripts/orphan.js')));
  } finally { r.cleanup(); }
});

test('a data file is reached through the directory its tests name', () => {
  const r = makeRepo({ ...LAYOUT, 'hooks/tests/fixtures/marker/ok.json': '{}\n', 'hooks/tests/marker.test.sh': '#!/usr/bin/env bash\nFX="$ROOT/hooks/tests/fixtures"\nfor f in "$FX"/marker/$NAME; do cat "$f"; done\n' });
  try {
    const out = r.select(r.change({ 'hooks/tests/fixtures/marker/ok.json': '{"a":1}\n' }));
    assert.strictEqual(out.mode, 'selective');
    assert.deepStrictEqual(out.suites, ['hooks/tests/marker.test.sh']);
  } finally { r.cleanup(); }
});

test('a data file nobody names forces the full suite instead of an empty list', () => {
  const r = makeRepo({ ...LAYOUT, 'hooks/tests/fixtures/stray/x.json': '{}\n' });
  try {
    const out = r.select(r.change({ 'hooks/tests/fixtures/stray/x.json': '{"a":1}\n' }));
    assert.strictEqual(out.mode, 'full');
  } finally { r.cleanup(); }
});

test('content-scanning suites always run on a selective result, but not on a docs-only change', () => {
  const scan = 'hooks/tests/check-js-syntax.test.sh';
  const r = makeRepo({ ...LAYOUT, [scan]: '#!/usr/bin/env bash\necho scan\n' });
  try {
    const out = r.select(r.change({ 'scripts/other.js': 'console.log("changed");\n' }));
    assert.ok(out.suites.includes(scan));
    assert.deepStrictEqual(out.always_run, [scan]);
  } finally { r.cleanup(); }
  const d = makeRepo({ ...LAYOUT, [scan]: '#!/usr/bin/env bash\necho scan\n' });
  try {
    const out = d.select(d.change({ 'docs/note.md': 'more\n' }));
    assert.deepStrictEqual(out.suites, []);
  } finally { d.cleanup(); }
});

test('glob spelled with a quoted or bare variable prefix still means the repo directory', () => {
  for (const spelling of ['"$REPO_ROOT"/scripts/*', '$REPO_ROOT/scripts/*.js', '${ROOT}/scripts/*']) {
    const r = makeRepo({ ...LAYOUT, 'hooks/tests/sweep.test.sh': `#!/usr/bin/env bash\nfor f in ${spelling}; do node --check "$f"; done\n` });
    try {
      const out = r.select(r.change({ 'scripts/other.js': 'console.log("changed");\n' }));
      assert.ok(out.suites.includes('hooks/tests/sweep.test.sh'), spelling);
    } finally { r.cleanup(); }
  }
});

test('--files mode reads the working tree', () => {
  const r = makeRepo(LAYOUT);
  try {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', r.dir, '--files', 'scripts/lib/core.js', '--json'], { stdio: 'pipe' }).toString());
    assert.deepStrictEqual(out.suites, ['hooks/tests/tool.test.sh']);
  } finally { r.cleanup(); }
});

// The real repo root; negative controls run a mutated copy elsewhere and point this at the repo.
const REAL_ROOT = process.env.AFFECTED_SUITES_REAL_ROOT || path.join(__dirname, '..');

test('real tree: files scanned by content-grepping suites select those suites (reviewer repros)', () => {
  const cases = [
    ['src/hooks/handlers/session-start.js', 'hooks/tests/p6d-gates-repair-ladder.test.sh'],
    ['src/hooks/handlers/intent-capture.js', 'hooks/tests/qualify-scorecard-vocabulary.test.sh'],
    ['scripts/probe-unknown.js', 'hooks/tests/skill-onoff-stage-graph.test.sh'],
    ['platforms/codex/plugin/mods/x.js', 'hooks/tests/check-hook-inventory.test.sh'],
    ['skills/zz-new/SKILL.md', 'hooks/tests/skill-count-metadata.test.sh'],
    ['docs/plans/evidence/x/administration/y/run.sh', 'hooks/tests/qualify-recipe-credential-staging.test.sh'],
  ];
  for (const [file, suite] of cases) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', file, '--json'], { stdio: 'pipe' }).toString());
    assert.strictEqual(out.mode, 'selective', `${file}: expected a selective result`);
    assert.ok(out.always_run.includes(suite), `${file} must run ${suite}`);
  }
});

test('real tree: every suite run.sh discovers is a known suite path', () => {
  const root = REAL_ROOT;
  const out = execFileSync('node', [SEL, '--root', root, '--list-all'], { stdio: 'pipe' }).toString().trim().split('\n');
  assert.ok(out.length > 100);
  assert.ok(out.every((p) => /\.test\.(sh|js)$/.test(p)));
});

// BL-0001 phase 2: mods/live has its own entry (mods/live/run-tests.sh) that run.sh never runs.
const LIVE_RUNNER = 'mods/live/run-tests.sh';
const VIEWER_RUNNER = 'mods/viewer/run-tests.sh'; // the viewer mod shares files with the live mod: a change under either runs both
const RT_RUNNER = 'mods/roundtable/run-tests.sh';
const MOD_RUNNERS = [LIVE_RUNNER, VIEWER_RUNNER, RT_RUNNER];
const LIVE_FILES = ['mods/live/ui.ts', 'mods/live/band.tsx', 'mods/live/locales/en.json', 'mods/live/locales/zh-TW.json',
  'mods/live/gen-locales.js', 'mods/live/run-tests.sh', 'mods/live/ui.test.ts', 'mods/live/ui-lint.test.js'];

test('mods/live: every kind of file under it adds mods/live/run-tests.sh to extra_runners (real tree, --files)', () => {
  for (const f of LIVE_FILES) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', f, '--json'], { stdio: 'pipe' }).toString());
    assert.ok(Array.isArray(out.extra_runners) && out.extra_runners.includes(LIVE_RUNNER), `${f}: extra_runners must name ${LIVE_RUNNER}`);
    assert.ok(out.extra_runners.includes(VIEWER_RUNNER), `${f}: extra_runners must name ${VIEWER_RUNNER}`);
    assert.ok(out.extra_runners.includes(RT_RUNNER), `${f}: extra_runners must name ${RT_RUNNER}`);
    assert.ok(!out.suites.includes(LIVE_RUNNER), `${f}: run.sh suites stay run.sh suites`);
  }
  const text = execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', 'mods/live/ui.ts'], { stdio: 'pipe' }).toString().trim().split('\n');
  assert.deepStrictEqual(text.slice(-3), MOD_RUNNERS, 'text output ends with the runner lines');
});

test('mods/live: runner is present in selective and in full mode; absent for other diffs', () => {
  const r = makeRepo({ ...LAYOUT, 'mods/live/ui.ts': 'export const a = 1;\n', 'mods/live/run-tests.sh': '#!/usr/bin/env bash\n' });
  try {
    const sel = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 2;\n' }));
    assert.deepStrictEqual(sel.extra_runners, MOD_RUNNERS);
    const full = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 3;\n', 'hooks/hooks.json': '{"x":1}\n' }));
    assert.strictEqual(full.mode, 'full');
    assert.deepStrictEqual(full.extra_runners, MOD_RUNNERS);
  } finally { r.cleanup(); }
  const r2 = makeRepo({ ...LAYOUT, 'mods/live/ui.ts': 'export const a = 1;\n' });
  try {
    const plain = r2.select(r2.change({ 'scripts/other.js': 'console.log("c");\n' }));
    assert.deepStrictEqual(plain.extra_runners, []);
  } finally { r2.cleanup(); }
});

test('mods/viewer and mods/register.ts: a change there adds both mod runners (negative control: a script change adds neither)', () => {
  for (const f of ['mods/viewer/show.ts', 'mods/viewer/pane.tsx', 'mods/viewer/model.test.js', 'mods/viewer/run-tests.sh', 'mods/register.ts']) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', f, '--json'], { stdio: 'pipe' }).toString());
    assert.deepStrictEqual(out.extra_runners, MOD_RUNNERS, f);
  }
  const none = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', 'scripts/affected-suites.js', '--json'], { stdio: 'pipe' }).toString());
  assert.deepStrictEqual(none.extra_runners, []);
});

// RED at 8c6ebb6de: --run unknown (exit 2); selective ENOENT order; full mode order ''; docs-only 2 !== 0.
function runCli(dir, args) {
  // A nested `node --test` inherits NODE_TEST_CONTEXT and skips the file (no append, rc 0).
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_TEST_WORKER_ID
  return spawnSync('node', [SEL, '--root', dir, ...args], { encoding: 'utf8', env });
}

test('--run selective: suites then extra_runners, every entry runs after a failure, .test.js uses node --test, .sh uses bash', () => {
  const r = makeRepo({
    ...LAYOUT,
    'hooks/tests/bad.test.sh': '#!/usr/bin/env bash\nprintf bad >> order\nexit 3\n',
    'hooks/tests/ok.test.sh': '#!/usr/bin/env bash\nprintf ok >> order\nexit 0\n',
    'hooks/tests/mentions.test.sh': '#!/usr/bin/env bash\necho mods/live/x.js\nexit 0\n',
    'scripts/unit.test.js': "const fs = require('fs');\nfs.appendFileSync('order', 'js:' + process.execArgv.join(' ') + '\\n');\nconst test = require('node:test');\nconst assert = require('node:assert');\ntest('no', () => assert.strictEqual(1, 2));\n",
    'mods/live/x.js': 'module.exports = 1;\n',
    'mods/live/run-tests.sh': '#!/usr/bin/env bash\nprintf live >> order\nexit 0\n',
    'mods/viewer/run-tests.sh': '#!/usr/bin/env bash\nprintf view >> order\nexit 0\n',
    'mods/roundtable/run-tests.sh': '#!/usr/bin/env bash\nprintf rt >> order\nexit 0\n',
  });
  try {
    const ran = runCli(r.dir, ['--run', '--files', 'hooks/tests/bad.test.sh', 'hooks/tests/ok.test.sh', 'scripts/unit.test.js', 'mods/live/x.js']);
    assert.notStrictEqual(ran.status, 0);
    const order = fs.readFileSync(path.join(r.dir, 'order'), 'utf8');
    assert.match(order, /bad/);
    assert.match(order, /ok/);
    assert.match(order, /js:--test/);
    assert.match(order, /live/);
    assert.match(order, /view/);
    assert.ok(order.indexOf('bad') < order.indexOf('ok'));
    assert.ok(order.indexOf('ok') < order.indexOf('js:'));
    assert.ok(order.indexOf('js:') < order.indexOf('live'));
    assert.ok(order.indexOf('live') < order.indexOf('view'));
    assert.match(ran.stdout, /rc=3 hooks\/tests\/bad\.test\.sh/);
    assert.match(ran.stdout, /rc=0 hooks\/tests\/ok\.test\.sh/);
    assert.match(ran.stdout, /rc=0 mods\/live\/run-tests\.sh/);
    assert.match(ran.stdout, /rc=0 mods\/viewer\/run-tests\.sh/);
    assert.match(ran.stdout, /summary:/);
  } finally { r.cleanup(); }
});

test('--run full mode never executes hooks/tests/run.sh; it prints full_reasons and the defer line and runs always_run plus extra_runners', () => {
  const r = makeRepo({
    ...LAYOUT,
    'hooks/tests/run.sh': '#!/usr/bin/env bash\nprintf UMBRELLA >> order\n',
    'hooks/tests/ok.test.sh': '#!/usr/bin/env bash\nprintf SUITE >> order\n',
    'hooks/tests/check-js-syntax.test.sh': '#!/usr/bin/env bash\nprintf ALWAYS >> order\nexit 0\n',
    'hooks/hooks.json': '{}\n',
    'mods/live/x.js': 'module.exports = 1;\n',
    'mods/live/run-tests.sh': '#!/usr/bin/env bash\nprintf LIVE >> order\nexit 0\n',
    'mods/viewer/run-tests.sh': '#!/usr/bin/env bash\nprintf VIEW >> order\nexit 0\n',
    'mods/roundtable/run-tests.sh': '#!/usr/bin/env bash\nprintf RT >> order\nexit 0\n',
  });
  try {
    const head = r.change({ 'hooks/hooks.json': '{"a":1}\n', 'mods/live/x.js': 'module.exports = 2;\n' });
    const ran = runCli(r.dir, ['--run', '--base', r.base, '--head', head]);
    const order = fs.existsSync(path.join(r.dir, 'order')) ? fs.readFileSync(path.join(r.dir, 'order'), 'utf8') : '';
    assert.ok(!order.includes('UMBRELLA'), order);
    assert.ok(!order.includes('SUITE'), order);
    assert.match(order, /ALWAYS/);
    assert.match(order, /LIVE/);
    assert.match(order, /VIEW/);
    assert.match(ran.stdout, /unjudgeable change: hooks\/hooks\.json/);
    assert.match(ran.stdout, /whole suite deferred to the pre-merge run \(CLAUDE\.md Mission graph verification\)/);
    assert.strictEqual(ran.status, 0);
  } finally { r.cleanup(); }
});

test('--run empty suites: docs-only exits 0; a non-doc empty selection exits non-zero', () => {
  const docs = makeRepo(LAYOUT);
  try {
    const ran = runCli(docs.dir, ['--run', '--files', 'docs/note.md']);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
  } finally { docs.cleanup(); }
  const mirror = makeRepo({ ...LAYOUT, 'platforms/codex/plugin/only.js': 'module.exports = 1;\n' });
  try {
    const ran = runCli(mirror.dir, ['--run', '--files', 'platforms/codex/plugin/only.js']);
    assert.notStrictEqual(ran.status, 0, ran.stdout);
    assert.match(ran.stdout + ran.stderr, /not every changed file is documentation|empty suites/);
  } finally { mirror.cleanup(); }
});

// RED at 143fdd764: 3 fail — mirror pair unreferenced ['scripts/x.sh']; shared referrer unreferenced ['scripts/b.js']; deleted suite unreferenced ['hooks/tests/lone.test.sh'] (each forces full). Orphan case stayed green.
function filesSelect(dir, files) {
  return JSON.parse(execFileSync('node', [SEL, '--root', dir, '--files', ...files, '--json'], { stdio: 'pipe' }).toString());
}

test('a script and its codex mirror changed together are both reached', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/x.sh': 'echo x\n',
    'platforms/codex/plugin/scripts/x.sh': 'echo x\n',
    'hooks/tests/x.test.sh': '#!/usr/bin/env bash\nbash "$ROOT/scripts/x.sh"\n',
  });
  try {
    const out = r.select(r.change({
      'scripts/x.sh': 'echo y\n',
      'platforms/codex/plugin/scripts/x.sh': 'echo y\n',
    }));
    assert.deepStrictEqual(out.unreferenced, []);
    assert.notStrictEqual(out.mode, 'full');
    const script = filesSelect(r.dir, ['scripts/x.sh']);
    const mirror = filesSelect(r.dir, ['platforms/codex/plugin/scripts/x.sh']);
    const both = filesSelect(r.dir, ['scripts/x.sh', 'platforms/codex/plugin/scripts/x.sh']);
    const union = [...new Set([...script.suites, ...mirror.suites])].sort();
    assert.deepStrictEqual(both.suites, union);
  } finally { r.cleanup(); }
});

test('two seeds that share one referrer suite are both reached', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/a.js': 'module.exports = 1;\n',
    'scripts/b.js': 'module.exports = 2;\n',
    'hooks/tests/ab.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/a.js"\nnode "$ROOT/scripts/b.js"\n',
  });
  try {
    const out = r.select(r.change({
      'scripts/a.js': 'module.exports = 3;\n',
      'scripts/b.js': 'module.exports = 4;\n',
    }));
    assert.deepStrictEqual(out.unreferenced, []);
    assert.notStrictEqual(out.mode, 'full');
    assert.ok(out.suites.includes('hooks/tests/ab.test.sh'));
  } finally { r.cleanup(); }
});

test('a deleted suite file is not unreferenced and does not force full', () => {
  const r = makeRepo(LAYOUT);
  try {
    const out = r.select(r.change({ 'hooks/tests/lone.test.sh': null }));
    assert.deepStrictEqual(out.unreferenced, []);
    assert.notStrictEqual(out.mode, 'full');
  } finally { r.cleanup(); }
});

// RED at 30454e703: --record unknown (exit 2, stderr "unknown argument: --record"); shape 2!==0; rc record ENOENT; no-run stderr lacks --run.
function gitSha(dir, ref) {
  return execFileSync('git', ['rev-parse', ref], { cwd: dir, stdio: 'pipe' }).toString().trim();
}

test('--record shape: schema 1, full shas, mode selective, suites are the executed {path, rc, seconds} list', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/rec-ok.js': 'console.log("ok");\n',
    'hooks/tests/rec-ok.test.sh': '#!/usr/bin/env bash\necho scripts/rec-ok.js >/dev/null\nexit 0\n',
  });
  try {
    const head = r.change({ 'scripts/rec-ok.js': 'console.log("changed");\n' });
    const rec = path.join(r.dir, 'qc-record.json');
    const ran = runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--record', rec]);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.strictEqual(doc.schema, 1);
    assert.strictEqual(doc.head, gitSha(r.dir, head));
    assert.strictEqual(doc.base, gitSha(r.dir, r.base));
    assert.strictEqual(doc.mode, 'selective');
    assert.deepStrictEqual(doc.suites.map((s) => [s.path, s.rc, typeof s.seconds]), [['hooks/tests/rec-ok.test.sh', 0, 'number']]);
    assert.match(ran.stdout, /summary: 1 run, 0 failed\nrecord: /);
  } finally { r.cleanup(); }
});

test('--record captures rc: a suite that exits 1 is rc 1 and the command is non-zero; a passing suite is rc 0', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/rc-target.js': 'console.log(1);\n',
    'hooks/tests/rc-fail.test.sh': '#!/usr/bin/env bash\necho scripts/rc-target.js >/dev/null\nexit 1\n',
    'hooks/tests/rc-pass.test.sh': '#!/usr/bin/env bash\necho scripts/rc-target.js >/dev/null\nexit 0\n',
  });
  try {
    const head = r.change({ 'scripts/rc-target.js': 'console.log(2);\n' });
    const rec = path.join(r.dir, 'qc-rc.json');
    const ran = runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--record', rec]);
    assert.notStrictEqual(ran.status, 0);
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.deepStrictEqual(doc.suites.map((s) => [s.path, s.rc]), [['hooks/tests/rc-fail.test.sh', 1], ['hooks/tests/rc-pass.test.sh', 0]]);
  } finally { r.cleanup(); }
});

test('--record without --run exits 2, names --run, writes nothing; default path is git-common-dir/autopilot/qc-runs/<full sha>.json', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/def-rec.js': 'console.log(1);\n',
    'hooks/tests/def-rec.test.sh': '#!/usr/bin/env bash\necho scripts/def-rec.js >/dev/null\nexit 0\n',
  });
  try {
    const missing = path.join(r.dir, 'should-not-exist.json');
    const bad = runCli(r.dir, ['--record', missing]);
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /--run/);
    assert.strictEqual(fs.existsSync(missing), false);
    const head = r.change({ 'scripts/def-rec.js': 'console.log(2);\n' });
    const ok = runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--record']);
    assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
    const sha = gitSha(r.dir, head);
    let common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: r.dir, stdio: 'pipe' }).toString().trim();
    if (!path.isAbsolute(common)) common = path.resolve(r.dir, common);
    const rec = path.join(common, 'autopilot', 'qc-runs', `${sha}.json`);
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.strictEqual(doc.schema, 1);
    assert.strictEqual(doc.head, sha);
    assert.deepStrictEqual(doc.suites.map((s) => [s.path, s.rc]), [['hooks/tests/def-rec.test.sh', 0]]);
    assert.match(ok.stdout, new RegExp(`record: ${rec.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`));
  } finally { r.cleanup(); }
});

// # RED at 06bfd321a: 4 fail — helper glob still selects b.test.sh; mirror seed still selects engine.test.sh; prose plans/evidence still selects plans-loop.test.sh; real tree dev-setup selected 545.
test('BL-0213 helper extensionless directory glob does not select every suite that sources the helper', () => {
  const r = makeRepo({
    ...LAYOUT,
    'hooks/tests/lib.sh': '#!/usr/bin/env bash\nfor f in "$REPO_ROOT"/scripts/*; do ln -s "$f" "$DEST/"; done\n',
    'hooks/tests/a.test.sh': '#!/usr/bin/env bash\nsource "$ROOT/hooks/tests/lib.sh"\nbash "$ROOT/scripts/x.sh"\n',
    'hooks/tests/b.test.sh': '#!/usr/bin/env bash\nsource "$ROOT/hooks/tests/lib.sh"\n',
    'scripts/x.sh': 'echo x\n',
    'scripts/y.sh': 'echo y\n',
    'hooks/tests/y.test.sh': '#!/usr/bin/env bash\nbash "$ROOT/scripts/y.sh"\n',
  });
  try {
    const x = r.select(r.change({ 'scripts/x.sh': 'echo x2\n' }));
    assert.ok(x.suites.includes('hooks/tests/a.test.sh'));
    assert.ok(!x.suites.includes('hooks/tests/b.test.sh'));
    const lib = filesSelect(r.dir, ['hooks/tests/lib.sh']);
    assert.ok(lib.suites.includes('hooks/tests/a.test.sh'));
    assert.ok(lib.suites.includes('hooks/tests/b.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a suite own extensionless directory glob still selects that suite', () => {
  const r = makeRepo({
    ...LAYOUT,
    'hooks/tests/suite-glob.test.sh': '#!/usr/bin/env bash\nfor f in "$ROOT"/scripts/*; do bash "$f"; done\n',
    'scripts/z.sh': 'echo z\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/z.sh': 'echo z2\n' }));
    assert.ok(out.suites.includes('hooks/tests/suite-glob.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 helper glob with an extension still selects a suite that sources the helper', () => {
  const r = makeRepo({
    ...LAYOUT,
    'hooks/tests/lib.sh': '#!/usr/bin/env bash\nfor f in "$REPO_ROOT"/scripts/*.sh; do bash "$f"; done\n',
    'hooks/tests/helper-ext.test.sh': '#!/usr/bin/env bash\nsource "$ROOT/hooks/tests/lib.sh"\n',
    'scripts/w.sh': 'echo w\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/w.sh': 'echo w2\n' }));
    assert.ok(out.suites.includes('hooks/tests/helper-ext.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a platforms mirror seed matches only a literal repo-relative path', () => {
  const mirror = 'platforms/codex/plugin/src/engine/res.js';
  const r = makeRepo({
    ...LAYOUT,
    'src/engine/res.js': 'module.exports = 1;\n',
    [mirror]: 'module.exports = 1;\n',
    'src/engine/engine.js': "const res = require('./res');\nmodule.exports = res;\n",
    'hooks/tests/engine.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/src/engine/engine.js"\n',
    'hooks/tests/mirror-path.test.sh': `#!/usr/bin/env bash\necho ${mirror}\n`,
  });
  try {
    const onlyMirror = filesSelect(r.dir, [mirror]);
    assert.ok(!onlyMirror.suites.includes('hooks/tests/engine.test.sh'));
    assert.ok(onlyMirror.suites.includes('hooks/tests/mirror-path.test.sh'));
    const source = filesSelect(r.dir, ['src/engine/res.js']);
    assert.ok(source.suites.includes('hooks/tests/engine.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 prose category directory names do not select a suite that only names the category', () => {
  const r = makeRepo({
    ...LAYOUT,
    'docs/plans/p.md': '# plan\n',
    'hooks/tests/plans-loop.test.sh': '#!/usr/bin/env bash\nfor f in docs/plans/evidence/; do echo "$f"; done\n',
  });
  try {
    const out = r.select(r.change({
      'docs/plans/p.md': '# edited\n',
      'scripts/other.js': 'console.log("changed");\n',
    }));
    assert.ok(!out.suites.includes('hooks/tests/plans-loop.test.sh'));
    assert.ok(out.suites.includes('hooks/tests/other.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a suite that names a prose file by basename is still selected', () => {
  const r = makeRepo({
    ...LAYOUT,
    'docs/plans/p.md': '# plan\n',
    'hooks/tests/plan-name.test.sh': '#!/usr/bin/env bash\ncat "$ROOT/docs/plans/p.md"\n',
  });
  try {
    const out = r.select(r.change({ 'docs/plans/p.md': '# edited\n', 'scripts/other.js': 'console.log("c");\n' }));
    assert.ok(out.suites.includes('hooks/tests/plan-name.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a dated evidence directory still selects the suite that names it', () => {
  const note = 'docs/plans/evidence/2026-01-01-x/note.md';
  const r = makeRepo({
    ...LAYOUT,
    [note]: '# note\n',
    'hooks/tests/dated-evidence.test.sh': '#!/usr/bin/env bash\nfor f in docs/plans/evidence/2026-01-01-x/; do cat "$f"; done\n',
  });
  try {
    const out = r.select(r.change({ [note]: '# edited\n', 'scripts/other.js': 'console.log("c");\n' }));
    assert.ok(out.suites.includes('hooks/tests/dated-evidence.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a prose category name outside docs/ still selects the suite that names it', () => {
  const note = 'website/plans/p.md';
  const r = makeRepo({
    ...LAYOUT,
    [note]: '# p\n',
    'hooks/tests/site-plan.test.sh': '#!/usr/bin/env bash\ncat "$ROOT/plans/p.md"\n',
  });
  try {
    const out = r.select(r.change({ [note]: '# edited\n', 'scripts/other.js': 'console.log("c");\n' }));
    assert.ok(out.suites.includes('hooks/tests/site-plan.test.sh'));
  } finally { r.cleanup(); }
});

// # RED at 78a293f6a: generic-stem "index" still selected word-index.test.sh; b8bdd61f3 file list selected 461.
test('BL-0213 a suite that shells out to a uniquely named extensionless script is still selected', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/only-once.sh': 'echo once\n',
    'hooks/tests/only-once.test.sh': '#!/usr/bin/env bash\nbash "only-once"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/only-once.sh': 'echo twice\n' }));
    assert.ok(out.suites.includes('hooks/tests/only-once.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a suite that requires a same-stem file with a path is still selected', () => {
  const r = makeRepo({
    ...LAYOUT,
    'src/a/index.js': 'module.exports = 1;\n',
    'src/b/index.js': 'module.exports = 2;\n',
    'hooks/tests/path-index.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/src/a/index"\n',
  });
  try {
    const out = r.select(r.change({ 'src/a/index.js': 'module.exports = 3;\n' }));
    assert.ok(out.suites.includes('hooks/tests/path-index.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a generic stem mention alone does not select a suite', () => {
  const r = makeRepo({
    ...LAYOUT,
    'src/a/index.js': 'module.exports = 1;\n',
    'src/b/index.js': 'module.exports = 2;\n',
    'hooks/tests/word-index.test.sh': '#!/usr/bin/env bash\necho "index"\n',
  });
  try {
    const out = r.select(r.change({ 'src/a/index.js': 'module.exports = 3;\n' }));
    assert.ok(!out.suites.includes('hooks/tests/word-index.test.sh'));
  } finally { r.cleanup(); }
});

// # RED at 2536401a2: comment-only.test.sh still selected; b8bdd61f3 selected 228 (bound 120).
test('BL-0213 a name only in a star-comment line or a block comment does not create an edge', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/target.js': 'module.exports = 1;\n',
    'scripts/comment-only.js': '/**\n * see scripts/target.js in a star line\n */\nconst x = 1;\n/* block scripts/target.js */\n',
    'scripts/real-user.js': "const t = require('./target.js');\n",
    'hooks/tests/comment-only.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/comment-only.js"\n',
    'hooks/tests/real-user.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/real-user.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/target.js': 'module.exports = 2;\n' }));
    assert.ok(!out.suites.includes('hooks/tests/comment-only.test.sh'));
    assert.ok(out.suites.includes('hooks/tests/real-user.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a helper call that reads a named file as data still creates a weak edge', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/target.js': 'module.exports = 1;\n',
    'scripts/reader.js': "function fileContains(rel, needle) { return false; }\nif (fileContains('scripts/target.js', 'marker')) console.log(1);\n",
    'hooks/tests/reader.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/reader.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/target.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/reader.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 real tree: dev-setup, mirror, plan, and the three merges stay under per-revision bounds', () => {
  // --files on this tree (round 1 caps kept): dev-setup.sh measured 39, bound 150;
  // review-resolution mirror measured 22, bound 80; docs plan measured 12, bound 60.
  // Merges use --base <rev>^1 --head <rev> (the mode that produced the counts below), each
  // bound a fraction of stats.total_suites so it grows with the repo.
  // d997355a9 measured 102, bound 0.25 * total_suites (~156). Headroom is for a few restored
  // requires; a slip back toward 300 fails this bound.
  // b8bdd61f3 measured 269, bound 0.5 * total_suites (~312). This merge touches engine core,
  // so half the list is the ceiling; it still rejects "nearly every suite".
  // 3765302f3 measured 83, bound 0.2 * total_suites (~125). A small diff; 0.2 turns red well
  // before the old shared 0.5 cap, where a regression to 300 would have stayed green.
  const run = (files) => JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', ...files, '--json'], { stdio: 'pipe' }).toString());
  const dev = run(['scripts/dev-setup.sh']);
  assert.ok(dev.suites.length < 150, `dev-setup selected ${dev.suites.length}`);
  assert.ok(dev.suites.includes('hooks/tests/dev-setup.test.sh'));
  const mirror = run(['platforms/codex/plugin/src/engine/review-resolution.js']);
  assert.ok(mirror.suites.length < 80, `mirror selected ${mirror.suites.length}`);
  const plan = run(['docs/plans/2026-10-17-review-only-campaign-fix-increment.md']);
  assert.ok(plan.suites.length < 60, `plan selected ${plan.suites.length}`);
  const bounds = { d997355a9: 0.25, b8bdd61f3: 0.5, '3765302f3': 0.2 };
  for (const [rev, fraction] of Object.entries(bounds)) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--base', `${rev}^1`, '--head', rev, '--json'], { stdio: 'pipe' }).toString());
    const cap = out.stats.total_suites * fraction;
    assert.ok(out.stats.selected < cap, `${rev} selected ${out.stats.selected} of ${out.stats.total_suites} (cap ${cap})`);
  }
});

// # RED at 966a3c917: string slash-star wipes the later require; mirror stem count drops the bare name; docs/plans/*.md is skipped as a category glob; dated evidence uses a json seed.
test('BL-0213 a slash-star inside a JS string does not erase a later require', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/needed.js': 'module.exports = 1;\n',
    'scripts/holder.js': "const g = 'scripts/*';\nconst h = dir + '/*';\nconst t = require('./needed.js');\nconst glob = 'docs/**/*.md';\nconst later = 'hooks/tests/**/*.test.sh';\n",
    'hooks/tests/holder.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/holder.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/needed.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/holder.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a bare name still selects when the only duplicate stem is a platforms mirror', () => {
  const r = makeRepo({
    ...LAYOUT,
    'src/engine/review-resolution.js': 'module.exports = 1;\n',
    'platforms/codex/plugin/src/engine/review-resolution.js': 'module.exports = 1;\n',
    'hooks/tests/review-resolution.test.sh': '#!/usr/bin/env bash\nfor m in "review-resolution"; do node "$ROOT/src/engine/$m.js"; done\n',
  });
  try {
    const out = r.select(r.change({ 'src/engine/review-resolution.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/review-resolution.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a docs plan glob with an extension still selects the suite that lints it', () => {
  const r = makeRepo({
    ...LAYOUT,
    'docs/plans/p.md': '# plan\n',
    'hooks/tests/plan-glob.test.sh': '#!/usr/bin/env bash\nfor f in docs/plans/*.md; do bash "$ROOT/scripts/lint-plan.sh" "$f"; done\n',
  });
  try {
    const out = r.select(r.change({ 'docs/plans/p.md': '# edited\n', 'scripts/other.js': 'console.log("c");\n' }));
    assert.ok(out.suites.includes('hooks/tests/plan-glob.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a star line outside a block comment still creates an edge', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/target.js': 'module.exports = 1;\n',
    'scripts/star-line.js': 'const x = 1;\n * scripts/target.js\n',
    'hooks/tests/star-line.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/star-line.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/target.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/star-line.test.sh'));
  } finally { r.cleanup(); }
});

// # RED at f46f0a761: regexp slash-star drops the later require (splitter.test.sh absent); trailing // see /* does the same (noted.test.sh absent). Line-leading JSDoc already created no edge.
test('BL-0213 a slash-star inside a regexp literal does not erase a later require', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/needed.js': 'module.exports = 1;\n',
    'scripts/splitter.js': "const parts = split(/[/*]/);\nconst t = require('./needed.js');\n*/\n",
    'hooks/tests/splitter.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/splitter.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/needed.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/splitter.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a slash-star inside a trailing line comment does not erase a later require', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/needed.js': 'module.exports = 1;\n',
    'scripts/noted.js': "const x = 1; // see /*\nconst t = require('./needed.js');\n*/\n",
    'hooks/tests/noted.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/noted.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/needed.js': 'module.exports = 2;\n' }));
    assert.ok(out.suites.includes('hooks/tests/noted.test.sh'));
  } finally { r.cleanup(); }
});

test('BL-0213 a name mentioned only inside a line-leading JSDoc block creates no edge', () => {
  const r = makeRepo({
    ...LAYOUT,
    'scripts/target.js': 'module.exports = 1;\n',
    'scripts/documented.js': '/**\n * see scripts/target.js\n */\nconst x = 1;\n',
    'hooks/tests/documented.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/documented.js"\n',
  });
  try {
    const out = r.select(r.change({ 'scripts/target.js': 'module.exports = 2;\n' }));
    assert.ok(!out.suites.includes('hooks/tests/documented.test.sh'));
  } finally { r.cleanup(); }
});

// RED at e6fa3b6d7: --budget-seconds unknown (exit 2, stderr "unknown argument: --budget-seconds"), so every budget case below fails.
// BL-0213 time budget: --budget-seconds changes only the run order and when to stop, never which suites are selected.
const BUDGET_LAYOUT = {
  'scripts/lib/a.js': 'module.exports = 1;\n',
  'scripts/b.js': "require('./lib/a.js');\n",
  // Name order is the reverse of distance order: the near suite sorts last.
  'hooks/tests/a-far.test.sh': '#!/usr/bin/env bash\nprintf far1 >> order\nsleep 1\necho scripts/b.js >/dev/null\n',
  'hooks/tests/c-far.test.sh': '#!/usr/bin/env bash\nprintf far2 >> order\nsleep 1\necho scripts/b.js >/dev/null\n',
  'hooks/tests/z-near.test.sh': '#!/usr/bin/env bash\nprintf near >> order\nsleep 1\necho scripts/lib/a.js >/dev/null\n',
};
const BUDGET_ARGS = ['--run', '--files', 'scripts/lib/a.js'];
const readOrder = (dir) => { try { return fs.readFileSync(path.join(dir, 'order'), 'utf8'); } catch { return ''; } };

test('budget: the suite that names the changed file runs first, then farther ones', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const ran = runCli(r.dir, [...BUDGET_ARGS, '--budget-seconds', '600']);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    assert.strictEqual(readOrder(r.dir), 'nearfar1far2');
  } finally { r.cleanup(); }
});

test('budget: after the budget runs out no new suite starts and the skipped ones are listed; exit 3', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const ran = runCli(r.dir, [...BUDGET_ARGS, '--budget-seconds', '1']);
    assert.strictEqual(ran.status, 3, ran.stdout + ran.stderr);
    assert.strictEqual(readOrder(r.dir), 'near');
    assert.match(ran.stdout, /rc=0 hooks\/tests\/z-near\.test\.sh/);
    assert.doesNotMatch(ran.stdout, /rc=\d+ hooks\/tests\/a-far/);
    assert.match(ran.stdout, /skipped_for_budget: 2/);
    assert.match(ran.stdout, /not run \(budget\): hooks\/tests\/a-far\.test\.sh/);
    assert.match(ran.stdout, /not run \(budget\): hooks\/tests\/c-far\.test\.sh/);
  } finally { r.cleanup(); }
});

test('budget: a red suite among the executed ones still exits 1, not 3', () => {
  const r = makeRepo({ ...BUDGET_LAYOUT, 'hooks/tests/z-near.test.sh': '#!/usr/bin/env bash\necho scripts/lib/a.js >/dev/null\nsleep 1\nexit 4\n' });
  try {
    const ran = runCli(r.dir, [...BUDGET_ARGS, '--budget-seconds', '1']);
    assert.strictEqual(ran.status, 1, ran.stdout + ran.stderr);
    assert.match(ran.stdout, /skipped_for_budget: 2/);
  } finally { r.cleanup(); }
});

test('budget: when everything finishes inside the budget the exit code is the ordinary 0', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const ran = runCli(r.dir, [...BUDGET_ARGS, '--budget-seconds', '600']);
    assert.strictEqual(ran.status, 0);
    assert.match(ran.stdout, /skipped_for_budget: 0/);
  } finally { r.cleanup(); }
});

test('budget: without --budget-seconds the run is the base behaviour (name order, no budget lines)', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const ran = runCli(r.dir, BUDGET_ARGS);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    assert.strictEqual(readOrder(r.dir), 'far1far2near');
    assert.doesNotMatch(ran.stdout, /budget/);
    assert.match(ran.stdout, /summary: 3 run, 0 failed/);
  } finally { r.cleanup(); }
});

test('budget: selection is unchanged and --budget-seconds without --run or with a bad value is a usage error', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const plain = runCli(r.dir, ['--files', 'scripts/lib/a.js', '--json']);
    assert.deepStrictEqual(JSON.parse(plain.stdout).suites, ['hooks/tests/a-far.test.sh', 'hooks/tests/c-far.test.sh', 'hooks/tests/z-near.test.sh']);
    const noRun = runCli(r.dir, ['--files', 'scripts/lib/a.js', '--budget-seconds', '5']);
    assert.strictEqual(noRun.status, 2);
    assert.match(noRun.stderr, /--run/);
    for (const bad of ['0', '-3', 'abc', '']) {
      const x = runCli(r.dir, [...BUDGET_ARGS, '--budget-seconds', bad]);
      assert.strictEqual(x.status, 2, `value ${JSON.stringify(bad)}: ${x.stdout}${x.stderr}`);
    }
  } finally { r.cleanup(); }
});

test('budget: --json prints budget, executed and skipped_for_budget; --record stores the same', () => {
  const r = makeRepo(BUDGET_LAYOUT);
  try {
    const head = r.change({ 'scripts/lib/a.js': 'module.exports = 2;\n' });
    const rec = path.join(r.dir, 'qc-record.json');
    const ran = runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--json', '--record', rec, '--budget-seconds', '1']);
    assert.strictEqual(ran.status, 3, ran.stdout + ran.stderr);
    const jsonStart = ran.stdout.lastIndexOf('\n{');
    const out = JSON.parse(ran.stdout.slice(jsonStart + 1, ran.stdout.indexOf('\nrecord: ')));
    assert.strictEqual(out.budget, 1);
    assert.deepStrictEqual(out.executed, ['hooks/tests/z-near.test.sh']);
    assert.deepStrictEqual(out.skipped_for_budget, ['hooks/tests/a-far.test.sh', 'hooks/tests/c-far.test.sh']);
    const doc = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.strictEqual(doc.budget, 1);
    assert.deepStrictEqual(doc.executed, ['hooks/tests/z-near.test.sh']);
    assert.deepStrictEqual(doc.skipped_for_budget, ['hooks/tests/a-far.test.sh', 'hooks/tests/c-far.test.sh']);
    assert.deepStrictEqual(doc.suites.map((s) => [s.path, s.rc]), [['hooks/tests/z-near.test.sh', 0]]);
    // Without a budget the record keeps the schema-1 shape: no budget keys.
    const rec2 = path.join(r.dir, 'qc-record2.json');
    runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--record', rec2]);
    const plain = JSON.parse(fs.readFileSync(rec2, 'utf8'));
    assert.deepStrictEqual(Object.keys(plain), ['schema', 'head', 'base', 'mode', 'suites']);
  } finally { r.cleanup(); }
});

test('budget: at equal distance a suite with a shorter recorded time runs first', () => {
  const r = makeRepo({
    'scripts/lib/a.js': 'module.exports = 1;\n',
    'hooks/tests/a-slow.test.sh': '#!/usr/bin/env bash\nprintf slow >> order\necho scripts/lib/a.js >/dev/null\n',
    'hooks/tests/b-fast.test.sh': '#!/usr/bin/env bash\nprintf fast >> order\necho scripts/lib/a.js >/dev/null\n',
  });
  try {
    const head = r.change({ 'scripts/lib/a.js': 'module.exports = 2;\n' });
    const hist = path.join(r.dir, '.git', 'autopilot', 'qc-runs');
    fs.mkdirSync(hist, { recursive: true });
    fs.writeFileSync(path.join(hist, 'old.json'), JSON.stringify({ schema: 1, head: 'x', base: 'y', mode: 'selective', suites: [{ path: 'hooks/tests/a-slow.test.sh', rc: 0, seconds: 90 }, { path: 'hooks/tests/b-fast.test.sh', rc: 0, seconds: 2 }] }));
    const ran = runCli(r.dir, ['--base', r.base, '--head', head, '--run', '--budget-seconds', '600']);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    assert.strictEqual(readOrder(r.dir), 'fastslow');
  } finally { r.cleanup(); }
});

// RED at 6ef5351df: AssertionError "direct reference must run first" (a-indirect ran before z-direct; both were ranked distance 2 from the selector chain).
test('budget: a direct reference runs before an indirect one even when the selector chain for the direct suite is longer', () => {
  // z-direct names seed.js in text (weak) and also requires bridge.js -> seed.js; the selector keeps the
  // cheaper-cost chain through bridge (2 hops), hiding the direct reference. a-indirect only reaches seed via other.js.
  const r = makeRepo({
    'scripts/seed.js': 'module.exports = 1;\n',
    'scripts/bridge.js': "require('./seed.js');\n",
    'scripts/other.js': "require('./seed.js');\n",
    'scripts/z-direct.test.js': 'console.log("scripts/seed.js"); require("./bridge.js");\n',
    'scripts/a-indirect.test.js': 'require("./other.js");\n',
  });
  try {
    const ran = runCli(r.dir, ['--run', '--files', 'scripts/seed.js', '--budget-seconds', '600']);
    assert.strictEqual(ran.status, 0, ran.stdout + ran.stderr);
    const z = ran.stdout.indexOf('rc=0 scripts/z-direct.test.js');
    const a = ran.stdout.indexOf('rc=0 scripts/a-indirect.test.js');
    assert.ok(z >= 0 && a >= 0, ran.stdout);
    assert.ok(z < a, 'direct reference must run first:\n' + ran.stdout);
    // The selected set is unchanged by the ordering.
    const sel = JSON.parse(runCli(r.dir, ['--files', 'scripts/seed.js', '--json']).stdout);
    assert.deepStrictEqual(sel.suites, ['scripts/a-indirect.test.js', 'scripts/z-direct.test.js']);
  } finally { r.cleanup(); }
});

// ---- --entry-timeout / --attribute ----
function runSel(r, args, opts = {}) {
  return spawnSync('node', [SEL, '--root', r.dir, ...args], { encoding: 'utf8', ...opts });
}
function worktreeLeft(r) {
  return execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: r.dir }).toString().split('\n').filter((l) => l.startsWith('worktree ')).length;
}
const GREEN = '#!/usr/bin/env bash\nexit 0\n';
const RED = '#!/usr/bin/env bash\nexit 1\n';
const TLAYOUT = (a, b) => ({ 'scripts/tool.js': 'x\n', 'hooks/tests/a.test.sh': a, 'hooks/tests/b.test.sh': b });
function touch(r) {
  return r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/a.test.sh': fs.readFileSync(path.join(r.dir, 'hooks/tests/a.test.sh'), 'utf8') + 'echo scripts/tool.js\n', 'hooks/tests/b.test.sh': fs.readFileSync(path.join(r.dir, 'hooks/tests/b.test.sh'), 'utf8') + 'echo scripts/tool.js\n' });
}

test('--entry-timeout kills a sleeping suite, rc 124, marked timeout', () => {
  const r = makeRepo(TLAYOUT('#!/usr/bin/env bash\nsleep 1000\n', GREEN));
  try {
    const head = touch(r);
    const t0 = Date.now();
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--entry-timeout', '1']);
    assert.ok(Date.now() - t0 < 20000);
    assert.match(p.stdout, /rc=124 hooks\/tests\/a\.test\.sh/);
    assert.match(p.stdout, /\(timeout: hooks\/tests\/a\.test\.sh\)/);
    assert.strictEqual(p.status, 1);
  } finally { r.cleanup(); }
});

test('--attribute: red at head and base is preexisting, exit 0, worktree gone, base_rc recorded', () => {
  const r = makeRepo(TLAYOUT(RED, GREEN));
  try {
    const head = touch(r);
    const rec = path.join(r.dir, 'rec.json');
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--attribute', '--record', rec]);
    assert.strictEqual(p.status, 0, p.stdout + p.stderr);
    assert.match(p.stdout, /attribution: preexisting 1: hooks\/tests\/a\.test\.sh/);
    assert.match(p.stdout, /attribution: new 0/);
    assert.strictEqual(worktreeLeft(r), 1);
    const j = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.deepStrictEqual(Object.keys(j), ['schema', 'head', 'base', 'mode', 'suites']);
    const sa = j.suites.find((s) => s.path === 'hooks/tests/a.test.sh');
    assert.deepStrictEqual(Object.keys(sa), ['path', 'rc', 'seconds', 'base_rc']);
    assert.strictEqual(sa.base_rc, 1);
    assert.deepStrictEqual(Object.keys(j.suites.find((s) => s.path === 'hooks/tests/b.test.sh')), ['path', 'rc', 'seconds']);
  } finally { r.cleanup(); }
});

test('--attribute: red only at head is new, exit non-zero', () => {
  const r = makeRepo(TLAYOUT(GREEN, GREEN));
  try {
    const head = r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/a.test.sh': '#!/usr/bin/env bash\necho scripts/tool.js\nexit 1\n', 'hooks/tests/b.test.sh': GREEN + 'echo scripts/tool.js\n' });
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--attribute']);
    assert.strictEqual(p.status, 1);
    assert.match(p.stdout, /attribution: new 1: hooks\/tests\/a\.test\.sh/);
    assert.strictEqual(worktreeLeft(r), 1);
  } finally { r.cleanup(); }
});

test('--attribute: base timeout is unattributed, not preexisting, exit non-zero', () => {
  const r = makeRepo(TLAYOUT('#!/usr/bin/env bash\nsleep 1000\n', GREEN));
  try {
    const head = r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/a.test.sh': '#!/usr/bin/env bash\necho scripts/tool.js\nexit 1\n', 'hooks/tests/b.test.sh': GREEN + 'echo scripts/tool.js\n' });
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--attribute', '--entry-timeout', '1']);
    assert.strictEqual(p.status, 1, p.stdout + p.stderr);
    assert.match(p.stdout, /attribution: preexisting 0/);
    assert.match(p.stdout, /attribution: unattributed 1: hooks\/tests\/a\.test\.sh/);
    assert.strictEqual(worktreeLeft(r), 1);
  } finally { r.cleanup(); }
});

test('--attribute: base exits 124 on its own (no --entry-timeout) is unattributed, not preexisting, exit 1', () => {
  const r = makeRepo(TLAYOUT('#!/usr/bin/env bash\nexit 124\n', GREEN));
  try {
    const head = r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/a.test.sh': '#!/usr/bin/env bash\necho scripts/tool.js\nexit 1\n', 'hooks/tests/b.test.sh': GREEN + 'echo scripts/tool.js\n' });
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--attribute']);
    assert.strictEqual(p.status, 1, p.stdout + p.stderr);
    assert.match(p.stdout, /attribution: preexisting 0/);
    assert.match(p.stdout, /attribution: unattributed 1: hooks\/tests\/a\.test\.sh/);
  } finally { r.cleanup(); }
});

test('--attribute: usage errors without --run / --base', () => {
  const r = makeRepo(TLAYOUT(GREEN, GREEN));
  try {
    assert.strictEqual(runSel(r, ['--base', r.base, '--attribute']).status, 2);
    assert.strictEqual(runSel(r, ['--files', 'scripts/tool.js', '--run', '--attribute']).status, 2);
  } finally { r.cleanup(); }
});

test('--attribute: TERM during the base re-run removes the base worktree', async () => {
  const r = makeRepo(TLAYOUT(RED, GREEN));
  try {
    // sleeps at base only when the marker exists: first run (head) red fast, base re-run hangs
    const slow = '#!/usr/bin/env bash\nif [ -e "$(dirname "$0")/../../.git" ] && [ -f "$(dirname "$0")/../../.git" ]; then sleep 1000; fi\nexit 1\n';
    const base2 = r.change({ 'hooks/tests/a.test.sh': slow }); // new base
    const head = r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/b.test.sh': GREEN + 'echo scripts/tool.js\n', 'hooks/tests/a.test.sh': slow + 'echo scripts/tool.js\n' });
    const { spawn } = require('child_process');
    const c = spawn('node', [SEL, '--root', r.dir, '--base', base2, '--head', head, '--run', '--attribute'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    const deadline = Date.now() + 20000;
    while (worktreeLeft(r) < 2 && Date.now() < deadline) await new Promise((x) => setTimeout(x, 100));
    assert.strictEqual(worktreeLeft(r), 2, 'worktree should exist mid-run: ' + out);
    c.kill('SIGTERM');
    await new Promise((x) => c.on('close', x));
    assert.strictEqual(worktreeLeft(r), 1);
  } finally { r.cleanup(); }
});

test('--attribute + --budget-seconds: preexisting-only failures with a suite skipped for budget exit 3, not 0', () => {
  // a is red at head and base (preexisting) and outlasts the 1s budget, so b never starts.
  const redSlow = '#!/usr/bin/env bash\nsleep 1\nexit 1\n';
  const r = makeRepo(TLAYOUT(redSlow, GREEN));
  try {
    const head = r.change({ 'scripts/tool.js': 'y\n', 'hooks/tests/a.test.sh': redSlow + 'echo scripts/tool.js\n', 'hooks/tests/b.test.sh': GREEN + 'echo scripts/tool.js\n' });
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--attribute', '--budget-seconds', '1']);
    assert.match(p.stdout, /skipped_for_budget: 1/, p.stdout + p.stderr);
    assert.match(p.stdout, /attribution: preexisting 1/);
    assert.match(p.stdout, /attribution: new 0/);
    assert.strictEqual(p.status, 3, p.stdout + p.stderr);
  } finally { r.cleanup(); }
});

test('--entry-timeout: TERM during the head phase kills the running suite process group', async () => {
  const pidfile = (r) => path.join(r.dir, 'child.pid');
  const hang = '#!/usr/bin/env bash\nsleep 1000 &\necho $! > "$(dirname "$0")/../../child.pid"\nwait\n';
  const r = makeRepo(TLAYOUT(hang, GREEN));
  try {
    const head = touch(r);
    const { spawn } = require('child_process');
    const c = spawn('node', [SEL, '--root', r.dir, '--base', r.base, '--head', head, '--run', '--entry-timeout', '1000'], { stdio: 'ignore' });
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(pidfile(r)) && Date.now() < deadline) await new Promise((x) => setTimeout(x, 100));
    await new Promise((x) => setTimeout(x, 200));
    const pid = Number(fs.readFileSync(pidfile(r), 'utf8').trim());
    assert.ok(pid > 0);
    c.kill('SIGTERM');
    const code = await new Promise((x) => c.on('exit', x));
    assert.strictEqual(code, 143);
    await new Promise((x) => setTimeout(x, 300));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    if (alive) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    assert.strictEqual(alive, false, 'suite child must not outlive the TERM');
  } finally { r.cleanup(); }
});

test('negative control: without the new flags no attribution output, no base_rc, usual record keys', () => {
  const r = makeRepo(TLAYOUT(RED, GREEN));
  try {
    const head = touch(r);
    const rec = path.join(r.dir, 'rec.json');
    const p = runSel(r, ['--base', r.base, '--head', head, '--run', '--record', rec]);
    assert.strictEqual(p.status, 1);
    assert.doesNotMatch(p.stdout, /attribution|timeout/);
    assert.match(p.stdout, /summary: 2 run, 1 failed\n/);
    assert.strictEqual(fs.readFileSync(rec, 'utf8').includes('base_rc'), false);
  } finally { r.cleanup(); }
});

// ---- BL-0332: lazy require marker and pseudo-edges ----------------------------------------------
// A mutant is the real selector with one rule switched off; it must select MORE than the real one
// on the same fixture, which is what shows the case can go red.
function mutant(replacements) {
  let src = fs.readFileSync(path.join(__dirname, 'affected-suites.js'), 'utf8');
  for (const [from, to] of replacements) {
    assert.ok(src.includes(from), `mutation anchor missing: ${from}`);
    src = src.replace(from, to);
  }
  const md = fs.mkdtempSync(path.join(os.tmpdir(), 'affected-suites-mutant-'));
  MUTANT_DIRS.push(md);
  const f = path.join(md, 'affected-suites.js');
  // the copy lives outside scripts/, so its layout-registry require must point back at the real file
  fs.writeFileSync(f, src.replace("require('./lib/repo-layout.js')", `require(${JSON.stringify(path.join(__dirname, 'lib', 'repo-layout.js'))})`));
  return f;
}
const MUTANT_DIRS = [];
test.after(() => { for (const d of MUTANT_DIRS) fs.rmSync(d, { recursive: true, force: true }); });
// A mutant must RUN: a crash would turn a case red without showing that the rule's absence over-selects.
function selectWith(bin, r, head) {
  const p = spawnSync('node', [bin, '--root', r.dir, '--base', r.base, '--head', head, '--json'], { stdio: 'pipe' });
  assert.strictEqual(p.status, 0, `mutant crashed: ${p.stderr}`);
  return JSON.parse(p.stdout.toString());
}
const LAZY_LAYOUT = {
  'scripts/lib/watcher.js': 'module.exports = 1;\n',
  'scripts/gate.js': "const on = process.env.GATE_ON;\nfunction start() {\n  if (!on) return;\n  const w = require('./lib/watcher.js'); // affected-suites: lazy\n  return w;\n}\nmodule.exports = { start };\n",
  'scripts/eager.js': "function run() {\n  const w = require('./lib/watcher.js');\n  return w;\n}\nmodule.exports = { run };\n",
  'hooks/tests/gate.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/gate.js"\n',
  'hooks/tests/eager.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/eager.js"\n',
  'hooks/tests/watcher.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/lib/watcher.js"\n',
};

test('lazy require marker: a marked require makes no edge, an unmarked indented one stays strong', () => {
  const r = makeRepo(LAZY_LAYOUT);
  try {
    const head = r.change({ 'scripts/lib/watcher.js': 'module.exports = 2;\n' });
    const out = r.select(head);
    assert.ok(out.suites.includes('hooks/tests/watcher.test.sh'), 'a suite that names the target itself is still selected');
    assert.ok(out.suites.includes('hooks/tests/eager.test.sh'), 'unmarked in-function require keeps its strong edge');
    assert.ok(!out.suites.includes('hooks/tests/gate.test.sh'), 'marked lazy require does not pull in the gate suite');
  } finally { r.cleanup(); }
});

test('negative control: a top-level require is strong even next to the marker text elsewhere', () => {
  const r = makeRepo({ ...LAZY_LAYOUT, 'scripts/top.js': "const w = require('./lib/watcher.js');\nmodule.exports = w;\n", 'hooks/tests/top.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/top.js"\n' });
  try {
    const head = r.change({ 'scripts/lib/watcher.js': 'module.exports = 3;\n' });
    assert.ok(r.select(head).suites.includes('hooks/tests/top.test.sh'));
  } finally { r.cleanup(); }
});

test('negative control: with the marker rule off the gate suite is selected again (case turns red)', () => {
  const r = makeRepo(LAZY_LAYOUT);
  const bin = mutant([["if (!/\\.(js|mjs|cjs)$/.test(file) || !LAZY_MARK.test(raw)) return raw;", 'return raw;']]);
  try {
    const head = r.change({ 'scripts/lib/watcher.js': 'module.exports = 4;\n' });
    assert.ok(!selectWith(SEL, r, head).suites.includes('hooks/tests/gate.test.sh'));
    assert.ok(selectWith(bin, r, head).suites.includes('hooks/tests/gate.test.sh'), 'the mutant must over-select, else the case proves nothing');
  } finally { r.cleanup(); }
});

const VARDIR_LAYOUT = {
  'scripts/gate.js': 'module.exports = 1;\n',
  'hooks/tests/lib.sh': '#!/usr/bin/env bash\nexport GATE_DIR="$TEST_TMP/gate"\n',
  'hooks/tests/uses-lib.test.sh': '#!/usr/bin/env bash\nsource "$HERE/lib.sh"\necho hi\n',
  'hooks/tests/gate.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/gate.js"\n',
};

test('pseudo-edge: "$VAR/name" is a directory under a runtime root, not a mention of name.js', () => {
  const r = makeRepo(VARDIR_LAYOUT);
  try {
    const head = r.change({ 'scripts/gate.js': 'module.exports = 2;\n' });
    assert.deepStrictEqual(r.select(head).suites, ['hooks/tests/gate.test.sh']);
  } finally { r.cleanup(); }
});

test('negative control: with the variable-directory rule off the helper pulls in its sourcing suite', () => {
  const r = makeRepo(VARDIR_LAYOUT);
  const bin = mutant([['if (VAR_DIR_BEFORE.test(', 'if (false && VAR_DIR_BEFORE.test(']]);
  try {
    const head = r.change({ 'scripts/gate.js': 'module.exports = 2;\n' });
    assert.ok(selectWith(bin, r, head).suites.includes('hooks/tests/uses-lib.test.sh'));
  } finally { r.cleanup(); }
});

const HELPER_LAYOUT = {
  'hooks/README.md': 'a\n',
  'hooks/tests/lib.sh': '#!/usr/bin/env bash\ncp "$REPO_ROOT/hooks/README.md" "$sandbox/hooks/README.md"\n',
  'hooks/tests/via-lib.test.sh': '#!/usr/bin/env bash\nsource "$HERE/lib.sh"\necho hi\n',
  'hooks/tests/direct.test.sh': '#!/usr/bin/env bash\ncat "$ROOT/hooks/README.md"\n',
};

test('rule 11: a prose file copied by the shared test helper selects the direct reader, not every sourcing suite', () => {
  const r = makeRepo(HELPER_LAYOUT);
  const bin = mutant([["if (/^(md|txt)$/.test(extOf(p)) && isSharedTestHelper(f)) continue;", '']]);
  try {
    const head = r.change({ 'hooks/README.md': 'b\n' });
    const out = r.select(head);
    assert.strictEqual(out.mode, 'selective');
    assert.ok(out.suites.includes('hooks/tests/direct.test.sh'));
    assert.ok(!out.suites.includes('hooks/tests/via-lib.test.sh'));
    assert.ok(selectWith(bin, r, head).suites.includes('hooks/tests/via-lib.test.sh'), 'rule-11 mutant must over-select');
  } finally { r.cleanup(); }
});

test('marker on a split require() is not recognised: the edge stays strong', () => {
  const r = makeRepo({ ...LAZY_LAYOUT, 'scripts/split.js': "function f() {\n  const w = require(\n    './lib/watcher.js'); // affected-suites: lazy\n  return w;\n}\nmodule.exports = f;\n", 'hooks/tests/split.test.sh': '#!/usr/bin/env bash\nnode "$ROOT/scripts/split.js"\n' });
  try {
    const head = r.change({ 'scripts/lib/watcher.js': 'module.exports = 9;\n' });
    assert.ok(r.select(head).suites.includes('hooks/tests/split.test.sh'));
  } finally { r.cleanup(); }
});

// Real repo: every suite that really runs or names runs-watch must stay selected for a change to it.
const REPO = path.join(__dirname, '..');
const ROOTS = ['hooks', 'scripts', 'mods', 'src'];
// Every test file under the four roots that runs or names runs-watch (git grep, not a hand list).
function textTests(re) {
  const out = spawnSync('git', ['grep', '-lE', re, '--', ...ROOTS], { cwd: REPO, stdio: 'pipe' }).stdout.toString();
  return out.split('\n').filter((f) => /\.test\.(js|ts|sh)$/.test(f) && fs.existsSync(path.join(REPO, f)));
}
function runsWatchSuites() {
  return textTests('AUTOPILOT_RUNS_WATCH_AUTOSTART=1|status runs --watch|startWatcherDetached|runs-watch([^-A-Za-z0-9_]|$)');
}
function missingRunsWatch(bin, seed) {
  const p = spawnSync('node', [bin, '--root', REPO, '--files', seed, '--json'], { stdio: 'pipe', maxBuffer: 1 << 28 });
  assert.strictEqual(p.status, 0, String(p.stderr));
  const out = JSON.parse(p.stdout.toString());
  const sel = new Set(out.suites);
  const runners = out.extra_runners || [];
  return runsWatchSuites().filter((f) => !sel.has(f) && !runners.some((r) => f.startsWith(r.replace(/\/[^/]+$/, '/'))));
}
const RW_SEEDS = ['src/status/runs-watch.js', 'src/status/git-env.js', 'src/status/residue.js'];

test('regression: a change to runs-watch.js, git-env.js or residue.js selects every suite that runs or names runs-watch', () => {
  const want = runsWatchSuites();
  assert.ok(want.includes('hooks/tests/session-mode-watcher.test.sh'), 'derivation must find the watcher suite');
  assert.ok(want.includes('hooks/tests/runs-watch-lock.test.sh') && want.includes('hooks/tests/review-server.test.sh'), 'derivation must find the suites that run `status runs --watch`');
  assert.ok(want.filter((f) => /runs-watch-/.test(f)).length >= 3, 'derivation must find the runs-watch-* suites');
  for (const seed of RW_SEEDS) assert.deepStrictEqual(missingRunsWatch(SEL, seed), [], seed);
});

test('negative control: with every require edge weakened the runs-watch regression goes red for each seed', () => {
  const bin = mutant([["? 'strong' : 'weak');", "? 'weak' : 'weak');"]]);
  for (const seed of RW_SEEDS) assert.ok(missingRunsWatch(bin, seed).length > 0, seed);
});



// Rule 12 removal: a real read of a README or CHANGELOG reaches the suite through its own mention.
function suitesWithText(re) { return textTests(re); }
function missingFor(bin, seed, wanted) {
  const p = spawnSync('node', [bin, '--root', REPO, '--files', seed, '--json'], { stdio: 'pipe', maxBuffer: 1 << 28 });
  assert.strictEqual(p.status, 0, String(p.stderr));
  const sel = new Set(JSON.parse(p.stdout.toString()).suites);
  return wanted.filter((f) => !sel.has(f));
}
test('regression: suites that read a README or CHANGELOG, or load a module by path.join, stay selected', () => {
  const readers = suitesWithText("'hooks', 'README\\.md'");
  assert.ok(readers.includes('hooks/hookq.test.js'), 'derivation must find hookq');
  assert.deepStrictEqual(missingFor(SEL, 'hooks/README.md', readers), []);
  const loaders = suitesWithText("'src', 'runners', 'review'");
  assert.ok(loaders.includes('hooks/tests/autopilot-cli.test.sh'), 'derivation must find autopilot-cli');
  assert.deepStrictEqual(missingFor(SEL, 'src/runners/review.js', loaders), []);
  assert.deepStrictEqual(missingFor(SEL, 'README.md', ['hooks/tests/check-readme-parity.test.sh', ...suitesWithText('setup_sync_version_sandbox')]), []);
  assert.deepStrictEqual(missingFor(SEL, 'CHANGELOG.md', ['hooks/tests/check-plan-graduation.test.sh']), []);
});

// Root README readers, in the two shapes the review found: path.join(__dirname, '..', 'README.md') and path.join(ROOT, 'README.md').
test('fixture: a suite that reads the root README by either path.join shape is selected when README.md changes', () => {
  const r = makeRepo({
    'README.md': 'root\n', 'hooks/README.md': 'hooks\n',
    'hooks/dotdot.test.js': "const fs = require('fs'); const path = require('path');\nfs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');\n",
    'hooks/rootish.test.js': "const fs = require('fs'); const path = require('path');\nfs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');\n",
    'hooks/hooksish.test.js': "const fs = require('fs'); const path = require('path');\nfs.readFileSync(path.join(ROOT, 'hooks', 'README.md'), 'utf8');\n",
  });
  try {
    const out = r.select(r.change({ 'README.md': 'root2\n' }));
    assert.strictEqual(out.mode, 'selective');
    assert.ok(out.suites.includes('hooks/dotdot.test.js') && out.suites.includes('hooks/rootish.test.js'));
  } finally { r.cleanup(); }
});

test('negative control: dropping the suites\' file-name mention edges turns the runs-watch regression red', () => {
  const bin = mutant([['for (const f of graph.byExt.get(b) || []) {', 'for (const f of [...(graph.byExt.get(b) || [])].filter((x) => !isSuite(x))) {']]);
  for (const seed of RW_SEEDS) assert.ok(missingRunsWatch(bin, seed).length > 0, seed);
});

test('negative control: dropping the hooks/README.md mention edge loses hookq', () => {
  const bin = mutant([['for (const f of graph.byExt.get(b) || []) {', 'for (const f of []) {']]);
  assert.ok(missingFor(bin, 'hooks/README.md', ['hooks/hookq.test.js']).length > 0);
});
