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
 *   rules and constants   KNOWN_FIELDS REQUIRED NEW_FIELDS QUEUE_FIELDS REQUIRABLE ALL_FIELDS PEER_FIELDS
 *                         DEFAULT_CAPS BL_ID_RE NEXT_ID_RE MULTI_SEP WARN_CODES LEGACY_EFFORT_MAP
 *                         POINTER_THRESHOLD STATUS_RE ...
 *   on parsed rows        checkEntry(entry, cfg, repoRoot, now, existsFn) -> violations; checkReporterFields;
 *                         checkQueueLinks(entries, text); isReady(entry, ctx); isQueueForm;
 *                         pointerOk; parseEffortValue; triggerTypeCode; replyOk; replyUnanswered; reportPairs;
 *                         fieldOptedIn; withNextIdMark; blIdEnforced; unansweredReports
 *                         paddedDeadline(entry | brief or fleet-reply text) -> PADDED_DEADLINE or null;
 *                         EFFORT_HOURS (the one hour table); PADDED_DEADLINE_MULTIPLIER
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
// Queue-form fields are always read on a heading row. They are not part of the reporter-field
// opt-in (do not add them to NEW_FIELDS). A heading row that carries any of them is queue-form.
const QUEUE_FIELDS = ['Done-Check', 'Artifact', 'Needs', 'after', 'Due', 'ms', 'Used-by', 'Queued-By', 'Prompt', 'Inputs', 'Feeds'];
const QUEUE_TEXT_FIELDS = ['Prompt', 'Inputs', 'Feeds'];
const QUEUE_EFFORT = new Set(['XS', 'S', 'M']);
const QUEUE_ARTIFACTS = ['code', 'text', 'run'];
const DONE_CHECK_COMMANDS = new Set(['node', 'bash', 'sh', 'git', 'test', 'grep', 'python3', 'npm']);
const NEED_SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
const NEED_CARD_RE = /^d-[0-9a-f]{8}$/;
const MS_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const QUEUE_ADDR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
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

// Planning budget in hours for PADDED_DEADLINE. references/stage-graph.json names the
// sizes and the bump limits; it does not state hours. This is the one table. A one-day
// due on S (2x = 8h) or M (2x = 16h) is past the budget. The urgent suffix does not
// change the hours.
const EFFORT_HOURS = Object.freeze({ XS: 1, S: 4, M: 8, L: 24, XL: 40 });
// A due span strictly longer than this multiple of the effort budget, with no checkable
// dependency, is PADDED_DEADLINE. Exactly the multiple is clean. The negative-control
// mutation rewrites this assignment and only this assignment.
const PADDED_DEADLINE_MULTIPLIER = 2;

const DEFAULT_CAPS = {
  Title: 120,
  Status: 64,
  Trigger: 240,
  Source: 160,
  Pointer: 200,
  Context: 240,
  Problem: 300,
  Impact: 160,
  'Done-Check': 200,
  Needs: 120,
  after: 120,
  Due: 64,
  ms: 64,
  'Used-by': 120,
  'Queued-By': 120,
  Prompt: 200,
  Inputs: 300,
  // `entry` caps a legacy row (no reporter field); `row` caps a row carrying any reporter field;
  // `queue` caps a queue-form row. A config may only lower these.
  entry: 900,
  row: 1600,
  queue: 2400,
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
  return byteLen(entry.text) - (entry.newFieldBytes || 0) - (entry.queueFieldBytes || 0) - id;
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

function isQueueForm(entry) {
  const fields = entry && entry.fields;
  if (!fields) return false;
  return QUEUE_FIELDS.some((f) => fields[f] != null);
}

function queuePresent(fields, f) {
  return fields[f] != null && String(fields[f]).trim() !== '';
}

function relativeUnderRoot(token, repoRoot, existsFn) {
  const rel = String(token || '').trim().replace(/^\.\/+/, '');
  if (!rel || path.isAbsolute(rel) || rel.includes('\0') || /^[A-Za-z]:/.test(rel)) return false;
  const root = path.resolve(repoRoot || '.');
  const abs = path.resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  return Boolean((existsFn || fs.existsSync)(abs));
}

function doneCheckRunnable(value, repoRoot, existsFn) {
  const v = String(value == null ? '' : value).trim();
  const m = /^`([^`\n]+)`$/.exec(v);
  if (!m) return false;
  const inner = m[1].trim();
  if (!inner) return false;
  const token = inner.split(/\s+/)[0];
  if (DONE_CHECK_COMMANDS.has(token)) return true;
  return relativeUnderRoot(token, repoRoot, existsFn);
}

function needsOk(value) {
  const v = String(value == null ? '' : value).trim();
  if (v === 'none') return true;
  const parts = v.split(';').map((s) => s.trim());
  if (!parts.length || parts.some((p) => p === '')) return false;
  return parts.every((p) => {
    const i = p.indexOf(':');
    if (i <= 0) return false;
    const kind = p.slice(0, i);
    const rest = p.slice(i + 1);
    if (kind === 'resource' || kind === 'engine') return NEED_SLUG_RE.test(rest);
    if (kind === 'card') return NEED_CARD_RE.test(rest);
    return false;
  });
}

function usedByOk(value) {
  const v = String(value == null ? '' : value).trim();
  if (v === 'user' || v === 'e2e') return true;
  const m = /^n\/a (.+)$/.exec(v);
  return Boolean(m && m[1].length >= 8);
}

function queuedByOk(value) {
  const v = String(value == null ? '' : value).trim();
  const m = /^(\S+)\s+(\S+)$/.exec(v);
  if (!m || !QUEUE_ADDR_RE.test(m[1])) return false;
  return m[2].length > 0;
}

function inputsOk(value, repoRoot, existsFn) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return false;
  const parts = v.split(';').map((s) => s.trim());
  if (!parts.length || parts.some((p) => p === '')) return false;
  return parts.every((p) => relativeUnderRoot(p, repoRoot, existsFn));
}

function rowId(entry) {
  if (!entry) return '';
  const raw = entry.id != null && String(entry.id).trim() !== '' ? entry.id : (entry.fields && entry.fields.Id);
  return String(raw == null ? '' : raw).trim();
}

// Empty segments stay. "- **after**:", "- **after**: ;" and "- **after**: BL-0001;"
// are after_broken, not a blank a READY row can skip.
function afterList(entry) {
  const raw = entry && entry.fields && entry.fields.after;
  if (raw == null) return [];
  return String(raw).split(';').map((s) => s.trim());
}

function nextIdFromText(text) {
  const mark = String(text || '').match(NEXT_ID_RE);
  if (!mark) return null;
  const m = String(mark[1]).match(BL_ID_RE);
  return m ? Number(m[1]) : null;
}

function normalizeNextId(nextId) {
  if (typeof nextId === 'number' && Number.isFinite(nextId)) return nextId;
  if (nextId == null || nextId === '') return null;
  return nextIdFromText(String(nextId)) != null && NEXT_ID_RE.test(String(nextId))
    ? nextIdFromText(String(nextId))
    : (() => {
      const m = String(nextId).trim().match(BL_ID_RE) || String(nextId).trim().match(/^(\d+)$/);
      return m ? Number(m[1]) : null;
    })();
}

function findRow(entries, id) {
  return (entries || []).find((e) => rowId(e) === id) || null;
}

// null when the dependency is well-formed. Dropped, malformed, at/above the mark, or absent
// with no mark is after_broken. An id below the mark that is simply not in the file is a
// deleted row (shipped or dropped cannot be told apart) and is not broken.
function afterBrokenReason(id, entries, nextNum) {
  if (!BL_ID_RE.test(id)) return `${id} (expected BL-NNNN)`;
  const n = Number(BL_ID_RE.exec(id)[1]);
  if (nextNum != null && n >= nextNum) return `${id} is not below next-id`;
  const ent = findRow(entries, id);
  if (ent) {
    const st = String((ent.fields && ent.fields.Status) || '').trim();
    if (/^dropped\b/.test(st)) return `${id} Status dropped`;
    return null;
  }
  if (nextNum == null) return `${id} absent with no next-id mark`;
  return null;
}

function afterIdSatisfied(id, entries, nextNum) {
  if (afterBrokenReason(id, entries, nextNum)) return false;
  const ent = findRow(entries, id);
  if (ent) return /^shipped\b/.test(String((ent.fields && ent.fields.Status) || '').trim());
  return BL_ID_RE.test(id) && nextNum != null && Number(BL_ID_RE.exec(id)[1]) < nextNum;
}

function findAfterCycles(entries) {
  const nodes = new Set();
  const graph = new Map();
  for (const e of entries || []) {
    const id = rowId(e);
    if (!BL_ID_RE.test(id)) continue;
    nodes.add(id);
    const outs = afterList(e).filter((a) => BL_ID_RE.test(a));
    if (outs.length) graph.set(id, outs);
  }
  const color = new Map();
  const cycles = [];
  function dfs(u, stack) {
    color.set(u, 1);
    stack.push(u);
    for (const v of graph.get(u) || []) {
      if (v === u) {
        cycles.push([u, u]);
        continue;
      }
      if (!nodes.has(v)) continue;
      if (color.get(v) === 1) {
        const i = stack.indexOf(v);
        if (i >= 0) cycles.push(stack.slice(i).concat([v]));
      } else if (color.get(v) !== 2) dfs(v, stack);
    }
    stack.pop();
    color.set(u, 2);
  }
  for (const id of graph.keys()) if (color.get(id) !== 2) dfs(id, []);
  return cycles;
}

function checkQueueEntry(entry, cfg, repoRoot, existsFn) {
  const vios = [];
  if (!isQueueForm(entry)) return vios;
  const fields = entry.fields || {};
  const title = fields.Title || entry.title || '';
  const push = (code, field, detail) => vios.push({ code, title, field, detail });
  const required = ['Id', 'Done-Check', 'Artifact', 'Needs', 'ms', 'Used-by', 'Queued-By'];
  for (const f of required) {
    if (!queuePresent(fields, f)) push('missing_field', f, `${f} missing`);
  }
  if (queuePresent(fields, 'Id') && !BL_ID_RE.test(String(fields.Id).trim()) && !blIdEnforced(cfg)) {
    push('bad_id', 'Id', `${String(fields.Id).trim()} (expected BL-NNNN)`);
  }
  if (queuePresent(fields, 'Effort')) {
    const parsed = parseEffortValue(fields.Effort);
    if (parsed && !QUEUE_EFFORT.has(parsed.size)) {
      push('effort_too_large', 'Effort', `${parsed.size} (queue-form allows XS|S|M)`);
    }
  }
  if (queuePresent(fields, 'Done-Check') && !doneCheckRunnable(fields['Done-Check'], repoRoot, existsFn)) {
    push('done_check_unrunnable', 'Done-Check', `${String(fields['Done-Check']).trim()} (one backticked command; not executed)`);
  }
  const artifact = queuePresent(fields, 'Artifact') ? String(fields.Artifact).trim() : '';
  if (artifact && !QUEUE_ARTIFACTS.includes(artifact)) {
    push('bad_artifact', 'Artifact', `${artifact} (expected code|text|run)`);
  }
  if (queuePresent(fields, 'Needs') && !needsOk(fields.Needs)) {
    push('bad_needs', 'Needs', `${String(fields.Needs).trim()} (expected none or resource:|card:|engine: tokens)`);
  }
  if (queuePresent(fields, 'ms') && !MS_RE.test(String(fields.ms).trim())) {
    push('bad_ms', 'ms', `${String(fields.ms).trim()} (expected a milestone-step token)`);
  }
  if (queuePresent(fields, 'Used-by') && !usedByOk(fields['Used-by'])) {
    push('bad_used_by', 'Used-by', `${String(fields['Used-by']).trim()} (expected user|e2e|n/a <reason of 8+ chars>)`);
  }
  if (queuePresent(fields, 'Queued-By') && !queuedByOk(fields['Queued-By'])) {
    push('bad_queued_by', 'Queued-By', `${String(fields['Queued-By']).trim()} (expected <ns>/<courier>/<member> <message-id|self>)`);
  }
  if (artifact === 'text') {
    if (!queuePresent(fields, 'Prompt')) push('text_row_missing_inputs', 'Prompt', 'Prompt missing');
    else if (!relativeUnderRoot(String(fields.Prompt).trim(), repoRoot, existsFn)) {
      push('text_row_missing_inputs', 'Prompt', `${String(fields.Prompt).trim()} does not exist`);
    }
    if (!queuePresent(fields, 'Inputs')) push('text_row_missing_inputs', 'Inputs', 'Inputs missing');
    else if (!inputsOk(fields.Inputs, repoRoot, existsFn)) {
      push('text_row_missing_inputs', 'Inputs', `${String(fields.Inputs).trim()} is not a list of existing relative paths`);
    }
    if (!queuePresent(fields, 'Feeds')) push('text_row_missing_inputs', 'Feeds', 'Feeds missing');
  } else if (artifact === 'code' || artifact === 'run') {
    for (const f of QUEUE_TEXT_FIELDS) {
      // An empty bullet is present. queuePresent would skip it and leave the row READY.
      if (fields[f] != null) push('extra_content', f, `${f} is only allowed when Artifact is text`);
    }
  }
  return vios;
}

// Cross-row queue rules: after_cycle, after_broken, feeds_broken. Per-row rules stay in checkEntry.
function checkQueueLinks(entries, text) {
  const nextNum = nextIdFromText(text);
  const vios = [];
  const cycleById = new Map();
  for (const cycle of findAfterCycles(entries)) {
    const detail = cycle.join(' -> ');
    for (const id of new Set(cycle.slice(0, -1))) {
      if (!cycleById.has(id)) cycleById.set(id, []);
      const list = cycleById.get(id);
      if (!list.includes(detail)) list.push(detail);
    }
  }
  for (const ent of entries || []) {
    if (!isQueueForm(ent)) continue;
    const fields = ent.fields || {};
    const title = fields.Title || ent.title || '';
    const id = rowId(ent);
    if (cycleById.has(id)) {
      vios.push({ code: 'after_cycle', title, field: 'after', detail: cycleById.get(id).join('; ') });
    }
    for (const dep of afterList(ent)) {
      const reason = afterBrokenReason(dep, entries, nextNum);
      if (reason) vios.push({ code: 'after_broken', title, field: 'after', detail: reason });
    }
    if (String(fields.Artifact || '').trim() === 'text' && queuePresent(fields, 'Feeds')) {
      const fid = String(fields.Feeds).trim();
      if (!BL_ID_RE.test(fid) || !findRow(entries, fid)) {
        vios.push({ code: 'feeds_broken', title, field: 'Feeds', detail: `${fid} is not an Id of a row in this file` });
      }
    }
  }
  return vios;
}

function afterDependenciesSatisfied(entry, entries, nextId) {
  const nextNum = normalizeNextId(nextId);
  for (const id of afterList(entry)) {
    if (!afterIdSatisfied(id, entries, nextNum)) return false;
  }
  return true;
}

function queueReadyCore(entry, ctx) {
  const c = ctx || {};
  const fields = (entry && entry.fields) || {};
  if (String(fields.Status || '').trim() !== 'open') return false;
  if (String(fields['Trigger-Type'] || '').trim() !== 'ready') return false;
  if (!isQueueForm(entry)) return false;
  const vios = Array.isArray(entry.violations) ? entry.violations : null;
  if (!vios || vios.some((v) => levelOf(v) !== 'warn')) return false;
  return afterDependenciesSatisfied(entry, c.entries || [], c.nextId);
}

// READY iff Status is open, Trigger-Type is ready, the row is queue-form with zero blocking
// violations, and every after: id is satisfied (absent below the next-id mark, or Status shipped).
// Needs is not judged here. ctx = {entries, nextId}. entry.violations is the gate's list.
function isReady(entry, ctx) {
  if (!queueReadyCore(entry, ctx)) return false;
  return true;
}

// A dependency counts only as a whole Needs or after token. Free text ("tomorrow",
// "see BL-0123") does not. `none` and `engine:` do not. A named resource is the
// `resource:<slug>` token Needs already uses, so a bare word is not a resource.
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const CARD_DEP_RE = /^(?:card:)?d-[0-9a-f]{8}$/;
const RESOURCE_DEP_RE = /^resource:[a-z0-9][a-z0-9._-]*$/;
const TASK_DEP_RE = /^task:[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/;
const BRIEF_FIELD_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?(Due|Deadline|Effort|Since|Start|Needs|after|Status|Trigger-Type)(?:\*\*)?\s*[:：]\s*(.*?)\s*$/;

function depTokens(value) {
  if (value == null || String(value).trim() === '') return [];
  return String(value).split(';').map((s) => s.trim()).filter((s) => s !== '');
}

function depTokenCheckable(token) {
  const quoted = /^["']([^"']*)["']$/.exec(String(token).trim());
  const t = quoted ? quoted[1].trim() : String(token).trim();
  if (t === '' || t === 'none') return false;
  if (BL_ID_RE.test(t)) return true;
  if (CARD_DEP_RE.test(t)) return true;
  if (RESOURCE_DEP_RE.test(t)) return true;
  if (TASK_DEP_RE.test(t)) return true;
  if (ULID_RE.test(t)) return true;
  return false;
}

function hasCheckableDependency(fields) {
  return depTokens(fields.Needs).concat(depTokens(fields.after)).some(depTokenCheckable);
}

function effortHoursOf(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const parsed = parseEffortValue(raw);
  if (parsed) {
    const hours = EFFORT_HOURS[parsed.size];
    if (typeof hours !== 'number') return null;
    return { hours, size: parsed.size };
  }
  const v = String(raw).trim();
  let m = /^(\d+(?:\.\d+)?)h$/.exec(v);
  if (m) return { hours: Number(m[1]), size: v };
  m = /^(\d+(?:\.\d+)?)m$/.exec(v);
  if (m) return { hours: Number(m[1]) / 60, size: v };
  m = /^(\d+(?:\.\d+)?)$/.exec(v);
  if (m) return { hours: Number(m[1]), size: v };
  return null;
}

function parseInstant(raw) {
  const v = String(raw).trim();
  const day = /^(\d{4}-\d{2}-\d{2})$/.exec(v);
  if (day) {
    if (!realCalendarDate(day[1])) return null;
    const t = Date.parse(day[1] + 'T00:00:00Z');
    return Number.isNaN(t) ? null : t;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})$/.exec(v);
  if (!iso || !realCalendarDate(iso[1])) return null;
  const sec = iso[2].length === 5 ? iso[2] + ':00' : iso[2];
  const t = Date.parse(`${iso[1]}T${sec}${iso[3]}`);
  return Number.isNaN(t) ? null : t;
}

// A duration is already a span, so it does not need Since. 1.5h is one unit;
// 2h30m is a sum; 1.5h30m is not a duration.
function parseDurationMs(raw) {
  const v = String(raw).trim();
  if (!/^(?:\d+(?:\.\d+)?[dhms])+$/.test(v)) return null;
  const units = v.match(/[dhms]/g) || [];
  if (/\./.test(v) && units.length !== 1) return null;
  let ms = 0;
  const re = /(\d+(?:\.\d+)?)([dhms])/g;
  let m;
  while ((m = re.exec(v))) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    ms += n * { d: 86400000, h: 3600000, m: 60000, s: 1000 }[m[2]];
  }
  return ms;
}

function dueSpanMs(fields) {
  const dueRaw = fields.Due;
  if (dueRaw == null || String(dueRaw).trim() === '') return null;
  const dur = parseDurationMs(dueRaw);
  if (dur != null) return dur;
  const dueAt = parseInstant(dueRaw);
  if (dueAt == null) return null;
  if (fields.Since == null || String(fields.Since).trim() === '') return null;
  const startAt = parseInstant(fields.Since);
  if (startAt == null) return null;
  return dueAt - startAt;
}

function formatHours(ms) {
  return String(Math.round((ms / 3600000) * 1000) / 1000);
}

function fieldsFromText(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = BRIEF_FIELD_RE.exec(line);
    if (!m || fields[m[1]] != null) continue;
    fields[m[1]] = m[2].trim();
  }
  if (fields.Due == null && fields.Deadline != null) fields.Due = fields.Deadline;
  if (fields.Start != null) fields.Since = fields.Start;
  return fields;
}

function textNotReady(fields) {
  const status = fields.Status == null ? '' : String(fields.Status).trim();
  if (status !== '' && status !== 'open') return true;
  const tt = fields['Trigger-Type'] == null ? '' : String(fields['Trigger-Type']).trim();
  return tt !== '' && tt !== 'ready';
}

// entry (a parsed backlog row) is judged only when it is READY-shaped: Status open,
// Trigger-Type ready, queue-form. Other blocking violations do not hide this one.
// A string is a dispatch brief or a fleet reply: judged whenever Due, Effort and the
// start are measurable, unless the text itself sets Status or Trigger-Type otherwise.
// Deadline is an alias of Due, and Start of Since, on text only. Returns null when
// the span is not strictly longer than the multiple, or a dependency is checkable.
function paddedDeadline(subject) {
  let fields;
  if (typeof subject === 'string') {
    fields = fieldsFromText(subject);
    if (textNotReady(fields)) return null;
  } else if (subject && typeof subject === 'object' && subject.fields && typeof subject.fields === 'object') {
    fields = subject.fields;
    if (String(fields.Status || '').trim() !== 'open') return null;
    if (String(fields['Trigger-Type'] || '').trim() !== 'ready') return null;
    if (!isQueueForm(subject)) return null;
  } else if (subject && typeof subject === 'object') {
    fields = subject;
    if (textNotReady(fields)) return null;
  } else {
    return null;
  }
  const effort = effortHoursOf(fields.Effort);
  if (!effort || !(effort.hours > 0) || !Number.isFinite(effort.hours)) return null;
  const spanMs = dueSpanMs(fields);
  if (spanMs == null || !Number.isFinite(spanMs)) return null;
  if (hasCheckableDependency(fields)) return null;
  const limitMs = PADDED_DEADLINE_MULTIPLIER * effort.hours * 3600000;
  if (!(spanMs > limitMs)) return null;
  return {
    code: 'PADDED_DEADLINE',
    field: 'Due',
    detail: `${formatHours(spanMs)}h > ${PADDED_DEADLINE_MULTIPLIER}x ${effort.size} (${formatHours(limitMs)}h) with no checkable dependency`,
  };
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
  for (const f of ALL_FIELDS.concat(QUEUE_FIELDS)) {
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
  let capKey = hasNewFields(entry) ? 'row' : 'entry';
  if (isQueueForm(entry)) capKey = 'queue';
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
  vios.push(...checkQueueEntry(entry, cfg, repoRoot, existsFn));
  const padded = paddedDeadline(entry);
  if (padded) vios.push(Object.assign({ title }, padded));
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
  KNOWN_FIELDS, REQUIRED, TRIGGER_TYPE_WORDS, NEW_FIELDS, QUEUE_FIELDS, QUEUE_TEXT_FIELDS, REQUIRABLE, PEER_FIELDS, ALL_FIELDS, ORIGINS,
  BL_ID_RE, NEXT_ID_RE, MULTI_SEP, WARN_CODES, URGENT_SUFFIXES, LEGACY_EFFORT_MAP, DEFAULT_CAPS, POINTER_THRESHOLD, STATUS_RE,
  ROW_ORDER, WRITER_REQUIRED,
  loadSizes, parseEffortValue, badEffortDetail, byteLen, realCalendarDate, triggerTypeCode, pointerOk, statusDate, daysAgo,
  checkCapsRaised, effectiveCap, isValidDate, splitMulti, replyOk, replyUnanswered, reportPairs, unansweredReports,
  hasNewFields, legacyBytes, blIdEnforced, withNextIdMark, triggerTypeRequired, fieldOptedIn, checkReporterFields, checkEntry,
  isQueueForm, checkQueueLinks, isReady, nextIdFromText, normalizeNextId,
  EFFORT_HOURS, PADDED_DEADLINE_MULTIPLIER, paddedDeadline,
  RuleViolationError, levelOf, proposedFields, renderRow, entryForFields, validateProposed, assertProposedValid, assertPeerClosable,
};
