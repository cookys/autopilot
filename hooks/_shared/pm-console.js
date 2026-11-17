'use strict';
/**
 * pm-console.js — shared PM session gate (§2.5 of 2026-11-17-pm-token-split).
 *
 * Walk up from the hook cwd to the FIRST directory holding `.git` (a directory
 * or a gitfile), read that repo's `.claude/console.json`, and require
 * schema === "autopilot.console/1" AND mode === "program" (the same rule as
 * mods/live/console.ts). A child repo inside the PM workspace stops at its own
 * `.git` and never borrows the parent workspace's console.json.
 *
 * Fail-closed: missing directory, missing `.git`, missing/corrupt console.json,
 * foreign schema, or any other mode returns false.
 */

const fs = require('fs');
const path = require('path');

const CONSOLE_SCHEMA = 'autopilot.console/1';
const CONSOLE_MODE = 'program';

function consoleModeOf(text) {
  if (typeof text !== 'string') return false;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return false;
  }
  return Boolean(
    raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && raw.schema === CONSOLE_SCHEMA
    && raw.mode === CONSOLE_MODE,
  );
}

function hasGitMarker(dir) {
  try {
    const st = fs.statSync(path.join(dir, '.git'));
    return st.isFile() || st.isDirectory();
  } catch {
    return false;
  }
}

function resolveStartDir(cwdOrInput) {
  if (typeof cwdOrInput === 'string' && cwdOrInput !== '') return cwdOrInput;
  if (cwdOrInput && typeof cwdOrInput === 'object' && typeof cwdOrInput.cwd === 'string' && cwdOrInput.cwd !== '') {
    return cwdOrInput.cwd;
  }
  return process.cwd();
}

function isPmConsole(cwdOrInput) {
  try {
    let dir = path.resolve(resolveStartDir(cwdOrInput));
    for (;;) {
      if (hasGitMarker(dir)) {
        try {
          const text = fs.readFileSync(path.join(dir, '.claude', 'console.json'), 'utf8');
          return consoleModeOf(text);
        } catch {
          return false;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) return false;
      dir = parent;
    }
  } catch {
    return false;
  }
}

module.exports = {
  isPmConsole,
  consoleModeOf,
  CONSOLE_SCHEMA,
  CONSOLE_MODE,
};
