'use strict';

/**
 * record-files.js - the files-mode writers of scripts/project-record.js (plan A3.1 step 3, "Files-mode matrix").
 *
 * One function per matrix row. Each takes a repo root and a plain input object (the CLI maps flags to it),
 * validates BEFORE any write, writes the same files a session wrote by hand before A3, and returns
 *   { id, paths_written[], info_lines[] }
 * `id` is file-native: the BL number, the ADR number, the knowledge heading, the handoff path (repo-relative).
 * `paths_written` are repo-relative posix paths (a deleted file is listed too). Nothing here touches `.hippo/`
 * and nothing runs `git`: staging and committing stay with the caller.
 *
 *   backlogNew(repo, input, opts)       backlogReply(repo, {id, reply}, opts)
 *   backlogClose(repo, {id, how: 'done'|'cancelled'|'superseded', by?, commit?}, opts)
 *   decisionNew(repo, {title, rationale, ledgerRow?, ...}, opts)   decisionSupersede(repo, {old, ...}, opts)
 *   adrNew(repo, {title, body | context+decision+consequences, status?}, opts)   adrSupersede(repo, {old, ...}, opts)
 *   lessonNew(repo, {title, category, context, problem, solution, ...}, opts)
 *   handoffNew(repo, {project, body, decisions?, lessons?}, opts)   handoffClose(repo, {path}, opts)
 *
 * opts: { clock?: () => Date|number|string  (pinned by tests; default now),
 *         adrDir?: repo-relative ADR directory (no resolver field names it yet, so the caller supplies it),
 *         ledger?: absolute decision-ledger path (default: decision-ledger.js's own, from the git common dir) }
 *
 * Paths come from scripts/resolve-project-paths.sh (backlog, projects_dir) and scripts/resolve-knowledge-routing.sh
 * (knowledge_dir), never literals. A rule violation of references/backlog-entry.md throws RuleViolationError
 * (from backlog-rules.js; .rule names the rule, CLI exit 3); every other refusal throws RecordError.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const rules = require('./backlog-rules.js');
const gate = require('../check-backlog-entries.js');

const SCRIPTS_DIR = path.join(__dirname, '..');
const GATE = path.join(SCRIPTS_DIR, 'check-backlog-entries.js');
const LEDGER_CLI = path.join(SCRIPTS_DIR, 'decision-ledger.js');
const { RuleViolationError } = rules;

// A refusal that is not a backlog-entry rule (missing row, missing path, failed gate). `rule` is a stable word.
class RecordError extends Error {
  constructor(rule, message) {
    super(message);
    this.name = 'RecordError';
    this.rule = rule;
    this.exitCode = 1;
  }
}

// ---- small helpers --------------------------------------------------------------------------------------

function nowMs(opts) {
  const c = opts && opts.clock ? opts.clock() : new Date();
  const t = c instanceof Date ? c.getTime() : (typeof c === 'number' ? c : Date.parse(c));
  if (Number.isNaN(t)) throw new RecordError('bad_clock', 'clock returned an invalid date');
  return t;
}
const today = (opts) => new Date(nowMs(opts)).toISOString().slice(0, 10);
const posix = (p) => p.split(path.sep).join('/');
const rel = (repo, abs) => posix(path.relative(repo, abs));

function writeAtomic(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, abs);
}

function resolveField(script, repo, field) {
  const r = spawnSync('bash', [path.join(SCRIPTS_DIR, script), '--target', repo, '--field', field], { encoding: 'utf8' });
  if (r.status !== 0) throw new RecordError('path_unresolved', `${script} --field ${field} exited ${r.status}`);
  return String(r.stdout || '').trim();
}

function needDir(repo, field) {
  const v = resolveField('resolve-project-paths.sh', repo, field);
  if (!v || v === 'none') throw new RecordError(`no_${field}`, `${field} is none for this project; nothing is created`);
  return v;
}

function backlogFile(repo) {
  const v = resolveField('resolve-project-paths.sh', repo, 'backlog');
  if (!v || v === 'none') throw new RecordError('no_backlog', 'backlog is none for this project');
  const abs = path.isAbsolute(v) ? v : path.join(repo, v);
  if (!fs.existsSync(abs)) throw new RecordError('no_backlog', `backlog file does not exist: ${v}`);
  return abs;
}

// Same loading as the gate (check-backlog-entries.js loadGateConfig), without its process.exit.
function gateConfig(repo) {
  let cfg = gate.builtinConfig(repo);
  const p = gate.resolveBacklogConfigPath(repo);
  if (p) cfg = gate.mergeConfig(cfg, gate.parseConfigFile(p));
  return cfg;
}

// Sidecar notes sit in a backlog/ directory beside the backlog file, or in the directory holding it when that
// is itself named backlog (same rule as the gate's checkSidecarOrphans).
function sidecarDir(backlogAbs) {
  const here = path.dirname(backlogAbs);
  return path.basename(here) === 'backlog' ? here : path.join(here, 'backlog');
}

function slugify(s, fallback) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || fallback;
}

function warningLines(r) {
  return r.warnings.map((w) => `warning: ${w.code} (${w.field}): ${w.detail}`);
}

// ---- backlog --------------------------------------------------------------------------------------------

function locateRow(text, id) {
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((l, i) => { if (/^###\s+/.test(l)) heads.push(i); });
  for (let k = 0; k < heads.length; k++) {
    const start = heads[k];
    const end = k + 1 < heads.length ? heads[k + 1] : lines.length;
    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^\s*-\s+\*\*Id\*\*\s*[:：]\s*(\S+)\s*$/);
      if (m && m[1] === id) return { lines, start, end };
    }
  }
  throw new RecordError('row_not_found', `no backlog row with Id ${id}`);
}

function rowFields(loc, text, cfg) {
  const block = { kind: 'heading', title: loc.lines[loc.start].replace(/^###\s+/, '').trim(), lines: loc.lines.slice(loc.start, loc.end) };
  return gate.parseHeadingBlock(block, rules.withNextIdMark(cfg, text)).fields;
}

function lineIndex(loc, name) {
  for (let i = loc.start + 1; i < loc.end; i++) if (new RegExp(`^\\s*-\\s+\\*\\*${name}\\*\\*\\s*[:：]`).test(loc.lines[i])) return i;
  return -1;
}

// Join lines back; a deletion keeps the file's single trailing newline.
function joinTrim(lines) {
  return lines.join('\n').replace(/\n*$/, '\n');
}

function runGate(repo, backlogAbs) {
  const r = spawnSync(process.execPath, [GATE, '--backlog', backlogAbs], { cwd: repo, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function backlogNew(repo, input, opts) {
  const o = opts || {};
  const inp = Object.assign({}, input);
  delete inp.type; // hippo-only (--type); a files row has no such field
  delete inp.relates;
  const sidecarText = inp.sidecar;
  const slug = inp.slug;
  delete inp.sidecar;
  delete inp.slug;
  const cfg = gateConfig(repo);
  if ((cfg.style || 'heading') !== 'heading') throw new RecordError('unsupported_style', `backlog style ${cfg.style} is not written by project-record`);
  const backlogAbs = backlogFile(repo);
  const original = fs.readFileSync(backlogAbs, 'utf8');
  const mark = original.match(rules.NEXT_ID_RE);
  const mm = mark && mark[1].match(rules.BL_ID_RE);
  if (!mm) throw new RecordError('no_next_id', 'the backlog has no valid <!-- next-id: BL-NNNN --> mark; add one first');
  const n = Number(mm[1]);
  const id = `BL-${String(n).padStart(mm[1].length, '0')}`;
  const nextId = `BL-${String(n + 1).padStart(mm[1].length, '0')}`;

  let sidecarAbs = null;
  if (sidecarText != null && String(sidecarText).trim() !== '') {
    if (inp.pointer != null && String(inp.pointer).trim() !== '') throw new RecordError('pointer_sidecar_conflict', 'give a pointer or a sidecar, not both');
    sidecarAbs = path.join(sidecarDir(backlogAbs), `${slugify(slug || inp.title || id, id.toLowerCase())}.md`);
    if (fs.existsSync(sidecarAbs)) throw new RecordError('sidecar_exists', `sidecar already exists: ${rel(repo, sidecarAbs)}`);
    inp.pointer = rel(repo, sidecarAbs);
  }
  if (inp.pointer == null || String(inp.pointer).trim() === '') inp.pointer = 'none';
  if (String(inp.origin || '').trim() === 'peer' && (inp.reply == null || String(inp.reply).trim() === '')) inp.reply = 'none';
  const proposed = Object.assign({ status: 'open', since: today(o) }, inp, { id });

  const titles = gate.collectEntries(original, 'heading', cfg).map((e) => (e.fields && e.fields.Title) || e.title || '');
  const existsFn = (p) => (sidecarAbs && path.resolve(p) === path.resolve(sidecarAbs)) || fs.existsSync(p);
  const v = rules.assertProposedValid(proposed, { cfg, repoRoot: repo, now: nowMs(o), existsFn, existingTitles: titles });

  const bumped = original.replace(rules.NEXT_ID_RE, (whole, tok) => whole.replace(tok, nextId));
  const next = `${bumped.replace(/\n*$/, '')}\n\n${v.row}\n`;
  const written = [rel(repo, backlogAbs)];
  writeAtomic(backlogAbs, next);
  if (sidecarAbs) {
    writeAtomic(sidecarAbs, `${String(sidecarText).replace(/\n*$/, '')}\n`);
    written.push(rel(repo, sidecarAbs));
  }
  const g = runGate(repo, backlogAbs);
  if (g.status !== 0) {
    writeAtomic(backlogAbs, original);
    if (sidecarAbs) fs.rmSync(sidecarAbs, { force: true });
    throw new RecordError('gate_failed', `check-backlog-entries.js refused the new row (exit ${g.status}); nothing was kept:\n${g.out.trim()}`);
  }
  return { id, paths_written: written, info_lines: warningLines(v) };
}

function backlogReply(repo, input, opts) {
  void opts;
  const cfg = gateConfig(repo);
  const backlogAbs = backlogFile(repo);
  const text = fs.readFileSync(backlogAbs, 'utf8');
  const loc = locateRow(text, input.id);
  const reply = String(input.reply == null ? '' : input.reply).trim();
  const bad = [];
  if (!reply || /[\r\n]/.test(reply)) bad.push({ code: 'bad_reply', title: '', field: 'Reply', detail: `${reply || '(empty)'} (one line: none|unknown|<YYYY-MM-DD> <msg id or pointer>)` });
  else for (const part of rules.splitMulti(reply)) if (!rules.replyOk(part)) bad.push({ code: 'bad_reply', title: '', field: 'Reply', detail: `${part} (expected none|unknown|<YYYY-MM-DD> <msg id or pointer>)` });
  const fields = rowFields(loc, text, cfg);
  if (!bad.length && String(fields.Origin || '').trim() === 'peer') {
    const nReports = rules.splitMulti(fields.Report).length;
    if (rules.splitMulti(reply).length !== nReports) {
      bad.push({ code: 'peer_field_missing', title: fields.Title || '', field: 'Reply', detail: `Report has ${nReports} part(s), Reply ${rules.splitMulti(reply).length}; one ${rules.MULTI_SEP}-separated value per reporter` });
    }
  }
  if (bad.length) throw new RuleViolationError(bad);
  const i = lineIndex(loc, 'Reply');
  if (i < 0) throw new RecordError('no_reply_field', `${input.id} has no Reply line (not a peer row)`);
  const cr = loc.lines[i].endsWith('\r') ? '\r' : '';
  loc.lines[i] = `- **Reply**: ${reply}${cr}`;
  // the updated row must still fit the row cap (a row carrying a Reply is a reporter row)
  const rowBytes = rules.byteLen(loc.lines.slice(loc.start, loc.end).join('\n'));
  const rowCap = rules.effectiveCap(cfg, 'row');
  if (rowBytes > rowCap) throw new RuleViolationError([{ code: 'cap_exceeded', title: fields.Title || '', field: 'row', detail: `${rowBytes} > ${rowCap}` }]);
  writeAtomic(backlogAbs, loc.lines.join('\n'));
  return { id: input.id, paths_written: [rel(repo, backlogAbs)], info_lines: [] };
}

function backlogClose(repo, input, opts) {
  const o = opts || {};
  const how = input.how;
  if (!['done', 'cancelled', 'superseded'].includes(how)) throw new RecordError('bad_close', `close how must be done|cancelled|superseded, got ${how}`);
  if (how === 'superseded' && (input.by == null || String(input.by).trim() === '')) throw new RecordError('missing_by', 'close superseded needs --by <ref>');
  const cfg = gateConfig(repo);
  const backlogAbs = backlogFile(repo);
  const text = fs.readFileSync(backlogAbs, 'utf8');
  const loc = locateRow(text, input.id);
  const fields = rowFields(loc, text, cfg);
  rules.assertPeerClosable(fields);
  const written = [rel(repo, backlogAbs)];
  const info = [];
  if (how === 'cancelled') {
    const i = lineIndex(loc, 'Status');
    if (i < 0) throw new RecordError('no_status_field', `${input.id} has no Status line`);
    const cr = loc.lines[i].endsWith('\r') ? '\r' : '';
    loc.lines[i] = `- **Status**: dropped ${today(o)}${cr}`;
    writeAtomic(backlogAbs, loc.lines.join('\n'));
    return { id: input.id, paths_written: written, info_lines: info };
  }
  const remaining = joinTrim(loc.lines.slice(0, loc.start).concat(loc.lines.slice(loc.end)));
  writeAtomic(backlogAbs, remaining);
  // A sidecar lives only while a row points at it (Done handling in references/backlog-entry.md).
  const ptr = String(fields.Pointer || '').trim();
  if (ptr && ptr.toLowerCase() !== 'none') {
    const abs = path.resolve(repo, ptr.replace(/^\.\/+/, ''));
    if (path.dirname(abs) === path.resolve(sidecarDir(backlogAbs)) && abs.endsWith('.md') && abs !== path.resolve(backlogAbs)
      && fs.existsSync(abs) && !gate.mentionsBasename(remaining, path.basename(abs))) {
      fs.rmSync(abs);
      written.push(rel(repo, abs));
    }
  }
  if (how === 'superseded') info.push(`superseded by ${String(input.by).trim()}`);
  return { id: input.id, paths_written: written, info_lines: info };
}

// ---- decisions (the ledger is the only files-mode store) -----------------------------------------------

function defaultLedger(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) throw new RecordError('no_ledger', 'not in a git repository and no ledger path given');
  return path.join(fs.realpathSync(r.stdout.trim()), 'autopilot', 'ledger', 'decisions.jsonl');
}

function decisionWrite(repo, input, opts, supersedes) {
  const o = opts || {};
  if (input.ledgerRow != null && String(input.ledgerRow).trim() !== '') {
    const row = String(input.ledgerRow).trim();
    return { id: row, paths_written: [], info_lines: [`record store: files; ledger row ${row} is the decision`] };
  }
  const title = String(input.title || '').trim();
  const rationale = String(input.rationale || '').trim();
  if (!title) throw new RecordError('missing_title', 'decision needs a title');
  if (!rationale) throw new RecordError('missing_rationale', 'decision needs a rationale');
  const id = `dec-${crypto.createHash('sha256').update(`${title}\n${today(o)}`, 'utf8').digest('hex').slice(0, 12)}`;
  const row = { decision_id: id, title, rationale, source: 'project-record' };
  if (input.area) row.area = String(input.area);
  if (supersedes) row.supersedes = supersedes;
  const ledger = o.ledger || defaultLedger(repo);
  const r = spawnSync(process.execPath, [LEDGER_CLI, 'append', '--ledger', ledger, '--kind', 'decision', '--json', JSON.stringify(row)], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new RecordError('ledger_append_failed', `decision-ledger.js append exited ${r.status}: ${String(r.stderr || '').trim()}`);
  return { id, paths_written: [], info_lines: ['record store: files; decision kept in the ledger only'], ledger };
}

function decisionNew(repo, input, opts) {
  return decisionWrite(repo, input, opts, null);
}

function decisionSupersede(repo, input, opts) {
  const old = String(input.old || '').trim();
  if (!old) throw new RecordError('missing_old', 'decision supersede needs the old decision');
  return decisionWrite(repo, input, opts, old);
}

// ---- ADR ----------------------------------------------------------------------------------------------

function adrDirOf(repo, opts) {
  const d = opts && opts.adrDir;
  if (!d) throw new RecordError('no_adr_dir', 'no ADR directory given (no resolver field names one yet); pass opts.adrDir');
  return path.join(repo, d);
}

function adrNumber(v) {
  const m = String(v).match(/^(?:ADR-)?0*(\d+)$/i);
  if (!m) throw new RecordError('bad_adr_ref', `not an ADR number: ${v}`);
  return Number(m[1]);
}
const adrNo = (n) => String(n).padStart(4, '0');

function adrFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /^\d{4}-.*\.md$/.test(f)).sort();
  } catch {
    return [];
  }
}

function adrBody(input) {
  if (input.body != null && String(input.body).trim() !== '') return String(input.body).trim();
  const parts = [['Context', input.context], ['Decision', input.decision], ['Consequences', input.consequences]];
  for (const [name, v] of parts) if (v == null || String(v).trim() === '') throw new RecordError('missing_adr_body', `ADR needs a body or ${name}`);
  return parts.map(([name, v]) => `## ${name}\n${String(v).trim()}`).join('\n\n');
}

function adrWriteNew(repo, input, opts, supersedes) {
  const o = opts || {};
  const title = String(input.title || '').trim();
  if (!title) throw new RecordError('missing_title', 'ADR needs a title');
  const body = adrBody(input);
  const dir = adrDirOf(repo, o);
  const files = adrFiles(dir);
  const last = files.length ? Number(files[files.length - 1].slice(0, 4)) : 0;
  const no = adrNo(last + 1);
  const status = input.status === 'open' ? 'Proposed' : 'Accepted';
  const head = [`# ADR-${no} — ${title}`, '', `- **Status**: ${status} (${today(o)})`];
  if (supersedes) head.push(`- **Supersedes**: ADR-${adrNo(supersedes)}`);
  const file = path.join(dir, `${no}-${slugify(title, 'adr')}.md`);
  return { no, file, text: `${head.join('\n')}\n\n${body}\n` };
}

function adrNew(repo, input, opts) {
  const w = adrWriteNew(repo, input, opts, null);
  writeAtomic(w.file, w.text);
  return { id: w.no, paths_written: [rel(repo, w.file)], info_lines: [] };
}

function adrSupersede(repo, input, opts) {
  const oldNo = adrNumber(input.old);
  const dir = adrDirOf(repo, opts);
  const oldName = adrFiles(dir).find((f) => Number(f.slice(0, 4)) === oldNo);
  if (!oldName) throw new RecordError('adr_not_found', `no ADR ${adrNo(oldNo)} in ${posix(path.relative(repo, dir))}`);
  const oldFile = path.join(dir, oldName);
  const oldText = fs.readFileSync(oldFile, 'utf8');
  if (!/^- \*\*Status\*\*:.*$/m.test(oldText)) throw new RecordError('no_status_line', `${oldName} has no "- **Status**:" line`);
  const w = adrWriteNew(repo, input, opts, oldNo);
  writeAtomic(w.file, w.text);
  writeAtomic(oldFile, oldText.replace(/^- \*\*Status\*\*:.*$/m, `- **Status**: Superseded by ADR-${w.no}`));
  return { id: w.no, paths_written: [rel(repo, w.file), rel(repo, oldFile)], info_lines: [] };
}

// ---- lesson (knowledge entry + INDEX line; learn/SKILL.md flow steps 3-5) ------------------------------

const CATEGORIES = {
  build: { file: 'build-errors.md', title: 'Build errors' },
  debug: { file: 'debug-patterns.md', title: 'Debug patterns' },
  arch: { file: 'architecture.md', title: 'Architecture' },
  env: { file: 'environment.md', title: 'Environment' },
  api: { file: 'api-patterns.md', title: 'API patterns' },
};
const INDEX_HEAD = '# Knowledge Base\n\n## 最近學習 (Recent)\n\n| 日期 | 類別 | 簡述 | 文件 |\n|------|------|------|------|\n';
const RECENT_MAX = 10;

function cell(s) {
  return String(s).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

function indexWith(text, row) {
  const lines = text.split('\n');
  const head = lines.findIndex((l) => /^\|\s*日期\s*\|/.test(l));
  if (head < 0 || !/^\|\s*-/.test(lines[head + 1] || '')) throw new RecordError('bad_index', 'INDEX.md has no recent-learning table (| 日期 | ... |)');
  const first = head + 2;
  let end = first;
  while (end < lines.length && /^\|/.test(lines[end])) end++;
  const rows = [row].concat(lines.slice(first, end)).slice(0, RECENT_MAX);
  return lines.slice(0, first).concat(rows, lines.slice(end)).join('\n');
}

function lessonNew(repo, input, opts) {
  const o = opts || {};
  const title = String(input.title || '').trim();
  const cat = CATEGORIES[input.category];
  if (!cat) throw new RecordError('bad_category', `category must be ${Object.keys(CATEGORIES).join('|')}`);
  for (const k of ['title', 'context', 'problem', 'solution']) if (input[k] == null || String(input[k]).trim() === '') throw new RecordError(`missing_${k}`, `lesson needs ${k}`);
  const kdir = resolveField('resolve-knowledge-routing.sh', repo, 'knowledge_dir');
  if (!kdir || kdir === 'none') throw new RecordError('no_knowledge_dir', 'knowledge_dir is none for this project');
  const dirAbs = path.isAbsolute(kdir) ? kdir : path.join(repo, kdir);
  const fileAbs = path.join(dirAbs, cat.file);
  const indexAbs = path.join(dirAbs, 'INDEX.md');
  const existing = fs.existsSync(fileAbs) ? fs.readFileSync(fileAbs, 'utf8') : `# ${cat.title}\n`;
  if (existing.split('\n').some((l) => l.trim() === `## ${title}`)) throw new RecordError('duplicate_lesson', `${cat.file} already has "## ${title}"`);
  const d = today(o);
  const entry = [`## ${title}`, `**Date**: ${d} | **Context**: ${String(input.context).trim()}`, `**Problem**: ${String(input.problem).trim()}`, `**Solution**: ${String(input.solution).trim()}`];
  if (input.failedAttempts) entry.push(`**Failed attempts**: ${String(input.failedAttempts).trim()}`);
  if (input.related) entry.push(`**Related**: ${String(input.related).trim()}`);
  const indexRow = `| ${d} | ${input.category} | ${cell(input.summary || title)} | [${cat.file}](${cat.file}) |`;
  const indexText = indexWith(fs.existsSync(indexAbs) ? fs.readFileSync(indexAbs, 'utf8') : INDEX_HEAD, indexRow);
  writeAtomic(fileAbs, `${existing.replace(/\n*$/, '')}\n\n${entry.join('\n')}\n`);
  writeAtomic(indexAbs, indexText);
  return { id: title, paths_written: [rel(repo, fileAbs), rel(repo, indexAbs)], info_lines: [] };
}

// ---- handoff (skills/handoff/SKILL.md Write Mode step 3 layout) --------------------------------------

const HANDOFF_SECTIONS = [
  ['目標', '目標', true],
  ['現況', '現況', true],
  ['已決事項', '已決事項(不重議)', false],
  ['下一步', '下一步', true],
  ['驗證方式', '驗證方式', true],
  ['Read-order', 'Read-order', true],
  ['陷阱', '陷阱', false],
];

function parseHandoffBody(body) {
  const out = {};
  let cur = null;
  for (const line of String(body || '').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const sec = HANDOFF_SECTIONS.find(([key]) => h[1].startsWith(key));
      if (!sec) throw new RecordError('unknown_section', `handoff body has an unknown section: ${h[1]}`);
      if (out[sec[0]] != null) throw new RecordError('duplicate_section', `handoff body repeats section ${sec[0]}`);
      cur = sec[0];
      out[cur] = [];
    } else if (cur) out[cur].push(line);
    else if (line.trim()) throw new RecordError('stray_text', 'handoff body has text before its first "## " section');
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  return out;
}

function bullet(text) {
  const t = String(text).trim();
  if (/^-\s/.test(t) && !/\n/.test(t)) return t;
  return `- ${t.split('\n').map((l) => l.trim()).filter(Boolean).join(' — ')}`;
}

function handoffNew(repo, input, opts) {
  void opts;
  const project = String(input.project || '').trim();
  if (!project || project.includes('/') || project.includes('\\') || project === '.' || project === '..') throw new RecordError('bad_project', `project must be one directory name, got "${project}"`);
  const pdir = needDir(repo, 'projects_dir');
  const dir = path.join(path.isAbsolute(pdir) ? pdir : path.join(repo, pdir), project);
  if (!fs.existsSync(dir)) throw new RecordError('no_project_dir', `no project directory ${rel(repo, dir)}; a handoff does not create one`);
  const secs = parseHandoffBody(input.body);
  for (const [key, , required] of HANDOFF_SECTIONS) if (required && !secs[key]) throw new RecordError('missing_section', `handoff body needs a non-empty "## ${key}" section`);
  const extra = (list) => (list || []).map(bullet);
  const decisions = (secs['已決事項'] ? [secs['已決事項']] : []).concat(extra(input.decisions));
  const lessons = (secs['陷阱'] ? [secs['陷阱']] : []).concat(extra(input.lessons));
  const text = HANDOFF_SECTIONS.map(([key, heading]) => {
    let content = secs[key];
    if (key === '已決事項') content = decisions.join('\n') || '- 無';
    if (key === '陷阱') content = lessons.join('\n') || '- 無';
    return `## ${heading}\n${content}`;
  }).join('\n\n') + '\n';
  const file = path.join(dir, 'HANDOFF.md');
  const info = fs.existsSync(file) ? [`replaced existing ${rel(repo, file)}`] : [];
  writeAtomic(file, text);
  return { id: rel(repo, file), paths_written: [rel(repo, file)], info_lines: info };
}

function handoffClose(repo, input, opts) {
  void opts;
  const abs = path.resolve(repo, String(input.path || ''));
  const inside = path.relative(path.resolve(repo), abs);
  if (!input.path || inside.startsWith('..') || path.isAbsolute(inside)) throw new RecordError('bad_path', `handoff path is outside the repo: ${input.path}`);
  if (!/^HANDOFF.*\.md$/.test(path.basename(abs))) throw new RecordError('bad_path', `not a HANDOFF file: ${input.path}`);
  if (!fs.existsSync(abs)) throw new RecordError('handoff_not_found', `no such handoff: ${input.path}`);
  fs.rmSync(abs);
  return { id: posix(inside), paths_written: [posix(inside)], info_lines: [] };
}

module.exports = {
  RecordError, RuleViolationError,
  backlogNew, backlogReply, backlogClose,
  decisionNew, decisionSupersede,
  adrNew, adrSupersede,
  lessonNew,
  handoffNew, handoffClose,
  CATEGORIES,
  // shared with scripts/project-record.js so hippo mode validates exactly what files mode would write
  gateConfig, parseHandoffBody, HANDOFF_SECTIONS,
};
