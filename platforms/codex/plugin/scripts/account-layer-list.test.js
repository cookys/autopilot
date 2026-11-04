'use strict';
// Guard: the shared account-layer copy list (hooks/tests/lib/account-layer.list) must cover everything
// scripts/claude-account.js and scripts/lib/eval-account.js load. Two layers, no JS parser:
//  A. token scan (static, fail closed): the only recognised require is `require('<relative or node builtin>')`;
//     ANY other occurrence of require / import( / createRequire / module.require in a closure file is red, comments
//     and strings included, unless that exact whole line is in ALLOW with a reason. Matching is by line text, not number.
//  B. runtime cross-check: a child node requires both entries (never runs main) and every scripts/ file in
//     require.cache must be in the list and in the static closure. Catches any eager load, whatever the syntax.
// assertCovered / assertRuntimeCovered are the ONLY checks; the real tests and every negative control call them.
// Negative controls mutate temp copies / in-memory lists, never production code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { builtinModules } = require('module');

const SCRIPTS = __dirname;
const LIST = path.join(SCRIPTS, '..', 'hooks', 'tests', 'lib', 'account-layer.list');
const ENTRIES = ['claude-account.js', 'lib/eval-account.js'];

// Exact whole-line exceptions: {file (relative to scripts/), line (exact text), reason}. A changed line stops matching.
const MAIN_GUARD = 'standard CLI entry guard: runs main() only when executed directly; a plain require (the layout, guard B) never runs it';
const ALLOW = [
  { file: 'claude-account.js', line: 'if (require.main === module) {', reason: MAIN_GUARD },
  { file: 'lib/account-registry.js', line: 'if (require.main === module) process.exitCode = main(process.argv.slice(2));', reason: MAIN_GUARD },
  { file: 'lib/auth-stop.js', line: 'if (require.main === module) process.exitCode = main(process.argv.slice(2));', reason: MAIN_GUARD },
  { file: 'lib/runtime-paths.js', line: 'if (require.main === module) {', reason: MAIN_GUARD },
];

// The single lazy, test-only require a layout never loads (claude-account.js selftest). Exact file + exact specifier.
const FIXTURE_EXEMPT = { file: 'claude-account.js', spec: './lib/account-fixtures/shim-install', reason: 'lazy test-only selftest fixture; never loaded by a layout' };

const TOKEN = /\brequire\b|\bimport\s*\(|createRequire|module\.require/g;
// Recognised forms, anchored at the token start: require('x') / require("x"), spaces allowed around the literal.
const RECOGNISED = /^require\s*\(\s*(['"])([^'"`\\$]*)\1\s*\)/;
const BUILTINS = new Set(builtinModules.concat(builtinModules.map((m) => `node:${m}`)));

function readList() {
  return fs.readFileSync(LIST, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}

// Static closure of the entries (relative to root) plus every unrecognised token (file:line).
function closure(root, entries, allow = ALLOW) {
  const seen = new Set();
  const problems = [];
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const rel = path.relative(root, f);
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const m of text.matchAll(TOKEN)) {
        const ok = RECOGNISED.exec(text.slice(m.index));
        if (ok && m[0] === 'require') {
          const spec = ok[2];
          if (/^\.{1,2}\//.test(spec)) {
            if (rel === FIXTURE_EXEMPT.file && spec === FIXTURE_EXEMPT.spec) continue;
            let p = path.resolve(path.dirname(f), spec);
            if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
            if (!fs.existsSync(p)) { problems.push(`${rel}:${i + 1} -> missing target ${spec}`); continue; }
            walk(p);
            continue;
          }
          if (BUILTINS.has(spec)) continue;
        }
        if (allow.some((a) => a.file === rel && a.line === text)) continue;
        problems.push(`${rel}:${i + 1} unrecognised ${JSON.stringify(m[0])}: ${text.trim()}`);
      }
    });
  };
  for (const e of entries) walk(path.resolve(root, e));
  return { files: [...seen].map((p) => path.relative(root, p)), problems };
}

// A: throws unless every token is recognised/allowed and every closure file is in the list.
function assertCovered(root, entries, list, allow = ALLOW) {
  const { files, problems } = closure(root, entries, allow);
  const missing = files.filter((f) => !list.includes(f));
  if (problems.length || missing.length) {
    throw new Error(`account layer not covered. tokens: [${problems.join(' | ')}] missing from list: [${missing.join(', ')}]`);
  }
}

// B: files under root actually loaded by requiring the entries in a child (main is never run).
function loadedFiles(root, entries) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-layer-rt-'));
  try {
    const code = 'const r=process.argv[1];for(const e of process.argv.slice(2))require(r+"/"+e);' +
      'console.log(JSON.stringify(Object.keys(require.cache).filter(k=>k.startsWith(r+"/")).map(k=>k.slice(r.length+1))))';
    const out = cp.execFileSync(process.execPath, ['-e', code, root, ...entries], {
      env: { PATH: process.env.PATH, HOME: home, AUTOPILOT_ACCOUNTS_DIR: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
    });
    return JSON.parse(out);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
function assertRuntimeCovered(root, entries, list, staticFiles) {
  const loaded = loadedFiles(root, entries);
  const bad = loaded.filter((f) => !list.includes(f) || !staticFiles.includes(f));
  if (bad.length) throw new Error(`runtime-loaded files not in list and static closure: [${bad.join(', ')}]`);
}

function tempCopy(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-layer-guard-'));
  try {
    for (const f of readList().filter((x) => x.endsWith('.js'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS, f), path.join(tmp, f));
    }
    return fn(tmp);
  } finally { fs.rmSync(path.resolve(tmp), { recursive: true, force: true }); }
}
const append = (tmp, file, text) => fs.appendFileSync(path.join(tmp, file), `\n${text}\n`);

test('A: copy list covers the static closure; no unexplained require-like token', () => {
  assert.ok(closure(SCRIPTS, ENTRIES).files.length > 5, 'closure walk found the graph');
  assertCovered(SCRIPTS, ENTRIES, readList());
});

test('B: everything actually loaded at runtime is in the list and the static closure', () => {
  assertRuntimeCovered(SCRIPTS, ENTRIES, readList(), closure(SCRIPTS, ENTRIES).files);
});

test('list entries all exist; every ALLOW entry still matches a real line (no stale exceptions)', () => {
  for (const f of readList()) assert.ok(fs.existsSync(path.join(SCRIPTS, f)), f);
  for (const a of ALLOW) {
    assert.ok(a.reason && a.reason.length > 10, `reason for ${a.file}`);
    assert.ok(fs.readFileSync(path.join(SCRIPTS, a.file), 'utf8').split('\n').includes(a.line), `stale allow: ${a.file}: ${a.line}`);
  }
});

test('negative control: list missing an entry -> throws; restored -> passes', () => {
  const full = readList();
  const cut = full.filter((f) => f !== 'quota-reporter.js');
  assert.throws(() => assertCovered(SCRIPTS, ENTRIES, cut), /missing from list: \[quota-reporter\.js\]/);
  assertCovered(SCRIPTS, ENTRIES, full);
});

test('negative control: a new literal relative require in a temp copy -> throws', () => {
  tempCopy((tmp) => {
    fs.writeFileSync(path.join(tmp, 'lib', 'fake-new-dep.js'), 'module.exports = {};\n');
    append(tmp, 'claude-account.js', "require('./lib/fake-new-dep');");
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /missing from list: \[lib\/fake-new-dep\.js\]/);
  });
});

test('negative control: a relative require to a missing file -> clear error, not ENOENT', () => {
  tempCopy((tmp) => {
    append(tmp, 'claude-account.js', "require('./lib/not-there');");
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /claude-account\.js:\d+ -> missing target \.\/lib\/not-there/);
  });
});

test('negative control: every evasive spelling -> throws', () => {
  const cases = {
    'comment between': "require/*c*/('./lib/x');",
    'module.require': "module.require('./lib/x');",
    createRequire: "const r = require('module').createRequire(__filename);",
    'dynamic import': "import('./lib/x');",
    'path.join arg': "require(path.join(__dirname, 'lib', 'x.js'));",
    'template literal': 'require(`./lib/${n}`);',
    variable: 'require(someVar);',
  };
  for (const [name, line] of Object.entries(cases)) {
    tempCopy((tmp) => {
      append(tmp, 'claude-account.js', line);
      assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /tokens: \[claude-account\.js:\d+ unrecognised/, name);
    });
  }
});

test('negative control: a token inside a comment is red until allowlisted by its exact line', () => {
  const line = '// require(foo)';
  tempCopy((tmp) => {
    append(tmp, 'claude-account.js', line);
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /unrecognised/);
    assertCovered(tmp, ENTRIES, readList(), ALLOW.concat({ file: 'claude-account.js', line, reason: 'negative-control exception' }));
    const changed = ALLOW.concat({ file: 'claude-account.js', line: line + ' ', reason: 'negative-control exception' });
    assert.throws(() => assertCovered(tmp, ENTRIES, readList(), changed), /unrecognised/, 'a changed line no longer matches');
  });
});

test('negative control: a require inside a string is red (the guard does not judge code vs text)', () => {
  tempCopy((tmp) => {
    append(tmp, 'claude-account.js', 'const s = "require(\'./nope\')";');
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /missing target \.\/nope/);
    append(tmp, 'claude-account.js', 'const t = "say require(x)";');
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /unrecognised/);
  });
});

test('negative control: a lookalike account-fixtures require is NOT exempt and must be in the list', () => {
  tempCopy((tmp) => {
    fs.writeFileSync(path.join(tmp, 'lib', 'account-fixtures-extra.js'), 'module.exports = {};\n');
    append(tmp, 'claude-account.js', "function lazyExtra() { return require('./lib/account-fixtures-extra.js'); }");
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /missing from list: \[lib\/account-fixtures-extra\.js\]/);
  });
});

test('mutation: the exemption widened back to includes() lets the lookalike through', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  assert.ok(src.includes("if (rel === FIXTURE_EXEMPT.file && spec === FIXTURE_EXEMPT.spec) continue;"));
  const wide = src.replace("if (rel === FIXTURE_EXEMPT.file && spec === FIXTURE_EXEMPT.spec) continue;", "if (spec.includes('account-fixtures')) continue;")
    .replace("const SCRIPTS = __dirname;", `const SCRIPTS = ${JSON.stringify(SCRIPTS)};`);
  const tmpFile = path.join(os.tmpdir(), `acct-layer-mut-${process.pid}.test.js`);
  fs.writeFileSync(tmpFile, wide);
  try {
    const r = cp.spawnSync(process.execPath, ['--test', '--test-name-pattern=is NOT exempt', tmpFile], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')) });
    assert.notStrictEqual(r.status, 0, 'mutant must fail the lookalike control');
    assert.match(r.stdout, /not ok|✖/);
  } finally { fs.rmSync(tmpFile, { force: true }); }
});

test('negative control: literal builtin requires are recognised, not flagged', () => {
  tempCopy((tmp) => {
    append(tmp, 'claude-account.js', "require('node:test'); require( \"fs\" );");
    assertCovered(tmp, ENTRIES, readList());
  });
});

test('negative control (runtime): an eager load the token scan cannot see is caught by B', () => {
  tempCopy((tmp) => {
    fs.writeFileSync(path.join(tmp, 'lib', 'fake-eager.js'), 'module.exports = {};\n');
    append(tmp, 'claude-account.js', "module['req' + 'uire']('./lib/fake-eager.js');");
    const stat = closure(tmp, ENTRIES);
    assert.deepStrictEqual(stat.problems, [], 'A is blind to the split spelling');
    assertCovered(tmp, ENTRIES, readList());
    assert.throws(() => assertRuntimeCovered(tmp, ENTRIES, readList(), stat.files), /runtime-loaded files.*lib\/fake-eager\.js/);
  });
});

test('mutation: removing the comparison / the token scan turns the matching controls green-wrong', () => {
  const real = assertCovered.toString();
  const noCompare = new Function('closure', 'ALLOW', `return (${real.replace(/const missing = .*;/, 'const missing = [];').replace('problems.length ||', 'false ||')});`)(closure, ALLOW);
  const cut = readList().filter((f) => f !== 'quota-reporter.js');
  assert.doesNotThrow(() => noCompare(SCRIPTS, ENTRIES, cut), 'mutant (no comparison) misses a short list');
  tempCopy((tmp) => {
    append(tmp, 'claude-account.js', "// require(foo)\nmodule.require('./lib/x');");
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /unrecognised/, 'real guard throws');
    const stub = (root, entries, list) => { // a closure() whose scan finds nothing
      const files = closure(root, entries, [{ file: 'claude-account.js', line: '// require(foo)', reason: 'x' }, { file: 'claude-account.js', line: "module.require('./lib/x');", reason: 'x' }]).files;
      if (files.some((f) => !list.includes(f))) throw new Error('missing');
    };
    assert.doesNotThrow(() => stub(tmp, ENTRIES, readList()), 'mutant (no token scan) lets evasions through');
  });
});
