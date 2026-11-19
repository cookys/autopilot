'use strict';

// root-scan-guard.js — refuse find/grep/rg searches that start at the filesystem root.
//
// classify({ tool, args, cwd }) -> { refuse, reason, root_path }
// refuse is true when a starting path resolves to `/` (or the tool's implicit `.`
// does, because cwd is `/`). Non-recursive grep of a file under / is allowed;
// a non-recursive read of `/` itself is not.
// Long options expand to a unique table entry (exact name, else one prefix).
// An ambiguous or unknown long option consumes nothing. When parsing is unsure,
// a root token that is not a known pattern/glob value refuses as `root-token`.
// grep/egrep/fgrep: every token except -e/--regexp/-f/--file values (including --regexp= and -ePATTERN) is checked, and -[1-9] or --depth/--max-depth/--min-depth marks the search recursive.
// find: the root-token backstop exempts only the single value after -name -iname -path -ipath -wholename -iwholename -regex -iregex -lname -ilname -newer -anewer -cnewer -samefile -fstype -user -group -perm -type -xtype -size -printf -fprintf -fprint -fls -context.
// A token is root when path.resolve(cwd, tok) is `/`, or the resolved path matches /proc/<pid|self|thread-self>/root, or fs.realpathSync of it is `/` (realpath errors fall back to the literal check).
// Shell-expanded `/*` is not visible to the guard (known limit).
// Node built-ins only. Contract: references/hetero-dispatch.md § Kimi broker implementer
// (Root-scan guard). Suite: hooks/tests/root-scan-guard.test.sh.

const fs = require('fs');
const path = require('path');

const FIND_BARE = new Set(['-H', '-L', '-P']);

const GREP_SHORT_VALUE = new Set(['e', 'f', 'd', 'm', 'A', 'B', 'C', 'D']);
const GREP_EXEMPT_SHORT = new Set(['e', 'f']);
// GNU grep --color/--colour take WHEN only as --color=WHEN, never the next argv.
const GREP_LONG = {
  recursive: { recursive: true },
  'dereference-recursive': { recursive: true },
  regexp: { value: true, pattern: true, exempt: true },
  file: { value: true, pattern: true, exempt: true },
  directories: { value: true, directories: true },
  exclude: { value: true },
  include: { value: true },
  'exclude-from': { value: true },
  'exclude-dir': { value: true },
  'include-dir': { value: true },
  label: { value: true },
  'binary-files': { value: true },
  context: { value: true },
  'after-context': { value: true },
  'before-context': { value: true },
  'max-count': { value: true },
  devices: { value: true },
  'group-separator': { value: true },
  color: { optional: true },
  colour: { optional: true },
  depth: { value: true, recursive: true },
  'max-depth': { value: true, recursive: true },
  'min-depth': { value: true, recursive: true },
};

// bfs/GNU find predicates whose immediate next token is an operand, not a path.
const FIND_VALUE_PRED = new Set([
  '-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename',
  '-regex', '-iregex', '-lname', '-ilname', '-newer', '-anewer', '-cnewer',
  '-samefile', '-fstype', '-user', '-group', '-perm', '-type', '-xtype',
  '-size', '-printf', '-fprintf', '-fprint', '-fls', '-context',
]);

// Resolved form. path.resolve already drops trailing slashes and a final `/.`.
const PROC_ROOT = /^\/proc\/(self|thread-self|[0-9]+)\/root\/*(\.)?\/*$/;

const RG_SHORT_VALUE = new Set(['e', 'f', 'g', 't', 'T', 'm', 'A', 'B', 'C', 'j', 'M', 'r', 'E', 'd']);
const RG_EXEMPT_SHORT = new Set(['e', 'f', 'g', 't', 'T']);
// rg --color WHEN does take a separate argument (unlike GNU grep).
const RG_LONG = {
  regexp: { value: true, pattern: true, exempt: true },
  file: { value: true, pattern: true, exempt: true },
  glob: { value: true, exempt: true },
  iglob: { value: true, exempt: true },
  type: { value: true, exempt: true },
  'type-not': { value: true, exempt: true },
  'type-add': { value: true },
  'type-clear': { value: true },
  'type-list': { filesMode: true },
  files: { filesMode: true },
  'max-count': { value: true },
  'after-context': { value: true },
  'before-context': { value: true },
  context: { value: true },
  threads: { value: true },
  'max-columns': { value: true },
  replace: { value: true },
  encoding: { value: true },
  'max-depth': { value: true },
  'path-separator': { value: true },
  pre: { value: true },
  'pre-glob': { value: true },
  'hostname-bin': { value: true },
  'hyperlink-format': { value: true },
  colors: { value: true },
  color: { value: true },
  sort: { value: true },
  sortr: { value: true },
  engine: { value: true },
  'ignore-file': { value: true },
  'max-filesize': { value: true },
  'context-separator': { value: true },
  'field-match-separator': { value: true },
  'field-context-separator': { value: true },
  'dfa-size-limit': { value: true },
  'regex-size-limit': { value: true },
};

function allow() {
  return { refuse: false, reason: '', root_path: null };
}

function deny(reason, rootPath) {
  return { refuse: true, reason, root_path: rootPath };
}

function isFilesystemRoot(operand, cwd) {
  const resolved = path.resolve(cwd, operand);
  if (path.posix.normalize(resolved) === '/') return true;
  if (PROC_ROOT.test(resolved)) return true;
  try {
    if (fs.realpathSync(resolved) === '/') return true;
  } catch (e) {
    // Missing path or unreadable: the literal checks above stand.
  }
  return false;
}

function firstRoot(paths, cwd) {
  for (const p of paths) {
    if (isFilesystemRoot(p, cwd)) return p;
  }
  return null;
}

function expandLong(table, name) {
  if (Object.prototype.hasOwnProperty.call(table, name)) {
    return table[name];
  }
  let match = null;
  for (const key of Object.keys(table)) {
    if (key.startsWith(name)) {
      if (match !== null) return null;
      match = key;
    }
  }
  if (match === null) return null;
  return table[match];
}

function classifyFind(args, cwd) {
  let i = 0;
  while (i < args.length) {
    const a = args[i];
    if (a === '--') { i += 1; continue; }
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
  const exempt = new Set();
  for (let k = 0; k < args.length; k += 1) {
    if (FIND_VALUE_PRED.has(args[k]) && k + 1 < args.length) exempt.add(k + 1);
  }
  if (starts.length === 0) starts.push('.');
  const rootTok = backstop(args, cwd, exempt);
  if (rootTok !== null) return deny('root-token', rootTok);
  const hit = firstRoot(starts, cwd);
  if (hit !== null) return deny('find starting point resolves to /', hit);
  return allow();
}

function takeValue(args, i, inline) {
  if (inline !== null) return { value: inline, next: i, index: null };
  return { value: args[i + 1], next: i + 1, index: i + 1 };
}

function scanOptions(args, shortValue, longTable, exemptShort, depthDigits) {
  let recursive = false;
  let patternFlag = false;
  let directoriesRecurse = false;
  let filesMode = false;
  const operands = [];
  const exempt = new Set();
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
      const spec = expandLong(longTable, name);
      if (!spec) continue;
      if (spec.recursive) recursive = true;
      if (spec.filesMode) filesMode = true;
      if (spec.optional) continue;
      if (spec.value) {
        const taken = takeValue(args, i, inline);
        i = taken.next;
        if (spec.pattern) patternFlag = true;
        if (spec.directories && taken.value === 'recurse') directoriesRecurse = true;
        if (spec.exempt && taken.index !== null && taken.index < args.length) exempt.add(taken.index);
      }
      continue;
    }
    let j = 1;
    while (j < a.length) {
      const ch = a[j];
      if (ch === 'r' || ch === 'R' || (depthDigits && ch >= '1' && ch <= '9')) recursive = true;
      if (shortValue.has(ch)) {
        const rest = a.slice(j + 1);
        let value;
        let valueIndex = null;
        if (rest.length > 0) value = rest;
        else {
          i += 1;
          value = args[i];
          valueIndex = i;
        }
        if (ch === 'e' || ch === 'f') patternFlag = true;
        if (ch === 'd' && value === 'recurse') directoriesRecurse = true;
        if (exemptShort.has(ch) && valueIndex !== null && valueIndex < args.length) exempt.add(valueIndex);
        break;
      }
      j += 1;
    }
  }
  return { recursive: recursive || directoriesRecurse, patternFlag, filesMode, operands, exempt };
}

function backstop(args, cwd, exempt) {
  for (let i = 0; i < args.length; i += 1) {
    if (exempt.has(i)) continue;
    if (typeof args[i] === 'string' && isFilesystemRoot(args[i], cwd)) return args[i];
  }
  return null;
}

function classifyGrep(args, cwd) {
  const scanned = scanOptions(args, GREP_SHORT_VALUE, GREP_LONG, GREP_EXEMPT_SHORT, true);
  const rootTok = backstop(args, cwd, scanned.exempt);
  if (rootTok !== null) return deny('root-token', rootTok);
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
  const scanned = scanOptions(args, RG_SHORT_VALUE, RG_LONG, RG_EXEMPT_SHORT, false);
  const rootTok = backstop(args, cwd, scanned.exempt);
  if (rootTok !== null) return deny('root-token', rootTok);
  const paths = (scanned.patternFlag || scanned.filesMode) ? scanned.operands : scanned.operands.slice(1);
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
