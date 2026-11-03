'use strict';

// src/status/events/cursor.js - the resume cursor of the events feed (autopilot.events/1, plan E3 "Cursor").
//
// A cursor is opaque to consumers: base64url(JSON) of
//   { v:1, t:"<watermark ISO ms>", s:<slack ms>, w:[["<12 hex of sha256(id)>", <ts epoch ms>]...], f:<coverage floor epoch ms>,
//     e:null|[<ts epoch ms>, "<greatest delivered id>"], h:{"<source>:<12 hex head hash>": <byte offset>}, p:"<project_key>" }
// Internally a decoded cursor has t as epoch ms: { v, t, s, w, f, e, h, p }.
//
//   encodeCursor(state) -> string                 deterministic (fixed key order, w sorted by (ts, hash), h sorted by key)
//   decodeCursor(text, projectKey) -> state       throws CursorError('bad_cursor') on a garbage / foreign / oversize cursor
//   syntheticCursor(sinceMs, projectKey) -> state --since <ISO> / 0 / omitted: {t: since + s, s, w: [], f: 0}, so t - s is exactly `since`
//   floorOf(state) -> epoch ms                    L = max(t - s, f), the lowest ts a read still looks at
//   idHash(id) -> 12 hex
//   nextCursorState(prev, page, hintInput) -> { state, overflow, page }     the E3 window / coverage-floor / `e` / hint rules
//
// Limits: w <= 1000 pairs, h <= 16 entries (only files >= 64 KiB, largest first), the encoded cursor <= 64 KiB.

const crypto = require('crypto');

const VERSION = 1;
const DEFAULT_SLACK_MS = 300000;
const MAX_W = 1000;
const MAX_H = 16;
const HINT_MIN_FILE_BYTES = 64 * 1024;
const MAX_CURSOR_BYTES = 64 * 1024;

class CursorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CursorError';
    this.code = code;
  }
}

const idHash = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
const isInt = (v) => Number.isInteger(v) && v >= 0;
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function encodeCursor(state) {
  const w = [...state.w].sort((a, b) => (a[1] - b[1]) || cmpStr(a[0], b[0]));
  const h = {};
  for (const key of Object.keys(state.h || {}).sort()) h[key] = state.h[key];
  const body = {
    v: VERSION, t: new Date(state.t).toISOString(), s: state.s, w, f: state.f, e: state.e || null, h, p: state.p,
  };
  const text = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  if (text.length > MAX_CURSOR_BYTES) throw new Error('cursor_too_large');
  return text;
}

function decodeCursor(text, projectKey) {
  const bad = () => new CursorError('bad_cursor');
  if (typeof text !== 'string' || text === '' || text.length > MAX_CURSOR_BYTES || !/^[A-Za-z0-9_-]+$/.test(text)) throw bad();
  let body;
  try { body = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch (_error) { throw bad(); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || body.v !== VERSION) throw bad();
  if (typeof body.p !== 'string' || body.p !== projectKey) throw bad();
  const t = typeof body.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.t) ? Date.parse(body.t) : NaN;
  if (!Number.isFinite(t)) throw bad();
  if (!isInt(body.s) || body.s > DEFAULT_SLACK_MS || !isInt(body.f)) throw bad();
  if (!Array.isArray(body.w) || body.w.length > MAX_W) throw bad();
  const w = [];
  for (const pair of body.w) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || !/^[0-9a-f]{12}$/.test(pair[0]) || !isInt(pair[1])) throw bad();
    w.push([pair[0], pair[1]]);
  }
  let e = null;
  if (body.e !== null && body.e !== undefined) {
    if (!Array.isArray(body.e) || body.e.length !== 2 || !isInt(body.e[0]) || typeof body.e[1] !== 'string') throw bad();
    e = [body.e[0], body.e[1]];
  }
  const h = {};
  if (body.h !== undefined && body.h !== null) {
    if (typeof body.h !== 'object' || Array.isArray(body.h)) throw bad();
    const keys = Object.keys(body.h);
    if (keys.length > MAX_H) throw bad();
    for (const key of keys) {
      if (!/^[a-z]+:[0-9a-f]{12}$/.test(key) || !isInt(body.h[key])) throw bad();
      h[key] = body.h[key];
    }
  }
  return { v: VERSION, t, s: body.s, w, f: body.f, e, h, p: projectKey };
}

// --since <ISO instant> (or 0 / omitted, sinceMs = 0): the lower bound t - s is exactly the requested instant.
function syntheticCursor(sinceMs, projectKey) {
  return { v: VERSION, t: sinceMs + DEFAULT_SLACK_MS, s: DEFAULT_SLACK_MS, w: [], f: 0, e: null, h: {}, p: projectKey };
}

const floorOf = (state) => Math.max(state.t - state.s, state.f);

// ---- next cursor ---------------------------------------------------------------------------------------------------------
//
// prev   the decoded input cursor.
// page   delivered events of this page in (ts, id) order, each { id, tsMs }. Non-empty.
// Returns { state, overflow, page }: `page` is the (possibly shortened) delivered page. A page is shortened only when its final
// ts group alone cannot be held by w at slack 0 and it is not the page's only group: the page is cut before that group.
//
// Rules (plan E3):
//  - newT = ts of the last delivered event. s starts at the default every page and is halved (300000, 150000, ... 0) only as far
//    as w needs to fit MAX_W; a page that had to halve is an overflow page.
//  - coverage floor f' = max(f, newT - s_page); it only moves forward. w' = (prev w pruned to ts >= f') U (page ids with ts >= f').
//  - the final group of one ts alone above MAX_W at s = 0 and the only group of the page: w' omits it, e' = [that ts, greatest
//    delivered id], f' = that ts. e survives until its ts falls below the floor.
function nextWindow(prev, page) {
  let cut = page;
  for (;;) {
    const newT = cut[cut.length - 1].tsMs;
    let slack = DEFAULT_SLACK_MS;
    for (;;) {
      const floor = Math.max(prev.f, newT - slack);
      const pairs = new Map();
      for (const pair of prev.w) if (pair[1] >= floor) pairs.set(pair[0], pair[1]);
      for (const event of cut) if (event.tsMs >= floor) pairs.set(idHash(event.id), event.tsMs);
      if (pairs.size <= MAX_W) {
        return { newT, slack, floor, pairs, e: prev.e && prev.e[0] >= floor ? prev.e : null, page: cut, overflow: slack < DEFAULT_SLACK_MS };
      }
      if (slack === 0) break;
      slack = Math.floor(slack / 2);
    }
    // even slack 0 overflows: the final ts group is larger than MAX_W
    const groupTs = cut[cut.length - 1].tsMs;
    const firstOfGroup = cut.findIndex((event) => event.tsMs === groupTs);
    if (firstOfGroup > 0) { cut = cut.slice(0, firstOfGroup); continue; } // cut the page before the group
    const last = cut[cut.length - 1];
    const pairs = new Map();
    // pairs at or after the group instant stay (a late row with a smaller id at the same ms must not resend the group); the page's
    // own group is left to e
    for (const pair of prev.w) if (pair[1] >= groupTs) pairs.set(pair[0], pair[1]);
    return { newT: groupTs, slack: 0, floor: Math.max(prev.f, groupTs), pairs, e: [groupTs, last.id], page: cut, overflow: true };
  }
}

// Per-file hint: the smallest of (a) the start offset of a line read but not delivered and (b) the start offset of the first line
// whose ts is inside the next window (>= floor); with neither, the end of what was consumed. `files` come from the readers, `lines`
// are { fileKey, file, offset, tsMs, undelivered }.
function nextHints(files, lines, floor) {
  // Files whose first 256 bytes agree share one hint key; the key gets the SMALLEST offset of them all, 0 included.
  const byKey = new Map();
  for (const file of files) {
    if (!file || typeof file.key !== 'string' || !(file.size >= HINT_MIN_FILE_BYTES)) continue;
    let hint = file.endOffset;
    for (const line of lines) {
      if (line.fileKey !== file.key || line.file !== file.file) continue;
      if (line.undelivered || line.tsMs >= floor) hint = Math.min(hint, line.offset);
    }
    if (!Number.isInteger(hint) || hint < 0) continue;
    const hit = byKey.get(file.key);
    if (hit) { hit.hint = Math.min(hit.hint, hint); hit.size = Math.max(hit.size, file.size); } else byKey.set(file.key, { key: file.key, size: file.size, hint });
  }
  // merged by key first, then the 0s go (0 means "from the start": no hint), and only then the 16 largest are taken
  const candidates = [...byKey.values()].filter((c) => c.hint > 0).sort((a, b) => (b.size - a.size) || cmpStr(a.key, b.key)).slice(0, MAX_H);
  const h = {};
  for (const candidate of candidates) h[candidate.key] = candidate.hint;
  return h;
}

function nextCursorState(prev, page, files, lines, projectKey) {
  const win = nextWindow(prev, page);
  const state = {
    v: VERSION, t: win.newT, s: win.slack, w: [...win.pairs].map(([hash, ts]) => [hash, ts]), f: win.floor, e: win.e, h: {}, p: projectKey,
  };
  // lines of events cut by the shortened page are undelivered too
  const delivered = new Set(win.page.map((event) => event.id));
  const adjusted = lines.map((line) => ({ ...line, undelivered: line.candidate === true && !delivered.has(line.id) }));
  state.h = nextHints(files, adjusted, win.floor);
  return { state, overflow: win.overflow, page: win.page };
}

module.exports = {
  CursorError, DEFAULT_SLACK_MS, MAX_W, MAX_H, HINT_MIN_FILE_BYTES, MAX_CURSOR_BYTES,
  encodeCursor, decodeCursor, syntheticCursor, floorOf, idHash, nextCursorState, nextWindow, nextHints,
};
