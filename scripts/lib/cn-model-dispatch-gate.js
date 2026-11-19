#!/usr/bin/env node
'use strict';
// cn-model-dispatch-gate.js - the Chinese-model dispatch gate (operator card d-1dfcf757, widened by
// operator rule 2026-11-15, Fleet task 01M7E2A1). One gate, called before spawn by every rail that can
// pick a runner/model.
//
// Barred families: Kimi (moonshot), GLM (zhipu), Qwen (alibaba), DeepSeek, MiniMax, qoder.
// A dispatch to a barred family is blocked when ANY of these holds (reason class in brackets):
//   [transcript]  the task reads agent transcript content (env AUTOPILOT_TASK_READS_TRANSCRIPT=1, or a
//                 `Reads-Transcript: yes` header line in the first 8 lines of the brief/spec)
//   [sensitive]   the repo name or any path in the task's read/write scope matches the sensitive list
//                 (money/payments, PII, private-home data, keys/credentials, customer data)
//   [review-role] role is in review_roles (reviewer, review, qc, qc_panel, plan_review, loop_reviewer,
//                 verifier), regardless of size, including a missing size. The local served family on a
//                 local-sandbox endpoint is exempt from THIS class only when review_local_exceptions in
//                 the shipped defaults names that endpoint, now < until, and the repo is not in
//                 local_deny_repos (d-ede04b92, PM 01M7JPZQ; today qwen_local until 2026-11-21T23:59:59+08:00).
//                 Past until, with no entry, or on a denied repo, the class is review-role. A repo
//                 .claude/cn-model-gate.json cannot add, extend, or shrink an entry: the window is the
//                 operator's decision, not a repo's. Every other check still applies. A cloud endpoint
//                 of the same family, and any other barred family on that endpoint, stay barred.
//   [core-size]   size is above XS/S (M, L, XL)
//   [core-dir]    the scope touches a directory the config marks `core`
//   [core-unset]  effective core_dirs (shipped list union the repo file) is empty, so every scope path
//                 counts as core. Allowed only when every path matches the shipped core_unset_allow list,
//                 or is named in New-Files: and does not exist under the repo root yet. A repo file cannot change
//                 that list. A path allowed only by **/fixtures/**, **/testdata/** or **/__fixtures__/** also needs a basename extension in the shipped core_unset_fixture_exts list (lower-cased); docs/**, doc/** and an absent New-Files path do not, and a repo file cannot change that list. An empty core list must not fail open onto source edits (01M7S88YZPPZKVARP0F2SYMRGS).
//                 Paths are normalised; `..`, absolute and glob paths never pass.
//                 A diff path that contains whitespace, or git's quoted `"b/..."` form, never passes.
//                 A symlink in any existing component of the normalised path never passes.
//                 Every Scope header and every New-Files header is read and the paths are unioned.
//   [novel]       role is plan, design, brainstorm, architecture, plan_review or research, or the task is
//                 marked novel (env AUTOPILOT_TASK_NOVEL=1, or `Novel: yes` header)
//   [unknown-size|unknown-role|unknown-scope]  FAIL CLOSED: size, role or scope is missing
// Local endpoint (interim, PM 01M7HQ92; operator rule 2026-11-15 applies to local qwen too, so being local
//   is not an exemption; this stands until the AR data-class allowlist replaces it): when --endpoint is listed
//   in scripts/lib/local-sandbox-endpoints.json (today qwen_local) and the family is the one that endpoint
//   serves, every check above applies exactly as for a cloud endpoint of that family, except [review-role]
//   when a shipped review_local_exceptions entry names that endpoint, now < until, and the repo is outside
//   local_deny_repos. Past that, [review-role] applies and is decided before the later local checks.
//   Two further checks then apply, and only then: [local-deny-repo] the repo directory name matches local_deny_repos; [unknown-task-class]
//   Task-Class is missing; [task-class] it is not in local_task_classes (format-convert, log-summary,
//   simple-script, test-scaffold). A different barred family on that endpoint (a kimi model on qwen_local)
//   stays on the cloud checks only. Cloud endpoints are unchanged. filter-ladder applies the same rule to a
//   rung that names the local endpoint (engine/effort@runner#endpoint, or a runner/model equal to that name).
// Allowed only when none match: XS/S mechanical edit with tests, formatting, docs, open-source dependency bumps,
//   and the role is not a review role (cloud). A local served-family review role passes this class only inside
//   a shipped review_local_exceptions window, and that dispatch also needs an allowed Task-Class and a repo
//   outside local_deny_repos.
//
// Task facts (env wins over header; header = first 8 lines of the brief/spec, `Key: v` alone or as a `| Key: v` field):
//   size   AUTOPILOT_TASK_SIZE  / `Size: XS|S|M|L|XL`
//   role   AUTOPILOT_TASK_ROLE  / `Role: <role>`          (a rail may pass its own implied role; a review or novel rail role is a floor that env/header cannot lower)
//   scope  AUTOPILOT_TASK_SCOPE / every `Scope: a, b` header (comma/newline separated paths, unioned), plus diff paths
//   new    every `New-Files: a, b` header (same split, unioned). Counts only when effective core_dirs is
//          empty: a named path that does not exist under the repo root is allowed even if it misses core_unset_allow.
//   novel  AUTOPILOT_TASK_NOVEL=1 / `Novel: yes`
//   class  AUTOPILOT_TASK_CLASS / `Task-Class: <value>`   (local served family only; compared case-insensitively)
// Config: scripts/lib/cn-model-gate-defaults.json (starter lists) extended by <repo>/.claude/cn-model-gate.json
//   (union of every list; a repo can add entries and cannot remove a starter). Fields: sensitive_paths,
//   sensitive_repos, core_dirs, novel_roles, review_roles, local_task_classes, local_deny_repos.
//   review_local_exceptions, core_unset_allow and core_unset_fixture_exts are read only from the shipped defaults (not unioned).
//   Clock: check(..., { now })
//   with an ISO string. An explicit now that does not parse fails closed and is not replaced by the real
//   clock. When now is omitted, Date.now() is used (no env override).
// Family inference is stage-write.js familyOfEngine (qoder included). Transcript deny list is
// scripts/lib/data-class-policy.json deny_families, which must cover BARRED_FAMILIES.
// Test seam: AUTOPILOT_TEST_CN_GATE_OFF=1 disables the gate (suites that dispatch through a sentinel runner).
//
// CLI (Node built-ins only):
//   check --runner R [--model M] [--endpoint E] [--role R] [--prompt-file F]... [--diff-file F]... [--cwd D]
//       exit 0 allowed; exit 2 refused, stderr one line `cn_model_dispatch_barred <family> <class> (01M7E2A1, d-1dfcf757)`.
//   filter-ladder [same flags] -- <engine/effort@runner> ...   prints allowed rungs; exit 2 + line when none remain.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { familyOfEngine } = require('./stage-write');

const CARD = 'd-1dfcf757';
const TASK = '01M7E2A1';
// Cloud-dispatch barred families (local endpoints can be exempt). Transcript data-class deny is
// data-class-policy.json, which loadPolicy() checks covers this list. Do not copy the ids elsewhere.
const BARRED_FAMILIES = Object.freeze(['moonshot', 'zhipu', 'alibaba', 'deepseek', 'minimax', 'qoder']);
const SMALL_SIZES = Object.freeze(['XS', 'S']);
const BIG_SIZES = Object.freeze(['M', 'L', 'XL']);
const DEFAULTS_PATH = path.join(__dirname, 'cn-model-gate-defaults.json');

function refusalLine(family, cls) { return `cn_model_dispatch_barred ${family} ${cls} (${TASK}, ${CARD})`; }

function headerLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n', 8).map((l) => l.replace(/\r$/, ''));
}

function headerValue(files, key) {
  const found = headerValues(files, key);
  return found.length ? found[0] : '';
}

// Every matching header line in the first 8 lines of every file. Unioning callers can only add paths.
function headerValues(files, key) {
  const re = new RegExp(`(^|\\|)[ \\t]*${key}:[ \\t]*([^|]*)`, 'i');
  const out = [];
  for (const f of files.filter(Boolean)) {
    for (const l of headerLines(f)) {
      const m = re.exec(l);
      if (m) out.push(m[2].trim());
    }
  }
  return out;
}

// `+++`/`---` path runs to end of line; a tab and anything after it is git's timestamp, not the path.
// A quoted `"b/..."` form (C-style escapes) is kept quoted so core-unset refuses it instead of decoding.
// `diff --git` counts only when a/X and b/X are the same X; a rename or a quoted line is ignored.
function diffPathBody(rest) {
  const tab = rest.indexOf('\t');
  if (tab !== -1) rest = rest.slice(0, tab);
  if (rest === '/dev/null') return '';
  if (rest.startsWith('"')) return rest;
  if (rest.startsWith('a/') || rest.startsWith('b/')) rest = rest.slice(2);
  return rest;
}

function diffPaths(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const line of text.split('\n')) {
    const same = /^diff --git a\/(.+) b\/\1$/.exec(line);
    if (same) { out.add(same[1]); continue; }
    const hunk = /^(?:\+\+\+|---) (.*)$/.exec(line);
    if (!hunk) continue;
    const body = diffPathBody(hunk[1]);
    if (body) out.add(body);
  }
  return [...out];
}

function globToRegex(g) {
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function matchesAny(p, globs) {
  const norm = String(p).replace(/^\.\//, '').replace(/^\/+/, '');
  return globs.some((g) => {
    const re = globToRegex(g);
    // a glob without a slash matches any path segment-wise basename; otherwise anchored at any directory depth
    return g.includes('/') ? (re.test(norm) || norm.split('/').some((_, i, a) => re.test(a.slice(i).join('/')))) : norm.split('/').some((seg) => re.test(seg));
  });
}

function loadList(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}

function repoRootOf(cwd) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : cwd;
}

function loadConfig(root) {
  const base = loadList(DEFAULTS_PATH);
  const ext = loadList(path.join(root, '.claude', 'cn-model-gate.json'));
  const u = (k) => [...new Set([...(base[k] || []), ...(ext[k] || [])].map(String))];
  return {
    sensitive_paths: u('sensitive_paths'), sensitive_repos: u('sensitive_repos'), core_dirs: u('core_dirs'),
    novel_roles: u('novel_roles').map((r) => r.toLowerCase()),
    review_roles: u('review_roles').map((r) => r.toLowerCase()),
    local_task_classes: u('local_task_classes').map((r) => r.toLowerCase()),
    local_deny_repos: u('local_deny_repos'),
  };
}

// Shipped defaults only. A repo file is not consulted: the window is the operator's decision
// (d-ede04b92, PM 01M7JPZQ), not a repo's, so a repo cannot add, extend, or shrink an entry.
function shippedReviewExceptions() {
  const raw = loadList(DEFAULTS_PATH).review_local_exceptions;
  return Array.isArray(raw) ? raw : [];
}

// Shipped defaults only. A repo file is not consulted: an empty core_dirs must not be widened
// by a repo adding source globs to the allow list (01M7S88YZPPZKVARP0F2SYMRGS).
function shippedCoreUnsetAllow() {
  const raw = loadList(DEFAULTS_PATH).core_unset_allow;
  return Array.isArray(raw) ? raw.map(String) : [];
}

// Shipped defaults only, same rule as core_unset_allow (01M7S88YZPPZKVARP0F2SYMRGS).
const CORE_UNSET_FIXTURE_GLOBS = new Set(['**/fixtures/**', '**/testdata/**', '**/__fixtures__/**']);

function shippedCoreUnsetFixtureExts() {
  const raw = loadList(DEFAULTS_PATH).core_unset_fixture_exts;
  return new Set(Array.isArray(raw) ? raw.map((e) => String(e).toLowerCase()) : []);
}

// Extension is the text after the last dot of the basename, lower-cased. No dot, or a
// leading dot with nothing after it, is no extension.
function coreUnsetFixtureExt(norm) {
  const base = norm.split('/').pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

// True when the path is not on the shipped allow list, or is on it only through a fixture
// directory and the extension is not a shipped data extension. docs/** and doc/** skip the
// extension rule. The caller still applies the absent New-Files exception.
function coreUnsetAllowBlocks(norm, allow, exts) {
  let viaFixture = false;
  let viaOther = false;
  for (const g of allow) {
    if (!coreUnsetGlobRegex(g).test(norm)) continue;
    if (CORE_UNSET_FIXTURE_GLOBS.has(g)) viaFixture = true;
    else viaOther = true;
  }
  if (viaOther) return false;
  if (!viaFixture) return true;
  return !exts.has(coreUnsetFixtureExt(norm));
}

// core-unset only. Case-sensitive and anchored at the repo root. A leading `**/` still matches
// any depth (the shipped fixtures / testdata / __fixtures__ entries). Other globs, including
// `docs/**` and `doc/**`, match only from the first segment. Not matchesAny.
function coreUnsetGlobRegex(g) {
  let re = '';
  let i = 0;
  if (g.startsWith('**/')) { re += '(?:.*/)?'; i = 3; }
  for (; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

// Strip one leading `./`, then path.posix.normalize. Absolute, `..`, and glob characters never pass.
function coreUnsetNorm(raw) {
  let s = String(raw);
  const absolute = path.posix.isAbsolute(s);
  if (s.startsWith('./')) s = s.slice(2);
  const normalised = path.posix.normalize(s);
  const bad = absolute || /[*?[{]/.test(s) || s.split('/').includes('..') || normalised.split('/').includes('..');
  return { normalised, bad };
}

function absentUnderRepoRoot(root, normalised) {
  const abs = path.resolve(root, normalised);
  const rel = path.relative(root, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try {
    fs.lstatSync(abs);
    return false;
  } catch {
    return true;
  }
}

// core-unset only. lstat each existing prefix; do not follow a symlink into the target.
function coreUnsetHasSymlink(root, normalised) {
  const absRoot = path.resolve(root);
  let cur = absRoot;
  for (const part of normalised.split('/')) {
    if (!part || part === '.') continue;
    cur = path.join(cur, part);
    const rel = path.relative(absRoot, cur);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return true;
    let st;
    try { st = fs.lstatSync(cur); } catch { return false; }
    if (st.isSymbolicLink()) return true;
  }
  return false;
}

function splitPathList(raw) {
  return String(raw || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

function instantMs(v) {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// Explicit now wins. An invalid explicit now is null (fail closed): do not fall back to the real clock.
// When now is omitted, use the real clock (no env override).
function gateNow(opts) {
  if (Object.prototype.hasOwnProperty.call(opts, 'now')) return instantMs(opts.now);
  return Date.now();
}

function reviewLocalExempt(endpoint, nowMs, root, denyGlobs) {
  if (nowMs == null) return false;
  if (matchesAny(path.basename(root), denyGlobs)) return false;
  const ep = String(endpoint || '');
  return shippedReviewExceptions().some((e) => {
    if (!e || typeof e !== 'object') return false;
    if (String(e.endpoint || '') !== ep) return false;
    const until = Date.parse(String(e.until || ''));
    return Number.isFinite(until) && nowMs < until;
  });
}

// Self-hosted fleet endpoints: the one repo-documented list (also drives the local implementer sandbox).
const LOCAL_ENDPOINTS_PATH = path.join(__dirname, 'local-sandbox-endpoints.json');
function localEndpoints() {
  const l = loadList(LOCAL_ENDPOINTS_PATH).local_sandbox_endpoints;
  return Array.isArray(l) ? l.map(String) : [];
}

function rawFamily(p) { return /qoder/i.test(p) ? 'qoder' : familyOfEngine(p); }

// Effective endpoint: an explicit endpoint wins; otherwise a runner or model shorthand that names a listed
// local-sandbox endpoint resolves to that canonical endpoint (matching filterLadder).
function effectiveEndpointOf(runner, model, endpoint, locals = localEndpoints()) {
  const ep = String(endpoint || '');
  if (ep) {
    const matched = locals.find((l) => l.toLowerCase() === ep.toLowerCase());
    return matched || ep;
  }
  for (const cand of [runner, model]) {
    const s = String(cand || '');
    if (!s) continue;
    const matched = locals.find((l) => l.toLowerCase() === s.toLowerCase());
    if (matched) return matched;
  }
  return '';
}

// localServed: the endpoint is a local-sandbox endpoint and no OTHER barred family is named.
// The family id is the one that endpoint serves (cloud qwen is alibaba), so the cloud checks apply as-is.
function resolution(runner, model, endpoint) {
  const locals = localEndpoints();
  const ep = effectiveEndpointOf(runner, model, endpoint, locals);
  if (ep && locals.includes(ep)) {
    const served = rawFamily(ep);
    const fams = [model, runner].map((s) => String(s || '')).filter(Boolean).map(rawFamily);
    const other = fams.find((f) => BARRED_FAMILIES.includes(f) && f !== served);
    if (other) return { family: other, localServed: false, endpoint: ep };
    if (BARRED_FAMILIES.includes(served)) return { family: served, localServed: true, endpoint: ep };
    return { family: fams.find((f) => f !== 'unknown') || served, localServed: false, endpoint: ep };
  }
  const probes = [ep, model, runner].map((s) => String(s || '')).filter(Boolean);
  const fams = probes.map(rawFamily);
  return { family: fams.find((f) => BARRED_FAMILIES.includes(f)) || fams.find((f) => f !== 'unknown') || 'unknown', localServed: false, endpoint: ep };
}

function familyOf(runner, model, endpoint) { return resolution(runner, model, endpoint).family; }

// Kept for callers/tests that only ask about the transcript marker.
function isMarked(files = [], env = process.env) {
  if (String(env.AUTOPILOT_TASK_READS_TRANSCRIPT || '') === '1') return true;
  return /^yes$/i.test(headerValue(files, 'Reads-Transcript'));
}

function taskFacts({ files = [], diffFiles = [], role = '', env = process.env }) {
  const size = String(env.AUTOPILOT_TASK_SIZE || headerValue(files, 'Size') || '').trim().toUpperCase();
  const envRole = String(env.AUTOPILOT_TASK_ROLE || '').trim().toLowerCase();
  const headerRole = String(headerValue(files, 'Role') || '').trim().toLowerCase();
  const railRole = String(role || '').trim().toLowerCase();
  const roleV = envRole || headerRole || railRole;
  const envScope = String(env.AUTOPILOT_TASK_SCOPE || '');
  const scopeParts = envScope ? splitPathList(envScope) : headerValues(files, 'Scope').flatMap(splitPathList);
  const scope = [...new Set([...scopeParts, ...diffFiles.filter(Boolean).flatMap(diffPaths)])];
  const newFiles = [...new Set(headerValues(files, 'New-Files').flatMap(splitPathList))];
  const novel = String(env.AUTOPILOT_TASK_NOVEL || '') === '1' || /^yes$/i.test(headerValue(files, 'Novel'));
  const taskClass = String(env.AUTOPILOT_TASK_CLASS || headerValue(files, 'Task-Class') || '').trim().toLowerCase();
  return { size, role: roleV, railRole, headerRole, scope, newFiles, novel, transcript: isMarked(files, env), taskClass };
}

// -> { allowed, family, cls?, line? }
function check(opts = {}) {
  const { runner, model, endpoint, files = [], diffFiles = [], role = '', env = process.env, cwd = process.cwd() } = opts;
  const { family, localServed, endpoint: effectiveEndpoint } = resolution(runner, model, endpoint);
  if (String(env.AUTOPILOT_TEST_CN_GATE_OFF || '') === '1' || !BARRED_FAMILIES.includes(family)) return { allowed: true, family };
  const root = repoRootOf(cwd);
  const cfg = loadConfig(root);
  const f = taskFacts({ files, diffFiles, role, env });
  const block = (cls) => ({ allowed: false, family, cls, line: refusalLine(family, cls) });
  if (f.transcript) return block('transcript');
  if (matchesAny(path.basename(root), cfg.sensitive_repos) || f.scope.some((p) => matchesAny(p, cfg.sensitive_paths))) return block('sensitive');
  // Review roles are refused at every size. A review rail role (or brief Role:) is a floor that
  // env/header Role: implementer cannot lower. The local served family skips only this class, and
  // only inside a shipped review_local_exceptions window on a repo outside local_deny_repos.
  const reviewRolesToCheck = [f.role, f.railRole, f.headerRole].filter(Boolean);
  if (reviewRolesToCheck.some((r) => cfg.review_roles.includes(r))) {
    const exempt = localServed && reviewLocalExempt(effectiveEndpoint, gateNow(opts), root, cfg.local_deny_repos);
    if (!exempt) return block('review-role');
  }
  if (BIG_SIZES.includes(f.size)) return block('core-size');
  if (cfg.core_dirs.length === 0) {
    const allow = shippedCoreUnsetAllow();
    const fixtureExts = shippedCoreUnsetFixtureExts();
    const news = new Set();
    for (const n of f.newFiles) {
      const c = coreUnsetNorm(n);
      if (!c.bad) news.add(c.normalised);
    }
    const unset = f.scope.some((p) => {
      if (/[\s"]/.test(String(p))) return true;
      const c = coreUnsetNorm(p);
      if (c.bad || /[\s"]/.test(c.normalised)) return true;
      if (coreUnsetHasSymlink(root, c.normalised)) return true;
      if (!coreUnsetAllowBlocks(c.normalised, allow, fixtureExts)) return false;
      return !(news.has(c.normalised) && absentUnderRepoRoot(root, c.normalised));
    });
    if (unset) return block('core-unset');
  } else if (f.scope.some((p) => matchesAny(p, cfg.core_dirs))) return block('core-dir');
  if (f.novel || cfg.novel_roles.includes(f.role) || cfg.novel_roles.includes(f.railRole)) return block('novel');
  if (!SMALL_SIZES.includes(f.size)) return block('unknown-size');
  if (!f.role) return block('unknown-role');
  if (!f.scope.length) return block('unknown-scope');
  if (localServed) {
    if (matchesAny(path.basename(root), cfg.local_deny_repos)) return block('local-deny-repo');
    if (!f.taskClass) return block('unknown-task-class');
    if (!cfg.local_task_classes.includes(f.taskClass)) return block('task-class');
  }
  return { allowed: true, family };
}

// rungs are "engine/effort@runner" or "engine/effort@runner#endpoint". A #endpoint, or a runner or model
// equal to a local-sandbox endpoint name, is that endpoint for the local served-family rule.
function rungParts(rung) {
  const raw = String(rung);
  const m = /^(.*?)(?:\/[a-z]+)?@([^@]+)$/.exec(raw);
  if (!m) {
    const hash = raw.indexOf('#');
    if (hash === -1) return { model: raw, runner: '', endpoint: '' };
    return { model: raw.slice(0, hash), runner: '', endpoint: raw.slice(hash + 1) };
  }
  let runner = m[2];
  let endpoint = '';
  const hash = runner.indexOf('#');
  if (hash !== -1) { endpoint = runner.slice(hash + 1); runner = runner.slice(0, hash); }
  return { model: m[1], runner, endpoint };
}

function filterLadder(rungs, ctx = {}) {
  const kept = []; const barred = [];
  const locals = localEndpoints();
  for (const r of rungs) {
    const parts = rungParts(r);
    const endpoint = effectiveEndpointOf(parts.runner, parts.model, parts.endpoint, locals) || ctx.endpoint || '';
    const c = check({ ...ctx, runner: parts.runner, model: parts.model, endpoint });
    if (c.allowed) kept.push(r); else barred.push({ rung: r, family: c.family, line: c.line });
  }
  return { kept, barred };
}

function main(argv) {
  const cmd = argv[0];
  const o = { files: [], diffFiles: [] }; const rest = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a === '--runner') o.runner = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--endpoint') o.endpoint = argv[++i];
    else if (a === '--role') o.role = argv[++i];
    else if (a === '--cwd') o.cwd = argv[++i];
    else if (a === '--prompt-file') o.files.push(argv[++i]);
    else if (a === '--diff-file') o.diffFiles.push(argv[++i]);
    else { process.stderr.write(`cn-model-dispatch-gate: unknown arg ${a}\n`); return 64; }
  }
  if (cmd === 'check') {
    const c = check(o);
    if (!c.allowed) { process.stderr.write(`${c.line}\n`); return 2; }
    return 0;
  }
  if (cmd === 'filter-ladder') {
    const { kept, barred } = filterLadder(rest, o);
    if (!kept.length && barred.length) { process.stderr.write(`${barred[0].line}\n`); return 2; }
    for (const k of kept) process.stdout.write(`${k}\n`);
    return 0;
  }
  process.stderr.write('usage: cn-model-dispatch-gate.js check|filter-ladder ...\n');
  return 64;
}

module.exports = {
  BARRED_FAMILIES,
  localEndpoints,
  CARD,
  TASK,
  familyOf,
  isMarked,
  check,
  filterLadder,
  refusalLine,
  globToRegex,
  matchesAny,
  headerLines,
  headerValue,
  taskFacts,
  loadConfig,
  repoRootOf,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
