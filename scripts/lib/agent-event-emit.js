#!/usr/bin/env node
'use strict';

// scripts/lib/agent-event-emit.js — shared fleet agent-event emitter for JS dispatch rails.
// Never fails the dispatch: any emit failure prints one stderr hint and returns 0.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function mapRunner(runner) {
  const r = String(runner || '').trim().toLowerCase();
  return r || 'claude';
}

function mapStage(role) {
  switch (String(role || '').toLowerCase()) {
    case 'implementer':
    case 'build':
    case 'foreman':
    case 'batch':
      return 'build';
    case 'reviewer':
    case 'plan-review':
    case 'review':
      return 'review';
    case 'author':
    case 'plan':
    case 'consult':
    case 'discuss':
    case 'panel':
    case 'explore':
      return 'plan';
    case 'merge':
      return 'merge';
    default:
      return 'build';
  }
}

function resolveSeat(env = process.env) {
  if (env.AUTOPILOT_FLEET_ADDRESS) return env.AUTOPILOT_FLEET_ADDRESS;
  const user = env.USER || String(process.getuid ? process.getuid() : 'user');
  const cacheFile = path.join(env.TMPDIR || os.tmpdir(), `autopilot-fleet-seat-${user}.txt`);
  try {
    const cached = fs.readFileSync(cacheFile, 'utf8').split(/\r?\n/)[0].trim();
    if (cached) return cached;
  } catch { /* ignore */ }
  const fleetBin = env.AUTOPILOT_FLEET_BIN || 'fleet';
  try {
    const res = spawnSync(fleetBin, ['whoami'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (res.status === 0 && res.stdout) {
      const who = res.stdout.split(/\r?\n/)[0].trim();
      if (who) {
        try { fs.writeFileSync(cacheFile, `${who}\n`); } catch { /* ignore */ }
        return who;
      }
    }
  } catch { /* ignore */ }
  return 'unknown';
}

function createEmitter({ role = 'implementer', runner = 'claude', runId = '', taskId = '', env = process.env } = {}) {
  let seq = 0;
  const resolvedRunId = runId || `run-${Date.now()}-${process.pid}`;
  const resolvedTaskId = taskId || env.AUTOPILOT_FLEET_TASK || env.AUTOPILOT_UPSTREAM_TASK_ID || '';
  const stage = mapStage(role);
  const mappedRunner = mapRunner(runner);
  const seat = resolveSeat(env);
  const sessionId = env.AUTOPILOT_SESSION_ID || String(process.pid);
  const lane = env.AUTOPILOT_LANE || 'autopilot';
  const fleetBin = env.AUTOPILOT_FLEET_BIN || 'fleet';

  function emit(state, extra = {}) {
    seq += 1;
    const payload = {
      ts: Date.now(),
      seat,
      session_id: sessionId,
      runner: mappedRunner,
      agent_kind: 'dispatch',
      lane,
      state,
      seq,
      event_id: `${resolvedRunId}-${seq}`,
      run_id: resolvedRunId,
      stage,
    };
    if (resolvedTaskId) payload.task_id = resolvedTaskId;
    if (state === 'ended') {
      payload.rc = Number.isInteger(extra.rc) ? extra.rc : (Number(extra.rc) || 0);
      if (extra.detail) payload.detail = String(extra.detail);
    }
    try {
      const res = spawnSync(fleetBin, ['event', 'emit'], {
        input: `${JSON.stringify(payload)}\n`,
        encoding: 'utf8',
        timeout: 3000,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      if (res.error || res.status !== 0) {
        process.stderr.write(`agent-event-emit: fleet event emit failed (state=${state}, run_id=${resolvedRunId})\n`);
      }
    } catch {
      process.stderr.write(`agent-event-emit: fleet event emit failed (state=${state}, run_id=${resolvedRunId})\n`);
    }
  }

  return {
    accepted: () => emit('accepted'),
    ended: (rc = 0, detail = '') => emit('ended', { rc, detail }),
    runId: resolvedRunId,
  };
}

module.exports = { createEmitter, mapRunner, mapStage, resolveSeat };
