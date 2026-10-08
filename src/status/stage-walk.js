'use strict';

// src/status/stage-walk.js — the per-session stage walk the runs watcher publishes (stage-graph plan P7 D4, band position/unit
// slots + panel Graph tab).
//
//   <live>/stage/<sid>.json   schema autopilot.stage-walk/1
//   { schema, sid, size, urgent, bug, high_risk, units: N|null, nodes, walk, entry, terminal, unit_kind,
//     current: marker.stage|null, stage_set_at: marker.stage_set_at|null, at }
//
// One file per unexpired session marker of this project that carries a `size`. nodes/walk/entry/terminal/unit_kind come from
// scripts/stage-graph.js buildWalk() (required, never spawned, no graph rule re-implemented here) with the marker's
// size/urgent/bug/high_risk and units = marker.unit.total (1 without a unit). The file is rewritten only when an input
// changes: (size, urgent, bug, high_risk, stage, stage_set_at, unit) — stage_set_at rides along because the band shows its
// age and re-entering the same stage moves it without moving `stage`. A vanished file is rewritten too.
//
// Stale files: when a marker this publisher wrote for disappears (expired / ended / no size any more) its file is removed.
// Files left by an EARLIER watcher process are NOT swept: the file carries no project_key, so a watcher cannot tell its own
// from another project's (same stance as <live>/tasks and <live>/attention, which are never swept either).

const fs = require('fs');
const path = require('path');
const { sanitizeSessionId } = require('../../scripts/lib/live-state-dir');
const { buildWalk, DEFAULT_GRAPH } = require('../../scripts/stage-graph');

const SCHEMA = 'autopilot.stage-walk/1';

function loadGraph(file = DEFAULT_GRAPH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// -> the fact (without `at`) or null when the marker has no usable size.
function buildStageWalkFact(marker, graph) {
  if (!marker || typeof marker.session_id !== 'string' || !marker.session_id) return null;
  if (typeof marker.size !== 'string' || !graph.sizes || !graph.sizes[marker.size]) return null;
  const units = marker.unit && Number.isInteger(marker.unit.total) && marker.unit.total >= 1 ? marker.unit.total : null;
  const v = { size: marker.size, bug: marker.bug === true, urgent: marker.urgent === true, highRisk: marker.high_risk === true, research: false, units: units === null ? 1 : units };
  const w = buildWalk(graph, v);
  return {
    schema: SCHEMA,
    sid: marker.session_id,
    size: marker.size,
    urgent: v.urgent,
    bug: v.bug,
    high_risk: v.highRisk,
    units,
    nodes: w.nodes,
    walk: w.walk,
    entry: w.entry,
    terminal: w.terminal,
    unit_kind: w.unit_kind,
    current: typeof marker.stage === 'string' ? marker.stage : null,
    stage_set_at: typeof marker.stage_set_at === 'string' ? marker.stage_set_at : null,
  };
}

function createStageWalkPublisher({ live, writeAtomic, log = () => {}, graphFile = DEFAULT_GRAPH }) {
  const dir = path.join(live, 'stage');
  const written = new Map(); // file name -> input signature last written by this process
  let graph = null;

  function publish({ markers, nowMs }) {
    if (!graph) {
      try { graph = loadGraph(graphFile); } catch (error) { log(`stage walk: cannot read graph: ${error.message}`); return; }
    }
    const wanted = new Set();
    for (const marker of markers) {
      let fact;
      try { fact = buildStageWalkFact(marker, graph); } catch (error) { log(`stage walk failed for ${marker && marker.session_id}: ${error.message}`); continue; }
      if (!fact) continue;
      const name = `${sanitizeSessionId(fact.sid)}.json`;
      wanted.add(name);
      const file = path.join(dir, name);
      const sig = JSON.stringify(fact);
      if (written.get(name) === sig && fs.existsSync(file)) continue;
      try { writeAtomic(file, `${JSON.stringify({ ...fact, at: new Date(nowMs).toISOString() }, null, 2)}\n`); written.set(name, sig); } catch (error) { log(`stage walk write failed for ${name}: ${error.message}`); }
    }
    for (const name of [...written.keys()]) {
      if (wanted.has(name)) continue;
      try { fs.unlinkSync(path.join(dir, name)); } catch (error) { if (!error || error.code !== 'ENOENT') log(`stage walk: cannot remove ${name}: ${error.message}`); }
      written.delete(name);
    }
  }

  return { publish, dir };
}

module.exports = { SCHEMA, buildStageWalkFact, createStageWalkPublisher };
