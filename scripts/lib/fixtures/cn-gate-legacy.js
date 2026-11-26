#!/usr/bin/env node
'use strict';
// Chinese-cloud dispatch gate. Decisions follow the operator receiving the payload.
// Restricted operators may receive only a redacted, scan-clean brief from a fresh
// empty sandbox outside every git work tree. Local endpoint names must resolve locally.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { familyOfEngine } = require('./stage-write');
const { redactText, defaultRules } = require('./ar-redact-rules');
const personal = require('./personal-data-patterns');
const outbound = require('./outbound-secret-scan');
const { configPath } = require('./config-path');

const TASK = '01M7E2A1';
const CARD = 'd-1dfcf757';
const BARRED_FAMILIES = Object.freeze(['moonshot', 'zhipu', 'alibaba', 'deepseek', 'minimax', 'qoder']);
const LOCAL_ENDPOINTS_PATH = path.join(__dirname, 'local-sandbox-endpoints.json');
const OPERATORS_PATH = path.join(__dirname, 'cloud-operators.json');
function refusalLine(family, cls) { return `cn_model_dispatch_barred ${family} ${cls} (${TASK}, ${CARD})`; }
function readJson(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function localEndpoints() { const a = readJson(LOCAL_ENDPOINTS_PATH).local_sandbox_endpoints; return Array.isArray(a) ? a.map(String) : []; }
function familyOf(runner, model, endpoint) {
  const raw = [endpoint, model, runner].filter(Boolean).map((x) => /qoder/i.test(String(x)) ? 'qoder' : familyOfEngine(String(x)));
  return raw.find((x) => BARRED_FAMILIES.includes(x)) || raw.find((x) => x !== 'unknown') || 'unknown';
}
function repoRootOf(cwd = process.cwd()) {
  let dir; try { dir = fs.realpathSync(cwd); } catch { return ''; }
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir); if (parent === dir) return ''; dir = parent;
  }
}
function resolveEndpoint(name, env) {
  const script = path.join(__dirname, '..', 'resolve-endpoint.sh');
  const r = spawnSync('bash', [script, name], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15000 });
  // The resolver exits 1 for a non-https LAN gateway (url_unsafe) but still prints the JSON with base_url; the locality decision only needs base_url.
  try { return JSON.parse(String(r.stdout).split('\n').find((s) => s.startsWith('{')) || 'null'); } catch { return null; }
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } }
function isLocalHost(host, env) {
  const normalized = host.replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  let configured = [];
  try {
    const config = JSON.parse(fs.readFileSync(env.AUTOPILOT_CONFIG || configPath({ env }), 'utf8'));
    configured = Array.isArray(config.local_gateway_hosts) ? config.local_gateway_hosts : [];
  } catch { /* missing or invalid optional config contributes no host */ }
  const listed = [...(readJson(LOCAL_ENDPOINTS_PATH).local_gateway_hosts || []), ...String(env.AUTOPILOT_LOCAL_GATEWAY_HOSTS || '').split(','), ...configured].map((x) => String(x).toLowerCase().trim());
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(host)) return false;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return listed.includes(host);
  const [a, b, c, d] = octets.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255) || !listed.includes(host)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function operatorFor(endpoint, host, inventory) {
  const name = String(endpoint || '').toLowerCase();
  host = String(host || '');
  const entries = Array.isArray(inventory.operators) ? inventory.operators : [];
  for (const row of entries) {
    if ((row.endpoints || []).some((x) => String(x).toLowerCase() === name)) return row;
    if ((row.host_suffixes || []).some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) return row;
  }
  return null;
}
function freshSandbox(cwd, files) {
  let root;
  try { root = fs.realpathSync(cwd); } catch { return false; }
  if (repoRootOf(root)) return false;
  const permitted = new Set(files.filter(Boolean).map((f) => { try { return fs.realpathSync(f); } catch { return ''; } }));
  if (!permitted.size || permitted.has('')) return false;
  const seen = new Set();
  function walk(dir) {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) { if (!walk(full)) return false; }
      else if (entry.isFile()) { let real; try { real = fs.realpathSync(full); } catch { return false; } if (!permitted.has(real)) return false; seen.add(real); }
      else return false;
    }
    return true;
  }
  return walk(root) && seen.size === permitted.size && [...seen].every((f) => f.startsWith(`${root}${path.sep}`));
}
function scanBrief(files) {
  if (!files.length) return false;
  const hostInventory = process.env.AUTOPILOT_LEAK_GUARD_HOSTS;
  process.env.AUTOPILOT_LEAK_GUARD_HOSTS = path.join(__dirname, 'leak-guard-hosts.example.json');
  try {
  for (const file of files) {
    let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
    if (redactText(text, defaultRules()).total > 0) return false;
    // Host inventory entries are configuration-dependent. Also reject private host-style names
    // that the inventory classifies when its machine-specific inventory is unavailable.
    if (/(?:^|[\s/@])(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp|private)\b/i.test(text)) return false;
    if (personal.findAll(text).length > 0 || outbound.scanText(text).length > 0) return false;
  }
  return true;
  } finally {
    if (hostInventory === undefined) delete process.env.AUTOPILOT_LEAK_GUARD_HOSTS;
    else process.env.AUTOPILOT_LEAK_GUARD_HOSTS = hostInventory;
  }
}
function check(opts = {}) {
  const { runner = '', model = '', cwd = process.cwd(), files = [], env = process.env } = opts;
  let { endpoint = '' } = opts;
  if (!endpoint && ['kimi', 'qoderclicn'].includes(String(runner).toLowerCase())) endpoint = String(runner).toLowerCase();
  const family = familyOf(runner, model, endpoint);
  if (env.AUTOPILOT_TEST_CN_GATE_OFF === '1' || !BARRED_FAMILIES.includes(family)) return { allowed: true, family };
  const locals = localEndpoints();
  const localName = locals.find((x) => x.toLowerCase() === String(endpoint).toLowerCase());
  if (localName) {
    const resolved = resolveEndpoint(localName, env);
    const host = resolved && hostOf(resolved.base_url);
    if (!host || !isLocalHost(host, env)) return { allowed: false, family, cls: 'local_name_external_host', line: refusalLine(family, 'local_name_external_host') };
    return { allowed: true, family };
  }
  let rawUrl = '';
  try {
    const parsed = new URL(String(endpoint));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') rawUrl = String(endpoint);
  } catch { /* endpoint names are resolved through the canonical endpoint resolver */ }
  const resolved = rawUrl ? { base_url: rawUrl } : (endpoint ? resolveEndpoint(endpoint, env) : null);
  const host = resolved && hostOf(resolved.base_url);
  // Decisions follow where the payload goes: a raw URL or a resolved endpoint name that points at a local gateway host is allowed, whatever the model family.
  if (host && isLocalHost(host, env)) return { allowed: true, family };
  const inventory = readJson(OPERATORS_PATH, null);
  const operator = inventory && operatorFor(endpoint, host, inventory);
  if (!operator) return { allowed: false, family, cls: 'restricted_operator_unknown_endpoint', line: refusalLine(family, 'restricted_operator_unknown_endpoint') };
  if (!operator.restricted) return { allowed: true, family };
  const block = (cls) => ({ allowed: false, family, cls, line: refusalLine(family, cls) });
  // d-38676fad (2026-11-25): restricted operators take only public-source work. The caller must declare the tier (opts.tier or
  // AUTOPILOT_CN_WORK_TIER): T0/T1 pass, MiniMax takes T0 only, anything else (including undeclared, i.e. any brief rewritten from private requirements) is T2 and stops here.
  const tier = String(opts.tier || env.AUTOPILOT_CN_WORK_TIER || '').toUpperCase();
  if (!(tier === 'T0' || (tier === 'T1' && family !== 'minimax'))) return block('restricted_operator_not_public_source');
  if (!freshSandbox(cwd, files)) return block('restricted_operator_private_workdir');
  if (!scanBrief(files)) return block('restricted_operator_brief_scan');
  return { allowed: true, family };
}
function rungParts(rung) {
  const raw = String(rung); const m = /^(.*?)(?:\/[a-z]+)?@([^@]+)$/.exec(raw);
  if (!m) { const i = raw.indexOf('#'); return i < 0 ? { model: raw, runner: '', endpoint: '' } : { model: raw.slice(0, i), runner: '', endpoint: raw.slice(i + 1) }; }
  const hash = m[2].indexOf('#'); return { model: m[1], runner: hash < 0 ? m[2] : m[2].slice(0, hash), endpoint: hash < 0 ? '' : m[2].slice(hash + 1) };
}
function filterLadder(rungs, ctx = {}) { const kept = []; const barred = []; for (const rung of rungs) { const p = rungParts(rung); const c = check({ ...ctx, ...p, endpoint: p.endpoint || ctx.endpoint }); if (c.allowed) kept.push(rung); else barred.push({ rung, family: c.family, line: c.line, cls: c.cls }); } return { kept, barred }; }
function main(argv) {
  const cmd = argv[0], o = { files: [] }, rest = [];
  for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (['--runner', '--model', '--endpoint', '--cwd', '--prompt-file'].includes(a)) { const k = a.slice(2); const v = argv[++i]; if (k === 'prompt-file') o.files.push(v); else o[k] = v; }
    else { process.stderr.write(`cn-model-dispatch-gate: unknown arg ${a}\n`); return 64; }
  }
  if (cmd === 'check') { const c = check(o); if (!c.allowed) { process.stderr.write(`${c.line}\n`); return 2; } return 0; }
  if (cmd === 'filter-ladder') { const r = filterLadder(rest, o); if (!r.kept.length && r.barred.length) { process.stderr.write(`${r.barred[0].line}\n`); return 2; } for (const x of r.kept) process.stdout.write(`${x}\n`); return 0; }
  process.stderr.write('usage: cn-model-dispatch-gate.js check|filter-ladder ...\n'); return 64;
}
module.exports = { BARRED_FAMILIES, localEndpoints, TASK, CARD, familyOf, check, filterLadder, refusalLine, repoRootOf };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
