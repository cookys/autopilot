#!/usr/bin/env node
'use strict';
/**
 * fleet-card-mirror.js — the PM-side mirror of the cards other hosts' sessions have open (fleetcards phase 1, PM ruling 01M6W4RNP6).
 *
 *   node scripts/fleet-card-mirror.js ingest [--member pm--claude] [--stdin] [--limit N]   read the messages handed to the PM seat, fold every valid
 *                                       `AUTOPILOT-CARD/1` notice into the mirror. Without --stdin it runs `fleet recent --member <seat> --json [--since <cursor>]`
 *                                       (the PM seat's own account; AUTOPILOT_FLEET_BIN overrides the binary). --stdin takes that JSON from stdin instead.
 *   node scripts/fleet-card-mirror.js view [--json] [--now <ISO>]       the read-only model the panel draws: open cards + the to-do list reconciled against them
 *   node scripts/fleet-card-mirror.js sync [--json] [--member <seat>]   ingest, then view (what the live panel runs every 60 s)
 *
 * Files (never in git), directory AUTOPILOT_CARD_MIRROR_DIR or ${XDG_STATE_HOME:-~/.local/state}/autopilot:
 *   fleet-card-mirror.json   { schema, synced_at, last_error, cursor, truncated, cards: {id: card}, closed: {id: {at, state, member}}, rejects: [...] }
 *   fleet-card-todo.json     the PM's hand-kept list: { items: [{ card_id, step, owner_session, since, due|null }] }   (this script only READS it)
 *
 * Trust: every message is peer input. One is folded only when `content` is exactly `AUTOPILOT-CARD/1 <json>` with the contract's keys and shapes
 * (scripts/lib/card-notice.js parse), `from` is a well-formed address, and the body's `session` (when both sides carry one) equals the session in `from`.
 * The owner of a card is the `from` (namespace, courier, member) that opened it; only that member can close it. The session shown is the one in `from`, never the body's.
 * A card id seen again is a no-op (dedup by card_id); a closed id is remembered (`closed`, 14 days) so a replayed open cannot bring it back.
 * Read-only toward fleet: it only calls `fleet recent`; no claim, no answer, no send. A failed sync keeps the old data and records `last_error`.
 * Stale: more than 5 minutes since the last good sync. Node built-ins only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const notice = require('./lib/card-notice.js');
const { withWriteLock } = require('./lib/jsonl-store.js');

const SCHEMA = 'autopilot.fleet-card-mirror/1';
const STALE_MS = 5 * 60 * 1000;
const FUTURE_SLACK_MS = 5 * 60 * 1000;
const CLOSED_KEEP_MS = 14 * 24 * 3600 * 1000;
const MAX_CARDS = 500;
const MAX_REJECTS = 20;
const MAX_PAGES = 5;
const CARD_ID = /^d-[0-9a-f]{8}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const CONTROL = /[\u0000-\u001f\u007f\u2028\u2029]/;
const MEMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// The sender that opened a card: namespace, courier and member must all match (a same-named member in another namespace is someone else).
const sameSender = (card, from) => card.namespace === from.namespace && card.courier === from.courier && card.member === from.member;

const stateDir = () => process.env.AUTOPILOT_CARD_MIRROR_DIR || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'autopilot');
const mirrorFile = () => path.join(stateDir(), 'fleet-card-mirror.json');
const todoFile = () => path.join(stateDir(), 'fleet-card-todo.json');

function emptyMirror() {
  return { schema: SCHEMA, synced_at: null, last_error: null, cursor: null, truncated: false, cards: {}, closed: {}, rejects: [] };
}

function readMirror() {
  let v;
  try { v = JSON.parse(fs.readFileSync(mirrorFile(), 'utf8')); } catch (_e) { return null; }
  if (!v || v.schema !== SCHEMA || typeof v.cards !== 'object' || v.cards === null || typeof v.closed !== 'object' || v.closed === null) return null;
  return { ...emptyMirror(), ...v, rejects: Array.isArray(v.rejects) ? v.rejects : [] };
}

function writeMirror(m) {
  const f = mirrorFile();
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function locked(fn) {
  const f = mirrorFile();
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  return withWriteLock({ storeDir: path.dirname(f), lockFile: `${f}.lock`, name: path.basename(f), timeoutMs: 5000 }, fn);
}

// Fold one message into `m`. -> 'accepted' | 'duplicate' | 'ignored' (not a card notice) | a reject reason string prefixed 'reject:'
function fold(m, msg, nowMs) {
  const content = msg && typeof msg.content === 'string' ? msg.content : '';
  if (!content.startsWith(notice.PREFIX)) return 'ignored';
  const p = notice.parse(content);
  if (!p.ok) return `reject:${p.reason}`;
  const n = p.notice;
  const from = notice.parseFrom(msg.from);
  if (!from) return 'reject:bad sender';
  if (n.session !== null && from.session !== null && n.session !== from.session) return 'reject:session differs from sender';
  const at = Date.parse(n.at);
  if (at > nowMs + FUTURE_SLACK_MS) return 'reject:from the future';
  const owner = m.cards[n.card_id];
  const tomb = m.closed[n.card_id];
  if (n.event === 'open') {
    if (tomb) return 'duplicate';
    if (owner) return sameSender(owner, from) ? 'duplicate' : 'reject:card id held by another sender';
    if (Object.keys(m.cards).length >= MAX_CARDS) return 'reject:mirror full';
    m.cards[n.card_id] = { card_id: n.card_id, question: n.question, state: n.state, opened_at: n.at, member: from.member, courier: from.courier, namespace: from.namespace, session: from.session, message_id: msg.message_id || null };
    return 'accepted';
  }
  // close
  if (owner && !sameSender(owner, from)) return 'reject:close from a sender that did not open the card';
  if (!owner) return tomb ? 'duplicate' : 'reject:close for a card this mirror never saw open'; // no owner known: no tombstone, a stranger cannot pre-close a card
  delete m.cards[n.card_id];
  m.closed[n.card_id] = { at: n.at, state: n.state, member: from.member };
  return 'accepted';
}

function prune(m, nowMs) {
  for (const [id, t] of Object.entries(m.closed)) if (!(nowMs - Date.parse(t.at) < CLOSED_KEEP_MS)) delete m.closed[id];
}

function fetchRecent(member, cursor, limit) {
  const args = ['recent', '--member', member, '--json', '--limit', String(limit)];
  if (cursor) args.push('--since', cursor);
  const r = spawnSync(process.env.AUTOPILOT_FLEET_BIN || 'fleet', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error) return { error: r.error.code === 'ENOENT' ? 'no fleet binary' : r.error.message };
  if (r.status !== 0) return { error: `fleet recent exit ${r.status}: ${(r.stderr || '').trim().split('\n').pop().slice(0, 200)}` };
  return parseRecent(r.stdout);
}

function parseRecent(text) {
  const lines = String(text).split('\n').filter((l) => l.trim().startsWith('{'));
  for (const l of lines.reverse()) {
    let v;
    try { v = JSON.parse(l); } catch (_e) { continue; }
    if (v && Array.isArray(v.messages)) return { messages: v.messages.filter((x) => x && typeof x === 'object'), truncated: v.truncated === true };
  }
  return { error: 'fleet recent: no messages list in the output' };
}

// -> { ok, accepted, duplicate, rejected, error }
function ingest({ member, stdinText, limit, nowMs }) {
  const now = nowMs || Date.now();
  return locked(() => {
    const m = readMirror() || emptyMirror();
    let pages = [];
    if (stdinText !== undefined) {
      const r = parseRecent(stdinText);
      if (r.error) { m.last_error = r.error; writeMirror(m); return { ok: false, error: r.error, accepted: 0, duplicate: 0, rejected: 0 }; }
      pages = [r];
    } else {
      let cursor = m.cursor;
      for (let i = 0; i < MAX_PAGES; i += 1) {
        const r = fetchRecent(member, cursor, limit);
        if (r.error) { m.last_error = r.error; writeMirror(m); return { ok: false, error: r.error, accepted: 0, duplicate: 0, rejected: 0 }; }
        pages.push(r);
        const ids = r.messages.map((x) => String(x.message_id || '')).filter(Boolean).sort();
        if (!r.truncated || ids.length === 0 || ids[ids.length - 1] === cursor) break;
        cursor = ids[ids.length - 1];
      }
    }
    const out = { ok: true, accepted: 0, duplicate: 0, rejected: 0, error: null };
    const seen = new Set();
    const all = pages.flatMap((p) => p.messages).filter((x) => { const id = String(x.message_id || ''); if (!id) return true; if (seen.has(id)) return false; seen.add(id); return true; })
      .sort((a, b) => String(a.message_id || '').localeCompare(String(b.message_id || '')));
    for (const msg of all) {
      const id = String(msg.message_id || '');
      if (m.cursor && id && id <= m.cursor) continue;
      const res = fold(m, msg, now);
      if (res === 'accepted') out.accepted += 1;
      else if (res === 'duplicate') out.duplicate += 1;
      else if (res.startsWith('reject:')) {
        out.rejected += 1;
        m.rejects = [...m.rejects, { message_id: id || null, reason: res.slice(7), at: new Date(now).toISOString() }].slice(-MAX_REJECTS);
      }
      if (id && (!m.cursor || id > m.cursor)) m.cursor = id;
    }
    prune(m, now);
    m.synced_at = new Date(now).toISOString();
    m.last_error = null;
    m.truncated = pages.some((p) => p.truncated) && pages.length >= MAX_PAGES;
    writeMirror(m);
    return out;
  });
}

// ---- the to-do list (read only) ----
function readTodo() {
  let raw;
  try { raw = fs.readFileSync(todoFile(), 'utf8'); } catch (e) { return e.code === 'ENOENT' ? { present: false, items: [], skipped: 0, error: null } : { present: true, items: [], skipped: 0, error: `unreadable: ${e.message}` }; }
  let v;
  try { v = JSON.parse(raw); } catch (_e) { return { present: true, items: [], skipped: 0, error: 'not JSON' }; }
  if (!v || !Array.isArray(v.items)) return { present: true, items: [], skipped: 0, error: 'no items list' };
  const str = (x, max) => typeof x === 'string' && x.trim() !== '' && x.length <= max && !CONTROL.test(x);
  const items = [];
  let skipped = 0;
  for (const it of v.items) {
    const ok = it && typeof it === 'object' && typeof it.card_id === 'string' && CARD_ID.test(it.card_id) && str(it.step, 300) && str(it.owner_session, 200)
      && typeof it.since === 'string' && ISO.test(it.since) && Number.isFinite(Date.parse(it.since))
      && (it.due === undefined || it.due === null || (typeof it.due === 'string' && ISO.test(it.due) && Number.isFinite(Date.parse(it.due))));
    if (ok) items.push({ card_id: it.card_id, step: it.step, owner_session: it.owner_session, since: it.since, due: it.due || null });
    else skipped += 1;
  }
  return { present: true, items, skipped, error: null };
}

function view(nowMs) {
  const now = nowMs || Date.now();
  const m = readMirror();
  const todo = readTodo();
  const known = (id) => !!(m && (m.cards[id] || m.closed[id]));
  const cards = m ? Object.values(m.cards).sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at)) : [];
  const syncedMs = m && m.synced_at ? Date.parse(m.synced_at) : null;
  return {
    schema: 'autopilot.fleet-card-view/1',
    present: !!m,
    synced_at: m ? m.synced_at : null,
    age_ms: syncedMs === null ? null : Math.max(0, now - syncedMs),
    stale: syncedMs === null || now - syncedMs > STALE_MS,
    last_error: m ? m.last_error : null,
    truncated: m ? m.truncated === true : false,
    rejected: m ? m.rejects.length : 0,
    cards,
    todo: {
      present: todo.present,
      error: todo.error,
      skipped: todo.skipped,
      items: todo.items.map((it) => ({ ...it, reconciled: known(it.card_id) })),
    },
  };
}

function usage(msg) {
  if (msg) process.stderr.write(`fleet-card-mirror: ${msg}\n`);
  process.stderr.write('usage: fleet-card-mirror.js ingest [--member <seat>] [--stdin] [--limit N]\n       fleet-card-mirror.js view [--json] [--now <ISO>]\n       fleet-card-mirror.js sync [--json] [--member <seat>]\n');
  return 2;
}

function textView(v) {
  const lines = [`mirror: ${v.present ? `${v.cards.length} open card(s), synced ${v.synced_at || 'never'}${v.stale ? ' (STALE)' : ''}${v.last_error ? `, last error: ${v.last_error}` : ''}` : 'none yet (run ingest)'}`];
  for (const c of v.cards) lines.push(`  ${c.card_id}  ${c.courier}/${c.member}${c.session ? `@${c.session}` : ''}  ${c.question}`);
  for (const t of v.todo.items) lines.push(`  todo ${t.card_id}  ${t.step}  (${t.owner_session})${t.reconciled ? '' : '  UNRECONCILED'}`);
  return `${lines.join('\n')}\n`;
}

function main(argv) {
  const cmd = argv[0];
  if (!['ingest', 'view', 'sync'].includes(cmd)) return usage(cmd ? `bad command: ${cmd}` : 'missing command');
  const o = { member: process.env.AUTOPILOT_CARD_MIRROR_MEMBER || 'pm--claude', limit: 200 };
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--stdin') o.stdin = true;
    else if (a === '--member' || a === '--limit' || a === '--now') {
      if (i + 1 >= argv.length) return usage(`${a} needs a value`);
      o[a.slice(2)] = argv[i + 1]; i += 1;
    } else return usage(`unknown argument: ${a}`);
  }
  if (!MEMBER.test(o.member)) return usage('--member is not a seat name');
  const limit = Number(o.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return usage('--limit must be 1..1000');
  const nowMs = o.now !== undefined ? Date.parse(o.now) : undefined;
  if (o.now !== undefined && !Number.isFinite(nowMs)) return usage('--now is not a date');
  let r = null;
  if (cmd === 'ingest' || cmd === 'sync') {
    if (o.stdin && cmd === 'sync') return usage('sync does not take --stdin');
    let stdinText;
    if (o.stdin) { try { stdinText = fs.readFileSync(0, 'utf8'); } catch (_e) { stdinText = ''; } }
    try { r = ingest({ member: o.member, stdinText, limit, nowMs }); } catch (e) { r = { ok: false, error: e.message, accepted: 0, duplicate: 0, rejected: 0 }; }
    if (cmd === 'ingest') {
      process.stdout.write(o.json ? `${JSON.stringify(r)}\n` : (r.ok ? `ingest: ${r.accepted} accepted, ${r.duplicate} duplicate, ${r.rejected} rejected\n` : `ingest failed: ${r.error}\n`));
      return r.ok ? 0 : 1;
    }
  }
  const v = view(nowMs);
  process.stdout.write(o.json ? `${JSON.stringify(v)}\n` : textView(v));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, ingest, view, fold, readTodo, STALE_MS, SCHEMA };
