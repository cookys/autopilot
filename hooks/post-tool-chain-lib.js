'use strict';
/**
 * post-tool-chain-lib — run several PostToolUse observers in ONE node process (BL-0241, guard-port Phase 1).
 *
 * UNREGISTERED: nothing in hooks/hooks.json starts this yet (Phase 2 wires it). Plan:
 * docs/plans/2026-10-23-guard-port.md, Design A.
 *
 * Contract (plan § 2.5 and Design A chain contract):
 *  - A chain only FORWARDS. Each member's stdout, stderr and exit status are the bytes it would produce as
 *    its own process; they are never parsed, merged or rewritten. Per stream, members' bytes follow the
 *    registration order (MEMBERS order). The chain exits with the highest member status.
 *  - fd 0 is read once by the caller and handed to every member as text.
 *  - Each member runs under its own try/catch, so one throw cannot skip the others or change their status.
 *    A member that throws (a bug, or a load failure) fails open: one stderr line, status 0.
 *  - process.stdout.write / process.stderr.write / process.exit are swapped while a member runs, and process.env,
 *    process.exitCode, process event listeners and the module cache are snapshotted, put back or purged, all in a
 *    `finally` (modules: purged before and after each member). Exit statuses are what a separate process would exit with (process.exitCode setter + 8 bits). A member's output is flushed with fs.writeSync as soon as that member finished, so a
 *    later member that hangs (the host kills the chain on its timeout) never takes the earlier bytes down
 *    with it, and a large output is not cut by process.exit (pipe writes via process.stdout are async).
 *  - A write failure (EPIPE: the host stopped listening) never stops the remaining members; their state
 *    writes still happen, exactly as separate processes would have run to completion.
 *
 * Members are `{ runHook(stdinText) -> exitStatus }` modules next to this file. The five default members are
 * top-level scripts turned into an exported function plus an unchanged CLI wrapper.
 */

const fs = require('fs');
const path = require('path');

// Design A members, in hooks/hooks.json registration order (the five `.*` PostToolUse observers that
// precede opt-in-multiplexer.js). The chain's registered timeout must be the largest of theirs.
const MEMBERS = ['intent-capture', 'reload-watch', 'audit-log', 'log-error', 'failure-escalation'];

// Thrown by the swapped process.exit so a member that still calls process.exit directly ends only itself.
class MemberExit extends Error {
  constructor(code) { super(`member called process.exit(${code})`); this.code = code; }
}

// The status a standalone process would end with for process.exit(c) / process.exit(runHook(...)). NOT reimplemented:
// Node's own process.exitCode setter does the validation (integer or integer-like string, ERR_INVALID_ARG_TYPE /
// ERR_OUT_OF_RANGE otherwise, null/undefined clear it) and process.exit() does `if (arguments.length) process.exitCode = c`,
// so we hand the value to that setter and read the result back. The one step Node does in C++ (reallyExit: ToInt32 of
// `process.exitCode || 0`, then the OS keeps 8 bits) is reproduced by toStatus(); Node 20.10 reads a string code back as
// the string ("0x03"), Node 24 as the number (3), and Number(v)|0 gives the same status for both.
function toStatus() { return (Number(process.exitCode || 0) | 0) & 0xff; }
// setter errors propagate to the caller exactly as Node's process.exit would throw them
function exitStatus(c) {
  const prev = process.exitCode;
  try { process.exitCode = c; return toStatus(); } finally { process.exitCode = prev; }
}

function toBuffer(chunk, encoding) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
}

// Blocking write of the whole buffer; EAGAIN (non-blocking pipe full) is retried, any other error drops the rest.
function writeAll(fd, buf) {
  let off = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(fd, buf, off, buf.length - off);
    } catch (e) {
      if (e && e.code === 'EAGAIN') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1); continue; }
      return;
    }
  }
}

// Process-wide state a member could leave behind for the next one. Snapshot before, put back after (in a
// `finally`): environment variables, process.exitCode, process event listeners, and every module the member
// loaded into require.cache (so module-level state such as transcript-reader-lib's TAIL_WINDOW_BYTES, or a
// lib's memo, starts fresh for the next member exactly as in a separate process).
// Modules: every member starts with an EMPTY require.cache (this file and the entry script excepted) and the cache
// is emptied again after it. Chosen over "prove the shared libs hold no mutable state": they do (transcript-reader-lib
// keeps `let TAIL_WINDOW_BYTES`, live-session-lib a memo), and a lib preloaded before the chain started would
// otherwise carry one member's mutation into the next. The cost is re-parsing each member's libs (measured: no visible
// change in the chain's p50). runChain is a process entry point; it owns the cache.
function purgeModules() {
  const keep = new Set([__filename, require.main && require.main.filename]);
  for (const k of Object.keys(require.cache)) if (!keep.has(k)) delete require.cache[k];
}
function snapshotProcess() {
  purgeModules();
  const events = new Map();
  // rawListeners(): keeps once() wrappers, so a once listener is still once after the restore
  for (const ev of process.eventNames()) events.set(ev, process.rawListeners(ev));
  return { env: { ...process.env }, exitCode: process.exitCode, events };
}
function restoreProcess(snap) {
  for (const k of Object.keys(process.env)) if (!(k in snap.env)) delete process.env[k];
  for (const [k, v] of Object.entries(snap.env)) if (process.env[k] !== v) process.env[k] = v;
  process.exitCode = snap.exitCode;
  const now = new Set([...process.eventNames(), ...snap.events.keys()]);
  for (const ev of now) {
    const want = snap.events.get(ev) || [];
    const have = process.rawListeners(ev);
    if (have.length === want.length && have.every((f, i) => f === want[i])) continue;
    process.removeAllListeners(ev);
    // A once() wrapper that fired inside the member is spent (and gone from `have`); a separate process would start
    // with a fresh one. Rebuild every once listener from its original function, keep plain ones as they were.
    for (const f of want) {
      if (typeof f.listener === 'function') process.once(ev, f.listener);
      else process.on(ev, f);
    }
  }
  purgeModules();
}

// Runs fn() with stdout/stderr/exit captured and process-wide state restored; returns { code, out, err }.
function capture(fn) {
  const out = [];
  const err = [];
  const snap = snapshotProcess();
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const realExit = process.exit;
  const sink = (list) => (chunk, encoding, cb) => {
    list.push(toBuffer(chunk, encoding));
    const done = typeof encoding === 'function' ? encoding : cb;
    if (typeof done === 'function') done();
    return true;
  };
  let code = 0;
  process.stdout.write = sink(out);
  process.stderr.write = sink(err);
  // same contract as Node: an argument (even undefined) goes through the process.exitCode setter, no argument keeps the
  // current exitCode; the member is ended by a throw because the chain process must survive
  process.exit = function exit(...args) {
    if (args.length !== 0) process.exitCode = args[0];
    throw new MemberExit(toStatus());
  };
  try {
    code = exitStatus(fn());
  } catch (e) {
    if (e instanceof MemberExit) code = e.code;
    else err.push(Buffer.from(`post-tool-chain: member fail-open: ${e && e.message ? e.message : e}\n`));
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.exit = realExit;
    restoreProcess(snap);
  }
  return { code, out: Buffer.concat(out), err: Buffer.concat(err) };
}

/**
 * runChain({ stdin, members?, load?, writeOut?, writeErr? }) -> exit status (highest member status).
 * `load(stem)` returns the member module (default: ./<stem>.js next to this file).
 * `writeOut` / `writeErr` take a Buffer (default: blocking fs.writeSync to fd 1 / 2).
 */
function runChain({ stdin, members = MEMBERS, load, writeOut, writeErr } = {}) {
  const loader = load || ((stem) => require(path.join(__dirname, `${stem}.js`)));
  const emitOut = writeOut || ((b) => writeAll(1, b));
  const emitErr = writeErr || ((b) => writeAll(2, b));
  const text = typeof stdin === 'string' ? stdin : '';
  let status = 0;
  for (const stem of members) {
    const r = capture(() => {
      const mod = loader(stem);
      if (!mod || typeof mod.runHook !== 'function') throw new Error(`${stem} exports no runHook`);
      return mod.runHook(text);
    });
    if (r.out.length) emitOut(r.out);
    if (r.err.length) emitErr(r.err);
    if (r.code > status) status = r.code;
  }
  return status;
}

// fd 0 first: the '/dev/stdin' PATH throws ENXIO on a socket stdin (upstream #6305); a failed read is ''.
function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch { try { return fs.readFileSync('/dev/stdin', 'utf8'); } catch { return ''; } }
}

module.exports = { MEMBERS, runChain, readStdin, capture, MemberExit, exitStatus };
