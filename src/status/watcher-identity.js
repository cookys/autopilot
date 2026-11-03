'use strict';

// src/status/watcher-identity.js — is this pid, RIGHT NOW, the project's runs watcher? (BL cardvis)
//
// The ONE structural judgement behind every path that signals or trusts a watcher pid read from a file (hooks/runs-watch-autostart.js
// inspectWatcher / reapStale, src/status/card-visibility.js holderState, runs-watch.js `--stop`). argv text alone is never enough: a decoy
// or a recycled pid can carry any argv. All three must hold, read from /proc at the time of asking:
//   1. entry point: argv = node <path>/bin/autopilot.js status runs --watch ...   (argv[1] basename autopilot.js, argv[2..4])
//   2. project:     `--project <key>` or `--project=<key>`
//   3. lock:        one of /proc/<pid>/fd points at the project's lock file `lockPath` (the launch wrapper `exec 9>"$LOCK"; flock -n 9; exec node`
//                   leaves fd 9 on it in the node process, so only the real holder has it)
// Anything that cannot be confirmed (no /proc, no such pid, unreadable argv or fd directory, other entry point, no fd on the lock) is null:
// the caller must not signal it and must not call it a watcher.
//   -> null | { state: 'renders' | 'no_render', pid, argv, argvRoot }      ('no_render' = argv has no --render)

const fs = require('fs');
const path = require('path');

function projectOf(argv) {
  for (let i = 5; i < argv.length; i += 1) {
    if (argv[i] === '--project') return argv[i + 1] === undefined ? null : argv[i + 1];
    if (argv[i].startsWith('--project=')) return argv[i].slice('--project='.length);
  }
  return null;
}

// <root>/bin/autopilot.js -> <root>, realpath'd when it resolves
function argvRootOf(argv) {
  try { return fs.realpathSync(path.resolve(argv[1], '..', '..')); } catch (_error) { return path.resolve(argv[1], '..', '..'); }
}

function classifyWatcher(pid, key, lockPath) {
  try {
    if (!Number.isInteger(pid) || pid <= 0 || typeof key !== 'string' || !key || typeof lockPath !== 'string' || !lockPath) return null;
    const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
    if (argv.length < 5 || path.basename(argv[1]) !== 'autopilot.js' || argv[2] !== 'status' || argv[3] !== 'runs' || argv[4] !== '--watch') return null;
    if (projectOf(argv) !== key) return null;
    let real = lockPath;
    try { real = fs.realpathSync(lockPath); } catch (_error) { /* the lock file is gone: no fd can match it */ }
    let holds = false;
    for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
      let target = null;
      try { target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch (_error) { continue; }
      if (target === lockPath || target === real) { holds = true; break; }
    }
    if (!holds) return null;
    return { state: argv.includes('--render') ? 'renders' : 'no_render', pid, argv, argvRoot: argvRootOf(argv) };
  } catch (_error) {
    return null;
  }
}

module.exports = { classifyWatcher, projectOf };
