#!/usr/bin/env node
'use strict';

/**
 * open-decision.js — the "open owner questions" file of a watcher scope (mods P1W W2a-m; contract autopilot.decision/2).
 *
 *   node scripts/open-decision.js open  --question <q> [--background <why>] [--option <label>[::<description>]]... | --free-text
 *                                       [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] --not-authorized <boundary>[:<why the owner must decide>]
 *                                       [--doa-role <role>] [--doa-tier <tier>] [--target <deploy target>] [--source <who/where>]
 *                                       [--title <short card title, <= 20 characters>] [--kind <decide|go|step|look>] [--attach <path-or-URL>]...
 *                                       [--root-run-id <id>] [--cwd <dir>] [--json]     (prints the new id; --json: {ok,id,file,scope_key})
 *   node scripts/open-decision.js open  --kind step --question <step text> [--background <why>] [--blocks <what stalls>] [--attach <path-or-URL>]... [--source <who/where>]
 *                                       [--root-run-id <id>] [--cwd <dir>] [--json]     (operator action step: no --option, --executor or --not-authorized needed)
 *   node scripts/open-decision.js open ... --executor <address> [--asker <address>]  (--executor is REQUIRED: who carries out the answer; the PM's own cards name the PM; --asker: who asked)
 *   node scripts/open-decision.js redeliver [--id <id>] [--cwd <dir>]   (resend the panel answer of every pending_dispatch card the program parked, see "Panel answer delivery")
 *   node scripts/open-decision.js close --id <id> [--root-run-id <id>] [--cwd <dir>]   (answered or withdrawn; the card is KEPT, status closed)
 *   node scripts/open-decision.js close --id <id> --answer <text> [--executor <address>] [--asker <address>] [--awaiting-operator <step>]
 *                                       (with an executor: prints the dispatch JSON and parks the card in pending_dispatch; nothing is sent)
 *   node scripts/open-decision.js close --id <id> --dispatched <task_id>   (pending_dispatch -> closed, once the caller really dispatched)
 *   node scripts/open-decision.js done  --id <id>      (ends awaiting_operator_action: the operator's own step is done)
 *   node scripts/open-decision.js show  [--root-run-id <id>] [--all] [--json] [--cwd <dir>]    (lists every live card: open questions, awaiting_operator_action, pending_dispatch; --all: closed ones too)
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
 * every reader asks the status (src/status/scope-key.js cardState; readFile() returns open questions only, { live: true } adds awaiting_operator_action and pending_dispatch, { all: true } also closed). The watcher reads the file into the job page / live pane (src/status/decision-input.js).
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
 * --kind <decide|go|step|look> (optional): the card's kind, stored as `kind` on the entry (`decide|go` = decision cards with options/reply under 要你決定;
 * `step` = an operator step under 要你做或看, no options, --executor or --not-authorized needed, --question is the step text, --attach allowed;
 * `look` = a persistent 給你看 viewer item under 要你做或看, optional --look-target JSON). Absent = unspecified; entries without it read as before.
 * Any other value -> exit 7, nothing is written.
 * --attach <path-or-URL> (repeatable on `open`): stored on the entry in array `attachments`; rendered on the decision pane as a clickable file or Link.
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
 * Card trail (BL cardtrail). Stored fields a reader (patrol, the panel) may rely on: status ('open' | 'awaiting_operator_action' | 'pending_dispatch' | 'closed';
 * absent = open), answer (the answer text), closed_at (ISO UTC, set when status becomes closed), answered_at (set on awaiting_operator_action),
 * pending_dispatch_at (ISO UTC, set when status becomes pending_dispatch: patrol's "answered but not dispatched for 30 minutes" reads status + this),
 * dispatched_task_id (set by close --dispatched), executor and asker (fleet addresses, set at `open --executor/--asker` or at close),
 * awaiting_operator (the step the operator must do), backfilled (true on a record made by backfill). Field list: this comment and
 * references/review-page.md (decisions); schemas/decision.schema.json validates them.
 * Panel answer delivery (PM 01M6ZXJYTQ, 2026-11-09; overrides the earlier PM ruling 01M6RV0Y02 "open-decision never sends"): when the hook verifies an operator answer
 * from the live panel and the card has an executor, PROGRAM code (hooks/advisory-relay.js -> deliverAnswer here, no model) parks the card in pending_dispatch with the
 * answer (answer_id, answer_option, answer_free_text, answer_digest), then runs the shell `fleet send <executor> <text>`, which inside a session signs as THAT session (never
 * `fleet dispatch`, which signs as fleet-cli; FLEET_AS_CLI and FLEET_FYI are stripped). Success: status closed + dispatched_message_id + dispatched_via "send"; one receipt line.
 * Failure (non-zero exit, output that is not {"ok":true,"message_id":...}): the card stays pending_dispatch with dispatch_error + dispatch_attempts, never closed.
 * The card keeps every verified answer in `answers` (append-only, each with sent_message_id/sent_at); one message per answer, oldest unsent first, the card closes after the last. A replayed answer_id changes nothing. `redeliver` retries those cards with the same function. An answer with a sent_message_id is never sent again. `close --answer` below is the older, caller-dispatches path.
 * close --answer <text> [--executor A] [--asker B] (PM ruling 01M6RV0Y02, overridden for panel answers by PM 01M6ZXJYTQ (2026-11-09): this `close --answer` path sends no dispatch and no fyi; the one thing it sends is the card notice below): records the answer verbatim and
 * prints ONE JSON on stdout: { ok, id, status, answer, pending_dispatch_at, dispatch: { to, task }, fyi: { to, text } | null, then }. The CALLER dispatches
 * `dispatch.task` to `dispatch.to` (and sends `fyi.text` to `fyi.to`) with its own fleet tools, then runs `close --id <id> --dispatched <task_id>`.
 * Until then the card is pending_dispatch (not a question, not closed). --executor falls back to the one stored at open; none anywhere -> the card
 * closes directly, stdout warns "沒有 executor，不會派工", no JSON. --answer is a relay of an answer given elsewhere: it does NOT claim on the
 * fleet courier (use `verify` to prove a relayed answer first).
 * close --id <id> --dispatched <task_id>: only a pending_dispatch card; it becomes closed with dispatched_task_id + closed_at. Any other state -> exit 2 with the reason.
 * --awaiting-operator <step> (the CALLER decides, nothing is guessed): the answer is recorded but the card goes to awaiting_operator_action instead of
 * closed (with an executor the same dispatch JSON is printed, its task saying the operator still has a step); the panel shows it differently from a
 * question; `close` on such a card is refused (exit 2); `done --id` ends it.
 * backfill --from <file.jsonl>: lines {id, question, answer, closed_at, [opened_at], [executor], [asker], [status], [awaiting_operator]} become records (backfilled: true);
 * status is closed (default when absent) or awaiting_operator_action (kept with its executor; closed_at is then the time it was answered), nothing else;
 * a card already in the store is skipped; a bad line (including a bad status) refuses the whole run (exit 2). Dry run by default; --apply writes.
 * Card notices (fleetcards phase 1, PM ruling 01M6W4RNP6): `open` and `close` (the paths that leave the open state) send ONE fleet message
 * `AUTOPILOT-CARD/1 {json}` to the program PM (AUTOPILOT_CARD_NOTIFY_TO, no default: unset sends nothing) through the shell `fleet send`, which inside a
 * Claude session signs as that session. Best effort: no fleet, no courier or a refused send is silent and changes no exit code. AUTOPILOT_CARD_NOTIFY=off stops it.
 * Node built-ins only. This script writes nothing outside the decisions directory.
 * The library functions openDecision / closeDecisionById are also called by hooks/ask-decision.js (depth-0 AskUserQuestion
 * adds an entry with `origin: "ask_user_question"`; mods P1W HOOKQ).
 * Role gate: a team session that is not PM (lane or lead) does not open an owner card. The CLI and openDecision both
 * refuse before any write (exit 4, message names scripts/request-decision.js). --not-authorized irreversible, and the
 * bare alias --irreversible, are the one boundary that still opens; the CLI then tells the lane on stderr to send that
 * card id to the PM. Both flags may be given; one field is stored. origin permission_prompt is exempt.
 * --from-request <r-id> stores from_request on the entry.
 *
 * `open` also ensures a watcher publishes the card (src/status/card-visibility.js: the autostart hook's start path, plus the plain session marker).
 * verify: the hub compares, this host never sees the stored hash. It probes the fleet CLI, then calls lib/fleet-decision.js verify() (local call first,
 * on hub exit 7 a second call with the sha256 of the received text, CRLF->LF, trailing newlines stripped). Pass = exit 0, prints the line 內容核實 (console answer: the text was compared) or 答覆核實 (via=local: only the answer id was proven, the text was NOT compared) plus the
 * hub's STORED answer as JSON: act on that, never on the relayed text. Needs no git repo. Never exits 0 on anything else (fail closed).
 * Verify exits: 9 no fleet binary or no `fleet decision` | 10 hub unreachable | 11 other error / probe failed | 12 unverified (card, answer id or content does not match; the hub does not say which) |
 *       13 verified but the stored answer carries no content (via=local off the owner host): only the answer id is proven.
 * Exit: 0 ok (show: at least one live card) | 1 show: none live (show --id: no such card) | 2 usage / close or --dispatched refused (card not in the needed state) / not a git repo / missing or unknown --not-authorized | 3 open refused: the boundary is inside this session's DOA (or unverifiable) | 4 write failure, or a non-PM team session refused by the role gate (nothing written) |
 *       8 close refused: the card's answer could not be claimed on the fleet courier (unreachable after bounded retries, or an unusable reply); the card stays OPEN |
 *       7 open refused: --kind is not decide|go|step|look (nothing is written) |
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
const { scopeKeyOf, commonDirOf, listScopeFiles, readScopeFile, cardState, pickCards, isOpenEntry, isClosedEntry, isAwaitingEntry, isPendingDispatchEntry } = require('../src/status/scope-key');
const { withWriteLock } = require('./lib/jsonl-store');

const SCHEMA = 'autopilot.decision/2';
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function usage(message) {
  if (message) process.stderr.write(`open-decision: ${message}\n`);
  process.stderr.write('usage: open-decision.js open --question <q> [--background <why>] [--option <label>[::<description>]]... | --free-text [--recommendation <label>] [--why <reason>] [--blocks <what stalls>] --not-authorized <boundary>[:<why the owner must decide>] [--irreversible] [--from-request <r-id>] [--doa-role <role>] [--doa-tier <tier>] [--target <deploy target>] [--source <who/where>] [--kind <decide|go|step|look>] [--attach <path-or-URL>]... [--root-run-id <id>]\n'
    + '       open-decision.js open --kind step --question <step text> [--background <why>] [--blocks <what stalls>] [--attach <path-or-URL>]... [--source <who/where>] [--root-run-id <id>]\n'
    + '       open-decision.js close --id <id> [--root-run-id <id>]\n       open-decision.js close --id <id> --answer <text> [--executor <address>] [--asker <address>] [--awaiting-operator <step>]\n       open-decision.js close --id <id> --dispatched <task_id>\n       open-decision.js done --id <id>\n       open-decision.js verify --id <card_id> --answer-id <id> --text-file <file>\n       open-decision.js show [--root-run-id <id>] [--all] [--json]\n       open-decision.js show --id <id> [--json]\n       open-decision.js list [--all] [--json]\n       open-decision.js backfill --from <file.jsonl> [--apply]\n       (decision open REQUIRES --executor <address>; it also takes --asker <address> --title <short title, <= 20 characters>)\n');
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

// The OPEN questions of a scope file ([] = none / unreadable / another schema). An answered card stays in the file as a record: closed, or
// awaiting_operator_action / pending_dispatch (answered, someone still has a step). `{ live: true }` also returns those two, `{ all: true }` every
// card. "In the file" is never "open": ask the state (scope-key.js cardState), not the file.
function readFile(file, { all = false, live = false } = {}) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && v.schema === SCHEMA && Array.isArray(v.decisions) ? v.decisions.filter((e) => validEntry(e) && (all || (live ? !isClosedEntry(e) : isOpenEntry(e)))) : [];
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

// Like findCard({ all: true }) but the winning record when the id sits in several scope files (read-only views: show --id).
function findBest(cwd, id) {
  const hits = projectScopeFiles(cwd, { all: true }).flatMap((file) => readFile(file, { all: true }).filter((e) => e.id === id).map((e) => ({ file, e })));
  const w = pickCards(hits)[0];
  return w ? { file: w.file, entry: w.e } : null;
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
  const n = (st) => entries.filter((e) => cardState(e) === st).length;
  // "open decisions" counts the pending questions only; awaiting_operator_action / pending_dispatch / closed cards are counted apart, never as 待決
  const out = [all ? `decisions: ${entries.length}` : `open decisions: ${n('open')}`];
  for (const st of ['awaiting_operator_action', 'pending_dispatch', ...(all ? ['closed'] : [])]) if (n(st)) out.push(`${st}: ${n(st)}`);
  entries.forEach((e, i) => {
    out.push('', `[${i + 1}] ${e.id}  ${e.question}`);
    if (e.title) out.push(`    title: ${e.title}`);
    if (e.status && e.status !== 'open') out.push(`    status: ${e.status}`);
    if (e.awaiting_operator) out.push(`    awaiting_operator: ${e.awaiting_operator}`);
    if (e.answer) out.push(`    answer: ${e.answer}`);
    if (e.answered_at) out.push(`    answered_at: ${e.answered_at}`);
    if (e.closed_at) out.push(`    closed_at: ${e.closed_at}`);
    if (e.executor) out.push(`    executor: ${e.executor}`);
    if (e.asker) out.push(`    asker: ${e.asker}`);
    if (e.pending_dispatch_at) out.push(`    pending_dispatch_at: ${e.pending_dispatch_at}`);
    if (e.dispatched_task_id) out.push(`    dispatched_task_id: ${e.dispatched_task_id}`);
    if (e.background) out.push(`    background: ${e.background}`);
    if (Array.isArray(e.options)) e.options.forEach((o, k) => out.push(`    option ${k + 1}: ${o.label}${o.description ? ` — ${o.description}` : ''}`));
    if (e.recommendation) out.push(`    recommendation: ${e.recommendation}${e.why ? ` (${e.why})` : ''}`);
    else if (e.why) out.push(`    why: ${e.why}`);
    if (e.blocks) out.push(`    blocks: ${e.blocks}`);
    if (e.not_authorized) out.push(`    not_authorized: ${e.not_authorized}`);
    if (e.kind) out.push(`    kind: ${e.kind}`);
    if (Array.isArray(e.attachments) && e.attachments.length) out.push(`    attach: ${e.attachments.join(', ')}`);
    if (e.source) out.push(`    source: ${e.source}`);
    out.push(`    opened: ${e.opened_at}`);
  });
  return `${out.join('\n')}\n`;
}

// --target is lifted out before parse(): the flag set of parse() is pinned byte-for-byte by the frozen ask stub of the
// d0gate-v2 evaluation (hooks/tests/skill-onoff-d0gate-v2.test.sh), which must not change.
const KINDS = ['decide', 'go', 'step', 'look'];
const TITLE_MAX = 20; // code points (Array.from), same unit as cardTitle
// --kind is lifted out the same way (same frozen-stub reason): { rest, kind } | { error }.
function takeKind(argv) {
  const i = argv.indexOf('--kind');
  if (i < 0) return { rest: argv };
  if (i + 1 >= argv.length) return { error: '--kind needs a value' };
  return { rest: [...argv.slice(0, i), ...argv.slice(i + 2)], kind: argv[i + 1] };
}

// Repeatable --attach <path-or-URL>, lifted before parse() for the same frozen-stub reason.
function takeAttach(argv) {
  const rest = [];
  const attachments = [];
  const ctl = /[\x00-\x1f\x7f]/;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--attach') {
      if (i + 1 >= argv.length) return { error: '--attach needs a path or URL' };
      const v = String(argv[i + 1]).trim();
      if (!v || ctl.test(v)) return { error: '--attach needs a non-empty path or URL without control characters' };
      attachments.push(v);
      i += 1;
    } else rest.push(argv[i]);
  }
  return { rest, attachments };
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
// -> { rest, extra: { answer, executor, asker, 'awaiting-operator', from, dispatched, title, all, apply } } | { error }
const EXTRA_VALUED = ['answer', 'executor', 'asker', 'awaiting-operator', 'from', 'dispatched', 'title', 'from-request', 'look-target'];
const EXTRA_SWITCH = ['all', 'apply', 'irreversible'];
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

// Phase-1 fleetcards: tell the program PM that a card opened or left the open state (scripts/lib/card-notice.js; PM mirror: scripts/fleet-card-mirror.js).
// Best effort and silent: no fleet binary, no courier, a refused send never changes this script's exit code or output.
function notifyPm(event, fields) {
  try { require('./lib/card-notice.js').notify(event, { ...fields, session: sessionForNotice() }); } catch (_e) { /* never fails the card */ }
}
function sessionForNotice() {
  const raw = process.env.CLAUDE_CODE_SESSION_ID;
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

function main(argv) {
  const kk = takeKind(argv);
  if (kk.error) return usage(kk.error);
  const at = takeAttach(kk.rest);
  if (at.error) return usage(at.error);
  const ft = takeFreeText(at.rest);
  if (ft.error) return usage(ft.error);
  const tk = takeTarget(ft.rest);
  if (tk.error) return usage(tk.error);
  const xt = takeExtra(tk.rest);
  if (xt.error) return usage(xt.error);
  const args = parse(xt.rest);
  args.extra = xt.extra;
  args.attachments = at.attachments;
  if (kk.kind !== undefined) args.kind = kk.kind;
  if (ft.freeText !== undefined) args.closeFreeText = ft.freeText;
  if (args.error) return usage(args.error);
  if (tk.target !== undefined) args.target = tk.target;
  const cmd = args._[0];
  if (args.attachments.length > 0 && cmd !== 'open') return usage('--attach is only an open argument');
  if (args.extra['look-target'] !== undefined && cmd !== 'open') return usage('--look-target is only an open argument');
  if (cmd === 'verify' && args._.length === 1) return verifyAnswer(args);
  if (!['open', 'close', 'done', 'show', 'list', 'backfill', 'redeliver'].includes(cmd) || args._.length > 1) return usage(cmd ? `bad command: ${args._.join(' ')}` : 'missing command');
  const sess = sessionRoot();
  const root = args['root-run-id'] !== undefined ? args['root-run-id'] : (process.env.AUTOPILOT_ROOT_RUN_ID || sess.root);
  if (root && (!SAFE_ROOT.test(root) || root === '.' || root === '..')) return usage('--root-run-id must match [A-Za-z0-9._-]+');
  const sf = scopeFile(args.cwd, root);
  if (!sf) return usage('not inside a git repository');

  const ex = args.extra;
  const stray = (names) => names.find((n) => ex[n] !== undefined);
  if (cmd === 'show' || cmd === 'list') {
    if (cmd === 'list' && args.id !== undefined) return usage('list takes no --id (use `show --id <id>`)');
    const bad = stray(['answer', 'executor', 'asker', 'awaiting-operator', 'from', 'apply', 'dispatched', 'irreversible', 'from-request']);
    if (bad) return usage(`--${bad} is not a ${cmd} argument`);
    if (args.id !== undefined) { // show --id: ONE card, closed ones too
      if (!SAFE_ID.test(args.id)) return usage('show --id <id> needs a card id (see `list --all`)');
      const hit = findBest(args.cwd, args.id);
      if (!hit) { if (!args.json) process.stdout.write(`no such decision: ${args.id}\n`); return 1; }
      process.stdout.write(args.json ? `${JSON.stringify({ schema: SCHEMA, decisions: [hit.entry] }, null, 2)}\n` : showText([hit.entry], { all: true }));
      return 0;
    }
    const all = ex.all === true;
    const entries = pickCards(projectScopeFiles(args.cwd, { all: true }).flatMap((file) => readFile(file, { all: true }).map((e) => ({ file, e })))).map((w) => w.e)
      .filter((e) => (all ? true : !isClosedEntry(e)))
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
    if (isPendingDispatchEntry(hit.entry)) return usage(`${args.id} is pending_dispatch, not awaiting_operator_action; dispatch it, then \`close --id ${args.id} --dispatched <task_id>\``);
    const r = patchDecision(hit.file, args.id, { status: 'closed', closed_at: new Date().toISOString() }, { any: true, isOurs: isAwaitingEntry });
    if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
    process.stdout.write(`closed ${args.id} (operator step done)\n`);
    return 0;
  }
  if (cmd === 'backfill') return backfill(args, sf, root || null);
  if (cmd === 'redeliver') {
    const badR = stray(['answer', 'executor', 'asker', 'awaiting-operator', 'from', 'apply', 'dispatched', 'all', 'irreversible', 'from-request']);
    if (badR) return usage(`--${badR} is not a redeliver argument`);
    if (args.id !== undefined && !SAFE_ID.test(args.id)) return usage('redeliver --id <id> needs a card id');
    return redeliver(args);
  }
  if (cmd === 'close') {
    if (typeof args.id !== 'string' || !SAFE_ID.test(args.id)) return usage('close needs --id <id> (see `show`)');
    const bad = stray(['all', 'apply', 'from', 'irreversible', 'from-request']);
    if (bad) return usage(`--${bad} is not a close argument`);
    if (ex.dispatched !== undefined) return markDispatched(args, ex);
    const viaOption = args.option.length > 0 || args.closeFreeText !== undefined;
    if (args.option.length > 1 || (args.option.length && args.closeFreeText !== undefined)) return usage('close takes one --option <label> or one --free-text <text>');
    if (ex.answer !== undefined && (viaOption || !ex.answer.trim())) return usage('close --answer <text> is the whole answer: not with --option/--free-text, and not empty');
    if (ex.answer === undefined && (ex['awaiting-operator'] !== undefined || ex.executor !== undefined || ex.asker !== undefined)) return usage('--executor/--asker/--awaiting-operator belong to `close --answer <text>`');
    if (ex['awaiting-operator'] !== undefined && !ex['awaiting-operator'].trim()) return usage('--awaiting-operator needs the step the operator must do');
    for (const k of ['executor', 'asker']) if (ex[k] !== undefined && !require('./lib/fleet-decision.js').isAddress(ex[k])) return usage(`--${k} "${ex[k]}" is not an address (namespace/courier/member)`);
    const found = findCard(args.cwd, args.id, { live: true });
    if (found && isAwaitingEntry(found.entry)) return usage(`${args.id} is awaiting_operator_action: the operator's step ends it (\`done --id ${args.id}\`), not close`);
    if (found && isPendingDispatchEntry(found.entry)) return usage(`${args.id} is pending_dispatch: it is closed by \`close --id ${args.id} --dispatched <task_id>\` once the dispatch is really sent, not by another close`);
    if (viaOption) {
      const g = claimBeforeClose(args);
      if (g.code !== 0) return g.code;
    }
    const answerText = ex.answer !== undefined ? ex.answer : (args.option.length ? args.option[0] : (args.closeFreeText !== undefined ? args.closeFreeText : null));
    const executor = ex.executor || (found && found.entry.executor) || null;
    const asker = ex.asker || (found && found.entry.asker) || null;
    const now = new Date().toISOString();
    const awaiting = ex['awaiting-operator'] !== undefined;
    const parked = !awaiting && answerText !== null && !!executor; // answered with an executor: the caller still has to dispatch
    const patch = awaiting
      ? { status: 'awaiting_operator_action', answered_at: now, answer: answerText, awaiting_operator: ex['awaiting-operator'].trim() }
      : (parked ? { status: 'pending_dispatch', pending_dispatch_at: now, answer: answerText } : { status: 'closed', closed_at: now, answer: answerText });
    if (executor && answerText !== null) patch.executor = executor;
    if (asker && answerText !== null) patch.asker = asker;
    let r = { status: 'absent' };
    for (const f of projectScopeFiles(args.cwd)) {
      r = patchDecision(f, args.id, patch);
      if (r.status !== 'absent') { r.file = f; break; }
    }
    if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
    if (r.status === 'absent') { process.stdout.write(`not open: ${args.id}\n`); return 0; }
    notifyPm('close', { card_id: args.id, question: r.entry.question, state: patch.status });
    if (answerText !== null && executor && (awaiting || parked)) {
      process.stdout.write(`${JSON.stringify(dispatchPacket({ id: args.id, question: r.entry.question, answer: answerText, executor, asker, awaiting: awaiting ? patch.awaiting_operator : null, status: patch.status, at: now }))}\n`);
      return 0;
    }
    process.stdout.write(awaiting ? `awaiting_operator_action ${args.id}\n` : `closed ${args.id}\n`);
    if (answerText !== null && !executor) process.stdout.write(`警告：${args.id} 沒有 executor，不會派工（開卡時沒帶 --executor，close 也沒帶）\n`);
    return 0;
  }

  // open
  if (typeof args.question !== 'string' || !args.question.trim()) return usage('open needs a non-empty --question');
  if (args.kind !== undefined && !KINDS.includes(args.kind)) { process.stderr.write(`open-decision: refused: --kind must be one of ${KINDS.join(' | ')} (got "${args.kind}"); nothing written\n`); return 7; }
  const isStepKind = args.kind === 'step' || args.kind === 'look';
  if (isStepKind) {
    if (args.option.length) return usage(`--kind ${args.kind} takes no --option (--question is the step text)`);
  } else {
    if (args['free-text'] && args.option.length) return usage('--free-text and --option are mutually exclusive: a free-text card has no options');
    if (args.option.length === 1) return usage('--option needs at least two options');
    if (!args.option.length && !args['free-text']) return usage('a decision card needs at least two --option <label>::<description>; for a question answered in typed text pass --free-text');
  }
  const bad = ['answer', 'awaiting-operator', 'from', 'all', 'apply', 'dispatched'].find((n) => ex[n] !== undefined);
  if (bad) return usage(`--${bad} is not an open argument`);
  let lookTarget = null;
  if (ex['look-target'] !== undefined) {
    if (args.kind !== 'look') return usage('--look-target requires --kind look');
    try { lookTarget = JSON.parse(ex['look-target']); } catch (_e) { return usage('--look-target must be valid JSON'); }
    if (!lookTarget || typeof lookTarget !== 'object' || Array.isArray(lookTarget)) return usage('--look-target must be a JSON object');
  }
  if (!isStepKind && ex.executor === undefined) return usage('open needs --executor <address> (namespace/courier/member): the program delivers the operator\'s answer to it; a card the PM handles itself names the PM address');
  if (ex.title !== undefined && (!ex.title.trim() || Array.from(ex.title).length > TITLE_MAX || require('./lib/card-notice.js').CONTROL.test(ex.title))) { process.stderr.write(`open-decision: refused: --title must be non-empty, free of control characters, and at most ${TITLE_MAX} characters (got ${Array.from(ex.title).length}); it is never cut for you; nothing written\n`); return 2; }
  for (const k of ['executor', 'asker']) if (ex[k] !== undefined && !require('./lib/fleet-decision.js').isAddress(ex[k])) return usage(`--${k} "${ex[k]}" is not an address (namespace/courier/member)`);
  const options = !isStepKind && args.option.length ? parseOptions(args.option) : null;
  if (options && options.some((o) => !o.label)) return usage('--option labels must be non-empty');
  if (args.target !== undefined) {
    const t = checkTarget(path.resolve(args.cwd || process.cwd()), args['doa-role'] || 'manager', args['doa-tier'] || 'sonnet', args.target);
    if (t.refused) { process.stderr.write(`open-decision: refused: ${t.refused}\n`); return 6; }
  }
  const aliasErr = applyIrreversibleAlias(args, ex);
  if (aliasErr) return usage(aliasErr);
  if (ex['from-request'] !== undefined && !/^r-[0-9a-f]{8}$/.test(String(ex['from-request']))) return usage('--from-request needs an id r- plus 8 hex');
  let routed = null;
  if (!isStepKind || args['not-authorized'] !== undefined) {
    const gate = checkNotAuthorized(args['not-authorized'], { cwd: path.resolve(args.cwd || process.cwd()), role: args['doa-role'] || 'manager', tier: args['doa-tier'] || 'sonnet', autonomous: isAutonomous() });
    if (gate.code === 2) return usage(gate.message);
    if (gate.code === 3) { process.stderr.write(`open-decision: refused: ${gate.message}\n`); return 3; }
    if (gate.warning) process.stderr.write(`open-decision: warning: ${gate.warning}\n`);
    routed = roleGate({ not_authorized: args['not-authorized'], kind: args.kind });
    if (routed && routed.code === 4) { process.stderr.write(`open-decision: ${routed.message}\n`); return 4; }
  }
  const r = openDecision({
    cwd: args.cwd || process.cwd(), root: root || null, session: sess.session, question: args.question, background: args.background,
    options, recommendation: args.recommendation, why: args.why, blocks: args.blocks, not_authorized: args['not-authorized'], source: args.source, kind: args.kind, executor: ex.executor, asker: ex.asker, title: ex.title,
    from_request: ex['from-request'], attachments: args.attachments, look_target: lookTarget,
  });
  if (r.status === 'ok' && !root) {
    // The card is in the unbound scope. Every panel of the project lists it (src/status/decision-input.js reads all scope files), so this is
    // information, not a loss: say once on stderr where it went (stdout stays the bare id).
    process.stderr.write(`open-decision: note: card ${r.id} written to the UNBOUND scope (${sess.why || 'no root'}); scope_key=${r.scope_key} file=${r.file}; every panel of this project lists unbound cards too, and --root-run-id <id> would bind it to one session root\n`);
  }
  if (r.status === 'ok') {
    notifyPm('open', { card_id: r.id, question: args.question, state: 'open', ...(ex.title !== undefined ? { title: ex.title } : {}) });
    process.stdout.write(args.json ? `${JSON.stringify({ ok: true, id: r.id, file: r.file, scope_key: r.scope_key })}\n` : `${r.id}\n`);
    if (routed && routed.allow) process.stderr.write(`open-decision: 把卡片編號 ${r.id} 送給 PM。\n`);
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

function boundaryIdOf(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  const at = value.indexOf(':');
  return (at < 0 ? value : value.slice(0, at)).trim().toLowerCase();
}

// --irreversible is a bare alias of --not-authorized irreversible. Both may be given; one field is stored.
// A different boundary next to the alias is usage (the caller must not get a silent second value).
function applyIrreversibleAlias(args, extra) {
  if (!extra || !extra.irreversible) return null;
  const current = typeof args['not-authorized'] === 'string' ? args['not-authorized'].trim() : '';
  if (!current) { args['not-authorized'] = 'irreversible'; return null; }
  if (boundaryIdOf(current) !== 'irreversible') return '`--irreversible` is `--not-authorized irreversible`; it conflicts with --not-authorized ' + current;
  return null;
}

// permission-prompt path and operator step/look items without a DOA boundary are out of scope of card routing; PM ruling 2026-11-12
function roleGate({ not_authorized, origin, kind } = {}) {
  if (origin === 'permission_prompt') return null;
  if ((kind === 'step' || kind === 'look') && !text(not_authorized)) return null;
  let role = 'solo';
  try { role = require('./lib/team.js').resolve().role; } catch { role = 'lane'; }
  if (role === 'solo' || role === 'pm') return null;
  if (boundaryIdOf(not_authorized) === 'irreversible') return { allow: true, role };
  return { code: 4, role, message: `refused: a ${role} session does not open an owner card; send the question with scripts/request-decision.js; nothing written` };
}

// Library entry (also used by hooks/ask-decision.js — mods P1W HOOKQ): append one entry to the scope file through the same
// lock + atomic-rename path as `open`; another entry is never touched. `origin` (e.g. "ask_user_question") marks which hook
// opened it; the CLI never sets it. `options` = [{label, description}] (>= 2) or null.
// Returns { status: 'ok'|'error', id, file, scope_key, message, code? }.
function openDecision({ cwd, root, session, question, background, options, recommendation, why, blocks, not_authorized, source, origin, turn_tracked, kind, executor, asker, title, from_request, attachments, look_target }) {
  const routed = roleGate({ not_authorized, origin, kind });
  if (routed && routed.code === 4) return { status: 'error', code: 4, message: routed.message };
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
  if (text(executor)) entry.executor = executor.trim(); // who executes the answer / who asked: close --answer puts them in the dispatch JSON (BL cardtrail)
  if (text(asker)) entry.asker = asker.trim();
  if (text(from_request)) entry.from_request = from_request.trim();
  if (typeof title === 'string' && title !== '') entry.title = title; // additive: absent = the readers derive one (cardTitle in src/status/decision-input.js)
  if (KINDS.includes(kind)) entry.kind = kind; // additive: absent = unspecified
  if (Array.isArray(attachments)) {
    const clean = attachments.map((a) => (typeof a === 'string' ? a.trim() : '')).filter((a) => a && !/[\x00-\x1f\x7f]/.test(a));
    if (clean.length > 0) entry.attachments = clean;
  }
  if (look_target && typeof look_target === 'object' && !Array.isArray(look_target)) entry.look_target = look_target;
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

// Apply `patch` to the entry `id` of the scope `file` under the same lock. Only an OPEN question matches (`any: true`: a card in any state);
// `isOurs(entry)` (optional) must agree first. The entry STAYS in the file: closing keeps the record (status closed, closed_at, answer).
// Returns { status: 'updated'|'absent'|'error', entry, message }; never throws. Idempotent: an answered card (any state but open) is 'absent'.
function patchDecision(file, id, patch, { isOurs, any } = {}) {
  // Nothing to change: do not enter the lock, whose store dir / lock file would create decisions/ in a repo that never opened one.
  if (!fs.existsSync(file)) return { status: 'absent' };
  try {
    return withWriteLock({ storeDir: path.dirname(file), lockFile: `${file}.lock`, name: path.basename(file), timeoutMs: 3000 }, () => {
      const entries = readFile(file, { all: true });
      const hit = entries.find((e) => e.id === id && (any || isOpenEntry(e)));
      if (!hit || (isOurs && !isOurs(hit))) return { status: 'absent' };
      const next = { ...hit, ...(typeof patch === 'function' ? patch(hit) : patch) }; // a function patch sees the stored entry under the lock (appending to an array field)
      const v = JSON.parse(fs.readFileSync(file, 'utf8'));
      writeEntries({ file, scope: { repo_identity: v.repo_identity, project_key: v.project_key } }, v.root_run_id, entries.map((e) => (e === hit ? next : e)));
      return { status: 'updated', entry: next };
    });
  } catch (error) {
    return error && error.code === 'ENOENT' ? { status: 'absent' } : { status: 'error', message: error.message };
  }
}

// Record a correction of an answer on the entry `id` (any state: the card is normally closed already). Appends to `answer_corrections`; status, closed_at and answer are NOT touched,
// so a correction can neither close nor reopen a card. -> { status: 'updated'|'absent'|'error' }.
function recordCorrection(file, id, correction) {
  return patchDecision(file, id, (hit) => ({ answer_corrections: [...(Array.isArray(hit.answer_corrections) ? hit.answer_corrections : []), correction] }), { any: true });
}

// Close the entry `id` of the scope `file`: patchDecision with status closed + closed_at (+ `answer` when given). Library callers (hooks)
// keep this signature; the entry is kept now, not removed. Returns { status: 'closed'|'absent'|'error', message }; never throws.
function closeDecisionById(file, id, isOurs, answer) {
  const r = patchDecision(file, id, { status: 'closed', closed_at: new Date().toISOString(), answer: typeof answer === 'string' ? answer : null }, { isOurs });
  return r.status === 'updated' ? { status: 'closed' } : r;
}

// The dispatch a caller must send for `close --answer` with an executor (PM ruling 01M6RV0Y02 — overridden for panel answers by PM 01M6ZXJYTQ, 2026-11-09, see deliverAnswer: this `close --answer` packet is still not sent by this script). Plain data, printed as one JSON.
function dispatchPacket({ id, question, answer, executor, asker, awaiting, status, at }) {
  const head = `[卡片答覆 ${id}] ${question}\n答覆原文：\n${answer}\n`;
  const task = `${head}${awaiting ? `此答覆還需操作員本人動手：${awaiting}（卡片狀態 awaiting_operator_action，操作員做完會用 done 結束）\n` : ''}請依上面的答覆執行，完成後回報卡號 ${id}。`;
  const out = { ok: true, id, status, answer };
  if (status === 'pending_dispatch') out.pending_dispatch_at = at;
  out.dispatch = { to: executor, task };
  out.fyi = asker ? { to: asker, text: `fyi ${head}已交給 ${executor} 執行。${awaiting ? `還需操作員本人動手：${awaiting}。` : ''}` } : null;
  out.then = status === 'pending_dispatch'
    ? `送出 dispatch（和 fyi）之後執行：node scripts/open-decision.js close --id ${id} --dispatched <task_id>`
    : `操作員做完後執行：node scripts/open-decision.js done --id ${id}`;
  return out;
}

// ---- Panel answer delivery (PM 01M6ZXJYTQ, 2026-11-09; overrides PM ruling 01M6RV0Y02 for panel answers). Header: "Panel answer delivery". ----
// The sender is ONE function so a later session-signed dispatch can replace it. It must stay the shell `fleet send` (session-signed inside Claude Code);
// `fleet dispatch` signs as <ns>/<courier>/fleet-cli and FLEET_AS_CLI forces that identity, so both are kept out.
const SEND_TIMEOUT_MS = 20000;
const CLAIM_MARGIN_MS = 10000; // a claim younger than SEND_TIMEOUT_MS + this is live
const CLAIM_PID_CAP_MS = 300000; // an older claim still counts while its pid lives, but never longer than this (pid reuse)
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// A claim ({pid, at}) written under the decision-file lock before a send: another caller that sees a live one does not send.
function claimLive(cl, now) {
  if (!cl || typeof cl !== 'object') return false;
  const age = now - Date.parse(cl.at);
  if (!Number.isFinite(age)) return false;
  return age < SEND_TIMEOUT_MS + CLAIM_MARGIN_MS || (Number.isInteger(cl.pid) && pidAlive(cl.pid) && age < CLAIM_PID_CAP_MS);
}

function parseSent(stdout) {
  try {
    const j = JSON.parse(String(stdout || '').trim());
    return j && j.ok === true && typeof j.message_id === 'string' && j.message_id ? { ok: true, message_id: j.message_id } : null;
  } catch (_e) { return null; }
}

function sendFleet(to, text, timeoutMs = SEND_TIMEOUT_MS) {
  const env = { ...process.env };
  delete env.FLEET_AS_CLI;
  delete env.FLEET_FYI; // the executor must act on this: not an FYI
  const r = spawnSync(process.env.AUTOPILOT_FLEET_BIN || 'fleet', ['send', to, text], { encoding: 'utf8', timeout: timeoutMs, env });
  if (r.error) {
    // a timeout can come after the hub committed the send: a message id already on stdout means it went out (a resend would duplicate it)
    const sent = parseSent(r.stdout);
    if (sent) return sent;
    return { ok: false, error: r.error.code === 'ENOENT' ? 'no fleet binary' : r.error.message };
  }
  if (r.status !== 0) return { ok: false, error: `fleet send exit ${r.status}: ${String(r.stderr || '').trim().split('\n')[0] || 'no output'}` };
  let j;
  try { j = JSON.parse(String(r.stdout).trim()); } catch (_e) { return { ok: false, error: 'fleet send exit 0 but stdout is not JSON' }; }
  if (!j || j.ok !== true || typeof j.message_id !== 'string' || !j.message_id) return { ok: false, error: 'fleet send exit 0 but the output has no ok:true + message_id' };
  return { ok: true, message_id: j.message_id };
}

const nonEmpty = (x) => (typeof x === 'string' && x !== '' ? x : null);
// Local fallback when verify stdout has no answer_digest. Binds the card: sha256 of the fixed-key
// JSON {answer_id, card_id, free_text, option} (keys in that order). Absent text is null.
// cardId and answerId are arguments; nothing else is read.
const answerDigest = (cardId, answerId, freeText, option) => crypto.createHash('sha256').update(JSON.stringify({
  answer_id: answerId,
  card_id: cardId,
  free_text: nonEmpty(freeText),
  option: nonEmpty(option),
})).digest('hex');

// The delivery text: one field per line, the receiver's rule "Operator answers on PM cards" trusts it by the attested `from`. Values are verbatim (a multi-line value continues on the next lines).
function deliveryText(c) {
  const opt = Array.isArray(c.options) ? c.options.find((o) => o.label === c.answer_option) : null;
  const optionLine = c.answer_option === null || c.answer_option === undefined ? '(none)' : (opt && opt.description ? `${c.answer_option} — ${opt.description}` : c.answer_option);
  const lines = [`[操作員答覆] ${c.id}`, `answer_id: ${c.answer_id}`, `executor: ${c.executor}`, `question: ${c.question}`, `option: ${optionLine}`,
    `free_text: ${nonEmpty(c.answer_free_text) === null ? '(none)' : c.answer_free_text}`, `answer_digest: ${c.answer_digest}`];
  if (nonEmpty(c.request_id)) lines.push(`request_id: ${c.request_id}`);
  return lines.join('\n');
}

const receiptLine = (r) => (r.status === 'in_flight'
  ? `[答覆送出中] ${r.id} → ${r.executor}: 另一個程序正在送出，這次未重送`
  : r.status === 'sent' || r.status === 'already'
  ? `[答覆已送達] ${r.id} → ${r.executor} message_id=${r.message_id}${r.status === 'already' ? '（先前已送，未重送）' : ''}`
  : `[答覆未送達] ${r.id} → ${r.executor}: ${r.error}（第 ${r.attempts} 次；卡片留在 pending_dispatch；重送：node scripts/open-decision.js redeliver --id ${r.id}）`);

// ---- Card answers (append-only). card.answers = [{ answer_id, answer, answer_option, answer_free_text, answer_digest, sent_message_id|null, sent_at|null }].
// An entry is never edited except to stamp its own sent_message_id/sent_at, and never removed. The top-level answer / answer_id / ... fields mirror the LATEST entry for readers
// (the panel, patrol); sending reads answers[] only. A card from before this shape (single answer fields, next_answer, sent_answers, dispatched_message_id) is read as answers[] here.
function answersOf(h) {
  if (Array.isArray(h.answers)) return h.answers;
  const sentBefore = new Map((Array.isArray(h.sent_answers) ? h.sent_answers : []).map((s) => [s.answer_id, s]));
  const out = [];
  const add = (f, sentId, sentAt) => { if (!out.some((x) => x.answer_id === f.answer_id)) out.push({ answer_id: f.answer_id, answer: f.answer, answer_option: f.answer_option, answer_free_text: f.answer_free_text, answer_digest: f.answer_digest, sent_message_id: sentId || null, sent_at: sentAt || null }); };
  for (const s of sentBefore.values()) add({ answer_id: s.answer_id }, s.message_id, s.at);
  if (h.answer_id || h.dispatched_message_id) {
    const s = sentBefore.get(h.answer_id);
    add({ answer_id: h.answer_id || null, answer: h.answer, answer_option: h.answer_option, answer_free_text: h.answer_free_text, answer_digest: h.answer_digest }, h.dispatched_message_id || (s && s.message_id), h.dispatched_at || (s && s.at));
  }
  if (h.next_answer && h.next_answer.answer_id) add(h.next_answer);
  return out;
}
// The patch that stores `a` as the card's answers[] (and drops the pre-array fields). Applied by every writer, so a card is migrated by its first write.
const withAnswers = (a) => ({ answers: a, next_answer: undefined, sent_answers: undefined });
const lastSent = (a) => [...a].reverse().find((x) => x.sent_message_id) || null;

const MIN_SEND_WINDOW_MS = 5000; // less time than this left on the caller's deadline: no send is started
const REDELIVER_BUDGET_MS = 90000; // `redeliver` gives each card this long from its start

// Send every unsent answer of a parked card, oldest first, one message each, under one claim held across the whole loop (dispatch_claim {pid, at}, taken under the decision-file lock).
// Another pid's live claim -> in_flight (the holder's loop sends whatever is appended meanwhile). The card closes only in the locked write that finds no unsent answer; that same
// write drops the claim, so an answer appended meanwhile is either seen by that check or arrives after the release and its own sendParked sends it.
// `deadline` is an absolute ms epoch. -> { status: 'sent'|'failed'|'deferred'|'already'|'in_flight'|'not_parked'|'absent'|'error', id, executor, message_id?, error?, attempts? }
function sendParked(file, id, sender = sendFleet, { deadline = Date.now() + SEND_TIMEOUT_MS } = {}) {
  let seen = null;
  let won = false;
  const cl = patchDecision(file, id, (h) => {
    seen = h;
    const a = answersOf(h);
    if (!isPendingDispatchEntry(h) || !h.executor || a.length === 0) return {};
    const k = h.dispatch_claim;
    if (claimLive(k, Date.now()) && k.pid !== process.pid) return {};
    won = true;
    return { ...withAnswers(a), dispatch_claim: { pid: process.pid, at: new Date().toISOString() } };
  }, { any: true });
  if (cl.status === 'absent') return { status: 'absent', id };
  if (cl.status === 'error') return { status: 'error', id, error: cl.message };
  if (!won) {
    if (!isPendingDispatchEntry(seen)) return seen.dispatched_message_id && isClosedEntry(seen) ? { status: 'already', id, executor: seen.executor, message_id: seen.dispatched_message_id } : { status: 'not_parked', id };
    if (!seen.executor || answersOf(seen).length === 0) return { status: 'not_parked', id };
    return { status: 'in_flight', id, executor: seen.executor };
  }
  let last = null;
  for (;;) {
    let next = null;
    let card = null;
    let allSent = false;
    const pick = patchDecision(file, id, (h) => {
      const a = answersOf(h);
      next = a.find((x) => !x.sent_message_id) || null;
      card = h;
      if (next) return {};
      allSent = true;
      const l = lastSent(a);
      return { status: 'closed', closed_at: new Date().toISOString(), dispatched_message_id: l.sent_message_id, dispatched_via: 'send', dispatched_at: l.sent_at || undefined, dispatch_error: undefined, dispatch_claim: undefined };
    }, { any: true });
    if (pick.status !== 'updated') return { status: 'error', id, executor: seen.executor, error: `could not read or close the card: ${pick.message || pick.status}`, message_id: last ? last.sent_message_id : undefined };
    if (allSent) { const l = last || lastSent(answersOf(card)); return { status: last ? 'sent' : 'already', id, executor: card.executor, message_id: l.sent_message_id }; }
    const remaining = deadline - Date.now();
    if (remaining < MIN_SEND_WINDOW_MS) {
      const d = patchDecision(file, id, (h) => ({ dispatch_error: 'hook_budget', dispatch_attempts: (h.dispatch_attempts || 0) + 1, last_dispatch_attempt_at: new Date().toISOString(), dispatch_claim: undefined }), { any: true });
      return { status: 'deferred', id, executor: card.executor, error: 'hook_budget', attempts: d.entry ? d.entry.dispatch_attempts : undefined };
    }
    const r = sender(card.executor, deliveryText({ ...card, ...next }), Math.min(SEND_TIMEOUT_MS, remaining));
    const now = new Date().toISOString();
    if (!r.ok) {
      const p = patchDecision(file, id, (h) => ({ dispatch_error: r.error, dispatch_attempts: (h.dispatch_attempts || 0) + 1, last_dispatch_attempt_at: now, dispatch_claim: undefined }), { any: true });
      return { status: 'failed', id, executor: card.executor, error: r.error, attempts: p.entry ? p.entry.dispatch_attempts : 1 };
    }
    // The message id is persisted before anything else; the claim is refreshed in the same write. If this write fails the card is not closed and the claim stays.
    const p = patchDecision(file, id, (h) => ({ ...withAnswers(answersOf(h).map((x) => (x.answer_id === next.answer_id ? { ...x, sent_message_id: r.message_id, sent_at: now } : x))), dispatch_claim: { pid: process.pid, at: now } }), { any: true });
    if (p.status !== 'updated') return { status: 'error', id, executor: card.executor, error: `sent (${r.message_id}) but the card could not be marked: ${p.message || p.status}`, message_id: r.message_id };
    last = { sent_message_id: r.message_id };
  }
}

// Append the courier-verified answer `v` ({ answer: {option, free_text, answer_digest?}, answer_id }) to an OPEN or pending_dispatch executor card and park it in pending_dispatch.
// answer_digest is the courier's non-empty string, verbatim; otherwise the local card-bound digest.
// A replay (answer_id already in answers[], sent or not) changes nothing; an entry is never edited or removed. A closed card that was delivered is 'ok' (sendParked says 'already').
// -> { status: 'ok'|'absent'|'not_parked'|'error' }; not_parked = closed/awaiting without a delivery: nothing to deliver.
function parkAnswer(file, id, v) {
  const c = readFile(file, { all: true }).find((e) => e.id === id);
  if (!c) return { status: 'absent', id };
  if (isClosedEntry(c) && c.dispatched_message_id) return { status: 'ok', id, executor: c.executor };
  const a = v.answer;
  const option = nonEmpty(a.option);
  const ft = nonEmpty(a.free_text);
  const now = new Date().toISOString();
  const courierDigest = nonEmpty(a.answer_digest);
  const entry = { answer_id: v.answer_id, answer: option !== null ? option : ft, answer_option: option, answer_free_text: ft, answer_digest: courierDigest !== null ? courierDigest : answerDigest(id, v.answer_id, a.free_text, a.option), sent_message_id: null, sent_at: null };
  const p = patchDecision(file, id, (h) => {
    const cur = answersOf(h);
    if (cur.some((x) => x.answer_id === v.answer_id)) return withAnswers(cur);
    const { sent_message_id: _s, sent_at: _t, ...fields } = entry;
    return { ...withAnswers([...cur, entry]), status: 'pending_dispatch', pending_dispatch_at: isPendingDispatchEntry(h) && h.pending_dispatch_at ? h.pending_dispatch_at : now, ...fields, dispatch_error: undefined };
  }, { any: true, isOurs: (h) => isOpenEntry(h) || isPendingDispatchEntry(h) });
  if (p.status === 'error') return { status: 'error', id, executor: c.executor, error: p.message };
  if (p.status === 'absent') return { status: 'not_parked', id, executor: c.executor };
  return { status: 'ok', id, executor: c.executor };
}

// The CLI/library entry: park the answer, then send it (and any older unsent answer of the card).
function deliverAnswer(file, id, v, sender = sendFleet, opts) {
  const k = parkAnswer(file, id, v);
  if (k.status === 'absent' || k.status === 'error') return k;
  return sendParked(file, id, sender, opts);
}

// An executor card whose answer cannot be delivered (no courier, verify failed, ...) is never closed: it is parked in pending_dispatch with dispatch_error naming the reason.
// -> { status: 'parked'|'no_executor'|'absent', id }. No answer_id is stored, so `redeliver` reports it and skips it.
function parkUndelivered(file, id, reason) {
  const c = readFile(file, { all: true }).find((e) => e.id === id);
  if (!c) return { status: 'absent', id };
  if (!c.executor || !(isOpenEntry(c) || isPendingDispatchEntry(c))) return { status: 'no_executor', id };
  const now = new Date().toISOString();
  const p = patchDecision(file, id, (h) => ({ status: 'pending_dispatch', pending_dispatch_at: h.pending_dispatch_at || now, dispatch_error: reason, dispatch_attempts: (h.dispatch_attempts || 0) + 1, last_dispatch_attempt_at: now }), { any: true, isOurs: (h) => isOpenEntry(h) || isPendingDispatchEntry(h) });
  if (p.status === 'error') return { status: 'error', id, executor: c.executor, error: p.message };
  if (p.status === 'absent') return { status: 'no_executor', id };
  return { status: 'parked', id, executor: c.executor, error: reason, attempts: p.entry.dispatch_attempts };
}

// `redeliver [--id]`: every pending_dispatch card the program parked (answer_id present) and not yet sent. Prints one receipt line per card. Exit 0 all sent / nothing to do, 9 some failed.
function redeliver(args, sender = sendFleet) {
  let failed = 0;
  let n = 0;
  for (const file of projectScopeFiles(args.cwd, { all: true })) {
    for (const e of readFile(file, { all: true })) {
      if (args.id !== undefined && e.id !== args.id) continue;
      if (!isPendingDispatchEntry(e)) continue;
      if (answersOf(e).length === 0) {
        n += 1;
        process.stdout.write(`[略過] ${e.id} → ${e.executor || '(no executor)'}: no stored panel answer (answer_id), nothing to resend${e.dispatch_error ? `; dispatch_error: ${e.dispatch_error}` : ''}\n`);
        continue;
      }
      const r = sendParked(file, e.id, sender, { deadline: Date.now() + REDELIVER_BUDGET_MS });
      n += 1;
      process.stdout.write(`${receiptLine(r)}\n`);
      if (r.status !== 'sent' && r.status !== 'already' && r.status !== 'in_flight') failed += 1;
    }
  }
  if (n === 0) process.stdout.write(args.id !== undefined ? `nothing to redeliver for ${args.id} (not a parked, unsent card)\n` : 'nothing to redeliver\n');
  return failed ? 9 : 0;
}

// close --id <id> --dispatched <task_id>: pending_dispatch -> closed (dispatched_task_id, closed_at). Any other state is refused (exit 2) with the reason.
function markDispatched(args, ex) {
  if (ex.answer !== undefined || ex.executor !== undefined || ex.asker !== undefined || ex['awaiting-operator'] !== undefined || args.option.length || args.closeFreeText !== undefined) return usage('--dispatched <task_id> stands alone (no --answer/--executor/--asker/--awaiting-operator/--option/--free-text)');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/.test(ex.dispatched)) return usage('--dispatched needs the task id the dispatch returned (letters, digits, . _ : @ -)');
  const hit = findCard(args.cwd, args.id, { all: true });
  if (!hit) return usage(`no such decision: ${args.id}; --dispatched only closes a pending_dispatch card`);
  if (!isPendingDispatchEntry(hit.entry)) return usage(`${args.id} is ${cardState(hit.entry)}, not pending_dispatch; --dispatched only closes a card whose answer is waiting to be dispatched`);
  const r = patchDecision(hit.file, args.id, { status: 'closed', closed_at: new Date().toISOString(), dispatched_task_id: ex.dispatched }, { any: true, isOurs: isPendingDispatchEntry });
  if (r.status === 'error') { process.stderr.write(`open-decision: ${r.message}\n`); return 4; }
  if (r.status === 'absent') return usage(`${args.id} changed state meanwhile; run show --id ${args.id}`);
  process.stdout.write(`closed ${args.id} (dispatched ${ex.dispatched})\n`);
  return 0;
}

// backfill --from <file.jsonl> [--apply]: put cards that were closed before the store kept them back as closed records. Each line:
// {id, question, answer, closed_at, [opened_at], [executor], [asker], [status], [awaiting_operator]} (the PM exports its ledger in this shape). status is
// 'closed' (default) or 'awaiting_operator_action' (closed_at is then when it was answered; no closed_at on the record); anything else refuses the batch. Default is a
// dry run that prints what would be added and writes nothing; --apply writes. A card already in the store (any status) is skipped, never
// overwritten. Any bad line -> exit 2 and nothing is written even with --apply. -> exit code.
const BACKFILL_STATUS = ['awaiting_operator_action', 'closed'];
function backfill(args, sf, root) {
  const ex = args.extra;
  const bad = ['answer', 'executor', 'asker', 'awaiting-operator', 'all', 'dispatched'].find((n) => ex[n] !== undefined);
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
                : r.status !== undefined && !BACKFILL_STATUS.includes(r.status) ? `status ${JSON.stringify(r.status)} is not one of ${BACKFILL_STATUS.join(' | ')}`
                  : r.awaiting_operator !== undefined && r.awaiting_operator !== null && !text(r.awaiting_operator) ? 'awaiting_operator is empty'
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
      status: r.status || 'closed', answer: r.answer, backfilled: true,
    };
    if (e.status === 'closed') e.closed_at = new Date(Date.parse(r.closed_at)).toISOString();
    else { e.answered_at = new Date(Date.parse(r.closed_at)).toISOString(); e.awaiting_operator = r.awaiting_operator || null; }
    if (r.executor) e.executor = r.executor;
    if (r.asker) e.asker = r.asker;
    add.push(e);
  }
  const apply = ex.apply === true;
  process.stdout.write(`${apply ? 'APPLY' : 'DRY RUN (nothing written; add --apply)'}: ${add.length} to add, ${skip.length} already in the store${skip.length ? ` (${skip.join(', ')})` : ''}\n`);
  for (const e of add) process.stdout.write(`  ${apply ? 'add' : 'would add'} ${e.id}  status=${e.status}  ${e.status === 'closed' ? 'closed_at' : 'answered_at'}=${e.closed_at || e.answered_at}  executor=${e.executor || '-'}  asker=${e.asker || '-'}  answer=${JSON.stringify(e.answer.length > 60 ? `${e.answer.slice(0, 60)}...` : e.answer)}\n`);
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
  process.stdout.write(`wrote ${add.length} record(s) to ${sf.file}\n`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, checkNotAuthorized, openDecision, closeDecisionById, deliverAnswer, parkAnswer, parkUndelivered, sendParked, receiptLine, redeliver, recordCorrection, patchDecision, findCard, projectScopeFiles, unboundCardsOf, readEntries: readFile, SAFE_ROOT, SCHEMA };
