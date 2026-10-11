#!/usr/bin/env node
'use strict';
// check-tmp-residue-registry.js — gate: an unregistered temp reference cannot ship.
//
//   node scripts/check-tmp-residue-registry.js [--root DIR] [--registry FILE] [--allowlist FILE]
//                                              [--files F...] [--staged] [--json]
//   node scripts/check-tmp-residue-registry.js --self-test
//
// Scans shipped code (src/ bin/ hooks/ scripts/; never hooks/tests/ and never *.test.*; only
// .js .cjs .mjs .sh .py; whole-line comments are skipped) for every textual reference to the
// temp root: os.tmpdir(), process.env.TMPDIR, $TMPDIR / ${TMPDIR, a string literal starting
// /tmp/, mkdtemp / mkdtempSync / mktemp. Each occurrence must be one of
//   (a) its extractable literal prefix is registered in scripts/lib/tmp-residue-registry.json
//       (the only registration source);
//   (b) guaranteed cleanup: JS - the allocation is the FIRST statement inside a `try` whose
//       `finally` removes the variable; shell - a `trap ... EXIT` naming the variable (guarded
//       `${var:-}`) is installed BEFORE the allocation line;
//   (c) allowlisted in scripts/tmp-residue-allowlist.json with a reason.
// Anything else - including a prefix the gate cannot extract - is a finding.
//
// The gate also fails when `_SRR_PATTERNS` in hooks/tests/lib/suite-residue-reap.sh (read by
// sourcing it in `bash -c`) differs from the registry's `test-lockgated` entries.
//
// Scope: whole repo by default (preflight-release.sh); --files / --staged limits the occurrence
// scan to those files (pre-commit) but the parity check always runs. Stale-allowlist detection
// only runs on a whole-repo scan.
//
// Exit: 0 clean | 1 findings | 2 usage / unreadable input. Node built-ins only.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { compileGlob, classify, KINDS } = require('./lib/tmp-residue.js');

const SELF = __filename;
const REPO = path.resolve(__dirname, '..');
const SCAN_ROOTS = ['src', 'bin', 'hooks', 'scripts'];
const EXTS = new Set(['.js', '.cjs', '.mjs', '.sh', '.py']);
const SKIP_DIRS = new Set(['node_modules', '.git']);
const REAPER_REL = 'hooks/tests/lib/suite-residue-reap.sh';

const TRIGGER = /tmpdir\s*\(\s*\)|process\.env\.TMPDIR|\$\{?TMPDIR|["'`]\/tmp\/|mkdtemp|mktemp/;
const CREATOR = /mkdtemp|mktemp/;

function usage(msg) { const e = new Error(msg); e.usage = true; return e; }

// ---------------------------------------------------------------- file discovery

function walk(rootAbs, relDir, out) {
  let names;
  try { names = fs.readdirSync(path.join(rootAbs, relDir), { withFileTypes: true }); } catch { return; }
  for (const d of names) {
    const rel = relDir ? `${relDir}/${d.name}` : d.name;
    if (d.isDirectory()) {
      if (SKIP_DIRS.has(d.name) || rel === 'hooks/tests') continue;
      walk(rootAbs, rel, out);
    } else if (d.isFile()) {
      if (inScope(rel)) out.push(rel);
    }
  }
}

function inScope(rel) {
  if (!SCAN_ROOTS.some((r) => rel === r || rel.startsWith(`${r}/`))) return false;
  if (rel.startsWith('hooks/tests/')) return false;
  const base = path.basename(rel);
  if (/\.test\./.test(base)) return false;
  return EXTS.has(path.extname(base));
}

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('#') || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

// ---------------------------------------------------------------- prefix extraction

const NAME = '[\\w.\\-]*';

function cleanPrefix(p) { return p.replace(/X{3,}.*$/, ''); }

// Every literal prefix this line gives to a temp-root path. Empty array = none extractable.
function extractPrefixes(line) {
  const found = new Set();
  const add = (p) => { if (p) found.add(cleanPrefix(p)); };
  let m;
  // JS: <tmpdir()>, 'prefix...'   (path.join / mkdtempSync arguments)
  const r1 = /tmpdir\s*\(\s*\)\s*,\s*(['"`])((?:(?!\1)[^$\\])*)/g;
  while ((m = r1.exec(line))) add(m[2]);
  // JS: mkdtempSync(path.join(<anything>, 'prefix...'))
  const r8 = /mkdtemp(?:Sync)?\(\s*path\.join\([^,]*,\s*(['"`])((?:(?!\1)[^$\\])*)/g;
  while ((m = r8.exec(line))) add(m[2]);
  // JS template: `${os.tmpdir()}/prefix...`
  const r2 = new RegExp(`tmpdir\\s*\\(\\s*\\)\\}\\/(${NAME})`, 'g');
  while ((m = r2.exec(line))) add(m[1]);
  // literal /tmp/<name>
  const r3 = new RegExp(`["'\`]\\/tmp\\/(${NAME})`, 'g');
  while ((m = r3.exec(line))) add(m[1]);
  // shell: $TMPDIR/<name>, ${TMPDIR}/<name>, ${TMPDIR:-/tmp}/<name>
  const r4 = new RegExp(`\\$\\{?TMPDIR(?::-[^}]*(?=\\}))?\\}?["']?\\/(${NAME})`, 'g');
  while ((m = r4.exec(line))) add(m[1]);
  // JS: path.join(process.env.TMPDIR || '/tmp', 'prefix...')
  const r9 = /process\.env\.TMPDIR\s*\|\|\s*(['"])\/tmp\1\s*,\s*(['"`])((?:(?!\2)[^$\\])*)/g;
  while ((m = r9.exec(line))) add(m[3]);
  // shell: mktemp [-d] -t <template>
  const r5 = /mktemp\b[^|;&)]*?\s-t\s+["']?([\w.\-]+?)(?:X{3,}|["'$\s)]|$)/g;
  while ((m = r5.exec(line))) add(m[1]);
  // python: mkdtemp(prefix="...")
  const r7 = /mkdtemp\([^)]*prefix\s*=\s*["']([^"']*)/g;
  while ((m = r7.exec(line))) add(m[1]);
  return [...found];
}

function isRegistered(prefix, entries) {
  for (const s of [prefix, `${prefix}x`, `${prefix}0`]) {
    if (classify(s, entries) !== 'unregistered') return true;
  }
  return false;
}

// ---------------------------------------------------------------- guaranteed-cleanup (rule b)

function nextCodeLineBack(lines, idx) {
  for (let i = idx - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t && !isCommentLine(lines[i])) return i;
  }
  return -1;
}

// Index of the brace that closes the one at text[open]; strings, template literals and comments
// are skipped. -1 when unbalanced.
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const RM_CALL = /(?:rm|rmSync|rmdirSync|unlinkSync|unlink|remove|removeSync|rimraf|cleanup|dispose|delete)\w*\s*\(/i;

function jsGuaranteed(lines, idx) {
  const am = /^\s*(?:(?:const|let|var)\s+)?([A-Za-z_$][\w$]*)\s*=[^=]/.exec(lines[idx]);
  if (!am) return false;
  const v = am[1];
  const prev = nextCodeLineBack(lines, idx);
  if (prev < 0 || !/\btry\s*\{\s*$/.test(lines[prev])) return false;
  const offsets = []; let acc = 0;
  for (const l of lines) { offsets.push(acc); acc += l.length + 1; }
  const text = lines.join('\n');
  const open = offsets[prev] + lines[prev].lastIndexOf('{');
  let close = matchBrace(text, open);
  if (close < 0) return false;
  let rest = text.slice(close + 1);
  let pos = close + 1;
  let ws = /^\s*/.exec(rest)[0].length; pos += ws; rest = rest.slice(ws);
  if (/^catch\b/.test(rest)) {
    const b = text.indexOf('{', pos);
    if (b < 0) return false;
    close = matchBrace(text, b);
    if (close < 0) return false;
    rest = text.slice(close + 1); pos = close + 1;
    ws = /^\s*/.exec(rest)[0].length; pos += ws; rest = rest.slice(ws);
  }
  if (!/^finally\b/.test(rest)) return false;
  const fb = text.indexOf('{', pos);
  if (fb < 0) return false;
  const fe = matchBrace(text, fb);
  if (fe < 0) return false;
  const body = text.slice(fb, fe + 1);
  const vre = new RegExp(`(?<![\\w$])${v.replace(/\$/g, '\\$')}(?![\\w$])`);
  return body.split('\n').some((l) => !isCommentLine(l) && RM_CALL.test(l) && vre.test(l));
}

function shGuaranteed(lines, idx) {
  const am = /^\s*(?:(?:local|export|declare|readonly)\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=/.exec(lines[idx]);
  if (!am) return false;
  const v = am[1];
  const guard = new RegExp(`\\$\\{${v}:?-`);
  for (let i = 0; i < idx; i++) {
    if (isCommentLine(lines[i])) continue;
    const l = lines[i];
    if (!/\btrap\b/.test(l) || !/\bEXIT\b/.test(l)) continue;
    if (guard.test(l)) return true;
    // `trap cleanup EXIT` / `trap 'cleanup' EXIT`: the handler function must guard the variable.
    const fm = /\btrap\s+['"]?([A-Za-z_]\w*)['"]?\s+(?:[A-Z0-9 ]+\s+)?EXIT\b/.exec(l);
    if (fm) {
      const fre = new RegExp(`^\\s*(?:function\\s+)?${fm[1]}\\s*\\(\\)\\s*\\{|^\\s*function\\s+${fm[1]}\\b`);
      for (let j = 0; j < idx; j++) {
        if (!fre.test(lines[j])) continue;
        for (let k = j; k < Math.min(lines.length, j + 40); k++) {
          if (guard.test(lines[k])) return true;
          if (k > j && /^\}/.test(lines[k])) break;
        }
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------- scanning

function loadAllowlist(file) {
  if (!file || !fs.existsSync(file)) return { entries: [], problems: [] };
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`allowlist unreadable: ${e.message}`); }
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const problems = [];
  entries.forEach((e, i) => {
    const where = `allowlist entry #${i}${e && e.file ? ` (${e.file})` : ''}`;
    if (!e || typeof e.file !== 'string' || !e.file) problems.push(`${where}: missing file`);
    else if (typeof e.reason !== 'string' || e.reason.trim().length < 8) problems.push(`${where}: missing reason`);
    else if (e.pending_registry && (!KINDS.includes(e.kind) || !e.prefix)) problems.push(`${where}: pending_registry needs kind and prefix`);
  });
  return { entries, problems };
}

function findAllowed(allow, rel, line) {
  return allow.entries.find((e) => e && e.file === rel && (e.match === undefined || e.match === '' || line.includes(e.match)));
}

function scanFile(rootAbs, rel, ctx) {
  const text = fs.readFileSync(path.join(rootAbs, rel), 'utf8');
  const lines = text.split('\n');
  const isSh = rel.endsWith('.sh');
  const isPy = rel.endsWith('.py');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line) || !TRIGGER.test(line)) continue;
    const prefixes = extractPrefixes(line);
    const at = `${rel}:${i + 1}`;
    const hit = findAllowed(ctx.allow, rel, line);
    if (hit) { ctx.allowUsed.add(hit); continue; }
    const creator = CREATOR.test(line);
    const unreg = prefixes.filter((p) => !isRegistered(p, ctx.entries));
    if (prefixes.length && !unreg.length) continue; // (a)
    let guaranteed = false;
    if (creator && !isPy) guaranteed = isSh ? shGuaranteed(lines, i) : jsGuaranteed(lines, i);
    if (guaranteed) continue; // (b)
    const snippet = line.trim().slice(0, 140);
    if (!prefixes.length) {
      const bare = /["'`]\/tmp\/(?![\w.\-])/.test(line);
      ctx.findings.push({
        code: bare ? 'bare_tmp_literal' : 'unextractable_prefix', at,
        detail: `${bare ? 'bare /tmp/ literal' : 'cannot extract a literal prefix'} and no guaranteed cleanup or allowlist entry: ${snippet}`,
      });
    } else {
      ctx.findings.push({
        code: 'unregistered_prefix', at,
        detail: `prefix ${unreg.map((p) => JSON.stringify(p)).join(', ')} is not in tmp-residue-registry.json and has no guaranteed cleanup or allowlist entry: ${snippet}`,
      });
    }
  }
}

function reaperPatterns(rootAbs) {
  const reaper = path.join(rootAbs, REAPER_REL);
  if (!fs.existsSync(reaper)) return { error: `${REAPER_REL} not found` };
  const r = cp.spawnSync('bash', ['-c', 'source "$1" >/dev/null 2>&1; printf "%s\\n" "${_SRR_PATTERNS[@]}"', '_', reaper], { encoding: 'utf8' });
  if (r.status !== 0) return { error: `sourcing ${REAPER_REL} failed (rc=${r.status})` };
  return { patterns: r.stdout.split('\n').filter(Boolean) };
}

function checkParity(rootAbs, doc, findings) {
  const got = reaperPatterns(rootAbs);
  if (got.error) { findings.push({ code: 'parity_mismatch', at: REAPER_REL, detail: got.error }); return; }
  const reg = doc.entries.filter((e) => e.kind === 'test-lockgated').map((e) => e.pattern);
  const a = new Set(got.patterns); const b = new Set(reg);
  const onlyReaper = [...a].filter((p) => !b.has(p)).sort();
  const onlyRegistry = [...b].filter((p) => !a.has(p)).sort();
  if (onlyReaper.length || onlyRegistry.length) {
    findings.push({
      code: 'parity_mismatch', at: REAPER_REL,
      detail: `_SRR_PATTERNS differs from the registry's test-lockgated entries; only in reaper: [${onlyReaper.join(', ')}]; only in registry: [${onlyRegistry.join(', ')}]`,
    });
  }
}

function runGate(opts) {
  const rootAbs = path.resolve(opts.root || REPO);
  const registryFile = opts.registry || path.join(rootAbs, 'scripts/lib/tmp-residue-registry.json');
  const allowFile = opts.allowlist || path.join(rootAbs, 'scripts/tmp-residue-allowlist.json');
  const findings = [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    if (!doc || !Array.isArray(doc.entries)) throw new Error('entries[] missing');
  } catch (e) {
    return { findings: [{ code: 'registry_invalid', at: registryFile, detail: e.message }], scanned: 0 };
  }
  const allow = loadAllowlist(allowFile);
  for (const p of allow.problems) findings.push({ code: 'allowlist_invalid', at: allowFile, detail: p });
  const ctx = { entries: doc.entries, allow, allowUsed: new Set(), findings };

  let files;
  const whole = !opts.files;
  if (whole) { files = []; for (const r of SCAN_ROOTS) walk(rootAbs, r, files); }
  else files = opts.files.map((f) => f.replace(/^\.\//, '')).filter((f) => inScope(f) && fs.existsSync(path.join(rootAbs, f)));
  files.sort();
  for (const rel of files) {
    try { scanFile(rootAbs, rel, ctx); } catch (e) { findings.push({ code: 'scan_error', at: rel, detail: e.message }); }
  }
  if (whole) {
    for (const e of allow.entries) {
      if (e && e.file && !ctx.allowUsed.has(e)) {
        findings.push({ code: 'allowlist_stale', at: allowFile, detail: `entry for ${e.file}${e.match ? ` (match ${JSON.stringify(e.match)})` : ''} matches no occurrence - remove it` });
      }
    }
  }
  checkParity(rootAbs, doc, findings);
  return { findings, scanned: files.length };
}

// ---------------------------------------------------------------- self-test

function selfTest() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-residue-gate-selftest-'));
  const results = [];
  try {
    const realReaper = fs.readFileSync(path.join(REPO, REAPER_REL), 'utf8');
    const realRegistry = fs.readFileSync(path.join(REPO, 'scripts/lib/tmp-residue-registry.json'), 'utf8');
    let n = 0;
    const mkRoot = (files, opts = {}) => {
      const root = path.join(base, `fx${++n}`);
      fs.mkdirSync(path.join(root, 'hooks/tests/lib'), { recursive: true });
      fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
      fs.writeFileSync(path.join(root, REAPER_REL), opts.reaper || realReaper);
      fs.writeFileSync(path.join(root, 'scripts/lib/tmp-residue-registry.json'), realRegistry);
      fs.writeFileSync(path.join(root, 'scripts/tmp-residue-allowlist.json'), JSON.stringify({ entries: opts.allow || [] }));
      for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
      }
      return root;
    };
    const cases = [];
    const add = (name, expectExit, expectCode, root) => cases.push({ name, expectExit, expectCode, root });

    // Positive controls first: they prove each negative below fails for its own reason.
    add('clean fixture repo', 0, null, mkRoot({ 'scripts/ok.js': "'use strict';\nconst x = 1;\n" }));
    add('registered literal prefix', 0, null, mkRoot({ 'scripts/p.js': "const p = require('path').join(require('os').tmpdir(), 'dispatch-consult-x');\n" }));
    add('alloc first in try + finally rm', 0, null, mkRoot({
      'scripts/p.js': "const fs = require('fs'); const os = require('os'); const path = require('path');\nlet d;\ntry {\n  d = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-unreg-'));\n  work(d);\n} finally {\n  fs.rmSync(d, { recursive: true, force: true });\n}\n",
    }));
    add('shell trap (guarded) before mktemp', 0, null, mkRoot({
      'scripts/p.sh': '#!/usr/bin/env bash\nWORK=""\ntrap \'rm -rf "${WORK:-}"\' EXIT\nWORK="$(mktemp -d)"\n',
    }));
    add('allowlisted unextractable prefix', 0, null, mkRoot(
      { 'scripts/p.js': "const d = require('fs').mkdtempSync(require('path').join(base, name));\n" },
      { allow: [{ file: 'scripts/p.js', match: 'mkdtempSync', reason: 'self-test: explicit allowlist entry with a reason' }] },
    ));

    // KR5 planted fixtures: each must make the gate exit 1 for its own reason.
    add('unregistered literal prefix', 1, 'unregistered_prefix', mkRoot({ 'scripts/p.js': "const p = require('path').join(require('os').tmpdir(), 'zz-unreg-x.json');\n" }));
    add('success-path-only rmSync', 1, 'unregistered_prefix', mkRoot({
      'scripts/p.js': "const fs = require('fs'); const os = require('os'); const path = require('path');\ntry {\n  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-unreg-'));\n  work(d);\n  fs.rmSync(d, { recursive: true });\n} catch (e) {\n  throw e;\n}\n",
    }));
    add('allocation before the try', 1, 'unregistered_prefix', mkRoot({
      'scripts/p.js': "const fs = require('fs'); const os = require('os'); const path = require('path');\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-unreg-'));\ntry {\n  work(d);\n} finally {\n  fs.rmSync(d, { recursive: true, force: true });\n}\n",
    }));
    add('mktemp before its trap', 1, 'unextractable_prefix', mkRoot({
      'scripts/p.sh': '#!/usr/bin/env bash\nWORK="$(mktemp -d)"\ntrap \'rm -rf "${WORK:-}"\' EXIT\n',
    }));
    add('unextractable prefix, no allowlist', 1, 'unextractable_prefix', mkRoot({ 'scripts/p.js': "const d = require('fs').mkdtempSync(require('path').join(base, name));\n" }));
    add('reaper-only prefix (parity)', 1, 'parity_mismatch', mkRoot({ 'scripts/ok.js': "'use strict';\n" }, {
      reaper: realReaper.replace("  'apt.*'\n)", "  'apt.*'\n  'zz-reaper-only-*'\n)"),
    }));
    add('bare /tmp/ literal', 1, 'bare_tmp_literal', mkRoot({ 'scripts/p.js': "const p = '/tmp/' + name;\n" }));

    // Non-vacuity of the parity mutation itself.
    if (!realReaper.includes("  'apt.*'\n)")) results.push({ name: 'reaper mutation anchor present', ok: false, note: "anchor `'apt.*'` + `)` not found in the reaper" });

    for (const c of cases) {
      const r = cp.spawnSync(process.execPath, [SELF, '--root', c.root, '--json'], { encoding: 'utf8' });
      let codes = [];
      try { codes = JSON.parse(r.stdout).findings.map((f) => f.code); } catch { /* exit-code only */ }
      const ok = r.status === c.expectExit && (!c.expectCode || codes.includes(c.expectCode));
      results.push({ name: c.name, ok, note: `expect exit ${c.expectExit}${c.expectCode ? ` (${c.expectCode})` : ''}, got exit ${r.status}${codes.length ? ` [${[...new Set(codes)].join(',')}]` : ''}` });
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  let bad = 0;
  for (const r of results) { if (!r.ok) bad++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.note}`); }
  console.log(bad ? `self-test FAILED (${bad}/${results.length})` : `self-test passed (${results.length}/${results.length})`);
  return bad ? 1 : 0;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { json: false, selfTest: false, staged: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw usage(`${a} needs a value`); return argv[++i]; };
    if (a === '--root') o.root = val();
    else if (a === '--registry') o.registry = val();
    else if (a === '--allowlist') o.allowlist = val();
    else if (a === '--json') o.json = true;
    else if (a === '--self-test') o.selfTest = true;
    else if (a === '--staged') o.staged = true;
    else if (a === '--files') { o.files = o.files || []; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o.files.push(argv[++i]); }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw usage(`unknown argument: ${a}`);
  }
  return o;
}

function stagedFiles(rootAbs) {
  const r = cp.spawnSync('git', ['-C', rootAbs, 'diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git diff --cached failed: ${r.stderr.trim()}`);
  return r.stdout.split('\n').filter(Boolean);
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`check-tmp-residue-registry: ${e.message}`); return 2; }
  if (o.help) { console.log(fs.readFileSync(SELF, 'utf8').split('\n').slice(2, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  if (o.selfTest) return selfTest();
  try {
    if (o.staged) o.files = (o.files || []).concat(stagedFiles(path.resolve(o.root || REPO)));
    const res = runGate(o);
    if (o.json) {
      process.stdout.write(`${JSON.stringify({ scanned: res.scanned, findings: res.findings })}\n`);
    } else if (res.findings.length) {
      for (const f of res.findings) console.error(`${f.at}: ${f.code}: ${f.detail}`);
      console.error(`check-tmp-residue-registry: ${res.findings.length} finding(s) in ${res.scanned} file(s). Register the prefix in scripts/lib/tmp-residue-registry.json, make the allocation the first statement of a try/finally (shell: trap ... EXIT before mktemp), or add a reasoned entry to scripts/tmp-residue-allowlist.json.`);
    } else {
      console.log(`check-tmp-residue-registry: OK (${res.scanned} file(s) scanned, parity holds)`);
    }
    return res.findings.length ? 1 : 0;
  } catch (e) {
    console.error(`check-tmp-residue-registry: ${e.message}`);
    return 2;
  }
}

module.exports = { runGate, extractPrefixes, isRegistered, compileGlob };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
