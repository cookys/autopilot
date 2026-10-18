#!/usr/bin/env node
'use strict';

/**
 * check-backlog-entries.js — portable backlog-entry gate.
 *
 * Caps are UTF-8 bytes. The schema lives only in references/backlog-entry.md.
 * This script never rewrites a backlog. Allowlist ratchet: --update-allowlist
 * may only remove (fingerprint, code) pairs that no longer violate.
 *
 * BACKLOG is a queue: a `shipped`/`dropped` row is done_not_moved immediately
 * (done_retention_days default 0 — history is in git, not the row). A consumer
 * config may raise done_retention_days for a deliberate grace window.
 *
 * Reporter fields (2026-10-13): Id, Since, Origin, Reporter, Report, Reply, Problem, Impact.
 * They are read only once the file opts in (a next-id mark, or the field in `required_fields`;
 * see fieldOptedIn) — before that every style parses an entry exactly as the legacy gate did.
 * Once read, each is format-checked when present; `required_fields` makes Id/Since/Origin/
 * Problem/Impact mandatory.
 * Origin=peer makes Reporter/Report/Reply mandatory. A `<!-- next-id: BL-NNNN -->` comment is
 * the Id high-water mark: every BL- Id must be below it and unique.
 *
 * sidecar_orphan (block, working-tree mode only): a `.md` under `docs/backlog/` (beside the
 * backlog, resolved from the repo root) whose basename no part of the backlog text mentions.
 * A note lives only while a row points at it; delete it with its row
 * (`check-plan-graduation.js --fix` does both). Absent dir = no check; not run by --range.
 *
 * Usage:
 *   node scripts/check-backlog-entries.js --backlog <file>
 *     [--config <file>] [--allowlist <file>] [--mode warn|block]
 *     [--json] [--self-test] [--update-allowlist]
 *   node scripts/check-backlog-entries.js --backlog <file> --range <base>..<head> | <head>
 *     pre-push mode: the file gate on <head>'s committed backlog, plus peer_report_lost over
 *     every commit in the range (base included) that touched the backlog.
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
// Reporter fields. They never count toward the pointer threshold (R1), and a row carrying any of
// them gets the larger row cap (R2). `required_fields` may name only REQUIRABLE ones; the peer
// trio is required by `Origin: peer` itself.
const NEW_FIELDS = ['Id', 'Since', 'Origin', 'Reporter', 'Report', 'Reply', 'Problem', 'Impact'];
const REQUIRABLE = ['Id', 'Since', 'Origin', 'Problem', 'Impact'];
const PEER_FIELDS = ['Reporter', 'Report', 'Reply'];
const ALL_FIELDS = KNOWN_FIELDS.concat(NEW_FIELDS);
const ORIGINS = ['peer', 'owner', 'self'];
const BL_ID_RE = /^BL-(\d{4,})$/;
const NEXT_ID_RE = /<!--\s*next-id\s*:\s*(\S+?)\s*-->/;
// Several reporters share one row: Reporter/Report/Reply list them in the same order, `；`-separated.
const MULTI_SEP = '；';
const WARN_CODES = new Set(['problem_has_identifier']);
// Effort = a size from references/stage-graph.json (the single canonical definition) plus an
// optional urgency suffix `!` / `急` written AFTER the size. Sizes are read, never hard-coded.
const STAGE_GRAPH_FILE = path.join(__dirname, '..', 'references', 'stage-graph.json');
const URGENT_SUFFIXES = ['!', '急'];
const LEGACY_EFFORT_MAP = { Fix: 'S', H: 'S!' };
const MIGRATE_CMD = 'node scripts/migrate-backlog-entries.js --backlog <file> --rename-effort --apply';

function loadSizes(file) {
  const graph = JSON.parse(fs.readFileSync(file || STAGE_GRAPH_FILE, 'utf8'));
  return Object.keys(graph.sizes);
}

// -> {size, urgent} for a valid effort value, else null.
function parseEffortValue(raw, sizes) {
  const v = String(raw).trim();
  const list = sizes || loadSizes();
  for (const size of list) {
    if (v === size) return { size, urgent: false };
    for (const suf of URGENT_SUFFIXES) if (v === size + suf) return { size, urgent: true };
  }
  return null;
}

function badEffortDetail(raw) {
  const v = String(raw).trim();
  if (Object.prototype.hasOwnProperty.call(LEGACY_EFFORT_MAP, v)) {
    return `${v} (retired size: ${Object.entries(LEGACY_EFFORT_MAP).map(([k, t]) => `${k}→${t}`).join(', ')}; migrate with: ${MIGRATE_CMD})`;
  }
  return `${v} (valid: ${loadSizes().join('|')} with optional ! or 急 suffix)`;
}
const DEFAULT_CAPS = {
  Title: 120,
  Status: 64,
  Trigger: 240,
  Source: 160,
  Pointer: 200,
  Context: 240,
  Problem: 300,
  Impact: 160,
  // `entry` caps a legacy row (no reporter field); `row` caps a row carrying any reporter field.
  entry: 900,
  row: 1600,
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
  'bad_id', 'bad_since', 'bad_origin', 'bad_reply', 'peer_field_missing',
  'peer_closed_unanswered', 'problem_has_identifier',
];

function byteLen(s) {
  return Buffer.byteLength(String(s == null ? '' : s), 'utf8');
}

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/check-backlog-entries.js --backlog <file> ' +
    '[--config <file>] [--allowlist <file>] [--mode warn|block] ' +
    '[--json] [--self-test] [--update-allowlist] [--range <base>..<head>]\n'
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
    range: null,
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
    else if (a === '--range') out.range = need();
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
  // `required_fields: Id, Since` or a `## Required Fields` bullet list.
  const reqKv = kv(text, 'required_fields');
  const reqList = reqKv && reqKv !== 'none'
    ? reqKv.split(/[,\s]+/)
    : parseListSection(text, /required\s*fields/i).filter((x) => !/:/.test(x));
  if (reqKv || reqList.length) {
    cfg.required_fields = reqList
      .map((x) => REQUIRABLE.find((f) => f.toLowerCase() === String(x).trim().toLowerCase()))
      .filter(Boolean);
  }
  const capLines = text.split(/\r?\n/);
  for (const line of capLines) {
    const m = line.match(/^\s*-\s+caps\.(\w+)\s*:\s*(\d+)\s*$/i)
      || line.match(/^\s*-\s+(Title|Status|Trigger|Source|Pointer|Context|Problem|Impact|entry|row)\s*:\s*(\d+)\s*$/i);
    if (m) {
      const canonical = ALL_FIELDS.find((f) => f.toLowerCase() === m[1].toLowerCase())
        || (['entry', 'row'].includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null);
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
    // BACKLOG is a queue (plan-graduation DESIGN sentence 1): a shipped/dropped row is
    // done_not_moved on sight. done_retention_days remains an override knob for a
    // consumer that genuinely wants a grace window.
    done_retention_days: 0,
    required_fields: [],
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
    required_fields: (over.required_fields || base.required_fields || []).slice(),
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
  if (!ALL_FIELDS.includes(name)) return { extra: true, raw: line };
  return { name, value: m[2].trim() };
}

// fieldLine, with the opt-in rule applied: a Since/Origin/Reporter/Report/Reply/Problem/Impact
// line in a file that has not opted in (fieldOptedIn) is what the old gate made of it — an
// unknown field line, i.e. extra content. Id keeps its own rule (blIdEnforced).
function gatedFieldLine(line, cfg) {
  const fl = fieldLine(line);
  if (fl && !fl.extra && fl.name !== 'Id' && NEW_FIELDS.includes(fl.name) && !fieldOptedIn(cfg, fl.name)) {
    return { extra: true, raw: line };
  }
  return fl;
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

function parseHeadingBlock(block, cfg) {
  const text = block.lines.join('\n');
  const fields = {};
  let extra = false;
  let inFence = false;
  let newFieldBytes = 0;
  let idBytes = 0;
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
    const fl = gatedFieldLine(line, cfg); // heading
    if (fl && fl.extra) {
      extra = true;
      continue;
    }
    if (fl) {
      if (fields[fl.name] != null) extra = true;
      fields[fl.name] = fl.value;
      if (fl.name === 'Id') idBytes += byteLen(line) + 1;
      else if (NEW_FIELDS.includes(fl.name)) newFieldBytes += byteLen(line) + 1;
      continue;
    }
    extra = true;
  }
  if (fields.Title == null) fields.Title = block.title;
  else if (fields.Title.trim() !== block.title.trim()) extra = true;
  return { fields, extra, text, id: fields.Id || null, title: fields.Title, newFieldBytes, idBytes };
}

// Split a table row on unescaped pipes; `\|` inside a cell is a literal pipe.
function splitTableCells(line) {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.slice(1, -1).map((c) => c.trim());
}

function parseTable(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  let header = null;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = splitTableCells(line);
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!header) {
      header = cells.map((c) => c.replace(/\*/g, ''));
      continue;
    }
    // A file with several tables (one per `##` section) repeats the header; a row whose
    // cells equal the header is that repeat, not an entry (revival.3d shape, 2026-09-16).
    if (cells.length === header.length && cells.every((c, n) => c.replace(/\*/g, '') === header[n])) continue;
    rows.push({ cells, raw: line });
  }
  return { header, rows };
}

function parseChecklist(text, cfg) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let cur = null;
  for (const line of lines) {
    const head = line.match(/^(\s*)-\s+\[[ xX]\]\s+(?:\[([^\]]*)\]\s+)?(.+)$/);
    if (head && head[1].length === 0) {
      if (cur) items.push(cur);
      cur = { title: head[3].trim(), fields: {}, extra: false, lines: [line], newFieldBytes: 0 };
      continue;
    }
    if (!cur) continue;
    cur.lines.push(line);
    if (/^\s*```/.test(line)) {
      cur.extra = true;
      continue;
    }
    if (!line.trim()) continue;
    const fl = gatedFieldLine(line, cfg); // checklist
    if (fl && fl.extra) {
      cur.extra = true;
      continue;
    }
    if (fl) {
      cur.fields[fl.name] = fl.value;
      if (fl.name === 'Id') cur.idBytes = (cur.idBytes || 0) + byteLen(line) + 1;
      else if (NEW_FIELDS.includes(fl.name)) cur.newFieldBytes += byteLen(line) + 1;
      continue;
    }
    if (/^\s+-\s+/.test(line)) cur.extra = true;
  }
  if (cur) items.push(cur);
  return items;
}

function pointerOk(value, cfg, repoRoot, existsFn) {
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
  if (!(existsFn || fs.existsSync)(abs)) return { unresolved: true };
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

// `cfg` (optional) carries the opt-in (fieldOptedIn): without it, and without a next-id mark in
// the text, no style reads a reporter field other than Id — exactly what the old gate read.
function collectEntries(text, style, cfg) {
  const out = [];
  const ocfg = withNextIdMark(cfg, text);
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
      let newFieldBytes = 0;
      for (const f of ALL_FIELDS) {
        // A table's Id column predates the reporter fields and stays governed by id_pattern.
        if (f === 'Id' || idx[f] == null) continue;
        // Normalised here, once, so every consumer (checkEntry, rowPairs/peerReportLost, migrate,
        // plan-graduation) sees the row the old gate saw until the file opts in.
        if (NEW_FIELDS.includes(f) && !fieldOptedIn(ocfg, f)) continue;
        fields[f] = get(f);
        if (NEW_FIELDS.includes(f)) newFieldBytes += byteLen(fields[f]) + 3;
      }
      out.push({
        fields,
        extra: false,
        text: row.raw,
        id: get('Id') || null,
        title: fields.Title || '',
        newFieldBytes,
        tableId: true,
      });
    }
    return out;
  }
  if (style === 'checklist') {
    const items = parseChecklist(text, ocfg);
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
        newFieldBytes: it.newFieldBytes,
        idBytes: it.idBytes || 0,
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
    const p = parseHeadingBlock(b, ocfg);
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

function isValidDate(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function splitMulti(v) {
  if (v == null || String(v).trim() === '') return [];
  return String(v).split(MULTI_SEP).map((x) => x.trim());
}

// none | unknown | <YYYY-MM-DD> <msg id or pointer>
function replyOk(part) {
  if (part === 'none' || part === 'unknown') return true;
  const m = String(part).match(/^(\d{4}-\d{2}-\d{2})\s+\S/);
  return Boolean(m && isValidDate(m[1]));
}

function replyUnanswered(part) {
  const v = String(part == null ? '' : part).trim();
  return v === '' || v === 'none' || v === 'unknown' || !replyOk(v);
}

// (Report, Reply) pairs of one row, positionally; a missing Reply reads as unanswered.
function reportPairs(fields) {
  const reports = splitMulti(fields && fields.Report);
  const replies = splitMulti(fields && fields.Reply);
  return reports.filter(Boolean).map((report, i) => ({ report, reply: replies[i] || '' }));
}

// Problem is written for the owner, not the codebase: a backtick, a file path, or a `name:123`
// line reference means an identifier leaked in. Warn-only.
const IDENTIFIER_RES = [
  /`/,
  /(?:^|[^\w/])\.{0,2}\/?(?:[\w.-]+\/){2,}/,
  /[\w-]+\/[\w-]+\.[A-Za-z][A-Za-z0-9]{0,5}\b/,
  /[A-Za-z_][\w.-]*:\d+/,
];

// An Id line predates the reporter fields (the old gate accepted and counted it), so Id alone
// does not make a reporter row: a legacy row with an Id keeps the 900 B cap and its Id bytes
// still count toward the pointer threshold, exactly as before.
function hasNewFields(entry) {
  return (entry.newFieldBytes || 0) > 0;
}

// The pointer threshold measures only the seven legacy fields (R1): reporter-field lines (and,
// on a reporter row, the Id line) are subtracted, so a legacy row measures what it always did.
function legacyBytes(entry) {
  const id = hasNewFields(entry) ? (entry.idBytes || 0) : 0;
  return byteLen(entry.text) - (entry.newFieldBytes || 0) - id;
}

// BL-NNNN is enforced only once a file opts in: `required_fields` names Id, or the file carries a
// `<!-- next-id -->` mark. Otherwise any Id is accepted, as the old gate did.
function blIdEnforced(cfg) {
  return Boolean(cfg && (cfg.next_id_mark || (cfg.required_fields || []).includes('Id')));
}

// The cfg a file is checked with: `next_id_mark` set when the text carries `<!-- next-id -->`.
function withNextIdMark(cfg, text) {
  const base = cfg || {};
  return NEXT_ID_RE.test(String(text || '')) ? Object.assign({}, base, { next_id_mark: true }) : base;
}

// One rule for every style: Since, Origin, Reporter, Report, Reply, Problem and Impact were never
// read by the old gate (a heading/checklist line was extra content, a table column was ignored).
// The parsers read such a field only once the file opts in: a next-id mark, or the field in
// `required_fields` (Reporter/Report/Reply also follow a required Origin, since the peer rule
// reads them together). Otherwise the entry is parsed exactly as the old gate parsed it.
function fieldOptedIn(cfg, f) {
  if (!cfg) return false;
  if (cfg.next_id_mark) return true;
  const req = cfg.required_fields || [];
  return req.includes(f) || (PEER_FIELDS.includes(f) && req.includes('Origin'));
}

function checkReporterFields(entry, fields, title, cfg) {
  const vios = [];
  const push = (code, field, detail) => vios.push({ code, title, field, detail });
  const present = (f) => fields[f] != null && String(fields[f]).trim() !== '';
  for (const f of cfg.required_fields || []) {
    if (f === 'Id' && entry.tableId) {
      if (!entry.id) push('missing_field', 'Id', 'Id missing');
      continue;
    }
    if (!present(f)) push('missing_field', f, `${f} missing`);
  }
  if (!entry.tableId && present('Id') && blIdEnforced(cfg)) {
    const id = String(fields.Id).trim();
    let ok = BL_ID_RE.test(id);
    if (!ok && cfg.id_pattern) {
      try { ok = new RegExp(cfg.id_pattern).test(id); } catch { /* ignore bad pattern */ }
    }
    if (!ok) push('bad_id', 'Id', `${id} (expected BL-NNNN)`);
  }
  if (present('Since') && !isValidDate(String(fields.Since).trim())) {
    push('bad_since', 'Since', `${fields.Since} (expected YYYY-MM-DD)`);
  }
  const origin = present('Origin') ? String(fields.Origin).trim() : null;
  if (origin != null && !ORIGINS.includes(origin)) {
    push('bad_origin', 'Origin', `${origin} (expected ${ORIGINS.join('|')})`);
  }
  if (present('Reply')) {
    for (const part of splitMulti(fields.Reply)) {
      if (!replyOk(part)) push('bad_reply', 'Reply', `${part} (expected none|unknown|<YYYY-MM-DD> <msg id or pointer>)`);
    }
  }
  if (origin === 'peer') {
    const missing = PEER_FIELDS.filter((f) => !present(f));
    for (const f of missing) push('peer_field_missing', f, `Origin peer needs ${f}`);
    if (!missing.length) {
      const n = PEER_FIELDS.map((f) => splitMulti(fields[f]).length);
      if (n[0] !== n[1] || n[1] !== n[2]) {
        push('peer_field_missing', 'Reply', `Reporter ${n[0]} / Report ${n[1]} / Reply ${n[2]} — one ${MULTI_SEP}-separated value per reporter`);
      }
    }
    const st = present('Status') ? String(fields.Status).trim() : '';
    if (/^(shipped|dropped)\b/.test(st)) {
      const replies = splitMulti(fields.Reply);
      const reports = splitMulti(fields.Report);
      const count = Math.max(reports.length, replies.length, 1);
      const open = [];
      for (let i = 0; i < count; i++) if (replyUnanswered(replies[i])) open.push(reports[i] || '(no Report)');
      if (open.length) push('peer_closed_unanswered', 'Reply', `${st} with no reply to ${open.join(', ')}`);
    }
  }
  if (present('Problem')) {
    const hit = IDENTIFIER_RES.find((re) => re.test(fields.Problem));
    if (hit) {
      vios.push({ code: 'problem_has_identifier', title, field: 'Problem', detail: 'Problem is for the owner: no backticks, file paths, or name:line refs', level: 'warn' });
    }
  }
  return vios;
}

function checkEntry(entry, cfg, repoRoot, now, existsFn) {
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
  for (const f of ALL_FIELDS) {
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
  const capKey = hasNewFields(entry) ? 'row' : 'entry';
  const entryCap = effectiveCap(cfg, capKey);
  const ebytes = byteLen(entry.text);
  if (ebytes > entryCap) {
    vios.push({
      code: 'cap_exceeded',
      title,
      field: capKey,
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
    if (!parseEffortValue(fields.Effort)) {
      vios.push({
        code: 'bad_effort',
        title,
        field: 'Effort',
        detail: badEffortDetail(fields.Effort),
      });
    }
  }
  const ptr = fields.Pointer;
  if (ptr != null && String(ptr).trim() !== '') {
    const p = pointerOk(ptr, cfg, repoRoot, existsFn);
    if (p.none) {
      const lb = legacyBytes(entry);
      if (lb > POINTER_THRESHOLD) {
        vios.push({
          code: 'pointer_required',
          title,
          field: 'Pointer',
          detail: `entry ${lb} B > ${POINTER_THRESHOLD} with none`,
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
    // done_retention_days default is 0: `>=` so a same-day shipped/dropped row is
    // already done_not_moved, not just one that has aged past the threshold. `|| 30`
    // would be wrong here — 0 is a valid, falsy retention value.
    const retention = cfg.done_retention_days != null ? cfg.done_retention_days : 0;
    if (d && daysAgo(d, now) >= retention) {
      vios.push({
        code: 'done_not_moved',
        title,
        field: 'Status',
        detail: `${st} older than ${retention} days`,
      });
    }
  }
  vios.push(...checkReporterFields(entry, fields, title, cfg));
  return vios;
}

// Duplicate title/Id are reported in entry order, right before that entry's own violations (the
// order the gate has always printed). The next-id high-water mark (R6) is checked after: an Id at
// or above the mark, or a BL- Id with no mark at all, means two writers can hand out one number.
function checkNextId(text, entries, cfg) {
  const vios = [];
  const blIds = [];
  for (const ent of entries) {
    if (!ent.id || ent.tableId) continue;
    const id = String(ent.id).trim();
    const m = id.match(BL_ID_RE);
    if (m) blIds.push({ id, n: Number(m[1]), title: (ent.fields && ent.fields.Title) || ent.title || '' });
  }
  const mark = String(text || '').match(NEXT_ID_RE);
  if (mark) {
    const mm = mark[1].match(BL_ID_RE);
    if (!mm) {
      vios.push({ code: 'bad_id', title: '', field: 'Id', detail: `next-id ${mark[1]} (expected BL-NNNN)` });
    } else {
      for (const b of blIds) {
        if (b.n >= Number(mm[1])) {
          vios.push({ code: 'bad_id', title: b.title, field: 'Id', detail: `${b.id} is not below next-id ${mark[1]}; raise the next-id comment` });
        }
      }
    }
  } else if (blIds.length && blIdEnforced(cfg)) {
    vios.push({ code: 'bad_id', title: '', field: 'Id', detail: 'BL- Ids with no <!-- next-id: BL-NNNN --> high-water mark' });
  }
  return vios;
}

function collectViolations(text, cfg, repoRoot, now, existsFn) {
  const style = cfg.style || 'heading';
  const entries = collectEntries(text, style, cfg);
  const ecfg = withNextIdMark(cfg, text);
  const violations = checkCapsRaised(cfg);
  const titles = new Map();
  const ids = new Map();
  for (const ent of entries) {
    const t = (ent.fields && ent.fields.Title) || ent.title || '';
    const key = t.trim().toLowerCase();
    if (key) {
      if (titles.has(key)) {
        violations.push({ code: 'duplicate_title', title: t, field: 'Title', detail: 'duplicate title' });
      } else titles.set(key, true);
    }
    // Duplicate Ids: table and checklist Ids were always checked (the old gate read them); a
    // heading Id only once the file opts in (blIdEnforced), since the old gate never read it and a
    // project's own numbering must not start blocking.
    if (ent.id && (ent.tableId || style === 'checklist' || blIdEnforced(ecfg))) {
      const id = String(ent.id).trim();
      if (ids.has(id)) {
        violations.push({ code: 'duplicate_id', title: t, field: 'Id', detail: id });
      } else ids.set(id, true);
    }
    violations.push(...checkEntry(ent, ecfg, repoRoot, now, existsFn));
  }
  violations.push(...checkNextId(text, entries, ecfg));
  return { entries, violations };
}

function checkSidecarOrphans(text, repoRoot) {
  const dir = path.join(repoRoot, 'docs', 'backlog');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
  } catch {
    return [];
  }
  return names.sort().filter((n) => !text.includes(n)).map((n) => ({
    code: 'sidecar_orphan',
    title: n,
    field: 'Pointer',
    detail: `docs/backlog/${n} is mentioned by no backlog row; delete it with its row`,
  }));
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

function loadGateConfig(opts, repoRoot) {
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
  return cfg;
}

function violationLevel(v) {
  return v.level || (WARN_CODES.has(v.code) ? 'warn' : 'block');
}

// at: optional { text, repoRoot, existsFn } — check a backlog read from somewhere other than the
// working tree (the pre-push range mode reads the pushed commit's blob).
function runCheck(opts, at) {
  const backlogPath = path.resolve(opts.backlog);
  let text;
  let repoRoot;
  if (at) {
    text = at.text;
    repoRoot = at.repoRoot;
  } else {
    try {
      text = fs.readFileSync(backlogPath, 'utf8');
    } catch (e) {
      process.stderr.write(`unreadable backlog: ${e.message}\n`);
      process.exit(2);
    }
    const backlogDir = path.dirname(backlogPath);
    repoRoot = gitToplevel(backlogDir) || backlogDir;
  }
  const cfg = loadGateConfig(opts, repoRoot);
  const allowPath = opts.allowlist
    || (cfg.allowlist_path
      ? (path.isAbsolute(cfg.allowlist_path) ? cfg.allowlist_path : path.join(repoRoot, cfg.allowlist_path))
      : null);
  const allow = loadAllowlist(allowPath);
  const allowedPairs = allowSet(allow);
  const now = Date.now();
  const style = cfg.style || 'heading';
  const { entries, violations } = collectViolations(text, cfg, repoRoot, now, at && at.existsFn);
  if (!at) violations.push(...checkSidecarOrphans(text, repoRoot));
  const annotated = violations.map((v) => {
    const fp = fingerprint(style, v.title);
    const allowed = allowedPairs.has(`${fp}\0${v.code}`);
    return Object.assign({ allowed }, v, { level: violationLevel(v) });
  });
  const report = buildReport(cfg, backlogPath, style, entries.length, byteLen(text), annotated);
  return { report, allow, allowPath, cfg, style, annotated, entries, repoRoot };
}

function buildReport(cfg, backlogPath, style, entryCount, bytes, annotated) {
  // A warn-level code (problem_has_identifier) is reported but never counts toward the exit.
  const newCount = annotated.filter((v) => !v.allowed && v.level !== 'warn').length;
  const allowedCount = annotated.filter((v) => v.allowed).length;
  const warnCount = annotated.filter((v) => !v.allowed && v.level === 'warn').length;
  let exit = 0;
  if (cfg.mode === 'block' && newCount > 0) exit = 1;
  return {
    mode: cfg.mode,
    backlog: backlogPath,
    style,
    entries: entryCount,
    bytes,
    violations: annotated.map((v) => ({
      code: v.code,
      title: v.title,
      field: v.field,
      detail: v.detail,
      allowed: v.allowed,
      level: v.level,
    })),
    new_count: newCount,
    allowed_count: allowedCount,
    warn_count: warnCount,
    exit,
  };
}

// --- pre-push range mode (R3-R6) ---

function git(repoRoot, args) {
  return spawnSync('git', ['-C', repoRoot].concat(args), {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

function showAt(repoRoot, sha, rel) {
  const r = git(repoRoot, ['show', `${sha}:${rel}`]);
  return r.status === 0 ? r.stdout : null;
}

function existsAtFn(repoRoot, sha) {
  return (abs) => {
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (!rel || rel.startsWith('..')) return false;
    return git(repoRoot, ['cat-file', '-e', `${sha}:${rel}`]).status === 0;
  };
}

function verifyCommit(repoRoot, rev) {
  const r = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return r.status === 0 ? r.stdout.trim() : null;
}

function parseRange(spec) {
  const i = String(spec).indexOf('..');
  if (i < 0) return { base: null, head: spec };
  return { base: spec.slice(0, i) || null, head: spec.slice(i + 2) || 'HEAD' };
}

function resolvePlansDir(repoRoot) {
  const helper = path.join(SCRIPT_DIR, 'resolve-project-paths.sh');
  const r = spawnSync('bash', [helper, '--target', repoRoot, '--field', 'plans_dir'], { encoding: 'utf8' });
  const v = r.status === 0 ? String(r.stdout || '').trim() : '';
  return (!v || v === 'none') ? 'docs/plans' : v.replace(/\/+$/, '');
}

function idMentionRe(id) {
  return new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![0-9])');
}

function rowPairs(entries) {
  const out = [];
  for (const e of entries) {
    if (!e.fields || !e.id) continue;
    const id = String(e.id).trim();
    for (const p of reportPairs(e.fields)) {
      out.push({ key: `${id}\0${p.report}`, id, report: p.report, reply: p.reply, title: e.fields.Title || e.title || '' });
    }
  }
  return out;
}

// peer_report_lost: every (Id, Report) pair seen in the range — base included, each commit that
// touched the backlog in topological order, the LAST appearance's Reply wins (R4) — that is gone
// at head (row deleted, or one reporter dropped from a surviving row: R5) while its last Reply was
// none/unknown, and whose Id is not named by head's plans, CHANGELOG, or another BACKLOG row (R3).
function peerReportLost(repoRoot, rel, baseSha, headSha, headEntries, style, cfg) {
  const listArgs = ['rev-list', '--reverse', '--topo-order', '--full-history',
    baseSha ? `${baseSha}..${headSha}` : headSha, '--', rel];
  const r = git(repoRoot, listArgs);
  if (r.status !== 0) return { error: `git rev-list failed: ${String(r.stderr || '').trim()}` };
  const shas = (baseSha ? [baseSha] : []).concat(String(r.stdout).split('\n').filter(Boolean));
  const last = new Map();
  // BL-0131: judge every historic version by head's opt-in. A pre-opt-in version carries no
  // next-id mark, so read legacy-style it yields no pairs, and a row deleted in the opt-in commit
  // itself would never be seen. A file that is not opted in at head keeps the legacy reading.
  const headText = showAt(repoRoot, headSha, rel);
  const headCfg = withNextIdMark(cfg, headText);
  const histCfg = fieldOptedIn(headCfg, 'Reporter') ? Object.assign({}, cfg || {}, { next_id_mark: true }) : cfg;
  for (const sha of shas) {
    const text = showAt(repoRoot, sha, rel);
    if (text == null) continue;
    for (const p of rowPairs(collectEntries(text, style, histCfg))) last.set(p.key, Object.assign({ sha }, p));
  }
  const headKeys = new Set(rowPairs(headEntries).map((p) => p.key));
  const plansDir = resolvePlansDir(repoRoot);
  const exitCache = new Map();
  const hasExit = (id) => {
    if (exitCache.has(id)) return exitCache.get(id);
    const re = idMentionRe(id);
    let found = headEntries.some((e) => String(e.id || '').trim() !== id && re.test(e.text || ''));
    if (!found) {
      const pattern = re.source.replace('(?![0-9])', '([^0-9]|$)');
      const g = git(repoRoot, ['grep', '-q', '-E', pattern, headSha, '--', plansDir, 'CHANGELOG.md']);
      found = g.status === 0;
    }
    exitCache.set(id, found);
    return found;
  };
  const lost = [];
  for (const p of last.values()) {
    if (headKeys.has(p.key)) continue;
    if (!replyUnanswered(p.reply)) continue;
    if (hasExit(p.id)) continue;
    lost.push({
      code: 'peer_report_lost',
      title: p.title,
      field: 'Report',
      detail: `${p.id} ${p.report}: last Reply "${p.reply || '(missing)'}" at ${p.sha.slice(0, 12)}; reply first, or name ${p.id} in ${plansDir}/ or CHANGELOG.md`,
      level: 'block',
    });
  }
  return { lost, commits: shas.length };
}

function runRange(opts) {
  const backlogAbs = path.resolve(opts.backlog);
  const repoRoot = gitToplevel(fs.existsSync(path.dirname(backlogAbs)) ? path.dirname(backlogAbs) : process.cwd());
  if (!repoRoot) {
    process.stderr.write('--range needs the backlog inside a git repository\n');
    process.exit(2);
  }
  const rel = path.relative(repoRoot, backlogAbs).split(path.sep).join('/');
  const { base, head } = parseRange(opts.range);
  const headSha = verifyCommit(repoRoot, head);
  const baseSha = base ? verifyCommit(repoRoot, base) : null;
  if (!headSha || (base && !baseSha)) {
    process.stderr.write(`--range: cannot resolve ${opts.range}\n`);
    process.exit(2);
  }
  const headText = showAt(repoRoot, headSha, rel);
  const checked = runCheck(opts, {
    text: headText == null ? '' : headText,
    repoRoot,
    existsFn: existsAtFn(repoRoot, headSha),
  });
  const lostRun = peerReportLost(repoRoot, rel, baseSha, headSha, checked.entries, checked.style, checked.cfg);
  if (lostRun.error) {
    process.stderr.write(`${lostRun.error}\n`);
    process.exit(2);
  }
  const annotated = checked.annotated.concat(lostRun.lost.map((v) => Object.assign({ allowed: false }, v)));
  const report = buildReport(checked.cfg, backlogAbs, checked.style, checked.entries.length,
    byteLen(headText || ''), annotated);
  report.range = { base: baseSha, head: headSha, commits: lostRun.commits };
  return report;
}

function updateAllowlist(allow, allowPath, style, annotated) {
  const still = new Set();
  for (const v of annotated) still.add(`${fingerprint(style, v.title)}\0${v.code}`);
  const wouldAdd = [];
  for (const v of annotated) {
    if (v.level === 'warn') continue;
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
  const keys = ['Id', 'Status', 'Since', 'Origin', 'Reporter', 'Report', 'Reply', 'Problem', 'Impact',
    'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
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
    add('bad_effort', 'heading', miniHeading({ ...base, Effort: 'Fix' }), ['bad_effort']);
    add('bad_effort_H', 'heading', miniHeading({ ...base, Effort: 'H' }), ['bad_effort']);
    add('bad_effort_prefix', 'heading', miniHeading({ ...base, Effort: '!S' }), ['bad_effort']);
    for (const ok of ['XS', 'XL', 'S!', 'M急', 'XL!']) {
      add('effort_ok_' + ok, 'heading', miniHeading({ ...base, Effort: ok }), []);
    }

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

    // --- reporter fields ---
    const mark = (n) => `<!-- next-id: BL-${String(n).padStart(4, '0')} -->\n`;
    const peer = {
      ...base,
      Id: 'BL-0001',
      Since: '2026-09-05',
      Origin: 'peer',
      Reporter: 'cuda',
      Report: '2026-09-05 fleet',
      Reply: 'none',
      Problem: '回報者在某情況下遇到問題',
      Impact: '不修會一直重複發生',
    };
    add('reporter-row-ok', 'heading', mark(2) + miniHeading(peer), []);
    add('missing_field-required', 'heading', miniHeading(base), ['missing_field'], { required_fields: ['Id'] });
    add('bad_id-format', 'heading', miniHeading({ ...base, Id: 'X-1' }), ['bad_id'], { required_fields: ['Id'] });
    add('bad_id-format-marked', 'heading', mark(2) + miniHeading({ ...base, Id: 'X-1' }), ['bad_id']);
    add('legacy-id-accepted', 'heading', miniHeading({ ...base, Id: '25' }), []);
    add('bad_id-not-below-next-id', 'heading', mark(1) + miniHeading(peer), ['bad_id']);
    add('bad_id-no-next-id', 'heading', miniHeading(peer), ['bad_id'],
      { required_fields: ['Id', 'Since', 'Origin', 'Problem', 'Impact'] });
    // Not opted in: a reporter-field line is what the old gate made of it, extra content.
    add('legacy-reporter-line-heading', 'heading', miniHeading({ ...base, Since: 'last week', Origin: 'external' }),
      ['extra_content']);
    add(
      'legacy-reporter-line-checklist',
      'checklist',
      '- [ ] [Minor] Gate self-test row\n' +
      '  - Status: open\n' +
      '  - Since: last week\n' +
      '  - Origin: external\n' +
      '  - Trigger: when the fixture runs\n' +
      '  - Effort: S\n' +
      '  - Source: self-test\n' +
      '  - Pointer: docs/plans/ok.md\n',
      ['extra_content'],
      { style: 'checklist' }
    );
    add('duplicate_id-heading', 'heading',
      mark(2) + miniHeading(peer) + '\n' + miniHeading({ ...peer, Title: 'Another row' }), ['duplicate_id']);
    add('bad_since', 'heading', mark(2) + miniHeading({ ...peer, Since: '2026-13-40' }), ['bad_since']);
    add('bad_origin', 'heading', mark(2) + miniHeading({ ...peer, Origin: 'external' }), ['bad_origin']);
    add('bad_reply', 'heading', mark(2) + miniHeading({ ...peer, Reply: 'replied' }), ['bad_reply']);
    add('peer_field_missing', 'heading', mark(2) + miniHeading({ ...peer, Reply: undefined }), ['peer_field_missing']);
    add('peer_field_missing-count', 'heading',
      mark(2) + miniHeading({ ...peer, Reporter: 'cuda；openclaw', Report: '2026-09-05 fleet；msg_1' }), ['peer_field_missing']);
    add('peer_closed_unanswered', 'heading', mark(2) + miniHeading({ ...peer, Status: 'dropped 2020-01-01' }),
      ['done_not_moved', 'peer_closed_unanswered']);
    add('peer_closed-answered', 'heading',
      mark(2) + miniHeading({ ...peer, Status: 'dropped 2020-01-01', Reply: '2026-09-06 msg_01X' }), ['done_not_moved']);
    add('problem_has_identifier', 'heading', mark(2) + miniHeading({ ...peer, Problem: '`scripts/x.js` 壞了' }),
      ['problem_has_identifier']);

    const failures = [];
    for (const c of cases) {
      const ccfg = mergeConfig(cfg, Object.assign({ style: c.style }, c.extraCfg || {}));
      const { violations: vios } = collectViolations(c.text, ccfg, tmp, Date.now());
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
  if (args.range) {
    if (args.updateAllowlist) usage(2);
    const rep = runRange(args);
    fs.writeSync(1, JSON.stringify(rep) + '\n');
    process.exit(rep.exit);
  }
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
  loadSizes,
  parseEffortValue,
  LEGACY_EFFORT_MAP,
  collectEntries,
  withNextIdMark,
  fieldOptedIn,
  resolveBacklogConfigPath,
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
  pointerOk,
  splitTableCells,
  runCheck,
  NEW_FIELDS,
  ALL_FIELDS,
  MULTI_SEP,
  BL_ID_RE,
  NEXT_ID_RE,
  splitMulti,
  replyOk,
  replyUnanswered,
  reportPairs,
  isValidDate,
  collectViolations,
};
