#!/usr/bin/env node
'use strict';
// Chinese-cloud dispatch gate. Decisions follow the operator receiving the payload.
// Restricted operators may receive only a redacted, scan-clean brief from a fresh
// empty sandbox outside every git work tree. Local endpoint names must resolve locally.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
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
// Shipped window only (PM 01M7XP968Q66P4BN4W907W06HR). A repo file cannot add or extend it.
// An entry applies only when check() is given a role; callers that omit role keep the
// operator-based local-host decision.
const REVIEW_LOCAL_EXCEPTIONS = Object.freeze([
  { endpoint: 'glm_local', until: '2026-11-28T23:59:59+08:00', repos: ['thinksmart*'], roles: ['ux-reference-reviewer'] },
]);
function instantMs(v) {
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
function gateNow(opts, env) {
  if (Object.prototype.hasOwnProperty.call(opts, 'now')) return instantMs(opts.now);
  if (env && Object.prototype.hasOwnProperty.call(env, 'AUTOPILOT_CN_GATE_NOW')) return instantMs(env.AUTOPILOT_CN_GATE_NOW);
  return Date.now();
}
function globName(name, pattern) {
  const re = `^${String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`;
  return new RegExp(re).test(name);
}
function reviewRoleAllows(opts, env) {
  const role = String(opts.role || '').trim().toLowerCase();
  if (!role) return true;
  const now = gateNow(opts, env);
  if (now == null) return false;
  const repo = path.basename(repoRootOf(opts.cwd || process.cwd()) || '');
  const endpoint = String(opts.endpoint || '').toLowerCase();
  return REVIEW_LOCAL_EXCEPTIONS.some((entry) => {
    if (String(entry.endpoint).toLowerCase() !== endpoint) return false;
    if (!(entry.roles || []).map((r) => String(r).toLowerCase()).includes(role)) return false;
    if (!(entry.repos || []).some((g) => globName(repo, g))) return false;
    const until = Date.parse(entry.until);
    return Number.isFinite(until) && now < until;
  });
}
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
function parseBrief(text, extensions = new Set()) {
  if (Buffer.byteLength(text) > 40 * 1024) return false;
  const lines = text.split(/\r?\n/), names = ['Task', 'Inputs', 'Output', 'Limits'];
  if (lines[0] !== 'Brief-Class: clean-sandbox') return false;
  const sections = Object.fromEntries(names.map((n) => [n, []]));
  let state = -1, fence = '', blockLines = 0, totalLines = 0, indent = 0;
  const finishIndent = () => { if (indent >= 20) { totalLines += indent; if (indent > 40) return false; } indent = 0; return true; };
  for (const line of lines.slice(1)) {
    const header = /^(Brief-Class|Task|Inputs|Output|Limits):(?:\s*(.*))?$/.exec(line);
    if (header && !fence) {
      if (!finishIndent() || header[1] !== names[state + 1]) return false;
      state++; sections[names[state]].push(header[2] || ''); continue;
    }
    if (state < 0) { if (line.trim()) return false; continue; }
    sections[names[state]].push(line);
    const trimmed = line.trimStart();
    const mark = /^(\`{3,}|~{3,})/.exec(trimmed);
    if (fence) { if (mark && mark[1][0] === fence && mark[1].length >= 3) { fence = ''; if (blockLines > 40) return false; totalLines += blockLines; blockLines = 0; } else blockLines++; continue; }
    if (mark) { if (!finishIndent()) return false; fence = mark[1][0]; continue; }
    if (/^(?: {4}|\t)/.test(line) && line.trim()) indent++; else if (!finishIndent()) return false;
  }
  if (!finishIndent()) return false;
  if (fence) { if (blockLines > 40) return false; totalLines += blockLines; }
  if (state !== 3 || totalLines > 80) return false;
  for (const [name, limit] of [['Task', 6144], ['Inputs', 24576], ['Output', 2048], ['Limits', 2048]]) {
    const content = sections[name].join('\n');
    if (!content.trim() || Buffer.byteLength(content) > limit) return false;
    for (let token of content.split(/\s+/)) {
      token = token.replace(/^[`*_[({<"']+|[`*_)\]}>"',;!?]+$/g, '');
      if (/^(?:\.\.?\/|~\/|\/)/.test(token) || /[^\s:]+:\d+(?::\d+)?$/.test(token)) return false;
      if (token.includes('/') && extensions.has(path.extname(token).toLowerCase())) return false;
    }
  }
  return true;
}
const SHINGLE_VERSION = 'cn-shingle-v2';
const GIT_ENV_KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY'];
function git(root, args) {
  const env = { ...process.env }; for (const k of GIT_ENV_KEYS) delete env[k];
  const r = spawnSync('git', ['-C', root, ...args], { env, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0 || r.error) throw Error('git');
  return r.stdout;
}
function sourceInfo(source) {
  const root = fs.realpathSync(source);
  if (fs.realpathSync(String(git(root, ['rev-parse', '--show-toplevel'])).trim()) !== root) throw Error('root');
  const tracked = String(git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
  if (!tracked.length) throw Error('empty');
  const untracked = String(git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  return { root, names: [...new Set([...tracked, ...untracked])].sort(), extensions: new Set(tracked.map(x => path.extname(x).toLowerCase()).filter(Boolean)) };
}
function words(text) {
  return text.normalize('NFKC').toLowerCase().match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+/gu) || [];
}
function hashWindow(w) { return crypto.createHash('sha256').update(w.join('\0')).digest('hex').slice(0, 16); }
function windows(text) { const w = words(text), result = []; for (let i = 0; i + 8 <= w.length; i++) result.push(hashWindow(w.slice(i, i + 8))); return result; }
function shingleIndex(info, env) {
  const runtime = fs.realpathSync(env.XDG_RUNTIME_DIR || '');
  if (fs.statfsSync(runtime).type !== 0x01021994) throw Error('tmpfs');
  fs.accessSync(runtime, fs.constants.W_OK);
  const base = path.join(runtime, 'autopilot'), dir = path.join(base, 'cn-shingle');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(base, 0o700); fs.chmodSync(dir, 0o700);
  if (fs.statfsSync(fs.realpathSync(dir)).type !== 0x01021994) throw Error('tmpfs');
  const entries = [], signatures = [];
  for (const name of info.names) {
    const file = path.join(info.root, name); let st;
    try { st = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (st.isSymbolicLink() || !st.isFile()) continue;
    const fd = fs.openSync(file, 'r'), digest = crypto.createHash('sha256'), buf = Buffer.allocUnsafe(65536);
    let n, first = true, binary = false, size = 0;
    try { while ((n = fs.readSync(fd, buf, 0, buf.length, null))) { const b = buf.subarray(0, n); if (first) binary = b.subarray(0, 8192).includes(0); first = false; size += n; digest.update(b); } } finally { fs.closeSync(fd); }
    if (binary) continue;
    entries.push({ name, file }); signatures.push(`${name}:${size}:${digest.digest('hex')}`);
  }
  if (!entries.length) throw Error('empty');
  const key = crypto.createHash('sha256').update(JSON.stringify([SHINGLE_VERSION, info.root, signatures])).digest('hex');
  const cache = path.join(dir, `${key}.bin`);
  function decode(buf) {
    if (buf.length < 52 || buf.subarray(0, 8).toString() !== 'CNSHNG02') throw Error('magic');
    const len = buf.readUInt32BE(8); if (len !== buf.length - 44) throw Error('length');
    const payload = buf.subarray(12, 12 + len); if (!crypto.createHash('sha256').update(payload).digest().equals(buf.subarray(12 + len))) throw Error('checksum');
    const namesLen = payload.readUInt32LE(0), count = payload.readUInt32LE(4);
    const offset = 8 + namesLen;
    if (offset > payload.length || count * 16 !== payload.length - offset) throw Error('layout');
    const names = JSON.parse(payload.subarray(8, offset).toString());
    if (!Array.isArray(names) || names.length !== entries.length || names.some((name, i) => name !== entries[i].name)) throw Error('entries');
    const rows = new Uint32Array(count * 4);
    for (let i = 0; i < rows.length; i++) rows[i] = payload.readUInt32LE(offset + i * 4);
    return { entries: names, rows };
  }
  try { const cached = decode(fs.readFileSync(cache)); fs.chmodSync(cache, 0o600); return cached; } catch { /* invalid or absent cache: rebuild */ }
  const chunks = [], chunkSize = 65536; let chunk, count = 0;
  for (let id = 0; id < entries.length; id++) {
    const fd = fs.openSync(entries[id].file, 'r'), decoder = new StringDecoder('utf8'), buf = Buffer.allocUnsafe(65536);
    let pending = '', line = 1, window = [], n;
    const consume = (text, final = false) => {
      let combined = pending + text, cut = combined.length;
      if (!final) { const match = /[\p{L}\p{N}_\p{M}]+$/u.exec(combined); if (match) cut = match.index; }
      pending = combined.slice(cut); combined = combined.slice(0, cut);
      const re = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+|\n/gu;
      for (const match of combined.normalize('NFKC').toLowerCase().matchAll(re)) {
        if (match[0] === '\n') { line++; continue; }
        window.push([match[0], line]); if (window.length > 8) window.shift();
        if (window.length === 8) {
          const h = hashWindow(window.map(x => x[0]));
          if (count % chunkSize === 0) { chunk = new Uint32Array(chunkSize * 4); chunks.push(chunk); }
          const pos = (count++ % chunkSize) * 4;
          chunk[pos] = parseInt(h.slice(0, 8), 16); chunk[pos + 1] = parseInt(h.slice(8), 16);
          chunk[pos + 2] = id; chunk[pos + 3] = window[0][1];
        }
      }
    };
    try { while ((n = fs.readSync(fd, buf, 0, buf.length, null))) consume(decoder.write(buf.subarray(0, n))); consume(decoder.end(), true); } finally { fs.closeSync(fd); }
  }
  let rows = new Uint32Array(count * 4), at = 0;
  for (const c of chunks) { const part = c.subarray(0, Math.min(c.length, rows.length - at)); rows.set(part, at); at += part.length; }
  chunks.length = 0;
  // Sort rows in place by hash, file and line; the first duplicate is the earliest line.
  const compare = (pos, hi, lo, id, line) => rows[pos] - hi || rows[pos + 1] - lo || rows[pos + 2] - id || rows[pos + 3] - line;
  const swap = (a, b) => { for (let j = 0; j < 4; j++) { const v = rows[a + j]; rows[a + j] = rows[b + j]; rows[b + j] = v; } };
  const stack = count ? [0, count - 1] : [];
  while (stack.length) {
    const end = stack.pop(), start = stack.pop(), pivot = ((start + end) >>> 1) * 4;
    const hi = rows[pivot], lo = rows[pivot + 1], id = rows[pivot + 2], line = rows[pivot + 3];
    let left = start, i = start, right = end;
    while (i <= right) {
      const cmp = compare(i * 4, hi, lo, id, line);
      if (cmp < 0) swap(left++ * 4, i++ * 4);
      else if (cmp > 0) swap(i * 4, right-- * 4);
      else i++;
    }
    if (start < left - 1) stack.push(start, left - 1);
    if (right + 1 < end) stack.push(right + 1, end);
  }
  let kept = 0, distinct = 0, hasRare = false;
  let prevHi, prevLo, prevId;
  for (let i = 0; i < rows.length; i += 4) {
    const hi = rows[i], lo = rows[i + 1], id = rows[i + 2], line = rows[i + 3];
    if (i === 0 || hi !== prevHi || lo !== prevLo) {
      if (distinct && distinct < 20) hasRare = true;
      distinct = 0;
    } else if (id === prevId) continue;
    prevHi = hi; prevLo = lo; prevId = id;
    distinct++; rows[kept++] = hi; rows[kept++] = lo; rows[kept++] = id; rows[kept++] = line;
  }
  if (distinct && distinct < 20) hasRare = true;
  if (!hasRare) throw Error('no windows');
  rows = rows.subarray(0, kept);
  const result = { entries: entries.map(x => x.name), rows }, names = Buffer.from(JSON.stringify(result.entries));
  const payload = Buffer.allocUnsafe(8 + names.length + rows.byteLength), header = Buffer.alloc(12);
  payload.writeUInt32LE(names.length, 0); payload.writeUInt32LE(kept / 4, 4); names.copy(payload, 8);
  for (let i = 0; i < kept; i++) payload.writeUInt32LE(rows[i], 8 + names.length + i * 4);
  header.write('CNSHNG02'); header.writeUInt32BE(payload.length, 8);
  const tmp = path.join(dir, `.${key}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`);
  try { const fd = fs.openSync(tmp, 'wx', 0o600); try { fs.writeFileSync(fd, header); fs.writeFileSync(fd, payload); fs.writeFileSync(fd, crypto.createHash('sha256').update(payload).digest()); } finally { fs.closeSync(fd); } fs.renameSync(tmp, cache); } finally { try { fs.unlinkSync(tmp); } catch {} }
  for (const name of fs.readdirSync(dir)) { const file = path.join(dir, name); try { if (fs.statSync(file).mtimeMs < Date.now() - 86400000) fs.unlinkSync(file); } catch {} }
  return result;
}
function shingleHits(text, data, env) {
  const ws = windows(text), hits = [], runs = new Map(), rows = data.rows, count = rows.length / 4;
  for (const h of ws) {
    const hi = parseInt(h.slice(0, 8), 16), lo = parseInt(h.slice(8), 16), next = new Map();
    let left = 0, right = count;
    while (left < right) { const mid = Math.floor((left + right) / 2), pos = mid * 4; if (rows[pos] < hi || (rows[pos] === hi && rows[pos + 1] < lo)) left = mid + 1; else right = mid; }
    const start = left;
    while (left < count && rows[left * 4] === hi && rows[left * 4 + 1] === lo) { const id = rows[left * 4 + 2]; next.set(id, (runs.get(id) || 0) + 1); left++; }
    if (left > start && (left - start < 20 || [...next.values()].some(x => x >= 4))) hits.push([start, left]);
    runs.clear(); for (const [k, v] of next) runs.set(k, v);
  }
  if (hits.length) {
    const log = path.join(fs.realpathSync(env.XDG_RUNTIME_DIR), 'autopilot', 'cn-gate.log');
    const lines = []; for (const [start, end] of hits) for (let i = start; i < end; i++) lines.push(`${data.entries[rows[i * 4 + 2]]}:${rows[i * 4 + 3]}`);
    const fd = fs.openSync(log, 'a', 0o600); try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, `${lines.join('\n')}\n`); } finally { fs.closeSync(fd); }
  }
  return hits.length;
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
    if (!reviewRoleAllows(opts, env)) return { allowed: false, family, cls: 'review-role', line: refusalLine(family, 'review-role') };
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
  if (host && isLocalHost(host, env)) {
    if (!reviewRoleAllows(opts, env)) return { allowed: false, family, cls: 'review-role', line: refusalLine(family, 'review-role') };
    return { allowed: true, family };
  }
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
  const sources = opts.sourceRepos || (opts.sourceRepo !== undefined ? [opts.sourceRepo] : []);
  if (sources.length !== 1 || !sources[0]) return block('restricted_operator_shingle_source_missing');
  let info; try { info = sourceInfo(sources[0]); } catch { return block('restricted_operator_shingle_source_missing'); }
  let text; try { text = files.map(file => fs.readFileSync(file, 'utf8')).join('\n'); } catch { return block('restricted_operator_brief_template'); }
  if (!parseBrief(text, info.extensions)) return block('restricted_operator_brief_template');
  let hits; try { hits = shingleHits(text, shingleIndex(info, env), env); } catch { return block('restricted_operator_shingle_unavailable'); }
  if (hits) { const result = block('restricted_operator_brief_shingle'); result.line += ` hits=${hits}`; return result; }
  return { allowed: true, family };
}
function rungParts(rung) {
  const raw = String(rung); const m = /^(.*?)(?:\/[a-z]+)?@([^@]+)$/.exec(raw);
  if (!m) { const i = raw.indexOf('#'); return i < 0 ? { model: raw, runner: '', endpoint: '' } : { model: raw.slice(0, i), runner: '', endpoint: raw.slice(i + 1) }; }
  const hash = m[2].indexOf('#'); return { model: m[1], runner: hash < 0 ? m[2] : m[2].slice(0, hash), endpoint: hash < 0 ? '' : m[2].slice(hash + 1) };
}
function filterLadder(rungs, ctx = {}) { const kept = []; const barred = []; for (const rung of rungs) { const p = rungParts(rung); const c = check({ ...ctx, ...p, endpoint: p.endpoint || ctx.endpoint }); if (c.allowed) kept.push(rung); else barred.push({ rung, family: c.family, line: c.line, cls: c.cls }); } return { kept, barred }; }
function main(argv) {
  const cmd = argv[0], o = { files: [], sourceRepos: [] }, rest = [];
  for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (['--runner', '--model', '--endpoint', '--cwd', '--prompt-file', '--source-repo'].includes(a)) { const k = a.slice(2); const v = argv[++i]; if (k === 'prompt-file') o.files.push(v); else if (k === 'source-repo') o.sourceRepos.push(v); else o[k] = v; }
    else { process.stderr.write(`cn-model-dispatch-gate: unknown arg ${a}\n`); return 64; }
  }
  if (cmd === 'check') { const c = check(o); if (!c.allowed) { process.stderr.write(`${c.line}\n`); return 2; } return 0; }
  if (cmd === 'filter-ladder') { const r = filterLadder(rest, o); if (!r.kept.length && r.barred.length) { process.stderr.write(`${r.barred[0].line}\n`); return 2; } for (const x of r.kept) process.stdout.write(`${x}\n`); return 0; }
  process.stderr.write('usage: cn-model-dispatch-gate.js check|filter-ladder ...\n'); return 64;
}
module.exports = { BARRED_FAMILIES, localEndpoints, TASK, CARD, familyOf, check, filterLadder, refusalLine, repoRootOf, isLocalHost, hostOf };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
