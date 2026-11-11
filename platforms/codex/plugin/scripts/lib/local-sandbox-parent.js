'use strict';

// One per-uid local-implementer worktree parent. The shell
// (scripts/lib/local-sandbox-endpoint.sh) and src/engine/autopilot-engine.js
// both call localSandboxWorktreeParent. Node built-ins only.
//
// The argument is the temp directory (${TMPDIR:-/tmp} from the shell,
// os.tmpdir() from the engine). A relative path, or a realpath failure,
// uses /tmp and does not walk. Otherwise the walk is on the real path:
// lstat of each ancestor's .git; a hit uses /tmp. The candidate is
// <base>/autopilot-local-sbx-<uid>. mkdir mode 0700 (EEXIST is fine),
// then one lstat: a real directory, this uid, mode 0700. Anything else
// throws. The caller refuses the dispatch.
//
// CLI: node scripts/lib/local-sandbox-parent.js <temp-dir>
//   prints the parent path and exits 0, or exits 1.

const fs = require('fs');
const path = require('path');

function tempBaseHasGitAncestor(start) {
  if (typeof start !== 'string' || !path.isAbsolute(start)) {
    throw new Error('tempBaseHasGitAncestor requires an absolute path');
  }
  let dir = start;
  for (;;) {
    try {
      fs.lstatSync(path.join(dir, '.git'));
      return true;
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

function ensureMode0700Owned(dir) {
  if (typeof process.getuid !== 'function') {
    throw new Error('local sandbox worktree parent requires process.getuid()');
  }
  const uid = process.getuid();
  const prev = process.umask(0o077);
  try {
    fs.mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error;
  } finally {
    process.umask(prev);
  }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`local sandbox worktree parent is not a real directory: ${dir}`);
  }
  if (st.uid !== uid) {
    throw new Error(`local sandbox worktree parent owner is not uid ${uid}: ${dir}`);
  }
  if ((st.mode & 0o777) !== 0o700) {
    throw new Error(`local sandbox worktree parent mode is not 0700: ${dir}`);
  }
  return dir;
}

function sandboxBase(raw) {
  if (typeof raw !== 'string' || !path.isAbsolute(raw)) return '/tmp';
  let real;
  try {
    real = fs.realpathSync(raw);
  } catch (_error) {
    return '/tmp';
  }
  if (typeof real !== 'string' || !path.isAbsolute(real)) return '/tmp';
  if (tempBaseHasGitAncestor(real)) return '/tmp';
  return real;
}

function localSandboxWorktreeParent(raw) {
  if (typeof process.getuid !== 'function') {
    throw new Error('local sandbox worktree parent requires process.getuid()');
  }
  const parent = path.join(sandboxBase(raw), 'autopilot-local-sbx-' + process.getuid());
  return ensureMode0700Owned(parent);
}

function main() {
  const raw = process.argv[2];
  if (typeof raw !== 'string') {
    process.stderr.write('local-sandbox-parent.js: missing temp directory\n');
    process.exit(1);
  }
  try {
    process.stdout.write(`${localSandboxWorktreeParent(raw)}\n`);
  } catch (error) {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exit(1);
  }
}

module.exports = {
  tempBaseHasGitAncestor,
  ensureMode0700Owned,
  localSandboxWorktreeParent,
};

if (require.main === module) main();
