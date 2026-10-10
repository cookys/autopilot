'use strict';
// src/status/review-server.js — the one localhost review server per host (mods plan P1b B2, R4.1).
//
//   node src/status/review-server.js ensure | stop
//
// Served root = <autopilot_home>/review/ (one subdir per project_key). The server is
//   python3 -m http.server --bind 127.0.0.1 <port> --directory <autopilot_home>/review
// started DETACHED under flock(1) (same wrapper shape as src/status/runs-watch.js: the python
// process itself holds fd 9 on <live>/review/server.lock, so holding is verified on the locked
// inode and the lock dies with the process). It is NOT a child of the watcher: the watcher's
// --idle-exit / --stop do not touch it; only stopReviewServer() does.
// The bind address is hard-coded to 127.0.0.1. Auth / TLS belong to the user's reverse proxy.
// Port = <autopilot_home>/config.json key review.port, default 8787; a busy port is reported
// ("review server: port busy" on stderr) and never replaced by another port.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { resolveLiveDir } = require('../../scripts/lib/live-state-dir');
const { pointerPath } = require('./live-pointer');

const DEFAULT_PORT = 8787;
const BIND = '127.0.0.1';
const LOCK_BUSY_RC = 75;
const STARTUP_WAIT_MS = 5000;
const STOP_WAIT_MS = 5000;

// $1 lock, $2 server.json, $3 port, $4 root, $5 started_at; the rest is the server argv. $$ is the
// pid that becomes the python process (exec), so server.json names the lock holder.
const WRAPPER = 'exec 9>"$1" || exit 1; flock -n 9 || exit 75; '
  + 'printf \'{"pid":%s,"port":%s,"root":"%s","started_at":"%s"}\\n\' "$$" "$3" "$4" "$5" > "$2.tmp" '
  + '&& mv "$2.tmp" "$2"; shift 5; exec "$@"';

function autopilotHomeOf(env) {
  return path.dirname(pointerPath(env));
}

function liveBaseOf(env) {
  return resolveLiveDir({ env, warn: () => {} }).base;
}

function paths({ env, liveDir, autopilotHome }) {
  const home = autopilotHome || autopilotHomeOf(env);
  const live = liveDir || liveBaseOf(env);
  return {
    home,
    root: path.join(home, 'review'),
    liveReview: path.join(live, 'review'),
    lock: path.join(live, 'review', 'server.lock'),
    info: path.join(live, 'review', 'server.json'),
    log: path.join(home, 'review', 'server.log'),
  };
}

function readReviewPort(autopilotHome) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(autopilotHome, 'config.json'), 'utf8'));
    const port = cfg && cfg.review && cfg.review.port;
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  } catch (_error) { /* missing or unreadable config: default */ }
  return DEFAULT_PORT;
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readInfo(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && Number.isInteger(v.pid) ? v : null;
  } catch (_error) { return null; }
}

function cmdlineOf(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
  } catch (_error) { return null; }
}

function pidAlive(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch (_error) { return false; }
}

// Is anything listening on this TCP port (any local address, v4 or v6)? /proc/net/tcp{,6}, state 0A.
function portListening(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { continue; }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 3 && cols[3] === '0A' && cols[1].split(':')[1] === hex) return true;
    }
  }
  return false;
}

function isReviewServer(pid, root, port) {
  const argv = cmdlineOf(pid);
  if (!argv) return false;
  const at = argv.indexOf('--directory');
  return argv.includes('http.server') && argv.includes(BIND) && argv.includes(String(port))
    && at !== -1 && argv[at + 1] === root;
}

function serverLaunchArgv({ lock, info, port, root, startedAt }) {
  return ['-c', WRAPPER, 'sh', lock, info, String(port), root, startedAt,
    'python3', '-m', 'http.server', '--bind', BIND, String(port), '--directory', root];
}

/**
 * Ensure the host review server runs. Never throws.
 *   -> { status: 'started'|'running'|'port_busy'|'flock_unavailable'|'python_unavailable'|'error',
 *        pid?, port, message? }
 * Foreground probe first (`flock -n <lock> true`; a detached `flock -n` that loses is silent).
 */
function ensureReviewServer({ env = process.env, liveDir, autopilotHome, port, stderr = process.stderr } = {}) {
  let p;
  let usePort;
  try {
    p = paths({ env, liveDir, autopilotHome });
    usePort = port || readReviewPort(p.home);
    fs.mkdirSync(p.root, { recursive: true, mode: 0o700 });
    fs.mkdirSync(p.liveReview, { recursive: true, mode: 0o700 });
    const probe = spawnSync('flock', ['-n', p.lock, 'true'], { encoding: 'utf8', timeout: 5000, env });
    if (probe.error) return { status: 'flock_unavailable', port: usePort, message: probe.error.message };
    if (probe.status === 1) {
      const held = readInfo(p.info);
      return { status: 'running', pid: held ? held.pid : null, port: held ? held.port : usePort };
    }
    if (probe.status !== 0) return { status: 'error', port: usePort, message: `flock probe exited ${probe.status}` };
    const py = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 5000, env });
    if (py.error || py.status !== 0) {
      return { status: 'python_unavailable', port: usePort, message: py.error ? py.error.message : `python3 exited ${py.status}` };
    }
    if (portListening(usePort)) {
      stderr.write('review server: port busy\n');
      return { status: 'port_busy', port: usePort };
    }
    try { fs.unlinkSync(p.info); } catch (_error) { /* stale info from a dead server */ }
    const fd = fs.openSync(p.log, 'a', 0o600);
    try {
      const child = spawn('nohup', ['sh', ...serverLaunchArgv({
        lock: p.lock, info: p.info, port: usePort, root: p.root, startedAt: new Date().toISOString(),
      })], { env, detached: true, stdio: ['ignore', fd, fd] });
      child.on('error', () => { /* surfaced by the missing server.json below */ });
      child.unref();
    } finally {
      fs.closeSync(fd);
    }
    const deadline = Date.now() + STARTUP_WAIT_MS;
    while (Date.now() < deadline) {
      const info = readInfo(p.info);
      if (info && pidAlive(info.pid) && portListening(usePort)) return { status: 'started', pid: info.pid, port: usePort };
      sleepMs(50);
    }
    const info = readInfo(p.info);
    if (portListening(usePort) && !(info && pidAlive(info.pid))) {
      stderr.write('review server: port busy\n');
      return { status: 'port_busy', port: usePort };
    }
    return { status: 'error', port: usePort, message: `server did not come up within ${STARTUP_WAIT_MS} ms (see ${p.log})` };
  } catch (error) {
    return { status: 'error', port: usePort, message: error.message };
  }
}

/**
 * Stop the host review server. Never throws.
 *   -> { status: 'stopped'|'not_running'|'refused'|'still_running', pid?, message? }
 * SIGTERM is sent only after /proc/<pid>/cmdline matches the http.server for server.json's root+port.
 */
function stopReviewServer({ env = process.env, liveDir, autopilotHome } = {}) {
  try {
    const p = paths({ env, liveDir, autopilotHome });
    const info = readInfo(p.info);
    if (!info || !pidAlive(info.pid)) {
      try { fs.unlinkSync(p.info); } catch (_error) { /* nothing to clean */ }
      return { status: 'not_running' };
    }
    if (!isReviewServer(info.pid, info.root, info.port) || info.root !== p.root) {
      return { status: 'refused', pid: info.pid, message: `pid ${info.pid} is not the review server for ${p.root}` };
    }
    process.kill(info.pid, 'SIGTERM');
    const deadline = Date.now() + STOP_WAIT_MS;
    while (Date.now() < deadline) {
      if (!pidAlive(info.pid)) {
        try { fs.unlinkSync(p.info); } catch (_error) { /* best effort */ }
        return { status: 'stopped', pid: info.pid };
      }
      sleepMs(50);
    }
    return { status: 'still_running', pid: info.pid, message: `still running pid ${info.pid}` };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}

function runCli(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  const sub = argv[0];
  if (sub === 'ensure') {
    const r = ensureReviewServer({ env, stderr });
    stdout.write(`${JSON.stringify(r)}\n`);
    return ['started', 'running'].includes(r.status) ? 0 : 1;
  }
  if (sub === 'stop') {
    const r = stopReviewServer({ env });
    if (r.status === 'stopped' || r.status === 'not_running') { stdout.write(`${JSON.stringify(r)}\n`); return 0; }
    stderr.write(`${r.message || r.status}\n`);
    return 1;
  }
  stderr.write('usage: review-server.js ensure|stop\n');
  return 2;
}

if (require.main === module) process.exit(runCli(process.argv.slice(2)));

module.exports = {
  DEFAULT_PORT, BIND, LOCK_BUSY_RC, ensureReviewServer, stopReviewServer, readReviewPort, serverLaunchArgv, portListening, isReviewServer, runCli,
};
