#!/usr/bin/env node
'use strict';
// claude-call-capture.js -- evidence capture for the PATH `claude` wrapper of the eval batches (BL-0294).
//
// Why it exists: the skill-creator scripts (run_eval.py / run_loop.py) run `claude -p` with stderr=DEVNULL, never read the
// exit code, return on the first type=result line and then SIGKILL the child, and always write a valid summary. An
// authentication failure is invisible to the batch that started them. The PATH wrapper (scripts/lib/claude-call-capture-exec.sh,
// used by scripts/run-eval-batch.sh and scripts/run-skill-opt.sh) keeps the child's life cycle (it ENDS IN `exec claude`, so the
// caller's kill hits claude itself) and mirrors the two streams into a per-call record with the `mirror` command below.
// A record <rec> is: <rec>.pid ("pid starttime"), <rec>.out, <rec>.err, and the markers <rec>.out.closed / <rec>.err.closed.
//
// Commands (Node built-ins only):
//   register --rec REC --pid P          write REC.pid = "P starttime" (starttime from /proc/P/stat, so a reused pid is never mistaken)
//   mirror --pid P --rec FILE --fd 1|2  stdin -> the original stdout/stderr AND FILE; every ~200 ms it checks that process P (same
//                                       starttime) is still alive. When P is gone (or stdin ends) it stops reading, writes
//                                       FILE.closed and exits -- a grandchild that keeps the pipe open cannot keep the mirror alive.
//   judge --dir D [--final [--wait SEC]] [--id-prefix X]
//                                       judge the closed records of D; exit 0 = none failed on authentication, 6 = one did (the
//                                       line "STOP_AUTH after <id>: ..." on stderr, STOP written atomically as STOP.tmp.<pid> -> STOP).
//                                       boundary mode (default, run before every claude start): a record whose process is still
//                                       alive is SKIPPED and never cached; a dead one is waited for (<= 3 s) until both streams are
//                                       closed. --final (after the caller returned): wait up to --wait seconds (default 10) for all
//                                       records to close, an unclosed record is then judged as it is (counts as a failed record).
//   A record is FAILED when its stream has no successful type=result line (killed early, unfinished, exit 0 with only an auth
//   message); a failed record with an authentication phrase in .out or .err is an auth failure (scripts/lib/auth-stop.js).

const fs = require('fs');
const path = require('path');
const authStop = require('./auth-stop.js');

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function procStat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return { state: rest[0], start: rest[19] };
  } catch (_e) { return null; }
}
function alive(pid, start) {
  const st = procStat(pid);
  return !!st && st.state !== 'Z' && (start == null || st.start === start);
}
function arg(argv, name, dflt) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; }

function cmdRegister(argv) {
  const rec = arg(argv, '--rec'); const pid = arg(argv, '--pid');
  const st = procStat(pid);
  fs.writeFileSync(`${rec}.pid`, `${pid} ${st ? st.start : ''}\n`);
  return 0;
}

function cmdMirror(argv) {
  const pid = arg(argv, '--pid'); const file = arg(argv, '--rec'); const fd = Number(arg(argv, '--fd', '1'));
  const st = procStat(pid); const start = st ? st.start : null;
  const outFd = fd === 2 ? 2 : 1;
  const rec = fs.openSync(file, 'a');
  let closed = false;
  const writeOut = (buf) => { try { fs.writeSync(outFd, buf); } catch (_e) { /* downstream gone (EPIPE) or full: the record still gets it */ } };
  const close = () => {
    if (closed) return; closed = true;
    try { fs.closeSync(rec); } catch (_e) { /* ignore */ }
    fs.writeFileSync(`${file}.closed`, '');
    process.exit(0);
  };
  process.stdin.on('data', (chunk) => { try { fs.writeSync(rec, chunk); } catch (_e) { /* ignore */ } writeOut(chunk); });
  process.stdin.on('end', close);
  process.stdin.on('error', close);
  setInterval(() => { if (!alive(pid, start)) setTimeout(close, 150); }, 200);
  return null;   // keep running
}

function readRec(base, ext) { try { return fs.readFileSync(`${base}.${ext}`, 'utf8'); } catch (_e) { return ''; } }
const exists = (f) => { try { fs.accessSync(f); return true; } catch (_e) { return false; } };
const isClosed = (base) => exists(`${base}.out.closed`) && exists(`${base}.err.closed`);

function stop(dir, line) {
  const tmp = path.join(dir, `STOP.tmp.${process.pid}`);
  fs.writeFileSync(tmp, `${line}\n`);
  fs.renameSync(tmp, path.join(dir, 'STOP'));
  process.stderr.write(`${line}\n`);
  return authStop.EXIT_AUTH_STOP;
}

function cmdJudge(argv) {
  const dir = arg(argv, '--dir'); const prefix = arg(argv, '--id-prefix', '');
  const final = argv.includes('--final'); const wait = Number(arg(argv, '--wait', '10'));
  if (exists(path.join(dir, 'STOP'))) {
    process.stderr.write(fs.readFileSync(path.join(dir, 'STOP'), 'utf8').replace(/^STOP_AUTH after /, `STOP_AUTH after ${prefix}`));
    return authStop.EXIT_AUTH_STOP;
  }
  const bases = () => { try { return fs.readdirSync(dir).filter((f) => f.endsWith('.out') && !f.endsWith('.closed')).map((f) => path.join(dir, f.slice(0, -4))).sort(); } catch (_e) { return []; } };
  if (final) {
    const until = Date.now() + wait * 1000;
    while (Date.now() < until && bases().some((b) => !isClosed(b))) sleepSync(100);
  }
  for (const base of bases()) {
    if (exists(`${base}.ok`)) continue;
    let closed = isClosed(base);
    if (!closed && !final) {
      const pidInfo = readRec(base, 'pid').trim().split(' ');
      if (!pidInfo[0]) continue;                       // not registered yet: nothing to judge
      const pidIsAlive = alive(pidInfo[0], pidInfo[1] || null);
      if (pidIsAlive) continue;                        // BOUNDARY-SKIP-OPEN: still running, judged once it is closed
      const until = Date.now() + 3000;                 // dead: its mirrors close within ~0.4 s
      while (Date.now() < until && !isClosed(base)) sleepSync(50);
      closed = isClosed(base);
    }
    const out = readRec(base, 'out'); const err = readRec(base, 'err');
    const failed = authStop.claudeStreamFailed(out);
    const hit = authStop.checkSources([{ kind: 'raw', text: out }, { kind: 'raw', text: err }], { failed });
    if (hit) return stop(dir, authStop.stopLine(`${prefix}${path.basename(base)}`, hit));
    if (closed) fs.writeFileSync(`${base}.ok`, '');    // OK-ONLY-CLOSED
  }
  return 0;
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'register') return cmdRegister(argv);
  if (cmd === 'mirror') return cmdMirror(argv);
  if (cmd === 'judge') return cmdJudge(argv);
  process.stderr.write('usage: claude-call-capture.js register|mirror|judge ...\n');
  return 2;
}

if (require.main === module) {
  const rc = main(process.argv.slice(2));
  if (rc !== null) process.exitCode = rc;
}
module.exports = { alive, procStat, isClosed };
