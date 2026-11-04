'use strict';
// Guard: the shared account-layer copy list (hooks/tests/lib/account-layer.list) must cover every relative
// require reachable from scripts/claude-account.js. Negative controls mutate a temp copy / the in-memory list,
// never production code.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS = __dirname;
const LIST = path.join(SCRIPTS, '..', 'hooks', 'tests', 'lib', 'account-layer.list');
const RE = /require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

function readList() {
  return fs.readFileSync(LIST, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}
// Relative require closure of entry (paths relative to root). Test-only fixtures (account-fixtures/) are lazy and excluded.
function closure(root, entry) {
  const seen = new Set();
  (function walk(f) {
    if (seen.has(f)) return;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(RE)) {
      let p = path.resolve(path.dirname(f), m[1]);
      if (!fs.existsSync(p) && fs.existsSync(p + '.js')) p += '.js';
      if (p.includes('account-fixtures')) continue;
      walk(p);
    }
  })(path.resolve(root, entry));
  return [...seen].map((p) => path.relative(root, p));
}
const missing = (need, list) => need.filter((f) => !list.includes(f));

test('copy list covers the claude-account.js require closure', () => {
  const need = closure(SCRIPTS, 'claude-account.js');
  assert.ok(need.length > 5, 'closure walk found the graph');
  assert.deepStrictEqual(missing(need, readList()), []);
});

test('copy list entries all exist', () => {
  for (const f of readList()) assert.ok(fs.existsSync(path.join(SCRIPTS, f)), f);
});

test('negative control: dropping an entry turns the guard red, restoring turns it green', () => {
  const need = closure(SCRIPTS, 'claude-account.js');
  const full = readList();
  assert.deepStrictEqual(missing(need, full), []);
  const cut = full.filter((f) => f !== 'quota-reporter.js');
  assert.deepStrictEqual(missing(need, cut), ['quota-reporter.js']);
  assert.deepStrictEqual(missing(need, cut.concat('quota-reporter.js')), []);
});

test('negative control: a new relative require in a temp copy is detected as uncovered', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-layer-guard-'));
  try {
    fs.mkdirSync(path.join(tmp, 'lib'));
    for (const f of readList().filter((x) => x.endsWith('.js'))) {
      fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      fs.copyFileSync(path.join(SCRIPTS, f), path.join(tmp, f));
    }
    assert.deepStrictEqual(missing(closure(tmp, 'claude-account.js'), readList()), []);
    fs.writeFileSync(path.join(tmp, 'lib', 'fake-new-dep.js'), 'module.exports = {};\n');
    fs.appendFileSync(path.join(tmp, 'claude-account.js'), "\nrequire('./lib/fake-new-dep');\n");
    assert.deepStrictEqual(missing(closure(tmp, 'claude-account.js'), readList()), ['lib/fake-new-dep.js']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
