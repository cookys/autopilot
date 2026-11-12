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
 * Queue-form fields (Done-Check, Artifact, Needs, after, ms, Used-by, Queued-By, Prompt, Inputs,
 * Feeds) are always read on a heading row and are not part of the reporter-field opt-in. A heading
 * row that carries any of them is queue-form. Table and checklist styles still treat those lines
 * as extra content. `--ready` lists rows isReady accepts; lint exit is unchanged.
 *
 * sidecar_orphan (block, working-tree mode only): a `.md` under `docs/backlog/` (the `backlog/`
 * directory beside the backlog file) whose basename no part of the backlog text mentions.
 * A note lives only while a row points at it; delete it with its row
 * (`check-plan-graduation.js --fix` does both). Absent dir = no check; not run by --range.
 *
 * Usage:
 *   node scripts/check-backlog-entries.js --backlog <file>
 *     [--config <file>] [--allowlist <file>] [--mode warn|block]
 *     [--json] [--self-test] [--update-allowlist] [--ready]
 *   node scripts/check-backlog-entries.js --backlog <file> --range <base>..<head> | <head>
 *     pre-push mode: the file gate on <head>'s committed backlog, plus peer_report_lost over
 *     every commit in the range (base included) that touched the backlog.
 *
 *   node scripts/check-backlog-entries.js --hippo --reconcile [--target <dir>] [--backlog <file>] [--adr-dir <dir>]
 *     every backlog row Id (BL-NNNN) and ADR file number (ADR-NNNN) needs a hippo record with that provenance value, else
 *     backlog_unimported (block). Exit 2 no store, 5 hippo unusable. The only `--hippo` rule so far.
 *
 * Exit: 0 clean or warn · 1 block with new violations · 2 usage / unreadable / self-test fail
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const {
  KNOWN_FIELDS,
  REQUIRED,
  NEW_FIELDS,
  QUEUE_FIELDS,
  REQUIRABLE,
  ALL_FIELDS,
  BL_ID_RE,
  NEXT_ID_RE,
  MULTI_SEP,
  WARN_CODES,
  LEGACY_EFFORT_MAP,
  loadSizes,
  parseEffortValue,
  DEFAULT_CAPS,
  byteLen,
  pointerOk,
  checkCapsRaised,
  effectiveCap,
  isValidDate,
  splitMulti,
  replyOk,
  replyUnanswered,
  reportPairs,
  blIdEnforced,
  withNextIdMark,
  fieldOptedIn,
  checkEntry,
  checkQueueLinks,
  isReady,
  nextIdFromText,
} = require('./lib/backlog-rules.js');
// Pointer roots: this repo's work-record locations from the layout registry (docs/ at bootstrap, project/ from P1; the plans
// evidence dir may sit beside the plans dir); any other repo (a consuming project) gets the docs/ convention, so the
// registry's paths are never applied to it (LAYOUT.pathFor decides per repo root). No root = this repo's own.
const LAYOUT = require('./lib/repo-layout.js');
const defaultRoots = (repoRoot) => [...new Set([
  ...['plans_dir', 'projects_dir', 'backlog_dir'].map((k) => `${LAYOUT.pathFor(repoRoot, k)}/`),
  `${path.posix.dirname(LAYOUT.pathFor(repoRoot, 'plans_evidence_dir'))}/`,
])];
const CODES = [
  'missing_field', 'cap_exceeded', 'bad_status', 'bad_effort',
  'pointer_missing', 'pointer_unresolved', 'pointer_required',
  'duplicate_title', 'duplicate_id', 'extra_content', 'done_not_moved',
  'unparseable_entry', 'config_raises_cap',
  'bad_id', 'bad_since', 'bad_origin', 'bad_reply', 'bad_trigger_type', 'bad_trigger_date', 'peer_field_missing',
  'peer_closed_unanswered', 'problem_has_identifier',
  'effort_too_large', 'done_check_unrunnable', 'bad_artifact', 'bad_needs', 'bad_ms', 'bad_used_by',
  'bad_queued_by', 'text_row_missing_inputs', 'after_cycle', 'after_broken', 'feeds_broken',
];

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/check-backlog-entries.js --backlog <file> ' +
    '[--config <file>] [--allowlist <file>] [--mode warn|block] ' +
    '[--json] [--ready] [--self-test] [--update-allowlist] [--range <base>..<head>]\n' +
    '       node scripts/check-backlog-entries.js --hippo --reconcile [--target <dir>] [--backlog <file>] [--adr-dir <dir>]\n'
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
    ready: false,
    range: null,
    hippo: false,
    reconcile: false,
    target: null,
    adrDir: null,
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
    else if (a === '--ready') out.ready = true;
    else if (a === '--range') out.range = need();
    else if (a === '--hippo') out.hippo = true;
    else if (a === '--reconcile') out.reconcile = true;
    else if (a === '--target') out.target = need();
    else if (a === '--adr-dir') out.adrDir = need();
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
  const capNames = ALL_FIELDS.concat(QUEUE_FIELDS, ['entry', 'row', 'queue']);
  const capAlt = capNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const capRe = new RegExp(String.raw`^\s*-\s+(?:caps\.)?(${capAlt})\s*:\s*(\d+)\s*$`, 'i');
  for (const line of capLines) {
    const m = line.match(capRe);
    if (m) {
      const canonical = capNames.find((f) => f.toLowerCase() === m[1].toLowerCase()) || null;
      if (canonical) cfg.caps[canonical] = Number(m[2]);
    }
  }
  return cfg;
}

function builtinConfig(repoRoot) {
  return {
    style: 'heading',
    pointer_roots: defaultRoots(repoRoot),
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
  const m = line.match(/^\s*-\s+\*\*([A-Za-z]+(?:-[A-Za-z]+)*)\*\*\s*[:：]\s*(.*)$/)
    || line.match(/^\s*-\s+([A-Za-z]+(?:-[A-Za-z]+)*)\s*[:：]\s*(.*)$/);
  if (!m) return null;
  const name = m[1];
  if (!ALL_FIELDS.includes(name) && !QUEUE_FIELDS.includes(name)) return { extra: true, raw: line };
  return { name, value: m[2].trim() };
}

// fieldLine, with the opt-in rule applied: a Since/Origin/Reporter/Report/Reply/Problem/Impact
// line in a file that has not opted in (fieldOptedIn) is what the old gate made of it — an
// unknown field line, i.e. extra content. Id keeps its own rule (blIdEnforced).
function gatedFieldLine(line, cfg, style) {
  const fl = fieldLine(line);
  // Queue-form fields are heading-only. Checklist (and any other style) keeps them as extra content.
  if (fl && !fl.extra && QUEUE_FIELDS.includes(fl.name) && style !== 'heading') {
    return { extra: true, raw: line };
  }
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
  let queueFieldBytes = 0;
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
    const fl = gatedFieldLine(line, cfg, 'heading');
    if (fl && fl.extra) {
      extra = true;
      continue;
    }
    if (fl) {
      if (fields[fl.name] != null) extra = true;
      fields[fl.name] = fl.value;
      if (fl.name === 'Id') idBytes += byteLen(line) + 1;
      else if (NEW_FIELDS.includes(fl.name)) newFieldBytes += byteLen(line) + 1;
      else if (QUEUE_FIELDS.includes(fl.name)) queueFieldBytes += byteLen(line) + 1;
      continue;
    }
    extra = true;
  }
  if (fields.Title == null) fields.Title = block.title;
  else if (fields.Title.trim() !== block.title.trim()) extra = true;
  return { fields, extra, text, id: fields.Id || null, title: fields.Title, newFieldBytes, idBytes, queueFieldBytes };
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
    const fl = gatedFieldLine(line, cfg, 'checklist');
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

function headingCommentOnly(text) {
  return String(text || '').split(/\r?\n/).every((line) => {
    const t = line.trim();
    return t === '' || /^<!--.*-->$/.test(t);
  });
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
    // A freshly scaffolded backlog is only the next-id mark and a one-line comment.
    if (!headingCommentOnly(text)) out.push({ unparseable: true, text, title: '' });
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
  const adopted = /(?:^|\n)\s*-\s+(?:\*\*)?Trigger-Type(?:\*\*)?\s*[:：]/u.test(String(text || ''))
    || /\|[^\n]*Trigger-Type/u.test(String(text || ''));
  const ecfg = Object.assign({}, withNextIdMark(cfg, text), { trigger_type_adopted: adopted });
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
  if (style === 'heading') violations.push(...checkQueueLinks(entries, text));
  const byTitle = new Map();
  for (const v of violations) {
    const t = v.title || '';
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(v);
  }
  for (const ent of entries) {
    const t = (ent.fields && ent.fields.Title) || ent.title || '';
    ent.violations = byTitle.get(t) || [];
  }
  return { entries, violations };
}

// True when `text` names `name` as a whole file name: not glued to a longer name on either side
// (`prefix-x.md` does not mention `x.md`). Same logic lives in check-plan-graduation.js.
function mentionsBasename(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9._-])${esc}(?![A-Za-z0-9_-])`).test(text);
}

function checkSidecarOrphans(text, backlogPath) {
  // The note files sit in a backlog/ directory beside the backlog file, or in the directory that holds it when that is
  // itself named backlog (project/backlog/BACKLOG.md); the backlog file is never its own sidecar.
  const here = path.dirname(backlogPath);
  const dir = path.basename(here) === 'backlog' ? here : path.join(here, 'backlog');
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md') && path.join(dir, e.name) !== backlogPath).map((e) => e.name);
  } catch {
    return [];
  }
  return names.sort().filter((n) => !mentionsBasename(text, n)).map((n) => ({
    code: 'sidecar_orphan',
    title: n,
    field: 'Pointer',
    detail: `${path.basename(path.dirname(dir))}/${path.basename(dir)}/${n} is mentioned by no backlog row; delete it with its row`,
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
  let cfg = builtinConfig(repoRoot);
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
  if (!at) violations.push(...checkSidecarOrphans(text, backlogPath));
  // Sidecar findings are file-level; re-attach so isReady sees the full per-title list.
  if (!at) {
    const byTitle = new Map();
    for (const v of violations) {
      const t = v.title || '';
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(v);
    }
    for (const ent of entries) {
      const t = (ent.fields && ent.fields.Title) || ent.title || '';
      ent.violations = byTitle.get(t) || [];
    }
  }
  const annotated = violations.map((v) => {
    const fp = fingerprint(style, v.title);
    const allowed = allowedPairs.has(`${fp}\0${v.code}`);
    return Object.assign({ allowed }, v, { level: violationLevel(v) });
  });
  const report = buildReport(cfg, backlogPath, style, entries.length, byteLen(text), annotated);
  // --ready is additive. Lint exit stays report.exit, including when nothing is READY.
  if (opts.ready) {
    const nextId = nextIdFromText(text);
    const ready = [];
    for (const ent of entries) {
      if (!isReady(ent, { entries, nextId })) continue;
      const f = ent.fields || {};
      ready.push({
        Id: String(f.Id || ent.id || '').trim(),
        Title: String(f.Title || ent.title || ''),
        Artifact: f.Artifact == null ? '' : String(f.Artifact),
        Needs: f.Needs == null ? '' : String(f.Needs),
        ms: f.ms == null ? '' : String(f.ms),
        Feeds: f.Feeds == null ? '' : String(f.Feeds),
      });
    }
    report.ready = ready;
    report.ready_count = ready.length;
  }
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
    'Trigger', 'Trigger-Type', 'Effort', 'Source', 'Pointer', 'Context',
    'Done-Check', 'Artifact', 'Needs', 'after', 'ms', 'Used-by', 'Queued-By', 'Prompt', 'Inputs', 'Feeds'];
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
      'Trigger-Type': 'event',
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
    const noType = { ...base, Title: 'Missing trigger type row' };
    delete noType['Trigger-Type'];
    add('missing_field-trigger-type', 'heading', miniHeading(base) + '\n' + miniHeading(noType), ['missing_field']);
    add('bad_trigger_type', 'heading', miniHeading({ ...base, 'Trigger-Type': 'soon' }), ['bad_trigger_type']);
    add('bad_trigger_date', 'heading', miniHeading({ ...base, 'Trigger-Type': 'date:2026-02-31' }), ['bad_trigger_date']);
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

    // --- queue-form (heading only; always read, not an opt-in) ---
    const qBase = {
      Title: 'Queue code row',
      Id: 'BL-0001',
      Status: 'open',
      Trigger: 'when the fixture runs',
      'Trigger-Type': 'ready',
      Effort: 'S',
      Source: 'self-test',
      Pointer: 'docs/plans/ok.md',
      'Done-Check': '`node scripts/check-backlog-entries.js --self-test`',
      Artifact: 'code',
      Needs: 'none',
      ms: 'd1.queue',
      'Used-by': 'e2e',
      'Queued-By': 'ns/c/m self',
    };
    const host = { ...base, Title: 'Host legacy row', Id: 'BL-0001' };
    add('queue-code-ok', 'heading', mark(2) + miniHeading(qBase), []);
    add('queue-effort-urgent-ok', 'heading', mark(2) + miniHeading({ ...qBase, Effort: 'S!' }), []);
    add('queue-needs-ok', 'heading', mark(2) + miniHeading({
      ...qBase, Title: 'Queue needs row', Needs: 'resource:gpu;card:d-0123abcd;engine:local',
    }), []);
    add('effort_too_large', 'heading', mark(2) + miniHeading({ ...qBase, Effort: 'L' }), ['effort_too_large']);
    add('done_check_unrunnable', 'heading', mark(2) + miniHeading({ ...qBase, 'Done-Check': 'TBD' }), ['done_check_unrunnable']);
    add('bad_artifact', 'heading', mark(2) + miniHeading({ ...qBase, Artifact: 'widget' }), ['bad_artifact']);
    add('bad_needs', 'heading', mark(2) + miniHeading({ ...qBase, Needs: 'later' }), ['bad_needs']);
    add('bad_ms', 'heading', mark(2) + miniHeading({ ...qBase, ms: 'Step' }), ['bad_ms']);
    add('bad_used_by', 'heading', mark(2) + miniHeading({ ...qBase, 'Used-by': 'n/a short' }), ['bad_used_by']);
    add('bad_queued_by', 'heading', mark(2) + miniHeading({ ...qBase, 'Queued-By': 'ns/c/m' }), ['bad_queued_by']);
    add('text_row_missing_inputs', 'heading', mark(3) + miniHeading(host) + '\n' + miniHeading({
      ...qBase, Title: 'Queue text row', Id: 'BL-0002', Artifact: 'text', Prompt: 'docs/plans/ok.md', Feeds: 'BL-0001',
    }), ['text_row_missing_inputs']);
    add('feeds_broken', 'heading', mark(3) + miniHeading(host) + '\n' + miniHeading({
      ...qBase,
      Title: 'Queue text feeds',
      Id: 'BL-0002',
      Artifact: 'text',
      Prompt: 'docs/plans/ok.md',
      Inputs: 'docs/plans/ok.md',
      Feeds: 'BL-0099',
    }), ['feeds_broken']);
    add('after_cycle', 'heading', mark(4) + miniHeading({
      ...qBase, Title: 'Queue cycle a', Id: 'BL-0002', after: 'BL-0003',
    }) + '\n' + miniHeading({
      ...qBase, Title: 'Queue cycle b', Id: 'BL-0003', after: 'BL-0002',
    }), ['after_cycle']);
    add('after_cycle-self', 'heading', mark(2) + miniHeading({ ...qBase, after: 'BL-0001' }), ['after_cycle']);
    add('after_broken', 'heading', mark(2) + miniHeading({ ...qBase, after: 'BL-0099' }), ['after_broken']);
    add('after_broken-dropped', 'heading', mark(3) + miniHeading({
      ...base, Title: 'Dropped pred', Id: 'BL-0001', Status: 'dropped 2020-01-01',
    }) + '\n' + miniHeading({
      ...qBase, Title: 'Depends dropped', Id: 'BL-0002', after: 'BL-0001',
    }), ['after_broken', 'done_not_moved']);
    add('after_broken-no-mark', 'heading', miniHeading({ ...qBase, Id: 'BL-0002', after: 'BL-0001' }), ['after_broken']);
    add('after-open-not-broken', 'heading', mark(3) + miniHeading({
      ...base, Title: 'Open pred', Id: 'BL-0001',
    }) + '\n' + miniHeading({
      ...qBase, Title: 'Depends open', Id: 'BL-0002', after: 'BL-0001',
    }), []);
    const band = {
      ...qBase,
      Title: 'Queue cap band row',
      Trigger: 't'.repeat(200),
      Source: 's'.repeat(140),
      Context: 'c'.repeat(200),
      'Done-Check': '`' + 'node ' + 'x'.repeat(170) + '`',
    };
    const bandText = miniHeading(band);
    add('queue-cap-band', 'heading', mark(2) + bandText, []);
    add('queue-cap-lowered', 'heading', mark(2) + miniHeading(qBase), ['cap_exceeded'], { caps: { queue: 100 } });
    add('config_raises_cap-queue', 'heading', miniHeading(base), ['config_raises_cap'], { caps: { queue: 2500 } });
    add(
      'queue-field-checklist-extra',
      'checklist',
      '- [ ] [Minor] Gate self-test row\n' +
      '  - Status: open\n' +
      '  - Trigger: when the fixture runs\n' +
      '  - Effort: S\n' +
      '  - Source: self-test\n' +
      '  - Pointer: docs/plans/ok.md\n' +
      '  - Done-Check: `node ok`\n',
      ['extra_content'],
      { style: 'checklist' }
    );
    add(
      'queue-comment-only',
      'heading',
      '<!-- next-id: BL-0001 -->\n<!-- queue-form backlog; schema: references/backlog-entry.md -->\n',
      []
    );

    const failures = [];
    const bandBytes = Buffer.byteLength(bandText, 'utf8');
    if (bandBytes <= 900 || bandBytes >= 2400) {
      failures.push({ name: 'queue-cap-band-bytes', expected: ['900<n<2400'], got: [bandBytes] });
    }
    {
      const lowCfg = mergeConfig(cfg, { caps: { queue: 100 } });
      const { violations: lowV } = collectViolations(mark(2) + miniHeading(qBase), lowCfg, tmp, Date.now());
      const caps = lowV.filter((v) => v.code === 'cap_exceeded');
      if (caps.length !== 1 || caps[0].field !== 'queue') {
        failures.push({ name: 'queue-cap-field', expected: ['queue'], got: caps.map((v) => v.field) });
      }
    }
    {
      const cycleText = mark(4) + miniHeading({
        ...qBase, Title: 'Queue cycle a', Id: 'BL-0002', after: 'BL-0003',
      }) + '\n' + miniHeading({
        ...qBase, Title: 'Queue cycle b', Id: 'BL-0003', after: 'BL-0002',
      });
      const { violations: cv } = collectViolations(cycleText, cfg, tmp, Date.now());
      const details = cv.filter((v) => v.code === 'after_cycle').map((v) => v.detail);
      if (!details.length || details.some((d) => d !== 'BL-0002 -> BL-0003 -> BL-0002')) {
        failures.push({ name: 'after_cycle-detail', expected: ['BL-0002 -> BL-0003 -> BL-0002'], got: details });
      }
      const { violations: sv } = collectViolations(mark(2) + miniHeading({ ...qBase, after: 'BL-0001' }), cfg, tmp, Date.now());
      const selfDetails = sv.filter((v) => v.code === 'after_cycle').map((v) => v.detail);
      if (selfDetails.length !== 1 || selfDetails[0] !== 'BL-0001 -> BL-0001') {
        failures.push({ name: 'after_cycle-self-detail', expected: ['BL-0001 -> BL-0001'], got: selfDetails });
      }
    }
    function readyIds(text) {
      const { entries } = collectViolations(text, cfg, tmp, Date.now());
      return entries.filter((e) => isReady(e, { entries, nextId: nextIdFromText(text) })).map((e) => String(e.id).trim());
    }
    const readyChecks = [
      ['ready-queue-code', mark(2) + miniHeading(qBase), ['BL-0001']],
      ['ready-absent-below', mark(3) + miniHeading({ ...qBase, Title: 'Depends absent', Id: 'BL-0002', after: 'BL-0001' }), ['BL-0002']],
      ['ready-open-pred', mark(3) + miniHeading({ ...base, Title: 'Open pred', Id: 'BL-0001' }) + '\n' + miniHeading({
        ...qBase, Title: 'Depends open', Id: 'BL-0002', after: 'BL-0001',
      }), []],
      ['ready-shipped-pred', mark(3) + miniHeading({
        ...base, Title: 'Shipped pred', Id: 'BL-0001', Status: 'shipped v0 2020-01-01',
      }) + '\n' + miniHeading({
        ...qBase, Title: 'Depends shipped', Id: 'BL-0002', after: 'BL-0001',
      }), ['BL-0002']],
      ['ready-needs-not-judged', mark(2) + miniHeading({
        ...qBase, Title: 'Queue needs row', Needs: 'resource:gpu;card:d-0123abcd;engine:local',
      }), ['BL-0001']],
    ];
    for (const [name, text, exp] of readyChecks) {
      const got = readyIds(text);
      if (JSON.stringify(got) !== JSON.stringify(exp)) failures.push({ name, expected: exp, got });
    }
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

// --hippo --reconcile (plan A3.4 step 1, the `--reconcile` sentence only): every backlog row Id and every ADR file number of the
// frozen files needs a record whose provenance value equals it (`BL-NNNN`, `ADR-NNNN`; any status, closed included).
// Exit 2: no store / usage; 5: store present but hippo unusable. Never passes silently.
function runReconcile(args) {
  const hippo = require('./lib/hippo.js');
  const die = (code, msg) => { process.stderr.write(`${msg}\n`); process.exit(code); };
  const det = (() => {
    try { return hippo.detect(args.target || process.cwd()); } catch (e) { return die(e.exit || 2, e.message); }
  })();
  const root = det.repo_root;
  if (det.state === 'files') die(2, `no hippo store in ${root}`);
  if (det.state !== 'hippo') die(5, `hippo unusable in ${root}: ${det.reason}`);
  let backlogPath = args.backlog;
  if (!backlogPath) {
    const r = spawnSync('bash', [path.join(SCRIPT_DIR, 'resolve-project-paths.sh'), '--target', root, '--field', 'backlog'], { encoding: 'utf8' });
    const v = (r.stdout || '').trim();
    if (r.status !== 0 || !v || v === 'none') die(2, `cannot resolve the backlog file for ${root}; pass --backlog <file>`);
    backlogPath = path.resolve(root, v);
  }
  backlogPath = path.resolve(backlogPath);
  let text;
  try { text = fs.readFileSync(backlogPath, 'utf8'); } catch (e) { return die(2, `unreadable backlog: ${e.message}`); }
  const cfg = loadGateConfig(args, root);
  const want = new Set();
  for (const ent of collectEntries(text, cfg.style || 'heading', cfg)) {
    const id = ent.id ? String(ent.id).trim().split(/\s+/)[0] : '';
    if (BL_ID_RE.test(id)) want.add(id);
  }
  const adrDir = path.resolve(root, args.adrDir || 'docs/dev/adr');
  const adrIds = new Set();
  let adrNote = null;
  if (fs.existsSync(adrDir) && fs.statSync(adrDir).isDirectory()) {
    for (const f of fs.readdirSync(adrDir)) {
      const m = /^(\d+)-.*\.md$/.exec(f);
      if (m) adrIds.add(`ADR-${m[1]}`);
    }
  } else {
    adrNote = `no ADR directory at ${path.relative(root, adrDir) || '.'}: ADR ids skipped`;
    process.stderr.write(`info: ${adrNote}\n`);
  }
  for (const a of adrIds) want.add(a);
  const ex = hippo.run(root, ['export']);
  if (!ex.ok) die(5, `hippo export failed: ${ex.error && ex.error.message}`);
  const have = new Set();
  for (const r of ex.data.records) if (r.provenance && r.provenance.value) have.add(r.provenance.value);
  const missing = [...want].filter((id) => !have.has(id)).sort();
  const annotated = [];
  let fix = null;
  if (missing.length) {
    const rel = (p) => path.relative(root, p) || '.';
    const froms = [];
    if (missing.some((i) => i.startsWith('BL-'))) froms.push(`--from autopilot-backlog ${rel(backlogPath)}`);
    if (missing.some((i) => i.startsWith('ADR-'))) froms.push(`--from adr-dir ${rel(adrDir)}`);
    fix = `hippo import ${froms.join(' ')} --only ${missing.join(',')}`;
    annotated.push({ code: 'backlog_unimported', title: '', field: 'Id', level: 'block', allowed: false,
      detail: `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no record; from the repo root run: ${fix}` });
  }
  const report = buildReport(cfg, backlogPath, cfg.style || 'heading', want.size, byteLen(text), annotated);
  report.reconcile = { checked: want.size, missing, fix, adr_note: adrNote };
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(report.exit);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    process.exit(runSelfTest());
  }
  if (args.hippo || args.reconcile) {
    if (!args.hippo || args.range || args.updateAllowlist) usage(2);
    if (!args.reconcile) {
      process.stderr.write('--hippo: not implemented in this change: only --reconcile\n');
      process.exit(2);
    }
    runReconcile(args);
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
  mentionsBasename,
};
