'use strict';

// src/status/events/sources/runledger.js - reader of kind `run.stage` (autopilot.events/1, plan E2 step 7).
//
//   read(ctx, window) -> { events, warnings, stats, files }       never throws, read-only
//   ctx    = { project:{project_key, repo_identity,...}, env, home, now }
//   window = { sinceTs, slackMs, hints }                          hints: {"runledger:<12 hex head>": byte offset}
//
// Ledger paths (all optional discovery candidates: a missing one is silent and counted in rows_filtered; no ledger at all is
// state `absent`): the `ledger` field of this project's dispatch manifests (<runsDir>/*.manifest.json, panel-* skipped, only
// those whose repo_identity equals the project) and the `paths.ledger` / `ledger_path` of the campaign work orders
// <git-common-dir>/autopilot/work-orders/<root>/*.json. Each ledger is read as the rotation-aware set `<p>.N ... <p>.1, <p>`
// (run-ledger.sh:ledger_scan_files; N = run_ledger.max_rotations). Hints are keyed by the file's head hash, not by name, so a
// segment renamed <p> -> <p>.1 keeps its offset (rotation-stable). Only rows with kind:"stage" are events; every other kind
// (heartbeat, journal, resource, directive*, worker_event*, coordination) is counted in rows_filtered.
// id = sha256(canonical row)[0:24] (content only, so live file and `.1` agree; a row seen twice is one event). `status` is
// row.status whenever the row has a status property (even ''), else row.state; both present and different -> status wins plus
// one warning status_state_conflict (counted for in-window events only). `reason` is redacted and capped at 120 characters.
// basis is always `self_reported`. Events carry a non-enumerable `_src` = {source, file, head, offset, end} for E3.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readLines, windowFloorMs } = require('../jsonl-tail');
const { parseInstant, parseInstantMs } = require('../instant');
const { canonical } = require('../../../../scripts/validate-json-schema');
const { runsDir } = require('../../../../scripts/lib/runtime-paths');
const { maxRotations } = require('../../../../scripts/lib/run-ledger-config');
// E3 swap point: replace this require with src/status/events/redact.js (same `redactFreeText(text) -> {text, count}`).
const { redactFreeText } = require('../redact-stub');

const SOURCE = 'runledger';
const REASON_MAX = 120;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => typeof v === 'string' && v !== '';
const has = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

function cap(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

function readSmallJson(file) {
  try {
    if (fs.statSync(file).size > MAX_JSON_BYTES) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObj(value) ? value : null;
  } catch (_error) { return null; }
}

function listDir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch (_error) { return []; }
}

function ledgerPaths(project, env) {
  const found = new Set();
  const add = (value) => { if (nonEmptyString(value) && path.isAbsolute(value)) found.add(value); };
  const dir = runsDir(env);
  for (const entry of listDir(dir)) {
    if (!entry.isFile() || !entry.name.endsWith('.manifest.json') || entry.name.startsWith('panel-')) continue;
    const manifest = readSmallJson(path.join(dir, entry.name));
    if (manifest && manifest.repo_identity === project.repo_identity) add(manifest.ledger);
  }
  const id = project.repo_identity;
  if (typeof id === 'string' && id.startsWith('git-common-dir:')) {
    const orders = path.join(id.slice('git-common-dir:'.length), 'autopilot', 'work-orders');
    for (const root of listDir(orders)) {
      if (!root.isDirectory()) continue;
      for (const entry of listDir(path.join(orders, root.name))) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const wo = readSmallJson(path.join(orders, root.name, entry.name));
        if (!wo) continue;
        add(isObj(wo.paths) ? wo.paths.ledger : undefined);
        add(wo.ledger_path);
      }
    }
  }
  return [...found].sort();
}

function read(ctx = {}, window = {}) {
  const events = [];
  const files = [];
  const warnings = new Map();
  const stats = { state: 'ok', rows_read: 0, rows_skipped: 0, rows_filtered: 0, redactions: 0 };
  const warn = (code, detail, count = 1) => {
    const key = `${code}\u0000${detail}`;
    const hit = warnings.get(key);
    if (hit) hit.count += count; else warnings.set(key, { source: SOURCE, code, detail, count });
    if (code !== 'status_state_conflict') stats.state = 'degraded'; // that one is information about a claim, not a source fault
  };
  try {
    const project = ctx.project || {};
    const env = ctx.env || process.env;
    const floor = windowFloorMs(window);
    const rotations = maxRotations({ env, home: ctx.home });
    const seen = new Set();
    let anyFile = false;

    for (const base of ledgerPaths(project, env)) {
      const set = [];
      for (let idx = rotations; idx >= 1; idx -= 1) set.push(`${base}.${idx}`);
      set.push(base);
      let existed = false;
      for (const file of set) {
        const name = path.basename(file);
        const res = readLines(file, { parse: true, hints: window.hints, hintPrefix: SOURCE, onLine: (line, info) => {
          try { handle(line, file, name, info.head); } catch (_error) { stats.rows_skipped += 1; }
        } });
        if (res.state === 'absent') continue; // a rotated segment or a reaped ledger: silent
        existed = true;
        anyFile = true;
        for (const w of res.warnings) warn(w.code, w.detail, w.count);
        if (res.state === 'unreadable') continue;
        files.push({ key: `${SOURCE}:${res.head}`, file, size: res.size, head: res.head, startOffset: res.startOffset, endOffset: res.endOffset });
      }
      if (!existed) stats.rows_filtered += 1; // a manifest-named ledger that is gone
    }
    if (!anyFile) stats.state = stats.state === 'degraded' ? 'degraded' : 'absent';

    function handle(line, file, name, head) {
      stats.rows_read += 1;
      if (line.bad) { stats.rows_skipped += 1; return; } // line_unparseable already counted by readLines
      const row = line.value;
      if (!isObj(row)) { stats.rows_skipped += 1; warn('schema_mismatch', name); return; }
      if (row.kind !== 'stage') { stats.rows_filtered += 1; return; }
      if (!nonEmptyString(row.run_id) || !nonEmptyString(row.stage) || !Number.isInteger(row.generation) || row.generation < 0) {
        stats.rows_skipped += 1; warn('schema_mismatch', name); return;
      }
      const ts = typeof row.ts === 'string' ? parseInstant(row.ts) : null;
      if (ts === null) { stats.rows_skipped += 1; warn('ts_invalid', name); return; }
      const key = sha(canonical(row)).slice(0, 24);
      if (seen.has(key)) { stats.rows_filtered += 1; return; }
      seen.add(key);
      if (floor !== null && parseInstantMs(ts) < floor) return;

      const data = { run_id: row.run_id, stage: row.stage, generation: row.generation, basis: 'self_reported' };
      const hasStatus = has(row, 'status');
      const chosen = hasStatus ? row.status : (has(row, 'state') ? row.state : undefined);
      if (typeof chosen === 'string' || chosen === null) { if (hasStatus || has(row, 'state')) data.status = chosen; }
      if (hasStatus && has(row, 'state') && row.status !== row.state) warn('status_state_conflict', name);
      if (nonEmptyString(row.reason)) {
        const red = redactFreeText(row.reason);
        stats.redactions += red.count;
        data.reason = cap(red.text, REASON_MAX);
      }
      const event = {
        id: `run.stage:${key}`, kind: 'run.stage', ts, ts_basis: 'source', source: 'run_ledger',
        project_key: project.project_key, root_run_id: nonEmptyString(row.root_run_id) ? row.root_run_id : null,
        run_id: row.run_id, data,
      };
      Object.defineProperty(event, '_src', { value: { source: SOURCE, file, head, offset: line.offset, end: line.end }, enumerable: false });
      events.push(event);
    }
  } catch (error) {
    warn('source_failed', error && error.name ? error.name : 'Error');
  }
  return { events, warnings: [...warnings.values()], stats, files };
}

module.exports = { read, SOURCE };
