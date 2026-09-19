#!/usr/bin/env node
'use strict';

/**
 * migrate-backlog-entries.js — move over-cap / extra-content heading rows
 * into docs/backlog/<slug>.md sidecars without losing a byte of moved text.
 *
 * Usage:
 *   node scripts/migrate-backlog-entries.js --backlog <file>
 *     [--config <file>] [--out-dir docs/backlog] [--apply]
 *     [--allow-unmapped-to-sidecar] [--json]
 *
 * Default is dry-run: print the manifest JSON and a unified diff, write nothing.
 * --apply writes only after every sidecar re-read contains moved_sha256 text.
 *
 * Table style (v2.36.51, revival.3d via cuda 2026-09-16): a backlog whose entries are
 * markdown table rows (any headers) is rewritten table-by-table into the schema columns
 * `| Id | Title | Status | Trigger | Effort | Source | Pointer | Context |`; every row that
 * violates the gate has its ORIGINAL row line moved verbatim into a sidecar and its Pointer
 * set there. Foreign headers map through a `## Columns` section in the config
 * (`- <header>: <Field>`, e.g. `- 標題: Title`, `- 狀態: Status`); the Status cell's leading
 * `**word**` maps through `## Status map` (`- planned: open`); `Trigger：…` inside the Status
 * cell becomes Trigger. Lines outside tables are preserved byte-for-byte.
 *
 * Exit: 0 dry-run or preserved:true · 1 apply not preserved / write failure · 2 usage
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const gate = require('./check-backlog-entries.js');
const {
  collectEntries,
  byteLen,
  checkEntry,
  mergeConfig,
  builtinConfig,
  parseConfigFile,
  gitToplevel,
  runCheck,
} = gate;

function usage(code) {
  process.stderr.write(
    'Usage: node scripts/migrate-backlog-entries.js --backlog <file> ' +
    '[--config <file>] [--out-dir docs/backlog] [--apply] ' +
    '[--allow-unmapped-to-sidecar] [--json]\n'
  );
  process.exit(code);
}

function parseArgs(argv) {
  const out = {
    backlog: null,
    config: null,
    outDir: null,
    apply: false,
    json: false,
    allowUnmappedToSidecar: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) usage(2);
      return argv[++i];
    };
    if (a === '-h' || a === '--help') usage(2);
    else if (a === '--backlog') out.backlog = need();
    else if (a === '--config') out.config = need();
    else if (a === '--out-dir') out.outDir = need();
    else if (a === '--apply') out.apply = true;
    else if (a === '--allow-unmapped-to-sidecar') out.allowUnmappedToSidecar = true;
    else if (a === '--json') out.json = true;
    else usage(2);
  }
  if (!out.backlog) usage(2);
  return out;
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gitHead(repoRoot) {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function findDate(text, fallback) {
  const m = String(text || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : fallback;
}

function truncBytes(s, max) {
  const str = String(s == null ? '' : s);
  if (byteLen(str) <= max) return str;
  const ell = '…';
  const budget = max - byteLen(ell);
  if (budget < 1) return ell.slice(0, max);
  let cut = Buffer.from(str, 'utf8').subarray(0, budget).toString('utf8');
  while (byteLen(cut) > budget) cut = cut.slice(0, -1);
  const sp = cut.lastIndexOf(' ');
  if (sp > 0) cut = cut.slice(0, sp);
  return cut + ell;
}

function firstSentence(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  const m = t.match(/^[\s\S]*?[.。](?=\s|$)/);
  return m ? m[0].trim() : t;
}

function slugify(title) {
  let s = String(title || '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > 80) s = s.slice(0, 80).replace(/-+$/g, '');
  if (!s) s = 'entry';
  return s;
}

function uniqueSlug(base, used) {
  let s = base;
  let n = 2;
  while (used.has(s)) {
    const suffix = '-' + n;
    const room = 80 - suffix.length;
    s = (base.slice(0, Math.max(1, room)) + suffix).replace(/-+$/g, '');
    n += 1;
  }
  used.add(s);
  return s;
}

function splitFile(text) {
  const m = text.match(/^###\s+/m);
  if (!m) return { header: text, slices: [] };
  const first = m.index;
  const header = text.slice(0, first);
  const rest = text.slice(first);
  const slices = [];
  const re = /^###\s+/gm;
  const idxs = [];
  let mm;
  while ((mm = re.exec(rest))) idxs.push(mm.index);
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i];
    const end = i + 1 < idxs.length ? idxs[i + 1] : rest.length;
    slices.push(rest.slice(start, end));
  }
  return { header, slices };
}

function bodyAfterTitle(slice) {
  const nl = slice.indexOf('\n');
  if (nl < 0) return '';
  return slice.slice(nl + 1);
}

function synthesiseStatus(fields, entryText, when) {
  const existing = fields.Status && String(fields.Status).trim();
  if (existing && /^(open|fired \d{4}-\d{2}-\d{2}|dropped \d{4}-\d{2}-\d{2}|shipped \S+ \d{4}-\d{2}-\d{2})$/.test(existing)) {
    return existing;
  }
  const trigger = String(fields.Trigger || '').trim();
  const blob = entryText;
  if (/^(\*\*)?FIRED\b/.test(trigger)) {
    return 'fired ' + findDate(blob, when);
  }
  const shippedStrike = /~~[\s\S]*?~~\s*—\s*\*\*SHIPPED/.test(blob);
  const shippedTok = blob.match(/SHIPPED\s+v?(\S+)/);
  if (shippedStrike || shippedTok) {
    let ver = 'unknown';
    const vm = blob.match(/SHIPPED\s+(v[0-9][\w.-]*|[0-9][\w.-]*)/);
    if (vm) ver = vm[1].replace(/[),.;]+$/, '');
    return 'shipped ' + ver + ' ' + findDate(blob, when);
  }
  return 'open';
}

function normaliseEffort(fields, entryText) {
  const src = [fields.Effort, entryText].filter(Boolean).join(' ');
  const m = src.match(/\b(Fix|S|M|L|H)\b/);
  return m ? m[1] : 'M';
}

// Migrate on ANY gate violation except a lone over-cap Title: a title is the entry's identity
// and moving text cannot shorten it (it goes to the ratchet allowlist instead). This is also the
// idempotence rule — a migrated row has every other field within schema, so a second run finds
// nothing but the Title cap and leaves it alone (depth-0 probe 2026-09-14: the first version
// re-migrated long-titled rows into new sidecars on every run, and skipped small rows that
// only lacked Status/Pointer).
function needsMigration(entry, cfg, repoRoot, now) {
  if (!entry || entry.unparseable) return false;
  const vios = checkEntry(entry, cfg, repoRoot, now);
  return vios.some((v) => !(v.code === 'cap_exceeded' && v.field === 'Title'));
}

function renderEntry(title, fields) {
  const order = ['Status', 'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
  const lines = [`### ${title}`];
  for (const k of order) {
    if (fields[k] == null || String(fields[k]).trim() === '') continue;
    lines.push(`- **${k}**: ${fields[k]}`);
  }
  return lines.join('\n') + '\n\n';
}

function posixRel(repoRoot, abs) {
  let rel = path.relative(repoRoot, abs);
  if (!rel || rel.startsWith('..')) rel = path.basename(abs);
  return rel.split(path.sep).join('/');
}

function sidecarHeader(title, headSha, date) {
  return `# ${title}\n\nSource: docs/BACKLOG.md@${headSha}, migrated ${date}\n\n`;
}

function unifiedDiff(oldText, newText, filename) {
  if (oldText === newText) return '';
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'backlog-mig-diff-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const base = path.basename(filename);
    fs.writeFileSync(path.join(a, base), oldText);
    fs.writeFileSync(path.join(b, base), newText);
    const r = spawnSync('diff', ['-u', path.join(a, base), path.join(b, base)], {
      encoding: 'utf8',
    });
    let out = String(r.stdout || '');
    out = out.replace(new RegExp(a.replace(/[\\.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'a');
    out = out.replace(new RegExp(b.replace(/[\\.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'b');
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function loadCfg(opts, repoRoot) {
  let cfg = builtinConfig();
  let configPath = opts.config;
  if (configPath) {
    cfg = mergeConfig(cfg, parseConfigFile(configPath));
  }
  return cfg;
}

// ── table style ─────────────────────────────────────────────────────────────

const TABLE_FIELDS = ['Id', 'Title', 'Status', 'Trigger', 'Effort', 'Source', 'Pointer', 'Context'];
const DEFAULT_STATUS_MAP = {
  open: 'open', idea: 'open', planned: 'open', todo: 'open', blocked: 'open', acceptance: 'open',
  'in-progress': 'open', wip: 'open', fired: 'fired', done: 'shipped', shipped: 'shipped',
  closed: 'shipped', dropped: 'dropped', cancelled: 'dropped', canceled: 'dropped', wontfix: 'dropped',
};

// `## Columns` and `## Status map` sections of the backlog config: `- <key>: <value>` lines.
function parseKeyMapSection(configPath, headingRe) {
  const out = {};
  if (!configPath) return out;
  let text;
  try { text = fs.readFileSync(configPath, 'utf8'); } catch { return out; }
  let inb = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { inb = headingRe.test(line); continue; }
    if (!inb) continue;
    const m = line.match(/^\s*-\s+`?([^`:]+?)`?\s*:\s*`?([^`]+?)`?\s*$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function stripBold(s) {
  const t = String(s == null ? '' : s).replace(/\*\*/g, '').trim();
  return /^[—–-]$/.test(t) ? '' : t;  // a lone dash cell means "none"
}

function cellNormDelta(cell) {
  const raw = String(cell == null ? '' : cell);
  const stripped = stripBold(raw);
  return byteLen(raw) - byteLen(stripped);
}

function titlePeriodDelta(strippedTitle) {
  const t = String(strippedTitle || '').replace(/[.。]\s*$/, '');
  return byteLen(strippedTitle || '') - byteLen(t);
}

function statusRemainder(raw) {
  const norm = String(raw || '').replace(/\s+/g, ' ');
  return norm.replace(/^[A-Za-z][\w-]*\s*[（(]?/, '').replace(/Trigger\s*[：:]\s*/i, '').replace(/[）)]\s*$/, '').trim();
}

function escapeCell(s) {
  return String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderTableRow(fields) {
  return '| ' + TABLE_FIELDS.map((f) => escapeCell(fields[f] == null ? '' : fields[f])).join(' | ') + ' |';
}

function tableHeaderLines() {
  return [
    '| ' + TABLE_FIELDS.join(' | ') + ' |',
    '|' + TABLE_FIELDS.map(() => '----').join('|') + '|',
  ];
}

// The Status cell of a foreign table carries the state word, the trigger and often a log:
// `**planned**（Trigger：after 09-17；…）`. Split it into a schema status and a trigger.
function mappedColumnField(header, colMap) {
  if (colMap[header]) return colMap[header];
  if (TABLE_FIELDS.includes(header)) return header;
  return null;
}

function tableStatusAndTrigger(statusCell, rowText, when, statusMap) {
  const raw = stripBold(statusCell);
  const word = (raw.match(/^([A-Za-z][\w-]*)/) || [, ''])[1].toLowerCase();
  const canon = /^(open|fired \d{4}-\d{2}-\d{2}|dropped \d{4}-\d{2}-\d{2}|shipped \S+ \d{4}-\d{2}-\d{2})$/;
  let status;
  if (canon.test(raw)) {
    status = raw;
  } else {
    const kind = statusMap[word] || DEFAULT_STATUS_MAP[word];
    if (!kind) {
      const tmMiss = raw.match(/Trigger\s*[：:]\s*([^；;）)]+)/i);
      return { status: null, trigger: tmMiss ? tmMiss[1].trim() : '', unmapped: true, word: word || '(empty)' };
    }
    // FIRED is read from the Status cell only — a log elsewhere in the row that mentions a
    // past alert must not flip a done row (reviewer, 2026-09-16).
    if (/\bFIRED\b/.test(raw)) status = 'fired ' + findDate(raw, when);
    else if (kind === 'fired') status = 'fired ' + findDate(rowText, when);
    else if (kind === 'shipped') {
      const vm = rowText.match(/\bv(\d+[\w.-]*)/);
      status = 'shipped ' + (vm ? 'v' + vm[1] : 'unknown') + ' ' + findDate(raw, findDate(rowText, when));
    } else if (kind === 'dropped') status = 'dropped ' + findDate(raw, findDate(rowText, when));
    else status = kind === 'open' ? 'open' : kind;
  }
  const tm = raw.match(/Trigger\s*[：:]\s*([^；;）)]+)/i);
  const trigger = tm ? tm[1].trim() : '';
  return { status, trigger, unmapped: false, word };
}

function planTableMigration(text, cfg, repoRoot, opts) {
  const colMap = parseKeyMapSection(opts.config, /columns/i);
  const statusMap = {};
  for (const [k, v] of Object.entries(parseKeyMapSection(opts.config, /status\s*map/i))) {
    statusMap[k.toLowerCase()] = String(v).toLowerCase();
  }
  const now = Date.now();
  const when = today();
  const headSha = gitHead(repoRoot);
  const usedSlugs = new Set();
  const outDirArg = opts.outDir || 'docs/backlog';
  const outDirAbs = path.isAbsolute(outDirArg) ? outDirArg : path.join(repoRoot, outDirArg);
  try {
    for (const name of fs.readdirSync(outDirAbs)) {
      if (name.endsWith('.md')) usedSlugs.add(name.slice(0, -3));
    }
  } catch { /* out-dir absent */ }
  const backlogRel = posixRel(repoRoot, path.resolve(opts.backlog || 'docs/BACKLOG.md'));

  const lines = text.split('\n');
  const outLines = [];
  const planned = [];
  const sidecars = [];
  const errors = [];
  const originalRows = [];
  const dropped = [];
  let normalized_bytes = 0;
  let synthesized_bytes = 0;
  const accountHeaderSwap = (oldHeader, oldSep) => {
    normalized_bytes += byteLen(oldHeader) + byteLen(oldSep || '');
    const neu = tableHeaderLines();
    synthesized_bytes += byteLen(neu[0]) + byteLen(neu[1]);
  };
  const accountInPlaceRow = (rowLine, cells, idx, rowFields, rewritten) => {
    cells.forEach((c) => { normalized_bytes += cellNormDelta(c); });
    const titleStripped = idx.Title != null ? stripBold(cells[idx.Title] || '') : '';
    normalized_bytes += titlePeriodDelta(titleStripped);
    const origOf = (f) => (idx[f] != null ? stripBold(cells[idx[f]] || '') : '');
    if (rowFields.Trigger === 'see pointer' && origOf('Trigger') !== 'see pointer') synthesized_bytes += byteLen('see pointer');
    if (rowFields.Pointer === 'none' && origOf('Pointer') !== 'none') synthesized_bytes += byteLen('none');
    if (rowFields.Source === 'unknown' && origOf('Source') !== 'unknown') synthesized_bytes += byteLen('unknown');
    const oldSt = origOf('Status');
    if (rowFields.Status && rowFields.Status !== oldSt) {
      synthesized_bytes += byteLen(rowFields.Status);
      normalized_bytes += byteLen(oldSt);
    }
    const unescapeExtra = (rowLine.match(/\\\|/g) || []).length;
    const oldWrap = byteLen(rowLine) - cells.reduce((n, c) => n + byteLen(c), 0) - unescapeExtra;
    const fieldStr = TABLE_FIELDS.map((f) => escapeCell(rowFields[f] == null ? '' : rowFields[f])).join('');
    const newWrap = byteLen(rewritten) - byteLen(fieldStr);
    normalized_bytes += oldWrap;
    synthesized_bytes += newWrap;
  };
  let section = '';
  let i = 0;
  const isRow = (l) => /^\s*\|/.test(l);
  const cellsOf = (l) => gate.splitTableCells(l);
  const isSep = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

  let inFence = false;
  const headerIndex = (cells) => {
    const idx = {};
    cells.map((c) => stripBold(c)).forEach((h, n) => {
      const mapped = mappedColumnField(h, colMap);
      if (mapped && TABLE_FIELDS.includes(mapped) && idx[mapped] == null) idx[mapped] = n;
    });
    if (idx.Title == null && idx.Id != null) idx.Title = idx.Id;
    return idx;
  };

  // Plan-time scan: unmapped headers with non-empty cells, unmapped status words.
  {
    let scanFence = false;
    for (let s = 0; s < lines.length; s++) {
      if (/^\s*(```|~~~)/.test(lines[s])) scanFence = !scanFence;
      const hidx = !scanFence && isRow(lines[s]) ? headerIndex(cellsOf(lines[s])) : null;
      if (!hidx || hidx.Title == null) continue;
      const headerCells = cellsOf(lines[s]).map((c) => stripBold(c));
      let r = s + 1;
      if (r < lines.length && isRow(lines[r]) && isSep(cellsOf(lines[r]))) r += 1;
      const tableRows = [];
      while (r < lines.length && isRow(lines[r]) && !/^\s*(```|~~~)/.test(lines[r])) {
        tableRows.push({ line: lines[r], lineNo: r + 1, cells: cellsOf(lines[r]), headers: headerCells });
        r += 1;
      }
      headerCells.forEach((h, n) => {
        const mapped = mappedColumnField(h, colMap);
        if (mapped && TABLE_FIELDS.includes(mapped)) return;
        const cell_count = tableRows.filter((row) => stripBold(row.cells[n] || '')).length;
        if (cell_count > 0) {
          errors.push({
            code: 'unmapped_column',
            header: h,
            cell_count,
            fix: `add '- ${h}: <Field>' under ## Columns`,
          });
        }
      });
      const statusIdx = hidx.Status;
      for (const row of tableRows) {
        originalRows.push(row);
        if (row.cells.length !== headerCells.length) continue;
        if (statusIdx == null) continue;
        const st = tableStatusAndTrigger(row.cells[statusIdx] || '', row.line, when, statusMap);
        if (st.unmapped) {
          errors.push({ code: 'unmapped_status', word: st.word, line: row.lineNo });
        }
      }
      s = r - 1;
    }
  }

  const abortRewrite = errors.some((e) => e.code === 'unmapped_column');

  // A verbatim move: the row cannot be read positionally (cell count differs from the header)
  // or its cells hold text the schema columns cannot carry; the original line goes to a sidecar
  // and the rewritten row points there. Nothing is dropped.
  const sidecarOnly = (rowLine, titleRaw, id, bytesBefore) => {
    const slug = uniqueSlug(slugify(id || titleRaw), usedSlugs);
    const sidecarAbs = path.join(outDirAbs, slug + '.md');
    const pointer = posixRel(repoRoot, sidecarAbs);
    const moved = rowLine + '\n';
    const body = `# ${titleRaw}\n\nSource: ${backlogRel}@${headSha}, migrated ${when}` + (section ? `\nSection: ${section}` : '') + `\nOriginal row (verbatim):\n\n` + moved;
    sidecars.push({ abs: sidecarAbs, contents: body, moved });
    planned.push({ title: titleRaw, slug, bytes_before: bytesBefore, bytes_after: 0, moved_bytes: byteLen(moved), moved_sha256: sha256(moved), sidecar: pointer });
  };
  const moveVerbatim = (rowLine, rowFields, titleRaw, id, bytesBefore) => {
    const slug = uniqueSlug(slugify(id || titleRaw), usedSlugs);
    const sidecarAbs = path.join(outDirAbs, slug + '.md');
    rowFields.Pointer = posixRel(repoRoot, sidecarAbs);
    let rewritten = renderTableRow(rowFields);
    if (byteLen(rewritten) > 900 && rowFields.Context) { rowFields.Context = ''; rewritten = renderTableRow(rowFields); }
    while (byteLen(rewritten) > 900 && byteLen(rowFields.Trigger) > 20) {
      rowFields.Trigger = truncBytes(rowFields.Trigger.replace(/…$/, ''), Math.max(20, byteLen(rowFields.Trigger) - 32));
      rewritten = renderTableRow(rowFields);
    }
    outLines.push(rewritten);
    synthesized_bytes += byteLen(rewritten) + 1;
    const moved = rowLine + '\n';
    const body = `# ${titleRaw}\n\nSource: ${backlogRel}@${headSha}, migrated ${when}` + (section ? `\nSection: ${section}` : '') + `\nOriginal row (verbatim):\n\n` + moved;
    sidecars.push({ abs: sidecarAbs, contents: body, moved });
    planned.push({ title: titleRaw, slug, bytes_before: bytesBefore, bytes_after: byteLen(rewritten), moved_bytes: byteLen(moved), moved_sha256: sha256(moved), sidecar: rowFields.Pointer });
  };

  if (abortRewrite) {
    const newText = text;
    const migrateCount = 0;
    const bytes_before = byteLen(text);
    const bytes_after = byteLen(newText);
    const moved_bytes = 0;
    const manifest = {
      preserved: false,
      errors,
      dropped,
      entries: planned,
      totals: {
        entries: planned.length, migrate: migrateCount,
        moved_bytes, bytes_before, bytes_after, normalized_bytes: 0, synthesized_bytes: 0,
      },
    };
    return { newText, sidecars, planned, manifest, outDirAbs, when, migrateCount, errors, dropped, abortRewrite: true };
  }

  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (/^##\s+/.test(line)) section = line.replace(/^##\s+/, '').trim();
    // Only a header that maps a Title or Id column starts a table; every other `|` line —
    // inside a code fence, ASCII art, a stray row after a blank line — is preserved verbatim.
    const headerIdx = !inFence && isRow(line) ? headerIndex(cellsOf(line)) : null;
    if (!headerIdx || headerIdx.Title == null) { outLines.push(line); i += 1; continue; }
    const headerCells = cellsOf(line).map((c) => stripBold(c));
    i += 1;
    let sepLine = '';
    if (i < lines.length && isRow(lines[i]) && isSep(cellsOf(lines[i]))) {
      sepLine = lines[i];
      i += 1;
    }
    const idx = headerIdx;
    accountHeaderSwap(line, sepLine);
    outLines.push(...tableHeaderLines());
    while (i < lines.length && isRow(lines[i]) && !/^\s*(```|~~~)/.test(lines[i])) {
      const rowLine = lines[i];
      i += 1;
      const cells = cellsOf(rowLine);
      if (cells.length !== headerCells.length) {
        const idGuess = stripBold(cells[idx.Id != null ? idx.Id : 0] || '');
        const titleGuess = stripBold(cells[idx.Title] || '') || idGuess || 'row';
        moveVerbatim(rowLine, {
          Id: idGuess, Title: titleGuess, Status: 'open', Trigger: 'see pointer (cell count differs from header)',
          Effort: 'M', Source: 'unknown', Pointer: '', Context: '',
        }, titleGuess, idGuess, byteLen(rowLine));
        continue;
      }
      const get = (f) => (idx[f] != null ? (cells[idx[f]] || '') : '');
      const id = stripBold(get('Id'));
      const titleRaw = stripBold(get('Title')).replace(/[.。]\s*$/, '') || id;
      const st = tableStatusAndTrigger(get('Status'), rowLine, when, statusMap);
      if (st.unmapped) {
        sidecarOnly(rowLine, titleRaw, id, byteLen(rowLine));
        continue;
      }
      const status = st.status;
      const triggerFromStatus = st.trigger;
      const trigger = stripBold(get('Trigger')) || triggerFromStatus || 'see pointer';
      const effort = normaliseEffort({ Effort: stripBold(get('Effort')) }, '');
      const source = truncBytes(stripBold(get('Source')), 160) || 'unknown';
      const pointerCell = stripBold(get('Pointer'));
      const contextCell = stripBold(get('Context'));
      // A foreign "evidence" cell that is not a resolvable pointer is prose: keep it as Context
      // and let a short row carry `none` (the gate allows that under 600 B); a long row moves.
      // The evidence cell may wrap a path in backticks with a suffix (`docs/x.md` §1): take the
      // first backticked token that resolves as the Pointer and keep the rest as Context.
      let pointerPath = '';
      let pointerRest = pointerCell;
      if (!pointerCell || pointerCell === 'none') {
        pointerPath = ''; pointerRest = '';
      } else if (gate.pointerOk(pointerCell, cfg, repoRoot).ok === true) {
        pointerPath = pointerCell; pointerRest = '';
      } else {
        for (const m of pointerCell.matchAll(/`([^`]+)`/g)) {
          if (gate.pointerOk(m[1], cfg, repoRoot).ok === true) {
            pointerPath = m[1];
            pointerRest = pointerCell.replace(m[0], '').replace(/\s+/g, ' ').trim();
            break;
          }
        }
      }
      const pointerIsPath = pointerPath !== '';
      const contextParts = [contextCell, pointerRest].filter(Boolean);
      const rowFields = {
        Id: id, Title: titleRaw, Status: status, Trigger: truncBytes(trigger, 240), Effort: effort,
        Source: source, Pointer: pointerIsPath ? pointerPath : 'none',
        Context: contextParts.length ? truncBytes(firstSentence(contextParts.join('；')), 240) : '',
      };
      const probe = {
        fields: Object.fromEntries(Object.entries(rowFields).filter(([k, v]) => k !== 'Id' && v !== '')),
        extra: false, text: renderTableRow(rowFields), id: id || null, title: titleRaw, unparseable: false,
      };
      const bytesBefore = byteLen(rowLine);
      // Lossy = some original cell text would not survive the rewrite (a log inside the Status
      // cell, a truncated Context, prose beyond the first sentence). That text goes to a sidecar;
      // a row the schema columns carry in full stays in place with `none`.
      const retained = [rowFields.Status, rowFields.Trigger, rowFields.Context, rowFields.Source, rowFields.Effort, rowFields.Id, rowFields.Pointer, pointerPath].join(' ');
      const originalCells = [['Status', get('Status')], ['Source', get('Source')], ['Context', get('Context')], ['Pointer', get('Pointer')], ['Effort', get('Effort')], ['Id', get('Id')]]
        .map(([f, c]) => [f, stripBold(c)]).filter(([, c]) => c);
      const lossy = originalCells.some(([f, c]) => {
        const norm = c.replace(/\s+/g, ' ');
        if (retained.includes(norm)) return false;
        if (f !== 'Status') return true;
        // only the Status cell may lose its state word and the `Trigger：` wrapper — and only
        // when the state word itself survived as a status of the same kind
        const word = (norm.match(/^([A-Za-z][\w-]*)/) || [, ''])[1].toLowerCase();
        const kind = statusMap[word] || DEFAULT_STATUS_MAP[word];
        if (!kind || !rowFields.Status.startsWith(kind)) return true;
        const stripped = norm.replace(/^[A-Za-z][\w-]*\s*[（(]?/, '').replace(/Trigger\s*[：:]\s*/i, '').replace(/[）)]\s*$/, '').trim();
        return stripped.length > 0 && !retained.includes(stripped);
      });
      if (!lossy && !needsMigration(probe, cfg, repoRoot, now)) {
        const kept = renderTableRow(rowFields);
        accountInPlaceRow(rowLine, cells, idx, rowFields, kept);
        outLines.push(kept);
        planned.push({ title: titleRaw, slug: null, bytes_before: bytesBefore, bytes_after: byteLen(kept), moved_bytes: 0, moved_sha256: sha256(''), sidecar: null });
        continue;
      }
      moveVerbatim(rowLine, rowFields, titleRaw, id, bytesBefore);
    }
  }
  const newText = outLines.join('\n');
  const hay = newText + '\n' + sidecars.map((s) => s.contents).join('\n');
  for (const rec of originalRows) {
    if (hay.includes(rec.line)) continue;
    (rec.headers || []).forEach((h, n) => {
      const mapped = mappedColumnField(h, colMap);
      const raw = stripBold(rec.cells[n] || '').trim();
      if (!raw) return;
      if (mapped === 'Status') {
        const norm = raw.replace(/\s+/g, ' ');
        const word = (norm.match(/^([A-Za-z][\w-]*)/) || [, ''])[1].toLowerCase();
        const kind = statusMap[word] || DEFAULT_STATUS_MAP[word];
        if (kind) {
          const stripped = statusRemainder(norm);
          if (!stripped || hay.includes(stripped) || hay.includes(stripped.replace(/\|/g, '\\|'))) return;
        }
      }
      if (!hay.includes(raw) && !hay.includes(raw.replace(/\|/g, '\\|'))) {
        dropped.push({ header: h, text: raw, line: rec.lineNo });
      }
    });
  }
  const migrateCount = planned.filter((e) => e.sidecar).length;
  const bytes_before = byteLen(text);
  const bytes_after = byteLen(newText);
  const moved_bytes = planned.reduce((n, e) => n + e.moved_bytes, 0);
  const preserved = dropped.length === 0
    && bytes_before === bytes_after + moved_bytes + normalized_bytes - synthesized_bytes;
  const manifest = {
    preserved,
    errors,
    dropped,
    entries: planned,
    totals: {
      entries: planned.length, migrate: migrateCount,
      moved_bytes, bytes_before, bytes_after, normalized_bytes, synthesized_bytes,
    },
  };
  return { newText, sidecars, planned, manifest, outDirAbs, when, migrateCount, errors, dropped, abortRewrite: false };
}

function planMigration(text, cfg, repoRoot, opts) {
  const style = cfg.style || 'heading';
  if (style === 'table') return planTableMigration(text, cfg, repoRoot, opts);
  if (style === 'checklist') {
    process.stderr.write('not supported yet\n');
    process.exit(2);
  }
  const { header, slices } = splitFile(text);
  const entries = collectEntries(text, style);
  const headingEntries = entries.filter((e) => !e.unparseable);
  if (headingEntries.length !== slices.length) {
    // Parser dropped or merged a block — still pair by title walk on slices.
  }
  const now = Date.now();
  const when = today();
  const headSha = gitHead(repoRoot);
  const usedSlugs = new Set();
  const outDirArg = opts.outDir || 'docs/backlog';
  const outDirAbs = path.isAbsolute(outDirArg) ? outDirArg : path.join(repoRoot, outDirArg);
  // A sidecar that already exists on disk (hand-curated, or from an earlier run) is never
  // overwritten: seed the slug set from the directory so a colliding title takes -N instead
  // (GLM review MIG-SLUG-DISK-COLLISION, 2026-09-14).
  try {
    for (const name of fs.readdirSync(outDirAbs)) {
      if (name.endsWith('.md')) usedSlugs.add(name.slice(0, -3));
    }
  } catch { /* out-dir absent: nothing to seed */ }

  const planned = [];
  const outSlices = [];
  const sidecars = [];

  for (let i = 0; i < slices.length; i++) {
    const slice = slices[i];
    const parsed = collectEntries(slice, 'heading').find((e) => !e.unparseable) || {
      fields: {},
      extra: true,
      text: slice,
      title: slice.replace(/^###\s+/, '').split('\n')[0].trim(),
      unparseable: false,
    };
    const fields = Object.assign({}, parsed.fields || {});
    const titleRaw = (fields.Title || parsed.title || '').replace(/[.。]\s*$/, '');
    const migrate = needsMigration(parsed, cfg, repoRoot, now);
    const bytesBefore = byteLen(slice);
    if (!migrate) {
      outSlices.push(slice);
      planned.push({
        title: fields.Title || parsed.title || '',
        slug: null,
        bytes_before: bytesBefore,
        bytes_after: bytesBefore,
        moved_bytes: 0,
        moved_sha256: sha256(''),
        sidecar: null,
      });
      continue;
    }
    const moved = bodyAfterTitle(slice);
    const slug = uniqueSlug(slugify(titleRaw), usedSlugs);
    const sidecarAbs = path.join(outDirAbs, slug + '.md');
    const pointer = posixRel(repoRoot, sidecarAbs);
    const status = synthesiseStatus(fields, slice, when);
    const effort = normaliseEffort(fields, slice);
    const source = truncBytes(fields.Source || '', 160);
    let trigger = truncBytes(fields.Trigger || 'see pointer', 240);
    const ctxFull = fields.Context || '';
    let context = firstSentence(ctxFull);
    if (context) context = truncBytes(context, 240);
    const rowFields = {
      Status: status,
      Trigger: trigger,
      Effort: effort,
      Source: source || 'unknown',
      Pointer: pointer,
    };
    if (context) rowFields.Context = context;
    let rewritten = renderEntry(titleRaw, rowFields);
    if (byteLen(rewritten) > 900 && rowFields.Context) {
      delete rowFields.Context;
      rewritten = renderEntry(titleRaw, rowFields);
    }
    while (byteLen(rewritten) > 900 && byteLen(rowFields.Trigger) > 20) {
      rowFields.Trigger = truncBytes(rowFields.Trigger.replace(/…$/, ''), Math.max(20, byteLen(rowFields.Trigger) - 32));
      rewritten = renderEntry(titleRaw, rowFields);
    }
    outSlices.push(rewritten);
    const body = sidecarHeader(titleRaw, headSha, when) + moved;
    const sidecarBody = body.endsWith('\n') ? body : body + '\n';
    sidecars.push({ abs: sidecarAbs, contents: sidecarBody, moved });
    planned.push({
      title: titleRaw,
      slug,
      bytes_before: bytesBefore,
      bytes_after: byteLen(rewritten),
      moved_bytes: byteLen(moved),
      moved_sha256: sha256(moved),
      sidecar: pointer,
    });
  }

  const newText = header + outSlices.join('');
  const migrateCount = planned.filter((e) => e.moved_bytes > 0 || e.sidecar).length;
  const manifest = {
    preserved: opts.apply ? null : null,
    entries: planned,
    totals: {
      entries: planned.length,
      migrate: migrateCount,
      moved_bytes: planned.reduce((n, e) => n + e.moved_bytes, 0),
      bytes_before: byteLen(text),
      bytes_after: byteLen(newText),
    },
  };
  return { newText, sidecars, planned, manifest, outDirAbs, when, migrateCount };
}

function applyWrites(backlogPath, newText, sidecars, manifest, outDirAbs, when) {
  const writtenTmp = [];
  // Every rename target is tracked as well: a failure after the first rename must remove the
  // sidecars and manifest already in place, or "nothing written on failure" is false
  // (GLM review MIG-RENAME-ROLLBACK). The backlog is renamed LAST, so it is either the old
  // bytes or the complete new state.
  const renamed = [];
  const rollbackTmp = () => {
    for (const t of writtenTmp) {
      try { fs.unlinkSync(t); } catch { /* ignore */ }
    }
    for (const t of renamed) {
      try { fs.unlinkSync(t); } catch { /* ignore */ }
    }
  };
  if (!sidecars.length && newText === fs.readFileSync(backlogPath, 'utf8')) {
    // Nothing to move: no out-dir, no manifest, no byte-identical rewrite (MIG-EMPTY-APPLY-ARTIFACTS).
    return { ok: true, preserved: true, noop: true };
  }
  if (!sidecars.length) {
    // A lossless table re-header (foreign columns → schema columns) moves nothing but still
    // rewrites the backlog; atomic rename, no sidecar, no manifest.
    const blTmp = backlogPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    try {
      fs.writeFileSync(blTmp, newText);
      fs.renameSync(blTmp, backlogPath);
      return { ok: true, preserved: true };
    } catch (e) {
      try { fs.unlinkSync(blTmp); } catch { /* ignore */ }
      process.stderr.write(String(e.message || e) + '\n');
      return { ok: false, preserved: false };
    }
  }
  try {
    fs.mkdirSync(outDirAbs, { recursive: true });
    for (const s of sidecars) {
      fs.mkdirSync(path.dirname(s.abs), { recursive: true });
      const tmp = s.abs + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
      fs.writeFileSync(tmp, s.contents);
      writtenTmp.push(tmp);
      s.tmp = tmp;
    }
    const manAbs = path.join(outDirAbs, 'MIGRATION-' + when + '.json');
    const manTmp = manAbs + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    const blTmp = backlogPath + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');

    let preserved = true;
    for (const s of sidecars) {
      const disk = fs.readFileSync(s.tmp, 'utf8');
      if (!disk.includes(s.moved)) {
        preserved = false;
        break;
      }
    }
    if (!preserved) {
      rollbackTmp();
      return { ok: false, preserved: false };
    }

    fs.writeFileSync(manTmp, JSON.stringify(Object.assign({}, manifest, { preserved: true }), null, 2) + '\n');
    writtenTmp.push(manTmp);
    fs.writeFileSync(blTmp, newText);
    writtenTmp.push(blTmp);

    for (const s of sidecars) {
      if (fs.existsSync(s.abs)) throw new Error(`refusing to overwrite existing sidecar ${s.abs}`);
      fs.renameSync(s.tmp, s.abs);
      renamed.push(s.abs);
      writtenTmp.splice(writtenTmp.indexOf(s.tmp), 1);
    }
    fs.renameSync(manTmp, manAbs);
    renamed.push(manAbs);
    writtenTmp.splice(writtenTmp.indexOf(manTmp), 1);
    fs.renameSync(blTmp, backlogPath);
    return { ok: true, preserved: true };
  } catch (e) {
    rollbackTmp();
    process.stderr.write(String(e.message || e) + '\n');
    return { ok: false, preserved: false };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const backlogPath = path.resolve(args.backlog);
  let text;
  try {
    text = fs.readFileSync(backlogPath, 'utf8');
  } catch (e) {
    process.stderr.write(`unreadable backlog: ${e.message}\n`);
    process.exit(2);
  }
  const repoRoot = gitToplevel(path.dirname(backlogPath)) || path.dirname(backlogPath);
  let cfg;
  try {
    cfg = loadCfg(args, repoRoot);
  } catch (e) {
    process.stderr.write(`unreadable config: ${e.message}\n`);
    process.exit(2);
  }

  let planned;
  try {
    planned = planMigration(text, cfg, repoRoot, args);
  } catch (e) {
    if (e && e.exitCode === 2) process.exit(2);
    throw e;
  }

  if (!args.apply) {
    planned.manifest.preserved = null;
    // Synchronous writes: a 60 KB+ manifest through a pipe followed by process.exit() was
    // truncated at the 64 KiB pipe buffer (suite case (j), 2026-09-14). fs.writeSync blocks
    // until the kernel has every byte.
    fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
    if (!args.json) {
      const diff = unifiedDiff(text, planned.newText, backlogPath);
      if (diff) fs.writeSync(1, diff);
    }
    process.exit(0);
  }

  const hasUnmappedColumn = (planned.errors || []).some((e) => e.code === 'unmapped_column');
  const hasUnmappedStatus = (planned.errors || []).some((e) => e.code === 'unmapped_status');
  if (hasUnmappedColumn || (hasUnmappedStatus && !args.allowUnmappedToSidecar)) {
    planned.manifest.preserved = false;
    fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
    process.exit(1);
  }

  const originalText = text;
  const result = applyWrites(
    backlogPath,
    planned.newText,
    planned.sidecars,
    planned.manifest,
    planned.outDirAbs,
    planned.when
  );
  planned.manifest.preserved = result.preserved && planned.manifest.preserved !== false;
  if (result.ok && result.preserved && !result.noop) {
    const { report } = runCheck({ backlog: backlogPath, config: args.config });
    planned.manifest.gate = report;
    if (report.exit !== 0) {
      fs.writeFileSync(backlogPath, originalText);
      for (const s of planned.sidecars) {
        try { fs.unlinkSync(s.abs); } catch { /* ignore */ }
      }
      try {
        fs.unlinkSync(path.join(planned.outDirAbs, 'MIGRATION-' + planned.when + '.json'));
      } catch { /* ignore */ }
      planned.manifest.preserved = false;
      fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
      process.exit(1);
    }
  } else if (result.ok && result.preserved && result.noop) {
    const { report } = runCheck({ backlog: backlogPath, config: args.config });
    planned.manifest.gate = report;
  }
  if (result.ok && result.preserved && planned.dropped && planned.dropped.length) {
    fs.writeFileSync(backlogPath, originalText);
    for (const s of planned.sidecars) {
      try { fs.unlinkSync(s.abs); } catch { /* ignore */ }
    }
    try {
      fs.unlinkSync(path.join(planned.outDirAbs, 'MIGRATION-' + planned.when + '.json'));
    } catch { /* ignore */ }
    planned.manifest.preserved = false;
    fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
    process.exit(1);
  }
  fs.writeSync(1, JSON.stringify(planned.manifest) + '\n');
  process.exit(result.ok && planned.manifest.preserved ? 0 : 1);
}

if (require.main === module) main();
