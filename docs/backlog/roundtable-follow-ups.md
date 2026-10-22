# Roundtable follow-ups deferred by the second review

Second-generation review of the roundtable work, 2026-10-19. These four points wait until the next edit of `scripts/lib/room-log.js` or `scripts/roundtable-window.js`.

(a) Three-process race: a window of a few microseconds remains between reclaim and release when three processes contend. Closing it needs real mutual exclusion (flock or fcntl, or mkdir). Lives in `acquireLock` and `releaseLock` in `scripts/lib/room-log.js`.

(b) Leftover files: a process killed between rename and unlink or link leaves `room.jsonl.lock.reclaim-*` or `room.jsonl.lock.release-*` files. They do not affect reads, but should be registered in the tmp-residue registry or swept. Lives in `acquireLock` and `releaseLock` in `scripts/lib/room-log.js`.

(c) Duplicate system rows: for the same `from` value starting with a dash, every send appends another skipped-seat system row. Deduplicate. Lives in `resolveSeats` and `sendText` in `scripts/roundtable-window.js`.

(d) Usage mismatch: `send --seats X ROOM` and `input ROOM --once` are accepted by `parseCli` but not written in `USAGE`. Align them. Lives in `parseCli` and the `USAGE` string in `scripts/roundtable-window.js`.

## Status 2026-10-23

(b) leftover files, (c) duplicate skipped-seat rows and (d) USAGE mismatch fixed by cb6e7c305 (roomlog). Only (a), the three-process race, remains (BL-0252).
