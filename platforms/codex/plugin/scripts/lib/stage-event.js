'use strict';

// stage-event.js — one fleet progress line for a transition the calling script just caused.
//
//   emitStage({ taskId, stage, sha, detail, repoRoot }) -> { ok, skipped? }
//
// Task id: the argument when it is a non-empty string, else the session marker's fleet_task_id
// (the marker stage-advance reads: AUTOPILOT_SESSION_MODE_DIR + the session id). Neither: return
// without a fleet call and without extra output. Never guess an id.
// Line: `[stage:<stage>] <detail>` (detail defaults to sha). Idempotent key is task id + stage + sha,
// stored in stage-events.json under the session-marker directory, or under $XDG_RUNTIME_DIR/autopilot
// when AUTOPILOT_SESSION_MODE_DIR is unset and XDG_RUNTIME_DIR is set. A repeat key writes nothing.
// A fleet failure prints exactly one stderr line `stage-event: <reason>` per process and does not throw.
// Node >= 20.10, built-ins only.

const fs = require('fs');
const path = require('path');
const sessionMode = require('../session-mode');
const fleetTask = require('./fleet-task');

let fleetDown = false;

function stateDir() {
  if (process.env.AUTOPILOT_SESSION_MODE_DIR) return sessionMode.markerDir();
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) return path.join(xdg, 'autopilot');
  return sessionMode.markerDir();
}

function resolveTaskId(taskId) {
  if (typeof taskId === 'string' && taskId.trim()) return taskId.trim();
  try {
    const marker = sessionMode.readSessionRecord();
    const id = marker && typeof marker.fleet_task_id === 'string' ? marker.fleet_task_id.trim() : '';
    return id || '';
  } catch {
    return '';
  }
}

function readKeys(file) {
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!obj || typeof obj !== 'object' || !obj.keys || typeof obj.keys !== 'object') return {};
    return obj.keys;
  } catch {
    return {};
  }
}

function emitStage({ taskId, stage, sha, detail, repoRoot } = {}) {
  void repoRoot;
  const id = resolveTaskId(taskId);
  if (!id) return { ok: true, skipped: 'no-task' };
  const stageName = String(stage || '');
  const shaText = String(sha || '');
  if (!stageName || !shaText) return { ok: true, skipped: 'incomplete' };
  const text = `[stage:${stageName}] ${detail == null || detail === '' ? shaText : detail}`;
  const file = path.join(stateDir(), 'stage-events.json');
  const key = `${id}\n${stageName}\n${shaText}`;
  const keys = readKeys(file);
  if (keys[key]) return { ok: true, skipped: 'duplicate' };
  if (fleetDown) return { ok: false, skipped: 'fleet-down' };
  let result;
  try {
    result = fleetTask.progress(id, text);
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  if (!result.ok) {
    fleetDown = true;
    const why = String(result.error || 'fleet progress failed').split('\n')[0];
    process.stderr.write(`stage-event: ${why}\n`);
    return { ok: false, error: why };
  }
  keys[key] = true;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ keys }));
    fs.renameSync(tmp, file);
  } catch (error) {
    process.stderr.write(`stage-event: ${String(error.message || error).split('\n')[0]}\n`);
  }
  return { ok: true, text };
}

module.exports = { emitStage };
