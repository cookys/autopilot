'use strict';

// src/status/events/sources/dispatch.js - dispatch run manifests -> `dispatch.started`, `dispatch.ended` (autopilot.events/1).
//
// read(ctx, window) -> { events, warnings, stats }
//   ctx    = { project: { project_key, repo_identity }, env, home, now }
//   window = { sinceTs (epoch ms | ISO | null), slackMs, hints }   (hints are unused: a manifest dir is small and stat-filtered)
// Source: <runsDir(env)>/<safe_id>.manifest.json, written atomically (temp file + mv) by scripts/dispatch-hetero.sh:write_manifest.
// Read-only, never throws. `panel-*` manifests (plan-review panels, another shape) are skipped. A manifest whose mtime is older
// than sinceTs - slack is skipped on a stat alone (a finished manifest is immutable, and any later change moves the mtime).
// Manifests are renamed into place, so a parse failure is real corruption: `line_unparseable` with the basename.

const fs = require('fs');
const path = require('path');
const { runsDir } = require('../../../../scripts/lib/runtime-paths');
const { parseInstant, parseInstantMs } = require('../instant');

const SOURCE = 'dispatch';
const EVENT_SOURCE = 'dispatch_manifest';
const MAX_MANIFEST_BYTES = 1024 * 1024;

function warner() {
  const map = new Map();
  return {
    add(code, detail) {
      const entry = map.get(code) || { source: SOURCE, code, details: [], count: 0 };
      entry.count += 1;
      if (detail && entry.details.length < 3 && !entry.details.includes(detail)) entry.details.push(detail);
      map.set(code, entry);
    },
    list() {
      return [...map.values()].map(({ source, code, details, count }) => ({ source, code, detail: details.join(', '), count }));
    },
  };
}

function thresholdMs(window) {
  if (!window || window.sinceTs === null || window.sinceTs === undefined || window.sinceTs === 0) return null;
  let since = window.sinceTs;
  if (typeof since === 'string') since = parseInstantMs(since);
  if (typeof since !== 'number' || !Number.isFinite(since) || since <= 0) return null;
  const slack = Number.isFinite(window.slackMs) ? window.slackMs : 0;
  return since - slack;
}

const isText = (v) => typeof v === 'string' && v.length > 0;

function startedData(m) {
  const data = {
    run_id: m.run_id, role: m.role ?? null, runner: m.runner ?? null, model: m.model ?? null,
    branch: m.branch ?? null, base_sha: m.base_sha ?? null,
  };
  if (isText(m.parent_run_id)) data.parent_run_id = m.parent_run_id;
  if (Number.isInteger(m.depth)) data.depth = m.depth;
  if (Number.isFinite(m.timeout_seconds)) data.timeout_seconds = m.timeout_seconds;
  return data;
}

function read(ctx, window) {
  const events = [];
  const warn = warner();
  const stats = { name: SOURCE, state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 };
  const finish = () => ({ events, warnings: warn.list(), stats });
  try {
    const project = (ctx && ctx.project) || {};
    const dir = runsDir((ctx && ctx.env) || process.env);
    const floor = thresholdMs(window);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (error) {
      if (error && error.code === 'ENOENT') { stats.state = 'absent'; return finish(); } // a fresh host is normal: no warning
      stats.state = 'degraded';
      warn.add('file_unreadable', path.basename(dir));
      return finish();
    }
    names.sort();
    for (const name of names) {
      if (!name.endsWith('.manifest.json') || name.startsWith('panel-')) continue;
      const file = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(file);
      } catch (error) {
        if (error && error.code === 'ENOENT') continue; // reaped between readdir and stat
        stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('file_unreadable', name);
        continue;
      }
      if (!st.isFile()) continue;
      if (floor !== null && st.mtimeMs < floor) continue; // immutable once finished: nothing new can be in it
      stats.rows_read += 1;
      if (st.size > MAX_MANIFEST_BYTES) { stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('line_too_long', name); continue; }
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch (error) {
        if (error && error.code === 'ENOENT') { stats.rows_read -= 1; continue; }
        stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('file_unreadable', name);
        continue;
      }
      let m;
      try {
        m = JSON.parse(text);
      } catch (_error) {
        stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('line_unparseable', name);
        continue;
      }
      if (!m || typeof m !== 'object' || Array.isArray(m) || !isText(m.run_id)) {
        stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('schema_mismatch', name);
        continue;
      }
      if (project.repo_identity && m.repo_identity !== project.repo_identity) { stats.rows_filtered += 1; continue; }
      if (!project.repo_identity || !isText(m.repo_identity)) { stats.rows_filtered += 1; continue; }

      const ids = { root_run_id: isText(m.root_run_id) ? m.root_run_id : null, run_id: m.run_id };
      const base = { ts_basis: 'source', source: EVENT_SOURCE, project_key: project.project_key, ...ids };
      const startedTs = parseInstant(m.started_at);
      if (startedTs === null) {
        stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('ts_invalid', name);
      } else {
        events.push({ id: `dispatch.started:${m.run_id}`, kind: 'dispatch.started', ts: startedTs, ...base, data: startedData(m) });
      }
      if (isText(m.ended_at) && isText(m.final_status)) {
        const endedTs = parseInstant(m.ended_at);
        if (endedTs === null) {
          stats.rows_skipped += 1; stats.state = 'degraded'; warn.add('ts_invalid', name);
        } else {
          let duration = Number.isFinite(m.ended_epoch) && Number.isFinite(m.started_epoch) ? m.ended_epoch - m.started_epoch : null;
          if (duration === null && startedTs !== null) duration = Math.round((Date.parse(endedTs) - Date.parse(startedTs)) / 1000);
          events.push({
            id: `dispatch.ended:${m.run_id}`, kind: 'dispatch.ended', ts: endedTs, ...base,
            data: { run_id: m.run_id, final_status: m.final_status, duration_s: duration, role: m.role ?? null, runner: m.runner ?? null, model: m.model ?? null },
          });
        }
      }
    }
  } catch (_error) {
    stats.state = 'degraded';
    warn.add('source_failed', 'dispatch');
  }
  return finish();
}

module.exports = { read };
