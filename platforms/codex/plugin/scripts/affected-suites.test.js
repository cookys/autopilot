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
const LIVE_FILES = ['mods/live/ui.ts', 'mods/live/band.tsx', 'mods/live/locales/en.json', 'mods/live/locales/zh-TW.json',
  'mods/live/gen-locales.js', 'mods/live/run-tests.sh', 'mods/live/ui.test.ts', 'mods/live/ui-lint.test.js'];

test('mods/live: every kind of file under it adds mods/live/run-tests.sh to extra_runners (real tree, --files)', () => {
  for (const f of LIVE_FILES) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', f, '--json'], { stdio: 'pipe' }).toString());
    assert.ok(Array.isArray(out.extra_runners) && out.extra_runners.includes(LIVE_RUNNER), `${f}: extra_runners must name ${LIVE_RUNNER}`);
    assert.ok(out.extra_runners.includes(VIEWER_RUNNER), `${f}: extra_runners must name ${VIEWER_RUNNER}`);
    assert.ok(!out.suites.includes(LIVE_RUNNER), `${f}: run.sh suites stay run.sh suites`);
  }
  const text = execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', 'mods/live/ui.ts'], { stdio: 'pipe' }).toString().trim().split('\n');
  assert.deepStrictEqual(text.slice(-2), [LIVE_RUNNER, VIEWER_RUNNER], 'text output ends with the runner lines');
});

test('mods/live: runner is present in selective and in full mode; absent for other diffs', () => {
  const r = makeRepo({ ...LAYOUT, 'mods/live/ui.ts': 'export const a = 1;\n', 'mods/live/run-tests.sh': '#!/usr/bin/env bash\n' });
  try {
    const sel = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 2;\n' }));
    assert.deepStrictEqual(sel.extra_runners, [LIVE_RUNNER, VIEWER_RUNNER]);
    const full = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 3;\n', 'hooks/hooks.json': '{"x":1}\n' }));
    assert.strictEqual(full.mode, 'full');
    assert.deepStrictEqual(full.extra_runners, [LIVE_RUNNER, VIEWER_RUNNER]);
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
    assert.deepStrictEqual(out.extra_runners, [LIVE_RUNNER, VIEWER_RUNNER], f);
  }
  const none = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', 'scripts/affected-suites.js', '--json'], { stdio: 'pipe' }).toString());
  assert.deepStrictEqual(none.extra_runners, []);
});

// RED at 8c6ebb6de: --run unknown (exit 2); selective ENOENT order; full mode order ''; docs-only 2 !== 0.
function runCli(dir, args) {
  return spawnSync('node', [SEL, '--root', dir, ...args], { encoding: 'utf8' });
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

test('--record shape: schema 1, full shas, mode selective, suites are the executed {path, rc} list', () => {
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
    assert.deepStrictEqual(doc.suites, [{ path: 'hooks/tests/rec-ok.test.sh', rc: 0 }]);
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
    assert.deepStrictEqual(doc.suites, [
      { path: 'hooks/tests/rc-fail.test.sh', rc: 1 },
      { path: 'hooks/tests/rc-pass.test.sh', rc: 0 },
    ]);
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
    assert.deepStrictEqual(doc.suites, [{ path: 'hooks/tests/def-rec.test.sh', rc: 0 }]);
    assert.match(ok.stdout, new RegExp(`record: ${rec.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}`));
  } finally { r.cleanup(); }
});
