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

/** Findings in the added lines of a diff, plus the text of each flagged line (file\0line -> text). */
function scanAdded(added) {
  const out = [];
  const texts = new Map();
  for (const { file, line, content } of added) {
    for (const h of patterns.findAll(content)) {
      const snippet = h.category === 'secret' ? `${h.match.slice(0, 4)}…` : h.match;
      out.push({ file, line, category: h.category, snippet });
      texts.set(`${file}\0${line}`, content);
    }
  }
  return { findings: out, texts };
}

/** The whole base..head diff is the floor: whatever it flags is blocked unless a revert allowance below covers it. */
function contentFindings(root, o) {
  return scanAdded(diffLines(git(root, diffArgs(o, ['-U0'])), '+'));
}

const REVERT_TRAILER = 'Leak-Guard-Allow-Revert';

function resolveCommit(root, ref) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function rangeHead(root, range) {
  const m = range.match(/\.{2,3}([^.]*)$/);
  return resolveCommit(root, m && m[1] ? m[1] : 'HEAD');
}

/**
 * Valid revert commits of the range: sha -> reverted (anchor) sha. One git log reads every message; only a
 * message that contains the trailer key is parsed. Valid = not a merge, the trailer is in the final trailer
 * block (git's own parser), "This reverts commit <sha>." has its full stop, both shas resolve to the same
 * commit, and that anchor is an ancestor of the range head but not itself part of the range.
 */
function revertCandidates(root, o, head) {
  const cands = new Map();
  const log = git(root, ['log', '--no-color', '--topo-order', '--reverse', '--format=%H%x00%P%x00%B%x00', o.range]).split('\0');
  const isAncestor = new Map();
  const inRange = new Set();
  for (let i = 0; i + 2 < log.length; i += 3) inRange.add(log[i].trim());
  for (let i = 0; i + 2 < log.length; i += 3) {
    const sha = log[i].trim();
    const parents = log[i + 1].trim() ? log[i + 1].trim().split(/\s+/) : [];
    const body = log[i + 2];
    if (!sha || parents.length > 1 || !body.includes(`${REVERT_TRAILER}:`)) continue;
    const rv = body.match(/^This reverts commit ([0-9a-f]{7,40})\.\s*$/m);
    const parsed = spawnSync('git', ['interpret-trailers', '--parse'], { cwd: root, input: body, encoding: 'utf8' });
    const tr = parsed.status === 0 ? (parsed.stdout || '').match(new RegExp(`^${REVERT_TRAILER}:\\s*([0-9a-f]{7,40})\\s*$`, 'm')) : null;
    if (!rv || !tr) continue;
    const a = resolveCommit(root, rv[1]);
    if (!a || a !== resolveCommit(root, tr[1])) continue;
    // an anchor inside the range may have been the commit that first introduced the data: that is new, not legacy
    if (inRange.has(a)) continue;
    if (!isAncestor.has(a)) {
      isAncestor.set(a, spawnSync('git', ['merge-base', '--is-ancestor', a, head], { cwd: root }).status === 0);
    }
    if (isAncestor.get(a)) cands.set(sha, a);
  }
  return cands;
}

/** The commit that introduced a line of the file as it stands at head ('' when blame cannot say). */
function blameCommit(root, head, file, line) {
  const r = spawnSync('git', ['blame', '-l', '--porcelain', '-L', `${line},${line}`, head, '--', file], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) return '';
  const m = (r.stdout || '').match(/^([0-9a-f]{40}) /);
  return m ? m[1] : '';
}

/**
 * Range mode. Drops the findings of lines that a deliberate revert put back. Only content findings can be
 * covered (never env_file). A flagged line is covered when `git blame` at the range head says a valid
 * revert commit of this range introduced it AND the shared ledger still holds that line: the ledger key is
 * (anchor sha, file, text), counted by how often the anchor removed it (old path on a rename). Every revert
 * commit of one anchor spends from the same entry for the lines it added itself. A merge, an older commit or anything unproven stays blocked.
 * Blame and the log run only when the whole-range scan already has a content finding.
 */
function applyRevertAllowance(root, o, findings, texts) {
  if (o.mode !== 'range' || !findings.some((f) => f.category !== 'env_file')) return findings;
  const head = rangeHead(root, o.range);
  if (!head) return findings;
  const cands = revertCandidates(root, o, head);
  if (cands.size === 0) return findings;
  // Shared ledger: (anchor, file, text) -> times the anchor removed that line. Every valid revert commit,
  // oldest first, spends it for the lines it ITSELF added, whether or not they survive to the head, so a
  // second trailer for the same cleanup finds the entry used up. What a revert commit won is its grant.
  const ledger = new Map();
  const loaded = new Set();
  const grants = new Map(); // revert commit -> Map(file\0text -> lines it may still put back)
  for (const [sha, a] of cands) {
    if (!loaded.has(a)) {
      loaded.add(a);
      const text = git(root, ['show', '--no-color', '--no-ext-diff', '--find-renames', '--format=', '-U0', a]);
      for (const d of diffLines(text, '-')) {
        const k = `${a}\0${d.file}\0${d.content}`;
        ledger.set(k, (ledger.get(k) || 0) + 1);
      }
    }
    const own = new Map();
    const added = git(root, ['show', '--no-color', '--no-ext-diff', '--find-renames', '--diff-filter=ACMRT', '--format=', '-U0', sha]);
    for (const d of diffLines(added, '+')) {
      const k = `${a}\0${d.file}\0${d.content}`;
      if (!(ledger.get(k) > 0)) continue;
      ledger.set(k, ledger.get(k) - 1);
      own.set(`${d.file}\0${d.content}`, (own.get(`${d.file}\0${d.content}`) || 0) + 1);
    }
    grants.set(sha, own);
  }
  const covered = new Set();
  const tried = new Set();
  for (const f of findings) {
    const lk = `${f.file}\0${f.line}`;
    if (f.category === 'env_file' || !f.line || tried.has(lk)) continue;
    tried.add(lk);
    const who = blameCommit(root, head, f.file, f.line);
    const own = grants.get(who);
    if (!own) continue;
    const k = `${f.file}\0${texts.get(lk)}`;
    if (!(own.get(k) > 0)) continue;
    own.set(k, own.get(k) - 1);
    covered.add(lk);
  }
  return findings.filter((f) => !covered.has(`${f.file}\0${f.line}`));
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
  const content = contentFindings(root, o);
  const findings = [];
  const candidates = [...envNameFindings(root, o), ...content.findings];
  const kept = applyRevertAllowance(root, o, candidates, content.texts);
  for (const f of kept) {
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
