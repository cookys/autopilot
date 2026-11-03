'use strict';
// G37 N11 static check: no autopilot hook may serialise or print the whole process.env (it would carry the
// account token). A violation is `process.env` itself - or a spread / Object.assign / destructured-rest copy of
// it, or an alias variable holding it or such a copy - reaching ANY output sink: JSON.stringify, util.inspect,
// console.*, stdout/stderr write, fs write/append, String(), util.format.
// Reading ONE variable (process.env.X, process.env['X']) is never a violation, and neither is copying the env
// into a child's spawn options (a copy that is not serialised). Known limits (documented, not hidden): an env
// object passed through a function parameter, or built key by key, is not followed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Scan scope: every .js under hooks/ including all subdirectories, minus this explicit exclusion list.
// tests/ holds test code and its fixtures; fixtures/ holds recorded payloads. Both are not hook code.
const HOOKS_DIR = __dirname;
const EXCLUDED_DIRS = ['tests', 'fixtures', 'node_modules'];
const EXCLUDED_FILE = /\.test\.js$/;

const ID = '[A-Za-z_$][\\w$]*';
// `process.env` NOT followed by a single-variable access (.X, ?.X, ['X'])
const BARE_PROCESS_ENV = /\bprocess\s*\.\s*env\b(?!\s*(?:\?\.\s*[A-Za-z_$]|\.\s*[A-Za-z_$]|\[))/;
const SINKS = [
  /\bJSON\s*\.\s*stringify\s*\(/g,
  /\b(?:util\s*\.\s*)?inspect\s*\(/g,
  /\b(?:util\s*\.\s*)?format\s*\(/g,
  /\bdump\s*\(/g,
  /\bconsole\s*\.\s*\w+\s*\(/g,
  /\bprocess\s*\.\s*(?:stdout|stderr)\s*\.\s*write\s*\(/g,
  /\b(?:fs\s*\.\s*)?(?:writeFileSync|appendFileSync|writeFile|appendFile|writeSync|write)\s*\(/g,
  /\bString\s*\(/g,
];

/** The text between the paren opened at src[open] and its match (quote-aware, no regex literals). */
function balanced(src, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1);
}

/** Expression text after `=` at index `from`, up to `;` or a newline at depth 0. */
function exprAfter(src, from) {
  let depth = 0;
  let q = null;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '\\') i++;
      else if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth <= 0 && (ch === ';' || ch === '\n')) return src.slice(from, i);
  }
  return src.slice(from);
}

const identBare = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\b(?!\\s*(?:\\?\\.\\s*[A-Za-z_$]|\\.\\s*[A-Za-z_$]|\\[))`);

/** Does this expression text carry the whole env (process.env, or a tainted alias/copy)? */
function carriesEnv(text, tainted) {
  // names only (Object.keys) never carries a value
  const t = text.replace(/Object\s*\.\s*keys\s*\(\s*[\w$.]+\s*\)/g, '');
  if (BARE_PROCESS_ENV.test(t)) return true;
  for (const name of tainted) if (identBare(name).test(t)) return true;
  return false;
}

/**
 * Is this right-hand side itself the env or a copy of it (not merely a call that is handed the env)?
 * carrier | carrier || x | { ...carrier } | Object.assign/fromEntries/entries/values(... carrier) |
 * structuredClone(carrier) | JSON.parse(JSON.stringify(carrier)).
 */
function isEnvCopy(rhs, tainted) {
  const r = rhs.trim().replace(/^\(+|\)+$/g, '').trim();
  if (!r || !carriesEnv(r, tainted)) return false;
  const carrier = `(?:process\\s*\\.\\s*env\\b(?!\\s*(?:\\?\\.\\s*[A-Za-z_$]|\\.\\s*[A-Za-z_$]|\\[))${[...tainted].map((n) => `|(?<![\\w$.])${n.replace(/\$/g, '\\$')}\\b(?!\\s*(?:\\?\\.\\s*[A-Za-z_$]|\\.\\s*[A-Za-z_$]|\\[))`).join('')})`;
  const pats = [
    new RegExp(`^${carrier}\\s*(?:(?:\\|\\||\\?\\?)[\\s\\S]*)?$`),
    new RegExp(`^[{\\[][\\s\\S]*\\.\\.\\.\\s*${carrier}`),
    /^(?:Object\s*\.\s*(?:assign|fromEntries|entries|values)|structuredClone)\s*\(/,
    /^JSON\s*\.\s*parse\s*\(\s*JSON\s*\.\s*stringify\s*\(/,
  ];
  return pats.some((re) => re.test(r));
}

/** Variables that alias or copy the whole env, to a fixpoint. */
function taintedNames(src) {
  const tainted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    const add = (n) => { if (n && !tainted.has(n)) { tainted.add(n); changed = true; } };
    // const/let/var NAME = <env or a copy of it>   and   NAME = <...>
    for (const m of src.matchAll(new RegExp(`(?:\\b(?:const|let|var)\\s+)?(${ID})\\s*=(?![=>])`, 'g'))) {
      if (isEnvCopy(exprAfter(src, m.index + m[0].length), tainted)) add(m[1]);
    }
    // const { A, ...rest } = <env or a copy>
    for (const m of src.matchAll(/\{([^{}]*)\}\s*=(?![=>])/g)) {
      const rest = /\.\.\.\s*([A-Za-z_$][\w$]*)/.exec(m[1]);
      if (rest && isEnvCopy(exprAfter(src, m.index + m[0].length), tainted)) add(rest[1]);
    }
    // Object.assign(NAME, <env carrier>...)  mutates NAME into a copy
    for (const m of src.matchAll(/Object\s*\.\s*assign\s*\(/g)) {
      const args = balanced(src, m.index + m[0].length - 1);
      const first = new RegExp(`^\\s*(${ID})\\s*,`).exec(args);
      if (first && carriesEnv(args.slice(first[0].length), tainted)) add(first[1]);
    }
  }
  return tainted;
}

/** Findings for one source text: [{ sink, arg }]. */
function scan(src) {
  const tainted = taintedNames(src);
  const out = [];
  for (const re of SINKS) {
    re.lastIndex = 0;
    for (const m of src.matchAll(re)) {
      const arg = balanced(src, m.index + m[0].length - 1);
      if (carriesEnv(arg, tainted)) out.push({ sink: m[0].replace(/\s+/g, ''), arg: arg.slice(0, 80) });
    }
  }
  return out;
}

function hookFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(e.name)) out.push(...hookFiles(p));
    } else if (e.name.endsWith('.js') && !EXCLUDED_FILE.test(e.name)) out.push(p);
  }
  return out;
}

function findings(files, base) {
  const out = [];
  for (const f of files) for (const x of scan(fs.readFileSync(f, 'utf8'))) out.push(`${path.relative(base || HOOKS_DIR, f)}: ${x.sink}(${x.arg})`);
  return out;
}

test('scan scope covers hooks/ subdirectories, with an explicit exclusion list', () => {
  const files = hookFiles(HOOKS_DIR).map((f) => path.relative(HOOKS_DIR, f));
  assert.ok(files.some((f) => f.includes(path.sep)), 'at least one hook below hooks/ top level is scanned');
  assert.ok(files.some((f) => f.startsWith('_shared' + path.sep)) || files.some((f) => f.startsWith('lib' + path.sep)));
  assert.ok(!files.some((f) => f.startsWith('tests' + path.sep) || f.startsWith('fixtures' + path.sep)), 'excluded dirs are not scanned');
  assert.deepStrictEqual(EXCLUDED_DIRS, ['tests', 'fixtures', 'node_modules']);
});

test('no hook serialises process.env wholesale (hooks/ and every subdirectory)', () => {
  assert.deepStrictEqual(findings(hookFiles(HOOKS_DIR)), []);
});

// Every shape the old checker missed, plus the old ones. Each must be flagged.
const NEG = {
  'JSON.stringify(process.env)': "require('fs').writeFileSync('/x', JSON.stringify(process.env));",
  'console.log(JSON.stringify({ ...process.env }))': 'console.log(JSON.stringify({ ...process.env }));',
  'spread outside a write call': "const out = JSON.stringify({ a: 1, ...process.env }); require('fs').writeFileSync('/x', out);",
  'alias then serialise': 'const env = process.env;\nconsole.log(JSON.stringify(env));',
  'alias then serialise with indent': 'const e = process.env\nprocess.stdout.write(JSON.stringify(e, null, 2));',
  'spread copy then serialise': "const copy = { ...process.env };\nrequire('fs').appendFileSync('/x', JSON.stringify(copy));",
  'Object.assign copy then serialise': 'const c = Object.assign({}, process.env);\nprocess.stderr.write(JSON.stringify(c));',
  'Object.assign into existing then serialise': 'const c = {};\nObject.assign(c, process.env);\nconsole.error(JSON.stringify(c));',
  'destructured rest then serialise': 'const { PATH, ...rest } = process.env;\nconsole.log(JSON.stringify(rest));',
  'fromEntries copy then serialise': 'const c = Object.fromEntries(Object.entries(process.env));\nconsole.log(JSON.stringify(c));',
  'entries serialised': 'console.log(JSON.stringify(Object.entries(process.env)));',
  'util.inspect': "console.log(require('util').inspect(process.env));",
  'console.log(process.env)': 'console.log(process.env);',
  'console.log(alias)': 'const e = process.env; console.log(e);',
  'copy of a copy': 'const a = { ...process.env };\nconst b = a;\nconsole.log(JSON.stringify(b));',
  'String(process.env)': 'const s = String(process.env);',
};
const POS = {
  'single var': 'const v = JSON.stringify(process.env.X);',
  'single var bracket': "const v = JSON.stringify(process.env['X']);",
  'single var inside an object': 'console.log(JSON.stringify({ home: process.env.HOME, n: 1 }));',
  'optional chain single var': 'console.log(process.env?.X);',
  'env copy into spawn options (not serialised)': "const { spawnSync } = require('child_process');\nspawnSync('x', [], { env: { ...process.env, A: '1' } });",
  'copy mutated and passed to spawn': "const env = { ...process.env };\nenv.A = '1';\nrequire('child_process').spawn('x', [], { env });\nconsole.log(JSON.stringify({ a: env.A }));",
  'alias single-var read serialised': 'const env = process.env;\nconsole.log(JSON.stringify(env.X));',
  'names only': 'console.log(JSON.stringify(Object.keys(process.env)));',
  'unrelated stringify': 'console.log(JSON.stringify({ a: 1 }));',
};

for (const [name, src] of Object.entries(NEG)) {
  test(`NEG: ${name} is detected`, () => {
    assert.ok(scan(src).length >= 1, `not detected: ${src}`);
  });
}
for (const [name, src] of Object.entries(POS)) {
  test(`POS: ${name} is not flagged`, () => {
    assert.deepStrictEqual(scan(src), [], `false positive: ${src}`);
  });
}

test('NEG: a violating hook in a nested subdirectory is found by the directory scan', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'envser-'));
  try {
    fs.mkdirSync(path.join(root, '_shared', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    fs.writeFileSync(path.join(root, '_shared', 'deep', 'bad.js'), 'console.log(JSON.stringify({ ...process.env }));\n');
    fs.writeFileSync(path.join(root, 'tests', 'skipped.js'), 'console.log(process.env);\n');
    fs.writeFileSync(path.join(root, 'ok.js'), 'console.log(process.env.X);\n');
    const files = hookFiles(root);
    assert.deepStrictEqual(files.map((f) => path.relative(root, f)).sort(), [path.join('_shared', 'deep', 'bad.js'), 'ok.js'].sort());
    const out = findings(files, root);
    assert.strictEqual(out.length >= 1, true);
    assert.ok(out.every((l) => l.startsWith(path.join('_shared', 'deep', 'bad.js'))), out.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
