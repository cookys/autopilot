#!/usr/bin/env node
'use strict';
// rebuild-brain-row.js <lane> [storeEventId] — rebuild the scorecard row of an ALREADY-FINISHED brain sitting without re-sitting it.
// The qualifier builds `row` in runBrainQualification (scripts/engine-qualify.js, ~:2900) as a pure function of (a) the evidence it
// appended to the capability store, (b) the sitting's identity arguments, (c) the graded verdict, (d) wall time. (a) is stored whole at
// the store event; (b) is stored inside the evidence (identity); (c) is in out/m-<lane>-brain/stdout.json; (d) only exists as the cell's
// run.log START/END stamps (the qualifier's own `started` clock is not persisted), so latency is the cell wall time, a few seconds over.
// Every field is cross-checked against the verdict; any mismatch aborts. Output: out/m-<lane>-brain/rebuilt-row.json.
const fs = require('fs'), path = require('path'), os = require('os');
const lane = process.argv[2];
const D = path.join(__dirname, 'out', `m-${lane}-brain`);
const verdict = JSON.parse(fs.readFileSync(path.join(D, 'stdout.json'), 'utf8').trim().split('\n').pop());
const eventId = Number(process.argv[3] || verdict.evidence_store_event_id);
if (verdict.evidence_store_event_id !== eventId) throw new Error(`verdict names store event ${verdict.evidence_store_event_id}, not ${eventId}`);
const store = path.join(process.env.ENGINE_CAPABILITY_DIR || path.join(os.homedir(), '.autopilot', 'engine-capability'), 'qualification-evidence.jsonl');
const rec = fs.readFileSync(store, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((r) => r.event_id === eventId);
if (!rec) throw new Error(`store event ${eventId} not found`);
const ev = rec.evidence;
const must = (cond, msg) => { if (!cond) throw new Error('cross-check failed: ' + msg); };
must(ev.evidence_id === verdict.evidence_id, 'evidence_id');
must(ev.scope_hash === verdict.scope_hash && ev.identity_hash === verdict.identity_hash && ev.trial_set_hash === verdict.trial_set_hash, 'scope/identity/trial_set hash');
must(rec.transcript_hash === verdict.evidence_store_transcript_hash, 'transcript hash');
must(ev.identity.identity === verdict.model && ev.identity.runner === verdict.runner, 'model/runner');
const trials = ev.trials, id = ev.identity;
const sum = (k) => trials.reduce((s, t) => s + t[k], 0);
const log = fs.readFileSync(path.join(D, 'run.log'), 'utf8');
const start = log.match(/^(\S+) lane=\S+ role=brain START .*version_source=(\S+)/m);
const end = log.match(/^(\S+) lane=\S+ role=brain END /m);
must(start && end, 'run.log START/END stamps');
const vsrc = start[2];
const wall = Math.max(0, Math.round((Date.parse(end[1]) - Date.parse(start[1])) / 1000));
const qualified = ev.state === 'qualified';
must(qualified === verdict.qualified || verdict.qualified === undefined, 'qualified flag');
const row = {
  engine: verdict.engine, model: verdict.model, runner: verdict.runner, family: id.family, role: 'owner',
  methodology_kind: 'owner_brain_seat', model_version: id.model_version, version_source: vsrc,
  corpus_version: ev.methodology.corpus_version, harness_version: id.harness_version, runner_version: id.runner_version,
  prompt_config_hash: id.prompt_config_hash, effort: id.effort, date: ev.issued_at.slice(0, 10),
  quality: { subjects: verdict.subjects,
    plants: `${sum('plants_caught')}/${sum('plants_total')}`, pair_deltas: verdict.pair_delta_count,
    hard_fails: sum('hard_fail_count'), repeated_trials: trials.length },
  latency: { sample_wall_time_s: wall }, status: qualified ? 'qualified' : 'failed', qualified_at: ev.issued_at.slice(0, 10), standing: true,
  evidence_store: { event_id: rec.event_id, producer: rec.producer, transcript_hash: rec.transcript_hash },
  evidence: ev,
};
fs.writeFileSync(path.join(D, 'rebuilt-row.json'), JSON.stringify(row) + '\n');
console.log(`${lane}: store event ${eventId} -> ${path.join(D, 'rebuilt-row.json')} status=${row.status} plants=${row.quality.plants} wall=${wall}s`);
