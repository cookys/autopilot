#!/usr/bin/env node
'use strict';
// G37 N8 (plan 6, 8 P6): the spawn-site gate. Tempdir fixture trees only; the real tree is only READ (no claude is run).
//  - the registry on the real tree is clean (the gate is green on the tree)
//  - red-first: a fixture tree with one unregistered `claude -p` line is blocked (unregistered_claude_spawn);
//    a wired file with its account-layer call removed is blocked (wired_site_not_wired)
//  - each detection shape fires, and a comment-only mention does not
//  - registry hygiene: stale entry, short reason, unknown key, frozen lock that does not name the file, wired without coverage
//  - mutation: a detector with no shapes, and an account-layer regex that matches everything, make the blocked cases pass
//    wrongly - i.e. the cases above really depend on those two pieces
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'check-claude-spawn-sites.js');
const REPO = path.resolve(__dirname, '..');

function mkTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g37-spawn-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}
function writeRegistry(root, doc) {
  const f = path.join(root, 'scripts', 'lib', 'claude-spawn-sites.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(doc));
}
function run(root, script) {
  const r = spawnSync(process.execPath, [script || SCRIPT, '--root', root, '--json'], { encoding: 'utf8', timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch (_) { /* leave null */ }
  return { code: r.status, out, stderr: r.stderr, codes: out ? out.findings.map((f) => f.code) : [] };
}

/** A clean fixture: one wired rail, one out_of_scope probe, one frozen runner with its lock, one reviewed non-spawn. */
function baseTree() {
  const root = mkTree({
    'scripts/rail.sh': '#!/bin/sh\nnode "$DIR/claude-account.js" run --purpose t -- claude -p hi\n',
    'scripts/rail.test.sh': '# covers rail.sh\n',
    'scripts/ver.sh': '#!/bin/sh\nclaude --version\n',
    'evals/frozen-run.sh': '#!/bin/sh\nclaude -p hi\n',
    'evals/FROZEN.json': '{"files":{"frozen-run.sh":"abc"}}\n',
    'scripts/reader.js': '// reads a `claude -p` transcript\nmodule.exports = {};\n',
  });
  writeRegistry(root, {
    schema_version: 1,
    sites: [
      { file: 'scripts/rail.sh', status: 'wired', group: 'T', covered_by: ['scripts/rail.test.sh'] },
      { file: 'scripts/ver.sh', status: 'out_of_scope', reason: 'reads claude --version only, no model call' },
      { file: 'evals/frozen-run.sh', status: 'frozen_legacy', reason: 'digest-frozen replay runner, never wired', locked_by: 'evals/FROZEN.json' },
    ],
    reviewed_non_spawns: [{ file: 'scripts/reader.js', reason: 'reads a transcript; the string appears only in a comment' }],
  });
  return root;
}
const edit = (root, rel, fn) => { const p = path.join(root, rel); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };

test('the real tree is clean: every claude spawn site is registered, wired files are wired and covered', () => {
  const r = run(REPO);
  assert.deepStrictEqual(r.codes, [], JSON.stringify(r.out && r.out.findings));
  assert.strictEqual(r.code, 0);
  assert.ok(r.out.sites >= 50, `suspiciously few registered sites: ${r.out.sites}`);
  for (const st of ['wired', 'out_of_scope', 'frozen_legacy']) assert.ok(r.out.by_status[st] > 0, `no ${st} entry`);
});

test('baseline fixture is green', () => {
  const r = run(baseTree());
  assert.deepStrictEqual(r.codes, []);
  assert.strictEqual(r.code, 0);
});

test('N8 red: an unregistered `claude -p` line in a new file is blocked', () => {
  const root = baseTree();
  fs.writeFileSync(path.join(root, 'scripts', 'new-probe.sh'), '#!/bin/sh\nclaude -p "hello" --model haiku\n');
  const r = run(root);
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(r.codes, ['unregistered_claude_spawn']);
  assert.strictEqual(r.out.findings[0].file, 'scripts/new-probe.sh');
});

test('N8 red: a wired file whose account-layer call was removed is blocked', () => {
  const root = baseTree();
  edit(root, 'scripts/rail.sh', (t) => t.replace('node "$DIR/claude-account.js" run --purpose t -- ', ''));
  const r = run(root);
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(r.codes, ['wired_site_not_wired']);
});

test('an account-layer name that only appears in a comment does not make a file wired', () => {
  const root = baseTree();
  edit(root, 'scripts/rail.sh', (t) => `# uses claude-account.js\n${t.replace('node "$DIR/claude-account.js" run --purpose t -- ', '')}`);
  assert.deepStrictEqual(run(root).codes, ['wired_site_not_wired']);
});

const SHAPE_CASES = [
  ['S1 command line', 'scripts/a.sh', 'timeout 60 claude -p "x"\n', true],
  ['S1 plugin subcommand', 'scripts/a.sh', 'claude plugin validate .\n', true],
  ['S2 spawnSync literal', 'scripts/a.js', "cp.spawnSync('claude', ['--version']);\n", true],
  ['S2 execFile literal', 'scripts/a.js', "execFileSync(\"claude\", args);\n", true],
  ['S3 argv0 array', 'scripts/a.js', "const argv = ['claude', '-p'];\n", true],
  ['S4 binary seam', 'scripts/a.js', 'const bin = process.env.QC_CLAUDE_BIN || x;\n', true],
  ['S4 REAL_CLAUDE', 'scripts/a.sh', 'exec "$REAL_CLAUDE" "$@"\n', true],
  ['S5 exec claude', 'scripts/a.sh', 'exec claude "$@"\n', true],
  ['S6 quoted claude then flag', 'scripts/a.js', "sh(ctx, ['timeout', '90', 'claude', '-p']);\n", true],
  ['S7 account layer reference', 'scripts/a.js', "require('./lib/account-rail');\n", true],
  ['S8 claude-only flag', 'scripts/a.js', "const a = ['--strict-mcp-config'];\n", true],
  ['comment only (#)', 'scripts/a.sh', '# claude -p is used elsewhere\n', false],
  ['comment only (//)', 'scripts/a.js', "// spawnSync('claude', [])\n", false],
  ['comment only (*)', 'scripts/a.js', '/*\n * claude -p example\n */\n', false],
  ['prose word claude', 'scripts/a.js', "const s = 'ask claude for help';\n", false],
  ['file in a tests dir is not scanned', 'hooks/tests/a.sh', 'claude -p x\n', false],
  ['*.test.js is not scanned', 'scripts/a.test.js', "spawnSync('claude', [])\n", false],
];
for (const [name, rel, body, expectHit] of SHAPE_CASES) {
  test(`shape: ${name} -> ${expectHit ? 'flagged' : 'ignored'}`, () => {
    const root = baseTree();
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
    const r = run(root);
    assert.deepStrictEqual(r.codes, expectHit ? ['unregistered_claude_spawn'] : [], JSON.stringify(r.out.findings));
  });
}

test('registry hygiene: each malformed entry is reported under its own code', () => {
  const cases = [
    ['stale_entry', (d) => d.sites.push({ file: 'scripts/gone.sh', status: 'out_of_scope', reason: 'this file was removed from the tree' })],
    ['bad_entry', (d) => { d.sites[1].reason = 'short'; }],
    ['bad_entry', (d) => { d.sites[1].colour = 'blue'; }],
    ['bad_entry', (d) => { d.sites[1].status = 'maybe'; }],
    ['bad_entry', (d) => d.sites.push(Object.assign({}, d.sites[1]))],
    ['frozen_lock_missing', (d) => { d.sites[2].locked_by = 'scripts/rail.test.sh'; }],
    ['frozen_lock_missing', (d) => { delete d.sites[2].locked_by; }],
    ['wired_site_not_covered', (d) => { d.sites[0].covered_by = []; }],
    ['wired_site_not_covered', (d) => { d.sites[0].covered_by = ['scripts/not-there.test.sh']; }],
  ];
  for (const [code, mutate] of cases) {
    const root = baseTree();
    const f = path.join(root, 'scripts', 'lib', 'claude-spawn-sites.json');
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    mutate(doc);
    writeRegistry(root, doc);
    const r = run(root);
    assert.strictEqual(r.code, 1, `${code}: expected exit 1`);
    assert.ok(r.codes.includes(code), `${code}: got ${r.codes.join(',')}`);
  }
});

test('a covering test that does not name the file is not coverage', () => {
  const root = baseTree();
  fs.writeFileSync(path.join(root, 'scripts', 'rail.test.sh'), '# covers something else\n');
  assert.deepStrictEqual(run(root).codes, ['wired_site_not_covered']);
});

test('a reviewed non-spawn that gains a spawn shape is reported', () => {
  const root = baseTree();
  edit(root, 'scripts/reader.js', (t) => `${t}require('child_process').spawnSync('claude', ['-p']);\n`);
  assert.deepStrictEqual(run(root).codes, ['reviewed_non_spawn_spawns']);
});

test('a shipped Codex plugin payload (.codex-plugin/ at the root) is skipped with a note, not failed as stale', () => {
  const root = mkTree({ 'scripts/lib/x.js': '// nothing\n', '.codex-plugin/plugin.json': '{}\n' });
  writeRegistry(root, { schema_version: 1, sites: [{ file: 'evals/gone.sh', status: 'out_of_scope', reason: 'this file lives only in the development tree' }] });
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /skipped/);
  // the same registry in a development tree (no .codex-plugin/) is a stale entry
  fs.rmSync(path.join(root, '.codex-plugin'), { recursive: true });
  assert.deepStrictEqual(run(root).codes, ['stale_entry']);
});

test('an unreadable or malformed registry is exit 2, never a pass', () => {
  const root = baseTree();
  fs.writeFileSync(path.join(root, 'scripts', 'lib', 'claude-spawn-sites.json'), '{not json');
  const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /cannot read registry/);
  const r2 = spawnSync(process.execPath, [SCRIPT, '--root', path.join(root, 'nowhere')], { encoding: 'utf8' });
  assert.strictEqual(r2.status, 2);
});

test('mutation: a detector with no shapes lets the unregistered spawn through (so the N8 red case depends on the shapes)', () => {
  const mut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g37-spawn-mut-')), 'check.js');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(src.includes('const SHAPES = ['));
  fs.writeFileSync(mut, src.replace('const SHAPES = [', 'const SHAPES = []; const _UNUSED = ['));
  const root = baseTree();
  fs.writeFileSync(path.join(root, 'scripts', 'new-probe.sh'), 'claude -p "hello"\n');
  assert.deepStrictEqual(run(root).codes, ['unregistered_claude_spawn']);
  assert.deepStrictEqual(run(root, mut).codes, [], 'the mutated detector should be blind');
});

test('mutation: an account-layer regex that matches everything lets the unwired file through', () => {
  const mut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g37-spawn-mut-')), 'check.js');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.ok(/const ACCOUNT_LAYER = \/.*\/;/.test(src));
  fs.writeFileSync(mut, src.replace(/const ACCOUNT_LAYER = \/.*\/;/, 'const ACCOUNT_LAYER = /[\\s\\S]*/;'));
  const root = baseTree();
  edit(root, 'scripts/rail.sh', (t) => t.replace('node "$DIR/claude-account.js" run --purpose t -- ', ''));
  assert.deepStrictEqual(run(root).codes, ['wired_site_not_wired']);
  assert.deepStrictEqual(run(root, mut).codes, [], 'the mutated check should accept the unwired file');
});


/** The fixture gets a copy of the checker (validate.sh runs it from its own dir); like the real tree, it registers itself. */
function installChecker(root) {
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts', 'check-claude-spawn-sites.js'));
  const f = path.join(root, 'scripts', 'lib', 'claude-spawn-sites.json');
  const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
  doc.sites.push({ file: 'scripts/check-claude-spawn-sites.js', status: 'out_of_scope', reason: 'the gate itself: its patterns contain the strings it looks for' });
  writeRegistry(root, doc);
}

test('validate.sh runs the gate: green on a clean fixture, red once an unregistered `claude -p` appears', () => {
  const root = baseTree();
  fs.mkdirSync(path.join(root, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
  fs.copyFileSync(path.join(REPO, 'scripts', 'validate.sh'), path.join(root, 'scripts', 'validate.sh'));
  installChecker(root);
  const run1 = () => spawnSync('bash', [path.join(root, 'scripts', 'validate.sh')], { encoding: 'utf8', timeout: 60000 });
  const green = run1();
  assert.strictEqual(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /PASS {2}claude spawn sites/);
  fs.writeFileSync(path.join(root, 'scripts', 'new-probe.sh'), 'claude -p "hello"\n');
  const red = run1();
  assert.strictEqual(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stdout, /FAIL {2}claude spawn sites/);
  assert.match(red.stderr, /unregistered_claude_spawn/);
});

test('validate.sh mutation: with the gate call removed the same unregistered file passes (so the red case above depends on the hook-in)', () => {
  const root = baseTree();
  fs.mkdirSync(path.join(root, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: d\n---\nbody\n');
  const src = fs.readFileSync(path.join(REPO, 'scripts', 'validate.sh'), 'utf8');
  assert.ok(src.includes('check-claude-spawn-sites.js'));
  fs.writeFileSync(path.join(root, 'scripts', 'validate.sh'), src.replace('node "$SCRIPT_DIR/check-claude-spawn-sites.js"', 'true'));
  installChecker(root);
  fs.writeFileSync(path.join(root, 'scripts', 'new-probe.sh'), 'claude -p "hello"\n');
  const r = spawnSync('bash', [path.join(root, 'scripts', 'validate.sh')], { encoding: 'utf8', timeout: 60000 });
  assert.strictEqual(r.status, 0, 'the mutated validate.sh should not notice the new spawn');
});
