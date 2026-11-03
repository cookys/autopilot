#!/usr/bin/env node
'use strict';

// check-quota-adapters.js — checker for the G40 adapter manifests (`fleet.quota-adapter/1`, plan 20.3, 20.5, N27, N28,
// N72). One manifest per provider under scripts/quota-adapters/<provider>.json; the file name is the provider.
//
//   node scripts/check-quota-adapters.js [--json] [--root DIR] [--dir DIR] [--evidence-dir DIR]
//
// Exit codes: 0 = every manifest passes, 1 = a finding, 2 = usage / no manifests / unreadable directory.
// Output: one line per finding on stdout, or with --json { ok, root, manifests, findings: [{file, rule, detail}] }.
//
// Rules (a finding's `rule`):
//   schema, unknown_key, provider, visibility, starts_window, starts_window_evidence, windows, required_window,
//   capture, capture_order, verified_evidence, verified_false_enabled, tinyprobe_argv, visibility_unverified,
//   matrix_row, credential_ref, token_lifetime
// The checker works on strings only: it opens the evidence files the manifest names (the capability matrix) and
// NOTHING a credential_ref points at; a credential reference is a template under <accounts-dir>/<alias>/ (ruling 8)
// and is judged by its text alone. A manifest field not backed by a matrix row or an evidence path fails (20.5).
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const LAYOUT = require('./lib/repo-layout.js');
const { WINDOW_KINDS, UNITS, VISIBILITY, TOKEN_SHAPES } = require('./lib/account-observation.js');

const SCRIPTS_DIR = LAYOUT.path('scripts_dir');
const MANIFEST_SCHEMA = 'fleet.quota-adapter/1';
const EVIDENCE_DIR = 'docs/plans/evidence/2026-11-03-g40-agent-lane-quota';
const PLACEHOLDER = '<PROMPT>';

const TOP_KEYS = ['schema', 'provider', 'visibility', 'starts_window', 'starts_window_evidence', 'windows', 'capture', 'credential_ref', 'token_lifetime', 'matrix_row'];
const MODES = ['passive', 'endpoint', 'tinyprobe', 'fallback']; // cost order, cheapest first (20.3 rule 1)
const COSTS = ['zero_token', 'tokens', 'local'];
const CAPTURE_KEYS = ['mode', 'cost', 'verified', 'enabled', 'evidence', 'note', 'parser', 'needs', 'argv_template', 'est_cost_usd', 'est_out_tokens', 'min_interval_minutes', 'starts_window', 'counter', 'plan_limit', 'source', 'cooldown_on_429'];
const PROVIDER_RE = /^[a-z0-9-]{1,24}$/;
const ENV_NAME_RE = /^[A-Z0-9_]{1,64}$/;
const TEMPLATE_PREFIX = '<accounts-dir>/<alias>/';

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
function posInt(x) { return Number.isInteger(x) && x > 0; }

// shell-ish tokenizer: whitespace separates, double or single quotes group, "" is an empty argument.
function tokenize(text) {
  const out = [];
  let cur = null;
  let quote = null;
  for (const ch of String(text)) {
    if (quote) {
      if (ch === quote) quote = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch; if (cur === null) cur = '';
    } else if (/\s/.test(ch)) {
      if (cur !== null) { out.push(cur); cur = null; }
    } else {
      cur = (cur === null ? '' : cur) + ch;
    }
  }
  if (cur !== null) out.push(cur);
  return out;
}

function slug(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The section (lines) of the matrix whose `## ` heading slug is the anchor, or starts with `<anchor>-`.
function matrixSection(text, anchor) {
  const lines = text.split('\n');
  const heads = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (m) heads.push({ at: i, s: slug(m[1]) });
  }
  // an exact slug wins; a prefix match is the fallback (so `claude` still finds `## claude code` when no `## claude` exists)
  const h = heads.find((x) => x.s === anchor) || heads.find((x) => x.s.startsWith(`${anchor}-`));
  if (!h) return null;
  const next = heads.find((x) => x.at > h.at);
  return lines.slice(h.at + 1, next ? next.at : lines.length);
}

function evidenceProblem(ev, ctx) {
  if (typeof ev !== 'string' || ev.length === 0) return 'evidence_missing';
  if (/^https:\/\/[^\s@]+$/.test(ev)) return null; // a URL: syntax only, never fetched
  if (/^[a-z][a-z0-9+.-]*:/i.test(ev) || ev.startsWith('/') || ev.includes('..') || /\s/.test(ev) || ev.includes('=')) return 'evidence_not_a_repo_path_or_https_url';
  return ctx.exists(ev.split('#')[0]) ? null : 'evidence_path_missing';
}

// A credential_ref path template: text only, nothing is opened (N28, ruling 8).
function templateProblem(p) {
  if (typeof p !== 'string' || p.length === 0) return 'not_a_string';
  if (TOKEN_SHAPES.some((re) => re.test(p))) return 'token_shaped';
  if (p.includes('://')) return 'scheme_or_userinfo';
  if (p.includes('=')) return 'assignment';
  if (p.includes('..') || p.includes('\\') || /\s/.test(p)) return 'unsafe_characters';
  if (p.startsWith('/') || p.startsWith('~')) return 'absolute_path';
  if (!p.startsWith(TEMPLATE_PREFIX)) return 'outside_allowed_roots';
  const rest = p.slice(TEMPLATE_PREFIX.length);
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(rest)) return 'not_a_path_template';
  return null;
}

function checkCredentialRef(ref, add) {
  if (!isObj(ref)) return add('credential_ref', 'not_an_object');
  if (ref.kind === 'file') {
    if (Object.keys(ref).some((k) => k !== 'kind' && k !== 'path')) return add('credential_ref', 'unknown_key');
    const p = templateProblem(ref.path);
    if (p) add('credential_ref', `file_path:${p}`);
  } else if (ref.kind === 'env') {
    if (Object.keys(ref).some((k) => k !== 'kind' && k !== 'name' && k !== 'file')) return add('credential_ref', 'unknown_key');
    if (typeof ref.name !== 'string' || !ENV_NAME_RE.test(ref.name)) add('credential_ref', 'env_name');
    const p = templateProblem(ref.file);
    if (p) add('credential_ref', `env_file:${p}`);
  } else {
    add('credential_ref', 'kind');
  }
  return undefined;
}

function checkTinyprobe(c, matrix, add) {
  const t = c.argv_template;
  if (!Array.isArray(t) || t.length === 0 || t.some((x) => typeof x !== 'string')) return add('tinyprobe_argv', 'argv_template_missing');
  if (t.filter((x) => x === PLACEHOLDER).length !== 1) return add('tinyprobe_argv', 'placeholder_count');
  if (!matrix) return undefined; // matrix_row already failed; one finding is enough
  const spans = [];
  for (const line of matrix) {
    if (!/tinyprobe/i.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) spans.push(tokenize(m[1]));
  }
  const evidenced = spans.find((tokens) => tokens[0] === t[0] && tokens.includes('-p'));
  if (!evidenced) return add('tinyprobe_argv', 'no_evidenced_command_in_matrix_row');
  const prompt = evidenced[evidenced.indexOf('-p') + 1];
  const rendered = t.map((x) => (x === PLACEHOLDER ? prompt : x));
  if (JSON.stringify(rendered) !== JSON.stringify(evidenced)) return add('tinyprobe_argv', 'not_byte_equal_to_evidenced_command');
  return undefined;
}

// checkManifest(m, ctx) -> [{ rule, detail }]. ctx: { fileProvider, exists(repoRel) -> bool, readText(repoRel) -> string|null,
// evidenceDir } — everything the checker may touch; a credential string is never passed to either function.
function checkManifest(m, ctx) {
  const findings = [];
  const add = (rule, detail) => findings.push({ rule, detail });
  if (!isObj(m)) { add('schema', 'not_an_object'); return findings; }
  for (const k of Object.keys(m)) if (!TOP_KEYS.includes(k)) add('unknown_key', 'top_level');
  if (m.schema !== MANIFEST_SCHEMA) add('schema', 'wrong_schema');
  if (typeof m.provider !== 'string' || !PROVIDER_RE.test(m.provider)) add('provider', 'grammar');
  else if (ctx.fileProvider !== undefined && m.provider !== ctx.fileProvider) add('provider', 'file_name_mismatch');
  if (!VISIBILITY.includes(m.visibility)) add('visibility', 'enum');

  // starts_window: true | false | "unknown", with its evidence when not unknown (20.3 rule 2).
  if (!('starts_window' in m)) add('starts_window', 'missing');
  else if (m.starts_window !== true && m.starts_window !== false && m.starts_window !== 'unknown') add('starts_window', 'enum');
  else if (m.starts_window !== 'unknown') {
    const p = evidenceProblem(m.starts_window_evidence, ctx);
    if (p) add('starts_window_evidence', p);
  }

  // windows and required windows (8.3, N72).
  if (!Array.isArray(m.windows) || m.windows.length === 0) add('windows', 'missing');
  else {
    const kinds = new Set();
    for (const w of m.windows) {
      if (!isObj(w) || !WINDOW_KINDS.includes(w.kind) || (w.unit !== null && !UNITS.includes(w.unit))
        || typeof w.limit_known !== 'boolean' || typeof w.required !== 'boolean'
        || Object.keys(w).some((k) => !['kind', 'unit', 'limit_known', 'required'].includes(k))) { add('windows', 'entry'); continue; }
      if (kinds.has(w.kind)) add('windows', 'duplicate_kind');
      kinds.add(w.kind);
    }
    if ((m.visibility === 'L2' || m.visibility === 'L3') && !m.windows.some((w) => isObj(w) && w.required === true)) {
      add('required_window', 'a manifest that can reach L2 or L3 must list at least one required window');
    }
  }

  // matrix_row: <file>#<anchor> inside the evidence directory; the anchor must resolve to a heading.
  let matrix = null;
  if (typeof m.matrix_row !== 'string' || !/^[A-Za-z0-9._-]+\.md#[a-z0-9-]+$/.test(m.matrix_row)) add('matrix_row', 'missing_or_malformed');
  else {
    const [file, anchor] = m.matrix_row.split('#');
    const text = ctx.readText(path.posix.join(ctx.evidenceDir, file));
    if (text === null) add('matrix_row', 'matrix_file_missing');
    else {
      matrix = matrixSection(text, anchor);
      if (matrix === null) add('matrix_row', 'anchor_not_found');
    }
  }

  // captures, cheapest first (20.3 rules 1, 5, 6, N27).
  let anyVerified = false;
  if (!Array.isArray(m.capture) || m.capture.length === 0) add('capture', 'missing');
  else {
    let last = -1;
    for (const c of m.capture) {
      if (!isObj(c)) { add('capture', 'entry'); continue; }
      if (Object.keys(c).some((k) => !CAPTURE_KEYS.includes(k))) add('capture', 'unknown_key');
      const at = MODES.indexOf(c.mode);
      if (at < 0) { add('capture', 'mode'); continue; }
      if (at <= last) add('capture_order', 'modes must be unique and listed in cost order');
      last = Math.max(last, at);
      if (!COSTS.includes(c.cost)) add('capture', 'cost');
      if (c.verified === undefined && c.mode !== 'fallback') add('capture', 'verified_missing');
      else if (c.verified !== undefined && typeof c.verified !== 'boolean') add('capture', 'verified_type');
      if (c.verified === true) {
        anyVerified = true;
        const p = evidenceProblem(c.evidence, ctx);
        if (p) add('verified_evidence', `${c.mode}:${p}`);
        if (c.mode === 'tinyprobe') checkTinyprobe(c, matrix, add);
      } else if (c.mode === 'tinyprobe' && c.argv_template !== undefined) {
        const t = c.argv_template;
        if (!Array.isArray(t) || t.some((x) => typeof x !== 'string')) add('tinyprobe_argv', 'argv_template_type');
      }
      if (c.verified === false) {
        if (c.enabled === true) add('verified_false_enabled', `${c.mode}: a capture marked verified:false is disabled at runtime`);
        if (typeof c.note !== 'string' || c.note.length === 0) add('capture', `${c.mode}:note_required_when_unverified`);
      }
      if (c.mode === 'fallback') {
        if (c.source !== undefined && c.source !== 'estimated') add('capture', 'fallback_source');
        if (c.cooldown_on_429 !== undefined && !(isObj(c.cooldown_on_429) && posInt(c.cooldown_on_429.default_minutes))) add('capture', 'cooldown_on_429');
      }
      if (c.min_interval_minutes !== undefined && !posInt(c.min_interval_minutes)) add('capture', 'min_interval_minutes');
    }
  }
  // 20.3 rule 5: the visibility is what VERIFIED captures can reach; a manifest with none is L0.
  if (m.visibility !== 'L0' && VISIBILITY.includes(m.visibility) && !anyVerified) add('visibility_unverified', `${m.visibility} needs at least one verified capture`);

  checkCredentialRef(m.credential_ref, add);

  const tl = m.token_lifetime;
  if (!isObj(tl) || Object.keys(tl).some((k) => k !== 'days' && k !== 'evidence')) add('token_lifetime', 'shape');
  else if (tl.days !== null && !posInt(tl.days)) add('token_lifetime', 'days');
  else if (tl.days !== null) {
    const p = evidenceProblem(tl.evidence, ctx);
    if (p) add('token_lifetime', `days_without_evidence:${p}`);
  }
  return findings;
}

function usage(code) {
  const msg = 'Usage: node scripts/check-quota-adapters.js [--json] [--root DIR] [--dir DIR] [--evidence-dir DIR]\n'
    + '  Exit 0 = every manifest passes, 1 = finding(s), 2 = usage / no manifests.\n';
  (code === 0 ? process.stdout : process.stderr).write(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const o = { json: false, root: path.resolve(__dirname, '..'), dir: null, evidenceDir: EVIDENCE_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (a === '--root' || a === '--dir' || a === '--evidence-dir') {
      const v = argv[i + 1];
      if (v === undefined) usage(2);
      i += 1;
      if (a === '--root') o.root = path.resolve(v); else if (a === '--dir') o.dir = path.resolve(v); else o.evidenceDir = v;
    } else usage(2);
  }
  if (!o.dir) o.dir = path.join(o.root, SCRIPTS_DIR, 'quota-adapters');
  return o;
}

function checkDir(opts) {
  const ctx0 = {
    evidenceDir: opts.evidenceDir,
    exists: (rel) => { try { return fs.statSync(path.join(opts.root, rel)).isFile(); } catch (_) { return false; } },
    readText: (rel) => { try { return fs.readFileSync(path.join(opts.root, rel), 'utf8'); } catch (_) { return null; } },
  };
  let names;
  try { names = fs.readdirSync(opts.dir).filter((n) => n.endsWith('.json')).sort(); } catch (_) { return null; }
  const findings = [];
  for (const name of names) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(opts.dir, name), 'utf8')); } catch (_) { findings.push({ file: name, rule: 'schema', detail: 'unreadable_or_not_json' }); continue; }
    for (const f of checkManifest(m, Object.assign({ fileProvider: name.slice(0, -5) }, ctx0))) findings.push({ file: name, rule: f.rule, detail: f.detail });
  }
  return { names, findings };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const r = checkDir(opts);
  if (!r || r.names.length === 0) {
    process.stderr.write(`check-quota-adapters: no manifests found in ${opts.dir}\n`);
    process.exit(2);
  }
  if (opts.json) process.stdout.write(`${JSON.stringify({ ok: r.findings.length === 0, root: opts.root, manifests: r.names, findings: r.findings })}\n`);
  else if (r.findings.length === 0) process.stdout.write(`check-quota-adapters: ${r.names.length} manifest(s) ok\n`);
  else for (const f of r.findings) process.stdout.write(`${f.file}: ${f.rule}: ${f.detail}\n`);
  process.exit(r.findings.length === 0 ? 0 : 1);
}

module.exports = { checkManifest, checkDir, tokenize, matrixSection, templateProblem, EVIDENCE_DIR, MANIFEST_SCHEMA };

if (require.main === module) main();
