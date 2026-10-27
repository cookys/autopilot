#!/usr/bin/env node
'use strict';

// gate-verify.js - generic verifier for the depth-0 per-turn gate (plan
// docs/plans/2026-10-26-depth0-per-turn-gate.md, section 3.2).
//
// Interface of evals/orchestration/tasks/t14-constraint-horizon/gate/verify-turn.js:
//   gate-verify.js --turn <n> --repo <dir> --json [--gate-file <f> | --rules <f> --base <sha> [--mode <m>]]
// The gate file may also come from AUTOPILOT_GATE_FILE (the hook passes it that way).
//   gate-verify.js --check (--gate-file <f> | --rules <f> --base <sha>) [--repo <dir>] [--json]
//
// Exit codes: 0 clean, 1 at least one violation, 2 error (unreadable or invalid
// list, unknown key, duplicate id, more than 40 rules, unregistered check name,
// a registry check that times out, a registry `files` entry missing at <base>, an `argv` path that is not an
// exported file / built-in / bare interpreter name, path-safety failure, any
// internal error). The hook turns 2 into allow plus `error`.
// stdout (--json): {violations: [{constraint, rule, evidence}], feature_gaps: [string]}.
// --check prints {ok, errors} and exits 0 or 2; it writes nothing.
//
// Node built-ins only (Node >= 20.10). Rule lists are data: no rule carries
// command text; registered checks come from <base> bytes, never the worker tree.
// Status: not wired to any hook or rail yet (P1 of the plan; wiring is P2).

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const MAX_RULES = 40;
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HITS_PER_RULE = 50;
// Worktree walk cap, per operation (one forbid_paths prefix, one forbid_text rule, one built-in).
// 200k entries: a large monorepo checkout is ~50k files; 200k is a few seconds of lstat, well
// inside the hook's 30 s verifier budget, and anything bigger is not a repo this gate should walk.
const MAX_WALK_ENTRIES = 200000;
const DEFAULT_CHECK_TIMEOUT_S = 20;
const MAX_CHECK_TIMEOUT_S = 120;
const INTERPRETERS = new Set(['node', 'sh', 'bash', 'python3', 'python']);
// argv allowlist (structural, not an enumeration of forbidden flags): an argument is an
// exported file, or exactly one of these value-less flags that execute no code. Every other
// argument starting with '-' (joined short flags such as -cCODE, --x=y, value-taking flags,
// a lone '-') is rejected. Value-taking flags are all rejected for now.
const ALLOWED_FLAGS = ['--test', '--no-warnings', '--check', '-I', '-B'];
const BUILTINS = new Set(['no-conflict-markers', 'js-syntax']);
const GATE_KEYS = ['v', 'repo', 'base', 'mode', 'max_blocks', 'expires_at', 'rules'];
const RULE_KEYS = ['v', 'forbid_paths', 'require_files', 'require_text', 'forbid_text', 'must_pass', 'features'];
const KIND_FIELDS = {
  forbid_paths: { req: ['id', 'glob'], opt: ['why'] },
  require_files: { req: ['id', 'path'], opt: ['why'] },
  require_text: { req: ['id', 'path', 'text'], opt: ['why'] },
  forbid_text: { req: ['id', 'glob', 'text'], opt: ['why'] },
  must_pass: { req: ['id', 'check'], opt: ['why'] },
  features: { req: ['id', 'check'], opt: ['label', 'why'] },
};

class Fail extends Error {}
function fail(msg) { throw new Fail(msg); }

// ---------------------------------------------------------------- git

function gitEnv() {
  const env = {};
  for (const k of Object.keys(process.env)) if (!k.startsWith('GIT_')) env[k] = process.env[k];
  env.GIT_OPTIONAL_LOCKS = '0';
  // The worker owns its repo: a replace ref must not change what base bytes read.
  env.GIT_NO_REPLACE_OBJECTS = '1';
  return env;
}

function git(repo, args, opts) {
  // Defence in depth: nothing in the worker's .git/config may run code or hide files.
  // Only object-database reads are used (ls-tree, cat-file, show, rev-parse); none reads the
  // worker's index, ignore rules or fsmonitor.
  const full = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.excludesFile=/dev/null'].concat(args);
  const r = cp.spawnSync('git', full, {
    cwd: repo, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
    timeout: 60000,
  });
  if (r.error) fail('git failed: ' + r.error.message);
  if (r.status !== 0 && !(opts && opts.allowFail)) fail('git ' + args.filter((a) => !a.startsWith('-'))[0] + ' failed: ' + String(r.stderr).slice(0, 200));
  return r;
}

function nulList(buf) { return String(buf).split('\0').filter(Boolean); }

function baseResolves(repo, base) {
  return git(repo, ['cat-file', '-e', base + '^{commit}'], { allowFail: true }).status === 0;
}

function blobAtBase(repo, base, rel) {
  const out = String(git(repo, ['--literal-pathspecs', 'ls-tree', base, '--', rel]).stdout);
  return /^\d+ blob /.test(out);
}

// ---------------------------------------------------------------- paths and globs

function inside(real, root) { return real === root || real.startsWith(root + path.sep); }

const GLOB_BAD = /[\[\]{}()!\\]/;

// Returns {norm} or {error}. `isGlob` also validates the glob subset.
function normaliseRel(p, isGlob) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 512) return { error: 'must be a non-empty string up to 512 chars' };
  if (p.includes('\0') || p.includes('\\')) return { error: 'contains NUL or backslash' };
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { error: 'absolute path' };
  if (p.split('/').includes('..')) return { error: 'contains a .. segment' };
  let norm = path.posix.normalize(p);
  if (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
  if (norm === '.' || norm === '') return { error: 'empty after normalisation' };
  if (isGlob) {
    if (GLOB_BAD.test(norm)) return { error: 'unsupported glob metacharacter (only * ** ? are allowed)' };
    for (const seg of norm.split('/')) {
      if (seg.includes('**') && seg !== '**') return { error: '** must be a whole path segment' };
    }
  }
  return { norm };
}

function literalPrefix(norm, isGlob) {
  const segs = norm.split('/');
  if (!isGlob) return segs;
  const out = [];
  for (const s of segs) { if (/[*?]/.test(s)) break; out.push(s); }
  return out;
}

// Deepest existing ancestor must resolve inside the repo (a symlink out is rejected).
function containedInRepo(segs, repoReal) {
  let cur = repoReal;
  for (const seg of segs) {
    const next = path.join(cur, seg);
    try { fs.lstatSync(next); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') break;
      return false;
    }
    let real;
    try { real = fs.realpathSync(next); } catch (e) { return false; }
    if (!inside(real, repoReal)) return false;
    cur = next;
  }
  return true;
}

function checkPathField(p, isGlob, repoReal, errs, label) {
  const n = normaliseRel(p, isGlob);
  if (n.error) { errs.push(label + ': ' + n.error); return null; }
  if (!containedInRepo(literalPrefix(n.norm, isGlob), repoReal)) {
    errs.push(label + ': resolves outside the repo (symlink escape)');
    return null;
  }
  return n.norm;
}

function globToSegRegex(seg) {
  let re = '^';
  for (const ch of seg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^$|\\/]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

function matchGlob(glob, rel) {
  const gs = glob.split('/');
  const ps = rel.split('/');
  const memo = new Map();
  function go(gi, pi) {
    const key = gi * 10000 + pi;
    if (memo.has(key)) return memo.get(key);
    let res;
    if (gi === gs.length) res = pi === ps.length;
    else if (gs[gi] === '**') {
      res = false;
      for (let k = pi; k <= ps.length && !res; k++) res = go(gi + 1, k);
    } else if (pi === ps.length) res = false;
    else res = globToSegRegex(gs[gi]).test(ps[pi]) && go(gi + 1, pi + 1);
    memo.set(key, res);
    return res;
  }
  return go(0, 0);
}

// ---------------------------------------------------------------- rule list validation

function isPlainObject(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function validateRules(rules, repoReal, errs) {
  if (!isPlainObject(rules)) { errs.push('rule list must be an object'); return []; }
  for (const k of Object.keys(rules)) if (!RULE_KEYS.includes(k)) errs.push('unknown key: ' + k);
  if (rules.v !== 1) errs.push('v must be the integer 1');
  const flat = [];
  const ids = new Set();
  for (const kind of Object.keys(KIND_FIELDS)) {
    if (rules[kind] === undefined) continue;
    if (!Array.isArray(rules[kind])) { errs.push(kind + ' must be an array'); continue; }
    const spec = KIND_FIELDS[kind];
    rules[kind].forEach((entry, i) => {
      const label = kind + '[' + i + ']';
      if (!isPlainObject(entry)) { errs.push(label + ': must be an object'); return; }
      for (const k of Object.keys(entry)) {
        if (!spec.req.includes(k) && !spec.opt.includes(k)) errs.push(label + ': unknown key ' + k);
      }
      for (const k of spec.req) if (entry[k] === undefined) errs.push(label + ': missing ' + k);
      if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) errs.push(label + ': bad id');
      else if (ids.has(entry.id)) errs.push(label + ': duplicate id ' + entry.id);
      else ids.add(entry.id);
      for (const k of ['why', 'label']) {
        if (entry[k] !== undefined && (typeof entry[k] !== 'string' || entry[k].length > 300)) errs.push(label + ': ' + k + ' must be a string up to 300 chars');
      }
      if ((kind === 'require_text' || kind === 'forbid_text') && entry.text !== undefined
        && (typeof entry.text !== 'string' || entry.text.length === 0 || entry.text.length > 1000)) {
        errs.push(label + ': text must be a non-empty string up to 1000 chars');
      }
      if ((kind === 'must_pass' || kind === 'features') && entry.check !== undefined
        && (typeof entry.check !== 'string' || !ID_RE.test(entry.check))) {
        errs.push(label + ': bad check name');
      }
      let norm = null;
      if (entry.glob !== undefined) norm = checkPathField(entry.glob, true, repoReal, errs, label + '.glob');
      if (entry.path !== undefined) norm = checkPathField(entry.path, false, repoReal, errs, label + '.path');
      flat.push({ kind, entry, norm });
    });
  }
  if (flat.length > MAX_RULES) errs.push('more than ' + MAX_RULES + ' rules (' + flat.length + ')');
  return flat;
}

// ---------------------------------------------------------------- registry and checks

function loadRegistry(repo, base) {
  if (!blobAtBase(repo, base, '.claude/gate-checks.json')) return null;
  const r = git(repo, ['show', base + ':./.claude/gate-checks.json']);
  let reg;
  try { reg = JSON.parse(String(r.stdout)); } catch (e) { fail('registry at base is not valid JSON'); }
  return reg;
}

// Returns a normalised registry entry or pushes errors. `files` and `argv` are
// validated here so that --check and the run share one rule.
function validateRegistryEntry(name, entry, repoReal, repo, base, errs) {
  const label = 'registry check ' + name;
  if (!isPlainObject(entry)) { errs.push(label + ': must be an object'); return null; }
  for (const k of Object.keys(entry)) if (!['argv', 'files', 'timeout_s'].includes(k)) errs.push(label + ': unknown key ' + k);
  const files = [];
  if (!Array.isArray(entry.files) || entry.files.length === 0) errs.push(label + ': files must be a non-empty array');
  else {
    for (const f of entry.files) {
      const n = normaliseRel(f, false);
      if (n.error) { errs.push(label + ': files entry ' + JSON.stringify(f) + ': ' + n.error); continue; }
      if (/[*?]/.test(n.norm)) { errs.push(label + ': files entries are literal paths'); continue; }
      if (!blobAtBase(repo, base, n.norm)) { errs.push(label + ': files entry missing at base: ' + n.norm); continue; }
      files.push(n.norm);
    }
  }
  let timeoutS = DEFAULT_CHECK_TIMEOUT_S;
  if (entry.timeout_s !== undefined) {
    if (!Number.isInteger(entry.timeout_s) || entry.timeout_s < 1 || entry.timeout_s > MAX_CHECK_TIMEOUT_S) {
      errs.push(label + ': timeout_s must be an integer 1-' + MAX_CHECK_TIMEOUT_S);
    } else timeoutS = entry.timeout_s;
  }
  const argv = entry.argv;
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string' || a.length === 0 || a.length > 500 || a.includes('\0'))) {
    errs.push(label + ': argv must be a non-empty array of strings');
    return null;
  }
  const fileSet = new Set(files);
  argv.forEach((a, i) => {
    if (i === 0 && INTERPRETERS.has(a)) return;
    if (i > 0 && a.startsWith('-')) {
      if (!ALLOWED_FLAGS.includes(a)) errs.push(label + ': argv flag ' + JSON.stringify(a) + ' is not in the allowed value-less flag list');
      return;
    }
    const n = normaliseRel(a, false);
    if (n.error || !fileSet.has(n.norm)) errs.push(label + ': argv[' + i + '] ' + JSON.stringify(a) + ' is not an exported file, a built-in or a bare interpreter name');
  });
  return { argv, files, timeoutS };
}

// Collects errors for every referenced check; returns Map name -> resolution.
function resolveChecks(flat, repoReal, repo, base, errs) {
  const names = new Set();
  for (const f of flat) if (f.kind === 'must_pass' || f.kind === 'features') names.add(f.entry.check);
  const out = new Map();
  if (names.size === 0) return out;
  let reg = null;
  const regErrs = [];
  if (blobAtBase(repo, base, '.claude/gate-checks.json')) {
    reg = loadRegistry(repo, base);
    if (!isPlainObject(reg) || reg.v !== 1 || !isPlainObject(reg.checks)) { regErrs.push('registry must be {v:1, checks:{...}}'); reg = null; }
    else for (const k of Object.keys(reg)) if (!['v', 'checks'].includes(k)) regErrs.push('registry: unknown key ' + k);
  }
  for (const e of regErrs) errs.push(e);
  for (const name of names) {
    if (reg && Object.prototype.hasOwnProperty.call(reg.checks, name)) {
      const e2 = [];
      const norm = validateRegistryEntry(name, reg.checks[name], repoReal, repo, base, e2);
      for (const e of e2) errs.push(e);
      if (norm && e2.length === 0) out.set(name, { kind: 'registry', ...norm });
    } else if (BUILTINS.has(name)) out.set(name, { kind: 'builtin', name });
    else errs.push('unregistered check name: ' + name + (reg ? '' : ' (no registry at base)'));
  }
  return out;
}

// ---------------------------------------------------------------- loading input

function parseArgs(argv) {
  const opts = { json: false, check: false };
  const withValue = new Set(['--turn', '--repo', '--gate-file', '--rules', '--base', '--mode', '--walk-limit']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--check') opts.check = true;
    else if (withValue.has(a)) {
      if (i + 1 >= argv.length) fail('missing value for ' + a);
      opts[a.slice(2).replace(/-/g, '_')] = argv[++i];
    } else fail('unknown argument: ' + a);
  }
  return opts;
}

function readJsonFile(file, what) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail(what + ' unreadable: ' + e.message); }
  try { return JSON.parse(text); } catch (e) { fail(what + ' is not valid JSON'); }
}

function loadInput(opts, repoReal) {
  const gateFile = opts.gate_file || process.env.AUTOPILOT_GATE_FILE;
  if (gateFile && opts.rules) fail('use --gate-file or --rules, not both');
  if (gateFile) {
    const g = readJsonFile(gateFile, 'gate file');
    if (!isPlainObject(g)) fail('gate file must be an object');
    const errs = [];
    for (const k of Object.keys(g)) if (!GATE_KEYS.includes(k)) errs.push('unknown gate-file key: ' + k);
    if (g.v !== 1) errs.push('gate file v must be 1');
    if (typeof g.repo !== 'string' || !path.isAbsolute(g.repo)) errs.push('gate file repo must be an absolute path');
    else {
      let real = null;
      try { real = fs.realpathSync(g.repo); } catch (e) { /* mismatch below */ }
      if (real !== repoReal) errs.push('gate file repo does not match --repo');
    }
    if (typeof g.base !== 'string' || !SHA_RE.test(g.base)) errs.push('gate file base must be a 40-hex sha');
    if (g.mode !== 'violations' && g.mode !== 'violations+features') errs.push('gate file mode must be violations or violations+features');
    if (!Number.isInteger(g.max_blocks) || g.max_blocks < 0 || g.max_blocks > 2) errs.push('gate file max_blocks must be an integer 0-2');
    if (typeof g.expires_at !== 'string' || !ISO_RE.test(g.expires_at) || Number.isNaN(Date.parse(g.expires_at))) errs.push('gate file expires_at must be an ISO 8601 date-time (YYYY-MM-DDTHH:MM:SS[.fff]Z|+hh:mm)');
    if (errs.length) fail(errs.join('; '));
    return { rules: g.rules, base: g.base, mode: g.mode };
  }
  if (opts.rules) {
    if (!opts.base || !SHA_RE.test(opts.base)) fail('--rules needs --base <40-hex sha>');
    const mode = opts.mode || 'violations+features';
    if (mode !== 'violations' && mode !== 'violations+features') fail('bad --mode');
    return { rules: readJsonFile(opts.rules, 'rules file'), base: opts.base, mode };
  }
  fail('no rule list: pass --gate-file, --rules, or set AUTOPILOT_GATE_FILE');
  return null;
}

// Shared by --check and verification. Returns {flat, checks}; throws Fail on any error.
function prepare(input, repo, repoReal) {
  const errs = [];
  if (!baseResolves(repo, input.base)) fail('base does not resolve to a commit');
  const flat = validateRules(input.rules, repoReal, errs);
  const checks = errs.length ? new Map() : resolveChecks(flat, repoReal, repo, input.base, errs);
  for (const f of flat) {
    if (f.kind === 'require_text' && f.norm && !blobAtBase(repo, input.base, f.norm)) errs.push(f.kind + ' ' + f.entry.id + ': path does not exist at base: ' + f.norm);
  }
  if (errs.length) fail(errs.join('; '));
  return { flat, checks };
}

// ---------------------------------------------------------------- evaluation

// States: {state:'ok', text} | {state:'missing'} (really absent, or not a regular file) |
// {state:'skip', reason} (only the two cases the plan names: too large, outside the repo).
// Any other failure to look or read (permission, I/O) is exit 2, never "no change".
function readWorktreeFile(repoReal, rel) {
  const abs = path.join(repoReal, rel);
  let real;
  try { real = fs.realpathSync(abs); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { state: 'missing' };
    return fail('cannot resolve ' + rel + ': ' + e.code);
  }
  if (!inside(real, repoReal)) return { state: 'skip', reason: 'outside' };
  let st;
  try { st = fs.statSync(real); } catch (e) { return e.code === 'ENOENT' ? { state: 'missing' } : fail('cannot stat ' + rel + ': ' + e.code); }
  if (!st.isFile()) return { state: 'missing' };
  if (st.size > MAX_FILE_BYTES) return { state: 'skip', reason: 'too-large' };
  try { return { state: 'ok', text: fs.readFileSync(real, 'utf8') }; } catch (e) { return e.code === 'ENOENT' ? { state: 'missing' } : fail('cannot read ' + rel + ': ' + e.code); }
}

function isRegularFileInRepo(repoReal, rel) {
  try {
    const real = fs.realpathSync(path.join(repoReal, rel));
    return inside(real, repoReal) && fs.statSync(real).isFile();
  } catch (e) { return false; }
}

// ---- worker state is read from the filesystem and the object database only ----
// Never from the worker's index, ignore rules or config: git diff / ls-files / status would trust
// .git/info/exclude, core.excludesFile, committed .gitignore, assume-unchanged, skip-worktree and
// core.fsmonitor, all of which the worker controls.

const walkState = { n: 0, limit: MAX_WALK_ENTRIES };
function newWalk() { walkState.n = 0; }
function tick() { if (++walkState.n > walkState.limit) fail('worktree walk exceeds ' + walkState.limit + ' entries'); }

function prefixOf(norm) { return literalPrefix(norm, true).join('/'); }

// base side: {path -> {mode, sha}} under `prefix` (all of base when prefix is empty)
function baseEntries(repo, base, prefix) {
  const args = ['--literal-pathspecs', 'ls-tree', '-r', '-z', base];
  if (prefix) args.push('--', prefix);
  const out = new Map();
  const raw = git(repo, args).stdout;
  if (!Buffer.from(String(raw), 'utf8').equals(raw)) fail('non-UTF-8 path in the base tree');
  for (const rec of nulList(raw)) {
    tick();
    const tab = rec.indexOf('\t');
    out.set(rec.slice(tab + 1), { mode: rec.slice(0, tab).split(' ')[0], sha: rec.slice(0, tab).split(' ')[2] });
  }
  return out;
}

function escapeName(buf) {
  let o = '';
  for (const c of buf) o += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '\\x' + c.toString(16).padStart(2, '0');
  return o;
}

function noOpaque(entries, what) {
  const bad = entries.find((e) => e.opaque);
  if (bad) fail('cannot read content: non-UTF-8 name ' + bad.rel + ' (' + what + ')');
  return entries;
}

function gitlinksOf(b) { return new Set(Array.from(b).filter(([, e]) => e.mode === '160000').map(([p]) => p)); }

// worktree side: [{rel, kind: file|symlink|gitlink, exec}] under `prefix`. Only the repo ROOT
// `.git` is skipped. A nested `.git` is an ordinary entry; a directory is a gitlink only where
// base itself has a 160000 entry at that path. Symlinks are entries and are never followed.
// Anything that cannot be looked at or listed is exit 2 (only a path that vanished is absent).
function walkFs(repoReal, prefix, gitlinks) {
  const out = [];
  const segs = prefix ? prefix.split('/') : [];
  let rel = '';
  for (let i = 0; i < segs.length; i++) {
    rel = rel ? rel + '/' + segs[i] : segs[i];
    if (i === 0 && segs[i] === '.git') return out;
    let st;
    try { st = fs.lstatSync(path.join(repoReal, rel)); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return out;
      return fail('cannot look at ' + rel + ': ' + e.code);
    }
    if (i < segs.length - 1 && !st.isDirectory()) return out;
  }
  function opaqueEntry(r, abs, n) {
    tick();
    let st;
    try { st = fs.lstatSync(Buffer.concat([Buffer.from(abs + '/'), n.buf])); } catch (e) {
      if (e.code === 'ENOENT') return;
      return fail('cannot look at a non-UTF-8 name under ' + (r || '.') + ': ' + e.code);
    }
    out.push({ rel: (r ? r + '/' : '') + n.name, kind: st.isDirectory() ? 'dir' : 'file', opaque: true });
  }
  function visit(r) {
    tick();
    const abs = r ? path.join(repoReal, r) : repoReal;
    let st;
    try { st = fs.lstatSync(abs); } catch (e) {
      if (e.code === 'ENOENT') return; // vanished while walking
      return fail('cannot look at ' + r + ': ' + e.code);
    }
    if (st.isSymbolicLink()) out.push({ rel: r, kind: 'symlink' });
    else if (st.isFile()) out.push({ rel: r, kind: 'file', exec: (st.mode & 0o100) !== 0 });
    else if (st.isDirectory()) {
      if (gitlinks.has(r)) { out.push({ rel: r, kind: 'gitlink' }); return; }
      let names;
      // Raw bytes, not decoded strings. A name that does not round-trip through UTF-8 cannot be
      // matched, lstat()ed or reported as a string, and decoding it lossily would make the entry
      // look vanished. It becomes an OPAQUE entry (escaped display name, never read as a string):
      // forbid_paths treats it as an added path, every consumer that must read content stops
      // with exit 2, and an opaque directory no forbid rule names is exit 2 as well.
      let raw;
      try { raw = fs.readdirSync(abs, { encoding: 'buffer' }); } catch (e) {
        if (e.code === 'ENOENT') return;
        return fail('cannot list ' + (r || '.') + ': ' + e.code);
      }
      names = raw.map((buf) => {
        const str = buf.toString('utf8');
        return Buffer.from(str, 'utf8').equals(buf) ? { name: str } : { name: escapeName(buf), buf, opaque: true };
      }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const n of names) {
        if (n.opaque) { opaqueEntry(r, abs, n); continue; }
        if (!(n.name === '.git' && !r)) visit(r ? r + '/' + n.name : n.name);
      }
    }
  }
  visit(rel);
  return out;
}

// Commit a worktree submodule is really at, read without trusting the parent repo or any
// worker config (the -c flags and the scrubbed env apply). Unreadable or undecidable is exit 2.
function submoduleHead(repoReal, rel) {
  const dir = path.join(repoReal, rel);
  const r = git(dir, ['rev-parse', '--show-toplevel', 'HEAD'], { allowFail: true });
  if (r.status !== 0) return fail('cannot read the HEAD of submodule ' + rel);
  const [top, head] = String(r.stdout).trim().split('\n');
  if (top !== fs.realpathSync(dir)) return fail('submodule ' + rel + ' is not its own repository');
  if (!SHA_RE.test(head || '')) return fail('submodule ' + rel + ' has no readable HEAD commit');
  return head;
}

function blobSha(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
}

function wtBlobSha(repoReal, e) {
  const abs = path.join(repoReal, e.rel);
  try { return blobSha(e.kind === 'symlink' ? Buffer.from(fs.readlinkSync(abs)) : fs.readFileSync(abs)); } catch (err) {
    if (err.code === 'ENOENT') return null; // vanished: differs from base
    return fail('cannot read ' + e.rel + ': ' + err.code);
  }
}

function baseKind(be) { return be.mode === '120000' ? 'symlink' : be.mode === '160000' ? 'gitlink' : 'file'; }

function differs(repoReal, be, we) {
  if (baseKind(be) !== we.kind) return true;
  if (we.kind === 'gitlink') return submoduleHead(repoReal, we.rel) !== be.sha;
  if (we.kind === 'file' && (be.mode === '100755') !== we.exec) return true;
  return wtBlobSha(repoReal, we) !== be.sha;
}

// Paths that differ between base and the worktree: deleted, added, or different bytes/mode.
function changedPaths(repo, repoReal, base, prefixes) {
  const changed = new Set();
  const opaqueDirs = [];
  for (const prefix of new Set(prefixes)) {
    newWalk();
    const b = baseEntries(repo, base, prefix);
    const w = new Map(walkFs(repoReal, prefix, gitlinksOf(b)).map((e) => [e.rel, e]));
    for (const [p, be] of b) { const we = w.get(p); if (!we || differs(repoReal, be, we)) changed.add(p); }
    for (const p of w.keys()) if (!b.has(p)) changed.add(p);
    for (const e of w.values()) if (e.opaque && e.kind === 'dir') opaqueDirs.push(e.rel);
  }
  return { changed: Array.from(changed).sort(), opaqueDirs };
}

function walkFiles(repo, repoReal, base, prefix) {
  newWalk();
  const gitlinks = gitlinksOf(baseEntries(repo, base, prefix));
  return noOpaque(walkFs(repoReal, prefix, gitlinks), 'text rule').filter((e) => e.kind === 'file').map((e) => e.rel);
}

function builtinNoConflictMarkers(repo, repoReal, base) {
  for (const rel of walkFiles(repo, repoReal, base, '')) {
    const r = readWorktreeFile(repoReal, rel);
    if (r.state !== 'ok' || r.text.slice(0, 8000).includes('\0')) continue;
    const lines = r.text.split('\n');
    // Standard forms: <<<<<<< x, >>>>>>> x, diff3 ||||||| x, and the lone ======= separator
    // (the lone separator is not flagged in prose files, where it is a heading underline).
    const lone = !/\.(md|markdown|rst|adoc|txt)$/i.test(rel);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (/^(<{7}|>{7}|\|{7})( |$)/.test(line) || (lone && /^={7}$/.test(line))) return { ok: false, evidence: rel + ':' + (i + 1) };
    }
  }
  return { ok: true };
}

function builtinJsSyntax(repo, repoReal, base) {
  newWalk();
  const b = baseEntries(repo, base, '');
  for (const e of noOpaque(walkFs(repoReal, '', gitlinksOf(b)), 'js-syntax')) {
    const rel = e.rel;
    if (e.kind !== 'file' || !/\.(js|cjs|mjs)$/.test(rel)) continue;
    const be = b.get(rel);
    if (be && !differs(repoReal, be, e)) continue; // unchanged since base
    const abs = path.join(repoReal, rel);
    if (readWorktreeFile(repoReal, rel).state !== 'ok') continue;
    const r = cp.spawnSync(process.execPath, ['--check', abs], { cwd: repoReal, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, env: { PATH: process.env.PATH } });
    if (r.status !== 0) return { ok: false, evidence: rel + ': ' + String(r.stderr).slice(0, 200) };
  }
  return { ok: true };
}

function runRegistryCheck(res, repo, repoReal, base) {
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-verify-'));
    const tmpReal = fs.realpathSync(tmp);
    if (inside(tmpReal, repoReal)) fail('temp directory lies inside the worker repo');
    for (const rel of res.files) {
      const blob = git(repo, ['show', base + ':./' + rel]).stdout;
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, blob, { mode: rel === normaliseRel(res.argv[0], false).norm ? 0o755 : 0o644 });
    }
    const env = {
      PATH: process.env.PATH || '/usr/bin:/bin', HOME: tmp, TMPDIR: tmp, LANG: 'C',
      AUTOPILOT_GATE_REPO: repoReal,
    };
    const cmd = INTERPRETERS.has(res.argv[0]) ? res.argv[0] : path.join(tmp, normaliseRel(res.argv[0], false).norm);
    const r = cp.spawnSync(cmd, res.argv.slice(1), {
      cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: res.timeoutS * 1000,
      killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, shell: false,
    });
    // A timeout is an error (plan section 6): exit 2, never a violation or a feature gap.
    if (r.error && r.error.code === 'ETIMEDOUT') fail('check timed out after ' + res.timeoutS + 's');
    if (r.error) fail('check could not start: ' + r.error.message);
    if (r.status !== 0) {
      const tail = r.status === null ? 'signal ' + r.signal : 'exit ' + r.status;
      return { ok: false, evidence: tail + ': ' + String(r.stderr).slice(0, 200) };
    }
    return { ok: true };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function runCheck(name, checks, repo, repoReal, base) {
  const res = checks.get(name);
  if (res.kind === 'builtin') {
    return name === 'js-syntax' ? builtinJsSyntax(repo, repoReal, base) : builtinNoConflictMarkers(repo, repoReal, base);
  }
  return runRegistryCheck(res, repo, repoReal, base);
}

function evaluate(prep, input, repo, repoReal) {
  const violations = [];
  const gaps = [];
  const viol = (e, kind, evidence) => violations.push({ constraint: e.id, rule: e.why || (kind + ' ' + e.id), evidence });
  const base = input.base;
  const wanted = (k) => prep.flat.filter((f) => f.kind === k);

  const forbid = wanted('forbid_paths');
  if (forbid.length) {
    const { changed, opaqueDirs } = changedPaths(repo, repoReal, base, forbid.map((f) => prefixOf(f.norm)));
    for (const d of opaqueDirs) {
      if (!forbid.some((f) => matchGlob(f.norm, d))) fail('directory with a non-UTF-8 name ' + d + ' cannot be searched');
    }
    for (const f of forbid) {
      let n = 0;
      for (const rel of changed) {
        if (matchGlob(f.norm, rel) && n++ < MAX_HITS_PER_RULE) viol(f.entry, 'forbid_paths', rel);
      }
    }
  }
  for (const f of wanted('require_files')) {
    if (!isRegularFileInRepo(repoReal, f.norm)) viol(f.entry, 'require_files', f.norm + ': missing or not a regular file');
  }
  for (const f of wanted('require_text')) {
    const r = readWorktreeFile(repoReal, f.norm);
    if (r.state === 'missing') viol(f.entry, 'require_text', f.norm + ': file missing');
    else if (r.state === 'ok' && !r.text.includes(f.entry.text)) viol(f.entry, 'require_text', f.norm + ': text not found');
  }
  const ft = wanted('forbid_text');
  if (ft.length) {
    for (const f of ft) {
      let n = 0;
      for (const rel of walkFiles(repo, repoReal, base, prefixOf(f.norm))) {
        if (!matchGlob(f.norm, rel)) continue;
        const r = readWorktreeFile(repoReal, rel);
        if (r.state !== 'ok') continue;
        const idx = r.text.indexOf(f.entry.text);
        if (idx >= 0 && n++ < MAX_HITS_PER_RULE) viol(f.entry, 'forbid_text', rel + ':' + (r.text.slice(0, idx).split('\n').length));
      }
    }
  }
  for (const f of wanted('must_pass')) {
    const r = runCheck(f.entry.check, prep.checks, repo, repoReal, base);
    if (!r.ok) viol(f.entry, 'must_pass', r.evidence);
  }
  if (input.mode === 'violations+features') {
    for (const f of wanted('features')) {
      const r = runCheck(f.entry.check, prep.checks, repo, repoReal, base);
      if (!r.ok) gaps.push(f.entry.id + ': ' + (f.entry.label || f.entry.check));
    }
  }
  return { violations, feature_gaps: gaps };
}

// ---------------------------------------------------------------- main

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.turn !== undefined && !/^[0-9]{1,9}$/.test(opts.turn)) fail('--turn must be a non-negative integer');
  if (opts.walk_limit !== undefined) {
    if (!/^[0-9]{1,6}$/.test(opts.walk_limit) || Number(opts.walk_limit) < 1 || Number(opts.walk_limit) > MAX_WALK_ENTRIES) fail('--walk-limit must be an integer 1-' + MAX_WALK_ENTRIES);
    walkState.limit = Number(opts.walk_limit); // can only lower the cap (tests)
  }
  const repo = opts.repo || process.cwd();
  let repoReal;
  try { repoReal = fs.realpathSync(repo); } catch (e) { fail('--repo unreadable: ' + e.message); }
  if (git(repoReal, ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).status !== 0) fail('--repo is not a git work tree');
  const input = loadInput(opts, repoReal);
  const prep = prepare(input, repoReal, repoReal);
  if (opts.check) {
    const out = { ok: true, errors: [] };
    process.stdout.write(opts.json ? JSON.stringify(out) + '\n' : 'ok\n');
    return 0;
  }
  const result = evaluate(prep, input, repoReal, repoReal);
  if (opts.json) fs.writeSync(1, JSON.stringify(result) + '\n');
  else {
    for (const v of result.violations) process.stdout.write('VIOLATION ' + v.constraint + ': ' + v.rule + ' (' + v.evidence + ')\n');
    for (const g of result.feature_gaps) process.stdout.write('GAP ' + g + '\n');
    if (!result.violations.length) process.stdout.write('clean\n');
  }
  return result.violations.length > 0 ? 1 : 0;
}

if (require.main === module) {
  let code;
  try { code = main(process.argv.slice(2)); } catch (e) {
    const msg = e instanceof Fail ? e.message : 'internal error: ' + (e && e.stack || e);
    if (process.argv.includes('--check') && process.argv.includes('--json')) {
      process.stdout.write(JSON.stringify({ ok: false, errors: msg.split('; ') }) + '\n');
    }
    process.stderr.write('gate-verify: ' + msg + '\n');
    code = 2;
  }
  process.exitCode = code;
}

module.exports = { readWorktreeFile, MAX_WALK_ENTRIES, matchGlob, normaliseRel, KIND_FIELDS, RULE_KEYS, GATE_KEYS, ALLOWED_FLAGS };
