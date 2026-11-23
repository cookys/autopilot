#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SCHEMA = 'capacity.gateway-fill/1';
const MAX_AGE_MS = 15 * 60 * 1000;
const PRIORITY_RANK = { P1: 1, P2: 2, P3: 3 };

function gatewayFillPath(env = process.env) {
  return env.AUTOPILOT_GATEWAY_FILL || path.join(env.HOME || os.homedir(), 'projects', 'capacity', 'out', 'gateway_fill.v1.json');
}

function isValidBackend(b) {
  return Boolean(
    b
    && typeof b === 'object'
    && !Array.isArray(b)
    && typeof b.name === 'string'
    && b.name.length > 0
    && typeof b.eligible === 'boolean'
    && Number.isInteger(b.quota)
    && b.quota >= 0
  );
}

function readGatewayFill({ env = process.env, now = new Date() } = {}) {
  let raw;
  try {
    raw = fs.readFileSync(gatewayFillPath(env), 'utf8');
  } catch (error) {
    return { ok: false, reason: error && error.code === 'ENOENT' ? 'no_file' : 'unreadable' };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    return { ok: false, reason: 'bad_schema' };
  }

  if (
    !data
    || typeof data !== 'object'
    || Array.isArray(data)
    || data.schema !== SCHEMA
    || typeof data.generated_at !== 'string'
    || !data.generated_at
    || !Array.isArray(data.backends)
    || !data.backends.every(isValidBackend)
  ) {
    return { ok: false, reason: 'bad_schema' };
  }

  const generated = Date.parse(data.generated_at);
  if (!Number.isFinite(generated)) {
    return { ok: false, reason: 'bad_schema' };
  }

  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs) || generated > nowMs || nowMs - generated > MAX_AGE_MS) {
    return { ok: false, reason: 'stale' };
  }

  return { ok: true, data };
}

function compareReady(a, b) {
  const pa = PRIORITY_RANK[a.priority] ?? 99;
  const pb = PRIORITY_RANK[b.priority] ?? 99;
  if (pa !== pb) return pa - pb;

  const da = a.due ? Date.parse(a.due) : NaN;
  const db = b.due ? Date.parse(b.due) : NaN;
  const aHasDue = Number.isFinite(da);
  const bHasDue = Number.isFinite(db);
  if (aHasDue !== bHasDue) return aHasDue ? -1 : 1;
  if (aHasDue && da !== db) return da - db;

  const ia = String(a.id || '');
  const ib = String(b.id || '');
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

// Capacity's rules (task 01M8492MGT): resident is kept for main work, so it never takes
//dispatch; flashnext-b answers 429 when full, so its quota is capped. Ties go to glm, then by name.
const DEFAULT_EXCLUDE = ['resident'];
const DEFAULT_CAPS = { 'flashnext-b': 3 };
const TIE_FIRST = 'glm';

function betterTie(a, b) {
  if ((a.name === TIE_FIRST) !== (b.name === TIE_FIRST)) return a.name === TIE_FIRST;
  return a.name < b.name;
}

function allocate({ fill, ready = [], maxPerRound, exclude = DEFAULT_EXCLUDE, caps = DEFAULT_CAPS } = {}) {
  const assignments = [];
  const skipped = [];
  const cheap = [];

  for (const item of ready) {
    if (item && item.engineClass === 'cheap') {
      cheap.push(item);
    } else if (item) {
      skipped.push({ id: item.id, reason: 'not_cheap' });
    }
  }

  cheap.sort(compareReady);

  const backends = (fill && Array.isArray(fill.backends) ? fill.backends : [])
    .filter((b) => b && b.eligible === true && Number.isInteger(b.quota) && b.quota > 0 && !exclude.includes(b.name))
    .map((b) => ({ name: b.name, remaining: Number.isInteger(caps[b.name]) ? Math.min(b.quota, caps[b.name]) : b.quota }));

  const limit = maxPerRound !== undefined && maxPerRound !== null
    ? maxPerRound
    : (fill && Number.isInteger(fill.total_quota) && fill.total_quota >= 0 ? fill.total_quota : Infinity);

  for (const item of cheap) {
    if (assignments.length >= limit) {
      skipped.push({ id: item.id, reason: 'no_quota' });
      continue;
    }

    let backend = null;
    for (const b of backends) {
      if (b.remaining <= 0) continue;
      if (!backend || b.remaining > backend.remaining
        || (b.remaining === backend.remaining && betterTie(b, backend))) backend = b;
    }
    if (!backend) {
      skipped.push({ id: item.id, reason: 'no_quota' });
      continue;
    }
    backend.remaining -= 1;
    assignments.push({ id: item.id, lane: item.lane, backend: backend.name });
  }

  return { assignments, skipped };
}

function auditLine(assignment, _runId, ts = new Date()) {
  const iso = ts instanceof Date ? ts.toISOString() : String(ts);
  return `gateway-fill dispatch id=${assignment.id} lane=${assignment.lane} backend=${assignment.backend} ts=${iso}`;
}

module.exports = {
  SCHEMA,
  MAX_AGE_MS,
  gatewayFillPath,
  readGatewayFill,
  allocate,
  auditLine,
};
