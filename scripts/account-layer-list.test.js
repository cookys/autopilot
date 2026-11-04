'use strict';
// Guard: the shared account-layer copy list (hooks/tests/lib/account-layer.list) must cover every relative
// require reachable from scripts/claude-account.js (and lib/eval-account.js). assertCovered is the ONE check;
// the real test and every negative control call it. Negative controls mutate a temp copy / the in-memory list,
// never production code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = __dirname;
const LIST = path.join(SCRIPTS, '..', 'hooks', 'tests', 'lib', 'account-layer.list');
const ENTRIES = ['claude-account.js', 'lib/eval-account.js'];
// Every `require(` call site (not a method call); arg = raw text up to the first ')'.
const CALL = /(?<![\w$.])require\s*\(\s*([^)]*)/g;
const LITERAL = /^(['"])([^'"`\\$]*)\1$/;

function readList() {
  return fs.readFileSync(LIST, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}

// Relative-require closure of the entries (paths relative to root). Fails closed: a require whose argument is not a
// single plain string literal (path.join, template literal, variable...) is a problem, never guessed. Literal
// non-relative specifiers ('fs', 'node:test') are skipped. Test-only fixtures (account-fixtures/) are lazy: excluded.
function closure(root, entries) {
  const seen = new Set();
  const problems = [];
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(CALL)) {
      const line = src.slice(0, m.index).split('\n').length;
      const arg = m[1].trim();
      const lit = LITERAL.exec(arg);
      if (!lit) { problems.push(`${path.relative(root, f)}:${line} non-literal require(${arg})`); continue; }
      if (!/^\.{1,2}\//.test(lit[2])) continue;
      let p = path.resolve(path.dirname(f), lit[2]);
      if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
      if (p.includes('account-fixtures')) continue;
      walk(p);
    }
  };
  for (const e of entries) walk(path.resolve(root, e));
  return { files: [...seen].map((p) => path.relative(root, p)), problems };
}

// The ONE guard: throws unless the closure is fully analysable and every file in it is in the list.
function assertCovered(root, entries, list) {
  const { files, problems } = closure(root, entries);
  const missing = files.filter((f) => !list.includes(f));
  if (problems.length || missing.length) {
    throw new Error(`account layer not covered. non-literal: [${problems.join('; ')}] missing from list: [${missing.join(', ')}]`);
  }
}

function tempCopy(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-layer-guard-'));
  try {
    for (const f of readList().filter((x) => x.endsWith('.js'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS, f), path.join(tmp, f));
    }
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('copy list covers the require closure of claude-account.js and eval-account.js', () => {
  assert.ok(closure(SCRIPTS, ENTRIES).files.length > 5, 'closure walk found the graph');
  assertCovered(SCRIPTS, ENTRIES, readList());
});

test('copy list entries all exist', () => {
  for (const f of readList()) assert.ok(fs.existsSync(path.join(SCRIPTS, f)), f);
});

test('negative control: list missing an entry makes assertCovered throw; restored, it passes', () => {
  const full = readList();
  const cut = full.filter((f) => f !== 'quota-reporter.js');
  assert.throws(() => assertCovered(SCRIPTS, ENTRIES, cut), /missing from list: \[quota-reporter\.js\]/);
  assertCovered(SCRIPTS, ENTRIES, cut.concat('quota-reporter.js'));
});

test('negative control: a new literal relative require in a temp copy makes assertCovered throw', () => {
  tempCopy((tmp) => {
    assertCovered(tmp, ENTRIES, readList());
    fs.writeFileSync(path.join(tmp, 'lib', 'fake-new-dep.js'), 'module.exports = {};\n');
    fs.appendFileSync(path.join(tmp, 'claude-account.js'), "\nrequire('./lib/fake-new-dep');\n");
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /missing from list: \[lib\/fake-new-dep\.js\]/);
  });
});

test('negative control: a non-literal require in a temp copy makes assertCovered throw (fail closed)', () => {
  for (const bad of ["require(path.join(__dirname, 'lib', 'x.js'))", 'require(`./lib/${name}`)', 'require(someVar)']) {
    tempCopy((tmp) => {
      fs.appendFileSync(path.join(tmp, 'claude-account.js'), `\n${bad};\n`);
      assert.throws(() => assertCovered(tmp, ENTRIES, readList()), /non-literal: \[claude-account\.js:\d+ non-literal require\(/);
    });
  }
});

test('literal non-relative requires are skipped, not flagged', () => {
  tempCopy((tmp) => {
    fs.appendFileSync(path.join(tmp, 'claude-account.js'), "\nrequire('node:test'); require(\"fs\");\n");
    assertCovered(tmp, ENTRIES, readList());
  });
});

// Mutation: with the comparison removed from assertCovered, the negative controls must NOT pass (they would
// stop throwing). Done in memory on a copy of the function source; production code untouched.
test('mutation: a guard with its comparison removed fails all three negative controls', () => {
  const src = assertCovered.toString()
    .replace(/const missing = .*;/, 'const missing = [];')
    .replace('problems.length ||', 'false ||');
  assert.notStrictEqual(src, assertCovered.toString());
  const mutated = new Function('closure', `return (${src});`)(closure);
  const cut = readList().filter((f) => f !== 'quota-reporter.js');
  assert.doesNotThrow(() => mutated(SCRIPTS, ENTRIES, cut), 'mutant misses a short list');
  tempCopy((tmp) => {
    fs.appendFileSync(path.join(tmp, 'claude-account.js'), "\nrequire('./lib/fake-new-dep2');\nrequire(path.join(__dirname,'lib','x.js'));\n");
    fs.writeFileSync(path.join(tmp, 'lib', 'fake-new-dep2.js'), 'module.exports = {};\n');
    assert.doesNotThrow(() => mutated(tmp, ENTRIES, readList()), 'mutant misses new + non-literal require');
    assert.throws(() => assertCovered(tmp, ENTRIES, readList()), 'real guard still throws');
  });
});
