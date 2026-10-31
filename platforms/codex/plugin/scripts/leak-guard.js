#!/usr/bin/env node
'use strict';
/*
 * leak-guard.js — block personal data from entering tracked files.
 *
 *   node scripts/leak-guard.js [--staged | --range A..B] [--registry FILE] [--json]
 *
 * Scans ONLY the lines a change ADDS (git diff -U0 --find-renames, filter ACMR), so history is
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

function loadRegistry(file) {
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
  const a = ['diff', '--no-color', '--no-ext-diff', '--find-renames', '--diff-filter=ACMR', ...extra];
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

function contentFindings(root, o) {
  const text = git(root, diffArgs(o, ['-U0']));
  const out = [];
  let file = '';
  let line = 0;
  let inHunk = false;
  for (const l of text.split('\n')) {
    if (l.startsWith('diff --git ')) { inHunk = false; file = ''; continue; }
    if (!inHunk && l.startsWith('+++ ')) {
      const p = unquote(l.slice(4));
      file = p.startsWith('b/') ? p.slice(2) : p;
      continue;
    }
    if (l.startsWith('@@ ')) {
      const m = l.match(/\+(\d+)/);
      line = m ? parseInt(m[1], 10) : 0;
      inHunk = true;
      continue;
    }
    if (inHunk && l.startsWith('+') && file) {
      const content = l.slice(1);
      for (const h of patterns.findAll(content)) {
        const snippet = h.category === 'secret' ? `${h.match.slice(0, 4)}…` : h.match;
        out.push({ file, line, category: h.category, snippet });
      }
      line++;
    }
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
  const exempt = loadRegistry(o.registry ? path.resolve(o.registry) : path.join(root, DEFAULT_REGISTRY));

  const seen = new Set();
  const findings = [];
  for (const f of [...envNameFindings(root, o), ...contentFindings(root, o)]) {
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
    const rel = path.relative(process.cwd(), path.join(__dirname, 'redact-personal.js')) || 'scripts/redact-personal.js';
    out.push('Redact (rewrites the whole file, then re-stage it):');
    out.push(`  node ${shq(rel)} ${fixable.map(shq).join(' ')}`);
  }
  if (findings.some((f) => f.category === 'env_file')) out.push('An .env file cannot be redacted: unstage it (git rm --cached) and keep it out of the repo.');
  out.push(`A file that must keep a hit gets one entry (path, category, reason) in ${DEFAULT_REGISTRY}; directories and globs are refused.`);
  process.stderr.write(out.join('\n') + '\n');
  process.exit(1);
}

main();
