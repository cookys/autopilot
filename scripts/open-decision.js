#!/usr/bin/env node
'use strict';

/**
 * open-decision.js — the "open owner questions" file of a watcher scope (mods P1W W2a-m; contract autopilot.decision/2).
 *
 *   node scripts/open-decision.js open  --question <q> [--background <why>] [--option <label>[::<description>]]...
 *                                       [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] [--not-authorized <why the owner must decide>]
 *                                       [--source <who/where>]
 *                                       [--root-run-id <id>] [--cwd <dir>] [--json]     (prints the new id; --json: {ok,id,file,scope_key})
 *   node scripts/open-decision.js close --id <id> [--root-run-id <id>] [--cwd <dir>]   (answered or withdrawn)
 *   node scripts/open-decision.js show  [--root-run-id <id>] [--json] [--cwd <dir>]    (lists every open question)
 *
 * One file per scope holds ALL open questions of that scope: <git-common-dir>/autopilot/decisions/<scope_key>.json
 * ({schema, root_run_id, repo_identity, project_key, decisions: [...]}), scope_key = project_key, or project_key--<root>
 * (root through the watcher's safeSegment). Each entry: id, question, background, options [{label, description}] | null,
 * recommendation, why, blocks, not_authorized (why the owner must decide, depth-0 may not), source, opened_at, opened_by_session (+ origin, set only by hooks/ask-decision.js).
 * `open` appends one entry and never overwrites another; `close --id` removes exactly that entry (idempotent) and removes
 * the file when the last one goes. The watcher reads the file into the job page / live pane (src/status/decision-input.js).
 * `show` and `close --id` cover EVERY scope file of the project (unbound + each root), since a session's root can change mid-way; `open` writes only the current scope.
 * Scope root: --root-run-id > $AUTOPILOT_ROOT_RUN_ID > this session's marker root > unbound.
 *
 * --option may repeat; none -> options null, one -> usage error (a choice needs at least two). Everything except
 * --question is optional text for the owner; an empty value is stored as null. Writes take a lock and rename atomically.
 * Node built-ins only. This script writes nothing outside the decisions directory.
 * The library functions openDecision / closeDecisionById are also called by hooks/ask-decision.js (depth-0 AskUserQuestion
 * adds an entry with `origin: "ask_user_question"`; mods P1W HOOKQ).
 *
 * Exit: 0 ok (show: at least one open) | 1 show: none open | 2 usage / not a git repo | 4 write failure.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scopeFromCwd } = require('../src/status/project-key');
const { scopeKeyOf, commonDirOf, listScopeFiles, readScopeFile } = require('../src/status/scope-key');
const { withWriteLock } = require('./lib/jsonl-store');

const SCHEMA = 'autopilot.decision/2';
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function usage(message) {
  if (message) process.stderr.write(`open-decision: ${message}\n`);
  process.stderr.write('usage: open-decision.js open --question <q> [--background <why>] [--option <label>[::<description>]]... [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] [--not-authorized <why the owner must decide>] [--source <who/where>] [--root-run-id <id>]\n'
    + '       open-decision.js close --id <id> [--root-run-id <id>]\n       open-decision.js show [--root-run-id <id>] [--json]\n');
  return 2;
}

function parse(argv) {
  const out = { _: [], option: [] };
  const valued = new Set(['question', 'background', 'option', 'recommendation', 'why', 'blocks', 'not-authorized', 'source', 'id', 'root-run-id', 'cwd']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (valued.has(name)) {
      if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
      const v = argv[i + 1]; i += 1;
      if (name === 'option') out.option.push(v); else out[name] = v;
    } else if (name === 'json') out[name] = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

function sessionRoot() {
  const raw = process.env.AUTOPILOT_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.CODEX_THREAD_ID;
  if (!raw) return { root: null, session: null };
  const session = String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  try {
    const dir = process.env.AUTOPILOT_SESSION_MODE_DIR || path.join(os.homedir(), '.autopilot', 'session-mode');
    const m = JSON.parse(fs.readFileSync(path.join(dir, `${session}.json`), 'utf8'));
    const live = m && Date.parse(m.expires_at) > Date.now();
    return { root: live && typeof m.root_run_id === 'string' && m.root_run_id ? m.root_run_id : null, session };
  } catch (_error) {
    return { root: null, session };
  }
}

const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

// A stored entry that can be shown: an id, a question, a parseable opened_at. Anything else is dropped on read.
function validEntry(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' && e.id && typeof e.question === 'string' && e.question;
}

// The open entries of a scope file ([] = none / unreadable / another schema).
function readFile(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && v.schema === SCHEMA && Array.isArray(v.decisions) ? v.decisions.filter(validEntry) : [];
  } catch (_error) {
    return [];
  }
}

function scopeFile(cwd, root) {
  const scope = scopeFromCwd(path.resolve(cwd || process.cwd()));
  const commonDir = commonDirOf(scope.repo_identity);
  if (!scope.project_key || !commonDir) return null;
  const dir = path.join(commonDir, 'autopilot', 'decisions');
  return { scope, dir, key: scopeKeyOf(scope.project_key, root || null), file: path.join(dir, `${scopeKeyOf(scope.project_key, root || null)}.json`) };
}

// Every scope file of this project (unbound + each root) with its valid entries: [{ file, entries }]. `show` and `close --id`
// look across all of them, so a card opened before the session's root changed is still seen and closable. `open` writes only sf.file.
function projectScopes(sf) {
  const out = [];
  for (const file of listScopeFiles(sf.dir, sf.scope.project_key)) {
    if (!readScopeFile(file, { schema: SCHEMA, projectKey: sf.scope.project_key, identity: sf.scope.repo_identity })) continue;
    const entries = readFile(file);
    if (entries.length) out.push({ file, entries });
  }
  return out;
}

// Paths of this project's scope files that hold at least one card readFile accepts. `show`, `close --id`, and
// hooks/advisory-relay.js share this walk. `root` does not select the list: every unbound and root file is included.
function projectScopeFiles(cwd) {
  const sf = scopeFile(cwd, null);
  if (!sf) return [];
  return projectScopes(sf).map((s) => s.file);
}

function writeEntries(sf, root, entries) {
  if (entries.length === 0) { fs.unlinkSync(sf.file); return; }
  const body = { schema: SCHEMA, root_run_id: root || null, repo_identity: sf.scope.repo_identity, project_key: sf.scope.project_key, decisions: entries };
  const tmp = `${sf.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, sf.file);
}

function parseOptions(raw) {
  return raw.map((o) => {
    const at = o.indexOf('::');
    const label = (at < 0 ? o : o.slice(0, at)).trim();
    const description = at < 0 ? '' : o.slice(at + 2).trim();
    return { label, description };
  });
}

function showText(entries) {
  const out = [`open decisions: ${entries.length}`];
  entries.forEach((e, i) => {
    out.push('', `[${i + 1}] ${e.id}  ${e.question}`);
    if (e.background) out.push(`    background: ${e.background}`);
    if (Array.isArray(e.options)) e.options.forEach((o, k) => out.push(`    option ${k + 1}: ${o.label}${o.description ? ` — ${o.description}` : ''}`));
    if (e.recommendation) out.push(`    recommendation: ${e.recommendation}${e.why ? ` (${e.why})` : ''}`);
    else if (e.why) out.push(`    why: ${e.why}`);
    if (e.blocks) out.push(`    blocks: ${e.blocks}`);
    if (e.not_authorized) out.push(`    not_authorized: ${e.not_authorized}`);
    if (e.source) out.push(`    source: ${e.source}`);
    out.push(`    opened: ${e.opened_at}`);
  });
  return `${out.join('\n')}\n`;
}

function main(argv) {
  const args = parse(argv);
  if (args.error) return usage(args.error);
  const cmd = args._[0];
  if (!['open', 'close', 'show'].includes(cmd) || args._.length > 1) return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
  const sess = sessionRoot();
  const root = args['root-run-id'] !== undefined ? args['root-run-id'] : (process.env.AUTOPILOT_ROOT_RUN_ID || sess.root);
  if (root && (!SAFE_ROOT.test(root) || root === '.' || root === '..')) return usage('--root-run-id must match [A-Za-z0-9._-]+');
  const sf = scopeFile(args.cwd, root);
  if (!sf) return usage('not inside a git repository');

  if (cmd === 'show') {
    const entries = projectScopeFiles(args.cwd).flatMap((f) => readFile(f))
      .sort((a, b) => (Date.parse(a.opened_at) || 0) - (Date.parse(b.opened_at) || 0));
    if (entries.length === 0) { if (!args.json) process.stdout.write('no open decision\n'); return 1; }
    process.stdout.write(args.json ? `${JSON.stringify({ schema: SCHEMA, decisions: entries }, null, 2)}\n` : showText(entries));
    return 0;
  }
  if (cmd === 'close') {
    if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('close needs --id <id> (see `show`)');
    let r = { status: 'absent' };
    for (const f of projectScopeFiles(args.cwd)) {
      r = closeDecisionById(f, args.id);
      if (r.status !== 'absent') break;
    }
    if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
    process.stdout.write(r.status === 'closed' ? `closed ${args.id}\n` : `not open: ${args.id}\n`);
    return 0;
  }

  // open
  if (typeof args.question !== 'string' || !args.question.trim()) return usage('open needs a non-empty --question');
  if (args.option.length === 1) return usage('--option needs at least two options (or none)');
  const options = args.option.length ? parseOptions(args.option) : null;
  if (options && options.some((o) => !o.label)) return usage('--option labels must be non-empty');
  const r = openDecision({
    cwd: args.cwd || process.cwd(), root: root || null, session: sess.session, question: args.question, background: args.background,
    options, recommendation: args.recommendation, why: args.why, blocks: args.blocks, not_authorized: args['not-authorized'], source: args.source,
  });
  if (r.status === 'ok') { process.stdout.write(args.json ? `${JSON.stringify({ ok: true, id: r.id, file: r.file, scope_key: r.scope_key })}\n` : `${r.id}\n`); return 0; }
  process.stderr.write(`open-decision: ${r.message}\n`);
  return 4;
}

// Library entry (also used by hooks/ask-decision.js — mods P1W HOOKQ): append one entry to the scope file through the same
// lock + atomic-rename path as `open`; another entry is never touched. `origin` (e.g. "ask_user_question") marks which hook
// opened it; the CLI never sets it. `options` = [{label, description}] (>= 2) or null.
// Returns { status: 'ok'|'error', id, file, scope_key, message }.
function openDecision({ cwd, root, session, question, background, options, recommendation, why, blocks, not_authorized, source, origin, turn_tracked }) {
  const sf = scopeFile(cwd, root);
  if (!sf) return { status: 'error', message: 'not inside a git repository' };
  const entry = {
    id: `d-${crypto.randomBytes(4).toString('hex')}`,
    question,
    background: text(background),
    options: Array.isArray(options) && options.length >= 2
      ? options.map((o) => ({ label: String(o.label), description: text(o.description) || '' })) : null,
    recommendation: text(recommendation), why: text(why), blocks: text(blocks), not_authorized: text(not_authorized), source: text(source),
    opened_at: new Date().toISOString(), opened_by_session: session || null,
  };
  if (origin) entry.origin = origin;
  if (turn_tracked === true) entry.turn_tracked = true; // the asker's turn file existed at open time (hooks/ask-decision.js): only then is its absence later evidence the session ended
  try {
    fs.mkdirSync(sf.dir, { recursive: true, mode: 0o700 });
    return withWriteLock({ storeDir: sf.dir, lockFile: `${sf.file}.lock`, name: path.basename(sf.file), timeoutMs: 5000 }, () => {
      writeEntries(sf, root, [...readFile(sf.file), entry]);
      return { status: 'ok', id: entry.id, file: sf.file, scope_key: sf.key };
    });
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// Remove the entry `id` from the scope `file` under the same lock (the file goes with its last entry). Idempotent.
// `isOurs(entry)` (optional) must agree first. Returns { status: 'closed'|'absent'|'error', message }; never throws.
function closeDecisionById(file, id, isOurs) {
  // Nothing to close: do not enter the lock, whose store dir / lock file would create decisions/ in a repo that never opened one.
  if (!fs.existsSync(file)) return { status: 'absent' };
  try {
    return withWriteLock({ storeDir: path.dirname(file), lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, () => {
      const entries = readFile(file);
      const hit = entries.find((e) => e.id === id);
      if (!hit || (isOurs && !isOurs(hit))) return { status: 'absent' };
      const sf = { file, scope: null };
      const rest = entries.filter((e) => e.id !== id);
      if (rest.length === 0) { fs.unlinkSync(file); return { status: 'closed' }; }
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      writeEntries({ ...sf, scope: { repo_identity: v.repo_identity, project_key: v.project_key } }, v.root_run_id, rest);
      return { status: 'closed' };
    });
  } catch (error) {
    return error && error.code === 'ENOENT' ? { status: 'absent' } : { status: 'error', message: error.message };
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, openDecision, closeDecisionById, projectScopeFiles, SAFE_ROOT, SCHEMA };
