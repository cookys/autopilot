'use strict';
/** PM seat gate: a program console or the session's PM fleet address. */

const fs = require('fs');
const path = require('path');
const { resolveFleetSeat } = require('./fleet-seat.js');

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
  const gitPath = path.join(dir, '.git');
  try {
    const st = fs.statSync(gitPath);
    if (st.isFile()) return true;
    if (!st.isDirectory()) return false;
    return fs.statSync(path.join(gitPath, 'HEAD')).isFile();
  } catch {
    return false;
  }
}

function resolveStartDir(cwdOrInput) {
  if (typeof cwdOrInput === 'string') {
    return cwdOrInput.trim() === '' ? null : cwdOrInput;
  }
  if (cwdOrInput && typeof cwdOrInput === 'object' && typeof cwdOrInput.cwd === 'string' && cwdOrInput.cwd.trim() !== '') {
    return cwdOrInput.cwd;
  }
  return null;
}

function pmConsoleStatus(cwdOrInput) {
  let modeKnown = false;
  try {
    const startDir = resolveStartDir(cwdOrInput);
    let dir = startDir ? path.resolve(startDir) : null;
    while (dir) {
      if (hasGitMarker(dir)) {
        try {
          const text = fs.readFileSync(path.join(dir, '.claude', 'console.json'), 'utf8');
          if (consoleModeOf(text)) return { pm: true, undetermined: false };
          const raw = JSON.parse(text);
          modeKnown = Boolean(raw && typeof raw.mode === 'string' && raw.mode.trim());
        } catch { /* no usable mode */ }
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* no usable mode */ }
  let seat = '';
  try { seat = resolveFleetSeat(cwdOrInput); } catch { /* no usable address */ }
  if (seat) return { pm: seat === 'pm', undetermined: false };
  return { pm: false, undetermined: !modeKnown };
}

function isPmConsole(cwdOrInput) {
  return pmConsoleStatus(cwdOrInput).pm;
}

module.exports = {
  isPmConsole,
  pmConsoleStatus,
  consoleModeOf,
  CONSOLE_SCHEMA,
  CONSOLE_MODE,
};
