#!/usr/bin/env node
'use strict';
/*
 * leak-guard.js — block personal data from entering tracked files.
 *
 *   node scripts/leak-guard.js [--staged | --range A..B] [--registry FILE] [--json]
 *
 * Scans ONLY the lines a change ADDS (git diff -U0 --find-renames, filter ACMRT), so history is
 * never re-judged and a pure rename of an old file adds nothing. Patterns: scripts/lib/
 * personal-data-patterns.js (home/tmp/run paths, host names, private IPs, credential shapes,
 * and a file named .env or *.env).
 *
 * Exemptions: scripts/leak-guard-registry.json only (override with --registry). One entry per
 * file and category: {"path": "<full repo path>", "category": "<category>", "reason": "<why>"}.
 * A glob, a directory, or a missing reason is rejected. There is no directory exemption and no
 * warn mode. A registry that is missing, unparsable or malformed is itself a failure (exit 2).
 *
 * On a block it prints every file:line and category, then one runnable redaction command
 * (scripts/redact-personal.js) covering all blocked files.
 *
 * Exit: 0 clean | 1 findings | 2 usage, git failure, or bad registry (never a pass).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const patterns = require('./lib/personal-data-patterns');

const DEFAULT_REGISTRY = 'scripts/leak-guard-registry.json';
const GLOB_CHARS = /[*?[\]{}]/;

function fail(code, msg) {
  process.stderr.write(`leak-guard: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { mode: 'staged', range: '', registry: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--staged') o.mode = 'staged';
    else if (a === '--range') {
      o.mode = 'range';
      o.range = argv[++i] || '';
      if (!o.range) fail(2, '--range needs A..B');
    } else if (a === '--registry') {
      o.registry = argv[++i];
      if (!o.registry) fail(2, '--registry needs a file');
    } else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write('usage: leak-guard.js [--staged | --range A..B] [--registry FILE] [--json]\n');
      process.exit(0);
    } else fail(2, `unknown argument ${a}`);
  }
  return o;
}

function loadRegistry(file, root) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    fail(2, `registry unreadable: ${file} (${e.code || e.message}). A missing registry is a failure, not a pass.`);
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    fail(2, `registry is not valid JSON: ${file} (${e.message})`);
  }
  if (!j || typeof j !== 'object' || Array.isArray(j) || j.version !== 1 || !Array.isArray(j.entries)) {
    fail(2, `registry malformed: ${file} needs {"version":1,"entries":[...]}`);
  }
  const exempt = new Set();
  j.entries.forEach((e, i) => {
    const at = `${file} entries[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) fail(2, `${at}: not an object`);
    const keys = Object.keys(e).sort().join(',');
    if (keys !== 'category,path,reason') fail(2, `${at}: keys must be exactly path, category, reason`);
    if (typeof e.path !== 'string' || !e.path) fail(2, `${at}: path must be a non-empty string`);
    if (GLOB_CHARS.test(e.path)) fail(2, `${at}: glob characters are not allowed in path (${e.path})`);
    if (e.path.endsWith('/') || e.path.startsWith('/') || e.path.startsWith('./') || e.path.split('/').includes('..')) {
      fail(2, `${at}: path must be a full repo-relative file path, not a directory (${e.path})`);
    }
    let st = null;
    try {
      st = fs.statSync(path.join(root, e.path));
    } catch (err) { /* absent path: a stale entry, not a directory */ }
    if (st && st.isDirectory()) {
      fail(2, `${at}: path resolves to a directory under the repo root, not a file (${e.path})`);
    }
    if (!patterns.CATEGORIES.includes(e.category)) fail(2, `${at}: category must be one of ${patterns.CATEGORIES.join(', ')}`);
    if (typeof e.reason !== 'string' || e.reason.trim().length < 8) fail(2, `${at}: reason must say why (8+ chars)`);
    exempt.add(`${e.path}\0${e.category}`);
  });
  return exempt;
}

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 });
  if (r.error) fail(2, `git failed: ${r.error.message}`);
  if (r.status !== 0) fail(2, `git ${args.join(' ')} exited ${r.status}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

function unquote(p) {
  if (!p.startsWith('"')) return p;
  try {
    return JSON.parse(p);
  } catch (_) {
    return p;
  }
}

function diffArgs(o, extra) {
  const a = ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--diff-filter=ACMRT', ...extra];
  if (o.mode === 'staged') a.push('--cached');
  else a.push(o.range);
  return a;
}

/** File-name findings (env files). A pure rename of an already-.env name is history, not new. */
function envNameFindings(root, o) {
  const toks = git(root, diffArgs(o, ['--name-status', '-z'])).split('\0');
  const out = [];
  for (let i = 0; i < toks.length && toks[i] !== ''; ) {
    const status = toks[i++];
    const first = toks[i++];
    const second = status[0] === 'R' || status[0] === 'C' ? toks[i++] : null;
    const file = second || first;
    const prior = second ? first : null;
    if (patterns.isEnvFileName(file) && !(prior && patterns.isEnvFileName(prior))) {
      out.push({ file, line: 0, category: 'env_file', snippet: path.basename(file) });
    }
  }
  return out;
}

/** Walk a -U0 diff and yield {file, line, content} for every added ('+') or removed ('-') line. */
function diffLines(text, sign) {
  const out = [];
  let minus = '';
  let plus = '';
  let line = 0;
  let inHunk = false;
  const clean = (p) => { const u = unquote(p); return u.startsWith('a/') || u.startsWith('b/') ? u.slice(2) : u; };
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; minus = ''; plus = ''; continue; }
    if (!inHunk && l.startsWith('--- ')) { minus = clean(l.slice(4)); continue; }
    if (!inHunk && l.startsWith('+++ ')) { plus = clean(l.slice(4)); continue; }
    if (l.startsWith('@@ ')) {
      const m = l.match(sign === '+' ? /\+(\d+)/ : /-(\d+)/);
      line = m ? parseInt(m[1], 10) : 0;
      inHunk = true;
      continue;
    }
    // an added line belongs to the new path, a removed line to the old one (they differ on a rename)
    const file = sign === '-' ? (minus && minus !== '/dev/null' ? minus : plus) : (plus && plus !== '/dev/null' ? plus : minus);
    if (inHunk && l.startsWith(sign) && file && file !== '/dev/null') {
      out.push({ file, line, content: l.slice(1) });
      line++;
    }
  }
  return out;
}

/** Added lines of a combined (--cc) merge diff: only lines new against EVERY parent (all columns '+'). */
function combinedAdded(text, nParents) {
  const out = [];
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --cc ') || l.startsWith('diff --combined ')) {
      inHunk = false;
      file = unquote(l.slice(l.indexOf(' ', 7) + 1));
      continue;
    }
    if (l.startsWith('@@@')) {
      const m = l.match(/\+(\d+)/);
      line = m ? parseInt(m[1], 10) : 0;
      inHunk = true;
      continue;
    }
    if (!inHunk || !file || l.length < nParents) continue;
    const cols = l.slice(0, nParents);
    if (cols === '+'.repeat(nParents)) out.push({ file, line, content: l.slice(nParents) });
    if (!cols.includes('-')) line++;
  }
  return out;
}

/** take(file, content) -> true when a revert allowance covers the added line (and spends it). */
function scanAdded(added, take) {
  const out = [];
  for (const { file, line, content } of added) {
    if (take && take(file, content)) continue;
    for (const h of patterns.findAll(content)) {
      const snippet = h.category === 'secret' ? `${h.match.slice(0, 4)}…` : h.match;
      out.push({ file, line, category: h.category, snippet });
    }
  }
  return out;
}

const REVERT_TRAILER = 'Leak-Guard-Allow-Revert';

function resolveCommit(root, ref) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

/** Every commit of the range, parents before children, with its parents and full message. */
function rangeCommits(root, o) {
  const log = git(root, ['log', '--no-color', '--topo-order', '--reverse', '--format=%H%x1f%P%x1f%B%x1e', o.range]);
  const out = [];
  for (const rec of log.split('\x1e')) {
    const f = rec.split('\x1f');
    if (f.length < 3 || !f[0].trim()) continue;
    out.push({ sha: f[0].trim(), parents: f[1].trim() ? f[1].trim().split(/\s+/) : [], body: f.slice(2).join('\x1f') });
  }
  return out;
}

/**
 * Range mode only. A NON-merge commit is a deliberate revert of a redaction when its message carries
 * both git's own "This reverts commit <sha>." and the trailer "Leak-Guard-Allow-Revert: <sha>" naming the
 * SAME commit. The range has ONE shared ledger: (reverted sha, file, text) -> how many times that commit
 * removed the line. Every revert commit of that sha spends from the same entry, so a second trailer for the
 * same cleanup finds it used up. A merge commit never gets an allowance, whatever its message says.
 * (git revert runs no pre-commit hook, so --staged needs no path.)
 * @returns {{ledger: Map<string, number>, reverts: Map<string, string>}} reverts: revert commit -> reverted sha
 */
function revertLedger(root, commits) {
  const ledger = new Map();
  const reverts = new Map();
  const loaded = new Set();
  for (const c of commits) {
    if (c.parents.length > 1) continue;
    const rv = c.body.match(/^This reverts commit ([0-9a-f]{7,40})\.\s*$/m);
    // only the final trailer block counts (git's own parser), not any line that looks like a trailer
    const parsed = spawnSync('git', ['interpret-trailers', '--parse'], { cwd: root, input: c.body, encoding: 'utf8' });
    const tr = parsed.status === 0 ? (parsed.stdout || '').match(new RegExp(`^${REVERT_TRAILER}:\\s*([0-9a-f]{7,40})\\s*$`, 'm')) : null;
    if (!rv || !tr) continue;
    const a = resolveCommit(root, rv[1]);
    if (!a || a !== resolveCommit(root, tr[1])) continue;
    reverts.set(c.sha, a);
    if (loaded.has(a)) continue;
    loaded.add(a);
    const text = git(root, ['show', '--no-color', '--no-ext-diff', '--find-renames', '--format=', '-U0', a]);
    for (const d of diffLines(text, '-')) {
      const k = `${a}\0${d.file}\0${d.content}`;
      ledger.set(k, (ledger.get(k) || 0) + 1);
    }
  }
  return { ledger, reverts };
}

/**
 * No revert trailer in the range: the whole range diff is scanned once (unchanged behaviour).
 * Otherwise every commit is scanned on its own (a merge on what it introduces itself, via --cc), and only
 * a revert commit can spend the shared ledger, so a later commit re-adding the same line gets no cover.
 */
function contentFindings(root, o, commits) {
  const { ledger, reverts } = o.mode === 'range' ? revertLedger(root, commits) : { ledger: new Map(), reverts: new Map() };
  if (reverts.size === 0) return scanAdded(diffLines(git(root, diffArgs(o, ['-U0'])), '+'), null);
  const out = [];
  for (const c of commits) {
    if (c.parents.length > 1) {
      const text = git(root, ['show', '--no-color', '--no-ext-diff', '--cc', '--format=', '-U0', c.sha]);
      out.push(...scanAdded(combinedAdded(text, c.parents.length), null));
      continue;
    }
    const text = git(root, ['show', '--no-color', '--no-ext-diff', '--find-renames', '--diff-filter=ACMRT', '--format=', '-U0', c.sha]);
    const a = reverts.get(c.sha);
    const take = a ? (file, content) => {
      const k = `${a}\0${file}\0${content}`;
      if (!(ledger.get(k) > 0)) return false;
      ledger.set(k, ledger.get(k) - 1);
      return true;
    } : null;
    out.push(...scanAdded(diffLines(text, '+'), take));
  }
  return out;
}

function shq(s) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (top.status !== 0) fail(2, 'not inside a git work tree');
  const root = top.stdout.trim();
  const exempt = loadRegistry(o.registry ? path.resolve(o.registry) : path.join(root, DEFAULT_REGISTRY), root);

  const seen = new Set();
  const findings = [];
  for (const f of [...envNameFindings(root, o), ...contentFindings(root, o, o.mode === 'range' ? rangeCommits(root, o) : [])]) {
    if (exempt.has(`${f.file}\0${f.category}`)) continue;
    const key = `${f.file}\0${f.line}\0${f.category}\0${f.snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
  }

  if (o.json) {
    process.stdout.write(JSON.stringify({ findings }, null, 2) + '\n');
    process.exit(findings.length ? 1 : 0);
  }
  if (findings.length === 0) process.exit(0);

  const files = [...new Set(findings.map((f) => f.file))];
  const out = [];
  out.push(`leak-guard: ${findings.length} personal-data finding(s) in ${files.length} file(s)`);
  for (const f of findings) out.push(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.category}]  ${f.snippet}`);
  const fixable = [...new Set(findings.filter((f) => f.category !== 'env_file').map((f) => f.file))];
  if (fixable.length) {
    // absolute paths for the script and the files: the command runs as printed from any directory
    out.push('Redact (rewrites the whole file, then re-stage it):');
    out.push(`  node ${shq(path.join(__dirname, 'redact-personal.js'))} ${fixable.map((f) => shq(path.join(root, f))).join(' ')}`);
  }
  if (findings.some((f) => f.category === 'env_file')) out.push('An .env file cannot be redacted: unstage it (git rm --cached) and keep it out of the repo.');
  out.push(`A file that must keep a hit gets one entry (path, category, reason) in ${DEFAULT_REGISTRY}; directories and globs are refused.`);
  process.stderr.write(out.join('\n') + '\n');
  process.exit(1);
}

main();
