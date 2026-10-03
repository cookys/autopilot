'use strict';
// src/status/runs-fields.js — `autopilot status runs` enrichment (mods plan P1a R3).
//
// Adds the producer-side facts the live projection needs to every `runs` row:
// elapsed_s, rc, final_status, project, stall, source, fact_at, observed_at,
// probe_age_s. Read straight from the manifest (the dispatch-status `--list`
// branch carries none of them) plus a bounded-rotation `--run` liveness probe.
//
// Honesty rules (plan §2.5): unknown is null, never 0; a row that was never
// probed has alive:null and probe_age_s:null and is never shown as confirmed
// running; a row probed in an earlier call keeps its last values AND the time it
// was observed, so a consumer can judge freshness from probe_age_s.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ENRICH_CAP = 8;
const CURSOR_FILE = 'runs-enrich-cursor.json';

function readManifestSafe(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
  } catch (_e) { return null; }
}

function epochOf(manifest, epochKey, isoKey) {
  const e = manifest[epochKey];
  if (typeof e === 'number' && Number.isFinite(e)) return e;
  if (typeof e === 'string' && /^\d+$/.test(e)) return Number(e);
  const ms = Date.parse(String(manifest[isoKey] || ''));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// rc from <ledger>.results/<run_id>.<stage>.exit; null when there is no ledger,
// no exit file, or the file is not an integer (never guessed).
function exitFileOf(manifest, runId) {
  if (!manifest.ledger || !manifest.stage || !runId) return null;
  return path.join(`${manifest.ledger}.results`, `${runId}.${manifest.stage}.exit`);
}
function readRc(exitFile) {
  if (!exitFile) return null;
  try {
    const raw = fs.readFileSync(exitFile, 'utf8').trim();
    return /^-?\d+$/.test(raw) ? Number(raw) : null;
  } catch (_e) { return null; }
}

// --- project selector ----------------------------------------------------------
// R4 will switch this to projectKey() from src/status/project-key.js (R2 owns it).
function keyOf(repoIdentity) {
  return crypto.createHash('sha256').update(String(repoIdentity)).digest('hex').slice(0, 16);
}
function matchesProject(selector, repoIdentity) {
  if (typeof repoIdentity !== 'string' || repoIdentity === '') return false;
  if (selector === repoIdentity) return true;
  return /^[0-9a-f]{16}$/.test(selector) && selector === keyOf(repoIdentity);
}

// --- rotation state (cursor + last probe values) --------------------------------
function resolveStateFile(env) {
  try {
    const { resolveLiveDir } = require('../../scripts/lib/live-state-dir');
    const resolved = resolveLiveDir({ env, warn: () => {} });
    const base = resolved && resolved.base;
    return base ? path.join(base, CURSOR_FILE) : null;
  } catch (_e) { return null; }
}
function loadState(file, dir) {
  if (!file) return { cursor: null, order: [], probes: {} };
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (s && s.dir === dir && s.probes && typeof s.probes === 'object') {
      return {
        cursor: typeof s.cursor === 'string' ? s.cursor : null,
        order: Array.isArray(s.order) ? s.order : [],
        probes: s.probes,
      };
    }
  } catch (_e) { /* absent or corrupt → start over */ }
  return { cursor: null, order: [], probes: {} };
}
function saveState(file, dir, state) {
  if (!file) return;
  try {
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ schema: 1, dir, cursor: state.cursor, order: state.order, probes: state.probes }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (_e) { /* fail-open: rotation restarts from the top next call */ }
}

// Pick up to `cap` live run ids, resuming after the cursor and wrapping around, so
// every live run is probed within ceil(live/cap) calls.
function rotationPick(liveIds, cursor, cap, prevOrder = []) {
  if (liveIds.length === 0 || cap <= 0) return [];
  const at = cursor === null ? -1 : liveIds.indexOf(cursor);
  let start = at === -1 ? 0 : (at + 1) % liveIds.length;
  if (at === -1 && cursor !== null) {
    // Cursor run is gone: resume at the first still-live id after it in the last call's order.
    const was = prevOrder.indexOf(cursor);
    const next = was === -1 ? undefined : prevOrder.slice(was + 1).find((id) => liveIds.includes(id));
    if (next !== undefined) start = liveIds.indexOf(next);
  }
  const n = Math.min(cap, liveIds.length);
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(liveIds[(start + i) % liveIds.length]);
  return out;
}

/**
 * Build the enriched run rows.
 *   list      rows from dispatch-status.js --list (each has .manifest path)
 *   probeRun  (runId) => dispatch-status --run JSON | null   (injected by cli.js)
 */
function buildRunRows({ list, probeRun, enrichCap = DEFAULT_ENRICH_CAP, dir = '', env = process.env, nowMs = Date.now() }) {
  const manifests = list.map((row) => (row && row.manifest ? readManifestSafe(row.manifest) : null) || {});
  const isLive = (row, m) => !(row.ended_at || row.final_status || m.ended_at || m.final_status);
  const liveIds = [];
  list.forEach((row, i) => { if (isLive(row, manifests[i]) && row.run_id) liveIds.push(String(row.run_id)); });

  const stateFile = resolveStateFile(env);
  const state = loadState(stateFile, dir);
  const nowIso = new Date(nowMs).toISOString();

  // Drop cached probes of runs that are no longer live; probe this call's slice.
  const kept = {};
  for (const id of liveIds) if (state.probes[id]) kept[id] = state.probes[id];
  state.probes = kept;
  const picked = rotationPick(liveIds, state.cursor, enrichCap, state.order);
  for (const id of picked) {
    const s = probeRun(id);
    if (s) {
      state.probes[id] = {
        observed_at: new Date(Date.now()).toISOString(),
        phase: s.phase,
        alive: s.alive === undefined ? null : s.alive,
        stall: s.stall === undefined ? null : s.stall,
        last_event_age_s: s.last_event_age_s === undefined ? null : s.last_event_age_s,
      };
    }
    state.cursor = id;
  }
  state.order = liveIds;
  saveState(stateFile, dir, state);

  return list.map((row, i) => {
    const m = manifests[i];
    const entry = { ...row };
    const id = row.run_id ? String(row.run_id) : null;
    const live = isLive(row, m);
    const probe = live && id ? state.probes[id] : null;
    if (probe) {
      entry.phase = probe.phase;
      entry.alive = probe.alive;
      entry.stall = probe.stall;
      entry.last_event_age_s = probe.last_event_age_s;
    }
    const startedEpoch = epochOf(m, 'started_epoch', 'started_at');
    const endedEpoch = epochOf(m, 'ended_epoch', 'ended_at');
    const terminal = Boolean(m.ended_at || m.final_status || row.ended_at || row.final_status);
    const exitFile = exitFileOf(m, id);
    const probeMs = probe ? Date.parse(probe.observed_at) : NaN;
    const endEpoch = terminal ? endedEpoch : Math.floor(nowMs / 1000);
    entry.elapsed_s = startedEpoch === null || endEpoch === null ? null : Math.max(0, endEpoch - startedEpoch);
    entry.rc = readRc(exitFile);
    entry.final_status = m.final_status || row.final_status || null;
    entry.project = typeof m.repo_identity === 'string' && m.repo_identity ? m.repo_identity : null;
    if (entry.stall === undefined) entry.stall = null;
    if (entry.alive === undefined) entry.alive = null;
    entry.source = {
      manifest: row.manifest || null,
      status_probe: probe && id ? `dispatch-status.js --run ${id} --stall-secs 180` : null,
      exit_file: exitFile,
    };
    entry.fact_at = (terminal ? (m.ended_at || row.ended_at) : null) || m.started_at || row.started_at || null;
    entry.observed_at = probe ? probe.observed_at : nowIso;
    entry.probe_age_s = Number.isFinite(probeMs) ? Math.max(0, Math.round((nowMs - probeMs) / 1000)) : null;
    return entry;
  });
}

// Selectors. Shape stays an array unless a selector needs to carry metadata
// (--project's `unscoped`, --since's `filter`); then it is an object.
function applySelectors(rows, { project = null, root = null, since = null } = {}) {
  let out = rows;
  if (root !== null) out = out.filter((r) => r.root_run_id === root);
  let unscoped = null;
  if (project !== null) {
    unscoped = out.filter((r) => r.project === null);
    out = out.filter((r) => matchesProject(project, r.project));
  }
  if (since !== null) {
    const sinceMs = Date.parse(since);
    // Display filter: a run with no terminal state is still happening, so it stays.
    const keep = (r) => {
      const terminal = Boolean(r.ended_at || r.final_status);
      if (!terminal) return true;
      const ms = Date.parse(String(r.fact_at || ''));
      return Number.isFinite(ms) && ms >= sinceMs;
    };
    out = out.filter(keep);
    if (unscoped) unscoped = unscoped.filter(keep);
  }
  if (project === null && since === null) return out;
  const result = {};
  if (since !== null) result.filter = { since };
  if (project !== null) result.project = project;
  result.runs = out;
  if (unscoped) result.unscoped = unscoped;
  return result;
}

module.exports = {
  buildRunRows, applySelectors, matchesProject, rotationPick, DEFAULT_ENRICH_CAP, CURSOR_FILE,
};
