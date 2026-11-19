'use strict';

// root-scan-guard.js — refuse find/grep/rg searches that start at the filesystem root.
//
// classify({ tool, args, cwd }) -> { refuse, reason, root_path }
// refuse is true when a starting path resolves to `/` (or the tool's implicit `.`
// does, because cwd is `/`). Non-recursive grep of a file under / is allowed.
// Node built-ins only. Contract: references/hetero-dispatch.md § Kimi broker implementer
// (Root-scan guard). Suite: hooks/tests/root-scan-guard.test.sh.

const path = require('path');

const FIND_BARE = new Set(['-H', '-L', '-P']);
const GREP_SHORT_VALUE = new Set(['e', 'f', 'd', 'm', 'A', 'B', 'C', 'D']);
const GREP_LONG_VALUE = new Set([
  'regexp', 'file', 'directories', 'exclude', 'include', 'exclude-from',
  'exclude-dir', 'include-dir', 'label', 'binary-files', 'context',
  'after-context', 'before-context', 'max-count', 'devices', 'group-separator',
  'color',
]);
const RG_SHORT_VALUE = new Set(['e', 'f', 'g', 't', 'T', 'm', 'A', 'B', 'C', 'j', 'M', 'r', 'E', 'd']);
const RG_LONG_VALUE = new Set([
  'regexp', 'file', 'glob', 'iglob', 'type', 'type-not', 'max-count',
  'after-context', 'before-context', 'context', 'threads', 'max-columns',
  'replace', 'encoding', 'max-depth', 'path-separator', 'pre', 'pre-glob',
  'hostname-bin', 'hyperlink-format', 'colors',
]);

function allow() {
  return { refuse: false, reason: '', root_path: null };
}

function deny(reason, rootPath) {
  return { refuse: true, reason, root_path: rootPath };
}

function isFilesystemRoot(operand, cwd) {
  const resolved = path.resolve(cwd, operand);
  return path.posix.normalize(resolved) === '/';
}

function firstRoot(paths, cwd) {
  for (const p of paths) {
    if (isFilesystemRoot(p, cwd)) return p;
  }
  return null;
}

function classifyFind(args, cwd) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (FIND_BARE.has(a)) { i += 1; continue; }
    if (a === '-D') { i += 2; continue; }
    if (/^-O\d*$/.test(a)) { i += 1; continue; }
    break;
  }
  const starts = [];
  while (i < args.length) {
    const a = args[i];
    if (a.startsWith('-') || a.startsWith('(') || a.startsWith('!')) break;
    starts.push(a);
    i += 1;
  }
  if (starts.length === 0) starts.push('.');
  const hit = firstRoot(starts, cwd);
  if (hit !== null) return deny('find starting point resolves to /', hit);
  return allow();
}

function takeValue(args, i, inline) {
  if (inline !== null) return { value: inline, next: i };
  return { value: args[i + 1], next: i + 1 };
}

function scanOptions(args, shortValue, longValue) {
  let recursive = false;
  let patternFlag = false;
  let directoriesRecurse = false;
  const operands = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (a === '-' || !a.startsWith('-')) {
      operands.push(a);
      continue;
    }
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      const name = eq === -1 ? body : body.slice(0, eq);
      const inline = eq === -1 ? null : body.slice(eq + 1);
      if (name === 'recursive' || name === 'dereference-recursive') recursive = true;
      if (longValue.has(name)) {
        const taken = takeValue(args, i, inline);
        i = taken.next;
        if (name === 'regexp' || name === 'file') patternFlag = true;
        if (name === 'directories' && taken.value === 'recurse') directoriesRecurse = true;
      }
      continue;
    }
    let j = 1;
    while (j < a.length) {
      const ch = a[j];
      if (ch === 'r' || ch === 'R') recursive = true;
      if (shortValue.has(ch)) {
        const rest = a.slice(j + 1);
        let value;
        if (rest.length > 0) value = rest;
        else {
          i += 1;
          value = args[i];
        }
        if (ch === 'e' || ch === 'f') patternFlag = true;
        if (ch === 'd' && value === 'recurse') directoriesRecurse = true;
        break;
      }
      j += 1;
    }
  }
  return { recursive: recursive || directoriesRecurse, patternFlag, operands };
}

function classifyGrep(args, cwd) {
  const scanned = scanOptions(args, GREP_SHORT_VALUE, GREP_LONG_VALUE);
  if (!scanned.recursive) return allow();
  const paths = scanned.patternFlag ? scanned.operands : scanned.operands.slice(1);
  if (paths.length === 0) {
    if (isFilesystemRoot('.', cwd)) return deny('grep recursive search has no path and cwd is /', '.');
    return allow();
  }
  const hit = firstRoot(paths, cwd);
  if (hit !== null) return deny('grep recursive path resolves to /', hit);
  return allow();
}

function classifyRg(args, cwd) {
  const scanned = scanOptions(args, RG_SHORT_VALUE, RG_LONG_VALUE);
  const paths = scanned.patternFlag ? scanned.operands : scanned.operands.slice(1);
  if (paths.length === 0) {
    if (isFilesystemRoot('.', cwd)) return deny('rg search has no path and cwd is /', '.');
    return allow();
  }
  const hit = firstRoot(paths, cwd);
  if (hit !== null) return deny('rg path resolves to /', hit);
  return allow();
}

function classify({ tool, args, cwd }) {
  const list = Array.isArray(args) ? args : [];
  const dir = typeof cwd === 'string' && cwd.length > 0 ? cwd : '/';
  if (tool === 'find') return classifyFind(list, dir);
  if (tool === 'grep' || tool === 'egrep' || tool === 'fgrep') return classifyGrep(list, dir);
  if (tool === 'rg') return classifyRg(list, dir);
  return allow();
}

module.exports = { classify };
