'use strict';
// G37 N11 static check: no autopilot hook may carry the whole process.env around unreviewed (it holds the
// account token). The rule watches the identifier `process` itself and uses an ALLOW list (listing the ways to
// reach `env` leaked again and again: ?.["env"], (process).env, process[`env`], { ["env"]: e } = process,
// { env = {} } = process, ...).
//
//   After lexing (comments stripped, string / template text masked, `require('process')`,
//   `require('node:process')`, `globalThis.process` and `global.process` rewritten to `process`), EVERY
//   standalone `process` identifier is one use, unless the text right after it is one of
//     1. a single env key:  .env.X  .env?.X  ?.env.X  ?.env?.X  .env[  .env?.[   (whatever is inside [ ] is not
//        looked at, so process.env[key] stays safe), or
//     2. a member that cannot hand out the whole env: SAFE_MEMBERS below (`?.` before it is fine too).
//   Everything else is a use: `(process)`, `process[...]`, `process?.[...]`, any destructuring `= process`,
//   `const p = process`, passing `process` as an argument, `{ env: process.env }`, bare `process.env`, ...
//
// The uses that exist today and are fine (handing process / env to a function, `spawn({ env: process.env })`,
// ...) are pinned in WHITELIST: { "hooks/x.js": <count> }. More uses than the whitelist is red (the message
// names the file and the line numbers); FEWER is red too (update the whitelist, so it can only get tighter).
// Scope: every .js under hooks/ and all subdirectories, minus the explicit exclusion list below.
// Comments are removed by a lexical scanner (any position, multi-line too, line numbers are kept).
//
// Known blind spots: regex literals (a quote inside one can confuse the scanner); `eval` / `new Function` /
// `vm` strings that build a reference to process; another module that re-exports `process` or its env and a
// hook that imports it from there; `globalThis['process']` / `global['process']`; `Reflect.get(globalThis,
// 'process')`; `import process from 'node:process'` (ESM, hooks are CommonJS); an object that was handed the
// env earlier (the hand-over itself is a counted use).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = __dirname;
const REPO_ROOT = path.resolve(HOOKS_DIR, '..');
const EXCLUDED_DIRS = ['tests', 'fixtures', 'node_modules'];
const EXCLUDED_FILE = /\.test\.js$/;

// Current reviewed uses per hook file. Do not raise a number to make this pass: a new bare process.env in a
// hook needs a reason; lowering it (a use was removed) is required, see above.
const WHITELIST = {
  'hooks/_transcript-timing-probe.js': 1,
  'hooks/audit-log.js': 1,
  'hooks/capture-payload.js': 1,
  'hooks/cost-fuse.js': 1,
  'hooks/dirty-protected-paths.js': 1,
  'hooks/failure-escalation.js': 1,
  'hooks/intent-capture.js': 2,
  'hooks/log-error.js': 1,
  'hooks/merge-task-status-lib.js': 1,
  'hooks/opt-in-multiplexer.js': 1,
  'hooks/owner-question-guard.js': 1,
  'hooks/per-turn-gate.js': 2,
  'hooks/post-tool-chain-lib.js': 2,
  'hooks/residue-auto-reap-lib.js': 2,
  'hooks/runs-watch-autostart.js': 5,
  'hooks/transcript-reader-lib.js': 3,
};

// Members of `process` that never hand out the whole env. Every one has to stay that way.
const SAFE_MEMBERS = [
  'argv', 'argv0', 'execArgv', 'execPath', 'exit', 'exitCode', 'cwd', 'chdir', 'pid', 'ppid', 'platform', 'arch',
  'version', 'versions', 'release', 'stdout', 'stderr', 'stdin', 'on', 'once', 'off', 'kill', 'hrtime', 'nextTick',
  'uptime', 'memoryUsage', 'emitWarning', 'umask', 'getuid', 'getgid', 'geteuid', 'title', 'features', 'config',
  // EventEmitter surface (post-tool-chain-lib snapshots and restores listeners): none of it returns the env
  'eventNames', 'rawListeners', 'listeners', 'listenerCount', 'removeAllListeners', 'removeListener', 'addListener',
  'prependListener', 'emit', 'setMaxListeners', 'getMaxListeners',
];
const SINGLE_ENV_KEY = /^\s*(?:\?\.|\.)\s*env\s*(?:\?\.\s*\[|\[|\?\.\s*[A-Za-z_$]|\.\s*[A-Za-z_$])/;
const SAFE_MEMBER = new RegExp(`^\\s*(?:\\?\\.|\\.)\\s*(?:${SAFE_MEMBERS.join('|')})(?![\\w$])`);
const PROCESS_ID = /(?<![\w$])process(?![\w$])/g;

/**
 * Small lexical scanner. Comments (`//` and `/* *\/`, multi-line too) become one space (newlines inside a block
 * comment are kept, so line numbers do not drift). String and template-literal text is kept as is, or, with
 * `mask`, blanked to spaces (newlines kept) so `'process.env'` in a string is not code; the code inside a
 * template's `${ ... }` stays code. Regex literals are NOT understood (blind spot, see the header).
 */
function lex(src, mask) {
  const stack = [{ t: 'code', depth: 0 }];
  let out = '';
  const blank = (ch) => (mask && ch !== '\n' ? ' ' : ch);
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    if (top.t === 'tpl') {
      if (c === '\\') { out += blank(c); if (i + 1 < src.length) out += blank(src[++i]); } else if (c === '`') { stack.pop(); out += c; } else if (c === '$' && src[i + 1] === '{') { out += '${'; i++; stack.push({ t: 'code', depth: 0 }); } else out += blank(c);
      continue;
    }
    if (c === "'" || c === '"') {
      out += c;
      for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) {
        if (src[i] === '\\' && i + 1 < src.length) { out += blank(src[i]); i++; }
        out += blank(src[i]);
      }
      if (i < src.length && src[i] === c) out += c; else if (i < src.length) out += src[i];
    } else if (c === '`') { out += c; stack.push({ t: 'tpl' }); } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i + 1] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += ' ' + (src.slice(i, stop).match(/\n/g) || []).join('');
      i = stop - 1;
    } else if (c === '{') { top.depth++; out += c; } else if (c === '}') {
      if (top.depth === 0 && stack.length > 1) stack.pop(); else top.depth--;
      out += c;
    } else out += c;
  }
  return out;
}

function normalise(src) {
  const keepNl = (m, text) => text + '\n'.repeat((m.match(/\n/g) || []).length);
  let s = lex(src, false);
  s = s.replace(/\brequire\s*\(\s*['"](?:node:)?process['"]\s*\)/g, (m) => keepNl(m, 'process'));
  s = s.replace(/\b(?:globalThis|global)\s*(?:\?\.|\.)\s*process\b/g, (m) => keepNl(m, 'process'));
  return lex(s, true);
}

/** Line numbers (1-based) of every `process` use that is not on the allow list. */
function uses(src) {
  const s = normalise(src);
  const out = [];
  for (const m of s.matchAll(PROCESS_ID)) {
    // `x.process` is a property of something else; `...process` (spread) is not
    const before = s.slice(Math.max(0, m.index - 3), m.index).replace(/\s+$/, '');
    if (/(?<!\.)\.$/.test(before)) continue;
    const rest = s.slice(m.index + m[0].length);
    if (SINGLE_ENV_KEY.test(rest) || SAFE_MEMBER.test(rest)) continue;
    out.push(s.slice(0, m.index).split('\n').length);
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

/** { "hooks/x.js": [line, ...] } for the files that have at least one use. */
function scanTree(root, files) {
  const found = {};
  for (const f of files) {
    const l = uses(fs.readFileSync(f, 'utf8'));
    if (l.length) found[path.relative(root, f).split(path.sep).join('/')] = l;
  }
  return found;
}

/** Problems comparing the scan against a whitelist ([] when they agree exactly). */
function compare(found, whitelist) {
  const problems = [];
  const names = new Set([...Object.keys(found), ...Object.keys(whitelist)]);
  for (const f of [...names].sort()) {
    const n = (found[f] || []).length;
    const w = whitelist[f] || 0;
    if (n > w) problems.push(`${f}: ${n} uses of the whole process.env, whitelist allows ${w} (lines ${found[f].join(', ')})`);
    else if (n < w) problems.push(`${f}: ${n} uses, whitelist says ${w}: lower the whitelist entry`);
  }
  return problems;
}

test('scan scope covers hooks/ subdirectories, with an explicit exclusion list', () => {
  const files = hookFiles(HOOKS_DIR).map((f) => path.relative(HOOKS_DIR, f));
  assert.ok(files.some((f) => f.includes(path.sep)), 'at least one hook below hooks/ top level is scanned');
  assert.ok(!files.some((f) => f.startsWith('tests' + path.sep) || f.startsWith('fixtures' + path.sep)), 'excluded dirs are not scanned');
  assert.deepStrictEqual(EXCLUDED_DIRS, ['tests', 'fixtures', 'node_modules']);
});

test('whole-process.env uses in hooks/ match the committed whitelist exactly', () => {
  const found = scanTree(REPO_ROOT, hookFiles(HOOKS_DIR));
  assert.deepStrictEqual(compare(found, WHITELIST), []);
});

// Every bypass found so far, each must be counted as a violation.
const NEG = {
  'JSON.stringify(process.env)': "require('fs').writeFileSync('/x', JSON.stringify(process.env));",
  'spread in stringify': 'console.log(JSON.stringify({ ...process.env }));',
  'alias then print': 'const env = process.env;\nconsole.log(JSON.stringify(env));',
  'comma declarator': "const e = process.env, label = 'x'; console.log(e);",
  'comma declarator, env second': "const label = 'x', e = process.env; console.log(e);",
  'destructure env': 'const { env } = process;\nconsole.log(env);',
  'destructure env renamed': 'const { env: e } = process;\nconsole.log(e);',
  'destructure env, assignment form': 'let e; ({ env: e } = process);\nconsole.log(e);',
  'destructure env inside a multi-declarator': "const a = 1, { env } = process, b = 2;\nconsole.log(env, a, b);",
  'destructure env with other keys': 'const { argv, env: e, pid } = process;',
  'destructure from globalThis.process': 'const { env } = globalThis.process;',
  'destructure from require(process)': "const { env } = require('node:process');",
  'container object': 'const box = { env: process.env };\nconsole.log(JSON.stringify(box));',
  'initialiser on the next line': 'const e =\n  process.env;\nconsole.log(e);',
  'array destructure rest': 'const [...all] = Object.entries(process.env);\nconsole.log(all);',
  'object rest destructure': 'const { PATH, ...rest } = process.env;\nconsole.log(rest);',
  'Object.assign copy': 'const c = Object.assign({}, process.env);\nconsole.log(c);',
  'fromEntries copy': 'const c = Object.fromEntries(Object.entries(process.env));',
  'handed to a function': 'report(process.env);',
  'process?.env bare': 'const e = process?.env;',
  "process['env'] bare": "const e = process['env'];",
  'destructure of other keys only is still a use': 'const { argv, pid } = process;',
  'destructure with a default': 'const { env = {} } = process;',
  'destructure with a computed key': 'const { ["env"]: e } = process;',
  'optional computed access, double quotes': 'const e = process?.["env"];',
  'optional computed access, single quotes': "const e = process?.['env'];",
  'parenthesised process': 'const e = (process).env;',
  'template computed access': 'const e = process[`env`];',
  'alias of process': 'const p = process; console.log(p.env);',
  'process passed as an argument': 'report(process);',
  'block comment before code': '/* x */ const e = process.env;',
  'block comment before call': '/* d */ console.log(process.env);',
  'comment inside the token': 'console.log(process /* d */ .env);',
  'generator with yield*': '*all() { yield* Object.entries(process.env) }',
  "require('process').env": "const e = require('process').env;",
  "require('node:process')?.env": "const e = require('node:process')?.env;",
  "require('process')['env']": "const e = require('process')['env'];",
  'bare use after a string with a comment marker': "const u = 'http://x'; console.log(process.env);",
  'bare use inside ${} of a template': 'const m = `v ${JSON.stringify(process.env)}`;',
  'util.inspect': "console.log(require('util').inspect(process.env));",
};
const POS = {
  'process.env.X': 'const v = JSON.stringify(process.env.X);',
  "process.env['X']": "const v = JSON.stringify(process.env['X']);",
  'process.env?.X': 'console.log(process.env?.X);',
  'process?.env.X': 'console.log(process?.env.X);',
  'process.env[key]': 'console.log(process.env[key]);',
  'process.argv[2]': 'const a = process.argv[2];',
  'process.exit(1)': 'process.exit(1);',
  'comment inside env access': 'console.log(process.env /* c */ .X);',
  'process?.env?.X': 'console.log(process?.env?.X);',
  'safe members with optional chain': 'console.log(process?.cwd(), process.platform, process.stdout.write("x"));',
  'x.process is not process': 'console.log(ctx.process, other?.process);',
  'single var in an object': 'console.log(JSON.stringify({ home: process.env.HOME, n: 1 }));',
  'comment only': '// process.env is documented here\n/* process.env */\n/**\n * process.env\n */',
  "string 'process.env'": "const s = 'process.env'; const t = \"process.env\"; const u = `process.env`;",
  'inline comment': 'const a = 1; // reads process.env later\nconst b = 2; /* process.env */',
  'multi-line block comment': 'const a = 1; /* first\n process.env\n last */ const b = 2;',
  'template text but single key in ${}': 'const m = `home: ${process.env.HOME} (process.env)`;',
};
for (const [name, src] of Object.entries(NEG)) {
  test(`NEG: ${name} is counted`, () => {
    assert.ok(uses(src).length >= 1, `not detected: ${src}`);
  });
}
for (const [name, src] of Object.entries(POS)) {
  test(`POS: ${name} is not counted`, () => {
    assert.deepStrictEqual(uses(src), [], `false positive: ${src}`);
  });
}

test('NEG: one more bare use than the whitelist allows is red and names file and line', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'envser-'));
  try {
    fs.mkdirSync(path.join(root, 'hooks', '_shared', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, 'hooks', 'tests'));
    const hooks = path.join(root, 'hooks');
    fs.writeFileSync(path.join(hooks, '_shared', 'deep', 'x.js'), 'spawn({ env: process.env });\nconst e = process.env;\n');
    fs.writeFileSync(path.join(hooks, 'tests', 'skipped.js'), 'console.log(process.env);\n');
    fs.writeFileSync(path.join(hooks, 'ok.js'), 'console.log(process.env.X);\n');
    const files = hookFiles(hooks);
    assert.deepStrictEqual(files.map((f) => path.relative(hooks, f)).sort(), [path.join('_shared', 'deep', 'x.js'), 'ok.js'].sort());
    const found = scanTree(root, files);
    assert.deepStrictEqual(Object.keys(found), ['hooks/_shared/deep/x.js']);
    assert.deepStrictEqual(compare(found, { 'hooks/_shared/deep/x.js': 2 }), [], 'exact whitelist is green');
    const over = compare(found, { 'hooks/_shared/deep/x.js': 1 });
    assert.strictEqual(over.length, 1);
    assert.match(over[0], /hooks\/_shared\/deep\/x\.js/);
    assert.match(over[0], /lines 1, 2/);
    const under = compare(found, { 'hooks/_shared/deep/x.js': 3 });
    assert.strictEqual(under.length, 1);
    assert.match(under[0], /lower the whitelist entry/);
    const stale = compare(found, { 'hooks/_shared/deep/x.js': 2, 'hooks/gone.js': 1 });
    assert.strictEqual(stale.length, 1, 'a whitelist entry for a file with no uses is red');
    assert.match(stale[0], /hooks\/gone\.js/);
    const fresh = compare(found, {});
    assert.strictEqual(fresh.length, 1, 'a file with uses and no whitelist entry is red');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('NEG: the committed whitelist is tight against the real tree (+1 and -1 both red)', () => {
  const found = scanTree(REPO_ROOT, hookFiles(HOOKS_DIR));
  const names = Object.keys(WHITELIST);
  assert.ok(names.length >= 1);
  const plus = Object.assign({}, WHITELIST, { [names[0]]: WHITELIST[names[0]] + 1 });
  const minus = Object.assign({}, WHITELIST, { [names[0]]: WHITELIST[names[0]] - 1 });
  assert.strictEqual(compare(found, plus).length, 1, 'whitelist one too high is red');
  assert.strictEqual(compare(found, minus).length, 1, 'whitelist one too low is red');
});
