'use strict';

/**
 * Shared PM console gate (matches mods/live/console.ts findConsoleMode):
 * walks up from cwd to the FIRST directory containing .git (a directory with
 * HEAD, or a .git file), and returns true only when that directory's
 * .claude/console.json parses to an object with schema "autopilot.console/1"
 * and mode "program".
 */

const fs = require('fs');
const path = require('path');

const CONSOLE_SCHEMA = 'autopilot.console/1';

function hasGitRoot(dir) {
  const gitPath = path.join(dir, '.git');
  try {
    const st = fs.statSync(gitPath);
    if (st.isFile()) return true;
    if (st.isDirectory()) {
      return fs.statSync(path.join(gitPath, 'HEAD')).isFile();
    }
  } catch {
    return false;
  }
  return false;
}

function readsProgramConsole(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'console.json'), 'utf8'));
    return !!raw && typeof raw === 'object' && !Array.isArray(raw)
      && raw.schema === CONSOLE_SCHEMA && raw.mode === 'program';
  } catch {
    return false;
  }
}

function isPmConsole(cwd) {
  if (typeof cwd !== 'string' || cwd === '') return false;
  let dir = path.resolve(cwd);
  for (;;) {
    if (hasGitRoot(dir)) return readsProgramConsole(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

module.exports = { isPmConsole };
