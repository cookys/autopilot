'use strict';

/**
 * backlog-rules.js - the field and peer rules of references/backlog-entry.md, shared by the gate
 * (scripts/check-backlog-entries.js, which parses rows and applies them) and the writer
 * (scripts/lib/record-files.js, scripts/project-record.js, which validate a PROPOSED row before any write).
 *
 * Extracted from check-backlog-entries.js with no rule change: the code below the marker line is the gate's
 * own, moved verbatim (only STAGE_GRAPH_FILE's relative path and the unansweredReports helper differ). The
 * schema lives in references/backlog-entry.md; the caps are UTF-8 bytes.
 *
 * Exports:
 *   rules and constants   KNOWN_FIELDS REQUIRED NEW_FIELDS REQUIRABLE ALL_FIELDS PEER_FIELDS DEFAULT_CAPS BL_ID_RE
 *                         NEXT_ID_RE MULTI_SEP WARN_CODES LEGACY_EFFORT_MAP POINTER_THRESHOLD STATUS_RE ...
 *   on parsed rows        checkEntry(entry, cfg, repoRoot, now, existsFn) -> violations; checkReporterFields;
 *                         pointerOk; parseEffortValue; triggerTypeCode; replyOk; replyUnanswered; reportPairs;
 *                         fieldOptedIn; withNextIdMark; blIdEnforced; unansweredReports
 *   on a proposed row     validateProposed(proposed, ctx) -> {fields, row, violations, blocking, warnings}
 *                         assertProposedValid(proposed, ctx) -> same, or throws RuleViolationError
 *                         renderRow(fields) -> the heading row text; proposedFields(proposed) -> {Field: value}
 *                         assertPeerClosable(fields) -> throws RuleViolationError (peer_closed_unanswered)
 *   RuleViolationError    .rule (first blocking code), .violations[], .exitCode 3
 */

const fs = require('fs');
const path = require('path');

// ---- moved verbatim from check-backlog-entries.js ---------------------------------------------------------
const KNOWN_FIELDS = ['Title', 'Status', 'Trigger', 'Trigger-Type', 'Effort', 'Source', 'Pointer', 'Context'];
const REQUIRED = ['Title', 'Status', 'Trigger', 'Trigger-Type', 'Effort', 'Source', 'Pointer'];
// Trigger-Type values. `date:` must be a real calendar day; anything else in that shape is bad_trigger_date.
const TRIGGER_TYPE_WORDS = ['owner', 'event', 'ready', 'peer'];
// Reporter fields. They never count toward the pointer threshold (R1), and a row carrying any of
// them gets the larger row cap (R2). `required_fields` may name only REQUIRABLE ones; the peer
// trio is required by `Origin: peer` itself.
const NEW_FIELDS = ['Id', 'Since', 'Origin', 'Reporter', 'Report', 'Reply', 'Problem', 'Impact'];
const REQUIRABLE = ['Id', 'Since', 'Origin', 'Problem', 'Impact', 'Trigger-Type'];
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
const STAGE_GRAPH_FILE = path.join(__dirname, '..', '..', 'references', 'stage-graph.json');
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

// `shipped` carries the ship date as well as the version/sha: done_not_moved is measured from a
// date, and a version alone has none (depth-0 probe, 2026-09-14).
const STATUS_RE = /^(open|fired \d{4}-\d{2}-\d{2}|dropped \d{4}-\d{2}-\d{2}|shipped \S+ \d{4}-\d{2}-\d{2})$/;

function byteLen(s) {
  return Buffer.byteLength(String(s == null ? '' : s), 'utf8');
}

function realCalendarDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toISOString().slice(0, 10) === m[0];
}

// null when the value is allowed; otherwise bad_trigger_type or bad_trigger_date.
function triggerTypeCode(raw) {
  const v = String(raw).trim();
  if (TRIGGER_TYPE_WORDS.includes(v)) return null;
  if (v.startsWith('date:')) return realCalendarDate(v.slice(5)) ? null : 'bad_trigger_date';
  return 'bad_trigger_type';
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
// Required for new entries: once the file uses Trigger-Type (or required_fields names it),
// every entry must carry one. A legacy file that never mentions the field is unchanged.
function triggerTypeRequired(cfg) {
  return Boolean(cfg && (cfg.trigger_type_adopted || (cfg.required_fields || []).includes('Trigger-Type')));
}

function fieldOptedIn(cfg, f) {
  if (!cfg) return false;
  if (cfg.next_id_mark) return true;
  const req = cfg.required_fields || [];
  return req.includes(f) || (PEER_FIELDS.includes(f) && req.includes('Origin'));
}

// Reports of one row whose Reply is none/unknown/missing/malformed (positional). A peer row with any
// of them may not be closed (peer_closed_unanswered), by the gate and by the writer alike.
function unansweredReports(fields) {
  const replies = splitMulti(fields.Reply);
  const reports = splitMulti(fields.Report);
  const count = Math.max(reports.length, replies.length, 1);
  const open = [];
  for (let i = 0; i < count; i++) if (replyUnanswered(replies[i])) open.push(reports[i] || '(no Report)');
  return open;
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
      const open = unansweredReports(fields);
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
    if (f === 'Trigger-Type' && !triggerTypeRequired(cfg)) continue;
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
  if (fields['Trigger-Type'] != null && String(fields['Trigger-Type']).trim() !== '') {
    const code = triggerTypeCode(fields['Trigger-Type']);
    if (code === 'bad_trigger_date') {
      vios.push({
        code: 'bad_trigger_date',
        title,
        field: 'Trigger-Type',
        detail: `${String(fields['Trigger-Type']).trim()} (not a real calendar date)`,
      });
    } else if (code === 'bad_trigger_type') {
      vios.push({
        code: 'bad_trigger_type',
        title,
        field: 'Trigger-Type',
        detail: `${String(fields['Trigger-Type']).trim()} (expected owner|event|ready|peer|date:YYYY-MM-DD)`,
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

// ---- the writer's side: validate a proposed row -----------------------------------------------------------

// Raised by the writer when a proposed row breaks a rule of references/backlog-entry.md (or a close would
// strand a peer reporter). `rule` is the first blocking code; `violations` is the whole list. Nothing was
// written. The CLI maps it to exit 3.
class RuleViolationError extends Error {
  constructor(violations, message) {
    const blocking = violations.filter((v) => levelOf(v) !== 'warn');
    super(message || `backlog rule violated: ${blocking.map((v) => `${v.code}${v.field ? ` (${v.field})` : ''}${v.detail ? `: ${v.detail}` : ''}`).join('; ')}`);
    this.name = 'RuleViolationError';
    this.rule = blocking.length ? blocking[0].code : null;
    this.violations = violations;
    this.exitCode = 3;
  }
}

function levelOf(v) {
  return v.level || (WARN_CODES.has(v.code) ? 'warn' : 'block');
}

// Row field order, as in the schema example of references/backlog-entry.md.
const ROW_ORDER = ['Id', 'Status', 'Since', 'Origin', 'Reporter', 'Report', 'Reply', 'Problem', 'Impact', 'Trigger', 'Trigger-Type', 'Effort', 'Source', 'Pointer', 'Context'];
// A new row always carries these (the writer sets Id and Since itself). Added to the config's own list.
const WRITER_REQUIRED = ['Id', 'Since', 'Origin', 'Problem', 'Impact', 'Trigger-Type'];
const PROPOSED_KEYS = {
  title: 'Title', id: 'Id', status: 'Status', since: 'Since', origin: 'Origin', reporter: 'Reporter', report: 'Report',
  reply: 'Reply', problem: 'Problem', impact: 'Impact', trigger: 'Trigger', triggerType: 'Trigger-Type', effort: 'Effort',
  source: 'Source', pointer: 'Pointer', context: 'Context',
};

// {title, origin, ...} (camelCase keys) -> {Title, Origin, ...}; blank values are absent. Unknown keys throw.
function proposedFields(proposed) {
  const out = {};
  for (const [k, v] of Object.entries(proposed || {})) {
    const name = PROPOSED_KEYS[k];
    if (!name) throw new TypeError(`unknown backlog field: ${k}`);
    if (v == null || String(v).trim() === '') continue;
    out[name] = String(v).trim();
  }
  return out;
}

// The heading row for validated fields, no trailing newline.
function renderRow(fields) {
  const lines = [`### ${fields.Title}`];
  for (const f of ROW_ORDER) if (fields[f] != null) lines.push(`- **${f}**: ${fields[f]}`);
  return lines.join('\n');
}

// What parseHeadingBlock would make of the rendered row.
function entryForFields(fields) {
  const text = renderRow(fields);
  let newFieldBytes = 0;
  let idBytes = 0;
  for (const f of ROW_ORDER) {
    if (fields[f] == null) continue;
    const n = byteLen(`- **${f}**: ${fields[f]}`) + 1;
    if (f === 'Id') idBytes += n;
    else if (NEW_FIELDS.includes(f)) newFieldBytes += n;
  }
  return { fields, extra: false, text, id: fields.Id || null, title: fields.Title, newFieldBytes, idBytes };
}

// ctx: {cfg (gate config), repoRoot, now (ms), existsFn?, existingTitles?: string[]}
// Applies exactly the gate's per-row rules (checkEntry) to the row as it will be written, plus duplicate_title.
function validateProposed(proposed, ctx) {
  const c = ctx || {};
  const fields = proposedFields(proposed);
  const violations = [];
  const title = fields.Title || '';
  if (!title) {
    violations.push({ code: 'missing_field', title: '', field: 'Title', detail: 'Title missing' });
    return { fields, row: null, violations, blocking: violations.slice(), warnings: [] };
  }
  for (const [f, v] of Object.entries(fields)) {
    if (/[\r\n]/.test(v)) violations.push({ code: 'extra_content', title, field: f, detail: 'a value spans lines' });
  }
  if ((c.existingTitles || []).some((t) => String(t).trim().toLowerCase() === title.toLowerCase())) {
    violations.push({ code: 'duplicate_title', title, field: 'Title', detail: 'duplicate title' });
  }
  const base = c.cfg || {};
  const ecfg = Object.assign({}, base, {
    next_id_mark: true,
    trigger_type_adopted: true,
    required_fields: [...new Set([...(base.required_fields || []), ...WRITER_REQUIRED])],
  });
  const entry = entryForFields(fields);
  violations.push(...checkEntry(entry, ecfg, c.repoRoot, c.now == null ? Date.now() : c.now, c.existsFn));
  const annotated = violations.map((v) => Object.assign({}, v, { level: levelOf(v) }));
  return {
    fields,
    row: entry.text,
    violations: annotated,
    blocking: annotated.filter((v) => v.level !== 'warn'),
    warnings: annotated.filter((v) => v.level === 'warn'),
  };
}

function assertProposedValid(proposed, ctx) {
  const r = validateProposed(proposed, ctx);
  if (r.blocking.length) throw new RuleViolationError(r.violations);
  return r;
}

// Closing (done, cancelled, superseded) a row whose peer reporter has no answer is refused, as the gate does
// with peer_closed_unanswered. `fields` are the row's parsed fields.
function assertPeerClosable(fields) {
  if (!fields || String(fields.Origin || '').trim() !== 'peer') return;
  const open = unansweredReports(fields);
  if (open.length) {
    const title = fields.Title || '';
    throw new RuleViolationError([{ code: 'peer_closed_unanswered', title, field: 'Reply', detail: `closing with no reply to ${open.join(', ')}` }]);
  }
}

module.exports = {
  KNOWN_FIELDS, REQUIRED, TRIGGER_TYPE_WORDS, NEW_FIELDS, REQUIRABLE, PEER_FIELDS, ALL_FIELDS, ORIGINS,
  BL_ID_RE, NEXT_ID_RE, MULTI_SEP, WARN_CODES, URGENT_SUFFIXES, LEGACY_EFFORT_MAP, DEFAULT_CAPS, POINTER_THRESHOLD, STATUS_RE,
  ROW_ORDER, WRITER_REQUIRED,
  loadSizes, parseEffortValue, badEffortDetail, byteLen, realCalendarDate, triggerTypeCode, pointerOk, statusDate, daysAgo,
  checkCapsRaised, effectiveCap, isValidDate, splitMulti, replyOk, replyUnanswered, reportPairs, unansweredReports,
  hasNewFields, legacyBytes, blIdEnforced, withNextIdMark, triggerTypeRequired, fieldOptedIn, checkReporterFields, checkEntry,
  RuleViolationError, levelOf, proposedFields, renderRow, entryForFields, validateProposed, assertProposedValid, assertPeerClosable,
};
