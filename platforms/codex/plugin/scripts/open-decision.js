#!/usr/bin/env node
'use strict';

/**
 * open-decision.js — the "open owner question" file of a watcher scope (mods P1W W2a-m, contract autopilot.decision/1).
 *
 *   node scripts/open-decision.js open  --question <q> [--option <o>]... [--not-authorized <reason>] [--context <c>]
 *                                       [--root-run-id <id>] [--replace] [--cwd <dir>]
 *   node scripts/open-decision.js close [--root-run-id <id>] [--cwd <dir>]
 *   node scripts/open-decision.js show  [--root-run-id <id>] [--json] [--cwd <dir>]
 *
 * One file per scope: <git-common-dir>/autopilot/decisions/<scope_key>.json, scope_key = project_key, or
 * project_key--<root> (root through the watcher's safeSegment). Present = an open question the owner has to answer;
 * `close` (answered or withdrawn) removes it, idempotently. The watcher reads it into the job page / band
 * (src/status/decision-input.js). Scope root: --root-run-id > $AUTOPILOT_ROOT_RUN_ID > this session's marker root > unbound.
 *
 * --option may repeat; none -> options null, one -> usage error (a choice needs at least two). --not-authorized is why
 * depth-0 may not decide this itself (the DOA boundary reason); optional. Writes take a lock and rename atomically.
 * Node built-ins only. This script writes nothing outside the decisions directory.
 * The library functions openDecision / closeDecisionIf are also called by hooks/ask-decision.js (depth-0 AskUserQuestion opens
 * a file with `source: "ask_user_question"`; mods P1W HOOKQ).
 *
 * Exit: 0 ok (show: an open question exists) | 1 show: none open | 2 usage / not a git repo | 3 open: a question is
 * already open (use --replace) | 4 write failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { scopeFromCwd } = require('../src/status/project-key');
const { scopeKeyOf, commonDirOf } = require('../src/status/scope-key');
const { withWriteLock } = require('./lib/jsonl-store');

const SCHEMA = 'autopilot.decision/1';
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;

function usage(message) {
  if (message) process.stderr.write(`open-decision: ${message}\n`);
  process.stderr.write('usage: open-decision.js open --question <q> [--option <o>]... [--not-authorized <reason>] [--context <c>] [--root-run-id <id>] [--replace]\n'
    + '       open-decision.js close [--root-run-id <id>]\n       open-decision.js show [--root-run-id <id>] [--json]\n');
  return 2;
}

function parse(argv) {
  const out = { _: [], option: [] };
  const valued = new Set(['question', 'option', 'not-authorized', 'context', 'root-run-id', 'cwd']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (valued.has(name)) {
      if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
      const v = argv[i + 1]; i += 1;
      if (name === 'option') out.option.push(v); else out[name] = v;
    } else if (name === 'replace' || name === 'json') out[name] = true;
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

function readOpen(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && v.schema === SCHEMA && typeof v.question === 'string' && v.question ? v : null;
  } catch (_error) {
    return null;
  }
}

function main(argv) {
  const args = parse(argv);
  if (args.error) return usage(args.error);
  const cmd = args._[0];
  if (!['open', 'close', 'show'].includes(cmd) || args._.length > 1) return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
  const sess = sessionRoot();
  const root = args['root-run-id'] !== undefined ? args['root-run-id'] : (process.env.AUTOPILOT_ROOT_RUN_ID || sess.root);
  if (root && (!SAFE_ROOT.test(root) || root === '.' || root === '..')) return usage('--root-run-id must match [A-Za-z0-9._-]+');
  const scope = scopeFromCwd(path.resolve(args.cwd || process.cwd()));
  const commonDir = commonDirOf(scope.repo_identity);
  if (!scope.project_key || !commonDir) return usage('not inside a git repository');
  const dir = path.join(commonDir, 'autopilot', 'decisions');
  const file = path.join(dir, `${scopeKeyOf(scope.project_key, root || null)}.json`);

  if (cmd === 'show') {
    const v = readOpen(file);
    if (!v) { if (!args.json) process.stdout.write('no open decision\n'); return 1; }
    process.stdout.write(args.json ? `${JSON.stringify(v, null, 2)}\n` : `open decision: ${v.question}\n`);
    return 0;
  }
  if (cmd === 'close') {
    try { fs.unlinkSync(file); } catch (error) { if (!error || error.code !== 'ENOENT') { process.stderr.write(`open-decision: ${error.message}\n`); return 4; } }
    process.stdout.write('closed\n');
    return 0;
  }

  // open
  if (typeof args.question !== 'string' || !args.question.trim()) return usage('open needs a non-empty --question');
  if (args.option.length === 1) return usage('--option needs at least two options (or none)');
  if (args.option.some((o) => !o.trim())) return usage('--option values must be non-empty');
  const r = openDecision({
    cwd: args.cwd || process.cwd(), root: root || null, session: sess.session, question: args.question,
    options: args.option.length ? args.option : null, context: args.context,
    notAuthorized: args['not-authorized'], replace: !!args.replace,
  });
  if (r.status === 'ok') { process.stdout.write(`${JSON.stringify({ ok: true, file: r.file, scope_key: r.scope_key })}\n`); return 0; }
  if (r.status === 'exists') { process.stderr.write('open-decision: a question is already open for this scope; close it or pass --replace\n'); return 3; }
  process.stderr.write(`open-decision: ${r.message}\n`);
  return 4;
}

// Library entry (also used by hooks/ask-decision.js — mods P1W HOOKQ): write the decision file of a scope through the
// same lock + atomic-rename path as `open`. `source` (optional, e.g. "ask_user_question") marks who opened the file;
// the CLI never sets it, so a hand-opened file has no `source`. `mayReplace(existing)` lets a caller overwrite a file it
// owns without --replace. Returns { status: 'ok'|'exists'|'declined'|'error', file, scope_key, message }.
function openDecision({ cwd, root, session, question, options, context, notAuthorized, source, replace, mayReplace }) {
  const scope = scopeFromCwd(path.resolve(cwd || process.cwd()));
  const commonDir = commonDirOf(scope.repo_identity);
  if (!scope.project_key || !commonDir) return { status: 'error', message: 'not inside a git repository' };
  const dir = path.join(commonDir, 'autopilot', 'decisions');
  const key = scopeKeyOf(scope.project_key, root || null);
  const file = path.join(dir, `${key}.json`);
  const record = {
    schema: SCHEMA, question, options: Array.isArray(options) && options.length ? options : null,
    context: context === undefined ? null : context,
    not_authorized: typeof notAuthorized !== 'string' || !notAuthorized.trim() ? null : notAuthorized,
    root_run_id: root || null, repo_identity: scope.repo_identity, project_key: scope.project_key,
    opened_at: new Date().toISOString(), opened_by_session: session || null,
  };
  if (source) record.source = source;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return withWriteLock({ storeDir: dir, lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 5000 }, () => {
      const existing = readOpen(file);
      if (existing && !replace) {
        if (!mayReplace) return { status: 'exists', file, scope_key: key };
        if (!mayReplace(existing)) return { status: 'declined', file, scope_key: key };
      }
      const tmp = `${file}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
      return { status: 'ok', file, scope_key: key };
    });
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// Remove `file` under the same lock when `isOurs(parsedFile)` says so. Idempotent; never throws.
function closeDecisionIf(file, isOurs) {
  try {
    return withWriteLock({ storeDir: path.dirname(file), lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, () => {
      const v = readOpen(file);
      if (!v || !isOurs(v)) return false;
      fs.unlinkSync(file);
      return true;
    });
  } catch (_error) {
    return false;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, openDecision, closeDecisionIf, SAFE_ROOT };
