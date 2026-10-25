#!/usr/bin/env node
'use strict';
// claude-call-capture.js -- evidence capture for the PATH `claude` wrapper of the eval batches (BL-0294).
//
// Why it exists: the skill-creator scripts (run_eval.py / run_loop.py) run `claude -p` with stderr=DEVNULL, never read the
// exit code, return on the first type=result line and then SIGKILL the child, and always write a valid summary. An
// authentication failure is invisible to the batch that started them. The PATH wrapper (scripts/lib/claude-call-capture-exec.sh,
// used by scripts/run-eval-batch.sh and scripts/run-skill-opt.sh) keeps the child's life cycle (it ENDS IN `exec claude`, so the
// caller's kill hits claude itself) and mirrors the two streams into a per-call record with the `mirror` command below.
//
// A record <rec> is: <rec>.pid ("pid starttime", written by `register` -- THE list of records), <rec>.out, <rec>.err and the
// markers <rec>.out.closed / <rec>.err.closed. A record is in exactly one of three states (recordState, shared by every judge mode):
//   alive    its process is alive (same starttime)                      -> not judged yet, never cached
//   pending  its process is dead but a stream is not closed yet          -> waited for; if it never closes it is judged as a FAILED
//                                                                          record from whatever .out/.err exist (may be empty), not cached
//   ready    its process is dead and both streams are closed            -> judged (and cached as <rec>.ok when clean)
//
// Commands (Node built-ins only):
//   register --rec REC --pid P          write REC.pid = "P starttime" (atomically)
//   mirror --pid P --rec FILE --fd 1|2  stdin -> the original stdout/stderr AND FILE, byte for byte. Short writes and EAGAIN are
//                                       looped until every byte is written. It ends when stdin reaches EOF, or when process P (same
//                                       starttime) is gone AND stdin has been quiet for 300 ms (everything already in the pipe has been
//                                       read; at most 2 s after the death, so a grandchild that keeps writing cannot hold it) -- then
//                                       FILE.closed is written. A failing write to the original output (EPIPE: the reader went
//                                       away) is recorded in FILE.outbroken and never stops the record file from being completed;
//                                       a failing record write is recorded in FILE.writeerror (the record is then incomplete, and said so).
//   judge --dir D [--final [--wait SEC]] [--id-prefix X]
//                                       exit 0 = no record died on authentication, 6 = one did (line "STOP_AUTH after <id>: ..." on stderr;
//                                       STOP written atomically as STOP.tmp.<pid> -> STOP). Boundary mode (default, before every claude
//                                       start) waits up to 3 s for pending records; --final waits up to --wait seconds (default 10) for
//                                       every record to become ready and judges the rest as failed records.
// A record is FAILED when its stream has no successful type=result line (killed early, unfinished, exit 0 with only an auth message);
// a failed record with an authentication phrase in .out or .err is an auth failure (scripts/lib/auth-stop.js).
//
// I/O inventory (every read / write / close / rename in this file, and what a failure does):
//   procStat      readFileSync /proc/<pid>/stat       failure = process gone (null); read is atomic enough, a torn read cannot match starttime
//   register      writeFileSync tmp + renameSync      failure throws -> non-zero exit; the wrapper's `register` call then fails loudly
//   mirror read   fs.read(0)                          stream 'data' events (poll based, no blocking threadpool read); EOF/error ends the mirror; every chunk read is written before closing
//   mirror write  writeAll(fd) loops short writes     EAGAIN waits and retries; EPIPE/other on the ORIGINAL output = .outbroken, record continues;
//                                                    failure on the RECORD = .writeerror (never swallowed silently)
//   mirror close  closeSync(rec), tmp+rename .closed  .closed is written last, after the final write completed; failure throws
//   judge read    readFileSync .out/.err/.pid         missing file = empty text (a record can legitimately lack a stream)
//   judge cache   writeFileSync .ok                   failure is ignored: only the cache is lost, the record is judged again next time
//   stop          writeFileSync tmp + renameSync      failure throws (the stop must not be silent); the line is also printed on stderr

const fs = require('fs');
const path = require('path');
const authStop = require('./auth-stop.js');

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function procStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { state: rest[0], start: rest[19] };
  } catch (_e) { return null; }
}
function alive(pid, start) {
  const st = procStat(pid);
  return !!st && st.state !== 'Z' && (!start || st.start === start);
}
function arg(argv, name, dflt) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; }
const exists = (f) => { try { fs.accessSync(f); return true; } catch (_e) { return false; } };

function writeAtomic(file, text) {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function cmdRegister(argv) {
  const rec = arg(argv, '--rec'); const pid = arg(argv, '--pid');
  const st = procStat(pid);
  writeAtomic(`${rec}.pid`, `${pid} ${st ? st.start : ''}\n`);
  return 0;
}

// Write every byte of buf to fd. Short writes continue; EAGAIN waits and retries. Throws any other error.
function writeAll(fd, buf) {
  let off = 0; let spins = 0;
  while (off < buf.length) {
    try {
      off += fs.writeSync(fd, buf, off, buf.length - off);
      spins = 0;
    } catch (e) {
      if (e.code !== 'EAGAIN' || ++spins > 12000) throw e;   // 12000 x 5 ms = 60 s without the reader taking a byte
      sleepSync(5);
    }
  }
}

async function cmdMirror(argv) {
  const pid = arg(argv, '--pid'); const file = arg(argv, '--rec'); const outFd = Number(arg(argv, '--fd', '1')) === 2 ? 2 : 1;
  const st = procStat(pid); const start = st ? st.start : null;
  const recFd = fs.openSync(file, 'a');
  let outBroken = null; let writeError = null;
  const emit = (chunk) => {
    if (!writeError) { try { writeAll(recFd, chunk); } catch (e) { writeError = e; } }
    if (!outBroken) { try { writeAll(outFd, chunk); } catch (e) { outBroken = e; } }
  };
  const QUIET_MS = 300; const DRAIN_CAP_MS = 2000;
  // stdin is read through the stream machinery (poll based), never through fs.read(0): a threadpool read blocked on a pipe that a
  // grandchild keeps open would stop the process from exiting.
  let deathAt = null; let lastData = Date.now(); let eof = false;
  process.stdin.on('data', (chunk) => { emit(chunk); lastData = Date.now(); });
  process.stdin.on('end', () => { eof = true; });
  process.stdin.on('error', () => { eof = true; });
  while (!eof) {
    await sleep(50);
    const now = Date.now();
    if (deathAt === null) { if (!alive(pid, start)) { deathAt = now; lastData = now; } continue; }
    if (now - lastData >= QUIET_MS || now - deathAt >= DRAIN_CAP_MS) break;
  }
  try { fs.closeSync(recFd); } catch (e) { writeError = writeError || e; }
  if (outBroken) writeAtomic(`${file}.outbroken`, `${outBroken.code || outBroken.message}\n`);
  if (writeError) writeAtomic(`${file}.writeerror`, `${writeError.code || writeError.message}\n`);
  writeAtomic(`${file}.closed`, '');
  process.exit(0);
}

function readRec(base, ext) { try { return fs.readFileSync(`${base}.${ext}`, 'utf8'); } catch (_e) { return ''; } }
const isClosed = (base) => exists(`${base}.out.closed`) && exists(`${base}.err.closed`);

function readPid(base) {
  const parts = readRec(base, 'pid').trim().split(' ');
  return parts[0] ? { pid: parts[0], start: parts[1] || null } : null;
}
// The one place that decides what a record is. Used by the boundary mode and by --final alike.
function recordState(base) {
  const info = readPid(base);
  if (!info) return 'alive';                                    // registration still being written: not judged yet
  if (alive(info.pid, info.start)) return 'alive';              // PID-ALIVE
  return isClosed(base) ? 'ready' : 'pending';
}

// Every way a record can be incomplete -> judged as a FAILED record, never cached as .ok:
//   not closed (alive/pending)         state !== 'ready' in cmdJudge
//   .out.writeerror / .err.writeerror  the record file lost bytes (mirror could not write it)
//   .out or .err file missing          a closed record always has both (mirror opens them); a missing one means lost evidence
//   starttime unreadable (.pid)        the pid cannot be tied to one process: aliveness is a guess
// NOT incomplete: .outbroken (only the pass-through to the caller failed; the record file is complete) -> judged by its content.
function incompleteReason(base) {
  if (exists(`${base}.out.writeerror`) || exists(`${base}.err.writeerror`)) return 'writeerror';
  if (!exists(`${base}.out`) || !exists(`${base}.err`)) return 'missing-stream';
  const info = readPid(base);
  if (!info || !info.start) return 'no-starttime';
  return null;
}

function stop(dir, line) {
  writeAtomic(path.join(dir, 'STOP'), `${line}\n`);
  process.stderr.write(`${line}\n`);
  return authStop.EXIT_AUTH_STOP;
}

function cmdJudge(argv) {
  const dir = arg(argv, '--dir'); const prefix = arg(argv, '--id-prefix', '');
  const final = argv.includes('--final'); const waitMs = (final ? Number(arg(argv, '--wait', '10')) : 3) * 1000;
  if (exists(path.join(dir, 'STOP'))) {
    process.stderr.write(fs.readFileSync(path.join(dir, 'STOP'), 'utf8').replace(/^STOP_AUTH after /, `STOP_AUTH after ${prefix}`));
    return authStop.EXIT_AUTH_STOP;
  }
  const bases = () => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.pid')).map((f) => path.join(dir, f.slice(0, -4))).sort(); } catch (_e) { return []; } };
  const waitFor = (states) => {          // wait (bounded) until no record is in one of `states`
    const until = Date.now() + waitMs;
    while (Date.now() < until && bases().some((b) => !exists(`${b}.ok`) && states.includes(recordState(b)))) sleepSync(50);
  };
  waitFor(final ? ['alive', 'pending'] : ['pending']);
  for (const base of bases()) {
    if (exists(`${base}.ok`)) continue;
    const state = recordState(base);
    if (state === 'alive' && !final) continue;                  // still running: judged once it is closed
    const out = readRec(base, 'out'); const err = readRec(base, 'err');
    // ready: failed unless a successful result line exists. Not ready (final, or pending past the wait): a FAILED record, judged
    // from whatever exists.
    // Evidence that may be incomplete is never trusted as success and never cached: see incompleteReason.
    const incomplete = state !== 'ready' || incompleteReason(base);
    const failed = incomplete ? true : authStop.claudeStreamFailed(out);
    const hit = authStop.checkSources([{ kind: 'raw', text: out }, { kind: 'raw', text: err }], { failed });
    if (hit) return stop(dir, authStop.stopLine(`${prefix}${path.basename(base)}`, hit));
    if (!incomplete) { try { fs.writeFileSync(`${base}.ok`, ''); } catch (_e) { /* cache only */ } }
  }
  return 0;
}

async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'register') return cmdRegister(argv);
  if (cmd === 'mirror') return cmdMirror(argv);
  if (cmd === 'judge') return cmdJudge(argv);
  process.stderr.write('usage: claude-call-capture.js register|mirror|judge ...\n');
  return 2;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((rc) => { if (rc !== undefined) process.exitCode = rc; }, (e) => { process.stderr.write(`claude-call-capture: ${e && e.stack || e}\n`); process.exit(3); });
}
module.exports = { alive, procStat, isClosed, recordState, incompleteReason };
