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
// a registry `files` entry missing at <base>, an `argv` path that is not an
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

const MAX_RULES = 40;
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HITS_PER_RULE = 50;
const DEFAULT_CHECK_TIMEOUT_S = 20;
const MAX_CHECK_TIMEOUT_S = 120;
const INTERPRETERS = new Set(['node', 'sh', 'bash', 'python3', 'python']);
// Flags that make an interpreter run code that is not an exported file.
const CODE_FLAGS = new Set(['-e', '-p', '-r', '-c', '-m']);
const CODE_FLAG_PREFIXES = ['--eval', '--print', '--require', '--import', '--loader', '--experimental-loader', '--input-type'];
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
  return env;
}

function git(repo, args, opts) {
  const r = cp.spawnSync('git', args, {
    cwd: repo, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024,
    timeout: 60000,
  });
  if (r.error) fail('git failed: ' + r.error.message);
  if (r.status !== 0 && !(opts && opts.allowFail)) fail('git ' + args[0] + ' failed: ' + String(r.stderr).slice(0, 200));
  return r;
}

function nulList(buf) { return String(buf).split('\0').filter(Boolean); }

function baseResolves(repo, base) {
  return git(repo, ['cat-file', '-e', base + '^{commit}'], { allowFail: true }).status === 0;
}

function blobAtBase(repo, base, rel) {
  return git(repo, ['cat-file', '-e', base + ':./' + rel], { allowFail: true }).status === 0;
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
      const bare = a.split('=')[0];
      if (CODE_FLAGS.has(bare) || CODE_FLAG_PREFIXES.some((p) => bare === p)) errs.push(label + ': argv flag ' + a + ' runs code that is not an exported file');
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
  const withValue = new Set(['--turn', '--repo', '--gate-file', '--rules', '--base', '--mode']);
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
    if (typeof g.expires_at !== 'string' || Number.isNaN(Date.parse(g.expires_at))) errs.push('gate file expires_at must be an ISO string');
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

function readWorktreeFile(repoReal, rel) {
  const abs = path.join(repoReal, rel);
  let st;
  try { st = fs.lstatSync(abs); } catch (e) { return null; }
  let real;
  try { real = fs.realpathSync(abs); } catch (e) { return null; }
  if (!inside(real, repoReal)) return null;
  try { st = fs.statSync(real); } catch (e) { return null; }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
  try { return fs.readFileSync(real, 'utf8'); } catch (e) { return null; }
}

function existsInRepo(repoReal, rel) {
  try { return inside(fs.realpathSync(path.join(repoReal, rel)), repoReal); } catch (e) { return false; }
}

function worktreeFiles(repo) {
  const tracked = nulList(git(repo, ['ls-files', '-z']).stdout);
  const untracked = nulList(git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).stdout);
  return Array.from(new Set(tracked.concat(untracked)));
}

function changedSince(repo, base) {
  const diff = nulList(git(repo, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--relative', base, '--']).stdout);
  const untracked = nulList(git(repo, ['ls-files', '-z', '--others', '--exclude-standard']).stdout);
  return Array.from(new Set(diff.concat(untracked)));
}

function builtinNoConflictMarkers(repo, repoReal) {
  for (const rel of worktreeFiles(repo)) {
    const text = readWorktreeFile(repoReal, rel);
    if (text === null || text.slice(0, 8000).includes('\0')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^(<{7}|>{7})( |$)/.test(lines[i])) return { ok: false, evidence: rel + ':' + (i + 1) };
    }
  }
  return { ok: true };
}

function builtinJsSyntax(repo, repoReal, base) {
  for (const rel of changedSince(repo, base)) {
    if (!/\.(js|cjs|mjs)$/.test(rel)) continue;
    const abs = path.join(repoReal, rel);
    if (readWorktreeFile(repoReal, rel) === null) continue;
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
    const r = cp.spawnSync(res.argv[0], res.argv.slice(1), {
      cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: res.timeoutS * 1000,
      killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024, shell: false,
    });
    if (r.error && r.error.code === 'ETIMEDOUT') return { ok: false, evidence: 'timeout after ' + res.timeoutS + 's' };
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
    return name === 'js-syntax' ? builtinJsSyntax(repo, repoReal, base) : builtinNoConflictMarkers(repo, repoReal);
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
    const changed = changedSince(repo, base);
    for (const f of forbid) {
      let n = 0;
      for (const rel of changed) {
        if (matchGlob(f.norm, rel) && n++ < MAX_HITS_PER_RULE) viol(f.entry, 'forbid_paths', rel);
      }
    }
  }
  for (const f of wanted('require_files')) {
    if (!existsInRepo(repoReal, f.norm)) viol(f.entry, 'require_files', f.norm + ': missing');
  }
  for (const f of wanted('require_text')) {
    const text = readWorktreeFile(repoReal, f.norm);
    if (text === null) viol(f.entry, 'require_text', f.norm + ': file missing');
    else if (!text.includes(f.entry.text)) viol(f.entry, 'require_text', f.norm + ': text not found');
  }
  const ft = wanted('forbid_text');
  if (ft.length) {
    const files = worktreeFiles(repo);
    for (const f of ft) {
      let n = 0;
      for (const rel of files) {
        if (!matchGlob(f.norm, rel)) continue;
        const text = readWorktreeFile(repoReal, rel);
        if (text === null) continue;
        const idx = text.indexOf(f.entry.text);
        if (idx >= 0 && n++ < MAX_HITS_PER_RULE) viol(f.entry, 'forbid_text', rel + ':' + (text.slice(0, idx).split('\n').length));
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

module.exports = { matchGlob, normaliseRel, KIND_FIELDS, RULE_KEYS, GATE_KEYS };
