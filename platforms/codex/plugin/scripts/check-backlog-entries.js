#!/usr/bin/env node
'use strict';

/**
 * check-backlog-entries.js — portable backlog-entry gate.
 *
 * Caps are UTF-8 bytes. The schema lives only in references/backlog-entry.md.
 * This script never rewrites a backlog. Allowlist ratchet: --update-allowlist
 * may only remove (fingerprint, code) pairs that no longer violate.
 *
 * Usage:
 *   node scripts/check-backlog-entries.js --backlog <file>
 *     [--config <file>] [--allowlist <file>] [--mode warn|block]
 *     [--json] [--self-test] [--update-allowlist]
 *
 * Exit: 0 clean or warn · 1 block with new violations · 2 usage / unreadable / self-test fail
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const KNOWN_FIELDS = ['Title', 'Status', 'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
const REQUIRED = ['Title', 'Status', 'Trigger', 'Effort', 'Source', 'Pointer'];
const EFFORTS = new Set(['S', 'Fix', 'M', 'L', 'H']);
const DEFAULT_CAPS = {
  Title: 120,
  Status: 64,
  Trigger: 240,
  Source: 160,
  Pointer: 200,
  Context: 240,
  entry: 900,
};
const POINTER_THRESHOLD = 600;
const DEFAULT_ROOTS = ['docs/plans/', 'docs/projects/', 'docs/backlog/'];
// `shipped` carries the ship date as well as the version/sha: done_not_moved is measured from a
// date, and a version alone has none (depth-0 probe, 2026-09-14).
const STATUS_RE = /^(open|fired \d{4}-\d{2}-\d{2}|dropped \d{4}-\d{2}-\d{2}|shipped \S+ \d{4}-\d{2}-\d{2})$/;
const CODES = [
  'missing_field', 'cap_exceeded', 'bad_status', 'bad_effort',
  'pointer_missing', 'pointer_unresolved', 'pointer_required',
  'duplicate_title', 'duplicate_id', 'extra_content', 'done_not_moved',
  'unparseable_entry', 'config_raises_cap',
];

function byteLen(s) {
  return Buffer.byteLength(String(s == null ? '' : s), 'utf8');
}

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/check-backlog-entries.js --backlog <file> ' +
    '[--config <file>] [--allowlist <file>] [--mode warn|block] ' +
    '[--json] [--self-test] [--update-allowlist]\n'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    backlog: null,
    config: null,
    allowlist: null,
    mode: null,
    json: false,
    selfTest: false,
    updateAllowlist: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) usage(2);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage(0);
    else if (a === '--backlog') out.backlog = need();
    else if (a === '--config') out.config = need();
    else if (a === '--allowlist') out.allowlist = need();
    else if (a === '--mode') out.mode = need();
    else if (a === '--json') out.json = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--update-allowlist') out.updateAllowlist = true;
    else usage(2);
  }
  if (out.mode != null && out.mode !== 'warn' && out.mode !== 'block') usage(2);
  return out;
}

function gitToplevel(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function resolveBacklogConfigPath(repoRoot) {
  const helper = path.join(SCRIPT_DIR, 'resolve-project-paths.sh');
  const r = spawnSync('bash', [helper, '--target', repoRoot, '--field', 'backlog_config'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return null;
  const v = String(r.stdout || '').trim();
  if (!v || v === 'none') return null;
  return path.isAbsolute(v) ? v : path.join(repoRoot, v);
}

function parseListSection(text, headingRe) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let inb = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inb = headingRe.test(line);
      continue;
    }
    if (!inb) continue;
    const m = line.match(/^\s*-\s+`?([^`]+?)`?\s*$/);
    if (m) items.push(m[1].trim());
  }
  return items;
}

function kv(text, key) {
  const re = new RegExp(
    String.raw`(?:^|\n)\s*(?:-\s*)?(?:` + key + String.raw`)\s*:\s*` + '`?([^`\\n]+)`?',
    'i'
  );
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function parseConfigFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const cfg = { caps: {} };
  const style = kv(text, 'style');
  if (style) cfg.style = style;
  const mode = kv(text, 'mode');
  if (mode) cfg.mode = mode;
  const idp = kv(text, 'id_pattern');
  if (idp && idp !== 'none') cfg.id_pattern = idp;
  const allow = kv(text, 'allowlist_path') || kv(text, 'allowlist');
  if (allow) cfg.allowlist_path = allow;
  const days = kv(text, 'done_retention_days');
  if (days && /^\d+$/.test(days)) cfg.done_retention_days = Number(days);
  const roots = parseListSection(text, /pointer\s*roots/i);
  if (roots.length) cfg.pointer_roots = roots;
  const capLines = text.split(/\r?\n/);
  for (const line of capLines) {
    const m = line.match(/^\s*-\s+caps\.(\w+)\s*:\s*(\d+)\s*$/i)
      || line.match(/^\s*-\s+(Title|Status|Trigger|Source|Pointer|Context|entry)\s*:\s*(\d+)\s*$/i);
    if (m) {
      const canonical = KNOWN_FIELDS.find((f) => f.toLowerCase() === m[1].toLowerCase())
        || (m[1].toLowerCase() === 'entry' ? 'entry' : null);
      if (canonical) cfg.caps[canonical] = Number(m[2]);
    }
  }
  return cfg;
}

function builtinConfig() {
  return {
    style: 'heading',
    pointer_roots: DEFAULT_ROOTS.slice(),
    id_pattern: null,
    mode: 'warn',
    allowlist_path: null,
    done_retention_days: 30,
    caps: {},
  };
}

function mergeConfig(base, over) {
  const out = {
    style: over.style || base.style,
    pointer_roots: over.pointer_roots || base.pointer_roots,
    id_pattern: over.id_pattern !== undefined ? over.id_pattern : base.id_pattern,
    mode: over.mode || base.mode,
    allowlist_path: over.allowlist_path || base.allowlist_path,
    done_retention_days: over.done_retention_days != null ? over.done_retention_days : base.done_retention_days,
    caps: Object.assign({}, over.caps || {}),
  };
  return out;
}

function fingerprint(style, title) {
  const n = String(title || '').trim().toLowerCase();
  return crypto.createHash('sha256').update(style + ':' + n, 'utf8').digest('hex');
}

function fieldLine(line) {
  const m = line.match(/^\s*-\s+\*\*([A-Za-z]+)\*\*\s*[:：]\s*(.*)$/)
    || line.match(/^\s*-\s+([A-Za-z]+)\s*[:：]\s*(.*)$/);
  if (!m) return null;
  const name = m[1];
  if (!KNOWN_FIELDS.includes(name) && name !== 'Id') return { extra: true, raw: line };
  return { name, value: m[2].trim() };
}

function splitHeadingEntries(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let orphan = [];
  const flushOrphan = () => {
    const blob = orphan.join('\n').trim();
    orphan = [];
    if (!blob) return;
    if (/(?:^|\n)\s*-\s+\*\*[A-Za-z]+\*\*/.test(blob) || /(?:^|\n)\s*-\s+(?:Status|Trigger|Effort|Source|Pointer|Context)\s*:/.test(blob)) {
      blocks.push({ kind: 'orphan', text: blob });
    }
  };
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      flushOrphan();
      if (cur) blocks.push(cur);
      cur = { kind: 'heading', title: line.replace(/^###\s+/, '').trim(), lines: [line] };
      continue;
    }
    if (cur) cur.lines.push(line);
    else orphan.push(line);
  }
  if (cur) blocks.push(cur);
  flushOrphan();
  return blocks;
}

function parseHeadingBlock(block) {
  const text = block.lines.join('\n');
  const fields = {};
  let extra = false;
  let inFence = false;
  for (let i = 1; i < block.lines.length; i++) {
    const line = block.lines[i];
    if (/^\s*```/.test(line)) {
      extra = true;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      extra = true;
      continue;
    }
    if (!line.trim()) continue;
    const fl = fieldLine(line);
    if (fl && fl.extra) {
      extra = true;
      continue;
    }
    if (fl) {
      if (fields[fl.name] != null) extra = true;
      fields[fl.name] = fl.value;
      continue;
    }
    extra = true;
  }
  if (fields.Title == null) fields.Title = block.title;
  else if (fields.Title.trim() !== block.title.trim()) extra = true;
  return { fields, extra, text, id: null, title: fields.Title };
}

function parseTable(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let header = null;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!header) {
      header = cells.map((c) => c.replace(/\*/g, ''));
      continue;
    }
    rows.push({ cells, raw: line });
  }
  return { header, rows };
}

function parseChecklist(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let cur = null;
  for (const line of lines) {
    const head = line.match(/^(\s*)-\s+\[[ xX]\]\s+(?:\[([^\]]*)\]\s+)?(.+)$/);
    if (head && head[1].length === 0) {
      if (cur) items.push(cur);
      cur = { title: head[3].trim(), fields: {}, extra: false, lines: [line] };
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (/^\s*```/.test(line)) {
      cur.extra = true;
      continue;
    }
    if (!line.trim()) continue;
    const fl = fieldLine(line);
    if (fl && fl.extra) {
      cur.extra = true;
      continue;
    }
    if (fl) {
      cur.fields[fl.name] = fl.value;
      continue;
    }
    if (/^\s+-\s+/.test(line)) cur.extra = true;
  }
  if (cur) items.push(cur);
  return items;
}

function pointerOk(value, cfg, repoRoot) {
  const v = String(value || '').trim();
  if (!v) return { missing: true };
  if (v.toLowerCase() === 'none') return { none: true };
  if (cfg.id_pattern) {
    try {
      if (new RegExp(cfg.id_pattern).test(v)) return { id: true };
    } catch {
      /* ignore bad pattern */
    }
  }
  const rel = v.replace(/^\.\/+/, '');
  const abs = path.resolve(repoRoot, rel);
  const rootNorm = path.resolve(repoRoot);
  if (!abs.startsWith(rootNorm + path.sep) && abs !== rootNorm) {
    return { unresolved: true };
  }
  const under = (cfg.pointer_roots || []).some((r) => {
    const rr = path.resolve(repoRoot, r);
    return abs === rr || abs.startsWith(rr.endsWith(path.sep) ? rr : rr + path.sep) ||
      rel === r || rel.startsWith(r.replace(/\/?$/, '/'));
  });
  if (!under) return { unresolved: true };
  if (!fs.existsSync(abs)) return { unresolved: true };
  return { ok: true };
}

function statusDate(status) {
  const m = String(status || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function daysAgo(iso, now) {
  const t = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(t)) return 0;
  return Math.floor((now - t) / 86400000);
}

// A block written in ANOTHER style than the file declares must surface as `unparseable_entry`,
// never vanish: a `### Title` entry appended to a table or checklist backlog is invisible to
// parseTable/parseChecklist by construction (GLM review, 2026-09-14). Heading mode already
// reports orphans; this is the same rule for the other two grammars.
function foreignEntryLines(text, style) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let inItem = false;
  for (const line of lines) {
    if (style === 'checklist' && /^-\s+\[[ xX]\]\s+/.test(line)) { inItem = true; continue; }
    if (/^\s*###\s+\S/.test(line)) { out.push(line); inItem = false; continue; }
    if (/^\s*-\s+\*\*[A-Za-z]+\*\*\s*:/.test(line)) { out.push(line); continue; }
    if (style === 'table' && /^\s*-\s+(Title|Status|Trigger|Effort|Source|Pointer|Context)\s*:/.test(line)) { out.push(line); continue; }
    if (style === 'checklist' && !inItem && /^\s*-\s+(Title|Status|Trigger|Effort|Source|Pointer|Context)\s*:/.test(line)) { out.push(line); continue; }
    if (style === 'checklist' && !line.trim()) inItem = false;
  }
  return out.map((line) => ({ unparseable: true, text: line, title: '' }));
}

function collectEntries(text, style) {
  const out = [];
  if (style === 'table' || style === 'checklist') out.push(...foreignEntryLines(text, style));
  if (style === 'table') {
    const { header, rows } = parseTable(text);
    if (!header) {
      if (text.trim()) out.push({ unparseable: true, text, title: '' });
      return out;
    }
    const idx = {};
    header.forEach((h, i) => { idx[h] = i; });
    for (const row of rows) {
      const get = (n) => (idx[n] != null ? (row.cells[idx[n]] || '') : '');
      if (row.cells.length !== header.length) {
        out.push({ unparseable: true, text: row.raw, title: get('Title') });
        continue;
      }
      const fields = {};
      for (const f of KNOWN_FIELDS) {
        if (idx[f] != null) fields[f] = get(f);
      }
      out.push({
        fields,
        extra: false,
        text: row.raw,
        id: get('Id') || null,
        title: fields.Title || '',
      });
    }
    return out;
  }
  if (style === 'checklist') {
    const items = parseChecklist(text);
    if (!items.length && text.trim()) {
      out.push({ unparseable: true, text, title: '' });
      return out;
    }
    for (const it of items) {
      it.fields.Title = it.fields.Title || it.title;
      out.push({
        fields: it.fields,
        extra: it.extra,
        text: it.lines.join('\n'),
        id: it.fields.Id || null,
        title: it.fields.Title,
      });
    }
    return out;
  }
  const blocks = splitHeadingEntries(text);
  if (!blocks.length && text.trim()) {
    out.push({ unparseable: true, text, title: '' });
    return out;
  }
  for (const b of blocks) {
    if (b.kind === 'orphan') {
      out.push({ unparseable: true, text: b.text, title: '' });
      continue;
    }
    if (!b.title) {
      out.push({ unparseable: true, text: b.lines.join('\n'), title: '' });
      continue;
    }
    const p = parseHeadingBlock(b);
    out.push(p);
  }
  return out;
}

function checkCapsRaised(cfg) {
  const vios = [];
  for (const [k, n] of Object.entries(cfg.caps || {})) {
    const def = DEFAULT_CAPS[k];
    if (def == null) continue;
    if (n > def) {
      vios.push({
        code: 'config_raises_cap',
        title: '',
        field: k,
        detail: `${k} ${n} > schema ${def}`,
      });
    }
  }
  return vios;
}

function effectiveCap(cfg, field) {
  const def = DEFAULT_CAPS[field];
  const over = cfg.caps && cfg.caps[field];
  if (over == null) return def;
  if (over > def) return def;
  return over;
}

function checkEntry(entry, cfg, repoRoot, now) {
  const vios = [];
  if (entry.unparseable) {
    vios.push({
      code: 'unparseable_entry',
      title: entry.title || '',
      field: '',
      detail: 'block could not be classified',
    });
    return vios;
  }
  const fields = entry.fields || {};
  const title = fields.Title || entry.title || '';
  if (entry.extra) {
    vios.push({
      code: 'extra_content',
      title,
      field: '',
      detail: 'extra bullet, sub-list, or fence',
    });
  }
  if (title && /[.\u3002]\s*$/.test(title)) {
    vios.push({
      code: 'extra_content',
      title,
      field: 'Title',
      detail: 'trailing period',
    });
  }
  for (const f of REQUIRED) {
    const val = fields[f];
    if (val == null || String(val).trim() === '') {
      if (f === 'Pointer') {
        vios.push({
          code: 'pointer_missing',
          title,
          field: 'Pointer',
          detail: 'Pointer is required',
        });
      } else {
        vios.push({
          code: 'missing_field',
          title,
          field: f,
          detail: `${f} missing`,
        });
      }
    }
  }
  for (const f of KNOWN_FIELDS) {
    if (fields[f] == null) continue;
    const cap = effectiveCap(cfg, f);
    if (cap == null) continue;
    const n = byteLen(fields[f]);
    if (n > cap) {
      vios.push({
        code: 'cap_exceeded',
        title,
        field: f,
        detail: `${n} > ${cap}`,
      });
    }
  }
  const entryCap = effectiveCap(cfg, 'entry');
  const ebytes = byteLen(entry.text);
  if (ebytes > entryCap) {
    vios.push({
      code: 'cap_exceeded',
      title,
      field: 'entry',
      detail: `${ebytes} > ${entryCap}`,
    });
  }
  if (fields.Status != null && String(fields.Status).trim() !== '') {
    if (!STATUS_RE.test(String(fields.Status).trim())) {
      vios.push({
        code: 'bad_status',
        title,
        field: 'Status',
        detail: String(fields.Status),
      });
    }
  }
  if (fields.Effort != null && String(fields.Effort).trim() !== '') {
    if (!EFFORTS.has(String(fields.Effort).trim())) {
      vios.push({
        code: 'bad_effort',
        title,
        field: 'Effort',
        detail: String(fields.Effort),
      });
    }
  }
  const ptr = fields.Pointer;
  if (ptr != null && String(ptr).trim() !== '') {
    const p = pointerOk(ptr, cfg, repoRoot);
    if (p.none) {
      if (byteLen(entry.text) > POINTER_THRESHOLD) {
        vios.push({
          code: 'pointer_required',
          title,
          field: 'Pointer',
          detail: `entry ${byteLen(entry.text)} B > ${POINTER_THRESHOLD} with none`,
        });
      }
    } else if (p.unresolved) {
      vios.push({
        code: 'pointer_unresolved',
        title,
        field: 'Pointer',
        detail: String(ptr),
      });
    }
  }
  const st = fields.Status && String(fields.Status).trim();
  if (st && /^(shipped|dropped)\b/.test(st)) {
    const d = statusDate(st);
    if (d && daysAgo(d, now) > (cfg.done_retention_days || 30)) {
      vios.push({
        code: 'done_not_moved',
        title,
        field: 'Status',
        detail: `${st} older than ${cfg.done_retention_days} days`,
      });
    }
  }
  return vios;
}

function loadAllowlist(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { schema: 1, entries: [] };
  }
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    process.stderr.write(`unreadable allowlist: ${e.message}\n`);
    process.exit(2);
  }
  try {
    const j = JSON.parse(raw);
    if (j.schema !== 1 || !Array.isArray(j.entries)) return { schema: 1, entries: [] };
    return j;
  } catch {
    process.stderr.write('unreadable allowlist: invalid JSON\n');
    process.exit(2);
  }
}

function allowSet(allow) {
  const s = new Set();
  for (const e of allow.entries || []) {
    for (const c of e.codes || []) s.add(`${e.fingerprint}\0${c}`);
  }
  return s;
}

function runCheck(opts) {
  const backlogPath = path.resolve(opts.backlog);
  let text;
  try {
    text = fs.readFileSync(backlogPath, 'utf8');
  } catch (e) {
    process.stderr.write(`unreadable backlog: ${e.message}\n`);
    process.exit(2);
  }
  const backlogDir = path.dirname(backlogPath);
  const repoRoot = gitToplevel(backlogDir) || backlogDir;
  let cfg = builtinConfig();
  let configPath = opts.config;
  if (!configPath) configPath = resolveBacklogConfigPath(repoRoot);
  if (configPath) {
    try {
      cfg = mergeConfig(cfg, parseConfigFile(configPath));
    } catch (e) {
      process.stderr.write(`unreadable config: ${e.message}\n`);
      process.exit(2);
    }
  }
  if (opts.mode) cfg.mode = opts.mode;
  const allowPath = opts.allowlist
    || (cfg.allowlist_path
      ? (path.isAbsolute(cfg.allowlist_path) ? cfg.allowlist_path : path.join(repoRoot, cfg.allowlist_path))
      : null);
  const allow = loadAllowlist(allowPath);
  const allowedPairs = allowSet(allow);
  const now = Date.now();
  const violations = checkCapsRaised(cfg);
  const entries = collectEntries(text, cfg.style || 'heading');
  const titles = new Map();
  const ids = new Map();
  for (const ent of entries) {
    const t = (ent.fields && ent.fields.Title) || ent.title || '';
    const key = t.trim().toLowerCase();
    if (key) {
      if (titles.has(key)) {
        violations.push({
          code: 'duplicate_title',
          title: t,
          field: 'Title',
          detail: 'duplicate title',
        });
      } else titles.set(key, true);
    }
    if (ent.id) {
      if (ids.has(ent.id)) {
        violations.push({
          code: 'duplicate_id',
          title: t,
          field: 'Id',
          detail: ent.id,
        });
      } else ids.set(ent.id, true);
    }
    violations.push(...checkEntry(ent, cfg, repoRoot, now));
  }
  const style = cfg.style || 'heading';
  const annotated = violations.map((v) => {
    const fp = fingerprint(style, v.title);
    const allowed = allowedPairs.has(`${fp}\0${v.code}`);
    return Object.assign({ allowed }, v);
  });
  const newCount = annotated.filter((v) => !v.allowed).length;
  const allowedCount = annotated.filter((v) => v.allowed).length;
  let exit = 0;
  if (cfg.mode === 'block' && newCount > 0) exit = 1;
  const report = {
    mode: cfg.mode,
    backlog: backlogPath,
    style,
    entries: entries.length,
    bytes: byteLen(text),
    violations: annotated.map((v) => ({
      code: v.code,
      title: v.title,
      field: v.field,
      detail: v.detail,
      allowed: v.allowed,
    })),
    new_count: newCount,
    allowed_count: allowedCount,
    exit,
  };
  return { report, allow, allowPath, cfg, style, annotated };
}

function updateAllowlist(allow, allowPath, style, annotated) {
  const still = new Set();
  for (const v of annotated) still.add(`${fingerprint(style, v.title)}\0${v.code}`);
  const wouldAdd = [];
  for (const v of annotated) {
    const fp = fingerprint(style, v.title);
    const key = `${fp}\0${v.code}`;
    const listed = (allow.entries || []).some(
      (e) => e.fingerprint === fp && (e.codes || []).includes(v.code)
    );
    if (!listed) wouldAdd.push({ fingerprint: fp, code: v.code, title: v.title });
  }
  if (wouldAdd.length) {
    process.stderr.write(JSON.stringify({ error: 'would_add', pairs: wouldAdd }) + '\n');
    return 1;
  }
  const next = [];
  for (const e of allow.entries || []) {
    const codes = (e.codes || []).filter((c) => still.has(`${e.fingerprint}\0${c}`));
    if (codes.length) next.push({ fingerprint: e.fingerprint, codes });
  }
  if (!allowPath) {
    process.stderr.write('--update-allowlist requires --allowlist or config allowlist_path\n');
    return 2;
  }
  fs.writeFileSync(allowPath, JSON.stringify({ schema: 1, entries: next }, null, 2) + '\n');
  return 0;
}

function miniHeading(fields) {
  const title = fields.Title;
  const keys = ['Status', 'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
  const bullets = keys
    .filter((k) => fields[k] != null)
    .map((k) => `- **${k}**: ${fields[k]}`)
    .join('\n');
  return `### ${title}\n${bullets}\n`;
}

function runSelfTest() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'backlog-gate-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: tmp });
    fs.mkdirSync(path.join(tmp, 'docs', 'plans'), { recursive: true });
    const plan = path.join(tmp, 'docs', 'plans', 'ok.md');
    fs.writeFileSync(plan, '# ok\n');
    const base = {
      Title: 'Gate self-test row',
      Status: 'open',
      Trigger: 'when the fixture runs',
      Effort: 'S',
      Source: 'self-test',
      Pointer: 'docs/plans/ok.md',
      Context: 'one line',
    };
    const cfg = mergeConfig(builtinConfig(), { style: 'heading' });
    const cases = [];

    function add(name, style, text, expect, extraCfg) {
      cases.push({ name, style, text, expect: expect.slice().sort(), extraCfg });
    }

    add('style-heading', 'heading', miniHeading(base), []);
    add(
      'style-table',
      'table',
      '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      '| 0001 | Gate self-test row | open | when the fixture runs | S | self-test | docs/plans/ok.md | one line |\n',
      [],
      { style: 'table', id_pattern: '^\\d{4}$' }
    );
    add(
      'style-checklist',
      'checklist',
      '- [ ] [Minor] Gate self-test row\n' +
      '  - Status: open\n' +
      '  - Trigger: when the fixture runs\n' +
      '  - Effort: S\n' +
      '  - Source: self-test\n' +
      '  - Pointer: docs/plans/ok.md\n',
      [],
      { style: 'checklist' }
    );

    const miss = Object.assign({}, base);
    delete miss.Trigger;
    add('missing_field', 'heading', miniHeading(miss), ['missing_field']);

    const longTitle = { ...base, Title: '中'.repeat(41) };
    add('cap_exceeded', 'heading', miniHeading(longTitle), ['cap_exceeded']);

    add('bad_status', 'heading', miniHeading({ ...base, Status: 'pending' }), ['bad_status']);
    add('bad_effort', 'heading', miniHeading({ ...base, Effort: 'XL' }), ['bad_effort']);

    const noPtr = { ...base };
    delete noPtr.Pointer;
    add('pointer_missing', 'heading', miniHeading(noPtr), ['pointer_missing']);

    add(
      'pointer_unresolved',
      'heading',
      miniHeading({ ...base, Pointer: 'docs/plans/missing.md' }),
      ['pointer_unresolved']
    );

    const fatNone = {
      ...base,
      Pointer: 'none',
      Trigger: 't'.repeat(240),
      Source: 's'.repeat(160),
      Context: 'c'.repeat(120),
    };
    add('pointer_required', 'heading', miniHeading(fatNone), ['pointer_required']);

    const dup = miniHeading(base) + '\n' + miniHeading(base);
    add('duplicate_title', 'heading', dup, ['duplicate_title']);

    add(
      'duplicate_id',
      'table',
      '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      '| 0001 | Alpha row | open | when a | S | self-test | docs/plans/ok.md | |\n' +
      '| 0001 | Beta row | open | when b | S | self-test | docs/plans/ok.md | |\n',
      ['duplicate_id'],
      { style: 'table', id_pattern: '^\\d{4}$' }
    );

    add(
      'extra_content',
      'heading',
      miniHeading(base) + '\n```\ncode\n```\n',
      ['extra_content']
    );

    add(
      'done_not_moved',
      'heading',
      miniHeading({ ...base, Status: 'dropped 2020-01-01' }),
      ['done_not_moved']
    );
    add(
      'done_not_moved-shipped',
      'heading',
      miniHeading({ ...base, Status: 'shipped v1.0.0 2020-01-01' }),
      ['done_not_moved']
    );
    add('bad_status-shipped-undated', 'heading', miniHeading({ ...base, Status: 'shipped v1.0.0' }), ['bad_status']);
    add(
      'unparseable_entry-heading-in-table',
      'table',
      '| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- |\n' +
      '| 0001 | Gate self-test row | open | when the fixture runs | S | self-test | docs/plans/ok.md | one line |\n' +
      '\n### Sneaked heading entry\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/ok.md\n',
      ['unparseable_entry'],
      { style: 'table', id_pattern: '^\\d{4}$' }
    );
    add(
      'unparseable_entry-heading-in-checklist',
      'checklist',
      '- [ ] [Minor] Gate self-test row\n  - Status: open\n  - Trigger: when the fixture runs\n  - Effort: S\n  - Source: self-test\n  - Pointer: docs/plans/ok.md\n' +
      '\n### Sneaked heading entry\n- **Status**: open\n- **Trigger**: t\n- **Effort**: S\n- **Source**: s\n- **Pointer**: docs/plans/ok.md\n',
      ['unparseable_entry'],
      { style: 'checklist' }
    );

    add(
      'unparseable_entry',
      'heading',
      '- **Status**: open\n- **Trigger**: x\n',
      ['unparseable_entry']
    );

    add(
      'config_raises_cap',
      'heading',
      miniHeading(base),
      ['config_raises_cap'],
      { caps: { Title: 999 } }
    );

    const failures = [];
    for (const c of cases) {
      const ccfg = mergeConfig(cfg, Object.assign({ style: c.style }, c.extraCfg || {}));
      const ents = collectEntries(c.text, ccfg.style);
      const vios = checkCapsRaised(ccfg);
      const titles = new Map();
      const ids = new Map();
      for (const ent of ents) {
        const t = (ent.fields && ent.fields.Title) || ent.title || '';
        const key = t.trim().toLowerCase();
        if (key) {
          if (titles.has(key)) {
            vios.push({ code: 'duplicate_title', title: t, field: 'Title', detail: '' });
          } else titles.set(key, true);
        }
        if (ent.id) {
          if (ids.has(ent.id)) {
            vios.push({ code: 'duplicate_id', title: t, field: 'Id', detail: ent.id });
          } else ids.set(ent.id, true);
        }
        vios.push(...checkEntry(ent, ccfg, tmp, Date.now()));
      }
      const got = [...new Set(vios.map((v) => v.code))].sort();
      const exp = c.expect.slice().sort();
      if (JSON.stringify(got) !== JSON.stringify(exp)) {
        failures.push({ name: c.name, expected: exp, got, vios });
      }
    }
    const unseen = CODES.filter((code) => !cases.some((c) => c.name === code || c.expect.includes(code)));
    // every listed code must appear in some case
    for (const code of CODES) {
      const hit = cases.some((c) => c.expect.includes(code) && !failures.some((f) => f.name === c.name));
      if (!cases.some((c) => c.expect.includes(code))) {
        failures.push({ name: 'missing-case-' + code, expected: [code], got: [] });
      }
    }
    if (failures.length || unseen.length) {
      process.stderr.write(JSON.stringify({ ok: false, failures, unseen }) + '\n');
      return 2;
    }
    process.stdout.write(JSON.stringify({ ok: true, cases: cases.length }) + '\n');
    return 0;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    process.exit(runSelfTest());
  }
  if (!args.backlog) usage(2);
  const { report, allow, allowPath, style, annotated } = runCheck(args);
  if (args.updateAllowlist) {
    const u = updateAllowlist(allow, allowPath || args.allowlist, style, annotated);
    if (u !== 0) process.exit(u);
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(report.exit);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectEntries,
  parseHeadingBlock,
  splitHeadingEntries,
  fieldLine,
  byteLen,
  KNOWN_FIELDS,
  REQUIRED,
  DEFAULT_CAPS,
  checkEntry,
  effectiveCap,
  mergeConfig,
  builtinConfig,
  parseConfigFile,
  gitToplevel,
};
