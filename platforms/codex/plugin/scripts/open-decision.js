#!/usr/bin/env node
'use strict';

/**
 * open-decision.js — the "open owner questions" file of a watcher scope (mods P1W W2a-m; contract autopilot.decision/2).
 *
 *   node scripts/open-decision.js open  --question <q> [--background <why>] [--option <label>[::<description>]]... | --free-text
 *                                       [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] --not-authorized <boundary>[:<why the owner must decide>]
 *                                       [--doa-role <role>] [--doa-tier <tier>] [--target <deploy target>] [--source <who/where>]
 *                                       [--root-run-id <id>] [--cwd <dir>] [--json]     (prints the new id; --json: {ok,id,file,scope_key})
 *   node scripts/open-decision.js open ... [--executor <address>] [--asker <address>]  (who carries out the answer / who asked: stored on the card)
 *   node scripts/open-decision.js close --id <id> [--root-run-id <id>] [--cwd <dir>]   (answered or withdrawn; the card is KEPT, status closed)
 *   node scripts/open-decision.js close --id <id> --answer <text> [--executor <address>] [--asker <address>] [--awaiting-operator <step>]
 *   node scripts/open-decision.js done  --id <id>      (ends awaiting_operator_action: the operator's own step is done)
 *   node scripts/open-decision.js show  [--root-run-id <id>] [--all] [--json] [--cwd <dir>]    (lists every open question; --all: closed ones too)
 *   node scripts/open-decision.js show  --id <id> [--json]     (ONE card, closed or not)      list = show without --id
 *   node scripts/open-decision.js backfill --from <file.jsonl> [--apply]   (dry run unless --apply)
 *   node scripts/open-decision.js verify --id <card_id> --answer-id <id> --text-file <file>   (is a relayed owner answer the hub's real one?)
 *
 * One file per scope holds ALL open questions of that scope: <git-common-dir>/autopilot/decisions/<scope_key>.json
 * ({schema, root_run_id, repo_identity, project_key, decisions: [...]}), scope_key = project_key, or project_key--<root>
 * (root through the watcher's safeSegment). Each entry: id, question, background, options [{label, description}] | null,
 * recommendation, why, blocks, not_authorized (why the owner must decide, depth-0 may not), source, opened_at, opened_by_session (+ origin, set only by hooks/ask-decision.js).
 * `open` appends one entry and never overwrites another. `close --id` KEEPS the entry (BL cardtrail): status 'closed', closed_at (ISO UTC), answer
 * (the answer text, null for a withdrawal); idempotent. The file is never removed. "The entry is in the file" does NOT mean "the card is open":
 * every reader asks the status (src/status/scope-key.js isClosedEntry; readFile() skips closed unless { all: true }). The watcher reads the file into the job page / live pane (src/status/decision-input.js).
 * `show` and `close --id` cover EVERY scope file of the project (unbound + each root), since a session's root can change mid-way; `open` writes only the current scope.
 * Scope root: --root-run-id > $AUTOPILOT_ROOT_RUN_ID > this session's marker root > unbound.
 *
 * --not-authorized is REQUIRED (mechanism behind the "inside the DOA, decide yourself" rule). <boundary> is one of
 * read_only | reversible | external | irreversible (the action classes of scripts/resolve-doa.sh) or goal-change | scope-expansion |
 * resources-2x | red-line (the Board-approval rows of skills/ceo-agent/SKILL.md); text after the first ':' is the free-text reason.
 * In an orchestrator session (marker level l3-l6 = autonomous, involvement just-results) a class boundary is accepted only when
 * resolve-doa (--doa-role, default manager; --doa-tier, default sonnet) says that class is `escalate`; a boundary the DOA lets
 * the session do alone (autonomous / logged) is refused: exit 3, decide it yourself. Plain sessions only need a known boundary.
 * If resolve-doa cannot be run, the DOA-independent boundaries (irreversible + the Board rows, `escalate` in every preset) are
 * still accepted with a stderr warning, and the other classes are refused (a gate that cannot verify must not wave them through).
 * --kind <decide|go> (optional): the card's kind, stored as `kind` on the entry (same names as fleet's DecisionKind). Absent = unspecified;
 * entries without it read as before. Any other value -> exit 7, nothing is written.
 * close [--option <label> | --free-text <text>] (F4 claim-before-act): when the owner's answer is given, close first runs `fleet decision claim` for
 * the card (scripts/lib/fleet-decision.js). Already answered on the console (claim exit 3) -> the printed console answer is what to act on, and the
 * card is closed; courier unreachable (exit 9) -> retried a bounded number of times, then exit 8 and the card stays open. A host with no fleet
 * binary, or one without `fleet decision`, closes as before. Without --option/--free-text close is a plain ledger close (a withdrawal, not an answer).
 * --target <name> (optional): the deploy target the question is about. It is judged by `resolve-doa.sh --target` BEFORE any boundary
 * check, in every session mode and for every boundary: production_denied (exit 10) refuses the card, and so does target_unlisted /
 * a failing resolver (fail closed) -> exit 6, nothing is written. A production target is refused, never escalated to the owner.
 * Without --target nothing changes. The caller reports --target itself; a wrong label is an accepted residual risk (see resolve-doa.sh).
 * --option may repeat; at least two are REQUIRED (none or one -> exit 2); a question the owner answers in typed text passes --free-text instead (options null; --free-text with --option -> exit 2). Everything except
 * --question is optional text for the owner; an empty value is stored as null. Writes take a lock and rename atomically.
 * Card trail (BL cardtrail). Stored fields a reader (patrol, the panel) may rely on: status ('open' | 'awaiting_operator_action' | 'closed'; absent = open),
 * answer (the answer text), closed_at (ISO UTC, set when status becomes closed), answered_at (set on awaiting_operator_action), executor and asker
 * (fleet addresses, set at `open --executor/--asker` or at close), awaiting_operator (the step the operator must do), delivery ('ok'|'failed'),
 * delivery_error, delivery_at, backfilled (true on a record made by backfill). Field list: this comment and references/review-page.md (decisions); schemas/decision.schema.json validates them.
 * close --answer <text> [--executor A] [--asker B]: closes the card with the answer verbatim, then `fleet dispatch`es the executor (card id + answer, a task)
 * and `fleet send`s an fyi to the asker. --executor falls back to the one stored at open; none anywhere -> the card still closes, stdout warns
 * "沒有 executor，不會派工", nothing is sent. A failed send never reopens or hides the card: it records delivery: failed + delivery_error and exits 14.
 * --answer is a relay of an answer given elsewhere: it does NOT claim on the fleet courier (use `verify` to prove a relayed answer first).
 * --awaiting-operator <step> (the CALLER decides, nothing is guessed): the answer is recorded and delivered but the card goes to awaiting_operator_action
 * instead of closed; the panel shows it differently from a question; `close` on such a card is refused (exit 2); `done --id` ends it.
 * AUTOPILOT_FLEET_BIN picks the fleet binary (tests use a stub; nothing real is ever sent by a test).
 * backfill --from <file.jsonl>: lines {id, question, answer, closed_at, [opened_at], [executor], [asker]} become closed records (backfilled: true);
 * a card already in the store is skipped; a bad line refuses the whole run (exit 2). Dry run by default; --apply writes.
 * Node built-ins only. This script writes nothing outside the decisions directory.
 * The library functions openDecision / closeDecisionById are also called by hooks/ask-decision.js (depth-0 AskUserQuestion
 * adds an entry with `origin: "ask_user_question"`; mods P1W HOOKQ).
 *
 * `open` also ensures a watcher publishes the card (src/status/card-visibility.js: the autostart hook's start path, plus the plain session marker).
 * verify: the hub compares, this host never sees the stored hash. It probes the fleet CLI, then calls lib/fleet-decision.js verify() (local call first,
 * on hub exit 7 a second call with the sha256 of the received text, CRLF->LF, trailing newlines stripped). Pass = exit 0, prints the line 內容核實 (console answer: the text was compared) or 答覆核實 (via=local: only the answer id was proven, the text was NOT compared) plus the
 * hub's STORED answer as JSON: act on that, never on the relayed text. Needs no git repo. Never exits 0 on anything else (fail closed).
 * Verify exits: 9 no fleet binary or no `fleet decision` | 10 hub unreachable | 11 other error / probe failed | 12 unverified (card, answer id or content does not match; the hub does not say which) |
 *       13 verified but the stored answer carries no content (via=local off the owner host): only the answer id is proven.
 * Exit: 0 ok (show: at least one open) | 1 show: none open (show --id: no such card) | 14 close --answer: closed, but a delivery failed (delivery: failed on the card) | 2 usage / not a git repo / missing or unknown --not-authorized | 3 open refused: the boundary is inside this session's DOA (or unverifiable) | 4 write failure |
 *       8 close refused: the card's answer could not be claimed on the fleet courier (unreachable after bounded retries, or an unusable reply); the card stays OPEN |
 *       7 open refused: --kind is not decide|go (nothing is written) |
 *       6 open refused: --target is a production target, unlisted, or could not be judged (refuse, never escalate; nothing is written) |
 *       5 open: the card IS written and its id printed, but no live panel will show it (isolated env, no flock, unusable live dir, a watcher without --render); stderr names the reason and what to do.
 *       Library callers (openDecision) are unaffected: only the CLI `open` ensures and reports. AUTOPILOT_RUNS_WATCH_AUTOSTART=0 skips the ensure (the hook's own switch).
 */

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scopeFromCwd } = require('../src/status/project-key');
const { scopeKeyOf, commonDirOf, listScopeFiles, readScopeFile, isClosedEntry, isAwaitingEntry } = require('../src/status/scope-key');
const { withWriteLock } = require('./lib/jsonl-store');

const SCHEMA = 'autopilot.decision/2';
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function usage(message) {
  if (message) process.stderr.write(`open-decision: ${message}\n`);
  process.stderr.write('usage: open-decision.js open --question <q> [--background <why>] [--option <label>[::<description>]]... | --free-text [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] --not-authorized <boundary>[:<why the owner must decide>] [--doa-role <role>] [--doa-tier <tier>] [--target <deploy target>] [--source <who/where>] [--root-run-id <id>]\n'
    + '       open-decision.js close --id <id> [--root-run-id <id>]\n       open-decision.js close --id <id> --answer <text> [--executor <address>] [--asker <address>] [--awaiting-operator <step>]\n       open-decision.js done --id <id>\n       open-decision.js verify --id <card_id> --answer-id <id> --text-file <file>\n       open-decision.js show [--root-run-id <id>] [--all] [--json]\n       open-decision.js show --id <id> [--json]\n       open-decision.js list [--all] [--json]\n       open-decision.js backfill --from <file.jsonl> [--apply]\n       (open also takes --executor <address> --asker <address>)\n');
  return 2;
}

function parse(argv) {
  const out = { _: [], option: [] };
  const valued = new Set(['question', 'background', 'option', 'recommendation', 'why', 'blocks', 'not-authorized', 'doa-role', 'doa-tier', 'source', 'id', 'root-run-id', 'cwd', 'answer-id', 'text-file']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const name = a.slice(2);
    if (valued.has(name)) {
      if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
      const v = argv[i + 1]; i += 1;
      if (name === 'option') out.option.push(v); else out[name] = v;
    } else if (name === 'json' || name === 'free-text') out[name] = true;
    else return { error: `unknown argument: ${a}` };
  }
  return out;
}

function sessionRoot() {
  const raw = process.env.AUTOPILOT_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || process.env.CODEX_THREAD_ID;
  if (!raw) return { root: null, session: null, why: 'no session id in the environment' };
  const session = String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  // One shared judgement (session-mode.js readSessionRoot): an expired marker whose session is still alive keeps its root.
  try {
    const r = require('./session-mode.js').readSessionRoot(session);
    return { root: r.root, session, why: r.root ? null : (!r.found ? 'no session marker' : (r.expired ? 'session marker expired and no live turn file' : 'marker has no root_run_id')) };
  } catch (_error) {
    return { root: null, session, why: 'session marker unreadable' };
  }
}

// ---- --not-authorized: the DOA check (BL-0309 item 3) ----
const DOA_CLASSES = ['read_only', 'reversible', 'external', 'irreversible'];
const BOARD_BOUNDARIES = ['goal-change', 'scope-expansion', 'resources-2x', 'red-line'];
const ALWAYS_OWNER = new Set(['irreversible', ...BOARD_BOUNDARIES]); // `escalate` under every preset of scripts/resolve-doa.sh
const RESOLVE_DOA = path.join(__dirname, 'resolve-doa.sh');
const boundaryList = () => [...DOA_CLASSES, ...BOARD_BOUNDARIES].join(' | ');

// The orchestrator marker (level l3-l6) is the repo's definition of an autonomous session (involvement preset just-results).
function isAutonomous() {
  try { return require('./session-mode.js').isAutonomousSession(); } catch (_error) { return false; }
}

// -> { actions } | { failure } ; never throws. The caller's cwd carries the project doa-config override ($PWD).
function runResolveDoa(cwd, role, tier) {
  try {
    const r = spawnSync('bash', [RESOLVE_DOA, '--role', role, '--tier', tier], { cwd, encoding: 'utf8', timeout: 10000 });
    if (r.error) return { failure: r.error.message };
    if (r.status !== 0) return { failure: `exit ${r.status}: ${String(r.stderr || '').trim().split('\n')[0] || 'no output'}` };
    const j = JSON.parse(r.stdout);
    if (!j || typeof j.actions !== 'object') return { failure: 'no actions in the output' };
    return { actions: j.actions, preset: j.preset, source: j.source };
  } catch (error) {
    return { failure: error.message };
  }
}

// -> { refused?: string } ; --target is judged by resolve-doa before anything else. Only a clean exit 0 (staging) lets the card on.
function checkTarget(cwd, role, tier, target) {
  try {
    const r = spawnSync('bash', [RESOLVE_DOA, '--role', role, '--tier', tier, '--target', target], { cwd, encoding: 'utf8', timeout: 10000 });
    if (r.error) return { refused: `resolve-doa could not run (${r.error.message}); fail closed` };
    if (r.status === 0) return {};
    if (r.status === 10) return { refused: `production_denied: "${target}" is a production target; agents may not act on it and no card can authorise it (refuse, never escalate)` };
    if (r.status === 11) return { refused: `target_unlisted: "${target}" is not on the production table (or the table is malformed); fail closed` };
    return { refused: `resolve-doa --target failed (exit ${r.status}: ${String(r.stderr || '').trim().split('\n')[0] || 'no output'}); fail closed` };
  } catch (error) {
    return { refused: `resolve-doa --target failed (${error.message}); fail closed` };
  }
}

// -> { code: 0|2|3, message?, warning? }
function checkNotAuthorized(raw, { cwd, role, tier, autonomous }) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  const missing = `open needs --not-authorized <boundary>[:<why the owner must decide>]; boundary is one of ${boundaryList()}`;
  if (!value) return { code: 2, message: missing };
  const at = value.indexOf(':');
  const id = (at < 0 ? value : value.slice(0, at)).trim().toLowerCase();
  if (!DOA_CLASSES.includes(id) && !BOARD_BOUNDARIES.includes(id)) return { code: 2, message: `--not-authorized "${id}" is not a known boundary; use one of ${boundaryList()}` };
  if (BOARD_BOUNDARIES.includes(id) || !autonomous) return { code: 0 };
  const doa = runResolveDoa(cwd, role, tier);
  if (doa.failure) {
    if (ALWAYS_OWNER.has(id)) return { code: 0, warning: `resolve-doa failed (${doa.failure}); "${id}" is owner-only under every preset, so the card is opened unverified` };
    return { code: 3, message: `resolve-doa failed (${doa.failure}), so "${id}" cannot be checked against the DOA; fix resolve-doa, or use a boundary that is owner-only in every preset (irreversible | ${BOARD_BOUNDARIES.join(' | ')})` };
  }
  const action = doa.actions[id];
  if (action === 'escalate') return { code: 0 };
  return { code: 3, message: `this is inside your DOA, decide it yourself: ${id} is "${action}" for role ${role} / tier ${tier} (preset ${doa.preset}, source ${doa.source}); a card is only for what resolve-doa marks "escalate" or a Board-approval boundary` };
}

const text = (v) => (typeof v === 'string' && v.trim() ? v : null);

// A stored entry that can be shown: an id, a question, a parseable opened_at. Anything else is dropped on read.
function validEntry(e) {
  return e && typeof e === 'object' && typeof e.id === 'string' && e.id && typeof e.question === 'string' && e.question;
}

// The entries of a scope file that are not closed ([] = none / unreadable / another schema). A closed card stays in the file as a record
// (status 'closed', closed_at, answer); `{ all: true }` returns those too. "In the file" is never "open": ask this, not the file.
function readFile(file, { all = false } = {}) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && v.schema === SCHEMA && Array.isArray(v.decisions) ? v.decisions.filter((e) => validEntry(e) && (all || !isClosedEntry(e))) : [];
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
function projectScopes(sf, opts) {
  const out = [];
  for (const file of listScopeFiles(sf.dir, sf.scope.project_key)) {
    if (!readScopeFile(file, { schema: SCHEMA, projectKey: sf.scope.project_key, identity: sf.scope.repo_identity })) continue;
    const entries = readFile(file, opts);
    if (entries.length) out.push({ file, entries });
  }
  return out;
}

// Paths of this project's scope files that hold at least one card readFile accepts. `show`, `close --id`, and
// hooks/advisory-relay.js share this walk. `root` does not select the list: every unbound and root file is included.
function projectScopeFiles(cwd, opts) {
  const sf = scopeFile(cwd, null);
  if (!sf) return [];
  return projectScopes(sf, opts).map((s) => s.file);
}

// The card `id` across every scope file: { file, entry } or null. `{ all: true }` also finds closed cards (show --id, done, backfill).
function findCard(cwd, id, opts) {
  for (const file of projectScopeFiles(cwd, opts)) {
    const entry = readFile(file, opts).find((e) => e.id === id);
    if (entry) return { file, entry };
  }
  return null;
}

// Cards this session opened that sit in the UNBOUND scope file (no root in the file): [{ id, file }]. The owner-question-guard
// uses it to tell a session that has a root that its card landed where a root-scoped panel will not list it. Never throws.
function unboundCardsOf(cwd, session) {
  try {
    const out = [];
    for (const file of projectScopeFiles(cwd)) {
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (v && v.root_run_id) continue;
      for (const e of readFile(file)) if (e.opened_by_session === session) out.push({ id: e.id, file });
    }
    return out;
  } catch (_error) {
    return [];
  }
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

function showText(entries, { all = false } = {}) {
  const out = [`${all ? 'decisions' : 'open decisions'}: ${entries.length}`];
  entries.forEach((e, i) => {
    out.push('', `[${i + 1}] ${e.id}  ${e.question}`);
    if (e.status && e.status !== 'open') out.push(`    status: ${e.status}`);
    if (e.awaiting_operator) out.push(`    awaiting_operator: ${e.awaiting_operator}`);
    if (e.answer) out.push(`    answer: ${e.answer}`);
    if (e.answered_at) out.push(`    answered_at: ${e.answered_at}`);
    if (e.closed_at) out.push(`    closed_at: ${e.closed_at}`);
    if (e.executor) out.push(`    executor: ${e.executor}`);
    if (e.asker) out.push(`    asker: ${e.asker}`);
    if (e.delivery) out.push(`    delivery: ${e.delivery}${e.delivery_error ? ` (${e.delivery_error})` : ''}`);
    if (e.background) out.push(`    background: ${e.background}`);
    if (Array.isArray(e.options)) e.options.forEach((o, k) => out.push(`    option ${k + 1}: ${o.label}${o.description ? ` — ${o.description}` : ''}`));
    if (e.recommendation) out.push(`    recommendation: ${e.recommendation}${e.why ? ` (${e.why})` : ''}`);
    else if (e.why) out.push(`    why: ${e.why}`);
    if (e.blocks) out.push(`    blocks: ${e.blocks}`);
    if (e.not_authorized) out.push(`    not_authorized: ${e.not_authorized}`);
    if (e.kind) out.push(`    kind: ${e.kind}`);
    if (e.source) out.push(`    source: ${e.source}`);
    out.push(`    opened: ${e.opened_at}`);
  });
  return `${out.join('\n')}\n`;
}

// --target is lifted out before parse(): the flag set of parse() is pinned byte-for-byte by the frozen ask stub of the
// d0gate-v2 evaluation (hooks/tests/skill-onoff-d0gate-v2.test.sh), which must not change.
const KINDS = ['decide', 'go'];
// --kind is lifted out the same way (same frozen-stub reason): { rest, kind } | { error }.
function takeKind(argv) {
  const i = argv.indexOf('--kind');
  if (i < 0) return { rest: argv };
  if (i + 1 >= argv.length) return { error: '--kind needs a value' };
  return { rest: [...argv.slice(0, i), ...argv.slice(i + 2)], kind: argv[i + 1] };
}

// close only: `--free-text <text>` takes a value there (on `open` it is a bare switch, so parse() must keep seeing it unchanged).
function takeFreeText(argv) {
  if (argv[0] !== 'close') return { rest: argv };
  const i = argv.indexOf('--free-text');
  if (i < 0) return { rest: argv };
  if (i + 1 >= argv.length) return { error: 'close --free-text needs a value' };
  return { rest: [...argv.slice(0, i), ...argv.slice(i + 2)], freeText: argv[i + 1] };
}

// BL cardtrail flags are lifted out like --kind/--target (parse()'s valued Set stays byte-identical to the frozen ask stub).
// -> { rest, extra: { answer, executor, asker, 'awaiting-operator', from, all, apply } } | { error }
const EXTRA_VALUED = ['answer', 'executor', 'asker', 'awaiting-operator', 'from'];
const EXTRA_SWITCH = ['all', 'apply'];
function takeExtra(argv) {
  const rest = [];
  const extra = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const name = a.startsWith('--') ? a.slice(2) : null;
    if (name && EXTRA_VALUED.includes(name)) {
      if (i + 1 >= argv.length) return { error: `--${name} needs a value` };
      extra[name] = argv[i + 1]; i += 1;
    } else if (name && EXTRA_SWITCH.includes(name)) extra[name] = true;
    else rest.push(a);
  }
  return { rest, extra };
}

function takeTarget(argv) {
  const i = argv.indexOf('--target');
  if (i < 0) return { rest: argv };
  if (i + 1 >= argv.length) return { error: '--target needs a value' };
  return { rest: [...argv.slice(0, i), ...argv.slice(i + 2)], target: argv[i + 1] };
}

// F4 claim-before-act for `close --option/--free-text`: -> { code: 0 } to go on closing, { code: 8 } to leave the card open.
function claimBeforeClose(args) {
  const open = projectScopeFiles(args.cwd).some((f) => readFile(f).some((e) => e.id === args.id));
  if (!open) return { code: 0 }; // not open: the plain close below says so
  const fd = require('./lib/fleet-decision.js');
  const pr = fd.probe();
  if (pr === 'unsupported') return { code: 0 }; // no courier on this host: today's behaviour
  if (pr === 'probe_error') {
    process.stderr.write(`open-decision: ERROR: ${args.id} NOT closed and NOT answered: could not tell whether this host has a fleet courier (\`fleet --help\` probe failed); the answer is held. Run the same close again\n`);
    return { code: 8 };
  }
  const c = fd.claim(args.id, args.option.length ? { option: args.option[0] } : { freeText: args.closeFreeText });
  if (c.outcome === 'claimed') return { code: 0 };
  if (c.outcome === 'already_answered') {
    process.stderr.write(`open-decision: ${args.id} was already answered on the console; act on that answer, not on yours, and tell the owner\n`);
    process.stdout.write(`already answered on the console: ${JSON.stringify(c.json)}\n`);
    return { code: 0 };
  }
  // exit 10 card_closed (withdrawn / closed / expired on the courier): fleet plan R4.1 says an expired card "can be answered only in-session"
  // (plan line 504) and claim exit 10 is the closed-card code (line 542), so the local ledger entry may be closed. exit 4 `unknown` is NOT
  // defined as proceed anywhere: nothing confirmed the answer, so the card stays open (exit 8 below).
  if (c.outcome === 'card_closed') {
    process.stderr.write(`open-decision: note: courier says card_closed for ${args.id}; closing the ledger entry\n`);
    return { code: 0 };
  }
  process.stderr.write(`open-decision: ERROR: ${args.id} NOT closed and NOT answered: claim ${c.outcome === 'unreachable' ? `failed, courier unreachable after ${c.attempts} attempts` : 'failed'}${c.detail ? ` (${c.detail})` : ''}; the answer is held. Tell the owner, and run the same close again once the courier is back\n`);
  return { code: 8 };
}

// Relayed-answer check. No scope file, no git repo. Every non-pass path is a distinct non-zero exit (see the header).
function verifyAnswer(args) {
  const err = (m) => process.stderr.write(`open-decision: ${m}\n`);
  if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('verify needs --id <card_id>');
  if (typeof args['answer-id'] !== 'string' || !SAFE_ID.test(args['answer-id'])) return usage('verify needs --answer-id <id>');
  if (typeof args['text-file'] !== 'string') return usage('verify needs --text-file <file with the received answer text>');
  let text;
  try { text = fs.readFileSync(args['text-file'], 'utf8'); } catch (e) { return usage(`cannot read --text-file: ${e.message}`); }
  const fd = require('./lib/fleet-decision.js');
  const pr = fd.probe();
  if (pr === 'unsupported') { err('無法核實：本機 fleet 沒有 decision 指令'); return 9; }
  if (pr !== 'supported') { err('無法核實：fleet 探測失敗'); return 11; }
  // Same order as fd.verify(), but kept here so the pass line can say which call passed: a local answer passes on the first call, which carries no
  // hash, so the relayed text was NOT compared; only the second (console, hashed) call compares it.
  let v = fd.verifyOnce(args.id, args['answer-id'], null);
  let compared = false;
  if (v.outcome === 'unverified') { v = fd.verifyOnce(args.id, args['answer-id'], fd.contentSha256(text)); compared = true; }
  if (v.outcome === 'unverified') { err('核實失敗：卡片、答覆編號或內容對不上'); return 12; }
  if (v.outcome === 'unreachable') { err('無法核實：連不到 hub'); return 10; }
  if (!v.ok || v.outcome !== 'verified') { err(`無法核實：${v.detail || v.outcome}`); return 11; }
  const a = v.answer;
  const has = (x) => typeof x === 'string' && x !== '';
  if (!a || typeof a !== 'object' || (!has(a.option) && !has(a.free_text))) { err('內容未核實：hub 只證實這個答覆編號存在，內容要回原 session 確認'); return 13; }
  const head = compared ? `內容核實：${args.id} ${args['answer-id']}` : `答覆核實：${args.id} ${args['answer-id']}（轉手文字沒有比對，請只照下面 hub 存的答覆做）`;
  process.stdout.write(`${head}\n${JSON.stringify(a)}\n請照上面 hub 存的答覆做，不要照轉手的文字\n`);
  return 0;
}

function main(argv) {
  const kk = takeKind(argv);
  if (kk.error) return usage(kk.error);
  const ft = takeFreeText(kk.rest);
  if (ft.error) return usage(ft.error);
  const tk = takeTarget(ft.rest);
  if (tk.error) return usage(tk.error);
  const xt = takeExtra(tk.rest);
  if (xt.error) return usage(xt.error);
  const args = parse(xt.rest);
  args.extra = xt.extra;
  if (kk.kind !== undefined) args.kind = kk.kind;
  if (ft.freeText !== undefined) args.closeFreeText = ft.freeText;
  if (args.error) return usage(args.error);
  if (tk.target !== undefined) args.target = tk.target;
  const cmd = args._[0];
  if (cmd === 'verify' && args._.length === 1) return verifyAnswer(args);
  if (!['open', 'close', 'done', 'show', 'list', 'backfill'].includes(cmd) || args._.length > 1) return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
  const sess = sessionRoot();
  const root = args['root-run-id'] !== undefined ? args['root-run-id'] : (process.env.AUTOPILOT_ROOT_RUN_ID || sess.root);
  if (root && (!SAFE_ROOT.test(root) || root === '.' || root === '..')) return usage('--root-run-id must match [A-Za-z0-9._-]+');
  const sf = scopeFile(args.cwd, root);
  if (!sf) return usage('not inside a git repository');

  const ex = args.extra;
  const stray = (names) => names.find((n) => ex[n] !== undefined);
  if (cmd === 'show' || cmd === 'list') {
    if (cmd === 'list' && args.id !== undefined) return usage('list takes no --id (use `show --id <id>`)');
    const bad = stray(['answer', 'executor', 'asker', 'awaiting-operator', 'from', 'apply']);
    if (bad) return usage(`--${bad} is not a ${cmd} argument`);
    if (args.id !== undefined) { // show --id: ONE card, closed ones too
      if (!SAFE_ID.test(args.id)) return usage('show --id <id> needs a card id (see `list --all`)');
      const hit = findCard(args.cwd, args.id, { all: true });
      if (!hit) { if (!args.json) process.stdout.write(`no such decision: ${args.id}\n`); return 1; }
      process.stdout.write(args.json ? `${JSON.stringify({ schema: SCHEMA, decisions: [hit.entry] }, null, 2)}\n` : showText([hit.entry], { all: true }));
      return 0;
    }
    const all = ex.all === true;
    const entries = projectScopeFiles(args.cwd, { all }).flatMap((f) => readFile(f, { all }))
      .sort((a, b) => (Date.parse(a.opened_at) || 0) - (Date.parse(b.opened_at) || 0));
    if (entries.length === 0) { if (!args.json) process.stdout.write(all ? 'no decision\n' : 'no open decision\n'); return 1; }
    process.stdout.write(args.json ? `${JSON.stringify({ schema: SCHEMA, decisions: entries }, null, 2)}\n` : showText(entries, { all }));
    return 0;
  }
  if (cmd === 'done') {
    if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('done needs --id <id>');
    const hit = findCard(args.cwd, args.id, { all: true });
    if (!hit) { process.stdout.write(`no such decision: ${args.id}\n`); return 1; }
    if (isClosedEntry(hit.entry)) { process.stdout.write(`already closed: ${args.id}\n`); return 0; }
    if (!isAwaitingEntry(hit.entry)) return usage(`${args.id} is open, not awaiting_operator_action; \`done\` only ends that state (answer the card with \`close --answer\`)`);
    const r = patchDecision(hit.file, args.id, { status: 'closed', closed_at: new Date().toISOString() });
    if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
    process.stdout.write(`closed ${args.id} (operator step done)\n`);
    return 0;
  }
  if (cmd === 'backfill') return backfill(args, sf, root || null);
  if (cmd === 'close') {
    if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('close needs --id <id> (see `show`)');
    const bad = stray(['all', 'apply', 'from']);
    if (bad) return usage(`--${bad} is not a close argument`);
    const viaOption = args.option.length > 0 || args.closeFreeText !== undefined;
    if (args.option.length > 1 || (args.option.length && args.closeFreeText !== undefined)) return usage('close takes one --option <label> or one --free-text <text>');
    if (ex.answer !== undefined && (viaOption || !ex.answer.trim())) return usage('close --answer <text> is the whole answer: not with --option/--free-text, and not empty');
    if (ex.answer === undefined && (ex['awaiting-operator'] !== undefined || ex.executor !== undefined || ex.asker !== undefined)) return usage('--executor/--asker/--awaiting-operator belong to `close --answer <text>`');
    if (ex['awaiting-operator'] !== undefined && !ex['awaiting-operator'].trim()) return usage('--awaiting-operator needs the step the operator must do');
    for (const k of ['executor', 'asker']) if (ex[k] !== undefined && !require('./lib/fleet-decision.js').isAddress(ex[k])) return usage(`--${k} "${ex[k]}" is not an address (namespace/courier/member)`);
    const found = findCard(args.cwd, args.id);
    if (found && isAwaitingEntry(found.entry) && ex['awaiting-operator'] === undefined) return usage(`${args.id} is awaiting_operator_action: the operator's step ends it (\`done --id ${args.id}\`), not close`);
    if (viaOption) {
      const g = claimBeforeClose(args);
      if (g.code !== 0) return g.code;
    }
    const answerText = ex.answer !== undefined ? ex.answer : (args.option.length ? args.option[0] : (args.closeFreeText !== undefined ? args.closeFreeText : null));
    const executor = ex.executor || (found && found.entry.executor) || null;
    const asker = ex.asker || (found && found.entry.asker) || null;
    const now = new Date().toISOString();
    const awaiting = ex['awaiting-operator'] !== undefined;
    const patch = awaiting
      ? { status: 'awaiting_operator_action', answered_at: now, answer: answerText, awaiting_operator: ex['awaiting-operator'].trim() }
      : { status: 'closed', closed_at: now, answer: answerText };
    if (executor && answerText !== null) patch.executor = executor;
    if (asker && answerText !== null) patch.asker = asker;
    let r = { status: 'absent' };
    for (const f of projectScopeFiles(args.cwd)) {
      r = patchDecision(f, args.id, patch);
      if (r.status !== 'absent') { r.file = f; break; }
    }
    if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
    if (r.status === 'absent') { process.stdout.write(`not open: ${args.id}\n`); return 0; }
    process.stdout.write(awaiting ? `awaiting_operator_action ${args.id}\n` : `closed ${args.id}\n`);
    if (answerText === null) return 0; // a plain withdrawal: nothing to deliver
    if (!executor) process.stdout.write(`警告：${args.id} 沒有 executor，不會派工（開卡時沒帶 --executor，close 也沒帶）\n`);
    return deliverAnswer({ id: args.id, file: r.file, question: r.entry.question, answer: answerText, executor, asker, awaiting: awaiting ? patch.awaiting_operator : null });
  }

  // open
  if (typeof args.question !== 'string' || !args.question.trim()) return usage('open needs a non-empty --question');
  if (args['free-text'] && args.option.length) return usage('--free-text and --option are mutually exclusive: a free-text card has no options');
  if (args.option.length === 1) return usage('--option needs at least two options');
  if (!args.option.length && !args['free-text']) return usage('a decision card needs at least two --option <label>::<description>; for a question answered in typed text pass --free-text');
  if (args.kind !== undefined && !KINDS.includes(args.kind)) { process.stderr.write(`open-decision: refused: --kind must be one of ${KINDS.join(' | ')} (got "${args.kind}"); nothing written\n`); return 7; }
  const bad = ['answer', 'awaiting-operator', 'from', 'all', 'apply'].find((n) => ex[n] !== undefined);
  if (bad) return usage(`--${bad} is not an open argument`);
  for (const k of ['executor', 'asker']) if (ex[k] !== undefined && !require('./lib/fleet-decision.js').isAddress(ex[k])) return usage(`--${k} "${ex[k]}" is not an address (namespace/courier/member)`);
  const options = args.option.length ? parseOptions(args.option) : null;
  if (options && options.some((o) => !o.label)) return usage('--option labels must be non-empty');
  if (args.target !== undefined) {
    const t = checkTarget(path.resolve(args.cwd || process.cwd()), args['doa-role'] || 'manager', args['doa-tier'] || 'sonnet', args.target);
    if (t.refused) { process.stderr.write(`open-decision: refused: ${t.refused}\n`); return 6; }
  }
  const gate = checkNotAuthorized(args['not-authorized'], { cwd: path.resolve(args.cwd || process.cwd()), role: args['doa-role'] || 'manager', tier: args['doa-tier'] || 'sonnet', autonomous: isAutonomous() });
  if (gate.code === 2) return usage(gate.message);
  if (gate.code === 3) { process.stderr.write(`open-decision: refused: ${gate.message}\n`); return 3; }
  if (gate.warning) process.stderr.write(`open-decision: warning: ${gate.warning}\n`);
  const r = openDecision({
    cwd: args.cwd || process.cwd(), root: root || null, session: sess.session, question: args.question, background: args.background,
    options, recommendation: args.recommendation, why: args.why, blocks: args.blocks, not_authorized: args['not-authorized'], source: args.source, kind: args.kind, executor: ex.executor, asker: ex.asker,
  });
  if (r.status === 'ok' && !root) {
    // The card is in the unbound scope. Every panel of the project lists it (src/status/decision-input.js reads all scope files), so this is
    // information, not a loss: say once on stderr where it went (stdout stays the bare id).
    process.stderr.write(`open-decision: note: card ${r.id} written to the UNBOUND scope (${sess.why || 'no root'}); scope_key=${r.scope_key} file=${r.file}; every panel of this project lists unbound cards too, and --root-run-id <id> would bind it to one session root\n`);
  }
  if (r.status === 'ok') {
    process.stdout.write(args.json ? `${JSON.stringify({ ok: true, id: r.id, file: r.file, scope_key: r.scope_key })}\n` : `${r.id}\n`);
    // A card written is not a card seen: make sure a watcher publishes it. The card stays written and its id printed either way.
    const vis = require('../src/status/card-visibility').ensureCardVisible({ cwd: path.resolve(args.cwd || process.cwd()), sessionId: sess.session || '', env: process.env });
    if (!vis.ok) {
      process.stderr.write(`open-decision: ERROR: card ${r.id} was written but will NOT appear in any live panel: ${vis.reason}; please ${vis.action}\n`);
      return 5;
    }
    return 0;
  }
  process.stderr.write(`open-decision: ${r.message}\n`);
  return 4;
}

// Library entry (also used by hooks/ask-decision.js — mods P1W HOOKQ): append one entry to the scope file through the same
// lock + atomic-rename path as `open`; another entry is never touched. `origin` (e.g. "ask_user_question") marks which hook
// opened it; the CLI never sets it. `options` = [{label, description}] (>= 2) or null.
// Returns { status: 'ok'|'error', id, file, scope_key, message }.
function openDecision({ cwd, root, session, question, background, options, recommendation, why, blocks, not_authorized, source, origin, turn_tracked, kind, executor, asker }) {
  const sf = scopeFile(cwd, root);
  if (!sf) return { status: 'error', message: 'not inside a git repository' };
  const entry = {
    id: `d-${crypto.randomBytes(4).toString('hex')}`,
    question,
    background: text(background),
    options: Array.isArray(options) && options.length >= 2
      ? options.map((o) => ({ label: String(o.label), description: text(o.description) || '' })) : null,
    recommendation: text(recommendation), why: text(why), blocks: text(blocks), not_authorized: text(not_authorized), source: text(source),
    opened_at: new Date().toISOString(), opened_by_session: session || null, status: 'open',
  };
  if (text(executor)) entry.executor = executor.trim(); // who executes the answer / who asked: close --answer delivers to them (BL cardtrail)
  if (text(asker)) entry.asker = asker.trim();
  if (KINDS.includes(kind)) entry.kind = kind; // additive: absent = unspecified
  if (origin) entry.origin = origin;
  if (turn_tracked === true) entry.turn_tracked = true; // the asker's turn file existed at open time (hooks/ask-decision.js): only then is its absence later evidence the session ended
  try {
    fs.mkdirSync(sf.dir, { recursive: true, mode: 0o700 });
    return withWriteLock({ storeDir: sf.dir, lockFile: `${sf.file}.lock`, name: path.basename(sf.file), timeoutMs: 5000 }, () => {
      writeEntries(sf, root, [...readFile(sf.file, { all: true }), entry]);
      return { status: 'ok', id: entry.id, file: sf.file, scope_key: sf.key };
    });
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

// Apply `patch` to the entry `id` of the scope `file` under the same lock. Only a card that is not closed matches (`any: true`: any card);
// `isOurs(entry)` (optional) must agree first. The entry STAYS in the file: closing keeps the record (status closed, closed_at, answer).
// Returns { status: 'updated'|'absent'|'error', entry, message }; never throws. Idempotent: a closed card is 'absent'.
function patchDecision(file, id, patch, { isOurs, any } = {}) {
  // Nothing to change: do not enter the lock, whose store dir / lock file would create decisions/ in a repo that never opened one.
  if (!fs.existsSync(file)) return { status: 'absent' };
  try {
    return withWriteLock({ storeDir: path.dirname(file), lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, () => {
      const entries = readFile(file, { all: true });
      const hit = entries.find((e) => e.id === id && (any || !isClosedEntry(e)));
      if (!hit || (isOurs && !isOurs(hit))) return { status: 'absent' };
      const next = { ...hit, ...patch };
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      writeEntries({ file, scope: { repo_identity: v.repo_identity, project_key: v.project_key } }, v.root_run_id, entries.map((e) => (e === hit ? next : e)));
      return { status: 'updated', entry: next };
    });
  } catch (error) {
    return error && error.code === 'ENOENT' ? { status: 'absent' } : { status: 'error', message: error.message };
  }
}

// Close the entry `id` of the scope `file`: patchDecision with status closed + closed_at (+ `answer` when given). Library callers (hooks)
// keep this signature; the entry is kept now, not removed. Returns { status: 'closed'|'absent'|'error', message }; never throws.
function closeDecisionById(file, id, isOurs, answer) {
  const r = patchDecision(file, id, { status: 'closed', closed_at: new Date().toISOString(), answer: typeof answer === 'string' ? answer : null }, { isOurs });
  return r.status === 'updated' ? { status: 'closed' } : r;
}

// Deliver a close --answer: a dispatch to the executor (answer verbatim + card id), an fyi note to the asker, then record the outcome on
// the card (delivery ok|failed, delivery_error). A failure is never swallowed: the card stays closed, the record says failed, exit 14.
function deliverAnswer({ id, file, question, answer, executor, asker, awaiting }) {
  const fd = require('./lib/fleet-decision.js');
  const head = `[卡片答覆 ${id}] ${question}\n答覆原文：\n${answer}\n`;
  const errs = [];
  let sent = 0;
  if (executor) {
    const d = fd.dispatch(executor, `${head}${awaiting ? `此答覆還需操作員本人動手：${awaiting}（卡片狀態 awaiting_operator_action，操作員做完會用 done 結束）\n` : ''}請依上面的答覆執行，完成後回報卡號 ${id}。`);
    if (d.ok) sent += 1; else errs.push(`dispatch to ${executor}: ${d.detail}`);
  }
  if (asker) {
    const f = fd.send(asker, `fyi ${head}${executor ? `已交給 ${executor} 執行。` : '沒有指定 executor，尚未派工。'}${awaiting ? `還需操作員本人動手：${awaiting}。` : ''}`);
    if (f.ok) sent += 1; else errs.push(`fyi to ${asker}: ${f.detail}`);
  }
  if (!executor && !asker) return 0;
  const failed = errs.length > 0;
  const rec = patchDecision(file, id, failed ? { delivery: 'failed', delivery_error: errs.join('; '), delivery_at: new Date().toISOString() } : { delivery: 'ok', delivery_at: new Date().toISOString() }, { any: true });
  if (rec.status === 'error') process.stderr.write(`open-decision: could not record delivery on ${id}: ${rec.message}\n`);
  if (failed) {
    process.stderr.write(`open-decision: ERROR: ${id} is kept (closed) but the answer was NOT fully delivered: ${errs.join('; ')}; deliver it by hand or re-run the sends (delivery: failed is on the card)\n`);
    return 14;
  }
  process.stdout.write(`delivered ${id}${executor ? ` -> ${executor}` : ''}${asker ? ` (fyi ${asker})` : ''}\n`);
  return 0;
}

// backfill --from <file.jsonl> [--apply]: put cards that were closed before the store kept them back as closed records. Each line:
// {id, question, answer, closed_at, [opened_at], [executor], [asker]} (the PM exports its ledger of closed cards in this shape). Default is a
// dry run that prints what would be added and writes nothing; --apply writes. A card already in the store (any status) is skipped, never
// overwritten. Any bad line -> exit 2 and nothing is written even with --apply. -> exit code.
function backfill(args, sf, root) {
  const ex = args.extra;
  const bad = ['answer', 'executor', 'asker', 'awaiting-operator', 'all'].find((n) => ex[n] !== undefined);
  if (bad) return usage(`--${bad} is not a backfill argument`);
  if (typeof ex.from !== 'string') return usage('backfill needs --from <file.jsonl> (one closed card per line: id, question, answer, closed_at)');
  let raw;
  try { raw = fs.readFileSync(ex.from, 'utf8'); } catch (e) { return usage(`cannot read --from: ${e.message}`); }
  const fd = require('./lib/fleet-decision.js');
  const records = [];
  const problems = [];
  raw.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let r;
    try { r = JSON.parse(line); } catch (_e) { problems.push(`line ${i + 1}: not JSON`); return; }
    const why = !r || typeof r !== 'object' ? 'not an object'
      : typeof r.id !== 'string' || !SAFE_ID.test(r.id) ? 'id missing or unsafe'
        : !text(r.question) ? 'question missing'
          : !text(r.answer) ? 'answer missing'
            : !Number.isFinite(Date.parse(r.closed_at)) ? 'closed_at is not a date'
              : r.opened_at !== undefined && !Number.isFinite(Date.parse(r.opened_at)) ? 'opened_at is not a date'
                : ['executor', 'asker'].find((k) => r[k] !== undefined && r[k] !== null && !fd.isAddress(r[k]));
    if (why) problems.push(`line ${i + 1}: ${typeof why === 'string' && !['executor', 'asker'].includes(why) ? why : `${why} is not an address`}`);
    else records.push(r);
  });
  if (problems.length) { process.stderr.write(`open-decision: backfill refused, nothing written:\n  ${problems.join('\n  ')}\n`); return 2; }
  const have = new Set(projectScopeFiles(args.cwd, { all: true }).flatMap((f) => readFile(f, { all: true })).map((e) => e.id));
  const add = [];
  const skip = [];
  for (const r of records) {
    if (have.has(r.id) || add.some((x) => x.id === r.id)) { skip.push(r.id); continue; }
    const e = {
      id: r.id, question: r.question, background: null, options: null, recommendation: null, why: null, blocks: null, not_authorized: null, source: 'backfill',
      opened_at: new Date(Date.parse(r.opened_at || r.closed_at)).toISOString(), opened_by_session: null,
      status: 'closed', closed_at: new Date(Date.parse(r.closed_at)).toISOString(), answer: r.answer, backfilled: true,
    };
    if (r.executor) e.executor = r.executor;
    if (r.asker) e.asker = r.asker;
    add.push(e);
  }
  const apply = ex.apply === true;
  process.stdout.write(`${apply ? 'APPLY' : 'DRY RUN (nothing written; add --apply)'}: ${add.length} to add, ${skip.length} already in the store${skip.length ? ` (${skip.join(', ')})` : ''}\n`);
  for (const e of add) process.stdout.write(`  ${apply ? 'add' : 'would add'} ${e.id}  closed_at=${e.closed_at}  executor=${e.executor || '-'}  asker=${e.asker || '-'}  answer=${JSON.stringify(e.answer.length > 60 ? `${e.answer.slice(0, 60)}...` : e.answer)}\n`);
  if (!apply || add.length === 0) return 0;
  try {
    fs.mkdirSync(sf.dir, { recursive: true, mode: 0o700 });
    withWriteLock({ storeDir: sf.dir, lockFile: `${sf.file}.lock`, name: path.basename(sf.file), timeoutMs: 5000 }, () => {
      writeEntries(sf, root, [...readFile(sf.file, { all: true }), ...add]);
    });
  } catch (error) {
    process.stderr.write(`open-decision: ${error.message}\n`);
    return 4;
  }
  process.stdout.write(`wrote ${add.length} closed record(s) to ${sf.file}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, checkNotAuthorized, openDecision, closeDecisionById, patchDecision, findCard, projectScopeFiles, unboundCardsOf, readEntries: readFile, SAFE_ROOT, SCHEMA };
