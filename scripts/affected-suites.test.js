'use strict';
// node --test scripts/affected-suites.test.js
// Builds a throwaway git repo with a fixed layout and checks what the selector picks for a diff.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

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
const LIVE_FILES = ['mods/live/ui.ts', 'mods/live/band.tsx', 'mods/live/locales/en.json', 'mods/live/locales/zh-TW.json',
  'mods/live/gen-locales.js', 'mods/live/run-tests.sh', 'mods/live/ui.test.ts', 'mods/live/ui-lint.test.js'];

test('mods/live: every kind of file under it adds mods/live/run-tests.sh to extra_runners (real tree, --files)', () => {
  for (const f of LIVE_FILES) {
    const out = JSON.parse(execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', f, '--json'], { stdio: 'pipe' }).toString());
    assert.ok(Array.isArray(out.extra_runners) && out.extra_runners.includes(LIVE_RUNNER), `${f}: extra_runners must name ${LIVE_RUNNER}`);
    assert.ok(!out.suites.includes(LIVE_RUNNER), `${f}: run.sh suites stay run.sh suites`);
  }
  const text = execFileSync('node', [SEL, '--root', REAL_ROOT, '--files', 'mods/live/ui.ts'], { stdio: 'pipe' }).toString().trim().split('\n');
  assert.strictEqual(text[text.length - 1], LIVE_RUNNER, 'text output ends with the runner line');
});

test('mods/live: runner is present in selective and in full mode; absent for other diffs', () => {
  const r = makeRepo({ ...LAYOUT, 'mods/live/ui.ts': 'export const a = 1;\n', 'mods/live/run-tests.sh': '#!/usr/bin/env bash\n' });
  try {
    const sel = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 2;\n' }));
    assert.deepStrictEqual(sel.extra_runners, [LIVE_RUNNER]);
    const full = r.select(r.change({ 'mods/live/ui.ts': 'export const a = 3;\n', 'hooks/hooks.json': '{"x":1}\n' }));
    assert.strictEqual(full.mode, 'full');
    assert.deepStrictEqual(full.extra_runners, [LIVE_RUNNER]);
  } finally { r.cleanup(); }
  const r2 = makeRepo({ ...LAYOUT, 'mods/live/ui.ts': 'export const a = 1;\n' });
  try {
    const plain = r2.select(r2.change({ 'scripts/other.js': 'console.log("c");\n' }));
    assert.deepStrictEqual(plain.extra_runners, []);
  } finally { r2.cleanup(); }
});
