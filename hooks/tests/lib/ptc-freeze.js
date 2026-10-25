'use strict';
/**
 * ptc-freeze — preloaded (`node --require`, via NODE_OPTIONS) into EVERY process of every arm of the post-tool-chain
 * differential harness: the original observers, the refactored ones, and the chain. It makes the volatile values the
 * observers write the same in all arms, so the harness compares state files and outputs WITHOUT rewriting them.
 *
 * Frozen (identically in every arm):
 *   - the stamp clock: `new Date()` with no argument and `Date()` return the fixed instant FROZEN_ISO. Every
 *     timestamp the observers persist comes from here, and it is a constant, so the chain (one process, members
 *     one after another) and a standalone process write the same bytes: no sequence to reset between members.
 *   - `Date.now()` is FROZEN_MS plus one millisecond per call in this process. It must advance (the lock helpers
 *     spin until Date.now() passes a deadline). None of the five observers persists a Date.now() value; if one
 *     ever did, the chain arm (counter continues across members) would differ from the standalone arm and go red.
 *   - `performance.now()` is a constant.
 *   - `os.hostname()` returns 'frozen-host'.
 *   - `process.pid` is 4242 (or $PTC_PID) and `process.ppid` is 4141 (temp-file names, the pid-derived session hash).
 *     Overlapping-call runs give each CALL its own $PTC_PID (the same for every process of that call, and the same in the
 *     baseline and chain arms), because processes of different calls that shared one pid would share one temp-file name
 *     and corrupt each other's writes, which is an artefact of the freeze and not of the observers. No overlap case takes
 *     a pid-keyed lock.
 * FROZEN_MS is 2026-01-01T00:00:00Z: earlier than any real mtime the fixtures create, so flag-age checks compare the
 * same way on every host and day.
 */

const FROZEN_MS = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
const RealDate = Date;
let ticks = 0;

const FrozenDate = new Proxy(RealDate, {
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length === 0 ? [FROZEN_MS] : args, newTarget === FrozenDate ? target : newTarget);
  },
  apply() { return new RealDate(FROZEN_MS).toString(); },
  get(target, prop, receiver) {
    if (prop === 'now') return () => FROZEN_MS + (ticks++);
    return Reflect.get(target, prop, receiver === FrozenDate ? target : receiver);
  },
});
globalThis.Date = FrozenDate;

try { performance.now = () => 1000; } catch { /* read-only on some versions: unused by the observers */ }

const os = require('os');
os.hostname = () => 'frozen-host';

Object.defineProperty(process, 'pid', { value: Number(process.env.PTC_PID) || 4242, configurable: true });
Object.defineProperty(process, 'ppid', { value: 4141, configurable: true });

module.exports = { FROZEN_MS, FROZEN_ISO: new RealDate(FROZEN_MS).toISOString() };
