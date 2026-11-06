'use strict';
require('../../../scripts/lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
// compile-kit validation and mapping, kit sizes, placebo sizes, provenance. Fixtures only; no binary is run.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { compile, validateKit, parseTools } = require('../compile-kit.js');
const { ROOT, ROLES, tmp, rm } = require('./helpers.js');

const kit = (r) => path.join(ROOT, 'kits', r);
const placebo = (r) => path.join(ROOT, 'placebo', r);
const bytes = (f) => fs.statSync(f).size;
const skillFile = (dir) => { const d = path.join(dir, 'plugin/skills'); return fs.existsSync(d) ? path.join(d, fs.readdirSync(d)[0], 'SKILL.md') : null; };

test('every real and placebo kit validates; role cards are <= 2 KB', () => {
  for (const r of ROLES) for (const dir of [kit(r), placebo(r)]) {
    const v = validateKit(dir);
    assert.deepStrictEqual(v.errors, [], dir);
    assert.ok(bytes(path.join(dir, 'role.md')) <= 2048, dir);
  }
});

test('placebo kits: same role.md length and same skill length within 5%, same tools, no shared role-specific words', () => {
  for (const r of ROLES) {
    const a = bytes(path.join(kit(r), 'role.md')); const b = bytes(path.join(placebo(r), 'role.md'));
    assert.ok(Math.abs(a - b) <= 0.05 * a, `${r} role.md ${a} vs ${b}`);
    const ks = skillFile(kit(r)); const ps = skillFile(placebo(r));
    assert.strictEqual(!!ks, !!ps, `${r} plugin presence`);
    if (ks) assert.ok(Math.abs(bytes(ks) - bytes(ps)) <= 0.05 * bytes(ks), `${r} skill ${bytes(ks)} vs ${bytes(ps)}`);
    assert.strictEqual(fs.readFileSync(path.join(kit(r), 'tools'), 'utf8'), fs.readFileSync(path.join(placebo(r), 'tools'), 'utf8'));
    const text = fs.readFileSync(path.join(placebo(r), 'role.md'), 'utf8').toLowerCase();
    for (const w of ['json', 'diff', 'repository', 'test', 'review', 'plan']) assert.ok(!new RegExp(`\\b${w}\\b`).test(text), `placebo ${r} mentions "${w}"`);
  }
});

test('the role cards carry the contract the machine checks read', () => {
  const need = { planner: ['"subtasks"', 'depends_on', 'acceptance'], implementer: ['red_evidence', 'green_evidence'], reviewer: ['"verdict"', 'FIX-THEN-SHIP'], verifier: ['export_path', 'message_token'], debugger: ['root_cause', 'hypotheses'], explorer: ['"answers"', 'citations'] };
  for (const [r, words] of Object.entries(need)) {
    const t = fs.readFileSync(path.join(kit(r), 'role.md'), 'utf8');
    for (const w of words) assert.ok(t.includes(w), `${r} role.md lacks ${w}`);
    for (const h of ['Goal', 'Inputs', 'Done when', 'Escalate']) assert.ok(t.includes(h), `${r} lacks section ${h}`);
  }
});

test('provenance: each copied skill records source path and blob sha, and a verbatim copy hashes to that blob', () => {
  for (const r of ROLES) {
    const sf = path.join(kit(r), 'sources.json');
    if (r === 'reviewer') { assert.ok(!fs.existsSync(sf)); continue; }
    const s = JSON.parse(fs.readFileSync(sf, 'utf8'));
    assert.match(s.source_git_blob, /^[0-9a-f]{40}$/);
    assert.ok(s.source_path && s.base_sha);
    const exists = cp.spawnSync('git', ['-C', ROOT, 'cat-file', '-e', s.source_git_blob]).status === 0;
    assert.ok(exists, `blob ${s.source_git_blob} not in the repository`);
    if (s.transform === 'verbatim copy') {
      const h = cp.execFileSync('git', ['-C', ROOT, 'hash-object', skillFile(kit(r))], { encoding: 'utf8' }).trim();
      assert.strictEqual(h, s.source_git_blob, r);
    }
  }
});

test('compile claude: --tools carries the list (empty list = --tools ""), plugin-dir only when the kit has a plugin', () => {
  const c = compile(kit('reviewer'), 'claude');
  assert.ok(c.ok);
  assert.deepStrictEqual(c.argv.slice(0, 5), ['-p', '--setting-sources', 'project', '--strict-mcp-config', '--system-prompt']);
  assert.strictEqual(c.argv[c.argv.indexOf('--tools') + 1], '');
  assert.ok(!c.argv.includes('--plugin-dir'));
  const d = compile(kit('debugger'), 'claude', { configDir: '/x/cfg' });
  assert.strictEqual(d.argv[d.argv.indexOf('--tools') + 1], 'Read,Grep,Glob,Bash');
  assert.strictEqual(d.argv[d.argv.indexOf('--plugin-dir') + 1], path.join(kit('debugger'), 'plugin'));
  assert.strictEqual(d.env.CLAUDE_CONFIG_DIR, '/x/cfg');
  assert.strictEqual(d.argv[d.argv.indexOf('--system-prompt') + 1], fs.readFileSync(path.join(kit('debugger'), 'role.md'), 'utf8'));
});

test('compile codex and agy: layout files, and the missing allowlist / skill support is a warning, not silence', () => {
  const c = compile(kit('debugger'), 'codex');
  assert.deepStrictEqual(c.files.map((f) => f.to), ['AGENTS.md', 'skills/debug/SKILL.md']);
  assert.ok(c.env.CODEX_HOME);
  assert.ok(c.warnings.some((w) => /no tool allowlist/.test(w)));
  assert.ok(!c.argv.includes('--tools'));
  const a = compile(kit('debugger'), 'agy');
  assert.deepStrictEqual(a.files.map((f) => f.to), ['GEMINI.md']);
  assert.ok(a.env.HOME);
  assert.ok(a.warnings.some((w) => /does not read skills/.test(w)));
  assert.ok(a.warnings.some((w) => /no tool allowlist/.test(w)));
  assert.strictEqual(compile(kit('debugger'), 'nope').ok, false);
});

function copyKit(r) { const d = tmp(); fs.cpSync(kit(r), d, { recursive: true }); return d; }
test('negative controls: each broken kit is rejected with its own reason', () => {
  const cases = [
    ['oversized role.md', (d) => fs.appendFileSync(path.join(d, 'role.md'), 'x'.repeat(2100)), /max 2048/],
    ['missing role.md', (d) => fs.rmSync(path.join(d, 'role.md')), /role\.md missing/],
    ['missing tools', (d) => fs.rmSync(path.join(d, 'tools')), /tools missing/],
    ['unknown tool', (d) => fs.writeFileSync(path.join(d, 'tools'), 'Read,Teleport\n'), /unknown tool/],
    ['two-line tools', (d) => fs.writeFileSync(path.join(d, 'tools'), 'Read\nGrep\n'), /one line/],
    ['duplicate tool', (d) => fs.writeFileSync(path.join(d, 'tools'), 'Read,Read\n'), /duplicate/],
    ['symlink role.md', (d) => { fs.rmSync(path.join(d, 'role.md')); fs.symlinkSync('/etc/hostname', path.join(d, 'role.md')); }, /symlink/],
    ['second skill', (d) => { const s = path.join(d, 'plugin/skills'); fs.cpSync(path.join(s, fs.readdirSync(s)[0]), path.join(s, 'other'), { recursive: true }); }, /exactly one skill/],
    ['stray file in plugin', (d) => fs.writeFileSync(path.join(d, 'plugin/README.md'), 'x'), /stray files/],
    ['no plugin.json', (d) => fs.rmSync(path.join(d, 'plugin/.claude-plugin'), { recursive: true }), /plugin\.json missing/],
    ['unexpected top-level entry', (d) => fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'x'), /unexpected entries/],
  ];
  for (const [name, mutate, re] of cases) {
    const d = copyKit('debugger');
    try { mutate(d); const v = validateKit(d); assert.ok(v.errors.some((e) => re.test(e)), `${name}: ${JSON.stringify(v.errors)}`); assert.strictEqual(compile(d, 'claude').ok, false, name); } finally { rm(d); }
  }
  assert.deepStrictEqual(parseTools('\n'), { tools: [] });
});

test('CLI: prints the mapping and exits 2 on an invalid kit', () => {
  const ok = cp.spawnSync('node', [path.join(ROOT, 'compile-kit.js'), '--kit', kit('planner'), '--runner', 'claude'], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0); assert.match(ok.stdout, /--tools Read,Grep,Glob/);
  const d = copyKit('planner'); fs.rmSync(path.join(d, 'tools'));
  try { assert.strictEqual(cp.spawnSync('node', [path.join(ROOT, 'compile-kit.js'), '--kit', d, '--runner', 'claude'], { encoding: 'utf8' }).status, 2); } finally { rm(d); }
});
