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
 *  - process.stdout.write / process.stderr.write / process.exit are swapped while a member runs and put back
 *    in a `finally`. A member's output is flushed with fs.writeSync as soon as that member finished, so a
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

// Runs fn() with stdout/stderr/exit captured; returns { code, out, err }.
function capture(fn) {
  const out = [];
  const err = [];
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
  process.exit = (c) => { throw new MemberExit(c === undefined ? 0 : Number(c)); };
  try {
    const r = fn();
    code = Number.isInteger(r) ? r : 0;
  } catch (e) {
    if (e instanceof MemberExit) code = Number.isInteger(e.code) ? e.code : 0;
    else err.push(Buffer.from(`post-tool-chain: member fail-open: ${e && e.message ? e.message : e}\n`));
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.exit = realExit;
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

module.exports = { MEMBERS, runChain, readStdin, capture, MemberExit };
