#!/usr/bin/env node
'use strict';
// scripts/project-record.js - the one writer of autopilot's project records (plan 2026-11-02-oc-a3-writers-use-hippo, A3.1 step 2).
//
//   node scripts/project-record.js [--target <dir>] [--key <k>] [--json] <subcommand> [flags]
//
//   backlog new   --title T --trigger S --trigger-type TT --effort E --origin O --source S (--problem S|--problem-file F|--problem -)
//                 --impact S [--type bug|feature|debt|question|chore] [--reporter R --report M --reply R] [--pointer P]
//                 [--context C|--context-file F] [--relates ULID]...
//   backlog reply <id> --reply "<date> <ptr>"            backlog close <id> done|cancelled|superseded [--commit SHA] [--by REF]
//   decision new  --title T --rationale-file F|- [--ledger-row ID] [--area A] [--relates ULID]... [--decides ULID]...
//   decision supersede <old> <same flags>                adr new --title T --body-file F|- [--status active|open] [--adr-dir D]
//   adr supersede <old> <same flags>                     lesson new --title T --category build|debug|arch|env|api --body-file F|-
//   handoff new   --title T --area PROJECT --body-file F|- [--decision-file F]... [--lesson-file F]...
//   handoff close <id>                                   where                         flush [--drop <spool key>]
//
// A lesson body has "## Context", "## Problem", "## Solution" sections (optional "## Failed attempts", "## Related").
// <id> is a full 26-character ULID where the target has a hippo store (C7) and the file-native id (BL-NNNN, ADR number,
// handoff path) where it has none. Where `hippo detect` says `files` (no .hippo/repo.toml) this script writes today's files via
// lib/record-files.js; in `hippo`/`hippo-problems` it writes through the hippo CLI (lib/hippo.js step runner); in `spool` (binary
// missing, exit 5) it saves the write under <git common dir>/autopilot/hippo-spool. The state is decided by detect alone: with a store
// present nothing here ever writes a file-mode target, whatever hippo answers (a refusal exits non-zero, a missing binary spools).
//
// Exit: 0 ok (incl. spooled) | 1 internal or file-mode refusal | 2 usage (unknown flag, bad target, plugin dir) | 3 rule refusal
// (backlog-entry rules, validation, hippo rules incl. leak) | 4 not found | 5 store unavailable and not spoolable. Hippo's code is kept.
// Test hooks: PROJECT_RECORD_FAULT (lib/hippo.js), PROJECT_RECORD_NOW (ISO instant used as "now").

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const hippo = require('./lib/hippo.js');
const rules = require('./lib/backlog-rules.js');
const rf = require('./lib/record-files.js');

const { HippoError } = hippo;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const KEY_RE = /^[0-9a-f]{16}$/;
const AREA_RE = /^[a-z0-9][a-z0-9._-]*$/;
const TYPES = ['bug', 'feature', 'debt', 'question', 'chore'];
const DEFAULT_ADR_DIR = 'docs/dev/adr';
const COUNTER_RE = /^(count|hits|uses|views)$/;

// ---- errors ----------------------------------------------------------------------------------------------------------

function usage(message) { return new HippoError(message, 2, 'usage'); }

function refuse(rule, field, detail) {
  return new rules.RuleViolationError([{ code: rule, title: '', field, detail }], `${rule} (${field}): ${detail}`);
}

// A hippo read made while building a plan (show) answered non-zero.
class HippoRefusal extends Error {
  constructor(r) { super(r.error.message); this.exit = r.exit; this.error = r.error; }
}

// ---- argument parsing (closed flag lists: an unknown flag exits 2) -----------------------------------------------------

const GLOBAL = { target: 'v', key: 'v', json: 'b' };
const BACKLOG_NEW = { title: 'v', trigger: 'v', 'trigger-type': 'v', effort: 'v', origin: 'v', source: 'v', problem: 'v', 'problem-file': 'v', impact: 'v',
  type: 'v', reporter: 'v', report: 'v', reply: 'v', pointer: 'v', context: 'v', 'context-file': 'v', relates: '+' };
const DECISION = { title: 'v', 'rationale-file': 'v', 'ledger-row': 'v', area: 'v', relates: '+', decides: '+' };
const ADR = { title: 'v', 'body-file': 'v', status: 'v', 'adr-dir': 'v' };
const SUBS = {
  'backlog new': { f: BACKLOG_NEW, pos: [0, 0] },
  'backlog reply': { f: { reply: 'v' }, pos: [1, 3] },
  'backlog close': { f: { commit: 'v', by: 'v' }, pos: [2, 2] },
  'decision new': { f: DECISION, pos: [0, 0] },
  'decision supersede': { f: DECISION, pos: [1, 1] },
  'adr new': { f: ADR, pos: [0, 0] },
  'adr supersede': { f: ADR, pos: [1, 1] },
  'lesson new': { f: { title: 'v', category: 'v', 'body-file': 'v' }, pos: [0, 0] },
  'handoff new': { f: { title: 'v', area: 'v', 'body-file': 'v', 'decision-file': '+', 'lesson-file': '+' }, pos: [0, 0] },
  'handoff close': { f: {}, pos: [1, 1] },
  where: { f: {}, pos: [0, 0] },
  flush: { f: { drop: 'v' }, pos: [0, 0] },
};
const TWO_WORD = new Set(['backlog', 'decision', 'adr', 'lesson', 'handoff']);

function parseArgs(argv) {
  const g = { json: false };
  const f = {};
  const words = [];
  const pos = [];
  let cmd = null;
  let spec = null;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--') && t.length > 2) {
      const name = t.slice(2);
      const kind = GLOBAL[name] || (spec && spec.f[name]);
      if (!kind) throw usage(COUNTER_RE.test(name) ? `--${name}: no counter fields exist (usage counters never go to git)` : `unknown flag: ${t}`);
      if (kind === 'b') { g.json = true; continue; }
      if (i + 1 >= argv.length) throw usage(`${t} needs a value`);
      const v = argv[++i];
      const into = GLOBAL[name] ? g : f;
      if (kind === '+') (into[name] = into[name] || []).push(v);
      else if (into[name] !== undefined) throw usage(`${t} given twice`);
      else into[name] = v;
    } else if (!cmd) {
      words.push(t);
      if (words.length === 1 && !TWO_WORD.has(t)) cmd = t;
      else if (words.length === 2) cmd = `${words[0]} ${words[1]}`;
      if (cmd) {
        spec = SUBS[cmd];
        if (!spec) throw usage(`unknown subcommand: ${cmd}`);
      }
    } else pos.push(t);
  }
  if (!cmd) throw usage('usage: project-record.js [--target <dir>] [--key <k>] [--json] backlog|decision|adr|lesson|handoff <new|...> | where | flush');
  if (pos.length < spec.pos[0] || pos.length > spec.pos[1]) throw usage(`${cmd}: expected ${spec.pos[0] === spec.pos[1] ? spec.pos[0] : `${spec.pos[0]}..${spec.pos[1]}`} positional argument(s), got ${pos.length}`);
  if (g.key !== undefined && !KEY_RE.test(g.key)) throw usage('--key must be 16 lowercase hex characters');
  return { cmd, g, f, pos };
}

// ---- input helpers ---------------------------------------------------------------------------------------------------

let stdinUsed = false;
function readStdin() {
  if (stdinUsed) throw usage('stdin (-) can be read only once per run');
  stdinUsed = true;
  return fs.readFileSync(0, 'utf8');
}

function readFileArg(file) {
  if (file === '-') return readStdin();
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw usage(`cannot read ${file}: ${e.code || e.message}`); }
}

const trimEnd = (s) => String(s).replace(/\s+$/, '');

// --name <s> (or "-" for stdin) or --name-file <f>
function textOpt(f, name) {
  const a = f[name];
  const b = f[`${name}-file`];
  if (a !== undefined && b !== undefined) throw usage(`give --${name} or --${name}-file, not both`);
  if (a !== undefined) return trimEnd(a === '-' ? readStdin() : a);
  if (b !== undefined) return trimEnd(readFileArg(b));
  return undefined;
}

function fileOpt(f, name) {
  return f[name] === undefined ? undefined : readFileArg(f[name]);
}

function need(v, flag) {
  if (v === undefined || String(v).trim() === '') throw refuse('missing-required', flag, `--${flag} is required`);
  return v;
}

function oneLine(v, flag) {
  const s = String(need(v, flag)).trim();
  if (/[\r\n]/.test(s)) throw refuse('invalid-value', flag, 'must be a single line');
  return s;
}

function areaOf(v, flag) {
  const a = String(need(v, flag)).trim();
  if (!AREA_RE.test(a)) throw refuse('invalid-value', flag, `${a} (lower-case letters, digits, . _ - only)`);
  return a;
}

function ulids(list, flag) {
  for (const x of list || []) if (!ULID_RE.test(x)) throw refuse('invalid-value', flag, `${x} (a full 26-character record id is required)`);
  return list || [];
}

function ulidArg(v, what) {
  if (!ULID_RE.test(v)) throw usage(`${what}: this repo has a hippo store; pass the full 26-character record id (got "${v}")`);
  return v;
}

function nowDate() {
  const n = process.env.PROJECT_RECORD_NOW;
  return n ? new Date(n) : new Date();
}
const clock = () => nowDate();
const todayStr = () => nowDate().toISOString().slice(0, 10);

function bullets(body) {
  const out = {};
  for (const line of String(body || '').split('\n')) {
    const m = line.match(/^- \*\*([^*]+)\*\*:\s?(.*)$/);
    if (m && out[m[1]] === undefined) out[m[1]] = m[2];
  }
  return out;
}

function tagValue(tags, prefix) {
  const t = (tags || []).find((x) => x.startsWith(prefix));
  return t ? t.slice(prefix.length) : null;
}

function showRecord(repo, id) {
  const r = hippo.run(repo, ['show', id]);
  if (r.exit !== 0) throw new HippoRefusal(r);
  return r.data.record;
}

function sha40(repo, ref) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { encoding: 'utf8' });
  const sha = (r.stdout || '').trim();
  if (r.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) throw refuse('invalid-value', 'commit', `${ref} (not a commit in ${repo})`);
  return sha;
}

// ---- validation + plan builders, one per subcommand ---------------------------------------------------------------------
// Each handler: parse(f, pos) -> input (validated, no I/O on the target), files(repo, input) -> rf result,
// plan(repo, input, key) -> {key, steps}. `needsRead` handlers build the plan from a `show` and cannot be spooled.

const fmtWarn = (w) => `warning: ${w.code} (${w.field}): ${w.detail}`;

function effortTags(effort) {
  const e = rules.parseEffortValue(effort);
  return [`effort:${e.size.toLowerCase()}`].concat(e.urgent ? ['urgent'] : []);
}

function triggerTag(tt) {
  return `trigger:${String(tt).trim().replace(/^date:/, 'date-')}`;
}

function reporterTag(reporter) {
  const first = String(reporter).trim().split(/[\s；]+/)[0];
  const who = first.includes('/') ? first.split('/').pop() : first;
  const t = who.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return t ? `reporter:${t}` : null;
}

const H = {};

H['backlog new'] = {
  parse(f) {
    const type = f.type === undefined ? 'debt' : f.type;
    if (!TYPES.includes(type)) throw refuse('invalid-value', 'type', `${type} (expected ${TYPES.join('|')})`);
    const input = {
      title: f.title, trigger: f.trigger, triggerType: f['trigger-type'], effort: f.effort, origin: f.origin, source: f.source,
      problem: textOpt(f, 'problem'), impact: f.impact, reporter: f.reporter, report: f.report, reply: f.reply, pointer: f.pointer,
      context: textOpt(f, 'context'),
    };
    return { input, type, relates: ulids(f.relates, 'relates') };
  },
  validate(repo, p, state) {
    const inp = Object.assign({}, p.input);
    if (inp.pointer == null || String(inp.pointer).trim() === '') inp.pointer = 'none';
    if (String(inp.origin || '').trim() === 'peer' && (inp.reply == null || String(inp.reply).trim() === '')) inp.reply = 'none';
    const proposed = Object.assign({ status: 'open', since: todayStr() }, inp, { id: 'BL-0000' }); // the id is not written in hippo mode
    const v = rules.assertProposedValid(proposed, { cfg: rf.gateConfig(repo), repoRoot: repo, now: nowDate().getTime(), existingTitles: [] });
    void state;
    return v;
  },
  files(repo, p) {
    const r = rf.backlogNew(repo, p.input, { clock });
    return p.relates.length ? Object.assign(r, { info_lines: r.info_lines.concat(['files mode keeps no relations; --relates was not recorded']) }) : r;
  },
  plan(repo, p, key, v) {
    const fl = v.fields;
    const tags = [`origin:${fl.Origin.toLowerCase()}`].concat(effortTags(fl.Effort), [triggerTag(fl['Trigger-Type'])]);
    const rt = fl.Reporter ? reporterTag(fl.Reporter) : null;
    if (rt) tags.push(rt);
    const argv = ['--title', fl.Title, '--type', p.type, '--status', 'open'];
    for (const t of tags) argv.push('--tag', t);
    const body = ['Since', 'Report', 'Reply', 'Problem', 'Impact', 'Trigger', 'Source', 'Pointer', 'Context']
      .filter((n) => fl[n] != null).map((n) => `- **${n}**: ${fl[n]}`).join('\n') + '\n';
    const steps = [{ op: 'create', ref: 'root', kind: 'issue', argv, body, key }];
    for (const id of p.relates) steps.push({ op: 'link', from: 'root', rel: 'relates_to', to: id, leak_ok: false });
    // reported_by needs a full fleet address as Reporter and a ULID message id as Report; otherwise the id stays in the body only
    if (fl.Reporter && /^[^/\s]+\/[^/\s]+\/[^/\s]+$/.test(fl.Reporter) && ULID_RE.test(fl.Report || '')) {
      steps.push({ op: 'link', from: 'root', rel: 'reported_by', to: `fleet:${fl.Reporter}#${fl.Report}`, leak_ok: true });
    }
    return { key, steps };
  },
};

H['backlog reply'] = {
  needsRead: true,
  parse(f, pos) {
    const parts = [need(f.reply, 'reply')].concat(pos.slice(1));
    return { id: pos[0], reply: parts.join(' ').trim() };
  },
  files(repo, p) { return rf.backlogReply(repo, { id: p.id, reply: p.reply }, { clock }); },
  plan(repo, p, key) {
    const rec = showRecord(repo, ulidArg(p.id, 'backlog reply'));
    const b = bullets(rec.body);
    const bad = [];
    if (!p.reply || /[\r\n]/.test(p.reply)) bad.push({ code: 'bad_reply', title: '', field: 'Reply', detail: `${p.reply || '(empty)'} (one line: none|unknown|<YYYY-MM-DD> <msg id or pointer>)` });
    else for (const part of rules.splitMulti(p.reply)) if (!rules.replyOk(part)) bad.push({ code: 'bad_reply', title: '', field: 'Reply', detail: `${part} (expected none|unknown|<YYYY-MM-DD> <msg id or pointer>)` });
    if (!bad.length && tagValue(rec.tags, 'origin:') === 'peer' && rules.splitMulti(p.reply).length !== rules.splitMulti(b.Report).length) {
      bad.push({ code: 'peer_field_missing', title: rec.title, field: 'Reply', detail: `Report has ${rules.splitMulti(b.Report).length} part(s), Reply ${rules.splitMulti(p.reply).length}; one ${rules.MULTI_SEP}-separated value per reporter` });
    }
    if (bad.length) throw new rules.RuleViolationError(bad);
    if (b.Reply === undefined) throw new rf.RecordError('no_reply_field', `${rec.id} has no Reply line (not a peer record)`);
    const lines = String(rec.body).split('\n').map((l) => (/^- \*\*Reply\*\*:/.test(l) ? `- **Reply**: ${p.reply}` : l));
    return { key, steps: [{ op: 'edit', id: rec.id, body: lines.join('\n') }] };
  },
};

H['backlog close'] = {
  needsRead: true,
  parse(f, pos) {
    const how = pos[1];
    if (!['done', 'cancelled', 'superseded'].includes(how)) throw usage(`backlog close: how must be done|cancelled|superseded, got ${how}`);
    return { id: pos[0], how, by: f.by, commit: f.commit };
  },
  files(repo, p) { return rf.backlogClose(repo, { id: p.id, how: p.how, by: p.by, commit: p.commit }, { clock }); },
  plan(repo, p, key) {
    if (p.how === 'superseded' && (p.by === undefined || p.by.trim() === '')) throw new rf.RecordError('missing_by', 'close superseded needs --by <ref>');
    const rec = showRecord(repo, ulidArg(p.id, 'backlog close'));
    const b = bullets(rec.body);
    rules.assertPeerClosable({ Title: rec.title, Origin: tagValue(rec.tags, 'origin:') || '', Report: b.Report, Reply: b.Reply });
    const steps = [{ op: 'close', id: rec.id, status: p.how }];
    const info = [];
    if (p.commit !== undefined) steps.push({ op: 'link', from: rec.id, rel: 'implemented_by', to: `git:${sha40(repo, p.commit)}`, leak_ok: false });
    if (p.by !== undefined) {
      if (ULID_RE.test(p.by)) steps.push({ op: 'link', from: rec.id, rel: 'relates_to', to: p.by, leak_ok: false });
      else info.push(`${p.how === 'superseded' ? 'superseded by' : 'closed with'} ${p.by.trim()}`);
    }
    return { key, steps, info };
  },
};

function decisionParse(f, pos) {
  const rationale = fileOpt(f, 'rationale-file');
  return {
    old: pos ? pos[0] : undefined,
    title: oneLine(f.title, 'title'),
    rationale: trimEnd(need(rationale, 'rationale-file')),
    ledgerRow: f['ledger-row'] === undefined ? undefined : oneLine(f['ledger-row'], 'ledger-row'),
    area: f.area === undefined ? undefined : areaOf(f.area, 'area'),
    relates: ulids(f.relates, 'relates'),
    decides: ulids(f.decides, 'decides'),
  };
}

function decisionKey(p) {
  return p.ledgerRow ? crypto.createHash('sha256').update(p.ledgerRow, 'utf8').digest('hex').slice(0, 16) : null;
}

function decisionPlan(kind, p, key, supersede) {
  const argv = ['--title', p.title, '--status', 'active'];
  if (p.area) argv.push('--area', p.area);
  const steps = [{ op: 'create', ref: 'root', kind, argv, body: `${p.rationale}\n`, key }];
  for (const id of p.relates || []) steps.push({ op: 'link', from: 'root', rel: 'relates_to', to: id, leak_ok: false });
  for (const id of p.decides || []) steps.push({ op: 'link', from: id, rel: 'decided_by', to: 'root', leak_ok: false });
  if (supersede) {
    steps.push({ op: 'link', from: 'root', rel: 'supersedes', to: ulidArg(p.old, `${kind} supersede`), leak_ok: false });
    steps.push({ op: 'close', id: p.old, status: 'superseded' });
  }
  return { key, steps };
}

H['decision new'] = {
  parse: (f) => decisionParse(f),
  key: decisionKey,
  files(repo, p) {
    const r = rf.decisionNew(repo, { title: p.title, rationale: p.rationale, ledgerRow: p.ledgerRow, area: p.area }, { clock });
    return p.relates.length || p.decides.length ? Object.assign(r, { info_lines: r.info_lines.concat(['files mode keeps no relations; --relates/--decides were not recorded']) }) : r;
  },
  plan: (repo, p, key) => decisionPlan('decision', p, key, false),
};

H['decision supersede'] = {
  parse: (f, pos) => decisionParse(f, pos),
  key: decisionKey,
  files(repo, p) { return rf.decisionSupersede(repo, { old: p.old, title: p.title, rationale: p.rationale, ledgerRow: p.ledgerRow, area: p.area }, { clock }); },
  plan: (repo, p, key) => decisionPlan('decision', p, key, true),
};

function adrParse(f, pos) {
  const status = f.status === undefined ? 'active' : f.status;
  if (!['active', 'open'].includes(status)) throw refuse('invalid-value', 'status', `${status} (expected active|open)`);
  return {
    old: pos ? pos[0] : undefined, title: oneLine(f.title, 'title'), rationale: trimEnd(need(fileOpt(f, 'body-file'), 'body-file')), status,
    adrDir: f['adr-dir'] || DEFAULT_ADR_DIR, relates: [], decides: [],
  };
}

function adrFilesInput(p) { return { title: p.title, body: p.rationale, status: p.status }; }

H['adr new'] = {
  parse: (f) => adrParse(f),
  files: (repo, p) => rf.adrNew(repo, adrFilesInput(p), { clock, adrDir: p.adrDir }),
  plan(repo, p, key) {
    const pl = decisionPlan('adr', p, key, false);
    pl.steps[0].argv[3] = p.status;
    return pl;
  },
};

H['adr supersede'] = {
  parse: (f, pos) => adrParse(f, pos),
  files: (repo, p) => rf.adrSupersede(repo, Object.assign({ old: p.old }, adrFilesInput(p)), { clock, adrDir: p.adrDir }),
  plan(repo, p, key) {
    const pl = decisionPlan('adr', p, key, true);
    pl.steps[0].argv[3] = p.status;
    return pl;
  },
};

const LESSON_SECTIONS = { context: 'Context', problem: 'Problem', solution: 'Solution', 'failed attempts': 'failedAttempts', related: 'related' };

function parseLessonBody(body) {
  const out = {};
  let cur = null;
  for (const line of String(body).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      const key = LESSON_SECTIONS[h[1].toLowerCase()];
      if (!key) throw refuse('invalid-value', 'body-file', `unknown lesson section "${h[1]}" (Context, Problem, Solution, Failed attempts, Related)`);
      cur = key === 'Context' ? 'context' : key === 'Problem' ? 'problem' : key === 'Solution' ? 'solution' : key;
      out[cur] = [];
    } else if (cur) out[cur].push(line);
    else if (line.trim()) throw refuse('invalid-value', 'body-file', 'text before the first "## " section');
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
  for (const k of ['context', 'problem', 'solution']) if (!out[k]) throw refuse('missing-required', 'body-file', `lesson body needs a non-empty "## ${k[0].toUpperCase()}${k.slice(1)}" section`);
  return out;
}

H['lesson new'] = {
  parse(f) {
    const category = need(f.category, 'category');
    if (!rf.CATEGORIES[category]) throw refuse('invalid-value', 'category', `${category} (expected ${Object.keys(rf.CATEGORIES).join('|')})`);
    const body = trimEnd(need(fileOpt(f, 'body-file'), 'body-file'));
    return { title: oneLine(f.title, 'title'), category, body, parts: parseLessonBody(body) };
  },
  files: (repo, p) => rf.lessonNew(repo, Object.assign({ title: p.title, category: p.category }, p.parts), { clock }),
  plan: (repo, p, key) => ({ key, steps: [{ op: 'create', ref: 'root', kind: 'lesson', argv: ['--title', p.title, '--area', p.category, '--status', 'active'], body: `${p.body}\n`, key }] }),
};

function childTitle(text, flag) {
  const first = String(text).split('\n').map((l) => l.replace(/^[\s#>*-]+/, '').trim()).find(Boolean);
  if (!first) throw refuse('missing-required', flag, 'the file has no text to take a title from');
  return first.length > 100 ? first.slice(0, 100).trim() : first;
}

H['handoff new'] = {
  parse(f) {
    const body = trimEnd(need(fileOpt(f, 'body-file'), 'body-file'));
    let secs;
    try { secs = rf.parseHandoffBody(body); } catch (e) { throw refuse(e.rule || 'invalid-value', 'body-file', e.message); }
    for (const [key, , required] of rf.HANDOFF_SECTIONS) if (required && !secs[key]) throw refuse('missing-required', 'body-file', `handoff body needs a non-empty "## ${key}" section`);
    return {
      title: oneLine(f.title, 'title'), area: oneLine(f.area, 'area'), body,
      decisions: (f['decision-file'] || []).map((x) => trimEnd(readFileArg(x))),
      lessons: (f['lesson-file'] || []).map((x) => trimEnd(readFileArg(x))),
    };
  },
  files(repo, p) { return rf.handoffNew(repo, { project: p.area, body: p.body, decisions: p.decisions, lessons: p.lessons }, { clock }); },
  plan(repo, p, key) {
    const area = areaOf(p.area, 'area');
    const steps = [{ op: 'create', ref: 'root', kind: 'handoff-note', argv: ['--title', p.title, '--area', area, '--status', 'open'], body: `${p.body}\n`, key }];
    let n = 0;
    const child = (kind, text, flag, extra) => {
      n++;
      steps.push({ op: 'create', ref: `c${n}`, kind, argv: ['--title', childTitle(text, flag), '--area', area].concat(extra), body: `${text}\n`, key: `${key}.${n}` });
      steps.push({ op: 'link', from: `c${n}`, rel: 'relates_to', to: 'root', leak_ok: false });
    };
    for (const t of p.decisions) child('decision', t, 'decision-file', ['--status', 'active']);
    for (const t of p.lessons) child('lesson', t, 'lesson-file', ['--status', 'active']);
    return { key, steps };
  },
};

H['handoff close'] = {
  parse: (f, pos) => ({ id: pos[0] }),
  files: (repo, p) => rf.handoffClose(repo, { path: p.id }, { clock }),
  plan: (repo, p, key) => ({ key, steps: [{ op: 'close', id: ulidArg(p.id, 'handoff close'), status: 'done' }] }),
};

// ---- output ------------------------------------------------------------------------------------------------------------

function out(s) { process.stdout.write(`${s}\n`); }
function err(s) { process.stderr.write(`${s}\n`); }

function display(id) { return id.slice(-8).toLowerCase(); }

function emitJson(g, doc) { if (g.json) out(JSON.stringify(doc)); }

// ---- the write flow -----------------------------------------------------------------------------------------------------

function filesMode(g, cmd, handler, p, det) {
  err(`record store: files (${det.reason})`);
  if (handler.validate) handler.validate(det.repo_root, p, 'files'); // before any file is touched; backlogNew validates again itself
  const r = handler.files(det.repo_root, p);
  for (const l of r.info_lines) err(l);
  if (g.json) emitJson(g, { ok: true, state: 'files', id: r.id, paths_written: r.paths_written, info_lines: r.info_lines });
  else { out(`${cmd}: ${r.id}`); for (const w of r.paths_written) out(`wrote ${w}`); }
  return 0;
}

function spoolIt(g, repo, cmd, plan, key, reason, state) {
  const { file } = hippo.spoolWrite(repo, { subcommand: cmd, plan, key });
  const n = hippo.spoolList(repo).length;
  err(hippo.spoolWarning(reason, n));
  if (g.json) emitJson(g, { ok: true, state, spooled: true, key, spool_file: path.basename(file), id: null });
  else out(`spooled ${path.basename(file)} (key ${key})`);
  return 0;
}

function hippoMode(g, cmd, handler, p, det) {
  const repo = det.repo_root;
  const state = det.state;
  err(`record store: ${state} (${det.reason})`);
  for (const l of det.problems) err(l);
  if (state !== 'spool') hippo.flush(repo); // replays this worktree's spooled writes first
  const v = handler.validate ? handler.validate(repo, p, state) : null;
  if (v) for (const w of v.warnings) err(fmtWarn(w));
  const key = g.key || (handler.key && handler.key(p)) || crypto.randomBytes(8).toString('hex');
  if (state === 'spool' && handler.needsRead) {
    throw new HippoError(`${cmd} reads the existing record before it writes, so it cannot be spooled: ${det.reason}; retry once hippo works`, 5, 'environment');
  }
  err(`record key: ${key} (retry with --key ${key})`);
  const plan = handler.plan(repo, p, key, v);
  if (state === 'spool') return spoolIt(g, repo, cmd, plan, key, det.reason, state);
  const res = hippo.execute(repo, plan);
  if (!res.ok && res.spool) return spoolIt(g, repo, cmd, plan, key, res.reason, state);
  if (!res.ok) {
    const e = res.error;
    err(`refused: exit ${res.exit} ${e.code}${e.rule ? `/${e.rule}` : ''}: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ''}`);
    err(`record key: ${key} (retry with --key ${key} once the cause is fixed; created ids above are kept)`);
    emitJson(g, { ok: false, state, key, exit: res.exit, error: e, ids: res.ids, failed_step: res.failed_step });
    return res.exit;
  }
  const info = plan.info || [];
  for (const l of info) err(l);
  const id = res.ids.root || null;
  if (g.json) emitJson(g, { ok: true, state, key, id, ids: res.ids, created: res.created, skipped: res.skipped, warnings: res.warnings.concat((v ? v.warnings : []).map(fmtWarn)), info_lines: info });
  else if (id) out(`${cmd}: ${id} (display ${display(id)})${res.created.length ? '' : ' (already recorded)'}`);
  else out(`${cmd}: done (${res.created.length} change(s), ${res.skipped.length} already in place)`);
  return 0;
}

function writeCmd(cmd, parsed) {
  const { g, f, pos } = parsed;
  const handler = H[cmd];
  const p = handler.parse(f, pos);
  const det = hippo.detect(g.target);
  if (det.state === 'files') return filesMode(g, cmd, handler, p, det);
  return hippoMode(g, cmd, handler, p, det);
}

function main(argv) {
  const parsed = parseArgs(argv);
  const { cmd, g, f } = parsed;
  if (cmd === 'where') {
    const d = hippo.detect(g.target);
    if (g.json) out(JSON.stringify(d));
    else { out(`record store: ${d.state} (${d.reason})`); for (const l of d.problems) out(l); }
    return 0;
  }
  if (cmd === 'flush') {
    const r = hippo.flush(g.target, { drop: f.drop });
    if (r.replayed.length) err(`flushed ${r.replayed.length} spooled write(s)`);
    if (g.json) out(JSON.stringify(r));
    return r.exit;
  }
  return writeCmd(cmd, parsed);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  if (e instanceof HippoRefusal) {
    err(`refused: exit ${e.exit} ${e.error.code}${e.error.rule ? `/${e.error.rule}` : ''}: ${e.error.message}${e.error.hint ? ` (hint: ${e.error.hint})` : ''}`);
    process.exitCode = e.exit;
  } else if (e instanceof rules.RuleViolationError) {
    err(`project-record: ${e.message}`);
    err(`rule: ${e.rule}`);
    process.exitCode = 3;
  } else if (e instanceof HippoError || e instanceof rf.RecordError) {
    err(`project-record: ${e.message}`);
    process.exitCode = e.exit || e.exitCode || 1;
  } else throw e;
}
