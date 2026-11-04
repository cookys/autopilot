'use strict';
// Test fixture (G40 BL-0374): holds a REAL OS flock on a lock path from a separate process, the way a live competing
// writer would, so a test never plants a fake lock file. Tests call holdOsLock(lockPath) (synchronous: returns once the
// lock is held), release it with h.release() (kill -9, synchronous: returns once the kernel has freed the lock) and
// register installLeakCheck(after) once per test file: it kills what is left and asserts that no holder process, zombie or
// otherwise, outlives the file. Tools are looked up like the writer does (flock(1), then perl); neither -> throws.
// Node >= 20.10, built-ins only.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { spawn, spawnSync } = require('child_process');

const holders = new Set();

function findTool(name) {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch (_) { /* next */ }
  }
  return null;
}
const HOLD_SH = 'exec 9>>"$2"; "$1" -n 9 || { echo busy; exit 0; }; echo held; exec sleep 3600';
const HOLD_PERL = 'use Fcntl qw(:flock); $|=1; open(F,">>",$ARGV[0]) or die; flock(F,LOCK_EX|LOCK_NB) or do { print "busy\\n"; exit 0 }; print "held\\n"; sleep 3600;';
function holdSpec(lockPath) {
  const flock = findTool('flock');
  if (flock) return { cmd: '/bin/sh', args: ['-c', HOLD_SH, 'sh', flock, lockPath] };
  const perl = findTool('perl');
  if (perl) return { cmd: perl, args: ['-e', HOLD_PERL, lockPath] };
  throw new Error('os-lock-holder: neither flock nor perl on PATH');
}
function sleepMs(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// true when some process holds the OS lock on lockPath right now (probes with a non-blocking lock attempt).
function isHeld(lockPath) {
  const flock = findTool('flock');
  if (flock) return spawnSync(flock, ['-n', lockPath, 'true']).status !== 0;
  const perl = findTool('perl');
  const r = spawnSync(perl, ['-e', 'use Fcntl qw(:flock); open(F,">>",$ARGV[0]) or exit 2; exit(flock(F,LOCK_EX|LOCK_NB)?0:1)', lockPath]);
  return r.status === 1;
}

function holdOsLock(lockPath) {
  fs.closeSync(fs.openSync(lockPath, 'a', 0o600));
  const ackPath = `${lockPath}.holder-ack.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const ackFd = fs.openSync(ackPath, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_APPEND, 0o600);
  fs.unlinkSync(ackPath);
  const spec = holdSpec(lockPath);
  const child = spawn(spec.cmd, spec.args, { stdio: ['ignore', ackFd, 'ignore'] });
  child.unref();
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const h = { child, pid: child.pid, exited };
  holders.add(h);
  const buf = Buffer.alloc(64);
  const until = Date.now() + 5000;
  let said = '';
  while (Date.now() < until) {
    const n = fs.readSync(ackFd, buf, 0, buf.length, 0);
    said = buf.toString('utf8', 0, n).trim();
    if (said) break;
    sleepMs(2);
  }
  fs.closeSync(ackFd);
  if (said !== 'held') { child.kill('SIGKILL'); throw new Error(`os-lock-holder: could not take ${lockPath} (${said || 'no answer'})`); }
  h.release = () => {
    child.kill('SIGKILL');
    for (let i = 0; i < 500 && isHeld(lockPath); i += 1) sleepMs(5);
    assert.strictEqual(isHeld(lockPath), false, 'the killed holder freed the lock');
  };
  return h;
}

// Once per test file: after the file's tests, kill any holder still alive, wait for each exit, then assert none is left.
function installLeakCheck(after) {
  after(async () => {
    const pids = [];
    for (const h of holders) {
      pids.push(h.pid);
      if (h.child.exitCode === null && h.child.signalCode === null) { try { h.child.kill('SIGCONT'); h.child.kill('SIGKILL'); } catch (_) { /* gone */ } }
    }
    await Promise.all([...holders].map((h) => h.exited));
    holders.clear();
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, `holder ${pid} left no process behind`);
  });
}

module.exports = { holdOsLock, isHeld, installLeakCheck, findTool };
