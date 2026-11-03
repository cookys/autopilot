'use strict';

// src/status/events/merge.js - merge of the reader outputs into one page (autopilot.events/1, plan E3 "Merge").
//
//   mergePage({ results, cursor, kinds, limit, projectKey }) -> {
//     events,          the page, ascending (ts, id), ids compared bytewise
//     hasMore,         more events pass the filters after this page
//     empty,           true when the page is empty: the caller then returns the INPUT cursor unchanged (state is null)
//     state,           the next cursor state (see cursor.js), or null for an empty page
//     overflow,        the page had to shrink the slack (warning window_overflow, `slackMs` says how far)
//     slackMs,
//     warnings }       merge's own: schema_mismatch (an event failing the envelope check), duplicate_id, window_overflow
//
//   results = [{ events, files }] in reader order. An event may carry a non-enumerable `_src` = { source, file, head, offset, end }
//   (the byte position of its line); `files` = [{ key, file, size, head, startOffset, endOffset }] is what a reader consumed.
//
// Steps: drop events failing the envelope check, sort by (ts, id), collapse equal ids (two readers producing one id is a bug: keep
// one, warn duplicate_id), apply the cursor filter (drop an event iff its id hash is in w, or its ts < L = max(t - s, f), or it is
// covered by e), then --kinds, cut at --limit, compute has_more and the next cursor from the last returned event.
// There is no "<= (t, last id)" comparison: w already holds every delivered id inside the window, so a late row is delivered once.

const { parseInstantMs } = require('./instant');
const cursorLib = require('./cursor');

const TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SOURCE = 'merge';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function validEvent(event) {
  return isObj(event) && typeof event.id === 'string' && event.id !== '' && typeof event.kind === 'string' && event.kind !== ''
    && event.id.startsWith(`${event.kind}:`) && typeof event.ts === 'string' && TS_PATTERN.test(event.ts)
    && Number.isFinite(parseInstantMs(event.ts)) && typeof event.source === 'string' && typeof event.project_key === 'string'
    && isObj(event.data);
}

function warn(list, code, detail, count) {
  const hit = list.find((w) => w.code === code && w.detail === detail);
  if (hit) hit.count += count; else list.push({ source: SOURCE, code, detail, count });
}

function mergePage({ results, cursor, kinds, limit, projectKey }) {
  const warnings = [];
  const files = [];
  const all = [];
  let invalid = 0;
  for (const result of results) {
    if (!result) continue;
    for (const file of result.files || []) files.push(file);
    for (const event of result.events || []) {
      if (!validEvent(event)) { invalid += 1; continue; }
      all.push(event);
    }
  }
  if (invalid > 0) warn(warnings, 'schema_mismatch', 'event', invalid);

  all.sort((a, b) => cmpStr(a.ts, b.ts) || cmpStr(a.id, b.id));
  const events = [];
  const seenIds = new Set();
  let duplicates = 0;
  for (const event of all) {
    if (seenIds.has(event.id)) { duplicates += 1; continue; }
    seenIds.add(event.id);
    events.push(event);
  }
  if (duplicates > 0) warn(warnings, 'duplicate_id', 'events', duplicates);

  const floor = cursorLib.floorOf(cursor);
  const delivered = new Set(cursor.w.map((pair) => pair[0]));
  const kindSet = Array.isArray(kinds) && kinds.length > 0 ? new Set(kinds) : null;
  const lines = [];
  const candidates = [];
  for (const event of events) {
    const tsMs = parseInstantMs(event.ts);
    let pass = tsMs >= floor && !delivered.has(cursorLib.idHash(event.id));
    if (pass && cursor.e && tsMs === cursor.e[0] && event.id <= cursor.e[1]) pass = false;
    const candidate = pass && (kindSet === null || kindSet.has(event.kind));
    const src = event._src;
    if (src && typeof src.source === 'string') {
      lines.push({ fileKey: `${src.source}:${src.head}`, file: src.file, offset: src.offset, tsMs, id: event.id, candidate });
    }
    if (candidate) candidates.push({ event, id: event.id, tsMs });
  }

  const cap = Number.isInteger(limit) && limit > 0 ? limit : 1000;
  const pageIn = candidates.slice(0, cap);
  if (pageIn.length === 0) {
    return { events: [], hasMore: false, empty: true, state: null, overflow: false, slackMs: cursor.s, warnings };
  }
  const next = cursorLib.nextCursorState(cursor, pageIn, files, lines, projectKey);
  const byId = new Map(pageIn.map((c) => [c.id, c.event]));
  const page = next.page.map((c) => byId.get(c.id));
  if (next.overflow) warn(warnings, 'window_overflow', `slack ${next.state.s}ms`, 1);
  return {
    events: page, hasMore: candidates.length > page.length, empty: false, state: next.state, overflow: next.overflow, slackMs: next.state.s, warnings,
  };
}

module.exports = { mergePage, validEvent };
