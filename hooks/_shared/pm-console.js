'use strict';
/**
 * pm-console.js — shared PM-console gate for PM-only hooks (plan §2.5).
 *
 * True only when walking up from `cwd` to the FIRST directory containing `.git`
 * (either a `.git` directory holding `HEAD`, or a `.git` gitfile) finds
 * `.claude/console.json` with `schema: "autopilot.console/1"` and
 * `mode: "program"`. A child repo inside the PM workspace stops at its own
 * `.git` and never inherits the parent's `.claude/console.json`.
 */

const fs = require('fs');
const path = require('path');

const CONSOLE_SCHEMA = 'autopilot.console/1';

function hasGitRoot(dir) {
  const gitPath = path.join(dir, '.git');
  let st;
  try {
    st = fs.statSync(gitPath);
  } catch {
    return false;
  }
  if (st.isFile()) return true;
  if (st.isDirectory()) {
    try {
      return fs.statSync(path.join(gitPath, 'HEAD')).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

function readProgramConsole(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'console.json'), 'utf8'));
  } catch {
    return false;
  }
  return !!raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.schema === CONSOLE_SCHEMA
    && raw.mode === 'program';
}

function isPmConsole(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return false;
  let dir = path.resolve(cwd);
  for (;;) {
    if (hasGitRoot(dir)) return readProgramConsole(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

module.exports = { isPmConsole };
