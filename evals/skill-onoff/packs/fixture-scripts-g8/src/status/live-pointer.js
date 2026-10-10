'use strict';

// src/status/live-pointer.js — the pointer the mod uses to find the live base (mods plan §2.8, G2 R4).
// $HOME/.autopilot/live-pointer.json = {schema, live_base, autopilot_home, written_at}, written
// atomically (tmp + rename). The mod only knows $HOME; every other path comes from this file.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveLiveDir } = require('../../scripts/lib/live-state-dir');

const SCHEMA = 'autopilot.live-pointer/1';

function homeOf(env) {
  return (env && env.HOME) || os.homedir();
}

// autopilot_home = parent of the session-mode dir when AUTOPILOT_SESSION_MODE_DIR is set (so a suite
// that isolates the marker dir isolates the pointer too), else $HOME/.autopilot (what the mod reads).
function autopilotHomeOf(env) {
  const dir = env && env.AUTOPILOT_SESSION_MODE_DIR;
  if (dir) return path.dirname(path.resolve(dir));
  return path.join(homeOf(env), '.autopilot');
}

function pointerPath(env = process.env) {
  return path.join(autopilotHomeOf(env), 'live-pointer.json');
}

function writeLivePointer({ env = process.env, now = Date.now() } = {}) {
  const autopilotHome = autopilotHomeOf(env);
  const target = pointerPath(env);
  const pointer = {
    schema: SCHEMA,
    live_base: resolveLiveDir({ env }).base,
    autopilot_home: autopilotHome,
    written_at: new Date(now).toISOString(),
  };
  fs.mkdirSync(autopilotHome, { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
    fs.renameSync(tmp, target);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch (_cleanup) { /* best effort */ }
    throw error;
  }
  return { path: target, pointer };
}

function readLivePointer({ env = process.env } = {}) {
  try {
    const value = JSON.parse(fs.readFileSync(pointerPath(env), 'utf8'));
    if (!value || value.schema !== SCHEMA) return null;
    return value;
  } catch (_error) {
    return null;
  }
}

module.exports = { SCHEMA, pointerPath, writeLivePointer, readLivePointer };
