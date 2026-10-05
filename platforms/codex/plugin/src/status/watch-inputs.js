'use strict';

// src/status/watch-inputs.js — everything the watcher feeds `assemble()` besides runs / task / progress (mods P1W WATCH-A).
// One call per scope per tick/publish; each input lives in its own module and fails closed to "not provided":
//   planned-input.js (W1g)   decision-input.js (W2a-m)   compare-input.js (W2e-m)   phase-input.js (W2b-m)   sources-manifest.js (W1i)
// plus the task in progress (planned-input.js readInProgressTask, PHASE-TASK) as the phase fallback
// Returns
//   assemble : { decision, planned, compare, compareProvided, markerPhase, taskPhase, sourcesManifest }   (spread into assemble())
//   sources  : source rows to append (roles planned / decision / session_phase / session_task_phase; compare rows are added by assemble)
//   signature: one string that changes exactly when any of these inputs changes (folded into the render change signature)
//   writeSidecar(runsDir, scopeKey): `<runsDir>/sources/<scope_key>.json` (autopilot.sources/1), tmp + rename

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { commonDirOf } = require('./scope-key');
const { readPlanned, readInProgressTask } = require('./planned-input');
const { readDecision } = require('./decision-input');
const { readCompare } = require('./compare-input');
const { readMarkerPhase } = require('./phase-input');
const { buildSourcesManifest } = require('./sources-manifest');

const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

function readWatchInputs({ env, key, identity, root, nowMs, liveBase, autopilotHome, markers, progressReceipt }) {
  const commonDir = commonDirOf(identity);
  const scope = { project_key: key, root_run_id: root || null };
  const planned = readPlanned({ liveBase, key, root, progressReceipt, markers, nowMs });
  const decision = readDecision({ commonDir, key, root, identity, nowMs });
  const cmp = root ? readCompare({ commonDir, root }) : { provided: false, entries: [], signature: [] };
  const markerPhase = readMarkerPhase({ markers, key, root });
  const taskPhase = readInProgressTask({ liveBase, key, root, markers, nowMs });
  const manifest = buildSourcesManifest({ pluginRoot: PLUGIN_ROOT, env, autopilotHome, scope });
  const sources = [];
  if (planned) sources.push({ role: 'planned', path: planned.label, sha256: planned.sha256 });
  if (decision) sources.push({ role: 'decision', path: decision.file, sha256: decision.sha256 });
  if (markerPhase) sources.push({ role: 'session_phase', path: `session-mode marker ${markerPhase.session_id || ''} phase`.trim(), sha256: sha(JSON.stringify(markerPhase)) });
  if (taskPhase) sources.push({ role: 'session_task_phase', path: `session-tasks ${taskPhase.session_id} task ${taskPhase.id} in_progress`, sha256: sha(JSON.stringify(taskPhase)) });
  const manifestText = JSON.stringify(manifest);
  return {
    assemble: {
      decision: decision ? { value: decision.value, sha256: decision.sha256 } : null,
      planned: planned ? { value: planned.value, sha256: planned.sha256 } : null,
      compare: cmp.entries, compareProvided: cmp.provided, markerPhase, taskPhase, sourcesManifest: manifest,
    },
    sources,
    signature: JSON.stringify({
      planned: planned ? planned.sha256 : null, decision: decision ? `${decision.sha256}:${Math.floor(decision.value.age_s / 86400)}` : null, compare: cmp.signature,
      phase: markerPhase ? `${markerPhase.phase}@${markerPhase.phase_set_at}` : null,
      task_phase: taskPhase ? `${taskPhase.session_id}#${taskPhase.id}:${taskPhase.subject}` : null, manifest: sha(manifestText),
    }),
    writeSidecar(runsDir, scopeKey) {
      // A sidecar failure must never stop the page publish: report false and let the caller carry on.
      const file = path.join(runsDir, 'sources', `${scopeKey}.json`);
      const tmp = `${file}.tmp-${process.pid}`;
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, file);
        return true;
      } catch (_error) {
        try { fs.unlinkSync(tmp); } catch (_cleanup) { /* best effort */ }
        return false;
      }
    },
  };
}

module.exports = { readWatchInputs };
