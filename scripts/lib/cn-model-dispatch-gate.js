#!/usr/bin/env node
'use strict';
// cn-model-dispatch-gate.js - the Chinese-model dispatch gate (operator card d-1dfcf757, widened by
// operator rule 2026-11-15, Fleet task 01M7E2A1). One gate, called before spawn by every rail that can
// pick a runner/model.
//
// Barred families (cloud endpoints; fleet-local endpoints such as qwen_local are exempt, see Local exemption): Kimi (moonshot), GLM (zhipu), Qwen (alibaba), DeepSeek, MiniMax, qoder.
// A dispatch to a barred family is blocked when ANY of these holds (reason class in brackets):
//   [transcript]  the task reads agent transcript content (env AUTOPILOT_TASK_READS_TRANSCRIPT=1, or a
//                 `Reads-Transcript: yes` header line in the first 8 lines of the brief/spec)
//   [sensitive]   the repo name or any path in the task's read/write scope matches the sensitive list
//                 (money/payments, PII, private-home data, keys/credentials, customer data)
//   [core-size]   size is above XS/S (M, L, XL)
//   [core-dir]    the scope touches a directory the config marks `core`
//   [novel]       role is plan, design, brainstorm, architecture, plan_review or research, or the task is
//                 marked novel (env AUTOPILOT_TASK_NOVEL=1, or `Novel: yes` header)
//   [unknown-size|unknown-role|unknown-scope]  FAIL CLOSED: size, role or scope is missing
// Local exemption (PM 01M7F6TK; d-1dfcf757 targets data leaving the fleet to Chinese vendors' clouds): a dispatch whose
//   endpoint is a self-hosted, fleet-hosted open-weights endpoint (listed in scripts/lib/local-sandbox-endpoints.json, today
//   qwen_local) is not barred for the family that endpoint serves. Cloud endpoints and any other barred
//   model family (e.g. a kimi model on that endpoint) stay barred exactly as above.
// Allowed only when none match: XS/S mechanical edit with tests, formatting, docs, open-source dependency bumps.
//
// Task facts (env wins over header; header = first 8 lines of the brief/spec, `Key: v` alone or as a `| Key: v` field):
//   size   AUTOPILOT_TASK_SIZE  / `Size: XS|S|M|L|XL`
//   role   AUTOPILOT_TASK_ROLE  / `Role: <role>`          (a rail may pass its own implied role as a default)
//   scope  AUTOPILOT_TASK_SCOPE / `Scope: a, b`  (comma/newline separated paths), plus the `diff --git` paths of any diff file
//   novel  AUTOPILOT_TASK_NOVEL=1 / `Novel: yes`
// Config: scripts/lib/cn-model-gate-defaults.json (starter lists) extended by <repo>/.claude/cn-model-gate.json
//   (union of every list; fields sensitive_paths, sensitive_repos, core_dirs, novel_roles).
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
  const re = new RegExp(`(^|\\|)[ \\t]*${key}:[ \\t]*([^|]*)`, 'i');
  for (const f of files.filter(Boolean)) {
    for (const l of headerLines(f)) {
      const m = re.exec(l);
      if (m) return m[2].trim();
    }
  }
  return '';
}

function diffPaths(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const m of text.matchAll(/^diff --git a\/(\S+) b\/(\S+)/gm)) { out.add(m[1]); out.add(m[2]); }
  for (const m of text.matchAll(/^(?:\+\+\+|---) [ab]\/(\S+)/gm)) out.add(m[1]);
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
  return { sensitive_paths: u('sensitive_paths'), sensitive_repos: u('sensitive_repos'), core_dirs: u('core_dirs'), novel_roles: u('novel_roles').map((r) => r.toLowerCase()) };
}

// Self-hosted fleet endpoints: the one repo-documented list (also drives the local implementer sandbox).
const LOCAL_ENDPOINTS_PATH = path.join(__dirname, 'local-sandbox-endpoints.json');
function localEndpoints() {
  const l = loadList(LOCAL_ENDPOINTS_PATH).local_sandbox_endpoints;
  return Array.isArray(l) ? l.map(String) : [];
}

function rawFamily(p) { return /qoder/i.test(p) ? 'qoder' : familyOfEngine(p); }

function familyOf(runner, model, endpoint) {
  const ep = String(endpoint || '');
  if (ep && localEndpoints().includes(ep)) {
    // Local endpoint: its own name and the family it serves do not count; any OTHER barred family named by model/runner does.
    const served = rawFamily(ep);
    const fams = [model, runner].map((s) => String(s || '')).filter(Boolean).map(rawFamily);
    const other = fams.find((f) => BARRED_FAMILIES.includes(f) && f !== served);
    if (other) return other;
    if (BARRED_FAMILIES.includes(served)) return 'local';
    return fams.find((f) => f !== 'unknown') || served;
  }
  const probes = [endpoint, model, runner].map((s) => String(s || '')).filter(Boolean);
  const fams = probes.map(rawFamily);
  return fams.find((f) => BARRED_FAMILIES.includes(f)) || fams.find((f) => f !== 'unknown') || 'unknown';
}

// Kept for callers/tests that only ask about the transcript marker.
function isMarked(files = [], env = process.env) {
  if (String(env.AUTOPILOT_TASK_READS_TRANSCRIPT || '') === '1') return true;
  return /^yes$/i.test(headerValue(files, 'Reads-Transcript'));
}

function taskFacts({ files = [], diffFiles = [], role = '', env = process.env }) {
  const size = String(env.AUTOPILOT_TASK_SIZE || headerValue(files, 'Size') || '').trim().toUpperCase();
  const roleV = String(env.AUTOPILOT_TASK_ROLE || headerValue(files, 'Role') || role || '').trim().toLowerCase();
  const scopeRaw = String(env.AUTOPILOT_TASK_SCOPE || headerValue(files, 'Scope') || '');
  const scope = [...new Set([...scopeRaw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean), ...diffFiles.filter(Boolean).flatMap(diffPaths)])];
  const novel = String(env.AUTOPILOT_TASK_NOVEL || '') === '1' || /^yes$/i.test(headerValue(files, 'Novel'));
  return { size, role: roleV, scope, novel, transcript: isMarked(files, env) };
}

// -> { allowed, family, cls?, line? }
function check({ runner, model, endpoint, files = [], diffFiles = [], role = '', env = process.env, cwd = process.cwd() } = {}) {
  const family = familyOf(runner, model, endpoint);
  if (String(env.AUTOPILOT_TEST_CN_GATE_OFF || '') === '1' || !BARRED_FAMILIES.includes(family)) return { allowed: true, family };
  const root = repoRootOf(cwd);
  const cfg = loadConfig(root);
  const f = taskFacts({ files, diffFiles, role, env });
  const block = (cls) => ({ allowed: false, family, cls, line: refusalLine(family, cls) });
  if (f.transcript) return block('transcript');
  if (matchesAny(path.basename(root), cfg.sensitive_repos) || f.scope.some((p) => matchesAny(p, cfg.sensitive_paths))) return block('sensitive');
  if (BIG_SIZES.includes(f.size)) return block('core-size');
  if (f.scope.some((p) => matchesAny(p, cfg.core_dirs))) return block('core-dir');
  if (f.novel || cfg.novel_roles.includes(f.role)) return block('novel');
  if (!SMALL_SIZES.includes(f.size)) return block('unknown-size');
  if (!f.role) return block('unknown-role');
  if (!f.scope.length) return block('unknown-scope');
  return { allowed: true, family };
}

// rungs are "engine/effort@runner"; the endpoint is not expressible in a rung, so engine and runner decide.
function rungParts(rung) {
  const m = /^(.*?)(?:\/[a-z]+)?@([^@]+)$/.exec(String(rung));
  return m ? { model: m[1], runner: m[2] } : { model: String(rung), runner: '' };
}

function filterLadder(rungs, ctx = {}) {
  const kept = []; const barred = [];
  for (const r of rungs) {
    const { model, runner } = rungParts(r);
    const c = check({ ...ctx, runner, model });
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

module.exports = { BARRED_FAMILIES, localEndpoints, CARD, TASK, familyOf, isMarked, check, filterLadder, refusalLine, globToRegex, matchesAny };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
