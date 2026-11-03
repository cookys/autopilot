'use strict';

// src/status/events/collector.js - the one bounded event collector every reader uses (autopilot.events/1, plan E3).
//
//   const col = createCollector(window);   window.keep(event) -> bool (the cursor filter: w, e, ts < L, --kinds),
//                                          window.cap = how many events a reader may hand to the merge (limit + a buffer),
//                                          window.sinceTs = L in epoch ms (an event older than L is not a "rejection": it is below the floor)
//   col.push(event)  (alias add)
//   col.result() -> { events, bounded }    events ascending by (ts, id), at most `cap` of them;
//                                          bounded = { displaced, displacedOffsets, rejectedOffsets }
//
// A max-heap on (ts, id) keeps the `cap` smallest kept events, so a cold read of 200 000 rows holds `cap` events, not 200 000.
// Dropping an event is not free for the cursor, so the collector reports what the merge needs:
//  - displaced: events that passed `keep` but did not fit (pushed out of the heap, or too large to enter). They were read and not
//    delivered: `displaced` feeds has_more, `displacedOffsets` (the smallest source start offset per file, from event._src) feeds the
//    hints, so a hint never runs past an undelivered line.
//  - rejectedOffsets: the smallest source start offset per file of lines `keep` refused (already delivered ids, covered by e, an
//    excluded kind) and of a repeated id. They are lines of the window the next read still passes: kept as a conservative lower
//    bound for the hint (a hint that is too small only costs time, never events).
// Without window.keep and window.cap the collector is a plain list: direct reader calls behave as before.

const gt = (a, b) => a.ts > b.ts || (a.ts === b.ts && a.id > b.id);
const cmp = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function createCollector(window) {
  const keep = window && typeof window.keep === 'function' ? window.keep : null;
  const cap = window && Number.isInteger(window.cap) && window.cap > 0 ? window.cap : Infinity;
  const floorMs = window && typeof window.sinceTs === 'number' && Number.isFinite(window.sinceTs) ? window.sinceTs : null;
  const bounded = cap !== Infinity;
  const heap = [];
  const ids = new Set();
  const displacedAt = new Map();
  const rejectedAt = new Map();
  let displaced = 0;

  const note = (map, event) => {
    const src = event && event._src;
    if (!src || typeof src.source !== 'string' || !Number.isInteger(src.offset)) return;
    const key = `${src.source}:${src.head}|${src.file}`;
    const hit = map.get(key);
    if (!hit || src.offset < hit.offset) map.set(key, { fileKey: `${src.source}:${src.head}`, file: src.file, offset: src.offset });
  };

  const siftUp = (i) => {
    for (let at = i; at > 0;) {
      const parent = (at - 1) >> 1;
      if (!gt(heap[at], heap[parent])) break;
      [heap[at], heap[parent]] = [heap[parent], heap[at]];
      at = parent;
    }
  };
  const siftDown = (i) => {
    for (let at = i; ;) {
      const l = 2 * at + 1;
      const r = l + 1;
      let top = at;
      if (l < heap.length && gt(heap[l], heap[top])) top = l;
      if (r < heap.length && gt(heap[r], heap[top])) top = r;
      if (top === at) break;
      [heap[at], heap[top]] = [heap[top], heap[at]];
      at = top;
    }
  };

  function add(event) {
    if (keep && !keep(event)) {
      // below the floor L the line is simply old: only lines the next window can still pass are noted
      if (floorMs === null || Date.parse(event.ts) >= floorMs) note(rejectedAt, event);
      return;
    }
    if (!bounded) { heap.push(event); return; }
    if (ids.has(event.id)) { note(rejectedAt, event); return; }
    if (heap.length < cap) {
      heap.push(event);
      ids.add(event.id);
      siftUp(heap.length - 1);
      return;
    }
    displaced += 1;
    if (gt(heap[0], event)) {
      const out = heap[0];
      note(displacedAt, out);
      ids.delete(out.id);
      heap[0] = event;
      ids.add(event.id);
      siftDown(0);
    } else {
      note(displacedAt, event);
    }
  }

  function result() {
    const events = [...heap].sort(cmp);
    return { events, bounded: { displaced, displacedOffsets: [...displacedAt.values()], rejectedOffsets: [...rejectedAt.values()] } };
  }

  return { add, push: add, result };
}

module.exports = { createCollector };
