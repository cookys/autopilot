'use strict';

// src/status/foreman-activity.js — foreman liveness read side of the runs watcher (mods plan P1W WATCH-B, W2c read side).
//
//   <live>/runs/<scope_key>.foreman.json   schema autopilot.foreman-activity/1   (written ONLY when a source answered)
//
// LIVENESS, NEVER A VERDICT. Every row is "when did this source last move", an age; nothing here says a foreman is alive,
// dead or working. Three sources, all written by code that already runs (nothing here writes a lease or heartbeat on a
// foreman's behalf, and no lease PID is ever consulted: the PID a CC-native foreman's `stage-acquire` records is the dead
// acquiring shell, see watch-foreman.js stageCondition):
//   (a) context_tasks  <live>/context/<sid>.tasks.json   written by codeforge's opt-in `subagentStatusLine`. Only `written_at`
//                      age counts, never a row's `status`; rows whose file is older than STALL_S are marked stale:true.
//   (b) run_ledger     `${AUTOPILOT_DISPATCH_RUNS_DIR | TMPDIR/autopilot-dispatch-runs}/<root>.ledger.jsonl` and
//                      `<git-common-dir>/autopilot/dispatch-runs/<root>.ledger.jsonl`: the latest row with run_id == root
//                      -> stage + max(heartbeat_ts, ts). Same age-only rule as watch-foreman.js.
//   (c) stamp          <live>/agents/<sid>/<agent_id>.json  (autopilot.agent-activity/1, the PostToolUse stamp written by the
//                      PERF/STAMP hand): last_tool_at / last_tool_name. Tool-call age only, never a stage. A SubagentStop
//                      adds `ended_at` (mods P1W FOREMAN); the row carries `stamped: true` and `ended_at` (iso | null) so a reader
//                      can tell "still running, quiet for N s" from "done". Only stamp rows can say ended.
// Binding: (a) and (c) are per SESSION (sessions holding an unexpired marker of THIS project_key (re-checked here, W3a) whose root_run_id equals the
// scope's; null equals null). With two jobs in one session both jobs see the rows: `binding: "session"` says so and no
// per-agent root is ever invented. (b) binds by run_id == root (the front-door text makes the foreman run-id the root).
// Nothing found -> no sidecar (an old one is removed); the sources manifest then reads `foreman: not wired`.

const fs = require('fs');
const path = require('path');
const { sanitizeSessionId } = require('../../scripts/lib/live-state-dir');

const SCHEMA = 'autopilot.foreman-activity/1';
const STALL_S = 600; // same default quiet bound as scripts/watch-foreman.js --quiet-secs
const REWRITE_S = 60; // age_s drifts every tick; refresh the file at most this often when nothing else changed
const SAFE_ROOT = /^[A-Za-z0-9._-]+$/;

function commonDirOf(identity) {
  const m = typeof identity === 'string' ? /^git-common-dir:(.+)$/.exec(identity) : null;
  return m ? m[1] : null;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; }
}

function isoOrNull(ms) { return Number.isFinite(ms) ? new Date(ms).toISOString() : null; }
function ageS(nowMs, atMs) { return Math.max(0, Math.round((nowMs - atMs) / 1000)); }

// (a) rows of one session's tasks file.
function fromContextTasks(live, sid, nowMs) {
  const v = readJson(path.join(live, 'context', `${sid}.tasks.json`));
  if (!v || !Array.isArray(v.tasks)) return [];
  const at = Date.parse(v.written_at);
  if (!Number.isFinite(at)) return [];
  const out = [];
  for (const t of v.tasks) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) continue;
    out.push({
      agent_id: t.id,
      description: typeof t.description === 'string' ? t.description : null,
      label: typeof t.label === 'string' ? t.label : null,
      last_activity_at: isoOrNull(at),
      age_s: ageS(nowMs, at),
      stale: nowMs - at > STALL_S * 1000,
      source: 'context_tasks',
      session_id: sid,
      binding: 'session',
    });
  }
  return out;
}

// (c) STAMP files of one session.
function fromStamps(live, sid, nowMs) {
  const dir = path.join(live, 'agents', sid);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_error) { return []; }
  const out = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const v = readJson(path.join(dir, name));
    if (!v || v.schema !== 'autopilot.agent-activity/1' || typeof v.agent_id !== 'string' || !v.agent_id) continue;
    const at = Date.parse(v.last_tool_at);
    if (!Number.isFinite(at)) continue;
    out.push({
      agent_id: v.agent_id,
      description: null,
      label: typeof v.last_tool_name === 'string' && v.last_tool_name ? `last tool: ${v.last_tool_name}` : null,
      last_activity_at: isoOrNull(at),
      age_s: ageS(nowMs, at),
      stale: nowMs - at > STALL_S * 1000,
      stamped: true,
      ended_at: typeof v.ended_at === 'string' && Number.isFinite(Date.parse(v.ended_at)) ? v.ended_at : null,
      source: 'stamp',
      session_id: sid,
      binding: 'session',
    });
  }
  return out;
}

// One agent_id seen by both (a) and (b-stamp): keep the newer activity, fill description/label from whichever has them.
function mergeAgents(rows) {
  const byId = new Map();
  for (const r of rows) {
    const k = `${r.session_id}\u0000${r.agent_id}`;
    const cur = byId.get(k);
    if (!cur) { byId.set(k, { ...r }); continue; }
    const newer = Date.parse(r.last_activity_at) > Date.parse(cur.last_activity_at) ? r : cur;
    const older = newer === r ? cur : r;
    const stamp = r.stamped ? r : cur.stamped ? cur : null;
    byId.set(k, {
      ...newer,
      ...(stamp ? { stamped: true, ended_at: (r.ended_at || cur.ended_at) || null } : {}),
      description: newer.description || older.description,
      label: newer.label || older.label,
      source: newer.source,
    });
  }
  return [...byId.values()];
}

// (b) newest foreman ledger row of run_id == root across the two convention paths.
function fromRunLedger({ root, dispatchRunsDir, common, nowMs }) {
  if (typeof root !== 'string' || !SAFE_ROOT.test(root) || root === '.' || root === '..') return null;
  const candidates = [
    { file: path.join(dispatchRunsDir, `${root}.ledger.jsonl`), source: 'run_ledger:tmp' },
  ];
  if (common) candidates.push({ file: path.join(common, 'autopilot', 'dispatch-runs', `${root}.ledger.jsonl`), source: 'run_ledger:common' });
  let best = null;
  for (const { file, source } of candidates) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (_error) { continue; }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i]) continue;
      let row;
      try { row = JSON.parse(lines[i]); } catch (_error) { continue; }
      if (!row || row.run_id !== root || typeof row.stage !== 'string' || !row.stage) continue;
      const ts = Date.parse(row.ts);
      const hb = Number.isFinite(row.heartbeat_ts) ? row.heartbeat_ts * 1000 : NaN;
      const at = Math.max(Number.isFinite(ts) ? ts : -Infinity, Number.isFinite(hb) ? hb : -Infinity);
      if (!Number.isFinite(at)) break; // newest matching row has no usable time: this file says nothing
      if (!best || at > best.at) best = { stage: row.stage, at, source };
      break; // latest matching row of this file only
    }
  }
  return best ? { stage: best.stage, stage_source: best.source, stage_at: isoOrNull(best.at), stage_age_s: ageS(nowMs, best.at) } : null;
}

/**
 * Pure builder -> sidecar object, or null when no source answered.
 *   markers: unexpired session-mode markers of this project (the caller's list)
 */
function buildForemanActivity({ scope, markers, live, dispatchRunsDir, nowMs }) {
  const root = scope.root_run_id || null;
  const common = commonDirOf(scope.repo_identity);
  const sids = [...new Set(markers
    .filter((m) => m && m.project_key === scope.project_key && typeof m.session_id === 'string' && m.session_id && (m.root_run_id || null) === root)
    .map((m) => sanitizeSessionId(m.session_id)))].sort();
  let rows = [];
  for (const sid of sids) rows = rows.concat(fromContextTasks(live, sid, nowMs), fromStamps(live, sid, nowMs));
  const agents = mergeAgents(rows)
    .sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at) || a.agent_id.localeCompare(b.agent_id));
  const stage = root ? fromRunLedger({ root, dispatchRunsDir, common, nowMs }) : null;
  if (agents.length === 0 && !stage) return null;
  return {
    schema: SCHEMA,
    scope: { project_key: scope.project_key, repo_identity: scope.repo_identity, root_run_id: root },
    binding: 'session',
    stall_s: STALL_S,
    agents,
    stage: stage ? stage.stage : null,
    stage_source: stage ? stage.stage_source : null,
    stage_at: stage ? stage.stage_at : null,
    stage_age_s: stage ? stage.stage_age_s : null,
  };
}

// Text with the drifting age fields removed: the "did anything move" comparison.
function stableText(sidecar) {
  return JSON.stringify(sidecar, (k, v) => (k === 'age_s' || k === 'stage_age_s' ? undefined : v));
}

function createForemanPublisher({ runsDir, key, live, dispatchRunsDir, getIdentity, writeAtomic, safeSegment, log = () => {} }) {
  const last = new Map(); // scopeKey -> { stable, atMs }

  function publish({ roots, markers, nowMs }) {
    const identity = getIdentity();
    for (const root of [null, ...roots]) {
      const scopeKey = root === null ? key : `${key}--${safeSegment(root)}`;
      const file = path.join(runsDir, `${scopeKey}.foreman.json`);
      let sidecar = null;
      try {
        sidecar = buildForemanActivity({ scope: { project_key: key, repo_identity: identity, root_run_id: root }, markers, live, dispatchRunsDir, nowMs });
      } catch (error) { log(`foreman activity failed for ${scopeKey}: ${error.message}`); continue; }
      if (!sidecar) {
        if (last.has(scopeKey) || fs.existsSync(file)) { try { fs.unlinkSync(file); } catch (_error) { /* gone already */ } last.delete(scopeKey); }
        continue;
      }
      const stable = stableText(sidecar);
      const prev = last.get(scopeKey);
      if (prev && prev.stable === stable && nowMs - prev.atMs < REWRITE_S * 1000 && fs.existsSync(file)) continue;
      try { writeAtomic(file, `${JSON.stringify(sidecar, null, 2)}\n`); last.set(scopeKey, { stable, atMs: nowMs }); } catch (error) { log(`foreman sidecar write failed for ${scopeKey}: ${error.message}`); }
    }
  }

  return { publish };
}

module.exports = { SCHEMA, STALL_S, buildForemanActivity, createForemanPublisher, fromRunLedger };
