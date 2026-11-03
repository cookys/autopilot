'use strict';

// src/status/events/collector.js - the one bounded event collector every reader uses (autopilot.events/1, plan E3).
//
//   const col = createCollector(window);   window.keep(event) -> bool (the cursor filter: w, e, ts < L, --kinds),
//                                          window.cap = how many events a reader may hand to the merge (limit + a buffer),
//                                          window.sinceTs = L in epoch ms (an event older than L is not a "rejection": it is below the floor)
//   col.push(event)  (alias add)
//   col.result() -> { events, bounded }    events ascending by (ts, id), at most `cap` of them;
//                                          bounded = { displaced, duplicates, displacedOffsets, rejectedOffsets }
//
// A max-heap on (ts, id) keeps the `cap` smallest kept events, so a cold read of 200 000 rows holds `cap` events, not 200 000.
// Dropping an event is not free for the cursor, so the collector reports what the merge needs:
//  - displaced: events that passed `keep` but did not fit (pushed out of the heap, or too large to enter). They were read and not
//    delivered: `displaced` feeds has_more, `displacedOffsets` (the smallest source start offset per file, from event._src) feeds the
//    hints, so a hint never runs past an undelivered line.
//  - rejectedOffsets: the smallest source start offset per file of lines `keep` refused (already delivered ids, covered by e, an
//    excluded kind) and of a repeated id. They are lines of the window the next read still passes: kept as a conservative lower
//    bound for the hint (a hint that is too small only costs time, never events).
// A repeated id inside one reader keeps the copy with the smaller (ts, id), the first met on a tie; `duplicates` counts them and the merge
// reports them as duplicate_id. Without window.keep and window.cap the collector is a sorted, de-duplicated list.

const gt = (a, b) => a.ts > b.ts || (a.ts === b.ts && a.id > b.id);
const cmp = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

function createCollector(window) {
  const keep = window && typeof window.keep === 'function' ? window.keep : null;
  const cap = window && Number.isInteger(window.cap) && window.cap > 0 ? window.cap : Infinity;
  const floorMs = window && typeof window.sinceTs === 'number' && Number.isFinite(window.sinceTs) ? window.sinceTs : null;
  const heap = []; // nodes { event, i }: i = the node's index, kept current so a duplicate can be replaced in place
  const nodes = new Map(); // id -> node, for the events in the heap
  const displacedAt = new Map();
  const rejectedAt = new Map();
  let displaced = 0;
  let duplicates = 0;

  const note = (map, event) => {
    const src = event && event._src;
    if (!src || typeof src.source !== 'string' || !Number.isInteger(src.offset)) return;
    const key = `${src.source}:${src.head}|${src.file}`;
    const hit = map.get(key);
    if (!hit || src.offset < hit.offset) map.set(key, { fileKey: `${src.source}:${src.head}`, file: src.file, offset: src.offset });
  };

  const swap = (x, y) => {
    [heap[x], heap[y]] = [heap[y], heap[x]];
    heap[x].i = x;
    heap[y].i = y;
  };
  const siftUp = (i) => {
    for (let at = i; at > 0;) {
      const parent = (at - 1) >> 1;
      if (!gt(heap[at].event, heap[parent].event)) break;
      swap(at, parent);
      at = parent;
    }
  };
  const siftDown = (i) => {
    for (let at = i; ;) {
      const l = 2 * at + 1;
      const r = l + 1;
      let top = at;
      if (l < heap.length && gt(heap[l].event, heap[top].event)) top = l;
      if (r < heap.length && gt(heap[r].event, heap[top].event)) top = r;
      if (top === at) break;
      swap(at, top);
      at = top;
    }
  };

  function add(event) {
    if (keep && !keep(event)) {
      // below the floor L the line is simply old: only lines the next window can still pass are noted
      if (floorMs === null || Date.parse(event.ts) >= floorMs) note(rejectedAt, event);
      return;
    }
    const twin = nodes.get(event.id);
    if (twin) {
      // One id, two copies: keep the smaller (ts, id), the first one met on a tie, so the result does not depend on input order or
      // page size. Both source positions count for the hint; the merge sees the count as warning duplicate_id.
      duplicates += 1;
      if (gt(twin.event, event)) {
        note(rejectedAt, twin.event);
        twin.event = event;
        siftDown(twin.i); // the key only got smaller
      } else {
        note(rejectedAt, event);
      }
      return;
    }
    if (heap.length < cap) {
      const node = { event, i: heap.length };
      heap.push(node);
      nodes.set(event.id, node);
      siftUp(node.i);
      return;
    }
    displaced += 1;
    if (gt(heap[0].event, event)) {
      const out = heap[0];
      note(displacedAt, out.event);
      nodes.delete(out.event.id);
      out.event = event;
      nodes.set(event.id, out);
      siftDown(0);
    } else {
      note(displacedAt, event);
    }
  }

  function result() {
    const events = heap.map((node) => node.event).sort(cmp);
    return { events, bounded: { displaced, duplicates, displacedOffsets: [...displacedAt.values()], rejectedOffsets: [...rejectedAt.values()] } };
  }

  return { add, push: add, result };
}

module.exports = { createCollector };
